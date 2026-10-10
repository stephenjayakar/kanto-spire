// Muted browser check of SETTINGS > AUDIO STYLE: RETRO (Pokemon Red / Silver music on the Game Boy engine).
//   node tests/retro_music.cjs [port=8127]
// Offline (cloud.json 404s, so the game runs on local web/assets). Checks:
//  - the default is HQ and nothing from assets/retro/ is fetched until RETRO is picked;
//  - clicking RETRO loads the bank, restarts the playing song as its Game Boy version (one engine at a time) and saves;
//  - songs resolve by context (a KANTO wild battle -> red:WildBattle, a JOHTO act's map -> Silver's Route 29, an
//    unmapped song -> back on m4a), fanfares end, and the engine really outputs sound (AnalyserNode on the master);
//  - HQ switches back to the GBA soundtrack; a reload with RETRO saved boots straight into RETRO (Red's title theme);
//  - no page errors. Screenshot: tests/out/retro/settings_audio_style.png (RETRO's tooltip showing).
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const port = +(process.argv[2] || 8127), root = path.resolve(__dirname, '..');
const OUT = path.join(root, 'tests/out/retro');
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const server = spawn(process.execPath, [path.join(root, 'serve.cjs'), String(port)], { cwd: root, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 600));
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.route('**/cloud.json', r => r.fulfill({ status: 404, body: 'offline' }));
  const errors = [], retroFetches = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (process.env.VERBOSE && m.type() !== 'log') console.log('[console]', m.type(), m.text()); if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  page.on('request', r => { if (r.url().includes('/assets/retro/')) retroFetches.push(r.url()); });
  const checks = [];
  const check = (ok, what, info = '') => { checks.push(ok); console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${info ? '  ' + info : ''}`); };

  await page.goto(`http://localhost:${port}/`);
  await page.evaluate(() => localStorage.clear()); await page.reload();
  await page.waitForFunction(() => window.__ready && window.G?.meta, null, { timeout: 60000 });
  const boot = await page.evaluate(() => ({ quality: __sound.quality, retro: __sound.retro, saved: G.meta.settings.audioQuality, backend: __sound.backend }));
  check(boot.quality === 'hq' && boot.saved === 'hq' && !boot.retro.on, 'default AUDIO STYLE is HQ', JSON.stringify(boot));
  check(retroFetches.length === 0, 'no RETRO download before RETRO is picked');

  // a level meter on the master output (the page is muted; the graph still runs)
  await page.evaluate(() => {
    const ctx = __sound.context, an = ctx.createAnalyser(); an.fftSize = 2048; __sound.output.connect(an);
    window.__level = () => { const b = new Float32Array(an.fftSize); an.getFloatTimeDomainData(b); let s = 0; for (const v of b) s += v * v; return Math.sqrt(s / b.length); };
  });
  const click = async (x, y) => {
    const r = await page.evaluate(() => { const c = document.getElementById('game').getBoundingClientRect(); return { l: c.left, t: c.top, w: c.width, h: c.height }; });
    await page.mouse.click(r.l + x / 640 * r.w, r.t + y / 360 * r.h); await page.waitForTimeout(250);
  };
  const move = async (x, y) => {
    const r = await page.evaluate(() => { const c = document.getElementById('game').getBoundingClientRect(); return { l: c.left, t: c.top, w: c.width, h: c.height }; });
    await page.mouse.move(r.l + x / 640 * r.w, r.t + y / 360 * r.h); await page.waitForTimeout(200);
  };
  await page.evaluate(async () => { const { SettingsModal } = await import('/src/scenes/title.js'); window.__engine.pushOverlay(new SettingsModal({})); __sound.playBGM('mus_route1'); });
  await page.waitForTimeout(500);
  // AUDIO STYLE row: the modal is 280x268, centred; buttons HQ / GBA / RETRO at x+110, x+147, x+184 (y+132)
  const x = (640 - 280) / 2, y = (360 - 268) / 2, by = y + 142;
  const BTN = { hq: x + 110 + 17, gba: x + 147 + 17, retro: x + 184 + 23 };

  await click(BTN.retro, by);
  await page.waitForFunction(() => __sound.retro.loaded && __sound.retro.song, null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(700);
  const r1 = await page.evaluate(() => ({ quality: __sound.quality, retro: __sound.retro, m4a: __sound.currentBGM, saved: G.meta.settings.audioQuality, level: __level() }));
  check(r1.quality === 'retro' && r1.saved === 'retro', 'RETRO picked and saved', JSON.stringify({ q: r1.quality, saved: r1.saved }));
  check(r1.retro.song === 'red:Routes1' && r1.m4a === null, 'the playing song restarts as Red\'s ROUTE 1 theme, m4a BGM stopped', JSON.stringify(r1.retro) + ' m4a=' + r1.m4a);
  check(r1.retro.backend === boot.backend, 'Game Boy engine runs on the same backend as m4a', `${r1.retro.backend} (m4a: ${boot.backend}; headless Chrome here times out AudioWorklet modules)`);
  check(retroFetches.some(u => u.endsWith('retro.json')) && retroFetches.some(u => u.endsWith('red.bin')), 'RETRO bank fetched on demand', retroFetches.length + ' files');
  check(r1.level > 0.003, 'the Game Boy engine is making sound', 'rms ' + r1.level.toFixed(4));
  await move(BTN.retro, by);
  await page.screenshot({ path: path.join(OUT, 'settings_audio_style.png') });

  // context mapping and fanfares
  const r2 = await page.evaluate(async () => {
    const out = {};
    __sound.playBGM('mus_vs_wild', { ctx: { kind: 'wild' } }); out.wild = __sound.retro.song;
    out.fanfare = await __sound.playFanfare('mus_level_up'); out.afterFanfare = __sound.retro.song;
    const johto = { id: 1, region: 'johto', music: ['mus_route1', 'mus_route3'], townMusic: 'mus_pallet' };
    G.run = G.run || null; const saved = G.run;
    G.run = { act: johto, timeOfDay: () => 'day' };
    __sound.playBGM('mus_route1', { ctx: { map: 0 } }); out.johtoMap = __sound.retro.song;
    __sound.playBGM('mus_vs_trainer', { ctx: { kind: 'trainer', music: 'mus_vs_trainer', trainer: { key: 'JOHTO_X', className: 'YOUNGSTER' } } }); out.johtoTrainer = __sound.retro.song;
    G.run = saved;
    __sound.playBGM('mus_berry_pick_nope'); out.unmapped = __sound.retro.song;
    return out;
  });
  check(r2.wild === 'red:WildBattle', 'KANTO wild battle -> red:WildBattle', r2.wild);
  check(r2.fanfare === true && r2.afterFanfare === 'red:WildBattle', 'level-up fanfare plays on the Game Boy engine and ends', JSON.stringify(r2.fanfare));
  check(r2.johtoMap === 'silver:Route29' && r2.johtoTrainer === 'silver:JohtoTrainerBattle', 'JOHTO act -> Pokemon Silver songs', r2.johtoMap + ', ' + r2.johtoTrainer);
  check(r2.unmapped === null, 'a song RETRO has no match for leaves the Game Boy engine', String(r2.unmapped));

  // back to HQ: the same song on m4a, Game Boy engine stopped
  await page.evaluate(() => __sound.playBGM('mus_route1'));
  await page.waitForTimeout(300);
  await click(BTN.hq, by);
  await page.waitForTimeout(300);
  const r3 = await page.evaluate(() => ({ quality: __sound.quality, retro: __sound.retro, m4a: __sound.currentBGM, saved: G.meta.settings.audioQuality }));
  check(r3.quality === 'hq' && r3.saved === 'hq' && r3.retro.song === null && r3.m4a === 'mus_route1', 'HQ: back on the GBA soundtrack, no double playback', JSON.stringify(r3));
  await click(BTN.gba, by);
  const r4 = await page.evaluate(() => ({ quality: __sound.quality, saved: G.meta.settings.audioQuality, retro: __sound.retro.song }));
  check(r4.quality === 'gba' && r4.saved === 'gba' && r4.retro === null, 'GBA mode picks the console mixer', JSON.stringify(r4));

  // reload with RETRO saved: boots into RETRO, the title plays Red's title theme
  await click(BTN.retro, by);
  await page.reload();
  await page.waitForFunction(() => window.__ready && window.G?.meta, null, { timeout: 60000 });
  await page.waitForFunction(() => __sound.retro.loaded, null, { timeout: 15000 }).catch(() => {});
  await page.evaluate(() => __sound.playBGM('mus_title'));
  await page.waitForTimeout(300);
  const r5 = await page.evaluate(() => ({ quality: __sound.quality, retro: __sound.retro }));
  check(r5.quality === 'retro' && r5.retro.song === 'red:TitleScreen', 'reload keeps RETRO; title = Red\'s title theme', JSON.stringify(r5));

  check(errors.length === 0, 'no page errors', errors.join(' | '));
  const ok = checks.every(Boolean);
  console.log(ok ? 'RETRO MUSIC OK' : 'RETRO MUSIC FAILED');
  await browser.close(); server.kill(); process.exit(ok ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
