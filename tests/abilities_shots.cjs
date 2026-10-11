// v0.5.0 screenshots: the flinch warning on the foe's intent and the "FLINCHED!" turn, an ability tooltip, and what a
// switch costs (a foe's SHADOW TAG: +1 discard; ANTICIPATION: free). Muted Chrome, offline. Look at them.
//   node tests/abilities_shots.cjs [port=8748] [prefix=abil]      ->  tests/out/<prefix>_*.png
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const port = +(process.argv[2] || 8748), prefix = process.argv[3] || 'abil';
const root = path.resolve(__dirname, '..'), out = path.join(root, 'tests/out');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
fs.mkdirSync(out, { recursive: true });
let fails = 0;
const check = (label, ok, extra = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${extra ? ' ' + extra : ''}`); if (!ok) fails++; return ok; };

async function openPage(browser, errors) {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.route('**/cloud.json', r => r.fulfill({ status: 404, body: '' }));
  await page.goto(`http://localhost:${port}/`); await page.evaluate(() => localStorage.clear()); await page.reload();
  await page.waitForFunction(() => window.__ready && window.G?.meta && window.__engine?.Engine.scene, null, { timeout: 120000 });
  return page;
}
const shooter = (page) => async (name, wait = 400) => {
  await page.waitForTimeout(wait);
  const file = path.join(out, `${prefix}_${name}.png`);
  await (await page.$('canvas')).screenshot({ path: file });
  console.log('saved', file);
};
const mouseTo = async (page, x, y) => { const box = await (await page.$('canvas')).boundingBox(); await page.mouse.move(box.x + x * box.width / 640, box.y + y * box.height / 360); };
const clickAt = async (page, x, y) => { const box = await (await page.$('canvas')).boundingBox(); await page.mouse.click(box.x + x * box.width / 640, box.y + y * box.height / 360); };

// a solo battle with a second party member (so there is someone to switch to)
const SOLO_BATTLE = async ({ seed, foeAb, leadAb }) => {
  G.meta.seenVersion = (await import('/src/game/version.js')).PATCH_NOTES[0].v;
  Object.assign(G.meta, { tutorialDone: true, tipCatch: true, hintBattles: 9, basicsSeen: true });
  const { Run } = await import('/src/game/run.js');
  const { makeMon } = await import('/src/game/pokemon.js');
  const { RNG } = await import('/src/game/rng.js');
  G.run = Run.create({ starter: 'CHARMANDER', ascension: 0, seed });
  G.run.party.push(makeMon('PIKACHU', 6, { rng: new RNG('pika') }));
  if (leadAb) G.run.party[0].ability = leadAb;
  G.run.actIndex = 0; window.__flow.enterNode(G.run.map.start[0]);
  window.__foeAb = foeAb;
};
const battleReady = () => { const s = window.__engine.Engine.scene; return s?.b && !s.busy && s.b.deck?.hand?.length >= 5 && !s.msg?.active; };

async function flinch(browser, errors) {
  const page = await openPage(browser, errors);
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const shot = shooter(page);
  await ev(SOLO_BATTLE, { seed: 'FLINCH' });
  await page.waitForFunction(battleReady, null, { timeout: 60000 });
  // the foe is faster and its next move is a sure flinch (BITE at 100% here, to catch the moment on camera)
  const it = await ev(async () => {
    const { D } = await import('/src/game/data.js');
    const b = window.__engine.Engine.scene.b;
    b.enemy().stats.spe = 999;
    b.intent = { move: { ...D.moves.BITE, key: 'BITE', chance: 100 }, first: true };
    b.updateIntentPreview();
    return { flinch: b.intent.flinch, first: b.intent.first };
  });
  check('intent: the foe moves first and can flinch', it.first && it.flinch === 1, JSON.stringify(it));
  await mouseTo(page, 2, 2); await shot('intent_flinch_warning');
  await mouseTo(page, 338, 96); await shot('intent_flinch_tooltip');
  // play a card: the foe bites first, the lead flinches, the hand does nothing
  await mouseTo(page, 2, 2);
  await ev(() => { const s = window.__engine.Engine.scene, b = s.b; const orig = b.play.bind(b); b.play = (ids) => { window.__events = orig(ids); return window.__events; }; });
  await page.keyboard.press('1'); await sleep(200); await page.keyboard.press('a');
  for (let k = 0; k < 14; k++) await shot(`flinch_${k}`, 300);
  const played = await ev(() => (window.__events || []).filter(e => e.t === 'flinch' || (e.t === 'msg' && /flinch/i.test(e.text))).map(e => e.t + ':' + (e.text || '')));
  check('the lead flinched: event and message', played.some(x => x.startsWith('flinch')) && played.some(x => /flinched/.test(x)), JSON.stringify(played));

  await page.context().close();
}

async function tooltip(browser, errors) {
  const page = await openPage(browser, errors);
  const ev = (fn, arg) => page.evaluate(fn, arg);
  await ev(SOLO_BATTLE, { seed: 'TIP' });
  await page.waitForFunction(battleReady, null, { timeout: 60000 });
  const ab = await ev(async () => { const { D } = await import('/src/game/data.js'); const e = window.__engine.Engine.scene.b.enemy(); e.ability = 'ROUGH_SKIN'; return D.abilities.ROUGH_SKIN.desc; });
  check('ROUGH SKIN text says once per hand', /once per hand/.test(ab), ab);
  await mouseTo(page, 520, 93); await shooter(page)('tooltip_foe_ability');
  // my lead's ability: CHARMANDER's BLAZE in the party panel tooltip
  await mouseTo(page, 60, 199); await shooter(page)('tooltip_party_ability');
  await page.context().close();
}

async function switchCost(browser, errors) {
  const page = await openPage(browser, errors);
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const shot = shooter(page);
  await ev(SOLO_BATTLE, { seed: 'SWITCH' });
  await page.waitForFunction(battleReady, null, { timeout: 60000 });
  const c = await ev(() => { const b = window.__engine.Engine.scene.b; b.enemy().ability = 'SHADOW_TAG'; return b.switchCost(); });
  check('a foe SHADOW TAG: switching costs 2 discards', c.discards === 2 && c.taxBy === 'SHADOW_TAG', JSON.stringify(c));
  await mouseTo(page, 2, 2); await shot('switch_cost_panel_shadow_tag');
  await clickAt(page, 60, 223); await shot('switch_cost_modal_shadow_tag');
  await page.keyboard.press('Escape'); await sleep(300);
  await ev(() => { const s = window.__engine.Engine; while (s.overlays?.length) s.overlays.pop(); const b = s.scene.b; b.enemy().ability = 'RUN_AWAY'; b.sides.player.anticipate = b.turn; });
  await mouseTo(page, 2, 2); await shot('switch_cost_panel_anticipation');
  await page.context().close();
}

(async () => {
  const server = spawn(process.execPath, [path.join(root, 'serve.cjs'), String(port)], { cwd: root, stdio: 'ignore' });
  await sleep(700);
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
  const errors = [];
  try {
    for (const [name, fn] of [['flinch', flinch], ['tooltip', tooltip], ['switch', switchCost]]) {
      if (process.env.ONLY && !process.env.ONLY.split(',').includes(name)) continue;
      try { await fn(browser, errors); } catch (e) { check(`${name}: ran`, false, (e.stack || e.message).split('\n').slice(0, 3).join(' ')); }
    }
  } finally {
    check('no page errors', !errors.length, [...new Set(errors)].join(' | '));
    await browser.close(); server.kill();
  }
  console.log(fails ? `\n${fails} FAILED` : '\nall checks passed');
  process.exit(fails ? 1 : 0);
})();
