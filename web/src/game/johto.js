// Region 3: JOHTO (v0.1.1, HeartGold). FireRed's data has every Gen 1-2 species but no Johto trainers, so the
// named trainers (GYM LEADERS, ELITE FOUR, LANCE, SILVER, RED, TEAM ROCKET) are full trainer objects authored here
// (data.js adds them to D.trainers). Parties and movesets follow HeartGold (pokeheartgold trainers.json / the ROM);
// moves the game doesn't have (ME FIRST, TOXIC SPIKES, LAST RESORT) are left out. Generic route trainers are built from the act's wild pools
// (run.js genericTrainer, JOHTO_TRAINER_CLASSES) like HOENN's.
//
// Areas: pool is { morn, day, nite } (HGSS encounter slots; regions.js timeOfDay picks one by the floor: the first
// third of an act is morning, then day, then night) or a plain list (same at every time of day).
// Trainer pics: 'hgss/<name>' = an HGSS portrait extracted by tools/extract_hgss.py into web/assets/gfx/trainers/hgss/
// (gitignored, gated 'hgss' asset pack); FireRed stand-ins until the extraction has run.

const L = (species, level, moves) => ({ species, level, iv: 120, moves: moves || null, item: null });

// A named trainer: class (FireRed trainer class, for prize money), className (shown), name, pic, party, and an
// optional rule (the boss rule it brings when its key doesn't name one: regions.js ruleKeyOf).
const T = (cls, className, name, pic, party, extra = {}) => ({ class: cls, className, name, pic, party, battleSong: 'MUS_VS_TRAINER', encounterSong: 'MUS_ENCOUNTER_BOY', ...extra });
const leader = (name, pic, party, extra) => T('LEADER', 'LEADER', name, pic, party, { battleSong: 'MUS_VS_GYM_LEADER', encounterSong: 'MUS_ENCOUNTER_GYM_LEADER', ...extra });
const e4 = (name, pic, party, extra) => T('ELITE_FOUR', 'ELITE FOUR', name, pic, party, { battleSong: 'MUS_VS_GYM_LEADER', encounterSong: 'MUS_ENCOUNTER_GYM_LEADER', ...extra });
const rocket = (className, name, pic, party, extra) => T('TEAM_ROCKET', className, name, pic, party, { battleSong: 'MUS_VS_TRAINER', encounterSong: 'MUS_ENCOUNTER_ROCKET', terrain: 'building', ...extra });

