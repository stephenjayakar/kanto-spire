// Co-op freeze audit: two players (two pages of ONE muted Chrome context, ?coopdev mock backend in
// localStorage) play duo battles against the v0.0.6 rival (BLUE / MAY) and the legendary bird node, to a WIN
// (incl. the bird's reward + one-time catch prompt) and to a LOSS, with sound initialised (canvas clicked).
// v0.0.7: also "?" events (the shared pick, battle choices hidden, private picks synced back) and the Center CLEANSE.
// Setup goes through page.evaluate (route the shared world next to the rival/bird node, identically on both
// clients, checksum history patched so the lockstep check still agrees); the battles themselves run through
// the real co-op scenes and the real action log, driven with mouse clicks (foes, cards, LOCK IN / PASS,
// messages, pickers, reward rows, the catch prompt).
// A watchdog samples a progress signature per page every second and flags a FREEZE when a page makes no
// progress for 20 s while it isn't waiting on its partner or on an open choice (and DEADLOCK when both wait).
//   node tests/coop_freeze_audit.cjs [port=8143]      (offline build: serves web/ itself; needs no web/cloud.json)
//   ONLY=rival_win,selftest node tests/coop_freeze_audit.cjs     (a subset)
// Screenshots: tests/out/visfix/coop_*.png
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const PORT = +(process.argv[2] || 8143);
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'tests/out/visfix');
const BASE = `http://localhost:${PORT}/`;
const FREEZE_MS = 20000;
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log('  ·', ...a);
const fails = [];
const check = (label, ok, extra = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${extra ? ' ' + extra : ''}`); if (!ok) fails.push(label); return ok; };
const errors = [], warnings = [], freezes = [], choiceStalls = [];

// ---- page helpers -----------------------------------------------------------------------------
// Where a hung page's main thread is stuck: pause it through the inspector and print the JS stack.
// (The Debugger domain is enabled when the page is created: enabling it needs the main thread, pausing doesn't.)
async function attachDebugger(page) { page.__cdp = await page.context().newCDPSession(page); await page.__cdp.send('Debugger.enable'); }
async function stackOf(page) {
  try {
    const cdp = page.__cdp;
    if (!cdp) return ['(no debugger session)'];
    const paused = new Promise(res => cdp.once('Debugger.paused', res));
    await cdp.send('Debugger.pause');
    const ev = await timeout(paused, 5000, 'Debugger.paused');
    const frames = ev.callFrames.slice(0, 12).map(fr => `${fr.functionName || '(anon)'} ${fr.url.replace(/^.*\/src\//, 'src/')}:${fr.location.lineNumber + 1}`);
    await cdp.send('Debugger.resume').catch(() => {});
    return frames;
  } catch (e) { return ['(no stack: ' + e.message + ')']; }
}
async function gclick(page, x, y) {
  await timeout(gclick0(page, x, y), 20000, `${page.__name} click at ${x},${y} (main thread hung?)`);
}
async function gclick0(page, x, y) {
  await page.bringToFront();
  const r = await ev(page, () => { const b = document.getElementById('game').getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; });
  await page.mouse.move(r.x + x * r.w / 640, r.y + y * r.h / 360);
  await sleep(40);
  await page.mouse.down();
  await sleep(40);
  await page.mouse.up();
  await sleep(90);
}
// Every evaluate has a deadline: a page whose main thread hangs must fail the audit, not hang it.
const timeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`no answer within ${ms / 1000} s: ${what}`)), ms))]);
const ev = (page, fn, arg) => timeout(page.evaluate(fn, arg), 30000, `${page.__name} evaluate (main thread hung?)`);
const sceneOf = (page) => ev(page, () => window.__engine?.Engine.scene?.constructor?.name || null);
async function until(page, fn, arg, { timeout = 30000, label = 'condition' } = {}) {
  try { await page.waitForFunction(fn, arg, { timeout, polling: 150 }); return true; }
  catch (e) { console.log(`  ! timeout waiting for ${label} on ${page.__name}`); await dump(page); throw new Error(`timeout: ${label} (${page.__name})`); }
}
async function dump(page) {
  const st = await ev(page, () => {
    const s = window.__coop, g = s?.game, E = window.__engine?.Engine, sc = E?.scene;
    return { scene: sc?.constructor?.name, overlays: E?.overlays.map(o => o.constructor.name + ':' + (o.title || '')), seq: s?.lastSeq, phase: g?.phase, routeKey: s?.routeKey, synced: s?.synced, desync: s?.desync,
      battle: g?.battle ? { turn: g.battle.turn, locks: g.battle.locks, down: g.battle.down, result: g.battle.result, field: g.battle.field, hp: g.battle.enemies.map(e => e.hp) } : null,
      busy: sc?.busy, running: sc?.running, q: sc?.q?.length, canAct: sc?.canAct?.(), posting: sc?.posting, finishing: sc?.finishing, released: sc?.released, msg: sc?.msg?.cur?.str || null, private: g?.private };
  }).catch(e => ({ err: e.message }));
  console.log(`  ${page.__name} state:`, JSON.stringify(st));
  return st;
}
const shot = async (page, name) => { await page.mouse.move(2, 2); await sleep(120); await page.screenshot({ path: path.join(OUT, `coop_${name}.png`) }); log('shot', `coop_${name}.png`, `(${page.__name})`); };
const closeAllOverlays = (page) => ev(page, () => { const E = window.__engine.Engine; for (const o of E.overlays.slice().reverse()) o.close ? o.close(null) : E.overlays.pop(); });

