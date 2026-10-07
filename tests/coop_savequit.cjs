// Co-op SAVE & QUIT -> REJOIN on the ?coopdev mock backend (v0.3.6): two pages of one muted Chrome = two players.
// P1 clicks SAVE & QUIT on the co-op map: "Saved!" toast, back to the title, the partner sees "SAVED & QUIT".
// P1 opens CO-OP and clicks the room in the REJOIN list: the game loads from the checkpoint, same state as P2's.
//   node tests/coop_savequit.cjs [port=8152]        Screenshots: tests/out/savequit/*.png
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const PORT = +(process.argv[2] || 8152);
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'tests/out/savequit');
const BASE = `http://localhost:${PORT}/`;
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const fails = [];
const check = (label, ok, extra = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${extra ? ' ' + extra : ''}`); if (!ok) fails.push(label); return ok; };

// click at game coordinates (640x360 canvas space)
async function clickGame(page, gx, gy) {
  const r = await page.evaluate(() => { const b = document.getElementById('game').getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; });
  const x = r.x + gx * r.w / 640, y = r.y + gy * r.h / 360;
  await page.mouse.move(x, y); await sleep(60);
  await page.mouse.down(); await sleep(60); await page.mouse.up(); await sleep(120);
}
const scene = (page) => page.evaluate(() => window.__engine?.Engine.scene?.constructor?.name || null);
const until = (page, fn, arg, ms = 30000) => page.waitForFunction(fn, arg, { timeout: ms, polling: 150 });

(async () => {
  const server = spawn(process.execPath, ['serve.cjs', String(PORT)], { cwd: ROOT, stdio: 'ignore' });
  await sleep(600);
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  const open = async (name) => {
    const p = await ctx.newPage();
    p.on('pageerror', e => errors.push(`${name}: ${e.message}`));
    p.on('console', m => { if (m.type() === 'error') errors.push(`${name}: ${m.text()}`); });
    await p.goto(`${BASE}?coopdev=${name}`);
    await until(p, () => window.__ready === true, null, 60000);
    return p;
  };
  try {
    const A = await open('ALICE'), B = await open('BOB');
    // set up the room through the mock backend (the lobby UI isn't what this test is about)
    const room = await A.evaluate(async () => {
      const net = await import('./src/scenes/coop/mocknet.js');
      const r = await net.createRoom({ ascension: 0, world: 'spire' });
      await net.setStarter(r.roomId, 'BULBASAUR', 0);
      return r;
    });
    await B.evaluate(async (code) => { const net = await import('./src/scenes/coop/mocknet.js'); const j = await net.joinRoom(code); await net.setStarter(j.roomId, 'CHARMANDER', 0); }, room.code);
    await A.evaluate(async (id) => { const net = await import('./src/scenes/coop/mocknet.js'); await net.startRoom(id); }, room.roomId);
    // both open the room from the CO-OP lobby (hands off to the co-op session once it's playing)
    for (const p of [A, B]) await p.evaluate(async (id) => { const { CoopLobbyScene } = await import('./src/scenes/coop/lobby.js'); window.__engine.setScene(new CoopLobbyScene({ roomId: id })); }, room.roomId);
    for (const p of [A, B]) await until(p, () => window.__engine.Engine.scene?.constructor?.name === 'CoopMapScene' && window.__coop?.synced);
    check('both players on the co-op map', true);
    // the first checkpoint (seq 1) is written when the room is first opened
    await until(A, () => window.__coop.cpSeq >= 1);
    check('room got its first checkpoint on open', true);
    // P2 votes for a node (P1 hasn't yet): the save must keep that vote
    const node = await B.evaluate(() => window.__coop.game.reachable()[0]);
    await B.evaluate((n) => window.__coop.vote(n), node);
    await until(A, (n) => window.__coop.game.votes[1] === n, node);
    await sleep(800);
    const before = await A.evaluate(() => ({ seq: window.__coop.game.seq, ck: window.__coop.game.checksum() >>> 0, cp: window.__coop.cpSeq }));
    check('vote is newer than the last checkpoint', before.cp < before.seq, JSON.stringify(before));
    await A.screenshot({ path: path.join(OUT, '1_map_before_save.png') });
    // P1 clicks SAVE & QUIT (bottom left, above the sketch buttons)
    await clickGame(A, 8 + 73, 360 - 62 + 9);
    await sleep(500);
    await A.screenshot({ path: path.join(OUT, '2_saving.png') });
    await until(A, () => window.__engine.Engine.scene?.constructor?.name === 'TitleScene', null, 15000);
    check('SAVE & QUIT returned P1 to the title', true);
    // the partner sees it
    await until(B, () => window.__coop.members.find(m => m.slot === 0)?.saved === true, null, 15000);
    await sleep(800);
    await B.screenshot({ path: path.join(OUT, '3_partner_sees_saved.png') });
    const chip = await B.evaluate(async () => { const ui = await import('./src/scenes/coop/ui.js'); return ui.playerStatus(window.__coop, 0).label; });
    check('partner sees SAVED & QUIT', chip === 'SAVED & QUIT', chip);
    // P1: CO-OP lobby -> click the room in the REJOIN list
    await A.evaluate(async () => { const { CoopLobbyScene } = await import('./src/scenes/coop/lobby.js'); window.__engine.setScene(new CoopLobbyScene()); });
    await until(A, () => Array.isArray(window.__engine.Engine.scene.rooms) && window.__engine.Engine.scene.rooms.length > 0);
    await sleep(300);
    await A.screenshot({ path: path.join(OUT, '4_rejoin_list.png') });
    const row = await A.evaluate(() => window.__engine.Engine.scene.rooms[0]);
    check('REJOIN list shows the act and the save', !!row.progress && row.members.some(m => m.saved), `${row.progress} / ${row.members.map(m => m.name + (m.saved ? '(saved)' : '')).join(', ')}`);
    await clickGame(A, 400, 100);
    await until(A, () => window.__engine.Engine.scene?.constructor?.name === 'CoopMapScene' && window.__coop?.synced, null, 30000);
    const after = await A.evaluate(() => ({ seq: window.__coop.game.seq, ck: window.__coop.game.checksum() >>> 0, mode: window.__coop.resumed?.mode }));
    const partner = await B.evaluate(() => ({ seq: window.__coop.game.seq, ck: window.__coop.game.checksum() >>> 0 }));
    check('REJOIN resumed from the checkpoint', after.mode === 'checkpoint', JSON.stringify(after));
    check('same game as before quitting and as the partner', after.ck === before.ck && after.ck === partner.ck, `${before.ck} ${after.ck} ${partner.ck}`);
    check('the save kept the vote of P2', await A.evaluate((n) => window.__coop.game.votes[1] === n, node));
    // P1 votes the same node: the node starts on both clients, still in sync
    await A.evaluate((n) => window.__coop.vote(n), node);
    for (const p of [A, B]) await until(p, () => window.__coop.game.phase !== 'map');
    await sleep(1500);
    const [ca, cb] = await Promise.all([A, B].map(p => p.evaluate(() => [window.__coop.game.seq, window.__coop.game.checksum() >>> 0, !!window.__coop.desync])));
    check('play goes on in sync after REJOIN', ca[0] === cb[0] && ca[1] === cb[1] && !ca[2] && !cb[2], JSON.stringify([ca, cb]));
    await sleep(800);
    await A.screenshot({ path: path.join(OUT, '5_rejoined.png') });
    await until(B, () => !window.__coop.members.find(m => m.slot === 0)?.saved, null, 15000);
    check('partner sees P1 back', true);
  } catch (e) {
    check('run', false, e.message);
  } finally {
    const bad = errors.filter(e => !/favicon|404|AudioContext|audio/i.test(e));
    check('no page errors', !bad.length, bad.slice(0, 5).join(' | '));
    await browser.close();
    server.kill();
    console.log(fails.length ? `${fails.length} FAILED` : 'SAVE & QUIT flow ok');
    process.exit(fails.length ? 1 : 0);
  }
})();
