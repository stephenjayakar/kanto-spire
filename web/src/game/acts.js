import { HOENN_LEGENDS } from './hoenn.js';
import { JOHTO_LEGENDS, JOHTO_BIRDS, SILVER_INTROS } from './johto.js';
import { D, typeEffect } from './data.js';
import { GEN4_LEGENDS, RARE_LEGEND, ULTRA_RARE_LEGEND } from './gen4.js';

// Act definitions: which FireRed areas, trainers, bosses, music and levels each act draws from.

export const ACTS = [
  {
    id: 1, region: 'kanto', name: 'ROUTE 1 → MT. MOON', short: 'ACT 1', floors: 15,
    levels: [3, 12], bossLevel: 15,
    music: ['mus_route1', 'mus_viridian_forest', 'mus_route3'], townMusic: 'mus_pewter',
    areas: [
      { map: 'MAP_ROUTE1', name: 'ROUTE 1', terrain: 'grass', from: 0 },
      { map: 'MAP_ROUTE2', name: 'ROUTE 2', terrain: 'grass', from: 0 },
      { map: 'MAP_VIRIDIAN_FOREST', name: 'VIRIDIAN FOREST', terrain: 'longgrass', from: 0.15, music: 'mus_viridian_forest' },
      { map: 'MAP_ROUTE22', name: 'ROUTE 22', terrain: 'grass', from: 0.1 },
      { map: 'MAP_ROUTE3', name: 'ROUTE 3', terrain: 'grass', from: 0.4 },
      { map: 'MAP_MT_MOON_1F', name: 'MT. MOON', terrain: 'cave', from: 0.6, music: 'mus_mt_moon' },
      { map: 'MAP_MT_MOON_B2F', name: 'MT. MOON', terrain: 'cave', from: 0.75, music: 'mus_mt_moon' },
    ],
    trainerMaps: ['MAP_VIRIDIAN_FOREST', 'MAP_ROUTE3', 'MAP_MT_MOON_1F', 'MAP_MT_MOON_B2F', 'MAP_PEWTER_CITY_GYM', 'MAP_ROUTE24'],
    elites: ['TEAM_ROCKET_GRUNT', 'TEAM_ROCKET_GRUNT_2', 'SUPER_NERD_MIGUEL'],
    rival: 'RIVAL_CERULEAN',
    bosses: ['LEADER_BROCK', 'LEADER_MISTY'],
  },
  {
    id: 2, region: 'kanto', name: 'CERULEAN → CELADON', short: 'ACT 2', floors: 15,
    levels: [14, 25], bossLevel: 27,
    music: ['mus_route24', 'mus_route3', 'mus_route11'], townMusic: 'mus_vermillion',
    areas: [
      { map: 'MAP_ROUTE24', name: 'ROUTE 24', terrain: 'grass', from: 0, music: 'mus_route24' },
      { map: 'MAP_ROUTE25', name: 'ROUTE 25', terrain: 'grass', from: 0, music: 'mus_route24' },
      { map: 'MAP_ROUTE5', name: 'ROUTE 5', terrain: 'grass', from: 0.1 },
      { map: 'MAP_ROUTE6', name: 'ROUTE 6', terrain: 'grass', from: 0.1 },
      { map: 'MAP_DIGLETTS_CAVE_B1F', name: "DIGLETT'S CAVE", terrain: 'cave', from: 0.2, music: 'mus_mt_moon' },
      { map: 'MAP_ROUTE9', name: 'ROUTE 9', terrain: 'grass', from: 0.3 },
      { map: 'MAP_ROCK_TUNNEL_1F', name: 'ROCK TUNNEL', terrain: 'cave', from: 0.35, music: 'mus_mt_moon' },
      { map: 'MAP_ROUTE8', name: 'ROUTE 8', terrain: 'grass', from: 0.5 },
      { map: 'MAP_ROUTE7', name: 'ROUTE 7', terrain: 'grass', from: 0.5 },
      { map: 'MAP_POKEMON_TOWER_3F', name: 'POKéMON TOWER', terrain: 'building', from: 0.6, music: 'mus_poke_tower' },
      { map: 'MAP_ROUTE11', name: 'ROUTE 11', terrain: 'grass', from: 0.7, music: 'mus_route11' },
    ],
    trainerMaps: ['MAP_ROUTE24', 'MAP_ROUTE25', 'MAP_CERULEAN_CITY_GYM', 'MAP_SSANNE_DECK', 'MAP_SSANNE_1F_ROOM2', 'MAP_SSANNE_B1F_ROOM4', 'MAP_SSANNE_B1F_ROOM1',
      'MAP_SSANNE_2F_ROOM2', 'MAP_VERMILION_CITY_GYM', 'MAP_ROUTE6', 'MAP_ROUTE9', 'MAP_ROUTE11', 'MAP_ROCK_TUNNEL_1F', 'MAP_ROCK_TUNNEL_B1F',
      'MAP_ROUTE8', 'MAP_ROUTE10', 'MAP_CELADON_CITY_GYM', 'MAP_ROCKET_HIDEOUT_B1F', 'MAP_ROCKET_HIDEOUT_B3F', 'MAP_POKEMON_TOWER_3F', 'MAP_POKEMON_TOWER_5F'],
    elites: ['BOSS_GIOVANNI', 'TEAM_ROCKET_GRUNT_19', 'TEAM_ROCKET_GRUNT_13', 'POKEMANIAC_MARK'],
    rival: 'RIVAL_POKEMON_TOWER', bird: 'LEGEND_ZAPDOS', // ZAPDOS: the POWER PLANT off ROUTE 10
    bosses: ['LEADER_LT_SURGE', 'LEADER_ERIKA'],
  },
  {
    id: 3, region: 'kanto', name: 'FUCHSIA → CINNABAR', short: 'ACT 3', floors: 15,
    levels: [26, 37], bossLevel: 41,
    music: ['mus_route11', 'mus_cycling', 'mus_surf'], townMusic: 'mus_fuchsia',
    areas: [
      { map: 'MAP_ROUTE12', name: 'ROUTE 12', terrain: 'grass', from: 0 },
      { map: 'MAP_ROUTE13', name: 'ROUTE 13', terrain: 'grass', from: 0 },
      { map: 'MAP_ROUTE16', name: 'CYCLING ROAD', terrain: 'grass', from: 0, music: 'mus_cycling' },
      { map: 'MAP_ROUTE15', name: 'ROUTE 15', terrain: 'grass', from: 0.15 },
      { map: 'MAP_SAFARI_ZONE_CENTER', name: 'SAFARI ZONE', terrain: 'longgrass', from: 0.2 },
      { map: 'MAP_SAFARI_ZONE_NORTH', name: 'SAFARI ZONE', terrain: 'longgrass', from: 0.3 },
      { map: 'MAP_POWER_PLANT', name: 'POWER PLANT', terrain: 'building', from: 0.4, music: 'mus_poke_mansion' },
      { map: 'MAP_SEAFOAM_ISLANDS_B3F', name: 'SEAFOAM ISLANDS', terrain: 'cave', from: 0.55, music: 'mus_mt_moon' },
      { map: 'MAP_POKEMON_MANSION_1F', name: 'POKéMON MANSION', terrain: 'building', from: 0.65, music: 'mus_poke_mansion' },
      { map: 'MAP_POKEMON_MANSION_B1F', name: 'POKéMON MANSION', terrain: 'building', from: 0.8, music: 'mus_poke_mansion' },
    ],
    trainerMaps: ['MAP_ROUTE12', 'MAP_ROUTE13', 'MAP_ROUTE14', 'MAP_ROUTE15', 'MAP_ROUTE16', 'MAP_ROUTE17', 'MAP_ROUTE18', 'MAP_FUCHSIA_CITY_GYM',
      'MAP_SAFFRON_CITY_DOJO', 'MAP_SAFFRON_CITY_GYM', 'MAP_SILPH_CO_5F', 'MAP_SILPH_CO_7F', 'MAP_SILPH_CO_9F', 'MAP_ROUTE19', 'MAP_ROUTE20',
      'MAP_ROUTE21_NORTH', 'MAP_POKEMON_MANSION_1F', 'MAP_POKEMON_MANSION_3F', 'MAP_CINNABAR_ISLAND_GYM'],
    elites: ['BOSS_GIOVANNI_2', 'TEAM_ROCKET_GRUNT_39', 'BLACK_BELT_KOICHI', 'LEGEND_SNORLAX'],
    rival: 'RIVAL_SILPH', bird: 'LEGEND_ARTICUNO', // ARTICUNO: SEAFOAM ISLANDS
    rareLegends: [['LEGEND_MESPRIT', RARE_LEGEND]], // (v0.4.0: a rare legendary elite, Run.eliteConfig)
    bosses: ['LEADER_KOGA', 'LEADER_SABRINA', 'LEADER_BLAINE', 'LEADER_GIOVANNI'],
  },
  {
    id: 4, region: 'kanto', name: 'VICTORY ROAD → INDIGO PLATEAU', short: 'ACT 4', floors: 7, finale: true,
    levels: [37, 42], bossLevel: 46,
    music: ['mus_victory_road'], townMusic: 'mus_poke_center',
    areas: [
      { map: 'MAP_ROUTE23', name: 'ROUTE 23', terrain: 'grass', from: 0, music: 'mus_route11' },
      { map: 'MAP_VICTORY_ROAD_1F', name: 'VICTORY ROAD', terrain: 'cave', from: 0, music: 'mus_victory_road' },
      { map: 'MAP_VICTORY_ROAD_2F', name: 'VICTORY ROAD', terrain: 'cave', from: 0.3, music: 'mus_victory_road' },
      { map: 'MAP_VICTORY_ROAD_3F', name: 'VICTORY ROAD', terrain: 'cave', from: 0.6, music: 'mus_victory_road' },
    ],
    trainerMaps: ['MAP_VICTORY_ROAD_1F', 'MAP_VICTORY_ROAD_2F', 'MAP_VICTORY_ROAD_3F', 'MAP_VIRIDIAN_CITY_GYM'],
    elites: ['COOLTRAINER_COLBY', 'COOLTRAINER_NAOMI', 'COOLTRAINER_GEORGE'],
    bird: 'LEGEND_MOLTRES', // MOLTRES: VICTORY ROAD (as in RED/BLUE; the CHAMPION is the rival)
    rareLegends: [['LEGEND_UXIE', RARE_LEGEND]],
    gauntlet: ['ELITE_FOUR_LORELEI', 'ELITE_FOUR_BRUNO', 'ELITE_FOUR_AGATHA', 'ELITE_FOUR_LANCE', 'CHAMPION_FIRST'],
    gauntletLevels: [44, 45, 46, 47, 49],
  },
  {
    id: 5, region: 'kanto', name: 'SEVII ISLANDS', short: 'POST-GAME', floors: 12, postgame: true,
    levels: [50, 60], bossLevel: 70,
    music: ['mus_sevii_route', 'mus_sevii_123', 'mus_sevii_45', 'mus_sevii_67'], townMusic: 'mus_sevii_123',
    areas: [
      { map: 'MAP_ONE_ISLAND_KINDLE_ROAD', name: 'KINDLE ROAD', terrain: 'grass', from: 0 },
      { map: 'MAP_THREE_ISLAND_BERRY_FOREST', name: 'BERRY FOREST', terrain: 'longgrass', from: 0 },
      { map: 'MAP_FIVE_ISLAND_MEADOW', name: 'FIVE ISLE MEADOW', terrain: 'grass', from: 0.1 },
      { map: 'MAP_SIX_ISLAND_PATTERN_BUSH', name: 'PATTERN BUSH', terrain: 'longgrass', from: 0.2 },
      { map: 'MAP_FOUR_ISLAND_ICEFALL_CAVE_1F', name: 'ICEFALL CAVE', terrain: 'cave', from: 0.3, music: 'mus_sevii_cave' },
      { map: 'MAP_SIX_ISLAND_RUIN_VALLEY', name: 'RUIN VALLEY', terrain: 'mountain', from: 0.4 },
      { map: 'MAP_FIVE_ISLAND_LOST_CAVE_ROOM1', name: 'LOST CAVE', terrain: 'cave', from: 0.5, music: 'mus_sevii_dungeon' },
      { map: 'MAP_SEVEN_ISLAND_SEVAULT_CANYON', name: 'SEVAULT CANYON', terrain: 'mountain', from: 0.6 },
      { map: 'MAP_CERULEAN_CAVE_B1F', name: 'CERULEAN CAVE', terrain: 'cave', from: 0.8, music: 'mus_sevii_dungeon' },
    ],
    trainerMaps: ['MAP_ONE_ISLAND_KINDLE_ROAD', 'MAP_THREE_ISLAND_BOND_BRIDGE', 'MAP_FIVE_ISLAND_RESORT_GORGEOUS', 'MAP_SIX_ISLAND_RUIN_VALLEY',
      'MAP_SEVEN_ISLAND_SEVAULT_CANYON', 'MAP_SIX_ISLAND_PATTERN_BUSH', 'MAP_FIVE_ISLAND_MEMORIAL_PILLAR', 'MAP_SEVEN_ISLAND_TANOBY_RUINS'],
    elites: ['TEAM_ROCKET_ADMIN', 'TEAM_ROCKET_ADMIN_2', 'LEGEND_ENTEI', 'LEGEND_RAIKOU', 'LEGEND_SUICUNE', 'LEGEND_LUGIA', 'LEGEND_HO_OH'],
    rareLegends: [['LEGEND_GIRATINA', RARE_LEGEND / 2], ['LEGEND_DARKRAI', RARE_LEGEND / 2], ['LEGEND_SHAYMIN', RARE_LEGEND / 2], ['LEGEND_ARCEUS', ULTRA_RARE_LEGEND]],
    bosses: ['LEGEND_MEWTWO', 'LEGEND_DEOXYS'],
  },
];

