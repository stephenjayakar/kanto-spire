// Pokémon instances owned by the player or used as enemies.
import { D, monStats, expForLevel } from './data.js';

let uidCounter = 1;
export function setUidCounter(n) { uidCounter = n; }
export function nextUid() { return uidCounter++; }

export function randomIVs(rng, min = 0) {
  const r = () => (rng ? rng.int(min, 31) : 15);
  return { hp: r(), atk: r(), def: r(), spa: r(), spd: r(), spe: r() };
}

// The last 4 distinct moves the species learns at or below `level` (what the games do for wild mons).
export function defaultMoves(speciesKey, level) {
  const ls = D.species[speciesKey]?.learnset || [];
  const known = [];
  for (const [lvl, mv] of ls) {
    if (lvl > level) break;
    if (!D.moves[mv]) continue;
    const i = known.indexOf(mv);
    if (i >= 0) known.splice(i, 1);
    known.push(mv);
  }
  const res = known.slice(-4);
  if (!res.length) res.push('TACKLE');
  return res;
}

// Moves a player's POKéMON never gets (v0.3.11): they do nothing when the player uses them (TORMENT has no effect here;
// MEAN LOOK / SPIDER WEB / BLOCK only trap the player). Foes keep them. Every way a player's POKéMON gets a move
// checks this: makeMon (starters, gifts, eggs, catches), level-ups and evolutions (movesLearnedAt), canLearn (TMs,
// tutors), move rewards (run.js movePool), the relearner (run.js relearnable) and card transforms (events.js).
export const NO_PLAYER_MOVES = new Set(['TORMENT', 'MEAN_LOOK', 'SPIDER_WEB', 'BLOCK']);
// `moves` without the ones `bad` rejects; the species' next most recent level-up moves (up to `level`) take their
// places, so the set keeps its size where the learnset allows.
export function replaceMoves(speciesKey, level, moves, bad) {
  if (!moves.some(bad)) return moves;
  const keep = moves.filter(m => !bad(m));
  const learned = (D.species[speciesKey]?.learnset || []).filter(([lvl, mv]) => lvl <= level && D.moves[mv] && !bad(mv)).map(([, mv]) => mv);
  for (let i = learned.length - 1; i >= 0 && keep.length < moves.length; i--) if (!keep.includes(learned[i])) keep.unshift(learned[i]);
  return keep.length ? keep : ['TACKLE'];
}
const noPlayerMove = (m) => NO_PLAYER_MOVES.has(m);

export function makeMon(speciesKey, level, opts = {}) {
  const rng = opts.rng;
  const ivs = opts.ivs || randomIVs(rng, opts.minIV || 0);
  const moves = replaceMoves(speciesKey, level, (opts.moves || defaultMoves(speciesKey, level)).filter(m => m && m !== 'NONE' && D.moves[m]), noPlayerMove);
  const mon = {
    uid: nextUid(),
    species: speciesKey,
    level,
    exp: expForLevel(D.species[speciesKey]?.growthRate, level),
    ivs,
    moves: moves.map(m => ({ move: m, copies: opts.copies ?? defaultCopies(m) })),
    hp: 0,
    status: null, // 'PSN' | 'TOX' | 'BRN' | 'PAR' | 'SLP' | 'FRZ'
    shiny: opts.shiny ?? (rng ? rng.chance(1 / 128) : false),
    caughtAct: opts.caughtAct ?? 0,
    item: opts.item || null,
  };
  mon.hp = maxHp(mon);
  return mon;
}

export function stats(mon) { return monStats(mon.species, mon.level, mon.ivs); }
export function maxHp(mon) { return stats(mon).hp; }
export function speciesOf(mon) { return D.species[mon.species]; }
export function typesOf(mon) { return speciesOf(mon)?.types || ['NORMAL']; }
export function isFainted(mon) { return mon.hp <= 0; }

export function healFull(mon) { mon.hp = maxHp(mon); mon.status = null; }
export function healFrac(mon, frac) {
  const m = maxHp(mon);
  mon.hp = Math.min(m, mon.hp + Math.max(1, Math.floor(m * frac)));
}

