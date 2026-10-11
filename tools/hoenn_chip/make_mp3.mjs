// Hoenn chiptune prototype: WAV renders -> MP3s at a matched loudness (RMS -18 dBFS, like the game's music), with a
// limiter only when the gain would clip. Uses a static ffmpeg build (--ffmpeg, default
// E:/BigData/games/hoenn-chiptune/tools/ffmpeg/bin/ffmpeg.exe). Nothing is played.
//   node tools/hoenn_chip/make_mp3.mjs <renders dir> <mp3 dir> [--target -18]
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const [IN, OUT] = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
const TARGET = +opt('--target', -18);
const FF = opt('--ffmpeg', 'E:/BigData/games/hoenn-chiptune/tools/ffmpeg/bin/ffmpeg.exe');
fs.mkdirSync(OUT, { recursive: true });
const rows = [];
for (const f of fs.readdirSync(IN).filter((x) => x.endsWith('.wav'))) {
  const b = fs.readFileSync(path.join(IN, f));
  let p = 12; while (b.toString('ascii', p, p + 4) !== 'data') p += 8 + b.readUInt32LE(p + 4);
  const n = b.readUInt32LE(p + 4) / 2, o = p + 8;
  let s = 0, pk = 0;
  for (let i = 0; i < n; i++) { const y = b.readInt16LE(o + i * 2) / 32768; s += y * y; pk = Math.max(pk, Math.abs(y)); }
  const rms = 20 * Math.log10(Math.sqrt(s / n) + 1e-12);
  const gain = TARGET - rms, peakAfter = 20 * Math.log10(pk) + gain;
  const af = [`volume=${gain.toFixed(2)}dB`];
  if (peakAfter > -0.5) af.push('alimiter=limit=0.94:attack=2:release=60:level=disabled');
  const out = path.join(OUT, f.replace(/\.wav$/, '.mp3'));
  execFileSync(FF, ['-y', '-loglevel', 'error', '-i', path.join(IN, f), '-af', af.join(','), '-codec:a', 'libmp3lame', '-b:a', '192k', out]);
  rows.push({ file: f, rms: +rms.toFixed(1), gain: +gain.toFixed(1), peakAfter: +peakAfter.toFixed(1), limited: peakAfter > -0.5, kb: Math.round(fs.statSync(out).size / 1024) });
  console.log(`${f.padEnd(40)} RMS ${rms.toFixed(1)} -> ${TARGET} dBFS (gain ${gain >= 0 ? '+' : ''}${gain.toFixed(1)} dB, peak ${peakAfter.toFixed(1)} dBFS${peakAfter > -0.5 ? ', limited' : ''}) ${rows.at(-1).kb} KB`);
}
fs.writeFileSync(path.join(OUT, 'levels.json'), JSON.stringify(rows, null, 1));
