// 3-4 player co-op playtest on the ?coopdev mock backend: N pages of ONE muted Chrome context = N players.
// Lobby (create / join by typing the code / starter tiles / START, all clicks), a map vote split then resolved
// by plurality, a real wild-or-trainer battle from the first floor played with clicks, the private rewards, an
// elite / rival / bird battle (party set up identically on every client, then real clicks), and a loss to the
// end screen. Optional: a player drops out (offline), the others CARRY ON without them, then they REJOIN.
// A watchdog flags pages that make no progress for 20 s while not waiting on someone else (FREEZE), and every
// battle ends with a checksum comparison across all clients (DESYNC).
//   node tests/coop4_play.cjs [port=8150]           (PLAYERS=3,4 by default; ONLY=sitout,...)
// Screenshots: tests/out/coop4/*.png
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

// REAL=1: against the DEV Convex deployment: one browser context per player (minted dev tokens), the dist/ build
// (CONVEX_URL=<dev> node tools/build_site.cjs) served on 8097 (in dev SITE_URL). OLD=2 (seat numbers, 1-based): those
// players run the old production client from dist/old/ (2-player rooms only).
const REAL = !!process.env.REAL;
const OLD = (process.env.OLD || '').split(',').filter(Boolean).map(Number);
const A = REAL ? require('./coop_auth.cjs') : null;
const ACCOUNTS = REAL ? [A.P1_EMAIL, A.P2_EMAIL, 'coop-third@kanto-spire.test', 'coop-fourth@kanto-spire.test'] : [];
const PORT = +(process.argv[2] || (REAL ? 8097 : 8150));
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'tests/out/coop4');
const BASE = `http://localhost:${PORT}/`;
const FREEZE_MS = 20000;
const PLAYERS = (process.env.PLAYERS || '2,3,4').split(',').map(Number);
const ACT_LVL = +(process.env.ACT_LVL || 18); // party level for the full-act playthrough
const DEFAULT_STEPS = ['act', 'sitout', 'elite', 'bird', 'loss'];
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
const NAMES = ['ALICE', 'BOB', 'CARL', 'DANA'];
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log('  ·', ...a);
const fails = [], errors = [], freezes = [], results = [];
// coverage of the full-act playthroughs (tests the brief asked for: votes, events, shop, faints, races, rejoin...)
const STATS = { nodes: {}, events: [], starterPicks: [], ties: 0, splits: 0, simulVotes: 0, races: [], unlocks: 0, reloads: 0, downs: 0, revives: 0, partnerItems: 0, actClears: 0, battles: 0 };
const check = (label, ok, extra = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${extra ? ' ' + extra : ''}`); if (!ok) fails.push(label); return ok; };
const timeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`no answer within ${ms / 1000} s: ${what}`)), ms))]);
const ev = (page, fn, arg) => timeout(page.evaluate(fn, arg), 30000, `${page.__name} evaluate`);
const sceneOf = (page) => ev(page, () => window.__engine?.Engine.scene?.constructor?.name || null);
async function until(page, fn, arg, { timeout: ms = 30000, label = 'condition' } = {}) {
  try { await page.waitForFunction(fn, arg, { timeout: ms, polling: 150 }); return true; }
  catch (e) { console.log(`  ! timeout waiting for ${label} on ${page.__name}`); await dump(page); throw new Error(`timeout: ${label} (${page.__name})`); }
}
async function attachDebugger(page) { page.__cdp = await page.context().newCDPSession(page); await page.__cdp.send('Debugger.enable'); }
// Where a hung page's main thread is stuck (pause through the inspector, print the JS stack).
async function stackOf(page) {
  try {
    const cdp = page.__cdp;
    if (!cdp) return ['(no debugger session)'];
    const paused = new Promise(res => cdp.once('Debugger.paused', res));
    await cdp.send('Debugger.pause');
    const e = await timeout(paused, 5000, 'Debugger.paused');
    const frames = e.callFrames.slice(0, 14).map(fr => `${fr.functionName || '(anon)'} ${fr.url.replace(/^.*\/src\//, 'src/')}:${fr.location.lineNumber + 1}`);
    await cdp.send('Debugger.resume').catch(() => {});
    return frames;
  } catch (e) { return ['(no stack: ' + e.message + ')']; }
}
async function dump(page) {
  const st = await ev(page, () => {
    const s = window.__coop, g = s?.game, E = window.__engine?.Engine, sc = E?.scene;
    return { scene: sc?.constructor?.name, overlays: E?.overlays.map(o => o.constructor.name + ':' + (o.title || '')), seq: s?.lastSeq, phase: g?.phase, desync: s?.desync, votes: g?.votes, away: g?.away,
      battle: g?.battle ? { turn: g.battle.turn, locks: g.battle.locks.map(Boolean), down: g.battle.down, away: g.battle.away, result: g.battle.result, hp: g.battle.enemies.map(e => e.hp) } : null,
      busy: sc?.busy, canAct: sc?.canAct?.(), posting: sc?.posting, ck: g?.checksum?.() >>> 0, outbox: s?.outbox?.length, tail: (s?.log || []).slice(-4).map(a => a.seq + ":" + a.p + ":" + a.type + (a.turn ? "@" + a.turn : "")), msg: sc?.msg?.cur?.str || null, private: g?.private };
  }).catch(e => ({ err: e.message }));
  console.log(`  ${page.__name} state:`, JSON.stringify(st));
  return st;
}
async function gclick(page, x, y) {
  await timeout((async () => {
    await page.bringToFront();
    const r = await ev(page, () => { const b = document.getElementById('game').getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; });
    await page.mouse.move(r.x + x * r.w / 640, r.y + y * r.h / 360);
    await sleep(40); await page.mouse.down(); await sleep(40); await page.mouse.up(); await sleep(90);
  })(), 20000, `${page.__name} click`);
}
const shot = async (page, name) => { await page.bringToFront(); await page.mouse.move(2, 2); await sleep(150); await page.screenshot({ path: path.join(OUT, `${name}.png`) }); log('shot', `${name}.png`, `(${page.__name})`); };
const closeAllOverlays = (page) => ev(page, () => { const E = window.__engine.Engine; for (const o of E.overlays.slice().reverse()) o.close ? o.close(null) : E.overlays.pop(); });

// ---- watchdog (as tests/coop_freeze_audit.cjs, for N pages) -------------------------------------------
const SIG = () => {
  const E = window.__engine?.Engine, sc = E?.scene, s = window.__coop, g = s?.game;
  const name = sc?.constructor?.name || null;
  const sig = { name, ov: (E?.overlays || []).map(o => o.constructor.name + ':' + (o.title || '')), seq: s?.lastSeq ?? null, phase: g?.phase ?? null };
  let exempt = null;
  const me = s?.mySlot;
  if (name === 'CoopBattleScene' && sc.duo) {
    const d = sc.duo;
    Object.assign(sig, { busy: sc.busy, running: sc.running, q: sc.q?.length, posting: !!sc.posting, finishing: !!sc.finishing,
      msg: sc.msg?.cur ? sc.msg.cur.str.slice(0, Math.floor(sc.msg.shown)) + (sc.msg.queue.length ? '+' + sc.msg.queue.length : '') : null,
      hand: sc.handIds?.length, sel: sc.sel?.length, foes: sc.foes.map(f => (f ? [f.ri, Math.round(f.hp), Math.round(f.x || 0), +(f.faint || 0).toFixed(1)] : null)),
      engHp: d.enemies.map(e => e.hp), turn: d.turn, locks: d.locks.map(Boolean), down: d.down.slice(), result: d.result?.outcome || null, canAct: sc.canAct() });
    const othersPending = d.locks.some((L, q) => q !== me && !L && !(typeof d.out === 'function' ? d.out(q) : d.down[q]));
    if (!sc.busy && !sc.posting && !d.result && (d.locks[me] || d.out(me)) && othersPending) exempt = 'partner';
  } else if (name === 'CoopWaitScene') {
    sig.done = g?.private?.done || null;
    if (g?.phase === 'private' && g.private?.done?.some((x, q) => !x && q !== me)) exempt = 'partner';
  } else if (name === 'RewardScene') { sig.busy = sc.busy; sig.rew = (sc.rewards || []).map(r => (r.claimed ? 1 : 0)).join(''); sig.exp = sc.expAnim; }
  else if (name === 'CoopEndScene') exempt = 'end';
  else if (name === 'CoopMapScene') { sig.votes = g?.votes; sig.pending = s?.pendingVote ?? null; exempt = 'map'; }
  if (sig.ov.length) exempt = 'choice';
  return { sig, exempt };
};
const WD = { active: false, scenario: '', ticking: false, timer: null, pages: [] };
function startWatchdog() {
  WD.timer = setInterval(async () => {
    if (!WD.active || WD.ticking) return;
    WD.ticking = true;
    try {
      const now = Date.now(), pages = WD.pages.filter(p => !p.__gone);
      const res = await Promise.all(pages.map(p => timeout(p.evaluate(SIG), 5000, 'SIG').catch(e => ({ sig: { err: /no answer/.test(e.message) ? 'unresponsive' : e.message }, exempt: null }))));
      res.forEach((r, i) => {
        const p = pages[i], st = (p.__wd ||= { key: null, since: now, flagged: false });
        const key = JSON.stringify(r.sig);
        if (key !== st.key) { st.key = key; st.since = now; st.flagged = false; st.exempt = r.exempt; return; }
        st.exempt = r.exempt;
        if (now - st.since < FREEZE_MS || st.flagged || ['partner', 'end', 'map', 'choice'].includes(r.exempt)) return;
        st.flagged = true;
        freezes.push({ scenario: WD.scenario, page: p.__name, sig: r.sig });
        console.log(`  !!! FREEZE on ${p.__name} (${WD.scenario}):`, key);
        if (r.sig.err === 'unresponsive') stackOf(p).then(st => console.log(`  ${p.__name} main thread stack:\n    ` + st.join('\n    ')));
        else dump(p);
      });
      if (pages.length && pages.every(p => p.__wd?.exempt === 'partner' && now - p.__wd.since > FREEZE_MS && !p.__wd.dead)) {
        pages.forEach(p => { p.__wd.dead = true; });
        freezes.push({ scenario: WD.scenario, page: 'all', kind: 'DEADLOCK' });
        console.log(`  !!! DEADLOCK (${WD.scenario}): every page waits on someone else`);
        for (const p of pages) dump(p);
      }
    } finally { WD.ticking = false; }
  }, 1000);
}
const watch = (on, scenario) => { WD.active = on; if (scenario) WD.scenario = scenario; };

// ---- boot / lobby -----------------------------------------------------------------------------------
async function boot(page) {
  await page.goto(page.__url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__ready && window.G?.meta && window.__engine?.Engine.scene, null, { timeout: 90000 });
  await ev(page, () => { Object.assign(G.meta, { tutorialDone: true, tipCatch: true, hintBattles: 9 }); window.__engine.Engine.timeScale = 2; });
  await sleep(600);
  await closeAllOverlays(page);
}
async function openCoop(page) {
  for (let i = 0; i < 4; i++) {
    if (await sceneOf(page) === 'CoopLobbyScene') break;
    await closeAllOverlays(page);
    const y = await ev(page, async () => ((await import(window.__src('game/state.js'))).hasSavedRun() ? 290 : 262));
    await gclick(page, 116 + 160 + 6 + 48, y + 12);
    await sleep(700);
  }
  if (await sceneOf(page) !== 'CoopLobbyScene') { log(page.__name, 'CO-OP click missed: opening the lobby directly'); await ev(page, async () => { const m = await import(window.__src('scenes/coop/lobby.js')); window.__engine.setScene(new m.CoopLobbyScene()); }); }
  await until(page, () => window.__engine.Engine.scene?.constructor?.name === 'CoopLobbyScene' && !!window.__engine.Engine.scene.net, null, { label: 'lobby' });
}
async function pickStarter(page, species) {
  const pos = await ev(page, async (sp) => {
    const sc = window.__engine.Engine.scene, v = sc.view;
    const { availableStarters } = await import(window.__src('game/unlocks.js'));
    const { D } = await import(window.__src('game/data.js'));
    const list = availableStarters(G.meta, v.room.world || 'kanto', s => !!D.species[s]);
    const i = list.indexOf(sp);
    if (i < 0) return null;
    const big = list.length <= 6, tw = big ? 62 : 46, th = big ? 74 : 46, gap = big ? 4 : 3, per = big ? 6 : 8;
    return [232 + (i % per) * (tw + gap) + tw / 2, 78 + Math.floor(i / per) * (th + 3) + th / 2];
  }, species);
  if (pos) await gclick(page, ...pos);
  const ok = await page.waitForFunction((sp) => { const v = window.__engine.Engine.scene.view; return v?.members?.find(m => m.slot === v.me)?.starter === sp; }, species, { timeout: 8000, polling: 150 }).then(() => true).catch(() => false);
  if (!ok) { log(page.__name, `starter click missed (${species}): setting it directly`); await ev(page, (sp) => { const sc = window.__engine.Engine.scene; return sc.act(net => net.setStarter(sc.roomId, sp)).then(() => sc.poll()); }, species); }
}
async function makeRoom(pages, starters, tag) {
  const [host, ...guests] = pages;
  for (const p of pages) await openCoop(p);
  await gclick(host, 170, 107); // CREATE ROOM
  await until(host, () => { const sc = window.__engine.Engine.scene; return sc.mode === 'room' && sc.view?.room?.code; }, null, { label: 'room created' });
  const code = await ev(host, () => window.__engine.Engine.scene.view.room.code);
  for (const [i, g] of guests.entries()) {
    await gclick(g, 170, 191); // JOIN ROOM
    await until(g, () => window.__engine.Engine.scene.mode === 'join', null, { label: 'join mode' });
    await g.keyboard.type(code, { delay: 50 });
    await gclick(g, 390, 225); // JOIN
    await until(g, (n) => { const sc = window.__engine.Engine.scene; return sc.mode === 'room' && sc.view?.members?.length >= n; }, i + 2, { label: `${g.__name} in room` });
  }
  for (const [i, p] of pages.entries()) await pickStarter(p, starters[i]);
  await until(host, (n) => { const v = window.__engine.Engine.scene.view; return v?.members?.length === n && v.members.every(m => m.starter); }, pages.length, { label: 'all starters', timeout: 20000 });
  await gclick(pages[pages.length - 1], 284, 305); // last guest: READY
  await sleep(1500);
  await shot(host, `${tag}_lobby`);
  const lob = await ev(host, () => window.__engine.Engine.scene.view.members.map(m => `P${m.slot + 1}:${m.name}:${m.starter}`));
  check(`${tag}: lobby has ${pages.length} players with starters`, lob.length === pages.length, JSON.stringify(lob));
  await gclick(host, 566, 305); // START
  for (const p of pages) await until(p, () => window.__coop?.synced && window.__engine.Engine.scene?.constructor?.name === 'CoopMapScene', null, { label: 'map after start', timeout: 60000 });
  const n = await ev(host, () => window.__coop.game.n);
  check(`${tag}: room ${code} started with ${n} players`, n === pages.length);
  return code;
}

// ---- map ---------------------------------------------------------------------------------------------
async function nodeClick(page, id) {
  for (let i = 0; i < 3; i++) {
    const pos = await ev(page, (id) => { const sc = window.__engine.Engine.scene; return sc.nodePos(sc.s.game.world.map.nodes[id]); }, id);
    await gclick(page, pos[0], pos[1] - 8);
    const ok = await page.waitForFunction((id) => { const s = window.__coop; return s.pendingVote === id || s.game.votes[s.mySlot] === id || s.game.phase !== 'map'; }, id, { timeout: 3000, polling: 100 }).then(() => true).catch(() => false);
    if (ok) return true;
    log(page.__name, `vote click on node ${id} missed (try ${i + 1})`);
  }
  await ev(page, (id) => window.__coop.vote(id), id);
  return false;
}
// Everyone votes; with more than one reachable node the votes split first (plurality / tie rules).
async function voteRound(pages, tag, want, { split = true, tie = false, simul = false, shotName = null } = {}) {
  const active = pages.filter(p => !p.__gone);
  const reach = await ev(active[0], () => window.__coop.game.reachable());
  const alts = reach.filter(id => id !== want), alt = alts[0];
  let plan = active.map((p, i) => (split && alt != null && i === 1 ? alt : want));
  // tie: an even split (2: one each, 4: two each, 3: three different nodes) -> the shared RNG picks
  if (tie && alt != null) plan = active.length === 3 ? (alts[1] != null ? [want, alt, alts[1]] : plan) : active.map((p, i) => (i < active.length / 2 ? want : alt));
  if (simul) {
    // everyone clicks at the same moment (votes race in the log)
    STATS.simulVotes++;
    await Promise.all(active.map((p, i) => nodeClick(p, plan[i])));
  } else {
    for (let i = 0; i < active.length - 1; i++) { await nodeClick(active[i], plan[i]); await sleep(300); }
    for (const p of active) await until(p, (k) => window.__coop.game.votes.filter(v => v !== null).length >= k || window.__coop.game.phase !== 'map', active.length - 1, { label: 'votes visible', timeout: 15000 });
    const phase = await ev(active[0], () => window.__coop.game.phase);
    if (shotName && phase === 'map') await shot(active[0], shotName);
    if (phase === 'map') await nodeClick(active[active.length - 1], plan[plan.length - 1]);
  }
  if (plan.some(x => x !== plan[0])) STATS.splits++;
  for (const p of active) await until(p, () => window.__coop.game.phase !== 'map', null, { label: 'vote resolved', timeout: 20000 });
  const lv = await ev(active[0], () => window.__coop.game.lastVote);
  log(`${tag}: votes ${JSON.stringify(lv.votes)} -> node ${lv.picked}${lv.tie ? ' (tie, coin)' : ''}`);
  return lv;
}

// Put the shared run right before a node type, identically on every client (checksum history patched).
async function placeBefore(pages, { act, type, party, size = 1, revive = false }) {
  const active = pages.filter(p => !p.__gone);
  for (const p of active) await until(p, () => window.__coop?.game?.phase === 'map' && window.__engine.Engine.scene?.constructor?.name === 'CoopMapScene', null, { label: 'on the map', timeout: 60000 });
  for (const p of active) await closeAllOverlays(p);
  const top = Math.max(...await Promise.all(active.map(p => ev(p, () => window.__coop.lastSeq))));
  for (const p of active) await until(p, (n) => window.__coop.lastSeq >= n, top, { label: 'same seq' });
  const res = [];
  for (const p of active) {
    res.push(await ev(p, async ({ act, type, party, size, revive }) => {
      const { maxHp, makeMon } = await import(window.__src('game/pokemon.js'));
      const { RNG } = await import(window.__src('game/rng.js'));
      const { expForLevel, D } = await import(window.__src('game/data.js'));
      const s = window.__coop, g = s.game, w = g.world;
      if (w.actIndex !== act) { w.startAct(act); for (const r of g.runs) r.startAct(act); }
      const t = Object.values(w.map.nodes).find(n => n.type === type);
      if (!t) return { err: `no ${type} node in act ${act}` };
      w.nodeId = t.prev?.[0] ?? null; w.floor = t.floor - 1;
      g.votes = g.votes.map(() => null);
      const base = w.levelFor(t.floor);
      g.runs.forEach((r, pi) => {
        const kind = Array.isArray(party) ? party[pi] : party;
        const lvl = base + (kind === 'strong' ? (type === 'legend' ? 14 : 4) : 0);
        for (let i = r.party.length; i < size; i++) {
          const m = makeMon(['PIDGEY', 'RATTATA', 'ODDISH', 'GEODUDE', 'ZUBAT'][i % 5], Math.max(5, base - 2), { rng: new RNG('c4' + pi + ':' + i) });
          m.uid = 7e8 + pi * 100 + i;
          r.party.push(m);
        }
        for (const m of r.party) {
          if (kind === 'strong' && m.level < lvl) m.level = lvl;
          if (kind === 'strong') m.exp = expForLevel(D.species[m.species]?.growthRate, m.level + 1) - 1;
          m.status = null;
          m.hp = kind === 'weak' ? 1 : maxHp(m);
        }
        if (revive && kind !== 'weak' && !r.hasConsumable('REVIVE')) r.addConsumable('REVIVE');
      });
      g.mirror();
      s.ck.set(s.lastSeq, g.checksum() >>> 0);
      s.route(true);
      return { id: t.id, ck: g.checksum() >>> 0 };
    }, { act, type, party, size, revive }));
  }
  if (res[0].err) throw new Error(res[0].err);
  check(`setup ${type} (act ${act + 1}): all ${active.length} clients agree`, res.every(r => r.ck === res[0].ck && r.id === res[0].id));
  await sleep(400);
  return res[0];
}

// ---- overlays ----------------------------------------------------------------------------------------
async function overlayInfo(page) {
  return ev(page, async () => {
    const E = window.__engine.Engine, o = E.overlays[E.overlays.length - 1];
    if (!o) return null;
    const name = o.constructor.name, W = 640, H = 360;
    const out = { name, title: o.title || '', options: null };
    if (name === 'ChoiceModal') {
      const F = await import(window.__src('engine/font.js'));
      const w = o.w || 300, n = o.options.length, bh = 26;
      const lines = o.body ? F.wrap(o.body, w - 24).length : 0;
      const h = 46 + n * (bh + 4) + (o.body ? 14 * lines : 0);
      const x = (W - w) / 2, y = (H - h) / 2;
      let cy = y + 28;
      if (o.body) cy += lines * F.lineHeight() + 4;
      out.options = o.options.map((op, i) => ({ label: op.label, value: op.value, x: x + w / 2, y: cy + i * (bh + 4) + bh / 2 }));
    } else if (name === 'PartyPicker') {
      const run = G.run, w = 420, h = 50 + Math.ceil(run.party.length / 2) * 64, x = (W - w) / 2, y = (H - h) / 2;
      out.mons = run.party.map((m, i) => ({ uid: m.uid, species: m.species, ok: o.filter ? o.filter(m) === true : true, x: x + 10 + (i % 2) * 204 + 98, y: y + 30 + Math.floor(i / 2) * 64 + 29 }));
      out.lead = window.__engine.Engine.scene?.sub?.leadUid ?? null;
    } else if (name === 'RelicChoiceModal') out.choices = o.choices?.slice();
    else if (name === 'StarterUnlockModal') out.offer = o.offer?.options?.slice();
    else if (name === 'MoveReplaceModal') out.btn = [W / 2, (H - 220) / 2 + 220 - 34 + 12];
    else if (name === 'EvolutionModal') out.phase = o.phase;
    else if (!name || /toast/i.test(name)) out.toast = o.t > 0.3;
    return out;
  });
}
async function answerOverlay(page, prefer = 0) {
  const o = await overlayInfo(page);
  if (!o) return null;
  const closeTop = (v) => ev(page, (v) => { const E = window.__engine.Engine; const ov = E.overlays[E.overlays.length - 1]; ov?.close ? ov.close(v) : E.overlays.pop(); }, v);
  if (o.name === 'ChoiceModal' && o.options?.length) {
    const op = o.options[Math.min(prefer, o.options.length - 1)];
    await gclick(page, op.x, op.y); await sleep(250);
    const still = await overlayInfo(page);
    if (still && still.name === o.name && still.title === o.title) await closeTop(op.value ?? Math.min(prefer, o.options.length - 1));
    return { title: o.title, answer: op.label };
  }
  if (o.name === 'PartyPicker' && o.mons) {
    const ok = o.mons.filter(m => m.ok);
    const m = ok.find(x => x.uid !== o.lead) || ok[0];
    if (m) {
      await gclick(page, m.x, m.y); await sleep(250);
      const still = await overlayInfo(page);
      if (still && still.name === o.name) await ev(page, (uid) => { const E = window.__engine.Engine; E.overlays[E.overlays.length - 1].close(G.run.party.find(x => x.uid === uid)); }, m.uid);
      return { title: o.title, answer: m.species };
    }
  }
  if (o.name === 'EvolutionModal') { await sleep(400); return { title: 'evolution', answer: 'watched', wait: true }; }
  if (o.toast !== undefined || o.btn) {
    if (o.toast === false) { await sleep(300); return null; }
    await gclick(page, ...(o.btn || [320, 300])); await sleep(250);
    const still = await overlayInfo(page);
    if (still && still.name === o.name && (o.btn || still.toast !== undefined)) await closeTop(o.btn ? -1 : true);
    return { title: o.name || 'message', answer: 'clicked' };
  }
  if (o.name === 'RelicChoiceModal' && o.choices?.length) { await closeTop(o.choices[0]); return { title: 'relic', answer: o.choices[0] }; }
  if (o.name === 'StarterUnlockModal' && o.offer?.length) {
    // act clear: pick the first offered starter (tile), then UNLOCK (real clicks; same layout as scenes/unlock.js)
    const n = o.offer.length, gx = Math.round(320 - (n * 120 + (n - 1) * 10) / 2), y = Math.round((360 - 232) / 2);
    await gclick(page, gx + 60, y + 42 + 66); await sleep(200);
    await gclick(page, 320, y + 232 - 40 + 14); await sleep(300);
    const still = await overlayInfo(page);
    if (still && still.name === 'StarterUnlockModal') await ev(page, () => { const E = window.__engine.Engine, m = E.overlays[E.overlays.length - 1]; m.choose(m.offer.options[0]); });
    STATS.starterPicks.push(`${page.__name}:${o.offer[0]}`);
    return { title: 'starter', answer: o.offer[0] };
  }
  await closeTop(null);
  return { title: o.title, answer: null };
}

// ---- battle with clicks -------------------------------------------------------------------------------
const FOE_HIT = [[160 + 250 + 64, 27 + 4 + 64], [160 + 350 + 64, 27 - 6 + 64]];
const LOCK_BTN = [640 - 150 + 36, 262 - 32 + 12], DISCARD_BTN = [640 - 74 + 35, 262 - 32 + 12], MSG_HIT = [160 + 4 + 146, 27 + 200 - 46 + 21];
async function battleState(page) {
  return ev(page, () => {
    const E = window.__engine.Engine, sc = E.scene, s = window.__coop, g = s?.game;
    if (sc?.constructor?.name !== 'CoopBattleScene' || !sc.duo) return { inBattle: false, phase: g?.phase, scene: sc?.constructor?.name };
    const d = sc.duo;
    return { inBattle: true, phase: g.phase, canAct: sc.canAct(), overlays: E.overlays.length, turn: d.turn, locked: !!d.locks[s.mySlot], down: d.down[s.mySlot], result: d.result?.outcome || null, stuck: !!sc.stuck, live: sc.liveSlots(), busy: sc.busy, msg: sc.msg?.cur?.str || null, seq: s.lastSeq, intents: d.intents.filter(Boolean).length };
  });
}
async function takeTurn(page) {
  const r = await selectHand(page);
  if (r !== 'hand') return r;
  await lockClick(page);
  return 'lock';
}
const lockSettled = (page) => page.waitForFunction(() => { const sc = window.__engine.Engine.scene; return sc?.constructor?.name !== 'CoopBattleScene' || !sc.posting; }, null, { timeout: 20000, polling: 100 }).catch(() => log(page.__name, 'lock still posting after 20 s'));
async function lockClick(page) { await gclick(page, ...LOCK_BTN); await lockSettled(page); }
// Target + select the best hand with clicks (no lock). 'hand' = selected; 'pass' / 'other' = already acted (PASS / discard).
async function selectHand(page, { noPass = false } = {}) {
  const st = await battleState(page);
  if (st.stuck) { if (noPass) return 'stuck'; await gclick(page, ...LOCK_BTN); return 'pass'; }
  const slot = await ev(page, () => window.__engine.Engine.scene.target);
  if (st.live.length > 1) await gclick(page, ...FOE_HIT[slot]);
  let ids = await ev(page, () => window.__engine.Engine.scene.bestHand());
  if (!ids || !ids.length) ids = await ev(page, () => { const sc = window.__engine.Engine.scene; const c = sc.handIds.find(id => sc.info(sc.sub.deck.hand.find(x => x.id === id)).playable); return c ? [c] : []; });
  await ev(page, () => { window.__engine.Engine.scene.sel = []; });
  if (!ids.length) {
    if (noPass) return 'stuck';
    const can = await ev(page, () => { const sc = window.__engine.Engine.scene; if (!sc.handIds.length || !sc.canDiscard(1)) return false; sc.sel = [sc.handIds[0]]; return true; });
    await gclick(page, ...(can ? DISCARD_BTN : LOCK_BTN));
    return 'other';
  }
  for (const id of ids) {
    const pos = await ev(page, (id) => {
      const sc = window.__engine.Engine.scene, n = sc.handIds.length, i = sc.handIds.indexOf(id), v = sc.vis.get(id);
      if (i < 0 || !v) return null;
      const w = i === n - 1 ? 60 : Math.min(60, sc.handPos(i + 1, n)[0] - sc.handPos(i, n)[0]);
      return [v.x + Math.min(w / 2, 20), v.y + 50];
    }, id);
    if (pos) await gclick(page, ...pos);
  }
  const sel = await ev(page, () => window.__engine.Engine.scene.sel.slice());
  if (sel.length !== ids.length) await ev(page, (ids) => { window.__engine.Engine.scene.sel = ids.slice(); }, ids);
  return 'hand';
}
async function weakenFoes(pages, frac) {
  const active = pages.filter(p => !p.__gone);
  for (const p of active) await until(p, () => { const sc = window.__engine.Engine.scene; return sc?.constructor?.name === 'CoopBattleScene' && sc.canAct(); }, null, { label: 'battle idle (weaken)', timeout: 60000 });
  const seqs = await Promise.all(active.map(p => ev(p, () => window.__coop.lastSeq)));
  if (seqs.some(x => x !== seqs[0])) return log('weakenFoes skipped: clients at different seqs', seqs);
  const r = [];
  for (const p of active) r.push(await ev(p, (frac) => {
    const s = window.__coop, g = s.game, d = g.battle, sc = window.__engine.Engine.scene;
    for (const e of d.enemies) e.hp = Math.min(e.hp, Math.max(1, Math.ceil(e.maxHp * frac)));
    s.ck.set(s.lastSeq, g.checksum() >>> 0);
    sc._hint = {}; sc.reconcile();
    return g.checksum() >>> 0;
  }, frac));
  check(`foes weakened to ${Math.round(frac * 100)}% on all clients`, r.every(x => x === r[0]));
}
// races: lock-in races on some turns (all at once / UNLOCK vs the last LOCK IN / unlock + relock);
// reload: one player reloads the tab mid-battle and REJOINs; revive: a downed player gets a partner's REVIVE.
async function playBattle(pages, tag, { midShot = null, races = false, reload = false, revive = false } = {}) {
  const active = pages.filter(p => !p.__gone);
  const deadline = Date.now() + 10 * 60 * 1000;
  const seen = { turns: 0, endMsg: null, maxIntents: 0, shot: !midShot, raced: new Set(), reloaded: false, revived: false };
  const lastMsg = active.map(() => '');
  STATS.battles++;
  for (;;) {
    if (Date.now() > deadline) throw new Error(`${tag}: battle took longer than 10 min`);
    const st = await Promise.all(active.map(battleState));
    if (st.every(s => !s.inBattle)) break;
    const fighting = st.filter(s => s.inBattle && !s.down);
    const allIdle = st.every(s => s.inBattle) && fighting.length >= 2 && fighting.every(s => s.canAct && !s.overlays && s.turn === fighting[0].turn);
    // ---- a race turn (every player is choosing on the same turn): hold everyone until then (max 20 s)
    if (races && fighting.length >= 2 && fighting.some(s => s.canAct) && !allIdle && !seen.raced.has(Math.max(...fighting.map(s => s.turn))) && (seen.holdSince ||= Date.now()) > Date.now() - 20000) {
      for (let i = 0; i < active.length; i++) if (st[i].inBattle && st[i].overlays) await answerOverlay(active[i]);
      for (let i = 0; i < active.length; i++) if (st[i].inBattle && !st[i].canAct && st[i].msg && st[i].msg === lastMsg[i]) await gclick(active[i], ...MSG_HIT);
      st.forEach((s, i) => { lastMsg[i] = s.msg || ''; });
      await sleep(200);
      continue;
    }
    seen.holdSince = 0;
    if (races && allIdle && !seen.raced.has(fighting[0].turn) && fighting[0].turn >= 1) {
      seen.raced.add(fighting[0].turn); seen.holdSince = 0;
      const kinds = ['simul', 'unlockRace', 'relock'];
      const kind = kinds[(seen.raced.size - 1) % kinds.length];
      await raceTurn(active.filter((p, i) => st[i].inBattle && !st[i].down), `${tag} T${fighting[0].turn}`, kind);
      continue;
    }
    // ---- one player reloads the tab mid-battle (after a turn or two), then REJOINs from the lobby
    if (reload && !seen.reloaded && allIdle && fighting[0].turn >= 1 && seen.raced.size === 0) {
      seen.reloaded = true;
      const victim = active[active.length - 1];
      await reloadAndRejoin(victim, `${tag} mid-battle`);
      continue;
    }
    // ---- a downed player: a partner who can act uses a REVIVE on them (real picker clicks)
    if (revive && !seen.revived) {
      const di = st.findIndex(s => s.inBattle && s.down && !s.result);
      const hi = st.findIndex(s => s.inBattle && !s.down && s.canAct && !s.overlays);
      if (di >= 0 && hi >= 0 && await ev(active[hi], () => G.run.hasConsumable('REVIVE'))) {
        seen.revived = true;
        if (await partnerRevive(active[hi], active[di], active)) STATS.revives++;
        continue;
      }
    }
    for (let i = 0; i < active.length; i++) {
      const page = active[i], s = st[i];
      if (!s.inBattle) continue;
      seen.maxIntents = Math.max(seen.maxIntents, s.intents || 0);
      if (s.msg && /defeated|won the battle|blacked out|joins your team/.test(s.msg)) seen.endMsg ||= s.msg;
      if (s.overlays) { await answerOverlay(page); continue; }
      if (s.canAct) {
        // the screenshot: once a turn has resolved and the last player is about to lock in (all intents on screen)
        if (!seen.shot && s.turn >= 2 && i === active.length - 1) { seen.shot = true; await shot(active[0], midShot); }
        await takeTurn(page); seen.turns++; continue;
      }
      if (s.msg && s.msg === lastMsg[i]) await gclick(page, ...MSG_HIT);
      lastMsg[i] = s.msg || '';
    }
    await sleep(150);
  }
  const downs = await ev(active[0], () => window.__coop.game.down.filter(Boolean).length).catch(() => 0);
  STATS.downs += downs;
  return seen;
}

// Lock-in races. simul: everyone clicks LOCK IN at the same moment. unlockRace: everyone but the last locks; then
// P1 clicks UNLOCK while the last player clicks LOCK IN (the log decides: the turn resolves and the unlock is
// refused, or P1 is unlocked and the turn waits for them). relock: P1 locks, unlocks, picks again and relocks.
async function raceTurn(fighters, tag, kind) {
  const sel = [];
  for (const p of fighters) sel.push(await selectHand(p, { noPass: true }));
  const ready = fighters.filter((p, i) => sel[i] === 'hand');
  const stuck = fighters.filter((p, i) => sel[i] !== 'hand');
  for (const p of stuck) await takeTurn(p); // (no damaging hand: pass / discard as usual)
  if (ready.length < 2) return;
  const turn0 = await ev(ready[0], () => window.__coop.game.battle.turn);
  let outcome = '';
  if (kind === 'simul') {
    await Promise.all(ready.map(p => gclick(p, ...LOCK_BTN)));
    await Promise.all(ready.map(lockSettled));
    // every lock must have landed (the turn resolved, or this player is locked on it)
    const landed = await Promise.all(ready.map(p => p.waitForFunction((t0) => { const d = window.__coop.game.battle; return !d || d.turn !== t0 || !!d.result || !!d.locks[window.__coop.mySlot]; }, turn0, { timeout: 15000, polling: 100 }).then(() => true).catch(() => false)));
    check(`${tag}: ${ready.length} simultaneous LOCK INs all landed`, landed.every(Boolean), JSON.stringify(landed));
    outcome = 'all locked at once';
  } else if (kind === 'unlockRace') {
    const [first, ...rest] = ready, last = rest.pop();
    for (const p of [first, ...rest]) await lockClick(p);
    // wait until P1 sees its own lock (UNLOCK enabled)
    await until(first, () => window.__engine.Engine.scene?.canUnlock?.(), null, { label: 'can unlock', timeout: 20000 }).catch(() => {});
    // (every other race the last player clicks a moment later, so both log orders come up)
    const lag = STATS.unlocks % 2 ? 250 : 0;
    await Promise.all([gclick(first, ...LOCK_BTN), sleep(lag).then(() => gclick(last, ...LOCK_BTN))]);
    await Promise.all([first, last].map(lockSettled));
    await sleep(1200);
    const r = await ev(first, (t0) => { const d = window.__coop.game.battle; return { resolved: !d || d.turn !== t0 || !!d.result, mine: d ? !!d.locks[window.__coop.mySlot] : null }; }, turn0);
    outcome = r.resolved ? 'turn resolved first: UNLOCK refused ("Too late")' : 'UNLOCK landed first: P1 chooses again, the turn waits';
    STATS.unlocks++;
  } else {
    const [first, ...rest] = ready;
    await lockClick(first);
    await until(first, () => window.__engine.Engine.scene?.canUnlock?.(), null, { label: 'can unlock', timeout: 20000 }).catch(() => {});
    await gclick(first, ...LOCK_BTN); // UNLOCK (same button spot)
    await until(first, () => { const sc = window.__engine.Engine.scene; return sc?.constructor?.name !== 'CoopBattleScene' || (!sc.posting && !sc.duo.locks[window.__coop.mySlot]); }, null, { label: 'unlocked', timeout: 20000 }).catch(() => {});
    // pick again (one card fewer if possible) and relock, then the others lock
    await ev(first, () => { const sc = window.__engine.Engine.scene; if (sc.sel.length > 1) sc.sel.pop(); });
    if (await ev(first, () => window.__engine.Engine.scene.canAct())) await lockClick(first);
    for (const p of rest) await lockClick(p);
    outcome = 'P1 locked, unlocked, relocked';
    STATS.unlocks++;
  }
  // everyone settles on the same log: same seq, same checksum
  await sleep(600);
  const a = await agree(fighters, `${tag} race ${kind}`);
  STATS.races.push(`${tag} ${kind}: ${outcome}`);
  log(`race ${tag} ${kind}: ${outcome} (seq ${a.seq})`);
}

// A tab reload, then REJOIN with a real click on the lobby's REJOIN row (falls back to opening the room by id).
async function reloadAndRejoin(page, tag) {
  const roomId = await ev(page, () => window.__coop.roomId);
  const before = await ev(page, () => window.__coop.game.phase);
  log(`${page.__name} reloads the tab (${tag}, phase ${before})`);
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.__ready && window.G?.meta && window.__engine?.Engine.scene, null, { timeout: 90000 });
  await ev(page, () => { Object.assign(G.meta, { tutorialDone: true, tipCatch: true, hintBattles: 9 }); window.__engine.Engine.timeScale = 2; });
  await sleep(500); await closeAllOverlays(page);
  await openCoop(page);
  const idx = await page.waitForFunction((id) => { const r = window.__engine.Engine.scene.rooms; return r ? r.findIndex(x => x.roomId === id) + 1 : 0; }, roomId, { timeout: 15000, polling: 200 }).then(h => h.jsonValue()).catch(() => 0);
  if (idx > 0 && idx <= 6) await gclick(page, 300 + 8 + 100, 90 + (idx - 1) * 36 + 16);
  const ok = await page.waitForFunction(() => !!window.__coop?.synced, null, { timeout: 30000, polling: 200 }).then(() => true).catch(() => false);
  if (!ok) { log(page.__name, 'REJOIN click missed: opening the room directly'); await ev(page, async (id) => { const m = await import(window.__src('scenes/coop/lobby.js')); window.__engine.setScene(new m.CoopLobbyScene({ roomId: id })); }, roomId); }
  await until(page, () => window.__coop?.synced && !!window.__engine.Engine.scene, null, { label: 'rejoined after reload', timeout: 60000 });
  STATS.reloads++;
  const after = await ev(page, () => ({ phase: window.__coop.game.phase, scene: window.__engine.Engine.scene.constructor.name, desync: window.__coop.desync }));
  check(`${tag}: ${page.__name} reloaded and rejoined (${before} -> ${after.phase}, ${after.scene})`, !after.desync);
}

