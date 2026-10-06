// Co-op balance runner: 2-4 smart bots play full co-op runs through the CoopGame reducer.
// node tests/coop_balance.mjs --runs 30 --asc 0 --seed CB --world kanto [--players 2|3|4] [--each]
// One Spire rooms: --world spire (KANTO + HOENN), spire_johto (+ JOHTO, v0.1.1), spire_kanto; spire fights are keyed by
// the act's region letter (A2J boss:MORTY). --starters A,B,C: the starters the players cycle through.
import fs from 'fs';
import { loadData, D } from '../web/src/game/data.js';
import { playCoop } from './coop_bot.mjs';
import { COOP_TUNING } from '../web/src/game/coop/tuning.js';
import { REGIONS } from '../web/src/game/regions.js';

await loadData(async f => JSON.parse(fs.readFileSync('web/assets/data/' + f, 'utf8')));
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i >= 0 ? process.argv[i + 1] : d; };
const PLAYERS = Math.max(2, Math.min(4, +arg('players', 2)));
// --p3hp 1.1 / --p4hp 1.2 (and --p3dmg / --p4dmg): the per-size balance factors (COOP_TUNING.players[n])
for (const n of [3, 4]) for (const k of ['hp', 'dmg']) if (arg(`p${n}${k}`)) { COOP_TUNING.players ||= {}; (COOP_TUNING.players[n] ||= {})[k + 'All'] = +arg(`p${n}${k}`); }
const RUNS = +arg('runs', 30), ASC = +arg('asc', 0), SEED = arg('seed', 'CB'), WORLD = arg('world', 'kanto');
// Tuning overrides for experiments: --hp boss=2.4,elite=2 --dmg trainer=1.1 --exp wild=0.5 --teamup 15 --revive 0.3
for (const k of ['hp', 'dmg', 'exp']) if (arg(k)) for (const kv of arg(k).split(',')) { const [a, v] = kv.split('='); COOP_TUNING[k][a] = +v; }
// (--hp also overrides this world's COOP_TUNING.worldHp entries, which win over hp)
if (arg('hp') && COOP_TUNING.worldHp?.[WORLD]) for (const kv of arg('hp').split(',')) { const [a, v] = kv.split('='); COOP_TUNING.worldHp[WORLD][a] = +v; }
for (const k of ['actHp', 'actDmg']) if (arg(k)) COOP_TUNING[k] = arg(k).split(',').map(Number); // --actHp 1,1,1.2,1.3
if (arg('teamup')) COOP_TUNING.teamUp = +arg('teamup');
if (arg('hpcomp')) COOP_TUNING.hpComp = +arg('hpcomp'); // --hpcomp 0.84
if (arg('revive')) COOP_TUNING.reviveFrac = +arg('revive');
const STARTERS = arg('starters') ? arg('starters').split(',') : WORLD === 'hoenn' ? ['TREECKO', 'TORCHIC', 'MUDKIP'] : ['BULBASAUR', 'CHARMANDER', 'SQUIRTLE'];

