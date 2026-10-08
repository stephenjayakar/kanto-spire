// Co-op battle scene: two foes on the field, 2-4 player leads (2: yours in front, your partner's beside it;
// 3-4: yours as the big 2x back sprite, the partners' as 1x back sprites in a row beside it, and one compact
// status row per player stacked bottom right). A pure view over session.game.battle (DuoBattle): it never changes the engine itself.
// Every input posts an action through session.post(); the lockstep log applies it on both clients, and
// the events of every applied action (session.battleFeed, copied from game.lastEvents) are animated here
// in order. The sprites/HP on screen lag the engine until the animation catches up (then reconcile()).
import { Engine, W, H, hover, clicked, inRect, pushOverlay, tween, Ease, wait, keyPressed, shake, approach } from '../../engine/core.js';
import { draw, trainerPath, ballSprite } from '../../engine/assets.js';
import { text, measure, textFit } from '../../engine/font.js';
import { swirlBackground, BG_THEMES, button, panel, pixBox, rect, drawTips, tip, hpBar, THEME, shade } from '../../engine/ui.js';
import { burst, floatText, drawFx, clearFx, doFlash, drawFlash } from '../../engine/fx.js';
import { D, TYPE_COLORS, speciesName, typeEffect } from '../../game/data.js';
import { COMBOS } from '../../game/hands.js';
import { BOSS_RULES } from '../../game/bosses.js';
import { CONSUMABLES, BADGES } from '../../game/items.js';
import { maxHp, monName, typesOf, isFainted, DECK_RULES } from '../../game/pokemon.js';
import { G, saveMeta } from '../../game/state.js';
import { Sound } from '../../audio/sound.js';
import { drawTrainer, drawHUD, drawCard, drawCardBack, cardTooltip, drawPartyPanel, drawMon, drawIcon, CARD_W, CARD_H, MessageBox, ChoiceModal, PartyPicker, DeckModal, monTooltip, Modal } from '../common.js';
import { terrainImage, playedRowPos, TRAINER_LINGER, skippableWait, pollSkip, pileInput, drawPileTip, PILE_X, PILE_Y } from '../battle.js';
import { COOP_TUNING } from '../../game/coop/tuning.js';
import { PCOL, PFONT, drawCoopOverlay, drawPartnerChip, playerStatus, coopToast } from './ui.js';
import { MoveAnims } from '../../anim/player.js';
import { pickHandAnim, ANIM_SPEED } from '../../anim/pick.js';
import { opaqueBounds, monSprite } from '../common.js';
import { tinted } from '../../engine/assets.js';

const SCENE_X = 160, SCENE_Y = 27, SCENE_W = 480, SCENE_H = 200;
const HAND_Y = 262;
// Laid out like a Gen 3 double battle, with every sprite at an integer 2x scale (like solo) so pixels stay crisp:
// the two foes stand on the far platform (right one further back), the two player leads are back sprites
// side by side at the bottom left (yours on the left, your partner's a step right and nearer), both facing
// the foes. Back sprites are cut off at the bottom like in the games, so they sit on the scene's bottom edge.
const MON_S = 2;                                                     // 64 px sprites drawn at 128 px
const FOE_POS = [[SCENE_X + 250, SCENE_Y + 4], [SCENE_X + 350, SCENE_Y - 6]];
const FOE_BOX = [[SCENE_X + 6, SCENE_Y + 5], [SCENE_X + 6, SCENE_Y + 46]], FOE_BOX_W = 148, FOE_BOX_H = 38;
const INTENT_X = SCENE_X + 158, INTENT_W = 100;
const LEAD_POS = { me: [SCENE_X + 18, SCENE_Y + 76], partner: [SCENE_X + 122, SCENE_Y + 84] };
const LEAD_BOX = { me: [SCENE_X + 302, SCENE_Y + 122], partner: [SCENE_X + 302, SCENE_Y + 160] }, LEAD_BOX_W = 174, LEAD_BOX_H = 34;
const MSG_BOX = [SCENE_X + 4, SCENE_Y + SCENE_H - 46, 292, 42];
// 3-4 players: my lead at 2x where it stands with 2 players; the partners' leads at 1x (integer scales only)
// in a row to its right, just above the message box; one 16 px status row per player
// stacked bottom right (mine on top); up to two intents per foe.
// (the partners' row stays left of the foes' platform, which moves a little right: no sprite overlaps a foe;
// its feet tuck behind the message box like cut-off back sprites; the status rows sit right of the message box)
const ME_POS_N = [SCENE_X + 10, SCENE_Y + 76], ROW_X0 = SCENE_X + 128, ROW_STEP = 52, ROW_Y = SCENE_Y + 100;
const FOE_POS_N = [[SCENE_X + 266, SCENE_Y + 2], [SCENE_X + 352, SCENE_Y - 8]];
const MINI_BOX = [SCENE_X + 300, SCENE_Y + 128], MINI_W = 176, MINI_H = 16;
const INTENT_W_N = 112;
const BACKLOG_SKIP = 160;                                            // more queued events than this: skip to the end
const TYPE_SFX = {
  NORMAL: 'se_m_comet_punch', FIRE: 'se_m_flamethrower', WATER: 'se_m_bubble2', GRASS: 'se_m_razor_wind', ELECTRIC: 'se_m_thunderbolt2',
  ICE: 'se_m_icy_wind', FIGHTING: 'se_m_mega_kick2', POISON: 'se_m_toxic', GROUND: 'se_m_dig', FLYING: 'se_m_wing_attack', PSYCHIC: 'se_m_psybeam',
  BUG: 'se_m_string_shot', ROCK: 'se_m_rock_throw', GHOST: 'se_m_nightmare', DRAGON: 'se_m_dragon_rage', DARK: 'se_m_bite', STEEL: 'se_m_vicegrip',
};
const HAND_EVENTS = new Set(['teamUp', 'combo', 'card', 'flat', 'bonus', 'times', 'total']);
const PLAYED_Y = HAND_Y - 2;                                         // played cards: full size (crisp), integer positions, below the scene
const NO_COOP_ITEM = (def) => def.flee || def.levels || def.evo || def.combo || def.sell || def.addCopy || def.relearn;

export class CoopBattleScene {
  constructor(session) {
    this.s = session;
    this.drawsCoopOverlay = true;
    this.duo = session.game.battle;
    this.cfg = session.game.battleCfg || this.duo?.cfg || {};
  }

  // ---- shortcuts ----------------------------------------------------------------------------
  get g() { return this.s.game; }
  get me() { return this.s.mySlot; }
  get pa() { return this.s.partnerSlot; }
  get n() { return this.duo?.n || 2; }
  get many() { return this.n > 2; }
  // screen order of the players: me first, then the others in seat order
  get order() { return [this.me, ...this.s.others]; }
  othersLocked() { return this.duo.locks.some((L, q) => q !== this.me && L); }
  get sub() { return this.duo.subs[this.me]; }
  get speed() { return this.fast ? 0.45 : 1; }
  async wait(t) { await wait(t * this.speed); }
  run(p = this.me) { return this.duo.subs[p].run; }
  nameOf(p) { return p === this.me ? 'YOU' : this.s.nameOf(p); }
  isTrainer() { return !!(this.cfg.trainer || this.cfg.trainers) && this.cfg.kind !== 'wild'; }

  enter() {
    this.t = 0;
    this.msg = new MessageBox();
    this.fast = G.meta.settings.fast;
    this.pendingAnim = null; this.animInv = null;
    MoveAnims.load();
    this.q = [];
    this.running = false;
    this.sel = [];
    this.vis = new Map();         // card key -> {x,y,lift,alpha,state,flash}; key = id (mine) or 'p'+id (partner's)
    this.handIds = [];            // my hand, in MY visual order (the engine's hand order is shared state: never touched)
    this.playedIds = []; this.playedBy = null; this.playedTarget = 0; this.playedDmg = null; this.pendingPlays = {};
    this.score = null;
    this.foes = [null, null];
    this.leads = this.g.runs.map(() => null);
    this.partyHp = this.g.runs.map(() => ({}));
    this.relicBounce = {};
    this.trainerX = SCENE_W;
    this.ballAnim = null;
    this.targetRi = null;         // the foe (roster index) I aim at; follows it while it's on the field
    this.posting = null;          // { type, at } until my action comes back through the log
    this.released = false;        // the route to the next phase may go ahead
    this.faintAskedKey = null;
    this.arrows = [];             // foe -> player attack arrows (brief)
    clearFx();
    G.run = this.g.runs[this.me];
    if (!this.duo) { this.released = true; return; }
    // The battle's opening events come with the action that started it (when we saw it live): animate
    // from an empty field. Otherwise (reconnect, resync) show the current state right away.
    const feed = (this.s.battleFeed || []).filter(f => f.battle === this.duo);
    const intro = feed.length && feed[0].events.some(e => e.t === 'enemyOut' && e.first);
    if (!intro) this.snap();
    this.introTrainer = !!intro && this.isTrainer(); // (the trainer slides in for 'X wants to battle!')
    this.music(intro);
    this.drainFeed();
    if (!this.q.length) this.idle();
  }

  async music(intro) {
    const cfg = this.cfg;
    if (cfg.trainer?.encounterSong && cfg.kind !== 'wild' && intro) Sound.playBGM(cfg.trainer.encounterSong);
    else Sound.playBGM(cfg.music || (cfg.kind === 'wild' ? 'mus_vs_wild' : 'mus_vs_trainer'));
    if (!intro) return;
    await this.wait(0.3);
    if (cfg.kind !== 'wild') Sound.playBGM(cfg.music || 'mus_vs_trainer');
  }

  exit() { if (this.lowHpOn) Sound.stopSE('se_low_health'); this.lowHpOn = false; }

  // The session holds its route (battle -> rewards / end) while this returns true.
  holdRoute() { return !this.released; }

  onCoopAction(a, ok) {
    if (a.p === this.me && this.posting) {
      this.posting = null;
      if (!ok && a.type === 'unlock') { this.toast = { text: this.many ? 'Too late: the last player locked in, the turn is resolving.' : `Too late: ${this.s.nameOf(this.pa)} locked in first, the turn is resolving.`, t: 2.2 }; Sound.playSE('se_failure'); }
      else if (!ok && ['lock', 'discard', 'switch', 'item'].includes(a.type)) { this.toast = { text: 'That action was refused (the battle moved on).', t: 2 }; Sound.playSE('se_failure'); }
    }
  }

  post(action) {
    if (this.s.desync) { this.toast = { text: 'Resync first (red bar at the top).', t: 2 }; return false; }
    this.posting = { type: action.type, at: Engine.time };
    this.s.post(action);
    return true;
  }

  // ---- display state from the engine ----------------------------------------------------------
  foeDisp(ri) {
    const e = this.duo.enemies[ri];
    return { ri, species: e.species, shiny: e.shiny, level: e.level, hp: e.hp, maxHp: e.maxHp, x: 0, alpha: 1, flash: 0, shake: 0, faint: 0, lunge: 0, captured: 0 };
  }
  leadDisp(p) {
    const d = this.duo, s = d.subs[p], l = s.lead();
    if (!l) return null;
    return { uid: l.uid, species: l.species, shiny: l.shiny, x: 0, flash: 0, faint: d.down[p] || d.away?.[p] || isFainted(l) ? 1 : 0 };
  }
  snap() {
    const d = this.duo;
    for (let slot = 0; slot < 2; slot++) { const ri = d.field[slot]; this.foes[slot] = ri === null || ri === undefined ? null : this.foeDisp(ri); }
    for (let p = 0; p < this.n; p++) this.leads[p] = this.leadDisp(p);
    for (let p = 0; p < this.n; p++) { this.partyHp[p] = {}; for (const m of this.run(p).party) this.partyHp[p][m.uid] = m.hp; }
    if (this.isTrainer()) this.trainerX = d.result?.outcome === 'win' ? 0 : 140;
  }
  // After the animation queue drains: make the display match the engine exactly.
  reconcile() {
    const d = this.duo;
    for (let slot = 0; slot < 2; slot++) {
      const ri = d.field[slot] ?? null, f = this.foes[slot];
      if ((f?.ri ?? null) !== ri) this.foes[slot] = ri === null ? null : this.foeDisp(ri);
      else if (f) { const e = d.enemies[ri]; f.hp = e.hp; f.maxHp = e.maxHp; f.level = e.level; f.faint = 0; f.captured = 0; f.alpha = 1; }
    }
    for (let p = 0; p < this.n; p++) {
      const l = d.subs[p].lead(), cur = this.leads[p];
      if (!l) { this.leads[p] = null; continue; }
      if (!cur || cur.uid !== l.uid) this.leads[p] = this.leadDisp(p);
      else cur.faint = d.down[p] || d.away?.[p] || isFainted(l) ? 1 : 0;
      for (const m of this.run(p).party) this.partyHp[p][m.uid] = m.hp;
    }
  }

  // ---- the event feed -------------------------------------------------------------------------
  drainFeed() {
    const feed = this.s.battleFeed;
    if (!feed?.length) return;
    let added = false;
    while (feed.length) {
      const f = feed.shift();
      if (f.battle !== this.duo) continue;
      this.q.push(...f.events);
      added = true;
    }
    if (added && !this.running) this.pump();
  }

  async pump() {
    if (this.running) return;
    this.running = true;
    while (this.q.length) {
      if (this.q.length > BACKLOG_SKIP) { // way behind (e.g. the tab was hidden): jump to the end
        const end = this.q.filter(e => e.t === 'duoEnd');
        this.q = end;
        this.msg = new MessageBox();
        this.playedIds = []; this.score = null;
        this.reconcile();
        if (!this.q.length) break;
      }
      const e = this.q.shift();
      try { await this.animate(e); } catch (err) { console.error('[coop battle] anim error', e, err); }
    }
    this.running = false;
    this.idle();
  }

  // Nothing left to animate: sync, then either wait for input or finish the battle.
  idle() {
    if (this.running || !this.duo) return;
    this.reconcile();
    this.syncHand();
    for (const id of this.playedIds) { const v = this.vis.get(this.vk(id, this.playedBy)); if (v) v.state = 'discard'; }
    this.playedIds = [];
    const d = this.duo;
    if (d.result || this.g.phase !== 'battle') { this.finish(); return; }
    this.stuck = !this.anyLegalPlay();
    if (this.canAct() && this.sub.faintSwitch) this.chooseAfterFaint();
  }

  async finish() {
    if (this.finishing) return;
    this.finishing = true;
    this.exit();
    G.meta.hintBattles = (G.meta.hintBattles || 0) + 1; saveMeta();
    await this.wait(0.4);
    this.released = true;
    this.s.route();
  }

