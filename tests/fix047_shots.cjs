// v0.4.7 screenshots: the co-op room's ascension (my best + each player's unlock with their starter), every stat stage
// (ACC / EVA too) in solo and co-op battles, no lethal tell on a hidden (A2+) intent, and NIDORAN♀'s icon in the party
// panel and the Pokédex. Muted Chrome, offline (cloud.json 404s). Look at them.
//   node tests/fix047_shots.cjs [port=8747] [prefix=fix047]      ->  tests/out/<prefix>_*.png      (ONLY=lobby,solo,coop2,coop4,icons)
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const port = +(process.argv[2] || 8747), prefix = process.argv[3] || 'fix047';
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
  return page;
}
const shooter = (page) => async (name) => {
  await page.waitForTimeout(400);
  const file = path.join(out, `${prefix}_${name}.png`);
  await (await page.$('canvas')).screenshot({ path: file });
  console.log('saved', file);
};
const mouseTo = async (page, x, y) => { const box = await (await page.$('canvas')).boundingBox(); await page.mouse.move(box.x + x * box.width / 640, box.y + y * box.height / 360); };
// pixels of a game-space rect (640x360) from a 1280x720 canvas screenshot: [r, g, b] per pixel, sampled at 2x
const pixels = (page, x, y, w, h) => page.evaluate(({ x, y, w, h }) => {
  const c = document.querySelector('canvas'), g = c.getContext('2d'), sx = c.width / 640;
  const d = g.getImageData(Math.round(x * sx), Math.round(y * sx), Math.round(w * sx), Math.round(h * sx)).data, outp = [];
  for (let i = 0; i < d.length; i += 4) outp.push([d[i], d[i + 1], d[i + 2]]);
  return outp;
}, { x, y, w, h });
const reddish = (px) => px.filter(([r, g, b]) => r > 200 && g < 90 && b < 90).length;

// ---- 1. co-op room: three players (mock backend), my best + per-starter unlock badges ----
async function lobby(browser, errors) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await ctx.route('**/cloud.json', r => r.fulfill({ status: 404, body: '' }));
  const NAMES = ['ALICE', 'BOB', 'CARL'], ST = ['CHARMANDER', 'SQUIRTLE', null];
  const pages = [];
  for (let i = 0; i < NAMES.length; i++) {
    const p = await ctx.newPage(); pages.push(p); watch(p, errors);
    if (i === 0) { await p.goto(`http://localhost:${port}/?coopdev=${NAMES[0]}`); await p.evaluate(() => { localStorage.clear(); sessionStorage.clear(); }); }
    await p.goto(`http://localhost:${port}/?coopdev=${NAMES[i]}`, { waitUntil: 'load' });
    await p.waitForFunction(() => window.__ready && window.G?.meta, null, { timeout: 60000 });
    await p.evaluate((i) => {
      Object.assign(G.meta, { tutorialDone: true, seenVersion: 'v9', hintBattles: 9 });
      G.meta.ascBy = [{ CHARMANDER: 4, BULBASAUR: 6 }, { SQUIRTLE: 2 }, {}][i];
      G.meta.bestAscensionWon = [5, 1, -1][i]; G.meta.maxAscension = [6, 2, 0][i];
    }, i);
  }
  const net = (p, fn, ...arg) => p.evaluate(async ({ fn, arg }) => { const n = await import('/src/scenes/coop/mocknet.js'); return n[fn](...arg); }, { fn, arg });
  // the menu first (my best under the buttons)
  await pages[0].evaluate(async () => { const { CoopLobbyScene } = await import('/src/scenes/coop/lobby.js'); window.__engine.setScene(new CoopLobbyScene()); });
  await sleep(1200); await mouseTo(pages[0], 2, 2);
  const shot = shooter(pages[0]);
  await shot('lobby_menu');
  const r = await net(pages[0], 'createRoom', { ascension: 2, world: 'spire' });
  for (const p of pages.slice(1)) await net(p, 'joinRoom', r.code);
  for (const [i, p] of pages.entries()) if (ST[i]) await net(p, 'setStarter', r.roomId, ST[i], await p.evaluate((s) => G.meta.ascBy[s] || 0, ST[i]));
  await pages[0].evaluate(async (roomId) => {
    const s = window.__engine.Engine.scene;
    for (let i = 0; i < 50 && !s.net; i++) await new Promise(res => setTimeout(res, 100));
    s.openRoom(roomId);
  }, r.roomId);
  await pages[0].waitForFunction(() => window.__engine.Engine.scene.view?.members?.length === 3, null, { timeout: 20000 });
  await sleep(800); await mouseTo(pages[0], 2, 2);
  await shot('lobby_room');
  const view = await pages[0].evaluate(() => window.__engine.Engine.scene.view.members.map(m => [m.name, m.starter, m.ascMax]));
  check('lobby: the others\' per-starter unlock is in the room view (ascMax)', view.some(([n, s, a]) => n === 'BOB' && a === 2), JSON.stringify(view));
  await mouseTo(pages[0], 190, 155); await shot('lobby_room_tip_me');
  await mouseTo(pages[0], 190, 197); await shot('lobby_room_tip_bob');
  await mouseTo(pages[0], 180, 91); await shot('lobby_room_tip_best');
  await ctx.close();
}

