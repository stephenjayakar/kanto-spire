// Emerald (Hoenn) music for HOENN acts. Display only: which song plays never touches game state, so co-op stays
// in lockstep whether or not a player has the Emerald bank.
//
// The Emerald songs come from an optional second sound bank (tools/extract_emerald_sound.js ->
// assets/sound/emerald/, shipped as the lazy 'emerald' asset pack). sound.js loads it next to FireRed's under the
// EM prefix ('em:mus_route101') and asks the resolver installed by main.js (hoennSong below) which song to play
// for each FireRed song name the scenes ask for. Without the bank, or outside HOENN, the FireRed song plays.
//
// Pure module (no game imports): main.js passes in the current act, tests read the tables.

export const EM = 'em:';

// The map's music by the act's progress (act.music's role), per HOENN act block id (hoenn.js HOENN_ACTS).
// Emerald plays MUS_PETALBURG_WOODS in its woods and most caves, MUS_ROUTE110 on 110/111/114.
export const HOENN_MAP_MUSIC = {
  1: ['mus_route101', 'mus_route104', 'mus_petalburg_woods'],                 // ROUTE 101/102 -> 104 -> woods, GRANITE CAVE
  2: ['mus_route110', 'mus_route111', 'mus_route113', 'mus_cave_of_origin'],  // 110/117 -> desert -> 113 -> METEOR FALLS
  3: ['mus_route119', 'mus_route120', 'mus_mt_pyre', 'mus_route122', 'mus_surf'], // 119/120 -> MT. PYRE -> 123 -> the sea
  4: ['mus_victory_road', 'mus_ever_grande'],
  5: ['mus_safari_zone', 'mus_mt_chimney', 'mus_sealed_chamber'],             // SAFARI ZONE -> SKY PILLAR -> SEALED CHAMBER
};
// Events and marts (act.townMusic's role).
export const HOENN_TOWN_MUSIC = { 1: 'mus_oldale', 2: 'mus_rustboro', 3: 'mus_lilycove', 4: 'mus_ever_grande', 5: 'mus_sootopolis' };

// FireRed song -> Emerald song anywhere in a HOENN act.
const SAME = ['mus_vs_wild', 'mus_vs_trainer', 'mus_vs_gym_leader', 'mus_vs_champion', 'mus_victory_wild', 'mus_victory_trainer',
  'mus_victory_gym_leader', 'mus_poke_center', 'mus_obtain_badge', 'mus_hall_of_fame', 'mus_cycling', 'mus_surf', 'mus_victory_road'];
export const HOENN_SONGS = {
  ...Object.fromEntries(SAME.map(s => [s, s])),
  mus_encounter_boy: 'mus_encounter_male', mus_encounter_girl: 'mus_encounter_female',
};
// Generic HOENN trainers (hoenn.js HOENN_TRAINER_CLASSES): Emerald's encounter music for the class.
const ENC = { male: 'mus_encounter_male', female: 'mus_encounter_female', girl: 'mus_encounter_girl', hiker: 'mus_encounter_hiker',
  intense: 'mus_encounter_intense', cool: 'mus_encounter_cool', swimmer: 'mus_encounter_swimmer', rich: 'mus_encounter_rich',
  twins: 'mus_encounter_twins', suspicious: 'mus_encounter_suspicious' };
export const HOENN_CLASS_ENCOUNTER = {
  RS_YOUNGSTER: ENC.male, RS_LASS: ENC.female, RS_BUG_CATCHER: ENC.male, RS_HIKER: ENC.hiker, RS_CAMPER: ENC.male,
  RS_PICNICKER: ENC.girl, RS_FISHERMAN: ENC.hiker, RS_SAILOR: ENC.male, RS_BLACK_BELT: ENC.intense, RS_PSYCHIC_M: ENC.intense,
  RS_PSYCHIC_F: ENC.intense, RS_BIRD_KEEPER: ENC.cool, RS_SWIMMER_M: ENC.swimmer, RS_SWIMMER_F: ENC.swimmer,
  RS_COOLTRAINER_M: ENC.cool, RS_COOLTRAINER_F: ENC.cool, RS_RUIN_MANIAC: ENC.hiker, RS_AROMA_LADY: ENC.female,
  RS_PKMN_RANGER_M: ENC.cool, RS_PKMN_RANGER_F: ENC.cool, RS_GENTLEMAN: ENC.rich, RS_BEAUTY: ENC.female, RS_TWINS: ENC.twins,
  RS_POKEMANIAC: ENC.suspicious,
};
// HOENN legendaries with a battle theme of their own in Emerald (others keep FireRed's legendary theme).
const LEGEND_SONG = { REGIROCK: 'mus_vs_regi', REGICE: 'mus_vs_regi', REGISTEEL: 'mus_vs_regi', GROUDON: 'mus_vs_kyogre_groudon', KYOGRE: 'mus_vs_kyogre_groudon', RAYQUAZA: 'mus_vs_rayquaza' };

