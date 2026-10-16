// SINNOH acts in AUDIO STYLE: RETRO: Game Boy versions of Platinum's own songs (tools/sinnoh_chip converts the
// sequences of the user's own ROM; the lazy, on-demand 'retro_sinnoh' pack). Display only: which song plays never
// touches game state, so co-op stays in lockstep whatever bank each player has.
//
// Labels are Platinum's SSEQ symbols (the SDAT's names, e.g. 'SEQ_ROAD_A_D'); the retro bank holds them as
// 'sinnoh:' + label (sinnohRetro). Every choice follows pret/pokeplatinum:
//   - map music: include/data/map_headers.h (dayMusicID / nightMusicID of the act's places), plus src/field_bgm.c's
//     surf override (SEQ_NAMINORI on the water routes);
//   - battle music: src/enc_effects.c sEncEffectsTable (the sseq file names there are pret's aliases of the SDAT
//     symbols, res/sound/pl_sound_data.json: BATTLE_LAKE_GUARDIAN = SEQ_BA_DPOKE1, BATTLE_LEGENDARY = SEQ_BA_SECRET2...);
//   - victory music: src/battle/battle_controller_player.c (and battle_script.c: a catch plays the wild victory);
//   - trainer encounter music: src/field_bgm.c's class table (SEQ_EYE_*);
//   - jingles: res/field/scripts/scripts_common.s (items FANFA4, key items FANFA3, TMs WAZA), pokecenter.c (heal ASA),
//     evolution.c (SHINKA, evolved FANFA5, learned / level up FANFA1), canalave_city_east_house.s (move deleted
//     WASURE), the gym scripts (BADGE), hall_of_fame.c (BLD_EV_DENDO2).
// Time of day like JOHTO: env.tod === 'nite' picks the night version (the _N songs; the POKéMON CENTER's PC_02).
//
// Pure module (no game imports): audio/retro.js asks sinnohSong() first in SINNOH and falls back to its Silver / Red
// stand-ins for any song the loaded bank lacks. tests/retro_sinnoh.test.mjs checks it against game/sinnoh.js.
export const sinnohRetro = (label) => 'sinnoh:' + label;

