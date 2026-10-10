// Muted Chrome check of the Emerald assets in HOENN acts: the Emerald music bank loads, HOENN acts start Emerald songs
// (which song the engine starts: you can't hear it, the tab is muted), Emerald's leaders show their teams and portraits,
// KANTO acts keep FireRed's songs, and without the Emerald files everything falls back to FireRed's.
//   node tests/emerald_browser.cjs [port=8131]      screenshots: tests/out/emerald/
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const port = +(process.argv[2] || 8131);
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'tests/out/emerald');
fs.mkdirSync(out, { recursive: true });

async function session(browser, { noEmerald = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('CONSOLE ' + m.text()); });
  await page.route('**/cloud.json', r => r.fulfill({ status: 404, body: '' })); // offline: no Convex
  if (noEmerald) await page.route(/\/assets\/.*\/emerald\//, r => r.fulfill({ status: 404, body: '' }));
  await page.goto(`http://localhost:${port}/`, { waitUntil: 'load' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.__ready && window.G?.meta, null, { timeout: 60000 });
  const rect = await page.evaluate(() => { const r = document.getElementById('game').getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height }; });
  await page.mouse.click(rect.l + 620 / 640 * rect.w, rect.t + 200 / 360 * rect.h); // one gesture unlocks the audio
  await page.evaluate(() => { Object.assign(G.meta, { tutorialDone: true, tipCatch: true, seenVersion: 'v9', hintBattles: 9 }); });
  return { page, ctx, errors, rect };
}

// A spire run in `regions` at act `act`, standing before the act's first node.
const setup = (page, o) => page.evaluate(async (o) => {
  const { Run } = await import('/src/game/run.js');
  const r = Run.create({ starter: o.starter || 'TREECKO', seed: o.seed || 'EMBROWSER', world: 'spire', regions: { acts: o.acts, summit: o.summit || o.acts[3], post: o.acts[3] } });
  if (o.act) r.startAct(o.act);
  for (const m of r.party) m.level = 60;
  G.run = r;
  (await import('/src/scenes/flow.js')).goToMap();
  return true;
}, o);
const bgm = (page) => page.evaluate(() => window.__sound.currentBGM);
const shot = (page, name) => page.screenshot({ path: path.join(out, name + '.png') });

