// Co-op network cost against the DEV Convex deployment (never prod): two muted Chrome contexts (E2E_P1_EMAIL + the
// coop test account, minted dev tokens) on a dev build play a short session, and every call to Convex is counted.
//   CONVEX_URL=https://<dev>.convex.cloud node tools/build_site.cjs && node serve.cjs 8097 dist &
//   E2E_DEV_DEPLOYMENT=<dev> E2E_P1_EMAIL=<allowlisted> node tests/coop_netcost.cjs [label] [base=http://localhost:8097/]
// Phases: lobby (create, join, starters, start) / idle (IDLE_S seconds on the map, both tabs visible) / hidden
// (HIDDEN_S seconds, P2's tab hidden) / play (a battle to its end, rewards, the next vote) / sketch (P1 draws on the
// map, P2 sees it) / reload (P2 reloads and REJOINs) / savequit (P1 SAVE & QUIT, then REJOIN), checking both clients
// agree after each. Client side: HTTP calls to /api and WebSocket frames, with bytes, per phase. Server side: the
// deployment's function logs (with usage stats) go to tests/out/netcost_<label>.logs.jsonl during the run; then
//   node tools/netcost_report.cjs tests/out/netcost_<label>.json tests/out/netcost_<label>.logs.jsonl
// for executions, database reads / writes and returned bytes per phase.
// Works with older builds too (same scenes), so the same run measures before / after.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const { spawn } = require('child_process');
const A = require('./coop_auth.cjs');

const LABEL = process.argv[2] || 'run';
const BASE = process.argv[3] || process.env.BASE || 'http://localhost:8097/';
const IDLE_S = +(process.env.IDLE_S || 120), HIDDEN_S = +(process.env.HIDDEN_S || 60);
const OUT = path.join(__dirname, 'out');
let fails = 0;
const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) { fails++; process.exitCode = 1; } return cond; };
const log = (...a) => console.log('  ·', ...a);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// counts every Convex call this page makes (HTTP /api/* and WebSocket frames)
const NET_COUNTER = () => {
  const n = window.__netc = { http: 0, httpUp: 0, httpDown: 0, ws: 0, wsDown: 0, wsSent: 0, wsUp: 0, byPath: {} };
  const of = window.fetch.bind(window);
  window.fetch = async (u, o) => {
    const url = String(u?.url || u);
    if (!/\/api\/(query|mutation|action)/.test(url)) return of(u, o);
    let p = '?';
    try { p = JSON.parse(o.body).path; } catch {}
    n.http++; n.httpUp += (o?.body?.length || 0);
    const b = (n.byPath[p] ||= { n: 0, down: 0 }); b.n++;
    const r = await of(u, o);
    r.clone().text().then(t => { n.httpDown += t.length; b.down += t.length; }).catch(() => {});
    return r;
  };
  const OW = window.WebSocket;
  window.WebSocket = class extends OW {
    constructor(...a) {
      super(...a);
      this.addEventListener('message', e => { n.ws++; n.wsDown += typeof e.data === 'string' ? e.data.length : (e.data.byteLength || e.data.size || 0); });
    }
    send(d) { n.wsSent++; n.wsUp += typeof d === 'string' ? d.length : (d.byteLength || 0); return super.send(d); }
  };
};

