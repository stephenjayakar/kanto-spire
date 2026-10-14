// Co-op lobby starter grid: every unlocked starter must be on screen and pickable ("in coop, can't select all the
// pokemon": the lobby drew only the first 16 tiles, so TORCHIC, MUDKIP, DRATINI, LARVITAR and BELDUM could not be
// picked with all 21 unlocked). Muted Chrome, ?coopdev mock backend, two tabs (host + guest):
//  - starterGrid(n) keeps every tile inside the CHOOSE YOUR PARTNER panel, without overlaps, for 1-22 starters (2 rows of 11 icons; more would need 3 shorter rows);
//  - with all 21 unlocked the host clicks every tile; each click picks that starter and the guest's room view shows it.
//   node tests/coop_starter_grid.cjs [port=8147] [outdir=tests/out/coop_starter_grid]
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const port = +(process.argv[2] || 8147), out = process.argv[3] || 'tests/out/coop_starter_grid';
const root = path.resolve(__dirname, '..');
fs.mkdirSync(out, { recursive: true });

(async () => {
  const server = spawn(process.execPath, [path.join(root, 'serve.cjs'), String(port)], { cwd: root, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 700));
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio'] });
  const errors = [], fails = [];
  const check = (label, ok, info = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${label} ${info}`); if (!ok) fails.push(label); };
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const open = async (name, query) => {
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(`${name}: ${e.message}`));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`${name}: ${m.text()}`); });
    await page.route('**/cloud.json', r => r.fulfill({ status: 404, body: '' }));
    await page.goto(`http://localhost:${port}/${query}`, { waitUntil: 'load' });
    await page.evaluate(async () => {
      const { STARTERS } = await import('/src/game/acts.js');
      localStorage.clear();
      localStorage.setItem('kantospire.meta.v1', JSON.stringify({ tutorialDone: true, seenVersion: 'v9', unlockedStarters: STARTERS.map(s => s.species), starterVer: 2 }));
    });
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => window.__ready && window.G?.meta && window.__engine, null, { timeout: 60000 });
    return page;
  };
  const toPage = async (page, x, y) => { const r = await page.evaluate(() => { const c = document.getElementById('game').getBoundingClientRect(); return { l: c.left, t: c.top, w: c.width, h: c.height }; }); return [r.l + x / 640 * r.w, r.t + y / 360 * r.h]; };
  try {
    const p1 = await open('host', '?coopdev=HOST'), p2 = await open('guest', '?coopdev=GUEST');
    // layout: every tile inside the panel, no overlaps
    const bad = await p1.evaluate(async () => {
      const { starterGrid, STARTER_GRID: g } = await import('/src/scenes/coop/lobby.js');
      const out = [];
      for (let n = 1; n <= 22; n++) {
        const gr = starterGrid(n), cells = [...Array(n).keys()].map(i => gr.cell(i));
        cells.forEach((c, i) => {
          if (c.x < g.x0 || c.y < g.y0 || c.x + gr.tw > g.x0 + g.w || c.y + gr.th > g.y0 + g.h) out.push(`n=${n} tile ${i} outside`);
          for (let j = 0; j < i; j++) { const d = cells[j]; if (c.x < d.x + gr.tw && d.x < c.x + gr.tw && c.y < d.y + gr.th && d.y < c.y + gr.th) out.push(`n=${n} tiles ${j}/${i} overlap`); }
        });
        if ((gr.tw < 32 || gr.th < 32) && !gr.big) out.push(`n=${n} tiles ${gr.tw}px wide (icons are 32)`);
      }
      return out;
    });
    check('starterGrid keeps 1-22 tiles inside the panel, apart, >= 32px', !bad.length, bad.slice(0, 5).join('; '));

    const net = (pg, fn, arg) => pg.evaluate(async ({ fn, arg }) => { const n = await import('/src/scenes/coop/mocknet.js'); return n[fn](...arg); }, { fn, arg });
    const r = await net(p1, 'createRoom', [{ ascension: 0, world: 'kanto' }]);
    await net(p2, 'joinRoom', [r.code]);
    await p1.evaluate(async (roomId) => {
      const { CoopLobbyScene } = await import('/src/scenes/coop/lobby.js');
      const s = new CoopLobbyScene(); window.__engine.setScene(s);
      for (let i = 0; i < 50 && !s.net; i++) await new Promise(res => setTimeout(res, 100));
      s.openRoom(roomId);
    }, r.roomId);
    await p1.bringToFront();
    await p1.waitForFunction(() => window.__engine.Engine.scene.grid, null, { timeout: 30000 });
    const list = await p1.evaluate(async () => {
      const { availableStarters } = await import('/src/game/unlocks.js'); const { D } = await import('/src/game/data.js');
      return availableStarters(window.G.meta, 'spire', s => !!D.species[s]);
    });
    check('all 21 starters unlocked', list.length === 21, String(list.length));
    await p1.screenshot({ path: `${out}/lobby_21.png` });
    const guestSees = () => net(p2, 'getRoom', [r.roomId]).then(v => v.members.find(m => m.slot === 0)?.starter);
    let picked = 0;
    for (let i = 0; i < list.length; i++) {
      const c = await p1.evaluate((i) => { const g = window.__engine.Engine.scene.grid, c = g.cell(i); return [c.x + g.tw / 2, c.y + g.th / 2]; }, i);
      await p1.mouse.click(...await toPage(p1, ...c));
      const sp = list[i];
      await p1.waitForFunction((sp) => { const v = window.__engine.Engine.scene.view; return v?.members?.find(x => x.slot === v.me)?.starter === sp && !window.__engine.Engine.scene.busy; }, sp, { timeout: 15000, polling: 50 }).catch(() => {});
      const g = await guestSees();
      if (g === sp) picked++; else check(`tile ${i} (${sp}) picks it for the host and the guest sees it`, false, `guest sees ${g}`);
    }
    check('every tile is pickable and synced to the other player', picked === list.length, `${picked}/${list.length}`);
    check('the last one (BELDUM) is the host\'s pick', (await guestSees()) === 'BELDUM');
    await p1.screenshot({ path: `${out}/lobby_beldum.png` });
  } catch (e) { check('harness: ' + e.message, false); }
  console.log(errors.length ? 'PAGE ERRORS:\n' + errors.join('\n') : 'no page errors');
  console.log(fails.length ? `FAILED: ${fails.length}` : 'all checks passed');
  await browser.close(); server.kill();
  process.exit(fails.length || errors.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
