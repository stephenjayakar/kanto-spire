// Co-op run over: victory (champion beaten) or wipe (both teams fainted in the same battle).
import { Engine, W, H } from '../../engine/core.js';
import { text, textFit } from '../../engine/font.js';
import { swirlBackground, BG_THEMES, button, panel, drawTips, THEME } from '../../engine/ui.js';
import { burst, drawFx } from '../../engine/fx.js';
import { Sound } from '../../audio/sound.js';
import { drawMon, drawIcon } from '../common.js';
import { PFONT, drawCoopOverlay } from './ui.js';
import { coopStarterOffers } from '../unlock.js';
import { D } from '../../game/data.js';

export class CoopEndScene {
  constructor(session) { this.s = session; this.drawsCoopOverlay = true; }
  get win() { return this.s.game?.phase === 'victory' || this.s.game?.result === 'win'; }
  enter() {
    this.t = 0;
    Sound.playBGM(this.win ? 'mus_victory_road' : 'mus_poke_tower');
    coopStarterOffers(this.s); // victory clears the last act: pick a new starter (local meta only)
  }
  update(dt) {
    this.t += dt;
    if (this.win && Math.random() < 0.2) burst(Math.random() * W, -5, { color: ['#f8d038', '#fff', '#ff8080', '#80c0ff'], n: 1, speed: 20, grav: 60, life: 3, angle: Math.PI / 2, spread: 0.5 });
  }
  // 3-4 players: one narrow column per player (icons instead of big sprites)
  drawMany(ctx) {
    const s = this.s, g = s.game, n = s.n, cw = Math.floor((W - 24) / n) - 6;
    for (let p = 0; p < n; p++) {
      const run = g?.runs?.[p], x = 12 + p * (cw + 6);
      panel(ctx, x, 62, cw, 236);
      textFit(ctx, `P${p + 1} · ${s.nameOf(p)}${p === s.mySlot ? ' (you)' : ''}`, x + 6, 68, cw - 12, { color: PFONT[p] });
      if (!run) continue;
      run.party.forEach((m, i) => {
        const cx = x + 8 + (i % 2) * Math.floor((cw - 16) / 2), cy = 86 + Math.floor(i / 2) * 52;
        drawIcon(ctx, m.species, cx, cy, { gray: m.hp <= 0, still: m.hp <= 0 });
        text(ctx, `Lv${m.level}`, cx + 34, cy + 12, { color: m.hp > 0 ? 'white' : 'gray', font: 'small' });
      });
      const st = run.stats || {};
      text(ctx, `Battles ${st.battles || 0}`, x + cw / 2, 252, { align: 'center', color: 'gray', font: 'small' });
      text(ctx, `Caught ${st.caught || 0}`, x + cw / 2, 264, { align: 'center', color: 'gray', font: 'small' });
      text(ctx, `Best ${(st.bestHand || 0).toLocaleString()}`, x + cw / 2, 276, { align: 'center', color: 'gray', font: 'small' });
    }
  }
  draw(ctx) {
    const s = this.s, g = s.game;
    swirlBackground(ctx, this.win ? BG_THEMES.gold : BG_THEMES.boss, 0.4);
    text(ctx, this.win ? 'CHAMPIONS!' : (s.n > 2 ? 'EVERY TEAM FAINTED' : 'BOTH TEAMS FAINTED'), W / 2, 14, { align: 'center', color: this.win ? 'gold' : 'red', scale: 2 });
    const w = g?.world;
    text(ctx, w ? `${w.act?.name || ''} · A${w.ascension ?? 0} · room ${s.code}` : '', W / 2, 46, { align: 'center', color: 'whiteSoft', font: 'small' });
    if (s.n > 2) this.drawMany(ctx);
    for (const p of (s.n > 2 ? [] : [0, 1])) {
      const run = g?.runs?.[p];
      const x = p === 0 ? 16 : W / 2 + 6, pw = W / 2 - 22;
      panel(ctx, x, 62, pw, 236);
      text(ctx, `P${p + 1} · ${s.nameOf(p)}${p === s.mySlot ? ' (you)' : ''}`, x + pw / 2, 68, { align: 'center', color: PFONT[p] });
      if (!run) continue;
      run.party.forEach((m, i) => {
        const cx = x + 8 + (i % 3) * 96, cy = 86 + Math.floor(i / 3) * 96;
        drawMon(ctx, m.species, cx + 12, cy, { scale: 1, shiny: m.shiny });
        text(ctx, `Lv${m.level}`, cx + 44, cy + 66, { align: 'center', color: m.hp > 0 ? 'white' : 'gray', font: 'small' });
      });
      const st = run.stats || {};
      text(ctx, `Battles ${st.battles || 0} · Caught ${st.caught || 0} · Best hand ${(st.bestHand || 0).toLocaleString()}`, x + pw / 2, 280, { align: 'center', color: 'gray', font: 'small' });
    }
    // a win at A5+ unlocks your starter's shiny form (set by coopStarterOffers)
    const sh = this.win && s.coopShiny;
    if (sh) text(ctx, `SHINY ${D.species[sh.fam]?.name || sh.fam} ${sh.isNew ? 'UNLOCKED!' : 'is yours!'} Pick it on the starter screen.`, W / 2, 299, { align: 'center', color: 'gold', font: 'small' });
    if (button(ctx, 'TITLE', W / 2 - 60, H - 52, 120, 28, { color: THEME.green })) s.stop({ toTitle: true });
    drawFx(ctx, Engine.dt);
    drawTips(ctx);
    drawCoopOverlay(ctx, s);
  }
}

// Not part of a run: NOW PLAYING (net/presence.js) does not list you here.
CoopEndScene.prototype.idle = true;
