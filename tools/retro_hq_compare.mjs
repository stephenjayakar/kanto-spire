// RETRO's HQ render next to the console render: listening WAVs and measurements, all offline (nothing played aloud).
//   node tools/retro_hq_compare.mjs [--seconds 40] [--calibrate]
// Writes tests/out/retrohq/<song>_0_current.wav (the console's own output stage, 'dmg'), <song>_A/_B/_C.wav (the HQ
// render's three mixes) and route1_stitched.wav (current -> A -> B -> C, 8 s each, the same song position running on),
// then prints per file: loudness (RMS dBFS), peak, the share of energy above 8 kHz, note-onset clicks (high-frequency
// energy right at the notes' starts), timing vs the console render, mono compatibility, loop seams and CPU time.
// --calibrate: mean loudness of the 16 songs tests/retro_audio.mjs renders, per mix, and the trim each would need.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GbPlayer, RedEngine, RETRO_MIXES } from '../web/src/audio/gb-core.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'tests/out/retrohq');
const args = process.argv.slice(2);
const SECS = args.includes('--seconds') ? +args[args.indexOf('--seconds') + 1] : 40;
const SR = 48000, FRAME_HZ = 4194304 / 70224, SPF = SR / FRAME_HZ;
fs.mkdirSync(OUT, { recursive: true });
const dir = path.join(ROOT, 'web/assets/retro');
const meta = JSON.parse(fs.readFileSync(path.join(dir, 'retro.json'), 'utf8'));
const bin = (f) => { const b = fs.readFileSync(path.join(dir, f)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); };
const binaries = { red: bin('red.bin'), silver: bin('silver.bin') };

const RENDERS = [['0_current', { render: 'dmg' }], ...RETRO_MIXES.map((m) => [m, { render: 'hq', mix: m }])];
const SONGS = [
  ['route1', 'red:Routes1'], ['pallet', 'red:PalletTown'], ['wild', 'red:WildBattle'], ['gym', 'red:GymLeaderBattle'],
  ['route29', 'silver:Route29'], ['johto_trainer', 'silver:JohtoTrainerBattle'],
];

