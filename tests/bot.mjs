// Player bots for balance testing. skill: 'greedy' (naive) | 'smart' (plays like a competent human).
import { regionOf } from '../web/src/game/regions.js';
import { D, typeEffect, bst } from '../web/src/game/data.js';
import { RNG } from '../web/src/game/rng.js';
import { maxHp, isFainted, teachMove, evolve, stats, typesOf, knowsMove, canLearn, DECK_RULES, replacedCopies } from '../web/src/game/pokemon.js';
import { CONSUMABLES, RELICS, BALLS, VITAMIN_COMBO, APRICORN_BALLS } from '../web/src/game/items.js';
import { generateShop, buyItem, rerollShop } from '../web/src/game/shop.js';
import { pickEvent, eventById, eventChoices, choiceLabel, upgradeMove, bestUpgrade, powerCap, markSeen } from '../web/src/game/events.js';
import { reachable } from '../web/src/game/map.js';
import { Battle, ballBonus } from '../web/src/game/battle.js';
import { TUNING } from '../web/src/game/run.js';
import { detectCombo, comboBonus } from '../web/src/game/hands.js';

// ---------------------------------------------------------------- hand evaluation
function subsets(arr, max) {
  const out = [];
  for (let mask = 1; mask < (1 << arr.length); mask++) {
    const s = [];
    for (let i = 0; i < arr.length; i++) if (mask & (1 << i)) s.push(arr[i]);
    if (s.length <= max) out.push(s);
  }
  return out;
}

// Exact score via the real scoring code, with state snapshot/restore and a neutral RNG.
export function dryScore(b, ids) { return b.simulate(ids)?.damage || 0; }

// Value of status cards beyond damage, from a human's perspective.
function statusValue(b, infos) {
  const e = b.enemy(), lead = b.lead();
  let v = 0;
  const intentDmg = b.intent?.damage ? b.intent.damage[1] : 0;
  for (const i of infos) {
    if (!i.status) continue;
    const eff = i.move.effect;
    const bossish = e.isBoss || b.kind === 'elite';
    if (['SLEEP', 'PARALYZE', 'TOXIC', 'WILL_O_WISP', 'POISON', 'LEECH_SEED', 'YAWN', 'CONFUSE'].includes(eff) && !e.status) v += bossish ? 0.35 : 0.15;
    else if (eff.startsWith('ATTACK_DOWN') && intentDmg > lead.hp * 0.25) v += 0.12;
    else if (['ATTACK_UP_2', 'SPECIAL_ATTACK_UP_2', 'DRAGON_DANCE', 'CALM_MIND', 'BULK_UP', 'GROWTH', 'ATTACK_UP', 'FOCUS_ENERGY'].includes(eff) && bossish) v += 0.2;
    else if (['PROTECT', 'REFLECT', 'LIGHT_SCREEN', 'SAFEGUARD'].includes(eff) && intentDmg > lead.hp * 0.4) v += 0.25;
    else if (['RESTORE_HP', 'SOFTBOILED', 'SYNTHESIS', 'MOONLIGHT', 'MORNING_SUN', 'REST'].includes(eff) && i.owner.hp < maxHp(i.owner) * 0.45) v += 0.3;
    else if (eff.includes('DOWN') && bossish) v += 0.06;
    else v += 0.01;
  }
  return v; // fraction of enemy HP equivalent
}

// Decision metrics (tests/metrics_report.mjs): enabled by balance.mjs --metrics.
export const METRICS = { on: false, decisions: [] };

export function chooseHand(b, skill) {
  const cdmg = [];
  const hand = b.deck.hand.filter(c => b.cardInfo(c).playable && !c.faceDown).map(c => c.id).concat(b.deck.hand.filter(c => c.faceDown && b.cardInfo(c).playable).map(c => c.id));
  const e = b.enemy();
  let best = null, bv = -Infinity;
  const cands = subsets(hand.slice(0, 9), b.maxPlay).filter(s => b.canPlay(s).ok);
  for (const s of cands) {
    let v;
    if (skill === 'greedy') v = b.estimate(s) + s.length;
    else {
      const dmg = dryScore(b, s);
      cdmg.push(dmg);
      const infos = b.findCards(s).map(c => b.cardInfo(c));
      const kill = dmg >= e.hp;
      v = Math.min(dmg, e.hp * 1.05) / e.hp + statusValue(b, infos) + (kill ? 0.5 - s.length * 0.02 : 0);
      // keep pairs for later: slight penalty for spending copies when not lethal
      if (!kill) v -= s.length * 0.005;
      // catching: don't kill a wild mon we want
      if (b._wantCatch && kill) v = 0.4 - dmg / e.hp * 0.1;
      if (b._wantCatch && !kill) v = dmg / e.hp + (e.hp - dmg > 0 ? 0.3 : 0) + statusValue(b, infos) * 2;
    }
    if (v > bv) { bv = v; best = s; }
  }
  b._cands = skill === 'greedy' ? null : { sets: cands, dmg: cdmg };
  return { best, value: bv };
}

// ---------------------------------------------------------------- battle turn
function bestBall(run, e, b) {
  const order = ['MASTER_BALL', 'ULTRA_BALL', 'GREAT_BALL', 'NET_BALL', 'DIVE_BALL', 'NEST_BALL', 'TIMER_BALL', 'REPEAT_BALL', 'POKE_BALL', 'PREMIER_BALL', 'LUXURY_BALL', ...APRICORN_BALLS];
  const owned = order.filter(k => run.balls[k] > 0);
  if (!owned.length) return null;
  if (owned[0] === 'MASTER_BALL' && !e.legendary) owned.shift();
  // (KURT's APRICORN BALLS: the best odds for this foe, the order above breaking ties)
  if (b && owned.some(k => APRICORN_BALLS.includes(k))) return owned.reduce((best, k) => (ballBonus(k, e, b) > ballBonus(best, e, b) + 1e-9 ? k : best), owned[0]);
  return owned[0] || null;
}

function monValue(m) { return bst(m.species) + m.level * 6; }

function wantCatch(b, run) {
  if (b.kind !== 'wild' || !run.totalBalls() || !b.canCatch()) return false;
  const e = b.enemy();
  if (run.nuzlocke) return run.party.length < 6 || bst(e.species) > Math.min(...run.party.map(m => bst(m.species))) + 20; // the act's only catch
  if (run.party.length < 6) return run.party.length < 4 || bst(e.species) > Math.min(...run.party.map(m => bst(m.species))) + 20 || e.legendary;
  return e.legendary || bst(e.species) > Math.min(...run.party.map(m => bst(m.species))) + 60;
}

