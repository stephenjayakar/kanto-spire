// DEV ONLY (?coopdev on the local, offline build): a fake co-op server living in IndexedDB, with the same
// exports and return shapes as net/coopnet.js. Tabs of the same origin share it, each tab is one player
// (identity in sessionStorage; ?coopdev=Name picks the display name). Never used when Cloud.url is set.
// Every call is ONE IndexedDB transaction, serialized across tabs like a Convex mutation (the old localStorage
// store lost writes when 3-4 tabs posted at once: each tab's cached copy overwrote the others').
// Live reads work like the real ones (staging-net): every write announces its room on a BroadcastChannel, and each
// subscription re-runs its read when its room changed, handing the result on only when it differs. Nothing polls.
import { coopAscCap } from '../../game/unlocks.js';
import { COOP_WORLDS } from '../../game/regions.js';
import { NET_PROTO, fnv } from '../../game/coop/wire.js';
export { NET_PROTO };
export const KEEPALIVE_MS = 30000, KEEPALIVE_HIDDEN_MS = 60000; // (same as net/coopnet.js)
export const HEARTBEAT_MS = KEEPALIVE_MS;
const HB_LEGACY = 5000;
const DB_NAME = 'kantospire-coopdev', STORE = 'rooms';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const MAX_MEMBERS = 4; // (same as convex/coop.ts)
// (same rules as convex/coop.ts: members without maxPlayers are older 2-player clients and keep the room at 2)
const supports = (m) => Math.max(2, Math.min(MAX_MEMBERS, Math.floor(m.maxPlayers ?? 2)));
const roomCap = (members, joiner) => Math.min(MAX_MEMBERS, ...members.map(supports), ...(joiner ? [supports(joiner)] : []));
const CLIENT_MAX = MAX_MEMBERS; // what this (mock) client sends as maxPlayers

function me() {
  let id = null;
  try { id = JSON.parse(sessionStorage.getItem('coopdev.me')); } catch {}
  const want = new URLSearchParams(location.search).get('coopdev');
  if (!id) id = { email: 'tab' + Math.random().toString(36).slice(2, 8) + '@dev', name: '' };
  if (want && want !== '1') id.name = want.slice(0, 12);
  if (!id.name) id.name = 'TAB-' + id.email.slice(3, 7).toUpperCase();
  sessionStorage.setItem('coopdev.me', JSON.stringify(id));
  return id;
}
const delay = (v) => new Promise((res, rej) => setTimeout(() => (v instanceof Error ? rej(v) : res(v)), 40 + Math.random() * 60));
// ---- change announcements: this tab (bus) and the other tabs of this origin (BroadcastChannel) ----
const bus = new EventTarget();
let channel = null;
try {
  channel = new BroadcastChannel('kantospire-coopdev');
  channel.onmessage = (e) => bus.dispatchEvent(new CustomEvent('change', { detail: e.data }));
} catch {}
function announce(roomId) {
  bus.dispatchEvent(new CustomEvent('change', { detail: roomId }));
  try { channel?.postMessage(roomId); } catch {}
}
// A live read: run() now and again whenever `roomId` changes (null: any room); cb(result) only when it differs.
function live(roomId, run, cb, onError) {
  let stop = false, last, busy = false, again = false;
  const go = async () => {
    if (stop) return;
    if (busy) { again = true; return; }
    busy = true;
    try { const v = await run(); const j = JSON.stringify(v); if (!stop && j !== last) { last = j; cb?.(v); } }
    catch (e) { if (!stop) onError?.(e); }
    finally { busy = false; if (again && !stop) { again = false; go(); } }
  };
  const h = (e) => { if (roomId == null || e.detail === roomId) go(); };
  bus.addEventListener('change', h);
  go();
  return () => { stop = true; bus.removeEventListener('change', h); };
}
let dbP = null;
const idb = () => (dbP ||= new Promise((res, rej) => {
  const r = indexedDB.open(DB_NAME, 1);
  r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: '_id' });
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
}));
// One atomic step over the room records: fn(rooms, put, del) runs inside a single transaction (rooms = [that room]
// for an id, else every room); put(room) / del(room) are written when fn returns, nothing if it throws. Resolves
// (or rejects) with a clone of fn's result after a fake network delay.
async function atomic(fn, { id = null, write = true } = {}) {
  const db = await idb();
  const out = await new Promise((res, rej) => {
    const t = db.transaction(STORE, write ? 'readwrite' : 'readonly'), st = t.objectStore(STORE);
    let val, err = null;
    const q = id !== null ? st.get(id) : st.getAll();
    q.onsuccess = () => {
      const rooms = id !== null ? (q.result ? [q.result] : []) : q.result;
      const puts = new Set(), dels = new Set();
      try { val = structuredClone(fn(rooms, (r) => puts.add(r), (r) => dels.add(r))); } catch (e) { err = e; return; }
      for (const r of puts) if (!dels.has(r)) st.put(r);
      for (const r of dels) st.delete(r._id);
      for (const r of [...puts, ...dels]) changed.add(r._id);
    };
    const changed = new Set();
    t.oncomplete = () => { if (!err) for (const id of changed) announce(id); return err ? rej(err) : res(val); };
    t.onabort = t.onerror = () => rej(err || t.error);
  }).catch(e => (e instanceof Error ? e : new Error(String(e))));
  return delay(out);
}