async function gclick(page, x, y, button = 'left') {
  const r = await page.evaluate(() => { const b = document.getElementById('game').getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; });
  await page.mouse.move(r.x + x * r.w / 640, r.y + y * r.h / 360);
  await sleep(50); await page.mouse.down({ button }); await sleep(50); await page.mouse.up({ button }); await sleep(120);
}
async function gdrag(page, pts, button = 'right') {
  const r = await page.evaluate(() => { const b = document.getElementById('game').getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; });
  const at = ([x, y]) => [r.x + x * r.w / 640, r.y + y * r.h / 360];
  await page.mouse.move(...at(pts[0])); await sleep(60); await page.mouse.down({ button });
  for (const p of pts.slice(1)) { await page.mouse.move(...at(p), { steps: 4 }); await sleep(40); }
  await sleep(60); await page.mouse.up({ button }); await sleep(150);
}
const scene = (page) => page.evaluate(() => window.__engine?.Engine.scene?.constructor?.name || null);
async function until(page, fn, arg, { timeout = 30000, label = 'condition' } = {}) {
  try { await page.waitForFunction(fn, arg, { timeout, polling: 200 }); return true; }
  catch (e) { console.log(`  ! timeout waiting for ${label} on ${page.__name}`); throw e; }
}
const syncInfo = (page) => page.evaluate(() => { const s = window.__coop, g = s?.game; return { seq: s?.lastSeq ?? null, ck: g ? g.checksum() >>> 0 : null, phase: g?.phase ?? null, desync: s?.desync || null, synced: !!s?.synced }; });
async function agree(pages, what) {
  for (let i = 0; i < 40; i++) {
    const si = await Promise.all(pages.map(syncInfo));
    if (si[0].seq === si[1].seq && si[0].ck === si[1].ck && !si[0].desync && !si[1].desync) return ok(true, `${what}: both at seq ${si[0].seq}, checksum ${si[0].ck}`);
    await sleep(500);
  }
  const si = await Promise.all(pages.map(syncInfo));
  return ok(false, `${what}: ${JSON.stringify(si)}`);
}
async function closeOverlays(page) { await page.evaluate(() => { const E = window.__engine.Engine; for (const o of E.overlays.slice().reverse()) o.close ? o.close(null) : E.overlays.pop(); }); }
async function boot(page) {
  await page.goto(page.__url);
  await page.waitForFunction(() => window.__ready, null, { timeout: 120000 });
  await until(page, () => window.__engine.Engine.scene?.constructor?.name === 'TitleScene', null, { label: 'title', timeout: 60000 });
  await page.evaluate(() => { window.__engine.Engine.timeScale = 3; });
  await sleep(1000); await closeOverlays(page); await sleep(200);
}
async function openLobby(page, roomId) {
  await page.evaluate(async (id) => { const m = await import(new URL('src/scenes/coop/lobby.js', location.href).href); window.__engine.setScene(new m.CoopLobbyScene(id ? { roomId: id } : {})); }, roomId || null);
  // (with a room of a run in progress the lobby hands over to the session at once)
  if (!roomId) await until(page, () => window.__engine.Engine.scene?.constructor?.name === 'CoopLobbyScene' && !!window.__engine.Engine.scene.net, null, { label: 'lobby' });
}

// ---- phases ------------------------------------------------------------------------------------------
const phases = [];
let pagesG = [];
async function snap(pages) { return Promise.all(pages.map(p => p.evaluate(() => JSON.parse(JSON.stringify(window.__netc))).catch(() => null))); }
async function phase(name, fn) {
  const before = await snap(pagesG);
  const t0 = Date.now();
  console.log(`\n=== ${name}`);
  await fn();
  const t1 = Date.now();
  const after = await snap(pagesG);
  const per = after.map((a, i) => {
    const b = before[i] || { http: 0, httpUp: 0, httpDown: 0, ws: 0, wsDown: 0, wsSent: 0, wsUp: 0, byPath: {} };
    if (!a) return null;
    // (a reload resets the page's counters: then count from zero)
    const base = a.http < b.http || a.ws < b.ws ? { http: 0, httpUp: 0, httpDown: 0, ws: 0, wsDown: 0, wsSent: 0, wsUp: 0, byPath: {} } : b;
    const byPath = {};
    for (const [k, v] of Object.entries(a.byPath)) { const n = v.n - (base.byPath[k]?.n || 0); if (n) byPath[k] = { n, down: v.down - (base.byPath[k]?.down || 0) }; }
    return { http: a.http - base.http, httpUp: a.httpUp - base.httpUp, httpDown: a.httpDown - base.httpDown, ws: a.ws - base.ws, wsDown: a.wsDown - base.wsDown, wsSent: a.wsSent - base.wsSent, wsUp: a.wsUp - base.wsUp, byPath };
  });
  const min = (t1 - t0) / 60000;
  phases.push({ name, t0, t1, per });
  for (const [i, p] of per.entries()) if (p) log(`P${i + 1} ${name} (${(min * 60).toFixed(0)} s): HTTP ${p.http} calls (${(p.http / min).toFixed(1)}/min) ↑${p.httpUp} ↓${p.httpDown} B; WS ${p.ws} in / ${p.wsSent} out ↓${p.wsDown} ↑${p.wsUp} B; ${Object.entries(p.byPath).map(([k, v]) => `${k}×${v.n}`).join(' ')}`);
}

