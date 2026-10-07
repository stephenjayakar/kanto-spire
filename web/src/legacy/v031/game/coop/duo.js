// Co-op battles: 2-4 players (one lead each) against up to two enemy POKéMON on the field.
// With n players each foe on the field acts n/2 times per turn (n = 3: once or twice, alternating), so every
// player faces about one attack per turn whatever the party size; foe HP is scaled in coop.js.
// Pure logic (no rendering), Node-testable, fully deterministic (shared seeded RNG).
//
// DuoBattle is a composite of two SubBattle (one per player). SubBattle extends the solo Battle so every
// card effect, scoring rule, held item, badge and boss rule is reused as-is. Each SubBattle looks at the
// shared enemy roster through a "focus": sub.enemyIndex = the roster index it is currently dealing with and
// sub.sides.enemy = duo.enemySides[that index]. rng is a shared object; turn / weather / bossRule /
// defeated / result / intent are accessors that delegate to the duo.
import { D, typeEffect, speciesName } from '../data.js';
import { Battle, newSide, makeEnemy, effectiveness, abilityOf } from '../battle.js';
import { isFainted, maxHp, monName, typesOf, defaultMoves, DECK_RULES } from '../pokemon.js';
import { BOSS_RULES } from '../bosses.js';
import { CONSUMABLES, BALLS } from '../items.js';
import { FIXED_DAMAGE } from '../effects.js';
import { COOP_TUNING } from './tuning.js';

const DOWN = Object.freeze({ outcome: 'down' });
const TEAM_UP_DEF = { key: 'TEAM_UP', onHand(S) { S.times(1 + COOP_TUNING.teamUp / 100, 'TEAM UP'); } };
const WEATHER_RULES = new Set(['FLANNERY', 'WALLACE', 'GLACIA']); // onBattleStart only sets the (shared) weather

// =====================================================================================================
export class SubBattle extends Battle {
  constructor(duo, p, run, cfg) {
    super(run, cfg); // (accessors below keep the constructor's assignments local until the duo is attached)
    this.duo = duo;
    this.p = p;
    this._teamUp = false;
  }

  // ---- state shared through the duo ---------------------------------------------------------------
  get turn() { return this.duo ? this.duo.turn : this._turn; }
  set turn(v) { if (this.duo) this.duo.turn = v; else this._turn = v; }
  get weather() { return this.duo ? this.duo.weather : this._weather; }
  set weather(v) { if (this.duo) this.duo.weather = v; else this._weather = v; }
  get weatherTurns() { return this.duo ? this.duo.weatherTurns : this._weatherTurns; }
  set weatherTurns(v) { if (this.duo) this.duo.weatherTurns = v; else this._weatherTurns = v; }
  get bossRule() { return this.duo ? this.duo.bossRule : this._bossRule; }
  set bossRule(v) { if (this.duo) this.duo.bossRule = v; else this._bossRule = v; }
  get defeated() { return this.duo ? this.duo.defeated : this._defeated; }
  set defeated(v) { if (!this.duo) this._defeated = v; }
  // A sub's result: its own final result once the duo is over; DOWN while its team is out; else the duo's.
  get result() {
    if (this._result || this._finalizing) return this._result || null;
    if (!this.duo) return null;
    if (this.duo.down[this.p]) return DOWN;
    return this.duo.result;
  }
  set result(v) { this._result = v; }
  // The intent of the focused enemy (the duo owns intents; Battle's writes are ignored once attached).
  get intent() { return this.duo ? this.duo.intentFor(this.enemyIndex) : this._intent; }
  set intent(v) { if (!this.duo) this._intent = v; }

  // Enemy POKéMON keep their per-mon state (recharge) in the duo, so whoever they target sees it.
  ms(uid) {
    if (this.duo && this.duo.enemyUids.has(uid)) return (this.duo.enemyMs[uid] ||= { sleep: 0, recharge: 0, toxic: 0, drowsy: false });
    return super.ms(uid);
  }

  emit(e) {
    if (!this.duo || this.dry) { this.events.push(e); return e; }
    e.p = this.p;
    if (e.ei === undefined) e.ei = this.enemyIndex;
    if (e.slot === undefined) { const s = this.duo.field.indexOf(this.enemyIndex); e.slot = s >= 0 ? s : null; }
    this.duo.events.push(e);
    return e;
  }

  // ---- focus ------------------------------------------------------------------------------------
  focus(ri) {
    if (ri === null || ri === undefined) return;
    this.enemyIndex = ri;
    this.sides.enemy = this.duo.enemySides[ri];
  }
  withFocus(ri, fn) {
    const saved = this.enemyIndex;
    this.focus(ri);
    try { return fn(); } finally { this.focus(saved); }
  }
  // Point at a live field enemy (the one this player last aimed at if it is still out).
  focusAny() {
    const d = this.duo;
    if (d.field.includes(this.enemyIndex) && !d.gone[this.enemyIndex]) { this.focus(this.enemyIndex); return; }
    const ri = d.field.find(x => x !== null && !d.gone[x]);
    if (ri !== undefined) this.focus(ri);
  }

