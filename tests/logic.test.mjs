// Logic tests: node tests/logic.test.mjs
import fs from 'fs';
import assert from 'assert/strict';
import { loadData, D, typeEffect, gen3Damage, expForLevel, calcStat, isSpecialMove } from '../web/src/game/data.js';
import { GEN4_MOVES } from '../web/src/game/gen4_moves.js';
import { SPECIAL_MOVES, PHYSICAL_MOVES } from '../web/src/game/move_categories.js';
import { EFFECTS } from '../web/src/game/effects.js';
import { detectCombo, comboBonus } from '../web/src/game/hands.js';
import { Run, movePool, MOVE_POOL, FALLBACK_MOVES } from '../web/src/game/run.js';
import { Battle, makeEnemy, isSelfKO, SELF_KO_HP, withoutSelfKO } from '../web/src/game/battle.js';
import { makeMon, maxHp, gainExp, defaultMoves, canLearn, defaultCopies, replacedCopies, DECK_RULES, NO_PLAYER_MOVES, movesLearnedAt } from '../web/src/game/pokemon.js';
import { generateMap, reachable } from '../web/src/game/map.js';
import { ACTS, STARTERS, GEN3_TYPES, BIRDS, LEGENDS, BIRD_PARTNER, counterStarter } from '../web/src/game/acts.js';
import { NUZLOCKE_ASC, ASCENSIONS, MAX_ASCENSION, TUNING } from '../web/src/game/run.js';
import { unlockShiny, shinyUnlocked } from '../web/src/game/state.js';
import { HOENN_ACTS } from '../web/src/game/hoenn.js';
import { RNG } from '../web/src/game/rng.js';
import { RELICS, BADGES, CONSUMABLES } from '../web/src/game/items.js';
import { generateShop, buyItem } from '../web/src/game/shop.js';
import { EVENTS } from '../web/src/game/events.js';
import { bossTypes, bossTypeLabel, BOSS_TYPES } from '../web/src/game/bosses.js';
import * as U from '../web/src/game/unlocks.js';
import { pickHandAnim, resolveAnimMove, GEN4_ANIM, orderTurnEvents } from '../web/src/anim/pick.js';

await loadData(async f => JSON.parse(fs.readFileSync('web/assets/data/' + f, 'utf8')));
let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.log('FAIL', name, '-', e.message); } };

t('data counts', () => { assert.equal(Object.keys(D.species).length, 386); assert.ok(Object.keys(D.moves).length >= 354); });
t('type chart', () => { assert.equal(typeEffect('WATER', ['FIRE']), 2); assert.equal(typeEffect('ELECTRIC', ['GROUND']), 0); assert.equal(typeEffect('GRASS', ['FIRE', 'FLYING']), 0.25); assert.equal(typeEffect('NORMAL', ['GHOST']), 0); });
t('stat formula', () => { assert.equal(calcStat(39, 31, 50, true), 39 * 2 + 31 > 0 ? Math.floor((78 + 31) * 50 / 100) + 60 : 0); });
t('exp curves', () => { assert.equal(expForLevel('MEDIUM_FAST', 10), 1000); assert.equal(expForLevel('FAST', 10), 800); assert.equal(expForLevel('MEDIUM_SLOW', 100), 1059860); });
t('gen3 damage sane', () => { const d = gen3Damage({ level: 10, power: 40, atk: 20, def: 20, stab: true, effect: 2, physical: true }); assert.ok(d > 5 && d < 40, d); });

const card = (move, type, owner, status = false) => ({ move, type, owner, status, value: 50 });
t('combo: pair (same type)', () => assert.equal(detectCombo([card('EMBER', 'FIRE', 1), card('FLAME_WHEEL', 'FIRE', 2)]).key, 'PAIR'));
t('combo: normal cards rank like any type', () => assert.equal(detectCombo([card('TACKLE', 'NORMAL', 1), card('TACKLE', 'NORMAL', 1), card('SCRATCH', 'NORMAL', 1)]).key, 'TRIPLE'));
t('combo: support only', () => assert.equal(detectCombo([card('GROWL', 'NORMAL', 1, true)]).key, 'SUPPORT'));
t('combo: status cards excluded', () => assert.equal(detectCombo([card('EMBER', 'FIRE', 1), card('GROWL', 'NORMAL', 1, true), card('GROWL', 'NORMAL', 1, true)]).key, 'SINGLE'));
t('combo: two pair', () => assert.equal(detectCombo([card('A', 'FIRE', 1), card('C', 'FIRE', 1), card('B', 'WATER', 2), card('D', 'WATER', 2)]).key, 'TWO_PAIR'));
t('combo: penta', () => assert.equal(detectCombo(['A', 'B', 'C', 'D', 'E'].map((m, i) => card(m, 'FIRE', i % 2))).key, 'PENTA'));
t('combo: coverage', () => assert.equal(detectCombo(['FIRE', 'WATER', 'GRASS', 'ROCK', 'ICE'].map((ty, i) => card('M' + i, ty, i % 2))).key, 'COVERAGE'));
t('combo: coverage = 4 types', () => { assert.equal(detectCombo(['FIRE', 'WATER', 'GRASS', 'ROCK'].map((ty, i) => card('M' + i, ty, 1))).key, 'COVERAGE'); assert.equal(detectCombo(['FIRE', 'WATER', 'GRASS'].map((ty, i) => card('M' + i, ty, 1))).key, 'SINGLE'); });
t('combo: full house', () => assert.equal(detectCombo([card('A', 'FIRE', 1), card('A', 'FIRE', 1), card('E', 'FIRE', 2), card('B', 'WATER', 1), card('C', 'WATER', 1)]).key, 'FULL_HOUSE'));
t('combo: quad', () => assert.equal(detectCombo([1, 2, 3, 4].map(i => card('M' + i, 'ROCK', i))).key, 'QUAD'));
t('combo levels scale', () => { assert.ok(comboBonus('PAIR', 3) > comboBonus('PAIR', 1)); assert.ok(comboBonus('PENTA') > comboBonus('QUAD') && comboBonus('QUAD') > comboBonus('TRIPLE') && comboBonus('TRIPLE') > comboBonus('PAIR')); });

// ---- DMG system: a hand simply deals damage
const dmgBattle = () => {
  const run = Run.create({ starter: 'CHARMANDER', seed: 'dmg' });
  const b = new Battle(run, run.battleConfig({ id: 'w', floor: 3, type: 'wild' }));
  b.start();
  const lead = b.lead(), e = b.enemy();
  b.deck.hand.push({ id: 9001, uid: lead.uid, move: 'TACKLE' }, { id: 9002, uid: lead.uid, move: 'TACKLE' }, { id: 9003, uid: lead.uid, move: 'EMBER' });
  return { run, b, lead, e };
};
t('DMG: a card deals Gen 3 damage (level, power, ATK/DEF, STAB, type)', () => {
  const { b, lead, e } = dmgBattle();
  for (const move of ['TACKLE', 'EMBER']) {
    const m = D.moves[move], phys = !['FIRE', 'WATER', 'GRASS', 'ELECTRIC', 'ICE', 'PSYCHIC', 'DRAGON', 'DARK'].includes(m.type);
    const st = lead.ivs ? b.statsOf('player', lead) : null;
    const core = ((Math.floor(2 * lead.level / 5) + 2) * m.power * (phys ? st.atk : st.spa) / (phys ? e.stats.def : e.stats.spd)) / 50 + 2;
    const want = Math.round(core * (lead.species === 'CHARMANDER' && m.type === 'FIRE' ? 1.5 : 1) * typeEffect(m.type, e.types));
    const info = b.cardInfo(b.deck.hand.find(c => c.move === move));
    assert.equal(info.dmgPreview, want, move);
  }
});
t('DMG: hand damage = card damage x (1 + combo bonus)', () => {
  const { b } = dmgBattle();
  const d = b.cardInfo(b.deck.hand.find(c => c.id === 9001)).dmgPreview;
  const sim = b.simulate([9001, 9002]);
  assert.equal(sim.key, 'PAIR');
  assert.equal(sim.damage, Math.floor(2 * d * (1 + comboBonus('PAIR') / 100)));
  assert.equal(b.simulate([9001]).damage, d);
});
t('DMG: item bonuses add up with the combo bonus (no compounding)', () => {
  const { run, b } = dmgBattle();
  const d = b.cardInfo(b.deck.hand.find(c => c.id === 9001)).dmgPreview;
  run.badges.push('MARSH'); run.relics.push({ key: 'CHOICE_BAND', state: {} });
  assert.equal(b.simulate([9001, 9002]).damage, Math.floor(2 * d * (1 + (comboBonus('PAIR') + 40 + 120) / 100)));
  run.relics.push({ key: 'SILK_SCARF', state: {} });
  // (d is already rounded, so allow 1 point of rounding difference)
  assert.ok(Math.abs(b.cardInfo(b.deck.hand.find(c => c.id === 9001)).dmgPreview - d * 1.3) <= 1);
});
t('DMG: enemy HP is on the same scale as the player', () => { // (bounds x1.4 since the discard update's tougher foes)
  for (const world of ['kanto', 'hoenn']) {
    const run = Run.create({ starter: world === 'hoenn' ? 'MUDKIP' : 'BULBASAUR', seed: 'hp' + world, world });
    for (const kind of ['wild', 'trainer', 'boss']) {
      const cfg = run.battleConfig({ id: 'h' + kind, floor: 4, type: kind });
      const k = (TUNING.hpMult ?? 1) / 1.62; // (bounds set at hpMult 1.62)
      for (const e of cfg.enemies) assert.ok(e.maxHp < 8.5 * k * e.realMaxHp && e.maxHp < 560 * k, `${world} ${kind} ${e.species} ${e.maxHp}`);
    }
  }
});
t('DMG: no chips or mult language in items and badges', () => {
  for (const r of [...Object.values(RELICS), ...Object.values(BADGES)]) assert.ok(!/chips|mult/i.test(r.desc), r.key + ': ' + r.desc);
});


t('maps: every node reaches the boss', () => {
  for (const act of [...ACTS, ...HOENN_ACTS]) for (let s = 0; s < 20; s++) {
    const m = generateMap(new RNG('m' + s + act.id), act, 0);
    const seen = new Set(); const stack = [...m.start];
    while (stack.length) { const id = stack.pop(); if (seen.has(id)) continue; seen.add(id); stack.push(...m.nodes[id].next); }
    assert.ok(seen.has('boss'), 'boss unreachable');
    for (const n of Object.values(m.nodes)) if (n.id !== 'boss') assert.ok(n.next.length > 0, 'dead end ' + n.id);
  }
});

t('run creation & battle flow', () => {
  for (const world of ['kanto', 'hoenn']) {
    const run = Run.create({ starter: world === 'hoenn' ? 'MUDKIP' : 'BULBASAUR', seed: 'T' + world, world });
    for (const kind of ['wild', 'trainer', 'elite', 'boss']) {
      const cfg = run.battleConfig({ id: 'x' + kind, floor: 5, type: kind });
      const b = new Battle(run, cfg);
      b.start();
      let guard = 0;
      while (!b.result && guard++ < 300) {
        const ids = b.deck.hand.filter(c => b.cardInfo(c).playable).slice(0, 2).map(c => c.id);
        if (!ids.length) { b.pass(); continue; }
        b.play(ids);
      }
      assert.ok(b.result, `${world} ${kind} battle ended`);
      for (const m of run.party) { m.hp = 999; m.hp = Math.min(m.hp, 999); }
      run.party.forEach(m => { m.status = null; m.hp = 1 + m.hp % 1000; });
    }
  }
});

t('per-POKéMON decks: catching adds nothing, switching swaps the hand', () => {
  const run = Run.create({ starter: 'CHARMANDER', seed: 'decks' });
  run.party.push(makeMon('PIDGEY', 6, { rng: new RNG('p') }));
  const b = new Battle(run, run.battleConfig({ id: 'd1', floor: 2, type: 'wild' }));
  b.start();
  const [a, c] = run.party;
  assert.ok(b.deck.hand.length > 0 && b.deck.hand.every(x => x.uid === a.uid), 'hand is the lead only');
  const size = x => x.moves.reduce((n, m) => n + (m.copies || 1), 0);
  assert.equal(b.deckSize(), size(a));
  b.switchLead(c.uid);
  assert.ok(b.deck.hand.length > 0 && b.deck.hand.every(x => x.uid === c.uid), 'switch brings the new lead cards');
  assert.equal(b.pileOf(a.uid).hand.length, 0);
  assert.equal(b.pileOf(a.uid).draw.length + b.pileOf(a.uid).discard.length, size(a));
});

t('PP decks: copies follow PP', () => {
  assert.equal(defaultCopies('TACKLE'), 5); // 35 PP
  assert.equal(defaultCopies('EMBER'), 4); // 25 PP
  assert.equal(defaultCopies('FLAMETHROWER'), 3); // 15 PP
  assert.equal(defaultCopies('HYDRO_PUMP'), 2); // 5 PP (min 2)
  assert.equal(defaultCopies('GROWL'), 2); // status, 40 PP
  assert.equal(defaultCopies('LEECH_SEED'), 1); // status, 10 PP
  const run = Run.create({ starter: 'CHARMANDER', seed: 'pp' });
  assert.equal(run.party[0].moves.find(m => m.move === 'EMBER').copies, 4 + DECK_RULES.starterBonus);
  // a move learned over another keeps the old move's extra (PP UP) copies
  assert.equal(replacedCopies({ move: 'TACKLE', copies: 6 }, 'FLAMETHROWER'), 4);
  assert.equal(replacedCopies({ move: 'GROWL', copies: 2 }, 'FLAMETHROWER'), 3);
});

t('free discard: once per turn, up to the limit, then it costs a discard', () => {
  const run = Run.create({ starter: 'BULBASAUR', seed: 'free' });
  const b = new Battle(run, run.battleConfig({ id: 'f1', floor: 2, type: 'wild' }));
  b.start();
  const left = b.discardsLeft, n = DECK_RULES.freeDiscard;
  assert.ok(n > 0 && b.freeDiscardOk(n) && !b.freeDiscardOk(n + 1));
  b.discard(b.deck.hand.slice(0, n).map(c => c.id));
  assert.equal(b.discardsLeft, left, 'the first small discard is free');
  assert.equal(b.deck.hand.length, b.handSize, 'refilled');
  assert.ok(!b.freeDiscardOk(1), 'only once per turn');
  b.discard(b.deck.hand.slice(0, 1).map(c => c.id));
  assert.equal(b.discardsLeft, left - 1, 'the second one costs a discard');
});

t('exp and evolution', () => {
  const m = makeMon('CHARMANDER', 15, { rng: new RNG('e') });
  const ev = gainExp(m, 5000);
  assert.ok(ev.some(e => e.type === 'evolve' && e.into === 'CHARMELEON'));
});
t('default moves', () => assert.ok(defaultMoves('PIKACHU', 20).includes('THUNDER_SHOCK') || defaultMoves('PIKACHU', 20).length === 4));
t('gen 4 moves: known species learn them', () => {
  const lv = (sp, mv) => D.species[sp].learnset.find(([, m]) => m === mv)?.[0];
  assert.equal(lv('CHARMELEON', 'FIRE_FANG'), 28);
  assert.equal(lv('CHARIZARD', 'FIRE_FANG'), 28);
  assert.equal(lv('GENGAR', 'DARK_PULSE'), 44);
  assert.equal(lv('SCYTHER', 'X_SCISSOR'), 41);
  assert.ok(D.species.GENGAR.tmhm.includes('SHADOW_CLAW'));
  assert.ok(canLearn('MACHAMP', 'STONE_EDGE') && canLearn('MACHOKE', 'VACUUM_WAVE') && canLearn('SNORLAX', 'ZEN_HEADBUTT'));
  assert.ok(!canLearn('MAGIKARP', 'AQUA_TAIL'));
  for (const s of Object.values(D.species)) for (let i = 1; i < s.learnset.length; i++) assert.ok(s.learnset[i - 1][0] <= s.learnset[i][0], 'learnset sorted ' + s.key);
  const g = defaultMoves('GYARADOS', 35);
  assert.ok(g.includes('AQUA_TAIL') && g.includes('ICE_FANG'), g.join());
  assert.deepEqual(defaultMoves('CHARMANDER', 5), ['SCRATCH', 'GROWL']); // FireRed's early moves untouched
});
t('gen 4 moves: data, categories and effects', () => {
  const g4 = Object.values(D.moves).filter(m => m.gen === 4);
  assert.equal(g4.length, Object.keys(GEN4_MOVES).length);
  for (const m of g4) {
    assert.ok(EFFECTS[m.effect], 'effect ' + m.key);
    assert.ok(m.name.length <= 12, 'name ' + m.name);
    if (m.power) assert.ok(SPECIAL_MOVES.has(m.key) !== PHYSICAL_MOVES.has(m.key), 'category ' + m.key);
  }
  assert.ok(isSpecialMove('DARK_PULSE', 'DARK') && !isSpecialMove('SHADOW_CLAW', 'GHOST') && !isSpecialMove('FIRE_FANG', 'FIRE'));
  assert.equal(D.moves.BULLET_PUNCH.priority, 1);
});
t('gen 4 moves: offered as rewards', () => {
  const run = Run.create({ starter: 'CHARMANDER', seed: 'g4r' });
  run.party[0] = makeMon('CHARMELEON', 25, { rng: run.rng });
  const seen = new Set();
  for (let i = 0; i < 200; i++) for (const c of run.moveRewardChoices(new RNG('r' + i))) seen.add(c.move);
  assert.ok(seen.has('FIRE_FANG') && seen.has('SHADOW_CLAW'), [...seen].join());
});
t('move rewards: offers are recorded per mon and survive a save', () => {
  const run = Run.create({ starter: 'CHARMANDER', seed: 'mo1' });
  assert.deepEqual(run.toJSON().moveOffers, {}, 'every new run has the field (saves keep their keys on reload)');
  const uid = run.party[0].uid;
  const a = run.moveRewardChoices(new RNG('mo1a'));
  assert.ok(a.length);
  for (const c of a) assert.equal(run.moveOfferCount(c.uid, c.move), 1);
  const r2 = Run.fromJSON(JSON.parse(JSON.stringify(run)));
  for (const c of a) assert.equal(r2.moveOfferCount(c.uid, c.move), 1);
  r2.moveRewardChoices(new RNG('mo1b'));
  const total = Object.values(r2.moveOffers[uid]).reduce((x, y) => x + y, 0);
  assert.equal(total, a.length * 2);
});
t('move rewards: an old save without moveOffers (or with junk) loads and works', () => {
  const run = Run.create({ starter: 'BULBASAUR', seed: 'mo2' });
  const o = JSON.parse(JSON.stringify(run));
  delete o.moveOffers;
  const r = Run.fromJSON(o);
  assert.deepEqual(r.moveOffers, {}, 'upgradeJSON default');
  assert.ok(r.moveRewardChoices(new RNG('mo2a')).length);
  assert.ok(r.moveOffers && typeof r.moveOffers === 'object');
  for (const junk of [[1, 2], 'x', 5, null]) {
    const j = Run.fromJSON({ ...JSON.parse(JSON.stringify(run)), moveOffers: junk });
    assert.ok(j.moveOffers && typeof j.moveOffers === 'object' && !Array.isArray(j.moveOffers), 'sanitized ' + JSON.stringify(junk));
    assert.ok(j.moveRewardChoices(new RNG('mo2b')).length);
  }
  const k = Run.fromJSON({ ...JSON.parse(JSON.stringify(run)), moveOffers: { [run.party[0].uid]: 'bad' } });
  assert.ok(k.moveRewardChoices(new RNG('mo2c')).length);
});
t('move rewards: a seen move recurs less for the same mon', () => {
  // over 40 reward screens for one mon: how often the most-offered move came up, and repeats in the first 10
  const stats = (track, sp, seed) => {
    const run = Run.create({ starter: 'CHARMANDER', seed });
    run.party = [makeMon(sp, 25, { rng: new RNG(seed + 'm') })];
    const seen = new Set(), cnt = {};
    let early = 0;
    for (let i = 0; i < 40; i++) {
      if (!track) delete run.moveOffers;
      for (const c of run.moveRewardChoices(new RNG(seed + 'r' + i))) { if (i < 10 && seen.has(c.move)) early++; seen.add(c.move); cnt[c.move] = (cnt[c.move] || 0) + 1; }
    }
    return { top: Math.max(...Object.values(cnt)), early };
  };
  let off = { top: 0, early: 0 }, on = { top: 0, early: 0 };
  for (const [sp, seed] of [['CHARMELEON', 'mo3a'], ['PIKACHU', 'mo3b'], ['GEODUDE', 'mo3c'], ['MAGIKARP', 'mo3d']]) {
    const a = stats(false, sp, seed), b = stats(true, sp, seed);
    off.top += a.top; off.early += a.early; on.top += b.top; on.early += b.early;
  }
  assert.ok(on.top < off.top * 0.75, `most-offered move: ${on.top} with tracking vs ${off.top} without`);
  assert.ok(on.early < off.early, `early repeats: ${on.early} with tracking vs ${off.early} without`);
});
t('move rewards: thin species get a decent pool; caps and gates hold', () => {
  for (const k of ['MAGIKARP', 'DITTO', 'UNOWN', 'SMEARGLE', 'METAPOD', 'KAKUNA', 'WOBBUFFET', 'BELDUM']) {
    assert.ok(movePool(makeMon(k, 10, { rng: new RNG(k) }), 0).length >= 6, 'act 1 pool ' + k);
    assert.ok(movePool(makeMon(k, 30, { rng: new RNG(k) }), 1).length >= 8, 'act 2 pool ' + k);
  }
  for (const [t, list] of Object.entries(FALLBACK_MOVES)) for (const m of list) {
    assert.ok(D.moves[m], 'fallback move exists ' + m);
    assert.ok(EFFECTS[D.moves[m].effect], 'fallback effect ' + m);
    assert.ok(D.moves[m].power === 0 || D.moves[m].power >= 10, 'fixed power ' + m);
  }
  for (const k of Object.keys(D.species)) for (const [lv, act] of [[8, 0], [25, 1], [45, 2], [60, 3]]) {
    const mon = makeMon(k, lv, { rng: new RNG(k + lv) });
    const pool = movePool(mon, act);
    for (const { move } of pool) {
      assert.ok(!(D.moves[move].power > MOVE_POOL.maxPower[act]), `${k} ${move} over the act ${act + 1} cap`);
      assert.ok(act >= 2 || !MOVE_POOL.lateMoves.includes(move), `${k} ${move} too early`);
      assert.ok(!mon.moves.some(x => x.move === move), `${k} offered known ${move}`);
    }
    assert.equal(new Set(pool.map(x => x.move)).size, pool.length, 'no duplicates ' + k);
  }
  // the reward choices respect the cap too
  const run = Run.create({ starter: 'SQUIRTLE', seed: 'mo4' });
  run.party = [makeMon('MAGIKARP', 12, { rng: run.rng }), makeMon('DITTO', 12, { rng: run.rng })];
  for (let i = 0; i < 50; i++) for (const c of run.moveRewardChoices(new RNG('mo4' + i))) assert.ok(!(D.moves[c.move].power > 70), c.move);
});
t('gen 4 moves: every move works as a card and as an enemy move', () => {
  for (const m of Object.values(D.moves).filter(x => x.gen === 4)) {
    const run = Run.create({ starter: 'CHARMANDER', seed: 'g4b' + m.key });
    run.party[0] = makeMon('CHARIZARD', 40, { rng: run.rng, moves: [m.key] });
    const b = new Battle(run, run.battleConfig({ id: 'g4' + m.key, floor: 5, type: 'trainer' }));
    b.start();
    b.enemy().moves = [m.key];
    b.chooseIntent();
    let guard = 0;
    while (!b.result && guard++ < 30) {
      const ids = b.deck.hand.filter(c => b.cardInfo(c).playable).slice(0, 2).map(c => c.id);
      if (!ids.length) { b.pass(); continue; }
      b.simulate(ids);
      b.play(ids);
    }
  }
});
t('gen 4 moves: SUCKER PUNCH fails against a status intent', () => {
  const run = Run.create({ starter: 'CHARMANDER', seed: 'g4s' });
  run.party[0] = makeMon('GENGAR', 40, { rng: run.rng, moves: ['SUCKER_PUNCH'] });
  const b = new Battle(run, run.battleConfig({ id: 'g4s', floor: 5, type: 'wild' }));
  b.start();
  const ids = [b.deck.hand[0].id];
  b.intent = { move: D.moves.GROWL }; const miss = b.simulate(ids).damage;
  b.intent = { move: D.moves.TACKLE }; const hit = b.simulate(ids).damage;
  assert.ok(miss <= 20 && hit > 3 * miss, `${miss} vs ${hit}`); // a failed card deals no damage
});
t('relic items exist', () => { for (const k of Object.keys(RELICS)) assert.ok(D.items[k], 'missing item ' + k); });
t('consumable items exist', () => { for (const k of Object.keys(CONSUMABLES)) assert.ok(D.items[k], 'missing item ' + k); });
t('shop generates', () => { const run = Run.create({ seed: 'S' }); const s = generateShop(run, new RNG('s')); assert.ok(s.items.length > 8); });
t('save/load roundtrip', () => {
  const run = Run.create({ seed: 'R' });
  const o = JSON.parse(JSON.stringify(run));
  const r2 = Run.fromJSON(o);
  assert.equal(r2.party[0].species, run.party[0].species);
  assert.equal(r2.rng.next(), run.rng.next());
});

