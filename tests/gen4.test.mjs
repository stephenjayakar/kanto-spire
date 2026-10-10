// Gen 4 groundwork (game/gen4.js, tools/extract_gen4.py): hidden while GEN4_ENABLED is false, and complete enough
// to turn on later.
//   node tests/gen4.test.mjs
// 1. Flag off: loadData never reads the Gen 4 file and D / byDex / every Gen 1-3 evolution are untouched; nothing
//    but data.js (gated) imports gen4.js; the POKéDEX stays at 386.
// 2. The extracted data (web/assets/data/gen4/species.json) is valid against the game: 107 species, dex 387-493,
//    unique ids after FireRed's, known types, moves, abilities, evolution targets, and every sprite / cry exists at
//    the expected size.
// 3. applyGen4 (what the flag would do) merges add-only on a copy: 493 species, cross-gen evolutions + babies.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadData, D, byDex } from '../web/src/game/data.js';
import { GEN4_ENABLED, GEN4_DATA_FILE, loadGen4, applyGen4, GEN4_LEGENDS } from '../web/src/game/gen4.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = path.join(ROOT, 'web/assets');
let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.log('FAIL', msg); } };

// ---- 1. hidden ---------------------------------------------------------------------------------------------
ok(GEN4_ENABLED === false, 'GEN4_ENABLED is false');
const asked = [];
await loadData(async f => { asked.push(f); return JSON.parse(fs.readFileSync(path.join(ASSETS, 'data', f), 'utf8')); });
ok(!asked.some(f => f.includes('gen4')), `loadData read no Gen 4 file (read: ${asked.join(', ')})`);
const raw = JSON.parse(fs.readFileSync(path.join(ASSETS, 'data/species.json'), 'utf8'));
ok(Object.keys(D.species).length === Object.keys(raw).length && Object.keys(raw).length === 386, `D.species has the 386 FireRed species (${Object.keys(D.species).length})`);
ok(!Object.values(D.species).some(s => s.gen4 || s.dex > 386 || s.gfxDir), 'no Gen 4 species / fields in D.species');
ok(byDex.length <= 387, `byDex stops at 386 (length ${byDex.length})`);
let evoSame = true;
for (const [k, s] of Object.entries(raw)) {
  if (JSON.stringify(D.species[k].evolutions) !== JSON.stringify(s.evolutions) || D.species[k].preEvolution !== s.preEvolution) { evoSame = false; console.log('  changed', k); }
}
ok(evoSame, 'every Gen 1-3 evolution / pre-evolution is exactly species.json\'s');
// only data.js may import gen4.js among the game logic (main.js / dev tools are not game logic)
const gameDir = path.join(ROOT, 'web/src/game');
const importers = [];
(function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else if (/\.js$/.test(e.name) && /from '\.\/gen4\.js'|from '\.\.\/gen4\.js'|game\/gen4\.js/.test(fs.readFileSync(f, 'utf8'))) importers.push(path.relative(gameDir, f)); } })(gameDir);
ok(importers.length === 1 && importers[0] === 'data.js', `only data.js imports gen4.js (${importers.join(', ')})`);
ok(/const DEX_MAX = 386\b/.test(fs.readFileSync(path.join(ROOT, 'web/src/scenes/dex.js'), 'utf8')), 'POKéDEX still DEX_MAX = 386');

