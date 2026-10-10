// Run state: party, money, items, map position, encounter generation, rewards, ascension.
import { RNG, randomSeedString } from './rng.js';
import { D, expYield, expForLevel, isSpecial, speciesName, typeEffect } from './data.js';
import { canUseStone, makeMon, maxHp, healFull, healFrac, isFainted, gainExp, addLevels, teachMove, knowsMove, canLearn, typesOf, setUidCounter, nextUid, itemEvolution, evolve, monName, defaultMoves, defaultCopies, DECK_RULES, NO_PLAYER_MOVES } from './pokemon.js';
import { LEGENDS, STARTERS, rivalKey, BIRDS, RIVAL_INTROS, counterStarter, rivalParty , blueParty } from './acts.js';
import { actsForRun, regionOf, drawSpire, rivalFor, validSpire, spireCode, SPIRE, timeOfDay, areaPool } from './regions.js';
import { HOENN_TRAINER_CLASSES } from './hoenn.js';
import { generateMap } from './map.js';
import { makeEnemy } from './battle.js';
import { RELICS, BADGES, CONSUMABLES, BALLS, RELIC_PRICE, VITAMIN_COMBO, tmMove, friendCopy } from './items.js';
import { CHAMPION_RULE_POOL, ELITE_RULE_POOL } from './bosses.js';
import { VERSION } from './version.js';

export const ASCENSIONS = [
  { n: 0, name: 'Standard', desc: 'The base game.' },
  { n: 1, name: 'Elite Patrol', desc: 'More elite battles, and elites have 10% more HP.' },
  { n: 2, name: 'Fog of War', desc: 'Enemy moves are hidden (no intent, no move list). Foes are 1 level higher; you earn 10% less EXP.' },
  { n: 3, name: 'Gym Prep', desc: 'Bosses and the ELITE FOUR are 2 levels higher with 10% more HP.' },
  { n: 4, name: 'Shoestring', desc: 'Start with less money, fewer POKé BALLS and no POTIONS. Shop prices +25% and battles pay 20% less.' },
  { n: 5, name: 'Level Cap', desc: "Battle EXP stops at each act's level cap: its boss's top level +2. EXP past the cap is lost." },
  { n: 6, name: 'Reinforcements', desc: 'From mid Act 1 on, trainers and elites bring one more POKéMON (worth no EXP).' },
  { n: 7, name: 'Bulky Foes', desc: 'Enemies have 15% more HP.' },
  { n: 8, name: 'Nuzlocke', desc: 'A POKéMON that faints in battle is released for good. Only the first wild POKéMON of each act can be caught.' },
  { n: 9, name: 'Ruthless Elites', desc: 'From Act 2 on, elite battles have boss rules.' },
  { n: 10, name: "Champion's Path", desc: 'From Act 2 on, enemies hit 15% harder and are 1 more level higher. Good luck.' },
];
// The first stage of a species' evolution line (wild no-repeat counts whole families: WEEDLE, KAKUNA, BEEDRILL).
let PREVO = null;
export function familyOf(sp) {
  if (!PREVO) { PREVO = {}; for (const [k, d] of Object.entries(D.species)) for (const e of d.evolutions || []) if (!PREVO[e.into]) PREVO[e.into] = k; }
  for (let i = 0; i < 4 && PREVO[sp]; i++) sp = PREVO[sp];
  return sp;
}

export const MAX_ASCENSION = ASCENSIONS.length - 1;
// Nuzlocke rules from this ascension on (v0.0.6: it took the slot of Inflation, which moved into A4).
// Co-op runs never use them (a downed partner is revived after every win there).
export const NUZLOCKE_ASC = 8;
// Level cap from this ascension on (v0.3.2: it replaced Weary): see Run.levelCap.
export const LEVEL_CAP_ASC = 5;

// Gen 5 scaled EXP: the multiplier on one foe's EXP for a recipient of level monLevel (1 at the same level; a
// Lv20 POKéMON beating a Lv10 foe gets about 0.49x, a Lv5 one about 1.58x).
export function expLevelScale(foeLevel, monLevel, curve = TUNING.expCurve) {
  if (!curve) return 1;
  return Math.pow((2 * foeLevel + 10) / (foeLevel + monLevel + 10), curve);
}
// The multiplier on a battle's whole EXP for one recipient: each defeated foe's EXP scaled by its own level
// (result.foes = [{level, exp}] from Battle.end; co-op's EXP tuning rescales result.exp, so this is a ratio).
export function expShareScale(foes, monLevel) {
  let tot = 0, scaled = 0;
  for (const f of foes || []) { tot += f.exp; scaled += f.exp * expLevelScale(f.level, monLevel); }
  return tot > 0 ? scaled / tot : 1;
}

// Tuning knobs (balanced with tests/sim.mjs)
export const TUNING = {
  expMult: 1.3, // (v0.3.2: 1.35 -> 1.3 with scaled EXP, which levels a rotating team faster)
  // Gen 5 scaled EXP: each recipient's share of a foe's EXP x ((2*Lfoe+10)/(Lfoe+Lmon+10))^expCurve (1 at the
  // same level, less when over-leveled, more when under-leveled; 0 = off). See expLevelScale.
  expCurve: 2.5,
  // A5+ level cap: the act boss's top level (the CHAMPION's in the ELITE FOUR act) + this
  levelCapOffset: 2,
  postBattleHeal: 0.05,
  // DMG system: enemy HP = the species' real HP at its level x hpScale (per act, start->end of act)
  hpScale: [[3.17, 4.38], [2.77, 3.54], [2.9, 3.7], [2.79, 3.2], [3.25, 4]],
  kindHp: { wild: 1, trainer: 1, elite: 1.22, boss: 1.2, legend: 1.6, rival: 1.05 },
  // Rival (fixed floor, act.rival): levels above the floor's level, party size per act (FireRed's grow too).
  rival: { lvl: 1, cap: [3, 4, 4, 5, 6], dmg: 1, hp: [1, 0.92, 0.88] },
  // Legendary bird node (act.bird): levels above the floor's level, HP on top of kindHp.legend, damage.
  bird: { lvl: 3, hp: [1.2, 1.2, 2.6, 3], dmg: 1.1 },
  partyHp: [1, 0.9, 0.85, 0.8, 0.75, 0.7],
  bossPartyHp: [1, 0.85, 0.72, 0.62, 0.55, 0.5],
  dmgScale: [1.46, 1.27, 1.04, 0.83, 0.83],
  worldScale: { hoenn: { hp: [0.825, 0.925, 1.035], dmg: 1.08 }, johto: { hp: [0.92, 1.0, 1.06], dmg: 1.1 } }, // HOENN / JOHTO acts: hp per act, damage overall
  gauntletHp: [1.48, 1.6, 1.75, 1.87, 2.07], // Elite Four / Champion HP scale (x real HP, before kindHp and party size)
  // held-item supply (about half of what it used to be): chance per elite / boss / item ball; Marts stock one
  relicOdds: { elite: 0.7, boss: 0.5, treasure: 0.4 }, shopRelics: 1, shopRelicBuys: 2,
  bossHpAct: [0.95, 0.8, 0.8, 1, 1],
  bossHp: { MISTY: 0.7, BLAINE: 0.8 }, // per-leader HP (DMG system: full type resistances wall CHARMANDER here)
  // money: flat-ish pay per act (the old level-based pay snowballed into unspendable piles)
  trainerPay: 150, wildPay: 40, shopActScale: 0.3,
  // hpMult scales all enemy HP and dmgMult all enemy damage (discard update: 1.62 / 0.9, was 1.16 / 1: foes take
  // two hands more often so a bad hand is worth a discard; smart bot ~20% at Kanto and Hoenn A0).
  // v0.0.6: 1.92 (rival floors pay a held item every act and the hardest elites moved out of the pools into
  // the optional bird nodes): smart bot Kanto A0 18-22%, Hoenn 22-25% on 100-run seeds. Then 2.4: the bots stopped
  // losing items to a full bag (they used to throw ~5 vitamins away per run; players didn't): Kanto 19-25%, Hoenn 16-22%.
  // Experiments (tests/balance.mjs --scoring hybrid --hpmult 1.1 --itemscale 0.5): 'hybrid' keeps the DMG cards
  // but lets the combo bonus and the rare "x" items multiply instead of adding up; itemScale multiplies every
  // held-item/badge damage bonus (1 = the values in items.js).
  scoring: 'dmg', hpMult: 2.4, itemScale: 1, dmgMult: 0.9,
};

export class Run {
  constructor() {}

