// Region registry (v0.1.0 "One Spire"). A region owns its act blocks (ACTS in acts.js, HOENN_ACTS in hoenn.js) and
// the bits of flavour and presentation that used to be `world === 'hoenn'` checks all over the code. Each act block
// carries its region id (act.region), so anything that depends on "where am I" asks the current act.
import { ACTS } from './acts.js';
import { HOENN_ACTS, HOENN_TRAINER_CLASSES } from './hoenn.js';
import { JOHTO_ACTS, JOHTO_TRAINER_CLASSES } from './johto.js';
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
export const JOHTO_WINS = 2;
export const johtoUnlocked = (meta) => !!meta?.unlocks?.johto || (meta?.totalWins || 0) >= JOHTO_WINS;
export function unlockedRegions(meta) {
  const out = meta?.unlocks?.win ? ['kanto', 'hoenn'] : ['kanto'];
  if (johtoUnlocked(meta)) out.push('johto');
  return out;
}

// The run's rival: MAY for a HOENN starter (national dex 252-386), SILVER for a JOHTO one (152-251), else BLUE.
// They counter your starter and grow every act, whatever the act's region.
export function rivalFor(starter) {
  const dex = D.species?.[starter]?.dex || 0;
  return dex >= 252 && dex <= 386 ? 'hoenn' : dex >= 152 && dex <= 251 ? 'johto' : 'kanto';
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
// 'spire_kanto' = a host who hasn't won yet) and the legacy worlds of rooms started before v0.1.0.
export const COOP_WORLDS = ['spire', 'spire_johto', 'spire_kanto', 'kanto', 'hoenn'];
export const COOP_POOLS = { spire: ['kanto', 'hoenn'], spire_johto: ['kanto', 'hoenn', 'johto'], spire_kanto: ['kanto'] };
export const isSpireWorld = (w) => !!COOP_POOLS[w];
export const coopWorldFor = (meta) => { const n = unlockedRegions(meta); return n.includes('johto') ? 'spire_johto' : n.length > 1 ? 'spire' : 'spire_kanto'; };
export const coopWorldRegions = (w) => (COOP_POOLS[w] || [w]).map(id => regionOf(id).name).join(' + ');

// A run's act list: a spire run's built list, or a legacy world's fixed one (saves from before v0.1.0 finish in it).
export function actsForRun(run) { return run.world === SPIRE ? spireActs(run.regions, run.rival) : actsFor(run.world); }

// The GYM LEADERS an act can end with (the act-clear preview of the next act).
export const actBosses = (act) => (act?.bosses || []).filter(k => !k.startsWith('LEGEND_'));

// ---- presentation helpers --------------------------------------------------------------------------------------
const SHOWN_NAMES = { RS_CHAMPION: 'STEVEN', CHAMPION_FIRST: 'BLUE', LEADER_TATE_LIZA: 'TATE & LIZA' };
export const regionByLetter = (l) => REGIONS[REGION_IDS.find(id => REGIONS[id].letter === l)] || null;
export const trainerName = (key) => SHOWN_NAMES[key] || D.trainers?.[key]?.name || String(key).replace(/^(LEADER|ELITE_FOUR)_/, '');
export const trainerPic = (key) => D.trainers?.[key === 'CHAMPION_FIRST' ? 'CHAMPION_FIRST_SQUIRTLE' : key]?.pic || null;
// "ACT 2 · HOENN" for a spire act (legacy worlds keep their own short title, e.g. "HOENN 2").
export const actTitle = (run, act = run.act) => (run.world === SPIRE && act && !act.postgame ? `${act.short} · ${regionOf(act.region).name}` : act?.short || '');
// "a, b or c"
export const orList = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} or ${xs[xs.length - 1]}`);
