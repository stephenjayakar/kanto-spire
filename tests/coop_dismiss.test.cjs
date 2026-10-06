// Deleting co-op rooms from the REJOIN list (coop:dismiss), against the DEV Convex deployment (never prod).
// A lobby: the host's delete closes it. A run in progress: it leaves my list (I'm marked left, the partner keeps
// it); once both players deleted it, the room, its members and its whole action log are gone. Rejoining by code
// brings a deleted-from-list room back.
// Needs dev functions pushed from this branch and COOP_TEST=1 on dev (see tests/coop_auth.cjs).
// Usage: node tests/coop_dismiss.test.cjs
const A = require('./coop_auth.cjs');

let passes = 0, fails = 0;
const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (cond) passes++; else { fails++; process.exitCode = 1; } };
async function refused(p, re, msg) {
  try { await p; ok(false, `${msg} (no error)`); }
  catch (e) { ok(!re || re.test(e.message), `${msg} (${e.message.split('\n')[0].slice(0, 80)})`); }
}

(async () => {
  console.log(`co-op room delete test against ${A.CONVEX_URL}`);
  A.ensureTestUser(A.P2_EMAIL, A.P2_NAME);
  const [t1, t2] = await Promise.all([A.mintToken(A.P1_EMAIL), A.mintToken(A.P2_EMAIL)]);
  const c1 = (k, f, a) => A.callConvex(t1, k, f, a);
  const c2 = (k, f, a) => A.callConvex(t2, k, f, a);
  const rooms = [];
  const listed = async (c, roomId) => (await c('query', 'coop:mine', {})).some(r => r.roomId === roomId);
  try {
    // ---- a lobby: the host deletes it -> closed for both
    const a = await c1('mutation', 'coop:create', { ascension: 0, world: 'kanto' }); rooms.push(a.roomId);
    await c2('mutation', 'coop:join', { code: a.code });
    const ra = await c1('mutation', 'coop:dismiss', { roomId: a.roomId });
    ok(ra.deleted === false, 'host deletes a lobby room (the guest is still in it)');
    ok(!(await listed(c1, a.roomId)) && !(await listed(c2, a.roomId)), 'it is closed: gone from both lists');

    // ---- a run in progress
    const b = await c1('mutation', 'coop:create', { ascension: 0, world: 'kanto' }); rooms.push(b.roomId);
    await c2('mutation', 'coop:join', { code: b.code });
    await c1('mutation', 'coop:setStarter', { roomId: b.roomId, starter: 'CHARMANDER', ascMax: 0 });
    await c2('mutation', 'coop:setStarter', { roomId: b.roomId, starter: 'SQUIRTLE', ascMax: 0 });
    await c1('mutation', 'coop:start', { roomId: b.roomId });
    await c1('mutation', 'coop:post', { roomId: b.roomId, action: JSON.stringify({ type: 'vote', node: 'x', nonce: 'n1' }) });
    ok(await listed(c1, b.roomId) && await listed(c2, b.roomId), 'a run in progress is on both lists');
    const r1 = await c1('mutation', 'coop:dismiss', { roomId: b.roomId });
    ok(r1.deleted === false && !(await listed(c1, b.roomId)), 'P1 deletes it: gone from P1\'s list');
    const view = await c2('query', 'coop:room', { roomId: b.roomId });
    ok(await listed(c2, b.roomId) && view.members.find(m => m.slot === 0).left === true, 'P2 still has it and sees P1 as left');
    // rejoining by code brings it back for P1
    await c1('mutation', 'coop:join', { code: b.code });
    ok(await listed(c1, b.roomId), 'P1 rejoins by code: back on the list');
    await c1('mutation', 'coop:dismiss', { roomId: b.roomId });
    const r2 = await c2('mutation', 'coop:dismiss', { roomId: b.roomId });
    ok(r2.deleted === true, 'P2 deletes it too: the room is deleted');
    await refused(c2('query', 'coop:room', { roomId: b.roomId }), /not found/i, 'the room is gone');
    // its action log and members are deleted too (read the DEV tables directly)
    const rows = (t) => A.cli('data', t, '--format', 'jsonLines', '--limit', '500').trim().split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    ok(!rows('coopActions').some(x => x.roomId === b.roomId) && !rows('coopMembers').some(x => x.roomId === b.roomId), 'its action log and members are deleted');
  } catch (e) { ok(false, 'unexpected: ' + e.message); }
  finally { if (rooms.length) A.cleanupRooms(rooms); }
  console.log(`\n${passes} passed, ${fails} failed`);
})();
