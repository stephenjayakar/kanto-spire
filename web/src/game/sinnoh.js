// Region 4: SINNOH (v0.6.0, Pokemon Platinum). Built like JOHTO (johto.js): FireRed's data has no Sinnoh trainers, so
// the named trainers (GYM LEADERS, ELITE FOUR, CYNTHIA, BARRY, TEAM GALACTIC, a few named elites) are full trainer
// objects authored here (data.js adds them to D.trainers). Parties and movesets follow Platinum's first battles
// (pret/pokeplatinum res/trainers/data/*.json); moves the game doesn't have (STEALTH ROCK, METAL BURST, ATTACK ORDER,
// GYRO BALL, TOXIC SPIKES...) are dropped and the slot refilled with a move it has. run.js rescales every level to the
// act (TIERS), like every other region's.
//
// Areas: Platinum's encounter tables (pokeplatinum res/field/encounters/*.json): walking slots ordered by rate, the
// day / night replacements as { morn, day, nite } (regions.js timeOfDay picks one by the floor, as in JOHTO), plus the
// area's surf / Good Rod species. Poke Radar, swarm and honey tree species are the areas' rare finds (SINNOH_FINDS).
// Platinum's Sinnoh dex mixes Gen 1-4, so Gen 4 species are ordinary pool POKéMON here (elsewhere they're finds).
//
// Trainer pics: 'platinum/<name>' = a Platinum portrait extracted by tools/extract_platinum.py into
// web/assets/gfx/trainers/platinum/ (gitignored, lazy 'sinnoh' asset pack); engine/assets.js shows a FireRed stand-in
// until it's there. Music: FireRed's songs (the Notion plan's option C); Platinum's own soundtrack needs an NDS
// sequencer the game doesn't have yet.
//
// GIRATINA ORIGIN FORME: a boss-only species key (GIRATINA_ORIGIN, applySinnoh below; Platinum's personal entry 501:
// Altered's ATTACK / SP. ATK swapped with its DEFENSE / SP. DEF, LEVITATE) for the DISTORTION WORLD's final boss. It has
// no POKéDEX entry of its own (form: true, formOf: GIRATINA): seeing it counts as seeing GIRATINA, and the post-game
// boss can't be caught (no legendary boss can). The catchable GIRATINA is the Altered one (rare legendary elites).
import { RARE_LEGEND, ULTRA_RARE_LEGEND } from './gen4.js';

const L = (species, level, moves) => ({ species, level, iv: 120, moves: moves || null, item: null });

// A named trainer: class (FireRed trainer class, for prize money), className (shown), name, pic, party, extras.
const T = (cls, className, name, pic, party, extra = {}) => ({ class: cls, className, name, pic, party, battleSong: 'MUS_VS_TRAINER', encounterSong: 'MUS_ENCOUNTER_BOY', ...extra });
const leader = (name, pic, party, extra) => T('LEADER', 'LEADER', name, pic, party, { battleSong: 'MUS_VS_GYM_LEADER', encounterSong: 'MUS_ENCOUNTER_GYM_LEADER', ...extra });
const e4 = (name, pic, party, extra) => T('ELITE_FOUR', 'ELITE FOUR', name, pic, party, { battleSong: 'MUS_VS_GYM_LEADER', encounterSong: 'MUS_ENCOUNTER_GYM_LEADER', ...extra });
const galactic = (className, name, pic, party, extra) => T('TEAM_ROCKET', className, name, pic, party, { battleSong: 'MUS_VS_TRAINER', encounterSong: 'MUS_ENCOUNTER_ROCKET', terrain: 'building', galactic: true, ...extra });

