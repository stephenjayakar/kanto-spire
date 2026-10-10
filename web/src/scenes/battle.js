// Battle scene: renders the FireRed battle, the card hand, and animates the engine's event stream.
import { Engine, W, H, hover, clicked, inRect, pushOverlay, tween, Ease, wait, keyPressed, shake, approach } from '../engine/core.js';
import { draw, img, ready, itemPath, trainerPath, tinted, ballSprite } from '../engine/assets.js';
import { text, textBlock, measure, textFit } from '../engine/font.js';
import { swirlBackground, BG_THEMES, button, panel, pixBox, rect, drawTips, tip, hpBar, THEME, shade } from '../engine/ui.js';
import { burst, floatText, drawFx, clearFx, doFlash, drawFlash } from '../engine/fx.js';
import { D, TYPE_COLORS, speciesName, typeEffect } from '../game/data.js';
import { Battle, abilityOf } from '../game/battle.js';
import { COMBOS } from '../game/hands.js';
import { BOSS_RULES } from '../game/bosses.js';
import { CONSUMABLES, BALLS, BADGES } from '../game/items.js';
import { maxHp, monName, typesOf, isFainted, stats, DECK_RULES, LEGENDARY } from '../game/pokemon.js';
import { G, saveRun, saveMeta } from '../game/state.js';
import { Sound } from '../audio/sound.js';
import { drawTrainer, drawHUD, drawCard, drawCardBack, cardTooltip, drawPartyPanel, drawMon, drawIcon, CARD_W, CARD_H, MessageBox, ChoiceModal, PartyPicker, DeckModal, monTooltip, consumableDesc, monSprite, drawNoComboTag, STATUS_SEL, ordinal, orderTagWidth, drawOrderTag, ORDER_RULE } from './common.js';
import { battleFinished } from './flow.js';
import { STAT_NAMES, PROTECT_EFFECTS } from '../game/effects.js';
import { MoveAnims } from '../anim/player.js';
import { pickHandAnim, ANIM_SPEED, HAND_START_EVENTS, orderTurnEvents } from '../anim/pick.js';
import { opaqueBounds } from './common.js';
import { AUTO, autoKey, autoStopInput, manualKey, autoLowHp, drawAutoButton } from './auto.js';

const SCENE_X = 160, SCENE_Y = 27, SCENE_W = 480, SCENE_H = 200;
const HAND_Y = 262;
// Trainer battles: how long (s, scaled by FAST) the trainer stays on screen after "X wants to battle!" before it
// sends out its first POKéMON (it was 0.7). A click/tap or key cuts it short. Display only (co-op uses it too).
export const TRAINER_LINGER = 1.0;
const TYPE_SFX = {
  NORMAL: 'se_m_comet_punch', FIRE: 'se_m_flamethrower', WATER: 'se_m_bubble2', GRASS: 'se_m_razor_wind', ELECTRIC: 'se_m_thunderbolt2',
  ICE: 'se_m_icy_wind', FIGHTING: 'se_m_mega_kick2', POISON: 'se_m_toxic', GROUND: 'se_m_dig', FLYING: 'se_m_wing_attack', PSYCHIC: 'se_m_psybeam',
  BUG: 'se_m_string_shot', ROCK: 'se_m_rock_throw', GHOST: 'se_m_nightmare', DRAGON: 'se_m_dragon_rage', DARK: 'se_m_bite', STEEL: 'se_m_vicegrip',
};

export class BattleScene {
  constructor(cfg, extra = {}) { this.cfg = cfg; this.extra = extra; }

  enter() {
    const run = G.run;
    this.b = new Battle(run, this.cfg);
    this.msg = new MessageBox();
    this.sel = [];
    this.vis = new Map(); // card id -> {x,y,lift,alpha,state,flash}
    this.handIds = [];
    this.playedIds = [];
    this.busy = true;
    this.t = 0;
    this.score = null; // {name, level, base, bonus, times, total, pulse, pulseB}
    this.enemyDisp = { hp: 1, maxHp: 1, x: 0, alpha: 0, flash: 0, shake: 0, faint: 0 };
    this.leadDisp = { alpha: 0, x: -80, flash: 0, faint: 0 };
    this.partyHp = {};
    for (const m of run.party) this.partyHp[m.uid] = m.hp;
    this.relicBounce = {};
    this.trainerX = SCENE_W;
    this.leadSpecies = null;
    this.ballAnim = null;
    clearFx();
    this.fast = G.meta.settings.fast;
    this.pendingAnim = null;
    MoveAnims.load();
    this.intro();
  }

  get speed() { return this.fast ? 0.45 : 1; }
  async wait(s) { await wait(s * this.speed); }

  async intro() {
    const cfg = this.cfg;
    // Music and pre-battle lines are cosmetic: if anything here fails, the battle must still start.
    try {
      if (cfg.trainer?.encounterSong && this.cfg.kind !== 'wild') Sound.playBGM(cfg.trainer.encounterSong);
      else Sound.playBGM(cfg.music || 'mus_vs_wild');
      await this.wait(0.3);
      // Rival (and CHAMPION BLUE) pre-battle lines, with the trainer on screen.
      if (cfg.intro?.length) {
        this.trainerX = 0;
        for (const line of cfg.intro) await this.msg.say(line);
      }
      if (this.cfg.kind !== 'wild') Sound.playBGM(cfg.music || 'mus_vs_trainer');
      // A trainer slides in and stays on screen through "X wants to battle!" (it used to appear only at the send-out)
      if (cfg.trainer?.pic && cfg.kind !== 'wild' && this.trainerX > 0) { this.trainerX = 140; tween(this, { trainerX: 0 }, 0.35 * this.speed); await this.wait(0.35); }
    } catch (err) { console.error('battle intro', err); }
    const evs = this.b.start();
    await this.runEvents(evs);
    if (!G.meta.tutorialDone && G.run.stats.battles === 0) {
      this.busy = true;
      for (const tipText of [
        "TIP: Your hand is your team's moves. Pick up to 5 cards and ATTACK. Every card deals real POKéMON damage.",
        'TIP: Cards of the same TYPE form combos (PAIR +25%, TRIPLE +60%...). Each POKéMON has its own deck: switching swaps your hand.',
        "TIP: Purple status cards never form combos, but always take effect. Watch the foe's INTENT!",
      ]) await this.msg.say(tipText);
      G.meta.tutorialDone = true;
      import('../game/state.js').then(st => st.saveMeta());
    }
    this.busy = false;
  }

  // ---- event animation -------------------------------------------------------------------
  async runEvents(evs) {
    this.busy = true;
    evs = orderTurnEvents(evs);
    for (const e of evs) {
      try { await this.animate(e); } catch (err) { console.error('anim error', e, err); }
    }
    this.syncHand();
    if (this.b.result) await this.finish();
    else {
      this.stuck = !this.anyLegalPlay(); this.busy = false;
    }
  }

  // Is there any set of cards in hand the rules allow playing? (If not, the player must be able to pass.)
  anyLegalPlay() {
    const b = this.b;
    const ids = b.deck.hand.filter(c => b.cardInfo(c).playable).map(c => c.id);
    for (let mask = 1; mask < (1 << ids.length); mask++) {
      const s = ids.filter((_, i) => mask & (1 << i));
      if (s.length <= b.maxPlay && b.canPlay(s).ok) return true;
    }
    return false;
  }

  syncHand() {
    const ids = this.b.deck.hand.map(c => c.id);
    for (const id of ids) if (!this.vis.has(id)) this.vis.set(id, { x: 600, y: H + 10, lift: 0, alpha: 1 });
    this.handIds = ids;
    this.sel = this.sel.filter(id => ids.includes(id));
  }

