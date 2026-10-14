// Combo ("poker hand") detection over played move cards (DMG system: combos are damage bonuses).
// Every POKéMON has its own deck and only the lead's cards are in hand, so a card's TYPE is its rank
// (PAIR = 2 FIRE cards) and COVERAGE (4 different types) is the straight. Status moves are support
// cards: they always take effect but never form combos.

// DMG system: a combo is a damage bonus on the cards that score (kickers deal nothing). Vitamins raise it.
export const COMBOS = {
  SUPPORT:    { name: 'SUPPORT',     pct: 0,   dPct: 0,  rank: -1, desc: 'Only status moves: no damage, but their effects happen.' },
  SINGLE:     { name: 'SINGLE',      pct: 0,   dPct: 15, rank: 0, desc: 'Your strongest attack card hits.' },
  PAIR:       { name: 'PAIR',        pct: 25,  dPct: 15, rank: 1, desc: '2 attack cards of the same type.' },
  TWO_PAIR:   { name: 'TWO PAIR',    pct: 40,  dPct: 15, rank: 2, desc: '2 cards of one type and 2 of another.' },
  TRIPLE:     { name: 'TRIPLE',      pct: 60,  dPct: 20, rank: 3, desc: '3 attack cards of the same type.' },
  FULL_HOUSE: { name: 'FULL HOUSE',  pct: 80,  dPct: 20, rank: 4, desc: '3 cards of one type + 2 of another.' },
  // Hard to build (a POKéMON needs 4 attack types, which dilutes its other combos), so it pays almost like a QUAD.
  COVERAGE:   { name: 'COVERAGE',    pct: 125, dPct: 30, rank: 5, desc: '4 attack cards, 4 different types.' },
  QUAD:       { name: 'QUAD',        pct: 100, dPct: 25, rank: 6, desc: '4 attack cards of the same type.' },
  PENTA:      { name: 'PENTA',       pct: 150, dPct: 30, rank: 7, desc: '5 attack cards of the same type.' },
};
export const COMBO_ORDER = Object.keys(COMBOS).filter(k => k !== 'SUPPORT');

// Damage bonus (in %) of a combo at a level.
// Experiment knob (tests/balance.mjs --comboscale 1.5): scales every combo bonus.
export const COMBO_TUNING = { scale: 1 };
export function comboBonus(key, level = 1) {
  const c = COMBOS[key];
  return (c.pct + c.dPct * (level - 1)) * COMBO_TUNING.scale;
}

// cards: [{move, type, status, value}] -> {key, scoring: [indices]}   (value = expected damage of the card)
// Status cards are excluded from detection and scoring (they still trigger in the battle engine).
// Picks the highest-damage combo contained in the selection (a level-3 PAIR can beat a level-1 TWO PAIR).
export function detectCombo(cards, opts = {}) {
  const full = detectRaw(cards, opts);
  if (!full || !opts.levels || full.key === 'SUPPORT') return full;
  const value = (r) => r.scoring.reduce((a, i) => a + (cards[i].value || 0), 0) * (1 + comboBonus(r.key, opts.levels[r.key] || 1) / 100);
  let best = full, bv = value(full);
  const atkIdx = cards.map((c, i) => i).filter(i => !cards[i].status);
  if (atkIdx.length <= 1) return full;
  // try every sub-selection of attack cards (max 5 -> 31 subsets)
  for (let mask = 1; mask < (1 << atkIdx.length); mask++) {
    const keep = new Set(atkIdx.filter((_, j) => mask & (1 << j)));
    const sub = cards.map((c, i) => (keep.has(i) || c.status ? c : { ...c, status: true, ghost: true }));
    const r = detectRaw(sub, opts);
    if (!r || r.key === 'SUPPORT') continue;
    const v = value(r);
    if (v > bv + 0.001) { bv = v; best = r; }
  }
  return best;
}

function detectRaw(cards, opts = {}) {
  if (!cards.length) return null;
  const atk = cards.map((c, i) => ({ c, i })).filter(x => !x.c.status);
  if (!atk.length) return { key: 'SUPPORT', scoring: [] };
  const n = atk.length;
  const group = (keyFn) => {
    const m = new Map();
    for (const x of atk) { const k = keyFn(x.c); if (!m.has(k)) m.set(k, []); m.get(k).push(x.i); }
    return [...m.values()].sort((a, b) => b.length - a.length || bestValue(b) - bestValue(a));
  };
  const bestValue = (g) => Math.max(...g.map(i => cards[i].value || 0));
  const byType = group(c => c.type);
  const realTypes = new Set(atk.map(x => x.c.type));
  const tc = byType.map(g => g.length);
  const all = atk.map(x => x.i);
  const coverageN = opts.coverageN || 4;
  let res;
  if (tc[0] >= 5) res = { key: 'PENTA', scoring: byType[0].slice(0, 5) };
  else if (tc[0] === 3 && tc[1] === 2) res = { key: 'FULL_HOUSE', scoring: all };
  else if (tc[0] === 4) res = { key: 'QUAD', scoring: byType[0] };
  else if (realTypes.size >= coverageN && tc[0] <= 2) {
    // one card per type: the strongest of each
    const picks = byType.map(g => g.reduce((x, y) => ((cards[y].value || 0) > (cards[x].value || 0) ? y : x)));
    res = { key: 'COVERAGE', scoring: picks };
  }
  else if (tc[0] === 3) res = { key: 'TRIPLE', scoring: byType[0] };
  else if (tc[0] === 2 && tc[1] === 2) res = { key: 'TWO_PAIR', scoring: [...byType[0], ...byType[1]] };
  else if (tc[0] === 2) res = { key: 'PAIR', scoring: byType[0] };
  else {
    let best = atk[0];
    for (const x of atk) if ((x.c.value || 0) > (best.c.value || 0)) best = x;
    res = { key: 'SINGLE', scoring: [best.i] };
  }
  return res;
}
