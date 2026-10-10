// staging-net: a real two-browser co-op game against the DEV Convex deployment (never prod), with every network request
// recorded, so the same script measures the subscription build and an older (polling) build side by side.
//   CONVEX_URL=https://<dev>.convex.cloud node tools/build_site.cjs && node serve.cjs 8097 dist &
//   E2E_DEV_DEPLOYMENT=<dev> E2E_P1_EMAIL=<allowlisted> node tests/stagenet_e2e.cjs [label] [base=http://localhost:8097/]
//   OLD=1: the build is an older client (HTTP polling): the subscription-only checks are skipped, the costs still counted.
// Two muted Chrome contexts (P1 = E2E_P1_EMAIL, P2 = the co-op test account, minted dev tokens; P1's token runs out after
// a few minutes and auth:signIn is answered with a fresh one, so a token refresh happens mid-game). Phases:
//   title    TITLE_S on the title screen (NOW PLAYING)          records  RECORDS_S with RECORDS open (P1)
//   lobby    create, join, starters, start                      idle     IDLE_S on the map, both visible
//   hidden   HIDDEN_S with P2's tab hidden                       play     a battle to its end, rewards, the next vote
//   sketch   P1 draws, P2 sees it                               reload   P2 reloads MID-BATTLE and rejoins, the battle goes on
//   offline  P2 drops off the network (socket closed) for OFFLINE_S while P1 votes; back online it catches up
//   savequit P1 SAVE & QUIT, REJOIN, one more vote
// Per phase and page: HTTP requests to the Convex API (each one listed), WebSocket frames and bytes both ways (from
// Chrome's own network events, CDP), and the deployment's function executions (convex logs). The report goes to
// tests/out/stagenet_<label>.json (+ .logs.jsonl); node tools/netcost_report.cjs reads it like a netcost run.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const { spawn } = require('child_process');
const A = require('./coop_auth.cjs');
const { routePacks } = require('./pack_cache.cjs');

const LABEL = process.argv[2] || 'run';
const BASE = process.argv[3] || process.env.BASE || 'http://localhost:8097/';
const OLD = !!process.env.OLD;
// P2_BASE (a mixed room): P2 runs another build, e.g. the older polling client: checks of P2's internals are skipped
const P2OLD = OLD || !!process.env.P2_BASE;
const S = (k, d) => +(process.env[k] || d);
const TITLE_S = S('TITLE_S', 60), RECORDS_S = S('RECORDS_S', 45), IDLE_S = S('IDLE_S', 120), HIDDEN_S = S('HIDDEN_S', 60), OFFLINE_S = S('OFFLINE_S', 20);
const OUT = path.join(__dirname, 'out');
let fails = 0;
const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) { fails++; process.exitCode = 1; } return cond; };
const log = (...a) => console.log('  ·', ...a);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ---- page helpers ---------------------------------------------------------------------------------
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
  catch (e) { console.log(`  ! timeout waiting for ${label} on ${page.__name}`); await dump(page); throw e; }
}
async function dump(page) {
  const st = await page.evaluate(() => {
    const s = window.__coop, g = s?.game, E = window.__engine?.Engine;
    return { scene: E?.scene?.constructor?.name, seq: s?.lastSeq, phase: g?.phase, routeKey: s?.routeKey, synced: s?.synced, desync: s?.desync, netError: s?.netError, private: g?.private ? { kind: g.private.kind, done: g.private.done } : null };
  }).catch(e => ({ err: e.message }));
  console.log(`  ${page.__name} state:`, JSON.stringify(st));
}
const syncInfo = (page) => page.evaluate(() => { const s = window.__coop, g = s?.game; return { seq: s?.lastSeq ?? null, ck: g ? g.checksum() >>> 0 : null, phase: g?.phase ?? null, desync: s?.desync || null, synced: !!s?.synced }; });
async function agree(pages, what) {
  for (let i = 0; i < 60; i++) {
    const si = await Promise.all(pages.map(syncInfo));
    if (si[0].seq === si[1].seq && si[0].ck === si[1].ck && !si[0].desync && !si[1].desync) return ok(true, `${what}: both at seq ${si[0].seq}, checksum ${si[0].ck}`) && si[0];
    await sleep(500);
  }
  const si = await Promise.all(pages.map(syncInfo));
  ok(false, `${what}: ${JSON.stringify(si)}`);
  return si[0];
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
  if (!roomId) await until(page, () => window.__engine.Engine.scene?.constructor?.name === 'CoopLobbyScene' && !!window.__engine.Engine.scene.net, null, { label: 'lobby' });
}
async function toTitle(page) { await page.evaluate(async () => { const m = await import(new URL('src/scenes/title.js', location.href).href); window.__engine.setScene(new m.TitleScene()); }); }
async function openRecords(page) { await page.evaluate(async () => { const m = await import(new URL('src/scenes/records.js', location.href).href); window.__engine.setScene(new m.RecordsScene()); }); }

