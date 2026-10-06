// The map walk: clicking a node walks the player there in one smooth, one-way motion (no back-and-forth
// while the camera scrolls, no snap on arrival), using walk frames that face the way it goes.
// Records every drawn frame of real walks. Muted Chrome, own static server.
//   node tests/map_walk.cjs [root=.] [port=8137] [outdir=tests/out/visfix/walk]
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const port = +(process.argv[3] || 8137), out = process.argv[4] || 'tests/out/visfix/walk';
fs.mkdirSync(out, { recursive: true });

(async () => {
  const server = spawn(process.execPath, [path.join(root, 'serve.cjs'), String(port)], { cwd: root, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 700));
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio'] });
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  const errors = [], fails = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.goto(`http://localhost:${port}/`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__ready && window.G?.meta, null, { timeout: 60000 });
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const check = (label, ok, info = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${label} ${info}`); if (!ok) fails.push(label); };
  await ev(() => { Object.assign(G.meta, { tutorialDone: true, seenVersion: 'v9' }); });

  for (const fast of [false, true]) {
    // a run a few floors up (so the camera scrolls), then walk up 3 floors through real clicks' code path
    await ev(async (fast) => {
      G.meta.settings.fast = fast;
      const { Run } = await import('/src/game/run.js');
      const r = Run.create({ starter: 'CHARMANDER', seed: 'WALK' });
      // stand on a node of floor 3 that has a way up
      const start = Object.values(r.map.nodes).find(n => n.floor === 3 && n.next.length);
      r.nodeId = start.id; r.floor = 3; r.visited = [start.id]; G.run = r;
      const { MapScene } = await import('/src/scenes/map.js');
      // a fresh map scene per walk (travel() enters the node afterwards, which leaves the map)
      window.__newMap = () => {
        const s = new MapScene({}); window.__engine.setScene(s); s.banner = null;
        const log = window.__walkLog = [];
        const orig = s.drawPlayer.bind(s);
        s.drawPlayer = (ctx, px, py, frame, flip) => { if (s.walk) log.push({ px, py, frame, flip: !!flip, scroll: s.scroll }); orig(ctx, px, py, frame, flip); };
        return s;
      };
    }, fast);
    await page.waitForTimeout(500);
    for (let hop = 0; hop < 3; hop++) {
      const info = await ev(async () => {
        const s = window.__newMap(), r = G.run;
        await new Promise(res => setTimeout(res, 300));
        const cur = r.map.nodes[r.nodeId];
        const nxt = cur.next.map(id => r.map.nodes[id]).sort((a, b) => Math.abs(b.x - cur.x) - Math.abs(a.x - cur.x))[0]; // the most sideways step
        window.__walkLog.length = 0;
        await s.travel(nxt); // walks, then enters the node
        const [x, y] = s.nodePos(nxt); // at the final scroll
        r.nodeId = nxt.id; r.floor = nxt.floor; r.inNode = false;
        return { log: window.__walkLog.slice(), rest: [x + 12, y], scroll: s.scroll, dir: Math.sign(nxt.x - cur.x) };
      });
      const L = info.log;
      // map-space positions (screen y minus scroll) must move one way only
      const mapY = L.map(e => e.py - e.scroll), xs = L.map(e => e.px);
      const backY = mapY.some((v, i) => i && v > mapY[i - 1] + 1);
      const backX = xs.some((v, i) => i && Math.sign(v - xs[i - 1]) === -Math.sign(xs.at(-1) - xs[0]) && Math.abs(v - xs[i - 1]) > 1);
      // on screen the player must not rise and then sink back while the map scrolls (the old wobble)
      // (it may move one way or stay put, but never further than where it ends up)
      const sy = L.map(e => e.py), overshoot = Math.max(...sy) - Math.min(...sy) - Math.abs(sy.at(-1) - sy[0]);
      check(`${fast ? 'fast' : 'normal'} hop ${hop + 1}: no wobble on screen`, overshoot <= 1, `screen y ${Math.round(Math.min(...sy))}..${Math.round(Math.max(...sy))}, overshoot ${overshoot.toFixed(1)} px`);
      const last = L.at(-1);
      const snap = last ? Math.hypot(last.px - info.rest[0], last.py - info.rest[1]) : 99;
      const frames = [...new Set(L.map(e => e.frame))];
      const tag = `${fast ? 'fast' : 'normal'} hop ${hop + 1}`;
      check(`${tag}: ${L.length} frames drawn`, L.length >= (fast ? 8 : 20));
      check(`${tag}: no back-and-forth`, !backY && !backX, `mapY ${Math.round(mapY[0])}->${Math.round(mapY.at(-1))} x ${xs[0]}->${xs.at(-1)}`);
      check(`${tag}: ends where the player stands (no snap)`, snap <= 4, `off by ${snap.toFixed(1)} px`);
      check(`${tag}: never uses the walk-DOWN frames going up`, !frames.some(f => f === 3 || f === 4), `frames ${frames.join(',')}`);
    }
  }
  // filmstrip of one walk (normal speed)
  await ev(() => { G.meta.settings.fast = false; });
  await ev(async () => { window.__newMap(); await new Promise(res => setTimeout(res, 300)); });
  const p = ev(async () => { const s = window.__engine.Engine.scene, r = G.run; const nxt = r.map.nodes[r.map.nodes[r.nodeId].next[0]]; await s.travel(nxt); });
  for (let i = 0; i < 6; i++) { await page.screenshot({ path: `${out}/walk_${i}.png`, clip: { x: 336, y: 60, width: 608, height: 660 } }); await page.waitForTimeout(90); }
  await p;
  console.log(errors.length ? 'PAGE ERRORS:\n' + errors.join('\n') : 'no page errors');
  console.log(fails.length ? `FAILED: ${fails.length}` : 'all checks passed');
  await browser.close(); server.kill();
  process.exit(fails.length || errors.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
