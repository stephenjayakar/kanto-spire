// Cloud saves and records in Convex, behind Google sign-in (Convex Auth).
// Save data (meta-progression + the run in progress) is synced per account; finished runs are queued
// in localStorage first, so nothing is lost while offline.
//
// Transport (staging-net): every query and mutation goes over ONE Convex WebSocket client (ConvexClient, vendored in
// web/src/vendor/convex-browser.js), and everything the game keeps up to date (co-op rooms, presence, NOW PLAYING,
// RECORDS, the REJOIN list) is a subscription on it (subscribe() below): the server pushes changes, nothing polls.
// Plain HTTP is left for what a socket can't do: the Convex Auth sign-in / token refresh (auth:signIn), the last
// writes of a closing tab (fetch keepalive), the asset packs (net/assetpack.js), and a browser without WebSocket.
import { spireCode } from '../game/regions.js';
import { VERSION } from '../game/version.js';
import { SaveSync } from './savesync.js';

const AUTH_KEY = 'kantospire.auth.v1';
const VERIFIER_KEY = 'kantospire.authVerifier.v1';
const INVITE_KEY = 'kantospire.invite.v1'; // an invite code from ?invite=, kept across the Google redirect
const QUEUE_BASE = 'kantospire.cloudQueue.v1';
// Finished runs waiting to upload, per account email (never submitted under another account).
const queueKey = () => QUEUE_BASE + (Cloud.me?.email ? ':' + Cloud.me.email.toLowerCase() : ':signed-out');
const hasStorage = typeof localStorage !== 'undefined';

export const Cloud = {
  url: null,        // Convex deployment URL from cloud.json; null = offline build (no sign-in, no sync)
  siteUrl: null,    // the deployment's HTTP actions (…convex.site): serves the gated asset packs
  packs: false,     // hosted build: assets come from Convex after sign-in, not from the static site
  auth: null,       // { token, refreshToken }
  me: null,         // { email, name, runs, wins, bestScore, ... } once signed in
  online: false,
  error: null,      // last sign-in / sync problem, shown on the sign-in screen
  lastResult: null, // { status: 'saved' | 'queued' | 'error', score?, message? } for the run that just ended
  saveKeys: null,   // { meta, run } localStorage keys of the game's save data (getters, scoped by email)
  onAccount: null,  // called with the signed-in email before the save is pulled
};

function load(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }
function store(key, v) { try { if (v === null) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(v)); } catch {} }

function tokenExpiry(jwt) {
  try { return JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).exp * 1000; } catch { return 0; }
}

// ---- traffic counters (debug console / tests: window.__net) ----------------------------------------------------
export const traffic = { http: 0, httpBytes: 0, wsCalls: 0, subs: 0, updates: 0, updateBytes: 0, byPath: {} };
const tally = (path, r, kind) => {
  const b = (traffic.byPath[path] ||= { calls: 0, updates: 0, bytes: 0 });
  let n = 0;
  try { n = JSON.stringify(r ?? null).length; } catch {}
  b.bytes += n;
  if (kind === 'update') { b.updates++; traffic.updates++; traffic.updateBytes += n; }
  else b.calls++;
  return r;
};
if (typeof window !== 'undefined') window.__net = traffic;

const isNetErr = (e) => e instanceof TypeError || /^HTTP (5\d\d|429|408)|Failed to fetch|NetworkError|Load failed/i.test(String(e?.message || ''));

async function post(kind, path, args, token, keepalive = false) {
  if (!Cloud.url) throw new Error('Cloud saves are not configured.');
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  traffic.http++;
  const res = await fetch(`${Cloud.url}/api/${kind}`, { method: 'POST', headers, keepalive, body: JSON.stringify({ path, args, format: 'json' }) });
  const body = await res.json().catch(() => ({ status: 'error', errorMessage: `HTTP ${res.status}` }));
  if (body.status !== 'success') {
    // Convex wraps thrown errors as "...Uncaught Error: <message>\n    at ..."
    const m = /Uncaught Error: ([^\n]*)/.exec(body.errorMessage || '');
    throw new Error(m ? m[1] : body.errorMessage || body.message || 'Request failed');
  }
  return body.value;
}

function setAuth(tokens) {
  Cloud.auth = tokens ? { token: tokens.token, refreshToken: tokens.refreshToken } : null;
  store(AUTH_KEY, Cloud.auth);
  if (!tokens) Cloud.me = null;
}

