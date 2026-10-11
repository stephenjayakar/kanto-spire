// v0.5.2 screenshots + checks: the Pokédex scrolling by pixels (wheel, drag, keys; header fixed; a click still opens an
// entry, a drag doesn't), RECORDS with LOAD MORE (fake pages: no cloud), the co-op legendary node's held item following
// the legendary you catch (reward screen), and a DIG card waiting a turn (LANDING) after a DIG that didn't dodge.
// Muted Chrome, offline (cloud.json 404s).   node tests/fix052_shots.cjs [port=8752]   ->  tests/out/fix052_*.png
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const port = +(process.argv[2] || 8752), prefix = 'fix052';
const root = path.resolve(__dirname, '..'), out = path.join(root, 'tests/out');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
fs.mkdirSync(out, { recursive: true });
let fails = 0;
const check = (label, ok, extra = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${extra ? ' ' + extra : ''}`); if (!ok) fails++; return ok; };
const watch = (page, errors) => {
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
};
async function openPage(browser, errors) {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  watch(page, errors);
  await page.route('**/cloud.json', r => r.fulfill({ status: 404, body: '' }));
  await page.goto(`http://localhost:${port}/`); await page.evaluate(() => localStorage.clear()); await page.reload();
  await page.waitForFunction(() => window.__ready && window.G?.meta && window.__engine?.Engine.scene, null, { timeout: 120000 });
  await page.evaluate(async () => { G.meta.seenVersion = (await import('/src/game/version.js')).PATCH_NOTES[0].v; Object.assign(G.meta, { tutorialDone: true, tipCatch: true, hintBattles: 9, basicsSeen: true }); });
  return page;
}
const shooter = (page) => async (name) => {
  await page.waitForTimeout(350);
  const file = path.join(out, `${prefix}_${name}.png`);
  await (await page.$('canvas')).screenshot({ path: file });
  console.log('saved', file);
};
const gx = async (page, x, y) => { const box = await (await page.$('canvas')).boundingBox(); return [box.x + x * box.width / 640, box.y + y * box.height / 360]; };
const mouseTo = async (page, x, y) => page.mouse.move(...(await gx(page, x, y)));
const clickAt = async (page, x, y) => { await mouseTo(page, x, y); await page.mouse.down(); await sleep(60); await page.mouse.up(); await sleep(120); };

