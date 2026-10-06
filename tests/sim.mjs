// Headless run simulator: a greedy bot plays full runs to smoke-test the engine and tune balance.
// Usage: node tests/sim.mjs [runs=20] [ascension=0] [starter] [--verbose]
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadData, D } from '../web/src/game/data.js';
import { Run } from '../web/src/game/run.js';
import { Battle } from '../web/src/game/battle.js';
import { reachable } from '../web/src/game/map.js';
import { maxHp, isFainted, teachMove, evolve, monName } from '../web/src/game/pokemon.js';
import { CONSUMABLES, BADGES } from '../web/src/game/items.js';
import { generateShop, buyItem } from '../web/src/game/shop.js';
import { pickEvent, eventChoices } from '../web/src/game/events.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(here, '../web/assets/data');
await loadData(async f => JSON.parse(fs.readFileSync(path.join(dataDir, f), 'utf8')));

const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
const RUNS = +(args[0] || 20), ASC = +(args[1] || 0), STARTER = args[2] || null;
const VERBOSE = process.argv.includes('--verbose');
const log = (...a) => VERBOSE && console.log(...a);

function subsets(arr, max) {
  const out = [];
  const n = arr.length;
  for (let mask = 1; mask < (1 << n); mask++) {
    let c = 0; for (let i = 0; i < n; i++) if (mask & (1 << i)) c++;
    if (c > max) continue;
    const s = []; for (let i = 0; i < n; i++) if (mask & (1 << i)) s.push(arr[i]);
    out.push(s);
  }
  return out;
}

function estimate(b, ids) {
  const p = b.preview(ids);
  if (!p) return 0;
  let dmg = 0, bonus = p.bonus;
  for (const id of p.scoring) {
    const info = b.cardInfo(b.deck.hand.find(c => c.id === id));
    if (info.status) { bonus += 10; continue; }
    dmg += info.dmgPreview * ((info.move.accuracy || 100) / 100);
  }
  return dmg * (1 + bonus / 100);
}

function botTurn(b, run) {
  const lead = b.lead();
  const e = b.enemy();
  // heal
  if (lead.hp < maxHp(lead) * 0.3) {
    const pot = run.consumables.find(k => CONSUMABLES[k]?.heal || CONSUMABLES[k]?.healFrac);
    if (pot) { b.useItem(pot, lead.uid); }
  }
  // catch
  if (b.kind === 'wild' && run.party.length < (run.actIndex >= 1 ? 6 : 4) && e.hp < e.maxHp * 0.7 && run.totalBalls() > 0 && !b.enemy().legendary) {
    const ball = Object.keys(run.balls).find(k => run.balls[k] > 0);
    return b.throwBall(ball);
  }
  if (b.kind === 'wild' && e.legendary && e.hp < e.maxHp * 0.35 && run.totalBalls() > 0 && run.party.length < 6) {
    const ball = Object.keys(run.balls).reverse().find(k => run.balls[k] > 0);
    return b.throwBall(ball);
  }
  // switch away from a fragile lead
  if (lead.hp < maxHp(lead) * 0.2 && b.discardsLeft > 1) {
    const alt = run.party.filter(m => !isFainted(m) && m.uid !== lead.uid).sort((a, c) => c.hp / maxHp(c) - a.hp / maxHp(a))[0];
    if (alt && alt.hp / maxHp(alt) > 0.5) b.switchLead(alt.uid);
  }
  const playable = b.deck.hand.filter(c => b.cardInfo(c).playable).map(c => c.id);
  if (!playable.length) {
    if (b.discardsLeft > 0) return b.discard(b.deck.hand.slice(0, 5).map(c => c.id));
    // nothing playable and no discards: play anything is impossible -> force by switching
    const alt = run.party.find(m => !isFainted(m) && m.uid !== b.leadUid);
    if (alt) b.switchLead(alt.uid, true);
    const p2 = b.deck.hand.filter(c => b.cardInfo(c).playable).map(c => c.id);
    if (!p2.length) { b.deck.discard.push(...b.deck.hand); b.deck.hand = []; b.drawToHand(); return []; }
  }
  const hand = b.deck.hand.filter(c => b.cardInfo(c).playable).map(c => c.id);
  let best = null, bestV = -1;
  for (const s of subsets(hand, b.maxPlay)) {
    if (!b.canPlay(s).ok) continue;
    const v = estimate(b, s);
    if (v > bestV) { bestV = v; best = s; }
  }
  if (bestV < e.hp * 0.25 && b.discardsLeft > 0 && b.turn > 0 && Math.random() < 0.5) {
    const keep = new Set(best || []);
    const toss = b.deck.hand.filter(c => !keep.has(c.id)).slice(0, 5).map(c => c.id);
    if (toss.length) { b.discard(toss); return botTurn(b, run); }
  }
  if (!best) best = [hand[0]];
  return b.play(best);
}