// The current token, refreshed (auth:signIn over HTTP) when it has less than a minute left, or always with force.
// A refresh the server refuses signs you out; one that never reached it (offline) throws and keeps the session.
let refreshing = null;
async function freshToken(force = false) {
  if (!Cloud.auth) return null;
  if (!force && tokenExpiry(Cloud.auth.token) - Date.now() > 60_000) return Cloud.auth.token;
  refreshing ??= post('action', 'auth:signIn', { refreshToken: Cloud.auth.refreshToken })
    .then(r => { setAuth(r.tokens || null); return Cloud.auth?.token ?? null; })
    .catch(e => { if (isNetErr(e)) throw e; console.warn('token refresh failed', e); setAuth(null); return null; })
    .finally(() => { refreshing = null; });
  return refreshing;
}

// ---- the WebSocket client -------------------------------------------------------------------------------------
// ?noLive in the URL (or no WebSocket in this browser): one-shot HTTP calls instead, and no live updates.
const noLive = () => { try { return typeof WebSocket === 'undefined' || (typeof location !== 'undefined' && new URLSearchParams(location.search).has('noLive')); } catch { return true; } };
let liveP = null, handed = null;
// The token the socket uses. The client asks again (force) a minute before it expires, and when the server refuses
// it; a token cloud.js already refreshed meanwhile (an HTTP call) is handed over as it is. Offline at that moment:
// wait for the network rather than drop the socket's sign-in (the socket is down then anyway).
async function socketToken({ forceRefreshToken } = {}) {
  for (let i = 0; ; i++) {
    try {
      if (!Cloud.auth) return null;
      const t = await freshToken(!!forceRefreshToken && Cloud.auth.token === handed);
      handed = t;
      return t;
    } catch (e) {
      if (i >= 40) return null;
      await new Promise(r => setTimeout(r, Math.min(30_000, 1000 * 2 ** Math.min(i, 5))));
    }
  }
}
// -> Promise<ConvexClient | null>. Made once, after cloud.json (initCloud); every module shares it.
export function liveClient() {
  if (liveP) return liveP;
  if (!Cloud.url || noLive()) return (liveP = Promise.resolve(null));
  liveP = import('../vendor/convex-browser.js').then(({ ConvexClient }) => {
    // initialAuthTokenReuse: the stored token is used until a minute before it expires (not swapped at once)
    const c = new ConvexClient(Cloud.url, { unsavedChangesWarning: false, initialAuthTokenReuse: true, authRefreshTokenLeewaySeconds: 60 });
    c.setAuth(socketToken);
    return c;
  }).catch(e => { console.warn('[net] no WebSocket client, using HTTP', e); return null; });
  return liveP;
}
// Closes the socket (tests in Node: an open socket keeps the process alive).
export async function closeLive() { const p = liveP; liveP = null; const c = await p?.catch(() => null); await c?.close?.().catch(() => {}); }

// Convex errors over the socket read "[CONVEX M(coop:post)] [Request ID: …] Server Error\nUncaught Error: <message>\n at …":
// the same short message as the HTTP path.
function cleanError(e) {
  const raw = String(e?.message || e || '');
  const m = /Uncaught Error: ([^\n]*)/.exec(raw);
  if (!m) return e instanceof Error ? e : new Error(raw);
  const err = new Error(m[1]);
  err.raw = raw;
  return err;
}

// A socket that has connected once is used even while it reconnects (calls wait for it, like the subscriptions). One
// that never got through (a network that blocks WebSockets): one-shot calls go over HTTP after FIRST_CONNECT_MS, so
// signing in, saves and RECORDS still work there (the live parts, co-op, need the socket).
const FIRST_CONNECT_MS = 6000;
let socketBlocked = false;
async function socketUsable(c) {
  if (socketBlocked) { try { socketBlocked = !c.connectionState().hasEverConnected; } catch {} if (socketBlocked) return false; }
  let st;
  try { st = c.connectionState(); } catch { return true; }
  if (st.hasEverConnected || st.isWebSocketConnected) return true;
  const up = await new Promise((resolve) => {
    let off = null;
    const t = setTimeout(() => { try { off?.(); } catch {} resolve(false); }, FIRST_CONNECT_MS);
    off = c.subscribeToConnectionState?.((x) => { if (x.isWebSocketConnected || x.hasEverConnected) { clearTimeout(t); try { off?.(); } catch {} resolve(true); } });
  });
  if (!up) { socketBlocked = true; console.warn('[net] the WebSocket did not connect: one-shot calls over HTTP'); }
  return up;
}