  relicHooks(name) {
    const out = super.relicHooks(name);
    if (name === 'onHand' && this._teamUp) out.push([TEAM_UP_DEF, { key: 'TEAM_UP', state: {} }]);
    return out;
  }

  // ---- overrides --------------------------------------------------------------------------------
  updateIntentPreview() {
    if (!this.duo) return super.updateIntentPreview();
    if (this.dry || this._inSim) return;
    this.duo.refreshIntents();
  }

  setWeather(w, fromAbility) {
    if (this._noWeather) return;
    return super.setWeather(w, fromAbility);
  }

  // Doubles: a lead's INTIMIDATE cuts the ATTACK of every foe on the field.
  onLeadEnter() {
    if (!this.duo || this.dry) return super.onLeadEnter();
    const lead = this.lead();
    const abil = lead ? abilityOfMon(lead) : null;
    if (abil === 'INTIMIDATE') {
      this.msg(`${monName(lead)}'s INTIMIDATE cuts the foes' ATTACK!`);
      for (const ri of this.duo.liveField()) this.withFocus(ri, () => this.addStage('enemy', 'atk', -1, 'INTIMIDATE', true));
    }
    if (abil === 'DRIZZLE') this.setWeather('RAIN', true);
    if (abil === 'DROUGHT') this.setWeather('SUN', true);
    if (abil === 'SAND_STREAM') this.setWeather('SAND', true);
    if (this.bossRule?.onLeadEnter) this.bossRule.onLeadEnter(this, lead);
  }

  // Exact preview against the focused enemy. Battle.simulate replaces sides.enemy with a parsed copy:
  // copy it back into the shared per-enemy side object so the partner keeps seeing the same object.
  simulate(ids) {
    if (!this.duo) return super.simulate(ids);
    const shared = this.sides.enemy;
    // Battle.simulate restores `this.result = <getter value>`: for a downed player that would pin DOWN into
    // _result (and the digest), so a UI preview could change the checksum. Keep _result as it was.
    const savedResult = this._result;
    // Battle.simulate restores the piles but not the per-card flags its dry run flips (a dry draw under a face-down
    // boss rule marks draw-pile cards face down, a dry play turns played cards face up). A preview must never change
    // the state: the player previewing their hand would otherwise desync from a partner (or a replay) who didn't.
    const flags = [];
    for (const pile of Object.values(this.decks)) for (const k of ['draw', 'hand', 'discard', 'gone']) for (const c of pile[k]) flags.push([c, c.faceDown, c.frozen]);
    this._inSim = true;
    try { return super.simulate(ids); }
    finally {
      for (const [c, fd, fr] of flags) { c.faceDown = fd; c.frozen = fr; }
      this._result = savedResult;
      this._inSim = false;
      const parsed = this.sides.enemy;
      if (parsed !== shared) {
        for (const k of Object.keys(shared)) if (!(k in parsed)) delete shared[k];
        Object.assign(shared, parsed);
        this.sides.enemy = shared;
      }
    }
  }

  end(outcome) {
    if (!this.duo) return super.end(outcome);
    if (this.dry || this.duo.result) return;
    if (outcome === 'lose') return this.duo.playerDown(this.p);
    if (outcome === 'fled' || outcome === 'enemyFled') return this.duo.enemyLeaves(this.enemyIndex);
  }

  // The per-player result at the end of the duo battle (exactly like the solo Battle.end).
  finalize(outcome) {
    this._finalizing = true;
    this._result = null;
    try { Battle.prototype.end.call(this, outcome); } finally { this._finalizing = false; }
    const r = this._result;
    if (r && r.exp) r.exp = Math.round(r.exp * (COOP_TUNING.exp[this.duo.coopKind] ?? 1) * (this.duo.cfg.expScale ?? 1));
  }

  checkEnemyFaint(byHand) {
    if (!this.duo) return super.checkEnemyFaint(byHand);
    const d = this.duo, ri = this.enemyIndex, e = this.enemy();
    if (!e || e.hp > 0 || d.result || d.gone[ri] || this.dry) return;
    this.emit({ t: 'faint', side: 'enemy', species: e.species });
    this.msg(`${this.monName(e)} fainted!`);
    d.defeated.push(e);
    if (byHand) for (const [def] of this.relicHooks('onKO')) def.onKO(this);
    d.enemyGone(ri, 'faint');
  }

  // Played cards go back to their owner's discard pile like in solo Battle.play: copied (temporary) cards
  // are used up, DECK_RULES.kickersStay attack cards that didn't score return to the hand.
  returnPlayed(cards, kickers = null) {
    for (const c of cards) {
      if (kickers?.has(c) && c.uid === this.leadUid) this.deck.hand.push(c);
      else if (!c.temp) this.pileOf(c.uid).discard.push(c);
    }
  }

  // Start-of-turn bookkeeping for this player's side (the duo handles the enemies and the turn counter).
  subStartTurn() {
    const ps = this.sides.player;
    ps.protect = false; ps.endure = false; ps.dodge = false; ps.flinch = false; ps.hitThisTurn = false; ps.destinyBond = false;
    for (const c of this.deck.hand) c.frozen = false;
    for (const m of this.run.party) this.ms(m.uid).drowsy = false;
    if (this.mods.pokeFlute) for (const m of this.run.party) if (m.status === 'SLP') { m.status = null; this.ms(m.uid).sleep = 0; }
    this.refillHand(); // same draw rules as solo (refill, queued extra draws, MIMIC copies, free redraw)
    if (this.bossRule?.onTurnStart) this.bossRule.onTurnStart(this);
    this.quickClawProc = !!this.mods.quickClaw && this.rng.chance(0.2);
  }
}

