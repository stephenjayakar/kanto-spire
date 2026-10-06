// Compares balance batches (tests/balance.mjs --metrics --json f.json) across scoring systems.
// node tests/metrics_report.mjs master= out/m_*.json dmg= out/d_*.json
// ("label=" starts a group, the following paths join it; "label=file" also works)
import fs from 'fs';

const groups = [];
for (const a of process.argv.slice(2)) {
  const m = /^([\w.-]+)=(.*)$/.exec(a);
  if (m) groups.push({ label: m[1], files: m[2] ? [m[2]] : [] });
  else if (groups.length) groups.at(-1).files.push(a);
}
if (!groups.length) { console.error('usage: node tests/metrics_report.mjs label=f1.json f2.json label2=f3.json ...'); process.exit(1); }

const pct = (x, d = 0) => (x == null || isNaN(x) ? '-' : (100 * x).toFixed(d) + '%');
const num = (x, d = 1) => (x == null || isNaN(x) ? '-' : x.toFixed(d));
const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const median = xs => { const s = xs.filter(x => x != null && !isNaN(x)).sort((a, b) => a - b); return s.length ? s[s.length >> 1] : NaN; };
const quant = (xs, q) => { const s = xs.filter(x => x != null && isFinite(x)).sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : NaN; };
const sd = xs => { const m = mean(xs); return Math.sqrt(mean(xs.map(x => (x - m) ** 2))); };
const row = cells => '| ' + cells.join(' | ') + ' |';
const table = (head, rows) => [row(head), row(head.map(() => '---')), ...rows.map(row)].join('\n');

// Load and bucket by world/asc/skill.
const data = groups.map(g => {
  const batches = g.files.map(f => JSON.parse(fs.readFileSync(f, 'utf8')));
  return { label: g.label, batches };
});
const keyOf = b => `${b.WORLD} A${b.ASC} ${b.SKILL}`;

console.log('## Win rates\n');
const keys = [...new Set(data.flatMap(d => d.batches.map(keyOf)))].sort();
console.log(table(['batch', ...data.map(d => d.label)], keys.map(k => [k, ...data.map(d => {
  const bs = d.batches.filter(b => keyOf(b) === k);
  if (!bs.length) return '-';
  const w = bs.reduce((a, b) => a + b.wins, 0), n = bs.reduce((a, b) => a + b.RUNS, 0);
  const per = bs.map(b => b.wins / b.RUNS);
  return `${pct(w / n)} (${n} runs${bs.length > 1 ? `, seeds ${per.map(x => pct(x)).join('/')}, sd ${pct(sd(per), 1)}` : ''})`;
})])));

// Everything below uses the smart-bot batches only.
const smart = data.map(d => ({ label: d.label, bs: d.batches.filter(b => b.SKILL === 'smart') }));
const decs = d => d.bs.flatMap(b => b.decisions || []);

console.log('\n## Fight length (smart bot, all batches)\n');
const kinds = ['wild', 'trainer', 'elite', 'boss', 'E4'];
const fightStats = (d, kind) => {
  let n = 0, turns = 0, hands = 0, mons = 0, hp = 0, loss = 0;
  for (const b of d.bs) for (const [k, f] of Object.entries(b.M.fights)) {
    const kk = k.includes('E4:') ? 'E4' : k.includes('boss:') ? 'boss' : k.split(' ')[1];
    if (kk !== kind) continue;
    n += f.n; turns += f.turns; hands += f.hands || 0; mons += f.mons || 0; hp += f.hpLost; loss += f.losses;
  }
  return { n, turns: turns / n, hpm: hands / Math.max(1, mons), hp: hp / n, loss: loss / n };
};
console.log(table(['fight', ...smart.flatMap(d => [`${d.label} turns`, `${d.label} hands/foe`, `${d.label} HP lost`])], kinds.map(k => [k, ...smart.flatMap(d => { const s = fightStats(d, k); return [num(s.turns), num(s.hpm, 2), pct(s.hp)]; })])));

console.log('\n## Discards and decks (smart bot, all fights)\n');
const discStats = d => {
  const a = {};
  for (const b of d.bs) for (const f of Object.values(b.M.fights)) for (const k of ['n', 'turns', 'disc', 'discTurns', 'discCards', 'sw', 'deck']) a[k] = (a[k] || 0) + (f[k] || 0);
  return a;
};
console.log(table(['metric', ...smart.map(d => d.label)], [
  ['discards used per battle', a => num(a.disc / a.n, 2)],
  ['cards per discard', a => num(a.discCards / Math.max(1, a.disc), 1)],
  ['turns with a discard', a => pct(a.discTurns / a.turns)],
  ['switches per battle (also cost a discard)', a => num(a.sw / a.n, 2)],
  ['turns per battle', a => num(a.turns / a.n, 2)],
  ["lead's deck size at battle start", a => num(a.deck / a.n, 1)],
].map(([n, f]) => [n, ...smart.map(d => f(discStats(d)))])));

