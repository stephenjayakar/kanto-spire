// Abilities prototype tests (docs/ABILITIES_PROPOSAL.md): node tests/abilities.test.mjs
import fs from 'fs';
import assert from 'assert/strict';
import { loadData, D } from '../web/src/game/data.js';
import { Run } from '../web/src/game/run.js';
import { Battle, makeEnemy, effectiveness, abilityOf } from '../web/src/game/battle.js';
import { makeMon, maxHp } from '../web/src/game/pokemon.js';
import { RNG } from '../web/src/game/rng.js';
import { GEN4_ABILITIES, ABILITY_TEXT } from '../web/src/game/abilities.js';

await loadData(async f => JSON.parse(fs.readFileSync('web/assets/data/' + f, 'utf8')));
let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.log('FAIL', name, '-', e.message, process.env.STACK ? e.stack : ''); } };

// A battle: your `species` (forced ability) with `moves` against a wild `foe` (forced ability).
function setup({ species = 'MACHOP', ab = null, moves = ['KARATE_CHOP'], level = 30, foe = 'RATTATA', foeAb = null, foeLevel = 30, relics = [] } = {}) {
  const run = Run.create({ starter: 'CHARMANDER', seed: 'ABIL' });
  const mon = makeMon(species, level, { rng: new RNG('m'), moves });
  mon.moves = moves.map(m => ({ move: m, copies: 3 }));
  if (ab) mon.ability = ab;
  run.party = [mon];
  for (const r of relics) run.addRelic(r);
  const e = makeEnemy(foe, foeLevel, { rng: new RNG('e') });
  if (foeAb !== null) e.ability = foeAb;
  const b = new Battle(run, { kind: 'wild', enemies: [e], rng: new RNG('b') });
  b.start();
  return { run, mon, e, b };
}
// Preview damage of the first card of `move` in hand (draws until it shows up).
function preview(b, move) {
  for (const p of Object.values(b.decks)) { p.hand = [...p.hand, ...p.draw]; p.draw = []; }
  const c = b.deck.hand.find(x => x.move === move);
  return b.cardInfo(c).dmgPreview;
}

