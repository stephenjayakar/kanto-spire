// Boss rules ("boss blinds"): each Gym Leader / Elite Four member bends the rules of the fight.
import { monName } from './pokemon.js';
import { D, typeEffect } from './data.js';
import { LEGENDS } from './acts.js';

export const BOSS_RULES = {
  BROCK: {
    name: 'ROCK SOLID', desc: 'Hands with fewer than 3 scoring cards deal half damage.',
    onScore(b, S) { if (S.scoring.length < 3) S.times(0.5, 'ROCK SOLID'); },
  },
  MISTY: {
    name: 'WHIRLPOOL', desc: 'After each hand, 1 random card in your hand is washed away.',
    afterHand(b) {
      if (!b.deck.hand.length) return;
      const c = b.rng.pick(b.deck.hand);
      b.deck.hand = b.deck.hand.filter(x => x !== c);
      b.deck.discard.push(c);
      b.emit({ t: 'discard', ids: [c.id], forced: true });
      b.msg('WHIRLPOOL washed a card away!');
    },
  },
  LT_SURGE: {
    name: 'OVERCHARGE', desc: 'The leftmost card of every hand you play is shocked and does nothing.',
    cardFilter(b, info, idx) { return idx === 0 ? 'SHOCKED' : null; },
  },
  ERIKA: {
    name: 'SLEEP POWDER', desc: "Each turn one random POKéMON on your bench is drowsy and can't act.",
    onTurnStart(b) {
      const alive = b.aliveParty().filter(m => m.uid !== b.leadUid);
      if (!alive.length) return;
      const m = b.rng.pick(alive);
      b.ms(m.uid).drowsy = true;
      b.msg(`${monName(m)} is drowsy from the SLEEP POWDER!`);
    },
  },
  KOGA: {
    name: 'TOXIC FOG', desc: 'Your lead is badly poisoned whenever it enters battle.',
    onLeadEnter(b, lead) { if (!lead.status) b.inflictStatus('player', 'TOX', 'TOXIC FOG', false, lead); },
  },
  SABRINA: {
    name: 'PSYCHIC VEIL', desc: 'Some cards are dealt face down.', faceDown: 0.25, // (v0.5.8: no more enemyDamageMult 0.85, it made her weaker)
  },
  BLAINE: {
    name: 'FIRE QUIZ', desc: '-1 hand size and -1 discard.', handSize: -1,
    onBattleStart(b) { b.discardsLeft = Math.max(0, b.discardsLeft - 1); b.msg('The heat makes it hard to think! (-1 discard)'); },
  },
  GIOVANNI: {
    name: 'EARTHQUAKE', desc: 'You must play at least 3 attack cards per hand (status cards do not count).',
    canPlay(b, infos) { return infos.filter(i => !i.status).length < 3 ? 'EARTHQUAKE: play at least 3 attack cards!' : null; },
  },
  LORELEI: {
    name: 'ICE BODY', desc: 'At the start of each turn 2 random cards in your hand freeze.',
    onTurnStart(b) {
      const pool = b.deck.hand.filter(c => !c.frozen);
      if (b.abOf?.('player') !== 'SUCTION_CUPS') for (const c of b.rng.sample(pool, Math.min(2, pool.length))) c.frozen = true;
      if (pool.length) b.msg('Two cards froze solid!');
    },
  },
  BRUNO: {
    name: 'FIGHTING SPIRIT', desc: "You can't play the same combo twice in a row (SINGLE is always allowed).",
    canPlay(b, infos) {
      if (!b.lastCombo) return null;
      const p = b.preview(infos.map(i => i.id));
      if (!p || p.key === 'SINGLE' || p.key === 'SUPPORT') return null;
      return p.key === b.lastCombo ? `FIGHTING SPIRIT: no ${p.name} twice in a row!` : null;
    },
  },
  AGATHA: {
    name: 'CURSE', desc: 'Every hand you play costs your lead 8% of its max HP.',
    afterHand(b) {
      const l = b.lead();
      if (l && l.hp > 0) { b.recoil('player', l, 0.08, 'CURSE', true); b.msg(`The CURSE saps ${monName(l)}!`); }
    },
  },
  LANCE: {
    name: 'DRAGON SCALES', desc: 'His POKéMON heal 8% of their max HP every turn.',
    onTurnEnd(b) { b.healEnemy(0.08); },
  },
  CHAMPION: {
    name: "CHAMPION'S WILL", desc: 'His team hits 15% harder and each POKéMON brings a different rule.',
    enemyDamageMult: 1.15,
  },
  // Elite rules (used for Rocket executives / rival, and on all elites at Ascension 9)
  ROCKET: {
    name: 'DIRTY TRICKS', desc: 'After each hand, 2 random cards in your hand are discarded.',
    afterHand(b) {
      for (let i = 0; i < 2 && b.deck.hand.length; i++) {
        const c = b.rng.pick(b.deck.hand);
        b.deck.hand = b.deck.hand.filter(x => x !== c); b.deck.discard.push(c);
        b.emit({ t: 'discard', ids: [c.id], forced: true });
      }
    },
  },
  RIVAL: {
    name: 'SMELL YA LATER', desc: 'Your first hand each battle deals half damage.',
    onScore(b, S) { if (b.handsPlayed === 0) S.times(0.5, 'SMELL YA LATER'); },
  },
  LEGEND: {
    name: 'PRESSURE', desc: 'Every hand you play also costs you 1 discard.',
    afterHand(b) { if (b.discardsLeft > 0) { b.discardsLeft--; b.msg('The PRESSURE is immense! (-1 discard)'); } },
  },
  // Mythic "?" events (v0.3.25, acts.js MYTHICS)
  MEWTWO: {
    name: 'PSYSTRIKE', desc: 'Every hand you play also costs you 1 discard. In co-op MEWTWO attacks EVERY player each turn.',
    afterHand(b) { if (b.discardsLeft > 0) { b.discardsLeft--; b.msg("MEWTWO's PRESSURE is immense! (-1 discard)"); } },
  },
  MEW: {
    name: 'HIDE AND SEEK', desc: 'MEW flees after 3 turns unless it is asleep or paralyzed. Throw a ball: it is easy to catch.',
    onTurnEnd(b) {
      const e = b.enemy();
      if (!e || e.hp <= 0 || b.turn < MEW_TURNS || e.status === 'SLP' || e.status === 'PAR') return;
      b.msg('MEW giggled and vanished!');
      b.end('enemyFled');
    },
  },
  DEOXYS: {
    name: 'FORME CHANGE', desc: 'DEOXYS switches forme every turn: ATTACK (hits much harder), DEFENSE (takes much less damage), SPEED (moves first).',
    // the forme follows the turn number, so applying it again (co-op: once per player) changes nothing
    onTurnStart(b) { deoxysForme(b, b.enemy()); },
  },
  // Hoenn leaders (post-game world)
  ROXANNE: { name: 'STURDY', desc: 'Her POKéMON survive the first knockout blow with 1 HP.', sturdy: true },
  // v0.5.3: was +1 every turn; co-op fights last longer per foe (more HP), so the boosts snowballed (gauntlet: solo 85% vs
  // co-op ~40%). Now every other turn, and every other turn per player in co-op.
  BRAWLY: { name: 'BULK UP', desc: 'His POKéMON gain +1 ATTACK every other turn (more slowly in co-op).',
    onTurnEnd(b) { const n = Math.max(1, b.duo ? b.duo.aliveSubs().length : 1); if (b.turn % (2 * n) === 0) b.addStage('enemy', 'atk', 1, 'BULK UP'); } },
  WATTSON: { name: 'MAGNET PULL', desc: 'Discarding costs your lead 5% HP.', },
  FLANNERY: { name: 'DROUGHT', desc: 'Harsh sunlight all battle. Your WATER cards are weakened.', onBattleStart(b) { b.setWeather('SUN', true); } },
  // v0.5.2: BALANCE replaced SLACK OFF (heal when a hand fell short, which out-healed co-op teams). Every hand is capped
  // instead (battle.js handCap): no one-shots, no healing, the same for each co-op player.
  NORMAN: { name: 'BALANCE', desc: "No single hand can deal more than 60% of his POKéMON's max HP.", handCap: 0.6 }, // (0.35 left solo at 30% wins vs ~91% for the other act 2 gyms: tests/boss_gauntlet.mjs)
  WINONA: { name: 'TAILWIND', desc: 'Her POKéMON always move first. -1 hand size.', handSize: -1 },
  TATE_LIZA: { name: 'TWIN MINDS', desc: 'Each hand must have exactly 2 or 4 cards.', canPlay(b, infos) { return infos.length === 2 || infos.length === 4 ? null : 'TWIN MINDS: play 2 or 4 cards!'; } },
  WALLACE: { name: 'RAIN DANCE', desc: 'Rain all battle and his POKéMON heal 6% each turn.', onBattleStart(b) { b.setWeather('RAIN', true); }, onTurnEnd(b) { b.healEnemy(0.06); } },
  SIDNEY: { name: 'INTIMIDATE', desc: 'Your ATTACK and SP. ATK start at -1.', onBattleStart(b) { b.addStage('player', 'atk', -1, 'SIDNEY'); b.addStage('player', 'spa', -1, 'SIDNEY'); } },
  PHOEBE: { name: 'SHADOW', desc: 'Some cards are face down and your lead loses 5% HP per hand.', faceDown: 0.25, afterHand(b) { const l = b.lead(); if (l && l.hp > 0) b.recoil('player', l, 0.05, 'SHADOW', true); } },
  GLACIA: { name: 'HAIL', desc: 'Hail all battle; 1 card in hand freezes each turn.', onBattleStart(b) { b.setWeather('HAIL', true); }, onTurnStart(b) { const p = b.deck.hand.filter(c => !c.frozen); if (p.length && b.abOf?.('player') !== 'SUCTION_CUPS') b.rng.pick(p).frozen = true; } },
  DRAKE: { name: 'DRAGON DANCE', desc: 'His POKéMON gain +1 SPEED and +1 ATTACK every other turn.', onTurnEnd(b) { if (b.turn % 2 === 0) { b.addStage('enemy', 'atk', 1, 'DRAKE'); b.addStage('enemy', 'spe', 1, 'DRAKE'); } } },
  STEVEN: { name: 'METAL BODY', desc: 'Hands below PAIR deal no damage; his team hits 10% harder.', enemyDamageMult: 1.1, onScore(b, S) { if (S.comboRank < 1) S.times(0, 'METAL BODY'); } },
  // v0.3.25: EMERALD's CHAMPION WALLACE (the RS_CHAMPION slot) brings STEVEN's rule under MILOTIC's ability
  WALLACE_CHAMPION: { name: 'MARVEL SCALE', desc: 'Hands below PAIR deal no damage; his team hits 10% harder.', enemyDamageMult: 1.1, onScore(b, S) { if (S.comboRank < 1) S.times(0, 'MARVEL SCALE'); } },
  // Johto (v0.1.1): the 8 HGSS leaders, WILL, KAREN, CHAMPION LANCE and RED (JOHTO's KOGA and BRUNO bring their KANTO
  // rules: their trainers carry rule: 'KOGA' / 'BRUNO', see regions.js ruleKeyOf)
  FALKNER: { name: 'ROOST', desc: 'His POKéMON heal 6% of their max HP every turn.', onTurnEnd(b) { b.healEnemy(0.06); } },
  BUGSY: { name: 'SWARM', desc: 'Your first 2 hands each battle deal 25% less damage.', onScore(b, S) { if (b.handsPlayed < 2) S.times(0.75, 'SWARM'); } },
  WHITNEY: {
    name: 'MILK DRINK', desc: 'Each of her POKéMON heals 40% once, the first time a hand leaves it under half HP.',
    afterHand(b) { const e = b.enemy(); if (e && e.hp > 0 && !e.milkDrink && e.hp < e.maxHp / 2) { e.milkDrink = true; b.healEnemy(0.4); b.msg(`${monName(e)} drank MOOMOO MILK!`); } },
  },
  MORTY: { name: 'HYPNOSIS', desc: 'Some cards are dealt face down.', faceDown: 0.25 },
  CHUCK: { name: 'MIND READER', desc: 'You can play at most 4 cards per hand.', canPlay(b, infos) { return infos.length > 4 ? 'MIND READER: play at most 4 cards!' : null; } },
  JASMINE: { name: 'IRON DEFENSE', desc: 'Hands below PAIR deal half damage.', onScore(b, S) { if (S.comboRank < 1) S.times(0.5, 'IRON DEFENSE'); } },
  PRYCE: { name: 'ICY WIND', desc: 'Hail all battle, and your SPEED starts at -1.', onBattleStart(b) { b.setWeather('HAIL', true); b.addStage('player', 'spe', -1, 'ICY WIND'); } },
  CLAIR: { name: 'DRAGON RAGE', desc: 'Her POKéMON hit 15% harder and heal 5% of their max HP every turn.', enemyDamageMult: 1.15, onTurnEnd(b) { b.healEnemy(0.05); } },
  WILL: { name: 'REFLECT', desc: 'Hands below TWO PAIR deal 30% less damage.', onScore(b, S) { if (S.comboRank < 2) S.times(0.7, 'REFLECT'); } },
  KAREN: {
    name: 'PURSUIT', desc: 'Her POKéMON hit 10% harder, and every POKéMON you send out loses 8% of its max HP.', enemyDamageMult: 1.1,
    onLeadEnter(b, lead) { if (lead && lead.hp > 0) b.recoil('player', lead, 0.08, 'PURSUIT', true); },
  },
  LANCE_CHAMPION: { name: 'DRAGON MASTER', desc: 'His team hits 12% harder and heals 6% of their max HP every turn.', enemyDamageMult: 1.12, onTurnEnd(b) { b.healEnemy(0.06); } },
  RED: { name: '......', desc: 'His team hits 15% harder, and your first hand each battle deals half damage.', enemyDamageMult: 1.15, onScore(b, S) { if (b.handsPlayed === 0) S.times(0.5, '......'); } },
  // Sinnoh (v0.6.0, Platinum). Built on the balance notes: every rule hits each co-op player the same way (per lead, per
  // hand, or battle-wide, never a heal that out-heals a bigger room: v0.5.0's SLACK OFF lesson); healing is capped (no
  // stall, a gauntlet RED flag); the late threats are TARGET LOCK (a one-POKéMON carry, Daniel's playbook) and one-turn
  // twists rather than rules that snowball with the fight's length (the acts 3-5 proposal); act 3+ rooms that end up
  // pushovers get a VETERAN cap + ramp (LATE_THREATS), tuned with tests/boss_gauntlet.mjs.
  ROARK: {
    name: 'STEALTH ROCK', desc: 'Pointed stones float around you: every POKéMON you send out loses 5% of its max HP, more if ROCK hits it hard (up to 20%).',
    onLeadEnter(b, lead) {
      if (!lead || lead.hp <= 0) return;
      const eff = typeEffect('ROCK', b.ptypes ? b.ptypes(lead) : (D.species[lead.species]?.types || []));
      b.recoil('player', lead, Math.min(0.2, Math.max(0.0125, 0.05 * eff)), 'STEALTH ROCK', true);
      b.msg(`Pointed stones dug into ${monName(lead)}!`);
    },
  },
  GARDENIA: {
    // (no healing: a heal every turn, even capped, and then a once-per-POKéMON heal both left co-op rooms 30-50 points
    // under solo in the gauntlet; her team is already tougher in co-op, two of them on the field at once)
    name: 'GRASSY TERRAIN', desc: 'The first hand that hits each of her POKéMON in a turn deals 20% less damage.',
    onScore(b, S) {
      const e = b.enemy();
      if (!e || e.terrainTurn === b.turn) return;
      if (!b.dry) e.terrainTurn = b.turn;
      S.times(0.8, 'GRASSY TERRAIN');
    },
  },
  FANTINA: {
    // (every lead, every time it came in, left her at 55% solo vs ~90% for the act 2 peers: now the first one only)
    name: 'CONFUSE RAY', desc: 'Your first lead each battle starts confused for 1-2 hands.',
    onLeadEnter(b, lead) { if (!lead || lead.hp <= 0 || b.confuseRayDone) return; b.confuseRayDone = true; b.confuse('player', false); const ps = b.sides.player; if (ps.confused > 2) ps.confused = 2; },
  },
  MAYLENE: {
    name: 'AURA', desc: 'Her LUCARIO always moves first and hits 10% harder.',
    foeFirst(b) { return b.enemy()?.species === 'LUCARIO'; },
    enemyDamage(b) { return b.enemy()?.species === 'LUCARIO' ? 1.1 : 1; },
  },
  WAKE: { name: 'RAIN DANCE', desc: 'Rain all battle (WATER attacks stronger, FIRE weaker).', onBattleStart(b) { b.setWeather('RAIN', true); } },
  BYRON: {
    name: 'BULWARK', desc: 'Each of his POKéMON halves the first super-effective hand it takes. BASTIODON blocks it completely.',
    onScore(b, S) {
      const e = b.enemy();
      if (!e || e.bulwarkUsed || !(S.bestEff > 1)) return;
      if (!b.dry) e.bulwarkUsed = true; // (a preview predicts it without using it up)
      S.times(e.species === 'BASTIODON' ? 0 : 0.5, 'BULWARK');
      if (!b.dry) b.msg(`${monName(e)} braced itself! (BULWARK)`);
    },
  },
  CANDICE: {
    name: 'SNOW WARNING', desc: 'Hail all battle, and every 3rd turn 1 card in your hand freezes.',
    onBattleStart(b) { b.setWeather('HAIL', true); },
    onTurnStart(b) { if (b.turn % 3 || b.abOf?.('player') === 'SUCTION_CUPS') return; const p = b.deck.hand.filter(c => !c.frozen); if (p.length) b.rng.pick(p).frozen = true; },
  },
  VOLKNER: {
    name: 'DISCHARGE', desc: "Every 3rd turn a DISCHARGE paralyzes your lead (GROUND types don't care).",
    onTurnEnd(b) {
      if (b.turn % 3) return;
      for (const s of (b.duo ? b.duo.aliveSubs() : [b])) {
        const lead = s.lead();
        if (!lead || lead.hp <= 0 || lead.status || (s.ptypes ? s.ptypes(lead) : []).includes('GROUND')) continue;
        s.inflictStatus('player', 'PAR', 'DISCHARGE', false, lead);
      }
    },
  },
  AARON: {
    name: 'TARGET LOCK', desc: 'His POKéMON hit your lead 10% harder for every hand it has played in a row (up to +40%). Switching resets it.',
    enemyDamage(b) { return 1 + 0.1 * Math.min(4, b.leadStreak || 0); },
  },
  BERTHA: {
    name: 'SANDSTORM', desc: 'A sandstorm all battle, and each of her POKéMON comes out with +1 DEFENSE.',
    onBattleStart(b) { b.setWeather('SAND', true); },
    onFoeEnter(b) { b.addStage('enemy', 'def', 1, 'SANDSTORM'); },
  },
  FLINT: { name: 'SUNNY DAY', desc: 'Harsh sunlight all battle (FIRE attacks stronger, WATER weaker).', onBattleStart(b) { b.setWeather('SUN', true); } },
  LUCIAN: {
    name: 'TRICK ROOM', desc: 'Every 3rd turn the room twists for one turn: the slower POKéMON moves first.',
    trickRoom(b) { return b.turn % 3 === 0; },
    onTurnStart(b) { if (b.turn % 3 === 0) b.msg('The dimensions twisted! (TRICK ROOM: the slower POKéMON moves first this turn)'); },
  },
  CYNTHIA: {
    name: "CHAMPION'S RESOLVE", desc: 'Her team hits 5% harder and she opens with a different POKéMON each time. GARCHOMP whips up a sandstorm when it comes out (SAND VEIL).',
    enemyDamageMult: 1.05, // (1.12 in the first pass: in smart-bot S-S-S-S runs she alone killed 13% of the runs that reached her)
    onFoeEnter(b, e) { if (e?.species !== 'GARCHOMP') return; e.ability = 'SAND_VEIL'; b.setWeather('SAND', true); },
  },
  GIRATINA_ORIGIN: {
    name: 'DISTORTION', desc: 'Every 3rd turn the world flips: super-effective hands deal half damage and resisted ones deal double.',
    onTurnStart(b) { if (b.turn % 3 === 0) b.msg('The world flipped! (DISTORTION: type matchups are reversed this turn)'); },
    onScore(b, S) { if (b.turn % 3 || S.bestEff == null || S.bestEff === 1 || S.bestEff === 0) return; S.times(S.bestEff > 1 ? 0.5 : 2, 'DISTORTION'); },
  },
};

