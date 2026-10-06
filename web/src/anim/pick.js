// Which FireRed move animation a played hand shows (pure logic, no DOM: tested in tests/logic.test.mjs).
//
// Rule (owner, v0.2.0): one animation per hand. Attack cards always beat status cards. Among attacks, the one
// with the highest effective power: the DMG number shown at the bottom of the card ("28 DMG"); ties go to the
// leftmost card. A hand of only status cards shows the leftmost status card.

// Status notability tiers (lower = more notable), by move effect.
const STATUS_TIERS = [
  ['SLEEP', 'YAWN', 'PARALYZE', 'TOXIC', 'WILL_O_WISP', 'POISON', 'CONFUSE', 'ATTRACT', 'SWAGGER', 'FLATTER', 'TEETER_DANCE'],
  ['ATTACK_UP_2', 'SPECIAL_ATTACK_UP_2', 'SPEED_UP_2', 'DEFENSE_UP_2', 'SPECIAL_DEFENSE_UP_2', 'DRAGON_DANCE', 'CALM_MIND', 'BULK_UP', 'COSMIC_POWER', 'BELLY_DRUM', 'LEECH_SEED', 'SUBSTITUTE', 'CURSE'],
  ['RESTORE_HP', 'SOFTBOILED', 'MORNING_SUN', 'SYNTHESIS', 'MOONLIGHT', 'REST', 'WISH', 'INGRAIN', 'SWALLOW', 'HEAL_BELL', 'REFRESH'],
  ['ATTACK_DOWN_2', 'DEFENSE_DOWN_2', 'SPEED_DOWN_2', 'SPECIAL_DEFENSE_DOWN_2', 'TICKLE', 'MEMENTO'],
  ['RAIN_DANCE', 'SUNNY_DAY', 'SANDSTORM', 'HAIL', 'REFLECT', 'LIGHT_SCREEN', 'SAFEGUARD', 'MIST', 'SPIKES', 'PROTECT', 'ENDURE'],
  ['ATTACK_UP', 'DEFENSE_UP', 'SPECIAL_ATTACK_UP', 'DEFENSE_CURL', 'STOCKPILE', 'CHARGE', 'FOCUS_ENERGY', 'EVASION_UP', 'MINIMIZE'],
  ['ATTACK_DOWN', 'DEFENSE_DOWN', 'SPEED_DOWN', 'ACCURACY_DOWN', 'EVASION_DOWN'],
];
export function statusTier(effect) {
  for (let i = 0; i < STATUS_TIERS.length; i++) {
    const j = STATUS_TIERS[i].indexOf(effect);
    if (j >= 0) return i + j / 100; // within a tier, earlier in the list = more notable (SLEEP > PARALYZE > ...)
  }
  return STATUS_TIERS.length; // everything else
}

// cards: [{ id, move (key), status (bool), dmg (the card's DMG number) }] in hand order.
// Returns the chosen card (or null for an empty hand).
export function pickHandAnim(cards) {
  const list = (cards || []).map((c, i) => ({ c, i }));
  if (!list.length) return null;
  const attacks = list.filter(x => !x.c.status);
  if (attacks.length) {
    attacks.sort((a, b) => (b.c.dmg || 0) - (a.c.dmg || 0) || a.i - b.i);
    return attacks[0].c;
  }
  return list[0].c; // status-only hand: the leftmost card
}