async function playBattle(pages) {
  const deadline = Date.now() + 8 * 60000;
  let turns = 0;
  for (;;) {
    if (Date.now() > deadline) throw new Error('battle took too long');
    const st = await Promise.all(pages.map(p => p.evaluate(() => {
      const E = window.__engine.Engine, sc = E.scene;
      return { inBattle: sc?.constructor?.name === 'CoopBattleScene', canAct: sc?.canAct?.() || false, overlays: E.overlays.length, stuck: !!sc?.stuck };
    })));
    if (!st[0].inBattle && !st[1].inBattle) return turns;
    for (const [i, s] of st.entries()) {
      if (!s.inBattle) continue;
      if (s.overlays) { await closeOverlays(pages[i]); continue; }
      if (!s.canAct) continue;
      await pages[i].evaluate(() => {
        const sc = window.__engine.Engine.scene;
        if (sc.stuck) return sc.doPass();
        let ids = sc.bestHand();
        if (!ids || !ids.length) { const c = sc.handIds.find(id => sc.info(sc.sub.deck.hand.find(x => x.id === id)).playable); ids = c ? [c] : []; }
        if (!ids.length) return sc.doPass();
        sc.sel = ids.slice(); sc.doLock();
      });
      turns++;
    }
    await sleep(700);
  }
}
async function leaveRewards(page) {
  for (let k = 0; k < 60; k++) {
    const name = await scene(page);
    if (name === 'CoopWaitScene' || name === 'CoopMapScene') return;
    if (name === 'RewardScene' && !(await page.evaluate(() => window.__engine.Engine.scene.busy))) {
      const n = await page.evaluate(() => window.__engine.Engine.scene.rewards.length);
      await gclick(page, 450, 60 + n * 34 + 6 + 12);
      await sleep(300);
      if (await page.evaluate(() => window.__engine.Engine.overlays.length)) await page.evaluate(() => { const E = window.__engine.Engine; E.overlays[E.overlays.length - 1].close(1); });
    } else if (name && !/Coop/.test(name)) {
      // another private screen (event, shop, center...): leave it the way the session does
      await page.evaluate(() => window.__coop.privateDone());
    }
    await sleep(500);
  }
}
const pickNode = (page) => page.evaluate(() => {
  const g = window.__coop.game, nodes = g.world.map.nodes, ids = g.reachable();
  const rank = { wild: 0, trainer: 1 };
  return ids.slice().sort((a, b) => (rank[nodes[a].type] ?? 9) - (rank[nodes[b].type] ?? 9))[0];
});
async function vote(pages, id) {
  for (const p of pages) await p.evaluate((id) => window.__coop.vote(id), id);
  for (const p of pages) await until(p, () => window.__coop.game.phase !== 'map', null, { label: 'node entered', timeout: 30000 });
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const cfg = await fetch(BASE + 'cloud.json').then(r => r.json());
  if (!process.env.E2E_DEV_DEPLOYMENT || !cfg.convexUrl.includes(process.env.E2E_DEV_DEPLOYMENT)) throw new Error(`the build at ${BASE} is not a DEV build (${cfg.convexUrl}); set E2E_DEV_DEPLOYMENT`);
  A.ensureTestUser(A.P2_EMAIL, A.P2_NAME);
  const tokens = await Promise.all([A.mintToken(A.P1_EMAIL, '120m'), A.mintToken(A.P2_EMAIL, '120m')]);
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'] });
  const errors = [];
  let roomId = null, offsets = [];
  // the server's clock vs ours (log timestamps are the server's): coop:room answers with its now
  const offset = async () => { const t0 = Date.now(); const r = await A.callConvex(tokens[0], 'query', 'coop:room', { roomId }); const t1 = Date.now(); offsets.push(r.now - (t0 + t1) / 2); };
  const logFile = path.join(OUT, `netcost_${LABEL}.logs.jsonl`);
  const logs = spawn(process.execPath, [path.join(__dirname, '..', 'node_modules', 'convex', 'bin', 'main.js'), 'logs', '--success', '--jsonl'], { cwd: path.join(__dirname, '..'), stdio: ['ignore', fs.openSync(logFile, 'w'), 'ignore'] });
  await sleep(4000);
  try {
    for (const i of [0, 1]) {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
      await ctx.addInitScript(t => localStorage.setItem('kantospire.auth.v1', JSON.stringify({ token: t, refreshToken: 'e2e' })), tokens[i]);
      await ctx.addInitScript(NET_COUNTER);
      const p = await ctx.newPage(); p.__name = `P${i + 1}`; p.__url = BASE + (process.env.OLD2 && i === 1 ? 'old/' : '') + (process.env.URLQ || ''); pagesG.push(p); // (OLD2=1: P2 runs the older client from old/)
      p.on('pageerror', e => errors.push(`${p.__name}: ${e.message}`));
      p.on('console', m => { if (m.type() === 'error' && /\[coop/.test(m.text())) errors.push(`${p.__name} console: ${m.text()}`); });
    }
    const pages = pagesG, [p1, p2] = pages;
    await Promise.all(pages.map(boot));

    await phase('lobby', async () => {
      await openLobby(p1);
      await gclick(p1, 170, 107); // CREATE ROOM
      await until(p1, () => { const sc = window.__engine.Engine.scene; return sc.mode === 'room' && sc.view?.room?.code; }, null, { label: 'room created' });
      const room = await p1.evaluate(() => { const v = window.__engine.Engine.scene.view; return { code: v.room.code, roomId: v.room._id }; });
      roomId = room.roomId;
      await openLobby(p2);
      await gclick(p2, 170, 191); // JOIN ROOM
      await until(p2, () => window.__engine.Engine.scene.mode === 'join', null, { label: 'join mode' });
      await p2.keyboard.type(room.code, { delay: 60 });
      await gclick(p2, 390, 225); // JOIN
      await until(p2, () => { const sc = window.__engine.Engine.scene; return sc.mode === 'room' && sc.view?.members?.length === 2; }, null, { label: 'P2 in room' });
      await gclick(p1, 232 + 1 * 66 + 31, 78 + 37); // CHARMANDER
      await gclick(p2, 232 + 2 * 66 + 31, 78 + 37); // SQUIRTLE
      await until(p1, () => { const v = window.__engine.Engine.scene.view; return v?.members?.length === 2 && v.members.every(m => m.starter); }, null, { label: 'both starters', timeout: 20000 });
      await gclick(p1, 566, 305); // START
      for (const p of pages) await until(p, () => window.__coop?.synced && window.__engine.Engine.scene?.constructor?.name === 'CoopMapScene', null, { label: 'map after start', timeout: 60000 });
      ok(true, `room ${room.code} started`);
      await agree(pages, 'start');
    });

    await offset();
    await phase('idle', async () => { await sleep(IDLE_S * 1000); await agree(pages, 'idle'); });

    if (HIDDEN_S > 0) await phase('hidden', async () => {
      // (headless tabs stay visible: fake document.hidden + visibilitychange, which is all the game looks at)
      await p2.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
      await sleep(HIDDEN_S * 1000);
      await p2.evaluate(() => { delete document.hidden; delete document.visibilityState; document.dispatchEvent(new Event('visibilitychange')); });
      await sleep(1500);
      await agree(pages, 'hidden');
    });

    await phase('play', async () => {
      const id = await pickNode(p1);
      await vote(pages, id);
      const ph = await p1.evaluate(() => window.__coop.game.phase);
      if (ph === 'battle') {
        for (const p of pages) await until(p, () => window.__engine.Engine.scene?.constructor?.name === 'CoopBattleScene', null, { label: 'battle', timeout: 30000 });
        const turns = await playBattle(pages);
        log(`battle over after ${turns} locks`);
      }
      await agree(pages, 'after the node');
      for (const p of pages) await leaveRewards(p);
      for (const p of pages) await until(p, () => window.__coop.game.phase === 'map' || window.__coop.game.phase === 'over', null, { label: 'back on the map', timeout: 60000 });
      await agree(pages, 'back on the map');
      const ck = await p1.evaluate(() => ({ cpSeq: window.__coop.cpSeq, seq: window.__coop.game.seq }));
      log('checkpoint', JSON.stringify(ck));
    });

    await phase('sketch', async () => {
      await gdrag(p1, [[300, 200], [340, 180], [380, 210], [420, 190]]);
      await until(p2, () => window.__coop.partnerSketches(window.__coop.game.world.actIndex).some(s => s.strokes.length > 0), null, { label: 'P2 sees the sketch', timeout: 30000 });
      ok(true, "P1's sketch shows up for P2");
    });

    await phase('reload', async () => {
      await boot(p2);
      await openLobby(p2, roomId);
      await until(p2, () => window.__coop?.synced && window.__engine.Engine.scene?.constructor?.name === 'CoopMapScene', null, { label: 'rejoined', timeout: 90000 });
      await agree(pages, 'P2 reloaded and rejoined');
      const sk = await until(p2, () => window.__coop.partnerSketches(window.__coop.game.world.actIndex).length > 0, null, { label: 'sketch after the reload', timeout: 20000 }).catch(() => false);
      ok(sk, 'the sketch is still there after the reload');
    });

    await phase('savequit', async () => {
      await p1.evaluate(() => window.__coop.saveAndQuit());
      await until(p1, () => window.__engine.Engine.scene?.constructor?.name === 'TitleScene', null, { label: 'P1 at the title', timeout: 30000 });
      await until(p2, () => window.__coop.member(1 - window.__coop.mySlot)?.saved, null, { label: 'P2 sees SAVED & QUIT', timeout: 40000 });
      ok(true, 'P1 saved and quit; P2 sees it');
      await openLobby(p1, roomId);
      await until(p1, () => window.__coop?.synced && window.__engine.Engine.scene?.constructor?.name === 'CoopMapScene', null, { label: 'P1 rejoined', timeout: 90000 });
      await until(p2, () => !window.__coop.member(1 - window.__coop.mySlot)?.saved, null, { label: 'P2 sees P1 back', timeout: 40000 });
      await agree(pages, 'P1 rejoined after SAVE & QUIT');
      // and play goes on: one more vote
      const id = await pickNode(p1);
      await vote(pages, id);
      await sleep(1500);
      await agree(pages, 'next node after the REJOIN');
    });

    await offset();
    ok(!errors.length, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  } catch (e) {
    fails++; process.exitCode = 1;
    console.log('ERROR', e.stack || e);
  } finally {
    await sleep(5000); // (the last log lines)
    logs.kill();
    const serverOffset = offsets.length ? offsets.reduce((a, b) => a + b, 0) / offsets.length : 0;
    fs.writeFileSync(path.join(OUT, `netcost_${LABEL}.json`), JSON.stringify({ label: LABEL, base: BASE, roomId, serverOffset, offsets, phases }, null, 1));
    console.log(`\nwrote tests/out/netcost_${LABEL}.json`);
    await browser.close();
    if (roomId && !process.env.KEEP) { try { A.cleanupRooms([roomId]); } catch (e) { console.log('cleanup failed', e.message); } }
  }
  console.log(fails ? `NETCOST: ${fails} FAILED` : 'NETCOST: ALL PASSED');
})();
