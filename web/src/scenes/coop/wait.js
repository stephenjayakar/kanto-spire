// "Waiting for your partner" (private phases after you're done) and the connecting / log-replay screen.
import { Engine, W, H, pushOverlay } from '../../engine/core.js';
import { draw } from '../../engine/assets.js';
import { text } from '../../engine/font.js';
import { swirlBackground, BG_THEMES, panel, drawTips } from '../../engine/ui.js';
import { G } from '../../game/state.js';
import { drawHUD, drawPartyPanel, DeckModal } from '../common.js';
import { PFONT, PSPRITE, drawCoopOverlay, drawPartnerChip, playerStatus, privateWhat } from './ui.js';

export class CoopWaitScene {
  constructor(session) { this.s = session; this.drawsCoopOverlay = true; }
  enter() { this.t = 0; }
  update(dt) { this.t += dt; }
  draw(ctx) {
    const s = this.s, g = s.game, me = s.mySlot, pa = s.partnerSlot;
    swirlBackground(ctx, BG_THEMES.dark, 0.5);
    const dots = '...'.slice(0, 1 + Math.floor(this.t * 2) % 3);
    if (!g || !s.synced) {
      text(ctx, `CO-OP ROOM ${s.code}`, W / 2, 120, { align: 'center', color: 'gold', scale: 2 });
      text(ctx, (g ? `Replaying the game log (#${s.lastSeq})` : 'Connecting') + dots, W / 2, 160, { align: 'center', color: 'white' });
      draw(ctx, PSPRITE[me], W / 2 - 8, 190, { sx: [0, 3, 0, 4][Math.floor(this.t * 6) % 4] * 16, sy: 0, sw: 16, sh: 32 });
      drawCoopOverlay(ctx, s);
      return;
    }
    // my run: the private clone I just finished until the log hands it back, then the canonical one
    const mine = (g.phase === 'private' && !g.private?.done?.[me] && G.run) || g.runs[me];
    drawHUD(ctx, mine, { subtitle: s.n > 2 ? 'WAITING FOR THE OTHERS' : 'WAITING FOR PARTNER', onDeck: () => pushOverlay(new DeckModal({})) });
    if (s.n > 2) { this.drawMany(ctx, mine, dots); drawTips(ctx); drawCoopOverlay(ctx, s); return; }
    const st = playerStatus(s, pa);
    text(ctx, `Waiting for ${s.nameOf(pa)}${dots}`, W / 2, 46, { align: 'center', color: PFONT[pa], scale: 1 });
    text(ctx, st.key === 'offline' ? "(they're offline; the game continues when they reconnect)" : g.phase === 'private' ? `(${privateWhat(g.private?.kind)})` : '', W / 2, 64, { align: 'center', color: 'gray', font: 'small' });
    // both teams side by side
    this.team(ctx, 70, 84, me, mine, 'YOU');
    this.team(ctx, 350, 84, pa, g.runs[pa], s.nameOf(pa));
    draw(ctx, PSPRITE[pa], W / 2 - 8, 300 + Math.sin(this.t * 3) * 2, { sx: 0, sy: 0, sw: 16, sh: 32 });
    drawTips(ctx);
    drawCoopOverlay(ctx, s);
  }
  // 3-4 players: who we're waiting for, and every team in a column (status chip on top).
  drawMany(ctx, mine, dots) {
    const s = this.s, g = s.game, me = s.mySlot;
    const waiting = s.others.filter(p => g.phase === 'private' && !g.private?.done?.[p]);
    text(ctx, waiting.length ? `Waiting for ${waiting.map(p => s.nameOf(p)).join(', ')}${dots}` : `Everyone's done${dots}`, W / 2, 46, { align: 'center', color: 'white' });
    text(ctx, g.phase === 'private' ? `(${privateWhat(g.private?.kind)})` : '', W / 2, 62, { align: 'center', color: 'gray', font: 'small' });
    const n = s.n, cw = Math.floor((W - 16) / n) - 4;
    for (let p = 0; p < n; p++) {
      const run = p === me ? mine : g.runs[p];
      if (!run) continue;
      const x = 8 + p * (cw + 4) + 2, y = 80;
      panel(ctx, x, y, cw, 30 * run.party.length + 24);
      drawPartnerChip(ctx, x + 4, y + 3, s, { slot: p, name: p === me ? 'YOU' : s.nameOf(p).slice(0, 7) });
      drawPartyPanel(ctx, run, x + 4, y + 18, cw - 8, { tipX: p < n / 2 ? x + cw + 4 : x - 204 });
      draw(ctx, PSPRITE[p], x + cw / 2 - 8, 300 + (waiting.includes(p) ? Math.sin(this.t * 3 + p) * 2 : 0), { sx: 0, sy: 0, sw: 16, sh: 32, alpha: waiting.includes(p) || p === me ? 1 : 0.6 });
    }
  }
  team(ctx, x, y, p, run, label) {
    if (!run) return;
    panel(ctx, x, y, 220, 30 * run.party.length + 24);
    if (p === this.s.partnerSlot) drawPartnerChip(ctx, x + 6, y + 3, this.s);
    else text(ctx, `P${p + 1} · ${label}`, x + 110, y + 4, { align: 'center', color: PFONT[p], font: 'small' });
    drawPartyPanel(ctx, run, x + 6, y + 18, 208, { tipX: x < 300 ? x + 224 : x - 204 });
  }
}
