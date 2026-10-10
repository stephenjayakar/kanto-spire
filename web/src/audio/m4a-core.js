// Kanto Spire - MP2K / "m4a" (Sappy) sound driver core, ported from pret/pokefirered
// (src/m4a.c, src/m4a_1.s, src/m4a_tables.c). Pure JS, no DOM: used by the AudioWorklet
// (m4a-worklet.js) and by Node (tests/render_audio.js).
//
// What is emulated, per V-blank frame (59.7275 Hz), in the same order as SoundMain:
//   MPlayMain for each music player (BGM, SE1, SE2, SE3, cry0, cry1) -> CgbSound -> SoundMainRAM
// * sequencer: tempo accumulator (tempoI += tempo*2 per frame, one tick per 150), every
//   track command incl. running status, PATT/PEND stack, REPT, MEMACC, XCMDs, LFO, gate times
// * DirectSound: 5 channels (m4aSoundMode maxChans), priority based stealing, ADSR + pseudo
//   echo per frame, the exact SoundMainRAM integer mixer at 13379 Hz into an 8-bit wrapping
//   PCM ring (1584-byte DMA buffer = 7 frames of 224 samples) incl. linear sample
//   interpolation (as the real mixer does), fixed-frequency, reverse and DPCM compressed
//   samples (cries), and the m4a reverb that feeds back older ring blocks.
// * CGB (PSG) channels: CgbSound's software envelope state machine (with the c15 double
//   step) driving a register-level GB APU model (square + sweep, square, wave, noise with
//   hardware envelopes, length counters, NR51 panning), rendered band-limited by box
//   filtering directly at the output rate.
// * Output: DirectSound ring played one frame late (like the DMA), upsampled from 13379 Hz
//   with zero-order hold (the GBA DAC behaviour; 'linear' optional), mixed with PSG at
//   GBA levels (DMA 100%: sample*4, PSG 100% at NR50=7: level*16, 10-bit clip), DC blocked.
// * quality 'hq' (default in the game; 'gba' above stays bit-exact): the same sequencer and
//   envelopes, but up to 12 DirectSound channels, voices mixed at 2x 13379 Hz in full precision
//   (float ring: no 8-bit quantisation or wrap-around), linear upsampling to the output rate, a
//   9 kHz low-pass and a soft limiter instead of the 10-bit clip.

/* eslint-disable no-fallthrough */

export const GBA_CLOCK = 16777216;
export const FRAME_CYCLES = 280896;
export const PCM_SAMPLES_PER_FRAME = 224;           // gPcmSamplesPerVBlankTable[3] (13379 Hz mode)
export const PCM_RATE = GBA_CLOCK / (FRAME_CYCLES / PCM_SAMPLES_PER_FRAME); // 13378.96 Hz
export const FRAME_RATE = GBA_CLOCK / FRAME_CYCLES; // 59.7275 Hz
const PCM_FREQ = Math.trunc((597275 * PCM_SAMPLES_PER_FRAME + 5000) / 10000); // 13379
const DIV_FREQ = (Math.trunc(16777216 / PCM_FREQ) + 1) >> 1;                  // 627
const PCM_DMA_PERIOD = Math.trunc(1584 / PCM_SAMPLES_PER_FRAME);               // 7

// ------------------------------------------------------------------ tables (m4a_tables.c)
const CLOCK_TABLE = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24,
  28, 30, 32, 36, 40, 42, 44, 48, 52, 54, 56, 60, 64, 66, 68, 72, 76, 78, 80, 84, 88, 90, 92, 96];
const SCALE_TABLE = [];
for (let oct = 0; oct < 15; oct++) for (let n = 0; n < 12; n++) SCALE_TABLE.push(((14 - oct) << 4) | n);
const FREQ_TABLE = [2147483648, 2275179671, 2410468894, 2553802834, 2705659852, 2866546760,
  3037000500, 3217589947, 3408917802, 3611622603, 3826380858, 4053909305];
const CGB_SCALE_TABLE = [];
for (let oct = 0; oct < 11; oct++) for (let n = 0; n < 12; n++) CGB_SCALE_TABLE.push((oct << 4) | n);
const CGB_FREQ_TABLE = [-2004, -1891, -1785, -1685, -1591, -1501, -1417, -1337, -1262, -1192, -1125, -1062];
const NOISE_TABLE = [0xD7, 0xD6, 0xD5, 0xD4, 0xC7, 0xC6, 0xC5, 0xC4, 0xB7, 0xB6, 0xB5, 0xB4, 0xA7, 0xA6, 0xA5, 0xA4,
  0x97, 0x96, 0x95, 0x94, 0x87, 0x86, 0x85, 0x84, 0x77, 0x76, 0x75, 0x74, 0x67, 0x66, 0x65, 0x64,
  0x57, 0x56, 0x55, 0x54, 0x47, 0x46, 0x45, 0x44, 0x37, 0x36, 0x35, 0x34, 0x27, 0x26, 0x25, 0x24,
  0x17, 0x16, 0x15, 0x14, 0x07, 0x06, 0x05, 0x04, 0x03, 0x02, 0x01, 0x00];
// gCgb3Vol is followed in ROM by gClockTable; out-of-range envelope volumes read into it.
const CGB3_VOL = [0x00, 0x00, 0x60, 0x60, 0x60, 0x60, 0x40, 0x40, 0x40, 0x40, 0x80, 0x80, 0x80, 0x80, 0x20, 0x20]
  .concat(CLOCK_TABLE);
const DELTA_TABLE = [0, 1, 4, 9, 16, 25, 36, 49, -64, -49, -36, -25, -16, -9, -4, -1];

// ------------------------------------------------------------------ constants
const ID_SF_START = 0x80, SF_STOP = 0x40, SF_SPECIAL = 0x20, SF_LOOP = 0x10, SF_IEC = 0x04, SF_ENV = 0x03;
const SF_START = ID_SF_START;
const SF_ON = SF_START | SF_STOP | SF_IEC | SF_ENV;
const ENV_ATTACK = 3, ENV_DECAY = 2, ENV_SUSTAIN = 1, ENV_RELEASE = 0;
const T_CGB = 0x07, T_FIX = 0x08, T_REV = 0x10, T_CMP = 0x20, T_SPL = 0x40, T_RHY = 0x80;
const MO_PIT = 0x02, MO_VOL = 0x01;
const F_VOLSET = 0x01, F_VOLCHG = 0x03, F_PITSET = 0x04, F_PITCHG = 0x0C, F_START = 0x40, F_EXIST = 0x80;
const STATUS_PAUSE = 0x80000000;
const FADE_IN = 0x0002, TEMPORARY_FADE = 0x0001;
const C_V = 0x40;

const s8 = (v) => (v << 24) >> 24;
const u8 = (v) => v & 0xFF;

// High 32 bits of an unsigned 32x32 multiply (umul3232H32).
function umul3232H32(a, b) {
  a >>>= 0; b >>>= 0;
  const aH = a >>> 16, aL = a & 0xFFFF, bH = b >>> 16, bL = b & 0xFFFF;
  const lo = aL * bL, m1 = aH * bL, m2 = aL * bH, hi = aH * bH;
  const carry = Math.floor(((lo >>> 16) + (m1 & 0xFFFF) + (m2 & 0xFFFF)) / 65536);
  return (hi + (m1 >>> 16) + (m2 >>> 16) + carry) >>> 0;
}

// ------------------------------------------------------------------ memory
// Sparse view of the ROM (segments keep original GBA addresses) plus small RAM regions.
export class SparseMemory {
  constructor(bytes, segments) {
    this.bytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const segs = segments.slice().sort((a, b) => a.addr - b.addr);
    this.addrs = segs.map((s) => s.addr);
    this.ends = segs.map((s) => s.addr + s.length);
    this.offs = segs.map((s) => s.offset);
    this.bufs = segs.map(() => this.bytes);
    this.last = 0;
    this.misses = 0;
    this.missSet = new Set();
  }
  // A second bank (another game's songs, relocated by its extractor to addresses this one doesn't use, e.g. Emerald's
  // at 0x0A000000+: tools/extract_emerald_sound.js): its segments join the address space with their own buffer.
  addSegments(bytes, segments) {
    const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    for (const s of segments) {
      let i = 0;
      while (i < this.addrs.length && this.addrs[i] < s.addr) i++;
      if ((i > 0 && this.ends[i - 1] > s.addr) || (i < this.addrs.length && this.addrs[i] < s.addr + s.length)) throw new Error('bank segments overlap');
      this.addrs.splice(i, 0, s.addr); this.ends.splice(i, 0, s.addr + s.length);
      this.offs.splice(i, 0, s.offset); this.bufs.splice(i, 0, buf);
    }
    this.last = 0;
  }
  addRam(addr, size) {
    const buf = new Uint8Array(size);
    let i = 0;
    while (i < this.addrs.length && this.addrs[i] < addr) i++;
    this.addrs.splice(i, 0, addr); this.ends.splice(i, 0, addr + size);
    this.offs.splice(i, 0, 0); this.bufs.splice(i, 0, buf);
    return buf;
  }
  find(a) {
    const L = this.last;
    if (a >= this.addrs[L] && a < this.ends[L]) return L;
    let lo = 0, hi = this.addrs.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (a < this.addrs[mid]) hi = mid - 1;
      else if (a >= this.ends[mid]) lo = mid + 1;
      else { this.last = mid; return mid; }
    }
    return -1;
  }
  u8(a) {
    a >>>= 0;
    const i = this.find(a);
    if (i < 0) { this.misses++; if (this.missSet.size < 64) this.missSet.add(a); return 0; }
    return this.bufs[i][this.offs[i] + a - this.addrs[i]];
  }
  u16(a) { return this.u8(a) | (this.u8(a + 1) << 8); }
  u32(a) { return (this.u8(a) | (this.u8(a + 1) << 8) | (this.u8(a + 2) << 16) | (this.u8(a + 3) << 24)) >>> 0; }
  // Contiguous Int8Array view of [a, a+len) clipped to the containing segment (null if unmapped).
  s8view(a, len) {
    const i = this.find(a >>> 0);
    if (i < 0) { this.misses++; if (this.missSet.size < 64) this.missSet.add(a >>> 0); return null; }
    const start = this.offs[i] + a - this.addrs[i];
    const avail = this.ends[i] - a;
    const buf = this.bufs[i];
    return new Int8Array(buf.buffer, buf.byteOffset + start, Math.min(len, avail));
  }
}

// ------------------------------------------------------------------ GB APU (PSG) model
const NR10 = 0x60, NR11 = 0x62, NR12 = 0x63, NR13 = 0x64, NR14 = 0x65;
const NR21 = 0x68, NR22 = 0x69, NR23 = 0x6C, NR24 = 0x6D;
const NR30 = 0x70, NR31 = 0x72, NR32 = 0x73, NR33 = 0x74, NR34 = 0x75;
const NR41 = 0x78, NR42 = 0x79, NR43 = 0x7C, NR44 = 0x7D;
const NR50 = 0x80, NR51 = 0x81;
const DUTY = [0.125, 0.25, 0.5, 0.75];

