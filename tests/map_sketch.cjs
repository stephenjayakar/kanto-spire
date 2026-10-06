// Map sketches (Slay the Spire style): right-drag draws on the act map, PEN lets a plain drag draw, ERASE
// (bottom left) wipes them; solo they're saved with the run (one sketch per act); in co-op each player's
// strokes show up for the partner in their colour, and ERASE wipes both. Real mouse input, muted Chrome,
// offline build (?coopdev mock backend for co-op, two pages in one context).
//   node tests/map_sketch.cjs [port=8146] [outdir=tests/out/visfix/sketch]
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const port = +(process.argv[2] || 8146), out = process.argv[3] || 'tests/out/visfix/sketch';
const root = path.resolve(__dirname, '..');
fs.mkdirSync(out, { recursive: true });

(async () => {
  const server = spawn(process.execPath, [path.join(root, 'serve.cjs'), String(port)], { cwd: root, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 700));
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const errors = [], fails = [];
  const check = (label, ok, info = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${label} ${info}`); if (!ok) fails.push(label); };
  const watch = (p, name) => { p.on('pageerror', e => errors.push(`${name}: ${e.message}`)); p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`${name}: ${m.text()}`); }); };
  const g = (x, y) => [x * 2, y * 2]; // game pixels -> page (the game shows at 2x)
  // a right-button (or left) drag through game-pixel points
  const drag = async (p, pts, button = 'right') => {
    await p.mouse.move(...g(...pts[0])); await p.mouse.down({ button });
    for (const pt of pts.slice(1)) { await p.mouse.move(...g(...pt), { steps: 4 }); await p.waitForTimeout(20); }
    await p.mouse.up({ button }); await p.waitForTimeout(150);
  };
  try {
    // ---------------- solo ----------------
    const page = await ctx.newPage(); watch(page, 'solo');
    await page.goto(`http://localhost:${port}/`, { waitUntil: 'load' });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => window.__ready && window.G?.meta, null, { timeout: 60000 });
    const newMap = () => page.evaluate(async () => {
      Object.assign(G.meta, { tutorialDone: true, seenVersion: 'v9' });
      const { MapScene } = await import('/src/scenes/map.js');
      const s = new MapScene({}); window.__engine.setScene(s); s.banner = null;
    });
    await page.evaluate(async () => {
      const { Run } = await import('/src/game/run.js');
      const { saveRun } = await import('/src/game/state.js');
      const r = Run.create({ starter: 'CHARMANDER', seed: 'SKETCH' }); G.run = r; saveRun();
    });
    await newMap();
    await page.waitForTimeout(500);
    const st = () => page.evaluate(() => ({ strokes: (G.run.sketch?.strokes || []).length, pts: (G.run.sketch?.strokes || []).reduce((a, s) => a + s.length / 2, 0), node: G.run.nodeId, scene: window.__engine.Engine.scene.constructor.name, scroll: window.__engine.Engine.scene.scroll }));
    const s0 = await st();
    await page.screenshot({ path: `${out}/solo_0_empty.png` });
    // a right-drag route from the start up the map (through nodes: none may be entered)
    await drag(page, [[320, 340], [300, 300], [280, 260], [300, 220], [330, 180]]);
    let s1 = await st();
    check('right-drag draws a stroke', s1.strokes === 1 && s1.pts >= 5, JSON.stringify(s1));
    check('right-drag never travels', s1.scene === 'MapScene' && s1.node === s0.node);
    await drag(page, [[200, 300], [210, 280], [230, 270]]);
    await page.mouse.click(...g(420, 100), { button: 'right' }); await page.waitForTimeout(150); // a dot
    s1 = await st();
    check('more strokes and a dot', s1.strokes === 3, JSON.stringify(s1));
    await page.mouse.move(...g(600, 350));
    await page.screenshot({ path: `${out}/solo_1_sketched.png` });
    // saved with the run: survives a reload
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('kantospire.run.v1')).sketch);
    check('saved with the run', saved && saved.act === 0 && saved.strokes.length === 3);
    // scrolling the map moves the sketch with it (map coordinates)
    await page.mouse.move(...g(320, 200)); await page.mouse.wheel(0, -300); await page.waitForTimeout(300);
    const scrolled = await st();
    check('the map scrolls (the sketch is stored in map coordinates)', scrolled.scroll > s0.scroll, `scroll ${s0.scroll} -> ${scrolled.scroll}`);
    await page.screenshot({ path: `${out}/solo_2_scrolled.png` });
    await page.mouse.wheel(0, 300); await page.waitForTimeout(300);
    // PEN: a plain drag draws, and a click on a node doesn't travel
    await page.mouse.click(...g(122, 343)); await page.waitForTimeout(150); // PEN button
    check('PEN turns on', await page.evaluate(() => window.__engine.Engine.scene.pen === true));
    await drag(page, [[380, 330], [390, 310], [400, 290]], 'left');
    const nodeXY = await page.evaluate(() => { const s = window.__engine.Engine.scene, n = G.run.map.nodes[G.run.map.start[0]]; return s.nodePos(n); });
    await page.mouse.click(...g(nodeXY[0], nodeXY[1] - 6)); await page.waitForTimeout(800);
    let s2 = await st();
    check('PEN: a plain drag draws', s2.strokes >= 4, JSON.stringify(s2));
    check('PEN: clicking a node does not travel', s2.scene === 'MapScene' && s2.node === s0.node);
    await page.mouse.click(...g(122, 343)); await page.waitForTimeout(150); // PEN off
    // ERASE (bottom left)
    await page.mouse.click(...g(47, 343)); await page.waitForTimeout(200);
    const s3 = await st();
    check('ERASE wipes every sketch', s3.strokes === 0, JSON.stringify(s3));
    check('ERASE is saved', (await page.evaluate(() => JSON.parse(localStorage.getItem('kantospire.run.v1')).sketch.strokes.length)) === 0);
    await page.screenshot({ path: `${out}/solo_3_erased.png` });
    // one sketch per act: a new act starts clean
    await drag(page, [[320, 340], [320, 300]]);
    await page.evaluate(() => { G.run.startAct(1); });
    await newMap(); await page.waitForTimeout(300);
    check('a new act starts with a clean map', (await page.evaluate(() => window.__engine.Engine.scene.mySketch().strokes.length)) === 0);
    // without PEN a left click on a node still travels
    await page.evaluate(() => { G.run.startAct(0); G.run.nodeId = null; G.run.floor = -1; G.run.visited = []; });
    await newMap(); await page.waitForTimeout(400);
    const n0 = await page.evaluate(() => { const s = window.__engine.Engine.scene, n = G.run.map.nodes[G.run.map.start[0]]; return s.nodePos(n); });
    await page.mouse.click(...g(n0[0], n0[1] - 6)); await page.waitForTimeout(1500);
    check('PEN off: clicking a node travels again', (await st()).scene !== 'MapScene' || (await st()).node !== null);

    // ---------------- co-op (mock backend) ----------------
    const p1 = await ctx.newPage(), p2 = await ctx.newPage(); watch(p1, 'P1'); watch(p2, 'P2');
    await p1.goto(`http://localhost:${port}/?coopdev=RED`, { waitUntil: 'load' });
    await p1.evaluate(() => localStorage.clear());
    for (const [p, name] of [[p1, 'RED'], [p2, 'BLUE']]) {
      await p.goto(`http://localhost:${port}/?coopdev=${name}`, { waitUntil: 'load' });
      await p.waitForFunction(() => window.__ready && window.G?.meta, null, { timeout: 60000 });
      await p.evaluate(() => { Object.assign(G.meta, { tutorialDone: true, seenVersion: 'v9' }); G.meta.settings.fast = true; });
    }
    const net = (p, fn, ...arg) => p.evaluate(async ({ fn, arg }) => { const n = await import('/src/scenes/coop/mocknet.js'); return n[fn](...arg); }, { fn, arg });
    const r = await net(p1, 'createRoom', { ascension: 0, world: 'kanto' });
    await net(p2, 'joinRoom', r.code);
    await net(p1, 'setStarter', r.roomId, 'CHARMANDER', 0);
    await net(p2, 'setStarter', r.roomId, 'SQUIRTLE', 0);
    await net(p1, 'setReady', r.roomId, true); await net(p2, 'setReady', r.roomId, true);
    await net(p1, 'startRoom', r.roomId);
    for (const p of [p1, p2]) await p.evaluate(async (roomId) => {
      const { CoopLobbyScene } = await import('/src/scenes/coop/lobby.js');
      const s = new CoopLobbyScene(); window.__engine.setScene(s);
      for (let i = 0; i < 50 && !s.net; i++) await new Promise(res => setTimeout(res, 100));
      s.openRoom(roomId);
    }, r.roomId);
    for (const p of [p1, p2]) await p.waitForFunction(() => window.__engine.Engine.scene?.constructor?.name === 'CoopMapScene', null, { timeout: 20000 });
    await p1.waitForTimeout(800);
    await drag(p1, [[320, 330], [300, 290], [280, 250]]);
    await p1.mouse.move(...g(600, 350));
    const seen = await p2.waitForFunction(() => (window.__engine.Engine.scene.otherSketches()[0]?.strokes.length || 0) >= 1, null, { timeout: 8000 }).then(() => true).catch(() => false);
    check('co-op: P1\'s sketch shows up for P2', seen);
    await drag(p2, [[360, 330], [380, 290], [400, 250]]);
    const seen2 = await p1.waitForFunction(() => (window.__engine.Engine.scene.otherSketches()[0]?.strokes.length || 0) >= 1, null, { timeout: 8000 }).then(() => true).catch(() => false);
    check('co-op: P2\'s sketch shows up for P1', seen2);
    check('co-op: each keeps their own strokes too', (await p1.evaluate(() => window.__engine.Engine.scene.mySketch().strokes.length)) === 1 && (await p2.evaluate(() => window.__engine.Engine.scene.mySketch().strokes.length)) === 1);
    await p2.mouse.move(...g(600, 350)); await p1.waitForTimeout(300);
    await p1.screenshot({ path: `${out}/coop_1_P1_view.png` });
    await p2.screenshot({ path: `${out}/coop_1_P2_view.png` });
    // a reload keeps both (the server has them)
    // ERASE on P2 wipes both players' sketches
    await p2.mouse.click(...g(47, 343)); await p2.waitForTimeout(200);
    const wiped = await p1.waitForFunction(() => { const s = window.__engine.Engine.scene; return s.mySketch().strokes.length === 0 && !s.otherSketches().length; }, null, { timeout: 8000 }).then(() => true).catch(() => false);
    check('co-op: ERASE wipes both players\' sketches', wiped && (await p2.evaluate(() => { const s = window.__engine.Engine.scene; return s.mySketch().strokes.length === 0 && !s.otherSketches().length; })));
    await p1.screenshot({ path: `${out}/coop_2_erased.png` });
    // sketches never touch the game log (no desync)
    check('co-op: no desync', !(await p1.evaluate(() => G.coop?.desync)) && !(await p2.evaluate(() => G.coop?.desync)));
  } catch (e) { check('harness: ' + e.message, false); }
  console.log(errors.length ? 'PAGE ERRORS:\n' + errors.join('\n') : 'no page errors');
  console.log(fails.length ? `FAILED: ${fails.length}` : 'all checks passed');
  await browser.close(); server.kill();
  process.exit(fails.length || errors.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
