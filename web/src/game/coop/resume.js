// Resuming a co-op room (REJOIN, reload, RESYNC): rebuild the game from the latest checkpoint plus the actions after
// it, on whatever logic played them, and land on the current code. Pure (no network): the session fetches the
// checkpoint and the log and calls resumeRoom(); tests call it directly.
//
// Every posted action carries the sender's checksum of the game at the seq it saw (ck, atSeq). A replay that
// reproduces the logged checksums is the game the players had. So:
//   1. base = the checkpoint (or nothing: replay from the init action);
//   2. replay the tail on the engine that played it (its LOGIC_ID stamp; unstamped = before v0.3.6), else on the
//      current code, else on every other frozen engine;
//   3. the first engine that agrees wins. On the current code the game continues exactly where it was (even
//      mid-battle). On a frozen engine the game is handed to the current code at its latest safe point (the map,
//      between nodes): the actions after it are dropped, so at worst that node restarts. A finished game (lost /
//      won) stays finished;
//   4. if no engine agrees, the latest safe point that was verified (on any engine) is used, else the checkpoint
//      itself: never further back than the start of the current node.
// "Agrees": no logged checksum disagrees, or the disagreements come from a drifted client (a desync on the same
// code): after the first disagreement, at least one player's checksums still all agree. A logic change makes every
// player's checksums disagree from that point on.
// Whenever the result isn't the plain replay of the log, the game is placed at the log's last seq and returned
// as `safe`, for the session to store as the new checkpoint, so every client continues from the same state.
import { LOGIC_ID, UNSTAMPED, CURRENT, getEngine, engineOrder } from './engines.js';
import { isSafePoint, snapshotGame, restoreGame } from './snapshot.js';
import { expandAction } from './wire.js'; // (compact privateDone actions get their run back from the game they're applied to)

const CK_KEEP = 300; // checksums kept for the session's desync check (the last seqs of the log)
const clone = (a) => JSON.parse(JSON.stringify(a));
const FINISHED = new Set(['over', 'victory']);

// Replays `actions` (sorted, seq > base.seq) on one engine from base ({ seq, snap }) or from scratch.
// -> { engine, current, ok, drifted, bad, checks, lastVerified, safe: { seq, snap } | null, game, cks: Map, error }
export function replayOn(eng, base, actions, { keepCks = CK_KEEP } = {}) {
  const res = { engine: eng.id, current: !!eng.current, ok: true, drifted: false, bad: null, checks: 0, lastVerified: base ? base.seq : 0, safe: null, game: null, cks: new Map(), error: null };
  const need = new Set(actions.filter(a => a.atSeq != null).map(a => a.atSeq));
  const lastSeq = actions.length ? actions[actions.length - 1].seq : base ? base.seq : 0;
  const cks = new Map();
  let g;
  try {
    if (base) { g = restoreGame(base.snap, eng); cks.set(base.seq, g.checksum() >>> 0); res.safe = { seq: base.seq, snap: base.snap, base: true }; }
    else g = new eng.CoopGame();
  } catch (e) { res.ok = false; res.error = String(e?.message || e); return res; }
  // safe points not verified yet (after lastVerified): the newest is promoted once a later checksum agrees
  let pending = [], newest = null;
  const promote = () => {
    let i = -1;
    for (let k = 0; k < pending.length; k++) if (pending[k].seq <= res.lastVerified) i = k;
    if (i >= 0) { res.safe = pending[i]; pending = pending.slice(i + 1); }
  };
  const after = new Map(); // after the first disagreement: sender -> { good, bad }
  const tally = (p, good) => { const s = after.get(p) || { good: 0, bad: 0 }; s[good ? 'good' : 'bad']++; after.set(p, s); };
  for (const a0 of actions) {
    const a = clone(a0);
    if (a.ck != null && a.atSeq != null && cks.has(a.atSeq)) {
      res.checks++;
      const good = cks.get(a.atSeq) === (a.ck >>> 0);
      if (res.bad) tally(a.p, good);
      else if (!good) { res.bad = { seq: a.seq, atSeq: a.atSeq, type: a.type, p: a.p }; tally(a.p, false); }
      else if (a.atSeq > res.lastVerified) { res.lastVerified = a.atSeq; promote(); }
    }
    try { g.apply(expandAction(g, a)); } catch (e) { res.ok = false; res.error = String(e?.message || e); break; } // (apply never throws by contract)
    if (need.has(a.seq) || lastSeq - a.seq < keepCks) cks.set(a.seq, g.checksum() >>> 0);
    if (isSafePoint(g)) {
      newest = { seq: g.seq, snap: snapshotGame(g) };
      if (!res.bad) {
        // (a run of map actions: only the newest unverified one can matter, plus any already covered)
        pending = pending.filter(x => x.seq <= res.lastVerified);
        pending.push(newest);
        promote();
      }
    }
  }
  if (res.bad && !res.error) {
    res.drifted = [...after.values()].some(s => s.good > 0 && s.bad === 0);
    res.ok = res.drifted;
  }
  if (res.ok && newest) res.safe = newest; // the log agreed: its newest safe point
  res.game = g;
  for (const [k, v] of cks) if (lastSeq - k < keepCks) res.cks.set(k, v);
  return res;
}

