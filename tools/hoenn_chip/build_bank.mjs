#!/usr/bin/env node
// Hoenn chiptune: builds RETRO's HOENN music, Game Boy conversions of every Emerald song the game asks for
// (emerald.js HOENN_SONG_SET), from the Emerald sound bank (tools/extract_emerald_sound.js -> web/assets/sound/emerald).
//
//   node tools/hoenn_chip/build_bank.mjs [--out web/assets/retro]     (run after tools/extract_retro_music.mjs, which
//                                                                     also calls this when the Emerald bank is there)
// Writes (ROM-derived, gitignored, shipped in the lazy 'retro' pack next to red.bin / silver.bin):
//   retro/hoenn.bin    16 KB song banks ($40, $41, ...) of Gold/Silver-format music (m4a2gsc.mjs + gsc_asm.mjs)
//   retro/retro.json   gains games.hoenn ({ base: 'silver' }: the songs play on Silver's engine bank) and the songs
//                      'hoenn:mus_*' (each with the Emerald loop length the tests compare against)
// Every song is checked here: it assembles, fits its bank, and every channel loops at Emerald's loop length (or ends
// with it, for the jingles). Deterministic: the same Emerald bank gives the same bytes.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { HOENN_SONG_SET } from '../../web/src/audio/emerald.js';
import { GbPlayer } from '../../web/src/audio/gb-core.js';
import { traceSong } from './m4a_trace.mjs';
import { convert } from './m4a2gsc.mjs';
import { assemble } from './gsc_asm.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BANK0 = 0x40;
export const CONVERTER_VERSION = 1;

export function buildHoennBank(outDir = path.join(ROOT, 'web/assets/retro'), log = console.log) {
  const metaFile = path.join(outDir, 'retro.json');
  if (!fs.existsSync(metaFile)) throw new Error(`${metaFile} missing: run tools/extract_retro_music.mjs first`);
  if (!fs.existsSync(path.join(ROOT, 'web/assets/sound/emerald/bank.json'))) throw new Error('no Emerald sound bank (tools/extract_emerald_sound.js)');
  const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
  if (!meta.games.silver) throw new Error('retro.json has no Silver bank (the HOENN songs play on its engine)');
  // convert; identical songs (Emerald plays the same music for Kyogre/Groudon and Rayquaza) share one copy
  const songs = [...HOENN_SONG_SET].sort();
  const conv = new Map(), byText = new Map();
  for (const song of songs) {
    const tr = traceSong(song);
    const c = convert(tr);
    const key = c.asm.split(c.label).join('@');
    const loop = tr.loop ? tr.loop.secondPassFrames : null;
    if (byText.has(key)) { conv.set(song, { alias: byText.get(key), loop, end: tr.endFrame }); continue; }
    byText.set(key, song);
    conv.set(song, { ...c, loop, end: tr.endFrame });
  }
  // pack: each song assembled where it lands in the current 16 KB bank
  const banks = [new Uint8Array(0x4000)];
  let used = 0;
  const where = {};
  for (const [song, c] of conv) {
    if (c.alias) continue;
    let r = assemble(c.asm, { org: 0x4000 + used });
    if (used + r.bytes.length > 0x4000) { banks.push(new Uint8Array(0x4000)); used = 0; r = assemble(c.asm, { org: 0x4000 }); }
    if (r.bytes.length > 0x4000) throw new Error(`${song}: ${r.bytes.length} bytes, more than a bank`);
    banks[banks.length - 1].set(r.bytes, used);
    where[song] = { bank: BANK0 + banks.length - 1, header: r.labels[c.label] };
    used += r.bytes.length;
  }
  for (const [song, c] of conv) if (c.alias) where[song] = where[c.alias];
  const bin = new Uint8Array(banks.length * 0x4000);
  banks.forEach((b, i) => bin.set(b, i * 0x4000));
  // retro.json: replace any older HOENN entries
  for (const k of Object.keys(meta.songs)) if (meta.songs[k].game === 'hoenn') delete meta.songs[k];
  meta.games.hoenn = { file: 'hoenn.bin', engine: 'gsc', base: 'silver', banks: banks.map((_, i) => BANK0 + i), tables: meta.games.silver.tables, converter: CONVERTER_VERSION };
  for (const song of songs) {
    const c = conv.get(song);
    meta.songs['hoenn:' + song] = { game: 'hoenn', ...where[song], ...(c.loop ? { emeraldLoop: c.loop } : { emeraldEnd: c.end }) };
  }
  // check every song in the real player (the same load path as the game)
  const rd = (f) => { const b = fs.readFileSync(path.join(outDir, f)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); };
  const problems = [];
  for (const song of songs) {
    const p = new GbPlayer(48000, () => {}, { render: 'dmg' });
    p.load(meta, { silver: rd('silver.bin'), hoenn: bin.slice().buffer });
    const name = 'hoenn:' + song, s = meta.songs[name];
    if (!p.has(name)) { problems.push(`${song}: not playable`); continue; }
    p.playBgm(name);
    const e = p.bgm.engine, hits = [[], [], [], []];
    e.onLoop = (c) => { if (c < 4) hits[c].push(p.frames); };
    let f = 0;
    for (; f < 60 * 60 * 6 && !p.bgm.ended && !hits.every((h, i) => h.length >= 2 || !e.ch[i].on); f++) p.frame();
    if (s.emeraldLoop) {
      const lens = hits.filter((h) => h.length >= 2).map((h) => h[1] - h[0]);
      if (!lens.length || lens.some((x) => Math.abs(x - s.emeraldLoop) > Math.max(3, s.emeraldLoop * 0.003))) problems.push(`${song}: loops in ${lens.join('/')} frames, Emerald ${s.emeraldLoop}`);
    } else if (Math.abs(f - s.emeraldEnd) > Math.max(3, s.emeraldEnd * 0.01)) problems.push(`${song}: ends at frame ${f}, Emerald ${s.emeraldEnd}`);
  }
  if (problems.length) throw new Error('HOENN bank check failed:\n  ' + problems.join('\n  '));
  fs.writeFileSync(path.join(outDir, 'hoenn.bin'), bin);
  fs.writeFileSync(metaFile, JSON.stringify(meta));
  const distinct = [...conv.values()].filter((c) => !c.alias).length;
  log(`wrote ${path.join(outDir, 'hoenn.bin')}: ${songs.length} HOENN songs (${distinct} distinct), ${banks.length} banks, ${bin.length} B; all loop at Emerald's length`);
  return { songs: songs.length, banks: banks.length, bytes: bin.length };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  const out = args.includes('--out') ? path.resolve(args[args.indexOf('--out') + 1]) : undefined;
  try { buildHoennBank(out); } catch (e) { console.error(e.message); process.exit(1); }
}
