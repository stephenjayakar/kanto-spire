// RETRO music: which Game Boy song (Pokemon Red or Silver, web/src/audio/gb-core.js) plays for each song the game
// asks for. Display only: the song never touches game state, so co-op partners can use different AUDIO modes.
//
// The scenes ask for FireRed song names ('mus_route1'); HOENN acts first go through audio/emerald.js (Emerald's song
// for the place), then map here like everything else. Rules:
//   - KANTO (and the title/menus outside a run): Pokemon Red, nearly 1:1 since FireRed remakes it;
//   - JOHTO: Pokemon Silver, with the map music following the act's real places (GSC's map table);
//   - HOENN: the closest Silver (or Red) song by mood;
//   - a song with no sensible match returns null: the normal GBA song plays.
// Song ids are '<game>:<pret label>' ('red:Routes1', 'silver:Route29'); SFX_* are the games' jingles.
//
// Pure module (no game imports besides the Emerald table): main.js passes the act, tests read the tables.
import { hoennSong } from './emerald.js';

// ---- Pokemon Red, by FireRed song ------------------------------------------------------------------------------------
export const RED = {
  mus_title: 'TitleScreen',
  mus_route1: 'Routes1', mus_route3: 'Routes3', mus_route11: 'Routes4', mus_route24: 'Routes2',
  mus_viridian_forest: 'Dungeon2', mus_mt_moon: 'Dungeon3', mus_victory_road: 'Dungeon3',
  mus_rocket_hideout: 'Dungeon1', mus_poke_tower: 'PokemonTower', mus_lavender: 'Lavender',
  mus_poke_mansion: 'CinnabarMansion', mus_silph: 'SilphCo', mus_ss_anne: 'SSAnne',
  mus_surf: 'Surfing', mus_cycling: 'BikeRiding', mus_game_corner: 'GameCorner', mus_safari_zone: 'SafariZone',
  mus_pallet: 'PalletTown', mus_slow_pallet: 'PalletTown',
  mus_pewter: 'Cities1', mus_vermillion: 'Vermilion', mus_celadon: 'Celadon', mus_fuchsia: 'Cities2', mus_cinnabar: 'Cinnabar',
  mus_poke_center: 'Pokecenter', mus_gym: 'Gym', mus_oak: 'MeetProfOak', mus_oak_lab: 'OaksLab', mus_follow_me: 'MuseumGuy',
  mus_school: 'Cities1', mus_trainer_tower: 'Gym', mus_berry_pick: 'Celadon',
  mus_sevii_route: 'Routes3', mus_sevii_123: 'Cinnabar', mus_sevii_45: 'Vermilion', mus_sevii_67: 'Lavender',
  mus_sevii_cave: 'Dungeon2', mus_sevii_dungeon: 'Dungeon1',
  mus_hall_of_fame: 'HallOfFame',
  mus_encounter_boy: 'MeetMaleTrainer', mus_encounter_girl: 'MeetFemaleTrainer', mus_encounter_rocket: 'MeetEvilTrainer',
  mus_encounter_rival: 'MeetRival',
  mus_vs_wild: 'WildBattle', mus_vs_trainer: 'TrainerBattle', mus_vs_gym_leader: 'GymLeaderBattle', mus_vs_champion: 'FinalBattle',
  mus_vs_legend: 'GymLeaderBattle', mus_vs_mewtwo: 'FinalBattle', mus_vs_deoxys: 'FinalBattle',
  mus_victory_wild: 'DefeatedWildMon', mus_victory_trainer: 'DefeatedTrainer', mus_victory_gym_leader: 'DefeatedGymLeader',
  // Red plays the Safari Zone song during evolution (engine/movie/evolution.asm)
  mus_evolution_intro: 'SafariZone', mus_evolution: 'SafariZone',
  // jingles and fanfares
  mus_caught_intro: 'SFX_Caught_Mon', mus_caught: 'SFX_Caught_Mon',
  mus_heal: 'PkmnHealed', mus_level_up: 'SFX_Level_Up', mus_obtain_item: 'SFX_Get_Item1', mus_obtain_tmhm: 'SFX_Get_Item2',
  mus_obtain_badge: 'SFX_Get_Key_Item', mus_evolved: 'SFX_Get_Item2',
};

