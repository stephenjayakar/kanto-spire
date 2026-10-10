// Co-op battle hand checks in a real (muted) browser, from player 2's seat, no backend: ONE page plays a 2-player room
// on an in-memory net; P1 is driven by this script (first playable card, or PASS). v0.3.12:
//   facedown  a face-down boss rule (SABRINA) deals face-down cards to P2 too, and P2's screen shows them face down
//   seven     a 7-card hand (THUNDER + DYNAMO BADGE) with several copies of the same moves: the hand on screen is
//             exactly the engine hand (copies are separate cards, nothing is drawn twice); screenshot to tests/out/
//   end       the run's end screen asks the net to record ONE team run and close the room (finishRoom, once)
// Every choosing moment also checks that the scene's hand (handIds) matches the engine hand.
//   node tests/coop_hand_ui.cjs [port=8174]
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'tests/out');
const PORT = +(process.argv[2] || 8174), SLOT = 1;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let fails = 0;
const check = (label, ok, extra = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${extra ? ' ' + extra : ''}`); if (!ok) fails++; return ok; };
fs.mkdirSync(OUT, { recursive: true });

// In the page: a CoopSession for SLOT on an in-memory log (the harness posts P1's actions straight into it).
const START = async ({ SLOT }) => {
  Object.assign(G.meta, { tutorialDone: true, tipCatch: true, hintBattles: 9 });
  window.__engine.Engine.timeScale = 4;
  const src = (p) => new URL('src/' + p, location.href).href;
  const { CoopSession } = await import(src('scenes/coop/session.js'));
  const log = [{ seq: 1, p: -1, type: 'init', seed: 'PROBE', ascension: 0, world: 'kanto', starters: ['CHARMANDER', 'SQUIRTLE'], names: ['ALICE', 'BOB'], nonce: 'init' }];
  const members = [0, 1].map(slot => ({ slot, name: ['ALICE', 'BOB'][slot], starter: null, ready: true, left: false, lastSeen: Date.now(), lastSeq: 0, maxPlayers: 4 }));
  const room = { _id: 'r1', code: 'HANDS', status: 'playing', host: 0, createdAt: 0 };
  const push = (a, p) => { if (room.status !== 'playing') throw new Error('The run is not in progress.'); const seq = log.length + 1; log.push({ ...a, seq, p }); return { seq, nonce: a.nonce, duplicate: false }; };
  const finishes = [];
  const net = {
    randomNonce: () => Math.random().toString(36).slice(2), isNetworkError: () => false,
    heartbeat: async () => { members.forEach(m => { m.lastSeen = Date.now(); }); return { now: Date.now() }; },
    latestCheckpoint: async () => null,
    fetchSince: async (id, after) => ({ actions: log.filter(a => a.seq > after).map(a => ({ ...a })), more: false, status: room.status, room: { ...room, nextSeq: log.length + 1 }, members: members.map(m => ({ ...m })), me: SLOT, isHost: SLOT === 0, now: Date.now() }),
    postAction: async (id, a) => push(a, SLOT),
    finishRoom: async (id, run) => { finishes.push(run); room.status = 'closed'; return { score: 1, duplicate: finishes.length > 1 }; },
  };
  // (the harness's stand-in for net/coopnet.js CoopFeed: it re-reads its in-memory log every 120 ms)
  net.CoopFeed = class {
    constructor(roomId, o) { Object.assign(this, o, { running: false }); }
    start() { this.running = true; const tick = async () => { if (!this.running) return; const r = await net.fetchSince('r1', this.after); const f = r.actions.filter(a => a.seq > this.after); if (f.length) { this.after = f[f.length - 1].seq; await this.onActions(f); } await this.onHead?.({ room: r.room, members: r.members, me: r.me, isHost: r.isHost }); if (!f.length) await this.onCaughtUp?.(); this.t = setTimeout(tick, 120); }; tick(); return this; }
    stop() { this.running = false; clearTimeout(this.t); return this; }
    kick() { return this; } setAfter(s) { this.after = s; return this; }
  };
  window.__hand = { log, push, finishes };
  new CoopSession(net, { roomId: 'r1', code: 'HANDS', mySlot: SLOT, members, now: Date.now() }).start();
};

// Right before the act's boss (BOSS), parties strong; seven: 7-card hands and a BLAZIKEN lead for P2.
const SETUP = async ({ BOSS, seven, SLOT }) => {
  const src = (p) => new URL('src/' + p, location.href).href;
  const { maxHp, defaultCopies } = await import(src('game/pokemon.js'));
  const s = window.__coop, g = s.game, w = g.world;
  const t = Object.values(w.map.nodes).find(n => n.type === 'boss');
  w.nodeId = t.prev?.[0] ?? null; w.floor = t.floor - 1; w.boss = BOSS;
  for (const r of g.runs) { r.boss = BOSS; for (const m of r.party) { m.level = Math.max(m.level, w.levelFor(t.floor) + 3); m.hp = maxHp(m); } }
  if (seven) {
    for (const r of g.runs) for (const b of ['THUNDER', 'DYNAMO']) if (!r.badges.includes(b)) r.badges.push(b);
    const L = g.runs[SLOT].party[0];
    L.species = 'BLAZIKEN'; L.level = 40;
    L.moves = ['FIRE_BLAST', 'DOUBLE_TEAM', 'FOCUS_PUNCH', 'SKY_UPPERCUT'].map(k => ({ move: k, copies: defaultCopies(k) + 1 }));
    L.hp = maxHp(L);
  }
  g.mirror();
  s.ck.set(s.lastSeq, g.checksum() >>> 0);
  return t.id;
};

// One step of the battle: P1 locks if it hasn't; P2 (this page) records the hand and plays its best hand.
const STEP = ({ SLOT }) => {
  const E = window.__engine.Engine, sc = E.scene, s = window.__coop, g = s.game, d = g.battle;
  for (const o of E.overlays.slice().reverse()) o.close ? o.close(0) : E.overlays.pop();
  if (g.phase !== 'battle' || sc?.constructor?.name !== 'CoopBattleScene') return { done: true, phase: g.phase };
  const other = 1 - SLOT, so = d.subs[other], me = d.subs[SLOT];
  if (!d.result && !d.locks[other] && !d.down[other]) {
    const c = so.deck.hand.find(c => so.cardInfo(c).playable);
    try { window.__hand.push(c ? { type: 'lock', ids: [c.id], target: 0, nonce: 'o' + Math.random() } : { type: 'lock', pass: true, nonce: 'o' + Math.random() }, other); } catch {}
  }
  if (!sc.canAct()) { if (sc.msg?.cur) sc.msg.cur.auto = 0.01; return { done: false }; }
  const hid = me.deck.hand.map(c => c.id);
  const probe = {
    turn: d.turn, n: hid.length, handSize: me.handSize, moves: me.deck.hand.map(c => c.move),
    fd: me.deck.hand.filter(c => c.faceDown).length, fdShown: me.deck.hand.filter(c => c.faceDown && sc.info(c).faceDown).length,
    dup: sc.handIds.length !== new Set(sc.handIds).size, stale: sc.handIds.filter(id => !hid.includes(id)).length, missing: hid.filter(id => !sc.handIds.includes(id)).length,
  };
  const ids = sc.bestHand() || [];
  if (ids.length) { sc.sel = ids.slice(); sc.doLock(); } else if (sc.stuck) sc.doPass(); else { sc.sel = [sc.handIds[0]]; sc.doLock(); }
  return { done: false, probe };
};

async function scenario(browser, name, { boss, seven = false }) {
  console.log(`\n=== ${name}: P2's view of a ${boss} fight${seven ? ' with 7-card hands' : ''} ===`);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => check(`${name}: no page error`, false, e.message));
  await page.route('**/cloud.json', r => r.fulfill({ status: 404, body: '' }));
  try {
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__ready && window.G?.meta && window.__engine?.Engine.scene, null, { timeout: 120000 });
    await page.evaluate(START, { SLOT });
    await page.waitForFunction(() => window.__coop?.synced && window.__engine.Engine.scene?.constructor?.name === 'CoopMapScene', null, { timeout: 60000 });
    const node = await page.evaluate(SETUP, { BOSS: boss, seven, SLOT });
    await page.evaluate(({ node, SLOT }) => { window.__hand.push({ type: 'vote', node, nonce: 'v0' }, 1 - SLOT); window.__coop.vote(node); }, { node, SLOT });
    await page.waitForFunction(() => window.__engine.Engine.scene?.constructor?.name === 'CoopBattleScene', null, { timeout: 30000 });
    const probes = [];
    let shot = false;
    const t0 = Date.now();
    for (;;) {
      if (Date.now() - t0 > 6 * 60 * 1000) { check(`${name}: battle finished within 6 min`, false); break; }
      if (seven && !shot && await page.evaluate(() => window.__engine.Engine.scene?.canAct?.())) {
        shot = true;
        await page.evaluate(() => { const sc = window.__engine.Engine.scene; sc.sel = (sc.bestHand() || []).slice(); });
        await sleep(900);
        await page.screenshot({ path: path.join(OUT, 'coop_hand_seven.png') });
      }
      const st = await page.evaluate(STEP, { SLOT });
      if (st.done) { console.log(`  battle over: ${st.phase}`); break; }
      if (st.probe) probes.push(st.probe);
      await sleep(250);
    }
    const bad = probes.filter(p => p.dup || p.stale || p.missing);
    check(`${name}: the hand on screen is the engine hand at every choice (${probes.length} choices)`, probes.length > 0 && !bad.length, bad.slice(0, 3).map(p => JSON.stringify(p)).join(' | '));
    if (boss === 'LEADER_SABRINA') {
      const fd = probes.reduce((a, p) => a + p.fd, 0), shown = probes.reduce((a, p) => a + p.fdShown, 0);
      check(`${name}: P2 is dealt face-down cards too`, fd > 0, `(${fd} face-down over ${probes.length} hands)`);
      check(`${name}: and P2's screen shows them face down`, shown === fd);
    }
    if (seven) {
      const p = probes[0];
      check(`${name}: a 7-card hand`, p?.n === 7 && p.handSize === 7, JSON.stringify(p?.moves));
      const copies = p ? Object.values(p.moves.reduce((m, k) => ((m[k] = (m[k] || 0) + 1), m), {})).some(n => n > 1) : false;
      check(`${name}: it holds copies of the same move as separate cards`, copies);
    }
    return page;
  } catch (e) { check(`${name}: crashed`, false, (e.stack || e.message).split('\n').slice(0, 2).join(' ')); return null; }
}