function abilityOfMon(mon) {
  if (mon.ability) return mon.ability;
  const a = D.species[mon.species]?.abilities || [];
  return a[(mon.ivs?.spe ?? 0) % Math.max(1, a.length)] || null;
}

// =====================================================================================================
export class DuoBattle {
  // runs: [run0, run1]; cfg: a duo config (see coop.js duoConfig): { kind, coopKind, enemies, queues,
  // slotQueue, slots, trainer?, trainers?, dmgScale, rng, ... }
  constructor(runs, cfg) {
    this.cfg = cfg;
    this.kind = cfg.kind || 'wild';
    this.coopKind = cfg.coopKind || this.kind;
    this.rng = cfg.rng;
    this.enemies = cfg.enemies;
    this.queues = (cfg.queues || [this.enemies.map((e, i) => i)]).map(q => q.slice());
    this.slotQueue = cfg.slotQueue || [0, 0];
    this.slots = cfg.slots || 2;
    this.field = [null, null];
    this.enemySides = this.enemies.map(() => newSide());
    this.gone = this.enemies.map(() => null);
    this.enemyUids = new Set(this.enemies.map(e => e.uid));
    this.enemyMs = {};
    this.n = runs.length;                       // players (2-4)
    this.intents = [null, null];                // index = slot + 2 * k (k = the foe's k-th action this turn)
    this.locks = runs.map(() => null);
    this.down = runs.map(() => false);
    this.away = runs.map(() => false);          // sat out (left the game): no lock needed, never targeted
    this.curIntent = null;                      // the intent being resolved / previewed (a foe acting twice)
    this.turn = 0;
    this.weather = null; this.weatherTurns = 0;
    this.bossRule = null;
    this.result = null;
    this.events = [];
    this.defeated = [];
    this.hits = {};
    this.lastOk = false;
    this.subs = runs.map((run, p) => new SubBattle(this, p, run, { ...cfg, rng: this.rng, enemies: this.enemies }));
  }

  // ---- helpers ----------------------------------------------------------------------------------
  emit(e) { if (e.p === undefined) e.p = null; this.events.push(e); return e; }
  msg(text) { this.emit({ t: 'msg', text }); }
  takeEvents() { const e = this.events; this.events = []; return e; }
  enemyAt(slot) { const ri = this.field[slot]; return ri === null || ri === undefined ? null : this.enemies[ri]; }
  liveField() { return this.field.filter(ri => ri !== null && !this.gone[ri]); }
  intentFor(ri) {
    if (this.curIntent && this.curIntent.ri === ri) return this.curIntent;
    const s = this.field.indexOf(ri);
    return s >= 0 ? this.intents[s] : null;
  }
  // every intent (of every slot), with its index
  intentList() { const out = []; this.intents.forEach((it, i) => { if (it) out.push(it); }); return out; }
  // How many times the foe in this slot acts this turn (1 with 2 players).
  actsFor(slot) { const n = this.activeCount(); return Math.max(1, Math.floor(n / 2) + (n % 2 && (this.turn + slot) % 2 === 1 ? 1 : 0)); }
  activeCount() { return this.away.filter(a => !a).length || 1; }
  inGame(p) { return Number.isInteger(p) && p >= 0 && p < this.n; }
  out(p) { return this.down[p] || this.away[p]; }
  aliveSubs() { return this.subs.filter(s => !this.down[s.p] && !this.away[s.p]); }
  // The next player after p (in slot order) who is still in the fight, or null.
  nextAlive(p) { for (let k = 1; k < this.n; k++) { const q = (p + k) % this.n; if (!this.out(q)) return q; } return null; }
  host() { return this.aliveSubs()[0] || this.subs[0]; }
  trainerFor(slot) { return this.cfg.trainers?.[this.slotQueue[slot]] || this.cfg.trainer || null; }
  // A target slot, retargeted to the other enemy if that slot is empty.
  normSlot(t) {
    if (t !== 0 && t !== 1) return null;
    if (this.field[t] !== null) return t;
    return this.field[1 - t] !== null ? 1 - t : null;
  }
  queueFor(slot) { return this.queues[this.slotQueue[slot]] || []; }

