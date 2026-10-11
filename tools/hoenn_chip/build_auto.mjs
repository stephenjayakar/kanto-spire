// Hoenn chiptune prototype: convert Emerald songs automatically and render them next to the originals.
//   node tools/hoenn_chip/build_auto.mjs [--out E:/BigData/games/hoenn-chiptune] mus_route101 mus_vs_wild ...
// Writes (ROM-derived, outside git): <out>/auto/<song>.asm, <out>/renders/<song>__emerald.wav, <song>__auto_C.wav
// (intro + one loop + 4 s, 3 s fade; levels are left as rendered: the MP3 step matches loudness), and a JSON summary.
import fs from 'fs';
import path from 'path';
import { traceSong } from './m4a_trace.mjs';
import { convert } from './m4a2gsc.mjs';
import { assemble } from './gsc_asm.mjs';
import { gscPlayer, renderPlayer, renderEmerald, gscLoop, writeWav, fadeTail, rms, dbfs, FRAME_HZ } from './render_lib.mjs';

const args = process.argv.slice(2);
const OUT = args.includes('--out') ? args[args.indexOf('--out') + 1] : 'E:/BigData/games/hoenn-chiptune';
const songs = args.filter((a, i) => a.startsWith('mus_') && args[i - 1] !== '--out');
const summary = {};
const sumFile = path.join(OUT, 'renders', 'auto_summary.json');
if (fs.existsSync(sumFile)) Object.assign(summary, JSON.parse(fs.readFileSync(sumFile, 'utf8')));
for (const song of songs) {
  const tr = traceSong(song);
  const { asm, label, info } = convert(tr);
  fs.mkdirSync(path.join(OUT, 'auto'), { recursive: true });
  fs.writeFileSync(path.join(OUT, 'auto', song + '.asm'), asm);
  const { bytes, labels } = assemble(asm);
  const name = song + '_auto';
  const p = gscPlayer({ [name]: { bytes, header: labels[label] } }, { render: 'hq', mix: 'C' });
  const hits = gscLoop(p, 'hoenn:' + name);
  const gLoop = hits.filter((h) => h.length >= 2);
  const gscLoopFrames = gLoop.length ? Math.max(...gLoop.map((h) => h[1] - h[0])) : null;
  const gscLoopStart = gLoop.length ? Math.max(...gLoop.map((h) => h[0])) : null;
  const m4aLoopFrames = tr.loop ? tr.loop.secondPassFrames : null;
  const seconds = Math.min(150, (tr.loop ? tr.loop.endFrame : tr.endFrame) / FRAME_HZ + 4);
  p.playBgm('hoenn:' + name);
  const g = renderPlayer(p, seconds);
  const em = renderEmerald(song, seconds);
  for (const r of [g, em]) fadeTail(r.L, r.R, 3);
  writeWav(path.join(OUT, 'renders', `${song}__auto_C.wav`), g.L, g.R);
  writeWav(path.join(OUT, 'renders', `${song}__emerald.wav`), em.L, em.R);
  summary[song] = {
    bytes: bytes.length, seconds, info,
    loop: { m4aFrames: m4aLoopFrames, gscFrames: gscLoopFrames, m4aStartFrame: tr.loop && tr.loop.startFrame, gscStartFrame: gscLoopStart,
      allChannelsSame: gLoop.every((h) => h[1] - h[0] === gscLoopFrames) },
    rmsDb: { auto: +dbfs(rms(g.L, g.R)).toFixed(1), emerald: +dbfs(rms(em.L, em.R)).toFixed(1) },
  };
  console.log(`${song}: ${bytes.length} B, loop m4a ${m4aLoopFrames} f / gsc ${gscLoopFrames} f (start ${tr.loop && tr.loop.startFrame} / ${gscLoopStart}), RMS auto ${summary[song].rmsDb.auto} dB, emerald ${summary[song].rmsDb.emerald} dB`);
  console.log('  ch1', JSON.stringify(info.selection[1]));
  console.log('  ch2', JSON.stringify(info.selection[2]));
  console.log('  ch3', JSON.stringify(info.selection[3]));
  console.log('  drums', JSON.stringify(info.drums));
}
fs.mkdirSync(path.dirname(sumFile), { recursive: true });
fs.writeFileSync(sumFile, JSON.stringify(summary, null, 1));
