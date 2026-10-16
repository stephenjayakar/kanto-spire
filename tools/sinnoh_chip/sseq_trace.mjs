// Sinnoh chiptune, step 1: run a Platinum sequence (SSEQ, from the user's own ROM via sdat.mjs) through a faithful
// model of the Nitro SDK's SND sequencer and record what every track plays, the same way tools/hoenn_chip/m4a_trace.mjs
// records Emerald's m4a songs: the result has EXACTLY traceSong()'s shape, so tools/hoenn_chip/m4a2gsc.mjs convert()
// arranges it unchanged.
//
//   node tools/sinnoh_chip/sseq_trace.mjs SEQ_BA_GYM [...]   -> summary (tracks, notes, tempo, loop, classes)
//   import { traceSseq } from './sseq_trace.mjs';  traceSseq('SEQ_ROAD_A_D', { rom, maxFrames, vars, ticks })
//
// The sequencer (SDK seq.c semantics):
//   - timing: one sequencer update every 64 * 2728 / 33513982 s (~5.2 ms, 191.955 Hz). Each update first runs one tick
//     per 240 in the tempo accumulator (starting at 240, so the first update ticks), then adds the tempo (x ratio 256/256).
//     SSEQ resolution is 48 ticks per quarter note, so tempo T is T * 191.955 / 192 real bpm.
//   - per tick, tracks 0-15 run in index order (a track opened by 0x93 runs in the same tick); a track first counts down
//     its notes' lengths (a note of length L started at tick t ends at t + L), then its noteFinishWait / wait, then reads
//     commands until it waits again.
//   - commands: notes (key + transpose, clamped 0-127; velocity; VLV length; noteWait mode makes the track wait the
//     length, length 0 = until the note's channel stops), 0x80 rest, 0x81 program, 0x93 open track (needs the 0xFE alloc
//     mask), 0x94 jump, 0x95 call / 0xFD return (3-deep stack shared with 0xD4 loop start / 0xFC loop end, count 0 =
//     forever), 0xA0 random / 0xA1 variable argument prefixes (the last argument comes from the LCG
//     u = u * 1664525 + 1013904223 or a variable), 0xA2 if (runs the next command only when the compare flag is set),
//     0xB0-0xBD variable set / add / sub / mul / div / shift / rand / compare (vars 0-15 per player, 16-31 global, all
//     start at -1; opts.vars overrides), 0xC0 pan, 0xC1 volume, 0xC2 master volume, 0xC3 transpose, 0xC4 pitch bend,
//     0xC5 bend range, 0xC6 priority, 0xC7 note-wait mode, 0xC8 tie (releases the track's notes; in tie mode a note
//     re-keys the sounding one: recorded as a new note with legato: true), 0xC9 portamento key, 0xCA-0xCD modulation
//     depth / speed / type / range, 0xCE portamento on/off, 0xCF portamento time, 0xD0-0xD3 attack / decay / sustain /
//     release overrides, 0xD5 expression, 0xD6 print var, 0xD7 mute (0 off, 1 no new notes, 2/3 + release), 0xE0 mod
//     delay, 0xE1 tempo, 0xE3 sweep pitch, 0xFF end of track (releases its notes).
//   - not modelled (no effect on what notes play): channel allocation / voice stealing, release tails, LFO output.
//
// Output (m4a_trace.mjs traceSong() shape), with these conversions:
//   - ticks: m4a's 24 per quarter by default: tick24 = floor(tick48 / 2) for note starts, note ends, controls, tempo
//     changes and the loop points (a note that would get zero length gets 1). The exact values are kept as tick48 /
//     endTick48. opts.ticks = 48 keeps native ticks instead (bpm is then doubled so frames per tick stay 150 / bpm).
//   - bpm: m4a's convention (frames per tick = 150 / bpm at the Game Boy's 59.7275 Hz), i.e. the real tempo x 60 /
//     59.7275, so convert()'s GSC tempo 38400 / bpm plays at Platinum's real speed.
//   - frames: Game Boy frames (59.7275 Hz) from the sequencer update count; tickFrame[t] = frame of tick t.
//   - loop: each track's backward jumps (0x94 to an earlier offset, or an endless 0xFC); like m4a_trace: endTick =
//     the latest first jump, lenTicks = the longest first-to-second distance, secondPassFrames = frames of one more pass.
//     Songs that end (jingles): loop null, endTick / endFrame = when the last track ended.
//   - volume: DS volumes are dB-square (amplitude (x/127)^2); vel = 127 (v/127)^2 and vol = 127 (vol/127)^2
//     (expr/127)^2 (master/127)^2, so convert()'s vel/127 * vol/127 is the real linear amplitude (raw values: velRaw,
//     volRaw, expr, master). pan: track pan + instrument pan - 64, m4a range -64..63. bend: m4a units (raw / 2, so
//     bend * bendRange / 64 semitones); keyM / pitM: the bend (and a PSG's base-key offset) as semitones + 1/256ths.
//   - instruments (SBNK): rhythm = drum-set note; cgb 0 = PCM sample, 2 = PSG pulse (duty mapped to the Game Boy's
//     0-3), 4 = noise; adsr: m4a units (PCM: GBA attack/decay/sustain/release per 59.73 Hz frame; PSG: Game Boy
//     style, sustain 0-15, decay frames per step), raw DS values in dsAdsr; mod: m4a-like depth (depth * range / 8,
//     pitch modulation only), lfoDelay in m4a ticks.
//   - name: { kind, how, bank, prog, key, swar, swav, ... } class hints that m4a2gsc drumRole() / noteClass() read
//     (the SDAT has no instrument names):
//       drums: 'kick' | 'snare' | 'snareSoft' | 'hatClosed' | 'hatPedal' | 'hatOpen' | 'crash' | 'tom' | 'timpani' |
//       'stick' (drumRole's 'tick'). The kits are GS-style (keys 35-88 = General MIDI), so the key's GM instrument (or,
//       for keys outside it, the GM key the same sample sits on in another kit) gives the role, unless the sample's
//       sound (sampleFeatures: zero-crossing rate, energy under 250 Hz, decay, loop) clearly belongs to another family
//       (cymbal vs drum); then, and for samples with no GM home, classifyDrum() decides. gm = the GM instrument name.
//       DRUM_OVERRIDES fixes misjudged ones.
//       melodic: Platinum's BGM banks lay out their shared samples like GM programs (32-39 low-sampled basses, 47
//       timpani, 56 trumpet, 73 flute ...), so those get the GM name ('finger bass', 'timpani', 'trumpet' ...: /bass/
//       -> bass line, /timpani/ -> percussion, brass / reeds -> duty 1, mallets / bells -> duty 0); bank-specific
//       samples get 'bass' (sampled only at or below key 52) or 'pcm'; PSG 'psg', noise 'noise'.
//       flags: noise: true = a melodic program whose sample is noise (a cymbal played on a melodic track, kind
//       'cymbal'); swell: true = a slow attack (the sound peaks at its end, e.g. a reverse cymbal).
//   - stats: { cmds (command histogram), unresolved (notes with no instrument: silent on the DS too), missing }.
//     Platinum's BGM only uses notes, 0x80/0x81, 0x93-0x95, 0xC0/C1/C4/C5/C6/C7/CA/CB/CD/D5, 0xE1/E3, 0xFD/FE/FF;
//     the rest is implemented from the SDK's semantics and checked on synthetic bytecode (opts.data).
import path from 'path';
import { fileURLToPath } from 'url';
import { loadSdat, DEFAULT_ROM } from './sdat.mjs';

