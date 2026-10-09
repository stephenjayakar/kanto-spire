// Move effect handlers shared by player cards and enemy moves.
// ctx: { b, user, target, userSide, targetSide, us ('player'|'enemy'), them, move, card?, score? }
// Status moves call their handler when "used"; damaging moves call it after hitting (secondary effects).

const STAT_NAMES = { atk: 'ATTACK', def: 'DEFENSE', spa: 'SP. ATK', spd: 'SP. DEF', spe: 'SPEED', acc: 'accuracy', eva: 'evasiveness' };
export { STAT_NAMES };

function chance(ctx, p) {
  // Secondary effect chance (0 means always for status moves).
  if (!p) return true;
  return ctx.b.rng.next() * 100 < p * (ctx.us === 'player' ? ctx.b.secondaryBoost : 1);
}

const stage = (stat, n, self = false) => (ctx) => {
  const side = self ? ctx.us : ctx.them;
  if (ctx.move.power > 0 && !chance(ctx, ctx.move.chance)) return;
  ctx.b.addStage(side, stat, n, ctx.move.key, !self);
};
const stages = (list, self = true) => (ctx) => {
  if (ctx.move.power > 0 && !chance(ctx, ctx.move.chance)) return;
  for (const [stat, n] of list) ctx.b.addStage(self ? ctx.us : ctx.them, stat, n, ctx.move.key, !self);
};
const status = (st) => (ctx) => {
  if (ctx.move.power > 0 && !chance(ctx, ctx.move.chance)) return;
  ctx.b.inflictStatus(ctx.them, st, ctx.move.key, ctx.move.power === 0);
};
const confuse = (ctx) => {
  if (ctx.move.power > 0 && !chance(ctx, ctx.move.chance)) return;
  ctx.b.confuse(ctx.them, ctx.move.power === 0);
};
const flinch = (ctx) => { if (chance(ctx, ctx.move.chance)) ctx.b.flinch(ctx.them); };
const heal = (frac) => (ctx) => ctx.b.healSide(ctx.us, ctx.user, frac, ctx.move.key);
const nothing = () => {};

// Damage modifiers: functions returning a power override or multiplier, evaluated when scoring.
// powerFn(ctx) -> power
export const POWER_FN = {
  FLAIL: ({ user, b, us }) => { const r = b.hpFrac(us, user); return r < 0.05 ? 200 : r < 0.1 ? 150 : r < 0.2 ? 100 : r < 0.35 ? 80 : r < 0.7 ? 40 : 20; },
  ERUPTION: ({ user, b, us, move }) => Math.max(1, Math.floor(move.power * b.hpFrac(us, user))),
  RETURN: () => 102,
  FRUSTRATION: () => 40,
  HIDDEN_POWER: ({ user }) => hiddenPower(user).power,
  MAGNITUDE: ({ b }) => b.rng.pick([10, 30, 50, 50, 70, 70, 70, 90, 90, 110, 150]),
  PRESENT: ({ b }) => b.rng.pick([40, 40, 80, 120]),
  LOW_KICK: ({ target }) => { const w = target.weight || 300; return w < 100 ? 20 : w < 250 ? 40 : w < 500 ? 60 : w < 1000 ? 80 : w < 2000 ? 100 : 120; },
  FACADE: ({ user, move }) => (user.status ? move.power * 2 : move.power),
  SMELLINGSALT: ({ target, move }) => (target.status === 'PAR' ? move.power * 2 : move.power),
  REVENGE: ({ b, us, move }) => (b.sides[us].hitThisTurn ? move.power * 2 : move.power),
  FURY_CUTTER: ({ b, card, move }) => move.power * Math.pow(2, Math.min(4, b.chain(card, 'fury'))),
  ROLLOUT: ({ b, card, move, us }) => move.power * Math.pow(2, Math.min(4, b.chain(card, 'rollout'))) * (b.sides[us].curled ? 2 : 1),
  SPIT_UP: ({ b, us }) => 100 * (b.sides[us].stockpile || 0),
  WEATHER_BALL: ({ b, move }) => (b.weather ? move.power * 2 : move.power),
  BEAT_UP: ({ b, us }) => 10 * b.healthyCount(us) + 10,
  TRIPLE_KICK: ({ move, hitIndex }) => move.power * (hitIndex + 1),
  RAGE: ({ b, us, move }) => move.power + 10 * (b.sides[us].rage || 0),
  PURSUIT: ({ move }) => move.power,
  SNORE: ({ move }) => move.power,
  FOCUS_PUNCH: ({ b, us, move }) => (b.sides[us].hitThisTurn ? 0 : move.power),
  DREAM_EATER: ({ target, move }) => (target.status === 'SLP' ? move.power : 0),
  // Gen 4
  BRINE: ({ b, us, target, move }) => (b.hpFrac(us === 'player' ? 'enemy' : 'player', target) <= 0.5 ? move.power * 2 : move.power),
  // fails (0 = FAILED) when the foe's intent isn't an attack; the foe's own SUCKER PUNCH always works
  SUCKER_PUNCH: ({ b, us, move }) => (us === 'player' && b.intent && !(b.intent.move.power > 0 || FIXED_DAMAGE[b.intent.move.effect]) ? 0 : move.power),
};

