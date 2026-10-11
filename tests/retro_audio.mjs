// Offline checks for the RETRO music engine (web/src/audio/gb-core.js), all in Node, nothing played aloud.
//   node tests/retro_audio.mjs [--pret <dir with pokered/ and pokegold/ clones>]
// Needs web/assets/retro (tools/extract_retro_music.mjs) and, for the m4a comparison, web/assets/sound.
//  1. every song in the retro bank runs 30 s without errors and makes sound (and the jingles end);
//  2. tempo: each channel's measured loop length (frames between two passes of its infinite loop) matches the
//     length computed independently from pret's disassembly text (note lengths x note_type speed x tempo / 256);
//  3. pitch: the first melody notes of a few songs, detected in the rendered audio (channel 1 alone), match the
//     notes written in the disassembly within 35 cents;
//  4. loudness: RETRO's level next to the GBA music's and the console render's;
//  5. renders listening samples to tests/out/retro/ (RETRO songs, and one song in all three AUDIO modes);
//  6. the AudioWorklet wrapper;
//  7. the HQ render (the game's) against the console's own output stage ('dmg'): the same note timing per channel,
//     the same pitch (section 3 measures both), the same loop and no click where it jumps back, all three mixes
//     (A/B/C) at matched loudness, the mix switching while playing, CPU per second of audio.
// Sections 1-6 use the HQ render, like the game.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GbPlayer, RedEngine, GscEngine, RETRO_MIXES } from '../web/src/audio/gb-core.js';
import { EngineHost } from '../web/src/audio/m4a-core.js';
import { RETRO_SONG_SET, EMERALD, retroSong } from '../web/src/audio/retro.js';
import { HOENN_SONG_SET } from '../web/src/audio/emerald.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'tests/out/retro');
const args = process.argv.slice(2);
const PRET = args.includes('--pret') ? args[args.indexOf('--pret') + 1] : (process.env.PRET_DIR || 'E:/BigData/games/gb/pret');
const SR = 48000, FRAME_HZ = 4194304 / 70224;
fs.mkdirSync(OUT, { recursive: true });

const dir = path.join(ROOT, 'web/assets/retro');
const meta = JSON.parse(fs.readFileSync(path.join(dir, 'retro.json'), 'utf8'));
const bin = (f) => { const b = fs.readFileSync(path.join(dir, f)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); };
const binaries = { red: bin('red.bin'), silver: bin('silver.bin') };
let failures = 0;
const fail = (m) => { console.log('  FAIL ' + m); failures++; };

function player(opts) { const p = new GbPlayer(SR, () => {}, opts); p.load(meta, binaries); return p; }
const DMG = { render: 'dmg' };
function render(p, seconds) {
  const n = Math.round(SR * seconds), L = new Float32Array(n), R = new Float32Array(n);
  for (let o = 0; o < n; o += 128) p.process(L.subarray(o, Math.min(n, o + 128)), R.subarray(o, Math.min(n, o + 128)), Math.min(128, n - o));
  return { L, R };
}
function writeWav(file, L, R) {
  const n = L.length, buf = Buffer.alloc(44 + n * 4);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write('WAVE', 8); buf.write('fmt ', 12); buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32);
  buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(L[i] * 32767))), 44 + i * 4);
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(R[i] * 32767))), 46 + i * 4);
  }
  fs.writeFileSync(file, buf);
}
const rms = (L, R) => { let s = 0; for (let i = 0; i < L.length; i++) s += L[i] * L[i] + R[i] * R[i]; return Math.sqrt(s / (2 * L.length)); };
const peak = (L, R) => { let m = 0; for (let i = 0; i < L.length; i++) m = Math.max(m, Math.abs(L[i]), Math.abs(R[i])); return m; };

