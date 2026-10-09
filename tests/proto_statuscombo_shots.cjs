// Prototype screenshots: a selected hand with a PAIR plus STATUS cards (muted Chrome, offline build).
//   node tests/proto_statuscombo_shots.cjs [port=8741] [prefix=proto_statuscombo]
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const port = +(process.argv[2] || 8741), prefix = process.argv[3] || 'proto_statuscombo';
const root = path.resolve(__dirname, '..'), out = path.join(root, 'tests/out');
fs.mkdirSync(out, { recursive: true });

(async () => {
  const server = spawn(process.execPath, [path.join(root, 'serve.cjs'), String(port)], { cwd: root, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 700));
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio'] });
  const errors = [];
  try {
    const page = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    await page.route('**/cloud.json', r => r.fulfill({ status: 404, body: '' }));
    await page.goto(`http://localhost:${port}/`); await page.evaluate(() => localStorage.clear()); await page.reload();
    await page.waitForFunction(() => window.__ready && window.G?.meta, null, { timeout: 60000 });
    const ev = (fn, arg) => page.evaluate(fn, arg);
    await ev(async () => {
      G.meta.seenVersion = (await import('/src/game/version.js')).PATCH_NOTES[0].v; Object.assign(G.meta, { tutorialDone: true, tipCatch: true, hintBattles: 9 });
      const { Run } = await import('/src/game/run.js'); G.run = Run.create({ starter: 'CHARMANDER', ascension: 0, seed: 'PROTO' });
      window.__flow.enterNode(G.run.map.start[0]);
    });
    await page.waitForFunction(() => { const s = window.__engine.Engine.scene; return s?.b && !s.busy && s.b.deck?.hand?.length >= 5 && !s.msg?.active; }, null, { timeout: 60000 });
    const canvasShot = async (name) => {
      await page.waitForTimeout(400);
      const c = await page.$('canvas');
      await c.screenshot({ path: path.join(out, `${prefix}_${name}.png`) });
      console.log('saved', path.join(out, `${prefix}_${name}.png`));
    };
    // hand: EMBER, FLAMETHROWER (FIRE PAIR), GROWL, SMOKESCREEN (status), SCRATCH
    const setHand = (arg) => ev(({ hand, sel }) => {
      const sc = window.__engine.Engine.scene, b = sc.b;
      const lead = b.lead(); lead.level = Math.max(lead.level, 12);
      b.deck.hand.slice(0, hand.length).forEach((c, i) => { c.move = hand[i]; c.uid = b.leadUid; c.faceDown = false; c.frozen = false; });
      sc.syncHand();
      sc.sel = sel.map(i => sc.handIds[i]);
      return sc.sel.length;
    }, arg);
    const hand = ['EMBER', 'GROWL', 'FLAMETHROWER', 'SMOKESCREEN', 'SCRATCH'];
    await setHand({ hand, sel: [0, 1, 2] });
    await canvasShot('pair_plus_status');
    await setHand({ hand, sel: [0, 1, 2, 3] });
    await canvasShot('pair_plus_two_status');
    await setHand({ hand, sel: [0, 1, 2, 4] });
    await canvasShot('pair_status_kicker');
    await setHand({ hand, sel: [1, 3] });
    await canvasShot('support_only');
    // hover a selected status card for its tooltip
    await setHand({ hand, sel: [0, 1, 2] });
    const pos = await ev(() => { const sc = window.__engine.Engine.scene, v = sc.vis.get(sc.handIds[1]); return { x: v.x + 30, y: v.y + 60 }; });
    const box = await (await page.$('canvas')).boundingBox();
    await page.mouse.move(box.x + pos.x * box.width / 640, box.y + pos.y * box.height / 360);
    await canvasShot('hover_status');
    // hover the combo preview box for its tooltip
    await page.mouse.move(box.x + 80 * box.width / 640, box.y + 70 * box.height / 360);
    await canvasShot('hover_combo_box');
  } finally {
    console.log(errors.length ? 'page errors:\n  ' + [...new Set(errors)].join('\n  ') : 'no page errors');
    await browser.close(); server.kill();
  }
})();