// ---- stronger teams (as tests/coop4_play.cjs): the run must not end in a lost battle halfway through the test ----
const BUFF_HOOK = () => {
  window.__src = (p) => new URL('src/' + p, location.href).href;
  window.addEventListener('load', () => {
    Promise.all([import(window.__src('game/pokemon.js')), import(window.__src('game/data.js')), import(window.__src('game/rng.js'))]).then(([pk, dt, rn]) => { window.__pk = pk; window.__dt = dt; window.__rng = rn; });
  });
  window.__coopApplyPatch = (g, pt) => {
    g.runs.forEach((run, pi) => {
      for (let i = run.party.length; i < (pt.size || 1); i++) {
        const m = window.__pk.makeMon(['PIDGEOTTO', 'NIDORINO', 'GEODUDE', 'ODDISH'][(pi + i) % 4], pt.level, { rng: new window.__rng.RNG('buff' + pi + ':' + i) });
        m.uid = 6e8 + pi * 100 + i;
        run.party.push(m);
      }
      for (const m of run.party) {
        if (m.level < pt.level) { m.level = pt.level; m.exp = window.__dt.expForLevel(window.__dt.D.species[m.species]?.growthRate, pt.level); }
        m.hp = window.__pk.maxHp(m); m.status = null;
      }
    });
  };
  window.__coopTestHook = (s, a) => {
    let list = [];
    try { list = JSON.parse(sessionStorage.getItem('stagenet.patches') || '[]'); } catch {}
    for (const pt of list) if (pt.roomId === s.roomId && pt.seq === a.seq && s.game) window.__coopApplyPatch(s.game, pt);
  };
};
async function buffTeams(pages, level = 25, size = 3) {
  const top = Math.max(...await Promise.all(pages.map(p => p.evaluate(() => window.__coop.lastSeq))));
  for (const p of pages) await until(p, (n) => window.__coop.lastSeq >= n, top, { label: 'same seq' });
  const r = [];
  for (const p of pages) r.push(await p.evaluate(({ level, size }) => {
    const s = window.__coop, g = s.game;
    const pt = { level, size, roomId: s.roomId, seq: s.lastSeq };
    const list = JSON.parse(sessionStorage.getItem('stagenet.patches') || '[]');
    list.push(pt);
    sessionStorage.setItem('stagenet.patches', JSON.stringify(list));
    window.__coopApplyPatch(g, pt);
    s.ck.set(s.lastSeq, g.checksum() >>> 0);
    return g.checksum() >>> 0;
  }, { level, size }));
  ok(r.every(x => x === r[0]), `teams of ${size} at Lv${level} on both clients (same checksum ${r[0]})`);
}