// ---- 1. every song runs -----------------------------------------------------------------------------------------
console.log('1. every song in the bank');
{
  let ok = 0;
  for (const name of Object.keys(meta.songs)) {
    const p = player();
    let ended = false;
    p.emit = (m) => { if (m.type === 'end') ended = true; };
    try {
      if (meta.songs[name].sfx) p.playFanfare(name); else p.playBgm(name);
      const { L, R } = render(p, meta.songs[name].sfx ? 12 : 30);
      const r = rms(L, R), pk = peak(L, R);
      if (!(r > 0.003)) fail(`${name}: silent (rms ${r})`);
      else if (!Number.isFinite(pk) || pk > 1.2) fail(`${name}: peak ${pk}`);
      else if (meta.songs[name].sfx && !ended) fail(`${name}: jingle never ended`);
      else ok++;
    } catch (e) { fail(`${name}: ${e.stack}`); }
  }
  console.log(`  ${ok}/${Object.keys(meta.songs).length} songs OK`);
  for (const s of RETRO_SONG_SET) if (!meta.songs[s]) fail(`mapping uses ${s}, which is not in the bank`);
  console.log(`  the mapping (audio/retro.js) uses ${RETRO_SONG_SET.size} songs, all in the bank`);
  for (const em of HOENN_SONG_SET) if (!EMERALD[em]) fail(`no Game Boy song for Emerald's ${em}`);
  // every song name the game's code and data ask for has a Game Boy song in every region
  const names = new Set();
  const scan = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name);
    if (e.isDirectory()) { if (e.name !== 'legacy') scan(f); } else if (/\.js$/.test(e.name)) for (const m of fs.readFileSync(f, 'utf8').matchAll(/\b(?:mus|MUS)_[A-Za-z0-9_]+/g)) names.add(m[0].toLowerCase()); } };
  scan(path.join(ROOT, 'web/src/game')); scan(path.join(ROOT, 'web/src/scenes'));
  const missing = [];
  for (const region of ['kanto', 'johto', 'hoenn']) {
    const act = { id: 2, region, music: ['mus_route24'], townMusic: 'mus_celadon' };
    for (const n of names) if (!/^mus_[a-z]/.test(n) || n === 'mus_') continue; else if (!retroSong(act, n) && !retroSong(act, n, { kind: 'trainer', trainer: {}, music: 'mus_vs_trainer' })) missing.push(region + ':' + n);
  }
  if (missing.length) fail('no Game Boy song for ' + missing.join(', '));
  else console.log(`  all ${names.size} song names in the game's code have a Game Boy song in KANTO, JOHTO and HOENN acts`);
}

