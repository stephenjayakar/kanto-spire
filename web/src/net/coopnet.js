// Browser client for the co-op API (convex/coop.ts), over cloud.js's authenticated HTTP call, plus live updates over
// Convex's WebSocket client (web/src/vendor/convex-browser.js, loaded only in co-op).
// Actions go up and come down as JSON strings (no Convex value limits for big Run snapshots); this module
// hides that: fetchSince / CoopPoller hand out plain action objects { seq, p, type, ...payload, nonce }.
//
// Network cost: CoopPoller subscribes to coop:watch, which the server re-runs (and sends) only when the room, its
// members or its log change, with the room view only when it changed: an idle room costs nothing. Without the
// WebSocket (blocked, or an older server without coop:watch) it polls, as often as the session asks (fast while we
// wait on partners, slow otherwise, very slow in a hidden tab). Heartbeats carry presence (coop:heartbeat returns
// everyone's), every HEARTBEAT_MS.
import { cloudCall, queueCoopRun, Cloud, authToken } from './cloud.js';
import { VERSION } from '../game/version.js';
import { LOGIC_ID } from '../game/coop/engines.js';
import { NET_PROTO } from '../game/coop/wire.js';

export { NET_PROTO };
export const HEARTBEAT_MS = 15000;

const q = (path, args) => cloudCall('query', path, args);
const m = (path, args) => cloudCall('mutation', path, args);