class PsgChannel {
  constructor(i) {
    this.i = i; this.on = false; this.dac = false;
    this.duty = 2; this.len = 0; this.lenEn = false;
    this.initVol = 0; this.envDir = 0; this.envPer = 0; this.envTimer = 0; this.vol = 0;
    this.freq = 0; this.phase = 0;
    this.sweepTime = 0; this.sweepDir = 0; this.sweepShift = 0; this.sweepTimer = 0; this.sweepEn = false; this.shadow = 0;
    this.lfsr = 0x7FFF; this.width7 = 0; this.nShift = 0; this.nDiv = 0;
    this.pos = 0; this.volCode = 0; this.scale = 1;
  }
}

export class Psg {
  constructor(rate) {
    this.rate = rate; this.dt = 1 / rate;
    this.regs = new Uint8Array(0x40);
    this.wave = [new Uint8Array(16), new Uint8Array(16)];
    this.waveLevels = new Float32Array(32);
    this.ch = [new PsgChannel(0), new PsgChannel(1), new PsgChannel(2), new PsgChannel(3)];
    this.fsTimer = 0; this.fsStep = 0;
    this.noisePhase = 0;
    this.writeCount = 0;
  }
  read(addr) { return this.regs[addr - 0x60]; }
  writeWaveRam(bytes16) {
    const bank = ((this.regs[NR30 - 0x60] >> 6) & 1) ^ 1; // CPU accesses the bank not selected for playback
    this.wave[bank].set(bytes16);
    this._updateWave();
  }
  _updateWave() {
    const c = this.ch[2];
    const w = this.wave[(this.regs[NR30 - 0x60] >> 6) & 1];
    for (let i = 0; i < 16; i++) {
      for (let h = 0; h < 2; h++) {
        let v = h === 0 ? w[i] >> 4 : w[i] & 15;
        if (c.volCode & 4) v = (v * 3) >> 2;               // forced 75%
        else switch (c.volCode & 3) { case 0: v = 0; break; case 1: break; case 2: v >>= 1; break; case 3: v >>= 2; break; }
        this.waveLevels[i * 2 + h] = v;
      }
    }
  }
  write(addr, v) {
    v &= 0xFF;
    this.writeCount++;
    if (addr >= 0x90 && addr < 0xA0) {
      const bank = ((this.regs[NR30 - 0x60] >> 6) & 1) ^ 1;
      this.wave[bank][addr - 0x90] = v; this._updateWave(); return;
    }
    if (addr < 0x60 || addr >= 0xA0) return;
    this.regs[addr - 0x60] = v;
    const [c1, c2, c3, c4] = this.ch;
    switch (addr) {
      case NR10: c1.sweepTime = (v >> 4) & 7; c1.sweepDir = (v >> 3) & 1; c1.sweepShift = v & 7; break;
      case NR11: c1.duty = v >> 6; c1.len = 64 - (v & 63); break;
      case NR21: c2.duty = v >> 6; c2.len = 64 - (v & 63); break;
      case NR41: c4.len = 64 - (v & 63); break;
      case NR12: case NR22: case NR42: {
        const c = addr === NR12 ? c1 : addr === NR22 ? c2 : c4;
        c.initVol = v >> 4; c.envDir = (v >> 3) & 1; c.envPer = v & 7;
        c.dac = (v & 0xF8) !== 0; if (!c.dac) c.on = false;
        break;
      }
      case NR13: c1.freq = (c1.freq & 0x700) | v; break;
      case NR23: c2.freq = (c2.freq & 0x700) | v; break;
      case NR33: c3.freq = (c3.freq & 0x700) | v; break;
      case NR14: case NR24: case NR34: case NR44: {
        const c = addr === NR14 ? c1 : addr === NR24 ? c2 : addr === NR34 ? c3 : c4;
        if (c !== c4) c.freq = (c.freq & 0xFF) | ((v & 7) << 8);
        c.lenEn = (v & 0x40) !== 0;
        if (v & 0x80) this._trigger(c);
        break;
      }
      case NR30: c3.dac = (v & 0x80) !== 0; if (!c3.dac) c3.on = false; this._updateWave(); break;
      case NR31: c3.len = 256 - v; break;
      case NR32: c3.volCode = ((v >> 5) & 3) | ((v & 0x80) ? 4 : 0); this._updateWave(); break;
      case NR43: c4.nShift = v >> 4; c4.width7 = (v >> 3) & 1; c4.nDiv = v & 7; break;
      default: break;
    }
  }
  _trigger(c) {
    c.on = c.dac;
    if (c.len === 0) c.len = c.i === 2 ? 256 : 64;
    if (c.i === 2) { c.pos = 0; return; }
    c.vol = c.initVol; c.envTimer = c.envPer || 8;
    if (c.i === 3) c.lfsr = 0x7FFF;
    if (c.i === 0) {
      c.shadow = c.freq;
      c.sweepTimer = c.sweepTime || 8;
      c.sweepEn = c.sweepTime !== 0 || c.sweepShift !== 0;
      if (c.sweepShift && this._sweepCalc(c) > 2047) c.on = false;
    }
  }
  _sweepCalc(c) {
    const d = c.shadow >> c.sweepShift;
    return c.sweepDir ? c.shadow - d : c.shadow + d;
  }
  _frameSeq() {
    const s = this.fsStep;
    this.fsStep = (s + 1) & 7;
    if ((s & 1) === 0) {
      for (const c of this.ch) if (c.lenEn && c.len > 0 && --c.len === 0) c.on = false;
    }
    if (s === 2 || s === 6) {
      const c = this.ch[0];
      if (--c.sweepTimer <= 0) {
        c.sweepTimer = c.sweepTime || 8;
        if (c.sweepEn && c.sweepTime) {
          const nf = this._sweepCalc(c);
          if (nf > 2047) c.on = false;
          else if (c.sweepShift) {
            c.shadow = nf; c.freq = nf;
            if (this._sweepCalc(c) > 2047) c.on = false;
          }
        }
      }
    }
    if (s === 7) {
      for (let i = 0; i < 4; i++) {
        if (i === 2) continue;
        const c = this.ch[i];
        if (!c.envPer) continue;
        if (--c.envTimer <= 0) {
          c.envTimer = c.envPer;
          if (c.envDir && c.vol < 15) c.vol++;
          else if (!c.envDir && c.vol > 0) c.vol--;
        }
      }
    }
  }
  // Renders one output sample; returns left in this.outL, right in this.outR (GBA mixer units).
  sample() {
    const dt = this.dt;
    this.fsTimer += dt * 512;
    while (this.fsTimer >= 1) { this.fsTimer -= 1; this._frameSeq(); }
    const nr51 = this.regs[NR51 - 0x60], nr50 = this.regs[NR50 - 0x60];
    let L = 0, R = 0;
    for (let i = 0; i < 4; i++) {
      const c = this.ch[i];
      let level = 0;
      if (i < 2) {
        const f = 131072 / (2048 - c.freq);
        const dp = f * dt;
        if (c.on && c.dac && c.vol) {
          const d = DUTY[c.duty];
          const p0 = c.phase, p1 = p0 + dp;
          const F1 = Math.floor(p1) * d + Math.min(p1 - Math.floor(p1), d);
          const F0 = Math.min(p0, d);
          level = c.vol * (F1 - F0) / dp;
        }
        c.phase = (c.phase + dp) % 1;
      } else if (i === 2) {
        const f = 2097152 / (2048 - c.freq);
        const dp = f * dt;
        if (c.on && c.dac) {
          const lv = this.waveLevels;
          if (dp >= 32) {
            let s = 0; for (let k = 0; k < 32; k++) s += lv[k];
            level = s / 32;
          } else {
            let p = c.pos, rem = dp, acc = 0;
            while (rem > 1e-12) {
              const fl = Math.floor(p);
              const seg = Math.min(rem, fl + 1 - p);
              acc += lv[fl & 31] * seg;
              p += seg; rem -= seg;
            }
            level = acc / dp;
          }
          c.pos = (c.pos + dp) % 32;
        }
      } else {
        if (c.on && c.dac) {
          if (c.nShift < 14) {
            const f = 524288 / (c.nDiv ? c.nDiv : 0.5) / (1 << (c.nShift + 1));
            let rem = f * dt, total = rem, acc = 0, ph = this.noisePhase, guard = 0;
            while (rem > 1e-12 && guard++ < 4096) {
              const seg = Math.min(rem, 1 - ph);
              acc += ((~c.lfsr) & 1) * seg;
              rem -= seg; ph += seg;
              if (ph >= 1) {
                ph -= 1;
                const x = (c.lfsr ^ (c.lfsr >> 1)) & 1;
                c.lfsr = (c.lfsr >> 1) | (x << 14);
                if (c.width7) c.lfsr = (c.lfsr & ~0x40) | (x << 6);
              }
            }
            this.noisePhase = ph;
            level = c.vol * acc / total;
          } else level = c.vol * ((~c.lfsr) & 1);
        }
      }
      if (level) {
        level *= c.scale;
        if (nr51 & (0x10 << i)) L += level;
        if (nr51 & (0x01 << i)) R += level;
      }
    }
    // mGBA-equivalent scale: (level << 3) * (1 + NR50 volume) >> 2 at SOUNDCNT_H PSG 100%
    this.outL = L * 2 * (1 + ((nr50 >> 4) & 7));
    this.outR = R * 2 * (1 + (nr50 & 7));
  }
}

// ------------------------------------------------------------------ driver structures
class Tone {
  constructor() { this.type = 0; this.key = 0; this.length = 0; this.panSweep = 0; this.wav = 0; this.adsr = 0; }
  get attack() { return this.adsr & 0xFF; }
  get decay() { return (this.adsr >>> 8) & 0xFF; }
  get sustain() { return (this.adsr >>> 16) & 0xFF; }
  get release() { return (this.adsr >>> 24) & 0xFF; }
  setByte(i, v) { const sh = i * 8; this.adsr = ((this.adsr & ~(0xFF << sh)) | ((v & 0xFF) << sh)) >>> 0; }
  load(mem, a) {
    this.type = mem.u8(a); this.key = mem.u8(a + 1); this.length = mem.u8(a + 2); this.panSweep = mem.u8(a + 3);
    this.wav = mem.u32(a + 4); this.adsr = mem.u32(a + 8);
    return this;
  }
}

class Track {
  constructor(player, index, ordinal) {
    this.player = player; this.index = index; this.ordinal = ordinal;
    this.cmdPtr = 0; this.patternStack = [0, 0, 0];
    this.tone = new Tone();
    this.clear64();
    this.flags = 0;
  }
  clear64() { // Clear64byte: everything before cmdPtr
    this.flags = 0; this.wait = 0; this.patternLevel = 0; this.repN = 0; this.gateTime = 0; this.key = 0;
    this.velocity = 0; this.runningStatus = 0; this.keyM = 0; this.pitM = 0; this.keyShift = 0; this.keyShiftX = 0;
    this.tune = 0; this.pitX = 0; this.bend = 0; this.bendRange = 0; this.volMR = 0; this.volML = 0; this.vol = 0;
    this.volX = 0; this.pan = 0; this.panX = 0; this.modM = 0; this.mod = 0; this.modT = 0; this.lfoSpeed = 0;
    this.lfoSpeedC = 0; this.lfoDelay = 0; this.lfoDelayC = 0; this.priority = 0; this.pseudoEchoVolume = 0;
    this.pseudoEchoLength = 0; this.chan = null;
    this.tone.type = 0; this.tone.key = 0; this.tone.length = 0; this.tone.panSweep = 0; this.tone.wav = 0; this.tone.adsr = 0;
    this.timer = 0; this.unk3C = 0;
  }
}

