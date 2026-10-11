// Abilities (PROTOTYPE, branch 'abilities': docs/ABILITIES_PROPOSAL.md). Every ability does something here.
//
// What lives where:
//   battle.js       the in-battle effects (damage multipliers in hitCore / hitDamage / enemyDamage, triggers on hit,
//                   on entry, at the end of the turn, status / stage / accuracy hooks). Battle.abOf(side, mon) is the
//                   one lookup: it sees TRACE copies (sides[side].traced) for the player.
//   effectiveness() (battle.js) the defensive type-matchup abilities (immunities, THICK FAT / HEATPROOF / FILTER...).
//   run.js          the field abilities (partyAbilityMods below, folded into Run.mods()).
//   this file       the shared tables and every ability's in-game text (ABILITY_TEXT replaces text_overrides.js's
//                   ABILITY_DESC "No effect in battle here." entries; data.js applies it).
//
// Gen 4 abilities: the 31 HeartGold abilities of the Gen 4 species (gen4/species.json gen4Abilities) get D.abilities
// entries here (GEN4_ABILITIES) and the species use their HGSS lists (gen4.js applyGen4). A mon's ability is picked
// from its species list by its SPEED IV, so species whose list grows would change ability under old saves:
// LEGACY_GEN4_ABILITIES keeps the v0.4.6 lists for pinning (Run.upgradeJSON sets mon.ability on old mons).

// Sound-based moves (SOUNDPROOF / CACOPHONY block them).
export const SOUND_MOVES = new Set(['GROWL', 'ROAR', 'SING', 'SUPERSONIC', 'SCREECH', 'SNORE', 'UPROAR', 'METAL_SOUND', 'GRASS_WHISTLE',
  'HYPER_VOICE', 'PERISH_SONG', 'BUG_BUZZ', 'CHATTER']);

// Absorbing abilities: [type absorbed, what absorbing does]. heal = 25% max HP, flash = its FIRE moves x1.5 while it
// stays in, spa / spe = +1 stage. (The immunity itself is in effectiveness().)
export const ABSORB = {
  VOLT_ABSORB: ['ELECTRIC', 'heal'], WATER_ABSORB: ['WATER', 'heal'], DRY_SKIN: ['WATER', 'heal'], FLASH_FIRE: ['FIRE', 'flash'],
  LIGHTNING_ROD: ['ELECTRIC', 'spa'], STORM_DRAIN: ['WATER', 'spa'], MOTOR_DRIVE: ['ELECTRIC', 'spe'],
};
export const ABSORB_HEAL = 0.25;

// TRACE can't copy these.
export const TRACE_BAN = new Set(['TRACE', 'FORECAST', 'MULTITYPE', 'WONDER_GUARD']);
// Abilities that only defend: MOLD BREAKER ignores them on the target.
export const BREAKABLE = new Set(['LEVITATE', 'VOLT_ABSORB', 'WATER_ABSORB', 'FLASH_FIRE', 'WONDER_GUARD', 'THICK_FAT', 'STURDY', 'SHIELD_DUST',
  'BATTLE_ARMOR', 'SHELL_ARMOR', 'SOUNDPROOF', 'CACOPHONY', 'LIGHTNING_ROD', 'STORM_DRAIN', 'MOTOR_DRIVE', 'DRY_SKIN', 'HEATPROOF',
  'FILTER', 'SOLID_ROCK', 'MARVEL_SCALE', 'SAND_VEIL', 'SNOW_CLOAK', 'TANGLED_FEET', 'CLEAR_BODY', 'WHITE_SMOKE', 'HYPER_CUTTER',
  'KEEN_EYE', 'SUCTION_CUPS', 'STICKY_HOLD', 'DAMP', 'UNAWARE', 'SIMPLE', 'LEAF_GUARD', 'OWN_TEMPO', 'OBLIVIOUS', 'INNER_FOCUS',
  'INSOMNIA', 'VITAL_SPIRIT', 'IMMUNITY', 'LIMBER', 'WATER_VEIL', 'MAGMA_ARMOR', 'FLOWER_GIFT']);

