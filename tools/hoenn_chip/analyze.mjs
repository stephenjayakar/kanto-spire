// Hoenn chiptune prototype: compare a conversion's render with the original's, by analysis only (nothing played).
//   node tools/hoenn_chip/analyze.mjs <reference.wav> <candidate.wav> [...more candidates]
// Prints per file: RMS dBFS and peak; tempo (onset-envelope autocorrelation, BPM within 70-210); timing (best lag of
// the onset envelopes vs the reference, ms, and their correlation); pitch: the transposition (semitones) that best
// matches the 12-bin chroma profile and the profile correlation at 0, plus the mean frame-by-frame chroma correlation.
import fs from 'fs';
const SR_EXPECT = 48000;
function readWav(f) {
  const b = fs.readFileSync(f);
  const ch = b.readUInt16LE(22), sr = b.readUInt32LE(24);
  let p = 12; while (b.toString('ascii', p, p + 4) !== 'data') p += 8 + b.readUInt32LE(p + 4);
  const n = b.readUInt32LE(p + 4) / (2 * ch), o = p + 8, x = new Float32Array(n);
  let s = 0, pk = 0;
  for (let i = 0; i < n; i++) { let v = 0; for (let c = 0; c < ch; c++) { const y = b.readInt16LE(o + (i * ch + c) * 2) / 32768; v += y; s += y * y; pk = Math.max(pk, Math.abs(y)); } x[i] = v / ch; }
  return { x, sr, rms: 20 * Math.log10(Math.sqrt(s / (n * ch)) + 1e-12), peak: pk };
}
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let b = n >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= n; len <<= 1) {
    const a = -2 * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a);
    for (let i = 0; i < n; i += len) { let cr = 1, ci = 0; for (let k = 0; k < len / 2; k++) {
      const j = i + k + len / 2, vr = re[j] * cr - im[j] * ci, vi = re[j] * ci + im[j] * cr;
      re[j] = re[i + k] - vr; im[j] = im[i + k] - vi; re[i + k] += vr; im[i + k] += vi;
      const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t; } }
  }
}
const N = 8192, HOP = 2400; // 50 ms hops
function features(w) {
  const { x, sr } = w, hz = sr / N, frames = [], flux = [];
  let prevMag = null;
  const win = Float64Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N));
  for (let o = 0; o + N <= x.length; o += HOP) {
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let i = 0; i < N; i++) re[i] = x[o + i] * win[i];
    fft(re, im);
    const mag = new Float64Array(N / 2), chroma = new Float64Array(12);
    for (let k = 1; k < N / 2; k++) {
      mag[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
      const f = k * hz;
      if (f < 55 || f > 2000) continue;
      const midi = 69 + 12 * Math.log2(f / 440);
      chroma[((Math.round(midi) % 12) + 12) % 12] += mag[k] * mag[k];
    }
    let fl = 0;
    if (prevMag) for (let k = 1; k < N / 2; k++) { const d = Math.log1p(mag[k] * 10) - Math.log1p(prevMag[k] * 10); if (d > 0) fl += d; }
    prevMag = mag; frames.push(chroma); flux.push(fl);
  }
  return { chroma: frames, flux };
}
const corr = (a, b) => { const n = Math.min(a.length, b.length); let ma = 0, mb = 0; for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; } ma /= n; mb /= n;
  let s = 0, ea = 0, eb = 0; for (let i = 0; i < n; i++) { s += (a[i] - ma) * (b[i] - mb); ea += (a[i] - ma) ** 2; eb += (b[i] - mb) ** 2; } return s / Math.sqrt(ea * eb + 1e-20); };
const norm = (v) => { const s = Math.sqrt(v.reduce((a, b) => a + b * b, 0)) || 1; return v.map((x) => x / s); };
function tempo(flux, sr) {
  const fps = sr / HOP; let best = 0, bpm = 0;
  for (let b = 70; b <= 210; b += 0.5) { const lag = fps * 60 / b; const l0 = Math.floor(lag), fr = lag - l0; let s = 0;
    for (let i = 0; i + l0 + 1 < flux.length; i++) s += flux[i] * (flux[i + l0] * (1 - fr) + flux[i + l0 + 1] * fr);
    if (s > best) { best = s; bpm = b; } }
  return bpm;
}
const files = process.argv.slice(2);
const ref = readWav(files[0]), rf = features(ref);
const profile = (F) => norm(F.chroma.reduce((a, c) => a.map((v, i) => v + c[i]), new Array(12).fill(0)));
const rp = profile(rf);
for (const f of files) {
  const w = readWav(f), F = f === files[0] ? rf : features(w);
  const p = profile(F);
  let bestShift = 0, bestC = -2;
  for (let s = -6; s <= 5; s++) { const c = corr(rp, p.map((_, i) => p[((i - s) % 12 + 12) % 12])); if (c > bestC) { bestC = c; bestShift = s; } }
  // tempo ratio: the time stretch of the candidate's onset envelope that best matches the reference's
  let rBest = 1, rC = -2;
  for (let r = 0.95; r <= 1.0501; r += 0.0025) { const st = rf.flux.map((_, i) => { const t = i * r, k = Math.floor(t), fr = t - k; return k + 1 < F.flux.length ? F.flux[k] * (1 - fr) + F.flux[k + 1] * fr : 0; }); const c = corr(rf.flux, st); if (c > rC) { rC = c; rBest = r; } }
  let lagBest = 0, lagC = -2;
  for (let d = -5; d <= 5; d++) { const a = rf.flux.slice(Math.max(0, d)), b = F.flux.slice(Math.max(0, -d)); const c = corr(a, b); if (c > lagC) { lagC = c; lagBest = d; } }
  let fc = 0, nf = 0;
  for (let i = 0; i < Math.min(rf.chroma.length, F.chroma.length); i++) { const a = norm([...rf.chroma[i]]), b = norm([...F.chroma[i]]); if (a.some((v) => v) && b.some((v) => v)) { fc += a.reduce((s, v, k) => s + v * b[k], 0); nf++; } }
  console.log(`${f.split(/[\/]/).pop().padEnd(36)} RMS ${w.rms.toFixed(1)} dBFS peak ${w.peak.toFixed(2)} | tempo ratio x${rBest.toFixed(4)} | onset lag ${(lagBest * HOP / w.sr * 1000).toFixed(0)} ms r=${lagC.toFixed(2)} | key shift ${bestShift} (profile r ${corr(rp, p).toFixed(3)}) frame chroma ${(fc / nf).toFixed(3)}`);
}
