// Player bots for balance testing. skill: 'greedy' (naive) | 'smart' (plays like a competent human).
import fs from 'fs';
import { regionOf } from '../web/src/game/regions.js';
import { D, typeEffect, bst, isSpecialMove } from '../web/src/game/data.js';
import { RNG } from '../web/src/game/rng.js';
import { maxHp, isFainted, teachMove, evolve, stats, typesOf, knowsMove, canLearn, DECK_RULES, replacedCopies, defaultCopies } from '../web/src/game/pokemon.js';
import { CONSUMABLES, RELICS, BALLS, VITAMIN_COMBO, APRICORN_BALLS } from '../web/src/game/items.js';
import { generateShop, buyItem, rerollShop } from '../web/src/game/shop.js';
import { pickEvent, eventById, eventChoices, choiceLabel, upgradeMove, bestUpgrade, powerCap, markSeen } from '../web/src/game/events.js';
import { reachable, rivalFloorOf } from '../web/src/game/map.js';
import { Battle, ballBonus } from '../web/src/game/battle.js';
import { TUNING } from '../web/src/game/run.js';
import { detectCombo, comboBonus } from '../web/src/game/hands.js';
import { stageMult, accStageMult } from '../web/src/game/data.js';
import { FIXED_DAMAGE } from '../web/src/game/effects.js';

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

// Exact score via the real scoring code (Battle.simulate: a JSON snapshot/restore, the expensive part of a decision),
// cached per battle state (previewKey) and card list, so repeated looks at the same hand in a turn are free.
export const SIM_STATS = { n: 0 };
function simDmg(b, ids) {
  const k = b.previewKey();
  if (!b._sc || b._sc.k !== k) b._sc = { k, m: new Map() };
  const key = ids.join(',');
  let v = b._sc.m.get(key);
  if (v === undefined) { v = b.simulate(ids)?.damage || 0; b._sc.m.set(key, v); SIM_STATS.n++; }
  return v;
}
export function dryScore(b, ids) { return simDmg(b, ids); }

// Old flat status values (fractions of the foe's HP): only used by the catching hand choice now.
function statusValueLegacy(b, infos) {
  const e = b.enemy(), lead = b.lead();
  let v = 0;
  const intentDmg = b.intent?.damage ? b.intent.damage[1] : 0;
  for (const i of infos) {
    if (!i.status) continue;
    const eff = i.move.effect;
    const bossish = e.isBoss || b.kind === 'elite';
    if (['SLEEP', 'PARALYZE', 'TOXIC', 'WILL_O_WISP', 'POISON', 'LEECH_SEED', 'YAWN', 'CONFUSE'].includes(eff) && !e.status) v += bossish ? 0.35 : 0.15;
    else if (eff.startsWith('ATTACK_DOWN') && intentDmg > lead.hp * 0.25) v += 0.12;
    else if (['PROTECT', 'REFLECT', 'LIGHT_SCREEN', 'SAFEGUARD'].includes(eff) && intentDmg > lead.hp * 0.4) v += 0.25;
    else if (['RESTORE_HP', 'SOFTBOILED', 'SYNTHESIS', 'MOONLIGHT', 'MORNING_SUN', 'REST'].includes(eff) && i.owner.hp < maxHp(i.owner) * 0.45) v += 0.3;
    else v += 0.01;
  }
  return v;
}

// ---- race model ------------------------------------------------------------------------------------------------
// Everything is valued in HP of our lead (the run's real currency: HP carries over between fights, and a faint costs a
// POKéMON for good under NUZLOCKE). dU = what one more turn of this fight costs us (the foe's expected damage per turn),
// D = our damage per turn, so dealing x damage is worth x / D turns = x / D * dU HP.
const SELF_STAGES = { ATTACK_UP: [['atk', 1]], ATTACK_UP_2: [['atk', 2]], SPECIAL_ATTACK_UP: [['spa', 1]], SPECIAL_ATTACK_UP_2: [['spa', 2]], CALM_MIND: [['spa', 1], ['spd', 1]], BULK_UP: [['atk', 1], ['def', 1]], DRAGON_DANCE: [['atk', 1], ['spe', 1]], DEFENSE_UP: [['def', 1]], DEFENSE_UP_2: [['def', 2]], DEFENSE_CURL: [['def', 1]], SPECIAL_DEFENSE_UP_2: [['spd', 2]], COSMIC_POWER: [['def', 1], ['spd', 1]], SPEED_UP_2: [['spe', 2]] };
const FOE_STAGES = { ATTACK_DOWN: [['atk', -1]], ATTACK_DOWN_2: [['atk', -2]], DEFENSE_DOWN: [['def', -1]], DEFENSE_DOWN_2: [['def', -2]], SPECIAL_DEFENSE_DOWN_2: [['spd', -2]], SPEED_DOWN: [['spe', -1]], SPEED_DOWN_2: [['spe', -2]], ACCURACY_DOWN: [['acc', -1]], TICKLE: [['atk', -1], ['def', -1]] };
const AILMENT = { SLEEP: 'SLP', PARALYZE: 'PAR', TOXIC: 'TOX', POISON: 'PSN', WILL_O_WISP: 'BRN' };
const HEAL_FX = new Set(['RESTORE_HP', 'SOFTBOILED', 'SYNTHESIS', 'MOONLIGHT', 'MORNING_SUN']);
const hitsOf = (m) => (m.effect === 'MULTI_HIT' ? 3 : m.effect === 'DOUBLE_HIT' || m.effect === 'TWINEEDLE' || m.effect === 'TRIPLE_KICK' ? 2 : 1);
const clampStage = (s) => Math.max(-6, Math.min(6, s));

function protectChanceNow(b) {
  const s = b.sides.player;
  if (s.protectTurn === b.turn) return 0;
  return 1 / Math.pow(2, s.protectTurn === b.turn - 1 ? (s.protectChain || 0) : 0);
}

// The lead's deck vs this foe: average attack card value (what a fresh draw is worth) and the physical share.
function deckStats(b) {
  const k = `${b.turn}|${b.leadUid}|${b.enemyIndex}`;
  if (b._dk?.k === k) return b._dk;
  let n = 0, tot = 0, ph = 0;
  for (const c of [...b.deck.draw, ...b.deck.hand, ...b.deck.discard]) { const i = b.cardInfo(c); if (i.status) continue; const v = b.cardValue(i); n++; tot += v; if (i.physical) ph += v; }
  return (b._dk = { k, avg: n ? tot / n : 0, phys: tot > 0 ? ph / tot : 0.5 });
}

