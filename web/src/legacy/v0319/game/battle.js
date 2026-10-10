// Battle engine: pure logic, no rendering. The battle scene calls actions and animates the event list.
import { D, typeEffect, isSpecialMove, stageMult, accStageMult, gen3Damage, expYield, monStats, speciesName } from './data.js';
import { stats, maxHp, typesOf, monName, isFainted, nextUid, defaultMoves, randomIVs, speciesOf, DECK_RULES, replaceMoves } from './pokemon.js';
import { detectCombo, comboBonus, COMBOS } from './hands.js';
import { EFFECTS, POWER_FN, FIXED_DAMAGE, hitCount, critStageOf, resolveCallMove, hiddenPower, STAT_NAMES, PROTECT_EFFECTS, preRollProtect } from './effects.js';
import { RELICS, BADGES, CONSUMABLES, BALLS, ballRate } from './items.js';
import { BOSS_RULES } from './bosses.js';
import { RNG } from './rng.js';
import { TUNING } from './run.js';
import { STARTERS } from './acts.js';

// A stand-in battle for previews: fixed-damage moves with a random part use their average.
const PREVIEW_B = { rng: { next: () => 0.5 } };
// Hybrid scoring experiment (TUNING.scoring = 'hybrid'): these held items/badges multiply instead of adding.
const HYBRID_X = new Set(['CHOICE_BAND', 'SOUL_DEW', 'DRAGON_SCALE', 'RUBY', 'SAPPHIRE', 'METEORITE', 'OLD_AMBER', 'TRI_PASS', 'RED_FLUTE', 'WHITE_FLUTE', 'ENERGY_ROOT', 'RED_ORB', 'BLUE_ORB', 'MYSTIC_TICKET', 'AURORA_TICKET', 'EON_TICKET', 'EARTH', 'RAIN']);
const STATUS_NAMES = { PSN: 'poisoned', TOX: 'badly poisoned', BRN: 'burned', PAR: 'paralyzed', SLP: 'fell asleep', FRZ: 'frozen solid' };
const CONTACT_PUNISH = { STATIC: 'PAR', FLAME_BODY: 'BRN', POISON_POINT: 'PSN' };

// Semi-invulnerable turn (side.dodge = 'DIVE' | 'DIG' | 'FLY' | 'BOUNCE'): the Gen 3 moves that still reach a
// POKéMON out of reach (2 = for double damage). Every other move aimed at it misses, status moves included.
export const INVULN_HITS = {
  DIVE: { SURF: 2, WHIRLPOOL: 2 },
  DIG: { EARTHQUAKE: 2, MAGNITUDE: 2, FISSURE: 1 },
  FLY: { GUST: 2, TWISTER: 2, THUNDER: 1, SKY_UPPERCUT: 1 },
  BOUNCE: { GUST: 2, TWISTER: 2, THUNDER: 1, SKY_UPPERCUT: 1 },
};
const NOT_AIMED = new Set(['USER', 'OPPONENTS_FIELD']); // self / field moves (buffs, weather, SPIKES, HAZE...)
const SELF_EFFECTS = new Set(['MAGIC_COAT', 'SNATCH']);
// How `move` fares against a side whose dodge state is `dodge`: 0 = misses, 1 = hits, 2 = hits for double damage.
export function invulnHit(dodge, move) {
  if (!dodge || !move) return 1;
  if (NOT_AIMED.has(move.target) || SELF_EFFECTS.has(move.effect)) return 1;
  return INVULN_HITS[dodge]?.[move.key] || 0;
}

export function newSide() {
  return {
    stages: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, acc: 0, eva: 0 },
    reflect: 0, lightScreen: 0, safeguard: 0, mist: 0, focus: 0, lockOn: 0, charge: false, protect: false,
    substitute: false, subHp: 0, ingrain: false, wish: 0, stockpile: 0, confused: 0, seeded: false, trapped: 0,
    yawn: 0, nightmare: false, cursed: false, taunt: 0, disabled: 0, perish: 0, infatuated: 0, spikes: 0,
    endure: false, destinyBond: false, dodge: false, flinch: false, hitThisTurn: false, lastDamage: 0,
    lastMove: null, rage: 0, helpingHand: false, uproar: 0, curled: false, magicCoat: false,
  };
}

// Type effectiveness including the defender's ability (LEVITATE, VOLT/WATER ABSORB, FLASH FIRE,
// WONDER GUARD, THICK FAT). Cards, previews, scoring and enemy attacks all use this.
export function effectiveness(type, defTypes, ability, foresight = false) {
  let eff = typeEffect(type, defTypes);
  if (foresight && defTypes.includes('GHOST') && (type === 'NORMAL' || type === 'FIGHTING')) eff = Math.max(eff, 1);
  if (ability === 'LEVITATE' && type === 'GROUND') eff = 0;
  if ((ability === 'FLASH_FIRE' && type === 'FIRE') || (ability === 'VOLT_ABSORB' && type === 'ELECTRIC') || (ability === 'WATER_ABSORB' && type === 'WATER')) eff = 0;
  if (ability === 'WONDER_GUARD' && eff <= 1) eff = 0;
  if (ability === 'THICK_FAT' && (type === 'FIRE' || type === 'ICE')) eff *= 0.5;
  return eff;
}

export function abilityOf(mon) {
  if (mon.ability) return mon.ability;
  const a = D.species[mon.species]?.abilities || [];
  return a[(mon.ivs?.spe ?? 0) % Math.max(1, a.length)] || null;
}

// Enemy Pokémon used in battles. hpScale is a multiple of the species' real HP at that level.
// A foe whose moveset has no attack (wild ABRA only knows TELEPORT, METAPOD only HARDEN, a Lv30 POOCHYENA only status
// moves...) gets some: its starter deck if it has one (ABRA: the same moves as yours), else the latest attack it
// learned by level-up (it replaces the oldest status move), else TACKLE.
const isAttack = (k) => !!D.moves[k] && (D.moves[k].power > 0 || !!FIXED_DAMAGE[D.moves[k].effect]);
export function withAttacks(speciesKey, level, moves) {
  if (moves.some(isAttack)) return moves;
  const deck = STARTERS.find(st => st.species === speciesKey)?.moves?.filter(m => D.moves[m]);
  if (deck?.length) return deck.slice(0, 4);
  const learned = (D.species[speciesKey]?.learnset || []).filter(([lvl, mv]) => lvl <= level && isAttack(mv)).map(([, mv]) => mv);
  const atk = learned.length ? learned[learned.length - 1] : 'TACKLE';
  return [...moves.filter(m => m !== atk).slice(-3), atk];
}

// Moves whose user faints (SELF-DESTRUCT, EXPLOSION). Foes only use them as a last resort: never a boss, elite or
// legendary (v0.3.11: a REGIROCK used to blow itself up), and anyone else only when nearly beaten (pickEnemyMove).
export const isSelfKO = (k) => D.moves[k]?.effect === 'EXPLOSION';
export const SELF_KO_HP = 1 / 3;
// A tough foe's level-up moveset without its self-KO moves: the next most recent moves it learned take their place.
export const withoutSelfKO = (speciesKey, level, moves) => replaceMoves(speciesKey, level, moves, isSelfKO);

export function makeEnemy(speciesKey, level, opts = {}) {
  const s = D.species[speciesKey];
  const ivs = opts.ivs || randomIVs(opts.rng, 0);
  const st = monStats(speciesKey, level, ivs);
  const maxHp = Math.max(10, Math.round(st.hp * (opts.hpScale || 1)));
  const given = opts.moves && opts.moves.filter(m => m && D.moves[m]).length ? opts.moves.filter(m => m && D.moves[m]) : null;
  const tough = opts.isBoss || opts.isElite || opts.legendary;
  const moves = withAttacks(speciesKey, level, given || (tough ? withoutSelfKO(speciesKey, level, defaultMoves(speciesKey, level)) : defaultMoves(speciesKey, level)));
  return {
    uid: nextUid(), species: speciesKey, level, ivs, stats: st, realMaxHp: st.hp, maxHp, hp: maxHp,
    moves, status: null, sleepTurns: 0, toxic: 0, types: s.types.slice(), isBoss: !!opts.isBoss,
    ability: s.abilities?.[(ivs.spe) % Math.max(1, s.abilities.length)] || null,
    weight: s.weight || 300, shiny: opts.shiny || false, bossRule: opts.bossRule || null, isElite: !!opts.isElite,
  };
}

export class Battle {
  constructor(run, cfg) {
    this.run = run;
    this.cfg = cfg;
    this.comboStart = { ...(run.comboPlays || {}) };
    this.hpStart = run.teamHpFrac ? run.teamHpFrac() : null;
    this.rng = cfg.rng || run.rng.fork('battle' + (run.stats.battles || 0));
    this.kind = cfg.kind || 'wild';
    this.cfgElite = !!cfg.elite;
    this.trainer = cfg.trainer || null;
    this.enemies = cfg.enemies;
    this.enemyIndex = 0;
    this.dmgScale = cfg.dmgScale ?? 1;
    this.terrain = cfg.terrain || 'grass';
    this.events = [];
    this.turn = 0;
    this.handsPlayed = 0;
    this.sides = { player: newSide(), enemy: newSide() };
    this.monState = {};
    this.decks = {}; // uid -> {draw, hand, discard, gone}: every POKéMON brings its own deck
    this.noDeck = { draw: [], hand: [], discard: [], gone: [] };
    this.leadStreak = 0; // hands the current lead has played since it came in
    this.weather = null; this.weatherTurns = 0;
    this.payDay = 0;
    this.result = null;
    this.chains = {};
    this.freeSwitches = 0;
    this.defeated = [];
    this.participants = new Set();
    this.lastCombo = null;
    this.ballsThrown = 0;
    this.fleeAttempts = 0;
    this.focusBandUsed = false;
    this.laxUsed = false;
    this.secondaryBoost = 1;
    this.cardId = 1;
    this.intent = null;
    this.bossRule = null;
    this.mods = run.mods();
    this.discardsLeft = Math.max(0, DECK_RULES.discards + (this.mods.discards || 0) + (cfg.discardMod || 0));
    this.leadUid = (run.party.find(m => !isFainted(m)) || run.party[0]).uid;
  }

  // ---- helpers --------------------------------------------------------------------------
  emit(e) { this.events.push(e); return e; }
  msg(text) { this.emit({ t: 'msg', text }); }
  takeEvents() { const e = this.events; this.events = []; return e; }
  lead() { return this.run.party.find(m => m.uid === this.leadUid); }
  enemy() { return this.enemies[this.enemyIndex]; }
  monName(mon) { return this.isEnemyMon(mon) ? (this.wildLike ? 'Wild ' : 'Foe ') + speciesName(mon.species) : monName(mon); }
  // Wild encounters, including the legendary bird nodes (those are kind 'elite': no balls, no running).
  get wildLike() { return this.kind === 'wild' || !!this.cfg.legendNode; }
  // Can a ball be thrown now? Nuzlocke: only in the act's first wild battle (cfg.nuzFirst).
  canCatch() { return this.kind === 'wild' && !this.cfg.noCatch && (!this.run.nuzlocke || !!this.cfg.nuzFirst); }
  catchBlockReason() {
    if (this.kind !== 'wild') return 'You can only catch wild POKéMON.';
    if (this.run.nuzlocke && !this.cfg.nuzFirst) return 'NUZLOCKE: only the first wild POKéMON of each act can be caught.';
    return null;
  }
  isEnemyMon(mon) { return this.enemies.includes(mon); }
  sideName(side) { return side === 'player' ? monName(this.lead()) : this.monName(this.enemy()); }
  activeMon(side) { return side === 'player' ? this.lead() : this.enemy(); }
  typesOfMon(side, mon) { return side === 'enemy' ? mon.types : typesOf(mon); }
  typesOfSide(side) { return this.typesOfMon(side, this.activeMon(side)); }
  ms(uid) { return (this.monState[uid] ||= { sleep: 0, recharge: 0, toxic: 0, drowsy: false }); }
  maxHpOf(side, mon) { return side === 'enemy' ? mon.maxHp : maxHp(mon); }
  hpFrac(side, mon) { return mon.hp / this.maxHpOf(side, mon); }
  statsOf(side, mon) { return side === 'enemy' ? mon.stats : stats(mon); }
  moveData(key) { const m = D.moves[key]; return m ? { ...m, key } : null; }
  healthyCount(side) { return side === 'player' ? this.run.party.filter(m => !isFainted(m) && !m.status).length : 1; }
  aliveParty() { return this.run.party.filter(m => !isFainted(m)); }
  get handSize() {
    let n = DECK_RULES.hand + (this.mods.handSize || 0);
    if (this.bossRule?.handSize) n += this.bossRule.handSize;
    return Math.max(3, n);
  }
  get maxPlay() { return Math.max(1, Math.min(5, DECK_RULES.play + (this.mods.maxPlay || 0))); }
  // A free discard this turn (DECK_RULES.freeDiscard: once per turn, up to N cards)?
  freeDiscardOk(n) { return !!DECK_RULES.freeDiscard && n <= DECK_RULES.freeDiscard && this.freeDiscardTurn !== this.turn; }
  // Cards drawn by effects arrive with next turn's hand.
  queueDraw(side, n) {
    if (side !== 'player' || this.dry) return;
    this.bonusDraw = (this.bonusDraw || 0) + n;
    this.msg(`You'll draw ${n} extra card${n > 1 ? 's' : ''} next turn.`);
  }

  // MIMIC / SKETCH / TRANSFORM: one-use cards of the foe's moves join your hand (the move it's about to
  // use first, then its others). They vanish once played or when your lead leaves.
  copyFoeMoves(side, n, src) {
    if (side !== 'player' || this.dry) return;
    const e = this.enemy(), lead = this.lead();
    if (!e || !lead) return;
    const intent = this.intent?.move?.key;
    const pool = [...new Set([intent, ...e.moves].filter(k => k && k !== 'RECHARGE' && D.moves[k] && !['MIMIC', 'SKETCH', 'TRANSFORM'].includes(k)))];
    const picks = pool.slice(0, n);
    if (!picks.length) { this.msg('But there was nothing to copy!'); return; }
    // they join next turn's hand on top of the normal refill
    (this.pendingCopies ||= []).push(...picks.map(k => ({ uid: lead.uid, move: k })));
    this.msg(`${src}: copied ${picks.map(k => D.moves[k].name).join(' and ')}! It joins your next hand.`);
  }