export const SINNOH_TRAINERS = {
  // ---- GYM LEADERS (Platinum first fights, ace last) ---------------------------------------------------------
  LEADER_ROARK: leader('ROARK', 'platinum/roark', [L('GEODUDE', 12, ['ROCK_THROW', 'DEFENSE_CURL']), L('ONIX', 12, ['ROCK_THROW', 'SCREECH', 'BIND']), L('CRANIDOS', 14, ['HEADBUTT', 'PURSUIT', 'LEER'])], { maps: ['OREBURGH_GYM'] }),
  LEADER_GARDENIA: leader('GARDENIA', 'platinum/gardenia', [L('TURTWIG', 20, ['GRASS_KNOT', 'RAZOR_LEAF', 'SUNNY_DAY', 'REFLECT']), L('CHERRIM', 20, ['GRASS_KNOT', 'SUNNY_DAY', 'MAGICAL_LEAF', 'SAFEGUARD']), L('ROSERADE', 22, ['GRASS_KNOT', 'MAGICAL_LEAF', 'POISON_STING', 'STUN_SPORE'])], { female: true, maps: ['ETERNA_GYM'] }),
  LEADER_FANTINA: leader('FANTINA', 'platinum/fantina', [L('DUSKULL', 24, ['WILL_O_WISP', 'PURSUIT', 'SHADOW_SNEAK', 'FUTURE_SIGHT']), L('HAUNTER', 24, ['SHADOW_CLAW', 'SUCKER_PUNCH', 'HYPNOSIS', 'CONFUSE_RAY']), L('MISMAGIUS', 26, ['SHADOW_BALL', 'PSYBEAM', 'MAGICAL_LEAF', 'CONFUSE_RAY'])], { female: true, maps: ['HEARTHOME_GYM'] }),
  LEADER_MAYLENE: leader('MAYLENE', 'platinum/maylene', [L('MEDITITE', 28, ['DRAIN_PUNCH', 'CONFUSION', 'ROCK_TOMB', 'FAKE_OUT']), L('MACHOKE', 29, ['KARATE_CHOP', 'ROCK_TOMB', 'STRENGTH', 'FOCUS_ENERGY']), L('LUCARIO', 32, ['DRAIN_PUNCH', 'FORCE_PALM', 'METAL_CLAW', 'BONE_RUSH'])], { female: true, maps: ['VEILSTONE_GYM'] }),
  LEADER_WAKE: leader('CRASHER WAKE', 'platinum/wake', [L('GYARADOS', 33, ['WATERFALL', 'BRINE', 'BITE', 'TWISTER']), L('QUAGSIRE', 34, ['MUD_SHOT', 'ROCK_TOMB', 'WATER_PULSE', 'YAWN']), L('FLOATZEL', 37, ['BRINE', 'ICE_FANG', 'CRUNCH', 'AQUA_JET'])], { maps: ['PASTORIA_GYM'] }),
  LEADER_BYRON: leader('BYRON', 'platinum/byron', [L('MAGNETON', 37, ['FLASH_CANNON', 'THUNDERBOLT', 'TRI_ATTACK', 'METAL_SOUND']), L('STEELIX', 38, ['FLASH_CANNON', 'ICE_FANG', 'EARTHQUAKE', 'SANDSTORM']), L('BASTIODON', 41, ['STONE_EDGE', 'IRON_DEFENSE', 'IRON_HEAD', 'TAUNT'])], { maps: ['CANALAVE_GYM'] }),
  LEADER_CANDICE: leader('CANDICE', 'platinum/candice', [L('SNEASEL', 40, ['SLASH', 'AERIAL_ACE', 'FAINT_ATTACK', 'ICE_SHARD']), L('PILOSWINE', 40, ['AVALANCHE', 'STONE_EDGE', 'EARTHQUAKE', 'HAIL']), L('ABOMASNOW', 42, ['AVALANCHE', 'WOOD_HAMMER', 'WATER_PULSE', 'FOCUS_BLAST']), L('FROSLASS', 44, ['BLIZZARD', 'DOUBLE_TEAM', 'SHADOW_BALL', 'PSYCHIC'])], { female: true, maps: ['SNOWPOINT_GYM'] }),
  LEADER_VOLKNER: leader('VOLKNER', 'platinum/volkner', [L('JOLTEON', 46, ['THUNDER_WAVE', 'CHARGE_BEAM', 'IRON_TAIL', 'QUICK_ATTACK']), L('RAICHU', 46, ['CHARGE_BEAM', 'FOCUS_BLAST', 'SIGNAL_BEAM', 'QUICK_ATTACK']), L('LUXRAY', 48, ['ICE_FANG', 'THUNDER_FANG', 'CRUNCH', 'FIRE_FANG']), L('ELECTIVIRE', 50, ['THUNDER_PUNCH', 'FIRE_PUNCH', 'QUICK_ATTACK', 'GIGA_IMPACT'])], { maps: ['SUNYSHORE_GYM'] }),
  // ---- ELITE FOUR + CHAMPION (first round) ------------------------------------------------------------------
  ELITE_FOUR_AARON: e4('AARON', 'platinum/aaron', [L('YANMEGA', 49, ['AIR_SLASH', 'BUG_BUZZ', 'U_TURN', 'DOUBLE_TEAM']), L('SCIZOR', 49, ['IRON_HEAD', 'X_SCISSOR', 'NIGHT_SLASH', 'QUICK_ATTACK']), L('VESPIQUEN', 50, ['POWER_GEM', 'AIR_SLASH', 'BUG_BUZZ', 'CONFUSE_RAY']), L('HERACROSS', 51, ['MEGAHORN', 'CLOSE_COMBAT', 'NIGHT_SLASH', 'STONE_EDGE']), L('DRAPION', 53, ['X_SCISSOR', 'CROSS_POISON', 'ICE_FANG', 'AERIAL_ACE'])]),
  ELITE_FOUR_BERTHA: e4('BERTHA', 'platinum/bertha', [L('WHISCASH', 50, ['EARTH_POWER', 'AQUA_TAIL', 'ZEN_HEADBUTT', 'SANDSTORM']), L('GLISCOR', 53, ['EARTHQUAKE', 'ICE_FANG', 'FIRE_FANG', 'THUNDER_FANG']), L('HIPPOWDON', 52, ['EARTHQUAKE', 'STONE_EDGE', 'CRUNCH', 'YAWN']), L('GOLEM', 52, ['EARTHQUAKE', 'FIRE_PUNCH', 'THUNDER_PUNCH', 'SANDSTORM']), L('RHYPERIOR', 55, ['EARTHQUAKE', 'MEGAHORN', 'AVALANCHE', 'STONE_EDGE'])], { female: true }),
  ELITE_FOUR_FLINT: e4('FLINT', 'platinum/flint', [L('HOUNDOOM', 52, ['FLAMETHROWER', 'SLUDGE_BOMB', 'DARK_PULSE', 'SUNNY_DAY']), L('FLAREON', 55, ['OVERHEAT', 'GIGA_IMPACT', 'QUICK_ATTACK', 'WILL_O_WISP']), L('RAPIDASH', 53, ['FLARE_BLITZ', 'SOLAR_BEAM', 'BOUNCE', 'SUNNY_DAY']), L('INFERNAPE', 55, ['FLARE_BLITZ', 'THUNDER_PUNCH', 'MACH_PUNCH', 'EARTHQUAKE']), L('MAGMORTAR', 57, ['FLAMETHROWER', 'THUNDERBOLT', 'SOLAR_BEAM', 'HYPER_BEAM'])]),
  ELITE_FOUR_LUCIAN: e4('LUCIAN', 'platinum/lucian', [L('MR_MIME', 53, ['PSYCHIC', 'THUNDERBOLT', 'REFLECT', 'LIGHT_SCREEN']), L('ESPEON', 55, ['PSYCHIC', 'SHADOW_BALL', 'QUICK_ATTACK', 'SIGNAL_BEAM']), L('BRONZONG', 54, ['PSYCHIC', 'EARTHQUAKE', 'CALM_MIND', 'FLASH_CANNON']), L('ALAKAZAM', 56, ['PSYCHIC', 'ENERGY_BALL', 'FOCUS_BLAST', 'RECOVER']), L('GALLADE', 59, ['DRAIN_PUNCH', 'PSYCHO_CUT', 'LEAF_BLADE', 'STONE_EDGE'])]),
  CHAMPION_CYNTHIA: T('CHAMPION', 'CHAMPION', 'CYNTHIA', 'platinum/cynthia', [L('SPIRITOMB', 58, ['DARK_PULSE', 'PSYCHIC', 'SILVER_WIND', 'SHADOW_BALL']), L('ROSERADE', 58, ['ENERGY_BALL', 'SLUDGE_BOMB', 'TOXIC', 'EXTRASENSORY']), L('TOGEKISS', 60, ['AIR_SLASH', 'AURA_SPHERE', 'WATER_PULSE', 'SHOCK_WAVE']), L('LUCARIO', 60, ['AURA_SPHERE', 'EXTREME_SPEED', 'SHADOW_BALL', 'STONE_EDGE']), L('MILOTIC', 58, ['SURF', 'ICE_BEAM', 'MIRROR_COAT', 'DRAGON_PULSE']), L('GARCHOMP', 62, ['DRAGON_RUSH', 'EARTHQUAKE', 'FLAMETHROWER', 'GIGA_IMPACT'])],
    { rule: 'CYNTHIA', champion: true, female: true, battleSong: 'MUS_VS_CHAMPION', encounterSong: 'MUS_ENCOUNTER_GYM_LEADER' }),
  // ---- the rival: BARRY. Platinum's teams for a TURTWIG player (his ace is the CHIMCHAR line; run.js swaps it for
  // the line that counters you): ROUTE 203, PASTORIA CITY, CANALAVE CITY.
  BARRY: T('RIVAL_LATE', 'RIVAL', 'BARRY', 'platinum/barry', [L('STARLY', 7, ['QUICK_ATTACK', 'GROWL']), L('CHIMCHAR', 9, ['SCRATCH', 'LEER', 'EMBER'])], { encounterSong: 'MUS_ENCOUNTER_RIVAL', maps: ['ROUTE203'] }),
  BARRY_2: T('RIVAL_LATE', 'RIVAL', 'BARRY', 'platinum/barry', [L('STARAVIA', 25, ['WING_ATTACK', 'QUICK_ATTACK', 'ENDEAVOR', 'DOUBLE_TEAM']), L('ROSELIA', 23, ['MEGA_DRAIN', 'POISON_STING', 'LEECH_SEED', 'MAGICAL_LEAF']), L('MONFERNO', 27, ['FLAME_WHEEL', 'MACH_PUNCH', 'FURY_SWIPES', 'LEER'])],
    { encounterSong: 'MUS_ENCOUNTER_RIVAL', maps: ['PASTORIA_CITY'] }),
  BARRY_3: T('RIVAL_LATE', 'RIVAL', 'BARRY', 'platinum/barry', [L('STARAPTOR', 36, ['AERIAL_ACE', 'TAKE_DOWN', 'QUICK_ATTACK', 'DOUBLE_TEAM']), L('FLOATZEL', 35, ['AQUA_JET', 'PURSUIT', 'QUICK_ATTACK', 'SWIFT']), L('HERACROSS', 37, ['BRICK_BREAK', 'AERIAL_ACE', 'NIGHT_SLASH', 'HORN_ATTACK']), L('ROSERADE', 35, ['GIGA_DRAIN', 'LEECH_SEED', 'GRASS_WHISTLE', 'POISON_STING']), L('INFERNAPE', 38, ['BRICK_BREAK', 'FLAME_WHEEL', 'MACH_PUNCH', 'AERIAL_ACE'])],
    { encounterSong: 'MUS_ENCOUNTER_RIVAL', maps: ['CANALAVE_CITY'] }),
  // ---- TEAM GALACTIC: a grunt per act (VALLEY WINDWORKS, VEILSTONE, GALACTIC HQ), the commanders and CYRUS ------
  GALACTIC_GRUNT: galactic('TEAM GALACTIC', 'GRUNT', 'platinum/galactic_grunt_m', [L('GLAMEOW', 13), L('ZUBAT', 13), L('STUNKY', 13)], { maps: ['VALLEY_WINDWORKS'] }),
  GALACTIC_GRUNT_2: galactic('TEAM GALACTIC', 'GRUNT', 'platinum/galactic_grunt_f', [L('ZUBAT', 24), L('CROAGUNK', 26), L('STUNKY', 26)], { female: true, maps: ['VEILSTONE_CITY'] }),
  GALACTIC_GRUNT_3: galactic('TEAM GALACTIC', 'GRUNT', 'platinum/galactic_grunt_m', [L('GOLBAT', 41), L('GLAMEOW', 41), L('BRONZOR', 41)], { maps: ['GALACTIC_HQ'] }),
  COMMANDER_MARS: galactic('COMMANDER', 'MARS', 'platinum/mars', [L('ZUBAT', 15, ['BITE', 'LEECH_LIFE', 'TOXIC']), L('PURUGLY', 17, ['FAINT_ATTACK', 'SCRATCH', 'FAKE_OUT'])], { female: true, maps: ['VALLEY_WINDWORKS'] }),
  COMMANDER_JUPITER: galactic('COMMANDER', 'JUPITER', 'platinum/jupiter', [L('ZUBAT', 21, ['GIGA_DRAIN', 'WING_ATTACK', 'BITE']), L('SKUNTANK', 23, ['NIGHT_SLASH', 'POISON_GAS', 'SCREECH', 'SMOKESCREEN'])], { female: true, maps: ['GALACTIC_ETERNA_BUILDING'] }),
  COMMANDER_SATURN: galactic('COMMANDER', 'SATURN', 'platinum/saturn', [L('GOLBAT', 42, ['AIR_CUTTER', 'BITE', 'POISON_FANG', 'CONFUSE_RAY']), L('BRONZOR', 42, ['EXTRASENSORY', 'SHADOW_BALL', 'CONFUSE_RAY', 'IRON_DEFENSE']), L('TOXICROAK', 44, ['POISON_JAB', 'BRICK_BREAK', 'X_SCISSOR', 'FAINT_ATTACK'])], { maps: ['GALACTIC_HQ'] }),
  COMMANDER_MARS_2: galactic('COMMANDER', 'MARS', 'platinum/mars', [L('BRONZOR', 44, ['EXTRASENSORY', 'LIGHT_SCREEN', 'CONFUSE_RAY']), L('GOLBAT', 44, ['AIR_CUTTER', 'BITE', 'POISON_FANG', 'CONFUSE_RAY']), L('PURUGLY', 46, ['SLASH', 'SHADOW_CLAW', 'AERIAL_ACE', 'HYPNOSIS'])], { female: true, maps: ['SPEAR_PILLAR'] }),
  GALACTIC_BOSS_CYRUS: galactic('BOSS', 'CYRUS', 'platinum/cyrus', [L('SNEASEL', 44, ['SLASH', 'ICE_PUNCH', 'QUICK_ATTACK', 'SCREECH']), L('CROBAT', 44, ['POISON_FANG', 'AIR_CUTTER', 'BITE', 'SUPERSONIC']), L('HONCHKROW', 46, ['DRILL_PECK', 'NIGHT_SHADE', 'ASTONISH', 'FAINT_ATTACK'])], { maps: ['GALACTIC_HQ'] }),
  // the DISTORTION WORLD (post-game): CYRUS's last stand, before GIRATINA
  GALACTIC_BOSS_CYRUS_2: galactic('BOSS', 'CYRUS', 'platinum/cyrus', [L('HOUNDOOM', 45, ['FLAMETHROWER', 'DARK_PULSE', 'WILL_O_WISP', 'THUNDER_FANG']), L('HONCHKROW', 47, ['DRILL_PECK', 'NIGHT_SLASH', 'HEAT_WAVE', 'PSYCHIC']), L('CROBAT', 46, ['CROSS_POISON', 'AIR_SLASH', 'TOXIC', 'CONFUSE_RAY']), L('GYARADOS', 46, ['GIGA_IMPACT', 'WATERFALL', 'ICE_FANG', 'EARTHQUAKE']), L('WEAVILE', 48, ['NIGHT_SLASH', 'ICE_PUNCH', 'FAKE_OUT', 'X_SCISSOR'])],
    { terrain: 'cave', maps: ['DISTORTION_WORLD'] }),
  // ---- named SINNOH elites (Platinum teams; FireRed stand-in pics, Platinum's ACE TRAINER portraits when extracted) ----
  SINNOH_ACE_TRAINER_M: T('COOLTRAINER', 'ACE TRAINER', 'ALLEN', 'platinum/ace_trainer_m', [L('GASTLY', 21), L('GASTLY', 22), L('HAUNTER', 24)], { maps: ['ROUTE_204'] }),
  SINNOH_AROMA_LADY: T('LADY', 'AROMA LADY', 'TAYLOR', 'lady', [L('BUDEW', 9), L('CHERUBI', 11)], { female: true, encounterSong: 'MUS_ENCOUNTER_GIRL', maps: ['ROUTE_205'] }),
  SINNOH_ACE_TRAINER_F: T('COOLTRAINER', 'ACE TRAINER', 'BRENDA', 'platinum/ace_trainer_f', [L('LOPUNNY', 38), L('KIRLIA', 36), L('MEDICHAM', 35)], { female: true, encounterSong: 'MUS_ENCOUNTER_GIRL' }),
  SINNOH_ACE_TRAINER_COOL: T('COOLTRAINER', 'ACE TRAINER', 'OMAR', 'platinum/ace_trainer_m', [L('MAMOSWINE', 45), L('MOTHIM', 46), L('RAMPARDOS', 48)]),
  SINNOH_BLACK_BELT: T('BLACK_BELT', 'BLACK BELT', 'RAFAEL', 'black_belt', [L('CROAGUNK', 26, ['SWAGGER', 'REVENGE', 'FAINT_ATTACK', 'POISON_STING']), L('MACHOKE', 26, ['KARATE_CHOP', 'FORESIGHT', 'LOW_KICK', 'LEER'])], { maps: ['VEILSTONE_GYM'] }),
  SINNOH_PSYCHIC: T('PSYCHIC', 'PSYCHIC', 'ABIGAIL', 'psychic_f', [L('CHINGLING', 23), L('DRIFLOON', 25), L('KIRLIA', 27)], { female: true, encounterSong: 'MUS_ENCOUNTER_GIRL' }),
  SINNOH_VETERAN: T('GENTLEMAN', 'VETERAN', 'GRANT', 'expert_m', [L('RIOLU', 34), L('STARAPTOR', 34), L('GRAVELER', 34)], { maps: ['IRON_ISLAND'] }),
  SINNOH_VETERAN_2: T('GENTLEMAN', 'VETERAN', 'EDGAR', 'expert_m', [L('PORYGON_Z', 46), L('TANGROWTH', 46), L('EMPOLEON', 46)]),
  SINNOH_DRAGON_TAMER: T('COOLTRAINER', 'DRAGON TAMER', 'ONDREJ', 'cool_trainer_m', [L('ALTARIA', 45), L('GABITE', 47), L('DRAGONAIR', 46)], { maps: ['VICTORY_ROAD'] }),
  SINNOH_DRAGON_TAMER_2: T('COOLTRAINER', 'DRAGON TAMER', 'DRAKE', 'cool_trainer_m', [L('GIBLE', 57), L('GABITE', 57), L('DRAGONAIR', 57), L('SALAMENCE', 58)], { maps: ['STARK_MOUNTAIN'] }),
};