  // world: 'spire' (v0.1.0: each act draws its region; pool = the regions it may draw, or pass regions/rival
  // to copy a draw, e.g. co-op's player runs), or a legacy 'kanto' / 'hoenn' world (old saves and tests).
  static create({ starter = 'CHARMANDER', ascension = 0, seed = null, world = 'kanto', shiny = false, coop = false, pool = null, regions = null, rival = null } = {}) {
    const r = new Run();
    r.seed = seed || randomSeedString();
    r.rng = new RNG(r.seed);
    r.ascension = ascension;
    r.world = world;
    r.starter = starter;
    if (world === SPIRE) {
      r.regions = validSpire(regions) ? JSON.parse(JSON.stringify(regions)) : drawSpire(r.seed, pool || ['kanto']);
      r.rival = rival || rivalFor(starter);
    }
    if (coop) r.coop = true;
    r.actIndex = 0;
    r.party = [];
    r.relics = [];
    r.badges = [];
    r.consumables = [];
    r.balls = { POKE_BALL: ascension >= 4 ? 3 : 5 };
    r.money = ascension >= 4 ? 400 : 1000;
    r.comboLevels = {};
    r.comboPlays = {};
    r.stats = { battles: 0, trainers: 0, wild: 0, caught: 0, bestHand: 0, faints: 0, crits: 0, floors: 0, moneyEarned: 0, elites: 0, bosses: 0, startTime: Date.now() };
    r.seen = [];
    r.caughtSpecies = [];
    r.usedTrainers = [];
    r.log = [];
    r.flags = {}; // story threads across acts ("?" events: the OLD AMBER, TEAM ROCKET, ...), saved with the run
    r.maxConsumables = 3;
    r.gauntletIndex = -1;
    r.finished = false;
    r.victory = false;
    r.moveOffers = {}; // uid -> { move: times offered } (move rewards: repeats weigh less)
    const st = STARTERS.find(s => s.species === starter) || STARTERS[1];
    const lucky = r.rng.chance(1 / 64); // (rolled either way, so picking the shiny form doesn't change the run)
    const mon = makeMon(st.species, 6, { rng: r.rng, moves: st.moves.filter(m => D.moves[m]), minIV: 10, shiny: shiny || lucky });
    // The starter's attack moves begin with 3 cards so the deck is bigger than the hand.
    for (const mv of mon.moves) if (D.moves[mv.move]?.power) mv.copies = defaultCopies(mv.move) + DECK_RULES.starterBonus;
    r.party.push(mon);
    r.addSeen(st.species, true);
    if (st.item && RELICS[st.item]) r.addRelic(st.item); // the starter's own held item (PIKACHU: LIGHT BALL)
    if (ascension < 4) r.consumables.push('POTION', 'POTION');
    r.startAct(0);
    return r;
  }

  get acts() { return actsForRun(this); }
  get act() { return this.acts[this.actIndex]; }
  // The region of the current act (game/regions.js), the rival's home region and the ELITE FOUR's region.
  get region() { return this.act?.region || 'kanto'; }
  get rivalRegion() { return this.rival || this.region; } // (legacy worlds: the world's own rival)
  get summitRegion() { return this.act?.summit || this.region; }
  // JOHTO acts: 'morn' | 'day' | 'nite' by the floor (regions.js timeOfDay), null in regions without day and night.
  timeOfDay(floor = this.floor) { return regionOf(this.region).dayNight ? timeOfDay(floor, this.act.floors) : null; }

  startAct(i) {
    this.actIndex = i;
    const act = this.act;
    this.map = generateMap(this.rng.fork('map' + i), act, this.ascension);
    this.nodeId = null;
    this.floor = -1;
    this.boss = act.bosses ? this.rng.pick(act.bosses) : null;
    this.gauntletIndex = -1;
    if (this.mods().parcel) this.balls.POKE_BALL = (this.balls.POKE_BALL || 0) + 3;
  }

  // ---- modifiers ------------------------------------------------------------------------
  mods() {
    const m = {};
    const add = (o) => { for (const [k, v] of Object.entries(o || {})) m[k] = (m[k] || 0) + v; };
    for (const r of this.relics) add(RELICS[r.key]?.mods);
    for (const b of this.badges) add(BADGES[b]?.mods);
    if (this.ascension >= 10 && this.actIndex >= 1) m.dmgTaken = (m.dmgTaken || 0) + 0.15;
    return m;
  }
  hasRelic(key) { return this.relics.some(r => r.key === key); }
  addRelic(key) {
    if (this.hasRelic(key)) return false; // no cap on held items
    this.relics.push({ key, state: {} });
    if (key === 'BICYCLE') {} // mods handle it
    return true;
  }
  removeRelic(key) { this.relics = this.relics.filter(r => r.key !== key); }
  // Curse held items (v0.0.7): a POKéMON CENTER's CLEANSE removes one for a fee.
  curses() { return this.relics.filter(r => RELICS[r.key]?.curse).map(r => r.key); }
  cleanseCost() { return this.price(800); }
  cleanse(key) {
    if (!RELICS[key]?.curse || !this.hasRelic(key) || this.money < this.cleanseCost()) return false;
    this.money -= this.cleanseCost();
    this.removeRelic(key);
    this.logEvent({ k: 'cleanse', item: key, at: 'center' });
    return true;
  }

  priceMult() { return Math.max(0.3, (1 + TUNING.shopActScale * this.actIndex) * (1 + (this.mods().priceMult || 0) + (this.ascension >= 4 ? 0.25 : 0))); }
  price(base) { return Math.max(1, Math.round(base * this.priceMult() / 10) * 10); }

  hasConsumable(key) { return this.consumables.includes(key); }
  addConsumable(key) {
    if (BALLS[key]) { this.balls[key] = (this.balls[key] || 0) + 1; return true; }
    if (this.consumables.length >= this.maxConsumables) return false;
    this.consumables.push(key);
    return true;
  }
  useConsumable(key) { const i = this.consumables.indexOf(key); if (i >= 0) this.consumables.splice(i, 1); }

  // ---- full bag: a found/bought item is never silently thrown away -----------------------------
  // Every source that can fail (rewards, item balls, events, the MART) opens the bag-full picker
  // (scenes/items_ui.js offerItem) or, for bots, calls gainItem(): use the new item now, use or sell
  // a bag item to make room, or leave the new one behind on purpose.
  bagFull() { return this.consumables.length >= this.maxConsumables; }
  // What a bag item sells for at a counter (NUGGET-style items: their full value; others half price).
  sellValue(key) { const d = CONSUMABLES[key]; return d ? (d.sell || Math.floor((d.price || 0) / 2)) : 0; }
  // Sells (or tosses, when it's worth $0) one bag copy of key. Returns the money gained, or -1 if absent.
  sellConsumable(key) {
    if (!this.hasConsumable(key)) return -1;
    const v = this.sellValue(key);
    this.useConsumable(key);
    this.money += v;
    return v;
  }
  // How much a bag slot holding key is worth keeping (bots: lowest goes first).
  bagValue(key) {
    const d = CONSUMABLES[key];
    if (!d) return 0;
    if (d.sell) return d.sell;
    let v = d.price || 0;
    if (d.combo) v = Math.max(v, 2400);
    if (d.revive || d.reviveAll) v *= 1.3;
    return v;
  }
  // Why key can't be used on mon outside battle right now (null = it can). Mirrors applyConsumableToMon.
  useBlocker(key, mon) {
    const d = CONSUMABLES[key];
    if (!d || d.battleOnly || d.flee || d.sell || d.combo || d.reviveAll || d.addCopy) return 'No effect';
    if (d.target === 'monFainted' || d.revive) return isFainted(mon) && !mon.lost ? null : 'Not fainted';
    if (isFainted(mon)) return 'Fainted';
    if (d.evo) return itemEvolution(mon, key) ? null : 'No effect';
    if (d.relearn) return this.relearnable(mon).length ? null : 'Nothing to remember';
    if (d.levels) return mon.level >= 100 ? 'Max level' : null;
    const hurt = mon.hp < maxHp(mon);
    const cures = d.cure && mon.status && (d.cure === true || d.cure === mon.status || (d.cure === 'PSN' && mon.status === 'TOX'));
    if (d.heal || d.healFrac) return hurt || cures ? null : 'HP is full';
    if (d.cure) return cures ? null : 'No status';
    return 'No effect';
  }
  relearnable(mon) { return [...new Set((D.species[mon.species]?.learnset || []).filter(([l, m]) => l <= mon.level && !knowsMove(mon, m) && D.moves[m] && !NO_PLAYER_MOVES.has(m)).map(([, m]) => m))]; }
  // Can key be used outside battle right now (on someone in the party, or without a target)?
  canUseNow(key) {
    const d = CONSUMABLES[key];
    if (!d || d.battleOnly || d.flee) return false;
    if (d.combo || d.sell) return true;
    if (d.reviveAll) return this.party.some(m => isFainted(m) && !m.lost);
    if (d.addCopy) return this.party.some(m => m.moves.length);
    return this.party.some(m => !this.useBlocker(key, m));
  }
  // Uses key outside battle on the best target, for bots and tests (the UI lets the player pick).
  // Only applies the effect: the caller removes it from the bag if it came from there. Level-ups
  // and evolutions are left in pendingLevelEvents / pendingEvolution like applyConsumableToMon does.
  autoUse(key) {
    const d = CONSUMABLES[key];
    if (!d || !this.canUseNow(key)) return false;
    if (d.combo || d.sell || d.reviveAll) return this.applyConsumableToMon(key, null);
    if (d.addCopy) {
      const m = this.party.find(x => !isFainted(x)) || this.party[0];
      const best = m.moves.map((mv, i) => [D.moves[mv.move]?.power || 0, i]).sort((a, b) => b[0] - a[0])[0];
      if (!best) return false;
      m.moves[best[1]].copies = (m.moves[best[1]].copies || 1) + d.addCopy;
      return true;
    }
    if (d.relearn) return false; // needs a move choice: the player's call
    const ok = this.party.filter(m => !this.useBlocker(key, m));
    const by = (f) => ok.sort((a, b) => f(b) - f(a))[0];
    const mon = d.levels ? by(m => m.level) : d.revive ? by(m => m.level) : (d.heal || d.healFrac) ? by(m => maxHp(m) - m.hp) : ok[0];
    return !!mon && this.applyConsumableToMon(key, mon);
  }
  // Bot / default policy for a found item when the bag is full. Returns one of
  // { do: 'store' } (there's room), { do: 'useNew' }, { do: 'useBag', key }, { do: 'sellBag', key }, { do: 'leave' }.
  planRoom(key) {
    if (BALLS[key] || !this.bagFull()) return { do: 'store' };
    const anytime = (k) => { const d = CONSUMABLES[k]; return !!d && !!(d.combo || d.sell || d.levels || d.addCopy || d.evo || d.reviveAll) && this.canUseNow(k); };
    if (anytime(key)) return { do: 'useNew' };
    const spend = this.consumables.find(anytime);
    if (spend) return { do: 'useBag', key: spend };
    const worst = [...this.consumables].sort((a, b) => this.bagValue(a) - this.bagValue(b))[0];
    if (this.bagValue(key) <= this.bagValue(worst)) return this.canUseNow(key) && !CONSUMABLES[key]?.relearn ? { do: 'useNew' } : { do: 'leave' };
    return this.canUseNow(worst) && !CONSUMABLES[worst]?.relearn ? { do: 'useBag', key: worst } : { do: 'sellBag', key: worst };
  }
  // Gains a found item, making room by planRoom() when the bag is full (bots; the UI asks the player).
  // use(key) applies an item's effect (default autoUse) and returns true if it was used.
  // Returns 'stored' | 'used' | 'left' (left only when the new item is the least valuable and unusable).
  gainItem(key, { use = (k) => this.autoUse(k) } = {}) {
    if (this.addConsumable(key)) return 'stored';
    const plan = this.planRoom(key);
    let res = 'left';
    if (plan.do === 'useNew') res = use(key) ? 'used' : 'left';
    else if (plan.do === 'useBag' || plan.do === 'sellBag') {
      if (plan.do === 'useBag' && use(plan.key)) this.useConsumable(plan.key);
      else this.sellConsumable(plan.key);
      res = this.addConsumable(key) ? 'stored' : 'left';
    }
    this.logBagFull(key, res, plan.key);
    return res;
  }
  logBagFull(item, did, other) { this.logEvent({ k: 'bagFull', item, did, ...(other ? { other } : {}) }); }

