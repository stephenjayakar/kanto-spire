// Catch audit: how every Pokédex species (#1-DEX_MAX) can be obtained in a run.
//   node tools/catch_audit.mjs            summary + the species that are evolution-only or unobtainable
//   node tools/catch_audit.mjs --full     + every species' sources
//   node tools/catch_audit.mjs --json     machine-readable
// tests/catchable.test.mjs runs this and fails on any dex species with no way in, or on a dangling species key.
// Everything walks RG.REGIONS / REGION_IDS, so a new region is picked up when it is registered in regions.js.
// Sources ("obtainable" = any of them):
//   wild    a wild-node pool entry (KANTO: FireRed's encounter table for the area's map, + area.extra / area.rare;
//           other regions: area.pool + extra / rare). A low-level pick shows up evolved once the floor's level is 6+
//           past its evolution level (run.js wildConfig), so each entry counts as the species it can be met as at
//           the act's levels (spire tier levels; the post-game keeps its own).
//   rare    the same, from an area's rare list (low weight: regions.js RARE_SHARE).
//   event   a "?" event that hands out / trades / lets you catch / fight-and-catch that species, egg and DAY CARE events
//           included (source scan of events.js: quoted species keys in an event block that gives POKéMON; the PC's
//           random wonder trade is left out). An event counts only if it is in events.js EVENTS.
//   mythic  a mythic "?" event (acts.js MYTHICS via events.js MYTHIC_EVENTS: MEWTWO, MEW, DEOXYS, RAYQUAZA).
//   legend  a legendary node (acts.js LEGENDS, used as act.bird / elites / bosses, or act.rareLegends).
//   starter a starter (acts.js STARTERS, the regions' starters).
//   evolve  evolution from an obtainable species, by a rule this game can trigger (pokemon.js levelEvolution: LEVEL,
//           FRIENDSHIP, the trade rules, KNOWS_MOVE, the branches; NINCADA's SHEDINJA, run.js; gen4.js gameEvolution
//           already turned Gen 4's methods into these), or by an evolution item the game hands out (ITEM, EEVEE's
//           SUN / MOON STONE: pokemon.js evoStone) - see evoItems(). Evolutions only go forward: a baby needs its own
//           source (egg event, wild, ...).
// Species flagged `form: true`, or sharing a dex number with the base species (GIRATINA_ORIGIN), have no dex entry
// of their own: they get sources but are not part of the dex check.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const G = (f) => import(path.join(ROOT, 'web/src/game', f).replace(/\\/g, '/').replace(/^([A-Za-z]):/, 'file:///$1:'));
const { loadData, D, DEX_MAX } = await G('data.js');
const RG = await G('regions.js');
const { LEGENDS, MYTHICS, STARTERS } = await G('acts.js');
const { EVENTS } = await G('events.js');
const { EVO_STONES, CONSUMABLES } = await G('items.js');
const { evoStone } = await G('pokemon.js');
const readSrc = (f) => fs.readFileSync(path.join(ROOT, 'web/src/game', f), 'utf8');

let loaded = false;
export async function ensureData() {
  if (loaded || Object.keys(D.species || {}).length) { loaded = true; return; }
  await loadData(async f => JSON.parse(fs.readFileSync(path.join(ROOT, 'web/assets/data', f), 'utf8')));
  loaded = true;
}

export const LEGENDARY = ['ARTICUNO', 'ZAPDOS', 'MOLTRES', 'MEWTWO', 'MEW', 'RAIKOU', 'ENTEI', 'SUICUNE', 'LUGIA', 'HO_OH', 'CELEBI',
  'REGIROCK', 'REGICE', 'REGISTEEL', 'LATIAS', 'LATIOS', 'KYOGRE', 'GROUDON', 'RAYQUAZA', 'JIRACHI', 'DEOXYS',
  'UXIE', 'MESPRIT', 'AZELF', 'DIALGA', 'PALKIA', 'HEATRAN', 'REGIGIGAS', 'GIRATINA', 'CRESSELIA', 'PHIONE', 'MANAPHY', 'DARKRAI', 'SHAYMIN', 'ARCEUS'];

// Evolution methods that happen on their own as the POKéMON levels (pokemon.js levelEvolution; LEVEL_SHEDINJA: run.js,
// NINCADA leaves a SHEDINJA behind). Keep in sync with levelEvolution: the test fails on a method in neither list.
export const LEVEL_RULES = ['LEVEL', 'FRIENDSHIP', 'LEVEL_ATK_GT_DEF', 'LEVEL_ATK_EQ_DEF', 'LEVEL_ATK_LT_DEF', 'LEVEL_SILCOON', 'LEVEL_CASCOON',
  'LEVEL_NINJASK', 'LEVEL_SHEDINJA', 'LEVEL_FEMALE', 'LEVEL_MALE', 'KNOWS_MOVE', 'BEAUTY', 'TRADE', 'TRADE_ITEM'];
