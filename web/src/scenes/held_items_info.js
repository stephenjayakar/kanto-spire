// HELD ITEMS tab of the INFO screen (scenes/common.js InfoModal): every held item in the game, read straight off
// game/items.js RELICS (name, art, desc, rarity), so a new item shows up here on its own. Where it comes from:
//   common / uncommon / rare  the shared pool (Run.relicChoices: MARTS at RELIC_PRICE, elite / boss / rival rewards,
//                             ITEM BALLS, "?" events); a starter's own item (acts.js STARTERS item) is named too
//   legendary                 only its legendary (acts.js BIRDS, johto.js JOHTO_BIRDS) or mythic (acts.js MYTHICS item)
//   curse                     "?" events as a cost (events.js addCurse), removed by a CENTER's CLEANSE
// v0.5.6: FOUND marks the items this player has ever had (meta.relicsFound, state.js relicsFound; the Pokédex's HELD
// ITEMS page shows the same), and a SEARCH box filters the list (name, effect, rarity, where it comes from).
// Display only: reads G.run (the player's own run, or their view in co-op) to tag the items they hold.
import { Engine, W } from '../engine/core.js';
import { draw, itemPath, tinted } from '../engine/assets.js';
import { text, wrap, measure } from '../engine/font.js';
import { pixBox, rect, scrollArea, button } from '../engine/ui.js';
import { D, speciesName } from '../game/data.js';
import { RELICS, RELIC_PRICE } from '../game/items.js';
import { BIRDS, STARTERS, MYTHICS } from '../game/acts.js';
import { G, relicsFound } from '../game/state.js';

export const GROUPS = [
  { id: 'common', label: 'COMMON', color: ['#c8c8c8', '#404050'] },
  { id: 'uncommon', label: 'UNCOMMON', color: ['#58a8f8', '#1a3450'] },
  { id: 'rare', label: 'RARE', color: ['#f8d038', '#7a5a10'] },
  { id: 'legendary', label: 'LEGENDARY', color: ['#ff9c30', '#5a3010'], note: 'only from beating its legendary or mythic POKéMON' },
  { id: 'curse', label: 'CURSE', color: ['#c890ff', '#402060'], note: "the price of some ? events  ·  CLEANSE at a POKéMON CENTER" },
];
export const groupOf = (r) => (r.curse ? 'curse' : r.legendary ? 'legendary' : r.rarity);

const INTRO = 'Every held item in the game. COMMON, UNCOMMON and RARE items come from POKé MARTS, ELITE, BOSS and rival rewards, ITEM BALLS and ? events (rarer ones turn up less often). You can hold any number. HELD = yours now, FOUND = you have had it in a run.';
const COOP = "CO-OP: every player has their own held items, and each one only powers its owner's POKéMON and hands. At a legendary node every player picks either legendary's held item, whichever one they catch. A mythic ? event offers its own held item and rare ones to everyone who fought it.";

const NAME_W = 92, LH = 11, ICON_W = 30, SEARCH_H = 18;

// Where an item comes from, when it's more specific than its group.
export function sourceOf(key) {
  const out = [];
  const bird = Object.entries(BIRDS).find(([, b]) => b.item === key);
  if (bird) out.push(`Beat ${speciesName(bird[0].replace(/^LEGEND_/, ''))}.`);
  const myth = Object.values(MYTHICS).find(m => m.item === key);
  if (myth) out.push(`Beat ${speciesName(myth.species)} (a rare ? event).`);
  const st = STARTERS.filter(s => s.item === key).map(s => speciesName(s.species));
  if (st.length) out.push(`${st.join(' and ')} start${st.length > 1 ? '' : 's'} with it.`);
  return out.join(' ');
}

const itemName = (key) => D.items[key]?.name || RELICS[key]?.name || key.replace(/_/g, ' ');
const sortKey = (n) => n.replace(/[^A-Z0-9 ]/gi, ''); // ({POKEBLOCK} CASE sorts under P)

// Every held item in display order (by group, then name): [{ key, name, group }]. The Pokédex's HELD ITEMS page uses it too.
let ORDER = null;
export function relicList() {
  if (ORDER) return ORDER;
  const all = Object.entries(RELICS).map(([key, r]) => ({ key, name: itemName(key), group: groupOf(r) })).filter(x => GROUPS.some(g => g.id === x.group));
  all.sort((a, b) => GROUPS.findIndex(g => g.id === a.group) - GROUPS.findIndex(g => g.id === b.group) || sortKey(a.name).localeCompare(sortKey(b.name)));
  return (ORDER = all);
}