class MusicPlayer {
  constructor(id, trackCount, unkB, ordinalBase) {
    this.id = id; this.unkB = unkB;
    this.tracks = [];
    for (let i = 0; i < trackCount; i++) this.tracks.push(new Track(this, i, ordinalBase + i));
    this.trackCount = trackCount;
    this.songHeader = 0; this.status = STATUS_PAUSE; this.priority = 0; this.cmd = 0; this.clock = 0;
    this.tempoD = 0; this.tempoU = 0; this.tempoI = 0; this.tempoC = 0; this.fadeOI = 0; this.fadeOC = 0; this.fadeOV = 0;
    this.tone = 0;
    this.userVolume = 1; // host-side mix scale (music/sfx sliders), not part of m4a
    this.tag = null;     // host bookkeeping (song name / request id)
  }
}

class Channel {
  constructor(cgbType) {
    this.cgbType = cgbType; // 0 = DirectSound, 1..4 = PSG
    this.statusFlags = 0; this.type = 0; this.rightVolume = 0; this.leftVolume = 0;
    this.attack = 0; this.decay = 0; this.sustain = 0; this.release = 0;
    this.key = 0; this.envelopeVolume = 0; this.envR = 0; this.envL = 0;
    this.pseudoEchoVolume = 0; this.pseudoEchoLength = 0;
    this.gateTime = 0; this.midiKey = 0; this.velocity = 0; this.priority = 0; this.rhythmPan = 0;
    this.count = 0; this.fw = 0; this.frequency = 0; this.wav = 0; this.pos = 0;
    this.track = null; this.prev = null; this.next = null; this.owner = null;
    // CGB
    this.envelopeGoal = 0; this.envelopeCounter = 0; this.sustainGoal = 0; this.n4 = 0; this.pan = 0;
    this.panMask = 0; this.modify = 0; this.length = 0; this.sweep = 0; this.wavePointer = 0; this.currentPointer = -1;
  }
  set adsr(v) { this.attack = v & 0xFF; this.decay = (v >>> 8) & 0xFF; this.sustain = (v >>> 16) & 0xFF; this.release = (v >>> 24) & 0xFF; }
}

// Pokemon cry song template (gPokemonCrySongTemplate), 52 bytes
const CRY_SONG_SIZE = 52;
const CRY_RAM_BASE = 0x03007000;
const CRY_MODES = {
  normal: {},
  doubles: { length: 20, release: 225 },
  encounter: { release: 225, pitch: 15600, chorus: 20, volume: 90 },
  high_pitch: { length: 50, release: 200, pitch: 15800, chorus: 20, volume: 90 },
  echo_start: { length: 25, reverse: true, release: 100, pitch: 15600, chorus: 192, volume: 90 },
  faint: { release: 200, pitch: 14440 },
  echo_end: { release: 220, pitch: 15555, chorus: 192, volume: 90 },
  roar_1: { length: 10, release: 100, pitch: 14848 },
  roar_2: { length: 60, release: 225, pitch: 15616 },
  growl_1: { length: 15, reverse: true, release: 125, pitch: 15200 },
  growl_2: { length: 100, release: 225, pitch: 15200 },
  weak_doubles: { length: 20, release: 225, pitch: 15000 },
  weak: { pitch: 15000 },
};
export const CRY_MODE_NAMES = Object.keys(CRY_MODES);

export const PLAYER_BGM = 0, PLAYER_SE1 = 1, PLAYER_SE2 = 2, PLAYER_SE3 = 3, PLAYER_CRY0 = 4, PLAYER_CRY1 = 5;

// ------------------------------------------------------------------ engine
export class M4AEngine {
  /**
   * @param {SparseMemory} mem
   * @param {object} opts { sampleRate, cryTable, cryTableReverse, stereo=true, interpolation='hold' }
   */
  constructor(mem, opts = {}) {
    this.mem = mem;
    this.sampleRate = opts.sampleRate || 48000;
    this.cryTable = opts.cryTable || 0;
    this.cryTableReverse = opts.cryTableReverse || 0;
    this.stereo = opts.stereo !== false;
    this.interpolation = opts.interpolation || 'hold';
    this.masterGain = opts.masterGain ?? 1;
    this.quality = 'gba';

    // SoundInfo
    this.reverb = 0; this.maxChans = 5; this.masterVolume = 12; this.c15 = 0;
    this.memAccArea = new Uint8Array(16);

    this.ds = [];
    for (let i = 0; i < 12; i++) this.ds.push(new Channel(0));
    this.cgb = [new Channel(1), new Channel(2), new Channel(3), new Channel(4)];
    const masks = [0x11, 0x22, 0x44, 0x88];
    this.cgb.forEach((c, i) => { c.type = i + 1; c.panMask = masks[i]; });

    // gMPlayTable (sound/music_player_table.inc) + the two cry players (MPlayOpen order)
    this.players = [
      new MusicPlayer(0, 10, 0, 0x100),
      new MusicPlayer(1, 3, 1, 0x200),
      new MusicPlayer(2, 9, 1, 0x300),
      new MusicPlayer(3, 1, 0, 0x400),
      new MusicPlayer(4, 2, 0, 0x500),
      new MusicPlayer(5, 2, 0, 0x600),
    ];
    this.cryRam = [mem.addRam(CRY_RAM_BASE, CRY_SONG_SIZE), mem.addRam(CRY_RAM_BASE + 0x40, CRY_SONG_SIZE)];
    this.crySong = { trackCount: 1, priority: 255, tuneValue: C_V, tuneValue2: C_V + 16, volume: 127, unk0D: 0,
      release: 0, pan: C_V, tieKey: 60, tieVelocity: 127, length: 60 };
    this.duck = { active: false, player: null };

    this.psg = new Psg(this.sampleRate);
    this.psg.write(NR50, 0); this.psg.write(NR51, 0);
    this.psg.write(NR12, 8); this.psg.write(NR22, 8); this.psg.write(NR42, 8);
    this.psg.write(NR14, 0x80); this.psg.write(NR24, 0x80); this.psg.write(NR44, 0x80);
    this.psg.write(NR30, 0); this.psg.write(NR50, 0x77);

    // PCM DMA ring: 7 blocks of 224 samples; A = right (FIFO A), B = left (FIFO B)
    this.pcmA = new Int8Array(PCM_DMA_PERIOD * PCM_SAMPLES_PER_FRAME);
    this.pcmB = new Int8Array(PCM_DMA_PERIOD * PCM_SAMPLES_PER_FRAME);
    this.block = 0;            // block mixed by the most recent frame
    this.playBlock = 0;        // block being output (mixed one frame earlier)
    this.pcmPos = PCM_SAMPLES_PER_FRAME; // forces a frame on the first sample
    this.pcmStep = PCM_RATE / this.sampleRate;
    this.dcL = { x: 0, y: 0 }; this.dcR = { x: 0, y: 0 };
    this.dcR_coef = 1 - (2 * Math.PI * 8) / this.sampleRate;
    this.frameCount = 0;
    this.decodeCache = new Map();
    this.events = [];          // host notifications: {type:'end', player, tag}
    this.peakClip = 0;
    // mixer geometry ('gba': the real driver; setQuality('hq') changes these)
    this.hq = false; this.osShift = 0; this.mixShift = 8; this.mixN = PCM_SAMPLES_PER_FRAME;
    this.ringOver = 0;         // hq: ring samples that would have wrapped in the GBA's 8-bit buffer
    if (opts.quality === 'hq') this.setQuality('hq');
  }

  /**
   * 'gba' = the exact GBA mixer (5 channels, 8-bit wrapping ring at 13379 Hz, zero-order hold, 10-bit clip).
   * 'hq'  = 12 channels, float ring at 2x 13379 Hz, linear upsampling, 9 kHz low-pass, soft limiter.
   * Can be switched while playing (the ring restarts; notes keep going).
   */
  setQuality(q) {
    const hq = q === 'hq';
    if (hq === this.hq && this.pcmA) return;
    const oldN = this.mixN;
    this.hq = hq; this.quality = hq ? 'hq' : 'gba';
    this.osShift = hq ? 1 : 0;                 // voices mixed at 13379 << osShift Hz
    this.mixShift = hq ? 0 : 8;                // hq keeps the 8 fraction bits of (sample * envelope)
    this.mixN = PCM_SAMPLES_PER_FRAME << this.osShift;
    this.maxChans = hq ? 12 : 5;
    const len = PCM_DMA_PERIOD * this.mixN;
    this.pcmA = hq ? new Float32Array(len) : new Int8Array(len);
    this.pcmB = hq ? new Float32Array(len) : new Int8Array(len);
    this.pcmPos = this.pcmPos * this.mixN / oldN;
    this.pcmStep = PCM_RATE * (1 << this.osShift) / this.sampleRate;
    // 2nd-order Butterworth low-pass (RBJ) at 9 kHz on the final output (hq only)
    const f0 = Math.min(9000, this.sampleRate * 0.45), w = 2 * Math.PI * f0 / this.sampleRate, al = Math.sin(w) / (2 * Math.SQRT1_2), cw = Math.cos(w), a0 = 1 + al;
    this.lp = { b0: (1 - cw) / 2 / a0, b1: (1 - cw) / a0, b2: (1 - cw) / 2 / a0, a1: -2 * cw / a0, a2: (1 - al) / a0 };
    this.lpL = [0, 0, 0, 0]; this.lpR = [0, 0, 0, 0];
  }

  // ---------------------------------------------------------------- host API
  /** m4aSongNumStart equivalent: start the song header on music player `p`. */
  startSong(p, header, tag = null) {
    const mp = this.players[p];
    const started = this.mplayStart(mp, header);
    if (started) mp.tag = tag;
    return started;
  }
  /** m4aSongNumStartOrChange: restart only if a different song or not playing. */
  startOrChange(p, header, tag = null) {
    const mp = this.players[p];
    if (mp.songHeader !== header || (mp.status & 0xFFFF) === 0 || (mp.status & STATUS_PAUSE)) return this.startSong(p, header, tag);
    return false;
  }
  /** FadeInNewBGM-style start: ImmInit, volume 0, stop, then fade in. speed = frames per 1/16 step. */
  startSongFadeIn(p, header, speed, tag = null) {
    const mp = this.players[p];
    this.startSong(p, header, tag);
    this.mplayImmInit(mp);
    this.volumeControl(mp, 0xFFFF, 0);
    this.mplayStop(mp);
    this.fadeIn(mp, Math.max(1, speed | 0));
  }
  stopPlayer(p) { this.mplayStop(this.players[p]); }
  continuePlayer(p) { const mp = this.players[p]; mp.status = (mp.status & ~STATUS_PAUSE) >>> 0; }
  fadeOutPlayer(p, speed) { this.fadeOut(this.players[p], Math.max(1, speed | 0)); }
  isPlaying(p) { const mp = this.players[p]; return !(mp.status & STATUS_PAUSE) && (mp.status & 0xFFFF) !== 0; }
  setPlayerVolume(p, v) { this.players[p].userVolume = Math.max(0, v); }
  /** m4aMPlayVolumeControl (volume 0..256 -> volX). */
  setPlayerTrackVolume(p, volume) { this.volumeControl(this.players[p], 0xFFFF, volume); }
  stopAll() { for (const mp of this.players) this.mplayStop(mp); }

