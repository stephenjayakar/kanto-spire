// World 2: HOENN. FireRed's data keeps the Ruby/Sapphire trainer pics, classes and every Gen 3
// species, but the Hoenn trainers' parties are dummies — so their teams are authored here (from R/S).

const L = (species, level, moves) => ({ species, level, iv: 120, moves: moves || null, item: null });

export const HOENN_PARTIES = {
  LEADER_ROXANNE: [L('GEODUDE', 12, ['TACKLE', 'DEFENSE_CURL', 'ROCK_THROW', 'ROCK_TOMB']), L('NOSEPASS', 15, ['TACKLE', 'HARDEN', 'ROCK_THROW', 'ROCK_TOMB'])],
  LEADER_BRAWLY: [L('MACHOP', 16, ['KARATE_CHOP', 'LOW_KICK', 'SEISMIC_TOSS', 'BULK_UP']), L('MAKUHITA', 19, ['ARM_THRUST', 'VITAL_THROW', 'REVERSAL', 'BULK_UP'])],
  LEADER_WATTSON: [L('MAGNEMITE', 22, ['SUPERSONIC', 'THUNDER_WAVE', 'SONIC_BOOM', 'SHOCK_WAVE']), L('VOLTORB', 20, ['ROLLOUT', 'SPARK', 'SELF_DESTRUCT', 'SHOCK_WAVE']), L('MAGNETON', 23, ['SUPERSONIC', 'SONIC_BOOM', 'THUNDER_WAVE', 'SHOCK_WAVE'])],
  LEADER_FLANNERY: [L('SLUGMA', 26, ['OVERHEAT', 'SMOG', 'LIGHT_SCREEN', 'SUNNY_DAY']), L('SLUGMA', 26, ['OVERHEAT', 'SMOG', 'LIGHT_SCREEN', 'SUNNY_DAY']), L('TORKOAL', 28, ['OVERHEAT', 'SUNNY_DAY', 'BODY_SLAM', 'ATTRACT'])],
  LEADER_NORMAN: [L('SPINDA', 27, ['TEETER_DANCE', 'PSYBEAM', 'FACADE', 'ENCORE']), L('VIGOROTH', 27, ['SLASH', 'FACADE', 'ENCORE', 'FAINT_ATTACK']), L('SLAKING', 31, ['FACADE', 'YAWN', 'ENCORE', 'SLACK_OFF'])],
  LEADER_WINONA: [L('SWELLOW', 29, ['QUICK_ATTACK', 'AERIAL_ACE', 'DOUBLE_TEAM', 'ENDEAVOR']), L('PELIPPER', 30, ['WATER_GUN', 'SUPERSONIC', 'PROTECT', 'AERIAL_ACE']), L('SKARMORY', 32, ['SAND_ATTACK', 'FURY_ATTACK', 'STEEL_WING', 'AERIAL_ACE']), L('ALTARIA', 33, ['EARTHQUAKE', 'DRAGON_BREATH', 'DRAGON_DANCE', 'AERIAL_ACE'])],
  LEADER_TATE_LIZA: [L('CLAYDOL', 41), L('XATU', 41), L('LUNATONE', 42), L('SOLROCK', 42)],
  LEADER_WALLACE: [L('LUVDISC', 40), L('WHISCASH', 40), L('SEALEO', 40), L('SEAKING', 42), L('MILOTIC', 43, ['WATER_PULSE', 'TWISTER', 'RECOVER', 'RAIN_DANCE'])],
  // (v0.1.0: the ELITE FOUR and STEVEN use their Ruby/Sapphire movesets; their default level-up moves were mostly status)
  ELITE_FOUR_SIDNEY: [L('MIGHTYENA', 46, ['ROAR', 'DOUBLE_EDGE', 'SAND_ATTACK', 'CRUNCH']), L('SHIFTRY', 48, ['TORMENT', 'DOUBLE_TEAM', 'SWAGGER', 'EXTRASENSORY']), L('CACTURNE', 46, ['LEECH_SEED', 'FAINT_ATTACK', 'NEEDLE_ARM', 'COTTON_SPORE']), L('CRAWDAUNT', 48, ['SURF', 'SWORDS_DANCE', 'STRENGTH', 'FACADE']), L('ABSOL', 49, ['AERIAL_ACE', 'ROCK_SLIDE', 'SWORDS_DANCE', 'SLASH'])],
  ELITE_FOUR_PHOEBE: [L('DUSCLOPS', 48, ['SHADOW_PUNCH', 'CONFUSE_RAY', 'CURSE', 'PROTECT']), L('BANETTE', 49, ['SHADOW_BALL', 'GRUDGE', 'WILL_O_WISP', 'FAINT_ATTACK']), L('SABLEYE', 50, ['NIGHT_SHADE', 'PSYCHIC', 'FAINT_ATTACK', 'SHADOW_BALL']), L('BANETTE', 49, ['SHADOW_BALL', 'PSYCHIC', 'THUNDERBOLT', 'FACADE']), L('DUSCLOPS', 51, ['SHADOW_BALL', 'ICE_BEAM', 'ROCK_SLIDE', 'EARTHQUAKE'])],
  ELITE_FOUR_GLACIA: [L('SEALEO', 50, ['ENCORE', 'BODY_SLAM', 'HAIL', 'ICE_BALL']), L('GLALIE', 50, ['LIGHT_SCREEN', 'CRUNCH', 'ICY_WIND', 'ICE_BEAM']), L('SEALEO', 52, ['ATTRACT', 'DOUBLE_EDGE', 'HAIL', 'BLIZZARD']), L('GLALIE', 52, ['SHADOW_BALL', 'ICY_WIND', 'EXPLOSION', 'HAIL']), L('WALREIN', 53, ['SURF', 'BODY_SLAM', 'ICE_BEAM', 'SHEER_COLD'])],
  ELITE_FOUR_DRAKE: [L('SHELGON', 52, ['ROCK_TOMB', 'DRAGON_CLAW', 'PROTECT', 'DOUBLE_EDGE']), L('ALTARIA', 54, ['DOUBLE_EDGE', 'DRAGON_DANCE', 'EARTHQUAKE', 'AERIAL_ACE']), L('FLYGON', 53, ['FLAMETHROWER', 'CRUNCH', 'DRAGON_BREATH', 'EARTHQUAKE']), L('FLYGON', 53, ['FLAMETHROWER', 'CRUNCH', 'DRAGON_BREATH', 'EARTHQUAKE']), L('SALAMENCE', 55, ['FLAMETHROWER', 'DRAGON_CLAW', 'ROCK_SLIDE', 'CRUNCH'])],
  RS_CHAMPION: [L('SKARMORY', 57, ['TOXIC', 'AERIAL_ACE', 'SPIKES', 'STEEL_WING']), L('CLAYDOL', 55, ['REFLECT', 'LIGHT_SCREEN', 'ANCIENT_POWER', 'EARTHQUAKE']), L('AGGRON', 56, ['THUNDER', 'EARTHQUAKE', 'SOLAR_BEAM', 'DRAGON_CLAW']), L('CRADILY', 56, ['GIGA_DRAIN', 'ANCIENT_POWER', 'INGRAIN', 'CONFUSE_RAY']), L('ARMALDO', 56, ['WATER_PULSE', 'ANCIENT_POWER', 'AERIAL_ACE', 'SLASH']), L('METAGROSS', 58, ['METEOR_MASH', 'PSYCHIC', 'EARTHQUAKE', 'HYPER_BEAM'])],
  AQUA_GRUNT_M: [L('POOCHYENA', 14), L('CARVANHA', 15)],
  AQUA_GRUNT_F: [L('CARVANHA', 22), L('ZUBAT', 22)],
  MAGMA_GRUNT_M: [L('NUMEL', 18), L('POOCHYENA', 18)],
  AQUA_ADMIN_MATT: [L('MIGHTYENA', 34), L('GOLBAT', 34), L('SHARPEDO', 36)],
  AQUA_ADMIN_SHELLY: [L('CARVANHA', 28), L('MIGHTYENA', 28)],
  MAGMA_ADMIN_TABITHA: [L('NUMEL', 26), L('MIGHTYENA', 28), L('ZUBAT', 28)],
  MAGMA_ADMIN_COURTNEY: [L('CAMERUPT', 38), L('MIGHTYENA', 38)],
  MAGMA_LEADER: [L('MIGHTYENA', 41), L('CROBAT', 41), L('CAMERUPT', 43)],
  AQUA_LEADER: [L('MIGHTYENA', 41), L('CROBAT', 41), L('SHARPEDO', 43)],
  MAY: [L('WINGULL', 13), L('TORCHIC', 15)],
  MAY_2: [L('PELIPPER', 29), L('LOMBRE', 29), L('COMBUSKEN', 31)],
  MAY_3: [L('TROPIUS', 37), L('PELIPPER', 38), L('LUDICOLO', 38), L('BLAZIKEN', 40)],
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
    elites: ['LEGEND_GROUDON', 'LEGEND_KYOGRE', 'LEGEND_JIRACHI', 'LEGEND_CELEBI'],
    bosses: ['LEGEND_RAYQUAZA'],
  },
];

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