  // ACRO BIKE: one extra free 1-card discard per turn (it used to be unlimited)
  acroOk(n) { return !!this.mods.acroBike && n === 1 && this.acroTurn !== this.turn; }

  randomDamagingMove(maxPower = 999) {
    const pool = Object.values(D.moves).filter(m => m.power > 1 && m.power <= maxPower && m.effect !== 'EXPLOSION' && m.effect !== 'OHKO');
    const m = this.rng.pick(pool);
    return { ...m, key: m.key };
  }
  lastMoveUsedOn(side) { const k = this.sides[side === 'player' ? 'enemy' : 'player'].lastMove; return k ? this.moveData(k) : null; }

  relicHooks(name) {
    const out = [];
    for (const r of this.run.relics) { const def = RELICS[r.key]; if (def && def[name]) out.push([def, r]); }
    for (const bk of this.run.badges) { const def = BADGES[bk]; if (def && def[name]) out.push([def, { key: bk, state: {} }]); }
    return out;
  }

  // ---- deck -----------------------------------------------------------------------------
  // The hand always comes from the lead's own deck; switching swaps decks.
  get deck() { return this.decks[this.leadUid] || this.noDeck; }
  pileOf(uid) { return this.decks[uid] || this.noDeck; }

  buildDeck() {
    this.decks = {};
    for (const mon of this.run.party) {
      const cards = [];
      for (const mv of mon.moves) {
        for (let i = 0; i < (mv.copies || 1); i++) cards.push({ id: this.cardId++, uid: mon.uid, move: mv.move });
      }
      this.decks[mon.uid] = { draw: this.rng.shuffle(cards), hand: [], discard: [], gone: [] };
    }
  }

  // Put a POKéMON's hand back into its discard pile (it left the field).
  stowHand(uid) {
    const p = this.decks[uid];
    if (!p || !p.hand.length) return;
    const ids = p.hand.map(c => c.id);
    for (const c of p.hand) { c.faceDown = false; c.frozen = false; }
    p.discard.push(...p.hand.filter(c => !c.temp));
    p.hand = [];
    this.emit({ t: 'discard', ids, stow: true });
  }

  findCardAny(id) {
    for (const p of Object.values(this.decks)) for (const k of ['hand', 'discard', 'draw', 'gone']) { const c = p[k].find(x => x.id === id); if (c) return c; }
    return null;
  }

  drawCards(side, n) {
    if (side !== 'player') return;
    let drawn = 0;
    for (let i = 0; i < n; i++) {
      if (!this.deck.draw.length) {
        if (!this.deck.discard.length) break;
        this.deck.draw = this.rng.shuffle(this.deck.discard);
        this.deck.discard = [];
        this.emit({ t: 'reshuffle' });
      }
      const c = this.deck.draw.pop();
      if (this.bossRule?.faceDown && this.rng.chance(this.bossRule.faceDown) && !this.mods.trueSight) c.faceDown = true;
      this.deck.hand.push(c);
      drawn++;
    }
    if (drawn) this.emit({ t: 'draw', n: drawn });
  }

  drawToHand() {
    const need = this.handSize - this.deck.hand.length;
    if (need > 0) this.drawCards('player', need);
  }

  removeMonCards(uid) { this.stowHand(uid); }

  // Everything the UI needs to draw a card.
  cardInfo(card) {
    const owner = this.run.party.find(m => m.uid === card.uid);
    let move = this.moveData(card.move) || this.moveData('TACKLE');
    let type = move.type;
    if (move.effect === 'HIDDEN_POWER' && owner) type = hiddenPower(owner).type;
    if (move.effect === 'WEATHER_BALL' && this.weather) type = { SUN: 'FIRE', RAIN: 'WATER', SAND: 'ROCK', HAIL: 'ICE' }[this.weather];
    const status = move.power === 0 && !FIXED_DAMAGE[move.effect] && !['COUNTER', 'MIRROR_COAT', 'BIDE', 'SUPER_FANG', 'ENDEAVOR', 'OHKO', 'METRONOME', 'MIRROR_MOVE', 'ASSIST', 'NATURE_POWER', 'SLEEP_TALK', 'PSYWAVE', 'PRESENT', 'MAGNITUDE', 'SPIT_UP', 'FLAIL', 'LOW_KICK', 'RETURN', 'FRUSTRATION', 'HIDDEN_POWER', 'BEAT_UP'].includes(move.effect);
    const physical = !isSpecialMove(move.key, type);
    const st = owner ? stats(owner) : { atk: 10, spa: 10 };
    const ms = owner ? this.ms(owner.uid) : {};
    let playable = true, reason = null;
    if (!owner || isFainted(owner)) { playable = false; reason = 'FAINTED'; }
    else if (owner.status === 'SLP' && !['SNORE', 'SLEEP_TALK'].includes(move.effect)) { playable = false; reason = 'ASLEEP'; }
    else if (owner.status === 'FRZ') { playable = false; reason = 'FROZEN'; }
    else if (ms.recharge > 0) { playable = false; reason = ms.rechargeKind === 'charging' ? 'CHARGING' : 'RECHARGING'; }
    else if (ms.drowsy) { playable = false; reason = 'DROWSY'; }
    else if (card.frozen) { playable = false; reason = 'ICED'; }
    else if (abilityOf(owner) === 'TRUANT' && this.handsPlayed % 2 === 1) { playable = false; reason = 'LOAFING'; }
    const power = move.power || 0;
    const statVal = physical ? st.atk : st.spa;
    // rawPower: move power + attacking stat (a rough "how strong is this card" number for bots)
    const rawPower = status ? 0 : (FIXED_DAMAGE[move.effect] && owner ? FIXED_DAMAGE[move.effect]({ user: owner, b: PREVIEW_B }) * 4 : power + statVal);
    const species = owner?.species;
    const info = {
      card, id: card.id, uid: card.uid, owner, move, type, power, status, physical, playable, reason,
      rawPower, species, isLead: card.uid === this.leadUid,
      canEvolve: owner ? (D.species[owner.species]?.evolutions || []).length > 0 : false,
      stab: owner ? typesOf(owner).includes(type) : false,
      faceDown: !!card.faceDown,
      eff: !status && this.enemy() ? this.effVsEnemy(type) : 1,
      // the foe's ability (not its type) is what stops this card
      blockedBy: !status && this.enemy() && this.effVsEnemy(type) === 0 && typeEffect(type, this.enemy().types) > 0 ? this.enemy().ability : null,
    };
    // Expected damage of this card against the current foe (no crits or misses), shown on the card face.
    info.dmgPreview = status || !owner || !this.enemy() ? 0 : this.cardPreview(info);
    return info;
  }

  // ---- DMG system: per-card damage -------------------------------------------------------
  // Gen 3 damage core for one hit (before STAB, type, items): ((2L/5+2) x power x ATK/DEF)/50 + 2,
  // with both sides' stat stages and the user's attacking abilities. Kept unrounded and without the
  // 85-100% random roll so previews are exact.
  hitCore(owner, enemy, power, physical) {
    const st = stats(owner), ps = this.sides.player, es = this.sides.enemy;
    let atk = physical ? st.atk * stageMult(ps.stages.atk) : st.spa * stageMult(ps.stages.spa);
    const oab = abilityOf(owner);
    if (physical && (oab === 'HUGE_POWER' || oab === 'PURE_POWER')) atk *= 2;
    if (physical && oab === 'HUSTLE') atk *= 1.5;
    if (physical && oab === 'GUTS' && owner.status) atk *= 1.5;
    if (physical && owner.status === 'BRN' && oab !== 'GUTS') atk *= 0.5;
    const def = Math.max(1, (physical ? enemy.stats.def : enemy.stats.spd) * stageMult(physical ? es.stages.def : es.stages.spd));
    return ((Math.floor(2 * owner.level / 5) + 2) * power * atk / def) / 50 + 2;
  }

  // Type effectiveness of a card's type on the foe, including immunity abilities and FORESIGHT.
  cardEff(type, enemy) { return effectiveness(type, enemy.types, enemy.ability, this.sides.enemy.foresight); }

  // Damage of one hit of an attack card (no crit), with every per-card modifier and held-item bonus.
  // Returns { dmg, eff, srcs, label }.
  hitDamage(info, { move = info.move, type = info.type, power = move.power, h = 0, enemy = this.enemy() } = {}) {
    const owner = info.owner, ps = this.sides.player, es = this.sides.enemy;
    const physical = !isSpecialMove(move.key, type);
    const eff = this.cardEff(type, enemy);
    let dmg = this.hitCore(owner, enemy, power, physical), label = null;
    if (move.effect === 'EXPLOSION') dmg *= 2;
    if ((physical && es.reflect) || (!physical && es.lightScreen)) dmg *= 0.5;
    if (info.stab || typesOf(owner).includes(type)) dmg *= 1.5;
    const oab = abilityOf(owner);
    const pinch = { OVERGROW: 'GRASS', BLAZE: 'FIRE', TORRENT: 'WATER', SWARM: 'BUG' }[oab];
    if (pinch === type && owner.hp <= maxHp(owner) / 3) { dmg *= 1.5; label = oab; }
    if (this.weather === 'SUN') { if (type === 'FIRE') dmg *= 1.5; if (type === 'WATER') dmg *= 0.5; }
    if (this.weather === 'RAIN') { if (type === 'WATER') dmg *= 1.5; if (type === 'FIRE' || move.effect === 'SOLAR_BEAM') dmg *= 0.5; }
    if (es.mudSport && type === 'ELECTRIC') dmg *= 0.5;
    if (es.waterSport && type === 'FIRE') dmg *= 0.5;
    if (ps.charge && type === 'ELECTRIC') dmg *= 2;
    dmg *= eff;
    // held items and badges: per-card multipliers (LIGHT BALL), +% bonuses (CHARCOAL) and flat damage
    const card = { ...info, type, physical, eff }, srcs = [];
    for (const [def] of this.relicHooks('cardTimes')) { const f = def.cardTimes(card, this); if (f !== 1) { dmg *= f; srcs.push(def.key); } }
    let pct = 0;
    const IS = TUNING.itemScale ?? 1; // experiment knob: scales every held-item/badge damage bonus
    for (const [def] of this.relicHooks('cardPct')) { const p = (def.cardPct(card, this) || 0) * IS; if (p) { pct += p; srcs.push(def.key); } }
    dmg *= 1 + pct / 100;
    if (h === 0 && eff > 0) for (const [def] of this.relicHooks('cardDmg')) { const n = (def.cardDmg(card, this) || 0) * IS; if (n) { dmg += n; srcs.push(def.key); } }
    return { dmg, eff, srcs, label };
  }

  // Expected damage of a card for previews and combo choice (no crits/misses; random powers averaged).
  cardPreview(info) {
    const owner = info.owner, e = this.enemy(), m = info.move;
    if (FIXED_DAMAGE[m.effect]) return this.cardEff(info.type, e) === 0 ? 0 : FIXED_DAMAGE[m.effect]({ user: owner, b: PREVIEW_B });
    if (['COUNTER', 'MIRROR_COAT', 'BIDE'].includes(m.effect)) return this.sides.player.hitThisTurn ? 2 * (this.sides.player.lastDamage || 0) : 0;
    if (['SUPER_FANG', 'ENDEAVOR', 'OHKO', 'MEMENTO'].includes(m.effect)) return 0;
    let power = m.power;
    if (m.effect === 'MAGNITUDE') power = 71; else if (m.effect === 'PRESENT') power = 70;
    else if (POWER_FN[m.effect]) { try { power = POWER_FN[m.effect]({ user: owner, target: e, b: this, us: 'player', move: m, hitIndex: 0, card: info }) ?? power; } catch (err) { /* keep base power */ } }
    if (!power) return 0;
    const hits = m.effect === 'MULTI_HIT' ? 3 : m.effect === 'DOUBLE_HIT' || m.effect === 'TWINEEDLE' ? 2 : m.effect === 'TRIPLE_KICK' ? 3 : 1;
    let tot = 0;
    for (let h = 0; h < hits; h++) tot += this.hitDamage(info, { power: m.effect === 'TRIPLE_KICK' ? power * (h + 1) : power, h }).dmg;
    return Math.round(tot);
  }

  // ---- lifecycle ------------------------------------------------------------------------
  start() {
    this.bossRule = this.enemy().bossRule ? BOSS_RULES[this.enemy().bossRule] : null;
    this.buildDeck();
    if (this.trainer) this.emit({ t: 'msg', text: `${this.trainer.title} wants to battle!` });
    this.sendOutEnemy(true);
    this.emit({ t: 'leadOut', uid: this.leadUid });
    this.msg(`Go! ${monName(this.lead())}!`);
    this.participants.add(this.leadUid);
    this.startLead = `${this.lead().species}:${this.lead().level}`;
    this.onLeadEnter();
    for (const [def, inst] of this.relicHooks('onBattleStart')) def.onBattleStart(this, inst.state);
    if (this.bossRule?.onBattleStart) this.bossRule.onBattleStart(this);
    this.startTurn();
    return this.takeEvents();
  }

  sendOutEnemy(first) {
    const e = this.enemy();
    this.sides.enemy = { ...newSide(), spikes: this.sides.enemy.spikes };
    if (!first) this.bossRule = e.bossRule ? BOSS_RULES[e.bossRule] : this.bossRule;
    this.emit({ t: 'enemyOut', index: this.enemyIndex, species: e.species });
    if (this.wildLike) this.msg(`A wild ${speciesName(e.species)} appeared!`);
    else this.msg(`${this.trainer?.name || 'Foe'} sent out ${speciesName(e.species)}!`);
    if (e.bossRule && BOSS_RULES[e.bossRule]) this.emit({ t: 'bossRule', rule: e.bossRule, name: BOSS_RULES[e.bossRule].name, desc: BOSS_RULES[e.bossRule].desc });
    if (this.sides.enemy.spikes) {
      const d = Math.floor(e.maxHp * this.sides.enemy.spikes / 8);
      this.damageEnemy(d, 'SPIKES');
      this.msg(`${this.monName(e)} is hurt by spikes!`);
    }
    const ab = e.ability;
    if (ab === 'INTIMIDATE') { this.msg(`${this.monName(e)}'s INTIMIDATE cuts your ATTACK!`); this.addStage('player', 'atk', -1, 'INTIMIDATE', true); }
    if (ab === 'DRIZZLE') this.setWeather('RAIN', true);
    if (ab === 'DROUGHT') this.setWeather('SUN', true);
    if (ab === 'SAND_STREAM') this.setWeather('SAND', true);
  }

