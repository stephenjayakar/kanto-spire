// Screenshots for the map-path legibility, NOW PLAYING and display-scaling work (muted Chrome, offline,
// own static server). Map: an act start, mid-act with a visited trail, the same while hovering a node a few
// floors up, and the 2-player co-op map (mock backend). Title: the NOW PLAYING list fed with sample data.
// Scaling: the title at a non-integer window size in each SCREEN mode. SERVE_DIR=<another web/ dir> shoots that
// checkout instead (e.g. the unchanged main worktree for before shots).
//   node tests/uiplay_shots.cjs [outdir=tests/out/uiplay/after] [port=8161]   (ONLY=map,coop,title,scale)
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.resolve(ROOT, process.argv[2] || 'tests/out/uiplay/after');
const PORT = +(process.argv[3] || 8161);
const ONLY = (process.env.ONLY || 'map,coop,title,scale').split(',');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const errors = [];

async function open(browser, url, viewport = { width: 1280, height: 720 }) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  await page.route('**/cloud.json', r => r.fulfill({ status: 404, body: '' }));
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__ready && window.G?.meta, null, { timeout: 60000 });
  await page.evaluate(async () => {
    const { PATCH_NOTES } = await import('/src/game/version.js');
    Object.assign(G.meta, { tutorialDone: true, seenVersion: PATCH_NOTES[0].v, hintBattles: 9 });
  });
  return page;
}

// Game coords -> page coords (the canvas may be letterboxed and scaled).
async function toPage(page, x, y) {
  return page.evaluate(([x, y]) => { const r = document.getElementById('game').getBoundingClientRect(); return [r.left + x / 640 * r.width, r.top + y / 360 * r.height]; }, [x, y]);
}

async function soloMap(browser) {
  const page = await open(browser, `http://localhost:${PORT}/`);
  const setup = (floor) => page.evaluate(async (floor) => {
    const { Run } = await import('/src/game/run.js');
    const r = Run.create({ starter: 'CHARMANDER', seed: 'PATHS7' });
    if (floor >= 0) {
      // walk a real route up to `floor` (always the first exit), so the visited trail is a connected path
      let n = r.map.nodes[r.map.start[0]]; const vis = [n.id];
      while (n.floor < floor) { n = r.map.nodes[n.next[n.next.length - 1]]; vis.push(n.id); }
      r.nodeId = n.id; r.floor = n.floor; r.visited = vis;
    }
    G.run = r;
    const { MapScene } = await import('/src/scenes/map.js');
    const s = new MapScene({}); window.__engine.setScene(s); s.banner = null;
    return true;
  }, floor);
  await setup(-1);
  await page.mouse.move(2, 2); await sleep(500);
  await page.screenshot({ path: path.join(OUT, 'map_start.png') });
  await setup(3);
  await page.mouse.move(2, 2); await sleep(500);
  await page.screenshot({ path: path.join(OUT, 'map_mid.png') });
  // hover a node three floors above the current one that the current node can reach
  const target = await page.evaluate(() => {
    const s = window.__engine.Engine.scene, r = G.run, nodes = r.map.nodes;
    let front = [r.nodeId];
    for (let k = 0; k < 3; k++) front = [...new Set(front.flatMap(id => nodes[id].next))];
    const n = nodes[front[front.length - 1]];
    const [x, y] = s.nodePos(n);
    return { x, y: y - 8, id: n.id };
  });
  const [hx, hy] = await toPage(page, target.x, target.y);
  await page.mouse.move(hx, hy); await sleep(400);
  await page.screenshot({ path: path.join(OUT, 'map_hover.png') });
  // hover a node that is NOT reachable any more (a node of the current floor, other column)
  const off = await page.evaluate(() => {
    const s = window.__engine.Engine.scene, r = G.run, nodes = r.map.nodes, cur = nodes[r.nodeId];
    const n = Object.values(nodes).filter(n => n.floor === cur.floor + 2).sort((a, b) => Math.abs(b.x - cur.x) - Math.abs(a.x - cur.x))[0];
    const [x, y] = s.nodePos(n);
    return { x, y: y - 8 };
  });
  const [ox, oy] = await toPage(page, off.x, off.y);
  await page.mouse.move(ox, oy); await sleep(400);
  await page.screenshot({ path: path.join(OUT, 'map_hover_far.png') });
  await page.context().close();
}

