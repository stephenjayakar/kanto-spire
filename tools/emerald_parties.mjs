// Prints the HOENN trainer teams for web/src/game/hoenn.js (HOENN_PARTIES) from the pokeemerald decomp's
// src/data/trainer_parties.h. Dev tool: the teams are game logic, so they're committed in hoenn.js and never read
// from the optional Emerald asset pack at runtime (co-op lockstep must not depend on what a player extracted).
//
// The game keeps its own rules: levels are only used as each team's spread (run.js makeTrainerEnemies rescales them
// to the act's boss / floor level), IVs are the game's authored 120 (L()), held items are ignored. Species and
// movesets are Emerald's (default-move parties: null = level-up moves, like Emerald).
//
// Usage: node tools/emerald_parties.mjs [path/to/pokeemerald]   (default: pokeemerald/)
import fs from 'fs';
import path from 'path';

const DEC = process.argv[2] || 'pokeemerald';
const src = fs.readFileSync(path.join(DEC, 'src/data/trainer_parties.h'), 'utf8');

// game trainer key -> Emerald party (sParty_*). (MAGMA_ADMIN_COURTNEY isn't fought in Emerald: hoenn.js keeps her R/S team.)
export const EMERALD_PARTY_OF = {
  LEADER_ROXANNE: 'Roxanne1', LEADER_BRAWLY: 'Brawly1', LEADER_WATTSON: 'Wattson1', LEADER_FLANNERY: 'Flannery1',
  LEADER_NORMAN: 'Norman1', LEADER_WINONA: 'Winona1', LEADER_TATE_LIZA: 'TateAndLiza1',
  LEADER_WALLACE: 'Juan1',          // Emerald's 8th GYM LEADER is JUAN (WALLACE is its CHAMPION)
  ELITE_FOUR_SIDNEY: 'Sidney', ELITE_FOUR_PHOEBE: 'Phoebe', ELITE_FOUR_GLACIA: 'Glacia', ELITE_FOUR_DRAKE: 'Drake',
  RS_CHAMPION: 'Wallace',           // Emerald's CHAMPION
  EM_STEVEN: 'Steven',              // Emerald's post-game STEVEN (METEOR FALLS)
  AQUA_GRUNT_M: 'GruntMuseum2', AQUA_GRUNT_F: 'GruntWeatherInst5', MAGMA_GRUNT_M: 'GruntJaggedPass',
  AQUA_ADMIN_MATT: 'Matt', AQUA_ADMIN_SHELLY: 'ShellyWeatherInstitute', MAGMA_ADMIN_TABITHA: 'TabithaMtChimney',
  MAGMA_LEADER: 'MaxieMagmaHideout', AQUA_LEADER: 'Archie',
  // MAY's teams when the player chose TREECKO (her ace is the TORCHIC line; run.js swaps in the line that counters you)
  MAY: 'MayRustboroTreecko', MAY_2: 'MayRoute110Treecko', MAY_3: 'MayLilycoveTreecko',
};

const parties = {};
for (const m of src.matchAll(/static const struct (\w+) sParty_(\w+)\[\] = \{([\s\S]*?)\n\};/g)) {
  parties[m[2]] = [...m[3].matchAll(/\{([\s\S]*?)\}\s*(?:,|$)/g)].map(x => x[1]).filter(b => /\.species/.test(b)).map(b => ({
    level: +/\.lvl = (\d+)/.exec(b)[1],
    species: /\.species = SPECIES_(\w+)/.exec(b)[1],
    moves: /\.moves = \{([^}]*)/.exec(b)?.[1].split(',').map(s => s.trim().replace(/^MOVE_/, '')).filter(s => s && s !== 'NONE') || null,
  }));
}

const q = (s) => `'${s}'`;
for (const [key, sym] of Object.entries(EMERALD_PARTY_OF)) {
  const p = parties[sym];
  if (!p) throw new Error(`no sParty_${sym}`);
  const mons = p.map(x => `L(${q(x.species)}, ${x.level}${x.moves ? `, [${x.moves.map(q).join(', ')}]` : ''})`);
  console.log(`  ${key}: [${mons.join(', ')}], // ${sym}`);
}
