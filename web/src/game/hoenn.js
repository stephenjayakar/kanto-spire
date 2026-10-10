// World 2: HOENN. FireRed's data keeps the Ruby/Sapphire trainer pics, classes and every Gen 3 species, but the Hoenn
// trainers' parties are dummies, so their teams are authored here. v0.3.25: Pokemon EMERALD's teams (generated from the
// pokeemerald decomp by tools/emerald_parties.mjs; they used to be Ruby/Sapphire's). Only species, movesets and each
// team's level spread are Emerald's: run.js rescales the levels to the act (boss level, floor level, ascension), IVs
// stay the game's authored 120 and held items are ignored, so the balance knobs (TUNING, worldScale) keep their meaning.
// EMERALD's story: the 8th GYM LEADER is JUAN (the LEADER_WALLACE slot) and the CHAMPION is WALLACE (the RS_CHAMPION
// slot); STEVEN is a post-game trainer (EM_STEVEN, SKY PILLAR act). The keys stay, so saved runs keep their bosses.
import { RARE_LEGEND, ULTRA_RARE_LEGEND } from './gen4.js';

const L = (species, level, moves) => ({ species, level, iv: 120, moves: moves || null, item: null });

export const HOENN_PARTIES = {
  LEADER_ROXANNE: [L('GEODUDE', 12, ['TACKLE', 'DEFENSE_CURL', 'ROCK_THROW', 'ROCK_TOMB']), L('GEODUDE', 12, ['TACKLE', 'DEFENSE_CURL', 'ROCK_THROW', 'ROCK_TOMB']), L('NOSEPASS', 15, ['BLOCK', 'HARDEN', 'TACKLE', 'ROCK_TOMB'])], // Roxanne1
  LEADER_BRAWLY: [L('MACHOP', 16, ['KARATE_CHOP', 'LOW_KICK', 'SEISMIC_TOSS', 'BULK_UP']), L('MEDITITE', 16, ['FOCUS_PUNCH', 'LIGHT_SCREEN', 'REFLECT', 'BULK_UP']), L('MAKUHITA', 19, ['ARM_THRUST', 'VITAL_THROW', 'REVERSAL', 'BULK_UP'])], // Brawly1
  LEADER_WATTSON: [L('VOLTORB', 20, ['ROLLOUT', 'SPARK', 'SELF_DESTRUCT', 'SHOCK_WAVE']), L('ELECTRIKE', 20, ['SHOCK_WAVE', 'LEER', 'QUICK_ATTACK', 'HOWL']), L('MAGNETON', 22, ['SUPERSONIC', 'SHOCK_WAVE', 'THUNDER_WAVE', 'SONIC_BOOM']), L('MANECTRIC', 24, ['QUICK_ATTACK', 'THUNDER_WAVE', 'SHOCK_WAVE', 'HOWL'])], // Wattson1
  LEADER_FLANNERY: [L('NUMEL', 24, ['OVERHEAT', 'TAKE_DOWN', 'MAGNITUDE', 'SUNNY_DAY']), L('SLUGMA', 24, ['OVERHEAT', 'SMOG', 'LIGHT_SCREEN', 'SUNNY_DAY']), L('CAMERUPT', 26, ['OVERHEAT', 'TACKLE', 'SUNNY_DAY', 'ATTRACT']), L('TORKOAL', 29, ['OVERHEAT', 'SUNNY_DAY', 'BODY_SLAM', 'ATTRACT'])], // Flannery1
  LEADER_NORMAN: [L('SPINDA', 27, ['TEETER_DANCE', 'PSYBEAM', 'FACADE', 'ENCORE']), L('VIGOROTH', 27, ['SLASH', 'FACADE', 'ENCORE', 'FAINT_ATTACK']), L('LINOONE', 29, ['SLASH', 'BELLY_DRUM', 'FACADE', 'HEADBUTT']), L('SLAKING', 31, ['COUNTER', 'YAWN', 'FACADE', 'FAINT_ATTACK'])], // Norman1
  LEADER_WINONA: [L('SWABLU', 29, ['PERISH_SONG', 'MIRROR_MOVE', 'SAFEGUARD', 'AERIAL_ACE']), L('TROPIUS', 29, ['SUNNY_DAY', 'AERIAL_ACE', 'SOLAR_BEAM', 'SYNTHESIS']), L('PELIPPER', 30, ['WATER_GUN', 'SUPERSONIC', 'PROTECT', 'AERIAL_ACE']), L('SKARMORY', 31, ['SAND_ATTACK', 'FURY_ATTACK', 'STEEL_WING', 'AERIAL_ACE']), L('ALTARIA', 33, ['EARTHQUAKE', 'DRAGON_BREATH', 'DRAGON_DANCE', 'AERIAL_ACE'])], // Winona1
  LEADER_TATE_LIZA: [L('CLAYDOL', 41, ['EARTHQUAKE', 'ANCIENT_POWER', 'PSYCHIC', 'LIGHT_SCREEN']), L('XATU', 41, ['PSYCHIC', 'SUNNY_DAY', 'CONFUSE_RAY', 'CALM_MIND']), L('LUNATONE', 42, ['LIGHT_SCREEN', 'PSYCHIC', 'HYPNOSIS', 'CALM_MIND']), L('SOLROCK', 42, ['SUNNY_DAY', 'SOLAR_BEAM', 'PSYCHIC', 'FLAMETHROWER'])], // TateAndLiza1
  LEADER_WALLACE: [L('LUVDISC', 41, ['WATER_PULSE', 'ATTRACT', 'SWEET_KISS', 'FLAIL']), L('WHISCASH', 41, ['RAIN_DANCE', 'WATER_PULSE', 'AMNESIA', 'EARTHQUAKE']), L('SEALEO', 43, ['ENCORE', 'BODY_SLAM', 'AURORA_BEAM', 'WATER_PULSE']), L('CRAWDAUNT', 43, ['WATER_PULSE', 'CRABHAMMER', 'TAUNT', 'LEER']), L('KINGDRA', 46, ['WATER_PULSE', 'DOUBLE_TEAM', 'ICE_BEAM', 'REST'])], // Juan1
  ELITE_FOUR_SIDNEY: [L('MIGHTYENA', 46, ['ROAR', 'DOUBLE_EDGE', 'SAND_ATTACK', 'CRUNCH']), L('SHIFTRY', 48, ['TORMENT', 'DOUBLE_TEAM', 'SWAGGER', 'EXTRASENSORY']), L('CACTURNE', 46, ['LEECH_SEED', 'FAINT_ATTACK', 'NEEDLE_ARM', 'COTTON_SPORE']), L('CRAWDAUNT', 48, ['SURF', 'SWORDS_DANCE', 'STRENGTH', 'FACADE']), L('ABSOL', 49, ['AERIAL_ACE', 'ROCK_SLIDE', 'SWORDS_DANCE', 'SLASH'])], // Sidney
  ELITE_FOUR_PHOEBE: [L('DUSCLOPS', 48, ['SHADOW_PUNCH', 'CONFUSE_RAY', 'CURSE', 'PROTECT']), L('BANETTE', 49, ['SHADOW_BALL', 'GRUDGE', 'WILL_O_WISP', 'FAINT_ATTACK']), L('SABLEYE', 50, ['SHADOW_BALL', 'DOUBLE_TEAM', 'NIGHT_SHADE', 'FAINT_ATTACK']), L('BANETTE', 49, ['SHADOW_BALL', 'PSYCHIC', 'THUNDERBOLT', 'FACADE']), L('DUSCLOPS', 51, ['SHADOW_BALL', 'ICE_BEAM', 'ROCK_SLIDE', 'EARTHQUAKE'])], // Phoebe
  ELITE_FOUR_GLACIA: [L('SEALEO', 50, ['ENCORE', 'BODY_SLAM', 'HAIL', 'ICE_BALL']), L('GLALIE', 50, ['LIGHT_SCREEN', 'CRUNCH', 'ICY_WIND', 'ICE_BEAM']), L('SEALEO', 52, ['ATTRACT', 'DOUBLE_EDGE', 'HAIL', 'BLIZZARD']), L('GLALIE', 52, ['SHADOW_BALL', 'EXPLOSION', 'HAIL', 'ICE_BEAM']), L('WALREIN', 53, ['SURF', 'BODY_SLAM', 'ICE_BEAM', 'SHEER_COLD'])], // Glacia
  ELITE_FOUR_DRAKE: [L('SHELGON', 52, ['ROCK_TOMB', 'DRAGON_CLAW', 'PROTECT', 'DOUBLE_EDGE']), L('ALTARIA', 54, ['DOUBLE_EDGE', 'DRAGON_BREATH', 'DRAGON_DANCE', 'AERIAL_ACE']), L('KINGDRA', 53, ['SMOKESCREEN', 'DRAGON_DANCE', 'SURF', 'BODY_SLAM']), L('FLYGON', 53, ['FLAMETHROWER', 'CRUNCH', 'DRAGON_BREATH', 'EARTHQUAKE']), L('SALAMENCE', 55, ['FLAMETHROWER', 'DRAGON_CLAW', 'ROCK_SLIDE', 'CRUNCH'])], // Drake
  RS_CHAMPION: [L('WAILORD', 57, ['RAIN_DANCE', 'WATER_SPOUT', 'DOUBLE_EDGE', 'BLIZZARD']), L('TENTACRUEL', 55, ['TOXIC', 'HYDRO_PUMP', 'SLUDGE_BOMB', 'ICE_BEAM']), L('LUDICOLO', 56, ['GIGA_DRAIN', 'SURF', 'LEECH_SEED', 'DOUBLE_TEAM']), L('WHISCASH', 56, ['EARTHQUAKE', 'SURF', 'AMNESIA', 'HYPER_BEAM']), L('GYARADOS', 56, ['DRAGON_DANCE', 'EARTHQUAKE', 'HYPER_BEAM', 'SURF']), L('MILOTIC', 58, ['RECOVER', 'SURF', 'ICE_BEAM', 'TOXIC'])], // Wallace
  AQUA_GRUNT_M: [L('ZUBAT', 14), L('CARVANHA', 14)], // GruntMuseum2
  AQUA_GRUNT_F: [L('ZUBAT', 27), L('POOCHYENA', 27)], // GruntWeatherInst5
  MAGMA_GRUNT_M: [L('POOCHYENA', 22), L('NUMEL', 22)], // GruntJaggedPass
  AQUA_ADMIN_MATT: [L('MIGHTYENA', 34), L('GOLBAT', 34)], // Matt
  AQUA_ADMIN_SHELLY: [L('CARVANHA', 28), L('MIGHTYENA', 28)], // ShellyWeatherInstitute
  MAGMA_ADMIN_TABITHA: [L('NUMEL', 18), L('POOCHYENA', 20), L('NUMEL', 22), L('ZUBAT', 22)], // TabithaMtChimney
  MAGMA_ADMIN_COURTNEY: [L('CAMERUPT', 38), L('MIGHTYENA', 38)], // (not fought in Emerald: her Ruby/Sapphire team)
  MAGMA_LEADER: [L('MIGHTYENA', 37), L('CROBAT', 38), L('CAMERUPT', 39)], // MaxieMagmaHideout
  AQUA_LEADER: [L('MIGHTYENA', 41), L('CROBAT', 41), L('SHARPEDO', 43)], // Archie
  MAY: [L('LOTAD', 13), L('TORCHIC', 15)], // MayRustboroTreecko
  MAY_2: [L('WINGULL', 18), L('LOMBRE', 18), L('COMBUSKEN', 20)], // MayRoute110Treecko
  MAY_3: [L('TROPIUS', 31), L('PELIPPER', 32), L('LUDICOLO', 32), L('COMBUSKEN', 34)], // MayLilycoveTreecko
};