async function call(kind, path, args, opts = {}) {
  if (!Cloud.auth) throw new Error('Signed out. Sign in with Google again.');
  if (!opts.keepalive) {
    const c = await liveClient();
    if (c && await socketUsable(c)) {
      traffic.wsCalls++;
      try { return tally(path, await c[kind](path, args || {})); } catch (e) { throw cleanError(e); }
    }
  }
  const token = await freshToken();
  if (!token) throw new Error('Signed out. Sign in with Google again.');
  return tally(path, await post(kind, path, args, token, opts.keepalive));
}

// A live query: onValue(result) now and after every change the server pushes (also after a reconnect: the client
// subscribes again by itself), onError(e) when the query throws (it stays subscribed and may recover).
// -> stop(). Without a WebSocket client: onError(Error('no live updates')), once.
export function subscribe(path, args, onValue, onError) {
  let stop = false, unsub = null;
  traffic.subs++;
  liveClient().then(c => {
    if (stop) return;
    if (!c) { onError?.(new Error('No live updates (no WebSocket).')); return; }
    unsub = c.onUpdate(path, args || {}, (v) => { if (!stop) { tally(path, v, 'update'); onValue?.(v); } }, (e) => { if (!stop) onError?.(cleanError(e)); });
  });
  return () => { stop = true; try { unsub?.(); } catch {} unsub = null; };
}
// The socket's state: cb({ isWebSocketConnected, hasEverConnected, connectionCount, ... }) on every change. -> stop()
export function onConnection(cb) {
  let stop = false, unsub = null;
  liveClient().then(c => { if (!stop && c?.subscribeToConnectionState) { unsub = c.subscribeToConnectionState(cb); try { cb(c.connectionState()); } catch {} } });
  return () => { stop = true; try { unsub?.(); } catch {} };
}
export const liveConnected = async () => { const c = await liveClient(); try { return !!c?.connectionState().isWebSocketConnected; } catch { return false; } };

export async function initCloud({ saveKeys, onAccount } = {}) {
  if (!hasStorage) return;
  Cloud.saveKeys = saveKeys || null;
  Cloud.onAccount = onAccount || null;
  try {
    const cfg = await fetch('cloud.json', { cache: 'no-cache' }).then(r => (r.ok ? r.json() : null));
    Cloud.url = cfg?.convexUrl?.replace(/\/$/, '') || null;
    Cloud.siteUrl = cfg?.siteUrl?.replace(/\/$/, '') || Cloud.url?.replace(/\.convex\.cloud$/, '.convex.site') || null;
    Cloud.packs = !!cfg?.packs;
  } catch { Cloud.url = null; }
  if (!Cloud.url) return;
  Cloud.auth = load(AUTH_KEY, null);
  const inv = new URL(location.href).searchParams.get('invite');
  if (inv) {
    store(INVITE_KEY, inv);
    const u = new URL(location.href); u.searchParams.delete('invite');
    history.replaceState(null, '', u.pathname + u.search + u.hash);
  }
  // Back from Google: trade the one-time code (plus our PKCE verifier) for tokens.
  const url = new URL(location.href);
  const code = url.searchParams.get('code');
  if (code) {
    url.searchParams.delete('code');
    history.replaceState(null, '', url.pathname + url.search + url.hash);
    try {
      const r = await post('action', 'auth:signIn', { params: { code }, verifier: load(VERIFIER_KEY, undefined) });
      setAuth(r.tokens || null);
      if (!r.tokens) throw new Error('no tokens for that code');
    } catch (e) {
      // (a stale code: the sign-in was started again elsewhere, or interrupted; a fresh one fixes it)
      console.warn('sign-in code exchange failed', e);
      Cloud.error = "Sign-in didn't finish. Please sign in again.";
    }
    store(VERIFIER_KEY, null);
  } else if (load(VERIFIER_KEY, null) && !Cloud.auth) {
    // Back without a code: Google was closed or cancelled (the auth server sends you back with nothing)
    Cloud.error = 'Sign-in was cancelled. Try again whenever you like.';
    store(VERIFIER_KEY, null);
  }
  if (!Cloud.auth) return;
  liveClient(); // (connects while the rest of the sign-in runs)
  // Signed in with an invite link pending: join the allowlist first.
  const pending = load(INVITE_KEY, null);
  if (pending) {
    try { await call('mutation', 'invites:redeem', { code: pending }); store(INVITE_KEY, null); }
    catch (e) { Cloud.error = e.message; if (/used|expired|not valid/i.test(e.message)) store(INVITE_KEY, null); }
  }
  try {
    Cloud.me = await call('mutation', 'players:me', {});
    Cloud.online = true;
    Cloud.onAccount?.(Cloud.me.email);
    await pullProgress();
    await flushQueue();
  } catch (e) {
    console.warn('cloud init failed', e);
    Cloud.error = e.message;
    if (/allowed/i.test(e.message) && !Cloud.error?.includes('invite')) Cloud.error = 'This Google account is not on the list yet. Ask for an invite link.';
    if (/sign in|signed out|allowed|invite/i.test(e.message)) setAuth(null);
  }
}

