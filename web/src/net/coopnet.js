// Browser client for the co-op API (convex/coop.ts). Everything goes over cloud.js's ONE Convex WebSocket client:
// mutations as calls, and every read the game keeps up to date as a subscription the server pushes (staging-net:
// no polling anywhere). Actions go up and come down as JSON strings (no Convex value limits for big Run snapshots);
// this module hides that: fetchFeed / CoopFeed hand out plain action objects { seq, p, type, ...payload, nonce }.
//
// Subscriptions (convex/coop.ts "live reads"):
//   coop:head      the room and its members (status, seats, starters, ready, left / saved): changes rarely
//   coop:feed      the actions after a cursor: CoopFeed subscribes again from its newest seq after every delivery, so
//                  each result is just the new actions; after a reconnect the client re-runs it and the backlog arrives
//   coop:presence  everyone's keepalive (coop:alive: every KEEPALIVE_MS, at once on a real change)
//   coop:sketch    one partner's map sketch (mine: only whether a partner's ERASE wiped it)
//   coop:mineLive  the REJOIN list
import { cloudCall, queueCoopRun, subscribe, onConnection, Cloud, authToken, closeLive as closeCloudLive, traffic } from './cloud.js';
import { VERSION } from '../game/version.js';
import { LOGIC_ID } from '../game/coop/engines.js';
import { NET_PROTO } from '../game/coop/wire.js';

export { NET_PROTO, onConnection, traffic };
export const KEEPALIVE_MS = 30000;        // presence keepalive in a visible tab
export const KEEPALIVE_HIDDEN_MS = 60000; // in a hidden tab (browsers throttle its timers to about once a minute)
export const HEARTBEAT_MS = KEEPALIVE_MS; // (the name older code reads)

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
// (Over the WebSocket a mutation waits for the connection instead of failing: these come from the HTTP path, from
// timeouts the session sets itself, or from the server's own concurrency retries running out.)
export function isNetworkError(e) {
  if (!e) return false;
  if (e instanceof TypeError) return true; // fetch() rejects with TypeError when offline / connection reset
  return /^HTTP (5\d\d|429|408)|Failed to fetch|NetworkError|Load failed|network|ECONNRESET|ETIMEDOUT|timed out|socket|changed while this mutation|OptimisticConcurrency/i.test(e.message || '');
}

const errText = (e) => String(e?.message || e || '');
const argRejected = (e) => /ArgumentValidationError|extra field|missing the required field|Validator/i.test(errText(e));
const sleep = ms => new Promise(r => setTimeout(r, ms));

function parseAction(a) {
  let body;
  try { body = JSON.parse(a.json); } catch { body = { type: 'bad' }; }
  return { ...body, seq: a.seq, p: a.p };
}

// Closes the WebSocket client (tests in Node: an open socket keeps the process alive).
export const closeLive = () => closeCloudLive();

