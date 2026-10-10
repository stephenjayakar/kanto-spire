#!/usr/bin/env node
// Kanto Spire - Emerald (Hoenn) music extractor: a second m4a sound bank next to FireRed's.
//
// Reads the user's Pokemon Emerald (USA) ROM and writes
//   web/assets/sound/emerald/bank.bin   - the byte ranges the m4a driver reads to play the selected songs
//   web/assets/sound/emerald/bank.json  - segment map + song index (same format as FireRed's bank.json)
//
// Same static walk as tools/extract_sound.js (song headers, track streams with GOTO / PATT / REPT / MEMACC,
// voicegroups, keysplit / drumkit sub-voices for every key played, DirectSound samples, programmable waves), with
// one difference: the bank is RELOCATED. Emerald's data lives at the same GBA addresses as FireRed's
// (0x08000000-0x09000000), so every address in this bank is moved up by RELOCATE (to 0x0A000000+, the GBA's
// ROM mirror, which FireRed's bank never uses) and every pointer the driver follows (song header -> voicegroup and
// tracks, track jumps, voice -> sample / keysplit table / sub-voicegroup) is rewritten to match. The player then
// loads both banks into one address space (web/src/audio/sound.js Sound.addBank) and plays either bank's songs.
//
// Only music is taken (mus_*; not Emerald's copies of the FireRed songs, mus_rg_*, which FireRed's bank already
// has, nor the sound effects or cries). Song names come from the pokeemerald decomp (sound/song_table.inc).
//
// Usage: node tools/extract_emerald_sound.js [path/to/emerald.gba] [--decomp path/to/pokeemerald]
//   (defaults: rom/emerald.gba, pokeemerald/). Only the clean USA ROM is accepted (sha1 below).
//   --out <dir> / --relocate <n>: testing (a bank at the original addresses, to compare renders)

'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const flag = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : null);
const positional = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
const ROM_PATH = positional[0] || path.join(ROOT, 'rom', 'emerald.gba');
const DECOMP = flag('--decomp') || path.join(ROOT, 'pokeemerald');
const OUT_DIR = flag('--out') || path.join(ROOT, 'web', 'assets', 'sound', 'emerald');

const SHA1 = 'f3ae088181bf583e55daf962a92bb46f4f1d07b7'; // Pokemon - Emerald Version (USA, Europe)
const SONG_TABLE = 0x086B49F0; // gSongTable (Emerald USA)
const ROM_BASE = 0x08000000;
const RELOCATE = flag('--relocate') !== null ? +flag('--relocate') : 0x02000000; // bank addresses = ROM address + this (0x0A000000+)
const MERGE_GAP = 32;

if (!fs.existsSync(ROM_PATH)) { console.error(`Emerald ROM not found: ${ROM_PATH}`); process.exit(1); }
if (!fs.existsSync(path.join(DECOMP, 'sound', 'song_table.inc'))) { console.error(`pokeemerald decomp not found at ${DECOMP} (sound/song_table.inc); pass --decomp <path>`); process.exit(1); }
const rom = fs.readFileSync(ROM_PATH);
const sha1 = crypto.createHash('sha1').update(rom).digest('hex');
console.log(`ROM ${ROM_PATH} (${rom.length} bytes) sha1=${sha1}`);
if (sha1 !== SHA1) { console.error(`Unexpected ROM sha1 (want ${SHA1}: Pokemon Emerald USA). Refusing.`); process.exit(1); }

const used = new Uint8Array(rom.length);
const pointers = new Set(); // ROM addresses of the u32 pointers the driver follows (rewritten by RELOCATE)
const inRom = (a) => a >= ROM_BASE && a < ROM_BASE + rom.length;
const off = (a) => a - ROM_BASE;
const u8 = (a) => rom[off(a)];
const u16 = (a) => rom.readUInt16LE(off(a));
const u32 = (a) => rom.readUInt32LE(off(a));
const ptr = (a) => { pointers.add(a); return u32(a); };
function mark(a, len) {
  if (!inRom(a)) return false;
  const s = off(a), e = Math.min(rom.length, s + len);
  used.fill(1, s, e);
  return true;
}

// ---------------------------------------------------------------- song names (decomp)
const songNames = [];
const songPlayers = [];
for (const line of fs.readFileSync(path.join(DECOMP, 'sound', 'song_table.inc'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*song\s+(\w+)\s*,\s*(\w+)\s*,\s*(\d+)/);
  if (m) { songNames.push(m[1].toLowerCase()); songPlayers.push(m[2]); }
}
const wanted = (name) => name.startsWith('mus_') && !name.startsWith('mus_rg_') && name !== 'mus_dummy';

// ---------------------------------------------------------------- waves / voices (as extract_sound.js)
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
  const bytes = u16(w) === 1 ? Math.ceil(size / 64) * 33 : size + 1;
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
      const w = ptr(v + 4);
      if (inRom(w)) { mark(w, 16); stats.progWaves.add(w); }
    }
    stats.voices.add(v);
    return;
  }
  const w = ptr(v + 4);
  if (walkWave(w)) { mark(v, 12); stats.voices.add(v); }
}
function walkVoice(v, keys) {
  if (!inRom(v)) return;
  mark(v, 12);
  const type = u8(v);
  if (type & 0x40) {
    const sub = ptr(v + 4), table = ptr(v + 8);
    for (const k of keys) {
      if (!inRom(table + k)) continue;
      mark(table + k, 1);
      walkLeafVoice(sub + 12 * u8(table + k));
    }
  } else if (type & 0x80) {
    const sub = ptr(v + 4);
    for (const k of keys) walkLeafVoice(sub + 12 * k);
  } else {
    walkLeafVoice(v);
  }
}