const UPDATE_S = (64 * 2728) / 33513982;     // one sequencer update
const GB_HZ = 59.7275;
const BPM_SCALE = (1 / UPDATE_S / 192) * (60 / GB_HZ); // tempo value -> m4a bpm (24 tpq)

// Drum samples the analysis gets wrong: 'bank:prog:key' (or 'bank:prog:*' for a whole melodic program, e.g. a timpani)
// -> kind. Ids only, no ROM data.
export const DRUM_OVERRIDES = {
};

const sq = (x) => (x / 127) * (x / 127);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

// ---- DS envelope -> m4a units
const fall = (x) => (x === 127 ? 65535 : x === 126 ? 15360 : x < 50 ? x * 2 + 1 : Math.floor(7680 / (126 - x)));
const ATTACK_TABLE = [0, 1, 5, 14, 26, 38, 51, 63, 73, 84, 92, 100, 109, 116, 123, 127, 132, 137, 143];
const attackRate = (a) => (a < 109 ? 255 - a : ATTACK_TABLE[127 - a]);
const sustDb = (s) => (s === 0 ? -72.3 : Math.max(-72.2, 40 * Math.log10(s / 127))); // dB (the SDK's 0.1 dB table / 10)
const dbPerSec = (x) => (fall(x) / 128) * 0.1 / UPDATE_S;
function gbaAdsr([a, d, s, r]) {
  const ar = attackRate(a);
  const atkS = ar === 0 ? 0 : (Math.log(1 / 723) / Math.log(ar / 256)) * UPDATE_S;
  const perFrame = (x) => (x === 127 ? 0 : clamp(Math.round(256 * Math.pow(10, -dbPerSec(x) / 20 / GB_HZ)), 0, 255));
  return [atkS === 0 ? 255 : clamp(Math.round(255 / (atkS * GB_HZ)), 1, 255), perFrame(d), clamp(Math.round(255 * Math.pow(10, sustDb(s) / 20)), 0, 255), perFrame(r)];
}
function gbAdsr([a, d, s, r]) {
  const sLin = Math.pow(10, sustDb(s) / 20), sGb = clamp(Math.round(15 * sLin), 0, 15);
  const step = (x, db, steps) => (x === 127 || steps <= 0 ? 0 : clamp(Math.round((Math.abs(db) / dbPerSec(x)) * GB_HZ / steps), 1, 7));
  const ar = attackRate(a);
  return [ar === 0 ? 0 : clamp(Math.round((Math.log(1 / 723) / Math.log(ar / 256)) * UPDATE_S * GB_HZ / 15), 1, 7), step(d, sustDb(s), 15 - sGb), sGb, step(r, 72, Math.max(1, sGb))];
}
const DUTY = [0, 1, 1, 2, 2, 3, 0]; // DS PSG duty 12.5% .. 87.5% -> Game Boy 12.5 / 25 / 50 / 75 %

