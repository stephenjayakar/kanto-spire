// Starter unlocks (meta-progression). meta.unlockedStarters lists the species a player may start with;
// every act clear offers ONE new starter, picked from up to 3 random still-locked ones.
// Pure functions over the meta object (no storage, no run state): scenes/unlock.js draws the choice.
// Offers use Math.random (or a passed rand), never run.rng, so runs and bots are unaffected.
import { STARTERS } from './acts.js';
import { HOENN_STARTERS } from './hoenn.js';
import { regionOf } from './regions.js';

export const STARTER_VER = 2; // meta.starterVer: 2 = the explicit unlockedStarters list (reset in v0.0.5)
export const KANTO_STARTERS = ['BULBASAUR', 'CHARMANDER', 'SQUIRTLE'];
export { HOENN_STARTERS };
export const OFFER_SIZE = 3;
const CLAIMS_MAX = 200; // remembered act-clear keys (guards against claiming the same act twice)

// Old saves (no or an older starterVer) start over with the Kanto three; everything else is kept.
// Returns true when the meta was changed (the caller saves it).
export function migrateStarterMeta(meta) {
  if (!meta || typeof meta !== 'object') return false;
  if ((meta.starterVer ?? 0) >= STARTER_VER && Array.isArray(meta.unlockedStarters)) return false;
  meta.unlockedStarters = [...KANTO_STARTERS];
  meta.starterVer = STARTER_VER;
  return true;
}

// The always-available starters: the KANTO three (One Spire, and the legacy KANTO world), or the HOENN three for a
// legacy HOENN world (only old saves / co-op rooms from before v0.1.0 still use it).
export const worldDefaultStarters = (world) => regionOf(world).starters;

// One Spire (v0.1.0): TREECKO / TORCHIC / MUDKIP are no longer "always open in HOENN". Players who had HOENN access
// (meta.unlocks.win) keep them: they're added to unlockedStarters once (meta.spireVer); after that they're normal
// act-clear unlocks. Returns true when the meta changed.
export const SPIRE_VER = 1;
export function migrateSpireMeta(meta) {
  if (!meta || typeof meta !== 'object') return false;
  if ((meta.spireVer ?? 0) >= SPIRE_VER) return false;
  meta.unlockedStarters = Array.isArray(meta.unlockedStarters) ? meta.unlockedStarters : [...KANTO_STARTERS];
  if (meta.unlocks?.win) for (const s of HOENN_STARTERS) if (!meta.unlockedStarters.includes(s)) meta.unlockedStarters.push(s);
  meta.spireVer = SPIRE_VER;
  return true;
}

export function isStarterUnlocked(meta, species, world = 'kanto') {
  if (worldDefaultStarters(world).includes(species)) return true;
  return (meta?.unlockedStarters || KANTO_STARTERS).includes(species);
}

// Every starter species in STARTERS order; has(species) filters out ones without data (e.g. D.species).
export const allStarters = (has) => STARTERS.map(s => s.species).filter(s => !has || has(s));
export const lockedStarters = (meta, has) => allStarters(has).filter(s => !(meta?.unlockedStarters || KANTO_STARTERS).includes(s));

// The starters a player can bring in a world: its defaults first, then their unlocked ones.
export function availableStarters(meta, world = 'kanto', has) {
  const def = worldDefaultStarters(world).filter(s => !has || has(s));
  return [...def, ...allStarters(has).filter(s => !def.includes(s) && isStarterUnlocked(meta, s, world))];
}

function pickN(list, n, rand) {
  const pool = list.slice(), out = [];
  while (pool.length && out.length < n) out.push(pool.splice(Math.floor(rand() * pool.length) % pool.length, 1)[0]);
  return out;
}

// Keys for one act clear. Solo: seed + start time (a replayed seed is a new run) + act index.
export const soloActKey = (run) => `${run.seed}:${run.stats?.startTime || 0}:${run.actIndex}`;
export const coopActKey = (roomId, actIndex) => `coop:${roomId}:${actIndex}`;

// Grants the offer for an act clear (once per key). Returns the new offer, or null when this act was
// already claimed / offered or nothing is left to unlock.
export function grantStarterOffer(meta, key, { rand = Math.random, has } = {}) {
  if (!meta || !key) return null;
  meta.starterOffers = Array.isArray(meta.starterOffers) ? meta.starterOffers : [];
  meta.starterClaims = Array.isArray(meta.starterClaims) ? meta.starterClaims : [];
  if (meta.starterClaims.includes(key) || meta.starterOffers.some(o => o.key === key)) return null;
  const locked = lockedStarters(meta, has);
  if (!locked.length) return null;
  const offer = { key, options: pickN(locked, OFFER_SIZE, rand) };
  meta.starterOffers.push(offer);
  return offer;
}

