// Hoenn chiptune: writes tools/hoenn_chip/emerald_voices.json, the instrument name of every program (and drum-kit key)
// each Hoenn song plays, read from a pret/pokeemerald checkout's sound/voicegroups (names only, no sound data). The
// converter classes voices by these names (bass, drums, brass...). Rerun only if the song list changes.
//   POKEEMERALD=<decomp> HOENN_VOICES=decomp node tools/hoenn_chip/make_voices.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { HOENN_SONG_SET } from '../../web/src/audio/emerald.js';
import { traceSong } from './m4a_trace.mjs';
if (process.env.HOENN_VOICES !== 'decomp') { console.error('run with HOENN_VOICES=decomp (and POKEEMERALD=<pret/pokeemerald>)'); process.exit(2); }
const out = {};
for (const song of [...HOENN_SONG_SET].sort()) {
  const t = traceSong(song), v = (out[song] = {});
  for (const n of t.notes) {
    const k = n.name.kind === 'drum' ? `${n.prog}:${n.key}` : String(n.prog);
    v[k] = { kind: n.name.kind, name: n.name.name || '' };
  }
}
const file = path.join(path.dirname(fileURLToPath(import.meta.url)), 'emerald_voices.json');
fs.writeFileSync(file, JSON.stringify(out, null, 0).replace(/\},"/g, '},\n"'));
console.log(`wrote ${file}: ${Object.keys(out).length} songs`);
