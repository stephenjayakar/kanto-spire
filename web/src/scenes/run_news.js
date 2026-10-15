// NEW THIS RUN (v0.5.26): the end-of-run popup listing what the run added (game/run_news.js): new personal records,
// POKéMON seen / caught for the first time and held items found for the first time. Solo GAME OVER / HALL OF FAME and
// the co-op end screen. It pops up a moment after the screen opens, reveals its entries one by one (a click or a key
// shows them all at once, the next one closes it), and a NEW! chip in the corner opens it again. Nothing new: no popup,
// no chip. Presentation only.
import { Engine, W, H, hover, keyPressed, pushOverlay, popOverlay, topOverlay } from '../engine/core.js';
import { text, textFit } from '../engine/font.js';
import { button, panel, pixBox, rect, drawTips, tip, THEME } from '../engine/ui.js';
import { draw, itemPath } from '../engine/assets.js';
import { D } from '../game/data.js';
import { RELICS } from '../game/items.js';
import { animMode } from '../game/state.js';
import { newsCount } from '../game/run_news.js';
import { Sound } from '../audio/sound.js';
import { drawIcon } from './common.js';

const PW = 560, PX = (W - PW) / 2;
const ICON = 34, ITEM = 30; // grid steps: POKéMON icons (32 px), held items (24 px)
const POP = 0.22; // seconds one entry takes to pop in
const dexNo = (s) => D.species[s]?.dex || 9999;
const byDex = (a) => [...a].sort((x, y) => dexNo(x) - dexNo(y) || (x < y ? -1 : 1));
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const easeBack = (p) => { const c = 1.9; return 1 + (c + 1) * Math.pow(p - 1, 3) + c * Math.pow(p - 1, 2); };
const SKIP_KEYS = ['Enter', ' ', 'Escape', 'z', 'Z', 'x', 'X'];

// The popup's layout for a news object: sections in reveal order, each with the entries that fit on screen.
export function newsLayout(news) {
  const cols = Math.floor((PW - 28) / ICON), icols = Math.floor((PW - 28) / ITEM);
  const secs = [];
  if (news.records.length) secs.push({ kind: 'records', title: news.records.length > 1 ? 'NEW PERSONAL RECORDS' : 'NEW PERSONAL RECORD', items: news.records, h: 16 + news.records.length * 13 });
  const relics = news.relics.filter(k => RELICS[k]);
  const dex = [['caught', 'POKéDEX: CAUGHT FOR THE FIRST TIME', byDex(news.caught)], ['seen', 'POKéDEX: SEEN FOR THE FIRST TIME', byDex(news.seen)]].filter(d => d[2].length);
  // height left for the grids: title (34) + footer (36) + the records; held items get up to 2 rows, POKéMON share the rest
  let left = 340 - 34 - 36 - (secs[0]?.h || 0);
  let relicRows = 0;
  if (relics.length) { relicRows = Math.min(2, Math.ceil(relics.length / icols)); left -= 16 + relicRows * ITEM; }
  const dexRows = dex.map(d => Math.ceil(d[2].length / cols));
  let budget = Math.max(dex.length, Math.floor((left - dex.length * 16) / ICON));
  const rows = dex.map(() => 1); budget -= dex.length;
  while (budget > 0 && rows.some((r, i) => r < dexRows[i])) { for (let i = 0; i < rows.length && budget > 0; i++) if (rows[i] < dexRows[i]) { rows[i]++; budget--; } }
  dex.forEach((d, i) => {
    const cap = rows[i] * cols, more = d[2].length > cap ? d[2].length - (cap - 1) : 0;
    secs.push({ kind: d[0], title: d[1], total: d[2].length, items: more ? d[2].slice(0, cap - 1) : d[2], more, cols, h: 16 + rows[i] * ICON });
  });
  if (relics.length) {
    const cap = relicRows * icols, more = relics.length > cap ? relics.length - (cap - 1) : 0;
    secs.push({ kind: 'relics', title: relics.length > 1 ? 'NEW HELD ITEMS' : 'NEW HELD ITEM', total: relics.length, items: more ? relics.slice(0, cap - 1) : relics, more, cols: icols, h: 16 + relicRows * ITEM });
  }
  const h = 34 + secs.reduce((a, s) => a + s.h, 0) + 36;
  return { secs, h };
}