// ---- 2. tempo: loop lengths vs the disassembly ----------------------------------------------------------------------
// A tiny reader for pret's music .asm: follows sound_call / sound_loop and adds up note durations.
function asmChannels(file) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  const labels = {}, code = [];
  let global = '';
  for (const raw of lines) {
    const l = raw.replace(/;.*/, '').trim();
    if (!l) continue;
    let m = /^([A-Za-z_][\w]*)::?$/.exec(l);
    if (m) { global = m[1]; labels[global] = code.length; continue; }
    m = /^(\.[\w]+):?$/.exec(l);
    if (m) { labels[global + m[1]] = code.length; continue; }
    const [op, ...rest] = l.split(/\s+/);
    code.push({ op, args: rest.join(' ').split(',').map((s) => s.trim()).filter(Boolean), scope: global });
  }
  return { labels, code };
}
function asmLoopFrames(file, chLabel, gsc) {
  const { labels, code } = asmChannels(file);
  const resolve = (name, scope) => labels[name.startsWith('.') ? scope + name : name];
  let pc = labels[chLabel], speed = 1, tempo = null, t = 0;
  const stack = [], loops = new Map(), hits = [];
  // the song's tempo is set by its first channel: find it
  for (let i = 0; i < code.length && tempo === null; i++) if (code[i].op === 'tempo') tempo = +code[i].args[0];
  for (let guard = 0; guard < 200000 && hits.length < 3; guard++) {
    const ins = code[pc++];
    if (!ins) break;
    const a = ins.args;
    switch (ins.op) {
      case 'tempo': tempo = +a[0]; break;
      case 'note_type': case 'drum_speed': speed = +a[0]; break;
      case 'note': case 'drum_note': case 'drum_note_short': t += (+a[1]) * speed * tempo / 256; break;
      case 'rest': t += (+a[0]) * speed * tempo / 256; break;
      case 'sound_call': stack.push(pc); pc = resolve(a[0], ins.scope); break;
      case 'sound_ret': if (!stack.length) return null; pc = stack.pop(); break;
      case 'sound_jump': hits.push(t); pc = resolve(a[0], ins.scope); break;
      case 'sound_loop': {
        const n = +a[0];
        if (n === 0) { hits.push(t); pc = resolve(a[1], ins.scope); break; }
        const k = loops.get(pc) || 1;
        if (k === n) loops.set(pc, 1); else { loops.set(pc, k + 1); pc = resolve(a[1], ins.scope); }
        break;
      }
      default: break;
    }
  }
  return hits.length >= 2 ? hits[1] - hits[0] : null;
}
function measuredLoopFrames(name) {
  const p = player();
  const hits = [[], [], [], []];
  p.playBgm(name);
  const e = p.bgm.engine;
  e.onLoop = (c) => { if (c < 4) hits[c].push(p.frames); };
  const alive = (i) => (e instanceof RedEngine ? !!e.ids[i] : e.ch[i].on);
  const done = () => [0, 1, 2, 3].every((i) => hits[i].length >= 2 || !alive(i));
  for (let f = 0; f < 60 * 60 * 6 && !done(); f++) p.frame();
  return hits.map((h) => (h.length >= 2 ? h[1] - h[0] : null));
}
console.log('2. tempo: loop length per channel, engine vs disassembly');
const LOOP_SONGS = [
  ['red:Routes1', 'pokered/audio/music/routes1.asm', 'Music_Routes1_Ch'],
  ['red:PalletTown', 'pokered/audio/music/pallettown.asm', 'Music_PalletTown_Ch'],
  ['red:WildBattle', 'pokered/audio/music/wildbattle.asm', 'Music_WildBattle_Ch'],
  ['red:Pokecenter', 'pokered/audio/music/pokecenter.asm', 'Music_Pokecenter_Ch'],
  ['silver:Route29', 'pokegold/audio/music/route29.asm', 'Music_Route29_Ch'],
  ['silver:JohtoWildBattle', 'pokegold/audio/music/johtowildbattle.asm', 'Music_JohtoWildBattle_Ch'],
  ['silver:NewBarkTown', 'pokegold/audio/music/newbarktown.asm', 'Music_NewBarkTown_Ch'],
];
const loopReport = [];
if (!fs.existsSync(PRET)) console.log(`  (skipped: no pret clones at ${PRET}; pass --pret <dir>)`);
else for (const [name, file, prefix] of LOOP_SONGS) {
  const f = path.join(PRET, file);
  if (!fs.existsSync(f)) { console.log(`  (skipped ${name}: ${file} missing)`); continue; }
  const got = measuredLoopFrames(name);
  const parts = [];
  for (let c = 0; c < 4; c++) {
    const want = asmLoopFrames(f, prefix + (c + 1), name.startsWith('silver'));
    if (want === null && got[c] === null) continue;
    parts.push(`ch${c + 1} ${got[c]}/${want === null ? '-' : want.toFixed(1)}`);
    if (want === null || got[c] === null || Math.abs(got[c] - want) > 1.01) fail(`${name} ch${c + 1}: engine ${got[c]} frames, disassembly ${want}`);
  }
  const secs = Math.max(...got.filter(Boolean)) / FRAME_HZ;
  loopReport.push([name, secs]);
  console.log(`  ${name.padEnd(24)} loop ${secs.toFixed(2)} s   (frames engine/asm: ${parts.join(', ')})`);
}

