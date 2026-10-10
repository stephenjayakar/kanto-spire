// 2-4 smart bots driving a CoopGame purely through actions (votes, battle actions, privateDone snapshots).
// Reuses the solo smart bot (tests/bot.mjs) for hand evaluation and everything between battles.
import { D, bst } from '../web/src/game/data.js';
import { RNG } from '../web/src/game/rng.js';
import { maxHp, isFainted, addLevels, DECK_RULES } from '../web/src/game/pokemon.js';
import { CONSUMABLES, BADGES } from '../web/src/game/items.js';
import { TUNING } from '../web/src/game/run.js';
import { reachable } from '../web/src/game/map.js';
import { chooseHand, dryScore, matchup, planDiscard, postBattle, chooseNode, doShop, doEvent, doCenter, handleLevelEvents, teamHp, gainBotItem } from './bot.mjs';
import { CoopGame, badgeForBoss } from '../web/src/game/coop/coop.js';

export function makeBot(seed, p) { return { p, rng: new RNG(`${seed}:bot${p}`), battle: null, turn: -1, st: null, fails: 0 }; }

// The next action this bot wants to post, or null (nothing to do right now).
export function botAction(game, bot) {
  const p = bot.p;
  if (game.phase === 'map') return game.votes[p] === null ? voteAction(game, bot) : null;
  if (game.phase === 'battle') return battleAction(game, bot);
  if (game.phase === 'private') return game.private.done[p] ? null : privateAction(game, bot);
  return null;
}

// ---------------------------------------------------------------------------------------------- map
function voteAction(game, bot) {
  const p = bot.p, run = game.runs[p];
  const mine = chooseNode(run, bot.rng, 'smart');
  // (2 players: the partner's vote; 3-4: the most popular vote of the others, lowest slot first on a tie)
  const others = game.votes.filter((v, q) => q !== p && v !== null && !game.away?.[q]);
  const tally = new Map();
  for (const v of others) tally.set(v, (tally.get(v) || 0) + 1);
  const other = others.length ? [...tally.keys()].sort((a, b) => tally.get(b) - tally.get(a))[0] : null;
  // "Talk it over": go along with the partner unless this player really needs the Center.
  const needCenter = run.map.nodes[mine]?.type === 'center' && (teamHp(run) < 0.6 || run.party.some(isFainted));
  const node = other && reachable(run.map, run.nodeId).includes(other) && !needCenter && bot.rng.chance(0.85) ? other : mine;
  return { p, type: 'vote', node };
}

// ------------------------------------------------------------------------------------------- battle
const healItem = (run) => run.consumables.find(k => (CONSUMABLES[k]?.heal || CONSUMABLES[k]?.healFrac) && !CONSUMABLES[k]?.berry) || run.consumables.find(k => CONSUMABLES[k]?.heal || CONSUMABLES[k]?.healFrac);

function incomingOn(duo, p) {
  let sum = 0, max = 0;
  for (const it of duo.intents) if (it && it.target === p && it.damage) { sum += it.damage[1]; max = Math.max(max, it.damage[1]); }
  return { sum, max };
}

function bestBall(run, e) {
  const order = ['MASTER_BALL', 'ULTRA_BALL', 'GREAT_BALL', 'NET_BALL', 'DIVE_BALL', 'NEST_BALL', 'TIMER_BALL', 'REPEAT_BALL', 'POKE_BALL', 'PREMIER_BALL', 'LUXURY_BALL'];
  const owned = order.filter(k => run.balls[k] > 0);
  if (!owned.length) return null;
  if (owned[0] === 'MASTER_BALL' && !e.legendary) return owned[1] || null;
  return owned[0];
}

function wantCatch(run, e, s) {
  if (!run.totalBalls() || s?.legendBlocked?.(e)) return false; // (ONE LEGENDARY PER RUN; frozen engines have no such rule)
  const minB = Math.min(...run.party.map(m => bst(m.species)));
  if (run.party.length < 6) return run.party.length < 4 || bst(e.species) > minB + 20 || e.legendary;
  return e.legendary || bst(e.species) > minB + 60;
}

