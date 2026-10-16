#!/usr/bin/env node
// Sinnoh chiptune: builds RETRO's SINNOH music, Game Boy conversions of the Platinum songs the game asks for
// (web/src/audio/sinnoh_retro.js SINNOH_SONG_SET), from the user's own ROM's sound data.
//
//   node tools/sinnoh_chip/build_bank.mjs [--out web/assets/retro_sinnoh] [--lenient]
//   node tools/sinnoh_chip/build_bank.mjs --stand-in emerald [--out <dir>]   (developer check: the same pipeline on
//                                                                          Emerald's songs, tools/hoenn_chip/m4a_trace)
// Pipeline: tools/sinnoh_chip/sseq_trace.mjs traceSseq(label) (what the real sequencer plays, m4a-style ticks) ->
// tools/hoenn_chip/m4a2gsc.mjs convert() (Gold/Silver-format song) -> tools/hoenn_chip/gsc_asm.mjs -> 16 KB banks.
// Writes (ROM-derived, gitignored, the on-demand 'retro_sinnoh' pack):
//   sinnoh.bin   bank $80 = our own engine bank (engine_bank.mjs: frequency table, wave samples, drum kits), then the
//                song banks $81, $82, ...
//   sinnoh.json  { games: { sinnoh: { file, engine: 'gsc', banks, tables, converter } },
//                  songs: { 'sinnoh:<label>': { game: 'sinnoh', bank, header, srcLoop | srcEnd } } }
// Self-contained: new GbPlayer(...).load(meta, { sinnoh: buf }) plays it with no other game loaded. Every song is
// checked in that player before anything is written: it plays, every channel loops at the source loop length (or the
// song ends at the source end), and every channel the song uses makes sound. Identical conversions share one copy.
// Deterministic: the same ROM gives the same bytes.
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { GbPlayer } from '../../web/src/audio/gb-core.js';
import { convert } from '../hoenn_chip/m4a2gsc.mjs';
import { assemble } from '../hoenn_chip/gsc_asm.mjs';
import { buildEngineBank, ENGINE_BANK } from './engine_bank.mjs';
import { SINNOH_OVERRIDES } from './overrides.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');
export const CONVERTER_VERSION = 1;
export const GAME = 'sinnoh';

const asmLabel = (song) => 'Sinnoh_' + song.replace(/\W/g, '_');
// convert() options for our engine bank: the wave channel's sample by the bass voice (engine_bank.mjs WAVE_NAMES);
// anything else gets wave 4, the default bass
const voiceText = (n) => ((n.name && [n.name.name, n.name.kind].filter(Boolean).join(' ')) || '').toLowerCase();
export const SINNOH_CONVERT_OPTS = {
  waveFor: (n) => {
    const s = voiceText(n);
    if (/synth|slap|electr|lead|saw|square/.test(s)) return 9;        // brightBass: a soft saw
    if (/organ/.test(s)) return 8;                                     // organ
    if (/pizz|pluck|acoustic|upright|contra|string|harp/.test(s)) return 7; // triangle
    if (/tuba|bassoon|horn|brass|clarinet|reed/.test(s)) return 12;     // reed
    return undefined;
  },
};

