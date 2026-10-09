// CoopGame: the deterministic reducer over the co-op action log (see tests/out/COOP_CONTRACT.txt).
// Every client applies the same ordered actions and must end in the same state (checksum()).
import { D } from '../data.js';
import { RNG } from '../rng.js';
import { Run } from '../run.js';
import { setUidCounter, isFainted, maxHp } from '../pokemon.js';
import { reachable } from '../map.js';
import { BADGES, CONSUMABLES } from '../items.js';
import { pickEvent, coopProbe } from '../events.js';
import { STARTERS } from '../acts.js';
import { REGIONS, SPIRE, COOP_POOLS } from '../regions.js';
import { DuoBattle, padEnemies } from './duo.js';
import { COOP_TUNING } from './tuning.js';

// v0.0.7: events are no longer excluded from co-op as a whole: each choice that starts a battle is marked solo
// and hidden in co-op (events.js eventChoices; all co-op battles are duo battles).
export function pickCoopEvent(run, rng) { run.coop = true; return pickEvent(run, rng); }
// Both players get the SAME event at a "?" node: picked from shared inputs only (the room seed, the act and node,
// the events either player has seen, the smaller party / held-item count, both players' story flags), so every
// client computes the same.
export function sharedEventId(world, runs, seed) {
  return pickEvent(coopProbe(world, runs), new RNG(`${seed}:event:${world.actIndex}:${world.nodeId}`)).id;
}

const BATTLE_NODES = new Set(['wild', 'trainer', 'elite', 'boss', 'rival', 'legend']);
// Bag items usable on the co-op map (action mapItem): healing / reviving / curing only.
export const MAP_ITEM_OK = (def) => def && (def.heal || def.healFrac || def.cure || def.revive || def.reviveAll) && !def.stage && !def.flee && !def.levels && !def.evo && !def.combo;

export function badgeForBoss(bossKey) {
  const leader = bossKey?.replace('LEADER_', '');
  return Object.values(BADGES).find(b => b.leader === leader)?.key || null;
}

export const MIN_PLAYERS = 2, MAX_PLAYERS = 4;

// ---------------------------------------------------------------------------------------------------
// Duo encounters, built from the shared "world" Run (n = players in the battle, 2-4).
// With 3-4 players the field still holds two foes (each acting n/2 times per turn, see duo.js):
//   wild     n wild POKéMON, two on the field at a time (slot 0 gets #0, #2; slot 1 gets #1, #3)
//   others   the same parties with foe HP x n/2 (x COOP_TUNING.players[n] for balance)
//   wild     two wild POKéMON at once (two wildConfig rolls with forked RNGs), one per slot, no refill
//   trainer  a tag battle: two trainers, each slot is fed by its own trainer's party
//   elite    one elite trainer sends its party two at a time (padded to >= 2); a legendary elite is a
//            single legendary on one slot with extra HP
//   boss     the leader sends its party two at a time from one queue (boss rule kept); a legendary boss
//            is single; the Elite Four / Champion gauntlet works like a boss
function scaleEnemies(cfg, coopKind, world, n = 2) {
  const act = world.actIndex || 0;
  const at = (a) => (Array.isArray(a) ? a[Math.min(act, a.length - 1)] : 1);
  let hp = (COOP_TUNING.worldHp?.[world.region]?.[coopKind] ?? COOP_TUNING.hp[coopKind] ?? 1) * at(COOP_TUNING.actHp) * (COOP_TUNING.hpComp ?? 1);
  let dmg = (COOP_TUNING.dmg[coopKind] ?? 1) * at(COOP_TUNING.actDmg);
  if (n !== 2) {
    // 3-4 players: each extra pair of hands needs proportionally more HP to chew through (wild battles field
    // more POKéMON instead), plus a per-size balance factor.
    const P = COOP_TUNING.players?.[n] || {};
    hp *= (coopKind === 'wild' ? 1 : n / 2) * (P.hp?.[coopKind] ?? P.hpAll ?? 1);
    dmg *= P.dmg?.[coopKind] ?? P.dmgAll ?? 1;
    cfg.expScale = coopKind === 'wild' ? 2 / n : 1; // (n wild foes beaten instead of 2)
  }
  // (coopHp: shown in the foe's tooltip so the bigger HP bars aren't read as weaker hands; display only)
  for (const e of cfg.enemies) { e.maxHp = Math.max(10, Math.round(e.maxHp * hp)); e.hp = e.maxHp; e.coopHp = Math.round(hp * 100) / 100; }
  cfg.dmgScale = (cfg.dmgScale ?? 1) * dmg;
  cfg.coopKind = coopKind;
  return cfg;
}