  // ---- lifecycle --------------------------------------------------------------------------------
  start() {
    for (const s of this.subs) s.buildDeck();
    const titles = this.cfg.trainers ? this.cfg.trainers.map(t => t.title) : this.cfg.trainer ? [this.cfg.trainer.title] : [];
    if (titles.length) this.msg(`${titles.join(' and ')} ${titles.length > 1 ? 'want' : 'wants'} to battle!`);
    for (let slot = 0; slot < this.slots; slot++) {
      const q = this.queueFor(slot);
      if (q.length) this.sendOut(slot, q.shift(), true);
    }
    for (const s of this.subs) {
      s.focusAny();
      if (this.away[s.p]) continue; // (a sat-out player's lead stays on the bench)
      s.emit({ t: 'leadOut', uid: s.leadUid });
      s.msg(`Go! ${monName(s.lead())}!`);
      s.participants.add(s.leadUid);
      s.startLead = `${s.lead().species}:${s.lead().level}`;
      s.onLeadEnter();
    }
    for (const s of this.aliveSubs()) for (const [def, inst] of s.relicHooks('onBattleStart')) def.onBattleStart(s, inst.state);
    const br = this.bossRule;
    if (br?.onBattleStart) {
      this.aliveSubs().forEach((s, i) => {
        if (i > 0 && WEATHER_RULES.has(br.key)) return;
        s._noWeather = i > 0 && !!this.weather;
        try { br.onBattleStart(s); } finally { s._noWeather = false; }
      });
    }
    this.startTurn();
    return this.takeEvents();
  }

  sendOut(slot, ri, first) {
    const e = this.enemies[ri];
    const spikes = Math.max(0, ...this.enemySides.map(s => s.spikes || 0));
    this.enemySides[ri] = { ...newSide(), spikes };
    this.field[slot] = ri;
    this.clearIntents(slot);
    if (e.bossRule && BOSS_RULES[e.bossRule]) this.bossRule = BOSS_RULES[e.bossRule];
    this.emit({ t: 'enemyOut', slot, ei: ri, index: ri, species: e.species, first: !!first });
    const h = this.host();
    if (this.kind === 'wild') this.emit({ t: 'msg', text: `A wild ${speciesName(e.species)} appeared!`, slot, ei: ri });
    else this.emit({ t: 'msg', text: `${this.trainerFor(slot)?.name || 'Foe'} sent out ${speciesName(e.species)}!`, slot, ei: ri });
    if (e.bossRule && BOSS_RULES[e.bossRule]) this.emit({ t: 'bossRule', rule: e.bossRule, name: BOSS_RULES[e.bossRule].name, desc: BOSS_RULES[e.bossRule].desc, slot, ei: ri });
    h.withFocus(ri, () => {
      if (spikes) { h.damageEnemy(Math.floor(e.maxHp * spikes / 8), 'SPIKES'); h.msg(`${h.monName(e)} is hurt by spikes!`); }
      const ab = e.ability;
      if (ab === 'DRIZZLE') h.setWeather('RAIN', true);
      if (ab === 'DROUGHT') h.setWeather('SUN', true);
      if (ab === 'SAND_STREAM') h.setWeather('SAND', true);
    });
    // An enemy's INTIMIDATE hits both players.
    if (e.ability === 'INTIMIDATE') {
      this.emit({ t: 'msg', text: `${h.monName(e)}'s INTIMIDATE cuts your ATTACK!`, slot, ei: ri });
      for (const s of this.aliveSubs()) s.withFocus(ri, () => s.addStage('player', 'atk', -1, 'INTIMIDATE', true));
    }
  }

  // An enemy left the field (fainted, caught, fled): refill its slot from the trainer's queue, or win.
  enemyGone(ri, why) {
    if (this.gone[ri]) return;
    this.gone[ri] = why;
    const slot = this.field.indexOf(ri);
    if (slot >= 0) {
      this.field[slot] = null;
      this.clearIntents(slot);
      this.emit({ t: 'enemyGone', slot, ei: ri, why });
      const q = this.queueFor(slot);
      if (q.length) this.sendOut(slot, q.shift(), false);
    }
    if (this.field.every(x => x === null) && this.queues.every(q => !q.length)) this.finish('win');
  }

  enemyLeaves(ri) {
    if (this.gone[ri]) return;
    this.enemyGone(ri, 'fled');
  }

  playerDown(p) {
    if (this.down[p] || this.result) return;
    this.down[p] = true;
    this.locks[p] = null;
    this.emit({ t: 'down', p });
    if (this.down.every((d, q) => d || this.away[q])) { this.finish('lose'); return; }
    this.msg(`${this.subs[p].run.playerName || 'Your partner'} is out of usable POKéMON!`);
    for (const it of this.intents) if (it && it.target === p) it.target = this.nextAlive(p);
    this.refreshIntents();
  }

  finish(outcome) {
    if (this.result) return;
    if (outcome === 'win') {
      for (const s of this.subs) {
        if (!this.down[s.p]) continue;
        const lead = s.lead() || s.run.party[0];
        lead.hp = Math.max(1, Math.floor(maxHp(lead) * COOP_TUNING.reviveFrac));
        lead.status = null;
        s.ms(lead.uid).faintHandled = false;
        this.emit({ t: 'revive', p: s.p, uid: lead.uid, hp: lead.hp });
      }
      const nothing = !this.defeated.length;
      for (const s of this.subs) s.finalize(s.caught ? 'caught' : nothing ? 'fled' : 'win');
    } else {
      for (const s of this.subs) s.finalize('lose');
    }
    this.result = { outcome };
    this.locks = this.subs.map(() => null);
    this.emit({ t: 'duoEnd', outcome });
  }

