// Region registry (v0.1.0 "One Spire"). A region owns its act blocks (ACTS in acts.js, HOENN_ACTS in hoenn.js) and
// the bits of flavour and presentation that used to be `world === 'hoenn'` checks all over the code. Each act block
// carries its region id (act.region), so anything that depends on "where am I" asks the current act.
import { ACTS } from './acts.js';
import { HOENN_ACTS, HOENN_TRAINER_CLASSES } from './hoenn.js';
import { JOHTO_ACTS, JOHTO_TRAINER_CLASSES } from './johto.js';
import { SINNOH_ACTS, SINNOH_TRAINER_CLASSES, SINNOH_STARTERS } from './sinnoh.js';
import { getCaps, capsOk } from './caps.js';
import { D } from './data.js';
import { RNG } from './rng.js';

export const REGIONS = {
  kanto: {
    id: 'kanto', name: 'KANTO', letter: 'K', acts: ACTS,
    starters: ['BULBASAUR', 'CHARMANDER', 'SQUIRTLE'],
    // trainers come from FireRed's own trainer data (Hoenn's are built from the act's wild pools)
    genericTrainers: false,
    mapTheme: 'map',
    // the rival who comes from this region (picked by the player's starter in One Spire); keyed: FireRed's trainer
    // keys name the rival's starter (RIVAL_CERULEAN_SQUIRTLE), else one authored team gets its starter line swapped
    rival: { name: 'BLUE', sprite: 'blue', encounterSong: 'mus_encounter_rival', keyed: true },
    // the ELITE FOUR + CHAMPION block (act 4's gauntlet): where it is, the overworld sprite on the map, HP scale (legacy
    // world; spireHp: per room in a spire run, where it plays at the KANTO levels)
    summit: { place: 'INDIGO PLATEAU', sprite: 'lance', hp: 1, spireHp: [1, 1, 1, 1, 1], spireDmg: [1, 1, 1, 1, 1] },
    professor: { name: 'OAK', title: 'PROF. OAK', npc: 'oak' },
    pc: { title: "BILL'S PC", npc: 'bill', text: "BILL: Hiya! I'm a POKéMANIAC! Want to trade? Send one over and I'll send back something surprising!" },
    postgame: { title: 'LEGEND OF KANTO', line: 'You conquered the SEVII ISLANDS!' },
    requires: [], // (v0.6.0: the content caps the region needs, caps.js)
  },
  hoenn: {
    id: 'hoenn', name: 'HOENN', letter: 'H', acts: HOENN_ACTS,
    starters: ['TREECKO', 'TORCHIC', 'MUDKIP'],
    genericTrainers: true, trainerClasses: HOENN_TRAINER_CLASSES,
    mapTheme: 'grass',
    // keyed: false = one authored team per act whose starter line (line) is swapped for the counter-pick's
    rival: { name: 'MAY', sprite: 'rs_may', encounterSong: 'mus_encounter_girl', keyed: false, line: 'TORCHIC' },
    summit: { place: 'EVER GRANDE', sprite: null, hp: 1.15, spireHp: [1.15, 1.15, 1.15, 1.15, 1.15], spireDmg: [1, 1, 1, 1, 1] },
    professor: { name: 'BIRCH', title: 'PROF. BIRCH', npc: 'scientist' },
    pc: { title: "LANETTE'S PC", npc: 'woman_2', text: 'LANETTE: My PC BOX system can swap POKéMON with trainers all over! Send one over, or take a posted trade.' },
    postgame: { title: 'LEGEND OF HOENN', line: 'You calmed RAYQUAZA at the SKY PILLAR!' },
    requires: [], // (falls back to FireRed's art without Emerald's)
  },
  // v0.1.1 "JOHTO" (HeartGold): trainers are authored in johto.js (FireRed's data has no Johto trainers); every Johto
  // party is Gen 1-2. dayNight: the act's areas carry pool: { morn, day, nite } (HGSS encounter slots), picked by the
  // floor (timeOfDay below), never the real clock.
  johto: {
    id: 'johto', name: 'JOHTO', letter: 'J', acts: JOHTO_ACTS,
    starters: ['CHIKORITA', 'CYNDAQUIL', 'TOTODILE'],
    genericTrainers: true, trainerClasses: JOHTO_TRAINER_CLASSES,
    mapTheme: 'grass', dayNight: true,
    rival: { name: 'SILVER', sprite: 'hgss/silver', encounterSong: 'mus_encounter_rival', keyed: false, line: 'CYNDAQUIL' },
    // champion: the last gauntlet room is LANCE (not the rival, unlike KANTO)
    summit: { place: 'INDIGO PLATEAU', sprite: 'lance', hp: 1, spireHp: [1, 1, 1, 1, 1], spireDmg: [1, 1, 1, 1, 1] },
    professor: { name: 'ELM', title: 'PROF. ELM', npc: 'scientist' },
    pc: { title: "BILL'S PC", npc: 'bill', text: "BILL: Hiya! I'm in GOLDENROD now, visiting my folks. Want to trade? Send one over and I'll send back something surprising!" },
    postgame: { title: 'LEGEND OF JOHTO', line: 'You defeated RED at the summit of MT. SILVER!' },
    requires: ['johto'],
  },
  // v0.6.0 "SINNOH" (Platinum): built like JOHTO (sinnoh.js); acts 1-3 GYM LEADERS (2 / 2 / 4), act 4 the POKéMON LEAGUE
  // (CYNTHIA), the DISTORTION WORLD post-game (GIRATINA ORIGIN). Open whenever the 'sinnoh' cap is on (no win needed).
  sinnoh: {
    id: 'sinnoh', name: 'SINNOH', letter: 'S', acts: SINNOH_ACTS,
    starters: SINNOH_STARTERS,
    genericTrainers: true, trainerClasses: SINNOH_TRAINER_CLASSES,
    mapTheme: 'grass', dayNight: true,
    rival: { name: 'BARRY', sprite: 'platinum/barry', encounterSong: 'mus_encounter_rival', keyed: false, line: 'CHIMCHAR' },
    summit: { place: 'POKéMON LEAGUE', sprite: 'platinum/cynthia', hp: 1, spireHp: [1, 1, 1, 1, 1], spireDmg: [1, 1, 1, 1, 1] },
    professor: { name: 'ROWAN', title: 'PROF. ROWAN', npc: 'oak' },
    pc: { title: "BEBE'S PC", npc: 'woman_2', text: "BEBE: Hi! I'm BEBE, I look after the PC BOX system here in SINNOH. Want to trade? Send one over and I'll send back something surprising!" },
    postgame: { title: 'LEGEND OF SINNOH', line: 'You faced GIRATINA in the DISTORTION WORLD!' },
    requires: ['sinnoh', 'gen4'],
  },
};
export const REGION_IDS = Object.keys(REGIONS);
export const regionOf = (id) => REGIONS[id] || REGIONS.kanto;