// Offensive value of a POKéMON's deck against the current foe (average chips per card, status = 0).
export function matchup(b, m) {
  let tot = 0, n = 0;
  for (const mv of m.moves) {
    const c = mv.copies || 1;
    const info = b.cardInfo({ id: -1, uid: m.uid, move: mv.move });
    tot += c * (info.status ? 0 : b.cardValue(info)); n += c;
  }
  return n ? tot / n * Math.min(1, n / 5) : 0;
}

// Switch when another POKéMON's deck is clearly better here (costs a discard), or when the lead can't act.
function considerSwitch(b, run, skill) {
  if (b.freeSwitches <= 0 && b.discardsLeft <= 0) return false;
  if (b._switchedTurn === b.turn) return false;
  const lead = b.lead(), e = b.enemy();
  const stuck = !b.deck.hand.some(c => b.cardInfo(c).playable);
  const alts = run.party.filter(m => !isFainted(m) && m.uid !== lead.uid && !['SLP', 'FRZ'].includes(m.status));
  if (!alts.length) return false;
  const hpOk = m => m.hp / maxHp(m) > (skill === 'smart' ? 0.35 : 0.5);
  const score = m => matchup(b, m) * (0.5 + 0.5 * m.hp / maxHp(m));
  const best = alts.filter(hpOk).sort((x, y) => score(y) - score(x))[0];
  if (!best) return false;
  const mine = score(lead);
  const ratio = skill === 'smart' ? 1.6 : 2.5;
  if (stuck || (score(best) > mine * ratio && e.hp > e.maxHp * 0.25)) { b._switchedTurn = b.turn; b.switchLead(best.uid); return true; }
  return false;
}

export function botTurn(b, run, skill) {
  if (!b.result && b.lead() && considerSwitch(b, run, skill) && b.result) return [];
  const lead = b.lead();
  const e = b.enemy();
  if (skill === 'smart') {
    const intentMax = b.intent?.damage ? b.intent.damage[1] : 0;
    const enemyFirst = b.intent?.first;
    // Heal the lead when the next hit would KO it (or it's very low) and we can't kill first.
    const canKillFirst = !enemyFirst && (chooseHand(b, 'greedy').value >= e.hp);
    if ((lead.hp <= intentMax || lead.hp < maxHp(lead) * 0.25) && !canKillFirst) {
      const pot = run.consumables.find(k => (CONSUMABLES[k]?.heal || CONSUMABLES[k]?.healFrac) && !CONSUMABLES[k]?.berry) || run.consumables.find(k => CONSUMABLES[k]?.heal || CONSUMABLES[k]?.healFrac);
      if (pot && (CONSUMABLES[pot].heal || 0) + lead.hp > intentMax) { b.useItem(pot, lead.uid); }
      else if (b.discardsLeft > 0 || b.freeSwitches > 0) {
        // switch to whoever takes the least damage (as a fraction of HP), if clearly better
        const opts = run.party.filter(m => !isFainted(m) && m.uid !== lead.uid).map(m => ({ m, d: b.intent?.move && intentMax ? b.enemyDamage(b.intent.move, e, m, 1, false, true) / m.hp : 0 }));
        opts.sort((x, y) => x.d - y.d);
        if (opts[0] && opts[0].d < 0.5 && opts[0].d < (intentMax / lead.hp) * 0.6) b.switchLead(opts[0].m.uid);
      }
    }
    // Use battle items on bosses early.
    if ((b.kind === 'boss' || b.kind === 'elite') && b.turn === 1) {
      for (const k of run.consumables.slice()) if (CONSUMABLES[k]?.stage && b.handsPlayed === 0) b.useItem(k, null);
    }
    // Revive fainted mons in long fights.
    const fainted = run.party.find(m => isFainted(m));
    if (fainted && b.kind === 'boss') { const rv = run.consumables.find(k => CONSUMABLES[k]?.revive); if (rv) b.useItem(rv, fainted.uid); }
    b._wantCatch = wantCatch(b, run);
    if (b._wantCatch) {
      const ball = bestBall(run, e, b);
      const frac = e.hp / e.maxHp;
      // (FARAWAY ISLAND's MEW, cfg.catchMult: easy to catch, and it won't stay long)
      if (ball && (frac < 0.45 || (e.status && frac < 0.7) || (D.species[e.species].catchRate * (b.cfg.catchMult || 1) >= 180 && frac < (b.cfg.catchMult ? 1.01 : 0.8)))) return b.throwBall(ball);
    }
  } else {
    if (lead.hp < maxHp(lead) * 0.3) { const pot = run.consumables.find(k => CONSUMABLES[k]?.heal || CONSUMABLES[k]?.healFrac); if (pot) b.useItem(pot, lead.uid); }
    if (b.kind === 'wild' && b.canCatch() && run.party.length < (run.actIndex >= 1 ? 6 : 4) && e.hp < e.maxHp * 0.7 && run.totalBalls() > 0 && !e.legendary) return b.throwBall(Object.keys(run.balls).find(k => run.balls[k] > 0));
  }
  if (b.result) return [];
  const { best, value } = chooseHand(b, skill);
  if (!best) {
    if (b.discardsLeft > 0 && b.deck.hand.length) return b.discard(b.deck.hand.slice(0, 5).map(c => c.id));
    return b.pass ? b.pass() : [];
  }
  // Dig with discards when the expected gain of redrawing is worth a discard (see planDiscard).
  if (b._discTurn !== b.turn) { b._discTurn = b.turn; b._discN = 0; }
  if (skill === 'smart' && BOT_OPTS.oldDig) {
    // v0.0.4 bot (balance.mjs --olddig): dig only when the best hand is under 25% of the foe's HP
    if (b.discardsLeft > 1 && !b._wantCatch && dryScore(b, best) / e.hp < 0.25 && b.deck.draw.length + b.deck.discard.length >= 3) {
      const keep = new Set(best);
      const toss = b.deck.hand.map(c => b.cardInfo(c)).filter(i => !keep.has(i.id) && (i.status || (i.rawPower ?? i.chipsPreview) < 60 || !i.playable)).slice(0, 5).map(i => i.id);
      if (toss.length >= 2) { b.discard(toss); return botTurn(b, run, skill); }
    }
  } else if (skill === 'smart' && !BOT_OPTS.noDig && !b._wantCatch && b._discN++ < 6) {
    const toss = planDiscard(b, best);
    if (toss) { b.discard(toss); return botTurn(b, run, skill); }
  } else if (skill === 'greedy' && value < e.hp * 0.25 && b.discardsLeft > 0 && b.turn > 0 && b.rng.chance(0.5)) {
    const keep = new Set(best);
    const toss = b.deck.hand.filter(c => !keep.has(c.id)).slice(0, 5).map(c => c.id);
    if (toss.length) { b.discard(toss); return botTurn(b, run, skill); }
  }
  if (METRICS.on && skill === 'smart' && !b._wantCatch && b._cands) return playMeasured(b, run, best);
  return b.play(best);
}

