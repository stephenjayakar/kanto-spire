// Slay-the-Spire style map: floors x columns, crossing-free paths, typed nodes.
import { MAP_NODE_WEIGHTS } from './acts.js';

const COLS = 7;

export function generateMap(rng, act, ascension = 0) {
  const F = act.floors;
  const nodes = new Map(); // key "f,c" -> node
  const edges = new Set(); // "f,c->f+1,c2"
  const key = (f, c) => `${f},${c}`;
  const get = (f, c) => {
    const k = key(f, c);
    if (!nodes.has(k)) nodes.set(k, { id: k, floor: f, col: c, type: null, next: [], prev: [] });
    return nodes.get(k);
  };
  const crosses = (f, c, c2) => {
    // An edge f,c -> f+1,c2 crosses an existing edge f,c+d -> f+1,c2-d (for diagonal moves)
    if (c2 === c) return false;
    const o = c2 > c ? 1 : -1;
    return edges.has(`${key(f, c + o)}->${key(f + 1, c)}`);
  };
  const PATHS = 6;
  const starts = [];
  for (let p = 0; p < PATHS; p++) {
    let c = rng.int(0, COLS - 1);
    if (p === 1) while (starts.includes(c) && starts.length < COLS) c = rng.int(0, COLS - 1);
    starts.push(c);
    get(0, c);
    for (let f = 0; f < F - 1; f++) {
      const opts = [c - 1, c, c + 1].filter(x => x >= 0 && x < COLS && !crosses(f, c, x));
      const c2 = opts.length ? rng.pick(opts) : c;
      const ek = `${key(f, c)}->${key(f + 1, c2)}`;
      if (!edges.has(ek)) {
        edges.add(ek);
        const a = get(f, c), b = get(f + 1, c2);
        a.next.push(b.id); b.prev.push(a.id);
      }
      c = c2;
    }
  }
  // Extra branches: give single-exit nodes a second route where it doesn't cross another path.
  for (const n of [...nodes.values()]) {
    if (n.floor >= F - 1 || n.next.length !== 1) continue;
    if (rng.next() > 0.6) continue;
    for (const d of rng.shuffle([-1, 1])) {
      const c2 = n.col + d;
      const target = nodes.get(key(n.floor + 1, c2));
      if (!target || n.next.includes(target.id) || crosses(n.floor, n.col, c2)) continue;
      edges.add(`${key(n.floor, n.col)}->${key(n.floor + 1, c2)}`);
      n.next.push(target.id); target.prev.push(n.id);
      break;
    }
  }
  // Node types
  const list = [...nodes.values()].sort((a, b) => a.floor - b.floor || a.col - b.col);
  const midFloor = Math.floor(F / 2);
  // The rival waits on a fixed floor that every path crosses (act.rival), four floors below the last one.
  const rivalFloor = act.rival ? rivalFloorOf(act) : -1;
  const w = { ...MAP_NODE_WEIGHTS };
  if (ascension >= 1) w.elite += 4;
  for (const n of list) {
    if (n.floor === 0) n.type = rng.chance(0.7) ? 'wild' : 'trainer';
    else if (n.floor === F - 1) n.type = 'center';
    else if (n.floor === midFloor && act.floors >= 10) n.type = 'treasure';
    else if (n.floor === rivalFloor) n.type = 'rival';
    else n.type = pickType(rng, n, nodes, w, F);
  }
  if (act.floors < 10) {
    // Short final act: guarantee a treasure and a mart somewhere in the middle.
    const mids = list.filter(n => n.floor === Math.floor(F / 2));
    if (mids.length) rng.pick(mids).type = 'treasure';
  }
  // Legendary bird (act.bird): one optional node off the main paths, on an empty column beside a path.
  if (act.bird) placeBird(rng, nodes, key, act, rivalFloor);
  // Boss node
  const bossId = 'boss';
  const boss = { id: bossId, floor: F, col: 3, type: 'boss', next: [], prev: [] };
  for (const n of list) if (n.floor === F - 1) { n.next.push(bossId); boss.prev.push(n.id); }
  nodes.set(bossId, boss);
  // Layout positions (with a bit of jitter) for drawing.
  for (const n of nodes.values()) {
    n.x = n.type === 'boss' ? 0.5 : (n.col + 0.5) / COLS + (rng.next() - 0.5) * 0.05;
    n.y = n.floor;
  }
  return { nodes: Object.fromEntries(nodes), floors: F, cols: COLS, start: list.filter(n => n.floor === 0).map(n => n.id) };
}