// Generic SINNOH route trainers: FireRed trainer keys whose class / pic stand in for Platinum's (a name is picked from
// the list: Platinum trainers of that class; the party comes from the act's wild pools).
export const SINNOH_TRAINER_CLASSES = [
  ['YOUNGSTER_BEN', ['TRISTAN', 'LOGAN', 'MICHAEL', 'SEBASTIAN', 'DALLAS', 'JONATHAN', 'TYLER']], ['BUG_CATCHER_RICK', ['BRANDON', 'JACK', 'PHILIP', 'DONALD', 'LOUIS', 'DOUG', 'CORY']],
  ['LASS_JANICE', ['NATALIE', 'MADELINE', 'SARAH', 'KAITLIN', 'HAILEY', 'SAMANTHA']], ['HIKER_MARCOS', ['DANIEL', 'JUSTIN', 'KEVIN', 'ERIC', 'ALEXANDER', 'THEODORE', 'DAMON']],
  ['CAMPER_LIAM', ['CURTIS', 'DIEGO', 'ZACKARY', 'ANTHONY', 'JUSTIN', 'DREW']], ['PICNICKER_KELSEY', ['DIANA', 'SIENA', 'KARINA', 'ASHLEY', 'CHERYL', 'TERESA']],
  ['BIRD_KEEPER_SEBASTIAN', ['BRIANNA', 'MEGHAN', 'AUDREY', 'GEORGIA', 'BEVERLY']], ['FISHERMAN_DALE', ['ANDREW', 'CARL', 'MARTIN', 'HUBERT', 'JUAN', 'MILES']],
  ['SUPER_NERD_JOVAN', ['GREGORY', 'MIGUEL', 'ARCHIE', 'HECTOR', 'DOUG']], ['POKEMANIAC_MARK', ['CALEB', 'DERRICK', 'DONALD', 'BRANDON', 'SHELBY']],
  ['SCHOOL_KID_M', ['CHRISTINE', 'HARRISON', 'JOSEPH', 'MACKENZIE', 'GORDON']], ['POKEFAN_M', ['JEREMY', 'CHARLES', 'ALEX', 'COLIN', 'ROBERT']],
  ['BLACK_BELT_KOICHI', ['ADAM', 'COLBY', 'DARREN', 'DAVID', 'JEFFERY', 'KYLE', 'RICKY']], ['BEAUTY_BRIDGET', ['CYNDY', 'DEVON', 'NICOLA', 'LOLA', 'CALLIE']],
  ['GENTLEMAN_THOMAS', ['ALFRED', 'ARTHUR', 'JEREMY', 'GRANT', 'BRIAN']], ['PSYCHIC_JOHAN', ['MITCHELL', 'ELIJAH', 'CORBIN', 'BRYCE', 'DOUGLAS']],
  ['COOLTRAINER_SAMUEL', ['JONAH', 'JAKE', 'ERNEST', 'GARRETT', 'CESAR', 'DALTON', 'ISAIAH']], ['COOLTRAINER_MARY', ['LAURA', 'MARIA', 'OLIVIA', 'SHANNON', 'BRENNA', 'SAVANNAH']],
  ['CHANNELER_HOPE', ['VALERIE', 'GRACE', 'KATIE', 'MARTHA', 'TAMMY']], ['SAILOR_EDMOND', ['DYLAN', 'SAMSON', 'LUTHER', 'MARC', 'PAUL']],
  ['SWIMMER_MALE_LUIS', ['CRAIG', 'JEROME', 'ERIK', 'SHERMAN', 'FRANCISCO']], ['SWIMMER_FEMALE_TIFFANY', ['HALEY', 'KATELYN', 'MARIELA', 'TESS', 'MARY']],
  ['BIKER_JARED', ['MAX', 'NIKOLAS', 'DUSTIN', 'JACOB', 'JEREMIAH']], ['SCIENTIST_TED', ['DIXON', 'JOSE', 'PIERRE', 'KATIE', 'ORLANDO']],
];

