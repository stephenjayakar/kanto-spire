// Quick layout screenshots for 2-4 player co-op (mock backend, room set up through the mock API, then the
// real scenes): the map with every player's sketch + votes, a battle while choosing (partners locked in, my
// hand selected), and a battle mid-resolution (message box + played cards).
//   node tests/coop4_shots.cjs [port=8152]      (PLAYERS=2,3,4)  ->  tests/out/coop4/shots_<n>p_*.png
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const PORT = +(process.argv[2] || 8152);
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'tests/out/coop4');
const PLAYERS = (process.env.PLAYERS || '2,3,4').split(',').map(Number);
const NAMES = ['ALICE', 'BOB', 'CARL', 'DANA'], STARTERS = ['CHARMANDER', 'SQUIRTLE', 'BULBASAUR', 'PIKACHU'];
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const errors = [];

(async () => {
  const server = spawn(process.execPath, [path.join(ROOT, 'serve.cjs'), String(PORT)], { cwd: ROOT, stdio: 'ignore' });
  await sleep(700);
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'] });
  try {
    for (const N of PLAYERS) {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
      const pages = [];
      for (let i = 0; i < N; i++) {
        const p = await ctx.newPage(); pages.push(p);
        p.on('pageerror', e => errors.push(`${N}p P${i + 1}: ${e.message}`));
        if (i === 0) { await p.goto(`http://localhost:${PORT}/?coopdev=${NAMES[0]}`); await p.evaluate(() => { localStorage.clear(); sessionStorage.clear(); }); }
        await p.goto(`http://localhost:${PORT}/?coopdev=${NAMES[i]}`, { waitUntil: 'load' });
        await p.waitForFunction(() => window.__ready && window.G?.meta, null, { timeout: 60000 });
        await p.evaluate(() => { Object.assign(G.meta, { tutorialDone: true, seenVersion: 'v9', hintBattles: 9 }); window.__engine.Engine.timeScale = 2; G.meta.unlockedStarters = [...new Set([...(G.meta.unlockedStarters || []), 'PIKACHU'])]; });
      }
      const net = (p, fn, ...arg) => p.evaluate(async ({ fn, arg }) => { const n = await import('/src/scenes/coop/mocknet.js'); return n[fn](...arg); }, { fn, arg });
      const r = await net(pages[0], 'createRoom', { ascension: 0, world: 'kanto' });
      for (const p of pages.slice(1)) await net(p, 'joinRoom', r.code);
      for (const [i, p] of pages.entries()) await net(p, 'setStarter', r.roomId, STARTERS[i], 0);
      await net(pages[0], 'startRoom', r.roomId);
      for (const p of pages) await p.evaluate(async (roomId) => {
        const { CoopLobbyScene } = await import('/src/scenes/coop/lobby.js');
        const s = new CoopLobbyScene(); window.__engine.setScene(s);
        for (let i = 0; i < 50 && !s.net; i++) await new Promise(res => setTimeout(res, 100));
        s.openRoom(roomId);
      }, r.roomId);
      for (const p of pages) await p.waitForFunction(() => window.__coop?.synced && window.__engine.Engine.scene?.constructor?.name === 'CoopMapScene', null, { timeout: 30000 });
      // a sketch from every player (drawn straight into the side channel), then N-1 votes
      for (const [i, p] of pages.entries()) await p.evaluate((i) => {
        const sc = window.__engine.Engine.scene, s = sc.s, act = sc.mapRun().actIndex;
        const sk = s.mySketch(act);
        const pts = []; for (let k = 0; k < 8; k++) pts.push([200 + i * 60 + Math.sin(k + i) * 18, 330 - k * 22]);
        sk.strokes.push(pts.flatMap(([x, y]) => [Math.round(x), Math.round(y - (sc.scroll || 0))]));
        s.sendSketch();
      }, i);
      await sleep(2500);
      const reach = await pages[0].evaluate(() => { const g = window.__coop.game; return g.reachable().map(id => ({ id, type: g.world.map.nodes[id].type })); });
      const want = (reach.find(x => x.type === 'trainer') || reach[0]).id, alt = (reach.find(x => x.id !== want) || reach[0]).id;
      for (const [i, p] of pages.slice(0, -1).entries()) await p.evaluate((id) => window.__coop.vote(id), i === 1 && N > 2 ? alt : want);
      await sleep(1800);
      await pages[0].bringToFront(); await pages[0].mouse.move(2, 2); await sleep(300);
      await pages[0].screenshot({ path: path.join(OUT, `shots_${N}p_map.png`) });
      await pages[N - 1].evaluate((id) => window.__coop.vote(id), want);
      for (const p of pages) await p.waitForFunction(() => window.__engine.Engine.scene?.constructor?.name === 'CoopBattleScene', null, { timeout: 30000 });
      // battle: wait until everyone can act, the partners lock in, my hand is selected
      const canAct = () => { const sc = window.__engine.Engine.scene; return sc?.constructor?.name === 'CoopBattleScene' && sc.canAct(); };
      for (const p of pages) { await p.bringToFront(); await p.waitForFunction(canAct, null, { timeout: 60000 }); }
      for (const p of pages.slice(1)) await p.evaluate(() => { const sc = window.__engine.Engine.scene; const ids = sc.bestHand(); sc.post(ids ? { type: 'lock', ids, target: sc.target } : { type: 'lock', pass: true }); });
      await pages[0].bringToFront();
      await pages[0].waitForFunction((n) => { const d = window.__coop.game.battle; return d.locks.filter(Boolean).length >= n - 1; }, N, { timeout: 30000 });
      await pages[0].waitForFunction(canAct, null, { timeout: 30000 });
      await pages[0].evaluate(() => { const sc = window.__engine.Engine.scene; sc.sel = sc.bestHand() || []; });
      await pages[0].mouse.move(2, 2); await sleep(600);
      await pages[0].screenshot({ path: path.join(OUT, `shots_${N}p_battle_choose.png`) });
      await pages[0].evaluate(() => window.__engine.Engine.scene.doLock());
      // while the turn resolves: my hand, a partner's hand (with its label), a foe's attack arrow
      const got = new Set();
      for (let k = 0; k < 60 && got.size < 3; k++) {
        await sleep(150);
        const st = await pages[0].evaluate(() => { const sc = window.__engine.Engine.scene; if (sc?.constructor?.name !== 'CoopBattleScene') return null; return { played: sc.playedIds.length, by: sc.playedBy, me: sc.me, arrows: sc.arrows.length }; });
        if (!st) break;
        const want = st.played && st.by === st.me ? 'battle_resolve' : st.played && st.by !== st.me ? 'battle_partner_hand' : st.arrows ? 'battle_foe_attack' : null;
        if (want && !got.has(want)) { got.add(want); await pages[0].screenshot({ path: path.join(OUT, `shots_${N}p_${want}.png`) }); }
      }
      console.log(`${N}p: resolution shots: ${[...got].join(', ')}`);
      // the item picker with every team
      await pages[0].waitForFunction(canAct, null, { timeout: 60000 }).catch(() => {});
      const opened = await pages[0].evaluate(() => { const sc = window.__engine.Engine.scene; const run = sc.run(); if (!sc.canAct()) return false; run.consumables.push('POTION'); sc.useConsumable('POTION'); return true; });
      if (opened) { await sleep(500); await pages[0].screenshot({ path: path.join(OUT, `shots_${N}p_item_picker.png`) }); }
      console.log(`${N}p: shots done (room ${r.code})`);
      await ctx.close();
    }
  } catch (e) { console.log('FAILED', e.stack); errors.push(e.message); }
  await browser.close(); server.kill();
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
  process.exit(errors.length ? 1 : 0);
})();