  vk(id, p) { return p === this.me || p === undefined || p === null ? id : 'p' + id; }
  slotOfRi(ri, fallback) {
    const i = this.foes.findIndex(f => f && f.ri === ri);
    return i >= 0 ? i : (fallback ?? null);
  }
  foePos(slot) { const P = this.many ? FOE_POS_N : FOE_POS; return P[slot] || P[0]; }
  foeCenter(slot) { const [x, y] = this.foePos(slot); return [x + 64, y + 64]; }
  leadPos(p) {
    if (!this.many) return p === this.me ? LEAD_POS.me : LEAD_POS.partner;
    if (p === this.me) return ME_POS_N;
    const i = Math.max(0, this.s.others.indexOf(p));
    return [ROW_X0 + i * ROW_STEP, ROW_Y];
  }
  leadScale(p) { return this.many && p !== this.me ? 1 : MON_S; }
  // where "LOCKED IN" / "UNLOCKED" float (3-4 players: on that player's status row, off the sprites)
  lockAnchor(p) { if (!this.many) return this.leadCenter(p); const [x, y, w] = this.leadBox(p); return [x + w / 2, y - 2]; }
  // healthbox of player p: [x, y, w, h]
  leadBox(p) {
    if (!this.many) { const [x, y] = p === this.me ? LEAD_BOX.me : LEAD_BOX.partner; return [x, y, LEAD_BOX_W, LEAD_BOX_H]; }
    const i = Math.max(0, this.order.indexOf(p));
    return [MINI_BOX[0], MINI_BOX[1] + i * (MINI_H + 2), MINI_W, MINI_H];
  }
  leadCenter(p) { const [x, y] = this.leadPos(p), k = this.leadScale(p) / 2; return [x + 64 * k, y + 52 * k]; }

  async say(str) { await this.msg.say(str, { auto: this.fast ? 0.35 : 0.8 }); }

  async activateHand(p) {
    const pp = this.pendingPlays[p];
    delete this.pendingPlays[p];
    if (!pp) return;
    const d = this.duo, me = this.me;
    this.clearPlayed();
    this.score = null; // (the previous hand's score must not sit next to this hand's cards)
    this.playedBy = p;
    this.playedTarget = pp.target;
    this.playedIds = pp.ids;
    this.playedDmg = {};
    for (const id of pp.ids) {
      const c = this.findCard(id, p);
      if (c) this.playedDmg[id] = d.cardInfo(p, c, this.playedTarget).dmgPreview;
      const k = this.vk(id, p);
      if (!this.vis.has(k)) { const [lx, ly] = this.leadCenter(p); this.vis.set(k, { x: lx - CARD_W / 2, y: ly, lift: 0, alpha: 1 }); }
    }
    if (p === me) { this.handIds = this.handIds.filter(id => !pp.ids.includes(id)); this.sel = []; }
    this.pendingAnim = this.chooseHandAnim(p, pp);
    Sound.playSE('se_card_flipping');
    await this.wait(0.35);
  }

  // ---- FireRed move animations (cosmetic: they only read the display state, never the engine or the log)
  // The active hand's one animation: attacks beat status cards, the highest card DMG wins, ties to the leftmost card.
  chooseHandAnim(p, pp) {
    const d = this.duo, cards = [];
    for (const id of pp.ids) {
      const c = this.findCard(id, p); if (!c) continue;
      const info = d.cardInfo(p, c, pp.target);
      if (!info.playable) continue;
      cards.push({ id, move: info.move.key, status: info.status, dmg: this.playedDmg?.[id] ?? info.dmgPreview, data: info.move });
    }
    const pick = pickHandAnim(cards);
    return pick ? { key: pick.move, move: pick.data, p, slot: this.duo.normSlot ? this.duo.normSlot(pp.target) : pp.target } : null;
  }
  // battler 0 = player p's lead, battler 1 = the foe in `slot` (GBA pixels: canvas (SCENE_X, SCENE_Y - 20) is GBA (0,0), sprites at 2x)
  coopBattlers(p, slot) {
    const L = this.leads[p], f = this.foes[slot];
    const box = (path, k) => { const b = opaqueBounds(path) || { x: 0, y: 0, w: 64, h: 64 }; return { x: b.x * k, y: b.y * k, w: b.w * k, h: b.h * k }; };
    const mk = (present, species, cx, cy, path, k) => { const bx = box(path, k); return { present, species, x: Math.round((cx - SCENE_X) / 2), picY: Math.round((cy - SCENE_Y + 20) / 2), y: Math.round((cy - SCENE_Y + 20) / 2) - Math.max(0, 32 * k * 2 - (bx.y + bx.h)) / 2, box: bx }; };
    const [lx, ly] = this.leadPos(p), sc = this.leadScale(p);
    const [fx, fy] = this.foePos(slot);
    return [
      mk(!!L && L.faint < 1, L?.species, lx + 32 * sc, ly + 32 * sc, monSprite(L?.species || 'BULBASAUR', 'back', L?.shiny), sc / 2),
      mk(!!f && f.faint < 1 && !f.captured && f.alpha > 0, f?.species, fx + 64, fy + 64, monSprite(f?.species || 'BULBASAUR', 'front', f?.shiny), 1),
    ];
  }
  async playCoopAnim(moveKey, p, slot, attacker, moveData) {
    if (!MoveAnims.ready || G.meta.settings.moveAnims === false || slot === null || slot === undefined || this.q.length > 40) return false;
    const move = moveData || (D.moves[moveKey] ? { ...D.moves[moveKey], key: moveKey } : null);
    const r = MoveAnims.resolve(moveKey, move, this.cfg.terrain || 'grass');
    if (!r) return false;
    const battlers = this.coopBattlers(p, slot);
    if (!battlers[0].present || !battlers[1].present) return false;
    this.animInv = { p, slot };
    (globalThis.__animLog ||= []).push((attacker ? 'foe:' : 'hand:') + r.key); if (globalThis.__animLog.length > 40) globalThis.__animLog.shift(); // (debug trail for tests)
    try {
      await MoveAnims.play(r.key, {
        attacker, battlers, speed: this.fast ? ANIM_SPEED.coopFast : ANIM_SPEED.coop, maxFrames: 720,
        hooks: { playSE: (n) => Sound.playSE(n), playCry: (sp) => Sound.playCry(sp), power: move?.power || 0 },
      });
    } finally { this.animInv = null; }
    return true;
  }
  drawCoopAnimMon(c, battler, o) {
    const inv = this.animInv; if (!inv) return;
    const foe = battler === 1;
    const D2 = foe ? this.foes[inv.slot] : this.leads[inv.p];
    if (!D2?.species) return;
    const k = foe ? 1 : this.leadScale(inv.p) / 2;
    const flash = D2.flash > 0 && Math.floor(this.t * 20) % 2 ? 0.9 : 0;
    drawMon(c, D2.species, -32 * k, -32 * k, { back: !foe, scale: k, shiny: D2.shiny, flash, alpha: (o.alpha ?? 1) * (1 - (D2.faint || 0)) });
    if (o.tint) {
      const t = tinted(monSprite(D2.species, foe ? 'front' : 'back', D2.shiny), '#' + [o.tint.r, o.tint.g, o.tint.b].map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join(''), 1);
      if (t) { c.save(); c.globalAlpha *= o.tint.a; c.drawImage(t, 0, 0, 64, 64, -32 * k, -32 * k, 64 * k, 64 * k); c.restore(); }
    }
  }

