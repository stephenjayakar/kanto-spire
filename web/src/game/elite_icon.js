// What the run map draws on an elite node: the trainer (or legendary) that node actually fights (v0.5.25).
// Run.eliteKeyAt picks the key the same way Run.eliteConfig does; this turns it into a sprite. Before, the icon was a
// decorative pick of four sprites by map position, one of them BLUE's, so an elite node could show the rival.
import { D } from './data.js';
import { LEGENDS } from './acts.js';

// FireRed overworld walkers (gfx/overworld/people/<name>.png, 16x32) by trainer pic; Emerald's (optional 'emerald'
// pack, gfx/overworld/people/emerald/) in EM_WALKER, used once loaded, else the FireRed stand-in.
const WALKER = {
  rocket_grunt_m: 'rocket_m', rocket_grunt_f: 'rocket_f', leader_giovanni: 'giovanni',
  super_nerd: 'scientist', pokemaniac: 'poke_maniac', black_belt: 'black_belt', bug_catcher: 'bug_catcher',
  cool_trainer_m: 'cooltrainer_m', cool_trainer_f: 'cooltrainer_f', rs_cool_trainer_m: 'cooltrainer_m',
  beauty: 'beauty', channeler: 'channeler', lady: 'beauty', expert_m: 'old_man_1', gentleman: 'gentleman',
  // HGSS Rocket executives have no walker here: FireRed's grunts stand in
  'hgss/proton': 'rocket_m', 'hgss/petrel': 'rocket_m', 'hgss/archer': 'rocket_m', 'hgss/ariana': 'rocket_f',
  'emerald/aqua_grunt_m': 'rocket_m', 'emerald/aqua_grunt_f': 'rocket_f', 'emerald/magma_grunt_m': 'rocket_m',
  'emerald/aqua_admin_m': 'rocket_m', 'emerald/aqua_admin_f': 'rocket_f', 'emerald/magma_admin': 'rocket_m',
  magma_admin_f: 'rocket_f', 'emerald/magma_leader_maxie': 'rocket_m', 'emerald/aqua_leader_archie': 'rocket_m',
  'emerald/steven': 'cooltrainer_m',
};
const EM_WALKER = {
  'emerald/aqua_grunt_m': 'aqua_member_m', 'emerald/aqua_grunt_f': 'aqua_member_f', 'emerald/magma_grunt_m': 'magma_member_m',
  'emerald/aqua_admin_m': 'aqua_member_m', 'emerald/aqua_admin_f': 'aqua_member_f', 'emerald/magma_admin': 'magma_member_m',
  magma_admin_f: 'magma_member_f', 'emerald/magma_leader_maxie': 'maxie', 'emerald/aqua_leader_archie': 'archie',
  'emerald/steven': 'steven',
};
// by trainer class, for pics not listed above
const CLASS_WALKER = {
  TEAM_ROCKET: 'rocket_m', BOSS: 'giovanni', COOLTRAINER: 'cooltrainer_m', RS_COOLTRAINER: 'cooltrainer_m',
  BLACK_BELT: 'black_belt', POKEMANIAC: 'poke_maniac', SUPER_NERD: 'scientist', BUG_CATCHER: 'bug_catcher',
  BEAUTY: 'beauty', CHANNELER: 'channeler', GENTLEMAN: 'gentleman', LADY: 'beauty',
  TEAM_AQUA: 'rocket_m', TEAM_MAGMA: 'rocket_m', AQUA_ADMIN: 'rocket_m', MAGMA_ADMIN: 'rocket_m',
  AQUA_LEADER: 'rocket_m', MAGMA_LEADER: 'rocket_m', RS_CHAMPION: 'cooltrainer_m',
};
const RIVAL = /^(RIVAL_|CHAMPION_FIRST)/;

// key: an act.elites / rareLegends key. -> { species } for a legendary, else { sprite, em?, pic, key }
// (sprite: a FireRed walker; em: Emerald's, preferred when its pack is loaded; pic: the battle pic)
export function eliteIcon(key) {
  if (!key) return { sprite: 'cooltrainer_m', key };
  if (LEGENDS[key]) return { species: LEGENDS[key].species, key };
  const t = D.trainers?.[key];
  if (RIVAL.test(key)) return { sprite: 'blue', pic: t?.pic, key }; // (only if an act ever lists the rival as an elite)
  if (!t) return { sprite: 'blue', key }; // (eliteConfig's fallback for a key with no trainer: BLUE's CERULEAN team)
  const pic = t.pic || '';
  const sprite = WALKER[pic] || CLASS_WALKER[t.class] || (t.female ? 'cooltrainer_f' : 'cooltrainer_m');
  return { sprite, ...(EM_WALKER[pic] ? { em: EM_WALKER[pic] } : {}), pic, key };
}