const area = (name, terrain, from, pool, music) => ({ name, terrain, from, pool, music });
// a { morn, day, nite } pool from the morning list and Platinum's day / night slot replacements
const tod = (morn, day, nite) => ({ morn, day: day || morn, nite: nite || morn });

export const SINNOH_ACTS = [
  {
    id: 1, region: 'sinnoh', name: 'TWINLEAF → ETERNA', short: 'SINNOH 1', floors: 15, levels: [3, 12], bossLevel: 15,
    music: ['mus_route1', 'mus_route3'], townMusic: 'mus_pewter',
    areas: [
      area('ROUTE 201', 'grass', 0, tod(['STARLY', 'BIDOOF', 'KRICKETOT'], ['STARLY', 'BIDOOF'], ['BIDOOF', 'STARLY', 'KRICKETOT'])),
      area('LAKE VERITY', 'water', 0, ['STARLY', 'BIDOOF', 'PSYDUCK', 'MAGIKARP', 'GOLDEEN'], 'mus_surf'),
      area('ROUTE 202', 'grass', 0.1, tod(['BIDOOF', 'SHINX', 'STARLY', 'KRICKETOT'], ['BIDOOF', 'SHINX', 'STARLY'], ['BIDOOF', 'SHINX', 'KRICKETOT', 'STARLY'])),
      area('ROUTE 203', 'grass', 0.2, tod(['STARLY', 'SHINX', 'BIDOOF', 'ABRA', 'KRICKETOT'], ['STARLY', 'SHINX', 'BIDOOF', 'ABRA'], ['STARLY', 'SHINX', 'BIDOOF', 'ABRA', 'KRICKETOT', 'ZUBAT'])),
      area('OREBURGH GATE', 'cave', 0.25, ['ZUBAT', 'PSYDUCK', 'GEODUDE'], 'mus_mt_moon'),
      area('OREBURGH MINE', 'cave', 0.3, ['GEODUDE', 'ZUBAT', 'ONIX'], 'mus_mt_moon'),
      area('ROUTE 204', 'grass', 0.4, tod(['STARLY', 'BIDOOF', 'BUDEW', 'SHINX', 'WURMPLE', 'KRICKETOT'], ['STARLY', 'BIDOOF', 'BUDEW', 'SHINX', 'WURMPLE'], ['STARLY', 'BIDOOF', 'BUDEW', 'SHINX', 'KRICKETOT', 'ZUBAT'])),
      area('RAVAGED PATH', 'cave', 0.45, ['ZUBAT', 'PSYDUCK', 'MAGIKARP', 'BARBOACH'], 'mus_mt_moon'),
      area('VALLEY WINDWORKS', 'grass', 0.55, ['SHELLOS', 'BUIZEL', 'SHINX', 'PACHIRISU', 'TENTACOOL']),
      area('ROUTE 205', 'grass', 0.6, ['SHELLOS', 'BUIZEL', 'BIDOOF', 'PACHIRISU', 'FINNEON']),
      area('ETERNA FOREST', 'longgrass', 0.7, tod(['BUDEW', 'BUNEARY', 'WURMPLE', 'KRICKETOT', 'SILCOON', 'CASCOON', 'GASTLY'], ['BUDEW', 'BUNEARY', 'WURMPLE', 'SILCOON', 'CASCOON', 'GASTLY'], ['BUDEW', 'BUNEARY', 'KRICKETOT', 'HOOTHOOT', 'SILCOON', 'CASCOON', 'GASTLY']), 'mus_viridian_forest'),
    ],
    elites: ['GALACTIC_GRUNT', 'COMMANDER_MARS', 'SINNOH_AROMA_LADY'],
    rival: 'BARRY', bird: 'LEGEND_MESPRIT', // MESPRIT: LAKE VERITY's guardian
    bosses: ['LEADER_ROARK', 'LEADER_GARDENIA'],
  },
  {
    id: 2, region: 'sinnoh', name: 'HEARTHOME → VEILSTONE', short: 'SINNOH 2', floors: 15, levels: [14, 25], bossLevel: 27,
    music: ['mus_route24', 'mus_route11', 'mus_route3'], townMusic: 'mus_celadon',
    areas: [
      area('ROUTE 211', 'mountain', 0, tod(['MEDITITE', 'BIDOOF', 'CHINGLING', 'MACHOP', 'BRONZOR'], null, ['MEDITITE', 'BIDOOF', 'CHINGLING', 'MACHOP', 'ZUBAT', 'HOOTHOOT', 'BRONZOR'])),
      area('ROUTE 206', 'grass', 0.05, tod(['GEODUDE', 'PONYTA', 'GLIGAR', 'MACHOP', 'KRICKETUNE'], ['PONYTA', 'GEODUDE', 'GLIGAR', 'MACHOP'], ['GEODUDE', 'PONYTA', 'MACHOP', 'KRICKETUNE', 'ZUBAT', 'GLIGAR'])),
      area('WAYWARD CAVE', 'cave', 0.15, ['GEODUDE', 'BRONZOR', 'ZUBAT', 'ONIX'], 'mus_mt_moon'),
      area('MT. CORONET', 'cave', 0.25, tod(['BRONZOR', 'GEODUDE', 'MEDITITE', 'CLEFAIRY', 'MACHOP', 'CHINGLING', 'NOSEPASS', 'ZUBAT'], ['GEODUDE', 'BRONZOR', 'MEDITITE', 'MACHOP', 'CHINGLING', 'NOSEPASS', 'ZUBAT']), 'mus_mt_moon'),
      area('ROUTE 208', 'grass', 0.35, ['BUDEW', 'BIDOOF', 'BIBAREL', 'RALTS', 'ROSELIA', 'PSYDUCK']),
      area('ROUTE 209', 'grass', 0.45, tod(['BIBAREL', 'ROSELIA', 'STARAVIA', 'RALTS', 'CHANSEY'], null, ['BIBAREL', 'ROSELIA', 'ZUBAT', 'DUSKULL', 'STARAVIA', 'RALTS', 'CHANSEY'])),
      area('LOST TOWER', 'building', 0.5, tod(['GASTLY', 'ZUBAT', 'HAUNTER'], null, ['GASTLY', 'ZUBAT', 'DUSKULL']), 'mus_poke_tower'), // (+ HAUNTER from the upper floors)
      // (Platinum: UNOWN only; + MT. CORONET's BRONZOR and GEODUDE so generic trainers have a pool)
      area('SOLACEON RUINS', 'cave', 0.6, ['UNOWN', 'BRONZOR', 'GEODUDE'], 'mus_sevii_dungeon'),
      area('ROUTE 210', 'longgrass', 0.65, tod(['PONYTA', 'STARAVIA', 'GEODUDE', 'SCYTHER', 'ROSELIA', 'CHANSEY'], null, ['STARAVIA', 'GEODUDE', 'ROSELIA', 'PONYTA', 'NOCTOWL', 'HOOTHOOT', 'SCYTHER', 'CHANSEY'])),
      area('ROUTE 215', 'grass', 0.75, ['STARAVIA', 'MARILL', 'SCYTHER', 'LICKITUNG', 'ABRA', 'KADABRA']),
      // (Platinum: GASTLY only, and ROTOM by the TV; + the LOST TOWER's HAUNTER and DUSKULL)
      area('OLD CHATEAU', 'building', 0.8, ['GASTLY', 'HAUNTER', 'DUSKULL'], 'mus_poke_mansion'),
    ],
    elites: ['GALACTIC_GRUNT_2', 'COMMANDER_JUPITER', 'SINNOH_BLACK_BELT', 'SINNOH_PSYCHIC', 'SINNOH_ACE_TRAINER_M'],
    rival: 'BARRY_2', bird: 'LEGEND_AZELF', // AZELF: LAKE VALOR's guardian
    bosses: ['LEADER_FANTINA', 'LEADER_MAYLENE'],
  },
  {
    id: 3, region: 'sinnoh', name: 'PASTORIA → SUNYSHORE', short: 'SINNOH 3', floors: 15, levels: [26, 37], bossLevel: 41,
    music: ['mus_surf', 'mus_route11', 'mus_cycling'], townMusic: 'mus_vermillion',
    areas: [
      area('ROUTE 212', 'longgrass', 0, ['SHELLOS', 'QUAGSIRE', 'BUIZEL', 'CROAGUNK', 'TENTACOOL', 'REMORAID']),
      area('GREAT MARSH', 'longgrass', 0.05, tod(['WOOPER', 'BIBAREL', 'TROPIUS', 'QUAGSIRE', 'YANMA', 'TANGELA'], null, ['WOOPER', 'BIBAREL', 'NOCTOWL', 'QUAGSIRE', 'YANMA', 'TANGELA'])),
      area('ROUTE 213', 'water', 0.15, tod(['SHELLOS', 'BUIZEL', 'CHATOT', 'WINGULL', 'TENTACOOL', 'REMORAID'], null, ['SHELLOS', 'BUIZEL', 'WINGULL', 'TENTACOOL', 'REMORAID']), 'mus_surf'),
      area('ROUTE 214', 'mountain', 0.25, tod(['GRAVELER', 'RHYHORN', 'GEODUDE', 'HOUNDOUR'], null, ['GRAVELER', 'HOUNDOUR', 'GEODUDE', 'RHYHORN', 'ZUBAT'])),
      area('VALOR LAKEFRONT', 'grass', 0.3, tod(['BIBAREL', 'GIRAFARIG', 'STARAVIA', 'KRICKETUNE', 'HOUNDOUR'], ['STARAVIA', 'BIBAREL', 'GIRAFARIG', 'HOUNDOUR'])),
      area('ROUTE 218', 'water', 0.4, tod(['FLOATZEL', 'GASTRODON', 'MR_MIME', 'CHATOT', 'TENTACOOL', 'FINNEON'], null, ['FLOATZEL', 'GASTRODON', 'MR_MIME', 'TENTACOOL', 'FINNEON']), 'mus_surf'),
      area('IRON ISLAND', 'cave', 0.45, ['GRAVELER', 'ONIX', 'GOLBAT', 'STEELIX'], 'mus_sevii_cave'),
      area('ROUTE 216', 'mountain', 0.55, tod(['SNOVER', 'SNEASEL', 'MEDITITE', 'GRAVELER'], null, ['SNEASEL', 'SNOVER', 'ZUBAT', 'SNORUNT', 'MEDITITE', 'GRAVELER'])),
      area('ROUTE 217', 'mountain', 0.6, tod(['SNOVER', 'SWINUB', 'SNEASEL'], null, ['SWINUB', 'SNOVER', 'SNORUNT', 'SNEASEL'])),
      area('LAKE ACUITY', 'water', 0.7, tod(['SNOVER', 'BIBAREL', 'GOLDUCK', 'SNEASEL', 'PSYDUCK'], null, ['SNOVER', 'BIBAREL', 'SNORUNT', 'GOLDUCK', 'SNEASEL', 'PSYDUCK']), 'mus_surf'),
      area('ROUTE 222', 'grass', 0.8, tod(['ELECTABUZZ', 'FLOATZEL', 'CHATOT', 'WINGULL', 'MAGNEMITE', 'LUXIO', 'PELIPPER', 'MAGNETON'], null, ['FLOATZEL', 'ELECTABUZZ', 'WINGULL', 'MAGNEMITE', 'LUXIO', 'PELIPPER', 'MAGNETON'])),
    ],
    elites: ['GALACTIC_GRUNT_3', 'COMMANDER_SATURN', 'GALACTIC_BOSS_CYRUS', 'SINNOH_ACE_TRAINER_F', 'SINNOH_VETERAN'],
    rival: 'BARRY_3', bird: 'LEGEND_UXIE', // UXIE: LAKE ACUITY's guardian
    bosses: ['LEADER_WAKE', 'LEADER_BYRON', 'LEADER_CANDICE', 'LEADER_VOLKNER'],
  },
  {
    id: 4, region: 'sinnoh', name: 'VICTORY ROAD → POKéMON LEAGUE', short: 'SINNOH 4', floors: 7, finale: true, levels: [37, 42], bossLevel: 46,
    music: ['mus_victory_road'], townMusic: 'mus_poke_center',
    areas: [
      area('ROUTE 223', 'water', 0, ['TENTACRUEL', 'PELIPPER', 'MANTYKE', 'REMORAID', 'OCTILLERY', 'WINGULL'], 'mus_surf'),
      area('VICTORY ROAD', 'cave', 0.15, ['GRAVELER', 'RHYHORN', 'ONIX', 'RHYDON', 'GOLBAT', 'STEELIX', 'GABITE'], 'mus_victory_road'),
      area('VICTORY ROAD B1F', 'cave', 0.4, ['FLOATZEL', 'AZUMARILL', 'GRAVELER', 'ONIX', 'GOLBAT', 'STEELIX', 'GABITE'], 'mus_victory_road'),
      area('VICTORY ROAD 2F', 'cave', 0.55, ['STEELIX', 'MAGNETON', 'GRAVELER', 'GOLBAT', 'ONIX', 'GABITE'], 'mus_victory_road'),
    ],
    elites: ['SINNOH_ACE_TRAINER_COOL', 'SINNOH_DRAGON_TAMER', 'SINNOH_VETERAN_2', 'COMMANDER_MARS_2'],
    // (SPEAR PILLAR, at the top of MT. CORONET: DIALGA / PALKIA)
    rareLegends: [['LEGEND_DIALGA', RARE_LEGEND / 2], ['LEGEND_PALKIA', RARE_LEGEND / 2]],
    gauntlet: ['ELITE_FOUR_AARON', 'ELITE_FOUR_BERTHA', 'ELITE_FOUR_FLINT', 'ELITE_FOUR_LUCIAN', 'CHAMPION_CYNTHIA'],
    gauntletLevels: [44, 45, 46, 47, 49],
  },
  {
    id: 5, region: 'sinnoh', name: 'DISTORTION WORLD', short: 'POST-GAME', floors: 12, postgame: true, levels: [50, 60], bossLevel: 70,
    music: ['mus_sevii_cave', 'mus_sevii_dungeon', 'mus_victory_road'], townMusic: 'mus_poke_center',
    areas: [
      area('ROUTE 225', 'mountain', 0, tod(['FEAROW', 'MACHOKE', 'GRAVELER', 'RATICATE', 'SPEAROW'], null, ['MACHOKE', 'GRAVELER', 'BANETTE', 'RATICATE', 'FEAROW'])),
      area('STARK MOUNTAIN', 'mountain', 0.15, ['CAMERUPT', 'RHYDON', 'FEAROW', 'GRAVELER', 'WEEZING', 'SKARMORY', 'NUMEL'], 'mus_victory_road'),
      area('STARK MOUNTAIN CAVE', 'cave', 0.3, ['MAGCARGO', 'RHYDON', 'GOLBAT', 'GRAVELER', 'WEEZING', 'SLUGMA'], 'mus_victory_road'),
      area('ROUTE 228', 'sand', 0.4, ['DUGTRIO', 'CACTURNE', 'HIPPOWDON', 'RHYDON', 'DIGLETT', 'CACNEA', 'WHISCASH']),
      area('TURNBACK CAVE', 'cave', 0.55, tod(['GASTLY', 'GOLBAT', 'BRONZOR', 'CHINGLING', 'DUSKULL'], null, ['GASTLY', 'GOLBAT', 'BRONZOR', 'DUSCLOPS', 'CHINGLING', 'DUSKULL']), 'mus_sevii_cave'),
      // (the DISTORTION WORLD has no wild POKéMON in Platinum: the shades of TURNBACK CAVE's ghosts and SPEAR PILLAR's steel)
      area('DISTORTION WORLD', 'cave', 0.75, ['HAUNTER', 'DUSCLOPS', 'BRONZONG', 'GOLBAT', 'MISDREAVUS'], 'mus_sevii_dungeon'),
    ],
    elites: ['GALACTIC_BOSS_CYRUS_2', 'LEGEND_HEATRAN', 'LEGEND_REGIGIGAS', 'SINNOH_DRAGON_TAMER_2'],
    // (STARK MOUNTAIN, the FULLMOON ISLAND and NEWMOON ISLAND, the FLOWER PARADISE)
    rareLegends: [['LEGEND_CRESSELIA', RARE_LEGEND], ['LEGEND_DARKRAI', ULTRA_RARE_LEGEND], ['LEGEND_SHAYMIN', ULTRA_RARE_LEGEND]],
    bosses: ['LEGEND_GIRATINA_ORIGIN'],
  },
];