// Per-turn facts for the race model (cached on the battle state).
function battleCtx(b) {
  const lead = b.lead(), e = b.enemy();
  const it = b.intent, mv = it?.move;
  const key = `${b.turn}|${b.handsPlayed}|${b.leadUid}|${b.enemyIndex}|${e?.hp}|${lead?.hp}|${e?.status}|${mv?.key}|${it?.damage?.[1]}`;
  if (b._ctx?.key === key) return b._ctx;
  const ps = b.sides.player, es = b.sides.enemy, mhp = maxHp(lead);
  // chance the foe can't act this turn
  let skip = 0;
  if (e.status === 'SLP' && e.sleepTurns > 0) skip = 1;
  else if (e.status === 'FRZ') skip = 0.8;
  else { if (e.status === 'PAR') skip = 0.25; if (es.confused > 1) skip += (1 - skip) * (e.isBoss || e.isElite ? 0.33 : 0.5); }
  let dLo = 0, dHi = 0, acc = 1, isAtk = false;
  if (it?.damage && mv) { isAtk = true; const h = hitsOf(mv); dLo = it.damage[0] * h; dHi = it.damage[1] * h; acc = Math.min(1, (mv.accuracy || 100) / 100) * (1 - skip); }
  const dNow = isAtk ? Math.min(lead.hp, acc * (dLo + dHi) / 2) : 0;
  // KO chance: the 85-100% roll, and a 1/16 critical hit (x2)
  const pRoll = (lo, hi) => (hi < lead.hp ? 0 : Math.min(1, (hi - lead.hp + 1) / Math.max(1, hi - lo + 1)));
  const pLethal = isAtk ? acc * ((15 / 16) * pRoll(dLo, dHi) + (1 / 16) * pRoll(2 * dLo, 2 * dHi)) : 0;
  // the foe's average damage per turn on the lead, its moves weighted like pickEnemyMove does
  let wS = 0, dS = 0, pS = 0;
  for (const k of e.moves) {
    const m = b.moveData(k);
    if (!m) continue;
    let w, d = 0;
    if (m.power > 0 || FIXED_DAMAGE[m.effect]) {
      w = Math.max(1, m.power || 40) * typeEffect(m.type, b.ptypes(lead)) * (e.types.includes(m.type) ? 1.5 : 1);
      if (e.isBoss) w = w * w / 60;
      d = b.enemyDamage(m, e, lead, 0.925, false, true) * hitsOf(m) * Math.min(1, (m.accuracy || 100) / 100);
      if (!isSpecialMove(m.key, m.type)) pS += w * d;
    } else w = b.statusMoveValue(m, e, lead);
    wS += w; dS += w * d;
  }
  const dFut = (wS > 0 ? dS / wS : 0) * (e.status === 'PAR' ? 0.75 : 1);
  const dU = Math.max(dFut, mhp * 0.06, 1);
  let foeLeft = 0, nFoes = 0;
  for (let i = b.enemyIndex; i < b.enemies.length; i++) { const x = b.enemies[i]; if (x && x.hp > 0) { foeLeft += x.hp; nFoes++; } }
  const alive = b.run.party.filter(m => !isFainted(m)).length;
  // what a faint costs on top of the HP: the run (last POKéMON), the POKéMON (NUZLOCKE), else a revive / tempo
  const F = alive <= 1 ? 6 * mhp + 100 : b.run.nuzlocke ? 2.5 * mhp : 0.6 * mhp;
  const deck = deckStats(b);
  const ctx = {
    key, lead, e, ps, es, mhp, isAtk, dLo, dHi, acc, dNow, pLethal, dFut, dU, foePhys: dS > 0 ? pS / dS : 0.5, foeLeft, nFoes, alive, F,
    physShare: deck.phys, avgCard: deck.avg, foeFaster: !!it?.first, protOk: protectChanceNow(b),
    foeStatus: it && !isAtk && it.kind === 'debuff' ? 0.3 * dU : 0,
  };
  b._ctx = ctx;
  return ctx;
}

// Value (HP units) of one status card in a hand that deals dmg (kill: it KOs the foe; eFirst: the foe moves first).
function statusCardValue(b, ctx, info, dmg, kill, eFirst, D) {
  const m = info.move, eff = m.effect, e = ctx.e, ps = ctx.ps, es = ctx.es, dU = ctx.dU;
  const dealt = Math.min(dmg, e.hp);
  const Tr = Math.min(8, Math.max(0, ctx.foeLeft - dealt) / D); // turns left in the fight after this hand
  const Tc = kill ? 0 : Math.min(8, (e.hp - dealt) / D);       // turns left against this foe
  const now = !eFirst && !kill ? 1 : 0;                           // lands before this turn's foe move
  const acc = m.accuracy && m.target !== 'USER' ? Math.min(1, m.accuracy / 100) : 1;
  const tough = e.isBoss || e.isElite || e.legendary;
  let v = 0;
  if (SELF_STAGES[eff]) {
    for (const [st, n] of SELF_STAGES[eff]) {
      const cur = ps.stages[st] || 0, nx = clampStage(cur + n);
      if (nx === cur) continue;
      const g = 1 - stageMult(cur) / stageMult(nx);
      if (st === 'atk') v += Tr * g * ctx.physShare * dU;
      else if (st === 'spa') v += Tr * g * (1 - ctx.physShare) * dU;
      else if (st === 'def') v += (Tr + now) * g * ctx.foePhys * dU;
      else if (st === 'spd') v += (Tr + now) * g * (1 - ctx.foePhys) * dU;
      else if (st === 'spe' && ctx.foeFaster) v += 0.2 * Math.min(Tr, 4) * dU;
    }
    return v * 0.8;
  }
  if (FOE_STAGES[eff]) {
    if (kill || es.mist) return 0;
    for (const [st, n] of FOE_STAGES[eff]) {
      const cur = es.stages[st] || 0, nx = clampStage(cur + n);
      if (nx === cur) continue;
      if (st === 'atk') v += (Tc + now) * (1 - stageMult(nx) / stageMult(cur)) * ctx.foePhys * dU;
      else if (st === 'def') v += Tc * (1 - stageMult(nx) / stageMult(cur)) * ctx.physShare * dU;
      else if (st === 'spd') v += Tc * (1 - stageMult(nx) / stageMult(cur)) * (1 - ctx.physShare) * dU;
      else if (st === 'acc') v += (Tc + now) * (1 - accStageMult(nx) / accStageMult(cur)) * dU;
      else if (st === 'spe' && ctx.foeFaster) v += 0.1 * Math.min(Tc, 4) * dU;
    }
    return v * acc * 0.8;
  }
  const ail = AILMENT[eff];
  if (ail || eff === 'LEECH_SEED' || eff === 'CONFUSE' || eff === 'YAWN') {
    if (kill) return 0;
    const chip = e.maxHp / (tough ? 20 : 10), left = e.hp - dealt, turns = Math.ceil(Tc);
    if (ail) {
      if (b.statusBlock('enemy', ail, m.key, e) !== null) return 0;
      if (ail === 'SLP') v = Math.min(tough ? 1.5 : 2, Tc + now) * dU;
      else if (ail === 'PAR') v = 0.25 * (Tc + now) * dU + (ctx.foeFaster ? 0.1 * Math.min(Tc, 4) * dU : 0);
      else if (ail === 'BRN') v = 0.5 * ctx.foePhys * (Tc + now) * dU + Math.min(left, chip * turns) / D * dU;
      else if (ail === 'PSN') v = Math.min(left, chip * turns) / D * dU;
      else if (ail === 'TOX') { let c = 0; for (let n = 1; n <= turns; n++) c += tough ? e.maxHp * Math.min(2, n) / 24 : e.maxHp * Math.min(15, n) / 16; v = Math.min(left, c) / D * dU; }
    } else if (eff === 'LEECH_SEED') {
      if (es.seeded || e.types.includes('GRASS')) return 0;
      v = Math.min(left, chip * turns) / D * dU + Math.min(turns * ctx.mhp / 8, ctx.mhp - ctx.lead.hp + turns * ctx.dFut) * 0.8;
    } else if (eff === 'CONFUSE') {
      if (es.confused) return 0;
      v = (tough ? 0.33 : 0.5) * Math.min(2, Tc + now) * dU;
    } else if (eff === 'YAWN') {
      if (es.yawn || b.statusBlock('enemy', 'SLP', m.key, e) !== null) return 0;
      v = Math.min(tough ? 1.5 : 2, Math.max(0, Tc - 1)) * dU;
    }
    return v * acc * 0.85;
  }
  if (HEAL_FX.has(eff) || eff === 'REST') {
    const o = info.owner, mh = maxHp(o), h = Math.min(mh - o.hp, eff === 'REST' ? mh : mh * 0.5);
    v = h * 0.9 - (eff === 'REST' ? 2 * dU : 0);
    if (o.uid === ctx.lead.uid && !eFirst && ctx.pLethal > 0 && o.hp + h > ctx.dHi) v += ctx.pLethal * ctx.F;
    return v;
  }
  if (eff === 'REFLECT') return ps.reflect ? 0 : Math.min(5, Tr + now) * 0.5 * ctx.foePhys * dU * 0.8;
  if (eff === 'LIGHT_SCREEN') return ps.lightScreen ? 0 : Math.min(5, Tr + now) * 0.5 * (1 - ctx.foePhys) * dU * 0.8;
  if (eff === 'FOCUS_ENERGY') return ps.focus > 0 ? 0 : 0.19 * (dealt / D + Math.min(1, Tr)) * dU * 0.8;
  if (eff === 'PROTECT' || eff === 'ENDURE') return 0; // (handValue)
  return 0.02 * dU;
}