// ---- 2 + 3. solo battles: stat stages (SAND-ATTACK on me, ACC / EVA on the foe), then A2 with a lethal hidden intent ----
const SOLO_BATTLE = async ({ asc, seed }) => {
  G.meta.seenVersion = (await import('/src/game/version.js')).PATCH_NOTES[0].v;
  Object.assign(G.meta, { tutorialDone: true, tipCatch: true, hintBattles: 9, basicsSeen: true });
  const { Run } = await import('/src/game/run.js');
  G.run = Run.create({ starter: 'CHARMANDER', ascension: asc, seed });
  G.run.actIndex = 0; window.__flow.enterNode(G.run.map.start[0]);
};
const battleReady = () => { const s = window.__engine.Engine.scene; return s?.b && !s.busy && s.b.deck?.hand?.length >= 5 && !s.msg?.active; };
async function solo(browser, errors) {
  const page = await openPage(browser, errors);
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const shot = shooter(page);
  await ev(SOLO_BATTLE, { asc: 0, seed: 'STAGES' });
  await page.waitForFunction(battleReady, null, { timeout: 60000 });
  // the foe uses SAND-ATTACK on me (the real effect through the battle's stage code: event + message), and I have
  // lowered its accuracy and raised nothing; then a second foe stage
  await ev(() => { const b = window.__engine.Engine.scene.b; b.addStage('player', 'acc', -1, null, true); b.addStage('enemy', 'acc', -1, null, true); b.addStage('enemy', 'eva', 1); b.events.length = 0; b.messages && (b.messages.length = 0); });
  await mouseTo(page, 2, 2); await shot('solo_stages_acc');
  const st = await ev(() => { const b = window.__engine.Engine.scene.b; return [b.sides.player.stages.acc, b.sides.enemy.stages.acc, b.sides.enemy.stages.eva]; });
  check('solo: SAND-ATTACK stage applied (player ACC -1)', st[0] === -1, JSON.stringify(st));
  // every stat at once on both sides (the row condenses to fit)
  await ev(() => { const b = window.__engine.Engine.scene.b; Object.assign(b.sides.player.stages, { atk: 2, def: -1, spa: 1, spd: -2, spe: 3, acc: -1, eva: 1 }); Object.assign(b.sides.enemy.stages, { atk: -2, def: 1, spa: -1, spd: 2, spe: -3, acc: -1, eva: 2 }); });
  await shot('solo_stages_all');
  await mouseTo(page, 520, 93); await shot('solo_stages_all_foe_tip');
  await mouseTo(page, 300, 160); await shot('solo_stages_all_lead_tip');
  await page.context().close();

  // A2: a lethal attack against my lead, intent hidden -> no KO!, no red frame
  const p2 = await openPage(browser, errors);
  const ev2 = (fn, arg) => p2.evaluate(fn, arg);
  await ev2(SOLO_BATTLE, { asc: 2, seed: 'LETHAL' });
  await p2.waitForFunction(battleReady, null, { timeout: 60000 });
  const lethal = await ev2(async () => {
    const { D } = await import('/src/game/data.js');
    const b = window.__engine.Engine.scene.b;
    b.lead().hp = 1; b.enemy().stats.spe = 1; b.intent = { move: D.moves.TACKLE, first: false }; b.updateIntentPreview();
    return { lethal: b.intent.lethal, kind: b.intent.kind, asc: G.run.ascension };
  });
  check('solo A2: the intent is a lethal attack', lethal.lethal && lethal.kind === 'attack' && lethal.asc === 2, JSON.stringify(lethal));
  await mouseTo(p2, 2, 2);
  // the old KO! blinked at 3 Hz: sample the intent panel over a second
  let red = 0;
  for (let k = 0; k < 8; k++) { red = Math.max(red, reddish(await pixels(p2, 174, 91, 172, 30))); await sleep(130); }
  check('solo A2: no red (KO! / attack frame) on the hidden intent over a second', red === 0, `red px ${red}`);
  await shooter(p2)('solo_a2_lethal_hidden');
  // the same at A0 for comparison: KO! still shows there
  await ev2(() => { G.run.ascension = 0; });
  let red0 = 0;
  for (let k = 0; k < 8; k++) { red0 = Math.max(red0, reddish(await pixels(p2, 174, 91, 172, 30))); await sleep(130); }
  check('solo A0: the lethal tell still shows below A2', red0 > 0, `red px ${red0}`);
  await shooter(p2)('solo_a0_lethal_shown');
  await p2.context().close();
}

