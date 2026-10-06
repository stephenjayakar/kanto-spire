// Co-op logic tests: node tests/coop.test.mjs
import fs from 'fs';
import assert from 'assert/strict';
import { loadData, D } from '../web/src/game/data.js';
import { maxHp, isFainted, DECK_RULES } from '../web/src/game/pokemon.js';
import { EVENTS, pickEvent, eventChoices } from '../web/src/game/events.js';
import { RNG } from '../web/src/game/rng.js';
import { Run } from '../web/src/game/run.js';
import { CoopGame, duoConfig, pickCoopEvent, sharedEventId } from '../web/src/game/coop/coop.js';
import { DuoBattle } from '../web/src/game/coop/duo.js';
import { COOP_TUNING } from '../web/src/game/coop/tuning.js';
import { playCoop, makeBot, botAction } from './coop_bot.mjs';
import { chooseHand } from './bot.mjs';

await loadData(async f => JSON.parse(fs.readFileSync('web/assets/data/' + f, 'utf8')));
let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.log('FAIL', name, '-', e.stack.split('\n').slice(0, 3).join(' | ')); } };

const INIT = (seed, starters = ['BULBASAUR', 'CHARMANDER']) => ({ seq: 1, type: 'init', seed, ascension: 0, world: 'kanto', starters, names: ['A', 'B'] });
const post = (g, a) => g.apply(JSON.parse(JSON.stringify({ ...a, seq: g.seq + 1, nonce: 'x' + (g.seq + 1) })));
const runsJSON = g => JSON.stringify(g.runs.map(r => { const o = JSON.parse(JSON.stringify(r)); delete o.stats.startTime; delete o.map; return o; }));
const digestNoSeq = g => { const d = g.digest(); delete d.seq; return JSON.stringify(d); };

// A game sitting in a battle of the given node type (both players vote for a floor-0 node of that type).
function gameInBattle(type, seed0 = 'T') {
  for (let i = 0; i < 200; i++) {
    const g = CoopGame.fromInit(INIT(seed0 + i));
    const id = g.reachable().find(n => g.world.map.nodes[n].type === type);
    if (!id) continue;
    post(g, { p: 0, type: 'vote', node: id });
    post(g, { p: 1, type: 'vote', node: id });
    if (g.phase === 'battle') return g;
  }
  throw new Error('no ' + type + ' start node');
}
// The best legal hand of player p against the enemy in `slot` (smart bot evaluation).
function bestHand(d, p, slot) {
  const s = d.subs[p];
  return s.withFocus(d.field[d.normSlot(slot)], () => chooseHand(s, 'smart').best);
}

// ------------------------------------------------------------------------------------ determinism
t('determinism: bot log replays to identical checksums (battles, votes, private phases)', () => {
  const cks = [];
  const { game, log } = playCoop({ seed: 'DET1', maxActions: 420, onAction: (a, ok, g) => cks.push(g.checksum()) });
  const types = new Set(log.map(a => a.type));
  for (const k of ['init', 'vote', 'lock', 'privateDone']) assert.ok(types.has(k), 'log has ' + k);
  assert.ok(log.some(a => a.type === 'lock' && a.ids) && cks.length === log.length);
  const b = new CoopGame();
  log.forEach((a, i) => { b.apply(JSON.parse(JSON.stringify(a))); assert.equal(b.checksum(), cks[i], `checksum differs after seq ${a.seq} (${a.type})`); });
  assert.equal(runsJSON(b), runsJSON(game));
  assert.equal(b.phase, game.phase);
  // reconnect: a client that dropped mid-run replays the whole log from scratch
  const half = new CoopGame();
  for (const a of log.slice(0, log.length >> 1)) half.apply(a);
  const c = new CoopGame();
  for (const a of JSON.parse(JSON.stringify(log))) c.apply(a);
  assert.equal(c.checksum(), game.checksum());
  assert.equal(runsJSON(c), runsJSON(game));
  // and a client that kept its state applies the rest
  for (const a of log.slice(log.length >> 1)) half.apply(a);
  assert.equal(half.checksum(), game.checksum());
});

t('determinism: a whole bot run to the end replays identically', () => {
  const { game, log } = playCoop({ seed: 'DET2' });
  assert.ok(['over', 'victory'].includes(game.phase), game.phase);
  const b = new CoopGame();
  for (const a of log) b.apply(a);
  assert.equal(b.checksum(), game.checksum());
  assert.equal(runsJSON(b), runsJSON(game));
});

t('determinism: previews and card infos do not change the state', () => {
  const g = gameInBattle('trainer', 'PV');
  const before = g.checksum();
  const d = g.battle;
  for (const p of [0, 1]) for (const slot of [0, 1]) {
    const s = d.subs[p];
    for (const c of s.deck.hand) d.cardInfo(p, c, slot);
    const ids = s.deck.hand.slice(0, 3).map(c => c.id);
    d.simulate(p, ids, slot);
    bestHand(d, p, slot);
  }
  assert.equal(g.checksum(), before);
});

// ------------------------------------------------------------------------------------------ rules
t('rules: enemies show intents with a target player', () => {
  const g = gameInBattle('wild', 'IN');
  const d = g.battle;
  assert.equal(d.field.filter(x => x !== null).length, 2, 'two wild POKéMON on the field');
  for (const it of d.intents) {
    assert.ok(it && (it.target === 0 || it.target === 1), 'target');
    assert.ok(it.move && typeof it.text === 'string');
    if (it.kind === 'attack') assert.ok(Array.isArray(it.damage) && it.damage[1] >= it.damage[0]);
  }
});

t('rules: illegal and stale actions are ignored', () => {
  const g = CoopGame.fromInit(INIT('ILL'));
  const d0 = digestNoSeq(g);
  assert.equal(post(g, { p: 0, type: 'vote', node: 'boss' }), false, 'unreachable node');
  assert.equal(post(g, { p: 2, type: 'vote', node: g.reachable()[0] }), false, 'bad slot');
  assert.equal(post(g, { p: 0, type: 'lock', ids: [1], target: 0 }), false, 'lock outside battle');
  assert.equal(post(g, { p: 0, type: 'privateDone', run: g.snapshotRun(g.runs[0]) }), false, 'privateDone outside private phase');
  assert.equal(post(g, { p: 0, type: 'chat', text: 'hi' }), false);
  assert.equal(post(g, { p: 0, type: 'init', seed: 'X' }), false, 'second init');
  assert.equal(g.apply({ seq: 1, p: 0, type: 'vote', node: g.reachable()[0] }), false, 'stale seq');
  assert.equal(digestNoSeq(g), d0, 'ignored actions leave the state alone');
  const b = gameInBattle('trainer', 'ILB');
  const d = b.battle, s = d.subs[0];
  const before = digestNoSeq(b);
  assert.equal(post(b, { p: 0, type: 'lock', ids: [999999], target: 0 }), false, 'unknown card');
  assert.equal(post(b, { p: 0, type: 'lock', ids: [s.deck.hand[0].id, s.deck.hand[0].id], target: 0 }), false, 'duplicate card');
  assert.equal(post(b, { p: 0, type: 'lock', ids: [s.deck.hand[0].id], target: 5 }), false, 'bad target');
  assert.equal(post(b, { p: 0, type: 'lock', ball: 'POKE_BALL', target: 0 }), false, 'ball at a trainer');
  assert.equal(post(b, { p: 0, type: 'switch', uid: 12345 }), false, 'switch to nobody');
  s.run.consumables.push('ESCAPE_ROPE');
  assert.equal(post(b, { p: 0, type: 'item', key: 'ESCAPE_ROPE', uid: null }), false, 'no escaping in co-op');
  s.run.consumables.pop();
  assert.equal(post(b, { p: 0, type: 'vote', node: 'x' }), false, 'vote in battle');
  assert.equal(digestNoSeq(b), before);
  assert.equal(post(b, { p: 0, type: 'lock', pass: true }), true);
  assert.equal(post(b, { p: 0, type: 'discard', ids: [s.deck.hand[0].id] }), false, 'no discards after locking');
});