// Type-boosting held items stand in for ARCEUS's plates (MULTITYPE).
export const PLATE_ITEMS = {
  CHARCOAL: 'FIRE', MYSTIC_WATER: 'WATER', MIRACLE_SEED: 'GRASS', MAGNET: 'ELECTRIC', NEVER_MELT_ICE: 'ICE', BLACK_BELT: 'FIGHTING',
  POISON_BARB: 'POISON', SOFT_SAND: 'GROUND', SHARP_BEAK: 'FLYING', TWISTED_SPOON: 'PSYCHIC', SILVER_POWDER: 'BUG', HARD_STONE: 'ROCK',
  SPELL_TAG: 'GHOST', DRAGON_FANG: 'DRAGON', BLACK_GLASSES: 'DARK', METAL_COAT: 'STEEL',
};

// ---- field abilities: party-wide run modifiers (Run.mods) ----
// Any POKéMON in the party that isn't fainted counts. PICKUP stacks (10% each, max 30%); the others don't.
export function partyAbilityMods(party, abilityOf) {
  const m = {};
  let pickup = 0;
  for (const mon of party || []) {
    if (!mon || mon.hp <= 0) continue;
    const a = abilityOf(mon);
    if (a === 'PICKUP') pickup++;
    else if (a === 'HONEY_GATHER') m.honey = 1;
    else if (a === 'ILLUMINATE') m.rareFindMult = 2;
    else if (a === 'MAGNET_PULL') m.steelLure = 3;
  }
  if (pickup) m.pickup = Math.min(0.3, 0.1 * pickup);
  return m;
}

// ---- Gen 4 abilities (HeartGold), new D.abilities entries ----
export const GEN4_ABILITIES = {
  SIMPLE: 'SIMPLE', UNAWARE: 'UNAWARE', RIVALRY: 'RIVALRY', MOLD_BREAKER: 'MOLD BREAKER', ANTICIPATION: 'ANTICIPATION',
  HONEY_GATHER: 'HONEY GATHER', FLOWER_GIFT: 'FLOWER GIFT', STORM_DRAIN: 'STORM DRAIN', TECHNICIAN: 'TECHNICIAN',
  AFTERMATH: 'AFTERMATH', UNBURDEN: 'UNBURDEN', KLUTZ: 'KLUTZ', SUPER_LUCK: 'SUPER LUCK', HEATPROOF: 'HEATPROOF',
  FILTER: 'FILTER', TANGLED_FEET: 'TANGLED FEET', STEADFAST: 'STEADFAST', SNIPER: 'SNIPER', DRY_SKIN: 'DRY SKIN',
  SNOW_WARNING: 'SNOW WARNING', SOLID_ROCK: 'SOLID ROCK', LEAF_GUARD: 'LEAF GUARD', MOTOR_DRIVE: 'MOTOR DRIVE',
  TINTED_LENS: 'TINTED LENS', SNOW_CLOAK: 'SNOW CLOAK', ADAPTABILITY: 'ADAPTABILITY', DOWNLOAD: 'DOWNLOAD',
  SLOW_START: 'SLOW START', HYDRATION: 'HYDRATION', BAD_DREAMS: 'BAD DREAMS', MULTITYPE: 'MULTITYPE',
};
// HGSS spells it LIGHTNINGROD; FireRed's key is LIGHTNING_ROD.
export const ABILITY_ALIAS = { LIGHTNINGROD: 'LIGHTNING_ROD' };