// Display for the trainers above (data.js applies it): the shown name, Emerald's portrait (gfx/trainers/emerald/, the
// optional 'emerald' asset pack: tools/extract_emerald.py) and the FireRed pic shown without it (picFallback).
const em = (pic, picFallback, name) => ({ pic: 'emerald/' + pic, picFallback, ...(name ? { name } : {}) });
export const HOENN_TRAINER_INFO = {
  LEADER_ROXANNE: em('leader_roxanne', 'leader_roxanne'), LEADER_BRAWLY: em('leader_brawly', 'leader_brawly'),
  LEADER_WATTSON: em('leader_wattson', 'leader_wattson'), LEADER_FLANNERY: em('leader_flannery', 'leader_flannery'),
  LEADER_NORMAN: em('leader_norman', 'leader_norman'), LEADER_WINONA: em('leader_winona', 'leader_winona'),
  LEADER_TATE_LIZA: em('leader_tate_and_liza', 'leader_tate_and_liza', 'TATE & LIZA'),
  LEADER_WALLACE: em('leader_juan', 'rs_gentleman', 'JUAN'),
  ELITE_FOUR_SIDNEY: em('elite_four_sidney', 'elite_four_sidney'), ELITE_FOUR_PHOEBE: em('elite_four_phoebe', 'elite_four_phoebe'),
  ELITE_FOUR_GLACIA: em('elite_four_glacia', 'elite_four_glacia'), ELITE_FOUR_DRAKE: em('elite_four_drake', 'elite_four_drake'),
  RS_CHAMPION: em('champion_wallace', 'leader_wallace', 'WALLACE'),
  AQUA_GRUNT_M: em('aqua_grunt_m', 'aqua_grunt_m'), AQUA_GRUNT_F: em('aqua_grunt_f', 'aqua_grunt_f'),
  MAGMA_GRUNT_M: em('magma_grunt_m', 'magma_grunt_m'), AQUA_ADMIN_MATT: em('aqua_admin_m', 'aqua_admin_m'),
  AQUA_ADMIN_SHELLY: em('aqua_admin_f', 'aqua_admin_f'), MAGMA_ADMIN_TABITHA: em('magma_admin', 'magma_admin_m'),
  MAGMA_LEADER: em('magma_leader_maxie', 'magma_leader_maxie'), AQUA_LEADER: em('aqua_leader_archie', 'aqua_leader_archie'),
  MAY: em('may', 'ruby_sapphire_may', 'MAY'), MAY_2: em('may', 'ruby_sapphire_may', 'MAY'), MAY_3: em('may', 'ruby_sapphire_may', 'MAY'),
};