// A legacy world's act list (runs started before v0.1.0 were 'kanto' or 'hoenn' worlds).
export function actsFor(world) { return regionOf(world).acts; }

// The region id of the act a run (or a co-op event probe: { region } / { world }) is in.
export function regionIdOf(p) {
  if (!p) return 'kanto';
  if (p.region && REGIONS[p.region]) return p.region;
  return REGIONS[p.world] ? p.world : 'kanto';
}

// ---- One Spire (v0.1.0) --------------------------------------------------------------------------------------
// A run has one shape: acts 1-3 (15 floors, a GYM LEADER each), act 4 (VICTORY ROAD + the ELITE FOUR and the
// CHAMPION), then the optional post-game. Each act slot draws its region from the run seed; the ELITE FOUR / CHAMPION
// ("summit") and the post-game are drawn from the regions the run visits in acts 1-4. Levels follow the tier (act
// slot), not the region: every region's act block plays at the KANTO levels of its slot.
export const SPIRE = 'spire';
export const TIERS = [
  { levels: [3, 12], bossLevel: 15 },
  { levels: [14, 25], bossLevel: 27 },
  { levels: [26, 37], bossLevel: 41 },
  { levels: [37, 42], bossLevel: 46 },
];
export const GAUNTLET_LEVELS = [44, 45, 46, 47, 49];