const FSTATS = {};
function fight(run, cfg) {
  const hpBefore = run.party.reduce((a, m) => a + m.hp / maxHp(m), 0) / run.party.length;
  const b = new Battle(run, cfg);
  b.start();
  let guard = 0;
  while (!b.result && guard++ < 60) botTurn(b, run);
  if (!b.result) b.end('lose');
  const hpAfter = run.party.reduce((a, m) => a + m.hp / maxHp(m), 0) / run.party.length;
  const k = `A${run.actIndex + 1} ${cfg.gauntlet !== undefined ? 'e4 ' + cfg.trainer.name : cfg.kind === 'boss' ? 'boss ' + (cfg.trainer?.name || cfg.legend) : cfg.kind}`;
  const f = (FSTATS[k] ||= { n: 0, turns: 0, hpLost: 0, losses: 0 });
  f.n++; f.turns += b.turn; f.hpLost += hpBefore - hpAfter; if (b.result.outcome === 'lose') f.losses++;
  return b;
}

function handleLevelEvents(run, list) {
  for (const { mon, events } of list) {
    for (const ev of events) {
      if (ev.type === 'learn') {
        if (mon.moves.length < 4) teachMove(mon, ev.move);
        else {
          const mv = D.moves[ev.move];
          const weakest = mon.moves.map((m, i) => [D.moves[m.move]?.power || 0, i]).sort((a, b) => a[0] - b[0])[0];
          if (mv.power > weakest[0] + 10) teachMove(mon, ev.move, weakest[1]);
        }
      }
      if (ev.type === 'evolve') evolve(mon, ev.into);
    }
  }
}

function postBattle(run, b, rng) {
  const r = run.afterBattle(b);
  handleLevelEvents(run, run.distributeExp(b.result, b.kind));
  if (r.newMon) { if (!run.addToParty(r.newMon)) { /* full */ } }
  if (b.kind === 'trainer' || b.kind === 'elite' || b.kind === 'boss') {
    const choices = run.moveRewardChoices(rng);
    if (choices.length) {
      const c = choices.sort((x, y) => (D.moves[y.move].power || 0) - (D.moves[x.move].power || 0))[0];
      const mon = run.party.find(m => m.uid === c.uid);
      const weakest = mon.moves.map((m, i) => [D.moves[m.move]?.power || 0, i]).sort((a, b) => a[0] - b[0])[0];
      if (mon.moves.length < 4) teachMove(mon, c.move); else if ((D.moves[c.move].power || 0) > weakest[0]) teachMove(mon, c.move, weakest[1]);
    }
  }
  if (b.kind === 'elite' || b.kind === 'boss') {
    const relics = run.relicChoices(rng, 3, b.kind === 'boss' ? { uncommon: 50, rare: 50 } : undefined);
    if (relics.length) run.addRelic(relics[0]);
  }
  if (rng.chance(0.4)) run.addConsumable(run.randomConsumable(rng));
  useItems(run, rng);
}