// v0.3.25: species FireRed's tables leave out, added to KANTO's wild areas (by map) so every Pokédex species can be
// caught somewhere (regions.js withFinds: extra = half as common as an average species there, rare = a rare find). Strong
// and special species are rare finds, and late: the starters' final forms in act 4, DRAGONITE in the post-game.
// v0.4.0: + Gen 4 (#387-493) the same way: its basic forms as extras where they fit, the strong ones (cross-gen
// evolutions like MAGMORTAR, RIOLU / LUCARIO, the TURTWIG line, GABITE) rare and late.
export const KANTO_FINDS = {
  MAP_ROUTE1: { extra: ['BIDOOF'], rare: ['TURTWIG'] },
  MAP_ROUTE2: { extra: ['STARLY'], rare: ['BULBASAUR'] },
  MAP_VIRIDIAN_FOREST: { extra: ['PICHU', 'KRICKETOT', 'BURMY'] },
  MAP_ROUTE22: { extra: ['SHINX'], rare: ['SQUIRTLE'] },
  MAP_ROUTE3: { extra: ['IGGLYBUFF', 'GLAMEOW'], rare: ['CHARMANDER'] },
  MAP_MT_MOON_1F: { extra: ['CLEFFA', 'BRONZOR'] },
  MAP_MT_MOON_B2F: { rare: ['OMANYTE', 'KABUTO', 'CRANIDOS', 'SHIELDON'] },
  MAP_ROUTE24: { extra: ['BUDEW'], rare: ['CHARMELEON'] },
  MAP_ROUTE25: { extra: ['COMBEE', 'WORMADAM'], rare: ['IVYSAUR'] },
  MAP_ROUTE5: { extra: ['BUNEARY'], rare: ['GROTLE'] },
  MAP_ROUTE6: { extra: ['BUIZEL'], rare: ['WARTORTLE'] },
  MAP_DIGLETTS_CAVE_B1F: { extra: ['HIPPOPOTAS'] },
  MAP_ROUTE9: { extra: ['STUNKY', 'MOTHIM'] },
  MAP_ROCK_TUNNEL_1F: { extra: ['BONSLY'] },
  MAP_ROUTE8: { extra: ['PACHIRISU'] },
  MAP_ROUTE7: { extra: ['EEVEE', 'CHERUBI'] },
  MAP_POKEMON_TOWER_3F: { extra: ['DRIFLOON'], rare: ['SPIRITOMB'] },
  MAP_ROUTE11: { extra: ['MIME_JR'], rare: ['MR_MIME'] },
  MAP_ROUTE12: { extra: ['MUNCHLAX', 'LOPUNNY'], rare: ['VICTREEBEL'] },
  MAP_ROUTE13: { extra: ['CHATOT', 'AMBIPOM'] },
  MAP_ROUTE16: { extra: ['STARAVIA'] },
  MAP_ROUTE15: { extra: ['PURUGLY', 'VESPIQUEN'], rare: ['VILEPLUME', 'RIOLU'] },
  MAP_SAFARI_ZONE_CENTER: { extra: ['CARNIVINE', 'CROAGUNK', 'SKORUPI'], rare: ['KANGASKHAN'] },
  MAP_SAFARI_ZONE_NORTH: { extra: ['CHERRIM'], rare: ['EXEGGUTOR', 'SCIZOR', 'TANGROWTH'] },
  MAP_POWER_PLANT: { extra: ['ELEKID', 'PORYGON', 'ROTOM'], rare: ['RAICHU', 'JOLTEON', 'PORYGON2', 'ELECTIVIRE'] },
  MAP_SEAFOAM_ISLANDS_B3F: { extra: ['STARYU', 'SMOOCHUM', 'SNOVER'], rare: ['LAPRAS', 'CLOYSTER', 'STARMIE', 'VAPOREON'] },
  MAP_POKEMON_MANSION_1F: { extra: ['MAGBY'], rare: ['NINETALES', 'FLAREON', 'MAGMORTAR'] },
  MAP_POKEMON_MANSION_B1F: { extra: ['SKUNTANK'], rare: ['MUK', 'AERODACTYL', 'PORYGON_Z'] },
  MAP_ROUTE23: { extra: ['WIGGLYTUFF', 'TOXICROAK', 'STARAPTOR'], rare: ['VENUSAUR', 'CHARIZARD', 'BLASTOISE'] },
  MAP_VICTORY_ROAD_1F: { rare: ['CLEFABLE', 'HITMONLEE', 'NIDOQUEEN', 'LUCARIO'] },
  MAP_VICTORY_ROAD_2F: { rare: ['GOLEM', 'HITMONCHAN', 'NIDOKING', 'GABITE'] },
  MAP_VICTORY_ROAD_3F: { rare: ['MACHAMP', 'POLIWRATH', 'TORTERRA'] },
  MAP_ONE_ISLAND_KINDLE_ROAD: { rare: ['ARCANINE', 'HIPPOWDON'] },
  MAP_THREE_ISLAND_BERRY_FOREST: { rare: ['LEAFEON'] },
  MAP_FIVE_ISLAND_MEADOW: { rare: ['TOGEKISS'] },
  MAP_SIX_ISLAND_PATTERN_BUSH: { rare: ['GALLADE'] },
  MAP_FOUR_ISLAND_ICEFALL_CAVE_1F: { extra: ['ABOMASNOW'], rare: ['GLACEON', 'MAMOSWINE', 'WEAVILE'] },
  MAP_SIX_ISLAND_RUIN_VALLEY: { rare: ['OMASTAR', 'KABUTOPS', 'PROBOPASS'] },
  MAP_FIVE_ISLAND_LOST_CAVE_ROOM1: { rare: ['GENGAR', 'DUSKNOIR'] },
  MAP_SEVEN_ISLAND_SEVAULT_CANYON: { rare: ['DRAGONITE', 'GLISCOR'] },
  MAP_CERULEAN_CAVE_B1F: { rare: ['ALAKAZAM', 'RHYDON', 'BLISSEY', 'RHYPERIOR'] },
};
for (const a of ACTS) for (const ar of a.areas) Object.assign(ar, KANTO_FINDS[ar.map]);