// ---------------------------------------------------------------- discards
// Best hand damage (no item bonuses) a set of cards can make: same combo code as the game, cheap card values.
function evalCards(cards, maxPlay, opts) {
  const atk = cards.filter(c => !c.status && c.value > 0);
  if (!atk.length) return 0;
  const val = (sel) => { const r = detectCombo(sel, opts); return r.scoring.reduce((a, i) => a + sel[i].value, 0) * (1 + comboBonus(r.key, opts.levels[r.key] || 1) / 100); };
  if (atk.length <= maxPlay) return val(atk);
  let best = 0;
  const n = atk.length;
  for (let mask = 1; mask < (1 << n); mask++) {
    let k = 0; for (let i = 0; i < n; i++) if (mask & (1 << i)) k++;
    if (k !== maxPlay) continue;
    best = Math.max(best, val(atk.filter((_, i) => mask & (1 << i))));
  }
  return best;
}

export const DISCARD_STATS = { plans: 0, used: 0 };
// rotate (--rotate): a player who spreads EXP: easy fights (wild, or a trainer well below the team's top level) are
// led by the lowest-level healthy POKéMON whose deck is fine here, POKéMON CENTER training goes to the lowest level.
export const BOT_OPTS = { oldDig: false, noDig: false, digThr: +(process.env.DIG_THR || 1), rotate: false };
// Expected-value discard planner (same for every rules variant): for a few sensible "keep" sets, sample redraws
// from the unseen cards and toss when the expected gain in this turn's hand (capped at the foe's HP) beats a
// threshold that grows as discards run out. Free discards (DECK_RULES.freeDiscard) only need a positive gain.
export function planDiscard(b, best) {
  const e = b.enemy();
  const hand = b.deck.hand;
  if (!hand.length || !e) return null;
  const nUnseen = b.deck.draw.length + b.deck.discard.length;
  if (!nUnseen) return null;
  const freeMax = b.freeDiscardOk(1) ? DECK_RULES.freeDiscard : 0;
  if (b.discardsLeft <= 0 && !freeMax) return null;
  const real = dryScore(b, best);
  if (real >= e.hp) return null; // already lethal
  const opts = { coverageN: b.mods.coverage4 ? 3 : 4, levels: b.run.comboLevels };
  const vc = new Map();
  const cardOf = (c) => { if (!vc.has(c.id)) { const i = b.cardInfo(c); vc.set(c.id, { id: c.id, type: i.type, status: i.status, value: i.playable ? b.cardValue(i) : 0, i }); } return vc.get(c.id); };
  const H = hand.map(cardOf);
  const now = evalCards(H, b.maxPlay, opts);
  // convert the foe's HP into evaluator units (the evaluator ignores held-item bonuses)
  const hpE = now > 0 && real > 0 ? e.hp * now / real : e.hp;
  const keepStatus = H.filter(c => c.status && statusValue(b, [c.i]) >= 0.15);
  const keeps = [];
  const add = (arr) => { const set = new Set([...arr, ...keepStatus].map(c => c.id)); const key = [...set].sort().join(','); if (!keeps.some(k => k.key === key)) keeps.push({ key, set }); };
  const atk = H.filter(c => !c.status && c.value > 0).sort((x, y) => y.value - x.value);
  // the cards the best evaluated hand scores with
  if (atk.length) { const sel = atk.slice(0, b.maxPlay); const r = detectCombo(sel, opts); add(r.scoring.map(i => sel[i])); }
  for (const t of new Set(atk.map(c => c.type))) { const g = atk.filter(c => c.type === t); add(g); if (g[0] !== atk[0]) add([...g, atk[0]]); }
  add(atk.slice(0, 1)); add(atk.slice(0, 2)); add(atk.slice(0, 3)); add([]);
  const unseenDraw = b.deck.draw.map(cardOf), unseenDisc = b.deck.discard.map(cardOf);
  const handTarget = b.handSize;
  const rng = b._planRng ||= new RNG('plan');
  const SAMPLES = 12;
  let bestToss = null, bestGain = 0;
  const capNow = Math.min(now, hpE);
  const expected = (toss, samples) => {
    const kept = H.filter(c => !toss.includes(c));
    const need = Math.max(0, handTarget - kept.length) + (DECK_RULES.discardDraw || 0);
    let tot = 0;
    for (let s = 0; s < samples; s++) {
      let pool = unseenDraw.slice(), drawn = [], reshuffled = false;
      for (let j = 0; j < need; j++) {
        if (!pool.length && !reshuffled) { pool = [...unseenDisc, ...toss]; reshuffled = true; } // draw pile ran out
        if (!pool.length) break;
        const idx = Math.floor(rng.next() * pool.length);
        drawn.push(pool[idx]); pool.splice(idx, 1);
      }
      tot += Math.min(evalCards([...kept, ...drawn], b.maxPlay, opts), hpE);
    }
    return (tot / samples - capNow) / hpE;
  };
  const thrOf = (free) => (free ? 0.01 : b.discardsLeft >= 3 ? 0.06 : b.discardsLeft === 2 ? 0.1 : 0.18) * BOT_OPTS.digThr;
  for (const k of keeps) {
    let toss = H.filter(c => !k.set.has(c.id));
    if (!toss.length) continue;
    if (toss.length > 5) toss = toss.sort((x, y) => x.value - y.value).slice(0, 5);
    const free = toss.length <= freeMax;
    if (!free && b.discardsLeft <= 0) continue;
    const m = expected(toss, 12) - thrOf(free);
    if (m > bestGain) { bestGain = m; bestToss = toss; }
  }
  // re-check the winner with fresh samples (picking the best of several noisy estimates over-rates it)
  if (bestToss) { bestGain = expected(bestToss, 32) - thrOf(bestToss.length <= freeMax); if (bestGain <= 0) bestToss = null; }
  DISCARD_STATS.plans++;
  if (!bestToss) return null;
  DISCARD_STATS.used++;
  if (process.env.DIG_LOG) console.log(`  [dig] T${b.turn} left ${b.discardsLeft} hand ${H.map(c => c.i.move.name + (c.status ? '*' : '') + ':' + Math.round(c.value)).join(' ')} | toss ${bestToss.map(c => c.i.move.name).join(',')} | now ${Math.round(real)}/${e.hp} gain+thr ${(bestGain).toFixed(2)}`);
  return bestToss.map(c => c.id);
}

