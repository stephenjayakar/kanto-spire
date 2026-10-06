// Coverage of the FireRed move-animation prototype: which moves play their own FireRed animation, which go
// through a fallback, weighted by how often moves are used in the game (a JSON file named by ANIM_USAGE, if set).
//   node tests/anim_coverage.mjs
import fs from 'fs';
import { loadData, D } from '../web/src/game/data.js';
import { GEN4_MOVES } from '../web/src/game/gen4_moves.js';
import * as GBA from '../web/src/anim/gba.js';
import { missingFor } from '../web/src/anim/interp.js';
import { resolveAnimMove } from '../web/src/anim/pick.js';

await loadData(async f => JSON.parse(fs.readFileSync('web/assets/data/' + f, 'utf8')));
GBA.DATA.json = JSON.parse(fs.readFileSync('web/assets/anims/anims.json', 'utf8'));
await import('../web/src/anim/cb/index.js');
const J = GBA.DATA.json;
const gen3 = Object.keys(J.moves).filter(k => k !== 'NONE' && k !== 'COUNT');
const canPlay = (k) => !!J.moves[k] && missingFor(J, J.moves[k]).length === 0;
const own = gen3.filter(canPlay);
const gen4 = Object.keys(GEN4_MOVES);
const all = [...gen3, ...gen4];
const via = {};
const res = {};
for (const k of all) { const r = resolveAnimMove(k, { canPlay, move: D.moves[k] ? { ...D.moves[k], key: k } : null, terrain: 'grass' }); res[k] = r; const v = r ? r.via : 'none'; via[v] = (via[v] || 0) + 1; }
let usage = null;
try { if (process.env.ANIM_USAGE) usage = JSON.parse(fs.readFileSync(process.env.ANIM_USAGE, 'utf8')); } catch {}
const out = { gen3Total: gen3.length, gen3Own: own.length, gen4Total: gen4.length, gen4ViaMapping: gen4.filter(k => res[k]?.via === 'gen4').length, byRoute: via };
if (usage) {
  const list = usage.top || usage.moves || usage.all || usage;
  const entries = Array.isArray(list) ? list.map(e => [e.move || e.key || e[0], e.share ?? e.weight ?? e[1]]) : Object.entries(list).map(([k, v]) => [k, typeof v === 'number' ? v : v.share ?? v.weight]);
  const tot = entries.reduce((a, [, w]) => a + (w || 0), 0);
  const w = {};
  for (const [k, s] of entries) { const v = res[k]?.via || (D.moves[k] ? 'none' : 'unknown'); w[v] = (w[v] || 0) + (s || 0) / tot; }
  out.usageWeighted = Object.fromEntries(Object.entries(w).map(([k, v]) => [k, +(v * 100).toFixed(1)]));
}
console.log(JSON.stringify(out, null, 1));
// most-used moves that still need a fallback
if (usage) {
  const list = usage.top || usage.moves || usage.all || usage;
  const entries = Array.isArray(list) ? list.map(e => [e.move || e.key || e[0], e.share ?? e.weight ?? e[1]]) : Object.entries(list).map(([k, v]) => [k, typeof v === 'number' ? v : v.share ?? v.weight]);
  console.log('top fallbacks:', entries.filter(([k]) => res[k] && res[k].via !== 'own').slice(0, 15).map(([k, s]) => `${k}->${res[k].key}(${res[k].via})`).join(' '));
}