const shared = (cfg, rng, world, coopKind, n = 2) => {
  const enemies = padEnemies(world, rng.fork('pad'), cfg.enemies, 2);
  return scaleEnemies({ ...cfg, enemies, queues: [enemies.map((e, i) => i)], slotQueue: [0, 0], slots: 2 }, coopKind, world, n);
};
const single = (cfg, coopKind, world, n = 2) => scaleEnemies({ ...cfg, queues: [[0]], slotQueue: [0, 0], slots: 1 }, coopKind, world, n);

export function duoConfig(world, node, n = 2) {
  const kind = node.type;
  const rng = world.rng.fork('duo' + node.id + ':' + world.actIndex);
  const floor = node.floor;
  if (kind === 'wild') {
    // Wild no-repeat (as in solo): the shared world remembers every wild POKéMON met, and the two foes of
    // one duo battle are different POKéMON (the second roll already counts the first).
    world.wildSeen ||= [];
    const a = world.wildConfig(rng.fork('w0'), floor);
    if (!world.wildSeen.includes(a.enemies[0].species)) world.wildSeen.push(a.enemies[0].species);
    let b = world.wildConfig(rng.fork('w1'), floor);
    // (once the act's pool is used up, picks may repeat: still avoid a pair of the same POKéMON)
    if (b.enemies[0].species === a.enemies[0].species) {
      const seen = world.wildSeen;
      world.wildSeen = [a.enemies[0].species];
      try { b = world.wildConfig(rng.fork('w2'), floor); } finally { world.wildSeen = seen; }
    }
    if (!world.wildSeen.includes(b.enemies[0].species)) world.wildSeen.push(b.enemies[0].species);
    const enemies = [a.enemies[0], b.enemies[0]];
    // 3-4 players: one more wild POKéMON per extra player, sent in as the first two leave (no repeats)
    for (let k = 2; k < n; k++) {
      const seen = world.wildSeen;
      let c = world.wildConfig(rng.fork('w' + (k + 1)), floor);
      if (enemies.some(e => e.species === c.enemies[0].species)) {
        world.wildSeen = enemies.map(e => e.species);
        try { c = world.wildConfig(rng.fork('w' + (k + 1) + 'b'), floor); } finally { world.wildSeen = seen; }
      }
      if (!world.wildSeen.includes(c.enemies[0].species)) world.wildSeen.push(c.enemies[0].species);
      enemies.push(c.enemies[0]);
    }
    const queues = [enemies.map((e, i) => i).filter(i => i % 2 === 0), enemies.map((e, i) => i).filter(i => i % 2 === 1)];
    return scaleEnemies({ ...a, enemies, queues, slotQueue: [0, 1], slots: 2, rng }, 'wild', world, n);
  }
  if (kind === 'trainer') {
    const a = world.trainerConfig(rng.fork('t0'), floor), b = world.trainerConfig(rng.fork('t1'), floor);
    const enemies = [...a.enemies, ...b.enemies];
    const qa = a.enemies.map((e, i) => i), qb = b.enemies.map((e, i) => a.enemies.length + i);
    const trainer = { ...a.trainer, name: `${a.trainer.name} & ${b.trainer.name}`, title: `${a.trainer.title} & ${b.trainer.title}`, money: Math.round((a.trainer.money + b.trainer.money) / 2) };
    return scaleEnemies({ ...a, trainer, trainers: [a.trainer, b.trainer], enemies, queues: [qa, qb], slotQueue: [0, 1], slots: 2, rng, tag: true }, 'trainer', world, n);
  }
  if (kind === 'elite') {
    const c = world.eliteConfig(rng, floor);
    if (c.legend) return single({ ...c, rng }, 'legend', world, n);
    return shared({ ...c, rng }, rng, world, 'elite', n);
  }
  // The rival (the shared world's starter, i.e. P1's, picks the counter) sends its team two at a time like
  // an elite; a legendary bird node is a single legendary. Rewards (its held item, the one-time catch) are
  // handed out in each player's own reward screen, so each player may catch it once in their own run.
  if (kind === 'rival') return shared({ ...world.rivalConfig(rng, floor), rng }, rng, world, 'rival', n);
  if (kind === 'legend') return single({ ...world.legendConfig(rng, floor, node.legend || world.act.bird), rng }, 'bird', world, n);
  if (kind === 'boss') {
    if (world.act.gauntlet) return gauntletDuoConfig(world, 0, n);
    const c = world.bossConfig(rng);
    if (c.legendBoss) return single({ ...c, rng }, 'legend', world, n);
    return shared({ ...c, rng }, rng, world, 'boss', n);
  }
  return null;
}

