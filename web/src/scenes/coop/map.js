// Co-op act map: the shared map (game.world), votes instead of walking. Reuses MapScene's drawing.
import { pushOverlay } from '../../engine/core.js';
import { draw } from '../../engine/assets.js';
import { text } from '../../engine/font.js';
import { swirlBackground, BG_THEMES, panel, pixBox, drawTips, tip, THEME, button } from '../../engine/ui.js';
import { hover, H } from '../../engine/core.js';
import { G } from '../../game/state.js';
import { NODE_INFO } from '../../game/map.js';
import { CONSUMABLES } from '../../game/items.js';
import { D } from '../../game/data.js';
import { regionOf } from '../../game/regions.js';
import { isFainted, maxHp } from '../../game/pokemon.js';
import { MAP_ITEM_OK } from '../../game/coop/coop.js';
import { Sound } from '../../audio/sound.js';
import { MapScene } from '../map.js';
import { drawHUD, drawPartyPanel, drawMon, drawIcon, DeckModal, MessageBox, ChoiceModal, PartyPicker } from '../common.js';
import { PCOL, PFONT, PSPRITE, drawCoopOverlay, drawPartnerChip, playerStatus, teamHpFrac, coopToast } from './ui.js';
import { coopStarterOffers } from '../unlock.js';