// Legendary encounters used as elites/bosses: wild battles that can be caught.
export const LEGENDS = {
  LEGEND_ZAPDOS: { species: 'ZAPDOS', title: 'ZAPDOS', terrain: 'building', music: 'mus_vs_legend' },
  LEGEND_ARTICUNO: { species: 'ARTICUNO', title: 'ARTICUNO', terrain: 'cave', music: 'mus_vs_legend' },
  LEGEND_MOLTRES: { species: 'MOLTRES', title: 'MOLTRES', terrain: 'mountain', music: 'mus_vs_legend' },
  LEGEND_SNORLAX: { species: 'SNORLAX', title: 'SNORLAX', terrain: 'grass', music: 'mus_vs_wild', levelOffset: -2 },
  LEGEND_ENTEI: { species: 'ENTEI', title: 'ENTEI', terrain: 'grass', music: 'mus_vs_legend' },
  LEGEND_RAIKOU: { species: 'RAIKOU', title: 'RAIKOU', terrain: 'grass', music: 'mus_vs_legend' },
  LEGEND_SUICUNE: { species: 'SUICUNE', title: 'SUICUNE', terrain: 'water', music: 'mus_vs_legend' },
  LEGEND_LUGIA: { species: 'LUGIA', title: 'LUGIA', terrain: 'water', music: 'mus_vs_legend' },
  LEGEND_HO_OH: { species: 'HO_OH', title: 'HO-OH', terrain: 'mountain', music: 'mus_vs_legend' },
  LEGEND_MEWTWO: { species: 'MEWTWO', title: 'MEWTWO', terrain: 'cave', music: 'mus_vs_mewtwo' },
  LEGEND_DEOXYS: { species: 'DEOXYS', title: 'DEOXYS', terrain: 'mountain', music: 'mus_vs_deoxys' },
};