// ---- lobby ----------------------------------------------------------------------------------
// This client plays rooms of up to MAX_PLAYERS (the server keeps a room at 2 while an older 2-player client is in it).
const MAX_PLAYERS = 4;
// opts: { ascension = 0, world = 'spire' } -> { roomId, code }   (world: 'spire' | 'spire_johto' | 'spire_kanto'; legacy 'kanto' / 'hoenn')
// (v0.3.6: the room records the game version and logic id it was created on)
export const createRoom = (opts = {}) => m('coop:create', { ascension: opts.ascension ?? 0, world: opts.world ?? 'spire', maxPlayers: MAX_PLAYERS, gameVersion: VERSION, engine: LOGIC_ID });
// -> { roomId, slot, code, status }   (joining a room you are already in returns your slot: REJOIN)
export const joinRoom = code => m('coop:join', { code: String(code || ''), maxPlayers: MAX_PLAYERS });
// One-shot read (tests, tools): -> { room:{...,nextSeq}, members:[{...,lastSeen,lastSeq}], me, isHost, now }
export const getRoom = roomId => q('coop:room', { roomId });
// Live room: onView({ room, members, me, isHost }) now and on every change (coop:head). -> stop()
export const watchRoom = (roomId, onView, onError) => subscribe('coop:head', { roomId }, onView, onError);
// Live presence: onList([{ slot, lastSeen, hb, gone? }]) on every keepalive / goodbye (coop:presence). -> stop()
export const watchPresence = (roomId, onList, onError) => subscribe('coop:presence', { roomId }, onList, onError);
// ascMax: the ascension this player has unlocked with that starter (the room is capped by the highest one)
export const setStarter = (roomId, starter, ascMax) => m('coop:setStarter', { roomId, starter, ...(ascMax !== undefined ? { ascMax } : {}) });
export const setReady = (roomId, ready) => m('coop:setReady', { roomId, ready: !!ready });
// host only, lobby only; opts: { ascension?, world? }
export const configure = (roomId, opts = {}) => m('coop:configure', { roomId, ...(opts.ascension !== undefined ? { ascension: opts.ascension } : {}), ...(opts.world !== undefined ? { world: opts.world } : {}) });
export const startRoom = roomId => m('coop:start', { roomId });
export const leaveRoom = roomId => m('coop:leave', { roomId });
// Deletes the room from my REJOIN list (a run in progress: I leave it for good). -> { deleted } (true once nobody has it)
export const dismissRoom = roomId => m('coop:dismiss', { roomId });
// Rooms I'm in (not closed, active in the last 24 h; runs: 30 days), newest first. One-shot, or live (REJOIN list).
export const myRooms = () => q('coop:mine', {});
export const watchMyRooms = (onList, onError) => subscribe('coop:mineLive', {}, onList, onError);

// Presence keepalive: "I'm here" (coop:alive). hb: how often I send one (the others allow two of them, plus slack).
// -> { now } (the server clock)
export const alive = (roomId, { hb = KEEPALIVE_MS, seq } = {}) => m('coop:alive', { roomId, hb, net: NET_PROTO, ...(seq != null ? { seq } : {}) });
// Leaving the game: say goodbye so the others see me offline at once. unloading: the tab is closing (fetch keepalive:
// the socket dies with the page); else over the socket like everything else.
export const goodbye = (roomId, { unloading = true } = {}) => cloudCall('mutation', 'coop:alive', { roomId, gone: true }, { keepalive: unloading }).catch(() => {});
// (older clients' heartbeat, kept for tests and tools)
export const heartbeat = (roomId, seq, { hb = KEEPALIVE_MS } = {}) => m('coop:heartbeat', { roomId, ...(seq != null ? { seq } : {}), net: NET_PROTO, hb });

// Map sketches (side channel): my sketch JSON, all = also wipe the partners' (ERASE). -> { v }
export const setSketch = (roomId, sketch, all = false) => m('coop:setSketch', { roomId, sketch, ...(all ? { all: true } : {}) });
// One-shot: -> { slot, sketch (JSON or null) }
export const getSketch = (roomId, slot) => q('coop:sketch', { roomId, slot });
// Live: onSketch({ slot, sketch }) on every change of that player's sketch; wiped: onSketch({ slot, wiped }) instead
// (my own slot: did a partner's ERASE wipe it?). -> stop()
export const watchSketch = (roomId, slot, onSketch, { wiped = false } = {}, onError) => subscribe('coop:sketch', { roomId, slot, ...(wiped ? { wiped: true } : {}) }, onSketch, onError);
// (older clients' fetch, kept for tests and tools) -> [{ slot, sketch, sketchV }]
export const getSketches = (roomId, only) => q('coop:sketches', { roomId, ...(Array.isArray(only) ? { only } : {}) });