  onLeadEnter() {
    const lead = this.lead();
    const ab = abilityOf(lead);
    if (ab === 'INTIMIDATE') { this.msg(`${monName(lead)}'s INTIMIDATE cuts the foe's ATTACK!`); this.addStage('enemy', 'atk', -1, 'INTIMIDATE', true); }
    if (ab === 'DRIZZLE') this.setWeather('RAIN', true);
    if (ab === 'DROUGHT') this.setWeather('SUN', true);
    if (ab === 'SAND_STREAM') this.setWeather('SAND', true);
    if (this.bossRule?.onLeadEnter) this.bossRule.onLeadEnter(this, lead);
  }

  startTurn() {
    if (this.result) return;
    this.turn++;
    const ps = this.sides.player, es = this.sides.enemy;
    ps.protect = es.protect = false; ps.endure = es.endure = false; ps.dodge = es.dodge = false;
    ps.flinch = es.flinch = false; ps.hitThisTurn = es.hitThisTurn = false; ps.destinyBond = es.destinyBond = false;
    for (const c of this.deck.hand) c.frozen = false;
    for (const m of this.run.party) this.ms(m.uid).drowsy = false;
    if (this.mods.pokeFlute) for (const m of this.run.party) if (m.status === 'SLP') { m.status = null; this.ms(m.uid).sleep = 0; }
    this.refillHand();
    if (this.bossRule?.onTurnStart) this.bossRule.onTurnStart(this);
    this.chooseIntent();
    this.emit({ t: 'turn', turn: this.turn });
  }

  // Start-of-turn draw: refill the hand, extra draws and copied cards queued last turn, and a free redraw
  // when nothing can be played (co-op duo battles call this for each player too).
  refillHand() {
    if (DECK_RULES.refill && this.turn > 1) this.drawCards('player', Math.min(DECK_RULES.refill, this.handSize - this.deck.hand.length));
    else this.drawToHand();
    if (this.bonusDraw) { this.drawCards('player', this.bonusDraw); this.bonusDraw = 0; }
    if (this.pendingCopies?.length) {
      const lead = this.lead();
      for (const c of this.pendingCopies) if (lead && c.uid === lead.uid) this.deck.hand.push({ id: this.cardId++, uid: c.uid, move: c.move, temp: true });
      this.pendingCopies = [];
      this.emit({ t: 'draw', n: 1 });
    }
    // Free redraw when nothing in hand can be played (asleep/recharging owners etc.).
    if (this.deck.hand.length && this.deck.hand.every(c => this.cardInfo(c).reason === 'ICED') && this.deck.draw.length + this.deck.discard.length > 0) {
      const dead = this.deck.hand.slice();
      this.deck.hand = []; this.deck.discard.push(...dead);
      this.emit({ t: 'discard', ids: dead.map(c => c.id), forced: true });
      this.msg('No playable cards! You draw a fresh hand.');
      this.drawToHand();
    }
  }

  // ---- enemy intent ---------------------------------------------------------------------
  chooseIntent() {
    this.quickClawProc = !!this.mods.quickClaw && this.rng.chance(0.2);
    const e = this.enemy();
    const lead = this.lead();
    if (!e || !lead) return;
    const move = this.pickEnemyMove(e, lead);
    this.intent = { move, first: this.enemyActsFirst(null, move) };
    this.updateIntentPreview();
  }

  // The foe's move for this turn against the given lead (weighted by damage / status value).
  pickEnemyMove(e, lead) {
    const options = e.moves.map(k => this.moveData(k)).filter(Boolean);
    const weights = options.map(m => {
      if (this.sides.enemy.taunt && m.power === 0) return 0;
      if (m.power > 0 || FIXED_DAMAGE[m.effect]) {
        const eff = typeEffect(m.type, typesOf(lead));
        const stab = e.types.includes(m.type) ? 1.5 : 1;
        let w = Math.max(1, (m.power || 40)) * eff * stab;
        if (m.effect === 'EXPLOSION') w *= 0.3;
        if (m.effect === 'RECHARGE' || m.effect === 'SOLAR_BEAM') w *= 0.6;
        if (e.isBoss) w = w * w / 60;
        return w;
      }
      return this.statusMoveValue(m, e, lead);
    });
    // self-KO moves (SELF-DESTRUCT, EXPLOSION): never for a boss / elite / legendary; others only as a last resort
    // when nearly beaten (v0.3.11)
    const barred = (m) => isSelfKO(m.key) && (e.isBoss || e.isElite || e.legendary || e.hp > e.maxHp * SELF_KO_HP);
    const usable = options.map((m, i) => i).filter(i => !barred(options[i]));
    let move = usable.length ? this.rng.weighted(usable, i => weights[i] + 0.0001) : -1;
    move = options[move] || this.moveData('STRUGGLE') || this.moveData('TACKLE');
    if (this.ms(e.uid).recharge > 0) move = { ...this.moveData('TACKLE'), key: 'RECHARGE', name: 'RECHARGE', power: 0, effect: 'RECHARGE_TURN' };
    return move;
  }

  statusMoveValue(m, e, lead) {
    const es = this.sides.enemy, ps = this.sides.player;
    const eff = m.effect;
    if (['SLEEP', 'PARALYZE', 'POISON', 'TOXIC', 'WILL_O_WISP', 'YAWN'].includes(eff)) return lead.status ? 0 : 35;
    if (eff === 'CONFUSE' || eff === 'SWAGGER' || eff === 'FLATTER' || eff === 'TEETER_DANCE') return ps.confused ? 0 : 20;
    if (eff.endsWith('_DOWN') || eff.endsWith('_DOWN_2') || eff === 'TICKLE') { const st = eff.startsWith('ATTACK') ? 'atk' : eff.startsWith('DEFENSE') ? 'def' : eff.startsWith('SPEED') ? 'spe' : eff.startsWith('ACCURACY') ? 'acc' : 'spd'; return ps.stages[st] <= -2 ? 2 : 22; }
    if (eff.includes('_UP') || ['CALM_MIND', 'BULK_UP', 'DRAGON_DANCE', 'COSMIC_POWER', 'DEFENSE_CURL', 'MINIMIZE', 'GROWTH', 'CURSE'].includes(eff)) return es.stages.atk >= 2 || es.stages.def >= 2 ? 3 : 18;
    if (['RESTORE_HP', 'SOFTBOILED', 'MORNING_SUN', 'SYNTHESIS', 'MOONLIGHT', 'REST', 'SWALLOW', 'WISH'].includes(eff)) return e.hp < e.maxHp * 0.5 ? 60 : 0;
    if (eff === 'PROTECT' || eff === 'DETECT') return this.turn % 3 === 0 ? 15 : 0;
    if (eff === 'LEECH_SEED') return ps.seeded || typesOf(lead).includes('GRASS') ? 0 : 30;
    if (eff === 'REFLECT') return es.reflect ? 0 : 15;
    if (eff === 'LIGHT_SCREEN') return es.lightScreen ? 0 : 15;
    if (eff === 'SPLASH') return 1;
    if (eff === 'ROAR' || eff === 'TELEPORT') return 0;
    if (['SUNNY_DAY', 'RAIN_DANCE', 'SANDSTORM', 'HAIL'].includes(eff)) return this.weather ? 0 : 10;
    return 6;
  }

  speedOf(side) {
    const mon = this.activeMon(side);
    if (!mon) return 0;
    let s = this.statsOf(side, mon).spe * stageMult(this.sides[side].stages.spe);
    if (mon.status === 'PAR') s *= 0.25;
    if (side === 'player' && this.mods.speedMult) s *= 1 + this.mods.speedMult;
    const ab = side === 'enemy' ? mon.ability : abilityOf(mon);
    if ((ab === 'SWIFT_SWIM' && this.weather === 'RAIN') || (ab === 'CHLOROPHYLL' && this.weather === 'SUN')) s *= 2;
    return s;
  }

  // protectOk: the hand's PROTECT / DETECT / ENDURE roll (preRollProtect); a failed one lends the hand no priority
  enemyActsFirst(playerCards, enemyMove, protectOk = true) {
    const pPrio = playerCards ? Math.max(0, ...playerCards.map(c => (PROTECT_EFFECTS.has(c.move.effect) && protectOk === false ? 0 : c.move.priority || 0))) : 0;
    const ePrio = enemyMove?.priority || 0;
    if (pPrio !== ePrio) return ePrio > pPrio;
    if (this.mods.quickClaw && (this.handsPlayed === 0 || this.quickClawProc)) return false;
    return this.speedOf('enemy') > this.speedOf('player');
  }

  updateIntentPreview() {
    if (!this.intent) return;
    const { move } = this.intent;
    const lead = this.lead();
    const e = this.enemy();
    this.intent.first = this.enemyActsFirst(null, move);
    if (!lead || !e) return;
    if (move.power > 0 || FIXED_DAMAGE[move.effect]) {
      const lo = this.enemyDamage(move, e, lead, 0.85, false, true);
      const hi = this.enemyDamage(move, e, lead, 1, false, true);
      const hits = move.effect === 'MULTI_HIT' ? '2-5x ' : move.effect === 'DOUBLE_HIT' || move.effect === 'TWINEEDLE' ? '2x ' : '';
      this.intent.damage = [lo, hi];
      this.intent.text = `${hits}${lo}-${hi}`;
      const nHits = move.effect === 'MULTI_HIT' ? 5 : move.effect === 'DOUBLE_HIT' || move.effect === 'TWINEEDLE' ? 2 : 1;
      this.intent.lethal = hi * nHits >= lead.hp;
      // Type matchup against the current lead (0 when an ability like LEVITATE blocks it).
      this.intent.eff = FIXED_DAMAGE[move.effect] ? 1 : hi === 0 ? 0 : typeEffect(move.type, typesOf(lead));
      this.intent.kind = 'attack';
    } else {
      this.intent.damage = null;
      this.intent.eff = 1;
      this.intent.kind = move.effect === 'RECHARGE_TURN' ? 'recharge' : (move.target === 'USER' || /_UP|HEAL|RESTORE|PROTECT|REFLECT|SCREEN|REST|WISH|SYNTH|MOON|MORNING|SOFT|CALM|BULK|DANCE|COSMIC|CURL|MINIMIZE|GROWTH|SUBSTITUTE|STOCKPILE|INGRAIN|FOCUS/.test(move.effect) ? 'buff' : 'debuff');
      this.intent.text = move.effect === 'RECHARGE_TURN' ? 'must recharge' : this.intent.kind === 'buff' ? 'buffs itself' : 'status move';
    }
  }

  // Gen 3 damage from an enemy move onto one of the player's Pokémon.
  enemyDamage(move, e, target, rand = 1, crit = false, preview = false) {
    if (FIXED_DAMAGE[move.effect]) {
      const raw = move.effect === 'LEVEL_DAMAGE' ? e.level : move.effect === 'DRAGON_RAGE' ? 40 : move.effect === 'SONICBOOM' ? 20 : Math.floor(e.level * (preview ? 1 : (0.5 + this.rng.next())));
      return Math.round(raw * this.dmgScale);
    }
    const tTypes = typesOf(target);
    const eff = effectiveness(move.type, tTypes, abilityOf(target), this.sides.player.foresight);
    if (eff === 0) return 0;
    const physical = !isSpecialMove(move.key, move.type);
    const es = this.sides.enemy, ps = this.sides.player;
    const tst = stats(target);
    let atk = (physical ? e.stats.atk : e.stats.spa) * stageMult(physical ? es.stages.atk : es.stages.spa);
    let def = (physical ? tst.def : tst.spd) * stageMult(physical ? ps.stages.def : ps.stages.spd);
    if (crit) { atk = Math.max(atk, physical ? e.stats.atk : e.stats.spa); def = Math.min(def, physical ? tst.def : tst.spd); }
    let power = move.power;
    if (POWER_FN[move.effect]) power = POWER_FN[move.effect]({ user: e, target, b: this, us: 'enemy', move, hitIndex: 0, card: null }) || power;
    if (e.ability === 'HUGE_POWER' || e.ability === 'PURE_POWER') { if (physical) atk *= 2; }
    if (e.ability === 'HUSTLE' && physical) atk *= 1.5;
    if (['OVERGROW', 'BLAZE', 'TORRENT', 'SWARM'].includes(e.ability) && e.hp <= e.maxHp / 3 && move.type === { OVERGROW: 'GRASS', BLAZE: 'FIRE', TORRENT: 'WATER', SWARM: 'BUG' }[e.ability]) power *= 1.5;
    let dmg = gen3Damage({ level: e.level, power, atk, def, stab: e.types.includes(move.type), effect: eff, burned: e.status === 'BRN', physical, rand, crit });
    if (this.weather === 'SUN') { if (move.type === 'FIRE') dmg *= 1.5; if (move.type === 'WATER') dmg *= 0.5; }
    if (this.weather === 'RAIN') { if (move.type === 'WATER') dmg *= 1.5; if (move.type === 'FIRE') dmg *= 0.5; }
    if (!crit && ((physical && ps.reflect) || (!physical && ps.lightScreen))) dmg *= 0.5;
    if (ps.mudSport && move.type === 'ELECTRIC') dmg *= 0.5;
    if (ps.waterSport && move.type === 'FIRE') dmg *= 0.5;
    let mult = this.dmgScale * (1 + (this.mods.dmgTaken || 0));
    if (!physical && this.mods.spDmgTaken) mult *= 1 + this.mods.spDmgTaken;
    if (target.species === 'DITTO' && this.run.hasRelic('METAL_POWDER')) mult *= 0.6;
    if (this.bossRule?.enemyDamageMult) mult *= this.bossRule.enemyDamageMult;
    if (e.isBoss && this.turn >= 6) mult *= Math.min(2, 1 + 0.15 * (this.turn - 5)); // bosses enrage in long fights
    return Math.max(1, Math.round(dmg * mult));
  }

