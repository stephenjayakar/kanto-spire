// Hoenn chiptune prototype, step 1: run an Emerald song through the game's own m4a sequencer (web/src/audio/m4a-core.js,
// no mixing) and record what every track plays, frame-exact: notes (tick, frame, key, velocity, gate, the voice that
// sounds it), volume / pan / bend changes and the loop (each track's GOTO). Nothing is decoded by hand: PATT, REPT,
// MEMACC, ties and tempo changes are whatever the real driver does.
//
//   node tools/hoenn_chip/m4a_trace.mjs mus_route101 [...]   -> prints a summary (the converter imports traceSong)
//
// Voice names (which sample or Game Boy voice each program is) come from a pret/pokeemerald checkout's
// sound/voicegroups (--decomp, default E:/BigData/games/hoenn-chiptune/pokeemerald): used only to classify instruments.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createEngine } from '../../web/src/audio/m4a-core.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DECOMP = process.env.POKEEMERALD || [path.join(ROOT, 'pokeemerald'), 'E:/BigData/games/hoenn-chiptune/pokeemerald']
  .find((d) => fs.existsSync(path.join(d, 'sound/voicegroups'))) || path.join(ROOT, 'pokeemerald');
// The voice names the converter needs, per song (tools/hoenn_chip/emerald_voices.json, written by make_voices.mjs from
// the decomp): with it, regenerating the Hoenn bank needs only the Emerald sound bank. HOENN_VOICES=decomp ignores it.
const VOICES_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'emerald_voices.json');
const VOICES = process.env.HOENN_VOICES !== 'decomp' && fs.existsSync(VOICES_FILE) ? JSON.parse(fs.readFileSync(VOICES_FILE, 'utf8')) : null;
const A = path.join(ROOT, 'web/assets/sound/');
const CLOCK = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24,
  28, 30, 32, 36, 40, 42, 44, 48, 52, 54, 56, 60, 64, 66, 68, 72, 76, 78, 80, 84, 88, 90, 92, 96];

let banks = null;
export function loadBanks() {
  if (banks) return banks;
  const rd = (f) => fs.readFileSync(A + f);
  banks = {
    fr: { json: JSON.parse(rd('bank.json')), bin: new Uint8Array(rd('bank.bin')) },
    em: { json: JSON.parse(rd('emerald/bank.json')), bin: new Uint8Array(rd('emerald/bank.bin')) },
  };
  return banks;
}
export function emeraldEngine(opts = {}) {
  const b = loadBanks();
  const e = createEngine(b.fr.bin, b.fr.json, { sampleRate: 48000, quality: 'hq', ...opts });
  e.mem.addSegments(b.em.bin, b.em.json.segments);
  return e;
}

// ---- voicegroups (pokeemerald sound/voicegroups/*.inc): program number -> { kind, name, args }
function parseVoicegroup(file) {
  if (!fs.existsSync(file)) return null;
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  let offset = 0, out = [];
  for (const raw of lines) {
    const line = raw.replace(/@.*$/, '').trim();
    if (!line) continue;
    const m = line.match(/^voice_group\s+(\w+)(?:\s*,\s*(\d+))?/);
    if (m) { offset = m[2] ? +m[2] : 0; continue; }
    const v = line.match(/^(voice_\w+)\s*(.*)$/);
    if (!v) continue;
    const args = v[2].split(',').map((s) => s.trim());
    out.push({ kind: v[1], args, name: args.find((a) => /DirectSoundWaveData_|ProgrammableWaveData_|voicegroup_|keysplit_/.test(a)) || '' });
  }
  return { offset, voices: out };
}
const vgCache = new Map();
function voicegroup(name) {
  if (vgCache.has(name)) return vgCache.get(name);
  const dir = path.join(DECOMP, 'sound/voicegroups');
  const base = name.replace(/^voicegroup_/, '');
  let vg = null;
  for (const f of [path.join(dir, base + '.inc'), path.join(dir, 'drumsets', base.replace(/_drumset$/, '') + '.inc'),
    path.join(dir, 'keysplits', base.replace(/_keysplit$/, '') + '.inc')]) {
    const p = parseVoicegroup(f);
    if (p && (f.includes('drumsets') ? /drumset/.test(name) : f.includes('keysplits') ? /keysplit/.test(name) : true)) { vg = p; break; }
  }
  vgCache.set(name, vg);
  return vg;
}
// the song's voicegroup name from sound/songs/midi/midi.cfg (-G_name)
let midiCfg = null;
export function songVoicegroup(song) {
  if (!midiCfg) {
    midiCfg = {};
    const f = path.join(DECOMP, 'sound/songs/midi/midi.cfg');
    if (fs.existsSync(f)) for (const l of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
      const m = l.match(/^(\w+)\.mid:\s*(.*)$/);
      if (m) midiCfg[m[1]] = { group: (m[2].match(/-G_?(\w+)/) || [])[1] || null, vol: +((m[2].match(/-V(\d+)/) || [])[1] || 127), flags: m[2].trim() };
    }
  }
  return midiCfg[song] || null;
}
// describe program `prog` (and drum/keysplit key) of a song: { kind, name }
export function describeVoice(song, prog, key) {
  if (VOICES && VOICES[song]) return VOICES[song][`${prog}:${key}`] || VOICES[song][prog] || { kind: '?', name: '' };
  const cfg = songVoicegroup(song);
  const vg = cfg && cfg.group ? voicegroup(cfg.group) : null;
  if (!vg) return { kind: '?', name: '' };
  const v = vg.voices[prog - vg.offset];
  if (!v) return { kind: '?', name: '' };
  if (v.kind === 'voice_keysplit_all' || v.kind === 'voice_keysplit') {
    const sub = voicegroup(v.args[0]);
    if (v.kind === 'voice_keysplit_all' && sub) {
      const d = sub.voices[key - sub.offset];
      return { kind: 'drum', name: d ? d.name || d.kind : '', drumVoice: d ? d.kind : '' };
    }
    return { kind: v.kind, name: v.args.join(' ') };
  }
  return { kind: v.kind, name: v.name, args: v.args };
}