// ---- map music by the act's places ------------------------------------------------------------------------------------
// Per SINNOH act id: [from, label] in game/sinnoh.js SINNOH_ACTS areas order (the newest place reached at that progress
// plays, like Run.areaFor prefers). Day labels; nightOf() swaps in the _N version.
export const SINNOH_MAP_MUSIC = {
  1: [
    [0, 'SEQ_ROAD_A_D'],      // ROUTE 201 (LAKE VERITY shares the start)
    [0.1, 'SEQ_ROAD_A_D'],    // ROUTE 202
    [0.2, 'SEQ_ROAD_B_D'],    // ROUTE 203
    [0.25, 'SEQ_D_05'],       // OREBURGH GATE
    [0.3, 'SEQ_D_04'],        // OREBURGH MINE
    [0.4, 'SEQ_ROAD_B_D'],    // ROUTE 204
    [0.45, 'SEQ_D_05'],       // RAVAGED PATH
    [0.55, 'SEQ_ROAD_C_D'],   // VALLEY WINDWORKS (outside)
    [0.6, 'SEQ_ROAD_C_D'],    // ROUTE 205
    [0.7, 'SEQ_D_02'],        // ETERNA FOREST
  ],
  2: [
    [0, 'SEQ_ROAD_C_D'],      // ROUTE 211 (west, from ETERNA)
    [0.05, 'SEQ_ROAD_D_D'],   // ROUTE 206
    [0.15, 'SEQ_D_05'],       // WAYWARD CAVE
    [0.25, 'SEQ_D_05'],       // MT. CORONET (1F)
    [0.35, 'SEQ_ROAD_D_D'],   // ROUTE 208
    [0.45, 'SEQ_ROAD_E_D'],   // ROUTE 209
    [0.5, 'SEQ_D_02'],        // LOST TOWER
    [0.6, 'SEQ_D_02'],        // SOLACEON RUINS
    [0.65, 'SEQ_ROAD_F_D'],   // ROUTE 210
    [0.75, 'SEQ_ROAD_F_D'],   // ROUTE 215
    [0.8, 'SEQ_D_03'],        // OLD CHATEAU
  ],
  3: [
    [0, 'SEQ_ROAD_E_D'],      // ROUTE 212
    [0.05, 'SEQ_D_SAFARI'],   // GREAT MARSH
    [0.15, 'SEQ_TOWN07_D'],   // ROUTE 213 (the beach: RESORT AREA's song)
    [0.25, 'SEQ_ROAD_F_D'],   // ROUTE 214
    [0.3, 'SEQ_TOWN07_D'],    // VALOR LAKEFRONT
    [0.4, 'SEQ_NAMINORI'],    // ROUTE 218 (water: surfing)
    [0.45, 'SEQ_D_04'],       // IRON ISLAND (inside)
    [0.55, 'SEQ_ROAD_SNOW_D'], // ROUTE 216
    [0.6, 'SEQ_ROAD_SNOW_D'], // ROUTE 217
    [0.7, 'SEQ_D_LAKE'],      // LAKE ACUITY (the lakes' own song: LAKE VALOR's header)
    [0.8, 'SEQ_ROAD_E_D'],    // ROUTE 222
  ],
  4: [
    [0, 'SEQ_NAMINORI'],      // ROUTE 223 (all water: surfing)
    [0.15, 'SEQ_D_01'],       // VICTORY ROAD
    [0.4, 'SEQ_D_01'],        // VICTORY ROAD B1F
    [0.55, 'SEQ_D_01'],       // VICTORY ROAD 2F
    [0.85, 'SEQ_CITY10_D'],   // the POKéMON LEAGUE, at the top
  ],
  5: [
    [0, 'SEQ_TOWN06_D'],      // ROUTE 225 (SURVIVAL AREA's song)
    [0.15, 'SEQ_TOWN06_D'],   // STARK MOUNTAIN (outside)
    [0.3, 'SEQ_D_06'],        // STARK MOUNTAIN (inside)
    [0.4, 'SEQ_ROAD_BZA_D'],  // ROUTE 228
    [0.55, 'SEQ_D_03'],       // TURNBACK CAVE
    [0.75, 'SEQ_PL_D_GIRATINA'], // DISTORTION WORLD
  ],
};
// Events (act.townMusic's role): the city the act heads for. Marts (the shop asks for act.townMusic without a ctx)
// play Platinum's mart song.
export const SINNOH_TOWN_MUSIC = { 1: 'SEQ_CITY04_D', 2: 'SEQ_CITY07_D', 3: 'SEQ_CITY08_D', 4: 'SEQ_CITY10_D', 5: 'SEQ_CITY11_D' };
const MART = 'SEQ_FS', CENTER = 'SEQ_PC_01', CENTER_NITE = 'SEQ_PC_02';

// Night versions: every town / city / route song has one (_D -> _N), and the POKéMON CENTER plays PC_02.
const NIGHT = /^SEQ_(TOWN|CITY|ROAD)[A-Z0-9_]*_D$/;
export const nightOf = (label) => (label === CENTER ? CENTER_NITE : NIGHT.test(label) ? label.slice(0, -1) + 'N' : label);

// ---- battles ----------------------------------------------------------------------------------------------------------
const BA = { wild: 'SEQ_BA_POKE', trainer: 'SEQ_BA_TRAIN', gym: 'SEQ_BA_GYM', e4: 'SEQ_BA_TENNO', champion: 'SEQ_BA_CHANP',
  rival: 'SEQ_BA_RIVAL', grunt: 'SEQ_BA_GINGA', commander: 'SEQ_BA_GINGA3', cyrus: 'SEQ_BA_AKAGI', legendary: 'SEQ_BA_SECRET2' };
const WIN = { wild: 'SEQ_WINPOKE', trainer: 'SEQ_WINTRAIN', gym: 'SEQ_WINTGYM', e4: 'SEQ_WINTENNO', champion: 'SEQ_WINCHAMP',
  galactic: 'SEQ_WINGINGA', cyrus: 'SEQ_WINAKAGI' };
