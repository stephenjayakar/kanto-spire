// Gen 4 POKéMON (national dex 387-493), part of the game since v0.4.0.
//
// tools/extract_gen4.py pulls them from the owner's HeartGold ROM into web/assets, all under gen4/ folders:
//   data/gen4/species.json        the 107 species in species.json's format, plus crossGen (see applyGen4)
//   gfx/gen4/pokemon/<mon>/       front / back (+ _shiny), anim_front (HGSS's 2-frame idle), icon (2 frames)
//   sound/gen4/cries/<mon>.wav    the HGSS cry samples (audio/sound.js plays them, main.js wires it)
// data.js loads the file with the rest of the data on every boot and merges it into D.species (applyGen4), so the
// species work wherever a species key is used (sprites via gfxDir, see scenes/common.js monDir). FireRed's own
// species.json stays untouched: the frozen co-op engines (web/src/legacy/) read it and must keep seeing 386 species.
// Where they live: the regions' wild "extra" / "rare find" tables (acts.js KANTO_FINDS, hoenn.js HOENN_FINDS,
// johto.js JOHTO_FINDS); the legendaries are rare legendary elites (GEN4_LEGENDS below, act.rareLegends, Run.eliteConfig).

// Under assets/data/ (the loader adds the prefix).
export const GEN4_DATA_FILE = 'gen4/species.json';

// loader(name) -> parsed JSON, like data.js loadData's. Dev tools call this directly (web/gen4lab.html).
export function loadGen4(loader) { return loader(GEN4_DATA_FILE); }

// ---- evolutions --------------------------------------------------------------------------------------------
// The roguelike has no clock, gender, places or trading, so (like FireRed's trade evolutions, pokemon.js
// levelEvolution) every Gen 4 method becomes one of this game's rules. The entry keeps the HGSS method as gen4Method
// (+ gen4Param) for the POKéDEX text.
//   MAGNETIC_FIELD (MAGNEZONE, PROBOPASS)   -> THUNDER STONE        (what later games use)
//   MOSS_ROCK (LEAFEON) / ICE_ROCK (GLACEON) -> LEAF STONE / ICE STONE (likewise)
//   ITEM_MALE / ITEM_FEMALE (GALLADE, FROSLASS) -> the DAWN STONE, any POKéMON (no genders here)
//   HOLD_ITEM_NIGHT (RAZOR CLAW / FANG at night: WEAVILE, GLISCOR) -> DUSK STONE
//   HOLD_ITEM_DAY (HAPPINY's OVAL STONE)     -> Lv22, the friendship rule of every other baby
//   FRIENDSHIP_DAY / _NIGHT with one evolution (BUDEW, RIOLU, CHINGLING) -> FRIENDSHIP (Lv22); EEVEE's own day /
//                                               night pair keeps its SUN / MOON STONE (evoStone)
//   LEVEL_FEMALE with one evolution (COMBEE) -> LEVEL; BURMY's female / male pair stays a 50/50 branch at its level
//   PARTY_SPECIES (MANTYKE + REMORAID)       -> Lv30, like the other Gen 2 babies that grow up late
//   KNOWS_MOVE (LICKILICKY, TANGROWTH, YANMEGA, MAMOSWINE, AMBIPOM, SUDOWOODO, MR. MIME) stays: it evolves on a
//     level-up while it knows (or just learned) the move, else at KNOWS_MOVE_LEVEL anyway; KNOWS_MOVE_LEARN puts the
//     move into the learnset at its DPPt / HGSS level where FireRed's has none (PILOSWINE's is Lv1: the relearner).
// SHINY / DUSK / DAWN / ICE STONE are new items (items.js CONSUMABLES, HGSS icons via tools/extract_hgss.py).
export const KNOWS_MOVE_LEVEL = 40;
export const KNOWS_MOVE_LEARN = { LICKITUNG: [33, 'ROLLOUT'], TANGELA: [33, 'ANCIENT_POWER'], YANMA: [33, 'ANCIENT_POWER'], PILOSWINE: [1, 'ANCIENT_POWER'] };
const STONE_FOR = { MAGNETIC_FIELD: 'THUNDER_STONE', MOSS_ROCK: 'LEAF_STONE', ICE_ROCK: 'ICE_STONE', HOLD_ITEM_NIGHT: 'DUSK_STONE' };