// ---- the trace
export function traceSong(song, { maxFrames = 60 * 60 * 10 } = {}) {
  const b = loadBanks();
  const s = b.em.json.songs[song];
  if (!s) throw new Error(`${song}: not in the Emerald bank`);
  const e = emeraldEngine();
  const mem = e.mem;
  e.startSong(0, s.header);
  const mp = e.players[0];
  let frame = 0;
  const tickFrame = [];
  const notes = [], ctl = [], gotos = [], tempos = [], ties = new Map();
  const voiceOf = new Map();
  const origNote = e.plyNote.bind(e), origCmd = e.command.bind(e), origEot = e.plyEndtie.bind(e);
  e.plyNote = (idx, p, t) => {
    if (p !== mp) return origNote(idx, p, t);
    origNote(idx, p, t);
    // the tone that sounds (drum kits and key splits pick a sub-voice by key)
    const T_RHY = 0x80, T_SPL = 0x40;
    let type = t.tone.type, key = t.key, sub = null, wav = t.tone.wav, adsr = t.tone.adsr;
    if (type & (T_RHY | T_SPL)) {
      const idx2 = (type & T_SPL) ? mem.u8((t.tone.adsr + t.key) >>> 0) : t.key;
      const a = (t.tone.wav + 12 * idx2) >>> 0;
      sub = idx2;
      const st = mem.u8(a);
      if (type & T_RHY) key = mem.u8(a + 1);
      wav = mem.u32(a + 4); adsr = mem.u32(a + 8);
      type = (type & T_RHY) | st;
    }
    if (t.flags & 0x0f) e.trkVolPitSet(p, t);
    const n = {
      track: t.index, tick: p.clock, frame, key: t.key, played: key, vel: t.velocity, gate: t.gateTime,
      vol: t.vol, pan: t.pan, keyM: t.keyM, pitM: t.pitM, keyShift: t.keyShift, bend: t.bend, bendRange: t.bendRange,
      mod: t.mod, modT: t.modT, lfoSpeed: t.lfoSpeed, lfoDelay: t.lfoDelay, prog: voiceOf.get(t.index) ?? -1,
      type, rhythm: !!(type & T_RHY), cgb: type & 7, sub, wav, adsr: [adsr & 0xff, (adsr >>> 8) & 0xff, (adsr >>> 16) & 0xff, adsr >>> 24],
      duty: (type & 7) === 1 || (type & 7) === 2 ? wav & 3 : null, endTick: null,
    };
    if (n.gate === 0) { const k = `${t.index}:${t.key}`; ties.set(k, n); } else n.endTick = n.tick + n.gate;
    notes.push(n);
  };
  e.plyEndtie = (t) => {
    const b0 = mem.u8(t.cmdPtr), key = b0 < 0x80 ? b0 : t.key;
    const k = `${t.index}:${key}`;
    const n = ties.get(k);
    if (n && t.player === mp) { n.endTick = mp.clock; ties.delete(k); }
    return origEot(t);
  };
  e.command = (cmd, p, t) => {
    if (p !== mp) return origCmd(cmd, p, t);
    if (cmd === 0xB2) gotos.push({ track: t.index, tick: p.clock, frame, target: mem.u32(t.cmdPtr) });
    origCmd(cmd, p, t);
    const at = { track: t.index, tick: p.clock, frame };
    switch (cmd) {
      case 0xBB: tempos.push({ tick: p.clock, frame, bpm: p.tempoD }); break;
      case 0xBD: voiceOf.set(t.index, mem.u8(t.cmdPtr - 1)); break;
      case 0xBE: ctl.push({ ...at, vol: t.vol }); break;
      case 0xBF: ctl.push({ ...at, pan: t.pan }); break;
      case 0xC0: ctl.push({ ...at, bend: t.bend }); break;
      case 0xC1: ctl.push({ ...at, bendRange: t.bendRange }); break;
      case 0xC4: ctl.push({ ...at, mod: t.mod }); break;
      case 0xBC: ctl.push({ ...at, keyShift: t.keyShift }); break;
      default: break;
    }
  };
  const live = () => mp.tracks.filter((t) => t.flags & 0x80).map((t) => t.index);
  for (; frame < maxFrames; frame++) {
    const before = mp.clock;
    e.mplayMain(mp);
    for (let k = before; k < mp.clock; k++) tickFrame[k] = frame;
    const lv = live();
    if (!lv.length || (mp.status & 0x80000000)) break;
    if (lv.every((i) => gotos.filter((g) => g.track === i).length >= 2)) break;
  }
  tickFrame[mp.clock] = frame + 1;
  // the loop: each track's first and second GOTO
  const per = {};
  for (const g of gotos) (per[g.track] = per[g.track] || []).push(g);
  let loop = null;
  const firsts = Object.values(per).filter((l) => l.length >= 2);
  if (firsts.length) {
    const endTick = Math.max(...firsts.map((l) => l[0].tick));
    const lens = firsts.map((l) => l[1].tick - l[0].tick);
    const len = Math.max(...lens);
    loop = { endTick, startTick: endTick - len, lenTicks: len, consistent: lens.every((x) => x === len) && firsts.every((l) => l[0].tick === endTick) };
    loop.startFrame = tickFrame[loop.startTick]; loop.endFrame = tickFrame[loop.endTick];
    loop.secondPassFrames = tickFrame[loop.endTick + len] - loop.endFrame;
  }
  const endTick = loop ? loop.endTick : mp.clock;
  for (const n of notes) if (n.endTick === null) n.endTick = endTick;
  const keep = notes.filter((n) => n.tick < endTick);
  for (const n of keep) { n.endTick = Math.min(n.endTick, endTick); n.endFrame = tickFrame[n.endTick] ?? frame; n.name = describeVoice(song, n.prog, n.key); }
  return {
    song, header: s.header, trackCount: mem.u8(s.header), reverb: s.reverb, cfg: songVoicegroup(song),
    tempos, loop, endTick, endFrame: tickFrame[endTick], tickFrame: tickFrame.slice(0, endTick + 1), notes: keep,
    ctl: ctl.filter((c) => c.tick < endTick),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  for (const song of process.argv.slice(2)) {
    const t = traceSong(song);
    console.log(`${song}: ${t.trackCount} tracks, tempo ${t.tempos.map((x) => `${x.bpm}@${x.tick}`).join(' ')}, ` +
      `loop ${t.loop ? `${t.loop.startTick}-${t.loop.endTick} ticks = frames ${t.loop.startFrame}-${t.loop.endFrame} (${((t.loop.endFrame - t.loop.startFrame) / 59.7275).toFixed(2)} s, 2nd pass ${t.loop.secondPassFrames} f, consistent ${t.loop.consistent})` : 'none'}, ${t.notes.length} notes`);
    const by = {};
    for (const n of t.notes) {
      const k = n.track;
      const o = by[k] = by[k] || { n: 0, keys: [], progs: new Set(), cgb: new Set(), rhythm: 0, vel: 0, vol: 0, names: new Set() };
      o.n++; o.keys.push(n.played); o.progs.add(n.prog); o.cgb.add(n.cgb); if (n.rhythm) o.rhythm++; o.vel += n.vel; o.vol += n.vol;
      o.names.add((n.name.name || n.name.kind).replace(/DirectSoundWaveData_|ProgrammableWaveData_/g, ''));
    }
    for (const [k, o] of Object.entries(by)) {
      o.keys.sort((a, b) => a - b);
      console.log(`  tr${k}: ${o.n} notes, keys ${o.keys[0]}-${o.keys[o.keys.length - 1]} med ${o.keys[o.keys.length >> 1]}, prog ${[...o.progs]}, cgb ${[...o.cgb]}, rhythm ${o.rhythm}, vel ${(o.vel / o.n).toFixed(0)}, vol ${(o.vol / o.n).toFixed(0)} | ${[...o.names].slice(0, 4).join(', ')}`);
    }
  }
}
