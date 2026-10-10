// Emerald music bank check: loads FireRed's bank plus the relocated Emerald bank (tools/extract_emerald_sound.js)
// into one engine, like the game does (Sound.addBank), plays every Emerald song for a few seconds and checks that
// the driver never reads outside the banks (misses), the output isn't silent, and FireRed songs still play.
//   node tests/emerald_audio.mjs [--seconds 6] [--wav]     (--wav: also writes a few songs to tests/out/emerald/)
import fs from 'fs';
import path from 'path';
import { createEngine } from '../web/src/audio/m4a-core.js';
import { HOENN_SONG_SET } from '../web/src/audio/emerald.js';

const A = 'web/assets/sound/';
if (!fs.existsSync(A + 'emerald/bank.json')) { console.log('no Emerald bank (run tools/extract_emerald.py): skipped'); process.exit(0); }
const args = process.argv.slice(2);
const SECONDS = +(args[args.indexOf('--seconds') + 1] || 0) || 6;
const RATE = 48000;
const fr = { json: JSON.parse(fs.readFileSync(A + 'bank.json', 'utf8')), bin: new Uint8Array(fs.readFileSync(A + 'bank.bin')) };
const em = { json: JSON.parse(fs.readFileSync(A + 'emerald/bank.json', 'utf8')), bin: new Uint8Array(fs.readFileSync(A + 'emerald/bank.bin')) };

function engine() {
  const e = createEngine(fr.bin, fr.json, { sampleRate: RATE, quality: 'hq' });
  e.mem.addSegments(em.bin, em.json.segments);
  return e;
}
function render(header, seconds) {
  const e = engine();
  e.startSong(0, header);
  const n = Math.round(seconds * RATE), L = new Float32Array(n), R = new Float32Array(n);
  for (let o = 0; o < n; o += 128) e.process(L.subarray(o), R.subarray(o), Math.min(128, n - o));
  let sum = 0, active = 0, finite = true;
  for (let i = 0; i < n; i++) { const v = L[i]; if (!Number.isFinite(v)) finite = false; sum += v * v; if (Math.abs(v) > 1e-3) active++; }
  return { rms: Math.sqrt(sum / n), active: active / n, finite, misses: e.mem.misses, missAt: [...e.mem.missSet].slice(0, 4).map(a => a.toString(16)), L, R };
}
function wav(file, L, R) {
  const n = L.length, b = Buffer.alloc(44 + n * 4);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 4, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(2, 22);
  b.writeUInt32LE(RATE, 24); b.writeUInt32LE(RATE * 4, 28); b.writeUInt16LE(4, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) { b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(L[i] * 32767))), 44 + i * 4); b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(R[i] * 32767))), 46 + i * 4); }
  fs.writeFileSync(file, b);
}

const fails = [];
const songs = em.json.songs;
// every song the game asks for must be in the bank
for (const s of HOENN_SONG_SET) if (!songs[s]) fails.push(`the game uses ${s}, not in the Emerald bank`);
let n = 0;
for (const [name, s] of Object.entries(songs)) {
  const r = render(s.header, SECONDS);
  n++;
  const silentOk = /mus_(too_bad|dummy)/.test(name);
  const bad = !r.finite || r.misses > 0 || (!silentOk && r.active < 0.02);
  if (bad || HOENN_SONG_SET.has(name)) console.log(`${bad ? 'FAIL' : 'ok  '} ${name.padEnd(28)} rms ${r.rms.toFixed(3)} active ${(r.active * 100).toFixed(0)}% misses ${r.misses}${r.misses ? ' @' + r.missAt.join(',') : ''}`);
  if (bad) fails.push(`${name}: ${!r.finite ? 'non-finite ' : ''}${r.misses ? r.misses + ' bank misses ' : ''}${r.active < 0.02 ? 'silent' : ''}`);
  if (args.includes('--wav') && ['mus_route101', 'mus_vs_gym_leader', 'mus_vs_champion', 'mus_route119'].includes(name)) {
    fs.mkdirSync('tests/out/emerald', { recursive: true });
    wav(`tests/out/emerald/${name}.wav`, r.L, r.R);
  }
}
// FireRed songs still play in the merged engine
for (const name of ['mus_route1', 'mus_vs_gym_leader', 'mus_title']) {
  const r = render(fr.json.songs[name].header, 3);
  if (r.misses || r.active < 0.02) fails.push(`FireRed ${name} broken after addBank (misses ${r.misses}, active ${r.active})`);
}
console.log(`${n} Emerald songs rendered ${SECONDS}s each`);
if (fails.length) { console.log('FAILURES:\n  ' + fails.join('\n  ')); process.exit(1); }
console.log('emerald audio ok');
