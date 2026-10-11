// Hoenn chiptune prototype: convert every Emerald song the game uses (emerald.js HOENN_SONG_SET), assemble it and run
// it in GscEngine: does it fit one bank, and does every channel loop at Emerald's loop length? (No audio written.)
//   node tools/hoenn_chip/check_all.mjs [--out E:/BigData/games/hoenn-chiptune/auto_all]
import fs from 'fs';
import path from 'path';
import { HOENN_SONG_SET } from '../../web/src/audio/emerald.js';
import { traceSong } from './m4a_trace.mjs';
import { convert } from './m4a2gsc.mjs';
import { assemble } from './gsc_asm.mjs';
import { gscPlayer, gscLoop } from './render_lib.mjs';
const args = process.argv.slice(2);
const OUT = args.includes('--out') ? args[args.indexOf('--out') + 1] : 'E:/BigData/games/hoenn-chiptune/auto_all';
fs.mkdirSync(OUT, { recursive: true });
const rows = [];
let total = 0;
for (const song of [...HOENN_SONG_SET].sort()) {
  try {
    const tr = traceSong(song);
    const { asm, label, info } = convert(tr);
    fs.writeFileSync(path.join(OUT, song + '.asm'), asm);
    const { bytes, labels } = assemble(asm);
    total += bytes.length;
    const p = gscPlayer({ s: { bytes, header: labels[label] } }, { render: 'dmg' });
    let ok, detail;
    if (tr.loop) {
      const hits = gscLoop(p, 'hoenn:s');
      const lens = hits.filter((h) => h.length >= 2).map((h) => h[1] - h[0]);
      const m = tr.loop.secondPassFrames;
      ok = lens.length > 0 && lens.every((x) => Math.abs(x - m) <= Math.max(3, m * 0.003));
      detail = `loop m4a ${m} f, gsc ${[...new Set(lens)].join('/')} f`;
    } else {
      p.playBgm('hoenn:s'); let f = 0; while (p.bgm && !p.bgm.ended && f < 60 * 300) { p.frame(); f++; }
      ok = Math.abs(f - tr.endFrame) <= Math.max(3, tr.endFrame * 0.01);
      detail = `no loop: ends at ${f} f (m4a ${tr.endFrame} f)`;
    }
    const q = info.quality;
    rows.push({ song, ok, bytes: bytes.length, detail, kept: q.keptPitched, drums: q.keptDrums, chans: [1, 2, 3].map((c) => Object.keys(info.selection[c]).length) });
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${song.padEnd(26)} ${String(bytes.length).padStart(5)} B  ${detail}  pitched ${q.keptPitched} drums ${q.keptDrums}`);
  } catch (e) { rows.push({ song, ok: false, error: e.message }); console.log(`FAIL ${song}: ${e.message}`); }
}
console.log(`${rows.filter((r) => r.ok).length}/${rows.length} ok, ${total} bytes in all`);
fs.writeFileSync(path.join(OUT, 'check.json'), JSON.stringify(rows, null, 1));