// Plays the chosen hand and records how it compares with the other legal hands.
function playMeasured(b, run, best) {
  const e = b.enemy();
  const { sets, dmg } = b._cands;
  const sorted = dmg.slice().sort((x, y) => x - y);
  const bestD = sorted[sorted.length - 1] || 0, med = sorted[sorted.length >> 1] || 0;
  const atk = b.deck.hand.filter(c => { const i = b.cardInfo(c); return i.playable && !i.status && !c.faceDown; }).map(c => c.id);
  const key = s => s.slice().sort((x, y) => x - y).join(',');
  const iAll = atk.length ? sets.findIndex(s => key(s) === key(atk)) : -1;
  const allD = iAll >= 0 ? dmg[iAll] : null;
  const pred = dryScore(b, best);
  const rel = run.relics, bad = run.badges;
  run.relics = []; run.badges = [];
  let bare = 0;
  try { bare = dryScore(b, best); } finally { run.relics = rel; run.badges = bad; }
  const chosenAtk = best.filter(id => atk.includes(id));
  const rec = { a: run.actIndex, k: b.kind, best: bestD, med, pred, bare, all: allD, nAtk: atk.length, nCh: best.length, chAll: chosenAtk.length === atk.length, hp: e.hp, mhp: e.maxHp, n: sets.length, it: rel.length + bad.length, w: run.world };
  const hpBefore = e.hp;
  const evs = b.play(best);
  const tot = evs.find(x => x.t === 'total');
  rec.act = tot ? tot.damage + (tot.fixed || 0) : null;
  rec.ko = e.hp <= 0 || (b.enemies[b.enemies.indexOf(e)]?.hp ?? 1) <= 0 || (tot && rec.act >= hpBefore);
  METRICS.decisions.push(rec);
  return evs;
}

export function fight(run, cfg, skill, stats) {
  const hpBefore = teamHp(run);
  const b = new Battle(run, cfg);
  // Lead with the healthy POKéMON whose deck fits this fight best (the map screen lets you set the lead).
  const healthy = run.party.filter(m => !isFainted(m) && m.hp / maxHp(m) > 0.4);
  if (healthy.length) {
    let pick = skill === 'smart' ? healthy.sort((x, y) => matchup(b, y) - matchup(b, x))[0] : healthy.sort((x, y) => y.level - x.level)[0];
    if (skill === 'smart' && BOT_OPTS.rotate) {
      const top = Math.max(...run.party.map(m => m.level)), foe = Math.max(...cfg.enemies.map(x => x.level));
      const easy = cfg.kind === 'wild' || (cfg.kind === 'trainer' && !cfg.rival && top - foe >= 3);
      if (easy) {
        const best = matchup(b, pick);
        const ok = healthy.filter(m => m.hp / maxHp(m) > 0.6 && matchup(b, m) >= best * 0.5).sort((x, y) => x.level - y.level);
        if (ok[0] && ok[0].level < pick.level) pick = ok[0];
      }
    }
    run.party.splice(run.party.indexOf(pick), 1); run.party.unshift(pick); b.leadUid = pick.uid;
  }
  b.start();
  b._deck0 = b.deckSize();
  let guard = 0;
  while (!b.result && guard++ < 80) botTurn(b, run, skill);
  if (!b.result) b.end('lose');
  run.logBattle(b);
  // a "?" event gauntlet (the RADIO TOWER): after a win the next fight starts right away, no heal (prizes come last)
  if (b.result.outcome === 'win' && cfg.chainNext) { run.afterBattle(b); handleLevelEvents(run, run.distributeExp(b.result, b.kind), skill); const nx = cfg.chainNext(run); if (nx) return fight(run, nx, skill, stats); }
  if (stats) {
    // (spire runs: the act's region letter too, e.g. "A2H boss:WATTSON")
    const k = `A${run.actIndex + 1}${run.world === 'spire' ? regionOf(run.region).letter : ''} ${cfg.gauntlet !== undefined ? 'E4:' + cfg.trainer.name : cfg.kind === 'boss' ? 'boss:' + (cfg.trainer?.name || cfg.legend) : cfg.rival ? 'rival' : cfg.legendNode ? 'bird' : cfg.kind}`;
    const f = (stats.fights[k] ||= { n: 0, turns: 0, hpLost: 0, losses: 0, lvlGap: 0 });
    f.n++; f.turns += b.turn; f.hpLost += hpBefore - teamHp(run); if (b.result.outcome === 'lose') f.losses++;
    f.lvlGap += Math.max(...run.party.map(m => m.level)) - Math.max(...cfg.enemies.map(x => x.level));
    f.hands = (f.hands || 0) + b.handsPlayed; f.mons = (f.mons || 0) + b.defeated.length;
    f.disc = (f.disc || 0) + (b.discardCount || 0); f.discTurns = (f.discTurns || 0) + (b.discardTurns?.size || 0); f.discCards = (f.discCards || 0) + (b.discardedCards || 0);
    f.sw = (f.sw || 0) + (b.switchCount || 0); f.deck = (f.deck || 0) + (b._deck0 || 0);
    if (cfg.kind === 'boss' && cfg.gauntlet === undefined) (stats.bossHp ||= {})[`A${run.actIndex + 1}`] = [...((stats.bossHp || {})[`A${run.actIndex + 1}`] || []), Math.round(hpBefore * 100)];
  }
  return b;
}

export function teamHp(run) { return run.party.reduce((a, m) => a + m.hp / maxHp(m), 0) / Math.max(1, run.party.length); }

// ---------------------------------------------------------------- between battles
function moveScore(mon, moveKey) {
  const mv = D.moves[moveKey];
  if (!mv) return 0;
  if (mv.power === 0) {
    const good = ['SWORDS_DANCE', 'THUNDER_WAVE', 'SLEEP_POWDER', 'SPORE', 'HYPNOSIS', 'TOXIC', 'RECOVER', 'SOFT_BOILED', 'CALM_MIND', 'BULK_UP', 'DRAGON_DANCE', 'STUN_SPORE', 'WILL_O_WISP', 'LEECH_SEED', 'GROWTH', 'SING', 'PROTECT'];
    return good.includes(moveKey) ? 45 : 8;
  }
  const st = stats(mon);
  const special = ['FIRE', 'WATER', 'GRASS', 'ELECTRIC', 'PSYCHIC', 'ICE', 'DRAGON', 'DARK'].includes(mv.type);
  const s = special ? st.spa : st.atk;
  const stab = typesOf(mon).includes(mv.type) ? 1.5 : 1;
  return (mv.power + s) * stab * Math.min(1, (mv.accuracy || 100) / 100) * (['RECHARGE', 'SOLAR_BEAM', 'RAZOR_WIND', 'SKULL_BASH', 'SKY_ATTACK', 'EXPLOSION'].includes(mv.effect) ? 0.7 : 1);
}