  // ---- player actions -------------------------------------------------------------------
  findCards(ids) { return ids.map(id => this.deck.hand.find(c => c.id === id)).filter(Boolean); }

  canPlay(ids) {
    const cards = this.findCards(ids);
    if (!cards.length) return { ok: false, reason: 'Select cards to play.' };
    if (cards.length > this.maxPlay) return { ok: false, reason: `You can play at most ${this.maxPlay} cards.` };
    const infos = cards.map(c => this.cardInfo(c));
    const bad = infos.find(i => !i.playable);
    if (bad) return { ok: false, reason: `${monName(bad.owner) || 'That POKéMON'} can't move (${bad.reason}).` };
    if (this.bossRule?.canPlay) { const r = this.bossRule.canPlay(this, infos); if (r) return { ok: false, reason: r }; }
    return { ok: true };
  }

  preview(ids) {
    const cards = this.findCards(ids);
    if (!cards.length) return null;
    const infos = cards.map(c => this.cardInfo(c));
    const combo = detectCombo(infos.map(i => ({ move: i.move.key, type: i.type, owner: i.uid, status: i.status, value: this.cardValue(i) })), { coverageN: this.mods.coverage4 ? 3 : 4, levels: this.run.comboLevels });
    const level = this.run.comboLevels[combo.key] || 1;
    return { key: combo.key, name: COMBOS[combo.key].name, level, bonus: comboBonus(combo.key, level), scoring: combo.scoring.map(i => infos[i].id) };
  }

  // Expected damage of a card against the current foe (used to pick the best combo in a selection).
  cardValue(info) {
    if (info.status) return 0;
    return info.dmgPreview ?? 0;
  }

  effVsEnemy(type) { const e = this.enemy(); return e ? effectiveness(type, e.types, e.ability, this.sides.enemy.foresight) : 1; }

  // Everything besides the selection that can change a hand's preview during a turn (an X item, a switch, a
  // discard, a partner's heal...). The scenes cache simulate() on it; it used to be only the turn and the foe's HP,
  // so an X ATTACK used mid-turn left a stale (lower) number on screen.
  previewKey() {
    const ps = this.sides.player, es = this.sides.enemy, l = this.lead(), e = this.enemy();
    return [this.turn, this.handsPlayed, this.leadUid, l?.hp, l?.status, this.enemyIndex, e?.uid, e?.hp, e?.status, JSON.stringify(ps.stages), JSON.stringify(es.stages),
      ps.focus, ps.charge, ps.helpingHand, ps.confused, es.reflect, es.lightScreen, es.substitute, this.weather, this.discardsLeft, this.deck.hand.length, this.leadStreak,
      this.run.relics.length, this.run.badges.length].join('|');
  }

  // Exact preview: runs the real scoring with no crits/misses/paralysis and restores all state.
  simulate(ids) {
    const cards = this.findCards(ids);
    if (!cards.length) return null;
    const infos = cards.map(c => this.cardInfo(c));
    const e = this.enemy();
    const snap = JSON.stringify({ sides: this.sides, ms: this.monState, en: this.enemies.map(x => [x.hp, x.status, x.sleepTurns, x.toxic]), party: this.run.party.map(m => [m.hp, m.status]), relics: this.run.relics.map(r => r.state), payDay: this.payDay, chains: this.chains, weather: this.weather, wt: this.weatherTurns, stats: this.run.stats, cp: this.run.comboPlays, fs: this.freeSwitches, dl: this.discardsLeft });
    const intentSnap = this.intent ? JSON.stringify(this.intent) : null, batonSnap = this.batonPass;
    const rng = this.rng, evLen = this.events.length, piles = Object.entries(this.decks).map(([k, p]) => [k, { draw: p.draw.slice(), hand: p.hand.slice(), discard: p.discard.slice(), gone: p.gone.slice() }]), streak = this.leadStreak, fsw = this.faintSwitch, fc = this.faintCount, lead = this.leadUid, result = this.result, parts = new Set(this.participants), msLen = this.run.party.map(m => m.moves.map(x => x.copies));
    this.dry = true;
    this.rng = new RNG('dry');
    let S;
    try { S = this.scoreHand(infos, e, this.sides.player.confused > 0 && false); } catch (err) { S = null; }
    const o = JSON.parse(snap);
    this.dry = false; this.rng = rng; this.events.length = evLen; for (const [k, p] of piles) Object.assign(this.decks[k], p); this.leadStreak = streak; this.faintSwitch = fsw; this.faintCount = fc; this.leadUid = lead; this.result = result; this.participants = parts; this.intent = intentSnap ? JSON.parse(intentSnap) : null; this.batonPass = batonSnap;
    for (const side of ['player', 'enemy']) { this.sides[side] = o.sides[side]; }
    this.monState = o.ms; this.enemies.forEach((x, i) => { [x.hp, x.status, x.sleepTurns, x.toxic] = o.en[i]; });
    this.run.party.forEach((m, i) => { [m.hp, m.status] = o.party[i]; });
    this.run.relics.forEach((r, i) => { r.state = o.relics[i]; });
    this.payDay = o.payDay; this.chains = o.chains; this.weather = o.weather; this.weatherTurns = o.wt; this.run.stats = o.stats; this.run.comboPlays = o.cp; this.freeSwitches = o.fs; this.discardsLeft = o.dl;
    if (!S) return null;
    let dmg = S.damage + S.fixed;
    if (S.ohko) dmg = e.hp;
    if (this.sides.player.confused > 0) dmg = Math.floor(dmg * 0.75); // expected: 50% chance of x0.5
    return { key: S.combo, base: Math.round(S.cardTotal + S.flatTotal), bonus: Math.round(S.pctTotal), times: +S.timesTotal.toFixed(2), damage: dmg };
  }

  // Quick damage estimate (card previews x combo bonus; ignores hand-wide item bonuses, crits and accuracy).
  estimate(ids) {
    const p = this.preview(ids);
    if (!p || p.key === 'SUPPORT') return 0;
    let tot = 0;
    for (const id of p.scoring) {
      const info = this.cardInfo(this.deck.hand.find(c => c.id === id));
      if (!info.status) tot += info.dmgPreview;
    }
    return Math.round(tot * (1 + p.bonus / 100));
  }

  discard(ids) {
    if (this.result) return [];
    const cards = this.findCards(ids);
    if (!cards.length || cards.length > 5) return [];
    const acro = this.acroOk(cards.length); // spend the bike first so the turn's FREE DISCARD stays available
    const turnFree = !acro && this.freeDiscardOk(cards.length);
    if (!acro && !turnFree && this.discardsLeft <= 0) return [];
    if (acro) this.acroTurn = this.turn;
    else if (turnFree) this.freeDiscardTurn = this.turn;
    else this.discardsLeft--;
    if (!this.dry) { this.discardCount = (this.discardCount || 0) + 1; this.discardedCards = (this.discardedCards || 0) + cards.length; (this.discardTurns ||= new Set()).add(this.turn); }
    if (this.bossRule?.key === 'WATTSON') { const l = this.lead(); if (l) { this.recoil('player', l, 0.05, 'MAGNET PULL', true); this.msg('MAGNET PULL zaps your lead!'); } }
    this.deck.hand = this.deck.hand.filter(c => !cards.includes(c));
    for (const c of cards) { c.faceDown = false; this.deck.discard.push(c); }
    this.emit({ t: 'discard', ids: cards.map(c => c.id) });
    this.drawToHand();
    if (DECK_RULES.discardDraw) this.drawCards('player', DECK_RULES.discardDraw);
    return this.takeEvents();
  }

  switchLead(uid, forced = false) {
    const mon = this.run.party.find(m => m.uid === uid);
    if (!mon || isFainted(mon) || uid === this.leadUid) return [];
    if (!forced) {
      if (this.faintSwitch) this.faintSwitch = false;
      else if (this.freeSwitches > 0) this.freeSwitches--;
      else if (this.discardsLeft > 0) this.discardsLeft--;
      else return [];
      const old = this.lead();
      if (abilityOf(old) === 'NATURAL_CURE' && old.status) { old.status = null; }
    }
    // Volatile effects belong to the Pokémon that leaves (also when it fainted).
    const s = this.sides.player;
    const keepVol = this.batonPass && !forced; if (!forced) this.batonPass = false;
    if (!keepVol) { s.confused = 0; s.seeded = false; s.trapped = 0; s.substitute = false; s.subHp = 0; s.cursed = false; s.perish = 0; s.yawn = 0; s.nightmare = false; s.infatuated = 0; }
    this.stowHand(this.leadUid);
    this.leadUid = uid;
    this.leadStreak = 0;
    if (!this.dry && !forced) this.switchCount = (this.switchCount || 0) + 1;
    this.participants.add(uid);
    this.emit({ t: 'leadOut', uid });
    this.msg(`Go! ${monName(mon)}!`);
    this.onLeadEnter();
    if (!this.result) this.drawToHand();
    this.updateIntentPreview();
    // A forced switch (the lead fainted) happens in the middle of a turn: leave its events queued with
    // the rest of the turn's (taking them here used to drop the enemy's attack and the faint animation).
    return forced ? [] : this.takeEvents();
  }

  useItem(key, targetUid) {
    const def = CONSUMABLES[key];
    if (!def || !this.run.hasConsumable(key)) return [];
    const mon = targetUid ? this.run.party.find(m => m.uid === targetUid) : null;
    if (def.flee) {
      if (this.kind === 'boss' || (this.kind !== 'wild' && !def.anyNonBoss)) { this.msg("Can't escape from this battle!"); return this.takeEvents(); }
      this.run.useConsumable(key);
      this.msg('Got away safely!');
      this.end('fled');
      return this.takeEvents();
    }
    if (def.stage) { this.addStage('player', def.stage[0], def.stage[1], key); }
    else if (def.focus) { this.sides.player.focus = 2; this.msg('Your team is getting pumped!'); }
    else if (def.mist) { this.sides.player.mist = 5; this.msg('Your team became shrouded in MIST!'); }
    else {
      const wasFainted = this.run.party.filter(m => isFainted(m)).map(m => m.uid);
      if (!this.run.applyConsumableToMon(key, mon, this)) return [];
      for (const uid of wasFainted) {
        const m = this.run.party.find(x => x.uid === uid);
        if (m && !isFainted(m)) {
          this.ms(uid).faintHandled = false;
          this.msg(`${monName(m)} was revived!`);
        }
      }
    }
    this.run.useConsumable(key);
    this.emit({ t: 'item', key, uid: targetUid });
    this.emit({ t: 'partyUpdate' });
    this.updateIntentPreview();
    return this.takeEvents();
  }

  // ---- playing a hand -------------------------------------------------------------------
  play(ids) {
    if (this.result) return [];
    const chk = this.canPlay(ids);
    if (!chk.ok) return [];
    this.enemyJustSwitched = false; // a foe sent out at the end of last turn still acts this turn
    this.faintSwitch = false;
    const cards = this.findCards(ids);
    // DECK_RULES.kickersStay: attack cards that don't score go back to your hand after the hand resolves.
    let kickers = new Set();
    if (DECK_RULES.kickersStay) { const p = this.preview(ids); if (p && p.key !== 'SUPPORT') { const sc = new Set(p.scoring); kickers = new Set(cards.filter(c => !sc.has(c.id) && !this.cardInfo(c).status)); } }
    this.deck.hand = this.deck.hand.filter(c => !cards.includes(c));
    const infos = cards.map(c => { c.faceDown = false; return this.cardInfo(c); });
    this.emit({ t: 'play', ids: cards.map(c => c.id) });

    const enemyFirst = this.enemyActsFirst(infos, this.intent?.move, preRollProtect(this, infos));
    if (enemyFirst) {
      this.emit({ t: 'foeFirst' });
      this.enemyAct();
      if (this.result) { this.lateRest(infos); return this.takeEvents(); }
    }
    // If the lead fainted to a faster enemy, cards from it fizzle; others still go.
    this.resolveHand(infos);
    // Played cards go back to their owner's discard pile (even if it was knocked out meanwhile).
    for (const c of cards) {
      if (kickers.has(c) && c.uid === this.leadUid) this.deck.hand.push(c);
      else if (!c.temp) this.pileOf(c.uid).discard.push(c); // copied (temporary) cards are used up
    }
    if (cards.some(c => c.uid === this.leadUid)) this.leadStreak++;
    if (!this.result && !enemyFirst && !this.enemyJustSwitched) this.enemyAct();
    this.enemyJustSwitched = false;
    if (!this.result) this.endTurn();
    if (!this.result) this.startTurn();
    return this.takeEvents();
  }

  // Nothing in hand can legally be played (asleep, frozen, recharging, boss rules...): give up the hand
  // so the turn still advances instead of soft-locking.
  pass() {
    if (this.result) return [];
    this.enemyJustSwitched = false;
    this.handsPlayed++;
    this.msg(`${monName(this.lead())} can't move!`);
    this.enemyAct();
    if (!this.result) this.endTurn();
    if (!this.result) this.startTurn();
    return this.takeEvents();
  }

  // REST cards of a hand that never got to resolve because the battle ended first (a faster partner or the foe's
  // own move finished it): the user still recovers fully and is cured. No sleep: the battle is over.
  lateRest(infos) {
    for (const i of infos) {
      const mon = i.owner;
      if (i.move?.effect !== 'REST' || !mon || isFainted(mon)) continue;
      this.healSide('player', mon, 1, 'REST');
      if (mon.status) { mon.status = null; this.emit({ t: 'status', side: 'player', uid: mon.uid, status: null }); }
      const st = this.ms(mon.uid); st.sleep = 0; st.toxic = 0;
    }
  }

