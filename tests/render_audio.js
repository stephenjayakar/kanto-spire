#!/usr/bin/env node
// Offline render + sanity test for the m4a engine (web/src/audio/m4a-core.js).
//
//   node tests/render_audio.js            render the standard set to tests/out/*.wav and assert
//   node tests/render_audio.js --all      also run every song in the bank (sequencer + mixer) for
//                                         a while and report unmapped bank reads / errors
//
// Checks: output finite, not silent, not constantly clipping; RMS/peak stats; the bank covers
// every byte the driver reads; sequencer timing vs. the decomp MIDI files (tempo, note counts,
// loop length in ticks).
'use strict';
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(__dirname, 'out');
const RATE = 48000;

function writeWav(file, L, R, rate) {
  const n = L.length;
  const buf = Buffer.alloc(44 + n * 4);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(L[i] * 32767))), 44 + i * 4);
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(R[i] * 32767))), 46 + i * 4);
  }
  fs.writeFileSync(file, buf);
}

function stats(L, R) {
  let sum = 0, peak = 0, clip = 0, finite = true, nonzero = 0;
  for (let i = 0; i < L.length; i++) {
    for (const v of [L[i], R[i]]) {
      if (!Number.isFinite(v)) { finite = false; continue; }
      const a = Math.abs(v);
      sum += v * v; if (a > peak) peak = a; if (a >= 0.999) clip++; if (a > 1e-4) nonzero++;
    }
  }
  const n = L.length * 2;
  return { rms: Math.sqrt(sum / n), peak, clipFrac: clip / n, finite, activeFrac: nonzero / n };
}
const db = (x) => (x > 0 ? (20 * Math.log10(x)).toFixed(1) : '-inf');

// --------------------------------------------------------------------------- MIDI parsing
function parseMidi(file) {
  const b = fs.readFileSync(file);
  let p = 0;
  const u32 = () => { const v = b.readUInt32BE(p); p += 4; return v; };
  const u16 = () => { const v = b.readUInt16BE(p); p += 2; return v; };
  if (b.toString('ascii', 0, 4) !== 'MThd') throw new Error('not midi');
  p = 4; const hl = u32(); const fmt = u16(); const ntrk = u16(); const division = u16(); p = 8 + hl;
  const tempos = [], markers = [], notesByChannel = {};
  let endTick = 0;
  for (let t = 0; t < ntrk; t++) {
    if (b.toString('ascii', p, p + 4) !== 'MTrk') break;
    p += 4; const len = u32(); const end = p + len;
    let tick = 0, rs = 0;
    const vlq = () => { let v = 0, c; do { c = b[p++]; v = (v << 7) | (c & 0x7F); } while (c & 0x80); return v; };
    while (p < end) {
      tick += vlq();
      let st = b[p];
      if (st & 0x80) p++; else st = rs;
      if (st === 0xFF) {
        const type = b[p++]; const l = vlq(); const data = b.slice(p, p + l); p += l;
        if (type === 0x51) tempos.push({ tick, uspq: (data[0] << 16) | (data[1] << 8) | data[2] });
        if (type === 0x06) markers.push({ tick, text: data.toString('latin1') });
        if (type === 0x2F) endTick = Math.max(endTick, tick);
      } else if (st === 0xF0 || st === 0xF7) { const l = vlq(); p += l; }
      else {
        rs = st;
        const hi = st & 0xF0, ch = st & 0x0F;
        const nb = (hi === 0xC0 || hi === 0xD0) ? 1 : 2;
        const d1 = b[p], d2 = b[p + 1]; p += nb;
        if (hi === 0x90 && d2 > 0) (notesByChannel[ch] = notesByChannel[ch] || []).push(tick);
      }
    }
    p = end;
  }
  return { fmt, division, tempos, markers, notesByChannel, endTick };
}

