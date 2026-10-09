// Cloud saves and records in Convex, over its plain HTTP API, behind Google sign-in (Convex Auth).
// Save data (meta-progression + the run in progress) is synced per account; finished runs are queued
// in localStorage first, so nothing is lost while offline.
import { spireCode } from '../game/regions.js';
import { VERSION } from '../game/version.js';

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

async function post(kind, path, args, token, keepalive = false) {
  if (!Cloud.url) throw new Error('Cloud saves are not configured.');
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
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

let refreshing = null;
async function freshToken() {
  if (!Cloud.auth) return null;
  if (tokenExpiry(Cloud.auth.token) - Date.now() > 60_000) return Cloud.auth.token;
  refreshing ??= post('action', 'auth:signIn', { refreshToken: Cloud.auth.refreshToken })
    .then(r => { setAuth(r.tokens || null); return Cloud.auth?.token ?? null; })
    .catch(e => { console.warn('token refresh failed', e); setAuth(null); return null; })
    .finally(() => { refreshing = null; });
  return refreshing;
}

async function call(kind, path, args, opts = {}) {
  const token = await freshToken();
  if (!token) throw new Error('Signed out. Sign in with Google again.');
  return post(kind, path, args, token, opts.keepalive);
}

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
    } catch (e) { Cloud.error = e.message; }
    store(VERIFIER_KEY, null);
  }
  if (!Cloud.auth) return;
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
export const authToken = () => freshToken();
// Authenticated Convex call for other client modules (co-op: web/src/net/coopnet.js).
export const cloudCall = (kind, path, args, opts) => call(kind, path, args, opts);
export const packManifest = () => call('query', 'packs:manifest', {});

// Forget the session locally (e.g. the server refused this account's asset download).
export function dropAuth(message) { setAuth(null); Cloud.error = message || null; }

// ---- save sync ------------------------------------------------------------------------------
// The account's save on the server wins at sign-in; after that every local save is pushed up.
async function pullProgress() {
  if (!Cloud.saveKeys) return;
  const p = await call('query', 'progress:get', {});
  if (p) {
    localStorage.setItem(Cloud.saveKeys.meta, p.meta);
    if (p.run) localStorage.setItem(Cloud.saveKeys.run, p.run); else localStorage.removeItem(Cloud.saveKeys.run);
  } else {
    await pushProgress();
  }
}

async function pushProgress(keepalive = false) {
  clearTimeout(pushTimer); pushTimer = null;
  if (!Cloud.me || !Cloud.saveKeys) return;
  const meta = localStorage.getItem(Cloud.saveKeys.meta) || '{}';
  const run = localStorage.getItem(Cloud.saveKeys.run);
  await call('mutation', 'progress:save', { meta, run }, { keepalive });
  Cloud.online = true;
}

let pushTimer = null;
// Called by the game after every save; batches bursts of saves into one upload.
export function queueProgressSync() {
  if (!hasStorage || !Cloud.me) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => pushProgress().catch(e => { console.warn('progress sync failed', e); Cloud.online = false; }), 1500);
}
if (typeof addEventListener !== 'undefined') {
  addEventListener('pagehide', () => { if (pushTimer) pushProgress(true).catch(() => {}); });
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