export async function signIn() {
  Cloud.error = null;
  const redirectTo = location.origin + location.pathname;
  const r = await post('action', 'auth:signIn', { provider: 'google', params: { redirectTo } });
  store(VERIFIER_KEY, r.verifier);
  location.href = r.redirect;
}

export async function signOut() {
  await pushProgress().catch(() => {});
  try { await call('action', 'auth:signOut', {}); } catch {}
  setAuth(null);
  location.reload(); // the email-scoped local save stays on this device for that account only
}

export const signedIn = () => !!Cloud.me;
export const pendingInvite = () => (hasStorage ? load(INVITE_KEY, null) : null);
// Admins: a one-time link that adds whoever signs in with it to the allowlist.
export async function createInviteLink(note) {
  const r = await call('mutation', 'invites:create', { note: note || undefined });
  return `${location.origin}${location.pathname}?invite=${r.code}`;
}
export const authToken = () => freshToken().catch(() => Cloud.auth?.token ?? null);
// Authenticated Convex call for other client modules (co-op: web/src/net/coopnet.js).
export const cloudCall = (kind, path, args, opts) => call(kind, path, args, opts);
export const packManifest = () => call('query', 'packs:manifest', {});

// Forget the session locally (e.g. the server refused this account's asset download).
export function dropAuth(message) { setAuth(null); Cloud.error = message || null; }

// ---- save sync ------------------------------------------------------------------------------
// The account's save on the server wins at sign-in; after that local saves are pushed up, only what changed and
// only at the moments web/src/net/savesync.js describes (v0.3.21; before, every save meant an upload).
const sync = new SaveSync({
  read: () => ({ meta: localStorage.getItem(Cloud.saveKeys.meta) || '{}', run: localStorage.getItem(Cloud.saveKeys.run) }),
  send: (parts, { keepalive }) => sendProgress(parts, keepalive),
  onError: (e) => { console.warn('progress sync failed', e); Cloud.online = false; },
});
if (typeof window !== 'undefined') window.__saveSync = sync; // (debug console / tests)

async function sendProgress(parts, keepalive) {
  if (!Cloud.me || !Cloud.saveKeys) return null;
  let r;
  try {
    r = await call('mutation', 'progress:put', parts, { keepalive });
  } catch (e) {
    if (!missingFn(e)) throw e;
    // a server from before progress:put: the whole save, the old way
    const { meta, run } = sync.read();
    r = await call('mutation', 'progress:save', { meta, run }, { keepalive });
    Object.assign(parts, { meta, run }); // (what it now has)
  }
  Cloud.online = true;
  return r;
}

async function pullProgress() {
  if (!Cloud.saveKeys) return;
  const p = await call('query', 'progress:get', {});
  if (p) {
    localStorage.setItem(Cloud.saveKeys.meta, p.meta);
    if (p.run) localStorage.setItem(Cloud.saveKeys.run, p.run); else localStorage.removeItem(Cloud.saveKeys.run);
    sync.base(p.meta, p.run || null);
  } else {
    sync.reset();
    await pushProgress();
  }
}

function pushProgress() {
  if (!Cloud.me || !Cloud.saveKeys) return Promise.resolve();
  return sync.flush();
}

// Called by the game after every save. mode: 'checkpoint' (push now: back on the map, a run's end) | 'defer'
// (no upload of its own: entering a node) | undefined (pushed within SYNC_DELAY).
export function queueProgressSync(mode) {
  if (!hasStorage || !Cloud.me || !Cloud.saveKeys) return;
  sync.queue(mode);
}
// Hiding the tab (switching apps on a phone, which may then kill it) or closing it: push what is left.
if (typeof addEventListener !== 'undefined') {
  const leave = () => { if (Cloud.me && Cloud.saveKeys) sync.flushNow(); };
  addEventListener('pagehide', leave);
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') leave(); });
}

