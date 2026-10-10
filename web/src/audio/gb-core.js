// Kanto Spire - Game Boy music engine for the RETRO music option (no DOM: runs in the AudioWorklet, the
// ScriptProcessor fallback and Node for offline renders/tests).
//
// The songs are Pokemon Red's and Silver's original sequence data (tools/extract_retro_music.mjs copies their audio
// banks out of the user's ROMs). Two pieces:
//   - RedEngine / GscEngine: line-by-line ports of the games' own sound drivers (pret pokered audio/engine_1.asm
//     and pokegold audio/engine.asm), run once per video frame (59.73 Hz) like on the console. They write Game Boy
//     sound registers, quirks and all (vibrato on the low byte only, the pitch-slide borrow bug, drums dropped
//     while the previous drum still plays...).
//   - Apu: the DMG sound hardware those registers drive (2 pulse channels with sweep/envelope, the 4-bit wave
//     channel, the LFSR noise channel, NR50/NR51 mixing and the output high-pass), synthesized with band-limited
//     steps so high notes don't alias.
// Player ties them together: one BGM song, an optional fanfare that pauses it, fades, and 'end' events.

export const CPU_HZ = 4194304;
export const FRAME_CYCLES = 70224;           // one video frame: the sound driver's tick (59.7275 Hz)
const FS_PERIOD = 8192;                      // frame sequencer (512 Hz): length 256 Hz, sweep 128 Hz, envelope 64 Hz

// ---------------------------------------------------------------------------------------------------------------
// Band-limited step synthesis (the idea of blargg's Blip_Buffer): every change of the output level adds a windowed-
// sinc impulse scaled by the change; integrating the impulses gives the band-limited waveform.
const TAPS = 16, PHASES = 64;
const KERNEL = (() => {
  const k = new Float32Array((PHASES + 1) * TAPS);
  for (let p = 0; p <= PHASES; p++) {
    let sum = 0;
    for (let i = 0; i < TAPS; i++) {
      const x = i - TAPS / 2 + 1 - p / PHASES; // impulse at fractional position p/PHASES past tap TAPS/2-1
      const fc = 0.46;
      const sinc = x === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * x) / (Math.PI * x);
      const w = 0.42 + 0.5 * Math.cos(Math.PI * x / (TAPS / 2)) + 0.08 * Math.cos(2 * Math.PI * x / (TAPS / 2)); // Blackman
      const v = Math.abs(x) >= TAPS / 2 ? 0 : sinc * w;
      k[p * TAPS + i] = v; sum += v;
    }
    for (let i = 0; i < TAPS; i++) k[p * TAPS + i] /= sum;
  }
  return k;
})();

class Blip {
  constructor(size) { this.buf = new Float32Array(size + TAPS + 4); this.sum = 0; }
  add(pos, delta) {                  // pos: fractional sample index from the buffer start
    const i = pos | 0, p = ((pos - i) * PHASES) | 0, b = this.buf, o = p * TAPS;
    for (let t = 0; t < TAPS; t++) b[i + t] += delta * KERNEL[o + t];
  }
  read(out, n, off) {                // integrates n samples into out[off..], keeps the kernel tails
    const b = this.buf;
    let s = this.sum;
    for (let i = 0; i < n; i++) { s += b[i]; out[off + i] = s; }
    this.sum = s;
    b.copyWithin(0, n, n + TAPS + 4);
    b.fill(0, TAPS + 4);
  }
}

const DUTY = [[0, 0, 0, 0, 0, 0, 0, 1], [1, 0, 0, 0, 0, 0, 0, 1], [1, 0, 0, 0, 0, 1, 1, 1], [0, 1, 1, 1, 1, 1, 1, 0]];
const NOISE_DIV = [8, 16, 32, 48, 64, 80, 96, 112];