// ---- drum sample analysis
const featCache = new Map();
export function sampleFeatures(wa, swavIdx) {
  const k = `${wa.id}:${swavIdx}`;
  if (featCache.has(k)) return featCache.get(k);
  const w = wa.swavs[swavIdx];
  const x = wa.decode(swavIdx), rate = w.rate || 32768;
  const n = x.length, dur = n / rate;
  let zc = 0, e = 0, lowE = 0, lp = 0, peak = 0;
  const a = Math.exp(-2 * Math.PI * 250 / rate); // one-pole low-pass at 250 Hz
  for (let i = 0; i < n; i++) {
    if (i && (x[i] >= 0) !== (x[i - 1] >= 0)) zc++;
    e += x[i] * x[i];
    lp = a * lp + (1 - a) * x[i]; lowE += lp * lp;
    peak = Math.max(peak, Math.abs(x[i]));
  }
  // energy envelope in 5 ms blocks: time to fall 20 dB below the loudest block
  const B = Math.max(1, Math.round(rate * 0.005)), env = [];
  for (let i = 0; i < n; i += B) { let s = 0; for (let j = i; j < Math.min(n, i + B); j++) s += x[j] * x[j]; env.push(s / B); }
  const pk = env.indexOf(Math.max(...env));
  let d20 = env.length;
  for (let i = pk; i < env.length; i++) if (env[i] < env[pk] / 100) { d20 = i; break; }
  const f = { dur, loop: !!w.loop, zcr: zc / Math.max(dur, 1e-6), low: e ? lowE / e : 0, decay20: (d20 - pk) * 0.005, attack: pk * 0.005, peak, rate };
  featCache.set(k, f);
  return f;
}
// General MIDI percussion (the kits are GS-style: keys 35-88 follow GM): key -> [instrument, the drumRole() class it maps to]
const GM = {
  35: ['bass drum', 'kick'], 36: ['bass drum', 'kick'], 37: ['side stick', 'stick'], 38: ['snare', 'snare'], 39: ['hand clap', 'snare'],
  40: ['snare', 'snare'], 41: ['low floor tom', 'tom'], 42: ['closed hi-hat', 'hatClosed'], 43: ['floor tom', 'tom'], 44: ['pedal hi-hat', 'hatPedal'],
  45: ['low tom', 'tom'], 46: ['open hi-hat', 'hatOpen'], 47: ['low-mid tom', 'tom'], 48: ['hi-mid tom', 'tom'], 49: ['crash cymbal', 'crash'],
  50: ['high tom', 'tom'], 51: ['ride cymbal', 'hatOpen'], 52: ['chinese cymbal', 'crash'], 53: ['ride bell', 'hatOpen'], 54: ['tambourine', 'hatPedal'],
  55: ['splash cymbal', 'crash'], 56: ['cowbell', 'stick'], 57: ['crash cymbal', 'crash'], 58: ['vibraslap', 'hatPedal'], 59: ['ride cymbal', 'hatOpen'],
  60: ['hi bongo', 'stick'], 61: ['low bongo', 'tom'], 62: ['mute hi conga', 'stick'], 63: ['open hi conga', 'stick'], 64: ['low conga', 'tom'],
  65: ['high timbale', 'stick'], 66: ['low timbale', 'tom'], 67: ['high agogo', 'stick'], 68: ['low agogo', 'stick'], 69: ['cabasa', 'hatPedal'],
  70: ['maracas', 'hatPedal'], 71: ['short whistle', 'stick'], 72: ['long whistle', 'stick'], 73: ['short guiro', 'hatPedal'], 74: ['long guiro', 'hatPedal'],
  75: ['claves', 'stick'], 76: ['hi wood block', 'stick'], 77: ['low wood block', 'stick'], 78: ['mute cuica', 'stick'], 79: ['open cuica', 'stick'],
  80: ['mute triangle', 'stick'], 81: ['open triangle', 'stick'], 82: ['shaker', 'hatPedal'], 83: ['jingle bell', 'hatPedal'], 84: ['bell tree', 'stick'],
  85: ['castanets', 'stick'], 86: ['mute surdo', 'tom'], 87: ['open surdo', 'tom'],
};
// the sound alone (fallback for keys outside the GM range, and the sanity check of the GM guess), the sample played at
// `ratio` x its native rate (key vs base key): low = share of energy under 250 Hz, zcr = zero crossings / s,
// dec = time to fall 20 dB from the peak
export function classifyDrum(f, ratio = 1) {
  const zcr = f.zcr * ratio, dec = f.loop ? Math.max(0.4, f.decay20 / ratio) : f.decay20 / ratio, low = f.low;
  if (low > 0.6 && zcr < 600) return dec > 0.5 ? 'timpani' : 'kick';
  if (low > 0.35 && zcr < 2000) return dec > 0.5 ? 'timpani' : 'tom';
  if (zcr > 8000 && low < 0.05) return f.loop || dec > 0.25 ? (dec > 0.36 && zcr < 12000 ? 'crash' : 'hatOpen') : 'hatClosed';
  if (low >= 0.15 && zcr >= 1500) return 'snare';
  if (low < 0.1 && dec < 0.1) return 'stick';
  if (zcr >= 2500) return dec > 0.3 && zcr > 5000 ? 'crash' : 'snare';
  return 'stick';
}
const FAMILY = { kick: 'low', tom: 'low', timpani: 'low', hatClosed: 'cym', hatPedal: 'cym', hatOpen: 'cym', crash: 'cym', snare: 'mid', stick: 'mid' };
// each drum sample's GM home: the GM role of a key (35-88) where some kit plays it at its own base key
const homeCache = new Map();
function gmHomes(sd) {
  if (homeCache.has(sd)) return homeCache.get(sd);
  const m = new Map();
  for (const bank of sd.banks) if (bank) for (const inst of bank.instruments) if (inst && inst.type === 0x10) for (const r of inst.regions) {
    if (r.def.type !== 1 || !GM[r.lo] || r.def.baseKey !== r.lo) continue;
    const k = `${bank.wavearcs[r.def.swar]}:${r.def.swav}`;
    if (!m.has(k)) m.set(k, r.lo);
  }
  homeCache.set(sd, m);
  return m;
}
function drumKind(sd, bankId, prog, key, r) {
  const ov = DRUM_OVERRIDES[`${bankId}:${prog}:${key}`] || DRUM_OVERRIDES[`${bankId}:${prog}:*`];
  if (ov) return { kind: ov, how: 'override' };
  const def = r.def;
  if (def.type === 3) return { kind: key >= 60 ? 'hatClosed' : 'snareSoft', how: 'noise' };
  if (def.type === 2) return { kind: 'stick', how: 'psg' };
  const home = r.wavearc ? gmHomes(sd).get(`${r.wavearcId}:${def.swav}`) : undefined;
  const cands = [GM[key] ? key : null, home].filter((k, i, l) => k && l.indexOf(k) === i);
  if (!r.wavearc) return { kind: cands.length ? GM[cands[0]][1] : 'hatClosed', gm: cands.length ? GM[cands[0]][0] : null, how: 'gm' };
  const f = sampleFeatures(r.wavearc, def.swav);
  const heard = classifyDrum(f, Math.pow(2, (key - def.baseKey) / 12));
  // the GM layout (this key's GM instrument, else the sample's GM home) wins unless the sound clearly belongs to another
  // family (a "kick" that is all hiss, a "cymbal" all boom)
  for (const gmKey of cands) {
    const g = GM[gmKey][1], clash = (FAMILY[g] === 'low' && FAMILY[heard] === 'cym') || (FAMILY[g] === 'cym' && FAMILY[heard] === 'low');
    if (!clash) return { kind: g, gm: GM[gmKey][0], how: gmKey === key ? 'gm' : `gm home ${gmKey}`, heard, features: f };
  }
  return { kind: heard, how: cands.length ? `sound (gm ${cands.map((k) => GM[k][0]).join(' / ')} rejected)` : 'sound', heard, features: f };
}
// a melodic program that is a bass: every region sampled at or below key 52 (the instrument has no high samples)
function isBassInst(inst) {
  if (!inst || inst.type === 0x10) return false;
  const defs = inst.type === 0x11 ? inst.regions.map((r) => r.def) : [inst];
  return defs.every((d) => d.type === 1 && d.baseKey <= 52);
}
// General MIDI programs. Platinum's BGM banks lay their shared samples (the bank's first wave archive) out like GM:
// 32-39 basses sampled low, 47 timpani, 56 trumpet, 73 flute, 9 glockenspiel, 11 vibraphone ... (names chosen so
// m4a2gsc's regexes read them right: /bass/ -> bass line, /timpani/ -> percussion, brass / reeds / leads -> duty 1,
// bells / mallets -> duty 0).
export const GM_PROGRAMS = ('acoustic grand piano|bright piano|electric grand piano|honky-tonk piano|electric piano 1|electric piano 2|' +
  'harpsichord|clavinet|celesta|glockenspiel|music_box|vibraphone|marimba|xylophone|tubular bells|dulcimer|drawbar organ|' +
  'percussive organ|rock organ|church organ|reed organ|accordion|harmonica|tango accordion|nylon guitar|steel guitar|' +
  'jazz guitar|clean guitar|muted guitar|overdriven guitar|distortion guitar|guitar harmonics|acoustic bass|finger bass|' +
  'pick bass|fretless bass|slap bass 1|slap bass 2|synth bass 1|synth bass 2|violin|viola|cello|contrabass|tremolo strings|' +
  'pizzicato strings|orchestral harp|timpani|string ensemble 1|string ensemble 2|synth strings 1|synth strings 2|choir aahs|' +
  'voice oohs|synth voice|orchestra hit|trumpet|trombone|tuba|muted trumpet|french horn|brass section|synth brass 1|' +
  'synth brass 2|soprano sax|alto sax|tenor sax|baritone sax|oboe|english horn|bassoon|clarinet|piccolo|flute|recorder|' +
  'pan flute|blown bottle|shakuhachi|whistle|ocarina|square lead|sawtooth lead|calliope lead|chiff lead|charang lead|' +
  'voice lead|fifths lead|bass and lead|new age pad|warm pad|polysynth pad|choir pad|bowed pad|metallic pad|halo pad|' +
  'sweep pad|rain fx|soundtrack fx|crystal fx|atmosphere fx|brightness fx|goblins fx|echoes fx|sci-fi fx|sitar|banjo|' +
  'shamisen|koto|kalimba|bagpipe|fiddle|shanai|tinkle bell|agogo|steel drums|woodblock|taiko drum|melodic tom|synth drum|' +
  'reverse cymbal|guitar fret noise|breath noise|seashore|bird tweet|telephone ring|helicopter|applause|gunshot').split('|');