  async animate(e) {
    const d = this.duo, me = this.me;
    // A hand's animation plays after its scoring count-up ('total'), right before its damage lands on the foe
    // (and before the next player's hand is revealed).
    const pa = this.pendingAnim;
    if (pa && pa.scored) {
      this.pendingAnim = null;
      const slot = (e.t === 'damage' && e.side === 'enemy' ? this.slotOfRi(e.ei, e.slot) : null) ?? pa.slot;
      await this.playCoopAnim(pa.key, pa.p, slot, 0, pa.move);
    } else if (pa && ['turn', 'end', 'duoEnd'].includes(e.t)) this.pendingAnim = null;
    if (e.p !== null && e.p !== undefined && this.pendingPlays[e.p] && HAND_EVENTS.has(e.t)) await this.activateHand(e.p);
    switch (e.t) {
      case 'msg':
        // battle intro: the trainer(s) slide in and stay on screen through 'X wants to battle!' (as in solo)
        if (this.introTrainer && / to battle!$/.test(e.text || '')) { this.introTrainer = false; this.trainerX = 140; tween(this, { trainerX: 0 }, 0.35 * this.speed); await this.wait(0.35); }
        await this.say(e.text); break;
      case 'enemyOut': {
        const en = d.enemies[e.ei];
        const slot = e.slot;
        this.foes[slot] = { ...this.foeDisp(e.ei), hp: en.maxHp, x: 120 }; // fresh foe (the engine may already be further on)
        // the trainer lingers before throwing out its first POKéMON (display only; a click/tap cuts it short)
        if (this.isTrainer() && e.first && slot === 0) { this.introTrainer = false; this.trainerX = 0; await skippableWait(this, TRAINER_LINGER * this.speed); tween(this, { trainerX: 140 }, 0.5 * this.speed); }
        if (this.isTrainer()) { const [cx, cy] = this.foeCenter(slot); this.ballAnim = { x: cx, y: cy, t: 0 }; Sound.playSE('se_ball_open'); }
        tween(this.foes[slot], { x: 0 }, 0.4 * this.speed, Ease.outBack);
        Sound.playCry(en.species);
        if (en.shiny) { Sound.playSE('se_shiny'); const [cx, cy] = this.foeCenter(slot); burst(cx, cy, { color: ['#fff', '#f8f080'], n: 16, speed: 60, grav: 0 }); }
        await this.wait(0.35);
        break;
      }
      case 'enemyGone': {
        const slot = this.slotOfRi(e.ei, e.slot);
        if (slot === null) break;
        if (e.why === 'fled') { const f = this.foes[slot]; if (f) await tween(f, { x: 140, alpha: 0 }, 0.35 * this.speed); }
        if (this.foes[slot]?.ri === e.ei) this.foes[slot] = null;
        if (e.why === 'caught') { this.ballAnim = null; }
        break;
      }
      case 'bossRule':
        this.bossBanner = { name: e.name, desc: e.desc, a: 1 };
        Sound.playSE('se_m_screech');
        await this.wait(0.2);
        await this.say(`${e.name}: ${e.desc}`);
        break;
      case 'leadOut': {
        const p = e.p ?? me;
        const mon = this.run(p).party.find(m => m.uid === e.uid);
        if (!mon) break;
        this.leads[p] = { uid: e.uid, species: mon.species, shiny: mon.shiny, x: -60, flash: 0, faint: 0 };
        this.partyHp[p][e.uid] ??= mon.hp;
        tween(this.leads[p], { x: 0 }, 0.35 * this.speed, Ease.outBack);
        Sound.playSE('se_ball_open');
        Sound.playCry(mon.species);
        await this.wait(0.2);
        break;
      }
      case 'turn':
        this.score = null;
        this.pendingPlays = {};
        this.clearPlayed();
        this.syncHand();
        break;
      case 'draw': if (e.p === me) { this.syncHand(); Sound.playSE('se_card_flip'); await this.wait(0.1); } break;
      case 'reshuffle': break;
      case 'lock':
        if (e.p !== me) { Sound.playSE('se_pin'); floatText(`${this.s.nameOf(e.p)} ${e.pass ? 'PASSES' : 'LOCKED IN'}`, ...this.lockAnchor(e.p), { color: 'gold', font: 'small', life: 1.2 }); }
        else Sound.playSE('se_select');
        break;
      case 'unlock':
        if (e.p !== me) { Sound.playSE('se_card_flip'); floatText(`${this.s.nameOf(e.p)} UNLOCKED`, ...this.lockAnchor(e.p), { color: 'orange', font: 'small', life: 1.4 }); this.toast = { text: `${this.s.nameOf(e.p)} took back their lock-in and is choosing again.`, t: 1.8, info: true }; }
        else {
          Sound.playSE('se_card_flip');
          // back to choosing, with the hand I had locked still selected (so it's easy to tweak)
          if (this.unlockSel) { const hand = this.sub.deck.hand.map(c => c.id); this.sel = this.unlockSel.filter(id => hand.includes(id)); }
          this.unlockSel = null;
        }
        break;
      // Every locked hand is announced at the start of the turn; each is shown when it actually resolves
      // (activateHand, on its first scoring event), in speed order with the foes' moves.
      case 'play': this.pendingPlays[e.p ?? me] = { ids: e.ids.slice(), target: e.target ?? 0 }; break;
      case 'discard': {
        if (e.p !== me) break;
        for (const id of e.ids) { const v = this.vis.get(id); if (v) v.state = 'discard'; }
        this.handIds = this.handIds.filter(id => !e.ids.includes(id));
        this.sel = this.sel.filter(id => !e.ids.includes(id));
        if (!e.stow) { if (e.forced) Sound.playSE('se_m_bubble'); else Sound.playSE('se_card_flip'); await this.wait(0.15); }
        break;
      }
      case 'teamUp': {
        const slot = this.slotOfRi(e.ei, e.slot);
        const [cx, cy] = slot !== null ? this.foeCenter(slot) : [SCENE_X + 300, SCENE_Y + 60];
        floatText(`TEAM UP! +${e.bonus}%`, cx, cy - 40, { color: 'gold', scale: 2, life: 1.3 });
        Sound.playSE('se_m_swords_dance');
        await this.wait(0.45);
        break;
      }
      case 'combo':
        this.score = { p: e.p ?? me, name: e.name, level: e.level, base: 0, bonus: e.bonus, times: 1, total: null, pulse: 1, pulseB: 1, foeHp: Math.round(this.foes[this.slotOfRi(e.ei, e.slot) ?? 0]?.hp || 0) };
        this.scoringIds = e.scoring;
        Sound.playSE('se_m_stat_increase');
        await this.wait(0.35);
        break;
      case 'card': {
        const p = e.p ?? me;
        const v = this.vis.get(this.vk(e.id, p));
        if (e.idle) { if (v) v.dim = true; break; }
        if (v) { v.lift = 10; tween(v, { lift: 0 }, 0.3 * this.speed); v.flash = 1; }
        const [cx, cy] = this.playedPos(e.id);
        const card = this.findCard(e.id, p);
        if (['MISS', 'NO EFFECT', 'PARALYZED', 'SHOCKED', 'FAILED', 'FAINTED'].includes(e.label)) {
          floatText(e.label, cx + CARD_W / 2, cy - 8, { color: 'gray' });
          Sound.playSE('se_failure');
        } else if (e.dmg > 0) {
          if (this.playedDmg) this.playedDmg[e.id] = (e.hit ? this.playedDmg[e.id] || 0 : 0) + e.dmg;
          if (this.score) { this.score.base = e.total ?? this.score.base + e.dmg; this.score.pulse = 1.6; }
          floatText(String(e.dmg), cx + CARD_W / 2, cy - 8, { color: 'dmg' });
          if (e.label === 'SUPER') floatText('SUPER EFFECTIVE', cx + CARD_W / 2, cy - 22, { color: 'red', font: 'small' });
          else if (e.label === 'CRITICAL') { floatText('CRITICAL!', cx + CARD_W / 2, cy - 22, { color: 'gold', font: 'small' }); shake(2); }
          else if (e.label === 'WEAK') floatText('not very effective', cx + CARD_W / 2, cy - 22, { color: 'gray', font: 'small' });
          else if (e.label) floatText(e.label, cx + CARD_W / 2, cy - 22, { color: 'orange', font: 'small' });
          if (p === me) for (const k of e.srcs || []) this.bounceSource(k, null);
          const info = card ? d.cardInfo(p, card, this.playedTarget) : null;
          Sound.playSE(TYPE_SFX[info?.type] || 'se_m_comet_punch');
          burst(cx + CARD_W / 2, cy + 10, { color: [TYPE_COLORS[info?.type] || '#fff', '#fff'], n: 8, speed: 60 });
        } else if (e.label) {
          floatText(e.label, cx + CARD_W / 2, cy - 8, { color: 'purple', font: 'small' });
          Sound.playSE('se_m_stat_increase');
        }
        await this.wait(e.hit ? 0.2 : 0.34);
        break;
      }
      case 'flat':
        if (this.score) { this.score.base += e.add; this.score.pulse = 1.6; }
        if (e.p === me) this.bounceSource(e.src, '+' + e.add + ' DMG', 'dmg');
        Sound.playSE('se_m_charge');
        await this.wait(0.25);
        break;
      case 'bonus':
        if (this.score) { this.score.bonus = e.total; this.score.pulseB = 1.6; }
        if (e.p === me) this.bounceSource(e.src, '+' + e.add + '%', 'bonus');
        Sound.playSE('se_m_swords_dance');
        await this.wait(0.25);
        break;
      case 'times':
        if (this.score) { this.score.times *= e.mul; this.score.pulseB = 2; }
        if (e.src === 'TEAM UP') floatTextAt(`TEAM UP x${+e.mul.toFixed(2)}`, 80, 118, 'gold');
        else if (e.p === me) this.bounceSource(e.src, e.mul === 0 ? 'NO DAMAGE' : e.mul === 0.5 ? 'HALF DAMAGE' : 'x' + (+e.mul.toFixed(2)) + ' DMG', e.mul >= 1 ? 'dmg' : 'gray');
        Sound.playSE(e.mul >= 1 ? 'se_m_belly_drum' : 'se_m_stat_decrease');
        shake(e.mul >= 1.5 ? 3 : 1);
        await this.wait(0.35);
        break;
      case 'relic': if (e.p === me) this.bounceSource(e.key, e.text, 'gold'); await this.wait(0.2); break;
      case 'total': {
        if (this.pendingAnim && (e.p ?? this.me) === this.pendingAnim.p) this.pendingAnim.scored = true; // (plays as the next event comes up)
        if (this.score) { this.score.total = e.damage; this.score.base = e.base; this.score.bonus = e.bonus; this.score.times = e.times; this.score.pulseT = 2; }
        const f = this.foes[this.slotOfRi(e.ei, e.slot) ?? 0];
        Sound.playSE(f && e.damage > f.maxHp ? 'se_m_hyper_beam' : 'se_m_mega_kick');
        if (f && e.damage >= f.hp) { shake(5); doFlash('#ffffff', 0.4); }
        await this.wait(0.5);
        break;
      }
      case 'damage': {
        if (e.side === 'enemy') {
          const slot = this.slotOfRi(e.ei, e.slot);
          const f = slot === null ? null : this.foes[slot];
          if (f) {
            f.flash = 1; f.shake = 1;
            tween(f, { hp: e.hp }, 0.5 * this.speed);
            const [cx, cy] = this.foeCenter(slot);
            floatText('-' + e.amount.toLocaleString(), cx, cy - 30, { color: e.eff === 'super' ? 'red' : 'white', scale: e.src === 'hand' ? 2 : 1 });
          }
          if (e.src === 'hand') Sound.playSE(e.eff === 'super' ? 'se_super_effective' : e.eff === 'weak' ? 'se_not_effective' : 'se_effective');
          await this.wait(e.src === 'hand' ? 0.5 : 0.3);
        } else {
          const p = e.p ?? me;
          const L = this.leads[p];
          if (L && L.uid === e.uid) { L.flash = 1; if (p === me) shake(e.amount > (e.maxHp / 3) ? 4 : 2); }
          this.tweenPartyHp(p, e.uid, e.hp, e.amount);
          const [cx, cy] = this.leadCenter(p);
          floatText('-' + e.amount, cx, cy, { color: 'red' });
          Sound.playSE(e.eff === 'super' ? 'se_super_effective' : e.eff === 'weak' ? 'se_not_effective' : 'se_effective');
          await this.wait(0.4);
        }
        break;
      }
      case 'heal':
        if (e.side === 'enemy') { const slot = this.slotOfRi(e.ei, e.slot); const f = slot === null ? null : this.foes[slot]; if (f) tween(f, { hp: e.hp }, 0.4 * this.speed); }
        else {
          const p = e.p ?? me;
          const uid = e.uid ?? this.leads[p]?.uid;
          if (uid !== undefined) this.partyHp[p][uid] = e.hp;
          const [cx, cy] = this.leadCenter(p);
          floatText('+' + e.amount, cx, cy, { color: 'green' });
        }
        Sound.playSE('se_use_item');
        await this.wait(0.22);
        break;
      case 'faint':
        Sound.playCry(e.species, { mode: 'faint' });
        Sound.playSE('se_faint');
        if (e.side === 'enemy') {
          const slot = this.slotOfRi(e.ei, e.slot);
          const f = slot === null ? null : this.foes[slot];
          if (f) { f.hp = 0; tween(f, { faint: 1 }, 0.5 * this.speed); }
          await this.wait(0.6);
        } else {
          const p = e.p ?? me;
          const L = this.leads[p];
          if (L && L.uid === e.uid) tween(L, { faint: 1 }, 0.8 * this.speed);
          this.partyHp[p][e.uid] = 0;
          if (p === me) { shake(4); doFlash('#ff2020', 0.35); }
          const [cx, cy] = this.leadCenter(p);
          floatText(`${speciesName(e.species)} FAINTED!`, cx + 40, cy - 10, { color: 'red', scale: p === me ? 2 : 1, life: 1.6 });
          await this.wait(p === me ? 1.1 : 0.7);
        }
        break;
      case 'status':
        Sound.playSE(e.status ? { PSN: 'se_m_toxic', TOX: 'se_m_toxic', BRN: 'se_m_ember', PAR: 'se_m_thunder_wave', SLP: 'se_m_sing', FRZ: 'se_m_icy_wind' }[e.status] || 'se_m_stat_decrease' : 'se_m_heal_bell');
        await this.wait(0.12);
        break;
      case 'statusAnim': await this.wait(0.08); break;
      case 'stage': Sound.playSE(e.delta > 0 ? 'se_m_stat_increase' : 'se_m_stat_decrease'); await this.wait(0.1); break;
      case 'enemyMove': {
        this.clearPlayed();
        const slot = this.slotOfRi(e.ei, e.slot);
        const f = slot === null ? null : this.foes[slot];
        const tp = Number.isInteger(e.p) && e.p >= 0 && e.p < this.n ? e.p : null;
        if (slot !== null && tp !== null && await this.playCoopAnim(e.move, tp, slot, 1)) break;
        if (f) { f.lunge = 1; tween(f, { lunge: 0 }, 0.3 * this.speed); }
        if (slot !== null && tp !== null) this.arrows.push({ slot, p: tp, t: 0.9 });
        Sound.playSE(TYPE_SFX[e.type] || 'se_m_comet_punch');
        await this.wait(0.25);
        break;
      }
      case 'weather': Sound.playSE(e.weather === 'RAIN' ? 'se_m_rain_dance' : e.weather === 'SAND' ? 'se_m_sandstorm' : e.weather === 'HAIL' ? 'se_m_hail' : 'se_m_morning_sun'); await this.wait(0.2); break;
      case 'ball': await this.animateBall(e); break;
      case 'item': Sound.playSE('se_use_item'); if (e.from !== undefined && e.from !== e.p) floatText(`${this.s.nameOf(e.from)} used ${D.items[e.key]?.name || 'an item'}!`, ...this.leadCenter(e.p), { color: 'green', font: 'small', life: 1.4 }); await this.wait(0.2); break;
      case 'partyUpdate': { const p = e.p ?? me; for (const m of this.run(p).party) this.partyHp[p][m.uid] = m.hp; break; }
      case 'down':
        if (e.p === me) { Sound.playSE('se_faint'); doFlash('#ff2020', 0.25); }
        if (this.leads[e.p]) this.leads[e.p].faint = 1;
        break;
      case 'revive': case 'rejoin': {
        const mon = this.run(e.p).party.find(m => m.uid === e.uid);
        if (mon) { this.partyHp[e.p][e.uid] = e.hp ?? mon.hp; this.leads[e.p] = { uid: e.uid, species: mon.species, shiny: mon.shiny, x: -60, flash: 0, faint: 0 }; tween(this.leads[e.p], { x: 0 }, 0.35 * this.speed, Ease.outBack); }
        Sound.playSE('se_m_heal_bell');
        if (e.t === 'revive') floatText(e.p === me ? 'YOU ARE BACK!' : `${this.s.nameOf(e.p)} IS BACK!`, ...this.leadCenter(e.p), { color: 'green', font: 'small', life: 1.5 });
        await this.wait(0.3);
        break;
      }
      case 'duoEnd': {
        this.clearPlayed();
        if (e.outcome === 'win') {
          const song = this.cfg.kind === 'boss' ? 'mus_victory_gym_leader' : this.cfg.kind === 'wild' ? 'mus_victory_wild' : 'mus_victory_trainer';
          Sound.playBGM(song);
          if (this.isTrainer()) { this.trainerX = 140; tween(this, { trainerX: 0 }, 0.5); }
          const sub = this.sub;
          const you = this.many ? 'Your team' : `You and ${this.s.nameOf(this.pa)}`;
          await this.say(sub.caught ? `${speciesName(sub.caught.species)} joins your team!` : this.isTrainer() ? `${you} defeated ${this.cfg.trainer?.title || 'the foes'}!` : `${you} won the battle!`);
        } else {
          Sound.fadeOutBGM?.(60);
          await this.say(this.many ? 'Every team is out of usable POKéMON... You blacked out!' : 'Both teams are out of usable POKéMON... You blacked out!');
        }
        break;
      }
      case 'end': if (e.p === me) this.clearPlayed(); break;
      case 'away': if (this.leads[e.p]) { if (e.away) tween(this.leads[e.p], { faint: 1 }, 0.4 * this.speed); else this.leads[e.p].faint = 0; } break;
    }
  }

  clearPlayed() {
    for (const id of this.playedIds) { const v = this.vis.get(this.vk(id, this.playedBy)); if (v) v.state = 'discard'; }
    this.playedIds = []; this.scoringIds = null;
  }

  tweenPartyHp(p, uid, to, amount) {
    const map = this.partyHp[p];
    const o = { v: map[uid] ?? to + amount };
    map[uid] = o.v;
    tween(o, { v: to }, 0.45 * this.speed).then(() => { map[uid] = to; });
    const step = () => { if (map[uid] !== to) { map[uid] = o.v; if (o.v !== to) requestAnimationFrame(step); } };
    step();
  }

  async animateBall(e) {
    Sound.playSE('se_ball_throw');
    const slot = this.slotOfRi(e.ei, e.slot) ?? 0;
    const [tx, ty] = this.foeCenter(slot);
    const [sx, sy] = this.leadCenter(e.p ?? this.me);
    const ballImg = ballSprite(e.ball);
    this.ballAnim = { img: ballImg, x: sx, y: sy, show: true };
    await tween(this.ballAnim, { x: tx - 12, y: ty - 30 }, 0.5 * this.speed, Ease.outQuad);
    Sound.playSE('se_ball_open');
    const f = this.foes[slot];
    if (f) f.captured = 1;
    await this.wait(0.3);
    this.ballAnim.y = ty + 10;
    Sound.playSE('se_ball_bounce_1');
    await this.wait(0.35);
    for (let i = 0; i < e.shakes; i++) { this.ballAnim.wiggle = 1; Sound.playSE('se_ball'); await tween(this.ballAnim, { wiggle: 0 }, 0.35 * this.speed); await this.wait(0.3); }
    if (e.caught) {
      Sound.playSE('se_ball_click');
      burst(this.ballAnim.x + 8, this.ballAnim.y, { color: ['#f8f8f8', '#f8d038'], n: 14, speed: 50, grav: 50 });
      await this.wait(0.8);
    } else {
      Sound.playSE('se_ball_open');
      if (f) f.captured = 0;
      this.ballAnim = null;
      await this.wait(0.2);
    }
  }

  bounceSource(src, label, color) {
    if (!src) return;
    const run = this.run();
    const i = run.relics.findIndex(r => r.key === src);
    if (i >= 0) {
      this.relicBounce[src] = 0.01;
      tween(this.relicBounce, { [src]: 1 }, 0.35 * this.speed).then(() => { delete this.relicBounce[src]; });
      if (label) floatTextAt(label, this.relicX(i) + 12, 34, color);
    } else if (label) floatTextAt(`${String(src).replace(/_/g, ' ')}${BADGES[src] ? ' BADGE' : ''}: ${label}`, 80, 118, color);
  }
  relicX(i) {
    const run = this.run();
    const x0 = 112 + Math.max(52, measure('$' + run.money.toLocaleString()) + 8) + 42 + run.maxConsumables * 27 + 6;
    const n = run.relics.length;
    const step = n ? Math.max(7, Math.min(26, (W - 174 - x0 - 24) / Math.max(1, n - 1))) : 26;
    return x0 + i * step;
  }

  findCard(id, p = this.me) { return this.duo.subs[p].findCardAny(id); }

  // ---- hand / targets ---------------------------------------------------------------------------
  syncHand() {
    const d = this.duo;
    if (!d || d.down[this.me]) { this.handIds = []; this.sel = []; return; }
    const ids = this.sub.deck.hand.map(c => c.id);
    for (const id of ids) if (!this.vis.has(id)) this.vis.set(id, { x: 600, y: H + 10, lift: 0, alpha: 1 });
    const keep = this.handIds.filter(id => ids.includes(id));
    this.handIds = [...keep, ...ids.filter(id => !keep.includes(id))];
    this.sel = this.sel.filter(id => ids.includes(id));
  }

