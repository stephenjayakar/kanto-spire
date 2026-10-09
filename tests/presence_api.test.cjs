// NOW PLAYING API test (players:presence / players:nowPlaying) against the DEV Convex deployment (never prod).
// Needs this branch's functions pushed to dev and E2E_DEV_DEPLOYMENT set (see tests/coop_auth.cjs). Players:
// E2E_P1_EMAIL, and E2E_P2_EMAIL (another allowlisted dev account) or else the co-op tester account (which needs
// COOP_TEST=1 on dev to create). Opens one co-op lobby (to check room grouping) and leaves it again.
// Usage: E2E_DEV_DEPLOYMENT=<name> E2E_P1_EMAIL=<email> [E2E_P2_EMAIL=<email>] node tests/presence_api.test.cjs
const A = require('./coop_auth.cjs');

let passes = 0, fails = 0;
const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (cond) passes++; else { fails++; process.exitCode = 1; } };
const P2_EMAIL = process.env.E2E_P2_EMAIL || A.P2_EMAIL;

(async () => {
  console.log(`presence API test against ${A.CONVEX_URL}`);
  if (!process.env.E2E_P2_EMAIL) A.ensureTestUser(A.P2_EMAIL, A.P2_NAME);
  const [t1, t2] = await Promise.all([A.mintToken(A.P1_EMAIL), A.mintToken(P2_EMAIL)]);
  const c1 = (k, f, a) => A.callConvex(t1, k, f, a);
  const c2 = (k, f, a) => A.callConvex(t2, k, f, a);
  const me1 = await c1('mutation', 'players:me', {}), me2 = await c2('mutation', 'players:me', {});
  const find = (list, name) => list.find(g => g.names.includes(name));
  let roomId = null;
  try {
    // anonymous
    ok((await A.convexRaw(null, 'mutation', 'players:presence', { activity: 'ACT 1 X' })).status === 'error', 'anonymous presence is refused');
    const anon = await A.convexRaw(null, 'query', 'players:nowPlaying', {});
    ok(anon.status === 'success' && Array.isArray(anon.value) && anon.value.length === 0, 'anonymous nowPlaying is empty');

    // solo
    const at = await c1('mutation', 'players:presence', { activity: 'act 2 torchic' });
    ok(typeof at === 'number', 'presence returns the server time');
    let list = await c2('query', 'players:nowPlaying', {});
    const g1 = find(list, me1.name);
    ok(g1 && g1.what === 'ACT 2 TORCHIC' && g1.names.length === 1, `P1 listed: ${JSON.stringify(g1)}`);
    const raw = JSON.stringify(list);
    ok(!raw.includes('@') && !/"(email|_id|id|room|activityRoom|userId)"/.test(raw), 'no emails, ids or room codes in the list');

    // labels are cleaned and capped
    await c1('mutation', 'players:presence', { activity: '<script>alert(1)</script> ' + 'X'.repeat(80) });
    list = await c2('query', 'players:nowPlaying', {});
    const g1b = find(list, me1.name);
    ok(g1b && g1b.what.length <= 32 && !/[<>()/]/.test(g1b.what), `label cleaned: ${g1b?.what}`);

    // co-op: two members of one room are listed together; a room you are not in is ignored
    const r = await c1('mutation', 'coop:create', { ascension: 0, world: 'kanto' });
    roomId = r.roomId;
    await c2('mutation', 'coop:join', { code: r.code });
    await c1('mutation', 'players:presence', { activity: 'CO-OP ACT 1', room: r.code });
    await c2('mutation', 'players:presence', { activity: 'CO-OP ACT 1', room: r.code });
    list = await c1('query', 'players:nowPlaying', {});
    const gc = find(list, me1.name);
    ok(gc && gc.names.includes(me2.name) && gc.what === 'CO-OP ACT 1', `partners grouped: ${JSON.stringify(gc)}`);
    ok(!JSON.stringify(list).includes(r.code), 'the room code is not sent out');
    await c2('mutation', 'players:presence', { activity: 'CO-OP ACT 1', room: 'ZZZZZ' });
    list = await c1('query', 'players:nowPlaying', {});
    ok(find(list, me1.name) !== find(list, me2.name), 'a room you are not in does not group you');

    // leaving the run clears you at once
    await c1('mutation', 'players:presence', { activity: null });
    list = await c2('query', 'players:nowPlaying', {});
    ok(!find(list, me1.name), 'cleared presence drops off the list');
  } finally {
    await c1('mutation', 'players:presence', { activity: null }).catch(() => {});
    await c2('mutation', 'players:presence', { activity: null }).catch(() => {});
    if (roomId) {
      await c2('mutation', 'coop:leave', { roomId }).catch(() => {});
      await c1('mutation', 'coop:leave', { roomId }).catch(() => {});
    }
  }
  console.log(`\n${passes} passed, ${fails} failed`);
})().catch(e => { console.error(e); process.exit(1); });