// healer clicks REVIVE in their bag (the scene's own handler opens the team picker), then the downed player's tile.
async function partnerRevive(healer, downed, all) {
  const target = await ev(downed, () => window.__coop.mySlot);
  await ev(healer, () => window.__engine.Engine.scene.useConsumable('REVIVE'));
  await sleep(300);
  const pos = await ev(healer, (q) => {
    const E = window.__engine.Engine, o = E.overlays[E.overlays.length - 1];
    if (!o || o.constructor.name !== 'DuoPartyPicker') return null;
    const col = o.slots.indexOf(q), run = o.runs[col];
    const i = run.party.findIndex(m => m.hp <= 0);
    if (col < 0 || i < 0) return null;
    const rows = Math.max(...o.runs.map(r => r.party.length)), cols = o.runs.length, cw = cols > 2 ? Math.floor(600 / cols) - 6 : 264;
    const w = cols > 2 ? 612 : 560, h = 52 + rows * 38, x = (640 - w) / 2, y = (360 - h) / 2;
    return [x + 10 + col * (cw + 10) + cw / 2, y + 38 + i * 38 + 17];
  }, target);
  if (!pos) { await closeAllOverlays(healer); log('revive: no picker / no fainted POKéMON'); return false; }
  await shot(healer, `${all.length}p_revive_picker`);
  await gclick(healer, ...pos);
  const ok = await until(downed, (q) => !window.__coop.game.battle?.down?.[q], target, { label: 'revived partner back in', timeout: 20000 }).then(() => true).catch(() => false);
  check(`${all.length}p: ${healer.__name} revived ${downed.__name} with a REVIVE mid-battle (back in the fight)`, ok);
  STATS.partnerItems++;
  await agree(all, `${all.length}p revive`);
  return ok;
}
async function agree(pages, tag) {
  const active = pages.filter(p => !p.__gone);
  const top = Math.max(...await Promise.all(active.map(p => ev(p, () => window.__coop.lastSeq))));
  for (const p of active) await until(p, (n) => window.__coop.lastSeq >= n, top, { label: 'catch up', timeout: 20000 }).catch(() => {});
  const si = await Promise.all(active.map(p => ev(p, () => ({ seq: window.__coop.lastSeq, ck: window.__coop.game.checksum() >>> 0, phase: window.__coop.game.phase, desync: window.__coop.desync }))));
  check(`${tag}: all ${active.length} clients agree (seq ${si[0].seq}, ${si[0].phase})`, si.every(x => x.seq === si[0].seq && x.ck === si[0].ck && !x.desync), si.some(x => x.ck !== si[0].ck || x.desync) ? JSON.stringify(si) : '');
  return si[0];
}
// Private reward screens: take a held item if offered, then CONTINUE (answering prompts).
async function rewards(pages, tag, { shotName = null } = {}) {
  const active = pages.filter(p => !p.__gone);
  for (const [k, p] of active.entries()) {
    const deadline = Date.now() + 120000;
    for (;;) {
      if (Date.now() > deadline) throw new Error(`${tag}: reward screen never became ready on ${p.__name}`);
      const s = await ev(p, () => { const E = window.__engine.Engine, sc = E.scene; return { name: sc?.constructor?.name, busy: sc?.busy, ov: E.overlays.length, phase: window.__coop.game.phase }; });
      if (s.ov) { await answerOverlay(p); continue; }
      if (s.name === 'RewardScene' && !s.busy) break;
      if (s.phase !== 'private' || s.name === 'CoopWaitScene') break;
      await sleep(250);
    }
    if (await sceneOf(p) !== 'RewardScene') continue;
    if (k === 0 && shotName) await shot(p, shotName);
    const list = await ev(p, () => window.__engine.Engine.scene.rewards.map(r => ({ kind: r.kind, label: r.label, claimed: !!r.claimed })));
    log(p.__name, 'rewards:', list.map(r => `${r.kind}:${r.label}`).join(', '));
    const ri = list.findIndex(r => r.kind === 'relic' && !r.claimed);
    if (ri >= 0) {
      await gclick(p, 450, 60 + ri * 34 + 15); await sleep(400);
      for (let j = 0; j < 4 && await ev(p, () => window.__engine.Engine.overlays.length); j++) await answerOverlay(p);
    }
    const n = await ev(p, () => window.__engine.Engine.scene.rewards.length);
    await gclick(p, 450, 60 + n * 34 + 6 + 13); await sleep(400);
    for (let j = 0; j < 4 && await ev(p, () => window.__engine.Engine.overlays.length); j++) await answerOverlay(p, 1);
    await until(p, () => ['CoopWaitScene', 'CoopMapScene'].includes(window.__engine.Engine.scene?.constructor?.name), null, { label: `${tag}: left rewards`, timeout: 20000 });
    if (k === 0 && active.length > 2) { await sleep(500); if (await sceneOf(p) === 'CoopWaitScene') await shot(p, `${tag.split('_')[0]}_wait`); }
  }
}
// Leave a non-battle private node (center / mart / event / treasure) the quick way: the scene's own exit.
async function leavePrivate(pages) {
  for (const p of pages.filter(x => !x.__gone)) {
    const s = await ev(p, () => ({ name: window.__engine.Engine.scene?.constructor?.name, phase: window.__coop.game.phase }));
    if (s.phase !== 'private' || s.name === 'CoopWaitScene') continue;
    await closeAllOverlays(p);
    await ev(p, () => window.__coop.privateDone());
  }
}