export function learnSmart(mon, move) {
  if (knowsMove(mon, move)) return false;
  const v = moveScore(mon, move);
  if (mon.moves.length < 4) return teachMove(mon, move);
  const worst = mon.moves.map((m, i) => [moveScore(mon, m.move), i]).sort((a, b) => a[0] - b[0])[0];
  if (v > worst[0] * 1.1) { teachMove(mon, move, worst[1], replacedCopies(mon.moves[worst[1]], move)); return true; }
  return false;
}

export function handleLevelEvents(run, list, skill) {
  for (const { mon, events } of list) for (const ev of events) {
    if (ev.type === 'learn') skill === 'smart' ? learnSmart(mon, ev.move) : (mon.moves.length < 4 ? teachMove(mon, ev.move) : (D.moves[ev.move].power > Math.min(...mon.moves.map(m => D.moves[m.move].power || 0)) + 10 && teachMove(mon, ev.move, mon.moves.map(m => D.moves[m.move].power || 0).indexOf(Math.min(...mon.moves.map(m => D.moves[m.move].power || 0))))));
    if (ev.type === 'evolve' && mon.species !== ev.into) { const from = mon.species; const l = evolve(mon, ev.into); for (const m of l) learnSmart(mon, m); if (from === 'NINCADA' && ev.into === 'NINJASK') run.shedinjaFrom(mon); }
  }
}

// Human-ish relic tier list (higher = better), modulated by party synergy.
export function relicScore(run, key) {
  const r = RELICS[key];
  if (!r) return 0;
  const types = new Map();
  for (const m of run.party) for (const mv of m.moves) { const t = D.moves[mv.move]?.type; if (D.moves[mv.move]?.power) types.set(t, (types.get(t) || 0) + mv.copies); }
  let s = { common: 30, uncommon: 50, rare: 70 }[r.rarity];
  const tier = { CHOICE_BAND: 70, SOUL_DEW: 55, DRAGON_SCALE: 45, EON_TICKET: 65, METEORITE: 65, FAME_CHECKER: 55, BICYCLE: 65, SCOPE_LENS: 60, EXP_SHARE: 55, LEFTOVERS: 55, SHELL_BELL: 50, FOCUS_BAND: 45, RUBY: 65, SAPPHIRE: 65, POWDER_JAR: 50, SHOAL_SHELL: 50, UP_GRADE: 45, TEACHY_TV: 45, MACHO_BRACE: 55, SOOTHE_BELL: 45, EVERSTONE: 40, OLD_AMBER: 30, LUCKY_EGG: 40, AMULET_COIN: 45, COIN_CASE: 40, SMOKE_BALL: 20, CLEANSE_TAG: 35, TOWN_MAP: 35, TM_CASE: 35 };
  if (tier[key]) s = tier[key];
  if (r.boostType) s = 25 + (types.get(r.boostType) || 0) * 9;
  if (key === 'SILK_SCARF') s = 15 + (types.get('NORMAL') || 0) * 3;
  if (key === 'EVERSTONE') s = run.party.some(m => (D.species[m.species].evolutions || []).length) ? 60 : 0;
  if (key === 'SEA_INCENSE') s = 20 + (types.get('WATER') || 0) * 7;
  if (key === 'SECRET_KEY' || key === 'SOOT_SACK') s = 20 + (types.get('FIRE') || 0) * 8;
  if (key === 'LIGHT_BALL') s = run.party.some(m => m.species === 'PIKACHU') ? 70 : 0;
  if (key === 'THICK_CLUB') s = run.party.some(m => ['CUBONE', 'MAROWAK'].includes(m.species)) ? 80 : 0;
  if (key === 'LUCKY_PUNCH' || key === 'STICK') s = 30;
  return s;
}

// Uses item k outside battle the bot's way (doesn't touch the bag). Returns true if it was used.
// any: also items the bot normally saves for battle (potions, revives), when the bag is full and k must go.
function useItemNow(run, k, skill, any = false) {
  const c = CONSUMABLES[k];
  if (!c) return false;
  if (c.combo || c.sell) return run.applyConsumableToMon(k, null);
  if (c.levels) { const m = [...run.party].sort((a, b) => b.level - a.level)[0]; if (!run.applyConsumableToMon(k, m)) return false; handleLevelEvents(run, [run.pendingLevelEvents], skill); run.pendingLevelEvents = null; return true; }
  if (c.addCopy) {
    const m = run.party[0];
    const best = m.moves.map((x, i) => [moveScore(m, x.move), i]).sort((a, b) => b[0] - a[0])[0];
    m.moves[best[1]].copies += c.addCopy; return true;
  }
  if (c.evo) { const m = run.party.find(m => run.applyConsumableToMon(k, m)); if (!m) return false; evolve(m, run.pendingEvolution.into); run.pendingEvolution = null; return true; }
  if (c.revive && (skill === 'smart' || any)) { const f = run.party.find(isFainted); return !!f && run.applyConsumableToMon(k, f); }
  if (any && run.autoUse(k)) { run.pendingLevelEvents = null; run.pendingEvolution = null; return true; }
  return false;
}

function usePostItems(run, rng, skill) {
  for (const k of run.consumables.slice()) if (useItemNow(run, k, skill)) run.useConsumable(k);
}

// A found item into the bag; when it's full, run.gainItem's policy (use the new item if it's an any-time
// item, else use/sell the least valuable bag item, or leave the new one if it's the least valuable).
// BAGPOL=old: the pre-v0.0.6 behaviour (a full bag drops the item), to compare balance numbers with old runs.
export function gainBotItem(run, key, skill) {
  if (process.env.BAGPOL === 'old') return run.addConsumable(key) ? 'stored' : 'left';
  return run.gainItem(key, { use: k => useItemNow(run, k, skill, true) });
}

function addMon(run, mon, skill) {
  if (run.addToParty(mon)) return true;
  if (skill !== 'smart') return false;
  const worst = [...run.party].sort((a, b) => monValue(a) - monValue(b))[0];
  if (monValue(mon) > monValue(worst) + 40 && worst !== run.party[0]) { run.party.splice(run.party.indexOf(worst), 1, mon); return true; }
  return false;
}