export function randomNonce() {
  const c = globalThis.crypto;
  if (c?.getRandomValues) {
    const b = c.getRandomValues(new Uint8Array(12));
    return Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// Network trouble (worth retrying with the same nonce), as opposed to the server refusing the call.
export function isNetworkError(e) {
  if (!e) return false;
  if (e instanceof TypeError) return true; // fetch() rejects with TypeError when offline / connection reset
  // OptimisticConcurrencyControlFailure: the room was too busy for the server's own retries; safe to retry too
  return /^HTTP (5\d\d|429|408)|Failed to fetch|NetworkError|Load failed|network|ECONNRESET|ETIMEDOUT|socket|changed while this mutation|OptimisticConcurrency/i.test(e.message || '');
}

// An older server (rollback, or a deployment that hasn't been updated): what it lacks, learned from its errors.
const older = { hbArgs: false, watch: false, sketchOnly: false, confirm: false };
const errText = (e) => String(e?.message || e || '');
const missingFn = (e) => /Could not find public function|No such function/i.test(errText(e));
const argRejected = (e) => /ArgumentValidationError|extra field|missing the required field|Validator/i.test(errText(e));

const sleep = ms => new Promise(r => setTimeout(r, ms));

function parseAction(a) {
  let body;
  try { body = JSON.parse(a.json); } catch { body = { type: 'bad' }; }
  return { ...body, seq: a.seq, p: a.p };
}

// ---- traffic counters (debugging / tests: window.__coopNet) -------------------------------------------------
export const traffic = { http: 0, live: 0, polls: 0, liveSubs: 0, heartbeats: 0, bytesIn: 0 };
const tally = (k, r) => { traffic[k]++; try { traffic.bytesIn += JSON.stringify(r ?? null).length; } catch {} return r; };
if (typeof window !== 'undefined') window.__coopNet = traffic;

// ---- live updates (Convex WebSocket client) ---------------------------------------------------------
// ?coopPoll in the URL (tests, or a network that drops WebSockets) turns them off: polling only.
const pollOnly = () => { try { return typeof location !== 'undefined' && new URLSearchParams(location.search).has('coopPoll'); } catch { return false; } };
let liveP = null;
export function liveClient() {
  if (liveP) return liveP;
  if (!Cloud.url || typeof WebSocket === 'undefined' || pollOnly()) return (liveP = Promise.resolve(null));
  liveP = import('../vendor/convex-browser.js').then(({ ConvexClient }) => {
    const c = new ConvexClient(Cloud.url, { unsavedChangesWarning: false });
    // (cloud.js refreshes the Convex Auth token a minute before it expires; the client asks again before expiry)
    c.setAuth(async () => (await authToken().catch(() => null)) ?? null);
    return c;
  }).catch(e => { console.warn('[coop] live updates unavailable, polling', e); return null; });
  return liveP;
}

// Closes the WebSocket client (tests in Node: an open socket keeps the process alive).
export async function closeLive() { const p = liveP; liveP = null; const c = await p?.catch(() => null); await c?.close?.().catch(() => {}); }

// ---- lobby ----------------------------------------------------------------------------------
// This client plays rooms of up to MAX_PLAYERS (the server keeps a room at 2 while an older 2-player client is in it).
const MAX_PLAYERS = 4;
// opts: { ascension = 0, world = 'spire' } -> { roomId, code }   (world: 'spire' | 'spire_johto' | 'spire_kanto'; legacy 'kanto' / 'hoenn')
// (v0.3.6: the room records the game version and logic id it was created on)
export const createRoom = (opts = {}) => m('coop:create', { ascension: opts.ascension ?? 0, world: opts.world ?? 'spire', maxPlayers: MAX_PLAYERS, gameVersion: VERSION, engine: LOGIC_ID });
// -> { roomId, slot, code, status }   (joining a room you are already in returns your slot: REJOIN)
export const joinRoom = code => m('coop:join', { code: String(code || ''), maxPlayers: MAX_PLAYERS });
// -> { room:{_id,code,status,host(slot),ascension,world,seed,nextSeq,...}, members:[{slot,name,starter,ready,left,lastSeen,lastSeq}], me, isHost, now }
export const getRoom = roomId => q('coop:room', { roomId }).then(r => tally('http', r));
// Live coop:room for the lobby: onView(view) on every change (view.nowAt: when it arrived, for view.now).
// -> stop() | null (no live updates: keep polling getRoom)
export async function watchRoom(roomId, onView, onError) {
  const c = await liveClient();
  if (!c) return null;
  const unsub = c.onUpdate('coop:room', { roomId }, v => { tally('live', v); onView?.({ ...v, nowAt: Date.now() }); }, e => onError?.(e));
  return () => unsub();
}
// ascMax: the ascension this player has unlocked with that starter (the room is capped by the highest one)
export const setStarter = (roomId, starter, ascMax) => m('coop:setStarter', { roomId, starter, ...(ascMax !== undefined ? { ascMax } : {}) });
export const setReady = (roomId, ready) => m('coop:setReady', { roomId, ready: !!ready });
// host only, lobby only; opts: { ascension?, world? }
export const configure = (roomId, opts = {}) => m('coop:configure', { roomId, ...(opts.ascension !== undefined ? { ascension: opts.ascension } : {}), ...(opts.world !== undefined ? { world: opts.world } : {}) });
export const startRoom = roomId => m('coop:start', { roomId });
export const leaveRoom = roomId => m('coop:leave', { roomId });
// Deletes the room from my REJOIN list (a run in progress: I leave it for good). -> { deleted } (true once nobody has it)
export const dismissRoom = roomId => m('coop:dismiss', { roomId });
// Rooms I'm in (not closed, active in the last 24 h), newest first.
export const myRooms = () => q('coop:mine', {});
// seq: the last action seq this client applied. Also tells the server which wire protocol this client speaks (net)
// and how often it beats (hb: longer in a hidden tab). -> { now, presence?: [{ slot, lastSeen, lastSeq, hb }] } (a newer server)
export async function heartbeat(roomId, seq, { hb = HEARTBEAT_MS } = {}) {
  const base = { roomId, ...(seq != null ? { seq } : {}) };
  if (!older.hbArgs) {
    try { return tally('heartbeats', await m('coop:heartbeat', { ...base, net: NET_PROTO, hb })); }
    catch (e) { if (!argRejected(e)) throw e; older.hbArgs = true; }
  }
  return tally('heartbeats', await m('coop:heartbeat', base));
}

// Map sketches (side channel): my sketch JSON, all = also wipe the partner's (ERASE). -> { v }
export const setSketch = (roomId, sketch, all = false) => m('coop:setSketch', { roomId, sketch, ...(all ? { all: true } : {}) });
// -> [{ slot, sketch (JSON or null), sketchV }]   only: just these slots (an older server sends them all)
export async function getSketches(roomId, only) {
  if (Array.isArray(only) && !older.sketchOnly) {
    try { return await q('coop:sketches', { roomId, only }); }
    catch (e) { if (!argRejected(e)) throw e; older.sketchOnly = true; }
  }
  return q('coop:sketches', { roomId });
}

// ---- checkpoints (v0.3.6) --------------------------------------------------------------------
// cp: { seq, phase: 'map', state (snapshot JSON), checksum, gameVersion, engine, reason, progress } -> { seq, disputed, duplicate, need }
export const writeCheckpoint = (roomId, cp) => m('coop:checkpoint', { roomId, ...cp });
// The same without the state: "I'm at this seq with this checksum" (adds my slot, or disputes it). -> { disputed, need }
// (need: the server has no state for that seq yet; an older server always needs the full write)
export async function confirmCheckpoint(roomId, cp) {
  if (older.confirm) return { need: true, disputed: false };
  const { state: _s, ...rest } = cp;
  try { return await m('coop:checkpoint', { roomId, ...rest }); }
  catch (e) { if (!argRejected(e)) throw e; older.confirm = true; return { need: true, disputed: false }; }
}
// -> { seq, phase, state, checksum, gameVersion, engine, reason, slots, createdAt } | null. A server without
// checkpoints (an older deployment) answers null; any other failure throws (the caller retries: resuming without a
// checkpoint that exists would replay the whole log).
export async function latestCheckpoint(roomId) {
  try { return await q('coop:latestCheckpoint', { roomId }); }
  catch (e) { if (/Could not find public function|No such function|not found.*latestCheckpoint/i.test(e?.message || '')) return null; throw e; }
}
// SAVE & QUIT: marks me as away with a save (the others see "saved & quit").
export const saveQuit = roomId => m('coop:saveQuit', { roomId });
// v0.3.12: the run is over: record it as one team run and close the room (coop:finish, through cloud.js's offline-safe
// queue). run: cloud.js coopRunPayload(game). Every client sends it; the first one counts.
export const finishRoom = (roomId, run) => queueCoopRun(roomId, run);

// ---- the run --------------------------------------------------------------------------------
// Appends an action; the server sets seq and p. A random nonce makes retries safe: the same nonce is
// never appended twice. Returns { seq, nonce, duplicate }.
export async function postAction(roomId, action, { retries = 3 } = {}) {
  const { seq: _s, p: _p, ...rest } = action || {};
  const nonce = rest.nonce || randomNonce();
  const json = JSON.stringify({ ...rest, nonce });
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await m('coop:post', { roomId, action: json });
      return { seq: r.seq, nonce, duplicate: !!r.duplicate };
    } catch (e) {
      if (attempt >= retries || !isNetworkError(e)) throw e;
      await sleep([300, 900, 2000][attempt] ?? 2000);
    }
  }
}

