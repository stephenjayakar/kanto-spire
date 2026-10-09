// NOW PLAYING: a light presence heartbeat while you are in a run, and the list of who else is playing
// (players:presence / players:nowPlaying in convex/players.ts). About one small write a minute while
// playing, one to clear it when you leave the run; nothing at all offline, signed out or on a server
// without these functions (the first "no such function" switches it off for the session).
import { Cloud, cloudCall } from './cloud.js';
import { Engine } from '../engine/core.js';
import { G } from '../game/state.js';
import { D } from '../game/data.js';

const CHECK_MS = 10_000;   // how often the activity is looked at (no network unless it changed or is due)
const BEAT_MS = 60_000;    // heartbeat while it stays the same (the server's "now" window is 3 minutes)
const MIN_GAP_MS = 15_000; // a changed activity (new act) goes out at most this often
const LIST_MS = 30_000;    // NOW PLAYING refresh while the title screen shows it

let started = false, off = false, sending = false;
let sent = null, sentAt = 0, triedAt = 0; // the key last sent ("" = cleared), when, and the last attempt
let list = null, listAt = 0, listing = false;

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

async function send(act) {
  const key = act ? act.what + '|' + (act.room || '') : '';
  sending = true; triedAt = Date.now();
  try {
    await cloudCall('mutation', 'players:presence', act ? { activity: act.what, ...(act.room ? { room: act.room } : {}) } : { activity: null });
    sent = key; sentAt = Date.now();
  } catch (e) {
    if (missing(e)) off = true; // an older server: stay quiet from now on (offline: retried after MIN_GAP_MS)
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
}

// The NOW PLAYING list for the title screen: the last fetched value (null = nothing yet / unavailable),
// refreshed in the background every LIST_MS while something keeps asking.
export function nowPlaying() {
  if (usable() && !listing && Date.now() - listAt >= LIST_MS) {
    listing = true; listAt = Date.now();
    cloudCall('query', 'players:nowPlaying', {})
      .then(r => { list = Array.isArray(r) ? r : null; })
      .catch(e => { if (missing(e)) off = true; })
      .finally(() => { listing = false; });
  }
  return list;
}

// Tests / screenshots: show this list without a server.
export function __setNowPlaying(l) { list = l; listAt = Date.now(); }
