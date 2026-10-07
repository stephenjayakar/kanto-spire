// Co-op checkpoints + SAVE & QUIT against the DEV Convex deployment (never prod): checkpoint / latestCheckpoint /
// saveQuit, plus the room fields they add. Same setup as tests/coop_api.test.cjs (dev functions pushed from this
// branch, COOP_TEST=1 on dev, E2E_DEV_DEPLOYMENT / E2E_P1_EMAIL set; see tests/coop_auth.cjs).
//   node tests/coop_checkpoint_api.test.cjs
const A = require('./coop_auth.cjs');

let passes = 0, fails = 0;
const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (cond) passes++; else { fails++; process.exitCode = 1; } };
async function refused(p, re, msg) {
  try { await p; ok(false, `${msg} (no error)`); } catch (e) { ok(!re || re.test(e.message), `${msg} (${e.message})`); }
}

(async () => {
  console.log(`co-op checkpoint API test against ${A.CONVEX_URL}`);
  A.ensureTestUser(A.P2_EMAIL, A.P2_NAME);
  const [t1, t2] = await Promise.all([A.mintToken(A.P1_EMAIL), A.mintToken(A.P2_EMAIL)]);
  const c1 = (k, f, a) => A.callConvex(t1, k, f, a);
  const c2 = (k, f, a) => A.callConvex(t2, k, f, a);
  const rooms = [];
  try {
    const { roomId, code } = await c1('mutation', 'coop:create', { ascension: 0, world: 'spire', maxPlayers: 4, gameVersion: 'v0.3.6', engine: 'v035' });
    rooms.push(roomId);
    await c2('mutation', 'coop:join', { code, maxPlayers: 4 });
    await c1('mutation', 'coop:setStarter', { roomId, starter: 'BULBASAUR', ascMax: 0 });
    await c2('mutation', 'coop:setStarter', { roomId, starter: 'CHARMANDER', ascMax: 0 });
    let v = await c1('query', 'coop:room', { roomId });
    ok(v.room.gameVersion === 'v0.3.6', 'create stores the game version');
    await refused(c1('mutation', 'coop:checkpoint', { roomId, seq: 1, phase: 'map', state: '{}', checksum: 1 }), /not in progress/, 'no checkpoint before the run starts');
    await c1('mutation', 'coop:start', { roomId });
    ok((await c1('query', 'coop:latestCheckpoint', { roomId })) === null, 'a new room has no checkpoint');
    await c1('mutation', 'coop:post', { roomId, action: JSON.stringify({ type: 'vote', node: 'x', nonce: 'n2', v: 'v0.3.6', eng: 'v035' }) });
    const state = JSON.stringify({ format: 1, seq: 2, phase: 'map', hello: 'world' });
    let r = await c1('mutation', 'coop:checkpoint', { roomId, seq: 2, phase: 'map', state, checksum: 123, gameVersion: 'v0.3.6', engine: 'v035', reason: 'auto', progress: 'ACT 1' });
    ok(!r.duplicate && !r.disputed, 'P1 writes a checkpoint at #2');
    r = await c2('mutation', 'coop:checkpoint', { roomId, seq: 2, phase: 'map', state, checksum: 123, gameVersion: 'v0.3.6', engine: 'v035', reason: 'auto' });
    ok(r.duplicate && !r.disputed, 'P2 writes the same one: a confirmation');
    let cp = await c2('query', 'coop:latestCheckpoint', { roomId });
    ok(cp && cp.seq === 2 && cp.state === state && cp.checksum === 123 && cp.engine === 'v035' && cp.gameVersion === 'v0.3.6' && cp.slots.length === 2, 'latestCheckpoint returns it with both slots');
    await refused(c1('mutation', 'coop:checkpoint', { roomId, seq: 3, phase: 'map', state, checksum: 1 }), /seq/, 'no checkpoint past the log');
    await refused(c1('mutation', 'coop:checkpoint', { roomId, seq: 2, phase: 'battle', state, checksum: 1 }), /map/, 'no checkpoint off the map');
    // a disputed seq is skipped
    await c1('mutation', 'coop:post', { roomId, action: JSON.stringify({ type: 'vote', node: 'y', nonce: 'n3' }) });
    await c1('mutation', 'coop:checkpoint', { roomId, seq: 3, phase: 'map', state, checksum: 5 });
    r = await c2('mutation', 'coop:checkpoint', { roomId, seq: 3, phase: 'map', state, checksum: 6 });
    ok(r.disputed, 'two clients disagree at #3: disputed');
    cp = await c1('query', 'coop:latestCheckpoint', { roomId });
    ok(cp.seq === 2, 'latestCheckpoint skips the disputed one');
    let mine = await c1('query', 'coop:mine', {});
    ok(mine.find(x => x.roomId === roomId)?.progress === 'ACT 1', 'REJOIN list shows the progress label');
    // SAVE & QUIT
    await c1('mutation', 'coop:saveQuit', { roomId });
    v = await c2('query', 'coop:room', { roomId });
    ok(v.members.find(m => m.slot === 0).saved === true && v.members.find(m => m.slot === 0).left === true, 'partner sees P1 saved & quit');
    mine = await c2('query', 'coop:mine', {});
    ok(mine.find(x => x.roomId === roomId)?.members.find(m => m.slot === 0)?.saved === true, 'and so does the REJOIN list');
    await c1('mutation', 'coop:heartbeat', { roomId, seq: 3 });
    v = await c2('query', 'coop:room', { roomId });
    ok(v.members.find(m => m.slot === 0).saved === false, 'back online: no longer shown as saved');
    // checkpoints go with the room
    await c1('mutation', 'coop:dismiss', { roomId });
    const d = await c2('mutation', 'coop:dismiss', { roomId });
    ok(d.deleted, 'both dismiss: room deleted');
    const out = A.cli('data', 'coopCheckpoints', '--format', 'jsonArray', '--limit', '1000');
    const left = (out.startsWith('[') ? JSON.parse(out) : []).filter(c => c.roomId === roomId); // (an empty table prints nothing)
    ok(left.length === 0, 'its checkpoints are deleted too');
    rooms.length = 0;
  } catch (e) {
    ok(false, 'run: ' + e.message);
  } finally {
    if (rooms.length) A.cleanupRooms(rooms);
    console.log(`${passes} passed, ${fails} failed`);
  }
})();