Object.assign(LEGENDS, HOENN_LEGENDS, JOHTO_LEGENDS, GEN4_LEGENDS);
// (a world's / run's act list: game/regions.js actsFor / actsForRun)

// Starters. BULBASAUR / CHARMANDER / SQUIRTLE are open from the start (TREECKO / TORCHIC / MUDKIP in
// HOENN); the rest are unlocked one per act clear (game/unlocks.js).
// Every Gen 3 type is some starter's primary or secondary type (tests/logic.test.mjs checks it).
// item: a held item the run starts with (solo and co-op, every ascension), shown on the starter screen.
export const STARTERS = [
  { species: 'BULBASAUR', moves: ['TACKLE', 'GROWL', 'LEECH_SEED', 'VINE_WHIP'] },
  { species: 'CHARMANDER', moves: ['METAL_CLAW', 'GROWL', 'EMBER', 'SMOKESCREEN'] },
  { species: 'SQUIRTLE', moves: ['TACKLE', 'TAIL_WHIP', 'BUBBLE', 'WITHDRAW'] },
  { species: 'PIKACHU', moves: ['THUNDER_SHOCK', 'CHARGE_BEAM', 'QUICK_ATTACK', 'GROWL'], item: 'LIGHT_BALL' },
  { species: 'EEVEE', moves: ['TACKLE', 'TAIL_WHIP', 'SAND_ATTACK', 'QUICK_ATTACK'] },
  { species: 'PIDGEY', moves: ['TACKLE', 'GUST', 'SAND_ATTACK', 'QUICK_ATTACK'] },
  { species: 'MACHOP', moves: ['KARATE_CHOP', 'LOW_KICK', 'ROCK_SMASH', 'FOCUS_ENERGY'], item: 'MACHO_BRACE' },
  { species: 'NINCADA', moves: ['BUG_BITE', 'LEECH_LIFE', 'SCRATCH', 'SAND_ATTACK'] },
  { species: 'GASTLY', moves: ['LICK', 'SHADOW_SNEAK', 'SMOG', 'HYPNOSIS'] },
  { species: 'ABRA', moves: ['CONFUSION', 'POUND', 'KINESIS', 'DISABLE'] },
  { species: 'SWINUB', moves: ['POWDER_SNOW', 'ICE_SHARD', 'MUD_SLAP', 'TACKLE'] },
  { species: 'HOUNDOUR', moves: ['EMBER', 'BITE', 'LEER', 'HOWL'] },
  { species: 'CHIKORITA', moves: ['TACKLE', 'GROWL', 'RAZOR_LEAF', 'POISON_POWDER'] },
  { species: 'CYNDAQUIL', moves: ['TACKLE', 'LEER', 'SMOKESCREEN', 'EMBER'] },
  { species: 'TOTODILE', moves: ['SCRATCH', 'LEER', 'RAGE', 'WATER_GUN'] },
  { species: 'TREECKO', moves: ['POUND', 'LEER', 'ABSORB', 'QUICK_ATTACK'] },
  { species: 'TORCHIC', moves: ['SCRATCH', 'GROWL', 'FOCUS_ENERGY', 'EMBER'] },
  { species: 'MUDKIP', moves: ['TACKLE', 'GROWL', 'MUD_SLAP', 'WATER_GUN'] },
  { species: 'DRATINI', moves: ['WRAP', 'LEER', 'THUNDER_WAVE', 'TWISTER'] },
  { species: 'LARVITAR', moves: ['BITE', 'ROCK_THROW', 'LEER', 'SANDSTORM'] },
  { species: 'BELDUM', moves: ['TAKE_DOWN', 'TACKLE', 'IRON_DEFENSE', 'METAL_CLAW'] },
];
export const GEN3_TYPES = ['NORMAL', 'FIRE', 'WATER', 'GRASS', 'ELECTRIC', 'ICE', 'FIGHTING', 'POISON', 'GROUND', 'FLYING', 'PSYCHIC', 'BUG', 'ROCK', 'GHOST', 'DRAGON', 'DARK', 'STEEL'];