  totalBalls() { return Object.values(this.balls).reduce((a, b) => a + b, 0); }

  // Gen 3: a NINCADA that evolves leaves a SHEDINJA behind if the party has room.
  shedinjaFrom(mon) {
    if (this.party.length >= 6 || !D.species.SHEDINJA) return null;
    const s = makeMon('SHEDINJA', mon.level, { rng: this.rng, caughtAct: this.actIndex });
    this.party.push(s);
    this.addSeen('SHEDINJA', true);
    return s;
  }

  addMoney(n) { this.money += n; if (n > 0) this.stats.moneyEarned += n; }

  // ---- Nuzlocke (A8+, solo only) -----------------------------------------------------------
  get nuzlocke() { return this.ascension >= NUZLOCKE_ASC && !this.coop; }
  // Releases every POKéMON that fainted in battle (Battle marks them mon.lost). Returns the released.
  releaseLost() {
    const lost = this.party.filter(m => m.lost);
    if (!lost.length) return [];
    this.party = this.party.filter(m => !m.lost);
    this.released ||= [];
    for (const m of lost) this.released.push(`${m.species}:${m.level}`);
    this.logEvent({ k: 'released', mons: lost.map(m => m.species) });
    return lost;
  }
  // Is this the act's first wild battle (the only one you may catch from under Nuzlocke rules)?
  nuzlockeFirstWild(nodeId) {
    this.nuzEnc ||= {};
    const a = String(this.actIndex);
    if (this.nuzEnc[a] === undefined) this.nuzEnc[a] = nodeId;
    return this.nuzEnc[a] === nodeId;
  }

  addSeen(species, caught) {
    if (!this.seen.includes(species)) this.seen.push(species);
    if (caught && !this.caughtSpecies.includes(species)) this.caughtSpecies.push(species);
  }

  aliveParty() { return this.party.filter(m => !isFainted(m)); }

  // Apply a consumable to a Pokémon (outside or inside battle). Returns true if used.
  applyConsumableToMon(key, mon, battle) {
    const def = CONSUMABLES[key];
    if (!def) return false;
    if (def.combo) { this.comboLevels[def.combo] = (this.comboLevels[def.combo] || 1) + 1; return true; }
    if (def.sell) { this.addMoney(def.sell); return true; }
    if (def.reviveAll) { let any = false; for (const m of this.party) if (isFainted(m) && !m.lost) { m.hp = maxHp(m); any = true; } return any; }
    if (!mon) return false;
    if (def.revive) { if (!isFainted(mon) || mon.lost) return false; mon.hp = Math.max(1, Math.floor(maxHp(mon) * def.revive)); return true; }
    if (isFainted(mon)) return false;
    let used = false;
    if (def.heal || def.healFrac) {
      if (mon.hp < maxHp(mon)) { mon.hp = Math.min(maxHp(mon), mon.hp + (def.heal || Math.floor(maxHp(mon) * def.healFrac))); used = true; }
    }
    if (def.cure) {
      if (mon.status && (def.cure === true || def.cure === mon.status || (def.cure === 'PSN' && mon.status === 'TOX'))) { mon.status = null; used = true; }
      if (def.cure === true && battle && battle.sides.player.confused && mon.uid === battle.leadUid) { battle.sides.player.confused = 0; used = true; }
    }
    if (def.levels) { this.pendingLevelEvents = { mon, events: addLevels(mon, def.levels) }; used = true; }
    if (def.evo) { const into = itemEvolution(mon, key); if (!into) return false; this.pendingEvolution = { mon, into }; used = true; }
    return used;
  }

  // ---- levels & curves ------------------------------------------------------------------
  levelFor(floor) {
    const act = this.act;
    const t = Math.max(0, Math.min(1, floor / Math.max(1, act.floors - 1)));
    let lvl = Math.round(act.levels[0] + (act.levels[1] - act.levels[0]) * t);
    if (this.ascension >= 2) lvl += 1;
    if (this.ascension >= 10 && this.actIndex >= 1) lvl += 1;
    return lvl;
  }

  hpScaleFor(floor, kind) {
    const [a, b] = TUNING.hpScale[Math.min(this.actIndex, TUNING.hpScale.length - 1)];
    const t = Math.max(0, Math.min(1, floor / Math.max(1, this.act.floors - 1)));
    let s = a + (b - a) * t;
    s *= TUNING.kindHp[kind] || 1;
    if (this.ascension >= 1 && (kind === 'elite' || kind === 'legend')) s *= 1.1;
    if (this.ascension >= 3 && kind === 'boss') s *= 1.1;
    if (this.ascension >= 7) s *= 1.15;
    const wh = TUNING.worldScale[this.region]?.hp || 1;
    s *= Array.isArray(wh) ? wh[Math.min(this.actIndex, wh.length - 1)] : wh;
    return s * (TUNING.hpMult ?? 1);
  }

  dmgScale() {
    let s = TUNING.dmgScale[Math.min(this.actIndex, TUNING.dmgScale.length - 1)];
    s *= TUNING.worldScale[this.region]?.dmg || 1;
    return s * (TUNING.dmgMult ?? 1);
  }

  // ---- encounters -----------------------------------------------------------------------
  battleConfig(node) {
    const kind = node.type;
    const rng = this.rng.fork('enc' + node.id + ':' + this.actIndex);
    const floor = node.floor;
    if (kind === 'wild') {
      const cfg = this.wildConfig(rng, floor);
      if (this.nuzlocke) cfg.nuzFirst = this.nuzlockeFirstWild(node.id);
      return cfg;
    }
    if (kind === 'rival') return this.rivalConfig(rng, floor);
    if (kind === 'legend') return this.legendConfig(rng, floor, node.legend || this.act.bird);
    if (kind === 'trainer') return this.trainerConfig(rng, floor);
    if (kind === 'elite') return this.eliteConfig(rng, floor);
    if (kind === 'boss' && this.act.gauntlet) { this.gauntletIndex = 0; return this.gauntletConfig(rng, 0); }
    if (kind === 'boss') return this.bossConfig(rng);
    if (kind === 'gauntlet') return this.gauntletConfig(rng, this.gauntletIndex);
    return null;
  }

  areaFor(rng, floor) {
    const act = this.act;
    const prog = floor / act.floors;
    const avail = act.areas.filter(a => a.from <= prog + 0.001 && (a.pool || D.encounters[a.map]));
    // Prefer the newest areas.
    return rng.weighted(avail, a => 1 + a.from * 4);
  }

