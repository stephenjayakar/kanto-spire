// v0.3.25 screenshots: the mythic "?" events (CERULEAN CAVE, FARAWAY ISLAND, BIRTH ISLAND, SKY PILLAR), their fights, the
// ONE LEGENDARY PER RUN UI (legendary node tooltip, catch prompt, reward note, gift label, ball tip) and the co-op MEWTWO
// fight with its all-target intents at 2 and 4 players (a CoopSession on an in-memory log, like uifix_shots.cjs).
// Muted Chrome, offline. Look at them.
//   node tests/mythic_shots.cjs [port=8747] [prefix=mythic]      ->  tests/out/<prefix>_*.png
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const port = +(process.argv[2] || 8747), prefix = process.argv[3] || 'mythic';
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
const shooter = (page) => async (name) => {
  await page.waitForTimeout(400);
  const file = path.join(out, `${prefix}_${name}.png`);
  await (await page.$('canvas')).screenshot({ path: file });
  console.log('saved', file);
};
const mouseTo = async (page, x, y) => { const box = await (await page.$('canvas')).boundingBox(); await page.mouse.move(box.x + x * box.width / 640, box.y + y * box.height / 360); };
const clickAt = async (page, x, y) => { const box = await (await page.$('canvas')).boundingBox(); await page.mouse.click(box.x + x * box.width / 640, box.y + y * box.height / 360); };

// A solo spire run in act `a` of the given regions, a decent team, sitting on a "?" node.
const SOLO = async ({ a, acts, post, relics = [], seen = [], legend = null, seed = 'MYSHOT' }) => {
  Object.assign(G.meta, { tutorialDone: true, tipCatch: true, hintBattles: 9, basicsSeen: true, unlocks: { ...G.meta.unlocks, win: true } });
  G.meta.seenVersion = (await import('/src/game/version.js')).PATCH_NOTES[0].v;
  const { Run } = await import('/src/game/run.js');
  const { makeMon, maxHp } = await import('/src/game/pokemon.js');
  const r = Run.create({ starter: 'CHARMANDER', seed, world: 'spire', regions: { acts, summit: acts[3], post }, champ: true });
  if (a) r.startAct(a);
  r.party = ['CHARIZARD', 'LAPRAS', 'JOLTEON'].map((sp, i) => makeMon(sp, r.act.levels[1] + 2 - i, { rng: r.rng }));
  for (const k of relics) r.addRelic(k);
  for (const s of seen) r.addSeen(s, false);
  if (legend) { r.legendTaken = legend; r.party.push(makeMon(legend, r.act.levels[1], { rng: r.rng })); }
  const ev = Object.values(r.map.nodes).find(n => n.type === 'event' && n.floor >= 3) || Object.values(r.map.nodes).find(n => n.floor >= 3);
  r.nodeId = ev.id; r.floor = ev.floor;
  G.run = r;
  return ev.id;
};
const showEvent = async (page, id) => page.evaluate(async (id) => {
  const r = G.run;
  r.pendingEventId = id; r.pendingEventAt = r.actIndex + ':' + r.nodeId;
  const { EventScene } = await import('/src/scenes/event.js');
  window.__engine.setScene(new EventScene());
}, id);
const waitIdle = (page) => page.waitForFunction(() => { const E = window.__engine.Engine, s = E.scene; if (s?.msg?.cur) s.msg.cur.auto = 0.01; return s && !s.busy; }, null, { timeout: 60000, polling: 100 });