  /**
   * Play a Pokemon cry like PlayCryInternal (sound.c). cryIndex = index into gCryTable.
   * opts: { mode, pitch (15360 = native), length (frames), release, volume (0..127), pan (-64..63),
   *         chorus, reverse, priority, duck (BGM volume 85 while playing) }
   */
  playCry(cryIndex, opts = {}, tag = null) {
    const m = CRY_MODES[opts.mode || 'normal'] || {};
    const pick = (k, d) => (opts[k] !== undefined ? opts[k] : m[k] !== undefined ? m[k] : d);
    const reverse = !!pick('reverse', false);
    const volume = pick('volume', 120);
    const cs = this.crySong;
    // SetPokemonCryVolume / Panpot / Pitch / Length / Progress / Release / Chorus / Priority
    cs.volume = volume & 0x7F;
    cs.pan = (pick('pan', 0) + C_V) & 0x7F;
    {
      const b = s16(pick('pitch', 15360) + 0x80);
      const a = u8(cs.tuneValue2 - cs.tuneValue);
      cs.tieKey = (b >> 8) & 0x7F;
      cs.tuneValue = (b >> 1) & 0x7F;
      cs.tuneValue2 = (a + ((b >> 1) & 0x7F)) & 0x7F;
    }
    cs.length = pick('length', 140) & 0xFFFF;
    cs.unk0D = 0;
    cs.release = pick('release', 0) & 0xFF;
    const chorus = pick('chorus', 0);
    if (chorus) { cs.trackCount = 2; cs.tuneValue2 = (chorus + cs.tuneValue) & 0x7F; } else cs.trackCount = 1;
    cs.priority = pick('priority', 10) & 0xFF;
    const tone = (reverse ? this.cryTableReverse : this.cryTable) + 12 * cryIndex;
    const mp = this.setPokemonCryTone(tone);
    mp.tag = tag;
    if (pick('duck', true)) { this.volumeControl(this.players[PLAYER_BGM], 0xFFFF, 85); this.duck = { active: true, player: mp, frames: 2 }; }
    return mp.id;
  }

  // ---------------------------------------------------------------- m4a.c
  midiKeyToFreq(wav, key, fine) {
    key &= 0xFF; fine &= 0xFF;
    let fineShifted = (fine << 24) >>> 0;
    if (key > 178) { key = 178; fineShifted = (255 << 24) >>> 0; }
    let v1 = SCALE_TABLE[key]; v1 = FREQ_TABLE[v1 & 0xF] >>> (v1 >> 4);
    let v2 = SCALE_TABLE[key + 1]; v2 = FREQ_TABLE[v2 & 0xF] >>> (v2 >> 4);
    return umul3232H32(this.mem.u32(wav + 4), (v1 + umul3232H32((v2 - v1) >>> 0, fineShifted)) >>> 0);
  }
  midiKeyToCgbFreq(chanNum, key, fine) {
    key &= 0xFF; fine &= 0xFF;
    if (chanNum === 4) {
      if (key <= 20) key = 0; else { key -= 21; if (key > 59) key = 59; }
      return NOISE_TABLE[key];
    }
    if (key <= 35) { fine = 0; key = 0; } else { key -= 36; if (key > 130) { key = 130; fine = 255; } }
    let v1 = CGB_SCALE_TABLE[key]; v1 = CGB_FREQ_TABLE[v1 & 0xF] >> (v1 >> 4);
    let v2 = CGB_SCALE_TABLE[key + 1]; v2 = CGB_FREQ_TABLE[v2 & 0xF] >> (v2 >> 4);
    return v1 + ((fine * (v2 - v1)) >> 8) + 2048;
  }

  mplayStart(mp, header) {
    const mem = this.mem;
    const hPrio = mem.u8(header + 2);
    if (!mp.unkB
      || ((!mp.songHeader || !(mp.tracks[0].flags & F_START))
        && ((mp.status & 0xFFFF) === 0 || (mp.status & STATUS_PAUSE)))
      || (mp.priority <= hPrio)) {
      mp.status = 0;
      mp.songHeader = header;
      mp.tone = mem.u32(header + 4);
      mp.priority = hPrio;
      mp.clock = 0;
      mp.tempoD = 150; mp.tempoI = 150; mp.tempoU = 0x100; mp.tempoC = 0;
      mp.fadeOI = 0;
      const tc = mem.u8(header);
      let i = 0;
      for (; i < tc && i < mp.trackCount; i++) {
        const t = mp.tracks[i];
        this.trackStop(mp, t);
        t.flags = F_EXIST | F_START;
        t.chan = null;
        t.cmdPtr = mem.u32(header + 8 + 4 * i);
      }
      for (; i < mp.trackCount; i++) { const t = mp.tracks[i]; this.trackStop(mp, t); t.flags = 0; }
      const rv = mem.u8(header + 3);
      if (rv & 0x80) this.reverb = rv & 0x7F; // m4aSoundMode(reverb)
      return true;
    }
    return false;
  }
  mplayStop(mp) {
    mp.status = (mp.status | STATUS_PAUSE) >>> 0;
    for (const t of mp.tracks) this.trackStop(mp, t);
  }
  mplayImmInit(mp) {
    for (const t of mp.tracks) {
      if ((t.flags & F_EXIST) && (t.flags & F_START)) {
        t.clear64(); t.flags = F_EXIST; t.bendRange = 2; t.volX = 64; t.lfoSpeed = 22; t.tone.type = 1;
      }
    }
  }
  fadeOut(mp, speed) { mp.fadeOC = speed; mp.fadeOI = speed; mp.fadeOV = 64 << 2; }
  fadeIn(mp, speed) { mp.fadeOC = speed; mp.fadeOI = speed; mp.fadeOV = (0 << 2) | FADE_IN; mp.status = (mp.status & ~STATUS_PAUSE) >>> 0; }
  volumeControl(mp, bits, volume) {
    mp.tracks.forEach((t, i) => {
      if ((bits & (1 << i)) && (t.flags & F_EXIST)) { t.volX = (volume >> 2) & 0xFF; t.flags |= F_VOLCHG; }
    });
  }
  fadeOutBody(mp) {
    if (mp.fadeOI === 0) return;
    mp.fadeOC = (mp.fadeOC - 1) & 0xFFFF;
    if (mp.fadeOC !== 0) return;
    mp.fadeOC = mp.fadeOI;
    if (mp.fadeOV & FADE_IN) {
      mp.fadeOV = (mp.fadeOV + (4 << 2)) & 0xFFFF;
      if (mp.fadeOV >= (64 << 2)) { mp.fadeOV = 64 << 2; mp.fadeOI = 0; }
    } else {
      mp.fadeOV = (mp.fadeOV - (4 << 2)) & 0xFFFF;
      if (((mp.fadeOV << 16) >> 16) <= 0) {
        for (const t of mp.tracks) {
          this.trackStop(mp, t);
          if (!(mp.fadeOV & TEMPORARY_FADE)) t.flags = 0;
        }
        if (mp.fadeOV & TEMPORARY_FADE) mp.status = (mp.status | STATUS_PAUSE) >>> 0;
        else mp.status = STATUS_PAUSE;
        mp.fadeOI = 0;
        return;
      }
    }
    for (const t of mp.tracks) {
      if (t.flags & F_EXIST) { t.volX = (mp.fadeOV >> 2) & 0xFF; t.flags |= F_VOLCHG; }
    }
  }
  trkVolPitSet(mp, t) {
    if (t.flags & F_VOLSET) {
      let x = (t.vol * t.volX) >>> 5;
      if (t.modT === 1) x = (x * (t.modM + 128)) >>> 7;
      let y = 2 * t.pan + t.panX;
      if (t.modT === 2) y += t.modM;
      if (y < -128) y = -128; else if (y > 127) y = 127;
      t.volMR = u8(((y + 128) * x) >>> 8);
      t.volML = u8(((127 - y) * x) >>> 8);
    }
    if (t.flags & F_PITSET) {
      const bend = t.bend * t.bendRange;
      let x = (t.tune + bend) * 4 + (t.keyShift << 8) + (t.keyShiftX << 8) + t.pitX;
      if (t.modT === 0) x += 16 * t.modM;
      t.keyM = s8(x >> 8);
      t.pitM = x & 0xFF;
    }
    t.flags &= ~(F_PITSET | F_VOLSET);
  }
  clearModM(t) {
    t.lfoSpeedC = 0; t.modM = 0;
    t.flags |= t.modT === 0 ? F_PITCHG : F_VOLCHG;
  }
  trackStop(mp, t) {
    if (!(t.flags & F_EXIST)) return;
    for (let c = t.chan; c; c = c.next) {
      if (c.statusFlags) {
        if (c.type & T_CGB) this.cgbOscOff(c.type & T_CGB);
        c.statusFlags = 0;
      }
      c.track = null;
    }
    t.chan = null;
  }
  clearChain(c) { // RealClearChain
    const t = c.track;
    if (!t) return;
    const nx = c.next, pv = c.prev;
    if (pv) pv.next = nx; else t.chan = nx;
    if (nx) nx.prev = pv;
    c.track = null;
  }
  chnVolSet(c, t) { // ChnVolSetAsm
    const rp = c.rhythmPan;
    let r = ((0x80 + rp) * c.velocity * t.volMR) >> 14;
    if (r > 0xFF || r < 0) r = 0xFF;
    c.rightVolume = r;
    let l = ((0x7F - rp) * c.velocity * t.volML) >> 14;
    if (l > 0xFF || l < 0) l = 0xFF;
    c.leftVolume = l;
  }

