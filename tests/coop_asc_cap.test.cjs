// Per-starter ascension cap in co-op rooms, against the DEV Convex deployment (never prod).
// A room can't go above the lower of the two players' unlocks for the starters they picked (ascMax, sent
// with setStarter); a lower pick pulls the room down, configure clamps, start refuses anything above.
// Needs dev functions pushed from this branch and COOP_TEST=1 on dev (see tests/coop_auth.cjs).
// Usage: node tests/coop_asc_cap.test.cjs
const A = require('./coop_auth.cjs');

let passes = 0, fails = 0;
const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (cond) passes++; else { fails++; process.exitCode = 1; } };
async function refused(p, re, msg) {
  try { await p; ok(false, `${msg} (no error)`); }
  catch (e) { ok(!re || re.test(e.message), `${msg} (${e.message})`); }
}

(async () => {
  console.log(`co-op ascension cap test against ${A.CONVEX_URL}`);
  A.ensureTestUser(A.P2_EMAIL, A.P2_NAME);
  const [t1, t2] = await Promise.all([A.mintToken(A.P1_EMAIL), A.mintToken(A.P2_EMAIL)]);
  const c1 = (k, f, a) => A.callConvex(t1, k, f, a);
  const c2 = (k, f, a) => A.callConvex(t2, k, f, a);
  const rooms = [];
  try {
    const room = async () => (await c1('query', 'coop:room', { roomId })).room;
    const { roomId, code } = await c1('mutation', 'coop:create', { ascension: 6, world: 'kanto' });
    rooms.push(roomId);
    await c2('mutation', 'coop:join', { code });
    ok((await room()).ascension === 6, 'no starters yet: the host can set A6');
    await c1('mutation', 'coop:setStarter', { roomId, starter: 'GASTLY', ascMax: 5 });
    ok((await room()).ascension === 5, 'host picks GASTLY (A5 unlocked): the room drops to A5');
    await c2('mutation', 'coop:setStarter', { roomId, starter: 'SQUIRTLE', ascMax: 2 });
    let r = await c1('query', 'coop:room', { roomId });
    ok(r.room.ascension === 2, 'partner picks SQUIRTLE (A2 unlocked): the room drops to the lower A2');
    ok(r.members.map(m => m.ascMax).join() === '5,2', `members show their ascMax (${r.members.map(m => m.ascMax).join()})`);
    const cfg = await c1('mutation', 'coop:configure', { roomId, ascension: 4 });
    ok(cfg.ascension === 2 && (await room()).ascension === 2, 'host asks for A4: clamped to A2');
    await c1('mutation', 'coop:configure', { roomId, ascension: 1 });
    ok((await room()).ascension === 1, 'going lower is fine (A1)');
    await c2('mutation', 'coop:setStarter', { roomId, starter: 'DRATINI', ascMax: 4 });
    await c1('mutation', 'coop:configure', { roomId, ascension: 4 });
    ok((await room()).ascension === 4, 'partner switches to DRATINI (A4): the host can raise it to A4');
    // an older client that sends no ascMax doesn't cap the room
    await c2('mutation', 'coop:setStarter', { roomId, starter: 'PIKACHU' });
    ok((await c1('query', 'coop:room', { roomId })).members.find(m => m.slot === 1).ascMax === 4, 'a pick without ascMax keeps the last known value');
    await refused(c1('mutation', 'coop:setStarter', { roomId, starter: 'GASTLY', ascMax: 'x' }), /./, 'a bad ascMax is rejected by the validator');
    // start: allowed at the cap
    await c1('mutation', 'coop:setReady', { roomId, ready: true });
    await c2('mutation', 'coop:setReady', { roomId, ready: true });
    const st = await c1('mutation', 'coop:start', { roomId });
    ok(st.seq === 1, 'start at A4 (= the cap) works');
  } catch (e) { ok(false, 'unexpected: ' + e.message); }
  finally { if (rooms.length) A.cleanupRooms(rooms); }
  console.log(`\n${passes} passed, ${fails} failed`);
})();