// ---- co-op: a CoopSession for SLOT 1 on an in-memory log (like uifix_shots.cjs) ----
const SLOT = 1;
const START = async ({ SLOT, N, asc }) => {
  Object.assign(G.meta, { tutorialDone: true, tipCatch: true, hintBattles: 9 });
  G.meta.seenVersion = (await import('/src/game/version.js')).PATCH_NOTES[0].v;
  window.__engine.Engine.timeScale = 4;
  const { CoopSession } = await import('/src/scenes/coop/session.js');
  const NAMES = ['ALICE', 'BOB', 'CARL', 'DANA'].slice(0, N), ST = ['CHARMANDER', 'SQUIRTLE', 'BULBASAUR', 'PIKACHU'].slice(0, N);
  const log = [{ seq: 1, p: -1, type: 'init', seed: 'FIX047', ascension: asc, world: 'kanto', starters: ST, names: NAMES, nonce: 'init' }];
  const members = NAMES.map((name, slot) => ({ slot, name, starter: null, ready: true, left: false, lastSeen: Date.now(), lastSeq: 0, maxPlayers: 4 }));
  const room = { _id: 'r1', code: 'STAGE', status: 'playing', host: 0, createdAt: 0 };
  const push = (a, p) => { const seq = log.length + 1; log.push({ ...a, seq, p }); return { seq, nonce: a.nonce, duplicate: false }; };
  const net = {
    randomNonce: () => Math.random().toString(36).slice(2), isNetworkError: () => false,
    heartbeat: async () => { members.forEach(m => { m.lastSeen = Date.now(); }); return { now: Date.now() }; },
    latestCheckpoint: async () => null, writeCheckpoint: async () => ({}),
    fetchSince: async (id, after) => ({ actions: log.filter(a => a.seq > after).map(a => ({ ...a })), more: false, status: room.status, room: { ...room, nextSeq: log.length + 1 }, members: members.map(m => ({ ...m })), me: SLOT, isHost: SLOT === 0, now: Date.now() }),
    postAction: async (id, a) => push(a, SLOT),
    finishRoom: async () => ({ score: 1, duplicate: false }),
  };
  // (the stand-in for net/coopnet.js CoopFeed, as in mythic_shots.cjs: it re-reads the in-memory log every 120 ms)
  net.CoopFeed = class {
    constructor(roomId, o) { Object.assign(this, o, { running: false }); }
    start() { this.running = true; const tick = async () => { if (!this.running) return; const r = await net.fetchSince('r1', this.after); const f = r.actions.filter(a => a.seq > this.after); if (f.length) { this.after = f[f.length - 1].seq; await this.onActions(f); } await this.onHead?.({ room: r.room, members: r.members, me: r.me, isHost: r.isHost }); if (!f.length) await this.onCaughtUp?.(); this.t = setTimeout(tick, 120); }; tick(); return this; }
    stop() { this.running = false; clearTimeout(this.t); return this; }
    kick() { return this; } setAfter(s) { this.after = s; return this; }
  };
  window.__sc = { log, push };
  new CoopSession(net, { roomId: 'r1', code: 'STAGE', mySlot: SLOT, members, now: Date.now() }).start();
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
  await ev(({ node, SLOT, N }) => { for (let p = 0; p < N; p++) if (p !== SLOT) window.__sc.push({ type: 'vote', node, nonce: 'v' + p }, p); window.__coop.vote(node); }, { node, SLOT, N });
  await page.waitForFunction(() => window.__engine.Engine.scene?.constructor?.name === 'CoopBattleScene', null, { timeout: 30000 });
  await page.waitForFunction(() => { const E = window.__engine.Engine, sc = E.scene; for (const o of E.overlays.slice().reverse()) o.close ? o.close(0) : E.overlays.pop(); if (sc.msg?.cur) sc.msg.cur.auto = 0.01; return sc.canAct?.(); }, null, { timeout: 30000, polling: 100 });
  await sleep(1500);
  // stages: SAND-ATTACK on me (my side's ACC -1), a partner's EVA +1 (MINIMIZE), the foe's ACC -1 / EVA +1 (display only:
  // straight into the local mirror, nothing is posted)
  await ev(({ SLOT, N }) => {
    const sc = window.__engine.Engine.scene, d = sc.duo;
    d.subs[SLOT].sides.player.stages.acc = -1;
    d.subs[(SLOT + 1) % N].sides.player.stages.eva = 1;
    d.subs[(SLOT + 1) % N].sides.player.stages.atk = 2;
    const ri = d.field[0]; Object.assign(d.enemySides[ri].stages, { acc: -1, eva: 1 });
  }, { SLOT, N });
  await mouseTo(page, 2, 2); await shot(`coop${N}a${asc}_stages_acc`);
  await ev(({ SLOT }) => { const d = window.__engine.Engine.scene.duo, ri = d.field[0]; Object.assign(d.enemySides[ri].stages, { atk: 2, def: -1, spa: 1, spd: -1, spe: 1, acc: -1, eva: 1 }); Object.assign(d.subs[SLOT].sides.player.stages, { atk: 1, def: 1, spa: -1, spd: 1, spe: -2, acc: -1, eva: 2 }); }, { SLOT });
  await shot(`coop${N}a${asc}_stages_all`);
  await mouseTo(page, 230, 50); await shot(`coop${N}a${asc}_stages_all_foe_tip`);
  await mouseTo(page, 2, 2);
  check(`co-op ${N}p: no desync`, await ev(() => !window.__coop.desync));
  // every foe action becomes a lethal TACKLE on me
  const lethal = await ev(async (SLOT) => {
    const { D } = await import('/src/game/data.js');
    const sc = window.__engine.Engine.scene, d = sc.duo;
    d.subs[SLOT].lead().hp = 1;
    for (const e of d.enemies) if (e?.stats) e.stats.spe = 1; // (no FIRST! label: its red is not a tell)
    d.intents.forEach(it => { if (it) { it.move = D.moves.TACKLE; it.target = SLOT; delete it.spread; } });
    d.refreshIntents();
    return d.intents.filter(Boolean).map(it => [it.target, it.kind, it.lethal]);
  }, SLOT);
  check(`co-op ${N}p A${asc}: lethal intents on me`, lethal.length && lethal.every(([t, k, l]) => t === SLOT && k === 'attack' && l), JSON.stringify(lethal));
  await mouseTo(page, 2, 2);
  // the intent column (2 players: x 318-420; 3-4: 318-432), both slots, sampled over a second for a blink
  let red = 0;
  for (let k = 0; k < 8; k++) { red = Math.max(red, reddish(await pixels(page, 314, 28, 124, 90))); await sleep(130); }
  if (asc >= 2) check(`co-op ${N}p A${asc}: no red frame / KO! on the hidden lethal intents`, red === 0, `red px ${red}`);
  else check(`co-op ${N}p A${asc}: the lethal tell still shows below A2`, red > 0, `red px ${red}`);
  await shot(`coop${N}_a${asc}_lethal`);
  await page.context().close();
}