  wildConfig(rng, floor, forced) {
    const area = this.areaFor(rng, floor);
    let pick = forced;
    if (!pick) {
      // No repeats: a POKéMON you've already battled in the wild this run isn't offered again (its evolution
      // line still can be: after a WEEDLE you may meet a KAKUNA)
      // (this area first, then any open area of the act; only if everything is used up can it repeat).
      const seen = new Set(this.wildSeen || []);
      // what a pick would show up as at this floor's level (low-level picks evolve far past their evolution level)
      const baseLvl = this.levelFor(floor);
      const shownAs = (sp) => { const evo = D.species[sp]?.evolutions?.find(e => e.method === 'LEVEL'); return evo && baseLvl >= evo.param + 6 && D.species[evo.into] ? evo.into : sp; };
      const tod = this.timeOfDay(floor);
      const speciesOf = (a) => {
        if (a.pool) return areaPool(a, tod).filter(sp => D.species[sp]).map(sp => ({ species: sp, rate: 1 }));
        const enc = D.encounters[a.map] || {};
        return (enc.land && enc.land.length ? enc.land : enc.water || enc.fishing || []).filter(e => D.species[e.species]);
      };
      const fresh = (list) => list.filter(e => !seen.has(shownAs(e.species)));
      const prog = floor / this.act.floors;
      const open = this.act.areas.filter(a => a.from <= prog + 0.001 && (a.pool || D.encounters[a.map]));
      let pool = fresh(speciesOf(area));
      if (!pool.length) pool = fresh(open.flatMap(speciesOf));
      if (!pool.length) pool = speciesOf(area);
      pick = rng.weighted(pool, e => e.rate || 1).species;
    }
    let lvl = this.levelFor(floor) + rng.int(-1, 1);
    // Wild Pokémon evolve if their level would be far past their evolution (keeps later areas fresh).
    let species = pick;
    const evo = D.species[species].evolutions?.find(e => e.method === 'LEVEL');
    if (evo && lvl >= evo.param + 6 && D.species[evo.into]) species = evo.into;
    const enemy = makeEnemy(species, Math.max(2, lvl), { rng, hpScale: this.hpScaleFor(floor, 'wild') * (1 + (this.mods().wildHp || 0)), shiny: rng.chance(1 / 64) });
    enemy.wildBase = pick;
    const tod = this.timeOfDay(floor);
    return { kind: 'wild', enemies: [enemy], terrain: area.terrain, music: 'mus_vs_wild', areaName: area.name, dmgScale: this.dmgScale(), rng, ...(tod ? { timeOfDay: tod } : {}) };
  }

  trainerPool() {
    const act = this.act;
    const maps = new Set(act.trainerMaps);
    return Object.values(D.trainers).filter(t => !t.dummy && t.party?.length && (t.maps || []).some(m => maps.has(m)) &&
      !['LEADER', 'ELITE_FOUR', 'CHAMPION', 'RIVAL_EARLY', 'RIVAL_LATE', 'BOSS'].includes(t.class) && !/RIVAL|LEADER|ELITE_FOUR|CHAMPION|BOSS/.test(t.key) && !t.rematchOf && !/_\d$/.test(t.key.replace(/GRUNT_\d+$/, '')));
  }

  partyCap(floor) {
    const a = this.actIndex;
    if (a === 0) return floor < 5 ? 2 : 3;
    if (a === 1) return floor < 6 ? 3 : 4;
    if (a === 2) return 4;
    return 5;
  }

  makeTrainerEnemies(rng, t, targetLevel, kind, cap, opts = {}) {
    let party = t.party.slice();
    if (cap && party.length > cap) party = party.slice(party.length - cap);
    const maxL = Math.max(...party.map(p => p.level));
    const hpPer = this.hpScaleFor(opts.floor ?? 0, kind) * (kind === 'boss' ? TUNING.bossPartyHp : TUNING.partyHp)[Math.min(5, party.length - 1)] * (opts.hpMult || 1);
    if (this.ascension >= 6 && (kind === 'trainer' || kind === 'elite') && party.length < 6 && (this.actIndex >= 1 || (opts.floor ?? 0) >= 8)) {
      const pool = this.act.areas.flatMap(a => areaPool(a) || (D.encounters[a.map]?.land || []).map(e => e.species)).filter(sp => D.species[sp]);
      if (pool.length) party = [{ species: rng.pick(pool), level: maxL - 1, iv: 120, moves: null, noExp: true }, ...party];
    }
    return party.map((p, i) => {
      const lvl = Math.max(2, targetLevel + (p.level - maxL));
      let species = p.species;
      const moves = p.moves && p.moves.length ? p.moves : null;
      const en = makeEnemy(species, lvl, { rng, moves: moves || defaultMoves(species, lvl), hpScale: hpPer, isBoss: kind === 'boss', isElite: kind === 'elite', bossRule: opts.rules ? opts.rules[i] : opts.rule || null, ivs: p.iv ? ivsFrom(p.iv) : null });
      if (p.noExp) en.noExp = true;
      return en;
    });
  }

  trainerInfo(t) {
    const cls = D.trainerClasses[t.class] || {};
    const name = /^(RIVAL_|CHAMPION_FIRST)/.test(t.key || '') ? 'BLUE' : t.name; // FireRed's default rival name is TERRY
    return { key: t.key, name, className: t.className, title: `${t.className} ${name}`.trim(), pic: t.pic, money: cls.money || 10, battleSong: (t.battleSong || 'MUS_VS_TRAINER').toLowerCase(), encounterSong: (t.encounterSong || '').toLowerCase() };
  }

  terrainForTrainer(t) {
    if (t.terrain) return t.terrain; // (authored JOHTO trainers name theirs)
    const m = (t.maps || [])[0] || '';
    if (/GYM|SSANNE|SILPH|MANSION|TOWER|HIDEOUT|DOJO|LEAGUE|WAREHOUSE|GAME_CORNER/.test(m)) return 'building';
    if (/CAVE|TUNNEL|MOON|VICTORY_ROAD|SEAFOAM|DIGLETT/.test(m)) return 'cave';
    if (/ROUTE19|ROUTE20|ROUTE21|WATER|BEACH|ISLAND$/.test(m)) return 'water';
    return 'grass';
  }

  // Generic trainer built from the act's wild pools (HOENN and JOHTO, whose trainers FireRed's data lacks). The
  // region's trainerClasses are FireRed trainer keys (class + pic) with names; JOHTO's draw the floor's time of day.
  genericTrainer(rng, floor, n, levelBonus = 0) {
    const [cls, names] = rng.pick(regionOf(this.region).trainerClasses || HOENN_TRAINER_CLASSES);
    const t = D.trainers[cls];
    const tod = this.timeOfDay(floor);
    const pool = this.act.areas.filter(a => a.from <= floor / this.act.floors + 0.001).flatMap(a => areaPool(a, tod) || []).filter(sp => D.species[sp]);
    const target = this.levelFor(floor) + 2 + levelBonus;
    const party = [];
    for (let i = 0; i < n; i++) {
      let sp = rng.pick(pool);
      const evo = D.species[sp].evolutions?.find(e => e.method === 'LEVEL');
      if (evo && target >= evo.param + 3 && D.species[evo.into]) sp = evo.into;
      party.push({ species: sp, level: Math.max(2, target - (n - 1 - i)), iv: 150, moves: null });
    }
    return { ...t, name: rng.pick(names), party, key: cls + ':' + rng.int(0, 9999) };
  }

  trainerConfig(rng, floor) {
    if (regionOf(this.region).genericTrainers) {
      const t = this.genericTrainer(rng, floor, rng.int(1, this.partyCap(floor)));
      const enemies = this.makeTrainerEnemies(rng, t, this.levelFor(floor) + 1, 'trainer', 6, { floor });
      return { kind: 'trainer', trainer: this.trainerInfo(t), enemies, terrain: this.areaFor(rng, floor).terrain, music: 'mus_vs_trainer', dmgScale: this.dmgScale(), rng };
    }
    let pool = this.trainerPool().filter(t => !this.usedTrainers.includes(t.key));
    if (!pool.length) pool = this.trainerPool();
    const target = this.levelFor(floor) + 1;
    const t = rng.weighted(pool, t => { const avg = t.party.reduce((a, p) => a + p.level, 0) / t.party.length; return 1 / (1 + Math.abs(avg - target)); });
    this.usedTrainers.push(t.key);
    const enemies = this.makeTrainerEnemies(rng, t, target, 'trainer', this.partyCap(floor), { floor });
    return { kind: 'trainer', trainer: this.trainerInfo(t), enemies, terrain: this.terrainForTrainer(t), music: this.trainerInfo(t).battleSong, dmgScale: this.dmgScale(), rng };
  }