// The legendary bird's one-time catch: smart takes it when there's room or it beats the weakest member.
export function decideLegend(run, mon, skill) {
  if (!mon) return false;
  const room = run.party.length < 6;
  const take = room || (skill === 'smart' && monValue(mon) > Math.min(...run.party.slice(1).map(monValue)) + 40);
  run.takeLegend(mon, take);
  if (!take) return false;
  return addMon(run, mon, skill);
}

export function postBattle(run, b, rng, skill, metrics) {
  const r = run.afterBattle(b);
  handleLevelEvents(run, run.distributeExp(b.result, b.kind), skill);
  if (r.newMon) addMon(run, r.newMon, skill);
  const cfg = b.cfg || {};
  if (cfg.rewardRelic && !run.hasRelic(cfg.rewardRelic)) { run.addRelic(cfg.rewardRelic); if (metrics) metrics.relicPicks.push(cfg.rewardRelic); }
  if ((cfg.catchOffer || cfg.catchOffers) && b.result.outcome === 'win') { const caught = decideLegend(run, (run.legendCatches ? run.legendCatches(cfg) : [run.legendCatch(cfg)].filter(Boolean)).sort((x, y) => monValue(y) - monValue(x))[0] || null, skill); if (metrics) metrics.legendCatches = (metrics.legendCatches || 0) + (caught ? 1 : 0); }
  if (metrics && r.released?.length) metrics.released = (metrics.released || 0) + r.released.length;
  const kind = b.kind;
  const moveRewardChance = kind === 'wild' ? 0.35 : 1;
  if (rng.chance(moveRewardChance)) {
    const choices = run.moveRewardChoices(rng);
    if (choices.length) {
      if (skill === 'smart') {
        const scored = choices.map(c => { const mon = run.party.find(m => m.uid === c.uid); const worst = Math.min(...mon.moves.map(m => moveScore(mon, m.move))); return { c, mon, gain: moveScore(mon, c.move) - (mon.moves.length < 4 ? 0 : worst) }; }).sort((a, b) => b.gain - a.gain);
        if (scored[0].gain > 0) learnSmart(scored[0].mon, scored[0].c.move);
      } else {
        const c = choices.sort((x, y) => (D.moves[y.move].power || 0) - (D.moves[x.move].power || 0))[0];
        const mon = run.party.find(m => m.uid === c.uid);
        const w = mon.moves.map((m, i) => [D.moves[m.move]?.power || 0, i]).sort((a, b) => a[0] - b[0])[0];
        if (mon.moves.length < 4) teachMove(mon, c.move); else if ((D.moves[c.move].power || 0) > w[0]) teachMove(mon, c.move, w[1]);
      }
    }
  }
  const won = b.result.outcome === 'win' || b.result.outcome === 'caught';
  if (!cfg.rewardRelic && ((cfg.rewardRelicW && won) || cfg.rival || ((kind === 'elite' || kind === 'boss') && rng.chance(TUNING.relicOdds[kind] ?? 0)))) {
    const w = cfg.rewardRelicW || (kind === 'boss' ? { common: 0, uncommon: 55, rare: 45 } : cfg.rival ? { common: 10, uncommon: 55, rare: 35 } : { common: 45, uncommon: 40, rare: 15 });
    const choices = run.relicChoices(rng, 3, w);
    if (choices.length) {
      const pick = skill === 'smart' ? choices.sort((a, b) => relicScore(run, b) - relicScore(run, a))[0] : choices[0];
      if (false) {
        const worst = [...run.relics].sort((a, b) => relicScore(run, a.key) - relicScore(run, b.key))[0];
        if (relicScore(run, pick) > relicScore(run, worst.key) + 10) { run.removeRelic(worst.key); run.addMoney(500); }
      }
      if (run.addRelic(pick) && metrics) metrics.relicPicks.push(pick);
    }
  }
  // "?" event battle prizes
  if (won) for (const k of cfg.rewardItems || []) gainBotItem(run, k, skill);
  if (won && cfg.rewardMons?.length) addMon(run, [...cfg.rewardMons].sort((a, c) => monValue(c) - monValue(a))[0], skill);
  const dropChance = cfg.rival ? 1 : { wild: 0.3, trainer: 0.45, elite: 0.8, boss: 1 }[kind] ?? 0.3;
  if (rng.chance(dropChance)) gainBotItem(run, run.randomConsumable(rng), skill);
  if (cfg.moneyMult && r.moneyFinal) run.addMoney(Math.floor(r.moneyFinal * (cfg.moneyMult - 1)));
  if (kind === 'boss') gainBotItem(run, rng.pick(['RARE_CANDY', 'PP_UP', 'HP_UP', 'PROTEIN', 'IRON', 'CALCIUM', 'ZINC']), skill);
  usePostItems(run, rng, skill);
  if (skill === 'smart') {
    // strongest healthy mon leads
    const lead = [...run.party].filter(m => !isFainted(m)).sort((a, b) => (b.level * 3 + b.hp / maxHp(b) * 20) - (a.level * 3 + a.hp / maxHp(a) * 20))[0];
    if (lead && run.party[0] !== lead) { run.party.splice(run.party.indexOf(lead), 1); run.party.unshift(lead); }
  }
}

// Smart bot: fight the optional legendary only when healthy and strong enough (its level is the floor's
// level + TUNING.bird.lvl; the bot wants its top two POKéMON near that).
function legendPref(run, hp, fainted) {
  if (fainted || hp < 0.8) return 0.1;
  const lv = run.party.map(m => m.level).sort((a, c) => c - a);
  const target = run.levelFor(Math.max(0, run.floor + 1)) + TUNING.bird.lvl;
  const top2 = (lv[0] + (lv[1] ?? lv[0])) / 2;
  return top2 >= target - 4 ? 9 : top2 >= target - 7 ? 4 : 0.3;
}

