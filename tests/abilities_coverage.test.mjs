// Ability coverage: node tests/abilities_coverage.test.mjs
// Every ability a POKéMON can have (D.abilities + every species' list, Gen 4 included) must
//   (a) have in-game text (abilities.js ABILITY_TEXT) that doesn't say it does nothing,
//   (b) be listed in IMPLEMENTED below with the file(s) whose code implements it, and actually be referenced by the
//       implementation code of those files (comments, text tables and pinning lists don't count),
//   (c) for a representative subset, change a real battle outcome compared with no ability ('NONE').
// A new ability (a new region's species, a data change) without code makes this fail: implement it, then register it.
import fs from 'fs';
import assert from 'assert/strict';
import { loadData, D } from '../web/src/game/data.js';
import { Run } from '../web/src/game/run.js';
import { Battle, makeEnemy, effectiveness } from '../web/src/game/battle.js';
import { makeMon, maxHp } from '../web/src/game/pokemon.js';
import { RNG } from '../web/src/game/rng.js';
import { EFFECTS } from '../web/src/game/effects.js';
import { ABILITY_TEXT } from '../web/src/game/abilities.js';
import { DuoBattle } from '../web/src/game/coop/duo.js';

await loadData(async f => JSON.parse(fs.readFileSync('web/assets/data/' + f, 'utf8')));
let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.log('FAIL', name, '-', e.message, process.env.STACK ? e.stack : ''); } };

// ---- (a) every ability -------------------------------------------------------------------------------------
const ALL = new Set(Object.keys(D.abilities));
for (const sp of Object.values(D.species)) for (const a of sp.abilities || []) ALL.add(a);
ALL.delete('NONE');
const KEYS = [...ALL].sort();

t(`found the abilities (${KEYS.length})`, () => assert.ok(KEYS.length >= 108, KEYS.length));
t('every ability has in-game text that says what it does', () => {
  const bad = [];
  for (const k of KEYS) {
    const txt = ABILITY_TEXT[k], desc = D.abilities[k]?.desc;
    if (!txt || !desc || desc !== txt || /no effect in battle|^(it )?does nothing|not implemented|\btodo\b/i.test(txt)) bad.push(k);
  }
  assert.deepEqual(bad, []);
});