// The first pending offer, refreshed: options unlocked meanwhile (by an earlier offer) are replaced so it
// still shows up to 3 locked starters. Drops every offer once nothing is locked. Mutates meta.
export function currentStarterOffer(meta, { rand = Math.random, has } = {}) {
  const offers = Array.isArray(meta?.starterOffers) ? meta.starterOffers : [];
  if (!offers.length) return null;
  const locked = lockedStarters(meta, has);
  if (!locked.length) { offers.length = 0; return null; }
  const o = offers[0];
  o.options = (Array.isArray(o.options) ? o.options : []).filter(s => locked.includes(s));
  const want = Math.min(OFFER_SIZE, locked.length);
  if (o.options.length < want) o.options.push(...pickN(locked.filter(s => !o.options.includes(s)), want - o.options.length, rand));
  return o;
}

// Unlocks one species from the offer `key`. Returns false (and changes nothing) for a stale key or a
// species that wasn't offered.
export function claimStarterOffer(meta, key, species) {
  const offers = Array.isArray(meta?.starterOffers) ? meta.starterOffers : [];
  const i = offers.findIndex(o => o.key === key);
  if (i < 0 || !offers[i].options?.includes(species)) return false;
  offers.splice(i, 1);
  meta.unlockedStarters = Array.isArray(meta.unlockedStarters) ? meta.unlockedStarters : [...KANTO_STARTERS];
  if (!meta.unlockedStarters.includes(species)) meta.unlockedStarters.push(species);
  meta.starterClaims = [...(Array.isArray(meta.starterClaims) ? meta.starterClaims : []).filter(k => k !== key), key].slice(-CLAIMS_MAX);
  return true;
}

// ---- ascension unlocks, per starter (v0.0.6) ----------------------------------------------------------
// meta.ascBy[species] = the highest ascension unlocked with that starter: a win at An with it opens A(n+1)
// for that starter only. meta.lastAscBy[species] = the level last picked with it. meta.maxAscension and
// bestAscensionWon stay as account-wide stats (title screen, records); they no longer gate anything.
export const ASC_VER = 1; // meta.ascVer: 1 = per-starter unlocks (rebuilt once from the run history)
export const MAX_ASC = 10;
const clampAsc = (n) => Math.max(0, Math.min(MAX_ASC, n | 0));

export const ascUnlocked = (meta, species) => clampAsc(meta?.ascBy?.[species] ?? 0);

// A won run at `ascension` with `species` opens the next level for it. Returns true when that is new.
export function grantAscension(meta, species, ascension) {
  if (!meta || !species) return false;
  meta.ascBy = meta.ascBy && typeof meta.ascBy === 'object' ? meta.ascBy : {};
  const n = clampAsc(ascension + 1);
  if (n <= ascUnlocked(meta, species)) return false;
  meta.ascBy[species] = n;
  return true;
}

// A co-op win counts like a solo win for ascensions: each player's own starter opens A(n+1), and the account
// stats (best ascension won, highest unlocked) update. Idempotent, so re-entering the end screen is harmless.
export function grantCoopWin(meta, species, ascension) {
  if (!meta || !species) return false;
  const a = clampAsc(ascension);
  const before = JSON.stringify([meta.ascBy?.[species], meta.bestAscensionWon, meta.maxAscension]);
  grantAscension(meta, species, a);
  meta.bestAscensionWon = Math.max(meta.bestAscensionWon ?? -1, a);
  meta.maxAscension = Math.max(meta.maxAscension ?? 0, clampAsc(a + 1));
  return JSON.stringify([meta.ascBy?.[species], meta.bestAscensionWon, meta.maxAscension]) !== before;
}

// The level the picker opens on for a starter: the one last used with it, else the old global pick, capped.
export const ascDefault = (meta, species) => Math.min(ascUnlocked(meta, species), clampAsc(meta?.lastAscBy?.[species] ?? meta?.lastAscension ?? 0));

// A co-op room's cap: the lower of the players' unlocks for the starters they picked (unknown = no cap).
export function coopAscCap(members) {
  const known = (members || []).map(m => m?.ascMax).filter(n => typeof n === 'number');
  return known.length ? Math.min(...known.map(clampAsc)) : MAX_ASC;
}

// A history entry counts as a win if it says so, or if it reached the post-game act (a CHAMPION who carried
// on and then blacked out is saved as 'lose' with act 5, though the championship counted).
export const historyWon = (r) => r?.result === 'win' || r?.result === 'postgame' || (r?.act | 0) >= 5;

// One-time move from the global gate: each starter gets one level above the highest ascension it was cleared at
// in the save's run history (meta.runs). The server ran the same rule over every cloud save with the whole run
// history (convex/ascension.ts, migrations:ascensionFromClears). Nothing else in the meta changes. Returns
// true when it changed.
export function migrateAscensionMeta(meta) {
  if (!meta || typeof meta !== 'object') return false;
  if ((meta.ascVer ?? 0) >= ASC_VER && meta.ascBy && typeof meta.ascBy === 'object') return false;
  const ascBy = {};
  for (const r of Array.isArray(meta.runs) ? meta.runs : []) {
    if (r && typeof r.starter === 'string' && historyWon(r)) ascBy[r.starter] = Math.max(ascBy[r.starter] || 0, clampAsc((r.ascension | 0) + 1));
  }
  meta.ascBy = ascBy;
  meta.ascVer = ASC_VER;
  return true;
}