// The engine stamp of a log segment: the LOGIC_ID most of its player actions carry, UNSTAMPED when none has one.
export function segmentStamp(actions) {
  const n = new Map();
  for (const a of actions) if (a && a.p >= 0 && typeof a.eng === 'string') n.set(a.eng, (n.get(a.eng) || 0) + 1);
  if (!n.size) return UNSTAMPED;
  return [...n.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

export function parseCheckpoint(cp) {
  if (!cp || cp.state == null || !Number.isInteger(cp.seq)) return null;
  try {
    const snap = typeof cp.state === 'string' ? JSON.parse(cp.state) : cp.state;
    if (!snap || snap.phase !== 'map' || snap.seq !== cp.seq) return null;
    return { seq: cp.seq, snap, checksum: cp.checksum ?? null, engine: cp.engine ?? null, gameVersion: cp.gameVersion ?? null };
  } catch { return null; }
}

// checkpoint: the server's latest checkpoint row ({ seq, state (JSON string), checksum, engine, gameVersion }) or
// null. actions: the room's actions after it ({ seq, p, type, ...payload, ck, atSeq, eng }), in order.
// -> { game, seq, mode, engine, stamp, dropped, safe, verified, cks, tried, base }
//   mode: 'empty' (no init yet) | 'replay' (whole log on the current code) | 'checkpoint' (checkpoint + tail on
//   the current code) | 'legacy' (a frozen engine agreed: handed over at its latest safe point; or a finished game
//   left on that engine) | 'fallback' (no engine agreed: the latest verified safe point, at worst the checkpoint) |
//   'unverified' (nothing could be verified at all: the current code's replay, as before v0.3.6; verified false,
//   so nobody stores it as a checkpoint)
//   safe: { seq, snap, checksum } to store as a checkpoint (newer than the one we started from), or null.
export async function resumeRoom({ checkpoint = null, actions = [], dataLoader = null, logicId = LOGIC_ID } = {}) {
  const base = parseCheckpoint(checkpoint);
  if (checkpoint && !base) throw new Error('Unusable checkpoint at #' + checkpoint?.seq); // (the caller replays the whole log instead)
  const from = base ? base.seq : 0;
  const tail = actions.filter(a => a && a.seq > from).sort((a, b) => a.seq - b.seq);
  const T = tail.length ? tail[tail.length - 1].seq : from;
  const out = { game: null, seq: T, mode: 'empty', engine: null, stamp: null, dropped: 0, safe: null, verified: true, cks: new Map(), tried: [], base: base ? base.seq : null };
  if (!base && !tail.length) return out;
  const cur = await getEngine({ id: logicId, current: true }, dataLoader);
  if (base && !tail.length) {
    out.game = restoreGame(base.snap, cur);
    out.mode = 'checkpoint'; out.engine = logicId;
    out.cks.set(T, out.game.checksum() >>> 0);
    return out;
  }
  const stamp = out.stamp = segmentStamp(tail);
  const results = [];
  for (const which of engineOrder(stamp, logicId)) {
    const id = which.current ? 'current' : which.id;
    let eng = null;
    try { eng = await getEngine(which, dataLoader); } catch (e) { out.tried.push({ engine: id, error: String(e?.message || e) }); continue; }
    if (!eng) continue;
    const r = replayOn(eng, base, tail);
    results.push(r);
    out.tried.push({ engine: id, ok: r.ok, drifted: r.drifted, bad: r.bad, checks: r.checks, safe: r.safe?.seq ?? null, error: r.error });
    if (r.ok) break;
  }
  let chosen = results.find(r => r.ok) || null;
  if (!chosen) for (const r of results) if (r.safe && (!chosen || r.safe.seq > chosen.safe.seq)) chosen = r;
  if (chosen && chosen.ok && (chosen.current || FINISHED.has(chosen.game.phase))) {
    // the plain replay (or a finished game, which stays finished: no hand-over that would bring it back to life)
    out.game = chosen.game; out.engine = chosen.current ? logicId : chosen.engine; out.cks = chosen.cks;
    out.mode = !chosen.current ? 'legacy' : base ? 'checkpoint' : 'replay';
    if (chosen.current && chosen.safe && !chosen.safe.base && chosen.safe.seq > from) out.safe = { ...chosen.safe };
    return withChecksum(out);
  }
  if (!chosen || !chosen.safe) {
    // nothing verified anywhere (e.g. a log from logic we have no copy of): the current code's best effort
    const r = replayOn(cur, base, tail);
    out.game = r.game; out.mode = 'unverified'; out.engine = cur.id; out.cks = r.cks; out.verified = false;
    return out;
  }
  // Hand over to the current code at the chosen safe point, placed at the end of the log.
  const g = restoreGame(chosen.safe.snap, cur);
  g.seq = T;
  out.game = g;
  out.mode = chosen.ok ? 'legacy' : 'fallback';
  out.engine = chosen.current ? logicId : chosen.engine;
  out.dropped = T - chosen.safe.seq;
  out.cks.set(T, g.checksum() >>> 0);
  out.safe = { seq: T, snap: snapshotGame(g) };
  return withChecksum(out);
}

function withChecksum(out) {
  if (out.safe) {
    const g = out.safe.seq === out.seq && out.game && isSafePoint(out.game) ? out.game : null;
    out.safe.checksum = g ? g.checksum() >>> 0 : checksumOf(out.safe.snap);
  }
  return out;
}
// (the checksum a snapshot restores to on the current code)
export function checksumOf(snap) { return restoreGame(snap, CURRENT).checksum() >>> 0; }