t('rules: tie vote is broken deterministically by the shared RNG', () => {
  let g, nodes;
  for (let i = 0; i < 50; i++) { g = CoopGame.fromInit(INIT('TIE' + i)); nodes = g.reachable(); if (nodes.length >= 2) break; }
  const log = [{ p: 0, type: 'vote', node: nodes[0] }, { p: 1, type: 'vote', node: nodes[1] }];
  for (const a of log) post(g, a);
  assert.equal(g.lastVote.tie, true);
  assert.ok(nodes.slice(0, 2).includes(g.lastVote.picked));
  assert.equal(g.world.nodeId, g.lastVote.picked);
  assert.ok(g.events.some(e => e.t === 'tie'));
  const h = CoopGame.fromInit(INIT(g.seed));
  for (const a of log) post(h, a);
  assert.equal(h.lastVote.picked, g.lastVote.picked);
  assert.equal(h.checksum(), g.checksum());
  // same vote: no tie, runs mirror the node
  const k = CoopGame.fromInit(INIT('TIE0'));
  const n = k.reachable()[0];
  post(k, { p: 0, type: 'vote', node: n }); post(k, { p: 1, type: 'vote', node: n });
  assert.equal(k.lastVote.tie, false);
  for (const r of k.runs) { assert.equal(r.nodeId, n); assert.equal(r.floor, 0); assert.equal(r.actIndex, 0); assert.equal(r.boss, k.world.boss); }
});

t('rules: both players down in the same battle = run over', () => {
  const g = gameInBattle('trainer', 'OVR');
  for (const r of g.runs) { r.party.forEach((m, i) => { m.hp = i === 0 ? 1 : 0; }); }
  let guard = 0;
  while (g.phase === 'battle' && guard++ < 60) {
    for (const p of [0, 1]) if (!g.battle.down[p] && !g.battle.locks[p]) post(g, { p, type: 'lock', pass: true });
  }
  assert.equal(g.phase, 'over');
  assert.equal(g.result, 'lose');
  assert.deepEqual(g.down, [true, true]);
  assert.equal(post(g, { p: 0, type: 'lock', pass: true }), false, 'nothing after game over');
});

t('rules: one player down + partner wins = revive with reviveFrac HP and full rewards', () => {
  const g = gameInBattle('wild', 'REV');
  const d = g.battle, s0 = d.subs[0];
  for (const m of s0.run.party.slice(1)) m.hp = 0;
  const lead = s0.lead();
  s0.damagePlayer(lead, lead.hp);
  s0.checkLeadFaint();
  assert.equal(d.down[0], true);
  assert.ok(d.intents.every(it => !it || it.target === 1), 'foes retarget the player still standing');
  // make player 2 strong enough to finish the fight alone
  for (const e of d.enemies) { e.hp = Math.min(e.hp, 3); }
  let guard = 0;
  while (g.phase === 'battle' && guard++ < 40) {
    const ids = bestHand(d, 1, d.field[0] !== null ? 0 : 1);
    post(g, ids ? { p: 1, type: 'lock', ids, target: d.field[0] !== null ? 0 : 1 } : { p: 1, type: 'lock', pass: true });
  }
  assert.equal(g.phase, 'private');
  assert.equal(g.private.kind, 'reward');
  assert.deepEqual(g.down, [true, false]);
  assert.equal(lead.hp, Math.max(1, Math.floor(maxHp(lead) * COOP_TUNING.reviveFrac)));
  const r0 = g.battleSubs[0].result, r1 = g.battleSubs[1].result;
  assert.ok(r0.outcome === 'win' && r1.outcome === 'win');
  assert.ok(r0.exp > 0 && r0.exp === r1.exp && r0.money > 0, 'both players get EXP and money');
  // (v0.3.2) the revived lead was fainted when the battle ended: no EXP for it (tests/v032_exp.test.mjs)
  assert.ok(!r0.participants.includes(lead.uid) && r0.fainted.includes(lead.uid));
  assert.ok(g.events.some(e => e.t === 'revive' && e.p === 0));
});

t('rules: TEAM UP gives the second hand on the same foe +teamUp% damage', () => {
  const g = gameInBattle('trainer', 'TUP');
  const d = g.battle;
  for (const e of d.enemies) { e.maxHp *= 20; e.hp = e.maxHp; } // nobody faints this turn
  const ids0 = bestHand(d, 0, 0), ids1 = bestHand(d, 1, 0);
  const solo1 = d.simulate(1, ids1, 0).damage, solo0 = d.simulate(0, ids0, 0).damage;
  post(g, { p: 0, type: 'lock', ids: ids0, target: 0 });
  const after1 = d.simulate(1, ids1, 0).damage;
  const p0First = d.teamUpPreview(1, d.field[0]);
  if (p0First) assert.ok(after1 > solo1 && Math.abs(after1 - solo1 * (1 + COOP_TUNING.teamUp / 100)) <= 2, `${solo1} -> ${after1}`);
  else assert.equal(after1, solo1);
  void solo0;
  const ev = [];
  const turn = d.turn;
  post(g, { p: 1, type: 'lock', ids: ids1, target: 0 });
  ev.push(...g.lastEvents);
  assert.ok(d.turn === turn + 1, 'turn resolved');
  const tu = ev.filter(e => e.t === 'times' && e.src === 'TEAM UP');
  assert.equal(tu.length, 1, 'exactly one hand got TEAM UP');
  const plays = ev.filter(e => e.t === 'play').map(e => e.p);
  assert.deepEqual(plays.sort(), [0, 1]);
});

t('rules: a trainer refills the emptied slot from its own queue; win when all are gone', () => {
  let d = null, world;
  for (let i = 0; i < 100 && !d; i++) {
    world = Run.create({ starter: 'SQUIRTLE', seed: 'RF' + i });
    const cfg = duoConfig(world, { id: 'rf', floor: 8, type: 'trainer' });
    if (cfg.queues[0].length >= 2 && cfg.tag) {
      const runs = [Run.create({ starter: 'BULBASAUR', seed: 'RFa' + i }), Run.create({ starter: 'CHARMANDER', seed: 'RFb' + i })];
      for (const r of runs) for (const m of r.party) { m.level = 60; m.hp = maxHp(m); }
      d = new DuoBattle(runs, cfg);
    }
  }
  d.start();
  const q0 = d.cfg.queues[0];
  assert.equal(d.field[0], q0[0]);
  d.enemies[q0[0]].hp = 1;
  for (const p of [0, 1]) d.lock(p, { ids: bestHand(d, p, 0), target: 0 });
  assert.equal(d.gone[q0[0]], 'faint');
  assert.equal(d.field[0], q0[1], 'next POKéMON of the same trainer took the slot');
  assert.ok(d.defeated.includes(d.enemies[q0[0]]));
  for (const e of d.enemies) e.hp = 1;
  let guard = 0;
  while (!d.result && guard++ < 30) for (const p of [0, 1]) if (!d.result && !d.locks[p]) { const sl = d.field[0] !== null ? 0 : 1; const ids = bestHand(d, p, sl); d.lock(p, ids ? { ids, target: sl } : { pass: true }); }
  assert.equal(d.result?.outcome, 'win');
  assert.equal(d.defeated.length, d.enemies.length);
  assert.ok(d.subs.every(s => s.result.exp > 0));
});

t('rules: a ball catches one foe for that player; the other stays on the field', () => {
  const g = gameInBattle('wild', 'BALL');
  const d = g.battle;
  g.runs[0].balls.MASTER_BALL = 1;
  const ri = d.field[1];
  post(g, { p: 0, type: 'lock', ball: 'MASTER_BALL', target: 1 });
  post(g, { p: 1, type: 'lock', pass: true });
  assert.equal(d.gone[ri], 'caught');
  assert.equal(d.subs[0].caught, d.enemies[ri]);
  assert.equal(d.field[1], null);
  assert.ok(d.field[0] !== null && g.phase === 'battle');
  assert.equal(post(g, { p: 0, type: 'lock', ball: 'POKE_BALL', target: 0 }), false, 'one catch per player per battle');
});