// a bank is GM-laid-out when it has a drum set and every PCM program it has in 32-39 is a low-sampled bass
const gmBankCache = new Map();
function isGmBank(bank) {
  if (gmBankCache.has(bank)) return gmBankCache.get(bank);
  const ins = bank.instruments;
  const basses = [32, 33, 34, 35, 36, 37, 38, 39].map((p) => ins[p]).filter((x) => x && (x.type === 1 || x.type === 0x11));
  const ok = ins.some((x) => x && x.type === 0x10) && basses.length >= 3 && basses.every(isBassInst);
  gmBankCache.set(bank, ok);
  return ok;
}
// a melodic sample that is noise (a cymbal swell, a sound effect): zero crossings far above twice its pitch
function isNoiseSample(f, baseKey) { return f.zcr > 8 * 2 * 440 * Math.pow(2, (baseKey - 69) / 12) && f.low < 0.08; }
function melodicName(sd, bankId, prog, r, cgb) {
  const ov = DRUM_OVERRIDES[`${bankId}:${prog}:*`];
  if (ov) return { kind: ov, how: 'override' };
  if (cgb === 4) return { kind: 'noise' };
  if (cgb === 2) return { kind: 'psg' };
  const def = r.def, bank = sd.banks[bankId];
  if (r.wavearc && def.type === 1) {
    const f = sampleFeatures(r.wavearc, def.swav);
    if (isNoiseSample(f, def.baseKey)) return { kind: 'cymbal', noise: true, how: 'sound' };
  }
  if (def.type === 1 && def.swar === 0 && isGmBank(bank)) {
    const defs = r.inst.type === 0x11 ? r.inst.regions.map((x) => x.def) : [r.inst];
    if (defs.every((d) => d.type === 1 && d.swar === 0)) return { kind: GM_PROGRAMS[prog], how: 'gm' };
  }
  return { kind: isBassInst(r.inst) ? 'bass' : 'pcm', how: 'samples' };
}

// ---- the sequencer
let randU = 0x12345678;
const rand16 = () => { randU = (Math.imul(randU, 1664525) + 1013904223) >>> 0; return randU >>> 16; };