  // ---------------------------------------------------------------- MPlayMain
  mplayMain(mp) {
    if (mp.status & STATUS_PAUSE) return;
    this.fadeOutBody(mp);
    if (mp.status & STATUS_PAUSE) return;
    const mem = this.mem;
    mp.tempoC = (mp.tempoC + mp.tempoI) & 0xFFFF;
    while (mp.tempoC >= 150) {
      let active = 0;
      for (let i = 0; i < mp.trackCount; i++) {
        const t = mp.tracks[i];
        if (!(t.flags & F_EXIST)) continue;
        active |= 1 << i;
        for (let c = t.chan; c;) {
          const nx = c.next;
          if (c.statusFlags & SF_ON) {
            if (c.gateTime !== 0) {
              c.gateTime = (c.gateTime - 1) & 0xFF;
              if (c.gateTime === 0) c.statusFlags |= SF_STOP;
            }
          } else this.clearChain(c);
          c = nx;
        }
        if (t.flags & F_START) {
          t.clear64(); t.flags = F_EXIST; t.bendRange = 2; t.volX = 64; t.lfoSpeed = 22; t.tone.type = 1;
        }
        let stopped = false, guard = 0;
        while (t.wait === 0) {
          if (++guard > 20000) { t.flags = 0; stopped = true; break; } // runaway (bad data) guard
          let cmd = mem.u8(t.cmdPtr);
          if (cmd < 0x80) cmd = t.runningStatus;
          else { t.cmdPtr = (t.cmdPtr + 1) >>> 0; if (cmd >= 0xBD) t.runningStatus = cmd; }
          if (cmd >= 0xCF) this.plyNote(cmd - 0xCF, mp, t);
          else if (cmd > 0xB0) {
            mp.cmd = cmd - 0xB1;
            this.command(cmd, mp, t);
            if (t.flags === 0) { stopped = true; break; }
          } else t.wait = CLOCK_TABLE[cmd - 0x80] ?? 0;
        }
        if (stopped) continue;
        t.wait = (t.wait - 1) & 0xFF;
        // LFO
        const spd = t.lfoSpeed;
        if (spd !== 0 && t.mod !== 0) {
          if (t.lfoDelayC !== 0) t.lfoDelayC--;
          else {
            const sum = t.lfoSpeedC + spd;
            t.lfoSpeedC = sum & 0xFF;
            let r2;
            if (s8(sum - 0x40) < 0) r2 = s8(sum); else r2 = 0x80 - sum;
            r2 = (t.mod * r2) >> 6;
            if (((t.modM ^ r2) & 0xFF) !== 0) {
              t.modM = s8(r2);
              t.flags |= t.modT === 0 ? F_PITCHG : F_VOLCHG;
            }
          }
        }
      }
      mp.clock = (mp.clock + 1) >>> 0;
      if (active === 0) { mp.status = STATUS_PAUSE; return; }
      mp.status = active;
      mp.tempoC -= 150;
    }
    for (let i = 0; i < mp.trackCount; i++) {
      const t = mp.tracks[i];
      if (!(t.flags & F_EXIST) || !(t.flags & (F_VOLCHG | F_PITCHG))) continue;
      this.trkVolPitSet(mp, t);
      for (let c = t.chan; c;) {
        const nx = c.next;
        if (!(c.statusFlags & SF_ON)) { this.clearChain(c); c = nx; continue; }
        const cg = c.type & T_CGB;
        if (t.flags & F_VOLCHG) { this.chnVolSet(c, t); if (cg) c.modify |= MO_VOL; }
        if (t.flags & F_PITCHG) {
          let k = c.key + t.keyM; if (k < 0) k = 0;
          if (cg) { c.frequency = this.midiKeyToCgbFreq(cg, k, t.pitM); c.modify |= MO_PIT; }
          else c.frequency = this.midiKeyToFreq(c.wav, k, t.pitM);
        }
        c = nx;
      }
      t.flags &= 0xF0;
    }
  }

  readArg(t) { const v = this.mem.u8(t.cmdPtr); t.cmdPtr = (t.cmdPtr + 1) >>> 0; return v; }
  plyGoto(t) { t.cmdPtr = this.mem.u32(t.cmdPtr); }
  plyFine(t) {
    for (let c = t.chan; c; c = c.next) {
      if (c.statusFlags & SF_ON) c.statusFlags |= SF_STOP;
      this.clearChain(c);
    }
    t.flags = 0;
  }
  command(cmd, mp, t) {
    const mem = this.mem;
    switch (cmd) {
      case 0xB1: this.plyFine(t); break;                       // FINE
      case 0xB2: this.plyGoto(t); break;                       // GOTO
      case 0xB3:                                               // PATT
        if (t.patternLevel < 3) {
          t.patternStack[t.patternLevel] = (t.cmdPtr + 4) >>> 0;
          t.patternLevel++;
          this.plyGoto(t);
        } else this.plyFine(t);
        break;
      case 0xB4:                                               // PEND
        if (t.patternLevel !== 0) { t.patternLevel--; t.cmdPtr = t.patternStack[t.patternLevel]; }
        break;
      case 0xB5: {                                             // REPT
        const p = t.cmdPtr;
        const n = mem.u8(p);
        if (n === 0) { t.cmdPtr = (p + 1) >>> 0; this.plyGoto(t); break; }
        t.repN = (t.repN + 1) & 0xFF;
        t.cmdPtr = (p + 1) >>> 0;
        if (t.repN < n) this.plyGoto(t);
        else { t.repN = 0; t.cmdPtr = (p + 5) >>> 0; }
        break;
      }
      case 0xB9: this.plyMemacc(mp, t); break;                 // MEMACC
      case 0xBA: t.priority = this.readArg(t); break;          // PRIO
      case 0xBB:                                               // TEMPO
        mp.tempoD = (this.readArg(t) << 1) & 0xFFFF;
        mp.tempoI = ((mp.tempoD * mp.tempoU) >>> 8) & 0xFFFF;
        break;
      case 0xBC: t.keyShift = s8(this.readArg(t)); t.flags |= F_PITCHG; break; // KEYSH
      case 0xBD: {                                             // VOICE
        const n = this.readArg(t);
        t.tone.load(mem, (mp.tone + 12 * n) >>> 0);
        break;
      }
      case 0xBE: t.vol = this.readArg(t); t.flags |= F_VOLCHG; break;            // VOL
      case 0xBF: t.pan = s8(this.readArg(t) - C_V); t.flags |= F_VOLCHG; break;  // PAN
      case 0xC0: t.bend = s8(this.readArg(t) - C_V); t.flags |= F_PITCHG; break; // BEND
      case 0xC1: t.bendRange = this.readArg(t); t.flags |= F_PITCHG; break;      // BENDR
      case 0xC2: t.lfoSpeed = this.readArg(t); if (!t.lfoSpeed) this.clearModM(t); break; // LFOS
      case 0xC3: t.lfoDelay = this.readArg(t); break;                            // LFODL
      case 0xC4: t.mod = this.readArg(t); if (!t.mod) this.clearModM(t); break;  // MOD
      case 0xC5: {                                                               // MODT
        const v = this.readArg(t);
        if (t.modT !== v) { t.modT = v; t.flags |= F_VOLCHG | F_PITCHG; }
        break;
      }
      case 0xC8: t.tune = s8(this.readArg(t) - C_V); t.flags |= F_PITCHG; break; // TUNE
      case 0xCC: {                                                               // PORT
        const reg = this.readArg(t), val = this.readArg(t);
        this.psg.write(0x60 + reg, val);
        break;
      }
      case 0xCD: this.plyXcmd(mp, t); break;                   // XCMD
      case 0xCE: this.plyEndtie(t); break;                     // EOT
      default: this.plyFine(t); break;                         // unused slots -> ply_fine
    }
  }
  plyMemacc(mp, t) {
    const op = this.readArg(t);
    const ai = this.readArg(t) & 15;
    const data = this.readArg(t);
    const A = this.memAccArea;
    const ref = A[data & 15];
    let cond;
    switch (op) {
      case 0: A[ai] = data; return;
      case 1: A[ai] = A[ai] + data; return;
      case 2: A[ai] = A[ai] - data; return;
      case 3: A[ai] = ref; return;
      case 4: A[ai] = A[ai] + ref; return;
      case 5: A[ai] = A[ai] - ref; return;
      case 6: cond = A[ai] === data; break;
      case 7: cond = A[ai] !== data; break;
      case 8: cond = A[ai] > data; break;
      case 9: cond = A[ai] >= data; break;
      case 10: cond = A[ai] <= data; break;
      case 11: cond = A[ai] < data; break;
      case 12: cond = A[ai] === ref; break;
      case 13: cond = A[ai] !== ref; break;
      case 14: cond = A[ai] > ref; break;
      case 15: cond = A[ai] >= ref; break;
      case 16: cond = A[ai] <= ref; break;
      case 17: cond = A[ai] < ref; break;
      default: return;
    }
    if (cond) this.plyGoto(t); else t.cmdPtr = (t.cmdPtr + 4) >>> 0;
  }
  plyXcmd(mp, t) {
    const n = this.readArg(t);
    const mem = this.mem, p = t.cmdPtr;
    switch (n) {
      case 1: t.tone.wav = mem.u32(p); t.cmdPtr = (p + 4) >>> 0; break;           // xWAVE
      case 2: t.tone.type = this.readArg(t); break;                               // xTYPE
      case 4: t.tone.setByte(0, this.readArg(t)); break;                          // xATTA
      case 5: t.tone.setByte(1, this.readArg(t)); break;                          // xDECA
      case 6: t.tone.setByte(2, this.readArg(t)); break;                          // xSUST
      case 7: t.tone.setByte(3, this.readArg(t)); break;                          // xRELE
      case 8: t.pseudoEchoVolume = this.readArg(t); break;                        // xIECV
      case 9: t.pseudoEchoLength = this.readArg(t); break;                        // xIECL
      case 10: t.tone.length = this.readArg(t); break;                            // xLENG
      case 11: t.tone.panSweep = this.readArg(t); break;                          // xSWEE
      case 12: {                                                                  // xWAIT
        const len = mem.u16(p);
        if (t.timer < len) { t.timer++; t.cmdPtr = (p - 2) >>> 0; t.wait = 1; }
        else { t.timer = 0; t.cmdPtr = (p + 2) >>> 0; }
        break;
      }
      case 13: t.unk3C = mem.u32(p); t.cmdPtr = (p + 4) >>> 0; break;            // xCMD_0D (sample start)
      default: this.plyFine(t); break;                                            // ply_xxx
    }
  }
  plyEndtie(t) {
    let key;
    const b = this.mem.u8(t.cmdPtr);
    if (b < 0x80) { t.key = b; t.cmdPtr = (t.cmdPtr + 1) >>> 0; key = b; } else key = t.key;
    for (let c = t.chan; c; c = c.next) {
      if ((c.statusFlags & (SF_START | SF_ENV)) && !(c.statusFlags & SF_STOP) && c.midiKey === key) {
        c.statusFlags |= SF_STOP;
        return;
      }
    }
  }
  plyNote(idx, mp, t) {
    const mem = this.mem;
    t.gateTime = CLOCK_TABLE[idx];
    let p = t.cmdPtr;
    let b = mem.u8(p);
    if (b < 0x80) {
      t.key = b; p++;
      b = mem.u8(p);
      if (b < 0x80) {
        t.velocity = b; p++;
        b = mem.u8(p);
        if (b < 0x80) { t.gateTime = (t.gateTime + b) & 0xFF; p++; }
      }
      t.cmdPtr = p >>> 0;
    }
    let rhythmPan = 0;
    let tone = t.tone, key = t.key;
    const ttype = t.tone.type;
    if (ttype & (T_RHY | T_SPL)) {
      const k = t.key;
      const idx2 = (ttype & T_SPL) ? mem.u8((t.tone.adsr + k) >>> 0) : k;
      tone = this._subTone || (this._subTone = new Tone());
      tone.load(mem, (t.tone.wav + 12 * idx2) >>> 0);
      if (tone.type & (T_SPL | T_RHY)) return;
      if (ttype & T_RHY) {
        if (tone.panSweep & 0x80) rhythmPan = s8((tone.panSweep - 0xC0) * 2);
        key = tone.key;
      }
    }
    let prio = mp.priority + t.priority;
    if (prio > 0xFF) prio = 0xFF;
    const cgbType = tone.type & T_CGB;
    const ord = (c) => (c.track ? c.track.ordinal : 0);
    let chan = null;
    if (cgbType) {
      chan = this.cgb[cgbType - 1];
      if ((chan.statusFlags & SF_ON) && !(chan.statusFlags & SF_STOP)) {
        if (chan.priority < prio) { /* take */ }
        else if (chan.priority === prio && ord(chan) >= t.ordinal) { /* take */ }
        else return;
      }
    } else {
      let r6 = prio, r7 = t.ordinal, found = false;
      for (let i = 0; i < this.maxChans; i++) {
        const c = this.ds[i];
        if (!(c.statusFlags & SF_ON)) { chan = c; break; }
        if (c.statusFlags & SF_STOP) {
          if (!found) { found = true; r6 = c.priority; r7 = ord(c); chan = c; continue; }
        } else if (found) continue;
        if (c.priority < r6) { r6 = c.priority; r7 = ord(c); chan = c; }
        else if (c.priority === r6) {
          const o = ord(c);
          if (o > r7) { r7 = o; chan = c; } else if (o === r7) chan = c;
        }
      }
      if (!chan) return;
    }
    this.clearChain(chan);
    chan.prev = null;
    chan.next = t.chan;
    if (t.chan) t.chan.prev = chan;
    t.chan = chan;
    chan.track = t;
    chan.owner = mp;
    t.lfoDelayC = t.lfoDelay;
    if (t.lfoDelay !== 0) this.clearModM(t);
    this.trkVolPitSet(mp, t);
    chan.gateTime = t.gateTime;
    chan.midiKey = t.key;
    chan.velocity = t.velocity;
    chan.priority = prio;
    chan.key = key;
    chan.rhythmPan = rhythmPan;
    chan.type = tone.type;
    chan.wav = tone.wav;
    chan.wavePointer = tone.wav;
    chan.adsr = tone.adsr;
    chan.pseudoEchoVolume = t.pseudoEchoVolume;
    chan.pseudoEchoLength = t.pseudoEchoLength;
    this.chnVolSet(chan, t);
    let k = chan.key + t.keyM;
    if (k < 0) k = 0;
    if (cgbType) {
      chan.length = tone.length;
      const sw = tone.panSweep;
      chan.sweep = (!(sw & 0x80) && (sw & 0x70)) ? sw : 8;
      chan.frequency = this.midiKeyToCgbFreq(cgbType, k, t.pitM);
    } else {
      chan.count = t.unk3C;
      chan.frequency = this.midiKeyToFreq(chan.wav, k, t.pitM);
    }
    chan.statusFlags = SF_START;
    t.flags &= 0xF0;
  }