  async animate(e) {
    const b = this.b;
    // The hand's one FireRed animation plays after its scoring count-up (the 'total' event), right before the damage
    // lands on the foe. (A hand that never resolves, e.g. the lead fainted first, plays none.)
    const pa = this.pendingAnim;
    if (pa && pa.scored) {
      this.pendingAnim = null;
      this.animLog?.push('hand:' + pa.key);
      await this.playMoveAnim(pa.key, 0, pa.move);
    } else if (pa && ['turn', 'end'].includes(e.t)) this.pendingAnim = null;
    switch (e.t) {
      case 'msg': await this.say(e.text); break;
      case 'enemyOut': {
        const en = b.enemies[e.index];
        // the trainer lingers before throwing out its first POKéMON (a click/tap cuts it short)
        if (this.cfg.trainer && e.index === 0) { this.trainerX = 0; await skippableWait(this, TRAINER_LINGER * this.speed); tween(this, { trainerX: 140 }, 0.5 * this.speed); }
        this.enemyDisp = { hp: en.hp, maxHp: en.maxHp, x: 120, alpha: 1, flash: 0, shake: 0, faint: 0, species: en.species, shiny: en.shiny, level: en.level, uid: en.uid };
        if (this.cfg.trainer) { this.ballAnim = { x: SCENE_X + 360, y: SCENE_Y + 70, t: 0 }; Sound.playSE('se_ball_open'); }
        tween(this.enemyDisp, { x: 0 }, 0.4 * this.speed, Ease.outBack);
        Sound.playCry(en.species);
        if (en.shiny) { Sound.playSE('se_shiny'); burst(SCENE_X + 360, SCENE_Y + 70, { color: ['#fff', '#f8f080'], n: 16, speed: 60, grav: 0 }); }
        await this.wait(0.35);
        break;
      }
      case 'forme': this.bossBanner = { name: `${e.forme} FORME`, a: 1 }; break; // (DEOXYS, v0.3.25)
      case 'bossRule':
        this.bossBanner = { name: e.name, desc: e.desc, a: 1 };
        Sound.playSE('se_m_screech');
        await this.wait(0.2);
        await this.say(`${e.name}: ${e.desc}`);
        break;
      case 'leadOut': {
        const mon = G.run.party.find(m => m.uid === e.uid);
        this.dispLeadUid = e.uid;
        this.leadSpecies = mon.species;
        this.leadShiny = mon.shiny;
        this.leadDisp = { alpha: 1, x: -60, flash: 0, faint: 0 };
        tween(this.leadDisp, { x: 0 }, 0.35 * this.speed, Ease.outBack);
        Sound.playSE('se_ball_open');
        Sound.playCry(mon.species);
        if (mon.shiny) { Sound.playSE('se_shiny'); burst(SCENE_X + 120, SCENE_Y + 132, { color: ['#f8d038', '#ff9020', '#40c8f8'], n: 26, speed: 80, grav: 0 }); floatText('SHINY!', SCENE_X + 150, SCENE_Y + 96, { color: 'gold', life: 1.2 }); }
        await this.wait(0.2);
        break;
      }
      case 'nuzlocke':
        floatText('RELEASED', SCENE_X + 120, SCENE_Y + 120, { color: 'red', scale: 2, life: 1.4 });
        Sound.playSE('se_failure');
        await this.wait(0.3);
        break;
      case 'turn': this.score = null; this.syncHand(); break;
      case 'draw': this.syncHand(); Sound.playSE('se_card_flip'); await this.wait(0.12); break;
      case 'reshuffle': await this.wait(0.05); break;
      case 'foeFirst':
        floatText('FOE MOVES FIRST!', SCENE_X + 240, SCENE_Y + 60, { color: 'orange', scale: 2, life: 1.2 });
        Sound.playSE('se_m_screech');
        await this.wait(0.7);
        break;
      case 'play': {
        this.playedIds = e.ids.slice();
        this.handIds = this.handIds.filter(id => !e.ids.includes(id));
        this.sel = [];
        Sound.playSE('se_card_flipping');
        await this.wait(0.35);
        break;
      }
      case 'discard': {
        for (const id of e.ids) { const v = this.vis.get(id); if (v) { v.state = 'discard'; } }
        this.handIds = this.handIds.filter(id => !e.ids.includes(id));
        if (e.forced) Sound.playSE('se_m_bubble'); else Sound.playSE('se_card_flip');
        await this.wait(0.15);
        break;
      }
      case 'combo':
        this.score = { name: e.name, level: e.level, base: 0, bonus: e.bonus, times: 1, total: null, pulse: 1, pulseB: 1, foeHp: Math.round(this.enemyDisp.hp) };
        this.scoringIds = e.scoring;
        Sound.playSE('se_m_stat_increase');
        await this.wait(0.35);
        break;
      case 'card': {
        const v = this.vis.get(e.id);
        if (e.idle) { if (v) v.dim = true; break; }
        if (v) { v.lift = 10; tween(v, { lift: 0 }, 0.3 * this.speed); v.flash = 1; }
        const [cx, cy] = this.playedPos(e.id);
        const card = this.findCard(e.id);
        if (e.label === 'MISS' || e.label === 'NO EFFECT' || e.label === 'PARALYZED' || e.label === 'SHOCKED' || e.label === 'FAILED' || e.label === 'FAINTED') {
          floatText(e.label, cx + CARD_W / 2, cy - 8, { color: 'gray' });
          Sound.playSE('se_failure');
        } else if (e.dmg > 0) {
          if (this.playedDmg) this.playedDmg[e.id] = (e.hit ? this.playedDmg[e.id] || 0 : 0) + e.dmg;
          this.score.base = e.total ?? this.score.base + e.dmg;
          this.score.pulse = 1.6;
          floatText(String(e.dmg), cx + CARD_W / 2, cy - 8, { color: 'dmg', scale: e.dmg >= (this.enemyDisp.maxHp || 999) / 3 ? 2 : 1 });
          for (const k of e.srcs || []) this.bounceSource(k, null, 'dmg');
          if (e.label === 'SUPER') floatText('SUPER EFFECTIVE', cx + CARD_W / 2, cy - 22, { color: 'red', font: 'small' });
          else if (e.label === 'CRITICAL') { floatText('CRITICAL!', cx + CARD_W / 2, cy - 22, { color: 'gold', font: 'small' }); shake(2); }
          else if (e.label === 'WEAK') floatText('not very effective', cx + CARD_W / 2, cy - 22, { color: 'gray', font: 'small' });
          else if (e.label) floatText(e.label, cx + CARD_W / 2, cy - 22, { color: 'orange', font: 'small' });
          const info = card ? b.cardInfo(card) : null;
          Sound.playSE(TYPE_SFX[info?.type] || 'se_m_comet_punch');
          burst(cx + CARD_W / 2, cy + 10, { color: [TYPE_COLORS[info?.type] || '#fff', '#fff'], n: 8, speed: 60 });
        } else if (e.label) {
          floatText(e.label, cx + CARD_W / 2, cy - 8, { color: 'purple', font: 'small' });
          Sound.playSE('se_m_stat_increase');
        }
        await this.wait(e.hit ? 0.2 : 0.38);
        break;
      }
      case 'flat':
        if (this.score) { this.score.base += e.add; this.score.pulse = 1.6; }
        this.bounceSource(e.src, '+' + e.add + ' DMG', 'dmg');
        Sound.playSE('se_m_charge');
        await this.wait(0.3);
        break;
      case 'bonus':
        if (this.score) { this.score.bonus = e.total; this.score.pulseB = 1.6; }
        this.bounceSource(e.src, '+' + e.add + '%', 'bonus');
        Sound.playSE('se_m_swords_dance');
        await this.wait(0.3);
        break;
      case 'times':
        if (this.score) { this.score.times *= e.mul; this.score.pulseB = 2; }
        this.bounceSource(e.src, e.mul === 0 ? 'NO DAMAGE' : e.mul === 0.5 ? 'HALF DAMAGE' : 'x' + (+e.mul.toFixed(2)) + ' DMG', e.mul >= 1 ? 'dmg' : 'gray');
        Sound.playSE(e.mul >= 1 ? 'se_m_belly_drum' : 'se_m_stat_decrease');
        shake(e.mul >= 1.5 ? 3 : 1);
        await this.wait(0.4);
        break;
      case 'relic': this.bounceSource(e.key, e.text, 'gold'); await this.wait(0.25); break;
      case 'total': {
        if (this.pendingAnim) this.pendingAnim.scored = true; // (the animation plays as the next event comes up)
        if (this.score) { this.score.total = e.damage; this.score.base = e.base; this.score.bonus = e.bonus; this.score.times = e.times; this.score.pulseT = 2; }
        Sound.playSE(e.damage > this.enemyDisp.maxHp ? 'se_m_hyper_beam' : 'se_m_mega_kick');
        if (e.damage >= this.enemyDisp.hp) { shake(5); doFlash('#ffffff', 0.4); }
        await this.wait(0.55);
        break;
      }
      case 'damage': {
        if (e.side === 'enemy') {
          this.enemyDisp.flash = 1;
          this.enemyDisp.shake = 1;
          tween(this.enemyDisp, { hp: e.hp }, 0.5 * this.speed);
          floatText('-' + e.amount.toLocaleString(), SCENE_X + 360, SCENE_Y + 40, { color: e.eff === 'super' ? 'red' : 'white', scale: e.src === 'hand' ? 2 : 1 });
          if (e.src === 'hand') Sound.playSE(e.eff === 'super' ? 'se_super_effective' : e.eff === 'weak' ? 'se_not_effective' : 'se_effective');
          await this.wait(e.src === 'hand' ? 0.55 : 0.3);
        } else {
          const lead = G.run.party.find(m => m.uid === e.uid);
          if (e.uid === this.b.leadUid || lead?.species === this.leadSpecies) { this.leadDisp.flash = 1; shake(e.amount > (e.maxHp / 3) ? 4 : 2); }
          const o = { v: this.partyHp[e.uid] ?? e.hp + e.amount };
          this.partyHp[e.uid] = o.v;
          tween(o, { v: e.hp }, 0.45 * this.speed).then(() => { this.partyHp[e.uid] = e.hp; });
          const step = () => { this.partyHp[e.uid] = o.v; if (o.v !== e.hp) requestAnimationFrame(step); };
          step();
          floatText('-' + e.amount, SCENE_X + 110, SCENE_Y + 120, { color: 'red' });
          Sound.playSE(e.eff === 'super' ? 'se_super_effective' : e.eff === 'weak' ? 'se_not_effective' : 'se_effective');
          await this.wait(0.45);
        }
        break;
      }
      case 'heal':
        if (e.side === 'enemy') tween(this.enemyDisp, { hp: e.hp }, 0.4 * this.speed);
        else { this.partyHp[e.uid] = e.hp; floatText('+' + e.amount, SCENE_X + 110, SCENE_Y + 120, { color: 'green' }); }
        Sound.playSE('se_use_item');
        await this.wait(0.25);
        break;
      case 'faint':
        if (e.side === 'enemy') {
          Sound.playCry(e.species, { mode: 'faint' });
          tween(this.enemyDisp, { faint: 1 }, 0.5 * this.speed);
          Sound.playSE('se_faint');
          await this.wait(0.6);
        } else {
          Sound.playCry(e.species, { mode: 'faint' });
          if (G.run.party.find(m => m.uid === e.uid)?.species === this.leadSpecies) tween(this.leadDisp, { faint: 1 }, 0.8 * this.speed);
          Sound.playSE('se_faint');
          shake(4); doFlash('#ff2020', 0.35);
          floatText(`${speciesName(e.species)} FAINTED!`, SCENE_X + 120, SCENE_Y + 110, { color: 'red', scale: 2, life: 1.6 });
          await this.wait(1.3);
        }
        break;
      case 'status':
        Sound.playSE(e.status ? { PSN: 'se_m_toxic', TOX: 'se_m_toxic', BRN: 'se_m_ember', PAR: 'se_m_thunder_wave', SLP: 'se_m_sing', FRZ: 'se_m_icy_wind' }[e.status] || 'se_m_stat_decrease' : 'se_m_heal_bell');
        await this.wait(0.15);
        break;
      case 'statusAnim': await this.wait(0.1); break;
      case 'stage':
        Sound.playSE(e.delta > 0 ? 'se_m_stat_increase' : 'se_m_stat_decrease');
        await this.wait(0.12);
        break;
      case 'enemyMove': {
        this.idleIntent = null; // (its move is happening: don't show it, or the next one, until the turn is over)
        this.animLog?.push('foe:' + e.move);
        if (await this.playMoveAnim(e.move, 1)) break;
        this.enemyDisp.lunge = 1;
        tween(this.enemyDisp, { lunge: 0 }, 0.3 * this.speed);
        Sound.playSE(TYPE_SFX[e.type] || 'se_m_comet_punch');
        await this.wait(0.25);
        break;
      }
      case 'weather': Sound.playSE(e.weather === 'RAIN' ? 'se_m_rain_dance' : e.weather === 'SAND' ? 'se_m_sandstorm' : e.weather === 'HAIL' ? 'se_m_hail' : 'se_m_morning_sun'); await this.wait(0.2); break;
      case 'ball': await this.animateBall(e); break;
      case 'item': Sound.playSE('se_use_item'); await this.wait(0.2); break;
      case 'partyUpdate': for (const m of G.run.party) if (this.partyHp[m.uid] === undefined || Math.abs(this.partyHp[m.uid] - m.hp) > 0) this.partyHp[m.uid] = m.hp; break;
      case 'end': break;
    }
    // cleanup played cards after the hand fully resolves
    if (e.t === 'total' || e.t === 'turn' || e.t === 'end') {
      if (e.t !== 'total') { for (const id of this.playedIds) { const v = this.vis.get(id); if (v) v.state = 'discard'; } this.playedIds = []; this.scoringIds = null; }
    }
  }

  async animateBall(e) {
    Sound.playSE('se_ball_throw');
    const ballImg = ballSprite(e.ball);
    this.ballAnim = { img: ballImg, x: SCENE_X + 60, y: SCENE_Y + 150, frame: 0, show: true };
    await tween(this.ballAnim, { x: SCENE_X + 352, y: SCENE_Y + 60 }, 0.5 * this.speed, Ease.outQuad);
    Sound.playSE('se_ball_open');
    this.enemyDisp.captured = 1;
    await this.wait(0.3);
    this.ballAnim.y = SCENE_Y + 95;
    Sound.playSE('se_ball_bounce_1');
    await this.wait(0.4);
    for (let i = 0; i < e.shakes; i++) {
      this.ballAnim.wiggle = 1; Sound.playSE('se_ball'); await tween(this.ballAnim, { wiggle: 0 }, 0.35 * this.speed); await this.wait(0.35);
    }
    if (e.caught) {
      Sound.playSE('se_ball_click');
      burst(this.ballAnim.x + 8, this.ballAnim.y, { color: ['#f8f8f8', '#f8d038'], n: 14, speed: 50, grav: 50 });
      Sound.playBGM('mus_caught_intro');
      await this.wait(1.0);
      Sound.playBGM('mus_caught');
    } else {
      Sound.playSE('se_ball_open');
      this.enemyDisp.captured = 0;
      this.ballAnim = null;
      await this.wait(0.2);
    }
  }