// ---- (b) the registry and the code scan --------------------------------------------------------------------
// ability -> [files that implement it (keys of SRC), how]
const B = 'battle', E = 'effects', A = 'abilities', DUO = 'duo';
const IMPLEMENTED = {
  ADAPTABILITY: [[B], 'STAB x2 (hitDamage, enemyDamage)'],
  AFTERMATH: [[B], 'KO by contact hurts the attacker'],
  AIR_LOCK: [[B], 'wx(): no weather while out'],
  ANTICIPATION: [[B], 'free switch (yours) / first super-effective hand -25% (foe)'],
  ARENA_TRAP: [[B], 'switch tax + no running (foe) / catch x1.5 (yours)'],
  BAD_DREAMS: [[B], 'sleeping foe loses HP each turn'],
  BATTLE_ARMOR: [[B], 'no crits'],
  BLAZE: [[B], 'pinch x1.5 FIRE'],
  CACOPHONY: [[B], 'blocks sound moves'],
  CHLOROPHYLL: [[B], 'speed x2 in sun'],
  CLEAR_BODY: [[B], 'no stat drops from the foe'],
  CLOUD_NINE: [[B], 'wx(): no weather while out'],
  COLOR_CHANGE: [[B], 'takes the type of the last hit'],
  COMPOUND_EYES: [[B], 'accuracy x1.3'],
  CUTE_CHARM: [[B], 'contact: 30% infatuation'],
  DAMP: [[B], 'no EXPLOSION / AFTERMATH'],
  DOWNLOAD: [[B, DUO], '+1 ATK or SP. ATK on entry'],
  DRIZZLE: [[B, DUO], 'rain on entry'],
  DROUGHT: [[B, DUO], 'sun on entry'],
  DRY_SKIN: [[B, A], 'WATER heals, FIRE x1.25, rain / sun residuals'],
  EARLY_BIRD: [[B], 'half sleep'],
  EFFECT_SPORE: [[B], 'contact: 10% PSN / PAR / SLP'],
  FILTER: [[B], 'super-effective x0.75'],
  FLAME_BODY: [[B], 'contact: 30% burn'],
  FLASH_FIRE: [[B, A], 'FIRE immunity, own FIRE x1.5'],
  FLOWER_GIFT: [[B], 'sun: physical x1.5, special bulk'],
  FORECAST: [[B, DUO], 'type follows the weather'],
  GUTS: [[B], 'status: physical x1.5, no burn cut'],
  HEATPROOF: [[B], 'FIRE and burn halved'],
  HONEY_GATHER: [[A], 'field: berry after won battles (partyAbilityMods -> reward.js)'],
  HUGE_POWER: [[B], 'physical x2'],
  HUSTLE: [[B], 'physical x1.5, accuracy x0.8'],
  HYDRATION: [[B], 'rain cures status'],
  HYPER_CUTTER: [[B], 'no ATTACK drops'],
  ILLUMINATE: [[A], 'field: rare finds x2 (partyAbilityMods -> run.js)'],
  IMMUNITY: [[B], 'no poison'],
  INNER_FOCUS: [[B], 'no flinch, no INTIMIDATE'],
  INSOMNIA: [[B], 'no sleep'],
  INTIMIDATE: [[B, DUO], '-1 ATTACK on entry'],
  KEEN_EYE: [[B], 'no accuracy drops'],
  KLUTZ: [[B], 'cards x1.5, no held-item card bonuses'],
  LEAF_GUARD: [[B], 'no status in sun'],
  LEVITATE: [[B], 'GROUND immunity'],
  LIGHTNING_ROD: [[B, DUO, A], 'ELECTRIC immunity +1 SP. ATK; co-op draws the move'],
  LIMBER: [[B], 'no paralysis'],
  LIQUID_OOZE: [[B], 'drains hurt the drainer'],
  MAGMA_ARMOR: [[B], 'no freeze'],
  MAGNET_PULL: [[B, A], 'STEEL lead can\'t run (foe) / steel lure (field)'],
  MARVEL_SCALE: [[B], 'status: DEFENSE x1.5'],
  MINUS: [[B], 'special x1.5 with PLUS / MINUS partner'],
  MOLD_BREAKER: [[B, DUO], 'ignores BREAKABLE abilities'],
  MOTOR_DRIVE: [[B, A], 'ELECTRIC immunity, +1 SPEED'],
  MULTITYPE: [[B], 'type from plate item (yours) / move type (foe)'],
  NATURAL_CURE: [[B], 'cured on switch-out'],
  OBLIVIOUS: [[B, E], 'no ATTRACT / CUTE CHARM / INTIMIDATE'],
  OVERGROW: [[B], 'pinch x1.5 GRASS'],
  OWN_TEMPO: [[B], 'no confusion'],
  PICKUP: [[A], 'field: item after won battles (partyAbilityMods -> reward.js)'],
  PLUS: [[B], 'special x1.5 with PLUS / MINUS partner'],
  POISON_POINT: [[B], 'contact: 30% poison'],
  PRESSURE: [[B, DUO], '-1 discard (foe) / no repeat move (yours)'],
  PURE_POWER: [[B], 'physical x2'],
  RAIN_DISH: [[B], 'rain heals'],
  RIVALRY: [[B], 'x1.25 vs shared type'],
  ROCK_HEAD: [[E], 'no recoil'],
  ROUGH_SKIN: [[B], 'contact: attacker loses 1/16'],
  RUN_AWAY: [[B], 'always flee'],
  SAND_STREAM: [[B, DUO], 'sandstorm on entry'],
  SAND_VEIL: [[B], 'evasion in sand'],
  SERENE_GRACE: [[E], 'secondary chances x2'],
  SHADOW_TAG: [[B], 'switch tax + no running (foe) / catch x1.5 (yours)'],
  SHED_SKIN: [[B], '30% self cure'],
  SHELL_ARMOR: [[B], 'no crits'],
  SHIELD_DUST: [[B], 'no secondary effects'],
  SIMPLE: [[B], 'stat changes x2'],
  SLOW_START: [[B], 'half damage / speed for 3 turns'],
  SNIPER: [[B], 'crits x3'],
  SNOW_CLOAK: [[B], 'evasion in hail'],
  SNOW_WARNING: [[B, DUO], 'hail on entry'],
  SOLID_ROCK: [[B], 'super-effective x0.75'],
  SOUNDPROOF: [[B], 'blocks sound moves'],
  SPEED_BOOST: [[B], '+1 SPEED each turn'],
  STATIC: [[B], 'contact: 30% paralysis'],
  STEADFAST: [[B], '+1 SPEED on flinch'],
  STENCH: [[B], '10% flinch'],
  STICKY_HOLD: [[B, E], 'keeps items / blocks THIEF, KNOCK OFF'],
  STORM_DRAIN: [[B, DUO, A], 'WATER immunity +1 SP. ATK; co-op draws the move'],
  STURDY: [[B], 'no OHKO, survives from full HP'],
  SUCTION_CUPS: [[B, E], 'no ROAR / WHIRLWIND; no freezing / face-down cards'],
  SUPER_LUCK: [[B], '+1 crit stage'],
  SWARM: [[B], 'pinch x1.5 BUG'],
  SWIFT_SWIM: [[B], 'speed x2 in rain'],
  SYNCHRONIZE: [[B], 'passes PSN / BRN / PAR back'],
  TANGLED_FEET: [[B], 'evasion while confused'],
  TECHNICIAN: [[B], 'power <= 60: x1.5'],
  THICK_FAT: [[B], 'FIRE / ICE halved'],
  TINTED_LENS: [[B], 'resisted hits x2'],
  TORRENT: [[B], 'pinch x1.5 WATER'],
  TRACE: [[B, DUO], 'copies the foe\'s ability'],
  TRUANT: [[B], 'acts every other turn'],
  UNAWARE: [[B], 'ignores the other side\'s stages'],
  UNBURDEN: [[B], 'speed x2 after an item / below half HP'],
  VITAL_SPIRIT: [[B], 'no sleep'],
  VOLT_ABSORB: [[B, A], 'ELECTRIC immunity, heals'],
  WATER_ABSORB: [[B, A], 'WATER immunity, heals'],
  WATER_VEIL: [[B], 'no burn'],
  WHITE_SMOKE: [[B], 'no stat drops from the foe'],
  WONDER_GUARD: [[B], 'only super-effective hits'],
};