  eliteConfig(rng, floor) {
    const act = this.act;
    const options = act.elites.filter(k => !this.usedTrainers.includes(k));
    let key = rng.pick(options.length ? options : act.elites);
    this.usedTrainers.push(key);
    const target = this.levelFor(floor) + 2;
    const asc9 = this.ascension >= 9 && this.actIndex >= 1;
    if (LEGENDS[key]) {
      const L = LEGENDS[key];
      const e = makeEnemy(L.species, target + 3 + (L.levelOffset || 0), { rng, hpScale: this.hpScaleFor(floor, 'legend'), isBoss: false, legendary: true, bossRule: asc9 ? 'LEGEND' : null, ivs: ivsFrom(200) });
      e.legendary = true;
      return { kind: 'wild', elite: true, enemies: [e], terrain: L.terrain, music: L.music, dmgScale: this.dmgScale() * 1.05, rng, legend: L.title };
    }
    const blue = key.startsWith('RIVAL_');
    if (blue) key = rivalKey(key, this.starter);
    let t = D.trainers[key] || D.trainers[rivalKey('RIVAL_CERULEAN', this.starter)];
    if (blue && t) t = { ...t, party: blueParty(t.party, this.starter) };
    if (t.dummy) t = { ...this.genericTrainer(rng, floor, Math.min(6, this.partyCap(floor) + 1), 2), name: t.name || 'ACE', pic: t.pic, className: t.className, class: t.class };
    const isRocket = /ROCKET|GIOVANNI/.test(t.key);
    const isRival = /RIVAL|^MAY|^SILVER/.test(t.key);
    let rule = isRival ? 'RIVAL' : isRocket && asc9 ? 'ROCKET' : null;
    if (asc9 && !rule) rule = rng.pick(ELITE_RULE_POOL);
    const enemies = this.makeTrainerEnemies(rng, t, target, 'elite', Math.min(6, this.partyCap(floor) + 1), { floor, rule });
    const info = this.trainerInfo(t);
    if (isRival) info.encounterSong = 'mus_encounter_rival';
    return { kind: 'elite', trainer: info, enemies, terrain: this.terrainForTrainer(t), music: info.battleSong, dmgScale: this.dmgScale() * 1.05, rng };
  }

  eliteConfigFromTrainer(rng, t) {
    const floor = Math.max(0, this.floor);
    const target = this.levelFor(floor) + 2;
    const isRocket = /ROCKET|GIOVANNI/.test(t.key);
    const rule = this.ascension >= 9 && this.actIndex >= 1 ? (isRocket ? 'ROCKET' : rng.pick(ELITE_RULE_POOL)) : null;
    const enemies = this.makeTrainerEnemies(rng, t, target, 'elite', Math.min(6, this.partyCap(floor) + 1), { floor, rule });
    const info = this.trainerInfo(t);
    return { kind: 'elite', trainer: info, enemies, terrain: this.terrainForTrainer(t), music: info.battleSong, dmgScale: this.dmgScale() * 1.05, rng };
  }

  // ---- rival (fixed floor) ------------------------------------------------------------------
  rivalTrainer() {
    const base = this.act.rival;
    if (!base) return null;
    const rr = this.rivalRegion;
    // BLUE's teams are FireRed trainers keyed by his starter; MAY's / SILVER's are authored with one starter line
    // (region.rival.line) and swapped
    const R = regionOf(rr).rival;
    if (!R.keyed) {
      const t = D.trainers[base];
      return t ? { ...t, party: rivalParty(t.party, counterStarter(this.starter, rr), R.line) } : null;
    }
    const t = D.trainers[rivalKey(base, this.starter)];
    return t ? { ...t, party: blueParty(t.party, this.starter) } : null;
  }

  rivalIntro(base, party) {
    const ace = party[party.length - 1];
    const R = speciesName(ace?.species || counterStarter(this.starter, this.rivalRegion)), S = speciesName(this.starter);
    return (RIVAL_INTROS[base] || []).map(l => l.split('{S}').join(S).split('{R}').join(R));
  }

  rivalConfig(rng, floor) {
    const t = this.rivalTrainer();
    if (!t) return this.eliteConfig(rng, floor);
    const cap = TUNING.rival.cap[Math.min(this.actIndex, TUNING.rival.cap.length - 1)];
    const target = this.levelFor(floor) + TUNING.rival.lvl;
    const enemies = this.makeTrainerEnemies(rng, t, target, 'rival', cap, { floor, rule: 'RIVAL', hpMult: TUNING.rival.hp[Math.min(this.actIndex, TUNING.rival.hp.length - 1)] });
    for (const e of enemies) e.isElite = true;
    const info = this.trainerInfo(t);
    info.encounterSong = regionOf(this.rivalRegion).rival.encounterSong;
    const shown = t.party.slice(Math.max(0, t.party.length - cap));
    return { kind: 'elite', rival: true, trainer: info, enemies, terrain: this.terrainForTrainer(t), music: 'mus_vs_trainer', dmgScale: this.dmgScale() * TUNING.rival.dmg, rng, moneyMult: 1.5, intro: this.rivalIntro(this.act.rival, shown) };
  }

  // ---- legendary bird node (optional) -----------------------------------------------------
  legendConfig(rng, floor, key) {
    const L = LEGENDS[key], B = BIRDS[key];
    if (!L || !B) return this.eliteConfig(rng, floor);
    const lvl = this.levelFor(floor) + TUNING.bird.lvl;
    const e = makeEnemy(L.species, lvl, { rng, hpScale: this.hpScaleFor(floor, 'legend') * TUNING.bird.hp[Math.min(this.actIndex, TUNING.bird.hp.length - 1)], isBoss: false, isElite: true, legendary: true, bossRule: 'LEGEND', ivs: ivsFrom(200) });
    e.legendary = true;
    const offer = !(this.legendsCaught || []).includes(L.species) ? { species: L.species, key } : null;
    return { kind: 'elite', legendNode: key, enemies: [e], terrain: L.terrain, music: L.music, dmgScale: this.dmgScale() * TUNING.bird.dmg, rng, legend: L.title, rewardRelic: B.item, catchOffer: offer };
  }

  // The one-time catch offers of a won legendary battle: [{ species, key, ei }] (a co-op legendary node fields two
  // legendaries, cfg.catchOffers; you may catch one of them).
  legendOffers(cfg) { return cfg.catchOffers || (cfg.catchOffer ? [cfg.catchOffer] : []); }
  // Every legendary you could catch from this battle (the ones you haven't had yet), ready to join.
  legendCatches(cfg) { return this.legendOffers(cfg).map(o => this.legendCatch(cfg, o)).filter(Boolean); }
  // The legendary from a won bird battle, ready to join: at most your best POKéMON's level, with its deck.
  legendCatch(cfg, o = this.legendOffers(cfg)[0]) {
    if (!o || (this.legendsCaught || []).includes(o.species)) return null;
    const e = cfg.enemies[o.ei ?? 0] || cfg.enemies[0];
    const top = Math.max(5, ...this.party.map(m => m.level));
    const moves = (BIRDS[o.key]?.moves || []).filter(m => D.moves[m]);
    return makeMon(o.species, Math.min(e.level, top), { rng: this.rng.fork('legend' + o.species), ivs: e.ivs, moves: moves.length ? moves : null, caughtAct: this.actIndex, shiny: !!e.shiny });
  }
  // Takes (accept) or turns down the one-time catch; either way the offer is used up.
  takeLegend(mon, accept) {
    this.legendsCaught ||= [];
    if (!this.legendsCaught.includes(mon.species)) this.legendsCaught.push(mon.species);
    this.logEvent({ k: 'legendCatch', species: mon.species, took: !!accept });
    if (!accept) return false;
    this.addSeen(mon.species, true);
    this.stats.caught++;
    return true;
  }

  bossLevel() { return this.act.bossLevel + (this.ascension >= 3 ? (this.actIndex === 0 ? 1 : 2) : 0) + (this.ascension >= 10 && this.actIndex >= 1 ? 1 : 0); }

  bossConfig(rng) {
    const key = this.boss;
    if (LEGENDS[key]) {
      const L = LEGENDS[key];
      const e = makeEnemy(L.species, this.bossLevel(), { rng, hpScale: this.hpScaleFor(this.act.floors, 'legend') * 1.4, isBoss: true, legendary: true, bossRule: 'LEGEND', ivs: ivsFrom(255) });
      e.legendary = true;
      return { kind: 'boss', legendBoss: true, enemies: [e], terrain: L.terrain, music: L.music, dmgScale: this.dmgScale() * 1.1, rng, legend: L.title };
    }
    const t = D.trainers[key];
    const rule = t.rule || key.replace('LEADER_', '');
    const enemies = this.makeTrainerEnemies(rng, t, this.bossLevel(), 'boss', 6, { floor: this.act.floors, rule, hpMult: (TUNING.bossHpAct[this.actIndex] ?? 1) * (TUNING.bossHp[rule] ?? 1) });
    const info = this.trainerInfo(t);
    return { kind: 'boss', trainer: info, enemies, terrain: 'building', music: 'mus_vs_gym_leader', dmgScale: this.dmgScale() * 1.08, rng, bossRule: rule };
  }

