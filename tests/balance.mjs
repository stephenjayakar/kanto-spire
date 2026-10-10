// Balance runner: full runs with the greedy or smart bot, rich metrics.
// node tests/balance.mjs --runs 100 --asc 0 --skill smart --world kanto [--starter CHARMANDER] [--json out.json] [--verbose]
// One Spire (v0.1.0): --spire (each act draws its region from the seed; --pool K = KANTO only, default K,H)
//                     --regions K,H,H,K[,E4[,POST]] (force the act regions; the ELITE FOUR / post-game default to a
//                     seeded pick from the visited regions). Spire runs cycle the KANTO three starters, like the
//                     old worlds' batteries; --starters six = KANTO + HOENN three, nine = + the JOHTO three,
//                     --starter / --starters A,B override.
// JOHTO (v0.1.1): --pool K,H,J (the default pool stays K,H, as before JOHTO), --regions J,K,K,K, --jhp a,b,c / --jdmg x
//                 (TUNING.worldScale.johto), --jsummithp / --jsummitdmg (the JOHTO summit's spireHp / spireDmg per room).
import fs from 'fs';
import { loadData, D } from '../web/src/game/data.js';
import { Run, TUNING } from '../web/src/game/run.js';
import { maxHp, isFainted, addLevels, DECK_RULES } from '../web/src/game/pokemon.js';
import { BADGES, RELICS } from '../web/src/game/items.js';
import { REGIONS, REGION_IDS, spireCode, TIERS } from '../web/src/game/regions.js';
import { RNG } from '../web/src/game/rng.js';
import { COMBO_TUNING } from '../web/src/game/hands.js';
import { fight, postBattle, chooseNode, doShop, doEvent, doCenter, handleLevelEvents, teamHp, METRICS, BOT_OPTS, gainBotItem } from './bot.mjs';

await loadData(async f => JSON.parse(fs.readFileSync('web/assets/data/' + f, 'utf8')));
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i >= 0 ? process.argv[i + 1] : d; };
const RUNS = +arg('runs', 50), ASC = +arg('asc', 0), SKILL = arg('skill', 'smart'), WORLD = arg('world', 'kanto'), STARTER = arg('starter', null);
const VERBOSE = process.argv.includes('--verbose');
const LETTER = Object.fromEntries(REGION_IDS.map(id => [REGIONS[id].letter, id]));
const toRegion = (s) => { const id = LETTER[String(s).trim().toUpperCase()] || (REGIONS[String(s).trim().toLowerCase()] ? String(s).trim().toLowerCase() : null); if (!id) throw new Error('unknown region ' + s); return id; };
const FORCED = arg('regions') ? arg('regions').split(/[,-]/).map(toRegion) : null;
const SPIRE = !!FORCED || process.argv.includes('--spire');
const POOL = arg('pool') ? arg('pool').split(',').map(toRegion) : REGION_IDS.filter(id => id !== 'johto'); // (K,H: a 3-region pool needs --pool K,H,J)
const STARTERS_ARG = arg('starters') === 'six' ? ['BULBASAUR', 'TORCHIC', 'SQUIRTLE', 'TREECKO', 'CHARMANDER', 'MUDKIP']
  : arg('starters') === 'nine' ? ['BULBASAUR', 'TORCHIC', 'CYNDAQUIL', 'SQUIRTLE', 'TREECKO', 'CHIKORITA', 'CHARMANDER', 'MUDKIP', 'TOTODILE']
  : arg('starters') ? arg('starters').split(',') : null;