(async () => {
  const server = spawn(process.execPath, [path.join(ROOT, 'serve.cjs'), String(PORT)], { cwd: ROOT, stdio: 'ignore' });
  await sleep(600);
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
  try {
    const page = await scenario(browser, 'facedown', { boss: 'LEADER_SABRINA' });
    // that fight usually ends the run (P1 only plays one card a turn): the end screen records the team run once
    if (page) {
      const phase = await page.evaluate(() => window.__coop.game.phase);
      if (phase === 'over' || phase === 'victory') {
        await page.waitForFunction(() => window.__engine.Engine.scene?.constructor?.name === 'CoopEndScene', null, { timeout: 30000 }).catch(() => {});
        await sleep(800);
        const f = await page.evaluate(() => window.__hand.finishes.map(r => ({ clientRunId: r.clientRunId, result: r.result, party: r.party.length, starter: r.starter })));
        if (!f.length) console.log('  end state:', await page.evaluate(async () => { const s = window.__coop; let err = null; try { (await import(new URL('src/net/cloud.js', location.href).href)).coopRunPayload(s.game, { code: s.code }); } catch (e) { err = e.message; } return { scene: window.__engine.Engine.scene?.constructor?.name, overlays: window.__engine.Engine.overlays.length, finishSent: !!s.finishSent, desync: s.desync, err }; }));
        check('end: the end screen records ONE team run (finishRoom once)', f.length === 1 && f[0].clientRunId === 'coop-HANDS' && f[0].result === (phase === 'victory' ? 'win' : 'lose') && f[0].party === 2, JSON.stringify(f)); // (one POKéMON each)
        // (the online build's line under TITLE: the team run's upload; faked here, this page has no backend)
        await page.evaluate(async () => { const { Cloud } = await import(new URL('src/net/cloud.js', location.href).href); Cloud.url = 'https://offline.invalid'; Cloud.lastResult = { status: 'saved', score: 12345 }; });
        await sleep(300);
        await page.screenshot({ path: path.join(OUT, 'coop_hand_end.png') });
        await page.evaluate(async () => { (await import(new URL('src/net/cloud.js', location.href).href)).Cloud.url = null; });
      } else console.log(`  (the run went on: ${phase}; end screen check skipped)`);
    }
    await page?.context().close().catch(() => {});
    const p2 = await scenario(browser, 'seven', { boss: 'LEADER_BROCK', seven: true });
    await p2?.context().close().catch(() => {});
  } finally {
    await browser.close().catch(() => {});
    server.kill();
  }
  console.log(fails ? `\n${fails} FAILED` : '\nall checks passed');
  process.exit(fails ? 1 : 0);
})();