// The regions a player's spire draws from: KANTO only until their first win (existing players who had HOENN
// access, meta.unlocks.win, get HOENN acts straight away); JOHTO acts join after the 2nd win (v0.1.1: players who
// already have 2+ wins get them straight away; meta.unlocks.johto is set by endRun).
// v0.6.0: SINNOH acts are in every player's spire from the start, whenever the 'sinnoh' content is there (caps.js; always
// on the hosted build): no win needed. Every region also needs its content caps (REGIONS[id].requires).
export const JOHTO_WINS = 2;
export const johtoUnlocked = (meta) => !!meta?.unlocks?.johto || (meta?.totalWins || 0) >= JOHTO_WINS;
export const regionAvailable = (id, caps = getCaps()) => !!REGIONS[id] && capsOk(REGIONS[id].requires, caps);
export function unlockedRegions(meta, caps = getCaps()) {
  const out = meta?.unlocks?.win ? ['kanto', 'hoenn'] : ['kanto'];
  if (johtoUnlocked(meta)) out.push('johto');
  out.push('sinnoh');
  return out.filter(id => regionAvailable(id, caps));
}
// The caps a spire draw needs: every region it visits (acts, summit, post-game, A10's second summit).
export function spireRequires(sp, summit2 = null) {
  if (!validSpire(sp)) return [];
  const ids = new Set([...sp.acts, sp.summit, sp.post, ...(summit2 ? [summit2] : [])]);
  return [...new Set([...ids].flatMap(id => REGIONS[id]?.requires || []))].sort();
}

// The run's rival: MAY for a HOENN starter (national dex 252-386), SILVER for a JOHTO one (152-251), BARRY for a
// SINNOH one (387-395: the TURTWIG / CHIMCHAR / PIPLUP lines), else BLUE. They counter your starter and grow every act,
// whatever the act's region.
export function rivalFor(starter) {
  const dex = D.species?.[starter]?.dex || 0;
  return dex >= 387 && dex <= 395 ? 'sinnoh' : dex >= 252 && dex <= 386 ? 'hoenn' : dex >= 152 && dex <= 251 ? 'johto' : 'kanto';
}