  resolveHand(infos) {
    const live = infos.filter(i => i.owner && !isFainted(i.owner));
    if (!live.length) { this.msg(`${monName(infos[0]?.owner) || 'Your POKéMON'} fainted before it could attack, so its hand was lost!`); return; }
    const e = this.enemy();
    // Confusion: 50% chance the lead hurts itself and the hand deals half damage.
    let confusedPenalty = false;
    const ps = this.sides.player;
    if (ps.confused > 0) {
      ps.confused--;
      if (ps.confused === 0) this.msg(`${monName(this.lead())} snapped out of confusion!`);
      else if (this.rng.chance(0.5)) {
        confusedPenalty = true;
        const lead = this.lead();
        const d = Math.max(1, Math.floor(maxHp(lead) / 8));
        this.msg(`${monName(lead)} is confused! It hurt itself in its confusion!`);
        this.damagePlayer(lead, d);
        this.checkLeadFaint();
        if (this.result) return;
      }
    }
    if (ps.infatuated > 0) {
      ps.infatuated--;
      if (this.rng.chance(0.5)) { this.msg(`${monName(this.lead())} is immobilized by love!`); confusedPenalty = true; }
    }
    const score = this.scoreHand(live, e, confusedPenalty);
    this.handsPlayed++;
    this.lastCombo = score.combo;
    this.run.stats.bestHand = Math.max(this.run.stats.bestHand || 0, score.damage);
    this.run.comboPlays[score.combo] = (this.run.comboPlays[score.combo] || 0) + 1;
    if (this.result) return;
    if (score.damage > 0 || score.fixed > 0) {
      if (this.sides.enemy.protect) {
        this.msg(`${this.monName(e)} protected itself!`);
      } else {
        let dmg = score.damage + score.fixed;
        if (score.ohko) dmg = e.hp;
        if (score.falseSwipe) dmg = Math.min(dmg, e.hp - 1);
        if (this.sides.enemy.substitute) {
          const absorbed = Math.min(dmg, this.sides.enemy.subHp);
          this.sides.enemy.subHp -= absorbed; dmg -= absorbed;
          this.msg('The SUBSTITUTE took damage for it!');
          if (this.sides.enemy.subHp <= 0) { this.sides.enemy.substitute = false; this.msg("The foe's SUBSTITUTE faded!"); }
        }
        if (dmg > 0) this.damageEnemy(dmg, 'hand', score.effLabel);
      }
    }
    // Post-hand self effects (explosion faint etc.) after damage.
    for (const f of score.after) f();
    if (this.bossRule?.afterHand) this.bossRule.afterHand(this, score);
    this.checkEnemyFaint(true);
  }

  // DMG system: every scoring card deals real (Gen 3 style) damage; the combo adds a % bonus.
  // Hand damage = (sum of card damage + flat bonuses) x (1 + combo % + item %) x special factors.
  scoreHand(infos, enemy, confusedPenalty) {
    const combo = detectCombo(infos.map(i => ({ move: i.move.key, type: i.type, owner: i.uid, status: i.status, value: this.cardValue(i) })), { coverageN: this.mods.coverage4 ? 3 : 4, levels: this.run.comboLevels });
    const level = this.run.comboLevels[combo.key] || 1;
    const bonus = comboBonus(combo.key, level);
    const scoring = combo.scoring.map(i => infos[i]);
    const ps = this.sides.player, es = this.sides.enemy;
    // The lead's deck for the deck-counting items (UP-GRADE, SOOT SACK, HELIX FOSSIL...). A played hand is out of
    // every pile while it resolves: count its cards too, so the real hand sees the same deck as the preview
    // (which runs with the selected cards still in hand). v0.3.7: they used to be missing, so the hand dealt less.
    const piles = new Set([...this.deck.draw, ...this.deck.hand, ...this.deck.discard]);
    const inFlight = infos.filter(i => i.card && i.card.uid === this.leadUid && !piles.has(i.card));
    const S = {
      cardTotal: 0, flatTotal: 0, pctTotal: bonus, timesTotal: 1, fixed: 0, ohko: false, falseSwipe: false, after: [],
      battle: this, run: this.run, rng: this.rng, combo: combo.key, comboKey: combo.key, comboRank: COMBOS[combo.key].rank,
      cards: infos, scoring, deckSize: this.deckSize() + inFlight.length, deckCards: [...this.allDeckInfos(), ...inFlight], effLabel: null, attackHits: 0,
      typesOf: m => typesOf(m),
      // hooks for held items, badges and boss rules
      flat: (n, src) => { n *= TUNING.itemScale ?? 1; S.flatTotal += n; this.emit({ t: 'flat', add: Math.round(n), src }); },
      pct: (n, src) => {
        n *= TUNING.itemScale ?? 1;
        if (TUNING.scoring === 'hybrid' && HYBRID_X.has(src)) return S.times(1 + n / 100, src);
        S.pctTotal += n; this.emit({ t: 'bonus', add: n, src, total: S.pctTotal });
      },
      times: (f, src) => { S.timesTotal *= f; this.emit({ t: 'times', mul: f, src }); },
      flinch: (src) => { if (!es.flinch) { es.flinch = true; this.emit({ t: 'relic', key: src, text: 'Flinch!' }); } },
      healOwner: (c, frac) => this.healSide('player', c.owner, frac, null, true),
    };
    this.emit({ t: 'combo', key: combo.key, name: COMBOS[combo.key].name, level, bonus, scoring: scoring.map(s => s.id), all: infos.map(i => i.id) });
    let bestEff = null;

    for (const info of infos) {
      const owner = info.owner;
      if (!info.status && !scoring.includes(info)) { this.emit({ t: 'card', id: info.id, dmg: 0, label: null, idle: true }); continue; }
      if (isFainted(owner)) { this.emit({ t: 'card', id: info.id, dmg: 0, label: 'FAINTED' }); continue; }
      if (owner.status === 'PAR' && !this.dry && this.rng.chance(0.25)) { this.emit({ t: 'card', id: info.id, dmg: 0, label: 'PARALYZED' }); continue; }
      if (this.bossRule?.cardFilter) { const r = this.bossRule.cardFilter(this, info, infos.indexOf(info)); if (r) { this.emit({ t: 'card', id: info.id, dmg: 0, label: r }); continue; } }
      let move = resolveCallMove(this, info.move, 'player');
      if (move !== info.move) this.msg(`${info.move.name} turned into ${move.name}!`);
      const ctx = { b: this, user: owner, target: enemy, userSide: ps, targetSide: es, us: 'player', them: 'enemy', move, card: info, score: S };
      const hits = hitCount(this, move);
      const isStatus = move.power === 0 && !FIXED_DAMAGE[move.effect] && !POWER_FN[move.effect] && !['SUPER_FANG', 'ENDEAVOR', 'OHKO', 'COUNTER', 'MIRROR_COAT', 'BIDE', 'MEMENTO'].includes(move.effect);
      let type = info.type;
      if (move !== info.move) type = move.type;
      let anyHit = false;
      for (let h = 0; h < hits; h++) {
        // Accuracy
        if (!this.rollPlayerAccuracy(move, owner, enemy, isStatus)) {
          this.emit({ t: 'card', id: info.id, dmg: 0, label: 'MISS' });
          if (move.effect === 'RECOIL_IF_MISS') this.recoil('player', owner, 1 / 4, move.key);
          break;
        }
        anyHit = true;
        if (isStatus) {
          if (this.sides.enemy.magicCoat && move.target !== 'USER') { this.sides.enemy.magicCoat = false; this.msg('It bounced back!'); break; }
          this.emit({ t: 'card', id: info.id, dmg: 0, label: move.name });
          (EFFECTS[move.effect] || EFFECTS.HIT)(ctx);
          break;
        }
        // Special fixed-damage effects
        if (move.effect === 'OHKO') {
          if (enemy.isBoss || enemy.isElite || enemy.legendary || enemy.level > owner.level || enemy.ability === 'STURDY') { this.emit({ t: 'card', id: info.id, dmg: 0, label: 'NO EFFECT' }); break; }
          S.ohko = true; this.emit({ t: 'card', id: info.id, dmg: 0, label: 'ONE-HIT KO!' }); break;
        }
        if (move.effect === 'SUPER_FANG') { if (S.fangUsed) { this.emit({ t: 'card', id: info.id, dmg: 0, label: 'FAILED' }); break; } S.fangUsed = true; const left = Math.max(0, enemy.hp - S.fixed); const d = Math.floor(left * (enemy.isBoss || enemy.isElite ? 0.125 : 0.5)); S.fixed += d; this.emit({ t: 'card', id: info.id, dmg: 0, label: `-${d} HP` }); break; }
        if (move.effect === 'ENDEAVOR') { if (S.endeavorUsed || owner.uid !== this.leadUid) { this.emit({ t: 'card', id: info.id, dmg: 0, label: 'FAILED' }); break; } S.endeavorUsed = true; const left = Math.max(0, enemy.hp - S.fixed); let d = Math.max(0, left - Math.floor(enemy.maxHp * this.hpFrac('player', owner))); if (enemy.isBoss || enemy.isElite) d = Math.min(d, Math.floor(enemy.maxHp * 0.25)); S.fixed += d; this.emit({ t: 'card', id: info.id, dmg: 0, label: `-${d} HP` }); break; }
        if (move.effect === 'MEMENTO') { this.addStage('enemy', 'atk', -2, move.key); this.addStage('enemy', 'spa', -2, move.key); S.after.push(() => this.selfFaint('player', owner)); this.emit({ t: 'card', id: info.id, dmg: 0, label: 'MEMENTO' }); break; }
        let dmg, eff, srcs = [];
        let label = null;
        if (FIXED_DAMAGE[move.effect]) {
          eff = this.cardEff(type, enemy);
          dmg = eff === 0 ? 0 : FIXED_DAMAGE[move.effect]({ user: owner, b: this });
        } else if (move.effect === 'COUNTER' || move.effect === 'MIRROR_COAT' || move.effect === 'BIDE') {
          eff = this.cardEff(type, enemy);
          dmg = ps.hitThisTurn && eff > 0 ? 2 * (ps.lastDamage || 0) : 0;
        } else {
          let power = move.power;
          if (POWER_FN[move.effect]) power = POWER_FN[move.effect]({ ...ctx, hitIndex: h });
          if (!power) { this.emit({ t: 'card', id: info.id, dmg: 0, label: 'FAILED' }); break; }
          const r = this.hitDamage(info, { move, type, power, h, enemy });
          dmg = r.dmg; eff = r.eff; srcs = r.srcs; label = r.label;
          if (ps.charge && type === 'ELECTRIC') ps.charge = false;
          // Critical hit
          let cs = critStageOf(move) + (ps.focus ? 2 : 0) + (this.mods.critStage || 0);
          const always = this.relicHooks('critFor').some(([d]) => d.critFor.includes(owner.species));
          const critP = [1 / 16, 1 / 8, 1 / 4, 1 / 3, 1 / 2][Math.min(4, cs)];
          if (always || (!this.dry && this.rng.chance(critP))) { dmg *= 2 + (this.mods.critMult || 0); label = 'CRITICAL'; this.run.stats.crits = (this.run.stats.crits || 0) + 1; }
        }
        dmg = Math.max(0, Math.round(dmg));
        if (eff === 0) label = 'NO EFFECT';
        else if (eff > 1 && !label) label = 'SUPER';
        else if (eff < 1 && !label) label = 'WEAK';
        if (bestEff === null || eff > bestEff) bestEff = eff;
        S.cardTotal += dmg;
        this.emit({ t: 'card', id: info.id, dmg, label, eff, total: S.cardTotal, hit: h, srcs });
        if (move.effect === 'FALSE_SWIPE') S.falseSwipe = true;
        if (eff > 0) {
          // Secondary effect + contact abilities
          if (enemy.ability !== 'SHIELD_DUST' || !move.chance) (EFFECTS[move.effect] || EFFECTS.HIT)(ctx);
          if (move.flags?.includes('MAKES_CONTACT')) this.contactAbility('enemy', enemy, 'player', owner);
        }
        if (h === 0) { S.attackHits++; for (const [def, inst] of this.relicHooks('onCard')) def.onCard(S, { ...info, type }, inst.state); }
        this.chainBump(info);
      }
      if (anyHit) this.sides.player.lastMove = move.key;
    }
    if (ps.helpingHand) { S.times(1.5, 'HELPING HAND'); ps.helpingHand = false; }
    for (const [def, inst] of this.relicHooks('onHand')) def.onHand(S, inst.state);
    if (this.bossRule?.onScore) this.bossRule.onScore(this, S);
    if (confusedPenalty) S.times(0.5, 'CONFUSED');
    if (ps.focus > 0) ps.focus--;
    if (ps.lockOn > 0) ps.lockOn--;
    if (bestEff === 0) { S.cardTotal = 0; S.flatTotal = 0; this.msg(`It doesn't affect ${this.monName(enemy)}...`); }
    // (hybrid experiments: the combo bonus multiplies with the item bonuses instead of adding up; 'hybridlite' = only that)
    const bonusMult = TUNING.scoring === 'hybrid' || TUNING.scoring === 'hybridlite' ? (1 + bonus / 100) * (1 + (S.pctTotal - bonus) / 100) : 1 + S.pctTotal / 100;
    const damage = Math.max(0, Math.floor((S.cardTotal + S.flatTotal) * bonusMult * S.timesTotal));
    S.damage = damage;
    if (!this.dry) this.maxHand = Math.max(this.maxHand || 0, damage);
    if (this.run.metrics && !this.dry) this.run.metrics.hands.push({ act: this.run.actIndex, dmg: damage, ehp: enemy.maxHp, kind: this.kind });
    S.effLabel = bestEff === null ? null : bestEff > 1 ? 'super' : bestEff === 0 ? 'none' : bestEff < 1 ? 'weak' : null;
    this.emit({ t: 'total', base: Math.round(S.cardTotal + S.flatTotal), bonus: Math.round(S.pctTotal), times: +S.timesTotal.toFixed(2), damage, fixed: S.fixed, eff: S.effLabel });
    return S;
  }

  chain(card, kind) {
    if (!card) return 0;
    const k = card.uid + ':' + card.move.key;
    const c = this.chains[k];
    if (!c || c.hand < this.handsPlayed - 1) return 0;
    return c.n;
  }
  chainBump(info) {
    const k = info.uid + ':' + info.move.key;
    const c = this.chains[k];
    if (c && c.hand === this.handsPlayed) return;
    if (c && c.hand === this.handsPlayed - 1) { c.n++; c.hand = this.handsPlayed; } else this.chains[k] = { n: 1, hand: this.handsPlayed };
  }

  deckSize() { return this.deck.draw.length + this.deck.hand.length + this.deck.discard.length; }
  allDeckInfos() { return [...this.deck.draw, ...this.deck.hand, ...this.deck.discard].map(c => this.cardInfo(c)); }

