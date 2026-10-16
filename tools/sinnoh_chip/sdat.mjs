// Sinnoh chiptune, step 0: read Platinum's sound archive (data/sound/pl_sound_data.sdat) straight from the user's own
// ROM (rom/platinum.nds, sha1-checked against web/src/game/caps.js ROMS.platinum) and parse the parts the tracer needs:
//   - SYMB (names), INFO (per-sequence bank / volume / player, per-bank wave archives), FAT (file offsets);
//   - SSEQ files (the sequence bytecode), SBNK banks (instruments: PCM / PSG pulse with duty / noise / drum set / key
//     split), SWAR wave archives (each SWAV's header, and a decoder for analysing drum samples).
// Nothing is written anywhere: everything stays in memory.
//
//   import { loadSdat } from './sdat.mjs';
//   const sd = loadSdat();          // or loadSdat('/path/to/platinum.nds' | '/path/to/x.sdat')
//   sd.seqs.SEQ_BA_GYM  -> { id, name, data (Uint8Array, the SSEQ command stream), dataOffset, bank, vol, cpr, ppr, player }
//   sd.banks[id]        -> { id, name, wavearcs: [swar ids x4], instruments: [inst|null] }
//   sd.wavearcs[id]     -> { id, name, swavs: [{ type, loop, rate, timer, loopStart, loopLen, offset, size }], decode(i) }
//   instrument: { type: 1 pcm | 2 psg | 3 noise | 0x10 drums | 0x11 split, ...noteDef } | { type, regions: [{ lo, hi, def }] }
//   noteDef: { type, swav, swar, baseKey, attack, decay, sustain, release, pan }   (swar: index 0-3 into bank.wavearcs;
//   for PSG pulse, swav = duty 0-6 = 12.5%..87.5%)
//   sd.resolve(bankId, prog, key) -> { def, wavearc, region } the note definition that sounds key (null if none)
//   node tools/sinnoh_chip/sdat.mjs [SEQ_NAME]   -> summary
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { ROMS } from '../../web/src/game/caps.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DEFAULT_ROM = path.join(ROOT, 'rom', 'platinum.nds');
const SDAT_PATH = 'data/sound/pl_sound_data.sdat';

const u8 = (b, o) => b[o];
const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const str = (b, o, n) => String.fromCharCode(...b.subarray(o, o + n));
const cstr = (b, o) => { let e = o; while (b[e]) e++; return String.fromCharCode(...b.subarray(o, e)); };

// ---- NDS filesystem: FNT walk -> file id of a path, FAT -> bytes
export function ndsFile(rom, want) {
  const fnt = u32(rom, 0x40), fat = u32(rom, 0x48);
  const walk = (dir, prefix) => {
    const e = fnt + (dir & 0xfff) * 8;
    let p = fnt + u32(rom, e), fid = u16(rom, e + 4);
    for (;;) {
      const t = rom[p++]; if (!t) return null;
      const len = t & 0x7f, name = str(rom, p, len); p += len;
      if (t & 0x80) { const sub = u16(rom, p); p += 2; if (want.startsWith(prefix + name + '/')) { const r = walk(sub, prefix + name + '/'); if (r !== null) return r; } }
      else { if (prefix + name === want) return fid; fid++; }
    }
  };
  const fid = walk(0xf000, '');
  if (fid === null) throw new Error(`${want}: not in the ROM's file system`);
  const s = u32(rom, fat + fid * 8), e = u32(rom, fat + fid * 8 + 4);
  return rom.subarray(s, e);
}

export function readSdatBytes(romPath = DEFAULT_ROM) {
  const buf = new Uint8Array(fs.readFileSync(romPath));
  if (str(buf, 0, 4) === 'SDAT') return buf;
  const code = str(buf, 0x0c, 4);
  if (!ROMS.platinum.codes.includes(code)) throw new Error(`${romPath}: game code ${code}, not Pokemon Platinum (${ROMS.platinum.codes})`);
  const sha1 = crypto.createHash('sha1').update(buf).digest('hex');
  if (!ROMS.platinum.sha1.includes(sha1)) throw new Error(`${romPath}: sha1 ${sha1} is not an accepted clean Platinum dump (${ROMS.platinum.sha1.join(', ')})`);
  return ndsFile(buf, SDAT_PATH);
}

