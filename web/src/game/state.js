// Global game state: the current run, persistent meta-progression and settings (localStorage).
import { Run, familyOf } from './run.js';
import { queueRun, queueProgressSync } from '../net/cloud.js';
import { migrateStarterMeta, migrateAscensionMeta, migrateSpireMeta, grantAscension } from './unlocks.js';
import { JOHTO_WINS } from './regions.js';

// Local save keys. When signed in, they are scoped to the account's email so two accounts on one
// browser never share (or overwrite) each other's save data and unlocks.
let scope = '';
export function setSaveScope(email) { scope = email ? ':' + String(email).trim().toLowerCase() : ''; }
export const saveKeys = { get meta() { return 'kantospire.meta.v1' + scope; }, get run() { return 'kantospire.run.v1' + scope; } };

export const G = {
  run: null,
  meta: null,
  coop: null, // the CoopSession while in an online co-op game (scenes/coop/session.js); solo saves are off then
};

const DEFAULT_META = {
  unlocks: {}, // act2, act3, win (also adds HOENN acts to the spire), johto (2 wins: JOHTO acts join, v0.1.1), a5, postgame, hoennWin
  // unlockedStarters / starterVer / starterOffers / starterClaims: see game/unlocks.js (set by loadMeta)
  maxAscension: 0, // highest ascension unlocked with any starter (a stat now: the gate is per starter)
  // ascBy / ascVer / lastAscBy: per-starter ascension unlocks and last picks (game/unlocks.js; set by loadMeta's
  // migration, so they must not be defaults here: an old save would look migrated)
  shinies: [], // starter families (base species) whose shiny form is unlocked: win a run at A5+ with it
  shinyOn: {}, // family -> true when the player picked the shiny form on the starter screen
  bestAscensionWon: -1,
  dexSeen: [], dexCaught: [],
  runs: [], // {date, starter, ascension, result, act, floor, party:[species], seed}
  totalWins: 0, totalRuns: 0,
  settings: { music: 0.35, sfx: 0.45, fast: false, stereo: true, vol2: true, audioQuality: 'hq', crt: 'off', crtCurve: true, display: 'fill' },
};

export function loadMeta() {
  try { G.meta = { ...structuredClone(DEFAULT_META), ...JSON.parse(localStorage.getItem(saveKeys.meta) || '{}') }; }
  catch { G.meta = structuredClone(DEFAULT_META); }
  const old = G.meta.settings || {};
  G.meta.settings = { ...DEFAULT_META.settings, ...old };
  // v0.3.17: FILL became the default SCREEN mode; anyone still on the old default (AUTO) moves to it once
  if (!old.display2) { if (!old.display || old.display === 'auto') G.meta.settings.display = 'fill'; G.meta.settings.display2 = true; }
  if (old.music !== undefined && !old.vol2) { G.meta.settings.music = Math.min(old.music, 0.35); G.meta.settings.sfx = Math.min(old.sfx ?? 1, 0.45); }
  // Starter unlock reset (v0.0.5): an old local save or cloud row (the cloud pull lands in localStorage
  // before this runs) starts over with the Kanto three; the rest of the progress is kept.
  // Ascension unlocks per starter (v0.0.6): rebuilt once from the run history. (No short-circuit: both run.)
  // One Spire (v0.1.0): players with HOENN access keep TREECKO / TORCHIC / MUDKIP (after the starter reset above).
  if (migrateStarterMeta(G.meta) | migrateAscensionMeta(G.meta) | migrateSpireMeta(G.meta)) saveMeta();
  return G.meta;
}
// sync: when the cloud copy follows (net/savesync.js): 'checkpoint' = now, 'defer' = with the next upload,
// undefined = within half a minute.
export function saveMeta(sync) { try { localStorage.setItem(saveKeys.meta, JSON.stringify(G.meta)); } catch {} queueProgressSync(sync); }

