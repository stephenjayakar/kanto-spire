// Saves survive updates (v0.3.6): co-op checkpoints, resume, the frozen legacy engines, SAVE & QUIT, old solo saves.
//   node tests/saves.test.mjs
// Optional, local only: COOP_EXPORT=<dir with coopRooms.json + coopActions.jsonl from `convex data`> also resumes
// real rooms from that export (OWNER_ROOMS=CODE:act,CODE:act lists the rooms to check and the act each must land in).
import fs from 'fs';
import path from 'path';
import assert from 'assert/strict';
import { loadData } from '../web/src/game/data.js';
import { Run } from '../web/src/game/run.js';
import { CoopGame } from '../web/src/game/coop/coop.js';
import { COOP_TUNING } from '../web/src/game/coop/tuning.js';
import { snapshotGame, restoreGame, isSafePoint } from '../web/src/game/coop/snapshot.js';
import { LOGIC_ID, UNSTAMPED, CURRENT, FROZEN, engineOrder, getEngine } from '../web/src/game/coop/engines.js';
import { resumeRoom, replayOn, segmentStamp } from '../web/src/game/coop/resume.js';
import { VERSION } from '../web/src/game/version.js';
import { coopPlayer, playSoloNodes } from './save_helpers.mjs';
import { RNG } from '../web/src/game/rng.js';
import { diff, patch, encodePrivateDone, expandAction } from '../web/src/game/coop/wire.js';

const dataLoader = async f => JSON.parse(fs.readFileSync('web/assets/data/' + f, 'utf8'));
await loadData(dataLoader);
const fixture = (f) => JSON.parse(fs.readFileSync('tests/fixtures/' + f, 'utf8'));
let pass = 0, fail = 0;
const tests = [];
const t = (name, fn) => tests.push([name, fn]);
const clone = (x) => JSON.parse(JSON.stringify(x));
const STAMP = { v: VERSION, eng: LOGIC_ID };
const INIT = (seed, n = 2, world = 'spire_johto') => ({ type: 'init', p: -1, seed, ascension: 0, world, starters: ['BULBASAUR', 'CHARMANDER', 'SQUIRTLE', 'PIKACHU'].slice(0, n), names: ['A', 'B', 'C', 'D'].slice(0, n) });
const facts = (g) => ({ act: g.world.actIndex, node: g.world.nodeId, floor: g.world.floor, phase: g.phase, teams: g.runs.map(r => r.party.map(m => `${m.species}:${m.level}:${m.hp}`)), money: g.runs.map(r => r.money) });

// A game update that changes co-op logic (here: every co-op foe has more HP), for as long as fn runs.
async function changedLogic(fn, factor = 1.37) {
  const old = COOP_TUNING.hpComp;
  COOP_TUNING.hpComp = (old ?? 1) * factor;
  try { return await fn(); } finally { COOP_TUNING.hpComp = old; }
}
// A stamped 2-4 player bot game: { game, log, cks (checksum after each action, by seq) }
// Game: any engine's CoopGame (default: the current code's).
function botGame(seed, { n = 2, stop = null, stamp = STAMP, max = 20000, Game = CoopGame } = {}) {
  const game = new Game();
  const P = coopPlayer(game, seed, stamp);
  P.post(INIT(seed, n));
  const cks = new Map([[1, game.checksum() >>> 0]]);
  let k = 0;
  while (k++ < max && !(stop && stop(game))) { if (!P.step()) break; cks.set(game.seq, game.checksum() >>> 0); }
  return { game, log: P.log, cks };
}
const replayAll = (log) => { const g = new CoopGame(); for (const a of log) g.apply(clone(a)); return g; };
const cpRow = (g) => ({ seq: g.seq, phase: 'map', state: JSON.stringify(snapshotGame(g)), checksum: g.checksum() >>> 0, gameVersion: VERSION, engine: LOGIC_ID });

// ------------------------------------------------------------------------------------- checkpoints
t('checkpoint round trip: at every safe point the restored game has the same checksum and replays the rest identically', () => {
  for (const [seed, n, max] of [['RT1', 2, 900], ['RT2', 3, 1600], ['RT3', 4, 1600]]) {
    const { log, cks } = botGame(seed, { n, max });
    const g = new CoopGame();
    let points = 0;
    for (let i = 0; i < log.length; i++) {
      g.apply(clone(log[i]));
      if (!isSafePoint(g)) continue;
      const r = restoreGame(JSON.parse(JSON.stringify(snapshotGame(g))), CURRENT);
      assert.equal(r.checksum() >>> 0, g.checksum() >>> 0, `${seed}: checksum after restore at #${g.seq}`);
      assert.equal(r.n, n);
      for (let k = i + 1; k < Math.min(log.length, i + 61); k++) {
        r.apply(clone(log[k]));
        assert.equal(r.checksum() >>> 0, cks.get(log[k].seq), `${seed}: restored at #${g.seq} drifts at #${log[k].seq} (${log[k].type})`);
      }
      points++;
    }
    assert.ok(points >= (n === 2 ? 10 : 3), `${seed}: only ${points} safe points`);
  }
});