const isHoenn = (r) => r === 'hoenn';
const ENCOUNTERS = new Set(['mus_encounter_boy', 'mus_encounter_girl', 'mus_encounter_rival', 'mus_encounter_gym_leader', 'mus_encounter_rocket']);
const VICTORIES = new Set(['mus_victory_wild', 'mus_victory_trainer', 'mus_victory_gym_leader']);

// The Emerald song (no prefix) to play for FireRed song `name` in `act`, or null for the FireRed one.
// ctx: the battle config while a battle scene plays its music (kind, trainer, gauntlet, legend, rival), or
// { map: progress 0..1 } for the map music, or nothing.
export function hoennSong(act, name, ctx = null) {
  if (!act || !name) return null;
  const id = act.id;
  if (ctx && ctx.map !== undefined) {
    if (!isHoenn(act.region)) return null;
    const list = HOENN_MAP_MUSIC[id];
    return list ? list[Math.min(list.length - 1, Math.floor(Math.max(0, ctx.map) * list.length))] : null;
  }
  if (ctx && ctx.kind) {
    // the ELITE FOUR / CHAMPION play their region's music (act 4 can be one region and the summit another)
    const gauntlet = ctx.gauntlet !== undefined && ctx.gauntlet !== null;
    const region = gauntlet ? act.summit || act.region : act.region;
    if (!isHoenn(region)) return null;
    const key = ctx.trainer?.key || '';
    const team = /^(AQUA|MAGMA)_/.test(key) ? (/_LEADER/.test(key) ? 'leader' : 'grunt') : null;
    const champion = gauntlet && ctx.music === 'mus_vs_champion';
    if (VICTORIES.has(name)) return gauntlet ? 'mus_victory_league' : team ? 'mus_victory_aqua_magma' : name;
    if (ENCOUNTERS.has(name)) {
      if (gauntlet) return champion ? 'mus_encounter_champion' : 'mus_encounter_elite_four';
      if (team) return /^AQUA/.test(key) ? 'mus_encounter_aqua' : 'mus_encounter_magma';
      if (ctx.rival) return /^MAY/.test(key) ? 'mus_encounter_may' : null;
      const cls = key.split(':')[0];
      if (HOENN_CLASS_ENCOUNTER[cls]) return HOENN_CLASS_ENCOUNTER[cls];
      return name === 'mus_encounter_gym_leader' || name === 'mus_encounter_rocket' || name === 'mus_encounter_rival' ? null : HOENN_SONGS[name] || null;
    }
    if (ctx.legend) return LEGEND_SONG[ctx.legend] || (name === 'mus_vs_wild' ? 'mus_vs_wild' : null);
    if (gauntlet) return champion ? 'mus_vs_champion' : 'mus_vs_elite_four';
    if (team) return team === 'leader' ? 'mus_vs_aqua_magma_leader' : 'mus_vs_aqua_magma';
    if (ctx.rival && /^MAY/.test(key)) return 'mus_vs_rival';
    return HOENN_SONGS[name] || null;
  }
  if (name === 'mus_hall_of_fame') return isHoenn(act.summit || act.region) ? name : null; // (the summit's region)
  if (!isHoenn(act.region)) return null;
  if (name === act.townMusic && HOENN_TOWN_MUSIC[id]) return HOENN_TOWN_MUSIC[id];
  return HOENN_SONGS[name] || null;
}

// Every Emerald song the game can ask for (tests/emerald_audio.mjs checks the bank has them all).
export const HOENN_SONG_SET = new Set([
  ...Object.values(HOENN_MAP_MUSIC).flat(), ...Object.values(HOENN_TOWN_MUSIC), ...Object.values(HOENN_SONGS),
  ...Object.values(HOENN_CLASS_ENCOUNTER), ...Object.values(LEGEND_SONG),
  'mus_victory_league', 'mus_victory_aqua_magma', 'mus_encounter_champion', 'mus_encounter_elite_four', 'mus_encounter_aqua',
  'mus_encounter_magma', 'mus_encounter_may', 'mus_vs_elite_four', 'mus_vs_aqua_magma', 'mus_vs_aqua_magma_leader', 'mus_vs_rival',
]);
