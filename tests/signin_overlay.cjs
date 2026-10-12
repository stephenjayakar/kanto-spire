// The sign-in page and the loading text must be visible at every window size (local build by default; never touches Convex).
// Regression: at sizes where SCREEN: FILL lands on a fractional scale, the CRT pass's WebGL overlay (#crt, above
// #game) stayed up after main.js hid #game for the sign-in page and covered it with a black box; it also hid #loading.
// Checks real pixels: screenshots of the button / loading text, decoded in the page.
// BASE=<url> node tests/signin_overlay.cjs checks a deployed site instead (its own cloud.json; staging, never prod).
const { spawn } = require('child_process');
const path = require('path');
const { chromium } = require('playwright');
const port = 8764, root = path.resolve(__dirname, '..'), base = process.env.BASE || `http://localhost:${port}/`;
const SIZES = [[1280, 720, 1], [1000, 700, 1], [1366, 768, 1], [1440, 900, 2], [1536, 864, 1.25], [390, 844, 3]];
(async () => {
  const server = process.env.BASE ? null : spawn(process.execPath, [path.join(root, 'serve.cjs'), String(port)], { cwd: root, stdio: 'ignore' });
  if (server) await new Promise(r => setTimeout(r, 700));
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio'] });
  const fails = []; const ok = (c, l, i = '') => { console.log((c ? 'ok   ' : 'FAIL ') + l, i); if (!c) fails.push(l); };
  // average colour and brightest channel of a PNG screenshot
  const stats = (page, buf) => page.evaluate(async (b64) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const x = c.getContext('2d'); x.drawImage(img, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height).data;
    let r = 0, g = 0, bl = 0, max = 0;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; bl += d[i + 2]; max = Math.max(max, d[i], d[i + 1], d[i + 2]); }
    const n = d.length / 4;
    return { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(bl / n), max };
  }, buf.toString('base64'));
  try {
    for (const [w, h, dpr] of SIZES) {
      const tag = `${w}x${h}@${dpr}`;
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr });
      const page = await ctx.newPage();
      // cloud.json held back: the page sits on "Loading Kanto Spire..." (the engine and its overlay are already up)
      let release; const held = new Promise(r => { release = r; });
      await page.route('**/cloud.json', async r => {
        await held;
        if (server) r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ convexUrl: 'https://elegant-corgi-316.convex.cloud', packs: true }) });
        else r.continue();
      });
      await page.goto(base);
      await page.waitForFunction(() => document.getElementById('game').style.width, null, { timeout: 30000 });
      await page.waitForTimeout(200);
      const lb = await page.locator('#loading').boundingBox();
      const ls = await stats(page, await page.screenshot({ clip: lb }));
      ok(ls.max > 150, `${tag}: loading text visible`, JSON.stringify(ls));
      release();
      await page.waitForSelector('#signin:not([hidden])', { timeout: 30000 });
      await page.waitForTimeout(300); // (a few frames of the render loop)
      const bb = await page.locator('#signin-btn').boundingBox();
      const s = await stats(page, await page.screenshot({ clip: { x: bb.x + 4, y: bb.y + 4, width: bb.width - 8, height: bb.height - 8 } }));
      // the button is green (#3a9a58) with white text; covered, it reads as black
      ok(s.g > 100 && s.g > s.r + 20, `${tag}: sign-in button visible`, JSON.stringify(s));
      const crt = await page.evaluate(() => { const el = document.getElementById('crt'); return el ? getComputedStyle(el).display : 'none'; });
      ok(crt === 'none', `${tag}: no CRT overlay on the sign-in page`, crt);
      await ctx.close();
    }
  } catch (e) { ok(false, 'harness', e.message); } finally { await browser.close(); server?.kill(); }
  console.log(fails.length ? 'FAILED: ' + fails.length : 'all checks passed');
  process.exit(fails.length ? 1 : 0);
})();
