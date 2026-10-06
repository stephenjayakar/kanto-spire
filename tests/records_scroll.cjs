// RECORDS lists scroll (wheel, drag, keys) under fixed headers. Fake rows (the offline build has no cloud).
// Muted Chrome, own static server.   node tests/records_scroll.cjs [port=8135] [outdir=tests/out/visfix/records]
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const port = +(process.argv[2] || 8135), out = process.argv[3] || 'tests/out/visfix/records';
const root = path.resolve(__dirname, '..');
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
  const at = (x, y) => [x * 2, y * 2]; // the game shows at 2x in a 1280x720 page
  const scroll = () => ev(() => window.__engine.Engine.scene.scroll);

  for (const tab of ['all', 'trainers']) {
    await ev(async (tab) => {
      const { RecordsScene } = await import('/src/scenes/records.js');
      const sc = new RecordsScene();
      sc.load = () => {}; // no cloud offline
      window.__engine.setScene(sc);
      sc.tab = tab; sc.error = null; sc.scroll = 0; sc.contentH = 0;
      const party = ['CHARIZARD', 'LAPRAS', 'SNORLAX', 'JOLTEON', 'ALAKAZAM', 'GYARADOS'].map(species => ({ species }));
      sc.rows = Array.from({ length: 30 }, (_, i) => tab === 'trainers'
        ? { name: 'TRAINER' + (i + 1), bestScore: 90000 - i * 1000, runs: 40 - i, wins: 10 - (i % 10) }
        : { playerName: 'TRAINER' + (i + 1), score: 90000 - i * 1000, result: i % 3 ? 'lose' : 'win', ascension: i % 9, party, world: i % 2 ? 'hoenn' : 'kanto', act: 1 + (i % 5), floor: i % 15, finishedAt: Date.now() - i * 3600e3, version: 'v0.0.6' });
    }, tab);
    await page.waitForTimeout(400);
    await page.mouse.move(...at(320, 200));
    await page.screenshot({ path: `${out}/records_${tab}_top.png` });
    check(`${tab}: starts at the top`, (await scroll()) === 0);
    await page.mouse.wheel(0, 300); await page.waitForTimeout(150);
    await page.mouse.wheel(0, 300); await page.waitForTimeout(150);
    const s1 = await scroll();
    check(`${tab}: mouse wheel scrolls`, s1 > 0, `scroll=${s1}`);
    // drag up (touch-style) scrolls further
    await page.mouse.move(...at(320, 300)); await page.mouse.down();
    for (let k = 1; k <= 10; k++) { await page.mouse.move(...at(320, 300 - k * 15)); await page.waitForTimeout(30); }
    await page.mouse.up(); await page.waitForTimeout(150);
    const s2 = await scroll();
    check(`${tab}: drag scrolls`, s2 > s1, `scroll=${s2}`);
    for (let k = 0; k < 40; k++) { await page.keyboard.press('ArrowDown'); await page.waitForTimeout(25); } // one press per frame
    await page.waitForTimeout(200);
    const s3 = await scroll(), max = await ev(() => { const s = window.__engine.Engine.scene; return s.contentH - (360 - 26 - 84); });
    check(`${tab}: arrow keys reach the end (clamped)`, s3 === max && max > 0, `scroll=${s3} max=${max}`);
    await page.screenshot({ path: `${out}/records_${tab}_bottom.png` });
    for (let k = 0; k < 40; k++) { await page.keyboard.press('ArrowUp'); await page.waitForTimeout(25); }
    await page.waitForTimeout(200);
    check(`${tab}: back to the top`, (await scroll()) === 0);
  }
  console.log(errors.length ? 'PAGE ERRORS:\n' + errors.join('\n') : 'no page errors');
  console.log(fails.length ? `FAILED: ${fails.join(', ')}` : 'all checks passed');
  await browser.close(); server.kill();
  process.exit(fails.length || errors.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
