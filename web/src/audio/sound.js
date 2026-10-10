// Kanto Spire - main-thread sound API.
//
//   import { Sound, SONG_NAMES } from './audio/sound.js';
//   await Sound.init();                 // loads assets/sound/bank.{json,bin}, sets up the worklet
//   Sound.playBGM('mus_route1');        // starts (or keeps) the BGM; queued until the first gesture
//   Sound.playSE('se_select');
//   Sound.playCry('pikachu');           // or internal species id (25), or { national: true }
//   Sound.setWavCries(sp => url|null);  // cries outside the bank, played from WAV files (the Gen 4 species)
//
// Audio only starts after a user gesture (browser autoplay policy). init() installs one-shot
// pointer/key/touch listeners that call unlock(); you may also call Sound.unlock() yourself
// from any click/keydown handler.
//
// Players (like the real game's gMPlayTable): 0 = BGM, 1-3 = SE (the song table's `ms`
// field picks the player), 4-5 = Pokemon cries. SFX/cries play over the music.

const PLAYER_BGM = 0;
const SE_PLAYERS = [1, 2, 3];
const CRY_PLAYERS = [4, 5];
const FADE_STEPS = 16; // m4a fades in/out in 16 volume steps of `speed` frames each

/** Song names available in the bank (filled by init). */
export let SONG_NAMES = [];
/** Cry mode names accepted by playCry({ mode }) (PlayCryInternal modes). */
export const CRY_MODES = ['normal', 'doubles', 'encounter', 'high_pitch', 'echo_start', 'faint', 'echo_end',
  'roar_1', 'roar_2', 'growl_1', 'growl_2', 'weak_doubles', 'weak'];

const state = {
  ctx: null, node: null, port: null, backend: null, master: null, meta: null, ready: null,
  nextTag: 1, pending: new Map(), currentBGM: null, unlocked: false,
  volumes: { master: 1, music: 1, sfx: 1 }, listenersInstalled: false, initPromise: null,
  resolver: null, banks: new Map(),
  wavCry: null, wavCache: new Map(), ducks: 0,
};
// Cries that aren't in the m4a bank (v0.4.0: the Gen 4 species' HGSS samples, sound/gen4/cries/*.wav) play as plain
// WebAudio buffers through the same master volume and SFX level, ducking the music like a bank cry does.
// Level: the HGSS samples peak near full scale, the bank's cries near 0.35 (measured on the HQ mixer).
const WAV_CRY_GAIN = 0.3, WAV_FAINT_RATE = 0.82, DUCK_VOLUME = 85 / 256;
function decodeWav(url) {
  let p = state.wavCache.get(url);
  if (!p) {
    p = fetch(url).then((r) => (r.ok ? r.arrayBuffer() : null))
      .then((b) => (b ? new Promise((res, rej) => state.ctx.decodeAudioData(b, res, rej)) : null))
      .catch((err) => { console.warn('[sound] wav cry', url, err?.message || err); return null; });
    state.wavCache.set(url, p);
  }
  return p;
}
async function playWavCry(url, o) {
  const ctx = state.ctx;
  if (!ctx || !state.master) return false;
  const buf = await decodeWav(url);
  if (!buf || ctx.state !== 'running') return false;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  let rate = o.mode === 'faint' ? WAV_FAINT_RATE : 1; // (FireRed's faint cry: lower and shorter)
  if (o.pitch !== undefined) rate *= Math.pow(2, (o.pitch - 15360) / (256 * 12));
  src.playbackRate.value = rate;
  const g = ctx.createGain();
  g.gain.value = state.volumes.sfx * ((o.volume ?? 120) / 127) * WAV_CRY_GAIN;
  src.connect(g);
  g.connect(state.master);
  const duck = o.duck !== false;
  if (duck && state.ducks++ === 0) post({ type: 'playerVolume', players: [PLAYER_BGM], volume: state.volumes.music * DUCK_VOLUME });
  return new Promise((resolve) => {
    src.onended = () => {
      if (duck && --state.ducks === 0) post({ type: 'playerVolume', players: [PLAYER_BGM], volume: state.volumes.music });
      resolve(true);
    };
    src.start();
  });
}

