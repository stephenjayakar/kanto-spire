// Hoenn chiptune prototype, step 2: an Emerald song (m4a_trace.mjs) -> a Gold/Silver-format song in pokecrystal macro
// syntax (gsc_asm.mjs assembles it for gb-core.js GscEngine). Fully automatic:
//   - every note is classed by its voice: percussion (drum kits, the GBA noise voice, timpani), bass (bass samples)
//     or melodic; a "part" is one track's notes of one class;
//   - the song is cut into one-bar windows (96 ticks); per window the loudest, highest, busiest melodic part becomes
//     pulse 1 (the melody), the best remaining non-duplicate part pulse 2 (counter-melody / harmony), the busiest bass
//     part the wave channel, and every percussion hit the noise channel (one hit at a time, by priority). A part keeps
//     its channel unless another beats it clearly (hysteresis), so lines don't flicker;
//   - each channel is reduced to one voice (the newest note; in a chord the top note, or the second for pulse 2);
//   - timing: GSC's own model, tempo = 38400 / bpm so that one note_type unit is one m4a tick (1/24 beat): the song
//     runs at the original tempo and every channel loops at the same tick as Emerald's GOTOs;
//   - volume (velocity x track volume) -> envelope start level, normalised per channel; the voice's ADSR -> envelope
//     decay; the voice -> pulse duty (Emerald's own Game Boy voices keep their duty); vibrato from the track's LFO;
//   - drums: the sample's name (or the General MIDI key) -> a role (kick, snare, hats, crash, tom, tick) -> a note of
//     Silver's drum kit 3.
import { traceSong } from './m4a_trace.mjs';
import { OVERRIDES } from './overrides.mjs';

const W = 96;                          // window: one 4/4 bar of m4a ticks
// Silver drum kit 3 (pokegold audio/drumkits.asm Drumkit3)
export const KIT3 = { kick: 11, kickSoft: 4, snare: 1, snareSoft: 3, snareQuiet: 2, hatClosed: 9, hatPedal: 8, hatOpen: 7, crash: 12, tick: 5, tom: 4, timpani: 4 };
const DRUM_PRIO = { crash: 7, kick: 6, snare: 5, timpani: 4.5, tom: 4, snareSoft: 3.5, tick: 2, hatOpen: 1.5, hatClosed: 1, hatPedal: 0.5 };
const GM = (k) => (k === 35 || k === 36 ? 'kick' : k === 38 || k === 40 || k === 39 ? 'snare' : k === 37 ? 'tick' : k === 42 ? 'hatClosed'
  : k === 44 ? 'hatPedal' : k === 46 ? 'hatOpen' : [49, 52, 55, 57].includes(k) ? 'crash' : [51, 53, 59].includes(k) ? 'hatOpen'
    : [41, 43, 45, 47, 48, 50].includes(k) ? 'tom' : [54, 69, 70, 82].includes(k) ? 'hatPedal' : [56, 75, 76, 77, 80, 81].includes(k) ? 'tick'
      : [60, 61, 62, 63, 64, 65, 66].includes(k) ? (k >= 62 ? 'tom' : 'tick') : 'hatClosed');

const nm = (n) => ((n.name && (n.name.name || n.name.kind)) || '').toLowerCase();
export function drumRole(n) {
  const s = nm(n);
  if (!n.rhythm && n.cgb === 4) return n.played >= 60 ? 'hatClosed' : 'snareSoft';
  if (/kick|bass_drum/.test(s)) return 'kick';
  if (/timpani_with_snare/.test(s)) return 'snare';
  if (/timpani/.test(s)) return 'timpani';
  if (/snare|clap/.test(s)) return /rnd|orchestra|jazz|power|gated|brush/.test(s) || n.vel > 90 ? 'snare' : 'snareSoft';
  if (/open/.test(s) && /hat/.test(s)) return 'hatOpen';
  if (/pedal/.test(s)) return 'hatPedal';
  if (/hat/.test(s)) return 'hatClosed';
  if (/crash|cymbal|splash|china/.test(s)) return 'crash';
  if (/ride/.test(s)) return 'hatOpen';
  if (/tambourine|shaker|maracas|cabasa|jingle/.test(s)) return 'hatPedal';
  if (/tom/.test(s)) return 'tom';
  if (/conga|bongo|timbale/.test(s)) return /low/.test(s) ? 'tom' : 'tick';
  if (/triangle|cowbell|wood|clave|agogo|rim|stick|castanet|whistle|bell/.test(s)) return 'tick';
  if (n.rhythm && n.cgb === 4) return n.played >= 60 ? 'hatClosed' : 'snareSoft';
  return GM(n.key);
}
function noteClass(n) {
  const s = nm(n);
  if (n.rhythm || n.cgb === 4 || /timpani/.test(s)) return 'perc';
  if (/bass/.test(s) && !/bassoon/.test(s)) return 'bass';
  return 'mel';
}
// sounding pitch (semitones): the key plus key shift / bend / tune; Emerald's GBA wave voice plays an octave down
function pitchOf(n) { return n.key + n.keyM + n.pitM / 256 - (n.cgb === 3 ? 12 : 0); }
function ampOf(n, cfgVol) { return (n.vel / 127) * (n.vol / 127); }

