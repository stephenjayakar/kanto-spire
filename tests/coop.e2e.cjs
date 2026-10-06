// Co-op two-browser E2E: lobby -> map vote -> a full duo battle -> rewards -> next map vote -> reconnect.
// Real mode (default): two Chrome contexts against the DEV Convex deployment and a local dev build.
//   CONVEX_URL=https://<your-dev-deployment>.convex.cloud node tools/build_site.cjs && node serve.cjs 8097 dist &
//   node tests/coop.e2e.cjs            (SITE_URL on dev must include http://localhost:8097; COOP_TEST=1 on dev)
// Offline smoke (MOCK=1): two tabs of one context on the unbuilt game with ?coopdev (mock backend in
// localStorage):  node serve.cjs 8095 web &  MOCK=1 node tests/coop.e2e.cjs
// Screenshots: tests/out/coop_{lobby,map_vote,battle_target,battle_waiting,reward}.png (MOCK: coop_mock_*.png)
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');

const MOCK = !!process.env.MOCK;
const BASE = process.env.BASE || (MOCK ? 'http://localhost:8095/' : 'http://localhost:8097/');
const OUT = path.join(__dirname, 'out');
const SHOT = (name) => path.join(OUT, `coop_${MOCK ? 'mock_' : ''}${name}.png`);
const HEADED = !!process.env.HEADED;
let fails = 0;
const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) { fails++; process.exitCode = 1; } return cond; };
const log = (...a) => console.log('  ·', ...a);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ---- page helpers ---------------------------------------------------------------------------
async function gclick(page, x, y) {
  if (MOCK) await page.bringToFront();
  const r = await page.evaluate(() => { const b = document.getElementById('game').getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; });
  await page.mouse.move(r.x + x * r.w / 640, r.y + y * r.h / 360);
  await sleep(60);
  await page.mouse.down();
  await sleep(50);
  await page.mouse.up();
  await sleep(120);
}
const scene = (page) => page.evaluate(() => window.__engine?.Engine.scene?.constructor?.name || null);
async function until(page, fn, arg, { timeout = 30000, label = 'condition' } = {}) {
  try { await page.waitForFunction(fn, arg, { timeout, polling: 150 }); return true; }
  catch (e) { console.log(`  ! timeout waiting for ${label} on ${page.__name}`); await dump(page); throw e; }
}
async function dump(page) {
  const st = await page.evaluate(() => {
    const s = window.__coop, g = s?.game, E = window.__engine?.Engine;
    return { scene: E?.scene?.constructor?.name, overlays: E?.overlays.map(o => o.constructor.name), seq: s?.lastSeq, phase: g?.phase, routeKey: s?.routeKey, synced: s?.synced, desync: s?.desync,
      battle: g?.battle ? { turn: g.battle.turn, locks: g.battle.locks, down: g.battle.down, result: g.battle.result, field: g.battle.field } : null,
      busy: E?.scene?.busy, canAct: E?.scene?.canAct?.(), posting: E?.scene?.posting, q: E?.scene?.q?.length, private: g?.private };
  }).catch(e => ({ err: e.message }));
  console.log(`  ${page.__name} state:`, JSON.stringify(st));
}
const syncInfo = (page) => page.evaluate(() => { const s = window.__coop, g = s?.game; return { seq: s?.lastSeq ?? null, ck: g ? g.checksum() >>> 0 : null, phase: g?.phase ?? null, desync: s?.desync || null, synced: !!s?.synced, scene: window.__engine.Engine.scene?.constructor?.name }; });

async function boot(page) {
  await page.goto(page.__url);
  await page.waitForFunction(() => window.__ready, null, { timeout: 90000 });
  await until(page, () => window.__engine.Engine.scene?.constructor?.name === 'TitleScene', null, { label: 'title' });
  await page.evaluate(() => { window.__engine.Engine.timeScale = 2; }); // faster animations; never touches the saved settings
  await sleep(1200);
  // first visit: the patch notes pop up by themselves
  await page.evaluate(() => { const E = window.__engine.Engine; for (const o of E.overlays.slice().reverse()) o.close ? o.close(null) : E.overlays.pop(); });
  await sleep(200);
}
async function openCoop(page) {
  const saved = await page.evaluate(async () => (await import(new URL('src/game/state.js', location.href).href)).hasSavedRun());
  const y = saved ? 290 : 262;
  for (let i = 0; i < 4; i++) {
    await page.evaluate(() => { const E = window.__engine.Engine; for (const o of E.overlays.slice().reverse()) o.close ? o.close(null) : E.overlays.pop(); });
    await sleep(150);
    await gclick(page, 282 + 48, y + 12);
    await sleep(600);
    if (await scene(page) === 'CoopLobbyScene') break;
  }
  await until(page, () => window.__engine.Engine.scene?.constructor?.name === 'CoopLobbyScene' && !!window.__engine.Engine.scene.net, null, { label: 'lobby' });
}