const LABEL = FORCED ? `spire ${FORCED.slice(0, 4).map(id => REGIONS[id].letter).join('-')}` : SPIRE ? `spire pool ${POOL.map(id => REGIONS[id].letter).join(',')}` : WORLD;
// The forced act regions for one run: E4 / post-game letters 5-6, else a seeded pick from the visited regions.
function forcedRegions(seed) {
  const acts = FORCED.slice(0, 4);
  while (acts.length < 4) acts.push(acts[acts.length - 1] || 'kanto');
  const rng = new RNG(`${seed}:forced`), visited = [...new Set(acts)];
  return { acts, summit: FORCED[4] || rng.pick(visited), post: FORCED[5] || rng.pick(visited) };
}
const SEED = arg('seed', 'BAL');
if (process.argv.includes('--metrics')) METRICS.on = true;
if (process.argv.includes('--olddig')) BOT_OPTS.oldDig = true;
if (process.argv.includes('--nodig')) BOT_OPTS.noDig = true;
if (process.argv.includes('--rotate')) BOT_OPTS.rotate = true; // the smart bot spreads EXP (easy fights led by the lowest level)
if (arg('expcurve')) TUNING.expCurve = +arg('expcurve'); // scaled EXP exponent (0 = flat EXP, as before v0.3.2)
if (arg('expmult')) TUNING.expMult = +arg('expmult');
if (process.argv.includes('--prev032')) { TUNING.expCurve = 0; RELICS.EXP_SHARE.rarity = 'uncommon'; RELICS.POKE_FLUTE.rarity = 'common'; } // the v0.3.1 EXP rules (A/B baseline) // the smart bot never discards (measures what discards are worth)
if (arg('scoring')) TUNING.scoring = arg('scoring');
if (arg('hpmult')) TUNING.hpMult = +arg('hpmult');
if (arg('dmgmult')) TUNING.dmgMult = +arg('dmgmult');
if (arg('itemscale')) TUNING.itemScale = +arg('itemscale');
// --hhp 0.75,0.925,1.035 / --hdmg 1.08: HOENN act scaling (TUNING.worldScale.hoenn: HP per act, damage)
if (arg('hhp')) TUNING.worldScale.hoenn.hp = arg('hhp').split(',').map(Number);
if (arg('hdmg')) TUNING.worldScale.hoenn.dmg = +arg('hdmg');
// --summithp 1.3,1.3,1.3,1.2,1.7: the HOENN summit's HP per ELITE FOUR room in spire runs
if (arg('summithp')) REGIONS.hoenn.summit.spireHp = arg('summithp').split(',').map(Number);
if (arg('summitdmg')) REGIONS.hoenn.summit.spireDmg = arg('summitdmg').split(',').map(Number);
// JOHTO acts / summit: --jhp 0.825,0.925,1.035 --jdmg 1.08 --jsummithp 1,1,1,1,1 --jsummitdmg 1,1,1,1,1
if (arg('jhp')) TUNING.worldScale.johto.hp = arg('jhp').split(',').map(Number);
if (arg('jdmg')) TUNING.worldScale.johto.dmg = +arg('jdmg');
if (arg('jsummithp')) REGIONS.johto.summit.spireHp = arg('jsummithp').split(',').map(Number);
if (arg('jsummitdmg')) REGIONS.johto.summit.spireDmg = arg('jsummitdmg').split(',').map(Number);
// --postgame: a CHAMPION goes on into the drawn post-game (JOHTO's ends with RED, a trainer boss); the run still counts as
// won, the post-game result is reported on its own line
const POSTGAME = process.argv.includes('--postgame');
const JTUNE = ['jhp', 'jdmg', 'jsummithp', 'jsummitdmg'].filter(k => arg(k)).map(k => `--${k} ${arg(k)}`).join(' ');
if (arg('comboscale')) COMBO_TUNING.scale = +arg('comboscale');
if (arg('bosshp')) for (const kv of arg('bosshp').split(',')) { const [k, v] = kv.split('='); TUNING.bossHp[k] = +v; } // --bosshp MISTY=0.7,BLAINE=0.8
// --rules copies=pp,hand=5,play=5,discards=3,kickersStay=1,... (see DECK_RULES in web/src/game/pokemon.js)
if (arg('rules')) for (const kv of arg('rules').split(',')) { const [k, v] = kv.split('='); if (!(k in DECK_RULES)) throw new Error('unknown rule ' + k); DECK_RULES[k] = isNaN(+v) ? v : +v; }
const GIVE = arg('give', null); // --give ITEM: every run starts holding this item (item impact test)
// --champ: every run is played by someone who has beaten a CHAMPION before (v0.3.25: CERULEAN CAVE's MEWTWO can show up)
const CHAMP = process.argv.includes('--champ');
// --mythicodds MEWTWO=1,DEOXYS=1: force the mythic events' rolls (events.js MYTHIC_ODDS) to bench their fights
if (arg('mythicodds')) { const { MYTHIC_ODDS } = await import('../web/src/game/events.js'); for (const kv of arg('mythicodds').split(',')) { const [k, v] = kv.split('='); MYTHIC_ODDS[k] = +v; } }