async function coopMap(browser) {
  const NAMES = ['ALICE', 'BOB'], STARTERS = ['CHARMANDER', 'SQUIRTLE'];
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const pages = [];
  for (let i = 0; i < 2; i++) {
    const p = await ctx.newPage(); pages.push(p);
    await p.route('**/cloud.json', r => r.fulfill({ status: 404, body: '' }));
    p.on('pageerror', e => errors.push(`P${i + 1}: ${e.message}`));
    if (i === 0) { await p.goto(`http://localhost:${PORT}/?coopdev=${NAMES[0]}`); await p.evaluate(() => { localStorage.clear(); sessionStorage.clear(); }); }
    await p.goto(`http://localhost:${PORT}/?coopdev=${NAMES[i]}`, { waitUntil: 'load' });
    await p.waitForFunction(() => window.__ready && window.G?.meta, null, { timeout: 60000 });
    await p.evaluate(() => { Object.assign(G.meta, { tutorialDone: true, seenVersion: 'v9', hintBattles: 9 }); });
  }
  const net = (p, fn, ...arg) => p.evaluate(async ({ fn, arg }) => { const n = await import('/src/scenes/coop/mocknet.js'); return n[fn](...arg); }, { fn, arg });
  const r = await net(pages[0], 'createRoom', { ascension: 0, world: 'kanto' });
  await net(pages[1], 'joinRoom', r.code);
  for (const [i, p] of pages.entries()) await net(p, 'setStarter', r.roomId, STARTERS[i], 0);
  await net(pages[0], 'startRoom', r.roomId);
  for (const p of pages) await p.evaluate(async (roomId) => {
    const { CoopLobbyScene } = await import('/src/scenes/coop/lobby.js');
    const s = new CoopLobbyScene(); window.__engine.setScene(s);
    for (let i = 0; i < 50 && !s.net; i++) await new Promise(res => setTimeout(res, 100));
    s.openRoom(roomId);
  }, r.roomId);
  for (const p of pages) await p.waitForFunction(() => window.__coop?.synced && window.__engine.Engine.scene?.constructor?.name === 'CoopMapScene', null, { timeout: 30000 });
  await sleep(1500);
  const act = await pages[0].evaluate(async () => (await import('/src/net/presence.js')).currentActivity());
  console.log('co-op NOW PLAYING activity:', JSON.stringify(act), act?.what === 'CO-OP ACT 1' && act.room ? 'ok' : 'FAIL');
  await pages[0].bringToFront(); await pages[0].mouse.move(2, 2); await sleep(400);
  await pages[0].screenshot({ path: path.join(OUT, 'coop_map_start.png') });
  // hover a floor-2 node
  const t = await pages[0].evaluate(() => {
    const s = window.__engine.Engine.scene, w = s.mapRun(), nodes = w.map.nodes;
    const n = Object.values(nodes).find(n => n.floor === 2);
    const [x, y] = s.nodePos(n); return { x, y: y - 8 };
  });
  const [hx, hy] = await toPage(pages[0], t.x, t.y);
  await pages[0].mouse.move(hx, hy); await sleep(400);
  await pages[0].screenshot({ path: path.join(OUT, 'coop_map_hover.png') });
  await ctx.close();
}

async function title(browser) {
  const page = await open(browser, `http://localhost:${PORT}/`);
  const ok = await page.evaluate(async () => {
    try {
      const p = await import('/src/net/presence.js');
      // sample data, as players:nowPlaying returns it
      p.__setNowPlaying([
        { names: ['CLIVE', 'STEPHEN'], what: 'CO-OP ACT 3' },
        { names: ['MARIA'], what: 'ACT 2 TORCHIC' },
        { names: ['JOEY'], what: 'ACT 4 RATTATA A3' },
      ]);
      return true;
    } catch { return false; }
  });
  await page.evaluate(() => { const s = window.__engine.Engine.scene; s.started = true; });
  await page.mouse.move(2, 2); await sleep(600);
  await page.screenshot({ path: path.join(OUT, ok ? 'title_now_playing.png' : 'title.png') });
  await page.context().close();
}

async function scale(browser) {
  // 1500x800 is 2.22x (AUTO letterboxes at 2x); 1100x700 is 1.72x (AUTO stretches with uneven pixels)
  for (const [w, h] of [[1500, 800], [1100, 700]]) {
    for (const mode of ['auto', 'pixel', 'fill']) {
      const page = await open(browser, `http://localhost:${PORT}/`, { width: w, height: h });
      const has = await page.evaluate(async (mode) => {
        const core = await import('/src/engine/core.js');
        if (!core.setDisplayMode) return false;
        G.meta.settings.display = mode; core.setDisplayMode(mode); return true;
      }, mode);
      if (!has && mode !== 'auto') { await page.context().close(); continue; }
      await page.evaluate(() => { const s = window.__engine.Engine.scene; s.started = true; });
      await page.mouse.move(2, 2); await sleep(500);
      const info = await page.evaluate(() => { const r = document.getElementById('game').getBoundingClientRect(); return `${r.width}x${r.height}`; });
      console.log(`scale ${w}x${h} ${mode}: canvas ${info}`);
      await page.screenshot({ path: path.join(OUT, `scale_${w}x${h}_${mode}.png`) });
      // 1:1 crop of the KANTO SPIRE banner text, where uneven pixel widths show
      const [cx, cy] = await toPage(page, 120, 205);
      await page.screenshot({ path: path.join(OUT, `scale_${w}x${h}_${mode}_crop.png`), clip: { x: Math.round(cx), y: Math.round(cy), width: 300, height: 110 } });
      await page.context().close();
    }
  }
  // the SETTINGS dialog with its new SCREEN row
  const page = await open(browser, `http://localhost:${PORT}/`);
  const ok = await page.evaluate(async () => {
    const t = await import('/src/scenes/title.js');
    window.__engine.Engine.scene.started = true;
    window.__engine.pushOverlay(new t.SettingsModal({})); return true;
  });
  await page.mouse.move(2, 2); await sleep(400);
  if (ok) await page.screenshot({ path: path.join(OUT, 'settings.png') });
  const [sx, sy] = await toPage(page, 340, 262);
  await page.mouse.move(sx, sy); await sleep(400);
  if (ok) await page.screenshot({ path: path.join(OUT, 'settings_screen_tip.png') });
  await page.context().close();
}

(async () => {
  const server = spawn(process.execPath, [path.join(ROOT, 'serve.cjs'), String(PORT), ...(process.env.SERVE_DIR ? [process.env.SERVE_DIR] : [])], { cwd: ROOT, stdio: 'ignore' });
  await sleep(700);
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'] });
  try {
    if (ONLY.includes('map')) await soloMap(browser);
    if (ONLY.includes('coop')) await coopMap(browser);
    if (ONLY.includes('title')) await title(browser);
    if (ONLY.includes('scale')) await scale(browser);
  } finally {
    await browser.close();
    server.kill();
  }
  console.log(errors.length ? 'page errors:\n' + errors.join('\n') : 'no page errors');
  console.log('screenshots in', OUT);
  process.exit(errors.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