// ---- battle driver (real clicks; card choice via the scene's own HINT logic) ------------------------
const FOE_HIT = [[160 + 250 + 64, 27 + 4 + 64], [160 + 350 + 64, 27 - 6 + 64]];
const LOCK_BTN = [640 - 150 + 36, 262 - 32 + 12], DISCARD_BTN = [640 - 74 + 35, 262 - 32 + 12];
async function battleState(page) {
  return page.evaluate(() => {
    const E = window.__engine.Engine, sc = E.scene, s = window.__coop, g = s?.game;
    const inBattle = sc?.constructor?.name === 'CoopBattleScene';
    if (!inBattle) return { inBattle, phase: g?.phase, scene: sc?.constructor?.name };
    const d = sc.duo;
    return { inBattle, phase: g.phase, canAct: sc.canAct(), overlays: E.overlays.map(o => o.constructor.name), turn: d.turn, locked: !!d.locks[s.mySlot], down: d.down[s.mySlot], result: d.result, stuck: !!sc.stuck, live: sc.liveSlots(), seq: s.lastSeq };
  });
}
async function takeTurn(page, opts = {}) {
  const st = await battleState(page);
  if (st.overlays.length) {
    // the faint-switch picker: keep the auto-picked POKéMON (closing posts nothing)
    await page.evaluate(() => { const E = window.__engine.Engine; const o = E.overlays[E.overlays.length - 1]; o.close(null); });
    await sleep(200);
  }
  if (st.stuck) { await gclick(page, ...LOCK_BTN); log(page.__name, 'PASS (no playable cards)'); return 'pass'; }
  // target: click the foe the scene suggests (or the other one on odd turns, to exercise retargeting)
  let slot = await page.evaluate(() => window.__engine.Engine.scene.target);
  if (st.live.length > 1 && opts.retarget) slot = st.live.find(x => x !== slot);
  await gclick(page, ...FOE_HIT[slot]);
  const now = await page.evaluate(() => window.__engine.Engine.scene.target);
  if (opts.first) ok(now === slot, `${page.__name}: clicking foe slot ${slot} targets it (target=${now})`);
  // cards: the best hand vs that target (the HINT logic), selected by clicking each card
  let ids = await page.evaluate(() => window.__engine.Engine.scene.bestHand());
  if (!ids || !ids.length) ids = await page.evaluate(() => { const sc = window.__engine.Engine.scene; const c = sc.handIds.find(id => sc.info(sc.sub.deck.hand.find(x => x.id === id)).playable); return c ? [c] : []; });
  if (!ids.length) { await gclick(page, ...LOCK_BTN); return 'pass?'; }
  await page.evaluate(() => { window.__engine.Engine.scene.sel = []; }); // (after an UNLOCK the old hand is still selected)
  for (const id of ids) {
    const pos = await page.evaluate((id) => {
      const sc = window.__engine.Engine.scene, n = sc.handIds.length, i = sc.handIds.indexOf(id), v = sc.vis.get(id);
      if (i < 0 || !v) return null;
      const w = i === n - 1 ? 60 : Math.min(60, sc.handPos(i + 1, n)[0] - sc.handPos(i, n)[0]);
      return [v.x + Math.min(w / 2, 20), v.y + 50];
    }, id);
    if (pos) await gclick(page, ...pos);
  }
  const sel = await page.evaluate(() => window.__engine.Engine.scene.sel.slice());
  if (sel.length !== ids.length) { log(page.__name, 'click-select mismatch', JSON.stringify({ ids, sel }), '-> using scene.sel'); await page.evaluate((ids) => { window.__engine.Engine.scene.sel = ids.slice(); }, ids); }
  if (opts.shot) { await page.mouse.move(5, 700); await sleep(400); await page.screenshot({ path: opts.shot }); }
  await gclick(page, ...LOCK_BTN);
  await until(page, () => { const sc = window.__engine.Engine.scene; return sc?.constructor?.name !== 'CoopBattleScene' || (!sc.posting); }, null, { label: 'lock posted', timeout: 20000 });
  log(page.__name, `turn ${st.turn}: locked ${ids.length} card(s) on slot ${slot}`);
  return 'lock';
}