for (const [k, v] of Object.entries(BOSS_RULES)) v.key = k;

// MEW's HIDE AND SEEK: the turn it flees at the end of (unless asleep or paralyzed).
export const MEW_TURNS = 3;
// DEOXYS's formes, in turn order (turn 1: ATTACK, 2: DEFENSE, 3: SPEED, 4: ATTACK...): multipliers on its real stats.
export const DEOXYS_FORMES = [
  { key: 'ATTACK', atk: 1.5, spa: 1.5, def: 0.6, spd: 0.6, spe: 1 },
  { key: 'DEFENSE', atk: 0.6, spa: 0.6, def: 1.8, spd: 1.8, spe: 0.6 },
  { key: 'SPEED', atk: 1, spa: 1, def: 0.8, spd: 0.8, spe: 2 },
];
export const deoxysFormeAt = (turn) => DEOXYS_FORMES[(Math.max(1, turn) - 1) % DEOXYS_FORMES.length];
export function deoxysForme(b, e) {
  if (!e || e.hp <= 0) return null;
  const f = deoxysFormeAt(b.turn);
  e.baseStats ||= { ...e.stats };
  if (e.forme === f.key) return f;
  e.forme = f.key;
  e.stats = { ...e.baseStats };
  for (const k of ['atk', 'def', 'spa', 'spd', 'spe']) e.stats[k] = Math.max(1, Math.round(e.baseStats[k] * f[k]));
  b.msg(`DEOXYS changed to its ${f.key} FORME!`);
  b.emit({ t: 'forme', forme: f.key, species: e.species });
  return f;
}

