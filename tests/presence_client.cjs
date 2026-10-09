// NOW PLAYING client (web/src/net/presence.js) in a real muted browser, with the Convex HTTP API faked in the
// page: nothing is sent on the title screen, a heartbeat goes out once you are in a run, it is cleared when you go
// back to the title, and a server without the functions switches it off after one try. Takes about a minute.
//   node tests/presence_client.cjs [port=8171]
const { spawn } = require('child_process');
const path = require('path');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');
const PORT = +(process.argv[2] || 8171);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let fails = 0;
const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails++; };

(async () => {
  const server = spawn(process.execPath, [path.join(ROOT, 'serve.cjs'), String(PORT)], { cwd: ROOT, stdio: 'ignore' });
  await sleep(700);
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio'] });
  try {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
    await page.route('**/cloud.json', r => r.fulfill({ status: 404, body: '' }));
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__ready && window.G?.meta, null, { timeout: 60000 });
    // a signed-in session against a fake deployment: every /api/ call is recorded and answered in the page
    await page.evaluate(async () => {
      const { Cloud } = await import('/src/net/cloud.js');
      Cloud.url = 'https://fake-presence.convex.cloud';
      Cloud.me = { email: 'me@example.com', name: 'ME' };
      Cloud.auth = { token: 'h.' + btoa(JSON.stringify({ exp: 9999999999 })) + '.s', refreshToken: 'r' };
      window.__calls = []; window.__missing = false;
      const real = window.fetch;
      window.fetch = async (url, opts) => {
        if (!String(url).includes('/api/')) return real(url, opts);
        const { path, args } = JSON.parse(opts.body);
        window.__calls.push({ path, args });
        const body = window.__missing && path.startsWith('players:')
          ? { status: 'error', errorMessage: `[Request ID: x] Server Error\nCould not find public function for '${path}'.` }
          : { status: 'success', value: path === 'players:nowPlaying' ? [{ names: ['CLIVE', 'STEPHEN'], what: 'CO-OP ACT 3' }] : 1 };
        return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
      };
      window.__engine.Engine.scene.started = true;
    });
    const calls = (p) => page.evaluate((p) => window.__calls.filter(c => c.path === p), p);
    await sleep(2000);
    ok((await calls('players:nowPlaying')).length >= 1, 'the title screen asks who is playing');
    const shown = await page.evaluate(async () => (await import('/src/net/presence.js')).nowPlaying());
    ok(shown?.[0]?.names?.length === 2, `and keeps the answer for drawing: ${JSON.stringify(shown)}`);
    await sleep(10500);
    ok((await calls('players:presence')).length === 0, 'no heartbeat while on the title screen');

    await page.evaluate(async () => {
      const { Run } = await import('/src/game/run.js');
      G.run = Run.create({ starter: 'TORCHIC', seed: 'NOWP', ascension: 2 });
      const { MapScene } = await import('/src/scenes/map.js');
      window.__engine.setScene(new MapScene({}));
    });
    await sleep(11000);
    let pc = await calls('players:presence');
    ok(pc.length === 1 && pc[0].args.activity === 'ACT 1 TORCHIC A2', `heartbeat once in a run: ${JSON.stringify(pc.map(c => c.args))}`);

    await page.evaluate(async () => { const { TitleScene } = await import('/src/scenes/title.js'); window.__engine.setScene(new TitleScene()); });
    await sleep(25000);
    pc = await calls('players:presence');
    ok(pc.length === 2 && pc[1].args.activity === null, `cleared back on the title: ${JSON.stringify(pc.map(c => c.args))}`);

    // an older server: the first "could not find" switches it off for good
    await page.evaluate(async () => {
      window.__missing = true;
      const { MapScene } = await import('/src/scenes/map.js');
      window.__engine.setScene(new MapScene({}));
    });
    await sleep(30000);
    pc = await calls('players:presence');
    ok(pc.length === 3, `older server: tried once, then quiet (${pc.length - 2} more call)`);
    ok(errors.length === 0, `no page errors ${errors.join(' | ')}`);
  } finally {
    await browser.close();
    server.kill();
  }
  console.log(fails ? `${fails} FAILED` : 'all ok');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