// Level up keeps the HP *damage* constant like the games.
function setLevel(mon, level) {
  const before = maxHp(mon);
  mon.level = level;
  const after = maxHp(mon);
  if (mon.hp > 0) mon.hp = Math.min(after, mon.hp + (after - before));
}

// Adds EXP and returns a list of events: {type:'level', level}, {type:'learn', move}, {type:'evolve', into}
export function gainExp(mon, amount) {
  const events = [];
  if (mon.level >= 100) return events;
  const rate = speciesOf(mon).growthRate;
  mon.exp += amount;
  while (mon.level < 100 && mon.exp >= expForLevel(rate, mon.level + 1)) {
    setLevel(mon, mon.level + 1);
    events.push({ type: 'level', level: mon.level });
    for (const mv of movesLearnedAt(mon.species, mon.level)) events.push({ type: 'learn', move: mv });
    const evo = levelEvolution(mon);
    if (evo) events.push({ type: 'evolve', into: evo });
  }
  return events;
}

export function addLevels(mon, n) {
  const rate = speciesOf(mon).growthRate;
  const target = Math.min(100, mon.level + n);
  const need = expForLevel(rate, target) - mon.exp;
  return gainExp(mon, Math.max(0, need));
}

export function expProgress(mon) {
  const rate = speciesOf(mon).growthRate;
  const lo = expForLevel(rate, mon.level), hi = expForLevel(rate, mon.level + 1);
  return mon.level >= 100 ? 1 : Math.max(0, Math.min(1, (mon.exp - lo) / (hi - lo)));
}

export function movesLearnedAt(speciesKey, level) {
  return (D.species[speciesKey]?.learnset || []).filter(([l, m]) => l === level && D.moves[m] && !NO_PLAYER_MOVES.has(m)).map(([, m]) => m);
}

// Level-based evolution. Friendship evolutions happen at level 22, and trade evolutions (no trading in a
// roguelike) at 37, or 40 for the ones that needed a held item.
export function levelEvolution(mon) {
  for (const e of speciesOf(mon).evolutions || []) {
    if (!D.species[e.into]) continue;
    // capped at 48 so late evolvers (DRAGONITE, TYRANITAR at 55) are reachable in a run
    if (e.method === 'LEVEL' && mon.level >= Math.min(e.param, 48)) return e.into;
    if (e.method === 'FRIENDSHIP' && mon.level >= 22) return e.into;
    if ((e.method === 'LEVEL_ATK_GT_DEF' || e.method === 'LEVEL_ATK_EQ_DEF' || e.method === 'LEVEL_ATK_LT_DEF' ||
         e.method === 'LEVEL_SILCOON' || e.method === 'LEVEL_CASCOON' || e.method === 'LEVEL_NINJASK') && mon.level >= e.param) {
      return pickBranchEvo(mon, e);
    }
    if (e.method === 'BEAUTY' && mon.level >= 30) return e.into;
    if (e.method === 'TRADE' && mon.level >= 37) return e.into;
    if (e.method === 'TRADE_ITEM' && mon.level >= 40) return e.into;
  }
  return null;
}

function pickBranchEvo(mon, e) {
  const s = stats(mon);
  const evos = speciesOf(mon).evolutions;
  if (e.method.startsWith('LEVEL_ATK')) {
    const want = s.atk > s.def ? 'LEVEL_ATK_GT_DEF' : s.atk < s.def ? 'LEVEL_ATK_LT_DEF' : 'LEVEL_ATK_EQ_DEF';
    return (evos.find(x => x.method === want) || e).into;
  }
  if (e.method === 'LEVEL_SILCOON' || e.method === 'LEVEL_CASCOON') {
    const want = (mon.ivs.hp + mon.uid) % 2 ? 'LEVEL_SILCOON' : 'LEVEL_CASCOON';
    return (evos.find(x => x.method === want) || e).into;
  }
  return e.into;
}

// Item evolution (stones) and trade evolutions (we treat a "Link Cable" item as the trade).
// The stone that evolves a species along evolution e (EEVEE's day/night friendship forms use SUN/MOON STONE).
export function evoStone(e) {
  if (e.method === 'ITEM') return e.param;
  if (e.method === 'FRIENDSHIP_DAY') return 'SUN_STONE';
  if (e.method === 'FRIENDSHIP_NIGHT') return 'MOON_STONE';
  return null;
}
export function canUseStone(species, stone) { return (D.species[species]?.evolutions || []).some(e => evoStone(e) === stone && D.species[e.into]); }

