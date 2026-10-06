#!/usr/bin/env node
// Kanto Spire - sound bank extractor.
//
// Reads the user's Pokemon FireRed (US 1.0) ROM and writes a "sparse ROM" sound bank:
//   web/assets/sound/bank.bin   - concatenated byte ranges copied verbatim from the ROM
//   web/assets/sound/bank.json  - segment map (original GBA addresses) + song/cry indices
//
// Everything the m4a (MP2K) driver could read while playing any song in gSongTable or any
// Pokemon cry is collected by statically walking the data exactly like the driver does:
// song headers, every track byte stream (following GOTO / PATT / REPT / MEMACC targets),
// voicegroup entries used by VOICE commands, keysplit (0x40) and drumkit (0x80) sub-voices
// for every key the song plays, keysplit tables, DirectSound WaveData headers + sample data
// (DPCM-compressed or raw), and 16-byte programmable-wave samples. The player then reads the
// bank through the original pointers.
//
// Usage: node tools/extract_sound.js [path/to/firered.gba]

'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const ROM_PATH = process.argv[2] || path.join(ROOT, 'rom', 'firered.gba');
const DECOMP = path.join(ROOT, 'pokefirered');
const OUT_DIR = path.join(ROOT, 'web', 'assets', 'sound');

const SONG_TABLE = 0x084A32CC; // gSongTable (FireRed US v1.0)
const SONG_TABLE_ENTRIES = 348;
const ROM_BASE = 0x08000000;
const MERGE_GAP = 32; // merge ranges separated by <= this many unused bytes

const rom = fs.readFileSync(ROM_PATH);
const sha1 = crypto.createHash('sha1').update(rom).digest('hex');
console.log(`ROM ${ROM_PATH} (${rom.length} bytes) sha1=${sha1}`);
if (!sha1.startsWith('41cb23d8')) console.warn('WARNING: ROM sha1 does not match FireRed US v1.0 (41cb23d8...)');

const used = new Uint8Array(rom.length);
const inRom = (a) => a >= ROM_BASE && a < ROM_BASE + rom.length;
const off = (a) => a - ROM_BASE;
const u8 = (a) => rom[off(a)];
const u16 = (a) => rom.readUInt16LE(off(a));
const u32 = (a) => rom.readUInt32LE(off(a));
function mark(a, len) {
  if (!inRom(a)) return false;
  const s = off(a), e = Math.min(rom.length, s + len);
  used.fill(1, s, e);
  return true;
}

