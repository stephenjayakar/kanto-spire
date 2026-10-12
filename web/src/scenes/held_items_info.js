// HELD ITEMS tab of the INFO screen (scenes/common.js InfoModal): every held item in the game, read straight off
// game/items.js RELICS (name, art, desc, rarity), so a new item shows up here on its own. Where it comes from:
//   common / uncommon / rare  the shared pool (Run.relicChoices: MARTS at RELIC_PRICE, elite / boss / rival rewards,
//                             ITEM BALLS, "?" events); a starter's own item (acts.js STARTERS item) is named too
//   legendary                 only its legendary (acts.js BIRDS, johto.js JOHTO_BIRDS)
//   curse                     "?" events as a cost (events.js addCurse), removed by a CENTER's CLEANSE
// Display only: reads G.run (the player's own run, or their view in co-op) to tag the items they hold.
import { draw, itemPath, tinted } from '../engine/assets.js';
import { text, wrap, measure } from '../engine/font.js';
import { pixBox, rect, scrollArea } from '../engine/ui.js';
import { D, speciesName } from '../game/data.js';
import { RELICS, RELIC_PRICE } from '../game/items.js';
import { BIRDS, STARTERS } from '../game/acts.js';
import { G } from '../game/state.js';

const GROUPS = [
  { id: 'common', label: 'COMMON', color: ['#c8c8c8', '#404050'] },
  { id: 'uncommon', label: 'UNCOMMON', color: ['#58a8f8', '#1a3450'] },
  { id: 'rare', label: 'RARE', color: ['#f8d038', '#7a5a10'] },
  { id: 'legendary', label: 'LEGENDARY', color: ['#ff9c30', '#5a3010'], note: 'only from beating its legendary POKéMON' },
  { id: 'curse', label: 'CURSE', color: ['#c890ff', '#402060'], note: "the price of some ? events  ·  can't be sold  ·  CLEANSE at a POKéMON CENTER" },
];
const groupOf = (r) => (r.curse ? 'curse' : r.legendary ? 'legendary' : r.rarity);

const INTRO = 'Every held item in the game. COMMON, UNCOMMON and RARE items come from POKé MARTS, ELITE, BOSS and rival rewards, ITEM BALLS and ? events (rarer ones turn up less often). You can hold any number. HELD = yours now.';
const COOP = "CO-OP: every player has their own held items, and each one only powers its owner's POKéMON and hands. At a legendary node you get the item of the legendary you catch (the act's own if you catch neither).";

const NAME_W = 92, LH = 11, ICON_W = 30;

// Where an item comes from, when it's more specific than its group.
function sourceOf(key) {
  const out = [];
  const bird = Object.entries(BIRDS).find(([, b]) => b.item === key);
  if (bird) out.push(`Beat ${speciesName(bird[0].replace(/^LEGEND_/, ''))}.`);
  const st = STARTERS.filter(s => s.item === key).map(s => speciesName(s.species));
  if (st.length) out.push(`${st.join(' and ')} start${st.length > 1 ? '' : 's'} with it.`);
  return out.join(' ');
}

// The list, wrapped once (the items never change during a session; the desc column has a fixed width).
let LIST = null;
function build(textW) {
  const sections = GROUPS.map(g => ({ ...g, items: [] }));
  for (const [key, r] of Object.entries(RELICS)) {
    const sec = sections.find(s => s.id === groupOf(r));
    if (!sec) continue;
    const name = D.items[key]?.name || r.name || key.replace(/_/g, ' ');
    const where = sourceOf(key);
    sec.items.push({
      key, curse: !!r.curse, name,
      nameLines: wrap(name, NAME_W, 'small'),
      lines: [...wrap(r.desc, textW, 'small').map(l => [l, 'whiteSoft']), ...(where ? wrap(where, textW, 'small').map(l => [l, 'gray']) : [])],
    });
  }
  const sortKey = (n) => n.replace(/[^A-Z0-9 ]/gi, ''); // ({POKEBLOCK} CASE sorts under P)
  for (const s of sections) s.items.sort((a, b) => sortKey(a.name).localeCompare(sortKey(b.name)));
  return sections.filter(s => s.items.length);
}

function drawHeader(ctx, s, lx, cy, lw) {
  let hx = lx + 2 + text(ctx, s.label, lx + 2, cy, { font: 'small', color: s.color });
  const parts = [`${s.items.length} item${s.items.length > 1 ? 's' : ''}`];
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

// Draws the tab into the panel (x, y, w, h); `m` keeps the scroll position. Like the STATUSES tab, the list ends 50px
// above the panel's bottom so scrollArea's "scroll for more" hint clears the CLOSE button.
export function drawHeldItemsInfo(ctx, m, x, y, w, h) {
  const top = y + 32, bottom = y + h - 50, lx = x + 10, lw = w - 26;
  const tx = lx + ICON_W + NAME_W + 4, textW = lw - (tx - lx) - 8;
  LIST ||= build(textW);
  const run = G.run;
  const visible = (cy, rh) => cy + rh >= top && cy <= bottom; // rows off screen are measured but not drawn
  scrollArea(ctx, m, x + 6, top, w - 12, bottom, (cy) => {
    cy = drawNote(ctx, INTRO, lx, cy + 2, lw, visible) + 3;
    for (const s of LIST) {
      if (visible(cy, 16)) drawHeader(ctx, s, lx, cy, lw);
      cy += 16;
      for (const it of s.items) {
        const held = !!run?.relics?.some(r => r.key === it.key);
        const rh = Math.max(28, it.lines.length * LH + 6, (it.nameLines.length + 1) * LH + 6);
        if (visible(cy, rh)) {
          pixBox(ctx, lx, cy, lw, rh, it.curse ? '#2e2236' : held ? '#2c3448' : '#262c3c', held ? '#f8d03888' : '#141820', 3);
          const iy = cy + Math.floor((rh - 24) / 2), tint = it.curse ? tinted(itemPath(it.key), '#9030c0', 0.45) : null;
          if (tint) ctx.drawImage(tint, lx + 3, iy); else draw(ctx, itemPath(it.key), lx + 3, iy);
          it.nameLines.forEach((l, i) => text(ctx, l, lx + ICON_W, cy + 3 + i * LH, { font: 'small', color: 'white' }));
          const ty = cy + 3 + it.nameLines.length * LH;
          text(ctx, held ? 'HELD' : s.label, lx + ICON_W, ty, { font: 'small', color: held ? 'lime' : s.color });
          it.lines.forEach(([l, col], i) => text(ctx, l, tx, cy + 3 + i * LH, { font: 'small', color: col }));
        }
        cy += rh + 3;
      }
    }
    cy = drawNote(ctx, COOP, lx, cy + 2, lw, visible);
    return cy + 2;
  });
}