export function itemEvolution(mon, itemKey) {
  for (const e of speciesOf(mon).evolutions || []) {
    if (evoStone(e) === itemKey && D.species[e.into]) return e.into;
    if (itemKey === 'LINK_CABLE' && (e.method === 'TRADE' || e.method === 'TRADE_ITEM') && D.species[e.into]) return e.into;
  }
  return null;
}

export function evolve(mon, into) {
  const before = maxHp(mon);
  mon.species = into;
  const after = maxHp(mon);
  if (mon.hp > 0) mon.hp = Math.min(after, mon.hp + (after - before));
  // Learn moves the new form gets "on evolution" (level-1 entries not already known) — none in Gen 3,
  // but some evolved forms learn at the current level.
  return movesLearnedAt(into, mon.level);
}

export function knowsMove(mon, move) { return mon.moves.some(m => m.move === move); }

// Deck rules (v0.0.4 discard update). A move's copies follow its real PP, so decks are bigger than a hand
// and you dig for combos; once per turn you may discard up to 2 cards for free, plus 2 discards per battle.
// Experiment knobs for tests/balance.mjs --rules key=value,...:
//   copies: 'pp' (ppCopies) | 'flat' (old rule: attacks 2, status 1); starterBonus: extra copies of the starter's attacks;
//   hand / play / discards: hand size, max cards per hand, paid discards per battle; freeDiscard: once per turn,
//   discard up to N cards for free (0 = off); kickersStay: attack cards that don't score go back to your hand;
//   refill: cards drawn per turn after the first (0 = back up to the hand size); discardDraw: a discard draws N extra.
export const DECK_RULES = { copies: 'pp', ppDiv: 10, ppBase: 1, ppMin: 2, ppMax: 5, stDiv: 20, stMax: 2, starterBonus: 1, hand: 5, play: 5, discards: 2, freeDiscard: 2, kickersStay: false, refill: 0, discardDraw: 0 };

// Copies of a move from its PP: attacks PP/10 rounded up + 1, from 2 to 5 (TACKLE 35 PP: 5, EMBER 25: 4,
// FLAMETHROWER 15: 3, EARTHQUAKE 10 / HYDRO PUMP 5: 2); status moves PP/20 rounded up, 1 or 2 (GROWL 40 PP: 2).
export function ppCopies(move) {
  const m = D.moves[move];
  if (!m) return 1;
  const pp = m.pp || 10, R = DECK_RULES;
  if (m.power === 0) return Math.max(1, Math.min(R.stMax, Math.ceil(pp / R.stDiv)));
  return Math.max(R.ppMin, Math.min(R.ppMax, Math.ceil(pp / R.ppDiv) + R.ppBase));
}

export function defaultCopies(move) {
  if (DECK_RULES.copies === 'pp') return ppCopies(move);
  return D.moves[move]?.power === 0 ? 1 : 2;
}

// Copies a move gets when it replaces an old one: its own default, plus any extra copies the old move had
// (PP UP), so the investment carries over.
export function replacedCopies(oldSlot, move) {
  const extra = Math.max(0, (oldSlot?.copies || 0) - defaultCopies(oldSlot?.move));
  return defaultCopies(move) + extra;
}

export function teachMove(mon, move, replaceIndex = -1, copies = defaultCopies(move)) {
  if (knowsMove(mon, move)) return false;
  if (mon.moves.length < 4) mon.moves.push({ move, copies });
  else if (replaceIndex >= 0) mon.moves[replaceIndex] = { move, copies };
  else return false;
  return true;
}

// Can this mon learn `move` via TM/HM, tutor, egg or level-up list (any level)?
export function canLearn(speciesKey, move) {
  const s = D.species[speciesKey];
  if (!s || NO_PLAYER_MOVES.has(move)) return false;
  const tm = (s.tmhm || []).some(x => x === move || x.endsWith('_' + move));
  return tm || (s.tutor || []).includes(move) || (s.learnset || []).some(([, m]) => m === move);
}

export function monName(mon) { return mon.nickname || speciesOf(mon)?.name || mon.species; }
