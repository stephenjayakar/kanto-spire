// Co-op mythic bench (v0.3.25): smart bots play KANTO rooms until act 3 (KANTO act 3 is CERULEAN CAVE's), then the same
// room state fights each foe below (a checkpoint restored once per foe): MEWTWO (all-target), the other mythics, and the
// act's legendary node (the ARTICUNO + MOLTRES pair) as the reference. Win %, turns, players downed, team HP left.
//   node tests/coop_mythic_bench.mjs --rooms 30 --players 2 --seed MB [--floor 4] [--hp mythic=2.4] [--dmg mythic=1.3] [--spread 0.75] [--coophp MEWTWO=0.6]
import fs from 'fs';
import { loadData } from '../web/src/game/data.js';
import { maxHp } from '../web/src/game/pokemon.js';
import { playCoop, makeBot, botAction } from './coop_bot.mjs';
import { mythicDuoConfig, legendPairConfig, CoopGame } from '../web/src/game/coop/coop.js';
import { snapshotGame, restoreGame } from '../web/src/game/coop/snapshot.js';
import { CURRENT } from '../web/src/game/coop/engines.js';
import { COOP_TUNING } from '../web/src/game/coop/tuning.js';

await loadData(async f => JSON.parse(fs.readFileSync('web/assets/data/' + f, 'utf8')));
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i >= 0 ? process.argv[i + 1] : d; };
const ROOMS = +arg('rooms', 20), N = +arg('players', 2), SEED = arg('seed', 'MB'), FLOOR = +arg('floor', 4);
for (const k of ['hp', 'dmg']) if (arg(k)) for (const kv of arg(k).split(',')) { const [a, v] = kv.split('='); COOP_TUNING[k][a] = +v; }
if (arg('spread')) COOP_TUNING.spread = +arg('spread');
// --coophp MEWTWO=0.6,DEOXYS=0.85: the mythics' extra co-op HP (acts.js MYTHICS[id].coopHp)
if (arg('coophp')) { const { MYTHICS } = await import('../web/src/game/acts.js'); for (const kv of arg('coophp').split(',')) { const [k, v] = kv.split('='); MYTHICS[k].coopHp = +v; } }
const FOES = (arg('foes') || 'MEWTWO,MEW,DEOXYS,RAYQUAZA,PAIR').split(',');
const STARTERS = ['BULBASAUR', 'CHARMANDER', 'SQUIRTLE'];

const teamHp = (g) => g.runs.reduce((a, r) => a + r.party.reduce((x, m) => x + Math.max(0, m.hp) / maxHp(m), 0) / r.party.length, 0) / g.runs.length;
function fightFrom(snap, foe, seed) {
  const g = restoreGame(snap, CURRENT);
  g.world.floor = FLOOR; g.mirror();
  const rng = g.world.rng.fork('bench' + foe);
  const cfg = foe === 'PAIR' ? legendPairConfig(g.world, rng, FLOOR, 'LEGEND_ARTICUNO', N) : mythicDuoConfig(g.world, foe, N);
  const hp0 = teamHp(g);
  g.startBattle(cfg);
  const d = g.battle, bots = g.runs.map((_, p) => makeBot(seed + foe, p));
  let k = 0, spread = 0;
  while (!d.result && k++ < 6000 && d.turn <= 60) {
    if (d.intents.some(it => it?.spread)) spread++;
    let acted = false;
    for (const b of bots) { const a = botAction(g, b); if (!a) continue; g.apply({ ...JSON.parse(JSON.stringify(a)), seq: g.seq + 1 }); acted = true; break; }
    if (!acted) break;
  }
  const out = d.result?.outcome || 'stalemate';
  return { out, turns: d.turn, downs: d.down.filter(Boolean).length, hpLost: hp0 - teamHp(g), lvl: Math.max(...cfg.enemies.map(e => e.level)), hp: cfg.enemies.reduce((a, e) => a + e.maxHp, 0), spread };
}

const M = {};
let reached = 0;
const t0 = Date.now();
for (let i = 0; i < ROOMS; i++) {
  const starters = Array.from({ length: N }, (_, k) => STARTERS[(i + k) % 3]);
  const { game } = playCoop({ seed: `${SEED}${i}`, world: 'kanto', starters, stopWhen: g => g.world.actIndex >= 2 && g.phase === 'map' });
  if (game.world.actIndex < 2 || game.phase !== 'map') continue;
  reached++;
  const snap = snapshotGame(game);
  const top = Math.max(...game.runs.flatMap(r => r.party.map(m => m.level)));
  for (const foe of FOES) {
    const r = fightFrom(snap, foe, `${SEED}${i}`);
    const o = (M[foe] ||= { n: 0, win: 0, turns: 0, downs: 0, hpLost: 0, gap: 0, hp: 0, stale: 0 });
    o.n++; if (r.out === 'win') o.win++; if (r.out === 'stalemate') o.stale++;
    o.turns += r.turns; o.downs += r.downs; o.hpLost += r.hpLost; o.gap += top - r.lvl; o.hp += r.hp;
  }
}
console.log(`=== co-op mythic bench ${N}p, ${reached}/${ROOMS} rooms reached KANTO act 3 (floor ${FLOOR}), ${((Date.now() - t0) / 1000).toFixed(0)}s; spread ${COOP_TUNING.spread}, mythic hp ${COOP_TUNING.hp.mythic} dmg ${COOP_TUNING.dmg.mythic}`);
console.log('foe        n   win%  turns  downs/fight  team HP lost  lvl gap  foe HP');
for (const [k, o] of Object.entries(M)) console.log(`${k.padEnd(9)} ${String(o.n).padStart(3)} ${(100 * o.win / o.n).toFixed(0).padStart(5)}% ${(o.turns / o.n).toFixed(1).padStart(6)} ${(o.downs / o.n).toFixed(2).padStart(10)} ${(100 * o.hpLost / o.n).toFixed(0).padStart(11)}% ${(o.gap / o.n).toFixed(1).padStart(8)} ${Math.round(o.hp / o.n).toString().padStart(7)}${o.stale ? `  (${o.stale} stalemates)` : ''}`);