// ---- SWAV decoding (for analysis): -> Float32Array in [-1, 1]
const IMA_STEP = [7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45, 50, 55, 60, 66, 73, 80, 88, 97, 107, 118, 130, 143,
  157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408, 449, 494, 544, 598, 658, 724, 796, 876, 963, 1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066,
  2272, 2499, 2749, 3024, 3327, 3660, 4026, 4428, 4871, 5358, 5894, 6484, 7132, 7845, 8630, 9493, 10442, 11487, 12635, 13899, 15289, 16818, 18500,
  20350, 22385, 24623, 27086, 29794, 32767];
const IMA_IDX = [-1, -1, -1, -1, 2, 4, 6, 8];
export function decodeSwav(bytes, w) {
  const d = bytes.subarray(w.offset + 12, w.offset + w.size);
  if (w.type === 0) { const o = new Float32Array(d.length); for (let i = 0; i < d.length; i++) o[i] = ((d[i] << 24) >> 24) / 128; return o; }
  if (w.type === 1) { const n = d.length >> 1, o = new Float32Array(n); for (let i = 0; i < n; i++) o[i] = ((u16(d, i * 2) << 16) >> 16) / 32768; return o; }
  // IMA-ADPCM: 4-byte header (initial sample s16, step index), then nibbles low first
  let s = (u16(d, 0) << 16) >> 16, idx = Math.min(88, d[2] & 0x7f);
  const o = new Float32Array((d.length - 4) * 2);
  for (let i = 4, k = 0; i < d.length; i++) for (const nib of [d[i] & 15, d[i] >> 4]) {
    const st = IMA_STEP[idx];
    let diff = st >> 3; if (nib & 1) diff += st >> 2; if (nib & 2) diff += st >> 1; if (nib & 4) diff += st;
    s = nib & 8 ? Math.max(-32768, s - diff) : Math.min(32767, s + diff);
    idx = Math.max(0, Math.min(88, idx + IMA_IDX[nib & 7]));
    o[k++] = s / 32768;
  }
  return o;
}

function parseSwar(b) {
  const n = u32(b, 0x38), swavs = [];
  for (let i = 0; i < n; i++) {
    const off = u32(b, 0x3c + i * 4), end = i + 1 < n ? u32(b, 0x3c + (i + 1) * 4) : b.length;
    // loopStart / loopLen in 32-bit words of the data (ADPCM: includes its 4-byte header)
    swavs.push({ type: b[off], loop: b[off + 1], rate: u16(b, off + 2), timer: u16(b, off + 4), loopStart: u16(b, off + 6),
      loopLen: u32(b, off + 8), offset: off, size: end - off });
  }
  return swavs;
}
const noteDef = (b, o, type) => ({ type, swav: u16(b, o), swar: u16(b, o + 2), baseKey: b[o + 4], attack: b[o + 5], decay: b[o + 6],
  sustain: b[o + 7], release: b[o + 8], pan: b[o + 9] });
function parseSbnk(b) {
  const n = u32(b, 0x38), out = [];
  for (let i = 0; i < n; i++) {
    const r = 0x3c + i * 4, type = b[r], off = u16(b, r + 1);
    if (type === 0) { out.push(null); continue; }
    if (type < 0x10) { out.push(noteDef(b, off, type)); continue; }
    if (type === 0x10) {
      const lo = b[off], hi = b[off + 1], regions = [];
      for (let k = lo; k <= hi; k++) { const o = off + 2 + (k - lo) * 12; regions.push({ lo: k, hi: k, def: noteDef(b, o + 2, b[o]) }); }
      out.push({ type, lo, hi, regions }); continue;
    }
    if (type === 0x11) {
      const regions = []; let lo = 0, o = off + 8;
      for (let k = 0; k < 8 && b[off + k]; k++) { const hi = b[off + k]; regions.push({ lo, hi, def: noteDef(b, o + 2, b[o]) }); lo = hi + 1; o += 12; }
      out.push({ type, regions }); continue;
    }
    out.push({ type, unknown: true });
  }
  return out;
}

