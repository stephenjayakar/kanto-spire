// Boot: engine, fonts, data, audio, then the title screen.
import { initEngine, setScene } from './engine/core.js';
import { loadFonts } from './engine/font.js';
import { loadJSON, preload } from './engine/assets.js';
import { loadData } from './game/data.js';
import { loadMeta, G, saveKeys, setSaveScope } from './game/state.js';
import { GFX } from './scenes/common.js';
import { Sound } from './audio/sound.js';
import { TitleScene } from './scenes/title.js';
import { initCloud, Cloud, signedIn, signIn, authToken, packManifest, dropAuth, pendingInvite } from './net/cloud.js';
import { loadPacks } from './net/assetpack.js';
import * as flow from './scenes/flow.js';
import * as engine from './engine/core.js';
import { CRT } from './engine/crt.js';
import { startPresence } from './net/presence.js';

async function boot() {
  // /privacy (the host serves this page for every path): the privacy policy, no game.
  if (/\/privacy(\.html)?\/?$/.test(location.pathname)) {
    document.getElementById('loading')?.remove(); document.getElementById('game').hidden = true;
    document.body.classList.add('page'); document.getElementById('privacy').hidden = false;
    return;
  }
  const canvas = document.getElementById('game');
  initEngine(canvas);
  canvas.focus();
  await initCloud({
    saveKeys,
    onAccount(email) {
      setSaveScope(email);
      // One-time move of a pre-email (unscoped) local save into this account, then retire it.
      for (const [legacy, scoped] of [['kantospire.meta.v1', saveKeys.meta], ['kantospire.run.v1', saveKeys.run]]) {
        const old = localStorage.getItem(legacy);
        if (old !== null && localStorage.getItem(scoped) === null) localStorage.setItem(scoped, old);
        localStorage.removeItem(legacy);
      }
    },
  });
  // Signed out: show the plain sign-in page. Nothing from the ROM is requested until the server
  // has accepted the account.
  if (Cloud.url && !signedIn()) return showSignIn();
  if (Cloud.packs) {
    const loading = document.getElementById('loading');
    try {
      await loadPacks({
        siteUrl: Cloud.siteUrl, token: await authToken(), list: await packManifest(),
        onProgress: (n, total) => { if (loading) loading.textContent = `Loading game data... ${(n / 1048576).toFixed(1)} / ${(total / 1048576).toFixed(1)} MB`; },
      });
    } catch (e) {
      if (e.status === 401 || e.status === 403) { dropAuth(e.message); return showSignIn(); }
      throw e;
    }
  }
  loadMeta();
  engine.setDisplayMode(G.meta.settings.display);
  CRT.setCurve(G.meta.settings.crtCurve);
  CRT.set(G.meta.settings.crt);
  const soundP = Sound.init('assets/sound/', { quality: G.meta.settings.audioQuality === 'gba' ? 'gba' : 'hq', stereo: G.meta.settings.stereo !== false }).then(() => {
    const s = G.meta.settings;
    Sound.setMusicVolume(s.music); Sound.setSfxVolume(s.sfx);
  }).catch(e => console.warn('audio init failed', e));
  await Promise.all([
    loadFonts(),
    loadData(f => loadJSON('data/' + f)),
    loadJSON('gfx/manifest.json').then(m => { GFX.manifest = m; }).catch(() => {}),
    preload(['gfx/ui/title/title_screen.png', 'gfx/ui/title/logo.png', 'gfx/ui/title/charizard.png', 'gfx/ui/text_window/type1.png', 'gfx/ui/text_window/std.png']),
  ]);
  document.getElementById('loading')?.remove();
  window.G = G; // handy for debugging / tests
  window.__runLogs = () => import('./game/state.js').then(m => m.storedRunLogs());
  window.__sound = Sound;
  window.__flow = flow; window.__engine = engine;
  setScene(new TitleScene());
  startPresence(); // NOW PLAYING heartbeat (does nothing offline / signed out)
  await soundP;
  window.__ready = true;
}

function showSignIn() {
  document.getElementById('loading')?.remove();
  document.getElementById('game').hidden = true;
  const page = document.getElementById('signin');
  page.hidden = false;
  const btn = document.getElementById('signin-btn'), err = document.getElementById('signin-error');
  err.textContent = Cloud.error || '';
  if (pendingInvite()) document.getElementById('signin-msg').textContent = 'You have been invited! Sign in with Google to join.';
  btn.onclick = () => {
    btn.disabled = true; btn.textContent = 'Opening Google...';
    signIn().catch(e => { err.textContent = e.message; btn.disabled = false; btn.textContent = 'Sign in with Google'; });
  };
  window.__ready = true;
}

boot().catch(e => {
  console.error(e);
  const el = document.getElementById('loading');
  if (el) el.textContent = 'Failed to load: ' + e.message + ' (run tools/extract_*.js first?)';
});