// ---- Pokemon Silver, by FireRed song (JOHTO and HOENN acts) ---------------------------------------------------------
export const SILVER = {
  mus_title: 'TitleScreen',
  mus_route1: 'Route29', mus_route3: 'Route30', mus_route11: 'Route36', mus_route24: 'Route37',
  mus_viridian_forest: 'UnionCave', mus_mt_moon: 'DarkCave', mus_victory_road: 'VictoryRoad',
  mus_rocket_hideout: 'RocketHideout', mus_poke_tower: 'BurnedTower', mus_lavender: 'LavenderTown',
  mus_poke_mansion: 'BurnedTower', mus_silph: 'RocketHideout', mus_ss_anne: 'SSAqua',
  mus_surf: 'Surf', mus_cycling: 'Bicycle', mus_game_corner: 'GameCorner', mus_safari_zone: 'NationalPark',
  mus_pallet: 'NewBarkTown', mus_slow_pallet: 'NewBarkTown',
  mus_pewter: 'VioletCity', mus_vermillion: 'CherrygroveCity', mus_celadon: 'GoldenrodCity', mus_fuchsia: 'AzaleaTown',
  mus_cinnabar: 'EcruteakCity',
  mus_poke_center: 'PokemonCenter', mus_gym: 'Gym', mus_oak: 'ProfOak', mus_oak_lab: 'ElmsLab', mus_follow_me: 'ShowMeAround',
  mus_school: 'AzaleaTown', mus_trainer_tower: 'Gym', mus_berry_pick: 'PokemonMarch',
  mus_sevii_route: 'Route26', mus_sevii_123: 'CherrygroveCity', mus_sevii_45: 'GoldenrodCity', mus_sevii_67: 'TinTower',
  mus_sevii_cave: 'UnionCave', mus_sevii_dungeon: 'DragonsDen',
  mus_hall_of_fame: 'HallOfFame',
  mus_encounter_boy: 'LookYoungster', mus_encounter_girl: 'LookLass', mus_encounter_rocket: 'LookRocket',
  mus_encounter_rival: 'LookRival',
  mus_vs_wild: 'JohtoWildBattle', mus_vs_trainer: 'JohtoTrainerBattle', mus_vs_gym_leader: 'JohtoGymBattle',
  mus_vs_champion: 'ChampionBattle', mus_vs_legend: 'JohtoGymBattle', mus_vs_mewtwo: 'ChampionBattle', mus_vs_deoxys: 'ChampionBattle',
  mus_victory_wild: 'WildPokemonVictory', mus_victory_trainer: 'TrainerVictory', mus_victory_gym_leader: 'GymLeaderVictory',
  mus_evolution_intro: 'Evolution', mus_evolution: 'Evolution',
  mus_caught_intro: 'SuccessfulCapture', mus_caught: 'SuccessfulCapture',
  mus_heal: 'HealPokemon', mus_level_up: 'SFX_LevelUp', mus_obtain_item: 'SFX_Item', mus_obtain_tmhm: 'SFX_GetTm',
  mus_obtain_badge: 'SFX_GetBadge', mus_evolved: 'SFX_Evolved',
};
// Red has no move deleter: Silver's jingle everywhere
const ANY = { mus_move_deleted: 'silver:SFX_MoveDeleted' };

// A song that ends hands over to another (the caught jingle, then the wild-victory loop, like the GBA's mus_caught).
export const RETRO_NEXT = { 'red:SFX_Caught_Mon': 'red:DefeatedWildMon', 'silver:SuccessfulCapture': 'silver:WildPokemonVictory' };