  gauntletConfig(rng, i) {
    const act = this.act;
    let key = act.gauntlet[i];
    const champion = key === 'CHAMPION_FIRST' || key === 'RS_CHAMPION' || !!D.trainers[key]?.champion; // (JOHTO: CHAMPION_LANCE)
    if (key === 'CHAMPION_FIRST') key = rivalKey('CHAMPION_FIRST', this.starter);
    const championRival = act.gauntlet[i] === 'CHAMPION_FIRST';
    const t = championRival ? { ...D.trainers[key], party: blueParty(D.trainers[key].party, this.starter) } : D.trainers[key];
    const lvl = act.gauntletLevels[i] + (this.ascension >= 3 ? 2 : 0) + (this.ascension >= 10 ? 1 : 0);
    const rule = t.rule || (key === 'RS_CHAMPION' ? 'STEVEN' : champion ? null : key.replace('ELITE_FOUR_', ''));
    const rules = champion && !rule ? t.party.map(() => rng.pick(CHAMPION_RULE_POOL)) : null;
    const hp = TUNING.gauntletHp[i] * (TUNING.hpMult ?? 1) / this.hpScaleFor(act.floors, 'boss') * (act.summitHp ? act.summitHp[Math.min(i, act.summitHp.length - 1)] : regionOf(this.summitRegion).summit.hp);
    const enemies = this.makeTrainerEnemies(rng, t, lvl, 'boss', 6, { floor: act.floors, rule, rules, hpMult: hp * TUNING.kindHp.boss });
    const info = this.trainerInfo(t);
    if (champion) { info.title = `CHAMPION ${info.name}`; info.encounterSong = key === 'RS_CHAMPION' || t.champion ? 'mus_encounter_gym_leader' : 'mus_encounter_rival'; }
    const intro = championRival ? this.rivalIntro('CHAMPION_FIRST', t.party) : undefined;
    return { kind: 'boss', gauntlet: i, trainer: info, enemies, intro, terrain: 'building', music: champion ? 'mus_vs_champion' : 'mus_vs_gym_leader', dmgScale: this.dmgScale() * (champion ? 1.12 : 1.08) * (act.summitDmg ? act.summitDmg[Math.min(i, act.summitDmg.length - 1)] : 1), rng, bossRule: rule };
  }

  // ---- after battle ---------------------------------------------------------------------
  // A5+ (LEVEL_CAP_ASC): the act's level cap = its boss's top level + TUNING.levelCapOffset: the GYM LEADER's ace (or
  // the legendary / post-game boss), in the ELITE FOUR act the CHAMPION's, with the ascension level bonuses (A3, A10).
  // Battle EXP stops at the cap; RARE CANDY and other direct level-ups can still pass it. null below A5.
  levelCap() {
    if (this.ascension < LEVEL_CAP_ASC || !this.act) return null;
    const act = this.act;
    const top = act.gauntlet && act.gauntletLevels ? Math.max(...act.gauntletLevels) + (this.ascension >= 3 ? 2 : 0) + (this.ascension >= 10 ? 1 : 0) : this.bossLevel();
    return Math.min(100, top + TUNING.levelCapOffset);
  }

  // Distribute EXP: lead/participants full, bench half (Exp. Share: full), each share scaled by the recipient's level
  // against every defeated foe's (expLevelScale). POKéMON fainted when the battle ended get nothing (Gen 3), even if
  // revived since (result.fainted). A5+: a POKéMON stops at the level cap and the rest of its share is lost.
  // Returns [{mon, gained, events, before, scale, capped}] (scale: the level multiplier for the reward screen's
  // OVERLEVELED / UNDERLEVELED tag; capped: it hit / sits at the cap).
  distributeExp(result, battleKind) {
    const out = [];
    if (!result.exp) return out;
    const mods = this.mods();
    const total = result.exp * TUNING.expMult * (1 + (mods.expMult || 0)) * (this.ascension >= 2 ? 0.9 : 1);
    const fainted = result.fainted || [];
    const cap = this.levelCap();
    const room = (mon) => (cap === null ? Infinity : Math.max(0, expForLevel(D.species[mon.species].growthRate, cap) - mon.exp));
    const list = [];
    for (const mon of this.party) {
      if (isFainted(mon) || fainted.includes(mon.uid)) continue;
      const full = result.participants.includes(mon.uid) || mods.expShare;
      const scale = expShareScale(result.foes, mon.level);
      const share = Math.max(1, Math.floor(total * (full ? 1 : 0.5) * scale));
      const take = Math.min(share, room(mon));
      list.push({ mon, scale, take, over: share - take });
    }
    for (const e of list) {
      const before = e.mon.level, gained = e.take;
      const events = gained > 0 ? gainExp(e.mon, gained) : [];
      out.push({ mon: e.mon, gained, events, before, scale: e.scale, capped: e.over > 0 });
    }
    return out;
  }

  afterBattle(battle) {
    const r = battle.result;
    r.released = this.releaseLost();
    this.stats.battles++;
    if (battle.kind === 'wild') {
      this.stats.wild++;
      // remembered once the battle is over (so a reload mid-battle meets the same POKéMON)
      this.wildSeen ||= [];
      for (const e of battle.enemies) if (e.species && !this.wildSeen.includes(e.species)) this.wildSeen.push(e.species);
    }
    else this.stats.trainers++;
    if (battle.kind === 'elite') this.stats.elites++;
    if (battle.kind === 'boss') this.stats.bosses++;
    for (const e of battle.enemies) this.addSeen(e.species, false);
    const cfg = battle.cfg || {};
    let money = r.money;
    if (this.ascension >= 4) money = Math.floor(money * 0.8);
    if (cfg.noMoney) money = 0; // "?" event battles pay no money from act 4 on
    if (r.outcome === 'win' && cfg.winFlags) Object.assign(this.flags ||= {}, cfg.winFlags);
    this.addMoney(money);
    r.moneyFinal = money;
    const mods = this.mods();
    if (mods.interest) { const i = Math.min(250, Math.floor(this.money / 100) * 5); if (i) { this.addMoney(i); r.interest = i; } }
    if (r.caught) {
      const e = r.caught;
      const mon = makeMon(e.species, e.level, { rng: this.rng, ivs: e.ivs, moves: e.moves, shiny: e.shiny, caughtAct: this.actIndex });
      mon.hp = Math.max(1, Math.round(maxHp(mon) * Math.max(0.3, e.hp / e.maxHp)));
      mon.status = null;
      if (e.friend) friendCopy(mon, D.moves); // (KURT's FRIEND BALL)
      this.addSeen(e.species, true);
      this.stats.caught++;
      r.newMon = mon;
    }
    // ambient heal
    const heal = TUNING.postBattleHeal + (mods.postHeal || 0);
    if (heal > 0) for (const m of this.party) if (!isFainted(m)) healFrac(m, heal);
    // ROTTEN SHROOM (curse): the party loses HP after every battle (never below 1)
    if (mods.postHurt) for (const m of this.party) if (!isFainted(m)) m.hp = Math.max(1, m.hp - Math.floor(maxHp(m) * mods.postHurt));
    return r;
  }

  addToParty(mon) {
    if (this.party.length >= 6) return false;
    this.party.push(mon);
    return true;
  }

  // ---- rewards --------------------------------------------------------------------------
  // How many times `move` was offered to the mon `uid` this run (run.moveOffers; old saves get {} from upgradeJSON).
  moveOfferCount(uid, move) {
    const o = this.moveOffers?.[uid];
    return o && typeof o === 'object' && Number.isFinite(o[move]) ? o[move] : 0;
  }
  moveRewardChoices(rng, n = 3) {
    n += this.mods().moveChoices || 0;
    const cands = [];
    for (const mon of this.party) {
      for (const { move: m, fallback } of movePool(mon, this.actIndex)) {
        const mv = D.moves[m];
        const stab = typesOf(mon).includes(mv.type);
        const weakest = Math.min(...mon.moves.map(x => D.moves[x.move]?.power || 0));
        let w = 1;
        if (mv.power > 0) w += (mv.power / 40) * (stab ? 2 : 1);
        if (mv.power > weakest) w += 1;
        if (mv.power === 0) w = ['SWORDS_DANCE','THUNDER_WAVE','SLEEP_POWDER','HYPNOSIS','TOXIC','PROTECT','RECOVER','SOFT_BOILED','CALM_MIND','BULK_UP','DRAGON_DANCE','REFLECT','LIGHT_SCREEN','SPORE','LEECH_SEED','REST','AGILITY','GROWTH','WILL_O_WISP','STUN_SPORE','SING','CONFUSE_RAY','SUBSTITUTE'].includes(m) ? 1.2 : 0.25;
        if (fallback) w *= MOVE_POOL.fallbackWeight;
        // Seen it already: each earlier offer of this move to this mon quarters its weight.
        const seen = this.moveOfferCount(mon.uid, m);
        if (seen) w *= Math.pow(MOVE_POOL.repeatMult, seen);
        cands.push({ uid: mon.uid, move: m, w });
      }
    }
    const out = [];
    const usedMons = new Map();
    for (let i = 0; i < n && cands.length; i++) {
      const c = rng.weighted(cands, x => x.w / (1 + (usedMons.get(x.uid) || 0)));
      out.push({ uid: c.uid, move: c.move });
      usedMons.set(c.uid, (usedMons.get(c.uid) || 0) + 1);
      for (let j = cands.length - 1; j >= 0; j--) if (cands[j].move === c.move) cands.splice(j, 1);
    }
    if (out.length) {
      if (!this.moveOffers || typeof this.moveOffers !== 'object' || Array.isArray(this.moveOffers)) this.moveOffers = {};
      for (const { uid, move } of out) {
        let o = this.moveOffers[uid];
        if (!o || typeof o !== 'object' || Array.isArray(o)) o = this.moveOffers[uid] = {};
        o[move] = this.moveOfferCount(uid, move) + 1;
      }
    }
    return out;
  }

