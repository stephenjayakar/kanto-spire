// Abilities (v0.5.0: docs/ABILITIES_PROPOSAL.md). Every ability does something here.
//
// What lives where:
//   battle.js       the in-battle effects (damage multipliers in hitCore / hitDamage / enemyDamage, triggers on hit,
//                   on entry, at the end of the turn, status / stage / accuracy hooks). Battle.abOf(side, mon) is the
//                   one lookup: it sees TRACE copies (sides[side].traced) for the player.
//   effectiveness() (battle.js) the defensive type-matchup abilities (immunities, THICK FAT / HEATPROOF / FILTER...).
//   run.js          the field abilities (partyAbilityMods below, folded into Run.mods()).
//   this file       the shared tables and every ability's in-game text (ABILITY_TEXT; data.js applies it over
//                   text_overrides.js's old ABILITY_DESC, now empty).
//   tests/abilities_coverage.test.mjs fails if an ability has no text or no code: add both for a new ability.
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
  STENCH: 'Once per hand, if its cards hit, a 10% chance to make the foe flinch.',
  DRIZZLE: 'Starts rain for the whole battle when it comes out.',
  SPEED_BOOST: "Your team's SPEED goes up at the end of every turn.",
  BATTLE_ARMOR: "Can't take critical hits.",
  STURDY: 'Immune to one-hit KO moves. Yours also survive any hit from full HP.',
  DAMP: "While it's out, nobody can use SELF-DESTRUCT or EXPLOSION, and AFTERMATH does nothing.",
  LIMBER: "Can't be paralyzed.",
  SAND_VEIL: 'In a sandstorm, attacks against it miss more often.',
  STATIC: 'When something touches it, 30% chance to paralyze the attacker (once per hand).',
  VOLT_ABSORB: 'ELECTRIC attacks do nothing to it and heal it a quarter of its HP instead.',
  WATER_ABSORB: 'WATER attacks do nothing to it and heal it a quarter of its HP instead.',
  OBLIVIOUS: 'Immune to ATTRACT, CUTE CHARM and INTIMIDATE.',
  CLOUD_NINE: "While it's out, weather does nothing.",
  COMPOUND_EYES: 'Its moves are 30% more accurate.',
  INSOMNIA: "Can't fall asleep.",
  COLOR_CHANGE: 'Becomes the type of the last attack that hit it.',
  IMMUNITY: "Can't be poisoned.",
  FLASH_FIRE: 'FIRE attacks do nothing to it. Taking one makes its own FIRE attacks 50% stronger.',
  SHIELD_DUST: "Side effects of attacks (burns, flinching, stat drops...) don't happen to it.",
  OWN_TEMPO: "Can't be confused.",
  SUCTION_CUPS: "ROAR and WHIRLWIND can't force it out. Yours: boss rules can't freeze its cards or flip them face-down.",
  INTIMIDATE: "Lowers the foe's ATTACK when it comes out.",
  SHADOW_TAG: "Enemy: you can't run, and switching costs an extra discard. Yours in the lead: wild POKéMON are 50% easier to catch.",
  ROUGH_SKIN: 'When something touches it, the attacker loses 1/16 of its HP (once per hand).',
  WONDER_GUARD: 'Only super-effective attacks can hurt it.',
  LEVITATE: "GROUND attacks don't hit it.",
  EFFECT_SPORE: 'When something touches it, 10% chance to poison, paralyze or put the attacker to sleep (once per hand).',
  SYNCHRONIZE: 'If it gets poisoned, burned or paralyzed, the foe gets it too.',
  CLEAR_BODY: "The foe can't lower its stats.",
  NATURAL_CURE: 'Its status problem is cured when you switch it out.',
  LIGHTNING_ROD: "ELECTRIC attacks do nothing to it and raise its SP. ATK instead. In co-op it pulls the foes' ELECTRIC attacks onto itself.",
  SERENE_GRACE: 'Side effects of its attacks (burn, paralysis, stat drops...) happen twice as often, except flinching.',
  SWIFT_SWIM: 'Twice as fast in rain.',
  CHLOROPHYLL: 'Twice as fast in sunshine.',
  ILLUMINATE: 'With it in your party, rare POKéMON show up twice as often in wild battles.',
  TRACE: "Copies the foe's ability when it comes out.",
  HUGE_POWER: 'Doubles its ATTACK.',
  POISON_POINT: 'When something touches it, 30% chance to poison the attacker (once per hand).',
  INNER_FOCUS: "Never flinches, and INTIMIDATE doesn't affect it.",
  MAGMA_ARMOR: "Can't be frozen.",
  WATER_VEIL: "Can't be burned.",
  MAGNET_PULL: "With it in your party, STEEL POKéMON show up 3x as often in the wild. Enemy: your STEEL lead can't run away.",
  SOUNDPROOF: "Sound moves (GROWL, SING, SCREECH, SUPERSONIC, PERISH SONG...) don't affect it.",
  RAIN_DISH: 'Heals a little every turn in rain.',
  SAND_STREAM: 'Starts a sandstorm for the whole battle when it comes out.',
  PRESSURE: "Enemy: you start the battle with one fewer discard. Yours in the lead: the foe can't use the same move two turns in a row.",
  THICK_FAT: 'Half damage from FIRE and ICE attacks.',
  EARLY_BIRD: 'Wakes up twice as fast.',
  FLAME_BODY: 'When something touches it, 30% chance to burn the attacker (once per hand).',
  RUN_AWAY: 'With it in the lead, you always get away from wild battles (unless trapped).',
  KEEN_EYE: "The foe can't lower its accuracy.",
  HYPER_CUTTER: "The foe can't lower its ATTACK.",
  PICKUP: 'After each won battle, 10% chance to find an item (each POKéMON with PICKUP adds 10%, up to 30%).',
  TRUANT: 'Can only act every other turn.',
  HUSTLE: 'Its physical attacks are 50% stronger but miss more often.',
  CUTE_CHARM: 'When something touches it, 30% chance to make the attacker fall in love (once per hand; bosses are immune).',
  PLUS: "Special cards do 50% more if another POKéMON with PLUS or MINUS is on your team (or is your co-op partner's lead).",
  MINUS: "Special cards do 50% more if another POKéMON with PLUS or MINUS is on your team (or is your co-op partner's lead).",
  FORECAST: 'Changes type with the weather: FIRE in sunshine, WATER in rain, ICE in hail.',
  STICKY_HOLD: "Yours: 20% chance a bag item used on it isn't used up. Enemy: your THIEF can't take money from it, and KNOCK OFF doesn't remove its screens.",
  SHED_SKIN: '30% chance each turn to cure its own status problem.',
  GUTS: "With a status problem, its physical attacks are 50% stronger (and a burn doesn't weaken them).",
  MARVEL_SCALE: 'With a status problem, it takes a third less damage from physical attacks.',
  LIQUID_OOZE: 'Moves that drain its HP (ABSORB, GIGA DRAIN, LEECH SEED) hurt the attacker instead of healing it.',
  OVERGROW: 'Its GRASS attacks are 50% stronger when it has a third of its HP or less.',
  BLAZE: 'Its FIRE attacks are 50% stronger when it has a third of its HP or less.',
  TORRENT: 'Its WATER attacks are 50% stronger when it has a third of its HP or less.',
  SWARM: 'Its BUG attacks are 50% stronger when it has a third of its HP or less.',
  ROCK_HEAD: 'No recoil from moves like DOUBLE-EDGE.',
  DROUGHT: 'Starts harsh sunshine for the whole battle when it comes out.',
  ARENA_TRAP: "Enemy: you can't run, and switching costs an extra discard (not for FLYING or levitating leads). Yours in the lead: wild POKéMON are 50% easier to catch.",
  VITAL_SPIRIT: "Can't fall asleep.",
  WHITE_SMOKE: "The foe can't lower its stats.",
  PURE_POWER: 'Doubles its ATTACK.',
  SHELL_ARMOR: "Can't take critical hits.",
  CACOPHONY: "Sound moves don't affect it.",
  AIR_LOCK: "While it's out, weather does nothing.",
  // Gen 4
  SIMPLE: 'Every stat change on its side counts double.',
  UNAWARE: "Ignores the other side's stat changes.",
  RIVALRY: '25% more damage against foes that share a type with it.',
  MOLD_BREAKER: "Its moves ignore the target's defensive ability (LEVITATE, WONDER GUARD, STURDY, the absorbs, LIMBER, CLEAR BODY...), and DAMP can't stop its EXPLOSION.",
  ANTICIPATION: "Yours: if the foe's next attack is super effective on it, switching is free that turn. Enemy: your first super-effective hand against it does 25% less.",
  HONEY_GATHER: 'With it in your party, 20% chance to find a berry after each won battle.',
  FLOWER_GIFT: "In sunshine, your team's physical cards do 50% more, and it takes less damage from special attacks.",
  STORM_DRAIN: "WATER attacks do nothing to it and raise its SP. ATK instead. In co-op it pulls the foes' WATER attacks onto itself.",
  TECHNICIAN: 'Its weak moves (60 power or less) do 50% more.',
  AFTERMATH: 'If a move that touches it knocks it out, the attacker loses a quarter of its HP (bosses a tenth).',
  UNBURDEN: 'Yours: using a bag item on it doubles its SPEED. Enemy: its SPEED doubles when it drops below half HP.',
  KLUTZ: "Its cards ignore your held items' card bonuses but do 50% more on their own.",
  SUPER_LUCK: 'Lands critical hits more often.',
  HEATPROOF: 'Half damage from FIRE attacks and from burns.',
  FILTER: 'Super-effective hits do 25% less to it.',
  TANGLED_FEET: "While it's confused, attacks against it miss half the time.",
  STEADFAST: "When it flinches, your team's SPEED goes up.",
  SNIPER: 'Its critical hits do even more damage (x3 instead of x2).',
  DRY_SKIN: 'WATER heals it instead of hurting it; FIRE hurts it 25% more. Heals a little each turn in rain, loses a little in sunshine.',
  SNOW_WARNING: 'Starts hail for the whole battle when it comes out.',
  SOLID_ROCK: 'Super-effective hits do 25% less to it.',
  LEAF_GUARD: "Can't get a status problem in sunshine.",
  MOTOR_DRIVE: 'ELECTRIC attacks do nothing to it and raise its SPEED instead.',
  TINTED_LENS: 'Its "not very effective" hits do double damage.',
  SNOW_CLOAK: 'In hail, attacks against it miss more often.',
  ADAPTABILITY: 'A bigger same-type bonus: double damage instead of 1.5x.',
  DOWNLOAD: "When it comes out (once per battle), raises ATTACK or SP. ATK, whichever beats the foe's weaker defense.",
  SLOW_START: 'Half damage and half SPEED for its first 3 turns out.',
  HYDRATION: 'Cures its own status problem every turn in rain.',
  BAD_DREAMS: 'A sleeping foe loses HP every turn.',
  MULTITYPE: "Yours: takes the type of your first type-boosting held item (CHARCOAL makes it FIRE...). Enemy: becomes the type of the move it's about to use.",
};