// ---- watchdog ---------------------------------------------------------------------------------------
// Signature of everything that moves while a page makes progress (no clocks). exempt: why a page may
// legitimately sit still ('partner' = waiting for the other player, 'choice' = an open overlay, 'end').
const SIG = () => {
  const E = window.__engine?.Engine, sc = E?.scene, s = window.__coop, g = s?.game;
  const name = sc?.constructor?.name || null;
  const sig = { name, ov: (E?.overlays || []).map(o => o.constructor.name + ':' + (o.title || '')), seq: s?.lastSeq ?? null, phase: g?.phase ?? null };
  let exempt = null;
  if (name === 'CoopBattleScene' && sc.duo) {
    const me = s.mySlot, pa = 1 - me, d = sc.duo;
    Object.assign(sig, {
      busy: sc.busy, running: sc.running, q: sc.q?.length, posting: !!sc.posting, finishing: !!sc.finishing, released: !!sc.released,
      msg: sc.msg?.cur ? sc.msg.cur.str.slice(0, Math.floor(sc.msg.shown)) + (sc.msg.queue.length ? '+' + sc.msg.queue.length : '') : null,
      hand: sc.handIds?.length, sel: sc.sel?.length,
      foes: sc.foes.map(f => (f ? [f.ri, Math.round(f.hp), Math.round(f.x || 0), +(f.faint || 0).toFixed(1)] : null)),
      leads: [0, 1].map(p => { const l = sc.leads[p]; return l ? [l.uid, Math.round(sc.partyHp[p]?.[l.uid] ?? -1), +(l.faint || 0).toFixed(1), Math.round(l.x || 0)] : null; }),
      engHp: d.enemies.map(e => e.hp), turn: d.turn, locks: d.locks.map(Boolean), down: d.down.slice(), result: d.result?.outcome || null, canAct: sc.canAct(),
    });
    if (!sc.busy && !sc.posting && !d.result && ((d.locks[me] && !d.locks[pa]) || (d.down[me] && !d.down[pa]))) exempt = 'partner';
  } else if (name === 'CoopWaitScene') {
    sig.done = g?.private?.done || null;
    if (g?.phase === 'private' && !g.private?.done?.[1 - s.mySlot]) exempt = 'partner';
  } else if (name === 'RewardScene') {
    sig.busy = sc.busy; sig.rew = (sc.rewards || []).map(r => (r.claimed ? 1 : 0)).join(''); sig.exp = sc.expAnim;
  } else if (name === 'CoopEndScene') exempt = 'end';
  else if (name === 'CoopMapScene') {
    sig.votes = g?.votes; sig.pending = s?.pendingVote ?? null;
    exempt = g?.votes?.[s.mySlot] != null && g?.votes?.[1 - s.mySlot] == null ? 'partner' : 'map';
  }
  if (sig.ov.length) exempt = 'choice';
  return { sig, exempt };
};
const WD = { active: false, scenario: '', ticking: false, timer: null };
function startWatchdog(pages) {
  WD.timer = setInterval(async () => {
    if (!WD.active || WD.ticking) return;
    WD.ticking = true;
    try {
      const now = Date.now();
      // (a page that doesn't answer within 5 s keeps the same "unresponsive" signature: a hung main thread is a freeze too)
      const res = await Promise.all(pages.map(p => timeout(p.evaluate(SIG), 5000, 'SIG').catch(e => ({ sig: { err: /no answer/.test(e.message) ? 'unresponsive' : e.message }, exempt: null }))));
      res.forEach((r, i) => {
        const p = pages[i], st = (p.__wd ||= { key: null, since: now, flagged: false });
        const key = JSON.stringify(r.sig);
        if (key !== st.key) { st.key = key; st.since = now; st.flagged = false; st.exempt = r.exempt; return; }
        st.exempt = r.exempt;
        const still = now - st.since;
        if (still < FREEZE_MS || st.flagged) return;
        if (r.exempt === 'choice') { st.flagged = true; choiceStalls.push({ scenario: WD.scenario, page: p.__name, sig: r.sig }); console.log(`  ! ${p.__name}: an open choice went unanswered for 20 s (script issue, not a freeze): ${r.sig.ov}`); return; }
        if (r.exempt === 'partner' || r.exempt === 'end' || r.exempt === 'map') return;
        st.flagged = true;
        freezes.push({ scenario: WD.scenario, page: p.__name, kind: 'FREEZE', sig: r.sig });
        console.log(`  !!! FREEZE on ${p.__name} (${WD.scenario}): no progress for ${(still / 1000).toFixed(0)} s:`, key);
        if (r.sig.err === 'unresponsive') stackOf(p).then(st => { freezes[freezes.length - 1].stack = st; console.log(`  ${p.__name} main thread stack:\n    ` + st.join('\n    ')); });
        else dump(p);
      });
      // both waiting on each other = a deadlock
      const w = pages.map(p => p.__wd);
      if (w.every(x => x && x.exempt === 'partner' && now - x.since > FREEZE_MS && !x.dead)) {
        w.forEach(x => { x.dead = true; });
        freezes.push({ scenario: WD.scenario, page: 'both', kind: 'DEADLOCK', sig: res.map(r => r.sig) });
        console.log(`  !!! DEADLOCK (${WD.scenario}): both pages wait on their partner for 20 s`);
        pages.forEach(p => dump(p));
      }
      w.forEach(x => { if (x && x.exempt !== 'partner') x.dead = false; });
    } finally { WD.ticking = false; }
  }, 1000);
}
function watch(on, scenario) { WD.active = on; if (scenario) WD.scenario = scenario; }

// ---- boot / lobby -------------------------------------------------------------------------------
async function boot(page) {
  await page.goto(page.__url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__ready && window.G?.meta && window.__engine?.Engine.scene, null, { timeout: 90000 });
  await ev(page, () => {
    Object.assign(G.meta, { tutorialDone: true, tipCatch: true, hintBattles: 9 });
    window.__engine.Engine.timeScale = 2; // faster animations (never saved)
  });
  await sleep(800);
  await closeAllOverlays(page);
  await sleep(150);
}
// One click on an empty spot of the canvas: the user gesture that unlocks audio.
const audioState = (page) => ev(page, async () => {
  const S = window.__sound, t0 = S.context?.currentTime ?? 0;
  await new Promise(r => setTimeout(r, 400));
  return { ready: S.ready, backend: S.backend, unlocked: S.unlocked, ctxState: S.context?.state || null, rendering: (S.context?.currentTime ?? 0) > t0, songs: S.songNames?.length || 0 };
});
async function unlockAudio(page) {
  const before = await audioState(page);
  await gclick(page, 600, 150);
  await sleep(300);
  await closeAllOverlays(page);
  return { before, after: await audioState(page) };
}
async function openCoop(page) {
  for (let i = 0; i < 4; i++) {
    if (await sceneOf(page) === 'CoopLobbyScene') break;
    await closeAllOverlays(page);
    const y = await ev(page, async () => ((await import('/src/game/state.js')).hasSavedRun() ? 290 : 262));
    await gclick(page, 116 + 160 + 6 + 48, y + 12);
    await sleep(700);
  }
  if (await sceneOf(page) !== 'CoopLobbyScene') { log(page.__name, 'CO-OP button click missed: opening the lobby directly'); await ev(page, async () => { const m = await import('/src/scenes/coop/lobby.js'); window.__engine.setScene(new m.CoopLobbyScene()); }); }
  await until(page, () => window.__engine.Engine.scene?.constructor?.name === 'CoopLobbyScene' && !!window.__engine.Engine.scene.net, null, { label: 'lobby' });
}
async function pickStarter(page, species) {
  const pos = await ev(page, async (sp) => {
    const sc = window.__engine.Engine.scene, v = sc.view;
    const { availableStarters } = await import('/src/game/unlocks.js');
    const { D } = await import('/src/game/data.js');
    const list = availableStarters(G.meta, v.room.world || 'kanto', s => !!D.species[s]);
    const i = list.indexOf(sp);
    if (i < 0) return null;
    const big = list.length <= 6, tw = big ? 62 : 46, th = big ? 74 : 46, gap = big ? 4 : 3, per = big ? 6 : 8;
    return [232 + (i % per) * (tw + gap) + tw / 2, 78 + Math.floor(i / per) * (th + 3) + th / 2];
  }, species);
  if (pos) await gclick(page, ...pos);
  const ok = await page.waitForFunction((sp) => window.__engine.Engine.scene.view?.members?.find(m => m.slot === window.__engine.Engine.scene.view.me)?.starter === sp, species, { timeout: 8000, polling: 150 }).then(() => true).catch(() => false);
  if (!ok) { log(page.__name, `starter tile click missed (${species}): setting it directly`); await ev(page, (sp) => { const sc = window.__engine.Engine.scene; return sc.act(net => net.setStarter(sc.roomId, sp)).then(() => sc.poll()); }, species); }
}
// Host creates, guest joins by code, both pick starters, host starts: both end on the co-op map.
// (v0.1.0 One Spire: rooms are 'spire_kanto' (a host without a win: every act in KANTO) or 'spire' (KANTO + HOENN acts))
async function makeRoom(pages, { world = 'spire_kanto', starters = ['CHARMANDER', 'SQUIRTLE'] } = {}) {
  const [p1, p2] = pages;
  for (const p of pages) await openCoop(p);
  await gclick(p1, 170, 107); // CREATE ROOM
  await until(p1, () => { const sc = window.__engine.Engine.scene; return sc.mode === 'room' && sc.view?.room?.code; }, null, { label: 'room created' });
  const code = await ev(p1, () => window.__engine.Engine.scene.view.room.code);
  await gclick(p2, 170, 191); // JOIN ROOM
  await until(p2, () => window.__engine.Engine.scene.mode === 'join', null, { label: 'join mode' });
  await p2.keyboard.type(code, { delay: 60 });
  await gclick(p2, 390, 225); // JOIN
  await until(p2, () => { const sc = window.__engine.Engine.scene; return sc.mode === 'room' && sc.view?.members?.length === 2; }, null, { label: 'P2 in room' });
  if (world !== 'spire_kanto') {
    // (host's world button; HOENN may be locked in this browser's meta, then configure directly)
    await ev(p1, (w) => { const sc = window.__engine.Engine.scene; return sc.config({ world: w }); }, world);
    await until(p1, (w) => window.__engine.Engine.scene.view?.room?.world === w, world, { label: 'world set' });
    await until(p2, (w) => window.__engine.Engine.scene.view?.room?.world === w, world, { label: 'P2 sees world', timeout: 15000 });
  }
  await pickStarter(p1, starters[0]);
  await pickStarter(p2, starters[1]);
  await until(p1, () => { const v = window.__engine.Engine.scene.view; return v?.members?.length === 2 && v.members.every(m => m.starter); }, null, { label: 'both starters', timeout: 20000 });
  await gclick(p1, 566, 305); // START
  for (const p of pages) await until(p, () => window.__coop?.synced && window.__engine.Engine.scene?.constructor?.name === 'CoopMapScene', null, { label: 'map after start', timeout: 60000 });
  log(`room ${code} (${world}) started: ${starters.join(' + ')}`);
  return code;
}

