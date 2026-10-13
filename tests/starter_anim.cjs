// v0.5.11: the new game screens show Emerald's front art, and a clicked/tapped starter plays Emerald's front animation
// (anim/front_anim.js: anim_front.png's 2nd frame + the species' motion) with its cry. In muted Chrome: solo starter
// select on desktop (mouse) and a Pixel 7 (touch), the co-op lobby (?coopdev mock backend), and the FireRed fallback
// when the Emerald art is missing. Checks the animation plays and ends, re-clicking restarts it, selection is as before.
//   node tests/starter_anim.cjs [port=8146] [outdir=tests/out/starter_anim]
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { chromium, devices } = require('playwright');
const port = +(process.argv[2] || 8146), out = process.argv[3] || 'tests/out/starter_anim';
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
    await page.bringToFront();
    return page;
  };
  // game coords (640x360) -> page coords
  const toPage = async (page, x, y) => { const r = await page.evaluate(() => { const c = document.getElementById('game').getBoundingClientRect(); return { l: c.left, t: c.top, w: c.width, h: c.height }; }); return [r.l + x / 640 * r.w, r.t + y / 360 * r.h]; };
  // is the Emerald front art (not its FireRed fallback) what the screen draws?
  const emeraldShown = (page, sp) => page.evaluate(async (sp) => {
    const { img, ready } = await import('/src/engine/assets.js'); const { foeSprite } = await import('/src/scenes/common.js');
    const im = img(foeSprite(sp, false, 'hoenn', false)); return ready(im) && !im._fb;
  }, sp);
  const soloStarter = async (page, label, press, emerald = true) => {
    await page.evaluate(async () => { const { StarterScene } = await import('/src/scenes/starter.js'); window.__engine.setScene(new StarterScene()); });
    await page.waitForTimeout(700);
    check(`${label}: ${emerald ? 'Emerald' : 'FireRed (fallback)'} art`, (await emeraldShown(page, 'SQUIRTLE')) === emerald);
    const cell = (sp) => page.evaluate((sp) => { const s = window.__engine.Engine.scene; const i = s.list.findIndex(x => x.species === sp); return [i, 150 + (476 - (7 * 68 - 4)) / 2 + (i % 7) * 68 + 32, 52 + Math.floor(i / 7) * 62 + 30]; }, sp);
    const state = () => page.evaluate(() => { const s = window.__engine.Engine.scene, a = s.anim; return { sel: s.sel, i: a?.i, at: a?.at, n: a?.fa.n, frame: a?.fa.frame, x2: a?.fa.s.x2, rot: a?.fa.s.aff?.rot || 0 }; });
    const [i, x, y] = await cell('SQUIRTLE');
    // (headless Chrome draws slowly here and the game clamps dt, so wait on game time, not wall time)
    const until = (fn, arg) => page.waitForFunction(fn, arg, { timeout: 30000, polling: 50 }).catch(() => {});
    const animN = (n) => until((n) => (window.__engine.Engine.scene.anim?.fa.n ?? -1) >= n, n);
    const animGone = () => until(() => !window.__engine.Engine.scene.anim);
    await press(...await toPage(page, x, y));
    await animN(20);
    let st = await state();
    await page.screenshot({ path: `${out}/${label}_mid.png` });
    check(`${label}: click selects SQUIRTLE`, st.sel === i, `sel ${st.sel}`);
    // SQUIRTLE: anim_front frame 1 for 100 GBA frames, SWING_CONCAVE (x2 = -Sin(i, 10), rotation Sin(i, 3276)) for 101
    check(`${label}: front animation playing (frame 1 + swing)`, st.i === i && st.frame === 1 && (st.x2 !== 0 || st.rot !== 0), JSON.stringify(st));
    await animGone();
    st = await state();
    check(`${label}: animation ends (sprite back to rest)`, st.i === undefined, JSON.stringify(st));
    await page.screenshot({ path: `${out}/${label}_end.png` });
    await press(...await toPage(page, x, y));
    await animN(30);
    const s1 = await state();
    await press(...await toPage(page, x, y));
    await until((at) => (window.__engine.Engine.scene.anim?.at ?? 0) > at, s1.at);
    const s2 = await state();
    check(`${label}: re-click restarts it`, s1.i === i && s2.i === i && s2.at > s1.at && s2.n < s1.n && s2.sel === i, `${s1.n} -> ${s2.n}`);
    // GASTLY (GLOW_BLACK) and BULBASAUR (V_JUMPS_H_JUMPS) mid-animation, for the eye
    for (const [sp, ms] of [['GASTLY', 1000], ['BULBASAUR', 450]]) {
      const [, gx, gy] = await cell(sp);
      await press(...await toPage(page, gx, gy)); await animN(Math.round(ms * 0.06));
      await page.screenshot({ path: `${out}/${label}_${sp.toLowerCase()}.png` });
    }
    const [li, lx, ly] = await cell('DRATINI');
    if (li >= 0) { await animGone(); const before = await state(); await press(...await toPage(page, lx, ly)); await page.waitForTimeout(60); st = await state(); check(`${label}: locked starter ignored`, st.sel === before.sel && st.i === undefined, `sel ${st.sel}`); }
  };
  try {
    const desk = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const p = await open(desk, 'desktop');
    await soloStarter(p, 'desktop', (x, y) => p.mouse.click(x, y));
    await p.close();
    const mob = await browser.newContext({ ...devices['Pixel 7'] });
    const m = await open(mob, 'mobile');
    await soloStarter(m, 'mobile', (x, y) => m.touchscreen.tap(x, y));
    await mob.close();
    // no Emerald art (a player who never extracted it): FireRed's sprites, the motion still plays, no errors
    const bare = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    await bare.route('**/gfx/pokemon/emerald/**', r => r.fulfill({ status: 404, body: '' }));
    const f = await open(bare, 'fallback');
    await soloStarter(f, 'fallback', (x, y) => f.mouse.click(x, y), false);
    await bare.close();

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
    await p1.bringToFront(); await p1.waitForTimeout(1000); // (a background tab gets no animation frames)
    const lob = () => p1.evaluate(() => { const s = window.__engine.Engine.scene, a = s.anim, v = s.view; return { sp: a?.sp, at: a?.at, n: a?.fa.n, y2: a?.fa.s.y2, starter: v?.members?.find(x => x.slot === v.me)?.starter ?? v?.members?.[0]?.starter }; });
    // 3rd tile: SQUIRTLE (the KANTO three first)
    const tile = await toPage(p1, 232 + 2 * 66 + 31, 78 + 37);
    const until1 = (fn, arg) => p1.waitForFunction(fn, arg, { timeout: 30000, polling: 50 }).catch(() => {});
    await p1.mouse.click(...tile);
    await until1(() => (window.__engine.Engine.scene.anim?.fa.n ?? -1) >= 20);
    let l = await lob();
    await p1.screenshot({ path: `${out}/coop_mid.png` });
    check('co-op: click starts the front animation', l.sp === 'SQUIRTLE' && l.n > 10, JSON.stringify(l));
    await until1(() => { const v = window.__engine.Engine.scene.view; return v?.members?.some(x => x.starter === 'SQUIRTLE'); });
    l = await lob();
    check('co-op: starter picked as before', l.starter === 'SQUIRTLE', String(l.starter));
    const at0 = l.at;
    await p1.mouse.click(...tile);
    await until1((at) => (window.__engine.Engine.scene.anim?.at ?? 0) > at, at0);
    l = await lob();
    check('co-op: re-click on the picked starter restarts it', l.at > at0);
    await until1(() => !window.__engine.Engine.scene.anim);
    l = await lob();
    check('co-op: animation ends', l.sp === undefined);
    await p1.screenshot({ path: `${out}/coop_end.png` });
  } catch (e) { check('harness: ' + e.message, false); }
  console.log(errors.length ? 'PAGE ERRORS:\n' + errors.join('\n') : 'no page errors');
  console.log(fails.length ? `FAILED: ${fails.length}` : 'all checks passed');
  await browser.close(); server.kill();
  process.exit(fails.length || errors.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