// ---- finished runs --------------------------------------------------------------------------
export function pendingRuns() { return hasStorage ? load(queueKey(), []).length : 0; }

export async function rename(name) {
  const p = await call('mutation', 'players:rename', { name });
  Cloud.me = { ...Cloud.me, name: p.name };
  return p;
}

export function runPayload(run, result) {
  const s = run.stats || {};
  const n = k => +s[k] || 0;
  return {
    clientRunId: `${run.seed}-${s.startTime || 0}`,
    // A champion who carries on into the post-game and then blacks out still won the run.
    result: result === 'lose' && run.postgame ? 'win' : result,
    world: run.world || 'kanto',
    ...(run.world === 'spire' && spireCode(run.regions) ? { regions: spireCode(run.regions) } : {}), // "K-H-H-K" (v0.1.0)
    ascension: run.ascension || 0,
    act: (run.actIndex || 0) + 1,
    actName: run.act?.name || '',
    floor: Math.max(0, (run.floor ?? -1) + 1),
    starter: run.starter,
    party: run.party.map(m => ({ species: m.species, level: m.level || 1, shiny: !!m.shiny })),
    seed: String(run.seed),
    stats: {
      floors: n('floors'), battles: n('battles'), trainers: n('trainers'), caught: n('caught'), bestHand: n('bestHand'),
      crits: n('crits'), elites: n('elites'), bosses: n('bosses'), moneyEarned: n('moneyEarned'),
    },
    durationMs: Math.max(0, Date.now() - (s.startTime || Date.now())),
    finishedAt: Date.now(),
    version: VERSION, // the game version this run was played on
  };
}

// Called from endRun. Never throws; the game must not care whether the network is up.
export function queueRun(run, result) {
  if (!hasStorage || !run) return;
  try {
    const q = load(queueKey(), []);
    // the detailed log rides along in the queue and is uploaded separately (runlogs:submit)
    q.push({ ...runPayload(run, result), log: run.runLog ? JSON.stringify(run.runLog) : undefined });
    store(queueKey(), q.slice(-50));
    Cloud.lastResult = { status: 'queued' };
    flushQueue();
  } catch (e) { console.warn('queueRun failed', e); }
}

// ---- co-op team runs (v0.3.12) --------------------------------------------------------------
// A finished co-op room is ONE run in RECORDS (convex coop:finish; the host owns the row, the partners are listed):
// the team's party (the best floor(6/n) POKéMON by level of each player), the shared counts as the furthest anyone
// got, catches / crits / money summed, the best hand of anyone. game: the CoopGame at its end (phase victory / over).
export function coopRunPayload(game, { code = '' } = {}) {
  const runs = (game.runs || []).filter(Boolean), w = game.world || {};
  if (!runs.length) throw new Error('no runs');
  const result = game.phase === 'victory' || game.result === 'win' ? (w.act?.postgame ? 'postgame' : 'win') : 'lose';
  const per = runs.map(r => runPayload(r, result));
  const k = Math.max(1, Math.floor(6 / runs.length));
  const party = per.flatMap(p => p.party.map((m, i) => ({ m, i })).sort((a, b) => b.m.level - a.m.level || a.i - b.i).slice(0, k).map(x => x.m)).slice(0, 6);
  const all = (key) => per.map(p => p.stats[key] || 0);
  const max = (key) => Math.max(0, ...all(key)), sum = (key) => all(key).reduce((a, b) => a + b, 0);
  const regions = w.world === 'spire' || game.worldName === 'spire' ? spireCode(w.regions) : null;
  return {
    ...per[0],
    clientRunId: `coop-${code}`, // (the server sets it from the room)
    result,
    world: game.worldName || w.world || per[0].world,
    ...(regions ? { regions } : {}),
    ascension: game.ascension ?? w.ascension ?? per[0].ascension,
    act: (w.actIndex || 0) + 1,
    actName: w.act?.name || per[0].actName,
    floor: Math.max(0, (w.floor ?? -1) + 1),
    starter: runs[0].starter,
    party,
    coopParties: per.map(p => p.party), // every player's whole team (RECORDS shows one line per player)
    seed: String(game.seed ?? per[0].seed).slice(0, 32),
    stats: {
      floors: max('floors'), battles: max('battles'), trainers: max('trainers'), elites: max('elites'), bosses: max('bosses'),
      caught: sum('caught'), crits: sum('crits'), moneyEarned: sum('moneyEarned'), bestHand: max('bestHand'),
    },
    durationMs: Math.max(0, ...per.map(p => p.durationMs)),
  };
}

