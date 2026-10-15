// What's NEW from a run (v0.5.26): new personal records, POKéMON seen / caught for the first time and held items found
// for the first time, shown on the end-of-run screens (scenes/run_news.js; solo and co-op, win or loss).
//
// At the start of a run the player's meta is snapshotted (meta.runSnaps[key]: the POKéDEX, the HELD ITEMS found and the
// personal records); at the end the run is compared against that snapshot. Solo: key soloSnapKey(run), taken by the
// first saveRun of the run (state.js). Co-op: 'coop:<roomId>', taken by the session's first route (scenes/coop/session.js).
//
// Personal records live in meta.records ({ key: best value }, RECORDS below). Display only: nothing here is game logic,
// nothing touches a Run's game state or RNG, so co-op replay and saved games are unaffected.

// better: 'high' (the default) or 'low'. min: the smallest value that counts as a record (a run with 0 crits sets none).
export const RECORDS = [
  { key: 'furthest', label: 'FURTHEST CLIMB', fmt: (v) => `ACT ${Math.floor(v / 1000)}, FLOOR ${v % 1000}` },
  { key: 'ascWon', label: 'HIGHEST ASCENSION CLEARED', min: 0, fmt: (v) => `A${v}` },
  { key: 'fastestWin', label: 'FASTEST CLEAR', better: 'low', fmt: (v) => fmtDuration(v) },
  { key: 'bestHand', label: 'BEST HAND', fmt: (v) => `${v.toLocaleString()} damage` },
  { key: 'trainers', label: 'MOST TRAINERS DEFEATED', fmt: (v) => `${v}` },
  { key: 'caught', label: 'MOST POKéMON CAUGHT', fmt: (v) => `${v}` },
  { key: 'crits', label: 'MOST CRITICAL HITS', fmt: (v) => `${v}` },
  { key: 'money', label: 'MOST MONEY EARNED', fmt: (v) => `$${v.toLocaleString()}` },
];
export const RECORD_BY_KEY = Object.fromEntries(RECORDS.map(r => [r.key, r]));
const MAX_SNAPS = 4; // runs in progress with a snapshot (an abandoned run's snapshot is dropped by newer ones)

export function fmtDuration(ms) {
  const m = Math.max(1, Math.round(ms / 60000));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
}

// A position on the spire as one number: act 3, floor 7 -> 3007 (floors are 0-based in a Run, shown 1-based).
export const progressValue = (actIndex, floor) => (actIndex + 1) * 1000 + Math.max(1, Math.min(999, (floor ?? 0) + 1));

// The record values of one run. won: the run beat a CHAMPION (solo: also a post-game run that later lost).
// pos: whatever holds actIndex / floor (co-op: the world run; default: the run itself).
export function runRecordValues(run, { won = false, pos = run } = {}) {
  const s = run?.stats || {}, v = {};
  const n = (x) => (Number.isFinite(x) ? x : 0);
  v.bestHand = n(s.bestHand); v.trainers = n(s.trainers); v.caught = n(s.caught); v.crits = n(s.crits); v.money = n(s.moneyEarned);
  if (pos && Number.isInteger(pos.actIndex)) v.furthest = progressValue(pos.actIndex, pos.floor);
  if (won) {
    v.ascWon = Number.isInteger(run?.ascension) ? run.ascension : 0;
    if (Number.isFinite(s.clearMs) && s.clearMs > 0) v.fastestWin = s.clearMs;
  }
  return v;
}

const better = (def, v, prev) => (def.better === 'low' ? v < prev : v > prev) && (def.better === 'low' || v >= (def.min ?? 1));

// meta.records for a save from before v0.5.26, from what it already has (the last runs and bestAscensionWon), so the
// first run after the update only shows records it really beat. Keys with no history start with that run (no NEW).
// -> true if it changed meta.
export function seedRecords(meta) {
  if (!meta || (meta.records && typeof meta.records === 'object' && !Array.isArray(meta.records))) return false;
  const rec = {};
  const runs = Array.isArray(meta.runs) ? meta.runs : [];
  for (const r of runs) {
    if (Number.isInteger(r?.act) && r.act >= 1) rec.furthest = Math.max(rec.furthest ?? 0, progressValue(r.act - 1, r.floor));
    if (Number.isFinite(r?.best) && r.best > 0) rec.bestHand = Math.max(rec.bestHand ?? 0, r.best);
  }
  rec.ascWon = Number.isInteger(meta.bestAscensionWon) ? meta.bestAscensionWon : -1;
  meta.records = rec;
  return true;
}

// Writes a run's values into meta.records (a key seen for the first time just starts there). -> the keys improved.
export function applyRecords(meta, values) {
  if (!meta || !values) return [];
  if (!meta.records || typeof meta.records !== 'object' || Array.isArray(meta.records)) meta.records = {};
  const out = [];
  for (const def of RECORDS) {
    const v = values[def.key], prev = meta.records[def.key];
    if (!Number.isFinite(v)) continue;
    if (!Number.isFinite(prev)) meta.records[def.key] = v;
    else if (better(def, v, prev)) { meta.records[def.key] = v; out.push(def.key); }
  }
  return out;
}