const fightKey = (g) => {
  const cfg = g.battleCfg, a = `A${g.world.actIndex + 1}${g.world.regions ? REGIONS[g.world.region]?.letter || '' : ''}`;
  if (cfg.gauntlet !== undefined) return `${a} E4:${cfg.trainer.name}`;
  if (cfg.kind === 'boss') return `${a} boss:${cfg.trainer?.name || cfg.legend}`;
  return `${a} ${cfg.coopKind}`;
};
const M = { fights: {}, deaths: {}, wins: 0, downs: 0, revives: 0, ties: 0, votes: 0, actions: 0 };
const t0 = Date.now();
for (let i = 0; i < RUNS; i++) {
  const starters = Array.from({ length: PLAYERS }, (_, k) => STARTERS[(i + k) % STARTERS.length]);
  let cur = null;
  const { game, log } = playCoop({ seed: `${SEED}${i}`, ascension: ASC, world: WORLD, starters, onAction: (a, ok, g) => {
    if (g.phase === 'battle' && g.battle && cur?.b !== g.battle) cur = { b: g.battle, key: fightKey(g) };
    if (cur && g.battle === cur.b && g.battle.result && !cur.done) {
      cur.done = true;
      const f = (M.fights[cur.key] ||= { n: 0, turns: 0, losses: 0, downs: 0, hp: 0 });
      f.gap = (f.gap || 0) + Math.max(...g.runs.flatMap(r => r.party.map(m => m.level))) - Math.max(...g.battle.enemies.map(e => e.level));
      f.n++; f.turns += g.battle.turn; f.downs += g.battle.down.filter(Boolean).length;
      if (g.battle.result.outcome === 'lose') { f.losses++; M.deaths[cur.key] = (M.deaths[cur.key] || 0) + 1; }
      M.downs += g.battle.down.filter(Boolean).length;
      if (g.battle.result.outcome === 'win') M.revives += g.battle.down.filter(Boolean).length;
    }
    if (g.lastVote && g.lastVote !== cur?.lv && g.lastVote !== M.lv) { M.lv = g.lastVote; M.votes++; if (g.lastVote.tie) M.ties++; }
  } });
  M.actions += log.length;
  const won = game.phase === 'victory';
  if (won) M.wins++;
  else if (game.stalemate && cur) { M.deaths[cur.key] = (M.deaths[cur.key] || 0) + 1; const f = M.fights[cur.key] ||= { n: 0, turns: 0, losses: 0, downs: 0, gap: 0 }; f.n++; f.losses++; f.turns += game.battle.turn; M.stalemates = (M.stalemates || 0) + 1; }
  else if (game.phase !== 'over') M.deaths.stalled = (M.deaths.stalled || 0) + 1;
  if (process.argv.includes('--each')) console.log(`run ${i} ${starters.join('+')} ${won ? 'WON' : 'DIED ' + (cur?.key || game.phase)} | ${game.runs.map(r => r.party.map(m => D.species[m.species].name + m.level).join(' ')).join(' || ')}`);
}
console.log(`\n=== co-op ${PLAYERS}p ${WORLD} A${ASC}: ${M.wins}/${RUNS} wins (${Math.round(100 * M.wins / RUNS)}%) in ${((Date.now() - t0) / 1000).toFixed(1)}s, ${Math.round(M.actions / RUNS)} actions/run`);
console.log('deaths:', Object.entries(M.deaths).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join('  '));
console.log(`players downed: ${M.downs} (revived after a win: ${M.revives}); tie votes ${M.ties}/${M.votes}; stalemates (80-turn guard, counted as losses) ${M.stalemates || 0}`);
const bossF = Object.entries(M.fights).filter(([k]) => /boss:|E4:/.test(k));
const agg = (fs_) => { const n = fs_.reduce((a, [, f]) => a + f.n, 0); return n ? (fs_.reduce((a, [, f]) => a + f.turns, 0) / n).toFixed(1) : '-'; };
console.log(`avg turns: gym boss ${agg(bossF.filter(([k]) => /boss:/.test(k)))}  E4 ${agg(bossF.filter(([k]) => /E4:/.test(k)))}  elite ${agg(Object.entries(M.fights).filter(([k]) => / elite$/.test(k)))}  trainer ${agg(Object.entries(M.fights).filter(([k]) => / trainer$/.test(k)))}`);
console.log('tuning:', JSON.stringify(COOP_TUNING));
console.log('fights (n, avg turns, losses, downs, lvl gap):');
for (const [k, f] of Object.entries(M.fights).sort()) console.log('  ' + k.padEnd(22), String(f.n).padStart(5), (f.turns / f.n).toFixed(1).padStart(5), String(f.losses).padStart(4), String(f.downs).padStart(4), (f.gap / f.n).toFixed(1).padStart(6));