// --------------------------------------------------------------------------- main
(async () => {
  const core = await import(pathToFileURL(path.join(ROOT, 'web/src/audio/m4a-core.js')).href);
  const bankJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'web/assets/sound/bank.json'), 'utf8'));
  const bankBin = new Uint8Array(fs.readFileSync(path.join(ROOT, 'web/assets/sound/bank.bin')));
  fs.mkdirSync(OUT, { recursive: true });
  const failures = [];
  const check = (cond, msg) => { if (!cond) { failures.push(msg); console.log('  FAIL: ' + msg); } };

  const newEngine = (opts = {}) => core.createEngine(bankBin, bankJson, { sampleRate: RATE, ...opts });

  function render(name, seconds, setup) {
    const eng = newEngine();
    setup(eng);
    const n = Math.round(seconds * RATE);
    const L = new Float32Array(n), R = new Float32Array(n);
    const t0 = process.hrtime.bigint();
    for (let o = 0; o < n; o += 128) eng.process(L, R, Math.min(128, n - o), o);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    writeWav(path.join(OUT, name + '.wav'), L, R, RATE);
    const s = stats(L, R);
    console.log(`${name.padEnd(26)} ${seconds.toFixed(1).padStart(5)}s  rms ${db(s.rms).padStart(6)} dBFS  peak ${db(s.peak).padStart(6)} dBFS  ` +
      `clip ${(s.clipFrac * 100).toFixed(3)}%  active ${(s.activeFrac * 100).toFixed(0)}%  ` +
      `render ${(seconds * 1000 / ms).toFixed(0)}x realtime  misses ${eng.mem.misses}`);
    check(s.finite, `${name}: non-finite samples`);
    check(s.rms > 0.003, `${name}: silent (rms ${s.rms})`);
    check(s.clipFrac < 0.001, `${name}: clipping ${(s.clipFrac * 100).toFixed(2)}%`);
    check(eng.mem.misses === 0, `${name}: ${eng.mem.misses} reads outside the bank (${[...eng.mem.missSet].slice(0, 4).map((a) => a.toString(16))})`);
    return { eng, s };
  }
  const song = (n) => { const s = bankJson.songs[n]; if (!s) throw new Error('no song ' + n); return s; };
  const playSong = (n) => (eng) => eng.startSong(song(n).player, song(n).header, n);

  console.log('--- renders (tests/out) ---');
  for (const [n, secs] of [['mus_title', 40], ['mus_route1', 60], ['mus_pallet', 45], ['mus_vs_wild', 60],
    ['mus_vs_gym_leader', 60], ['mus_vs_trainer', 30], ['mus_poke_center', 30], ['mus_viridian_forest', 30]]) {
    render(n, secs, playSong(n));
  }
  render('se_select', 1.5, playSong('se_select'));
  render('se_ball_throw', 2, playSong('se_ball_throw'));
  render('mus_level_up', 4, playSong('mus_level_up'));
  const pika = bankJson.cries.bySpecies[bankJson.cries.speciesNames.pikachu];
  const chz = bankJson.cries.bySpecies[bankJson.cries.speciesNames.charizard];
  render('cry_pikachu', 2.5, (e) => e.playCry(pika, {}));
  render('cry_charizard_encounter', 3, (e) => e.playCry(chz, { mode: 'encounter' }));
  render('cry_charizard_faint', 3, (e) => e.playCry(chz, { mode: 'faint' }));
  render('mix_route1_se_cry', 8, (e) => {
    playSong('mus_route1')(e);
    let f = 0;
    const orig = e.runFrame.bind(e);
    e.runFrame = () => { f++; if (f === 120) playSong('se_select')(e); if (f === 180) e.playCry(pika, {}); orig(); };
  });
  {
    // fade-out: level in the last second must be ~silent
    const { s } = render('mus_route1_fadeout', 6, (e) => {
      playSong('mus_route1')(e);
      let f = 0; const orig = e.runFrame.bind(e);
      e.runFrame = () => { if (++f === 120) e.fadeOutPlayer(0, 8); orig(); };
    });
    void s;
  }

  // --------------------------------------------------------------------------- MIDI timing check
  console.log('--- sequencer vs decomp MIDI (pokefirered/sound/songs/midi) ---');
  const midiDir = path.join(ROOT, 'pokefirered/sound/songs/midi');
  function sequencerProfile(name, maxTicks = 20000) {
    const eng = newEngine();
    const s = song(name);
    eng.startSong(s.player, s.header, name);
    const mp = eng.players[s.player];
    const notes = new Map(); const gotoTick = new Map(); const tempos = [];
    const origNote = eng.plyNote.bind(eng), origCmd = eng.command.bind(eng);
    eng.plyNote = (idx, m, t) => { if (m === mp && !gotoTick.has(t.index)) notes.set(t.index, (notes.get(t.index) || 0) + 1); origNote(idx, m, t); };
    eng.command = (cmd, m, t) => {
      if (m === mp && cmd === 0xB2 && !gotoTick.has(t.index)) gotoTick.set(t.index, m.clock);
      if (m === mp && cmd === 0xBB) tempos.push({ tick: m.clock, bpm: eng.mem.u8(t.cmdPtr) * 2 });
      origCmd(cmd, m, t);
    };
    let frames = 0;
    while (mp.clock < maxTicks && frames < 200000) {
      for (const p of eng.players) eng.mplayMain(p);
      eng.cgbSound(); eng.mixFrame(); frames++;
      if (mp.status & 0x80000000) break;
      const tc = eng.mem.u8(s.header);
      if (gotoTick.size >= tc) break;
    }
    return { notes, gotoTick, tempos, frames, ticks: mp.clock };
  }
  for (const name of ['mus_route1', 'mus_pallet', 'mus_title', 'mus_vs_wild', 'mus_vs_gym_leader', 'mus_poke_center', 'mus_level_up']) {
    const mf = path.join(midiDir, name + '.mid');
    if (!fs.existsSync(mf)) { console.log(`${name}: no midi`); continue; }
    const mid = parseMidi(mf);
    const prof = sequencerProfile(name);
    const toSeq = 24 / mid.division; // m4a: 24 ticks per quarter note
    const loopEnd = mid.markers.find((m) => m.text === ']');
    const midiLoopTicks = loopEnd ? Math.round(loopEnd.tick * toSeq) : Math.round(mid.endTick * toSeq);
    const engLoop = prof.gotoTick.size ? Math.max(...prof.gotoTick.values()) : prof.ticks;
    const midiBpm = mid.tempos.length ? Math.round(60e6 / mid.tempos[0].uspq) : null;
    const engBpm = prof.tempos.length ? prof.tempos[0].bpm : 150;
    // notes before the loop end, all channels
    const lim = loopEnd ? loopEnd.tick : Infinity;
    let midiNotes = 0;
    for (const arr of Object.values(mid.notesByChannel)) midiNotes += arr.filter((t) => t < lim).length;
    let engNotes = 0; for (const v of prof.notes.values()) engNotes += v;
    const secs = prof.frames / core.FRAME_RATE;
    console.log(`${name.padEnd(20)} tempo midi ${midiBpm} / engine ${engBpm} bpm | loop/end ticks midi ${midiLoopTicks} / engine ${engLoop} | ` +
      `notes midi ${midiNotes} / engine ${engNotes} | first pass ${secs.toFixed(1)}s`);
    check(midiBpm === null || Math.abs(midiBpm - engBpm) <= 2, `${name}: tempo mismatch ${midiBpm} vs ${engBpm}`);
    check(Math.abs(midiLoopTicks - engLoop) <= 2, `${name}: loop length mismatch ${midiLoopTicks} vs ${engLoop}`);
    check(Math.abs(midiNotes - engNotes) <= Math.max(2, midiNotes * 0.01), `${name}: note count mismatch ${midiNotes} vs ${engNotes}`);
  }

  // --------------------------------------------------------------------------- all songs
  if (process.argv.includes('--all')) {
    console.log('--- every song: 20 s rendered + 4 min of frames each, bank coverage ---');
    let bad = 0;
    for (const [name, s] of Object.entries(bankJson.songs)) {
      const eng = newEngine();
      eng.startSong(s.player, s.header, name);
      const n = 20 * RATE, L = new Float32Array(4096), R = new Float32Array(4096);
      let sum = 0, peak = 0, ok = true;
      try {
        for (let o = 0; o < n; o += 4096) {
          eng.process(L, R, 4096);
          for (let i = 0; i < 4096; i++) { const v = L[i]; if (!Number.isFinite(v)) ok = false; sum += v * v; peak = Math.max(peak, Math.abs(v)); }
        }
        // then ~4 more minutes of frames without output rendering (coverage of later sections)
        for (let f = 0; f < 240 * 60; f++) eng.runFrame();
      } catch (e) { ok = false; console.log(`${name}: EXCEPTION ${e.stack}`); }
      const rms = Math.sqrt(sum / n);
      if (!ok || eng.mem.misses || (rms < 1e-4 && name !== 'mus_dummy')) {
        bad++;
        console.log(`${name}: ok=${ok} misses=${eng.mem.misses} rms=${rms.toExponential(2)} peak=${peak.toFixed(3)} ${[...eng.mem.missSet].slice(0, 4).map((a) => a.toString(16))}`);
      }
    }
    console.log(`${Object.keys(bankJson.songs).length} songs checked, ${bad} with problems`);
    check(bad === 0, `${bad} songs with problems`);
    // every cry
    let badCries = 0;
    for (let i = 0; i < bankJson.cryCount; i++) {
      const eng = newEngine();
      eng.playCry(i, {});
      const L = new Float32Array(RATE), R = new Float32Array(RATE);
      eng.process(L, R, RATE);
      let sum = 0; for (let k = 0; k < RATE; k++) sum += L[k] * L[k];
      if (eng.mem.misses || sum === 0) { badCries++; console.log(`cry ${i} (${bankJson.cries.names[i]}): misses ${eng.mem.misses} energy ${sum}`); }
    }
    console.log(`${bankJson.cryCount} cries checked, ${badCries} with problems`);
    check(badCries === 0, `${badCries} cries with problems`);
  }

  console.log(failures.length ? `\n${failures.length} FAILURE(S)` : '\nALL CHECKS PASSED');
  process.exit(failures.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