function useItems(run, rng) {
  for (const k of run.consumables.slice()) {
    const c = CONSUMABLES[k];
    if (!c) continue;
    if (c.combo || c.sell) { run.applyConsumableToMon(k, null); run.useConsumable(k); }
    else if (c.levels) { const m = run.party[0]; if (run.applyConsumableToMon(k, m)) { run.useConsumable(k); handleLevelEvents(run, [run.pendingLevelEvents]); run.pendingLevelEvents = null; } }
    else if (c.addCopy) { const m = run.party[0]; const best = m.moves.map((x, i) => [D.moves[x.move].power || 0, i]).sort((a, b) => b[0] - a[0])[0]; m.moves[best[1]].copies += c.addCopy; run.useConsumable(k); }
    else if (c.evo) { const m = run.party.find(m => run.applyConsumableToMon(k, m)); if (m) { evolve(m, run.pendingEvolution.into); run.pendingEvolution = null; run.useConsumable(k); } }
  }
  if (run.balls.POKE_BALL < 3 && run.money > 1000) { run.balls.POKE_BALL += 3; run.money -= 600; }
}

function simulate(seed, asc, starter) {
  const WORLD = process.env.WORLD || 'kanto';
  const run = Run.create({ starter: starter || (WORLD === 'hoenn' ? ['TREECKO', 'TORCHIC', 'MUDKIP'] : ['BULBASAUR', 'CHARMANDER', 'SQUIRTLE'])[seed % 3], ascension: asc, seed: 'SIM' + seed, world: WORLD });
  const rng = run.rng.fork('bot');
  let guard = 0;
  while (!run.finished && guard++ < 200) {
    const next = reachable(run.map, run.nodeId);
    if (!next.length) break;
    const avgHp = run.party.reduce((a, m) => a + m.hp / maxHp(m), 0) / run.party.length;
    const pref = { center: avgHp < 0.55 ? 10 : 1, trainer: 4, elite: avgHp > 0.7 ? 3 : 0.5, wild: run.party.length < 6 ? 4 : 2, event: 2, mart: run.money > 3000 ? 3 : 1, treasure: 5, boss: 10 };
    const id = next.sort((a, c) => (pref[run.map.nodes[c].type] || 1) - (pref[run.map.nodes[a].type] || 1) + (rng.next() - 0.5))[0];
    const node = run.enterNode(id);
    log(`A${run.actIndex + 1} F${node.floor} ${node.type} party ${run.party.map(m => `${monName(m)}${m.level}:${m.hp}/${maxHp(m)}`).join(' ')} $${run.money}`);
    if (['wild', 'trainer', 'elite', 'boss'].includes(node.type)) {
      const cfg = run.battleConfig(node);
      const b = fight(run, cfg);
      log(`   vs ${cfg.trainer?.title || cfg.enemies[0].species} [${cfg.enemies.map(e => e.species + e.level + '(' + e.maxHp + ')').join(',')}] -> ${b.result.outcome} in ${b.turn} turns`);
      if (b.result.outcome === 'lose') { run.finished = true; return { run, died: `A${run.actIndex + 1}F${node.floor} ${node.type} ${cfg.trainer?.title || cfg.enemies[0].species}` }; }
      postBattle(run, b, rng);
      if (node.type === 'boss') {
        if (run.act.gauntlet) {
          // E4 gauntlet
          for (let i = 1; i < run.act.gauntlet.length; i++) {
            run.gauntletIndex = i;
            const cfg2 = run.gauntletConfig(rng, i);
            const b2 = fight(run, cfg2);
            log(`   GAUNTLET ${cfg2.trainer.title} -> ${b2.result.outcome} in ${b2.turn}`);
            if (b2.result.outcome === 'lose') { run.finished = true; return { run, died: `E4 ${cfg2.trainer.title}` }; }
            postBattle(run, b2, rng);
            for (const m of run.party) if (!isFainted(m)) m.hp = Math.min(maxHp(m), m.hp + Math.floor(maxHp(m) * 0.5));
          }
          run.finished = true; run.victory = true; return { run, died: null };
        }
        if (run.actIndex + 1 >= 4) { run.finished = true; run.victory = true; break; }
        { const b = Object.values(BADGES).find(x => x.leader === run.boss.replace('LEADER_', '')); if (b) run.badges.push(b.key); }
        run.nextActHeal();
        run.startAct(run.actIndex + 1);
      }
    } else if (node.type === 'center') {
      if (avgHp < 0.8 || run.party.some(isFainted)) run.centerHeal();
      else handleLevelEvents(run, [{ mon: run.party[0], events: (await_addLevels(run.party[0])) }]);
    } else if (node.type === 'mart') {
      const shop = generateShop(run, rng);
      for (const it of shop.items) if (run.money > it.price + 500 && (it.kind === 'ball' || it.kind === 'relic' || CONSUMABLES[it.key]?.heal)) buyItem(run, shop, it);
    } else if (node.type === 'treasure') {
      run.addConsumable(run.randomConsumable(rng));
      if (rng.chance(0.4)) { const rel = run.relicChoices(rng, 1); if (rel[0]) run.addRelic(rel[0]); }
    } else if (node.type === 'event') {
      const ev = pickEvent(run, rng);
      const list = eventChoices(ev, run);
      const choice = list.find(c => (!c.cond || c.cond(run)) && !c.needsRelic) || list[list.length - 1];
      const res = choice.run(run, rng, run.party.find(m => !isFainted(m)) || run.party[0], []) || {};
      if (res.newMon) run.addToParty(res.newMon);
      if (run.pendingLevelEvents) { handleLevelEvents(run, [run.pendingLevelEvents]); run.pendingLevelEvents = null; }
      if (res.battle) {
        const b = fight(run, res.battle);
        if (b.result.outcome === 'lose') { run.finished = true; return { run, died: `event ${ev.id}` }; }
        postBattle(run, b, rng);
      }
    }
  }
  return { run, died: run.victory ? null : 'stalled' };
}

