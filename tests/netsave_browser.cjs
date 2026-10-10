// v0.3.21 network diet, in a real (muted) Chrome against a DEV build (never prod):
// 1. a fresh browser downloads every asset pack once (gzipped) and boots; the lazy packs arrive after the title;
// 2. a reload downloads nothing (Cache Storage); with Cache Storage wiped, the browser's HTTP cache still answers;
// 3. a legacy-format cloud save (progress row) loads; playing nodes pushes about once per node, only the run part,
//    and the server ends up with exactly the local save.
// A throwaway test account (deleted afterwards). This test downloads the packs for real once (a few MB of dev
// egress): it measures that. Other browser tests use tests/pack_cache.cjs instead.
// Usage: CONVEX_URL=https://<dev>.convex.cloud node tools/build_site.cjs && node serve.cjs 8091 dist &
//        E2E_DEV_DEPLOYMENT=<dev name> node tests/netsave_browser.cjs
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), os = require('os');
const A = require('./coop_auth.cjs');

const BASE = process.env.BASE || 'http://localhost:8091/';
const EMAIL = 'netsave-browser@kanto-spire.test';
const NODES = +process.env.NODES || 4;
let passes = 0, fails = 0;
const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (cond) passes++; else { fails++; process.exitCode = 1; } };
const mb = (n) => (n / 1048576).toFixed(2) + ' MB';