  rollPlayerAccuracy(move, owner, enemy, isStatus) {
    if (!invulnHit(this.sides.enemy.dodge, move)) return false; // a foe out of reach (DIVE / DIG / FLY / BOUNCE)
    if (isStatus && (move.target === 'USER' || !move.accuracy)) return true;
    if (this.dry) return move.effect !== 'OHKO';
    if (move.effect === 'OHKO') return this.rng.next() < (30 + owner.level - enemy.level) / 100;
    if (!move.accuracy || move.effect === 'ALWAYS_HIT' || move.effect === 'VITAL_THROW' || this.sides.player.lockOn) return true;
    if (move.effect === 'THUNDER' && this.weather === 'RAIN') return true;
    let acc = move.accuracy / 100;
    const evaStage = this.sides.enemy.foresight ? Math.min(0, this.sides.enemy.stages.eva) : this.sides.enemy.stages.eva;
    acc *= accStageMult(this.sides.player.stages.acc - evaStage);
    if (abilityOf(owner) === 'COMPOUND_EYES') acc *= 1.3;
    if (abilityOf(owner) === 'HUSTLE' && !isSpecialMove(move.key, move.type)) acc *= 0.8;
    if (enemy.ability === 'SAND_VEIL' && this.weather === 'SAND') acc *= 0.8;
    if (move.effect === 'THUNDER' && this.weather === 'SUN') acc = 0.5;
    if (move.effect === 'OHKO') acc = (30 + owner.level - enemy.level) / 100;
    return this.rng.next() < acc;
  }

  contactAbility(defSide, defMon, atkSide, atkMon) {
    const ab = defSide === 'enemy' ? defMon.ability : abilityOf(defMon);
    if (CONTACT_PUNISH[ab] && this.rng.chance(0.3)) {
      this.msg(`${this.monName(defMon)}'s ${ab.replace('_', ' ')}!`);
      this.inflictStatus(atkSide, CONTACT_PUNISH[ab], ab, false, atkMon);
    } else if (ab === 'EFFECT_SPORE' && this.rng.chance(0.1)) {
      this.inflictStatus(atkSide, this.rng.pick(['PSN', 'PAR', 'SLP']), ab, false, atkMon);
    } else if (ab === 'ROUGH_SKIN') {
      if (atkSide === 'player') this.damagePlayer(atkMon, Math.max(1, Math.floor(maxHp(atkMon) / 16)));
      else this.damageEnemy(Math.floor(atkMon.maxHp / 16), 'ROUGH_SKIN');
    }
  }

  // ---- enemy action ---------------------------------------------------------------------
  enemyAct() {
    const e = this.enemy();
    const lead = this.lead();
    if (!e || isFainted2(e) || !lead || this.result) return;
    const es = this.sides.enemy, ps = this.sides.player;
    // FOCUS ENERGY / LOCK-ON wear off for the foe too (they used to last forever)
    if (es.focus > 0) es.focus--;
    if (es.lockOn > 0) es.lockOn--;
    const move = this.intent?.move || this.moveData('TACKLE');
    if (move.effect === 'RECHARGE_TURN') { this.msg(`${this.monName(e)} must recharge!`); this.ms(e.uid).recharge = 0; return; }
    if (es.flinch) { this.msg(`${this.monName(e)} flinched!`); return; }
    if (e.status === 'SLP') {
      if (e.sleepTurns > 0) { e.sleepTurns--; this.msg(`${this.monName(e)} is fast asleep.`); this.emit({ t: 'statusAnim', side: 'enemy', status: 'SLP' }); return; }
      e.status = null; this.msg(`${this.monName(e)} woke up!`); this.emit({ t: 'status', side: 'enemy', status: null });
      if (e.isBoss || e.isElite) e.sleepImmune = 3;
    }
    if (e.status === 'FRZ') {
      if (this.rng.chance(0.2)) { e.status = null; this.msg(`${this.monName(e)} thawed out!`); this.emit({ t: 'status', side: 'enemy', status: null }); }
      else { this.msg(`${this.monName(e)} is frozen solid!`); return; }
    }
    if (e.ability === 'TRUANT' && this.turn % 2 === 0) { this.msg(`${this.monName(e)} is loafing around!`); return; }
    if (es.confused > 0) {
      es.confused--;
      if (es.confused === 0) this.msg(`${this.monName(e)} snapped out of confusion!`);
      else if (this.rng.chance(e.isBoss || e.isElite ? 0.33 : 0.5)) {
        this.msg(`${this.monName(e)} is confused! It hurt itself in its confusion!`);
        this.damageEnemy(Math.floor(e.maxHp / (e.isBoss || e.isElite ? 20 : 10)), 'confusion');
        this.checkEnemyFaint(false);
        return;
      }
    }
    if (es.infatuated > 0) { es.infatuated--; if (this.rng.chance(0.5)) { this.msg(`${this.monName(e)} is immobilized by love!`); return; } }
    if (e.status === 'PAR' && this.rng.chance(0.25)) { this.msg(`${this.monName(e)} is paralyzed! It can't move!`); this.emit({ t: 'statusAnim', side: 'enemy', status: 'PAR' }); return; }
    if (es.disabled > 0) { es.disabled--; this.msg(`${this.monName(e)}'s ${move.name} is disabled!`); return; }

    this.msg(`${this.monName(e)} used ${move.name}!`);
    this.emit({ t: 'enemyMove', move: move.key, type: move.type, name: move.name });
    es.lastMove = move.key;
    const isStatus = move.power === 0 && !FIXED_DAMAGE[move.effect];
    const ctx = { b: this, user: e, target: lead, userSide: es, targetSide: ps, us: 'enemy', them: 'player', move };
    // DIVE / DIG / FLY / BOUNCE: the lead is out of reach, so the move (and all its effects) misses it.
    const reach = invulnHit(ps.dodge && (!ps.dodgeUid || ps.dodgeUid === lead.uid) ? ps.dodge : null, move);
    if (isStatus) {
      if (!reach) { this.msg(`${monName(lead)} avoided the attack!`); return; }
      if (move.target !== 'USER' && move.accuracy && !this.rollEnemyAccuracy(move, e, lead)) { this.msg(`${this.monName(e)}'s attack missed!`); return; }
      if (ps.magicCoat && move.target !== 'USER') { this.msg(`${monName(lead)} bounced it back!`); ps.magicCoat = false; (EFFECTS[move.effect] || EFFECTS.HIT)({ ...ctx, user: lead, target: e, userSide: ps, targetSide: es, us: 'player', them: 'enemy' }); return; }
      if (ps.protect && move.target !== 'USER') { this.msg(`${monName(lead)} protected itself!`); return; }
      (EFFECTS[move.effect] || EFFECTS.HIT)(ctx);
      this.checkEnemyFaint(false); // e.g. a GHOST's CURSE can knock out the user
      return;
    }
    if (ps.protect) { this.msg(`${monName(lead)} protected itself!`); return; }
    if (!reach) { this.msg(`${monName(lead)} avoided the attack!`); return; }
    if (this.mods.laxIncense && !this.laxUsed) { this.laxUsed = true; this.msg(`${this.monName(e)}'s attack missed! (LAX INCENSE)`); return; }
    if (!this.rollEnemyAccuracy(move, e, lead)) {
      this.msg(`${this.monName(e)}'s attack missed!`);
      if (move.effect === 'RECOIL_IF_MISS') { this.damageEnemy(Math.floor(e.maxHp / 8), 'recoil'); this.checkEnemyFaint(false); }
      return;
    }
    const hits = hitCount(this, move);
    let total = 0, n = 0;
    for (let h = 0; h < hits; h++) {
      const critP = [1 / 16, 1 / 8, 1 / 4, 1 / 3, 1 / 2][Math.min(4, critStageOf(move) + (es.focus ? 2 : 0))];
      const crit = this.rng.chance(critP);
      const rand = (85 + this.rng.int(0, 15)) / 100;
      let dmg = this.enemyDamage(move, e, lead, rand, crit);
      if (reach === 2) dmg *= 2; // SURF on a diver, EARTHQUAKE on a digger, GUST on a flier...
      if (dmg === 0) { this.msg(`It doesn't affect ${monName(lead)}...`); break; }
      if (crit) this.msg('A critical hit!');
      if (ps.substitute) {
        this.msg('The SUBSTITUTE took damage for it!');
        ps.substitute = false; this.msg(`${monName(lead)}'s SUBSTITUTE faded!`);
        n++; continue;
      }
      if (dmg >= lead.hp) {
        if (ps.endure) { dmg = lead.hp - 1; this.msg(`${monName(lead)} endured the hit!`); }
        else if (this.mods.focusBand && !this.focusBandUsed) { dmg = lead.hp - 1; this.focusBandUsed = true; this.msg(`${monName(lead)} hung on using its FOCUS BAND!`); }
        else if (abilityOf(lead) === 'STURDY' && lead.hp === maxHp(lead)) { dmg = lead.hp - 1; this.msg(`${monName(lead)} held on with STURDY!`); }

      }
      const eff = typeEffect(move.type, typesOf(lead));
      this.damagePlayer(lead, dmg, eff);
      total += dmg; n++;
      ps.hitThisTurn = true;
      if (move.flags?.includes('MAKES_CONTACT')) this.contactAbility('player', lead, 'enemy', e);
      if (isFainted(lead)) break;
    }
    if (hits > 1 && n > 1) this.msg(`Hit ${n} times!`);
    ps.lastDamage = total;
    if (total > 0 && !isFainted(lead) && !(abilityOf(lead) === 'SHIELD_DUST' && move.chance)) (EFFECTS[move.effect] || EFFECTS.HIT)(ctx);
    if (move.effect === 'EXPLOSION') this.damageEnemy(e.hp, 'explosion');
    if (move.effect === 'RECHARGE') this.ms(e.uid).recharge = 1;
    this.checkLeadFaint();
    this.checkEnemyFaint(false);
  }

  rollEnemyAccuracy(move, e, lead) {
    if (!move.accuracy || move.effect === 'ALWAYS_HIT' || this.sides.enemy.lockOn) return true;
    let acc = move.accuracy / 100 * accStageMult(this.sides.enemy.stages.acc - this.sides.player.stages.eva);
    acc *= 1 + (this.mods.enemyAcc || 0);
    if (abilityOf(lead) === 'SAND_VEIL' && this.weather === 'SAND') acc *= 0.8;
    if (e.ability === 'COMPOUND_EYES') acc *= 1.3;
    if (move.effect === 'OHKO') { if (lead.level > e.level || abilityOf(lead) === 'STURDY') return false; acc = (30 + e.level - lead.level) / 100; }
    return this.rng.next() < acc;
  }

  // ---- damage, healing, status ----------------------------------------------------------
  damageEnemy(amount, src, eff) {
    const e = this.enemy();
    if (!e || amount <= 0) return;
    const before = e.hp;
    e.hp = Math.max(0, e.hp - Math.round(amount));
    if (e.hp === 0 && this.bossRule?.sturdy && !e.sturdyUsed && before > 1) { e.sturdyUsed = true; e.hp = 1; this.msg(`${this.monName(e)} endured the hit with STURDY!`); }
    this.emit({ t: 'damage', side: 'enemy', amount: before - e.hp, hp: e.hp, maxHp: e.maxHp, src, eff });
    if (src === 'hand' && eff === 'super') this.msg("It's super effective!");
    else if (src === 'hand' && eff === 'weak') this.msg("It's not very effective...");
  }

  damagePlayer(mon, amount, eff) {
    const before = mon.hp;
    mon.hp = Math.max(0, mon.hp - Math.round(amount));
    this.emit({ t: 'damage', side: 'player', uid: mon.uid, amount: before - mon.hp, hp: mon.hp, maxHp: maxHp(mon), eff: eff > 1 ? 'super' : eff < 1 ? 'weak' : null });
    if (eff > 1) this.msg("It's super effective!");
    else if (eff !== undefined && eff < 1 && eff > 0) this.msg("It's not very effective...");
  }

  healLead(frac, src) { const l = this.lead(); if (l && !isFainted(l)) this.healSide('player', l, frac, src, true); }
  healEnemy(frac) { const e = this.enemy(); const before = e.hp; e.hp = Math.min(e.maxHp, e.hp + Math.floor(e.maxHp * frac)); if (e.hp > before) this.emit({ t: 'heal', side: 'enemy', amount: e.hp - before, hp: e.hp, maxHp: e.maxHp }); }

  healSide(side, mon, frac, src, quiet) {
    if (side === 'enemy') {
      const before = mon.hp;
      const heal = Math.floor(mon.maxHp * frac * (mon.isBoss ? 0.6 : 1));
      mon.hp = Math.min(mon.maxHp, mon.hp + heal);
      if (mon.hp > before) { this.emit({ t: 'heal', side, amount: mon.hp - before, hp: mon.hp, maxHp: mon.maxHp }); if (!quiet) this.msg(`${this.monName(mon)} regained health!`); }
      return;
    }
    if (isFainted(mon)) return;
    const m = maxHp(mon);
    const before = mon.hp;
    mon.hp = Math.min(m, mon.hp + Math.max(1, Math.floor(m * frac)));
    if (mon.hp > before) {
      this.emit({ t: 'heal', side, uid: mon.uid, amount: mon.hp - before, hp: mon.hp, maxHp: m, src });
      if (!quiet) this.msg(`${monName(mon)} regained health!`);
      else if (src) this.emit({ t: 'relic', key: src, text: `+${mon.hp - before} HP` });
    }
  }

  recoil(side, mon, frac, src, silent) {
    if (side === 'enemy') { this.damageEnemy(Math.floor(mon.maxHp * frac * 0.5), 'recoil'); if (!silent) this.msg(`${this.monName(mon)} is hit with recoil!`); return; }
    const d = Math.max(1, Math.floor(maxHp(mon) * frac));
    this.damagePlayer(mon, d);
    if (!silent) this.msg(`${monName(mon)} is hit with recoil!`);
    if (isFainted(mon)) this.afterPlayerFaint(mon);
  }

  selfFaint(side, mon) {
    if (side === 'enemy') { this.damageEnemy(mon.hp, 'self'); return; }
    this.damagePlayer(mon, mon.hp);
    this.afterPlayerFaint(mon);
  }

