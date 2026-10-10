// Co-op ELITE FOUR break (v0.3.21): between rooms each player gets the solo break screen (reorder the team, PLATEAU
// MART, READY), privately; READY posts the reordered run with privateDone, the next room starts once both are
// ready, and the lockstep stays in sync. Also checks that the second player's Pokédex fills in (session.recordDex).
// Two players on the ?coopdev mock backend (two pages in one context). Muted Chrome, offline build.
//   node tests/coop_e4_reorder.cjs [port=8153] [outdir=tests/out/coop_e4_reorder]
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const port = +(process.argv[2] || 8153), out = process.argv[3] || 'tests/out/coop_e4_reorder';
const root = path.resolve(__dirname, '..');
fs.mkdirSync(out, { recursive: true });

(async () => {
  const server = spawn(process.execPath, [path.join(root, 'serve.cjs'), String(port)], { cwd: root, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 700));
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const errors = [], fails = [];
  const check = (label, ok, info = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${label} ${info}`); if (!ok) fails.push(label); };
  const sceneName = (p) => p.evaluate(() => window.__engine.Engine.scene?.constructor?.name);
  // game coords (640x360) -> a click on the canvas
  const click = async (p, x, y) => {
    await p.bringToFront(); await p.waitForTimeout(150); // (a background tab doesn't run its frame loop)
    const [px, py] = await p.evaluate(([x, y]) => { const r = document.getElementById('game').getBoundingClientRect(); return [r.left + x / 640 * r.width, r.top + y / 360 * r.height]; }, [x, y]);
    await p.mouse.move(px, py); await p.waitForTimeout(120);
    await p.mouse.down(); await p.waitForTimeout(80); await p.mouse.up(); await p.waitForTimeout(350);
  };
  const party = (p, slot) => p.evaluate((s) => G.coop.game.runs[s].party.map(m => m.species), slot);
  const localParty = (p) => p.evaluate(() => G.run.party.map(m => m.species));
  try {
    const p1 = await ctx.newPage(), p2 = await ctx.newPage();
    for (const [p, n] of [[p1, 'P1'], [p2, 'P2']]) p.on('pageerror', e => errors.push(`${n}: ${e.message}`));
    await p1.goto(`http://localhost:${port}/?coopdev=RED`, { waitUntil: 'load' });
    await p1.evaluate(() => localStorage.clear());
    for (const [p, n] of [[p1, 'RED'], [p2, 'BLUE']]) {
      await p.goto(`http://localhost:${port}/?coopdev=${n}`, { waitUntil: 'load' });
      await p.waitForFunction(() => window.__ready && window.G?.meta, null, { timeout: 60000 });
      await p.evaluate(() => { Object.assign(G.meta, { tutorialDone: true, seenVersion: 'v9' }); G.meta.settings.fast = true; G.meta.dexSeen = []; G.meta.dexCaught = []; });
    }
    const net = (p, fn, ...arg) => p.evaluate(async ({ fn, arg }) => { const n = await import('/src/scenes/coop/mocknet.js'); return n[fn](...arg); }, { fn, arg });
    const r = await net(p1, 'createRoom', { ascension: 0, world: 'kanto' });
    await net(p2, 'joinRoom', r.code);
    await net(p1, 'setStarter', r.roomId, 'CHARMANDER', 0);
    await net(p2, 'setStarter', r.roomId, 'SQUIRTLE', 0);
    await net(p1, 'startRoom', r.roomId);
    for (const p of [p1, p2]) await p.evaluate(async (roomId) => {
      const { CoopLobbyScene } = await import('/src/scenes/coop/lobby.js');
      const s = new CoopLobbyScene(); window.__engine.setScene(s);
      for (let i = 0; i < 50 && !s.net; i++) await new Promise(res => setTimeout(res, 100));
      s.openRoom(roomId);
    }, r.roomId);
    for (const p of [p1, p2]) await p.waitForFunction(() => window.__engine.Engine.scene?.constructor?.name === 'CoopMapScene', null, { timeout: 20000 });
    // Shortcut to the break after the first ELITE FOUR room, the same on both clients (deterministic, so the
    // checksums still agree): act 4, three POKéMON each, then the game's own gauntletBreak(1).
    for (const p of [p1, p2]) await p.evaluate(async () => {
      const { maxHp } = await import('/src/game/pokemon.js');
      const g = G.coop.game;
      g.world.startAct(3); for (const run of g.runs) run.startAct(3);
      g.runs.forEach((run, q) => {
        const b = JSON.parse(JSON.stringify(run.party[0]));
        ['PIDGEOT', 'RAICHU'].forEach((sp, k) => { const m = { ...b, uid: 7000 + q * 10 + k, species: sp, level: 50 }; m.hp = maxHp(m); run.party.push(m); });
        run.party[0].level = 50; run.party[0].hp = maxHp(run.party[0]);
      });
      g.battleCfg = { kind: 'boss', gauntlet: 0 };
      g.gauntletBreak(1);
      G.coop.ck.set(G.coop.lastSeq, g.checksum() >>> 0); // (the desync check compares against the checksum stored per seq)
      G.coop.route();
    });
    for (const p of [p1, p2]) await p.waitForFunction(() => window.__engine.Engine.scene?.constructor?.name === 'ActClearScene', null, { timeout: 10000 });
    check('both players get the break screen', true);
    await p1.waitForTimeout(800);
    await p1.screenshot({ path: `${out}/1_P1_break.png` });
    await p2.screenshot({ path: `${out}/1_P2_break.png` });

    // P2: click RAICHU (row 3) to make it the lead, then READY
    await click(p2, 81, 48 + 2 * 30 + 15);
    check('P2: click sets the lead', JSON.stringify(await localParty(p2)) === JSON.stringify(['RAICHU', 'SQUIRTLE', 'PIDGEOT']), (await localParty(p2)).join(','));
    check('P2: not posted yet (private)', JSON.stringify(await party(p1, 1)) === JSON.stringify(['SQUIRTLE', 'PIDGEOT', 'RAICHU']));
    await p2.screenshot({ path: `${out}/2_P2_reordered.png` });
    await click(p2, 400, 305); // READY
    await p2.waitForFunction(() => window.__engine.Engine.scene?.constructor?.name === 'CoopWaitScene', null, { timeout: 10000 });
    await p1.waitForFunction(() => G.coop.game.private?.done?.[1] === true, null, { timeout: 10000 });
    check('P1 still on its own break screen while P2 waits', (await sceneName(p1)) === 'ActClearScene' && (await p1.evaluate(() => G.coop.game.phase)) === 'private');
    await p2.screenshot({ path: `${out}/3_P2_waiting.png` });

    // P1: the down arrow on row 1 (CHARMANDER below PIDGEOT), the PLATEAU MART and back, then READY
    await click(p1, 8 + 146 + 4 + 8, 48 + 14 + 6);
    check('P1: arrow moves the lead down', JSON.stringify(await localParty(p1)) === JSON.stringify(['PIDGEOT', 'CHARMANDER', 'RAICHU']), (await localParty(p1)).join(','));
    await p1.screenshot({ path: `${out}/4_P1_reordered.png` });
    await click(p1, 240, 305); // PLATEAU MART
    await p1.waitForFunction(() => window.__engine.Engine.scene?.constructor?.name === 'ShopScene', null, { timeout: 10000 });
    await p1.waitForTimeout(500);
    await p1.screenshot({ path: `${out}/5_P1_mart.png` });
    await click(p1, 562, 339); // LEAVE
    await p1.waitForFunction(() => window.__engine.Engine.scene?.constructor?.name === 'ActClearScene', null, { timeout: 10000 });
    check('P1: back from the mart, order kept', JSON.stringify(await localParty(p1)) === JSON.stringify(['PIDGEOT', 'CHARMANDER', 'RAICHU']));
    await click(p1, 400, 305); // READY
    for (const p of [p1, p2]) await p.waitForFunction(() => G.coop.game.phase === 'battle' && window.__engine.Engine.scene?.constructor?.name === 'CoopBattleScene', null, { timeout: 15000 });
    await p1.waitForTimeout(1500);
    await p1.screenshot({ path: `${out}/6_P1_room2.png` });
    await p2.screenshot({ path: `${out}/6_P2_room2.png` });

    for (const [p, n] of [[p1, 'P1'], [p2, 'P2']]) {
      const s = await p.evaluate(() => { const g = G.coop.game; return { gi: g.battleCfg?.gauntlet, l0: g.battle.subs[0].lead().species, l1: g.battle.subs[1].lead().species, p0: g.runs[0].party.map(m => m.species), p1: g.runs[1].party.map(m => m.species), ck: g.checksum() >>> 0, desync: G.coop.desync || null }; });
      check(`${n}: room 2 started with both new leads`, s.gi === 1 && s.l0 === 'PIDGEOT' && s.l1 === 'RAICHU', JSON.stringify(s));
      check(`${n}: no desync`, !s.desync);
    }
    const cks = await Promise.all([p1, p2].map(p => p.evaluate(() => G.coop.game.checksum() >>> 0)));
    check('same checksum on both clients', cks[0] === cks[1], cks.join(' / '));

    // Pokédex: the second player (and the first) record their own starter as caught and the foes on the field as seen
    for (const [p, n, st] of [[p1, 'P1', 'CHARMANDER'], [p2, 'P2', 'SQUIRTLE']]) {
      const d = await p.evaluate(() => ({ seen: G.meta.dexSeen.slice(), caught: G.meta.dexCaught.slice(), foes: G.coop.game.battle.field.filter(i => i !== null).map(i => G.coop.game.battle.enemies[i].species) }));
      check(`${n}: Pokédex has the starter caught and the foes seen`, d.caught.includes(st) && d.foes.every(f => d.seen.includes(f)), JSON.stringify(d));
    }
  } catch (e) { check('harness: ' + e.message, false); }
  console.log(errors.length ? 'PAGE ERRORS:\n' + errors.join('\n') : 'no page errors');
  console.log(fails.length ? `FAILED: ${fails.length}` : 'all checks passed');
  await browser.close(); server.kill();
  process.exit(fails.length || errors.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
