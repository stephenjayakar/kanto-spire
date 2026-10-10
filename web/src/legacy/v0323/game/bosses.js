// Boss rules ("boss blinds"): each Gym Leader / Elite Four member bends the rules of the fight.
import { monName } from './pokemon.js';
import { D } from './data.js';
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
    name: 'PSYCHIC VEIL', desc: 'Some cards are dealt face down.', faceDown: 0.25, enemyDamageMult: 0.85,
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
      for (const c of b.rng.sample(pool, Math.min(2, pool.length))) c.frozen = true;
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
  // Hoenn leaders (post-game world)
  ROXANNE: { name: 'STURDY', desc: 'Her POKéMON survive the first knockout blow with 1 HP.', sturdy: true },
  BRAWLY: { name: 'BULK UP', desc: 'His POKéMON gain +1 ATTACK every turn.', onTurnEnd(b) { b.addStage('enemy', 'atk', 1, 'BULK UP'); } },
  WATTSON: { name: 'MAGNET PULL', desc: 'Discarding costs your lead 5% HP.', },
  FLANNERY: { name: 'DROUGHT', desc: 'Harsh sunlight all battle. Your WATER cards are weakened.', onBattleStart(b) { b.setWeather('SUN', true); } },
  NORMAN: { name: 'SLACK OFF', desc: 'His POKéMON heal 25% whenever a hand fails to deal 20% of their HP.', afterHand(b, S) { const e = b.enemy(); if (e.hp > 0 && S.damage < e.maxHp * 0.2) b.healEnemy(0.25); } },
  WINONA: { name: 'TAILWIND', desc: 'Her POKéMON always move first. -1 hand size.', handSize: -1 },
  TATE_LIZA: { name: 'TWIN MINDS', desc: 'Each hand must have exactly 2 or 4 cards.', canPlay(b, infos) { return infos.length === 2 || infos.length === 4 ? null : 'TWIN MINDS: play 2 or 4 cards!'; } },
  WALLACE: { name: 'RAIN DANCE', desc: 'Rain all battle and his POKéMON heal 6% each turn.', onBattleStart(b) { b.setWeather('RAIN', true); }, onTurnEnd(b) { b.healEnemy(0.06); } },
  SIDNEY: { name: 'INTIMIDATE', desc: 'Your ATTACK and SP. ATK start at -1.', onBattleStart(b) { b.addStage('player', 'atk', -1, 'SIDNEY'); b.addStage('player', 'spa', -1, 'SIDNEY'); } },
  PHOEBE: { name: 'SHADOW', desc: 'Some cards are face down and your lead loses 5% HP per hand.', faceDown: 0.25, afterHand(b) { const l = b.lead(); if (l && l.hp > 0) b.recoil('player', l, 0.05, 'SHADOW', true); } },
  GLACIA: { name: 'HAIL', desc: 'Hail all battle; 1 card in hand freezes each turn.', onBattleStart(b) { b.setWeather('HAIL', true); }, onTurnStart(b) { const p = b.deck.hand.filter(c => !c.frozen); if (p.length) b.rng.pick(p).frozen = true; } },
  DRAKE: { name: 'DRAGON DANCE', desc: 'His POKéMON gain +1 SPEED and +1 ATTACK every other turn.', onTurnEnd(b) { if (b.turn % 2 === 0) { b.addStage('enemy', 'atk', 1, 'DRAKE'); b.addStage('enemy', 'spe', 1, 'DRAKE'); } } },
  STEVEN: { name: 'METAL BODY', desc: 'Hands below PAIR deal no damage; his team hits 10% harder.', enemyDamageMult: 1.1, onScore(b, S) { if (S.comboRank < 1) S.times(0, 'METAL BODY'); } },
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
};

for (const [k, v] of Object.entries(BOSS_RULES)) v.key = k;

// Rules picked for the Champion's individual Pokémon.
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