// GSC frames for ticks [t0, t1) of a trace, starting at tempo bpm (convert()'s model: tempo 38400 / bpm per tick)
function gscFrames(tr, t0, t1, bpm) {
  let f = 0, t = t0;
  for (const e of tr.tempos) if (e.tick > t0 && e.tick < t1) { f += (e.tick - t) * Math.round(38400 / bpm) / 256; t = e.tick; bpm = e.bpm; }
  return f + (t1 - t) * Math.round(38400 / bpm) / 256;
}
// The loop's tempo: a sequence may set its tempo before the loop start and change it later in the loop, then set it
// again at the loop start; a tracer that only records changes then has no tempo event at the loop start, and the
// converted song would replay the loop at the loop end's tempo. When the source's second pass (secondPassFrames)
// matches the first pass's tempo better, add the tempo at the loop start explicitly (a copy of the trace).
export function fixLoopTempo(tr) {
  const L = tr.loop;
  if (!L || !tr.tempos.length) return tr;
  const at = (tick) => { let b = tr.tempos[0].bpm; for (const x of tr.tempos) if (x.tick <= tick) b = x.bpm; return b; };
  const b0 = at(L.startTick), b1 = at(L.endTick);
  if (b0 === b1 || tr.tempos.some((x) => x.tick === L.startTick)) return tr;
  const err0 = Math.abs(gscFrames(tr, L.startTick, L.endTick, b0) - L.secondPassFrames);
  const err1 = Math.abs(gscFrames(tr, L.startTick, L.endTick, b1) - L.secondPassFrames);
  if (err0 >= err1) return tr;
  const ev = { tick: L.startTick, frame: L.startFrame, bpm: b0, added: 'loop start' };
  return { ...tr, tempos: [...tr.tempos, ev].sort((a, b) => a.tick - b.tick) };
}

// Platinum plays some cymbals (program 0 of bank 702, reverse-cymbal swells) on melodic tracks: the tracer flags those
// notes name.noise; as pitched notes they would land on a pulse or the wave channel, so they go to the drums (crash).
export function cymbalsToDrums(tr) {
  if (!tr.notes.some((n) => n.name && n.name.noise)) return tr;
  return { ...tr, notes: tr.notes.map((n) => (n.name && n.name.noise ? { ...n, rhythm: true, name: { ...n.name, kind: 'crash' } } : n)) };
}

// Per-song hand-tuning (overrides.mjs) and notes too quiet to hear: Platinum starts some songs with a volume-2 dummy
// note (silent on the DS: its volume curve is in decibels), which the Game Boy's linear envelope would make audible.
const QUIET = 0.02; // velocity x volume (of 127 x 127)
export function tuneTrace(tr) {
  const o = SINNOH_OVERRIDES[tr.song] || {};
  const bass = new Set(o.bass || []);
  const notes = tr.notes.filter((n) => n.rhythm || (n.vel / 127) * (n.vol / 127) >= QUIET)
    .map((n) => (bass.has(n.track) && !n.rhythm ? { ...n, name: { ...(n.name || {}), kind: 'bass' } } : n));
  return notes.length === tr.notes.length && !bass.size ? tr : { ...tr, notes };
}
export const songOpts = (song) => {
  const o = SINNOH_OVERRIDES[song] || {};
  return { ...(o.overrides ? { overrides: o.overrides } : {}), ...(o.wave !== undefined ? { waveFor: () => o.wave } : {}) };
};

