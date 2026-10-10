// staging-net: the subscription-based network against the DEV Convex deployment (never prod). Player 1 is the game's own
// client (web/src/net/cloud.js + coopnet.js, over Convex's WebSocket, in Node); player 2 plays over plain HTTP calls.
// Every WebSocket frame of player 1 is decoded, so the test sees exactly which query the server pushed a new result
// for, and checks that each subscription only changes when it must:
//   coop:head      not on posts, keepalives or sketches; yes on ready / left / SAVE & QUIT
//   coop:feed      each result is just the new actions (the feed subscribes again from its newest seq)
//   coop:presence  on keepalives and goodbyes (and nothing else pushes on a keepalive)
//   coop:sketch    on that partner's sketch only; my own slot only when a partner's ERASE wipes it
//   coop:mineLive  the REJOIN list
//   players:nowPlayingLive  NOW PLAYING (players:activity), both clients' rows
// plus a dropped socket (closed, reconnects refused for a while) with actions posted meanwhile: caught up in order, and a
// token refresh on the socket (auth:signIn answered with a freshly minted token): the subscriptions carry on.
// Same setup as tests/coop_api.test.cjs (COOP_TEST=1 on dev, E2E_DEV_DEPLOYMENT / E2E_P1_EMAIL; see tests/coop_auth.cjs).
//   node tests/live_api.test.cjs
const path = require('path');
const { pathToFileURL } = require('url');
const A = require('./coop_auth.cjs');

let passes = 0, fails = 0;
const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (cond) passes++; else { fails++; process.exitCode = 1; } };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 15000, step = 50) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await sleep(step); } return false; }

// ---- player 1's socket, decoded: which query got a new result (QueryUpdated / QueryFailed) ----------------------------
const frames = { sockets: [], pushes: {}, in: 0, inBytes: 0, out: 0, pings: 0, block: false };
const qpath = new Map(); // queryId -> udfPath (from our own ModifyQuerySet messages)
const RealWS = globalThis.WebSocket;
globalThis.WebSocket = class extends RealWS {
  // (an outage: while frames.block is set, every connection attempt fails the way a dead network does)
  constructor(url, ...a) {
    super(frames.block ? 'ws://127.0.0.1:9/' : url, ...a);
    frames.sockets.push(this);
    // (Node's WebSocket never fires close when the connection fails, browsers do: give the client the close it expects)
    let opened = false, closed = false;
    this.addEventListener('open', () => { opened = true; });
    this.addEventListener('close', () => { closed = true; });
    this.addEventListener('error', () => { if (!opened) setTimeout(() => { if (!closed) { closed = true; this.onclose?.({ code: 1006, reason: '' }); } }, 0); });
    this.addEventListener('message', (e) => {
      const t = typeof e.data === 'string' ? e.data : '';
      frames.in++; frames.inBytes += t.length;
      let msg; try { msg = JSON.parse(t); } catch { return; }
      if (msg.type === 'Ping') frames.pings++;
      if (msg.type === 'Transition') for (const m of msg.modifications || []) {
        const p = qpath.get(m.queryId) || '?';
        (frames.pushes[p] ||= []).push(m.type === 'QueryUpdated' ? m.value : { failed: m.errorMessage });
      }
    });
  }
  send(d) {
    frames.out++;
    try { const msg = JSON.parse(d); if (msg.type === 'ModifyQuerySet') for (const m of msg.modifications) if (m.type === 'Add') qpath.set(m.queryId, m.udfPath); } catch {}
    return super.send(d);
  }
};
const pushes = (p) => (frames.pushes[p] || []).length;
const counts = () => Object.fromEntries(Object.entries(frames.pushes).map(([k, v]) => [k, v.length]));

