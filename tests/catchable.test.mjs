// Every POKéDEX species can be obtained in the game: node tests/catchable.test.mjs
// Runs tools/catch_audit.mjs (wild pools / extra / rare finds, legendary nodes, mythic "?" events, "?" event gifts /
// trades / eggs / catches, starters, and evolution from an obtainable species by a rule or item this game has) and fails:
//   1. on any species #1-DEX_MAX (forms like GIRATINA_ORIGIN excluded) with no way to obtain it;
//   2. on a dangling reference: a pool / event / legend / starter naming a species key that isn't in D.species;
//   3. on an evolution method the audit doesn't know (pokemon.js levelEvolution grew a rule: update catch_audit.mjs);
//   4. on an evolution item that a species needs but the game never hands out.
// Walks every region in regions.js REGIONS, so a new region is checked as soon as it is registered.
import { audit, sourcesOf, fmtSource, evoRule } from '../tools/catch_audit.mjs';
import { D, DEX_MAX } from '../web/src/game/data.js';
import { REGION_IDS } from '../web/src/game/regions.js';

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.log('FAIL', name, '-', e.message); } };
const ok = (cond, msg) => { if (!cond) throw new Error(msg); };

const rows = await audit();

t(`the audit covers the POKéDEX (#1-${DEX_MAX}), one row per dex number`, () => {
  const nums = new Set(rows.map(r => r.dex));
  const missing = [];
  for (let n = 1; n <= DEX_MAX; n++) if (!nums.has(n)) missing.push(n);
  ok(!missing.length, `dex numbers with no species: ${missing.join(', ')}`);
  ok(nums.size === rows.length, 'two dex rows share a number (a form not flagged `form: true`?)');
});

t('every dex species has a way to be obtained', () => {
  const none = rows.filter(r => r.status === 'none');
  ok(!none.length, `${none.length} unobtainable: ${none.map(r => `#${r.dex} ${r.key}`).join(', ')}`);
});

t('no dangling species references', () => {
  const d = rows.dangling;
  ok(!d.length, `${d.length}: ${d.map(x => `${x.key} (${x.where})`).join('; ')}`);
});

t('every evolution method in the data is one the audit knows', () => {
  ok(!rows.unknownMethods.length, `unknown: ${rows.unknownMethods.join(', ')}`);
});

t('every evolution item a species needs is handed out somewhere', () => {
  const missing = new Set();
  for (const s of Object.values(D.species)) for (const e of s.evolutions || []) {
    const rule = evoRule(e);
    if (rule && rule !== 'level' && D.species[e.into] && !rows.evoItems[rule]) missing.add(`${rule} (${s.key} -> ${e.into})`);
  }
  ok(!missing.size, [...missing].join(', '));
});

// (the audit only credits an evolution from an obtainable species; print the evolution-only ones for the record)
const evoOnly = rows.filter(r => r.status === 'evolution-only');
if (evoOnly.length && process.argv.includes('-v')) for (const r of evoOnly) console.log(`  evolution-only #${r.dex} ${r.key}: ${sourcesOf(r).map(fmtSource).join('; ')}`);

console.log(`catchable: ${pass} passed, ${fail} failed (regions: ${REGION_IDS.join(', ')}; ${rows.length} dex species, ` +
  `${rows.filter(r => r.status === 'catchable').length} met directly, ${rows.filter(r => r.status === 'evolution-only').length} evolution-only, ` +
  `${rows.filter(r => r.status === 'none').length} unobtainable)`);
process.exit(fail ? 1 : 0);
