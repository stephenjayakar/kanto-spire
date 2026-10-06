// FireRed bitmap font renderer (fonts.json + 2-channel R=fill/G=shadow atlases from the decomp).
import { assetUrl } from '../net/assetpack.js';
import { BASE } from './assets.js';

let META = null;
const atlases = {}; // font -> Image (rg)
const colored = new Map(); // key -> canvas

export const COLORS = {
  dark: ['#636363', '#d6d6ce'],
  white: ['#ffffff', '#636363'],
  whiteSoft: ['#f8f8f8', '#3a3a52'],
  gray: ['#a0a0a0', '#404050'],
  red: ['#e70808', '#ffbd73'],
  blue: ['#3152ce', '#a5c6f7'],
  green: ['#219c08', '#94f794'],
  gold: ['#f8d038', '#7a5a10'],
  dmg: ['#ff8a3a', '#5a2410'],
  bonus: ['#ffd84a', '#5a4410'],
  orange: ['#ff9c30', '#5a3010'],
  black: ['#202020', '#a0a0a0'],
  lime: ['#a8ff60', '#205010'],
  pink: ['#ff88c8', '#602040'],
  purple: ['#c890ff', '#402060'],
};

const ALIASES = { '"': '“', "'": '’', '`': '‘', '*': '·', '[': '(', ']': ')', '{': '(', '}': ')', '_': '-', '#': 'º', '~': '-', '@': 'º', '|': '!', '^': '·', '\\': '/' };

export async function loadFonts() {
  META = await (await fetch(BASE + 'gfx/fonts/fonts.json')).json();
  await Promise.all(Object.entries(META.fonts).map(([name, f]) => new Promise(res => {
    const im = new Image();
    im.onload = () => { atlases[name] = im; res(); };
    im.onerror = res;
    im.src = assetUrl('gfx/' + f.rg);
  })));
}

function colorAtlas(font, fill, shadow) {
  const key = font + fill + shadow;
  if (colored.has(key)) return colored.get(key);
  const src = atlases[font];
  if (!src) return null;
  const c = document.createElement('canvas');
  c.width = src.naturalWidth; c.height = src.naturalHeight;
  const x = c.getContext('2d');
  x.drawImage(src, 0, 0);
  const d = x.getImageData(0, 0, c.width, c.height);
  const p = d.data;
  const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const fc = hex(fill), sc = shadow ? hex(shadow) : null;
  for (let i = 0; i < p.length; i += 4) {
    if (p[i + 3] === 0) continue;
    if (p[i] > 128) { p[i] = fc[0]; p[i + 1] = fc[1]; p[i + 2] = fc[2]; p[i + 3] = 255; }
    else if (p[i + 1] > 128 && sc) { p[i] = sc[0]; p[i + 1] = sc[1]; p[i + 2] = sc[2]; p[i + 3] = 255; }
    else p[i + 3] = 0;
  }
  x.putImageData(d, 0, 0);
  colored.set(key, c);
  return c;
}

function codesFor(str) {
  const out = [];
  const cm = META.charMap;
  // Upper-case "POKéMON" style multi glyphs aren't needed; map chars individually.
  for (const ch0 of str) {
    let ch = ch0;
    if (ch === '→') { out.push(124); continue; }
    if (ch === '←') { out.push(123); continue; }
    if (ch === '↑') { out.push(121); continue; }
    if (ch === '↓') { out.push(122); continue; }
    if (ch === '—' || ch === '–') ch = '-';
    if (ch === '©') ch = 'º';
    if (ch === '$') ch = '¥';
    if (ch === '★') ch = '·';
    if (ch === '✓') ch = '·';
    if (ch === '⚔') ch = '!';
    if (cm[ch] === undefined && ALIASES[ch]) ch = ALIASES[ch];
    if (cm[ch] === undefined) {
      const up = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
      ch = cm[up] !== undefined ? up : '?';
    }
    out.push(cm[ch]);
  }
  return out;
}

export function measure(str, font = 'normal', scale = 1) {
  if (!META) return str.length * 6 * scale;
  const f = META.fonts[font];
  const sp = font === 'normal' ? 0 : f.fontInfo.letterSpacing;
  let w = 0;
  for (const c of codesFor(String(str))) w += (f.glyphWidths[c] ?? 6) + sp;
  return w * scale;
}

