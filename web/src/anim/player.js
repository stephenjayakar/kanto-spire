// MoveAnims: plays a FireRed move animation (interpreted from the ROM's battle_anim_scripts) on the
// battle scene. Usage (see scenes/battle.js):
//   await MoveAnims.load();
//   const r = MoveAnims.resolve('FLAMETHROWER', moveData, terrain);   // -> {key, via} or null
//   await MoveAnims.play(r.key, { attacker: 0, battlers, speed });    // battler 0 = player, 1 = foe
//   per frame: MoveAnims.tick(dt); in draw: drawBg / drawLayer (with hooks that draw the POKéMON).
import * as GBA from './gba.js';
import { AnimScript, stepFrame, missingFor, SCRIPT_MAX_FRAMES } from './interp.js';
import { drawAnimLayer, drawBgLayer, drawAnimBgLayers } from './render.js';
import { resolveAnimMove } from './pick.js';
import { assetUrl } from '../net/assetpack.js';

const { S, DATA } = GBA;
const playableCache = new Map();
const TURN1_MOVES = new Set(['RAZOR_WIND', 'FLY', 'SOLAR_BEAM', 'DIG', 'BIDE', 'SKULL_BASH', 'SKY_ATTACK', 'DIVE', 'BOUNCE', 'CURSE']);

export const MoveAnims = {
  ready: false, failed: false, loading: null, cur: null, acc: 0, lastError: null,

  load() {
    if (this.loading) return this.loading;
    this.loading = (async () => {
      try {
        const [json, tiles] = await Promise.all([
          fetch(assetUrl('anims/anims.json')).then(r => { if (!r.ok) throw new Error('anims.json ' + r.status); return r.json(); }),
          fetch(assetUrl('anims/tiles.bin')).then(r => { if (!r.ok) throw new Error('tiles.bin ' + r.status); return r.arrayBuffer(); }),
        ]);
        DATA.json = json; DATA.tiles = new Uint8Array(tiles);
        await import('./cb/index.js');
        playableCache.clear();
        this.ready = true;
      } catch (err) { console.warn('move anims unavailable', err); this.failed = true; }
      return this.ready;
    })();
    return this.loading;
  },

  // A FireRed script exists for this move and every callback it needs is ported.
  canPlay(key) {
    if (!this.ready || !key) return false;
    let v = playableCache.get(key);
    if (v === undefined) { const cmds = DATA.json.moves[key]; v = !!cmds && missingFor(DATA.json, cmds).length === 0; playableCache.set(key, v); }
    return v;
  },
  missing(key) { const cmds = DATA.json?.moves?.[key]; return cmds ? missingFor(DATA.json, cmds) : ['(no script)']; },
  resolve(key, move, terrain) { return this.ready ? resolveAnimMove(key, { canPlay: (k) => this.canPlay(k), move, terrain }) : null; },

  get active() { return !!this.cur; },

  // battlers: [{present, species, x, y, picY, box}] in GBA pixels (index = battler id: 0 player, 1 foe).
  play(key, { attacker = 0, battlers, speed = 1, maxFrames = SCRIPT_MAX_FRAMES, sound = true, hooks = {} } = {}) {
    if (!this.ready || !DATA.json.moves[key]) return Promise.resolve(false);
    if (this.cur) this.stop();
    GBA.resetEngine();
    GBA.SeedAnimRng(0x5EED);
    GBA.setupBattlers(battlers);
    S.gBattleAnimAttacker = attacker; S.gBattleAnimTarget = attacker ^ 1;
    S.gBattlerAttacker = attacker; S.gBattlerTarget = attacker ^ 1;
    // two-turn moves (SOLAR BEAM, FLY, DIVE...) show their attacking turn; the rest (BRICK BREAK, DOUBLE SLAP...) turn 0
    S.gAnimMoveTurn = TURN1_MOVES.has(key) ? 1 : 0; S.gAnimMovePower = hooks.power || 60; S.gAnimMoveDmg = hooks.dmg || 30; S.gAnimFriendship = 255;
    GBA.SoundHooks.playSE = sound && hooks.playSE ? hooks.playSE : () => {};
    GBA.SoundHooks.playCry = sound && hooks.playCry ? hooks.playCry : () => {};
    const script = new AnimScript(DATA.json.moves[key], { labels: DATA.json.labels });
    return new Promise((resolve) => {
      this.cur = { key, script, speed, maxFrames, resolve };
      this.acc = 0;
      // the first frame runs at once so the scene never draws an idle frame between "play" and the animation
      this.step();
    });
  },

  step() {
    const c = this.cur;
    if (!c) return;
    try {
      stepFrame(c.script);
      if (!c.script.active || c.script.frames >= c.maxFrames) this.finish(c.script.active ? 'timeout' : 'done');
    } catch (err) {
      console.error('move anim error', c.key, err);
      this.lastError = { key: c.key, err: String(err && err.stack || err) };
      this.finish('error');
    }
  },

  // dt in seconds; speed 1 = GBA 60 fps, 2 = FAST ANIMATIONS
  tick(dt) {
    const c = this.cur;
    if (!c) return;
    this.acc += Math.min(dt, 0.1) * 60 * c.speed;
    let n = 0;
    while (this.acc >= 1 && this.cur && n++ < 12) { this.acc -= 1; this.step(); }
  },

  // run a whole animation synchronously (tests / frame strips): calls onFrame(frameIndex) after each GBA frame
  runSync(onFrame) { let i = 0; while (this.cur && i < 2000) { this.step(); onFrame?.(i++); } },

  finish(reason) {
    const c = this.cur;
    if (!c) return;
    this.cur = null;
    const missing = [...c.script.missing];
    GBA.resetEngine();
    c.resolve({ reason, frames: c.script.frames, missing });
  },
  stop() { this.finish('stopped'); },

  // ---- drawing (ox, oy = canvas position of GBA pixel (0,0); sc = 2 in the battle scene)
  drawBg(ctx, ox, oy, sc, w, h) { if (this.cur) drawBgLayer(ctx, ox, oy, sc, w, h); },
  drawLayer(ctx, ox, oy, sc, hooks) { if (this.cur) { drawAnimLayer(ctx, ox, oy, sc, hooks); drawAnimBgLayers(ctx, ox, oy, sc); } },
  // terrain shake/scroll offset (GBA pixels) while no move background is up
  terrainOffset() { return this.cur && !S.moveBg ? { x: -S.gBattle_BG3_X, y: -S.gBattle_BG3_Y } : { x: 0, y: 0 }; },
};