t('checkpoint: a restored game plays on to the end exactly like the original', () => {
  const { game, log } = botGame('RT4', { max: 6000 });
  const at = log.findIndex((a, i) => i > Math.min(200, log.length / 2) && isSafePoint(replayAll(log.slice(0, i + 1))));
  const g = replayAll(log.slice(0, at + 1));
  const r = restoreGame(JSON.parse(JSON.stringify(snapshotGame(g))), CURRENT);
  for (const a of log.slice(at + 1)) r.apply(clone(a));
  assert.equal(r.checksum(), game.checksum());
  assert.equal(r.phase, game.phase);
});

t('snapshotGame refuses anything but the map (no mid-battle checkpoints)', () => {
  const { game } = botGame('MB', { stop: g => g.phase === 'battle' });
  assert.equal(game.phase, 'battle');
  assert.throws(() => snapshotGame(game), /safe point/);
  assert.equal(isSafePoint(game), false);
});

// ------------------------------------------------------------------------------------------ resume
t('resume: checkpoint + tail lands exactly where the players were (even mid-battle)', async () => {
  const { game, log, cks } = botGame('RS1', { max: 700, stop: g => g.seq > 40 && g.phase === 'battle' });
  assert.equal(game.phase, 'battle');
  // the latest safe point before the end
  let S = null;
  { const g = new CoopGame(); for (const a of log) { g.apply(clone(a)); if (isSafePoint(g)) S = cpRow(g); } }
  const res = await resumeRoom({ checkpoint: S, actions: log.filter(a => a.seq > S.seq), dataLoader });
  assert.equal(res.mode, 'checkpoint');
  assert.equal(res.engine, LOGIC_ID);
  assert.equal(res.seq, game.seq);
  assert.equal(res.game.checksum() >>> 0, cks.get(game.seq));
  assert.equal(res.game.phase, 'battle');
  assert.equal(res.safe, null, 'nothing newer to save');
  // and without a checkpoint: the whole log
  const full = await resumeRoom({ actions: log, dataLoader });
  assert.equal(full.mode, 'replay');
  assert.equal(full.game.checksum() >>> 0, cks.get(game.seq));
  assert.equal(full.safe.seq, S.seq, 'first resume of a checkpoint-less room offers its latest safe point as the first checkpoint');
  // a checkpoint with no tail
  const only = await resumeRoom({ checkpoint: S, actions: [], dataLoader });
  assert.equal(only.mode, 'checkpoint');
  assert.equal(only.game.checksum() >>> 0, S.checksum);
});

t('resume: a tail that no longer replays falls back to the checkpoint (start of that node), never further back', async () => {
  // a room played on logic none of the engines has (X), resumed on yet another logic (Y)
  const X = 1.37, Y = 0.77;
  const { game: g0, log, seqs } = await changedLogic(() => {
    const r = botGame('RS2', { max: 900, stop: g => g.seq > 60 && g.phase === 'battle' && g.battle.turn >= 2 });
    const seqs = [];
    const g = new CoopGame(); for (const a of r.log) { g.apply(clone(a)); if (isSafePoint(g)) seqs.push([g.seq, cpRow(g), facts(g)]); }
    return { ...r, seqs };
  }, X);
  assert.equal(g0.phase, 'battle');
  const [S, row, at] = seqs[seqs.length - 1];
  const T = log[log.length - 1].seq;
  // (a) the update changed the logic: the tail's checksums stop agreeing
  const res = await changedLogic(() => resumeRoom({ checkpoint: row, actions: log.filter(a => a.seq > S), dataLoader }), Y);
  assert.ok(res.tried.length >= 3 && res.tried.every(x => !x.ok), 'no engine replays it: ' + JSON.stringify(res.tried));
  assert.equal(res.mode, 'fallback');
  assert.equal(res.seq, T);
  assert.equal(res.game.seq, T, 'placed at the end of the log, so new actions follow it');
  assert.equal(res.dropped, T - S);
  assert.deepEqual(facts(res.game), at, 'the game as it was at the checkpoint');
  assert.equal(res.safe.seq, T, 'the fallback is stored as the new checkpoint');
  // (b) every player's checksums disagree (on the logic it was played on): the same fallback
  const bad = clone(log.filter(a => a.seq > S));
  for (const a of bad) if (a.ck != null && a.atSeq > S) a.ck = (a.ck + 1) >>> 0;
  const res2 = await changedLogic(() => resumeRoom({ checkpoint: row, actions: bad, dataLoader }), X);
  assert.ok(res2.mode === 'fallback' && res2.game.phase === 'map' && res2.game.seq === T, res2.mode);
  assert.deepEqual(facts(res2.game), at);
  // (b2) only one player's client drifted (a desync on the same code): the replay of the log still stands
  const drift = clone(log.filter(a => a.seq > S));
  const p0 = drift.find(a => a.ck != null && a.atSeq > S).p;
  for (const a of drift) if (a.p === p0 && a.ck != null && a.atSeq > S) a.ck = (a.ck + 1) >>> 0;
  const res3 = await changedLogic(() => resumeRoom({ checkpoint: row, actions: drift, dataLoader }), X);
  assert.equal(res3.mode, 'checkpoint', JSON.stringify(res3.tried));
  assert.equal(res3.game.checksum(), g0.checksum(), 'the canonical replay');
  // (c) play goes on from the fallback (on the new logic)
  await changedLogic(() => {
    const g = res.game, P = coopPlayer(g, 'RS2b', STAMP);
    assert.ok(P.until(x => x.phase !== 'map'), 'a vote starts the node again');
    assert.ok(P.until(x => x.phase === 'map' || x.phase === 'over', 4000));
  }, Y);
});