export function chooseNode(run, rng, skill) {
  const next = reachable(run.map, run.nodeId);
  const hp = teamHp(run);
  const fainted = run.party.filter(isFainted).length;
  const pref = skill === 'smart'
    ? { center: hp < 0.6 || fainted ? 12 : hp < 0.8 ? 3 : 0.5, trainer: 5, elite: hp > 0.75 && !fainted ? 7 : 0.2, wild: run.party.length < 6 ? 5 : 3, event: 3.5, mart: run.money > 2500 ? 5 : 1, treasure: 8, boss: 10, rival: 6, legend: legendPref(run, hp, fainted) }
    : { center: hp < 0.55 ? 10 : 1, trainer: 4, elite: hp > 0.7 ? 3 : 0.5, wild: run.party.length < 6 ? 4 : 2, event: 2, mart: run.money > 3000 ? 3 : 1, treasure: 5, boss: 10, rival: 4, legend: hp > 0.8 ? 3 : 0.3 };
  // smart: look one step ahead
  const score = id => {
    const n = run.map.nodes[id];
    let s = pref[n.type] || 1;
    if (skill === 'smart') s += 0.3 * Math.max(0, ...n.next.map(x => pref[run.map.nodes[x]?.type] || 0));
    return s + rng.next();
  };
  return next.sort((a, b) => score(b) - score(a))[0];
}

export function doShop(run, rng, skill) {
  const shop = generateShop(run, rng);
  if (skill !== 'smart') {
    for (const it of shop.items) if (run.money > it.price + 500 && (it.kind === 'ball' || it.kind === 'relic' || CONSUMABLES[it.key]?.heal)) buyItem(run, shop, it);
    return;
  }
  const buy = (it) => { const r = buyItem(run, shop, it); if (r.ok && r.pending?.type === 'teach') { const mon = run.party.filter(m => canLearn(m.species, r.pending.move) && !knowsMove(m, r.pending.move)).sort((a, b) => moveScore(b, r.pending.move) - moveScore(a, r.pending.move))[0]; if (mon) learnSmart(mon, r.pending.move); } return r.ok; };
  // Thin decks with the Move Deleter: drop status cards (THIN=max: also weak attacks, down to 5 cards).
  const del = shop.items.find(i => i.key === 'MOVE_DELETER');
  const thinMax = process.env.THIN === 'max';
  for (const mon of run.party) {
    let guard = 0;
    while (del && run.money >= run.price(del.price) + (thinMax ? 0 : 800) && guard++ < 8) {
      const total = mon.moves.reduce((a, m) => a + (m.copies || 1), 0);
      if (total <= (thinMax ? 5 : 6)) break;
      const keepStatus = ['SLEEP', 'RESTORE_HP', 'SOFTBOILED', 'SYNTHESIS', 'MOONLIGHT', 'MORNING_SUN', 'DRAGON_DANCE', 'CALM_MIND', 'BULK_UP', 'ATTACK_UP_2'];
      let idx = mon.moves.findIndex(m => D.moves[m.move]?.power === 0 && !keepStatus.includes(D.moves[m.move]?.effect));
      if (idx < 0 && thinMax) { const atk = mon.moves.map((m, i) => [i, D.moves[m.move]?.power || 0]).sort((x, y) => x[1] - y[1]); idx = mon.moves.filter(m => D.moves[m.move]?.power).length > 1 ? atk[0][0] : -1; }
      if (idx < 0) break;
      run.money -= run.price(del.price);
      const mv = mon.moves[idx];
      if ((mv.copies || 1) > 1) mv.copies--; else mon.moves.splice(idx, 1);
    }
  }
  // best relic first
  const relics = shop.items.filter(i => i.kind === 'relic' && !i.sold).sort((a, b) => relicScore(run, b.key) - relicScore(run, a.key));
  for (const it of relics) if (relicScore(run, it.key) >= 55 && run.money >= it.price) buy(it);
  // an extra held-item slot once the bag of held items is full
  // balls
  const ballIt = shop.items.find(i => i.key === (run.actIndex >= 2 ? 'ULTRA_BALL' : run.actIndex >= 1 ? 'GREAT_BALL' : 'POKE_BALL'));
  while (ballIt && run.totalBalls() < 4 && run.money >= ballIt.price + 300) buy(ballIt);
  // vitamins for played combos, healing
  for (const it of shop.items.filter(i => i.kind === 'consumable' && !i.sold)) {
    const c = CONSUMABLES[it.key];
    if (run.consumables.length >= run.maxConsumables) break;
    if (c.combo && ['PAIR', 'TWO_PAIR', 'TRIPLE', 'FULL_HOUSE', 'MONO'].includes(c.combo) && run.money >= it.price + 800) buy(it);
    else if (c.heal && run.consumables.filter(k => CONSUMABLES[k]?.heal).length < 1 && run.money >= it.price + 300) buy(it);
    else if (c.revive && run.party.some(isFainted) && run.money >= it.price) buy(it);
    else if (c.evo && run.money >= it.price) buy(it);
  }
  // TMs that are an upgrade
  for (const it of shop.items.filter(i => i.kind === 'tm' && !i.sold)) {
    const gain = Math.max(0, ...run.party.filter(m => canLearn(m.species, it.move) && !knowsMove(m, it.move)).map(m => moveScore(m, it.move) - Math.min(...m.moves.map(x => moveScore(m, x.move)))));
    if (gain > 40 && run.money >= it.price + 1000) buy(it);
  }
  usePostItems(run, rng, skill);
}

// "?" events: the smart bot scores each available choice with its ai() hint (value in "common held item" units
// minus its costs; leave = 0) and takes the best; the greedy bot takes the first one it can afford. Multi-step
// events (result.next) keep going. forcedId: the event is already decided (co-op's shared event).
// Returns { id, label, battle? }.
export function doEvent(run, rng, skill, fightFn, forcedId = null) {
  let ev = forcedId ? eventById(forcedId) : null;
  if (ev) markSeen(run, ev); else ev = pickEvent(run, rng);
  let list = eventChoices(ev, run), label = null;
  for (let step = 0; step < 6 && list; step++) {
    const choice = pickEventChoice(run, list, skill);
    if (!choice) break;
    label = label || choiceLabel(choice, run);
    const { mon, keys } = eventTargets(run, choice);
    if (choice.needsMon && !mon) break;
    const res = choice.run(run, rng, mon, keys) || {};
    run.logEvent({ k: 'event', id: ev.id, choice: choiceLabel(choice, run) });
    applyEventResult(run, res, rng, skill);
    if (res.battle) return { battle: res.battle, id: ev.id, label };
    list = res.next ? res.next.choices : null;
  }
  return { id: ev.id, label };
}

export function pickEventChoice(run, list, skill) {
  const ok = list.filter(c => !c.cond || c.cond(run));
  if (!ok.length) return null;
  if (skill !== 'smart') return ok[0];
  let best = ok[0], bv = -Infinity;
  for (const c of ok) { const v = c.ai ? c.ai(run) : 0; if (v > bv + 1e-9) { bv = v; best = c; } }
  return best;
}