  // ---------------------------------------------------------------- CGB
  cgbOscOff(ch) {
    const P = this.psg;
    switch (ch) {
      case 1: P.write(NR12, 8); P.write(NR14, 0x80); break;
      case 2: P.write(NR22, 8); P.write(NR24, 0x80); break;
      case 3: P.write(NR30, 0); break;
      default: P.write(NR42, 8); P.write(NR44, 0x80); break;
    }
  }
  cgbModVol(c) {
    let hard = false;
    if (!(this.stereo === false)) {
      const R = c.rightVolume, L = c.leftVolume;
      if (R >= L) { if ((R >> 1) >= L) { c.pan = 0x0F; hard = true; } }
      else if ((L >> 1) >= R) { c.pan = 0xF0; hard = true; }
    }
    if (!hard) {
      c.pan = 0xFF;
      c.envelopeGoal = u8((c.leftVolume + c.rightVolume) >>> 4);
    } else {
      c.envelopeGoal = (c.leftVolume + c.rightVolume) >>> 4;
      if (c.envelopeGoal > 15) c.envelopeGoal = 15;
    }
    c.sustainGoal = u8((c.envelopeGoal * c.sustain + 15) >> 4);
    c.pan &= c.panMask;
  }
  cgbSound() {
    const P = this.psg, mem = this.mem;
    if (this.c15) this.c15--; else this.c15 = 14;
    for (let ch = 1; ch <= 4; ch++) {
      const c = this.cgb[ch - 1];
      if (!(c.statusFlags & SF_ON)) continue;
      let nrx0, nrx1, nrx2, nrx3, nrx4;
      switch (ch) {
        case 1: nrx0 = NR10; nrx1 = NR11; nrx2 = NR12; nrx3 = NR13; nrx4 = NR14; break;
        case 2: nrx0 = NR10 + 1; nrx1 = NR21; nrx2 = NR22; nrx3 = NR23; nrx4 = NR24; break;
        case 3: nrx0 = NR30; nrx1 = NR31; nrx2 = NR32; nrx3 = NR33; nrx4 = NR34; break;
        default: nrx0 = NR30 + 1; nrx1 = NR41; nrx2 = NR42; nrx3 = NR43; nrx4 = NR44; break;
      }
      let prevC15 = this.c15;
      let envStep = P.read(nrx2);
      let st;
      const STEP_REPEAT = 1, STEP_COMPLETE = 2, ENV_COMPLETE = 3, OSC_OFF = 4, PSEUDOECHO = 5,
        SUSTAIN = 6, SUSTAIN_START = 7, DECAY_START = 8, DONE = 9;
      if (c.statusFlags & SF_START) {
        if (!(c.statusFlags & SF_STOP)) {
          c.statusFlags = ENV_ATTACK;
          c.modify = MO_PIT | MO_VOL;
          this.cgbModVol(c);
          switch (ch) {
            case 1: P.write(nrx0, c.sweep);
            // fallthrough
            case 2:
              P.write(nrx1, ((c.wavePointer << 6) + c.length) & 0xFF);
              envStep = c.attack + 8;
              c.n4 = c.length ? 0x40 : 0x00;
              break;
            case 3:
              if (c.wavePointer !== c.currentPointer) {
                P.write(nrx0, 0x40);
                const w = new Uint8Array(16);
                for (let i = 0; i < 16; i++) w[i] = mem.u8(c.wavePointer + i);
                P.writeWaveRam(w);
                c.currentPointer = c.wavePointer;
              }
              P.write(nrx0, 0);
              P.write(nrx1, c.length);
              c.n4 = c.length ? 0xC0 : 0x80;
              break;
            default:
              P.write(nrx1, c.length);
              P.write(nrx3, (c.wavePointer << 3) & 0xFF);
              envStep = c.attack + 8;
              c.n4 = c.length ? 0x40 : 0x00;
              break;
          }
          c.envelopeCounter = c.attack;
          if (s8(c.attack) !== 0) { c.envelopeVolume = 0; st = STEP_COMPLETE; }
          else st = DECAY_START;
        } else st = OSC_OFF;
      } else if (c.statusFlags & SF_IEC) {
        c.pseudoEchoLength = u8(c.pseudoEchoLength - 1);
        st = s8(c.pseudoEchoLength) <= 0 ? OSC_OFF : ENV_COMPLETE;
      } else if ((c.statusFlags & SF_STOP) && (c.statusFlags & SF_ENV)) {
        c.statusFlags &= ~SF_ENV;
        c.envelopeCounter = c.release;
        if (s8(c.release) !== 0) {
          c.modify |= MO_VOL;
          if (ch !== 3) envStep = c.release | 0;
          st = STEP_COMPLETE;
        } else st = PSEUDOECHO;
      } else st = STEP_REPEAT;

      for (let guard = 0; st !== DONE && guard < 64; guard++) {
        switch (st) {
          case STEP_REPEAT:
            if (c.envelopeCounter === 0) {
              if (ch === 3) c.modify |= MO_VOL;
              this.cgbModVol(c);
              const env = c.statusFlags & SF_ENV;
              if (env === ENV_RELEASE) {
                c.envelopeVolume = u8(c.envelopeVolume - 1);
                if (s8(c.envelopeVolume) <= 0) { st = PSEUDOECHO; break; }
                c.envelopeCounter = c.release;
                st = STEP_COMPLETE;
              } else if (env === ENV_SUSTAIN) {
                st = SUSTAIN;
              } else if (env === ENV_DECAY) {
                c.envelopeVolume = u8(c.envelopeVolume - 1);
                if (s8(c.envelopeVolume) <= s8(c.sustainGoal)) { st = SUSTAIN_START; break; }
                c.envelopeCounter = c.decay;
                st = STEP_COMPLETE;
              } else {
                c.envelopeVolume = u8(c.envelopeVolume + 1);
                if (c.envelopeVolume >= c.envelopeGoal) { st = DECAY_START; break; }
                c.envelopeCounter = c.attack;
                st = STEP_COMPLETE;
              }
            } else st = STEP_COMPLETE;
            break;
          case SUSTAIN:
            c.envelopeVolume = c.sustainGoal;
            c.envelopeCounter = 7;
            st = STEP_COMPLETE;
            break;
          case SUSTAIN_START:
            if (c.sustain === 0) { c.statusFlags &= ~SF_ENV; st = PSEUDOECHO; }
            else {
              c.statusFlags = u8(c.statusFlags - 1);
              c.modify |= MO_VOL;
              if (ch !== 3) envStep = 0 | 8;
              st = SUSTAIN;
            }
            break;
          case DECAY_START:
            c.statusFlags = u8(c.statusFlags - 1);
            c.envelopeCounter = c.decay;
            if (u8(c.envelopeCounter) !== 0) {
              c.modify |= MO_VOL;
              c.envelopeVolume = c.envelopeGoal;
              if (ch !== 3) envStep = c.decay | 0;
              st = STEP_COMPLETE;
            } else st = SUSTAIN_START;
            break;
          case PSEUDOECHO:
            c.envelopeVolume = u8((c.envelopeGoal * c.pseudoEchoVolume + 0xFF) >> 8);
            if (c.envelopeVolume) {
              c.statusFlags |= SF_IEC;
              c.modify |= MO_VOL;
              if (ch !== 3) envStep = 0 | 8;
              st = ENV_COMPLETE;
            } else st = OSC_OFF;
            break;
          case STEP_COMPLETE:
            c.envelopeCounter = u8(c.envelopeCounter - 1);
            if (prevC15 === 0) { prevC15--; st = STEP_REPEAT; }
            else st = ENV_COMPLETE;
            break;
          case OSC_OFF:
            this.cgbOscOff(ch);
            c.statusFlags = 0;
            c.modify = 0;
            st = DONE;
            break;
          case ENV_COMPLETE:
            if (c.modify & MO_PIT) {
              if (ch < 4 && (c.type & T_FIX)) c.frequency = (c.frequency + 1) & 0x7FE; // SOUNDBIAS 65536 Hz PWM
              if (ch !== 4) P.write(nrx3, c.frequency & 0xFF);
              else P.write(nrx3, (P.read(nrx3) & 0x08) | (c.frequency & 0xFF));
              c.n4 = u8((c.n4 & 0xC0) + ((c.frequency >> 8) & 0xFF));
              P.write(nrx4, c.n4);
            }
            if (c.modify & MO_VOL) {
              P.write(NR51, (P.read(NR51) & ~c.panMask) | c.pan);
              if (ch === 3) {
                P.write(nrx2, CGB3_VOL[c.envelopeVolume] ?? 0);
                if (c.n4 & 0x80) { P.write(nrx0, 0x80); P.write(nrx4, c.n4); c.n4 &= 0x7F; }
              } else {
                P.write(nrx2, ((envStep & 0xF) + (c.envelopeVolume << 4)) & 0xFF);
                P.write(nrx4, c.n4 | 0x80);
                if (ch === 1 && !(P.read(nrx0) & 0x08)) P.write(nrx4, c.n4 | 0x80);
              }
            }
            c.modify = 0;
            st = DONE;
            break;
          default: st = DONE;
        }
      }
    }
  }