// ---- 1. the Pokédex ----
async function dex(browser, errors) {
  const page = await openPage(browser, errors), ev = (fn, a) => page.evaluate(fn, a), shot = shooter(page);
  await ev(async () => {
    const { D } = await import('/src/game/data.js');
    const all = Object.values(D.species).sort((a, b) => a.dex - b.dex).map(s => s.key);
    Object.assign(G.meta, { dexSeen: all.filter((_, i) => i % 3 !== 2), dexCaught: all.filter((_, i) => i % 3 === 0) });
    const { DexScene } = await import('/src/scenes/dex.js'); window.__engine.setScene(new DexScene());
  });
  await sleep(600); await mouseTo(page, 320, 180);
  const sc = () => ev(() => window.__engine.Engine.scene.scroll);
  check('dex: starts at the top', (await sc()) === 0);
  await shot('dex_top');
  await page.mouse.wheel(0, 100); await sleep(120); await page.mouse.wheel(0, 100); await sleep(250);
  const s1 = await sc();
  check('dex: the wheel scrolls by pixels (not a page)', s1 > 0 && s1 < 288 && s1 % 36 !== 0, `scroll=${s1}`);
  await page.mouse.wheel(0, 700); await sleep(300);
  const s2 = await sc();
  check('dex: more wheel, further', s2 > s1, `scroll=${s2}`);
  await mouseTo(page, 330, 175); await shot('dex_mid_scroll');
  // drag (touch-style) scrolls, and the release opens nothing
  await mouseTo(page, 300, 260); await page.mouse.down();
  for (let k = 1; k <= 8; k++) { await mouseTo(page, 300, 260 - k * 12); await sleep(30); }
  await page.mouse.up(); await sleep(200);
  const s3 = await sc();
  check('dex: drag scrolls', s3 > s2 + 60, `scroll=${s3}`);
  check('dex: a drag opens no entry', (await ev(() => window.__engine.Engine.overlays.length)) === 0);
  for (let k = 0; k < 6; k++) { await page.keyboard.press('ArrowUp'); await sleep(30); }
  await sleep(150);
  check('dex: arrow keys scroll', (await sc()) === s3 - 6 * 24, `scroll=${await sc()}`);
  // a click on a seen entry opens it
  const target = await ev(() => { const s = window.__engine.Engine.scene, top = 40 - s.scroll; const row = Math.ceil((s.scroll + 20) / 36); return { row, y: top + row * 36 + 17, n: row * 15 + 1 }; });
  await clickAt(page, 10 + 19, target.y);
  const open = await ev(() => { const o = window.__engine.Engine.overlays.at(-1); return o?.dex ?? null; });
  check('dex: clicking an entry opens it', open === target.n, `opened=${open} want=${target.n}`);
  await shot('dex_entry_from_scroll');
  await page.keyboard.press('Escape'); await sleep(200);
  // the bottom: the last row (No.493) in view, clamped
  for (let k = 0; k < 20; k++) { await page.keyboard.press('PageDown'); await sleep(30); }
  await sleep(200); await mouseTo(page, 320, 200);
  const end = await ev(() => { const s = window.__engine.Engine.scene; return { scroll: s.scroll, max: s.contentH - (360 - 38 - 40) }; });
  check('dex: PAGE DOWN reaches the end (clamped)', end.scroll === end.max && end.max > 0, JSON.stringify(end));
  await shot('dex_bottom');
  await page.context().close();
}

// ---- 2. RECORDS: LOAD MORE ----
async function records(browser, errors) {
  const page = await openPage(browser, errors), ev = (fn, a) => page.evaluate(fn, a), shot = shooter(page);
  for (const tab of ['all', 'trainers']) {
    await ev(async (tab) => {
      const { RecordsScene } = await import('/src/scenes/records.js');
      const sc = new RecordsScene();
      sc.load = () => {}; // offline: fake pages instead of the cloud
      window.__engine.setScene(sc);
      const party = ['CHARIZARD', 'LAPRAS', 'SNORLAX', 'JOLTEON', 'ALAKAZAM', 'GYARADOS'].map(species => ({ species }));
      const row = (i) => (tab === 'trainers'
        ? { id: 'p' + i, name: 'TRAINER' + (i + 1), bestScore: 990000 - i * 1500, runs: 240 - i, wins: 40 - (i % 30) }
        : { _id: 'r' + i, playerName: 'TRAINER' + (i + 1), starter: 'CHARMANDER', score: 990000 - i * 1500, result: i % 3 ? 'lose' : 'win', ascension: i % 9, party, world: 'spire', regions: 'K-H-J-K', act: 1 + (i % 5), floor: i % 15, finishedAt: Date.now() - i * 3600e3, version: 'v0.5.1' });
      Object.assign(sc, { tab, error: null, scroll: 0, contentH: 0, paged: true, more: [], cursor: '50', done: false, loadingMore: false });
      sc.live = Array.from({ length: 50 }, (_, i) => row(i));
      sc.rows = sc.live.slice();
      window.__fetched = [];
      // two more pages of 50, then 12; a slow network so LOADING... shows
      sc.fetchPage = async (cursor) => { window.__fetched.push(cursor); await new Promise(r => setTimeout(r, 400)); const s = +cursor, n = s >= 150 ? 12 : 50; return { page: Array.from({ length: n }, (_, i) => row(s + i)), isDone: s + n >= 162, continueCursor: String(s + n) }; };
    }, tab);
    await sleep(400);
    const st = () => ev(() => { const s = window.__engine.Engine.scene; return { n: s.rows.length, scroll: s.scroll, max: s.contentH - (360 - 26 - 84), done: s.done, loading: s.loadingMore, fetched: window.__fetched.slice() }; });
    await mouseTo(page, 320, 200);
    for (let k = 0; k < 60; k++) { await page.keyboard.press('PageDown'); await sleep(20); }
    await sleep(250);
    let s = await st();
    check(`records ${tab}: scrolled to the end of page 1`, s.scroll === s.max && s.n === 50, JSON.stringify(s));
    await mouseTo(page, 320, 300); await shot(`records_${tab}_load_more`);
    // the LOAD MORE row is the last thing in the list: click it
    await clickAt(page, 320, 360 - 26 - 14);
    await sleep(100); await shot(`records_${tab}_loading`);
    await sleep(600);
    s = await st();
    check(`records ${tab}: LOAD MORE fetched the next page from the cursor and appended it`, s.n === 100 && s.fetched.join() === '50' && !s.done, JSON.stringify(s));
    check(`records ${tab}: the list didn't jump`, s.scroll > 0 && s.scroll < s.max, JSON.stringify(s));
    await mouseTo(page, 320, 200); await shot(`records_${tab}_after_load`);
    for (let pg = 0; pg < 2; pg++) {
      for (let k = 0; k < 80; k++) { await page.keyboard.press('PageDown'); await sleep(15); }
      await sleep(200); await clickAt(page, 320, 360 - 26 - 14); await sleep(900);
    }
    s = await st();
    check(`records ${tab}: every page, once, then no more LOAD MORE`, s.n === 162 && s.done && s.fetched.join() === '50,100,150', JSON.stringify(s));
    for (let k = 0; k < 80; k++) { await page.keyboard.press('PageDown'); await sleep(15); }
    await sleep(250); await mouseTo(page, 320, 200); await shot(`records_${tab}_end`);
    const nums = await ev(() => window.__engine.Engine.scene.rows.map(r => r._id ?? r.id));
    check(`records ${tab}: no duplicates`, new Set(nums).size === nums.length);
  }
  await page.context().close();
}

