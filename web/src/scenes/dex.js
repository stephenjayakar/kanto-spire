// Persistent Pokédex across runs + run history.
import { Engine, W, H, hover, setScene } from '../engine/core.js';
import { text } from '../engine/font.js';
import { swirlBackground, button, panel, pixBox, drawTips, tip, THEME } from '../engine/ui.js';
import { D, byDex } from '../game/data.js';
import { G } from '../game/state.js';
import { drawIcon, drawMon } from './common.js';
import { TitleScene } from './title.js';

export class DexScene {
  enter() { this.page = 0; this.t = 0; }
  update(dt) { this.t += dt; if (Engine.mouse.wheel) this.page = Math.max(0, Math.min(Math.floor(385 / 120), this.page + Engine.mouse.wheel)); }
  draw(ctx) {
    swirlBackground(ctx, ['#401010', '#802020', '#501818'], 0.3);
    const m = G.meta;
    text(ctx, 'POKéDEX', 12, 6, { color: 'white', scale: 2 });
    text(ctx, `SEEN ${m.dexSeen.length}  ·  CAUGHT ${m.dexCaught.length} / 386`, 160, 14, { color: 'gold' });
    const per = 120, cols = 15;
    const start = this.page * per;
    for (let i = 0; i < per; i++) {
      const n = start + i + 1;
      if (n > 386) break;
      const s = byDex[n];
      if (!s) continue;
      const x = 10 + (i % cols) * 41, y = 40 + Math.floor(i / cols) * 36;
      const caught = m.dexCaught.includes(s.key), seen = m.dexSeen.includes(s.key);
      pixBox(ctx, x, y, 38, 34, caught ? '#f8f0d8' : seen ? '#c8c0b0' : '#504848', '#201818', 3);
      if (seen || caught) drawIcon(ctx, s.key, x + 3, y - 2, { still: !caught, gray: !caught });
      text(ctx, String(n).padStart(3, '0'), x + 19, y + 23, { align: 'center', color: 'dark', font: 'small' });
      if (hover(x, y, 38, 34)) tip(seen || caught ? s.name : '??????????', seen || caught ? `${s.types.join('/')} · ${s.category} POKéMON\n${s.dexText || ''}` : 'Not yet seen.', { width: 220 });
    }
    text(ctx, `Page ${this.page + 1}/${Math.ceil(386 / per)} (scroll)`, W / 2, H - 50, { align: 'center', color: 'gray', font: 'small' });
    if (button(ctx, '<', 10, H - 30, 30, 22, { color: '#806060', disabled: this.page === 0 })) this.page--;
    if (button(ctx, '>', 44, H - 30, 30, 22, { color: '#806060', disabled: (this.page + 1) * per >= 386 })) this.page++;
    // recent runs
    const runs = m.runs.slice(0, 3);
    runs.forEach((r, i) => {
      const x = 90 + i * 180;
      pixBox(ctx, x, H - 34, 174, 30, r.result === 'lose' ? '#402020' : '#204020', '#101010', 3);
      text(ctx, `${r.result === 'lose' ? 'LOST' : 'WON'} A${r.ascension} · ACT ${r.act}`, x + 6, H - 32, { color: 'white', font: 'small' });
      r.party.slice(0, 6).forEach((sp, j) => drawIcon(ctx, sp, x + 70 + j * 17, H - 27, { still: true, scale: 0.5 })); // a clean 1/2
    });
    if (button(ctx, 'BACK', W - 80, 6, 70, 22, { color: '#806060' })) setScene(new TitleScene());
    drawTips(ctx);
  }
}

// Not part of a run: NOW PLAYING (net/presence.js) does not list you here.
DexScene.prototype.idle = true;