export class CoopMapScene extends MapScene {
  constructor(session) { super({}); this.s = session; this.drawsCoopOverlay = true; }
  mapRun() { return this.s.game.world; }
  enter() {
    const w = this.mapRun();
    this.t = 0;
    this.msg = new MessageBox();
    this.busy = false;
    this.walk = null;
    const act = w.act;
    const prog = Math.max(0, w.floor) / act.floors;
    Sound.playBGM(act.music[Math.min(act.music.length - 1, Math.floor(prog * act.music.length))]);
    this.scroll = this.targetScroll();
    coopStarterOffers(this.s); // an act was cleared: each player picks a new starter (local meta only)
  }
  canPick() { return !this.s.desync && this.s.game.phase === 'map' && !this.s.stopped; }
  // sketches: mine go to the partner, theirs show in their colour (session side channel)
  mySketch() { return this.s.mySketch(this.mapRun().actIndex); }
  otherSketches() { return this.s.partnerSketches(this.mapRun().actIndex); }
  sketchColor() { return PCOL[this.s.mySlot]; }
  saveSketch() { this.s.sendSketch(); }
  eraseSketches() { this.stroke = null; this.s.eraseSketches(this.mapRun().actIndex); }
  pickNode(n) {
    if (this.s.game.votes?.[this.s.mySlot] === n.id) return;
    Sound.playSE('se_select');
    this.s.vote(n.id);
  }
  // Who voted where (P1-P4 tags above the node; our own click shows at once, dimmed until confirmed).
  voters(n) {
    const g = this.s.game, me = this.s.mySlot, out = [];
    for (let p = 0; p < this.s.n; p++) {
      const v = g.votes?.[p];
      if (v === n.id) out.push({ p, pending: false });
      else if (p === me && v == null && this.s.pendingVote === n.id) out.push({ p, pending: true });
    }
    return out;
  }
  drawNodeExtras(ctx, n, x, y) {
    const vs = this.voters(n);
    const step = vs.length > 2 ? 17 : 20; // (four tags still fit over one node)
    vs.forEach(({ p, pending }, i) => {
      const tx = Math.round(x - (vs.length * step - 2) / 2 + i * step), ty = y + 6;
      ctx.save(); if (pending) ctx.globalAlpha = 0.5 + 0.3 * Math.sin(this.t * 8);
      pixBox(ctx, tx, ty, 18, 12, PCOL[p], '#101018', 2);
      text(ctx, `P${p + 1}`, tx + 9, ty, { align: 'center', color: 'white', font: 'small' });
      ctx.restore();
    });
  }
  // Every trainer stands on the current node (mine in front).
  drawPlayer(ctx, px, py, frame) {
    const me = this.s.mySlot, others = this.s.others;
    if (others.length === 1) draw(ctx, PSPRITE[others[0]], px - 2, py - 31, { sx: frame * 16, sy: 0, sw: 16, sh: 32, alpha: 0.9 });
    else others.forEach((p, i) => draw(ctx, PSPRITE[p], px - 18 + i * 10, py - 33, { sx: frame * 16, sy: 0, sw: 16, sh: 32, alpha: 0.9 }));
    draw(ctx, PSPRITE[me], px - 10, py - 30, { sx: frame * 16, sy: 0, sw: 16, sh: 32 });
  }
  draw(ctx) {
    const s = this.s, g = s.game, me = s.mySlot;
    const world = this.mapRun();
    const run = g.runs[me];
    G.run = run; // read-only view for the HUD / deck viewer (the canonical run object may be replaced by apply)
    const act = world.act;
    swirlBackground(ctx, act.id === 5 ? BG_THEMES.water : act.id === 4 ? BG_THEMES.cave : BG_THEMES[regionOf(act.region).mapTheme], 0.4);
    const hovered = this.drawMapColumn(ctx, world);

    drawHUD(ctx, run, { onDeck: () => pushOverlay(new DeckModal({})), onMenu: () => coopMenu(s), onConsumableClick: (k) => this.useItem(k), noToss: true });
    panel(ctx, 4, 32, 154, 30 * run.party.length + 22);
    text(ctx, 'YOUR TEAM', 81, 34, { align: 'center', color: PFONT[me], font: 'small' });
    const m = drawPartyPanel(ctx, run, 8, 48, 146, { showExp: true, tipX: 162, leadUid: run.party[0]?.uid });
    if (m) this.setLead(m);
    text(ctx, 'Click to set lead', 81, 52 + 30 * run.party.length, { align: 'center', color: 'gray', font: 'small' });
    this.drawSketchButtons(ctx);

    this.drawBossPanel(ctx);
    this.drawPartnerPanel(ctx, 482, 186, 154, 132);
    this.drawVoteStatus(ctx);
    drawSaveQuit(ctx, s, 8, H - 62, 146);
    this.drawNodeTip(hovered);
    drawTips(ctx);
    drawCoopOverlay(ctx, s);
  }
  // Party order and bag items are part of the shared game state: they go through the action log.
  setLead(mon) {
    const run = this.s.game.runs[this.s.mySlot];
    if (!this.canPick() || run.party[0] === mon || !run.party.includes(mon)) return;
    Sound.playSE('se_select');
    this.s.post({ type: 'setLead', uid: mon.uid });
  }
  useItem(key) {
    const def = CONSUMABLES[key];
    if (!def || !this.canPick()) return;
    if (!MAP_ITEM_OK(def)) { coopToast(`${D.items[key]?.name || key}: use it in battle or at a reward / shop screen.`, { t: 3 }); return; }
    const post = (uid) => { Sound.playSE('se_use_item'); this.s.post({ type: 'mapItem', key, uid }); };
    if (def.reviveAll) return post(null);
    pushOverlay(new PartyPicker({
      title: `Use ${D.items[key]?.name || key} on...`,
      filter: (m) => {
        if (def.target === 'monFainted' || (def.revive && !def.heal)) return isFainted(m) ? true : 'Not fainted';
        if (isFainted(m) && !def.revive) return 'Fainted';
        if ((def.heal || def.healFrac) && m.hp >= maxHp(m) && !def.cure) return 'HP is full';
        if (def.cure && !def.heal && !def.healFrac && !m.status) return 'No status';
        return true;
      },
      onClose: (m) => { if (m) post(m.uid); },
    }));
  }
  drawVoteStatus(ctx) {
    const s = this.s, g = s.game, me = s.mySlot;
    const mine = g.votes?.[me] ?? s.pendingVote;
    const x = 172, w = 296, y = 34;
    let label, col = '#18243a', border = '#2a3a50';
    if (s.desync) label = 'Voting paused: resync first';
    else if (mine != null) {
      const n = g.world.map.nodes[mine];
      const what = n ? (n.type === 'boss' ? 'BOSS' : NODE_INFO[n.type]?.name || n.type) : '?';
      const waiting = s.others.filter(p => g.votes?.[p] == null && !g.away?.[p]);
      const dots = '...'.slice(0, 1 + Math.floor(this.t * 2) % 3);
      label = !waiting.length ? `You: ${what}  ·  resolving...` : s.n > 2 ? `You: ${what}  ·  waiting for ${waiting.map(p => 'P' + (p + 1)).join(', ')}` + dots : `You: ${what}  ·  WAITING FOR PARTNER` + dots;
      col = '#1c3020'; border = '#38b048';
    } else {
      const voted = s.others.filter(p => g.votes?.[p] != null);
      label = !voted.length ? (s.n > 2 ? 'Click a glowing node to vote (most votes wins).' : 'Click a glowing node to vote for the next stop.') : s.n > 2 ? `${voted.map(p => 'P' + (p + 1)).join(', ')} voted. Click a glowing node to vote.` : `${s.nameOf(s.partnerSlot)} voted. Click a glowing node to vote.`;
    }
    pixBox(ctx, x, y, w, 20, col, border, 3);
    text(ctx, label, x + w / 2, y + 4, { align: 'center', color: 'white', font: 'small' });
  }
  drawPartnerPanel(ctx, x, y, w, h) {
    if (this.s.n > 2) return this.drawPartnersPanel(ctx, x, y, w, h);
    const s = this.s, p = s.partnerSlot, run = s.game.runs[p];
    panel(ctx, x, y, w, h);
    text(ctx, 'PARTNER', x + w / 2, y + 4, { align: 'center', color: 'white', font: 'small' });
    drawPartnerChip(ctx, x + 6, y + 18, s, { compact: false });
    if (!run) return;
    const lead = run.party[0];
    if (lead) drawIcon(ctx, lead.species, x + 10, y + 32);
    const hp = Math.round(teamHpFrac(run) * 100);
    text(ctx, `Team HP ${hp}%`, x + 54, y + 40, { color: hp > 50 ? 'lime' : hp > 20 ? 'gold' : 'red', font: 'small' });
    text(ctx, '$' + run.money.toLocaleString(), x + 54, y + 52, { color: 'gold', font: 'small' });
    text(ctx, `${run.relics?.length || 0} held · ${run.badges?.length || 0} badges`, x + 54, y + 64, { color: 'gray', font: 'small' });
    run.party.slice(0, 6).forEach((m, i) => drawIcon(ctx, m.species, x + 2 + i * 25, y + 82, { gray: m.hp <= 0, still: m.hp <= 0 }));
    const st = playerStatus(s, p);
    if (st.detail) text(ctx, st.detail, x + w / 2, y + h - 14, { align: 'center', color: 'gray', font: 'small' });
  }
}