  // ---- turns ------------------------------------------------------------------------------------
  startTurn() {
    if (this.result) return;
    this.turn++;
    for (const ri of this.liveField()) {
      const es = this.enemySides[ri];
      es.protect = false; es.endure = false; es.dodge = false; es.flinch = false; es.hitThisTurn = false; es.destinyBond = false;
    }
    this.hits = {};
    for (const s of this.aliveSubs()) { s.focusAny(); s.subStartTurn(); }
    this.chooseIntents();
    for (const s of this.aliveSubs()) s.focusAny();
    this.emit({ t: 'turn', turn: this.turn });
  }

  // Which player a foe attacks: weighted by type matchup and low HP (shared RNG, so deterministic).
  // (3-4 players: a foe acting twice in a turn aims its second action at someone else when it can)
  pickTarget(ri, taken, exclude = null) {
    let alive = this.subs.map(s => s.p).filter(p => !this.out(p) && this.subs[p].lead());
    if (exclude?.length && alive.some(p => !exclude.includes(p))) alive = alive.filter(p => !exclude.includes(p));
    if (alive.length <= 1) return alive[0] ?? null;
    const e = this.enemies[ri];
    const w = alive.map(p => {
      const lead = this.subs[p].lead();
      const types = typesOf(lead), ab = abilityOf(lead);
      let best = 0;
      for (const k of e.moves) { const m = D.moves[k]; if (m && (m.power > 0 || FIXED_DAMAGE[m.effect])) best = Math.max(best, FIXED_DAMAGE[m.effect] ? 1 : effectiveness(m.type, types, ab)); }
      let x = 1;
      if (best > 1) x *= COOP_TUNING.targetSuper; else if (best < 1) x *= 0.75;
      if (lead.hp / maxHp(lead) < 0.4) x *= COOP_TUNING.targetLowHp;
      const k = taken.filter(q => q === p).length;
      if (k) x *= 0.8 ** k; // spread the attacks a little
      return x;
    });
    return alive[this.rng.weighted(alive.map((p, i) => i), i => w[i])];
  }

  // One intent per foe action: intents[slot + 2 * k] is the k-th action of the foe in that slot this turn
  // (2 players: one action each, intents = [slot 0, slot 1]).
  chooseIntents() {
    const taken = [];
    const acts = [0, 1].map(slot => this.actsFor(slot));
    this.intents = new Array(2 * Math.max(...acts)).fill(null);
    for (let k = 0; k < Math.max(...acts); k++) {
      for (let slot = 0; slot < 2; slot++) {
        if (k >= acts[slot]) continue;
        const i = slot + 2 * k;
        const ri = this.field[slot];
        if (ri === null || this.gone[ri]) { this.intents[i] = null; continue; }
        const p = this.pickTarget(ri, taken, k ? this.intentsOf(slot).map(it => it.target) : null);
        if (p === null) { this.intents[i] = null; continue; }
        taken.push(p);
        const s = this.subs[p];
        s.withFocus(ri, () => {
          const move = s.pickEnemyMove(this.enemies[ri], s.lead());
          this.intents[i] = { ri, move, target: p, first: false, kind: 'attack', text: '', damage: null, eff: 1, lethal: false };
        });
      }
    }
    this.refreshIntents();
  }
  // The intents of the foe in a slot (its actions this turn, in order).
  clearIntents(slot) { for (let i = slot; i < this.intents.length; i += 2) this.intents[i] = null; }
  intentsOf(slot) { const out = []; for (let i = slot; i < this.intents.length; i += 2) if (this.intents[i]) out.push(this.intents[i]); return out; }

  // Recompute every intent's preview (damage range, lethal, first) against its target's current lead.
  refreshIntents() {
    if (this.refreshing) return;
    this.refreshing = true;
    try {
      for (let i = 0; i < this.intents.length; i++) {
        const it = this.intents[i];
        if (!it) continue;
        if (this.out(it.target)) { const o = this.nextAlive(it.target); if (o === null) continue; it.target = o; }
        const s = this.subs[it.target];
        this.curIntent = it;
        try { s.withFocus(it.ri, () => Battle.prototype.updateIntentPreview.call(s)); } finally { this.curIntent = null; }
      }
    } finally { this.refreshing = false; }
  }

  maybeResolve() {
    if (this.result) return;
    if (this.subs.every(s => this.out(s.p) || this.locks[s.p])) this.resolveTurn();
  }

  handPriority(s, cards) { return Math.max(0, ...cards.map(c => D.moves[c.move]?.priority || 0)); }