export function saveRun(sync) {
  if (!G.run || G.coop) return;
  try { localStorage.setItem(saveKeys.run, JSON.stringify(G.run)); } catch (e) { console.warn('save failed', e); }
  queueProgressSync(sync);
}
export function hasSavedRun() { return !!localStorage.getItem(saveKeys.run); }
export function loadRun() {
  try { const o = JSON.parse(localStorage.getItem(saveKeys.run)); if (!o) return null; G.run = Run.fromJSON(o); return G.run; }
  catch (e) { console.warn('load failed', e); return null; }
}
export function clearRun() { if (G.coop) return; localStorage.removeItem(saveKeys.run); queueProgressSync('checkpoint'); }

// Winning at Ascension 5+ unlocks the shiny form of the starter's evolution family. Returns the family
// if it was newly unlocked (cosmetic only; synced with the rest of meta by the cloud progress save).
export const SHINY_ASC = 5;
export function unlockShiny(run, meta = G.meta) {
  if (!run || run.coop || run.ascension < SHINY_ASC || !run.starter) return null;
  const fam = familyOf(run.starter);
  meta.shinies ||= [];
  if (meta.shinies.includes(fam)) return null;
  meta.shinies.push(fam);
  return fam;
}
export function shinyUnlocked(species, meta = G.meta) { return (meta?.shinies || []).includes(familyOf(species)); }

export function recordDex(run) {
  const m = G.meta;
  for (const s of run.seen) if (!m.dexSeen.includes(s)) m.dexSeen.push(s);
  for (const s of run.caughtSpecies) if (!m.dexCaught.includes(s)) m.dexCaught.push(s);
}

const LOG_KEY = 'kantospire.runlogs.v1';
// The last few finished runs' logs stay on this device (window.__runLogs() in the console dumps them).
export function storedRunLogs() { try { return JSON.parse(localStorage.getItem(LOG_KEY)) || []; } catch { return []; } }

export function endRun(run, result) {
  if (G.coop) return;
  const m = G.meta;
  const log = run.finishLog ? run.finishLog(result) : null;
  if (log) { try { localStorage.setItem(LOG_KEY, JSON.stringify([log, ...storedRunLogs()].slice(0, 20))); } catch {} }
  recordDex(run);
  m.totalRuns++;
  m.runs.unshift({ date: Date.now(), starter: run.starter, ascension: run.ascension, result, act: run.actIndex + 1, floor: run.floor, party: run.party.map(p => p.species), seed: run.seed, best: run.stats.bestHand });
  m.runs = m.runs.slice(0, 30);
  if (run.actIndex >= 1) m.unlocks.act2 = true;
  if (run.actIndex >= 2) m.unlocks.act3 = true;
  // hoennWin: a win in the legacy HOENN world, or a spire win that went through a HOENN act
  if ((result === 'win' || result === 'postgame') && (run.world === 'hoenn' || (run.regions?.acts || []).includes('hoenn'))) m.unlocks.hoennWin = true;
  if (result === 'win' || result === 'postgame') unlockShiny(run, m);
  if (result === 'win') {
    m.totalWins++;
    m.unlocks.win = true;
    m.bestAscensionWon = Math.max(m.bestAscensionWon, run.ascension);
    m.maxAscension = Math.max(m.maxAscension, Math.min(10, run.ascension + 1));
    grantAscension(m, run.starter, run.ascension);
    if (run.ascension >= 5) m.unlocks.a5 = true;
  }
  if (result === 'postgame') { if (run.ascension >= 5) m.unlocks.a5 = true; m.unlocks.postgame = true; m.totalWins++; m.unlocks.win = true; m.bestAscensionWon = Math.max(m.bestAscensionWon, run.ascension); m.maxAscension = Math.max(m.maxAscension, Math.min(10, run.ascension + 1)); grantAscension(m, run.starter, run.ascension); }
  // v0.1.1: the 2nd win adds JOHTO acts to the spire (regions.js johtoUnlocked)
  if ((m.totalWins || 0) >= JOHTO_WINS) m.unlocks.johto = true;
  saveMeta();
  queueRun(run, result);
  clearRun();
}