// A room played on v0.3.6 (logic v035, stamped), resumed on this code (v0.3.7+: LOGIC_ID moved on).
const V036 = { v: 'v0.3.6', eng: 'v035' };
t('resume: a v0.3.6 room mid-battle replays on the frozen v035 engine and hands over on the map', async () => {
  assert.notEqual(LOGIC_ID, 'v035');
  const Game = (await getEngine('v035', dataLoader)).CoopGame;
  const { game, log } = botGame('RS4', { max: 900, stop: g => g.seq > 60 && g.phase === 'battle' && g.battle.turn >= 2, stamp: V036, Game });
  assert.equal(game.phase, 'battle');
  const res = await changedLogic(() => resumeRoom({ actions: log, dataLoader })); // (whatever the current logic is)
  assert.equal(res.mode, 'legacy');
  assert.equal(res.engine, 'v035');
  assert.equal(res.game.phase, 'map');
  assert.ok(res.dropped > 0);
});

// A room played on v0.3.7-v0.3.10 (logic v037, stamped), resumed on this code (v0.3.11: foes and self-KO moves,
// co-op legendary pairs).
const V0310 = { v: 'v0.3.10', eng: 'v037' };
t('resume: a v0.3.10 room mid-battle replays on the frozen v037 engine and hands over on the map', async () => {
  assert.notEqual(LOGIC_ID, 'v037');
  const Game = (await getEngine('v037', dataLoader)).CoopGame;
  const { game, log, cks } = botGame('RS37', { max: 900, stop: g => g.seq > 60 && g.phase === 'battle' && g.battle.turn >= 2, stamp: V0310, Game });
  assert.equal(game.phase, 'battle');
  const res = await resumeRoom({ actions: log, dataLoader });
  assert.equal(res.mode, 'legacy');
  assert.equal(res.engine, 'v037');
  assert.equal(res.stamp, 'v037');
  assert.equal(res.game.phase, 'map');
  assert.ok(res.game instanceof CoopGame, 'handed to the current code');
  assert.ok(res.dropped > 0, 'the battle in progress restarts from the map');
  // the hand-over is the latest safe point of the old game: same teams as the frozen engine had there
  let S = null;
  { const g = new Game(); for (const a of log) { g.apply(clone(a)); if (isSafePoint(g)) S = facts(g); } }
  const f = facts(res.game);
  assert.deepEqual({ act: f.act, node: f.node, teams: f.teams, money: f.money }, { act: S.act, node: S.node, teams: S.teams, money: S.money });
  assert.equal(cks.get(game.seq), game.checksum() >>> 0);
  // and it plays on, on this code
  const P = coopPlayer(res.game, 'RS37b', STAMP);
  assert.ok(P.until(x => x.phase !== 'map'));
  assert.ok(P.until(x => x.phase === 'map' || x.phase === 'over', 4000));
});

t('resume: a v0.3.10 checkpoint (written on logic v037) loads on this code and plays on', async () => {
  const Game = (await getEngine('v037', dataLoader)).CoopGame;
  const { game } = botGame('CP37', { max: 3000, stop: g => g.seq > 120 && isSafePoint(g), stamp: V0310, Game });
  assert.ok(isSafePoint(game));
  const row = { seq: game.seq, phase: 'map', state: JSON.stringify(snapshotGame(game)), checksum: game.checksum() >>> 0, gameVersion: 'v0.3.10', engine: 'v037' };
  const res = await resumeRoom({ checkpoint: row, actions: [], dataLoader });
  assert.equal(res.mode, 'checkpoint');
  assert.deepEqual(facts(res.game), facts(game), 'same place, same teams');
  const P = coopPlayer(res.game, 'CP37b', STAMP);
  assert.ok(P.until(x => x.phase !== 'map'));
  assert.ok(P.until(x => x.phase === 'map' || x.phase === 'over', 4000), 'back on the map after the node');
});

t('resume: a finished game stays finished after a logic change (no hand-over back to the map)', async () => {
  const Game = (await getEngine('v035', dataLoader)).CoopGame;
  const { game, log } = botGame('FIN', { max: 30000, stamp: V036, Game });
  assert.ok(['over', 'victory'].includes(game.phase), game.phase);
  const res = await resumeRoom({ actions: log, dataLoader });
  assert.equal(res.mode, 'legacy');
  assert.equal(res.game.phase, game.phase);
  assert.equal(res.safe, null);
});

