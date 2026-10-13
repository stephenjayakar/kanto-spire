// v0.5.10: a clicked/tapped starter replays its battle entrance (scenes/common.js foeEntryX), in muted Chrome:
// solo starter select on desktop (mouse) and a Pixel 7 (touch), and the co-op lobby (?coopdev mock backend).
// Checks the slide starts, settles back to 0, re-clicking restarts it, and selection works as before.
//   node tests/starter_entry.cjs [port=8146] [outdir=tests/out/starter_entry]
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { chromium, devices } = require('playwright');
const port = +(process.argv[2] || 8146), out = process.argv[3] || 'tests/out/starter_entry';
const root = path.resolve(__dirname, '..');
fs.mkdirSync(out, { recursive: true });

(async () => {
  const server = spawn(process.execPath, [path.join(root, 'serve.cjs'), String(port)], { cwd: root, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 700));
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio'] });
  const errors = [], fails = [];
  const check = (label, ok, info = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${label} ${info}`); if (!ok) fails.push(label); };
  const watch = (p, name) => { p.on('pageerror', e => errors.push(`${name}: ${e.message}`)); p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`${name}: ${m.text()}`); }); };
  const open = async (ctx, name, query = '') => {
    const page = await ctx.newPage(); watch(page, name);
    await page.route('**/cloud.json', r => r.fulfill({ status: 404, body: '' }));
    await page.goto(`http://localhost:${port}/${query}`, { waitUntil: 'load' });
    await page.evaluate(() => { localStorage.clear(); localStorage.setItem('kantospire.meta.v1', JSON.stringify({ tutorialDone: true, seenVersion: 'v9', unlockedStarters: ['BULBASAUR', 'CHARMANDER', 'SQUIRTLE', 'GASTLY'], starterVer: 2 })); });
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => window.__ready && window.G?.meta && window.__engine, null, { timeout: 60000 });
    return page;
  };
  // game coords (640x360) -> page coords
  const toPage = async (page, x, y) => { const r = await page.evaluate(() => { const c = document.getElementById('game').getBoundingClientRect(); return { l: c.left, t: c.top, w: c.width, h: c.height }; }); return [r.l + x / 640 * r.w, r.t + y / 360 * r.h]; };
  const soloStarter = async (page, label, press) => {
    await page.evaluate(async () => { const { StarterScene } = await import('/src/scenes/starter.js'); window.__engine.setScene(new StarterScene()); });
    await page.waitForTimeout(500);
    const cell = (sp) => page.evaluate((sp) => { const s = window.__engine.Engine.scene; const i = s.list.findIndex(x => x.species === sp); return [i, 150 + (476 - (7 * 68 - 4)) / 2 + (i % 7) * 68 + 32, 52 + Math.floor(i / 7) * 62 + 30]; }, sp);
    const state = () => page.evaluate(() => { const s = window.__engine.Engine.scene; return { sel: s.sel, entry: s.entry, x: s.entry ? s.entryX(s.entry.i) : 0, t: s.t }; });
    const [i, x, y] = await cell('SQUIRTLE');
    await press(...await toPage(page, x, y));
    await page.waitForTimeout(60);
    let st = await state();
    await page.screenshot({ path: `${out}/${label}_mid.png` });
    check(`${label}: click selects SQUIRTLE`, st.sel === i, `sel ${st.sel}`);
    check(`${label}: entrance playing (offset > 0)`, st.entry?.i === i && st.x > 0, `x ${st.x}`);
    await page.waitForTimeout(500);
    st = await state();
    check(`${label}: entrance settles at 0`, st.x === 0, `x ${st.x}`);
    await page.screenshot({ path: `${out}/${label}_end.png` });
    const at0 = st.entry.at;
    await press(...await toPage(page, x, y));
    await page.waitForTimeout(60);
    st = await state();
    check(`${label}: re-click restarts it`, st.entry.at > at0 && st.x > 0 && st.sel === i, `x ${st.x}`);
    // a locked starter: no selection change, no entrance (as before)
    const [li, lx, ly] = await cell('DRATINI');
    if (li >= 0) { await page.waitForTimeout(500); await press(...await toPage(page, lx, ly)); await page.waitForTimeout(60); st = await state(); check(`${label}: locked starter ignored`, st.sel === i && st.entry.i === i, `sel ${st.sel}`); }
  };
  try {
    const desk = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const p = await open(desk, 'desktop');
    await soloStarter(p, 'desktop', (x, y) => p.mouse.click(x, y));
    const mob = await browser.newContext({ ...devices['Pixel 7'] });
    const m = await open(mob, 'mobile');
    await soloStarter(m, 'mobile', (x, y) => m.touchscreen.tap(x, y));

    // co-op lobby
    const p1 = await open(desk, 'host', '?coopdev=HOST'), p2 = await open(desk, 'guest', '?coopdev=GUEST');
    const net = (pg, fn, arg) => pg.evaluate(async ({ fn, arg }) => { const n = await import('/src/scenes/coop/mocknet.js'); return n[fn](...arg); }, { fn, arg });
    const r = await net(p1, 'createRoom', [{ ascension: 0, world: 'kanto' }]);
    await net(p2, 'joinRoom', [r.code]);
    await p1.evaluate(async (roomId) => {
      const { CoopLobbyScene } = await import('/src/scenes/coop/lobby.js');
      const s = new CoopLobbyScene(); window.__engine.setScene(s);
      for (let i = 0; i < 50 && !s.net; i++) await new Promise(res => setTimeout(res, 100));
      s.openRoom(roomId);
    }, r.roomId);
    await p1.waitForTimeout(1000);
    await p1.bringToFront(); await p1.waitForTimeout(300);
    // first tile (232 + 31, 78 + 37)
    const lob = () => p1.evaluate(() => { const s = window.__engine.Engine.scene; const v = s.view; return { entry: s.entry, t: s.t, starter: v?.members?.find(x => x.slot === v.me)?.starter ?? v?.members?.[0]?.starter }; });
    await p1.mouse.click(...await toPage(p1, 232 + 31, 78 + 37));
    await p1.waitForTimeout(80);
    let l = await lob();
    await p1.screenshot({ path: `${out}/coop_mid.png` });
    check('co-op: click starts the entrance', !!l.entry && l.t - l.entry.at < 0.4, JSON.stringify(l.entry));
    await p1.waitForTimeout(1200);
    l = await lob();
    check('co-op: starter picked as before', !!l.starter, String(l.starter));
    const at0 = l.entry.at;
    await p1.mouse.click(...await toPage(p1, 232 + 31, 78 + 37));
    await p1.waitForTimeout(80);
    l = await lob();
    check('co-op: re-click on the picked starter replays it', l.entry.at > at0);
    await p1.waitForTimeout(600);
    await p1.screenshot({ path: `${out}/coop_end.png` });
  } catch (e) { check('harness: ' + e.message, false); }
  console.log(errors.length ? 'PAGE ERRORS:\n' + errors.join('\n') : 'no page errors');
  console.log(fails.length ? `FAILED: ${fails.length}` : 'all checks passed');
  await browser.close(); server.kill();
  process.exit(fails.length || errors.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