const M = { fights: {}, relicPicks: [], deaths: {}, combos: {}, runs: [], startersWon: {}, startersRun: {}, events: {}, eventActs: {}, tiers: {}, seqs: {} };
const LOGS = arg('logs', null) ? [] : null; // --logs out.json: write run logs for tools/analyze_runs.mjs

function simulate(i) {
  const starters = STARTERS_ARG || (SPIRE ? ['BULBASAUR', 'CHARMANDER', 'SQUIRTLE']
    : WORLD === 'hoenn' ? ['TREECKO', 'TORCHIC', 'MUDKIP'] : ['BULBASAUR', 'CHARMANDER', 'SQUIRTLE']);
  const starter = STARTER || starters[i % starters.length];
  const run = SPIRE ? Run.create({ starter, ascension: ASC, seed: `${SEED}${i}`, world: 'spire', pool: POOL, regions: FORCED ? forcedRegions(`${SEED}${i}`) : null, champ: CHAMP })
    : Run.create({ starter, ascension: ASC, seed: `${SEED}${i}`, world: WORLD, champ: CHAMP });
  const rng = run.rng.fork('bot');
  if (GIVE) for (const k of GIVE.split(',')) run.addRelic(k);
  const log = (...a) => VERBOSE && console.log(...a);
  let guard = 0;
  const finish = (died) => {
    if (LOGS) LOGS.push(run.finishLog(died ? 'lose' : 'win'));
    // per tier x region: runs that reached the act and runs that died in it (spire runs)
    if (run.regions) {
      for (let t = 0; t <= Math.min(run.actIndex, 3); t++) {
        const o = (M.tiers[`A${t + 1} ${REGIONS[run.regions.acts[t]].letter}`] ||= { n: 0, d: 0 });
        o.n++; if (died && t === run.actIndex && !/E4:/.test(died)) o.d++;
      }
      if (run.actIndex >= 3) { const o = (M.tiers[`E4 ${REGIONS[run.regions.summit].letter}`] ||= { n: 0, d: 0 }); if (run.gauntletIndex >= 0 || !died || /E4:/.test(died)) { o.n++; if (died && /E4:/.test(died)) o.d++; } }
      const sq = (M.seqs[spireCode(run.regions)] ||= { n: 0, w: 0 }); sq.n++; if (!died) sq.w++;
    }
    const lv = run.party.map(m => m.level).sort((a, b) => b - a);
    const r = { starter, died, legend: run.legendTaken || null, seed: `${SEED}${i}`, lv, nItems: run.relics.length, badges: run.badges.length, act: run.actIndex + 1, floor: run.floor, party: run.party.map(m => `${D.species[m.species].name}${m.level}`), relics: run.relics.map(r => r.key), best: run.stats.bestHand, combos: { ...run.comboPlays } };
    M.runs.push(r);
    M.startersRun[starter] = (M.startersRun[starter] || 0) + 1;
    if (!died) M.startersWon[starter] = (M.startersWon[starter] || 0) + 1;
    else M.deaths[died] = (M.deaths[died] || 0) + 1;
    for (const [k, v] of Object.entries(run.comboPlays)) M.combos[k] = (M.combos[k] || 0) + v;
    return r;
  };
  while (guard++ < 400) {
    const id = chooseNode(run, rng, SKILL);
    if (!id) return finish('stalled');
    const node = run.enterNode(id);
    log(`A${run.actIndex + 1}F${node.floor} ${node.type.padEnd(8)} hp ${Math.round(teamHp(run) * 100)}% ${run.party.map(m => `${D.species[m.species].name}${m.level}`).join(' ')} $${run.money} [${run.relics.map(r => r.key).join(',')}]`);
    if (['wild', 'trainer', 'elite', 'boss', 'rival', 'legend'].includes(node.type)) {
      const cfg = run.battleConfig(node);
      const b = fight(run, cfg, SKILL, M);
      log(`   vs ${cfg.trainer?.title || cfg.legend || cfg.enemies[0].species} [${cfg.enemies.map(e => e.species + e.level).join(',')}] ${b.result.outcome} in ${b.turn}`);
      if (node.type === 'legend') M.birds = (M.birds || 0) + 1;
      if (b.result.outcome === 'lose') {
        const why = `A${run.actIndex + 1} ${cfg.gauntlet !== undefined ? 'E4:' + cfg.trainer.name : node.type === 'boss' ? 'boss:' + (cfg.trainer?.name || cfg.legend) : node.type}`;
        if (run.act.postgame) { const P = (M.post ||= { n: 0, w: 0, deaths: {} }); P.n++; P.deaths[why] = (P.deaths[why] || 0) + 1; return finish(null); }
        return finish(why);
      }
      postBattle(run, b, rng, SKILL, M);
      if (node.type === 'boss') {
        if (run.act.postgame) { const P = (M.post ||= { n: 0, w: 0, deaths: {} }); P.n++; P.w++; P.boss = cfg.trainer?.name || cfg.legend; return finish(null); }
        if (run.act.gauntlet) {
          for (let g = 1; g < run.act.gauntlet.length; g++) {
            for (const m of run.party) if (!isFainted(m)) m.hp = Math.min(maxHp(m), m.hp + Math.floor(maxHp(m) * 0.5));
            run.gauntletIndex = g;
            if (SKILL === 'smart') doShop(run, rng.fork('plateau' + g), SKILL);
            const c2 = run.gauntletConfig(rng.fork('g' + g), g);
            const b2 = fight(run, c2, SKILL, M);
            log(`   E4 ${c2.trainer.title} ${b2.result.outcome} in ${b2.turn}`);
            if (b2.result.outcome === 'lose') return finish(`A4 E4:${c2.trainer.name}`);
            postBattle(run, b2, rng, SKILL, M);
          }
          if (POSTGAME && run.acts[run.actIndex + 1]?.postgame) { run.nextActHeal(); run.startAct(run.actIndex + 1); continue; }
          return finish(null);
        }
        const badge = Object.values(BADGES).find(x => x.leader === run.boss.replace('LEADER_', ''));
        if (badge && !run.badges.includes(badge.key)) run.badges.push(badge.key);
        run.nextActHeal();
        run.startAct(run.actIndex + 1);
      }
    } else if (node.type === 'center') {
      const r = doCenter(run, SKILL);
      if (r.train) handleLevelEvents(run, [{ mon: r.train, events: addLevels(r.train, 3) }], SKILL);
    } else if (node.type === 'mart') doShop(run, rng, SKILL);
    else if (node.type === 'treasure') {
      gainBotItem(run, run.randomConsumable(rng, run.actIndex + 1), SKILL);
      const rel = rng.chance(TUNING.relicOdds.treasure) ? run.relicChoices(rng, 2, { common: 40, uncommon: 45, rare: 15 }) : [];
      if (rel[0]) run.addRelic(rel[0]);
    } else if (node.type === 'event') {
      const r = doEvent(run, rng, SKILL);
      const ek = `${REGIONS[run.region].letter}${run.actIndex + 1} ${r.id}`;
      const eo = (M.events[ek] ||= {}); eo[r.label || '-'] = (eo[r.label || '-'] || 0) + 1;
      M.eventActs[run.actIndex + 1] = (M.eventActs[run.actIndex + 1] || 0) + 1;
      if (r.battle) {
        const b = fight(run, r.battle, SKILL, M);
        if (r.battle.mythic) { // (v0.3.25 mythic events: per mythic, fights / wins / catches / soft losses)
          const o = ((M.mythics ||= {})[r.battle.mythic] ||= { n: 0, won: 0, caught: 0, lost: 0, fled: 0, blocked: 0 });
          o.n++; if (b.result.outcome === 'win' || b.result.outcome === 'caught') o.won++; if (b.result.outcome === 'lose') o.lost++; if (b.result.outcome === 'enemyFled') o.fled++;
          if (run.hasLegendary()) o.blocked++;
          const had = run.legendTaken;
          if (b.result.outcome === 'lose') { run.softLoss(b); continue; } // the run goes on (Run.softLoss)
          if (b.result.outcome === 'enemyFled') continue;
          postBattle(run, b, rng, SKILL, M);
          if (!had && run.legendTaken === r.battle.catchOffer?.species) o.caught++;
          continue;
        }
        if (b.result.outcome === 'lose') return finish(`A${run.actIndex + 1} event:${r.id}`);
        postBattle(run, b, rng, SKILL, M);
      }
    }
  }
  return finish('stalled');
}