t('resume: an unusable checkpoint is refused (the caller replays the whole log); unverifiable replays are flagged', async () => {
  await assert.rejects(resumeRoom({ checkpoint: { seq: 5, state: '{bad json' }, actions: [], dataLoader }), /Unusable checkpoint/);
  const fx = fixture('coop_log_v035.json');
  // a log no engine reproduces (every checksum off): best effort, not stored as a checkpoint
  const off = fx.log.map(a => (a.ck != null ? { ...a, ck: (a.ck + 7) >>> 0 } : a));
  const res = await resumeRoom({ actions: off, dataLoader });
  assert.equal(res.mode, 'unverified');
  assert.equal(res.verified, false);
  assert.equal(res.safe, null);
});

t('checkpoint keeps the act clears (starter offers) outside the checksum', () => {
  const fx = fixture('coop_log_v035.json');
  const g = replayAll(fx.log.slice(0, fx.safe.seq));
  assert.ok(isSafePoint(g) && g.world.actIndex === 1);
  const r = restoreGame(snapshotGame(g), CURRENT);
  assert.deepEqual(r.events.filter(e => e.t === 'actClear').map(e => e.act), [1]);
  assert.equal(r.checksum(), g.checksum());
});

t('resume: unverifiable rooms (no checksums) replay as before', async () => {
  const { log, game } = botGame('RS3', { max: 200 });
  const plain = log.map(({ ck, atSeq, ...a }) => a);
  const res = await resumeRoom({ actions: plain, dataLoader });
  assert.equal(res.mode, 'replay');
  assert.equal(res.game.checksum(), game.checksum());
});

// ------------------------------------------------------------------------------------- legacy engine
t('engines: selection is explicit (stamp first, then the current code, then the other frozen copies)', () => {
  assert.equal(LOGIC_ID, 'v0323', 'v0.3.23 changed game logic (FLY-family dodges are followed by a LANDING turn)');
  assert.equal(UNSTAMPED, 'v035');
  assert.deepEqual(Object.keys(FROZEN), ['v0319', 'v0311', 'v037', 'v035', 'v031'], 'newest first');
  const ids = (l) => l.map(e => (e.current ? 'current:' : '') + e.id);
  // a room stamped by an older logic goes to its own frozen copy first, then the current code, then the rest
  assert.deepEqual(ids(engineOrder('v0319')), ['v0319', 'current:v0323', 'v0311', 'v037', 'v035', 'v031']);
  assert.deepEqual(ids(engineOrder('v0311')), ['v0311', 'current:v0323', 'v0319', 'v037', 'v035', 'v031']);
  assert.deepEqual(ids(engineOrder('v037')), ['v037', 'current:v0323', 'v0319', 'v0311', 'v035', 'v031']);
  assert.deepEqual(ids(engineOrder('v035')), ['v035', 'current:v0323', 'v0319', 'v0311', 'v037', 'v031']);
  assert.deepEqual(ids(engineOrder('v0323')), ['current:v0323', 'v0319', 'v0311', 'v037', 'v035', 'v031']);
  assert.deepEqual(ids(engineOrder('zzz')), ['current:v0323', 'v0319', 'v0311', 'v037', 'v035', 'v031']);
  // under the older ids (what those versions did)
  assert.deepEqual(ids(engineOrder('v0311', 'v0319')), ['v0311', 'current:v0319', 'v0319', 'v037', 'v035', 'v031']);
  assert.deepEqual(ids(engineOrder('v037', 'v0311')), ['v037', 'current:v0311', 'v0319', 'v0311', 'v035', 'v031']);
  assert.equal(segmentStamp([{ p: -1, type: 'init' }, { p: 0, type: 'vote' }]), 'v035', 'unstamped = v0.3.5');
  assert.equal(segmentStamp([{ p: 0, type: 'vote', eng: 'v037' }, { p: 1, type: 'vote', eng: 'v037' }, { p: 1, eng: 'v035' }]), 'v037');
  for (const id of Object.keys(FROZEN)) assert.ok(fs.existsSync(`web/src/legacy/${id}/engine.js`), id);
});

t('legacy: frozen v035 is v0.3.5: it replays a v0.3.5 log with every checksum agreeing', async () => {
  const fx = fixture('coop_log_v035.json');
  const eng = await getEngine('v035', dataLoader);
  assert.equal(eng.current, false);
  const r = replayOn(eng, null, fx.log);
  assert.ok(r.ok, JSON.stringify(r.bad));
  assert.ok(r.checks > 200, 'the log is checked: ' + r.checks);
  assert.equal(r.game.checksum() >>> 0, fx.final.checksum);
  if (LOGIC_ID === fx.logic) assert.equal(replayAll(fx.log).checksum() >>> 0, fx.final.checksum, 'and so is the current code (same logic)');
});