t('rules: a partner item heals the partner; a revive brings a downed partner back', () => {
  const g = gameInBattle('trainer', 'ITM');
  const d = g.battle, s1 = d.subs[1];
  const l1 = s1.lead();
  l1.hp = 1;
  g.runs[0].consumables.push('SUPER_POTION');
  assert.equal(post(g, { p: 0, type: 'item', key: 'SUPER_POTION', uid: l1.uid, toP: 1 }), true);
  assert.ok(l1.hp > 1);
  for (const m of s1.run.party) m.hp = 0;
  s1.checkLeadFaint();
  s1.afterPlayerFaint(l1);
  assert.equal(d.down[1], true);
  g.runs[0].consumables.push('REVIVE');
  assert.equal(post(g, { p: 0, type: 'item', key: 'REVIVE', uid: l1.uid, toP: 1 }), true);
  assert.equal(d.down[1], false);
  assert.ok(!isFainted(l1) && s1.leadUid === l1.uid);
});

t('rules: map actions setLead / mapItem', () => {
  const g = CoopGame.fromInit(INIT('MAP'));
  const r = g.runs[0];
  r.party.push({ ...JSON.parse(JSON.stringify(r.party[0])), uid: 77 });
  assert.equal(post(g, { p: 0, type: 'setLead', uid: 77 }), true);
  assert.equal(r.party[0].uid, 77);
  assert.equal(post(g, { p: 0, type: 'setLead', uid: 4242 }), false);
  r.party[0].hp = 1;
  assert.equal(post(g, { p: 0, type: 'mapItem', key: 'POTION', uid: 77 }), true);
  assert.ok(r.party[0].hp > 1 && r.consumables.filter(k => k === 'POTION').length === 1);
  r.consumables.push('X_ATTACK');
  assert.equal(post(g, { p: 0, type: 'mapItem', key: 'X_ATTACK', uid: 77 }), false);
});

t('co-op events never start battles (solo choices hidden); solo pickEvent deterministic', () => {
  const run = Run.create({ seed: 'EV', coop: true });
  run.actIndex = 1; run.floor = 6; run.party.push(...run.party, ...run.party);
  for (let i = 0; i < 300; i++) {
    run.seenEvents = [];
    const ev = pickCoopEvent(run, new RNG('e' + i));
    const list = eventChoices(ev, run);
    assert.ok(list.every(c => !c.solo), ev.id);
    assert.ok(list.some(c => !c.leave), ev.id + ': nothing to do in co-op');
  }
  const a = Run.create({ seed: 'EV2' }), b = Run.create({ seed: 'EV2' });
  for (let i = 0; i < 30; i++) assert.equal(pickEvent(a, new RNG('s' + i)).id, pickEvent(b, new RNG('s' + i)).id);
});

t('encounters: duo configs per kind', () => {
  const w = Run.create({ starter: 'CHARMANDER', seed: 'ENC' });
  const wild = duoConfig(w, { id: 'a', floor: 3, type: 'wild' });
  assert.equal(wild.enemies.length, 2); assert.deepEqual(wild.slotQueue, [0, 1]);
  const tr = duoConfig(w, { id: 'b', floor: 3, type: 'trainer' });
  assert.ok(tr.tag && tr.trainers.length === 2 && tr.trainers[0].key !== tr.trainers[1].key);
  const boss = duoConfig(w, { id: 'boss', floor: 15, type: 'boss' });
  assert.ok(boss.enemies.length >= 2 && boss.bossRule && boss.queues.length === 1 && boss.enemies.every(e => e.bossRule));
  w.actIndex = 3; w.startAct(3);
  const e4 = duoConfig(w, { id: 'boss', floor: 7, type: 'boss' });
  assert.equal(e4.gauntlet, 0); assert.equal(e4.coopKind, 'gauntlet');
});


// ------------------------------------------------------------------------------------ v0.0.5 rules in duo battles
// A game in a battle of the given node type, with prep(game) run on the fresh runs before the vote.
function gameInBattleWith(type, seed0, prep) {
  for (let i = 0; i < 200; i++) {
    const g = CoopGame.fromInit(INIT(seed0 + i));
    const id = g.reachable().find(n => g.world.map.nodes[n].type === type);
    if (!id) continue;
    prep(g);
    post(g, { p: 0, type: 'vote', node: id });
    post(g, { p: 1, type: 'vote', node: id });
    if (g.phase === 'battle') return g;
  }
  throw new Error('no ' + type + ' start node');
}
const passTurn = (g) => { for (const p of [0, 1]) if (!g.battle.down[p] && !g.battle.locks[p]) post(g, { p, type: 'lock', pass: true }); };

t('v0.0.5: free discard once per turn, then paid discards (PP decks, DECK_RULES)', () => {
  const g = gameInBattle('trainer', 'FD');
  const s = g.battle.subs[0];
  assert.equal(s.discardsLeft, DECK_RULES.discards);
  assert.ok(s.deckSize() > s.handSize, 'PP decks are bigger than a hand');
  const left = s.discardsLeft, turn = g.battle.turn;
  assert.equal(post(g, { p: 0, type: 'discard', ids: s.deck.hand.slice(0, 2).map(c => c.id) }), true);
  assert.equal(s.discardsLeft, left, 'the first 2-card discard of a turn is free');
  assert.equal(s.freeDiscardTurn, turn);
  assert.equal(post(g, { p: 0, type: 'discard', ids: s.deck.hand.slice(0, 1).map(c => c.id) }), true);
  assert.equal(s.discardsLeft, left - 1, 'a second discard in the same turn costs one');
  passTurn(g);
  if (g.phase === 'battle' && !g.battle.down[0]) {
    assert.ok(s.freeDiscardOk(2), 'the free discard is back next turn');
    assert.equal(post(g, { p: 0, type: 'discard', ids: s.deck.hand.slice(0, 2).map(c => c.id) }), true);
    assert.equal(s.discardsLeft, left - 1);
  }
});

t('v0.0.5: ACRO BIKE is one free 1-card discard per turn, on top of the free discard', () => {
  const g = gameInBattleWith('trainer', 'AB', g => g.runs[0].addRelic('ACRO_BIKE'));
  const s = g.battle.subs[0];
  assert.ok(s.mods.acroBike);
  const left = s.discardsLeft;
  const one = () => post(g, { p: 0, type: 'discard', ids: [s.deck.hand[0].id] });
  assert.equal(one(), true); assert.equal(s.discardsLeft, left); assert.ok(s.freeDiscardOk(1), 'bike spent first');
  assert.equal(one(), true); assert.equal(s.discardsLeft, left, 'then the free discard');
  assert.equal(one(), true); assert.equal(s.discardsLeft, left - 1, 'then a paid one');
});

t('v0.0.5: MIMIC copies the targeted foe\'s move as a one-use card next turn', () => {
  const g = gameInBattle('trainer', 'MI');
  const d = g.battle, s = d.subs[0], lead = s.lead();
  const card = { id: s.cardId++, uid: lead.uid, move: 'MIMIC' };
  s.deck.hand.push(card);
  const tgt = d.field[0], foeMoves = d.enemies[tgt].moves;
  assert.equal(post(g, { p: 0, type: 'lock', ids: [card.id], target: 0 }), true);
  post(g, { p: 1, type: 'lock', pass: true });
  if (g.phase !== 'battle' || d.down[0] || d.gone[tgt]) return; // (the lead fell / the foe left: nothing to check)
  const temp = s.deck.hand.filter(c => c.temp);
  assert.equal(temp.length, 1, 'one copied card');
  assert.ok(foeMoves.includes(temp[0].move), 'a move of the targeted foe');
  const pile = s.pileOf(card.uid);
  assert.ok(pile.discard.includes(card) || pile.draw.includes(card) || pile.hand.includes(card), 'MIMIC itself goes back to the deck');
  if (!s.canPlay([temp[0].id]).ok) return;
  assert.equal(post(g, { p: 0, type: 'lock', ids: [temp[0].id], target: 0 }), true);
  post(g, { p: 1, type: 'lock', pass: true });
  const all = Object.values(s.decks).flatMap(k => [...k.draw, ...k.hand, ...k.discard, ...(k.gone || [])]);
  assert.ok(!all.includes(temp[0]), 'the copied card is used up');
});

t('v0.0.5: wild no-repeat in co-op (two different foes, never met again while the pool lasts)', () => {
  const w = Run.create({ starter: 'CHARMANDER', seed: 'NR' });
  const seen = new Set();
  for (let i = 0; i < 8; i++) {
    const c = duoConfig(w, { id: 'n' + i, floor: 2, type: 'wild' });
    const sp = c.enemies.map(e => e.species);
    assert.notEqual(sp[0], sp[1], 'the two wild foes differ');
    // (this early pool has 6 POKéMON: the first 3 battles never repeat, later ones may)
    if (i < 3) for (const x of sp) { assert.ok(!seen.has(x), `${x} repeated`); seen.add(x); }
  }
  assert.equal(w.wildSeen.length, 6);
});