// ---------------------------------------------------------------- decomp names
function readText(p) { return fs.readFileSync(path.join(DECOMP, p), 'utf8'); }
const songNames = [];
for (const line of readText('sound/song_table.inc').split(/\r?\n/)) {
  const m = line.match(/^\s*song\s+(\w+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (m) songNames.push(m[1].toLowerCase());
}

// ---------------------------------------------------------------- waves / voices
const stats = { waves: new Set(), progWaves: new Set(), voices: new Set(), rejected: 0 };

function waveHeaderOk(w) {
  if (!inRom(w) || !inRom(w + 16)) return false;
  const type = u16(w), flags = u8(w + 3), freq = u32(w + 4), loop = u32(w + 8), size = u32(w + 12);
  if (type > 1) return false;
  if (flags & 0x3F) return false;
  if (size === 0 || size > 0x200000) return false;
  if (loop > size) return false;
  if (freq < 256 * 1024 || freq > 200000 * 1024) return false;
  return true;
}
function walkWave(w) {
  if (stats.waves.has(w)) return true;
  if (!waveHeaderOk(w)) { stats.rejected++; return false; }
  stats.waves.add(w);
  const size = u32(w + 12);
  const bytes = u16(w) === 1 ? Math.ceil(size / 64) * 33 : size + 1; // +1: interpolation reads one past
  mark(w, 16 + bytes);
  return true;
}
const LEAF_TYPES = new Set([0x00, 0x08, 0x10, 0x18, 0x20, 0x28, 0x30, 0x38, 1, 2, 3, 4, 9, 10, 11, 12]);
function walkLeafVoice(v) {
  if (!inRom(v)) return;
  const type = u8(v);
  if (!LEAF_TYPES.has(type)) { stats.rejected++; return; }
  if (type & 7) {
    mark(v, 12);
    if ((type & 7) === 3) {
      const w = u32(v + 4);
      if (inRom(w)) { mark(w, 16); stats.progWaves.add(w); }
    }
    stats.voices.add(v);
    return;
  }
  const w = u32(v + 4);
  if (walkWave(w)) { mark(v, 12); stats.voices.add(v); }
}
function walkVoice(v, keys) {
  if (!inRom(v)) return;
  mark(v, 12);
  const type = u8(v);
  if (type & 0x40) {                // keysplit: sub voicegroup + key->index table
    const sub = u32(v + 4), table = u32(v + 8);
    for (const k of keys) {
      if (!inRom(table + k)) continue;
      mark(table + k, 1);
      walkLeafVoice(sub + 12 * u8(table + k));
    }
  } else if (type & 0x80) {         // drumkit: one sub voice per key
    const sub = u32(v + 4);
    for (const k of keys) walkLeafVoice(sub + 12 * k);
  } else {
    walkLeafVoice(v);
  }
}

// ---------------------------------------------------------------- track walker
// Mirrors MPlayMain's command decoding (running status for cmds >= 0xBD, optional note args).
function walkTrack(start, ctx) {
  const queue = [[start, 0]];
  while (queue.length) {
    let [pos, rs] = queue.pop();
    let steps = 0;
    while (steps++ < 200000) {
      if (!inRom(pos) || ctx.visited.has(pos)) break;
      ctx.visited.add(pos);
      const begin = pos;
      let cmd = u8(pos);
      if (cmd < 0x80) cmd = rs; else { pos++; if (cmd >= 0xBD) rs = cmd; }
      let end = false;
      if (cmd >= 0xCF) {                       // TIE / Nxx
        if (u8(pos) < 0x80) {
          ctx.keys.add(u8(pos)); pos++;
          if (u8(pos) < 0x80) { pos++; if (u8(pos) < 0x80) pos++; }
        }
      } else if (cmd >= 0xB1) {
        switch (cmd) {
          case 0xB1: end = true; break;                                     // FINE
          case 0xB2: queue.push([u32(pos), rs]); pos += 4; end = true; break; // GOTO
          case 0xB3: queue.push([u32(pos), rs]); pos += 4; break;            // PATT
          case 0xB4: break;                       // PEND: falls through at pattern level 0 (inline first copy)
          case 0xB5: {                                                      // REPT
            const n = u8(pos); queue.push([u32(pos + 1), rs]); pos += 5;
            if (n === 0) end = true; break;
          }
          case 0xB9: {                                                      // MEMACC
            const op = u8(pos); pos += 3;
            if (op >= 6 && op <= 17) { queue.push([u32(pos), rs]); pos += 4; }
            break;
          }
          case 0xBD: ctx.voices.add(u8(pos)); pos++; break;                  // VOICE
          case 0xBA: case 0xBB: case 0xBC: case 0xBE: case 0xBF: case 0xC0:
          case 0xC1: case 0xC2: case 0xC3: case 0xC4: case 0xC5: case 0xC8:
            pos++; break;
          case 0xCC: pos += 2; break;                                       // PORT
          case 0xCD: {                                                      // XCMD
            const n = u8(pos); pos++;
            if (n === 1) { ctx.xwaves.add(u32(pos)); pos += 4; }
            else if (n >= 2 && n <= 11 && n !== 3) pos += 1;
            else if (n === 12) pos += 2;
            else if (n === 13) pos += 4;
            else end = true;                                                 // ply_xxx -> fine
            break;
          }
          case 0xCE: if (u8(pos) < 0x80) { ctx.keys.add(u8(pos)); pos++; } break; // EOT
          default: end = true;                                              // unused -> ply_fine
        }
      }
      // else: 0x80..0xB0 wait
      mark(begin, pos - begin);
      if (end) break;
    }
  }
}

function walkSong(hdr) {
  if (!inRom(hdr)) return null;
  const tc = u8(hdr);
  mark(hdr, 8 + 4 * tc);
  const ctx = { visited: new Set(), keys: new Set(), voices: new Set(), xwaves: new Set() };
  for (let i = 0; i < tc; i++) walkTrack(u32(hdr + 8 + 4 * i), ctx);
  const tone = u32(hdr + 4);
  for (const v of ctx.voices) walkVoice(tone + 12 * v, ctx.keys);
  for (const w of ctx.xwaves) walkWave(w);
  return { trackCount: tc, priority: u8(hdr + 2), reverb: u8(hdr + 3), tone };
}

// ---------------------------------------------------------------- songs
const songs = {};
const seenHeaders = new Map();
for (let i = 0; i < SONG_TABLE_ENTRIES; i++) {
  const e = SONG_TABLE + i * 8;
  const hdr = u32(e), ms = u16(e + 4), me = u16(e + 6);
  const name = songNames[i];
  if (!name) { console.log(`  table entry ${i}: header 0x${hdr.toString(16)} ms=${ms} (no name in song_table.inc, skipped)`); continue; }
  if (!seenHeaders.has(hdr)) seenHeaders.set(hdr, walkSong(hdr));
  const info = seenHeaders.get(hdr);
  if (!info) { console.warn(`  ${name}: bad header pointer`); continue; }
  songs[name] = { index: i, header: hdr, player: ms, me, tracks: info.trackCount, priority: info.priority, reverb: info.reverb };
}
console.log(`songs: ${Object.keys(songs).length} named (${seenHeaders.size} distinct headers)`);

// ---------------------------------------------------------------- cries
// gCryTable / gCryTable_Reverse: 12-byte ToneData {0x20|0x30, 60, 0, 0, wav*, 255, 0, 255, 0}
function isCryEntry(o, type) {
  return rom[o] === type && rom[o + 1] === 60 && rom[o + 2] === 0 && rom[o + 3] === 0 &&
    rom[o + 7] === 0x08 && rom[o + 8] === 255 && rom[o + 9] === 0 && rom[o + 10] === 255 && rom[o + 11] === 0;
}
const cryNames = [];
{
  const txt = readText('sound/cry_tables.inc');
  const part = txt.split('gCryTable_Reverse::')[0];
  for (const m of part.matchAll(/^\s*cry\s+Cry_(\w+)/gm)) cryNames.push(m[1]);
}
const NUM_CRIES = cryNames.length;
let cryTable = 0, cryTableReverse = 0;
for (let o = 0; o + NUM_CRIES * 24 <= rom.length; o += 4) {
  if (!isCryEntry(o, 0x20)) continue;
  let ok = true;
  for (let i = 0; i < NUM_CRIES && ok; i++) ok = isCryEntry(o + i * 12, 0x20);
  if (!ok) continue;
  const r = o + NUM_CRIES * 12;
  for (let i = 0; i < NUM_CRIES && ok; i++) ok = isCryEntry(r + i * 12, 0x30);
  if (!ok) continue;
  cryTable = ROM_BASE + o; cryTableReverse = ROM_BASE + r;
  break;
}
if (!cryTable) throw new Error('gCryTable not found');
console.log(`gCryTable at 0x${cryTable.toString(16)}, gCryTable_Reverse at 0x${cryTableReverse.toString(16)} (${NUM_CRIES} entries)`);
mark(cryTable, NUM_CRIES * 12);
mark(cryTableReverse, NUM_CRIES * 12);
let compressedCries = 0;
for (let i = 0; i < NUM_CRIES; i++) {
  const w = u32(cryTable + i * 12 + 4);
  if (u32(cryTableReverse + i * 12 + 4) !== w) console.warn(`  cry ${i}: reverse table sample differs`);
  if (!walkWave(w)) console.warn(`  cry ${i} (${cryNames[i]}): bad wave header`);
  else if (u16(w) === 1) compressedCries++;
}
console.log(`cries: ${NUM_CRIES} (${compressedCries} DPCM-compressed)`);

// species / national dex -> cry index (by matching decomp constant names)
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const cryIndexByName = new Map(cryNames.map((n, i) => [norm(n), i]));
const speciesIds = {}; // normalized name -> internal species id
for (const m of readText('include/constants/species.h').matchAll(/^#define SPECIES_(\w+)\s+(\d+)\s*$/gm)) {
  speciesIds[m[1]] = +m[2];
}
const bySpecies = [];
const speciesNames = {};
for (const [name, id] of Object.entries(speciesIds)) {
  if (name === 'NONE' || name === 'EGG') continue;
  let key = norm(name);
  if (name.startsWith('OLD_UNOWN')) key = 'unown';
  const ci = cryIndexByName.get(key);
  if (ci === undefined) { console.warn(`  no cry for SPECIES_${name}`); continue; }
  bySpecies[id] = ci;
  if (!name.startsWith('OLD_UNOWN')) speciesNames[key] = id;
}
const byNational = []; // enum order: NATIONAL_DEX_NONE = 0, BULBASAUR = 1, ...
{
  const txt = readText('include/constants/pokedex.h');
  const enumBody = txt.slice(txt.indexOf('NATIONAL_DEX_NONE'));
  const names = [...enumBody.matchAll(/NATIONAL_DEX_(\w+)\s*,/g)].map((m) => m[1]);
  names.forEach((n, i) => {
    if (i === 0) return;
    const ci = cryIndexByName.get(norm(n));
    if (ci !== undefined) byNational[i] = ci;
  });
}
for (let i = 0; i < bySpecies.length; i++) if (bySpecies[i] === undefined) bySpecies[i] = null;
for (let i = 0; i < byNational.length; i++) if (byNational[i] === undefined) byNational[i] = null;
console.log(`cry maps: ${bySpecies.filter((x) => x !== null).length} species, ${byNational.filter((x) => x !== null).length} national dex`);

// ---------------------------------------------------------------- segments
const segments = [];
let total = 0;
for (let i = 0; i < used.length;) {
  if (!used[i]) { i++; continue; }
  let s = i, e = i;
  for (;;) {
    while (e < used.length && used[e]) e++;
    let g = e;
    while (g < used.length && !used[g] && g - e < MERGE_GAP) g++;
    if (g < used.length && used[g] && g - e < MERGE_GAP) { e = g; continue; }
    break;
  }
  segments.push({ addr: ROM_BASE + s, offset: total, length: e - s });
  total += e - s;
  i = e;
}
const bin = Buffer.alloc(total);
for (const sg of segments) rom.copy(bin, sg.offset, off(sg.addr), off(sg.addr) + sg.length);

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, 'bank.bin'), bin);
const json = {
  format: 'kanto-spire-m4a-bank/1',
  source: { game: 'Pokemon FireRed (US v1.0)', sha1, songTable: SONG_TABLE },
  segments,
  songs,
  cryTable,
  cryTableReverse,
  cryCount: NUM_CRIES,
  cries: { names: cryNames, bySpecies, byNational, speciesNames },
};
fs.writeFileSync(path.join(OUT_DIR, 'bank.json'), JSON.stringify(json));
console.log(`waves: ${stats.waves.size}, programmable waves: ${stats.progWaves.size}, leaf voices: ${stats.voices.size}, rejected garbage entries: ${stats.rejected}`);
console.log(`bank.bin: ${total} bytes in ${segments.length} segments; bank.json: ${fs.statSync(path.join(OUT_DIR, 'bank.json')).size} bytes`);