  liveSlots() { const d = this.duo; return [0, 1].filter(sl => d.field[sl] !== null && d.field[sl] !== undefined && !d.gone[d.field[sl]]); }

  // The slot I'm aiming at: the foe I picked while it's still out, else the default pick.
  // (Until I click a foe, the default is re-picked every turn; a foe I clicked stays my target while it's out.)
  get target() {
    const d = this.duo;
    const live = this.liveSlots();
    if (!live.length) return 0;
    const key = d.turn + '|' + d.field.join(',');
    if (!this.targetManual && this.targetKey !== key && !this.busy) { this.targetKey = key; this.targetRi = null; }
    if (this.targetRi !== null) { const s = d.field.indexOf(this.targetRi); if (s >= 0 && live.includes(s)) return s; }
    this.targetManual = false;
    const t = this.defaultTarget();
    this.targetRi = d.field[t];
    return t;
  }
  setTarget(slot) {
    const ri = this.duo.field[slot];
    if (ri === null || ri === undefined || this.duo.gone[ri]) return;
    this.targetManual = true;
    if (this.targetRi !== ri) { this.targetRi = ri; Sound.playSE('se_select'); }
  }

  // Like the co-op bot: the foe where my best hand does the most (a KO first), a bit more for the one
  // attacking me, and not a foe my partner's locked hand already knocks out.
  defaultTarget() {
    const d = this.duo, live = this.liveSlots();
    if (live.length <= 1) return live[0] ?? 0;
    if (!this.canSimulate()) return live[0];
    let best = live[0], bv = -Infinity;
    for (const slot of live) {
      const e = d.enemyAt(slot);
      const h = this.bestHand(slot);
      const dmg = h ? (d.simulate(this.me, h, slot)?.damage || 0) : 0;
      let v = e.hp > 0 && dmg >= e.hp ? 10 : dmg / Math.max(1, e.hp);
      if (d.intentsOf(slot).some(it => it.target === this.me && it.damage)) v += 0.15;
      if (d.locks.some((L, q) => q !== this.me && L && L.ids && d.normSlot(L.target) === slot)) {
        const pd = d.lockedDamageOn(this.me, slot);
        if (pd >= e.hp) v -= 20; else v += 0.1; // finish it together (TEAM UP)
      }
      if (v > bv) { bv = v; best = slot; }
    }
    return best;
  }

  // simulate() is only safe while my side is still in the fight (it reads/restores the sub's result).
  canSimulate() { const d = this.duo; return !!d && !d.result && !d.down[this.me] && this.g.phase === 'battle'; }

  info(card, target = this.target) { return this.duo.cardInfo(this.me, card, target); }

  anyLegalPlay() {
    if (!this.canSimulate()) return false;
    const s = this.sub, slot = this.target, ri = this.duo.field[slot];
    return s.withFocus(ri, () => {
      const ids = s.deck.hand.filter(c => s.cardInfo(c).playable).map(c => c.id);
      for (let mask = 1; mask < (1 << ids.length); mask++) {
        const pick = ids.filter((_, i) => mask & (1 << i));
        if (pick.length <= s.maxPlay && s.canPlay(pick).ok) return true;
      }
      return false;
    });
  }

  canPlay(ids) {
    const s = this.sub, ri = this.duo.field[this.target];
    return s.withFocus(ri, () => s.canPlay(ids));
  }

  bestHand(slot = this.target) {
    if (!this.canSimulate()) return null;
    const d = this.duo, s = this.sub, e = d.enemyAt(slot);
    if (!e) return null;
    const key = [d.turn, s.handsPlayed, s.leadUid, s.deck.hand.map(c => c.id).join(','), slot, d.field[slot], e.hp, JSON.stringify(d.locks.filter((L, q) => q !== this.me))].join('|');
    this._hint ||= {};
    if (key in this._hint) return this._hint[key];
    const ri = d.field[slot];
    const ids = s.withFocus(ri, () => s.deck.hand.filter(c => !c.faceDown && s.cardInfo(c).playable).map(c => c.id));
    let best = null, bv = -1;
    for (let mask = 1; mask < (1 << ids.length); mask++) {
      const pick = ids.filter((_, i) => mask & (1 << i));
      if (pick.length > s.maxPlay || !s.withFocus(ri, () => s.canPlay(pick).ok)) continue;
      const dmg = d.simulate(this.me, pick, slot)?.damage || 0;
      const v = dmg >= e.hp ? 1e9 - pick.length : dmg;
      if (v > bv) { bv = v; best = pick; }
    }
    if (Object.keys(this._hint).length > 40) this._hint = {};
    return (this._hint[key] = best && bv > 0 ? best : null);
  }

  previewSim() {
    if (!this.sel.length || !this.canSimulate() || this.busy) return null;
    const d = this.duo, s = this.sub, slot = this.target, ri = d.field[slot];
    const e = d.enemyAt(slot);
    const key = [this.sel.join(','), slot, ri, e?.hp || 0, s.withFocus(ri, () => s.previewKey()), JSON.stringify(d.locks.filter((L, q) => q !== this.me))].join('|');
    if (this._simKey !== key) {
      this._simKey = key;
      this._sim = d.simulate(this.me, this.sel, slot);
      this._prev = s.withFocus(ri, () => s.preview(this.sel));
      this._teamUp = d.teamUpPreview(this.me, ri);
    }
    return this._prev ? { ...this._prev, sim: this._sim, teamUp: this._teamUp } : null;
  }

  // Busy while animating, and while applied actions wait in the session's feed (not drained yet this frame).
  get busy() { return this.running || this.q.length > 0 || !!this.s.battleFeed?.some(f => f.battle === this.duo); }

  canAct() { return !this.busy && this.canChoose(); }
  // For a choice confirmed in a modal that opened while I could act. The scene doesn't update under a modal,
  // so the partner's actions that land meanwhile wait in the feed (busy) without making my choice illegal:
  // send it anyway (the log decides; a stale one comes back refused with a toast). Gating these on canAct()
  // dropped them silently whenever the partner locked in while the modal was open.
  canChoose() {
    const d = this.duo, g = this.g;
    return !!d && !this.posting && !this.finishing && g.phase === 'battle' && g.battle === d && !d.result && !d.down[this.me] && !d.locks[this.me] && !this.s.desync && !this.s.stopped;
  }

  toggle(id) {
    if (!this.canAct()) return;
    const card = this.sub.deck.hand.find(c => c.id === id);
    if (!card) return;
    const i = this.sel.indexOf(id);
    const info = this.info(card);
    if (i < 0 && !info.playable) { this.toast = { text: `That card can't be played (${info.reason}).`, t: 1.6 }; Sound.playSE('se_failure'); return; }
    if (i >= 0) { this.sel.splice(i, 1); Sound.playSE('se_card_flip'); }
    else if (this.sel.length < this.sub.maxPlay) { this.sel.push(id); Sound.playSE('se_select'); }
    else Sound.playSE('se_failure');
  }

  doLock() {
    if (!this.canAct() || !this.sel.length) return;
    const chk = this.canPlay(this.sel);
    if (!chk.ok) { this.toast = { text: chk.reason, t: 2 }; Sound.playSE('se_failure'); return; }
    const ids = this.handIds.filter(id => this.sel.includes(id)); // played order = my visual order
    if (ids.length !== this.sel.length) { this.syncHand(); return; }
    if (this.post({ type: 'lock', ids, target: this.target })) Sound.playSE('se_select');
  }
  doDiscard() {
    if (!this.canAct() || !this.sel.length) return;
    const s = this.sub;
    if (!this.canDiscard(this.sel.length)) { this.toast = { text: s.discardsLeft <= 0 && s.freeDiscardOk(1) ? `Only ${DECK_RULES.freeDiscard} cards for the free discard!` : 'No discards left!', t: 2 }; Sound.playSE('se_failure'); return; }
    const ids = this.handIds.filter(id => this.sel.includes(id));
    if (ids.length) this.post({ type: 'discard', ids });
  }
  // Same rule as solo: a discard left, this turn's free discard (up to DECK_RULES.freeDiscard cards), or ACRO BIKE.
  canDiscard(n) { const s = this.sub; return n > 0 && (s.discardsLeft > 0 || s.freeDiscardOk(n) || s.acroOk(n)); }
  doPass() {
    if (!this.canAct() || !this.stuck) return;
    this.sel = [];
    this.post({ type: 'lock', pass: true });
  }
  // UNLOCK: take back my lock-in while the turn hasn't resolved (my partner hasn't locked in too). The
  // unlock goes through the action log like everything else; if my partner's lock lands first, the turn
  // resolves and the unlock is refused (log order decides).
  canUnlock() {
    const d = this.duo, g = this.g;
    return !!d && !!d.locks[this.me] && !this.busy && !this.posting && !this.finishing && g.phase === 'battle' && g.battle === d && !d.result && !d.down[this.me] && !this.s.desync && !this.s.stopped;
  }
  doUnlock() {
    if (!this.canUnlock()) return;
    const L = this.duo.locks[this.me];
    this.unlockSel = L.ids ? L.ids.slice() : null;
    if (this.post({ type: 'unlock', turn: this.duo.turn })) Sound.playSE('se_select');
  }

  // ---- update -----------------------------------------------------------------------------------
  syncLowHpAlarm() {
    const d = this.duo;
    const lead = d && !d.down[this.me] ? this.sub.lead() : null;
    const hp = lead ? (this.partyHp[this.me][lead.uid] ?? lead.hp) : 0;
    const want = !d?.result && lead && hp > 0 && hp / maxHp(lead) < 0.25 && !this.finishing;
    if (want && !this.lowHpOn) { Sound.playSE('se_low_health'); this.lowHpOn = true; this.lowHpAt = Engine.time; }
    else if (!want && this.lowHpOn) { Sound.stopSE('se_low_health'); this.lowHpOn = false; }
    // the SE loops every 0.6s: let it beep three times, then go quiet until the lead leaves the red
    else if (this.lowHpOn && this.lowHpAt != null && Engine.time - this.lowHpAt > 1.75) { Sound.stopSE('se_low_health'); this.lowHpAt = null; }
  }

  update(dt) {
    MoveAnims.tick(dt);
    this.t += dt;
    if (!this.duo) { if (!this.finishing) { this.finishing = true; this.s.route(); } return; }
    pileInput(this);
    pollSkip(this);
    this.drainFeed();
    if (!this.running && !this.q.length && (this.duo.result || this.g.phase !== 'battle') && !this.finishing) this.idle();
    this.syncLowHpAlarm();
    this.msg.update(dt, this.fast);
    if (this.posting && Engine.time - this.posting.at > 12) { this.posting = null; }
    if (this.score) { this.score.pulse = approach(this.score.pulse || 1, 1, 8, dt); this.score.pulseB = approach(this.score.pulseB || 1, 1, 8, dt); this.score.pulseT = approach(this.score.pulseT || 1, 1, 6, dt); }
    for (const f of this.foes) if (f) { f.flash = Math.max(0, (f.flash || 0) - dt * 4); f.shake = Math.max(0, (f.shake || 0) - dt * 3); }
    for (const L of this.leads) if (L) L.flash = Math.max(0, (L.flash || 0) - dt * 4);
    for (const a of this.arrows) a.t -= dt;
    this.arrows = this.arrows.filter(a => a.t > 0);
    if (this.bossBanner) this.bossBanner.a = Math.max(0, this.bossBanner.a - dt * 0.15);
    // cards: drag only changes MY visual order
    const n = this.handIds.length;
    this.dragSuppress = false;
    const dr = this.drag;
    if (dr && !Engine.mouse.down) { this.dragSuppress = dr.moved; this.drag = null; }
    else if (dr) {
      if (Math.abs(Engine.mouse.x - dr.x0) > 6) dr.moved = true;
      const from = this.handIds.indexOf(dr.id);
      if (dr.moved && from >= 0) {
        let to = from, best = Infinity;
        for (let i = 0; i < n; i++) { const dd = Math.abs(this.handPos(i, n)[0] + CARD_W / 2 - Engine.mouse.x); if (dd < best) { best = dd; to = i; } }
        if (to !== from) { this.handIds.splice(from, 1); this.handIds.splice(to, 0, dr.id); }
      }
    }
    const lockedIds = this.duo.locks[this.me]?.ids || [];
    this.handIds.forEach((id, i) => {
      const v = this.vis.get(id);
      if (!v) return;
      if (this.drag?.moved && this.drag.id === id) { v.x = Engine.mouse.x - CARD_W / 2; v.y = HAND_Y - 12; v.dim = false; return; }
      const [tx, ty] = this.handPos(i, n);
      const lift = lockedIds.length ? (lockedIds.includes(id) ? -4 : 0) : this.sel.includes(id) ? -16 : (this.hoverId === id ? -5 : 0);
      const tuck = this.playedIds.length ? 74 : 0; // (my hand slides down under a hand being resolved)
      v.x = approach(v.x, tx, 14, dt); v.y = approach(v.y, ty + lift + tuck, 14, dt);
      v.dim = false;
    });
    this.playedIds.forEach((id) => {
      const v = this.vis.get(this.vk(id, this.playedBy)); if (!v) return;
      const [tx, ty] = this.playedPos(id);
      v.x = approach(v.x, tx, 12, dt); v.y = approach(v.y, ty - (v.lift || 0), 12, dt);
    });
    for (const [k, v] of this.vis) {
      const inHand = typeof k === 'number' && this.handIds.includes(k);
      const inPlay = this.playedIds.some(id => this.vk(id, this.playedBy) === k);
      if (v.state === 'discard' && !inHand && !inPlay) {
        v.x = approach(v.x, W + 40, 8, dt); v.y = approach(v.y, HAND_Y, 8, dt);
        if (v.x > W + 20) this.vis.delete(k);
      } else if (!inHand && !inPlay && typeof k !== 'number') this.vis.delete(k);
      v.flash = Math.max(0, (v.flash || 0) - dt * 3);
    }
    if (this.canUnlock() && (keyPressed('Enter') || keyPressed('a') || keyPressed('A') || keyPressed('Escape') || keyPressed('u') || keyPressed('U'))) { this.doUnlock(); return; }
    if (!this.canAct()) return;
    if (keyPressed('Enter') || keyPressed('a') || keyPressed('A')) { if (this.stuck && !this.sel.length) this.doPass(); else this.doLock(); }
    if (keyPressed('d') || keyPressed('D')) this.doDiscard();
    if (keyPressed('Tab')) { const live = this.liveSlots(); if (live.length > 1) this.setTarget(live[(live.indexOf(this.target) + 1) % live.length]); }
    for (let k = 1; k <= 9; k++) if (keyPressed(String(k)) && this.handIds[k - 1] !== undefined) this.toggle(this.handIds[k - 1]);
  }