  bounceSource(src, label, color) {
    if (!src) return;
    const i = G.run.relics.findIndex(r => r.key === src);
    if (i >= 0) {
      this.relicBounce[src] = 0.01;
      tween(this.relicBounce, { [src]: 1 }, 0.35 * this.speed).then(() => { delete this.relicBounce[src]; });
      if (label) floatTextAt(label, this.relicX(i) + 12, 34, color);
    } else if (label) {
      // badges and boss rules: float just under the damage panel (not over the DISCARDS row)
      floatTextAt(`${String(src).replace(/_/g, ' ')}${BADGES[src] ? ' BADGE' : ''}: ${label}`, 80, 118, color);
    }
  }
  relicX(i) {
    const run = G.run;
    const x0 = 112 + Math.max(52, measure('$' + run.money.toLocaleString()) + 8) + 42 + run.maxConsumables * 27 + 6;
    const n = run.relics.length;
    const step = n ? Math.max(7, Math.min(26, (W - 174 - x0 - 24) / Math.max(1, n - 1))) : 26;
    return x0 + i * step;
  }

  async say(str) {
    await this.msg.say(str, { auto: this.fast ? 0.35 : 0.9 });
  }

  findCard(id) {
    const b = this.b;
    return b.findCardAny(id);
  }

  // ---- layout ---------------------------------------------------------------------------
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
    return playedRowPos(i, n, HAND_Y - 18);
  }

  // ---- input ----------------------------------------------------------------------------
  // FireRed's low-HP beep is a looping SE: start it when the lead drops into the red during this battle.
  syncLowHpAlarm() {
    const lead = this.b.lead();
    const hp = lead ? (this.partyHp[lead.uid] ?? lead.hp) : 0;
    const want = !this.b.result && lead && hp > 0 && hp / maxHp(lead) < 0.25;
    if (want && !this.lowHpOn) { Sound.playSE('se_low_health'); this.lowHpOn = true; this.lowHpAt = Engine.time; }
    else if (!want && this.lowHpOn) { Sound.stopSE('se_low_health'); this.lowHpOn = false; }
    // the SE loops every 0.6s: let it beep three times, then go quiet until the lead leaves the red
    else if (this.lowHpOn && this.lowHpAt != null && Engine.time - this.lowHpAt > 1.75) { Sound.stopSE('se_low_health'); this.lowHpAt = null; }
  }

  exit() { if (this.lowHpOn) Sound.stopSE('se_low_health'); this.lowHpOn = false; }

  update(dt) {
    pileInput(this);
    pollSkip(this);
    MoveAnims.tick(dt);
    this.syncLowHpAlarm();
    // the intent on screen: while a turn animates, the one the foe had going in (the logic already rolled the next), gone
    // once the foe has moved; the live one again when idle
    if (!this.busy) this.idleIntent = this.b.intent;
    this.t += dt;
    this.msg.update(dt, this.fast);
    if (this.score) { this.score.pulse = approach(this.score.pulse || 1, 1, 8, dt); this.score.pulseB = approach(this.score.pulseB || 1, 1, 8, dt); this.score.pulseT = approach(this.score.pulseT || 1, 1, 6, dt); }
    this.enemyDisp.flash = Math.max(0, (this.enemyDisp.flash || 0) - dt * 4);
    this.enemyDisp.shake = Math.max(0, (this.enemyDisp.shake || 0) - dt * 3);
    this.leadDisp.flash = Math.max(0, (this.leadDisp.flash || 0) - dt * 4);
    if (this.bossBanner) this.bossBanner.a = Math.max(0, this.bossBanner.a - dt * 0.15);
    // card positions
    const n = this.handIds.length;
    this.dragSuppress = false;
    const dr = this.drag;
    if (dr && !Engine.mouse.down) { this.dragSuppress = dr.moved; this.drag = null; }
    else if (dr) {
      if (Math.abs(Engine.mouse.x - dr.x0) > 6) dr.moved = true;
      const from = this.handIds.indexOf(dr.id);
      if (dr.moved && from >= 0 && !this.busy) {
        let to = from, best = Infinity;
        for (let i = 0; i < n; i++) { const d = Math.abs(this.handPos(i, n)[0] + CARD_W / 2 - Engine.mouse.x); if (d < best) { best = d; to = i; } }
        if (to !== from) {
          this.handIds.splice(from, 1); this.handIds.splice(to, 0, dr.id);
          const h = this.b.deck.hand, c = h.find(x => x.id === dr.id);
          if (c) { h.splice(h.indexOf(c), 1); h.splice(Math.min(to, h.length), 0, c); }
        }
      }
    }
    this.handIds.forEach((id, i) => {
      const v = this.vis.get(id);
      if (this.drag?.moved && this.drag.id === id) { v.x = Engine.mouse.x - CARD_W / 2; v.y = HAND_Y - 12; v.dim = false; return; }
      const [tx, ty] = this.handPos(i, n);
      const lift = this.sel.includes(id) ? -16 : (this.hoverId === id ? -5 : 0);
      const tuck = this.playedIds.length ? 74 : 0; // (the rest of the hand slides down under the played cards)
      v.x = approach(v.x, tx, 14, dt); v.y = approach(v.y, ty + lift + tuck, 14, dt);
      v.dim = false;
    });
    this.playedIds.forEach((id) => {
      const v = this.vis.get(id); if (!v) return;
      const [tx, ty] = this.playedPos(id);
      v.x = approach(v.x, tx, 12, dt); v.y = approach(v.y, ty - (v.lift || 0), 12, dt);
    });
    for (const [id, v] of this.vis) {
      if (v.state === 'discard' && !this.handIds.includes(id) && !this.playedIds.includes(id)) {
        v.x = approach(v.x, W + 40, 8, dt); v.y = approach(v.y, HAND_Y, 8, dt);
        if (v.x > W + 20) this.vis.delete(id);
      }
      v.flash = Math.max(0, (v.flash || 0) - dt * 3);
    }
    // keep the lead's back sprite in sync (e.g. after a faint-switch mid animation)
    if (!this.busy) { const l = this.b.lead(); if (l) this.dispLeadUid = l.uid; if (l && l.species !== this.leadSpecies && !isFainted(l)) { this.leadSpecies = l.species; this.leadShiny = l.shiny; this.leadDisp = { alpha: 1, x: 0, flash: 0, faint: 0 }; } }
    // contextual tip: the first time a wild POKéMON is weak enough to catch
    const en = this.b.enemy();
    if (!this.busy && this.cfg.kind === 'wild' && this.b.canCatch() && !G.meta.tipCatch && en && en.hp > 0 && G.run.totalBalls() > 0 && !this.b.result && G.meta.tutorialDone) {
      G.meta.tipCatch = true; this.busy = true;
      this.msg.say('TIP: Weaken wild POKéMON below 50% HP (or put them to sleep), then press BALL to catch them before they faint.').then(() => { this.busy = false; });
    }
    if (this.autoTick(dt)) return;
    if (this.busy) return;
    // keyboard
    if (keyPressed('Enter') || keyPressed('a') || keyPressed('A')) this.doPlay();
    if (keyPressed('d') || keyPressed('D')) this.doDiscard();
    for (let k = 1; k <= 9; k++) if (keyPressed(String(k)) && this.handIds[k - 1] !== undefined) this.toggle(this.handIds[k - 1]);
  }

  previewSim() {
    const b = this.b;
    if (this.busy || !this.sel.length) return null;
    const key = this.sel.join(',') + '|' + b.previewKey();
    if (this._simKey !== key) { this._simKey = key; this._sim = b.simulate(this.sel); this._prev = b.preview(this.sel); }
    return this._prev ? { ...this._prev, sim: this._sim } : null;
  }

  toggle(id) {
    if (this.auto) this.autoSet(false); // (picking a card yourself takes over from AUTO)
    const card = this.b.deck.hand.find(c => c.id === id);
    if (!card) return;
    const i = this.sel.indexOf(id);
    const info = this.b.cardInfo(card);
    if (i < 0 && !info.playable) { this.toast = { text: `That card can't be played (${info.reason}).`, t: 1.6 }; Sound.playSE('se_failure'); return; }
    if (i >= 0) { this.sel.splice(i, 1); Sound.playSE('se_card_flip'); }
    else if (this.sel.length < this.b.maxPlay) { this.sel.push(id); Sound.playSE('se_select'); }
    else Sound.playSE('se_failure');
  }

  async doPlay() {
    if (this.busy || !this.sel.length) return;
    const chk = this.b.canPlay(this.sel);
    if (!chk.ok) { this.toast = { text: chk.reason, t: 2 }; Sound.playSE('se_failure'); return; }
    // keep played order = hand order
    const ids = this.handIds.filter(id => this.sel.includes(id));
    this.busy = true;
    // The engine resolves the whole turn at once (the foe may faint and be replaced), so freeze the damage the
    // played cards show now; each card then shows what it actually dealt as it hits.
    this.playedDmg = {};
    for (const id of ids) { const c = this.findCard(id); if (c) this.playedDmg[id] = this.b.cardInfo(c).dmgPreview; }
    this.pendingAnim = this.chooseHandAnim(ids);
    const evs = this.b.play(ids);
    await this.runEvents(evs);
  }
  // One FireRed move animation per hand: attacks beat status cards, then the most damage to the foe (the
  // number on the card), then base power, then the leftmost card (see anim/pick.js).
  chooseHandAnim(ids) {
    const cards = [];
    for (const id of ids) {
      const c = this.findCard(id); if (!c) continue;
      const info = this.b.cardInfo(c);
      if (!info.playable || info.uid !== this.b.leadUid) continue; // only the lead acts on screen
      cards.push({ id, move: info.move.key, status: info.status, dmg: this.playedDmg?.[id] ?? info.dmgPreview, data: info.move });
    }
    const pick = pickHandAnim(cards);
    return pick ? { key: pick.move, move: pick.data } : null;
  }

  // battlers for the animation engine, in GBA pixels (the scene draws POKéMON at 2x: GBA (0,0) = canvas (SCENE_X, SCENE_Y - 20))
  animBattlers() {
    const box = (path) => opaqueBounds(path) || { x: 0, y: 0, w: 64, h: 64 };
    const ed = this.enemyDisp, ld = this.leadDisp;
    const mk = (present, species, cx, cy, path) => { const bx = box(path); return { present, species, x: cx, picY: cy, y: cy - Math.max(0, 64 - (bx.y + bx.h)), box: bx }; };
    return [
      mk(!!this.leadSpecies && ld.faint < 1, this.leadSpecies, 60 + Math.round(ld.x), 78, monSprite(this.leadSpecies || 'BULBASAUR', 'back', this.leadShiny)),
      mk(!!ed.species && ed.faint < 1 && !ed.captured, ed.species, 180 + Math.round(ed.x), 45, monSprite(ed.species || 'BULBASAUR', 'front', ed.shiny)),
    ];
  }

  // Plays moveKey's FireRed animation (attacker 0 = our lead, 1 = the foe). Resolves to false when there is none.
  async playMoveAnim(moveKey, attacker, moveData) {
    if (!MoveAnims.ready || G.meta.settings.moveAnims === false) return false;
    const move = moveData || this.b.moveData?.(moveKey) || D.moves[moveKey];
    const r = MoveAnims.resolve(moveKey, move, this.cfg.terrain || 'grass');
    if (!r) return false;
    const battlers = this.animBattlers();
    if (!battlers[attacker].present || !battlers[attacker ^ 1].present) return false;
    this.animMove = { key: moveKey, shown: r.key, via: r.via };
    try {
      await MoveAnims.play(r.key, {
        attacker, battlers, speed: this.fast ? ANIM_SPEED.fast : ANIM_SPEED.normal, maxFrames: 720,
        hooks: { playSE: (n) => Sound.playSE(n), playCry: (sp) => Sound.playCry(sp), power: move?.power || 0 },
      });
    } finally { this.animMove = null; }
    return true;
  }

  async doDiscard() {
    if (this.busy || !this.sel.length) return;
    if (!this.canDiscard(this.sel.length)) { this.toast = { text: this.b.discardsLeft <= 0 && this.b.freeDiscardOk(1) ? `Only ${DECK_RULES.freeDiscard} cards for the free discard!` : 'No discards left!', t: 2 }; Sound.playSE('se_failure'); return; }
    this.busy = true;
    const evs = this.b.discard(this.sel.slice());
    this.sel = [];
    await this.runEvents(evs);
  }
  // Discarding n cards is allowed: a discard left, this turn's free discard (up to DECK_RULES.freeDiscard cards), or ACRO BIKE.
  canDiscard(n) { const b = this.b; return n > 0 && (b.discardsLeft > 0 || b.freeDiscardOk(n) || b.acroOk(n)); }
  async doPass() {
    if (this.busy || !this.stuck) return;
    this.busy = true;
    this.sel = [];
    await this.runEvents(this.b.pass());
  }

  async finish() {
    this.exit();
    G.run.logBattle(this.b);
    if ((G.meta.hintBattles || 0) < 3) { G.meta.hintBattles = (G.meta.hintBattles || 0) + 1; saveMeta(); } // (only counts up to the hint's limit: a meta upload per battle otherwise)
    const r = this.b.result;
    this.busy = true;
    // The closing music and line are cosmetic: whatever happens there, the battle must hand over.
    try {
      if (r.outcome === 'win') {
        const song = this.cfg.kind === 'boss' ? 'mus_victory_gym_leader' : this.cfg.kind === 'wild' ? 'mus_victory_wild' : 'mus_victory_trainer';
        Sound.playBGM(song);
        if (this.cfg.trainer) { this.trainerX = 0; tween(this, { trainerX: 140 }, 0.5); }
        await this.say(this.cfg.trainer ? `You defeated ${this.cfg.trainer.title}!` : 'You won the battle!');
      } else if (r.outcome === 'lose' && this.cfg.softLose) {
        Sound.fadeOutBGM(60);
        await this.say(`${this.cfg.legend || 'The foe'} threw your team out! Everyone lost 30% HP, but the run goes on.`);
      } else if (r.outcome === 'lose') {
        Sound.fadeOutBGM(60);
        await this.say('You blacked out!');
      } else if (r.outcome === 'caught') {
        await this.wait(0.4);
      }
      await this.wait(0.3);
    } catch (err) { console.error('battle finish', err); }
    battleFinished(this.b, this);
  }

  // ---- drawing --------------------------------------------------------------------------
  draw(ctx) {
    const b = this.b, run = G.run;
    const bossy = this.cfg.kind === 'boss' || this.cfg.kind === 'elite';
    swirlBackground(ctx, bossy ? BG_THEMES.boss : this.cfg.terrain === 'cave' ? BG_THEMES.cave : this.cfg.terrain === 'water' ? BG_THEMES.water : BG_THEMES.grass, bossy ? 1.2 : 0.7);
    this.orderTagBoxes = [];
    this._order = this.busy || this.playedIds.length ? null : this.orderInfo();
    this.drawScene(ctx);
    this.drawLeftPanel(ctx);
    this.drawHand(ctx);
    this.drawPlayed(ctx);
    drawHUD(ctx, run, { bounce: this.relicBounce, help: true, battle: this.b, onDeck: () => this.showDeck(), onConsumableClick: (k) => this.useConsumable(k), noToss: true, subtitle: this.cfg.trainer ? this.cfg.trainer.title : (this.cfg.legend || this.cfg.areaName || 'WILD BATTLE') });
    drawFx(ctx, Engine.dt);
    drawFlash(ctx, Engine.dt, W, H);
    if (this.toast) {
      this.toast.t -= Engine.dt;
      if (this.toast.t <= 0) this.toast = null;
      else { const w = measure(this.toast.text) + 20; pixBox(ctx, (W - w) / 2 + 80, 236, w, 20, '#401010', '#ff6060', 3); text(ctx, this.toast.text, W / 2 + 80, 239, { align: 'center', color: 'white' }); }
    }
    drawTips(ctx);
  }

  drawScene(ctx) {
    const b = this.b;
    ctx.save();
    pixBox(ctx, SCENE_X - 2, SCENE_Y + 2, SCENE_W + 2, SCENE_H, '#000', null, 3);
    ctx.beginPath(); ctx.rect(SCENE_X, SCENE_Y + 4, SCENE_W - 2, SCENE_H - 4); ctx.clip();
    const terr = terrainImage(this.cfg);
    const toff = MoveAnims.terrainOffset();
    // (a shaken/scrolled terrain wraps around like the GBA background layer)
    for (const wx of toff.x ? [-480, 0, 480] : [0]) for (const wy of toff.y ? [-224, 0, 224] : [0]) draw(ctx, terr, SCENE_X - 1 + toff.x * 2 + wx, SCENE_Y + 4 - 24 + toff.y * 2 + wy, { sx: 0, sy: 0, sw: 240, sh: 112, scale: 2 });
    const animOn = MoveAnims.active;
    if (animOn) MoveAnims.drawBg(ctx, SCENE_X, SCENE_Y - 20, 2, SCENE_W, SCENE_H + 24);
    // weather tint
    // JOHTO day / night (cfg.timeOfDay): a warm morning wash, a dark blue night over the background
    const tod = { morn: ['#f8a060', 0.1], nite: ['#0c1040', 0.32] }[this.cfg.timeOfDay];
    if (tod) { ctx.save(); ctx.globalAlpha = tod[1]; rect(ctx, SCENE_X, SCENE_Y, SCENE_W, SCENE_H, tod[0]); ctx.restore(); }
    if (b.weather) { ctx.save(); ctx.globalAlpha = 0.18; rect(ctx, SCENE_X, SCENE_Y, SCENE_W, SCENE_H, { SUN: '#ffd060', RAIN: '#3050a0', SAND: '#c0a060', HAIL: '#e0f0ff' }[b.weather]); ctx.restore(); }
    // trainer pic sliding: 2x like the POKéMON (a 1.5x resample mangled the pixel art), where the foe stands
    if (this.cfg.trainer?.pic && this.trainerX < 140) {
      drawTrainer(ctx, this.cfg.trainer.pic, SCENE_X + 296 + this.trainerX, SCENE_Y + 6, { scale: 2, alpha: 1 - this.trainerX / 140, minTop: SCENE_Y + 8 });
    }
    // enemy
    const ed = this.enemyDisp;
    const e = b.enemy();
    if (animOn) {
      // the animation engine draws both POKéMON (offsets, rot/scale, tints, clones) and its sprites, in GBA order
      ctx.save(); ctx.beginPath(); ctx.rect(SCENE_X, SCENE_Y, SCENE_W, SCENE_H); ctx.clip();
      MoveAnims.drawLayer(ctx, SCENE_X, SCENE_Y - 20, 2, { drawMon: (c, battler, o) => this.drawAnimMon(c, battler, o) });
      ctx.restore();
      if (e && e.status && ed.species && ed.faint < 1 && !ed.captured) draw(ctx, `gfx/ui/status/${e.status === 'TOX' ? 'psn' : e.status.toLowerCase()}.png`, SCENE_X + 120, SCENE_Y + 44);
    } else if (ed.species && ed.alpha > 0 && ed.faint < 1 && !ed.captured) {
      const sx = SCENE_X + 296 + ed.x * 2 + (ed.shake > 0 ? Math.sin(this.t * 60) * 3 * ed.shake : 0) - (ed.lunge || 0) * 14;
      const sy = SCENE_Y + 6 + ed.faint * 60 + Math.sin(this.t * 2) * 1.5;
      ctx.save();
      ctx.beginPath(); ctx.rect(SCENE_X, SCENE_Y, SCENE_W, SCENE_Y + 130 - 0); ctx.clip();
      drawMon(ctx, ed.species, sx, sy, { scale: 2, shiny: ed.shiny, flash: ed.flash > 0 && Math.floor(this.t * 20) % 2 ? 0.9 : 0, alpha: 1 - ed.faint });
      ctx.restore();
      if (e && e.status) draw(ctx, `gfx/ui/status/${e.status === 'TOX' ? 'psn' : e.status.toLowerCase()}.png`, SCENE_X + 120, SCENE_Y + 44);
    }
    if (this.ballAnim?.img) {
      const w = this.ballAnim.wiggle ? Math.sin(this.ballAnim.wiggle * Math.PI * 4) * 3 : 0;
      draw(ctx, this.ballAnim.img, this.ballAnim.x + w - 4, this.ballAnim.y - 4, { sx: 0, sy: 0, sw: 16, sh: 16, scale: 2 });
    }
    // enemy healthbox
    if (ed.species && !ed.captured && ed.faint < 1) this.drawEnemyBox(ctx, SCENE_X + 14, SCENE_Y + 12);
    // player lead (back sprite)
    const ld = this.leadDisp;
    if (this.leadSpecies && ld.faint < 1) {
      const lx = SCENE_X + 56 + ld.x * 2, ly = SCENE_Y + 72 + ld.faint * 60;
      if (!animOn) {
        ctx.save(); ctx.beginPath(); ctx.rect(SCENE_X, SCENE_Y, SCENE_W, SCENE_H); ctx.clip();
        drawMon(ctx, this.leadSpecies, lx, ly, { back: true, scale: 2, shiny: this.leadShiny, flash: ld.flash > 0 && Math.floor(this.t * 20) % 2 ? 0.9 : 0, alpha: 1 - ld.faint });
        ctx.restore();
      }
      this.drawPlayerBox(ctx, SCENE_X + SCENE_W - 170, SCENE_Y + 118);
    }
    // intent
    const intent = this.busy ? this.idleIntent : b.intent;
    if (!b.result && intent && e && ed.faint < 1 && !this.playedIds.length) this.drawIntent(ctx, intent);
    // boss banner
    if (this.bossBanner && this.bossBanner.a > 0.05 && b.bossRule) {
      ctx.save(); ctx.globalAlpha = Math.min(1, this.bossBanner.a * 2);
      pixBox(ctx, SCENE_X + 290, SCENE_Y + 8, 180, 18, '#5a1018', '#f8d038', 3);
      text(ctx, this.bossBanner.name || b.bossRule.name, SCENE_X + 380, SCENE_Y + 10, { align: 'center', color: 'gold', font: 'small' });
      ctx.restore();
    }
    // messages
    this.msg.draw(ctx, SCENE_X + 4, SCENE_Y + SCENE_H - 46, SCENE_W - 10, 42, 'battle');
    ctx.restore();
    // hover enemy
    if (ed.species && e && hover(SCENE_X + 296, SCENE_Y + 6, 128, 120)) this.enemyTooltip(e);
    if (this.leadSpecies && hover(SCENE_X + 56, SCENE_Y + 72, 128, 128)) { const l = b.lead(); if (l) monTooltip(l, SCENE_X + 190, SCENE_Y + 60); }
    if (this._order && this.orderTagBoxes.some(t => hover(t.x, t.y, t.w, t.h))) this.orderTip(this._order);
  }

  // ---- move order ("1st" / "2nd" on the healthboxes) --------------------------------------------------------------
  // Who acts first this turn, by the engine's own rule (Battle.enemyActsFirst: move priority, then QUICK CLAW, then
  // Speed) with the selected cards' priority (a PROTECT counted as working). Display only: no RNG and no state change
  // (QUICK CLAW's 20% roll for the turn was made when the turn started).
  orderInfo() {
    const b = this.b, it = b.intent, e = b.enemy(), lead = b.lead();
    if (b.result || !it || !e || !lead) return null;
    const infos = b.findCards(this.sel || []).map(c => b.cardInfo(c));
    const foeFirst = b.enemyActsFirst(infos.length ? infos : null, it.move, true);
    const pPrio = Math.max(0, ...infos.map(i => i.move.priority || 0)), ePrio = it.move.priority || 0;
    return {
      foeFirst, pPrio, ePrio, infos, prioCard: pPrio > 0 ? infos.find(i => (i.move.priority || 0) === pPrio) : null,
      claw: !!b.mods.quickClaw && (b.handsPlayed === 0 || !!b.quickClawProc), spP: Math.round(b.speedOf('player')), spE: Math.round(b.speedOf('enemy')),
    };
  }
  // the tag on a healthbox, left of the name: returns how far the name moves right
  drawOrderTagAt(ctx, foe, x, y) {
    const o = this._order;
    if (!o) return 0;
    const first = foe === o.foeFirst, label = ordinal(first ? 1 : 2), w = orderTagWidth(label);
    drawOrderTag(ctx, label, x, y, first);
    this.orderTagBoxes.push({ x, y, w, h: 11, foe });
    return w + 3;
  }
  orderTip(o) {
    const b = this.b, e = b.enemy(), lead = b.lead(), it = b.intent, hidden = G.run.ascension >= 2;
    const foeLine = `${speciesName(e.species)} (foe, SPE ${o.spE})`, myLine = `${monName(lead)} (you, SPE ${o.spP})`;
    const rows = o.foeFirst ? [foeLine, myLine] : [myLine, foeLine];
    const sign = (n) => (n > 0 ? '+' : '') + n;
    let why;
    if (o.pPrio !== o.ePrio) {
      if (o.ePrio > o.pPrio) why = hidden ? "The foe's move has priority: it goes first." : `The foe's ${it.move.name} has priority ${sign(o.ePrio)}: it goes first.`;
      else why = o.prioCard ? `Your ${o.prioCard.move.name} has priority ${sign(o.pPrio)}: you go first.` : `The foe's ${hidden ? 'move' : it.move.name} has priority ${sign(o.ePrio)}: you go first.`;
    } else if (o.claw) why = b.handsPlayed === 0 ? 'QUICK CLAW: your first hand of the battle goes first.' : 'QUICK CLAW went off this turn: you go first.';
    else why = o.spE > o.spP ? `The foe is faster (${o.spE} vs ${o.spP}).` : o.spE === o.spP ? 'Same Speed: you win the tie.' : `You are faster (${o.spP} vs ${o.spE}).`;
    const notes = [o.infos.length ? 'Counts the cards you selected.' : 'Select cards to count their priority.'];
    if (b.mods.quickClaw && !o.claw) notes.push("QUICK CLAW: 20% each turn after your first hand, rolled when the turn starts (not this turn).");
    if (o.infos.some(i => PROTECT_EFFECTS.has(i.move.effect))) notes.push('PROTECT / DETECT / ENDURE only go first if they work.');
    tip('MOVE ORDER', `1st  ${rows[0]}\n2nd  ${rows[1]}\n${why}\n\n${ORDER_RULE}\n${notes.join('\n')}`, { width: 230 });
  }

  // the hand being resolved: a row of full-size cards below the battle scene, on top of the (tucked) hand
  drawPlayed(ctx) {
    const b = this.b;
    for (const id of this.playedIds) {
      const v = this.vis.get(id); const card = this.findCard(id);
      if (!v || !card) continue;
      const x = Math.round(v.x), y = Math.round(v.y);
      drawCard(ctx, b.cardInfo(card), x, y, { ignorePlayable: true, highlight: this.scoringIds?.includes(id) && !v.dim, dmgOverride: this.playedDmg?.[id] });
      if (v.dim) { ctx.save(); ctx.globalAlpha = 0.5; rect(ctx, x, y, CARD_W, CARD_H, '#000'); ctx.restore(); }
    }
  }

  drawAnimMon(c, battler, o) {
    const foe = battler === 1;
    const species = foe ? this.enemyDisp.species : this.leadSpecies;
    if (!species) return;
    const shiny = foe ? this.enemyDisp.shiny : this.leadShiny;
    const disp = foe ? this.enemyDisp : this.leadDisp;
    const flash = disp.flash > 0 && Math.floor(this.t * 20) % 2 ? 0.9 : 0;
    drawMon(c, species, -32, -32, { back: !foe, scale: 1, shiny, flash, alpha: (o.alpha ?? 1) * (1 - (disp.faint || 0)) });
    if (o.tint) {
      const t = tinted(monSprite(species, foe ? 'front' : 'back', shiny), '#' + [o.tint.r, o.tint.g, o.tint.b].map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join(''), 1);
      if (t) { c.save(); c.globalAlpha *= o.tint.a; c.drawImage(t, 0, 0, 64, 64, -32, -32, 64, 64); c.restore(); }
    }
  }

  drawEnemyBox(ctx, x, y) {
    const e = this.b.enemy(); const ed = this.enemyDisp;
    if (!e) return;
    pixBox(ctx, x, y, 170, 40, '#f8f8d8', '#405050', 4);
    rect(ctx, x + 3, y + 36, 164, 2, '#c8c8a0');
    const tw = this.drawOrderTagAt(ctx, true, x + 8, y + 5);
    textFit(ctx, speciesName(ed.species) + (e.shiny ? ' ★' : ''), x + 8 + tw, y + 3, (e.status ? 84 : 110) - tw, { color: 'dark' });
    if (e.status) draw(ctx, `gfx/ui/status/${e.status === 'TOX' ? 'psn' : e.status.toLowerCase()}.png`, x + 96, y + 5);
    text(ctx, 'Lv' + (ed.level || e.level), x + 164, y + 3, { align: 'right', color: 'dark' });
    text(ctx, 'HP', x + 8, y + 21, { color: 'orange', font: 'small' });
    hpBar(ctx, x + 24, y + 24, 140, ed.hp / ed.maxHp, 4);
    text(ctx, `${Math.max(0, Math.round(ed.hp)).toLocaleString()}/${ed.maxHp.toLocaleString()}`, x + 164, y + 27, { align: 'right', color: 'dark', font: 'small' });
    // party balls for trainers
    if (this.cfg.trainer) this.b.enemies.forEach((en, i) => { draw(ctx, `gfx/ui/battle/${en.hp <= 0 ? 'ball_fainted' : 'ball_ok'}.png`, x + 8 + i * 10, y + 42); });
    // stat stages
    const st = this.b.sides.enemy.stages;
    let sx = x + 8;
    for (const k of ['atk', 'def', 'spa', 'spd', 'spe', 'acc', 'eva']) if (st[k]) { const s = `${k.toUpperCase()}${st[k] > 0 ? '+' : ''}${st[k]}`; text(ctx, s, sx + (this.cfg.trainer ? 64 : 0), y + 42, { color: st[k] > 0 ? 'red' : 'blue', font: 'small' }); sx += measure(s, 'small') + 4; }
  }

  drawPlayerBox(ctx, x, y) {
    // the POKéMON on screen (during a faint that's still the one fainting, not its replacement)
    const lead = (this.dispLeadUid && G.run.party.find(m => m.uid === this.dispLeadUid)) || this.b.lead();
    if (!lead) return;
    const hp = this.partyHp[lead.uid] ?? lead.hp;
    pixBox(ctx, x, y, 166, 34, '#f8f8d8', '#405050', 4);
    const tw = this.drawOrderTagAt(ctx, false, x + 8, y + 4);
    textFit(ctx, monName(lead), x + 8 + tw, y + 2, (lead.status ? 84 : 110) - tw, { color: 'dark' });
    text(ctx, 'Lv' + lead.level, x + 160, y + 2, { align: 'right', color: 'dark' });
    hpBar(ctx, x + 24, y + 20, 92, hp / maxHp(lead), 4);
    text(ctx, 'HP', x + 8, y + 17, { color: 'orange', font: 'small' });
    text(ctx, `${Math.round(hp)}/${maxHp(lead)}`, x + 160, y + 17, { align: 'right', color: 'dark', font: 'small' });
    if (lead.status) draw(ctx, `gfx/ui/status/${lead.status === 'TOX' ? 'psn' : lead.status.toLowerCase()}.png`, x + 94, y + 4);
    const st = this.b.sides.player.stages;
    let sx = x + 4;
    for (const k of ['atk', 'def', 'spa', 'spd', 'spe', 'acc', 'eva']) if (st[k]) { const s = `${k.toUpperCase()}${st[k] > 0 ? '+' : ''}${st[k]}`; text(ctx, s, sx, y - 12, { color: st[k] > 0 ? 'red' : 'blue', font: 'small' }); sx += measure(s, 'small') + 4; }
    const ps = this.b.sides.player;
    const flags = [ps.reflect && 'REFLECT', ps.lightScreen && 'L.SCREEN', ps.protect && 'PROTECT', ps.substitute && 'SUB', ps.confused && 'CONFUSED', ps.seeded && 'SEEDED', ps.safeguard && 'SAFEGUARD'].filter(Boolean);
    if (flags.length) text(ctx, flags.join(' '), x + 4, y + 36, { color: 'gold', font: 'small' });
  }

  drawIntent(ctx, it) {
    const x = SCENE_X + 18, y = SCENE_Y + 66;
    // (FIRST! follows the move order tags: the selected cards' priority counts)
    if (this._order) it = { ...it, first: this._order.foeFirst };
    const mv = it.move;
    const w = 172;
    pixBox(ctx, x - 4, y - 2, w, 30, '#101018d0', it.kind === 'attack' ? '#ff6060' : it.kind === 'buff' ? '#60a0ff' : '#c080ff', 3);
    const en = this.b.enemy();
    if (en && (en.status === 'SLP' || en.status === 'FRZ')) {
      pixBox(ctx, x - 4, y - 2, w, 30, '#101018d0', '#60a0ff', 3);
      text(ctx, 'INTENT', x + 2, y - 1, { color: 'gray', font: 'small' });
      text(ctx, en.status === 'SLP' ? 'ASLEEP' : 'FROZEN SOLID', x + 2, y + 10, { color: 'blue', font: 'small' });
      text(ctx, 'then ' + mv.name, x + w - 10, y + 10, { align: 'right', color: 'gray', font: 'small' });
      return;
    }
    text(ctx, (it.first ? 'FIRST! ' : '') + 'INTENT', x + 2, y - 1, { color: it.first ? 'red' : 'gray', font: 'small' });
    if (G.run.ascension >= 2) {
      // A2+: the foe's move stays secret
      text(ctx, '???', x + 2, y + 10, { color: 'white', font: 'small' });
      text(ctx, 'hidden (A2)', x + w - 10, y + 10, { align: 'right', color: 'gray', font: 'small' });
      if (hover(x - 4, y - 2, w, 30)) tip('INTENT HIDDEN', `Ascension 2+: you can't see what the foe will do.\n${it.first ? 'The foe acts first: BEFORE your hand resolves.' : 'You act first: your hand resolves before the foe moves.'}`, { width: 200 });
      return;
    }
    if (it.kind === 'attack' && it.eff !== 1) {
      pixBox(ctx, x - 4, y + 26, w, 13, '#101018d0', it.eff > 1 ? '#ff6060' : '#8890a0', 3);
      text(ctx, it.eff === 0 ? 'NO EFFECT on your lead' : `${it.eff > 1 ? 'SUPER EFFECTIVE' : 'NOT VERY EFFECTIVE'} x${it.eff}`, x + w / 2 - 4, y + 27, { align: 'center', color: it.eff > 1 ? 'red' : 'gray', font: 'small' });
    }
    textFit(ctx, mv.name, x + 2, y + 10, 92, { color: 'white', font: 'small' });
    if (it.kind === 'attack') {
      rect(ctx, x + 94, y + 13, 6, 6, TYPE_COLORS[mv.type] || '#888');
      text(ctx, it.text, x + w - 10, y + 6, { align: 'right', color: 'red' });
      if (it.lethal && Math.floor(Engine.time * 3) % 2 === 0) text(ctx, 'KO!', x + w - 10, y - 1, { align: 'right', color: 'red', font: 'small' });
    } else text(ctx, it.text, x + w - 10, y + 10, { align: 'right', color: it.kind === 'buff' ? 'blue' : 'purple', font: 'small' });
    if (hover(x - 4, y - 2, w, 30)) {
      const lead = this.b.lead();
      tip(`${mv.name}`, `${mv.type} · PWR ${mv.power || '-'} · ACC ${mv.accuracy || '-'}\n${mv.desc || ''}\n${it.kind === 'attack' ? `Expected damage to ${monName(lead)}: ${it.text} HP.${it.eff !== 1 ? ` (x${it.eff} vs ${typesOf(lead).join('/')})` : ''}` : ''}\n${it.first ? 'The foe acts first: BEFORE your hand resolves.' : 'You act first: your hand resolves before the foe moves.'}`, { width: 200 });
    }
  }

  enemyTooltip(e) {
    const st = e.stats;
    const ab = e.ability ? (D.abilities[e.ability]?.name || e.ability) : '';
    const rule = (e.bossRule && BOSS_RULES[e.bossRule] ? `\n\n${BOSS_RULES[e.bossRule].name}: ${BOSS_RULES[e.bossRule].desc}` : '') + (e.forme ? `\nNow in its ${e.forme} FORME.` : '');
    const all = Object.keys(TYPE_COLORS).filter(t => D.types.chart[t]);
    const by = f => all.filter(t => f(typeEffect(t, e.types)));
    const weak4 = by(x => x >= 4), weak = by(x => x === 2), res = by(x => x > 0 && x < 1), imm = by(x => x === 0);
    const matchup = `\n\nWEAK TO: ${[...weak4.map(t => t + ' x4'), ...weak].join(', ') || 'nothing'}\nRESISTS: ${res.join(', ') || 'nothing'}${imm.length ? `\nIMMUNE TO: ${imm.join(', ')}` : ''}`;
    tip(`${speciesName(e.species)}  Lv${e.level}`, `${e.types.join('/')}  ·  ${ab}${ab && D.abilities[e.ability] ? ': ' + D.abilities[e.ability].desc : ''}\nATK ${st.atk} DEF ${st.def} SPA ${st.spa} SPD ${st.spd} SPE ${st.spe}\nMoves: ${G.run.ascension >= 2 ? '??? (hidden at A2+)' : e.moves.map(m => D.moves[m]?.name).join(', ')}${matchup}${rule}`, { width: 230, accent: TYPE_COLORS[e.types[0]] });
  }

  drawLeftPanel(ctx) {
    const b = this.b, run = G.run;
    const x = 4, w = 152;
    // score box
    panel(ctx, x, 31, w, 96);
    const sc = this.score;
    const prev = this.previewSim();
    const name = sc ? sc.name : prev ? prev.name : '';
    const lvl = sc ? sc.level : prev ? prev.level : 0;
    if (name) {
      text(ctx, name, x + w / 2, 35, { align: 'center', color: 'white' });
      if (lvl > 1) text(ctx, 'lvl ' + lvl, x + w - 6, 37, { align: 'right', color: 'gold', font: 'small' });
    } else text(ctx, 'Select cards', x + w / 2, 35, { align: 'center', color: 'gray', font: 'small' });
    const base = sc ? Math.round(sc.base) : prev?.sim ? prev.sim.base : 0;
    const bonus = sc ? sc.bonus : prev ? (prev.sim ? prev.sim.bonus : prev.bonus) : 0;
    const times = sc ? sc.times : prev?.sim ? prev.sim.times : 1;
    const foeHp = b.enemy()?.hp || 0;
    // combo bonus line
    if (name) text(ctx, bonus ? `+${Math.round(bonus)}% damage` : 'no bonus', x + w / 2, 47, { align: 'center', color: (sc?.pulseB || 1) > 1.3 ? 'white' : bonus ? 'bonus' : 'gray', font: 'small' });
    // the damage box: during a hand it counts up as cards hit, otherwise it previews the selection
    let dmg = null, final = false;
    if (sc?.total !== null && sc?.total !== undefined) { dmg = sc.total; final = true; }
    else if (sc) dmg = Math.floor(base * (1 + bonus / 100) * times);
    else if (prev && !this.busy) dmg = prev.sim ? prev.sim.damage : b.estimate(this.sel);
    // (during the animation the engine has already applied the hand, so compare with the displayed HP)
    const kills = dmg !== null && dmg > 0 && dmg >= (sc ? sc.foeHp : foeHp);
    pixBox(ctx, x + 10, 60, w - 20, 30, dmg ? THEME.dmg : '#3a4052', shade(dmg ? THEME.dmg : '#3a4052', -0.45), 3);
    text(ctx, 'DMG', x + 16, 62, { color: dmg ? 'white' : 'gray', font: 'small' });
    const pulse = (sc?.pulseT || sc?.pulse || 1) > 1.3;
    text(ctx, dmg === null ? '-' : fmt(dmg), x + w / 2 + 8, 66 - (pulse ? 5 : 0), { align: 'center', color: kills ? 'gold' : 'white', scale: pulse || final ? 2 : 1 });
    if (final && kills) for (let i = 0; i < (Math.random() < 0.3 ? 1 : 0); i++) burst(x + 20 + Math.random() * (w - 40), 96, { color: ['#ff9030', '#ffd040', '#ff4020'], n: 1, speed: 20, up: 40, grav: -30, life: 0.5 });
    // breakdown: card damage + combo/item bonus = total, and the foe's HP
    if (name && dmg !== null) {
      const parts = `${fmt(base)} from cards${bonus ? ` +${Math.round(bonus)}%` : ''}${times !== 1 ? ` x${+(+times).toFixed(2)}` : ''}`;
      text(ctx, parts, x + w / 2, 94, { align: 'center', color: 'whiteSoft', font: 'small' });
    }
    if (!sc && prev && !this.busy) {
      text(ctx, dmg ? `foe HP ${fmt(foeHp)}${kills ? '  KO!' : ''}` : 'no damage', x + w / 2, 106, { align: 'center', color: kills ? 'gold' : 'gray', font: 'small' });
      // selected STATUS cards: say they don't combo (in place of the crits note, which the tooltip keeps)
      const sts = this.sel.map(id => b.deck.hand.find(c => c.id === id)).filter(c => c && !c.faceDown).map(c => b.cardInfo(c)).filter(i => i.status).map(i => i.move.name);
      if (sts.length) text(ctx, 'STATUS cards: no combo', x + w / 2, 116, { align: 'center', color: 'purple', font: 'small', maxW: w - 8 });
      else text(ctx, 'before crits & misses', x + w / 2, 116, { align: 'center', color: 'gray', font: 'small' });
      if (hover(x, 31, w, 96)) tip(prev.name, COMBOS[prev.key].desc + `\nCombo lvl ${prev.level}: +${prev.bonus}% damage.\nEach scoring card deals POKéMON damage (level, move power, ATK vs the foe's DEF, x1.5 STAB, type matchup). Held items and badges add the rest: ${fmt(base)} x ${(1 + bonus / 100).toFixed(2)}${times !== 1 ? ` x ${+(+times).toFixed(2)}` : ''} = ${fmt(dmg || 0)}. (Assumes no crits or misses.)${sts.length ? `\nSTATUS cards (${sts.join(', ')}) take effect but never count toward a combo.` : ''}`, { width: 210 });
    } else if (!name) text(ctx, 'Pick cards to see the damage', x + w / 2, 106, { align: 'center', color: 'gray', font: 'small' });
    // battle info
    panel(ctx, x, 130, w, 52);
    text(ctx, 'DISCARDS', x + 8, 134, { color: 'gray', font: 'small' });
    text(ctx, String(b.discardsLeft), x + 8, 145, { color: 'red', scale: 1 });
    text(ctx, 'TURN', x + w / 2, 134, { align: 'center', color: 'gray', font: 'small' });
    text(ctx, String(b.turn), x + w / 2, 145, { align: 'center', color: 'white' });
    text(ctx, 'DECK', x + w - 8, 134, { align: 'right', color: 'gray', font: 'small' });
    text(ctx, `${b.deck.draw.length}/${b.deckSize()}`, x + w - 8, 145, { align: 'right', color: 'white' });
    if (DECK_RULES.freeDiscard) {
      const ready = b.freeDiscardOk(1);
      text(ctx, ready ? `FREE DISCARD READY (${DECK_RULES.freeDiscard})` : 'free discard used', x + w / 2, 158, { align: 'center', color: ready ? 'gold' : 'gray', font: 'small' });
      text(ctx, `Play up to ${b.maxPlay} · Hand ${b.handSize}`, x + w / 2, 169, { align: 'center', color: 'gray', font: 'small' });
      if (hover(x, 130, w, 52)) tip('DISCARDS', `Once per turn you may discard up to ${DECK_RULES.freeDiscard} cards for free. Bigger discards, a second discard in the same turn, and switching your lead use up one of your discards (${b.discardsLeft} left this battle).
DECK: cards left in the draw pile / cards in your lead's deck.`, { width: 200 });
    } else text(ctx, `Play up to ${b.maxPlay} · Hand ${b.handSize}`, x + w / 2, 164, { align: 'center', color: 'gray', font: 'small' });
    // party
    const leadUid = b.leadUid;
    panel(ctx, x, 185, w, Math.max(60, run.party.length * 24 + 8));
    const clickedMon = drawPartyPanel(ctx, run, x + 4, 189, w - 8, { rowH: 24, leadUid, dispHp: this.partyHp, tipX: 160, pick: b.faintSwitch && !this.busy });
    if (clickedMon && !this.busy && clickedMon.uid !== leadUid && !isFainted(clickedMon)) this.askSwitch(clickedMon);
    // action buttons under party (catch / run / bag)
    const by = 189 + run.party.length * 24 + 10;
    if (this.cfg.kind === 'wild' && !this.b.result) {
      const bw = 70;
      const en = b.enemy();
      const weak = en && (en.hp < en.maxHp * 0.5 || en.status === 'SLP' || en.status === 'FRZ' || (D.species[en.species]?.catchRate || 0) * (this.cfg.catchMult || 1) >= 180);
      const by2 = Math.min(H - 26, by);
      const pct = weak && run.totalBalls() ? Math.round(b.catchChance(Object.keys(run.balls).find(k => run.balls[k] > 0)) * 100) : 0;
      if (button(ctx, weak && run.totalBalls() && b.canCatch() ? `BALL ${pct}%` : 'BALL', x, by2, bw, 22, { color: '#d04040', font: 'small', disabled: this.busy || run.totalBalls() === 0 || !weak || !b.canCatch() })) this.chooseBall();
      if (en && hover(x, by2, bw, 22)) {
        const ball = Object.keys(run.balls).find(k => run.balls[k] > 0);
        const legend = LEGENDARY.has(en.species) && b.canCatch() ? `\n${run.legendRuleText()}` : ''; // (ONE LEGENDARY PER RUN)
        tip('CATCH', !b.canCatch() ? b.catchBlockReason() : !run.totalBalls() ? 'You have no POKé BALLS.' : !weak ? 'Weaken it below 50% HP (or put it to sleep) first.' : `${(D.species[en.species]?.catchRate || 0) * (this.cfg.catchMult || 1) >= 180 && en.hp >= en.maxHp * 0.5 ? 'Easy to catch! ' : ''}Catch chance with ${D.items[ball]?.name}: about ${Math.round(b.catchChance(ball) * 100)}%. Throwing uses your turn.${legend}`);
      }
      if (button(ctx, 'RUN', x + w - bw, Math.min(H - 26, by), bw, 22, { color: '#607080', font: 'small', disabled: this.busy || !b.canFlee() })) this.doFlee();
    }
  }

  drawHand(ctx) {
    const b = this.b;
    // draw pile
    drawCardBack(ctx, PILE_X, PILE_Y, { count: b.deck.draw.length });
    drawPileTip(this, b.deck, b.mods.peek);
    // buttons
    const can = !this.busy && this.sel.length > 0 && !this.auto;
    if (drawAutoButton(ctx, HAND_Y - 32, this.auto, { disabled: !!b.result })) this.autoSet(!this.auto);
    if (!this.stuck && button(ctx, 'HINT', AUTO.hintX, HAND_Y - 32, AUTO.hintW, 26, { color: '#6a5a90', font: 'small', disabled: this.busy || !!b.result || this.auto })) { const h = this.bestHand(); if (h) { this.sel = h.slice(); Sound.playSE('se_select'); } else this.toast = { text: 'No damaging hand: discard or switch.', t: 2 }; }
    if (this.stuck && !this.busy && !b.result) { if (button(ctx, 'PASS', W - 150, HAND_Y - 32, 72, 26, { color: THEME.play })) this.doPass(); }
    else if (button(ctx, 'ATTACK', W - 150, HAND_Y - 32, 72, 26, { color: THEME.play, disabled: !can, hotkey: null })) this.doPlay();
    const freeNow = this.sel.length > 0 && (b.freeDiscardOk(this.sel.length) || b.acroOk(this.sel.length));
    if (button(ctx, freeNow ? 'FREE DISCARD' : 'DISCARD', W - 74, HAND_Y - 32, 70, 26, { color: THEME.discard, disabled: !can || !this.canDiscard(this.sel.length), font: 'small' })) this.doDiscard();
    // cards
    this.hoverId = null;
    const ids = this.handIds;
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      const v = this.vis.get(id); const card = b.deck.hand.find(c => c.id === id);
      if (!v || !card) continue;
      if (!this.busy && inRect(v.x, v.y, i === ids.length - 1 ? CARD_W : Math.min(CARD_W, this.handPos(i + 1, ids.length)[0] - this.handPos(i, ids.length)[0]), CARD_H + 20)) this.hoverId = id;
    }
    const prev = this.previewSim();
    const shockId = b.bossRule?.key === 'LT_SURGE' ? ids.find(id => this.sel.includes(id)) : null;
    for (const id of ids) {
      const v = this.vis.get(id); const card = b.deck.hand.find(c => c.id === id);
      if (!v || !card) continue;
      const info = b.cardInfo(card);
      const stsSel = prev && info.status && !info.faceDown && this.sel.includes(id);
      drawCard(ctx, info, v.x, v.y, { selected: this.sel.includes(id), selColor: stsSel ? STATUS_SEL : null, animate: this.hoverId === id });
      if (stsSel) drawNoComboTag(ctx, v.x, v.y);
      if (prev && this.sel.includes(id) && !info.status && !prev.scoring.includes(id)) { ctx.save(); ctx.globalAlpha = 0.45; rect(ctx, v.x, v.y, CARD_W, CARD_H, '#000'); ctx.restore(); text(ctx, "won't score", v.x + CARD_W / 2, v.y + 40, { align: 'center', color: 'white', font: 'small' }); }
      if (id === shockId) { ctx.save(); ctx.globalAlpha = 0.45; rect(ctx, v.x, v.y, CARD_W, CARD_H, '#f8e030'); ctx.restore(); text(ctx, 'SHOCKED', v.x + CARD_W / 2, v.y + 52, { align: 'center', color: 'black', font: 'small' }); }
      if (card.frozen) { ctx.save(); ctx.globalAlpha = 0.35; rect(ctx, v.x, v.y, CARD_W, CARD_H, '#a0e0ff'); ctx.restore(); }
    }
    // Early battles: outline the best hand (the HINT button selects it any time).
    const showHint = !this.busy && !this.sel.length && !this.msg.active && (G.meta.hintBattles || 0) < 3 && !b.result;
    const hint = showHint ? this.bestHand() : null;
    if (hint) {
      const pulse = 0.5 + 0.5 * Math.sin(Engine.time * 5);
      for (const id of hint) { const v = this.vis.get(id); if (v) { ctx.save(); ctx.globalAlpha = 0.5 + pulse * 0.5; ctx.strokeStyle = '#f8d038'; ctx.lineWidth = 2; ctx.strokeRect(Math.round(v.x) - 2, Math.round(v.y) - 2, CARD_W + 4, CARD_H + 4); ctx.restore(); } }
    }
    // discarding cards flying off
    for (const [id, v] of this.vis) {
      if (v.state !== 'discard' || ids.includes(id) || this.playedIds.includes(id)) continue;
      const card = this.findCard(id); if (!card) continue;
      ctx.save(); ctx.globalAlpha = 0.7; drawCard(ctx, b.cardInfo(card), v.x, v.y, { ignorePlayable: true }); ctx.restore();
    }
    if (this.hoverId) {
      const card = b.deck.hand.find(c => c.id === this.hoverId);
      const v = this.vis.get(this.hoverId);
      if (card && !card.faceDown) cardTooltip(b.cardInfo(card), Math.min(286, Math.max(162, v.x - 60)), HAND_Y - 22, true);
      if (Engine.mouse.justPressed && !this.busy) this.drag = { id: this.hoverId, x0: Engine.mouse.x, moved: false };
      if (Engine.mouse.clicked && !this.dragSuppress) this.toggle(this.hoverId);
      if (Engine.mouse.rclicked) { this.sel = []; }
    }
    // the line above the hand, centred in the strip left of the AUTO / HINT buttons (x 160..407: 239px of text)
    const lineX = Math.round((160 + AUTO.x - 4) / 2);
    if (this.auto && !b.result && !this.sel.length && !this.playedIds.length) text(ctx, 'AUTO ON · STOP, Esc or right-click ends it', lineX, HAND_Y - 26, { align: 'center', color: Math.floor(Engine.time * 2) % 2 ? 'gold' : 'orange', font: 'small' });
    else if (!this.busy && b.faintSwitch && !this.msg.active) text(ctx, 'Send out a POKéMON from the left (free)', lineX, HAND_Y - 26, { align: 'center', color: 'gold', font: 'small' });
    else if (!this.busy && this.handIds.length && !this.sel.length && !this.msg.active) text(ctx, this.stuck ? 'No playable cards · discard, switch or PASS' : hint ? 'Gold = suggested hand · HINT selects · U: AUTO' : '1-5 select · A attack · D discard · U AUTO', lineX, HAND_Y - 26, { align: 'center', color: hint ? 'gold' : 'gray', font: 'small' });
  }

  // ---- side actions ---------------------------------------------------------------------
  // Best hand right now by the exact preview (used by HINT and the early-battle suggestion).
  bestHand() {
    const b = this.b;
    const key = b.turn + '|' + b.handsPlayed + '|' + b.leadUid + '|' + b.deck.hand.map(c => c.id).join(',') + '|' + (b.enemy()?.hp || 0);
    if (this._hintKey === key) return this._hint;
    this._hintKey = key;
    const ids = b.deck.hand.filter(c => !c.faceDown && b.cardInfo(c).playable).map(c => c.id);
    const e = b.enemy();
    let best = null, bv = -1;
    for (let mask = 1; mask < (1 << ids.length); mask++) {
      const s = ids.filter((_, i) => mask & (1 << i));
      if (s.length > b.maxPlay || !b.canPlay(s).ok) continue;
      const dmg = b.simulate(s)?.damage || 0;
      // lethal: fewest cards (keep the rest); otherwise most damage
      const v = e && dmg >= e.hp ? 1e9 - s.length : dmg;
      if (v > bv) { bv = v; best = s; }
    }
    this._hint = best && bv > 0 ? best : null;
    return this._hint;
  }

  // ---- AUTO: plays the HINT hand every turn (see auto.js). Input only: it selects bestHand() and calls doPlay() the
  // way a click on ATTACK does, so the battle and its RNG are untouched. Per battle (a new scene starts with it off).
  autoSet(on, why) {
    if (!!this.auto === on) return;
    this.auto = on; this.autoT = 0;
    if (on) {
      const l = this.b.lead();
      this.autoLowAck = l && l.hp / maxHp(l) < AUTO.lowHp ? { uid: l.uid, hp: l.hp } : null; // (turned on while already low)
      this.autoFaintOk = !!this.b.faintSwitch; // (turned on during a faint pick: keep the lead that was sent out)
      this.fast = true;
    } else {
      if (!this.b.result) this.fast = G.meta.settings.fast;
      if (why) { this.toast = { text: why, t: 2.4 }; Sound.playSE('se_failure'); }
    }
  }
  // Why AUTO must hand control back now (null: keep going). Wild foes turning catchable don't stop it.
  autoStopReason() {
    const b = this.b, l = b.lead();
    if (!b.faintSwitch) this.autoFaintOk = false;
    else if (!this.autoFaintOk) return 'AUTO stopped: your lead fainted · pick who goes in';
    if (l && autoLowHp(l, maxHp(l), this.autoLowAck)) return `AUTO stopped: ${monName(l)} is low on HP`;
    if (this.stuck) return 'AUTO stopped: no playable hand';
    if (!this.bestHand()) return 'AUTO stopped: no damaging hand';
    return null;
  }
  // Called from update() every frame; true = AUTO is on and owns the hand's input this frame.
  autoTick(dt) {
    const b = this.b;
    if (!this.auto) { if (autoKey() && !b.result) { this.autoSet(true); Sound.playSE('se_select'); } return false; }
    if (b.result) { this.auto = false; return true; }
    if (autoKey() || autoStopInput()) { this.autoSet(false); Sound.playSE('se_card_flip'); return true; }
    if (this.busy || this.msg.active || this.skipWait || this.drag) { this.autoT = 0; return true; }
    if (manualKey()) { this.autoSet(false); Sound.playSE('se_card_flip'); return true; }
    const why = this.autoStopReason();
    if (why) { this.autoSet(false, why); return true; }
    this.autoT += dt;
    if (this.autoT < AUTO.pick) return true;
    const h = this.bestHand();
    if (this.sel.join() !== h.join()) { this.sel = h.slice(); Sound.playSE('se_select'); this.autoT = AUTO.pick; return true; }
    if (this.autoT < AUTO.pick + AUTO.show) return true;
    this.autoT = 0;
    this.doPlay();
    if (!this.busy) this.autoSet(false, "AUTO stopped: that hand can't be played");
    return true;
  }
  // An overlay (menu, picker, modal) is a decision: AUTO stops (the scene's update() doesn't run under it).
  passiveUpdate() { if (this.auto && Engine.overlays.length) this.autoSet(false, 'AUTO stopped: a menu opened'); }

  askSwitch(mon) {
    const b = this.b;
    // your lead fainted: the switch is free and needs no confirming (the foes stay in view; see the party panel)
    if (b.faintSwitch) { this.runEvents(b.switchLead(mon.uid)); return; }
    const free = b.freeSwitches > 0;
    if (!free && b.discardsLeft <= 0) { this.toast = { text: 'Switching costs a discard — none left!', t: 2 }; return; }
    pushOverlay(new ChoiceModal({
      title: `Send out ${monName(mon)}?`, body: free ? 'This switch is free (BATON PASS).' : 'Switching your lead costs 1 discard. The new lead takes the enemy\'s hits, and your hand becomes its deck.',
      options: [{ label: 'Switch!', value: 1, color: THEME.green }, { label: 'Cancel', value: 0, color: '#806060' }],
      onClose: async (v) => { if (v === 1) await this.runEvents(b.switchLead(mon.uid)); },
    }));
  }

  chooseBall() {
    this.autoSet(false); // (throwing a ball yourself takes over from AUTO)
    const run = G.run;
    const balls = Object.entries(run.balls).filter(([, n]) => n > 0);
    if (balls.length === 1) return this.throw(balls[0][0]);
    pushOverlay(new ChoiceModal({
      title: 'Throw which BALL?', options: balls.map(([k, n]) => ({ label: `${D.items[k]?.name} x${n}  (${Math.round(this.b.catchChance(k) * 100)}%)`, value: k, color: '#d04040', tip: D.items[k]?.desc })),
      onClose: (v) => { if (v) this.throw(v); },
    }));
  }
  async throw(ball) { this.busy = true; await this.runEvents(this.b.throwBall(ball)); }
  async doFlee() { this.busy = true; await this.runEvents(this.b.flee()); }

  useConsumable(k) {
    if (this.busy) return;
    const def = CONSUMABLES[k];
    const run = G.run;
    if (!def) return;
    if (def.combo || def.sell || def.levels || def.evo || def.addCopy || def.relearn) { this.toast = { text: 'Use that outside of battle.', t: 2 }; return; }
    if (def.target === 'none' || def.reviveAll) { this.runEvents(this.b.useItem(k, null)); return; }
    pushOverlay(new PartyPicker({
      title: `Use ${D.items[k]?.name} on...`,
      filter: (m) => def.target === 'monFainted' ? (isFainted(m) ? true : 'Not fainted') : (isFainted(m) ? 'Fainted' : true),
      onClose: (m) => { if (m) this.runEvents(this.b.useItem(k, m.uid)).then(() => { for (const p of run.party) this.partyHp[p.uid] = p.hp; if (def.revive) this.b.buildRevived?.(m); }); },
    }));
  }

  showDeck() {
    pushOverlay(new DeckModal({ title: 'YOUR DECKS', battle: this.b }));
  }
}

