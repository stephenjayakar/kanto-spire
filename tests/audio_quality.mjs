// Audio quality check for the m4a engine: renders a few songs offline (EngineHost, like the worklet)
// in 'gba' and 'hq' quality to tests/out/audio/*.wav and reports peaks / clipping, high-frequency
// (alias) energy and CPU cost. 'gba' must stay bit-identical to the reference hashes in
// tests/audio_gba_ref.json (recorded before HQ mode existed).
//   node tests/audio_quality.mjs            verify + render + report (exit 1 if a gba hash changed)
//   node tests/audio_quality.mjs --record   (re)record the gba reference hashes
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { EngineHost } from '../web/src/audio/m4a-core.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'tests/out/audio');
const REF = path.join(ROOT, 'tests/audio_gba_ref.json');
const RATE = 48000, SECONDS = 12, BLOCK = 128;
const bankJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'web/assets/sound/bank.json'), 'utf8'));
const bankBin = fs.readFileSync(path.join(ROOT, 'web/assets/sound/bank.bin'));
// mus_vs_champion = CHAMPION BLUE, mus_vs_gym_leader = the ELITE FOUR (LANCE) and gym leaders
const SONGS = ['mus_vs_champion', 'mus_vs_gym_leader', 'mus_vs_wild', 'mus_route1'];
const record = process.argv.includes('--record');
fs.mkdirSync(OUT, { recursive: true });

function render(name, quality) {
  const host = new EngineHost(() => {}, RATE);
  const bank = new Uint8Array(bankBin).buffer.slice(0);
  const init = { type: 'init', bank, meta: { segments: bankJson.segments, cryTable: bankJson.cryTable, cryTableReverse: bankJson.cryTableReverse }, stereo: true, interpolation: 'hold' };
  if (quality) init.quality = quality;
  host.onMessage(init);
  const s = bankJson.songs[name];
  host.onMessage({ type: 'start', player: s.player, header: s.header, tag: 1, mode: 'start' });
  const n = RATE * SECONDS, L = new Float32Array(n), R = new Float32Array(n);
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < n; i += BLOCK) host.process(L.subarray(i, i + BLOCK), R.subarray(i, i + BLOCK), Math.min(BLOCK, n - i));
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  return { L, R, ms, eng: host.engine };
}

const hash = (L, R) => crypto.createHash('sha256').update(Buffer.from(L.buffer)).update(Buffer.from(R.buffer)).digest('hex').slice(0, 16);

function writeWav(file, L, R) {
  const n = L.length, buf = Buffer.alloc(44 + n * 4);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write('WAVE', 8); buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(RATE, 24);
  buf.writeUInt32LE(RATE * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(L[i] * 32767))), 44 + i * 4);
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(R[i] * 32767))), 46 + i * 4);
  }
  fs.writeFileSync(file, buf);
}

// Energy above `hz` as a fraction of the total (mono mix, 2048-point FFT frames, Hann window).
function hfRatio(L, R, hz) {
  const N = 2048, win = new Float64Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N);
  let hi = 0, tot = 0;
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let off = 0; off + N <= L.length; off += N * 4) {
    for (let i = 0; i < N; i++) { re[i] = (L[off + i] + R[off + i]) * 0.5 * win[i]; im[i] = 0; }
    fft(re, im);
    for (let k = 1; k < N / 2; k++) { const e = re[k] * re[k] + im[k] * im[k]; tot += e; if (k * RATE / N >= hz) hi += e; }
  }
  return tot ? hi / tot : 0;
}
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= n; len <<= 1) {
    const a = -2 * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let j = 0; j < len / 2; j++) {
        const ur = re[i + j], ui = im[i + j], vr = re[i + j + len / 2] * cr - im[i + j + len / 2] * ci, vi = re[i + j + len / 2] * ci + im[i + j + len / 2] * cr;
        re[i + j] = ur + vr; im[i + j] = ui + vi; re[i + j + len / 2] = ur - vr; im[i + j + len / 2] = ui - vi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}
function stats(L, R) {
  let peak = 0, clip = 0, sum = 0;
  for (const X of [L, R]) for (let i = 0; i < X.length; i++) { const a = Math.abs(X[i]); if (a > peak) peak = a; if (a >= 0.999) clip++; sum += X[i] * X[i]; }
  return { peak: +peak.toFixed(3), clip, rms: +Math.sqrt(sum / (L.length * 2)).toFixed(4) };
}

const ref = fs.existsSync(REF) ? JSON.parse(fs.readFileSync(REF, 'utf8')) : {};
let bad = 0;
const rec = {};
for (const name of SONGS) {
  for (const q of record ? [null] : ['gba', 'hq']) {
    const { L, R, ms, eng } = render(name, q);
    const h = hash(L, R);
    if (record) { rec[name] = h; console.log('recorded', name, h); continue; }
    writeWav(path.join(OUT, `${name}_${q}.wav`), L, R);
    const st = stats(L, R);
    const line = `${name.padEnd(18)} ${q.padEnd(3)} peak ${st.peak} clipped ${st.clip} rms ${st.rms} engine-clip ${eng.peakClip}${q === "hq" ? ` would-wrap(8-bit) ${eng.ringOver}` : ""} HF>10k ${(100 * hfRatio(L, R, 10000)).toFixed(2)}% HF>6k ${(100 * hfRatio(L, R, 6000)).toFixed(2)}% cpu ${(ms / SECONDS).toFixed(1)} ms per s of audio`;
    if (q === 'gba') {
      const ok = ref[name] === h;
      if (!ok) bad++;
      console.log(`${line}  gba hash ${h} ${ok ? '== reference' : `!= reference ${ref[name]}`}`);
    } else console.log(line);
  }
}
if (record) fs.writeFileSync(REF, JSON.stringify(rec, null, 1) + '\n');
else console.log(bad ? `FAIL: ${bad} gba render(s) changed` : 'gba renders identical to the reference; WAVs in tests/out/audio/');
process.exit(bad ? 1 : 0);