// One evolution entry in this game's terms (evos: all of the species' entries, for the one-evolution rules).
export function gameEvolution(e, evos) {
  const tag = (o) => ({ ...o, into: e.into, gen4Method: e.method, ...(e.param != null ? { gen4Param: e.param } : {}) });
  if (STONE_FOR[e.method]) return tag({ method: 'ITEM', param: STONE_FOR[e.method] });
  switch (e.method) {
    case 'ITEM_MALE': case 'ITEM_FEMALE': return tag({ method: 'ITEM', param: e.param });
    case 'HOLD_ITEM_DAY': return tag({ method: 'FRIENDSHIP', param: null });
    case 'PARTY_SPECIES': return tag({ method: 'LEVEL', param: 30 });
    case 'FRIENDSHIP_DAY': case 'FRIENDSHIP_NIGHT': return evos.length === 1 ? tag({ method: 'FRIENDSHIP', param: null }) : { ...e };
    case 'LEVEL_FEMALE': case 'LEVEL_MALE': return evos.length === 1 ? tag({ method: 'LEVEL', param: e.param }) : { ...e };
    default: return { ...e };
  }
}
const gameEvolutions = (evos) => (evos || []).map(e => gameEvolution(e, evos));

// Merges the Gen 4 data into D (before data.js indexes it). Add-only: an existing species is never replaced.
//   crossGen.evolutions:    Gen 1-3 species -> their Gen 4 evolutions (MAGNETON -> MAGNEZONE, EEVEE -> LEAFEON...)
//   crossGen.preEvolutions: Gen 1-3 base forms -> their Gen 4 babies (SNORLAX <- MUNCHLAX...)
// Returns the number of species added.
export function applyGen4(D, g4) {
  if (!g4?.species) return 0;
  let n = 0;
  for (const [key, s] of Object.entries(g4.species)) {
    if (D.species[key]) continue;
    const c = structuredClone(s);
    c.evolutions = gameEvolutions(c.evolutions);
    D.species[key] = c;
    n++;
  }
  for (const [key, evos] of Object.entries(g4.crossGen?.evolutions || {})) {
    const s = D.species[key];
    if (!s) continue;
    const add = gameEvolutions(evos).filter(e => D.species[e.into] && !(s.evolutions || []).some(x => x.into === e.into));
    s.evolutions = [...(s.evolutions || []), ...add];
  }
  for (const [key, baby] of Object.entries(g4.crossGen?.preEvolutions || {})) {
    const s = D.species[key];
    if (s && !s.preEvolution && D.species[baby]) s.preEvolution = baby;
  }
  // KNOWS_MOVE evolvers learn their move by level-up (sorted in after any move of the same level)
  for (const [key, [lvl, mv]] of Object.entries(KNOWS_MOVE_LEARN)) {
    const s = D.species[key];
    if (!s || (s.learnset || []).some(([, m]) => m === mv)) continue;
    const ls = (s.learnset || []).slice();
    let i = lvl <= 1 ? 0 : ls.findIndex(([l]) => l > lvl);
    if (i < 0) i = ls.length;
    ls.splice(i, 0, [lvl, mv]);
    s.learnset = ls;
  }
  return n;
}

export const isGen4 = (species) => species?.gen4 === true;