console.log('\n## Hands (smart bot decisions)\n');
const lines = [];
const M = {};
for (const d of smart) {
  const ds = decs(d).filter(x => x.best > 0);
  const ko = ds.filter(x => x.ko);
  const stakes = ds.map(x => (Math.min(x.best, x.hp) - Math.min(x.med, x.hp)) / x.hp);
  const ratio = ds.filter(x => x.med > 0).map(x => x.best / x.med);
  // ("play everything" is only a real option when every attack card fits in one hand)
  const allLegal = ds.filter(x => x.all != null);
  const allNotBest = allLegal.filter(x => x.all < x.best * 0.999);
  const notAll = ds.filter(x => !x.chAll);
  const notAllNoKo = ds.filter(x => !x.chAll && !x.ko);
  const acc = ds.filter(x => x.act != null && x.pred > 0);
  M[d.label] = {
    n: ds.length,
    ko: ko.length / ds.length,
    stakes: mean(stakes), ratio: median(ratio),
    allNotBest: allNotBest.length / allLegal.length, forced: 1 - allLegal.length / ds.length, notAll: notAll.length / ds.length, notAllNoKo: notAllNoKo.length / ds.length,
    overkill: median(ko.map(x => x.pred / x.hp)),
    accExact: acc.filter(x => Math.abs(x.act - x.pred) <= Math.max(1, x.pred * 0.01)).length / acc.length,
    accErr: mean(acc.map(x => Math.abs(x.act - x.pred) / x.pred)),
    accLow: acc.filter(x => x.act < x.pred * 0.99).length / acc.length,
    hitFrac: median(ds.map(x => x.pred / x.mhp)),
  };
}
const rowsH = [
  ['decisions recorded', m => String(m.n)],
  ['hands that KO the foe', m => pct(m.ko)],
  ['median hand damage as % of foe max HP', m => pct(m.hitFrac)],
  ['decision stakes: best minus median legal hand (% of foe HP left, capped at lethal)', m => pct(m.stakes)],
  ['best / median legal hand (damage ratio)', m => num(m.ratio, 1) + 'x'],
  ['more attack cards in hand than you may play (forced choice)', m => pct(m.forced, 1)],
  ['"play every attack card" is NOT the max-damage hand (when it is legal)', m => pct(m.allNotBest, 1)],
  ['bot plays fewer than all its attack cards', m => pct(m.notAll)],
  ['... of which on non-lethal hands', m => pct(m.notAllNoKo)],
  ['median overkill on KO hands (damage / HP left)', m => num(m.overkill, 2) + 'x'],
  ['preview exact (within 1%)', m => pct(m.accExact)],
  ['mean preview error (crits, misses, multi-hit)', m => pct(m.accErr, 1)],
  ['preview over-promised (actual < preview)', m => pct(m.accLow)],
];
console.log(table(['metric', ...smart.map(d => d.label)], rowsH.map(([n, f]) => [n, ...smart.map(d => f(M[d.label]))])));

console.log('\n## Growth across acts (smart bot)\n');
const acts = [0, 1, 2, 3];
console.log(table(['act', ...smart.flatMap(d => [`${d.label} median hand`, `${d.label} hand / foe max HP`, `${d.label} item factor (median / p90 / max)`])], acts.map(a => [`Act ${a + 1}`, ...smart.flatMap(d => {
  const ds = decs(d).filter(x => x.a === a && x.best > 0 && x.w === 'kanto');
  const amp = ds.filter(x => x.bare > 0 && x.bare >= 0.1 * x.mhp).map(x => x.pred / x.bare);
  return [num(median(ds.map(x => x.pred)), 0), pct(median(ds.map(x => x.pred / x.mhp))), `${num(median(amp), 2)} / ${num(quant(amp, 0.9), 2)} / ${num(Math.max(...amp), 1)}`];
})])));

console.log('\n## Combo usage (smart bot)\n');
const combos = ['SINGLE', 'PAIR', 'TWO_PAIR', 'TRIPLE', 'COVERAGE', 'FULL_HOUSE', 'QUAD', 'PENTA'];
console.log(table(['combo', ...smart.map(d => d.label)], combos.map(c => [c, ...smart.map(d => {
  let t = 0, n = 0;
  for (const b of d.bs) for (const [k, v] of Object.entries(b.M.combos)) { if (k === 'SUPPORT') continue; t += v; if (k === c) n += v; }
  return pct(n / t);
})])));