function dutyFor(n) {
  if (n.duty !== null && (n.cgb === 1 || n.cgb === 2)) return n.duty;
  const s = nm(n);
  if (/trumpet|horn|trombone|tuba|brass|sax|oboe|clarinet|bassoon|accordion|harmonica|lead|synth/.test(s)) return 1;
  if (/glock|celesta|music_box|bell|vibraphone|marimba|xylo|chime/.test(s)) return 0;
  return 2;
}
// envelope decay period (0 = held) for a note at start level v, from the voice's ADSR
function decayFor(n, v) {
  const [a, d, s] = n.adsr;
  if (n.cgb === 1 || n.cgb === 2 || n.cgb === 3) {
    if (s >= 8 || d === 0) return 0;
    if (s >= 4) return Math.min(7, Math.max(1, d * 2));
    return Math.min(7, Math.max(1, d));
  }
  if (s >= 160 || d >= 255) return 0;
  const target = Math.max(s, 40) / 255;
  if (d === 0) return 1;
  const frames = Math.log(target) / Math.log(d / 256);
  return Math.min(7, Math.max(1, Math.round(frames / (Math.max(1, v * (1 - target)) * 0.93))));
}

// ---- duration encoding: d ticks -> [S, n] chunks with S * n = d, n <= 16, S * n <= 255 (GSC masks the product)
const NICE = [6, 12, 3, 4, 8, 2, 24, 1, 16, 9, 18, 10, 5, 7, 14, 15];
// LIM: { lmax: the longest note (S * n * tempo must fit 16 bits), minT: the shortest event (one that rounds to 0 frames
// still takes a frame in the driver, so every event must last >= 1 frame) }
let LIM = { lmax: 255, minT: 1 };
function factor(d, cur) {
  if (d <= 0 || d > LIM.lmax) return null;
  if (cur && d % cur === 0 && d / cur <= 16) return [cur, d / cur];
  for (const S of NICE) if (d % S === 0 && d / S <= 16) return [S, d / S];
  for (let n = 16; n >= 1; n--) if (d % n === 0 && d / n <= 255) return [d / n, n];
  return null;
}
// d ticks -> chunks that each factor and are >= minT
function chunks(d, cur) {
  const out = [];
  while (d > 0) {
    let k = Math.min(d, LIM.lmax);
    while (k > 0 && (!factor(k, cur) || (d - k > 0 && d - k < LIM.minT))) k--;
    if (k <= 0) { k = d; }
    const f = factor(k, cur) || [1, Math.min(16, k)];
    out.push(f); cur = f[0]; d -= f[0] * f[1];
  }
  return out;
}
const restChunks = chunks;
// merge events shorter than minT into their neighbours (never across a break)
function fixShort(list, breaks) {
  const min = LIM.minT;
  if (min <= 1) return list;
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      if (s.t1 - s.t0 >= min) continue;
      const prev = list[i - 1], next = list[i + 1];
      const empty = !s.n && !s.hit;
      if (prev && !breaks.has(s.t0) && (empty || !next || breaks.has(s.t1) || next.t1 - next.t0 < 2 * min)) { prev.t1 = s.t1; list.splice(i, 1); }
      else if (next && !breaks.has(s.t1) && next.t1 - next.t0 - (min - (s.t1 - s.t0)) >= min) { const take = min - (s.t1 - s.t0); s.t1 += take; next.t0 += take; }
      else if (next && !breaks.has(s.t1)) { if (empty) { next.t0 = s.t0; list.splice(i, 1); } else { s.t1 = next.t1; list.splice(i + 1, 1); } }
      else if (prev && !breaks.has(s.t0)) { prev.t1 = s.t1; list.splice(i, 1); }
      else continue;
      changed = true; break;
    }
  }
  return list;
}