async function solo(browser, errors) {
  const page = await openPage(browser, errors);
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const shot = shooter(page);
  const K = ['kanto', 'kanto', 'kanto', 'kanto'], KH = ['kanto', 'kanto', 'hoenn', 'hoenn'];
  // ---- the four event screens (and the choice tooltip)
  for (const [id, setup] of [
    ['cerulean_cave', { a: 2, acts: K, post: 'kanto' }],
    ['faraway_island', { a: 1, acts: K, post: 'kanto' }],
    ['birth_island', { a: 2, acts: KH, post: 'kanto', relics: ['METEORITE'] }],
    ['sky_pillar', { a: 2, acts: KH, post: 'hoenn', relics: ['RED_ORB'] }],
  ]) {
    await ev(SOLO, setup);
    await showEvent(page, id);
    await sleep(700);
    await mouseTo(page, 440, 204); await shot(`event_${id}`);
    const title = await ev(() => window.__engine.Engine.scene.ev?.id);
    check(`event screen ${id}`, title === id, title);
  }
  // CERULEAN CAVE when you already have a legendary
  await ev(SOLO, { a: 2, acts: K, post: 'kanto', legend: 'ZAPDOS' });
  await showEvent(page, 'cerulean_cave'); await sleep(600); await mouseTo(page, 440, 300); await shot('event_cerulean_cave_has_legend');
  // ---- the fights: start each event's battle through its choice
  for (const [id, setup, name] of [
    ['cerulean_cave', { a: 2, acts: K, post: 'kanto' }, 'battle_mewtwo'],
    ['faraway_island', { a: 1, acts: K, post: 'kanto' }, 'battle_mew'],
    ['birth_island', { a: 2, acts: KH, post: 'kanto', relics: ['METEORITE'] }, 'battle_deoxys'],
    ['sky_pillar', { a: 2, acts: KH, post: 'hoenn', relics: ['BLUE_ORB'] }, 'battle_rayquaza'],
  ]) {
    await ev(SOLO, setup);
    await showEvent(page, id); await sleep(500);
    await ev(async () => { const s = window.__engine.Engine.scene; const c = s.choices().find(x => x.mythic); s.choose(c); });
    await page.waitForFunction(() => { const E = window.__engine.Engine; for (const o of E.overlays.slice().reverse()) o.close ? o.close(true) : E.overlays.pop(); const s = E.scene; if (s?.msg?.cur) s.msg.cur.auto = 0.01; return s?.b && !s.busy && s.b.deck?.hand?.length >= 3; }, null, { timeout: 60000, polling: 100 });
    await sleep(900);
    if (id === 'faraway_island') { const b = await ev(() => { const s = window.__engine.Engine.scene; s.b.enemy().hp = Math.floor(s.b.enemy().maxHp * 0.7); return true; }); await mouseTo(page, 30, 270); }
    else await mouseTo(page, 330, 238);
    await shot(name);
    if (id === 'birth_island') {
      // next turn: DEFENSE FORME
      await ev(() => { const s = window.__engine.Engine.scene; s.doPass ? null : null; s.busy = true; s.runEvents(s.b.pass()); });
      await waitIdle(page); await sleep(800); await shot('battle_deoxys_turn2');
      const forme = await ev(() => window.__engine.Engine.scene.b.enemy().forme);
      check('DEOXYS forme turn 2', forme === 'DEFENSE', forme);
    }
  }
  // ---- ONE LEGENDARY PER RUN: legendary node tooltip on the map (fresh, then with a legendary)
  for (const legend of [null, 'MEW']) {
    await ev(SOLO, { a: 1, acts: K, post: 'kanto', legend });
    const pos = await ev(async () => {
      const r = G.run; const n = Object.values(r.map.nodes).find(x => x.type === 'legend');
      const { MapScene } = await import('/src/scenes/map.js');
      r.nodeId = n.prev[0]; r.floor = n.floor - 1;
      const sc = new MapScene(); window.__engine.setScene(sc);
      await new Promise(res => setTimeout(res, 300));
      sc.scroll = Math.max(0, (n.floor - 2) * 40);
      await new Promise(res => setTimeout(res, 300));
      const [x, y] = sc.nodePos(n); return { x, y };
    });
    await sleep(500); await mouseTo(page, pos.x, pos.y); await sleep(300); await mouseTo(page, pos.x + 1, pos.y); await shot(`map_legend_tip_${legend ? 'has_legend' : 'fresh'}`);
  }
  // ---- the catch prompt after a legendary node win, and the reward note once you have one
  for (const legend of [null, 'MEW']) {
    await ev(SOLO, { a: 1, acts: K, post: 'kanto', legend });
    await ev(async () => {
      const r = G.run; const { RNG } = await import('/src/game/rng.js'); const { Battle } = await import('/src/game/battle.js');
      const cfg = r.legendConfig(new RNG('lg'), 8, 'LEGEND_ZAPDOS');
      const b = new Battle(r, cfg); b.start(); b.enemy().hp = 0; b.checkEnemyFaint(true);
      const { RewardScene } = await import('/src/scenes/reward.js');
      window.__engine.setScene(new RewardScene(b, cfg, {}));
    });
    await page.waitForFunction(() => !window.__engine.Engine.scene.busy, null, { timeout: 30000 });
    await sleep(600);
    if (!legend) {
      const row = await ev(() => window.__engine.Engine.scene.rewards.findIndex(r => r.kind === 'legend'));
      check('reward: catch row', row >= 0);
      await mouseTo(page, 400, 60 + row * 34 + 15); await shot('reward_catch_row');
      await clickAt(page, 400, 60 + row * 34 + 15); await sleep(700); await shot('catch_prompt_one_legendary');
    } else {
      const row = await ev(() => window.__engine.Engine.scene.rewards.findIndex(r => r.kind === 'legendNote'));
      check('reward: one-legendary note', row >= 0);
      await mouseTo(page, 400, 60 + row * 34 + 15); await shot('reward_has_legend_note');
    }
  }
  // ---- a legendary gift greyed out, and the ball tip at a legendary elite
  await ev(SOLO, { a: 4, acts: KH, post: 'hoenn', legend: 'ZAPDOS' });
  await showEvent(page, 'southern_island'); await sleep(600); await mouseTo(page, 440, 230); await shot('gift_latias_has_legend');
  await ev(async () => {
    const r = G.run; const { makeEnemy } = await import('/src/game/battle.js'); const { RNG } = await import('/src/game/rng.js');
    const e = makeEnemy('LATIOS', 55, { rng: new RNG('lt'), legendary: true }); e.legendary = true; e.hp = Math.floor(e.maxHp * 0.3);
    r.balls.ULTRA_BALL = 3;
    window.__flow.startBattle({ kind: 'wild', elite: true, enemies: [e], terrain: 'grass', music: 'mus_vs_legend', dmgScale: 1, rng: new RNG('ltb'), legend: 'LATIOS' }, { id: r.nodeId, type: 'elite', floor: r.floor });
  });
  await page.waitForFunction(() => { const E = window.__engine.Engine; for (const o of E.overlays.slice().reverse()) o.close ? o.close(true) : E.overlays.pop(); const s = E.scene; if (s?.msg?.cur) s.msg.cur.auto = 0.01; return s?.b && !s.busy; }, null, { timeout: 60000, polling: 100 });
  await sleep(800);
  const by = await ev(() => 189 + G.run.party.length * 24 + 10);
  await mouseTo(page, 40, Math.min(334, by) + 10); await shot('ball_tip_has_legend');
  await page.context().close();
}