// ---- day / night (JOHTO acts) ------------------------------------------------------------------------------
// HGSS splits encounters into morning / day / night. In the spire it's the floor, not the clock: the first third of
// an act is morning, the middle third day, the last third night (15 floors: 0-4 / 5-9 / 10-14).
export const TIMES = ['morn', 'day', 'nite'];
export const TIME_NAMES = { morn: 'MORNING', day: 'DAY', nite: 'NIGHT' };
export function timeOfDay(floor, floors) {
  const t = Math.max(0, floor) / Math.max(1, floors);
  return t < 1 / 3 ? 'morn' : t < 2 / 3 ? 'day' : 'nite';
}
// An area's species at a time of day (pool: [...] or { morn, day, nite }; tod null = every time of day).
export function areaPool(area, tod = null) {
  const p = area?.pool;
  if (!p) return null;
  if (Array.isArray(p)) return p;
  if (tod) return p[tod] || p.day || [];
  return [...new Set(TIMES.flatMap(k => p[k] || []))];
}
// v0.3.25 "catch 'em all": every Pokédex species (#1-386; v0.4.0: #1-493) but the legendaries can be met on a wild node somewhere. An
// area may add species to its wild pool (only wild nodes use these; generic trainers keep drawing from area.pool):
//   extra: [...]  more species, each EXTRA_WEIGHT as likely as an average species of the area's own pool;
//   rare:  [...]  rare finds (strong or special species), each RARE_SHARE of the area's own encounters (about 1 in 33,
//                 before the no-repeat rule thins the pool).
// The games' own tables stay the bulk of every area. tools/catch_audit.mjs lists where every species can be caught.
export const EXTRA_WEIGHT = 0.5, RARE_SHARE = 0.03;
// The area's wild entries ([{ species, rate }], run.js wildConfig) with its extra / rare species added (rare: true).
export function withFinds(area, base) {
  if (!area?.extra && !area?.rare) return base;
  const total = base.reduce((s, e) => s + (e.rate || 1), 0) || 1;
  const avg = base.length ? total / new Set(base.map(e => e.species)).size : 1;
  const add = (list, rate, rare) => (list || []).filter(sp => D.species[sp]).map(sp => (rare ? { species: sp, rate, rare } : { species: sp, rate }));
  return [...base, ...add(area.extra, avg * EXTRA_WEIGHT, false), ...add(area.rare, total * RARE_SHARE, true)];
}
// The rule a trainer brings as a boss / ELITE FOUR member: its own (t.rule, e.g. JOHTO's KOGA) or its key's.
export const ruleKeyOf = (key) => D.trainers?.[key]?.rule || String(key).replace(/^(LEADER_|ELITE_FOUR_)/, '');

// The region draw for a run (deterministic per seed and pool; its own RNG stream, so the run's RNG is untouched).
export function drawSpire(seed, pool = ['kanto']) {
  const ids = REGION_IDS.filter(id => (pool || []).includes(id));
  if (!ids.length) ids.push('kanto');
  const rng = new RNG(`${seed}:spire`);
  const acts = TIERS.map(() => rng.pick(ids));
  const visited = [...new Set(acts)];
  return { acts, summit: rng.pick(visited), post: rng.pick(visited) };
}
export const validSpire = (sp) => !!sp && Array.isArray(sp.acts) && sp.acts.length === TIERS.length && sp.acts.every(id => REGIONS[id]) && !!REGIONS[sp.summit] && !!REGIONS[sp.post];

// "K-H-H-K": the act regions of a spire run (records, menus).
export const spireCode = (sp) => (validSpire(sp) ? sp.acts.map(id => REGIONS[id].letter).join('-') : '');

const spireCache = new Map();
// The act list of a spire run, built from the regions' act blocks (cached: run.act is read all the time).
export function spireActs(sp, rival = 'kanto') {
  if (!validSpire(sp)) sp = { acts: TIERS.map(() => 'kanto'), summit: 'kanto', post: 'kanto' };
  const key = `${sp.acts.join(',')}|${sp.summit}|${sp.post}|${rival}`;
  let acts = spireCache.get(key);
  if (acts) return acts;
  acts = sp.acts.map((rid, t) => {
    const b = regionOf(rid).acts[t];
    const a = { ...b, region: rid, short: `ACT ${t + 1}`, levels: TIERS[t].levels, bossLevel: TIERS[t].bossLevel };
    // one rival per run: the act's rival floor is theirs, at this act's stage of their team
    if (b.rival) a.rival = regionOf(rival).acts[t].rival;
    if (b.gauntlet) {
      const s = regionOf(sp.summit);
      a.gauntlet = s.acts[t].gauntlet;
      a.gauntletLevels = GAUNTLET_LEVELS;
      a.summit = sp.summit;
      a.summitHp = s.summit.spireHp; // (per ELITE FOUR room; the legacy HOENN world keeps summit.hp)
      a.summitDmg = s.summit.spireDmg;
      a.name = `${b.name.split('→')[0].trim()} → ${s.summit.place}`;
    }
    return a;
  });
  acts.push({ ...regionOf(sp.post).acts[TIERS.length], region: sp.post });
  spireCache.set(key, acts);
  return acts;
}