function player(opts) { const p = new GbPlayer(SR, () => {}, opts); p.load(meta, binaries); return p; }
function render(p, seconds, onFrame) {
  const n = Math.round(SR * seconds), L = new Float32Array(n), R = new Float32Array(n);
  const t0 = performance.now();
  for (let o = 0; o < n; o += 128) { const k = Math.min(128, n - o); p.process(L.subarray(o, o + k), R.subarray(o, o + k), k); if (onFrame) onFrame(o); }
  return { L, R, ms: performance.now() - t0 };
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
const db = (x) => 10 * Math.log10(x + 1e-20);
function rms(L, R) { let s = 0; for (let i = 0; i < L.length; i++) s += L[i] * L[i] + R[i] * R[i]; return Math.sqrt(s / (2 * L.length)); }
function peak(L, R) { let m = 0; for (let i = 0; i < L.length; i++) m = Math.max(m, Math.abs(L[i]), Math.abs(R[i])); return m; }
// radix-2 FFT power spectrum of a Hann-windowed frame
function fftPower(x) {
  const n = x.length, re = Float64Array.from(x, (v, i) => v * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / n))), im = new Float64Array(n);
  for (let i = 1, j = 0; i < n; i++) { let b = n >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= n; len <<= 1) {
    const a = -2 * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k], vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci, vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi; re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
  const p = new Float64Array(n / 2);
  for (let k = 0; k < n / 2; k++) p[k] = re[k] * re[k] + im[k] * im[k];
  return p;
}
// energy shares by band (whole file, mono sum): melody 200-4000 Hz, harsh > 8 kHz
function bands(L, R) {
  const N = 4096, hz = SR / N;
  let tot = 0, hi = 0, mel = 0;
  for (let o = 0; o + N <= L.length; o += N) {
    const p = fftPower(Array.from({ length: N }, (_, i) => L[o + i] + R[o + i]));
    for (let k = 1; k < N / 2; k++) { tot += p[k]; if (k * hz > 8000) hi += p[k]; else if (k * hz >= 200 && k * hz <= 4000) mel += p[k]; }
  }
  return { hi: db(hi / tot), mel: db(mel / tot), hiAbs: hi, melAbs: mel };
}
// note-onset clicks: the console's pulses switch on as a step of their whole DC level (a thump the output capacitor
// drains in ~6 ms) and notes cut off mid-cycle; both show as energy below 80 Hz right at the note starts. Mean over the
// notes of that energy in the 15 ms after each start, relative to all the energy in the window (dB; lower = cleaner).
function onsetThump(L, R, onsets) {
  const k = 1 - Math.exp(-2 * Math.PI * 80 / SR), lo = new Float32Array(L.length);
  let a = 0, b = 0;
  for (let i = 0; i < L.length; i++) { a += k * (L[i] + R[i] - a); b += k * (a - b); lo[i] = b; }
  let sum = 0, cnt = 0, last = -1e9;
  for (const s of onsets) {
    if (s - last < 720 || s + 720 >= L.length) continue;
    last = s;
    let el = 0, et = 0;
    for (let i = s; i < s + 720; i++) { el += lo[i] * lo[i]; const x = L[i] + R[i]; et += x * x; }
    if (et > 1e-9) { sum += el / et; cnt++; }
  }
  return cnt ? db(sum / cnt) : 0;
}
// loudness, ITU BS.1770 K-weighting (48 kHz coefficients), ungated: LUFS-like
function kLoud(L, R) {
  const f = (x) => {
    const y = new Float64Array(x.length);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0, z1 = 0, z2 = 0, w1 = 0, w2 = 0;
    for (let i = 0; i < x.length; i++) {
      const v = 1.53512485958697 * x[i] - 2.69169618940638 * x1 + 1.19839281085285 * x2 + 1.69065929318241 * y1 - 0.73248077421585 * y2;
      x2 = x1; x1 = x[i]; y2 = y1; y1 = v;
      const u = v - 2 * z1 + z2 + 1.99004745483398 * w1 - 0.99007225036621 * w2;
      z2 = z1; z1 = v; w2 = w1; w1 = u; y[i] = u;
    }
    return y;
  };
  const a = f(L), b = f(R); let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * a[i] + b[i] * b[i];
  return -0.691 + 10 * Math.log10(s / a.length + 1e-20);
}
// how much the mono fold-down loses vs the stereo energy (dB; 0 = fully mono-compatible)
function monoLoss(L, R) { let s = 0, m = 0; for (let i = 0; i < L.length; i++) { s += L[i] * L[i] + R[i] * R[i]; const x = (L[i] + R[i]) * 0.5; m += 2 * x * x; } return db(m / s); }
function envelope(L, R, s0, n, hop = 480) {
  const out = [];
  for (let o = s0; o + hop <= s0 + n; o += hop) { let e = 0; for (let i = o; i < o + hop; i++) e += L[i] * L[i] + R[i] * R[i]; out.push(Math.sqrt(e / hop)); }
  return out;
}
function corr(a, b) {
  const n = Math.min(a.length, b.length); let ma = 0, mb = 0; for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; } ma /= n; mb /= n;
  let s = 0, ea = 0, eb = 0; for (let i = 0; i < n; i++) { s += (a[i] - ma) * (b[i] - mb); ea += (a[i] - ma) ** 2; eb += (b[i] - mb) ** 2; }
  return s / Math.sqrt(ea * eb + 1e-20);
}
// best envelope correlation within +-lag hops (the tempo's fractional frames shift repeats by up to a frame)
function corrLag(a, b, lag = 6) { let best = -1; for (let d = -lag; d <= lag; d++) best = Math.max(best, corr(a.slice(lag + d, a.length - lag + d), b.slice(lag, b.length - lag))); return best; }
// the song's loop: frame of each channel's first and second pass through its infinite loop (engine hook)
function loopFrames(name) {
  const p = player({ render: 'dmg' });
  p.playBgm(name);
  const e = p.bgm.engine, hits = [[], [], [], []];
  e.onLoop = (c) => { if (c < 4) hits[c].push(p.frames); };
  const alive = (i) => (e instanceof RedEngine ? !!e.ids[i] : e.ch[i].on);
  for (let f = 0; f < 60 * 60 * 6 && ![0, 1, 2, 3].every((i) => hits[i].length >= 2 || !alive(i)); f++) p.frame();
  const firsts = hits.filter((h) => h.length >= 2);
  return { start: Math.max(...firsts.map((h) => h[0])), len: Math.max(...firsts.map((h) => h[1] - h[0])) };
}

if (args.includes('--calibrate')) {
  const SET = ['red:TitleScreen', 'red:Routes1', 'red:PalletTown', 'red:Pokecenter', 'red:WildBattle', 'red:TrainerBattle', 'red:GymLeaderBattle',
    'red:FinalBattle', 'red:Dungeon3', 'red:PokemonTower', 'silver:Route29', 'silver:NewBarkTown', 'silver:JohtoWildBattle',
    'silver:JohtoTrainerBattle', 'silver:ChampionBattle', 'silver:GoldenrodCity'];
  const lv = {};
  for (const [tag, opts] of RENDERS) {
    let s = 0;
    for (const name of SET) { const p = player(opts); p.playBgm(name); const r = render(p, 30); s += rms(r.L, r.R); }
    lv[tag] = s / SET.length;
  }
  for (const [tag] of RENDERS) console.log(`${tag.padEnd(10)} mean RMS ${(20 * Math.log10(lv[tag])).toFixed(2)} dBFS   trim x${(lv['0_current'] / lv[tag]).toFixed(3)} to match the console render`);
  process.exit(0);
}