// ------------------------------------------------------------------------- v0.0.6 rival / legendary nodes
t('v0.0.6: rival and legendary-bird duo configs; Nuzlocke rules stay off in co-op', () => {
  const g = CoopGame.fromInit({ ...INIT('V6'), ascension: 10 });
  assert.ok(g.runs.every(r => !r.nuzlocke) && !g.world.nuzlocke, 'co-op runs never use the Nuzlocke ascension');
  g.world.startAct(1);
  const nodes = Object.values(g.world.map.nodes);
  const rv = duoConfig(g.world, nodes.find(n => n.type === 'rival'));
  assert.ok(rv.rival && rv.coopKind === 'rival' && rv.slots === 2 && rv.enemies.length >= 2 && rv.trainer.name === 'BLUE');
  const lg = duoConfig(g.world, nodes.find(n => n.type === 'legend'));
  assert.equal(lg.slots, 1); assert.equal(lg.coopKind, 'bird'); assert.equal(lg.enemies[0].species, 'ZAPDOS');
  assert.equal(lg.rewardRelic, 'THUNDER_FEATHER'); assert.ok(lg.catchOffer);
  // same seed, same configs
  const g2 = CoopGame.fromInit({ ...INIT('V6'), ascension: 10 }); g2.world.startAct(1);
  const lg2 = duoConfig(g2.world, Object.values(g2.world.map.nodes).find(n => n.type === 'legend'));
  const sig = c => JSON.stringify(c.enemies.map(e => [e.species, e.level, e.maxHp, e.moves]));
  assert.equal(sig(lg2), sig(lg));
});
// A co-op game standing right before a node of the given type in act `act` (the map position is set
// directly; the replay does the same), then two bots play through it and its private phase.
function throughNode(seed, type, act) {
  const setup = () => {
    const g = CoopGame.fromInit({ ...INIT(seed), ascension: 0 });
    if (act) { g.world.startAct(act); for (const r of g.runs) r.startAct(act); }
    const target = Object.values(g.world.map.nodes).find(n => n.type === type);
    g.world.nodeId = target.prev[0]; g.world.floor = target.floor - 1; g.mirror();
    // strong enough teams so the fight resolves either way quickly
    for (const r of g.runs) for (const m of r.party) { m.level = Math.max(m.level, g.world.levelFor(target.floor) + 14); m.hp = maxHp(m); }
    return { g, target };
  };
  const { g, target } = setup();
  const log = [], cks = [], bots = [makeBot(seed, 0), makeBot(seed, 1)];
  const post = a => { const act = JSON.parse(JSON.stringify({ ...a, seq: g.seq + 1, nonce: 'n' + (g.seq + 1) })); log.push(act); const ok = g.apply(act); cks.push(g.checksum()); return ok; };
  post({ p: 0, type: 'vote', node: target.id }); post({ p: 1, type: 'vote', node: target.id });
  const cfg = g.battleCfg;
  let n = 0;
  while (g.phase !== 'map' && !['over', 'victory'].includes(g.phase) && n++ < 3000) {
    if (g.phase === 'battle' && g.battle.turn > 80) break;
    let acted = false;
    for (const bot of bots) { const a = botAction(g, bot); if (!a) continue; post(a); acted = true; break; }
    if (!acted) break;
  }
  const { g: b } = setup();
  log.forEach((a, i) => { b.apply(JSON.parse(JSON.stringify(a))); assert.equal(b.checksum(), cks[i], `${seed} ${type}: checksum differs after seq ${a.seq} (${a.type})`); });
  return { g, cfg };
}
t('v0.0.6: rival and legendary battles (and the one-time catch in the private reward) replay identically', () => {
  const rv = throughNode('V6R', 'rival', 0);
  assert.ok(rv.cfg.rival && rv.g.phase === 'map', 'rival fought, back on the map: ' + rv.g.phase);
  const birdHp = COOP_TUNING.hp.bird; COOP_TUNING.hp.bird = 0.4; // (a quick fight: this test is about the replay and the catch)
  let lg; try { lg = throughNode('V6L', 'legend', 1); } finally { COOP_TUNING.hp.bird = birdHp; }
  assert.ok(lg.cfg.legendNode, 'legendary bird fought');
  assert.equal(lg.g.phase, 'map', 'won it');
  for (const r of lg.g.runs) {
    assert.ok(r.hasRelic('THUNDER_FEATHER'), 'each player gets the bird\'s held item');
    assert.ok((r.legendsCaught || []).includes('ZAPDOS'), 'each player had the one-time offer');
  }
});

// ------------------------------------------------------------------------------------ UNLOCK (take back a lock-in)
t('unlock: cancels my lock before the turn resolves; relock with another hand; both clients agree', () => {
  const g = gameInBattle('trainer', 'UL');
  const d = g.battle, t0 = d.turn;
  const h0 = bestHand(d, 0, 0);
  assert.ok(post(g, { p: 0, type: 'lock', ids: h0, target: 0 }));
  assert.ok(d.locks[0] && d.turn === t0);
  const handBefore = d.subs[0].deck.hand.map(c => c.id).join(',');
  assert.ok(post(g, { p: 0, type: 'unlock', turn: t0 }), 'unlock accepted');
  assert.equal(d.locks[0], null);
  assert.ok(g.lastEvents.some(e => e.t === 'unlock' && e.p === 0), 'unlock event for the UI');
  assert.equal(d.subs[0].deck.hand.map(c => c.id).join(','), handBefore, 'the hand is untouched');
  assert.equal(post(g, { p: 0, type: 'unlock', turn: t0 }), false, 'unlocking twice is refused');
  assert.equal(post(g, { p: 1, type: 'unlock', turn: t0 }), false, "can't unlock a player who isn't locked");
  // the partner locks: no resolution while I'm unlocked
  assert.ok(post(g, { p: 1, type: 'lock', ids: bestHand(d, 1, 1), target: 1 }));
  assert.equal(d.turn, t0, 'turn not resolved while P1 is unlocked');
  // P2 can unlock too, then lock again
  assert.ok(post(g, { p: 1, type: 'unlock', turn: t0 }));
  assert.ok(post(g, { p: 1, type: 'lock', ids: bestHand(d, 1, 0), target: 0 }));
  // I relock (maybe a different hand): now the turn resolves
  const h1 = bestHand(d, 0, 1);
  assert.ok(post(g, { p: 0, type: 'lock', ids: h1, target: 1 }));
  assert.ok(d.result || d.turn === t0 + 1, 'turn resolved once both are locked');
});

t('unlock: determinism: replaying a log with lock/unlock/relock gives identical checksums', () => {
  const g = gameInBattle('trainer', 'UD');
  const log = [];
  const P = (a) => { const full = { ...a, seq: g.seq + 1, nonce: 'n' + (g.seq + 1) }; log.push(JSON.parse(JSON.stringify(full))); return g.apply(JSON.parse(JSON.stringify(full))); };
  const g2 = gameInBattle('trainer', 'UD'); // a second client with the same prefix (init + votes)
  const d = g.battle;
  for (let k = 0; k < 4 && !d.result; k++) {
    const t0 = d.turn;
    P({ p: 0, type: 'lock', ids: bestHand(d, 0, 0), target: 0 });
    P({ p: 0, type: 'unlock', turn: t0 });
    P({ p: 1, type: 'lock', ids: bestHand(d, 1, 0), target: 0 });
    P({ p: 0, type: 'unlock', turn: t0 }); // refused (not locked)
    if (d.result) break;
    P({ p: 0, type: 'lock', ids: bestHand(d, 0, 1) || bestHand(d, 0, 0), target: 1 });
  }
  const cks = [];
  for (const a of log) { g2.apply(JSON.parse(JSON.stringify(a))); cks.push(g2.checksum()); }
  assert.equal(g2.checksum(), g.checksum(), 'same state on the second client');
  assert.equal(runsJSON(g2), runsJSON(g));
});

