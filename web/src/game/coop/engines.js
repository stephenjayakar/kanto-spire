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
// v0.3.14; v0.3.15-v0.3.18 didn't; v0.3.19 did: PROTECT / DETECT / ENDURE only move a hand first when they succeed;
// v0.3.20-v0.3.22 didn't; v0.3.23 did: after a FLY / DIG / DIVE / BOUNCE dodge the lead is LANDING for a turn; v0.3.24
// didn't; v0.4.0 does: HOENN trainers use Pokemon EMERALD's teams, CHAMPION WALLACE's rule, STEVEN in the SKY PILLAR act;
// every Pokedex species is catchable (wild pools, rare finds); one legendary per run and the mythic events; and all of
// Gen 4: its 107 species in the wild pools, their evolutions (and the Gen 1-3 lines' new ones), the new stones, the
// Gen 4 legendaries as rare legendary elites. (Worked on as 'v0325', which never shipped: nothing to freeze for it.)
// (Further logic changes for the same release fold into this id; once it ships, the next change needs a new one.)
// v0.5.0 does: every ability does something (docs/ABILITIES_PROPOSAL.md), the Gen 4
// species use their HGSS abilities, your POKéMON can flinch; v0.4.0-v0.4.7 is frozen as 'v040'.
// v0.5.1 does: LEADER NORMAN's SLACK OFF is split between co-op players (and softened). v0.5.0 is NOT frozen on purpose:
// a room mid-node in v0.5.0 (e.g. stuck in the broken NORMAN fight) restarts that node from the map on the fixed rules.
// v0.5.2 does: LEADER NORMAN's BALANCE (every hand capped) replaces SLACK OFF, a lead sent in after a faint can't be hit
// by moves still resolving that turn, no FLY / DIG / DIVE / BOUNCE two turns in a row (foes too), and at a co-op
// legendary node each player gets the held item of the legendary they catch; v0.5.1 is frozen as 'v051'.
// v0.5.3 does: BRAWLY's BULK UP every other turn (per player in co-op); v0.5.2 is frozen as 'v052'.
// v0.5.6 does: a player may sit out a mythic "?" fight (privateDone sitOut), ESCAPE ROPE (and POKé DOLL / FLUFFY TAIL in
// wild battles) gets the whole room out of a co-op battle, and the mythics have their own held items; v0.5.3-v0.5.5 is
// frozen as 'v053'.
// v0.5.7 does: a foe's own CHARGE doubles its next ELECTRIC move, ROAR / WHIRLWIND fail if the same POKéMON made them work
// last turn, foes skip status moves that would do nothing; v0.5.6 is frozen as 'v056'.
// v0.5.8 does: VETERAN (a per-turn damage cap and an ATTACK / SP. ATK ramp) on LEADER KOGA, GIOVANNI, CHUCK, JASMINE and
// ELITE FOUR SIDNEY, and SABRINA's foes no longer hit 15% softer; v0.5.7 is frozen as 'v057'.
// v0.5.13 does: A10 runs end with a second ELITE FOUR + CHAMPION from another region (run.summit2, a full heal before
// it); v0.5.8-v0.5.12 is frozen as 'v058'.
// v0.5.14 does: NUZLOCKE co-op rooms (init.nuzlocke, the host's lobby option): fainted POKéMON are released, one catch per
// act per player, a player with no POKéMON left is out for good; v0.5.13 is frozen as 'v0513'.
// v0.5.16 does: a foe acting twice in a turn (3-4 players) checks sleep / freeze once per turn (asleep on its first
// action = asleep on all of them), and no level-up source passes the act's level cap; v0.5.14-v0.5.15 is frozen as 'v0514'.
// v0.5.17 does: the A5+ level cap's offset is per act (+2 / +1 / 0 / 0 in acts 1-4, +2 post-game); v0.5.16 is frozen as 'v0516'.
// v0.5.18 does: the A5+ level cap ignores A10's +1 enemy level (A10+ caps equal A5's); v0.5.17 is frozen as 'v0517'.
export const LOGIC_ID = 'v0518';
// Actions from before v0.3.6 carry no stamp: they were played on v0.3.5 (or, for older rooms, earlier; the
// replay checks the clients' logged checksums and tries every frozen engine, see resume.js).
export const UNSTAMPED = 'v035';
// Frozen copies, newest first: id -> the versions it covers and its loader (dynamic import: only fetched when a
// room needs it).
export const FROZEN = {
  v0517: { versions: 'v0.5.17', load: () => import('../../legacy/v0517/engine.js') },
  v0516: { versions: 'v0.5.16', load: () => import('../../legacy/v0516/engine.js') },
  v0514: { versions: 'v0.5.14-v0.5.15', load: () => import('../../legacy/v0514/engine.js') },
  v0513: { versions: 'v0.5.13', load: () => import('../../legacy/v0513/engine.js') },
  v058: { versions: 'v0.5.8-v0.5.12', load: () => import('../../legacy/v058/engine.js') },
  v057: { versions: 'v0.5.7', load: () => import('../../legacy/v057/engine.js') },
  v056: { versions: 'v0.5.6', load: () => import('../../legacy/v056/engine.js') },
  v053: { versions: 'v0.5.3-v0.5.5', load: () => import('../../legacy/v053/engine.js') },
  v052: { versions: 'v0.5.2', load: () => import('../../legacy/v052/engine.js') },
  v051: { versions: 'v0.5.1', load: () => import('../../legacy/v051/engine.js') },
  v040: { versions: 'v0.4.0-v0.4.7', load: () => import('../../legacy/v040/engine.js') },
  v0323: { versions: 'v0.3.23-v0.3.24', load: () => import('../../legacy/v0323/engine.js') },
  v0319: { versions: 'v0.3.19-v0.3.22', load: () => import('../../legacy/v0319/engine.js') },
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