  // the hand being resolved (any player's): full-size cards below the battle scene, labelled with whose hand it is
  drawPlayed(ctx) {
    const me = this.me;
    for (const id of this.playedIds) {
      const v = this.vis.get(this.vk(id, this.playedBy)); const card = this.findCard(id, this.playedBy);
      if (!v || !card) continue;
      const info = this.duo.cardInfo(this.playedBy, card, this.playedTarget);
      const cx = Math.round(v.x), cy = Math.round(v.y);
      ctx.save(); ctx.imageSmoothingEnabled = false;
      drawCard(ctx, info, cx, cy, { ignorePlayable: true, highlight: this.scoringIds?.includes(id) && !v.dim, dmgOverride: this.playedDmg?.[id] });
      if (v.dim) { ctx.globalAlpha = 0.5; rect(ctx, cx, cy, CARD_W, CARD_H, '#000'); }
      ctx.restore();
    }
    if (this.playedIds.length && this.playedBy !== null) {
      const [x0, y0] = this.playedPos(this.playedIds[0]);
      const lbl = this.playedBy === me ? 'YOUR HAND' : `${this.s.nameOf(this.playedBy)}'S HAND`;
      pixBox(ctx, Math.round(x0), y0 - 13, measure(lbl, 'small') + 10, 12, PCOL[this.playedBy], '#101018', 2);
      text(ctx, lbl, Math.round(x0) + 5, y0 - 13, { color: 'white', font: 'small' });
    }
  }

  // ---- layout -----------------------------------------------------------------------------------
  handPos(i, n) {
    const area = 404, x0 = 164;
    const step = Math.min(CARD_W + 4, (area - CARD_W) / Math.max(1, n - 1));
    const total = step * (n - 1) + CARD_W;
    const x = x0 + (area - total) / 2 + i * step;
    const arc = n > 1 ? Math.pow((i - (n - 1) / 2) / ((n - 1) / 2 || 1), 2) * 6 : 0;
    return [x, HAND_Y + arc];
  }
  playedPos(id) {
    const i = this.playedIds.indexOf(id);
    const n = this.playedIds.length;
    if (i < 0) { const v = this.vis.get(id); return v ? [v.x, v.y] : [400, 150]; }
    // Below the battle scene (the animation stays visible), with the "X'S HAND" label just above the row.
    return playedRowPos(i, n, PLAYED_Y);
  }

  // ---- drawing ----------------------------------------------------------------------------------
  draw(ctx) {
    const s = this.s, g = this.g, me = this.me;
    const run = g.runs[me];
    G.run = run;
    const cfg = this.cfg;
    const bossy = cfg.kind === 'boss' || cfg.kind === 'elite';
    swirlBackground(ctx, bossy ? BG_THEMES.boss : cfg.terrain === 'cave' ? BG_THEMES.cave : cfg.terrain === 'water' ? BG_THEMES.water : BG_THEMES.grass, bossy ? 1.2 : 0.7);
    if (!this.duo) { drawCoopOverlay(ctx, s); return; }
    this.drawScene(ctx);
    this.drawLeftPanel(ctx);
    this.drawHand(ctx);
    this.drawPlayed(ctx);
    const title = cfg.trainers ? cfg.trainers.map(t => t.title).join(' & ') : cfg.trainer ? cfg.trainer.title : (cfg.legend || cfg.areaName || 'WILD BATTLE');
    drawHUD(ctx, run, { bounce: this.relicBounce, onDeck: () => pushOverlay(new DeckModal({ title: 'YOUR DECKS', battle: this.sub })), onConsumableClick: (k) => this.useConsumable(k), noToss: true, subtitle: (this.many ? 'TEAM · ' : 'DUO · ') + title });
    drawFx(ctx, Engine.dt);
    drawFlash(ctx, Engine.dt, W, H);
    if (this.toast) {
      this.toast.t -= Engine.dt;
      if (this.toast.t <= 0) this.toast = null;
      else { const w = measure(this.toast.text) + 20; pixBox(ctx, Math.round((W - w) / 2 + 80), 236, w, 20, this.toast.info ? '#2a2410' : '#401010', this.toast.info ? '#d8a020' : '#ff6060', 3); text(ctx, this.toast.text, W / 2 + 80, 239, { align: 'center', color: 'white' }); }
    }
    drawTips(ctx);
    drawCoopOverlay(ctx, s);
  }

  drawScene(ctx) {
    const d = this.duo, me = this.me, pa = this.pa;
    ctx.save();
    pixBox(ctx, SCENE_X - 2, SCENE_Y + 2, SCENE_W + 2, SCENE_H, '#000', null, 3);
    ctx.beginPath(); ctx.rect(SCENE_X, SCENE_Y + 4, SCENE_W - 2, SCENE_H - 4); ctx.clip();
    const animOn = MoveAnims.active && this.animInv, inv = this.animInv;
    const toff = animOn ? MoveAnims.terrainOffset() : { x: 0, y: 0 };
    for (const wx of toff.x ? [-480, 0, 480] : [0]) for (const wy of toff.y ? [-224, 0, 224] : [0]) draw(ctx, terrainImage(this.cfg), SCENE_X - 1 + toff.x * 2 + wx, SCENE_Y + 4 - 24 + toff.y * 2 + wy, { sx: 0, sy: 0, sw: 240, sh: 112, scale: 2 });
    if (animOn) MoveAnims.drawBg(ctx, SCENE_X, SCENE_Y - 20, 2, SCENE_W, SCENE_H + 24);
    const tod = { morn: ['#f8a060', 0.1], nite: ['#0c1040', 0.32] }[this.cfg.timeOfDay]; // JOHTO day / night
    if (tod) { ctx.save(); ctx.globalAlpha = tod[1]; rect(ctx, SCENE_X, SCENE_Y, SCENE_W, SCENE_H, tod[0]); ctx.restore(); }
    if (d.weather) { ctx.save(); ctx.globalAlpha = 0.18; rect(ctx, SCENE_X, SCENE_Y, SCENE_W, SCENE_H, { SUN: '#ffd060', RAIN: '#3050a0', SAND: '#c0a060', HAIL: '#e0f0ff' }[d.weather]); ctx.restore(); }
    // trainer pics (tag battles: both trainers)
    const pics = (this.cfg.trainers || (this.cfg.trainer ? [this.cfg.trainer] : [])).filter(t => t?.pic);
    // (2x like the POKéMON: a 1.5x resample mangled the pixel art)
    if (this.isTrainer() && this.trainerX < 140) pics.forEach((t, i) => { const [tx, ty] = pics.length > 1 ? this.foePos(i) : [SCENE_X + 300, SCENE_Y + 2]; drawTrainer(ctx, t.pic, tx + this.trainerX, ty, { scale: 2, alpha: 1 - this.trainerX / 140, minTop: SCENE_Y + 8 }); });
    const target = d.locks[me] && !d.locks[me].pass ? d.locks[me].target : this.canAct() ? this.target : null;
    const hot = this.hotFoe();
    // foes
    for (let slot = 0; slot < 2; slot++) {
      const f = this.foes[slot];
      if (!f || f.alpha <= 0 || f.faint >= 1 || f.captured) continue;
      if (animOn && inv.slot === slot) continue; // (drawn by the animation layer)
      const [px, py] = this.foePos(slot);
      const x = Math.round(px + f.x * 2 + (f.shake > 0 ? Math.sin(this.t * 60) * 3 * f.shake : 0) - (f.lunge || 0) * 12);
      const y = Math.round(py + f.faint * 50 + Math.sin(this.t * 2 + slot) * 1.5);
      ctx.save(); ctx.beginPath(); ctx.rect(SCENE_X, SCENE_Y, SCENE_W, 124); ctx.clip();
      drawMon(ctx, f.species, x, y, { scale: MON_S, shiny: f.shiny, flash: f.flash > 0 && Math.floor(this.t * 20) % 2 ? 0.9 : 0, alpha: (1 - f.faint) * f.alpha });
      ctx.restore();
      const e = d.enemies[f.ri];
      if (e?.status) draw(ctx, `gfx/ui/status/${e.status === 'TOX' ? 'psn' : e.status.toLowerCase()}.png`, px + 48, py + 112);
    }
    // targeting marks: my target (gold arrow), my partner's locked target (their colour)
    for (let slot = 0; slot < 2; slot++) {
      const f = this.foes[slot];
      if (!f || f.faint >= 1 || f.captured) continue;
      const [px, py] = this.foePos(slot);
      // (every other player's locked target: one tag each)
      let k = 0;
      for (const o of this.s.others) {
        const PL = d.locks[o];
        if (!PL || !(PL.ids || PL.ball) || d.normSlot(PL.target) !== slot || d.result) continue;
        // (a column of tags, clear of the TARGET arrow)
        const tx = px + (this.many ? 22 : 16); // (clear of the wider 3-4 player intent box)
        pixBox(ctx, tx, py + 18 + k * 13, 22, 12, PCOL[o], '#101018', 2);
        text(ctx, `P${o + 1}`, tx + 11, py + 18 + k * 13, { align: 'center', color: 'white', font: 'small' });
        k++;
      }
      if (slot === target || (hot === slot && this.canAct())) {
        const bob = Math.sin(this.t * 6) * 2;
        const ax = px + 64, ay = Math.round(py + 26 + bob);
        ctx.save(); ctx.globalAlpha = slot === target ? 1 : 0.5;
        ctx.fillStyle = slot === target ? '#f8d038' : '#ffffff';
        ctx.beginPath(); ctx.moveTo(ax - 7, ay); ctx.lineTo(ax + 7, ay); ctx.lineTo(ax, ay + 8); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = '#302000'; ctx.lineWidth = 1; ctx.stroke();
        ctx.restore();
        if (slot === target) text(ctx, d.locks[me] ? 'LOCKED' : 'TARGET', ax, ay - 11, { align: 'center', color: 'gold', font: 'small' });
      }
    }
    if (this.ballAnim?.img) {
      const w = this.ballAnim.wiggle ? Math.sin(this.ballAnim.wiggle * Math.PI * 4) * 3 : 0;
      draw(ctx, this.ballAnim.img, this.ballAnim.x + w - 4, this.ballAnim.y - 4, { sx: 0, sy: 0, sw: 16, sh: 16, scale: 2 });
    }
    // player leads: back sprites, mine on the left (further back), my partner's a step right and nearer (drawn last)
    // (3-4 players: the partners' small sprites first, mine last)
    const drawOrder = this.many ? [...this.s.others, me] : [me, pa];
    for (const p of drawOrder) {
      const L = this.leads[p];
      if (!L || L.faint >= 1) continue;
      if (animOn && inv.p === p) continue; // (drawn by the animation layer)
      const [lx0, ly0] = this.leadPos(p), sc = this.leadScale(p);
      const lx = Math.round(lx0 + L.x * sc), ly = Math.round(ly0 + L.faint * 25 * sc);
      drawMon(ctx, L.species, lx, ly, { back: true, scale: sc, shiny: L.shiny, flash: L.flash > 0 && Math.floor(this.t * 20) % 2 ? 0.9 : 0, alpha: 1 - L.faint });
    }
    if (animOn) {
      ctx.save(); ctx.beginPath(); ctx.rect(SCENE_X, SCENE_Y, SCENE_W, SCENE_H); ctx.clip();
      MoveAnims.drawLayer(ctx, SCENE_X, SCENE_Y - 20, 2, { drawMon: (c, b, o) => this.drawCoopAnimMon(c, b, o) });
      ctx.restore();
    }
    // healthboxes + intents
    for (let slot = 0; slot < 2; slot++) this.drawFoeBox(ctx, slot, slot === target, hot === slot);
    this.drawFoeParty(ctx);
    for (let slot = 0; slot < 2; slot++) if (!this.playedIds.length) { if (this.many) this.drawIntentsN(ctx, slot); else this.drawIntent(ctx, slot); }
    if (this.many) for (const p of this.order) this.drawMiniBox(ctx, p, ...this.leadBox(p));
    else { this.drawPlayerBox(ctx, me, ...LEAD_BOX.me); this.drawPlayerBox(ctx, pa, ...LEAD_BOX.partner); }
    // attack arrows (foe -> the player it hits)
    for (const a of this.arrows) {
      const [fx, fy] = this.foeCenter(a.slot), [tx, ty] = this.leadCenter(a.p);
      ctx.save(); ctx.globalAlpha = Math.min(1, a.t * 2); ctx.strokeStyle = PCOL[a.p]; ctx.lineWidth = 3; ctx.setLineDash([6, 4]);
      ctx.beginPath(); ctx.moveTo(fx, fy); ctx.lineTo(tx, ty); ctx.stroke(); ctx.restore();
    }
    // (played cards: drawPlayed, after the hand)
    // boss banner
    if (this.bossBanner && this.bossBanner.a > 0.05 && d.bossRule) {
      ctx.save(); ctx.globalAlpha = Math.min(1, this.bossBanner.a * 2);
      pixBox(ctx, SCENE_X + 290, SCENE_Y + 104, 180, 14, '#5a1018', '#f8d038', 3);
      text(ctx, d.bossRule.name, SCENE_X + 380, SCENE_Y + 104, { align: 'center', color: 'gold', font: 'small' });
      ctx.restore();
    }
    this.msg.draw(ctx, ...MSG_BOX, 'battle');
    ctx.restore();
    // hover / click: foes (sprite or healthbox) pick the target
    if (hot !== null) {
      const e = d.enemyAt(hot);
      if (e) this.enemyTooltip(e);
      if (Engine.mouse.clicked && this.canAct()) this.setTarget(hot);
    }
    for (const p of this.order) {
      const [bx, by, bw, bh] = this.leadBox(p);
      const l = this.duo.subs[p].lead();
      if (l && hover(bx, by, bw, bh)) monTooltip(l, bx - 206, by - 40);
    }
  }

  // Which foe slot the mouse is over (sprite or healthbox/intent row), or null.
  hotFoe() {
    for (let slot = 0; slot < 2; slot++) {
      const f = this.foes[slot];
      if (!f || f.faint >= 1 || f.captured) continue;
      const [px, py] = this.foePos(slot);
      const [bx, by] = FOE_BOX[slot];
      if (inRect(px + 20, py + 16, 88, 104) || inRect(bx, by, FOE_BOX_W, FOE_BOX_H)) { Engine.hoverAny = true; return slot; }
    }
    return null;
  }

