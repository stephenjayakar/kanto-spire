// INFO button (was COMBOS) and its COMBOS / TYPE CHART / STATUSES tabs: screenshots in a solo battle, on the solo
// map, in a co-op battle and on the co-op map (muted Chrome, offline; co-op on an in-memory net from player 2's seat,
// like statuscombo_shots.cjs). Look at them.
//   node tests/info_tabs_shots.cjs [port=8761] [prefix=info]
// Writes tests/out/<prefix>_*.png; fails on page errors or when INFO doesn't open the InfoModal.
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const port = +(process.argv[2] || 8761), prefix = process.argv[3] || 'info';
const root = path.resolve(__dirname, '..'), out = path.join(root, 'tests/out');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
fs.mkdirSync(out, { recursive: true });
let fails = 0;
const check = (label, ok, extra = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${extra ? ' ' + extra : ''}`); if (!ok) fails++; return ok; };

async function openPage(browser, errors) {
  const page = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.route('**/cloud.json', r => r.fulfill({ status: 404, body: '' }));
  await page.goto(`http://localhost:${port}/`); await page.evaluate(() => localStorage.clear()); await page.reload();
  await page.waitForFunction(() => window.__ready && window.G?.meta && window.__engine?.Engine.scene, null, { timeout: 120000 });
  return page;
}
const shooter = (page, tag) => async (name) => {
  await page.waitForTimeout(400);
  const file = path.join(out, `${prefix}_${tag}_${name}.png`);
  await (await page.$('canvas')).screenshot({ path: file });
  console.log('saved', file);
};
const toPage = async (page, x, y) => { const box = await (await page.$('canvas')).boundingBox(); return [box.x + x * box.width / 640, box.y + y * box.height / 360]; };
const mouseTo = async (page, x, y) => { const [px, py] = await toPage(page, x, y); await page.mouse.move(px, py); };
const clickAt = async (page, x, y) => { const [px, py] = await toPage(page, x, y); await page.mouse.click(px, py); await sleep(250); };
const top = (page) => page.evaluate(() => window.__engine.Engine.overlays.at(-1)?.constructor.name || null);

// The INFO button sits at (520, 3, 56x21) whenever the screen has a DECK button (battles, maps).
async function infoTabs(page, shot, tag, all) {
  await mouseTo(page, 548, 13); await shot('button_hover');
  await clickAt(page, 548, 13);
  check(`${tag}: INFO opens the InfoModal`, (await top(page)) === 'InfoModal');
  await page.evaluate(() => { window.__engine.Engine.overlays.at(-1).tab = 0; });
  await mouseTo(page, 320, 352);
  await shot('tab_combos');
  if (all) {
    await clickAt(page, 320, 21); // TYPE CHART tab
    check(`${tag}: TYPE CHART tab`, await page.evaluate(() => window.__engine.Engine.overlays.at(-1).tab === 1));
    await mouseTo(page, 300, 150); await shot('tab_typechart');
    await clickAt(page, 428, 21); // STATUSES tab
    check(`${tag}: STATUSES tab`, await page.evaluate(() => window.__engine.Engine.overlays.at(-1).tab === 2));
    await mouseTo(page, 320, 352);
    await shot('tab_statuses_1');
    const m = await page.evaluate(() => { const s = window.__engine.Engine.overlays.at(-1).stScroll; return { contentH: s.contentH }; });
    check(`${tag}: STATUSES scrolls`, m.contentH > 268, `contentH=${m.contentH}`);
    // page through it with the mouse wheel over the list, then jump to the end
    const [px, py] = await toPage(page, 320, 180); await page.mouse.move(px, py);
    for (let i = 2; i <= 6; i++) {
      await page.evaluate((i) => { const o = window.__engine.Engine.overlays.at(-1); o.stScroll.scroll = (i - 1) * 250; }, i);
      await mouseTo(page, 320, 352); await shot(`tab_statuses_${i}`);
    }
    await page.evaluate(() => { window.__engine.Engine.overlays.at(-1).stScroll.scroll = 1e6; });
    await shot('tab_statuses_end');
    // the arrow keys cycle the tabs: right from STATUSES wraps to COMBOS
    await page.keyboard.press('ArrowRight'); await sleep(150);
    check(`${tag}: ArrowRight wraps to COMBOS`, await page.evaluate(() => window.__engine.Engine.overlays.at(-1).tab === 0));
    await page.keyboard.press('ArrowLeft'); await sleep(150);
    check(`${tag}: ArrowLeft wraps to STATUSES`, await page.evaluate(() => window.__engine.Engine.overlays.at(-1).tab === 2));
    await page.evaluate(() => { window.__engine.Engine.overlays.at(-1).stScroll.scroll = 0; });
  }
  await clickAt(page, 320, 339); // CLOSE
  check(`${tag}: CLOSE`, (await top(page)) === null);
}