// ---- fallbacks ------------------------------------------------------------------------------------
// Gen 4 moves (gen4_moves.js) have no FireRed animation: reuse the closest-looking Gen 3 one.
export const GEN4_ANIM = {
  SHADOW_CLAW: 'SLASH', NIGHT_SLASH: 'SLASH', PSYCHO_CUT: 'AIR_CUTTER', STONE_EDGE: 'ROCK_TOMB', CROSS_POISON: 'POISON_TAIL',
  POISON_JAB: 'POISON_STING', GUNK_SHOT: 'SLUDGE_BOMB', X_SCISSOR: 'FURY_CUTTER', SEED_BOMB: 'BULLET_SEED', AQUA_TAIL: 'CRABHAMMER',
  DRAGON_PULSE: 'DRAGON_BREATH', POWER_GEM: 'ANCIENT_POWER', POWER_WHIP: 'VINE_WHIP', PLUCK: 'PECK', BUG_BITE: 'BITE',
  DARK_PULSE: 'SHADOW_BALL', AIR_SLASH: 'AIR_CUTTER', ZEN_HEADBUTT: 'HEADBUTT', IRON_HEAD: 'HEADBUTT', DRAGON_RUSH: 'TAKE_DOWN',
  BUG_BUZZ: 'HYPER_VOICE', ENERGY_BALL: 'SHADOW_BALL', EARTH_POWER: 'EARTHQUAKE', FLASH_CANNON: 'HYPER_BEAM', FOCUS_BLAST: 'ZAP_CANNON',
  MUD_BOMB: 'MUD_SHOT', MIRROR_SHOT: 'FLASH', ROCK_CLIMB: 'TAKE_DOWN', DISCHARGE: 'SPARK', FORCE_PALM: 'ARM_THRUST',
  LAVA_PLUME: 'HEAT_WAVE', FIRE_FANG: 'BITE', ICE_FANG: 'BITE', THUNDER_FANG: 'BITE', OMINOUS_WIND: 'SILVER_WIND',
  CHARGE_BEAM: 'THUNDERBOLT', AURA_SPHERE: 'ZAP_CANNON', MAGNET_BOMB: 'EGG_BOMB', DOUBLE_HIT: 'DOUBLE_SLAP', DRAIN_PUNCH: 'ABSORB',
  GRASS_KNOT: 'VINE_WHIP', BRINE: 'WATER_GUN', BULLET_PUNCH: 'MACH_PUNCH', ICE_SHARD: 'ICICLE_SPEAR', SHADOW_SNEAK: 'FAINT_ATTACK',
  AQUA_JET: 'QUICK_ATTACK', VACUUM_WAVE: 'MACH_PUNCH', SUCKER_PUNCH: 'FAINT_ATTACK', PAYBACK: 'REVENGE', AVALANCHE: 'ROCK_SLIDE',
  BRAVE_BIRD: 'SKY_ATTACK', WOOD_HAMMER: 'SLAM', FLARE_BLITZ: 'FLAME_WHEEL', HEAD_SMASH: 'SKULL_BASH', CLOSE_COMBAT: 'CROSS_CHOP',
  HAMMER_ARM: 'KARATE_CHOP', DRACO_METEOR: 'DOOM_DESIRE', LEAF_STORM: 'RAZOR_LEAF', GIGA_IMPACT: 'DOUBLE_EDGE', U_TURN: 'QUICK_ATTACK',
  ROOST: 'RECOVER', ROCK_POLISH: 'AGILITY', NASTY_PLOT: 'AMNESIA',
};
// SECRET_POWER plays another move's animation by terrain, like the game does.
export const SECRET_POWER_BY_TERRAIN = { grass: 'NEEDLE_ARM', tallgrass: 'MAGICAL_LEAF', cave: 'BITE', water: 'SURF', mountain: 'ROCK_THROW', building: 'STRENGTH' };
// Last resort per type (attacks: physical first, then special) and per status effect family.
export const TYPE_ANIM = {
  NORMAL: ['TACKLE', 'SWIFT', 'POUND'], FIRE: ['EMBER', 'FLAMETHROWER'], WATER: ['WATER_GUN', 'SURF'], GRASS: ['VINE_WHIP', 'RAZOR_LEAF', 'ABSORB'],
  ELECTRIC: ['THUNDER_SHOCK', 'THUNDERBOLT'], ICE: ['ICE_BEAM', 'POWDER_SNOW'], FIGHTING: ['KARATE_CHOP', 'LOW_KICK'], POISON: ['POISON_STING', 'SLUDGE'],
  GROUND: ['EARTHQUAKE', 'MUD_SLAP'], FLYING: ['PECK', 'GUST'], PSYCHIC: ['PSYCHIC', 'CONFUSION'], BUG: ['LEECH_LIFE', 'FURY_CUTTER'],
  ROCK: ['ROCK_THROW', 'ROCK_SLIDE'], GHOST: ['ASTONISH', 'LICK', 'SHADOW_BALL'], DRAGON: ['DRAGON_CLAW', 'DRAGON_RAGE', 'TWISTER'], DARK: ['BITE', 'CRUNCH'], STEEL: ['METAL_CLAW', 'IRON_TAIL'],
};
export function statusFallback(effect) {
  const t = statusTier(effect);
  if (/SLEEP|YAWN/.test(effect)) return ['SLEEP_POWDER', 'HYPNOSIS'];
  if (/PARALYZE/.test(effect)) return ['THUNDER_WAVE'];
  if (/POISON|TOXIC/.test(effect)) return ['POISON_POWDER', 'TOXIC'];
  if (/CONFUSE|SWAGGER|FLATTER|TEETER|ATTRACT/.test(effect)) return ['SUPERSONIC', 'CONFUSE_RAY', 'PSYCHIC'];
  if (/ACCURACY_DOWN|EVASION_DOWN/.test(effect)) return ['SAND_ATTACK'];
  if (/ATTACK_DOWN/.test(effect)) return ['GROWL'];
  if (/DOWN/.test(effect)) return ['LEER', 'TAIL_WHIP'];
  if (/ATTACK_UP|DRAGON_DANCE|BULK_UP|BELLY_DRUM/.test(effect)) return ['SWORDS_DANCE'];
  if (t <= 6) return ['HARDEN', 'SWORDS_DANCE'];
  return ['HARDEN', 'GROWL'];
}