// ---- network capture (CDP: everything Chrome sends / receives) --------------------------------------
async function capture(page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  const n = page.__net = { api: [], other: 0, packs: 0, wsIn: 0, wsInB: 0, wsOut: 0, wsOutB: 0, sockets: 0, httpDownB: 0, httpUpB: 0, wsBy: {}, deflate: null };
  // WebSocket frames by what they carry: a query's new result (by function), a mutation's answer, pings...
  const qpath = new Map();
  const by = (k, b) => { const x = (n.wsBy[k] ||= { n: 0, bytes: 0 }); x.n++; x.bytes += b; };
  const reqs = new Map();
  cdp.on('Network.requestWillBeSent', (e) => {
    const u = e.request.url;
    if (e.request.method === 'OPTIONS') return; // (CORS preflights: not calls)
    if (/\/api\/(query|mutation|action)/.test(u)) {
      let p = '?';
      try { p = JSON.parse(e.request.postData || '{}').path || '?'; } catch {}
      const r = { t: Date.now(), path: p, up: (e.request.postData || '').length, down: 0 };
      n.api.push(r); reqs.set(e.requestId, r);
    } else if (/\.convex\.site\/pack/.test(u)) n.packs++;
    else n.other++;
  });
  cdp.on('Network.loadingFinished', (e) => { const r = reqs.get(e.requestId); if (r) { r.down = e.encodedDataLength; reqs.delete(e.requestId); } });
  cdp.on('Network.webSocketCreated', () => { n.sockets++; });
  cdp.on('Network.webSocketHandshakeResponseReceived', (e) => { const h = e.response.headers || {}; n.deflate = /deflate/i.test(h['Sec-WebSocket-Extensions'] || h['sec-websocket-extensions'] || ''); });
  cdp.on('Network.webSocketFrameReceived', (e) => {
    const d = e.response.payloadData || '';
    n.wsIn++; n.wsInB += d.length;
    let m; try { m = JSON.parse(d); } catch { return by('?', d.length); }
    if (m.type === 'Transition') {
      const mods = m.modifications || [];
      if (!mods.length) by('transition (no new results)', d.length);
      for (const x of mods) by('↓ ' + (qpath.get(x.queryId) || '?'), JSON.stringify(x).length);
    } else by('↓ ' + m.type, d.length);
  });
  cdp.on('Network.webSocketFrameSent', (e) => {
    const d = e.response.payloadData || '';
    n.wsOut++; n.wsOutB += d.length;
    let m; try { m = JSON.parse(d); } catch { return; }
    if (m.type === 'ModifyQuerySet') for (const x of m.modifications || []) { if (x.type === 'Add') qpath.set(x.queryId, x.udfPath); }
    by('↑ ' + m.type + (m.udfPath ? ' ' + m.udfPath : ''), d.length);
  });
  page.__cdp = cdp;
}
const snapNet = (page) => { const n = page.__net; return { api: n.api.length, wsIn: n.wsIn, wsInB: n.wsInB, wsOut: n.wsOut, wsOutB: n.wsOutB, sockets: n.sockets, wsBy: JSON.parse(JSON.stringify(n.wsBy)) }; };

// ---- phases -------------------------------------------------------------------------------------------
const phases = [];
let pagesG = [];
async function phase(name, fn, { quiet = false } = {}) {
  const before = pagesG.map(snapNet), t0 = Date.now();
  console.log(`\n=== ${name}`);
  await fn();
  const t1 = Date.now(), min = (t1 - t0) / 60000;
  const per = pagesG.map((p, i) => {
    const a = snapNet(p), b = before[i];
    const api = p.__net.api.slice(b.api);
    const byPath = {};
    for (const r of api) { const x = (byPath[r.path] ||= { n: 0, down: 0, up: 0 }); x.n++; x.down += r.down; x.up += r.up; }
    const wsBy = {};
    for (const [k, v] of Object.entries(a.wsBy)) { const n0 = b.wsBy[k]?.n || 0, b0 = b.wsBy[k]?.bytes || 0; if (v.n - n0) wsBy[k] = { n: v.n - n0, bytes: v.bytes - b0 }; }
    return {
      http: api.length, httpUp: api.reduce((s, r) => s + r.up, 0), httpDown: api.reduce((s, r) => s + r.down, 0),
      ws: a.wsIn - b.wsIn, wsDown: a.wsInB - b.wsInB, wsSent: a.wsOut - b.wsOut, wsUp: a.wsOutB - b.wsOutB, sockets: a.sockets - b.sockets, byPath, wsBy, deflate: p.__net.deflate,
      apiTimes: api.map(r => [r.t - t0, r.path]),
    };
  });
  phases.push({ name, t0, t1, per, quiet });
  for (const [i, p] of per.entries()) log(`P${i + 1} ${name} (${(min * 60).toFixed(0)} s): HTTP ${p.http} (${(p.http / min).toFixed(1)}/min) ↑${p.httpUp} ↓${p.httpDown} B; WS ${p.ws} in / ${p.wsSent} out ↓${p.wsDown} ↑${p.wsUp} B ${Object.entries(p.byPath).map(([k, v]) => `${k}×${v.n}`).join(' ')}`);
  return per;
}

