// Sinnoh chiptune: our OWN Game Boy engine bank for web/src/audio/gb-core.js GscEngine (the bank GscEngine.rb() reads:
// the frequency table, the wave samples and the drum kits). Everything here is authored in code (computed or
// hand-made), nothing is copied from a Game Boy ROM, so the Sinnoh retro bank needs no Red/Silver data at all.
//
//   import { buildEngineBank, ENGINE_BANK } from './engine_bank.mjs';
//   const { bytes, tables } = buildEngineBank();   // bytes: 16 KB bank image at $4000; tables: { engineBank, frequencyTable, waveSamples, drumkits }
//
// Layout (all little-endian words, as GscEngine reads them):
//   frequencyTable  32 words. GscEngine.getFrequency(c, octave, pitch) reads entry (transpose & 15) + pitch (pitch 1..12
//                   = C..B) and shifts it right arithmetically (7 - octave) times; the register is the low 11 bits.
//                   Entry i (i >= 1) is the note MIDI 35 + i at `octave 1` (no shift): -round(131072 / f) as a 16-bit
//                   value, so after k shifts the GB pulse frequency 131072 / (2048 - reg) is f * 2^k (C2 = 65.4 Hz at
//                   octave 1; the wave channel plays an octave lower, which m4a2gsc.mjs already allows for). Entry 0
//                   is 0 (a rest). Entries past 12 cover transposes up to 15 semitones.
//   waveSamples     16 entries of 16 bytes (32 4-bit samples, high nibble first): the wave channel loads entry
//                   (envelope & 15) on each note. m4a2gsc.mjs convert() uses entry 4 for ordinary bass parts and 2 for
//                   Emerald-style Game Boy wave voices, so those two are the bass sounds.
//   drumkits        6 words: kit pointers (toggle_noise <kit>). Each kit is 13 words (drum note 0..12) pointing at a
//                   noise sequence: steps of [ $20 | (frames - 1), NR42 envelope, NR43 polynomial ], ended by $ff
//                   (pokecrystal's noise_note / sound_ret). GscEngine.handleNoise plays one step per `frames` frames.
//                   Every kit has every note m4a2gsc.mjs KIT3 maps a drum role to (kick 11, kickSoft/tom/timpani 4,
//                   snare 1, snareSoft 3, snareQuiet 2, hatClosed 9, hatPedal 8, hatOpen 7, crash 12, tick 5) plus
//                   low tom 6 and clap 10.
export const ENGINE_BANK = 0x80;
const ORG = 0x4000;

// ---- frequency table
export function frequencyWords(n = 32) {
  const out = [0];
  for (let i = 1; i < n; i++) {
    const f = 440 * 2 ** ((35 + i - 69) / 12);
    out.push((0x10000 - Math.round(131072 / f)) & 0xffff);
  }
  return out;
}

// ---- wave samples: 32 samples in [-1, 1] -> 4-bit, packed
const TAU = Math.PI * 2;
const quant = (fn) => {
  const s = Array.from({ length: 32 }, (_, i) => fn((i + 0.5) / 32));
  const lo = Math.min(...s), hi = Math.max(...s);
  return s.map((x) => Math.max(0, Math.min(15, Math.round(((x - lo) / (hi - lo || 1)) * 15))));
};
const scaled = (q, amp) => q.map((v) => Math.round(7.5 + (v - 7.5) * amp));
const sine = (p) => Math.sin(TAU * p);
const tri = (p) => (p < 0.25 ? 4 * p : p < 0.75 ? 2 - 4 * p : 4 * p - 4);
const saw = (p) => 1 - 2 * p;
const pulse = (w) => (p) => (p < w ? 1 : -1);
// additive (band-limited) shapes sound rounder than the naive ones on the hq render
const harm = (amps) => (p) => amps.reduce((s, a, k) => s + a * Math.sin(TAU * (k + 1) * p), 0);
export const WAVE_NAMES = [
  'pulse12', 'pulse25', 'softBass', 'square', 'bass', 'saw', 'sine', 'triangle',
  'organ', 'brightBass', 'triangleQuiet', 'sineQuiet', 'reed', 'hollow', 'sawSoft', 'pulse25Quiet',
];
export function waveSamples4() {
  const W = {
    pulse12: quant(pulse(1 / 8)),
    pulse25: quant(pulse(1 / 4)),
    softBass: quant(harm([1, 0.35, 0.12, 0.05])),                  // round, a little body (for GBA-wave-style voices)
    square: quant(pulse(1 / 2)),
    bass: quant((p) => 0.65 * tri(p) + 0.35 * pulse(0.5)(p) * 0.6 + 0.15 * sine(2 * p)), // the default bass: soft square-triangle
    saw: quant(saw),
    sine: quant(sine),
    triangle: quant(tri),
    organ: quant(harm([1, 0.6, 0, 0.35, 0, 0, 0, 0.2])),
    brightBass: quant(harm([1, 0.5, 0.33, 0.25, 0.2, 0.16])),        // a soft saw: cuts through on small speakers
    triangleQuiet: scaled(quant(tri), 0.5),
    sineQuiet: scaled(quant(sine), 0.5),
    reed: quant(harm([1, 0.1, 0.45, 0.05, 0.25, 0, 0.12])),          // odd harmonics: clarinet-ish
    hollow: quant(harm([0.5, 1, 0.3])),
    sawSoft: scaled(quant(saw), 0.6),
    pulse25Quiet: scaled(quant(pulse(1 / 4)), 0.5),
  };
  return WAVE_NAMES.map((n) => W[n]);
}
const pack = (s) => Array.from({ length: 16 }, (_, i) => (s[2 * i] << 4) | s[2 * i + 1]);

