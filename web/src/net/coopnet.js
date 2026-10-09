// Browser client for the co-op API (convex/coop.ts), over cloud.js's authenticated HTTP call.
// Actions go up and come down as JSON strings (no Convex value limits for big Run snapshots); this module
// hides that: fetchSince / CoopPoller hand out plain action objects { seq, p, type, ...payload, nonce }.
import { cloudCall, queueCoopRun } from './cloud.js';
import { VERSION } from '../game/version.js';
import { LOGIC_ID } from '../game/coop/engines.js';

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

const sleep = ms => new Promise(r => setTimeout(r, ms));

function parseAction(a) {
  let body;
  try { body = JSON.parse(a.json); } catch { body = { type: 'bad' }; }
  return { ...body, seq: a.seq, p: a.p };
}

// ---- lobby ----------------------------------------------------------------------------------
// This client plays rooms of up to MAX_PLAYERS (the server keeps a room at 2 while an older 2-player client is in it).
const MAX_PLAYERS = 4;
// opts: { ascension = 0, world = 'spire' } -> { roomId, code }   (world: 'spire' | 'spire_johto' | 'spire_kanto'; legacy 'kanto' / 'hoenn')
// (v0.3.6: the room records the game version and logic id it was created on)
export const createRoom = (opts = {}) => m('coop:create', { ascension: opts.ascension ?? 0, world: opts.world ?? 'spire', maxPlayers: MAX_PLAYERS, gameVersion: VERSION, engine: LOGIC_ID });
// -> { roomId, slot, code, status }   (joining a room you are already in returns your slot: REJOIN)
export const joinRoom = code => m('coop:join', { code: String(code || ''), maxPlayers: MAX_PLAYERS });
// -> { room:{_id,code,status,host(slot),ascension,world,seed,nextSeq,...}, members:[{slot,name,starter,ready,left,lastSeen,lastSeq}], me, isHost, now }
export const getRoom = roomId => q('coop:room', { roomId });
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
// seq: the last action seq this client applied (partner sees it; drives the "online" dot via lastSeen)
export const heartbeat = (roomId, seq) => m('coop:heartbeat', { roomId, seq: seq ?? undefined });

// Map sketches (side channel): my sketch JSON, all = also wipe the partner's (ERASE). -> { v }
export const setSketch = (roomId, sketch, all = false) => m('coop:setSketch', { roomId, sketch, ...(all ? { all: true } : {}) });
// -> [{ slot, sketch (JSON or null), sketchV }]
export const getSketches = roomId => q('coop:sketches', { roomId });

// ---- checkpoints (v0.3.6) --------------------------------------------------------------------
// cp: { seq, phase: 'map', state (snapshot JSON), checksum, gameVersion, engine, reason, progress } -> { seq, disputed, duplicate }
export const writeCheckpoint = (roomId, cp) => m('coop:checkpoint', { roomId, ...cp });
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

// -> { actions:[{seq,p,type,...}], more, status, room, members, me, isHost, now }
export async function fetchSince(roomId, after = 0) {
  const r = await q('coop:since', { roomId, after });
  return { ...r, actions: r.actions.map(parseAction) };
}

// Polls coop:since and hands new actions out in seq order. Never runs two requests at once; when the
// server says there is more (backlog > 200 on reconnect), it fetches again immediately until drained.
export class CoopPoller {
  constructor(roomId, { intervalMs = 700, after = 0, onActions, onRoom, onError } = {}) {
    this.roomId = roomId;
    this.intervalMs = intervalMs;
    this.after = after;          // last seq handed to onActions
    this.onActions = onActions || null;
    this.onRoom = onRoom || null;
    this.onError = onError || null;
    this.running = false;
    this.busy = false;
    this.failures = 0;
    this.lastRoom = null;        // last { room, members, me, isHost, status, now }
    this._timer = null;
    this._gen = 0;               // bumps on stop()/setAfter() so stale responses are dropped
  }

  start() {
    if (this.running) return this;
    this.running = true;
    this._schedule(0);
    return this;
  }

  stop() {
    this.running = false;
    this._gen++;
    clearTimeout(this._timer); this._timer = null;
    return this;
  }

  // Resume from a given seq (e.g. 0 to replay the whole log after a desync).
  setAfter(seq) {
    this.after = Math.max(0, seq | 0);
    this._gen++;
    if (this.running && !this.busy) this._schedule(0);
    return this;
  }

  // Poll now (e.g. right after posting) instead of waiting for the next tick.
  kick() {
    if (this.running && !this.busy) this._schedule(0);
    return this;
  }

  _schedule(ms) {
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this._tick(), ms);
  }

  async _tick() {
    this._timer = null;
    if (!this.running || this.busy) return;
    this.busy = true;
    const gen = this._gen;
    let next = this.intervalMs;
    try {
      const r = await fetchSince(this.roomId, this.after);
      if (gen === this._gen && this.running) {
        this.failures = 0;
        const fresh = r.actions.filter(a => a.seq > this.after);
        if (fresh.length) {
          this.after = fresh[fresh.length - 1].seq;
          await this._safe(this.onActions, fresh);
        }
        this.lastRoom = { room: r.room, members: r.members, me: r.me, isHost: r.isHost, status: r.status, now: r.now };
        await this._safe(this.onRoom, r.room, r.members, this.lastRoom);
        if (r.more && fresh.length) next = 0; // keep draining the backlog
      } else next = 0;
    } catch (e) {
      this.failures++;
      next = Math.min(this.intervalMs * 2 ** Math.min(this.failures, 4), 5000);
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