// ---- v0.0.6: legendary birds, rivals, Nuzlocke, shinies, starters ----------------------------------
const actMap = (world, a, seed = 'B') => { const r = Run.create({ seed, world }); r.startAct(a); return r; };
t('birds: one optional legendary node per act 2-4, linked into the map', () => {
  for (const world of ['kanto', 'hoenn']) for (let i = 0; i < 20; i++) for (let a = 0; a < 4; a++) {
    const r = actMap(world, a, 'BIRD' + i);
    const L = Object.values(r.map.nodes).filter(n => n.type === 'legend');
    if (!r.act.bird) { assert.equal(L.length, 0); continue; }
    assert.equal(L.length, 1, `${world} act ${a + 1}`);
    assert.ok(L[0].prev.length && L[0].next.length, 'reachable and leads on');
    for (const id of L[0].prev) assert.ok(r.map.nodes[id].next.includes(L[0].id));
    assert.equal(L[0].legend, r.act.bird);
  }
  assert.deepEqual([1, 2, 3].map(a => ACTS[a].bird), ['LEGEND_ZAPDOS', 'LEGEND_ARTICUNO', 'LEGEND_MOLTRES']);
  assert.deepEqual([1, 2, 3].map(a => HOENN_ACTS[a].bird), ['LEGEND_REGIROCK', 'LEGEND_REGICE', 'LEGEND_REGISTEEL']);
  for (const acts of [ACTS, HOENN_ACTS]) for (const act of acts) for (const k of act.elites || []) assert.ok((act.postgame || !BIRDS[k]) && !/^RIVAL_|^MAY/.test(k), 'birds and rivals left the elite pools: ' + k); // (v0.1.1: the SEVII beasts are JOHTO's bird nodes too)
});
t('birds: tougher than an elite, unique held item, no balls', () => {
  const r = actMap('kanto', 1);
  const node = Object.values(r.map.nodes).find(n => n.type === 'legend');
  const cfg = r.battleConfig(node);
  assert.equal(cfg.enemies[0].species, 'ZAPDOS');
  assert.equal(cfg.rewardRelic, 'THUNDER_FEATHER');
  assert.ok(RELICS.THUNDER_FEATHER.unique && D.items.THUNDER_FEATHER?.name === 'THUNDER FEATHER');
  assert.ok(cfg.enemies[0].level > r.levelFor(node.floor) + 2);
  const elite = r.eliteConfig(r.rng.fork('e'), node.floor);
  const eliteHp = elite.enemies.reduce((a, e) => a + e.maxHp, 0);
  assert.ok(cfg.enemies[0].maxHp > 0.4 * eliteHp, 'one legendary carries a big share of an elite team\'s HP');
  const b = new Battle(r, cfg); b.start();
  r.balls.POKE_BALL = 5; b.throwBall('POKE_BALL');
  assert.equal(r.balls.POKE_BALL, 5, 'no balls at a legendary node'); assert.ok(!b.canFlee());
  // unique items never show up in random choices
  for (let i = 0; i < 30; i++) for (const k of r.relicChoices(new RNG('rc' + i), 6, { common: 0, uncommon: 0, rare: 1 })) assert.ok(!RELICS[k].unique, k);
  for (const k of Object.values(BIRDS).map(x => x.item)) assert.ok(RELICS[k]?.unique && RELICS[k].desc, k);
});
t('birds: one-time catch at a sensible level with its own deck', () => {
  const r = actMap('kanto', 2);
  r.party[0].level = 30;
  const node = Object.values(r.map.nodes).find(n => n.type === 'legend');
  const cfg = r.battleConfig(node);
  const mon = r.legendCatch(cfg);
  assert.equal(mon.species, 'ARTICUNO');
  assert.ok(mon.level <= 30 && mon.level <= cfg.enemies[0].level);
  assert.deepEqual(mon.moves.map(m => m.move), BIRDS.LEGEND_ARTICUNO.moves.filter(m => D.moves[m]));
  assert.ok(r.takeLegend(mon, true));
  assert.equal(r.legendCatch(cfg), null, 'only once');
  assert.equal(r.battleConfig(node).catchOffer, null, 'no second offer this run');
  const r2 = actMap('kanto', 2); const m2 = r2.legendCatch(r2.battleConfig(Object.values(r2.map.nodes).find(n => n.type === 'legend')));
  r2.takeLegend(m2, false);
  assert.ok(r2.legendsCaught.includes('ARTICUNO'), 'turning it down uses the offer up');
});
t('v0.3.11: legendaries, bosses and elites never self-KO; other foes only when nearly beaten', () => {
  // the legendary node's REGIROCK (it learns EXPLOSION at Lv1) gets its next-latest move instead
  const r = actMap('hoenn', 1);
  const cfg = r.battleConfig(Object.values(r.map.nodes).find(n => n.type === 'legend'));
  const rock = cfg.enemies[0];
  assert.equal(rock.species, 'REGIROCK');
  assert.ok(defaultMoves('REGIROCK', rock.level).includes('EXPLOSION'), 'its level-up moves have EXPLOSION');
  // (below Lv33 it knows only three other moves: ROCK THROW, CURSE, SUPERPOWER)
  assert.ok(!rock.moves.some(isSelfKO) && rock.moves.length >= 3 && new Set(rock.moves).size === rock.moves.length, rock.moves.join());
  assert.ok(withoutSelfKO('REGIROCK', 50, defaultMoves('REGIROCK', 50)).length === 4, 'a fuller learnset fills all four');
  for (const k of [...Object.keys(BIRDS), ...Object.keys(LEGENDS)]) for (const lvl of [20, 40, 70]) {
    const e = makeEnemy(LEGENDS[k].species, lvl, { rng: new RNG('k'), legendary: true, isElite: true });
    assert.ok(!e.moves.some(isSelfKO), `${k} Lv${lvl}: ${e.moves}`);
  }
  // a boss / elite / legendary with EXPLOSION in an authored moveset never picks it, even nearly beaten
  const b = new Battle(r, { ...cfg, rng: new RNG('sk') });
  b.start();
  const lead = b.lead();
  const pick = (e, n = 200) => { const seen = new Set(); for (let i = 0; i < n; i++) seen.add(b.pickEnemyMove(e, lead).key); return seen; };
  for (const flags of [{ isBoss: true }, { isElite: true }, { legendary: true }]) {
    const e = { ...makeEnemy('GOLEM', 40, { rng: new RNG('g'), moves: ['EXPLOSION', 'HARDEN'], ...flags }), ...flags };
    e.hp = 1;
    assert.ok(!pick(e).has('EXPLOSION'), JSON.stringify(flags));
  }
  // a plain foe: not at full HP, but as a last resort when nearly beaten
  const w = makeEnemy('ELECTRODE', 30, { rng: new RNG('v'), moves: ['SELF_DESTRUCT', 'SCREECH'] });
  assert.ok(!pick(w).has('SELF_DESTRUCT'), 'healthy: no self-KO');
  w.hp = Math.floor(w.maxHp * SELF_KO_HP);
  assert.ok(pick(w).has('SELF_DESTRUCT'), 'nearly beaten: may blow up');
  // only self-KO moves and not allowed: it struggles instead
  const only = makeEnemy('VOLTORB', 20, { rng: new RNG('v2'), moves: ['SELF_DESTRUCT'] });
  assert.deepEqual([...pick(only, 20)], ['STRUGGLE']);
});
t('v0.3.11: players never get TORMENT / MEAN LOOK / SPIDER WEB / BLOCK (no effect for them); foes keep them', () => {
  const bad = ['TORMENT', 'MEAN_LOOK', 'SPIDER_WEB', 'BLOCK'];
  assert.deepEqual([...NO_PLAYER_MOVES].sort(), [...bad].sort());
  for (const m of bad) assert.match(D.moves[m].desc, /^Has no effect/, m);
  // starting / gift / caught movesets: replaced by the next most recent level-up move
  assert.ok(defaultMoves('NUZLEAF', 30).includes('TORMENT') && defaultMoves('MISDREAVUS', 30).includes('MEAN_LOOK'));
  for (const g of [makeMon('NUZLEAF', 30), makeMon('MISDREAVUS', 30), makeMon('SPINARAK', 40), makeMon('NOSEPASS', 20)])
    assert.ok(!g.moves.some(x => bad.includes(x.move)) && g.moves.length >= 3, g.species + ': ' + g.moves.map(x => x.move).join());
  const caught = makeMon('SHIFTRY', 48, { moves: ['TORMENT', 'DOUBLE_TEAM', 'SWAGGER', 'EXTRASENSORY'] });
  assert.ok(!caught.moves.some(x => bad.includes(x.move)) && caught.moves.length === 4, caught.moves.map(x => x.move).join());
  // level-ups / evolutions, TMs and tutors, move rewards, the relearner: never offered
  const learners = Object.keys(D.species).filter(sp => (D.species[sp].learnset || []).some(([, m]) => bad.includes(m)));
  assert.ok(learners.length >= 5, 'some species learn them: ' + learners.length);
  for (const sp of learners) {
    for (const [l, m] of D.species[sp].learnset) if (bad.includes(m)) assert.ok(!movesLearnedAt(sp, l).includes(m), `${sp} Lv${l} ${m}`);
    for (const m of bad) assert.equal(canLearn(sp, m), false, `${sp} ${m}`);
    const mon = makeMon(sp, 60);
    for (const a of [0, 4]) assert.ok(!movePool(mon, a).some(x => bad.includes(x.move)), `${sp} reward pool`);
    const r = Run.create({ seed: 'NPM' }); assert.ok(!r.relearnable(mon).some(m => bad.includes(m)), `${sp} relearnable`);
  }
  assert.ok(!canLearn('SHIFTRY', 'TORMENT'), 'TM41 TORMENT is never offered (shop TMs filter on canLearn)');
  // foes: SIDNEY's SHIFTRY keeps TORMENT and can use it (it does nothing, nothing breaks)
  const foe = makeEnemy('SHIFTRY', 48, { rng: new RNG('sh'), moves: ['TORMENT'], isBoss: true });
  assert.deepEqual(foe.moves.filter(m => m === 'TORMENT'), ['TORMENT']);
  // an old save whose POKéMON already knows TORMENT keeps loading (and keeps the move)
  const r = Run.create({ seed: 'OLDT' });
  r.party[0].moves[0] = { move: 'TORMENT', copies: 1 };
  const back = Run.fromJSON(JSON.parse(JSON.stringify(r)));
  assert.equal(back.party[0].moves[0].move, 'TORMENT');
});
t('v0.3.11: every legendary node has a co-op partner from the same trio', () => {
  assert.deepEqual(Object.keys(BIRD_PARTNER).sort(), Object.keys(BIRDS).sort());
  for (const [k, p] of Object.entries(BIRD_PARTNER)) { assert.ok(BIRDS[p] && LEGENDS[p] && p !== k, k); }
  // each trio is one cycle (every legendary is someone's partner once)
  assert.deepEqual(Object.values(BIRD_PARTNER).sort(), Object.keys(BIRD_PARTNER).sort());
});
t('rival: fixed floor every path crosses, counters the starter, grows each act', () => {
  for (const world of ['kanto', 'hoenn']) for (let a = 0; a < 3; a++) {
    const r = actMap(world, a, 'RIV');
    const floor = Object.values(r.map.nodes).filter(n => n.type === 'rival').map(n => n.floor);
    assert.ok(floor.length && floor.every(f => f === floor[0]));
    const all = Object.values(r.map.nodes).filter(n => n.floor === floor[0] && n.type !== 'legend');
    assert.ok(all.every(n => n.type === 'rival'), 'the whole floor');
  }
  assert.equal(counterStarter('BULBASAUR'), 'CHARMANDER'); assert.equal(counterStarter('CHARMANDER'), 'SQUIRTLE'); assert.equal(counterStarter('SQUIRTLE'), 'BULBASAUR');
  assert.equal(counterStarter('TREECKO', 'hoenn'), 'TORCHIC'); assert.equal(counterStarter('TORCHIC', 'hoenn'), 'MUDKIP'); assert.equal(counterStarter('MUDKIP', 'hoenn'), 'TREECKO');
  // any other starter: a starter whose type hits it at least neutrally and isn't hit super-effectively back
  for (const st of STARTERS) for (const world of ['kanto', 'hoenn']) {
    const c = counterStarter(st.species, world); const mine = D.species[st.species].types, theirs = D.species[c].types;
    assert.ok(Math.max(...mine.map(ty => typeEffect(ty, theirs))) <= Math.max(1, Math.max(...theirs.map(ty => typeEffect(ty, mine)))), `${st.species} vs ${c}`);
  }
  // no home starter beats PIKACHU, so BLUE takes one from any region (GROUND beats ELECTRIC); LARVITAR: SQUIRTLE (4x)
  assert.equal(counterStarter('PIKACHU'), 'NINCADA'); assert.equal(counterStarter('LARVITAR'), 'SQUIRTLE');
  // the rival's starter is ALWAYS super effective on yours
  for (const world of ['kanto', 'hoenn', 'johto']) for (const st of STARTERS) {
    const c = counterStarter(st.species, world), theirs = D.species[c].types, mine = D.species[st.species].types;
    assert.ok(Math.max(...theirs.map(ty => typeEffect(ty, mine))) >= 2, `${world}: ${st.species} vs ${c}`);
  }
  const sizes = [];
  for (let a = 0; a < 3; a++) {
    const r = actMap('kanto', a, 'RV2'); r.starter = 'CHARMANDER';
    const cfg = r.rivalConfig(r.rng.fork('r'), 10);
    assert.ok(cfg.rival && cfg.intro.length && cfg.trainer.name === 'BLUE');
    const ace = cfg.enemies[cfg.enemies.length - 1].species;
    assert.ok(['SQUIRTLE', 'WARTORTLE', 'BLASTOISE'].includes(ace), ace);
    assert.ok(/CHARMANDER|SQUIRTLE|WARTORTLE|BLASTOISE/.test(cfg.intro.join(' ')), 'intro names the starters');
    sizes.push(cfg.enemies.length);
  }
  assert.ok(sizes[0] < sizes[2] && sizes[0] <= sizes[1], String(sizes));
  const h = actMap('hoenn', 1, 'RV3'); h.starter = 'TREECKO';
  const hc = h.rivalConfig(h.rng.fork('r'), 10);
  assert.ok(hc.enemies.some(e => ['TORCHIC', 'COMBUSKEN', 'BLAZIKEN'].includes(e.species)));
  h.starter = 'MUDKIP';
  assert.ok(h.rivalConfig(h.rng.fork('r'), 10).enemies.some(e => ['TREECKO', 'GROVYLE', 'SCEPTILE'].includes(e.species)), 'MAY switches to TREECKO');
});
t('nuzlocke: slot, permadeath, first wild only, off in co-op', () => {
  assert.equal(ASCENSIONS.length, 11); assert.equal(MAX_ASCENSION, 10);
  assert.equal(ASCENSIONS[NUZLOCKE_ASC].name, 'Nuzlocke'); assert.ok(NUZLOCKE_ASC >= 6 && NUZLOCKE_ASC <= 8);
  const r = Run.create({ seed: 'NUZ', ascension: NUZLOCKE_ASC });
  assert.ok(r.nuzlocke); assert.ok(!Run.create({ seed: 'NUZ', ascension: 10, coop: true }).nuzlocke); assert.ok(!Run.create({ seed: 'NUZ', ascension: 7 }).nuzlocke);
  r.party.push(makeMon('PIDGEY', 5, { rng: r.rng }));
  const node = { id: 'n1', floor: 1, type: 'wild' };
  const b = new Battle(r, r.battleConfig(node)); b.start();
  const victim = b.lead();
  victim.hp = 0; b.checkLeadFaint();
  assert.ok(victim.lost, 'marked lost');
  assert.ok(b.takeEvents().some(e => e.t === 'nuzlocke' || (e.t === 'msg' && /NUZLOCKE/.test(e.text))));
  r.consumables = ['REVIVE']; assert.ok(!r.applyConsumableToMon('REVIVE', victim), "can't be revived");
  b.end('fled');
  const gone = r.releaseLost();
  assert.deepEqual(gone.map(m => m.uid), [victim.uid]); assert.ok(!r.party.includes(victim)); assert.equal(r.party.length, 1);
  // the act's first wild battle may catch; the next one may not
  assert.ok(r.battleConfig(node).nuzFirst, 'same node again (reload): still the first');
  const b2 = new Battle(r, r.battleConfig({ id: 'n2', floor: 2, type: 'wild' })); b2.start();
  assert.ok(!b2.canCatch()); r.balls.POKE_BALL = 3; b2.throwBall('POKE_BALL'); assert.equal(r.balls.POKE_BALL, 3);
  r.startAct(1); assert.ok(r.battleConfig({ id: 'n3', floor: 1, type: 'wild' }).nuzFirst, 'new act, new encounter');
  // whole party lost: the battle is lost
  const r3 = Run.create({ seed: 'NUZ3', ascension: 9 });
  const b3 = new Battle(r3, r3.battleConfig({ id: 'x', floor: 1, type: 'wild' })); b3.start();
  b3.lead().hp = 0; b3.checkLeadFaint(); assert.equal(b3.result?.outcome, 'lose');
  // dry-run previews never mark anything
  const r4 = Run.create({ seed: 'NUZ4', ascension: 8 }); const b4 = new Battle(r4, r4.battleConfig({ id: 'y', floor: 1, type: 'wild' })); b4.start();
  b4.dry = true; b4.lead().hp = 0; b4.checkLeadFaint(); assert.ok(!r4.party[0].lost);
});
t('shiny: A5+ win unlocks the starter family, cosmetic starter option', () => {
  const meta = { shinies: [] };
  assert.equal(unlockShiny(Run.create({ seed: 'S', starter: 'SQUIRTLE', ascension: 4 }), meta), null);
  const win = Run.create({ seed: 'S', starter: 'SQUIRTLE', ascension: 5 });
  assert.equal(unlockShiny(win, meta), 'SQUIRTLE'); assert.equal(unlockShiny(win, meta), null, 'once');
  assert.ok(shinyUnlocked('BLASTOISE', meta) && !shinyUnlocked('CHARMANDER', meta));
  assert.equal(unlockShiny(Run.create({ seed: 'S', starter: 'CHARMANDER', ascension: 9, coop: true }), meta), null, 'not from co-op');
  const plain = Run.create({ seed: 'SH', starter: 'SQUIRTLE' }), shiny = Run.create({ seed: 'SH', starter: 'SQUIRTLE', shiny: true });
  assert.ok(shiny.party[0].shiny);
  assert.equal(shiny.rng.state, plain.rng.state, 'the shiny form changes nothing else');
  assert.deepEqual(shiny.party[0].ivs, plain.party[0].ivs);
});
t('starters: every Gen 3 type covered, playable decks, defaults', () => {
  const types = new Set(STARTERS.flatMap(s => D.species[s.species].types));
  for (const ty of GEN3_TYPES) assert.ok(types.has(ty), 'no starter of type ' + ty);
  for (const s of STARTERS) {
    assert.ok(D.species[s.species], s.species);
    if (['PIDGEY', 'MACHOP', 'NINCADA', 'GASTLY', 'ABRA', 'SWINUB', 'HOUNDOUR'].includes(s.species)) assert.ok(!PREV_OF(s.species), s.species + ' is a base stage');
    const moves = s.moves.filter(m => D.moves[m]);
    assert.equal(moves.length, s.moves.length, s.species + ' moves exist: ' + s.moves.filter(m => !D.moves[m]));
    assert.ok(moves.filter(m => D.moves[m].power > 0).length >= 2, s.species + ' has 2+ attacks');
    const r = Run.create({ seed: 'ST', starter: s.species });
    assert.equal(r.party[0].species, s.species);
  }
  assert.deepEqual(STARTERS.slice(0, 3).map(s => s.species), ['BULBASAUR', 'CHARMANDER', 'SQUIRTLE']);
});
function PREV_OF(sp) { for (const [k, d] of Object.entries(D.species)) if ((d.evolutions || []).some(e => e.into === sp)) return k; return null; }
// ---- starter unlocks (game/unlocks.js) ----
t('starters: the v0.0.5 starters keep their moves (v0.0.6: LARVITAR gets ROCK THROW; PIKACHU: CHARGE BEAM for TAIL WHIP), no unlock keys', () => {
  const V6_NEW = ['PIDGEY', 'MACHOP', 'NINCADA', 'GASTLY', 'ABRA', 'SWINUB', 'HOUNDOUR'];
  assert.deepEqual(STARTERS.filter(s => !V6_NEW.includes(s.species)).map(s => s.species + ':' + s.moves.join(',')), [
    'BULBASAUR:TACKLE,GROWL,LEECH_SEED,VINE_WHIP', 'CHARMANDER:METAL_CLAW,GROWL,EMBER,SMOKESCREEN', 'SQUIRTLE:TACKLE,TAIL_WHIP,BUBBLE,WITHDRAW',
    'PIKACHU:THUNDER_SHOCK,CHARGE_BEAM,QUICK_ATTACK,GROWL', 'EEVEE:TACKLE,TAIL_WHIP,SAND_ATTACK,QUICK_ATTACK', 'CHIKORITA:TACKLE,GROWL,RAZOR_LEAF,POISON_POWDER',
    'CYNDAQUIL:TACKLE,LEER,SMOKESCREEN,EMBER', 'TOTODILE:SCRATCH,LEER,RAGE,WATER_GUN', 'TREECKO:POUND,LEER,ABSORB,QUICK_ATTACK', 'TORCHIC:SCRATCH,GROWL,FOCUS_ENERGY,EMBER',
    'MUDKIP:TACKLE,GROWL,MUD_SLAP,WATER_GUN', 'DRATINI:WRAP,LEER,THUNDER_WAVE,TWISTER', 'LARVITAR:BITE,ROCK_THROW,LEER,SANDSTORM', 'BELDUM:TAKE_DOWN,TACKLE,IRON_DEFENSE,METAL_CLAW',
  ]);
  assert.ok(STARTERS.every(s => !('unlock' in s)));
});
t('starters: a starter item is held from the start (PIKACHU: LIGHT BALL, MACHOP: MACHO BRACE; solo, co-op and Nuzlocke), others start empty', () => {
  assert.ok(STARTERS.filter(s => s.item).every(s => RELICS[s.item] && D.items[s.item]));
  for (const opts of [{ ascension: 0 }, { ascension: NUZLOCKE_ASC }, { ascension: 0, coop: true }])
    assert.deepEqual(Run.create({ starter: 'PIKACHU', seed: 'SI1', world: 'spire', pool: ['kanto'], ...opts }).relics.map(r => r.key), ['LIGHT_BALL']);
  assert.deepEqual(Run.create({ starter: 'MACHOP', seed: 'SI1', world: 'spire', pool: ['kanto'] }).relics.map(r => r.key), ['MACHO_BRACE']);
  assert.deepEqual(Run.create({ starter: 'CHARMANDER', seed: 'SI1', world: 'spire', pool: ['kanto'] }).relics, []);
});
t('starters: migration resets old meta to the Kanto three, keeps the rest', () => {
  const old = { unlocks: { act2: true, act3: true, win: true, a5: true, postgame: true, hoennWin: true }, maxAscension: 7, bestAscensionWon: 6, dexSeen: ['PIDGEY'], dexCaught: ['RATTATA'],
    runs: [{ seed: 'x', result: 'win' }], totalWins: 4, totalRuns: 9, settings: { music: 0.2, sfx: 0.3 }, seenVersion: 'v0.0.5', lastWorld: 'hoenn', unlockedStarters: ['BULBASAUR', 'DRATINI', 'BELDUM'] };
  const m = structuredClone(old);
  assert.equal(U.migrateStarterMeta(m), true);
  assert.deepEqual(m.unlockedStarters, ['BULBASAUR', 'CHARMANDER', 'SQUIRTLE']);
  assert.equal(m.starterVer, U.STARTER_VER);
  const { unlockedStarters: _a, starterVer: _b, ...rest } = m, { unlockedStarters: _c, ...oldRest } = old;
  assert.deepEqual(rest, oldRest); // ascension, unlock flags (win = HOENN access), dex, runs, totals, settings kept
  // the old flags no longer open starters
  assert.equal(U.isStarterUnlocked(m, 'DRATINI', 'kanto'), false);
  assert.equal(U.isStarterUnlocked(m, 'CHARMANDER', 'kanto'), true);
  assert.equal(U.migrateStarterMeta({}), true); // a brand-new save gets the list too
});
t('starters: migrated meta is left alone', () => {
  const m = { starterVer: U.STARTER_VER, unlockedStarters: ['BULBASAUR', 'CHARMANDER', 'SQUIRTLE', 'EEVEE'], maxAscension: 3 };
  const before = structuredClone(m);
  assert.equal(U.migrateStarterMeta(m), false);
  assert.deepEqual(m, before);
});
t('starters: HOENN three open in HOENN only', () => {
  const m = { starterVer: 2, unlockedStarters: [...U.KANTO_STARTERS] };
  for (const s of U.HOENN_STARTERS) { assert.equal(U.isStarterUnlocked(m, s, 'hoenn'), true); assert.equal(U.isStarterUnlocked(m, s, 'kanto'), false); }
  assert.deepEqual(U.availableStarters(m, 'hoenn'), ['TREECKO', 'TORCHIC', 'MUDKIP', 'BULBASAUR', 'CHARMANDER', 'SQUIRTLE']);
  assert.deepEqual(U.availableStarters({ ...m, unlockedStarters: [...m.unlockedStarters, 'BELDUM', 'TORCHIC'] }, 'kanto'), ['BULBASAUR', 'CHARMANDER', 'SQUIRTLE', 'TORCHIC', 'BELDUM']);
});
t('starters: offers = up to 3 locked, one per act clear', () => {
  const m = { starterVer: 2, unlockedStarters: [...U.KANTO_STARTERS] };
  let r = 0; const rand = () => ((r = (r * 9301 + 49297) % 233280) / 233280);
  const o = U.grantStarterOffer(m, 'S:1:0', { rand });
  assert.equal(o.options.length, 3);
  assert.equal(new Set(o.options).size, 3);
  assert.ok(o.options.every(s => !U.KANTO_STARTERS.includes(s) && STARTERS.some(x => x.species === s)));
  assert.equal(U.grantStarterOffer(m, 'S:1:0', { rand }), null); // same act again (reload / double call)
  assert.equal(U.currentStarterOffer(m, { rand }).key, 'S:1:0');
  assert.equal(U.claimStarterOffer(m, 'S:1:0', 'MEW'), false); // not offered
  const pick = o.options[1];
  assert.equal(U.claimStarterOffer(m, 'S:1:0', pick), true);
  assert.ok(m.unlockedStarters.includes(pick) && m.unlockedStarters.length === 4);
  assert.equal(U.claimStarterOffer(m, 'S:1:0', o.options[0]), false); // only one per act clear
  assert.equal(U.grantStarterOffer(m, 'S:1:0', { rand }), null); // claimed keys are remembered
  assert.equal(U.currentStarterOffer(m), null);
  // two pending offers: the second refreshes options unlocked by the first
  U.grantStarterOffer(m, 'S:1:1', { rand }); U.grantStarterOffer(m, 'S:1:2', { rand });
  const first = U.currentStarterOffer(m, { rand });
  const second = m.starterOffers[1];
  second.options = [first.options[0], ...second.options.filter(s => s !== first.options[0])].slice(0, 3);
  U.claimStarterOffer(m, first.key, first.options[0]);
  const next = U.currentStarterOffer(m, { rand });
  assert.equal(next.key, 'S:1:2');
  assert.ok(next.options.length === 3 && next.options.every(s => !m.unlockedStarters.includes(s)));
  // fewer than 3 locked: all of them; nothing locked: no offer
  m.unlockedStarters = STARTERS.map(s => s.species).filter(s => s !== 'EEVEE' && s !== 'BELDUM'); m.starterOffers = [];
  assert.deepEqual(U.grantStarterOffer(m, 'S:1:3', { rand }).options.sort(), ['BELDUM', 'EEVEE']);
  m.unlockedStarters = STARTERS.map(s => s.species);
  assert.equal(U.grantStarterOffer(m, 'S:1:4', { rand }), null);
  assert.equal(U.currentStarterOffer(m, { rand }), null); // stale offers are dropped once nothing is locked
  assert.equal(m.starterOffers.length, 0);
});
t('starters: offers never touch the run rng', () => {
  const run = Run.create({ seed: 'UNL' });
  const st = run.rng.state ?? JSON.stringify(run.rng);
  const m = { starterVer: 2, unlockedStarters: [...U.KANTO_STARTERS] };
  U.grantStarterOffer(m, U.soloActKey(run));
  assert.equal(run.rng.state ?? JSON.stringify(run.rng), st);
  assert.ok(U.soloActKey(run).startsWith('UNL:'));
});