// ---- Rival ------------------------------------------------------------------------------------
// FireRed-style: the rival picks the starter that beats yours. Kanto: BLUE takes one of BULBASAUR /
// CHARMANDER / SQUIRTLE, Hoenn: MAY takes one of TREECKO / TORCHIC / MUDKIP. For any other starter the
// rival takes the one with the best type matchup against it (its attack vs your types, minus yours vs it).
export const RIVAL_STARTER = { BULBASAUR: 'CHARMANDER', CHARMANDER: 'SQUIRTLE', SQUIRTLE: 'BULBASAUR' };
export const MAY_STARTER = { TREECKO: 'TORCHIC', TORCHIC: 'MUDKIP', MUDKIP: 'TREECKO' };
export const SILVER_STARTER = { CHIKORITA: 'CYNDAQUIL', CYNDAQUIL: 'TOTODILE', TOTODILE: 'CHIKORITA' };
const STARTER_TYPES = { BULBASAUR: ['GRASS', 'POISON'], CHARMANDER: ['FIRE'], SQUIRTLE: ['WATER'], TREECKO: ['GRASS'], TORCHIC: ['FIRE'], MUDKIP: ['WATER'], CHIKORITA: ['GRASS'], CYNDAQUIL: ['FIRE'], TOTODILE: ['WATER'] };
// rival: the rival's home region ('kanto' = BLUE, 'hoenn' = MAY, 'johto' = SILVER), which decides the three starters they choose from.
const RIVAL_PICKS = {
  kanto: { fixed: RIVAL_STARTER, opts: ['CHARMANDER', 'SQUIRTLE', 'BULBASAUR'] },
  hoenn: { fixed: MAY_STARTER, opts: ['TORCHIC', 'MUDKIP', 'TREECKO'] },
  johto: { fixed: SILVER_STARTER, opts: ['CYNDAQUIL', 'TOTODILE', 'CHIKORITA'] },
};
// How well `theirs` (a type list) beats `mine`: [is it super effective, its best STAB multiplier on you, minus yours on it].
function matchup(theirs, mine) {
  const eff = Math.max(...theirs.map(t => typeEffect(t, mine)));
  const back = Math.max(...mine.map(t => typeEffect(t, theirs)));
  return [eff >= 2 ? 1 : 0, eff, -back];
}
const better = (a, b) => a[0] !== b[0] ? a[0] > b[0] : a[1] !== b[1] ? a[1] > b[1] : a[2] > b[2] + 1e-9;
function bestOf(opts, mine) {
  let best = null, bestS = null;
  for (const o of opts) {
    const types = D.species?.[o]?.types || STARTER_TYPES[o];
    if (!types) continue;
    const sc = matchup(types, mine);
    if (!best || better(sc, bestS)) { best = o; bestS = sc; }
  }
  return { best, super: !!bestS?.[0] };
}
// The rival's starter, which ALWAYS beats yours if any starter can: the classic triangle for the region's own three;
// otherwise the best of the region's three if one is super effective against you; otherwise the best starter of any
// region (e.g. ABRA against MACHOP, LARVITAR or ABRA against GASTLY).
export function counterStarter(playerStarter, rival = 'kanto') {
  const picks = RIVAL_PICKS[rival] || RIVAL_PICKS.kanto;
  if (picks.fixed[playerStarter]) return picks.fixed[playerStarter];
  const mine = D.species?.[playerStarter]?.types;
  if (!mine || !D.types) return picks.opts[0];
  const home = bestOf(picks.opts, mine);
  if (home.super) return home.best;
  const fam = new Set(evoLine(familyBase(playerStarter)));
  const any = bestOf([...picks.opts, ...STARTERS.map(s => s.species).filter(sp => !picks.opts.includes(sp) && !fam.has(sp) && D.species?.[sp])], mine);
  return any.best || home.best;
}
// Which of the region's own three starters a rival's authored team is built around (FireRed's BLUE teams are keyed by
// it): the best matchup among those three, before the team's starter line is swapped for counterStarter's.
export function templateStarter(playerStarter, rival = 'kanto') {
  const picks = RIVAL_PICKS[rival] || RIVAL_PICKS.kanto;
  if (picks.fixed[playerStarter]) return picks.fixed[playerStarter];
  const mine = D.species?.[playerStarter]?.types;
  return mine && D.types ? bestOf(picks.opts, mine).best : picks.opts[0];
}