const t0 = Date.now();
for (let i = 0; i < RUNS; i++) {
  const r = simulate(i);
  if (VERBOSE || process.argv.includes('--each')) console.log(`run ${i} ${r.starter} ${r.died ? 'DIED ' + r.died : 'WON'} | ${r.party.join(' ')} | ${r.relics.join(',')}`);
}
const wins = M.runs.filter(r => !r.died).length;
console.log(`\n=== ${LABEL} A${ASC} ${SKILL}: ${wins}/${RUNS} wins (${Math.round(100 * wins / RUNS)}%) in ${((Date.now() - t0) / 1000).toFixed(1)}s${JTUNE ? ` [${JTUNE}]` : ''}`);
if (M.post) console.log(`post-game: ${M.post.w}/${M.post.n} beat the post-game boss | deaths: ${Object.entries(M.post.deaths).map(([k, v]) => `${k}:${v}`).join('  ') || '-'}`);
{ // the party at the end of the run: size, top level, average level, spread = top level - the average of the others
  const avg = (a) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
  const line = (rs) => { const multi = rs.filter(r => r.lv.length > 1); return `n ${rs.length}, size ${avg(rs.map(r => r.lv.length)).toFixed(2)}, top lvl ${avg(rs.map(r => r.lv[0])).toFixed(1)}, avg lvl ${avg(rs.map(r => avg(r.lv))).toFixed(1)}, spread ${avg(multi.map(r => r.lv[0] - avg(r.lv.slice(1)))).toFixed(1)}`; };
  console.log(`party at end: all ${line(M.runs)} | winners ${line(M.runs.filter(r => !r.died))}`);
}
console.log(`birds fought: ${M.birds || 0}, caught: ${M.legendCatches || 0}, released (nuzlocke): ${M.released || 0}`);
if (M.mythics) console.log('mythics (fights, won, caught, lost, fled, had a legendary already):', Object.entries(M.mythics).map(([k, o]) => `${k} ${o.n}/${o.won}/${o.caught}/${o.lost}/${o.fled}/${o.blocked}`).join('  '));
console.log(`legendaries held at the end: ${M.runs.filter(r => r.legend).length}/${RUNS} runs (${Object.entries(M.runs.reduce((a, r) => { if (r.legend) a[r.legend] = (a[r.legend] || 0) + 1; return a; }, {})).map(([k, v]) => `${k} ${v}`).join(', ')})`);
console.log('starters:', Object.keys(M.startersRun).map(s => `${s} ${M.startersWon[s] || 0}/${M.startersRun[s]}`).join('  '));
console.log('deaths:', Object.entries(M.deaths).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join('  '));
console.log('fights (n, turns, hp lost/fight, losses, lvl gap, hands/enemy mon):');
for (const [k, f] of Object.entries(M.fights).sort()) console.log('  ' + k.padEnd(22), String(f.n).padStart(5), (f.turns / f.n).toFixed(1).padStart(5), (100 * f.hpLost / f.n).toFixed(0).padStart(4) + '%', String(f.losses).padStart(4), (f.lvlGap / f.n).toFixed(1).padStart(6), ((f.hands || 0) / Math.max(1, f.mons || 0)).toFixed(2).padStart(6));
if (M.bossHp) console.log('median team HP entering act boss:', Object.entries(M.bossHp).map(([k, v]) => `${k} ${v.sort((a, b) => a - b)[v.length >> 1]}%`).join('  '));
{
  const F = Object.values(M.fights).reduce((a, f) => { for (const k of ['n', 'turns', 'hands', 'disc', 'discTurns', 'discCards', 'sw', 'deck']) a[k] = (a[k] || 0) + (f[k] || 0); return a; }, {});
  console.log(`discards: ${(F.disc / F.n).toFixed(2)}/battle (${(F.discCards / Math.max(1, F.disc)).toFixed(1)} cards each), turns with a discard ${(100 * F.discTurns / F.turns).toFixed(0)}%, switches ${(F.sw / F.n).toFixed(2)}/battle, turns/battle ${(F.turns / F.n).toFixed(2)}, lead deck ${(F.deck / F.n).toFixed(1)} cards`);
}
console.log('"?" events per run by act:', Object.entries(M.eventActs).map(([a, n]) => `A${a} ${(n / RUNS).toFixed(2)}`).join('  '), `| curses held at end: ${M.runs.reduce((a, r) => a + r.relics.filter(k => /CURSED_DOLL|HEX_LETTER|LAGGING_TAIL|ROTTEN_MUSHROOM|IOU_NOTE/.test(k)).length, 0)}`);
if (Object.keys(M.tiers).length) {
  console.log('spire tiers (reached, died there, death %):', Object.entries(M.tiers).sort().map(([k, o]) => `${k} ${o.n}/${o.d}/${Math.round(100 * o.d / Math.max(1, o.n))}%`).join('  '));
  if (!FORCED) console.log('spire sequences (runs, wins):', Object.entries(M.seqs).sort((a, b) => b[1].n - a[1].n).map(([k, o]) => `${k} ${o.w}/${o.n}`).join('  '));
}
if (process.argv.includes('--events')) for (const [k, o] of Object.entries(M.events).sort()) console.log('  ' + k.padEnd(26), Object.entries(o).sort((a, b) => b[1] - a[1]).map(([l, n]) => `${n}x ${l}`).join(' | '));
const totalCombo = Object.values(M.combos).reduce((a, b) => a + b, 0);
console.log('combo usage:', Object.entries(M.combos).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${Math.round(100 * v / totalCombo)}%`).join('  '));
const relWin = {};
for (const r of M.runs) for (const k of r.relics) { const o = (relWin[k] ||= { n: 0, w: 0 }); o.n++; if (!r.died) o.w++; }
console.log('relics held at end (n, win%):', Object.entries(relWin).sort((a, b) => b[1].n - a[1].n).slice(0, 25).map(([k, o]) => `${k} ${o.n}/${Math.round(100 * o.w / o.n)}%`).join('  '));
if (arg('json')) fs.writeFileSync(arg('json'), JSON.stringify({ M, wins, RUNS, ASC, SKILL, WORLD: LABEL, SEED, GIVE, SCORING: TUNING.scoring, HPMULT: TUNING.hpMult, DMGMULT: TUNING.dmgMult, ITEMSCALE: TUNING.itemScale, COMBOSCALE: COMBO_TUNING.scale, RULES: { ...DECK_RULES }, decisions: METRICS.on ? METRICS.decisions : undefined }));
if (LOGS) { fs.writeFileSync(arg('logs'), JSON.stringify(LOGS)); console.log('wrote', LOGS.length, 'run logs to', arg('logs')); }
