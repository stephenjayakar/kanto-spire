// Balance report from run logs (run.finishLog() records: real players via Convex, or bots via
// `node tests/balance.mjs --logs out.json`).
// Usage: node tools/analyze_runs.mjs logs.json [--asc N] [--world kanto|hoenn] [--bots|--humans]
//   Convex: npx convex run runlogs:exportLogs [--prod] > logs.json   (in the convex-scores worktree)
import fs from 'fs';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i >= 0 ? process.argv[i + 1] : d; };
const file = process.argv[2];
if (!file) { console.error('usage: node tools/analyze_runs.mjs logs.json [--asc N] [--world W]'); process.exit(1); }
let raw = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^[^[{]*/, ''));
let logs = (Array.isArray(raw) ? raw : raw.logs || []).map(l => (typeof l.log === 'string' ? { ...JSON.parse(l.log), player: l.playerName } : l)).filter(l => l?.end);
if (arg('asc') !== undefined) logs = logs.filter(l => l.end.asc === +arg('asc'));
if (arg('world')) logs = logs.filter(l => l.end.world === arg('world'));

const pct = (a, b) => (b ? Math.round(100 * a / b) + '%' : '-');
const won = l => l.end.result === 'win' || l.end.result === 'postgame';
const pad = (s, n) => String(s).padEnd(n);
console.log(`${logs.length} runs\n`);

// ---- runs by world and ascension
const groups = {};
for (const l of logs) { const k = `${l.end.world} A${l.end.asc}`; (groups[k] ||= []).push(l); }
console.log('WIN RATE');
for (const [k, ls] of Object.entries(groups).sort()) console.log(`  ${pad(k, 12)} ${pad(ls.length + ' runs', 9)} ${pct(ls.filter(won).length, ls.length)} won   median end: act ${median(ls.map(l => l.end.act))}`);

// ---- where runs end
const deaths = {};
for (const l of logs.filter(l => !won(l))) {
  const last = [...l.events].reverse().find(e => e.k === 'battle' && e.out === 'lose');
  const k = last ? fightKey(last) : `A${l.end.act} (no battle)`;
  deaths[k] = (deaths[k] || 0) + 1;
}
console.log('\nDEATHS'); console.log('  ' + Object.entries(deaths).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}: ${n}`).join('  '));

// ---- fights
const fights = {};
for (const l of logs) for (const e of l.events) {
  if (e.k !== 'battle') continue;
  const f = (fights[fightKey(e)] ||= { n: 0, lose: 0, t: 0, hpLost: 0, faints: 0, gap: 0, sw: 0 });
  f.n++; if (e.out === 'lose') f.lose++;
  f.t += e.t || 0; f.hpLost += Math.max(0, (e.hp0 ?? 1) - (e.hp1 ?? 1)); f.faints += e.faints || 0; f.sw += e.switches || 0;
  const pl = Math.max(...(e.party || ['x:0']).map(s => +s.split(':')[1])), el = Math.max(...(e.foes || ['x:0']).map(s => +s.split(':')[1]));
  f.gap += pl - el;
}
console.log('\nFIGHTS                      n   lose  turns  hp lost  faints  switches  lvl gap');
for (const [k, f] of Object.entries(fights).sort()) {
  console.log(`  ${pad(k, 24)} ${pad(f.n, 4)}${pad(pct(f.lose, f.n), 6)} ${pad((f.t / f.n).toFixed(1), 6)} ${pad(pct(f.hpLost, f.n), 8)} ${pad((f.faints / f.n).toFixed(2), 7)} ${pad((f.sw / f.n).toFixed(2), 9)} ${(f.gap / f.n).toFixed(1)}`);
}

// ---- combos
const combos = {};
for (const l of logs) for (const e of l.events) if (e.k === 'battle') for (const [k, n] of Object.entries(e.combos || {})) combos[k] = (combos[k] || 0) + n;
const tc = Object.values(combos).reduce((a, b) => a + b, 0);
console.log('\nCOMBOS  ' + Object.entries(combos).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${pct(n, tc)}`).join('  '));

// ---- held items: pick rate when offered, win rate when held at the end
const offered = {}, taken = {}, held = {};
for (const l of logs) {
  for (const e of l.events) if (e.k === 'pick' && e.what === 'relic') { for (const k of e.from || []) offered[k] = (offered[k] || 0) + 1; if (e.took) taken[e.took] = (taken[e.took] || 0) + 1; }
  for (const k of l.end.relics || []) { const o = (held[k] ||= { n: 0, w: 0 }); o.n++; if (won(l)) o.w++; }
}
console.log('\nHELD ITEMS (held at end n / win%, reward pick rate)');
console.log('  ' + Object.entries(held).sort((a, b) => b[1].n - a[1].n).slice(0, 40).map(([k, o]) => `${k} ${o.n}/${pct(o.w, o.n)}${offered[k] ? ` pick ${pct(taken[k] || 0, offered[k])}` : ''}`).join('\n  '));

// ---- shops and starters
const buys = {};
for (const l of logs) for (const e of l.events) if (e.k === 'buy') buys[e.kind] = (buys[e.kind] || 0) + 1;
console.log('\nSHOP BUYS  ' + Object.entries(buys).map(([k, n]) => `${k} ${n}`).join('  '));
const st = {};
for (const l of logs) { const o = (st[l.end.starter] ||= { n: 0, w: 0 }); o.n++; if (won(l)) o.w++; }
console.log('STARTERS   ' + Object.entries(st).map(([k, o]) => `${k} ${o.w}/${o.n}`).join('  '));

function fightKey(e) {
  const named = e.kind === 'boss' || e.kind === 'e4' || e.kind === 'legend';
  return `A${e.a} ${e.kind}${named ? ':' + e.foe : ''}`;
}
function median(xs) { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : '-'; }