// The implementation code: comments stripped; in abilities.js only the implementation tables / functions (ABSORB,
// PLATE_ITEMS, partyAbilityMods...), not the text, the Gen 4 name list, the old-save pinning lists or the
// TRACE / MOLD BREAKER exception lists.
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
const read = (f) => strip(fs.readFileSync(f, 'utf8'));
const SRC = {
  battle: read('web/src/game/battle.js'),
  effects: read('web/src/game/effects.js'),
  duo: read('web/src/game/coop/duo.js'),
  run: read('web/src/game/run.js'),
  pokemon: read('web/src/game/pokemon.js'),
  abilities: read('web/src/game/abilities.js')
    .replace(/export const (ABILITY_TEXT|GEN4_ABILITIES|LEGACY_GEN4_ABILITIES|ABILITY_ALIAS) = \{[\s\S]*?\n\};?\n/g, '')
    .replace(/export const (TRACE_BAN|BREAKABLE|SOUND_MOVES) = new Set\(\[[\s\S]*?\]\);/g, ''),
};
const refRe = (k) => new RegExp(`['"]${k}['"]|\\b${k}\\s*:`);

t('abilities.js scan really drops the text tables', () => {
  assert.ok(!/ABILITY_TEXT\s*=/.test(SRC.abilities) && !/GEN4_ABILITIES\s*=/.test(SRC.abilities), 'tables still there');
  assert.ok(/partyAbilityMods/.test(SRC.abilities) && /ABSORB\s*=/.test(SRC.abilities), 'implementation tables kept');
});
t('every ability is in the IMPLEMENTED registry', () => {
  assert.deepEqual(KEYS.filter(k => !IMPLEMENTED[k]), [], 'new abilities: implement them, then register them here');
});
t('the registry has no stale entries', () => {
  assert.deepEqual(Object.keys(IMPLEMENTED).filter(k => !ALL.has(k)), []);
});
t('every ability is referenced by the code of the files the registry names', () => {
  const bad = [];
  for (const k of KEYS) for (const f of IMPLEMENTED[k]?.[0] || []) if (!SRC[f] || !refRe(k).test(SRC[f])) bad.push(`${k} (${f})`);
  assert.deepEqual(bad, []);
});

// ---- (c) behaviour ------------------------------------------------------------------------------------------
// A battle: your `species` (forced ability) with `moves` against a wild `foe` (forced ability). 'NONE' = no ability.
function setup({ species = 'MACHOP', ab = 'NONE', moves = ['KARATE_CHOP'], level = 30, foe = 'RATTATA', foeAb = 'NONE', foeLevel = 30, foeMoves = ['GROWL'], relics = [], before = null } = {}) {
  const run = Run.create({ starter: 'CHARMANDER', seed: 'ABCOV' });
  const mon = makeMon(species, level, { rng: new RNG('m'), moves });
  mon.moves = moves.map(m => ({ move: m, copies: 3 }));
  mon.ability = ab;
  run.party = [mon];
  for (const r of relics) run.addRelic(r);
  const e = makeEnemy(foe, foeLevel, { rng: new RNG('e'), moves: foeMoves });
  e.moves = foeMoves.slice();
  e.ability = foeAb;
  if (before) before({ run, mon, e });
  const b = new Battle(run, { kind: 'wild', enemies: [e], rng: new RNG('b') });
  b.start();
  for (const p of Object.values(b.decks)) { p.hand = [...p.hand, ...p.draw]; p.draw = []; }
  return { run, mon, e, b };
}
const card = (b, move) => b.deck.hand.find(c => c.move === move);
const preview = (b, move) => b.cardInfo(card(b, move)).dmgPreview;
const ratio = (a, b) => a / b;
const near = (x, want, tol = 0.1) => Math.abs(x - want) <= tol;
const tested = new Set();
// A check of one or more abilities: fn() throws if the ability makes no difference.
const check = (abs, fn) => { for (const a of [].concat(abs)) tested.add(a); t('behaviour: ' + [].concat(abs).join(' / '), fn); };

// damage your cards deal, with ability `ab` vs 'NONE' (same setup otherwise)
const dmgRatio = (opts, move, ab, field = 'ab') => {
  const base = preview(setup({ ...opts, [field]: 'NONE' }).b, move);
  const withAb = preview(setup({ ...opts, [field]: ab }).b, move);
  assert.ok(base > 0, `${ab}: base preview ${base}`);
  return ratio(withAb, base);
};