export const JOHTO_TRAINERS = {
  // ---- GYM LEADERS (HeartGold first fights; party order as in the ROM) --------------------------------------
  LEADER_FALKNER: leader('FALKNER', 'hgss/falkner', [L('PIDGEY', 9, ['TACKLE', 'SAND_ATTACK']), L('PIDGEOTTO', 13, ['TACKLE', 'ROOST', 'GUST'])], { maps: ['VIOLET_GYM'] }),
  LEADER_BUGSY: leader('BUGSY', 'hgss/bugsy', [L('SCYTHER', 17, ['QUICK_ATTACK', 'LEER', 'U_TURN', 'FOCUS_ENERGY']), L('KAKUNA', 15, ['POISON_STING']), L('METAPOD', 15, ['TACKLE'])], { maps: ['AZALEA_GYM'] }),
  LEADER_WHITNEY: leader('WHITNEY', 'hgss/whitney', [L('CLEFAIRY', 17, ['DOUBLE_SLAP', 'MIMIC', 'ENCORE', 'METRONOME']), L('MILTANK', 19, ['ROLLOUT', 'ATTRACT', 'STOMP', 'MILK_DRINK'])], { female: true, maps: ['GOLDENROD_GYM'] }),
  LEADER_MORTY: leader('MORTY', 'hgss/morty', [L('GASTLY', 21, ['LICK', 'SPITE', 'MEAN_LOOK', 'CURSE']), L('HAUNTER', 21, ['HYPNOSIS', 'DREAM_EATER', 'CURSE', 'NIGHTMARE']), L('GENGAR', 25, ['HYPNOSIS', 'SHADOW_BALL', 'MEAN_LOOK', 'SUCKER_PUNCH']), L('HAUNTER', 23, ['CURSE', 'MEAN_LOOK', 'SUCKER_PUNCH', 'NIGHT_SHADE'])], { maps: ['ECRUTEAK_GYM'] }),
  LEADER_CHUCK: leader('CHUCK', 'hgss/chuck', [L('PRIMEAPE', 29, ['LEER', 'DOUBLE_TEAM', 'FOCUS_PUNCH', 'ROCK_SLIDE']), L('POLIWRATH', 31, ['HYPNOSIS', 'SURF', 'FOCUS_PUNCH', 'BODY_SLAM'])], { maps: ['CIANWOOD_GYM'] }),
  LEADER_JASMINE: leader('JASMINE', 'hgss/jasmine', [L('MAGNEMITE', 30, ['THUNDERBOLT', 'SUPERSONIC', 'SONIC_BOOM', 'THUNDER_WAVE']), L('MAGNEMITE', 30, ['THUNDERBOLT', 'SUPERSONIC', 'SONIC_BOOM', 'THUNDER_WAVE']), L('STEELIX', 35, ['SCREECH', 'SANDSTORM', 'ROCK_THROW', 'IRON_TAIL'])], { female: true, maps: ['OLIVINE_GYM'] }),
  LEADER_PRYCE: leader('PRYCE', 'hgss/pryce', [L('SEEL', 30, ['SNORE', 'HAIL', 'ICY_WIND', 'REST']), L('DEWGONG', 32, ['SLEEP_TALK', 'ICE_SHARD', 'AURORA_BEAM', 'REST']), L('PILOSWINE', 34, ['HAIL', 'ICE_FANG', 'MUD_BOMB', 'BLIZZARD'])], { maps: ['MAHOGANY_GYM'] }),
  LEADER_CLAIR: leader('CLAIR', 'hgss/clair', [L('GYARADOS', 38, ['TWISTER', 'DRAGON_RAGE', 'BITE', 'DRAGON_PULSE']), L('DRAGONAIR', 38, ['THUNDER_WAVE', 'FIRE_BLAST', 'SLAM', 'DRAGON_PULSE']), L('DRAGONAIR', 38, ['THUNDER_WAVE', 'AQUA_TAIL', 'SLAM', 'DRAGON_PULSE']), L('KINGDRA', 41, ['SMOKESCREEN', 'HYDRO_PUMP', 'HYPER_BEAM', 'DRAGON_PULSE'])], { female: true, maps: ['BLACKTHORN_GYM'] }),
  // ---- ELITE FOUR + CHAMPION (first round) ------------------------------------------------------------------
  ELITE_FOUR_WILL: e4('WILL', 'hgss/will', [L('XATU', 40, ['U_TURN', 'CONFUSE_RAY', 'PSYCHIC']), L('JYNX', 41, ['DOUBLE_SLAP', 'LOVELY_KISS', 'ICE_PUNCH', 'PSYCHIC']), L('EXEGGUTOR', 41, ['REFLECT', 'HYPNOSIS', 'EGG_BOMB', 'PSYCHIC']), L('SLOWBRO', 41, ['CURSE', 'AMNESIA', 'WATER_PULSE', 'PSYCHIC']), L('XATU', 42, ['AERIAL_ACE', 'OMINOUS_WIND', 'CONFUSE_RAY', 'PSYCHIC'])]),
  JOHTO_E4_KOGA: e4('KOGA', 'hgss/koga', [L('ARIADOS', 40, ['POISON_JAB', 'SPIDER_WEB', 'BATON_PASS', 'GIGA_DRAIN']), L('VENOMOTH', 41, ['SUPERSONIC', 'GUST', 'PSYCHIC', 'TOXIC']), L('FORRETRESS', 43, ['PROTECT', 'SWIFT', 'EXPLOSION']), L('MUK', 42, ['MINIMIZE', 'SCREECH', 'GUNK_SHOT', 'TOXIC']), L('CROBAT', 44, ['DOUBLE_TEAM', 'QUICK_ATTACK', 'WING_ATTACK', 'POISON_FANG'])], { rule: 'KOGA' }),
  JOHTO_E4_BRUNO: e4('BRUNO', 'hgss/bruno', [L('HITMONTOP', 42, ['COUNTER', 'QUICK_ATTACK', 'DIG', 'TRIPLE_KICK']), L('HITMONLEE', 42, ['SWAGGER', 'FOCUS_ENERGY', 'HI_JUMP_KICK', 'BLAZE_KICK']), L('HITMONCHAN', 42, ['THUNDER_PUNCH', 'ICE_PUNCH', 'FIRE_PUNCH', 'BULLET_PUNCH']), L('ONIX', 43, ['DRAGON_BREATH', 'EARTHQUAKE', 'SANDSTORM', 'ROCK_SLIDE']), L('MACHAMP', 46, ['ROCK_SLIDE', 'FORESIGHT', 'REVENGE', 'CROSS_CHOP'])], { rule: 'BRUNO' }),
  ELITE_FOUR_KAREN: e4('KAREN', 'hgss/karen', [L('UMBREON', 42, ['DOUBLE_TEAM', 'CONFUSE_RAY', 'FAINT_ATTACK', 'PAYBACK']), L('VILEPLUME', 42, ['STUN_SPORE', 'ACID', 'MOONLIGHT', 'PETAL_DANCE']), L('GENGAR', 45, ['LICK', 'SPITE', 'FOCUS_BLAST', 'DESTINY_BOND']), L('MURKROW', 44, ['PLUCK', 'WHIRLWIND', 'SUCKER_PUNCH', 'FAINT_ATTACK']), L('HOUNDOOM', 47, ['NASTY_PLOT', 'DARK_PULSE', 'FLAMETHROWER', 'CRUNCH'])], { female: true }),
  CHAMPION_LANCE: T('CHAMPION', 'CHAMPION', 'LANCE', 'hgss/lance', [L('GYARADOS', 46, ['FLAIL', 'DRAGON_PULSE', 'WATERFALL', 'ICE_FANG']), L('DRAGONITE', 49, ['THUNDER_WAVE', 'DRAGON_RUSH', 'THUNDER', 'HYPER_BEAM']), L('DRAGONITE', 49, ['THUNDER_WAVE', 'DRAGON_RUSH', 'BLIZZARD', 'HYPER_BEAM']), L('AERODACTYL', 48, ['AERIAL_ACE', 'CRUNCH', 'ROCK_SLIDE', 'THUNDER_FANG']), L('CHARIZARD', 48, ['SHADOW_CLAW', 'AIR_SLASH', 'DRAGON_CLAW', 'FIRE_FANG']), L('DRAGONITE', 50, ['FIRE_BLAST', 'SAFEGUARD', 'OUTRAGE', 'HYPER_BEAM'])],
    { rule: 'LANCE_CHAMPION', champion: true, battleSong: 'MUS_VS_CHAMPION', encounterSong: 'MUS_ENCOUNTER_GYM_LEADER' }),
  // ---- the rival: SILVER. HGSS's teams for a CHIKORITA player (his ace is the CYNDAQUIL line; run.js swaps it for
  // the line that counters you): AZALEA (no movesets in the ROM: level-up moves), BURNED TOWER, GOLDENROD UNDERGROUND
  SILVER: T('RIVAL_LATE', 'RIVAL', 'SILVER', 'hgss/silver', [L('GASTLY', 14), L('ZUBAT', 16), L('QUILAVA', 18)], { encounterSong: 'MUS_ENCOUNTER_RIVAL', maps: ['AZALEA_TOWN'] }),
  SILVER_2: T('RIVAL_LATE', 'RIVAL', 'SILVER', 'hgss/silver', [L('GASTLY', 20, ['LICK', 'CONFUSE_RAY', 'MEAN_LOOK', 'CURSE']), L('MAGNEMITE', 18, ['THUNDER_WAVE', 'THUNDER_SHOCK', 'SUPERSONIC', 'SONIC_BOOM']), L('ZUBAT', 20, ['ASTONISH', 'SUPERSONIC', 'BITE', 'WING_ATTACK']), L('QUILAVA', 22, ['FLAME_WHEEL', 'SMOKESCREEN', 'EMBER', 'QUICK_ATTACK'])],
    { encounterSong: 'MUS_ENCOUNTER_RIVAL', maps: ['BURNED_TOWER_1F'] }),
  SILVER_3: T('RIVAL_LATE', 'RIVAL', 'SILVER', 'hgss/silver', [L('GOLBAT', 32, ['ASTONISH', 'BITE', 'CONFUSE_RAY', 'AIR_CUTTER']), L('MAGNEMITE', 30, ['SUPERSONIC', 'SPARK', 'SONIC_BOOM', 'THUNDER_WAVE']), L('HAUNTER', 32, ['CONFUSE_RAY', 'MEAN_LOOK', 'CURSE', 'SHADOW_BALL']), L('SNEASEL', 34, ['ICY_WIND', 'QUICK_ATTACK', 'FURY_SWIPES', 'FAINT_ATTACK']), L('QUILAVA', 34, ['SMOKESCREEN', 'SWIFT', 'QUICK_ATTACK', 'FLAME_WHEEL'])],
    { encounterSong: 'MUS_ENCOUNTER_RIVAL', maps: ['GOLDENROD_TUNNEL_B1F'] }),
  // ---- TEAM ROCKET: a grunt per act (SLOWPOKE WELL, RADIO TOWER, MAHOGANY HQ) and the executives --------------------
  JOHTO_ROCKET_GRUNT: rocket('TEAM ROCKET', 'GRUNT', 'rocket_grunt_m', [L('RATTATA', 7), L('ZUBAT', 9), L('ZUBAT', 9)], { maps: ['SLOWPOKE_WELL_B1F'] }),
  JOHTO_ROCKET_GRUNT_2: rocket('TEAM ROCKET', 'GRUNT', 'rocket_grunt_f', [L('EKANS', 21), L('ODDISH', 23), L('EKANS', 21), L('GLOOM', 24)], { female: true, maps: ['GOLDENROD_RADIO_TOWER_4F'] }),
  JOHTO_ROCKET_GRUNT_3: rocket('TEAM ROCKET', 'GRUNT', 'rocket_grunt_m', [L('ZUBAT', 16), L('GRIMER', 17), L('RATTATA', 18)], { maps: ['TEAM_ROCKET_HEADQUARTERS_B1F'] }),
  ROCKET_EXEC_PROTON_WELL: rocket('EXECUTIVE', 'PROTON', 'hgss/proton', [L('ZUBAT', 8), L('KOFFING', 12)], { maps: ['SLOWPOKE_WELL_B1F'] }),
  ROCKET_EXEC_PROTON: rocket('EXECUTIVE', 'PROTON', 'hgss/proton', [L('GOLBAT', 28, ['LEECH_LIFE', 'BITE', 'CONFUSE_RAY', 'WING_ATTACK']), L('WEEZING', 33, ['DOUBLE_HIT', 'SLUDGE', 'SMOKESCREEN', 'SMOG'])], { maps: ['GOLDENROD_RADIO_TOWER_1F'] }),
  ROCKET_EXEC_PETREL: rocket('EXECUTIVE', 'PETREL', 'hgss/petrel', [L('ZUBAT', 22), L('RATICATE', 24), L('KOFFING', 22)], { maps: ['TEAM_ROCKET_HEADQUARTERS_B2F'] }),
  ROCKET_EXEC_ARIANA: rocket('EXECUTIVE', 'ARIANA', 'hgss/ariana', [L('ARBOK', 32, ['WRAP', 'POISON_STING', 'CRUNCH', 'GLARE']), L('VILEPLUME', 32, ['MEGA_DRAIN', 'SWEET_SCENT', 'SLEEP_POWDER', 'ACID']), L('MURKROW', 32, ['WING_ATTACK', 'PURSUIT', 'ASTONISH', 'NIGHT_SHADE'])], { female: true, maps: ['GOLDENROD_RADIO_TOWER_5F'] }),
  ROCKET_EXEC_ARCHER: rocket('EXECUTIVE', 'ARCHER', 'hgss/archer', [L('HOUNDOUR', 35, ['FIRE_FANG', 'ROAR', 'BITE', 'FAINT_ATTACK']), L('KOFFING', 35, ['TACKLE', 'SLUDGE', 'SMOKESCREEN', 'HAZE']), L('HOUNDOOM', 38, ['FIRE_FANG', 'SMOG', 'BITE', 'FAINT_ATTACK'])], { maps: ['GOLDENROD_RADIO_TOWER_5F'] }),
  // ---- named JOHTO elites (HGSS teams; FireRed stand-in pics) ----------------------------------------------------
  JOHTO_ELDER_LI: T('GENTLEMAN', 'ELDER', 'LI', 'expert_m', [L('BELLSPROUT', 7), L('BELLSPROUT', 7), L('HOOTHOOT', 10)], { maps: ['SPROUT_TOWER_3F'] }),
  JOHTO_BUG_CATCHER_WADE: T('BUG_CATCHER', 'BUG CATCHER', 'WADE', 'bug_catcher', [L('CATERPIE', 2), L('CATERPIE', 2), L('WEEDLE', 3), L('CATERPIE', 2)]),
  JOHTO_BEAUTY_SAMANTHA: T('BEAUTY', 'BEAUTY', 'SAMANTHA', 'beauty', [L('MEOWTH', 16, ['SCRATCH', 'GROWL', 'BITE', 'PAY_DAY']), L('MEOWTH', 16, ['SCRATCH', 'GROWL', 'BITE', 'SLASH'])], { female: true, encounterSong: 'MUS_ENCOUNTER_GIRL', maps: ['GOLDENROD_GYM'] }),
  JOHTO_MEDIUM_MARTHA: T('CHANNELER', 'MEDIUM', 'MARTHA', 'channeler', [L('GASTLY', 18), L('HAUNTER', 20), L('GASTLY', 20)], { female: true, encounterSong: 'MUS_ENCOUNTER_GIRL', maps: ['ECRUTEAK_GYM'] }),
  JOHTO_BLACK_BELT_KIYO: T('BLACK_BELT', 'BLACK BELT', 'KIYO', 'black_belt', [L('HITMONLEE', 34), L('HITMONCHAN', 34)]),
  JOHTO_COOLTRAINER_LOLA: T('COOLTRAINER', 'ACE TRAINER', 'LOLA', 'cool_trainer_f', [L('DRATINI', 35), L('DRAGONAIR', 37)], { female: true, encounterSong: 'MUS_ENCOUNTER_GIRL', maps: ['BLACKTHORN_GYM'] }),
  JOHTO_COOLTRAINER_GAVEN: T('COOLTRAINER', 'ACE TRAINER', 'GAVEN', 'cool_trainer_m', [L('VICTREEBEL', 32, ['WRAP', 'TOXIC', 'ACID', 'RAZOR_LEAF']), L('KINGLER', 32, ['BUBBLE_BEAM', 'STOMP', 'GUILLOTINE', 'PROTECT']), L('FLAREON', 32, ['SAND_ATTACK', 'QUICK_ATTACK', 'BITE', 'EMBER'])]),
  JOHTO_COOLTRAINER_JOYCE: T('COOLTRAINER', 'ACE TRAINER', 'JOYCE', 'cool_trainer_f', [L('PIKACHU', 36, ['QUICK_ATTACK', 'DOUBLE_TEAM', 'THUNDERBOLT', 'THUNDER_WAVE']), L('BLASTOISE', 36, ['BITE', 'AQUA_TAIL', 'SURF', 'RAIN_DANCE'])], { female: true, encounterSong: 'MUS_ENCOUNTER_GIRL' }),
  // the five KIMONO GIRLS (NAOKO, SAYO, ZUKI, KUNI, MIKI), fought back to back before HO-OH, as one elite
  JOHTO_KIMONO_GIRLS: T('LADY', 'KIMONO', 'GIRLS', 'lady', [L('ESPEON', 38, ['PSYCHIC', 'PSYCH_UP', 'SWIFT']), L('JOLTEON', 38, ['THUNDERBOLT', 'DOUBLE_TEAM', 'THUNDER_WAVE']), L('UMBREON', 38, ['DARK_PULSE', 'CONFUSE_RAY', 'SHADOW_BALL']), L('VAPOREON', 38, ['SURF', 'QUICK_ATTACK', 'AURORA_BEAM']), L('FLAREON', 38, ['FIRE_BLAST', 'QUICK_ATTACK', 'WILL_O_WISP'])],
    { female: true, encounterSong: 'MUS_ENCOUNTER_GIRL', maps: ['BELL_TOWER_10F'] }),
  // ---- MT. SILVER -------------------------------------------------------------------------------------------------
  PKMN_TRAINER_RED: T('CHAMPION', 'PKMN TRAINER', 'RED', 'hgss/red', [L('PIKACHU', 88, ['VOLT_TACKLE', 'IRON_TAIL', 'QUICK_ATTACK', 'THUNDERBOLT']), L('LAPRAS', 80, ['BLIZZARD', 'BRINE', 'PSYCHIC', 'BODY_SLAM']), L('SNORLAX', 82, ['SHADOW_BALL', 'CRUNCH', 'BLIZZARD', 'GIGA_IMPACT']), L('VENUSAUR', 84, ['SLUDGE_BOMB', 'GIGA_DRAIN', 'SLEEP_POWDER', 'FRENZY_PLANT']), L('CHARIZARD', 84, ['FLARE_BLITZ', 'AIR_SLASH', 'BLAST_BURN', 'DRAGON_PULSE']), L('BLASTOISE', 84, ['FOCUS_BLAST', 'HYDRO_CANNON', 'BLIZZARD', 'FLASH_CANNON'])],
    { rule: 'RED', battleSong: 'MUS_VS_CHAMPION', encounterSong: 'MUS_ENCOUNTER_GYM_LEADER' }),
};