// Species the pools above leave out, added to SINNOH's wild areas (act id -> area name; every time of day; regions.js
// withFinds: extra = half as common as an average species there, rare = a rare find). Platinum's own extras: the POKé
// RADAR, swarms, the honey trees and the GREAT MARSH's daily species. The Sinnoh starters are rare finds in act 1 and
// their middle / final forms later, like JOHTO's.
export const SINNOH_FINDS = {
  1: {
    'ROUTE 201': { rare: ['TURTWIG', 'NIDORAN_M', 'NIDORAN_F'] },
    'LAKE VERITY': { rare: ['PIPLUP'] },
    'ROUTE 202': { extra: ['SENTRET'], rare: ['CHIMCHAR'] },
    'ROUTE 203': { rare: ['CUBONE'] },
    'OREBURGH MINE': { rare: ['CRANIDOS', 'SHIELDON'] },
    'ROUTE 204': { extra: ['COMBEE', 'BURMY'] },
    'VALLEY WINDWORKS': { extra: ['DRIFLOON'], rare: ['ELECTRIKE', 'MAREEP'] },
    'ROUTE 205': { extra: ['CHERUBI'], rare: ['HOPPIP'] },
    'ETERNA FOREST': { extra: ['AIPOM'], rare: ['MUNCHLAX', 'NINCADA', 'SLAKOTH'] },
  },
  2: {
    'ROUTE 211': { rare: ['GROTLE'] },
    'ROUTE 206': { extra: ['STUNKY', 'GLAMEOW'], rare: ['LARVITAR'] },
    'WAYWARD CAVE': { rare: ['GIBLE'] },
    'MT. CORONET': { extra: ['FEEBAS'], rare: ['MONFERNO', 'RIOLU'] },
    'ROUTE 208': { extra: ['HAPPINY'], rare: ['PRINPLUP'] },
    'ROUTE 209': { extra: ['BONSLY', 'MIME_JR'] },
    'LOST TOWER': { rare: ['SPIRITOMB'] },
    'ROUTE 210': { extra: ['SWABLU'], rare: ['ALTARIA'] },
    'ROUTE 215': { extra: ['SKORUPI'] },
    'OLD CHATEAU': { rare: ['ROTOM', 'MISDREAVUS'] },
  },
  3: {
    'ROUTE 212': { rare: ['GRIMER', 'TORTERRA'] },
    'GREAT MARSH': { extra: ['CARNIVINE', 'SKORUPI'], rare: ['CROAGUNK', 'KANGASKHAN', 'HERACROSS'] },
    'ROUTE 213': { extra: ['MANTYKE'], rare: ['INFERNAPE'] },
    'ROUTE 214': { rare: ['SPOINK', 'POOCHYENA', 'HIPPOPOTAS'] },
    'VALOR LAKEFRONT': { rare: ['NIDORINO', 'NIDORINA'] },
    'ROUTE 218': { rare: ['VOLTORB', 'EMPOLEON'] },
    'IRON ISLAND': { rare: ['LUCARIO'] },
    'ROUTE 216': { rare: ['WEAVILE'] },
    'ROUTE 217': { rare: ['DELIBIRD', 'FROSLASS'] },
    'LAKE ACUITY': { rare: ['ABOMASNOW'] },
    'ROUTE 222': { rare: ['SKITTY', 'FLAAFFY', 'ELECTIVIRE'] },
  },
  4: {
    'VICTORY ROAD': { rare: ['RHYPERIOR'] },
    'VICTORY ROAD B1F': { rare: ['TOGEKISS'] },
    'VICTORY ROAD 2F': { rare: ['MAGNEZONE', 'PROBOPASS'] },
  },
  5: {
    'STARK MOUNTAIN': { rare: ['MAGMORTAR', 'GARCHOMP'] },
    'ROUTE 228': { rare: ['GLISCOR'] },
    'TURNBACK CAVE': { rare: ['DUSKNOIR', 'BRONZONG'] },
    'DISTORTION WORLD': { rare: ['MISMAGIUS'] },
  },
};
for (const a of SINNOH_ACTS) for (const ar of a.areas) Object.assign(ar, SINNOH_FINDS[a.id]?.[ar.name]);