// absorbs (foe side: the card does nothing, the foe gains from it)
check(['VOLT_ABSORB', 'WATER_ABSORB', 'DRY_SKIN'], () => {
  for (const [ab, sp, mv] of [['VOLT_ABSORB', 'PIKACHU', 'THUNDER_SHOCK'], ['WATER_ABSORB', 'SQUIRTLE', 'WATER_GUN'], ['DRY_SKIN', 'SQUIRTLE', 'WATER_GUN']]) {
    const base = setup({ species: sp, moves: [mv] });
    assert.ok(preview(base.b, mv) > 0, ab);
    const { b, e } = setup({ species: sp, moves: [mv], foeAb: ab, before: ({ e }) => { e.hp = Math.floor(e.maxHp / 2); } });
    assert.equal(preview(b, mv), 0, ab + ' blocks');
    const hp = e.hp; b.play([card(b, mv).id]);
    assert.ok(e.hp > hp, `${ab} heals (${hp} -> ${e.hp})`);
  }
  assert.equal(effectiveness('FIRE', ['NORMAL'], 'DRY_SKIN'), 1.25);
});
check(['FLASH_FIRE', 'LIGHTNING_ROD', 'STORM_DRAIN', 'MOTOR_DRIVE'], () => {
  for (const [ab, sp, mv, gain] of [['FLASH_FIRE', 'CHARMANDER', 'EMBER', 'flash'], ['LIGHTNING_ROD', 'PIKACHU', 'THUNDER_SHOCK', 'spa'], ['STORM_DRAIN', 'SQUIRTLE', 'WATER_GUN', 'spa'], ['MOTOR_DRIVE', 'PIKACHU', 'THUNDER_SHOCK', 'spe']]) {
    const { b } = setup({ species: sp, moves: [mv], foeAb: ab });
    assert.equal(preview(b, mv), 0, ab + ' blocks');
    b.play([card(b, mv).id]);
    if (gain === 'flash') assert.ok(b.sides.enemy.flashFire, ab); else assert.equal(b.sides.enemy.stages[gain], 1, ab);
  }
});
// immunities and defensive damage modifiers (on the foe)
check(['LEVITATE', 'WONDER_GUARD', 'SOUNDPROOF', 'CACOPHONY'], () => {
  assert.equal(preview(setup({ species: 'SANDSHREW', moves: ['MAGNITUDE'], foeAb: 'LEVITATE' }).b, 'MAGNITUDE'), 0);
  assert.ok(preview(setup({ species: 'SANDSHREW', moves: ['MAGNITUDE'] }).b, 'MAGNITUDE') > 0);
  assert.equal(preview(setup({ moves: ['POUND'], foeAb: 'WONDER_GUARD' }).b, 'POUND'), 0);
  for (const ab of ['SOUNDPROOF', 'CACOPHONY']) assert.equal(preview(setup({ species: 'EXPLOUD', moves: ['HYPER_VOICE'], foeAb: ab }).b, 'HYPER_VOICE'), 0, ab);
});
check(['THICK_FAT', 'HEATPROOF', 'FILTER', 'SOLID_ROCK', 'MARVEL_SCALE'], () => {
  assert.ok(near(dmgRatio({ species: 'CHARMANDER', moves: ['EMBER'] }, 'EMBER', 'THICK_FAT', 'foeAb'), 0.5));
  assert.ok(near(dmgRatio({ species: 'CHARMANDER', moves: ['EMBER'] }, 'EMBER', 'HEATPROOF', 'foeAb'), 0.5));
  for (const ab of ['FILTER', 'SOLID_ROCK']) assert.ok(near(dmgRatio({ moves: ['KARATE_CHOP'] }, 'KARATE_CHOP', ab, 'foeAb'), 0.75), ab);
  assert.ok(dmgRatio({ moves: ['KARATE_CHOP'], before: ({ e }) => { e.status = 'PSN'; } }, 'KARATE_CHOP', 'MARVEL_SCALE', 'foeAb') < 0.8);
});
// your damage modifiers
check(['HUGE_POWER', 'PURE_POWER', 'HUSTLE', 'GUTS', 'TECHNICIAN', 'ADAPTABILITY', 'KLUTZ'], () => {
  for (const ab of ['HUGE_POWER', 'PURE_POWER']) assert.ok(dmgRatio({}, 'KARATE_CHOP', ab) > 1.6, ab);
  assert.ok(dmgRatio({}, 'KARATE_CHOP', 'HUSTLE') > 1.3);
  assert.ok(dmgRatio({ before: ({ mon }) => { mon.status = 'PSN'; } }, 'KARATE_CHOP', 'GUTS') > 1.3);
  assert.ok(near(dmgRatio({}, 'KARATE_CHOP', 'TECHNICIAN'), 1.5));
  assert.ok(near(dmgRatio({}, 'KARATE_CHOP', 'ADAPTABILITY'), 4 / 3));
  assert.ok(near(dmgRatio({}, 'KARATE_CHOP', 'KLUTZ'), 1.5));
});
check(['TINTED_LENS', 'RIVALRY', 'BLAZE', 'TORRENT', 'OVERGROW', 'SWARM', 'FLOWER_GIFT', 'SLOW_START'], () => {
  assert.ok(near(dmgRatio({ foe: 'ZUBAT' }, 'KARATE_CHOP', 'TINTED_LENS'), 2, 0.2));
  assert.ok(near(dmgRatio({ foe: 'MACHOP' }, 'KARATE_CHOP', 'RIVALRY'), 1.25));
  const low = ({ mon }) => { mon.hp = 1; };
  for (const [ab, sp, mv] of [['BLAZE', 'CHARMANDER', 'EMBER'], ['TORRENT', 'SQUIRTLE', 'WATER_GUN'], ['OVERGROW', 'BULBASAUR', 'VINE_WHIP'], ['SWARM', 'WEEDLE', 'POISON_STING']]) {
    if (ab === 'SWARM') assert.ok(near(dmgRatio({ species: 'SCYTHER', moves: ['FURY_CUTTER'], before: low }, 'FURY_CUTTER', ab), 1.5), ab);
    else assert.ok(near(dmgRatio({ species: sp, moves: [mv], before: low }, mv, ab), 1.5), ab);
  }
  const sun = (s) => { s.b.weather = 'SUN'; return s; };
  const fg = preview(sun(setup({ ab: 'FLOWER_GIFT' })).b, 'KARATE_CHOP'), fn = preview(sun(setup({})).b, 'KARATE_CHOP');
  assert.ok(near(fg / fn, 1.5), `FLOWER_GIFT ${fn} -> ${fg}`);
  assert.ok(near(dmgRatio({}, 'KARATE_CHOP', 'SLOW_START'), 0.5));
});
// stats and entry effects
check(['INTIMIDATE'], () => {
  assert.equal(setup({ foeAb: 'INTIMIDATE' }).b.sides.player.stages.atk, -1);
  assert.equal(setup({ ab: 'INTIMIDATE' }).b.sides.enemy.stages.atk, -1);
  assert.equal(setup({}).b.sides.player.stages.atk, 0);
});
check(['OBLIVIOUS', 'INNER_FOCUS', 'HYPER_CUTTER', 'CLEAR_BODY', 'WHITE_SMOKE'], () => {
  for (const ab of ['OBLIVIOUS', 'INNER_FOCUS', 'HYPER_CUTTER', 'CLEAR_BODY', 'WHITE_SMOKE']) assert.equal(setup({ ab, foeAb: 'INTIMIDATE' }).b.sides.player.stages.atk, 0, ab);
});
check(['KEEN_EYE', 'SIMPLE', 'MOLD_BREAKER'], () => {
  const k = setup({ foeAb: 'KEEN_EYE' }); k.b.addStage('enemy', 'acc', -1, 'SAND_ATTACK', true); assert.equal(k.b.sides.enemy.stages.acc, 0);
  const n = setup({}); n.b.addStage('enemy', 'acc', -1, 'SAND_ATTACK', true); assert.equal(n.b.sides.enemy.stages.acc, -1);
  const s = setup({ foeAb: 'SIMPLE' }); s.b.addStage('enemy', 'def', -1, 'LEER', true); assert.equal(s.b.sides.enemy.stages.def, -2);
  // MOLD BREAKER: your move ignores the foe's KEEN EYE / LIMBER / LEVITATE
  const m = setup({ ab: 'MOLD_BREAKER', foeAb: 'KEEN_EYE' }); m.b.addStage('enemy', 'acc', -1, 'SAND_ATTACK', true); assert.equal(m.b.sides.enemy.stages.acc, -1);
  assert.equal(setup({ ab: 'MOLD_BREAKER', foeAb: 'LIMBER' }).b.statusBlock('enemy', 'PAR', 'THUNDER_WAVE'), null);
  assert.ok(preview(setup({ species: 'SANDSHREW', moves: ['MAGNITUDE'], ab: 'MOLD_BREAKER', foeAb: 'LEVITATE' }).b, 'MAGNITUDE') > 0);
});
check(['DRIZZLE', 'DROUGHT', 'SAND_STREAM', 'SNOW_WARNING'], () => {
  for (const [ab, w] of [['DRIZZLE', 'RAIN'], ['DROUGHT', 'SUN'], ['SAND_STREAM', 'SAND'], ['SNOW_WARNING', 'HAIL']]) {
    assert.equal(setup({ foeAb: ab }).b.weather, w, ab + ' (foe)');
    assert.equal(setup({ ab }).b.weather, w, ab + ' (yours)');
  }
  assert.equal(setup({}).b.weather, null);
});
check(['CLOUD_NINE', 'AIR_LOCK', 'FORECAST'], () => {
  for (const ab of ['CLOUD_NINE', 'AIR_LOCK']) { const { b } = setup({ ab, foeAb: 'DROUGHT' }); assert.equal(b.weather, 'SUN'); assert.equal(b.wx(), null, ab); }
  const f = setup({ foe: 'CASTFORM', foeAb: 'FORECAST' }); f.b.setWeather('RAIN'); assert.deepEqual(f.e.types, ['WATER']);
  const y = setup({ species: 'CASTFORM', moves: ['TACKLE'], ab: 'FORECAST' }); y.b.setWeather('SUN'); assert.deepEqual(y.b.ptypes(y.mon), ['FIRE']);
});
check(['SWIFT_SWIM', 'CHLOROPHYLL', 'SPEED_BOOST', 'UNBURDEN'], () => {
  for (const [ab, w] of [['SWIFT_SWIM', 'RAIN'], ['CHLOROPHYLL', 'SUN']]) {
    const a = setup({ ab }), n = setup({}); a.b.weather = n.b.weather = w;
    assert.ok(near(a.b.speedOf('player') / n.b.speedOf('player'), 2, 0.01), ab);
  }
  const s = setup({ ab: 'SPEED_BOOST' }); s.b.leadResiduals(); assert.equal(s.b.sides.player.stages.spe, 1);
  const u = setup({ foeAb: 'UNBURDEN' }), un = setup({}); u.e.hp = un.e.hp = 1; u.b.enemyResiduals(); un.b.enemyResiduals();
  assert.ok(near(u.b.speedOf('enemy') / un.b.speedOf('enemy'), 2, 0.01), 'UNBURDEN');
});
// status immunities (both sides)
check(['LIMBER', 'INSOMNIA', 'VITAL_SPIRIT', 'IMMUNITY', 'WATER_VEIL', 'MAGMA_ARMOR', 'LEAF_GUARD', 'OWN_TEMPO'], () => {
  for (const [ab, st] of [['LIMBER', 'PAR'], ['INSOMNIA', 'SLP'], ['VITAL_SPIRIT', 'SLP'], ['IMMUNITY', 'PSN'], ['WATER_VEIL', 'BRN'], ['MAGMA_ARMOR', 'FRZ']]) {
    assert.notEqual(setup({ foeAb: ab }).b.statusBlock('enemy', st, 'TACKLE'), null, ab + ' (foe)');
    assert.notEqual(setup({ ab }).b.statusBlock('player', st, 'TACKLE'), null, ab + ' (yours)');
    assert.equal(setup({}).b.statusBlock('enemy', st, 'TACKLE'), null, st);
  }
  const lg = setup({ foeAb: 'LEAF_GUARD' }); lg.b.weather = 'SUN'; assert.notEqual(lg.b.statusBlock('enemy', 'PSN', 'TOXIC'), null);
  const ot = setup({ foeAb: 'OWN_TEMPO' }); ot.b.confuse('enemy', false); assert.equal(ot.b.sides.enemy.confused, 0);
  const nc = setup({}); nc.b.confuse('enemy', false); assert.ok(nc.b.sides.enemy.confused > 0);
});
// contact abilities: many touches, count what happens to the attacker
const touches = (ab, n = 300) => {
  const { b, mon, e } = setup({ foeAb: ab });
  let status = 0, love = 0, hurt = 0;
  for (let i = 0; i < n; i++) {
    b.sides.enemy.contactKey = null; mon.status = null; b.sides.player.infatuated = 0; mon.hp = maxHp(mon);
    b.contactAbility('enemy', e, 'player', mon);
    if (mon.status) status++; if (b.sides.player.infatuated) love++; if (mon.hp < maxHp(mon)) hurt++;
  }
  return { status, love, hurt };
};
check(['STATIC', 'FLAME_BODY', 'POISON_POINT', 'EFFECT_SPORE', 'CUTE_CHARM', 'ROUGH_SKIN'], () => {
  const none = touches('NONE');
  assert.deepEqual(none, { status: 0, love: 0, hurt: 0 });
  for (const ab of ['STATIC', 'FLAME_BODY', 'POISON_POINT', 'EFFECT_SPORE']) assert.ok(touches(ab).status > 5, ab);
  assert.ok(touches('CUTE_CHARM').love > 5);
  assert.equal(touches('ROUGH_SKIN', 20).hurt, 20);
});
// secondary effects of moves
const secondaries = (userAb, targetAb, n = 400) => {
  const { b, mon, e } = setup({ species: 'CHARMANDER', moves: ['EMBER'], ab: userAb, foeAb: targetAb });
  const move = { ...D.moves.EMBER, key: 'EMBER' };
  let burns = 0;
  for (let i = 0; i < n; i++) {
    e.status = null;
    EFFECTS[move.effect]({ b, user: mon, target: e, userSide: b.sides.player, targetSide: b.sides.enemy, us: 'player', them: 'enemy', move });
    if (e.status === 'BRN') burns++;
  }
  return burns;
};
check(['SERENE_GRACE'], () => { const base = secondaries('NONE', 'NONE'), sg = secondaries('SERENE_GRACE', 'NONE'); assert.ok(base > 10 && sg > base * 1.4, `${base} -> ${sg}`); });
check(['SHIELD_DUST', 'STENCH'], () => {
  // SHIELD DUST: a foe's added effect never reaches your lead; INNER FOCUS-like flinch immunity
  const s = setup({ ab: 'SHIELD_DUST' }); s.b.flinch('player'); assert.equal(s.b.sides.player.flinch, false);
  const n = setup({}); n.b.flinch('player'); assert.equal(n.b.sides.player.flinch, true);
  const st = setup({ foeAb: 'STENCH' }); assert.ok(st.b.flinchChance({ ...D.moves.TACKLE, key: 'TACKLE' }) > 0);
  assert.equal(n.b.flinchChance({ ...D.moves.TACKLE, key: 'TACKLE' }), 0);
});
check(['ROCK_HEAD'], () => {
  for (const mv of ['DOUBLE_EDGE', 'TAKE_DOWN', 'HEAD_SMASH', 'FLARE_BLITZ']) {
    const hpAfter = (ab) => {
      const { b, mon, e } = setup({ ab });
      const move = { ...D.moves[mv], key: mv, chance: 0 };
      EFFECTS[move.effect]({ b, user: mon, target: e, userSide: b.sides.player, targetSide: b.sides.enemy, us: 'player', them: 'enemy', move });
      return maxHp(mon) - mon.hp;
    };
    assert.ok(hpAfter('NONE') > 0, mv + ' recoil'); assert.equal(hpAfter('ROCK_HEAD'), 0, mv);
  }
});
check(['LIQUID_OOZE'], () => {
  const run = (ab) => { const { b, mon, e } = setup({ species: 'BULBASAUR', moves: ['GIGA_DRAIN'], foeAb: ab }); mon.hp = Math.floor(maxHp(mon) / 2); const hp = mon.hp; b.drainHeal({ b, user: mon, target: e, us: 'player', them: 'enemy', move: { ...D.moves.GIGA_DRAIN, key: 'GIGA_DRAIN' } }, 0.2); return mon.hp - hp; };
  assert.ok(run('NONE') > 0); assert.ok(run('LIQUID_OOZE') < 0);
});
check(['STURDY'], () => {
  const hit = (ab) => {
    const { b, mon } = setup({ species: 'MAGIKARP', moves: ['TACKLE'], level: 5, ab, foe: 'MACHAMP', foeLevel: 70, foeMoves: ['KARATE_CHOP'] });
    b.sides.enemy.lockOn = 2; b.intent = { move: { ...D.moves.KARATE_CHOP, key: 'KARATE_CHOP' } };
    b.enemyStrike(b.enemy(), mon, b.sides.enemy, b.sides.player, b.intent.move, false);
    return mon.hp;
  };
  assert.equal(hit('NONE'), 0); assert.equal(hit('STURDY'), 1);
  // a foe's STURDY: your OHKO cards do nothing
  const ohko = (foeAb) => { const { b } = setup({ species: 'KINGLER', moves: ['GUILLOTINE'], level: 100, foeAb }); return b.play([card(b, 'GUILLOTINE').id]).some(x => x.t === 'card' && x.label === 'NO EFFECT'); };
  assert.equal(ohko('STURDY'), true); assert.equal(ohko('NONE'), false);
});
check(['BATTLE_ARMOR', 'SHELL_ARMOR'], () => {
  for (const ab of ['BATTLE_ARMOR', 'SHELL_ARMOR']) {
    const { b } = setup({ species: 'CHANSEY', moves: ['POUND'], foeAb: ab, relics: ['LUCKY_PUNCH'] });
    const ev = b.play([card(b, 'POUND').id]);
    assert.ok(!ev.some(x => x.t === 'card' && x.label === 'CRITICAL'), ab);
  }
  const { b } = setup({ species: 'CHANSEY', moves: ['POUND'], relics: ['LUCKY_PUNCH'] });
  assert.ok(b.play([card(b, 'POUND').id]).some(x => x.t === 'card' && x.label === 'CRITICAL'), 'LUCKY PUNCH crits without the armor');
});
check(['TRACE', 'PRESSURE', 'DAMP', 'DOWNLOAD'], () => {
  const tr = setup({ species: 'RALTS', moves: ['CONFUSION'], ab: 'TRACE', foeAb: 'INTIMIDATE' }); assert.equal(tr.b.pab(tr.mon), 'INTIMIDATE');
  const ftr = setup({ ab: 'GUTS', foeAb: 'TRACE' }); assert.equal(ftr.e.ability, 'GUTS');
  assert.equal(setup({ foeAb: 'PRESSURE' }).b.discardsLeft, setup({}).b.discardsLeft - 1);
  const dp = setup({ species: 'GEODUDE', moves: ['EXPLOSION'], foeAb: 'DAMP' }); assert.equal(dp.b.cardInfo(card(dp.b, 'EXPLOSION')).reason, 'DAMP');
  const dn = setup({ species: 'GEODUDE', moves: ['EXPLOSION'] }); assert.equal(dn.b.cardInfo(card(dn.b, 'EXPLOSION')).reason, null);
  const dl = setup({ foeAb: 'DOWNLOAD' }); assert.equal(dl.b.sides.enemy.stages.atk + dl.b.sides.enemy.stages.spa, 1);
  const pd = setup({ ab: 'DOWNLOAD' }); assert.equal(pd.b.sides.player.stages.atk + pd.b.sides.player.stages.spa, 1);
});
check(['SHADOW_TAG', 'ARENA_TRAP', 'MAGNET_PULL', 'RUN_AWAY'], () => {
  for (const ab of ['SHADOW_TAG', 'ARENA_TRAP']) assert.equal(setup({ foeAb: ab }).b.switchTax(), ab);
  assert.equal(setup({}).b.switchTax(), null);
  const half = ({ e }) => { e.hp = Math.floor(e.maxHp / 2); };
  assert.ok(setup({ ab: 'SHADOW_TAG', before: half }).b.catchChance('POKE_BALL') > setup({ before: half }).b.catchChance('POKE_BALL'));
  // MAGNET PULL foe: a STEEL lead can't run; RUN AWAY: always gets away
  const mp = setup({ species: 'MAGNEMITE', moves: ['TACKLE'], level: 5, foeAb: 'MAGNET_PULL', foeLevel: 60 });
  mp.b.flee(); assert.equal(mp.b.result, null);
  const ra = setup({ species: 'MAGIKARP', moves: ['TACKLE'], level: 2, ab: 'RUN_AWAY', foeLevel: 60 });
  ra.b.flee(); assert.equal(ra.b.result?.outcome, 'fled');
});
check(['NATURAL_CURE', 'SHED_SKIN', 'HYDRATION', 'RAIN_DISH'], () => {
  const nc = setup({ ab: 'NATURAL_CURE', before: ({ run }) => { run.party.push(makeMon('RATTATA', 20, { rng: new RNG('r') })); } });
  nc.b.buildDeck(); nc.mon.status = 'PSN'; nc.b.discardsLeft = 3; nc.b.switchLead(nc.run.party[1].uid); assert.equal(nc.mon.status, null);
  let cured = 0; for (let i = 0; i < 40; i++) { const s = setup({ foeAb: 'SHED_SKIN' }); s.b.rng = new RNG('ss' + i); s.e.status = 'PSN'; s.b.enemyResiduals(); if (!s.e.status) cured++; }
  assert.ok(cured > 3, 'SHED_SKIN ' + cured);
  const h = setup({ foeAb: 'HYDRATION' }); h.b.weather = 'RAIN'; h.e.status = 'PSN'; h.b.enemyResiduals(); assert.equal(h.e.status, null);
  const rd = setup({ ab: 'RAIN_DISH' }); rd.b.weather = 'RAIN'; rd.mon.hp = 10; rd.b.leadResiduals(); assert.ok(rd.mon.hp > 10);
});
check(['PICKUP', 'HONEY_GATHER', 'ILLUMINATE'], () => {
  const run = Run.create({ starter: 'CHARMANDER', seed: 'F' });
  const m = (sp, ab) => { const x = makeMon(sp, 10, { rng: new RNG(sp) }); x.ability = ab; return x; };
  run.party = [m('MEOWTH', 'PICKUP'), m('STARYU', 'ILLUMINATE'), m('COMBEE', 'HONEY_GATHER')];
  const mods = run.mods();
  assert.ok(mods.pickup > 0); assert.equal(mods.rareFindMult, 2); assert.equal(mods.honey, 1);
  run.party = [m('MEOWTH', 'NONE')];
  const none = run.mods(); assert.ok(!none.pickup && !none.rareFindMult && !none.honey);
});
check(['TRUANT', 'COMPOUND_EYES'], () => {
  const tr = setup({ ab: 'TRUANT' }); tr.b.handsPlayed = 1; assert.equal(tr.b.cardInfo(card(tr.b, 'KARATE_CHOP')).reason, 'LOAFING');
  // COMPOUND EYES: hit rate of an 50%-accurate move over many rolls
  const hits = (ab) => { const { b, mon, e } = setup({ ab }); b.rng = new RNG('ce'); const mv = { ...D.moves.DYNAMIC_PUNCH, key: 'DYNAMIC_PUNCH' }; let n = 0; for (let i = 0; i < 400; i++) if (b.rollPlayerAccuracy(mv, mon, e, false)) n++; return n; };
  assert.ok(hits('COMPOUND_EYES') > hits('NONE') * 1.15);
});
// co-op duo battles: a foe's entry abilities
check(['PRESSURE', 'TRACE', 'DOWNLOAD'], () => {
  const duo = (foeAb, leadAb = 'GUTS') => {
    const r0 = Run.create({ starter: 'CHARMANDER', seed: 'CV0', coop: true }), r1 = Run.create({ starter: 'SQUIRTLE', seed: 'CV1', coop: true });
    r0.party[0].ability = leadAb;
    const foes = ['RATTATA', 'PIDGEY'].map((sp, i) => { const e = makeEnemy(sp, 10, { rng: new RNG('cf' + i), moves: ['GROWL'] }); e.ability = i ? 'NONE' : foeAb; return e; });
    const d = new DuoBattle([r0, r1], { kind: 'wild', coopKind: 'wild', enemies: foes, queues: [[0], [1]], slotQueue: [0, 1], slots: 2, rng: new RNG('cvd') });
    d.start();
    return d;
  };
  const p = duo('PRESSURE'), n = duo('NONE');
  assert.deepEqual(p.subs.map(s => s.discardsLeft), n.subs.map(s => s.discardsLeft - 1), 'co-op PRESSURE: every player -1 discard');
  assert.equal(duo('TRACE').enemies[0].ability, 'GUTS', 'co-op TRACE');
  const dl = duo('DOWNLOAD').enemySides[0].stages; assert.equal(dl.atk + dl.spa, 1, 'co-op DOWNLOAD');
});

t(`behavioural checks cover at least 25 abilities (${tested.size})`, () => assert.ok(tested.size >= 25, tested.size));
t('behavioural checks only name real abilities', () => assert.deepEqual([...tested].filter(k => !ALL.has(k)), []));

console.log(`ability coverage: ${KEYS.length} abilities, ${tested.size} with behavioural checks; ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