// FireRed rival/champion trainer keys are named after the *rival's* starter:
// RIVAL_*_SQUIRTLE is the rival who picked Squirtle (player took Charmander).
export function rivalKey(base, playerStarter) { return `${base}_${templateStarter(playerStarter, 'kanto')}`; }
// A species' evolution line from its base form (first branch): ABRA -> [ABRA, KADABRA, ALAKAZAM].
function familyBase(sp) {
  for (let i = 0; i < 3; i++) {
    const pre = Object.keys(D.species || {}).find(k => (D.species[k].evolutions || []).some(e => e.into === sp));
    if (!pre) break;
    sp = pre;
  }
  return sp;
}
export function evoLine(base) {
  const line = [base];
  let cur = base;
  for (let i = 0; i < 2; i++) {
    const evo = (D.species?.[cur]?.evolutions || []).find(e => D.species[e.into]);
    if (!evo) break;
    cur = evo.into; line.push(cur);
  }
  return line;
}
// An authored rival team built around `line` (BLUE's keyed teams, MAY's TORCHIC line, SILVER's CYNDAQUIL line): swap
// that line for the counter's, stage for stage (QUILAVA -> KADABRA when the counter is ABRA).
export function rivalParty(party, counter, line = 'TORCHIC') {
  if (!counter || !line || counter === line || !D.species?.[counter] || !D.species?.[line]) return party;
  const from = evoLine(line), to = evoLine(counter);
  return party.map(p => {
    const i = from.indexOf(p.species);
    if (i >= 0) return { ...p, species: to[Math.min(i, to.length - 1)], moves: null };
    // the counter's line already on the team (BLUE's ABRA when the counter is ABRA) takes the old line's place
    // instead, so the team never carries two of the same line
    const j = to.indexOf(p.species);
    return j < 0 ? p : { ...p, species: from[Math.min(j, from.length - 1)], moves: null };
  });
}
// BLUE's FireRed team for the player's starter, with his ace swapped to the counter when it isn't one of his three.
export const blueParty = (party, playerStarter) => rivalParty(party, counterStarter(playerStarter, 'kanto'), templateStarter(playerStarter, 'kanto'));
export const mayParty = (party, counter) => rivalParty(party, counter, 'TORCHIC');
// Pre-battle lines. {S} = your starter, {R} = the rival's ace.
export const RIVAL_INTROS = {
  RIVAL_CERULEAN: ['BLUE: Yo! Still crawling along back here? You and your {S} look like you could use some help.', "BLUE: I picked {R} because it beats your {S}. Want to see? Let's go!"],
  RIVAL_POKEMON_TOWER: ["BLUE: Hey! What are you doing out here? Your POKéMON don't look any stronger.", 'BLUE: My {R} has been training too, and it eats {S} for breakfast. Smell ya after this!'],
  RIVAL_SILPH: ["BLUE: What kept you? I've been to the top of SILPH CO. already!", "BLUE: I'm going to be the CHAMPION. Me and {R}! You're just a warm-up!"],
  CHAMPION_FIRST: ['BLUE: Hey! I was looking forward to seeing you here. While you were dawdling, I made it to the top!', "BLUE: I'm the most powerful trainer in the world. Me and {R} beat your {S} every time. Let's settle this!"],
  MAY: ["MAY: Oh, hi! You're the new kid from LITTLEROOT, right? How's your {S} doing?", "MAY: I chose {R} because it's good against yours. No hard feelings! Let's battle!"],
  MAY_2: ["MAY: Hey, it's you again! I've been training really hard since our last battle.", "MAY: {R} is a lot stronger now. Show me what you've got!"],
  MAY_3: ["MAY: Wow, you've gotten so strong! But me and {R} won't lose this time!"],
  ...SILVER_INTROS,
};