// ---- legendaries -------------------------------------------------------------------------------------------
// The Gen 4 legendaries and mythicals as legendary encounters, in acts.js LEGENDS' shape (merged into LEGENDS there).
// None is an act's boss or legendary node: they are RARE LEGENDARY ELITES (act.rareLegends: [key, chance]), an elite
// node that turns into the legendary now and then (Run.eliteConfig), a wild battle like the post-game's LUGIA / HO-OH
// elites (catchable with balls; ONE LEGENDARY PER RUN applies, pokemon.js LEGENDARY). moves: what it fights with (the
// learnsets' signature moves aren't in this game; no healing / stat-stacking stall, and DIALGA / PALKIA / GIRATINA keep
// one status move, so a fight lands near the post-game's LUGIA / HO-OH / GROUDON elites: smart bot, a fixed team at the
// act's top level, 150 fights each). No overworld sprites: an elite node doesn't show its foe.
export const GEN4_LEGENDS = {
  LEGEND_UXIE: { species: 'UXIE', title: 'UXIE', terrain: 'water', music: 'mus_vs_legend', moves: ['EXTRASENSORY', 'FUTURE_SIGHT', 'YAWN', 'AMNESIA'] },
  LEGEND_MESPRIT: { species: 'MESPRIT', title: 'MESPRIT', terrain: 'water', music: 'mus_vs_legend', moves: ['EXTRASENSORY', 'FUTURE_SIGHT', 'CHARM', 'SWIFT'] },
  LEGEND_AZELF: { species: 'AZELF', title: 'AZELF', terrain: 'water', music: 'mus_vs_legend', moves: ['EXTRASENSORY', 'FUTURE_SIGHT', 'NASTY_PLOT', 'UPROAR'] },
  LEGEND_DIALGA: { species: 'DIALGA', title: 'DIALGA', terrain: 'mountain', music: 'mus_vs_legend', moves: ['DRAGON_CLAW', 'METAL_CLAW', 'ANCIENT_POWER', 'SCARY_FACE'] },
  LEGEND_PALKIA: { species: 'PALKIA', title: 'PALKIA', terrain: 'mountain', music: 'mus_vs_legend', moves: ['DRAGON_CLAW', 'WATER_PULSE', 'ANCIENT_POWER', 'SCARY_FACE'] },
  LEGEND_HEATRAN: { species: 'HEATRAN', title: 'HEATRAN', terrain: 'cave', music: 'mus_vs_legend', moves: ['LAVA_PLUME', 'IRON_HEAD', 'EARTH_POWER', 'SCARY_FACE'] },
  LEGEND_REGIGIGAS: { species: 'REGIGIGAS', title: 'REGIGIGAS', terrain: 'cave', music: 'mus_vs_legend', moves: ['ZEN_HEADBUTT', 'REVENGE', 'STOMP', 'CONFUSE_RAY'] },
  LEGEND_GIRATINA: { species: 'GIRATINA', title: 'GIRATINA', terrain: 'cave', music: 'mus_vs_legend', levelOffset: -2, moves: ['DRAGON_CLAW', 'SHADOW_CLAW', 'ANCIENT_POWER', 'SCARY_FACE'] },
  LEGEND_CRESSELIA: { species: 'CRESSELIA', title: 'CRESSELIA', terrain: 'water', music: 'mus_vs_legend', moves: ['PSYCHO_CUT', 'AURORA_BEAM', 'FUTURE_SIGHT', 'MOONLIGHT'] },
  // mythical
  LEGEND_PHIONE: { species: 'PHIONE', title: 'PHIONE', terrain: 'water', music: 'mus_vs_legend', moves: ['WATER_PULSE', 'BUBBLE_BEAM', 'WHIRLPOOL', 'SUPERSONIC'] },
  LEGEND_MANAPHY: { species: 'MANAPHY', title: 'MANAPHY', terrain: 'water', music: 'mus_vs_legend', moves: ['WATER_PULSE', 'BUBBLE_BEAM', 'WHIRLPOOL', 'CHARM'] },
  LEGEND_DARKRAI: { species: 'DARKRAI', title: 'DARKRAI', terrain: 'building', music: 'mus_vs_legend', moves: ['DARK_PULSE', 'HYPNOSIS', 'NIGHTMARE', 'FAINT_ATTACK'] },
  LEGEND_SHAYMIN: { species: 'SHAYMIN', title: 'SHAYMIN', terrain: 'grass', music: 'mus_vs_legend', moves: ['ENERGY_BALL', 'MAGICAL_LEAF', 'SEED_BOMB', 'GROWTH'] },
  LEGEND_ARCEUS: { species: 'ARCEUS', title: 'ARCEUS', terrain: 'mountain', music: 'mus_vs_legend', moves: ['EXTREME_SPEED', 'HYPER_VOICE', 'EARTH_POWER', 'FUTURE_SIGHT'] },
};
// Chance that an elite node of the act is one of its rare legendaries instead (each [key, chance] of act.rareLegends is
// tried in turn; one that already appeared this run is skipped): RARE_LEGEND for an act's one legendary (a post-game with
// several splits about that much between them), ULTRA_RARE_LEGEND for the mythicals.
export const RARE_LEGEND = 0.1, ULTRA_RARE_LEGEND = 0.02;