// JOHTO map music by the act's progress (pokegold data/maps/maps.asm for the act's places), per JOHTO act id.
export const JOHTO_MAP_MUSIC = {
  1: ['Route29', 'Route30', 'UnionCave'],                  // ROUTE 29 -> 30-33 -> UNION CAVE, SLOWPOKE WELL
  2: ['Route36', 'NationalPark', 'Route36', 'BurnedTower'], // ILEX, 34-36 -> NATIONAL PARK -> 37 -> BURNED TOWER
  3: ['Route37', 'Surf', 'LakeOfRage', 'DragonsDen'],       // 38/39 -> the sea, WHIRL ISLANDS -> 42/LAKE OF RAGE -> ICE PATH, DRAGON'S DEN
  4: ['Route26', 'VictoryRoad'],                           // 26/27 -> TOHJO FALLS, VICTORY ROAD
  5: ['IndigoPlateau', 'Lighthouse'],                      // ROUTE 28 -> MT. SILVER (GSC plays these there)
};
// events and marts (act.townMusic's role)
export const JOHTO_TOWN_MUSIC = { 1: 'CherrygroveCity', 2: 'GoldenrodCity', 3: 'EcruteakCity', 4: 'PokemonCenter', 5: 'PokemonCenter' };
// KANTO act 4 walks VICTORY ROAD up to the INDIGO PLATEAU
export const KANTO_MAP_MUSIC = { 4: ['Dungeon3', 'IndigoPlateau'] };
// a few events with a song of their own in Silver (event.js passes { event: id })
export const RETRO_EVENT = { kimono_girls: 'silver:DancingHall', bell_tower: 'silver:TinTower', kurt: 'silver:AzaleaTown', mystery_egg: 'silver:ProfOak' };

// JOHTO trainer encounter music by class (pokegold data/trainers/encounter_music.asm)
const LOOK = { YOUNGSTER: 'LookYoungster', LASS: 'LookLass', BEAUTY: 'LookBeauty', HIKER: 'LookHiker', SAGE: 'LookSage',
  POKEMANIAC: 'LookPokemaniac', KIMONO: 'LookKimonoGirl', OFFICER: 'LookOfficer', ROCKET: 'LookRocket', RIVAL: 'LookRival' };
export const JOHTO_CLASS_LOOK = {
  'YOUNGSTER': LOOK.YOUNGSTER, 'SCHOOLBOY': LOOK.YOUNGSTER, 'BIRD KEEPER': LOOK.YOUNGSTER, 'BUG CATCHER': LOOK.YOUNGSTER,
  'PSYCHIC': LOOK.YOUNGSTER, 'CAMPER': LOOK.YOUNGSTER,
  'LASS': LOOK.LASS, 'PICNICKER': LOOK.LASS, 'TWINS': LOOK.LASS,
  'BEAUTY': LOOK.BEAUTY, 'SKIER': LOOK.BEAUTY, 'TEACHER': LOOK.BEAUTY, 'SWIMMER♀': LOOK.BEAUTY,
  'HIKER': LOOK.HIKER, 'FISHER': LOOK.HIKER, 'SAILOR': LOOK.HIKER, 'GENTLEMAN': LOOK.HIKER, 'BLACK BELT': LOOK.HIKER,
  'BIKER': LOOK.HIKER, 'FIREBREATHER': LOOK.HIKER, 'GUITARIST': LOOK.HIKER, 'SWIMMER♂': LOOK.HIKER, 'BOARDER': LOOK.HIKER,
  'POKéMANIAC': LOOK.POKEMANIAC, 'SUPER NERD': LOOK.POKEMANIAC, 'BURGLAR': LOOK.POKEMANIAC, 'JUGGLER': LOOK.POKEMANIAC,
  'SAGE': LOOK.SAGE, 'MEDIUM': LOOK.SAGE, 'KIMONO GIRL': LOOK.KIMONO, 'OFFICER': LOOK.OFFICER,
};