// HOENN trainers FireRed's data doesn't have at all (whole trainer objects, like johto.js's).
export const HOENN_TRAINERS = {
  // Emerald's post-game STEVEN (METEOR FALLS): an elite of the SKY PILLAR act
  EM_STEVEN: { class: 'RS_CHAMPION', className: 'PKMN TRAINER', name: 'STEVEN', pic: 'emerald/steven', picFallback: 'champion_steven',
    battleSong: 'MUS_VS_CHAMPION', encounterSong: 'MUS_ENCOUNTER_GYM_LEADER', terrain: 'cave',
    party: [L('SKARMORY', 77, ['TOXIC', 'AERIAL_ACE', 'SPIKES', 'STEEL_WING']), L('CLAYDOL', 75, ['REFLECT', 'LIGHT_SCREEN', 'ANCIENT_POWER', 'EARTHQUAKE']), L('AGGRON', 76, ['THUNDER', 'EARTHQUAKE', 'SOLAR_BEAM', 'DRAGON_CLAW']), L('CRADILY', 76, ['GIGA_DRAIN', 'ANCIENT_POWER', 'INGRAIN', 'CONFUSE_RAY']), L('ARMALDO', 76, ['WATER_PULSE', 'ANCIENT_POWER', 'AERIAL_ACE', 'SLASH']), L('METAGROSS', 78, ['EARTHQUAKE', 'PSYCHIC', 'METEOR_MASH', 'SHADOW_BALL'])] },
};

