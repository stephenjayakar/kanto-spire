#!/usr/bin/env node
// Sinnoh chiptune: listening samples of the built SINNOH retro bank (nothing is played aloud), rendered the way the game
// plays them: web/src/audio/gb-core.js GbPlayer, HQ render, RETRO_MIX ('C'), only the Sinnoh game loaded.
//
//   node tools/sinnoh_chip/render.mjs [--dir web/assets/retro_sinnoh] [--out ~/scratch/sinnoh/music/render]
//        [--seconds 40] [--mp3] [SEQ_BA_GYM ...]                       (no labels: every song in sinnoh.json)
// Per song: <label>.wav (30-45 s: the intro and the loop, capped, with a 3 s fade; jingles to their end + 1 s) and an
// objective check, also written to report.json:
//   - RMS of the render (FAIL under -40 dBFS), peak and clipped samples (FAIL if any sample clips at the game's gain);
//   - every channel the song uses sounds at some point of the whole song (intro + loop, checked in the player with
//     build_bank.mjs checkSong).
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { GbPlayer } from '../../web/src/audio/gb-core.js';
import { RETRO_MIX } from '../../web/src/audio/retro.js';
import { renderPlayer, writeWav, fadeTail, rms, dbfs, FRAME_HZ, SR } from '../hoenn_chip/render_lib.mjs';
import { checkSong } from './build_bank.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export function renderSong(meta, bin, name, { seconds = 40, mix = RETRO_MIX } = {}) {
  const s = meta.songs[name];
  const p = new GbPlayer(SR, () => {}, { render: 'hq', mix });
  p.load(meta, { [s.game]: bin.slice().buffer });
  if (!p.playBgm(name)) throw new Error(`${name}: not playable`);
  const len = s.srcEnd ? Math.min(45, s.srcEnd / FRAME_HZ + 1) : Math.max(30, Math.min(45, seconds));
  const r = renderPlayer(p, len);
  if (!s.srcEnd) fadeTail(r.L, r.R, 3);
  let peak = 0, clipped = 0;
  for (let i = 0; i < r.L.length; i++) {
    const a = Math.max(Math.abs(r.L[i]), Math.abs(r.R[i]));
    if (a > peak) peak = a;
    if (a > 1) clipped++;
  }
  return { ...r, seconds: len, rmsDb: dbfs(rms(r.L, r.R)), peakDb: dbfs(peak), clipped };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
  const flags = new Set(['--dir', '--out', '--seconds']);
  const labels = args.filter((a, i) => !a.startsWith('--') && !flags.has(args[i - 1]));
  const dir = path.resolve(opt('--dir', path.join(ROOT, 'web/assets/retro_sinnoh')));
  const out = path.resolve(opt('--out', path.join(process.env.HOME, 'scratch/sinnoh/music/render')));
  const seconds = +opt('--seconds', 40);
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'sinnoh.json'), 'utf8'));
  const bin = new Uint8Array(fs.readFileSync(path.join(dir, 'sinnoh.bin')));
  const names = labels.length ? labels.map((l) => (l.includes(':') ? l : 'sinnoh:' + l)) : Object.keys(meta.songs).sort();
  fs.mkdirSync(out, { recursive: true });
  const rows = [];
  let fails = 0;
  for (const name of names) {
    if (!meta.songs[name]) { console.log(`${name}: not in ${dir}/sinnoh.json`); fails++; continue; }
    const r = renderSong(meta, bin, name, { seconds });
    const file = path.join(out, name.replace(/^sinnoh:/, '') + '.wav');
    writeWav(file, r.L, r.R);
    if (args.includes('--mp3')) execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', file, '-codec:a', 'libmp3lame', '-b:a', '192k', file.replace(/\.wav$/, '.mp3')]);
    // the whole song, every channel (notes from the bytes: a channel with notes is one whose stream has note commands)
    const { used, tempos } = scanSong(meta, bin, name);
    const c = checkSong(meta, bin, name, null, undefined, tempos);   // (slack: a frame per tempo command, see build_bank)
    const silent = [];
    for (let i = 0; i < 4; i++) if (used[i] && !c.soundFrames[i]) silent.push(i + 1);
    const issues = [];
    if (r.rmsDb < -40) issues.push(`RMS ${r.rmsDb.toFixed(1)} dBFS`);
    if (r.clipped) issues.push(`${r.clipped} clipped samples`);
    if (silent.length) issues.push(`channel ${silent.join(',')} silent`);
    if (c.problems.length) issues.push(...c.problems);
    if (issues.length) fails++;
    const row = { song: name, seconds: +r.seconds.toFixed(1), rmsDb: +r.rmsDb.toFixed(1), peakDb: +r.peakDb.toFixed(1), clipped: r.clipped,
      soundFrames: c.soundFrames, frames: c.frames, ok: !issues.length, issues };
    rows.push(row);
    console.log(`${issues.length ? 'FAIL' : 'ok  '} ${name.padEnd(30)} ${row.seconds}s  RMS ${row.rmsDb} dBFS  peak ${row.peakDb}  ch on ${c.soundFrames.map((x) => ((x / c.frames) * 100).toFixed(0) + '%').join('/')}${issues.length ? '  ' + issues.join('; ') : ''}`);
  }
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(rows, null, 1));
  console.log(`${rows.length} rendered to ${out}, ${fails} with issues`);
  process.exit(fails ? 1 : 0);
}

// which of the 4 music channels has note / drum-note bytes, and how many tempo commands channel 1 has, read from the
// song header's channel streams (a linear scan of each stream to its end or loop: enough for convert()'s output, which
// has no calls)
export function scanSong(meta, bin, name) {
  const s = meta.songs[name], g = meta.games[s.game];
  const bank = bin.subarray(g.banks.indexOf(s.bank) * 0x4000, g.banks.indexOf(s.bank) * 0x4000 + 0x4000);
  const rb = (a) => bank[(a - 0x4000) & 0x3fff];
  const used = [false, false, false, false];
  let tempos = 0;
  const n = (rb(s.header) >> 6) + 1;
  const LEN = { 0xd8: -1, 0xd9: 1, 0xda: 2, 0xdb: 1, 0xdc: 1, 0xdd: 1, 0xde: 1, 0xe0: 2, 0xe1: 2, 0xe2: 1, 0xe3: -2, 0xe4: 1, 0xe5: 1, 0xe6: 2, 0xe7: 1, 0xe8: 1, 0xe9: 1, 0xea: 2, 0xeb: 2, 0xee: 2, 0xef: 1, 0xf0: 1, 0xfa: 1, 0xfb: 3, 0xfc: 2, 0xfd: 3, 0xfe: 2 };
  for (let k = 0; k < n; k++) {
    const ci = rb(s.header + k * 3) & 3;
    let a = rb(s.header + k * 3 + 1) | (rb(s.header + k * 3 + 2) << 8);
    let noise = false;
    for (let guard = 0; guard < 0x4000; guard++) {
      const b = rb(a++);
      if (b === 0xff || b === 0xfc || b === 0xfd) break;
      if (b >= 0xd0 && b <= 0xd7) continue;
      if (b >= 0xd8) {
        if (b === 0xda && ci === 0) tempos++;
        let l = LEN[b] ?? 0;
        if (b === 0xd8) l = ci === 3 ? 1 : 2;
        if (b === 0xe3) { if (noise) { noise = false; l = 0; } else { noise = true; l = 1; } }
        a += l; continue;
      }
      if (b >> 4) used[ci] = true;
    }
  }
  return { used, tempos };
}