// GIRATINA ORIGIN as the DISTORTION WORLD's final boss (acts.js LEGENDS; bosses.js GIRATINA_ORIGIN rule). The boss
// fight uses run.js bossConfig (a legendary boss is never caught).
export const SINNOH_LEGENDS = {
  LEGEND_GIRATINA_ORIGIN: { species: 'GIRATINA_ORIGIN', title: 'GIRATINA', terrain: 'cave', music: 'mus_vs_legend', rule: 'GIRATINA_ORIGIN', moves: ['SHADOW_CLAW', 'DRAGON_CLAW', 'EARTH_POWER', 'AURA_SPHERE'] },
};

// The lake guardians as the acts' optional legendary node (acts.js BIRDS): unique held item + deck if caught.
// fightMoves: what it fights with (default: its learnset at that level, which in act 1 means REST and a stall: the
// boss gauntlet's first run had MESPRIT healing 74% of the damage it took); lvl: levels on top of TUNING.bird.lvl
// (MESPRIT is the first act-1 legendary node of any region).
export const SINNOH_BIRDS = {
  LEGEND_MESPRIT: { item: 'EMOTION_GEM', moves: ['CONFUSION', 'SWIFT', 'CHARM', 'FUTURE_SIGHT'], fightMoves: ['CONFUSION', 'SWIFT', 'CHARM', 'GROWL'], lvl: -3 },
  LEGEND_AZELF: { item: 'WILLPOWER_GEM', moves: ['CONFUSION', 'SWIFT', 'NASTY_PLOT', 'EXTRASENSORY'], fightMoves: ['CONFUSION', 'SWIFT', 'UPROAR', 'QUICK_ATTACK'] },
  LEGEND_UXIE: { item: 'KNOWLEDGE_GEM', moves: ['CONFUSION', 'SWIFT', 'YAWN', 'EXTRASENSORY'], fightMoves: ['CONFUSION', 'SWIFT', 'YAWN', 'EXTRASENSORY'] },
};
export const SINNOH_BIRD_PARTNER = { LEGEND_MESPRIT: 'LEGEND_AZELF', LEGEND_AZELF: 'LEGEND_UXIE', LEGEND_UXIE: 'LEGEND_MESPRIT' };

