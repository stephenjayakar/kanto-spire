// Co-op checkpoints: a CoopGame at a safe point (the shared map, between nodes) as plain JSON, and back.
// A checkpoint lets a room resume without replaying its whole action log, and it survives game updates: it is
// data, loaded into whatever code is current (Run.upgradeJSON fills in fields that code added).
//
// snapshotGame() only reads the CoopGame's public fields, so it also works on the frozen engines in
// web/src/legacy/<id>/ (a room replayed on an older engine is snapshotted at its latest safe point and handed to
// the current one). restoreGame() builds a game on any engine: pass { CoopGame, Run, RNG } of that engine.
//
// Restoring on the same code gives a game with the same checksum() as the one snapshotted (each Run keeps its own
// key order, which the checksum's JSON depends on; tests/coop_saves.test.mjs checks this at every safe point).
export const SNAPSHOT_FORMAT = 1;

// Between nodes on the shared map: no battle and no private screen is open, so the whole state is plain data.
export const isSafePoint = (g) => !!g && g.phase === 'map' && !!g.world && Array.isArray(g.runs) && g.runs.every(Boolean);

function runState(r, keepMap) {
  const o = { ...r };
  delete o.rng;
  delete o.pendingLevelEvents; // (UI-only, not saved by Run.toJSON either)
  delete o.pendingEvolution;
  if (!keepMap) delete o.map; // (player runs share the world's map: CoopGame.mirror puts it back)
  return { o: JSON.parse(JSON.stringify(o)), rng: r.rng ? r.rng.state : o.rngState };
}

export function snapshotGame(g) {
  if (!isSafePoint(g)) throw new Error(`Not a safe point (phase ${g?.phase})`);
  return {
    format: SNAPSHOT_FORMAT,
    seq: g.seq, phase: g.phase,
    seed: g.seed, ascension: g.ascension, worldName: g.worldName,
    names: [...(g.names || [])], starters: [...(g.starters || [])],
    rng: g.rng ? g.rng.state : 0,
    world: runState(g.world, true),
    runs: g.runs.map(r => runState(r, false)),
    votes: JSON.parse(JSON.stringify(g.votes ?? null)),
    lastVote: JSON.parse(JSON.stringify(g.lastVote ?? null)),
    down: JSON.parse(JSON.stringify(g.down ?? null)),
    away: JSON.parse(JSON.stringify(g.away ?? null)),
    result: g.result ?? null,
    // act clears (not part of the checksum): the co-op map grants each player's starter offers from them
    events: (Array.isArray(g.events) ? g.events : []).filter(e => e && e.t === 'actClear').map(e => ({ ...e })),
  };
}

function restoreRun(s, eng) {
  const o = s.o;
  eng.Run.upgradeJSON?.(o); // (saves from older code: fills in what this code added; a no-op on its own saves)
  const r = Object.assign(new eng.Run(), o);
  r.rng = new eng.RNG(1);
  r.rng.state = s.rng;
  return r;
}

// -> a CoopGame of the given engine (default: pass the current one), in phase 'map' at snap.seq.
export function restoreGame(snap0, eng) {
  if (!snap0 || snap0.format !== SNAPSHOT_FORMAT) throw new Error('Unknown checkpoint format ' + snap0?.format);
  if (snap0.phase !== 'map') throw new Error('Checkpoint is not on the map');
  const snap = JSON.parse(JSON.stringify(snap0)); // (the game must never share objects with the snapshot)
  const g = new eng.CoopGame();
  g.seq = snap.seq;
  g.phase = 'map';
  g.seed = snap.seed;
  g.ascension = snap.ascension;
  g.worldName = snap.worldName;
  g.names = [...snap.names];
  g.starters = [...snap.starters];
  g.rng = new eng.RNG(1);
  g.rng.state = snap.rng;
  g.world = restoreRun(snap.world, eng);
  g.runs = snap.runs.map(s => restoreRun(s, eng));
  const n = g.runs.length;
  const arr = (v, d) => (Array.isArray(v) && v.length === n ? v : Array.from({ length: n }, () => d));
  g.votes = arr(snap.votes, null);
  g.lastVote = snap.lastVote ?? null;
  g.down = arr(snap.down, false);
  g.away = arr(snap.away, false);
  g.result = snap.result ?? null;
  g.events = Array.isArray(snap.events) ? snap.events : [];
  g.private = null;
  g.battle = null;
  g.battleCfg = null;
  g.battleSubs = null;
  g.mirror();
  return g;
}