// Co-op room worlds: One Spire ('spire' = KANTO + HOENN, 'spire_johto' = all three (v0.1.1, a host with JOHTO),
// 'spire_kanto' = a host who hasn't won yet) and the legacy worlds of rooms started before v0.1.0. v0.6.0 adds the
// SINNOH pools: 'spire_ks' (KANTO + SINNOH), 'spire_sinnoh' (KANTO + HOENN + SINNOH), 'spire_all' (all four).
export const COOP_WORLDS = ['spire', 'spire_johto', 'spire_kanto', 'spire_ks', 'spire_sinnoh', 'spire_all', 'kanto', 'hoenn'];
export const COOP_POOLS = {
  spire: ['kanto', 'hoenn'], spire_johto: ['kanto', 'hoenn', 'johto'], spire_kanto: ['kanto'],
  spire_ks: ['kanto', 'sinnoh'], spire_sinnoh: ['kanto', 'hoenn', 'sinnoh'], spire_all: ['kanto', 'hoenn', 'johto', 'sinnoh'],
};
export const isSpireWorld = (w) => !!COOP_POOLS[w];
// The host's pool as a room world: the world whose pool is exactly theirs, else the biggest one inside it.
export const coopWorldFor = (meta, caps = getCaps()) => {
  const n = new Set(unlockedRegions(meta, caps));
  if (n.has('johto')) n.add('hoenn'); // (as before v0.6.0: a JOHTO room always had HOENN too)
  const fits = Object.entries(COOP_POOLS).filter(([, p]) => p.every(id => n.has(id))).sort((a, b) => b[1].length - a[1].length);
  return fits[0]?.[0] || 'spire_kanto';
};
export const coopWorldRegions = (w) => (COOP_POOLS[w] || [w]).map(id => regionOf(id).name).join(' + ');