t('unlock race: partner locks first in the log -> the turn resolves and my late unlock is refused', () => {
  // Both clients see the same log. P1 is locked; P2's lock and P1's unlock are posted at nearly the same
  // moment. Order A: P2 lock lands first -> turn resolves, P1's unlock (for the old turn) is refused.
  // Order B: P1's unlock lands first -> P2's lock waits; nothing resolves until P1 locks again.
  const mk = () => gameInBattle('trainer', 'RC');
  const A = mk(), B = mk();
  const tA = A.battle.turn;
  const h0 = bestHand(A.battle, 0, 0), h1 = bestHand(A.battle, 1, 0);
  for (const g of [A, B]) assert.ok(post(g, { p: 0, type: 'lock', ids: h0, target: 0 }));
  // order A
  assert.ok(post(A, { p: 1, type: 'lock', ids: h1, target: 0 }));
  assert.ok(A.battle.result || A.battle.turn === tA + 1, 'A: resolved at P2 lock');
  const beforeA = digestNoSeq(A);
  assert.equal(post(A, { p: 0, type: 'unlock', turn: tA }), false, 'A: the late unlock is refused');
  assert.equal(digestNoSeq(A), beforeA, 'A: the refused unlock changes nothing');
  // order B
  assert.ok(post(B, { p: 0, type: 'unlock', turn: tA }), 'B: unlock first');
  assert.ok(post(B, { p: 1, type: 'lock', ids: h1, target: 0 }));
  assert.equal(B.battle.turn, tA, 'B: P2 waits for P1');
  assert.ok(!B.battle.locks[0] && B.battle.locks[1]);
  // an unlock for an old turn can never cancel a lock made on a later turn
  const C = mk(), tC = C.battle.turn;
  post(C, { p: 0, type: 'lock', ids: h0, target: 0 });
  post(C, { p: 1, type: 'lock', ids: h1, target: 0 });
  if (!C.battle.result) {
    post(C, { p: 0, type: 'lock', ids: bestHand(C.battle, 0, 0), target: 0 });
    assert.ok(C.battle.locks[0], 'locked on the new turn');
    assert.equal(post(C, { p: 0, type: 'unlock', turn: tC }), false, 'stale unlock refused');
    assert.ok(C.battle.locks[0], 'the new lock stays');
  }
});

t('unlock: refused digest is unchanged (no partial effects)', () => {
  const g = gameInBattle('wild', 'UR');
  const before = digestNoSeq(g);
  assert.equal(post(g, { p: 0, type: 'unlock', turn: g.battle.turn }), false);
  assert.equal(digestNoSeq(g), before);
});

// ------------------------------------------------------------------------------------ 3-4 players (coop4)
const INITN = (seed, n) => ({ seq: 1, type: 'init', seed, ascension: 0, world: 'kanto', starters: ['BULBASAUR', 'CHARMANDER', 'SQUIRTLE', 'BULBASAUR'].slice(0, n), names: ['A', 'B', 'C', 'D'].slice(0, n) });
function gameInBattleN(type, n, seed0 = 'N') {
  for (let i = 0; i < 200; i++) {
    const g = CoopGame.fromInit(INITN(seed0 + i, n));
    const id = g.reachable().find(x => g.world.map.nodes[x].type === type);
    if (!id) continue;
    for (let p = 0; p < n && g.phase === 'map'; p++) post(g, { p, type: 'vote', node: id });
    if (g.phase === 'battle') return g;
  }
  throw new Error('no ' + type + ' start node');
}
const twoNodes = (n, seed) => { for (let i = 0; i < 80; i++) { const g = CoopGame.fromInit(INITN(seed + i, n)); const r = g.reachable(); if (r.length >= 3) return { g, r }; } throw new Error('no fork'); };

t('N players: init makes 2-4 runs (extra starters ignored, missing ones filled)', () => {
  for (const n of [2, 3, 4]) {
    const g = CoopGame.fromInit(INITN('NI', n));
    assert.equal(g.n, n); assert.equal(g.votes.length, n); assert.equal(g.down.length, n); assert.equal(g.names.length, n);
  }
  const five = CoopGame.fromInit({ ...INITN('N5', 4), starters: ['BULBASAUR', 'CHARMANDER', 'SQUIRTLE', 'BULBASAUR', 'SQUIRTLE'] });
  assert.equal(five.n, 4);
  const one = CoopGame.fromInit({ ...INITN('N1', 2), starters: ['BULBASAUR'] });
  assert.equal(one.n, 2);
  assert.equal(post(CoopGame.fromInit(INITN('NP', 3)), { p: 3, type: 'vote', node: 'x' }), false, 'slot 3 is not in a 3-player game');
});

t('N players: votes = plurality once all voted, early strict majority, ties by the shared RNG', () => {
  // 3 players: A, B -> waits; C votes A -> A, no tie
  let { g, r } = twoNodes(3, 'NV');
  post(g, { p: 0, type: 'vote', node: r[0] }); post(g, { p: 1, type: 'vote', node: r[1] });
  assert.equal(g.phase, 'map', 'no majority yet');
  post(g, { p: 2, type: 'vote', node: r[0] });
  assert.equal(g.world.nodeId, r[0]); assert.equal(g.lastVote.tie, false);
  // 3 players: A, A -> a strict majority goes at once
  ({ g, r } = twoNodes(3, 'NW'));
  post(g, { p: 0, type: 'vote', node: r[1] }); post(g, { p: 2, type: 'vote', node: r[1] });
  assert.equal(g.world.nodeId, r[1], 'two of three = majority');
  // 4 players: 2-2 waits for all four, then a coin between the two
  ({ g, r } = twoNodes(4, 'NX'));
  post(g, { p: 0, type: 'vote', node: r[0] }); post(g, { p: 1, type: 'vote', node: r[0] }); post(g, { p: 2, type: 'vote', node: r[1] });
  assert.equal(g.phase, 'map', 'two of four is not a majority');
  post(g, { p: 3, type: 'vote', node: r[1] });
  assert.equal(g.lastVote.tie, true); assert.ok([r[0], r[1]].includes(g.lastVote.picked));
  // 3 players, three different nodes: a three-way tie, same pick on every client
  ({ g, r } = twoNodes(3, 'NY'));
  const log = [0, 1, 2].map(p => ({ p, type: 'vote', node: r[p] }));
  for (const a of log) post(g, a);
  assert.equal(g.lastVote.tie, true); assert.ok(r.slice(0, 3).includes(g.lastVote.picked));
  const h = CoopGame.fromInit(INITN(g.seed, 3));
  for (const a of log) post(h, a);
  assert.equal(h.checksum(), g.checksum());
  // a vote can be changed before it resolves
  ({ g, r } = twoNodes(4, 'NZ'));
  post(g, { p: 0, type: 'vote', node: r[0] }); post(g, { p: 0, type: 'vote', node: r[1] });
  assert.deepEqual(g.votes, [r[1], null, null, null]);
});

t('N players: each foe acts n/2 times (4 players: 2 each, 3: 1 or 2 alternating); the turn waits for everyone', () => {
  const g = gameInBattleN('trainer', 4, 'NB');
  const d = g.battle;
  assert.equal(d.n, 4);
  const live = d.liveField().length;
  assert.equal(d.intents.filter(Boolean).length, 2 * live, '2 actions per foe');
  for (const it of d.intents.filter(Boolean)) assert.ok(it.target >= 0 && it.target < 4);
  const t0 = d.turn;
  for (let p = 0; p < 3; p++) post(g, { p, type: 'lock', pass: true });
  assert.equal(d.turn, t0, 'three locks of four: still the same turn');
  post(g, { p: 3, type: 'lock', pass: true });
  assert.ok(d.turn > t0 || d.result, 'the fourth lock resolves the turn');
  const g3 = gameInBattleN('trainer', 3, 'NC');
  const d3 = g3.battle, a = d3.actsFor(0) + d3.actsFor(1);
  assert.equal(a, 3, '3 players: three foe actions per turn with two foes out');
  const counts = [];
  for (let k = 0; k < 2 && !d3.result; k++) { counts.push([d3.intentsOf(0).length, d3.intentsOf(1).length].join('')); for (let p = 0; p < 3; p++) if (!d3.out(p) && !d3.locks[p]) post(g3, { p, type: 'lock', pass: true }); }
  if (counts.length === 2 && d3.liveField().length === 2) assert.notEqual(counts[0], counts[1], 'the extra action alternates between the foes');
});