// Emerald song (audio/emerald.js) -> Game Boy song, for HOENN acts
export const EMERALD = {
  mus_route101: 'silver:Route29', mus_route104: 'silver:Route30', mus_petalburg_woods: 'silver:UnionCave',
  mus_route110: 'silver:Route36', mus_route111: 'silver:Route37', mus_route113: 'silver:Route26', mus_cave_of_origin: 'silver:DarkCave',
  mus_route119: 'silver:Route26', mus_route120: 'silver:LakeOfRage', mus_mt_pyre: 'red:PokemonTower', mus_route122: 'silver:Route37',
  mus_surf: 'silver:Surf', mus_victory_road: 'silver:VictoryRoad', mus_ever_grande: 'silver:IndigoPlateau',
  mus_safari_zone: 'red:SafariZone', mus_mt_chimney: 'silver:TinTower', mus_sealed_chamber: 'silver:RuinsOfAlphInterior',
  mus_oldale: 'silver:CherrygroveCity', mus_rustboro: 'silver:VioletCity', mus_lilycove: 'silver:GoldenrodCity', mus_sootopolis: 'silver:EcruteakCity',
  mus_vs_wild: 'silver:JohtoWildBattle', mus_vs_trainer: 'silver:JohtoTrainerBattle', mus_vs_gym_leader: 'silver:JohtoGymBattle',
  mus_vs_champion: 'silver:ChampionBattle', mus_vs_elite_four: 'silver:JohtoGymBattle', mus_vs_rival: 'silver:RivalBattle',
  mus_vs_aqua_magma: 'silver:RocketBattle', mus_vs_aqua_magma_leader: 'silver:RocketBattle',
  mus_vs_regi: 'silver:KantoGymBattle', mus_vs_kyogre_groudon: 'silver:ChampionBattle', mus_vs_rayquaza: 'silver:ChampionBattle',
  mus_victory_wild: 'silver:WildPokemonVictory', mus_victory_trainer: 'silver:TrainerVictory', mus_victory_gym_leader: 'silver:GymLeaderVictory',
  mus_victory_league: 'silver:GymLeaderVictory', mus_victory_aqua_magma: 'silver:TrainerVictory',
  mus_encounter_male: 'silver:LookYoungster', mus_encounter_female: 'silver:LookLass', mus_encounter_girl: 'silver:LookLass',
  mus_encounter_hiker: 'silver:LookHiker', mus_encounter_intense: 'silver:LookHiker', mus_encounter_cool: 'silver:LookBeauty',
  mus_encounter_swimmer: 'silver:LookBeauty', mus_encounter_rich: 'silver:LookHiker', mus_encounter_twins: 'silver:LookLass',
  mus_encounter_suspicious: 'silver:LookPokemaniac', mus_encounter_aqua: 'silver:LookRocket', mus_encounter_magma: 'silver:LookRocket',
  mus_encounter_may: 'silver:LookRival', mus_encounter_elite_four: 'silver:JohtoGymBattle', mus_encounter_champion: 'silver:ChampionBattle',
  mus_poke_center: 'silver:PokemonCenter', mus_obtain_badge: 'silver:SFX_GetBadge', mus_hall_of_fame: 'silver:HallOfFame',
  mus_cycling: 'silver:Bicycle',
};

const ENCOUNTER = /^mus_encounter_/;
const pick = (list, prog) => list[Math.min(list.length - 1, Math.floor(Math.max(0, prog) * list.length))];

