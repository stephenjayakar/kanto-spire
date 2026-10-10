// Gen 4 POKéMON (national dex 387-493): groundwork, HIDDEN.
//
// tools/extract_gen4.py pulls them from the owner's HeartGold ROM into web/assets, all under gen4/ folders:
//   data/gen4/species.json        the 107 species in species.json's format, plus crossGen (see applyGen4)
//   gfx/gen4/pokemon/<mon>/       front / back (+ _shiny), anim_front (HGSS's 2-frame idle), icon (2 frames)
//   sound/gen4/cries/<mon>.wav    the HGSS cry samples
// tools/upload_packs.cjs packs those as the lazy 'gen4' asset pack and leaves it out unless --gen4 is passed, and
// main.js skips that pack while the flag is off, so players don't download any of it yet.
//
// GEN4_ENABLED is the one switch. While it is false nothing here runs: data.js doesn't load the file, so D.species,
// byDex, evolutions, encounters, the POKéDEX (DEX_MAX 386) and every RNG draw are exactly what they were.
// Turning it on merges the species into D.species (they then work wherever a species key is used: sprites via
// gfxDir, see scenes/common.js monDir) and lets the Gen 1-3 lines evolve into them. It does NOT put them in any wild
// area, trainer team, event, starter list or the POKéDEX, and GEN4_LEGENDS isn't merged into acts.js LEGENDS:
// each of those is a separate decision. Flipping it changes game logic: bump LOGIC_ID (coop/engines.js) then.
export const GEN4_ENABLED = false;

// Under assets/data/ (the loader adds the prefix).
export const GEN4_DATA_FILE = 'gen4/species.json';

// loader(name) -> parsed JSON, like data.js loadData's. Dev tools call this directly (web/gen4lab.html).
export function loadGen4(loader) { return loader(GEN4_DATA_FILE); }

// Merges the Gen 4 data into D (before data.js indexes it). Add-only: an existing species is never replaced.
//   crossGen.evolutions:    Gen 1-3 species -> their Gen 4 evolutions (MAGNETON -> MAGNEZONE, EEVEE -> LEAFEON...)
//   crossGen.preEvolutions: Gen 1-3 base forms -> their Gen 4 babies (SNORLAX <- MUNCHLAX...)
// Evolution methods new in Gen 4 (MAGNETIC_FIELD, MOSS_ROCK, ICE_ROCK, HOLD_ITEM_DAY/NIGHT, KNOWS_MOVE,
// PARTY_SPECIES, LEVEL_MALE/FEMALE, ITEM_MALE/FEMALE) are data only: nothing in the game evolves by them yet.
export function applyGen4(D, g4) {
  if (!g4?.species) return 0;
  let n = 0;
  for (const [key, s] of Object.entries(g4.species)) {
    if (D.species[key]) continue;
    D.species[key] = structuredClone(s);
    n++;
  }
  for (const [key, evos] of Object.entries(g4.crossGen?.evolutions || {})) {
    const s = D.species[key];
    if (!s) continue;
    s.evolutions = [...(s.evolutions || []), ...evos.filter(e => D.species[e.into] && !(s.evolutions || []).some(x => x.into === e.into)).map(e => ({ ...e }))];
  }
  for (const [key, baby] of Object.entries(g4.crossGen?.preEvolutions || {})) {
    const s = D.species[key];
    if (s && !s.preEvolution && D.species[baby]) s.preEvolution = baby;
  }
  return n;
}

export const isGen4 = (species) => species?.gen4 === true;

// The Gen 4 legendaries as legendary encounters, in acts.js LEGENDS' shape. NOT merged into LEGENDS (and no act
// lists them), so none can appear. (No overworld sprites yet: the map falls back to its plain legend node.)
export const GEN4_LEGENDS = {
  LEGEND_UXIE: { species: 'UXIE', title: 'UXIE', terrain: 'cave', music: 'mus_vs_legend' },
  LEGEND_MESPRIT: { species: 'MESPRIT', title: 'MESPRIT', terrain: 'cave', music: 'mus_vs_legend' },
  LEGEND_AZELF: { species: 'AZELF', title: 'AZELF', terrain: 'cave', music: 'mus_vs_legend' },
  LEGEND_DIALGA: { species: 'DIALGA', title: 'DIALGA', terrain: 'mountain', music: 'mus_vs_legend' },
  LEGEND_PALKIA: { species: 'PALKIA', title: 'PALKIA', terrain: 'mountain', music: 'mus_vs_legend' },
  LEGEND_HEATRAN: { species: 'HEATRAN', title: 'HEATRAN', terrain: 'cave', music: 'mus_vs_legend' },
  LEGEND_REGIGIGAS: { species: 'REGIGIGAS', title: 'REGIGIGAS', terrain: 'cave', music: 'mus_vs_legend' },
  LEGEND_GIRATINA: { species: 'GIRATINA', title: 'GIRATINA', terrain: 'cave', music: 'mus_vs_legend' },
  LEGEND_CRESSELIA: { species: 'CRESSELIA', title: 'CRESSELIA', terrain: 'water', music: 'mus_vs_legend' },
  // mythical
  LEGEND_PHIONE: { species: 'PHIONE', title: 'PHIONE', terrain: 'water', music: 'mus_vs_legend' },
  LEGEND_MANAPHY: { species: 'MANAPHY', title: 'MANAPHY', terrain: 'water', music: 'mus_vs_legend' },
  LEGEND_DARKRAI: { species: 'DARKRAI', title: 'DARKRAI', terrain: 'building', music: 'mus_vs_legend' },
  LEGEND_SHAYMIN: { species: 'SHAYMIN', title: 'SHAYMIN', terrain: 'grass', music: 'mus_vs_legend' },
  LEGEND_ARCEUS: { species: 'ARCEUS', title: 'ARCEUS', terrain: 'mountain', music: 'mus_vs_legend' },
};