// ---- 3. co-op legendary node: the held item follows the legendary you catch ----
async function legend(browser, errors) {
  const page = await openPage(browser, errors), ev = (fn, a) => page.evaluate(fn, a), shot = shooter(page);
  await ev(async () => {
    const { CoopGame, duoConfig } = await import('/src/game/coop/coop.js');
    const g = CoopGame.fromInit({ seq: 1, type: 'init', seed: 'LEG52', ascension: 0, world: 'kanto', starters: ['BULBASAUR', 'CHARMANDER'], names: ['A', 'B'] });
    g.world.startAct(1);
    const cfg = duoConfig(g.world, Object.values(g.world.map.nodes).find(n => n.type === 'legend'));
    G.run = g.privateRunClone(1);
    const { RewardScene } = await import('/src/scenes/reward.js');
    window.__cfg = cfg;
    window.__engine.setScene(new RewardScene({ kind: 'elite', cfg, enemies: cfg.enemies, result: { outcome: 'win', exp: 0, money: 120, participants: [] } }, cfg, {}));
  });
  await sleep(1500); await mouseTo(page, 2, 2);
  const rows = () => ev(() => window.__engine.Engine.scene.rewards.map(r => ({ kind: r.kind, label: r.label, choices: r.choices, claimed: !!r.claimed })));
  let r = await rows();
  const relic = r.find(x => x.kind === 'relic');
  check('legend: the held-item row names both legendaries\' items', relic && /THUNDER FEATHER/i.test(relic.label) && /FROST FEATHER/i.test(relic.label), JSON.stringify(relic));
  await shot('legend_rewards_before');
  // pick ARTICUNO (the partner legendary)
  const li = r.findIndex(x => x.kind === 'legend');
  await clickAt(page, 450, 60 + li * 34 + 15);
  await sleep(500); await shot('legend_pick');
  const opt = await ev(() => { const o = window.__engine.Engine.overlays.at(-1); return o?.options?.map(x => x.label) || null; });
  check('legend: the catch modal offers both', opt && opt.some(l => /ARTICUNO/.test(l)) && opt.some(l => /ZAPDOS/.test(l)), JSON.stringify(opt));
  await ev(() => { const o = window.__engine.Engine.overlays.at(-1); o.close(2); }); // "Catch ARTICUNO!"
  await sleep(800);
  for (let k = 0; k < 5 && (await ev(() => window.__engine.Engine.overlays.length)); k++) { await ev(() => window.__engine.Engine.overlays.at(-1)?.close?.(null)); await sleep(300); }
  r = await rows();
  const relic2 = r.find(x => x.kind === 'relic');
  check('legend: caught ARTICUNO -> its FROST FEATHER', relic2 && relic2.choices.join() === 'FROST_FEATHER' && G_ok(r), JSON.stringify(relic2));
  await mouseTo(page, 2, 2); await shot('legend_rewards_after');
  await page.context().close();
  function G_ok(rs) { return rs.some(x => x.kind === 'legend' && x.claimed); }
}