(async () => {
  const server = spawn(process.execPath, [path.join(root, 'serve.cjs'), String(port)], { cwd: root, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 800));
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required'] });
  const results = [];
  const check = (name, ok, info = '') => { results.push({ name, ok }); console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${info ? ' -- ' + info : ''}`); };
  try {
    // ---- with the Emerald pack
    const { page, errors, rect: rect0 } = await session(browser);
    await page.waitForFunction(() => window.__sound.hasBank('em:'), null, { timeout: 20000 }).catch(() => {});
    check('Emerald bank loaded', await page.evaluate(() => window.__sound.hasBank('em:')), `${await page.evaluate(() => Object.keys(window.__sound.songNames).length)} FireRed songs`);
    await setup(page, { acts: ['hoenn', 'kanto', 'hoenn', 'hoenn'] });
    await page.waitForTimeout(800);
    let s = await bgm(page);
    check('HOENN act 1 map plays Emerald ROUTE 101', s === 'em:mus_route101', s);
    await shot(page, 'hoenn_map');
    // ROXANNE (Emerald team: GEODUDE, GEODUDE, NOSEPASS)
    const boss = await page.evaluate(async () => {
      const r = G.run; r.boss = 'LEADER_ROXANNE';
      const node = Object.values(r.map.nodes).find(n => n.type === 'boss');
      const cfg = r.battleConfig(node);
      (await import('/src/scenes/flow.js')).startBattle(cfg, node);
      return { title: cfg.trainer.title, pic: cfg.trainer.pic, team: cfg.enemies.map(e => `${e.species} ${e.level}`) };
    });
    await page.waitForTimeout(100); // (the encounter song leads for 0.3 s, then the battle theme)
    const enc = await bgm(page);
    await shot(page, 'roxanne_intro');
    check('ROXANNE has her Emerald team', JSON.stringify(boss.team.map(t => t.split(' ')[0])) === '["GEODUDE","GEODUDE","NOSEPASS"]', `${boss.title}: ${boss.team.join(', ')} (pic ${boss.pic})`);
    check('leader encounter song is Emerald\'s', /^em:mus_encounter_/.test(enc), enc);
    await page.waitForTimeout(2500);
    s = await bgm(page);
    check('gym leader battle plays Emerald VS GYM LEADER', s === 'em:mus_vs_gym_leader', s);
    await shot(page, 'roxanne_battle');
    // click through the intro until her first POKéMON is out: Emerald's GEODUDE front sprite
    for (let i = 0; i < 12; i++) {
      if (await page.evaluate(() => !!window.__engine.Engine.scene?.enemyDisp?.species)) break;
      await page.mouse.click(rect0.l + 560 / 640 * rect0.w, rect0.t + 150 / 360 * rect0.h); await page.waitForTimeout(400);
    }
    await page.waitForTimeout(900);
    const foe = await page.evaluate(async () => {
      const { img, ready } = await import('/src/engine/assets.js');
      const sc = window.__engine.Engine.scene;
      const p = 'gfx/pokemon/emerald/geodude/front.png', im = img(p);
      await new Promise(r => setTimeout(r, 300));
      return { path: sc?.foePath?.(), loaded: ready(im) && !im._fb };
    });
    check('Emerald front sprite for the foe', foe.loaded && (!foe.path || foe.path.includes('/emerald/')), JSON.stringify(foe));
    await shot(page, 'roxanne_foe');
    const walker = await page.evaluate(async () => { const { img, ready } = await import('/src/engine/assets.js'); const im = img('gfx/overworld/people/emerald/roxanne.png'); await new Promise(r => setTimeout(r, 300)); return ready(im); });
    check('Emerald boss walker loads', walker);
    // JUAN (act 3's 8th leader slot)
    await setup(page, { acts: ['hoenn', 'kanto', 'hoenn', 'hoenn'], act: 2 });
    await page.waitForTimeout(500);
    s = await bgm(page);
    check('HOENN act 3 map plays an Emerald route', /^em:mus_route119/.test(s), s);
    const juan = await page.evaluate(async () => {
      const r = G.run; r.boss = 'LEADER_WALLACE';
      const node = Object.values(r.map.nodes).find(n => n.type === 'boss');
      const cfg = r.battleConfig(node);
      (await import('/src/scenes/flow.js')).startBattle(cfg, node);
      return { title: cfg.trainer.title, team: cfg.enemies.map(e => `${e.species} ${e.level}`) };
    });
    await page.waitForTimeout(400);
    await shot(page, 'juan_intro');
    check('8th leader is JUAN with KINGDRA', /JUAN/.test(juan.title) && juan.team.at(-1).startsWith('KINGDRA'), `${juan.title}: ${juan.team.join(', ')}`);
    // the HOENN summit: CHAMPION WALLACE
    await setup(page, { acts: ['kanto', 'kanto', 'kanto', 'kanto'], summit: 'hoenn', act: 3 });
    await page.waitForTimeout(500);
    s = await bgm(page);
    check('KANTO act map keeps FireRed music', s === 'mus_victory_road', s);
    const champ = await page.evaluate(async () => {
      const r = G.run; r.gauntletIndex = 4;
      const cfg = r.gauntletConfig(r.rng.fork('t'), 4);
      const node = Object.values(r.map.nodes).find(n => n.type === 'boss');
      (await import('/src/scenes/flow.js')).startBattle(cfg, node);
      return { title: cfg.trainer.title, team: cfg.enemies.map(e => `${e.species} ${e.level}`), rule: cfg.bossRule };
    });
    await page.waitForTimeout(100);
    const cenc = await bgm(page);
    await shot(page, 'wallace_intro');
    await page.waitForTimeout(2500);
    s = await bgm(page);
    check('HOENN CHAMPION WALLACE (Emerald team, MARVEL SCALE)', champ.title === 'CHAMPION WALLACE' && champ.team.at(-1).startsWith('MILOTIC') && champ.rule === 'WALLACE_CHAMPION', `${champ.team.join(', ')}`);
    check('champion music: Emerald encounter + VS CHAMPION in a KANTO act 4 with the HOENN summit', cenc === 'em:mus_encounter_champion' && s === 'em:mus_vs_champion', `${cenc} -> ${s}`);
    await shot(page, 'wallace_battle');
    check('no page errors', !errors.length, errors.slice(0, 3).join(' | '));
    await page.context().close();

    // ---- without the Emerald files: FireRed fallbacks
    const b = await session(browser, { noEmerald: true });
    await b.page.waitForTimeout(1500);
    check('no Emerald bank -> not loaded', !(await b.page.evaluate(() => window.__sound.hasBank('em:'))));
    await setup(b.page, { acts: ['hoenn', 'kanto', 'hoenn', 'hoenn'] });
    await b.page.waitForTimeout(600);
    s = await bgm(b.page);
    check('fallback: HOENN act 1 plays FireRed ROUTE 1', s === 'mus_route1', s);
    await b.page.evaluate(async () => {
      const r = G.run; r.boss = 'LEADER_ROXANNE';
      const node = Object.values(r.map.nodes).find(n => n.type === 'boss');
      (await import('/src/scenes/flow.js')).startBattle(r.battleConfig(node), node);
    });
    await b.page.waitForTimeout(3000);
    s = await bgm(b.page);
    check('fallback: gym leader battle plays FireRed VS GYM LEADER', s === 'mus_vs_gym_leader', s);
    await shot(b.page, 'fallback_roxanne_battle');
    check('fallback: no page errors', !b.errors.length, b.errors.slice(0, 3).join(' | '));
  } catch (e) {
    console.error(e); results.push({ name: 'exception', ok: false });
  } finally {
    await browser.close(); server.kill();
  }
  const bad = results.filter(r => !r.ok);
  console.log(bad.length ? `${bad.length} FAILED` : `all ${results.length} checks ok`);
  process.exit(bad.length ? 1 : 0);
})();