// ---- 3. pitch: melody notes in the audio vs the disassembly ------------------------------------------------------
const NOTE_IDX = { C_: 0, 'C#': 1, D_: 2, 'D#': 3, E_: 4, F_: 5, 'F#': 6, G_: 7, 'G#': 8, A_: 9, 'A#': 10, B_: 11 };
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
function asmMelody(file, chLabel, count) {
  const { labels, code } = asmChannels(file);
  const resolve = (name, scope) => labels[name.startsWith('.') ? scope + name : name];
  let pc = labels[chLabel], octave = 4;
  const out = [], stack = [];
  for (let guard = 0; guard < 5000 && out.length < count; guard++) {
    const ins = code[pc++];
    if (!ins) break;
    if (ins.op === 'octave') octave = +ins.args[0];
    else if (ins.op === 'note') out.push(12 * (octave + 2) + NOTE_IDX[ins.args[0]]); // GB octave 4 = C5
    else if (ins.op === 'rest') out.push(null);
    else if (ins.op === 'sound_call') { stack.push(pc); pc = resolve(ins.args[0], ins.scope); }
    else if (ins.op === 'sound_ret') pc = stack.pop();
    else if (ins.op === 'sound_loop' && +ins.args[0] === 0) pc = resolve(ins.args[1], ins.scope);
  }
  return out;
}
function detectF0(x) {                               // normalized autocorrelation, parabolic peak
  const n = x.length, lo = Math.floor(SR / 2000), hi = Math.floor(SR / 60);
  let mean = 0; for (const v of x) mean += v; mean /= n;
  const y = x.map((v) => v - mean);
  let best = -1, bestLag = 0;
  const r = new Float64Array(hi + 2);
  for (let lag = lo; lag <= hi + 1; lag++) {
    let s = 0, e1 = 0, e2 = 0;
    for (let i = 0; i + lag < n; i++) { s += y[i] * y[i + lag]; e1 += y[i] * y[i]; e2 += y[i + lag] * y[i + lag]; }
    r[lag] = s / Math.sqrt(e1 * e2 + 1e-12);
  }
  for (let lag = lo + 1; lag <= hi; lag++) if (r[lag] > r[lag - 1] && r[lag] >= r[lag + 1] && r[lag] > best * 1.0001) {
    if (r[lag] > 0.85 * Math.max(...r.slice(lo, hi + 1))) { best = r[lag]; bestLag = lag; break; } // first strong peak
  }
  if (!bestLag) return null;
  const a = r[bestLag - 1], b = r[bestLag], c = r[bestLag + 1];
  const d = (a - c) / (2 * (a - 2 * b + c));
  return SR / (bestLag + (Number.isFinite(d) ? d : 0));
}
console.log('3. pitch: first melody notes (channel 1 alone), audio vs disassembly');
const PITCH_SONGS = [
  ['red:Routes1', 'pokered/audio/music/routes1.asm', 'Music_Routes1_Ch1'],
  ['red:PalletTown', 'pokered/audio/music/pallettown.asm', 'Music_PalletTown_Ch1'],
  ['silver:Route29', 'pokegold/audio/music/route29.asm', 'Music_Route29_Ch1'],
];
const pitchReport = [];
// the first melody notes' F0 (channel 1 alone) in the render opts picks: [{ k, f0, frame }] by note index
function melodyF0(name, opts, count) {
  const p = player(opts);
  const trig = [];
  p.apu.onTrigger = (i, freq) => { if (i === 0 && (p.apu.reg[2] >> 4) > 0) trig.push({ frame: p.frames, freq }); };
  p.playBgm(name);
  p.apu.ch[1].muted = p.apu.ch[2].muted = p.apu.ch[3].muted = true;
  const n = SR * 12, L = new Float32Array(n), R = new Float32Array(n);
  for (let o = 0; o < n; o += 128) p.process(L.subarray(o, o + 128), R.subarray(o, o + 128), 128);
  const spf = SR / FRAME_HZ, out = [];
  for (let k = 0; k < Math.min(count, trig.length - 1, 12); k++) {
    // the frame's samples come out after the frame is run: note k sounds from frame trig[k].frame
    const s0 = Math.round((trig[k].frame - 1) * spf + 0.03 * SR), s1 = Math.min(Math.round((trig[k + 1].frame - 1) * spf), s0 + Math.round(0.12 * SR));
    if (s1 - s0 < SR * 0.02) continue;
    const f0 = detectF0(Array.from(L.subarray(s0, s1), (v, i) => v + R[s0 + i])); // (L+R: some melodies are panned to one side)
    if (f0) out.push({ k, f0, frame: trig[k].frame });
  }
  return out;
}
let hqVsDmgWorst = 0;
if (fs.existsSync(PRET)) for (const [name, file, label] of PITCH_SONGS) {
  const f = path.join(PRET, file);
  if (!fs.existsSync(f)) continue;
  const want = asmMelody(f, label, 16).filter((m) => m !== null);
  const hq = melodyF0(name, undefined, want.length), dmg = melodyF0(name, DMG, want.length);
  const rows = [];
  let worst = 0, matched = 0;
  for (const { k, f0, frame } of hq) {
    const midi = 69 + 12 * Math.log2(f0 / 440), cents = (midi - want[k]) * 100;
    worst = Math.max(worst, Math.abs(cents)); matched++;
    rows.push(`${NAMES[want[k] % 12]}${Math.floor(want[k] / 12) - 1} ${f0.toFixed(1)}Hz ${cents >= 0 ? '+' : ''}${cents.toFixed(0)}c`);
    if (Math.abs(cents) > 35) fail(`${name} note ${k + 1}: expected ${NAMES[want[k] % 12]}${Math.floor(want[k] / 12) - 1}, heard ${f0.toFixed(1)} Hz (${cents.toFixed(0)} cents)`);
    // the HQ render against the console's: the note starts on the same frame, at the same pitch
    const d = dmg.find((x) => x.k === k);
    if (!d || d.frame !== frame) fail(`${name} note ${k + 1}: the HQ and console renders start it on different frames`);
    else {
      const dc = Math.abs(1200 * Math.log2(f0 / d.f0));
      hqVsDmgWorst = Math.max(hqVsDmgWorst, dc);
      if (dc > 5) fail(`${name} note ${k + 1}: HQ ${f0.toFixed(1)} Hz vs console ${d.f0.toFixed(1)} Hz (${dc.toFixed(1)} cents)`);
    }
  }
  if (matched < 6) fail(`${name}: only ${matched} melody notes measured`);
  pitchReport.push([name, rows]);
  console.log(`  ${name.padEnd(16)} worst ${worst.toFixed(0)} cents: ${rows.join(' | ')}`);
}
if (pitchReport.length) console.log(`  HQ vs console render: the same note frames, worst pitch difference ${hqVsDmgWorst.toFixed(1)} cents`);

