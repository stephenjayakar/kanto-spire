// Mobile check: every modal/screen we open is left again with TAPS only (no keyboard, no right-click).
// Pixel 7 emulation (touch), muted Chromium. Starts its own static server.
//   node tests/mobile_close.cjs [port=8113] [outdir=tests/out]
const { spawn } = require('child_process');
const path = require('path');
const { chromium, devices } = require('playwright');
const port = +(process.argv[2] || 8113), out = process.argv[3] || 'tests/out';
const root = path.resolve(__dirname, '..');

(async () => {
  const server = spawn(process.execPath, [path.join(root, 'serve.cjs'), String(port)], { cwd: root, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 600));
  let browser;
  try { browser = await chromium.launch({ headless: true, args: ['--mute-audio'] }); }
  catch { browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio'] }); }
  const ctx = await browser.newContext({ ...devices['Pixel 7'] }); // portrait, hasTouch, isMobile
  const page = await ctx.newPage();
  const errors = [], fails = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.goto(`http://localhost:${port}/`, { waitUntil: 'load' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.G && window.__engine && !document.getElementById('loading'), null, { timeout: 30000 });
  await page.waitForTimeout(500);

  const tap = async (x, y, settle = 350) => {
    const r = await page.evaluate(() => { const c = document.getElementById('game').getBoundingClientRect(); return { l: c.left, t: c.top, w: c.width, h: c.height }; });
    await page.touchscreen.tap(r.l + x / 640 * r.w, r.t + y / 360 * r.h);
    await page.waitForTimeout(settle);
  };
  const state = () => page.evaluate(() => { const E = window.__engine.Engine; return { n: E.overlays.length, top: E.overlays.at(-1)?.constructor.name || null, scene: E.scene?.constructor.name }; });
  const expect = async (label, pred) => { const s = await state(); const ok = pred(s); console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}  ${JSON.stringify(s)}`); if (!ok) fails.push(label); return ok; };
  const shot = (name) => page.screenshot({ path: `${out}/mobile_${name}.png` });
  const ev = (fn, arg) => page.evaluate(fn, arg);
  // Where ChoiceModal (the top overlay) draws option i, or its X when i === 'x' (mirrors common.js).
  const choice = (i) => ev(async (i) => {
    const { wrap, lineHeight } = await import('/src/engine/font.js');
    const o = window.__engine.Engine.overlays.at(-1);
    const w = o.w || 300, n = o.options.length, bl = o.body ? wrap(o.body, w - 24).length : 0;
    const h = 46 + n * 30 + 14 * bl, x = (640 - w) / 2, y = (360 - h) / 2;
    if (i === 'x') return [x + w - 17, y + 13];
    return [320, y + 28 + (bl ? bl * lineHeight() + 4 : 0) + i * 30 + 13];
  }, i);
  const tapChoice = async (i) => { const [x, y] = await choice(i); await tap(x, y); };

  // ---- title screen --------------------------------------------------------------------------
  await tap(196, 300, 600); // CLICK TO START -> patch notes pop up once
  await expect('tap starts the title, patch notes open', s => s.top === 'PatchNotesModal');
  await tap(564, 341); await expect('patch notes CLOSE', s => s.n === 0);
  await tap(50, 15); await expect('HOW TO PLAY opens the picture guide', s => s.top === 'BasicsModal');
  await tap(147, 341); await expect('FULL GUIDE opens the text guide', s => s.top === 'AboutModal');
  await tap(564, 341); await expect('FULL GUIDE CLOSE', s => s.top === 'BasicsModal');
  await tap(61, 341); await expect('HOW TO PLAY CLOSE', s => s.n === 0);
  await tap(250, 301); await expect('SETTINGS opens', s => s.top === 'SettingsModal');
  await shot('settings');
  await tap(20, 20); await expect('SETTINGS closes on tap outside', s => s.n === 0);
  await tap(250, 301); await tap(320, 295); await expect('SETTINGS CLOSE', s => s.n === 0);
  await tap(142, 301); await expect('POKéDEX opens', s => s.scene === 'DexScene');
  await tap(595, 17); await expect('POKéDEX BACK', s => s.scene === 'TitleScene');
  await tap(500, 330); await tap(196, 301); await expect('RECORDS opens', s => s.scene === 'RecordsScene');
  await tap(595, 17); await expect('RECORDS BACK', s => s.scene === 'TitleScene');
  await tap(500, 330); await tap(196, 273); await expect('NEW RUN -> starter select', s => s.scene === 'StarterScene');
  await tap(49, 338); await expect('starter BACK', s => s.scene === 'TitleScene');

  // ---- battle --------------------------------------------------------------------------------
  await ev(async () => {
    const { Run } = await import('/src/game/run.js');
    const run = Run.create({ starter: 'BULBASAUR', seed: 'MOBILE' });
    run.balls = { POKE_BALL: 3, GREAT_BALL: 2 };
    window.G.run = run; window.G.meta.tutorialDone = true;
    const node = { id: 'm1', floor: 1, type: 'wild' };
    window.__flow.startBattle(run.battleConfig(node), node);
  });
  await page.waitForFunction(() => { const s = window.__engine.Engine.scene; return s?.b && !s.busy && !s.msg?.active && s.handIds?.length; }, null, { timeout: 30000 });
  await page.waitForTimeout(600);
  // a single tap on a hand card selects it (battle intro messages may still eat the first taps)
  let card, sel = [];
  for (let k = 0; k < 6 && !sel.length; k++) {
    // advance any message boxes by tapping the battlefield until the hand is usable
    for (let t = 0; t < 60 && !(await ev(() => { const s = window.__engine.Engine.scene; return !s.busy && !s.msg?.active; })); t++) await tap(320, 110, 400);
    await page.waitForTimeout(500);
    card = await ev(() => { const s = window.__engine.Engine.scene; const id = s.handIds.find(i => s.b.cardInfo(s.b.deck.hand.find(c => c.id === i)).playable); const v = s.vis.get(id); return { id, x: v.x + 30, y: v.y + 40 }; });
    await tap(card.x, card.y);
    sel = await ev(() => window.__engine.Engine.scene.sel.slice());
  }
  console.log(`${sel.includes(card.id) ? 'ok  ' : 'FAIL'} tap selects a hand card  sel=${JSON.stringify(sel)}`);
  if (!sel.includes(card.id)) fails.push('tap selects a hand card');
  await shot('battle_card_selected');
  await tap(card.x, card.y);
  await ev(() => window.__engine.Engine.scene.chooseBall());
  await page.waitForTimeout(300);
  await expect('ball picker opens', s => s.top === 'ChoiceModal');
  await shot('ball_picker_x');
  await tapChoice('x');
  await expect('ball picker X', s => s.n === 0);
  await tap(607, 13); await expect('battle DECK opens', s => s.top === 'DeckModal');
  await tap(8, 200); await expect('DECK closes on tap outside', s => s.n === 0);
  await tap(547, 13); await expect('INFO opens', s => s.top === 'InfoModal');
  await shot('info');
  await tap(30, 200); await expect('INFO closes on tap outside', s => s.n === 0);
  await tap(506, 13); await expect('battle ? opens HOW TO PLAY', s => s.top === 'BasicsModal');
  await tap(61, 341); await expect('HOW TO PLAY CLOSE (battle)', s => s.n === 0);

  // ---- map: run menu, settings, bag item -----------------------------------------------------
  await ev(async () => { window.G.run.consumables = ['POTION']; window.G.run.addRelic('LEFTOVERS'); window.__flow.goToMap(); });
  await page.waitForFunction(() => window.__engine.Engine.scene?.constructor.name === 'MapScene', null, { timeout: 10000 });
  await page.waitForTimeout(600);
  await tap(494, 13); await expect('map MENU opens', s => s.top === 'ChoiceModal');
  await shot('run_menu');
  await tapChoice(0); // Resume
  await expect('menu Resume', s => s.n === 0);
  // bag slot 1: x = 112 + max(52, money width + 8) + 42
  const bagX = await ev(async () => { const { measure } = await import('/src/engine/font.js'); const m = '$' + window.G.run.money.toLocaleString(); return 112 + Math.max(52, measure(m) + 8) + 42 + 12; });
  await tap(bagX, 12); await expect('bag item menu opens', s => s.top === 'ChoiceModal');
  // options Use / Sell / Keep it -> Keep it is the last button
  await tapChoice(2);
  await expect('bag menu Keep it', s => s.n === 0);

  // ---- shop: tap a held item to sell it, then keep it ------------------------------------------
  await ev(async () => { const { ShopScene } = await import('/src/scenes/shop.js'); window.__engine.setScene(new ShopScene({})); });
  await page.waitForTimeout(500);
  await tap(bagX - 12 + 3 * 27 + 6 + 12, 12);
  await expect('shop: tapping a held item offers to sell it', s => s.top === 'ChoiceModal');
  await shot('shop_sell');
  await tapChoice(1);
  await expect('shop sell prompt: Keep it', s => s.n === 0);
  const kept = await ev(() => window.G.run.relics.some(r => r.key === 'LEFTOVERS'));
  if (!kept) { fails.push('relic was sold'); console.log('FAIL relic was sold'); }

  // ---- reward sub-modals (opened directly; they have SKIP buttons) ----------------------------
  await ev(async () => { const m = await import('/src/scenes/reward.js'); window.__p = m.pick(new m.RelicChoiceModal({ choices: ['LEFTOVERS', 'QUICK_CLAW'] })); });
  await page.waitForTimeout(300);
  await tap(320, (360 - 190) / 2 + 190 - 17); await expect('held item choice SKIP', s => s.n === 0);

  await page.setViewportSize({ width: 915, height: 412 }); await page.waitForTimeout(400); await shot('landscape_shop'); // phone turned sideways
  console.log(errors.length ? 'PAGE ERRORS:\n' + errors.join('\n') : 'no page errors');
  console.log(fails.length ? `FAILED: ${fails.length}\n  ${fails.join('\n  ')}` : 'ALL TAP EXITS OK');
  await browser.close();
  server.kill();
  process.exit(fails.length || errors.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