// The Sinnoh starters (unlocked by act clears like every non-KANTO starter) and BARRY's counter-picks.
export const SINNOH_STARTERS = ['TURTWIG', 'CHIMCHAR', 'PIPLUP'];
export const SINNOH_STARTER_DECKS = [
  { species: 'TURTWIG', moves: ['TACKLE', 'WITHDRAW', 'ABSORB', 'RAZOR_LEAF'] },
  { species: 'CHIMCHAR', moves: ['SCRATCH', 'LEER', 'EMBER', 'TAUNT'] },
  { species: 'PIPLUP', moves: ['POUND', 'GROWL', 'BUBBLE', 'PECK'] },
];
export const BARRY_STARTER = { TURTWIG: 'CHIMCHAR', CHIMCHAR: 'PIPLUP', PIPLUP: 'TURTWIG' };

// Pre-battle lines (our own writing). {S} = your starter, {R} = BARRY's ace.
export const BARRY_INTROS = {
  BARRY: ["BARRY: Hey! There you are! What took you so long? I'm fining you 10 million for being late!", 'BARRY: I picked {R} because it beats your {S}. Ready or not, here I come!'],
  BARRY_2: ['BARRY: Whoa, whoa! You again? I just got my second badge, so I am totally on a roll!', 'BARRY: My {R} has been training nonstop. Hurry up and battle me!'],
  BARRY_3: ["BARRY: Listen! I'm going to be the strongest trainer in SINNOH, stronger than my dad!", "BARRY: {R} and I won't lose this time. If we do, I'm fining myself!"],
};