function fmt(n) { n = Math.round(n); return n >= 100000 ? (n / 1000).toFixed(0) + 'K' : n.toLocaleString(); }
function floatTextAt(str, x, y, color) { floatText(str, x, y, { color, font: 'small', life: 1.1 }); }

// Played cards: one row below the battle scene, between the left panel and the HINT button (x 164..440), integer
// positions; 5 cards overlap a little to fit.
export function playedRowPos(i, n, y) {
  const left = 164, width = 276;
  const step = n > 1 ? Math.min(CARD_W + 4, Math.floor((width - CARD_W) / (n - 1))) : 0;
  const x0 = Math.round(left + (width - (step * (n - 1) + CARD_W)) / 2);
  return [x0 + i * step, y];
}

export function terrainImage(cfg) {
  const t = cfg.terrain || 'grass';
  if (cfg.kind === 'boss') {
    const k = cfg.trainer?.key || '';
    if (/LORELEI/.test(k)) return 'gfx/terrain/indoor_lorelei.png';
    if (/BRUNO/.test(k)) return 'gfx/terrain/indoor_bruno.png';
    if (/AGATHA/.test(k)) return 'gfx/terrain/indoor_agatha.png';
    if (/LANCE/.test(k)) return 'gfx/terrain/indoor_lance.png';
    if (/CHAMPION/.test(k)) return 'gfx/terrain/indoor_champion.png';
    if (/LEADER/.test(k)) return 'gfx/terrain/indoor_leader.png';
  }
  if (t === 'building') return 'gfx/terrain/indoor_gym.png';
  return `gfx/terrain/${t}.png`;
}