t('every ability has in-game text, none says "No effect"', () => {
  for (const k of Object.keys(D.abilities)) { assert.ok(ABILITY_TEXT[k], k); assert.ok(!/No effect in battle/.test(D.abilities[k].desc), k); }
  for (const k of Object.keys(GEN4_ABILITIES)) assert.ok(D.abilities[k], 'Gen 4 entry ' + k);
});
t('Gen 4 species use their HGSS abilities', () => {
  assert.deepEqual(D.species.BIDOOF.abilities, ['SIMPLE', 'UNAWARE']);
  assert.deepEqual(D.species.RHYPERIOR.abilities, ['LIGHTNING_ROD', 'SOLID_ROCK']);
  const none = Object.values(D.species).filter(s => !(s.abilities || []).length).map(s => s.key || s.name);
  assert.deepEqual(none, [], 'every species has an ability');
});
t('old saves keep their Gen 4 mons\' abilities', () => {
  const run = Run.create({ starter: 'CHARMANDER', seed: 'PIN' });
  const shinx = makeMon('SHINX', 10, { rng: new RNG('s') });
  shinx.ivs.spe = 0; // [RIVALRY, INTIMIDATE][0] would be RIVALRY now
  run.party = [shinx];
  const o = JSON.parse(JSON.stringify(run)); delete o.abilityRules; delete o.party[0].ability;
  const r2 = Run.fromJSON(o);
  assert.equal(abilityOf(r2.party[0]), 'INTIMIDATE');
});
t('TECHNICIAN x1.5 on 60-power cards, ADAPTABILITY x2 STAB', () => {
  const base = preview(setup({ ab: 'GUTS', moves: ['KARATE_CHOP'] }).b, 'KARATE_CHOP');
  const tech = preview(setup({ ab: 'TECHNICIAN', moves: ['KARATE_CHOP'] }).b, 'KARATE_CHOP');
  assert.ok(Math.abs(tech / base - 1.5) < 0.08, `${base} -> ${tech}`);
  const ad = preview(setup({ ab: 'ADAPTABILITY', moves: ['KARATE_CHOP'] }).b, 'KARATE_CHOP');
  assert.ok(Math.abs(ad / base - 4 / 3) < 0.08, `${base} -> ${ad}`);
});
t('TINTED LENS doubles resisted cards; FILTER cuts super-effective ones', () => {
  const base = preview(setup({ ab: 'GUTS', foe: 'ZUBAT', foeAb: 'INNER_FOCUS' }).b, 'KARATE_CHOP');
  const tl = preview(setup({ ab: 'TINTED_LENS', foe: 'ZUBAT', foeAb: 'INNER_FOCUS' }).b, 'KARATE_CHOP');
  assert.ok(Math.abs(tl / base - 2) < 0.2, `${base} -> ${tl}`);
  assert.equal(effectiveness('FIGHTING', ['NORMAL'], 'FILTER'), 1.5);
});
t('absorbing abilities: immunities and blockedBy', () => {
  assert.equal(effectiveness('ELECTRIC', ['WATER'], 'LIGHTNING_ROD'), 0);
  assert.equal(effectiveness('WATER', ['WATER'], 'STORM_DRAIN'), 0);
  assert.equal(effectiveness('ELECTRIC', ['NORMAL'], 'MOTOR_DRIVE'), 0);
  assert.equal(effectiveness('FIRE', ['POISON'], 'DRY_SKIN'), 1.25);
  const { b } = setup({ species: 'PIKACHU', moves: ['THUNDER_SHOCK'], foe: 'RATTATA', foeAb: 'VOLT_ABSORB' });
  for (const p of Object.values(b.decks)) { p.hand = [...p.hand, ...p.draw]; p.draw = []; }
  assert.equal(b.cardInfo(b.deck.hand[0]).blockedBy, 'VOLT_ABSORB');
});
t('MOLD BREAKER hits through LEVITATE', () => {
  const lev = preview(setup({ species: 'SANDSHREW', moves: ['MAGNITUDE'], foe: 'GASTLY', foeAb: 'LEVITATE', ab: 'SAND_VEIL' }).b, 'MAGNITUDE');
  const mb = preview(setup({ species: 'SANDSHREW', moves: ['MAGNITUDE'], foe: 'GASTLY', foeAb: 'LEVITATE', ab: 'MOLD_BREAKER' }).b, 'MAGNITUDE');
  assert.equal(lev, 0); assert.ok(mb > 0, mb);
});
t('SOUNDPROOF blocks sound cards', () => {
  const { b } = setup({ species: 'EXPLOUD', moves: ['HYPER_VOICE'], foe: 'VOLTORB', foeAb: 'SOUNDPROOF' });
  assert.equal(preview(b, 'HYPER_VOICE'), 0);
});
t('DAMP makes EXPLOSION unplayable', () => {
  const { b } = setup({ species: 'GEODUDE', moves: ['EXPLOSION'], foe: 'PSYDUCK', foeAb: 'DAMP' });
  for (const p of Object.values(b.decks)) { p.hand = [...p.hand, ...p.draw]; p.draw = []; }
  assert.equal(b.cardInfo(b.deck.hand[0]).reason, 'DAMP');
});
t('BATTLE ARMOR: no crits even with an always-crit item', () => {
  const { b, e } = setup({ species: 'CHANSEY', moves: ['POUND'], foe: 'KABUTO', foeAb: 'BATTLE_ARMOR', relics: ['LUCKY_PUNCH'] });
  for (const p of Object.values(b.decks)) { p.hand = [...p.hand, ...p.draw]; p.draw = []; }
  const ev = b.play([b.deck.hand[0].id]);
  assert.ok(!ev.some(x => x.t === 'card' && x.label === 'CRITICAL'));
});
t('PRESSURE foe costs a discard; SNOW WARNING brings hail', () => {
  const p = setup({ foe: 'ABSOL', foeAb: 'PRESSURE' });
  const n = setup({ foe: 'ABSOL', foeAb: 'SUPER_LUCK' });
  assert.equal(p.b.discardsLeft, n.b.discardsLeft - 1);
  const h = setup({ foe: 'SNOVER', foeAb: 'SNOW_WARNING' });
  assert.equal(h.b.weather, 'HAIL');
});
t('CLOUD NINE: weather stops acting', () => {
  const { b } = setup({ species: 'PSYDUCK', ab: 'CLOUD_NINE', moves: ['WATER_GUN'], foe: 'VULPIX', foeAb: 'DROUGHT' });
  assert.equal(b.weather, 'SUN'); assert.equal(b.wx(), null);
});
t('TRACE copies the foe\'s ability', () => {
  const { b, mon } = setup({ species: 'RALTS', ab: 'TRACE', moves: ['CONFUSION'], foe: 'GROWLITHE', foeAb: 'INTIMIDATE' });
  assert.equal(b.pab(mon), 'INTIMIDATE');
});
t('SIMPLE doubles stat changes', () => {
  const { b } = setup({ species: 'BIDOOF', ab: 'SIMPLE', moves: ['TACKLE'] });
  b.addStage('player', 'atk', 1, 'TEST');
  assert.equal(b.sides.player.stages.atk, 2);
});
t('OBLIVIOUS / INNER FOCUS ignore INTIMIDATE', () => {
  const { b } = setup({ species: 'SLOWPOKE', ab: 'OBLIVIOUS', moves: ['TACKLE'], foe: 'GROWLITHE', foeAb: 'INTIMIDATE' });
  assert.equal(b.sides.player.stages.atk, 0);
});
t('field: PICKUP / ILLUMINATE / MAGNET PULL / HONEY GATHER mods', () => {
  const run = Run.create({ starter: 'CHARMANDER', seed: 'F' });
  const m = (sp, ab) => { const x = makeMon(sp, 10, { rng: new RNG(sp) }); x.ability = ab; return x; };
  run.party = [m('MEOWTH', 'PICKUP'), m('ZIGZAGOON', 'PICKUP'), m('STARYU', 'ILLUMINATE'), m('MAGNEMITE', 'MAGNET_PULL'), m('COMBEE', 'HONEY_GATHER')];
  const mods = run.mods();
  assert.ok(Math.abs(mods.pickup - 0.2) < 1e-9); assert.equal(mods.rareFindMult, 2); assert.equal(mods.steelLure, 3); assert.equal(mods.honey, 1);
});
t('ARENA TRAP lead: catch rate x1.5', () => {
  const a = setup({ species: 'DIGLETT', ab: 'ARENA_TRAP', moves: ['SCRATCH'], foe: 'RATTATA', foeAb: 'RUN_AWAY' });
  const n = setup({ species: 'DIGLETT', ab: 'SAND_VEIL', moves: ['SCRATCH'], foe: 'RATTATA', foeAb: 'RUN_AWAY' });
  a.e.hp = n.e.hp = Math.floor(a.e.maxHp / 2);
  assert.ok(a.b.catchChance('POKE_BALL') > n.b.catchChance('POKE_BALL'));
});

console.log(`abilities tests: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
