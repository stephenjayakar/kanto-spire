// Hoenn chiptune: listening renders of the shipped HOENN songs, straight from web/assets/retro (retro.json +
// silver.bin + hoenn.bin) through GbPlayer with the shipped mix, intro + one loop + 4 s with a 3 s fade.
// Nothing is played aloud.   node tools/hoenn_chip/render_shipped.mjs <out dir> mus_route101 [...]
// A song the game doesn't use (not in the bank) is converted on the fly with the same converter.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GbPlayer } from '../../web/src/audio/gb-core.js';
import { RETRO_MIX } from '../../web/src/audio/retro.js';
import { traceSong } from './m4a_trace.mjs';
import { convert } from './m4a2gsc.mjs';
import { assemble } from './gsc_asm.mjs';
import { gscPlayer, renderPlayer, writeWav, fadeTail, FRAME_HZ } from './render_lib.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const dir = path.join(ROOT, 'web/assets/retro');
const [out, ...songs] = process.argv.slice(2);
const meta = JSON.parse(fs.readFileSync(path.join(dir, 'retro.json'), 'utf8'));
const rd = (f) => { const b = fs.readFileSync(path.join(dir, f)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); };
for (const song of songs) {
  const tr = traceSong(song);
  const seconds = Math.min(150, (tr.loop ? tr.loop.endFrame : tr.endFrame) / FRAME_HZ + 4);
  let p, name = 'hoenn:' + song, tag = 'shipped';
  if (meta.songs[name]) { p = new GbPlayer(48000, () => {}, { render: 'hq', mix: RETRO_MIX }); p.load(meta, { silver: rd('silver.bin'), hoenn: rd('hoenn.bin') }); }
  else { const c = convert(tr); const { bytes, labels } = assemble(c.asm); p = gscPlayer({ s: { bytes, header: labels[c.label] } }, { render: 'hq', mix: RETRO_MIX }); name = 'hoenn:s'; tag = 'converter'; }
  p.playBgm(name);
  const r = renderPlayer(p, seconds);
  fadeTail(r.L, r.R, 3);
  writeWav(path.join(out, `${song}__${tag}_${RETRO_MIX}.wav`), r.L, r.R);
  console.log(`${song}: ${tag} (${seconds.toFixed(1)} s)`);
}