  painSplit(side, mon) {
    const e = this.enemy(), l = side === 'player' ? mon : this.lead();
    const avg = (this.hpFrac('enemy', e) + this.hpFrac('player', l)) / 2;
    const target = Math.round(e.maxHp * avg);
    if (target < e.hp) this.damageEnemy(e.hp - target, 'PAIN_SPLIT'); else this.healEnemy((target - e.hp) / e.maxHp);
    const lt = Math.round(maxHp(l) * avg);
    if (lt > l.hp) this.healSide('player', l, (lt - l.hp) / maxHp(l), 'PAIN_SPLIT', true); else this.damagePlayer(l, l.hp - lt);
    this.msg('The battlers shared their pain!');
  }

  cureSide(side, all, mon) {
    if (side === 'enemy') { this.enemy().status = null; this.emit({ t: 'status', side: 'enemy', status: null }); this.msg(`${this.monName(this.enemy())} was cured!`); return; }
    const list = all ? this.run.party : [mon];
    for (const m of list) { if (m.status) { m.status = null; this.ms(m.uid).sleep = 0; } }
    this.emit({ t: 'partyUpdate' });
    this.msg(all ? 'A bell chimed! Your team was cured!' : `${monName(mon)}'s status returned to normal!`);
  }

  // Why `side`'s active POKéMON can't fall asleep right now, as a message (null = it can). Mirrors inflictStatus.
  sleepBlock(side) {
    const mon = this.activeMon(side);
    if (!mon || isFainted2(mon)) return 'But it failed!';
    const ab = side === 'enemy' ? mon.ability : abilityOf(mon);
    if (mon.status) return `${this.monName(mon)} is already ${mon.status === 'SLP' ? 'asleep' : 'afflicted'}!`;
    if (this.sides[side].safeguard) return `${this.sideName(side)} is protected by SAFEGUARD!`;
    if (this.sides[side].substitute) return 'But it failed!';
    if (ab === 'INSOMNIA' || ab === 'VITAL_SPIRIT' || this.sides.player.uproar || this.sides.enemy.uproar) return `${this.monName(mon)} stayed awake!`;
    if (side === 'player' && this.mods.pokeFlute) return `The POKé FLUTE keeps ${monName(mon)} awake!`;
    if (side === 'enemy' && mon.sleepImmune > 0) return `${this.monName(mon)} is too alert to fall asleep!`;
    return null;
  }

  inflictStatus(side, st, src, announceFail, specificMon, sleepTurns) {
    const mon = specificMon || this.activeMon(side);
    if (!mon || isFainted2(mon)) return false;
    const types = this.typesOfMon(side, mon);
    const ab = side === 'enemy' ? mon.ability : abilityOf(mon);
    const fail = (why) => { if (announceFail) this.msg(why || 'But it failed!'); return false; };
    if (mon.status) return fail(`${this.monName(mon)} is already ${st === 'SLP' ? 'asleep' : 'afflicted'}!`);
    if (this.sides[side].safeguard && src !== 'REST') return fail(`${this.sideName(side)} is protected by SAFEGUARD!`);
    if (this.sides[side].substitute && src !== 'REST' && specificMon === undefined) return fail();
    if ((st === 'PSN' || st === 'TOX') && (types.includes('POISON') || types.includes('STEEL') || ab === 'IMMUNITY')) return fail("It doesn't affect " + this.monName(mon) + '...');
    if (st === 'BRN' && (types.includes('FIRE') || ab === 'WATER_VEIL')) return fail("It doesn't affect " + this.monName(mon) + '...');
    if (st === 'FRZ' && (types.includes('ICE') || ab === 'MAGMA_ARMOR' || this.weather === 'SUN')) return fail();
    if (st === 'PAR' && (ab === 'LIMBER' || (src === 'THUNDER_WAVE' && types.includes('GROUND')))) return fail("It doesn't affect " + this.monName(mon) + '...');
    if (st === 'SLP' && (ab === 'INSOMNIA' || ab === 'VITAL_SPIRIT' || this.sides.player.uproar || this.sides.enemy.uproar) && src !== 'REST') return fail(`${this.monName(mon)} stayed awake!`);
    if (st === 'SLP' && side === 'player' && this.mods.pokeFlute && src !== 'REST') return fail(`The POKé FLUTE keeps ${monName(mon)} awake!`);
    if (st === 'SLP' && side === 'enemy' && mon.sleepImmune > 0) return fail(`${this.monName(mon)} is too alert to fall asleep!`);
    mon.status = st;
    if (st === 'SLP') {
      const turns = sleepTurns ?? (side === 'enemy' ? (mon.isBoss ? this.rng.int(1, 2) : this.rng.int(1, 3)) : this.rng.int(1, 3));
      if (side === 'enemy') mon.sleepTurns = turns; else this.ms(mon.uid).sleep = turns;
    }
    if (st === 'TOX') { if (side === 'enemy') mon.toxic = 1; else this.ms(mon.uid).toxic = 1; }
    this.emit({ t: 'status', side, uid: mon.uid, status: st });
    this.msg(`${this.monName(mon)} ${st === 'SLP' ? 'fell asleep!' : 'is ' + STATUS_NAMES[st] + '!'}`);
    if (ab === 'SYNCHRONIZE' && ['PSN', 'BRN', 'PAR', 'TOX'].includes(st)) {
      const other = side === 'player' ? 'enemy' : 'player';
      this.msg(`${this.monName(mon)}'s SYNCHRONIZE!`);
      this.inflictStatus(other, st === 'TOX' ? 'PSN' : st, 'SYNCHRONIZE');
    }
    return true;
  }

  confuse(side, announce, self) {
    const mon = this.activeMon(side);
    const ab = side === 'enemy' ? mon.ability : abilityOf(mon);
    if (ab === 'OWN_TEMPO' || (side === 'player' && this.mods.noConfuse)) { if (announce) this.msg(`${this.monName(mon)} can't be confused!`); return; }
    if (this.sides[side].confused) { if (announce) this.msg(`${this.monName(mon)} is already confused!`); return; }
    if (this.sides[side].safeguard && !self) { if (announce) this.msg(`${this.sideName(side)} is protected by SAFEGUARD!`); return; }
    this.sides[side].confused = this.rng.int(2, 4);
    this.msg(`${this.monName(mon)} became confused!`);
    this.emit({ t: 'statusAnim', side, status: 'CONFUSED' });
  }

  flinch(side, always) {
    const mon = this.activeMon(side);
    const ab = side === 'enemy' ? mon.ability : abilityOf(mon);
    if (ab === 'INNER_FOCUS') return;
    // A flinch only matters if the target hasn't moved yet this turn.
    this.sides[side].flinch = true;
  }

  addStage(side, stat, n, src, fromFoe) {
    const s = this.sides[side];
    const mon = this.activeMon(side);
    const ab = mon ? (side === 'enemy' ? mon.ability : abilityOf(mon)) : null;
    if (n < 0 && fromFoe) {
      if (s.mist) { this.msg(`${this.sideName(side)} is protected by MIST!`); return; }
      if (ab === 'CLEAR_BODY' || ab === 'WHITE_SMOKE') { this.msg(`${this.sideName(side)}'s ${ab.replace('_', ' ')} prevents stat loss!`); return; }
      if (ab === 'KEEN_EYE' && stat === 'acc') return;
      if (ab === 'HYPER_CUTTER' && stat === 'atk') return;
    }
    const before = s.stages[stat];
    s.stages[stat] = Math.max(-6, Math.min(6, before + n));
    const d = s.stages[stat] - before;
    if (d === 0) { this.msg(`${this.sideName(side)}'s ${STAT_NAMES[stat]} won't go ${n > 0 ? 'higher' : 'lower'}!`); return; }
    const word = Math.abs(d) >= 2 ? (d > 0 ? 'sharply rose' : 'harshly fell') : d > 0 ? 'rose' : 'fell';
    const who = side === 'player' ? 'Your team' : this.monName(mon);
    this.emit({ t: 'stage', side, stat, delta: d, total: s.stages[stat] });
    this.msg(`${who}'s ${STAT_NAMES[stat]} ${word}!`);
    if (side === 'player' || side === 'enemy') this.updateIntentPreview?.();
  }

  clearNegativeStages(side, src) {
    const s = this.sides[side].stages;
    let any = false;
    for (const k in s) if (s[k] < 0) { s[k] = 0; any = true; }
    if (any) this.emit({ t: 'relic', key: src, text: 'Stats restored' });
  }

  setRecharge(side, mon, kind) {
    if (side === 'enemy') { this.ms(mon.uid).recharge = 1; return; }
    const st = this.ms(mon.uid);
    st.recharge = 2; // cleared at end of next turn
    st.rechargeKind = kind || 'recharge';
  }

  setWeather(w, fromAbility) {
    this.weather = w; this.weatherTurns = fromAbility ? 99 : 5;
    const text = { SUN: 'The sunlight got bright!', RAIN: 'It started to rain!', SAND: 'A sandstorm brewed!', HAIL: 'It started to hail!' }[w];
    this.msg(text);
    this.emit({ t: 'weather', weather: w });
  }

  tryEscape(side, roar) {
    if (side === 'player') {
      if (this.kind === 'wild' && !this.enemy().isBoss) { this.msg(`${this.monName(this.enemy())} fled!`); this.end('fled'); }
      else { this.sides.enemy.flinch = true; this.msg(`${this.monName(this.enemy())} hesitated!`); }
    } else {
      if (this.kind === 'wild') { this.msg(`${this.monName(this.enemy())} fled!`); this.end('enemyFled'); }
    }
  }

  // ---- faint handling -------------------------------------------------------------------
  checkLeadFaint() {
    const lead = this.lead();
    if (lead && isFainted(lead)) this.afterPlayerFaint(lead);
  }

  afterPlayerFaint(mon) {
    if (this.ms(mon.uid).faintHandled) return;
    this.ms(mon.uid).faintHandled = true;
    mon.status = null;
    this.emit({ t: 'faint', side: 'player', uid: mon.uid, species: mon.species });
    this.msg(`${monName(mon)} fainted!`);
    if (this.run.nuzlocke && !this.dry && !mon.lost) {
      // Nuzlocke: gone for good (released when the battle ends).
      mon.lost = true;
      this.emit({ t: 'nuzlocke', uid: mon.uid, species: mon.species });
      this.msg(`NUZLOCKE: ${monName(mon)} can't go on. It will be released after this battle.`);
    }
    this.removeMonCards(mon.uid);
    this.run.stats.faints = (this.run.stats.faints || 0) + 1;
    if (!this.dry) this.faintCount = (this.faintCount || 0) + 1;
    if (this.sides.player.destinyBond && mon.uid === this.leadUid) {
      const e = this.enemy();
      this.msg(`${monName(mon)} took its foe down with it!`);
      this.damageEnemy(e.isBoss ? Math.floor(e.maxHp * 0.4) : e.hp, 'DESTINY_BOND');
    }
    const alive = this.aliveParty();
    if (!alive.length) { this.msg('You are out of usable POKéMON!'); this.end('lose'); return; }
    if (mon.uid === this.leadUid) {
      this.switchLead(alive[0].uid, true);
      // The player may pick someone else instead, for free, before their next hand.
      if (alive.length > 1) this.faintSwitch = true;
    }
    this.emit({ t: 'partyUpdate' });
  }

  checkEnemyFaint(byHand) {
    const e = this.enemy();
    if (!e || e.hp > 0 || this.result) return;
    this.emit({ t: 'faint', side: 'enemy', species: e.species });
    this.msg(`${this.monName(e)} fainted!`);
    this.defeated.push(e);
    if (byHand) for (const [def] of this.relicHooks('onKO')) def.onKO(this);
    if (this.enemyIndex + 1 < this.enemies.length) {
      this.enemyIndex++;
      this.sendOutEnemy(false);
      this.enemyJustSwitched = true;
      this.chooseIntent();
    } else {
      this.end('win');
    }
  }

  // ---- end of turn ----------------------------------------------------------------------
  endTurn() {
    // Weather
    if (this.weather) {
      if (this.weather === 'SAND' || this.weather === 'HAIL') {
        this.weatherDamage(true, true);
        this.msg(this.weather === 'SAND' ? 'The sandstorm rages.' : 'Hail continues to fall.');
      }
      if (--this.weatherTurns <= 0) { this.msg('The weather returned to normal.'); this.weather = null; this.emit({ t: 'weather', weather: null }); }
    }
    if (this.enemyResiduals()) return;
    this.leadResiduals();
    // Weather and boss rules can KO the lead before (or instead of) the residuals above.
    this.checkLeadFaint();
    if (this.result) return;
    this.playerCounters();
  }

  // Sandstorm / hail chip damage on the foe and/or the lead (co-op calls these per Pokémon).
  weatherDamage(onEnemy, onLead) {
    const e = this.enemy(), lead = this.lead();
    const immune = t => this.weather === 'SAND' ? t.some(x => ['ROCK', 'GROUND', 'STEEL'].includes(x)) : t.includes('ICE');
    if (onEnemy && !immune(e.types)) { this.damageEnemy(Math.floor(e.maxHp / 16), 'weather'); }
    if (onLead && lead && !immune(typesOf(lead)) && !this.relicHooks('onHand').some(([d]) => d.key === 'GO_GOGGLES')) this.damagePlayer(lead, Math.max(1, Math.floor(maxHp(lead) / 16)));
  }