  // ---------------------------------------------------------------- SoundMainRAM
  decoded(wav) {
    let d = this.decodeCache.get(wav);
    if (d) return d;
    const mem = this.mem;
    const size = mem.u32(wav + 12);
    const blocks = Math.ceil(size / 64);
    d = new Int8Array(blocks * 64);
    const src = mem.s8view(wav + 16, blocks * 33);
    if (src) {
      const ub = new Uint8Array(src.buffer, src.byteOffset, src.length);
      for (let b = 0; b < blocks; b++) {
        const o = b * 33;
        if (o + 33 > ub.length) break;
        let lr = ub[o];
        d[b * 64] = lr;
        let k = 1;
        lr += DELTA_TABLE[ub[o + 1] & 0xF]; d[b * 64 + k++] = lr;
        for (let j = 2; j < 33; j++) {
          const by = ub[o + j];
          lr += DELTA_TABLE[by >> 4]; d[b * 64 + k++] = lr;
          lr += DELTA_TABLE[by & 0xF]; d[b * 64 + k++] = lr;
        }
      }
    }
    this.decodeCache.set(wav, d);
    return d;
  }
  rawSamples(wav) {
    let d = this.decodeCache.get(wav);
    if (d) return d;
    const size = this.mem.u32(wav + 12);
    d = this.mem.s8view(wav + 16, size + 1) || new Int8Array(0);
    this.decodeCache.set(wav, d);
    return d;
  }

  mixFrame() {
    const N = this.mixN;
    this.block = (this.block + 1) % PCM_DMA_PERIOD;
    const cur = this.block * N;
    const nxt = ((this.block + 1) % PCM_DMA_PERIOD) * N;
    const A = this.pcmA, B = this.pcmB;
    const rv = this.reverb;
    if (rv && this.hq) {
      for (let i = 0; i < N; i++) {
        const v = (A[cur + i] + B[cur + i] + A[nxt + i] + B[nxt + i]) * rv / 512;
        A[cur + i] = v; B[cur + i] = v;
      }
    } else if (rv) {
      for (let i = 0; i < N; i++) {
        const sum = A[cur + i] + B[cur + i] + A[nxt + i] + B[nxt + i];
        let v = (sum * rv) >> 9;
        if (v & 0x80) v++;
        A[cur + i] = v; B[cur + i] = v;
      }
    } else {
      A.fill(0, cur, cur + N); B.fill(0, cur, cur + N);
    }
    const mem = this.mem;
    for (let ci = 0; ci < this.ds.length; ci++) {
      const c = this.ds[ci];
      let flags = c.statusFlags;
      if (!(flags & SF_ON)) continue;
      const wav = c.wav;
      let env;
      if (flags & SF_START) {
        if (flags & SF_STOP) { c.statusFlags = 0; continue; }
        flags = ENV_ATTACK;
        const size = mem.u32(wav + 12);
        c.pos = c.count;
        c.count = (size - c.count) | 0;
        c.fw = 0;
        if (mem.u8(wav + 3) & 0xC0) flags |= SF_LOOP;
        env = c.attack;
        if (env >= 0xFF) { env = 0xFF; flags--; }
      } else {
        env = c.envelopeVolume;
        if (flags & SF_IEC) {
          const el = c.pseudoEchoLength;
          c.pseudoEchoLength = u8(el - 1);
          if (!(el > 1)) { c.statusFlags = 0; continue; }
        } else if (flags & SF_STOP) {
          env = (env * c.release) >>> 8;
          if (!(env > c.pseudoEchoVolume)) {
            env = c.pseudoEchoVolume;
            if (env === 0) { c.statusFlags = 0; continue; }
            flags |= SF_IEC;
          }
        } else if ((flags & SF_ENV) === ENV_DECAY) {
          env = (env * c.decay) >>> 8;
          if (!(env > c.sustain)) {
            env = c.sustain;
            if (env === 0) {
              env = c.pseudoEchoVolume;
              if (env === 0) { c.statusFlags = 0; continue; }
              flags |= SF_IEC;
            } else flags--;
          }
        } else if ((flags & SF_ENV) === ENV_ATTACK) {
          env += c.attack;
          if (env >= 0xFF) { env = 0xFF; flags--; }
        }
      }
      c.statusFlags = flags;
      c.envelopeVolume = env & 0xFF;
      const r5 = ((this.masterVolume + 1) * (env & 0xFF)) >> 4;
      let envR = (c.rightVolume * r5) >> 8;
      let envL = (c.leftVolume * r5) >> 8;
      c.envR = envR; c.envL = envL;
      const uv = c.owner ? c.owner.userVolume : 1;
      if (uv !== 1) { if (this.hq) { envR *= uv; envL *= uv; } else { envR = Math.floor(envR * uv); envL = Math.floor(envL * uv); } }
      this.mixChannel(c, flags, wav, cur, N, envR, envL);
    }
  }

  mixChannel(c, flags, wav, cur, N, envR, envL) {
    const mem = this.mem, A = this.pcmA, B = this.pcmB;
    const type = c.type;
    const size = mem.u32(wav + 12);
    const loopStart = mem.u32(wav + 8);
    const loopLen = (flags & SF_LOOP) ? (size - loopStart) : 0;
    const compressed = mem.u16(wav) !== 0;
    const sh = this.mixShift, os = this.osShift; // gba: >> 8 and step >>> 0 (the real mixer)
    let count = c.count, fw = c.fw, r3, r0, r1;

    if (type & (T_CMP | T_REV)) {
      // SoundMainRAM_Unk1
      if (!(c.statusFlags & SF_SPECIAL)) {
        c.statusFlags |= SF_SPECIAL;
        if (type & T_REV) c.pos = size - c.pos;
      }
      const step = ((type & T_FIX) ? 0x800000 : (Math.imul(DIV_FREQ, c.frequency) >>> 0)) >>> os;
      if (compressed) {
        const S = this.decoded(wav);
        if (!(type & T_REV)) {
          r3 = c.pos; r0 = S[r3] | 0; r3++; r1 = (S[r3] | 0) - r0;
          for (let i = 0; i < N; i++) {
            const s = r0 + (Math.imul(fw, r1) >> 23);
            A[cur + i] += (s * envR) >> sh; B[cur + i] += (s * envL) >> sh;
            fw += step;
            const adv = Math.floor(fw / 8388608);
            if (adv) {
              fw %= 8388608;
              count -= adv;
              if (count <= 0) {
                if (!loopLen) { c.statusFlags = 0; return; }
                r3 = loopStart;
                let lr = -count;
                for (;;) { count += loopLen; if (count > 0) break; lr -= loopLen; }
                r3 += lr; r0 = S[r3] | 0;
              } else if (adv - 1 !== 0) { r3 += adv - 1; r0 = S[r3] | 0; }
              else r0 += r1;
              r3++; r1 = (S[r3] | 0) - r0;
            }
          }
          c.pos = r3 - 1;
        } else {
          r3 = c.pos - 1; r0 = S[r3] | 0; r3--; r1 = (S[r3] | 0) - r0;
          for (let i = 0; i < N; i++) {
            const s = r0 + (Math.imul(fw, r1) >> 23);
            A[cur + i] += (s * envR) >> sh; B[cur + i] += (s * envL) >> sh;
            fw += step;
            const adv = Math.floor(fw / 8388608);
            if (adv) {
              fw %= 8388608;
              count -= adv;
              if (count <= 0) { c.statusFlags = 0; return; }
              if (adv - 1 !== 0) { r3 -= adv - 1; r0 = S[r3] | 0; } else r0 += r1;
              r3--; r1 = (S[r3] | 0) - r0;
            }
          }
          c.pos = r3 + 2;
        }
      } else if (type & T_REV) {
        const D = this.rawSamples(wav);
        r3 = c.pos - 1; r0 = D[r3] | 0; r1 = (D[r3 - 1] | 0) - r0;
        for (let i = 0; i < N; i++) {
          const s = r0 + (Math.imul(fw, r1) >> 23);
          A[cur + i] += (s * envR) >> sh; B[cur + i] += (s * envL) >> sh;
          fw += step;
          const adv = Math.floor(fw / 8388608);
          if (adv) {
            fw %= 8388608;
            count -= adv;
            if (count <= 0) { c.statusFlags = 0; return; }
            r3 -= adv; r0 = D[r3] | 0; r1 = (D[r3 - 1] | 0) - r0;
          }
        }
        c.pos = r3 + 1;
      }
      // (forward + uncompressed under the CMP flag: the real driver mixes nothing)
      c.fw = fw; c.count = count;
      return;
    }

    const D = this.rawSamples(wav);
    if ((type & T_FIX) && !os) {
      r3 = c.pos;
      for (let i = 0; i < N; i++) {
        const s = D[r3] | 0;
        A[cur + i] += (s * envR) >> sh; B[cur + i] += (s * envL) >> sh;
        r3++;
        if (--count === 0) {
          if (!loopLen) { c.statusFlags = 0; return; }
          r3 = loopStart; count = loopLen;
        }
      }
      c.pos = r3; c.count = count;
      return;
    }

    // Normal resampled DirectSound (linear interpolation, 23-bit fraction)
    // (hq: fixed-frequency samples go through here too, at 1 sample per 13379 Hz tick)
    const step = ((type & T_FIX) ? 0x800000 : (Math.imul(DIV_FREQ, c.frequency) >>> 0)) >>> os;
    r3 = c.pos; r0 = D[r3] | 0; r3++; r1 = (D[r3] | 0) - r0;
    for (let i = 0; i < N; i++) {
      const s = r0 + (Math.imul(fw, r1) >> 23);
      A[cur + i] += (s * envR) >> sh; B[cur + i] += (s * envL) >> sh;
      fw += step;
      const adv = Math.floor(fw / 8388608);
      if (adv) {
        fw %= 8388608;
        count -= adv;
        if (count <= 0) {
          if (!loopLen) { c.statusFlags = 0; return; }
          r3 = loopStart;
          let lr = -count;
          for (;;) { count += loopLen; if (count > 0) break; lr -= loopLen; }
          r3 += lr; r0 = D[r3] | 0;
        } else if (adv - 1 !== 0) { r3 += adv - 1; r0 = D[r3] | 0; }
        else r0 += r1;
        r3++; r1 = (D[r3] | 0) - r0;
      }
    }
    c.pos = r3 - 1; c.count = count; c.fw = fw;
  }