// ---------------------------------------------------------------- track walker (as extract_sound.js, + pointers)
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
      if (cmd >= 0xCF) {
        if (u8(pos) < 0x80) {
          ctx.keys.add(u8(pos)); pos++;
          if (u8(pos) < 0x80) { pos++; if (u8(pos) < 0x80) pos++; }
        }
      } else if (cmd >= 0xB1) {
        switch (cmd) {
          case 0xB1: end = true; break;
          case 0xB2: queue.push([ptr(pos), rs]); pos += 4; end = true; break;
          case 0xB3: queue.push([ptr(pos), rs]); pos += 4; break;
          case 0xB4: break;
          case 0xB5: {
            const n = u8(pos); queue.push([ptr(pos + 1), rs]); pos += 5;
            if (n === 0) end = true; break;
          }
          case 0xB9: {
            const op = u8(pos); pos += 3;
            if (op >= 6 && op <= 17) { queue.push([ptr(pos), rs]); pos += 4; }
            break;
          }
          case 0xBD: ctx.voices.add(u8(pos)); pos++; break;
          case 0xBA: case 0xBB: case 0xBC: case 0xBE: case 0xBF: case 0xC0:
          case 0xC1: case 0xC2: case 0xC3: case 0xC4: case 0xC5: case 0xC8:
            pos++; break;
          case 0xCC: pos += 2; break;
          case 0xCD: {
            const n = u8(pos); pos++;
            if (n === 1) { ctx.xwaves.add(ptr(pos)); pos += 4; }
            else if (n >= 2 && n <= 11 && n !== 3) pos += 1;
            else if (n === 12) pos += 2;
            else if (n === 13) pos += 4;
            else end = true;
            break;
          }
          case 0xCE: if (u8(pos) < 0x80) { ctx.keys.add(u8(pos)); pos++; } break;
          default: end = true;
        }
      }
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
  for (let i = 0; i < tc; i++) walkTrack(ptr(hdr + 8 + 4 * i), ctx);
  const tone = ptr(hdr + 4);
  for (const v of ctx.voices) walkVoice(tone + 12 * v, ctx.keys);
  for (const w of ctx.xwaves) walkWave(w);
  return { trackCount: tc, priority: u8(hdr + 2), reverb: u8(hdr + 3), tone };
}

// ---------------------------------------------------------------- songs
const songs = {};
const seenHeaders = new Map();
for (let i = 0; i < songNames.length; i++) {
  const name = songNames[i];
  if (!wanted(name)) continue;
  const e = SONG_TABLE + i * 8;
  const hdr = u32(e), ms = u16(e + 4), me = u16(e + 6);
  if (!seenHeaders.has(hdr)) seenHeaders.set(hdr, walkSong(hdr));
  const info = seenHeaders.get(hdr);
  if (!info) { console.warn(`  ${name}: bad header pointer`); continue; }
  songs[name] = { index: i, header: hdr + RELOCATE, player: ms, me, tracks: info.trackCount, priority: info.priority, reverb: info.reverb };
}
console.log(`songs: ${Object.keys(songs).length} (${seenHeaders.size} distinct headers)`);

// ---------------------------------------------------------------- segments + relocation
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
// rewrite every followed pointer that points into the ROM (they all sit inside the copied ranges)
const segOf = (a) => { let lo = 0, hi = segments.length - 1; while (lo <= hi) { const m = (lo + hi) >> 1, s = segments[m]; if (a < s.addr) hi = m - 1; else if (a >= s.addr + s.length) lo = m + 1; else return s; } return null; };
let moved = 0, outside = 0;
for (const p of pointers) {
  const s = segOf(p);
  if (!s || p + 4 > s.addr + s.length) { outside++; continue; }
  const o = s.offset + (p - s.addr), v = bin.readUInt32LE(o);
  if (inRom(v)) { bin.writeUInt32LE(v + RELOCATE, o); moved++; }
}
if (outside) console.warn(`  ${outside} pointer(s) outside the copied ranges (left as they are)`);
for (const sg of segments) sg.addr += RELOCATE;

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, 'bank.bin'), bin);
const json = {
  format: 'kanto-spire-m4a-bank/1',
  source: { game: 'Pokemon Emerald (USA)', sha1, songTable: SONG_TABLE, relocate: RELOCATE },
  segments,
  songs,
};
fs.writeFileSync(path.join(OUT_DIR, 'bank.json'), JSON.stringify(json));
console.log(`waves: ${stats.waves.size}, programmable waves: ${stats.progWaves.size}, leaf voices: ${stats.voices.size}, rejected garbage entries: ${stats.rejected}, pointers relocated: ${moved}`);
console.log(`wrote ${path.relative(ROOT, path.join(OUT_DIR, 'bank.bin'))}: ${total} bytes in ${segments.length} segments; bank.json: ${fs.statSync(path.join(OUT_DIR, 'bank.json')).size} bytes`);