// ---- checkpoints (v0.3.6) --------------------------------------------------------------------
// cp: { seq, phase: 'map', state (snapshot JSON), checksum, gameVersion, engine, reason, progress } -> { seq, disputed, duplicate, need }
export const writeCheckpoint = (roomId, cp) => m('coop:checkpoint', { roomId, ...cp });
// The same without the state: "I'm at this seq with this checksum" (adds my slot, or disputes it). -> { disputed, need }
// (need: the server has no state for that seq yet)
let olderConfirm = false;
export async function confirmCheckpoint(roomId, cp) {
  if (olderConfirm) return { need: true, disputed: false };
  const { state: _s, ...rest } = cp;
  try { return await m('coop:checkpoint', { roomId, ...rest }); }
  catch (e) { if (!argRejected(e)) throw e; olderConfirm = true; return { need: true, disputed: false }; }
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

// One page of the log after `after` (resuming: the backlog before the live feed starts). -> { actions (parsed), more }
export async function fetchFeed(roomId, after = 0) {
  const r = await q('coop:feed', { roomId, after });
  return { actions: r.actions.map(parseAction), more: !!r.more };
}
// (older clients' read, kept for tests and tools) -> { actions (parsed), more, status, room, members, me, isHost, now }
export async function fetchSince(roomId, after = 0) {
  const r = await q('coop:since', { roomId, after });
  return { ...r, actions: r.actions.map(parseAction) };
}

// The live run: subscriptions to coop:head (onHead(view)), coop:presence (onPresence(list)) and coop:feed, which hands
// the new actions out in seq order (onActions(actions)) and says when it has caught up with the log (onCaughtUp(),
// after every result that brought nothing new). After every delivery the feed subscribes again from its newest seq,
// so a result is only ever the actions since the last one. A dropped socket needs nothing from here: the Convex
// client subscribes again when it reconnects, and the feed's re-run brings everything posted meanwhile (in pages of
// at most FEED_MAX actions: `more` makes the feed go on from the last one at once).
export class CoopFeed {
  constructor(roomId, { after = 0, onActions, onHead, onPresence, onCaughtUp, onError } = {}) {
    Object.assign(this, { roomId, after: Math.max(0, after | 0), onActions, onHead, onPresence, onCaughtUp, onError });
    this.running = false;
    this.subs = { head: null, presence: null, feed: null };
    this._gen = 0;               // bumps whenever the feed subscription is replaced: older results are dropped
    this._chain = Promise.resolve();
    this.deliveries = 0;         // results handled (tests)
    this.resubscribes = 0;
  }

  start() {
    if (this.running) return this;
    this.running = true;
    this.subs.head = watchRoom(this.roomId, (v) => this._safe(this.onHead, v), (e) => this._safe(this.onError, e));
    this.subs.presence = watchPresence(this.roomId, (l) => this._safe(this.onPresence, l), (e) => this._safe(this.onError, e));
    this._subscribeFeed();
    return this;
  }

  stop() {
    this.running = false;
    this._gen++;
    for (const k of Object.keys(this.subs)) { try { this.subs[k]?.(); } catch {} this.subs[k] = null; }
    return this;
  }

  // Go on from another seq (e.g. 0 to replay the whole log after a desync).
  setAfter(seq) {
    this.after = Math.max(0, seq | 0);
    if (this.running) this._subscribeFeed();
    return this;
  }

  _subscribeFeed() {
    const gen = ++this._gen;
    const old = this.subs.feed;
    this.resubscribes++;
    // (nothing can fall between the two: the new one reads everything after this.after)
    this.subs.feed = subscribe('coop:feed', { roomId: this.roomId, after: this.after },
      (r) => { if (gen === this._gen) this._deliver(r, gen); },
      (e) => { if (gen === this._gen) this._safe(this.onError, e); });
    try { old?.(); } catch {}
  }

  _deliver(r, gen) {
    this._chain = this._chain.then(async () => {
      if (!this.running || gen !== this._gen) return;
      this.deliveries++;
      const fresh = (r.actions || []).map(parseAction).filter(a => a.seq > this.after);
      if (fresh.length) {
        this.after = fresh[fresh.length - 1].seq;
        await this._safe(this.onActions, fresh);
      }
      if (!this.running || gen !== this._gen) return;
      if (fresh.length || r.more) this._subscribeFeed();
      else await this._safe(this.onCaughtUp);
    }).catch(e => console.warn('CoopFeed delivery failed', e));
    return this._chain;
  }

  async _safe(fn, ...args) {
    if (!fn) return;
    try { await fn(...args); } catch (e) {
      if (fn !== this.onError && this.onError) { try { this.onError(e); } catch {} }
      else console.warn('CoopFeed callback failed', e);
    }
  }
}