// Value of playing `set` (cards in play order) for dmg damage this turn.
function handValue(b, ctx, set, dmg, D) {
  const e = ctx.e, infos = set.map(x => x.i);
  const kill = dmg >= e.hp;
  const prot = infos.some(i => i.move.effect === 'PROTECT'), endure = !prot && infos.some(i => i.move.effect === 'ENDURE');
  const pOk = prot || endure ? ctx.protOk : 0;
  const eFirst = b.intent?.move ? b.enemyActsFirst(infos, b.intent.move, pOk >= 0.5) : false;
  const dealt = Math.min(dmg, e.hp);
  // a faster foe that KOs the lead first makes its hand fizzle
  let v = dealt * (1 - (eFirst ? ctx.pLethal : 0)) / D * ctx.dU;
  const blocked = kill && !eFirst ? 1 : prot ? pOk : 0;
  v -= (1 - blocked) * (ctx.dNow + ctx.pLethal * ctx.F + ctx.foeStatus);
  if (endure) v += pOk * ctx.pLethal * ctx.F;
  // a PROTECT kept in hand protects next turn instead (and it can't work two turns running)
  if (prot) v -= 0.65 * ctx.dFut;
  if (endure) v -= 0.15 * ctx.dFut;
  for (const x of set) {
    if (x.i.status) v += statusCardValue(b, ctx, x.i, dmg, kill, eFirst, D);
    else if (x.kick) v += 0.05 * ctx.dU * (ctx.avgCard - x.v) / Math.max(1, ctx.avgCard); // cycling a weak card
    else if (kill && ctx.nFoes > 1) v -= 0.04 * ctx.dU * x.v / Math.max(1, ctx.avgCard); // spent on an overkill
  }
  v -= set.length * 0.002 * ctx.dU;
  return { v, kill, eFirst, blocked };
}

// Decision metrics (tests/metrics_report.mjs): enabled by balance.mjs --metrics.
export const METRICS = { on: false, decisions: [] };

function chooseHandFull(b, skill) {
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
      v = Math.min(dmg, e.hp * 1.05) / e.hp + statusValueLegacy(b, infos) + (kill ? 0.5 - s.length * 0.02 : 0);
      if (!kill) v -= s.length * 0.005;
      // catching: don't kill a wild mon we want
      if (b._wantCatch && kill) v = 0.4 - dmg / e.hp * 0.1;
      if (b._wantCatch && !kill) v = dmg / e.hp + (e.hp - dmg > 0 ? 0.3 : 0) + statusValueLegacy(b, infos) * 2;
    }
    if (v > bv) { bv = v; best = s; }
  }
  b._cands = skill === 'greedy' ? null : { sets: cands, dmg: cdmg };
  return { best, value: bv };
}

