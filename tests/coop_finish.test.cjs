// v0.3.12 co-op runs in RECORDS: coop:finish against the DEV Convex deployment (never prod).
// Three throwaway test accounts (host, partner, outsider): a started room is finished by the partner, then again by
// the host (a no-op), and checked: ONE team row owned by the host, both trainers credited once, the room closed and
// off both REJOIN lists, the partner's MY RUNS shows the team run. Everything is deleted afterwards.
// Needs: dev functions pushed from this branch and COOP_TEST=1 on dev (see tests/coop_auth.cjs).
// Usage: E2E_DEV_DEPLOYMENT=<dev name> node tests/coop_finish.test.cjs
const A = require('./coop_auth.cjs');

const HOST = 'coop-finish-host@kanto-spire.test', MATE = 'coop-finish-mate@kanto-spire.test', OUT = 'coop-finish-out@kanto-spire.test';
let passes = 0, fails = 0;
const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (cond) passes++; else { fails++; process.exitCode = 1; } };
async function refused(p, re, msg) {
  try { await p; ok(false, `${msg} (no error)`); }
  catch (e) { ok(!re || re.test(e.message), `${msg} (${e.message})`); }
}
const teamRun = (result) => ({
  clientRunId: 'coop-whatever', result, world: 'spire', regions: 'K-H-K-K', ascension: 1, act: 4, actName: 'INDIGO', floor: 9,
  starter: 'BULBASAUR', party: [{ species: 'IVYSAUR', level: 30, shiny: false }, { species: 'CHARMELEON', level: 31, shiny: false }],
  seed: 'SEED1234', stats: { floors: 40, battles: 30, trainers: 12, caught: 6, bestHand: 5000, crits: 9, elites: 3, bosses: 4, moneyEarned: 9000 },
  durationMs: 3600000, finishedAt: Date.now(), version: 'v0.3.12',
});

(async () => {
  console.log(`coop:finish test against ${A.CONVEX_URL}`);
  A.ensureTestUser(HOST, 'FINHOST'); A.ensureTestUser(MATE, 'FINMATE'); A.ensureTestUser(OUT, 'FINOUT');
  const [th, tm, to] = await Promise.all([A.mintToken(HOST), A.mintToken(MATE), A.mintToken(OUT)]);
  const ch = (k, f, a) => A.callConvex(th, k, f, a), cm = (k, f, a) => A.callConvex(tm, k, f, a), co = (k, f, a) => A.callConvex(to, k, f, a);
  try {
    const p0 = await ch('mutation', 'players:me', {}), m0 = await cm('mutation', 'players:me', {});
    await co('mutation', 'players:me', {});
    const { roomId, code } = await ch('mutation', 'coop:create', { ascension: 1, world: 'spire', maxPlayers: 4 });
    await cm('mutation', 'coop:join', { code, maxPlayers: 4 });
    await refused(cm('mutation', 'coop:finish', { roomId, run: teamRun('win') }), /not in progress/, 'finish in the lobby is refused');
    await ch('mutation', 'coop:setStarter', { roomId, starter: 'BULBASAUR' });
    await cm('mutation', 'coop:setStarter', { roomId, starter: 'CHARMANDER' });
    await ch('mutation', 'coop:start', { roomId });
    ok((await ch('query', 'coop:mine', {})).some(r => r.roomId === roomId), 'a started room is on the REJOIN list');
    await refused(co('mutation', 'coop:finish', { roomId, run: teamRun('win') }), /Room not found/, 'a non-member cannot finish the room');

    const f1 = await cm('mutation', 'coop:finish', { roomId, run: teamRun('win') });
    ok(f1.duplicate === false && f1.score > 0, `partner finishes the room: recorded, score ${f1.score}`);
    const f2 = await ch('mutation', 'coop:finish', { roomId, run: teamRun('lose') });
    ok(f2.duplicate === true && f2.score === f1.score, 'host finishes too: a no-op (the first call wins)');

    const room = await ch('query', 'coop:room', { roomId });
    ok(room.room.status === 'closed', 'the room is closed');
    const dbRoom = JSON.parse(A.cli('data', 'coopRooms', '--format', 'jsonArray', '--limit', '500')).find(r => r.code === code);
    ok(dbRoom?.result === 'win', `the room keeps the first result (${dbRoom?.result})`);
    ok(!(await ch('query', 'coop:mine', {})).some(r => r.roomId === roomId) && !(await cm('query', 'coop:mine', {})).some(r => r.roomId === roomId), 'the room left both REJOIN lists');
    await refused(cm('mutation', 'coop:join', { code }), /Room not found/, 'a closed room cannot be rejoined by code');

    const hm = await ch('query', 'runs:mine', {}), mm = await cm('query', 'runs:mine', {});
    const row = hm.recent.find(r => r.clientRunId === `coop-${code}`);
    ok(!!row && row.playerName === p0.name && row.result === 'win' && row.score === f1.score, 'one team row, owned by the host, result win');
    ok(row && row.coop?.room === code && JSON.stringify(row.coop.with) === JSON.stringify([m0.name]) && JSON.stringify(row.coop.starters) === JSON.stringify(['BULBASAUR', 'CHARMANDER']), `coop tag: room, partners, starters (${JSON.stringify(row?.coop)})`);
    ok(hm.recent.filter(r => r.coop).length === 1, 'no per-player rows');
    ok(mm.recent.some(r => r._id === row?._id), "the partner's MY RUNS lists the team run");
    const mv = await cm('query', 'runs:mine', { version: 'v0.3.12' });
    ok(mv.recent.some(r => r._id === row?._id) && mv.player.runs >= 1 && mv.player.wins >= 1, "the partner's MY RUNS on v0.3.12 counts it");
    ok(hm.player.runs === p0.runs + 1 && hm.player.wins === p0.wins + 1, `host trainer credited once (${p0.runs} -> ${hm.player.runs} runs)`);
    ok(mm.player.runs === m0.runs + 1 && mm.player.wins === m0.wins + 1 && mm.player.bestScore >= f1.score, `partner trainer credited once (${m0.runs} -> ${mm.player.runs} runs)`);
    const lb = await co('query', 'runs:leaderboard', { sort: 'recent', limit: 50 });
    ok(lb.some(r => r._id === row?._id), 'the team run is on the ALL RUNS board');
    // runs:submit still takes plain runs (shared validator / cleaning)
    const s1 = await co('mutation', 'runs:submit', { run: { ...teamRun('lose'), clientRunId: 'e2e-finish-solo' } });
    ok(s1.duplicate === false && s1.score > 0, 'runs:submit still records a solo run');
  } catch (e) {
    ok(false, 'unexpected error: ' + (e.stack || e.message));
  } finally {
    try { const r = A.cleanup([HOST, MATE, OUT]); ok(r.users === 3, `cleanup: ${r.rooms} rooms and the 3 test accounts (with their runs) deleted`); }
    catch (e) { ok(false, 'cleanup failed: ' + e.message); }
    console.log(`\n${passes} passed, ${fails} failed`);
  }
})();