// ---- co-op: a CoopSession for SLOT 1 on an in-memory log; this script plays the others by posting into the log ----
const SLOT = 1;
const START = async ({ SLOT, N }) => {
  Object.assign(G.meta, { tutorialDone: true, tipCatch: true, hintBattles: 9 });
  G.meta.seenVersion = (await import('/src/game/version.js')).PATCH_NOTES[0].v;
  window.__engine.Engine.timeScale = 4;
  const EV = await import('/src/game/events.js');
  let seed = null; for (let i = 0; i < 4000 && !seed; i++) if (EV.MYTHIC_ROLL.MEWTWO({ seed: 'CAVE' + i, actIndex: 2, flags: {} })) seed = 'CAVE' + i;
  const { CoopSession } = await import('/src/scenes/coop/session.js');
  const NAMES = ['ALICE', 'BOB', 'CARL', 'DANA'].slice(0, N), ST = ['CHARMANDER', 'SQUIRTLE', 'BULBASAUR', 'PIKACHU'].slice(0, N);
  // (stamped with this code's logic id: unstamped actions would replay on the frozen v0.3.5 engine)
  const { LOGIC_ID } = await import('/src/game/coop/engines.js'), { VERSION } = await import('/src/game/version.js');
  const log = [{ seq: 1, p: -1, type: 'init', seed, ascension: 0, world: 'kanto', starters: ST, names: NAMES, nonce: 'init', eng: LOGIC_ID, v: VERSION }, { seq: 2, p: 0, type: 'champ', nonce: 'c0', eng: LOGIC_ID, v: VERSION }];
  const members = NAMES.map((name, slot) => ({ slot, name, starter: null, ready: true, left: false, lastSeen: Date.now(), lastSeq: 0, maxPlayers: 4 }));
  const room = { _id: 'r1', code: 'CAVE', status: 'playing', host: 0, createdAt: 0 };
  const push = (a, p) => { const seq = log.length + 1; log.push({ eng: LOGIC_ID, v: VERSION, ...a, seq, p }); return { seq, nonce: a.nonce, duplicate: false }; };
  const net = {
    randomNonce: () => Math.random().toString(36).slice(2), isNetworkError: () => false,
    heartbeat: async () => { members.forEach(m => { m.lastSeen = Date.now(); }); return { now: Date.now() }; },
    latestCheckpoint: async () => null, writeCheckpoint: async () => ({}),
    fetchSince: async (id, after) => ({ actions: log.filter(a => a.seq > after).map(a => ({ ...a })), more: false, status: room.status, room: { ...room, nextSeq: log.length + 1 }, members: members.map(m => ({ ...m })), me: SLOT, isHost: SLOT === 0, now: Date.now() }),
    postAction: async (id, a) => push(a, SLOT),
    finishRoom: async () => ({ score: 1, duplicate: false }),
  };
  // (the stand-in for net/coopnet.js CoopFeed, as in coop_hand_ui.cjs: it re-reads the in-memory log every 120 ms)
  net.CoopFeed = class {
    constructor(roomId, o) { Object.assign(this, o, { running: false }); }
    start() { this.running = true; const tick = async () => { if (!this.running) return; const r = await net.fetchSince('r1', this.after); const f = r.actions.filter(a => a.seq > this.after); if (f.length) { this.after = f[f.length - 1].seq; await this.onActions(f); } await this.onHead?.({ room: r.room, members: r.members, me: r.me, isHost: r.isHost }); if (!f.length) await this.onCaughtUp?.(); this.t = setTimeout(tick, 120); }; tick(); return this; }
    stop() { this.running = false; clearTimeout(this.t); return this; }
    kick() { return this; } setAfter(s) { this.after = s; return this; }
  };
  window.__sc = { log, push };
  new CoopSession(net, { roomId: 'r1', code: 'CAVE', mySlot: SLOT, members, now: Date.now() }).start();
};
// KANTO act 3, a "?" room right ahead, teams strong enough to show the fight
const SETUP = async () => {
  const { maxHp, makeMon } = await import('/src/game/pokemon.js');
  const s = window.__coop, g = s.game, w = g.world;
  w.startAct(2); for (const r of g.runs) r.startAct(2);
  const target = Object.values(w.map.nodes).find(n => n.floor === 4 && n.prev.length);
  target.type = 'event';
  w.nodeId = target.prev[0]; w.floor = 3;
  const extra = [['NIDOKING', 'ARCANINE'], ['STARMIE', 'MACHAMP'], ['VENUSAUR', 'GENGAR'], ['RAICHU', 'DRAGONITE']];
  g.runs.forEach((r, p) => { for (const m of r.party) { m.level = 38; m.hp = maxHp(m); } for (const sp of extra[p]) r.party.push(makeMon(sp, 36, { rng: r.rng })); });
  g.mirror();
  s.ck.set(s.lastSeq, g.checksum() >>> 0);
  return target.id;
};