t('legacy: a v0.3.5 room after a logic change replays on v035, then continues on the current code', async () => {
  const fx = fixture('coop_log_v035.json');
  await changedLogic(async () => {
    // the problem v0.3.6 fixes: the changed code can't replay the old log
    const naive = replayOn(CURRENT, null, fx.log);
    assert.equal(naive.ok, false, 'the changed logic disagrees with the logged checksums');
    // the fix: logic id bumped (pretend 'vNEXT'), the unstamped log goes to the frozen v035 engine
    const res = await resumeRoom({ actions: fx.log, dataLoader, logicId: 'vNEXT' });
    assert.equal(res.mode, 'legacy');
    assert.equal(res.engine, 'v035');
    assert.equal(res.stamp, 'v035');
    assert.equal(res.seq, fx.final.seq);
    assert.equal(res.game.seq, fx.final.seq);
    assert.equal(res.dropped, fx.final.seq - fx.safe.seq, 'the log ended mid-battle: that node restarts from the map');
    assert.ok(res.game instanceof CoopGame, 'handed to the current code');
    const f = facts(res.game);
    assert.deepEqual({ act: f.act, node: f.node, floor: f.floor, phase: f.phase, teams: f.teams, money: f.money },
      { act: fx.safe.act, node: fx.safe.node, floor: fx.safe.floor, phase: 'map', teams: fx.safe.teams, money: fx.safe.money });
    assert.equal(res.safe.seq, fx.final.seq, 'the hand-over becomes the room\'s first checkpoint');
    // the next resume (by any client) loads that checkpoint: same state
    const again = await resumeRoom({ checkpoint: { ...res.safe, phase: 'map', state: JSON.stringify(res.safe.snap) }, actions: [], dataLoader, logicId: 'vNEXT' });
    assert.equal(again.game.checksum(), res.game.checksum());
    // and the game goes on, on the changed code: vote, fight the node, back to the map
    const P = coopPlayer(res.game, 'LEG', { v: 'vNEXT', eng: 'vNEXT' });
    assert.ok(P.until(g => g.phase !== 'map'));
    assert.ok(P.until(g => g.phase === 'map' || g.phase === 'over', 4000));
    assert.ok(P.log.length > 3 && P.log.every(a => a.eng === 'vNEXT'));
    // a log with a vNEXT tail after a v035 checkpoint-less part (the hand-over checkpoint got lost): the vNEXT part
    // can't be verified on v035, so the room still lands on a verified safe point
    const mixed = await resumeRoom({ actions: [...fx.log, ...P.log.map(a => ({ ...a }))], dataLoader, logicId: 'vNEXT' });
    assert.ok(['legacy', 'fallback'].includes(mixed.mode) && mixed.game.phase === 'map');
  });
});

t('legacy: frozen v031 brings back rooms played on v0.3.1 (PIKACHU starter changed in v0.3.2)', async () => {
  // a v0.3.1 room can't be generated any more; check that the engine loads and differs from today's where it should
  const eng = await getEngine('v031', dataLoader);
  const old = eng.CoopGame.fromInit({ seq: 1, type: 'init', seed: 'PIKA', ascension: 0, world: 'spire', starters: ['PIKACHU', 'SQUIRTLE'], names: ['A', 'B'] });
  const now = CoopGame.fromInit({ seq: 1, type: 'init', seed: 'PIKA', ascension: 0, world: 'spire', starters: ['PIKACHU', 'SQUIRTLE'], names: ['A', 'B'] });
  assert.notEqual(old.checksum(), now.checksum());
  assert.equal(old.runs[0].relics.length, 0, 'v0.3.1 PIKACHU had no LIGHT BALL');
  assert.ok(now.runs[0].relics.some(r => r.key === 'LIGHT_BALL'));
  // snapshot from the old engine, restored on the current one
  const g = restoreGame(snapshotGame(old), CURRENT);
  assert.ok(g instanceof CoopGame && g.phase === 'map' && g.runs[0].party[0].species === 'PIKACHU');
});

// ------------------------------------------------------------------------------------- SAVE & QUIT
// The server rules of convex/coop.ts (post / since / checkpoint / latestCheckpoint / saveQuit), in memory.
class FakeRoom {
  constructor(init) { this.actions = [{ ...init, seq: 1, p: -1 }]; this.nextSeq = 2; this.cps = []; this.members = init.starters.map((_, slot) => ({ slot, left: false, savedAt: null })); }
  post(slot, a) { const seq = this.nextSeq++; this.actions.push({ ...clone(a), seq, p: slot }); this.members[slot].left = false; return seq; }
  since(after) { return this.actions.filter(a => a.seq > after).map(clone); }
  checkpoint(slot, cp) {
    if (!Number.isInteger(cp.seq) || cp.seq < 1 || cp.seq > this.nextSeq - 1 || cp.phase !== 'map') throw new Error('Bad checkpoint');
    const same = this.cps.find(c => c.seq === cp.seq);
    if (same) { if (same.checksum !== cp.checksum) same.disputed = true; else if (!same.slots.includes(slot)) same.slots.push(slot); return { disputed: !!same.disputed }; }
    this.cps.push({ ...cp, slots: [slot] }); this.cps.sort((a, b) => b.seq - a.seq); this.cps = this.cps.slice(0, 8);
    return { disputed: false };
  }
  latest() { return this.cps.find(c => !c.disputed) || null; }
  saveQuit(slot) { this.members[slot].left = true; this.members[slot].savedAt = 1; }
  saved(slot) { return this.members[slot].left && !!this.members[slot].savedAt; }
}
// A client: resumes like CoopSession.resume (latest checkpoint + the log after it) and posts like CoopSession.post.
async function client(room, slot) {
  const cp = room.latest();
  const res = await resumeRoom({ checkpoint: cp, actions: room.since(cp?.seq ?? 0), dataLoader });
  if (res.safe) room.checkpoint(slot, { seq: res.safe.seq, phase: 'map', state: JSON.stringify(res.safe.snap), checksum: res.safe.checksum, engine: LOGIC_ID });
  return { res, game: res.game };
}

