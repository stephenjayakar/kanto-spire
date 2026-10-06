// Co-op "?" events: both players see the SAME event, and it stays the same after the partner finishes first or a
// reload. Two players on the ?coopdev mock backend (two pages in one context). Muted Chrome, offline build.
//   node tests/coop_same_event.cjs [port=8152] [outdir=tests/out/visfix/coop_event]
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const port = +(process.argv[2] || 8152), out = process.argv[3] || 'tests/out/visfix/coop_event';
const root = path.resolve(__dirname, '..');
fs.mkdirSync(out, { recursive: true });

(async () => {
  const server = spawn(process.execPath, [path.join(root, 'serve.cjs'), String(port)], { cwd: root, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 700));
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const errors = [], fails = [];
  const check = (label, ok, info = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${label} ${info}`); if (!ok) fails.push(label); };
  try {
    const p1 = await ctx.newPage(), p2 = await ctx.newPage();
    for (const [p, n] of [[p1, 'P1'], [p2, 'P2']]) p.on('pageerror', e => errors.push(`${n}: ${e.message}`));
    await p1.goto(`http://localhost:${port}/?coopdev=RED`, { waitUntil: 'load' });
    await p1.evaluate(() => localStorage.clear());
    for (const [p, n] of [[p1, 'RED'], [p2, 'BLUE']]) {
      await p.goto(`http://localhost:${port}/?coopdev=${n}`, { waitUntil: 'load' });
      await p.waitForFunction(() => window.__ready && window.G?.meta, null, { timeout: 60000 });
      await p.evaluate(() => { Object.assign(G.meta, { tutorialDone: true, seenVersion: 'v9' }); G.meta.settings.fast = true; });
    }
    const net = (p, fn, ...arg) => p.evaluate(async ({ fn, arg }) => { const n = await import('/src/scenes/coop/mocknet.js'); return n[fn](...arg); }, { fn, arg });
    const r = await net(p1, 'createRoom', { ascension: 0, world: 'kanto' });
    await net(p2, 'joinRoom', r.code);
    await net(p1, 'setStarter', r.roomId, 'CHARMANDER', 0);
    await net(p2, 'setStarter', r.roomId, 'SQUIRTLE', 0);
    await net(p1, 'startRoom', r.roomId);
    for (const p of [p1, p2]) await p.evaluate(async (roomId) => {
      const { CoopLobbyScene } = await import('/src/scenes/coop/lobby.js');
      const s = new CoopLobbyScene(); window.__engine.setScene(s);
      for (let i = 0; i < 50 && !s.net; i++) await new Promise(res => setTimeout(res, 100));
      s.openRoom(roomId);
    }, r.roomId);
    for (const p of [p1, p2]) await p.waitForFunction(() => window.__engine.Engine.scene?.constructor?.name === 'CoopMapScene', null, { timeout: 20000 });
    // floor 0 has no "?" nodes: make the same start node an event node on both clients (node types aren't in the
    // checksum; different player histories are covered by tests/coop.test.mjs)
    const nodeId = await p1.evaluate(() => G.coop.game.reachable()[0]);
    for (const p of [p1, p2]) await p.evaluate((id) => { G.coop.game.world.map.nodes[id].type = 'event'; }, nodeId);
    for (const p of [p1, p2]) await p.evaluate((id) => G.coop.vote(id), nodeId);
    for (const p of [p1, p2]) await p.waitForFunction(() => window.__engine.Engine.scene?.constructor?.name === 'EventScene' || window.__engine.Engine.scene?.inner?.constructor?.name === 'EventScene' || !!window.__engine.Engine.scene?.ev, null, { timeout: 20000 });
    const evOf = (p) => p.evaluate(() => { const s = window.__engine.Engine.scene; const e = s.ev || s.inner?.ev; return e?.id || null; });
    const e1 = await evOf(p1), e2 = await evOf(p2);
    check('both players see the same event', e1 && e1 === e2, `${e1} / ${e2}`);
    await p1.waitForTimeout(600);
    await p1.screenshot({ path: `${out}/P1_event.png` });
    await p2.screenshot({ path: `${out}/P2_event.png` });
    // P1 finishes first: P2 still has the same event (also after re-opening the scene, like a reload would)
    // (leaving posts P1's run, whose seenEvents now include this event)
    await p1.evaluate(async () => { const { goToMap } = await import('/src/scenes/flow.js'); goToMap(); });
    await p2.waitForTimeout(1500);
    const again = await p2.evaluate(async () => { const { EventScene } = await import('/src/scenes/event.js'); const s = new EventScene(); G.run.pendingEventId = null; s.enter(); return s.ev.id; });
    check('after the partner finished, the event is still the same', again === e1, `${again}`);
    const ds = await Promise.all([p1, p2].map(p => p.evaluate(() => JSON.stringify(G.coop?.desync || null))));
    check('no desync', ds.every(d => d === 'null'), ds.join(' | '));
  } catch (e) { check('harness: ' + e.message, false); }
  console.log(errors.length ? 'PAGE ERRORS:\n' + errors.join('\n') : 'no page errors');
  console.log(fails.length ? `FAILED: ${fails.length}` : 'all checks passed');
  await browser.close(); server.kill();
  process.exit(fails.length || errors.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