// Generic JOHTO route trainers: FireRed trainer keys whose class / pic stand in for HGSS's (a name is picked from the
// list: HGSS trainers of that class; the party comes from the act's wild pools).
export const JOHTO_TRAINER_CLASSES = [
  ['YOUNGSTER_BEN', ['JOEY', 'MIKEY', 'ALBERT', 'GORDON', 'SAMUEL', 'IAN', 'WARREN', 'JIMMY']], ['BUG_CATCHER_RICK', ['WADE', 'DON', 'BENNY', 'AL', 'JOSH', 'ARNIE', 'KEN', 'WAYNE']],
  ['LASS_JANICE', ['CARRIE', 'CATHY', 'KRISE', 'CONNIE', 'DANA', 'ELLEN', 'LAURA']], ['HIKER_MARCOS', ['RUSSELL', 'ANTHONY', 'BENJAMIN', 'ERIK', 'MICHAEL', 'PARRY', 'TIMOTHY', 'BAILEY']],
  ['CAMPER_LIAM', ['ROLAND', 'TODD', 'IVAN', 'ELLIOT', 'BARRY', 'TED', 'LLOYD', 'DEAN']], ['PICNICKER_KELSEY', ['LIZ', 'GINA', 'BROOKE', 'KIM', 'CINDY', 'DEBRA', 'ERIN', 'HOPE']],
  ['BIRD_KEEPER_SEBASTIAN', ['ROD', 'ABE', 'BRYAN', 'THEO', 'TOBY', 'VANCE', 'DENIS', 'HANK']], ['FISHERMAN_DALE', ['JUSTIN', 'RALPH', 'ARNOLD', 'KYLE', 'HENRY', 'MARVIN', 'TULLY', 'WILTON']],
  ['SUPER_NERD_JOVAN', ['ERIC', 'SAM', 'TYRONE', 'PAT', 'SHAWN', 'TERU', 'HUGH', 'MARKUS']], ['POKEMANIAC_MARK', ['LARRY', 'SHANE', 'BECKETT', 'BRENT', 'RON', 'ANDREW', 'CALVIN']],
  ['SCHOOL_KID_M', ['ALAN', 'JOHNNY', 'JACK', 'KIPP', 'DANNY', 'TOMMY', 'CHAD']], ['POKEFAN_M', ['DEREK', 'WILLIAM', 'ROBERT', 'JOSHUA', 'CARTER', 'TREVOR']],
  ['BLACK_BELT_KOICHI', ['KENJI', 'YOSHI', 'LAO', 'LUNG', 'NOB', 'WAI']], ['BEAUTY_BRIDGET', ['VICTORIA', 'SAMANTHA', 'CASSIE', 'CAROLINE', 'JULIA', 'VALERIE']],
  ['GENTLEMAN_THOMAS', ['PRESTON', 'EDWARD', 'GREGORY', 'ALFRED', 'MILTON']], ['PSYCHIC_JOHAN', ['NATHAN', 'FRANKLIN', 'HERMAN', 'FIDEL', 'GREG', 'NELSON', 'MARK']],
  ['COOLTRAINER_SAMUEL', ['JAKE', 'GAVEN', 'BLAKE', 'BRIAN', 'RYAN', 'PAULO', 'MIKE', 'CODY']], ['COOLTRAINER_MARY', ['JOYCE', 'JAMIE', 'REENA', 'MEGAN', 'LOIS', 'KATE', 'FRAN', 'IRENE']],
  ['CHANNELER_HOPE', ['MARTHA', 'GRACE', 'BETHANY', 'MARGARET', 'ETHEL', 'EDITH']], ['KINDLER', ['OTIS', 'RICHARD', 'NED', 'BURT', 'BILL', 'WALT', 'RAY', 'LYLE']],
  ['SAILOR_EDMOND', ['EUGENE', 'HUEY', 'TERRELL', 'KENT', 'ROBERTO', 'STANLY']], ['SWIMMER_MALE_LUIS', ['SIMON', 'RANDALL', 'CHARLIE', 'GEORGE', 'BERKE', 'RONALD', 'PARKER']],
  ['SWIMMER_FEMALE_TIFFANY', ['ELAINE', 'PAULA', 'KAYLEE', 'SUSIE', 'DENISE', 'KARA', 'WENDY']], ['BIKER_JARED', ['DWAYNE', 'HARRIS', 'ZEKE', 'CHARLES', 'REESE', 'JOEL', 'GLENN']],
  ['JUGGLER_DALTON', ['IRWIN', 'FRITZ', 'HORTON']], ['SCIENTIST_TED', ['ROSS', 'MITCH', 'GREGG', 'GARETT', 'TRENTON']], ['BURGLAR_1', ['DUNCAN', 'ORSON', 'COREY']],
];