// Generic Hoenn trainers: RS trainer classes (real pics/classes in FireRed's data) with names.
export const HOENN_TRAINER_CLASSES = [
  ['RS_YOUNGSTER', ['JOEY', 'CALVIN', 'ALLEN', 'TIMMY', 'BEN']], ['RS_LASS', ['TIANA', 'HALEY', 'JANICE', 'SALLY']], ['RS_BUG_CATCHER', ['RICK', 'JOSE', 'GREG', 'LYLE']],
  ['RS_HIKER', ['CLARK', 'DEVAN', 'MARC', 'LUCAS']], ['RS_CAMPER', ['DREW', 'LARRY', 'SHANE', 'ETHAN']], ['RS_PICNICKER', ['DIANA', 'IRENE', 'CAROL', 'KELSEY']],
  ['RS_FISHERMAN', ['DARIAN', 'ELLIOT', 'ROGER', 'CARTER']], ['RS_SAILOR', ['DUNCAN', 'HUEY', 'EDMOND', 'ERNEST']], ['RS_BLACK_BELT', ['TAKAO', 'HITOSHI', 'KOICHI', 'NOB']],
  ['RS_PSYCHIC_M', ['EDWARD', 'PRESTON', 'MAURA', 'JACKI']], ['RS_PSYCHIC_F', ['ALEXIS', 'SAMANTHA', 'KAYLA', 'HANNAH']], ['RS_BIRD_KEEPER', ['COLIN', 'JOSUE', 'ROBERT', 'BENNY']],
  ['RS_SWIMMER_M', ['HAROLD', 'DAVID', 'JOSEPH', 'DEAN']], ['RS_SWIMMER_F', ['LAUREL', 'DENISE', 'NIKKI', 'SHANNON']], ['RS_COOLTRAINER_M', ['ALBERT', 'MARCEL', 'WILTON', 'COLE']],
  ['RS_COOLTRAINER_F', ['MARLEY', 'ANNA', 'CATHY', 'MIRIAM']], ['RS_RUIN_MANIAC', ['DAWSON', 'BRYAN', 'ANDRES']], ['RS_AROMA_LADY', ['ROSE', 'VIOLET', 'DAISY']],
  ['RS_PKMN_RANGER_M', ['JACKSON', 'CATHERINE', 'LOGAN']], ['RS_GENTLEMAN', ['WALTER', 'THOMAS', 'TUCKER']], ['RS_BEAUTY', ['JESSICA', 'BRIDGET', 'OLIVIA']],
  ['RS_TWINS', ['AMY & LIV', 'GINA & MIA', 'TORI & TIA']], ['RS_POKEMANIAC', ['STEVE', 'MARK', 'COOPER']],
];