// Legendaries by the battle's title (enc_effects.c EncEffects_WildPokemonEffect): others play BATTLE_LEGENDARY.
export const SINNOH_LEGEND_SONG = {
  MESPRIT: 'SEQ_BA_DPOKE1', UXIE: 'SEQ_BA_DPOKE1', AZELF: 'SEQ_BA_DPOKE1',
  DIALGA: 'SEQ_BA_DPOKE2', PALKIA: 'SEQ_BA_DPOKE2',
  GIRATINA: 'SEQ_PL_BA_GIRA', ARCEUS: 'SEQ_BA_SECRET1',
  REGIROCK: 'SEQ_PL_BA_REGI', REGICE: 'SEQ_PL_BA_REGI', REGISTEEL: 'SEQ_PL_BA_REGI',
  REGIGIGAS: BA.legendary, HEATRAN: BA.legendary, DARKRAI: BA.legendary, ROTOM: BA.legendary,
  ZAPDOS: BA.legendary, ARTICUNO: BA.legendary, MOLTRES: BA.legendary,
  SHAYMIN: BA.wild, CRESSELIA: BA.wild,
};

// ---- trainer encounter music (field_bgm.c) ------------------------------------------------------------------------
const EYE = { boy: 'SEQ_EYE_BOY', girl: 'SEQ_EYE_GIRL', kid: 'SEQ_EYE_KID', fight: 'SEQ_EYE_FIGHT', lady: 'SEQ_EYE_LADY',
  mount: 'SEQ_EYE_MOUNT', rich: 'SEQ_EYE_RICH', enka: 'SEQ_EYE_ENKA', mys: 'SEQ_EYE_MYS', elite: 'SEQ_EYE_ELITE',
  sport: 'SEQ_EYE_SPORT', fun: 'SEQ_EYE_FUN', ginga: 'SEQ_EYE_GINGA', tenno: 'SEQ_EYE_TENNO', champ: 'SEQ_EYE_CHAMP' };
const RIVAL_THEME = 'SEQ_THE_RIV', CYRUS_THEME = 'SEQ_THE_AKAGI';
// By trainer key (game/sinnoh.js: SINNOH_TRAINER_CLASSES' FireRed keys, 'YOUNGSTER_BEN:123', and the named elites).
// FireRed classes Platinum lacks take the closest one's (SUPER NERD / POKéMANIAC / CHANNELER: COLLECTOR's EYE_MYS;
// BIKER: ROUGHNECK's EYE_FIGHT).
export const SINNOH_CLASS_EYE = {
  YOUNGSTER_BEN: EYE.boy, BUG_CATCHER_RICK: EYE.boy, LASS_JANICE: EYE.girl, HIKER_MARCOS: EYE.mount, CAMPER_LIAM: EYE.boy,
  PICNICKER_KELSEY: EYE.girl, BIRD_KEEPER_SEBASTIAN: EYE.sport, FISHERMAN_DALE: EYE.enka, SUPER_NERD_JOVAN: EYE.mys,
  POKEMANIAC_MARK: EYE.mys, SCHOOL_KID_M: EYE.boy, POKEFAN_M: EYE.fun, BLACK_BELT_KOICHI: EYE.fight, BEAUTY_BRIDGET: EYE.lady,
  GENTLEMAN_THOMAS: EYE.rich, PSYCHIC_JOHAN: EYE.fight, COOLTRAINER_SAMUEL: EYE.elite, COOLTRAINER_MARY: EYE.elite,
  CHANNELER_HOPE: EYE.mys, SAILOR_EDMOND: EYE.enka, SWIMMER_MALE_LUIS: EYE.sport, SWIMMER_FEMALE_TIFFANY: EYE.lady,
  BIKER_JARED: EYE.fight, SCIENTIST_TED: EYE.mys,
  SINNOH_ACE_TRAINER_M: EYE.elite, SINNOH_ACE_TRAINER_F: EYE.elite, SINNOH_ACE_TRAINER_COOL: EYE.elite,
  SINNOH_AROMA_LADY: EYE.lady, SINNOH_BLACK_BELT: EYE.fight, SINNOH_PSYCHIC: EYE.fight, SINNOH_VETERAN: EYE.elite,
  SINNOH_VETERAN_2: EYE.elite, SINNOH_DRAGON_TAMER: EYE.elite, SINNOH_DRAGON_TAMER_2: EYE.elite,
};
// By the FireRed / Emerald encounter song a trainer from elsewhere asks for.
const ENCOUNTER_EYE = {
  mus_encounter_boy: EYE.boy, mus_encounter_girl: EYE.girl, mus_encounter_rocket: EYE.ginga, mus_encounter_rival: RIVAL_THEME,
  mus_encounter_gym_leader: BA.gym, // (Platinum's leaders have no encounter song: their battle starts right away)
  mus_encounter_male: EYE.boy, mus_encounter_female: EYE.girl, mus_encounter_hiker: EYE.mount, mus_encounter_intense: EYE.fight,
  mus_encounter_cool: EYE.elite, mus_encounter_swimmer: EYE.sport, mus_encounter_rich: EYE.rich, mus_encounter_twins: EYE.kid,
  mus_encounter_suspicious: EYE.mys, mus_encounter_aqua: EYE.ginga, mus_encounter_magma: EYE.ginga, mus_encounter_may: RIVAL_THEME,
  mus_encounter_elite_four: EYE.tenno, mus_encounter_champion: EYE.champ,
};