// -> { actions:[{seq,p,type,...}], more, status, room, members, me, isHost, now }   (coop:since: with presence)
export async function fetchSince(roomId, after = 0) {
  const r = tally('http', await q('coop:since', { roomId, after }));
  return { ...r, actions: r.actions.map(parseAction) };
}

// One poll of the run's feed: coop:watch (the room view only when vh is out of date), or coop:since on an older server.
async function pollFeed(roomId, after, vh) {
  if (!older.watch) {
    try { return tally('polls', await q('coop:watch', { roomId, after, ...(vh ? { vh } : {}) })); }
    catch (e) { if (!missingFn(e)) throw e; older.watch = true; }
  }
  return tally('polls', await q('coop:since', { roomId, after }));
}

const LIVE_FIRST_MS = 3000;   // how long the first live result may take before we poll instead
const LIVE_DOWN_MS = 4000;    // WebSocket down this long: poll until it's back
const LIVE_RETRY_MS = 15000;  // a failed subscription is tried again after this
const LIVE_SAFETY_MS = 45000; // live, but waiting on partners and nothing came for this long: one poll, just in case
const RESUB_ACTIONS = 4, RESUB_BYTES = 3000; // re-subscribe from the newest seq once a live result carries this much
// (every re-run reads and sends the actions since the subscription's seq: a short tail keeps them small)