// ---- 4 + 5. loudness and listening samples ----------------------------------------------------------------------
console.log('4. loudness and samples (tests/out/retro/)');
function renderM4a(name, quality, seconds) {
  const bankJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'web/assets/sound/bank.json'), 'utf8'));
  const bankBin = fs.readFileSync(path.join(ROOT, 'web/assets/sound/bank.bin'));
  const host = new EngineHost(() => {}, SR);
  host.onMessage({ type: 'init', bank: new Uint8Array(bankBin).buffer.slice(0), meta: { segments: bankJson.segments, cryTable: bankJson.cryTable, cryTableReverse: bankJson.cryTableReverse }, stereo: true, interpolation: 'hold', quality });
  const s = bankJson.songs[name];
  host.onMessage({ type: 'start', player: s.player, header: s.header, tag: 1, mode: 'start' });
  const n = SR * seconds, L = new Float32Array(n), R = new Float32Array(n);
  for (let i = 0; i < n; i += 128) host.process(L.subarray(i, i + 128), R.subarray(i, i + 128), Math.min(128, n - i));
  return { L, R };
}
const SAMPLES = [
  ['red:TitleScreen', 40], ['red:Routes1', 60], ['red:PalletTown', 45], ['red:Pokecenter', 30], ['red:WildBattle', 45],
  ['red:TrainerBattle', 45], ['red:GymLeaderBattle', 45], ['red:FinalBattle', 45], ['red:Dungeon3', 40], ['red:PokemonTower', 40],
  ['silver:Route29', 45], ['silver:NewBarkTown', 40], ['silver:JohtoWildBattle', 45], ['silver:JohtoTrainerBattle', 45],
  ['silver:ChampionBattle', 45], ['silver:GoldenrodCity', 40],
];
const levels = [], dmgLevels = [];
for (const [name, secs] of SAMPLES) {
  const p = player();
  p.playBgm(name);
  const { L, R } = render(p, secs);
  levels.push(rms(L, R));
  writeWav(path.join(OUT, `retro_${name.replace(':', '_')}.wav`), L, R);
  const q = player(DMG); q.playBgm(name); const d = render(q, secs); dmgLevels.push(rms(d.L, d.R));
}
// one song in all three AUDIO modes: HQ (m4a, full-precision mixer), GBA (m4a, the console's mixer), RETRO (Red)
let m4aLevel = null;
if (fs.existsSync(path.join(ROOT, 'web/assets/sound/bank.json'))) {
  const hq = renderM4a('mus_route1', 'hq', 45), gba = renderM4a('mus_route1', 'gba', 45);
  writeWav(path.join(OUT, 'compare_route1_1_HQ.wav'), hq.L, hq.R);
  writeWav(path.join(OUT, 'compare_route1_2_GBA.wav'), gba.L, gba.R);
  const p = player(); p.playBgm('red:Routes1'); const rt = render(p, 45);
  writeWav(path.join(OUT, 'compare_route1_3_RETRO.wav'), rt.L, rt.R);
  const vs = renderM4a('mus_vs_wild', 'hq', 30);
  m4aLevel = (rms(hq.L, hq.R) + rms(vs.L, vs.R)) / 2;
}
const retroLevel = levels.reduce((a, b) => a + b, 0) / levels.length, dmgLevel = dmgLevels.reduce((a, b) => a + b, 0) / dmgLevels.length;
const dB = (x) => (20 * Math.log10(x)).toFixed(1);
console.log(`  RETRO mean RMS ${dB(retroLevel)} dBFS (console render ${dB(dmgLevel)})` + (m4aLevel ? `, GBA music ${dB(m4aLevel)} dBFS (player gain applied: ${new GbPlayer(SR).gain})` : ''));
if (Math.abs(20 * Math.log10(retroLevel / dmgLevel)) > 1) fail(`HQ render ${dB(retroLevel)} dBFS vs the console render ${dB(dmgLevel)} dBFS`);
if (m4aLevel && Math.abs(20 * Math.log10(retroLevel / m4aLevel)) > 3) fail(`RETRO ${dB(retroLevel)} dBFS vs the GBA music ${dB(m4aLevel)} dBFS`);
console.log(`  wrote ${SAMPLES.length + 3} WAVs to ${path.relative(ROOT, OUT)}`);