console.log('\n## Run outcome spread (smart bot)\n');
console.log(table(['where runs end', ...smart.map(d => d.label)], ['A1', 'A2', 'A3', 'A4', 'won'].map(a => [a, ...smart.map(d => {
  const rs = d.bs.flatMap(b => b.M.runs);
  const n = a === 'won' ? rs.filter(r => !r.died).length : rs.filter(r => r.died && r.died.startsWith(a)).length;
  return pct(n / rs.length);
})])));

// Variance at Kanto A0: starters, where runs die, and the biggest killers.
console.log('\n## Kanto A0 smart: starters and killers\n');
const k0 = smart.map(d => ({ label: d.label, rs: d.bs.filter(b => b.WORLD === 'kanto' && b.ASC === 0).flatMap(b => b.M.runs) }));
const starters = [...new Set(k0.flatMap(d => d.rs.map(r => r.starter)))];
console.log(table(['', ...k0.map(d => d.label)], [
  ...starters.map(st => [`${st} win%`, ...k0.map(d => { const rs = d.rs.filter(r => r.starter === st); return rs.length ? pct(rs.filter(r => !r.died).length / rs.length) : '-'; })]),
  ...['A1', 'A2', 'A3', 'A4'].map(a => [`runs ending in ${a}`, ...k0.map(d => pct(d.rs.filter(r => r.died && r.died.startsWith(a)).length / d.rs.length))]),
  ['top 4 killers (share of losses)', ...k0.map(d => { const c = {}; const dead = d.rs.filter(r => r.died); for (const r of dead) c[r.died] = (c[r.died] || 0) + 1; return Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k} ${pct(v / dead.length)}`).join(', '); })],
]));

console.log('\n## Held items (smart bot, held at run end; items held by >= 12 runs)\n');
for (const d of smart) {
  const rs = d.bs.flatMap(b => b.M.runs);
  const base = rs.filter(r => !r.died).length / rs.length;
  const it = {};
  for (const r of rs) for (const k of r.relics) { const o = (it[k] ||= { n: 0, w: 0, notW: 0, notN: 0 }); o.n++; if (!r.died) o.w++; }
  const list = Object.entries(it).filter(([, o]) => o.n >= 12).map(([k, o]) => {
    const not = rs.filter(r => !r.relics.includes(k));
    return { k, n: o.n, win: o.w / o.n, lift: o.w / o.n - not.filter(r => !r.died).length / not.length };
  }).sort((a, b) => b.lift - a.lift);
  const lifts = list.map(x => x.lift);
  console.log(`**${d.label}**: overall ${pct(base)}; ${list.length} items with n>=12; lift spread ${pct(Math.min(...lifts))} .. ${pct(Math.max(...lifts))} (sd ${pct(sd(lifts), 1)})`);
  console.log('  best: ' + list.slice(0, 6).map(x => `${x.k} ${pct(x.win)} (n${x.n}, ${x.lift >= 0 ? '+' : ''}${pct(x.lift)})`).join(', '));
  console.log('  worst: ' + list.slice(-6).reverse().map(x => `${x.k} ${pct(x.win)} (n${x.n}, ${x.lift >= 0 ? '+' : ''}${pct(x.lift)})`).join(', '));
  // degenerate hands: biggest item factor seen
  // (ignore hands whose bare damage is under 10% of the foe's max HP: tiny bases make silly ratios)
  const ds = decs(d).filter(x => x.bare > 0 && x.bare >= 0.1 * x.mhp);
  const top = ds.sort((a, b) => b.pred / b.bare - a.pred / a.bare)[0];
  if (top) console.log(`  biggest single-hand item factor: x${num(top.pred / top.bare, 1)} (act ${top.a + 1}, ${top.it} items/badges, ${top.pred} vs ${top.bare} bare, foe max HP ${top.mhp})`);
  const big = decs(d).filter(x => x.mhp > 0);
  console.log(`  hands dealing >= 5x the foe's max HP: ${pct(big.filter(x => x.pred >= 5 * x.mhp).length / big.length, 2)}; >= 2x: ${pct(big.filter(x => x.pred >= 2 * x.mhp).length / big.length, 1)}`);
  const items = rs.map(r => r.nItems || r.relics.length);
  console.log(`  held items at run end: median ${median(items)}, max ${Math.max(...items)}`);
}