// ---- FireRed song -> Platinum song anywhere else (events, jingles, menus during a SINNOH act) -------------------------
export const SINNOH_SONGS = {
  ...ENCOUNTER_EYE,
  mus_route1: 'SEQ_ROAD_A_D', mus_route3: 'SEQ_ROAD_B_D', mus_route11: 'SEQ_ROAD_D_D', mus_route24: 'SEQ_ROAD_C_D',
  mus_viridian_forest: 'SEQ_D_02', mus_mt_moon: 'SEQ_D_05', mus_victory_road: 'SEQ_D_01', mus_rocket_hideout: 'SEQ_D_AGITO',
  mus_poke_tower: 'SEQ_D_02', mus_lavender: 'SEQ_D_02', mus_poke_mansion: 'SEQ_D_03', mus_silph: 'SEQ_D_GINLOBBY',
  mus_ss_anne: 'SEQ_CITY02_D', mus_surf: 'SEQ_NAMINORI', mus_cycling: 'SEQ_PL_BICYCLE', mus_game_corner: 'SEQ_BLD_GAME',
  mus_safari_zone: 'SEQ_D_SAFARI', mus_pallet: 'SEQ_TOWN01_D', mus_slow_pallet: 'SEQ_TOWN01_D',
  mus_pewter: 'SEQ_CITY03_D', mus_vermillion: 'SEQ_CITY02_D', mus_celadon: 'SEQ_CITY07_D', mus_fuchsia: 'SEQ_CITY06_D',
  mus_cinnabar: 'SEQ_CITY08_D', mus_poke_center: CENTER, mus_gym: 'SEQ_GYM', mus_oak: 'SEQ_KENKYUJO', mus_follow_me: 'SEQ_TSURETEKE',
  mus_school: 'SEQ_CITY01_D', mus_trainer_tower: 'SEQ_BF_TOWWER', mus_berry_pick: 'SEQ_TOWN03_D',
  mus_sevii_route: 'SEQ_ROAD_BZA_D', mus_sevii_123: 'SEQ_CITY11_D', mus_sevii_45: 'SEQ_TOWN07_D', mus_sevii_67: 'SEQ_TOWN06_D',
  mus_sevii_cave: 'SEQ_D_06', mus_sevii_dungeon: 'SEQ_D_03',
  mus_hall_of_fame: 'SEQ_BLD_EV_DENDO2',
  mus_vs_wild: BA.wild, mus_vs_trainer: BA.trainer, mus_vs_gym_leader: BA.gym, mus_vs_champion: BA.champion,
  mus_vs_legend: BA.legendary, mus_vs_mewtwo: BA.legendary, mus_vs_deoxys: BA.legendary,
  mus_victory_wild: WIN.wild, mus_victory_trainer: WIN.trainer, mus_victory_gym_leader: WIN.gym,
  mus_evolution_intro: 'SEQ_SHINKA', mus_evolution: 'SEQ_SHINKA',
  // jingles (a catch plays the wild victory theme right away in Platinum)
  mus_caught_intro: WIN.wild, mus_caught: WIN.wild,
  mus_heal: 'SEQ_ASA', mus_level_up: 'SEQ_FANFA1', mus_obtain_item: 'SEQ_FANFA4', mus_obtain_tmhm: 'SEQ_WAZA',
  mus_obtain_badge: 'SEQ_BADGE', mus_evolved: 'SEQ_FANFA5', mus_move_deleted: 'SEQ_WASURE',
};

const ENCOUNTER = /^mus_encounter_/;
const VICTORY = /^mus_victory_/;
const VERSUS = /^mus_vs_/;
const isGauntlet = (b) => b.gauntlet !== undefined && b.gauntlet !== null;