// ---- full bag: a found / bought item is never silently thrown away -----------------------------------
const fullRun = (seed, bag) => { const r = Run.create({ seed }); r.consumables = bag.slice(); return r; };
const lastBagLog = (r) => (r.runLog?.events || []).filter(e => e.k === 'bagFull').at(-1);
t('bag: sell values, selling, bag values', () => {
  const r = fullRun('BAG1', ['POTION', 'NUGGET', 'POTION']);
  assert.equal(r.sellValue('NUGGET'), 5000); assert.equal(r.sellValue('POTION'), 150); assert.equal(r.sellValue('NOPE'), 0);
  const m0 = r.money;
  assert.equal(r.sellConsumable('NUGGET'), 5000); assert.equal(r.money, m0 + 5000); assert.deepEqual(r.consumables, ['POTION', 'POTION']);
  assert.equal(r.sellConsumable('REVIVE'), -1); assert.equal(r.money, m0 + 5000);
  assert.ok(r.bagValue('REVIVE') > r.bagValue('SUPER_POTION') && r.bagValue('SUPER_POTION') > r.bagValue('POTION'));
  assert.ok(r.bagValue('HP_UP') >= 2400 && r.bagValue('NUGGET') === 5000);
});
t('bag: canUseNow / useBlocker follow the party', () => {
  const r = fullRun('BAG2', []);
  const m = r.party[0];
  assert.equal(r.canUseNow('X_ATTACK'), false); assert.equal(r.canUseNow('ESCAPE_ROPE'), false);
  assert.equal(r.canUseNow('POTION'), false); assert.equal(r.useBlocker('POTION', m), 'HP is full');
  assert.equal(r.canUseNow('REVIVE'), false);
  assert.ok(r.canUseNow('RARE_CANDY') && r.canUseNow('PROTEIN') && r.canUseNow('NUGGET') && r.canUseNow('PP_UP'));
  m.hp = 1; assert.ok(r.canUseNow('POTION')); assert.equal(r.useBlocker('POTION', m), null);
  m.status = 'PSN'; assert.ok(r.canUseNow('PECHA_BERRY')); assert.equal(r.canUseNow('CHERI_BERRY'), false);
  m.hp = 0; assert.ok(r.canUseNow('REVIVE')); assert.equal(r.canUseNow('POTION'), false); assert.equal(r.canUseNow('RARE_CANDY'), false);
});
t('bag: gainItem stores when there is room', () => {
  const r = fullRun('BAG3', ['POTION']);
  assert.equal(r.gainItem('REVIVE'), 'stored'); assert.deepEqual(r.consumables, ['POTION', 'REVIVE']);
  assert.equal(lastBagLog(r), undefined);
});
t('bag: a full bag uses a RARE CANDY on the spot (nothing lost, bag untouched)', () => {
  const r = fullRun('BAG4', ['POTION', 'X_ATTACK', 'X_DEFEND']);
  const lv = r.party[0].level;
  assert.equal(r.gainItem('RARE_CANDY'), 'used');
  assert.deepEqual(r.consumables, ['POTION', 'X_ATTACK', 'X_DEFEND']);
  assert.equal(r.party[0].level, lv + 3);
  assert.ok(r.pendingLevelEvents); // learn/evolve events are left for the caller (UI modals / bot)
  const log = lastBagLog(r);
  assert.equal(log.item, 'RARE_CANDY'); assert.equal(log.did, 'used');
});
t('bag: a valuable find replaces the least valuable item (sold, money paid)', () => {
  const r = fullRun('BAG5', ['X_ATTACK', 'POTION', 'X_DEFEND']);
  const m0 = r.money;
  assert.equal(r.gainItem('REVIVE'), 'stored');
  assert.deepEqual(r.consumables.slice().sort(), ['REVIVE', 'X_ATTACK', 'X_DEFEND']);
  assert.equal(r.money, m0 + 150);
  assert.equal(lastBagLog(r).other, 'POTION');
});
t('bag: a usable cheapest item is used rather than sold', () => {
  const r = fullRun('BAG6', ['X_ATTACK', 'POTION', 'X_DEFEND']);
  r.party[0].hp = 1;
  const m0 = r.money;
  assert.equal(r.gainItem('REVIVE'), 'stored');
  assert.ok(r.party[0].hp > 1); assert.equal(r.money, m0);
  assert.ok(!r.hasConsumable('POTION') && r.hasConsumable('REVIVE'));
});
t('bag: an any-time bag item is spent first to make room', () => {
  const r = fullRun('BAG7', ['REVIVE', 'PROTEIN', 'MAX_REVIVE']);
  const combo = CONSUMABLES.PROTEIN.combo, lvl = r.comboLevels[combo] || 1;
  assert.equal(r.gainItem('X_SPEED'), 'stored');
  assert.ok(r.hasConsumable('X_SPEED') && !r.hasConsumable('PROTEIN'));
  assert.equal(r.comboLevels[combo], lvl + 1);
});
t('bag: the least valuable, unusable find is left on purpose (logged); usable ones are used', () => {
  const r = fullRun('BAG8', ['REVIVE', 'REVIVE', 'MAX_REVIVE']);
  const m0 = r.money;
  assert.equal(r.planRoom('X_SPEED').do, 'leave');
  assert.equal(r.gainItem('X_SPEED'), 'left');
  assert.deepEqual(r.consumables, ['REVIVE', 'REVIVE', 'MAX_REVIVE']); assert.equal(r.money, m0);
  assert.equal(lastBagLog(r).did, 'left');
  r.party[0].hp = 1;
  assert.equal(r.gainItem('POTION'), 'used'); assert.ok(r.party[0].hp > 1);
});
t('bag: item-ball / reward drops into a full bag never vanish (300 seeds)', () => {
  for (let i = 0; i < 300; i++) {
    const rng = new RNG('drop' + i);
    const r = Run.create({ seed: 'D' + i });
    if (i % 3 === 0) r.party[0].hp = Math.max(1, r.party[0].hp >> 1);
    r.consumables = [r.randomConsumable(rng, 2), r.randomConsumable(rng, 2), r.randomConsumable(rng, 2)];
    const key = i % 2 ? r.randomConsumable(rng, r.actIndex + 1) : r.randomConsumable(rng);
    const before = r.consumables.slice(), m0 = r.money, minV = Math.min(...before.map(k => r.bagValue(k)));
    const res = r.gainItem(key);
    const log = lastBagLog(r);
    assert.ok(log && log.item === key && log.did === res, `seed ${i}: logged`);
    if (res === 'stored') { assert.ok(r.hasConsumable(key)); assert.equal(r.consumables.length, 3); assert.ok(r.money >= m0); }
    else if (res === 'used') assert.equal(r.consumables.length, 3);
    else { assert.deepEqual(r.consumables, before, `seed ${i}`); assert.ok(r.bagValue(key) <= minV && (!r.canUseNow(key) || CONSUMABLES[key].relearn), `seed ${i}: left ${key} over ${before}`); }
  }
});
t('bag: events hand found items that do not fit back as overflow (nothing thrown away)', () => {
  const cases = [['berries', 'Pick 2 BERRIES'], ['powerplant', 'Pick up a ball'], ['kakuna', 'Collect the honey']];
  for (const [id, label] of cases) {
    const ev = EVENTS.find(e => e.id === id), c = ev.choices.find(x => typeof x.label === 'string' && x.label.startsWith(label));
    let res = null, r = null;
    for (let i = 0; i < 20 && (!res || res.battle); i++) { r = fullRun('EV' + id + i, ['X_ATTACK', 'X_DEFEND', 'X_SPEED']); r.coop = true; res = c.run(r, new RNG('ev' + id + i)); }
    assert.ok(res.overflow?.length, id);
    assert.deepEqual(r.consumables, ['X_ATTACK', 'X_DEFEND', 'X_SPEED'], id);
    for (const k of res.overflow) { assert.ok(res.text.includes(D.items[k].name), id); assert.ok(['stored', 'used', 'left'].includes(r.gainItem(k)), id); }
    // with room: stored straight away, no overflow
    const r2 = fullRun('EV2' + id, []);
    let res2 = null;
    r2.coop = true;
    for (let i = 0; i < 20 && (!res2 || res2.battle || !res2.overflow); i++) res2 = c.run(r2, new RNG('ev' + id + i));
    assert.deepEqual(res2.overflow, [], id); assert.ok(r2.consumables.length >= 1, id);
  }
});
t('bag: the MART never charges for an item that cannot be stored', () => {
  const r = fullRun('SHOPBAG', ['X_ATTACK', 'X_DEFEND', 'X_SPEED']);
  r.money = 20000;
  const shop = generateShop(r, new RNG('sb'));
  const it = shop.items.find(i => i.key === 'POTION');
  let res = buyItem(r, shop, it);
  assert.equal(res.ok, false); assert.equal(res.bagFull, true); assert.match(res.reason, /BAG is full/);
  assert.equal(r.money, 20000); assert.deepEqual(r.consumables, ['X_ATTACK', 'X_DEFEND', 'X_SPEED']);
  // make room (sell), then it goes through and charges once
  r.sellConsumable('X_SPEED');
  res = buyItem(r, shop, it);
  assert.ok(res.ok); assert.equal(r.money, 20000 + 175 - it.price); assert.ok(r.hasConsumable('POTION'));
  // BUY & USE (the picker used it on the spot): paid, nothing stored
  const m1 = r.money, bag = r.consumables.slice();
  const other = shop.items.find(i => i.kind === 'consumable' && !CONSUMABLES[i.key].combo && i.key !== 'POTION');
  assert.equal(buyItem(r, shop, other).bagFull, true); assert.equal(r.money, m1);
  res = buyItem(r, shop, other, { consumed: true });
  assert.ok(res.ok); assert.equal(r.money, m1 - other.price); assert.deepEqual(r.consumables, bag);
  // not enough money is reported first (no bag-full picker for an item you can't afford)
  r.money = 0;
  res = buyItem(r, shop, it); assert.equal(res.ok, false); assert.ok(!res.bagFull);
  // combo items still never need a slot
  r.money = 20000;
  const vit = shop.items.find(i => i.vitamin);
  if (vit) { assert.ok(buyItem(r, shop, vit).ok); assert.deepEqual(r.consumables, bag); }
});
{
  const { gainBotItem } = await import('./bot.mjs');
  t('bag: bots (reward/treasure/event paths) make room by the same policy', () => {
    const r = fullRun('BOTBAG', ['POTION', 'X_ATTACK', 'X_DEFEND']);
    const lv = r.party[0].level;
    assert.equal(gainBotItem(r, 'RARE_CANDY', 'smart'), 'used'); assert.equal(r.party[0].level, lv + 3); assert.equal(r.pendingLevelEvents, null);
    assert.equal(gainBotItem(r, 'HYPER_POTION', 'smart'), 'stored'); assert.ok(r.hasConsumable('HYPER_POTION') && !r.hasConsumable('POTION'));
    for (const m of r.party) m.hp = maxHp(m);
    assert.equal(gainBotItem(r, 'BERRY_JUICE', 'greedy'), 'left');
  });
}