const area = (name, terrain, from, pool, music) => ({ name, terrain, from, pool, music });

export const HOENN_ACTS = [
  {
    id: 1, region: 'hoenn', name: 'LITTLEROOT → DEWFORD', short: 'HOENN 1', floors: 15, levels: [4, 13], bossLevel: 16,
    music: ['mus_route1', 'mus_route3'], townMusic: 'mus_pallet',
    areas: [
      area('ROUTE 101', 'grass', 0, ['POOCHYENA', 'ZIGZAGOON', 'WURMPLE']),
      area('ROUTE 102', 'grass', 0, ['POOCHYENA', 'ZIGZAGOON', 'WURMPLE', 'LOTAD', 'SEEDOT', 'RALTS']),
      area('ROUTE 104', 'grass', 0.15, ['ZIGZAGOON', 'WURMPLE', 'MARILL', 'TAILLOW', 'WINGULL']),
      area('PETALBURG WOODS', 'longgrass', 0.25, ['WURMPLE', 'SILCOON', 'CASCOON', 'SHROOMISH', 'SLAKOTH', 'TAILLOW'], 'mus_viridian_forest'),
      area('ROUTE 116', 'grass', 0.4, ['WHISMUR', 'NINCADA', 'SKITTY', 'ABRA', 'TAILLOW']),
      area('RUSTURF TUNNEL', 'cave', 0.5, ['WHISMUR'], 'mus_mt_moon'),
      area('GRANITE CAVE', 'cave', 0.6, ['ZUBAT', 'MAKUHITA', 'GEODUDE', 'ABRA', 'ARON', 'SABLEYE', 'MAWILE'], 'mus_mt_moon'),
    ],
    elites: ['AQUA_GRUNT_M', 'MAGMA_GRUNT_M', 'AQUA_GRUNT_F'],
    rival: 'MAY',
    bosses: ['LEADER_ROXANNE', 'LEADER_BRAWLY'],
  },
  {
    id: 2, region: 'hoenn', name: 'MAUVILLE → PETALBURG', short: 'HOENN 2', floors: 15, levels: [15, 26], bossLevel: 28,
    music: ['mus_route3', 'mus_cycling', 'mus_route11'], townMusic: 'mus_vermillion',
    areas: [
      area('ROUTE 110', 'grass', 0, ['ELECTRIKE', 'GULPIN', 'ODDISH', 'PLUSLE', 'MINUN', 'WINGULL', 'POOCHYENA']),
      area('ROUTE 117', 'grass', 0, ['ZIGZAGOON', 'MARILL', 'ODDISH', 'ROSELIA', 'ILLUMISE', 'VOLBEAT', 'SEEDOT']),
      area('ROUTE 111 DESERT', 'sand', 0.2, ['SANDSHREW', 'TRAPINCH', 'CACNEA', 'BALTOY']),
      area('FIERY PATH', 'cave', 0.3, ['NUMEL', 'SLUGMA', 'GRIMER', 'KOFFING', 'TORKOAL', 'MACHOP'], 'mus_mt_moon'),
      area('ROUTE 113', 'sand', 0.4, ['SPINDA', 'SLUGMA', 'SKARMORY']),
      area('JAGGED PASS', 'mountain', 0.5, ['NUMEL', 'MACHOP', 'SPOINK']),
      area('ROUTE 114', 'grass', 0.6, ['SWABLU', 'LOTAD', 'LOMBRE', 'SEVIPER', 'ZANGOOSE', 'NUZLEAF']),
      area('METEOR FALLS', 'cave', 0.7, ['ZUBAT', 'GOLBAT', 'SOLROCK', 'LUNATONE', 'BAGON'], 'mus_mt_moon'),
    ],
    elites: ['MAGMA_ADMIN_TABITHA', 'AQUA_ADMIN_SHELLY', 'AQUA_GRUNT_F'],
    rival: 'MAY_2', bird: 'LEGEND_REGIROCK', // REGIROCK: DESERT RUINS on ROUTE 111
    bosses: ['LEADER_WATTSON', 'LEADER_FLANNERY', 'LEADER_NORMAN'],
  },
  {
    id: 3, region: 'hoenn', name: 'FORTREE → SOOTOPOLIS', short: 'HOENN 3', floors: 15, levels: [26, 37], bossLevel: 39,
    music: ['mus_route11', 'mus_surf', 'mus_poke_tower'], townMusic: 'mus_fuchsia',
    areas: [
      area('ROUTE 119', 'longgrass', 0, ['ODDISH', 'GLOOM', 'TROPIUS', 'KECLEON', 'LINOONE', 'TENTACOOL', 'FEEBAS']),
      area('ROUTE 120', 'grass', 0, ['ODDISH', 'GLOOM', 'MARILL', 'ABSOL', 'KECLEON', 'MIGHTYENA', 'SEEDOT']),
      area('MT. PYRE', 'building', 0.2, ['SHUPPET', 'DUSKULL', 'CHIMECHO', 'VULPIX', 'WINGULL'], 'mus_poke_tower'),
      area('ROUTE 123', 'grass', 0.3, ['GLOOM', 'MIGHTYENA', 'SHUPPET', 'KECLEON', 'LINOONE', 'WINGULL']),
      area('SHOAL CAVE', 'cave', 0.4, ['SPHEAL', 'SNORUNT', 'ZUBAT', 'GOLBAT'], 'mus_mt_moon'),
      area('ROUTE 124 SEA', 'water', 0.5, ['TENTACOOL', 'WINGULL', 'PELIPPER', 'CHINCHOU', 'HORSEA', 'CLAMPERL', 'RELICANTH']),
      area('SEAFLOOR CAVERN', 'cave', 0.7, ['ZUBAT', 'GOLBAT', 'TENTACRUEL', 'SEALEO', 'WAILMER'], 'mus_mt_moon'),
      area('ROUTE 128', 'water', 0.8, ['LUVDISC', 'CORSOLA', 'WAILMER', 'SHARPEDO', 'LANTURN']),
    ],
    elites: ['AQUA_ADMIN_MATT', 'MAGMA_ADMIN_COURTNEY', 'MAGMA_LEADER', 'AQUA_LEADER'],
    rival: 'MAY_3', bird: 'LEGEND_REGICE', // REGICE: ISLAND CAVE
    rareLegends: [['LEGEND_PHIONE', ULTRA_RARE_LEGEND]], // (v0.4.0: rare legendary elites, Run.eliteConfig)
    bosses: ['LEADER_WINONA', 'LEADER_TATE_LIZA', 'LEADER_WALLACE'],
  },
  {
    id: 4, region: 'hoenn', name: 'VICTORY ROAD → EVER GRANDE', short: 'HOENN 4', floors: 7, finale: true, levels: [37, 42], bossLevel: 46,
    music: ['mus_victory_road'], townMusic: 'mus_poke_center',
    areas: [
      area('VICTORY ROAD', 'cave', 0, ['GOLBAT', 'HARIYAMA', 'LAIRON', 'LOUDRED', 'MEDICHAM', 'MAWILE', 'SABLEYE'], 'mus_victory_road'),
      area('EVER GRANDE CITY', 'grass', 0.5, ['ALTARIA', 'SHELGON', 'MANECTRIC', 'BANETTE', 'DUSCLOPS', 'MIGHTYENA']),
    ],
    elites: ['LEGEND_LATIOS', 'LEGEND_LATIAS', 'RS_COOLTRAINER_M'],
    bird: 'LEGEND_REGISTEEL', // REGISTEEL: ANCIENT TOMB
    rareLegends: [['LEGEND_HEATRAN', RARE_LEGEND]],
    gauntlet: ['ELITE_FOUR_SIDNEY', 'ELITE_FOUR_PHOEBE', 'ELITE_FOUR_GLACIA', 'ELITE_FOUR_DRAKE', 'RS_CHAMPION'],
    gauntletLevels: [44, 45, 46, 47, 50],
  },
  {
    id: 5, region: 'hoenn', name: 'SKY PILLAR', short: 'POST-GAME', floors: 10, postgame: true, levels: [50, 60], bossLevel: 70,
    music: ['mus_sevii_dungeon', 'mus_sevii_cave'], townMusic: 'mus_sevii_45',
    areas: [
      area('SAFARI ZONE', 'longgrass', 0, ['PHANPY', 'HERACROSS', 'GIRAFARIG', 'AIPOM', 'NATU', 'WOOPER', 'PINSIR', 'DODRIO']),
      area('SKY PILLAR', 'mountain', 0.3, ['GOLBAT', 'SABLEYE', 'CLAYDOL', 'BANETTE', 'MAWILE', 'ALTARIA']),
      area('SEALED CHAMBER', 'cave', 0.6, ['ZUBAT', 'TENTACRUEL', 'WAILORD', 'RELICANTH', 'LANTURN']),
    ],
    elites: ['LEGEND_GROUDON', 'LEGEND_KYOGRE', 'LEGEND_JIRACHI', 'LEGEND_CELEBI', 'EM_STEVEN'],
    rareLegends: [['LEGEND_REGIGIGAS', RARE_LEGEND], ['LEGEND_MANAPHY', ULTRA_RARE_LEGEND]], // (REGIGIGAS: the REGIS' master)
    bosses: ['LEGEND_RAYQUAZA'],
  },
];

