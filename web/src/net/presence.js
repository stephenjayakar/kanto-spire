// NOW PLAYING: a light activity keepalive while you are in a run, and the live list of who else is playing
// (players:activity / players:nowPlayingLive in convex/players.ts, staging-net). About one small write a minute
// while playing, one to clear it when you leave the run or close the tab; nothing at all offline or signed out.
// The title screen's list is a subscription: it changes when someone starts, stops or sends their keepalive, and is
// never fetched again on a timer. (A server without these functions: the older players:presence keepalive, no list.)
import { Cloud, cloudCall, subscribe } from './cloud.js';
import { Engine } from '../engine/core.js';
import { G } from '../game/state.js';
import { D } from '../game/data.js';

const CHECK_MS = 10_000;   // how often the activity is looked at, locally (no network unless it changed or is due)
const BEAT_MS = 60_000;    // keepalive while it stays the same (the server's "now" window is 3 minutes)
const MIN_GAP_MS = 15_000; // a changed activity (new act) goes out at most this often
const WINDOW_MS = 3 * 60_000; // (convex/players.ts NOW_WINDOW_MS) a group whose newest keepalive is older is hidden

let started = false, off = false, sending = false, legacy = false;
let sent = null, sentAt = 0, triedAt = 0; // the key last sent ("" = cleared), when, and the last attempt
let list = null, stopList = null, skew = 0; // the live list, its subscription, server clock - ours (from our keepalives)

const missing = (e) => /could not find|not found|no such|unknown function/i.test(String(e?.message || e));
const usable = () => !off && !!Cloud.url && !!Cloud.me;

// What you are doing right now, as { what, room } (room: the co-op room code), or null when not in a run.
// Scenes that are not part of a run (title, starter pick, records, Pokédex, co-op lobby) set `idle`.
export function currentActivity() {
  const scene = Engine.scene;
  if (!scene || scene.idle) return null;
  const s = G.coop;
  if (s) {
    const w = s.game?.world;
    if (s.stopped || !w) return null;
    return { what: `CO-OP ACT ${(w.actIndex || 0) + 1}`, room: s.code || undefined };
  }
  const run = G.run;
  if (!run || !run.party?.length) return null;
  const starter = D.species?.[run.starter]?.name || run.starter || '';
  return { what: `ACT ${(run.actIndex || 0) + 1} ${starter}${run.ascension ? ' A' + run.ascension : ''}`.trim() };
}

async function send(act, { keepalive = false } = {}) {
  const key = act ? act.what + '|' + (act.room || '') : '';
  const args = act ? { activity: act.what, ...(act.room ? { room: act.room } : {}) } : { activity: null };
  sending = true; triedAt = Date.now();
  try {
    let r;
    if (!legacy) {
      try { r = await cloudCall('mutation', 'players:activity', args, { keepalive }); }
      catch (e) { if (!missing(e)) throw e; legacy = true; }
    }
    if (legacy) r = await cloudCall('mutation', 'players:presence', args, { keepalive });
    if (typeof r === 'number') skew = r - Date.now();
    sent = key; sentAt = Date.now();
  } catch (e) {
    if (missing(e)) off = true; // an older server still: stay quiet from now on (offline: retried after MIN_GAP_MS)
  } finally { sending = false; }
}

function check() {
  if (!usable() || sending) return;
  if (typeof document !== 'undefined' && document.hidden) return; // a run left open in a background tab ages out
  const act = currentActivity();
  const key = act ? act.what + '|' + (act.room || '') : '';
  const now = Date.now();
  if (now - triedAt < MIN_GAP_MS) return;
  if (!act) {
    if (sent) send(null); // left the run: drop off the list now rather than in 3 minutes
    return;
  }
  if (key !== sent || now - sentAt >= BEAT_MS) send(act);
}

// Called once at boot (main.js), after sign-in.
export function startPresence() {
  if (started || typeof setInterval === 'undefined') return;
  started = true;
  setInterval(check, CHECK_MS);
  check();
  // closing the tab mid-run: off the list at once (fetch keepalive: the socket dies with the page)
  if (typeof addEventListener !== 'undefined') addEventListener('pagehide', () => { if (usable() && sent) send(null, { keepalive: true }); });
}

// The NOW PLAYING list for the title screen (null = nothing yet / unavailable). The first call subscribes;
// stopNowPlaying() (the title's exit) unsubscribes. Groups whose newest keepalive is older than the window are left out
// here, by the clock: the server can't push "time passed".
export function nowPlaying() {
  if (usable() && !stopList) {
    // (since: rounded down to the minute, so tabs and re-entries share one server-side query)
    const since = Math.floor((Date.now() + skew - WINDOW_MS) / 60_000) * 60_000;
    stopList = subscribe('players:nowPlayingLive', { since }, (r) => { list = Array.isArray(r) ? r : null; }, (e) => { if (missing(e)) { list = null; } });
  }
  if (!list) return list;
  const now = Date.now() + skew;
  return list.filter(g => !g.seen || now - g.seen < WINDOW_MS);
}
export function stopNowPlaying() { try { stopList?.(); } catch {} stopList = null; }

// Tests / screenshots: show this list without a server.
export function __setNowPlaying(l) { list = l; }