export function convert(trace, opts = {}) {
  const kit = opts.kit ?? 3;
  const KIT = KIT3;
  const label = opts.label || 'Music_' + trace.song.replace(/^mus_/, '').replace(/(^|_)(\w)/g, (_, __, c) => c.toUpperCase());
  const L = trace.endTick;
  const loopStart = trace.loop ? trace.loop.startTick : null;
  const Q = { drumCollisions: 0, octaveFolded: 0, shortened: 0, retriggered: 0, melodySwitches: 0, sourceNotes: trace.notes.length };
  const notes = trace.notes.map((n, i) => ({ ...n, i, cls: noteClass(n), pitch: pitchOf(n), amp: ampOf(n) }));
  // ---- parts
  const parts = new Map();
  for (const n of notes) {
    const k = `${n.track}:${n.cls}`;
    if (!parts.has(k)) parts.set(k, { key: k, track: n.track, cls: n.cls, notes: [] });
    parts.get(k).notes.push(n);
  }
  // a low part (median pitch <= 50, e.g. a tuba) is a bass line whatever the voice
  for (const p of [...parts.values()]) {
    if (p.cls !== 'mel') continue;
    const ks = p.notes.map((n) => n.pitch).sort((a, b) => a - b);
    if (ks[ks.length >> 1] <= 50) { p.cls = 'bass'; for (const n of p.notes) n.cls = 'bass'; }
  }
  const nW = Math.ceil(L / W);
  const stats = (p, w) => {
    const w0 = w * W, w1 = Math.min(L, w0 + W);
    const cover = new Uint8Array(w1 - w0);
    let ampT = 0, pitT = 0, durT = 0, onsets = [];
    for (const n of p.notes) {
      const a = Math.max(w0, n.tick), b = Math.min(w1, n.endTick);
      if (b <= a) continue;
      for (let t = a; t < b; t++) cover[t - w0]++;
      const d = b - a; ampT += n.amp * d; pitT += n.pitch * d; durT += d;
      if (n.tick >= w0) onsets.push(n);
    }
    let cov = 0, poly = 0;
    for (const c of cover) { if (c) cov++; poly += c; }
    return { cov: cov / (w1 - w0), amp: durT ? ampT / durT : 0, pitch: durT ? pitT / durT : 0, poly: cov ? poly / cov : 0, onsets };
  };
  const mel = [...parts.values()].filter((p) => p.cls === 'mel');
  const bass = [...parts.values()].filter((p) => p.cls === 'bass');
  const perc = [...parts.values()].filter((p) => p.cls === 'perc');
  const sel = { 1: [], 2: [], 3: [] };
  let prev1 = null, prev2 = null, prev3 = null;
  const dupOf = (a, b) => { // share of a's onsets that b doubles (same tick, same pitch class)
    if (!a.onsets.length) return 0;
    let k = 0;
    for (const n of a.onsets) if (b.onsets.some((m) => Math.abs(m.tick - n.tick) <= 1 && ((Math.round(m.pitch) - Math.round(n.pitch)) % 12 + 12) % 12 === 0)) k++;
    return k / a.onsets.length;
  };
  const ov = opts.overrides || OVERRIDES[trace.song] || {};
  const forced = (ch, w, exclude) => {
    for (const r of ov[ch] || []) {
      if (r.bars && (w < r.bars[0] || w > r.bars[1])) continue;
      const p = parts.get(`${r.track}:mel`);
      if (!p || p === exclude) continue;
      const s = stats(p, w);
      if (s.cov > 0) return { p, s };
    }
    return null;
  };
  for (let w = 0; w < nW; w++) {
    const st = mel.map((p) => ({ p, s: stats(p, w) })).filter((x) => x.s.cov > 0);
    const score1 = (x) => x.s.amp * Math.sqrt(x.s.cov) * (1 + Math.max(-0.5, Math.min(0.75, (x.s.pitch - 64) / 24))) * (x.s.poly > 1.5 ? 0.7 : 1) * (x.p === prev1 ? 1.35 : 1);
    st.sort((a, b) => score1(b) - score1(a));
    const top = forced(1, w) || st[0] || null;
    sel[1][w] = top ? { part: top.p, mode: 'top' } : null;
    prev1 = top ? top.p : prev1;
    // pulse 2: the busiest other part that isn't a copy of the melody; else the melody's chord's second voice
    const score2 = (x) => x.s.amp * (0.25 + x.s.cov) * (x.p === prev2 ? 1.35 : 1) * (1 - 0.8 * (top ? dupOf(x.s, top.s) : 0));
    const rest = st.filter((x) => !top || x.p !== top.p).sort((a, b) => score2(b) - score2(a));
    const f2 = forced(2, w, top && top.p);
    if (f2) { sel[2][w] = { part: f2.p, mode: 'top' }; prev2 = f2.p; }
    else if (rest.length && score2(rest[0]) > 0.02) { sel[2][w] = { part: rest[0].p, mode: 'top' }; prev2 = rest[0].p; }
    else if (top && top.s.poly > 1.3) sel[2][w] = { part: top.p, mode: 'second' };
    else sel[2][w] = null;
    // wave: the bass
    const bs = bass.map((p) => ({ p, s: stats(p, w) })).filter((x) => x.s.cov > 0)
      .sort((a, b) => b.s.amp * b.s.cov * (b.p === prev3 ? 1.35 : 1) - a.s.amp * a.s.cov * (a.p === prev3 ? 1.35 : 1));
    sel[3][w] = bs.length ? { part: bs[0].p, mode: 'low' } : null;
    if (bs.length) prev3 = bs[0].p;
  }
  // ---- one voice per channel, tick grid of note indices
  const grids = {};
  for (const ch of [1, 2, 3]) {
    const g = new Int32Array(L).fill(-1);
    for (let w = 0; w < nW; w++) {
      const s = sel[ch][w];
      if (!s) continue;
      const w0 = w * W, w1 = Math.min(L, w0 + W);
      const ns = s.part.notes.filter((n) => n.tick < w1 && n.endTick > w0);
      for (let t = w0; t < w1; t++) {
        let cands = ns.filter((n) => n.tick <= t && n.endTick > t);
        if (!cands.length) continue;
        const latest = Math.max(...cands.map((n) => n.tick));
        cands = cands.filter((n) => n.tick === latest).sort((a, b) => b.pitch - a.pitch);
        const pick = s.mode === 'second' ? cands[1] : s.mode === 'low' ? cands[cands.length - 1] : cands[0];
        if (pick) g[t] = pick.i;
      }
    }
    grids[ch] = g;
  }
  // ---- segments (break at the loop start and at tempo changes)
  const breaks = new Set([0, L]);
  if (loopStart !== null) breaks.add(loopStart);
  for (const t of trace.tempos) if (t.tick > 0 && t.tick < L) breaks.add(t.tick);
  const segs = (g) => {
    const out = [];
    let t0 = 0;
    for (let t = 1; t <= L; t++) if (t === L || breaks.has(t) || g[t] !== g[t - 1]) { out.push({ t0, t1: t, n: g[t0] >= 0 ? notes[g[t0]] : null }); t0 = t; }
    return out;
  };
  // drums: one hit per tick, by priority
  const hits = new Map();
  for (const p of perc) for (const n of p.notes) {
    const role = drumRole(n);
    if (n.vel < 20) continue;
    const cur = hits.get(n.tick);
    if (cur) Q.drumCollisions++;
    if (!cur || DRUM_PRIO[role] > DRUM_PRIO[cur.role]) hits.set(n.tick, { role, n });
  }
  const drumSegs = [];
  {
    let t0 = 0, cur = null;
    for (let t = 1; t <= L; t++) {
      if (t === L || breaks.has(t) || hits.has(t)) { drumSegs.push({ t0, t1: t, hit: t0 === 0 ? hits.get(0) || null : cur }); t0 = t; cur = hits.get(t) || null; }
    }
    // a segment that starts at a break without a hit is a wait
    for (const s of drumSegs) if (!hits.has(s.t0)) s.hit = null;
  }
  // ---- volume normalisation per channel
  const used = { 1: [], 2: [], 3: [] };
  for (const ch of [1, 2, 3]) for (const s of segs(grids[ch])) if (s.n) used[ch].push(s.n.amp);
  const pct = (a, q) => { if (!a.length) return 1; const b = [...a].sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor(q * b.length))]; };
  const ref = { 1: pct(used[1], 0.9), 2: pct(used[2], 0.9), 3: pct(used[3], 0.9) };
  const vmax = { 1: opts.v1 ?? 12, 2: opts.v2 ?? 9 };
  // pan: a part the song puts on one side (|pan| >= 24 of 64) goes there
  const sidePan = (ch) => {
    let l = 0, r = 0, c = 0;
    for (const s of segs(grids[ch])) if (s.n) { const d = s.t1 - s.t0; if (s.n.pan <= -24) l += d; else if (s.n.pan >= 24) r += d; else c += d; }
    return l > c + r ? [1, 0] : r > c + l ? [0, 1] : [1, 1];
  };
  // ---- emit
  const bpm0 = trace.tempos.length ? trace.tempos[0].bpm : 150;
  const tempoAt = (t) => { let b = bpm0; for (const x of trace.tempos) if (x.tick <= t) b = x.bpm; return b; };
  const T = (bpm) => Math.round(38400 / bpm);
  const Ts = [bpm0, ...trace.tempos.map((x) => x.bpm)].map(T);
  LIM = { lmax: Math.min(255, Math.floor((65535 - 255) / Math.max(...Ts))), minT: Math.ceil(256 / Math.min(...Ts)) };
  const NOTE = ['C_', 'C#', 'D_', 'D#', 'E_', 'F_', 'F#', 'G_', 'G#', 'A_', 'A#', 'B_'];
  const out = [`${label}:`, '\tchannel_count 4', `\tchannel 1, ${label}_Ch1`, `\tchannel 2, ${label}_Ch2`, `\tchannel 3, ${label}_Ch3`, `\tchannel 4, ${label}_Ch4`, ''];
  const info = { channels: {} };
  for (const ch of [1, 2, 3, 4]) {
    const lines = [`${label}_Ch${ch}:`];
    const st = { S: 0, env: -1, oct: 0, duty: -1, vib: '' };
    if (ch === 1) { lines.push(`\ttempo ${T(bpm0)}`, '\tvolume 7, 7'); }
    if (ch !== 4) { const [l, r] = sidePan(ch); if (!(l && r)) lines.push(`\tstereo_panning ${l ? 'TRUE' : 'FALSE'}, ${r ? 'TRUE' : 'FALSE'}`); }
    if (ch === 4) lines.push(`\ttoggle_noise ${kit}`);
    const list = fixShort(ch === 4 ? drumSegs.map((x) => ({ ...x })) : segs(grids[ch]), breaks);
    let count = 0;
    const setS = (S, env) => {
      if (ch === 4) { if (S !== st.S) { lines.push(`\tdrum_speed ${S}`); st.S = S; } return; }
      if (S !== st.S || st.env === -1) { lines.push(`\tnote_type ${S}, ${env >> 4}, ${env & 8 ? -(env & 7) : env & 7}`); st.S = S; st.env = env; }
      else if (env !== st.env) { lines.push(`\tvolume_envelope ${env >> 4}, ${env & 8 ? -(env & 7) : env & 7}`); st.env = env; }
    };
    const rest = (d) => { for (const [S, n] of restChunks(d, st.S || 6)) { setS(S, st.env === -1 ? 0x10 : st.env); lines.push(ch === 4 ? `\trest ${n}` : `\trest ${n}`); } };
    for (const s of list) {
      if (loopStart !== null && s.t0 === loopStart) { lines.push('.mainloop:'); Object.assign(st, { S: 0, env: -1, oct: 0, duty: -1, vib: '' }); }
      if (ch === 1 && s.t0 > 0 && trace.tempos.some((x) => x.tick === s.t0)) lines.push(`\ttempo ${T(tempoAt(s.t0))}`);
      const d = s.t1 - s.t0;
      if (ch === 4) {
        if (!s.hit) { rest(d); continue; }
        const drum = KIT[s.hit.role];
        let first = true;
        for (const [S, n] of chunks(d, st.S)) { setS(S); lines.push(first ? `\tdrum_note ${drum}, ${n}` : `\trest ${n}`); first = false; count++; }
        continue;
      }
      if (!s.n) { rest(d); continue; }
      const n = s.n;
      // pitch -> octave / note
      let k = Math.round(n.pitch);
      const lo = ch === 3 ? 24 : 36, hi = ch === 3 ? 107 : 107;
      if (k < lo || k > hi) Q.octaveFolded++;
      while (k < lo) k += 12;
      while (k > hi) k -= 12;
      const oct = Math.floor((k - lo) / 12) + 1, pitch = NOTE[(k - lo) % 12];
      // envelope
      let env;
      if (ch === 3) {
        const code = n.cgb === 3 ? 2 : 1;
        // opts.waveFor(note) -> a wave sample index (0-15) per note's voice, or undefined for the default
        env = (code << 4) | ((opts.waveFor && opts.waveFor(n)) ?? opts.wave ?? (n.cgb === 3 ? 2 : 4));
      } else {
        const v = Math.max(2, Math.min(15, Math.round(vmax[ch] * Math.min(1.25, n.amp / ref[ch]))));
        env = (v << 4) | decayFor(n, v);
      }
      if (ch !== 3) {
        const duty = dutyFor(n);
        if (duty !== st.duty) { lines.push(`\tduty_cycle ${duty}`); st.duty = duty; }
        const lfoFrames = Math.round(n.lfoDelay * 150 / tempoAt(n.tick));
        const vib = n.mod > 0 ? `${Math.max(6, Math.min(40, lfoFrames || 12))}, ${n.mod >= 12 ? 3 : 2}, 4` : (ch === 1 ? '16, 1, 5' : '20, 1, 5');
        if (vib !== st.vib) { lines.push(`\tvibrato ${vib}`); st.vib = vib; }
      }
      if (oct !== st.oct) { lines.push(`\toctave ${oct}`); st.oct = oct; }
      // duration: whole note if it factors; else shorten by up to 3 ticks (a rest); longer than 255: a retriggered tail
      let cut = 0;
      if (d <= LIM.lmax && !factor(d, st.S)) {
        for (let c = LIM.minT; c <= Math.max(3, LIM.minT + 2); c++) if (d - c >= LIM.minT && factor(d - c, st.S)) { cut = c; break; }
      }
      const parts2 = chunks(d - cut, st.S);
      if (parts2.length > 1) Q.retriggered += parts2.length - 1;
      for (const [S, nn] of parts2) { setS(S, env); lines.push(`\tnote ${pitch}, ${nn}`); count++; }
      if (cut) { rest(cut); Q.shortened++; }
    }
    if (loopStart !== null) lines.push('\tsound_loop 0, .mainloop'); else lines.push('\tsound_ret');
    out.push(...lines, '');
    info.channels[ch] = { notes: count };
  }
  // which part fed which channel, bar by bar (for the write-up)
  info.selection = {};
  for (const ch of [1, 2, 3]) {
    const tally = {};
    for (const s of sel[ch]) if (s) { const p = s.part.notes[0]; const k = `tr${s.part.track} ${(p.name.name || p.name.kind || '').replace(/DirectSoundWaveData_|sc88pro_|voicegroup_|_keysplit.*$/g, '')}${s.mode === 'second' ? ' (2nd voice)' : ''}`; tally[k] = (tally[k] || 0) + 1; }
    info.selection[ch] = tally;
  }
  const roles = {};
  for (const h of hits.values()) roles[h.role] = (roles[h.role] || 0) + 1;
  info.drums = roles;
  for (let w = 1; w < nW; w++) if (sel[1][w] && sel[1][w - 1] && sel[1][w].part !== sel[1][w - 1].part) Q.melodySwitches++;
  Q.windows = nW;
  { const ids = new Set(); for (const ch of [1, 2, 3]) for (const v of grids[ch]) if (v >= 0) ids.add(v);
    const percN = notes.filter((n) => n.cls === 'perc').length;
    Q.keptPitched = `${ids.size}/${notes.length - percN}`; Q.keptDrums = `${hits.size}/${percN}`; }
  info.quality = Q;
  info.sel = { 1: sel[1].map((x) => (x ? x.part.key + (x.mode === 'second' ? '/2' : '') : null)), 2: sel[2].map((x) => (x ? x.part.key + (x.mode === 'second' ? '/2' : '') : null)), 3: sel[3].map((x) => (x ? x.part.key : null)) };
  info.tempo = { bpm: bpm0, gscTempo: T(bpm0), framesPerTickGsc: T(bpm0) / 256, framesPerTickM4a: 150 / bpm0 };
  return { asm: out.join('\n'), label, info };
}

export function convertSong(song, opts = {}) { return convert(traceSong(song), opts); }