  drawFoeBox(ctx, slot, isTarget, isHot) {
    const f = this.foes[slot];
    if (!f || f.captured || f.faint >= 1) return;
    const d = this.duo, e = d.enemies[f.ri];
    const [x, y] = FOE_BOX[slot];
    pixBox(ctx, x, y, FOE_BOX_W, FOE_BOX_H, isTarget ? '#fff8c8' : isHot ? '#f0f0e0' : '#f8f8d8', isTarget ? '#d8a020' : '#405050', 4);
    textFit(ctx, speciesName(f.species) + (f.shiny ? ' ★' : ''), x + 7, y + 2, e?.status ? 80 : 104, { color: 'dark' });
    if (e?.status) draw(ctx, `gfx/ui/status/${e.status === 'TOX' ? 'psn' : e.status.toLowerCase()}.png`, x + 90, y + 4);
    text(ctx, 'Lv' + (f.level || e?.level), x + FOE_BOX_W - 6, y + 2, { align: 'right', color: 'dark' });
    text(ctx, 'HP', x + 7, y + 19, { color: 'orange', font: 'small' });
    hpBar(ctx, x + 22, y + 22, FOE_BOX_W - 30, f.hp / Math.max(1, f.maxHp), 4);
    text(ctx, `${Math.max(0, Math.round(f.hp)).toLocaleString()}/${f.maxHp.toLocaleString()}`, x + FOE_BOX_W - 6, y + 26, { align: 'right', color: 'dark', font: 'small' });
    // stat stages (shared foe side)
    const st = d.enemySides[f.ri]?.stages || {};
    let sx = x + 7;
    for (const k of ['atk', 'def', 'spa', 'spd', 'spe']) if (st[k]) { const s = `${k.toUpperCase()}${st[k] > 0 ? '+' : ''}${st[k]}`; text(ctx, s, sx, y + 27, { color: st[k] > 0 ? 'red' : 'blue', font: 'small' }); sx += measure(s, 'small') + 3; }
    // (trainers' party balls: drawFoeParty, under both healthboxes)
    if (isTarget) { pixBox(ctx, x - 3, y + 12, 6, 12, '#f8d038', '#302000', 1); }
  }

  // Trainers' party balls (FireRed style, as in solo): every POKéMON each trainer brings, fainted ones greyed. One strip
  // right under the foe healthboxes, right-aligned to them: clear of the healthboxes, the intents and the player
  // sprites at 2, 3 and 4 players. (They used to sit on the healthboxes' bottom edge, hidden under the second box.)
  drawFoeParty(ctx) {
    if (!this.isTrainer()) return;
    const d = this.duo;
    const queues = d.cfg?.queues || [d.enemies.map((_, i) => i)];
    const groups = queues.map((q, i) => ({ q: q.filter(ri => d.enemies[ri]), who: ((t) => t?.title || t?.name)(this.cfg.trainers?.[i] || this.cfg.trainer) || 'FOE' })).filter(g => g.q.length);
    if (!groups.length) return;
    const total = groups.reduce((a, g) => a + g.q.length, 0);
    const step = total > 12 ? 7 : 9, GAP = 7;
    const w = 6 + total * step + (groups.length - 1) * GAP + (9 - step), h = 12;
    const x = FOE_BOX[0][0] + FOE_BOX_W - w, y = FOE_BOX[1][1] + FOE_BOX_H + 3;
    pixBox(ctx, x, y, w, h, '#283848', '#101820', 2);
    let bx = x + 3;
    groups.forEach((g, gi) => {
      if (gi) { rect(ctx, bx + Math.floor((GAP - step + 8) / 2), y + 2, 1, h - 4, '#607080'); bx += GAP; }
      for (const ri of g.q) { draw(ctx, `gfx/ui/battle/${d.enemies[ri].hp <= 0 ? 'ball_fainted' : 'ball_ok'}.png`, bx, y + 2); bx += step; }
    });
    if (hover(x, y, w, h)) tip('FOE TEAM', groups.map(g => { const left = g.q.filter(ri => d.enemies[ri].hp > 0).length; return `${g.who}: ${left} of ${g.q.length} POKéMON left`; }).join('\n'), { width: 190 });
  }

  drawIntent(ctx, slot) {
    const d = this.duo, f = this.foes[slot];
    if (!f || f.faint >= 1 || f.captured || d.result) return;
    const it = d.intents[slot];
    if (!it || it.ri !== f.ri) return;
    const x = INTENT_X, [, y] = FOE_BOX[slot], w = INTENT_W, h = FOE_BOX_H;
    const en = d.enemies[it.ri];
    const tp = it.target;
    const tname = tp === this.me ? 'YOU' : this.s.nameOf(tp).slice(0, 8);
    pixBox(ctx, x, y, w, h, '#101018d8', it.kind === 'attack' ? '#ff6060' : it.kind === 'buff' ? '#60a0ff' : '#c080ff', 3);
    text(ctx, it.first ? 'FIRST!' : 'INTENT', x + 4, y + 1, { color: it.first ? 'red' : 'gray', font: 'small' });
    // -> target player
    const tw = measure('-> ' + tname, 'small') + 6;
    pixBox(ctx, x + w - tw - 3, y + 2, tw, 11, PCOL[tp] || '#606060', null, 2);
    text(ctx, '-> ' + tname, x + w - 6, y + 1, { align: 'right', color: 'white', font: 'small' });
    const sleeping = en && (en.status === 'SLP' || en.status === 'FRZ');
    const hidden = this.g.ascension >= 2 || this.run().ascension >= 2;
    if (sleeping) {
      text(ctx, en.status === 'SLP' ? 'ASLEEP' : 'FROZEN', x + 4, y + 14, { color: 'blue', font: 'small' });
      if (!hidden) textFit(ctx, 'then ' + it.move.name, x + 4, y + 25, w - 8, { color: 'gray', font: 'small' });
    } else if (hidden) {
      text(ctx, '???', x + 4, y + 16, { color: 'white' });
      text(ctx, 'hidden (A2)', x + w - 5, y + 25, { align: 'right', color: 'gray', font: 'small' });
    } else {
      textFit(ctx, it.move.name, x + 4, y + 14, w - 10, { color: 'white', font: 'small' });
      if (it.kind === 'attack') {
        rect(ctx, x + 4, y + 28, 6, 6, TYPE_COLORS[it.move.type] || '#888');
        text(ctx, it.text, x + w - 5, y + 24, { align: 'right', color: 'red', font: 'small' });
        if (it.eff !== 1) text(ctx, it.eff === 0 ? 'x0' : 'x' + it.eff, x + 14, y + 24, { color: it.eff > 1 ? 'red' : 'gray', font: 'small' });
        if (it.lethal && Math.floor(Engine.time * 3) % 2 === 0) { pixBox(ctx, x + 36, y + 24, 22, 11, '#c01818', null, 2); text(ctx, 'KO!', x + 47, y + 23, { align: 'center', color: 'white', font: 'small' }); }
      } else text(ctx, it.text, x + w - 5, y + 24, { align: 'right', color: it.kind === 'buff' ? 'blue' : 'purple', font: 'small' });
    }
    if (it.lethal && !sleeping && Math.floor(Engine.time * 3) % 2 === 0) { ctx.save(); ctx.strokeStyle = '#ff3030'; ctx.lineWidth = 2; ctx.strokeRect(x - 1, y - 1, w + 2, h + 2); ctx.restore(); }
    if (hover(x, y, w, h)) {
      const lead = d.subs[tp]?.lead();
      const who = tp === this.me ? 'your' : `${this.s.nameOf(tp)}'s`;
      const mv = it.move;
      tip(hidden ? 'INTENT HIDDEN' : mv.name, `${hidden ? "Ascension 2+: you can't see the foe's move." : `${mv.type} · PWR ${mv.power || '-'} · ACC ${mv.accuracy || '-'}\n${mv.desc || ''}`}\nTargets ${who} ${lead ? monName(lead) : 'lead'}${!hidden && it.kind === 'attack' ? `: ${it.text} HP${it.eff !== 1 ? ` (x${it.eff})` : ''}${it.lethal ? ' — could KO it!' : ''}` : '.'}\n${it.first ? 'This foe is faster: it acts BEFORE the hands resolve.' : 'Your hands resolve first (unless priority).'}`, { width: 210 });
    }
  }

  // 3-4 players: every action of the foe in this slot (up to two), one 19 px row each: target, move, damage.
  drawIntentsN(ctx, slot) {
    const d = this.duo, f = this.foes[slot];
    if (!f || f.faint >= 1 || f.captured || d.result) return;
    const its = d.intentsOf(slot).filter(it => it.ri === f.ri);
    if (!its.length) return;
    const x = INTENT_X, [, y] = FOE_BOX[slot], w = INTENT_W_N, rh = 19;
    const en = d.enemies[f.ri];
    const sleeping = en && (en.status === 'SLP' || en.status === 'FRZ');
    const hidden = this.g.ascension >= 2 || this.run().ascension >= 2;
    pixBox(ctx, x, y, w, rh * its.length, '#101018d8', its.some(it => it.lethal && it.target === this.me) ? '#ff3030' : '#ff6060', 3);
    its.forEach((it, k) => {
      const ry = y + k * rh, tp = it.target;
      const tag = tp === this.me ? 'YOU' : `P${tp + 1}`;
      const tw = measure(tag, 'small') + 6;
      pixBox(ctx, x + 3, ry + 3, tw, 12, PCOL[tp] || '#606060', null, 2);
      text(ctx, tag, x + 3 + tw / 2, ry + 3, { align: 'center', color: 'white', font: 'small' });
      const mx = x + tw + 6;
      if (sleeping && k === 0) text(ctx, en.status === 'SLP' ? 'ASLEEP' : 'FROZEN', mx, ry + 3, { color: 'blue', font: 'small' });
      else if (hidden) text(ctx, '???', mx, ry + 3, { color: 'white', font: 'small' });
      else {
        const dmg = it.kind === 'attack' ? it.text : it.kind === 'buff' ? 'buff' : 'status';
        const dw = measure(dmg, 'small');
        textFit(ctx, it.move.name, mx, ry + 3, w - tw - dw - 14, { color: 'white', font: 'small' });
        text(ctx, dmg, x + w - 4, ry + 3, { align: 'right', color: it.kind === 'attack' ? (it.lethal && Math.floor(Engine.time * 3) % 2 === 0 ? 'gold' : 'red') : 'purple', font: 'small' });
      }
      if (hover(x, ry, w, rh)) {
        const lead = d.subs[tp]?.lead();
        const who = tp === this.me ? 'your' : `${this.s.nameOf(tp)}'s`;
        const mv = it.move;
        tip(hidden ? 'INTENT HIDDEN' : mv.name, `${hidden ? "Ascension 2+: you can't see the foe's move." : `${mv.type} · PWR ${mv.power || '-'} · ACC ${mv.accuracy || '-'}\n${mv.desc || ''}`}\nTargets ${who} ${lead ? monName(lead) : 'lead'}${!hidden && it.kind === 'attack' ? `: ${it.text} HP${it.eff !== 1 ? ` (x${it.eff})` : ''}${it.lethal ? ' — could KO it!' : ''}` : '.'}\n${its.length > 1 ? `With ${this.n} players this foe acts ${its.length} times this turn. ` : ''}${it.first ? 'It is faster: it acts BEFORE the hands resolve.' : 'Your hands resolve first (unless priority).'}`, { width: 220 });
      }
    });
  }

  // 3-4 players: one status row per player: seat tag, "NAME·LEAD" (partners), HP bar, and a fixed badge slot on the
  // right (LOCKED / PASS / DOWN / OFF, or a "..." while that player is still choosing), so the bar is never covered.
  drawMiniBox(ctx, p, x, y, w, h) {
    const d = this.duo, sub = d.subs[p];
    const L = this.leads[p];
    const lead = (L && sub.run.party.find(m => m.uid === L.uid)) || sub.lead();
    const down = d.down[p], away = d.away?.[p] || this.g.away?.[p];
    pixBox(ctx, x, y, w, h, down || away ? '#c8c0b8' : '#f8f8d8', p === this.me ? '#f8d038' : PCOL[p], 3);
    pixBox(ctx, x + 2, y + 2, 24, h - 4, PCOL[p], null, 2);
    text(ctx, p === this.me ? 'YOU' : `P${p + 1}`, x + 14, y + 3, { align: 'center', color: 'white', font: 'small' });
    if (!lead) return;
    const BW = 38, HW = 34; // badge slot, HP bar
    const hp = this.partyHp[p][lead.uid] ?? lead.hp;
    const hx = x + w - BW - HW - 4;
    const label = p === this.me ? monName(lead) : `${this.s.nameOf(p).slice(0, 6)}·${monName(lead)}`;
    const st = lead.status ? 22 : 0;
    textFit(ctx, label, x + 29, y + 3, hx - x - 31 - st, { color: 'dark', font: 'small' });
    if (st) draw(ctx, `gfx/ui/status/${lead.status === 'TOX' ? 'psn' : lead.status.toLowerCase()}.png`, hx - st, y + 4);
    hpBar(ctx, hx, y + 7, HW, down ? 0 : hp / maxHp(lead), 4);
    const bx = x + w - BW - 2;
    const badge = away ? 'OFF' : down ? 'DOWN' : d.result ? null : d.locks[p] ? (d.locks[p].pass ? 'PASS' : 'LOCKED') : null;
    if (badge) {
      pixBox(ctx, bx, y + 2, BW, h - 4, away ? '#505868' : down ? '#801818' : '#2a8a40', null, 2);
      text(ctx, badge, bx + BW / 2, y + 3, { align: 'center', color: 'white', font: 'small' });
    } else if (!d.result && !this.busy) text(ctx, '.'.repeat(1 + Math.floor(this.t * 2 + p) % 3), bx + 6, y + 3, { color: 'gray', font: 'small' });
  }

  drawPlayerBox(ctx, p, x, y) {
    const d = this.duo, sub = d.subs[p];
    const L = this.leads[p];
    const lead = (L && sub.run.party.find(m => m.uid === L.uid)) || sub.lead();
    const w = LEAD_BOX_W, h = LEAD_BOX_H;
    const down = d.down[p];
    pixBox(ctx, x, y, w, h, down ? '#c8c0b8' : '#f8f8d8', PCOL[p], 4);
    pixBox(ctx, x + 3, y + 3, 26, 12, PCOL[p], null, 2);
    text(ctx, p === this.me ? 'YOU' : `P${p + 1}`, x + 16, y + 3, { align: 'center', color: 'white', font: 'small' });
    if (!lead) return;
    const hp = this.partyHp[p][lead.uid] ?? lead.hp;
    textFit(ctx, (p === this.me ? '' : this.s.nameOf(p).slice(0, 6) + ': ') + monName(lead), x + 33, y + 2, lead.status ? w - 88 : w - 70, { color: 'dark', font: p === this.me ? undefined : 'small' });
    text(ctx, 'Lv' + lead.level, x + w - 6, y + 2, { align: 'right', color: 'dark', font: 'small' });
    if (lead.status) draw(ctx, `gfx/ui/status/${lead.status === 'TOX' ? 'psn' : lead.status.toLowerCase()}.png`, x + w - 56, y + 4);
    text(ctx, 'HP', x + 7, y + 18, { color: 'orange', font: 'small' });
    hpBar(ctx, x + 22, y + 21, w - 84, hp / maxHp(lead), 4);
    text(ctx, `${Math.max(0, Math.round(hp))}/${maxHp(lead)}`, x + w - 6, y + 18, { align: 'right', color: 'dark', font: 'small' });
    const st = sub.sides.player.stages;
    let sx = x + 4;
    for (const k of ['atk', 'def', 'spa', 'spd', 'spe']) if (st[k]) { const s = `${k.toUpperCase()}${st[k] > 0 ? '+' : ''}${st[k]}`; text(ctx, s, sx, y - 11, { color: st[k] > 0 ? 'red' : 'blue', font: 'small' }); sx += measure(s, 'small') + 3; }
    if (down) {
      pixBox(ctx, x + w / 2 - 26, y + 9, 52, 16, '#801818', '#ff6060', 3);
      text(ctx, 'DOWN', x + w / 2, y + 11, { align: 'center', color: 'white', font: 'small' });
    } else if (d.locks[p] && !d.result) {
      pixBox(ctx, x + w - 52, y - 9, 50, 11, '#2a8a40', null, 2);
      text(ctx, d.locks[p].pass ? 'PASS' : 'LOCKED', x + w - 27, y - 10, { align: 'center', color: 'white', font: 'small' });
    }
  }