// The v0.4.6 in-game lists of the Gen 4 species whose list changes (for pinning old saves' mons).
export const LEGACY_GEN4_ABILITIES = {
  SHINX: ['INTIMIDATE'], LUXIO: ['INTIMIDATE'], LUXRAY: ['INTIMIDATE'], SHELLOS: ['STICKY_HOLD'], GASTRODON: ['STICKY_HOLD'],
  AMBIPOM: ['PICKUP'], BUNEARY: ['RUN_AWAY'], LOPUNNY: ['CUTE_CHARM'], HONCHKROW: ['INSOMNIA'], STUNKY: ['STENCH'], SKUNTANK: ['STENCH'],
  BRONZOR: ['LEVITATE'], BRONZONG: ['LEVITATE'], MIME_JR: ['SOUNDPROOF'], CHATOT: ['KEEN_EYE'], RIOLU: ['INNER_FOCUS'], LUCARIO: ['INNER_FOCUS'],
  SKORUPI: ['BATTLE_ARMOR'], DRAPION: ['BATTLE_ARMOR'], FINNEON: ['SWIFT_SWIM'], LUMINEON: ['SWIFT_SWIM'], RHYPERIOR: ['LIGHTNING_ROD'],
  TANGROWTH: ['CHLOROPHYLL'], YANMEGA: ['SPEED_BOOST'], MAMOSWINE: ['OBLIVIOUS'],
};

