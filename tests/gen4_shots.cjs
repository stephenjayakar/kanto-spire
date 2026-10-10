// Screenshots of the Gen 4 species in the dev lab (web/gen4lab.html): muted Chrome, offline, own server.
//   node tests/gen4_shots.cjs [outdir=tests/out/gen4] [port=8171]
// Writes lab_front.png (all 107 animated fronts at 2x + the cross-gen pairs, full page), lab_shiny.png, lab_back.png.
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.resolve(ROOT, process.argv[2] || 'tests/out/gen4');
const PORT = +(process.argv[3] || 8171);
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const server = spawn(process.execPath, [path.join(ROOT, 'serve.cjs'), String(PORT)], { cwd: ROOT, stdio: 'ignore' });
  await sleep(700);
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio'] });
  const errors = [];
  try {
    const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
    await page.route('**/cloud.json', r => r.fulfill({ status: 404, body: '' }));
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(`http://localhost:${PORT}/gen4lab.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.gen4Lab?.ready, null, { timeout: 60000 });
    const lab = await page.evaluate(() => ({ count: window.gen4Lab.count, errors: window.gen4Lab.errors, info: document.getElementById('info').textContent }));
    console.log(lab.info);
    errors.push(...lab.errors);
    for (const [name, o] of [['lab_front', { still: true }], ['lab_shiny', { shiny: true, still: true }], ['lab_back', { back: true }]]) {
      await page.evaluate((o) => window.gen4Lab.set({ shiny: false, back: false, still: false, ...o }), o);
      await sleep(300);
      await page.screenshot({ path: path.join(OUT, name + '.png'), fullPage: true });
      console.log('wrote', path.join(OUT, name + '.png'));
    }
    if (lab.count !== 107) errors.push(`expected 107 species, got ${lab.count}`);
  } finally {
    await browser.close(); server.kill();
  }
  if (errors.length) { console.log('ERRORS:\n' + errors.join('\n')); process.exit(1); }
  console.log('ok');
})().catch(e => { console.error(e); process.exit(1); });