  enemyTooltip(e) {
    const st = e.stats;
    const ab = e.ability ? (D.abilities[e.ability]?.name || e.ability) : '';
    const rule = e.bossRule && BOSS_RULES[e.bossRule] ? `\n\n${BOSS_RULES[e.bossRule].name}: ${BOSS_RULES[e.bossRule].desc}` : '';
    const coopHp = e.coopHp && e.coopHp !== 1 ? `\nCO-OP: x${e.coopHp} HP (your hands deal full damage)` : '';
    const all = Object.keys(TYPE_COLORS).filter(t => D.types.chart[t]);
    const by = f => all.filter(t => f(typeEffect(t, e.types)));
    const weak4 = by(x => x >= 4), weak = by(x => x === 2), res = by(x => x > 0 && x < 1), imm = by(x => x === 0);
    const matchup = `\n\nWEAK TO: ${[...weak4.map(t => t + ' x4'), ...weak].join(', ') || 'nothing'}\nRESISTS: ${res.join(', ') || 'nothing'}${imm.length ? `\nIMMUNE TO: ${imm.join(', ')}` : ''}`;
    tip(`${speciesName(e.species)}  Lv${e.level}`, `${e.types.join('/')}  ·  ${ab}${ab && D.abilities[e.ability] ? ': ' + D.abilities[e.ability].desc : ''}\nATK ${st.atk} DEF ${st.def} SPA ${st.spa} SPD ${st.spd} SPE ${st.spe}${coopHp}\nMoves: ${this.run().ascension >= 2 ? '??? (hidden at A2+)' : e.moves.map(m => D.moves[m]?.name).join(', ')}${matchup}${rule}${this.canAct() ? '\n\nClick to target it.' : ''}`, { width: 230, accent: TYPE_COLORS[e.types[0]] });
  }

  drawLeftPanel(ctx) {
    const d = this.duo, me = this.me, run = this.run(), sub = this.sub;
    const x = 4, w = 152;
    panel(ctx, x, 31, w, 96);
    const sc = this.score;
    const prev = sc ? null : this.previewSim();
    const name = sc ? sc.name : prev ? prev.name : '';
    const lvl = sc ? sc.level : prev ? prev.level : 0;
    if (sc && sc.p !== me) { pixBox(ctx, x + 4, 33, w - 8, 11, PCOL[sc.p], null, 2); text(ctx, `${this.s.nameOf(sc.p)}'s hand`, x + w / 2, 32, { align: 'center', color: 'white', font: 'small' }); }
    if (name) {
      text(ctx, name, x + w / 2, sc && sc.p !== me ? 44 : 35, { align: 'center', color: 'white', font: sc && sc.p !== me ? 'small' : undefined });
      if (lvl > 1) text(ctx, 'lvl ' + lvl, x + w - 6, 37, { align: 'right', color: 'gold', font: 'small' });
    } else text(ctx, d.down[me] ? 'Your team is down' : d.locks[me] ? 'Locked in' : 'Select cards', x + w / 2, 35, { align: 'center', color: 'gray', font: 'small' });
    const base = sc ? Math.round(sc.base) : prev?.sim ? prev.sim.base : 0;
    const bonus = sc ? sc.bonus : prev ? (prev.sim ? prev.sim.bonus : prev.bonus) : 0;
    const times = sc ? sc.times : prev?.sim ? prev.sim.times : 1;
    const tgt = d.enemyAt(this.target);
    const foeHp = tgt?.hp || 0;
    if (name && !(sc && sc.p !== me)) text(ctx, bonus ? `+${Math.round(bonus)}% damage` : 'no bonus', x + w / 2, 47, { align: 'center', color: (sc?.pulseB || 1) > 1.3 ? 'white' : bonus ? 'bonus' : 'gray', font: 'small' });
    let dmg = null, final = false;
    if (sc?.total !== null && sc?.total !== undefined) { dmg = sc.total; final = true; }
    else if (sc) dmg = Math.floor(base * (1 + bonus / 100) * times);
    else if (prev && !this.busy) dmg = prev.sim ? prev.sim.damage : 0;
    const kills = dmg !== null && dmg > 0 && dmg >= (sc ? sc.foeHp : foeHp);
    pixBox(ctx, x + 10, 60, w - 20, 30, dmg ? THEME.dmg : '#3a4052', shade(dmg ? THEME.dmg : '#3a4052', -0.45), 3);
    text(ctx, 'DMG', x + 16, 62, { color: dmg ? 'white' : 'gray', font: 'small' });
    const pulse = (sc?.pulseT || sc?.pulse || 1) > 1.3;
    text(ctx, dmg === null ? '-' : fmt(dmg), x + w / 2 + 8, 66 - (pulse ? 5 : 0), { align: 'center', color: kills ? 'gold' : 'white', scale: pulse || final ? 2 : 1 });
    if (name && dmg !== null) text(ctx, `${fmt(base)} from cards${bonus ? ` +${Math.round(bonus)}%` : ''}${times !== 1 ? ` x${+(+times).toFixed(2)}` : ''}`, x + w / 2, 94, { align: 'center', color: 'whiteSoft', font: 'small' });
    if (!sc && prev && !this.busy) {
      const tn = tgt ? speciesName(tgt.species) : 'foe';
      text(ctx, dmg ? `${tn} HP ${fmt(foeHp)}${kills ? '  KO!' : ''}` : 'no damage', x + w / 2, 106, { align: 'center', color: kills ? 'gold' : 'gray', font: 'small' });
      if (prev.teamUp) { pixBox(ctx, x + 18, 114, w - 36, 11, '#806010', null, 2); text(ctx, `TEAM UP +${teamUpPct()}% incl.`, x + w / 2, 113, { align: 'center', color: 'white', font: 'small' }); }
      else text(ctx, 'before crits & misses', x + w / 2, 116, { align: 'center', color: 'gray', font: 'small' });
      if (hover(x, 31, w, 96)) tip(prev.name, COMBOS[prev.key].desc + `\nCombo lvl ${prev.level}: +${prev.bonus}% damage.\nAgainst ${tn} (your TARGET). ${fmt(base)} x ${(1 + bonus / 100).toFixed(2)}${times !== 1 ? ` x ${+(+times).toFixed(2)}` : ''} = ${fmt(dmg || 0)}.${prev.teamUp ? `\nTEAM UP: ${this.many ? 'another' : 'your partner\'s'} locked hand hits it first, so yours deals +${teamUpPct()}%.` : `\nTEAM UP: the second hand to hit the same foe in a turn deals +${teamUpPct()}%.`} (Assumes no crits or misses.)`, { width: 210 });
    } else if (!name) {
      const o = this.s.others.find(q => d.locks[q]?.ids);
      const PL = o !== undefined ? d.locks[o] : null;
      const hint = PL?.ids && !d.result ? `${this.s.nameOf(o)} aims at ${speciesName(d.enemyAt(d.normSlot(PL.target) ?? 0)?.species || '')}` : 'Pick cards to see the damage';
      textFit(ctx, hint, x + 6, 106, w - 12, { color: PL?.ids ? PFONT[o] : 'gray', font: 'small' });
    }
    // battle info
    panel(ctx, x, 130, w, 52);
    text(ctx, 'DISCARDS', x + 8, 134, { color: 'gray', font: 'small' });
    text(ctx, String(sub.discardsLeft), x + 8, 145, { color: 'red' });
    text(ctx, 'TURN', x + w / 2, 134, { align: 'center', color: 'gray', font: 'small' });
    text(ctx, String(d.turn), x + w / 2, 145, { align: 'center', color: 'white' });
    text(ctx, 'DECK', x + w - 8, 134, { align: 'right', color: 'gray', font: 'small' });
    text(ctx, `${sub.deck.draw.length}/${sub.deckSize()}`, x + w - 8, 145, { align: 'right', color: 'white' });
    if (DECK_RULES.freeDiscard) {
      const ready = sub.freeDiscardOk(1);
      text(ctx, ready ? `FREE DISCARD READY (${DECK_RULES.freeDiscard})` : 'free discard used', x + w / 2, 158, { align: 'center', color: ready ? 'gold' : 'gray', font: 'small' });
      text(ctx, `Play up to ${sub.maxPlay} · Hand ${sub.handSize}`, x + w / 2, 169, { align: 'center', color: 'gray', font: 'small' });
      if (hover(x, 130, w, 52)) tip('DISCARDS', `Once per turn you may discard up to ${DECK_RULES.freeDiscard} cards for free. Bigger discards, a second discard in the same turn, and switching your lead use up one of your discards (${sub.discardsLeft} left this battle).
DECK: cards left in the draw pile / cards in your lead's deck.`, { width: 200 });
    } else text(ctx, `Play up to ${sub.maxPlay} · Hand ${sub.handSize}`, x + w / 2, 164, { align: 'center', color: 'gray', font: 'small' });
    // party
    const leadUid = sub.leadUid;
    panel(ctx, x, 185, w, Math.max(60, run.party.length * 24 + 8));
    const clickedMon = drawPartyPanel(ctx, run, x + 4, 189, w - 8, { rowH: 24, leadUid, dispHp: this.partyHp[me], tipX: 160 });
    if (clickedMon && this.canAct() && clickedMon.uid !== leadUid && !isFainted(clickedMon)) this.askSwitch(clickedMon);
    // catch (wild only, at my target)
    const by = Math.min(H - 26, 189 + run.party.length * 24 + 10);
    if (this.cfg.kind === 'wild' && !d.result) {
      const bw = 92;
      const en = tgt;
      const weak = en && (en.hp < en.maxHp * 0.5 || en.status === 'SLP' || en.status === 'FRZ' || (D.species[en.species]?.catchRate || 0) >= 190);
      const ball = Object.keys(run.balls).find(k => run.balls[k] > 0);
      const can = this.canAct() && !!ball && weak && !sub.caught && !en?.isBoss;
      const pct = can ? Math.round(d.catchChance(me, ball, this.target) * 100) : 0;
      if (button(ctx, can ? `BALL ${pct}%` : 'BALL', x, by, bw, 22, { color: '#d04040', font: 'small', disabled: !can })) this.chooseBall();
      if (en && hover(x, by, bw, 22)) tip('CATCH', sub.caught ? 'You already caught one this battle.' : !ball ? 'You have no POKé BALLS.' : !weak ? `Weaken ${speciesName(en.species)} below 50% HP (or put it to sleep) first.` : `Throw at your TARGET ${speciesName(en.species)}: about ${Math.round(d.catchChance(me, ball, this.target) * 100)}% with ${D.items[ball]?.name}. Throwing is your action this turn (locks you in).`);
    }
  }