  resolveTurn() {
    const actors = [];
    for (const s of this.aliveSubs()) {
      const L = this.locks[s.p];
      if (!L) continue;
      if (L.pass) {
        s.handsPlayed++;
        s.msg(`${monName(s.lead())} can't move!`);
        continue;
      }
      if (L.ball) { actors.push({ kind: 'ball', p: s.p, prio: 7, quick: 1, spd: 0, slot: L.target, ball: L.ball }); continue; }
      const cards = s.findCards(L.ids);
      const ns0 = this.normSlot(L.target);
      let kickers = null;
      if (DECK_RULES.kickersStay && ns0 !== null) s.withFocus(this.field[ns0], () => { const pv = s.preview(L.ids); if (pv && pv.key !== 'SUPPORT') { const sc = new Set(pv.scoring); kickers = new Set(cards.filter(c => !sc.has(c.id) && !s.cardInfo(c).status)); } });
      s.enemyJustSwitched = false;
      s.faintSwitch = false;
      s.deck.hand = s.deck.hand.filter(c => !cards.includes(c));
      for (const c of cards) c.faceDown = false;
      const ns = this.normSlot(L.target);
      if (ns !== null) s.focus(this.field[ns]);
      s.emit({ t: 'play', ids: cards.map(c => c.id), target: L.target });
      const quick = s.mods.quickClaw && (s.handsPlayed === 0 || s.quickClawProc) ? 1 : 0;
      actors.push({ kind: 'hand', p: s.p, prio: this.handPriority(s, cards), quick, spd: s.speedOf('player'), slot: L.target, cards, kickers });
    }
    for (let i = 0; i < this.intents.length; i++) {
      const it = this.intents[i], slot = i % 2;
      if (!it || this.field[slot] !== it.ri) continue;
      const s = this.subs[it.target];
      const spd = s.withFocus(it.ri, () => s.speedOf('enemy'));
      actors.push({ kind: 'enemy', slot, i, ri: it.ri, prio: it.move.priority || 0, quick: 0, spd });
    }
    const order = (a) => (a.kind === 'enemy' ? 1 : 0);
    actors.sort((a, b) => (b.prio - a.prio) || (b.quick - a.quick) || (b.spd - a.spd) || (order(a) - order(b)) || ((a.p ?? a.i) - (b.p ?? b.i)));
    for (const a of actors) {
      if (this.result) {
        if (a.kind === 'hand') this.subs[a.p].returnPlayed(a.cards);
        continue;
      }
      if (a.kind === 'hand') this.execHand(a);
      else if (a.kind === 'ball') this.execBall(a);
      else this.execEnemy(a);
    }
    this.locks = this.subs.map(() => null);
    if (!this.result) this.endTurn();
    if (!this.result) this.startTurn();
  }

  execHand(a) {
    const s = this.subs[a.p];
    const back = () => s.returnPlayed(a.cards, a.kickers);
    if (this.out(a.p)) { back(); return; }
    const slot = this.normSlot(a.slot);
    if (slot === null) { back(); return; }
    const ri = this.field[slot];
    s.focus(ri);
    const infos = a.cards.map(c => s.cardInfo(c));
    s._teamUp = (this.hits[ri] || 0) >= 1;
    this.hits[ri] = (this.hits[ri] || 0) + 1;
    const es = this.enemySides[ri];
    const seeded = es.seeded;
    if (s._teamUp) s.emit({ t: 'teamUp', bonus: COOP_TUNING.teamUp });
    try { s.resolveHand(infos); } finally { s._teamUp = false; }
    if (!seeded && es.seeded) es.seededBy = a.p;
    back();
    if (a.cards.some(c => c.uid === s.leadUid)) s.leadStreak++;
  }

  execBall(a) {
    const s = this.subs[a.p];
    if (this.out(a.p) || s.caught || !(s.run.balls[a.ball] > 0)) return;
    const slot = this.normSlot(a.slot);
    if (slot === null) return;
    const ri = this.field[slot];
    s.focus(ri);
    if (s.ballAttempt(a.ball)) this.enemyGone(ri, 'caught');
  }

  execEnemy(a) {
    const it = this.intents[a.i];
    if (!it || it.ri !== a.ri || this.field[a.slot] !== a.ri || this.gone[a.ri]) return;
    let p = it.target;
    if (this.out(p)) { p = this.nextAlive(p); if (p === null) return; it.target = p; }
    const s = this.subs[p];
    s.focus(a.ri);
    this.curIntent = it;
    try { s.enemyAct(); } finally { this.curIntent = null; }
  }

  endTurn() {
    const field = this.liveField();
    let h = this.host();
    if (this.weather) {
      if (this.weather === 'SAND' || this.weather === 'HAIL') {
        for (const ri of field) h.withFocus(ri, () => h.weatherDamage(true, false));
        for (const s of this.aliveSubs()) s.weatherDamage(false, true);
        this.msg(this.weather === 'SAND' ? 'The sandstorm rages.' : 'Hail continues to fall.');
      }
      if (--this.weatherTurns <= 0) { this.msg('The weather returned to normal.'); this.weather = null; this.emit({ t: 'weather', weather: null }); }
    }
    // Enemy residuals once per enemy (LEECH SEED heals the player who planted it).
    for (const ri of field) {
      if (this.gone[ri] || !this.field.includes(ri)) continue;
      const es = this.enemySides[ri];
      h = this.host();
      const s = es.seededBy !== undefined && !this.out(es.seededBy) ? this.subs[es.seededBy] : h;
      const done = s.withFocus(ri, () => { const r = s.enemyResiduals(); if (!r) s.checkEnemyFaint(false); return r; });
      if (this.result || done) return;
    }
    // Player residuals once per lead.
    for (const s of this.aliveSubs()) {
      s.focusAny();
      s.leadResiduals();
      s.checkLeadFaint();
      if (this.result) return;
    }
    for (const s of this.aliveSubs()) s.playerCounters();
  }