// 3-4 players: one compact block per other player (status chip, lead, team HP, team icons).
CoopMapScene.prototype.drawPartnersPanel = function (ctx, x, y, w, h) {
  const s = this.s, others = s.others;
  const bh = 46, top = y; // (three partners run below the usual panel, down to y 346)
  panel(ctx, x, top, w, Math.max(h, others.length * (bh + 2) + 16));
  text(ctx, 'PARTNERS', x + w / 2, top + 3, { align: 'center', color: 'white', font: 'small' });
  others.forEach((p, i) => {
    const by = top + 15 + i * (bh + 2), run = s.game.runs[p];
    drawPartnerChip(ctx, x + 4, by, s, { slot: p, name: s.nameOf(p).slice(0, 7) });
    if (!run) return;
    const hp = Math.round(teamHpFrac(run) * 100);
    text(ctx, `HP ${hp}%`, x + 4, by + 16, { color: hp > 50 ? 'lime' : hp > 20 ? 'gold' : 'red', font: 'small' });
    run.party.slice(0, 6).forEach((m, j) => drawIcon(ctx, m.species, x + 38 + j * 19, by + 10, { gray: m.hp <= 0, still: true }));
    if (hover(x, by, w, bh)) tip(`P${p + 1} · ${s.nameOf(p)}`, `${playerStatus(s, p).detail}\nTeam HP ${hp}% · ${run.money.toLocaleString()} · ${run.relics?.length || 0} held · ${run.badges?.length || 0} badges\n${run.party.map(m => `${D.species[m.species]?.name} Lv${m.level}`).join(', ')}`, { width: 210 });
  });
};

// SAVE & QUIT (v0.3.6): saves the game (a checkpoint on the map) and goes back to the title; REJOIN resumes it.
export function drawSaveQuit(ctx, session, x, y, w = 90) {
  const busy = !!session.quitting;
  if (button(ctx, busy ? 'SAVING...' : 'SAVE & QUIT', x, y, w, 18, { color: '#506080', font: 'small', disabled: busy || session.stopped })) session.saveAndQuit();
  if (hover(x, y, w, 18)) tip('SAVE & QUIT', 'Save this co-op game and go back to the title. REJOIN it from the CO-OP lobby to continue; your partners see that you saved.');
}

export function coopMenu(session) {
  pushOverlay(new ChoiceModal({
    title: 'CO-OP MENU', body: `Room ${session.code || '?'} · you are P${session.mySlot + 1}. SAVE & QUIT keeps the game: REJOIN it from the CO-OP lobby.`,
    options: [{ label: 'Resume', value: 0, color: THEME.green }, { label: 'Settings', value: 1, color: '#506080' }, { label: 'SAVE & QUIT', value: 2, color: THEME.discard }],
    onClose: async (v) => {
      if (v === 1) { const { SettingsModal } = await import('../title.js'); pushOverlay(new SettingsModal({})); }
      if (v === 2) session.saveAndQuit();
    },
  }));
}