function withRoom(roomId, fn, { write = false } = {}) {
  const self = me();
  return atomic(([room], put) => {
    const mine = room?.members.find(m => m.email === self.email);
    if (!room || !mine || room.status === 'deleted') throw new Error('Room not found');
    const out = fn(room, mine, self);
    if (write) { room.updatedAt = Date.now(); put(room); }
    return out;
  }, { id: roomId, write });
}
// (same shapes as convex/coop.ts: memberCore / roomCore for coop:watch, plus presence and nextSeq for the older views)
const memberCore = (m) => ({ slot: m.slot, name: m.name, starter: m.starter ?? null, ascMax: m.ascMax ?? null, sketchV: m.sketchV ?? 0, ready: m.ready, left: !!m.left, saved: !!m.left && !!m.savedAt, maxPlayers: supports(m), net: m.net ?? 0 });
function seenOf(m, now) {
  const p = m.pres;
  if (!p) return { lastSeen: m.lastSeen, lastSeq: m.lastSeq };
  const shift = p.hb && p.hb > HB_LEGACY ? p.hb - HB_LEGACY : 0;
  return { lastSeen: Math.max(m.lastSeen, Math.min(now, p.lastSeen + shift)), lastSeq: p.lastSeq };
}
function roomCore(room) {
  const host = room.members.find(m => m.email === room.host);
  return { _id: room._id, code: room.code, status: room.status, host: host ? host.slot : 0, ascension: room.ascension, world: room.world, seed: room.seed, createdAt: room.createdAt, gameVersion: room.gameVersion ?? null, progress: room.progress ?? null, maxPlayers: roomCap(room.members) };
}
function view(room, mine) {
  const now = Date.now();
  const members = [...room.members].sort((a, b) => a.slot - b.slot).map(m => ({ ...memberCore(m), ...seenOf(m, now) }));
  return {
    room: { ...roomCore(room), nextSeq: room.nextSeq, updatedAt: room.updatedAt },
    members, me: mine.slot, isHost: mine.email === room.host,
  };
}
const lobbyHost = (room, mine) => {
  if (room.host !== mine.email) throw new Error('Only the host can do that.');
  if (room.status !== 'lobby') throw new Error('The run has already started.');
};

export function randomNonce() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }
export const isNetworkError = () => false;