  setPokemonCryTone(tone) {
    let maxClock = 0, maxIdx = 0, sel = -1;
    for (let i = 0; i < 2; i++) {
      const mp = this.players[PLAYER_CRY0 + i];
      const t = mp.tracks[0];
      if (!t.flags && (!t.chan || t.chan.track !== t)) { sel = i; break; }
      if (maxClock < mp.clock) { maxClock = mp.clock; maxIdx = i; }
    }
    if (sel < 0) sel = maxIdx;
    const mp = this.players[PLAYER_CRY0 + sel];
    const base = CRY_RAM_BASE + 0x40 * sel;
    const r = this.cryRam[sel];
    const cs = this.crySong;
    const w32 = (o, v) => { r[o] = v & 0xFF; r[o + 1] = (v >>> 8) & 0xFF; r[o + 2] = (v >>> 16) & 0xFF; r[o + 3] = (v >>> 24) & 0xFF; };
    r.fill(0);
    r[0] = cs.trackCount; r[1] = 0; r[2] = cs.priority; r[3] = 0;
    w32(4, tone); w32(8, base + 0x11); w32(12, base + 0x18);
    r[0x11] = 0xC8; r[0x12] = cs.tuneValue; r[0x13] = 0xB2; w32(0x14, base + 0x1A); // TUNE v, GOTO cont
    r[0x18] = 0xC8; r[0x19] = cs.tuneValue2;                                         // TUNE v2
    r[0x1A] = 0xBD; r[0x1B] = 0;                                                     // VOICE 0
    r[0x1C] = 0xBE; r[0x1D] = cs.volume;                                             // VOL
    r[0x1E] = 0xCD; r[0x1F] = 0x0D; w32(0x20, cs.unk0D);                             // XCMD 0D
    r[0x24] = 0xCD; r[0x25] = 0x07; r[0x26] = cs.release;                            // XCMD xRELE
    r[0x27] = 0xBF; r[0x28] = cs.pan;                                                // PAN
    r[0x29] = 0xCF; r[0x2A] = cs.tieKey; r[0x2B] = cs.tieVelocity;                   // TIE
    r[0x2C] = 0xCD; r[0x2D] = 0x0C; r[0x2E] = cs.length & 0xFF; r[0x2F] = cs.length >> 8; // XCMD xWAIT
    r[0x30] = 0xCE; r[0x31] = 0xB1;                                                  // EOT FINE
    this.mplayStart(mp, base);
    return mp;
  }
  isCryPlaying(mp) { const t = mp.tracks[0]; return !!(t.chan && t.chan.track === t); }

  // ---------------------------------------------------------------- frame / output
  /** One V-blank: SoundMain. */
  runFrame() {
    const wasPlaying = this.players.map((mp) => this.isActive(mp));
    for (const mp of this.players) this.mplayMain(mp);
    this.cgbSound();
    this.playBlock = this.block;
    this.mixFrame();
    for (let i = 0; i < 4; i++) {
      const c = this.cgb[i];
      this.psg.ch[i].scale = c.owner ? c.owner.userVolume : 1;
    }
    this.frameCount++;
    // host bookkeeping: end-of-song events, cry BGM ducking (Task_DuckBGMForPokemonCry)
    if (this.duck.active) {
      if (this.duck.frames > 0) this.duck.frames--;
      else if (!this.isCryPlaying(this.duck.player)) {
        this.volumeControl(this.players[PLAYER_BGM], 0xFFFF, 256);
        this.duck.active = false;
      }
    }
    this.players.forEach((mp, i) => {
      if (wasPlaying[i] && !this.isActive(mp)) this.events.push({ type: 'end', player: i, tag: mp.tag });
    });
  }
  isActive(mp) {
    if (mp.id >= PLAYER_CRY0) return !(mp.status & STATUS_PAUSE) && (mp.status & 0xFFFF) !== 0 || this.isCryPlaying(mp);
    return !(mp.status & STATUS_PAUSE) && (mp.status & 0xFFFF) !== 0;
  }

  /** Render n stereo samples at this.sampleRate into Float32Arrays (offset optional). */
  process(outL, outR, n, offset = 0) {
    if (this.hq) return this.processHQ(outL, outR, n, offset);
    const N = PCM_SAMPLES_PER_FRAME;
    const A = this.pcmA, B = this.pcmB, P = this.psg;
    const linear = this.interpolation === 'linear';
    const g = this.masterGain / 512;
    const k = this.dcR_coef;
    const dcL = this.dcL, dcR = this.dcR;
    for (let i = 0; i < n; i++) {
      if (this.pcmPos >= N) { this.pcmPos -= N; this.runFrame(); }
      const pb = this.playBlock * N;
      const fi = this.pcmPos | 0;
      let a, b;
      if (linear) {
        const fr = this.pcmPos - fi;
        const j = fi + 1 < N ? pb + fi + 1 : this.block * N;
        a = A[pb + fi] + (A[j] - A[pb + fi]) * fr;
        b = B[pb + fi] + (B[j] - B[pb + fi]) * fr;
      } else { a = A[pb + fi]; b = B[pb + fi]; }
      P.sample();
      let l, r;
      if (this.stereo) { r = a * 4 + P.outR; l = b * 4 + P.outL; }
      else { const m = (a + b) * 2; l = m + P.outL; r = m + P.outR; }
      if (l > 511) { l = 511; this.peakClip++; } else if (l < -512) { l = -512; this.peakClip++; }
      if (r > 511) { r = 511; this.peakClip++; } else if (r < -512) { r = -512; this.peakClip++; }
      // AC coupling (DC blocker)
      const yl = l - dcL.x + k * dcL.y; dcL.x = l; dcL.y = yl;
      const yr = r - dcR.x + k * dcR.y; dcR.x = r; dcR.y = yr;
      outL[offset + i] = yl * g;
      outR[offset + i] = yr * g;
      this.pcmPos += this.pcmStep;
    }
  }
  // HQ output: linear upsampling of the float ring, PSG, DC blocker, 9 kHz low-pass, soft limiter.
  processHQ(outL, outR, n, offset) {
    const N = this.mixN, P = this.psg, A = this.pcmA, B = this.pcmB;
    const g = this.masterGain / 512, k = this.dcR_coef, dcL = this.dcL, dcR = this.dcR;
    const { b0, b1, b2, a1, a2 } = this.lp, fl = this.lpL, fr = this.lpR;
    const ringScale = 1 / 64; // ring holds sample*env (no >> 8); *4 DMA level -> /64
    for (let i = 0; i < n; i++) {
      if (this.pcmPos >= N) { this.pcmPos -= N; this.runFrame(); }
      const pb = this.playBlock * N, fi = this.pcmPos | 0, f = this.pcmPos - fi;
      const j = fi + 1 < N ? pb + fi + 1 : this.block * N;
      const a = A[pb + fi] + (A[j] - A[pb + fi]) * f, b = B[pb + fi] + (B[j] - B[pb + fi]) * f;
      if (a > 32767 || a < -32768 || b > 32767 || b < -32768) this.ringOver++;
      P.sample();
      let l, r;
      if (this.stereo) { r = a * ringScale + P.outR; l = b * ringScale + P.outL; }
      else { const m = (a + b) * ringScale / 2; l = m + P.outL; r = m + P.outR; }
      if (l > 511 || l < -512) this.peakClip++;
      if (r > 511 || r < -512) this.peakClip++;
      const yl = l - dcL.x + k * dcL.y; dcL.x = l; dcL.y = yl;
      const yr = r - dcR.x + k * dcR.y; dcR.x = r; dcR.y = yr;
      const zl = b0 * yl + b1 * fl[0] + b2 * fl[1] - a1 * fl[2] - a2 * fl[3]; fl[1] = fl[0]; fl[0] = yl; fl[3] = fl[2]; fl[2] = zl;
      const zr = b0 * yr + b1 * fr[0] + b2 * fr[1] - a1 * fr[2] - a2 * fr[3]; fr[1] = fr[0]; fr[0] = yr; fr[3] = fr[2]; fr[2] = zr;
      outL[offset + i] = softClip(zl * g);
      outR[offset + i] = softClip(zr * g);
      this.pcmPos += this.pcmStep;
    }
  }
  takeEvents() { const e = this.events; this.events = []; return e; }
}

const s16 = (v) => (v << 16) >> 16;
// Linear up to 0.8, then a smooth knee that approaches (never reaches) 1.0.
function softClip(x) {
  const a = Math.abs(x);
  if (a <= 0.8) return x;
  const y = 0.8 + 0.2 * Math.tanh((a - 0.8) / 0.2);
  return x < 0 ? -y : y;
}

/** Convenience: build an engine from a bank (ArrayBuffer/Uint8Array) and its bank.json. */
export function createEngine(bankBytes, bankJson, opts = {}) {
  const mem = new SparseMemory(bankBytes, bankJson.segments);
  return new M4AEngine(mem, { cryTable: bankJson.cryTable, cryTableReverse: bankJson.cryTableReverse, ...opts });
}

/**
 * Message router shared by the AudioWorklet (m4a-worklet.js) and the main-thread
 * ScriptProcessor fallback in sound.js. `post(msg)` delivers events back to the UI side.
 */
export class EngineHost {
  constructor(post, sampleRate) {
    this.post = post; this.sampleRate = sampleRate;
    this.engine = null; this.fanfare = null;
    this.scratch = new Float32Array(4096);
  }
  onMessage(m) {
    try { this._onMessage(m); } catch (err) { this.post({ type: 'error', message: String((err && err.stack) || err) }); }
  }
  _onMessage(m) {
    if (m.type === 'init') {
      this.engine = createEngine(new Uint8Array(m.bank), m.meta, {
        sampleRate: this.sampleRate, stereo: m.stereo !== false, interpolation: m.interpolation || 'hold', quality: m.quality || 'gba',
      });
      this.post({ type: 'ready', sampleRate: this.sampleRate });
      return;
    }
    const e = this.engine;
    if (!e) return;
    switch (m.type) {
      case 'addBank':        // { bank: ArrayBuffer, segments, tag }: a second (relocated) song bank
        try { e.mem.addSegments(new Uint8Array(m.bank), m.segments); this.post({ type: 'bankAdded', tag: m.tag, ok: true }); }
        catch (err) { this.post({ type: 'bankAdded', tag: m.tag, ok: false, message: String(err && err.message || err) }); }
        break;
      case 'start':          // { player, header, tag, mode: 'start'|'change', fadeInSpeed }
        if (m.player === PLAYER_BGM) this.fanfare = null;
        if (m.fadeInSpeed) e.startSongFadeIn(m.player, m.header, m.fadeInSpeed, m.tag);
        else if (m.mode === 'change') e.startOrChange(m.player, m.header, m.tag);
        else e.startSong(m.player, m.header, m.tag);
        break;
      case 'fanfare':        // PlayFanfare: pause BGM, play, m4aMPlayContinue(BGM) when it ends
        e.stopPlayer(PLAYER_BGM);
        e.startSong(m.player, m.header, m.tag);
        this.fanfare = { player: m.player };
        break;
      case 'stop': e.stopPlayer(m.player); if (m.player === PLAYER_BGM) this.fanfare = null; break;
      case 'continue': e.continuePlayer(m.player); break;
      case 'fadeOut': e.fadeOutPlayer(m.player, m.speed); break;
      case 'stopAll': e.stopAll(); this.fanfare = null; break;
      case 'playerVolume': for (const p of m.players) e.setPlayerVolume(p, m.volume); break;
      case 'trackVolume': e.setPlayerTrackVolume(m.player, m.volume); break;
      case 'cry': e.playCry(m.cryIndex, m.opts || {}, m.tag); break;
      case 'masterGain': e.masterGain = m.value; break;
      case 'option':
        if ('stereo' in m) e.stereo = !!m.stereo;
        if ('interpolation' in m) e.interpolation = m.interpolation;
        if ('quality' in m) e.setQuality(m.quality);
        break;
      default: break;
    }
  }
  process(L, R, n) {
    const e = this.engine;
    if (!R) { if (this.scratch.length < n) this.scratch = new Float32Array(n); R = this.scratch; }
    if (!e) { L.fill(0, 0, n); R.fill(0, 0, n); return; }
    e.process(L, R, n);
    if (e.events.length) {
      for (const ev of e.takeEvents()) {
        if (this.fanfare && ev.player === this.fanfare.player) { this.fanfare = null; e.continuePlayer(PLAYER_BGM); }
        this.post(ev);
      }
    }
  }
}