  relicChoices(rng, n = 3, weights = { common: 60, uncommon: 32, rare: 8 }, exclude = []) {
    n += this.mods().rewardChoices || 0;
    const deckTypes = new Map();
    for (const m of this.party) for (const mv of m.moves) { const d = D.moves[mv.move]; if (d?.power) deckTypes.set(d.type, (deckTypes.get(d.type) || 0) + (mv.copies || 1)); }
    const species = new Set(this.party.map(m => m.species));
    const useful = (r) => {
      if (r.boostType) return (deckTypes.get(r.boostType) || 0) >= 2;
      if (r.key === 'SEA_INCENSE') return (deckTypes.get('WATER') || 0) >= 2;
      if (r.key === 'SECRET_KEY' || r.key === 'SOOT_SACK') return (deckTypes.get('FIRE') || 0) >= 2;
      if (r.key === 'SILPH_SCOPE') return (deckTypes.get('GHOST') || 0) + (deckTypes.get('DARK') || 0) >= 2;
      if (r.key === 'LIGHT_BALL') return species.has('PIKACHU');
      if (r.key === 'THICK_CLUB') return species.has('CUBONE') || species.has('MAROWAK');
      if (r.key === 'LUCKY_PUNCH') return species.has('CHANSEY');
      if (r.key === 'STICK') return species.has('FARFETCHD');
      if (r.key === 'OLD_AMBER') return this.party.some(m => typesOf(m).includes('ROCK'));
      if (r.key === 'WAILMER_PAIL') return (deckTypes.get('GRASS') || 0) >= 2;
      if (r.key === 'SOUL_DEW') return (deckTypes.get('PSYCHIC') || 0) + (deckTypes.get('DRAGON') || 0) >= 2;
      if (r.key === 'RUBY') return (deckTypes.get('FIRE') || 0) + (deckTypes.get('FIGHTING') || 0) + (deckTypes.get('ROCK') || 0) >= 2;
      if (r.key === 'SAPPHIRE') return (deckTypes.get('WATER') || 0) + (deckTypes.get('ICE') || 0) + (deckTypes.get('PSYCHIC') || 0) >= 2;
      if (r.key === 'DRAGON_SCALE') return [...deckTypes.entries()].some(([t, n]) => t !== 'NORMAL' && n >= 4);
      if (r.key === 'EVERSTONE') return this.party.some(m => (D.species[m.species].evolutions || []).length);
      return true;
    };
    const pool = Object.values(RELICS).filter(r => !r.unique && !this.hasRelic(r.key) && !exclude.includes(r.key) && D.items[r.key] && useful(r));
    const out = [];
    for (let i = 0; i < n && pool.length; i++) {
      const rar = rng.weighted(Object.keys(weights), k => weights[k]);
      let opts = pool.filter(r => r.rarity === rar);
      if (!opts.length) opts = pool;
      const pick = rng.pick(opts);
      out.push(pick.key);
      pool.splice(pool.indexOf(pick), 1);
    }
    return out;
  }

  randomConsumable(rng, tier = this.actIndex) {
    const table = [
      ['POTION', 5], ['SUPER_POTION', 3 + tier], ['HYPER_POTION', tier], ['REVIVE', 2], ['FULL_HEAL', 1], ['X_ATTACK', 2], ['X_SPECIAL', 2],
      ['X_DEFEND', 1], ['DIRE_HIT', 1], ['RARE_CANDY', 2], ['PP_UP', 1.5], ['HP_UP', 1.2], ['PROTEIN', 1.2], ['IRON', 1], ['CALCIUM', 0.8],
      ['ZINC', 0.6], ['CARBOS', 0.4], ['RED_SHARD', 1], ['BLUE_SHARD', 0.6], ['ORAN_BERRY', 2], ['SITRUS_BERRY', 1.5],
      ['LUM_BERRY', 1], ['NUGGET', 0.5], ['MOON_STONE', 0.5], ['FIRE_STONE', 0.4], ['WATER_STONE', 0.4], ['THUNDER_STONE', 0.4], ['LEAF_STONE', 0.4],
      ['ESCAPE_ROPE', 0.6], ['HEART_SCALE', 0.6], ['MAX_REVIVE', tier * 0.3], ['FULL_RESTORE', tier * 0.4],
    ].filter(([k]) => D.items[k])
      // evolution stones only when someone in the party can use one
      .filter(([k]) => !k.endsWith('_STONE') || this.party.some(m => canUseStone(m.species, k)));
    return rng.weighted(table, x => x[1])[0];
  }

  randomBerry(rng) { return rng.pick(['ORAN_BERRY', 'SITRUS_BERRY', 'LUM_BERRY', 'CHESTO_BERRY', 'PECHA_BERRY', 'CHERI_BERRY', 'LIECHI_BERRY', 'SALAC_BERRY', 'PETAYA_BERRY']); }

  // ---- map navigation -------------------------------------------------------------------
  enterNode(id) {
    this.nodeId = id;
    const node = this.map.nodes[id];
    this.floor = node.floor;
    this.stats.floors++;
    return node;
  }

  // ---- run log: a compact record of how the run went, for balance analysis --------------
  // (tools/analyze_runs.mjs reads these; the bots in tests/ write the same format)
  logEvent(e) {
    if (!this.runLog) this.runLog = { v: 1, events: [] };
    if (this.runLog.events.length < 800) this.runLog.events.push({ a: this.actIndex + 1, f: this.floor, ...e });
  }

  teamHpFrac() {
    let hp = 0, max = 0;
    for (const m of this.party) { hp += Math.max(0, m.hp); max += maxHp(m); }
    return max ? +(hp / max).toFixed(2) : 0;
  }

  logBattle(b) {
    const cfg = b.cfg || {};
    const combos = {};
    for (const [k, n] of Object.entries(this.comboPlays || {})) { const d = n - (b.comboStart?.[k] || 0); if (d > 0) combos[k] = d; }
    this.logEvent({
      k: 'battle', kind: cfg.gauntlet !== undefined ? 'e4' : cfg.legendBoss ? 'legend' : cfg.elite ? 'elite' : b.kind,
      foe: cfg.trainer?.name || cfg.legend || cfg.enemies?.[0]?.species, rule: cfg.bossRule || null,
      foes: (cfg.enemies || []).map(e => `${e.species}:${e.level}`),
      party: this.party.map(m => `${m.species}:${m.level}`), lead: b.startLead,
      out: b.result?.outcome, t: b.turn, h: b.handsPlayed, hp0: b.hpStart, hp1: this.teamHpFrac(),
      faints: b.faintCount || 0, maxHit: b.maxHand || 0, combos, switches: b.switchCount || 0, discards: b.discardCount || 0,
      caught: b.result?.caught?.species || null,
    });
  }

  finishLog(result) {
    if (!this.runLog) this.runLog = { v: 1, events: [] };
    this.runLog.end = {
      result, version: VERSION, world: this.world, ...(this.regions ? { regions: spireCode(this.regions), summit: this.regions.summit, post: this.regions.post } : {}), asc: this.ascension, starter: this.starter, seed: String(this.seed),
      act: this.actIndex + 1, floor: this.floor, party: this.party.map(m => `${m.species}:${m.level}`),
      relics: this.relics.map(r => r.key), badges: [...this.badges], money: this.money,
      comboLevels: { ...this.comboLevels }, stats: { ...this.stats }, ms: Date.now() - (this.stats.startTime || Date.now()),
    };
    return this.runLog;
  }

  centerHeal() {
    for (const m of this.party) {
      if (isFainted(m)) m.hp = Math.max(1, Math.floor(maxHp(m) * 0.5));
      else m.hp = maxHp(m);
      m.status = null;
    }
  }

  nextActHeal() {
    this.logEvent({ k: 'actClear', hp: this.teamHpFrac() });
    for (const m of this.party) {
      m.hp = maxHp(m);
      m.status = null;
    }
  }

  // ---- persistence ----------------------------------------------------------------------
  toJSON() {
    const o = { ...this };
    o.rngState = this.rng.state;
    delete o.rng;
    delete o.pendingLevelEvents;
    delete o.pendingEvolution;
    return o;
  }
  // Saves from older versions (solo saves in localStorage / the cloud, co-op checkpoints): fills in fields that
  // newer code expects, in place. Only fields every Run.create() sets get a default, and only when missing, so a
  // save from this version comes out unchanged (same keys, same order: co-op checksums depend on that). Fields a
  // newer version no longer uses are left alone (nothing reads them). Add a default here with every new Run field.
  static upgradeJSON(o) {
    if (!o || typeof o !== 'object') return o;
    const def = (k, v) => { if (o[k] === undefined || o[k] === null && v !== null && typeof v === 'object') o[k] = v; };
    def('ascension', 0);
    def('world', 'kanto');
    def('actIndex', 0);
    def('party', []);
    def('relics', []);
    def('badges', []);
    def('consumables', []);
    def('balls', { POKE_BALL: 0 });
    def('money', 0);
    def('comboLevels', {});
    def('comboPlays', {});
    def('stats', {});
    for (const k of ['battles', 'trainers', 'wild', 'caught', 'bestHand', 'faints', 'crits', 'floors', 'moneyEarned', 'elites', 'bosses']) if (o.stats[k] === undefined) o.stats[k] = 0;
    def('seen', []);
    def('caughtSpecies', []);
    def('usedTrainers', []);
    def('log', []);
    def('flags', {});
    def('maxConsumables', 3);
    def('gauntletIndex', -1);
    def('finished', false);
    def('victory', false);
    def('moveOffers', {}); // (v0.3.7)
    if (typeof o.moveOffers !== 'object' || Array.isArray(o.moveOffers)) o.moveOffers = {};
    for (const x of o.relics) if (x && typeof x === 'object' && x.state === undefined) x.state = {};
    for (const m of o.party) {
      if (!m || typeof m !== 'object') continue;
      if (!Array.isArray(m.moves)) m.moves = [];
      for (const mv of m.moves) if (mv && mv.copies === undefined) mv.copies = defaultCopies(mv.move);
      if (m.status === undefined) m.status = null;
      if (m.item === undefined) m.item = null;
      if (m.caughtAct === undefined) m.caughtAct = 0;
      if (m.shiny === undefined) m.shiny = false;
    }
    return o;
  }
  static fromJSON(o) {
    Run.upgradeJSON(o);
    const r = Object.assign(new Run(), o);
    r.rng = new RNG(1);
    r.rng.state = Number.isFinite(o.rngState) ? o.rngState : 1;
    let maxUid = 0;
    for (const m of r.party) maxUid = Math.max(maxUid, m.uid);
    setUidCounter(maxUid + 1000);
    return r;
  }
}