// The Game Boy song for FireRed song `name` (or null: play the GBA one).
// act: the current act (null outside a run); ctx: what the scene passed to playBGM/playFanfare (the battle config,
// { map: progress }, { event: id }); env: { tod: 'morn' | 'day' | 'nite' | null } (JOHTO's time of day).
export function retroSong(act, name, ctx = null, env = {}) {
  if (!name) return null;
  if (ANY[name]) return ANY[name];
  // the title and the starter pick are outside any act (G.run may still hold the last run): always Red's
  if (name === 'mus_title') return 'red:TitleScreen';
  if (name === 'mus_oak_lab') return 'red:OaksLab';
  const battle = ctx && ctx.kind ? ctx : null;
  const gauntlet = !!battle && battle.gauntlet !== undefined && battle.gauntlet !== null;
  let region = act ? act.region : 'kanto';
  if (act && (gauntlet || name === 'mus_hall_of_fame')) region = act.summit || act.region;
  if (ctx && ctx.event && RETRO_EVENT[ctx.event] && region !== 'kanto') return RETRO_EVENT[ctx.event];

  if (region === 'hoenn') {
    const em = hoennSong(act, name, ctx);
    if (em && EMERALD[em]) return EMERALD[em];
  }
  const kanto = region === 'kanto';
  const table = kanto ? RED : SILVER, game = kanto ? 'red:' : 'silver:';
  // the map music follows the act's places
  if (ctx && ctx.map !== undefined && act && !battle) {
    const list = kanto ? KANTO_MAP_MUSIC[act.id] : region === 'johto' ? JOHTO_MAP_MUSIC[act.id] : null;
    if (list) return game + pick(list, ctx.map);
  }
  if (region === 'johto' && act && !battle && name === act.townMusic && JOHTO_TOWN_MUSIC[act.id]) return 'silver:' + JOHTO_TOWN_MUSIC[act.id];
  if (battle) {
    const t = battle.trainer || {};
    const rocket = t.encounterSong === 'mus_encounter_rocket' || /ROCKET/.test(t.key || '');
    if (ENCOUNTER.test(name)) {
      // no "trainer appears" song for leaders, elites and champions: their battle song starts right away
      if (name === 'mus_encounter_gym_leader' || gauntlet) return game + (table[battle.music] || table.mus_vs_gym_leader);
      if (!kanto && name !== 'mus_encounter_rival' && JOHTO_CLASS_LOOK[t.className]) return 'silver:' + JOHTO_CLASS_LOOK[t.className];
    } else if (!kanto && (name === 'mus_vs_trainer' || name === battle.music)) {
      if (battle.rival && !gauntlet) return 'silver:RivalBattle';
      if (rocket && name === 'mus_vs_trainer') return 'silver:RocketBattle';
    }
    if (name === 'mus_vs_wild' && region === 'johto' && env.tod === 'nite' && !battle.legend) return 'silver:JohtoWildBattleNight';
  }
  const s = table[name];
  return s ? game + s : null;
}

// Every song the game can ask for (tests/retro_audio.mjs checks that the bank has them all).
export const RETRO_SONG_SET = new Set([
  ...Object.values(RED).map((s) => 'red:' + s), ...Object.values(SILVER).map((s) => 'silver:' + s), ...Object.values(ANY),
  ...Object.values(JOHTO_MAP_MUSIC).flat().map((s) => 'silver:' + s), ...Object.values(JOHTO_TOWN_MUSIC).map((s) => 'silver:' + s),
  ...Object.values(KANTO_MAP_MUSIC).flat().map((s) => 'red:' + s), ...Object.values(RETRO_EVENT),
  ...Object.values(JOHTO_CLASS_LOOK).map((s) => 'silver:' + s), ...Object.values(EMERALD), ...Object.keys(RETRO_NEXT), ...Object.values(RETRO_NEXT),
  'silver:RivalBattle', 'silver:RocketBattle', 'silver:JohtoWildBattleNight', 'silver:ChampionBattle',
]);

// ---- RETRO MIX: how the Game Boy engine sounds (gb-core.js MIXES; every mix plays exactly the same notes) -------------
// RETRO_MIX_PICKER on: SETTINGS shows a RETRO MIX row (A / B / C) while RETRO is picked, saved in this browser only.
// Off: no extra UI, everyone hears RETRO_MIX.
export const RETRO_MIX_PICKER = false;
export const RETRO_MIX = 'C';
export const RETRO_MIX_OPTIONS = [
  ['A', 'CLEAN', 'Smooth Game Boy tones and soft stereo, no clicks or harsh fizz. (Default)'],
  ['B', 'WARM', 'CLEAN with a softer top end and a small room around the sound.'],
  ['C', 'RICH', 'WARM plus a light chorus that thickens the two lead voices.'],
];
const RETRO_MIX_KEY = 'kantospire.retroMix';
export function savedRetroMix() {
  if (!RETRO_MIX_PICKER) return RETRO_MIX;
  let v = null;
  try { v = localStorage.getItem(RETRO_MIX_KEY); } catch { v = null; }
  return RETRO_MIX_OPTIONS.some((o) => o[0] === v) ? v : RETRO_MIX;
}
export function saveRetroMix(v) { try { localStorage.setItem(RETRO_MIX_KEY, v); } catch { /* private mode: this session only */ } }