// Plays the current duo battle to its end on both clients (real clicks via takeTurn).
async function playBattle(pages, opts = {}) {
  const [p1, p2] = pages;
    let shotT = !opts.shots, shotW = !opts.shots, turns = 0, retargeted = false, animShots = !opts.shots, healed = !opts.heal, freeDone = !opts.shots;
    let unlockDone = !opts.shots, raceDone = !opts.shots, shotP = !opts.shots;
    const deadline = Date.now() + 10 * 60 * 1000;
    let stall = Date.now();
    const battleT0 = Date.now();
    for (;;) {
      if (Date.now() > deadline) throw new Error('battle took too long');
      const st = await Promise.all(pages.map(battleState));
      if (!st[0].inBattle && !st[1].inBattle) break;
      let acted = false;
      for (let i = 0; i < 2; i++) {
        if (!st[i].inBattle || !st[i].canAct) continue;
        // P1 goes first until the "waiting for partner" screenshot is taken
        if (i === 1 && !shotW && st[0].inBattle && !st[0].locked && !st[0].down && !st[0].result && Date.now() - battleT0 < 40000) continue;
        const page = pages[i];
        // co-op interplay: P1 heals P2's hurt lead with a POTION (bag -> pick the partner's POKéMON)
        if (i === 0 && !healed) {
          const h = await p1.evaluate(async () => {
            const { maxHp } = await import(new URL('src/game/pokemon.js', location.href).href);
            const sc = window.__engine.Engine.scene, d = sc.duo, pa = window.__coop.partnerSlot, o = d.subs[pa].lead(), mine = sc.run();
            if (!o || d.down[pa] || o.hp <= 0 || o.hp >= maxHp(o) || !mine.consumables.includes('POTION')) return null;
            return { hp: o.hp, rows: Math.max(mine.party.length, d.subs[pa].run.party.length) };
          });
          if (h) {
            healed = true;
            await p1.evaluate(() => window.__engine.Engine.scene.useConsumable('POTION'));
            await sleep(300);
            const ph = 52 + h.rows * 38, py = (360 - ph) / 2;
            await gclick(p1, 40 + 10 + 274 + 130, py + 38 + 17); // partner's lead row in the picker
            await until(p2, (hp) => { const s = window.__coop, l = s.game.battle?.subs[s.mySlot].lead(); return !l || l.hp > hp || s.game.phase !== 'battle'; }, h.hp, { label: 'partner healed', timeout: 15000 });
            const after = await p2.evaluate(() => { const s = window.__coop; return s.game.battle?.subs[s.mySlot].lead()?.hp; });
            ok(after > h.hp, `P1 healed P2's lead with a POTION through the bag (HP ${h.hp} -> ${after} on P2's client)`);
            acted = true;
            continue;
          }
        }
        // v0.0.5 rules: P2 uses the turn's FREE DISCARD (2 cards) with a click; it must not cost a discard
        if (i === 1 && !freeDone) {
          freeDone = true;
          const pre = await p2.evaluate(() => { const sc = window.__engine.Engine.scene, s = sc.sub; if (!s.freeDiscardOk(2) || s.deck.hand.length < 3) return null; sc.sel = sc.handIds.slice(0, 2); return { left: s.discardsLeft, turn: sc.duo.turn, hand: s.deck.hand.length }; });
          if (pre) {
            await p2.mouse.move(5, 700); await sleep(250);
            await p2.screenshot({ path: SHOT('battle_free_discard') });
            await gclick(p2, 601, 243); // DISCARD button (reads FREE DISCARD)
            await until(p1, (t) => { const s = window.__coop, d = s.game.battle; return !d || d.subs[s.partnerSlot].freeDiscardTurn === t; }, pre.turn, { label: 'free discard seen by P1', timeout: 15000 });
            await until(p2, (t) => { const s = window.__coop, d = s.game.battle; return !d || d.subs[s.mySlot].freeDiscardTurn === t; }, pre.turn, { label: 'free discard applied on P2', timeout: 15000 });
            const si2 = await Promise.all(pages.map(syncInfo));
            const left2 = await p2.evaluate(() => window.__engine.Engine.scene.sub.discardsLeft);
            ok(left2 === pre.left && si2[0].seq === si2[1].seq && si2[0].ck === si2[1].ck, `P2's FREE DISCARD by click kept its discards (${pre.left} -> ${left2}); clients agree at seq ${si2[0].seq} (checksum ${si2[0].ck})`);
            acted = true;
            continue;
          }
        }
        // UNLOCK race: P1 is locked; P2 clicks LOCK IN while P1 clicks UNLOCK at (nearly) the same moment.
        // Whichever lands first in the log wins, and both clients must agree on the outcome.
        if (i === 1 && unlockDone && !raceDone && Date.now() - battleT0 < 120000) {
          const s1 = await battleState(p1);
          if (s1.inBattle && !s1.result && !s1.down && !s1.locked) continue; // let P1 lock in first
        }
        if (i === 1 && unlockDone && !raceDone && (await battleState(p1)).locked) {
          raceDone = true;
          // both must be idle (done animating each other's last action) so neither button handler is a no-op
          await until(p2, () => window.__engine.Engine.scene.canAct?.(), null, { label: 'P2 ready for the race', timeout: 20000 }).catch(() => {});
          await until(p1, () => window.__engine.Engine.scene.canUnlock?.(), null, { label: 'P1 ready for the race', timeout: 20000 }).catch(() => {});
          const prep = await p2.evaluate(() => { const sc = window.__engine.Engine.scene; const h = sc.bestHand(); if (!h || !h.length) return null; sc.sel = h.slice(); return { turn: sc.duo.turn }; });
          const p1ok = await p1.evaluate(() => window.__engine.Engine.scene.canUnlock());
          if (prep && p1ok) {
            const seq0 = (await syncInfo(p1)).seq;
            // (the buttons' own handlers, fired in both pages at once: a click needs ~250 ms per page here, long
            // enough for one client to see the other's action and disable its button, which is the normal case)
            // P1's unlock is posted the way doUnlock() posts it, but without its "nothing new seen yet" guard (in MOCK
            // both tabs share one renderer, so P1 would already have seen P2's lock and greyed out UNLOCK).
            // (MOCK's localStorage "server" isn't transactional across tabs, so there the two posts go one right
            // after the other, before P1 has polled P2's lock; against Convex they really are concurrent.)
            const lockP2 = () => p2.evaluate(() => window.__engine.Engine.scene.doLock());
            const unlockP1 = () => p1.evaluate(() => { const sc = window.__engine.Engine.scene; sc.unlockSel = null; sc.post({ type: 'unlock', turn: sc.duo.turn }); });
            if (MOCK) { await lockP2(); await unlockP1(); } else await Promise.all([lockP2(), unlockP1()]);
            for (const p of pages) await until(p, (n) => { const s = window.__coop; return s.lastSeq >= n + 2; }, seq0, { label: 'race actions applied', timeout: 20000 });
            await sleep(300);
            const si3 = await Promise.all(pages.map(syncInfo));
            const out = await p1.evaluate((n) => {
              const s = window.__coop, log = s.log.filter(a => a.seq > n).map(a => ({ seq: a.seq, p: a.p, type: a.type }));
              const u = log.find(a => a.type === 'unlock'), l = log.find(a => a.type === 'lock' && a.p !== s.mySlot);
              return { me: s.mySlot, log, unlockFirst: !!(u && l && u.seq < l.seq), turn: s.game.battle?.turn ?? null, locks: s.game.battle?.locks.map(Boolean) ?? null, result: s.game.battle?.result?.outcome || null, toast: window.__engine.Engine.scene?.toast?.text || null };
            }, seq0);
            log('race log', JSON.stringify(out.log), out.unlockFirst ? 'unlock landed first' : 'lock landed first', 'toast:', out.toast);
            ok(si3[0].ck === si3[1].ck && si3[0].seq === si3[1].seq && !si3[0].desync && !si3[1].desync, `UNLOCK/LOCK race: both clients agree at seq ${si3[0].seq} (checksum ${si3[0].ck})`);
            if (out.unlockFirst) ok(out.turn === prep.turn && out.locks && !out.locks[out.me] && out.locks[1 - out.me], `race (unlock first): P1 unlocked, P2 waits on turn ${out.turn}`);
            else ok(out.result || out.turn === prep.turn + 1, `race (lock first): the turn resolved and P1's late unlock was refused (turn ${prep.turn} -> ${out.turn})`);
            acted = true;
            continue;
          }
        }
        const first = i === 0 && !shotT;
        const live2 = st[i].live.length > 1;
        const r = await takeTurn(page, { first, shot: first && live2 ? SHOT('battle_target') : null, retarget: i === 1 && live2 && !retargeted });
        if (i === 1 && live2) retargeted = true;
        // crisp partner cards: P1 watches P2's hand resolve
        if (!shotP && r === 'lock') {
          // only when this lock resolved the turn (P1 starts animating it); otherwise the partner hasn't locked yet
          const resolving = await p1.waitForFunction(() => { const sc = window.__engine.Engine.scene; return sc?.constructor?.name !== 'CoopBattleScene' || sc.busy; }, null, { timeout: 3000, polling: 50 }).then(() => true).catch(() => false);
          const seen = resolving && await p1.waitForFunction(() => { const sc = window.__engine.Engine.scene; return sc?.constructor?.name === 'CoopBattleScene' && sc.playedBy === window.__coop.partnerSlot && sc.playedIds.length > 0; }, null, { timeout: 15000, polling: 50 }).then(() => true).catch(() => false);
          if (seen) {
            await p1.mouse.move(5, 700);
            await sleep(250);
            await p1.screenshot({ path: SHOT('battle_partner_cards') });
            const crisp = await p1.evaluate(() => { const sc = window.__engine.Engine.scene; return sc.playedIds.map(id => sc.playedPos(id)).every(([x, y]) => Number.isInteger(x) && Number.isInteger(y)) && window.__engine.Engine.ctx.imageSmoothingEnabled === false; });
            ok(crisp, "partner's played cards are drawn full size at integer positions with smoothing off (screenshot)");
            shotP = true;
          }
        }
        if (process.env.ANIM_SHOTS && i === 1 && !animShots) { animShots = true; for (let k = 0; k < 10; k++) { await sleep(450); await p1.screenshot({ path: SHOT('anim_' + k) }); } }
        if (first && live2) shotT = true;
        acted = true; turns++;
        if (i === 0 && !shotW && r === 'lock') {
          const w = await p1.evaluate(() => { const sc = window.__engine.Engine.scene; return sc.constructor.name === 'CoopBattleScene' && !!sc.duo.locks[window.__coop.mySlot] && !sc.duo.locks[window.__coop.partnerSlot]; });
          if (w) {
            await p1.mouse.move(5, 700);
            await sleep(500);
            await p1.screenshot({ path: SHOT('battle_waiting') });
            shotW = true;
            ok(true, 'P1 locked in and waits for P2 (screenshot, UNLOCK button)');
            // UNLOCK: P1 takes the lock-in back by clicking the same button; P2 sees P1 choosing again
            const t0 = await p1.evaluate(() => window.__engine.Engine.scene.duo.turn);
            const okBtn = await p1.evaluate(() => window.__engine.Engine.scene.canUnlock());
            await gclick(p1, ...LOCK_BTN);
            await until(p1, () => { const sc = window.__engine.Engine.scene, s = window.__coop; return sc.constructor.name !== 'CoopBattleScene' || (!sc.duo.locks[s.mySlot] && !sc.posting); }, null, { label: 'P1 unlocked', timeout: 20000 });
            await until(p2, () => { const s = window.__coop; return !s.game.battle?.locks[s.partnerSlot]; }, null, { label: 'P2 sees P1 unlocked', timeout: 20000 });
            const p2view = await p2.evaluate(async () => { const ui = await import(new URL('src/scenes/coop/ui.js', location.href).href); const s = window.__coop; return { status: ui.playerStatus(s, s.partnerSlot).key, turn: s.game.battle?.turn }; });
            const useq = await p1.evaluate(() => window.__coop.lastSeq);
            await until(p2, (n) => window.__coop.lastSeq >= n, useq, { label: 'P2 at the unlock seq', timeout: 20000 });
            await until(p1, () => window.__engine.Engine.scene.canAct?.(), null, { label: 'P1 can act after UNLOCK', timeout: 20000 }).catch(() => {});
            const p1can = await p1.evaluate(() => window.__engine.Engine.scene.canAct());
            const si4 = await Promise.all(pages.map(syncInfo));
            ok(okBtn && p1can && p2view.status === 'choosing' && p2view.turn === t0 && si4[0].seq === si4[1].seq && si4[0].ck === si4[1].ck, `UNLOCK: P1 took back the lock-in on turn ${t0}; P2 shows P1 as ${p2view.status}; clients agree (seq ${si4[0].seq}/${si4[1].seq}, checksum ${si4[0].ck}/${si4[1].ck}; button ${okBtn}, P1 can act ${p1can}, P2 turn ${p2view.turn})`);
            unlockDone = true;
          }
        }
      }
      if (acted) stall = Date.now();
      else if (Date.now() - stall > 90000) { await dump(p1); await dump(p2); throw new Error('battle stalled'); }
      await sleep(acted ? 300 : 500);
    }
  return { turns, shotT, shotW, shotP, unlockDone, raceDone };
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  let A = null, roomId = null;
  // Two tabs of one window (MOCK) would otherwise throttle the background tab's requestAnimationFrame,
  // which drives the game loop (animations, clicks).
  const browser = await chromium.launch({ channel: 'chrome', headless: !HEADED, args: ['--mute-audio', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'] });
  const errors = [];
  const pages = [];
  try {
    if (MOCK) {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
      for (const [i, name] of [[0, 'ALICE'], [1, 'BOB']]) { const p = await ctx.newPage(); p.__name = `P${i + 1}`; p.__url = `${BASE}?coopdev=${name}`; pages.push(p); }
    } else {
      A = require('./coop_auth.cjs');
      const cfg = await fetch(BASE + 'cloud.json').then(r => r.json());
      if (!process.env.E2E_DEV_DEPLOYMENT || !cfg.convexUrl.includes(process.env.E2E_DEV_DEPLOYMENT)) throw new Error(`the build at ${BASE} is not a DEV build (${cfg.convexUrl}); set E2E_DEV_DEPLOYMENT`);
      A.ensureTestUser(A.P2_EMAIL, A.P2_NAME);
      const tokens = await Promise.all([A.mintToken(A.P1_EMAIL, '60m'), A.mintToken(A.P2_EMAIL, '60m')]);
      for (const i of [0, 1]) {
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
        await ctx.addInitScript(t => localStorage.setItem('kantospire.auth.v1', JSON.stringify({ token: t, refreshToken: 'e2e' })), tokens[i]);
        const p = await ctx.newPage(); p.__name = `P${i + 1}`; p.__url = BASE; pages.push(p);
      }
    }
    for (const p of pages) {
      p.on('pageerror', e => errors.push(`${p.__name}: ${e.message}`));
      p.on('console', m => { if (m.type() === 'error' && /\[coop/.test(m.text())) errors.push(`${p.__name} console: ${m.text()}`); });
    }
    const [p1, p2] = pages;
    await Promise.all(pages.map(boot));
    ok(true, `both clients booted (${BASE}${MOCK ? ', mock backend' : ', dev Convex'})`);

    // ---- lobby -------------------------------------------------------------------------------
    await openCoop(p1); await openCoop(p2);
    await gclick(p1, 170, 107); // CREATE ROOM
    await until(p1, () => { const sc = window.__engine.Engine.scene; return sc.mode === 'room' && sc.view?.room?.code; }, null, { label: 'room created' });
    const room = await p1.evaluate(() => { const v = window.__engine.Engine.scene.view; return { code: v.room.code, roomId: v.room._id }; });
    roomId = room.roomId;
    ok(/^[A-Z2-9]{5}$/.test(room.code), `P1 created room ${room.code}`);
    await gclick(p2, 170, 191); // JOIN ROOM
    await until(p2, () => window.__engine.Engine.scene.mode === 'join', null, { label: 'join mode' });
    await p2.keyboard.type(room.code, { delay: 90 });
    await sleep(200);
    ok((await p2.evaluate(() => window.__engine.Engine.scene.code)) === room.code, 'P2 typed the room code');
    await gclick(p2, 390, 225); // JOIN
    await until(p2, () => { const sc = window.__engine.Engine.scene; return sc.mode === 'room' && sc.view?.members?.length === 2; }, null, { label: 'P2 in room' });
    await gclick(p1, 232 + 1 * 66 + 31, 78 + 37); // CHARMANDER
    await gclick(p2, 232 + 2 * 66 + 31, 78 + 37); // SQUIRTLE
    await until(p1, () => { const v = window.__engine.Engine.scene.view; return v?.members?.length === 2 && v.members.every(m => m.starter); }, null, { label: 'both starters', timeout: 20000 });
    await sleep(300);
    await p1.screenshot({ path: SHOT('lobby') });
    const starters = await p1.evaluate(() => window.__engine.Engine.scene.view.members.map(m => m.starter));
    ok(starters[0] === 'CHARMANDER' && starters[1] === 'SQUIRTLE', `starters picked by clicking (${starters})`);
    await gclick(p1, 566, 305); // START
    for (const p of pages) await until(p, () => window.__coop?.synced && window.__engine.Engine.scene?.constructor?.name === 'CoopMapScene', null, { label: 'map after start', timeout: 60000 });
    let si = await Promise.all(pages.map(syncInfo));
    ok(si[0].seq === si[1].seq && si[0].ck === si[1].ck && si[0].phase === 'map', `both on the co-op map at seq ${si[0].seq} with equal checksums (${si[0].ck})`);

    // ---- map vote ------------------------------------------------------------------------------
    const pickNode = (page) => page.evaluate(() => {
      const sc = window.__engine.Engine.scene, g = sc.s.game, nodes = g.world.map.nodes;
      const ids = g.reachable();
      const rank = { wild: 0, trainer: 1, elite: 2, boss: 3 };
      const battleNext = (id) => (nodes[id].next || []).some(n => (rank[nodes[n]?.type] ?? 9) < 9) ? 0 : 1; // keep a battle reachable next
      const best = ids.slice().sort((a, b) => ((rank[nodes[a].type] ?? 9) - (rank[nodes[b].type] ?? 9)) || (battleNext(a) - battleNext(b)))[0];
      const [x, y] = sc.nodePos(nodes[best]);
      return { id: best, type: nodes[best].type, x, y };
    });
    const node = await pickNode(p1);
    log('voting for node', node.id, node.type);
    await gclick(p1, node.x, node.y - 8);
    await until(p2, (id) => window.__coop.game.votes[1 - window.__coop.mySlot] === id, node.id, { label: 'P2 sees P1 vote' });
    await sleep(300);
    await p2.screenshot({ path: SHOT('map_vote') });
    ok(true, 'P2 sees P1\'s vote marker (screenshot)');
    await gclick(p2, node.x, node.y - 8);
    const isBattle = ['wild', 'trainer', 'elite', 'boss'].includes(node.type);
    ok(isBattle, `voted node is a battle (${node.type})`);
    for (const p of pages) await until(p, () => window.__engine.Engine.scene?.constructor?.name === 'CoopBattleScene', null, { label: 'battle scene', timeout: 30000 });
    si = await Promise.all(pages.map(syncInfo));
    ok(si[0].seq === si[1].seq && si[0].ck === si[1].ck && si[0].phase === 'battle', `both in the duo battle at seq ${si[0].seq}, checksums equal`);

    // ---- duo battle ------------------------------------------------------------------------------
    const B1 = await playBattle(pages, { shots: true, heal: true });
    const { shotT, shotW, turns } = B1;
    if (!shotT) { log('no 2-foe turn for the target screenshot'); }
    ok(shotT && shotW && B1.shotP, `battle screenshots taken (target ${shotT}, waiting/UNLOCK ${shotW}, partner cards ${B1.shotP})`);
    ok(B1.unlockDone && B1.raceDone, 'UNLOCK and the UNLOCK/LOCK race were exercised');
    si = await Promise.all(pages.map(syncInfo));
    log(`battle over after ${turns} hands; phases ${si[0].phase}/${si[1].phase}`);
    ok(si[0].seq === si[1].seq && si[0].ck === si[1].ck, `after the battle: same seq ${si[0].seq} and checksum (${si[0].ck} / ${si[1].ck})`);
    ok(si[0].phase === 'private' && si[1].phase === 'private', `battle won -> private reward phase on both (${si[0].phase}/${si[1].phase})`);

    // ---- rewards -------------------------------------------------------------------------------
    for (const p of pages) await until(p, () => window.__engine.Engine.scene?.constructor?.name === 'RewardScene' && !window.__engine.Engine.scene.busy, null, { label: 'reward scene', timeout: 30000 });
    await sleep(400);
    await p1.screenshot({ path: SHOT('reward') });
    for (const p of pages) {
      const n = await p.evaluate(() => window.__engine.Engine.scene.rewards.length);
      await gclick(p, 450, 60 + n * 34 + 6 + 12); // CONTINUE / SKIP REST & CONTINUE
      await sleep(300);
      const modal = await p.evaluate(() => window.__engine.Engine.overlays.map(o => o.constructor.name));
      if (modal.length) { await p.evaluate(() => { const E = window.__engine.Engine; E.overlays[E.overlays.length - 1].close(1); }); log(p.__name, 'skipped unclaimed rewards'); }
      await until(p, () => ['CoopWaitScene', 'CoopMapScene'].includes(window.__engine.Engine.scene?.constructor?.name), null, { label: 'left rewards', timeout: 20000 });
    }
    for (const p of pages) await until(p, () => window.__engine.Engine.scene?.constructor?.name === 'CoopMapScene' && window.__coop.game.phase === 'map', null, { label: 'next map vote', timeout: 30000 });
    si = await Promise.all(pages.map(syncInfo));
    ok(si[0].phase === 'map' && si[1].phase === 'map', 'both back on the map for the next vote');
    ok(si[0].seq === si[1].seq && si[0].ck === si[1].ck, `next map vote: same seq ${si[0].seq}, same checksum ${si[0].ck}`);
    ok(!si[0].desync && !si[1].desync, 'no desync banner on either client');

    // ---- reconnect: reload P2 and rejoin from the lobby ----------------------------------------------
    await boot(p2);
    await openCoop(p2);
    await until(p2, (rid) => (window.__engine.Engine.scene.rooms || []).some(r => r.roomId === rid), roomId, { label: 'rejoin list', timeout: 20000 });
    const row = await p2.evaluate((rid) => window.__engine.Engine.scene.rooms.slice(0, 6).findIndex(r => r.roomId === rid), roomId);
    await gclick(p2, 440, 90 + row * 36 + 16); // REJOIN row
    await until(p2, () => window.__coop?.synced && window.__engine.Engine.scene?.constructor?.name === 'CoopMapScene', null, { label: 'rejoined map', timeout: 60000 });
    si = await Promise.all(pages.map(syncInfo));
    ok(si[0].seq === si[1].seq && si[0].ck === si[1].ck && si[1].phase === 'map', `P2 reloaded and replayed the log to seq ${si[1].seq} (checksum ${si[1].ck} = ${si[0].ck})`);

    // one more vote after the reconnect: both clients enter the same node in lockstep
    const n2 = await pickNode(p1);
    await gclick(p1, n2.x, n2.y - 8);
    await until(p2, (id) => window.__coop.game.votes[1 - window.__coop.mySlot] === id, n2.id, { label: 'vote 2 seen' });
    await gclick(p2, n2.x, n2.y - 8);
    for (const p of pages) await until(p, () => window.__coop.game.phase !== 'map', null, { label: 'node 2 entered' });
    await sleep(800);
    si = await Promise.all(pages.map(syncInfo));
    ok(si[0].seq === si[1].seq && si[0].ck === si[1].ck && si[0].phase === si[1].phase, `after the reconnect both entered node ${n2.id} (${n2.type}) in lockstep: ${si[0].phase} seq ${si[0].seq}`);
    ok(!si[0].desync && !si[1].desync, 'still no desync');
    if (si[0].phase === 'battle') {
      // reload P2 in the middle of this battle: it replays into the battle scene, then both finish it
      await until(p2, () => { const sc = window.__engine.Engine.scene; return sc?.constructor?.name === 'CoopBattleScene' && sc.canAct(); }, null, { label: 'battle 2 ready', timeout: 60000 });
      await until(p1, () => { const sc = window.__engine.Engine.scene; return sc?.constructor?.name === 'CoopBattleScene' && sc.canAct(); }, null, { label: 'P1 battle 2 ready', timeout: 60000 });
      await takeTurn(p1, {});
      await until(p1, () => !!window.__coop.game.battle?.locks[window.__coop.mySlot], null, { label: 'P1 locked (battle 2)', timeout: 20000 });
      await boot(p2);
      await openCoop(p2);
      await until(p2, (rid) => (window.__engine.Engine.scene.rooms || []).some(r => r.roomId === rid), roomId, { label: 'rejoin list 2', timeout: 20000 });
      const row2 = await p2.evaluate((rid) => window.__engine.Engine.scene.rooms.slice(0, 6).findIndex(r => r.roomId === rid), roomId);
      await gclick(p2, 440, 90 + row2 * 36 + 16);
      await until(p2, () => window.__coop?.synced && window.__engine.Engine.scene?.constructor?.name === 'CoopBattleScene', null, { label: 'rejoined battle', timeout: 60000 });
      si = await Promise.all(pages.map(syncInfo));
      ok(si[0].seq === si[1].seq && si[0].ck === si[1].ck, `P2 reloaded mid-battle and replayed to seq ${si[1].seq} (checksum ${si[1].ck} = ${si[0].ck})`);
      ok(await p2.evaluate(() => { const sc = window.__engine.Engine.scene, d = sc.duo; return !!d.locks[1 - window.__coop.mySlot] && !d.locks[window.__coop.mySlot]; }), 'after the reload P2 sees P1 locked in and can still choose');
      const B2 = await playBattle(pages, {});
      si = await Promise.all(pages.map(syncInfo));
      ok(si[0].seq === si[1].seq && si[0].ck === si[1].ck && si[0].phase === si[1].phase, `second duo battle finished in lockstep after ${B2.turns} hands: ${si[0].phase} seq ${si[0].seq}`);
    }
    ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 5).join(' | ') : ''));
  } catch (e) {
    ok(false, 'E2E crashed: ' + (e.stack || e.message).split('\n').slice(0, 3).join(' '));
    for (const p of pages) await dump(p).catch(() => {});
    if (errors.length) console.log('page errors:', errors.slice(0, 8));
  } finally {
    if (!MOCK && A && roomId) {
      for (let t = 0; t < 3; t++) {
        try { const r = A.cleanupRooms([roomId]); log('cleaned up room', roomId, JSON.stringify(r)); break; }
        catch (e) { console.log(`cleanup attempt ${t + 1} failed: ${e.message.split(String.fromCharCode(10)).slice(-3).join(' ')}`); await sleep(3000); }
      }
    }
    await browser.close();
  }
  console.log(fails ? `\nCOOP E2E: ${fails} FAILED` : '\nCOOP E2E: ALL PASSED');
})();