// The list, wrapped once (the items never change during a session; the desc column has a fixed width).
let LIST = null;
function build(textW) {
  const sections = GROUPS.map(g => ({ ...g, items: [] }));
  for (const { key, name, group } of relicList()) {
    const r = RELICS[key], sec = sections.find(s => s.id === group);
    const where = sourceOf(key);
    sec.items.push({
      key, curse: !!r.curse, name,
      find: `${name} ${key.replace(/_/g, ' ')} ${r.desc} ${where} ${sec.label}`.toUpperCase(), // (what SEARCH matches)
      nameLines: wrap(name, NAME_W, 'small'),
      lines: [...wrap(r.desc, textW, 'small').map(l => [l, 'whiteSoft']), ...(where ? wrap(where, textW, 'small').map(l => [l, 'gray']) : [])],
    });
  }
  return sections.filter(s => s.items.length);
}

function drawHeader(ctx, s, items, found, lx, cy, lw, filtered) {
  let hx = lx + 2 + text(ctx, s.label, lx + 2, cy, { font: 'small', color: s.color });
  const parts = [filtered ? `${items.length} of ${s.items.length}` : `${s.items.length} item${s.items.length > 1 ? 's' : ''}`, `found ${s.items.filter(it => found.has(it.key)).length}`];
  if (RELIC_PRICE[s.id]) parts.push(`MART price $${RELIC_PRICE[s.id].toLocaleString()}`);
  if (s.note) parts.push(s.note);
  hx += measure(' ', 'small');
  text(ctx, '·  ' + parts.join('  ·  '), hx, cy, { font: 'small', color: 'gray' });
  rect(ctx, lx, cy + 12, lw, 1, s.color[0] + '55');
}

function drawNote(ctx, str, lx, cy, lw, visible) {
  const lines = wrap(str, lw - 16, 'small'), rh = lines.length * LH + 6;
  if (visible(cy, rh)) {
    pixBox(ctx, lx, cy, lw, rh, '#1e2432', '#141820', 3);
    lines.forEach((l, i) => text(ctx, l, lx + 8, cy + 3 + i * LH, { font: 'small', color: 'gray' }));
  }
  return cy + rh + 3;
}