// ---- setup: put the shared run right before a node ------------------------------------------------
// Applied identically on both clients at the same seq; the checksum history is patched at that seq so the
// next action's desync check (sender's checksum vs ours at atSeq) compares like with like.
// party: 'strong' | 'weak' or one per player; strong = levelled up with full HP and EXP one point short of the
// next level (so the reward screen's level-up fanfare / move prompts run), weak = 1 HP. size: party size
// (extra POKéMON get fixed uids, so both clients build the same ones).
async function placeBefore(pages, { act, type, party, size = 1, relics = null, money = null }) {
  for (const p of pages) await until(p, () => window.__coop?.game?.phase === 'map' && window.__engine.Engine.scene?.constructor?.name === 'CoopMapScene', null, { label: 'on the map', timeout: 60000 });
  for (const p of pages) await closeAllOverlays(p);
  const seqs = await Promise.all(pages.map(p => ev(p, () => window.__coop.lastSeq)));
  if (seqs[0] !== seqs[1]) await until(pages[seqs[0] < seqs[1] ? 0 : 1], (n) => window.__coop.lastSeq >= n, Math.max(...seqs), { label: 'same seq' });
  const res = [];
  for (const p of pages) {
    res.push(await ev(p, async ({ act, type, party, size, relics, money }) => {
      const { maxHp, makeMon } = await import('/src/game/pokemon.js');
      const { RNG } = await import('/src/game/rng.js');
      const { expForLevel, D } = await import('/src/game/data.js');
      const s = window.__coop, g = s.game, w = g.world;
      if (w.actIndex !== act) { w.startAct(act); for (const r of g.runs) r.startAct(act); }
      const t = Object.values(w.map.nodes).find(n => n.type === type);
      if (!t) return { err: `no ${type} node in act ${act}` };
      w.nodeId = t.prev?.[0] ?? null; w.floor = t.floor - 1;
      g.votes = [null, null];
      const base = w.levelFor(t.floor);
      g.runs.forEach((r, pi) => {
        const kind = Array.isArray(party) ? party[pi] : party;
        const lvl = base + (kind === 'strong' ? (type === 'legend' ? 14 : 4) : 0);
        for (let i = r.party.length; i < size; i++) {
          const m = makeMon(['PIDGEY', 'RATTATA', 'ODDISH', 'GEODUDE', 'ZUBAT'][i % 5], Math.max(5, base - 2), { rng: new RNG('audit' + pi + ':' + i) });
          m.uid = 7e8 + pi * 100 + i;
          r.party.push(m);
        }
        for (const m of r.party) {
          if (kind === 'strong' && m.level < lvl) m.level = lvl;
          if (kind === 'strong') m.exp = expForLevel(D.species[m.species]?.growthRate, m.level + 1) - 1;
          m.status = null;
          m.hp = kind === 'weak' ? 1 : maxHp(m);
        }
        for (const k of relics?.[pi] || []) if (!r.relics.some(x => x.key === k)) r.addRelic(k);
        if (money != null) r.money = money;
      });
      g.mirror();
      s.ck.set(s.lastSeq, g.checksum() >>> 0);
      s.route(true); // fresh map scene (scrolled to the new floor)
      return { id: t.id, floor: t.floor, legend: t.legend || w.act.bird || null, ck: g.checksum() >>> 0, act: w.actIndex, actName: w.act.name, party: g.runs.map(r => r.party.map(m => `${m.species}:${m.level}:${m.hp}`)) };
    }, { act, type, party, size, relics, money }));
  }
  if (res[0].err) throw new Error(res[0].err);
  check(`setup ${type} (act ${act + 1}): both clients agree before the vote`, res[0].ck === res[1].ck && res[0].id === res[1].id, `(node ${res[0].id}, checksum ${res[0].ck}/${res[1].ck})`);
  log('parties', JSON.stringify(res[0].party), res[0].legend ? 'legend ' + res[0].legend : '');
  await sleep(500);
  return res[0];
}
async function voteFor(page, id) {
  for (let i = 0; i < 3; i++) {
    const pos = await ev(page, (id) => { const sc = window.__engine.Engine.scene; const n = sc.s.game.world.map.nodes[id]; return sc.nodePos(n); }, id);
    await gclick(page, pos[0], pos[1] - 8);
    const ok = await page.waitForFunction((id) => { const s = window.__coop; return s.pendingVote === id || s.game.votes[s.mySlot] === id || s.game.phase !== 'map'; }, id, { timeout: 3000, polling: 100 }).then(() => true).catch(() => false);
    if (ok) return true;
    log(page.__name, `vote click on node ${id} missed (try ${i + 1})`);
  }
  await ev(page, (id) => window.__coop.vote(id), id);
  return false;
}