t('N players: 4-player configs (wild = 4 POKéMON two at a time, others HP x2) and the lose rule', () => {
  const w = gameInBattleN('wild', 4, 'NWD');
  assert.equal(w.battle.enemies.length, 4);
  assert.deepEqual(w.battle.queues.map(q => q.length), [1, 1], 'two wait in the queues');
  assert.equal(new Set(w.battle.enemies.map(e => e.species)).size, 4, 'four different wild POKéMON');
  assert.ok(w.battleCfg.expScale === 0.5);
  // trainer: same encounter as 2 players, foe HP x n/2 (x the per-size factor)
  for (let i = 0; i < 50; i++) {
    const g2 = CoopGame.fromInit(INIT('NT' + i)), g4 = CoopGame.fromInit(INITN('NT' + i, 4));
    const id = g2.reachable().find(x => g2.world.map.nodes[x].type === 'trainer');
    if (!id) continue;
    const c2 = duoConfig(g2.world, g2.world.map.nodes[id], 2), c4 = duoConfig(g4.world, g4.world.map.nodes[id], 4);
    const f = 2 * (COOP_TUNING.players?.[4]?.hp?.trainer ?? COOP_TUNING.players?.[4]?.hpAll ?? 1);
    assert.deepEqual(c4.enemies.map(e => e.species), c2.enemies.map(e => e.species));
    c4.enemies.forEach((e, j) => assert.ok(Math.abs(e.maxHp - c2.enemies[j].maxHp * f) <= f + 1, `${e.maxHp} vs ${c2.enemies[j].maxHp} x ${f}`));
    break;
  }
  // all three players down = run over
  const g = gameInBattleN('trainer', 3, 'NO');
  for (const r of g.runs) r.party.forEach((m, i) => { m.hp = i === 0 ? 1 : 0; });
  let guard = 0;
  while (g.phase === 'battle' && guard++ < 60) for (let p = 0; p < 3; p++) if (!g.battle.out(p) && !g.battle.locks[p]) post(g, { p, type: 'lock', pass: true });
  assert.equal(g.phase, 'over');
  assert.deepEqual(g.down, [true, true, true]);
});

t('N players: a sat-out player (away) is skipped by votes, private phases and battles, and comes back with their next action', () => {
  let { g, r } = twoNodes(3, 'NA');
  assert.equal(post(g, { p: 1, type: 'away', target: 1, away: true }), false, "you can't sit yourself out");
  post(g, { p: 0, type: 'vote', node: r[0] }); post(g, { p: 1, type: 'vote', node: r[1] });
  assert.equal(g.phase, 'map');
  assert.equal(post(g, { p: 0, type: 'away', target: 2, away: true }), true);
  assert.equal(g.lastVote.tie, true, 'the two remaining votes decide (here: a tie)');
  // battle without P3: only P1 and P2 lock; foes never target P3
  const b = gameInBattleN('trainer', 3, 'NAB');
  post(b, { p: 0, type: 'away', target: 2, away: true });
  const d = b.battle;
  assert.ok(d.away[2] && d.intents.every(it => !it || it.target !== 2), 'no foe aims at the sat-out player');
  const t0 = d.turn;
  post(b, { p: 0, type: 'lock', pass: true }); post(b, { p: 1, type: 'lock', pass: true });
  assert.ok(d.turn > t0 || d.result, 'two locks resolve the turn');
  assert.equal(post(b, { p: 1, type: 'away', target: 0, away: true }), false, 'someone has to keep playing');
  // P3 comes back: any action of theirs
  post(b, { p: 2, type: 'away', target: 2, away: false });
  assert.equal(b.away[2], false); assert.equal(d.away[2], false);
  // a battle started while P3 is away is scaled for 2 players
  const s = gameInBattleN('trainer', 3, 'NAS');
  void s;
  // private phase: a sat-out player is done at once
  const p = gameInBattleN('trainer', 3, 'NAP');
  post(p, { p: 0, type: 'away', target: 2, away: true });
  for (const e of p.battle.enemies) e.hp = 1;
  let guard = 0;
  while (p.phase === 'battle' && guard++ < 30) for (const q of [0, 1]) { const dd = p.battle; if (!dd || dd.result || dd.out(q) || dd.locks[q]) continue; const slot = dd.field[0] !== null ? 0 : 1; const ids = bestHand(dd, q, slot); post(p, ids ? { p: q, type: 'lock', ids, target: slot } : { p: q, type: 'lock', pass: true }); }
  if (p.phase === 'private') assert.deepEqual(p.private.done, [false, false, true]);
});

t('N players: 3- and 4-player bot logs replay to identical checksums', () => {
  for (const n of [3, 4]) {
    const cks = [];
    const starters = ['BULBASAUR', 'CHARMANDER', 'SQUIRTLE', 'BULBASAUR'].slice(0, n);
    const { game, log } = playCoop({ seed: 'DETN' + n, starters, maxActions: 900, onAction: (a, ok, g) => cks.push(g.checksum()) });
    assert.ok(log.some(a => a.type === 'lock' && a.p === n - 1), `player ${n} plays`);
    assert.ok(log.some(a => a.type === 'privateDone'));
    const b = new CoopGame();
    log.forEach((a, i) => { b.apply(JSON.parse(JSON.stringify(a))); assert.equal(b.checksum(), cks[i], `${n}p: checksum differs after seq ${a.seq} (${a.type})`); });
    assert.equal(runsJSON(b), runsJSON(game));
  }
});

// ---- 3-4 players: races (the log order decides; every client replaying the same log agrees) ----
// The prefix log (init + votes) of an N-player game that is in a battle of this type; client(log) replays it.
function battleLogN(type, n, seed0) {
  for (let i = 0; i < 200; i++) {
    const g = CoopGame.fromInit(INITN(seed0 + i, n));
    const id = g.reachable().find(x => g.world.map.nodes[x].type === type);
    if (!id) continue;
    const log = [INITN(seed0 + i, n)];
    for (let p = 0; p < n && g.phase === 'map'; p++) { const a = { p, type: 'vote', node: id, seq: g.seq + 1, nonce: 'v' + p }; log.push(a); g.apply(JSON.parse(JSON.stringify(a))); }
    if (g.phase === 'battle') return log;
  }
  throw new Error('no ' + type + ' start node');
}
const client = (log) => { const g = new CoopGame(); for (const a of log) g.apply(JSON.parse(JSON.stringify(a))); return g; };
const perms = (xs) => (xs.length <= 1 ? [xs] : xs.flatMap((x, i) => perms([...xs.slice(0, i), ...xs.slice(i + 1)]).map(r => [x, ...r])));
const lockOf = (d, p, slot = 0) => { const ids = d.field[d.normSlot(slot)] !== null ? bestHand(d, p, slot) : null; return ids ? { p, type: 'lock', ids, target: slot } : { p, type: 'lock', pass: true }; };

t('4 players: UNLOCK races in every order: the turn resolves only if the last LOCK IN lands while everyone is still locked', () => {
  const base = battleLogN('trainer', 4, 'R4U');
  const g0 = client(base), d0 = g0.battle, t0 = d0.turn;
  const locks = [0, 1, 2].map(p => lockOf(d0, p, p % 2));
  const last = lockOf(d0, 3, 1);
  const race = { lock3: last, un0: { p: 0, type: 'unlock', turn: t0 }, un1: { p: 1, type: 'unlock', turn: t0 } };
  let seen = 0;
  for (const order of perms(Object.keys(race))) {
    const A = client(base), B = client(base);
    const log = [...locks, ...order.map(k => race[k])];
    const oks = [];
    for (const g of [A, B]) { oks.length = 0; for (const a of log) oks.push(post(g, a)); }
    assert.equal(A.checksum(), B.checksum(), `${order}: two clients agree`);
    const resolved = A.battle ? (A.battle.turn !== t0 || !!A.battle.result) : true;
    assert.equal(resolved, order[0] === 'lock3', `${order}: resolved iff the last lock comes first`);
    if (order[0] === 'lock3') assert.deepEqual(oks.slice(-2), [false, false], `${order}: both late unlocks refused`);
    else assert.ok(!A.battle.locks[0] || !A.battle.locks[1], `${order}: someone unlocked, the turn waits`);
    seen++;
  }
  assert.equal(seen, 6);
});

