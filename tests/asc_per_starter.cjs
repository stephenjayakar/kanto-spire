// Ascension unlocks per starter, in muted Chrome (offline build, own static server):
// 1. an old save (global maxAscension) in localStorage is migrated on load: per-starter levels from its
//    run history, saved back, nothing else touched;
// 2. starter select: each unlocked cell shows its A-badge, the picker follows the selected starter and is
//    capped by its unlock (real clicks on the cells and the > button);
// 3. co-op lobby (?coopdev mock backend, two pages): the room is capped by the lower of the two players'
//    unlocks for their picked starters.
//   node tests/asc_per_starter.cjs [port=8144] [outdir=tests/out/visfix/asc]
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const port = +(process.argv[2] || 8144), out = process.argv[3] || 'tests/out/visfix/asc';
const root = path.resolve(__dirname, '..');
fs.mkdirSync(out, { recursive: true });

const run = (starter, ascension, result, act) => ({ date: 0, starter, ascension, result, act, floor: 3, party: [starter], seed: 'x' });
const OLD_META = {
  maxAscension: 5, bestAscensionWon: 4, lastAscension: 4, unlockedStarters: ['BULBASAUR', 'CHARMANDER', 'SQUIRTLE', 'GASTLY', 'DRATINI', 'ABRA'], starterVer: 2,
  shinies: ['DRATINI'], shinyOn: { DRATINI: true }, unlocks: { win: true }, totalWins: 3, totalRuns: 6, dexSeen: ['PIDGEY'], dexCaught: [], tutorialDone: true, seenVersion: 'v9',
  settings: { music: 0.3, sfx: 0.4, fast: true },
  runs: [run('GASTLY', 4, 'lose', 5), run('DRATINI', 3, 'postgame', 5), run('ABRA', 2, 'win', 4), run('SQUIRTLE', 0, 'lose', 2), run('BULBASAUR', 0, 'lose', 1), run('GASTLY', 4, 'lose', 1)],
};

