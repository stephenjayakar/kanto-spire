// Catch audit: which Pokédex species (#1-386) can be caught somewhere, and how.
//   node tools/catch_audit.mjs            summary + the species that are evolution-only or unobtainable
//   node tools/catch_audit.mjs --full     + every species' sources
//   node tools/catch_audit.mjs --json     machine-readable
// Sources:
//   wild    a wild-node pool entry (KANTO: FireRed's encounter table for the area's map, + area.extra / area.rare;
//           HOENN / JOHTO: area.pool + extra / rare). A low-level pick shows up evolved once the floor's level is 6+
//           past its evolution level (run.js wildConfig), so each entry counts as the species it can be met as at
//           the act's levels (spire tier levels; the post-game keeps its own).
//   rare    the same, from an area's rare list (low weight: regions.js RARE_SHARE).
//   event   a "?" event that hands out / lets you catch / fight-and-catch that species (source scan of events.js:
//           quoted species keys in an event block that gives POKéMON; the PC's random wonder trade is left out).
//   legend  a legendary node (acts.js LEGENDS, used as act.bird / elites / bosses).
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const G = (f) => import(path.join(ROOT, 'web/src/game', f).replace(/\\/g, '/').replace(/^([A-Za-z]):/, 'file:///$1:'));
const { loadData, D } = await G('data.js');
const RG = await G('regions.js');
const { LEGENDS } = await G('acts.js');

let loaded = false;
export async function ensureData() {
  if (loaded || Object.keys(D.species || {}).length) { loaded = true; return; }
  await loadData(async f => JSON.parse(fs.readFileSync(path.join(ROOT, 'web/assets/data', f), 'utf8')));
  loaded = true;
}

export const LEGENDARY = ['ARTICUNO', 'ZAPDOS', 'MOLTRES', 'MEWTWO', 'MEW', 'RAIKOU', 'ENTEI', 'SUICUNE', 'LUGIA', 'HO_OH', 'CELEBI',
  'REGIROCK', 'REGICE', 'REGISTEEL', 'LATIAS', 'LATIOS', 'KYOGRE', 'GROUDON', 'RAYQUAZA', 'JIRACHI', 'DEOXYS'];

// The levels a wild POKéMON of act slot t can have (levelFor +-1, +2 at the top ascensions).
function actLevels(region, t, act) {
  const lv = t < RG.TIERS.length ? RG.TIERS[t].levels : act.levels;
  return [lv[0] - 1, lv[1] + 1 + 2];
}
// What a pick of `sp` can show up as between levels lo..hi (run.js wildConfig: one LEVEL evolution at param + 6).
function shownAs(sp, lo, hi) {
  const evo = D.species[sp]?.evolutions?.find(e => e.method === 'LEVEL');
  if (!evo || !D.species[evo.into]) return [sp];
  const at = evo.param + 6;
  const out = [];
  if (lo < at) out.push(sp);
  if (hi >= at) out.push(evo.into);
  return out;
}
// An area's wild entries as run.js sees them: [{ species, rare }].
export function areaEntries(area) {
  let base;
  if (area.pool) base = RG.areaPool(area) || [];
  else {
    const enc = D.encounters[area.map] || {};
    base = (enc.land && enc.land.length ? enc.land : enc.water || enc.fishing || []).map(e => e.species);
  }
  const out = [...new Set(base)].map(species => ({ species, rare: false }));
  for (const sp of area.extra || []) out.push({ species: sp, rare: false });
  for (const sp of area.rare || []) out.push({ species: sp, rare: true });
  return out.filter(e => D.species[e.species]);
}