const area = (name, terrain, from, pool, music) => ({ name, terrain, from, pool, music });

// Wild pools: HeartGold's encounter tables (pokeheartgold gs_enc_data.json, HEARTGOLD slots; walking slots ordered
// by encounter rate, then surf / rock smash / Good Rod where the area has them). Gen 3+ slots (Hoenn/Sinnoh radio,
// swarms) are left out. A few tiny tables borrow a neighbour's species to keep 3+ per pool (commented).
export const JOHTO_ACTS = [
  {
    id: 1, region: 'johto', name: 'NEW BARK → AZALEA', short: 'JOHTO 1', floors: 15, levels: [3, 12], bossLevel: 15,
    music: ['mus_route1', 'mus_route3'], townMusic: 'mus_pallet',
    areas: [
      // (night: HOOTHOOT / RATTATA, + GEODUDE from ROUTE 46, the branch off ROUTE 29)
      area('ROUTE 29', 'grass', 0, { morn: ['PIDGEY', 'SENTRET', 'RATTATA'], day: ['PIDGEY', 'SENTRET', 'RATTATA'], nite: ['HOOTHOOT', 'RATTATA', 'GEODUDE'] }),
      area('ROUTE 30', 'grass', 0, { morn: ['CATERPIE', 'PIDGEY', 'METAPOD', 'POLIWAG'], day: ['PIDGEY', 'CATERPIE', 'METAPOD', 'POLIWAG'], nite: ['RATTATA', 'SPINARAK', 'HOOTHOOT', 'POLIWAG'] }),
      area('ROUTE 31', 'grass', 0.15, { morn: ['CATERPIE', 'PIDGEY', 'BELLSPROUT', 'METAPOD'], day: ['CATERPIE', 'PIDGEY', 'BELLSPROUT', 'METAPOD'], nite: ['RATTATA', 'SPINARAK', 'BELLSPROUT', 'HOOTHOOT'] }),
      area('DARK CAVE', 'cave', 0.2, ['GEODUDE', 'ZUBAT', 'DUNSPARCE'], 'mus_mt_moon'),
      // (HGSS: RATTATA by day, GASTLY at night; + the SAGES' BELLSPROUT and HOOTHOOT)
      area('SPROUT TOWER', 'building', 0.25, { morn: ['RATTATA', 'BELLSPROUT', 'HOOTHOOT'], day: ['RATTATA', 'BELLSPROUT', 'HOOTHOOT'], nite: ['GASTLY', 'RATTATA', 'BELLSPROUT'] }, 'mus_poke_tower'),
      area('ROUTE 32', 'grass', 0.35, { morn: ['RATTATA', 'BELLSPROUT', 'MAREEP', 'HOPPIP', 'ZUBAT'], day: ['RATTATA', 'BELLSPROUT', 'MAREEP', 'HOPPIP', 'TENTACOOL'], nite: ['WOOPER', 'RATTATA', 'BELLSPROUT', 'MAREEP', 'ZUBAT'] }),
      area('RUINS OF ALPH', 'cave', 0.4, ['NATU', 'SMEARGLE', 'WOOPER', 'QUAGSIRE', 'GEODUDE'], 'mus_sevii_dungeon'),
      area('UNION CAVE', 'cave', 0.5, ['GEODUDE', 'SANDSHREW', 'ZUBAT', 'RATTATA', 'ONIX', 'WOOPER', 'GOLDEEN'], 'mus_mt_moon'),
      area('ROUTE 33', 'grass', 0.6, { morn: ['RATTATA', 'HOPPIP', 'SPEAROW', 'ZUBAT'], day: ['RATTATA', 'HOPPIP', 'SPEAROW'], nite: ['RATTATA', 'ZUBAT', 'HOPPIP'] }),
      area('SLOWPOKE WELL', 'cave', 0.7, ['ZUBAT', 'SLOWPOKE', 'GOLDEEN', 'MAGIKARP'], 'mus_rocket_hideout'),
    ],
    elites: ['JOHTO_ROCKET_GRUNT', 'ROCKET_EXEC_PROTON_WELL', 'JOHTO_ELDER_LI', 'JOHTO_BUG_CATCHER_WADE'],
    rival: 'SILVER',
    bosses: ['LEADER_FALKNER', 'LEADER_BUGSY'],
  },
  {
    id: 2, region: 'johto', name: 'GOLDENROD → ECRUTEAK', short: 'JOHTO 2', floors: 15, levels: [14, 25], bossLevel: 27,
    music: ['mus_route24', 'mus_route3', 'mus_route11'], townMusic: 'mus_celadon',
    areas: [
      area('ILEX FOREST', 'longgrass', 0, { morn: ['CATERPIE', 'METAPOD', 'PARAS', 'ZUBAT', 'PSYDUCK'], day: ['CATERPIE', 'METAPOD', 'ZUBAT', 'PARAS', 'PSYDUCK'], nite: ['ODDISH', 'ZUBAT', 'PARAS', 'PSYDUCK'] }, 'mus_viridian_forest'),
      area('ROUTE 34', 'grass', 0, ['DROWZEE', 'RATTATA', 'ABRA', 'DITTO', 'TENTACOOL', 'KRABBY']),
      area('ROUTE 35', 'grass', 0.15, { morn: ['NIDORAN_M', 'NIDORAN_F', 'DROWZEE', 'ABRA', 'PIDGEY', 'DITTO', 'YANMA'], day: ['NIDORAN_M', 'NIDORAN_F', 'DROWZEE', 'ABRA', 'PIDGEY', 'DITTO', 'YANMA'], nite: ['NIDORAN_M', 'NIDORAN_F', 'DROWZEE', 'ABRA', 'HOOTHOOT', 'DITTO', 'YANMA'] }),
      // the park's own slots (CATERPIE / METAPOD / PIDGEY, SUNKERN by day, HOOTHOOT at night) + the BUG-CATCHING
      // CONTEST's Gen 1-2 bugs
      area('NATIONAL PARK', 'grass', 0.25, { morn: ['CATERPIE', 'METAPOD', 'PIDGEY', 'WEEDLE', 'PARAS', 'VENONAT', 'SCYTHER', 'PINSIR'], day: ['CATERPIE', 'METAPOD', 'SUNKERN', 'PIDGEY', 'BUTTERFREE', 'BEEDRILL', 'SCYTHER', 'PINSIR'], nite: ['HOOTHOOT', 'VENONAT', 'PARAS', 'BEEDRILL', 'SCYTHER', 'PINSIR'] }),
      area('ROUTE 36', 'grass', 0.35, { morn: ['NIDORAN_M', 'NIDORAN_F', 'PIDGEY', 'GROWLITHE', 'STANTLER'], day: ['NIDORAN_M', 'NIDORAN_F', 'PIDGEY', 'GROWLITHE', 'STANTLER'], nite: ['NIDORAN_M', 'NIDORAN_F', 'HOOTHOOT', 'GROWLITHE', 'STANTLER'] }),
      area('ROUTE 37', 'grass', 0.5, { morn: ['PIDGEY', 'STANTLER', 'GROWLITHE'], day: ['PIDGEY', 'STANTLER', 'GROWLITHE', 'PIDGEOTTO'], nite: ['SPINARAK', 'STANTLER', 'HOOTHOOT', 'GROWLITHE'] }),
      area('BURNED TOWER', 'building', 0.65, ['KOFFING', 'RATTATA', 'ZUBAT', 'RATICATE', 'MAGMAR'], 'mus_poke_tower'),
    ],
    elites: ['JOHTO_ROCKET_GRUNT_2', 'JOHTO_BEAUTY_SAMANTHA', 'JOHTO_MEDIUM_MARTHA'],
    rival: 'SILVER_2', bird: 'LEGEND_RAIKOU', // RAIKOU: fled from the BURNED TOWER
    bosses: ['LEADER_WHITNEY', 'LEADER_MORTY'],
  },
  {
    id: 3, region: 'johto', name: 'CIANWOOD → BLACKTHORN', short: 'JOHTO 3', floors: 15, levels: [26, 37], bossLevel: 41,
    music: ['mus_route11', 'mus_surf', 'mus_cycling'], townMusic: 'mus_fuchsia',
    areas: [
      area('ROUTE 38', 'grass', 0, { morn: ['RATTATA', 'RATICATE', 'MAGNEMITE', 'FARFETCHD', 'MILTANK', 'TAUROS', 'SNUBBULL'], day: ['RATTATA', 'RATICATE', 'MAGNEMITE', 'FARFETCHD', 'MILTANK', 'TAUROS', 'SNUBBULL'], nite: ['RATTATA', 'RATICATE', 'MAGNEMITE', 'MILTANK', 'TAUROS', 'SNUBBULL'] }),
      area('ROUTE 39', 'grass', 0.1, { morn: ['RATTATA', 'RATICATE', 'MAGNEMITE', 'FARFETCHD', 'MILTANK', 'TAUROS'], day: ['RATTATA', 'RATICATE', 'MAGNEMITE', 'FARFETCHD', 'MILTANK', 'TAUROS'], nite: ['RATTATA', 'RATICATE', 'MAGNEMITE', 'MILTANK', 'TAUROS'] }),
      area('ROUTE 41 SEA', 'water', 0.2, ['TENTACOOL', 'TENTACRUEL', 'MANTINE', 'MAGIKARP', 'CHINCHOU', 'SHELLDER'], 'mus_surf'),
      area('CIANWOOD SHORE', 'water', 0.25, ['TENTACOOL', 'KRABBY', 'SHUCKLE', 'CORSOLA', 'TENTACRUEL'], 'mus_surf'),
      area('WHIRL ISLANDS', 'cave', 0.3, ['KRABBY', 'ZUBAT', 'SEEL', 'GOLBAT', 'TENTACOOL', 'HORSEA', 'SEADRA'], 'mus_sevii_cave'),
      area('MT. MORTAR', 'cave', 0.4, ['ZUBAT', 'MACHOP', 'GEODUDE', 'RATTATA', 'MARILL', 'GOLDEEN', 'MACHOKE', 'GRAVELER'], 'mus_mt_moon'),
      area('ROUTE 42', 'grass', 0.45, { morn: ['MANKEY', 'MAREEP', 'SPEAROW', 'FLAAFFY', 'GOLDEEN'], day: ['MANKEY', 'MAREEP', 'SPEAROW', 'FLAAFFY', 'GOLDEEN'], nite: ['MANKEY', 'MAREEP', 'ZUBAT', 'FLAAFFY', 'GOLDEEN'] }),
      // the lake (MAGIKARP and the red GYARADOS) + ROUTE 43's grass
      area('LAKE OF RAGE', 'water', 0.5, { morn: ['MAGIKARP', 'GYARADOS', 'FLAAFFY', 'GIRAFARIG', 'PIDGEOTTO', 'VENONAT'], day: ['MAGIKARP', 'GYARADOS', 'FLAAFFY', 'GIRAFARIG', 'PIDGEOTTO', 'MAREEP'], nite: ['MAGIKARP', 'GYARADOS', 'FLAAFFY', 'GIRAFARIG', 'NOCTOWL', 'VENONAT'] }),
      area('ROUTE 44', 'grass', 0.6, ['WEEPINBELL', 'TANGELA', 'BELLSPROUT', 'LICKITUNG', 'POLIWAG', 'REMORAID']),
      area('ICE PATH', 'cave', 0.7, ['SWINUB', 'GOLBAT', 'ZUBAT', 'JYNX'], 'mus_sevii_cave'),
      area("DRAGON'S DEN", 'water', 0.85, ['MAGIKARP', 'DRATINI', 'DRAGONAIR'], 'mus_sevii_dungeon'),
    ],
    elites: ['JOHTO_ROCKET_GRUNT_3', 'ROCKET_EXEC_PETREL', 'ROCKET_EXEC_PROTON', 'JOHTO_BLACK_BELT_KIYO', 'JOHTO_COOLTRAINER_LOLA'],
    rival: 'SILVER_3', bird: 'LEGEND_ENTEI', // ENTEI: roaming near the LAKE OF RAGE
    bosses: ['LEADER_CHUCK', 'LEADER_JASMINE', 'LEADER_PRYCE', 'LEADER_CLAIR'],
  },
  {
    id: 4, region: 'johto', name: 'VICTORY ROAD → INDIGO PLATEAU', short: 'JOHTO 4', floors: 7, finale: true, levels: [37, 42], bossLevel: 46,
    music: ['mus_victory_road'], townMusic: 'mus_poke_center',
    areas: [
      area('ROUTE 27', 'grass', 0, { morn: ['DODUO', 'RATICATE', 'PONYTA', 'SANDSLASH', 'TENTACOOL'], day: ['DODUO', 'RATICATE', 'PONYTA', 'SANDSLASH', 'TENTACOOL'], nite: ['QUAGSIRE', 'RATICATE', 'PONYTA', 'SANDSLASH', 'TENTACOOL'] }, 'mus_route11'),
      area('ROUTE 26', 'grass', 0.1, { morn: ['DODUO', 'SANDSLASH', 'PONYTA', 'RATICATE', 'DODRIO'], day: ['DODUO', 'SANDSLASH', 'PONYTA', 'RATICATE', 'DODRIO'], nite: ['RATICATE', 'SANDSLASH', 'PONYTA', 'QUAGSIRE'] }, 'mus_route11'),
      area('TOHJO FALLS', 'cave', 0.2, ['ZUBAT', 'RATICATE', 'GOLBAT', 'SLOWPOKE', 'GOLDEEN', 'SEAKING'], 'mus_victory_road'),
      area('VICTORY ROAD', 'cave', 0.4, ['GRAVELER', 'GOLBAT', 'DONPHAN', 'ONIX', 'RHYHORN', 'GEODUDE'], 'mus_victory_road'),
    ],
    elites: ['JOHTO_COOLTRAINER_GAVEN', 'JOHTO_COOLTRAINER_JOYCE', 'ROCKET_EXEC_ARIANA', 'ROCKET_EXEC_ARCHER'],
    bird: 'LEGEND_SUICUNE', // SUICUNE: the North Wind at the TIN TOWER's foot
    gauntlet: ['ELITE_FOUR_WILL', 'JOHTO_E4_KOGA', 'JOHTO_E4_BRUNO', 'ELITE_FOUR_KAREN', 'CHAMPION_LANCE'],
    gauntletLevels: [44, 45, 46, 47, 49],
  },
  {
    id: 5, region: 'johto', name: 'MT. SILVER', short: 'POST-GAME', floors: 12, postgame: true, levels: [50, 60], bossLevel: 70,
    music: ['mus_sevii_dungeon', 'mus_sevii_cave', 'mus_victory_road'], townMusic: 'mus_poke_center',
    areas: [
      area('ROUTE 28', 'grass', 0, { morn: ['TANGELA', 'PONYTA', 'DONPHAN', 'RAPIDASH', 'DODUO', 'DODRIO', 'POLIWHIRL'], day: ['TANGELA', 'PONYTA', 'DONPHAN', 'RAPIDASH', 'DODUO', 'DODRIO', 'POLIWHIRL'], nite: ['TANGELA', 'PONYTA', 'DONPHAN', 'SNEASEL', 'RAPIDASH', 'POLIWHIRL'] }),
      area('MT. SILVER', 'cave', 0.2, ['ONIX', 'DONPHAN', 'GRAVELER', 'GOLBAT', 'PHANPY', 'LARVITAR', 'SEAKING'], 'mus_sevii_cave'),
      area('MT. SILVER CAVE', 'cave', 0.4, { morn: ['QUAGSIRE', 'STEELIX', 'DONPHAN', 'GOLDUCK', 'PHANPY', 'PUPITAR', 'GOLBAT', 'LARVITAR'], day: ['QUAGSIRE', 'STEELIX', 'DONPHAN', 'GOLDUCK', 'PHANPY', 'PUPITAR', 'GOLBAT', 'LARVITAR'], nite: ['MISDREAVUS', 'QUAGSIRE', 'STEELIX', 'DONPHAN', 'GOLDUCK', 'PUPITAR', 'GOLBAT', 'LARVITAR'] }, 'mus_sevii_cave'),
      area('MT. SILVER SUMMIT', 'mountain', 0.6, { morn: ['GOLDUCK', 'SNEASEL', 'DONPHAN', 'QUAGSIRE', 'LARVITAR', 'GOLBAT'], day: ['GOLDUCK', 'SNEASEL', 'DONPHAN', 'QUAGSIRE', 'LARVITAR', 'GOLBAT'], nite: ['SNEASEL', 'GOLDUCK', 'DONPHAN', 'MISDREAVUS', 'QUAGSIRE', 'LARVITAR', 'GOLBAT'] }, 'mus_sevii_dungeon'),
    ],
    elites: ['LEGEND_LUGIA', 'LEGEND_HO_OH', 'LEGEND_CELEBI', 'JOHTO_KIMONO_GIRLS'],
    bosses: ['PKMN_TRAINER_RED'],
  },
];

