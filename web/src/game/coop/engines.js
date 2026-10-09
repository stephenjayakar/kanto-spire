// Which code replays a co-op room's action log.
//
// A co-op room is its action log: every client replays it to rebuild the game. A log only replays correctly on the
// game logic it was played on, so a game update that changes any rule (a number, a starter, an RNG call...) would
// send an old room somewhere else (before v0.3.6 that is how saves got lost). Since v0.3.6:
//   - rooms save checkpoints (snapshot.js) at every return to the map, which load into any later code;
//   - every posted action is stamped with the LOGIC_ID that played it (and the game VERSION);
//   - a log (or the tail after a checkpoint) played on older logic replays on a frozen copy of that logic
//     (web/src/legacy/<id>/), then continues on the current code from its latest safe point (resume.js).
//
// WHEN YOU CHANGE GAME LOGIC (anything that can change co-op replay, i.e. any web/src/game change other than text):
// set LOGIC_ID to a new id (e.g. the version that ships it, 'v037'). Nothing else is needed: rooms with checkpoints
// load them; checkpoint-less rooms from before v0.3.6 replay on the frozen 'v035' engine. Freezing a copy of the
// outgoing logic as well (cp the game/ files listed in legacy/v035, add it to FROZEN) only matters for a room that
// is mid-node when the update lands: without it that node restarts from the map.
import { CoopGame } from './coop.js';
import { Run } from '../run.js';
import { RNG } from '../rng.js';

// The logic generation of THIS code (v0.3.6 changed no game logic; v0.3.7 did: move rewards, REST, KING'S ROCK, item damage;
// v0.3.8-v0.3.10 didn't; v0.3.11 did: foes stop self-KO moves, two legendaries at a co-op legendary node, shipped as
// v0.3.14; v0.3.15-v0.3.18 didn't; v0.3.19 did: PROTECT / DETECT / ENDURE only move a hand first when they succeed).
// (Further logic changes for the same release fold into this id; once it ships, the next change needs a new one.)
export const LOGIC_ID = 'v0319';
// Actions from before v0.3.6 carry no stamp: they were played on v0.3.5 (or, for older rooms, earlier; the
// replay checks the clients' logged checksums and tries every frozen engine, see resume.js).
export const UNSTAMPED = 'v035';
// Frozen copies, newest first: id -> the versions it covers and its loader (dynamic import: only fetched when a
// room needs it).
export const FROZEN = {
  v0311: { versions: 'v0.3.14-v0.3.18', load: () => import('../../legacy/v0311/engine.js') },
  v037: { versions: 'v0.3.7-v0.3.10', load: () => import('../../legacy/v037/engine.js') },
  v035: { versions: 'v0.3.5-v0.3.6', load: () => import('../../legacy/v035/engine.js') },
  v031: { versions: 'v0.3.1', load: () => import('../../legacy/v031/engine.js') },
};

export const CURRENT = { id: LOGIC_ID, current: true, CoopGame, Run, RNG };

const loaded = new Map();
// which: { id, current } from engineOrder (or a frozen id). -> { id, current, CoopGame, Run, RNG } or null.
// dataLoader(file) -> parsed JSON from web/assets/data: a frozen engine has its own copy of the game data module
// (its indexData() is part of its logic), loaded once.
export async function getEngine(which, dataLoader) {
  const { id, current } = typeof which === 'string' ? { id: which, current: false } : which;
  if (current) return { ...CURRENT, id };
  const f = FROZEN[id];
  if (!f) return null;
  if (!loaded.has(id)) {
    loaded.set(id, (async () => {
      const m = await f.load();
      await m.loadData(dataLoader);
      return { id, current: false, CoopGame: m.CoopGame, Run: m.Run, RNG: m.RNG };
    })().catch(e => { loaded.delete(id); throw e; }));
  }
  return loaded.get(id);
}

// The engines to try for a log segment stamped `stamp`, best guess first: [{ id, current }]. The current code when
// the stamp is its own logic id, the stamp's frozen copy, the current code, then every other frozen copy. (The
// frozen copy of the current id comes right after the current code: it still matches the log if someone changed
// the logic without bumping LOGIC_ID.) logicId: the current logic id (tests pretend a later one).
export function engineOrder(stamp, logicId = LOGIC_ID) {
  const out = [];
  const add = (id, current) => { if (!out.some(e => e.id === id && e.current === current)) out.push({ id, current }); };
  if (stamp === logicId) add(logicId, true);
  if (FROZEN[stamp]) add(stamp, false);
  add(logicId, true);
  for (const id of Object.keys(FROZEN)) add(id, false);
  return out;
}