// ---- private screens with clicks (full-act playthrough) -----------------------------------------------
async function rewardOne(page, tag) {
  const list = await ev(page, () => window.__engine.Engine.scene.rewards.map(r => ({ kind: r.kind, label: r.label, claimed: !!r.claimed })));
  log(page.__name, 'rewards:', list.map(r => `${r.kind}:${r.label}`).join(', '));
  const ri = list.findIndex(r => r.kind === 'relic' && !r.claimed);
  if (ri >= 0) {
    await gclick(page, 450, 60 + ri * 34 + 15); await sleep(400);
    for (let j = 0; j < 4 && await ev(page, () => window.__engine.Engine.overlays.length); j++) await answerOverlay(page);
  }
  const n = await ev(page, () => window.__engine.Engine.scene.rewards.length);
  await gclick(page, 450, 60 + n * 34 + 6 + 13); await sleep(400);
}
async function shopOne(page, tag) {
  const st = await ev(page, () => {
    const sc = window.__engine.Engine.scene, run = G.run;
    if (sc.__tested) return { leave: true };
    const groups = [it => it.kind === 'ball', it => it.kind === 'consumable', it => it.kind === 'tm', it => it.kind === 'relic', it => it.kind === 'service'];
    let y = 80 + 4 - (sc.scroll || 0), pick = null;
    for (const f of groups) {
      const list = sc.shop.items.filter(f);
      if (!list.length) continue;
      y += 12;
      list.forEach((it, i) => {
        const cx = 8 + (i % 4) * 119, cy = y + Math.floor(i / 4) * 37;
        if (!pick && it.kind === 'ball' && !it.sold && run.money >= it.price && cy + 17 < 340) pick = { x: cx + 58, y: cy + 17, key: it.key, price: it.price, money: run.money };
      });
      y += Math.ceil(list.length / 4) * 37 + 2;
    }
    return { pick };
  });
  if (!st.leave && st.pick) {
    await gclick(page, st.pick.x, st.pick.y); await sleep(400);
    for (let j = 0; j < 4 && await ev(page, () => window.__engine.Engine.overlays.length); j++) await answerOverlay(page, 1);
    const after = await ev(page, () => G.run.money);
    check(`${tag}: ${page.__name} bought ${st.pick.key} at the Mart ($${st.pick.money} -> $${after})`, after === st.pick.money - st.pick.price, '');
    await ev(page, () => { window.__engine.Engine.scene.__tested = true; });
    return;
  }
  await ev(page, () => { window.__engine.Engine.scene.__tested = true; });
  await gclick(page, 488 + 74, 360 - 34 + 13); await sleep(400); // LEAVE
}
async function centerOne(page) {
  const done = await ev(page, () => window.__engine.Engine.scene.done);
  if (!done) { await gclick(page, 250 + 85, 140 + 25); await sleep(500); return; } // HEAL
  await gclick(page, 340 + 90, 170 + 15); await sleep(400); // CONTINUE
}
async function eventOne(page, tag, evSeen) {
  const st = await ev(page, () => { const sc = window.__engine.Engine.scene; return { id: sc.ev?.id, result: !!sc.result, choices: (sc.ev?.choices || []).map(c => !c.cond || c.cond(G.run)) }; });
  if (!evSeen.has(page)) { evSeen.set(page, st.id); }
  if (!st.result) {
    const i = Math.max(0, st.choices.indexOf(true));
    await gclick(page, 440, 196 + 13 + 32 * i); await sleep(500);
    return;
  }
  await gclick(page, 340 + 100, 290 + 14); await sleep(400); // CONTINUE
}
async function treasureOne(page) {
  const st = await ev(page, () => { const sc = window.__engine.Engine.scene; return { opened: !!sc.opened }; });
  if (!st.opened) { await gclick(page, 320, 234); await sleep(500); return; } // PICK IT UP
  await gclick(page, 320, 279); await sleep(400); // CONTINUE
}
// Every player finishes their own private screen (in seat order); checks the shared "?" event.
async function privatePhase(pages, tag, kind) {
  const active = pages.filter(p => !p.__gone);
  const evSeen = new Map();
  for (const [k, page] of active.entries()) {
    const deadline = Date.now() + 120000;
    for (;;) {
      if (Date.now() > deadline) throw new Error(`${tag}: ${page.__name} stuck in the private phase`);
      const s = await ev(page, () => { const E = window.__engine.Engine, sc = E.scene, g = window.__coop?.game; return { name: sc?.constructor?.name, ov: E.overlays.length, phase: g?.phase, done: g?.private?.done?.[window.__coop.mySlot], busy: !!sc?.busy }; });
      if (s.phase !== 'private' || s.done || s.name === 'CoopWaitScene') break;
      if (s.ov) { await answerOverlay(page, 1); continue; }
      if (s.busy) { await sleep(250); continue; }
      if (s.name === 'RewardScene') await rewardOne(page, tag);
      else if (s.name === 'ShopScene') await shopOne(page, tag);
      else if (s.name === 'CenterScene') await centerOne(page);
      else if (s.name === 'EventScene') await eventOne(page, tag, evSeen);
      else if (s.name === 'TreasureScene') await treasureOne(page);
      else await sleep(300);
    }
    if (k === 0 && active.length > 2 && !STATS.waitShot) { await sleep(400); if (await sceneOf(page) === 'CoopWaitScene') { STATS.waitShot = true; await shot(page, `${active.length}p_wait`); } }
  }
  if (kind === 'event') {
    const ids = active.map(p => evSeen.get(p) || null);
    STATS.events.push(`${tag}: ${ids.join('/')}`);
    check(`${tag}: all ${active.length} players got the same "?" event (${ids[0]})`, ids.every(x => x && x === ids[0]), JSON.stringify(ids));
  }
}