function battleAction(game, bot) {
  const duo = game.battle, p = bot.p;
  if (!duo || duo.result || duo.down[p] || duo.locks[p]) return null;
  if (bot.battle !== duo || bot.turn !== duo.turn) { bot.battle = duo; bot.turn = duo.turn; bot.st = { healed: 0, partner: 0, items: 0, revive: 0, switched: 0, dug: 0 }; bot.fails = 0; }
  const st = bot.st, s = duo.subs[p], run = s.run, lead = s.lead();
  const pass = { p, type: 'lock', pass: true };
  if (bot.fails >= 3) return pass;
  const extras = bot.fails === 0;
  const field = [0, 1].filter(sl => duo.field[sl] !== null);
  if (!field.length || !lead) return pass;
  const inc = incomingOn(duo, p);

  if (extras) {
    // Emergency: heal the lead or switch out when the next hits would KO it.
    if (!st.healed && (lead.hp <= inc.sum || lead.hp < maxHp(lead) * 0.25)) {
      st.healed = 1;
      const pot = healItem(run);
      if (pot && lead.hp < maxHp(lead) && (CONSUMABLES[pot].heal || Math.floor(maxHp(lead) * (CONSUMABLES[pot].healFrac || 0))) + lead.hp > inc.sum) return { p, type: 'item', key: pot, uid: lead.uid };
      if ((s.discardsLeft > 0 || s.freeSwitches > 0 || s.faintSwitch) && inc.sum > 0) {
        const opts = run.party.filter(m => !isFainted(m) && m.uid !== lead.uid).map(m => {
          let d = 0;
          duo.intents.forEach(it => { if (it && it.target === p && it.damage) d += s.withFocus(it.ri, () => s.enemyDamage(it.move, duo.enemies[it.ri], m, 1, false, true)); });
          return { m, d: d / m.hp };
        }).sort((x, y) => x.d - y.d);
        if (opts[0] && opts[0].d < 0.5 && opts[0].d < (inc.sum / lead.hp) * 0.6) { st.switched = 1; return { p, type: 'switch', uid: opts[0].m.uid }; }
      }
    }
    // Patch up a partner's lead when it's in danger and they have nothing to heal with.
    if (!st.partner) {
      st.partner = 1;
      for (const os of duo.subs) {
        const o = os.p, ol = os.lead();
        if (o === p || duo.away?.[o]) continue;
        if (!duo.down[o] && ol && !isFainted(ol) && !healItem(os.run)) {
          const oi = incomingOn(duo, o);
          const pot = healItem(run);
          if (pot && (ol.hp <= oi.sum || ol.hp < maxHp(ol) * 0.25) && lead.hp > maxHp(lead) * 0.5 && lead.hp > inc.sum * 1.5) return { p, type: 'item', key: pot, uid: ol.uid, toP: o };
        }
        // A downed partner comes back with a revive.
        if (duo.down[o]) {
          const rv = run.consumables.find(k => CONSUMABLES[k]?.revive);
          const fm = os.run.party.find(isFainted);
          if (rv && fm) return { p, type: 'item', key: rv, uid: fm.uid, toP: o };
        }
      }
    }
    // Battle items on bosses and elites at the start.
    if ((duo.kind === 'boss' || duo.kind === 'elite') && duo.turn === 1 && !st.items) {
      const k = run.consumables.find(k => CONSUMABLES[k]?.stage);
      if (k && s.handsPlayed === 0) return { p, type: 'item', key: k, uid: null };
      st.items = 1;
    }
    if (duo.kind === 'boss' && !st.revive) {
      st.revive = 1;
      const fm = run.party.find(isFainted), rv = run.consumables.find(k => CONSUMABLES[k]?.revive);
      if (fm && rv) return { p, type: 'item', key: rv, uid: fm.uid };
    }
    // Switch when another POKéMON's deck clearly fits the field better (or the lead can't act).
    if (!st.switched && (s.freeSwitches > 0 || s.discardsLeft > 0 || s.faintSwitch)) {
      st.switched = 1;
      const tgt = duo.field[field[0]];
      const stuck = !s.deck.hand.some(c => s.cardInfo(c).playable);
      const alts = run.party.filter(m => !isFainted(m) && m.uid !== lead.uid && !['SLP', 'FRZ'].includes(m.status) && m.hp / maxHp(m) > 0.35);
      if (alts.length) {
        const score = m => s.withFocus(tgt, () => matchup(s, m)) * (0.5 + 0.5 * m.hp / maxHp(m));
        const best = alts.sort((x, y) => score(y) - score(x))[0];
        const e = duo.enemies[tgt];
        if (stuck || (score(best) > score(lead) * 1.6 && e.hp > e.maxHp * 0.25)) return { p, type: 'switch', uid: best.uid };
      }
    }
  }

  // Catch a wild POKéMON worth having once it's weak.
  if (duo.kind === 'wild' && !s.caught) {
    for (const slot of field) {
      const e = duo.enemies[duo.field[slot]];
      if (duo.locks.some((pl, q) => q !== p && pl && pl.ball && duo.normSlot(pl.target) === slot)) continue;
      if (!wantCatch(run, e, s)) continue;
      const ball = bestBall(run, e), frac = e.hp / e.maxHp, mult = duo.cfg.catchMult || 1;
      if (ball && (frac < 0.45 || (e.status && frac < 0.7) || (D.species[e.species].catchRate * mult >= 180 && frac < (mult > 1 ? 1.01 : 0.8)))) return { p, type: 'lock', ball, target: slot };
    }
  }

  // Pick the target and the hand: evaluate the best hand against each foe, counting what the partner's
  // locked hand will already deal to it (so both don't overkill the same weak foe).
  const lockedOn = (slot) => duo.locks.some((L, q) => q !== p && L && L.ids && duo.normSlot(L.target) === slot);
  let best = null;
  for (const slot of field) {
    const ri = duo.field[slot], e = duo.enemies[ri];
    const partnerDmg = duo.lockedDamageOn(p, slot);
    const r = s.withFocus(ri, () => {
      const hp0 = e.hp;
      s._teamUp = lockedOn(slot);
      e.hp = Math.max(1, hp0 - partnerDmg);
      try {
        const c = chooseHand(s, 'smart');
        return { ...c, dmg: c.best ? dryScore(s, c.best) : 0, hpLeft: e.hp };
      } finally { e.hp = hp0; s._teamUp = false; }
    });
    if (!r.best) continue;
    let v = r.value;
    if (partnerDmg >= e.hp) v -= 1;
    const it = duo.intents[slot];
    if (it && it.target === p && it.damage) v += 0.15 * Math.min(2, it.damage[1] / Math.max(1, lead.hp));
    if (!best || v > best.v) best = { v, slot, ids: r.best, frac: r.dmg / r.hpLeft, ri };
  }
  if (!best) {
    if (extras && s.deck.hand.length && !st.dug) {
      // nothing damaging: a paid discard of up to 5 cards, else the turn's free discard (DECK_RULES.freeDiscard cards)
      const n = s.discardsLeft > 0 ? 5 : s.freeDiscardOk(1) ? DECK_RULES.freeDiscard : 0;
      if (n) { st.dug++; return { p, type: 'discard', ids: s.deck.hand.slice(0, n).map(c => c.id) }; }
    }
    return pass;
  }
  // Dig with discards like the solo smart bot: the expected-value planner (free discard each turn, paid
  // discards when the expected gain is worth one), against the chosen target.
  if (extras && st.dug < 6 && !s.caught) {
    const toss = s.withFocus(best.ri, () => planDiscard(s, best.ids));
    if (toss) { st.dug++; return { p, type: 'discard', ids: toss }; }
  }
  return { p, type: 'lock', ids: best.ids, target: best.slot };
}

