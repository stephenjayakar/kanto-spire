// Emerald's front-sprite animation (a POKéMON appearing in battle / on the summary screen), ported from pokeemerald:
// the 2-frame flip of anim_front.png (src/data/pokemon_graphics/front_pic_anims.h, sprite anim 1) plus the species'
// motion (src/pokemon_animation.c via sMonFrontAnimIdsTable), stepped at the GBA's 60 frames per second.
// Battle-side animations (sDontFlip TRUE): no summary-screen mirroring, so TryFlipX / HandleSetAffineData are plain.
// Ported motions: the ones the starters use (scenes/starter.js, coop/lobby.js); a species with any other motion still
// flips its frames. Cosmetic only: nothing here touches game state.
import { gSineTable } from './trig.js';
import { FRONT_ANIMS } from './front_anim_data.js';

const Sin = (i, amp) => (amp * gSineTable[i]) >> 8;
const Cos = (i, amp) => (amp * gSineTable[i + 64]) >> 8;
const div = (a, b) => Math.trunc(a / b); // (C integer division)
const RGB_YELLOW = '#ffff00', RGB_BLACK = '#000000';

const setAffine = (s, xScale, yScale, rotation) => { s.aff = { xs: xScale, ys: yScale, rot: rotation }; };
const reset = (s) => { s.aff = null; }; // ResetSpriteAfterAnim (back to an unscaled sprite)
const finish = (s) => { s.cb = null; }; // WaitAnimEnd
const blend = (s, coeff, color) => { s.blend = coeff ? { color, a: coeff / 16 } : null; }; // BlendPalette

function verticalJumps(s) {
  const d = s.d;
  let c = d[2];
  if (c > 384) { finish(s); s.x2 = 0; s.y2 = 0; }
  else switch (div(c, 128)) {
    case 0: case 1: s.y2 = -Sin(c % 128, d[0] * 2); break;
    case 2: case 3: c -= 256; s.y2 = -Sin(c, d[0] * 3); break;
  }
  d[2] += 12;
}
function verticalSlide(s) {
  const d = s.d;
  if (d[2] > d[0]) { finish(s); s.y2 = 0; }
  else s.y2 = -Sin(div(d[2] * 384, d[0]) % 256, 6);
  d[2]++;
}
function horizontalShake(s) {
  const d = s.d, c = d[2];
  if (c > 2304) { finish(s); s.x2 = 0; }
  else s.x2 = Sin(c % 256, d[7]);
  d[2] += d[0];
}
function verticalSquishBounce(s) {
  const d = s.d;
  let posY = 0;
  if (d[2] === 0) d[3] = 0;
  if (d[2] > d[0] * 3) { setAffine(s, 256, 256, 0); s.y2 = 0; reset(s); finish(s); return; }
  const yScale = Sin(d[4], 32) + 256;
  if (d[2] > d[0] && d[2] < d[0] * 2) d[3] += div(128, d[0]);
  if (yScale > 256) posY = div(256 - yScale, 8);
  s.y2 = -Sin(d[3], 10) - posY;
  setAffine(s, 256 - Sin(d[4], 32), yScale, 0);
  d[2]++;
  d[4] = (d[4] + div(128, d[0])) & 0xff;
}
function swingConcave(s) {
  const d = s.d, a = s.a;
  if (d[2] > a.data) {
    setAffine(s, 256, 256, 0);
    s.x2 = 0;
    if (a.runs > 1) { a.runs--; d[2] = 0; } else { reset(s); finish(s); }
  } else {
    const index = div(d[2] * 256, a.data);
    s.x2 = -Sin(index, 10);
    setAffine(s, 256, 256, Sin(index, 3276));
  }
  d[2]++;
}
// sYellowFlashData: [yellow?, frames] (255 = (u8)-1 ends it)
const YELLOW_FLASH = [[0, 5], [1, 1], [0, 15], [1, 4], [0, 2], [1, 2], [0, 2], [1, 2], [0, 2], [1, 2], [0, 2], [1, 2], [0, 2], [0, 255]];

