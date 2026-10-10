// UI screenshots for the move-order tags, the ascension HUD badge, held-item bonus counters and the shop's reroll at the
// held-item limit: solo battle, map and mart, plus co-op battles at 2 and 4 players (in-memory log, like
// statuscombo_shots.cjs). Muted Chrome, offline. Look at them.
//   node tests/uifix_shots.cjs [port=8743] [prefix=uifix]      ->  tests/out/<prefix>_*.png
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const port = +(process.argv[2] || 8743), prefix = process.argv[3] || 'uifix';
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
const shooter = (page) => async (name) => {
  await page.waitForTimeout(400);
  const file = path.join(out, `${prefix}_${name}.png`);
  await (await page.$('canvas')).screenshot({ path: file });
  console.log('saved', file);
};
// move the mouse to a game-space point (640x360)
const mouseTo = async (page, x, y) => { const box = await (await page.$('canvas')).boundingBox(); await page.mouse.move(box.x + x * box.width / 640, box.y + y * box.height / 360); };
const clickAt = async (page, x, y) => { const box = await (await page.$('canvas')).boundingBox(); await page.mouse.click(box.x + x * box.width / 640, box.y + y * box.height / 360); };

// a run at A6 with a long act name, every badge of the act, and the accumulating held items
const SOLO_RUN = async ({ asc, relics }) => {
  G.meta.seenVersion = (await import('/src/game/version.js')).PATCH_NOTES[0].v; Object.assign(G.meta, { tutorialDone: true, tipCatch: true, hintBattles: 9, basicsSeen: true });
  const { Run } = await import('/src/game/run.js');
  G.run = Run.create({ starter: 'CHARMANDER', ascension: asc, seed: 'UIFIX' });
  for (const k of relics) G.run.addRelic(k);
  G.run.stats.trainers = 13;
  const pj = G.run.relics.find(r => r.key === 'POWDER_JAR'); if (pj) pj.state = { p: 7, n: 2 };
  const ss = G.run.relics.find(r => r.key === 'SHOAL_SHELL'); if (ss) ss.state = { n: 4 };
  const mt = G.run.relics.find(r => r.key === 'MYSTIC_TICKET'); if (mt) mt.state = { n: 9 };
};
const RELICS = ['FAME_CHECKER', 'POWDER_JAR', 'BLACK_FLUTE', 'SHOAL_SHELL', 'MYSTIC_TICKET', 'TEACHY_TV', 'POKEBLOCK_CASE', 'QUICK_CLAW', 'METEORITE'];