// ---- 2. the extracted data --------------------------------------------------------------------------------
const g4 = await loadGen4(async f => JSON.parse(fs.readFileSync(path.join(ASSETS, 'data', f), 'utf8')));
ok(GEN4_DATA_FILE === 'gen4/species.json', 'data file path');
const list = Object.values(g4.species).sort((a, b) => a.dex - b.dex);
ok(list.length === 107, `107 species (${list.length})`);
ok(list.every((s, i) => s.dex === 387 + i), 'dex 387..493, no gaps');
const frIds = new Set(Object.values(raw).map(s => s.id));
const ids = list.map(s => s.id);
ok(new Set(ids).size === 107 && !ids.some(i => frIds.has(i)) && Math.min(...ids) === Math.max(...frIds) + 1, `unique species ids after FireRed's (${Math.min(...ids)}-${Math.max(...ids)})`);
ok(!Object.keys(g4.species).some(k => raw[k]), 'no key collides with a FireRed species');
const allKeys = new Set([...Object.keys(raw), ...Object.keys(g4.species)]);
const pngSize = (f) => { const b = fs.readFileSync(f); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };
const SIZES = { front: [64, 64], front_shiny: [64, 64], back: [64, 64], back_shiny: [64, 64], anim_front: [128, 64], anim_front_shiny: [128, 64], icon: [32, 64] };
const probs = [];
for (const s of list) {
  const p = (m) => probs.push(`${s.name}: ${m}`);
  if (!s.types.length || s.types.some(t => !D.types.chart[t] && !D.types.list.includes(t))) p('type ' + s.types);
  for (const [, m] of s.learnset) if (!D.moves[m]) p('learnset move ' + m);
  if (!s.learnset.length) p('empty learnset');
  for (const m of [...s.tmhm, ...s.tutor, ...s.eggMoves]) if (!D.moves[m]) p('move ' + m);
  for (const a of s.abilities) if (!D.abilities[a]) p('ability ' + a);
  for (const e of s.evolutions) if (!allKeys.has(e.into)) p('evolves into unknown ' + e.into);
  if (s.preEvolution && !allKeys.has(s.preEvolution)) p('unknown pre-evolution ' + s.preEvolution);
  if (!s.dexText || !s.category || !s.height || !s.weight) p('dex text / category / size missing');
  const st = s.stats; if (![st.hp, st.atk, st.def, st.spa, st.spd, st.spe].every(v => v > 0 && v <= 255)) p('stats');
  if (s.gfxDir !== `gfx/gen4/pokemon/${s.gfx}`) p('gfxDir ' + s.gfxDir);
  for (const [k, wh] of Object.entries(SIZES)) {
    const f = path.join(ASSETS, s.gfxDir, k + '.png');
    if (!fs.existsSync(f)) { p('missing ' + k); continue; }
    const [w, h] = pngSize(f);
    if (w !== wh[0] || h !== wh[1]) p(`${k} is ${w}x${h}`);
  }
  if (!s.cryWav || !fs.existsSync(path.join(ASSETS, s.cryWav))) p('cry missing');
  if (!s.gfxDir.startsWith('gfx/gen4/') || (s.cryWav && !s.cryWav.startsWith('sound/gen4/'))) p('asset outside a gen4/ folder');
}
ok(probs.length === 0, `species valid against the game's data (${probs.slice(0, 8).join('; ')})`);
const legends = list.filter(s => s.legendary || s.mythical).map(s => s.name);
ok(['UXIE', 'MESPRIT', 'AZELF', 'DIALGA', 'PALKIA', 'HEATRAN', 'REGIGIGAS', 'GIRATINA', 'CRESSELIA', 'PHIONE', 'MANAPHY', 'DARKRAI', 'SHAYMIN', 'ARCEUS'].every(n => legends.includes(n)), `the 14 Gen 4 legendaries / mythicals (${legends.join(' ')})`);
ok(Object.values(GEN4_LEGENDS).every(L => g4.species[L.species]) && Object.keys(GEN4_LEGENDS).length === 14, 'GEN4_LEGENDS point at extracted species');
const ce = g4.crossGen.evolutions, into = (k) => (ce[k] || []).map(e => e.into);
const want = { MAGNETON: 'MAGNEZONE', TOGETIC: 'TOGEKISS', RHYDON: 'RHYPERIOR', PILOSWINE: 'MAMOSWINE', SNEASEL: 'WEAVILE', ELECTABUZZ: 'ELECTIVIRE', MAGMAR: 'MAGMORTAR', KIRLIA: 'GALLADE', SNORUNT: 'FROSLASS', PORYGON2: 'PORYGON_Z', GLIGAR: 'GLISCOR', DUSCLOPS: 'DUSKNOIR' };
ok(Object.entries(want).every(([a, b]) => into(a).includes(b)) && into('EEVEE').includes('LEAFEON') && into('EEVEE').includes('GLACEON'), 'cross-gen evolutions (MAGNEZONE, TOGEKISS, RHYPERIOR, LEAFEON/GLACEON, MAMOSWINE, WEAVILE...)');
ok(Object.keys(ce).every(k => raw[k]) && Object.values(ce).flat().every(e => g4.species[e.into]), 'crossGen.evolutions: Gen 1-3 -> Gen 4 only');
ok(g4.crossGen.preEvolutions.SNORLAX === 'MUNCHLAX' && g4.crossGen.preEvolutions.CHANSEY === 'HAPPINY' && Object.keys(g4.crossGen.preEvolutions).length === 7, 'the 7 Gen 4 babies of Gen 1-3 lines');
ok(g4.species.MAGNEZONE.preEvolution === 'MAGNETON' && g4.species.TOGEKISS.types.join() === 'NORMAL,FLYING', 'Gen 4 values (TOGEKISS NORMAL/FLYING, not the later FAIRY)');

// ---- 3. what turning the flag on does (on a copy) -----------------------------------------------------------
const copy = { species: structuredClone(raw) };
const before = JSON.stringify(g4);
ok(applyGen4(copy, g4) === 107 && Object.keys(copy.species).length === 493, 'applyGen4 adds 107 -> 493 species');
ok(JSON.stringify(g4) === before, 'applyGen4 leaves its input alone');
ok(copy.species.MAGNETON.evolutions.some(e => e.into === 'MAGNEZONE') && copy.species.EEVEE.evolutions.length === 7 && copy.species.SNORLAX.preEvolution === 'MUNCHLAX', 'cross-gen links applied');
ok(applyGen4(copy, g4) === 0 && copy.species.EEVEE.evolutions.length === 7, 'applyGen4 is idempotent');
ok(raw.EEVEE.evolutions.length === 5 && raw.SNORLAX.preEvolution === null, 'the source species.json is untouched');

console.log(`gen4 tests: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