async function solo(browser, errors) {
  const page = await openPage(browser, errors);
  const ev = (fn, arg) => page.evaluate(fn, arg);
  await ev(async () => {
    G.meta.seenVersion = (await import('/src/game/version.js')).PATCH_NOTES[0].v; Object.assign(G.meta, { tutorialDone: true, tipCatch: true, hintBattles: 9, basicsSeen: true });
    const { Run } = await import('/src/game/run.js'); G.run = Run.create({ starter: 'CHARMANDER', ascension: 0, seed: 'INFO' });
    window.__flow.enterNode(G.run.map.start[0]);
  });
  await page.waitForFunction(() => { const s = window.__engine.Engine.scene; return s?.b && !s.busy && s.b.deck?.hand?.length >= 5 && !s.msg?.active; }, null, { timeout: 60000 });
  const shot = shooter(page, 'solo_battle');
  await mouseTo(page, 320, 4); await shot('screen');
  await infoTabs(page, shot, 'solo battle', true);
  // the solo map
  await ev(() => window.__flow.goToMap());
  await page.waitForFunction(() => window.__engine.Engine.scene?.constructor.name === 'MapScene', null, { timeout: 10000 });
  await sleep(600);
  const mshot = shooter(page, 'solo_map');
  await mouseTo(page, 320, 200); await mshot('screen');
  await infoTabs(page, mshot, 'solo map', false);
  // the HOW TO PLAY TYPES page names INFO > TYPE CHART
  await ev(async () => { (await import('/src/scenes/tutorial.js')).openHowToPlay(); });
  await sleep(300);
  await ev(() => { const o = window.__engine.Engine.overlays.at(-1); o.page = 1; });
  await shooter(page, 'howto')('types_page');
  await page.context().close();
}