export function metaSnapshot(meta) {
  const seen = new Set([...(meta?.dexSeen || []), ...(meta?.dexCaught || [])]);
  return { at: Date.now(), seen: [...seen], caught: [...(meta?.dexCaught || [])], relics: [...(meta?.relicsFound || [])], records: { ...(meta?.records || {}) } };
}

// The snapshot for a run starting now (no-op if it already has one). -> true if it was taken.
export function startRunSnapshot(meta, key) {
  if (!meta || !key) return false;
  if (!meta.runSnaps || typeof meta.runSnaps !== 'object' || Array.isArray(meta.runSnaps)) meta.runSnaps = {};
  if (meta.runSnaps[key]) return false;
  meta.runSnaps[key] = metaSnapshot(meta);
  const keys = Object.keys(meta.runSnaps).sort((a, b) => (meta.runSnaps[b]?.at || 0) - (meta.runSnaps[a]?.at || 0));
  for (const k of keys.slice(MAX_SNAPS)) delete meta.runSnaps[k];
  return true;
}
export const runSnapshot = (meta, key) => (key && meta?.runSnaps?.[key]) || null;
export function dropRunSnapshot(meta, key) { if (key && meta?.runSnaps?.[key]) { delete meta.runSnaps[key]; return true; } return false; }

const uniq = (a) => [...new Set((a || []).filter(x => typeof x === 'string' && x))];

// What's new against a snapshot. now: { seen, caught, relics, values } (the lists as they are at the end of the run,
// i.e. the meta lists plus the run's own). -> { records: [{ key, label, value, prev, text, prevText }], caught: [species],
// seen: [species: seen but not caught], relics: [held item keys] }, or null with no snapshot.
// isRelic (optional): drops held item keys that no longer exist.
export function runNews(snap, now = {}, { isRelic } = {}) {
  if (!snap) return null;
  const prevSeen = new Set(snap.seen || []), prevCaught = new Set(snap.caught || []), prevRelics = new Set(snap.relics || []);
  const caught = uniq(now.caught).filter(s => !prevCaught.has(s));
  const caughtNow = new Set(caught);
  const seen = uniq([...(now.seen || []), ...(now.caught || [])]).filter(s => !prevSeen.has(s) && !prevCaught.has(s) && !caughtNow.has(s));
  const relics = uniq(now.relics).filter(k => !prevRelics.has(k) && (!isRelic || isRelic(k)));
  const records = [];
  const prevRec = snap.records || {}, values = now.values || {};
  for (const def of RECORDS) {
    const v = values[def.key], prev = prevRec[def.key];
    if (!Number.isFinite(v) || !Number.isFinite(prev) || !better(def, v, prev)) continue;
    const first = def.key === 'ascWon' && prev < 0; // (the first win ever)
    records.push({ key: def.key, label: first ? 'FIRST CHAMPIONSHIP' : def.label, value: v, prev, text: def.fmt(v), prevText: first ? null : def.fmt(prev) });
  }
  return { records, caught, seen, relics };
}
export const newsCount = (n) => (n ? n.records.length + n.caught.length + n.seen.length + n.relics.length : 0);

// ---- solo ----------------------------------------------------------------------------------------------------------
// The key of a solo run's snapshot (its seed plus its start time, so replaying a seed never picks up a stale one).
export const soloSnapKey = (run) => (run && !run.coop && run.seed ? `solo:${run.seed}:${run.stats?.startTime || 0}` : null);
export const soloWon = (run, result) => result === 'win' || result === 'postgame' || !!run?.postgame || !!run?.victory;

// A solo run's news. commit: the run is over (state.js endRun): its records are written and its snapshot dropped.
export function soloRunNews(meta, run, result, { commit = false, isRelic } = {}) {
  const key = soloSnapKey(run), snap = runSnapshot(meta, key);
  const values = runRecordValues(run, { won: soloWon(run, result) });
  const news = runNews(snap, {
    seen: [...(meta?.dexSeen || []), ...(run?.seen || [])],
    caught: [...(meta?.dexCaught || []), ...(run?.caughtSpecies || [])],
    relics: [...(meta?.relicsFound || []), ...(run?.relics || []).map(r => r?.key)],
    values,
  }, { isRelic });
  if (commit) { applyRecords(meta, values); dropRunSnapshot(meta, key); }
  return news;
}

// ---- co-op ---------------------------------------------------------------------------------------------------------
export const coopSnapKey = (roomId) => (roomId ? `coop:${roomId}` : null);
// The local player's news at the end of a co-op game (the session has already merged their dex and held items into
// meta). Commits like solo: records written, snapshot dropped. -> null without a snapshot (e.g. a reload on the end
// screen: the news was shown already).
export function coopRunNews(meta, game, slot, roomId, { won = false, isRelic } = {}) {
  const key = coopSnapKey(roomId), snap = runSnapshot(meta, key);
  if (!snap) return null;
  const run = game?.runs?.[slot];
  const values = runRecordValues(run, { won, pos: game?.world || run });
  const news = runNews(snap, {
    seen: meta.dexSeen || [], caught: meta.dexCaught || [],
    relics: [...(meta.relicsFound || []), ...(run?.relics || []).map(r => r?.key)], values,
  }, { isRelic });
  applyRecords(meta, values);
  dropRunSnapshot(meta, key);
  return news;
}