t('SAVE & QUIT: checkpoint on the map, partner sees it, REJOIN resumes at the same state', async () => {
  const room = new FakeRoom(INIT('SQ1'));
  // both clients play through the room (one shared game here; each posts its own bot's actions)
  const live = new CoopGame();
  for (const a of room.since(0)) live.apply(a);
  const P = coopPlayer(live, 'SQ1', STAMP);
  // (each bot action is applied locally with the next seq and stored in the room, as the server would order it)
  let steps = 0, autoCps = 0;
  while (steps++ < 3000 && !(live.world.actIndex === 0 && live.world.floor >= 4 && isSafePoint(live))) {
    const before = live.phase;
    if (!P.step()) break;
    const a = P.log[P.log.length - 1];
    room.actions.push({ ...a }); room.nextSeq = a.seq + 1; // (P applied it locally with seq = next: same as the server would)
    if (isSafePoint(live) && before !== 'map') { room.checkpoint(0, cpRow(live)); room.checkpoint(1, cpRow(live)); autoCps++; }
  }
  assert.ok(isSafePoint(live) && autoCps >= 4, 'checkpoints at every return to the map: ' + autoCps);
  assert.ok(room.cps.every(c => c.slots.length === 2 && !c.disputed), 'both clients wrote the same checkpoints');
  assert.ok(room.cps.length <= 8, 'only the newest few are kept');
  // P1 presses SAVE & QUIT on the map
  const saved = cpRow(live);
  room.checkpoint(0, { ...saved, reason: 'save' });
  room.saveQuit(0);
  assert.ok(room.saved(0) && !room.saved(1), 'the partner sees P1 saved and quit');
  assert.equal(room.latest().seq, live.seq);
  // later: REJOIN (fresh client, no local state)
  const { res, game } = await client(room, 0);
  assert.equal(res.mode, 'checkpoint');
  assert.equal(game.checksum(), live.checksum());
  // posting again brings P1 back
  room.post(0, { type: 'setLead', uid: game.runs[0].party[0].uid, ...STAMP });
  assert.equal(room.saved(0), false);
  // a disputed checkpoint (two clients disagree) is never loaded
  room.checkpoint(1, { ...cpRow(live), seq: room.nextSeq - 1, checksum: 1 });
  room.checkpoint(0, { ...cpRow(live), seq: room.nextSeq - 1, checksum: 2 });
  assert.equal(room.latest().seq, live.seq, 'falls back to the newest undisputed one');
});

// ------------------------------------------------------------------------------------------ fixtures
t('old solo save (v0.3.5) loads, round-trips unchanged and plays on', () => {
  const fx = fixture('solo_v035.json');
  const run = Run.fromJSON(clone(fx.save));
  // v0.3.7 added run.moveOffers: the old save gets it (empty), everything else comes out exactly as it went in
  assert.deepEqual(run.moveOffers, {}, 'v0.3.7 default');
  const { moveOffers, ...rest } = JSON.parse(JSON.stringify(run));
  assert.equal(JSON.stringify(rest), JSON.stringify(fx.save), 'the v0.3.5 fields are unchanged');
  assert.ok(run.party.length >= 1 && run.map && run.rng);
  // a save of this version comes out exactly as it went in, and upgradeJSON is a no-op on it
  const now = JSON.stringify(run);
  assert.equal(JSON.stringify(Run.fromJSON(JSON.parse(now))), now, 'round trip');
  const o = JSON.parse(now);
  Run.upgradeJSON(o);
  assert.equal(JSON.stringify(o), now, 'upgradeJSON is a no-op on a current save');
  const played = playSoloNodes(run, 3, 'SOLO2');
  assert.ok(played >= 1);
});

t('older solo saves: missing fields get defaults, removed fields are ignored', () => {
  const o = clone(fixture('solo_v035.json').save);
  for (const k of ['flags', 'comboPlays', 'comboLevels', 'maxConsumables', 'gauntletIndex', 'usedTrainers', 'log', 'caughtSpecies', 'victory', 'finished']) delete o[k];
  delete o.stats.crits; delete o.stats.elites;
  for (const m of o.party) { delete m.caughtAct; delete m.item; delete m.shiny; for (const mv of m.moves) delete mv.copies; }
  for (const r of o.relics) delete r.state;
  delete o.rngState;
  o.weary = 3; o.someRemovedThing = { x: 1 }; // (fields a newer version no longer has)
  const run = Run.fromJSON(o);
  assert.deepEqual(run.flags, {});
  assert.equal(run.maxConsumables, 3);
  assert.equal(run.gauntletIndex, -1);
  assert.equal(run.stats.crits, 0);
  assert.ok(run.party.every(m => m.caughtAct === 0 && m.item === null && m.moves.every(mv => mv.copies >= 1)));
  assert.ok(Number.isFinite(run.rng.state));
  assert.ok(playSoloNodes(run, 3, 'SOLO3') >= 1);
});

