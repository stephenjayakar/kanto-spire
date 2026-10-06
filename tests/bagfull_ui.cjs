// Bag-full picker check on a phone (Pixel 7 emulation, taps only, muted Chromium). Starts its own server.
// An item ball with a full BAG opens the picker; its X leaves the item; MAKE ROOM... + SELL stores it.
//   node tests/bagfull_ui.cjs [port=8114] [outdir=tests/out]
const { spawn } = require('child_process');
const path = require('path');
const { chromium, devices } = require('playwright');
const port = +(process.argv[2] || 8114), out = process.argv[3] || 'tests/out';
const root = path.resolve(__dirname, '..');

(async () => {
  const server = spawn(process.execPath, [path.join(root, 'serve.cjs'), String(port)], { cwd: root, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 600));
  let browser;
  try { browser = await chromium.launch({ headless: true, args: ['--mute-audio'] }); }
  catch { browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio'] }); }
  const ctx = await browser.newContext({ ...devices['Pixel 7'] });
  const page = await ctx.newPage();
  const errors = [], fails = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  try {
    await page.goto(`http://localhost:${port}/`, { waitUntil: 'load' });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => window.G && window.__engine && !document.getElementById('loading'), null, { timeout: 30000 });
    await page.waitForTimeout(400);
    const tap = async (x, y, settle = 400) => {
      const r = await page.evaluate(() => { const c = document.getElementById('game').getBoundingClientRect(); return { l: c.left, t: c.top, w: c.width, h: c.height }; });
      await page.touchscreen.tap(r.l + x / 640 * r.w, r.t + y / 360 * r.h);
      await page.waitForTimeout(settle);
    };
    const state = () => page.evaluate(() => {
      const E = window.__engine.Engine, run = window.G.run, sc = E.scene;
      return { n: E.overlays.length, top: E.overlays.at(-1)?.constructor.name || null, scene: sc?.constructor.name, taken: !!sc?.taken, bag: run.consumables.slice(), money: run.money,
        log: (run.runLog?.events || []).filter(e => e.k === 'bagFull').map(e => e.did) };
    });
    const expect = async (label, pred) => { const s = await state(); const ok = pred(s); console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}  ${JSON.stringify(s)}`); if (!ok) fails.push(label); return s; };
    const layout = () => page.evaluate(() => { const o = window.__engine.Engine.overlays.at(-1); const L = o.constructor.layout(window.G.run.consumables.length); return { x: L.x, y: L.y, w: L.w, rows: [0, 1, 2, 3].map(L.rowY) }; });

    // A run with a full BAG standing at an item ball that holds a RARE CANDY.
    await page.evaluate(async () => {
      const { Run } = await import('/src/game/run.js');
      const { TreasureScene } = await import('/src/scenes/treasure.js');
      const run = Run.create({ seed: 'BAGUI', starter: 'CHARMANDER' });
      run.consumables = ['POTION', 'X_ATTACK', 'REVIVE'];
      run.inNode = true;
      window.G.run = run;
      const sc = new TreasureScene();
      window.__engine.setScene(sc);
      sc.item = 'RARE_CANDY'; sc.relics = [];
    });
    await page.waitForTimeout(300);
    await tap(320, 234, 700); // PICK IT UP
    const s0 = await expect('full BAG: item ball opens the picker', s => s.top === 'BagFullModal' && !s.taken);
    await page.screenshot({ path: `${out}/bagfull_picker.png` });
    let L = await layout();
    await tap(L.x + L.w - 17, L.y + 13); // the X
    await expect('tap X leaves it (nothing stored, bag untouched, logged)', s => s.n === 0 && !s.taken && s.bag.join() === 'POTION,X_ATTACK,REVIVE' && s.money === s0.money && s.log.at(-1) === 'left');
    await page.screenshot({ path: `${out}/bagfull_left.png` });
    await tap(320, 211); // MAKE ROOM...
    await expect('MAKE ROOM... reopens the picker', s => s.top === 'BagFullModal');
    L = await layout();
    await tap(L.x + L.w - 54, L.rows[1] + 20); // SELL on the first bag item (POTION, $150)
    await expect('SELL a bag item makes room: the RARE CANDY is stored', s => s.n === 0 && s.taken && s.bag.includes('RARE_CANDY') && !s.bag.includes('POTION') && s.money === s0.money + 150 && s.log.at(-1) === 'stored');
    await page.screenshot({ path: `${out}/bagfull_stored.png` });

    // MART with a full BAG: buying a POTION opens the picker before any money is taken.
    const shopState = () => page.evaluate(() => { const run = window.G.run, sc = window.__engine.Engine.scene; return { money: run.money, bag: run.consumables.slice(), say: sc.say }; });
    await page.evaluate(async () => {
      const { ShopScene } = await import('/src/scenes/shop.js');
      const run = window.G.run;
      run.consumables = ['X_ATTACK', 'X_DEFEND', 'REVIVE']; run.money = 5000; run.nodeId = 'bagui-shop';
      const sc = new ShopScene(); window.__engine.setScene(sc);
      window.__potion = sc.shop.items.find(i => i.key === 'POTION');
    });
    await page.waitForTimeout(300);
    const buyPotion = () => page.evaluate(() => { window.__engine.Engine.scene.buy(window.__potion); });
    await buyPotion(); await page.waitForTimeout(400);
    await expect('MART: buying into a full BAG opens the picker (no money taken)', s => s.top === 'BagFullModal' && s.money === 5000);
    await page.screenshot({ path: `${out}/bagfull_shop.png` });
    L = await layout();
    await tap(L.x + L.w - 17, L.y + 13); // X = don't buy
    let ss = await shopState();
    console.log(`${ss.money === 5000 && ss.bag.join() === 'X_ATTACK,X_DEFEND,REVIVE' ? 'ok  ' : 'FAIL'} MART: X = not bought, not charged  ${JSON.stringify(ss)}`);
    if (!(ss.money === 5000 && ss.bag.join() === 'X_ATTACK,X_DEFEND,REVIVE')) fails.push('mart X');
    await buyPotion(); await page.waitForTimeout(400);
    L = await layout();
    await tap(L.x + L.w - 54, L.rows[1] + 20); // SELL X ATTACK ($250), then the POTION is bought
    ss = await shopState();
    const price = await page.evaluate(() => window.__potion.price);
    const ok = ss.money === 5000 + 250 - price && ss.bag.includes('POTION') && !ss.bag.includes('X_ATTACK');
    console.log(`${ok ? 'ok  ' : 'FAIL'} MART: SELL makes room, then it's bought and charged once  ${JSON.stringify(ss)}`);
    if (!ok) fails.push('mart sell+buy');
  } catch (e) { fails.push('exception: ' + e.message); console.log(e); }
  if (errors.length) { console.log('page errors:', errors); fails.push('page errors'); }
  await browser.close();
  server.kill();
  console.log(fails.length ? `FAILED: ${fails.join('; ')}` : 'all ok');
  process.exit(fails.length ? 1 : 0);
})();