export function createRoom(opts = {}) {
  const self = me();
  return atomic((rooms, put) => {
    const now = Date.now();
    let code;
    do { code = Array.from({ length: 5 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join(''); } while (rooms.some(r => r.code === code && r.status !== 'closed'));
    const _id = 'dev_' + randomNonce();
    put({
      _id, code, status: 'lobby', host: self.email, ascension: opts.ascension ?? 0, world: opts.world ?? 'kanto',
      seed: String(Math.floor(Math.random() * 2 ** 31)), nextSeq: 1, createdAt: now, updatedAt: now, actions: [], checkpoints: [],
      members: [{ email: self.email, name: self.name, slot: 0, ready: false, starter: null, lastSeen: now, lastSeq: 0, joinedAt: now, maxPlayers: opts.maxPlayers ?? CLIENT_MAX }],
    });
    return { roomId: _id, code };
  });
}
export function joinRoom(code, maxPlayers = CLIENT_MAX) {
  const self = me();
  code = String(code || '').trim().toUpperCase();
  return atomic((rooms, put) => {
    const now = Date.now();
    const room = rooms.find(r => r.code === code && r.status !== 'closed' && r.status !== 'deleted');
    if (!room) throw new Error('Room not found');
    const mine = room.members.find(m => m.email === self.email);
    if (mine) { // (rejoining by code undoes a delete from the REJOIN list, as on the server)
      if (mine.dismissed || mine.left) { mine.dismissed = false; mine.left = false; mine.savedAt = null; mine.lastSeen = now; put(room); }
      return { roomId: room._id, slot: mine.slot, code: room.code, status: room.status };
    }
    if (room.status !== 'lobby') throw new Error('Room not found');
    if (room.members.length >= roomCap(room.members, { maxPlayers })) throw new Error('That room is full.');
    let slot = 0;
    while (room.members.some(m => m.slot === slot)) slot++;
    room.members.push({ email: self.email, name: self.name, slot, ready: false, starter: null, lastSeen: now, lastSeq: 0, joinedAt: now, maxPlayers });
    room.updatedAt = now;
    put(room);
    return { roomId: room._id, slot, code: room.code, status: room.status };
  });
}
export const getRoom = (roomId) => withRoom(roomId, (room, mine) => ({ ...view(room, mine), now: Date.now() }));
// (same rules as convex/coop.ts: the room's ascension is capped by the highest of the members' ascMax)
export const setStarter = (roomId, starter, ascMax) => withRoom(roomId, (room, mine) => {
  if (room.status !== 'lobby') throw new Error('The run has already started.');
  mine.starter = starter; mine.lastSeen = Date.now();
  if (ascMax !== undefined) mine.ascMax = Math.max(0, Math.min(10, ascMax | 0));
  room.ascension = Math.min(room.ascension, coopAscCap(room.members));
  return null;
}, { write: true });
// map sketches (same rules as convex/coop.ts setSketch / sketches)
export const setSketch = (roomId, sketch, all = false) => withRoom(roomId, (room, mine) => {
  mine.sketch = sketch; mine.sketchV = (mine.sketchV ?? 0) + 1;
  if (all) for (const m of room.members) if (m !== mine) { m.sketch = ''; m.sketchV = (m.sketchV ?? 0) + 1; }
  return { v: mine.sketchV };
}, { write: true });
export const getSketches = (roomId, only) => withRoom(roomId, (room) => room.members.filter(m => !Array.isArray(only) || only.includes(m.slot)).map(m => ({ slot: m.slot, sketch: m.sketch || null, sketchV: m.sketchV ?? 0 })));
export const setReady = (roomId, ready) => withRoom(roomId, (room, mine) => { if (room.status !== 'lobby') throw new Error('The run has already started.'); mine.ready = !!ready; mine.lastSeen = Date.now(); return null; }, { write: true });
export const configure = (roomId, opts = {}) => withRoom(roomId, (room, mine) => {
  lobbyHost(room, mine);
  if (opts.ascension !== undefined) room.ascension = Math.min(Math.max(0, Math.min(10, opts.ascension | 0)), coopAscCap(room.members));
  if (opts.world !== undefined) room.world = COOP_WORLDS.includes(opts.world) ? opts.world : 'spire';
  return { ascension: room.ascension, world: room.world };
}, { write: true });
export const startRoom = (roomId) => withRoom(roomId, (room, mine) => {
  lobbyHost(room, mine);
  const ms = [...room.members].sort((a, b) => a.slot - b.slot);
  if (ms.length < 2) throw new Error('Waiting for a second player.');
  if (ms.some(m => !m.starter)) throw new Error('Every player needs a starter.');
  if (ms.length > roomCap(ms)) throw new Error('Every player needs the latest version for 3-4 players: reload the page.');
  if (room.ascension > coopAscCap(ms)) throw new Error("No player has that ascension unlocked for their starter.");
  // slots are renumbered 0..n-1 in seat order (a lobby leaver can leave a gap); the init lists them in that order
  ms.forEach((m, i) => { m.slot = i; });
  room.actions.push({ seq: 1, p: 0, json: JSON.stringify({ type: 'init', seed: room.seed, ascension: room.ascension, world: room.world, starters: ms.map(m => m.starter), names: ms.map(m => m.name), nonce: 'init' }) });
  room.status = 'playing'; room.nextSeq = 2;
  return { seq: 1 };
}, { write: true });
export const leaveRoom = (roomId) => withRoom(roomId, (room, mine) => {
  if (room.status === 'lobby') {
    room.members = room.members.filter(m => m !== mine);
    if (room.host === mine.email) room.status = 'closed';
  } else if (room.status === 'playing') { mine.left = true; mine.savedAt = null; }
  return { closed: room.status === 'closed' };
}, { write: true });
// (same rules as convex/coop.ts dismiss)
export const dismissRoom = (roomId) => withRoom(roomId, (room, mine) => {
  if (room.status === 'lobby') {
    room.members = room.members.filter(m => m !== mine);
    if (room.host === mine.email) room.status = 'closed';
  } else { mine.dismissed = true; mine.left = true; mine.savedAt = null; }
  if (room.members.every(m => m.dismissed)) { room.status = 'deleted'; return { deleted: true }; }
  return { deleted: false };
}, { write: true });
export function myRooms() {
  const self = me(), cutoff = Date.now() - 864e5;
  return atomic((rooms, put, del) => {
    for (const r of rooms) if (r.status === 'deleted') del(r);
    const out = rooms.filter(r => r.status !== 'closed' && r.status !== 'deleted' && r.updatedAt > cutoff && r.members.some(m => m.email === self.email && !m.dismissed)).map(r => ({
      roomId: r._id, code: r.code, status: r.status, ascension: r.ascension, world: r.world, slot: r.members.find(m => m.email === self.email).slot,
      isHost: r.host === self.email, nextSeq: r.nextSeq, createdAt: r.createdAt, updatedAt: r.updatedAt, progress: r.progress ?? null,
      members: r.members.map(m => ({ slot: m.slot, name: m.name, starter: m.starter ?? null, left: !!m.left, saved: !!m.left && !!m.savedAt })),
    }));
    return out.sort((a, b) => b.updatedAt - a.updatedAt);
  });
}
// (same as convex/coop.ts heartbeat: presence apart from the member, net / hb from this client, everyone's presence back)
export const heartbeat = (roomId, seq, { hb = HEARTBEAT_MS } = {}) => withRoom(roomId, (room, mine) => {
  const now = Date.now();
  mine.pres = { lastSeen: now, lastSeq: seq != null ? seq : (mine.pres?.lastSeq ?? mine.lastSeq), hb };
  if (mine.left && room.status === 'playing') { mine.left = false; mine.savedAt = null; }
  mine.net = NET_PROTO;
  return { now, presence: room.members.filter(m => m.pres).map(m => ({ slot: m.slot, lastSeen: m.pres.lastSeen, lastSeq: m.pres.lastSeq, hb: m.pres.hb ?? HB_LEGACY })) };
}, { write: true });
// (same as convex/coop.ts alive: my presence row only; gone = I'm leaving)
export const alive = (roomId, { hb = KEEPALIVE_MS, gone = false } = {}) => withRoom(roomId, (room, mine) => {
  const now = Date.now();
  mine.pres = { lastSeen: now, lastSeq: mine.pres?.lastSeq ?? mine.lastSeq, hb: gone ? undefined : hb, gone: gone || undefined };
  if (!gone && mine.left && room.status === 'playing') { mine.left = false; mine.savedAt = null; }
  mine.net = NET_PROTO;
  return { now };
}, { write: true });
export const goodbye = (roomId) => alive(roomId, { gone: true }).catch(() => {});
// The mock is always "connected".
export const onConnection = (cb) => { try { cb({ isWebSocketConnected: true, hasEverConnected: true }); } catch {} return () => {}; };

// ---- live reads (same shapes as convex/coop.ts head / feed / presence / sketch / mineLive) ----
const headOf = (room, mine) => {
  const ms = [...room.members].sort((a, b) => a.slot - b.slot);
  return { room: roomCore(room), members: ms.map(m => { const { sketchV: _v, ...rest } = memberCore(m); return rest; }), me: mine.slot, isHost: mine.email === room.host };
};
export const watchRoom = (roomId, cb, onError) => live(roomId, () => withRoom(roomId, (room, mine) => headOf(room, mine)), cb, onError);
const presenceOf = (room) => [...room.members].filter(m => m.pres).sort((a, b) => a.slot - b.slot).map(m => ({ slot: m.slot, lastSeen: m.pres.lastSeen, hb: m.pres.hb ?? HB_LEGACY, ...(m.pres.gone ? { gone: true } : {}) }));
export const watchPresence = (roomId, cb, onError) => live(roomId, () => withRoom(roomId, (room) => presenceOf(room)), cb, onError);
const sketchOf = (room, slot, wiped) => {
  const m = room.members.find(x => x.slot === slot);
  return wiped ? { slot, wiped: m?.sketch === '' } : { slot, sketch: m?.sketch || null };
};
export const getSketch = (roomId, slot) => withRoom(roomId, (room) => sketchOf(room, slot, false));
export const watchSketch = (roomId, slot, cb, { wiped = false } = {}, onError) => live(roomId, () => withRoom(roomId, (room) => sketchOf(room, slot, wiped)), cb, onError);
export const watchMyRooms = (cb, onError) => live(null, () => myRooms().then(list => list.map(({ nextSeq: _n, updatedAt: _u, createdAt: _c, ...r }) => r)), cb, onError);
const feedOf = (room, after) => {
  const actions = room.actions.filter(a => a.seq > after).slice(0, 200).map(a => ({ seq: a.seq, p: a.p, json: a.json }));
  const last = actions.length ? actions[actions.length - 1].seq : after;
  return { actions, more: last < room.nextSeq - 1 };
};
export const fetchFeed = (roomId, after = 0) => withRoom(roomId, (room) => {
  const r = feedOf(room, after);
  return { actions: r.actions.map(a => ({ ...JSON.parse(a.json), seq: a.seq, p: a.p })), more: r.more };
});
const watchFeed = (roomId, after, cb, onError) => live(roomId, () => withRoom(roomId, (room) => feedOf(room, after)), cb, onError);

export const postAction = (roomId, action) => withRoom(roomId, (room, mine) => {
  if (room.status !== 'playing') throw new Error('The run is not in progress.');
  const { seq: _s, p: _p, ...rest } = action || {};
  const nonce = rest.nonce || randomNonce();
  const dup = room.actions.find(a => (a.nonce ?? JSON.parse(a.json).nonce) === nonce);
  if (dup) return { seq: dup.seq, nonce, duplicate: true };
  const seq = room.nextSeq++;
  room.actions.push({ seq, p: mine.slot, nonce, json: JSON.stringify({ ...rest, nonce }) });
  if (mine.left) { mine.left = false; mine.savedAt = null; }
  return { seq, nonce, duplicate: false };
}, { write: true });
export const fetchSince = (roomId, after = 0) => withRoom(roomId, (room, mine) => {
  const actions = room.actions.filter(a => a.seq > after).slice(0, 200).map(a => ({ ...JSON.parse(a.json), seq: a.seq, p: a.p }));
  const last = actions.length ? actions[actions.length - 1].seq : after;
  return { actions, more: last < room.nextSeq - 1, status: room.status, ...view(room, mine), now: Date.now() };
});

// checkpoints + SAVE & QUIT (same rules as convex/coop.ts checkpoint / latestCheckpoint / saveQuit)
// (state may be left out: a confirmation by checksum; need = the server has no state for that seq yet)
export const writeCheckpoint = (roomId, cp) => withRoom(roomId, (room, mine) => {
  if (room.status !== 'playing') throw new Error('The run is not in progress.');
  if (!Number.isInteger(cp.seq) || cp.seq < 1 || cp.seq > room.nextSeq - 1) throw new Error('Bad checkpoint seq.');
  if (cp.phase !== 'map') throw new Error('Checkpoints are only taken on the map.');
  room.checkpoints ||= [];
  const same = room.checkpoints.find(c => c.seq === cp.seq);
  let disputed = false, have = cp.state !== undefined;
  if (same) {
    if (same.checksum !== cp.checksum) { disputed = true; same.disputed = true; }
    else {
      if (!same.slots.includes(mine.slot)) same.slots.push(mine.slot);
      if (same.state) have = true; else if (cp.state !== undefined) same.state = cp.state;
    }
  } else {
    room.checkpoints.push({ seq: cp.seq, phase: cp.phase, state: cp.state ?? '', checksum: cp.checksum, gameVersion: cp.gameVersion ?? null, engine: cp.engine ?? null, reason: cp.reason ?? null, slots: [mine.slot], createdAt: Date.now() });
    room.checkpoints.sort((a, b) => b.seq - a.seq);
    room.checkpoints = room.checkpoints.slice(0, 8);
  }
  if (!disputed && cp.progress) room.progress = String(cp.progress).slice(0, 32);
  room.cpWrites = (room.cpWrites || 0) + (cp.state !== undefined ? 1 : 0); // (tests: how many uploads)
  return { seq: cp.seq, disputed, duplicate: !!same, need: !disputed && !have };
}, { write: true });
export const confirmCheckpoint = (roomId, cp) => { const { state: _s, ...rest } = cp; return writeCheckpoint(roomId, rest); };
export const latestCheckpoint = (roomId) => withRoom(roomId, (room) => (room.checkpoints || []).find(c => !c.disputed && c.state) || null);
export const saveQuit = (roomId) => withRoom(roomId, (room, mine) => {
  if (room.status === 'playing') { mine.left = true; mine.savedAt = Date.now(); mine.lastSeen = mine.savedAt; }
  return { saved: room.status === 'playing' };
}, { write: true });

// v0.3.12 (same rules as convex/coop.ts finish): the run is over: the first call keeps the team run and closes the room
// (it leaves the REJOIN list); later calls change nothing.
export const finishRoom = (roomId, run) => withRoom(roomId, (room) => {
  if (room.status === 'lobby' || (room.status === 'closed' && !room.result)) throw new Error('The run is not in progress.');
  if (room.record) return { score: room.record.score ?? 0, duplicate: true };
  room.record = { ...run, clientRunId: `coop-${room.code}`, coop: { room: room.code, with: [...room.members].sort((a, b) => a.slot - b.slot).slice(1).map(m => m.name) } };
  room.status = 'closed'; room.result = run.result;
  return { score: 0, duplicate: false };
}, { write: true });

// Same interface as coopnet's CoopFeed: head / presence / feed subscriptions, the feed subscribing again from its newest
// seq after every delivery.
export class CoopFeed {
  constructor(roomId, { after = 0, onActions, onHead, onPresence, onCaughtUp, onError } = {}) {
    Object.assign(this, { roomId, after: Math.max(0, after | 0), onActions, onHead, onPresence, onCaughtUp, onError, running: false, subs: {}, _gen: 0, _chain: Promise.resolve() });
  }
  start() {
    if (this.running) return this;
    this.running = true;
    this.subs.head = watchRoom(this.roomId, v => this._safe(this.onHead, v), e => this._safe(this.onError, e));
    this.subs.presence = watchPresence(this.roomId, l => this._safe(this.onPresence, l), e => this._safe(this.onError, e));
    this._feed();
    return this;
  }
  stop() { this.running = false; this._gen++; for (const k of Object.keys(this.subs)) { try { this.subs[k]?.(); } catch {} } this.subs = {}; return this; }
  setAfter(seq) { this.after = Math.max(0, seq | 0); if (this.running) this._feed(); return this; }
  _feed() {
    const gen = ++this._gen, old = this.subs.feed;
    this.subs.feed = watchFeed(this.roomId, this.after, r => { if (gen === this._gen) this._deliver(r, gen); }, e => { if (gen === this._gen) this._safe(this.onError, e); });
    try { old?.(); } catch {}
  }
  _deliver(r, gen) {
    this._chain = this._chain.then(async () => {
      if (!this.running || gen !== this._gen) return;
      const fresh = r.actions.map(a => ({ ...JSON.parse(a.json), seq: a.seq, p: a.p })).filter(a => a.seq > this.after);
      if (fresh.length) { this.after = fresh[fresh.length - 1].seq; await this._safe(this.onActions, fresh); }
      if (!this.running || gen !== this._gen) return;
      if (fresh.length || r.more) this._feed(); else await this._safe(this.onCaughtUp);
    }).catch(e => console.warn('mock CoopFeed', e));
  }
  async _safe(fn, ...a) { if (!fn) return; try { await fn(...a); } catch (e) { if (fn !== this.onError) { try { this.onError?.(e); } catch {} } else console.warn(e); } }
}