// What the bot gives when a choice asks for a POKéMON or held items.
export function eventTargets(run, c) {
  let mon = null, keys = [];
  if (c.needsMon) {
    const extra = c.monFilter ? c.monFilter(run) : null;
    let cands = run.party.filter(m => (c.needsMon !== 'alive' || !isFainted(m)) && (!extra || extra(m) === true));
    const mode = c.botMon || (c.needsMon === 'alive' ? 'best' : 'worst');
    if (mode === 'worst' && cands.length > 1) cands = cands.filter(m => m !== run.party[0]);
    cands.sort((a, b) => (mode === 'best' ? b.level - a.level : monValue(a) - monValue(b)));
    mon = cands[0] || null;
  }
  if (c.needsRelic) {
    const n = typeof c.needsRelic === 'number' ? c.needsRelic : c.needsRelic.n || 1;
    const filt = typeof c.needsRelic === 'object' && c.needsRelic.filter ? c.needsRelic.filter : null;
    keys = run.relics.map(r => r.key).filter(k => !RELICS[k]?.curse && !RELICS[k]?.legendary && (!filt || filt(k))).sort((a, b) => relicScore(run, a) - relicScore(run, b)).slice(0, n);
  }
  return { mon, keys };
}

// Removes one card the bot can best spare (status cards it doesn't use, then a copy of its weakest attack) from
// the POKéMON with the biggest deck. Returns false when nothing is worth cutting. (Bug fix: the bots used to
// ignore the MOVE DELETER event's result.)
export function botForget(run) {
  const keep = ['SLEEP', 'RESTORE_HP', 'SOFTBOILED', 'SYNTHESIS', 'MOONLIGHT', 'MORNING_SUN', 'DRAGON_DANCE', 'CALM_MIND', 'BULK_UP', 'ATTACK_UP_2'];
  const decks = run.party.map(m => ({ m, n: m.moves.reduce((a, x) => a + (x.copies || 1), 0) })).filter(d => d.n > 5).sort((a, b) => b.n - a.n);
  for (const { m, n } of decks) {
    let idx = m.moves.findIndex(x => D.moves[x.move]?.power === 0 && !keep.includes(D.moves[x.move]?.effect));
    if (idx < 0 && n > 7) {
      const atk = m.moves.map((x, i) => [i, moveScore(m, x.move)]).filter(([i]) => D.moves[m.moves[i].move]?.power).sort((a, b) => a[1] - b[1]);
      if (atk.length > 1 && (m.moves[atk[0][0]].copies || 1) > 1) idx = atk[0][0];
    }
    if (idx < 0) continue;
    const mv = m.moves[idx];
    if ((mv.copies || 1) > 1) mv.copies--; else m.moves.splice(idx, 1);
    return true;
  }
  return false;
}

// Applies an event result the way a player would (picks held items, POKéMON, cards and items).
export function applyEventResult(run, res, rng, skill) {
  if (res.newMon) addMon(run, res.newMon, skill);
  if (res.monChoices?.length) addMon(run, [...res.monChoices].sort((a, b) => monValue(b) - monValue(a))[0], skill);
  if (res.tutor?.length) {
    const scored = res.tutor.map(t => { const mon = run.party.find(m => m.uid === t.uid); return { t, mon, gain: mon ? moveScore(mon, t.move) - (mon.moves.length < 4 ? 0 : Math.min(...mon.moves.map(x => moveScore(mon, x.move)))) : -1e9 }; }).sort((a, b) => b.gain - a.gain);
    const top = skill === 'smart' ? scored[0] : scored.find(x => x.t === res.tutor[0]);
    if (top?.mon && learnSmart(top.mon, top.t.move) && res.tutorCopy) { const sl = top.mon.moves.find(x => x.move === top.t.move); if (sl) sl.copies += res.tutorCopy; }
  }
  for (let i = 0; i < (res.deleteCards || 0); i++) if (!botForget(run)) break;
  if (res.addCopy) {
    const done = new Set();
    for (let i = 0; i < res.addCopy; i++) {
      const opts = [];
      for (const m of run.party) for (const x of m.moves) if (!done.has(x)) opts.push({ x, v: moveScore(m, x.move) * (m === run.party[0] ? 1.3 : 1) + m.level });
      const b = opts.sort((a, c) => c.v - a.v)[0];
      if (!b) break;
      b.x.copies = (b.x.copies || 1) + 1; done.add(b.x);
    }
  }
  for (let i = 0; i < (res.upgrade || 0); i++) {
    const cands = run.party.map(m => ({ m, b: bestUpgrade(m, powerCap(run)) })).filter(c => c.b).sort((a, c) => (c.b.gain + c.m.level) - (a.b.gain + a.m.level));
    if (!cands.length) break;
    upgradeMove(cands[0].m, cands[0].b.index, powerCap(run));
  }
  if (res.relicChoices?.length) {
    const pick = skill === 'smart' ? [...res.relicChoices].sort((a, b) => relicScore(run, b) - relicScore(run, a))[0] : res.relicChoices[0];
    run.addRelic(pick);
  }
  if (res.itemChoices?.keys?.length) {
    const pref = ['HP_UP', 'PROTEIN', 'IRON', 'CALCIUM', 'RED_SHARD', 'BLUE_SHARD'];
    const keys = [...res.itemChoices.keys].sort((a, b) => (pref.indexOf(a) + 1 || 99) - (pref.indexOf(b) + 1 || 99));
    for (const k of keys.slice(0, res.itemChoices.picks || 1)) {
      if (res.itemChoices.use && CONSUMABLES[k]?.combo) run.applyConsumableToMon(k, null);
      else gainBotItem(run, k, skill);
    }
  }
  for (const k of res.overflow || []) gainBotItem(run, k, skill);
  if (res.levelEvents?.length) handleLevelEvents(run, res.levelEvents, skill);
  if (run.pendingLevelEvents) { handleLevelEvents(run, [run.pendingLevelEvents], skill); run.pendingLevelEvents = null; }
}

export function doCenter(run, skill) {
  // CLEANSE curse held items first (it doesn't use up the Center)
  for (const k of run.curses ? run.curses() : []) if (run.money >= run.cleanseCost() + (skill === 'smart' ? 200 : 0)) run.cleanse(k);
  const hp = teamHp(run);
  if (hp < (skill === 'smart' ? 0.85 : 0.8) || run.party.some(isFainted)) run.centerHeal();
  else {
    const m = skill === 'smart' ? [...run.party].sort((a, b) => BOT_OPTS.rotate ? a.level - b.level : b.level - a.level)[0] : run.party[0];
    import('../web/src/game/pokemon.js').then(() => {});
    return { train: m };
  }
  return {};
}