// ---- shared with the co-op battle scene ------------------------------------------------------
// A display-only wait that a click/tap or key cuts short (the scene's update() calls pollSkip).
export function skippableWait(scene, sec) {
  return new Promise(res => {
    const w = { res, done: false };
    scene.skipWait = w;
    wait(sec).then(() => skipDone(scene, w));
  });
}
function skipDone(scene, w) { if (w.done) return; w.done = true; if (scene.skipWait === w) scene.skipWait = null; w.res(); }
export function pollSkip(scene) {
  if (scene.skipWait && (Engine.mouse.clicked || keyPressed('Enter') || keyPressed(' ') || keyPressed('z'))) skipDone(scene, scene.skipWait);
}

// The draw pile (bottom right): hover shows what's left in it, a tap pins / unpins that list (touch), and while it's
// pinned a tap anywhere else only closes it. Call at the top of update(), before anything reads the click.
export const PILE_X = W - 64, PILE_Y = HAND_Y + 4;
export function pileInput(scene) {
  const m = Engine.mouse;
  if (!m.justPressed && !m.clicked) return;
  if (inRect(PILE_X, PILE_Y, CARD_W, CARD_H)) { if (m.clicked) { scene.pileOpen = !scene.pileOpen; Sound.playSE('se_select'); } }
  else if (scene.pileOpen) { if (m.clicked) scene.pileOpen = false; }
  else return;
  m.justPressed = false; m.clicked = false;
}
// Tooltip: the moves left in the draw pile as counts (sorted, so the draw order stays hidden) + the discard pile.
export function drawPileTip(scene, deck, peek) {
  const over = hover(PILE_X, PILE_Y, CARD_W, CARD_H);
  if (!over && !(scene.pileOpen && !Engine.overlays.length)) return;
  const counts = new Map();
  for (const c of deck.draw) counts.set(c.move, (counts.get(c.move) || 0) + 1);
  const TYPE_ORDER = Object.keys(TYPE_COLORS);
  const rows = [...counts].map(([k, n]) => { const mv = D.moves[k]; return { name: mv?.name || k, type: mv?.type || 'NORMAL', n }; })
    .sort((a, b) => b.n - a.n || TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type) || a.name.localeCompare(b.name));
  const cols = rows.length > 7 ? 2 : 1, perCol = Math.ceil(rows.length / cols) || 1, colW = 112, ROW = 11;
  const w = Math.max(172, cols * colW + 12);
  const nextLine = peek ? `\nNext: ${deck.draw.slice(-peek).reverse().map(c => D.moves[c.move]?.name).join(', ')}` : '';
  tip('DRAW PILE', `${deck.draw.length} card${deck.draw.length === 1 ? '' : 's'} left (order hidden).${nextLine}`, {
    width: w - 10, minW: w, x: PILE_X - 4 - w, y: PILE_Y + CARD_H, above: true,
    extraH: (rows.length ? perCol * ROW + 4 : ROW) + ROW + 2,
    extra: (ctx, x, y) => {
      if (!rows.length) text(ctx, 'Empty: the discard pile is reshuffled in.', x, y, { font: 'small', color: 'gray' });
      rows.forEach((r, i) => {
        const cx = x + Math.floor(i / perCol) * colW, cy = y + (i % perCol) * ROW;
        const tc = TYPE_COLORS[r.type] || '#888';
        pixBox(ctx, cx, cy + 2, 7, 7, tc, shade(tc, -0.5), 1);
        textFit(ctx, r.name, cx + 10, cy, colW - 36, { font: 'small', color: [shade(tc, -0.45), '#e4e0d4'] });
        text(ctx, 'x' + r.n, cx + colW - 8, cy, { font: 'small', color: 'dark', align: 'right' });
      });
      const dy = y + (rows.length ? perCol * ROW + 4 : ROW);
      rect(ctx, x, dy - 2, w - 12, 1, '#c8c4b0');
      text(ctx, `Discard pile: ${deck.discard.length}`, x, dy, { font: 'small', color: 'dark' });
    },
  });
}