(async () => {
  console.log(`live (subscription) API test against ${A.CONVEX_URL}`);
  A.ensureTestUser(A.P2_EMAIL, A.P2_NAME);
  const [t1, t2] = await Promise.all([A.mintToken(A.P1_EMAIL, '60m'), A.mintToken(A.P2_EMAIL, '60m')]);
  const c1 = (k, f, a) => A.callConvex(t1, k, f, a);
  const c2 = (k, f, a) => A.callConvex(t2, k, f, a);
  const rooms = [];
  const cloud = await import(pathToFileURL(path.join(__dirname, '..', 'web', 'src', 'net', 'cloud.js')).href);
  const net = await import(pathToFileURL(path.join(__dirname, '..', 'web', 'src', 'net', 'coopnet.js')).href);
  cloud.Cloud.url = A.CONVEX_URL;
  cloud.Cloud.auth = { token: t1, refreshToken: 'e2e' };
  const stops = [];
  try {
    const { roomId, code } = await c1('mutation', 'coop:create', { ascension: 0, world: 'spire', maxPlayers: 4, gameVersion: 'v0.3.23', engine: 'v0323' });
    rooms.push(roomId);
    await c2('mutation', 'coop:join', { code, maxPlayers: 4 });

    // ---- nobody else reads a room: signed out, or signed in but not a member
    const THIRD = 'coop-third@kanto-spire.test';
    A.ensureTestUser(THIRD, 'THIRD');
    const t3 = await A.mintToken(THIRD, '30m');
    for (const [kind, fn, args] of [['query', 'coop:head', { roomId }], ['query', 'coop:feed', { roomId, after: 0 }], ['query', 'coop:presence', { roomId }],
      ['query', 'coop:sketch', { roomId, slot: 0 }], ['mutation', 'coop:alive', { roomId, hb: 30000 }]]) {
      const anon = await A.convexRaw(null, kind, fn, args);
      const other = await A.convexRaw(t3, kind, fn, args);
      ok(anon.status === 'error' && /sign in/i.test(anon.errorMessage || '') && other.status === 'error' && /Room not found/.test(other.errorMessage || ''),
        `${fn}: refused signed out (sign in) and to a non-member (Room not found)`);
    }
    ok((await A.callConvex(null, 'query', 'players:nowPlayingLive', { since: 0 })).length === 0, 'players:nowPlayingLive: nothing for a signed-out caller');

    // ---- lobby: coop:head + coop:presence + REJOIN list, live
    let head = null, pres = null, mine = null;
    stops.push(net.watchRoom(roomId, v => { head = v; }));
    stops.push(net.watchPresence(roomId, l => { pres = l; }));
    stops.push(net.watchMyRooms(l => { mine = l; }));
    ok(await until(() => head && pres && mine), 'subscriptions deliver (head, presence, REJOIN list)');
    ok(head.members.length === 2 && head.me === 0 && head.isHost && head.room.code === code && head.room.status === 'lobby'
      && head.room.nextSeq === undefined && head.members.every(m => m.lastSeen === undefined && m.sketchV === undefined),
    'head: room + members, no nextSeq / lastSeen / sketchV');
    ok(mine.some(r => r.roomId === roomId && r.status === 'lobby' && r.nextSeq === undefined && r.updatedAt === undefined), 'mineLive lists the lobby, without nextSeq / updatedAt');
    await c2('mutation', 'coop:setStarter', { roomId, starter: 'CHARMANDER', ascMax: 0 });
    ok(await until(() => head.members[1].starter === 'CHARMANDER'), 'a partner\'s starter pick arrives on coop:head');
    await net.setStarter(roomId, 'BULBASAUR', 0);
    await c2('mutation', 'coop:setReady', { roomId, ready: true });
    ok(await until(() => head.members[1].ready), 'ready arrives on coop:head');
    const a1 = await net.alive(roomId, { hb: 30000 });
    ok(typeof a1.now === 'number' && Math.abs(a1.now - Date.now()) < 120000, 'coop:alive (over the socket) -> { now }');
    ok(await until(() => pres?.some(p => p.slot === 0 && p.hb === 30000 && !p.gone)), 'my keepalive shows on coop:presence');
    await net.startRoom(roomId);
    ok(await until(() => head.room.status === 'playing'), 'START arrives on coop:head (status playing)');

    // ---- the run: CoopFeed
    const got = [];
    let caught = 0, fhead = null, fpres = null;
    const feed = new net.CoopFeed(roomId, { after: 0, onActions: a => got.push(...a), onCaughtUp: () => caught++, onHead: v => { fhead = v; }, onPresence: l => { fpres = l; } }).start();
    stops.push(() => feed.stop());
    ok(await until(() => got.length === 1 && caught >= 1), 'CoopFeed: the init action, then caught up');
    await sleep(800);
    const before = counts();
    const N = 6;
    for (let i = 0; i < N; i++) await c2('mutation', 'coop:post', { roomId, action: JSON.stringify({ type: 'vote', node: 'n' + i, nonce: 'live' + i }) });
    ok(await until(() => got.length === 1 + N), `CoopFeed: ${got.length - 1}/${N} posted actions arrive`);
    ok(got.every((a, i) => a.seq === i + 1) && got[1].node === 'n0' && got[1].p === 1 && got[N].node === 'n' + (N - 1), 'in seq order, parsed, sender slot set');
    await sleep(800);
    const after = counts();
    const d = (p) => (after[p] || 0) - (before[p] || 0);
    const feedResults = (frames.pushes['coop:feed'] || []).slice(before['coop:feed'] || 0);
    const maxPerResult = Math.max(...feedResults.map(r => r.actions?.length || 0));
    ok(d('coop:head') === 0 && d('coop:presence') === 0 && d('coop:mineLive') === 0, `posts push nothing on head / presence / REJOIN list (head ${d('coop:head')}, presence ${d('coop:presence')}, mine ${d('coop:mineLive')})`);
    ok(maxPerResult <= 2 && feedResults.filter(r => r.actions?.length).length >= N / 2, `feed results carry only the new actions (at most ${maxPerResult} per result, ${feedResults.length} results for ${N} posts)`);
    ok(fhead?.room?.status === 'playing' && fpres?.length >= 1, 'CoopFeed hands out head and presence too');

    // ---- keepalives: presence only (P2's first one also records its wire protocol, net 2: a real change, on head)
    await c2('mutation', 'coop:alive', { roomId, hb: 30000, net: 2 });
    ok(await until(() => fhead?.members?.[1]?.net === 2), 'the first keepalive records net 2 (on coop:head, once)');
    await sleep(500);
    const b2 = counts();
    await c2('mutation', 'coop:alive', { roomId, hb: 30000, net: 2 });
    ok(await until(() => fpres?.some(p => p.slot === 1 && p.hb === 30000)), 'a partner keepalive arrives on coop:presence');
    await c2('mutation', 'coop:alive', { roomId, hb: 60000, net: 2 });
    ok(await until(() => fpres?.some(p => p.slot === 1 && p.hb === 60000)), 'a hidden tab says so (hb 60 s)');
    await sleep(800);
    const a2 = counts();
    const d2 = (p) => (a2[p] || 0) - (b2[p] || 0);
    ok(d2('coop:head') === 0 && d2('coop:feed') === 0 && d2('coop:mineLive') === 0 && d2('coop:presence') >= 2, `keepalives push presence only (presence ${d2('coop:presence')}, head ${d2('coop:head')}, feed ${d2('coop:feed')})`);
    // an older client's heartbeat (prod v0.3.23, every 5 s) lands in coopPresence too
    await c2('mutation', 'coop:heartbeat', { roomId, seq: 3 });
    ok(await until(() => fpres?.some(p => p.slot === 1 && p.hb === 5000)), 'an older client\'s coop:heartbeat shows as presence (hb 5 s)');
    // goodbye: offline at once (and what older clients see)
    await c2('mutation', 'coop:alive', { roomId, gone: true });
    ok(await until(() => fpres?.some(p => p.slot === 1 && p.gone)), 'goodbye (gone) arrives on coop:presence');
    const old = await c1('query', 'coop:room', { roomId });
    ok(old.members[1].lastSeen <= old.now, 'older clients\' view: a goodbye gets no keepalive allowance');
    await c2('mutation', 'coop:alive', { roomId, hb: 30000, net: 2 });
    ok(await until(() => fpres?.some(p => p.slot === 1 && !p.gone)), 'the next keepalive clears it');

    // ---- sketches
    let sk1 = null, wiped = null;
    stops.push(net.watchSketch(roomId, 1, r => { sk1 = r; }));
    stops.push(net.watchSketch(roomId, 0, r => { wiped = r; }, { wiped: true }));
    ok(await until(() => sk1 && wiped), 'sketch subscriptions deliver');
    ok(sk1.sketch === null && wiped.wiped === false, 'no sketch yet, mine not wiped');
    const b3 = counts();
    await c2('mutation', 'coop:setSketch', { roomId, sketch: JSON.stringify({ act: 0, strokes: [[1, 2, 3, 4]] }) });
    ok(await until(() => sk1?.sketch && JSON.parse(sk1.sketch).strokes.length === 1), 'a partner\'s sketch arrives on coop:sketch');
    await net.setSketch(roomId, JSON.stringify({ act: 0, strokes: [[5, 6, 7, 8]] }));
    await sleep(1000);
    const a3 = counts();
    const d3 = (p) => (a3[p] || 0) - (b3[p] || 0);
    ok(d3('coop:head') === 0 && d3('coop:feed') === 0 && d3('coop:presence') === 0, `sketches push nothing on head / feed / presence (head ${d3('coop:head')})`);
    ok(d3('coop:sketch') === 1, `my own sketch pushes nothing to me (sketch pushes ${d3('coop:sketch')}: the partner's one)`);
    await c2('mutation', 'coop:setSketch', { roomId, sketch: JSON.stringify({ act: 0, strokes: [] }), all: true });
    ok(await until(() => wiped?.wiped === true), 'a partner\'s ERASE: my wiped flag turns on');
    const mineSk = await net.getSketch(roomId, 0);
    ok(mineSk.sketch === null, 'getSketch (one-shot over the socket): mine is empty after the ERASE');

    // ---- SAVE & QUIT and REJOIN on coop:head
    await c2('mutation', 'coop:saveQuit', { roomId });
    ok(await until(() => fhead?.members?.[1]?.saved === true), 'SAVE & QUIT arrives on coop:head');
    await c2('mutation', 'coop:join', { code, maxPlayers: 4 });
    ok(await until(() => fhead?.members?.[1]?.saved === false && fhead.members[1].left === false), 'REJOIN arrives on coop:head');

    // ---- a dropped socket: closed, reconnects refused ~4 s, actions posted meanwhile
    const seqBefore = got[got.length - 1].seq;
    let down = false, upAgain = false;
    const offConn = net.onConnection(st => { if (!st.isWebSocketConnected) down = true; else if (down) upAgain = true; });
    stops.push(offConn);
    frames.block = true;
    for (const s of frames.sockets) { try { s.close(); } catch {} }
    ok(await until(() => down, 5000), 'socket closed: the client notices');
    const M = 5;
    for (let i = 0; i < M; i++) await c2('mutation', 'coop:post', { roomId, action: JSON.stringify({ type: 'vote', node: 'off' + i, nonce: 'off' + i }) });
    // a mutation of mine while offline waits and goes out on reconnect
    const pending = net.postAction(roomId, { type: 'vote', node: 'mine-offline' });
    await sleep(4000);
    ok(got[got.length - 1].seq === seqBefore, 'nothing arrives while the socket is down');
    frames.block = false;
    ok(await until(() => upAgain, 30000), 'the client reconnects by itself');
    const pr = await pending;
    ok(await until(() => got.length && got[got.length - 1].seq >= pr.seq, 20000), `after the reconnect the feed catches up to seq ${pr.seq}`);
    const tail = got.filter(a => a.seq > seqBefore);
    ok(tail.length === M + 1 && tail.every((a, i) => a.seq === seqBefore + 1 + i) && tail[M].node === 'mine-offline', `no lost or doubled actions (${tail.map(a => a.seq).join(',')})`);

    // ---- a long backlog arrives in pages (more): setAfter(0) replays the whole log
    const replay = [];
    const f2 = new net.CoopFeed(roomId, { after: 0, onActions: a => replay.push(...a) }).start();
    stops.push(() => f2.stop());
    ok(await until(() => replay.length === got.length), `a second feed from seq 0 replays all ${got.length} actions`);
    f2.stop();

    // ---- NOW PLAYING
    await c1('mutation', 'players:me', {}); await c2('mutation', 'players:me', {}); // (trainers: NOW PLAYING lists players)
    let np = null;
    const since = Math.floor((Date.now() - 180000) / 60000) * 60000;
    stops.push(cloud.subscribe('players:nowPlayingLive', { since }, r => { np = r; }));
    ok(await until(() => Array.isArray(np)), 'nowPlayingLive delivers');
    const r1 = await cloud.cloudCall('mutation', 'players:activity', { activity: 'CO-OP ACT 1', room: code });
    await c2('mutation', 'players:activity', { activity: 'CO-OP ACT 1', room: code });
    ok(typeof r1 === 'number' && await until(() => np.some(g => g.what === 'CO-OP ACT 1' && g.names.length === 2 && g.seen > 0)), 'two partners in one room: one NOW PLAYING entry with both names');
    const oldNp = await c1('query', 'players:nowPlaying', {});
    ok(oldNp.some(g => g.what === 'CO-OP ACT 1' && g.names.length === 2 && g.seen === undefined), 'older clients\' players:nowPlaying lists the new rows too (same shape as before)');
    await c2('mutation', 'players:presence', { activity: 'ACT 3 MUDKIP' }); // (an older client: the players row)
    ok(await until(() => np.some(g => g.what === 'ACT 3 MUDKIP')), 'an older client\'s players:presence shows on nowPlayingLive');
    await cloud.cloudCall('mutation', 'players:activity', { activity: null });
    await c2('mutation', 'players:activity', { activity: null });
    ok(await until(() => !np.some(g => g.what === 'CO-OP ACT 1' || g.what === 'ACT 3 MUDKIP')), 'leaving the run clears both rows (new and old)');

    // ---- token refresh on the socket: a token that runs out in 70 s; auth:signIn (HTTP) answers with a fresh one
    stops.splice(0).forEach(s => { try { s(); } catch {} });
    feed.stop();
    await cloud.closeLive();
    frames.sockets.length = 0;
    const short = await A.mintToken(A.P1_EMAIL, '70s');
    cloud.Cloud.auth = { token: short, refreshToken: 'e2e' };
    const realFetch = globalThis.fetch;
    let refreshes = 0;
    globalThis.fetch = async (url, init) => {
      if (String(url).endsWith('/api/action') && /"auth:signIn"/.test(init?.body || '')) {
        refreshes++;
        const token = await A.mintToken(A.P1_EMAIL, '60m');
        return new Response(JSON.stringify({ status: 'success', value: { tokens: { token, refreshToken: 'e2e-' + refreshes } } }), { headers: { 'Content-Type': 'application/json' } });
      }
      return realFetch(url, init);
    };
    const got3 = [];
    const f3 = new net.CoopFeed(roomId, { after: got[got.length - 1].seq, onActions: a => got3.push(...a) }).start();
    await c2('mutation', 'coop:post', { roomId, action: JSON.stringify({ type: 'vote', node: 'pre-refresh', nonce: 'pre-refresh' }) });
    ok(await until(() => got3.length === 1), 'feed works on the short token');
    ok(refreshes === 0, 'the stored token is used as it is (no refresh at connect)');
    ok(await until(() => refreshes >= 1, 30000), `about a minute before it expires the socket asks for a fresh token (auth:signIn x${refreshes})`);
    await sleep(2000);
    await c2('mutation', 'coop:post', { roomId, action: JSON.stringify({ type: 'vote', node: 'post-refresh', nonce: 'post-refresh' }) });
    ok(await until(() => got3.length === 2 && got3[1].node === 'post-refresh'), 'after the refresh the same subscription carries on');
    ok(cloud.Cloud.auth?.refreshToken === 'e2e-1' && refreshes === 1, 'one refresh, stored (the next HTTP call reuses it)');
    f3.stop();
    globalThis.fetch = realFetch;
    console.log(`  socket: ${frames.in} frames in (${frames.pings} pings), ${frames.out} out; pushes ${JSON.stringify(counts())}`);
  } catch (e) {
    ok(false, 'unexpected error: ' + (e.stack || e.message));
  } finally {
    stops.forEach(s => { try { s(); } catch {} });
    await cloud.closeLive().catch(() => {});
    try { const r = A.cleanupRooms(rooms); console.log(`cleanup: ${r.rooms ?? rooms.length} room(s)`); } catch (e) { console.log('cleanup failed', e.message); }
  }
  console.log(`\n${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})();