// The move whose animation to play for `key`: itself if playable, else an alias / Gen 4 mapping / per-type or
// per-effect stand-in. canPlay(key) says whether a FireRed script is available and fully ported.
export function resolveAnimMove(key, { canPlay, move, terrain } = {}) {
  const tried = [];
  const ok = (k) => { if (!k || tried.includes(k)) return false; tried.push(k); return canPlay(k); };
  if (key === 'SECRET_POWER') { const k = SECRET_POWER_BY_TERRAIN[terrain] || 'STRENGTH'; if (ok(k)) return { key: k, via: 'terrain' }; }
  if (ok(key)) return { key, via: 'own' };
  if (GEN4_ANIM[key] && ok(GEN4_ANIM[key])) return { key: GEN4_ANIM[key], via: 'gen4' };
  const isStatus = move ? !move.power && !['FIXED', 'OHKO'].includes(move.effect) : false;
  const cands = isStatus ? statusFallback(move?.effect || '') : (TYPE_ANIM[move?.type] || []);
  for (const k of cands) if (ok(k)) return { key: k, via: isStatus ? 'status' : 'type' };
  for (const k of isStatus ? ['HARDEN', 'GROWL'] : ['TACKLE', 'POUND']) if (ok(k)) return { key: k, via: 'generic' };
  return null;
}

// Animation speed (GBA frames per 60 Hz frame), owner's v0.2.2 choice: solo at the GBA's own timing (2x with FAST
// ANIMATIONS), co-op twice as fast as solo so 2-4 hands a turn stay snappy.
export const ANIM_SPEED = { normal: 1, fast: 2, coop: 2, coopFast: 4 };

// Order of a played hand on screen (owner, after v0.2.2): cards revealed -> the scoring count-up (combo, per-card DMG,
// total) -> the move animation -> the damage lands on the foe. The scenes mark the hand's 'total' event and play the
// animation as the next event comes up (normally the foe's HP drop). On a turn where the foe moves first, the cards
// are revealed only after the foe's move has played out (see orderTurnEvents).
// (HAND_START_EVENTS: the events that start a hand's scoring, where orderTurnEvents puts the delayed reveal.)
export const HAND_START_EVENTS = new Set(['combo', 'card', 'flat', 'bonus', 'times', 'total']);
// Solo: the battle engine emits 'play' (cards leave the hand) before a faster foe's move; show the reveal after
// the foe's move instead, just before the hand starts scoring. Returns a new array; other events keep their order.
export function orderTurnEvents(evs) {
  const pi = evs.findIndex(e => e.t === 'play');
  if (pi < 0 || evs[pi + 1]?.t !== 'foeFirst') return evs;
  const out = evs.slice(); const [play] = out.splice(pi, 1);
  let hi = out.findIndex((e, i) => i > pi && HAND_START_EVENTS.has(e.t));
  if (hi < 0) hi = out.findIndex((e, i) => i > pi && ['turn', 'end'].includes(e.t));
  out.splice(hi < 0 ? out.length : hi, 0, play);
  return out;
}