export class RunNewsOverlay {
  constructor(news, { revealed = false } = {}) {
    this.news = news;
    this.lay = newsLayout(news);
    const mode = animMode();
    const n = this.lay.secs.reduce((a, s) => a + s.items.length + (s.more ? 1 : 0), 0);
    // the whole reveal takes at most ~1.5 s (FAST: half that, INSTANT: a blink)
    const step = Math.min(0.09, 1.3 / Math.max(1, n)) * (mode === 'normal' ? 1 : mode === 'fast' ? 0.5 : 0.1);
    let at = mode === 'instant' ? 0.05 : 0.3, i = 0;
    this.times = this.lay.secs.map(s => { at += step * 2; return [...s.items, ...(s.more ? [null] : [])].map(() => at + step * i++); });
    this.end = at + step * i + POP;
    this.t = revealed ? this.end : 0;
  }
  enter() { Sound.playSE(this.news.records.length ? 'se_shiny' : 'se_ball_open'); }
  get revealing() { return this.t < this.end; }
  update(dt) {
    this.t += dt;
    const go = Engine.mouse.clicked || Engine.mouse.rclicked || SKIP_KEYS.some(k => keyPressed(k));
    if (!go) return;
    if (this.revealing) { this.t = this.end; Engine.mouse.clicked = false; }
    else this.close();
  }
  close() { popOverlay(this); this.onClose?.(); }
  // 0..1 progress of entry j of section i, and its pop scale
  pop(i, j) { const p = clamp01((this.t - this.times[i][j]) / POP); return { p, s: p >= 1 ? 1 : easeBack(p) }; }
  draw(ctx) {
    ctx.save(); ctx.globalAlpha = Math.min(0.65, this.t * 4); rect(ctx, 0, 0, W, H, '#000'); ctx.restore();
    const { secs, h } = this.lay, y0 = Math.round((H - h) / 2);
    const open = clamp01(this.t / 0.18), sc = 0.85 + 0.15 * easeBack(open);
    ctx.save();
    ctx.translate(W / 2, y0 + h / 2); ctx.scale(sc, sc); ctx.translate(-W / 2, -(y0 + h / 2));
    ctx.globalAlpha *= open;
    panel(ctx, PX, y0, PW, h);
    pixBox(ctx, PX + 4, y0 + 4, PW - 8, 26, '#3a3010', '#f8d038', 3);
    const bob = Math.round(Math.sin(Engine.time * 4) * 1.5);
    text(ctx, 'NEW THIS RUN!', W / 2, y0 + 7 + bob, { align: 'center', color: 'gold', scale: 2 });
    let y = y0 + 34;
    secs.forEach((s, i) => {
      const head = s.total > 1 || s.more ? `${s.title} · ${s.total}` : s.title;
      text(ctx, head, PX + 14, y + 2, { color: s.kind === 'records' ? 'gold' : s.kind === 'relics' ? 'orange' : 'lime', font: 'small' });
      rect(ctx, PX + 14, y + 13, PW - 28, 1, '#ffffff22');
      const top = y + 16;
      if (s.kind === 'records') s.items.forEach((r, j) => this.drawRecord(ctx, r, top + j * 13, this.pop(i, j)));
      else {
        const step = s.kind === 'relics' ? ITEM : ICON;
        [...s.items, ...(s.more ? [null] : [])].forEach((k, j) => {
          const x = PX + 14 + (j % s.cols) * step, yy = top + Math.floor(j / s.cols) * step;
          const pp = this.pop(i, j);
          if (pp.p <= 0) return;
          ctx.save();
          const c = step / 2;
          ctx.translate(x + c, yy + c); ctx.scale(pp.s, pp.s); ctx.translate(-(x + c), -(yy + c));
          ctx.globalAlpha *= clamp01(pp.p * 3);
          if (k === null) text(ctx, `+${s.more}`, x + c, yy + c - 5, { align: 'center', color: 'white', font: 'small' });
          else if (s.kind === 'relics') { pixBox(ctx, x + 1, yy + 1, 28, 28, '#f8f0d8', '#c89a20', 3); draw(ctx, itemPath(k), x + 3, yy + 3); }
          else drawIcon(ctx, k, x + 1, yy + 1, { alpha: s.kind === 'seen' ? 0.85 : 1 });
          ctx.restore();
          if (k !== null && pp.p > 0 && pp.p < 1) this.sparkle(ctx, x + step - 6, yy + 4, pp.p);
          if (k !== null && pp.p >= 1 && hover(x, yy, step, step)) {
            if (s.kind === 'relics') tip(RELICS[k].name, RELICS[k].desc, { width: 220 });
            else tip(D.species[k]?.name || k, s.kind === 'caught' ? 'Caught for the first time! Now in your POKéDEX.' : 'Seen for the first time. Catch it in a later run!');
          }
        });
      }
      y += s.h;
    });
    const label = this.revealing ? 'SKIP' : 'OK';
    button(ctx, label, W / 2 - 50, y0 + h - 30, 100, 22, { color: this.revealing ? '#506080' : THEME.green });
    ctx.restore();
    drawTips(ctx);
  }
  drawRecord(ctx, r, y, { p }) {
    if (p <= 0) return;
    ctx.save();
    ctx.globalAlpha *= clamp01(p * 2);
    const dx = Math.round((1 - easeBack(p)) * -30), x = PX + 18 + dx;
    if (p < 1) rect(ctx, PX + 10, y - 1, (PW - 20) * p, 13, '#f8d03833');
    text(ctx, 'NEW!', x, y, { color: Math.floor(Engine.time * 4) % 2 ? 'gold' : 'white', font: 'small' });
    textFit(ctx, r.label, x + 32, y, 200, { color: 'white', font: 'small' });
    text(ctx, r.text, x + 240, y, { color: 'gold', font: 'small' });
    if (r.prevText) text(ctx, `(was ${r.prevText})`, PX + PW - 16, y, { align: 'right', color: 'gray', font: 'small' });
    ctx.restore();
  }
  sparkle(ctx, x, y, p) {
    const a = Math.sin(p * Math.PI), r = Math.round(1 + a * 3);
    ctx.save(); ctx.globalAlpha *= a;
    rect(ctx, x - r, y, r * 2 + 1, 1, '#ffffff'); rect(ctx, x, y - r, 1, r * 2 + 1, '#ffffff');
    ctx.restore();
  }
}