export function rivalFloorOf(act) { return act.floors - 5; }
export function birdFloors(act) {
  const F = act.floors;
  return F >= 10 ? [F - 7, F - 6, F - 4, F - 3] : [F - 3, F - 2];
}

// Adds the bird node L at floor f in an empty column c, linked from a node at f-1 and to a node at f+1
// (both at most one column away), without crossing any existing edge. Falls back to turning a node
// of that floor into the bird.
function placeBird(rng, nodes, key, act, rivalFloor) {
  const has = (f, c) => nodes.has(key(f, c));
  const edge = (a, b) => nodes.get(a)?.next.includes(b);
  // a diagonal a(f,c)->(f+1,c2) crosses an existing (f,c2)->(f+1,c)
  const crossing = (f, c, c2) => c !== c2 && edge(key(f, c2), key(f + 1, c));
  const floors = rng.shuffle(birdFloors(act).filter(f => f > 0 && f < act.floors - 1 && f !== rivalFloor));
  for (const f of floors) {
    const opts = [];
    for (let c = 0; c < COLS; c++) {
      if (has(f, c)) continue;
      const from = [c - 1, c, c + 1].filter(x => has(f - 1, x) && !crossing(f - 1, x, c));
      const to = [c - 1, c, c + 1].filter(x => has(f + 1, x) && !crossing(f, c, x));
      if (from.length && to.length) opts.push({ c, from, to });
    }
    if (!opts.length) continue;
    // prefer the outer columns (off the main paths)
    const o = rng.weighted(opts, x => 1 + Math.abs(x.c - (COLS - 1) / 2));
    const L = { id: key(f, o.c), floor: f, col: o.c, type: 'legend', next: [], prev: [], legend: act.bird };
    nodes.set(L.id, L);
    const a = nodes.get(key(f - 1, rng.pick(o.from))), b = nodes.get(key(f + 1, rng.pick(o.to)));
    a.next.push(L.id); L.prev.push(a.id);
    L.next.push(b.id); b.prev.push(L.id);
    return L;
  }
  const f = floors[0] ?? Math.max(1, act.floors - 3);
  const cands = [...nodes.values()].filter(n => n.floor === f && n.type !== 'rival');
  if (!cands.length) return null;
  const n = rng.pick(cands);
  n.type = 'legend'; n.legend = act.bird;
  return n;
}

function pickType(rng, n, nodes, w, F) {
  const parents = n.prev.map(id => nodes.get(id));
  const banned = new Set();
  if (n.floor < 4) banned.add('center');
  if (n.floor < 5) banned.add('elite');
  if (n.floor === F - 2) banned.add('center');
  for (const p of parents) if (['elite', 'center', 'mart'].includes(p.type)) banned.add(p.type);
  for (const p of parents) if (p.type === 'rival') banned.add('elite');
  for (const p of parents) for (const gid of p.prev) if (nodes.get(gid)?.type === 'mart') banned.add('mart');
  const types = Object.keys(w).filter(t => !banned.has(t));
  return rng.weighted(types, t => w[t]);
}

// Nodes the player may travel to next.
export function reachable(map, currentId) {
  if (!currentId) return map.start.slice();
  return map.nodes[currentId]?.next.slice() || [];
}

export const NODE_INFO = {
  wild: { name: 'TALL GRASS', desc: 'A wild POKéMON battle. Weaken it and throw a POKé BALL to catch it.' },
  trainer: { name: 'TRAINER', desc: 'A FireRed trainer with their own team. Rewards money and a new move.' },
  elite: { name: 'ELITE', desc: 'A dangerous opponent. Often rewards a held item.' },
  rival: { name: 'RIVAL', desc: 'Your rival blocks the way: every path crosses this floor. Their team counters your starter. Rewards between an elite and a GYM LEADER.' },
  legend: { name: 'LEGENDARY POKéMON', desc: 'Optional. A legendary POKéMON, much tougher than an elite. Beat it for its unique held item and a one-time chance to catch it.' },
  center: { name: 'POKéMON CENTER', desc: 'Rest and heal, or train a POKéMON.' },
  mart: { name: 'POKé MART', desc: 'Buy items, TMs and held items.' },
  event: { name: '???', desc: 'Something unusual is going on here...' },
  treasure: { name: 'ITEM BALL', desc: 'A free item!' },
  boss: { name: 'GYM LEADER', desc: 'The boss of this act.' },
};