// ---- 4. DIG twice in a row: the card waits a turn (LANDING) even when the faster foe moved first ----
async function landing(browser, errors) {
  const page = await openPage(browser, errors), ev = (fn, a) => page.evaluate(fn, a), shot = shooter(page);
  await ev(async () => {
    const { Run } = await import('/src/game/run.js');
    G.run = Run.create({ starter: 'CHARMANDER', ascension: 0, seed: 'DIG52' });
    G.run.actIndex = 0; window.__flow.enterNode(G.run.map.start[0]);
  });
  await page.waitForFunction(() => { const s = window.__engine.Engine.scene; return s?.b && !s.busy && s.b.deck?.hand?.length >= 5 && !s.msg?.active; }, null, { timeout: 60000 });
  const info = await ev(async () => {
    const s = window.__engine.Engine.scene, b = s.b, lead = b.lead();
    b.enemy().stats.spe = 999; // the foe moves first: no dodge
    b.deck.hand[0] = { id: 8801, uid: lead.uid, move: 'DIG' };
    s.syncHand(); s.sel = [8801];
    await s.doPlay(); // (through the scene: the turn's events play out)
    for (let k = 0; k < 100 && s.busy; k++) await new Promise(r => setTimeout(r, 100));
    b.deck.hand[0] = { id: 8802, uid: lead.uid, move: 'DIG' };
    b.deck.hand[1] = { id: 8803, uid: lead.uid, move: 'PROTECT' };
    s.syncHand();
    const i = b.cardInfo(b.deck.hand[0]), p = b.cardInfo(b.deck.hand[1]);
    return { dig: [i.playable, i.reason], protect: [p.playable, p.reason], turn: b.turn };
  });
  check('landing: DIG waits a turn after a DIG that did not dodge', info.dig[0] === false && info.dig[1] === 'LANDING', JSON.stringify(info));
  check('landing: PROTECT is still fine (no dodge happened)', info.protect[0] === true, JSON.stringify(info));
  await sleep(1500);
  const pos = await ev(() => { const v = window.__engine.Engine.scene.vis.get(8802); return v ? [v.x + 30, v.y + 40] : null; });
  if (pos) await mouseTo(page, pos[0], pos[1]);
  await shot('landing_dig_card');
  await page.context().close();
}

(async () => {
  const server = spawn(process.execPath, [path.join(root, 'serve.cjs'), String(port)], { cwd: root, stdio: 'ignore' });
  await sleep(700);
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio'] });
  const errors = [];
  const only = (process.env.ONLY || 'dex,records,legend,landing').split(',');
  try {
    if (only.includes('dex')) await dex(browser, errors);
    if (only.includes('records')) await records(browser, errors);
    if (only.includes('legend')) await legend(browser, errors);
    if (only.includes('landing')) await landing(browser, errors);
  } catch (e) { console.error(e); fails++; }
  console.log(errors.length ? 'PAGE ERRORS:\n' + errors.join('\n') : 'no page errors');
  console.log(fails ? `${fails} FAILED` : 'all checks passed');
  await browser.close(); server.kill();
  process.exit(fails || errors.length ? 1 : 0);
})();