const MOTIONS = {
  V_JUMPS_SMALL: (s) => { s.d[0] = 3; s.cb = verticalJumps; verticalJumps(s); },
  V_SLIDE_SLOW: (s) => { s.d[0] = 80; s.cb = verticalSlide; verticalSlide(s); },
  H_SHAKE: (s) => { s.d[0] = 60; s.d[7] = 3; s.cb = horizontalShake; horizontalShake(s); },
  V_SQUISH_AND_BOUNCE: (s) => { s.d[0] = 16; s.cb = verticalSquishBounce; verticalSquishBounce(s); },
  SWING_CONCAVE: (s) => { s.a = { data: 100, runs: 1 }; s.cb = swingConcave; swingConcave(s); },
  V_JUMPS_H_JUMPS(s) {
    const d = s.d;
    let c = d[2];
    if (c > 768) { finish(s); s.x2 = 0; s.y2 = 0; }
    else {
      switch (div(c, 128)) {
        case 0: case 1: s.x2 = 0; break;
        case 2: c = 0; break;
        case 3: s.x2 = div(-(c % 128 * 8), 128); break;
        case 4: s.x2 = div(c % 128, 8) - 8; break;
        case 5: s.x2 = div(-(c % 128 * 8), 128) + 8; break;
      }
      s.y2 = -Sin(c % 128, 8);
    }
    d[2] += 12;
  },
  H_JUMPS(s) {
    const d = s.d, c = d[2];
    if (c > 512) { finish(s); s.x2 = 0; s.y2 = 0; }
    else {
      switch (div(d[2], 128)) {
        case 0: s.x2 = div(-(c % 128 * 8), 128); break;
        case 1: s.x2 = div(c % 128, 16) - 8; break;
        case 2: s.x2 = div(c % 128, 16); break;
        case 3: s.x2 = div(-(c % 128 * 8), 128) + 8; break;
      }
      s.y2 = -Sin(c % 128, 8);
    }
    d[2] += 12;
  },
  CIRCULAR_STRETCH_TWICE(s) {
    const d = s.d;
    if (d[2] > 40) { setAffine(s, 256, 256, 0); reset(s); finish(s); }
    else {
      const v = div(d[2] * 512, 40) % 256;
      d[4] = Sin(v, 32) + 256;
      d[5] = Cos(v, 32) + 256;
      setAffine(s, d[4], d[5], 0);
    }
    d[2]++;
  },
  H_STRETCH(s) {
    const d = s.d;
    let index1 = 0;
    if (d[2] > 40) { setAffine(s, 256, 256, 0); reset(s); finish(s); }
    else {
      const index2 = div(d[2] * 128, 40);
      if (d[2] >= 10 && d[2] <= 29) { d[7] += 51; index1 = 0xff & d[7]; }
      d[4] = (256 - Sin(index2, 40)) - Sin(index1, 16);
      d[5] = Sin(index2, 16) + 256;
      setAffine(s, d[4], d[5], 0);
    }
    d[2]++;
  },
  V_STRETCH(s) {
    const d = s.d;
    let posY = 0, index1 = 0;
    if (d[2] > 40) { setAffine(s, 256, 256, 0); reset(s); finish(s); s.y2 = posY; }
    else {
      const index2 = div(d[2] * 128, 40);
      if (d[2] >= 10 && d[2] <= 29) { d[7] += 51; index1 = 0xff & d[7]; }
      d[4] = Sin(index2, 16) + 256;
      d[5] = (256 - Sin(index2, 40)) - Sin(index1, 8);
      if (d[5] !== 256) posY = div(256 - d[5], 8);
      s.y2 = -posY;
      setAffine(s, d[4], d[5], 0);
    }
    d[2]++;
  },
  GLOW_BLACK(s) { // GlowColor(RGB_BLACK, 16, 1)
    const d = s.d;
    if (d[2] > 128) { blend(s, 0, RGB_BLACK); finish(s); }
    else { d[6] = Sin(d[2], 16); blend(s, d[6], RGB_BLACK); }
    d[2] += 1;
  },
  FLASH_YELLOW(s) {
    const d = s.d;
    if (++d[2] === 1) { d[6] = 0; d[5] = 0; d[4] = 0; }
    if (YELLOW_FLASH[d[6]][1] === 255) { finish(s); return; }
    if (d[4] === 1) { blend(s, YELLOW_FLASH[d[6]][0] ? 16 : 0, RGB_YELLOW); d[4] = 0; }
    if (YELLOW_FLASH[d[6]][1] === d[5]) { d[4] = 1; d[5] = 0; d[6]++; } else d[5]++;
  },
};

export const hasFrontAnim = (species) => !!FRONT_ANIMS[species];

// One play of a species' front animation. at(frame) / the fields after it: which anim_front.png frame shows, the
// sprite offset (x2, y2, GBA pixels), the affine scale/rotation (aff: OAM matrix inputs, 256 = 1.0) and the
// palette blend (blend: { color, a }). Stepped lazily up to the frame asked for, so restarting = a new FrontAnim.
export class FrontAnim {
  constructor(species) {
    const [frames, motion, delay] = FRONT_ANIMS[species] || [[], 'NONE', 0];
    this.frames = frames;
    this.frameEnd = frames.reduce((n, [, dur]) => n + dur, 0);
    this.delay = delay || 0;
    this.start = MOTIONS[motion] || null;
    this.n = 0; // GBA frames stepped
    this.s = { x2: 0, y2: 0, d: new Int16Array(8), cb: null, a: null, aff: null, blend: null };
    this.started = false;
  }
  // anim_front.png frame (0/1) showing `n` GBA frames in (0 once the sequence is over)
  frameAt(n) {
    let t = 0;
    for (const [f, dur] of this.frames) { t += dur; if (n < t) return f; }
    return 0;
  }
  // Steps to `n` GBA frames after the start; returns this.
  at(n) {
    n = Math.max(0, Math.floor(n));
    while (this.n < n) {
      if (this.n >= this.delay) {
        if (!this.started) { this.started = true; if (this.start) { this.s.cb = this.start; this.start(this.s); } }
        else if (this.s.cb) this.s.cb(this.s);
      }
      this.n++;
    }
    return this;
  }
  get frame() { return this.frameAt(this.n); }
  get done() { return this.n >= this.frameEnd && (this.started || !this.start) && !this.s.cb; }
}