// ---- SEARCH (v0.5.6) ----------------------------------------------------------------------------------------------
// Type anywhere on the tab (letters, digits, space; BACKSPACE deletes, ESC clears: InfoModal), or tap the box: it is a real
// <input> laid over the canvas (like the trainer name prompt), so phones get their keyboard. m.query keeps the text.
const MAX_Q = 24;
function typeKeys(m) {
  if (m.input && document.activeElement === m.input) return; // (the <input> has the keys)
  if (Engine.keys.has('Control') || Engine.keys.has('Meta') || Engine.keys.has('Alt')) return;
  for (const k of Engine.pressed) {
    if (k === 'Backspace') m.query = (m.query || '').slice(0, -1);
    else if (k.length === 1 && /[A-Za-z0-9 '.\-é]/.test(k) && (m.query || '').length < MAX_Q) m.query = ((m.query || '') + k).toUpperCase();
  }
  if (m.input && m.input.value !== (m.query || '')) m.input.value = m.query || '';
}
function placeInput(m, bx, by, bw, bh) {
  if (typeof document === 'undefined') return;
  const canvas = Engine.canvas || document.getElementById('game');
  if (!canvas) return;
  if (!m.input) {
    const el = m.input = document.createElement('input');
    el.type = 'search'; el.maxLength = MAX_Q; el.placeholder = 'SEARCH'; el.value = m.query || '';
    el.setAttribute('aria-label', 'Search held items'); el.autocomplete = 'off'; el.spellcheck = false;
    el.addEventListener('input', () => { m.query = el.value.toUpperCase().slice(0, MAX_Q); m.scroll = 0; });
    el.addEventListener('keydown', e => {
      e.stopPropagation(); // (the game's keys stay out of it)
      if (e.key === 'Escape' || e.key === 'Enter') { if (e.key === 'Escape') { el.value = ''; m.query = ''; } el.blur(); }
    });
    document.body.appendChild(el);
  }
  const r = canvas.getBoundingClientRect(), s = r.width / W;
  const key = `${r.left}|${r.top}|${s}|${bx}|${by}`;
  if (m.inputKey === key) return;
  m.inputKey = key;
  Object.assign(m.input.style, {
    position: 'fixed', left: `${r.left + bx * s}px`, top: `${r.top + by * s}px`, width: `${bw * s}px`, height: `${bh * s}px`,
    font: `${Math.max(10, 10 * s)}px monospace`, padding: `0 ${4 * s}px`, boxSizing: 'border-box', textTransform: 'uppercase',
    background: '#10141c', color: '#f8f8f8', border: `${Math.max(1, s)}px solid #58a8f8`, borderRadius: `${2 * s}px`, outline: 'none', zIndex: 20,
  });
}
// Removes the search <input> (InfoModal calls it when the tab or the screen closes; the query is kept).
export function closeHeldItemsSearch(m) {
  if (!m?.input) return;
  m.input.remove();
  m.input = null; m.inputKey = null;
  Engine.canvas?.focus?.();
}
// ESC on the tab clears a search before it closes the screen (InfoModal.update). -> true if it cleared one.
export function clearHeldItemsSearch(m) {
  if (!m?.query) return false;
  m.query = ''; m.scroll = 0;
  if (m.input) m.input.value = '';
  return true;
}

// Draws the tab into the panel (x, y, w, h); `m` keeps the scroll position and the search. Like the STATUSES tab, the
// list ends 50px above the panel's bottom so scrollArea's "scroll for more" hint clears the CLOSE button.
export function drawHeldItemsInfo(ctx, m, x, y, w, h) {
  const lx = x + 10, lw = w - 26;
  const sy = y + 32, top = sy + SEARCH_H + 4, bottom = y + h - 50;
  const tx = lx + ICON_W + NAME_W + 4, textW = lw - (tx - lx) - 8;
  LIST ||= build(textW);
  const run = G.run, found = relicsFound();
  // search row: the box (the <input> sits on it), the count, a clear button
  typeKeys(m);
  const q = (m.query || '').trim(), words = q.split(/\s+/).filter(Boolean);
  const match = (it) => words.every(wd => it.find.includes(wd));
  const bx = lx, bw = 200;
  pixBox(ctx, bx, sy, bw, SEARCH_H, '#10141c', '#58a8f8', 2);
  if (!m.input) text(ctx, q || 'SEARCH (type a name or effect)', bx + 5, sy + 4, { font: 'small', color: q ? 'white' : 'gray' });
  placeInput(m, bx, sy, bw, SEARCH_H);
  const total = relicList().length;
  const shown = words.length ? LIST.reduce((n, s) => n + s.items.filter(match).length, 0) : total;
  let rx = bx + bw + 8;
  if (q) { if (button(ctx, 'CLEAR', rx, sy, 44, SEARCH_H, { color: '#506080', font: 'small' })) clearHeldItemsSearch(m); rx += 52; }
  text(ctx, words.length ? `${shown} match${shown === 1 ? '' : 'es'}` : '', rx, sy + 4, { font: 'small', color: 'whiteSoft' });
  text(ctx, `FOUND ${[...found].length} / ${total}`, lx + lw, sy + 4, { align: 'right', font: 'small', color: 'gold' });
  const visible = (cy, rh) => cy + rh >= top && cy <= bottom; // rows off screen are measured but not drawn
  scrollArea(ctx, m, x + 6, top, w - 12, bottom, (cy) => {
    if (!words.length) cy = drawNote(ctx, INTRO, lx, cy + 2, lw, visible) + 3;
    for (const s of LIST) {
      const items = words.length ? s.items.filter(match) : s.items;
      if (!items.length) continue;
      if (visible(cy, 16)) drawHeader(ctx, s, items, found, lx, cy, lw, !!words.length);
      cy += 16;
      for (const it of items) {
        const held = !!run?.relics?.some(r => r.key === it.key), got = held || found.has(it.key);
        const rh = Math.max(28, it.lines.length * LH + 6, (it.nameLines.length + 1) * LH + 6);
        if (visible(cy, rh)) {
          pixBox(ctx, lx, cy, lw, rh, it.curse ? '#2e2236' : held ? '#2c3448' : got ? '#262c3c' : '#20242f', held ? '#f8d03888' : '#141820', 3);
          const iy = cy + Math.floor((rh - 24) / 2), tint = it.curse ? tinted(itemPath(it.key), '#9030c0', 0.45) : null;
          if (!got) ctx.globalAlpha = 0.45; // (not found yet: a faded picture)
          if (tint) ctx.drawImage(tint, lx + 3, iy); else draw(ctx, itemPath(it.key), lx + 3, iy);
          ctx.globalAlpha = 1;
          it.nameLines.forEach((l, i) => text(ctx, l, lx + ICON_W, cy + 3 + i * LH, { font: 'small', color: got ? 'white' : 'whiteSoft' }));
          const ty = cy + 3 + it.nameLines.length * LH;
          text(ctx, held ? 'HELD' : got ? 'FOUND' : s.label, lx + ICON_W, ty, { font: 'small', color: held ? 'lime' : got ? 'green' : s.color });
          it.lines.forEach(([l, col], i) => text(ctx, l, tx, cy + 3 + i * LH, { font: 'small', color: col }));
        }
        cy += rh + 3;
      }
    }
    if (words.length && !shown) cy = drawNote(ctx, `No held item matches "${q}".`, lx, cy + 2, lw, visible);
    if (!words.length) cy = drawNote(ctx, COOP, lx, cy + 2, lw, visible);
    return cy + 2;
  });
}