t('co-op checkpoint fixture (v0.3.6) loads and plays on', async () => {
  const fx = fixture('coop_checkpoint_v036.json');
  const g = restoreGame(JSON.parse(fx.state), CURRENT);
  assert.equal(g.phase, 'map');
  assert.equal(g.world.actIndex, 1);
  if (LOGIC_ID === fx.engine) assert.equal(g.checksum() >>> 0, fx.checksum, 'same logic: same checksum');
  const res = await resumeRoom({ checkpoint: fx, actions: [], dataLoader });
  assert.equal(res.mode, 'checkpoint');
  const P = coopPlayer(res.game, 'CPF', STAMP);
  assert.ok(P.until(x => x.phase === 'battle' || x.phase === 'private'));
  assert.ok(P.until(x => x.phase === 'map', 4000), 'back on the map after the node');
});

// ------------------------------------------------------------------------- real rooms (local export)
// --------------------------------------------------------------------------------- wire (compact privateDone)
// A privateDone sent as a delta (game/coop/wire.js) must replay, resume and checkpoint exactly like the full one.
const compactLog = (log) => {
  const g = new CoopGame(), out = [];
  let full = 0, small = 0, n = 0;
  for (const a of log) {
    let b = clone(a);
    if (a.type === 'privateDone' && a.run && g.runs?.[a.p]) {
      const enc = encodePrivateDone(g, a.p, a.run);
      if (enc) {
        const { run, ...rest } = clone(a);
        b = { ...rest, ...enc };
        assert.deepEqual(expandAction(g, clone(b)).run, a.run, `#${a.seq}: the delta rebuilds the run`);
        n++; full += JSON.stringify(a).length; small += JSON.stringify(b).length;
      }
    }
    out.push(b);
    g.apply(expandAction(g, clone(b)));
  }
  return { log: out, game: g, n, full, small };
};

t('wire: diff/patch round trips JSON exactly, key order included', () => {
  const cases = [
    [{ a: 1, b: [1, 2, 3], c: { d: 'x' } }, { a: 1, b: [1, 2, 3, 4], c: { d: 'y', e: null } }],
    [{ a: 1, b: 2 }, { b: 2, a: 1 }],
    [{ a: 1, b: 2, c: 3 }, { a: 1, c: 4 }],
    [{ p: [{ u: 1, hp: 3 }, { u: 2, hp: 4 }] }, { p: [{ u: 2, hp: 4 }, { u: 1, hp: 0 }] }],
    [{ x: [1, 2, 3, 4] }, { x: [1, 2] }],
    [{ x: { y: [] } }, { x: { y: [{ z: 1 }] } }],
    [{ s: 'a' }, { s: 'a' }],
    [{ k: 1.5, n: null }, { k: -0.25, n: { deep: [true, false] } }],
  ];
  for (const [a, b] of cases) {
    const d = diff(a, b);
    const back = d === undefined ? a : patch(a, d);
    assert.equal(JSON.stringify(back), JSON.stringify(b), JSON.stringify(d));
  }
  // random nested values
  const rng = new RNG(7);
  const rnd = (depth) => {
    const k = rng.int(0, depth > 2 ? 3 : 6);
    if (k === 0) return rng.int(-5, 5);
    if (k === 1) return ['a', 'b', 'c'][rng.int(0, 2)];
    if (k === 2) return null;
    if (k === 3) return rng.int(0, 1) === 1;
    if (k === 4) return Array.from({ length: rng.int(0, 4) }, () => rnd(depth + 1));
    const o = {}; for (let i = rng.int(0, 4); i > 0; i--) o['k' + rng.int(0, 5)] = rnd(depth + 1); return o;
  };
  for (let i = 0; i < 400; i++) {
    const a = { r: rnd(0) }, b = rng.int(0, 1) ? { r: rnd(0) } : JSON.parse(JSON.stringify(a));
    const d = diff(a, b);
    assert.equal(JSON.stringify(d === undefined ? a : patch(a, d)), JSON.stringify(b));
  }
});

t('wire: compact privateDone logs replay, resume and checkpoint exactly like the full log (2-4 players)', async () => {
  for (const [seed, n, max] of [['WIRE2', 2, 4000], ['WIRE3', 3, 4000], ['WIRE4', 4, 3000]]) {
    const { game, log, cks } = botGame(seed, { n, max });
    const c = compactLog(log);
    assert.ok(c.n >= 5, `${seed}: only ${c.n} compact privateDone actions`);
    assert.ok(c.small * 3 < c.full, `${seed}: compact privateDone ${c.small} B vs ${c.full} B full`);
    assert.equal(c.game.checksum() >>> 0, game.checksum() >>> 0, `${seed}: same end state`);
    // the whole log through resumeRoom (replayOn expands them)
    const res = await resumeRoom({ actions: c.log, dataLoader });
    assert.equal(res.mode, 'replay', `${seed}: ${JSON.stringify(res.tried)}`);
    assert.equal(res.game.checksum() >>> 0, cks.get(game.seq));
    // from a checkpoint in the middle, with compact actions in the tail
    const g = new CoopGame(); let S = null;
    for (const a of c.log) { g.apply(expandAction(g, clone(a))); if (isSafePoint(g) && g.seq < game.seq * 0.6) S = cpRow(g); }
    const tail = c.log.filter(a => a.seq > S.seq);
    assert.ok(tail.some(a => a.runD), `${seed}: compact actions after the checkpoint`);
    const r2 = await resumeRoom({ checkpoint: S, actions: tail, dataLoader });
    assert.equal(r2.mode, 'checkpoint');
    assert.equal(r2.game.checksum() >>> 0, cks.get(game.seq));
    console.log(`  ${seed}: ${c.n} privateDone ${c.full} B -> ${c.small} B (${(c.full / c.small).toFixed(1)}x)`);
  }
});