// Queues a finished co-op room for coop:finish (offline-safe, like queueRun: a reload on the end screen still sends
// it). Every client of the room does this; the server records the first and ignores the rest. -> flushQueue's promise
export function queueCoopRun(roomId, run) {
  if (!hasStorage || !roomId || !run) return Promise.resolve();
  try {
    const q = load(queueKey(), []);
    if (!q.some(e => e.kind === 'coop' && e.roomId === roomId)) q.push({ kind: 'coop', roomId, run });
    store(queueKey(), q.slice(-50));
    Cloud.lastResult = { status: 'queued' };
  } catch (e) { console.warn('queueCoopRun failed', e); }
  return flushQueue();
}

const entryKey = (e) => (e?.kind === 'coop' ? 'coop:' + e.roomId : e?.clientRunId);
const missingFn = (e) => /Could not find public function|No such function/i.test(String(e?.message || e));

let flushing = null;
export function flushQueue() {
  if (!Cloud.url || !Cloud.me) return Promise.resolve();
  flushing ??= (async () => {
    await null; // let the assignment land before the finally below can clear it
    try {
      // each entry once per flush (one an older server can't take yet, e.g. no coop:finish, stays queued for later)
      const tried = new Set();
      for (;;) {
        const q = load(queueKey(), []);
        const entry = q.find(e => !tried.has(entryKey(e)));
        if (!entry) break;
        tried.add(entryKey(entry));
        let r = null;
        if (entry.kind === 'coop') {
          r = await call('mutation', 'coop:finish', { roomId: entry.roomId, run: entry.run }).catch(e => {
            if (missingFn(e)) return null;
            // (a server from before v0.3.18 rejects the per-player teams: send the run without them)
            if (entry.run.coopParties && /coopParties/.test(String(e?.message || e))) { const { coopParties, ...run } = entry.run; return call('mutation', 'coop:finish', { roomId: entry.roomId, run }); }
            // (not a member any more, the room was deleted, or it never started: nothing to record)
            if (/Room not found|not in progress/i.test(String(e?.message || e))) { console.warn('co-op run not recorded:', e.message); return { dropped: true }; }
            throw e;
          });
          if (!r) continue;
        } else {
          const { log, ...run } = entry;
          // (a server without the v0.1.0 regions field rejects it: send the run without it rather than block the queue)
          r = await call('mutation', 'runs:submit', { run }).catch(e => {
            if (run.regions && /regions/.test(String(e?.message || e))) { const { regions, ...rest } = run; return call('mutation', 'runs:submit', { run: rest }); }
            throw e;
          });
          // Best effort: an older server without runlogs, or an oversized log, must not block the queue.
          if (log) await call('mutation', 'runlogs:submit', { clientRunId: run.clientRunId, log }).catch(e => console.warn('run log upload failed', e));
        }
        if (!r.dropped) Cloud.lastResult = { status: 'saved', score: r.score };
        store(queueKey(), load(queueKey(), []).filter(e => entryKey(e) !== entryKey(entry)));
      }
      Cloud.online = true;
    } catch (e) {
      console.warn('cloud submit failed', e);
      Cloud.lastResult = { status: 'error', message: e.message };
    } finally { flushing = null; }
  })();
  return flushing;
}

// version: a game version ('v0.0.2') to see only that version's records, or null for all of them.
export const leaderboard = (world, version, sort) => call('query', 'runs:leaderboard', { world: world || undefined, version: version || undefined, sort: sort || undefined, limit: 50 });
export const topTrainers = (version) => call('query', 'players:top', { version: version || undefined, limit: 50 });
export const myRuns = (version) => (Cloud.me ? call('query', 'runs:mine', { version: version || undefined, limit: 50 }) : Promise.resolve(null));
// The same lists, live while RECORDS shows them (a new run anywhere appears without a refresh). -> stop()
export const watchLeaderboard = (world, version, sort, cb, err) => subscribe('runs:leaderboard', { world: world || undefined, version: version || undefined, sort: sort || undefined, limit: 50 }, cb, err);
export const watchTopTrainers = (version, cb, err) => subscribe('players:top', { version: version || undefined, limit: 50 }, cb, err);
export const watchMyRuns = (version, cb, err) => subscribe('runs:mine', { version: version || undefined, limit: 50 }, cb, err);
