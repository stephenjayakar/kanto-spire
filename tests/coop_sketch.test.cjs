// Co-op map sketches on the DEV Convex deployment (never prod): setSketch stores a player's sketch and bumps
// sketchV (carried by coop:room / coop:since), coop:sketches returns both, ERASE (all) wipes the partner's,
// bad / oversized sketches and non-members are refused.
// Needs dev functions pushed from this branch and COOP_TEST=1 on dev (see tests/coop_auth.cjs).
// Usage: node tests/coop_sketch.test.cjs
const A = require('./coop_auth.cjs');

let passes = 0, fails = 0;
const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (cond) passes++; else { fails++; process.exitCode = 1; } };
async function refused(p, re, msg) {
  try { await p; ok(false, `${msg} (no error)`); }
  catch (e) { ok(!re || re.test(e.message), `${msg} (${e.message.split('\n')[0].slice(0, 80)})`); }
}

(async () => {
  console.log(`co-op sketch test against ${A.CONVEX_URL}`);
  A.ensureTestUser(A.P2_EMAIL, A.P2_NAME);
  const [t1, t2] = await Promise.all([A.mintToken(A.P1_EMAIL), A.mintToken(A.P2_EMAIL)]);
  const c1 = (k, f, a) => A.callConvex(t1, k, f, a);
  const c2 = (k, f, a) => A.callConvex(t2, k, f, a);
  const rooms = [];
  try {
    const { roomId, code } = await c1('mutation', 'coop:create', { ascension: 0, world: 'kanto' });
    rooms.push(roomId);
    await c2('mutation', 'coop:join', { code });
    const sk1 = JSON.stringify({ act: 0, strokes: [[200, 300, 210, 280, 230, 270]] });
    const r1 = await c1('mutation', 'coop:setSketch', { roomId, sketch: sk1 });
    ok(r1.v === 1, 'P1 sets a sketch: version 1');
    const room = await c2('query', 'coop:room', { roomId });
    ok(room.members.find(m => m.slot === 0).sketchV === 1, 'the room view carries P1\'s sketchV');
    const since = await c2('query', 'coop:since', { roomId, after: 0 });
    ok(since.members.find(m => m.slot === 0).sketchV === 1, 'so does the poll (coop:since)');
    let list = await c2('query', 'coop:sketches', { roomId });
    ok(list.find(m => m.slot === 0).sketch === sk1 && list.find(m => m.slot === 1).sketch === null, 'P2 fetches P1\'s sketch (and has none yet)');
    const sk2 = JSON.stringify({ act: 0, strokes: [[360, 330, 380, 290]] });
    await c2('mutation', 'coop:setSketch', { roomId, sketch: sk2 });
    // ERASE from P1 wipes both
    const r3 = await c1('mutation', 'coop:setSketch', { roomId, sketch: JSON.stringify({ act: 0, strokes: [] }), all: true });
    list = await c2('query', 'coop:sketches', { roomId });
    const p2row = list.find(m => m.slot === 1), p1row = list.find(m => m.slot === 0);
    ok(r3.v === 2 && JSON.parse(p1row.sketch).strokes.length === 0 && p2row.sketch === null && p2row.sketchV === 2, 'ERASE (all) wipes both and bumps both versions');
    await refused(c1('mutation', 'coop:setSketch', { roomId, sketch: 'not json' }), /Bad sketch/, 'a malformed sketch is refused');
    await refused(c1('mutation', 'coop:setSketch', { roomId, sketch: JSON.stringify({ act: 0, strokes: [[1, 2]], pad: 'x'.repeat(41000) }) }), /too big/, 'an oversized sketch is refused');
    await refused(c1('mutation', 'coop:setSketch', { roomId, sketch: JSON.stringify({ act: 0 }) }), /Bad sketch/, 'a sketch without strokes is refused');
    await refused(A.callConvex(null, 'query', 'coop:sketches', { roomId }), /./, 'signed out: refused');
  } catch (e) { ok(false, 'unexpected: ' + e.message); }
  finally { if (rooms.length) A.cleanupRooms(rooms); }
  console.log(`\n${passes} passed, ${fails} failed`);
})();