// The Platinum song (bare label) for FireRed song `name` in a SINNOH act, or null (no match: retro.js's stand-ins).
// act: the current act (its id picks the places); ctx: what the scene passed (the battle config, { map: progress },
// { event: id }, or nothing); env: { tod: 'morn' | 'day' | 'nite' | null }.
export function sinnohSong(act, name, ctx = null, env = {}) {
  if (!name) return null;
  const nite = env.tod === 'nite' || (!env.tod && ctx?.timeOfDay === 'nite');
  const t = (label) => (label && nite ? nightOf(label) : label);
  const battle = ctx && ctx.kind ? ctx : null;
  const id = act?.id;

  if (battle) {
    const tr = battle.trainer || null;
    const key = (tr && tr.key) || '';
    const cls = key.split(':')[0];
    const gauntlet = isGauntlet(battle);
    const champion = gauntlet && (battle.music === 'mus_vs_champion' || /^CHAMPION/.test(key));
    const cyrus = /^GALACTIC_BOSS/.test(key);
    const commander = /^COMMANDER_/.test(key);
    const galactic = cyrus || commander || /^GALACTIC_/.test(key) || (!!tr && tr.encounterSong === 'mus_encounter_rocket');
    const rival = !gauntlet && (!!battle.rival || /^BARRY/.test(key));
    if (ENCOUNTER.test(name)) {
      if (gauntlet) return champion ? EYE.champ : EYE.tenno;
      if (rival) return RIVAL_THEME;
      if (cyrus) return CYRUS_THEME;
      if (galactic) return EYE.ginga;
      if (name === 'mus_encounter_gym_leader') return BA.gym;
      return SINNOH_CLASS_EYE[cls] || ENCOUNTER_EYE[name] || EYE.boy;
    }
    if (VICTORY.test(name)) {
      if (!tr || battle.kind === 'wild') return WIN.wild; // (legendaries, GIRATINA included)
      if (gauntlet) return champion ? WIN.champion : WIN.e4;
      if (cyrus) return WIN.cyrus;
      if (galactic) return WIN.galactic;
      if (battle.kind === 'boss') return WIN.gym;
      return WIN.trainer;
    }
    if (VERSUS.test(name) || name === battle.music) {
      if (battle.legend) return SINNOH_LEGEND_SONG[String(battle.legend).toUpperCase()] || (name === 'mus_vs_wild' ? BA.wild : BA.legendary);
      if (gauntlet) return champion ? BA.champion : BA.e4;
      if (cyrus) return BA.cyrus;
      if (commander) return BA.commander;
      if (galactic) return BA.grunt;
      if (rival) return BA.rival;
      if (battle.kind === 'boss' && tr) return BA.gym;
      if (battle.kind === 'wild') return BA.wild;
      if (tr) return BA.trainer;
    }
    return t(SINNOH_SONGS[name]) || null;
  }
  // the map: the place reached at this progress
  if (ctx && ctx.map !== undefined && SINNOH_MAP_MUSIC[id]) {
    const prog = Math.max(0, +ctx.map || 0);
    let label = SINNOH_MAP_MUSIC[id][0][1];
    for (const [from, l] of SINNOH_MAP_MUSIC[id]) if (from <= prog + 0.001) label = l;
    return t(label);
  }
  if (act && name === act.townMusic) {
    if (ctx && ctx.event !== undefined && SINNOH_TOWN_MUSIC[id]) return t(SINNOH_TOWN_MUSIC[id]);
    if (!ctx) return name === 'mus_poke_center' ? t(CENTER) : MART;
  }
  if (ctx && ctx.event !== undefined) return t(SINNOH_SONGS[name] || SINNOH_TOWN_MUSIC[id]) || null;
  return t(SINNOH_SONGS[name]) || null;
}

// Every song the game can ask for in SINNOH (tools/sinnoh_chip/build_bank.mjs converts these; retro.js's
// SINNOH_RETRO_SET is the same with the 'sinnoh:' prefix).
const DAY = [
  ...Object.values(SINNOH_MAP_MUSIC).flat().map(([, l]) => l), ...Object.values(SINNOH_TOWN_MUSIC), MART, CENTER,
  ...Object.values(BA), ...Object.values(WIN), ...Object.values(SINNOH_LEGEND_SONG), ...Object.values(EYE),
  RIVAL_THEME, CYRUS_THEME, ...Object.values(SINNOH_CLASS_EYE), ...Object.values(SINNOH_SONGS),
];
export const SINNOH_SONG_SET = new Set([...DAY, ...DAY.map(nightOf)]);