// Fixed-damage moves ignore stats/type: return damage directly (real Gen 3 values).
export const FIXED_DAMAGE = {
  LEVEL_DAMAGE: ({ user }) => user.level,
  DRAGON_RAGE: () => 40,
  SONICBOOM: () => 20,
  PSYWAVE: ({ user, b }) => Math.floor(user.level * (0.5 + b.rng.next())),
};

export function hiddenPower(mon) {
  const iv = mon.ivs;
  const types = ['FIGHTING', 'FLYING', 'POISON', 'GROUND', 'ROCK', 'BUG', 'GHOST', 'STEEL', 'FIRE', 'WATER', 'GRASS', 'ELECTRIC', 'PSYCHIC', 'ICE', 'DRAGON', 'DARK'];
  const bit = (v, n) => (v >> n) & 1;
  const t = Math.floor(((bit(iv.hp, 0) + 2 * bit(iv.atk, 0) + 4 * bit(iv.def, 0) + 8 * bit(iv.spe, 0) + 16 * bit(iv.spa, 0) + 32 * bit(iv.spd, 0)) * 15) / 63);
  const p = Math.floor(((bit(iv.hp, 1) + 2 * bit(iv.atk, 1) + 4 * bit(iv.def, 1) + 8 * bit(iv.spe, 1) + 16 * bit(iv.spa, 1) + 32 * bit(iv.spd, 1)) * 40) / 63) + 30;
  return { type: types[t], power: p };
}

// How many times a card hits (multi-hit moves hit 2-5 times, each a full hit).
export function hitCount(b, move) {
  switch (move.effect) {
    case 'MULTI_HIT': { const r = b.rng.next(); return r < 0.375 ? 2 : r < 0.75 ? 3 : r < 0.875 ? 4 : 5; }
    case 'DOUBLE_HIT': case 'TWINEEDLE': return 2;
    case 'TRIPLE_KICK': return 3;
    default: return 1;
  }
}

export function critStageOf(move) {
  return ['HIGH_CRITICAL', 'BLAZE_KICK', 'POISON_TAIL', 'SKY_ATTACK'].includes(move.effect) || move.key === 'RAZOR_WIND' ? 1 : 0;
}

// Effects applied after a damaging hit or when a status move is used.
// Gen 3 rule for PROTECT / DETECT / ENDURE: used on consecutive turns, each success halves the next
// one's chance (100%, 50%, 25%...). A second copy in the same hand does nothing more.
function protectRoll(ctx) {
  const b = ctx.b, s = b.sides[ctx.us];
  if (s.protectTurn === b.turn) return false;
  const chain = s.protectTurn === b.turn - 1 ? (s.protectChain || 0) : 0;
  const ok = b.rng.chance(1 / Math.pow(2, chain));
  s.protectTurn = b.turn;
  s.protectChain = ok ? chain + 1 : 0;
  if (!ok) b.msg('But it failed!');
  return ok;
}