// v0.3.25: species the pools above leave out, added to HOENN's wild areas (act id -> area name) so every Pokédex species
// can be caught somewhere (regions.js withFinds: extra = half as common as an average species there, rare = a rare find).
// Strong and special species are rare finds, and late: the starters' final forms in act 4, SALAMENCE / METAGROSS /
// SLAKING in the post-game. v0.4.0: + Gen 4 (the CHIMCHAR line, GIBLE ... GARCHOMP, the fossils' final forms...).
export const HOENN_FINDS = {
  1: {
    'ROUTE 101': { rare: ['TORCHIC'] },
    'ROUTE 102': { extra: ['SURSKIT', 'HAPPINY'], rare: ['TREECKO'] },
    'ROUTE 104': { extra: ['AZURILL'], rare: ['MUDKIP'] },
    'PETALBURG WOODS': { extra: ['BEAUTIFLY', 'DUSTOX'] },
    'ROUTE 116': { rare: ['CHIMCHAR'] },
    'RUSTURF TUNNEL': { extra: ['WYNAUT'] },
    'GRANITE CAVE': { extra: ['NOSEPASS'] },
  },
  2: {
    'ROUTE 110': { extra: ['DELCATTY', 'SHINX'], rare: ['COMBUSKEN'] },
    'ROUTE 117': { extra: ['CORPHISH', 'KIRLIA', 'KRICKETOT'], rare: ['MARSHTOMP'] },
    'ROUTE 111 DESERT': { extra: ['VIBRAVA', 'HIPPOPOTAS'], rare: ['LILEEP', 'ANORITH', 'CACTURNE'] },
    'FIERY PATH': { extra: ['MAGCARGO'], rare: ['CAMERUPT', 'MONFERNO'] },
    'JAGGED PASS': { extra: ['MEDITITE'] },
    'ROUTE 114': { extra: ['BARBOACH', 'BIDOOF'], rare: ['GROVYLE'] },
    'METEOR FALLS': { rare: ['BELDUM', 'GIBLE'] },
  },
  3: {
    'ROUTE 119': { extra: ['CASTFORM', 'CARVANHA', 'WHISCASH', 'CRAWDAUNT'], rare: ['MILOTIC', 'LUDICOLO', 'ROSERADE'] },
    'ROUTE 120': { extra: ['MASQUERAIN', 'NINJASK', 'BRELOOM'], rare: ['SHIFTRY', 'HONCHKROW', 'LUXRAY'] },
    'MT. PYRE': { extra: ['CHINGLING', 'DRIFLOON'], rare: ['SHEDINJA', 'MISMAGIUS'] },
    'ROUTE 123': { extra: ['SWELLOW', 'GRUMPIG', 'SWALOT', 'VIGOROTH'] },
    'SHOAL CAVE': { extra: ['SNOVER'], rare: ['GLALIE', 'WALREIN', 'FROSLASS'] },
    'ROUTE 124 SEA': { extra: ['FINNEON', 'MANTYKE'], rare: ['HUNTAIL', 'GOREBYSS'] },
    'ROUTE 128': { extra: ['SHELLOS', 'BUIZEL'] },
  },
  4: {
    'VICTORY ROAD': { extra: ['EXPLOUD', 'BRONZOR'], rare: ['AGGRON', 'CROBAT', 'METANG', 'INFERNAPE'] },
    'EVER GRANDE CITY': { rare: ['SCEPTILE', 'BLAZIKEN', 'SWAMPERT', 'GARDEVOIR'] },
  },
  5: {
    'SAFARI ZONE': { rare: ['FLYGON', 'GARCHOMP', 'DRAPION'] },
    'SKY PILLAR': { rare: ['SALAMENCE', 'METAGROSS', 'SLAKING'] },
    'SEALED CHAMBER': { rare: ['CRADILY', 'ARMALDO', 'RAMPARDOS', 'BASTIODON'] },
  },
};
for (const a of HOENN_ACTS) for (const ar of a.areas) Object.assign(ar, HOENN_FINDS[a.id]?.[ar.name]);