// ------------------------------------------------------------------------------------------ private
function privateAction(game, bot) {
  const p = bot.p, kind = game.private.kind;
  const run = game.privateRunClone(p);
  const rng = run.rng.fork('bot' + game.seq + ':' + p);
  if (kind === 'reward') {
    const b = game.battleSubs[p], cfg = game.battleCfg;
    postBattle(run, b, rng, 'smart');
    if (cfg.kind === 'boss' && cfg.gauntlet === undefined && !cfg.legendBoss) {
      const badge = badgeForBoss(run.boss);
      if (badge && !run.badges.includes(badge)) run.badges.push(badge);
    }
  } else if (kind === 'center') {
    const r = doCenter(run, 'smart');
    if (r.train) handleLevelEvents(run, [{ mon: r.train, events: addLevels(r.train, 3) }], 'smart');
  } else if (kind === 'mart' || kind === 'plateau') doShop(run, rng, 'smart');
  else if (kind === 'treasure') {
    gainBotItem(run, run.randomConsumable(rng, run.actIndex + 1), 'smart');
    const rel = rng.chance(TUNING.relicOdds.treasure) ? run.relicChoices(rng, 2, { common: 40, uncommon: 45, rare: 15 }) : [];
    if (rel[0]) run.addRelic(rel[0]);
  } else if (kind === 'event') doEvent(run, rng, 'smart', null, game.sharedEvent?.node === game.world.nodeId ? game.sharedEvent.id : null); // the shared event (both players)
  // strongest healthy POKéMON leads into the next fight
  const lead = [...run.party].filter(m => !isFainted(m)).sort((a, b) => (b.level * 3 + b.hp / maxHp(b) * 20) - (a.level * 3 + a.hp / maxHp(a) * 20))[0];
  if (lead && run.party[0] !== lead) { run.party.splice(run.party.indexOf(lead), 1); run.party.unshift(lead); }
  return { p, type: 'privateDone', run: game.snapshotRun(run) };
}