// ---------------------------------------------------------------------------------------------------------------
export class Apu {
  constructor(sampleRate) {
    this.sr = sampleRate;
    this.cyc2smp = sampleRate / CPU_HZ;
    const maxFrame = Math.ceil(FRAME_CYCLES * this.cyc2smp) + 8;
    this.bl = new Blip(maxFrame); this.br = new Blip(maxFrame);
    this.t0 = 0;                     // fractional sample offset of the current frame's start in the blip buffers
    this.reg = new Uint8Array(0x30); // FF10-FF3F
    this.mono = false;
    this.hpL = 0; this.hpR = 0; this.hpInL = 0; this.hpInR = 0;
    this.hpK = Math.pow(0.999958, CPU_HZ / sampleRate); // the DMG's output capacitor
    this.ch = [0, 1, 2, 3].map((i) => ({
      i, on: false, dac: false, out: 0, muted: false, lastL: 0, lastR: 0,
      freq: 0, timer: 0, pos: 0, duty: 0, len: 0, lenOn: false,
      vol: 0, envDir: 0, envPer: 0, envT: 0,
      sweepT: 0, sweepOn: false, shadow: 0, lfsr: 0x7fff, shift: 4,
    }));
    this.fsT = FS_PERIOD; this.fsStep = 0;
    this.reset();
  }
  reset() {
    this.reg.fill(0);
    this.reg[0x16] = 0x80;
    this.reg[0x14] = 0x77; this.reg[0x15] = 0;
    for (const c of this.ch) { c.on = false; c.dac = false; c.vol = 0; this.level(c, 0); }
  }
  r(a) { return this.reg[a - 0xff10]; }
  // ---- register writes (address FF10-FF3F) ----
  w(a, v, t = 0) {
    v &= 0xff;
    const r = a - 0xff10;
    this.reg[r] = v;
    if (r >= 0x20) return;           // wave RAM: read live by the wave channel
    if (r === 0x14 || r === 0x15) { for (const c of this.ch) this.level(c, t); return; }
    if (r === 0x16) { if (!(v & 0x80)) { for (const c of this.ch) { c.on = false; this.level(c, t); } } return; }
    const ci = r < 5 ? 0 : r < 10 ? 1 : r < 15 ? 2 : 3, n = r - ci * 5, c = this.ch[ci];
    if (ci === 2) {
      if (n === 0) { c.dac = !!(v & 0x80); if (!c.dac) c.on = false; }
      else if (n === 1) c.len = 256 - v;
      else if (n === 2) c.shift = [4, 0, 1, 2][(v >> 5) & 3];
      else if (n === 3) c.freq = (c.freq & 0x700) | v;
      else if (n === 4) {
        c.freq = (c.freq & 0xff) | ((v & 7) << 8); c.lenOn = !!(v & 0x40);
        if (v & 0x80) { c.on = c.dac; if (c.len === 0) c.len = 256; c.pos = 0; c.timer = (2048 - c.freq) * 2 + 6; }
      }
      this.waveOut(c); this.level(c, t); return;
    }
    if (n === 0) { if (ci === 0) { /* sweep register, read at trigger/tick */ } return; }
    if (n === 1) { if (ci !== 3) c.duty = v >> 6; c.len = 64 - (v & 0x3f); }
    else if (n === 2) { c.dac = (v & 0xf8) !== 0; if (!c.dac) c.on = false; }
    else if (n === 3) { if (ci === 3) { /* NR43 read on each clock */ } else c.freq = (c.freq & 0x700) | v; }
    else if (n === 4) {
      if (ci !== 3) c.freq = (c.freq & 0xff) | ((v & 7) << 8);
      c.lenOn = !!(v & 0x40);
      if (v & 0x80) this.trigger(c);
    }
    if (ci === 3) this.noiseOut(c); else this.pulseOut(c);
    this.level(c, t);
  }
  trigger(c) {
    if (this.onTrigger) this.onTrigger(c.i, c.freq);    // (analysis hook: tests/retro_audio.mjs)
    const env = this.reg[c.i * 5 + 2];
    c.on = c.dac;
    if (c.len === 0) c.len = 64;
    c.vol = env >> 4; c.envDir = env & 8 ? 1 : -1; c.envPer = env & 7; c.envT = c.envPer || 8;
    if (c.i === 3) { c.lfsr = 0x7fff; c.timer = this.noisePeriod(); return; }
    c.timer = (2048 - c.freq) * 4;
    if (c.i === 0) {
      const s = this.reg[0];
      c.shadow = c.freq; c.sweepT = ((s >> 4) & 7) || 8; c.sweepOn = !!((s & 0x70) || (s & 7));
      if (s & 7) this.sweepCalc(c);
    }
  }
  sweepCalc(c) {
    const s = this.reg[0], d = c.shadow >> (s & 7);
    const f = s & 8 ? c.shadow - d : c.shadow + d;
    if (f > 2047) c.on = false;
    return f;
  }
  noisePeriod() { const v = this.reg[0x12]; return NOISE_DIV[v & 7] << (v >> 4); }
  pulseOut(c) { c.out = c.on ? DUTY[c.duty][c.pos] * c.vol : 0; }
  waveOut(c) {
    if (!c.on) { c.out = 0; return; }
    const b = this.reg[0x20 + (c.pos >> 1)];
    c.out = ((c.pos & 1 ? b & 15 : b >> 4) >> c.shift);
  }
  noiseOut(c) { c.out = c.on && !(c.lfsr & 1) ? c.vol : 0; }
  // Emits the change of a channel's contribution to the left/right mix at cycle t of the frame.
  level(c, t) {
    const nr51 = this.reg[0x15], nr50 = this.reg[0x14];
    const o = c.muted ? 0 : c.out;
    const L = (nr51 >> (4 + c.i)) & 1 ? o * ((nr50 >> 4 & 7) + 1) : 0;
    const R = (nr51 >> c.i) & 1 ? o * ((nr50 & 7) + 1) : 0;
    if (L !== c.lastL || R !== c.lastR) {
      const pos = this.t0 + t * this.cyc2smp;
      if (L !== c.lastL) { this.bl.add(pos, L - c.lastL); c.lastL = L; }
      if (R !== c.lastR) { this.br.add(pos, R - c.lastR); c.lastR = R; }
    }
  }
  // ---- run one frame's worth of cycles, then hand out the samples ----
  runFrame() {
    let t = 0;
    while (t < FRAME_CYCLES) {
      const end = Math.min(FRAME_CYCLES, t + this.fsT);
      for (const c of this.ch) this.runChannel(c, t, end);
      this.fsT -= end - t;
      t = end;
      if (this.fsT <= 0) { this.fsT += FS_PERIOD; this.frameSeq(t); }
    }
    const tEnd = this.t0 + FRAME_CYCLES * this.cyc2smp;
    const n = tEnd | 0;
    this.t0 = tEnd - n;
    return n;
  }
  runChannel(c, t, end) {
    if (!c.on) return;
    if (c.i === 2) {
      const per = (2048 - c.freq) * 2;
      while (c.timer <= end - t) { t += c.timer; c.timer = per; c.pos = (c.pos + 1) & 31; this.waveOut(c); this.level(c, t); }
      c.timer -= end - t;
    } else if (c.i === 3) {
      const per = this.noisePeriod(), narrow = this.reg[0x12] & 8;
      if (per <= 0) return;
      while (c.timer <= end - t) {
        t += c.timer; c.timer = per;
        const x = (c.lfsr ^ (c.lfsr >> 1)) & 1;
        c.lfsr = (c.lfsr >> 1) | (x << 14);
        if (narrow) c.lfsr = (c.lfsr & ~0x40) | (x << 6);
        const o = !(c.lfsr & 1) ? c.vol : 0;
        if (o !== c.out) { c.out = o; this.level(c, t); }
      }
      c.timer -= end - t;
    } else {
      const per = (2048 - c.freq) * 4;
      while (c.timer <= end - t) {
        t += c.timer; c.timer = per; c.pos = (c.pos + 1) & 7;
        const o = DUTY[c.duty][c.pos] * c.vol;
        if (o !== c.out) { c.out = o; this.level(c, t); }
      }
      c.timer -= end - t;
    }
  }
  frameSeq(t) {
    const s = this.fsStep; this.fsStep = (s + 1) & 7;
    for (const c of this.ch) {
      if (!(s & 1) && c.lenOn && c.len > 0 && --c.len === 0) { c.on = false; c.out = 0; this.level(c, t); }
      if (c.i === 0 && (s === 2 || s === 6) && c.on) {
        if (--c.sweepT <= 0) {
          const sr = this.reg[0];
          c.sweepT = ((sr >> 4) & 7) || 8;
          if (c.sweepOn && (sr & 0x70)) {
            const f = this.sweepCalc(c);
            if (f <= 2047 && (sr & 7)) { c.shadow = f; c.freq = f; this.sweepCalc(c); }
            if (!c.on) { c.out = 0; this.level(c, t); }
          }
        }
      }
      if (s === 7 && c.i !== 2 && c.on && c.envPer) {
        if (--c.envT <= 0) {
          c.envT = c.envPer;
          const v = c.vol + c.envDir;
          if (v >= 0 && v <= 15) {
            c.vol = v;
            if (c.i === 3) this.noiseOut(c); else this.pulseOut(c);
            this.level(c, t);
          }
        }
      }
    }
  }
  // n samples of the frame just run -> L/R (high-passed, scaled to about +-1 at full volume)
  read(L, R, n, off, gain) {
    this.bl.read(L, n, off); this.br.read(R, n, off);
    const k = this.hpK, g = gain / 480;
    let hl = this.hpL, hr = this.hpR, il = this.hpInL, ir = this.hpInR;
    for (let i = off; i < off + n; i++) {
      const xl = L[i], xr = R[i];
      hl = k * hl + xl - il; il = xl;
      hr = k * hr + xr - ir; ir = xr;
      if (this.mono) { const m = (hl + hr) * 0.5 * g; L[i] = m; R[i] = m; } else { L[i] = hl * g; R[i] = hr * g; }
    }
    this.hpL = hl; this.hpR = hr; this.hpInL = il; this.hpInR = ir;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Pokemon Red's sound driver (pokered audio/engine_1.asm; engines 2 and 3 are the same code for music). Channels
// 0-3 are music, 4-7 sound effects; the music's drums are SFX "noise instruments" started on channel 8.
const rrc2 = (b) => ((b >> 2) | (b << 6)) & 0xff;
const rlc2 = (b) => ((b << 2) | (b >> 6)) & 0xff;
const sra16 = (v) => ((v >> 1) | (v & 0x8000)) & 0xffff;
const HW_BASE = [0x10, 0x15, 0x1a, 0x1f, 0x10, 0x15, 0x1a, 0x1f];
const EN_MASK = [0x11, 0x22, 0x44, 0x88, 0x11, 0x22, 0x44, 0x88];
const DIS_MASK = EN_MASK.map((m) => ~m & 0xff);
const NOISE_INSTRUMENTS_END = 0x14;
// wChannelFlags1
const F_PERFECT = 1, F_CALL = 2, F_NOISE_SFX = 4, F_VIB_DIR = 8, F_SLIDE = 16, F_SLIDE_DEC = 32, F_DUTY_ROT = 64;

export class RedEngine {
  constructor(bank, tables, apu) {
    this.bank = bank; this.tb = tables; this.apu = apu;
    const A = () => new Uint8Array(8), W = () => new Uint16Array(8);
    this.ids = A(); this.ptr = W(); this.ret = W(); this.f1 = A(); this.f2 = A(); this.duty = A(); this.dutyPat = A();
    this.vibDelay = A(); this.vibExt = A(); this.vibRate = A(); this.freqLo = A(); this.vibReload = A();
    this.psLen = A(); this.psStep = A(); this.psStepFrac = A(); this.psCurFrac = A(); this.psCurHi = A(); this.psCurLo = A();
    this.psTgtHi = A(); this.psTgtLo = A(); this.loops = A().fill(1); this.delay = A().fill(1); this.speed = A().fill(1);
    this.vols = A(); this.oct = A(); this.frac = A();
    this.musicTempo = 0x100; this.sfxTempo = 0x100; this.pan = 0xff; this.musicWave = 0; this.sfxWave = 0;
    this.disableOnSfxEnd = 0;
  }
  rb(a) { return this.bank[(a - 0x4000) & 0x3fff]; }
  w(r, v) { this.apu.w(0xff00 + r, v); }
  rr(r) { return this.apu.r(0xff00 + r); }
  next(c) { const v = this.rb(this.ptr[c]); this.ptr[c] = (this.ptr[c] + 1) & 0xffff; return v; }
  get active() { for (let c = 0; c < 8; c++) if (this.ids[c]) return true; return false; }
  // ---- PlaySound ----
  playMusic(header) {
    const id = ((header - this.tb.sfxHeaders) / 3) & 0xff;
    this.disableOnSfxEnd = 0; this.musicTempo &= 0xff00; this.musicWave = 0; this.sfxWave = 0;
    for (let c = 0; c < 4; c++) {
      this.ret[c] = 0; this.ptr[c] = 0; this.ids[c] = 0; this.f1[c] = 0; this.duty[c] = 0; this.dutyPat[c] = 0;
      this.vibDelay[c] = 0; this.vibExt[c] = 0; this.vibRate[c] = 0; this.freqLo[c] = 0; this.vibReload[c] = 0; this.f2[c] = 0;
      this.psLen[c] = 0; this.psStep[c] = 0; this.psStepFrac[c] = 0; this.psCurFrac[c] = 0; this.psCurHi[c] = 0; this.psCurLo[c] = 0;
      this.psTgtHi[c] = 0; this.psTgtLo[c] = 0; this.loops[c] = 1; this.delay[c] = 1; this.speed[c] = 1;
    }
    this.musicTempo = (this.musicTempo & 0xff) | 0x100;
    this.pan = 0xff;
    this.w(0x24, 0); this.w(0x10, 0x08); this.w(0x25, 0); this.w(0x1a, 0); this.w(0x1a, 0x80); this.w(0x24, 0x77);
    this.common(id);
  }
  playSfx(id) {
    const hdr = this.tb.sfxHeaders + id * 3;
    for (let k = this.rb(hdr) >> 6; k >= 0; k--) {
      const e = this.rb(hdr + k * 3) & 0xf;
      const cur = this.ids[e];
      if (cur) {
        let play = false;
        if (e === 7) {
          if (id < NOISE_INSTRUMENTS_END) return;      // a drum never cuts the previous drum or a noise SFX
          if (cur <= NOISE_INSTRUMENTS_END) play = true;
        }
        if (!play && id > cur) return;
      }
      this.ret[e] = 0; this.ptr[e] = 0; this.ids[e] = 0; this.f1[e] = 0; this.duty[e] = 0; this.dutyPat[e] = 0;
      this.vibDelay[e] = 0; this.vibExt[e] = 0; this.vibRate[e] = 0; this.freqLo[e] = 0; this.vibReload[e] = 0;
      this.psLen[e] = 0; this.psStep[e] = 0; this.psStepFrac[e] = 0; this.psCurFrac[e] = 0; this.psCurHi[e] = 0; this.psCurLo[e] = 0;
      this.psTgtHi[e] = 0; this.psTgtLo[e] = 0; this.f2[e] = 0; this.loops[e] = 1; this.delay[e] = 1; this.speed[e] = 1;
      if (e === 4) this.w(0x10, 0x08);
    }
    this.common(id);
  }
  common(id) {
    const hdr = this.tb.sfxHeaders + id * 3;
    const n = (this.rb(hdr) >> 6) + 1;
    for (let k = 0; k < n; k++) {
      const c = this.rb(hdr + k * 3) & 0xf;
      this.ids[c] = id;
      if (c >= 3) this.f1[c] |= F_NOISE_SFX;
      this.ptr[c] = this.rb(hdr + k * 3 + 1) | (this.rb(hdr + k * 3 + 2) << 8);
    }
  }
  // ---- Audio1_UpdateMusic (once per frame) ----
  update() {
    for (let c = 0; c < 8; c++) if (this.ids[c]) this.affects(c);
  }
  affects(c) {
    if (this.delay[c] === 1) { this.playNextNote(c); return; }
    this.delay[c] = (this.delay[c] - 1) & 0xff;
    if (c < 4 && this.ids[c + 4]) return;
    if (this.f1[c] & F_DUTY_ROT) {
      this.dutyPat[c] = rlc2(this.dutyPat[c]);
      const r = HW_BASE[c] + 1;
      this.w(r, (this.rr(r) & 0x3f) | (this.dutyPat[c] & 0xc0));
    }
    if (!(this.f2[c] & 1) && (this.f1[c] & F_NOISE_SFX)) return;
    if (this.f1[c] & F_SLIDE) { this.applySlide(c); return; }
    if (this.vibDelay[c]) { this.vibDelay[c]--; return; }
    const ext = this.vibExt[c];
    if (!ext) return;
    if (this.vibRate[c] & 0xf) { this.vibRate[c]--; return; }
    const r = this.vibRate[c]; this.vibRate[c] = r | (r >> 4);
    const e = this.freqLo[c];
    let a;
    if (this.f1[c] & F_VIB_DIR) { this.f1[c] &= ~F_VIB_DIR; a = e - (ext & 0xf); if (a < 0) a = 0; }
    else { this.f1[c] |= F_VIB_DIR; a = e + (ext >> 4); if (a > 0xff) a = 0xff; }
    this.w(HW_BASE[c] + 3, a);
  }
  playNextNote(c) {
    this.vibDelay[c] = this.vibReload[c];
    this.f1[c] &= ~(F_SLIDE | F_SLIDE_DEC);
    this.parse(c);
  }
  parse(c) {
    for (let guard = 0; guard < 4096; guard++) {
      const d = this.next(c), hi = d & 0xf0;
      if (d === 0xff) {                               // sound_ret
        if (this.f1[c] & F_CALL) { this.f1[c] &= ~F_CALL; this.ptr[c] = this.ret[c]; continue; }
        let disable = c < 3;
        if (!disable) {
          this.f1[c] &= ~F_NOISE_SFX; this.f2[c] &= ~1;
          if (c === 6) { this.w(0x1a, 0); this.w(0x1a, 0x80); if (this.disableOnSfxEnd) { this.disableOnSfxEnd = 0; disable = true; } }
        }
        if (disable) this.w(0x25, this.rr(0x25) & DIS_MASK[c]);
        this.ids[c] = 0;
        return;
      }
      if (d === 0xfd) {                               // sound_call
        const lo = this.next(c), p = lo | (this.next(c) << 8);
        this.ret[c] = this.ptr[c]; this.ptr[c] = p; this.f1[c] |= F_CALL; continue;
      }
      if (d === 0xfe) {                               // sound_loop
        const n = this.next(c);
        if (n === 0 && this.onLoop) this.onLoop(c);
        if (n !== 0) {
          if (this.loops[c] === n) { this.loops[c] = 1; this.next(c); this.next(c); continue; }
          this.loops[c]++;
        }
        const lo = this.next(c); this.ptr[c] = lo | (this.next(c) << 8); continue;
      }
      if (hi === 0xd0) {                              // note_type / drum_speed
        this.speed[c] = d & 0xf;
        if (c !== 3) {
          let p = this.next(c);
          if (c === 2 || c === 6) { if (c === 2) this.musicWave = p & 0xf; else this.sfxWave = p & 0xf; p = (p & 0x30) << 1; }
          this.vols[c] = p;
        }
        continue;
      }
      if (d === 0xe8) { this.f1[c] ^= F_PERFECT; continue; }
      if (d === 0xea) {                               // vibrato
        const dl = this.next(c); this.vibDelay[c] = dl; this.vibReload[c] = dl;
        const p = this.next(c), n = p >> 4, e = n >> 1;
        this.vibExt[c] = ((e + (n & 1)) << 4) | e;
        this.vibRate[c] = ((p & 0xf) << 4) | (p & 0xf);
        continue;
      }
      if (d === 0xeb) {                               // pitch_slide: target, then the note it applies to
        this.psLen[c] = this.next(c);
        const p = this.next(c), f = this.calcFreq(p & 0xf, p >> 4);
        this.psTgtHi[c] = f >> 8; this.psTgtLo[c] = f & 0xff;
        this.f1[c] |= F_SLIDE;
        this.noteLength(c, this.next(c), true);
        return;
      }
      if (d === 0xec) { this.duty[c] = rrc2(this.next(c)) & 0xc0; continue; }
      if (d === 0xed) {                               // tempo
        const t = (this.next(c) << 8) | this.next(c);
        if (c < 4) { this.musicTempo = t; this.frac[0] = this.frac[1] = this.frac[2] = this.frac[3] = 0; }
        else { this.sfxTempo = t; this.frac[4] = this.frac[5] = this.frac[6] = this.frac[7] = 0; }
        continue;
      }
      if (d === 0xee) { this.pan = this.next(c); continue; }
      if (d === 0xef) {                               // (unused by the songs) start another sound
        const id = this.next(c);
        this.playSfx(id);
        if (!this.disableOnSfxEnd) { this.disableOnSfxEnd = this.ids[7]; this.ids[7] = 0; }
        continue;
      }
      if (d === 0xfc) { const p = this.next(c); this.dutyPat[c] = p; this.duty[c] = p & 0xc0; this.f1[c] |= F_DUTY_ROT; continue; }
      if (d === 0xf0) { this.w(0x24, this.next(c)); continue; }
      if (d === 0xf8) { this.f2[c] |= 1; continue; }
      if (hi === 0xe0) { this.oct[c] = d & 0xf; continue; }
      if (hi === 0x20 && c >= 3 && !(this.f2[c] & 1)) { this.sfxNote(c, d); return; }
      if (c >= 4 && d === 0x10 && !(this.f2[c] & 1)) { this.w(0x10, this.next(c)); continue; }
      // note (drums on the music noise channel)
      if (c === 3 && hi <= 0xb0) {
        let inst, len;
        if (hi === 0xb0) { len = d & 0xf; inst = this.next(c); } else { inst = hi >> 4; len = d & 0xf; }
        if (!this.disableOnSfxEnd) this.playSfx(inst);
        this.noteLength(c, len, true);
        return;
      }
      this.noteLength(c, d, true);
      return;
    }
    this.ids[c] = 0; // (runaway data: stop the channel)
  }
  // Audio1_note_length (+ Audio1_note_pitch). Returns the note delay.
  noteLength(c, d, pitch) {
    const len = (d & 0xf) + 1;
    const l = (this.speed[c] * len) & 0xff;
    let tempo;
    if (c < 4) tempo = this.musicTempo;
    else { tempo = 0x100; if (c !== 7) { this.sfxTempo = 0x100; tempo = this.sfxTempo; } } // (SetSfxTempo: no cry)
    const hl = (this.frac[c] + l * tempo) & 0xffff;
    this.frac[c] = hl & 0xff; this.delay[c] = hl >> 8;
    if (!(this.f2[c] & 1) && (this.f1[c] & F_NOISE_SFX)) return this.delay[c];
    if (pitch) this.notePitch(c, d);
    return this.delay[c];
  }
  notePitch(c, d) {
    const hi = d & 0xf0;
    if (hi === 0xc0) {                                // rest
      if (c < 4 && this.ids[c + 4]) return;
      if (c === 2 || c === 6) { this.w(0x25, this.rr(0x25) & DIS_MASK[c]); return; }
      this.w(HW_BASE[c] + 2, 0x08); this.w(HW_BASE[c] + 4, 0x80);
      return;
    }
    let f = this.calcFreq(hi >> 4, this.oct[c]);
    if (this.f1[c] & F_SLIDE) this.initSlide(c, f);
    if (c < 4 && this.ids[c + 4]) return;
    this.w(HW_BASE[c] + 2, this.vols[c]);
    this.dutyLen(c);
    this.enableOutput(c);
    if (this.f1[c] & F_PERFECT) f = (f & 0xff00) | ((f + 1) & 0xff);
    this.freqLo[c] = f & 0xff;
    this.waveAndFreq(c, f >> 8, f & 0xff);
  }
  sfxNote(c, d) {
    const dl = this.noteLength(c, d, false);
    this.w(HW_BASE[c] + 1, dl | this.duty[c]);
    this.w(HW_BASE[c] + 2, this.next(c));
    const e = this.next(c);
    const hi = c === 7 ? 0 : this.next(c);
    this.dutyLen(c);
    this.enableOutput(c);
    this.waveAndFreq(c, hi, e);
  }
  dutyLen(c) {
    let d = this.delay[c];
    if (c !== 2 && c !== 6) d = (d & 0x3f) | this.duty[c];
    this.w(HW_BASE[c] + 1, d);
  }
  enableOutput(c) {
    let d = this.rr(0x25) | EN_MASK[c];
    if (c === 7 || (c < 4 && !this.ids[c + 4])) d = (this.rr(0x25) & DIS_MASK[c]) | (this.pan & EN_MASK[c]);
    this.w(0x25, d);
  }
  waveAndFreq(c, d, e) {
    if (c === 2 || c === 6) {
      const inst = c === 2 ? this.musicWave : this.sfxWave;
      const p = this.rb(this.tb.wavePointers + inst * 2) | (this.rb(this.tb.wavePointers + inst * 2 + 1) << 8);
      this.w(0x1a, 0);
      for (let i = 0; i < 16; i++) this.w(0x30 + i, this.rb(p + i));
      this.w(0x1a, 0x80);
    }
    this.w(HW_BASE[c] + 3, e);
    this.w(HW_BASE[c] + 4, (d | 0x80) & 0xc7);
  }
  calcFreq(note, octave) {
    let v = this.rb(this.tb.pitches + note * 2) | (this.rb(this.tb.pitches + note * 2 + 1) << 8);
    for (let a = octave & 0xff; a !== 7; a = (a + 1) & 0xff) v = sra16(v);
    return ((((v >> 8) + 8) & 0xff) << 8) | (v & 0xff);
  }
  applySlide(c) {
    let e, d;
    if (!(this.f1[c] & F_SLIDE_DEC)) {
      let de = ((this.psCurHi[c] << 8) | this.psCurLo[c]) + this.psStep[c];
      const s = this.psCurFrac[c] + this.psStepFrac[c];
      this.psCurFrac[c] = s & 0xff;
      de = (de + (s >> 8)) & 0xffff;
      d = de >> 8; e = de & 0xff;
      const th = this.psTgtHi[c], tl = this.psTgtLo[c];
      if (th < d || (th === d && tl < e)) { this.f1[c] &= ~(F_SLIDE | F_SLIDE_DEC); return; }
    } else {
      let de = (((this.psCurHi[c] << 8) | this.psCurLo[c]) - this.psStep[c]) & 0xffff;
      const s = this.psStepFrac[c] * 2;
      this.psStepFrac[c] = s & 0xff;
      de = (de - (s >> 8)) & 0xffff;
      d = de >> 8; e = de & 0xff;
      const th = this.psTgtHi[c], tl = this.psTgtLo[c];
      if (d < th || (d === th && e < tl)) { this.f1[c] &= ~(F_SLIDE | F_SLIDE_DEC); return; }
    }
    this.psCurLo[c] = e; this.psCurHi[c] = d;
    this.w(HW_BASE[c] + 3, e); this.w(HW_BASE[c] + 4, d);
  }
  initSlide(c, f) {
    let d = f >> 8, e = f & 0xff;
    this.psCurHi[c] = d; this.psCurLo[c] = e;
    let a = this.delay[c] - this.psLen[c];
    if (a < 0) a = 1;
    this.psLen[c] = a & 0xff;
    const tl = this.psTgtLo[c], th = this.psTgtHi[c];
    let lo = e - tl, borrow = lo < 0 ? 1 : 0;
    if ((d - borrow) - th >= 0) {                   // current >= target: slide down
      e = lo & 0xff; d = ((d - borrow) - th) & 0xff;
      this.f1[c] |= F_SLIDE_DEC;
    } else {                                        // up (with the original's borrow from the wrong byte)
      lo = tl - this.psCurLo[c]; borrow = lo < 0 ? 1 : 0;
      e = lo & 0xff;
      d = (th - ((this.psCurHi[c] - borrow) & 0xff)) & 0xff;
      this.f1[c] &= ~F_SLIDE_DEC;
    }
    const div = this.psLen[c];
    let b = 0;
    for (;;) {
      b++;
      const r = e - div; e = r & 0xff;
      if (r >= 0) continue;
      if (d === 0) break;
      d--;
    }
    const rem = (e + div) & 0xff;
    this.psStep[c] = b & 0xff; this.psStepFrac[c] = rem; this.psCurFrac[c] = rem;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Gold/Silver's sound driver (pokegold audio/engine.asm). 8 channel structs (1-4 music, 5-8 SFX); the registers are
// written once per frame from each channel's note flags.
const GSC_TRACKS = [0x11, 0x22, 0x44, 0x88];

class GscChannel {
  constructor() { this.clear(); }
  clear() {
    this.on = false; this.sub = false; this.looping = false; this.sfx = false; this.noise = false; this.cry = false;
    this.vibrato = false; this.slide = false; this.dutyLoop = false; this.pitchOffsetOn = false;
    this.vibDir = false; this.slideDir = false;
    this.addr = 0; this.lastAddr = 0; this.bank = 0;
    this.nfDuty = false; this.nfFreq = false; this.nfSweep = false; this.nfNoise = false; this.nfRest = false; this.nfVib = false;
    this.condition = 0; this.duty = 0; this.env = 0; this.freq = 0; this.pitch = 0; this.octave = 0; this.transpose = 0;
    this.dur = 0; this.loopCount = 0; this.tempo = 0x100; this.tracks = 0; this.dutyPat = 0;
    this.vibDelayCount = 0; this.vibDelay = 0; this.vibExt = 0; this.vibRate = 0;
    this.slideTarget = 0; this.slideAmount = 0; this.slideFrac = 0; this.field25 = 0; this.pitchOffset = 0;
    this.durMod = 0; this.noteLength = 1;
  }
}

export class GscEngine {
  constructor(banks, tables, apu, opts = {}) {
    this.banks = banks; this.tb = tables; this.apu = apu;
    this.ch = Array.from({ length: 8 }, () => new GscChannel());
    this.volume = 0x77; this.soundOutput = 0; this.pitchSweep = 0;
    this.musicNoiseSet = 0; this.sfxNoiseSet = 0; this.noiseAddr = 0; this.noiseDelay = 0;
    this.curNoteDur = 0; this.stereo = opts.stereo !== false;
    this.curDuty = 0; this.curEnv = 0; this.curFreq = 0; this.cur = 0; this.curByte = 0;
  }
  rbank(bank, a) { const b = this.banks[bank]; return b ? b[(a - 0x4000) & 0x3fff] : 0; }
  rb(a) { return this.rbank(this.tb.engineBank, a); }         // engine bank (drum kits, waves, frequency table)
  w(r, v) { this.apu.w(0xff00 + r, v); }
  get active() { for (const c of this.ch) if (c.on) return true; return false; }
  byte(c) { const v = this.rbank(c.bank, c.addr); c.addr = (c.addr + 1) & 0xffff; this.curByte = v; return v; }
  // ---- _PlayMusic / _PlaySFX ----
  start(bank, header, sfx) {
    const n = (this.rbank(bank, header) >> 6) + 1;
    let de = header;
    for (let k = 0; k < n; k++) {
      const ci = this.rbank(bank, de) & 7;
      const c = this.ch[ci];
      c.clear();
      c.addr = this.rbank(bank, de + 1) | (this.rbank(bank, de + 2) << 8);
      c.bank = bank;
      de += 3;
      if (sfx) c.sfx = true;
      c.tracks = GSC_TRACKS[ci & 3]; c.on = true;
    }
    if (!sfx) { this.noiseAddr = 0; this.noiseDelay = 0; this.musicNoiseSet = 0; }
  }
  // ---- _UpdateSound ----
  update() {
    this.soundOutput = 0;
    for (let i = 0; i < 8; i++) {
      const c = this.ch[i];
      this.cur = i;
      if (!c.on) continue;
      if (c.dur < 2) { c.vibDelayCount = c.vibDelay; c.slide = false; this.parse(c); }
      else c.dur--;
      this.applySlide(c);
      this.curDuty = c.duty; this.curEnv = c.env; this.curFreq = c.freq;
      this.vibratoEtc(c);
      this.handleNoise(c);
      if (i < 4 && this.ch[i + 4].on) { /* the SFX channel owns the hardware */ }
      else { this.updateChannel(c, i & 3); this.soundOutput |= c.tracks; }
      c.nfDuty = c.nfFreq = c.nfSweep = c.nfNoise = c.nfRest = c.nfVib = false;
    }
    this.w(0x24, this.volume);
    this.w(0x25, this.soundOutput);
  }
  clearHw(base) { this.w(base, 0); this.w(base + 1, 0); this.w(base + 2, 8); this.w(base + 3, 0); this.w(base + 4, 0x80); }
  updateChannel(c, hw) {
    const lo = this.curFreq & 0xff, hi = (this.curFreq >> 8) & 0xff;
    if (hw === 0) {
      if (c.nfSweep) this.w(0x10, this.pitchSweep);
      if (c.nfRest) { this.clearHw(0x10); return; }
      if (c.nfNoise) { this.w(0x11, 0x3f | this.curDuty); this.w(0x12, this.curEnv); this.w(0x13, lo); this.w(0x14, hi | 0x80); return; }
      if (c.nfFreq) { this.w(0x13, lo); this.w(0x14, hi); if (c.nfDuty) this.w(0x11, 0x3f | this.curDuty); return; }
      if (c.nfVib) { this.w(0x11, 0x3f | this.curDuty); this.w(0x13, lo); return; }
      if (c.nfDuty) this.w(0x11, 0x3f | this.curDuty);
    } else if (hw === 1) {
      if (c.nfRest) { this.clearHw(0x15); return; }
      if (c.nfNoise) { this.w(0x16, 0x3f | this.curDuty); this.w(0x17, this.curEnv); this.w(0x18, lo); this.w(0x19, hi | 0x80); return; }
      if (c.nfVib) { this.w(0x16, 0x3f | this.curDuty); this.w(0x18, lo); return; }
      if (c.nfDuty) this.w(0x16, 0x3f | this.curDuty);
    } else if (hw === 2) {
      if (c.nfRest) { this.clearHw(0x1a); return; }
      if (c.nfNoise) {
        this.w(0x1b, 0x3f); this.w(0x1a, 0);
        const p = this.tb.waveSamples + (this.curEnv & 0xf) * 16;
        for (let i = 0; i < 16; i++) this.w(0x30 + i, this.rb(p + i));
        this.w(0x1c, ((this.curEnv & 0xf0) << 1) & 0xff);
        this.w(0x1a, 0x80); this.w(0x1d, lo); this.w(0x1e, hi | 0x80);
        return;
      }
      if (c.nfVib) this.w(0x1d, lo);
    } else {
      if (c.nfRest) { this.clearHw(0x1f); return; }
      if (c.nfNoise) { this.w(0x20, 0x3f); this.w(0x21, this.curEnv); this.w(0x22, lo); this.w(0x23, 0x80); }
    }
  }
  getFrequency(c, d, e) {
    let a = (c.transpose >> 4) + d;
    const idx = (c.transpose & 0xf) + e;
    let v = this.rb(this.tb.frequencyTable + idx * 2) | (this.rb(this.tb.frequencyTable + idx * 2 + 1) << 8);
    while ((a & 0xff) < 7) { v = sra16(v); a++; }
    return v & 0x7ff;
  }
  setNoteDuration(c, a) {
    const e = (a + 1) & 0xffff;
    const l = (c.noteLength * e) & 0xff;
    const hl = (c.durMod + l * c.tempo) & 0xffff;
    c.durMod = hl & 0xff; c.dur = hl >> 8;
  }
  setGlobalTempo(t) {
    const base = this.cur < 4 ? 0 : 4;
    for (let i = base; i < base + 4; i++) { this.ch[i].tempo = t; this.ch[i].durMod = 0; }
  }
  parse(c) {
    for (let guard = 0; guard < 4096; guard++) {
      const a = this.byte(c);
      if (a === 0xff && !c.sub) {                     // end of the channel
        if (this.cur === 4) this.w(0x10, 0);
        c.on = false; c.nfRest = true;
        return;
      }
      if (a >= 0xd0) { this.command(c, a); continue; }
      if (c.sfx || c.cry) {                           // ParseSFXOrCry
        c.nfNoise = true;
        this.setNoteDuration(c, a);
        c.env = this.byte(c);
        c.freq = (c.freq & 0xff00) | this.byte(c);
        if ((this.cur & 3) !== 3) c.freq = (c.freq & 0xff) | (this.byte(c) << 8);
        return;
      }
      if (c.noise) { this.getNoiseSample(c, a); return; }
      this.setNoteDuration(c, a & 0xf);
      const p = a >> 4;
      if (!p) { c.nfRest = true; return; }
      c.pitch = p;
      c.freq = this.getFrequency(c, c.octave, p);
      c.nfNoise = true;
      this.loadNote(c);
      return;
    }
    c.on = false;
  }
  getNoiseSample(c, a) {
    if ((this.cur & 3) !== 3) return;
    this.setNoteDuration(c, a & 0xf);
    let set;
    if (!(this.cur & 4)) { if (this.ch[7].on) return; set = this.musicNoiseSet; } else set = this.sfxNoiseSet;
    const kit = this.rb(this.tb.drumkits + set * 2) | (this.rb(this.tb.drumkits + set * 2 + 1) << 8);
    const p = a >> 4;
    if (!p) return;
    this.noiseAddr = this.rb(kit + p * 2) | (this.rb(kit + p * 2 + 1) << 8);
    this.noiseDelay = 0;
  }
  handleNoise(c) {
    if (!c.noise) return;
    if (!(this.cur & 4) && this.ch[7].on && this.ch[7].noise) return;
    if (this.noiseDelay) { this.noiseDelay--; return; }
    let de = this.noiseAddr;
    if (!de) return;
    const a = this.rb(de++);
    if (a === 0xff) return;
    this.noiseDelay = (a & 0xf) + 1;
    this.curEnv = this.rb(de++);
    this.curFreq = this.rb(de++);
    this.noiseAddr = de & 0xffff;
    c.nfNoise = true;
  }
  loadNote(c) {
    if (!c.slide) return;
    let a = c.dur - this.curNoteDur;
    if (a < 0) a = 1;
    this.curNoteDur = a & 0xff;
    const fl = c.freq & 0xff, fh = c.freq >> 8, tl = c.slideTarget & 0xff, th = c.slideTarget >> 8;
    let e, d;
    let lo = fl - tl, borrow = lo < 0 ? 1 : 0;
    if (fh - borrow - th < 0) {
      c.slideDir = true;
      lo = tl - fl; borrow = lo < 0 ? 1 : 0;
      e = lo & 0xff; d = (th - ((fh - borrow) & 0xff)) & 0xff;
    } else {
      c.slideDir = false;
      e = lo & 0xff; d = (fh - borrow - th) & 0xff;
    }
    const div = this.curNoteDur;
    let b = 0;
    for (;;) {
      b++;
      const r = e - div; e = r & 0xff;
      if (r >= 0) continue;
      if (d === 0) break;
      d--;
    }
    c.slideAmount = b & 0xff; c.slideFrac = (e + div) & 0xff; c.field25 = 0;
  }
  applySlide(c) {
    if (!c.slide) return;
    let de = c.freq;
    const th = c.slideTarget >> 8, tl = c.slideTarget & 0xff;
    let finished;
    if (c.slideDir) {
      de = (de + c.slideAmount) & 0xffff;
      const s = c.field25 + c.slideFrac; c.field25 = s & 0xff;
      de = (de + (s >> 8)) & 0xffff;
      const d = de >> 8, e = de & 0xff;
      finished = th < d || (th === d && tl < e);
    } else {
      de = (de - c.slideAmount) & 0xffff;
      const s = c.slideFrac * 2; c.slideFrac = s & 0xff;
      de = (de - (s >> 8)) & 0xffff;
      const d = de >> 8, e = de & 0xff;
      finished = d < th || (d === th && e < tl);
    }
    if (finished) { c.slide = false; c.slideDir = false; return; }
    c.freq = de; c.nfFreq = true; c.nfDuty = true;
  }
  vibratoEtc(c) {
    if (c.dutyLoop) { c.dutyPat = rlc2(c.dutyPat); this.curDuty = c.dutyPat & 0xc0; c.nfDuty = true; }
    if (c.pitchOffsetOn) this.curFreq = (this.curFreq + c.pitchOffset) & 0xffff;
    if (!c.vibrato) return;
    if (c.vibDelayCount) { c.vibDelayCount--; return; }
    const ext = c.vibExt;
    if (!ext) return;
    if (c.vibRate & 0xf) { c.vibRate--; return; }
    c.vibRate = c.vibRate | (c.vibRate >> 4);
    const e = this.curFreq & 0xff;
    let a;
    if (c.vibDir) { c.vibDir = false; a = e - (ext & 0xf); if (a < 0) a = 0; }
    else { c.vibDir = true; a = e + (ext >> 4); if (a > 0xff) a = 0xff; }
    this.curFreq = (this.curFreq & 0xff00) | a;
    c.nfVib = true;
  }
  command(c, a) {
    if (a <= 0xd7) { c.octave = a & 7; return; }
    switch (a) {
      case 0xd8: c.noteLength = this.byte(c); if ((this.cur & 3) !== 3) c.env = this.byte(c); return;
      case 0xd9: c.transpose = this.byte(c); return;
      case 0xda: { const d = this.byte(c), e = this.byte(c); this.setGlobalTempo((d << 8) | e); return; }
      case 0xdb: c.duty = rrc2(this.byte(c)) & 0xc0; return;
      case 0xdc: c.env = this.byte(c); return;
      case 0xdd: this.pitchSweep = this.byte(c); c.nfSweep = true; return;
      case 0xde: c.dutyLoop = true; c.dutyPat = rrc2(this.byte(c)); c.duty = c.dutyPat & 0xc0; return;
      case 0xdf: c.sfx = !c.sfx; return;
      case 0xe0: {
        this.curNoteDur = this.byte(c);
        const p = this.byte(c);
        c.slideTarget = this.getFrequency(c, p >> 4, p & 0xf);
        c.slide = true;
        return;
      }
      case 0xe1: {
        c.vibrato = true; c.vibDir = false;
        const dl = this.byte(c); c.vibDelay = dl; c.vibDelayCount = dl;
        const p = this.byte(c), n = p >> 4, e = n >> 1;
        c.vibExt = ((e + (n & 1)) << 4) | e;
        c.vibRate = ((p & 0xf) << 4) | (p & 0xf);
        return;
      }
      case 0xe2: case 0xe7: case 0xe8: this.byte(c); return;
      case 0xe3: if (c.noise) c.noise = false; else { c.noise = true; this.musicNoiseSet = this.byte(c); } return;
      case 0xe4: c.tracks = GSC_TRACKS[this.cur & 3] & this.byte(c); return;
      case 0xe5: this.volume = this.byte(c); return;
      case 0xe6: { const h = this.byte(c), l = this.byte(c); c.pitchOffsetOn = true; c.pitchOffset = (h << 8) | l; return; }
      case 0xe9: { const v = this.byte(c), d = v >= 0x80 ? v - 256 : v; this.setGlobalTempo((c.tempo + d) & 0xffff); return; }
      case 0xea: case 0xeb: case 0xee: this.byte(c); this.byte(c); return; // (unused by these songs)
      case 0xec: case 0xed: return;                    // sfx priority
      case 0xef: { const v = this.byte(c); if (this.stereo) c.tracks = GSC_TRACKS[this.cur & 3] & v; return; }
      case 0xf0: if (c.noise) c.noise = false; else { c.noise = true; this.sfxNoiseSet = this.byte(c); } return;
      case 0xfa: c.condition = this.byte(c); return;
      case 0xfb: { const k = this.byte(c); if (k === c.condition) { const lo = this.byte(c); c.addr = lo | (this.byte(c) << 8); } else c.addr = (c.addr + 2) & 0xffff; return; }
      case 0xfc: { if (this.onLoop) this.onLoop(this.cur); const lo = this.byte(c); c.addr = lo | (this.byte(c) << 8); return; }
      case 0xfd: {
        let n = this.byte(c);
        if (!c.looping) {
          if (n === 0) { if (this.onLoop) this.onLoop(this.cur); const lo = this.byte(c); c.addr = lo | (this.byte(c) << 8); return; }
          c.looping = true; c.loopCount = n - 1;
        }
        if (c.loopCount === 0) { c.looping = false; c.addr = (c.addr + 2) & 0xffff; return; }
        c.loopCount--;
        const lo = this.byte(c); c.addr = lo | (this.byte(c) << 8);
        return;
      }
      case 0xfe: { const lo = this.byte(c), p = lo | (this.byte(c) << 8); c.lastAddr = c.addr; c.addr = p; c.sub = true; return; }
      case 0xff: c.sub = false; c.addr = c.lastAddr; return;
      default: return;                                 // f1-f9: nothing
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// The player: one BGM song plus an optional fanfare that pauses it (like m4a's PlayFanfare), fades, end events.
// songs: retro.json's song table; games: { red: {banks: {2: Uint8Array, ...}, tables}, silver: {...} }.
export class GbPlayer {
  constructor(sampleRate, emit = () => {}) {
    this.apu = new Apu(sampleRate);
    this.emit = emit;
    this.games = null; this.songs = null;
    this.bgm = null; this.fan = null; this.paused = false; this.stereo = true;
    this.fade = 1; this.fadeStep = 0;
    this.gain = 1.12; // (about the GBA music's loudness: tests/retro_audio.mjs compares them)
    this.L = new Float32Array(2048); this.R = new Float32Array(2048); this.have = 0; this.at = 0;
    this.frames = 0; this.tail = 0;
  }
  load(meta, binaries) {
    this.songs = meta.songs;
    this.games = {};
    for (const [key, g] of Object.entries(meta.games)) {
      const bin = binaries[key];
      if (!bin) continue;
      const banks = {};
      g.banks.forEach((b, i) => { banks[b] = new Uint8Array(bin, i * 0x4000, 0x4000); });
      this.games[key] = { engine: g.engine, banks, tables: g.tables };
    }
  }
  has(name) { const s = this.songs && this.songs[name]; return !!(s && this.games && this.games[s.game]); }
  makeEngine(name) {
    const s = this.songs[name], g = this.games[s.game];
    if (g.engine === 'red') {
      const e = new RedEngine(g.banks[s.bank], g.tables[s.bank], this.apu);
      if (s.sfx) e.playSfx(((s.header - g.tables[s.bank].sfxHeaders) / 3) & 0xff); else e.playMusic(s.header);
      return e;
    }
    const e = new GscEngine(g.banks, g.tables, this.apu, { stereo: this.stereo });
    e.start(s.bank, s.header, !!s.sfx);
    return e;
  }
  silence() { this.apu.reset(); }
  playBgm(name, tag = 0, opts = {}) {
    if (!this.has(name)) return false;
    if (this.fan) this.emit({ type: 'end', tag: this.fan.tag, fanfare: true });
    this.fan = null;
    this.silence();
    this.bgm = { name, tag, engine: this.makeEngine(name), next: opts.next || null, ended: false };
    this.paused = false;
    this.fadeStep = 0;
    if (opts.fadeInFrames) { this.fade = 0; this.fadeStep = 1 / opts.fadeInFrames; } else this.fade = 1;
    return true;
  }
  playFanfare(name, tag = 0) {
    if (!this.has(name)) return false;
    if (this.fan) this.emit({ type: 'end', tag: this.fan.tag, fanfare: true });
    this.saved = [this.apu.r(0xff24), this.apu.r(0xff25)];
    this.silence();
    this.fan = { name, tag, engine: this.makeEngine(name) };
    return true;
  }
  stop() { this.bgm = null; this.fan = null; this.silence(); this.fadeStep = 0; this.fade = 1; }
  fadeOut(frames) { if (this.bgm) this.fadeStep = -1 / Math.max(1, frames); }
  // one sound-driver tick + one frame of audio
  frame() {
    this.frames++;
    if (this.fan) {
      this.fan.engine.update();
      if (!this.fan.engine.active) {
        const tag = this.fan.tag;
        this.fan = null;
        this.silence();
        if (this.saved) { this.apu.w(0xff24, this.saved[0]); this.apu.w(0xff25, this.saved[1]); }
        this.emit({ type: 'end', tag, fanfare: true });
      }
    } else if (this.bgm && !this.paused) {
      this.bgm.engine.update();
      if (!this.bgm.engine.active && !this.bgm.ended) {
        this.bgm.ended = true;
        this.emit({ type: 'end', tag: this.bgm.tag, name: this.bgm.name });
        if (this.bgm.next && this.has(this.bgm.next)) this.playBgm(this.bgm.next, this.bgm.tag);
      }
    }
    if (this.fadeStep) {
      this.fade += this.fadeStep;
      if (this.fade >= 1) { this.fade = 1; this.fadeStep = 0; }
      if (this.fade <= 0) { this.fade = 0; this.fadeStep = 0; this.bgm = null; this.silence(); this.fade = 1; }
    }
    const n = this.apu.runFrame();
    if (this.L.length < n) { this.L = new Float32Array(n * 2); this.R = new Float32Array(n * 2); }
    const muted = this.paused && !this.fan;
    this.apu.read(this.L, this.R, n, 0, muted ? 0 : this.gain * this.fade);
    this.have = n; this.at = 0;
  }
  // fills L/R (R may be null) with n samples
  process(L, R, n) {
    let o = 0;
    while (o < n) {
      if (this.at >= this.have) {
        // nothing playing: a few more frames let the last notes' release and the filters settle, then no work at all
        if (!this.bgm && !this.fan && this.tail <= 0) { L.fill(0, o, n); if (R) R.fill(0, o, n); return; }
        if (!this.bgm && !this.fan) this.tail--; else this.tail = 6;
        this.frame();
      }
      const k = Math.min(n - o, this.have - this.at);
      L.set(this.L.subarray(this.at, this.at + k), o);
      if (R) R.set(this.R.subarray(this.at, this.at + k), o);
      this.at += k; o += k;
    }
  }
  onMessage(m) {
    switch (m.type) {
      case 'load': this.load(m.meta, m.binaries); this.emit({ type: 'loaded', ok: !!this.games }); break;
      case 'bgm': if (!this.playBgm(m.name, m.tag, m)) this.emit({ type: 'end', tag: m.tag, missing: true }); break;
      case 'fanfare': if (!this.playFanfare(m.name, m.tag)) this.emit({ type: 'end', tag: m.tag, fanfare: true, missing: true }); break;
      case 'stop': this.stop(); break;
      case 'pause': this.paused = true; break;
      case 'resume': this.paused = false; break;
      case 'fadeOut': this.fadeOut(m.frames || 60); break;
      case 'option': if (m.stereo !== undefined) { this.stereo = !!m.stereo; this.apu.mono = !m.stereo; } break;
      default: break;
    }
  }
}