t('wire: a compact privateDone that does not match the game is refused the same way everywhere (never a wrong run)', () => {
  const { log } = botGame('WIREBAD', { max: 3000 });
  const c = compactLog(log);
  const i = c.log.findIndex(a => a.runD);
  const bad = c.log.map(clone);
  bad[i].rb = 'zzz'; // base hash off: as if the sender's run before the screen differed
  const play = () => { const g = new CoopGame(); let ok = null; for (const [k, a] of bad.entries()) { const r = g.apply(expandAction(g, clone(a))); if (k === i) ok = { r, done: g.private?.done?.slice(), cks: g.checksum() }; } return { g, ok }; };
  const one = play(), two = play();
  assert.equal(one.ok.r, false, 'refused');
  assert.equal(one.ok.done[bad[i].p], false, 'the player is still in the private phase');
  assert.equal(one.ok.cks, two.ok.cks, 'deterministic');
  // the sender's full repost (what CoopSession does) puts it right
  const g = new CoopGame();
  for (const a of c.log.slice(0, i)) g.apply(expandAction(g, clone(a)));
  assert.equal(g.apply(expandAction(g, clone(bad[i]))), false);
  const { runD, rb, rt, ...rest } = clone(bad[i]);
  assert.equal(g.apply({ ...rest, seq: bad[i].seq + 0.5 | 0, run: clone(log[i].run) }), false, '(same seq: ignored)');
  const g2 = new CoopGame();
  for (const a of c.log.slice(0, i)) g2.apply(expandAction(g2, clone(a)));
  g2.apply(expandAction(g2, clone(bad[i])));
  assert.equal(g2.apply({ ...rest, seq: bad[i].seq + 1, run: clone(log[i].run) }), true, 'the full repost applies');
  assert.equal(g2.private ? g2.private.done[bad[i].p] : true, true);
});

t('wire: an old full privateDone is left as it is', () => {
  const a = { type: 'privateDone', p: 0, seq: 9, run: { party: [] } };
  assert.equal(expandAction(new CoopGame(), a), a);
  const v = { type: 'vote', p: 1, seq: 3, node: 'x' };
  assert.equal(expandAction(null, v), v);
});

const EXP = process.env.COOP_EXPORT;
if (EXP && fs.existsSync(path.join(EXP, 'coopActions.jsonl'))) {
  const rooms = JSON.parse(fs.readFileSync(path.join(EXP, 'coopRooms.json'), 'utf8'));
  const acts = fs.readFileSync(path.join(EXP, 'coopActions.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  const logOf = (code) => { const r = rooms.find(x => x.code === code); return acts.filter(a => a.roomId === r._id).sort((a, b) => a.seq - b.seq).map(a => ({ ...JSON.parse(a.json), seq: a.seq, p: a.p })); };
  for (const spec of (process.env.OWNER_ROOMS || '').split(',').filter(Boolean)) {
    const [code, act] = spec.split(':');
    t(`real room ${code}: resumes at act ${act} on v0.3.6, and after a logic change`, async () => {
      const log = logOf(code);
      const now = await resumeRoom({ actions: log, dataLoader });
      assert.equal(now.game.world.actIndex + 1, +act, `act on ${LOGIC_ID}: ${now.mode} ${JSON.stringify(now.tried)}`);
      const want = facts(now.game);
      const later = await changedLogic(() => resumeRoom({ actions: log, dataLoader, logicId: 'vNEXT' }));
      assert.equal(later.mode, 'legacy');
      assert.deepEqual(facts(later.game), want, 'same place, same teams');
      // the checkpoint written on the first resume loads after the change too
      const row = { seq: now.safe.seq, phase: 'map', state: JSON.stringify(now.safe.snap), checksum: now.safe.checksum, engine: LOGIC_ID };
      const fromCp = await changedLogic(() => resumeRoom({ checkpoint: row, actions: log.filter(a => a.seq > row.seq), dataLoader, logicId: 'vNEXT' }));
      assert.deepEqual(facts(fromCp.game), want);
      console.log(`  ${code}: ${now.mode}/${now.engine} -> act ${want.act + 1} node ${want.node} ${want.phase}; after a logic change: ${later.mode}/${later.engine}; teams ${want.teams.map(x => x.map(m => m.split(':').slice(0, 2).join(' ')).join(', ')).join(' | ')}`);
    });
  }
}

for (const [name, fn] of tests) {
  try { await fn(); pass++; } catch (e) { fail++; console.log('FAIL', name, '-', e.stack.split('\n').slice(0, 4).join(' | ')); }
}
console.log(`saves tests: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
