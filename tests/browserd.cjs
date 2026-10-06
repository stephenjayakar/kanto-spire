// Headless Chrome driver daemon: POST JSON commands to http://localhost:9333
// {cmd:'goto',url} {cmd:'click',x,y} (virtual 640x360 coords) {cmd:'key',key} {cmd:'shot',path} {cmd:'eval',js} {cmd:'logs'} {cmd:'wait',ms}
const { chromium } = require('playwright');
const http = require('http');
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const logs = [];
  page.on('console', m => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', e => logs.push(`[pageerror] ${e.message}\n${e.stack}`));
  const toPage = async (x, y) => {
    const r = await page.evaluate(() => { const c = document.getElementById('game').getBoundingClientRect(); return { l: c.left, t: c.top, w: c.width, h: c.height }; });
    return [r.l + x / 640 * r.w, r.t + y / 360 * r.h];
  };
  http.createServer(async (req, res) => {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', async () => {
      try {
        const c = JSON.parse(body || '{}');
        let out = 'ok';
        if (c.cmd === 'goto') await page.goto(c.url, { waitUntil: 'load' });
        else if (c.cmd === 'click') { const [px, py] = await toPage(c.x, c.y); await page.mouse.move(px, py); await page.waitForTimeout(40); await page.mouse.down(); await page.waitForTimeout(40); await page.mouse.up(); if (c.after) await page.waitForTimeout(c.after); }
        else if (c.cmd === 'rclick') { const [px, py] = await toPage(c.x, c.y); await page.mouse.click(px, py, { button: 'right' }); }
        else if (c.cmd === 'move') { const [px, py] = await toPage(c.x, c.y); await page.mouse.move(px, py); }
        else if (c.cmd === 'drag') { const [ax, ay] = await toPage(c.x, c.y); const [bx, by] = await toPage(c.x2, c.y2); await page.mouse.move(ax, ay); await page.waitForTimeout(60); await page.mouse.down(); for (let i = 1; i <= 10; i++) { await page.mouse.move(ax + (bx - ax) * i / 10, ay + (by - ay) * i / 10); await page.waitForTimeout(30); } await page.waitForTimeout(100); await page.mouse.up(); }
        else if (c.cmd === 'key') await page.keyboard.press(c.key);
        else if (c.cmd === 'shot') { await page.screenshot({ path: c.path, clip: c.clip }); }
        else if (c.cmd === 'eval') out = JSON.stringify(await page.evaluate(c.js));
        else if (c.cmd === 'logs') { out = logs.join('\n'); logs.length = 0; }
        else if (c.cmd === 'wait') await page.waitForTimeout(c.ms);
        else if (c.cmd === 'quit') { res.end('bye'); await browser.close(); process.exit(0); }
        res.end(out);
      } catch (e) { res.end('ERR ' + e.message); }
    });
  }).listen(9433, "127.0.0.1", () => console.log("browserd on 9433"));
})();
