// Live check (DEV Convex only) that the server keeps NUZLOCKE on at A8+, whatever a client sends:
// coop:create, coop:configure and coop:start (the init action). Below A8 the switch stays optional.
// Needs dev functions pushed (`npx convex dev --once`) and COOP_TEST=1 on dev (see tests/coop_auth.cjs).
// Usage: E2E_DEV_DEPLOYMENT=elegant-corgi-316 E2E_P1_EMAIL=coop-p1@kanto-spire.test node tests/coop_nuzlocke.test.cjs
//         (static checks: tests/nuzlocke_lock.test.mjs)
const A = require('./coop_auth.cjs');

let passes = 0, fails = 0;
const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (cond) passes++; else { fails++; process.exitCode = 1; } };

(async () => {
  console.log(`live coop NUZLOCKE lock against ${A.CONVEX_URL}`);
  A.ensureTestUser(A.P1_EMAIL, 'P1'); A.ensureTestUser(A.P2_EMAIL, A.P2_NAME);
  const [t1, t2] = await Promise.all([A.mintToken(A.P1_EMAIL), A.mintToken(A.P2_EMAIL)]);
  const call = (t, kind, fn, args) => A.callConvex(t, kind, fn, args);
  const nuzOf = async (roomId) => (await call(t1, 'query', 'coop:room', { roomId })).room.nuzlocke;
  const rooms = [];
  const make = async (ascension, nuzlocke) => { const r = await call(t1, 'mutation', 'coop:create', { ascension, world: 'spire', nuzlocke }); rooms.push(r.roomId); return r; };
  try {
    // create
    for (const a of [8, 10]) ok(await nuzOf((await make(a, false)).roomId) === true, `create A${a} nuzlocke:false -> ON`);
    ok(await nuzOf((await make(3, false)).roomId) === false, 'create A3 nuzlocke:false -> OFF');
    ok(await nuzOf((await make(3, true)).roomId) === true, 'create A3 nuzlocke:true -> ON');

    // configure
    const r = await make(0, false);
    let c = await call(t1, 'mutation', 'coop:configure', { roomId: r.roomId, ascension: 8 });
    ok(c.nuzlocke === true && await nuzOf(r.roomId) === true, 'configure A0 -> A8 turns it ON');
    c = await call(t1, 'mutation', 'coop:configure', { roomId: r.roomId, nuzlocke: false });
    ok(c.nuzlocke === true && await nuzOf(r.roomId) === true, 'configure nuzlocke:false at A8 stays ON');
    c = await call(t1, 'mutation', 'coop:configure', { roomId: r.roomId, ascension: 9, nuzlocke: false });
    ok(c.nuzlocke === true, 'configure A9 + nuzlocke:false stays ON');
    c = await call(t1, 'mutation', 'coop:configure', { roomId: r.roomId, ascension: 7 });
    ok(c.nuzlocke === true, 'lowering to A7 keeps the switch ON');
    c = await call(t1, 'mutation', 'coop:configure', { roomId: r.roomId, nuzlocke: false });
    ok(c.nuzlocke === false && await nuzOf(r.roomId) === false, 'below A8 it switches OFF');
    c = await call(t1, 'mutation', 'coop:configure', { roomId: r.roomId, nuzlocke: true });
    ok(c.nuzlocke === true, 'below A8 it switches ON');

    // start: the init action carries nuzlocke at A8+ (and not for an off room below A8)
    const startInit = async (ascension, nuzlocke) => {
      const s = await make(ascension, nuzlocke);
      await call(t1, 'mutation', 'coop:setStarter', { roomId: s.roomId, starter: 'BULBASAUR', ascMax: 10 });
      const j = await call(t2, 'mutation', 'coop:join', { code: s.code, maxPlayers: 4 });
      await call(t2, 'mutation', 'coop:setStarter', { roomId: j.roomId, starter: 'CHARMANDER', ascMax: 10 });
      await call(t1, 'mutation', 'coop:start', { roomId: s.roomId });
      const since = await call(t1, 'query', 'coop:since', { roomId: s.roomId, after: 0 });
      return JSON.parse(since.actions[0].json);
    };
    const i8 = await startInit(8, false);
    ok(i8.type === 'init' && i8.ascension === 8 && i8.nuzlocke === true, 'start A8 -> init.nuzlocke true');
    const i2 = await startInit(2, false);
    ok(i2.type === 'init' && i2.ascension === 2 && !('nuzlocke' in i2), 'start A2 off -> init has no nuzlocke (byte-identical to older rooms)');
  } catch (e) {
    ok(false, `unexpected error: ${e.message}`);
  } finally {
    A.cleanupRooms(rooms);
  }
  console.log(`\n${passes} passed, ${fails} failed`);
})().catch((e) => { console.error(e); process.exitCode = 1; });