export function lineHeight(font = 'normal', scale = 1) {
  if (!META) return 14 * scale;
  return (font === 'small' ? 12 : 14) * scale;
}

// Per-glyph advances; with maxW, too-wide text is condensed by whole pixels (spaces narrow first, then
// one pixel comes off evenly spread letter gaps) so it stays crisp instead of being resampled.
function advances(codes, f, sp, maxW) {
  const adv = codes.map(c => (f.glyphWidths[c] ?? 6) + sp);
  if (maxW === undefined) return adv;
  let over = adv.reduce((a, b) => a + b, 0) - maxW;
  const space = META.charMap[' '];
  for (let pass = 0; pass < 2 && over > 0; pass++) codes.forEach((c, i) => { if (over > 0 && c === space && adv[i] > 2) { adv[i]--; over--; } });
  for (let pass = 0; pass < 2 && over > 0; pass++) {
    const gaps = codes.map((c, i) => i).filter(i => i < codes.length - 1 && codes[i] !== space);
    const n = Math.min(over, gaps.length);
    for (let k = 0; k < n; k++) adv[gaps[Math.floor((k + 0.5) * gaps.length / n)]]--;
    over -= n;
  }
  return adv;
}

// opts: font, color (preset name or [fill, shadow]), align 'left'|'center'|'right', scale, alpha, shadow=false to drop shadow,
// maxW: condense (pixel-exact) to fit this width
export function text(ctx, str, x, y, opts = {}) {
  if (!META || str === undefined || str === null) return 0;
  str = String(str);
  const font = opts.font || 'normal';
  const scale = opts.scale || 1;
  const f = META.fonts[font];
  let [fill, shadow] = Array.isArray(opts.color) ? opts.color : (COLORS[opts.color || 'dark'] || COLORS.dark);
  if (opts.shadow === false) shadow = null;
  const atlas = colorAtlas(font, fill, shadow);
  if (!atlas) return 0;
  const sp = font === 'normal' ? 0 : f.fontInfo.letterSpacing;
  const codes = codesFor(str), adv = advances(codes, f, sp, opts.maxW === undefined ? undefined : opts.maxW / scale);
  const width = adv.reduce((a, b) => a + b, 0) * scale;
  let cx = x;
  if (opts.align === 'center') cx = x - width / 2;
  else if (opts.align === 'right') cx = x - width;
  cx = Math.round(cx); y = Math.round(y);
  ctx.save();
  if (opts.alpha !== undefined) ctx.globalAlpha *= opts.alpha;
  codes.forEach((c, i) => {
    const gw = f.glyphWidths[c] ?? 6;
    const sx = (c % f.perRow) * f.cellW, sy = Math.floor(c / f.perRow) * f.cellH;
    ctx.drawImage(atlas, sx, sy, gw, f.cellH, cx, y, gw * scale, f.cellH * scale);
    cx += adv[i] * scale;
  });
  ctx.restore();
  return width;
}

export function wrap(str, maxW, font = 'normal', scale = 1) {
  const lines = [];
  for (const para of String(str).split('\n')) {
    let line = '';
    for (const word of para.split(' ')) {
      const t = line ? line + ' ' + word : word;
      if (measure(t, font, scale) > maxW && line) { lines.push(line); line = word; }
      else line = t;
    }
    lines.push(line);
  }
  return lines;
}

export function textBlock(ctx, str, x, y, maxW, opts = {}) {
  const lines = wrap(str, maxW, opts.font, opts.scale || 1);
  const lh = opts.lineHeight || lineHeight(opts.font, opts.scale || 1);
  lines.forEach((l, i) => text(ctx, l, x, y + i * lh, opts));
  return lines.length * lh;
}

// Fit text into width by switching to the small font, then truncating.
export function textFit(ctx, str, x, y, maxW, opts = {}) {
  let font = opts.font || 'normal';
  if (measure(str, font) > maxW && font === 'normal') font = 'small';
  let s = String(str);
  while (s.length > 1 && measure(s, font) > maxW) s = s.slice(0, -1);
  return text(ctx, s, x, y, { ...opts, font });
}