// ---- full act: real votes, battles and private screens from floor 1 to the act clear (and on into act 2) ----
// The parties get a level boost first (identically on every client, checksum history patched) so a run of real
// click battles reliably gets through the act; the encounters themselves are the normal co-op ones.
// Setup shortcuts that a REJOIN must survive: the patch is applied live on every client at the same seq, and
// stored in each tab's sessionStorage so a reloaded client re-applies it at that seq while it replays the log
// (session.js calls window.__coopTestHook after every applied action; unset outside these tests).
// This machine never loads the AudioWorklet, so the game synthesizes audio in a ScriptProcessor on the MAIN thread;
// with 3-4 game tabs plus balance jobs the tabs then starve (stack: onaudioprocess > processHQ). By default the
// playtest keeps the audio engine but stops it from rendering (awaited fanfares still settle on their 8 s timeout).
// AUDIO=1 keeps real audio processing (still muted).
const STUB_AUDIO = () => {
  const P = window.AudioContext && window.AudioContext.prototype;
  if (!P || !P.createScriptProcessor) return;
  const orig = P.createScriptProcessor;
  P.createScriptProcessor = function (...a) { const n = orig.apply(this, a); Object.defineProperty(n, 'onaudioprocess', { set() {}, get() { return null; }, configurable: true }); return n; };
};
const TEST_PATCH_INIT = () => {
  window.__src = (p) => new URL('src/' + p, location.href).href; // (an old client lives in dist/old/)
  window.addEventListener('load', () => {
    Promise.all([import(window.__src('game/pokemon.js')), import(window.__src('game/data.js')), import(window.__src('game/rng.js'))]).then(([pk, dt, rn]) => { window.__pk = pk; window.__dt = dt; window.__rng = rn; });
  });
  window.__coopApplyPatch = (g, pt) => {
    if (pt.kind === 'buff') {
      g.runs.forEach((run, pi) => {
        // (a team of three: two extra POKéMON with fixed uids, the same on every client)
        for (let i = run.party.length; i < (pt.size || 1); i++) {
          const m = window.__pk.makeMon(['PIDGEOTTO', 'NIDORINO', 'GEODUDE', 'ODDISH'][(pi + i) % 4], pt.level, { rng: new window.__rng.RNG('buff' + pi + ':' + i) });
          m.uid = 6e8 + pi * 100 + i;
          run.party.push(m);
        }
        for (const m of run.party) {
          if (m.level < pt.level) { m.level = pt.level; m.exp = window.__dt.expForLevel(window.__dt.D.species[m.species]?.growthRate, pt.level); }
          m.hp = window.__pk.maxHp(m); m.status = null;
        }
        if (!run.hasConsumable('REVIVE')) run.addConsumable('REVIVE');
      });
    }
  };
  window.__coopTestHook = (s, a) => {
    let list = [];
    try { list = JSON.parse(sessionStorage.getItem('coop4.patches') || '[]'); } catch {}
    for (const pt of list) if (pt.roomId === s.roomId && pt.seq === a.seq && s.game) window.__coopApplyPatch(s.game, pt);
  };
};
async function buffTeams(pages, level, size = 3) {
  const active = pages.filter(p => !p.__gone);
  for (const p of active) await until(p, () => window.__coop?.game?.phase === 'map', null, { label: 'map (buff)', timeout: 60000 });
  const top = Math.max(...await Promise.all(active.map(p => ev(p, () => window.__coop.lastSeq))));
  for (const p of active) await until(p, (n) => window.__coop.lastSeq >= n, top, { label: 'same seq' });
  const r = [];
  for (const p of active) r.push(await ev(p, ({ level, size }) => {
    const s = window.__coop, g = s.game;
    const pt = { kind: 'buff', level, size, roomId: s.roomId, seq: s.lastSeq };
    const list = JSON.parse(sessionStorage.getItem('coop4.patches') || '[]');
    list.push(pt);
    sessionStorage.setItem('coop4.patches', JSON.stringify(list));
    window.__coopApplyPatch(g, pt);
    s.ck.set(s.lastSeq, g.checksum() >>> 0);
    return g.checksum() >>> 0;
  }, { level, size }));
  check(`buff: every party (3 POKéMON) at Lv${level}+ on all ${active.length} clients (same checksum)`, r.every(x => x === r[0]));
}
const PREFER = ['event', 'mart', 'center', 'treasure', 'trainer', 'wild', 'rival', 'elite', 'legend', 'boss'];
async function playAct(pages, tag, { toAct = 1, voteShot = null } = {}) {
  console.log(`\n=== ${tag}: a whole act with real votes, battles and private screens ===`);
  watch(true, tag);
  let round = 0, reloadedMap = false, battleNo = 0, inNext = false, midReloaded = false;
  const startAct = await ev(pages[0], () => window.__coop.game.world.actIndex);
  for (let guard = 0; guard < 80; guard++) {
    const active = pages.filter(p => !p.__gone);
    // all clients on the same phase
    for (const p of active) await until(p, () => { const g = window.__coop?.game; return g && ['map', 'battle', 'private', 'over', 'victory'].includes(g.phase); }, null, { label: 'phase', timeout: 60000 });
    const g = await ev(active[0], () => { const g = window.__coop.game; return { phase: g.phase, act: g.world.actIndex, floor: g.world.floor, kind: g.private?.kind || null, ev: g.events.filter(e => e.t === 'actClear').length }; });
    if (g.phase === 'over' || g.phase === 'victory') { log(`${tag}: run ended (${g.phase}) at act ${g.act + 1} floor ${g.floor}`); break; }
    if (g.act >= startAct + toAct && g.phase === 'map' && inNext) break;
    if (g.phase === 'map') {
      for (const p of active) await until(p, () => window.__engine.Engine.scene?.constructor?.name === 'CoopMapScene', null, { label: 'map scene', timeout: 60000 });
      await sleep(500);
      // act clear: every player gets their own starter choice on the map
      for (const p of active) for (let j = 0; j < 4 && await ev(p, () => window.__engine.Engine.overlays.length); j++) await answerOverlay(p);
      if (g.act > startAct && !STATS[`clear${tag}`]) {
        STATS[`clear${tag}`] = true; STATS.actClears++;
        const picks = STATS.starterPicks.filter(x => active.some(p => x.startsWith(p.__name + ':')));
        check(`${tag}: act ${g.act} cleared, every player picked a new starter (${picks.slice(-active.length).join(', ')})`, active.every(p => STATS.starterPicks.some(x => x.startsWith(p.__name + ':'))));
      }
      if (g.act >= startAct + toAct) inNext = true; // one more node in the next act, then stop
      // one player reloads the tab on the map (REJOIN replays the log)
      if (!reloadedMap && round === 3) { reloadedMap = true; await reloadAndRejoin(active[Math.min(1, active.length - 1)], `${tag} on the map`); await agree(active, `${tag} after map reload`); }
      const reach = await ev(active[0], () => { const g = window.__coop.game; return g.reachable().map(id => ({ id, type: g.world.map.nodes[id].type })); });
      const want = PREFER.map(t => reach.find(r => r.type === t && (STATS.nodes[`${active.length}p:${t}`] || 0) < (t === 'event' ? 2 : 1))).find(Boolean) || PREFER.map(t => reach.find(r => r.type === t)).find(Boolean) || reach[0];
      const policy = round % 4 === 1 ? 'split' : round % 4 === 2 ? 'simul' : round % 4 === 3 && active.length !== 3 ? 'tie' : 'same';
      const lv = await voteRound(pages, `${tag} r${round}`, want.id, { split: policy === 'split', tie: policy === 'tie', simul: policy === 'simul', shotName: round === 1 ? voteShot : null });
      round++;
      const picked = await ev(active[0], (id) => window.__coop.game.world.map.nodes[id].type, lv.picked);
      STATS.nodes[`${active.length}p:${picked}`] = (STATS.nodes[`${active.length}p:${picked}`] || 0) + 1;
      if (lv.tie) STATS.ties++;
      continue;
    }
    if (g.phase === 'battle') {
      for (const p of active) await until(p, () => window.__engine.Engine.scene?.constructor?.name === 'CoopBattleScene', null, { label: 'battle scene', timeout: 30000 });
      const info = await ev(active[0], () => { const sc = window.__engine.Engine.scene, d = sc.duo; return { kind: sc.cfg.coopKind, title: sc.cfg.trainer?.title || null, foes: d.enemies.map(e => `${e.species}:L${e.level}:${e.maxHp}`) }; });
      battleNo++;
      const seen = await playBattle(pages, `${tag} b${battleNo}`, { races: active.length >= 2 && battleNo % 2 === 1, reload: battleNo % 2 === 0 && !midReloaded, midShot: battleNo === 1 ? `${active.length}p_act_battle` : null });
      if (seen.reloaded) midReloaded = true;
      const a = await agree(pages, `${tag} battle ${battleNo} (${info.kind})`);
      results.push({ tag: `${tag} b${battleNo}`, kind: info.kind, title: info.title, foes: info.foes, turns: seen.turns, end: seen.endMsg });
      continue;
    }
    if (g.phase === 'private') {
      await privatePhase(pages, `${tag} ${g.kind}@${g.floor}`, g.kind);
      for (const p of active) await until(p, () => window.__coop.game.phase !== 'private', null, { label: 'private phase over', timeout: 60000 });
      await agree(pages, `${tag} after ${g.kind}`);
      continue;
    }
  }
  watch(false);
}