async function playBattle(pages, { maxLocks = Infinity } = {}) {
  const deadline = Date.now() + 8 * 60000;
  let turns = 0;
  for (;;) {
    if (Date.now() > deadline) throw new Error('battle took too long');
    const st = await Promise.all(pages.map(p => p.evaluate(() => {
      const E = window.__engine.Engine, sc = E.scene;
      return { inBattle: sc?.constructor?.name === 'CoopBattleScene', canAct: sc?.canAct?.() || false, overlays: E.overlays.length };
    })));
    if (!st[0].inBattle && !st[1].inBattle) return turns;
    if (turns >= maxLocks) return turns;
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
    } else if (name && !/Coop/.test(name)) await page.evaluate(() => window.__coop.privateDone());
    await sleep(500);
  }
}
const pickNode = (page, prefer = ['wild', 'trainer']) => page.evaluate((prefer) => {
  const g = window.__coop.game, nodes = g.world.map.nodes, ids = g.reachable();
  const rank = (t) => { const i = prefer.indexOf(t); return i < 0 ? 9 : i; };
  return ids.slice().sort((a, b) => rank(nodes[a].type) - rank(nodes[b].type))[0];
}, prefer);
async function vote(pages, id) {
  for (const p of pages) await p.evaluate((id) => window.__coop.vote(id), id);
  for (const p of pages) await until(p, () => window.__coop.game.phase !== 'map', null, { label: 'node entered', timeout: 30000 });
}
async function afterNode(pages, what) {
  await agree(pages, what);
  for (const p of pages) await leaveRewards(p);
  for (const p of pages) await until(p, () => ['map', 'over'].includes(window.__coop.game.phase), null, { label: 'back on the map', timeout: 60000 });
  return agree(pages, what + ': back on the map');
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const cfg = await fetch(BASE + 'cloud.json').then(r => r.json());
  if (!process.env.E2E_DEV_DEPLOYMENT || !cfg.convexUrl.includes(process.env.E2E_DEV_DEPLOYMENT)) throw new Error(`the build at ${BASE} is not a DEV build (${cfg.convexUrl}); set E2E_DEV_DEPLOYMENT`);
  A.ensureTestUser(A.P2_EMAIL, A.P2_NAME);
  // P1's token runs out after REFRESH_AFTER: the game refreshes it (auth:signIn), answered here with a fresh one
  const tokens = await Promise.all([A.mintToken(A.P1_EMAIL, process.env.P1_TTL || '4m'), A.mintToken(A.P2_EMAIL, '180m')]);
  const browser = await chromium.launch({ channel: 'chrome', headless: !process.env.HEADED, args: ['--mute-audio', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'] });
  const errors = [];
  let roomId = null, offsets = [], refreshes = 0;
  const offset = async () => { const t0 = Date.now(); const r = await A.callConvex(tokens[1], 'query', 'coop:room', { roomId }); const t1 = Date.now(); offsets.push(r.now - (t0 + t1) / 2); };
  const logFile = path.join(OUT, `stagenet_${LABEL}.logs.jsonl`);
  const logs = spawn(process.execPath, [path.join(__dirname, '..', 'node_modules', 'convex', 'bin', 'main.js'), 'logs', '--success', '--jsonl'], { cwd: path.join(__dirname, '..'), stdio: ['ignore', fs.openSync(logFile, 'w'), 'ignore'] });
  await sleep(4000);
  try {
    for (const i of [0, 1]) {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
      await ctx.addInitScript(t => { if (!localStorage.getItem('kantospire.auth.v1')) localStorage.setItem('kantospire.auth.v1', JSON.stringify({ token: t, refreshToken: 'e2e' })); }, tokens[i]);
      await routePacks(ctx); // (asset packs from the shared test cache, not Convex egress)
      await ctx.addInitScript(BUFF_HOOK);
      // the token refresh (Convex Auth's auth:signIn with a refresh token): a freshly minted dev token
      await ctx.route(/\.convex\.cloud\/api\/action$/, async (route) => {
        const body = route.request().postData() || '';
        if (!/"auth:signIn"/.test(body) || !/refreshToken/.test(body)) return route.continue();
        refreshes++;
        const token = await A.mintToken(i === 0 ? A.P1_EMAIL : A.P2_EMAIL, '120m');
        return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ status: 'success', value: { tokens: { token, refreshToken: 'e2e-r' + refreshes } } }) });
      });
      // (P2_BASE: P2 runs another build, e.g. the older polling client, in the same room)
      const p = await ctx.newPage(); p.__name = `P${i + 1}`; p.__url = (i === 1 && process.env.P2_BASE ? process.env.P2_BASE : BASE) + (process.env.URLQ || ''); pagesG.push(p);
      await capture(p);
      p.on('pageerror', e => errors.push(`${p.__name}: ${e.message}`));
      p.on('console', m => { if (m.type() === 'error' && /\[coop|\[net/.test(m.text())) errors.push(`${p.__name} console: ${m.text()}`); });
    }
    const pages = pagesG, [p1, p2] = pages;
    await Promise.all(pages.map(boot));
    const live = !OLD && await p1.evaluate(async () => !!(await (await import(new URL('src/net/cloud.js', location.href).href)).liveClient?.()));
    if (!OLD) ok(live, 'the game runs over the Convex WebSocket client');

    // (auth:signIn, the token refresh, stays an HTTP call by design: once an hour, not a poll)
    const idleOk = (per, what) => {
      if (OLD) return;
      const calls = per.map((p, i) => (i === 1 && P2OLD ? 0 : Object.entries(p.byPath).filter(([k]) => k !== 'auth:signIn').reduce((a, [, v]) => a + v.n, 0)));
      ok(calls.every(n => n === 0), `${what}: no HTTP calls to the Convex API (${calls.join(' / ')}${per.some(p => p.byPath['auth:signIn']) ? ', plus the token refresh' : ''}): nothing polls`);
    };

    // (CLICK TO START first: the title menu, and NOW PLAYING with it, shows after that)
    for (const p of pages) { await gclick(p, 320, 300); await closeOverlays(p); }
    let per = await phase('title', async () => {
      await sleep(TITLE_S * 1000);
      if (!OLD) ok(await p1.evaluate(async () => Array.isArray((await import(new URL('src/net/presence.js', location.href).href)).nowPlaying())), 'title: NOW PLAYING is live (a subscription)');
    });
    idleOk(per, 'title');

    per = await phase('records', async () => {
      await openRecords(p1);
      await until(p1, () => Array.isArray(window.__engine.Engine.scene.rows), null, { label: 'records loaded', timeout: 30000 });
      await sleep(RECORDS_S * 1000);
      await toTitle(p1);
    });
    idleOk(per, 'records open');

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
      if (!OLD) {
        await until(p1, () => { const sc = window.__engine.Engine.scene; return sc.view.members.every(m => sc.online(m)); }, null, { label: 'both online in the lobby', timeout: 20000 });
        ok(true, 'lobby: both players show online (presence subscription)');
      }
      await gclick(p1, 566, 305); // START
      for (const p of pages) await until(p, () => window.__coop?.synced && window.__engine.Engine.scene?.constructor?.name === 'CoopMapScene', null, { label: 'map after start', timeout: 60000 });
      ok(true, `room ${room.code} started`);
      await agree(pages, 'start');
      await buffTeams(pages);
    });

    await offset();
    per = await phase('idle', async () => { await sleep(IDLE_S * 1000); await agree(pages, 'idle'); });
    idleOk(per, 'idle on the map');
    if (!OLD) ok(await p1.evaluate(() => window.__coop.isOnline(1 - window.__coop.mySlot)), 'idle: the partner stays online (keepalives)');

    if (HIDDEN_S > 0) {
      per = await phase('hidden', async () => {
        // (headless tabs stay visible: fake document.hidden + visibilitychange, which is all the game looks at)
        await p2.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
        await sleep(HIDDEN_S * 1000);
        if (!P2OLD) ok(await p1.evaluate(() => window.__coop.isOnline(1 - window.__coop.mySlot) && window.__coop.presence?.[1 - window.__coop.mySlot]?.hb >= 60000), 'a hidden partner stays online (it said it beats every 60 s)');
        else if (!OLD) ok(await p1.evaluate(() => window.__coop.isOnline(1 - window.__coop.mySlot)), 'an older hidden partner stays online');
        await p2.evaluate(() => { delete document.hidden; delete document.visibilityState; document.dispatchEvent(new Event('visibilitychange')); });
        await sleep(1500);
        await agree(pages, 'hidden');
      });
      idleOk(per, 'hidden tab');
    }

    await phase('play', async () => {
      const id = await pickNode(p1);
      await vote(pages, id);
      const ph = await p1.evaluate(() => window.__coop.game.phase);
      if (ph === 'battle') {
        for (const p of pages) await until(p, () => window.__engine.Engine.scene?.constructor?.name === 'CoopBattleScene', null, { label: 'battle', timeout: 30000 });
        const turns = await playBattle(pages);
        ok(turns >= 2, `a whole battle in lockstep (${turns} locks)`);
      }
      await afterNode(pages, 'after the first node');
    });

    await phase('sketch', async () => {
      await gdrag(p1, [[300, 200], [340, 180], [380, 210], [420, 190]]);
      await until(p2, () => window.__coop.partnerSketches(window.__coop.game.world.actIndex).some(s => s.strokes.length > 0), null, { label: 'P2 sees the sketch', timeout: 30000 });
      ok(true, "P1's sketch shows up for P2");
    });

    await phase('reload', async () => {
      // into a battle (nodes on the way are played through), a couple of hands, then P2 reloads MID-BATTLE and
      // rejoins; the battle goes on to its end
      let reloaded = false;
      for (let tries = 0; tries < 4 && !reloaded; tries++) {
        const id = await pickNode(p1, ['wild', 'trainer', 'elite']);
        await vote(pages, id);
        if ((await p1.evaluate(() => window.__coop.game.phase)) !== 'battle') { await afterNode(pages, 'a node on the way to a battle'); continue; }
        for (const p of pages) await until(p, () => window.__engine.Engine.scene?.constructor?.name === 'CoopBattleScene', null, { label: 'battle', timeout: 30000 });
        await playBattle(pages, { maxLocks: 3 });
        await sleep(1500);
        const mid = await p1.evaluate(() => ({ phase: window.__coop.game.phase, turn: window.__coop.game.battle?.turn }));
        await boot(p2);
        await openLobby(p2, roomId);
        await until(p2, () => window.__coop?.synced && ['CoopBattleScene', 'CoopMapScene', 'CoopWaitScene', 'RewardScene'].includes(window.__engine.Engine.scene?.constructor?.name), null, { label: 'rejoined', timeout: 90000 });
        await agree(pages, `P2 reloaded mid-battle (${mid.phase}, turn ${mid.turn}) and rejoined`);
        reloaded = mid.phase === 'battle';
        if ((await p1.evaluate(() => window.__coop.game.phase)) === 'battle') {
          for (const p of pages) await until(p, () => window.__engine.Engine.scene?.constructor?.name === 'CoopBattleScene', null, { label: 'battle after the reload', timeout: 30000 });
          const t = await playBattle(pages);
          log(`battle finished after the reload (${t} more locks)`);
        }
        await afterNode(pages, 'after the reloaded battle');
      }
      ok(reloaded, 'a reload in the middle of a battle');
      const sk = await until(p2, () => window.__coop.partnerSketches(window.__coop.game.world.actIndex).length > 0, null, { label: 'sketch after the reload', timeout: 20000 }).catch(() => false);
      ok(sk, 'the sketch is still there after the reload');
    });

    await phase('offline', async () => {
      // P2 drops off the network: offline (Chrome's network emulation) and its socket closed; P1 votes meanwhile
      const seq0 = (await syncInfo(p1)).seq;
      await p2.context().setOffline(true);
      if (!P2OLD) await p2.evaluate(async () => { const c = await (await import(new URL('src/net/cloud.js', location.href).href)).liveClient(); c.client.webSocketManager.socket.ws?.close(); });
      await sleep(P2OLD ? 3000 : 1500);
      ok(await p2.evaluate(() => !!window.__coop.netError), `P2 knows it is offline (${P2OLD ? 'polls fail' : 'socket down'})`);
      const id = await pickNode(p1);
      await p1.evaluate((id) => window.__coop.vote(id), id);
      await until(p1, (s) => window.__coop.lastSeq > s, seq0, { label: 'P1 vote posted', timeout: 20000 });
      await sleep(OFFLINE_S * 1000);
      ok((await syncInfo(p2)).seq === seq0, `nothing reaches P2 while offline (seq ${seq0})`);
      await p2.context().setOffline(false);
      const t0 = Date.now();
      await until(p2, (s) => window.__coop.lastSeq > s && !window.__coop.netError, seq0, { label: 'P2 catches up', timeout: 60000 });
      ok(true, `back online, P2 caught up in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
      await p2.evaluate((id) => window.__coop.vote(id), id);
      for (const p of pages) await until(p, () => window.__coop.game.phase !== 'map', null, { label: 'node entered after the drop', timeout: 30000 });
      await agree(pages, 'both voted after the drop');
      if ((await p1.evaluate(() => window.__coop.game.phase)) === 'battle') {
        for (const p of pages) await until(p, () => window.__engine.Engine.scene?.constructor?.name === 'CoopBattleScene', null, { label: 'battle', timeout: 30000 });
        await playBattle(pages);
      }
      await afterNode(pages, 'after the node entered after the drop');
    });

    await phase('savequit', async () => {
      await p1.evaluate(() => window.__coop.saveAndQuit());
      await until(p1, () => window.__engine.Engine.scene?.constructor?.name === 'TitleScene', null, { label: 'P1 at the title', timeout: 30000 });
      await until(p2, () => window.__coop.member(1 - window.__coop.mySlot)?.saved, null, { label: 'P2 sees SAVED & QUIT', timeout: 40000 });
      ok(true, 'P1 saved and quit; P2 sees it');
      await openLobby(p1);
      if (!OLD) {
        await until(p1, (id) => (window.__engine.Engine.scene.rooms || []).some(r => r.roomId === id && r.members.some(m => m.saved)), roomId, { label: 'REJOIN list shows the saved room', timeout: 20000 });
        ok(true, 'the REJOIN list (live) shows the room with the save');
      }
      await openLobby(p1, roomId);
      await until(p1, () => window.__coop?.synced && window.__engine.Engine.scene?.constructor?.name === 'CoopMapScene', null, { label: 'P1 rejoined', timeout: 90000 });
      await until(p2, () => !window.__coop.member(1 - window.__coop.mySlot)?.saved, null, { label: 'P2 sees P1 back', timeout: 40000 });
      await agree(pages, 'P1 rejoined after SAVE & QUIT');
      const id = await pickNode(p1);
      await vote(pages, id);
      await sleep(1500);
      await agree(pages, 'next node after the REJOIN');
    });

    ok(refreshes >= 1, `P1's token was refreshed mid-game (${refreshes}x) and play went on`);
    await offset();
    ok(!errors.length, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  } catch (e) {
    fails++; process.exitCode = 1;
    console.log('ERROR', e.stack || e);
  } finally {
    await sleep(5000);
    logs.kill();
    const serverOffset = offsets.length ? offsets.reduce((a, b) => a + b, 0) / offsets.length : 0;
    fs.writeFileSync(path.join(OUT, `stagenet_${LABEL}.json`), JSON.stringify({ label: LABEL, base: BASE, old: OLD, roomId, serverOffset, offsets, refreshes, phases }, null, 1));
    console.log(`\nwrote tests/out/stagenet_${LABEL}.json`);
    await browser.close();
    if (roomId && !process.env.KEEP) { try { A.cleanupRooms([roomId]); } catch (e) { console.log('cleanup failed', e.message); } }
  }
  console.log(fails ? `STAGENET E2E: ${fails} FAILED` : 'STAGENET E2E: ALL PASSED');
})();