// ...and the ones that need an item (pokemon.js evoStone / itemEvolution).
export const ITEM_RULES = ['ITEM', 'FRIENDSHIP_DAY', 'FRIENDSHIP_NIGHT'];

// ---- dex ---------------------------------------------------------------------------------------------------------
// A species without a dex entry of its own: a form (GIRATINA_ORIGIN).
export function isForm(s) {
  if (s.form) return true;
  const same = Object.values(D.species).filter(o => o.dex === s.dex && o.key !== s.key && !o.form);
  // sharing a dex number: the base is the key the others extend (GIRATINA vs GIRATINA_ORIGIN), else the shortest key
  return same.some(o => s.key.startsWith(o.key + '_') || (!o.key.startsWith(s.key + '_') && o.key.length < s.key.length));
}
export function dexSpecies() {
  return Object.values(D.species).filter(s => s.dex >= 1 && s.dex <= DEX_MAX && !isForm(s)).sort((a, b) => a.dex - b.dex);
}

// ---- wild --------------------------------------------------------------------------------------------------------
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
// An area's wild entries as written ([{ species, rare }]; unknown keys kept, see danglingRefs).
function rawEntries(area) {
  let base;
  if (area.pool) base = RG.areaPool(area) || [];
  else {
    const enc = D.encounters[area.map] || {};
    base = (enc.land && enc.land.length ? enc.land : enc.water || enc.fishing || []).map(e => e.species);
  }
  const out = [...new Set(base)].map(species => ({ species, rare: false }));
  for (const sp of area.extra || []) out.push({ species: sp, rare: false });
  for (const sp of area.rare || []) out.push({ species: sp, rare: true });
  return out;
}
// An area's wild entries as run.js sees them: [{ species, rare }].
export function areaEntries(area) { return rawEntries(area).filter(e => D.species[e.species]); }
const eachAct = (f) => { for (const rid of RG.REGION_IDS) (RG.REGIONS[rid].acts || []).forEach((act, t) => f(rid, act, t)); };

// species -> [{ kind: 'wild'|'rare', region, act (1-based slot), area, as: 'direct'|'evolved', from }]
export function wildSources() {
  const out = {};
  eachAct((rid, act, t) => {
    const [lo, hi] = actLevels(rid, t, act);
    for (const area of act.areas || []) for (const e of areaEntries(area)) {
      for (const sp of shownAs(e.species, lo, hi)) {
        (out[sp] ||= []).push({ kind: e.rare ? 'rare' : 'wild', region: rid, act: t + 1, area: area.name, as: sp === e.species ? 'direct' : 'evolved', from: e.species });
      }
    }
  });
  return out;
}

// ---- legendary nodes, mythics, starters ---------------------------------------------------------------------------
const legendKeys = (act) => [act.bird, ...(act.elites || []), ...(act.bosses || []), ...(act.rareLegends || []).map(([key]) => key)].filter(Boolean);
export function legendSources() {
  const out = {};
  eachAct((rid, act, t) => {
    for (const k of legendKeys(act)) {
      const L = LEGENDS[k];
      if (L) (out[L.species] ||= []).push({ kind: 'legend', region: rid, act: t + 1, node: k });
    }
  });
  return out;
}
export function mythicSources() {
  const out = {};
  for (const e of EVENTS) if (e.mythic && MYTHICS[e.mythic]) (out[MYTHICS[e.mythic].species] ||= []).push({ kind: 'mythic', event: e.id, region: e.world || 'any' });
  return out;
}
export function starterSources() {
  const out = {};
  for (const s of STARTERS) (out[s.species] ||= []).push({ kind: 'starter', region: 'any' });
  for (const rid of RG.REGION_IDS) for (const sp of RG.REGIONS[rid].starters || []) if (!out[sp]?.some(x => x.region === rid)) (out[sp] ||= []).push({ kind: 'starter', region: rid });
  return out;
}