// ---- scenarios ---------------------------------------------------------------------------------------
async function firstFloorBattle(pages, tag) {
  console.log(`\n=== ${tag}: first floor (votes + a real battle) ===`);
  watch(true, tag);
  const reach = await ev(pages[0], () => { const g = window.__coop.game; return g.reachable().map(id => ({ id, type: g.world.map.nodes[id].type })); });
  const want = (reach.find(r => r.type === 'trainer') || reach.find(r => r.type === 'wild') || reach[0]).id;
  log('reachable', JSON.stringify(reach));
  const lv = await voteRound(pages, tag, want, { split: true, shotName: `${tag}_map_votes` });
  const phase = await ev(pages[0], () => window.__coop.game.phase);
  if (phase === 'battle') {
    for (const p of pages) await until(p, () => window.__engine.Engine.scene?.constructor?.name === 'CoopBattleScene', null, { label: 'battle scene', timeout: 30000 });
    const info = await ev(pages[0], () => { const sc = window.__engine.Engine.scene, d = sc.duo; return { kind: sc.cfg.kind, foes: d.enemies.map(e => `${e.species}:L${e.level}:${e.maxHp}`), queues: d.queues.map(q => q.length) }; });
    log('battle', JSON.stringify(info));
    const seen = await playBattle(pages, tag, { midShot: `${tag}_battle` });
    log(`${tag}: ${seen.turns} hands, max ${seen.maxIntents} intents on screen, end "${seen.endMsg}"`);
    const a = await agree(pages, tag);
    results.push({ tag, kind: info.kind, foes: info.foes, turns: seen.turns, end: seen.endMsg, vote: lv });
    if (a.phase === 'private') await rewards(pages, tag, { shotName: `${tag}_rewards` });
  } else { log(`${tag}: picked a ${phase} node`); await leavePrivate(pages); }
  for (const p of pages) await until(p, () => window.__coop.game.phase === 'map' || window.__coop.game.phase === 'over', null, { label: 'back on the map', timeout: 60000 });
  await agree(pages, tag + ' after rewards');
  watch(false);
}
async function setBattle(pages, { tag, act, type, outcome, foeFrac = 0.12, party, size, revive = false }) {
  console.log(`\n=== ${tag}: ${type} in act ${act + 1}, to a ${outcome.toUpperCase()} ===`);
  const node = await placeBefore(pages, { act, type, party: party || (outcome === 'win' ? 'strong' : 'weak'), size: size || (outcome === 'win' ? 2 : 3), revive });
  watch(true, tag);
  pages.forEach(p => { p.__wd = null; });
  await voteRound(pages, tag, node.id, { split: false });
  const active = pages.filter(p => !p.__gone);
  for (const p of active) await until(p, () => window.__engine.Engine.scene?.constructor?.name === 'CoopBattleScene', null, { label: `${tag} battle scene`, timeout: 30000 });
  const info = await ev(active[0], () => { const sc = window.__engine.Engine.scene, d = sc.duo; return { kind: sc.cfg.kind, coopKind: sc.cfg.coopKind, title: sc.cfg.trainer?.title || sc.cfg.legend || null, foes: d.enemies.map(e => `${e.species}:L${e.level}:${e.maxHp}`), away: d.away }; });
  log('battle', JSON.stringify(info));
  await sleep(1200);
  await shot(active[0], `${tag}_intro`);
  if (outcome === 'win') await weakenFoes(pages, foeFrac);
  const seen = await playBattle(pages, tag, { midShot: outcome === 'loss' ? `${tag}_mid` : null, revive });
  log(`${tag}: ${seen.turns} hands, end "${seen.endMsg}"`);
  for (const p of active) log(`${p.__name} move animations: ${await ev(p, () => JSON.stringify(window.__animLog || []))}`);
  const a = await agree(pages, tag);
  results.push({ tag, kind: info.coopKind, title: info.title, foes: info.foes, turns: seen.turns, end: seen.endMsg });
  if (outcome === 'win') {
    check(`${tag}: won -> rewards`, a.phase === 'private', `(${a.phase})`);
    if (a.phase === 'private') await rewards(pages, tag, { shotName: `${tag}_rewards` });
    for (const p of active) await until(p, () => window.__coop.game.phase === 'map', null, { label: `${tag}: back on the map`, timeout: 60000 });
    await agree(pages, tag + ' after rewards');
  } else {
    check(`${tag}: lost -> game over`, a.phase === 'over', `(${a.phase})`);
    for (const p of active) await until(p, () => window.__engine.Engine.scene?.constructor?.name === 'CoopEndScene', null, { label: `${tag}: end screen`, timeout: 30000 });
    await sleep(800);
    await shot(active[active.length - 1], `${tag}_gameover`);
  }
  watch(false);
}
// A player drops (quits to title = no heartbeat); after 20 s the others see OFFLINE and click CARRY ON;
// the others vote and play the next node without them; then the player REJOINs from the lobby and is back in.
// (Runs before any test setup shortcut: a rejoining client replays the whole log, which doesn't contain them.)
async function sitOut(pages, tag) {
  console.log(`\n=== ${tag}: a player drops out, the others carry on, then they rejoin ===`);
  const gone = pages[pages.length - 1];
  const roomId = await ev(gone, () => window.__coop.roomId);
  await ev(gone, () => window.__coop.stop({ toTitle: true }));
  gone.__gone = true;
  const host = pages[0];
  await until(host, (slot) => !window.__coop.isOnline(slot), pages.length - 1, { label: 'drop seen as offline', timeout: 40000 });
  await sleep(300);
  await shot(host, `${tag}_offline_banner`);
  await gclick(host, 640 - 104 + 49, 28 + 8); // CARRY ON
  for (const p of pages.filter(x => !x.__gone)) await until(p, (slot) => window.__coop.game.away[slot], pages.length - 1, { label: 'player sat out', timeout: 15000 });
  check(`${tag}: CARRY ON sat the offline player out`, true);
  watch(true, tag);
  const active = pages.filter(p => !p.__gone);
  const reach = await ev(host, () => { const g = window.__coop.game; return g.reachable().map(id => ({ id, type: g.world.map.nodes[id].type })); });
  const pick = (reach.find(r => !['wild', 'trainer', 'elite', 'rival', 'legend', 'boss'].includes(r.type)) || reach.find(r => r.type === 'wild') || reach[0]);
  log(`${tag}: ${active.length} players go on to a ${pick.type} node`);
  await voteRound(pages, tag, pick.id, { split: false });
  const ph = await ev(host, () => window.__coop.game.phase);
  if (ph === 'battle') {
    for (const p of active) await until(p, () => window.__engine.Engine.scene?.constructor?.name === 'CoopBattleScene', null, { label: 'battle scene', timeout: 30000 });
    const d = await ev(host, () => ({ away: window.__coop.game.battle.away, n: window.__coop.game.battle.activeCount(), foes: window.__coop.game.battle.enemies.map(e => `${e.species}:${e.maxHp}`) }));
    check(`${tag}: the battle runs without the sat-out player (away ${JSON.stringify(d.away)}, scaled for ${d.n})`, d.away[pages.length - 1] === true && d.n === pages.length - 1, JSON.stringify(d.foes));
    await sleep(800); await shot(host, `${tag}_battle`);
    const seen = await playBattle(pages, tag);
    log(`${tag}: ${seen.turns} hands, end "${seen.endMsg}"`);
    const a = await agree(pages, tag);
    if (a.phase === 'private') await rewards(pages, tag);
  } else if (ph === 'private') {
    const done = await ev(host, () => window.__coop.game.private.done);
    check(`${tag}: the sat-out player is done at once in the private phase`, done[pages.length - 1] === true, JSON.stringify(done));
    await leavePrivate(pages);
  }
  for (const p of active) await until(p, () => ['map', 'over'].includes(window.__coop.game.phase), null, { label: 'map again', timeout: 60000 });
  watch(false);
  // rejoin from the lobby's REJOIN list
  await ev(gone, async (id) => { const m = await import(window.__src('scenes/coop/lobby.js')); window.__engine.setScene(new m.CoopLobbyScene({ roomId: id })); }, roomId);
  gone.__gone = false;
  await until(gone, () => window.__coop?.synced && ['CoopMapScene', 'CoopEndScene'].includes(window.__engine.Engine.scene?.constructor?.name), null, { label: 'rejoined', timeout: 60000 });
  if (await ev(host, () => window.__coop.game.phase) === 'over') { log(`${tag}: the others lost meanwhile: the rejoining player lands on the end screen`); return; }
  for (const p of pages) await until(p, (slot) => !window.__coop.game.away[slot], pages.length - 1, { label: 'back in the game', timeout: 20000 });
  check(`${tag}: the dropped player rejoined and is back in`, true);
  await agree(pages, tag + ' after rejoin');
}