(async () => {
  const cfg = await fetch(BASE + 'cloud.json').then(r => r.json());
  if (!process.env.E2E_DEV_DEPLOYMENT || !cfg.convexUrl.includes(process.env.E2E_DEV_DEPLOYMENT)) throw new Error(`${BASE} is not a DEV build (${cfg.convexUrl})`);
  A.ensureTestUser(EMAIL, 'NETSAVE');
  const token = await A.mintToken(EMAIL, '60m');
  const call = (k, f, a) => A.callConvex(token, k, f, a);
  // a legacy-format cloud save to start from (the new way up, then turned into a progress row)
  await call('mutation', 'players:me', {});
  const legacyMeta = { tutorialDone: true, tipCatch: true, hintBattles: 9, basicsSeen: true, seenVersion: 'v9.9.9', totalRuns: 3, runs: [], unlocks: {}, dexSeen: ['PIDGEY'], dexCaught: [], settings: { fast: true } };
  await call('mutation', 'progress:put', { meta: JSON.stringify(legacyMeta), run: null });
  A.cli('run', 'progress:testMakeLegacy', JSON.stringify({ email: EMAIL }));

  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'netsave-'));
  const ctx = await chromium.launchPersistentContext(userDir, { channel: 'chrome', headless: true, args: ['--mute-audio'], viewport: { width: 1280, height: 720 } });
  const page = ctx.pages()[0] || await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(t => { if (!localStorage.getItem('kantospire.auth.v1')) localStorage.setItem('kantospire.auth.v1', JSON.stringify({ token: t, refreshToken: 'e2e' })); }, token);

  // pack traffic, from the DevTools protocol: bytes over the network vs answered from the HTTP cache
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  let net = null;
  const reqs = new Map();
  const resetNet = () => { net = { packs: 0, bytes: 0, diskCache: 0, puts: [], saves: 0 }; };
  cdp.on('Network.requestWillBeSent', e => {
    const u = e.request.url;
    if (/\/pack\?/.test(u) && e.request.method === 'GET') { reqs.set(e.requestId, u); net.packs++; }
    if (/\/api\/mutation$/.test(u) && e.request.postData) {
      const body = JSON.parse(e.request.postData);
      if (body.path === 'progress:put') net.puts.push({ parts: Object.keys(body.args), bytes: e.request.postData.length });
      if (body.path === 'progress:save') net.saves++;
    }
  });
  // (staging-net: the pushes go over the Convex WebSocket as Mutation messages; HTTP ones are a closing tab's keepalive)
  cdp.on('Network.webSocketFrameSent', e => {
    let msg; try { msg = JSON.parse(e.response.payloadData); } catch { return; }
    if (msg.type !== 'Mutation') return;
    if (msg.udfPath === 'progress:put') net.puts.push({ parts: Object.keys(msg.args?.[0] || {}), bytes: e.response.payloadData.length, ws: true });
    if (msg.udfPath === 'progress:save') net.saves++;
  });
  cdp.on('Network.responseReceived', e => { if (reqs.has(e.requestId) && (e.response.fromDiskCache || e.response.fromPrefetchCache)) net.diskCache++; });
  cdp.on('Network.loadingFinished', e => { if (reqs.has(e.requestId)) net.bytes += e.encodedDataLength; });

  const boot = async (label) => {
    resetNet();
    const t0 = Date.now();
    await page.waitForFunction(() => window.__ready, null, { timeout: 120000 });
    const titleMs = Date.now() - t0;
    const lazy = await page.evaluate(async () => { const m = await import('/src/net/assetpack.js'); await m.Packs.background; return { downloaded: m.Packs.downloaded }; });
    const scene = await page.evaluate(() => window.__engine.Engine.scene?.constructor?.name);
    console.log(`  ${label}: ${net.packs} pack requests, ${mb(net.bytes)} over the network, ${net.diskCache} from the HTTP cache, ready in ${(titleMs / 1000).toFixed(1)} s (${scene})`);
    return { ...net, scene, lazy };
  };

  try {
    await page.goto(BASE);
    const b1 = await boot('fresh browser');
    const list = await call('query', 'packs:manifest', {});
    const expected = list.reduce((a, p) => a + (p.zsize || p.size), 0), plain = list.reduce((a, p) => a + p.size, 0);
    ok(b1.scene === 'TitleScene', 'fresh browser boots to the title');
    ok(b1.packs === list.length, `every pack downloaded once (${b1.packs} of ${list.length})`);
    ok(Math.abs(b1.bytes - expected) < 64 * 1024, `downloaded the gzipped packs: ${mb(b1.bytes)} (packs ${mb(plain)} plain)`);
    ok(await page.evaluate(() => window.__sound.ready), 'sound (a lazy pack) loaded after the title');
    ok(await page.evaluate(async () => (await fetch('assets/anims/anims.json')).ok && (await fetch('assets/gfx/items/hgss/fast_ball.png')).ok), 'lazy packs (move animations, HGSS art) are served from memory');
    const meta = await page.evaluate(() => window.G.meta);
    ok(meta.totalRuns === 3 && meta.dexSeen.includes('PIDGEY'), 'the legacy-format cloud save loaded (meta from the progress row)');

    await page.reload();
    const b2 = await boot('reload');
    ok(b2.packs === 0 && b2.bytes === 0, `reload: no pack requests at all (${b2.packs}, ${mb(b2.bytes)})`);

    await page.evaluate(() => caches.delete('kanto-spire-packs'));
    await page.reload();
    const b3 = await boot('Cache Storage wiped');
    ok(b3.packs === list.length && b3.diskCache === list.length && b3.bytes < 64 * 1024, `Cache Storage wiped: the HTTP cache answers (${b3.diskCache}/${b3.packs} from it, ${mb(b3.bytes)} over the network)`);
    ok(errors.length === 0, 'no page errors while booting ' + errors.join(' | '));

    // ---- play: a new run, then NODES nodes by the dev autoplayer ----
    resetNet();
    await page.evaluate(async () => {
      window.__saves = [];
      const real = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) { if (/^kantospire\.(run|meta)\.v1/.test(k)) window.__saves.push(k.includes('.run.') ? 'run' : 'meta'); return real.call(this, k, v); };
      Object.assign(window.G.meta, { tutorialDone: true, tipCatch: true, hintBattles: 9, basicsSeen: true });
      const ap = await import('/src/dev/autoplay.js');
      window.__ap = ap;
      await ap.cheat(0, 30, 'kanto');
      ap.start({ speed: 4 });
    });
    const t0 = Date.now();
    await page.waitForFunction((n) => window.__ap.log.filter(l => l.startsWith('map ->')).length > n || window.__ap.log.some(l => /GAME OVER|ERROR/.test(l)), NODES, { timeout: 300000, polling: 500 })
      .catch(async (e) => { console.log('  autoplay status:', JSON.stringify(await page.evaluate(() => window.__ap.status()))); throw e; });
    await page.evaluate(() => window.__ap.stop());
    const st = await page.evaluate(() => ({ log: window.__ap.log.slice(), saves: window.__saves.length, scene: window.__engine.Engine.scene?.constructor?.name }));
    const nodes = st.log.filter(l => l.startsWith('map ->')).length - 1;
    console.log(`  played ${nodes} nodes in ${((Date.now() - t0) / 1000).toFixed(0)} s: ${st.saves} local saves, ${net.puts.length} pushes (${net.puts.map(p => p.parts.join('+') + ' ' + p.bytes + ' B').join(', ')})`);
    ok(!st.log.some(l => l.startsWith('ERROR')), 'autoplay ran without errors ' + st.log.filter(l => l.startsWith('ERROR')).join(' | '));
    ok(net.saves === 0, 'no whole-save progress:save calls');
    ok(net.puts.length >= 1 && net.puts.length <= nodes + 3, `about one push per node (${net.puts.length} for ${nodes} nodes, ${st.saves} local saves)`);
    ok(net.puts.slice(1).every(p => p.parts.length === 1 && p.parts[0] === 'run') || net.puts.length <= 1, 'after the first, pushes carry only the run');
    ok(net.puts.every(p => p.ws), `the pushes went over the WebSocket (${net.puts.filter(p => p.ws).length}/${net.puts.length})`);
    // back on the map: the last checkpoint went up; the server holds exactly the local save
    await page.waitForFunction(() => window.__engine.Engine.scene?.constructor?.name === 'MapScene', null, { timeout: 60000 }).catch(() => {});
    await page.evaluate(() => window.__saveSync.flush());
    const local = await page.evaluate(() => ({ meta: localStorage.getItem(Object.keys(localStorage).find(k => k.startsWith('kantospire.meta.v1'))), run: localStorage.getItem(Object.keys(localStorage).find(k => k.startsWith('kantospire.run.v1'))) }));
    const server = await call('query', 'progress:get', {});
    ok(server.format === 2 && server.run === local.run && server.meta === local.meta, `the server has exactly the local save (run ${local.run?.length} B, floor ${JSON.parse(server.run || '{}').floor})`);
    ok(errors.length === 0, 'no page errors ' + errors.join(' | '));
    fs.mkdirSync(path.join(__dirname, 'out'), { recursive: true });
    await page.screenshot({ path: path.join(__dirname, 'out', 'netsave_browser.png') });
  } finally {
    await ctx.close().catch(() => {});
    fs.rmSync(userDir, { recursive: true, force: true });
    A.cleanup([EMAIL]);
  }
  console.log(`\n${passes} passed, ${fails} failed`);
})().catch(e => { console.error(e); process.exit(1); });
