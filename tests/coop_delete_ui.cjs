// The co-op menu's REJOIN list: the X on a room asks to confirm, then deletes it (?coopdev mock backend, two
// players in one browser context; real clicks). Muted Chrome, offline build.
//   node tests/coop_delete_ui.cjs [port=8149] [outdir=tests/out/visfix/rooms]
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const port = +(process.argv[2] || 8149), out = process.argv[3] || 'tests/out/visfix/rooms';
const root = path.resolve(__dirname, '..');
fs.mkdirSync(out, { recursive: true });

(async () => {
  const server = spawn(process.execPath, [path.join(root, 'serve.cjs'), String(port)], { cwd: root, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 700));
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const errors = [], fails = [];
  const check = (label, ok, info = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${label} ${info}`); if (!ok) fails.push(label); };
  const g = (x, y) => [x * 2, y * 2];
  try {
    const p1 = await ctx.newPage(), p2 = await ctx.newPage();
    for (const p of [p1, p2]) p.on('pageerror', e => errors.push(e.message));
    await p1.goto(`http://localhost:${port}/?coopdev=RED`, { waitUntil: 'load' });
    await p1.evaluate(() => localStorage.clear());
    for (const [p, n] of [[p1, 'RED'], [p2, 'BLUE']]) {
      await p.goto(`http://localhost:${port}/?coopdev=${n}`, { waitUntil: 'load' });
      await p.waitForFunction(() => window.__ready && window.G?.meta, null, { timeout: 60000 });
    }
    const net = (p, fn, ...arg) => p.evaluate(async ({ fn, arg }) => { const n = await import('/src/scenes/coop/mocknet.js'); return n[fn](...arg); }, { fn, arg });
    // two rooms for RED: a lobby (host) and a run in progress with BLUE
    const lobbyRoom = await net(p1, 'createRoom', { ascension: 0, world: 'kanto' });
    const run = await net(p1, 'createRoom', { ascension: 0, world: 'kanto' });
    await net(p2, 'joinRoom', run.code);
    await net(p1, 'setStarter', run.roomId, 'CHARMANDER', 0); await net(p2, 'setStarter', run.roomId, 'SQUIRTLE', 0);
    await net(p1, 'startRoom', run.roomId);
    const menu = (p) => p.evaluate(async () => { const { CoopLobbyScene } = await import('/src/scenes/coop/lobby.js'); window.__engine.setScene(new CoopLobbyScene()); });
    await menu(p1); await p1.waitForTimeout(800);
    const list = (p) => p.evaluate(() => (window.__engine.Engine.scene.rooms || []).map(r => r.code));
    check('RED sees both rooms', (await list(p1)).length === 2, JSON.stringify(await list(p1)));
    await p1.mouse.move(...g(300 + 280 - 21, 90 + 15)); await p1.waitForTimeout(200);
    await p1.screenshot({ path: `${out}/rejoin_list_x.png` });
    // delete the run in progress (the first row = most recently updated)
    const first = (await p1.evaluate(() => window.__engine.Engine.scene.rooms[0].code));
    await p1.mouse.click(...g(300 + 280 - 21, 90 + 15)); await p1.waitForTimeout(400);
    check('the X asks to confirm', await p1.evaluate(() => /Delete room/.test(window.__engine.Engine.overlays.at(-1)?.title || '')));
    await p1.screenshot({ path: `${out}/delete_confirm.png` });
    // "Keep it" first, then Delete
    const optY = (i) => p1.evaluate((i) => { const o = window.__engine.Engine.overlays.at(-1); return o.options[i].label; }, i);
    await p1.evaluate(() => window.__engine.Engine.overlays.at(-1).close(0)); await p1.waitForTimeout(300);
    check('Keep it: still listed', (await list(p1)).includes(first));
    await p1.mouse.click(...g(300 + 280 - 21, 90 + 15)); await p1.waitForTimeout(400);
    await p1.evaluate(() => window.__engine.Engine.overlays.at(-1).close(1)); await p1.waitForTimeout(1200);
    check('Delete: gone from RED\'s list', !(await list(p1)).includes(first), JSON.stringify(await list(p1)));
    await menu(p2); await p2.waitForTimeout(800);
    check('BLUE still has the run', (await list(p2)).includes(run.code));
    // delete the remaining lobby room (RED hosts it): closes it
    await p1.mouse.click(...g(300 + 280 - 21, 90 + 15)); await p1.waitForTimeout(400);
    await p1.evaluate(() => window.__engine.Engine.overlays.at(-1).close(1)); await p1.waitForTimeout(1200);
    check('RED\'s list is empty', (await list(p1)).length === 0);
    await p1.screenshot({ path: `${out}/rejoin_list_empty.png` });
  } catch (e) { check('harness: ' + e.message, false); }
  console.log(errors.length ? 'PAGE ERRORS:\n' + errors.join('\n') : 'no page errors');
  console.log(fails.length ? `FAILED: ${fails.length}` : 'all checks passed');
  await browser.close(); server.kill();
  process.exit(fails.length || errors.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