// Hands the room's new actions out in seq order (onActions) and the room after every update (onRoom), from a live
// coop:watch subscription, or by polling when that isn't available. Never runs two polls at once; when the server
// says there is more (a backlog on reconnect), it fetches again immediately until drained.
// opts.interval(): the poll interval in ms (asked before every poll; default intervalMs). opts.live = false: poll only.
export class CoopPoller {
  constructor(roomId, { intervalMs = 700, interval = null, after = 0, live = true, onActions, onRoom, onError } = {}) {
    this.roomId = roomId;
    this.intervalMs = intervalMs;
    this.interval = interval || (() => this.intervalMs);
    this.after = after;          // last seq handed to onActions
    this.onActions = onActions || null;
    this.onRoom = onRoom || null;
    this.onError = onError || null;
    this.wantLive = live;
    this.running = false;
    this.busy = false;
    this.failures = 0;
    this.lastRoom = null;        // last { room, members, me, isHost, status, now }
    this.view = null;            // last room view { room, members, me, isHost } and its version
    this.vh = null;
    this._timer = null;
    this._gen = 0;               // bumps on stop()/setAfter() so stale responses are dropped
    this._chain = Promise.resolve();
    this.client = null;          // the Convex WebSocket client while live
    this.liveOk = false;         // the subscription has delivered (and not failed since)
    this.liveDownSince = 0;
    this.lastDelivery = 0;
    this.lastPoll = 0;
    this.startedAt = 0;
  }

  get live() { return this.liveOk && !!this.client; }

  start() {
    if (this.running) return this;
    this.running = true;
    this.startedAt = Date.now();
    if (this.wantLive) this._goLive();
    this._schedule(this.wantLive && Cloud.url && !pollOnly() ? LIVE_FIRST_MS : 0);
    return this;
  }

  stop() {
    this.running = false;
    this._gen++;
    clearTimeout(this._timer); this._timer = null;
    this._unsubscribe();
    return this;
  }

  // Resume from a given seq (e.g. 0 to replay the whole log after a desync).
  setAfter(seq) {
    this.after = Math.max(0, seq | 0);
    this._gen++;
    if (this.client && this.running) this._subscribe();
    if (this.running && !this.busy) this._schedule(0);
    return this;
  }

  // Poll now (e.g. right after posting) instead of waiting for the next tick (live: the server pushes it anyway).
  kick() {
    if (this.running && !this.busy && !this._liveHealthy()) this._schedule(0);
    return this;
  }