async function solo(browser, errors) {
  const page = await openPage(browser, errors);
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const shot = shooter(page);
  // ---- map: HUD with the ascension badge, a long act name and badges
  await ev(SOLO_RUN, { asc: 7, relics: RELICS });
  await ev(async () => { const { MapScene } = await import('/src/scenes/map.js'); G.run.badges = ['BOULDER', 'CASCADE', 'THUNDER']; window.__engine.setScene(new MapScene()); });
  await sleep(800);
  await mouseTo(page, 320, 200); await shot('map_hud');
  const asc = await ev(async () => (await import('/src/scenes/common.js')).hudAscBox?.());
  check('map: ascension badge drawn', !!asc, JSON.stringify(asc));
  if (asc) { await mouseTo(page, asc.x + asc.w / 2, asc.y + asc.h / 2); await shot('map_hud_asc_tip'); }
  // FAME CHECKER on the map: hover its icon
  const relicPos = async (key) => ev(async (key) => (await import('/src/scenes/common.js')).hudRelicBox?.(key), key);
  let fc = await relicPos('FAME_CHECKER');
  if (fc) { await mouseTo(page, fc.x + 6, fc.y + 12); await shot('map_fame_tip'); }
  // the longest act name (act 5 / the Johto world) at A5+ with a level cap and all the badges
  await ev(async () => { G.run.actIndex = G.run.acts.length - 1; G.run.badges = ['BOULDER', 'CASCADE', 'THUNDER', 'RAINBOW', 'SOUL', 'MARSH', 'VOLCANO', 'EARTH']; });
  await sleep(300); await mouseTo(page, 320, 200); await shot('map_hud_lastact');
  await ev(async () => { G.run.actIndex = 0; G.run.badges = []; });

  // ---- battle
  await ev(async () => { G.run.actIndex = 0; window.__flow.enterNode(G.run.map.start[0]); });
  await page.waitForFunction(() => { const s = window.__engine.Engine.scene; return s?.b && !s.busy && s.b.deck?.hand?.length >= 5 && !s.msg?.active; }, null, { timeout: 60000 });
  await ev(() => { const b = window.__engine.Engine.scene.b; b.handsPlayed = 2; b.leadStreak = 2; const e = b.enemy(); e.hp = Math.ceil(e.maxHp * 0.55); b.quickClawProc = false; b.updateIntentPreview(); });
  await mouseTo(page, 330, 238); await shot('solo_battle');
  const order = await ev(() => window.__engine.Engine.scene.orderInfo?.());
  check('solo: order info', !!order, JSON.stringify(order && { foeFirst: order.foeFirst }));
  // hover the tags
  const tags = await ev(() => window.__engine.Engine.scene.orderTagBoxes || []);
  for (const [i, t] of tags.entries()) { await mouseTo(page, t.x + t.w / 2, t.y + t.h / 2); await shot(`solo_order_tip${i}`); }
  // a priority card selected flips the order (QUICK ATTACK) when the foe is faster
  await ev(() => {
    const sc = window.__engine.Engine.scene, b = sc.b;
    b.enemy().stats.spe = 999; b.updateIntentPreview();
    const c = b.deck.hand[0]; c.move = 'QUICK_ATTACK'; c.uid = b.leadUid; c.faceDown = false; c.frozen = false;
    sc.syncHand(); sc.sel = [];
  });
  await mouseTo(page, 330, 238); await shot('solo_foe_faster');
  await ev(() => { const sc = window.__engine.Engine.scene; sc.sel = [sc.handIds[0]]; });
  await shot('solo_quick_attack_selected');
  const o2 = await ev(() => window.__engine.Engine.scene.orderInfo?.());
  check('solo: QUICK ATTACK selected -> you first', o2 && !o2.foeFirst);
  // relic counters in battle: hover each accumulating item
  for (const k of ['FAME_CHECKER', 'POWDER_JAR', 'BLACK_FLUTE', 'TEACHY_TV']) {
    const p = await relicPos(k);
    if (p) { await mouseTo(page, p.x + 6, p.y + 12); await shot(`solo_relic_${k.toLowerCase()}`); }
  }
  await mouseTo(page, 330, 238);
  // the widest HUD: post-game act, A10, all 8 badges, in battle
  await ev(() => { G.run._asc = G.run.ascension; G.run.ascension = 10; G.run._act = G.run.actIndex; G.run.actIndex = G.run.acts.length - 1; G.run.badges = ['BOULDER', 'CASCADE', 'THUNDER', 'RAINBOW', 'SOUL', 'MARSH', 'VOLCANO', 'EARTH']; });
  await shot('solo_battle_hud_widest');
  await mouseTo(page, 150, 12); await shot('solo_battle_badges_tip');
  await ev(() => { G.run.ascension = G.run._asc; G.run.actIndex = G.run._act; G.run.badges = []; });
  await mouseTo(page, 330, 238);
  // ---- shop at the held-item limit
  await ev(async () => {
    const { ShopScene } = await import('/src/scenes/shop.js');
    G.run.money = 20000; G.run.nodeId = 'shoptest';
    const s = new ShopScene(); window.__engine.setScene(s);
  });
  await sleep(600);
  await shot('shop_before');
  const rr = await ev(async () => { const { TUNING } = await import('/src/game/run.js'); const sc = window.__engine.Engine.scene; sc.shop.relicsBought = TUNING.shopRelicBuys; return true; });
  await mouseTo(page, 562, 360 - 52); await shot('shop_limit_hover');
  const before = await ev(() => G.run.money);
  await clickAt(page, 562, 360 - 52); await sleep(300);
  const after = await ev(() => G.run.money);
  check('shop: reroll at the limit does nothing on one click', before === after, `${before} -> ${after}`);
  await shot('shop_limit_clicked');
  await page.context().close();
}

// ---- co-op: a CoopSession for SLOT 1 on an in-memory log; this script plays the others by posting into the log ----
const SLOT = 1;
const START = async ({ SLOT, N, asc }) => {
  Object.assign(G.meta, { tutorialDone: true, tipCatch: true, hintBattles: 9 });
  G.meta.seenVersion = (await import('/src/game/version.js')).PATCH_NOTES[0].v;
  window.__engine.Engine.timeScale = 4;
  const { CoopSession } = await import('/src/scenes/coop/session.js');
  const NAMES = ['ALICE', 'BOB', 'CARL', 'DANA'].slice(0, N), ST = ['CHARMANDER', 'SQUIRTLE', 'BULBASAUR', 'PIKACHU'].slice(0, N);
  const log = [{ seq: 1, p: -1, type: 'init', seed: 'PROBE', ascension: asc, world: 'kanto', starters: ST, names: NAMES, nonce: 'init' }];
  const members = NAMES.map((name, slot) => ({ slot, name, starter: null, ready: true, left: false, lastSeen: Date.now(), lastSeq: 0, maxPlayers: 4 }));
  const room = { _id: 'r1', code: 'STATS', status: 'playing', host: 0, createdAt: 0 };
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
  new CoopSession(net, { roomId: 'r1', code: 'STATS', mySlot: SLOT, members, now: Date.now() }).start();
};
const SETUP = async () => {
  const { maxHp } = await import('/src/game/pokemon.js');
  const s = window.__coop, g = s.game, w = g.world;
  for (const r of g.runs) for (const m of r.party) { m.level = Math.max(m.level, 12); m.hp = maxHp(m); }
  g.mirror();
  s.ck.set(s.lastSeq, g.checksum() >>> 0);
  const ids = w.map.start.map(id => w.map.nodes[id]);
  return (ids.find(n => /trainer/i.test(n.type)) || ids.find(n => /battle/i.test(n.type)) || ids[0]).id;
};