// Converts, packs and checks. trace(label) -> a trace in m4a_trace.mjs traceSong()'s shape.
// Returns { meta, bin, problems, report }; throws on problems unless lenient (then failing songs are left out).
export function buildBank({ trace, songs, convertOpts = SINNOH_CONVERT_OPTS, lenient = false, log = console.log, maxCheckFrames = 60 * 60 * 6 }) {
  songs = [...songs].sort();
  const engine = buildEngineBank();
  const problems = [];
  // ---- trace + convert; identical songs share one copy
  const conv = new Map(), byText = new Map();
  for (const song of songs) {
    let tr, c;
    try { tr = tuneTrace(cymbalsToDrums(fixLoopTempo(trace(song)))); c = convert(tr, { ...convertOpts, ...songOpts(song), label: asmLabel(song) }); } catch (e) { problems.push(`${song}: ${e.message}`); continue; }
    const src = tr.loop ? { srcLoop: tr.loop.secondPassFrames } : { srcEnd: tr.endFrame };
    // each tempo command restarts the channels' frame fractions (GscEngine.setGlobalTempo): up to a frame lost per change
    const tempoSlack = tr.tempos.filter((x) => (tr.loop ? x.tick >= tr.loop.startTick : true) && x.tick < tr.endTick).length;
    const key = c.asm.split(c.label).join('@');
    if (byText.has(key)) { conv.set(song, { alias: byText.get(key), src, info: c.info, tempoSlack }); continue; }
    byText.set(key, song);
    conv.set(song, { ...c, src, tempoSlack });
  }
  // ---- pack: each song assembled where it lands in the current 16 KB song bank
  const pack = (list) => {
    const banks = [new Uint8Array(0x4000)];
    let used = 0;
    const where = {};
    for (const [song, c] of list) {
      if (c.alias) continue;
      let r = assemble(c.asm, { org: 0x4000 + used });
      if (used + r.bytes.length > 0x4000) { banks.push(new Uint8Array(0x4000)); used = 0; r = assemble(c.asm, { org: 0x4000 }); }
      if (r.bytes.length > 0x4000) throw new Error(`${song}: ${r.bytes.length} bytes, more than a bank`);
      banks[banks.length - 1].set(r.bytes, used);
      where[song] = { bank: ENGINE_BANK + banks.length, header: r.labels[c.label], bytes: r.bytes.length };
      used += r.bytes.length;
    }
    for (const [song, c] of list) if (c.alias && where[c.alias]) where[song] = where[c.alias];
    const bin = new Uint8Array((banks.length + 1) * 0x4000);
    bin.set(engine.bytes, 0);
    banks.forEach((b, i) => bin.set(b, (i + 1) * 0x4000));
    const meta = {
      games: { [GAME]: { file: 'sinnoh.bin', engine: 'gsc', banks: [ENGINE_BANK, ...banks.map((_, i) => ENGINE_BANK + 1 + i)], tables: engine.tables, converter: CONVERTER_VERSION } },
      songs: {},
    };
    for (const [song, c] of list) if (where[song]) meta.songs[GAME + ':' + song] = { game: GAME, bank: where[song].bank, header: where[song].header, ...c.src };
    return { meta, bin, where };
  };
  let built = pack(conv);
  // ---- check every song in the real player, self-contained
  const report = {};
  const bad = new Set();
  for (const song of songs) {
    if (!conv.has(song)) continue;
    const cs = conv.get(song);
    const r = checkSong(built.meta, built.bin, GAME + ':' + song, cs.alias ? conv.get(cs.alias).info : cs.info, maxCheckFrames, cs.tempoSlack);
    report[song] = { ...r, bytes: built.where[song] && built.where[song].bytes, alias: conv.get(song).alias || undefined };
    if (r.problems.length) { problems.push(...r.problems.map((p) => `${song}: ${p}`)); bad.add(song); }
  }
  if (problems.length && !lenient) throw new Error('SINNOH bank check failed:\n  ' + problems.join('\n  '));
  if (bad.size) {
    // drop the failing songs (and copies of them) and pack again; the rest were checked already
    for (const s of bad) conv.delete(s);
    for (const [s, c] of [...conv]) if (c.alias && bad.has(c.alias)) conv.delete(s);
    built = pack(conv);
  }
  return { ...built, problems, report, distinct: [...conv.values()].filter((c) => !c.alias).length };
}

// Plays one song in a fresh GbPlayer that has only this game loaded. info: convert()'s info (channel note counts).
// slack: extra frames of tolerance (the song's tempo changes, see buildBank)
export function checkSong(meta, bin, name, info, maxFrames = 60 * 60 * 6, slack = 0) {
  const problems = [];
  const s = meta.songs[name];
  const p = new GbPlayer(48000, () => {}, { render: 'dmg' });
  p.load(meta, { [s.game]: bin.slice().buffer });
  if (!p.has(name) || !p.playBgm(name)) return { problems: ['not playable'] };
  const e = p.bgm.engine, hits = [[], [], [], []], sound = [0, 0, 0, 0];
  e.onLoop = (c) => { if (c < 4) hits[c].push(p.frames); };
  const apu = p.apu;
  let f = 0;
  for (; f < maxFrames && !p.bgm.ended && !hits.every((h, i) => h.length >= 2 || !e.ch[i].on); f++) {
    p.frame();
    const nr51 = apu.reg[0x15];
    for (let i = 0; i < 4; i++) {
      const c = apu.ch[i];
      if (c.on && (nr51 & (0x11 << i)) && (i === 2 ? c.shift !== 4 : c.vol > 0)) sound[i]++;
    }
  }
  let loopFrames = null;
  if (s.srcLoop) {
    const lens = hits.filter((h) => h.length >= 2).map((h) => h[1] - h[0]);
    loopFrames = lens;
    if (!lens.length || lens.some((x) => Math.abs(x - s.srcLoop) > Math.max(3, s.srcLoop * 0.003) + slack)) problems.push(`loops in ${lens.join('/') || 'never'} frames, source ${s.srcLoop}`);
  } else if (Math.abs(f - s.srcEnd) > Math.max(3, s.srcEnd * 0.01) + slack) problems.push(`ends at frame ${f}, source ${s.srcEnd}`);
  const usedCh = [1, 2, 3, 4].map((c) => (info && info.channels[c] ? info.channels[c].notes : 0));
  for (let i = 0; i < 4; i++) if (usedCh[i] > 0 && sound[i] === 0) problems.push(`channel ${i + 1} has ${usedCh[i]} notes but never sounds`);
  return { problems, frames: f, loopFrames, notes: usedCh, soundFrames: sound };
}