// Sinnoh's GYM badges (bosses.js rule names; items.js BADGES). No badge art in FireRed: shown with an item icon.
// Balance (Notion "making acts 3-5 a real threat"): no new generic always-on damage %, which piles up in the item pool;
// flat damage, utility and combo-linked bonuses instead.
export const SINNOH_BADGES = {
  COAL: { name: 'COAL BADGE', leader: 'ROARK', icon: 'HARD_STONE', desc: '+8 damage on every hand.', onHand(s) { s.flat(8, 'COAL'); } },
  FOREST: { name: 'FOREST BADGE', leader: 'GARDENIA', icon: 'MIRACLE_SEED', desc: 'Your party heals 10% after every battle.', mods: { postHeal: 0.1 } },
  RELIC: { name: 'RELIC BADGE', leader: 'FANTINA', icon: 'SPELL_TAG', desc: '+1 discard each battle.', mods: { discards: 1 } },
  COBBLE: { name: 'COBBLE BADGE', leader: 'MAYLENE', icon: 'BLACK_BELT', desc: 'Physical cards deal +30% damage.', cardPct(c) { return c.physical ? 30 : 0; } },
  FEN: { name: 'FEN BADGE', leader: 'WAKE', icon: 'MYSTIC_WATER', desc: '+1 hand size.', mods: { handSize: 1 } },
  MINE: { name: 'MINE BADGE', leader: 'BYRON', icon: 'METAL_COAT', desc: 'Your POKéMON take 15% less damage.', mods: { dmgTaken: -0.15 } },
  ICICLE: { name: 'ICICLE BADGE', leader: 'CANDICE', icon: 'NEVER_MELT_ICE', desc: 'Special cards deal +30% damage.', cardPct(c) { return c.physical ? 0 : 30; } },
  BEACON: { name: 'BEACON BADGE', leader: 'VOLKNER', icon: 'MAGNET', desc: '+80% damage on FULL HOUSE or better.', onHand(s) { if (s.comboRank >= 4) s.pct(80, 'BEACON'); } },
};

// GIRATINA ORIGIN (see the header): merged into D.species after the Gen 4 species (data.js loadData). Add-only.
export const GIRATINA_ORIGIN_STATS = { hp: 150, atk: 120, def: 100, spa: 120, spd: 100, spe: 90 };
export function applySinnoh(D) {
  const g = D.species?.GIRATINA;
  if (!g || D.species.GIRATINA_ORIGIN) return 0;
  const o = structuredClone(g);
  Object.assign(o, {
    stats: { ...GIRATINA_ORIGIN_STATS }, abilities: ['LEVITATE'], form: true, formOf: 'GIRATINA', formName: 'ORIGIN FORME',
    gfxDir: 'gfx/platinum/pokemon/giratina_origin', evolutions: [],
  });
  delete o.gen4Abilities;
  D.species.GIRATINA_ORIGIN = o;
  return 1;
}