const rows = [];
for (const [key, name] of SONGS) {
  const lp = loopFrames(name);
  const loopS = lp.len / FRAME_HZ;
  let curEnv = null;
  for (const [tag, opts] of RENDERS) {
    const p = player(opts);
    const onsets = [];
    p.apu.onTrigger = (i) => { if (i < 3) onsets.push(Math.round((p.frames - 1) * SPF)); };
    p.playBgm(name);
    // one file: SECS seconds; the seam check needs the first loop point plus two loops (short loops only)
    const need = Math.min(Math.max(SECS, (lp.start + 2 * lp.len) / FRAME_HZ + 1), 200);
    const r = render(p, need);
    const n = Math.round(SECS * SR);
    const L = r.L.subarray(0, n), R = r.R.subarray(0, n);
    writeWav(path.join(OUT, `${key}_${tag}.wav`), L, R);
    const b = bands(L, R);
    let seam = null;
    const s0 = Math.round(lp.start * SPF), ln = Math.round(lp.len * SPF);
    if (s0 + 2 * ln <= r.L.length) seam = corrLag(envelope(r.L, r.R, s0, ln, 240), envelope(r.L, r.R, s0 + ln, ln, 240));
    const env = envelope(L, R, 0, n, 240);
    if (tag === '0_current') curEnv = env;
    rows.push({ key, tag, rms: 20 * Math.log10(rms(L, R)), lufs: kLoud(L, R), peak: peak(L, R), hi: b.hi, mel: b.mel, hiAbs: b.hiAbs, melAbs: b.melAbs,
      click: onsetThump(L, R, onsets.filter((s) => s < n)), timing: corr(env, curEnv), mono: monoLoss(L, R), seam, loopS, cpu: r.ms / need });
  }
}
// stitched A/B file for Route 1: the same song position, the render switching every 8 s (20 ms crossfades)
{
  const seg = 8, order = RENDERS.map(([t]) => t), total = seg * order.length;
  const takes = RENDERS.map(([, opts]) => { const p = player(opts); p.playBgm('red:Routes1'); return render(p, total); });
  const n = total * SR, L = new Float32Array(n), R = new Float32Array(n), xf = Math.round(0.02 * SR);
  for (let i = 0; i < n; i++) {
    const k = Math.floor(i / (seg * SR)), into = i - k * seg * SR;
    let w = 1;
    if (k > 0 && into < xf) w = into / xf;
    const cur = takes[k], prev = k > 0 ? takes[k - 1] : cur;
    L[i] = cur.L[i] * w + prev.L[i] * (1 - w); R[i] = cur.R[i] * w + prev.R[i] * (1 - w);
  }
  writeWav(path.join(OUT, 'route1_stitched.wav'), L, R);
  console.log(`route1_stitched.wav: ${order.map((t) => t.replace('0_', '')).join(' -> ')}, ${seg} s each`);
}
console.log('song           render     RMS dBFS  K-loud  peak  >8kHz share  200-4k share  >8kHz vs current  onset thump  timing vs current  mono loss  loop seam  CPU ms/s');
for (const r of rows) {
  const cur = rows.find((x) => x.key === r.key && x.tag === '0_current');
  const rel = db(r.hiAbs / cur.hiAbs) - db(r.melAbs / cur.melAbs);       // HF change with the melody band level-matched
  console.log(`${r.key.padEnd(14)} ${r.tag.padEnd(10)} ${r.rms.toFixed(1).padStart(7)}  ${r.lufs.toFixed(1).padStart(6)}  ${r.peak.toFixed(2)}  ${r.hi.toFixed(1).padStart(7)} dB   ${r.mel.toFixed(1).padStart(7)} dB   ${rel.toFixed(1).padStart(9)} dB   ${r.click.toFixed(1).padStart(8)} dB   ${r.timing.toFixed(3).padStart(9)}        ${r.mono.toFixed(1).padStart(5)} dB  ${r.seam === null ? '   -' : r.seam.toFixed(3)} (${r.loopS.toFixed(1)} s)  ${r.cpu.toFixed(2)}`);
}
for (const [tag] of RENDERS) {
  const rs = rows.filter((r) => r.tag === tag);
  const mean = (k) => rs.reduce((a, r) => a + r[k], 0) / rs.length;
  console.log(`mean ${tag.padEnd(10)} RMS ${mean('rms').toFixed(1)} dBFS, K-weighted ${mean('lufs').toFixed(1)} LUFS, onset thump ${mean('click').toFixed(1)} dB, CPU ${mean('cpu').toFixed(2)} ms per s of audio (${(mean('cpu') / 10).toFixed(2)}% of one core)`);
}
console.log('wrote', path.relative(ROOT, OUT));