let cache = new Map();
export function loadSdat(romPath = DEFAULT_ROM) {
  if (cache.has(romPath)) return cache.get(romPath);
  const sd = readSdatBytes(romPath);
  if (str(sd, 0, 4) !== 'SDAT') throw new Error('not an SDAT');
  const symb = u32(sd, 0x10), info = u32(sd, 0x18), fat = u32(sd, 0x20);
  const fatN = u32(sd, fat + 8);
  const file = (id) => { if (id >= fatN) return null; const o = u32(sd, fat + 12 + id * 16), n = u32(sd, fat + 16 + id * 16); return sd.subarray(o, o + n); };
  const names = (rec) => {
    if (!symb) return [];
    const r = symb + u32(sd, symb + 8 + rec * 4), n = u32(sd, r), out = [];
    for (let i = 0; i < n; i++) { const o = u32(sd, r + 4 + i * 4); out.push(o ? cstr(sd, symb + o) : ''); }
    return out;
  };
  const infos = (rec) => {
    const r = info + u32(sd, info + 8 + rec * 4), n = u32(sd, r), out = [];
    for (let i = 0; i < n; i++) { const o = u32(sd, r + 4 + i * 4); out.push(o ? info + o : 0); }
    return out;
  };
  const seqNames = names(0), bankNames = names(2), waNames = names(3);
  const wavearcs = [], banks = [], seqs = {}, seqList = [];
  infos(3).forEach((o, id) => {
    if (!o) { wavearcs.push(null); return; }
    const b = file(u16(sd, o));
    if (!b || str(b, 0, 4) !== 'SWAR') { wavearcs.push(null); return; }
    const swavs = parseSwar(b);
    wavearcs.push({ id, name: waNames[id] || `WAVE_${id}`, bytes: b, swavs, decode: (i) => decodeSwav(b, swavs[i]) });
  });
  infos(2).forEach((o, id) => {
    if (!o) { banks.push(null); return; }
    const b = file(u16(sd, o));
    if (!b || str(b, 0, 4) !== 'SBNK') { banks.push(null); return; }
    banks.push({ id, name: bankNames[id] || `BANK_${id}`, wavearcs: [0, 1, 2, 3].map((k) => { const w = u16(sd, o + 4 + k * 2); return w === 0xffff ? null : w; }),
      instruments: parseSbnk(b) });
  });
  infos(0).forEach((o, id) => {
    if (!o) return;
    const b = file(u16(sd, o));
    if (!b || str(b, 0, 4) !== 'SSEQ') return;
    const dataOffset = u32(b, 0x18);
    const s = { id, name: seqNames[id] || `SEQ_${id}`, data: b.subarray(dataOffset), dataOffset, bank: u16(sd, o + 4), vol: sd[o + 6],
      cpr: sd[o + 7], ppr: sd[o + 8], player: sd[o + 9] };
    seqs[s.name] = s; seqList[id] = s;
  });
  const resolve = (bankId, prog, key) => {
    const bank = banks[bankId];
    const inst = bank && bank.instruments[prog];
    if (!inst || inst.unknown) return null;
    let def = inst, region = null;
    if (inst.type >= 0x10) {
      region = inst.regions.find((r) => key >= r.lo && key <= r.hi) || null;
      if (!region) return null;
      def = region.def;
    }
    if (!def || def.type === 0 || def.type > 4) return null;
    const waId = def.type === 1 || def.type === 4 ? bank.wavearcs[def.swar] : null;
    return { inst, def, region, wavearcId: waId, wavearc: waId !== null && waId !== undefined ? wavearcs[waId] : null };
  };
  const out = { bytes: sd, seqs, seqList, banks, wavearcs, resolve };
  cache.set(romPath, out);
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const sd = loadSdat();
  console.log(`SDAT: ${Object.keys(sd.seqs).length} sequences, ${sd.banks.filter(Boolean).length} banks, ${sd.wavearcs.filter(Boolean).length} wave archives`);
  for (const name of process.argv.slice(2)) {
    const s = sd.seqs[name];
    if (!s) { console.log(`${name}: not found`); continue; }
    const bank = sd.banks[s.bank];
    console.log(`${name}: #${s.id}, ${s.data.length} bytes, bank ${s.bank} (${bank && bank.name}, wavearcs ${bank && bank.wavearcs}), vol ${s.vol}, player ${s.player}`);
    if (bank) bank.instruments.forEach((inst, i) => {
      if (!inst) return;
      const d = (x) => `${['-', 'pcm', 'psg', 'noise', 'dpcm'][x.type] || x.type}${x.type === 2 ? ` duty${x.swav}` : x.type === 1 ? ` w${x.swar}:${x.swav}` : ''} k${x.baseKey} adsr ${x.attack},${x.decay},${x.sustain},${x.release} p${x.pan}`;
      console.log(`  ${i}: ${inst.type >= 0x10 ? `${inst.type === 0x10 ? 'drums' : 'split'} ` + inst.regions.map((r) => `[${r.lo}-${r.hi} ${d(r.def)}]`).join(' ') : d(inst)}`);
    });
  }
}