// ---- overlays (pickers / prompts), answered with clicks where the geometry is known ----------------------
async function overlayInfo(page) {
  return ev(page, async () => {
    const E = window.__engine.Engine, o = E.overlays[E.overlays.length - 1];
    if (!o) return null;
    const name = o.constructor.name, W = 640, H = 360;
    const out = { name, title: o.title || '', options: null };
    if (name === 'ChoiceModal') {
      const F = await import('/src/engine/font.js');
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
    else if (name === 'MoveReplaceModal') out.btn = [W / 2, (H - 220) / 2 + 220 - 34 + 12]; // "Don't learn X"
    else if (name === 'EvolutionModal') out.phase = o.phase;
    else if (!name || /toast/i.test(name)) out.toast = o.t > 0.3; // toastMsg (anonymous): any click after 0.25 s
    return out;
  });
}
// prefer: option index for a ChoiceModal (default: the first), 'switch' to send out a different mon.
async function answerOverlay(page, prefer = 0) {
  const o = await overlayInfo(page);
  if (!o) return null;
  if (o.name === 'ChoiceModal' && o.options?.length) {
    const op = o.options[Math.min(prefer, o.options.length - 1)];
    await gclick(page, op.x, op.y);
    await sleep(250);
    const still = await overlayInfo(page);
    if (still && still.name === o.name && still.title === o.title) { log(page.__name, `click on "${op.label}" missed: closing "${o.title}" directly`); await ev(page, (v) => { const E = window.__engine.Engine; E.overlays[E.overlays.length - 1].close(v); }, op.value ?? Math.min(prefer, o.options.length - 1)); }
    log(page.__name, `answered "${o.title}" -> ${op.label}`);
    return { title: o.title, answer: op.label };
  }
  if (o.name === 'PartyPicker' && o.mons) {
    const ok = o.mons.filter(m => m.ok);
    const m = ok.find(x => x.uid !== o.lead) || ok[0];
    if (m) {
      await gclick(page, m.x, m.y);
      await sleep(250);
      const still = await overlayInfo(page);
      if (still && still.name === o.name) await ev(page, (uid) => { const E = window.__engine.Engine; const ov = E.overlays[E.overlays.length - 1]; ov.close(G.run.party.find(x => x.uid === uid)); }, m.uid);
      log(page.__name, `answered "${o.title}" -> ${m.species}`);
      return { title: o.title, answer: m.species };
    }
  }
  if (o.name === 'EvolutionModal') { await sleep(400); return { title: 'evolution', answer: 'watched', wait: true }; } // plays by itself
  if (o.toast !== undefined || o.btn) {
    if (o.toast === false) { await sleep(300); return null; }
    await gclick(page, ...(o.btn || [320, 300]));
    await sleep(250);
    const still = await overlayInfo(page);
    if (still && still.name === o.name && (o.btn || still.toast !== undefined)) { await ev(page, (v) => { const E = window.__engine.Engine; E.overlays[E.overlays.length - 1].close(v); }, o.btn ? -1 : true); log(page.__name, `click on ${o.name || 'message'} missed: closed directly`); }
    log(page.__name, `answered ${o.name || 'message'} ${o.btn ? "(don't learn)" : '(clicked through)'}`);
    return { title: o.name || 'message', answer: 'clicked' };
  }
  if (o.name === 'RelicChoiceModal' && o.choices?.length) {
    await ev(page, (k) => { const E = window.__engine.Engine; E.overlays[E.overlays.length - 1].close(k); }, o.choices[0]);
    log(page.__name, `took held item ${o.choices[0]} (direct close)`);
    return { title: 'relic', answer: o.choices[0] };
  }
  await ev(page, () => { const E = window.__engine.Engine; const ov = E.overlays[E.overlays.length - 1]; ov.close ? ov.close(null) : E.overlays.pop(); });
  log(page.__name, `closed overlay ${o.name} "${o.title}"`);
  return { title: o.title, answer: null };
}

// ---- the duo battle, played with clicks ----------------------------------------------------------------
const FOE_HIT = [[160 + 250 + 64, 27 + 4 + 64], [160 + 350 + 64, 27 - 6 + 64]];
const LOCK_BTN = [640 - 150 + 36, 262 - 32 + 12], DISCARD_BTN = [640 - 74 + 35, 262 - 32 + 12], MSG_HIT = [160 + 4 + 146, 27 + 200 - 46 + 21];
async function battleState(page) {
  return ev(page, () => {
    const E = window.__engine.Engine, sc = E.scene, s = window.__coop, g = s?.game;
    const inBattle = sc?.constructor?.name === 'CoopBattleScene';
    if (!inBattle || !sc.duo) return { inBattle: false, phase: g?.phase, scene: sc?.constructor?.name };
    const d = sc.duo;
    return { inBattle, phase: g.phase, canAct: sc.canAct(), overlays: E.overlays.length, turn: d.turn, locked: !!d.locks[s.mySlot], down: d.down[s.mySlot], result: d.result?.outcome || null, stuck: !!sc.stuck, live: sc.liveSlots(), busy: sc.busy, msg: sc.msg?.cur?.str || null, seq: s.lastSeq };
  });
}
async function takeTurn(page) {
  const st = await battleState(page);
  if (st.stuck) { await gclick(page, ...LOCK_BTN); log(page.__name, `turn ${st.turn}: PASS (no playable cards)`); return 'pass'; }
  let slot = await ev(page, () => window.__engine.Engine.scene.target);
  if (st.live.length > 1) await gclick(page, ...FOE_HIT[slot]);
  let ids = await ev(page, () => window.__engine.Engine.scene.bestHand());
  if (!ids || !ids.length) ids = await ev(page, () => { const sc = window.__engine.Engine.scene; const c = sc.handIds.find(id => sc.info(sc.sub.deck.hand.find(x => x.id === id)).playable); return c ? [c] : []; });
  await ev(page, () => { window.__engine.Engine.scene.sel = []; });
  if (!ids.length) {
    // nothing playable that the scene calls stuck? discard one card if possible, else try LOCK/PASS
    const can = await ev(page, () => { const sc = window.__engine.Engine.scene; if (!sc.handIds.length || !sc.canDiscard(1)) return false; sc.sel = [sc.handIds[0]]; return true; });
    await gclick(page, ...(can ? DISCARD_BTN : LOCK_BTN));
    log(page.__name, `turn ${st.turn}: no playable hand -> ${can ? 'discard' : 'lock/pass'}`);
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
  if (sel.length !== ids.length) { log(page.__name, 'card click-select mismatch', JSON.stringify({ ids, sel }), '-> setting scene.sel'); await ev(page, (ids) => { window.__engine.Engine.scene.sel = ids.slice(); }, ids); }
  await gclick(page, ...LOCK_BTN);
  await page.waitForFunction(() => { const sc = window.__engine.Engine.scene; return sc?.constructor?.name !== 'CoopBattleScene' || !sc.posting; }, null, { timeout: 20000, polling: 100 }).catch(() => log(page.__name, 'lock still posting after 20 s'));
  log(page.__name, `turn ${st.turn}: locked ${ids.length} card(s) at slot ${slot}`);
  return 'lock';
}
// Lower every foe's HP (identically on both clients, both idle at the same seq) so the WIN stays short.
async function weakenFoes(pages, frac) {
  for (const p of pages) await until(p, () => { const sc = window.__engine.Engine.scene; return sc?.constructor?.name === 'CoopBattleScene' && sc.canAct(); }, null, { label: 'battle idle (weaken)', timeout: 60000 });
  const seqs = await Promise.all(pages.map(p => ev(p, () => window.__coop.lastSeq)));
  if (seqs[0] !== seqs[1]) return log('weakenFoes skipped: clients at different seqs', seqs);
  const r = [];
  for (const p of pages) r.push(await ev(p, (frac) => {
    const s = window.__coop, g = s.game, d = g.battle, sc = window.__engine.Engine.scene;
    for (const e of d.enemies) e.hp = Math.min(e.hp, Math.max(1, Math.ceil(e.maxHp * frac)));
    s.ck.set(s.lastSeq, g.checksum() >>> 0);
    sc._hint = {}; sc.reconcile();
    return g.checksum() >>> 0;
  }, frac));
  check(`foes weakened to ${Math.round(frac * 100)}% on both clients`, r[0] === r[1], `(checksum ${r[0]}/${r[1]})`);
}

// Input under a modal: P2 opens "Send out X?" (a paid switch from the party panel), P1 locks in meanwhile, then
// P2 clicks "Switch!". The partner's lock only queues animations on P2 (a scene doesn't update under a modal),
// it doesn't make the switch illegal, so the switch must still be sent (it used to be dropped silently).
async function modalCheck(pages, tag) {
  const [p1, p2] = pages;
  for (const p of pages) await until(p, () => window.__engine.Engine.scene?.canAct?.(), null, { label: 'both can act (modal check)', timeout: 60000 });
  const bench = await ev(p2, () => { const sc = window.__engine.Engine.scene, s = sc.sub, m = sc.run().party.find(x => x.uid !== s.leadUid && x.hp > 0); if (!m) return null; sc.askSwitch(m); return { uid: m.uid, species: m.species, lead: s.leadUid }; });
  if (!bench) return log(tag, 'modal check skipped: P2 has no bench POKéMON');
  await takeTurn(p1);
  const lockSeq = await ev(p1, () => window.__coop.lastSeq);
  await until(p2, (n) => window.__coop.lastSeq >= n, lockSeq, { label: "P2 applied P1's lock", timeout: 15000 });
  const busy = await ev(p2, () => window.__engine.Engine.scene.busy);
  const a = await answerOverlay(p2, 0);
  const sent = await p2.waitForFunction((uid) => window.__coop.log.some(x => x.p === window.__coop.mySlot && x.type === 'switch' && x.uid === uid), bench.uid, { timeout: 8000, polling: 100 }).then(() => true).catch(() => false);
  const lead = await ev(p2, () => window.__coop.game.battle?.subs[window.__coop.mySlot].leadUid);
  check(`${tag}: a switch confirmed in a modal while the partner's lock was landing is sent (P2 busy=${busy}, answered "${a?.answer}")`, sent && lead === bench.uid, `(${bench.species}; lead now ${lead === bench.uid ? bench.species : lead})`);
}

// Plays the current duo battle to the end on both clients. Returns what was seen.
async function playBattle(pages, tag, { midShot = true } = {}) {
  const deadline = Date.now() + 8 * 60 * 1000;
  const seen = { turns: 0, endMsg: null, msgs: new Set(), mid: !midShot, end: false, msgClicks: 0, answered: [] };
  const lastMsg = ['', ''];
  for (;;) {
    if (Date.now() > deadline) throw new Error(`${tag}: battle took longer than 8 min`);
    const st = await Promise.all(pages.map(battleState));
    if (!st[0].inBattle && !st[1].inBattle) break;
    for (let i = 0; i < 2; i++) {
      const page = pages[i], s = st[i];
      if (!s.inBattle) continue;
      if (s.msg) seen.msgs.add(s.msg);
      if (s.msg && /defeated|won the battle|blacked out|joins your team/.test(s.msg)) {
        seen.endMsg ||= s.msg;
        if (!seen.end && i === 0) { seen.end = true; await page.screenshot({ path: path.join(OUT, `coop_${tag}_end.png`) }); log("shot", `coop_${tag}_end.png`); }
      }
      if (s.overlays) { seen.answered.push(await answerOverlay(page)); continue; }
      if (s.canAct) { await takeTurn(page); seen.turns++; continue; }
      // click through a message that has been up since the last look
      if (s.msg && s.msg === lastMsg[i]) { await gclick(page, ...MSG_HIT); seen.msgClicks++; }
      lastMsg[i] = s.msg || '';
    }
    if (!seen.mid && st[0].inBattle && st[0].turn >= 2 && st[0].busy) { seen.mid = true; await shot(pages[0], `${tag}_mid`); }
    await sleep(200);
  }
  seen.answered = seen.answered.filter(Boolean).map(a => `${a.title} -> ${a.answer}`);
  if (seen.answered.length) log(`${tag}: in-battle prompts answered:`, seen.answered.join(' | '));
  return seen;
}

// One scenario: route both players before the node, both vote for it with a click, play the duo battle.
async function scenario(pages, { tag, act, type, outcome, foeFrac = 0.1, expect, party, size, modal }) {
  const catchIt = type === 'legend';
  console.log(`\n=== ${tag}: ${type} in act ${act + 1}, play to a ${outcome.toUpperCase()} ===`);
  const t0 = Date.now();
  const node = await placeBefore(pages, { act, type, party: party || (outcome === 'win' ? 'strong' : 'weak'), size: size || (outcome === 'win' ? 1 : 3) });
  watch(true, tag);
  const t = Date.now(); pages.forEach(p => { p.__wd = null; });
  for (const p of pages) await voteFor(p, node.id);
  for (const p of pages) await until(p, () => window.__engine.Engine.scene?.constructor?.name === 'CoopBattleScene', null, { label: `${tag} battle scene`, timeout: 30000 });
  const info = await ev(pages[0], () => {
    const sc = window.__engine.Engine.scene, cfg = sc.cfg, d = sc.duo;
    return { kind: cfg.kind, coopKind: cfg.coopKind, rival: !!cfg.rival, legendNode: cfg.legendNode || null, trainer: cfg.trainer?.name || null, title: cfg.trainer?.title || cfg.legend || null, music: cfg.music, encounterSong: cfg.trainer?.encounterSong || null, intro: cfg.intro || null,
      foes: d.enemies.map(e => `${e.species}:L${e.level}:${e.hp}/${e.maxHp}`), slots: cfg.slots, catchOffer: cfg.catchOffer || null };
  });
  log('battle', JSON.stringify(info));
  if (expect) check(`${tag}: the foe is ${expect}`, JSON.stringify(info).includes(expect));
  await sleep(1300);
  await shot(pages[0], `${tag}_intro`);
  const bgm = await ev(pages[0], () => window.__sound.currentBGM);
  log('BGM during the intro:', bgm);
  if (outcome === 'win') await weakenFoes(pages, foeFrac);
  if (modal) await modalCheck(pages, tag);
  const seen = await playBattle(pages, tag);
  log(`${tag}: battle over after ${seen.turns} hand(s), ${seen.msgClicks} message click(s); end message: ${seen.endMsg}`);
  if (seen.msgs.size) log('messages seen:', [...seen.msgs].slice(0, 12).join(' | '));
  const si = await Promise.all(pages.map(p => ev(p, () => ({ seq: window.__coop.lastSeq, ck: window.__coop.game.checksum() >>> 0, phase: window.__coop.game.phase, desync: window.__coop.desync, scene: window.__engine.Engine.scene?.constructor?.name }))));
  check(`${tag}: both clients agree after the battle`, si[0].seq === si[1].seq && si[0].ck === si[1].ck && !si[0].desync && !si[1].desync, JSON.stringify(si));
  const res = { tag, info, bgm, turns: seen.turns, endMsg: seen.endMsg, catch: null, prompts: seen.answered };
  if (outcome === 'win') {
    check(`${tag}: battle won -> reward phase`, si[0].phase === 'private' && si[1].phase === 'private', `(${si[0].phase}/${si[1].phase})`);
    if (si[0].phase !== 'private') { watch(false); throw new Error(`${tag}: the WIN setup lost the battle (${si[0].phase})`); }
    res.catch = await rewards(pages, tag, { catchIt });
    for (const p of pages) await until(p, () => window.__engine.Engine.scene?.constructor?.name === 'CoopMapScene' && window.__coop.game.phase === 'map', null, { label: `${tag}: back on the map`, timeout: 60000 });
    check(`${tag}: both back on the map`, true);
  } else {
    check(`${tag}: battle lost -> game over`, si[0].phase === 'over' && si[1].phase === 'over', `(${si[0].phase}/${si[1].phase})`);
    for (const p of pages) await until(p, () => window.__engine.Engine.scene?.constructor?.name === 'CoopEndScene', null, { label: `${tag}: end screen`, timeout: 30000 });
    await sleep(600);
    await shot(pages[1], `${tag}_gameover`);
  }
  watch(false);
  res.secs = Math.round((Date.now() - t0) / 1000);
  log(`${tag} done in ${res.secs} s`);
  return res;
}

// The private reward screens: P1 catches the bird, P2 lets it go; everyone takes the held item and leaves.
async function rewards(pages, tag, { catchIt }) {
  const out = [];
  for (const p of pages) {
    const deadline = Date.now() + 120000;
    for (;;) { // level-up prompts etc. may come first
      if (Date.now() > deadline) throw new Error(`${tag}: reward screen never became ready on ${p.__name}`);
      const s = await ev(p, () => { const E = window.__engine.Engine, sc = E.scene; return { name: sc?.constructor?.name, busy: sc?.busy, ov: E.overlays.length }; });
      if (s.ov) { const a = await answerOverlay(p); if (a && !a.wait) log(p.__name, 'reward prompt:', a.title, '->', a.answer); continue; }
      if (s.name === 'RewardScene' && !s.busy) break;
      await sleep(250);
    }
  }
  for (const [i, p] of pages.entries()) {
    const list = await ev(p, () => window.__engine.Engine.scene.rewards.map(r => ({ kind: r.kind, label: r.label, claimed: !!r.claimed, choices: r.choices || null })));
    log(p.__name, 'rewards:', JSON.stringify(list.map(r => `${r.kind}:${r.label}${r.choices && r.kind === 'relic' ? '[' + r.choices.join(',') + ']' : ''}`)));
    const li = list.findIndex(r => r.kind === 'legend');
    if (catchIt) check(`${tag}: ${p.__name} is offered the one-time catch`, li >= 0);
    if (li >= 0) {
      await gclick(p, 450, 60 + li * 34 + 15);
      await p.waitForFunction(() => window.__engine.Engine.overlays.length > 0, null, { timeout: 5000, polling: 100 }).catch(() => {});
      const o = await overlayInfo(p);
      if (i === 0 && o) await shot(p, `${tag}_catch_prompt`);
      check(`${tag}: ${p.__name} clicking the legend row opens the catch prompt`, !!o && /^Catch /.test(o.title), o ? `("${o.title}")` : '');
      const a = await answerOverlay(p, i === 0 ? 0 : 1); // P1 catches, P2 lets it go
      for (let k = 0; k < 6 && await ev(p, () => window.__engine.Engine.overlays.length); k++) await answerOverlay(p); // party full -> release picker
      await sleep(600);
      const after = await ev(p, () => ({ party: G.run.party.map(m => m.species), caught: G.run.legendsCaught || [], label: window.__engine.Engine.scene.rewards.find(r => r.kind === 'legend')?.label }));
      log(p.__name, 'after the prompt:', JSON.stringify(after));
      out.push({ page: p.__name, answer: a?.answer, ...after });
      if (i === 0) await shot(p, `${tag}_caught`);
    }
    const ri = list.findIndex(r => r.kind === 'relic' && !r.claimed);
    if (ri >= 0) {
      await gclick(p, 450, 60 + ri * 34 + 15);
      await sleep(400);
      for (let k = 0; k < 4 && await ev(p, () => window.__engine.Engine.overlays.length); k++) await answerOverlay(p);
      await sleep(300);
    }
    const n = await ev(p, () => window.__engine.Engine.scene.rewards.length);
    await gclick(p, 450, 60 + n * 34 + 6 + 13); // CONTINUE / SKIP REST & CONTINUE
    await sleep(400);
    for (let k = 0; k < 4 && await ev(p, () => window.__engine.Engine.overlays.length); k++) await answerOverlay(p, 1); // "Leave rewards behind?" -> Skip them
    await until(p, () => ['CoopWaitScene', 'CoopMapScene'].includes(window.__engine.Engine.scene?.constructor?.name), null, { label: `${tag}: left the reward screen`, timeout: 20000 });
  }
  return out;
}

// ---- v0.0.7 "?" events in co-op: both players get the SAME event, battle (solo) choices are hidden, each player
// picks privately (real clicks on the choice buttons, pickers answered, CONTINUE), then both runs sync back. ----
async function eventView(page) {
  return ev(page, async () => {
    const sc = window.__engine.Engine.scene;
    if (sc?.constructor?.name !== 'EventScene') return null;
    const { choiceLabel } = await import('/src/game/events.js');
    const run = window.G.run;
    const list = (!sc.result || sc.steps) ? sc.choices() : [];
    const gap = Math.min(32, Math.floor(142 / Math.max(1, list.length))), bh = Math.min(26, gap - 4);
    return { id: sc.ev.id, busy: sc.busy, result: sc.result?.text || null, steps: !!sc.steps, coop: !!run.coop,
      choices: list.map((c, i) => ({ label: choiceLabel(c, run), solo: !!c.solo, ok: !c.cond || c.cond(run), x: 440, y: 192 + i * gap + bh / 2 })) };
  });
}
// Plays this page's private event: pick (regex) for the first choice, step (regex) for multi-step choices.
async function playEvent(page, pick, step = /Pick up another|^Leave/) {
  const did = [];
  for (let k = 0; k < 60; k++) {
    const name = await sceneOf(page);
    if (name !== 'EventScene') return { did, scene: name };
    if (await ev(page, () => window.__engine.Engine.overlays.length)) { const a = await answerOverlay(page); if (a) did.push(`${a.title} -> ${a.answer}`); continue; }
    const v = await eventView(page);
    if (!v || v.busy) { await sleep(250); continue; }
    if (v.choices.length) {
      const re = v.steps ? step : pick;
      const c = v.choices.find(x => x.ok && re.test(x.label)) || v.choices[v.choices.length - 1];
      await gclick(page, c.x, c.y);
      did.push(c.label);
      await sleep(450);
      continue;
    }
    await gclick(page, 440, 310); // CONTINUE
    did.push('CONTINUE');
    await sleep(600);
  }
  return { did, scene: await sceneOf(page) };
}
// Force a specific shared event on both clients (the private EventScene asks session.pickEvent).
const forceEvent = (pages, id) => Promise.all(pages.map(p => ev(p, async (id) => {
  const E = await import('/src/game/events.js');
  const s = window.__coop;
  if (!id) { delete s.pickEvent; return; }
  s.pickEvent = (run) => { const e = E.eventById(id); E.markSeen(run, e); return e; };
}, id)));
async function eventScenario(pages, { tag, act, force, picks, expect, relics }) {
  console.log(`\n=== ${tag}: "?" event in act ${act + 1}${force ? ' (' + force + ')' : ' (shared pick)'} ===`);
  const t0 = Date.now();
  const node = await placeBefore(pages, { act, type: 'event', party: 'strong', size: 2, relics });
  await forceEvent(pages, force || null);
  watch(true, tag);
  pages.forEach(p => { p.__wd = null; });
  for (const p of pages) await voteFor(p, node.id);
  for (const p of pages) await until(p, () => window.__engine.Engine.scene?.constructor?.name === 'EventScene', null, { label: `${tag} event scene`, timeout: 30000 });
  await sleep(700);
  const views = await Promise.all(pages.map(eventView));
  log(`${tag}: P1 sees ${views[0].id}: ${views[0].choices.map(c => c.label).join(' | ')}`);
  await shot(pages[0], `${tag}_event`);
  check(`${tag}: both players get the same event (${views[0].id})`, views[0].id === views[1].id, `(${views[0].id} / ${views[1].id})`);
  check(`${tag}: the private run is marked co-op`, views.every(v => v.coop));
  check(`${tag}: no battle (solo) choice is offered in co-op`, views.every(v => !v.choices.some(c => c.solo)), JSON.stringify(views.map(v => v.choices.filter(c => c.solo).map(c => c.label))));
  if (expect) check(`${tag}: ${expect.label}`, expect.fn(views[0]), JSON.stringify(views[0].choices.map(c => c.label)));
  const played = [];
  for (const [i, p] of pages.entries()) {
    const r = await playEvent(p, picks[i]);
    played.push(r);
    log(`${tag}: ${p.__name} played: ${r.did.join(' > ')} -> ${r.scene}`);
    if (i === 0) await shot(p, `${tag}_after_P1`);
  }
  for (const p of pages) await until(p, () => window.__engine.Engine.scene?.constructor?.name === 'CoopMapScene' && window.__coop.game.phase === 'map', null, { label: `${tag}: back on the map`, timeout: 60000 });
  await forceEvent(pages, null);
  const si = await Promise.all(pages.map(p => ev(p, () => ({ seq: window.__coop.lastSeq, ck: window.__coop.game.checksum() >>> 0, desync: window.__coop.desync, runs: window.__coop.game.runs.map(r => ({ relics: r.relics.map(x => x.key), party: r.party.map(m => m.species), money: r.money, seen: r.seenEvents })) }))));
  check(`${tag}: both clients agree after the event`, si[0].seq === si[1].seq && si[0].ck === si[1].ck && !si[0].desync && !si[1].desync, JSON.stringify(si.map(s => [s.seq, s.ck])));
  log(`${tag}: runs after:`, JSON.stringify(si[0].runs.map(r => ({ relics: r.relics, party: r.party, money: r.money }))));
  watch(false);
  return { tag, info: { title: views[0].id, foes: [] }, bgm: null, turns: 0, endMsg: played.map(p => p.did.join(' > ')).join(' || '), runs: si[0].runs, secs: Math.round((Date.now() - t0) / 1000) };
}
// The Center in co-op: P1 (holding a curse) CLEANSEs it, then both heal and leave.
async function centerScenario(pages, { tag, act }) {
  console.log(`\n=== ${tag}: POKeMON CENTER in act ${act + 1}, P1 cleanses a curse ===`);
  const t0 = Date.now();
  const node = await placeBefore(pages, { act, type: 'center', party: 'strong', size: 2, relics: [['CURSED_DOLL'], []], money: 5000 });
  watch(true, tag);
  pages.forEach(p => { p.__wd = null; });
  for (const p of pages) await voteFor(p, node.id);
  for (const p of pages) await until(p, () => window.__engine.Engine.scene?.constructor?.name === 'CenterScene', null, { label: `${tag} center scene`, timeout: 30000 });
  await sleep(700);
  const before = await ev(pages[0], () => ({ money: G.run.money, curses: G.run.curses(), cost: G.run.cleanseCost() }));
  await shot(pages[0], `${tag}_center`);
  await gclick(pages[0], 430, 269); // CLEANSE A CURSE
  await sleep(700);
  const mid = await ev(pages[0], () => ({ money: G.run.money, curses: G.run.curses() }));
  check(`${tag}: P1's CLEANSE removed the CURSED DOLL and charged $${before.cost}`, before.curses.length === 1 && !mid.curses.length && mid.money === before.money - before.cost, JSON.stringify({ before, mid }));
  for (const p of pages) {
    await gclick(p, 335, 165); // HEAL
    await p.waitForFunction(() => window.__engine.Engine.scene?.done && !window.__engine.Engine.scene.busy, null, { timeout: 20000, polling: 150 }).catch(() => log(p.__name, 'heal did not finish'));
    await gclick(p, 430, 185); // CONTINUE
    await sleep(500);
  }
  for (const p of pages) await until(p, () => window.__engine.Engine.scene?.constructor?.name === 'CoopMapScene' && window.__coop.game.phase === 'map', null, { label: `${tag}: back on the map`, timeout: 60000 });
  const si = await Promise.all(pages.map(p => ev(p, () => ({ seq: window.__coop.lastSeq, ck: window.__coop.game.checksum() >>> 0, desync: window.__coop.desync, p1: window.__coop.game.runs[0].relics.map(x => x.key) }))));
  check(`${tag}: both clients agree, and both see P1 without the curse`, si[0].ck === si[1].ck && !si[0].desync && !si[1].desync && si.every(s => !s.p1.includes('CURSED_DOLL')), JSON.stringify(si));
  watch(false);
  return { tag, info: { title: 'center', foes: [] }, bgm: null, turns: 0, endMsg: 'cleansed', secs: Math.round((Date.now() - t0) / 1000) };
}

// Watchdog self-test: P1's battle messages are made to never finish (the "awaited thing never settles" bug
// class); the watchdog must flag P1 within ~20 s while P2, locked in, counts as waiting on its partner.
async function selfTest(pages) {
  console.log('\n=== watchdog self-test: an injected hang on P1 ===');
  const node = await placeBefore(pages, { act: 0, type: 'rival', party: 'strong' });
  const before = freezes.length;
  pages.forEach(p => { p.__wd = null; });
  watch(true, 'selftest');
  for (const p of pages) await voteFor(p, node.id);
  for (const p of pages) await until(p, () => window.__engine.Engine.scene?.constructor?.name === 'CoopBattleScene', null, { label: 'self-test battle', timeout: 30000 });
  await ev(pages[0], () => { window.__engine.Engine.scene.say = () => new Promise(() => {}); });
  const t0 = Date.now();
  while (Date.now() - t0 < 50000 && freezes.length === before) {
    const st = await battleState(pages[1]);
    if (st.inBattle && st.overlays) await answerOverlay(pages[1]);
    else if (st.inBattle && st.canAct) await takeTurn(pages[1]);
    await sleep(500);
  }
  watch(false);
  const got = freezes.splice(before); // expected: not counted as findings
  check('watchdog self-test: the injected hang on P1 is flagged as a FREEZE', got.some(f => f.page === 'P1' && f.kind === 'FREEZE'), `(after ${Math.round((Date.now() - t0) / 1000)} s; P2 waiting on its partner was not flagged: ${!got.some(f => f.page === 'P2')})`);
}

// ---- main ---------------------------------------------------------------------------------------------
(async () => {
  const server = spawn(process.execPath, [path.join(ROOT, 'serve.cjs'), String(PORT)], { cwd: ROOT, stdio: 'ignore' });
  await sleep(700);
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const pages = [];
  for (const [i, name] of [[0, 'ALICE'], [1, 'BOB']]) {
    const p = await ctx.newPage(); p.__name = `P${i + 1}`; p.__url = `${BASE}?coopdev=${name}`; pages.push(p);
    await attachDebugger(p);
    p.on('response', r => { if (r.status() >= 400 && !/\/cloud\.json$/.test(r.url())) errors.push(`${p.__name} HTTP ${r.status()} ${r.url()}`); });
    p.on('pageerror', e => { errors.push(`${p.__name} pageerror: ${e.message}`); console.log(`  ! ${p.__name} pageerror: ${e.message}`); });
    p.on('console', m => {
      const t = m.text();
      if (m.type() === 'error' && /Failed to load resource/.test(t)) return; // (HTTP errors are logged by URL above; cloud.json is absent offline)
      if (m.type() === 'error') { errors.push(`${p.__name} console.error: ${t}`); console.log(`  ! ${p.__name} console.error: ${t}`); }
      else if (m.type() === 'warning' && /\[sound\]|\[coop|unknown song|failed/i.test(t)) warnings.push(`${p.__name}: ${t}`);
    });
  }
  const results = [];
  let audio = null;
  try {
    // fresh mock server state
    await pages[0].goto(BASE, { waitUntil: 'load' });
    await ev(pages[0], () => { localStorage.clear(); sessionStorage.clear(); });
    for (const p of pages) await boot(p);
    audio = [];
    for (const p of pages) audio.push(await unlockAudio(p));
    console.log('audio before / after one canvas click:', JSON.stringify(audio));
    for (const [i, { after: a }] of audio.entries()) check(`P${i + 1}: sound initialised and unlocked (ready ${a.ready}, backend ${a.backend}, unlocked ${a.unlocked}, ctx ${a.ctxState})`, a.ready === true && !!a.backend && a.unlocked === true && a.rendering);
    startWatchdog(pages);

    // Room A (Kanto): rival WIN -> bird WIN with the catch prompt -> act 3 rival LOSS; room B: bird LOSS;
    // room C (Hoenn): MAY WIN. (A LOSS ends the room; a failed scenario gets the next one a fresh room.)
    const A = { world: 'spire_kanto', starters: ['CHARMANDER', 'SQUIRTLE'] }, B = { world: 'spire_kanto', starters: ['BULBASAUR', 'CHARMANDER'] }, C = { world: 'spire', starters: ['TREECKO', 'MUDKIP'] }, D = { world: 'spire_kanto', starters: ['PIKACHU', 'BULBASAUR'] };
    const plan = [
      [A, { tag: 'rival_win', act: 0, type: 'rival', outcome: 'win', foeFrac: 0.12, expect: 'BLUE', size: 2, modal: true }],
      // (P2 is at 1 HP: they go down, wait, get revived by P1's win and still get the catch offer)
      [A, { tag: 'bird_win', act: 1, type: 'legend', outcome: 'win', foeFrac: 0.04, expect: 'ZAPDOS', party: ['strong', 'weak'], size: 3 }],
      [A, { tag: 'rival_loss', act: 2, type: 'rival', outcome: 'loss', expect: 'BLUE' }],
      [B, { tag: 'bird_loss', act: 2, type: 'legend', outcome: 'loss', expect: 'ARTICUNO' }],
      [C, { tag: 'may_win', act: 0, type: 'rival', outcome: 'win', foeFrac: 0.12, expect: 'MAY' }],
      // room D (Kanto): v0.0.7 events + the Center's CLEANSE
      [D, { tag: 'event_shared', kind: 'event', act: 0, picks: [/./, /^\$NONE/] }], // P1 takes the first choice, P2 the last (usually "Leave")
      [D, { tag: 'event_ghost', kind: 'event', act: 1, force: 'ghost', picks: [/Take an offering/, /Rest on/], expect: { label: 'the ghost fight is hidden, the offering is offered', fn: v => !v.choices.some(c => /Face the spirit/.test(c.label)) && v.choices.some(c => /Take an offering/.test(c.label)) } }],
      [D, { tag: 'event_powerplant', kind: 'event', act: 2, force: 'powerplant', picks: [/Pick up a ball/, /Pick up a ball/] }],
      [D, { tag: 'event_rocket', kind: 'event', act: 0, force: 'rocket1', picks: [/Pay up/, /Run for it/], expect: { label: 'TEAM ROCKET: Fight! is hidden', fn: v => !v.choices.some(c => /Fight/.test(c.label)) && v.choices.length >= 2 } }],
      [D, { tag: 'center_cleanse', kind: 'center', act: 1 }],
    ];
    let room = null;
    for (const [spec, sc] of plan) {
      if (ONLY && !ONLY.includes(sc.tag)) continue;
      try {
        if (room !== spec) {
          if (room) for (const p of pages) await boot(p);
          room = null;
          await makeRoom(pages, spec);
          room = spec;
        }
        results.push(await (sc.kind === 'event' ? eventScenario(pages, sc) : sc.kind === 'center' ? centerScenario(pages, sc) : scenario(pages, sc)));
        if (sc.outcome === 'loss') room = 'over';
      } catch (e) {
        watch(false);
        check(`${sc.tag} crashed: ` + (e.stack || e.message).split('\n').slice(0, 2).join(' '), false);
        if (/no answer within/.test(e.message)) for (const p of pages) console.log(`  ${p.__name} main thread stack:\n    ` + (await stackOf(p)).join('\n    '));
        for (const p of pages) await dump(p).catch(() => {});
        room = 'broken';
      }
    }
    if (!ONLY || ONLY.includes('selftest')) try { await selfTest(pages); } catch (e) { check('self-test crashed: ' + e.message, false); }
  } catch (e) {
    check('audit crashed: ' + (e.stack || e.message).split('\n').slice(0, 3).join(' '), false);
    for (const p of pages) await dump(p).catch(() => {});
  } finally {
    watch(false);
    clearInterval(WD.timer);
    await timeout(browser.close(), 15000, 'browser.close').catch(e => console.log('  ! ' + e.message + ' (Chrome left to exit with this process)'));
    server.kill();
  }
  console.log('\n==== SUMMARY ====');
  console.log('audio:', JSON.stringify(audio));
  for (const r of results) console.log(`${r.tag}: ${r.info.title} (${r.info.foes.join(', ')}), BGM ${r.bgm}, ${r.turns} hands, ${r.secs} s, end "${r.endMsg}"${r.catch?.length ? ', catch: ' + JSON.stringify(r.catch.map(c => `${c.page}:${c.answer}`)) : ''}${r.prompts?.length ? ', prompts: ' + r.prompts.length : ''}`);
  console.log(freezes.length ? `FREEZES (${freezes.length}):\n` + freezes.map(f => `  ${f.kind} ${f.scenario} ${f.page}: ${JSON.stringify(f.sig)}${f.stack ? '\n    ' + f.stack.join('\n    ') : ''}`).join('\n') : 'no freezes');
  if (choiceStalls.length) console.log('unanswered choices:', JSON.stringify(choiceStalls));
  console.log(errors.length ? `PAGE ERRORS (${errors.length}):\n  ` + errors.join('\n  ') : 'no page errors');
  if (warnings.length) console.log(`warnings (${warnings.length}):\n  ` + [...new Set(warnings)].slice(0, 30).join('\n  '));
  const bad = fails.length + freezes.length + errors.length;
  console.log(fails.length ? `FAILED: ${fails.join(' | ')}` : 'all checks passed');
  process.exit(bad ? 1 : 0);
})();