import { addLevels } from '../web/src/game/pokemon.js';
function await_addLevels(mon) { return addLevels(mon, 2); }

const results = [];
const t0 = Date.now();
for (let i = 0; i < RUNS; i++) {
  const r = simulate(i, ASC, STARTER);
  results.push(r);
  const run = r.run;
  console.log(`run ${i} ${run.starter.padEnd(10)} ${r.died ? 'DIED ' + r.died : 'WON'} | act ${run.actIndex + 1} | party ${run.party.map(m => `${D.species[m.species].name}${m.level}`).join(' ')} | relics ${run.relics.length} | best ${run.stats.bestHand}`);
}
const wins = results.filter(r => !r.died).length;
const acts = [0, 0, 0, 0, 0];
for (const r of results) acts[r.run.actIndex]++;
for (const [k, f] of Object.entries(FSTATS).sort()) console.log(k.padEnd(12), "fights", String(f.n).padStart(4), "turns", (f.turns / f.n).toFixed(1), "hp lost", (100 * f.hpLost / f.n).toFixed(0) + "%", "losses", f.losses);
console.log(`\nA${ASC}: ${wins}/${RUNS} wins (${Math.round(100 * wins / RUNS)}%). Reached act: ${acts.join('/')}. ${(Date.now() - t0) / 1000}s`);
{
  const agg = {};
  for (const r of results) for (const h of (r.run.metrics?.hands || [])) { const k = 'A' + (h.act + 1) + ' ' + h.kind; const a = (agg[k] ||= { n: 0, dmg: 0, ratio: 0 }); a.n++; a.dmg += h.dmg; a.ratio += h.dmg / h.ehp; }
  for (const [k, a] of Object.entries(agg).sort()) console.log('hands', k.padEnd(12), 'avg dmg', Math.round(a.dmg / a.n), 'avg dmg/enemyHP', (a.ratio / a.n).toFixed(2));
}