t('4 players: simultaneous LOCK INs in any order resolve the turn identically (lock order never matters)', () => {
  const base = battleLogN('trainer', 4, 'R4L');
  const g0 = client(base);
  const locks = [0, 1, 2, 3].map(p => lockOf(g0.battle, p, p % 2));
  const digests = new Set();
  for (const order of perms([0, 1, 2, 3])) {
    const g = client(base);
    for (const p of order) post(g, locks[p]);
    assert.ok(g.battle.turn > g0.battle.turn || g.battle.result, 'resolved');
    digests.add(digestNoSeq(g));
  }
  assert.equal(digests.size, 1, 'all 24 orders give the same state');
});

t('3-4 players: votes landing in any order: a majority wins regardless of order; ties agree on every client', () => {
  const { g, r } = twoNodes(3, 'RV3');
  const base = [INITN(g.seed, 3)];
  for (const order of perms([0, 1, 2])) {
    const c = client(base), plan = [r[0], r[0], r[1]];
    for (const p of order) post(c, { p, type: 'vote', node: plan[p] });
    assert.equal(c.world.nodeId, r[0], `${order}: two of three win`);
  }
  const f = twoNodes(4, 'RV4'), b4 = [INITN(f.g.seed, 4)];
  for (const order of perms([0, 1, 2, 3])) {
    const plan = [f.r[0], f.r[0], f.r[1], f.r[1]];
    const A = client(b4), B = client(b4);
    for (const p of order) { post(A, { p, type: 'vote', node: plan[p] }); post(B, { p, type: 'vote', node: plan[p] }); }
    assert.ok(A.lastVote.tie && [f.r[0], f.r[1]].includes(A.lastVote.picked), `${order}: 2-2 tie`);
    assert.equal(A.checksum(), B.checksum(), `${order}: same pick on both clients`);
  }
});

t('4 players: a downed partner revived with a REVIVE mid-battle is back in the fight; the turn then waits for them', () => {
  const base = battleLogN('trainer', 4, 'R4R');
  const mk = () => { const g = client(base); g.runs[0].addConsumable('REVIVE'); g.battle.playerDown(3); g.battle.takeEvents(); return g; };
  const A = mk(), B = mk();
  const uid = A.runs[3].party[0].uid;
  A.runs[3].party[0].hp = 0; B.runs[3].party[0].hp = 0;
  assert.ok(A.battle.down[3]);
  const t0 = A.battle.turn;
  const log = [{ p: 0, type: 'item', key: 'REVIVE', uid, toP: 3 }, ...[0, 1, 2].map(p => lockOf(A.battle, p))];
  for (const g of [A, B]) for (const a of log) post(g, a);
  assert.equal(A.battle.down[3], false, 'P4 is back');
  assert.ok(A.runs[3].party[0].hp > 0);
  assert.equal(A.battle.turn, t0, 'the turn now waits for P4 too');
  post(A, lockOf(A.battle, 3)); post(B, lockOf(B.battle, 3));
  assert.ok(A.battle.turn > t0 || A.battle.result);
  assert.equal(A.checksum(), B.checksum());
});

t('4 players: sat out mid-battle and back (REJOIN), with a reload replaying the whole log, every client agrees', () => {
  const base = battleLogN('trainer', 4, 'R4A');
  const A = client(base);
  const log = base.slice();
  const P = (a) => { const full = { ...a, seq: A.seq + 1, nonce: 'n' + (A.seq + 1) }; log.push(full); return A.apply(JSON.parse(JSON.stringify(full))); };
  const t0 = A.battle.turn;
  P({ p: 0, type: 'away', target: 3, away: true });
  for (const p of [0, 1, 2]) P(lockOf(A.battle, p));
  assert.ok(A.battle.turn > t0 || A.battle.result, 'resolves without the sat-out player');
  if (!A.battle.result) {
    P(lockOf(A.battle, 3)); // their next action brings them back (and is a legal lock)
    assert.equal(A.away[3], false);
    assert.equal(A.battle.away[3], false);
  }
  const R = client(log); // a reloaded client replays everything
  assert.equal(R.checksum(), A.checksum());
  assert.equal(runsJSON(R), runsJSON(A));
});

t('previews never change the state: a simulated hand restores the cards face-down / frozen flags (desync fix)', () => {
  // (v0.0.7 2-player bot run ID2 diverged from its own replay in a SABRINA fight: a previewed hand switched the lead
  // in its dry run, the dry draw marked draw-pile cards face down (PSYCHIC VEIL) and that leaked into the real piles.
  // Here the dry run flips the flags directly, the way any such effect would.)
  for (const n of [2, 4]) {
    const g = n === 2 ? gameInBattle('trainer', 'FD') : gameInBattleN('trainer', 4, 'FD4');
    const d = g.battle, s = d.subs[0];
    const ids = bestHand(d, 0, 0);
    const before = g.checksum();
    const orig = s.scoreHand;
    s.scoreHand = function (...a) { for (const c of this.deck.draw) c.faceDown = true; for (const c of this.deck.hand) { c.frozen = true; c.faceDown = true; } return orig.apply(this, a); };
    try { for (let k = 0; k < 3; k++) d.simulate(0, ids, 0); } finally { s.scoreHand = orig; }
    assert.ok(s.deck.draw.every(c => !c.faceDown) && s.deck.hand.every(c => !c.frozen), n + "p: flags restored");
    assert.equal(g.checksum(), before, n + "p: the checksum is unchanged by previews");
  }
});

t('3-4 players: a client that reloads mid-run (replays from scratch) and one that resyncs from the middle agree', () => {
  for (const n of [3, 4]) {
    const starters = ['SQUIRTLE', 'BULBASAUR', 'CHARMANDER', 'SQUIRTLE'].slice(0, n);
    const { game, log } = playCoop({ seed: 'RLD' + n, starters, maxActions: 700 });
    const half = client(log.slice(0, log.length >> 1));
    for (const a of log.slice(log.length >> 1)) half.apply(JSON.parse(JSON.stringify(a)));
    assert.equal(half.checksum(), game.checksum(), `${n}p: resumed client`);
    assert.equal(client(log).checksum(), game.checksum(), `${n}p: replayed client`);
  }
});

// ---- shared "?" events: both players see the same one ----
function gameAtEvent(seed0 = 'EV') {
  for (let i = 0; i < 300; i++) {
    const g = CoopGame.fromInit(INIT(seed0 + i));
    const id = g.reachable()[0];
    g.world.map.nodes[id].type = 'event'; // (floor 0 has no "?" nodes)
    // the two players have different histories: P1 saw two events, P2 has a bigger party
    g.runs[0].seenEvents = ['fossil', 'deleter@0'];
    g.runs[1].seenEvents = ['oldman'];
    const log = [{ p: 0, type: 'vote', node: id }, { p: 1, type: 'vote', node: id }];
    for (const a of log) post(g, a);
    if (g.phase === 'private' && g.private.kind === 'event') return { g, id };
  }
  throw new Error('no event start node');
}
t('co-op events: one shared event for both players, fixed when the phase opens', () => {
  const { g, id } = gameAtEvent();
  const se = g.sharedEvent;
  assert.ok(se && se.node === id && EVENTS.some(e => e.id === se.id), JSON.stringify(se));
  assert.ok(EVENTS.find(e => e.id === se.id).choices.some(c => !c.solo && !c.leave), 'something to do without a battle');
  assert.ok(!['fossil', 'deleter', 'oldman'].includes(se.id), 'not one either player has already seen');
  // same inputs, same pick (a second client computes the same)
  assert.equal(sharedEventId(g.world, g.runs, g.seed), se.id);
  // a partner finishing first (their snapshot adds the event to their seenEvents) doesn't change it
  g.runs[1].seenEvents = [...g.runs[1].seenEvents, se.id];
  assert.equal(g.sharedEvent.id, se.id);
  // it's derived state: not part of the checksummed digest (clients on the old rule stay in sync)
  assert.ok(!JSON.stringify(g.digest()).includes('sharedEvent'));
});
t('co-op events: the same event on two clients that replay the same log', () => {
  const a = CoopGame.fromInit(INIT('EVSYNC1')), b = CoopGame.fromInit(INIT('EVSYNC1'));
  const id = a.reachable().find(n => a.world.map.nodes[n].type === 'event') || a.reachable()[0];
  a.world.map.nodes[id].type = b.world.map.nodes[id].type = 'event';
  for (const g of [a, b]) { post(g, { p: 0, type: 'vote', node: id }); post(g, { p: 1, type: 'vote', node: id }); }
  assert.equal(a.phase, 'private');
  assert.deepEqual(a.sharedEvent, b.sharedEvent);
  assert.equal(a.checksum(), b.checksum());
});
t('co-op events: minParty events need both parties big enough', () => {
  const world = { world: 'kanto', actIndex: 2, nodeId: 'n1' };
  const big = { party: [1, 2, 3, 4, 5, 6], seenEvents: [] }, small = { party: [1], seenEvents: [] };
  for (let i = 0; i < 40; i++) {
    const id = sharedEventId({ ...world, nodeId: 'n' + i }, [big, small], 'MINP');
    const ev = EVENTS.find(e => e.id === id);
    assert.ok(!ev.minParty || ev.minParty <= 1, `${id} needs ${ev.minParty}`);
  }
});