// ---- move reward pools ----------------------------------------------------------------------
// The moves a mon can be offered: its own level-up (up to 5 levels ahead), TM/HM and tutor moves, plus its
// evolution line's level-up moves (pre-evolutions, and evolutions; past a branching evolution such as EEVEE's
// only moves of the mon's own types or NORMAL). Thin pools (MAGIKARP, DITTO, UNOWN, the cocoons) top up from a
// per-type fallback list. Per call: the level gate, the act's power cap and the act gating of risky moves.
export const MOVE_POOL = {
  maxPower: [70, 90, 120, 150, 150], // per act
  lateMoves: ['SELFDESTRUCT', 'EXPLOSION', 'FOCUS_PUNCH'], // offered from act 3 on
  thinMoves: 8, thinAttacks: 3, // fewer eligible moves (or attacks) than this: add the fallback list
  fallbackWeight: 0.75, // fallback moves weigh less than the mon's own
  repeatMult: 0.25, // weight x this per earlier offer of the same move to the same mon
};
// Fallback moves per type (all with working effects here; no fixed/variable-power moves).
export const FALLBACK_MOVES = {
  NORMAL: ['TACKLE', 'QUICK_ATTACK', 'SWIFT', 'HEADBUTT', 'SECRET_POWER', 'SLASH', 'STRENGTH', 'BODY_SLAM', 'HYPER_VOICE', 'DOUBLE_EDGE'],
  FIRE: ['EMBER', 'FLAME_WHEEL', 'FIRE_FANG', 'FIRE_PUNCH', 'LAVA_PLUME', 'FLAMETHROWER', 'FIRE_BLAST'],
  WATER: ['WATER_GUN', 'AQUA_JET', 'WATER_PULSE', 'BUBBLE_BEAM', 'BRINE', 'WATERFALL', 'AQUA_TAIL', 'SURF', 'HYDRO_PUMP'],
  GRASS: ['MEGA_DRAIN', 'RAZOR_LEAF', 'MAGICAL_LEAF', 'GIGA_DRAIN', 'LEAF_BLADE', 'SEED_BOMB', 'ENERGY_BALL', 'STUN_SPORE'],
  ELECTRIC: ['THUNDER_SHOCK', 'SHOCK_WAVE', 'SPARK', 'THUNDER_FANG', 'THUNDER_PUNCH', 'DISCHARGE', 'THUNDERBOLT', 'THUNDER_WAVE'],
  ICE: ['POWDER_SNOW', 'ICE_SHARD', 'ICY_WIND', 'AURORA_BEAM', 'ICE_FANG', 'ICE_PUNCH', 'ICE_BEAM'],
  FIGHTING: ['KARATE_CHOP', 'FORCE_PALM', 'BRICK_BREAK', 'DRAIN_PUNCH', 'SKY_UPPERCUT', 'CROSS_CHOP', 'BULK_UP'],
  POISON: ['ACID', 'POISON_FANG', 'SLUDGE', 'POISON_JAB', 'SLUDGE_BOMB', 'TOXIC'],
  GROUND: ['MUD_SHOT', 'DIG', 'BONE_CLUB', 'MUD_BOMB', 'EARTH_POWER', 'EARTHQUAKE'],
  FLYING: ['GUST', 'WING_ATTACK', 'AERIAL_ACE', 'PLUCK', 'AIR_SLASH', 'DRILL_PECK'],
  PSYCHIC: ['CONFUSION', 'PSYBEAM', 'PSYCHO_CUT', 'EXTRASENSORY', 'ZEN_HEADBUTT', 'PSYCHIC', 'CALM_MIND'],
  BUG: ['BUG_BITE', 'SILVER_WIND', 'SIGNAL_BEAM', 'X_SCISSOR', 'BUG_BUZZ', 'MEGAHORN'],
  ROCK: ['ROCK_THROW', 'ROCK_TOMB', 'ANCIENT_POWER', 'ROCK_SLIDE', 'POWER_GEM', 'STONE_EDGE'],
  GHOST: ['ASTONISH', 'SHADOW_SNEAK', 'SHADOW_PUNCH', 'SHADOW_CLAW', 'SHADOW_BALL'],
  DRAGON: ['TWISTER', 'DRAGON_BREATH', 'DRAGON_CLAW', 'DRAGON_PULSE'],
  DARK: ['BITE', 'FAINT_ATTACK', 'PAYBACK', 'NIGHT_SLASH', 'CRUNCH', 'DARK_PULSE'],
  STEEL: ['METAL_CLAW', 'BULLET_PUNCH', 'STEEL_WING', 'IRON_HEAD', 'FLASH_CANNON', 'IRON_TAIL'],
};
const NORMAL_STAPLES = ['QUICK_ATTACK', 'HEADBUTT', 'BODY_SLAM']; // offered to every thin pool
// Species that copy moves (DITTO's TRANSFORM, SMEARGLE's SKETCH) also get coverage of every kind.
const COPYCAT_FALLBACK = ['WATER_PULSE', 'SHOCK_WAVE', 'AERIAL_ACE', 'ROCK_TOMB', 'BRICK_BREAK', 'FLAME_WHEEL', 'ICY_WIND', 'MAGICAL_LEAF',
  'SHADOW_PUNCH', 'BITE', 'FLAMETHROWER', 'THUNDERBOLT', 'ICE_BEAM', 'SURF', 'PSYCHIC', 'SHADOW_BALL'];
const COPYCATS = new Set(['DITTO', 'SMEARGLE']);
// Per species: [[level, move]] (own learnset + the evolution line's), TM/HM + tutor moves. Cached (keyed on the
// species object so a reloaded D rebuilds it).
const POOL_CACHE = new WeakMap();
function speciesPool(key) {
  const s = D.species[key];
  if (!s) return { levels: [], other: [] };
  if (POOL_CACHE.has(s)) return POOL_CACHE.get(s);
  const levels = (s.learnset || []).map(([l, m]) => [l, m]);
  const own = new Set(s.types || []);
  const add = (sp, filter) => { for (const [l, m] of D.species[sp]?.learnset || []) if (!filter || own.has(D.moves[m]?.type) || D.moves[m]?.type === 'NORMAL') levels.push([l, m]); };
  for (let k = key, i = 0; i < 4 && (k = familyParent(k)); i++) add(k, false); // pre-evolutions
  const down = (sp, branched, depth) => { // evolutions
    const evos = [...new Set((D.species[sp]?.evolutions || []).map(e => e.into))];
    for (const e of evos) if (D.species[e] && depth < 4) { add(e, branched || evos.length > 1); down(e, branched || evos.length > 1, depth + 1); }
  };
  down(key, false, 0);
  const pool = { levels, other: [...(s.tmhm || []), ...(s.tutor || [])] };
  POOL_CACHE.set(s, pool);
  return pool;
}
function familyParent(sp) { familyOf(sp); return PREVO[sp] || null; }
// The eligible reward moves for `mon` in act `actIndex`: [{ move, fallback }], never a move it knows.
export function movePool(mon, actIndex) {
  const maxPower = MOVE_POOL.maxPower[actIndex] ?? 150;
  const ok = (m) => { const mv = D.moves[m]; return mv && !knowsMove(mon, m) && !NO_PLAYER_MOVES.has(m) && !(mv.power > maxPower) && !(MOVE_POOL.lateMoves.includes(m) && actIndex < 2); };
  const out = [], seen = new Set();
  const push = (m, fallback) => { if (!seen.has(m)) { seen.add(m); if (ok(m)) out.push({ move: m, fallback }); } };
  const sp = speciesPool(mon.species);
  for (const [l, m] of sp.levels) if (l <= mon.level + 5) push(m, false);
  for (const m of sp.other) push(m, false);
  if (out.length < MOVE_POOL.thinMoves || out.filter(x => D.moves[x.move].power > 0).length < MOVE_POOL.thinAttacks) {
    for (const t of typesOf(mon)) for (const m of FALLBACK_MOVES[t] || []) push(m, true);
    for (const m of NORMAL_STAPLES) push(m, true);
    if (COPYCATS.has(mon.species)) for (const m of COPYCAT_FALLBACK) push(m, true);
  }
  return out;
}

function ivsFrom(iv) {
  const v = Math.round((iv || 0) * 31 / 255);
  return { hp: v, atk: v, def: v, spa: v, spd: v, spe: v };
}