// v0.3.25: species the pools above leave out, added to JOHTO's wild areas (act id -> area name; every time of day) so
// every Pokédex species can be caught somewhere (regions.js withFinds: extra = half as common as an average species there,
// rare = a rare find). Strong and special species are rare finds, and late: the starters' final forms in act 4.
export const JOHTO_FINDS = {
  1: {
    'ROUTE 29': { rare: ['CYNDAQUIL'] },
    'ROUTE 30': { extra: ['LEDYBA'], rare: ['CHIKORITA'] },
    'DARK CAVE': { extra: ['TEDDIURSA'] },
    'ROUTE 32': { extra: ['TOGEPI'], rare: ['TOTODILE'] },
    'RUINS OF ALPH': { extra: ['UNOWN'] },
  },
  2: {
    'ILEX FOREST': { extra: ['PINECO'] },
    'ROUTE 34': { rare: ['QUILAVA'] },
    'ROUTE 35': { rare: ['BAYLEEF'] },
    'NATIONAL PARK': { extra: ['SUNFLORA'], rare: ['TOGETIC'] },
    'ROUTE 36': { extra: ['PHANPY'], rare: ['SUDOWOODO'] },
    'ROUTE 37': { rare: ['CROCONAW'] },
    'BURNED TOWER': { extra: ['HOUNDOUR'] },
  },
  3: {
    'ROUTE 38': { rare: ['UMBREON', 'JUMPLUFF'] },
    'ROUTE 39': { rare: ['ESPEON'] },
    'ROUTE 41 SEA': { extra: ['QWILFISH'] },
    'MT. MORTAR': { extra: ['TYROGUE'], rare: ['HITMONTOP', 'LARVITAR'] },
    'ROUTE 42': { extra: ['GLIGAR'] },
    'ROUTE 44': { rare: ['POLITOED', 'BELLOSSOM', 'FORRETRESS'] },
    "DRAGON'S DEN": { rare: ['KINGDRA'] },
  },
  4: {
    'ROUTE 27': { rare: ['TYPHLOSION', 'MEGANIUM'] },
    'ROUTE 26': { rare: ['FERALIGATR', 'HOUNDOOM'] },
    'TOHJO FALLS': { rare: ['SLOWKING'] },
  },
  5: {
    'ROUTE 28': { extra: ['URSARING'] },
  },
};
for (const a of JOHTO_ACTS) for (const ar of a.areas) Object.assign(ar, JOHTO_FINDS[a.id]?.[ar.name]);