// ---- drums: [frames, NR42 envelope (vol << 4 | dir << 3 | period), NR43 (shift << 4 | 7-bit << 3 | divisor)]
// The 7-bit LFSR (bit 3) gives a pitched buzz of clock / 127 Hz, clock = 262144 / (r || 0.5) / 2^shift: used for the
// kick / tom sweeps and the tick. The 15-bit LFSR is plain noise: snares (mid), hats (high), crash (wide, long).
export const DRUMS = {
  0: [],                                                                                  // (unused: silence)
  1: [[1, 0xd1, 0x1d], [1, 0xc2, 0x33]],                                                  // snare: crack + noise
  2: [[1, 0x71, 0x1d], [1, 0x62, 0x33]],                                                  // snare, quiet
  3: [[1, 0xa1, 0x1d], [1, 0x92, 0x33]],                                                  // snare, soft
  4: [[1, 0xc1, 0x2c], [2, 0xb1, 0x2d], [2, 0xa1, 0x2e], [2, 0x92, 0x2f]],                 // tom / soft kick / timpani
  5: [[1, 0xa1, 0x18], [1, 0x71, 0x19]],                                                  // tick (woodblock, rim)
  6: [[1, 0xc1, 0x3c], [2, 0xb1, 0x3d], [2, 0xa1, 0x3e], [2, 0x92, 0x3f]],                 // low tom
  7: [[1, 0x93, 0x10]],                                                                   // open hat
  8: [[1, 0x51, 0x10]],                                                                   // pedal hat
  9: [[1, 0x81, 0x10]],                                                                   // closed hat
  10: [[1, 0xb1, 0x23], [1, 0x41, 0x31], [1, 0xa2, 0x23]],                                // clap
  11: [[1, 0xf1, 0x32], [1, 0xf1, 0x2c], [1, 0xd1, 0x2e], [2, 0xc1, 0x3d], [1, 0xa1, 0x3f]], // kick: falling thump
  12: [[1, 0xf1, 0x21], [1, 0xd5, 0x22]],                                                 // crash
};
const KITS = 6;

export function buildEngineBank() {
  const bank = new Uint8Array(0x4000);
  let pc = 0;
  const w8 = (v) => { bank[pc++] = v & 0xff; };
  const w16 = (v) => { w8(v); w8(v >> 8); };
  const tables = { engineBank: ENGINE_BANK };
  tables.frequencyTable = ORG + pc;
  for (const v of frequencyWords()) w16(v);
  tables.waveSamples = ORG + pc;
  for (const s of waveSamples4()) for (const b of pack(s)) w8(b);
  // drum sequences
  const drumAt = {};
  for (const [k, steps] of Object.entries(DRUMS)) {
    drumAt[k] = ORG + pc;
    for (const [f, env, poly] of steps) { w8(0x20 | (f - 1)); w8(env); w8(poly); }
    w8(0xff);
  }
  // one kit (all kit numbers share it)
  const kit = ORG + pc;
  for (let k = 0; k <= 12; k++) w16(drumAt[k]);
  tables.drumkits = ORG + pc;
  for (let i = 0; i < KITS; i++) w16(kit);
  return { bytes: bank, tables, size: pc };
}

if (process.argv[1] && import.meta.url === new URL('file://' + process.argv[1]).href) {
  const { tables, size } = buildEngineBank();
  console.log(`engine bank $${ENGINE_BANK.toString(16)}: ${size} B used`, JSON.stringify(tables));
}