  // ---- player actions (all return the events produced; this.lastOk tells if the action was legal) ----
  actor(p) {
    if (this.result || !this.inGame(p) || this.out(p) || this.locks[p]) return null;
    return this.subs[p];
  }

  discard(p, ids) {
    this.lastOk = false;
    const s = this.actor(p);
    if (!s || !validIds(s, ids)) return [];
    const n = this.events.length;
    s.discard(ids);
    this.lastOk = this.events.length > n;
    this.maybeResolve();
    return this.takeEvents();
  }

  switchLead(p, uid) {
    this.lastOk = false;
    const s = this.actor(p);
    if (!s) return [];
    const n = this.events.length;
    s.switchLead(uid);
    this.lastOk = this.events.length > n;
    if (this.lastOk) s.focusAny();
    return this.takeEvents();
  }

  useItem(p, key, uid, toP) {
    this.lastOk = false;
    const s = this.actor(p);
    const def = CONSUMABLES[key];
    if (!s || !def || !s.run.hasConsumable(key)) return [];
    // No escaping in co-op; growth items (candies, stones, vitamins) are used between battles.
    if (def.flee || def.levels || def.evo || def.combo || def.sell || def.addCopy) return [];
    if (toP !== undefined && toP !== null && toP !== p) {
      if (!this.inGame(toP) || this.away[toP]) return [];
      if (def.stage || def.focus || def.mist || def.reviveAll) return [];
      const t = this.subs[toP];
      const mon = t.run.party.find(m => m.uid === uid);
      if (!mon) return [];
      const wasFainted = isFainted(mon);
      if (!s.run.applyConsumableToMon(key, mon, t)) return [];
      s.run.useConsumable(key);
      t.emit({ t: 'item', key, uid, from: p });
      if (wasFainted && !isFainted(mon)) {
        t.ms(uid).faintHandled = false;
        t.msg(`${monName(mon)} was revived!`);
        if (this.down[toP]) {
          // A revive brings a downed partner back into the fight.
          this.down[toP] = false;
          t.switchLead(uid, true);
          t.focusAny();
          this.emit({ t: 'rejoin', p: toP, uid });
        }
      }
      t.emit({ t: 'partyUpdate' });
      this.refreshIntents();
      this.lastOk = true;
      return this.takeEvents();
    }
    const n = this.events.length;
    s.useItem(key, uid || null);
    this.lastOk = this.events.length > n;
    this.maybeResolve();
    return this.takeEvents();
  }

  lock(p, L) {
    this.lastOk = false;
    const s = this.actor(p);
    if (!s || !L || typeof L !== 'object') return [];
    let lk = null;
    if (L.pass) lk = { pass: true };
    else if (L.ball) {
      if (this.kind !== 'wild' || !BALLS[L.ball] || !(s.run.balls[L.ball] > 0) || s.caught) return [];
      const slot = this.normSlot(L.target);
      if (slot === null || this.enemyAt(slot).isBoss) return [];
      lk = { ball: L.ball, target: slot };
    } else if (Array.isArray(L.ids)) {
      if (!validIds(s, L.ids) || !s.canPlay(L.ids).ok) return [];
      const slot = this.normSlot(L.target);
      if (slot === null) return [];
      lk = { ids: L.ids.slice(), target: slot };
    } else return [];
    this.locks[p] = lk;
    this.lastOk = true;
    this.emit({ t: 'lock', p, pass: !!lk.pass, ball: lk.ball || null, target: lk.target ?? null });
    this.maybeResolve();
    return this.takeEvents();
  }

  // Take back a lock-in (UNLOCK) while the turn hasn't resolved yet. Both clients apply this in log order,
  // so if the partner's lock landed first the turn is already over and this is refused (it names the turn
  // it was meant for, so a late unlock can never cancel a lock made on a later turn).
  unlock(p, turn) {
    this.lastOk = false;
    if (this.result || !this.inGame(p) || this.out(p) || !this.locks[p]) return [];
    if (turn !== undefined && turn !== null && turn !== this.turn) return [];
    this.locks[p] = null;
    this.lastOk = true;
    this.emit({ t: 'unlock', p });
    return this.takeEvents();
  }