// ---- main --------------------------------------------------------------------------------------------
(async () => {
  const server = spawn(process.execPath, [path.join(ROOT, 'serve.cjs'), String(PORT), ...(REAL ? ['dist'] : [])], { cwd: ROOT, stdio: 'ignore' });
  const tokens = [];
  if (REAL) {
    ['THIRD', 'FOURTH'].forEach((n, i) => A.ensureTestUser(ACCOUNTS[i + 2], n));
    A.ensureTestUser(A.P2_EMAIL, A.P2_NAME);
    for (const e of ACCOUNTS) tokens.push(await A.mintToken(e, '180m'));
  }
  await sleep(700);
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'] });
  startWatchdog();
  try {
    for (const N of PLAYERS) {
      const ctxs = [];
      const newCtx = async (i) => {
        const c = await browser.newContext({ viewport: { width: 1280, height: 720 } });
        await c.addInitScript(TEST_PATCH_INIT);
        if (!process.env.AUDIO) await c.addInitScript(STUB_AUDIO);
        if (REAL) await c.addInitScript(t => localStorage.setItem('kantospire.auth.v1', JSON.stringify({ token: t, refreshToken: 'e2e' })), tokens[i]);
        await require('./pack_cache.cjs').routePacks(c); // (asset packs from the shared test cache, not Convex egress)
        ctxs.push(c);
        return c;
      };
      const ctx = REAL ? null : await newCtx(0);
      const pages = [];
      for (let i = 0; i < N; i++) {
        const p = await (REAL ? await newCtx(i) : ctx).newPage(); await attachDebugger(p); p.__name = `P${i + 1}`;
        p.__url = REAL ? `${BASE}${OLD.includes(i + 1) ? 'old/' : ''}` : `${BASE}?coopdev=${NAMES[i]}`; pages.push(p);
        p.on('pageerror', e => { errors.push(`${N}p ${p.__name} pageerror: ${e.message}`); console.log(`  ! ${p.__name} pageerror: ${e.message}`); });
        p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) { errors.push(`${N}p ${p.__name} console.error: ${m.text()}`); console.log(`  ! ${p.__name} console.error: ${m.text()}`); } });
      }
      WD.pages = pages;
      const tag = `${N}p`;
      const starters = ['CHARMANDER', 'SQUIRTLE', 'BULBASAUR', 'CHARMANDER'].slice(0, N);
      const step = async (name, fn) => { if (ONLY ? !ONLY.includes(name) : !DEFAULT_STEPS.includes(name)) return; try { await fn(); } catch (e) { watch(false); check(`${tag} ${name} crashed: ${(e.stack || e.message).split('\n').slice(0, 2).join(' ')}`, false); for (const p of pages) await dump(p); e.__logged = true; throw e; } };
      try {
        await pages[0].goto(BASE, { waitUntil: 'load' });
        if (!REAL) await ev(pages[0], () => { localStorage.clear(); sessionStorage.clear(); });
        for (const p of pages) await boot(p);
        await makeRoom(pages, starters, tag);
        // (a lost battle ends the run: the next scenario gets a fresh room)
        let room = 1;
        const fresh = async () => {
          const over = await ev(pages[0], () => window.__coop?.game?.phase === 'over' || !window.__coop);
          if (!over) return;
          log(`run over: new room for the next scenario`);
          for (const p of pages) { p.__gone = false; await boot(p); }
          await makeRoom(pages, starters, `${tag}_room${++room}`);
        };
        await step('act', async () => { await buffTeams(pages, ACT_LVL); await playAct(pages, `${tag}_act`, { toAct: 1, voteShot: `${tag}_map_votes` }); });
        await fresh();
        await step('first', () => firstFloorBattle(pages, `${tag}_first`));
        await fresh();
        if (N > 2) { await step('sitout', () => sitOut(pages, `${tag}_sitout`)); await fresh(); }
        await step('elite', () => setBattle(pages, { tag: `${tag}_elite`, act: 0, type: 'elite', outcome: 'win', foeFrac: 0.15 }));
        await step('bird', () => setBattle(pages, { tag: `${tag}_bird`, act: 1, type: 'legend', outcome: 'win', foeFrac: 0.3, party: Array.from({ length: N }, (_, i) => (i === N - 1 ? 'weak' : 'strong')), size: 3, revive: true }));
        await step('loss', () => setBattle(pages, { tag: `${tag}_loss`, act: 2, type: 'rival', outcome: 'loss' }));
      } catch (e) { if (!e.__logged) check(tag + ' setup crashed: ' + (e.stack || e.message).split('\n').slice(0, 3).join(' '), false); }
      for (const c of ctxs) await c.close().catch(() => {});
    }
  } catch (e) {
    check('playtest crashed: ' + (e.stack || e.message).split('\n').slice(0, 3).join(' '), false);
  } finally {
    clearInterval(WD.timer);
    if (REAL) { try { console.log('dev cleanup:', JSON.stringify(A.cleanup(ACCOUNTS.slice(1)))); } catch (e) { console.log('dev cleanup failed: ' + e.message); } }
    await timeout(browser.close(), 15000, 'browser.close').catch(() => {});
    server.kill();
  }
  console.log('\n==== SUMMARY ====');
  for (const r of results) console.log(`${r.tag}: ${r.kind}${r.title ? ' ' + r.title : ''} [${r.foes.join(', ')}] ${r.turns} hands, end "${r.end}"${r.vote ? `, votes ${JSON.stringify(r.vote.votes)} -> ${r.vote.picked}${r.vote.tie ? ' (tie)' : ''}` : ''}`);
  console.log('COVERAGE:', JSON.stringify(STATS, null, 1));
  console.log(freezes.length ? `FREEZES (${freezes.length}):\n` + freezes.map(f => `  ${f.kind || 'FREEZE'} ${f.scenario} ${f.page}: ${JSON.stringify(f.sig || '')}`).join('\n') : 'no freezes');
  console.log(errors.length ? `PAGE ERRORS (${errors.length}):\n  ` + errors.join('\n  ') : 'no page errors');
  console.log(fails.length ? `FAILED: ${fails.join(' | ')}` : 'all checks passed');
  process.exit(fails.length + freezes.length + errors.length ? 1 : 0);
})();
