// Hoenn chiptune prototype: offline renders (nothing is played aloud).
//   - GSC songs (bytes assembled at $4000 of their own bank) through web/src/audio/gb-core.js GbPlayer, as an extra
//     'hoenn' game that shares Silver's engine bank (frequency table, wave samples, drum kits) with the shipped RETRO
//     data, rendered with any mix (the game ships 'C');
//   - Emerald originals through web/src/audio/m4a-core.js, the game's HQ m4a render.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GbPlayer } from '../../web/src/audio/gb-core.js';
import { emeraldEngine, loadBanks } from './m4a_trace.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const SR = 48000;
export const FRAME_HZ = 4194304 / 70224;
const RETRO = path.join(ROOT, 'web/assets/retro');

let retro = null;
function loadRetro() {
  if (retro) return retro;
  const meta = JSON.parse(fs.readFileSync(path.join(RETRO, 'retro.json'), 'utf8'));
  const silver = fs.readFileSync(path.join(RETRO, 'silver.bin'));
  retro = { meta, silver };
  return retro;
}

// songs: { name: { bytes (Uint8Array at $4000), header } }; returns a loaded GbPlayer that knows 'hoenn:<name>'
export function gscPlayer(songs, opts = { render: 'hq', mix: 'C' }) {
  const { meta, silver } = loadRetro();
  const names = Object.keys(songs);
  const sb = meta.games.silver.banks;
  const extra = names.map((_, i) => 0x40 + i);
  const bin = new Uint8Array(silver.length + extra.length * 0x4000);
  bin.set(silver, 0);
  names.forEach((n, i) => {
    if (songs[n].bytes.length > 0x4000) throw new Error(`${n}: ${songs[n].bytes.length} bytes, more than one bank`);
    bin.set(songs[n].bytes, silver.length + i * 0x4000);
  });
  const m = JSON.parse(JSON.stringify(meta));
  m.games.hoenn = { file: 'hoenn.bin', engine: 'gsc', banks: [...sb, ...extra], tables: meta.games.silver.tables };
  names.forEach((n, i) => { m.songs['hoenn:' + n] = { game: 'hoenn', bank: extra[i], header: songs[n].header }; });
  const p = new GbPlayer(SR, () => {}, opts);
  const silverBuf = silver.buffer.slice(silver.byteOffset, silver.byteOffset + silver.length);
  p.load(m, { red: null, silver: silverBuf, hoenn: bin.buffer });
  return p;
}

export function renderPlayer(p, seconds) {
  const n = Math.round(SR * seconds), L = new Float32Array(n), R = new Float32Array(n);
  for (let o = 0; o < n; o += 128) { const k = Math.min(128, n - o); p.process(L.subarray(o, o + k), R.subarray(o, o + k), k); }
  return { L, R };
}
// a shipped Silver/Red song (for reference levels)
export function retroPlayer(opts = { render: 'hq', mix: 'C' }) {
  const { meta, silver } = loadRetro();
  const red = fs.readFileSync(path.join(RETRO, 'red.bin'));
  const p = new GbPlayer(SR, () => {}, opts);
  p.load(meta, { red: red.buffer.slice(red.byteOffset, red.byteOffset + red.length), silver: silver.buffer.slice(silver.byteOffset, silver.byteOffset + silver.length) });
  return p;
}
// frame of each music channel's first and second pass through its loop (GscEngine.onLoop)
export function gscLoop(p, name, maxFrames = 60 * 60 * 6) {
  p.playBgm(name);
  const e = p.bgm.engine, hits = [[], [], [], []];
  e.onLoop = (c) => { if (c < 4) hits[c].push(p.frames); };
  for (let f = 0; f < maxFrames && ![0, 1, 2, 3].every((i) => hits[i].length >= 2 || !e.ch[i].on); f++) p.frame();
  p.stop();
  return hits;
}

export function renderEmerald(song, seconds) {
  const b = loadBanks();
  const e = emeraldEngine();
  e.startSong(0, b.em.json.songs[song].header);
  const n = Math.round(seconds * SR), L = new Float32Array(n), R = new Float32Array(n);
  for (let o = 0; o < n; o += 128) e.process(L.subarray(o), R.subarray(o), Math.min(128, n - o));
  return { L, R };
}

export function rms(L, R) { let s = 0; for (let i = 0; i < L.length; i++) s += L[i] * L[i] + R[i] * R[i]; return Math.sqrt(s / (2 * L.length)); }
export const dbfs = (x) => 20 * Math.log10(x + 1e-12);
export function fadeTail(L, R, seconds) {
  const k = Math.min(L.length, Math.round(seconds * SR));
  for (let i = 0; i < k; i++) { const g = 1 - i / k, j = L.length - k + i; L[j] *= g; R[j] *= g; }
}
export function writeWav(file, L, R, gain = 1) {
  const n = L.length, buf = Buffer.alloc(44 + n * 4);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write('WAVE', 8); buf.write('fmt ', 12); buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32);
  buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 4, 40);
  let clip = 0;
  for (let i = 0; i < n; i++) {
    const l = L[i] * gain, r = R[i] * gain;
    if (Math.abs(l) > 1 || Math.abs(r) > 1) clip++;
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(l * 32767))), 44 + i * 4);
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(r * 32767))), 46 + i * 4);
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, buf);
  return clip;
}