// Rules picked for the Champion's individual Pokémon.
// VETERAN (v0.5.8): the late threat on act 3+ bosses that were pushovers (tests/boss_gauntlet.mjs: 95-100% wins solo and
// co-op; docs: Notion "making acts 3-5 a real threat"). On top of the boss's own rule, keyed by trainer (not by rule: JOHTO's
// E4 KOGA and the CHAMPION rule pool share KOGA's rule): no more than `cap` of a POKéMON's max HP per turn (co-op: every
// player's hands together, battle.js capFor), and +1 ATTACK / SP. ATK every `ramp` turns (not slower in co-op). Tuned per
// boss with the gauntlet to about 85-90% wins solo and in co-op. Run.bossConfig / gauntletConfig put it on the enemies
// (e.threat), from act 3 on.
// cap: solo (per turn = per hand); coopCap: co-op with 2 / 3 / 4 players (per turn, every player's hands together; a bigger
// room is more forgiving, so it gets a tighter cap); ramp: turns. null = no cap.
export const LATE_THREATS = {
  LEADER_KOGA: { cap: 0.9, coopCap: [0.6, 0.5, 0.5], ramp: 2 }, LEADER_GIOVANNI: { cap: null, coopCap: [0.6, 0.48, 0.42], ramp: 2 },
  LEADER_CHUCK: { cap: 0.5, coopCap: [0.3, 0.22, 0.2], ramp: 1 }, LEADER_JASMINE: { cap: 0.5, coopCap: [0.35, 0.27, 0.23], ramp: 1 },
  // one ELITE FOUR room: HOENN's SIDNEY. Not rooms whose own rule grows with the fight's length (in the gauntlet LORELEI's
  // ICE BODY and KANTO BRUNO's FIGHTING SPIRIT sat at 60-73% solo whatever the cap and ramp; JOHTO's rooms stay as they were).
  ELITE_FOUR_SIDNEY: { cap: 0.85, coopCap: [0.4, 0.35, 0.3], ramp: 4 },
  // v0.6.0 SINNOH: one room (LUCIAN sat at 100% everywhere in the first gauntlet run). BERTHA had one too, but in full
  // smart-bot runs the five rooms compounded: 32% of runs that reached the SINNOH ELITE FOUR died there (JOHTO 3%)
  ELITE_FOUR_LUCIAN: { cap: 0.85, coopCap: [0.45, 0.38, 0.33], ramp: 8 },
};
export const threatCoopCap = (t, n = 2) => (t.coopCap ? t.coopCap[Math.min(4, Math.max(2, n)) - 2] : null);
export function threatText(t, coop = false, n = 2) {
  const cap = coop ? threatCoopCap(t, n) : t.cap;
  const every = t.ramp === 1 ? 'every turn' : t.ramp === 2 ? 'every other turn' : `every ${t.ramp} turns`;
  return `VETERAN: ${cap ? `no more than ${Math.round(cap * 100)}% of its max HP in damage per turn${coop ? " (everyone's hands together)" : ''}, and ` : ''}+1 ATTACK and SP. ATK ${every}.`;
}