  drawHand(ctx) {
    const d = this.duo, me = this.me, sub = this.sub;
    const down = d.down[me];
    const locked = d.locks[me];
    const act = this.canAct();
    // partner status chip + lead HP
    this.partnerStripR = 0;
    if (!this.many) this.drawPartnerStatus(ctx, 164, HAND_Y - 31);
    if (down && !d.result) {
      pixBox(ctx, 164, HAND_Y - 10, 470, 70, '#3a1018', '#ff6060', 4);
      text(ctx, this.many ? 'Your team fainted — cheer on your partners!' : 'Your team fainted — cheer on your partner!', 399, HAND_Y + 4, { align: 'center', color: 'white' });
      text(ctx, this.many ? "You'll be revived if your partners win this battle." : `You'll be revived if ${this.s.nameOf(this.pa)} wins this battle.`, 399, HAND_Y + 24, { align: 'center', color: 'gold', font: 'small' });
      text(ctx, '(a partner can also bring you back with a REVIVE)', 399, HAND_Y + 38, { align: 'center', color: 'gray', font: 'small' });
      this.pileOpen = false; // (no draw pile on screen)
      return;
    }
    drawCardBack(ctx, PILE_X, PILE_Y, { count: sub.deck.draw.length });
    drawPileTip(this, sub.deck, sub.mods.peek); // (my own pile only)
    // buttons
    const can = act && this.sel.length > 0;
    if (!this.stuck && !locked && button(ctx, 'HINT', W - 196, HAND_Y - 32, 42, 26, { color: '#6a5a90', font: 'small', disabled: !act })) { const h = this.bestHand(); if (h) { this.sel = h.slice(); Sound.playSE('se_select'); } else this.toast = { text: 'No damaging hand vs this target: discard, switch or retarget.', t: 2 }; }
    if (locked && !d.result) {
      if (button(ctx, 'UNLOCK', W - 150, HAND_Y - 32, 72, 26, { color: '#b06a20', disabled: !this.canUnlock() })) this.doUnlock();
      if (hover(W - 150, HAND_Y - 32, 72, 26)) tip('UNLOCK', `Take back your lock-in and change your hand or target. Works until ${this.many ? 'everyone has locked in' : this.s.nameOf(this.pa) + ' locks in too'} (then the turn resolves). Enter / U / Esc.`);
    } else if (this.stuck && act) { if (button(ctx, 'PASS', W - 150, HAND_Y - 32, 72, 26, { color: THEME.play })) this.doPass(); }
    else {
      if (button(ctx, 'LOCK IN', W - 150, HAND_Y - 32, 72, 26, { color: THEME.play, disabled: !can })) this.doLock();
      if (hover(W - 150, HAND_Y - 32, 72, 26)) tip('LOCK IN', `Locks your selected cards against your TARGET. The turn resolves once ${this.many ? 'everyone still fighting is' : 'both of you are'} locked in (or down). You can UNLOCK until then. Enter / A.`);
    }
    const freeNow = this.sel.length > 0 && (sub.freeDiscardOk(this.sel.length) || sub.acroOk(this.sel.length));
    if (button(ctx, freeNow ? 'FREE DISCARD' : 'DISCARD', W - 74, HAND_Y - 32, 70, 26, { color: THEME.discard, disabled: !can || !this.canDiscard(this.sel.length), font: 'small' })) this.doDiscard();
    // cards
    this.hoverId = null;
    const ids = this.handIds;
    const lockedIds = locked?.ids || [];
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      const v = this.vis.get(id); const card = sub.deck.hand.find(c => c.id === id);
      if (!v || !card) continue;
      if (act && inRect(v.x, v.y, i === ids.length - 1 ? CARD_W : Math.min(CARD_W, this.handPos(i + 1, ids.length)[0] - this.handPos(i, ids.length)[0]), CARD_H + 20)) this.hoverId = id;
    }
    const prev = act ? this.previewSim() : null;
    const shockId = d.bossRule?.key === 'LT_SURGE' ? ids.find(id => this.sel.includes(id)) : null;
    const target = this.target;
    for (const id of ids) {
      const v = this.vis.get(id); const card = sub.deck.hand.find(c => c.id === id);
      if (!v || !card) continue;
      const info = this.canSimulate() ? this.info(card, locked?.target ?? target) : sub.cardInfo(card);
      const isLocked = lockedIds.includes(id);
      drawCard(ctx, info, v.x, v.y, { selected: this.sel.includes(id) || isLocked, animate: this.hoverId === id });
      if (locked && !isLocked) { ctx.save(); ctx.globalAlpha = 0.45; rect(ctx, v.x, v.y, CARD_W, CARD_H, '#000'); ctx.restore(); }
      if (isLocked) { pixBox(ctx, v.x + 6, v.y - 9, CARD_W - 12, 11, '#2a8a40', '#103010', 2); text(ctx, 'LOCKED', v.x + CARD_W / 2, v.y - 10, { align: 'center', color: 'white', font: 'small' }); }
      if (prev && this.sel.includes(id) && !info.status && !prev.scoring.includes(id)) { ctx.save(); ctx.globalAlpha = 0.45; rect(ctx, v.x, v.y, CARD_W, CARD_H, '#000'); ctx.restore(); text(ctx, "won't score", v.x + CARD_W / 2, v.y + 40, { align: 'center', color: 'white', font: 'small' }); }
      if (id === shockId) { ctx.save(); ctx.globalAlpha = 0.45; rect(ctx, v.x, v.y, CARD_W, CARD_H, '#f8e030'); ctx.restore(); text(ctx, 'SHOCKED', v.x + CARD_W / 2, v.y + 52, { align: 'center', color: 'black', font: 'small' }); }
      if (card.frozen) { ctx.save(); ctx.globalAlpha = 0.35; rect(ctx, v.x, v.y, CARD_W, CARD_H, '#a0e0ff'); ctx.restore(); }
    }
    const showHint = act && !this.sel.length && !this.msg.active && (G.meta.hintBattles || 0) < 3;
    const hint = showHint ? this.bestHand() : null;
    if (hint) {
      const pulse = 0.5 + 0.5 * Math.sin(Engine.time * 5);
      for (const id of hint) { const v = this.vis.get(id); if (v) { ctx.save(); ctx.globalAlpha = 0.5 + pulse * 0.5; ctx.strokeStyle = '#f8d038'; ctx.lineWidth = 2; ctx.strokeRect(Math.round(v.x) - 2, Math.round(v.y) - 2, CARD_W + 4, CARD_H + 4); ctx.restore(); } }
    }
    for (const [k, v] of this.vis) {
      if (typeof k !== 'number' || v.state !== 'discard' || ids.includes(k) || (this.playedBy === me && this.playedIds.includes(k))) continue;
      const card = this.findCard(k); if (!card) continue;
      ctx.save(); ctx.globalAlpha = 0.7; drawCard(ctx, sub.cardInfo(card), v.x, v.y, { ignorePlayable: true }); ctx.restore();
    }
    if (this.hoverId) {
      const card = sub.deck.hand.find(c => c.id === this.hoverId);
      const v = this.vis.get(this.hoverId);
      if (card && !card.faceDown) cardTooltip(this.info(card), Math.min(286, Math.max(162, v.x - 60)), HAND_Y - 22, true);
      if (Engine.mouse.justPressed) this.drag = { id: this.hoverId, x0: Engine.mouse.x, moved: false };
      if (Engine.mouse.clicked && !this.dragSuppress) this.toggle(this.hoverId);
      if (Engine.mouse.rclicked) this.sel = [];
    }
    // status line above the hand
    let line = null, shortLine = null, col = 'gray';
    if (d.result || this.finishing) line = null;
    else if (this.posting) { line = this.posting.type === 'unlock' ? 'Unlocking...' : 'Sending...'; col = 'whiteSoft'; }
    else if (locked) {
      const wait = this.s.others.filter(q => !d.locks[q] && !d.out(q));
      line = (this.many ? `WAITING FOR ${wait.map(q => 'P' + (q + 1)).join(', ')}` : `WAITING FOR ${this.s.nameOf(this.pa).toUpperCase()}`) + '...'.slice(0, 1 + Math.floor(this.t * 2) % 3); col = 'gold';
    }
    else if (act && this.handIds.length && !this.sel.length && !this.msg.active) {
      const live = this.liveSlots();
      line = this.stuck ? 'No playable cards · discard, switch or PASS' : hint ? 'Suggested hand outlined in gold · HINT selects it' : live.length > 1 ? 'Click a foe to target it (Tab) · pick cards · LOCK IN' : '1-5 select · Enter lock in · D discard · drag to reorder';
      shortLine = this.stuck ? 'Discard, switch or PASS' : hint ? 'Gold = suggested hand' : live.length > 1 ? 'Click a foe to target' : '1-5 select · Enter';
      col = hint ? 'gold' : 'gray';
    }
    if (line) {
      // centred in the free strip between the left panel and the HINT / LOCK IN / DISCARD buttons (x 444+), never under them
      const L = Math.max(160, (this.partnerStripR || 0) + 6), R = W - 202, cx = Math.round((L + R) / 2), maxW = R - L - 16;
      if (shortLine && measure(line, 'small') > maxW) line = shortLine;
      while (line.length > 1 && measure(line, 'small') > maxW) line = line.slice(0, -1);
      const boxed = locked && !this.posting;
      if (boxed) { const w = measure(line, 'small') + 16; pixBox(ctx, Math.round(cx - w / 2), HAND_Y - 31, w, 14, '#2a2410', '#d8a020', 3); }
      text(ctx, line, cx, HAND_Y - 30 + (boxed ? 1 : 4), { align: 'center', color: col, font: 'small' });
    }
  }

  drawPartnerStatus(ctx, x, y) {
    const s = this.s, d = this.duo, pa = this.pa;
    const st = playerStatus(s, pa);
    const w = drawPartnerChip(ctx, x, y, s, { compact: true });
    this.partnerStripR = x + w + 2; // the hint line starts right of this strip
    const l = d.subs[pa].lead();
    if (!l || st.key === 'offline') return;
    const hp = this.partyHp[pa][l.uid] ?? l.hp;
    const bw = 44;
    this.partnerStripR = x + w + bw + 10;
    pixBox(ctx, x + w + 2, y, bw + 6, 14, '#141a26', '#2c3446', 3);
    hpBar(ctx, x + w + 5, y + 5, bw, d.down[pa] ? 0 : hp / maxHp(l), 4);
    if (hover(x, y, w + bw + 8, 14)) tip(`${s.nameOf(pa)} · ${st.label}`, `${d.down[pa] ? 'Their team fainted. Win the battle to revive them (or use a REVIVE on them from your bag).' : `Lead ${monName(l)} ${Math.round(hp)}/${maxHp(l)} HP.`}\n${st.key === 'ready' ? 'They have locked in: the turn resolves when you lock in too.' : st.key === 'choosing' ? 'Still picking their cards.' : ''}`, { width: 200 });
  }

  // ---- side actions -----------------------------------------------------------------------------
  chooseAfterFaint() {
    const sub = this.sub;
    const key = `${this.duo.turn}:${sub.leadUid}:${sub.faintCount || 0}`;
    if (this.faintAskedKey === key) return;
    this.faintAskedKey = key;
    pushOverlay(new PartyPicker({
      title: 'Who goes out next?', cancelable: false,
      filter: m => isFainted(m) ? 'Fainted' : true,
      sub: m => m.uid === sub.leadUid ? 'Out now (keep)' : 'Send out (free)',
      onClose: (mon) => {
        if (!mon || mon.uid === sub.leadUid || !sub.faintSwitch || !this.canChoose()) return;
        this.post({ type: 'switch', uid: mon.uid });
      },
    }));
  }

  askSwitch(mon) {
    const sub = this.sub;
    const free = sub.faintSwitch || sub.freeSwitches > 0;
    if (!free && sub.discardsLeft <= 0) { this.toast = { text: 'Switching costs a discard — none left!', t: 2 }; return; }
    pushOverlay(new ChoiceModal({
      title: `Send out ${monName(mon)}?`, body: free ? 'This switch is free.' : 'Switching your lead costs 1 discard. The new lead takes the foes\' hits, and your hand becomes its deck.',
      options: [{ label: 'Switch!', value: 1, color: THEME.green }, { label: 'Cancel', value: 0, color: '#806060' }],
      onClose: (v) => { if (v === 1 && this.canChoose()) this.post({ type: 'switch', uid: mon.uid }); },
    }));
  }

  chooseBall() {
    const run = this.run();
    const balls = Object.entries(run.balls).filter(([, n]) => n > 0);
    const target = this.target;
    const throwIt = (ball) => { if (this.canChoose()) { this.sel = []; this.post({ type: 'lock', ball, target }); } };
    if (balls.length === 1) return throwIt(balls[0][0]);
    pushOverlay(new ChoiceModal({
      title: 'Throw which BALL?', options: balls.map(([k, n]) => ({ label: `${D.items[k]?.name} x${n}  (${Math.round(this.duo.catchChance(this.me, k, target) * 100)}%)`, value: k, color: '#d04040' })),
      onClose: (v) => { if (v) throwIt(v); },
    }));
  }

  useConsumable(k) {
    if (!this.canAct()) { if (this.duo.locks[this.me]) this.toast = { text: "You're locked in for this turn.", t: 1.6 }; return; }
    const def = CONSUMABLES[k];
    if (!def) return;
    if (NO_COOP_ITEM(def)) { this.toast = { text: def.flee ? "No running from a co-op battle!" : 'Use that outside of battle.', t: 2 }; return; }
    if (def.target === 'none' || def.stage || def.focus || def.mist || def.reviveAll) { this.post({ type: 'item', key: k, uid: null }); return; }
    pushOverlay(new DuoPartyPicker({
      title: `Use ${D.items[k]?.name || k} on...`,
      runs: this.order.filter(p => !this.duo.away?.[p]).map(p => this.run(p)), slots: this.order.filter(p => !this.duo.away?.[p]),
      names: this.order.filter(p => !this.duo.away?.[p]).map(p => (p === this.me ? 'YOUR TEAM' : this.many ? `P${p + 1} ${this.s.nameOf(p).slice(0, 8)}` : `${this.s.nameOf(p)}'S TEAM`)),
      filter: (m) => def.target === 'monFainted' || def.revive ? (isFainted(m) ? true : 'Not fainted') : isFainted(m) ? 'Fainted' : (def.heal || def.healFrac) && m.hp >= maxHp(m) && !def.cure ? 'HP is full' : def.cure && !def.heal && !def.healFrac && !m.status ? 'No status' : true,
      onClose: (r) => {
        if (!r || !this.canChoose()) return;
        this.post(r.p === this.me ? { type: 'item', key: k, uid: r.mon.uid } : { type: 'item', key: k, uid: r.mon.uid, toP: r.p });
      },
    }));
  }
}

// Pick a POKéMON from your team or your partner's (healing items can patch up the partner).
class DuoPartyPicker extends Modal {
  draw(ctx) {
    this.dim(ctx);
    const rows = Math.max(...this.runs.map(r => r.party.length));
    const cols = this.runs.length, cw = cols > 2 ? Math.floor(600 / cols) - 6 : 264;
    const w = cols > 2 ? 612 : 560, h = 52 + rows * 38;
    const x = (W - w) / 2, y = (H - h) / 2;
    panel(ctx, x, y, w, h);
    text(ctx, this.title || 'Choose a POKéMON', W / 2, y + 6, { align: 'center', color: 'white' });
    this.runs.forEach((run, col) => {
      const p = this.slots[col];
      const cx = x + 10 + col * (cw + 10);
      pixBox(ctx, cx, y + 22, cw, 12, PCOL[p], null, 2);
      text(ctx, this.names[col], cx + cw / 2, y + 21, { align: 'center', color: 'white', font: 'small' });
      run.party.forEach((mon, i) => {
        const ry = y + 38 + i * 38;
        const ok = this.filter ? this.filter(mon) : true;
        const hot = ok === true && hover(cx, ry, cw, 34);
        pixBox(ctx, cx, ry, cw, 34, hot ? '#40507a' : ok === true ? '#2c3448' : '#20242e', hot ? '#f8d038' : '#141820', 3);
        drawIcon(ctx, mon.species, cx, ry - 2, { gray: isFainted(mon), still: ok !== true });
        textFit(ctx, monName(mon), cx + 34, ry + 3, cw - 70, { color: ok === true ? 'white' : 'gray', font: 'small' });
        text(ctx, `Lv${mon.level}`, cx + cw - 6, ry + 3, { align: 'right', color: 'white', font: 'small' });
        // (narrow columns: the reason replaces the HP bar)
        if (cw > 200 || ok === true) hpBar(ctx, cx + 34, ry + 20, cw > 200 ? 120 : cw - 40, mon.hp / maxHp(mon), 3);
        if (cw > 200 || ok !== true) text(ctx, ok === true ? `${mon.hp}/${maxHp(mon)}` : String(ok), cx + cw - 6, ry + 17, { align: 'right', color: ok === true ? 'gray' : 'red', font: 'small' });
        if (hot) { monTooltip(mon, col < cols / 2 ? cx + cw + 4 : cx - 206, ry); if (Engine.mouse.clicked) { Sound.playSE('se_select'); this.close({ p, mon }); } }
      });
    });
    if (button(ctx, 'CANCEL', W / 2 - 50, y + h - 4, 100, 22, { color: '#806060' })) this.close(null);
    drawTips(ctx);
  }
}

function teamUpPct() { return Math.round(COOP_TUNING.teamUp); }
function fmt(n) { n = Math.round(n); return n >= 100000 ? (n / 1000).toFixed(0) + 'K' : n.toLocaleString(); }
function floatTextAt(str, x, y, color) { floatText(str, x, y, { color, font: 'small', life: 1.1 }); }