export const EFFECTS = {
  HIT: nothing, HIGH_CRITICAL: nothing, ALWAYS_HIT: nothing, QUICK_ATTACK: nothing, VITAL_THROW: nothing,
  MULTI_HIT: nothing, DOUBLE_HIT: nothing, TRIPLE_KICK: nothing, FLAIL: nothing, ERUPTION: nothing, RETURN: nothing,
  FRUSTRATION: nothing, HIDDEN_POWER: nothing, MAGNITUDE: nothing, PRESENT: nothing, LOW_KICK: nothing, FACADE: nothing,
  REVENGE: nothing, FURY_CUTTER: nothing, WEATHER_BALL: nothing, BEAT_UP: nothing, PURSUIT: nothing, SKY_UPPERCUT: nothing,
  EARTHQUAKE: nothing, GUST: nothing, LEVEL_DAMAGE: nothing, DRAGON_RAGE: nothing, SONICBOOM: nothing, PSYWAVE: nothing,
  FOCUS_PUNCH: nothing, SPIT_UP: (ctx) => { ctx.b.sides[ctx.us].stockpile = 0; },
  ROLLOUT: nothing, RAGE: (ctx) => { ctx.b.sides[ctx.us].rage = (ctx.b.sides[ctx.us].rage || 0) + 1; },

  PARALYZE_HIT: status('PAR'), BURN_HIT: status('BRN'), FREEZE_HIT: status('FRZ'), POISON_HIT: status('PSN'),
  BLAZE_KICK: status('BRN'), POISON_TAIL: status('PSN'), POISON_FANG: status('TOX'), THAW_HIT: status('BRN'),
  TWINEEDLE: status('PSN'), THUNDER: status('PAR'),
  TRI_ATTACK: (ctx) => { if (chance(ctx, ctx.move.chance)) ctx.b.inflictStatus(ctx.them, ctx.b.rng.pick(['PAR', 'BRN', 'FRZ']), ctx.move.key); },
  SECRET_POWER: (ctx) => { if (chance(ctx, ctx.move.chance)) ctx.b.inflictStatus(ctx.them, 'PAR', ctx.move.key); },
  FLINCH_HIT: flinch, FLINCH_MINIMIZE_HIT: flinch, TWISTER: flinch, SNORE: flinch,
  FAKE_OUT: (ctx) => { if (ctx.b.turn === 1) ctx.b.flinch(ctx.them, true); },
  CONFUSE_HIT: confuse,
  ATTACK_DOWN_HIT: stage('atk', -1), DEFENSE_DOWN_HIT: stage('def', -1), SPEED_DOWN_HIT: stage('spe', -1),
  SPECIAL_ATTACK_DOWN_HIT: stage('spa', -1), SPECIAL_DEFENSE_DOWN_HIT: stage('spd', -1), ACCURACY_DOWN_HIT: stage('acc', -1),
  ATTACK_UP_HIT: stage('atk', 1, true), DEFENSE_UP_HIT: stage('def', 1, true),
  ALL_STATS_UP_HIT: stages([['atk', 1], ['def', 1], ['spa', 1], ['spd', 1], ['spe', 1]]),
  SUPERPOWER: (ctx) => { ctx.b.addStage(ctx.us, 'atk', -1, ctx.move.key); ctx.b.addStage(ctx.us, 'def', -1, ctx.move.key); },
  OVERHEAT: (ctx) => ctx.b.addStage(ctx.us, 'spa', -2, ctx.move.key),
  ABSORB: (ctx) => ctx.b.healSide(ctx.us, ctx.user, ctx.move.power >= 60 ? 0.2 : 0.12, ctx.move.key),
  DREAM_EATER: (ctx) => { if (ctx.target.status === 'SLP') ctx.b.healSide(ctx.us, ctx.user, 0.3, ctx.move.key); },
  RECOIL: (ctx) => ctx.b.recoil(ctx.us, ctx.user, 1 / 8, ctx.move.key),
  DOUBLE_EDGE: (ctx) => ctx.b.recoil(ctx.us, ctx.user, 1 / 6, ctx.move.key),
  RECOIL_IF_MISS: nothing,
  RECHARGE: (ctx) => ctx.b.setRecharge(ctx.us, ctx.user),
  RAMPAGE: (ctx) => { if (ctx.b.rng.chance(0.5)) ctx.b.confuse(ctx.us, false, true); },
  UPROAR: (ctx) => { ctx.b.sides[ctx.us].uproar = 3; },
  TRAP: (ctx) => { ctx.b.sides[ctx.them].trapped = ctx.b.rng.int(2, 5); ctx.b.msg(`${ctx.b.sideName(ctx.them)} was trapped!`); },
  RAPID_SPIN: (ctx) => { const s = ctx.b.sides[ctx.us]; s.trapped = 0; s.seeded = false; s.spikes = 0; },
  PAY_DAY: (ctx) => { if (ctx.us === 'player') { const amt = 5 * ctx.user.level; ctx.b.payDay += amt; ctx.b.msg(`Coins scattered everywhere! (+$${amt})`); } },
  THIEF: (ctx) => { if (ctx.us === 'player') { const amt = 10 * ctx.user.level; ctx.b.payDay += amt; ctx.b.msg(`${ctx.b.monName(ctx.user)} swiped some cash! (+$${amt})`); } },
  KNOCK_OFF: (ctx) => { ctx.b.sides[ctx.them].reflect = 0; ctx.b.sides[ctx.them].lightScreen = 0; },
  BRICK_BREAK: (ctx) => { if (ctx.b.sides[ctx.them].reflect || ctx.b.sides[ctx.them].lightScreen) ctx.b.msg('It shattered the barrier!'); ctx.b.sides[ctx.them].reflect = 0; ctx.b.sides[ctx.them].lightScreen = 0; },
  // The lead is out of reach until the turn ends: side.dodge names the move, so the Gen 3 exceptions apply
  // (SURF hits a DIVE user, EARTHQUAKE a DIG user...; see INVULN_HITS in battle.js).
  SEMI_INVULNERABLE: (ctx) => { if (ctx.us === 'player' && ctx.user === ctx.b.lead()) { const s = ctx.b.sides.player; s.dodge = ctx.move.key || true; s.dodgeUid = ctx.user.uid; ctx.b.msg(`${ctx.b.monName(ctx.user)} is out of reach!`); } },
  SOLAR_BEAM: (ctx) => { if (ctx.b.weather !== 'SUN') ctx.b.setRecharge(ctx.us, ctx.user, 'charging'); },
  RAZOR_WIND: (ctx) => ctx.b.setRecharge(ctx.us, ctx.user, 'charging'),
  SKULL_BASH: (ctx) => { ctx.b.addStage(ctx.us, 'def', 1, ctx.move.key); ctx.b.setRecharge(ctx.us, ctx.user, 'charging'); },
  SKY_ATTACK: (ctx) => { ctx.b.setRecharge(ctx.us, ctx.user, 'charging'); flinch({ ...ctx, move: { ...ctx.move, chance: 30 } }); },
  EXPLOSION: (ctx) => ctx.b.selfFaint(ctx.us, ctx.user),
  OHKO: nothing, SUPER_FANG: nothing, FALSE_SWIPE: nothing, MEMENTO: nothing, ENDEAVOR: nothing,
  FUTURE_SIGHT: nothing,

  // ---- Gen 4 (gen4_moves.js) ----
  FIRE_FANG: (ctx) => { status('BRN')(ctx); flinch(ctx); },
  ICE_FANG: (ctx) => { status('FRZ')(ctx); flinch(ctx); },
  THUNDER_FANG: (ctx) => { status('PAR')(ctx); flinch(ctx); },
  FLARE_BLITZ: (ctx) => { ctx.b.recoil(ctx.us, ctx.user, 1 / 6, ctx.move.key); status('BRN')(ctx); },
  HEAD_SMASH: (ctx) => ctx.b.recoil(ctx.us, ctx.user, 1 / 4, ctx.move.key),
  CLOSE_COMBAT: (ctx) => { ctx.b.addStage(ctx.us, 'def', -1, ctx.move.key); ctx.b.addStage(ctx.us, 'spd', -1, ctx.move.key); },
  HAMMER_ARM: (ctx) => ctx.b.addStage(ctx.us, 'spe', -1, ctx.move.key),
  SPECIAL_ATTACK_UP_HIT: stage('spa', 1, true),
  U_TURN: (ctx) => { if (ctx.us === 'player') { ctx.b.freeSwitches += 1; ctx.b.msg('Your next switch is free!'); } },
  BRINE: nothing, SUCKER_PUNCH: nothing,

  // ---- status moves ----
  SLEEP: status('SLP'), POISON: status('PSN'), TOXIC: status('TOX'), PARALYZE: status('PAR'), WILL_O_WISP: status('BRN'),
  CONFUSE: confuse,
  TEETER_DANCE: confuse,
  SWAGGER: (ctx) => { ctx.b.addStage(ctx.them, 'atk', 2, ctx.move.key, true); ctx.b.confuse(ctx.them, true); },
  FLATTER: (ctx) => { ctx.b.addStage(ctx.them, 'spa', 1, ctx.move.key, true); ctx.b.confuse(ctx.them, true); },
  // The foe grows drowsy and falls asleep at the end of this turn (it skips its next move). Fails at once, with a
  // message, if it can't fall asleep (already statused, INSOMNIA / VITAL SPIRIT, SAFEGUARD, SUBSTITUTE...).
  YAWN: (ctx) => {
    const why = ctx.b.sleepBlock(ctx.them);
    if (why) { ctx.b.msg(why); return; }
    ctx.b.sides[ctx.them].yawn = 1;
    ctx.b.msg(`${ctx.b.sideName(ctx.them)} grew drowsy! It will fall asleep at the end of the turn.`);
  },
  ATTRACT: (ctx) => { if (ctx.us === 'player' && (ctx.target.isBoss || ctx.target.isElite || ctx.target.legendary)) return ctx.b.msg(`${ctx.b.sideName(ctx.them)} is unmoved!`); ctx.b.sides[ctx.them].infatuated = 3; ctx.b.msg(`${ctx.b.sideName(ctx.them)} fell in love!`); },
  NIGHTMARE: (ctx) => { if (ctx.target.status === 'SLP') { ctx.b.sides[ctx.them].nightmare = true; ctx.b.msg(`${ctx.b.sideName(ctx.them)} began having a NIGHTMARE!`); } else ctx.b.msg('But it failed!'); },
  LEECH_SEED: (ctx) => {
    if (ctx.target.types?.includes('GRASS') || ctx.b.typesOfSide(ctx.them).includes('GRASS')) return ctx.b.msg("It doesn't affect the foe...");
    ctx.b.sides[ctx.them].seeded = true; ctx.b.msg(`${ctx.b.sideName(ctx.them)} was seeded!`);
  },
  MEAN_LOOK: (ctx) => { ctx.b.sides[ctx.them].meanLook = true; ctx.b.msg(`${ctx.b.sideName(ctx.them)} can't escape now!`); },
  SPIKES: (ctx) => { const s = ctx.b.sides[ctx.them]; s.spikes = Math.min(3, (s.spikes || 0) + 1); ctx.b.msg('Spikes were scattered all around!'); },
  ATTACK_UP: stage('atk', 1, true), ATTACK_UP_2: stage('atk', 2, true), DEFENSE_UP: stage('def', 1, true),
  DEFENSE_UP_2: stage('def', 2, true), SPEED_UP_2: stage('spe', 2, true), SPECIAL_ATTACK_UP: stage('spa', 1, true),
  SPECIAL_ATTACK_UP_2: stage('spa', 2, true), SPECIAL_DEFENSE_UP_2: stage('spd', 2, true), EVASION_UP: stage('eva', 1, true),
  MINIMIZE: stage('eva', 1, true),
  DEFENSE_CURL: (ctx) => { ctx.b.addStage(ctx.us, 'def', 1, ctx.move.key); ctx.b.sides[ctx.us].curled = true; },
  ATTACK_DOWN: stage('atk', -1), ATTACK_DOWN_2: stage('atk', -2), DEFENSE_DOWN: stage('def', -1), DEFENSE_DOWN_2: stage('def', -2),
  SPEED_DOWN: stage('spe', -1), SPEED_DOWN_2: stage('spe', -2), SPECIAL_DEFENSE_DOWN_2: stage('spd', -2),
  ACCURACY_DOWN: stage('acc', -1), EVASION_DOWN: stage('eva', -1),
  TICKLE: stages([['atk', -1], ['def', -1]], false),
  CALM_MIND: stages([['spa', 1], ['spd', 1]]), BULK_UP: stages([['atk', 1], ['def', 1]]),
  DRAGON_DANCE: stages([['atk', 1], ['spe', 1]]), COSMIC_POWER: stages([['def', 1], ['spd', 1]]),
  BELLY_DRUM: (ctx) => {
    if (ctx.b.hpFrac(ctx.us, ctx.user) <= 0.5) return ctx.b.msg('But it failed!');
    ctx.b.recoil(ctx.us, ctx.user, 0.5, ctx.move.key, true); ctx.b.addStage(ctx.us, 'atk', 12, ctx.move.key);
  },
  CURSE: (ctx) => {
    if (ctx.b.typesOfMon(ctx.us, ctx.user).includes('GHOST')) {
      ctx.b.recoil(ctx.us, ctx.user, 0.5, ctx.move.key, true); ctx.b.sides[ctx.them].cursed = true;
      ctx.b.msg(`${ctx.b.sideName(ctx.them)} was cursed!`);
    } else { ctx.b.addStage(ctx.us, 'spe', -1, ctx.move.key); ctx.b.addStage(ctx.us, 'atk', 1, ctx.move.key); ctx.b.addStage(ctx.us, 'def', 1, ctx.move.key); }
  },
  GROWTH: stage('spa', 1, true),
  CHARGE: (ctx) => { ctx.b.sides[ctx.us].charge = true; ctx.b.msg(`${ctx.b.sideName(ctx.us)} began charging power!`); },
  FOCUS_ENERGY: (ctx) => { ctx.b.sides[ctx.us].focus = 2; ctx.b.msg(`${ctx.b.sideName(ctx.us)} is getting pumped!`); },
  LOCK_ON: (ctx) => { ctx.b.sides[ctx.us].lockOn = 2; ctx.b.msg(`${ctx.b.sideName(ctx.us)} took aim!`); },
  FORESIGHT: (ctx) => { ctx.b.sides[ctx.them].foresight = true; ctx.b.sides[ctx.them].stages.eva = Math.min(0, ctx.b.sides[ctx.them].stages.eva); ctx.b.msg(`${ctx.b.sideName(ctx.them)} was identified!`); },
  HELPING_HAND: (ctx) => { ctx.b.sides[ctx.us].helpingHand = true; },
  PSYCH_UP: (ctx) => { ctx.b.sides[ctx.us].stages = { ...ctx.b.sides[ctx.them].stages }; ctx.b.msg(`${ctx.b.sideName(ctx.us)} copied the foe's stat changes!`); },
  HAZE: (ctx) => { for (const s of ['player', 'enemy']) for (const k in ctx.b.sides[s].stages) ctx.b.sides[s].stages[k] = 0; ctx.b.msg('All stat changes were eliminated!'); },
  MIST: (ctx) => { ctx.b.sides[ctx.us].mist = 5; ctx.b.msg(`${ctx.b.sideName(ctx.us)} became shrouded in MIST!`); },
  SAFEGUARD: (ctx) => { ctx.b.sides[ctx.us].safeguard = 5; ctx.b.msg(`${ctx.b.sideName(ctx.us)} became cloaked in a mystical veil!`); },
  REFLECT: (ctx) => { ctx.b.sides[ctx.us].reflect = 5; ctx.b.msg('REFLECT raised DEFENSE!'); },
  LIGHT_SCREEN: (ctx) => { ctx.b.sides[ctx.us].lightScreen = 5; ctx.b.msg('LIGHT SCREEN raised SP. DEF!'); },
  PROTECT: (ctx) => { if (protectRoll(ctx)) { ctx.b.sides[ctx.us].protect = true; ctx.b.msg(`${ctx.b.sideName(ctx.us)} protected itself!`); } },
  ENDURE: (ctx) => { if (protectRoll(ctx)) { ctx.b.sides[ctx.us].endure = true; ctx.b.msg(`${ctx.b.sideName(ctx.us)} braced itself!`); } },
  SUBSTITUTE: (ctx) => {
    if (ctx.b.hpFrac(ctx.us, ctx.user) <= 0.25) return ctx.b.msg('But it failed!');
    ctx.b.recoil(ctx.us, ctx.user, 0.25, ctx.move.key, true);
    ctx.b.sides[ctx.us].substitute = true; ctx.b.sides[ctx.us].subHp = Math.floor(ctx.b.maxHpOf(ctx.us, ctx.user) / 4); ctx.b.msg('It made a SUBSTITUTE!');
  },
  INGRAIN: (ctx) => { ctx.b.sides[ctx.us].ingrain = true; ctx.b.msg(`${ctx.b.sideName(ctx.us)} planted its roots!`); },
  WISH: (ctx) => { ctx.b.sides[ctx.us].wish = 2; ctx.b.msg(`${ctx.b.sideName(ctx.us)} made a WISH!`); },
  STOCKPILE: (ctx) => { const s = ctx.b.sides[ctx.us]; s.stockpile = Math.min(3, (s.stockpile || 0) + 1); ctx.b.msg(`${ctx.b.sideName(ctx.us)} stockpiled ${s.stockpile}!`); },
  SWALLOW: (ctx) => { const s = ctx.b.sides[ctx.us]; const n = s.stockpile || 0; if (!n) return ctx.b.msg('But it failed!'); ctx.b.healSide(ctx.us, ctx.user, [0, 0.25, 0.5, 1][n], ctx.move.key); s.stockpile = 0; },
  RESTORE_HP: heal(0.5), SOFTBOILED: heal(0.5), MORNING_SUN: heal(0.5), SYNTHESIS: heal(0.5), MOONLIGHT: heal(0.5),
  REST: (ctx) => { ctx.b.healSide(ctx.us, ctx.user, 1, ctx.move.key); ctx.user.status = null; ctx.b.inflictStatus(ctx.us, 'SLP', 'REST', false, ctx.user, 2); },
  HEAL_BELL: (ctx) => ctx.b.cureSide(ctx.us, true),
  REFRESH: (ctx) => ctx.b.cureSide(ctx.us, false, ctx.user),
  PAIN_SPLIT: (ctx) => ctx.b.painSplit(ctx.us, ctx.user),
  BATON_PASS: (ctx) => { if (ctx.us === 'player') { ctx.b.freeSwitches += 1; ctx.b.batonPass = true; ctx.b.msg('Next switch is free and keeps stat changes!'); } },
  TELEPORT: (ctx) => ctx.b.tryEscape(ctx.us),
  ROAR: (ctx) => ctx.b.tryEscape(ctx.us, true),
  SUNNY_DAY: (ctx) => ctx.b.setWeather('SUN'), RAIN_DANCE: (ctx) => ctx.b.setWeather('RAIN'),
  SANDSTORM: (ctx) => ctx.b.setWeather('SAND'), HAIL: (ctx) => ctx.b.setWeather('HAIL'),
  WATER_SPORT: (ctx) => { ctx.b.sides[ctx.us].waterSport = true; ctx.b.msg("FIRE's power was weakened!"); },
  MUD_SPORT: (ctx) => { ctx.b.sides[ctx.us].mudSport = true; ctx.b.msg("ELECTRICITY's power was weakened!"); },
  DISABLE: (ctx) => { ctx.b.sides[ctx.them].disabled = 1; ctx.b.msg(`${ctx.b.sideName(ctx.them)}'s move was disabled!`); },
  ENCORE: (ctx) => { ctx.b.sides[ctx.them].disabled = 1; ctx.b.msg(`${ctx.b.sideName(ctx.them)} got an ENCORE!`); },
  TAUNT: (ctx) => { ctx.b.sides[ctx.them].taunt = 3; ctx.b.msg(`${ctx.b.sideName(ctx.them)} fell for the TAUNT!`); },
  TORMENT: (ctx) => { ctx.b.sides[ctx.them].torment = true; ctx.b.msg(`${ctx.b.sideName(ctx.them)} was subjected to TORMENT!`); },
  SPITE: stage('atk', -1), IMPRISON: stage('spa', -1), GRUDGE: (ctx) => { ctx.b.sides[ctx.us].destinyBond = true; },
  DESTINY_BOND: (ctx) => { ctx.b.sides[ctx.us].destinyBond = true; ctx.b.msg(`${ctx.b.sideName(ctx.us)} is trying to take its foe with it!`); },
  PERISH_SONG: (ctx) => { ctx.b.sides[ctx.them].perish = 3; ctx.b.msg('All POKéMON hearing the song will faint in three turns!'); },
  MAGIC_COAT: (ctx) => { ctx.b.sides[ctx.us].magicCoat = true; },
  SNATCH: (ctx) => { ctx.b.sides[ctx.us].magicCoat = true; },
  // "Draw" cards add to NEXT turn's hand (drawing mid-turn was swallowed by the refill).
  FOLLOW_ME: (ctx) => ctx.b.queueDraw(ctx.us, 2),
  RECYCLE: (ctx) => ctx.b.queueDraw(ctx.us, 2),
  TRICK: (ctx) => ctx.b.queueDraw(ctx.us, 2),
  SKILL_SWAP: (ctx) => ctx.b.queueDraw(ctx.us, 2),
  ROLE_PLAY: (ctx) => ctx.b.queueDraw(ctx.us, 2),
  CONVERSION: (ctx) => ctx.b.queueDraw(ctx.us, 1),
  CONVERSION_2: (ctx) => ctx.b.queueDraw(ctx.us, 1),
  CAMOUFLAGE: (ctx) => ctx.b.queueDraw(ctx.us, 1),
  // Copying moves: one-use cards of the foe's moves, added to your hand.
  MIMIC: (ctx) => ctx.b.copyFoeMoves(ctx.us, 1, ctx.move.name),
  SKETCH: (ctx) => ctx.b.copyFoeMoves(ctx.us, 1, ctx.move.name),
  TRANSFORM: (ctx) => ctx.b.copyFoeMoves(ctx.us, 2, ctx.move.name),
  NATURE_POWER: nothing, METRONOME: nothing, MIRROR_MOVE: nothing, ASSIST: nothing, SLEEP_TALK: nothing,
  COUNTER: nothing, MIRROR_COAT: nothing, BIDE: nothing,
  SPLASH: (ctx) => ctx.b.msg('But nothing happened!'),
};

// Moves that become a different move when used (resolved before scoring).
export function resolveCallMove(b, move, us) {
  if (move.effect === 'METRONOME' || move.effect === 'ASSIST') return b.randomDamagingMove();
  if (move.effect === 'NATURE_POWER') return b.moveData('SWIFT');
  if (move.effect === 'MIRROR_MOVE') return b.lastMoveUsedOn(us) || b.moveData('PECK');
  if (move.effect === 'SLEEP_TALK') return b.randomDamagingMove(60);
  return move;
}
