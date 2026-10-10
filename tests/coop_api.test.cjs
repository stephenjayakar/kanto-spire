// Co-op API integration test against the DEV Convex deployment (never prod).
// Two real players: E2E_P1_EMAIL (slot 0) and coop-tester@kanto-spire.test (slot 1), plus a throwaway
// third account for the "room is full" / "non-member" checks. Tokens are minted with the dev JWT key.
// Needs: dev functions pushed from this branch and COOP_TEST=1 on dev (see tests/coop_auth.cjs).
// Usage: node tests/coop_api.test.cjs
const path = require('path');
const { pathToFileURL } = require('url');
const A = require('./coop_auth.cjs');

const P3_EMAIL = 'coop-third@kanto-spire.test';
let passes = 0, fails = 0;
const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (cond) passes++; else { fails++; process.exitCode = 1; } };
async function refused(p, re, msg) {
  try { await p; ok(false, `${msg} (no error)`); }
  catch (e) { ok(!re || re.test(e.message), `${msg} (${e.message})`); }
}
const CODE_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}$/;

(async () => {
  console.log(`co-op API test against ${A.CONVEX_URL}`);
  A.ensureTestUser(A.P2_EMAIL, A.P2_NAME);
  A.ensureTestUser(P3_EMAIL, 'THIRD');
  const [t1, t2, t3] = await Promise.all([A.mintToken(A.P1_EMAIL), A.mintToken(A.P2_EMAIL), A.mintToken(P3_EMAIL)]);
  const c1 = (k, f, a) => A.callConvex(t1, k, f, a);
  const c2 = (k, f, a) => A.callConvex(t2, k, f, a);
  const c3 = (k, f, a) => A.callConvex(t3, k, f, a);
  const rooms = [];
  try {
    // ---- anonymous
    for (const [k, f, a] of [['mutation', 'coop:create', {}], ['query', 'coop:mine', {}], ['mutation', 'coop:join', { code: 'ABCDE' }]]) {
      const r = await A.convexRaw(null, k, f, a);
      ok(r.status === 'error', `anonymous ${f} is refused`);
    }

    // ---- lobby
    const { roomId, code } = await c1('mutation', 'coop:create', { ascension: 2, world: 'kanto' });
    rooms.push(roomId);
    ok(!!roomId && CODE_RE.test(code), `create -> room ${code}`);
    let v = await c1('query', 'coop:room', { roomId });
    ok(v.room.status === 'lobby' && v.me === 0 && v.isHost && v.room.ascension === 2 && v.room.world === 'kanto' && v.room.nextSeq === 1 && typeof v.room.seed === 'string', 'room: lobby, me=0, host, settings stored');
    await refused(c2('query', 'coop:room', { roomId }), /Room not found/, 'non-member cannot read the room');
    await refused(c2('query', 'coop:since', { roomId, after: 0 }), /Room not found/, 'non-member cannot read the log');
    await refused(c2('mutation', 'coop:join', { code: 'ZZZZ' }), /Room not found/, 'bad code -> Room not found');

    const j = await c2('mutation', 'coop:join', { code: ` ${code.toLowerCase()} ` });
    ok(j.roomId === roomId && j.slot === 1, `join by code (lowercase, spaces) -> slot ${j.slot}`);
    const j2 = await c2('mutation', 'coop:join', { code });
    ok(j2.slot === 1, 'join again is idempotent (same slot)');
    await refused(c3('mutation', 'coop:join', { code }), /Room is full/, 'third player: Room is full');
    await refused(c3('query', 'coop:room', { roomId }), /Room not found/, 'third player cannot read the room');

    await refused(c1('mutation', 'coop:start', { roomId }), /starter/, 'start without starters is refused');
    await refused(c2('mutation', 'coop:configure', { roomId, world: 'hoenn' }), /host/, 'non-host configure is refused');
    await refused(c1('mutation', 'coop:configure', { roomId, ascension: 99 }), /Ascension/, 'configure validates ascension');
    const cfg = await c1('mutation', 'coop:configure', { roomId, ascension: 3, world: 'hoenn' });
    ok(cfg.ascension === 3 && cfg.world === 'hoenn', 'host configure -> asc 3, hoenn');
    await c1('mutation', 'coop:setStarter', { roomId, starter: 'BULBASAUR' });
    await c2('mutation', 'coop:setStarter', { roomId, starter: 'SQUIRTLE' });
    await refused(c2('mutation', 'coop:setStarter', { roomId, starter: 'X'.repeat(200) }), null, 'setStarter rejects oversized strings');
    await c1('mutation', 'coop:setReady', { roomId, ready: true });
    await c2('mutation', 'coop:setReady', { roomId, ready: true });
    v = await c2('query', 'coop:room', { roomId });
    ok(v.me === 1 && !v.isHost && v.members.length === 2 && v.members[0].starter === 'BULBASAUR' && v.members[1].starter === 'SQUIRTLE' && v.members.every(m => m.ready), 'both starters + ready visible to partner');
    ok(!JSON.stringify(v).includes('@'), 'room view never contains an email');
    await refused(c1('mutation', 'coop:post', { roomId, action: { type: 'vote', node: 1, nonce: 'early1' } }), /not in progress/, 'post before start is refused');
    await refused(c2('mutation', 'coop:start', { roomId }), /host/, 'non-host start is refused');

    // ---- start
    const st = await c1('mutation', 'coop:start', { roomId });
    ok(st.seq === 1, 'host start -> init is seq 1');
    let s = await c2('query', 'coop:since', { roomId, after: 0 });
    const init = s.actions[0] && { ...JSON.parse(s.actions[0].json), seq: s.actions[0].seq, p: s.actions[0].p };
    ok(s.status === 'playing' && s.actions.length === 1 && init.type === 'init' && init.seq === 1, 'since(0): init action #1, status playing');
    ok(init.seed === v.room.seed && init.ascension === 3 && init.world === 'hoenn' && JSON.stringify(init.starters) === '["BULBASAUR","SQUIRTLE"]' && init.names.length === 2, `init payload: seed/asc/world/starters [${init.starters}] names [${init.names}]`);
    await refused(c3('mutation', 'coop:join', { code }), /Room is full/, 'joining a playing room: Room is full');
    await refused(c1('mutation', 'coop:configure', { roomId, ascension: 1 }), /started/, 'configure after start is refused');
    await refused(c1('mutation', 'coop:start', { roomId }), /started/, 'start twice is refused');

    // ---- posting
    const a1 = await c1('mutation', 'coop:post', { roomId, action: { type: 'vote', node: 4, nonce: 'n-p0-1', p: 1, seq: 99 } });
    const a2 = await c2('mutation', 'coop:post', { roomId, action: JSON.stringify({ type: 'vote', node: 5, nonce: 'n-p1-1', ck: 123, atSeq: 2 }) });
    ok(a1.seq === 2 && a2.seq === 3, `posts get seq 2, 3 (${a1.seq}, ${a2.seq})`);
    s = await c1('query', 'coop:since', { roomId, after: 1 });
    const acts = s.actions.map(a => ({ ...JSON.parse(a.json), seq: a.seq, p: a.p }));
    ok(acts.length === 2 && acts[0].p === 0 && acts[1].p === 1 && acts[0].seq === 2 && acts[0].node === 4 && acts[1].ck === 123 && acts[1].atSeq === 2, 'server sets p from membership (spoofed p/seq ignored), payload kept');
    const d = await c1('mutation', 'coop:post', { roomId, action: { type: 'vote', node: 4, nonce: 'n-p0-1' } });
    ok(d.seq === 2 && d.duplicate === true, 'same nonce again -> same seq (deduped)');
    await refused(c2('mutation', 'coop:post', { roomId, action: { type: 'vote', node: 4, nonce: 'n-p0-1' } }), /Nonce/, "partner can't reuse another player's nonce");
    await refused(c1('mutation', 'coop:post', { roomId, action: { type: 'init', nonce: 'fake-init' } }), /type/, 'clients cannot post init');
    await refused(c1('mutation', 'coop:post', { roomId, action: { type: 'vote', node: 1 } }), /nonce/, 'post without nonce is refused');
    await refused(c1('mutation', 'coop:post', { roomId, action: [1, 2] }), /object/, 'non-object action is refused');
    await refused(c3('mutation', 'coop:post', { roomId, action: { type: 'vote', node: 1, nonce: 'x3' } }), /Room not found/, 'non-member post is refused');
    const big = { type: 'privateDone', nonce: 'big-1', run: { party: Array.from({ length: 6 }, (_, i) => ({ uid: i, moves: 'x'.repeat(15000) })), list: Array.from({ length: 10000 }, (_, i) => i) } };
    const b = await c2('mutation', 'coop:post', { roomId, action: JSON.stringify(big) });
    s = await c1('query', 'coop:since', { roomId, after: b.seq - 1 });
    ok(b.seq === 4 && JSON.parse(s.actions[0].json).run.list.length === 10000, `~${Math.round(JSON.stringify(big).length / 1024)} KB privateDone (10000-element array) round-trips`);
    await refused(c2('mutation', 'coop:post', { roomId, action: JSON.stringify({ type: 'privateDone', nonce: 'huge', run: 'x'.repeat(950000) }) }), /too big/, '>900 KB action is refused');

    // ---- pagination: 230 more actions (both players posting at once: the server must keep seq gap-free)
    const N = 230, base = 4;
    let next = 0;
    const seqs = [];
    let occRetries = 0;
    await Promise.all([c1, c2].map(async call => {
      while (next < N) {
        const i = next++;
        // like coopnet.postAction: a busy-room OCC failure is retried with the same nonce
        for (let attempt = 0; ; attempt++) {
          try {
            const r = await call('mutation', 'coop:post', { roomId, action: { type: 'discard', ids: [i], nonce: `bulk-${i}` } });
            seqs.push(r.seq);
            break;
          } catch (e) {
            if (attempt >= 3 || !/changed while this mutation/.test(e.message)) throw e;
            occRetries++;
          }
        }
      }
    }));
    seqs.sort((x, y) => x - y);
    ok(seqs.length === N && seqs.every((q, i) => q === base + 1 + i), `${N} posts from both players at once got unique gap-free seqs ${seqs[0]}..${seqs[N - 1]} (${occRetries} OCC retries)`);
    const pg1 = await c1('query', 'coop:since', { roomId, after: 0 });
    ok(pg1.actions.length === 200 && pg1.more === true && pg1.actions.every((a, i) => a.seq === i + 1), 'since(0): first 200, more=true, ordered');
    const pg2 = await c1('query', 'coop:since', { roomId, after: 200 });
    const total = base + N;
    ok(pg2.actions.length === total - 200 && pg2.more === false && pg2.actions[0].seq === 201 && pg2.actions.at(-1).seq === total, `since(200): remaining ${total - 200}, more=false`);
    const pg3 = await c1('query', 'coop:since', { roomId, after: total });
    ok(pg3.actions.length === 0 && pg3.room.nextSeq === total + 1, 'since(last): empty, nextSeq right');

    // ---- heartbeat / mine
    const hb = await c2('mutation', 'coop:heartbeat', { roomId, seq: 7 });
    s = await c1('query', 'coop:since', { roomId, after: total });
    const m1 = s.members.find(m => m.slot === 1);
    ok(m1.lastSeq === 7 && Math.abs(m1.lastSeen - hb.now) < 5 && Math.abs(s.now - Date.now()) < 120000, `heartbeat -> partner sees lastSeq 7, lastSeen fresh`);
    await c2('mutation', 'coop:heartbeat', { roomId, seq: 999999 });
    s = await c1('query', 'coop:room', { roomId });
    ok(s.members[1].lastSeq === total, 'heartbeat seq is clamped to the log');

    // second room (lobby) for mine ordering + leave rules
    const r2 = await c1('mutation', 'coop:create', { world: 'kanto' });
    rooms.push(r2.roomId);
    const mine1 = await c1('query', 'coop:mine', {});
    ok(mine1.length >= 2 && mine1[0].roomId === r2.roomId && mine1.some(r => r.roomId === roomId && r.status === 'playing' && r.slot === 0), 'mine: both rooms, newest first');
    const mine2 = await c2('query', 'coop:mine', {});
    ok(mine2.some(r => r.roomId === roomId && r.slot === 1) && !mine2.some(r => r.roomId === r2.roomId), "mine (partner): only rooms they're in");
    ok(!JSON.stringify(mine2).includes('@'), 'mine never contains an email');

    // ---- leave
    await c2('mutation', 'coop:join', { code: r2.code });
    await refused(c3('mutation', 'coop:join', { code: r2.code }), /Room is full/, 'lobby with 2 players: Room is full');
    await c2('mutation', 'coop:leave', { roomId: r2.roomId });
    v = await c1('query', 'coop:room', { roomId: r2.roomId });
    ok(v.members.length === 1, 'guest leaves lobby -> membership removed');
    const j3 = await c3('mutation', 'coop:join', { code: r2.code });
    ok(j3.slot === 1, 'freed slot can be taken by someone else');
    const lv = await c1('mutation', 'coop:leave', { roomId: r2.roomId });
    ok(lv.closed === true, 'host leaving lobby closes the room');
    await refused(c2('mutation', 'coop:join', { code: r2.code }), /Room not found/, 'closed room: Room not found');
    ok(!(await c1('query', 'coop:mine', {})).some(r => r.roomId === r2.roomId), 'mine hides closed rooms');

    await c2('mutation', 'coop:leave', { roomId });
    v = await c1('query', 'coop:room', { roomId });
    ok(v.room.status === 'playing' && v.members[1].left === true, 'leaving a playing room marks left (room stays)');
    const rj = await c2('mutation', 'coop:join', { code });
    v = await c1('query', 'coop:room', { roomId });
    ok(rj.slot === 1 && v.members[1].left === false, 'rejoin by code -> same slot, left cleared');

    // ---- browser client (web/src/net/coopnet.js) running in Node as player 1
    const cloud = await import(pathToFileURL(path.join(__dirname, '..', 'web', 'src', 'net', 'cloud.js')).href);
    const net = await import(pathToFileURL(path.join(__dirname, '..', 'web', 'src', 'net', 'coopnet.js')).href);
    cloud.Cloud.url = A.CONVEX_URL;
    cloud.Cloud.auth = { token: t1, refreshToken: 'e2e' };
    const realFetch = globalThis.fetch;
    let httpCalls = 0;
    globalThis.fetch = async (url, init) => { if (/\/api\/(query|mutation)/.test(String(url))) httpCalls++; return realFetch(url, init); };
    // staging-net: CoopFeed over the WebSocket (coop:head / coop:feed / coop:presence subscriptions): every action in
    // order, the room, and not a single HTTP call
    const got = [];
    let roomSeen = null, caught = 0;
    const feed = new net.CoopFeed(roomId, {
      after: 0,
      onActions: acts => { got.push(...acts); },
      onHead: v => { roomSeen = v; },
      onCaughtUp: () => { caught++; },
    }).start();
    for (let i = 0; i < 100 && !(got.length >= total && roomSeen && caught); i++) await new Promise(r => setTimeout(r, 200));
    feed.stop();
    ok(got.length === total && got.every((a, i) => a.seq === i + 1) && got[0].type === 'init' && got[1].p === 0 && got[1].node === 4, `CoopFeed delivered ${got.length}/${total} actions in order (parsed objects)`);
    ok(roomSeen && roomSeen.members.length === 2 && roomSeen.room.code === code && roomSeen.room.status === 'playing' && caught >= 1, 'CoopFeed onHead(view) and onCaughtUp');
    ok(httpCalls === 0, `CoopFeed made no HTTP calls (${httpCalls})`);
    // (the HTTP path, for a browser without WebSocket: the next calls go over plain HTTP)
    await net.closeLive();
    const RealWS = globalThis.WebSocket;
    globalThis.WebSocket = undefined;

    // postAction: network error before the server sees it, then a lost response after it committed
    let mode = 'drop-before';
    globalThis.fetch = async (url, init) => {
      if (init?.body?.includes('"coop:post"')) {
        if (mode === 'drop-before') { mode = 'ok'; throw new TypeError('Failed to fetch'); }
        if (mode === 'drop-after') { mode = 'ok'; await realFetch(url, init); throw new TypeError('Failed to fetch'); }
      }
      return realFetch(url, init);
    };
    const pa = await net.postAction(roomId, { type: 'vote', node: 9 });
    ok(pa.seq === total + 1 && !pa.duplicate && /^[0-9a-f]{24}$/.test(pa.nonce), `postAction retries a network error (seq ${pa.seq})`);
    mode = 'drop-after';
    const pb = await net.postAction(roomId, { type: 'vote', node: 10 });
    ok(pb.seq === total + 2 && pb.duplicate === true, 'postAction: lost response -> retry with same nonce, appended once');
    globalThis.fetch = realFetch;
    const fs2 = await net.fetchSince(roomId, total);
    ok(fs2.actions.length === 2 && fs2.actions[0].node === 9 && fs2.actions[1].node === 10 && fs2.actions[1].p === 0 && fs2.me === 0, 'fetchSince returns parsed actions');
    await refused(net.joinRoom('QQQQQ'), /Room not found/, 'coopnet errors carry the server message (HTTP)');
    globalThis.WebSocket = RealWS;
    await refused(net.joinRoom('QQQQQ'), /^Room not found$/, 'coopnet errors carry the same short message over the socket');
    const gr = await net.getRoom(roomId);
    const hbr = await net.heartbeat(roomId, total);
    ok(gr.room.status === 'playing' && typeof hbr.now === 'number' && (await net.myRooms()).some(r => r.roomId === roomId), 'getRoom / heartbeat / myRooms via coopnet');
    await net.closeLive();
  } catch (e) {
    ok(false, 'unexpected error: ' + (e.stack || e.message));
  } finally {
    try {
      const r = A.cleanupRooms(rooms);
      const c3r = A.cleanup([P3_EMAIL]);
      ok(r.rooms === rooms.length && c3r.users === 1, `cleanup: deleted ${r.rooms} rooms (${r.actions} actions) and the throwaway third account`);
    } catch (e) { ok(false, 'cleanup failed: ' + e.message); }
    console.log(`\n${passes} passed, ${fails} failed`);
    console.log(`Test user ${A.P2_EMAIL} is left on dev. Remove it with:\n  node node_modules/convex/bin/main.js run coopTest:cleanup '{"emails":["${A.P2_EMAIL}"]}'`);
  }
})();
