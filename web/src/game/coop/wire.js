// Co-op wire format: how a big action travels, without changing what the game applies.
//
// "privateDone" carries the player's whole run after a private screen (rewards, shop, event...): 8-25 KB, and every
// client downloads it. The run before that screen is already in every client's game (game.runs[p] doesn't change
// during the private phase), so a newer client can send only the difference:
//   { type: 'privateDone', runD: <delta from base to the run>, rb: <hash of base>, rt: <hash of the run>, st }
// expandAction() turns it back into { type: 'privateDone', run } right before the game applies it, from the game
// it is applied to, so the game sees exactly the object a full privateDone would carry (not a logic change: the
// game code and the action it applies are the same; no LOGIC_ID bump). If the base or the result doesn't match
// its hash, run is null: the game refuses the action on every client alike (it's deterministic), and the sender
// posts the full run again (CoopSession).
//
// Only sent when every member's client speaks NET_PROTO (their heartbeat says so, see convex/coop.ts heartbeat):
// an older client can't expand it. Logs with full privateDone actions replay as before.
export const NET_PROTO = 2;

// The run as privateDone carries it (CoopGame.snapshotRun): plain JSON without the shared map.
export function baseRun(run) {
  const o = JSON.parse(JSON.stringify(run));
  delete o.map;
  delete o.inNode;
  return o;
}
// The same with stats.startTime zeroed (in place, so key order stays): it's the one field of a run the game's
// checksum leaves out (each client's init stamps its own clock), so every client agrees on the rest exactly.
// The sender's startTime travels on its own (st).
function norm(o) {
  if (o?.stats && typeof o.stats === 'object' && 'startTime' in o.stats) o.stats.startTime = 0;
  return o;
}

export function fnv(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const same = (a, b) => a === b || (typeof a === 'object' && typeof b === 'object' && a !== null && b !== null && JSON.stringify(a) === JSON.stringify(b));
const size = (v) => JSON.stringify(v).length;

// A delta node: ['=', value] replaces; for an object base { s: {key: value}, o: {key: node}, x: [deleted keys],
// k: [key order, when it isn't base order + new keys] }; for an array base { A: length, e: {index: node} }.
// diff(a, b) -> node, or undefined when a and b are equal (both plain JSON).
export function diff(a, b) {
  if (same(a, b)) return undefined;
  let d;
  if (isObj(a) && isObj(b)) {
    d = {};
    const s = {}, o = {}, x = [];
    for (const k of Object.keys(a)) if (!(k in b)) x.push(k);
    for (const k of Object.keys(b)) {
      if (!(k in a)) { s[k] = b[k]; continue; }
      const n = diff(a[k], b[k]);
      if (n === undefined) continue;
      if (Array.isArray(n)) s[k] = n[1]; else o[k] = n;
    }
    if (Object.keys(s).length) d.s = s;
    if (Object.keys(o).length) d.o = o;
    if (x.length) d.x = x;
    const order = Object.keys(a).filter(k => k in b).concat(Object.keys(b).filter(k => !(k in a)));
    const want = Object.keys(b);
    if (order.join('\u0000') !== want.join('\u0000')) d.k = want;
  } else if (Array.isArray(a) && Array.isArray(b)) {
    const e = {};
    for (let i = 0; i < b.length; i++) {
      const n = i < a.length ? diff(a[i], b[i]) : ['=', b[i]];
      if (n !== undefined) e[i] = n;
    }
    d = { A: b.length, e };
  }
  const full = ['=', b];
  return d && size(d) < size(full) ? d : full;
}

// patch(a, node) -> a new value (a is not modified).
export function patch(a, n) {
  if (n === undefined) return clone(a);
  if (Array.isArray(n)) return clone(n[1]);
  if (Array.isArray(a)) {
    const out = [];
    for (let i = 0; i < n.A; i++) out.push(n.e && i in n.e ? patch(a[i], n.e[i]) : clone(a[i]));
    return out;
  }
  if (!isObj(a)) throw new Error('bad delta');
  const s = n.s || {}, o = n.o || {}, x = new Set(n.x || []);
  const order = n.k || Object.keys(a).filter(k => !x.has(k)).concat(Object.keys(s).filter(k => !(k in a)));
  const out = {};
  for (const k of order) out[k] = k in s ? clone(s[k]) : k in o ? patch(a[k], o[k]) : clone(a[k]);
  return out;
}
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

function rebuild(base, enc) {
  const out = patch(base, enc.runD);
  if (enc.st !== undefined && out?.stats && typeof out.stats === 'object' && 'startTime' in out.stats) out.stats.startTime = enc.st;
  return out;
}

// The compact privateDone payload for player p's run (snapshotRun output), or null when the full run is as small
// or the delta doesn't reproduce it exactly.
export function encodePrivateDone(game, p, run) {
  try {
    const cur = game?.runs?.[p];
    if (!cur || !run) return null;
    const base = norm(baseRun(cur)), target = JSON.parse(JSON.stringify(run));
    const want = JSON.stringify(target);
    const st = target.stats?.startTime;
    const runD = diff(base, norm(JSON.parse(want))) ?? {}; // (unchanged: an empty delta)
    if (Array.isArray(runD)) return null; // (replaced outright: not a delta)
    const enc = { runD, rb: fnv(JSON.stringify(base)), rt: fnv(want), ...(st !== undefined ? { st } : {}) };
    if (JSON.stringify(rebuild(base, enc)) !== want) return null;
    if (size(enc) + 20 >= want.length) return null;
    return enc;
  } catch { return null; }
}

// The action as the game should apply it: a compact privateDone gets its run back (or run: null if it can't be
// rebuilt here), anything else is returned as it is. Never throws.
export function expandAction(game, a) {
  if (!a || a.type !== 'privateDone' || a.run !== undefined || a.runD === undefined) return a;
  let run = null;
  try {
    const cur = game?.runs?.[a.p];
    if (cur) {
      const base = norm(baseRun(cur));
      if (fnv(JSON.stringify(base)) === a.rb) {
        const out = rebuild(base, a);
        if (fnv(JSON.stringify(out)) === a.rt) run = out;
      }
    }
  } catch { run = null; }
  return { ...a, run };
}