async function coop(browser, errors, N) {
  const page = await openPage(browser, errors);
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const shot = shooter(page);
  await ev(START, { SLOT, N });
  await page.waitForFunction(() => window.__coop?.synced && window.__engine.Engine.scene?.constructor?.name === 'CoopMapScene', null, { timeout: 60000 });
  const node = await ev(SETUP);
  await sleep(400);
  await ev(({ node, SLOT, N }) => { for (let p = 0; p < N; p++) if (p !== SLOT) window.__sc.push({ type: 'vote', node, nonce: 'v' + p }, p); window.__coop.vote(node); }, { node, SLOT, N });
  await page.waitForFunction(() => window.__engine.Engine.scene?.constructor?.name === 'EventScene', null, { timeout: 30000 });
  await sleep(800);
  await mouseTo(page, 440, 204); await shot(`coop${N}_event_cerulean_cave`);
  check(`co-op ${N}p: CERULEAN CAVE`, await ev(() => window.__coop.game.sharedEvent?.id) === 'cerulean_cave');
  // the partners press their battle button (privateDone), then me
  await ev(async ({ SLOT, N }) => {
    const g = window.__coop.game, EV = await import('/src/game/events.js');
    for (let p = 0; p < N; p++) if (p !== SLOT) { const r = g.privateRunClone(p); EV.markSeen(r, EV.eventById('cerulean_cave')); window.__sc.push({ type: 'privateDone', run: g.snapshotRun(r), nonce: 'pd' + p }, p); }
    const s = window.__engine.Engine.scene; s.choose(s.choices().find(c => c.mythic));
  }, { SLOT, N });
  await page.waitForFunction(() => { const E = window.__engine.Engine; for (const o of E.overlays.slice().reverse()) o.close ? o.close(true) : E.overlays.pop(); return E.scene?.constructor?.name === 'CoopBattleScene'; }, null, { timeout: 30000, polling: 100 });
  const canAct = () => page.waitForFunction(() => { const E = window.__engine.Engine, sc = E.scene; for (const o of E.overlays.slice().reverse()) o.close ? o.close(0) : E.overlays.pop(); if (sc.msg?.cur) sc.msg.cur.auto = 0.01; return sc.canAct?.(); }, null, { timeout: 30000, polling: 100 });
  await canAct();
  await sleep(2000);
  await mouseTo(page, 330, 300); await shot(`coop${N}_mewtwo_all_target`);
  const its = await ev(() => window.__coop.game.battle.intents.filter(Boolean).map(it => [it.target, it.spread, it.move.key]));
  check(`co-op ${N}p: MEWTWO has one all-target intent per player`, its.length === N && its.every(x => x[1]), JSON.stringify(its));
  // hover the intent box
  await mouseTo(page, 372, 50); await shot(`coop${N}_mewtwo_intent_tip`);
  // everyone locks a pass: the turn plays out (the move announced, then it spreads), mid-animation
  await ev(({ SLOT, N }) => { for (let p = 0; p < N; p++) if (p !== SLOT) window.__sc.push({ type: 'lock', pass: true, nonce: 'pass' + p }, p); window.__coop.post({ type: 'lock', pass: true }); }, { SLOT, N });
  await sleep(1400); await shot(`coop${N}_mewtwo_turn_anim`);
  await canAct(); await sleep(1200); await mouseTo(page, 330, 300); await shot(`coop${N}_mewtwo_turn2`);
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
    for (const [name, fn] of [['solo', b => solo(b, errors)], ['coop2', b => coop(b, errors, 2)], ['coop4', b => coop(b, errors, 4)]]) {
      if (only && !only.split(',').includes(name)) continue;
      try { await fn(browser); } catch (e) { check(`${name}: ran`, false, (e.stack || e.message).split('\n').slice(0, 3).join(' ')); }
    }
  } finally {
    check('no page errors', !errors.length, [...new Set(errors)].join(' | '));
    await browser.close(); server.kill();
  }
  console.log(fails ? `\n${fails} FAILED` : '\nall checks passed');
})();