// ---- Legendary birds (and Hoenn's REGIS) --------------------------------------------------------
// One optional node per act (act.bird). Beating it gives its unique held item and a one-time chance to
// add it to your party with the deck below (moves that exist are kept).
export const BIRDS = {
  LEGEND_ZAPDOS: { item: 'THUNDER_FEATHER', moves: ['THUNDER_SHOCK', 'PECK', 'SHOCK_WAVE', 'THUNDER_WAVE'] },
  LEGEND_ARTICUNO: { item: 'FROST_FEATHER', moves: ['ICY_WIND', 'WING_ATTACK', 'POWDER_SNOW', 'MIST'] },
  LEGEND_MOLTRES: { item: 'FLAME_FEATHER', moves: ['FLAMETHROWER', 'WING_ATTACK', 'FIRE_SPIN', 'AGILITY'] },
  LEGEND_REGIROCK: { item: 'ROCK_CORE', moves: ['ROCK_THROW', 'ROCK_TOMB', 'CURSE', 'ANCIENT_POWER'] },
  LEGEND_REGICE: { item: 'ICE_CORE', moves: ['ICY_WIND', 'ICE_PUNCH', 'CURSE', 'ANCIENT_POWER'] },
  LEGEND_REGISTEEL: { item: 'STEEL_CORE', moves: ['METAL_CLAW', 'ANCIENT_POWER', 'IRON_DEFENSE', 'AMNESIA'] },
  ...JOHTO_BIRDS,
};
// Co-op (v0.3.11): a legendary node fields two legendaries, the act's own and the next one of its trio (each player
// may catch one of the two). The act's legendary keeps its held item; the partner brings no item.
export const BIRD_PARTNER = {
  LEGEND_ZAPDOS: 'LEGEND_ARTICUNO', LEGEND_ARTICUNO: 'LEGEND_MOLTRES', LEGEND_MOLTRES: 'LEGEND_ZAPDOS',
  LEGEND_REGIROCK: 'LEGEND_REGICE', LEGEND_REGICE: 'LEGEND_REGISTEEL', LEGEND_REGISTEEL: 'LEGEND_REGIROCK',
  LEGEND_RAIKOU: 'LEGEND_ENTEI', LEGEND_ENTEI: 'LEGEND_SUICUNE', LEGEND_SUICUNE: 'LEGEND_RAIKOU',
};