  // ---- previews ---------------------------------------------------------------------------------
  // Would player p's hand get the TEAM UP bonus on this enemy (another player locked on it and acts first)?
  teamUpPreview(p, ri) {
    for (const o of this.subs.map(x => x.p)) {
      if (o === p) continue;
      const L = this.locks[o];
      if (!L || !L.ids || this.out(o)) continue;
      const slot = this.normSlot(L.target);
      if (slot === null || this.field[slot] !== ri) continue;
      const me = this.subs[p], them = this.subs[o];
      const myCards = me.findCards(this.locks[p]?.ids || []), theirCards = them.findCards(L.ids);
      const pm = this.handPriority(me, myCards), pt = this.handPriority(them, theirCards);
      if (pt !== pm) { if (pt > pm) return true; continue; }
      const sm = me.speedOf('player'), st = them.speedOf('player');
      if (st !== sm ? st > sm : o < p) return true;
    }
    return false;
  }
  // Damage the other players' locked hands will deal to the foe in this slot (for target hints).
  lockedDamageOn(p, slot) {
    let sum = 0;
    for (const s of this.subs) {
      const o = s.p, L = this.locks[o];
      if (o === p || !L || !L.ids || this.out(o) || this.normSlot(L.target) !== slot) continue;
      sum += this.simulate(o, L.ids, L.target)?.damage || 0;
    }
    return sum;
  }
  // Sit a player out (they left the game) or bring them back. Their lead stays on the bench: no lock
  // needed from them, foes never target them; if everyone still fighting is down, the battle is lost.
  setAway(p, away) {
    if (!this.inGame(p) || this.away[p] === !!away) return false;
    this.away[p] = !!away;
    if (away) {
      this.locks[p] = null;
      this.emit({ t: 'away', p, away: true });
      if (!this.result && this.subs.every(s => this.out(s.p))) { if (this.away.every(Boolean)) return true; this.finish('lose'); return true; }
      for (const it of this.intents) if (it && it.target === p) it.target = this.nextAlive(p);
      this.refreshIntents();
      this.maybeResolve();
    } else this.emit({ t: 'away', p, away: false });
    return true;
  }

  // Exact preview of player p's cards against the enemy in `target` slot (same shape as Battle.simulate).
  simulate(p, ids, target) {
    const s = this.subs[p];
    const slot = this.normSlot(target);
    if (!s || slot === null) return null;
    const ri = this.field[slot];
    return s.withFocus(ri, () => {
      s._teamUp = this.teamUpPreview(p, ri);
      try { return s.simulate(ids); } finally { s._teamUp = false; }
    });
  }

  // Card info for the UI against a given target slot (eff, damage preview, blockedBy).
  cardInfo(p, card, target = 0) {
    const s = this.subs[p];
    const slot = this.normSlot(target);
    if (slot === null) return s.cardInfo(card);
    return s.withFocus(this.field[slot], () => s.cardInfo(card));
  }

  catchChance(p, ball, target = 0) {
    const s = this.subs[p];
    const slot = this.normSlot(target);
    if (slot === null || this.kind !== 'wild') return 0;
    return s.withFocus(this.field[slot], () => s.catchChance(ball));
  }

  // ---- determinism ------------------------------------------------------------------------------
  digest() {
    const msN = (o) => Object.keys(o).filter(k => Object.values(o[k]).some(Boolean)).sort().map(k => [k, o[k]]);
    return {
      turn: this.turn, weather: this.weather, wt: this.weatherTurns, rng: this.rng.state, field: this.field, gone: this.gone,
      enemies: this.enemies.map(e => [e.uid, e.hp, e.maxHp, e.status, e.sleepTurns, e.toxic, e.sturdyUsed || 0, e.sleepImmune || 0]),
      sides: this.enemySides, intents: this.intents.map(i => i && [i.ri, i.move.key, i.target, i.damage, i.first, i.lethal]),
      locks: this.locks, down: this.down, result: this.result, bossRule: this.bossRule?.key || null,
      ...(this.away.some(Boolean) ? { away: this.away } : {}),
      defeated: this.defeated.map(e => e.uid), enemyMs: msN(this.enemyMs),
      subs: this.subs.map(s => ({
        lead: s.leadUid, dl: s.discardsLeft, fs: s.freeSwitches, hands: s.handsPlayed, ls: s.leadStreak, fsw: !!s.faintSwitch, ei: s.enemyIndex,
        side: s.sides.player, ms: msN(s.monState), chains: s.chains, payDay: s.payDay, caught: s.caught?.uid ?? null,
        parts: [...s.participants], res: s._result || null, qc: !!s.quickClawProc,
        fdt: s.freeDiscardTurn ?? null, acro: s.acroTurn ?? null, bd: s.bonusDraw || 0, pc: s.pendingCopies || [],
        decks: Object.keys(s.decks).map(k => { const d = s.decks[k]; const ids = a => a.map(c => c.id + (c.frozen ? 'f' : '') + (c.faceDown ? 'd' : '') + (c.temp ? 't' + c.move : '')); return [k, ids(d.draw), ids(d.hand), ids(d.discard), ids(d.gone)]; }),
      })),
    };
  }
}

function validIds(s, ids) {
  if (!Array.isArray(ids) || !ids.length || ids.length > 5) return false;
  if (new Set(ids).size !== ids.length) return false;
  return s.findCards(ids).length === ids.length;
}

// Pads a party that sends two at a time to at least two POKéMON (copies the area's wild species).
export function padEnemies(run, rng, enemies, n = 2) {
  const out = enemies.slice();
  if (!out.length) return out;
  const pool = run.act.areas.flatMap(a => a.pool || (D.encounters[a.map]?.land || []).map(e => e.species)).filter(sp => D.species[sp]);
  while (out.length < n && pool.length) {
    const ref = out[out.length - 1];
    const sp = rng.pick(pool);
    const e = makeEnemy(sp, ref.level, { rng, moves: defaultMoves(sp, ref.level), hpScale: ref.maxHp / ref.realMaxHp, isBoss: ref.isBoss, isElite: ref.isElite, bossRule: ref.bossRule });
    out.unshift(e);
  }
  return out;
}