// ---- A10 double summit (v0.5.13) --------------------------------------------------------------------------------
// Like Slay the Spire 2's top ascension (a second boss at the end of the last act): an A10 run's act 4 ends with TWO
// ELITE FOUR + CHAMPION blocks. The first is the run's summit region as usual; the second (run.summit2) is another
// region's, so its four members and its CHAMPION are different trainers (KANTO: BLUE, HOENN: WALLACE, JOHTO: LANCE).
// Between the two blocks the team is fully healed (Run.gauntletBreakHeal). run.summit2 is only set on A10 runs
// started on v0.5.13+ (older saves and A0-A9 runs have no such field and keep the single gauntlet).
export const DOUBLE_SUMMIT_ASC = 10;
// The second summit's region, another region than the first summit's, so a fresh set of trainers: preferably one
// whose ELITE FOUR / CHAMPION share no trainer with the first (KANTO and JOHTO share BRUNO and LANCE) and that the run
// visits in acts 1-4, then one from the run's pool, then any. Its own RNG stream: the run's RNG is untouched.
const summitNames = (id) => new Set((regionOf(id).acts.find(a => a.gauntlet)?.gauntlet || []).map(k => (k === 'CHAMPION_FIRST' ? 'BLUE' : D.trainers?.[k]?.name || k)));
export function pickSummit2(seed, summit, visited = [], pool = null) {
  const first = summitNames(summit);
  const fresh = (id) => ![...summitNames(id)].some(n => first.has(n));
  const others = (ids, f = () => true) => [...new Set(ids)].filter(id => REGIONS[id] && id !== summit && f(id));
  const pre6 = REGION_IDS.filter(id => id !== 'sinnoh'); // (v0.6.0: a legacy world without a pool keeps its pre-SINNOH pick)
  const tiers = [others(visited, fresh), others(pool || [], fresh), others(visited), others(pool || []), others(pre6, fresh), others(pre6), others(REGION_IDS, fresh), others(REGION_IDS)];
  const cands = tiers.find(c => c.length) || [];
  return cands.length ? new RNG(`${seed}:summit2`).pick(cands) : null;
}
const doubleCache = new WeakMap();
// acts with the gauntlet act extended by summit2's ELITE FOUR + CHAMPION (rooms 5-9). Per room: gauntlet keys,
// gauntletLevels (both blocks at the act's ELITE FOUR levels), summitHp / summitDmg and summits (each room's region).
// secondSummitAt: the first room of the second block.
export function doubleSummitActs(acts, summit2) {
  if (!REGIONS[summit2]) return acts;
  let byRegion = doubleCache.get(acts);
  if (!byRegion) doubleCache.set(acts, byRegion = new Map());
  let out = byRegion.get(summit2);
  if (out) return out;
  out = acts.map((a, t) => {
    if (!a.gauntlet || a.secondSummitAt) return a;
    const s1 = regionOf(a.summit || a.region), s2 = regionOf(summit2);
    const b2 = s2.acts[t]?.gauntlet ? s2.acts[t] : s2.acts.find(x => x.gauntlet);
    if (!b2) return a;
    const n = a.gauntlet.length, n2 = b2.gauntlet.length;
    const per = (arr, len, d) => Array.from({ length: len }, (_, i) => (arr ? arr[Math.min(i, arr.length - 1)] : d));
    return {
      ...a,
      gauntlet: [...a.gauntlet, ...b2.gauntlet],
      gauntletLevels: [...a.gauntletLevels, ...per(a.gauntletLevels, n2)],
      summitHp: [...per(a.summitHp, n, s1.summit.hp), ...per(s2.summit.spireHp, n2, s2.summit.hp)],
      summitDmg: [...per(a.summitDmg, n, 1), ...per(s2.summit.spireDmg, n2, 1)],
      summits: [...per(null, n, s1.id), ...per(null, n2, s2.id)],
      summit2, secondSummitAt: n,
    };
  });
  byRegion.set(summit2, out);
  return out;
}

// A run's act list: a spire run's built list, or a legacy world's fixed one (saves from before v0.1.0 finish in it).
// A10 runs with a second summit (run.summit2) get act 4's gauntlet doubled (doubleSummitActs).
export function actsForRun(run) {
  const acts = run.world === SPIRE ? spireActs(run.regions, run.rival) : actsFor(run.world);
  return run.summit2 ? doubleSummitActs(acts, run.summit2) : acts;
}

// The GYM LEADERS an act can end with (the act-clear preview of the next act).
export const actBosses = (act) => (act?.bosses || []).filter(k => !k.startsWith('LEGEND_'));

// ---- presentation helpers --------------------------------------------------------------------------------------
const SHOWN_NAMES = { RS_CHAMPION: 'WALLACE', CHAMPION_FIRST: 'BLUE', LEADER_TATE_LIZA: 'TATE & LIZA', LEADER_WALLACE: 'JUAN' }; // (v0.3.25: EMERALD's 8th leader and CHAMPION)
export const regionByLetter = (l) => REGIONS[REGION_IDS.find(id => REGIONS[id].letter === l)] || null;
export const trainerName = (key) => SHOWN_NAMES[key] || D.trainers?.[key]?.name || String(key).replace(/^(LEADER|ELITE_FOUR)_/, '');
export const trainerPic = (key) => D.trainers?.[key === 'CHAMPION_FIRST' ? 'CHAMPION_FIRST_SQUIRTLE' : key]?.pic || null;
// "ACT 2 · HOENN" for a spire act (legacy worlds keep their own short title, e.g. "HOENN 2").
export const actTitle = (run, act = run.act) => (run.world === SPIRE && act && !act.postgame ? `${act.short} · ${regionOf(act.region).name}` : act?.short || '');
// "a, b or c"
export const orList = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} or ${xs[xs.length - 1]}`);