// ---- v0.1.0 One Spire in co-op --------------------------------------------------------------------------
t('v0.1.0 spire rooms: the shared seed draws the regions; both runs copy them; legacy rooms keep their world', () => {
  const g = CoopGame.fromInit({ ...INIT('SPR1'), world: 'spire' });
  assert.equal(g.world.world, 'spire');
  assert.deepEqual(g.world.regions, Run.create({ seed: 'SPR1', world: 'spire', pool: ['kanto', 'hoenn'] }).regions, 'drawn from the shared seed');
  for (const r of g.runs) { assert.deepEqual(r.regions, g.world.regions); assert.equal(r.rival, g.world.rival); assert.equal(r.world, 'spire'); }
  assert.equal(g.world.rival, 'kanto', 'P1 has BULBASAUR: BLUE');
  const g2 = CoopGame.fromInit({ ...INIT('SPR1', ['TORCHIC', 'CHARMANDER']), world: 'spire' });
  assert.equal(g2.world.rival, 'hoenn', 'P1 has TORCHIC: MAY');
  const k = CoopGame.fromInit({ ...INIT('SPR2'), world: 'spire_kanto' });
  assert.deepEqual(k.world.regions.acts, ['kanto', 'kanto', 'kanto', 'kanto']);
  const old = CoopGame.fromInit({ ...INIT('SPR3'), world: 'hoenn' });
  assert.equal(old.world.world, 'hoenn'); assert.ok(!old.world.regions); assert.equal(old.world.act.region, 'hoenn');
});

t('v0.1.0 determinism across mixed regions: a bot run into a second region replays to identical checksums', () => {
  let done = null;
  for (let i = 0; i < 12 && !done; i++) {
    const seed = 'MIXD' + i;
    const sp = Run.create({ seed, world: 'spire', pool: ['kanto', 'hoenn'] }).regions;
    if (sp.acts[0] === sp.acts[1]) continue;
    const cks = [];
    const { game, log } = playCoop({ seed, world: 'spire', onAction: (a, ok, gm) => cks.push(gm.checksum()) });
    if (game.world.actIndex < 1 && game.phase !== 'victory') continue;
    done = { game, log, cks, sp };
  }
  assert.ok(done, 'a run reached a second region');
  const { game, log, cks, sp } = done;
  assert.notEqual(sp.acts[0], sp.acts[1]);
  const b = new CoopGame();
  log.forEach((a, i) => { b.apply(JSON.parse(JSON.stringify(a))); assert.equal(b.checksum(), cks[i], `checksum differs after seq ${a.seq} (${a.type})`); });
  assert.equal(runsJSON(b), runsJSON(game));
  // the act regions really changed on the way, and every shared event matched its act's region
  assert.equal(game.world.acts[1].region, sp.acts[1]);
});

t('v0.1.0 co-op shared events follow the act region (same pick on both clients)', () => {
  const g = CoopGame.fromInit({ ...INIT('SPEV'), world: 'spire' });
  const w = g.world;
  for (let a = 0; a < 4; a++) {
    w.startAct(a); g.mirror();
    for (let i = 0; i < 20; i++) {
      w.nodeId = 'n' + i; w.floor = 6;
      const id = sharedEventId(w, g.runs, 'SPEV'), id2 = sharedEventId(w, g.runs.map(r => Run.fromJSON(JSON.parse(JSON.stringify(r)))), 'SPEV');
      assert.equal(id, id2);
      const ev = EVENTS.find(e => e.id === id);
      assert.ok(ev.shrine || ev.world === w.region || ev.follows, `${id} in a ${w.region} act`);
    }
  }
});

// ---- v0.1.1 JOHTO in co-op ------------------------------------------------------------------------------
t('v0.1.1 spire_johto rooms: the shared seed draws from KANTO + HOENN + JOHTO; both runs copy it; SILVER for a JOHTO P1', () => {
  let seed = null;
  for (let i = 0; i < 50 && !seed; i++) if (Run.create({ seed: 'SPJ' + i, world: 'spire', pool: ['kanto', 'hoenn', 'johto'] }).regions.acts.includes('johto')) seed = 'SPJ' + i;
  const g = CoopGame.fromInit({ ...INIT(seed, ['CHIKORITA', 'CHARMANDER']), world: 'spire_johto' });
  assert.equal(g.world.world, 'spire'); assert.equal(g.worldName, 'spire');
  assert.deepEqual(g.world.regions, Run.create({ seed, world: 'spire', pool: ['kanto', 'hoenn', 'johto'] }).regions);
  assert.ok(g.world.regions.acts.includes('johto'));
  for (const r of g.runs) { assert.deepEqual(r.regions, g.world.regions); assert.equal(r.rival, 'johto'); }
  // the same seed in a 'spire' room never draws JOHTO
  for (let i = 0; i < 40; i++) assert.ok(!CoopGame.fromInit({ ...INIT('SPK' + i), world: 'spire' }).world.regions.acts.includes('johto'));
});

t('v0.1.1 determinism across K-J-H-J: two clients on the same log agree after every action, and the bots replay it', () => {
  const seeds = [];
  for (let i = 0; i < 4000 && seeds.length < 6; i++) if (Run.create({ seed: 'KJHJ' + i, world: 'spire', pool: ['kanto', 'hoenn', 'johto'] }).regions.acts.join() === 'kanto,johto,hoenn,johto') seeds.push('KJHJ' + i);
  assert.ok(seeds.length, 'a K-J-H-J seed');
  let done = null;
  for (const seed of seeds) {
    const cks = [];
    const play = (out = cks) => playCoop({ seed, world: 'spire_johto', starters: ['TOTODILE', 'BULBASAUR'], stopWhen: (gm) => gm.world.actIndex >= 2, onAction: (a, ok, gm) => out.push(gm.checksum()) });
    const { game, log } = play();
    if (game.world.actIndex < 1) continue;
    done = { seed, game, log, cks, play };
    break;
  }
  assert.ok(done, 'a co-op run reached the JOHTO act 2');
  const { game, log, cks, play } = done;
  assert.equal(game.world.acts[1].region, 'johto'); assert.equal(game.world.rival, 'johto');
  // clients B and C replay the log from scratch (like two players' browsers)
  const b = new CoopGame(), c = new CoopGame();
  log.forEach((a, i) => {
    b.apply(JSON.parse(JSON.stringify(a))); c.apply(JSON.parse(JSON.stringify(a)));
    assert.equal(b.checksum(), cks[i], `B differs after seq ${a.seq} (${a.type})`);
    assert.equal(c.checksum(), cks[i], `C differs after seq ${a.seq} (${a.type})`);
  });
  assert.equal(runsJSON(b), runsJSON(game)); assert.equal(digestNoSeq(c), digestNoSeq(game));
  // the bots + engine play the same seed again: same actions, same checksum after every one (the logs differ only in
  // the wall-clock stats.startTime inside privateDone snapshots)
  const cks2 = [], again = play(cks2);
  assert.deepEqual(again.log.map(a => a.type + (a.p ?? '')), log.map(a => a.type + (a.p ?? '')));
  assert.deepEqual(cks2, cks);
});

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