export const JOHTO_LEGENDS = {
  // (LEGEND_RAIKOU / ENTEI / SUICUNE / LUGIA / HO_OH already exist in acts.js LEGENDS; CELEBI in hoenn.js)
};

// The legendary beasts as the act's optional legendary node (acts.js BIRDS): unique held item + deck if caught.
export const JOHTO_BIRDS = {
  LEGEND_RAIKOU: { item: 'THUNDER_MANE', moves: ['THUNDER_SHOCK', 'BITE', 'SPARK', 'ROAR'] },
  LEGEND_ENTEI: { item: 'VOLCANO_MANE', moves: ['EMBER', 'BITE', 'FIRE_SPIN', 'STOMP'] },
  LEGEND_SUICUNE: { item: 'CLEAR_BELL', moves: ['BUBBLE_BEAM', 'BITE', 'AURORA_BEAM', 'GUST'] },
};

// Pre-battle lines (our own writing). {S} = your starter, {R} = SILVER's ace.
export const SILVER_INTROS = {
  SILVER: ["SILVER: ...You're the one from NEW BARK. I took {R} from PROF. ELM's lab. It's wasted on a weakling like you.", "SILVER: I'm going to be the world's greatest trainer. Your {S} won't stop me!"],
  SILVER_2: ['SILVER: You again. This tower stinks of losers.', "SILVER: My {R} is stronger than ever. Get out of my way!"],
  SILVER_3: ["SILVER: ...I lost to you. I've been thinking about why ever since.", "SILVER: {R} and I trained until we couldn't stand. This time I win!"],
};