export function traceSseq(label, opts = {}) {
  const sd = loadSdat(opts.rom || DEFAULT_ROM);
  const seq = sd.seqs[label];
  if (!seq) throw new Error(`${label}: no such sequence in the SDAT`);
  const TPQ = opts.ticks === 48 ? 48 : 24, div = TPQ === 24 ? 2 : 1;
  const maxFrames = opts.maxFrames ?? 60 * 60 * 10;
  const maxUpdates = Math.ceil(maxFrames / GB_HZ / UPDATE_S);
  // opts.data / opts.bank: run other bytecode against the ROM's banks (tests)
  const data = opts.data || seq.data, bankId = opts.bank ?? seq.bank;
  randU = opts.seed ?? 0x12345678;
  const globals = new Int16Array(16).fill(-1);
  const player = { tempo: 120, counter: 240, master: 127, vars: new Int16Array(16).fill(-1) };
  for (const [k, v] of Object.entries(opts.vars || {})) { if (+k < 16) player.vars[+k] = v; else globals[+k - 16] = v; }
  const getVar = (i) => (i < 16 ? player.vars[i] : i < 32 ? globals[i - 16] : 0);
  const setVar = (i, v) => { v = (v << 16) >> 16; if (i < 16) player.vars[i] = v; else if (i < 32) globals[i - 16] = v; };
  const newTrack = (idx) => ({
    idx, alloc: false, active: false, pos: 0, wait: 0, noteWait: true, finishWait: false, tie: false, mute: 0, cmp: true,
    prg: 0, prio: 64, vol: 127, vol2: 127, pan: 0, transpose: 0, bend: 0, bendRange: 2, portaKey: 60, porta: false, portaTime: 0,
    sweep: 0, mod: { depth: 0, speed: 16, type: 0, range: 1, delay: 0 }, adsr: [255, 255, 255, 255], stack: [], live: [], jumps: 0,
  });
  const tracks = Array.from({ length: 16 }, (_, i) => newTrack(i));
  let tick = 0, update = 0;
  const tickUpdate = [];
  const notes = [], ctl = [], gotos = [], tempos = [];
  const stats = { cmds: {}, unresolved: 0, finishWait: 0, missing: {} };
  const frameOf = (u) => Math.floor(u * UPDATE_S * GB_HZ);
  const curFrame = () => frameOf(update);

  // first command: 0xFE allocates the tracks
  const t0 = tracks[0];
  t0.alloc = true; t0.active = true;
  if (data[0] === 0xfe) { const mask = data[1] | (data[2] << 8); for (let i = 1; i < 16; i++) if (mask & (1 << i)) tracks[i].alloc = true; t0.pos = 3; }

  const endNote = (n) => { if (n.endTick48 === null) n.endTick48 = tick; };
  const releaseAll = (t) => { for (const n of t.live) endNote(n); t.live = []; };
  const close = (t) => { releaseAll(t); t.active = false; t.closedAt = tick; };
  const ticksPerSec = () => player.tempo / 240 / UPDATE_S;

  const noteOn = (t, key, velRaw, length) => {
    const r = sd.resolve(bankId, t.prg, key);
    if (!r) { stats.unresolved++; (stats.missing[`${t.prg}:${key}`] = (stats.missing[`${t.prg}:${key}`] || 0) + 1); return; } // no instrument: the SDK starts no channel
    const def = r.def, rhythm = r.inst.type === 0x10;
    const legato = t.tie && t.live.length > 0;
    if (legato) releaseAll(t);
    const cgb = def.type === 2 ? 2 : def.type === 3 ? 4 : 0;
    const dsAdsr = [0, 1, 2, 3].map((i) => (t.adsr[i] !== 255 ? t.adsr[i] : [def.attack, def.decay, def.sustain, def.release][i]));
    let rem = length;
    if (length <= 0) {
      rem = -1; // until the channel stops: a one-shot sample's length
      if ((def.type === 1 || def.type === 4) && r.wavearc) {
        const w = r.wavearc.swavs[def.swav];
        if (w && !w.loop) {
          const f = sampleFeatures(r.wavearc, def.swav);
          rem = Math.max(1, Math.ceil((f.dur / Math.pow(2, (key - def.baseKey) / 12)) * ticksPerSec()));
        }
      }
    }
    // sounding pitch: key (+ PSG base-key offset: the SDK starts a PSG channel at timer 8006 = C4, so a PSG note at
    // its base key sounds key 60) + bend
    const off = (cgb === 2 ? 60 - def.baseKey : 0) + (t.bend * t.bendRange) / 128;
    const keyM = Math.floor(off), pitM = Math.round((off - keyM) * 256);
    const vol = 127 * sq(t.vol) * sq(t.vol2) * sq(player.master);
    let name;
    if (rhythm) name = drumKind(sd, bankId, t.prg, key, r);
    else name = melodicName(sd, bankId, t.prg, r, cgb);
    name = { ...name, bank: bankId, prog: t.prg, key, swar: r.wavearcId, swav: def.type === 1 ? def.swav : null };
    if (dsAdsr[0] < 30) name.swell = true; // a slow attack (over ~0.3 s, e.g. a reverse-cymbal swell): it peaks at its end
    const n = {
      track: t.idx, tick48: tick, frame: curFrame(), key, played: cgb === 4 ? key - def.baseKey + 60 : key,
      velRaw, vel: +(127 * sq(velRaw)).toFixed(2), gate: length > 0 ? length : 0, volRaw: t.vol, expr: t.vol2, master: player.master,
      vol: +vol.toFixed(2), pan: clamp(t.pan + def.pan - 64, -64, 63), keyM, pitM, keyShift: t.transpose, bend: t.bend / 2, bendRange: t.bendRange,
      mod: t.mod.type === 0 ? Math.round((t.mod.depth * t.mod.range) / 8) : 0, modT: t.mod.type, modRaw: { ...t.mod },
      lfoSpeed: t.mod.speed, lfoDelay: +(t.mod.delay * player.tempo / 240 / div).toFixed(2),
      porta: t.porta ? { from: t.portaKey, time: t.portaTime } : null, sweep: t.sweep, legato,
      prog: t.prg, type: cgb | (rhythm ? 0x80 : 0), rhythm, cgb, sub: r.region ? (rhythm ? key : r.inst.regions.indexOf(r.region)) : null,
      wav: def.type === 2 ? def.swav : def.swav, baseKey: def.baseKey,
      adsr: cgb === 0 ? gbaAdsr(dsAdsr) : gbAdsr(dsAdsr), dsAdsr,
      duty: cgb === 2 ? DUTY[def.swav] ?? 2 : null, dsDuty: cgb === 2 ? def.swav : null,
      name, endTick48: null, rem,
    };
    notes.push(n);
    t.live.push(n);
  };

  const rd8 = (t) => data[t.pos++];
  const rd16 = (t) => { const v = data[t.pos] | (data[t.pos + 1] << 8); t.pos += 2; return v; };
  const rd24 = (t) => { const v = data[t.pos] | (data[t.pos + 1] << 8) | (data[t.pos + 2] << 16); t.pos += 3; return v; };
  const rdVlv = (t) => { let v = 0, b; do { b = data[t.pos++]; v = (v << 7) | (b & 0x7f); } while (b & 0x80); return v; };
  // argument types: 'vlv' | 'u8' | 's16', or the 0xA0 random / 0xA1 variable replacements
  const rdArg = (t, type, special) => {
    if (special === 'rand') { const lo = (rd16(t) << 16) >> 16, hi = (rd16(t) << 16) >> 16; return lo + ((rand16() * (hi - lo + 1)) >> 16); }
    if (special === 'var') return getVar(rd8(t));
    if (type === 'vlv') return rdVlv(t);
    if (type === 'u8') return rd8(t);
    return (rd16(t) << 16) >> 16;
  };
  const at = (t) => ({ track: t.idx, tick48: tick, frame: curFrame() });

  const step = (t) => {
    for (const n of t.live) if (n.rem > 0 && --n.rem === 0) endNote(n);
    t.live = t.live.filter((n) => n.endTick48 === null);
    if (t.finishWait) { if (t.live.length) return true; t.finishWait = false; }
    if (t.wait > 0) { t.wait--; if (t.wait > 0) return true; }
    let guard = 0;
    while (t.wait === 0 && !t.finishWait) {
      if (++guard > 100000) throw new Error(`${label}: track ${t.idx} runs away at 0x${t.pos.toString(16)} (no wait)`);
      if (t.pos >= data.length) return false;
      const cmdPos = t.pos;
      let cmd = rd8(t), run = true, special = null;
      if (cmd === 0xa2) { cmd = rd8(t); run = t.cmp; }
      if (cmd === 0xa0) { cmd = rd8(t); special = 'rand'; }
      if (cmd === 0xa1) { cmd = rd8(t); special = 'var'; }
      const ck = (cmd < 0x80 ? 'note' : cmd.toString(16)) + (special ? '/' + special : '') + (run !== true || data[cmdPos] === 0xa2 ? '/if' : '');
      stats.cmds[ck] = (stats.cmds[ck] || 0) + 1;
      if (cmd < 0x80 && t.noteWait && data[t.pos + 1] === 0 && !special) stats.finishWait++;
      if (cmd < 0x80) {
        const vel = rd8(t), len = rdArg(t, 'vlv', special);
        if (!run) continue;
        const key = clamp(cmd + t.transpose, 0, 127);
        if (!t.mute) noteOn(t, key, vel, len);
        t.portaKey = key;
        if (t.noteWait) { t.wait = len; if (len === 0) t.finishWait = true; }
        continue;
      }
      switch (cmd & 0xf0) {
        case 0x80: {
          const arg = rdArg(t, 'vlv', special);
          if (!run) break;
          if (cmd === 0x80) t.wait = arg;
          else if (cmd === 0x81) { if (arg < 0x10000) t.prg = arg; }
          break;
        }
        case 0x90: {
          if (cmd === 0x93) {
            const no = rd8(t), off = rd24(t);
            if (!run) break;
            const nt = tracks[no & 15];
            if (nt.alloc && nt !== t) {
              if (nt.active) close(nt);
              Object.assign(nt, newTrack(nt.idx), { alloc: true, active: true, pos: off });
            }
          } else if (cmd === 0x94) {
            const off = rd24(t);
            if (!run) break;
            if (off <= cmdPos) { t.jumps++; gotos.push({ track: t.idx, tick48: tick, frame: curFrame(), target: off, from: cmdPos }); }
            t.pos = off;
          } else if (cmd === 0x95) {
            const off = rd24(t);
            if (!run) break;
            if (t.stack.length < 3) { t.stack.push({ pos: t.pos, count: 0, call: true }); t.pos = off; }
          } else throw new Error(`${label}: unknown command 0x${cmd.toString(16)} at 0x${cmdPos.toString(16)}`);
          break;
        }
        case 0xb0: {
          const no = rd8(t), arg = rdArg(t, 's16', special);
          if (!run) break;
          const v = getVar(no);
          switch (cmd) {
            case 0xb0: setVar(no, arg); break;
            case 0xb1: setVar(no, v + arg); break;
            case 0xb2: setVar(no, v - arg); break;
            case 0xb3: setVar(no, v * arg); break;
            case 0xb4: if (arg !== 0) setVar(no, Math.trunc(v / arg)); break;
            case 0xb5: setVar(no, arg >= 0 ? v << arg : v >> -arg); break;
            case 0xb6: { const neg = arg < 0, a = Math.abs(arg); let r = (rand16() * (a + 1)) >> 16; setVar(no, neg ? -r : r); break; }
            case 0xb8: t.cmp = v === arg; break;
            case 0xb9: t.cmp = v >= arg; break;
            case 0xba: t.cmp = v > arg; break;
            case 0xbb: t.cmp = v <= arg; break;
            case 0xbc: t.cmp = v < arg; break;
            case 0xbd: t.cmp = v !== arg; break;
            default: break;
          }
          break;
        }
        case 0xc0: case 0xd0: {
          const arg = rdArg(t, 'u8', special);
          if (!run) break;
          const s8 = (arg << 24) >> 24;
          switch (cmd) {
            case 0xc0: t.pan = arg - 64; ctl.push({ ...at(t), pan: t.pan }); break;
            case 0xc1: t.vol = arg; ctl.push({ ...at(t), vol: t.vol }); break;
            case 0xc2: player.master = arg; ctl.push({ ...at(t), master: arg }); break;
            case 0xc3: t.transpose = s8; ctl.push({ ...at(t), keyShift: s8 }); break;
            case 0xc4: t.bend = s8; ctl.push({ ...at(t), bend: s8 / 2 }); break;
            case 0xc5: t.bendRange = arg; ctl.push({ ...at(t), bendRange: arg }); break;
            case 0xc6: t.prio = arg; break;
            case 0xc7: t.noteWait = !!arg; break;
            case 0xc8: t.tie = !!arg; releaseAll(t); break;
            case 0xc9: t.portaKey = clamp(arg + t.transpose, 0, 127); t.porta = true; break;
            case 0xca: t.mod.depth = arg; ctl.push({ ...at(t), mod: arg }); break;
            case 0xcb: t.mod.speed = arg; break;
            case 0xcc: t.mod.type = arg; break;
            case 0xcd: t.mod.range = arg; break;
            case 0xce: t.porta = !!arg; break;
            case 0xcf: t.portaTime = arg; break;
            case 0xd0: t.adsr[0] = arg; break;
            case 0xd1: t.adsr[1] = arg; break;
            case 0xd2: t.adsr[2] = arg; break;
            case 0xd3: t.adsr[3] = arg; break;
            case 0xd4: if (t.stack.length < 3) t.stack.push({ pos: t.pos, count: arg, call: false }); break;
            case 0xd5: t.vol2 = arg; ctl.push({ ...at(t), expr: arg }); break;
            case 0xd6: break;
            case 0xd7: t.mute = arg; if (arg >= 2) releaseAll(t); break;
            default: throw new Error(`${label}: unknown command 0x${cmd.toString(16)} at 0x${cmdPos.toString(16)}`);
          }
          break;
        }
        case 0xe0: {
          const arg = rdArg(t, 's16', special);
          if (!run) break;
          if (cmd === 0xe0) t.mod.delay = arg;
          else if (cmd === 0xe1) { player.tempo = arg; tempos.push({ tick48: tick, frame: curFrame(), tempo: arg }); }
          else if (cmd === 0xe3) t.sweep = arg;
          else throw new Error(`${label}: unknown command 0x${cmd.toString(16)} at 0x${cmdPos.toString(16)}`);
          break;
        }
        case 0xf0: {
          if (cmd === 0xfe) { rd16(t); break; }
          if (!run) break;
          if (cmd === 0xfc) {
            if (!t.stack.length) break;
            const top = t.stack[t.stack.length - 1];
            if (top.count !== 0 && --top.count === 0) { t.stack.pop(); break; }
            if (top.count === 0) { t.jumps++; gotos.push({ track: t.idx, tick48: tick, frame: curFrame(), target: top.pos, from: cmdPos }); }
            t.pos = top.pos;
          } else if (cmd === 0xfd) {
            if (!t.stack.length) break;
            t.pos = t.stack.pop().pos;
          } else if (cmd === 0xff) return false;
          else throw new Error(`${label}: unknown command 0x${cmd.toString(16)} at 0x${cmdPos.toString(16)}`);
          break;
        }
        default: throw new Error(`${label}: unknown command 0x${cmd.toString(16)} at 0x${cmdPos.toString(16)}`);
      }
    }
    return true;
  };

  // ---- run
  let loop48 = null, ended = false;
  const firstJumps = () => {
    const per = {};
    for (const g of gotos) (per[g.track] = per[g.track] || []).push(g);
    return per;
  };
  outer: for (; update < maxUpdates; update++) {
    while (player.counter >= 240) {
      player.counter -= 240;
      tickUpdate[tick] = update;
      for (const t of tracks) if (t.active && !step(t)) close(t);
      tick++;
      const live = tracks.filter((t) => t.active);
      if (!live.length) { ended = true; break outer; }
      if (live.every((t) => t.jumps >= 2)) {
        if (!loop48) {
          const per = Object.values(firstJumps()).filter((l) => l.length >= 2);
          const endT = Math.max(...per.map((l) => l[0].tick48)), len = Math.max(...per.map((l) => l[1].tick48 - l[0].tick48));
          loop48 = { endT, len, per };
        }
        if (tick > loop48.endT + loop48.len) break outer;
      }
    }
    player.counter += player.tempo;
  }
  tickUpdate[tick] = update + (ended ? 0 : 1);
  for (let k = 0; k <= tick; k++) if (tickUpdate[k] === undefined) tickUpdate[k] = tickUpdate[k - 1];
  const tf48 = (k) => frameOf(tickUpdate[Math.min(k, tick)]);

  // ---- the loop (m4a_trace.mjs semantics, in 48ths first)
  let loop = null, end48;
  const per = Object.values(firstJumps()).filter((l) => l.length >= 2);
  if (per.length) {
    const endT = Math.max(...per.map((l) => l[0].tick48));
    const lens = per.map((l) => l[1].tick48 - l[0].tick48), len = Math.max(...lens);
    const T = (k) => Math.floor(k / div);
    loop = {
      endTick: T(endT), startTick: T(endT - len), lenTicks: T(endT) - T(endT - len),
      consistent: lens.every((x) => x === len) && per.every((l) => l[0].tick48 === endT),
      endTick48: endT, startTick48: endT - len, lenTicks48: len,
      startFrame: tf48(endT - len), endFrame: tf48(endT), secondPassFrames: tf48(endT + len) - tf48(endT),
      tracks: per.map((l) => l[0].track),
    };
    end48 = endT;
  } else end48 = ended ? Math.max(0, ...tracks.filter((t) => t.closedAt !== undefined).map((t) => t.closedAt)) : tick; // the tick the last track ended in
  // a track that ended before its notes did, or notes still sounding: they end at the song's end
  const endTick = Math.floor(end48 / div);
  const tickFrame = [];
  for (let k = 0; k <= endTick; k++) tickFrame[k] = tf48(k * div);
  const keep = [];
  for (const n of notes) {
    if (n.tick48 >= end48) continue;
    if (n.endTick48 === null || n.endTick48 > end48) n.endTick48 = end48;
    n.tick = Math.floor(n.tick48 / div);
    n.endTick = Math.max(n.tick + 1, Math.floor(n.endTick48 / div));
    if (n.endTick > endTick) n.endTick = Math.max(endTick, n.tick + 1);
    n.gate = Math.round(n.gate / div);
    n.endFrame = tf48(n.endTick48);
    delete n.rem;
    keep.push(n);
  }
  // tempo changes (no-change repeats dropped); one at tick 0 if the song never sets it before its first tick
  const tout = [];
  let last = null;
  if (!tempos.length || tempos[0].tick48 > 0) { tout.push({ tick: 0, frame: 0, bpm: 120 * BPM_SCALE * (div === 1 ? 2 : 1), tempo: 120 }); last = 120; }
  for (const x of tempos) {
    if (x.tempo === last) continue;
    last = x.tempo;
    const o = { tick: Math.floor(x.tick48 / div), tick48: x.tick48, frame: x.frame, bpm: +(x.tempo * BPM_SCALE * (div === 1 ? 2 : 1)).toFixed(4), tempo: x.tempo };
    if (tout.length && tout[tout.length - 1].tick === o.tick) tout[tout.length - 1] = o; else tout.push(o);
  }
  return {
    song: label, header: seq.id, trackCount: tracks.filter((t) => t.alloc && (t.active || t.closedAt !== undefined)).length,
    reverb: 0, cfg: { bank: bankId, vol: seq.vol, player: seq.player, cpr: seq.cpr, ppr: seq.ppr },
    ticksPerQuarter: TPQ, tempos: tout.filter((x) => x.tick < Math.max(1, endTick)), loop, endTick, endFrame: tickFrame[endTick], tickFrame,
    notes: keep, ctl: ctl.filter((c) => c.tick48 < end48).map((c) => ({ ...c, tick: Math.floor(c.tick48 / div) })),
    ended, gotos, stats,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  const verbose = args.includes('-v');
  for (const song of args.filter((a) => !a.startsWith('-'))) {
    const t = traceSseq(song);
    const L = t.loop;
    console.log(`${song}: ${t.trackCount} tracks, tempo ${t.tempos.map((x) => `${x.tempo}@${x.tick}`).join(' ')}, ` +
      (L ? `loop ${L.startTick}-${L.endTick} ticks = frames ${L.startFrame}-${L.endFrame} (${((L.endFrame - L.startFrame) / GB_HZ).toFixed(2)} s, 2nd pass ${L.secondPassFrames} f = ${(L.secondPassFrames / GB_HZ).toFixed(2)} s, consistent ${L.consistent})`
        : `no loop, ends at tick ${t.endTick} = frame ${t.endFrame} (${(t.endFrame / GB_HZ).toFixed(2)} s)`) + `, ${t.notes.length} notes`);
    const by = {};
    for (const n of t.notes) {
      const o = by[n.track] = by[n.track] || { n: 0, keys: [], progs: new Set(), kinds: {}, vel: 0, vol: 0, odd: 0 };
      o.n++; o.keys.push(n.key + n.keyM); o.progs.add(n.prog); o.kinds[n.name.kind] = (o.kinds[n.name.kind] || 0) + 1;
      o.vel += n.velRaw; o.vol += n.volRaw; if (n.tick48 & 1) o.odd++;
    }
    for (const [k, o] of Object.entries(by)) {
      o.keys.sort((a, b) => a - b);
      console.log(`  tr${k}: ${o.n} notes, keys ${o.keys[0]}-${o.keys[o.keys.length - 1]} med ${o.keys[o.keys.length >> 1]}, prog ${[...o.progs]}, vel ${(o.vel / o.n).toFixed(0)}, vol ${(o.vol / o.n).toFixed(0)}${o.odd ? `, ${o.odd} on odd 48ths` : ''} | ${Object.entries(o.kinds).map(([a, b]) => `${a} ${b}`).join(', ')}`);
    }
    if (verbose) {
      const seen = new Map();
      for (const n of t.notes) if (n.rhythm) { const k = `${n.prog}:${n.key}`; if (!seen.has(k)) seen.set(k, { n: n.name, c: 0 }); seen.get(k).c++; }
      for (const [k, v] of [...seen].sort()) console.log(`    drum ${k} x${v.c}: ${v.n.kind} (${v.n.how})${v.n.features ? ` dur ${v.n.features.dur.toFixed(2)} zcr ${v.n.features.zcr.toFixed(0)} low ${v.n.features.low.toFixed(2)} dec ${v.n.features.decay20.toFixed(2)}${v.n.features.loop ? ' loop' : ''}` : ''}`);
    }
  }
}