// ---- in-game text: what every ability does in this game ("it" = the POKéMON with the ability, yours or a foe) ----
export const ABILITY_TEXT = {
  // Gen 3
  STENCH: 'Once per hand, if its cards hit, 10% chance the foe flinches.',
  DRIZZLE: 'Summons rain for the whole battle when it comes out.',
  SPEED_BOOST: 'Its team\'s SPEED rises by 1 at the end of every turn.',
  BATTLE_ARMOR: 'Attacks never land a critical hit on it.',
  STURDY: 'Immune to one-hit KO moves. Your POKéMON with it also survive a hit from full HP.',
  DAMP: 'While it\'s out, nobody can use SELF-DESTRUCT or EXPLOSION, and AFTERMATH does nothing.',
  LIMBER: 'Prevents paralysis.',
  SAND_VEIL: 'In a sandstorm, attacks on it are 20% less accurate.',
  STATIC: '30% chance to paralyze a POKéMON that hits it with a contact move.',
  VOLT_ABSORB: 'ELECTRIC moves have no effect on it and heal it 25% instead (once per hand).',
  WATER_ABSORB: 'WATER moves have no effect on it and heal it 25% instead (once per hand).',
  OBLIVIOUS: 'Can\'t be infatuated, and INTIMIDATE doesn\'t affect it.',
  CLOUD_NINE: 'While it\'s out, weather has no effect (the weather still counts down).',
  COMPOUND_EYES: 'Its moves are 30% more accurate.',
  INSOMNIA: 'Prevents sleep.',
  COLOR_CHANGE: 'After an attack hits it, it becomes that attack\'s type (until it leaves).',
  IMMUNITY: 'Prevents poisoning.',
  FLASH_FIRE: 'FIRE moves have no effect on it; once hit by one, its own FIRE moves deal x1.5 (until it leaves).',
  SHIELD_DUST: 'Blocks the added effects (burns, flinches, stat drops...) of attacks that hit it.',
  OWN_TEMPO: 'Prevents confusion.',
  SUCTION_CUPS: 'ROAR and WHIRLWIND fail on it. Your POKéMON with it: its cards can\'t be frozen or turned face-down.',
  INTIMIDATE: 'Lowers the foe\'s ATTACK by 1 when it comes out.',
  SHADOW_TAG: 'Foe with it: you can\'t run, and switching costs 1 extra discard. Yours in the lead: wild POKéMON are 50% easier to catch.',
  ROUGH_SKIN: 'A POKéMON that hits it with a contact move loses 1/16 of its HP.',
  WONDER_GUARD: 'Only super-effective attacks can hit it.',
  LEVITATE: 'GROUND attacks have no effect on it.',
  EFFECT_SPORE: '10% chance to poison, paralyze or put to sleep a POKéMON that hits it with a contact move.',
  SYNCHRONIZE: 'When it is poisoned, burned or paralyzed, the foe gets the same status.',
  CLEAR_BODY: 'The foe can\'t lower its stats.',
  NATURAL_CURE: 'Cures its status problem when you switch it out.',
  LIGHTNING_ROD: 'ELECTRIC moves have no effect on it and raise its SP. ATK by 1 instead (once per hand).',
  SERENE_GRACE: 'The added effects of its attacks are twice as likely (flinching excepted).',
  SWIFT_SWIM: 'Doubles its SPEED in rain.',
  CHLOROPHYLL: 'Doubles its SPEED in sunshine.',
  ILLUMINATE: 'Field: with it in your party, rare finds are twice as common in wild battles.',
  TRACE: 'Copies the foe\'s ability when it comes out (until it leaves).',
  HUGE_POWER: 'Doubles its ATTACK.',
  POISON_POINT: '30% chance to poison a POKéMON that hits it with a contact move.',
  INNER_FOCUS: 'It never flinches, and INTIMIDATE doesn\'t affect it.',
  MAGMA_ARMOR: 'Prevents freezing.',
  WATER_VEIL: 'Prevents burns.',
  MAGNET_PULL: 'Field: with it in your party, STEEL POKéMON are 3x as common in the wild. Foe with it: a STEEL lead can\'t run.',
  SOUNDPROOF: 'Sound-based moves (GROWL, SING, SCREECH, PERISH SONG, HYPER VOICE...) have no effect on it.',
  RAIN_DISH: 'Heals 1/16 of its HP each turn in rain.',
  SAND_STREAM: 'Summons a sandstorm for the whole battle when it comes out.',
  PRESSURE: 'Foe with it: you start the battle with 1 fewer discard. Yours in the lead: the foe can\'t use the same move twice in a row.',
  THICK_FAT: 'Takes half damage from FIRE and ICE moves.',
  EARLY_BIRD: 'Wakes up twice as fast.',
  FLAME_BODY: '30% chance to burn a POKéMON that hits it with a contact move.',
  RUN_AWAY: 'With it in the lead, you always get away from wild battles (unless trapped).',
  KEEN_EYE: 'The foe can\'t lower its accuracy.',
  HYPER_CUTTER: 'The foe can\'t lower its ATTACK.',
  PICKUP: 'Field: after each won battle, 10% chance to find an item (each POKéMON with PICKUP adds 10%, max 30%).',
  TRUANT: 'It can only act every other turn.',
  HUSTLE: 'Its physical moves deal x1.5 damage but are 20% less accurate.',
  CUTE_CHARM: '30% chance to infatuate a POKéMON that hits it with a contact move (not bosses, elites or legendaries).',
  PLUS: 'Special moves deal x1.5 if another POKéMON in your party (or your partner\'s lead) has PLUS or MINUS.',
  MINUS: 'Special moves deal x1.5 if another POKéMON in your party (or your partner\'s lead) has PLUS or MINUS.',
  FORECAST: 'Becomes FIRE type in sunshine, WATER in rain and ICE in hail.',
  STICKY_HOLD: 'Foe with it: THIEF, COVET and KNOCK OFF do nothing to it. Yours: bag items used on it in battle have a 20% chance to not be used up.',
  SHED_SKIN: '30% chance to cure its status problem at the end of each turn.',
  GUTS: 'With a status problem, its physical moves deal x1.5 and ignore the burn penalty.',
  MARVEL_SCALE: 'With a status problem, it takes 1/3 less damage from physical moves.',
  LIQUID_OOZE: 'Draining it (ABSORB, GIGA DRAIN, LEECH SEED...) hurts the drainer instead of healing it.',
  OVERGROW: 'Its GRASS moves deal x1.5 when it has 1/3 of its HP or less.',
  BLAZE: 'Its FIRE moves deal x1.5 when it has 1/3 of its HP or less.',
  TORRENT: 'Its WATER moves deal x1.5 when it has 1/3 of its HP or less.',
  SWARM: 'Its BUG moves deal x1.5 when it has 1/3 of its HP or less.',
  ROCK_HEAD: 'It takes no recoil damage.',
  DROUGHT: 'Summons harsh sunlight for the whole battle when it comes out.',
  ARENA_TRAP: 'Foe with it: you can\'t run, and switching a grounded lead costs 1 extra discard. Yours in the lead: wild POKéMON that aren\'t FLYING or levitating are 50% easier to catch.',
  VITAL_SPIRIT: 'Prevents sleep.',
  WHITE_SMOKE: 'The foe can\'t lower its stats.',
  PURE_POWER: 'Doubles its ATTACK.',
  SHELL_ARMOR: 'Attacks never land a critical hit on it.',
  CACOPHONY: 'Sound-based moves have no effect on it.',
  AIR_LOCK: 'While it\'s out, weather has no effect (the weather still counts down).',
  // Gen 4
  SIMPLE: 'Every stat change on its side is doubled while it\'s out.',
  UNAWARE: 'Ignores the foe\'s stat changes, attacking and defending.',
  RIVALRY: 'Its moves deal x1.25 against foes that share a type with it.',
  MOLD_BREAKER: 'Its attacks ignore the target\'s defensive ability (LEVITATE, WONDER GUARD, STURDY, the absorbs...).',
  ANTICIPATION: 'Yours: when the foe\'s next attack is super effective on it, switching this turn is free. Foe with it: your first super-effective hand deals x0.75.',
  HONEY_GATHER: 'Field: with it in your party, 20% chance to find a berry after each won battle.',
  FLOWER_GIFT: 'In sunshine, its team\'s physical moves deal x1.5 and it takes 1/3 less damage from special moves.',
  STORM_DRAIN: 'WATER moves have no effect on it and raise its SP. ATK by 1 instead (once per hand).',
  TECHNICIAN: 'Its moves of 60 power or less deal x1.5.',
  AFTERMATH: 'When a contact move knocks it out, the attacker loses 1/4 of its max HP (bosses 1/10).',
  UNBURDEN: 'Yours: after you use a bag item on your lead in battle, its SPEED doubles until it leaves. Foe with it: its SPEED doubles below half HP.',
  KLUTZ: 'Its cards get no bonus from held items, but deal x1.5 damage.',
  SUPER_LUCK: 'Its moves land critical hits more often (+1 stage).',
  HEATPROOF: 'Takes half damage from FIRE moves and from its burn.',
  FILTER: 'Super-effective attacks deal 1/4 less damage to it.',
  TANGLED_FEET: 'While it\'s confused, attacks on it are half as accurate.',
  STEADFAST: 'When something makes it flinch, its team\'s SPEED rises by 1.',
  SNIPER: 'Its critical hits deal one more x damage (x3 instead of x2).',
  DRY_SKIN: 'WATER moves heal it 25% instead of hurting (once per hand); FIRE moves deal x1.25. Heals 1/8 each turn in rain, loses 1/8 in sunshine.',
  SNOW_WARNING: 'Summons hail for the whole battle when it comes out.',
  SOLID_ROCK: 'Super-effective attacks deal 1/4 less damage to it.',
  LEAF_GUARD: 'Can\'t get a status problem in sunshine.',
  MOTOR_DRIVE: 'ELECTRIC moves have no effect on it and raise its SPEED by 1 instead (once per hand).',
  TINTED_LENS: 'Its not-very-effective moves deal double damage.',
  SNOW_CLOAK: 'In hail, attacks on it are 20% less accurate.',
  ADAPTABILITY: 'Its same-type moves deal x2 instead of x1.5.',
  DOWNLOAD: 'Once per battle when it comes out: +1 ATTACK if the foe\'s DEFENSE is lower than its SP. DEF, else +1 SP. ATK.',
  SLOW_START: 'For its first 3 turns out, it deals half damage and its SPEED is halved.',
  HYDRATION: 'Cures its status problem at the end of each turn in rain.',
  BAD_DREAMS: 'A sleeping foe loses 1/8 of its HP each turn (tough foes 1/12).',
  MULTITYPE: 'Yours: takes the type of your first type-boosting held item (CHARCOAL = FIRE...). Foe with it: takes the type of the move it\'s about to use.',
};