// species -> [{ kind: 'wild'|'rare', region, act (1-based slot), area, as: 'direct'|'evolved', from }]
export function wildSources() {
  const out = {};
  for (const rid of RG.REGION_IDS) {
    RG.REGIONS[rid].acts.forEach((act, t) => {
      const [lo, hi] = actLevels(rid, t, act);
      for (const area of act.areas) for (const e of areaEntries(area)) {
        for (const sp of shownAs(e.species, lo, hi)) {
          (out[sp] ||= []).push({ kind: e.rare ? 'rare' : 'wild', region: rid, act: t + 1, area: area.name, as: sp === e.species ? 'direct' : 'evolved', from: e.species });
        }
      }
    });
  }
  return out;
}

export function legendSources() {
  const out = {};
  for (const rid of RG.REGION_IDS) RG.REGIONS[rid].acts.forEach((act, t) => {
    for (const k of [act.bird, ...(act.elites || []), ...(act.bosses || [])].filter(Boolean)) {
      const L = LEGENDS[k];
      if (L) (out[L.species] ||= []).push({ kind: 'legend', region: rid, act: t + 1, node: k });
    }
  });
  return out;
}

// Source scan of events.js (see the header).
export function eventSources() {
  const src = fs.readFileSync(path.join(ROOT, 'web/src/game/events.js'), 'utf8');
  const species = new Set(Object.keys(D.species));
  const keysIn = (s) => [...s.matchAll(/'([A-Z][A-Z0-9_]+)'/g)].map(m => m[1]).filter(k => species.has(k));
  // top-level species lists (const WAREHOUSE = [...]; const FOSSILS = {...})
  const consts = {};
  for (const m of src.matchAll(/^const ([A-Z_]+) = ([[{][^;]*?[\]}]);/gms)) { const ks = keysIn(m[2]); if (ks.length && m[1] !== 'LEGENDARY') consts[m[1]] = ks; }
  const sections = [['shrine', src.indexOf('const SHRINES')], ['kanto', src.indexOf('const KANTO = [')], ['hoenn', src.indexOf('const HOENN = [')], ['johto', src.indexOf('const JOHTO = [')], ['fallback', src.indexOf('const FALLBACKS')], ['end', src.indexOf('export const EVENTS')]];
  const ids = [...src.matchAll(/\n\s+id: '([a-z0-9_]+)'/g)].map(m => ({ id: m[1], at: m.index }));
  // an event's source: up to the next event or the next top-level declaration
  const blockOf = (i) => {
    const at = ids[i].at, d = src.slice(at).search(/\n(const|function|export) /);
    return src.slice(at, Math.min(ids[i + 1]?.at ?? src.length, d >= 0 ? at + d : src.length));
  };
  const out = {};
  ids.forEach((e, i) => {
    let block = blockOf(i);
    let sec = null;
    for (let k = 0; k < sections.length - 1; k++) if (e.at > sections[k][1] && e.at < sections[k + 1][1]) sec = sections[k][0];
    if (!sec || e.id === 'pc') return;
    // the event's acts: K([1, 2], {...}) right before the id
    const head = src.slice(Math.max(0, e.at - 40), e.at);
    const acts = (head.match(/[KHJ]\(\[([\d, ]+)\]/) || [])[1]?.split(',').map(x => +x.trim() + 1) || null;
    // choices: KANTO.find(e => e.id === 'veteran').choices (an event sharing another's choices)
    const alias = block.match(/\.find\(e => e\.id === '([a-z0-9_]+)'\)\.choices/);
    if (alias) { const a = ids.findIndex(x => x.id === alias[1]); if (a >= 0) block += blockOf(a); }
    if (!/newMon|monChoices|rewardMons|wildFight|traded/.test(block)) return;
    const ks = new Set(keysIn(block));
    for (const [name, list] of Object.entries(consts)) if (new RegExp(`\\b${name}\\b`).test(block)) list.forEach(k => ks.add(k));
    for (const sp of ks) (out[sp] ||= []).push({ kind: 'event', region: sec, acts, event: e.id });
  });
  return out;
}

const preOf = (sp) => Object.keys(D.species).filter(k => (D.species[k].evolutions || []).some(e => e.into === sp));

export async function audit() {
  await ensureData();
  const wild = wildSources(), ev = eventSources(), leg = legendSources();
  const dex = Object.values(D.species).filter(s => s.dex >= 1 && s.dex <= 386).sort((a, b) => a.dex - b.dex);
  const rows = dex.map(s => {
    const w = wild[s.key] || [];
    return {
      dex: s.dex, key: s.key, legendary: LEGENDARY.includes(s.key),
      wildDirect: w.filter(x => x.kind === 'wild' && x.as === 'direct'),
      wildEvolved: w.filter(x => x.kind === 'wild' && x.as === 'evolved'),
      rare: w.filter(x => x.kind === 'rare'),
      event: ev[s.key] || [], legend: leg[s.key] || [],
    };
  });
  const direct = new Set(rows.filter(r => r.wildDirect.length || r.wildEvolved.length || r.rare.length || r.event.length || r.legend.length).map(r => r.key));
  // evolution-only: not directly obtainable, but some pre-evolution (any depth) is
  const reach = (sp, seen = new Set()) => preOf(sp).some(p => !seen.has(p) && (seen.add(p), direct.has(p) || reach(p, seen)));
  for (const r of rows) r.status = direct.has(r.key) ? 'catchable' : reach(r.key) ? 'evolution-only' : 'none';
  return rows;
}

const fmt = (x) => x.kind === 'event' ? `event:${x.event}(${x.region}${x.acts ? ' a' + x.acts.join('/') : ''})`
  : x.kind === 'legend' ? `legend:${x.region} a${x.act}`
    : `${x.kind}:${x.region} a${x.act} ${x.area}${x.as === 'evolved' ? ` (as evolved ${x.from})` : ''}`;

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const rows = await audit();
  if (process.argv.includes('--json')) { console.log(JSON.stringify(rows, null, 1)); process.exit(0); }
  const n = (f) => rows.filter(f).length;
  const nonLeg = (r) => !r.legendary;
  console.log(`Species #1-386: ${rows.length} (${n(r => r.legendary)} legendary/mythical)`);
  console.log(`  wild pool (direct entry or level-evolved): ${n(r => r.wildDirect.length || r.wildEvolved.length)}`);
  console.log(`    of which only as a level-evolved pick: ${n(r => !r.wildDirect.length && r.wildEvolved.length)}`);
  console.log(`  rare finds: ${n(r => r.rare.length)}`);
  console.log(`  event (gift / catch / fight-and-catch): ${n(r => r.event.length)}`);
  console.log(`  legendary node: ${n(r => r.legend.length)}`);
  console.log(`  catchable somewhere (any of the above): ${n(r => r.status === 'catchable')}  (non-legendary: ${n(r => nonLeg(r) && r.status === 'catchable')}/${n(nonLeg)})`);
  console.log(`  wild or rare, non-legendary: ${n(r => nonLeg(r) && (r.wildDirect.length || r.wildEvolved.length || r.rare.length))}/${n(nonLeg)}`);
  console.log(`  evolution-only: ${n(r => r.status === 'evolution-only')}`);
  console.log(`  not obtainable: ${n(r => r.status === 'none')}`);
  const list = (title, f) => { const xs = rows.filter(f); console.log(`\n${title} (${xs.length}):`); console.log('  ' + xs.map(r => `#${r.dex} ${r.key}`).join(', ')); };
  list('Evolution-only', r => r.status === 'evolution-only');
  list('Not obtainable', r => r.status === 'none');
  list('Event-only (no wild pool)', r => r.status === 'catchable' && !r.wildDirect.length && !r.wildEvolved.length && !r.rare.length && !r.legend.length);
  list('Legendary/mythical without a legendary node', r => r.legendary && !r.legend.length);
  if (process.argv.includes('--full')) for (const r of rows) console.log(`#${r.dex} ${r.key} [${r.status}] ${[...r.wildDirect, ...r.wildEvolved, ...r.rare, ...r.event, ...r.legend].map(fmt).join('; ')}`);
}