  // Enemy residuals (scaled HP => fractions slightly gentler than the games). Returns true if the battle ended.
  enemyResiduals() {
    const e = this.enemy(), lead = this.lead();
    const es = this.sides.enemy;
    if (e && e.hp > 0) {
      const tough = e.isBoss || e.isElite || e.legendary; // % damage is capped on big HP pools
      if (e.status === 'PSN') { this.damageEnemy(Math.floor(e.maxHp / (tough ? 20 : 10)), 'PSN'); this.msg(`${this.monName(e)} is hurt by poison!`); }
      if (e.status === 'TOX') { this.damageEnemy(Math.floor(tough ? e.maxHp * Math.min(2, e.toxic) / 24 : e.maxHp * Math.min(15, e.toxic) / 16), 'PSN'); e.toxic++; this.msg(`${this.monName(e)} is hurt by poison!`); }
      if (e.status === 'BRN') { this.damageEnemy(Math.floor(e.maxHp / (tough ? 20 : 10)), 'BRN'); this.msg(`${this.monName(e)} is hurt by its burn!`); }
      if (es.seeded && e.hp > 0) { this.damageEnemy(Math.floor(e.maxHp / (tough ? 20 : 10)), 'SEED'); this.msg(`${this.monName(e)}'s health is sapped by LEECH SEED!`); if (lead) this.healSide('player', lead, 1 / 8, null, true); }
      if (es.trapped > 0 && e.hp > 0) { es.trapped--; this.damageEnemy(Math.floor(e.maxHp / 16), 'TRAP'); this.msg(`${this.monName(e)} is hurt by the trap!`); }
      if (es.nightmare && e.status === 'SLP') { this.damageEnemy(Math.floor(e.maxHp / (tough ? 12 : 6)), 'NIGHTMARE'); this.msg(`${this.monName(e)} is locked in a NIGHTMARE!`); }
      if (es.cursed) { this.damageEnemy(Math.floor(e.maxHp / (tough ? 12 : 6)), 'CURSE'); this.msg(`${this.monName(e)} is afflicted by the CURSE!`); }
      if (es.perish > 0 && --es.perish === 0) { this.msg(`${this.monName(e)}'s PERISH count fell to 0!`); this.damageEnemy(e.isBoss ? Math.floor(e.maxHp * 0.3) : e.hp, 'PERISH'); }
      if (es.yawn > 0 && --es.yawn === 0) this.inflictStatus('enemy', 'SLP', 'YAWN', true);
      if (es.ingrain) this.healEnemy(1 / 16);
      if (es.wish > 0 && --es.wish === 0) this.healEnemy(0.5);
      if (e.sleepImmune > 0) e.sleepImmune--;
      if (e.ability === 'SPEED_BOOST') this.addStage('enemy', 'spe', 1, 'SPEED_BOOST');
      if (e.ability === 'SHED_SKIN' && e.status && this.rng.chance(0.3)) { e.status = null; this.emit({ t: 'status', side: 'enemy', status: null }); this.msg(`${this.monName(e)} shed its skin!`); }
      if (e.ability === 'RAIN_DISH' && this.weather === 'RAIN') this.healEnemy(1 / 16);
      if (this.bossRule?.onTurnEnd) this.bossRule.onTurnEnd(this);
      for (const k of ['reflect', 'lightScreen', 'safeguard', 'mist', 'taunt', 'uproar']) if (es[k] > 0) es[k]--;
      this.checkEnemyFaint(false);
      if (this.result) return true;
    }
    return false;
  }

  // Player lead residuals (status, seeds, held items).
  leadResiduals() {
    const lead = this.lead();
    const ps = this.sides.player;
    if (lead && !isFainted(lead)) {
      const mx = maxHp(lead);
      if (lead.status === 'PSN') { this.damagePlayer(lead, Math.max(1, Math.floor(mx / 8))); this.msg(`${monName(lead)} is hurt by poison!`); }
      if (lead.status === 'TOX') { const st = this.ms(lead.uid); st.toxic = st.toxic || 1; this.damagePlayer(lead, Math.max(1, Math.floor(mx * Math.min(15, st.toxic) / 16))); st.toxic++; this.msg(`${monName(lead)} is hurt by poison!`); }
      if (lead.status === 'BRN') { this.damagePlayer(lead, Math.max(1, Math.floor(mx / 8))); this.msg(`${monName(lead)} is hurt by its burn!`); }
      if (ps.seeded && !isFainted(lead)) { this.damagePlayer(lead, Math.max(1, Math.floor(mx / 8))); this.healEnemy(1 / 10); this.msg(`${monName(lead)}'s health is sapped by LEECH SEED!`); }
      if (ps.trapped > 0 && !isFainted(lead)) { ps.trapped--; this.damagePlayer(lead, Math.max(1, Math.floor(mx / 16))); }
      if (ps.cursed && !isFainted(lead)) this.damagePlayer(lead, Math.max(1, Math.floor(mx / 4)));
      if (ps.ingrain) this.healSide('player', lead, 1 / 16, 'INGRAIN', true);
      if (ps.wish > 0 && --ps.wish === 0) this.healSide('player', lead, 0.5, 'WISH');
      if (ps.yawn > 0 && --ps.yawn === 0) this.inflictStatus('player', 'SLP', 'YAWN', true);
      if (ps.perish > 0 && --ps.perish === 0) this.damagePlayer(lead, lead.hp);
      if (abilityOf(lead) === 'SPEED_BOOST') this.addStage('player', 'spe', 1, 'SPEED_BOOST');
      if (abilityOf(lead) === 'SHED_SKIN' && lead.status && this.rng.chance(0.3)) { lead.status = null; this.msg(`${monName(lead)} shed its skin!`); }
      if (abilityOf(lead) === 'RAIN_DISH' && this.weather === 'RAIN') this.healSide('player', lead, 1 / 16, 'RAIN_DISH', true);
      for (const [def, inst] of this.relicHooks('onTurnEnd')) def.onTurnEnd(this, inst.state);
    }
  }

  // Screens / counters on the player's side and sleep / recharge for the whole party.
  playerCounters() {
    const ps = this.sides.player;
    for (const k of ['reflect', 'lightScreen', 'safeguard', 'mist', 'taunt', 'uproar']) if (ps[k] > 0) ps[k]--;
    // Sleep counters & recharge for every party member (sleep ticks for benched mons too, it's friendlier).
    for (const m of this.run.party) {
      const st = this.ms(m.uid);
      if (m.status === 'SLP') {
        if (st.sleep > 0) st.sleep--;
        if (st.sleep <= 0) { m.status = null; this.msg(`${monName(m)} woke up!`); }
      }
      if (m.status === 'FRZ' && this.rng.chance(0.25)) { m.status = null; this.msg(`${monName(m)} thawed out!`); }
      if (st.recharge > 0) st.recharge--;
    }
    this.emit({ t: 'partyUpdate' });
  }

  // ---- catching / fleeing ---------------------------------------------------------------
  throwBall(ballKey) {
    if (this.result || this.kind !== 'wild') return [];
    if (!this.run.balls[ballKey]) return [];
    if (!this.canCatch()) { this.msg(this.catchBlockReason() || "You can't catch this POKéMON."); return this.takeEvents(); }
    if (this.ballAttempt(ballKey)) {
      this.end('caught');
      return this.takeEvents();
    }
    this.enemyAct();
    if (!this.result) this.endTurn();
    if (!this.result) this.startTurn();
    return this.takeEvents();
  }

  // Throws a ball at the current foe: true if it was caught (this.caught is set, the battle not ended yet).
  ballAttempt(ballKey) {
    this.run.balls[ballKey]--;
    this.ballsThrown++;
    const e = this.enemy();
    this.msg(`You threw a ${D.items[ballKey]?.name || 'BALL'}!`);
    const rate = (D.species[e.species].catchRate || 45);
    const bonus = ballBonus(ballKey, e, this);
    const statusB = e.status === 'SLP' || e.status === 'FRZ' ? 2 : e.status ? 1.5 : 1;
    const a = Math.floor(((3 * e.maxHp - 2 * e.hp) * rate * bonus) / (3 * e.maxHp) * statusB * (1 + (this.mods.catchBonus || 0)));
    let shakes = 0, caught = false;
    if (ballKey === 'MASTER_BALL' || a >= 255) { caught = true; shakes = 4; }
    else {
      const b = Math.floor(1048560 / Math.sqrt(Math.sqrt(16711680 / Math.max(1, a))));
      for (shakes = 0; shakes < 4; shakes++) if (this.rng.int(0, 65535) >= b) break;
      caught = shakes === 4;
    }
    this.emit({ t: 'ball', ball: ballKey, shakes: Math.min(3, shakes), caught });
    if (caught) {
      this.msg(`Gotcha! ${speciesName(e.species)} was caught!`);
      if (BALLS[ballKey]?.special === 'friend') { e.friend = true; this.msg(`${speciesName(e.species)} looks friendly! (+1 copy of its best move)`); } // (run.afterBattle)
      this.caught = e;
      this.defeated.push(e);
      return true;
    }
    this.msg(['Oh, no! The POKéMON broke free!', 'Aww! It appeared to be caught!', 'Aargh! Almost had it!', 'Shoot! It was so close, too!'][Math.min(3, shakes)]);
    return false;
  }

  // Probability a ball catches the current foe (Gen 3 formula), for the UI.
  catchChance(ballKey) {
    const e = this.enemy();
    if (!e || !ballKey) return 0;
    if (ballKey === 'MASTER_BALL') return 1;
    const rate = D.species[e.species].catchRate || 45;
    const statusB = e.status === 'SLP' || e.status === 'FRZ' ? 2 : e.status ? 1.5 : 1;
    const a = Math.floor(((3 * e.maxHp - 2 * e.hp) * rate * ballBonus(ballKey, e, this)) / (3 * e.maxHp) * statusB * (1 + (this.mods.catchBonus || 0)));
    if (a >= 255) return 1;
    const bb = Math.floor(1048560 / Math.sqrt(Math.sqrt(16711680 / Math.max(1, a))));
    return Math.pow(Math.min(1, bb / 65536), 4);
  }

  canFlee() { return this.kind === 'wild' && !this.enemy().isBoss; }

  flee() {
    if (!this.canFlee() || this.result) return [];
    const lead = this.lead(), e = this.enemy();
    this.fleeAttempts++;
    const ok = this.mods.canFlee || abilityOf(lead) === 'RUN_AWAY' ||
      ((this.speedOf('player') * 128 / Math.max(1, this.speedOf('enemy')) + 30 * this.fleeAttempts) % 256) > this.rng.int(0, 255) ||
      this.speedOf('player') >= this.speedOf('enemy');
    if (ok && !this.sides.player.meanLook && e.ability !== 'ARENA_TRAP' && e.ability !== 'SHADOW_TAG') {
      this.msg('Got away safely!');
      this.end('fled');
      return this.takeEvents();
    }
    this.msg("Can't escape!");
    this.enemyAct();
    if (!this.result) this.endTurn();
    if (!this.result) this.startTurn();
    return this.takeEvents();
  }

  // ---- end ------------------------------------------------------------------------------
  end(outcome) {
    if (this.result) return;
    const won = outcome === 'win' || outcome === 'caught';
    let exp = 0, money = 0;
    const foes = []; // per defeated foe: its level and EXP (run.distributeExp scales each recipient's share by level)
    if (won) {
      for (const e of this.defeated) if (!e.noExp) { const x = expYield(e.species, e.level, this.kind !== 'wild'); exp += x; foes.push({ level: e.level, exp: x }); }
      const act = this.run.actIndex;
      if (this.kind === 'wild') money = (TUNING.wildPay + 10 * act) * (this.cfgElite ? 3 : 1);
      else {
        const classMoney = this.trainer?.money || 10;
        money = Math.round(TUNING.trainerPay * (act + 1) * Math.max(0.7, Math.min(1.6, classMoney / 15)) * (this.kind === 'elite' ? 2 : this.kind === 'boss' ? 4 : 1));
        if (this.mods.trainerMoney) money = Math.floor(money * (1 + this.mods.trainerMoney));
        if (this.kind === 'elite' && this.mods.eliteMoney) money *= 2;
      }
      money = Math.floor(money * (1 + (this.mods.moneyMult || 0)));
      money += Math.min(this.payDay, 20 * Math.max(...this.run.party.map(m => m.level)));
    }
    // Clear battle-only statuses on party (sleep/confusion persist? sleep does in the games; we wake them for flow)
    for (const m of this.run.party) { if (m.status === 'SLP' || m.status === 'FRZ') m.status = null; }
    // fainted: POKéMON fainted when the battle ended get no EXP (Gen 3), even if something revives them before the
    // EXP is paid (co-op revives a downed player's lead at the end of a won battle: DuoBattle.finish sets faintedAtEnd)
    const fainted = this.faintedAtEnd || this.run.party.filter(isFainted).map(m => m.uid);
    this.result = { outcome, exp, foes, money, caught: this.caught || null, fainted, participants: [...this.participants].filter(u => !fainted.includes(u) && this.run.party.some(m => m.uid === u && !isFainted(m))) };
    this.emit({ t: 'end', outcome, exp, money });
  }
}

// ---- KURT's APRICORN BALLS (items.js BALLS[k].apricorn): catch-rate multipliers from the foe, your lead and the
// terrain. They change who joins, never damage. (The FRIEND BALL's +1 copy is applied when the catch joins.)
let MOON_FAMILY = null;
function moonFamily() {
  if (MOON_FAMILY) return MOON_FAMILY;
  const set = new Set();
  for (const s of Object.values(D.species)) for (const ev of s.evolutions || []) if (ev.param === 'MOON_STONE') { set.add(s.key); set.add(ev.into); }
  for (const s of Object.values(D.species)) for (const ev of s.evolutions || []) if (set.has(ev.into)) set.add(s.key); // (CLEFFA, IGGLYBUFF...)
  return (MOON_FAMILY = set);
}
function familyRoot(sp) { let k = sp, n = 0; while (D.species[k]?.preEvolution && n++ < 4) k = D.species[k].preEvolution; return k; }
export function apricornRate(special, target, battle) {
  const s = D.species[target.species] || {};
  const lead = battle?.lead?.();
  switch (special) {
    case 'fast': return (s.stats?.spe || 0) >= 100 ? 3 : 1;
    case 'level': { if (!lead) return 1; const L = lead.level, f = target.level; return L >= 2 * f ? 4 : L >= f + 10 ? 3 : L > f ? 2 : 1; }
    case 'lure': return battle?.terrain === 'water' ? 3 : (target.types || []).includes('WATER') ? 1.5 : 1;
    case 'heavy': { const kg = (s.weight || 0) / 10; return kg >= 300 ? 4 : kg >= 200 ? 3 : kg >= 100 ? 2 : 1; }
    case 'love': return !lead ? 1 : lead.species === target.species ? 3 : familyRoot(lead.species) === familyRoot(target.species) ? 2 : 1;
    case 'moon': return moonFamily().has(target.species) ? 4 : 1;
    default: return 1; // 'friend'
  }
}
export const ballBonus = (ballKey, target, battle) => (BALLS[ballKey]?.apricorn ? apricornRate(BALLS[ballKey].special, target, battle) : ballRate(ballKey, target, battle));

function isFainted2(mon) { return mon.hp <= 0; }