// ---- co-op: a CoopSession for SLOT 1 on an in-memory log; this script plays P1 by posting into the log ----
const SLOT = 1;
const START = async ({ SLOT }) => {
  Object.assign(G.meta, { tutorialDone: true, tipCatch: true, hintBattles: 9 });
  G.meta.seenVersion = (await import('/src/game/version.js')).PATCH_NOTES[0].v;
  window.__engine.Engine.timeScale = 4;
  const { CoopSession } = await import('/src/scenes/coop/session.js');
  const log = [{ seq: 1, p: -1, type: 'init', seed: 'PROBE', ascension: 0, world: 'kanto', starters: ['CHARMANDER', 'SQUIRTLE'], names: ['ALICE', 'BOB'], nonce: 'init' }];
  const members = [0, 1].map(slot => ({ slot, name: ['ALICE', 'BOB'][slot], starter: null, ready: true, left: false, lastSeen: Date.now(), lastSeq: 0, maxPlayers: 4 }));
  const room = { _id: 'r1', code: 'INFOS', status: 'playing', host: 0, createdAt: 0 };
  const push = (a, p) => { const seq = log.length + 1; log.push({ ...a, seq, p }); return { seq, nonce: a.nonce, duplicate: false }; };
  const net = {
    randomNonce: () => Math.random().toString(36).slice(2), isNetworkError: () => false,
    heartbeat: async () => { members.forEach(m => { m.lastSeen = Date.now(); }); return { now: Date.now() }; },
    latestCheckpoint: async () => null, writeCheckpoint: async () => ({}),
    fetchSince: async (id, after) => ({ actions: log.filter(a => a.seq > after).map(a => ({ ...a })), more: false, status: room.status, room: { ...room, nextSeq: log.length + 1 }, members: members.map(m => ({ ...m })), me: SLOT, isHost: SLOT === 0, now: Date.now() }),
    postAction: async (id, a) => push(a, SLOT),
    finishRoom: async () => ({ score: 1, duplicate: false }),
  };
  net.CoopPoller = class {
    constructor(roomId, o) { Object.assign(this, o, { running: false }); }
    start() { this.running = true; const tick = async () => { if (!this.running) return; const r = await net.fetchSince('r1', this.after); const f = r.actions.filter(a => a.seq > this.after); if (f.length) { this.after = f[f.length - 1].seq; await this.onActions(f); } await this.onRoom(r.room, r.members, r); this.t = setTimeout(tick, 120); }; tick(); return this; }
    stop() { this.running = false; clearTimeout(this.t); return this; }
    kick() { return this; } setAfter(s) { this.after = s; return this; }
  };
  window.__sc = { log, push };
  new CoopSession(net, { roomId: 'r1', code: 'INFOS', mySlot: SLOT, members, now: Date.now() }).start();
};
const SETUP = async () => {
  const { maxHp } = await import('/src/game/pokemon.js');
  const s = window.__coop, g = s.game, w = g.world;
  for (const r of g.runs) for (const m of r.party) { m.level = Math.max(m.level, 12); m.hp = maxHp(m); }
  g.mirror();
  s.ck.set(s.lastSeq, g.checksum() >>> 0);
  const ids = w.map.start.map(id => w.map.nodes[id]);
  return (ids.find(n => /battle|trainer/i.test(n.type)) || ids[0]).id;
};

async function coop(browser, errors) {
  const page = await openPage(browser, errors);
  const ev = (fn, arg) => page.evaluate(fn, arg);
  await ev(START, { SLOT });
  await page.waitForFunction(() => window.__coop?.synced && window.__engine.Engine.scene?.constructor?.name === 'CoopMapScene', null, { timeout: 60000 });
  await sleep(1500);
  const mshot = shooter(page, 'coop_map');
  await mouseTo(page, 320, 200); await mshot('screen');
  await infoTabs(page, mshot, 'co-op map', false);
  const node = await ev(SETUP);
  await ev(({ node, SLOT }) => { window.__sc.push({ type: 'vote', node, nonce: 'v0' }, 1 - SLOT); window.__coop.vote(node); }, { node, SLOT });
  await page.waitForFunction(() => window.__engine.Engine.scene?.constructor?.name === 'CoopBattleScene', null, { timeout: 30000 });
  await page.waitForFunction(() => { const E = window.__engine.Engine, sc = E.scene; for (const o of E.overlays.slice().reverse()) o.close ? o.close(0) : E.overlays.pop(); if (sc.msg?.cur) sc.msg.cur.auto = 0.01; return sc.canAct?.(); }, null, { timeout: 30000, polling: 100 });
  await sleep(2000); // (the "Off to ..." toast)
  const shot = shooter(page, 'coop_battle');
  await mouseTo(page, 320, 4); await shot('screen');
  await infoTabs(page, shot, 'co-op battle', true);
  check('co-op: no desync', await ev(() => !window.__coop.desync));
  await page.context().close();
}

(async () => {
  const server = spawn(process.execPath, [path.join(root, 'serve.cjs'), String(port)], { cwd: root, stdio: 'ignore' });
  await sleep(700);
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
  const errors = [];
  try {
    for (const [name, fn] of [['solo', solo], ['coop', coop]]) {
      try { await fn(browser, errors); } catch (e) { check(`${name}: ran`, false, (e.stack || e.message).split('\n').slice(0, 2).join(' ')); }
    }
  } finally {
    check('no page errors', !errors.length, [...new Set(errors)].join(' | '));
    await browser.close(); server.kill();
  }
  console.log(fails ? `\n${fails} FAILED` : '\nall checks passed');
  process.exit(fails ? 1 : 0);
})();