// --------------------------------------------------------------------------------------------- driver
// Plays a whole co-op run with two bots. Every action goes through JSON (like the network) and gets the
// next seq. onAction(action, applied, game) is called after each one.
// champ: a player who has beaten a CHAMPION before posts { type: 'champ' } (v0.3.25: CERULEAN CAVE's MEWTWO can show up).
export function playCoop({ seed = 'COOP', ascension = 0, world = 'kanto', starters = ['BULBASAUR', 'CHARMANDER'], maxActions = 60000 * starters.length / 2, maxTurns = 80, onAction = null, stopWhen = null, champ = false } = {}) {
  const game = new CoopGame();
  const log = [];
  const post = (a) => {
    const act = JSON.parse(JSON.stringify({ ...a, seq: game.seq + 1, nonce: `n${game.seq + 1}` }));
    log.push(act);
    const ok = game.apply(act);
    if (onAction) onAction(act, ok, game);
    return ok;
  };
  post({ type: 'init', seed, ascension, world, starters, names: starters.map((_, p) => 'BOT' + (p + 1)) });
  if (champ) post({ p: 0, type: 'champ' });
  const bots = starters.map((_, p) => makeBot(seed, p));
  let n = 0;
  while (!['over', 'victory'].includes(game.phase) && n++ < maxActions) {
    if (stopWhen && stopWhen(game)) break;
    // like the solo bot's 80-turn guard: an unwinnable stalemate (e.g. an all-immune deck, no discards) counts as a loss
    if (game.phase === 'battle' && game.battle.turn > maxTurns) { game.stalemate = true; break; }
    let acted = false;
    for (const bot of bots) {
      const a = botAction(game, bot);
      if (!a) continue;
      if (!post(a)) bot.fails++;
      acted = true;
      break;
    }
    if (!acted) break;
  }
  return { game, log, bots };
}
