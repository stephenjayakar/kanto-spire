// Muted browser check: the game boots without errors, the sound backend comes up, and SETTINGS > AUDIO STYLE
// (HQ by default) switches HQ -> GBA -> HQ by click and is saved. (RETRO: tests/retro_music.cjs)
//   node tests/audio_toggle.cjs [port=8119]
const { spawn } = require('child_process');
const path = require('path');
const { chromium } = require('playwright');
const port = +(process.argv[2] || 8119), root = path.resolve(__dirname, '..');
(async () => {
  const server = spawn(process.execPath, [path.join(root, 'serve.cjs'), String(port)], { cwd: root, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 600));
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.route('**/cloud.json', r => r.fulfill({ status: 404, body: 'offline' }));
  await page.goto(`http://localhost:${port}/`);
  await page.evaluate(() => localStorage.clear()); await page.reload();
  await page.waitForFunction(() => window.__ready && window.G?.meta, null, { timeout: 60000 });
  const info = await page.evaluate(() => ({ backend: window.__sound.backend, quality: window.__sound.quality, saved: G.meta.settings.audioQuality }));
  console.log('boot:', JSON.stringify(info));
  const click = async (x, y) => { const r = await page.evaluate(() => { const c = document.getElementById('game').getBoundingClientRect(); return { l: c.left, t: c.top, w: c.width, h: c.height }; }); await page.mouse.click(r.l + x / 640 * r.w, r.t + y / 360 * r.h); await page.waitForTimeout(250); };
  await page.evaluate(async () => { const { SettingsModal } = await import('/src/scenes/title.js'); window.__engine.pushOverlay(new SettingsModal({})); window.__sound.playBGM('mus_vs_champion'); });
  await page.waitForTimeout(400);
  const y = (360 - 268) / 2, x = (640 - 280) / 2; // AUDIO STYLE buttons: HQ x+110, GBA x+147, RETRO x+184 (y+132, 20 high)
  await click(x + 147 + 17, y + 142);
  const after = await page.evaluate(() => ({ quality: window.__sound.quality, saved: G.meta.settings.audioQuality }));
  require('fs').mkdirSync('tests/out/v006', { recursive: true });
  await page.screenshot({ path: 'tests/out/v006/settings_audio_quality.png' });
  await click(x + 110 + 17, y + 142);
  const back = await page.evaluate(() => ({ quality: window.__sound.quality, saved: G.meta.settings.audioQuality }));
  console.log('after 1 click:', JSON.stringify(after), 'after 2 clicks:', JSON.stringify(back));
  const ok = info.quality === 'hq' && info.saved === 'hq' && after.quality === 'gba' && after.saved === 'gba' && back.quality === 'hq' && !errors.length;
  console.log(errors.length ? 'PAGE ERRORS:\n' + errors.join('\n') : 'no page errors');
  console.log(ok ? 'AUDIO TOGGLE OK' : 'AUDIO TOGGLE FAILED');
  await browser.close(); server.kill(); process.exit(ok ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