// Smart hand choice: a handful of candidate hands instead of every subset. The cheap combo evaluator (card previews,
// same combo code as the game) picks the best attack sets; status cards are tried on top of the best one (played
// first, so their buffs / debuffs land before the attacks); weak non-scoring attack cards ride along to be cycled.
// Only those few candidates are simulated, and each is valued by the race model (handValue).
export function chooseHand(b, skill) {
  if (skill === 'greedy' || b._wantCatch) return chooseHandFull(b, skill);
  const e = b.enemy();
  const H = [];
  for (const c of b.deck.hand) { const i = b.cardInfo(c); if (i.playable) H.push({ c, id: c.id, i, v: i.status ? 0 : b.cardValue(i) }); }
  if (!H.length) { b._cands = null; return { best: null, value: -Infinity }; }
  const ctx = battleCtx(b);
  const atk = H.filter(x => !x.i.status), sts = H.filter(x => x.i.status);
  const opts = { coverageN: b.mods.coverage4 ? 3 : 4, levels: b.run.comboLevels };
  const evalSet = (arr) => {
    if (!arr.length) return { v: 0, sc: [] };
    let best = null;
    const tryOne = (sel) => {
      const objs = sel.map(x => ({ move: x.i.move.key, type: x.i.type, owner: x.i.uid, status: false, value: x.v }));
      const r = detectCombo(objs, opts);
      const v = r.scoring.reduce((a, j) => a + objs[j].value, 0) * (1 + comboBonus(r.key, opts.levels[r.key] || 1) / 100);
      if (!best || v > best.v) best = { v, sc: r.scoring.map(j => sel[j]) };
    };
    if (arr.length <= b.maxPlay) tryOne(arr);
    else for (const s of subsets(arr, b.maxPlay)) if (s.length === b.maxPlay) tryOne(s);
    return best;
  };
  const pool = atk.filter(x => x.v > 0);
  const tops = [], seen = new Set();
  const push = (r) => { if (!r || !r.sc.length) return; const k = r.sc.map(x => x.id).sort((p, q) => p - q).join(','); if (seen.has(k)) return; seen.add(k); tops.push(r); };
  const top = evalSet(pool);
  push(top);
  if (top) for (const x of top.sc) push(evalSet(pool.filter(y => y !== x)));
  tops.sort((p, q) => q.v - p.v);
  tops.length = Math.min(tops.length, 3);
  if (!tops.length) tops.push({ v: 0, sc: [] });
  const mk = (sc, st) => {
    if (sc.length + st.length > b.maxPlay || !(sc.length + st.length)) return null;
    const inSet = new Set([...sc, ...st]), kick = new Set();
    for (const x of atk.filter(y => !inSet.has(y) && y.v < ctx.avgCard * 0.9).sort((p, q) => p.v - q.v)) { if (inSet.size >= b.maxPlay) break; inSet.add(x); kick.add(x); }
    // play order: status cards first, then attacks (hand order)
    const set = H.filter(x => inSet.has(x) && x.i.status).concat(H.filter(x => inSet.has(x) && !x.i.status)).map(x => (kick.has(x) ? { ...x, kick: true } : x));
    return set;
  };
  const cands = [], seenSet = new Set();
  let D = null;
  const evalCand = (set) => {
    if (!set) return null;
    const ids = set.map(x => x.id), key = ids.join(',');
    if (seenSet.has(key)) return null;
    seenSet.add(key);
    if (!b.canPlay(ids).ok) return null;
    const dmg = simDmg(b, ids);
    if (D === null) {
      if (b._dTurn !== b.turn) { b._dTurn = b.turn; b._dEma = b._dEma == null ? dmg : 0.6 * b._dEma + 0.4 * dmg; }
      D = Math.max(1, 0.5 * dmg + 0.5 * (b._dEma ?? dmg));
    }
    const r = handValue(b, ctx, set, dmg, D);
    const c = { set, ids, dmg, ...r };
    cands.push(c);
    return c;
  };
  // status subsets on the best attack set (at most 3 status cards: the most valuable ones first)
  evalCand(mk(tops[0].sc, []));
  const stSorted = sts.length > 3 ? sts.map(x => ({ x, v: statusCardValue(b, ctx, x.i, tops[0].v, false, ctx.foeFaster, Math.max(1, tops[0].v)) + (['PROTECT', 'ENDURE'].includes(x.i.move.effect) ? ctx.dNow : 0) })).sort((p, q) => q.v - p.v).slice(0, 3).map(o => o.x) : sts;
  let bestSt = [], bestStV = -Infinity;
  for (const st of subsets(stSorted, b.maxPlay)) {
    const c = evalCand(mk(tops[0].sc, st));
    if (c && c.v > bestStV) { bestStV = c.v; bestSt = st; }
  }
  const base = cands[0];
  if (base && base.v >= bestStV) bestSt = [];
  for (const t of tops.slice(1)) { evalCand(mk(t.sc, bestSt)); if (bestSt.length) evalCand(mk(t.sc, [])); }
  if (!cands.length) return chooseHandFull(b, skill); // (a boss rule forbids the cheap candidates)
  let best = cands[0];
  for (const c of cands) if (c.v > best.v) best = c;
  b._cands = METRICS.on ? { sets: cands.map(c => c.ids), dmg: cands.map(c => c.dmg) } : null;
  b._choice = best;
  return { best: best.ids, value: best.v, dmg: best.dmg, kill: best.kill, blocked: best.blocked, eFirst: best.eFirst };
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

// Damage the foe's shown move would do to m if it were the lead (max roll, all hits).
function intentDmgOn(b, m) {
  const mv = b.intent?.move, e = b.enemy();
  if (!mv || !b.intent?.damage) return 0;
  return b.enemyDamage(mv, e, m, 1, false, true) * hitsOf(mv);
}

// Switch when another POKéMON's deck is clearly better here (costs a discard), or when the lead can't act.
// It must survive the foe's shown move; after a faint the re-pick is free, so take the best one outright.
function considerSwitch(b, run, skill) {
  if (!b.faintSwitch && b.freeSwitches <= 0 && b.discardsLeft <= 0) return false;
  if (b._switchedTurn === b.turn) return false;
  const lead = b.lead(), e = b.enemy();
  const stuck = !b.deck.hand.some(c => b.cardInfo(c).playable);
  const alts = run.party.filter(m => !isFainted(m) && m.uid !== lead.uid && !['SLP', 'FRZ'].includes(m.status));
  if (!alts.length) return false;
  const smart = skill === 'smart';
  const hpOk = m => m.hp / maxHp(m) > (smart ? 0.35 : 0.5) && (!smart || intentDmgOn(b, m) < m.hp * 0.8);
  const score = m => matchup(b, m) * (0.5 + 0.5 * m.hp / maxHp(m)) * (smart ? 1 - 0.5 * Math.min(1, intentDmgOn(b, m) / Math.max(1, m.hp)) : 1);
  const best = alts.filter(hpOk).sort((x, y) => score(y) - score(x))[0];
  if (!best) return false;
  const mine = score(lead);
  const ratio = smart ? (b.faintSwitch ? 1.05 : 1.6) : 2.5;
  if (stuck || (score(best) > mine * ratio && e.hp > e.maxHp * 0.25)) { b._switchedTurn = b.turn; b.switchLead(best.uid); return true; }
  return false;
}

// The lead would faint to the shown move this turn and the best hand neither KOs the foe first nor PROTECTs:
// heal it out of range, or switch to a POKéMON that takes the hit well.
function defend(b, run) {
  const lead = b.lead(), e = b.enemy();
  if (!lead || !e || b.result) return;
  const ctx = battleCtx(b);
  if (ctx.pLethal <= 0.04 && !(ctx.pLethal > 0.02 && (run.nuzlocke || ctx.alive <= 1))) return;
  const ch = chooseHand(b, 'smart');
  if (ch.best && ch.blocked >= 0.99) return;
  const mhp = ctx.mhp;
  const pots = run.consumables.filter(k => CONSUMABLES[k]?.heal || CONSUMABLES[k]?.healFrac);
  const healOf = k => Math.min(mhp - lead.hp, CONSUMABLES[k].heal || Math.floor(mhp * CONSUMABLES[k].healFrac));
  const precious = run.nuzlocke || ctx.alive <= 1;
  if (ctx.dHi < lead.hp) {
    // only a critical hit KOs: heal out of crit range when it's precious and the potion isn't mostly wasted
    const k = pots.filter(k => healOf(k) >= 2 * ctx.dHi - lead.hp + 1 && healOf(k) >= 0.6 * (CONSUMABLES[k].heal || mhp * CONSUMABLES[k].healFrac)).sort((x, y) => healOf(x) - healOf(y))[0];
    if (k) b.useItem(k, lead.uid);
    return;
  }
  const need = ctx.dHi - lead.hp + 1;
  // the smallest potion that's enough (berries after potions of the same size)
  const ok = pots.filter(k => healOf(k) >= need).sort((x, y) => healOf(x) - healOf(y) || (CONSUMABLES[x].berry ? 1 : 0) - (CONSUMABLES[y].berry ? 1 : 0));
  let sw = null;
  const cost = b._switchedTurn !== b.turn ? b.switchCost() : null;
  if (cost?.ok && (cost.free || precious || ctx.pLethal >= 0.5)) {
    const lm = matchup(b, lead);
    let bs = -Infinity;
    for (const m of run.party) {
      if (isFainted(m) || m.uid === lead.uid || ['SLP', 'FRZ'].includes(m.status)) continue;
      const d = intentDmgOn(b, m);
      if (d >= m.hp * (precious ? 0.9 : 0.6)) continue;
      const mu = matchup(b, m);
      if (!precious && mu < lm * 0.35) continue;
      const s = (mu + 1) * (1 - d / m.hp) * (0.5 + 0.5 * m.hp / maxHp(m));
      if (s > bs) { bs = s; sw = m; }
    }
  }
  if (ok.length && (precious || !sw || ctx.pLethal >= 0.5)) { b.useItem(ok[0], lead.uid); return; }
  if (sw) { b._switchedTurn = b.turn; b.switchLead(sw.uid); return; }
  // a wild fight that would cost the run / a NUZLOCKE POKéMON: run away (sure when we're faster)
  if (precious && b.canFlee() && ctx.pLethal >= 0.25) {
    const ps = b.speedOf('player'), es = b.speedOf('enemy');
    const pFlee = ps >= es ? 1 : ((ps * 128 / Math.max(1, es) + 30 * (b.fleeAttempts + 1)) % 256) / 256;
    if (pFlee >= 0.4 || (pots.length === 0 && pFlee > 0.15)) return 'flee';
  }
  // nothing is enough: the biggest potion still makes the KO less likely
  if (precious && pots.length) { const k = pots.sort((x, y) => healOf(y) - healOf(x))[0]; if (healOf(k) > 0 && lead.hp + healOf(k) > ctx.dLo) b.useItem(k, lead.uid); }
}

export function botTurn(b, run, skill) {
  if (!b.result && b.lead() && considerSwitch(b, run, skill) && b.result) return [];
  const lead = b.lead();
  const e = b.enemy();
  if (skill === 'smart') {
    b._wantCatch = wantCatch(b, run);
    if (defend(b, run) === 'flee') return b.flee();
    if (b.result) return [];
    // Use battle items on bosses / elites / rivals early.
    if ((b.kind === 'boss' || b.kind === 'elite' || b.cfg?.rival) && b.turn === 1) {
      for (const k of run.consumables.slice()) if (CONSUMABLES[k]?.stage && b.handsPlayed === 0) b.useItem(k, null);
    }
    // Revive fainted mons in long fights (not under NUZLOCKE: a fainted POKéMON is gone).
    const fainted = run.party.find(m => isFainted(m) && !m.lost);
    if (fainted && b.kind === 'boss') { const rv = run.consumables.find(k => CONSUMABLES[k]?.revive); if (rv) b.useItem(rv, fainted.uid); }
    if (b._wantCatch) {
      const ball = bestBall(run, e, b);
      const frac = e.hp / e.maxHp;
      // (FARAWAY ISLAND's MEW, cfg.catchMult: easy to catch, and it won't stay long)
      if (ball && (frac < 0.45 || (e.status && frac < 0.7) || b.catchChance(ball) >= 0.5 || (D.species[e.species].catchRate * (b.cfg.catchMult || 1) >= 180 && frac < (b.cfg.catchMult ? 1.01 : 0.8)))) return b.throwBall(ball);
    }
  } else {
    if (lead.hp < maxHp(lead) * 0.3) { const pot = run.consumables.find(k => CONSUMABLES[k]?.heal || CONSUMABLES[k]?.healFrac); if (pot) b.useItem(pot, lead.uid); }
    if (b.kind === 'wild' && b.canCatch() && run.party.length < (run.actIndex >= 1 ? 6 : 4) && e.hp < e.maxHp * 0.7 && run.totalBalls() > 0 && !e.legendary) return b.throwBall(Object.keys(run.balls).find(k => run.balls[k] > 0));
  }
  if (b.result) return [];
  const { best, value } = chooseHand(b, skill);
  const e2 = b.enemy();
  // a wild foe the hand can't hurt (a rare-find SHEDINJA's WONDER GUARD): throw a ball, else run
  if (e2.ability === 'WONDER_GUARD' && b.canFlee() && (!best || dryScore(b, best) <= 0)) {
    const ball = b.canCatch() ? bestBall(run, e2, b) : null;
    return ball ? b.throwBall(ball) : b.flee();
  }
  if (!best) {
    if (b.discardsLeft > 0 && b.deck.hand.length) return b.discard(b.deck.hand.slice(0, 5).map(c => c.id));
    return b.pass ? b.pass() : [];
  }
  // Dig with discards when the expected gain of redrawing is worth a discard (see planDiscard).
  if (b._discTurn !== b.turn) { b._discTurn = b.turn; b._discN = 0; }
  if (skill === 'smart' && BOT_OPTS.oldDig) {
    // v0.0.4 bot (balance.mjs --olddig): dig only when the best hand is under 25% of the foe's HP
    if (b.discardsLeft > 1 && !b._wantCatch && dryScore(b, best) / e2.hp < 0.25 && b.deck.draw.length + b.deck.discard.length >= 3) {
      const keep = new Set(best);
      const toss = b.deck.hand.map(c => b.cardInfo(c)).filter(i => !keep.has(i.id) && (i.status || (i.rawPower ?? i.chipsPreview) < 60 || !i.playable)).slice(0, 5).map(i => i.id);
      if (toss.length >= 2) { b.discard(toss); return botTurn(b, run, skill); }
    }
  } else if (skill === 'smart' && !BOT_OPTS.noDig && !b._wantCatch && b._discN++ < 6) {
    const toss = planDiscard(b, best);
    if (toss) { b.discard(toss); return botTurn(b, run, skill); }
  } else if (skill === 'greedy' && value < e2.hp * 0.25 && b.discardsLeft > 0 && b.turn > 0 && b.rng.chance(0.5)) {
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
  // status cards worth keeping (never cycle a PROTECT, a buff for a long fight, a status the foe doesn't have yet...)
  const ctx = battleCtx(b), Dk = Math.max(1, real, b._dEma || 0);
  const keepStatus = H.filter(c => c.status && (['PROTECT', 'ENDURE'].includes(c.i.move.effect) ? ctx.dFut > ctx.mhp * 0.08 : statusCardValue(b, ctx, c.i, 0, false, ctx.foeFaster, Dk) >= 0.25 * ctx.dU));
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

// FIGHTLOG=file: one record per fight (pathing analysis), written at exit.
const FIGHTLOG = process.env.FIGHTLOG ? [] : null;
if (FIGHTLOG) process.on('exit', () => { fs.writeFileSync(process.env.FIGHTLOG, JSON.stringify(FIGHTLOG)); });
let FIGHTLOG_PR = 0, FIGHTLOG_ST = null;
export function fight(run, cfg, skill, stats) {
  const hpBefore = teamHp(run);
  if (FIGHTLOG) { const st = teamState(run), k = cfg.rival ? 'rival' : cfg.kind; FIGHTLOG_ST = { hp: +st.hp.toFixed(3), pots: st.pots, alive: st.alive, gap: st.top - Math.max(...cfg.enemies.map(x => x.level)) }; FIGHTLOG_PR = +fightRisk(run, k, st.hp, st.top - Math.max(...cfg.enemies.map(x => x.level)), st.alive, st.pots).toFixed(3); }
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
  if (FIGHTLOG) FIGHTLOG.push({ a: run.actIndex, f: run.floor, k: cfg.rival ? 'rival' : cfg.kind, asc: run.ascension, hp0: +hpBefore.toFixed(2), n: run.party.length, lv: Math.max(...run.party.map(m => m.level)), foe: Math.max(...cfg.enemies.map(x => x.level)), ne: cfg.enemies.length, out: b.result.outcome, pr: FIGHTLOG_PR, st: FIGHTLOG_ST, hp1: +teamHp(run).toFixed(2) });
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
function moveScoreOld(mon, moveKey) {
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

// Daniel's card values: attacks by power x STAB x accuracy x the attacking stat they use (relative to the mon's
// average), self-buffs that fit the mon's attacking side and PROTECT close to its best attack, heals and sleep
// a bit less, stat debuffs and other fluff near zero ("buff yourself, never debuff them").
const SETUP_PHYS = new Set(['ATTACK_UP_2', 'DRAGON_DANCE', 'BULK_UP', 'ATTACK_UP', 'BELLY_DRUM']);
const SETUP_SPEC = new Set(['SPECIAL_ATTACK_UP_2', 'CALM_MIND', 'SPECIAL_ATTACK_UP']);
const HEAL_MOVES = new Set(['RESTORE_HP', 'SOFTBOILED', 'SYNTHESIS', 'MOONLIGHT', 'MORNING_SUN', 'WISH']);
const STATUS_FX = new Set(['SLEEP', 'PARALYZE', 'TOXIC', 'WILL_O_WISP', 'LEECH_SEED', 'YAWN']);
const BAD_FX = new Set(['RECHARGE', 'SOLAR_BEAM', 'RAZOR_WIND', 'SKULL_BASH', 'SKY_ATTACK', 'EXPLOSION', 'SELF_DESTRUCT', 'FOCUS_PUNCH']);
function attackScore(mon, mv, st) {
  const special = isSpecialMove(mv.key, mv.type);
  const s = special ? st.spa : st.atk;
  const ratio = Math.max(0.5, Math.min(1.6, s / Math.max(1, (st.atk + st.spa) / 2)));
  const stab = typesOf(mon).includes(mv.type) ? 1.5 : 1;
  let v = Math.max(20, mv.power) * stab * Math.min(1, (mv.accuracy || 100) / 100) * ratio;
  if (BAD_FX.has(mv.effect)) v *= 0.65;
  if (mv.effect === 'SPECIAL_ATTACK_UP_HIT' && special) v *= 1.3; // CHARGE BEAM: a hit that sets up
  if (/^(ATTACK|SPECIAL_ATTACK)_UP_HIT$|^ALL_STATS_UP_HIT$/.test(mv.effect || '') && mv.effect !== 'SPECIAL_ATTACK_UP_HIT') v *= 1.1;
  return v;
}
function bestAttackScore(mon, st, except) {
  let b = 0;
  for (const x of mon.moves) { const mv = D.moves[x.move]; if (mv?.power && x.move !== except) b = Math.max(b, attackScore(mon, mv, st)); }
  return b || 60;
}
export function moveScore(mon, moveKey) {
  if (BOTX.has('oldmoves')) return moveScoreOld(mon, moveKey);
  const mv = D.moves[moveKey];
  if (!mv) return 0;
  const st = stats(mon);
  if (mv.power) return attackScore(mon, mv, st);
  const best = bestAttackScore(mon, st);
  const fx = mv.effect;
  const physical = st.atk >= st.spa;
  // a second card of the same kind adds little
  const has = (pred) => mon.moves.some(x => x.move !== moveKey && D.moves[x.move] && !D.moves[x.move].power && pred(D.moves[x.move].effect));
  if (fx === 'PROTECT') return best * 0.8;
  if (SETUP_PHYS.has(fx) || SETUP_SPEC.has(fx)) {
    const fits = SETUP_PHYS.has(fx) ? physical || fx === 'DRAGON_DANCE' || fx === 'BULK_UP' : !physical || fx === 'CALM_MIND';
    if (fx === 'BELLY_DRUM') return best * 0.3;
    return best * (fits ? 0.8 : 0.25) * (has(e => SETUP_PHYS.has(e) || SETUP_SPEC.has(e)) ? 0.4 : 1);
  }
  if (HEAL_MOVES.has(fx)) return best * 0.5 * (has(e => HEAL_MOVES.has(e)) ? 0.3 : 1);
  if (STATUS_FX.has(fx)) return best * (fx === 'SLEEP' ? 0.4 : 0.3) * Math.min(1, (mv.accuracy || 100) / 100) * (has(e => STATUS_FX.has(e)) ? 0.4 : 1);
  if (fx === 'REFLECT' || fx === 'LIGHT_SCREEN' || fx === 'SUBSTITUTE') return best * 0.2;
  return best * 0.05;
}
// A deck's value per card (copies weigh in); `swap` = [index, newMove] (index -1: added).
function deckAvg(mon, swap) {
  let tot = 0, n = 0;
  const add = (move, c) => { tot += moveScore(mon, move) * c; n += c; };
  mon.moves.forEach((x, i) => { if (swap && swap[0] === i) return; add(x.move, x.copies || 1); });
  if (swap) add(swap[1], swap[0] >= 0 ? replacedCopies(mon.moves[swap[0]], swap[1]) : defaultCopies(swap[1]));
  return { avg: n ? tot / n : 0, n };
}
// Best way to put `move` into mon's deck: { gain (relative), idx (-1 = add) } or null when it doesn't help.
function bestSlotFor(mon, move) {
  if (knowsMove(mon, move)) return null;
  const cur = deckAvg(mon);
  const opts = [];
  if (mon.moves.length < 4) opts.push(-1);
  for (let i = 0; i < mon.moves.length; i++) opts.push(i);
  let best = null;
  for (const i of opts) {
    const nx = deckAvg(mon, [i, move]);
    // thin decks: value per card, but a deck below ~8 cards wants more cards (the hand is 5)
    let g = (nx.avg - cur.avg) / Math.max(1, cur.avg);
    if (i === -1 && cur.n < 8) g += 0.08 * (8 - cur.n) / 8 + (moveScore(mon, move) >= cur.avg * 0.6 ? 0.05 : -0.2);
    if (i >= 0 && nx.n < 6) g -= 0.1;
    if (!best || g > best.gain) best = { gain: g, idx: i };
  }
  return best;
}

export function learnSmart(mon, move, minGain = 0.02) {
  if (knowsMove(mon, move)) return false;
  if (BOTX.has('oldmoves')) {
    const v = moveScore(mon, move);
    if (mon.moves.length < 4) return teachMove(mon, move);
    const worst = mon.moves.map((m, i) => [moveScore(mon, m.move), i]).sort((a, b) => a[0] - b[0])[0];
    if (v > worst[0] * 1.1) { teachMove(mon, move, worst[1], replacedCopies(mon.moves[worst[1]], move)); return true; }
    return false;
  }
  const s = bestSlotFor(mon, move);
  if (!s || s.gain < minGain) return false;
  if (s.idx < 0) return teachMove(mon, move);
  return teachMove(mon, move, s.idx, replacedCopies(mon.moves[s.idx], move));
}

// The MOVE DELETER's pick for mon (index into mon.moves) or -1: a card whose removal raises the deck's value per
// card, while keeping at least 7 cards.
function deletePick(mon) {
  const total = mon.moves.reduce((a, m) => a + (m.copies || 1), 0);
  if (total <= 7) return -1;
  let tot = 0;
  const sc = mon.moves.map(x => { const v = moveScore(mon, x.move); tot += v * (x.copies || 1); return v; });
  const avg = tot / total;
  let idx = -1, worst = Infinity;
  sc.forEach((v, i) => { if (v < worst) { worst = v; idx = i; } });
  // only clearly weak cards (and never the last attack)
  if (idx < 0 || worst > avg * 0.6) return -1;
  if (D.moves[mon.moves[idx].move]?.power && mon.moves.filter(x => D.moves[x.move]?.power).length <= 1 && (mon.moves[idx].copies || 1) <= 1) return -1;
  return idx;
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
  if (r.legendary) s += 40; // (a legendary / mythic item's perk on top of its type boost)
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
  // (co-op legendary node, v0.5.6: either legendary's item, the better one for this run)
  const pairItems = run.legendItemChoices ? run.legendItemChoices(cfg) : [];
  if (pairItems.length) { const k = pairItems.sort((a, c) => relicScore(run, c) - relicScore(run, a))[0]; run.addRelic(k); if (metrics) metrics.relicPicks.push(k); }
  else if (cfg.rewardRelic && !run.hasRelic(cfg.rewardRelic)) { run.addRelic(cfg.rewardRelic); if (metrics) metrics.relicPicks.push(cfg.rewardRelic); }
  if ((cfg.catchOffer || cfg.catchOffers) && b.result.outcome === 'win') { const caught = decideLegend(run, (run.legendCatches ? run.legendCatches(cfg) : [run.legendCatch(cfg)].filter(Boolean)).sort((x, y) => monValue(y) - monValue(x))[0] || null, skill); if (metrics) metrics.legendCatches = (metrics.legendCatches || 0) + (caught ? 1 : 0); }
  if (metrics && r.released?.length) metrics.released = (metrics.released || 0) + r.released.length;
  const kind = b.kind;
  const moveRewardChance = kind === 'wild' ? 0.35 : 1;
  if (rng.chance(moveRewardChance)) {
    const choices = run.moveRewardChoices(rng);
    if (choices.length) {
      if (skill === 'smart') {
        if (BOTX.has('oldmoves')) {
          const scored = choices.map(c => { const mon = run.party.find(m => m.uid === c.uid); const worst = Math.min(...mon.moves.map(m => moveScore(mon, m.move))); return { c, mon, gain: moveScore(mon, c.move) - (mon.moves.length < 4 ? 0 : worst) }; }).sort((a, b) => b.gain - a.gain);
          if (scored[0].gain > 0) learnSmart(scored[0].mon, scored[0].c.move);
        } else {
          // the carry first (Daniel: one POKéMON fed everything); skip rewards that don't raise a deck's value per card
          const top = Math.max(...run.party.map(m => m.level));
          let best = null;
          for (const c of choices) {
            const mon = run.party.find(m => m.uid === c.uid);
            const sl = mon && bestSlotFor(mon, c.move);
            if (!sl) continue;
            const w = mon.level >= top - 1 ? 1 : 0.5;
            if (!best || sl.gain * w > best.v) best = { v: sl.gain * w, mon, c };
          }
          if (best && best.v >= 0.03) learnSmart(best.mon, best.c.move, -1);
        }
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
    let choices = run.relicChoices(rng, 3, w);
    if (cfg.mythic && run.mythicRelicChoices) choices = run.mythicRelicChoices(cfg, choices); // (v0.5.6: the mythic's own item first)
    if (choices.length) {
      const pick = skill === 'smart' ? choices.sort((a, b) => relicScore(run, b) - relicScore(run, a))[0] : choices[0];
      if (run.addRelic(pick) && metrics) metrics.relicPicks.push(pick);
    }
  }
  // "?" event battle prizes
  if (won) for (const k of cfg.rewardItems || []) gainBotItem(run, k, skill);
  if (won && cfg.rewardMons?.length) addMon(run, [...cfg.rewardMons].sort((a, c) => monValue(c) - monValue(a))[0], skill);
  const dropChance = cfg.rival ? 1 : { wild: 0.3, trainer: 0.45, elite: 0.8, boss: 1 }[kind] ?? 0.3;
  if (rng.chance(dropChance)) gainBotItem(run, run.randomConsumable(rng), skill);
  { const am = run.mods(); // field abilities (v0.5.0 abilities), like scenes/reward.js
    if (won && am.pickup && rng.chance(am.pickup)) gainBotItem(run, run.randomConsumable(rng), skill);
    if (won && am.honey && rng.chance(0.2)) gainBotItem(run, run.randomBerry(rng), skill); }
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

// ---- risk-aware pathing (smart): a small lookahead over the map that models each node's chance to lose (by kind,
// the team's HP and its level lead over the node's foes), the HP it costs and the power it brings (EXP levels,
// held items, catches), and prices the forced fights still ahead (rival, boss) at the projected state.
export const BOTX = new Set((process.env.BOTX || '').split(',').filter(Boolean)); // ablation switches
const KIND_RISK = { wild: 0.035, trainer: 0.12, elite: 0.24, rival: 0.3, boss: 0.3, legend: 0.5 };
const KIND_COST = { wild: 0.1, trainer: 0.16, elite: 0.28, rival: 0.3, boss: 0.25, legend: 0.35 };
const KIND_FOE = { wild: 0, trainer: 1, elite: 2, rival: 1, legend: 3 };
const KIND_EXP = { wild: 0.45, trainer: 0.7, elite: 1.0, rival: 1.0, legend: 1.4 };
// Strength-weighted HP (the carry's HP matters most) and the top level of the standing POKéMON.
export function teamState(run) {
  let w = 0, h = 0, top = 0, alive = 0;
  for (const m of run.party) {
    const wt = m.level * m.level;
    w += wt; h += wt * Math.max(0, m.hp) / maxHp(m);
    if (!isFainted(m)) { alive++; top = Math.max(top, m.level); }
  }
  const pots = run.consumables.filter(k => CONSUMABLES[k]?.heal || CONSUMABLES[k]?.healFrac || CONSUMABLES[k]?.revive).length;
  return { hp: w ? h / w : 0, top, alive, pots };
}
// Chance to lose a fight: a logistic fit on ~3600 smart-bot fights at A2/A5/A7/A10 (FIGHTLOG=..., tests/bot.mjs):
// per-kind intercept and level-gap slope (gap = top level - the foes' top level), the strength-weighted HP missing,
// heal items in the bag, a lone POKéMON, A7+ / NUZLOCKE, act 2+ (the bot's team has filled out by then).
const RISK_B = { wild: -4.09, trainer: -3.41, elite: -1.28, rival: -0.9, boss: -0.99, legend: -0.6 };
const RISK_G = { wild: -0.59, trainer: -0.78, elite: -0.47, rival: -0.57, boss: -0.36, legend: -0.5 };
export function fightRisk(run, kind, hp, gap, alive, pots = 0) {
  const z = (RISK_B[kind] ?? -2) + (RISK_G[kind] ?? -0.5) * (Math.max(-4, Math.min(5, gap)) - 1) + 1.81 * (1 - Math.min(1, hp)) - 0.36 * Math.min(3, pots)
    + (alive <= 1 ? 1.02 : 0) + (run.ascension >= 7 ? 0.24 : 0) + (run.nuzlocke ? 0.72 : 0) - (run.ascension >= 5 ? 0.21 : 0) - (run.actIndex > 0 ? 2.12 : 0);
  return 1 / (1 + Math.exp(-z));
}
function foeLevel(run, kind, floor) {
  if (kind === 'boss') return run.bossLevel ? run.bossLevel() : run.levelFor(floor) + 3;
  return run.levelFor(floor) + (KIND_FOE[kind] ?? 1);
}
// Expected path score from node `id` (inclusive) for `depth` more nodes. s: {hp, top, pw (power bonus in levels),
// money, wilds (wild fights done this act), alive}. Returns P(survive) x (1 + power value).
function pathValue(run, id, s, depth) {
  const n = run.map.nodes[id];
  if (!n) return 0;
  let { hp, top, pw, money, alive, firstWild, pots } = s;
  let p = 1;
  const t = n.type;
  const fightKinds = ['wild', 'trainer', 'elite', 'rival', 'boss', 'legend'];
  if (fightKinds.includes(t)) {
    const gap = top + pw - foeLevel(run, t, n.floor);
    p = 1 - fightRisk(run, t, hp, gap, alive, pots);
    const costF = Math.pow(2, -(gap - 1) * 0.35);
    hp = Math.max(0.05, hp - KIND_COST[t] * costF + TUNING.postBattleHeal + (run.mods().postHeal || 0));
    if (hp < 0.35 && pots) { hp += 0.3; pots--; }
    top += (KIND_EXP[t] || 0) * Math.pow(2, -Math.max(-2, gap) / 2.5);
    if (t === 'wild') {
      const canCatch = run.totalBalls() > 0 && (!run.nuzlocke || firstWild) && run.party.length < 6;
      if (canCatch) { pw += run.party.length <= 1 ? 0.5 : run.party.length <= 2 ? 0.3 : 0.1; alive++; }
      firstWild = false; pw += 0.06;
      money += 40;
    }
    if (t === 'trainer') { pw += 0.2; money += 150; }
    if (t === 'elite') { pw += 0.75 + 0.2; money += 300; }
    if (t === 'rival') { pw += 0.9; money += 300; }
    if (t === 'legend') pw += 1.6;
    if (t === 'boss') return p * (1 + 0.15 * pw);
  } else if (t === 'center') {
    if (hp < 0.85 || alive < run.party.length) { hp = 1; alive = run.party.length; }
    else top += 3;
  } else if (t === 'treasure') { pw += 0.35; pots = Math.min(3, pots + 0.4); }
  else if (t === 'event') { pw += 0.35; hp = Math.min(1, hp + 0.06); }
  else if (t === 'mart') { if (money >= 700) { pots = Math.min(3, pots + Math.min(2, Math.floor(money / 900))); pw += money >= 2500 ? 0.4 : 0.1; money = Math.min(money, 300); } }
  const ns = { hp, top, pw, money, alive, firstWild, pots };
  if (depth <= 1 || !n.next.length) {
    // the horizon: the forced fights still ahead at the projected state (the rival floor, the act boss)
    let q = 1;
    const F = run.map.floors;
    const rf = rivalFloorOf(run.act);
    let h2 = hp;
    if (run.act.rival && n.floor < rf) { const g = top + pw + 0.5 * (rf - n.floor) - foeLevel(run, 'rival', rf); q *= 1 - fightRisk(run, 'rival', h2, g, alive, pots); }
    if (n.type !== 'boss') { const g = top + pw + 0.5 * (F - n.floor) - foeLevel(run, 'boss', F); q *= 1 - fightRisk(run, 'boss', 1, g, alive, pots); }
    return p * q * (1 + 0.15 * pw + 0.1 * hp);
  }
  let best = 0;
  for (const x of n.next) best = Math.max(best, pathValue(run, x, ns, depth - 1));
  return p * best;
}

export function chooseNode(run, rng, skill) {
  const next = reachable(run.map, run.nodeId);
  if (skill === 'smart' && !BOTX.has('oldpath') && next.length > 1) {
    const st = teamState(run);
    const firstWild = run.nuzlocke ? run.nuzEnc?.[String(run.actIndex)] === undefined : true;
    const s0 = { hp: st.hp, top: st.top, pw: 0, money: run.money, alive: st.alive, firstWild, pots: st.pots };
    const depth = +(process.env.PATH_DEPTH || 5);
    let best = null, bv = -Infinity;
    for (const id of next) { const v = pathValue(run, id, s0, depth) + rng.next() * 1e-3; if (v > bv) { bv = v; best = id; } }
    return best;
  }
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
  if (BOTX.has('oldshop')) return doShopOld(run, shop, rng, skill);
  const buy = (it) => { const r = buyItem(run, shop, it); if (r.ok && r.pending?.type === 'teach') { const mon = run.party.filter(m => canLearn(m.species, r.pending.move) && !knowsMove(m, r.pending.move)).sort((a, b) => moveScore(b, r.pending.move) - moveScore(a, r.pending.move))[0]; if (mon) learnSmart(mon, r.pending.move); } return r.ok; };
  const find = (k) => shop.items.find(i => i.key === k && !i.sold);
  const isHeal = (k) => !!(CONSUMABLES[k]?.heal || CONSUMABLES[k]?.healFrac);
  const nHeal = () => run.consumables.filter(isHeal).length;
  const carry = [...run.party].filter(m => !isFainted(m)).sort((a, b) => b.level - a.level)[0];
  // 1) RARE CANDY for the carry: permanent levels (Daniel's most-bought item), used on the spot
  const candy = find('RARE_CANDY');
  if (candy && carry && !run.levelUpBlocker?.(carry) && run.money >= candy.price) {
    if (buyItem(run, shop, candy, { consumed: true }).ok) useItemNow(run, 'RARE_CANDY', skill);
  }
  // 2) balls when the team still needs a catch
  const ballIt = shop.items.find(i => i.key === (run.actIndex >= 2 ? 'ULTRA_BALL' : run.actIndex >= 1 ? 'GREAT_BALL' : 'POKE_BALL'));
  const nuzDone = run.nuzlocke && run.nuzEnc?.[String(run.actIndex)] !== undefined;
  const ballWant = nuzDone ? 0 : run.party.length < 3 ? 3 : run.party.length < 6 && !run.nuzlocke ? 2 : run.nuzlocke ? 1 : 0;
  while (ballIt && run.totalBalls() < ballWant && run.money >= ballIt.price) buy(ballIt);
  // 3) healing: keep 2 heal items in the bag (3 when rich), the strongest that fits the budget
  const want = run.money > 4000 ? 3 : 2;
  const meds = ['HYPER_POTION', 'SUPER_POTION', 'POTION'].map(find).filter(Boolean);
  const leadMax = carry ? maxHp(carry) : 30;
  for (let g = 0; g < 3 && nHeal() < want && run.consumables.length < run.maxConsumables; g++) {
    const it = meds.find(i => run.money >= i.price && (CONSUMABLES[i.key].heal <= leadMax * 1.6 || i.key === 'POTION' || run.money >= i.price * 2.5)) || meds.find(i => run.money >= i.price);
    if (!it || !buy(it)) break;
  }
  // 4) held items worth it
  const relics = shop.items.filter(i => i.kind === 'relic' && !i.sold).sort((a, b) => relicScore(run, b.key) - relicScore(run, a.key));
  for (const it of relics) if (relicScore(run, it.key) >= 58 && run.money >= it.price) buy(it);
  // 5) a REVIVE (not in NUZLOCKE: fainted POKéMON are gone)
  const rev = find('REVIVE');
  if (rev && !run.nuzlocke && run.party.length >= 2 && !run.consumables.some(k => CONSUMABLES[k]?.revive) && run.consumables.length < run.maxConsumables && run.money >= rev.price + 400) buy(rev);
  // 6) vitamins (combo level-ups, no bag slot) for the combos actually played
  const plays = run.comboPlays || {}, totP = Object.values(plays).reduce((a, b) => a + b, 0) || 1;
  for (const it of shop.items.filter(i => i.vitamin && !i.sold).sort((a, b) => (plays[CONSUMABLES[b.key].combo] || 0) - (plays[CONSUMABLES[a.key].combo] || 0))) {
    const share = (plays[CONSUMABLES[it.key].combo] || 0) / totP;
    if (share >= 0.15 && run.money >= it.price + 300) buy(it);
  }
  // evolution stones
  for (const it of shop.items.filter(i => i.kind === 'consumable' && !i.sold && CONSUMABLES[i.key]?.evo)) if (run.money >= it.price && run.consumables.length < run.maxConsumables) buy(it);
  // 7) thin decks with the MOVE DELETER: status cards the bot won't use, then spare copies of weak attacks
  const del = shop.items.find(i => i.key === 'MOVE_DELETER');
  for (const mon of run.party) {
    let guard = 0;
    while (del && run.money >= del.price + 300 && guard++ < 6) {
      const idx = deletePick(mon);
      if (idx < 0) break;
      run.money -= del.price;
      const mv = mon.moves[idx];
      if ((mv.copies || 1) > 1) mv.copies--; else mon.moves.splice(idx, 1);
    }
  }
  // 8) TMs that are an upgrade
  for (const it of shop.items.filter(i => i.kind === 'tm' && !i.sold)) {
    const gain = Math.max(0, ...run.party.filter(m => canLearn(m.species, it.move) && !knowsMove(m, it.move)).map(m => moveScore(m, it.move) - Math.min(...m.moves.map(x => moveScore(m, x.move)))));
    if (gain > 40 && run.money >= it.price + 600) buy(it);
  }
  usePostItems(run, rng, skill);
}

function doShopOld(run, shop, rng, skill) {
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
    if (choice.sitOut) return { id: ev.id, label, sitOut: true }; // (co-op mythic, v0.5.6: this player sits the fight out)
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
    if (!BOTX.has('oldmoves')) { const i = deletePick(m); if (i < 0) continue; const mv = m.moves[i]; if ((mv.copies || 1) > 1) mv.copies--; else m.moves.splice(i, 1); return true; }
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
    // (v0.5.16: training stops at the A5+ level cap: only POKéMON below it; none -> heal)
    const ok = run.party.filter(m => !isFainted(m) && !(run.levelUpBlocker ? run.levelUpBlocker(m) : m.level >= 100)); // (frozen engines' Runs lack it)
    const m = skill === 'smart' ? ok.sort((a, b) => BOT_OPTS.rotate ? a.level - b.level : b.level - a.level)[0] : ok[0];
    if (!m) { run.centerHeal(); return {}; }
    return { train: m };
  }
  return {};
}