export const HOENN_LEGENDS = {
  LEGEND_REGIROCK: { species: 'REGIROCK', title: 'REGIROCK', terrain: 'cave', music: 'mus_vs_legend' },
  LEGEND_REGICE: { species: 'REGICE', title: 'REGICE', terrain: 'cave', music: 'mus_vs_legend' },
  LEGEND_REGISTEEL: { species: 'REGISTEEL', title: 'REGISTEEL', terrain: 'cave', music: 'mus_vs_legend' },
  LEGEND_LATIOS: { species: 'LATIOS', title: 'LATIOS', terrain: 'grass', music: 'mus_vs_legend' },
  LEGEND_LATIAS: { species: 'LATIAS', title: 'LATIAS', terrain: 'grass', music: 'mus_vs_legend' },
  LEGEND_GROUDON: { species: 'GROUDON', title: 'GROUDON', terrain: 'mountain', music: 'mus_vs_deoxys' },
  LEGEND_KYOGRE: { species: 'KYOGRE', title: 'KYOGRE', terrain: 'water', music: 'mus_vs_deoxys' },
  LEGEND_JIRACHI: { species: 'JIRACHI', title: 'JIRACHI', terrain: 'grass', music: 'mus_vs_legend' },
  LEGEND_CELEBI: { species: 'CELEBI', title: 'CELEBI', terrain: 'longgrass', music: 'mus_vs_legend' },
  LEGEND_RAYQUAZA: { species: 'RAYQUAZA', title: 'RAYQUAZA', terrain: 'mountain', music: 'mus_vs_mewtwo' },
};

// Hoenn rivals by the player's starter (May keeps the counter-starter like the games).
export const HOENN_STARTERS = ['TREECKO', 'TORCHIC', 'MUDKIP'];