// ---- 6. the AudioWorklet wrapper, in a stand-in AudioWorkletGlobalScope -------------------------------------------
console.log('6. gb-worklet.js in a stub AudioWorkletGlobalScope');
{
  let Proc = null;
  globalThis.sampleRate = SR;
  globalThis.AudioWorkletProcessor = class { constructor() { const ch = new MessageChannel(); this.port = ch.port1; this.outside = ch.port2; } };
  globalThis.registerProcessor = (name, cls) => { if (name === 'gb-processor') Proc = cls; };
  await import('../web/src/audio/gb-worklet.js');
  if (!Proc) fail('gb-worklet.js did not register gb-processor');
  else {
    const proc = new Proc(), got = [];
    proc.outside.onmessage = (e) => got.push(e.data);
    const red = bin('red.bin'), silver = bin('silver.bin');
    proc.outside.postMessage({ type: 'load', meta, binaries: { red, silver } }, [red, silver]);
    proc.outside.postMessage({ type: 'bgm', name: 'silver:Route29', tag: 7 });
    for (let w = 0; w < 300 && !got.some((m) => m.type === 'loaded'); w++) await new Promise((r) => setTimeout(r, 10)); // (up to 3 s)
    const L = new Float32Array(128), R = new Float32Array(128);
    let s = 0;
    for (let i = 0; i < 400; i++) { proc.process([], [[L, R]]); for (let k = 0; k < 128; k++) s += L[k] * L[k] + R[k] * R[k]; }
    proc.outside.close(); proc.port.close();
    const types = got.map((m) => m.type);
    if (!types.includes('ready') || !types.includes('loaded')) fail('worklet messages: ' + types.join(','));
    else if (!(s > 0.01)) fail('worklet rendered silence');
    else console.log(`  ok: ${types.join(', ')}; ${(400 * 128 / SR).toFixed(2)} s rendered, rms ${Math.sqrt(s / (400 * 256)).toFixed(4)}`);
  }
}