// A song name missing from the sound bank once froze the rival battle (mus_vs_rival): every song the code or a
// battle config asks for must exist.
t('every song the game plays exists in the sound bank', () => {
  const bankPath = new URL('../web/assets/sound/bank.json', import.meta.url);
  if (!fs.existsSync(bankPath)) return; // assets not extracted on this machine
  const songs = new Set(Object.keys(JSON.parse(fs.readFileSync(bankPath, 'utf8')).songs));
  const missing = new Set();
  const walk = (dir) => { for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = new URL(f.name + (f.isDirectory() ? '/' : ''), dir);
    if (f.isDirectory()) walk(p);
    else if (f.name.endsWith('.js')) for (const m of fs.readFileSync(p, 'utf8').matchAll(/['"`]((?:mus|se)_[a-z0-9_]+)['"`]/g)) if (!songs.has(m[1])) missing.add(m[1]);
  } };
  walk(new URL('../web/src/', import.meta.url));
  for (const world of ['kanto', 'hoenn', 'johto']) for (const starter of ['BULBASAUR', 'CHARMANDER', 'SQUIRTLE', 'PIKACHU', 'TREECKO', 'CHIKORITA']) {
    const r = Run.create({ starter, ascension: 0, seed: 'SONGS' + world + starter, world });
    for (let a = 0; a < r.acts.length; a++) {
      if (a) r.startAct(a);
      const cfgs = [r.rivalConfig(r.rng.fork('s'), 10), r.eliteConfig(r.rng.fork('e'), 8)];
      for (const k of Object.keys(LEGENDS)) cfgs.push(r.legendConfig(r.rng.fork('l'), 8, k));
      for (const c of cfgs) for (const s of [c?.music, c?.trainer?.battleSong, c?.trainer?.encounterSong]) if (s && !songs.has(s)) missing.add(s);
    }
  }
  assert.deepEqual([...missing], []);
});

// ---- ascension unlocks per starter (v0.0.6) ----
t('ascension: a win unlocks the next level for that starter only', () => {
  const m = { ascBy: {}, ascVer: U.ASC_VER };
  assert.equal(U.ascUnlocked(m, 'BULBASAUR'), 0);
  assert.equal(U.grantAscension(m, 'BULBASAUR', 0), true);
  assert.equal(U.ascUnlocked(m, 'BULBASAUR'), 1);
  assert.equal(U.ascUnlocked(m, 'SQUIRTLE'), 0); // clearing A0 with BULBASAUR doesn't transfer
  assert.equal(U.grantAscension(m, 'BULBASAUR', 0), false); // nothing new
  U.grantAscension(m, 'BULBASAUR', 4); assert.equal(U.ascUnlocked(m, 'BULBASAUR'), 5);
  U.grantAscension(m, 'BULBASAUR', 2); assert.equal(U.ascUnlocked(m, 'BULBASAUR'), 5); // never goes down
  U.grantAscension(m, 'BULBASAUR', 10); assert.equal(U.ascUnlocked(m, 'BULBASAUR'), 10); // capped at A10
  // the picker opens at the level last used with the starter, capped by its unlock
  m.lastAscBy = { BULBASAUR: 3 }; m.lastAscension = 7;
  assert.equal(U.ascDefault(m, 'BULBASAUR'), 3);
  assert.equal(U.ascDefault(m, 'SQUIRTLE'), 0); // A0 unlocked: the old global pick (7) is capped
});
{
  globalThis.localStorage ||= { _s: {}, getItem(k) { return this._s[k] ?? null; }, setItem(k, v) { this._s[k] = String(v); }, removeItem(k) { delete this._s[k]; } };
  const st = await import('../web/src/game/state.js');
  st.G.meta = { unlocks: {}, maxAscension: 0, bestAscensionWon: -1, dexSeen: [], dexCaught: [], runs: [], totalWins: 0, totalRuns: 0, shinies: [], shinyOn: {}, ascBy: {}, ascVer: U.ASC_VER, settings: {} };
  const r = Run.create({ starter: 'SQUIRTLE', ascension: 2, seed: 'ASCWIN' });
  st.endRun(r, 'win');
  t('ascension: endRun win at A2 with SQUIRTLE opens A3 for SQUIRTLE only', () => {
    assert.equal(U.ascUnlocked(st.G.meta, 'SQUIRTLE'), 3);
    assert.equal(U.ascUnlocked(st.G.meta, 'BULBASAUR'), 0);
    assert.equal(st.G.meta.maxAscension, 3); // stats keep working
    assert.equal(st.G.meta.bestAscensionWon, 2);
  });
  const r2 = Run.create({ starter: 'BULBASAUR', ascension: 0, seed: 'ASCLOSE' });
  st.endRun(r2, 'lose');
  t('ascension: a loss unlocks nothing', () => assert.equal(U.ascUnlocked(st.G.meta, 'BULBASAUR'), 0));
}
t('ascension: migration rebuilds each starter from the run history (a real save shape)', () => {
  // like a prod save: post-game clears, a CHAMPION who went on and blacked out in the post-game (act 5,
  // saved as 'lose'), early losses; global unlock A5
  const run = (starter, ascension, result, act) => ({ date: 0, starter, ascension, result, act, floor: 3, party: [starter], seed: 'x' });
  const old = { maxAscension: 5, bestAscensionWon: 4, lastAscension: 4, unlockedStarters: ['BULBASAUR', 'CHARMANDER', 'SQUIRTLE', 'GASTLY', 'DRATINI'], starterVer: 2,
    shinies: ['DRATINI'], shinyOn: { DRATINI: true }, unlocks: { win: true, a5: false }, totalWins: 6, totalRuns: 9, dexSeen: ['PIDGEY'], settings: { music: 0.3 },
    runs: [run('GASTLY', 4, 'lose', 5), run('GASTLY', 4, 'lose', 1), run('DRATINI', 3, 'postgame', 5), run('DRATINI', 3, 'lose', 1), run('ABRA', 2, 'postgame', 5),
      run('MUDKIP', 1, 'win', 4), run('PIKACHU', 0, 'postgame', 5), run('SQUIRTLE', 0, 'lose', 2), run('BULBASAUR', 0, 'lose', 1)] };
  const m = structuredClone(old);
  assert.equal(U.migrateAscensionMeta(m), true);
  assert.deepEqual(m.ascBy, { GASTLY: 5, DRATINI: 4, ABRA: 3, MUDKIP: 2, PIKACHU: 1 }); // no wins: A0
  assert.equal(m.ascVer, U.ASC_VER);
  const { ascBy: _a, ascVer: _b, ...rest } = m;
  assert.deepEqual(rest, old); // shinies, starter unlocks, stats, history, settings untouched
  assert.equal(U.migrateAscensionMeta(m), false); // once only
  assert.deepEqual(m.ascBy, { GASTLY: 5, DRATINI: 4, ABRA: 3, MUDKIP: 2, PIKACHU: 1 });
});
t('ascension: unlocks come from clears only (no fallback from the old global level)', () => {
  // the old global A3 came from a win that's no longer in the history: nothing is invented for it
  const m = { maxAscension: 3, runs: [{ starter: 'EEVEE', ascension: 2, result: 'lose', act: 1 }, { starter: 'CHARMANDER', ascension: 1, result: 'win', act: 4 }] };
  U.migrateAscensionMeta(m);
  assert.deepEqual(m.ascBy, { CHARMANDER: 2 });
  const bare = { maxAscension: 2, runs: [] }; U.migrateAscensionMeta(bare);
  assert.deepEqual(bare.ascBy, {});
  const fresh = {}; U.migrateAscensionMeta(fresh); // a brand-new save
  assert.deepEqual(fresh.ascBy, {}); assert.equal(fresh.ascVer, U.ASC_VER);
});
{
  // the server migration (convex/ascension.ts) must agree with the client one
  // (convex/ is CommonJS territory for node, so strip the types and load it as a module)
  const { stripTypeScriptTypes } = await import('node:module');
  const src = stripTypeScriptTypes(fs.readFileSync(new URL('../convex/ascension.ts', import.meta.url), 'utf8'));
  const S = await import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'));
  t('ascension: server and client migrations agree; the server merges the full run history', () => {
    const run = (starter, ascension, result, act = 3) => ({ starter, ascension, result, act });
    const samples = [
      [], [run('BULBASAUR', 2, 'win')], [run('GASTLY', 4, 'lose', 5), run('GASTLY', 1, 'postgame', 5), run('ABRA', 0, 'lose', 2)],
      [run('MUDKIP', 9, 'win'), run('MUDKIP', 10, 'win'), run('TORCHIC', 3, 'lose', 4)], [{ ascension: 3, result: 'win' }, run('PIKACHU', 0, 'win')],
    ];
    for (const runs of samples) {
      const c = { runs: structuredClone(runs), maxAscension: 7 }, srv = { runs: structuredClone(runs), maxAscension: 7 };
      U.migrateAscensionMeta(c); S.applyClears(srv, srv.runs);
      assert.deepEqual(srv.ascBy, c.ascBy, JSON.stringify(runs));
      assert.equal(srv.ascVer, U.ASC_VER);
    }
    // e.g. cleared A2 with BULBASAUR in an old run only the runs table still has -> BULBASAUR A3
    const meta = { ascVer: 1, ascBy: { GASTLY: 5, SQUIRTLE: 1 }, runs: [run('GASTLY', 4, 'lose', 5)] };
    const r = S.applyClears(meta, [...meta.runs, run('BULBASAUR', 2, 'win'), run('SQUIRTLE', 0, 'lose', 1)]);
    assert.deepEqual(r.ascBy, { GASTLY: 5, SQUIRTLE: 1, BULBASAUR: 3 }); // existing levels never lowered
    assert.equal(r.changed, true);
    assert.equal(S.applyClears(meta, meta.runs).changed, false); // re-running changes nothing
  });
}
t('ascension: co-op room cap is the highest of the players\' unlocks for their picks', () => {
  assert.equal(U.coopAscCap([{ ascMax: 4 }, { ascMax: 2 }]), 4);
  assert.equal(U.coopAscCap([{ ascMax: 2 }, { ascMax: null }]), 2); // a partner without the field (older client) doesn't count
  assert.equal(U.coopAscCap([{}, {}]), U.MAX_ASC);
  assert.equal(U.coopAscCap([]), U.MAX_ASC);
  assert.equal(U.coopAscCap([{ ascMax: 0 }, { ascMax: 7 }]), 7);
  assert.equal(U.coopAscCap([{ ascMax: 0 }, { ascMax: 0 }, { ascMax: 1 }, {}]), 1);
  // it's the unlock for each player's PICKED starter: P1 picked BULBASAUR (A3, though A9 with another starter),
  // P2 picked SQUIRTLE (A5) -> A5
  const p1 = { ascBy: { BULBASAUR: 3, GASTLY: 9 } }, p2 = { ascBy: { SQUIRTLE: 5 } };
  assert.equal(U.coopAscCap([{ ascMax: U.ascUnlocked(p1, 'BULBASAUR') }, { ascMax: U.ascUnlocked(p2, 'SQUIRTLE') }]), 5);
  assert.equal(U.coopAscCap([{ ascMax: 99 }]), U.MAX_ASC);
});
t('ascension: the shiny unlock (A5+) and Nuzlocke (A8) rules are unchanged', () => {
  const meta = { shinies: [] };
  assert.equal(unlockShiny(Run.create({ starter: 'SQUIRTLE', ascension: 5, seed: 'SH5' }), meta), 'SQUIRTLE');
  assert.equal(unlockShiny(Run.create({ starter: 'BULBASAUR', ascension: 4, seed: 'SH4' }), meta), null);
  assert.equal(NUZLOCKE_ASC, 8);
  assert.equal(Run.create({ starter: 'CHARMANDER', ascension: 8, seed: 'NZ' }).nuzlocke, true);
  assert.equal(Run.create({ starter: 'CHARMANDER', ascension: 7, seed: 'NZ' }).nuzlocke, false);
});

// ---- v0.0.7: per-act events, shrines, stories, curses, NUZLOCKE and co-op rules -------------------------------
{
  const EV = await import('../web/src/game/events.js');
  const BOT = await import('./bot.mjs');
  const { CURSES, isCurse } = await import('../web/src/game/items.js');
  const { sellRelicValue } = await import('../web/src/game/shop.js');
  const evRun = (world, a, o = {}) => {
    const r = Run.create({ seed: o.seed || `EV${world}${a}`, world, ascension: o.asc || 0, coop: !!o.coop });
    if (a) r.startAct(a);
    r.floor = o.floor ?? 6; r.nodeId = o.node || '6,3'; r.money = o.money ?? 9000;
    const extra = ['GEODUDE', 'ODDISH', 'PIDGEY', 'MACHOP'];
    for (let i = 0; r.party.length < (o.party ?? 4); i++) r.party.push(makeMon(extra[i], EV.lvl(r), { rng: r.rng }));
    for (const k of o.relics ?? ['CHARCOAL', 'LEFTOVERS', 'SOOTHE_BELL']) r.addRelic(k);
    if (o.flags) Object.assign(r.flags, o.flags);
    return r;
  };
  const runChoice = (r, c, seed = 'x') => { const { mon, keys } = BOT.eventTargets(r, c); return c.run(r, new RNG(seed), mon, keys) || {}; };
  const actsOf = (ev) => (ev.shrine ? [0, 1, 2, 3, 4] : ev.acts);
  // (story fallbacks have no region of their own: they follow you into another region's act)
  const worldsOf = (ev) => (ev.shrine ? ['kanto', 'hoenn', 'johto'] : ev.world ? [ev.world] : ['hoenn']);
  const bad = (s) => typeof s !== 'string' || /undefined|NaN|\[object/.test(s);
  const storyFlags = (ev) => (ev.id === 'cinnabar_lab' || ev.id === 'amber_courier' ? { amber: 'sent' } : ev.id === 'steven_thanks' ? { devon: 'goods' } : ev.id === 'snorlax' ? { flute: 1 } : ev.id === 'wally_challenge' ? { wally: 'helped' } : {});
  const relicsFor = (ev) => (ev.id === 'cinnabar_lab' ? ['HELIX_FOSSIL', 'OLD_AMBER', 'CHARCOAL'] : ev.id === 'snorlax' ? ['POKE_FLUTE', 'CHARCOAL', 'LEFTOVERS'] : undefined);

  t('v0.0.7 events: pools for every act of both worlds, sane data', () => {
    const ids = new Set();
    for (const ev of EV.EVENTS) {
      assert.ok(!ids.has(ev.id), 'duplicate id ' + ev.id); ids.add(ev.id);
      assert.ok(ev.shrine || ((['kanto', 'hoenn', 'johto'].includes(ev.world) || (ev.world === null && ev.follows)) && ev.acts.length && ev.acts.every(a => a >= 0 && a <= 4)), ev.id);
      assert.ok(ev.choices.length >= 2 && ev.choices.length <= 5, ev.id);
    }
    assert.equal(EV.EVENTS.filter(e => e.shrine).length, 6);
    for (const world of ['kanto', 'hoenn', 'johto']) for (let a = 0; a <= 4; a++) assert.ok(EV.EVENTS.filter(e => e.world === world && e.acts.includes(a)).length >= 4, `${world} act ${a + 1} pool`);
    for (const old of ['gift', 'hiker', 'cooltrainer', 'itemball', 'trade', 'oak', 'rocket']) assert.ok(!ids.has(old), 'retired event still there: ' + old);
  });

  t('v0.0.7 events: every event in every act renders and every choice runs (solo, co-op, NUZLOCKE)', () => {
    let n = 0;
    for (const ev of EV.EVENTS) for (const world of worldsOf(ev)) for (const a of actsOf(ev)) for (const mode of ['solo', 'coop', 'nuz']) {
      const o = { coop: mode === 'coop', asc: mode === 'nuz' ? NUZLOCKE_ASC : 0, flags: storyFlags(ev), relics: relicsFor(ev) };
      const r0 = evRun(world, a, o);
      const list = EV.eventChoices(ev, r0);
      assert.ok(list.length >= 1 && list.length <= 5, `${ev.id} ${world} ${a} ${mode}: ${list.length}`);
      assert.ok(list.some(c => !c.cond || c.cond(r0)), `${ev.id} ${mode}: no usable choice`);
      assert.ok(!bad(EV.eventTitle(ev, r0)) && !bad(EV.eventText(ev, r0)), ev.id);
      for (const c of list) {
        assert.ok(!bad(EV.choiceLabel(c, r0)), `${ev.id}: ${EV.choiceLabel(c, r0)}`);
        if (mode === 'coop') assert.ok(!c.solo, `${ev.id}: solo choice shown in co-op`);
        if (mode === 'nuz') assert.ok(!(c.mon === 'gift' || c.mon === 'trade'), `${ev.id}: gift/trade shown under NUZLOCKE`);
        const r = evRun(world, a, o);
        const cc = EV.eventChoices(ev, r).find(x => EV.choiceLabel(x, r) === EV.choiceLabel(c, r0));
        if (!cc || (cc.cond && !cc.cond(r))) continue;
        const res = runChoice(r, cc, `${ev.id}${a}${mode}`);
        n++;
        assert.ok(!bad(res.text), `${ev.id} result text: ${res.text}`);
        if (res.battle) {
          assert.ok(mode !== 'coop', `${ev.id}: a battle in co-op`);
          assert.ok(res.battle.enemies?.length && res.battle.enemies.every(e => e.hp > 0 && e.level >= 2), ev.id);
          if (a >= 3) assert.ok(res.battle.noMoney, `${ev.id}: event battle pays money in act ${a + 1}`);
        }
        if (res.newMon) assert.ok(D.species[res.newMon.species] && res.newMon.moves.length, ev.id);
        for (const k of res.relicChoices || []) assert.ok(RELICS[k] && !isCurse(k), `${ev.id}: ${k}`);
        for (const nx of res.next?.choices || []) { if (!nx.cond || nx.cond(r)) { const r2 = runChoice(r, nx, 'nx'); assert.ok(!bad(r2.text), ev.id); } }
      }
    }
    assert.ok(n > 400, 'choices run: ' + n);
  });

  t('v0.0.7 events: each act draws from its own pool, shrines ~25% and once per act', () => {
    for (const world of ['kanto', 'hoenn']) for (let a = 0; a <= 4; a++) {
      let shrines = 0;
      for (let i = 0; i < 300; i++) {
        const r = evRun(world, a, { seed: 'P' + i });
        r.seenEvents = [];
        const ev = EV.pickEvent(r, new RNG(`pick${world}${a}:${i}`));
        assert.ok(ev.shrine || (ev.world === world && ev.acts.includes(a)), `${world} act ${a + 1} got ${ev.id}`);
        if (ev.shrine) { shrines++; assert.ok(r.seenEvents.includes(`${ev.id}@${a}`)); }
      }
      assert.ok(shrines > 300 * 0.17 && shrines < 300 * 0.33, `${world} act ${a + 1}: ${shrines}/300 shrines`);
    }
    // a shrine seen in act 2 can't come back in act 2, but can in act 3; act events never repeat
    const r = evRun('kanto', 1);
    r.seenEvents = EV.EVENTS.filter(e => e.shrine && e.id !== 'copycat').map(e => `${e.id}@1`).concat(['copycat@1']);
    for (let i = 0; i < 100; i++) { const rr = Object.assign(Object.create(Object.getPrototypeOf(r)), r, { seenEvents: r.seenEvents.slice() }); const ev = EV.pickEvent(rr, new RNG('s' + i)); assert.ok(!ev.shrine, ev.id); }
    r.startAct(2); r.floor = 5;
    let back = false;
    for (let i = 0; i < 200 && !back; i++) { const rr = Object.assign(Object.create(Object.getPrototypeOf(r)), r, { seenEvents: r.seenEvents.slice() }); back = EV.pickEvent(rr, new RNG('t' + i)).id === 'copycat'; }
    assert.ok(back, 'a shrine returns in a later act');
    const r2 = evRun('kanto', 0);
    const seenIds = [];
    for (let i = 0; i < 12; i++) { const ev = EV.pickEvent(r2, new RNG('u' + i)); if (!ev.shrine) { assert.ok(!seenIds.includes(ev.id), 'act event repeated: ' + ev.id); seenIds.push(ev.id); } }
  });

  t('v0.0.7 shrines scale with the act', () => {
    const dl = (a) => { const r = evRun('kanto', a); const c = EV.eventChoices(EV.eventById('deleter'), r)[1]; return runChoice(r, c).deleteCards; };
    assert.equal(dl(0), 2); assert.equal(dl(2), 3);
    const berryHeal = (a) => EV.choiceLabel(EV.eventChoices(EV.eventById('berries'), evRun('kanto', a))[1], evRun('kanto', a));
    assert.match(berryHeal(0), /30%/); assert.match(berryHeal(3), /40%/);
    const prof = (a) => EV.choiceLabel(EV.eventChoices(EV.eventById('professor'), evRun('hoenn', a))[0], evRun('hoenn', a));
    assert.match(prof(0), /\/10\)/); assert.match(prof(2), /\/32\)/);
    assert.equal(EV.eventTitle(EV.eventById('professor'), evRun('hoenn', 0)), 'PROF. BIRCH');
    // premium tutor costs more each act
    const prem = (a) => +EV.choiceLabel(EV.eventChoices(EV.eventById('tutor'), evRun('kanto', a))[1], evRun('kanto', a)).match(/\$(\d+)/)[1];
    assert.ok(prem(0) < prem(1) && prem(1) < prem(3));
    // Bill's wonder trade: a stronger species, Lv +1
    const r = evRun('kanto', 0); const mon = r.party[1];
    const res = EV.eventChoices(EV.eventById('pc'), r)[0].run(r, new RNG('wt'), mon, []);
    assert.equal(res.traded.level, mon.level + 1); assert.ok(r.party.includes(res.traded) && !r.party.includes(mon));
  });

  t('v0.0.7 bug fix: the act 1 tutor never teaches 120-power moves or EXPLOSION', () => {
    const party = (r) => { r.party = ['GEODUDE', 'MACHOP', 'SNORLAX', 'CHARMANDER', 'BULBASAUR', 'SQUIRTLE'].map(sp => makeMon(sp, 12, { rng: r.rng })); };
    const seen = [new Set(), new Set(), new Set()];
    for (let a = 0; a < 3; a++) for (let i = 0; i < 80; i++) { const r = evRun('kanto', a); party(r); for (const c of EV.tutorChoices(r, new RNG('tu' + a + i), 4)) seen[a].add(c.move); }
    for (const m of seen[0]) { assert.ok((D.moves[m].power || 0) <= 80 && m !== 'EXPLOSION', 'act 1 tutor: ' + m); }
    for (const m of seen[1]) assert.ok((D.moves[m].power || 0) <= 100 && m !== 'EXPLOSION', 'act 2 tutor: ' + m);
    assert.ok(seen[2].has('EXPLOSION') || seen[2].has('DOUBLE_EDGE'), 'act 3 tutor opens up');
  });

  t('v0.0.7 bug fix: EEVEE, LAPRAS and the HITMONs can be had (themed events)', () => {
    const r = evRun('kanto', 1);
    const eevee = runChoice(r, EV.eventChoices(EV.eventById('bill_cottage'), r).find(c => /EEVEE/.test(EV.choiceLabel(c, r))));
    assert.equal(eevee.newMon.species, 'EEVEE'); assert.ok(eevee.itemChoices.keys.includes('WATER_STONE'));
    const r3 = evRun('kanto', 2);
    const lapras = runChoice(r3, EV.eventChoices(EV.eventById('silph'), r3).find(c => /LAPRAS/.test(EV.choiceLabel(c, r3))));
    assert.equal(lapras.newMon.species, 'LAPRAS');
    const dojo = runChoice(r3, EV.eventChoices(EV.eventById('dojo'), r3)[0]);
    assert.deepEqual(dojo.battle.rewardMons.map(m => m.species).sort(), ['HITMONCHAN', 'HITMONLEE']);
    const h = evRun('hoenn', 1);
    assert.equal(runChoice(h, EV.eventChoices(EV.eventById('lavaridge'), h)[1]).newMon.species, 'WYNAUT');
  });

  t('v0.0.7 bug fix: the bots use the MOVE DELETER (cards really go)', () => {
    const r = evRun('kanto', 1);
    const lead = r.party[0];
    lead.moves = [{ move: 'GROWL', copies: 2 }, { move: 'SCRATCH', copies: 4 }, { move: 'EMBER', copies: 4 }];
    const cards = () => r.party.reduce((n, m) => n + m.moves.reduce((a, x) => a + x.copies, 0), 0);
    const before = cards();
    BOT.doEvent(r, new RNG('del'), 'smart', null, 'deleter');
    assert.ok(cards() < before);
    assert.ok(r.seenEvents.includes('deleter@1'));
  });

  t('v0.0.7 stories: the OLD AMBER and DEVON GOODS pay off after a save/reload', () => {
    const r = evRun('kanto', 0, { relics: [] });
    runChoice(r, EV.eventChoices(EV.eventById('amber'), r).find(c => /revived/.test(EV.choiceLabel(c, r))));
    assert.equal(r.flags.amber, 'sent');
    const r2 = Run.fromJSON(JSON.parse(JSON.stringify(r)));
    r2.startAct(2); r2.floor = 2; r2.nodeId = '2,1';
    const ev = EV.pickEvent(r2, new RNG('act3'));
    assert.equal(ev.id, 'cinnabar_lab', 'forced at the first "?" of act 3');
    const res = runChoice(r2, EV.eventChoices(ev, r2)[0]);
    assert.equal(res.newMon.species, 'AERODACTYL'); assert.equal(r2.flags.amber, 'done');
    // Hoenn: DEVON GOODS -> STEVEN at act 3
    const h = evRun('hoenn', 0, { relics: [] });
    runChoice(h, EV.eventChoices(EV.eventById('devon_corp'), h).find(c => /DEVON GOODS/.test(EV.choiceLabel(c, h))));
    const h2 = Run.fromJSON(JSON.parse(JSON.stringify(h)));
    h2.startAct(2); h2.floor = 1;
    assert.equal(EV.pickEvent(h2, new RNG('h3')).id, 'steven_thanks');
    // without the story, STEVEN never shows up
    const h3 = evRun('hoenn', 2);
    for (let i = 0; i < 100; i++) { h3.seenEvents = []; assert.notEqual(EV.pickEvent(h3, new RNG('n' + i)).id, 'steven_thanks'); }
  });

  t('v0.0.7 stories: TEAM ROCKET membership and the POKé FLUTE carry across acts', () => {
    const r = evRun('kanto', 1);
    runChoice(r, EV.eventChoices(EV.eventById('nugget_bridge'), r).find(c => /Join/.test(EV.choiceLabel(c, r))));
    assert.equal(r.flags.rocket2, 'joined'); assert.equal(r.relics.length, 2);
    const r2 = Run.fromJSON(JSON.parse(JSON.stringify(r)));
    r2.startAct(2); r2.floor = 6;
    const hp = r2.party.map(m => m.hp);
    const sneak = EV.eventChoices(EV.eventById('silph'), r2).find(c => /uniform/.test(EV.choiceLabel(c, r2)));
    assert.ok(sneak, 'in uniform');
    runChoice(r2, sneak);
    assert.deepEqual(r2.party.slice(0, hp.length).map(m => m.hp), hp, 'no HP lost in uniform');
    assert.ok(/family price/.test(EV.eventText(EV.eventById('blackmarket'), r2)));
    // POKé FLUTE (act 2) -> SNORLAX (act 3)
    const f = evRun('kanto', 1);
    runChoice(f, EV.eventChoices(EV.eventById('fuji'), f).find(c => /FLUTE/.test(EV.choiceLabel(c, f))));
    const f2 = Run.fromJSON(JSON.parse(JSON.stringify(f)));
    f2.startAct(2); f2.floor = 6;
    const flute = EV.eventChoices(EV.eventById('snorlax'), f2).find(c => /FLUTE/.test(EV.choiceLabel(c, f2)));
    assert.equal(runChoice(f2, flute).newMon.species, 'SNORLAX');
  });

  t('v0.0.7 curses: 5 curse held items, never offered, cannot be sold, removable', () => {
    assert.ok(CURSES.length >= 4 && CURSES.length <= 6);
    const r = evRun('kanto', 1, { relics: [] });
    for (const k of CURSES) { assert.equal(RELICS[k].rarity, 'curse'); assert.ok(D.items[k]?.name && RELICS[k].icon && D.items[RELICS[k].icon], k); }
    for (let i = 0; i < 200; i++) for (const k of r.relicChoices(new RNG('rc' + i), 4, { common: 1, uncommon: 1, rare: 1 })) assert.ok(!isCurse(k));
    for (let i = 0; i < 30; i++) assert.ok(!generateShop(r, new RNG('sh' + i)).items.some(it => isCurse(it.key)));
    // effects
    r.addRelic('CURSED_DOLL'); r.addRelic('IOU_NOTE'); r.addRelic('ROTTEN_MUSHROOM');
    const b = new Battle(r, r.trainerConfig(new RNG('cb'), 3));
    assert.equal(b.handSize, DECK_RULES.hand - 1);
    assert.equal(r.price(1000), Math.round(1000 * 1.3 * 1.25 / 10) * 10);
    const m = r.party[0]; m.hp = maxHp(m);
    r.afterBattle({ result: { outcome: 'win', money: 0, exp: 0, participants: [] }, kind: 'trainer', enemies: [], cfg: {} });
    assert.ok(m.hp < maxHp(m), 'ROTTEN SHROOM bites after battles');
    // CENTER cleanse (paid), MR. FUJI (free), bots cleanse at Centers
    const money = r.money;
    assert.ok(r.cleanse('CURSED_DOLL')); assert.equal(r.money, money - r.cleanseCost()); assert.ok(!r.hasRelic('CURSED_DOLL'));
    const fuji = EV.eventChoices(EV.eventById('fuji'), r).find(c => /Cleanse/.test(EV.choiceLabel(c, r)));
    runChoice(r, fuji);
    assert.equal(r.curses().length, 0);
    r.addRelic('LAGGING_TAIL'); r.money = 5000;
    BOT.doCenter(r, 'smart');
    assert.equal(r.curses().length, 0, 'bot cleansed');
    // Mt. Pyre cleanses too (Hoenn 3)
    const h = evRun('hoenn', 2); h.addRelic('HEX_LETTER');
    runChoice(h, EV.eventChoices(EV.eventById('mt_pyre'), h)[0]);
    assert.equal(h.curses().length, 0);
    // events that hand out a curse put it on the run
    const g = evRun('kanto', 1);
    const res = runChoice(g, EV.eventChoices(EV.eventById('ghost'), g).find(c => /offering/.test(EV.choiceLabel(c, g))));
    assert.equal(res.curse, 'CURSED_DOLL'); assert.ok(g.hasRelic('CURSED_DOLL'));
    // trades never take curses
    const v = evRun('kanto', 3); v.addRelic('HEX_LETTER');
    const { keys } = BOT.eventTargets(v, EV.eventChoices(EV.eventById('veteran'), v)[0]);
    assert.ok(keys.length === 2 && keys.every(k => !isCurse(k)));
  });

  t('v0.0.7 NUZLOCKE: no gift/trade POKéMON; an event catch is the act\'s one catch', () => {
    const r = evRun('kanto', 2, { asc: NUZLOCKE_ASC });
    assert.ok(r.nuzlocke);
    for (const ev of EV.EVENTS) for (const c of EV.eventChoices(ev, r)) assert.ok(c.mon !== 'gift' && c.mon !== 'trade', ev.id);
    // gift-only events stay out of the pool (the MAGIKARP salesman)
    const k = evRun('kanto', 0, { asc: NUZLOCKE_ASC });
    for (let i = 0; i < 200; i++) { k.seenEvents = []; assert.notEqual(EV.pickEvent(k, new RNG('nz' + i)).id, 'magikarp'); }
    // SAFARI: catching there uses up the act's catch, then wild battles can't be caught
    const safari = EV.eventChoices(EV.eventById('safari'), r)[0];
    assert.ok(safari.cond(r));
    runChoice(r, safari, 'saf');
    assert.ok(!EV.nuzCatchOk(r) && !safari.cond(r));
    const wild = r.battleConfig({ id: '7,1', type: 'wild', floor: 7 });
    assert.equal(wild.nuzFirst, false);
    // once the act's first wild battle happened, event catches are off
    const r2 = evRun('kanto', 2, { asc: NUZLOCKE_ASC });
    r2.battleConfig({ id: '3,1', type: 'wild', floor: 3 });
    assert.ok(!EV.eventChoices(EV.eventById('fishing'), r2)[0].cond(r2));
    // a new act brings a new catch
    r2.startAct(3); assert.ok(EV.nuzCatchOk(r2));
    // replacements keep the event worth visiting (Bill's PC)
    assert.ok(EV.eventChoices(EV.eventById('pc'), r).some(c => /PC box/.test(EV.choiceLabel(c, r))));
  });

  t('v0.0.7 co-op: battle choices are solo-only; the shared pick is the same for both players', () => {
    for (const world of ['kanto', 'hoenn']) for (let a = 0; a <= 4; a++) {
      const p0 = evRun(world, a, { coop: true }), p1 = evRun(world, a, { coop: true, seed: 'other' });
      p1.party.pop();
      const w = Object.assign(evRun(world, a, { coop: true }), { seed: 'ROOM' });
      for (let i = 0; i < 40; i++) {
        w.nodeId = `${i},2`;
        const probeA = EV.coopProbe(w, [p0, p1]), probeB = EV.coopProbe(w, [p1, p0]);
        const ea = EV.pickEvent(probeA, new RNG('room:' + i)), eb = EV.pickEvent(probeB, new RNG('room:' + i));
        assert.equal(ea.id, eb.id);
        assert.ok(ea.choices.some(c => !c.solo && !c.leave), ea.id + ' has nothing for co-op');
        for (const c of EV.eventChoices(ea, p0)) assert.ok(!c.solo, ea.id);
      }
    }
    // story flags of either player decide a forced event for both
    const p0 = evRun('kanto', 2, { coop: true }), p1 = evRun('kanto', 2, { coop: true, flags: { amber: 'sent' } });
    assert.equal(EV.pickEvent(EV.coopProbe(Object.assign(evRun('kanto', 2), { seed: 'R' }), [p0, p1]), new RNG('f')).id, 'cinnabar_lab');
    // the POWER PLANT ball can't start a battle in co-op
    const pp = evRun('kanto', 2, { coop: true });
    for (let i = 0; i < 40; i++) { const res = EV.eventChoices(EV.eventById('powerplant'), pp)[0].run(pp, new RNG('pp' + i)); assert.ok(!res.battle); }
  });

  t('v0.0.7: no event money from act 4 on', () => {
    for (const ev of EV.EVENTS) for (const world of worldsOf(ev)) for (const a of actsOf(ev).filter(x => x >= 3)) {
      for (let s = 0; s < 4; s++) {
        const r0 = evRun(world, a, { flags: storyFlags(ev), relics: relicsFor(ev) });
        for (const c of EV.eventChoices(ev, r0)) {
          const r = evRun(world, a, { flags: storyFlags(ev), relics: relicsFor(ev) });
          const cc = EV.eventChoices(ev, r).find(x => EV.choiceLabel(x, r) === EV.choiceLabel(c, r0));
          if (!cc || (cc.cond && !cc.cond(r))) continue;
          const before = r.money;
          const res = runChoice(r, cc, `m${s}`);
          assert.ok(r.money <= before, `${ev.id} act ${a + 1} "${EV.choiceLabel(cc, r)}" paid $${r.money - before}`);
          for (const k of [...(res.overflow || []), ...(res.itemChoices?.keys || [])]) assert.ok(!CONSUMABLES[k]?.sell, `${ev.id}: money item ${k}`);
          if (res.battle) assert.ok(res.battle.noMoney, ev.id);
        }
      }
    }
    assert.equal(EV.moneyReward(evRun('kanto', 3), 1000), 0);
    const r = evRun('kanto', 3);
    const out = r.afterBattle({ result: { outcome: 'win', money: 900, exp: 0, participants: [] }, kind: 'elite', enemies: [], cfg: { noMoney: true } });
    assert.equal(out.moneyFinal, 0);
  });
  // ---- v0.1.0 One Spire ------------------------------------------------------------------------------------
  const RG = await import('../web/src/game/regions.js');
  const { runPayload } = await import('../web/src/net/cloud.js');
  const SP = (acts, summit = acts[3], post = acts[0]) => ({ acts, summit, post });
  const spireRun = (sp, o = {}) => {
    const r = Run.create({ seed: o.seed || 'SPIRE' + sp.acts.join(''), world: 'spire', regions: sp, starter: o.starter || 'CHARMANDER', ascension: o.asc || 0 });
    if (o.act) r.startAct(o.act);
    r.floor = o.floor ?? 6; r.nodeId = o.node || '6,3'; r.money = o.money ?? 9000;
    const extra = ['GEODUDE', 'ODDISH', 'PIDGEY', 'MACHOP'];
    for (let i = 0; r.party.length < (o.party ?? 4); i++) r.party.push(makeMon(extra[i], EV.lvl(r), { rng: r.rng }));
    for (const k of o.relics ?? ['CHARCOAL', 'LEFTOVERS', 'SOOTHE_BELL']) r.addRelic(k);
    if (o.flags) Object.assign(r.flags, o.flags);
    return r;
  };
  const reload = (r) => Run.fromJSON(JSON.parse(JSON.stringify(r)));
  const ALL16 = [];
  for (let m = 0; m < 16; m++) ALL16.push([0, 1, 2, 3].map(b => (m >> b) & 1 ? 'hoenn' : 'kanto'));

  t('v0.1.0 region registry: the legacy worlds keep their exact act lists, every act knows its region', () => {
    assert.equal(RG.actsFor('kanto'), ACTS); assert.equal(RG.actsFor('hoenn'), HOENN_ACTS); assert.equal(RG.actsFor('nope'), ACTS);
    for (const a of ACTS) assert.equal(a.region, 'kanto'); for (const a of HOENN_ACTS) assert.equal(a.region, 'hoenn');
    const k = Run.create({ seed: 'REG', world: 'kanto' }), h = Run.create({ seed: 'REG', world: 'hoenn', starter: 'TORCHIC' });
    assert.equal(k.acts, ACTS); assert.equal(h.acts, HOENN_ACTS);
    assert.equal(k.region, 'kanto'); assert.equal(h.region, 'hoenn'); assert.equal(h.rivalRegion, 'hoenn'); assert.equal(k.summitRegion, 'kanto');
    assert.equal(RG.regionIdOf({ world: 'hoenn' }), 'hoenn'); assert.equal(RG.regionIdOf({ region: 'hoenn', world: 'spire' }), 'hoenn'); assert.equal(RG.regionIdOf({ world: 'spire' }), 'kanto');
    assert.equal(RG.regionOf('kanto').summit.hp, 1); assert.equal(RG.regionOf('hoenn').summit.hp, 1.15);
    // the rival tables behave as before (MAY's three for 'hoenn', BLUE's for 'kanto')
    assert.equal(counterStarter('TREECKO', 'hoenn'), 'TORCHIC'); assert.equal(counterStarter('CHARMANDER', 'kanto'), 'SQUIRTLE');
    assert.equal(h.rivalTrainer().party.at(-1).species, mayPartyAce(counterStarter('TORCHIC', 'hoenn')));
  });
  function mayPartyAce(counter) { return { TORCHIC: 'TORCHIC', MUDKIP: 'MUDKIP', TREECKO: 'TREECKO' }[counter]; }

  t('v0.1.0 spire draws: deterministic per seed, every tier sees both regions, summit/post-game from visited', () => {
    assert.deepEqual(RG.drawSpire('SEED1', ['kanto', 'hoenn']), RG.drawSpire('SEED1', ['kanto', 'hoenn']));
    assert.deepEqual(Run.create({ seed: 'SEED1', world: 'spire', pool: ['kanto', 'hoenn'] }).regions, RG.drawSpire('SEED1', ['kanto', 'hoenn']));
    const seen = [new Set(), new Set(), new Set(), new Set()], seqs = new Set();
    for (let i = 0; i < 300; i++) {
      const d = RG.drawSpire('D' + i, ['kanto', 'hoenn']);
      d.acts.forEach((id, t2) => seen[t2].add(id)); seqs.add(RG.spireCode(d));
      assert.ok(d.acts.includes(d.summit) && d.acts.includes(d.post), 'summit and post-game come from a visited region');
    }
    for (const s of seen) assert.deepEqual([...s].sort(), ['hoenn', 'kanto']);
    assert.equal(seqs.size, 16, 'all 16 sequences show up');
    // KANTO-only pool: every slot is KANTO, and the run plays exactly like the old KANTO world (same map, same foes)
    for (const st of ['CHARMANDER', 'PIKACHU']) {
      const s = Run.create({ seed: 'SAME' + st, world: 'spire', pool: ['kanto'], starter: st }), k = Run.create({ seed: 'SAME' + st, world: 'kanto', starter: st });
      assert.deepEqual(s.regions, SP(['kanto', 'kanto', 'kanto', 'kanto'], 'kanto', 'kanto'));
      assert.deepEqual(s.map, k.map);
      for (let a = 0; a < 4; a++) {
        if (a) { s.startAct(a); k.startAct(a); }
        assert.deepEqual(s.act.levels, k.act.levels); assert.equal(s.act.bossLevel, k.act.bossLevel); assert.equal(s.act.rival, k.act.rival); assert.deepEqual(s.map, k.map); assert.equal(s.boss, k.boss);
        const cs = [s.wildConfig(new RNG('w' + a), 5), s.trainerConfig(new RNG('t' + a), 5), a < 3 ? s.bossConfig(new RNG('b' + a)) : s.gauntletConfig(new RNG('g' + a), 4)];
        const ck = [k.wildConfig(new RNG('w' + a), 5), k.trainerConfig(new RNG('t' + a), 5), a < 3 ? k.bossConfig(new RNG('b' + a)) : k.gauntletConfig(new RNG('g' + a), 4)];
        assert.deepEqual(cs.map(c => c.enemies.map(e => [e.species, e.level, e.maxHp])), ck.map(c => c.enemies.map(e => [e.species, e.level, e.maxHp])));
      }
    }
  });

  t('v0.1.0 spire acts: levels follow the tier, one rival per run, act 4 takes the summit\'s ELITE FOUR', () => {
    for (const acts of ALL16) for (const summit of ['kanto', 'hoenn']) {
      const sp = SP(acts, summit, acts[1]), list = RG.spireActs(sp, 'kanto');
      assert.equal(list.length, 5);
      list.slice(0, 4).forEach((a, t2) => {
        assert.equal(a.region, acts[t2]); assert.deepEqual(a.levels, RG.TIERS[t2].levels); assert.equal(a.bossLevel, RG.TIERS[t2].bossLevel);
        assert.equal(a.short, `ACT ${t2 + 1}`);
        if (t2 < 3) { assert.equal(a.rival, ACTS[t2].rival, 'BLUE every act'); assert.equal(RG.spireActs(sp, 'hoenn')[t2].rival, HOENN_ACTS[t2].rival, 'MAY every act'); }
        assert.deepEqual(a.areas, RG.regionOf(acts[t2]).acts[t2].areas); assert.deepEqual(a.bosses, RG.regionOf(acts[t2]).acts[t2].bosses); assert.equal(a.bird, RG.regionOf(acts[t2]).acts[t2].bird);
      });
      assert.deepEqual(list[3].gauntlet, RG.regionOf(summit).acts[3].gauntlet); assert.equal(list[3].summit, summit);
      assert.deepEqual(list[3].gauntletLevels, RG.GAUNTLET_LEVELS);
      assert.ok(list[3].name.endsWith(RG.regionOf(summit).summit.place), list[3].name);
      assert.equal(list[4].region, acts[1]); assert.ok(list[4].postgame);
    }
    assert.equal(RG.rivalFor('TORCHIC'), 'hoenn'); assert.equal(RG.rivalFor('BELDUM'), 'hoenn'); assert.equal(RG.rivalFor('CHARMANDER'), 'kanto'); assert.equal(RG.rivalFor('CHIKORITA'), 'johto');
    // the source act blocks are untouched by the builder
    assert.deepEqual(HOENN_ACTS[0].levels, [4, 13]); assert.equal(HOENN_ACTS[1].rival, 'MAY_2'); assert.ok(!ACTS[3].summit);
  });

  t('v0.1.0 spire: every region mix builds every fight (rival, gyms, birds, ELITE FOUR) with real songs', () => {
    const bankPath = new URL('../web/assets/sound/bank.json', import.meta.url);
    const songs = fs.existsSync(bankPath) ? new Set(Object.keys(JSON.parse(fs.readFileSync(bankPath, 'utf8')).songs)) : null;
    const missing = new Set();
    for (const acts of ALL16) for (const starter of ['CHARMANDER', 'MUDKIP']) {
      const r = Run.create({ seed: 'MIX' + acts.join('') + starter, world: 'spire', starter, regions: SP(acts, acts[2], acts[0]) });
      for (let a = 0; a < r.acts.length; a++) {
        if (a) r.startAct(a);
        const act = r.act, cfgs = [r.wildConfig(r.rng.fork('w'), 8), r.trainerConfig(r.rng.fork('t'), 8), r.eliteConfig(r.rng.fork('e'), 8)];
        if (act.rival) { const c = r.rivalConfig(r.rng.fork('r'), 10); assert.ok(c.rival, 'rival floor'); assert.equal(c.trainer.encounterSong, RG.regionOf(RG.rivalFor(starter)).rival.encounterSong); cfgs.push(c); }
        if (act.bird) cfgs.push(r.legendConfig(r.rng.fork('l'), 8, act.bird));
        if (act.gauntlet) for (let g = 0; g < act.gauntlet.length; g++) { const c = r.gauntletConfig(r.rng.fork('g' + g), g); assert.ok(c.enemies.length >= 1); cfgs.push(c); }
        else cfgs.push(r.bossConfig(r.rng.fork('b')));
        for (const c of cfgs) {
          assert.ok(c && c.enemies.length && c.enemies.every(e => D.species[e.species] && e.level > 0 && e.maxHp > 0), `${acts} act ${a + 1}`);
          if (songs) for (const s of [c.music, c.trainer?.battleSong, c.trainer?.encounterSong]) if (s && !songs.has(s)) missing.add(s);
        }
        if (songs) for (const s of [...act.music, act.townMusic, ...act.areas.map(x => x.music).filter(Boolean)]) if (!songs.has(s)) missing.add(s);
      }
    }
    assert.deepEqual([...missing], []);
  });

  t('v0.1.0 unlocks: KANTO-only spire before a first win; HOENN starters kept by players who had HOENN', () => {
    assert.deepEqual(RG.unlockedRegions({ unlocks: {} }), ['kanto']); assert.deepEqual(RG.unlockedRegions({}), ['kanto']);
    assert.deepEqual(RG.unlockedRegions({ unlocks: { win: true } }), ['kanto', 'hoenn']);
    for (let i = 0; i < 50; i++) assert.deepEqual(Run.create({ seed: 'NEW' + i, world: 'spire', pool: RG.unlockedRegions({ unlocks: {} }) }).regions.acts, ['kanto', 'kanto', 'kanto', 'kanto']);
    assert.equal(RG.coopWorldFor({ unlocks: {} }), 'spire_kanto'); assert.equal(RG.coopWorldFor({ unlocks: { win: true } }), 'spire');
    // migration: a player with HOENN access keeps TREECKO / TORCHIC / MUDKIP (once), a new player doesn't get them
    const vet = { unlocks: { win: true }, starterVer: 2, unlockedStarters: ['BULBASAUR', 'CHARMANDER', 'SQUIRTLE', 'DRATINI'] };
    assert.equal(U.migrateSpireMeta(vet), true);
    assert.deepEqual(vet.unlockedStarters, ['BULBASAUR', 'CHARMANDER', 'SQUIRTLE', 'DRATINI', 'TREECKO', 'TORCHIC', 'MUDKIP']);
    assert.equal(U.migrateSpireMeta(vet), false, 'runs once');
    const fresh = { unlocks: {} }; U.migrateStarterMeta(fresh); U.migrateSpireMeta(fresh);
    assert.deepEqual(fresh.unlockedStarters, ['BULBASAUR', 'CHARMANDER', 'SQUIRTLE']);
    for (const s of U.HOENN_STARTERS) assert.equal(U.isStarterUnlocked(fresh, s, 'spire'), false);
    for (const s of U.HOENN_STARTERS) assert.equal(U.isStarterUnlocked(vet, s, 'spire'), true);
    // a fresh player who wins later gets HOENN acts, not the starters (they're act-clear unlocks now)
    fresh.unlocks.win = true; assert.equal(U.migrateSpireMeta(fresh), false); assert.ok(!fresh.unlockedStarters.includes('TORCHIC'));
    // an old save (no starterVer): the v0.0.5 reset runs first, then the spire migration adds the HOENN three back
    const old = { unlocks: { win: true }, unlockedStarters: ['BULBASAUR', 'EEVEE'] };
    U.migrateStarterMeta(old); U.migrateSpireMeta(old);
    assert.deepEqual(old.unlockedStarters, ['BULBASAUR', 'CHARMANDER', 'SQUIRTLE', 'TREECKO', 'TORCHIC', 'MUDKIP']);
  });

  t('v0.1.0 stories across regions (and a save/reload in between)', () => {
    // OLD AMBER: act 3 in KANTO -> the CINNABAR LAB; act 3 in HOENN -> the lab's courier
    for (const [acts, want] of [[['kanto', 'hoenn', 'kanto', 'hoenn'], 'cinnabar_lab'], [['kanto', 'kanto', 'hoenn', 'kanto'], 'amber_courier']]) {
      const r = spireRun(SP(acts), { relics: [] });
      const send = EV.eventChoices(EV.eventById('amber'), r).find(c => /revived/.test(EV.choiceLabel(c, r)));
      assert.ok(/CINNABAR LAB/.test(typeof send.tip === 'function' ? send.tip(r) : send.tip));
      runChoice(r, send);
      const r2 = reload(r); r2.startAct(2); r2.floor = 2; r2.nodeId = '2,1';
      const ev = EV.pickEvent(r2, new RNG('a3'));
      assert.equal(ev.id, want);
      const res = runChoice(r2, EV.eventChoices(ev, r2)[0]);
      assert.equal(res.newMon.species, 'AERODACTYL'); assert.equal(r2.flags.amber, 'done');
      // never twice
      r2.seenEvents = []; for (let i = 0; i < 40; i++) assert.ok(!['amber_courier'].includes(EV.pickEvent(r2, new RNG('x' + i)).id));
    }
    // the courier never shows up in KANTO or without the story
    const k3 = spireRun(SP(['hoenn', 'hoenn', 'hoenn', 'hoenn']), { act: 2 });
    for (let i = 0; i < 100; i++) { k3.seenEvents = []; assert.notEqual(EV.pickEvent(k3, new RNG('c' + i)).id, 'amber_courier'); }
    // DEVON GOODS (HOENN 1) -> STEVEN finds you in a KANTO act 3
    const h = spireRun(SP(['hoenn', 'kanto', 'kanto', 'kanto']), { relics: [] });
    runChoice(h, EV.eventChoices(EV.eventById('devon_corp'), h).find(c => /DEVON GOODS/.test(EV.choiceLabel(c, h))));
    const h2 = reload(h); h2.startAct(2); h2.floor = 1;
    const st = EV.pickEvent(h2, new RNG('h3'));
    assert.equal(st.id, 'steven_thanks'); assert.ok(/all the way to KANTO/.test(EV.eventText(st, h2)));
    runChoice(h2, EV.eventChoices(st, h2)[2]); assert.equal(h2.flags.devon, 'done');
    // TEAM ROCKET membership (KANTO 2) -> the HOENN black market treats you as one of their own (act 4)
    const rk = spireRun(SP(['kanto', 'kanto', 'hoenn', 'hoenn']), { act: 1 });
    runChoice(rk, EV.eventChoices(EV.eventById('nugget_bridge'), rk).find(c => /Join/.test(EV.choiceLabel(c, rk))));
    const rk2 = reload(rk); rk2.startAct(3); rk2.floor = 3;
    assert.ok(/best customer/.test(EV.eventText(EV.eventById('blackmarket_h'), rk2)));
    // ... and TEAM MAGMA membership (HOENN 2) gets you into SILPH CO. in a KANTO act 3
    const mg = spireRun(SP(['hoenn', 'hoenn', 'kanto', 'kanto']), { act: 1, money: 9000 });
    runChoice(mg, EV.eventChoices(EV.eventById('meteor_falls'), mg).find(c => /Buy it back/.test(EV.choiceLabel(c, mg))));
    assert.equal(mg.flags.aqua2, 'joined');
    const mg2 = reload(mg); mg2.startAct(2); mg2.floor = 6;
    assert.ok(/TEAM MAGMA/.test(EV.eventText(EV.eventById('silph'), mg2)));
    assert.ok(EV.eventChoices(EV.eventById('silph'), mg2).some(c => /uniform/.test(EV.choiceLabel(c, mg2))));
    // beating TEAM AQUA (HOENN 1) is remembered at NUGGET BRIDGE (KANTO 2), and TEAM ROCKET (KANTO 1) at METEOR FALLS
    const aq = spireRun(SP(['hoenn', 'kanto', 'kanto', 'kanto']), { act: 1, flags: { aqua1: 'beat' } });
    assert.ok(/TEAM AQUA/.test(EV.eventText(EV.eventById('nugget_bridge'), reload(aq))));
    const rb = spireRun(SP(['kanto', 'hoenn', 'kanto', 'kanto']), { act: 1, flags: { rocket1: 'beat' } });
    assert.ok(/TEAM ROCKET at MT. MOON/.test(EV.eventText(EV.eventById('meteor_falls'), reload(rb))));
    // WALLY (helped in HOENN 1) can challenge you on a KANTO act 4, and only then
    const w = spireRun(SP(['hoenn', 'kanto', 'kanto', 'kanto']), { act: 3, flags: { wally: 'helped' } });
    let met = 0; for (let i = 0; i < 80; i++) { const w2 = reload(w); w2.seenEvents = []; if (EV.pickEvent(w2, new RNG('w' + i)).id === 'wally_challenge') met++; }
    assert.ok(met > 0, 'WALLY follows you');
    const w3 = spireRun(SP(['kanto', 'kanto', 'kanto', 'kanto']), { act: 3 });
    for (let i = 0; i < 80; i++) { w3.seenEvents = []; assert.notEqual(EV.pickEvent(w3, new RNG('w' + i)).id, 'wally_challenge'); }
    // the co-op probe carries the act's region, so both players get the same region's events
    const probe = EV.coopProbe(spireRun(SP(['kanto', 'hoenn', 'kanto', 'kanto']), { act: 1 }), [spireRun(SP(['kanto', 'hoenn', 'kanto', 'kanto']), { act: 1 })]);
    assert.equal(probe.region, 'hoenn');
    const pe = EV.pickEvent(probe, new RNG('p'));
    assert.ok(pe.shrine || pe.world === 'hoenn', pe.id);
  });

  t('v0.1.0 saves: an old KANTO / HOENN run in progress finishes in its own act list', () => {
    // a v0.0.7 save: world 'hoenn', no regions / rival fields
    const old = Run.create({ seed: 'OLDSAVE', world: 'hoenn', starter: 'MUDKIP' });
    old.startAct(2); old.floor = 5;
    const o = JSON.parse(JSON.stringify(old)); delete o.regions; delete o.rival;
    const r = Run.fromJSON(o);
    assert.equal(r.acts, HOENN_ACTS); assert.equal(r.act.name, 'FORTREE → SOOTOPOLIS'); assert.deepEqual(r.act.levels, [26, 37]);
    assert.equal(r.rivalRegion, 'hoenn'); assert.equal(r.rivalTrainer().key, 'MAY_3');
    const c = r.battleConfig({ id: '5,1', type: 'trainer', floor: 5 }); assert.ok(c.enemies.length);
    r.startAct(3); assert.deepEqual(r.act.gauntlet, HOENN_ACTS[3].gauntlet); assert.equal(r.summitRegion, 'hoenn');
    const k = Run.fromJSON(JSON.parse(JSON.stringify(Run.create({ seed: 'OLDK', world: 'kanto', starter: 'TORCHIC' }))));
    assert.equal(k.acts, ACTS); assert.equal(k.rivalRegion, 'kanto', 'a HOENN starter met BLUE in the old KANTO world');
    // a spire save reloads into the same act list (and the cache hands back the same object)
    const s = spireRun(SP(['hoenn', 'kanto', 'hoenn', 'kanto'], 'hoenn', 'kanto'), { act: 2 });
    const s2 = reload(s);
    assert.equal(s2.acts, s.acts); assert.equal(s2.region, 'hoenn'); assert.equal(s2.act.bosses, HOENN_ACTS[2].bosses);
  });

  t('v0.1.0 records: spire runs upload world "spire" with their region route', () => {
    const r = spireRun(SP(['kanto', 'hoenn', 'hoenn', 'kanto'], 'hoenn', 'kanto'));
    assert.equal(RG.spireCode(r.regions), 'K-H-H-K');
    const p = runPayload(r, 'lose');
    assert.equal(p.world, 'spire'); assert.equal(p.regions, 'K-H-H-K');
    const legacy = runPayload(Run.create({ seed: 'L', world: 'hoenn' }), 'win');
    assert.equal(legacy.world, 'hoenn'); assert.ok(!('regions' in legacy));
    const log = r.finishLog('lose');
    assert.equal(log.end.world, 'spire'); assert.equal(log.end.regions, 'K-H-H-K'); assert.equal(log.end.summit, 'hoenn');
  });

  // ---- v0.1.1 JOHTO (third spire region, HeartGold) ------------------------------------------------------------
  const { JOHTO_ACTS, JOHTO_TRAINERS } = await import('../web/src/game/johto.js');
  const { BOSS_RULES } = await import('../web/src/game/bosses.js');
  const { SILVER_STARTER, rivalParty } = await import('../web/src/game/acts.js');
  const ITEMS = await import('../web/src/game/items.js');
  const J = 'johto', Kt = 'kanto', Ht = 'hoenn';
  const JLINES = { CHIKORITA: ['CHIKORITA', 'BAYLEEF', 'MEGANIUM'], CYNDAQUIL: ['CYNDAQUIL', 'QUILAVA', 'TYPHLOSION'], TOTODILE: ['TOTODILE', 'CROCONAW', 'FERALIGATR'] };
  const bankPathJ = new URL('../web/assets/sound/bank.json', import.meta.url);
  const SONGS = fs.existsSync(bankPathJ) ? new Set(Object.keys(JSON.parse(fs.readFileSync(bankPathJ, 'utf8')).songs)) : null;
  // every region mix with at least one JOHTO act (65 of the 81 K/H/J sequences)
  const MIXJ = [];
  for (let m = 0; m < 81; m++) { const acts = [0, 1, 2, 3].map(b => [Kt, Ht, J][Math.floor(m / 3 ** b) % 3]); if (acts.includes(J)) MIXJ.push(acts); }

  t('v0.1.1 JOHTO data: every species / move / trainer / legend key exists, trainers are Gen 1-2, bosses have rules and badges', () => {
    assert.equal(RG.REGIONS.johto.letter, 'J'); assert.equal(RG.actsFor(J), JOHTO_ACTS); assert.equal(JOHTO_ACTS.length, 5);
    for (const a of JOHTO_ACTS) assert.equal(a.region, J);
    for (const [k, t2] of Object.entries(JOHTO_TRAINERS)) {
      assert.ok(D.trainers[k] && D.trainers[k].johto, 'indexed ' + k);
      assert.ok(t2.party.length >= 1 && t2.party.length <= 6, k);
      for (const p of t2.party) {
        assert.ok(D.species[p.species], `${k}: species ${p.species}`);
        assert.ok(D.species[p.species].dex <= 251, `${k}: ${p.species} is not Gen 1-2`);
        assert.ok(p.level >= 2 && p.level <= 100, `${k}: level ${p.level}`);
        for (const mv of p.moves || []) assert.ok(D.moves[mv], `${k}: move ${mv}`);
      }
    }
    for (const [cls] of RG.REGIONS.johto.trainerClasses) assert.ok(D.trainers[cls], 'trainer class ' + cls);
    const known = (k) => !!(D.trainers[k] || LEGENDS[k]);
    for (const a of JOHTO_ACTS) {
      for (const k of a.elites || []) assert.ok(known(k), `act ${a.id} elite ${k}`);
      for (const k of a.bosses || []) assert.ok(known(k), `act ${a.id} boss ${k}`);
      for (const k of a.gauntlet || []) assert.ok(D.trainers[k], `act ${a.id} gauntlet ${k}`);
      if (a.rival) assert.ok(D.trainers[a.rival], `act ${a.id} rival ${a.rival}`);
      if (a.bird) { assert.ok(LEGENDS[a.bird] && BIRDS[a.bird], `act ${a.id} beast ${a.bird}`); assert.ok(RELICS[BIRDS[a.bird].item], BIRDS[a.bird].item); for (const mv of BIRDS[a.bird].moves) assert.ok(D.moves[mv], mv); }
      for (const ar of a.areas) for (const sp of RG.areaPool(ar)) assert.ok(D.species[sp], `${ar.name}: ${sp}`);
      // GYM LEADERS / ELITE FOUR / CHAMPION / RED: a boss rule each (via ruleKeyOf), a badge per GYM LEADER
      for (const k of [...(a.bosses || []), ...(a.gauntlet || [])].filter(x => !LEGENDS[x])) {
        assert.ok(BOSS_RULES[RG.ruleKeyOf(k)], `${k}: no BOSS_RULES entry (${RG.ruleKeyOf(k)})`);
        if (/^LEADER_/.test(k)) assert.ok(Object.values(BADGES).some(b => b.leader === k.replace('LEADER_', '')), `${k}: no badge`);
      }
    }
    assert.equal(Object.values(BADGES).filter(b => JOHTO_ACTS.some(a => (a.bosses || []).includes('LEADER_' + b.leader))).length, 8, '8 JOHTO badges');
    assert.deepEqual(JOHTO_ACTS[4].bosses, ['PKMN_TRAINER_RED']); assert.equal(D.trainers.PKMN_TRAINER_RED.name, 'RED'); assert.ok(JOHTO_ACTS[4].postgame);
    assert.equal(JOHTO_ACTS[3].gauntlet.at(-1), 'CHAMPION_LANCE'); assert.ok(D.trainers.CHAMPION_LANCE.champion);
  });

  t('v0.1.1 JOHTO pools: every area has POKéMON at every time of day, and every floor has an open pool', () => {
    for (const a of JOHTO_ACTS) {
      for (const ar of a.areas) for (const tod of RG.TIMES) assert.ok(RG.areaPool(ar, tod).filter(sp => D.species[sp]).length > 0, `${a.short} ${ar.name} ${tod}`);
      for (let f = 0; f < a.floors; f++) {
        const tod = RG.timeOfDay(f, a.floors);
        const open = a.areas.filter(ar => ar.from <= f / a.floors + 0.001).flatMap(ar => RG.areaPool(ar, tod)).filter(sp => D.species[sp]);
        assert.ok(open.length > 0, `${a.short} floor ${f} (${tod})`);
      }
    }
    // a plain list is the same at every time of day; tod null = every species of the area
    assert.deepEqual(RG.areaPool({ pool: ['A', 'B'] }, 'nite'), ['A', 'B']);
    assert.deepEqual(RG.areaPool({ pool: { morn: ['A'], day: ['B'], nite: ['C', 'A'] } }).sort(), ['A', 'B', 'C']);
    assert.equal(RG.areaPool({ map: 'X' }), null);
  });

  t('v0.1.1 JOHTO bosses: every GYM LEADER, the act 4 gauntlet (ELITE FOUR + CHAMPION LANCE) and RED build', () => {
    for (let a = 0; a < 3; a++) for (const key of JOHTO_ACTS[a].bosses) {
      const r = spireRun(SP([J, J, J, J]), { act: a, seed: 'JB' + key });
      r.boss = key;
      const c = r.bossConfig(new RNG('b' + key));
      assert.equal(c.kind, 'boss'); assert.ok(c.enemies.length >= 1 && c.enemies.every(e => e.maxHp > 0), key);
      assert.equal(c.bossRule, RG.ruleKeyOf(key)); assert.ok(BOSS_RULES[c.bossRule], key);
    }
    const r = spireRun(SP([Kt, Ht, Kt, J], J, J), { act: 3, seed: 'JGAUNT' });
    assert.deepEqual(r.act.gauntlet, JOHTO_ACTS[3].gauntlet); assert.equal(r.summitRegion, J);
    const titles = [];
    for (let g = 0; g < r.act.gauntlet.length; g++) {
      const c = r.gauntletConfig(new RNG('g' + g), g);
      assert.ok(c.enemies.length >= 1 && c.enemies.every(e => D.species[e.species] && e.maxHp > 0), r.act.gauntlet[g]);
      assert.ok(BOSS_RULES[c.bossRule], `${r.act.gauntlet[g]} rule ${c.bossRule}`);
      titles.push(c.trainer.title);
      if (g === 4) { assert.equal(c.trainer.title, 'CHAMPION LANCE'); assert.equal(c.bossRule, 'LANCE_CHAMPION'); assert.equal(c.music, 'mus_vs_champion'); assert.equal(c.trainer.encounterSong, 'mus_encounter_gym_leader'); assert.ok(!c.intro); }
    }
    assert.deepEqual(titles.slice(0, 4).map(x => x.split(' ').pop()), ['WILL', 'KOGA', 'BRUNO', 'KAREN']);
    // the JOHTO post-game ends with RED (a trainer boss, not a legendary)
    const p = spireRun(SP([J, Kt, Kt, Kt], Kt, J), { act: 4, seed: 'JRED' });
    assert.ok(p.act.postgame); assert.equal(p.region, J); assert.equal(p.boss, 'PKMN_TRAINER_RED');
    const c = p.bossConfig(new RNG('red'));
    assert.equal(c.trainer.name, 'RED'); assert.equal(c.bossRule, 'RED'); assert.ok(!c.legendBoss); assert.ok(c.enemies.length >= 1);
  });

  t('v0.1.1 JOHTO unlock: after the 2nd win (or meta.unlocks.johto); endRun sets it; co-op room worlds', () => {
    assert.deepEqual(RG.unlockedRegions({ totalWins: 0, unlocks: {} }), [Kt]);
    assert.deepEqual(RG.unlockedRegions({ totalWins: 1, unlocks: { win: true } }), [Kt, Ht]);
    assert.deepEqual(RG.unlockedRegions({ totalWins: 2, unlocks: { win: true } }), [Kt, Ht, J]);
    assert.deepEqual(RG.unlockedRegions({ totalWins: 1, unlocks: { win: true, johto: true } }), [Kt, Ht, J]);
    assert.equal(RG.johtoUnlocked({}), false); assert.equal(RG.johtoUnlocked({ totalWins: 1 }), false); assert.equal(RG.johtoUnlocked({ totalWins: 2 }), true); assert.equal(RG.johtoUnlocked({ unlocks: { johto: true } }), true);
    assert.equal(RG.JOHTO_WINS, 2);
    assert.equal(RG.coopWorldFor({ totalWins: 0, unlocks: {} }), 'spire_kanto');
    assert.equal(RG.coopWorldFor({ totalWins: 1, unlocks: { win: true } }), 'spire');
    assert.equal(RG.coopWorldFor({ totalWins: 2, unlocks: { win: true } }), 'spire_johto');
    assert.ok(RG.COOP_WORLDS.includes('spire_johto')); assert.ok(RG.isSpireWorld('spire_johto')); assert.ok(!RG.isSpireWorld('kanto'));
    assert.equal(RG.coopWorldRegions('spire_johto'), 'KANTO + HOENN + JOHTO'); assert.equal(RG.coopWorldRegions('spire'), 'KANTO + HOENN');
    // co-op 'spire' rooms (hosts without JOHTO, and every room made before v0.1.1) never draw JOHTO
    let sawJ = 0;
    for (let i = 0; i < 300; i++) {
      const d = RG.drawSpire('CO' + i, RG.COOP_POOLS.spire);
      assert.ok(![...d.acts, d.summit, d.post].includes(J), 'spire room drew JOHTO');
      const dj = RG.drawSpire('CO' + i, RG.COOP_POOLS.spire_johto);
      if (dj.acts.includes(J)) sawJ++;
      assert.ok(dj.acts.includes(dj.summit) && dj.acts.includes(dj.post));
    }
    assert.ok(sawJ > 150, 'spire_johto rooms draw JOHTO acts: ' + sawJ);
    // a solo spire before the unlock never draws JOHTO either
    for (let i = 0; i < 60; i++) assert.ok(!Run.create({ seed: 'PRE' + i, world: 'spire', pool: RG.unlockedRegions({ totalWins: 1, unlocks: { win: true } }) }).regions.acts.includes(J));
  });
  {
    globalThis.localStorage ||= { _s: {}, getItem(k) { return this._s[k] ?? null; }, setItem(k, v) { this._s[k] = String(v); }, removeItem(k) { delete this._s[k]; } };
    const st = await import('../web/src/game/state.js');
    st.G.meta = { unlocks: {}, maxAscension: 0, bestAscensionWon: -1, dexSeen: [], dexCaught: [], runs: [], totalWins: 0, totalRuns: 0, shinies: [], shinyOn: {}, ascBy: {}, ascVer: U.ASC_VER, settings: {} };
    const steps = [];
    for (const [res, seed] of [['lose', 'JUL0'], ['win', 'JUW1'], ['lose', 'JUL2'], ['postgame', 'JUW2']]) {
      st.endRun(Run.create({ starter: 'CHARMANDER', seed, world: 'spire', pool: [Kt] }), res);
      steps.push([st.G.meta.totalWins, !!st.G.meta.unlocks.johto, RG.unlockedRegions(st.G.meta).join(',')]);
    }
    t('v0.1.1 JOHTO unlock: endRun sets meta.unlocks.johto on the 2nd win (not the 1st, not on a loss)', () => {
      assert.deepEqual(steps, [[0, false, 'kanto'], [1, false, 'kanto,hoenn'], [1, false, 'kanto,hoenn'], [2, true, 'kanto,hoenn,johto']]);
    });
  }

  t('v0.1.1 SILVER: the rival for JOHTO starters counter-picks from CHIKORITA / CYNDAQUIL / TOTODILE', () => {
    for (const s of ['CHIKORITA', 'CYNDAQUIL', 'TOTODILE', 'SWINUB', 'LARVITAR', 'PHANPY']) assert.equal(RG.rivalFor(s), J, s);
    for (const s of ['MEW', 'BULBASAUR', 'DRATINI']) assert.equal(RG.rivalFor(s), Kt, s);
    for (const s of ['TREECKO', 'BELDUM']) assert.equal(RG.rivalFor(s), Ht, s);
    assert.equal(counterStarter('CHIKORITA', J), 'CYNDAQUIL'); assert.equal(counterStarter('CYNDAQUIL', J), 'TOTODILE'); assert.equal(counterStarter('TOTODILE', J), 'CHIKORITA');
    assert.deepEqual(SILVER_STARTER, { CHIKORITA: 'CYNDAQUIL', CYNDAQUIL: 'TOTODILE', TOTODILE: 'CHIKORITA' });
    for (const s of ['SWINUB', 'LARVITAR', 'TREECKO', 'GEODUDE']) assert.ok(['CHIKORITA', 'CYNDAQUIL', 'TOTODILE'].includes(counterStarter(s, J)), s);
    assert.equal(counterStarter('PIKACHU', J), 'NINCADA', 'none of his three beats PIKACHU: a GROUND starter from any region');
    assert.equal(counterStarter('SWINUB', J), 'TOTODILE', 'WATER beats an ICE / GROUND starter');
    // rivalParty swaps SILVER's authored CYNDAQUIL line for the counter's line (same stage), nothing else
    const base = [{ species: 'GASTLY', level: 5, moves: ['LICK'] }, { species: 'QUILAVA', level: 9, moves: ['EMBER'] }, { species: 'TYPHLOSION', level: 40, moves: ['EMBER'] }];
    assert.equal(rivalParty(base, 'CYNDAQUIL', 'CYNDAQUIL'), base);
    assert.deepEqual(rivalParty(base, 'TOTODILE', 'CYNDAQUIL').map(p => p.species), ['GASTLY', 'CROCONAW', 'FERALIGATR']);
    assert.deepEqual(rivalParty(base, 'CHIKORITA', 'CYNDAQUIL').map(p => [p.species, p.moves]), [['GASTLY', ['LICK']], ['BAYLEEF', null], ['MEGANIUM', null]]);
    assert.equal(rivalParty(base, 'TOTODILE', 'NOPE'), base);
    // the counter's line already on the team swaps places with the old line instead of doubling up (BLUE's ABRA
    // when MACHOP's counter is ABRA)
    const blue = [{ species: 'PIDGEOTTO', level: 9 }, { species: 'ABRA', level: 8 }, { species: 'RATTATA', level: 8 }, { species: 'CHARMANDER', level: 10 }];
    assert.deepEqual(rivalParty(blue, 'ABRA', 'CHARMANDER').map(p => p.species), ['PIDGEOTTO', 'CHARMANDER', 'RATTATA', 'ABRA']);
    assert.deepEqual(rivalParty([{ species: 'KADABRA', level: 20 }, { species: 'WARTORTLE', level: 24 }], 'ABRA', 'SQUIRTLE').map(p => p.species), ['WARTORTLE', 'KADABRA']);
  });

  t('v0.1.1 SILVER: a JOHTO starter meets SILVER on every rival floor, whatever the act region, with the counter line', () => {
    for (const starter of ['CHIKORITA', 'CYNDAQUIL', 'TOTODILE', 'LARVITAR']) {
      const counter = counterStarter(starter, J);
      for (const reg of [Kt, Ht, J]) for (let a = 0; a < 3; a++) {
        const r = spireRun(SP([reg, reg, reg, reg]), { act: a, starter, seed: `SILV${starter}${reg}${a}` });
        assert.equal(r.rival, J); assert.equal(r.rivalRegion, J);
        assert.equal(r.act.rival, JOHTO_ACTS[a].rival, `${starter} ${reg} act ${a + 1}`);
        const c = r.rivalConfig(new RNG('sv' + a), 10);
        assert.ok(c.rival); assert.equal(c.trainer.name, 'SILVER'); assert.equal(c.trainer.encounterSong, RG.REGIONS.johto.rival.encounterSong);
        assert.ok(c.intro.length && c.intro.every(l => l.startsWith('SILVER:') && !/\{[SR]\}/.test(l)), JSON.stringify(c.intro));
        const sp = c.enemies.map(e => e.species);
        assert.ok(sp.some(s => JLINES[counter].includes(s)), `${starter}: ${sp} lacks the ${counter} line`);
        for (const [line, mons] of Object.entries(JLINES)) if (line !== counter) assert.ok(!sp.some(s => mons.includes(s)), `${starter}: ${sp} has the ${line} line`);
      }
    }
    // a KANTO / HOENN starter in a JOHTO act still meets BLUE / MAY there
    assert.equal(spireRun(SP([J, J, J, J]), { starter: 'CHARMANDER' }).rivalConfig(new RNG('b'), 10).trainer.name, 'BLUE');
    assert.equal(spireRun(SP([J, J, J, J]), { starter: 'MUDKIP' }).rivalConfig(new RNG('m'), 10).trainer.name, 'MAY');
  });

  t('v0.1.1 day/night: floor thirds (morning / day / night); JOHTO wild configs draw that pool, KANTO / HOENN have none', () => {
    const tods = (n) => Array.from({ length: n }, (_, f) => RG.timeOfDay(f, n)[0]).join('');
    assert.equal(tods(15), 'mmmmmdddddnnnnn'); assert.equal(tods(7), 'mmmddnn'); assert.equal(tods(12), 'mmmmddddnnnn');
    assert.equal(RG.timeOfDay(-1, 15), 'morn'); assert.equal(RG.timeOfDay(15, 15), 'nite');
    for (let a = 0; a < 5; a++) {
      const act = JOHTO_ACTS[a], floors = [1, Math.floor(act.floors / 2), act.floors - 1];
      for (const f of floors) for (let s = 0; s < 6; s++) {
        const r = spireRun(SP([J, J, J, J], J, J), { act: a, seed: `TOD${a}${s}` });
        const tod = RG.timeOfDay(f, act.floors);
        assert.equal(r.timeOfDay(f), tod);
        const c = r.wildConfig(new RNG(`w${a}${f}${s}`), f);
        assert.equal(c.timeOfDay, tod);
        const open = new Set(act.areas.filter(ar => ar.from <= f / act.floors + 0.001).flatMap(ar => RG.areaPool(ar, tod)));
        assert.ok(open.has(c.enemies[0].wildBase), `${act.short} F${f} ${tod}: ${c.enemies[0].wildBase} not in that pool`);
      }
    }
    for (const reg of [Kt, Ht]) {
      const r = spireRun(SP([reg, reg, reg, reg]), { act: 1, seed: 'NOTOD' + reg });
      assert.equal(r.timeOfDay(12), null);
      assert.ok(!('timeOfDay' in r.wildConfig(new RNG('w'), 12)), reg);
    }
    // a legacy KANTO world run (old save) has no time of day either
    assert.equal(Run.create({ seed: 'LEG', world: 'kanto' }).timeOfDay(10), null);
  });

  t('v0.1.1 JOHTO mixes: every K/H/J sequence with a JOHTO act builds every fight with real songs (events, areas, RED)', () => {
    const missing = new Set();
    const song = (s, where) => { if (SONGS && s && !SONGS.has(s)) missing.add(`${s} (${where})`); };
    MIXJ.forEach((acts, i) => {
      const starter = ['CHIKORITA', 'CHARMANDER', 'MUDKIP', 'TOTODILE'][i % 4];
      const r = Run.create({ seed: 'MIXJ' + acts.join('') + starter, world: 'spire', starter, regions: SP(acts, acts[i % 4], acts[(i + 1) % 4]) });
      for (let a = 0; a < r.acts.length; a++) {
        if (a) r.startAct(a);
        const act = r.act, cfgs = [r.wildConfig(r.rng.fork('w'), 8), r.trainerConfig(r.rng.fork('t'), 8), r.eliteConfig(r.rng.fork('e'), 8)];
        if (act.rival) { const c = r.rivalConfig(r.rng.fork('r'), 10); assert.ok(c.rival); assert.equal(c.trainer.encounterSong, RG.regionOf(RG.rivalFor(starter)).rival.encounterSong); cfgs.push(c); }
        if (act.bird) cfgs.push(r.legendConfig(r.rng.fork('l'), 8, act.bird));
        if (act.gauntlet) for (let g = 0; g < act.gauntlet.length; g++) cfgs.push(r.gauntletConfig(r.rng.fork('g' + g), g));
        else cfgs.push(r.bossConfig(r.rng.fork('b')));
        for (const c of cfgs) {
          assert.ok(c && c.enemies.length && c.enemies.every(e => D.species[e.species] && e.level > 0 && e.maxHp > 0), `${acts} act ${a + 1}`);
          for (const s of [c.music, c.trainer?.battleSong, c.trainer?.encounterSong]) song(s, `${acts} act ${a + 1}`);
        }
        for (const s of [...act.music, act.townMusic, ...act.areas.map(x => x.music).filter(Boolean)]) song(s, `${act.region} ${act.name}`);
      }
    });
    // JOHTO "?" events (if this build has any): every choice runs in a JOHTO act; event battles use real songs
    for (const ev of EV.EVENTS.filter(e => e.world === J)) for (const a of ev.acts) {
      song(ev.music, ev.id);
      const r0 = spireRun(SP([J, J, J, J], J, J), { act: a, seed: 'JEV' + ev.id });
      for (const c of EV.eventChoices(ev, r0)) {
        const r = spireRun(SP([J, J, J, J], J, J), { act: a, seed: 'JEV' + ev.id });
        const cc = EV.eventChoices(ev, r).find(x => EV.choiceLabel(x, r) === EV.choiceLabel(c, r0));
        if (!cc || (cc.cond && !cc.cond(r))) continue;
        const res = runChoice(r, cc, 'jev' + ev.id);
        if (res.battle) { assert.ok(res.battle.enemies?.length, ev.id); for (const s of [res.battle.music, res.battle.trainer?.battleSong, res.battle.trainer?.encounterSong]) song(s, ev.id); }
      }
    }
    assert.deepEqual([...missing], []);
  });

  t('v0.1.1 records: JOHTO acts show as J in the route ("K-J-H-J"), J maps back to JOHTO', () => {
    const r = spireRun(SP([Kt, J, Ht, J], J, Kt));
    assert.equal(RG.spireCode(r.regions), 'K-J-H-J');
    assert.equal(runPayload(r, 'lose').regions, 'K-J-H-J');
    assert.equal(RG.regionByLetter('J'), RG.REGIONS.johto); assert.equal(RG.regionByLetter('K'), RG.REGIONS.kanto); assert.equal(RG.regionByLetter('H'), RG.REGIONS.hoenn); assert.equal(RG.regionByLetter('X'), null);
    assert.equal('K-J-H-J'.split('-').map(l => RG.regionByLetter(l).name).join(' '), 'KANTO JOHTO HOENN JOHTO');
    assert.ok(/regionByLetter\(l\)/.test(fs.readFileSync(new URL('../web/src/scenes/records.js', import.meta.url), 'utf8')), 'records tooltip uses regionByLetter');
    assert.equal(r.finishLog('lose').end.regions, 'K-J-H-J');
  });

  t('v0.1.1 determinism: a K+H pool draws exactly what it drew before JOHTO existed (saves, co-op rooms)', () => {
    // expected = the v0.1.0 drawSpire (REGION_IDS kanto, hoenn) on these seeds (convex-scores regions.js)
    const L2 = { K: Kt, H: Ht };
    const want = { SEED1: ['KKKK', 'K', 'K'], ABC: ['HKHH', 'K', 'H'], COOP: ['HHHK', 'K', 'H'], D7: ['KHHK', 'K', 'K'], SPIRE42: ['HHHK', 'H', 'H'], ZZTOP: ['HKHH', 'H', 'H'] };
    for (const [seed, [acts, summit, post]] of Object.entries(want)) {
      const exp = { acts: [...acts].map(l => L2[l]), summit: L2[summit], post: L2[post] };
      assert.deepEqual(RG.drawSpire(seed, [Kt, Ht]), exp, seed);
      assert.deepEqual(RG.drawSpire(seed, [Ht, Kt]), exp, seed + ' (pool order does not matter)');
      assert.deepEqual(RG.drawSpire(seed, RG.COOP_POOLS.spire), exp, seed + ' (co-op spire room)');
      assert.deepEqual(Run.create({ seed, world: 'spire', pool: [Kt, Ht] }).regions, exp, seed + ' (Run.create)');
    }
    // KANTO-only pools stay all-KANTO; the 3-region pool is deterministic too
    assert.deepEqual(RG.drawSpire('ABC', [Kt]).acts, [Kt, Kt, Kt, Kt]);
    assert.deepEqual(RG.drawSpire('ABC', [Kt, Ht, J]), RG.drawSpire('ABC', [J, Ht, Kt]));
    const seen = [new Set(), new Set(), new Set(), new Set()];
    for (let i = 0; i < 300; i++) RG.drawSpire('J' + i, [Kt, Ht, J]).acts.forEach((id, k) => seen[k].add(id));
    for (const s of seen) assert.deepEqual([...s].sort(), [Ht, J, Kt]);
  });

  t('v0.1.1 Apricorn balls: price + catch rule each, never change damage', () => {
    assert.ok(ITEMS.BALLS.FAST_BALL, 'Apricorn balls exist');
    const APRICORN = ['FAST_BALL', 'LEVEL_BALL', 'LURE_BALL', 'HEAVY_BALL', 'LOVE_BALL', 'FRIEND_BALL', 'MOON_BALL'].filter(k => ITEMS.BALLS[k]);
    assert.ok(APRICORN.length >= 5, 'Apricorn balls: ' + APRICORN);
    const { run, b } = dmgBattle();
    const e = b.enemy();
    const before = b.simulate([9001, 9002]).damage, info0 = b.cardInfo(b.deck.hand.find(c => c.id === 9003)).dmgPreview;
    for (const k of APRICORN) {
      const B = ITEMS.BALLS[k];
      assert.ok(typeof B.price === 'number' && B.price >= 0, `${k} price`);
      const rate = ITEMS.ballRate(k, e, b);
      assert.ok(Number.isFinite(rate) && rate > 0, `${k} catch rate ${rate}`);
      for (const f of ['mods', 'onHand', 'cardPct', 'onScore', 'dmg']) assert.ok(!(f in B), `${k} has ${f}`);
      run.balls[k] = 3;
    }
    assert.equal(b.simulate([9001, 9002]).damage, before, 'holding Apricorn balls changes hand damage');
    assert.equal(b.cardInfo(b.deck.hand.find(c => c.id === 9003)).dmgPreview, info0);
  });

}

// Scenes await fanfares, and a battle event once died on a cry: sounds must never hang or throw. Without
// running audio they resolve (false) at once, and an unknown cry is skipped.
{
  const { Sound } = await import('../web/src/audio/sound.js');
  const r = await Promise.race([Promise.all([Sound.playFanfare('mus_level_up'), Sound.playSE('se_select'), Sound.playCry('NOTAMON')]), new Promise(res => setTimeout(() => res('hung'), 1000))]);
  t('sounds without audio resolve instead of hanging or throwing', () => assert.deepEqual(r, [false, false, false]));
}

const { grantCoopWin, ascUnlocked: ascUnlockedFor } = await import('../web/src/game/unlocks.js');
t("co-op win unlocks the next ascension for the player's own starter (idempotent)", () => {
  const ascUnlocked = ascUnlockedFor;
  const m = { ascBy: { BULBASAUR: 2 }, bestAscensionWon: 0, maxAscension: 2 };
  assert.equal(grantCoopWin(m, 'SQUIRTLE', 1), true);
  assert.equal(ascUnlocked(m, 'SQUIRTLE'), 2); assert.equal(ascUnlocked(m, 'BULBASAUR'), 2);
  assert.equal(m.bestAscensionWon, 1); assert.equal(m.maxAscension, 2);
  assert.equal(grantCoopWin(m, 'SQUIRTLE', 1), false, 'a second call changes nothing');
  assert.equal(grantCoopWin(m, 'BULBASAUR', 0), false, 'a lower win never lowers an unlock');
  assert.equal(grantCoopWin(m, 'BULBASAUR', 10), true); assert.equal(ascUnlocked(m, 'BULBASAUR'), 10);
});

t('co-op win above my own unlock (room ran at a partner\'s higher level) still unlocks the next level', () => {
  const m = { ascBy: { SQUIRTLE: 2 }, bestAscensionWon: 1, maxAscension: 2, shinies: [] };
  assert.equal(grantCoopWin(m, 'SQUIRTLE', 7), true);
  assert.equal(ascUnlockedFor(m, 'SQUIRTLE'), 8, 'own A2, win at A7 -> A8');
  assert.equal(m.bestAscensionWon, 7); assert.equal(m.maxAscension, 8);
  assert.ok(unlockShiny({ starter: 'SQUIRTLE', ascension: 7 }, m), 'and the A5+ shiny, though A7 was above my own unlock');
});

t("co-op win at A5+ unlocks the shiny of the player's own starter (and not below A5)", () => {
  const m = { shinies: [] };
  assert.equal(unlockShiny({ starter: 'CYNDAQUIL', ascension: 4 }, m), null, 'A4 is not enough');
  assert.ok(unlockShiny({ starter: 'CYNDAQUIL', ascension: 5 }, m), 'A5 unlocks it');
  assert.ok(shinyUnlocked('TYPHLOSION', m), 'for the whole family');
  assert.equal(unlockShiny({ starter: 'QUILAVA', ascension: 7 }, m), null, 'only once per family');
});

// Each animation plays when its own move resolves (scenes/battle.js: orderTurnEvents; the hand animation after the hand's
// scoring 'total', as the next event comes up; the foe's on 'enemyMove'), for foe-first and player-first turns.
t('move anim: event order on foe-first and player-first turns', () => {
  const timeline = (evs) => {
    const out = []; let scored = false;
    for (const e of orderTurnEvents(evs)) {
      if (scored) { out.push('HAND_ANIM'); scored = false; }
      if (e.t === 'total') scored = true;
      if (e.t === 'enemyMove') out.push('FOE_ANIM');
      if (['play', 'enemyMove', 'card', 'total', 'damage', 'foeFirst'].includes(e.t)) out.push(e.t === 'damage' ? 'damage:' + e.side : e.t);
    }
    return out.filter((x, i, a) => x !== a[i - 1]).join(' ');
  };
  const turn = (foeMove, slowFoe) => {
    const { b, e } = dmgBattle();
    e.maxHp = e.hp = 99999; e.moves = [foeMove];
    if (slowFoe) e.stats.spe = 1; else e.stats.spe = 999;
    b.intent = { move: b.moveData(foeMove) };
    return timeline(b.play([9003, 9001]));
  };
  const foeFirst = turn('QUICK_ATTACK', false);
  // foe: animation, then its damage; then our cards are revealed, they count up, our animation, our damage lands
  assert.match(foeFirst, /^foeFirst FOE_ANIM enemyMove damage:player play card total HAND_ANIM damage:enemy/, foeFirst);
  const playerFirst = turn('TACKLE', true);
  assert.match(playerFirst, /^play card total HAND_ANIM damage:enemy FOE_ANIM enemyMove damage:player/, playerFirst);
});

// ---- FireRed move animations: which animation a hand shows (web/src/anim/pick.js) ----
t('move anim: attacks beat status cards, then the highest card DMG, ties to the leftmost', () => {
  const card = (id, move, o = {}) => ({ id, move, status: false, dmg: 0, power: 40, effect: 'HIT', ...o });
  // status cards never win against an attack, even a 0-damage one
  assert.equal(pickHandAnim([card(1, 'GROWL', { status: true, effect: 'ATTACK_DOWN' }), card(2, 'SPLASHY', { dmg: 0 })]).id, 2);
  // the attack that does the most damage to the target wins, wherever it is in the hand
  assert.equal(pickHandAnim([card(1, 'TACKLE', { dmg: 12 }), card(2, 'EMBER', { dmg: 28 }), card(3, 'GROWL', { status: true }), card(4, 'SCRATCH', { dmg: 14 })]).move, 'EMBER');
  // ties on DMG: the leftmost card (base power doesn't matter)
  assert.equal(pickHandAnim([card(1, 'TACKLE', { dmg: 20, power: 35 }), card(2, 'EMBER', { dmg: 20, power: 90 })]).move, 'TACKLE');
  assert.equal(pickHandAnim([card(1, 'TACKLE', { dmg: 20 }), card(2, 'POUND', { dmg: 20 }), card(3, 'SCRATCH', { dmg: 20 })]).id, 1);
  // same input -> same answer regardless of call count (no randomness)
  const hand = [card(5, 'A', { dmg: 9 }), card(6, 'B', { dmg: 9 })];
  assert.equal(pickHandAnim(hand).id, pickHandAnim(hand.slice()).id);
  assert.equal(pickHandAnim([]), null);
});
t('move anim: status-only hands show the leftmost status card', () => {
  const st = (id, move, effect) => ({ id, move, status: true, effect });
  assert.equal(pickHandAnim([st(1, 'GROWL', 'ATTACK_DOWN'), st(2, 'SWORDS_DANCE', 'ATTACK_UP_2'), st(3, 'THUNDER_WAVE', 'PARALYZE')]).move, 'GROWL');
  assert.equal(pickHandAnim([st(1, 'THUNDER_WAVE', 'PARALYZE'), st(2, 'SLEEP_POWDER', 'SLEEP')]).move, 'THUNDER_WAVE');
});
t('move anim: fallbacks (Gen 4 mapping, per type, per status effect)', () => {
  for (const k of Object.keys(GEN4_MOVES)) { assert.ok(GEN4_ANIM[k], 'no Gen 3 animation mapped for ' + k); assert.ok(D.moves[GEN4_ANIM[k]], k + ' maps to unknown ' + GEN4_ANIM[k]); }
  const have = new Set(['TACKLE', 'EMBER', 'BITE', 'GROWL', 'THUNDER_WAVE', 'NEEDLE_ARM']);
  const canPlay = (k) => have.has(k);
  assert.deepEqual(resolveAnimMove('EMBER', { canPlay, move: D.moves.EMBER }), { key: 'EMBER', via: 'own' });
  assert.deepEqual(resolveAnimMove('FIRE_FANG', { canPlay, move: D.moves.FIRE_FANG }), { key: 'BITE', via: 'gen4' });
  assert.deepEqual(resolveAnimMove('FIRE_BLAST', { canPlay, move: D.moves.FIRE_BLAST }), { key: 'EMBER', via: 'type' });
  assert.deepEqual(resolveAnimMove('STUN_SPORE', { canPlay, move: D.moves.STUN_SPORE }), { key: 'THUNDER_WAVE', via: 'status' });
  assert.deepEqual(resolveAnimMove('SECRET_POWER', { canPlay, move: D.moves.SECRET_POWER, terrain: 'grass' }), { key: 'NEEDLE_ARM', via: 'terrain' });
  assert.equal(resolveAnimMove('EMBER', { canPlay: () => false, move: D.moves.EMBER }), null);
});
// The interpreter runs every prototype animation headless to the end (needs web/assets/anims from tools/extract_anims.py).
if (fs.existsSync('web/assets/anims/anims.json')) {
  const GBA = await import('../web/src/anim/gba.js');
  const { AnimScript, stepFrame, missingFor } = await import('../web/src/anim/interp.js');
  GBA.DATA.json = JSON.parse(fs.readFileSync('web/assets/anims/anims.json', 'utf8'));
  GBA.DATA.tiles = new Uint8Array(fs.readFileSync('web/assets/anims/tiles.bin'));
  await import('../web/src/anim/cb/index.js');
  t('move anim: prototype animations run to the end in the interpreter, both directions', () => {
    const PROTO = ['TACKLE', 'EMBER', 'WATER_GUN', 'VINE_WHIP', 'THUNDER_SHOCK', 'QUICK_ATTACK', 'BITE', 'FLAMETHROWER', 'SURF', 'THUNDERBOLT', 'PSYCHIC', 'EARTHQUAKE', 'HYPER_BEAM'];
    const playable = PROTO.filter(k => missingFor(GBA.DATA.json, GBA.DATA.json.moves[k]).length === 0);
    for (const k of playable) for (const attacker of [0, 1]) {
      GBA.resetEngine();
      GBA.setupBattlers([{ present: true, species: 'CHARMANDER', x: 60, y: 78, picY: 78, box: { x: 8, y: 8, w: 48, h: 48 } }, { present: true, species: 'BULBASAUR', x: 180, y: 45, picY: 45, box: { x: 8, y: 8, w: 48, h: 48 } }]);
      GBA.S.gBattleAnimAttacker = attacker; GBA.S.gBattleAnimTarget = attacker ^ 1;
      const sc = new AnimScript(GBA.DATA.json.moves[k], { labels: GBA.DATA.json.labels });
      while (sc.active && sc.frames < 900) stepFrame(sc);
      assert.ok(!sc.active, k + ' did not finish (attacker ' + attacker + ')');
      for (const b of [0, 1]) { const m = GBA.gSprites[b]; assert.ok(!m.invisible && m.x2 === 0 && m.y2 === 0, k + ': battler ' + b + ' not restored'); }
    }
  });
}

t("YAWN: the foe falls asleep at the end of the turn; a foe that can't sleep says so at once", () => {
  const run = Run.create({ starter: 'BULBASAUR', seed: 'y3' });
  const b = new Battle(run, run.battleConfig({ id: 'w', floor: 3, type: 'wild' }));
  b.start();
  const e = b.enemy(); e.hp = e.maxHp = 9999; e.ability = 'KEEN_EYE'; e.status = null;
  b.deck.hand.push({ id: 9101, uid: b.lead().uid, move: 'YAWN' });
  b.play([9101]);
  assert.equal(b.enemy().status, 'SLP', 'asleep by the end of the turn');
  const run2 = Run.create({ starter: 'BULBASAUR', seed: 'y1' });
  const b2 = new Battle(run2, run2.battleConfig({ id: 'w', floor: 3, type: 'wild' }));
  b2.start();
  const e2 = b2.enemy(); e2.hp = e2.maxHp = 9999; e2.ability = 'VITAL_SPIRIT'; e2.status = null;
  b2.deck.hand.push({ id: 9102, uid: b2.lead().uid, move: 'YAWN' });
  const evs = b2.play([9102]);
  assert.ok(evs.some(x => x.t === 'msg' && /stayed awake/.test(x.text)), 'VITAL SPIRIT: a message, not a silent drowsy');
  assert.equal(b2.sides.enemy.yawn, 0);
});

const { makeEnemy: makeEnemyT } = await import('../web/src/game/battle.js');
t('foes always have an attack: ABRA gets the starter deck, others their latest learned attack', () => {
  const makeEnemy = makeEnemyT;
  assert.deepEqual(makeEnemy('ABRA', 12, {}).moves, ['CONFUSION', 'POUND', 'KINESIS', 'DISABLE']);
  assert.ok(makeEnemy('POOCHYENA', 30, {}).moves.includes('BITE'));
  assert.ok(makeEnemy('METAPOD', 9, {}).moves.includes('TACKLE'));
  assert.deepEqual(makeEnemy('CHARMANDER', 10, {}).moves, ['SCRATCH', 'GROWL', 'EMBER'], 'movesets with an attack are untouched');
});

t('rival team: a non-classic counter replaces the starter line stage for stage (BLUE vs MACHOP fields the ABRA line, once)', () => {
  const run = Run.create({ starter: 'MACHOP', seed: 'RIVALCT' });
  const cfg = run.rivalConfig(run.rng.fork('r'), 10);
  const abra = ['ABRA', 'KADABRA', 'ALAKAZAM'], names = cfg.enemies.map(e => e.species).join(',');
  assert.ok(abra.includes(cfg.enemies[cfg.enemies.length - 1].species), names); // the ace is the counter's line
  // BLUE's own ABRA slot takes his old starter line instead, so the ABRA line appears only once (v0.3.2)
  assert.equal(cfg.enemies.filter(e => abra.includes(e.species)).length, 1, names);
});

t('boss preferred types (map / act clear / E4 break)', () => {
  assert.equal(bossTypeLabel('LEADER_BROCK'), 'ROCK');
  assert.equal(bossTypeLabel('ELITE_FOUR_LANCE'), 'DRAGON');
  assert.equal(bossTypeLabel('CHAMPION_LANCE'), 'DRAGON');
  assert.equal(bossTypeLabel('CHAMPION_FIRST'), 'Mixed');
  assert.equal(bossTypeLabel('PKMN_TRAINER_RED'), 'Mixed');
  assert.deepEqual(bossTypes('RS_CHAMPION'), ['STEEL', 'ROCK']);
  assert.deepEqual(bossTypes('LEGEND_MEWTWO'), ['PSYCHIC']);
  for (const k of Object.keys(BOSS_TYPES)) assert.ok(D.trainers[k], 'boss key exists: ' + k);
  for (const a of [...ACTS, ...HOENN_ACTS]) for (const k of [...(a.bosses || []), ...(a.gauntlet || []).slice(0, 4)]) if (/^(LEADER|ELITE_FOUR)_/.test(k)) assert.ok(BOSS_TYPES[k], 'signature type for ' + k);
});


// ---- v0.3.7: REST, KING'S ROCK, deck-counting items --------------------------------------------------
const slowFoe = (moves = ['GROWL'], hp = 2000) => { const e = makeEnemyT('RATTATA', 5, { rng: new RNG('foe'), moves }); e.moves = moves.slice(); e.maxHp = e.hp = hp; e.stats.spe = 1; e.stats.atk = 1; e.stats.spa = 1; return e; };
const handOf = (b, moves) => { const lead = b.lead(); b.deck.hand = []; return moves.map((m, i) => { const c = { id: 9100 + i, uid: lead.uid, move: m }; b.deck.hand.push(c); return c.id; }); };
const soloWith = (foe, relics = [], seed = 'R37') => { const run = Run.create({ starter: 'CHARMANDER', seed }); for (const k of relics) run.addRelic(k); const b = new Battle(run, { kind: 'wild', enemies: [foe], rng: new RNG('b' + seed) }); b.start(); return { run, b, lead: b.lead() }; };

t('REST: full heal, status cured, then asleep (2 turns)', () => {
  const { b, lead } = soloWith(slowFoe());
  lead.hp = 3; lead.status = 'PSN';
  b.play(handOf(b, ['REST']));
  assert.equal(lead.hp, maxHp(lead));
  assert.equal(lead.status, 'SLP');
  assert.ok(b.ms(lead.uid).sleep >= 1);
});

t('REST in the hand that knocks out the last foe: the heal and cure stay, the sleep ends with the battle', () => {
  for (const order of [['REST', 'EMBER'], ['EMBER', 'REST']]) for (const st of ['PSN', 'TOX', 'BRN', null]) { // (PAR: a fully paralyzed card does nothing, as in Gen 3)
    const { b, lead } = soloWith(slowFoe(['GROWL'], 3), [], 'RK' + st);
    lead.hp = 3; lead.status = st;
    b.play(handOf(b, order));
    assert.equal(b.result?.outcome, 'win', order + st);
    assert.equal(lead.hp, maxHp(lead), order + st);
    assert.equal(lead.status, null, `${order} ${st}: no status after the won battle`);
  }
});

t("REST still heals when the foe's own move ends the battle before the hand (EXPLOSION first)", () => {
  const foe = slowFoe(['EXPLOSION'], 50); foe.stats.spe = 999;
  const { b, lead } = soloWith(foe, [], 'RX');
  lead.hp = maxHp(lead) - 5; lead.status = 'BRN';
  b.intent = { move: b.moveData('EXPLOSION'), first: true };
  const ids = handOf(b, ['REST', 'EMBER']);
  b.play(ids);
  assert.equal(b.result?.outcome, 'win');
  if (lead.hp > 0) { assert.equal(lead.hp, maxHp(lead)); assert.equal(lead.status, null); }
});

t("KING'S ROCK rolls once per hand (10%), not once per card", () => {
  let flinches = 0;
  for (let i = 0; i < 300; i++) {
    const { b } = soloWith(slowFoe(), ['KINGS_ROCK'], 'KQ' + i);
    const ev = b.play(handOf(b, ['SCRATCH', 'SCRATCH', 'SCRATCH', 'SCRATCH', 'SCRATCH']));
    flinches += ev.filter(e => e.t === 'relic' && e.key === 'KINGS_ROCK').length;
  }
  const rate = flinches / 300;
  assert.ok(rate > 0.04 && rate < 0.18, `flinch rate per 5-card hand ${rate} (per card it was ~0.41)`);
  assert.match(RELICS.KINGS_ROCK.desc, /per hand/i);
});

t('deck-counting held items: the preview equals the real hand (UP-GRADE, SOOT SACK, HELIX FOSSIL, ENERGY POWDER, DOME FOSSIL)', () => {
  for (const k of ['UP_GRADE', 'SOOT_SACK', 'HELIX_FOSSIL', 'ENERGY_POWDER', 'DOME_FOSSIL']) {
    const { b } = soloWith(slowFoe(), [k], 'DK' + k);
    const lead = b.lead();
    b.deck.hand = []; b.deck.draw = []; b.deck.discard = [];
    for (let i = 0; i < 14; i++) b.deck.discard.push({ id: 9300 + i, uid: lead.uid, move: i % 2 ? 'EMBER' : 'GROWL' });
    const ids = handOf(b, ['EMBER', 'EMBER', 'SCRATCH']);
    b.deck.hand.push({ id: 9400, uid: lead.uid, move: 'GROWL' }); // one card stays in hand (DOME FOSSIL)
    const sim = b.simulate(ids).damage;
    const ev = b.play(ids);
    assert.equal(ev.find(e => e.t === 'total').damage, sim, k);
  }
});

t('PROTECT only moves the hand first when it works (v0.3.19)', () => {
  const fast = () => { const e = slowFoe(['TACKLE']); e.stats.spe = 999; return e; };
  // first use: always works -> the hand goes before the faster foe, and the foe's TACKLE is blocked
  let { b } = soloWith(fast(), [], 'PR1');
  let ev = b.play(handOf(b, ['PROTECT']));
  assert.ok(!ev.some(e => e.t === 'foeFirst'), 'a working PROTECT goes first');
  // back to back: the roll fails -> no priority, the faster foe moves first
  ({ b } = soloWith(fast(), [], 'PR2'));
  b.play(handOf(b, ['PROTECT']));
  const chance = b.rng.chance.bind(b.rng);
  b.rng.chance = (p) => (p === 0.5 ? false : chance(p));
  ev = b.play(handOf(b, ['PROTECT']));
  assert.ok(ev.some(e => e.t === 'foeFirst'), 'a failing PROTECT lends no priority');
  assert.ok(ev.some(e => e.t === 'msg' && /failed/i.test(e.text)), 'it still says it failed');
});

t('FLY: after a dodge the lead is LANDING for a turn: no FLY / DIG / PROTECT (v0.3.23)', () => {
  const { b, lead } = soloWith(slowFoe(['TACKLE']), [], 'LAND1'); // the foe is slower: the hand goes first, FLY dodges
  b.play(handOf(b, ['FLY']));
  assert.equal(b.ms(lead.uid).landing, b.turn, 'landing this turn');
  const infoOf = (m) => { const id = handOf(b, [m])[0]; return b.cardInfo(b.deck.hand.find(c => c.id === id)); };
  for (const m of ['FLY', 'DIG', 'PROTECT', 'DETECT', 'ENDURE']) {
    const info = infoOf(m);
    assert.ok(!info.playable && info.reason === 'LANDING', m + ' waits while landing');
  }
  assert.ok(infoOf('GUST').playable, 'attacks still work while landing');
  b.play(handOf(b, ['GUST']));
  assert.ok(infoOf('FLY').playable, 'FLY is back the turn after');
  // a faster foe moved first: no dodge happened, so no landing
  const fast = slowFoe(['TACKLE']); fast.stats.spe = 999;
  const r2 = soloWith(fast, [], 'LAND2');
  r2.b.play(handOf(r2.b, ['FLY']));
  assert.notEqual(r2.b.ms(r2.lead.uid).landing, r2.b.turn, 'no landing when the foe already moved');
});

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