// ---- "?" events (source scan of events.js, see the header) ------------------------------------------------------
const GIVES = /newMon|monChoices|rewardMons|wildFight|traded/;
function eventBlocks() {
  const src = readSrc('events.js');
  const byId = new Map(EVENTS.map(e => [e.id, e]));
  const ids = [...src.matchAll(/\n\s+id: '([a-z0-9_]+)'/g)].map(m => ({ id: m[1], at: m.index }));
  // an event's source: up to the next event or the next top-level declaration
  const blockOf = (i) => {
    const at = ids[i].at, d = src.slice(at).search(/\n(const|function|export) /);
    return src.slice(at, Math.min(ids[i + 1]?.at ?? src.length, d >= 0 ? at + d : src.length));
  };
  const out = [];
  ids.forEach((x, i) => {
    const ev = byId.get(x.id);
    if (!ev || ev.mythic || x.id === 'pc') return;
    let block = blockOf(i);
    // choices: KANTO.find(e => e.id === 'veteran').choices (an event sharing another's choices)
    const alias = block.match(/\.find\(e => e\.id === '([a-z0-9_]+)'\)\.choices/);
    if (alias) { const a = ids.findIndex(y => y.id === alias[1]); if (a >= 0) block += blockOf(a); }
    // the event's acts: from EVENTS, else the K([1, 2], {...}) / S([..]) head right before the id
    let acts = Array.isArray(ev.acts) ? ev.acts.map(a => a + 1) : null;
    if (!acts) acts = (src.slice(Math.max(0, x.at - 40), x.at).match(/\b[A-Z]\(\[([\d, ]+)\]/) || [])[1]?.split(',').map(a => +a.trim() + 1) || null;
    out.push({ id: x.id, world: ev.world || 'any', acts, block });
  });
  return { src, out };
}
// top-level species lists (const WAREHOUSE = [...]; const FOSSILS = {...})
function speciesConsts(src, keysIn) {
  const consts = {};
  for (const m of src.matchAll(/^const ([A-Z_0-9]+) = ([[{][^;]*?[\]}]);/gms)) { const ks = keysIn(m[2]); if (ks.length && m[1] !== 'LEGENDARY') consts[m[1]] = ks; }
  return consts;
}
export function eventSources() {
  const { src, out: blocks } = eventBlocks();
  const species = new Set(Object.keys(D.species));
  const keysIn = (s) => [...s.matchAll(/'([A-Z][A-Z0-9_]+)'/g)].map(m => m[1]).filter(k => species.has(k));
  const consts = speciesConsts(src, keysIn);
  const out = {};
  for (const b of blocks) {
    if (!GIVES.test(b.block)) continue;
    const ks = new Set(keysIn(b.block));
    for (const [name, list] of Object.entries(consts)) if (new RegExp(`\\b${name}\\b`).test(b.block)) list.forEach(k => ks.add(k));
    for (const sp of ks) (out[sp] ||= []).push({ kind: 'event', region: b.world, acts: b.acts, event: b.id });
  }
  return out;
}

// ---- evolution items ---------------------------------------------------------------------------------------------
// item -> [where]: the MART's stone slot (shop.js: one of items.js EVO_STONES that the party can use), run.js
// randomConsumable's table (stones only when the party can use them), and items named in events.js.
export function evoItems() {
  const out = {};
  const add = (k, w) => { if (D.items?.[k] && !(out[k] ||= []).includes(w)) out[k].push(w); };
  if (/EVO_STONES/.test(readSrc('shop.js'))) for (const k of EVO_STONES) add(k, 'mart');
  const run = readSrc('run.js'), at = run.indexOf('randomConsumable(');
  if (at >= 0) {
    const body = run.slice(at, at + run.slice(at).search(/\n {2}\}\n/));
    for (const m of body.matchAll(/\['([A-Z][A-Z0-9_]+)',/g)) add(m[1], 'found');
  }
  for (const m of readSrc('events.js').matchAll(/'([A-Z][A-Z0-9_]+)'/g)) if (CONSUMABLES[m[1]]?.evo) add(m[1], 'event');
  return out;
}
// How evolution e can happen here: 'level' | item key | null (not in this game).
export function evoRule(e) {
  if (LEVEL_RULES.includes(e.method)) return 'level';
  if (ITEM_RULES.includes(e.method)) return evoStone(e) || null;
  return null;
}

// ---- dangling references -----------------------------------------------------------------------------------------
// [{ where, key }]: a pool / event / legend / starter naming a species key that isn't in D.species (or a node key
// that isn't in LEGENDS).
export function danglingRefs() {
  const bad = [];
  const chk = (key, where) => { if (key && !D.species[key]) bad.push({ where, key }); };
  eachAct((rid, act, t) => {
    for (const area of act.areas || []) {
      const all = area.pool && !Array.isArray(area.pool) ? Object.values(area.pool).flat() : rawEntries(area).map(e => e.species);
      for (const sp of new Set([...all, ...(area.extra || []), ...(area.rare || [])])) chk(sp, `${rid} a${t + 1} ${area.name}`);
    }
    for (const k of [act.bird, ...(act.rareLegends || []).map(([key]) => key)].filter(Boolean)) if (!LEGENDS[k]) bad.push({ where: `${rid} a${t + 1} legend node`, key: k });
  });
  for (const [k, L] of Object.entries(LEGENDS)) chk(L.species, `LEGENDS.${k}`);
  for (const [k, M] of Object.entries(MYTHICS)) chk(M.species, `MYTHICS.${k}`);
  for (const e of EVENTS) if (e.mythic && !MYTHICS[e.mythic]) bad.push({ where: `event ${e.id} mythic`, key: e.mythic });
  for (const s of STARTERS) chk(s.species, 'STARTERS');
  for (const rid of RG.REGION_IDS) for (const sp of RG.REGIONS[rid].starters || []) chk(sp, `REGIONS.${rid}.starters`);
  // events: literal species arguments, sp: / mon: fields, and rng.pick / sample lists that hold a species
  const { out: blocks } = eventBlocks();
  const isUpper = (k) => /^[A-Z][A-Z0-9_]+$/.test(k);
  for (const b of blocks) {
    const w = `event ${b.id}`;
    for (const m of b.block.matchAll(/\b(?:gift|makeMon|wildFight)\((?:r, rng, )?'([A-Z][A-Z0-9_]+)'/g)) chk(m[1], w);
    for (const m of b.block.matchAll(/\b(?:sp|mon|species): '([A-Z][A-Z0-9_]+)'/g)) chk(m[1], w);
    if (!GIVES.test(b.block)) continue;
    for (const m of b.block.matchAll(/rng\.(?:pick|sample)\(\[([^\]]*)\]/g)) {
      const ks = [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]).filter(isUpper);
      if (ks.some(k => D.species[k]) && !ks.some(k => D.items?.[k])) ks.forEach(k => chk(k, w));
    }
  }
  return bad;
}

// ---- the audit ---------------------------------------------------------------------------------------------------
export async function audit() {
  await ensureData();
  const wild = wildSources(), ev = eventSources(), leg = legendSources(), myth = mythicSources(), start = starterSources();
  const items = evoItems();
  const all = Object.values(D.species);
  const directOf = (k) => [...(wild[k] || []), ...(ev[k] || []), ...(leg[k] || []), ...(myth[k] || []), ...(start[k] || [])];
  // evolution closure: species -> [{ kind: 'evolve', from, method, item }]
  const have = new Set(all.filter(s => directOf(s.key).length).map(s => s.key));
  const evolved = {};
  const unknownMethods = new Set();
  for (let changed = true; changed;) {
    changed = false;
    for (const s of all) {
      if (!have.has(s.key)) continue;
      for (const e of s.evolutions || []) {
        if (!D.species[e.into]) continue;
        const rule = evoRule(e);
        if (rule === null) { if (!LEVEL_RULES.includes(e.method) && !ITEM_RULES.includes(e.method)) unknownMethods.add(e.method); continue; }
        if (rule !== 'level' && !items[rule]) continue;
        const list = (evolved[e.into] ||= []);
        if (!list.some(x => x.from === s.key)) list.push({ kind: 'evolve', from: s.key, method: e.method, ...(rule !== 'level' ? { item: rule, itemFrom: items[rule] } : {}) });
        if (!have.has(e.into)) { have.add(e.into); changed = true; }
      }
    }
  }
  const row = (s) => {
    const w = wild[s.key] || [];
    const r = {
      dex: s.dex, key: s.key, legendary: LEGENDARY.includes(s.key),
      wildDirect: w.filter(x => x.kind === 'wild' && x.as === 'direct'),
      wildEvolved: w.filter(x => x.kind === 'wild' && x.as === 'evolved'),
      rare: w.filter(x => x.kind === 'rare'),
      event: ev[s.key] || [], legend: leg[s.key] || [], mythic: myth[s.key] || [], starter: start[s.key] || [],
      evolve: evolved[s.key] || [],
    };
    r.status = directOf(s.key).length ? 'catchable' : r.evolve.length ? 'evolution-only' : 'none';
    return r;
  };
  const rows = dexSpecies().map(row);
  const forms = all.filter(s => isForm(s)).map(row);
  return Object.assign(rows, { forms, dangling: danglingRefs(), unknownMethods: [...unknownMethods], evoItems: items });
}

const fmt = (x) => x.kind === 'event' ? `event:${x.event}(${x.region}${x.acts ? ' a' + x.acts.join('/') : ''})`
  : x.kind === 'legend' ? `legend:${x.region} a${x.act}`
    : x.kind === 'mythic' ? `mythic:${x.event}`
      : x.kind === 'starter' ? `starter:${x.region}`
        : x.kind === 'evolve' ? `evolve:${x.from} (${x.method}${x.item ? ' ' + x.item : ''})`
          : `${x.kind}:${x.region} a${x.act} ${x.area}${x.as === 'evolved' ? ` (as evolved ${x.from})` : ''}`;
export const sourcesOf = (r) => [...r.wildDirect, ...r.wildEvolved, ...r.rare, ...r.event, ...r.mythic, ...r.legend, ...r.starter, ...r.evolve];
export const fmtSource = fmt;

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const rows = await audit();
  if (process.argv.includes('--json')) { console.log(JSON.stringify({ rows: [...rows], forms: rows.forms, dangling: rows.dangling, unknownMethods: rows.unknownMethods, evoItems: rows.evoItems }, null, 1)); process.exit(0); }
  const n = (f) => rows.filter(f).length;
  const nonLeg = (r) => !r.legendary;
  console.log(`Regions: ${RG.REGION_IDS.join(', ')}`);
  console.log(`Species #1-${DEX_MAX}: ${rows.length} (${n(r => r.legendary)} legendary/mythical)${rows.forms.length ? `; forms without a dex entry (not checked): ${rows.forms.map(r => r.key).join(', ')}` : ''}`);
  console.log(`  wild pool (direct entry or level-evolved): ${n(r => r.wildDirect.length || r.wildEvolved.length)}`);
  console.log(`    of which only as a level-evolved pick: ${n(r => !r.wildDirect.length && r.wildEvolved.length)}`);
  console.log(`  rare finds: ${n(r => r.rare.length)}`);
  console.log(`  event (gift / trade / egg / catch / fight-and-catch): ${n(r => r.event.length)}`);
  console.log(`  mythic event: ${n(r => r.mythic.length)}`);
  console.log(`  legendary node: ${n(r => r.legend.length)}`);
  console.log(`  starter: ${n(r => r.starter.length)}`);
  console.log(`  catchable somewhere (any of the above): ${n(r => r.status === 'catchable')}  (non-legendary: ${n(r => nonLeg(r) && r.status === 'catchable')}/${n(nonLeg)})`);
  console.log(`  wild or rare, non-legendary: ${n(r => nonLeg(r) && (r.wildDirect.length || r.wildEvolved.length || r.rare.length))}/${n(nonLeg)}`);
  console.log(`  evolution-only (from an obtainable species): ${n(r => r.status === 'evolution-only')}`);
  console.log(`    of which need an evolution item: ${n(r => r.status === 'evolution-only' && r.evolve.every(x => x.item))}`);
  console.log(`  not obtainable: ${n(r => r.status === 'none')}`);
  console.log(`Evolution items handed out: ${Object.entries(rows.evoItems).filter(([k]) => CONSUMABLES[k]?.evo).map(([k, w]) => `${k} (${w.join('/')})`).join(', ')}`);
  const list = (title, f, more = () => '') => { const xs = rows.filter(f); console.log(`\n${title} (${xs.length}):`); console.log('  ' + xs.map(r => `#${r.dex} ${r.key}${more(r)}`).join(', ')); };
  list('Evolution-only', r => r.status === 'evolution-only');
  list('Not obtainable', r => r.status === 'none');
  list('Event-only (no wild pool, legend node or starter)', r => r.status === 'catchable' && !r.wildDirect.length && !r.wildEvolved.length && !r.rare.length && !r.legend.length && !r.starter.length);
  list('Legendary/mythical without a legendary node', r => r.legendary && !r.legend.length, r => (r.mythic.length ? ' (mythic event)' : ''));
  if (rows.unknownMethods.length) console.log(`\nEvolution methods this audit doesn't know (update LEVEL_RULES / ITEM_RULES): ${rows.unknownMethods.join(', ')}`);
  console.log(`\nDangling species references (${rows.dangling.length}):${rows.dangling.map(d => `\n  ${d.key}  (${d.where})`).join('')}`);
  if (process.argv.includes('--full')) for (const r of [...rows, ...rows.forms]) console.log(`#${r.dex} ${r.key} [${r.status}] ${sourcesOf(r).map(fmt).join('; ')}`);
}