export function gauntletDuoConfig(world, i, n = 2) {
  world.gauntletIndex = i;
  const rng = world.rng.fork('g' + i);
  const c = world.gauntletConfig(rng, i);
  return shared({ ...c, rng }, rng, world, 'gauntlet', n);
}

// ---------------------------------------------------------------------------------------------------
function fnv(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

function runDigest(r) {
  const o = r.toJSON();
  delete o.map;
  o.stats = { ...o.stats };
  delete o.stats.startTime;
  return o;
}

export class CoopGame {
  constructor() {
    this.seq = 0;
    this.phase = 'init';
    this.runs = [null, null];
    this.world = null;
    this.votes = [null, null];
    this.lastVote = null;
    this.battle = null;
    this.battleCfg = null;
    this.battleSubs = null;
    this.private = null;
    this.result = null;
    this.down = [false, false];
    this.events = [];
    this.lastEvents = [];
    this.names = ['P1', 'P2'];
    this.away = [false, false];  // players who left (sat out by the others): skipped by votes, battles, private phases
  }

  get n() { return this.runs.length; }
  inGame(p) { return Number.isInteger(p) && p >= 0 && p < this.n; }
  activeCount() { return this.away.filter(a => !a).length || 1; }

  static fromInit(initAction) { const g = new CoopGame(); g.apply({ seq: 1, ...initAction }); return g; }

  // Applies one action of the log. Returns true if it changed the state. Illegal or stale actions are
  // ignored (false). Every action with a new seq advances game.seq, legal or not.
  apply(a) {
    if (!a || typeof a !== 'object' || typeof a.type !== 'string') return false;
    const seq = Number.isInteger(a.seq) ? a.seq : this.seq + 1;
    if (seq <= this.seq) return false;
    this.seq = seq;
    this.lastEvents = [];
    setUidCounter(1e9 + seq * 1000);
    let ok = false;
    try { ok = !!this.reduce(a, seq); } catch (err) { this.lastError = String(err && err.stack || err); ok = false; }
    return ok;
  }

  reduce(a, seq) {
    const p = a.p;
    if (a.type === 'init') return this.init(a);
    if (this.phase === 'init' || this.phase === 'over' || this.phase === 'victory') return false;
    if (!this.inGame(p)) return false;
    // anything a sat-out player does brings them back in
    if (this.away[p] && a.type !== 'away') this.setAway(p, false);
    switch (a.type) {
      case 'away': return this.setAway(a.target, !!a.away, p);
      case 'vote': return this.vote(p, a.node, seq);
      case 'setLead': return this.setLead(p, a.uid);
      case 'mapItem': return this.mapItem(p, a.key, a.uid);
      case 'discard': return this.battleAct(p, d => d.discard(p, a.ids));
      case 'switch': return this.battleAct(p, d => d.switchLead(p, a.uid));
      case 'item': return this.battleAct(p, d => d.useItem(p, a.key, a.uid ?? null, a.toP));
      case 'lock': return this.battleAct(p, d => d.lock(p, a.pass ? { pass: true } : a.ball ? { ball: a.ball, target: a.target } : { ids: a.ids, target: a.target }));
      case 'unlock': return this.battleAct(p, d => d.unlock(p, a.turn));
      case 'privateDone': return this.privateDone(p, a.run, seq);
      default: return false; // chat & unknown types
    }
  }

  // ---- init -------------------------------------------------------------------------------------
  init(a) {
    if (this.phase !== 'init') return false;
    const ok = s => STARTERS.some(x => x.species === s) && D.species[s];
    const n = Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, (a.starters || []).length));
    const starters = (a.starters || []).slice(0, n).map(s => (ok(s) ? s : 'CHARMANDER'));
    while (starters.length < n) starters.push('CHARMANDER');
    this.seed = String(a.seed ?? 'COOP');
    this.ascension = Math.max(0, Math.min(10, a.ascension | 0));
    // One Spire rooms: 'spire' draws from KANTO + HOENN, 'spire_johto' (v0.1.1: a host with JOHTO) from all three,
    // 'spire_kanto' (a host without HOENN yet) from KANTO only. Legacy rooms ('kanto' / 'hoenn', started before
    // v0.1.0) keep their fixed world.
    const spire = !!COOP_POOLS[a.world];
    this.worldName = spire ? SPIRE : REGIONS[a.world] ? a.world : 'kanto';
    const pool = COOP_POOLS[a.world] || ['kanto'];
    this.names = starters.map((_, p) => String(a.names?.[p] ?? `P${p + 1}`));
    this.starters = starters;
    this.rng = new RNG(this.seed + ':coop');
    // (coop: true turns off the Nuzlocke ascension rules, see Run.nuzlocke)
    // (the region draw comes from the shared seed; both players' runs copy it, and the rival follows P1's starter)
    this.world = Run.create({ starter: starters[0], ascension: this.ascension, seed: this.seed, world: this.worldName, coop: true, pool });
    this.runs = starters.map((st, p) => {
      const r = Run.create({ starter: st, ascension: this.ascension, seed: `${this.seed}:p${p}`, world: this.worldName, coop: true, regions: this.world.regions, rival: this.world.rival });
      r.playerName = this.names[p];
      return r;
    });
    this.votes = starters.map(() => null);
    this.down = starters.map(() => false);
    this.away = starters.map(() => false);
    setUidCounter(1e9 + this.seq * 1000 + 500);
    this.mirror();
    this.phase = 'map';
    return true;
  }

  // Copy the shared map position into both runs (private scenes read run.actIndex/floor/nodeId/boss).
  mirror() {
    const w = this.world;
    for (const r of this.runs) {
      r.map = w.map; r.actIndex = w.actIndex; r.nodeId = w.nodeId; r.floor = w.floor; r.boss = w.boss; r.gauntletIndex = w.gauntletIndex;
      r.ascension = this.ascension; r.world = this.worldName;
      if (w.regions) { r.regions = w.regions; r.rival = w.rival; }
    }
  }

  // ---- map --------------------------------------------------------------------------------------
  reachable() { return this.world ? reachable(this.world.map, this.world.nodeId) : []; }

  // Map votes (2-4 players): the node with the most votes wins once everyone still in the game has voted,
  // or as soon as one node has a strict majority. A tie is broken by the shared RNG (a coin with 2 nodes).
  vote(p, node, seq) {
    if (this.phase !== 'map' || !this.reachable().includes(node)) return false;
    this.votes[p] = node;
    this.resolveVotes(seq);
    return true;
  }

  resolveVotes(seq) {
    const active = this.votes.map((v, q) => q).filter(q => !this.away[q]);
    const cast = active.map(q => this.votes[q]).filter(v => v !== null);
    if (!cast.length) return false;
    const count = new Map();
    for (const v of cast) count.set(v, (count.get(v) || 0) + 1);
    const top = Math.max(...count.values());
    const all = cast.length === active.length;
    if (!all && top * 2 <= active.length) return false;
    const tied = [...count.keys()].filter(v => count.get(v) === top);
    const tie = tied.length > 1;
    const picked = !tie ? tied[0] : tied.length === 2 ? (this.rng.chance(0.5) ? tied[0] : tied[1]) : this.rng.pick(tied);
    const votes = this.votes.slice();
    this.lastVote = { picked, tie, votes };
    if (tie) this.events.push({ seq, t: 'tie', picked, votes });
    this.votes = this.votes.map(() => null);
    this.enterNode(picked, seq);
    return true;
  }

  // A player left: the others carry on without them (they come back with their next action).
  setAway(q, away, by = q) {
    if (!this.inGame(q) || this.away[q] === away) return false;
    if (away && by === q) return false; // (you can't sit yourself out: just stop playing)
    if (away && this.away.filter(x => !x).length <= 2) return false; // at least two keep playing (co-op stays co-op)
    this.away[q] = away;
    this.events.push({ seq: this.seq, t: away ? 'away' : 'back', p: q });
    if (away) {
      this.votes[q] = null;
      if (this.phase === 'map') this.resolveVotes(this.seq);
      else if (this.phase === 'private' && this.private && !this.private.done[q]) {
        this.private.done[q] = true;
        if (this.private.done.every(Boolean)) this.advance();
      } else if (this.phase === 'battle' && this.battle && !this.battle.result) {
        this.battle.setAway(q, true);
        this.lastEvents = this.battle.takeEvents();
        if (this.battle.result) this.afterBattle();
      }
    } else if (this.phase === 'battle' && this.battle && !this.battle.result) {
      this.battle.setAway(q, false);
      this.battle.takeEvents();
    }
    return true;
  }

  setLead(p, uid) {
    if (this.phase !== 'map') return false;
    const r = this.runs[p], i = r.party.findIndex(m => m.uid === uid);
    if (i <= 0) return false;
    const [m] = r.party.splice(i, 1);
    r.party.unshift(m);
    return true;
  }

  mapItem(p, key, uid) {
    if (this.phase !== 'map') return false;
    const r = this.runs[p], def = CONSUMABLES[key];
    if (!MAP_ITEM_OK(def) || !r.hasConsumable(key)) return false;
    const mon = r.party.find(m => m.uid === uid) || null;
    if (!mon && !def.reviveAll) return false;
    if (!r.applyConsumableToMon(key, mon)) return false;
    r.useConsumable(key);
    return true;
  }

  enterNode(id, seq) {
    const node = this.world.enterNode(id);
    for (const r of this.runs) r.stats.floors++;
    this.mirror();
    this.node = node;
    this.battle = null;
    this.battleSubs = null;
    if (BATTLE_NODES.has(node.type)) this.startBattle(duoConfig(this.world, node, this.activeCount()));
    else this.startPrivate(node.type, { node: id });
  }

  startPrivate(kind, extra = {}) {
    this.phase = 'private';
    this.private = { kind, node: this.world.nodeId, done: this.runs.map((r, q) => !!this.away[q]), ...extra };
    // The shared event is fixed when the phase opens (a partner who finishes first changes their run's
    // seenEvents). It's derived state, kept out of digest() so clients on the old rule don't desync; a reload
    // replays the log and gets the same pick.
    if (kind === 'event') this.sharedEvent = { act: this.world.actIndex, node: this.world.nodeId, id: sharedEventId(this.world, this.runs, this.seed) };
  }

  // ---- battle -----------------------------------------------------------------------------------
  startBattle(cfg) {
    this.mirror();
    this.battleCfg = cfg;
    this.battle = new DuoBattle(this.runs, cfg);
    if (this.away.some(Boolean)) this.battle.away = this.away.slice();
    this.down = this.runs.map(() => false);
    this.result = null;
    this.phase = 'battle';
    this.private = null;
    this.lastEvents = this.battle.start();
    if (this.battle.result) this.afterBattle();
  }

  battleAct(p, fn) {
    if (this.phase !== 'battle' || !this.battle || this.battle.result) return false;
    const ev = fn(this.battle);
    this.lastEvents = ev || [];
    const ok = this.battle.lastOk;
    if (this.battle.result) this.afterBattle();
    return ok;
  }

  afterBattle() {
    const d = this.battle, cfg = this.battleCfg;
    this.battleSubs = d.subs;
    this.down = d.down.slice();
    for (let p = 0; p < this.n; p++) if (d.down[p] && d.result.outcome === 'win') this.events.push({ seq: this.seq, t: 'revive', p });
    if (d.result.outcome === 'lose') { this.phase = 'over'; this.result = 'lose'; this.events.push({ seq: this.seq, t: 'over' }); return; }
    const final = (cfg.gauntlet !== undefined && cfg.gauntlet === this.world.act.gauntlet.length - 1) || (cfg.legendBoss && this.world.act.postgame);
    if (final) { this.victory(); return; }
    if (d.subs.every(s => s.result?.outcome === 'fled')) { this.toMap(); return; }
    this.startPrivate('reward', { node: this.world.nodeId });
  }

  victory() {
    this.phase = 'victory';
    this.result = 'win';
    for (const r of this.runs) r.victory = true;
    this.events.push({ seq: this.seq, t: 'victory' });
  }

  toMap() {
    this.phase = 'map';
    this.private = null;
    this.battle = null;
    this.votes = this.runs.map(() => null);
    this.mirror();
  }

  // ---- private phases ---------------------------------------------------------------------------
  privateDone(p, snap, seq) {
    if (this.phase !== 'private' || !this.private || this.private.done[p]) return false;
    if (!snap || typeof snap !== 'object' || !Array.isArray(snap.party) || !snap.party.length || typeof snap.rngState !== 'number') return false;
    if (!snap.party.every(m => m && D.species[m.species] && Array.isArray(m.moves) && Number.isFinite(m.hp) && Number.isFinite(m.uid))) return false;
    const r = Run.fromJSON(JSON.parse(JSON.stringify(snap)));
    setUidCounter(1e9 + seq * 1000 + 500);
    r.playerName = this.names[p];
    this.runs[p] = r;
    this.mirror();
    this.private.done[p] = true;
    if (this.private.done.every(Boolean)) this.advance();
    return true;
  }

  advance() {
    const k = this.private.kind, cfg = this.battleCfg;
    this.private = null;
    if (k === 'reward' && cfg?.kind === 'boss') {
      if (cfg.gauntlet !== undefined) return this.gauntletBreak(cfg.gauntlet + 1);
      return this.actClear();
    }
    if (k === 'plateau') return this.startBattle(gauntletDuoConfig(this.world, this.world.gauntletIndex, this.activeCount()));
    this.toMap();
  }

  // Between Elite Four rooms: partial heal, then a private Plateau Mart, then the next room.
  gauntletBreak(next) {
    this.world.gauntletIndex = next;
    for (const r of this.runs) {
      for (const m of r.party) if (!isFainted(m)) m.hp = Math.min(maxHp(m), m.hp + Math.floor(maxHp(m) * 0.5));
    }
    this.mirror();
    this.battle = null;
    this.startPrivate('plateau', { key: 'plateau' + next, next });
  }

  actClear() {
    const badge = badgeForBoss(this.world.boss);
    for (const r of this.runs) if (badge && !r.badges.includes(badge)) r.badges.push(badge); // the reward screen grants it too
    for (const r of this.runs) r.nextActHeal();
    const next = this.world.actIndex + 1;
    if (next >= this.world.acts.length) { this.victory(); return; }
    this.world.startAct(next);
    for (const r of this.runs) r.startAct(next);
    this.events.push({ seq: this.seq, t: 'actClear', act: next, badge });
    this.toMap();
  }

  // ---- helpers for the UI / bots ----------------------------------------------------------------
  // A deep clone of runs[p] for the private scenes (G.run = clone). New POKéMON made there get uids that
  // can't collide with the partner's or with the action-seeded range.
  privateRunClone(p) {
    const r = Run.fromJSON(JSON.parse(JSON.stringify(this.runs[p])));
    r.map = this.world.map;
    r.playerName = this.names[p];
    let max = 0;
    for (const run of this.runs) for (const m of run.party) max = Math.max(max, m.uid);
    setUidCounter(Math.max(max, 4e9) + 1000 + p * 100000);
    return r;
  }

  snapshotRun(run) {
    const o = JSON.parse(JSON.stringify(run));
    delete o.map;
    delete o.inNode;
    return o;
  }

  digest() {
    const w = this.world;
    return {
      seq: this.seq, phase: this.phase, votes: this.votes, lastVote: this.lastVote, rng: this.rng ? this.rng.state : 0,
      world: w ? { a: w.actIndex, n: w.nodeId, f: w.floor, b: w.boss, g: w.gauntletIndex, r: w.rng.state, u: w.usedTrainers, s: w.map?.start, ws: w.wildSeen || [] } : null,
      runs: this.runs.map(r => (r ? runDigest(r) : null)), private: this.private, result: this.result, down: this.down,
      ...(this.away.some(Boolean) ? { away: this.away } : {}),
      battle: this.phase === 'battle' && this.battle ? this.battle.digest() : null,
    };
  }

  checksum() { return fnv(JSON.stringify(this.digest())); }
}