export const CHAMPION_RULE_POOL = ['BROCK', 'LT_SURGE', 'KOGA', 'GIOVANNI', 'LORELEI', 'BRUNO'];
export const ELITE_RULE_POOL = ['ROCKET', 'RIVAL', 'BROCK', 'MISTY'];

// The type a boss prefers, shown wherever a boss is previewed (map, act clear, ELITE FOUR break). GYM LEADERS and
// the ELITE FOUR have a signature type; anyone else (champions, RED) is read off their team: one type if most of
// it shares it, the two most common if both show up twice or more, else Mixed. Legendary bosses: their own types.
export const BOSS_TYPES = {
  LEADER_BROCK: 'ROCK', LEADER_MISTY: 'WATER', LEADER_LT_SURGE: 'ELECTRIC', LEADER_ERIKA: 'GRASS', LEADER_KOGA: 'POISON',
  LEADER_SABRINA: 'PSYCHIC', LEADER_BLAINE: 'FIRE', LEADER_GIOVANNI: 'GROUND',
  ELITE_FOUR_LORELEI: 'ICE', ELITE_FOUR_BRUNO: 'FIGHTING', ELITE_FOUR_AGATHA: 'GHOST', ELITE_FOUR_LANCE: 'DRAGON',
  LEADER_ROXANNE: 'ROCK', LEADER_BRAWLY: 'FIGHTING', LEADER_WATTSON: 'ELECTRIC', LEADER_FLANNERY: 'FIRE', LEADER_NORMAN: 'NORMAL',
  LEADER_WINONA: 'FLYING', LEADER_TATE_LIZA: 'PSYCHIC', LEADER_WALLACE: 'WATER',
  ELITE_FOUR_SIDNEY: 'DARK', ELITE_FOUR_PHOEBE: 'GHOST', ELITE_FOUR_GLACIA: 'ICE', ELITE_FOUR_DRAKE: 'DRAGON',
  LEADER_FALKNER: 'FLYING', LEADER_BUGSY: 'BUG', LEADER_WHITNEY: 'NORMAL', LEADER_MORTY: 'GHOST', LEADER_CHUCK: 'FIGHTING',
  LEADER_JASMINE: 'STEEL', LEADER_PRYCE: 'ICE', LEADER_CLAIR: 'DRAGON',
  ELITE_FOUR_WILL: 'PSYCHIC', JOHTO_E4_KOGA: 'POISON', JOHTO_E4_BRUNO: 'FIGHTING', ELITE_FOUR_KAREN: 'DARK', CHAMPION_LANCE: 'DRAGON',
  LEADER_ROARK: 'ROCK', LEADER_GARDENIA: 'GRASS', LEADER_FANTINA: 'GHOST', LEADER_MAYLENE: 'FIGHTING', LEADER_WAKE: 'WATER',
  LEADER_BYRON: 'STEEL', LEADER_CANDICE: 'ICE', LEADER_VOLKNER: 'ELECTRIC',
  ELITE_FOUR_AARON: 'BUG', ELITE_FOUR_BERTHA: 'GROUND', ELITE_FOUR_FLINT: 'FIRE', ELITE_FOUR_LUCIAN: 'PSYCHIC',
};
// -> [] (Mixed) or 1-2 type keys.
export function bossTypes(key) {
  if (!key) return [];
  if (BOSS_TYPES[key]) return [BOSS_TYPES[key]];
  if (LEGENDS[key]) return [...(D.species[LEGENDS[key].species]?.types || [])].filter((t, i, a) => a.indexOf(t) === i);
  if (key === 'CHAMPION_FIRST') return []; // the rival: a team built around your starter's counter
  const party = D.trainers?.[key]?.party || [];
  const c = {};
  for (const p of party) for (const t of new Set(D.species[p.species]?.types || [])) c[t] = (c[t] || 0) + 1;
  const [a, b] = Object.entries(c).sort((x, y) => y[1] - x[1]);
  if (!a) return [];
  if (a[1] * 5 >= party.length * 3) return [a[0]]; // 60%+ of the team
  if (b && a[1] >= 2 && b[1] >= 2) return [a[0], b[0]];
  return [];
}
// "ROCK", "STEEL/ROCK" or "Mixed".
export const bossTypeLabel = (key) => bossTypes(key).join('/') || 'Mixed';