async function coop(browser, errors, N, asc) {
  const page = await openPage(browser, errors);
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const shot = shooter(page);
  await ev(START, { SLOT, N, asc });
  await page.waitForFunction(() => window.__coop?.synced && window.__engine.Engine.scene?.constructor?.name === 'CoopMapScene', null, { timeout: 60000 });
  const node = await ev(SETUP);
  await sleep(500);
  await mouseTo(page, 320, 200); await shot(`coop${N}_map`);
  const asc0 = await ev(async () => (await import('/src/scenes/common.js')).hudAscBox?.());
  if (asc0) { await mouseTo(page, asc0.x + asc0.w / 2, asc0.y + asc0.h / 2); await shot(`coop${N}_map_asc_tip`); }
  await ev(({ node, SLOT, N }) => { for (let p = 0; p < N; p++) if (p !== SLOT) window.__sc.push({ type: 'vote', node, nonce: 'v' + p }, p); window.__coop.vote(node); }, { node, SLOT, N });
  await page.waitForFunction(() => window.__engine.Engine.scene?.constructor?.name === 'CoopBattleScene', null, { timeout: 30000 });
  const canAct = () => page.waitForFunction(() => { const E = window.__engine.Engine, sc = E.scene; for (const o of E.overlays.slice().reverse()) o.close ? o.close(0) : E.overlays.pop(); if (sc.msg?.cur) sc.msg.cur.auto = 0.01; return sc.canAct?.(); }, null, { timeout: 30000, polling: 100 });
  await canAct();
  await sleep(2000);
  await mouseTo(page, 330, 238); await shot(`coop${N}_battle`);
  const tags = await ev(() => window.__engine.Engine.scene.orderTagBoxes || []);
  check(`co-op ${N}p: order tags`, tags.length >= 2, String(tags.length));
  if (tags[0]) { await mouseTo(page, tags[0].x + tags[0].w / 2, tags[0].y + tags[0].h / 2); await shot(`coop${N}_order_tip`); }
  // a partner locks a QUICK ATTACK hand: they move up
  await ev(({ SLOT }) => {
    const sc = window.__engine.Engine.scene, o = (SLOT + 1) % sc.duo.n, so = sc.duo.subs[o];
    const c = so.deck.hand[0]; c.move = 'QUICK_ATTACK'; c.uid = so.run.party[0].uid; c.faceDown = false; c.frozen = false;
    window.__sc.push({ type: 'lock', ids: [c.id], target: 0, nonce: 'q1' }, o);
  }, { SLOT });
  await sleep(800); await canAct();
  await mouseTo(page, 330, 238); await shot(`coop${N}_partner_quick`);
  await ev(({ SLOT }) => {
    const sc = window.__engine.Engine.scene, me = sc.duo.subs[SLOT];
    const c = me.deck.hand[0]; c.move = 'QUICK_ATTACK'; c.uid = me.run.party[0].uid; c.faceDown = false; c.frozen = false;
    sc.syncHand(); sc._simKey = null; sc.sel = [c.id];
  }, { SLOT });
  await sleep(300); await shot(`coop${N}_my_quick_attack`);
  const myPos = await ev((SLOT) => window.__engine.Engine.scene.orderPosOfPlayer(SLOT), SLOT);
  check(`co-op ${N}p: my QUICK ATTACK puts me ahead of the slower players`, myPos >= 1 && myPos <= 2, String(myPos));
  check(`co-op ${N}p: no desync`, await ev(() => !window.__coop.desync));
  await page.context().close();
}

(async () => {
  const server = spawn(process.execPath, [path.join(root, 'serve.cjs'), String(port)], { cwd: root, stdio: 'ignore' });
  await sleep(700);
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
  const errors = [];
  try {
    const only = process.env.ONLY;
    for (const [name, fn] of [['solo', b => solo(b, errors)], ['coop2', b => coop(b, errors, 2, 3)], ['coop4', b => coop(b, errors, 4, 8)]]) {
      if (only && !only.split(',').includes(name)) continue;
      try { await fn(browser); } catch (e) { check(`${name}: ran`, false, (e.stack || e.message).split('\n').slice(0, 3).join(' ')); }
    }
  } finally {
    check('no page errors', !errors.length, [...new Set(errors)].join(' | '));
    await browser.close(); server.kill();
  }
  console.log(fails ? `\n${fails} FAILED` : '\nall checks passed');
  process.exit(fails ? 1 : 0);
})();
