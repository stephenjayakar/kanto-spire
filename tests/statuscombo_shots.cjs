// STATUS cards don't combo: screenshots of the NO COMBO stamp, lavender outline and combo-box note, solo and co-op
// (muted Chrome, offline, co-op on an in-memory net from player 2's seat, like coop_hand_ui.cjs). Look at them.
//   node tests/statuscombo_shots.cjs [port=8741] [prefix=statuscombo]
// Writes tests/out/<prefix>_solo_*.png and <prefix>_coop_*.png; fails on page errors or a missing TEAM UP state.
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const port = +(process.argv[2] || 8741), prefix = process.argv[3] || 'statuscombo';
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
// move the mouse to a game-space point (640x360)
const mouseTo = async (page, x, y) => { const box = await (await page.$('canvas')).boundingBox(); await page.mouse.move(box.x + x * box.width / 640, box.y + y * box.height / 360); };

async function solo(browser, errors) {
  const page = await openPage(browser, errors);
  const ev = (fn, arg) => page.evaluate(fn, arg);
  await ev(async () => {
    G.meta.seenVersion = (await import('/src/game/version.js')).PATCH_NOTES[0].v; Object.assign(G.meta, { tutorialDone: true, tipCatch: true, hintBattles: 9 });
    const { Run } = await import('/src/game/run.js'); G.run = Run.create({ starter: 'CHARMANDER', ascension: 0, seed: 'PROTO' });
    window.__flow.enterNode(G.run.map.start[0]);
  });
  await page.waitForFunction(() => { const s = window.__engine.Engine.scene; return s?.b && !s.busy && s.b.deck?.hand?.length >= 5 && !s.msg?.active; }, null, { timeout: 60000 });
  const shot = shooter(page, 'solo');
  // hand: EMBER, GROWL (status), FLAMETHROWER (FIRE PAIR with EMBER), SMOKESCREEN (status), SCRATCH
  const setHand = (arg) => ev(({ hand, sel }) => {
    const sc = window.__engine.Engine.scene, b = sc.b;
    const lead = b.lead(); lead.level = Math.max(lead.level, 12);
    b.deck.hand.slice(0, hand.length).forEach((c, i) => { c.move = hand[i]; c.uid = b.leadUid; c.faceDown = false; c.frozen = false; });
    sc.syncHand();
    sc.sel = sel.map(i => sc.handIds[i]);
  }, arg);
  const hand = ['EMBER', 'GROWL', 'FLAMETHROWER', 'SMOKESCREEN', 'SCRATCH'];
  await mouseTo(page, 320, 4);
  await setHand({ hand, sel: [0, 1, 2] }); await shot('pair_plus_status');
  await setHand({ hand, sel: [0, 1, 2, 3] }); await shot('pair_plus_two_status');
  await setHand({ hand, sel: [1, 3] }); await shot('support_only');
  await setHand({ hand, sel: [0, 1, 2] });
  const pos = await ev(() => { const sc = window.__engine.Engine.scene, v = sc.vis.get(sc.handIds[1]); return { x: v.x + 30, y: v.y + 60 }; });
  await mouseTo(page, pos.x, pos.y); await shot('hover_status');
  await mouseTo(page, 80, 70); await shot('hover_combo_box');
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
// the first battle node on the map; both parties a few levels up
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
  const node = await ev(SETUP);
  await ev(({ node, SLOT }) => { window.__sc.push({ type: 'vote', node, nonce: 'v0' }, 1 - SLOT); window.__coop.vote(node); }, { node, SLOT });
  await page.waitForFunction(() => window.__engine.Engine.scene?.constructor?.name === 'CoopBattleScene', null, { timeout: 30000 });
  const canAct = () => page.waitForFunction(() => { const E = window.__engine.Engine, sc = E.scene; for (const o of E.overlays.slice().reverse()) o.close ? o.close(0) : E.overlays.pop(); if (sc.msg?.cur) sc.msg.cur.auto = 0.01; return sc.canAct?.(); }, null, { timeout: 30000, polling: 100 });
  await canAct();
  await sleep(2000); // (the "Off to ..." toast)
  const shot = shooter(page, 'coop');
  // my (P2's) hand: BUBBLE, TAIL WHIP (status), WATER GUN (WATER PAIR with BUBBLE), WITHDRAW (status), TACKLE
  const hand = ['BUBBLE', 'TAIL_WHIP', 'WATER_GUN', 'WITHDRAW', 'TACKLE'];
  const setHand = (arg) => ev(({ hand, sel, SLOT }) => {
    const sc = window.__engine.Engine.scene, me = sc.duo.subs[SLOT], uid = me.run.party[0].uid;
    me.deck.hand.slice(0, hand.length).forEach((c, i) => { c.move = hand[i]; c.uid = uid; c.faceDown = false; c.frozen = false; });
    sc.syncHand(); sc._simKey = null; sc.setTarget(0);
    sc.sel = sel.map(i => sc.handIds[i]);
  }, { ...arg, SLOT });
  await mouseTo(page, 320, 4);
  await setHand({ hand, sel: [0, 1, 2] }); await shot('pair_plus_status');
  await setHand({ hand, sel: [0, 1, 2, 3] }); await shot('pair_plus_two_status');
  // lock in (P1 hasn't): the locked STATUS card keeps the stamp
  await setHand({ hand, sel: [0, 1, 2] });
  await ev(() => window.__engine.Engine.scene.doLock());
  await page.waitForFunction((SLOT) => !!window.__engine.Engine.scene.duo.locks[SLOT], SLOT, { timeout: 10000 });
  await shot('locked');
  await ev(() => window.__engine.Engine.scene.doUnlock());
  await page.waitForFunction((SLOT) => !window.__engine.Engine.scene.duo.locks[SLOT], SLOT, { timeout: 10000 });
  // P1 locks a damaging card on the same foe first: my preview is a TEAM UP
  await ev((SLOT) => { const sc = window.__engine.Engine.scene, so = sc.duo.subs[1 - SLOT]; const c = so.deck.hand.find(c => so.cardInfo(c).playable && !so.cardInfo(c).status) || so.deck.hand[0]; window.__sc.push({ type: 'lock', ids: [c.id], target: 0, nonce: 'o1' }, 1 - SLOT); }, SLOT);
  await page.waitForFunction((SLOT) => !!window.__engine.Engine.scene.duo.locks[1 - SLOT], SLOT, { timeout: 10000 });
  await canAct();
  await setHand({ hand, sel: [0, 1, 2] });
  await sleep(200);
  check('co-op: the preview is a TEAM UP', await ev(() => !!window.__engine.Engine.scene.previewSim()?.teamUp));
  await shot('teamup_status');
  await setHand({ hand, sel: [0, 2] }); await shot('teamup_no_status');
  await setHand({ hand, sel: [0, 1, 2] });
  await mouseTo(page, 80, 70); await shot('teamup_hover_combo_box');
  const pos = await ev(() => { const sc = window.__engine.Engine.scene, v = sc.vis.get(sc.handIds[1]); return { x: v.x + 30, y: v.y + 60 }; });
  await mouseTo(page, pos.x, pos.y); await shot('hover_status');
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
