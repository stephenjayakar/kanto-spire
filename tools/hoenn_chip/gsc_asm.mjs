// Hoenn chiptune prototype: a small assembler for Gold/Silver/Crystal music in pokecrystal's macro syntax (current pret
// names and the pre-2020 legacy names), producing the exact bytes web/src/audio/gb-core.js GscEngine plays. Enough of
// rgbasm for music files: labels (global, .local, Label.local), db / dw / dn / bigdw, numbers ($hex, %bin, decimal),
// note names, TRUE/FALSE, simple + - * / expressions, `const_def`-free files. No macros of its own, no includes.
//
//   import { assemble } from './gsc_asm.mjs';
//   const { bytes, labels } = assemble(sourceText, { org: 0x4000 });
//
// Unknown macros throw (a file that needs engine extensions is reported, not mis-built).
const NOTES = { __: 0, C_: 1, 'C#': 2, D_: 3, 'D#': 4, E_: 5, F_: 6, 'F#': 7, G_: 8, 'G#': 9, A_: 10, 'A#': 11, B_: 12,
  Db: 2, Eb: 4, Gb: 7, Ab: 9, Bb: 11, CC: 13 };

function splitArgs(s) {
  const out = []; let cur = '', depth = 0, q = false;
  for (const ch of s) {
    if (ch === '"') q = !q;
    if (!q && ch === '(') depth++;
    if (!q && ch === ')') depth--;
    if (!q && depth === 0 && ch === ',') { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

export function assemble(src, { org = 0x4000, defines = {} } = {}) {
  const lines = src.split(/\r?\n/);
  const items = []; // { label } | { op, args, line }
  let global = '';
  for (let i = 0; i < lines.length; i++) {
    let l = lines[i].replace(/;.*$/, '').trim();
    if (!l) continue;
    // labels: "Name:", "Name::", ".local:", "Name.local:"
    for (;;) {
      const m = l.match(/^([A-Za-z_.][\w.#@]*)::?\s*(.*)$/);
      if (!m || /^\w+\s/.test(l.split(':')[0])) break;
      let name = m[1];
      if (name.startsWith('.')) name = global + name; else if (!name.includes('.')) global = name;
      items.push({ label: name });
      l = m[2].trim();
      if (!l) break;
    }
    if (!l) continue;
    const m = l.match(/^(\w+)\s*(.*)$/);
    if (!m) throw new Error(`line ${i + 1}: can't parse "${l}"`);
    let op = m[1], rest = m[2];
    if (/^EQU$/i.test(rest.split(/\s+/)[0] || '') || /^DEF$/i.test(op)) {
      const d = /^DEF$/i.test(op) ? rest.match(/^(\w+)\s+(?:EQU|=)\s+(.*)$/i) : [null, op, rest.replace(/^EQU\s+/i, '')];
      if (d) defines[d[1]] = d[2];
      continue;
    }
    items.push({ op, args: splitArgs(rest), line: i + 1, global });
  }
  const labels = {};
  const ctx = { channels: 0 };
  // expression evaluator (labels resolved in pass 2)
  const evalx = (e, it, pass) => {
    let s = String(e).trim();
    if (s in NOTES) return NOTES[s];
    if (/^TRUE$/i.test(s)) return 1;
    if (/^FALSE$/i.test(s)) return 0;
    if (s in defines) return evalx(defines[s], it, pass);
    let tok = s.replace(/\$([0-9a-fA-F]+)/g, (_, h) => String(parseInt(h, 16)))
      .replace(/%([01]+)/g, (_, b) => String(parseInt(b, 2)))
      .replace(/(^|[^\w.])(\.[A-Za-z_]\w*)/g, (_, p, loc) => p + it.global + loc)
      .replace(/[A-Za-z_][\w.#@]*/g, (name) => {
        if (name in NOTES) return String(NOTES[name]);
        if (name in defines) return '(' + evalx(defines[name], it, pass) + ')';
        if (name in labels) return String(labels[name]);
        if (pass === 1) return '0';
        throw new Error(`line ${it.line}: unknown symbol ${name}`);
      });
    tok = tok.replace(/(^|[^\d])0+(\d)/g, '$1$2'); // no octal: "00", "07" are decimal
    if (!/^[\d\s+\-*/()<>|&^~%]+$/.test(tok)) throw new Error(`line ${it.line}: bad expression ${s}`);
    return Function(`"use strict"; return (${tok});`)() | 0;
  };
  const dn = (a, b) => ((a & 15) << 4) | (b & 15);
  const env = (v, d) => (d < 0 ? dn(v, 8 | -d) : dn(v, d));
  function encode(it, pass) {
    const A = it.args.map((a) => a);
    const x = (k) => evalx(A[k], it, pass);
    const w = (v) => [v & 0xff, (v >> 8) & 0xff];
    const bw = (v) => [(v >> 8) & 0xff, v & 0xff];
    switch (it.op) {
      // data
      case 'db': return A.flatMap((a) => (/^".*"$/.test(a) ? [...a.slice(1, -1)].map((c) => c.charCodeAt(0)) : [evalx(a, it, pass) & 0xff]));
      case 'dw': return A.flatMap((a) => w(evalx(a, it, pass)));
      case 'bigdw': return A.flatMap((a) => bw(evalx(a, it, pass)));
      case 'dn': { const o = []; for (let k = 0; k < A.length; k += 2) o.push(dn(x(k), x(k + 1))); return o; }
      // header
      case 'channel_count': ctx.channels = x(0) - 1; return [];
      case 'channel': { const v = [((ctx.channels << 2) << 4) | ((x(0) - 1) & 15), ...w(x(1))]; ctx.channels = 0; return v; }
      case 'musicheader': return [(((x(0) - 1) << 6) | (x(1) - 1)) & 0xff, ...w(x(2))]; // legacy: count, channel, addr
      // notes
      case 'note': case 'drum_note': return [dn(x(0), x(1) - 1)];
      case 'rest': return [dn(0, x(0) - 1)];
      case 'octave': return [0xd0 + 8 - x(0)];
      case 'note_type': case 'notetype': return A.length >= 3 ? [0xd8, x(0), env(x(1), x(2))] : A.length === 2 ? [0xd8, x(0), x(1) & 0xff] : [0xd8, x(0)];
      case 'drum_speed': return [0xd8, x(0)];
      case 'transpose': return [0xd9, dn(x(0), x(1))];
      case 'forceoctave': return [0xd9, x(0)];
      case 'pitchoffset': return [0xd9, dn(x(0), x(1) - 1)];              // legacy: octave, key (the new name is transpose)
      case 'dbw': return [x(0) & 0xff, ...w(x(1))];
      case 'tempo': return [0xda, ...bw(x(0))];
      case 'duty_cycle': case 'dutycycle': return [0xdb, x(0)];
      case 'volume_envelope': return [0xdc, env(x(0), x(1))];
      case 'intensity': return [0xdc, x(0) & 0xff];
      case 'pitch_sweep': return [0xdd, A.length > 1 ? env(x(0), x(1)) : x(0)];
      case 'soundinput': return [0xdd, x(0)];
      case 'duty_cycle_pattern': return [0xde, (x(0) << 6) | (x(1) << 4) | (x(2) << 2) | x(3)];
      case 'sound_duty': return [0xde, (x(3) << 6) | (x(2) << 4) | (x(1) << 2) | x(0)];
      case 'toggle_sfx': case 'togglesfx': return [0xdf];
      case 'pitch_slide': return [0xe0, x(0) - 1, dn(8 - x(1), x(2) % 12)];
      case 'slidepitchto': return [0xe0, x(0) - 1, dn(x(1), x(2))];
      case 'vibrato': return A.length > 2 ? [0xe1, x(0), dn(x(1), x(2))] : [0xe1, x(0), x(1)];
      case 'toggle_noise': case 'togglenoise': return A.length ? [0xe3, x(0)] : [0xe3];
      case 'force_stereo_panning': return [0xe4, dn(x(0) ? 15 : 0, x(1) ? 15 : 0)];
      case 'panning': return [0xe4, x(0)];
      case 'volume': return A.length > 1 ? [0xe5, dn(x(0), x(1))] : [0xe5, x(0)];
      case 'pitch_offset': case 'tone': return [0xe6, ...bw(x(0))];
      case 'tempo_relative': return [0xe9, x(0) & 0xff];
      case 'stereo_panning': return [0xef, dn(x(0) ? 15 : 0, x(1) ? 15 : 0)];
      case 'stereopanning': return [0xef, x(0)];
      case 'sfx_priority_on': return [0xec];
      case 'sfx_priority_off': return [0xed];
      case 'set_condition': case 'setcondition': return [0xfa, x(0)];
      case 'sound_jump_if': case 'jumpif': return [0xfb, x(0), ...w(x(1))];
      case 'sound_jump': case 'jumpchannel': return [0xfc, ...w(x(0))];
      case 'sound_loop': case 'loopchannel': return [0xfd, x(0), ...w(x(1))];
      case 'sound_call': case 'callchannel': return [0xfe, ...w(x(0))];
      case 'sound_ret': case 'endchannel': return [0xff];
      default: break;
    }
    // legacy per-note macros: "C_ 4", "__ 2"
    if (it.op in NOTES || ['C#', 'D#', 'F#', 'G#', 'A#'].includes(it.op)) return [dn(NOTES[it.op], x(0) - 1)];
    throw new Error(`line ${it.line}: unsupported macro "${it.op}" (engine extension?)`);
  }
  const unsupported = new Set();
  for (const pass of [1, 2]) {
    let pc = org;
    const out = [];
    for (const it of items) {
      if (it.label) { if (pass === 1) labels[it.label] = pc; continue; }
      let b;
      try { b = encode(it, pass); } catch (e) { if (pass === 2) throw e; unsupported.add(it.op); b = []; }
      if (pass === 2) out.push(...b);
      pc += b.length;
    }
    if (pass === 2) return { bytes: Uint8Array.from(out), labels, size: pc - org };
  }
  return null;
}

// Every label that starts a song header ("Music_X:" followed by channel_count / musicheader).
export function songHeaders(src, labels) {
  const out = [];
  const re = /^(\w+):\s*\n\s*(channel_count|musicheader)/gm;
  let m;
  while ((m = re.exec(src.replace(/;.*$/gm, '').replace(/\r/g, '')))) out.push(m[1]);
  return out.filter((n) => n in labels);
}