  _schedule(ms) {
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this._tick(), ms);
  }

  // ---- live ----
  async _goLive() {
    if (older.watch) return;
    const c = await liveClient();
    if (!c || !this.running) return;
    this.client = c;
    this._subscribe();
  }
  _unsubscribe() {
    const u = this._unsub;
    this._unsub = null;
    this._subGen = (this._subGen || 0) + 1;
    try { u?.(); } catch {}
  }
  _subscribe() {
    this._unsubscribe();
    if (!this.client || !this.running || older.watch) return;
    const gen = this._subGen;
    this._subAfter = this.after;
    this._subVh = this.vh;
    traffic.liveSubs++;
    this._unsub = this.client.onUpdate('coop:watch', { roomId: this.roomId, after: this.after, ...(this.vh ? { vh: this.vh } : {}) },
      (r) => { if (gen === this._subGen) this._onLive(r); },
      (e) => { if (gen === this._subGen) this._onLiveError(e); });
  }
  _onLive(r) {
    tally('live', r);
    this.liveOk = true;
    this.liveDownSince = 0;
    this._deliver(r).then(() => {
      if (!this.running || !this.client) return;
      // keep re-runs small: once this subscription's results carry a view we now have, a backlog or many actions,
      // subscribe again from where we are
      let bytes = 0;
      for (const a of r.actions) bytes += a.json.length;
      if ((r.view && this.vh !== this._subVh) || r.more || this.after - this._subAfter >= RESUB_ACTIONS || bytes >= RESUB_BYTES) this._subscribe();
    });
  }
  _onLiveError(e) {
    this.liveOk = false;
    this._unsubscribe();
    if (missingFn(e)) { older.watch = true; this.client = null; return; } // (an older server: poll coop:since)
    console.warn('[coop] live update failed, polling for now', errText(e));
    if (/Room not found/i.test(errText(e))) this._safe(this.onError, e);
    setTimeout(() => { if (this.running && this.client && !this._unsub) this._subscribe(); }, LIVE_RETRY_MS);
    if (this.running && !this.busy) this._schedule(0);
  }
  _liveHealthy() {
    if (!this.client || !this.liveOk) return false;
    let up = true;
    try { up = this.client.connectionState().isWebSocketConnected; } catch {}
    if (up) { this.liveDownSince = 0; return true; }
    this.liveDownSince ||= Date.now();
    return Date.now() - this.liveDownSince < LIVE_DOWN_MS;
  }

  // ---- delivery (live results and polls alike, one at a time, in order) ----
  _deliver(r) {
    const p = this._chain.then(() => this._deliverNow(r));
    this._chain = p.catch(() => {});
    return p;
  }
  async _deliverNow(r) {
    if (!this.running) return 0;
    this.failures = 0;
    this.lastDelivery = Date.now();
    const fresh = (r.actions || []).map(parseAction).filter(a => a.seq > this.after);
    if (fresh.length) {
      this.after = fresh[fresh.length - 1].seq;
      await this._safe(this.onActions, fresh);
    }
    if (r.view) { this.view = r.view; this.vh = r.vh; }
    else if (r.room) { this.view = { room: r.room, members: r.members, me: r.me, isHost: r.isHost }; this.vh = null; } // (coop:since)
    if (!this.view) return fresh.length;
    const room = { ...this.view.room, nextSeq: r.nextSeq ?? r.room?.nextSeq ?? this.view.room.nextSeq, status: r.status ?? this.view.room.status };
    this.lastRoom = { room, members: this.view.members, me: this.view.me, isHost: this.view.isHost, status: room.status, now: r.now ?? null };
    await this._safe(this.onRoom, room, this.view.members, this.lastRoom);
    return fresh.length;
  }

  // ---- polling (no live updates, or they're down) ----
  async _tick() {
    this._timer = null;
    if (!this.running || this.busy) return;
    const now = Date.now();
    if (this._liveHealthy()) {
      // live: no polls, except one now and then while we wait on partners and nothing came (belt and braces)
      const waiting = this.interval() <= 1000;
      if (!(waiting && now - this.lastDelivery > LIVE_SAFETY_MS && now - this.lastPoll > LIVE_SAFETY_MS)) { this._schedule(1000); return; }
    }
    this.busy = true;
    const gen = this._gen;
    let next = this.interval();
    try {
      this.lastPoll = now;
      const r = await pollFeed(this.roomId, this.after, this.view ? this.vh : null);
      if (gen === this._gen && this.running) {
        const n = await this._deliver(r);
        if (r.more && n) next = 0; // keep draining the backlog
      } else next = 0;
    } catch (e) {
      this.failures++;
      next = Math.min(Math.max(this.interval(), 700) * 2 ** Math.min(this.failures, 4), 10000);
      await this._safe(this.onError, e);
    } finally {
      this.busy = false;
    }
    if (this.running) this._schedule(next);
  }

  async _safe(fn, ...args) {
    if (!fn) return;
    try { await fn(...args); } catch (e) {
      if (fn !== this.onError && this.onError) { try { this.onError(e); } catch {} }
      else console.warn('CoopPoller callback failed', e);
    }
  }
}