// ---- 4. NIDORAN♀ (and the other odd names) in the party panel and the Pokédex ----
const ODD = ['NIDORAN_F', 'NIDORAN_M', 'FARFETCHD', 'MR_MIME', 'HO_OH'];
async function icons(browser, errors) {
  const page = await openPage(browser, errors);
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const shot = shooter(page);
  const dirs = await ev(async (ODD) => {
    const c = await import('/src/scenes/common.js');
    const keys = [...ODD, 'NIDORINA', 'NIDOQUEEN', 'NIDORINO', 'NIDOKING', 'UNOWN', 'DEOXYS', 'PORYGON_Z', 'MIME_JR'];
    return Object.fromEntries(keys.map(k => [k, c.monDir(k)]));
  }, ODD);
  console.log(JSON.stringify(dirs));
  check('icons: NIDORAN_F -> its own folder', dirs.NIDORAN_F === 'gfx/pokemon/nidoran_f' && dirs.NIDORAN_M === 'gfx/pokemon/nidoran_m', JSON.stringify([dirs.NIDORAN_F, dirs.NIDORAN_M]));
  await ev(async (ODD) => {
    G.meta.seenVersion = (await import('/src/game/version.js')).PATCH_NOTES[0].v; Object.assign(G.meta, { tutorialDone: true, tipCatch: true, hintBattles: 9, basicsSeen: true });
    const { Run } = await import('/src/game/run.js'); const { makeMon } = await import('/src/game/pokemon.js');
    G.run = Run.create({ starter: 'CHARMANDER', ascension: 0, seed: 'ICONS' });
    for (const sp of ODD) G.run.party.push(makeMon(sp, 10, { rng: G.run.rng }));
    const { MapScene } = await import('/src/scenes/map.js'); window.__engine.setScene(new MapScene());
  }, ODD);
  await sleep(1200); await mouseTo(page, 2, 2);
  await shot('icons_party');
  const caught = [...ODD, 'NIDORINA', 'NIDOQUEEN', 'NIDORINO', 'NIDOKING', 'PIDGEY', 'CLEFAIRY'];
  await ev(async (caught) => {
    Object.assign(G.meta, { dexSeen: caught, dexCaught: caught });
    const { DexScene } = await import('/src/scenes/dex.js'); window.__engine.setScene(new DexScene());
  }, caught);
  await sleep(1200); await mouseTo(page, 2, 2);
  await shot('icons_dex');
  // NIDORAN♀'s entry (#029)
  await ev(async () => {
    const { D } = await import('/src/game/data.js'); const { DexEntry } = await import('/src/scenes/dex.js');
    const { pushOverlay } = await import('/src/engine/core.js');
    pushOverlay(new DexEntry({ dex: D.species.NIDORAN_F.dex }));
  });
  await sleep(800); await mouseTo(page, 2, 2);
  await shot('icons_dex_nidoran_f');
  await page.context().close();
}

(async () => {
  const server = spawn(process.execPath, [path.join(root, 'serve.cjs'), String(port)], { cwd: root, stdio: 'ignore' });
  await sleep(700);
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
  const errors = [];
  try {
    const only = process.env.ONLY;
    for (const [name, fn] of [['lobby', b => lobby(b, errors)], ['solo', b => solo(b, errors)], ['coop2', b => coop(b, errors, 2, 2)], ['coop2a0', b => coop(b, errors, 2, 0)], ['coop4', b => coop(b, errors, 4, 3)], ['icons', b => icons(b, errors)]]) {
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