// For an end screen (scene.news = the news, or null): call newsTick(scene, dt) from update() and newsChip(ctx, scene)
// from draw(). The popup opens by itself once, after `delay` s and once no other popup is up (e.g. a starter offer).
export function newsTick(scene, dt, delay = 0.6) {
  if (!newsCount(scene.news) || scene.newsShown) return;
  scene.newsWait = (scene.newsWait || 0) + dt;
  if (scene.newsWait < (animMode() === 'normal' ? delay : 0.2) || topOverlay()) return;
  scene.newsShown = true;
  pushOverlay(new RunNewsOverlay(scene.news));
}
export function newsChip(ctx, scene, x = W - 78, y = H - 56) {
  const n = newsCount(scene.news);
  if (!n || !scene.newsShown) return;
  const glow = 0.5 + 0.5 * Math.sin(Engine.time * 5);
  ctx.save(); ctx.globalAlpha *= 0.35 * glow; pixBox(ctx, x - 2, y - 2, 70, 28, '#f8d038', null, 4); ctx.restore();
  if (button(ctx, `NEW! ${n}`, x, y, 66, 24, { color: '#c89a20' })) pushOverlay(new RunNewsOverlay(scene.news, { revealed: true }));
  if (hover(x, y, 66, 24)) tip('NEW THIS RUN', 'Records, POKéDEX entries and held items this run added.');
}