(async () => {
  const server = spawn(process.execPath, [path.join(root, 'serve.cjs'), String(port)], { cwd: root, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 700));
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const errors = [], fails = [];
  const check = (label, ok, info = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${label} ${info}`); if (!ok) fails.push(label); };
  const watch = (p, name) => { p.on('pageerror', e => errors.push(`${name}: ${e.message}`)); p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`${name}: ${m.text()}`); }); };
  try {
    // ---- 1. migration on load ----
    const page = await ctx.newPage(); watch(page, 'p1');
    await page.goto(`http://localhost:${port}/`, { waitUntil: 'load' });
    await page.evaluate((m) => { localStorage.clear(); localStorage.setItem('kantospire.meta.v1', JSON.stringify(m)); }, OLD_META);
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => window.__ready && window.G?.meta, null, { timeout: 60000 });
    const mig = await page.evaluate(() => ({ live: G.meta.ascBy, ver: G.meta.ascVer, saved: JSON.parse(localStorage.getItem('kantospire.meta.v1')) }));
    check('old save migrated on load', JSON.stringify(mig.live) === JSON.stringify({ GASTLY: 5, DRATINI: 4, ABRA: 3 }) && mig.ver === 1, JSON.stringify(mig.live));
    check('migration saved back to storage', JSON.stringify(mig.saved.ascBy) === JSON.stringify(mig.live) && mig.saved.ascVer === 1);
    const { ascBy, ascVer, ...rest } = mig.saved;
    // every original field kept as it was (loadMeta only adds defaults, e.g. new settings)
    const changed = Object.keys(OLD_META).filter(k => k === 'settings' ? Object.entries(OLD_META.settings).some(([sk, sv]) => rest.settings[sk] !== sv) : JSON.stringify(rest[k]) !== JSON.stringify(OLD_META[k]));
    check('the rest of the save is untouched', !changed.length, changed.join(','));

    // ---- 2. starter select ----
    const at = (x, y) => [x * 2, y * 2];
    await page.evaluate(async () => { const { StarterScene } = await import('/src/scenes/starter.js'); window.__engine.setScene(new StarterScene()); });
    await page.waitForTimeout(600);
    const cell = (species) => page.evaluate((sp) => { const s = window.__engine.Engine.scene; const i = s.list.findIndex(x => x.species === sp); return [150 + (476 - (7 * 68 - 4)) / 2 + (i % 7) * 68 + 32, 52 + Math.floor(i / 7) * 62 + 30]; }, species);
    const pick = async (sp) => { const [x, y] = await cell(sp); await page.mouse.click(...at(x, y)); await page.waitForTimeout(250); };
    const asc = () => page.evaluate(() => window.__engine.Engine.scene.asc);
    const more = async (n) => { for (let i = 0; i < n; i++) { await page.mouse.click(...at(458 + 168 - 32 + 12, 240 + 16 + 10)); await page.waitForTimeout(120); } };
    await pick('GASTLY');
    check('GASTLY opens at its last level (old global pick A4, capped by A5)', (await asc()) === 4, `A${await asc()}`);
    await more(3);
    check('GASTLY: > stops at its unlock (A5)', (await asc()) === 5, `A${await asc()}`);
    await page.mouse.move(...at(300, 340));
    await page.screenshot({ path: `${out}/starter_gastly_a5.png` });
    await pick('SQUIRTLE');
    check('SQUIRTLE: capped at A0 (its own wins: none)', (await asc()) === 0, `A${await asc()}`);
    await more(2);
    check('SQUIRTLE: > does nothing', (await asc()) === 0);
    await page.screenshot({ path: `${out}/starter_squirtle_a0.png` });
    await pick('DRATINI');
    check('DRATINI: up to A4', (await asc()) <= 4 && (await (async () => { await more(5); return asc(); })()) === 4, `A${await asc()}`);
    await pick('GASTLY');
    check('back to GASTLY: remembers A5', (await asc()) === 5, `A${await asc()}`);
    // BEGIN starts the run at the picked level and remembers it per starter
    await page.evaluate(() => { const s = window.__engine.Engine.scene; s.start(s.list[s.sel]); });
    await page.waitForTimeout(300);
    const started = await page.evaluate(() => ({ asc: G.run.ascension, starter: G.run.starter, last: G.meta.lastAscBy }));
    check('run starts at A5 with GASTLY, remembered per starter', started.asc === 5 && started.starter === 'GASTLY' && started.last.GASTLY === 5, JSON.stringify(started));

    // ---- 3. co-op lobby on the mock backend ----
    const p1 = await ctx.newPage(), p2 = await ctx.newPage(); watch(p1, 'host'); watch(p2, 'guest');
    for (const [p, name] of [[p1, 'HOST'], [p2, 'GUEST']]) {
      await p.goto(`http://localhost:${port}/?coopdev=${name}`, { waitUntil: 'load' });
      await p.waitForFunction(() => window.__ready && window.G?.meta, null, { timeout: 60000 });
    }
    // both share localStorage (same context): give each page its own meta in memory
    await p1.evaluate(() => { G.meta.ascBy = { GASTLY: 5, BULBASAUR: 3 }; G.meta.unlockedStarters = ['BULBASAUR', 'CHARMANDER', 'SQUIRTLE', 'GASTLY']; });
    await p2.evaluate(() => { G.meta.ascBy = { SQUIRTLE: 2 }; });
    const net = (p, fn, arg) => p.evaluate(async ({ fn, arg }) => { const n = await import('/src/scenes/coop/mocknet.js'); return n[fn](...arg); }, { fn, arg });
    const r = await net(p1, 'createRoom', [{ ascension: 5, world: 'kanto' }]);
    await net(p2, 'joinRoom', [r.code]);
    // the lobby scene on both pages (it polls the room)
    for (const p of [p1, p2]) await p.evaluate(async (roomId) => {
      const { CoopLobbyScene } = await import('/src/scenes/coop/lobby.js');
      const s = new CoopLobbyScene(); window.__engine.setScene(s);
      for (let i = 0; i < 50 && !s.net; i++) await new Promise(res => setTimeout(res, 100));
      s.openRoom(roomId);
    }, r.roomId);
    await p1.waitForTimeout(800);
    // starter picks through the lobby's own code path (it sends ascMax from this player's meta)
    const lobbyPick = (p, sp) => p.evaluate(async (sp) => { const s = window.__engine.Engine.scene; const { ascUnlocked } = await import('/src/game/unlocks.js'); await s.act(n => n.setStarter(s.roomId, sp, ascUnlocked(G.meta, sp))); await s.poll(); }, sp);
    await lobbyPick(p1, 'GASTLY');
    let room = await net(p1, 'getRoom', [r.roomId]);
    check('host picks GASTLY (A5): room stays A5', room.room.ascension === 5, `A${room.room.ascension}`);
    await lobbyPick(p2, 'SQUIRTLE');
    room = await net(p1, 'getRoom', [r.roomId]);
    check('guest picks SQUIRTLE (A2): room drops to A2', room.room.ascension === 2, `A${room.room.ascension}`);
    await net(p1, 'configure', [r.roomId, { ascension: 5 }]);
    room = await net(p1, 'getRoom', [r.roomId]);
    check('host asks for A5: clamped to A2', room.room.ascension === 2, `A${room.room.ascension}`);
    await p1.evaluate(() => window.__engine.Engine.scene.poll());
    await p1.waitForTimeout(500);
    const hostCap = await p1.evaluate(() => { const s = window.__engine.Engine.scene, v = s.view; return v ? v.room.ascension : null; });
    check('host lobby shows A2', hostCap === 2);
    await p1.mouse.move(2 * 300, 2 * 215);
    await p1.waitForTimeout(300);
    await p1.screenshot({ path: `${out}/coop_lobby_cap.png` });
  } catch (e) { check('harness: ' + e.message, false); }
  console.log(errors.length ? 'PAGE ERRORS:\n' + errors.join('\n') : 'no page errors');
  console.log(fails.length ? `FAILED: ${fails.length}` : 'all checks passed');
  await browser.close(); server.kill();
  process.exit(fails.length || errors.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