function post(msg, transfer) { if (state.port) state.port.postMessage(msg, transfer || []); }
// Calls made while init() is still loading are deferred until it completes. Sound must never break the
// game: with no audio (init failed or never ran) every call is a silent no-op that resolves false.
function deferred(fn) {
  return function (...args) {
    if (state.port) return fn.apply(this, args);
    if (state.initPromise) return state.initPromise.then(() => fn.apply(this, args), () => false);
    console.warn('[sound] called before Sound.init()');
    return Promise.resolve(false);
  };
}
function songInfo(name, ctx) {
  const songs = state.meta && state.meta.songs;
  if (!songs) throw new Error('Sound.init() has not finished');
  // the resolver (Sound.setResolver) may swap in a song from an added bank (HOENN acts: Emerald's, audio/emerald.js)
  if (state.resolver) {
    let alt = null;
    try { alt = state.resolver(name, ctx); } catch (err) { console.warn('[sound] resolver', err); }
    if (alt && songs[alt]) return songs[alt];
  }
  let s = songs[name];
  if (!s && songs['mus_' + name]) s = songs['mus_' + name];
  if (!s && songs['se_' + name]) s = songs['se_' + name];
  // A missing song must never break the game (an exception here once froze the rival battle): warn and play nothing.
  if (!s) { console.warn(`[sound] unknown song "${name}"`); return null; }
  return s;
}
// Awaitable sounds resolve on the engine's 'end' event. Scenes await some of them (fanfares), so they must
// always settle: a newer song on the same player replaces the old one without an 'end', and a suspended
// context (no gesture yet, a backgrounded tab) renders nothing, so each one also settles when replaced,
// right away while audio isn't running, and after maxMs at the latest.
const playerTags = new Map(); // player -> pending tag
function settle(tag, v = false) {
  const res = state.pending.get(tag);
  if (res) { state.pending.delete(tag); res(v); }
}
function track(tag, player, maxMs) {
  const p = new Promise((resolve) => state.pending.set(tag, resolve));
  if (player !== undefined) {
    const old = playerTags.get(player);
    if (old !== undefined) settle(old);
    playerTags.set(player, tag);
  }
  if (!state.ctx || state.ctx.state !== 'running') setTimeout(() => settle(tag), 0);
  else setTimeout(() => settle(tag), maxMs);
  return p;
}
function onWorkletMessage(e) {
  const m = e.data;
  if (m.type === 'bankAdded') {
    if (!m.ok) console.warn('[sound] bank not added: ' + m.message);
    settle(m.tag, !!m.ok);
  } else if (m.type === 'end') {
    if (playerTags.get(m.player) === m.tag) playerTags.delete(m.player);
    settle(m.tag, true);
    if (m.player === PLAYER_BGM && state.currentBGM && state.currentBGM.tag === m.tag) state.currentBGM = null;
  } else if (m.type === 'error') {
    console.error('[m4a worklet]', m.message);
  }
}
function installUnlockListeners() {
  if (state.listenersInstalled || typeof window === 'undefined') return;
  state.listenersInstalled = true;
  const evs = ['pointerdown', 'keydown', 'touchstart', 'mousedown'];
  const h = () => {
    Sound.unlock().then((ok) => { if (ok) evs.forEach((ev) => window.removeEventListener(ev, h, true)); });
  };
  evs.forEach((ev) => window.addEventListener(ev, h, true));
}
function resolveCryIndex(species, opts) {
  const c = state.meta.cries;
  if (typeof species === 'string') {
    const key = species.toLowerCase().replace(/[^a-z0-9]/g, '');
    const id = c.speciesNames[key];
    if (id === undefined) throw new Error(`Unknown species "${species}"`);
    return c.bySpecies[id];
  }
  const n = species | 0;
  if (opts.cryIndex) return n;                       // raw gCryTable index
  const idx = opts.national ? c.byNational[n] : c.bySpecies[n];
  if (idx === undefined || idx === null) throw new Error(`No cry for ${opts.national ? 'national dex' : 'species'} ${n}`);
  return idx;
}