// ---- Mythic "?" events (v0.3.25: events.js CERULEAN CAVE, FARAWAY ISLAND, BIRTH ISLAND, SKY PILLAR) ------------------
// A one-off fight scaled like the act's legendary node (Run.mythicConfig): lvl = levels over the floor's level, hp / dmg =
// on top of the legendary node's HP and damage (TUNING.bird), moves = the foe's moves, catchMoves = the deck it joins
// with (tmMoves: MEW's are random TM moves, the same ones it fought with), rule = its boss rule (bosses.js), coopHp = extra
// co-op HP (balanced with tests/coop_mythic_bench.mjs: a smart-bot room at KANTO act 3 wins about 55-65% of these fights,
// the act's legendary pair ~88%; MEW: more HP, though a room throwing 2-4 balls a turn catches it almost every time).
//   MEWTWO  co-op: attacks EVERY player each turn (allTarget, coop/duo.js); solo: a normal fight
//   MEW     a wild battle (balls work, catchMult x the catch rate); flees after 3 turns unless asleep or paralysed
//   DEOXYS  switches ATTACK / DEFENSE / SPEED forme every turn
export const MYTHICS = {
  MEWTWO: { species: 'MEWTWO', title: 'MEWTWO', terrain: 'cave', music: 'mus_vs_mewtwo', lvl: 3, hp: 0.72, dmg: 0.8, coopHp: 0.7, rule: 'MEWTWO', allTarget: true,
    moves: ['PSYCHIC', 'SHADOW_BALL', 'ICE_BEAM', 'THUNDERBOLT'], catchMoves: ['PSYCHIC', 'SWIFT', 'BARRIER', 'RECOVER'] },
  MEW: { species: 'MEW', title: 'MEW', terrain: 'longgrass', music: 'mus_vs_legend', lvl: 0, hp: 0.5, dmg: 0.75, coopHp: 2.2, rule: 'MEW', wild: true, catchMult: 4, tmMoves: true },
  DEOXYS: { species: 'DEOXYS', title: 'DEOXYS', terrain: 'mountain', music: 'mus_vs_deoxys', lvl: 3, hp: 1.5, dmg: 0.85, coopHp: 0.85, rule: 'DEOXYS',
    moves: ['PSYCHO_BOOST', 'SUPERPOWER', 'PSYCHIC', 'COSMIC_POWER'], catchMoves: ['PSYCHIC', 'NIGHT_SHADE', 'SUPERPOWER', 'COSMIC_POWER'] },
  RAYQUAZA: { species: 'RAYQUAZA', title: 'RAYQUAZA', terrain: 'mountain', music: 'mus_vs_legend', lvl: 3, hp: 0.75, dmg: 0.85, coopHp: 0.85, rule: 'LEGEND',
    moves: ['DRAGON_CLAW', 'EXTREME_SPEED', 'CRUNCH', 'DRAGON_DANCE'], catchMoves: ['DRAGON_CLAW', 'TWISTER', 'CRUNCH', 'DRAGON_DANCE'] },
};
// Nobody fights their own POKéMON (v0.3.25): an act boss the run's player (co-op: anyone in the room) caught becomes the
// first of these that nobody owns (owned: species). MEWTWO and DEOXYS share the SEVII post-game; RAYQUAZA's stand-ins
// are the SKY PILLAR act's weather trio.
export const BOSS_SWAPS = {
  LEGEND_MEWTWO: ['LEGEND_DEOXYS', 'LEGEND_LUGIA', 'LEGEND_HO_OH'],
  LEGEND_DEOXYS: ['LEGEND_MEWTWO', 'LEGEND_LUGIA', 'LEGEND_HO_OH'],
  LEGEND_RAYQUAZA: ['LEGEND_GROUDON', 'LEGEND_KYOGRE', 'LEGEND_LATIOS'],
};
export function swapBoss(key, owned = []) {
  const own = new Set(owned);
  if (!key || !LEGENDS[key] || !BOSS_SWAPS[key] || !own.has(LEGENDS[key].species)) return key;
  return BOSS_SWAPS[key].find(k => LEGENDS[k] && !own.has(LEGENDS[k].species)) || key;
}

export const MAP_NODE_WEIGHTS = {
  wild: 24, trainer: 25, event: 18, center: 10, mart: 9, elite: 10,
};
