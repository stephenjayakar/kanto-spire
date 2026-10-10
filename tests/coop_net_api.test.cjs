// Co-op network-cost API against the DEV Convex deployment (never prod): coop:watch (view only when it changed, never
// re-run by heartbeats), heartbeats into coopPresence (presence back, net / hb, what older clients see), checkpoints
// confirmed by checksum (need, pending rows, upload once, disputes, pruning with their states), sketches in their
// own table (only), and that an older client's calls keep working beside it. Same setup as tests/coop_api.test.cjs
// (this branch's functions on dev, COOP_TEST=1, E2E_DEV_DEPLOYMENT / E2E_P1_EMAIL; see tests/coop_auth.cjs).
//   node tests/coop_net_api.test.cjs
const A = require('./coop_auth.cjs');

let passes = 0, fails = 0;
const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (cond) passes++; else { fails++; process.exitCode = 1; } };
async function refused(p, re, msg) {
  try { await p; ok(false, `${msg} (no error)`); } catch (e) { ok(!re || re.test(e.message), `${msg} (${e.message})`); }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const data = (table) => { const out = A.cli('data', table, '--format', 'jsonArray', '--limit', '1000'); return out.startsWith('[') ? JSON.parse(out) : []; };

(async () => {
  console.log(`co-op network API test against ${A.CONVEX_URL}`);
  A.ensureTestUser(A.P2_EMAIL, A.P2_NAME);
  const [t1, t2] = await Promise.all([A.mintToken(A.P1_EMAIL), A.mintToken(A.P2_EMAIL)]);
  const c1 = (k, f, a) => A.callConvex(t1, k, f, a);
  const c2 = (k, f, a) => A.callConvex(t2, k, f, a);
  const rooms = [];
  let live = null;
  try {
    const { roomId, code } = await c1('mutation', 'coop:create', { ascension: 0, world: 'spire', maxPlayers: 4, gameVersion: 'v0.3.21', engine: 'v0319' });
    rooms.push(roomId);
    await c2('mutation', 'coop:join', { code, maxPlayers: 4 });
    await c1('mutation', 'coop:setStarter', { roomId, starter: 'BULBASAUR', ascMax: 0 });
    await c2('mutation', 'coop:setStarter', { roomId, starter: 'CHARMANDER', ascMax: 0 });
    await c1('mutation', 'coop:start', { roomId });

    // ---- coop:watch
    let w = await c2('query', 'coop:watch', { roomId, after: 0 });
    ok(w.actions.length === 1 && w.actions[0].seq === 1 && w.nextSeq === 2 && w.status === 'playing' && w.view && w.vh, 'watch: the init action, nextSeq, status and the view');
    ok(w.view.members.length === 2 && w.view.members.every(m => m.lastSeen === undefined && m.lastSeq === undefined) && w.view.room.nextSeq === undefined && w.view.me === 1 && w.view.isHost === false, 'watch view: no presence, no nextSeq, my slot');
    const vh = w.vh;
    w = await c2('query', 'coop:watch', { roomId, after: 1, vh });
    ok(w.actions.length === 0 && !w.view && w.vh === vh, 'watch with the current vh: no view');
    await c1('mutation', 'coop:post', { roomId, action: JSON.stringify({ type: 'vote', node: 'x', nonce: 'w2' }) });
    w = await c2('query', 'coop:watch', { roomId, after: 1, vh });
    ok(w.actions.length === 1 && w.nextSeq === 3 && !w.view, 'a post changes nextSeq, not the view');
    await c1('mutation', 'coop:saveQuit', { roomId });
    w = await c2('query', 'coop:watch', { roomId, after: 2, vh });
    ok(w.view && w.vh !== vh && w.view.members.find(m => m.slot === 0).saved === true, 'SAVE & QUIT changes the view (new vh)');
    await refused(A.callConvex(null, 'query', 'coop:watch', { roomId, after: 0 }), /sign in/i, 'watch needs a signed-in member');

    // ---- heartbeats: presence apart from the member row
    let hb = await c1('mutation', 'coop:heartbeat', { roomId, seq: 2, net: 2, hb: 15000 });
    ok(Array.isArray(hb.presence) && hb.presence.find(p => p.slot === 0)?.lastSeq === 2 && Math.abs(hb.presence.find(p => p.slot === 0).lastSeen - hb.now) < 5, 'heartbeat returns presence (mine fresh)');
    let v = await c2('query', 'coop:room', { roomId });
    const p0 = v.members.find(m => m.slot === 0);
    ok(p0.saved === false && p0.net === 2, 'the heartbeat brings P1 back (not saved) and records net 2');
    ok(p0.lastSeen > hb.now && p0.lastSeen <= v.now && p0.lastSeen - hb.now <= 10000, `older views see a 15 s heartbeat ahead (lastSeen +${p0.lastSeen - hb.now} ms, capped at now) so their 20 s rule holds`);
    hb = await c2('mutation', 'coop:heartbeat', { roomId, seq: 1 });
    ok(hb.presence.length === 2, 'an older heartbeat (no net / hb) gets presence too');
    v = await c1('query', 'coop:since', { roomId, after: 2 });
    const p1v = v.members.find(m => m.slot === 1);
    ok(p1v.lastSeq === 1 && Math.abs(p1v.lastSeen - hb.now) < 5 && p1v.net === 0, 'older heartbeat: lastSeen as is, no net');
    await c1('mutation', 'coop:heartbeat', { roomId, seq: 2 });
    v = await c2('query', 'coop:room', { roomId });
    ok(v.members.find(m => m.slot === 0).net === 0, 'P1 on an older client again (heartbeat without net): net cleared');
    await c1('mutation', 'coop:heartbeat', { roomId, seq: 2, net: 2, hb: 15000 });
    await refused(c1('mutation', 'coop:heartbeat', { roomId, junk: 1 }), /extra field|Validator/i, 'unknown heartbeat args are refused (what lets a client spot an older server)');

    // ---- a live coop:watch subscription is not re-run by heartbeats, but is by a post
    try {
      const { ConvexClient } = await import('convex/browser');
      live = new ConvexClient(A.CONVEX_URL, { unsavedChangesWarning: false });
      live.setAuth(async () => t2);
      const seen = [];
      // (both on the new protocol first: a member's first net does change the view)
      await c1('mutation', 'coop:heartbeat', { roomId, net: 2, hb: 15000 });
      await c2('mutation', 'coop:heartbeat', { roomId, net: 2, hb: 15000 });
      const cur = (await c2('query', 'coop:watch', { roomId, after: 0 })).nextSeq - 1;
      const v2 = (await c2('query', 'coop:watch', { roomId, after: 0 })).vh;
      live.onUpdate('coop:watch', { roomId, after: cur, vh: v2 }, r => seen.push({ at: Date.now(), n: r.actions.length, view: !!r.view }), e => seen.push({ err: e.message }));
      for (let i = 0; i < 40 && !seen.length; i++) await sleep(250);
      ok(seen.length === 1 && seen[0].n === 0 && !seen[0].view, `live: first result, nothing new (${JSON.stringify(seen)})`);
      for (let i = 0; i < 4; i++) { await c1('mutation', 'coop:heartbeat', { roomId, seq: cur, net: 2, hb: 15000 }); await c2('mutation', 'coop:heartbeat', { roomId, seq: cur, net: 2, hb: 15000 }); await sleep(400); }
      await sleep(1000);
      ok(seen.length === 1, `live: 8 heartbeats pushed nothing (${seen.length - 1} updates)`);
      await c1('mutation', 'coop:post', { roomId, action: JSON.stringify({ type: 'vote', node: 'y', nonce: 'w3' }) });
      for (let i = 0; i < 40 && seen.length < 2; i++) await sleep(250);
      ok(seen.length === 2 && seen[1].n === 1 && !seen[1].view, `live: a post pushes the new action at once (${JSON.stringify(seen.slice(1))})`);
    } catch (e) { ok(false, 'live subscription: ' + e.message); }

    // ---- checkpoints: one upload, the others confirm by checksum
    const nextSeq = (await c1('query', 'coop:watch', { roomId, after: 100 })).nextSeq;
    const S = nextSeq - 1;
    const state = JSON.stringify({ format: 1, seq: S, phase: 'map', pad: 'x'.repeat(2000) });
    let r = await c2('mutation', 'coop:checkpoint', { roomId, seq: S, phase: 'map', checksum: 77, gameVersion: 'v0.3.21', engine: 'v0319', reason: 'auto' });
    ok(!r.duplicate && !r.disputed && r.need === true, 'a confirmation before any upload: need = true');
    ok((await c1('query', 'coop:latestCheckpoint', { roomId })) === null, 'a seq only confirmed by checksum is not loadable');
    r = await c1('mutation', 'coop:checkpoint', { roomId, seq: S, phase: 'map', state, checksum: 77, gameVersion: 'v0.3.21', engine: 'v0319', reason: 'auto', progress: 'ACT 1' });
    ok(r.duplicate && !r.disputed && r.need === false, 'the upload fills it in');
    let cp = await c2('query', 'coop:latestCheckpoint', { roomId });
    ok(cp && cp.seq === S && cp.state === state && cp.slots.length === 2, 'latestCheckpoint: the state, both slots');
    r = await c2('mutation', 'coop:checkpoint', { roomId, seq: S, phase: 'map', checksum: 77 });
    ok(r.duplicate && r.need === false, 'confirming again: nothing needed');
    r = await c2('mutation', 'coop:checkpoint', { roomId, seq: S, phase: 'map', state, checksum: 77 });
    ok(r.duplicate && r.need === false, 'an older client uploading the same state again: a confirmation');
    const rows = data('coopCheckpoints').filter(c => c.roomId === roomId);
    ok(rows.length === 1 && rows[0].state === '' && rows[0].stateId, 'the row keeps its state apart (coopCheckpointStates)');
    ok(data('coopCheckpointStates').filter(c => c.roomId === roomId).length === 1, 'one state stored for two writers');
    await c1('mutation', 'coop:post', { roomId, action: JSON.stringify({ type: 'vote', node: 'z', nonce: 'w4' }) });
    await c1('mutation', 'coop:checkpoint', { roomId, seq: S + 1, phase: 'map', state, checksum: 5 });
    r = await c2('mutation', 'coop:checkpoint', { roomId, seq: S + 1, phase: 'map', checksum: 6 });
    ok(r.disputed && r.need === false, 'a confirmation with another checksum disputes it');
    cp = await c1('query', 'coop:latestCheckpoint', { roomId });
    ok(cp.seq === S, 'latestCheckpoint skips the disputed one');
    // pruning keeps the newest 8 rows and drops the states of the others
    for (let i = 2; i <= 10; i++) {
      await c1('mutation', 'coop:post', { roomId, action: JSON.stringify({ type: 'vote', node: 'p' + i, nonce: 'wp' + i }) });
      await c1('mutation', 'coop:checkpoint', { roomId, seq: S + i, phase: 'map', state, checksum: 100 + i });
    }
    const kept = data('coopCheckpoints').filter(c => c.roomId === roomId);
    const states = data('coopCheckpointStates').filter(c => c.roomId === roomId);
    ok(kept.length === 8 && states.length === 8 && kept.every(c => states.some(s => s._id === c.stateId)), `pruned to 8 rows with their 8 states (${kept.length} / ${states.length})`);
    await refused(c1('mutation', 'coop:checkpoint', { roomId, seq: S, phase: 'map', state: '', checksum: 1 }), /state/, 'an empty state is refused');

    // ---- sketches in coopSketches, `only`
    await c1('mutation', 'coop:setSketch', { roomId, sketch: JSON.stringify({ act: 0, strokes: [[1, 2, 3, 4]] }) });
    await c2('mutation', 'coop:setSketch', { roomId, sketch: JSON.stringify({ act: 0, strokes: [[5, 6]] }) });
    let sk = await c2('query', 'coop:sketches', { roomId, only: [0] });
    ok(sk.length === 1 && sk[0].slot === 0 && JSON.parse(sk[0].sketch).strokes.length === 1 && sk[0].sketchV === 1, 'sketches(only: [0]) returns just P1');
    sk = await c1('query', 'coop:sketches', { roomId });
    ok(sk.length === 2, 'sketches without only: everyone (older clients)');
    const mem = data('coopMembers').filter(m => m.roomId === roomId);
    ok(mem.every(m => m.sketch === undefined) && data('coopSketches').filter(k => k.roomId === roomId).length === 2, 'member rows stay small: the sketches live in coopSketches');
    w = await c1('query', 'coop:watch', { roomId, after: 1000 });
    ok(w.view.members.every(m => m.sketchV === 1), 'the view carries sketchV');

    // ---- deleting the room takes the new tables with it
    await c1('mutation', 'coop:dismiss', { roomId });
    const d = await c2('mutation', 'coop:dismiss', { roomId });
    ok(d.deleted, 'both dismiss: room deleted');
    const leftovers = ['coopPresence', 'coopSketches', 'coopCheckpointStates', 'coopCheckpoints'].map(tb => [tb, data(tb).filter(x => x.roomId === roomId).length]);
    ok(leftovers.every(([, n]) => n === 0), `presence, sketches, checkpoints and their states are deleted too ${JSON.stringify(leftovers)}`);
    rooms.length = 0;
  } catch (e) {
    ok(false, 'run: ' + (e.stack || e.message));
  } finally {
    if (live) await live.close().catch(() => {});
    if (rooms.length) A.cleanupRooms(rooms);
    console.log(`${passes} passed, ${fails} failed`);
  }
})();