export const Sound = {
  /**
   * Load the bank and set up the AudioContext + worklet. Safe to call before any user gesture
   * (the context stays suspended until unlock()).
   * @param {string|URL} [baseUrl] folder containing bank.json / bank.bin (default: ../../assets/sound/ relative to this module)
   * @param {object} [opts] { stereo = true, quality = 'hq'|'gba', interpolation = 'hold'|'linear' (gba quality only),
   *   latencyHint = 'interactive', forceScriptProcessor }
   */
  init(baseUrl, opts = {}) {
    if (state.initPromise) return state.initPromise;
    state.initPromise = (async () => {
      const base = new URL(baseUrl || '../../assets/sound/', baseUrl ? (typeof document !== 'undefined' ? document.baseURI : import.meta.url) : import.meta.url);
      const [meta, bank] = await Promise.all([
        fetch(new URL('bank.json', base)).then((r) => { if (!r.ok) throw new Error('bank.json ' + r.status); return r.json(); }),
        fetch(new URL('bank.bin', base)).then((r) => { if (!r.ok) throw new Error('bank.bin ' + r.status); return r.arrayBuffer(); }),
      ]);
      state.meta = meta;
      SONG_NAMES = Object.keys(meta.songs).sort((a, b) => meta.songs[a].index - meta.songs[b].index);
      const Ctx = window.AudioContext || window.webkitAudioContext;
      const ctx = new Ctx({ latencyHint: opts.latencyHint || 'interactive' });
      state.ctx = ctx;
      const master = ctx.createGain();
      master.gain.value = state.volumes.master;
      master.connect(ctx.destination);
      state.master = master;
      let ready;
      const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
      let useWorklet = !!(ctx.audioWorklet && typeof AudioWorkletNode !== 'undefined' && !opts.forceScriptProcessor);
      if (useWorklet) {
        try {
          await withTimeout(ctx.audioWorklet.addModule(new URL('./m4a-worklet.js', import.meta.url)), 2500);
          const node = new AudioWorkletNode(ctx, 'm4a-processor', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
          node.connect(master);
          ready = new Promise((resolve) => {
            node.port.onmessage = (e) => { if (e.data.type === 'ready') { node.port.onmessage = onWorkletMessage; resolve(); } else onWorkletMessage(e); };
          });
          state.node = node;
          state.port = node.port;
          state.backend = 'audioworklet';
        } catch (err) {
          console.warn('[sound] AudioWorklet failed (' + err.message + '); falling back to ScriptProcessor');
          useWorklet = false;
        }
      }
      if (!useWorklet) {
        // Fallback (insecure context / old browser / broken worklet): same engine on the main thread.
        const { EngineHost } = await import('./m4a-core.js');
        // (4096 frames: fewer dropouts when the main thread is busy; this path only runs where the
        // AudioWorklet never starts, e.g. a machine whose realtime worklet thread hangs)
        const sp = ctx.createScriptProcessor(4096, 0, 2);
        let resolveReady;
        ready = new Promise((r) => { resolveReady = r; });
        const host = new EngineHost((msg) => {
          if (msg.type === 'ready') resolveReady(); else setTimeout(() => onWorkletMessage({ data: msg }), 0);
        }, ctx.sampleRate);
        sp.onaudioprocess = (ev) => {
          const ob = ev.outputBuffer;
          host.process(ob.getChannelData(0), ob.numberOfChannels > 1 ? ob.getChannelData(1) : null, ob.length);
        };
        sp.connect(master);
        state.node = sp;
        state.port = { postMessage: (msg) => host.onMessage(msg) };
        state.backend = 'scriptprocessor';
      }
      state.port.postMessage({
        type: 'init', bank,
        meta: { segments: meta.segments, cryTable: meta.cryTable, cryTableReverse: meta.cryTableReverse },
        stereo: opts.stereo !== false, interpolation: opts.interpolation || 'hold', quality: opts.quality === 'gba' ? 'gba' : 'hq',
      }, [bank]);
      state.quality = opts.quality === 'gba' ? 'gba' : 'hq';
      await ready;
      post({ type: 'playerVolume', players: [PLAYER_BGM], volume: state.volumes.music });
      post({ type: 'playerVolume', players: [...SE_PLAYERS, ...CRY_PLAYERS], volume: state.volumes.sfx });
      installUnlockListeners();
      if (ctx.state === 'running') state.unlocked = true;
      return Sound;
    })();
    return state.initPromise;
  },

  /** Resume the AudioContext; call from a user gesture handler. Resolves true when running. */
  async unlock() {
    const ctx = state.ctx;
    if (!ctx) return false;
    if (ctx.state !== 'running') { try { await ctx.resume(); } catch (_) { /* not a gesture yet */ } }
    state.unlocked = ctx.state === 'running';
    return state.unlocked;
  },

  /** True once audio is actually running (after a gesture). */
  get unlocked() { return state.unlocked; },
  get ready() { return !!state.meta && !!state.port; },
  /** 'audioworklet' or 'scriptprocessor' (fallback on insecure origins). */
  get backend() { return state.backend || null; },
  get context() { return state.ctx; },
  /** Final GainNode (master volume) - connect an AnalyserNode etc. to it. */
  get output() { return state.master; },
  get songNames() { return SONG_NAMES; },
  get currentBGM() { return state.currentBGM ? state.currentBGM.name : null; },
  get cryCount() { return state.meta ? state.meta.cryCount : 0; },

  /**
   * Load a second song bank (another game's songs, relocated by its extractor to addresses the first bank doesn't
   * use: tools/extract_emerald_sound.js) into the same engine. Its songs join under prefix + name ('em:mus_route101').
   * Resolves true once playable, false if the bank is missing or broken (the game plays on without it).
   */
  addBank(baseUrl, prefix) {
    if (state.banks.has(prefix)) return state.banks.get(prefix);
    const p = (async () => {
      const base = new URL(baseUrl, typeof document !== 'undefined' ? document.baseURI : import.meta.url);
      let meta, bank;
      try {
        const [rj, rb] = await Promise.all([fetch(new URL('bank.json', base)), fetch(new URL('bank.bin', base))]);
        if (!rj.ok || !rb.ok) return false;
        [meta, bank] = await Promise.all([rj.json(), rb.arrayBuffer()]);
      } catch { return false; }
      const tag = state.nextTag++;
      const done = new Promise((resolve) => state.pending.set(tag, resolve));
      post({ type: 'addBank', bank, segments: meta.segments, tag }, [bank]);
      if (!(await done)) return false;
      for (const [n, s] of Object.entries(meta.songs || {})) state.meta.songs[prefix + n] = { ...s, name: prefix + n };
      return true;
    })().catch((err) => { console.warn('[sound] addBank', err); return false; });
    state.banks.set(prefix, p);
    return p;
  },
  /** True once the bank added under `prefix` is playable. */
  hasBank(prefix) { return !!state.meta && Object.keys(state.meta.songs).some((k) => k.startsWith(prefix)); },
  /**
   * fn(name, ctx) -> the song to play instead of `name` (a full song name, e.g. 'em:mus_route101'), or null.
   * ctx: whatever the caller passed as { ctx } to playBGM / playFanfare. A name the banks don't have is ignored.
   */
  setResolver(fn) { state.resolver = fn || null; },

  /**
   * Play background music on the BGM player.
   * @param {string} name e.g. 'mus_route1' (the 'mus_' prefix may be omitted)
   * @param {object} [o] { fadeInFrames: frames (60 = 1 s), restart: restart even if already playing }
   */
  playBGM(name, o = {}) {
    const s = songInfo(name, o.ctx);
    if (!s) return;
    const full = s.name || SONG_NAMES[s.index] || name;
    if (!o.restart && state.currentBGM && state.currentBGM.name === full && !o.fadeInFrames) return;
    const tag = state.nextTag++;
    state.currentBGM = { name: full, tag };
    const fadeInSpeed = o.fadeInFrames ? Math.max(1, Math.round(o.fadeInFrames / FADE_STEPS)) : 0;
    post({ type: 'start', player: PLAYER_BGM, header: s.header, tag, mode: o.restart ? 'start' : 'change', fadeInSpeed });
  },
  /** Fade the BGM out over ~frames (m4aMPlayFadeOut: 16 steps of frames/16) then stop it. */
  fadeOutBGM(frames = 64) {
    post({ type: 'fadeOut', player: PLAYER_BGM, speed: Math.max(1, Math.round(frames / FADE_STEPS)) });
    state.currentBGM = null;
  },
  stopBGM() { post({ type: 'stop', player: PLAYER_BGM }); state.currentBGM = null; },
  pauseBGM() { post({ type: 'stop', player: PLAYER_BGM }); },
  resumeBGM() { post({ type: 'continue', player: PLAYER_BGM }); },

  /**
   * Play a sound effect (or any song) on the player given by the song table (SE1-SE3 for se_*).
   * Resolves when it finishes.
   */
  playSE(name) {
    const s = songInfo(name);
    if (!s) return Promise.resolve(false);
    const tag = state.nextTag++;
    const p = track(tag, s.player, 5000);
    post({ type: 'start', player: s.player, header: s.header, tag, mode: 'start' });
    return p;
  },
  /** Stop SE players (all, or the player used by `name`). */
  stopSE(name) {
    const players = name ? [songInfo(name)?.player].filter(p => p !== undefined) : SE_PLAYERS;
    for (const p of players) post({ type: 'stop', player: p });
  },
  /** Fanfare (mus_level_up, mus_obtain_item, ...): pauses the BGM, resumes it after. Resolves on end. */
  playFanfare(name, o = {}) {
    const s = songInfo(name, o.ctx);
    if (!s) return Promise.resolve(false);
    const tag = state.nextTag++;
    const player = s.player === PLAYER_BGM ? 2 : s.player;
    const p = track(tag, player, 8000);
    post({ type: 'fanfare', player, header: s.header, tag });
    return p;
  },

  /**
   * Play a Pokemon cry through the engine (gCryTable voice, native sample rate at default pitch).
   * @param {number|string} species internal species id (FRLG order, 1 = Bulbasaur), or a name
   * @param {object} [o] { national: treat number as national dex no., cryIndex: raw table index,
   *   mode: one of CRY_MODES, pitch (15360 = native; 256 per semitone), length (frames, 140),
   *   reverse, volume (0..127, 120), pan (-64..63), release, chorus, duck (lower BGM, default true) }
   * Resolves when the cry finishes.
   */
  playCry(species, o = {}) {
    const wav = typeof species === 'string' && state.wavCry ? state.wavCry(species) : null;
    if (wav) return playWavCry(wav, o).catch(() => false);
    let cryIndex;
    try { cryIndex = resolveCryIndex(species, o); } catch (err) { console.warn('[sound] ' + err.message); return Promise.resolve(false); }
    if (cryIndex === undefined || cryIndex === null) return Promise.resolve(false);
    const tag = state.nextTag++;
    const p = track(tag, undefined, 4000);
    const opts = {};
    for (const k of ['mode', 'pitch', 'length', 'reverse', 'volume', 'pan', 'release', 'chorus', 'priority', 'duck']) {
      if (o[k] !== undefined) opts[k] = o[k];
    }
    post({ type: 'cry', cryIndex, opts, tag });
    return p;
  },

  /** fn(species) -> URL of a WAV cry to play instead of the bank's (null: the bank's). Set once by the game (main.js). */
  setWavCries(fn) { state.wavCry = typeof fn === 'function' ? fn : null; },

  stopAll() { post({ type: 'stopAll' }); state.currentBGM = null; },

  /** 0..1 (values > 1 amplify). */
  setMasterVolume(v) {
    state.volumes.master = Math.max(0, v);
    if (state.master && state.ctx) state.master.gain.setTargetAtTime(state.volumes.master, state.ctx.currentTime, 0.02);
  },
  setMusicVolume(v) {
    state.volumes.music = Math.max(0, v);
    post({ type: 'playerVolume', players: [PLAYER_BGM], volume: state.volumes.music });
  },
  setSfxVolume(v) {
    state.volumes.sfx = Math.max(0, v);
    post({ type: 'playerVolume', players: [...SE_PLAYERS, ...CRY_PLAYERS], volume: state.volumes.sfx });
  },
  get volumes() { return { ...state.volumes }; },
  /** Mono mixes like the GBA's "Mono" sound option (DMA A+B at 50% each, PSG centred). */
  setStereo(on) { post({ type: 'option', stereo: !!on }); },
  /** 'hold' = GBA DAC zero-order hold (authentic), 'linear' = smoother 13379 Hz -> output upsampling. */
  setInterpolation(mode) { post({ type: 'option', interpolation: mode === 'linear' ? 'linear' : 'hold' }); },
  /** 'hq' (default) = 12 voices mixed in full precision at 2x rate, smooth upsampling, low-pass, soft limiter;
   *  'gba' = the exact GBA mixer (8-bit 13379 Hz ring, 5 voices, zero-order hold). Switches live. */
  setQuality(q) { state.quality = q === 'gba' ? 'gba' : 'hq'; post({ type: 'option', quality: state.quality }); },
  get quality() { return state.quality || 'hq'; },
};

for (const k of ['playBGM', 'fadeOutBGM', 'stopBGM', 'pauseBGM', 'resumeBGM', 'playSE', 'stopSE', 'playFanfare',
  'playCry', 'stopAll', 'setStereo', 'setInterpolation', 'setQuality', 'addBank']) Sound[k] = deferred(Sound[k]);

export default Sound;