// ---- 7. the HQ render vs the console render ------------------------------------------------------------------------
console.log('7. HQ render vs the console render');
{
  // timing: each tone channel alone; the two renders' 5 ms loudness envelopes line up at lag 0
  const env = (opts, name, solo, secs = 20, hop = 240) => {
    const p = player(opts); p.playBgm(name);
    for (let c = 0; c < 4; c++) p.apu.ch[c].muted = c !== solo;
    const { L, R } = render(p, secs), e = [];
    for (let o = 0; o + hop <= L.length; o += hop) { let s = 0; for (let i = o; i < o + hop; i++) s += L[i] * L[i] + R[i] * R[i]; e.push(Math.sqrt(s / hop)); }
    return e;
  };
  const corr = (a, b) => {
    const n = Math.min(a.length, b.length); let ma = 0, mb = 0; for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; } ma /= n; mb /= n;
    let s = 0, ea = 0, eb = 0; for (let i = 0; i < n; i++) { s += (a[i] - ma) * (b[i] - mb); ea += (a[i] - ma) ** 2; eb += (b[i] - mb) ** 2; }
    return s / Math.sqrt(ea * eb + 1e-20);
  };
  const parts = [];
  for (const [name, chans] of [['red:Routes1', [0, 1]], ['red:PalletTown', [0, 1]], ['red:WildBattle', [0, 1, 2]], ['silver:Route29', [0, 1]], ['silver:JohtoTrainerBattle', [0, 1]]]) {
    for (const c of chans) {
      const a = env(DMG, name, c), b = env(undefined, name, c);
      let best = -2, lag = 0;
      for (let d = -4; d <= 4; d++) { const r = corr(a.slice(4, a.length - 4), b.slice(4 + d, b.length - 4 + d)); if (r > best) { best = r; lag = d; } }
      parts.push(`${name.split(':')[1]} ch${c + 1} ${best.toFixed(3)}${lag ? ` @${lag * 5}ms` : ''}`);
      if (lag !== 0 || best < 0.93) fail(`${name} ch${c + 1}: HQ timing off the console render (r ${best.toFixed(3)}, lag ${lag * 5} ms)`);
    }
  }
  console.log(`  note timing per channel (envelope correlation at lag 0): ${parts.join(', ')}`);
  // the loop: the same length in both renders, and no click where the song jumps back
  const seams = [];
  for (const name of ['red:Routes1', 'silver:Route29']) {
    const lens = [undefined, DMG].map((opts) => {
      const p = player(opts); p.playBgm(name);
      const e = p.bgm.engine, hits = [];
      e.onLoop = (c) => { if (c === 0) hits.push(p.frames); };
      const n = Math.round(SR * 75), L = new Float32Array(n), R = new Float32Array(n);
      for (let o = 0; o < n && hits.length < 2; o += 128) p.process(L.subarray(o, o + 128), R.subarray(o, o + 128), 128);
      if (opts === undefined && hits.length) {
        const at = Math.round((hits[0] - 1) * SR / FRAME_HZ);
        let local = 0, all = 0;
        for (let i = 1; i < Math.min(n, at + 2 * SR); i++) {
          const d = Math.abs(L[i] - L[i - 1]) + Math.abs(R[i] - R[i - 1]);
          all = Math.max(all, d); if (Math.abs(i - at) < 0.02 * SR) local = Math.max(local, d);
        }
        seams.push(`${name.split(':')[1]} biggest step ${local.toFixed(3)} (song ${all.toFixed(3)})`);
        if (local >= all && local > 0.05) fail(`${name}: the biggest jump in the audio is at the loop point`);
      }
      return hits.length >= 2 ? hits[1] - hits[0] : null;
    });
    if (lens[0] === null || lens[0] !== lens[1]) fail(`${name}: loop ${lens[0]} frames in HQ vs ${lens[1]} in the console render`);
  }
  console.log(`  loop lengths identical; around the loop point: ${seams.join(', ')}`);
  // the three mixes render at matched loudness and switch while playing
  const mixLv = {}, cpu = {}, SONGS4 = ['red:Routes1', 'red:WildBattle', 'silver:Route29', 'silver:JohtoTrainerBattle'];
  for (const opts of [DMG, ...RETRO_MIXES.map((mix) => ({ mix }))]) {
    let s = 0, pk = 0, ms = 0;
    for (const name of SONGS4) {
      const p = player(opts); p.playBgm(name);
      const t0 = performance.now(); const { L, R } = render(p, 20); ms += performance.now() - t0;
      s += rms(L, R); pk = Math.max(pk, peak(L, R));
    }
    const key = opts.mix || 'console';
    mixLv[key] = 20 * Math.log10(s / SONGS4.length); cpu[key] = ms / (20 * SONGS4.length);
    if (!Number.isFinite(pk) || pk >= 1) fail(`${key}: peak ${pk}`);
  }
  for (const mix of RETRO_MIXES) if (Math.abs(mixLv[mix] - mixLv.console) > 1) fail(`mix ${mix} is ${(mixLv[mix] - mixLv.console).toFixed(1)} dB off the console render`);
  console.log(`  loudness: ${Object.entries(mixLv).map(([k, v]) => `${k} ${v.toFixed(1)} dBFS`).join(', ')}`);
  console.log(`  CPU per second of audio: ${Object.entries(cpu).map(([k, v]) => `${k} ${v.toFixed(2)} ms`).join(', ')}`);
  const p = player(); p.playBgm('red:Routes1'); render(p, 2);
  p.onMessage({ type: 'option', mix: 'C' }); const c = render(p, 2), atC = p.apu.mix;
  p.onMessage({ type: 'option', mix: 'nope' });
  if (atC !== 'C' || p.apu.mix !== RETRO_MIXES[0] || !(rms(c.L, c.R) > 0.01)) fail(`mix option message: ${atC}, then ${p.apu.mix}`);
  else console.log('  the mix option message switches mixes while playing (an unknown mix -> the default)');
}

console.log(failures ? `RETRO AUDIO: ${failures} FAILURE(S)` : 'RETRO AUDIO OK');
process.exit(failures ? 1 : 0);