export function writeBank(outDir, { meta, bin }) {
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'sinnoh.bin'), bin);
  fs.writeFileSync(path.join(outDir, 'sinnoh.json'), JSON.stringify(meta));
}

// the real thing: Platinum's songs (throws if the tracer or the ROM's sound data isn't there)
export async function buildSinnohBank(outDir = path.join(ROOT, 'web/assets/retro_sinnoh'), { lenient = false, log = console.log, songs } = {}) {
  const { traceSseq } = await import(pathToFileURL(path.join(HERE, 'sseq_trace.mjs')).href);
  if (!songs) ({ SINNOH_SONG_SET: songs } = await import('../../web/src/audio/sinnoh_retro.js'));
  const r = buildBank({ trace: (l) => traceSseq(l), songs, lenient, log });
  writeBank(outDir, r);
  summary(r, outDir, log);
  return r;
}

function summary(r, outDir, log) {
  const n = Object.keys(r.meta.songs).length;
  log(`wrote ${path.join(outDir, 'sinnoh.bin')}: ${n} SINNOH songs (${r.distinct} distinct), ${r.meta.games[GAME].banks.length} banks ` +
    `(engine + ${r.meta.games[GAME].banks.length - 1} song), ${r.bin.length} B; every song checked (loop/end length, sound on every used channel)`);
  if (r.problems.length) log(`left out ${r.problems.length}:\n  ` + r.problems.join('\n  '));
}

function printReport(r) {
  for (const [s, x] of Object.entries(r.report)) {
    const m = r.meta.songs[GAME + ':' + s];
    const src = m ? (m.srcLoop ? `loop ${(x.loopFrames || []).join('/')} (source ${m.srcLoop})` : `end ${x.frames} (source ${m.srcEnd})`) : 'left out';
    console.log(`  ${s.padEnd(28)} ${String(x.bytes ?? '').padStart(5)} B  ${src}  notes ${x.notes ? x.notes.join('/') : '-'}${x.alias ? '  = ' + x.alias : ''}`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  const opt = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);
  const lenient = args.includes('--lenient');
  try {
    if (opt('--stand-in') === 'emerald') {
      const { traceSong } = await import('../hoenn_chip/m4a_trace.mjs');
      const { HOENN_SONG_SET } = await import('../../web/src/audio/emerald.js');
      const out = path.resolve(opt('--out') || path.join(process.env.HOME, 'scratch/sinnoh/music/builder/emerald_bank'));
      const r = buildBank({ trace: traceSong, songs: HOENN_SONG_SET, lenient });
      writeBank(out, r);
      summary(r, out, console.log);
      if (args.includes('--report')) printReport(r);
    } else {
      const r = await buildSinnohBank(opt('--out') ? path.resolve(opt('--out')) : undefined, { lenient });
      if (args.includes('--report')) printReport(r);
    }
  } catch (e) { console.error(e.message); process.exit(1); }
}
