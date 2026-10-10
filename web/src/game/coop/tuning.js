// Co-op (2-4 players, team battles against two foes at a time) tuning knobs. Balanced with tests/coop_balance.mjs so two smart bots
// win about 11% at A0 (Kanto ~12% over 180 runs, Hoenn ~11% over 150; a bit under solo smart A0 ~13-18%).
export const COOP_TUNING = {
  // Enemy HP multiplier per encounter kind (on top of the solo scaling). Wild and trainer fights already
  // field twice the enemies (two wild POKéMON / a tag team of two trainers); elites, bosses and the Elite
  // Four send one party two at a time against two focused players, so each foe needs a lot more HP.
  // (v0.0.5: briefly lowered to 2.1 / 3.3 / 4.0 (~20% wins); restored to 2.35 / 3.65 / 4.35 for the ~11% target.)
  hp: { wild: 1.1, trainer: 1.15, elite: 2.35, rival: 2.35, boss: 3.65, legend: 3.65, bird: 2.4, bird2: 1.1, gauntlet: 4.35, mythic: 2.0 },
  // bird2 (v0.3.11): the co-op legendary node's PAIR of legendaries (coop.js legendPairConfig), per legendary. With HP
  // 1.1 / damage 0.65 each the pair is about as hard as the old single legendary (bird: 2.4 / 1.3): same-team A/B on
  // 35 bot rooms stopped before the node (tests/coop_bot.mjs): old 80% wins, 6.9 turns, 22% team HP lost; pair 83%,
  // 7.7 turns, 28% (1.4 / 0.8 was 51%; 1.2 / 0.7 74%).
  // Per-region overrides of hp (keyed by the act's region) (Hoenn's tag battles and gyms ran harder in co-op than its solo runs).
  worldHp: { hoenn: { wild: 1.0, trainer: 0.95, elite: 2.15, rival: 2.15, boss: 3.3 } },
  // Enemy damage multiplier per kind.
  dmg: { wild: 1.0, trainer: 1.0, elite: 1.0, rival: 1.0, boss: 1.0, legend: 1.3, bird: 1.3, bird2: 0.65, gauntlet: 1.0, mythic: 1.3 },
  // EXP multiplier per kind: each player gets EXP for every foe beaten, so without this co-op teams end up
  // 2-4 levels above a solo run's (wild/tag fights also beat twice the POKéMON of a solo fight).
  exp: { wild: 0.45, trainer: 0.45, elite: 0.75, rival: 0.75, boss: 0.75, legend: 0.75, bird: 0.75, bird2: 0.4, gauntlet: 0.75, mythic: 0.75 },
  // mythic (v0.3.25): a "?" event's mythic (coop.js mythicDuoConfig), one foe like the solo legendary node. An all-target foe
  // (CERULEAN CAVE's MEWTWO) hits every player each turn instead of acting n/2 times: each hit x spread, so it deals about
  // 1.3x the damage of a normal single legendary per turn at any party size (2 players: 2 hits x 0.65).
  spread: 0.65,
  // Optional per-act multipliers (index = act, last value repeats): enemy HP and damage.
  actHp: null, actDmg: null,
  // A downed player's lead comes back with this fraction of its max HP when the partner wins.
  reviveFrac: 0.25,
  // v0.0.6 raised the solo enemy HP (TUNING.hpMult 1.62 -> 1.92); co-op keeps its own balance with this
  // factor on every co-op HP multiplier above. Then (hpMult 2.4, bots stop losing items to a full bag, rival
  // floors / legendary birds) 1.12: two smart bots win ~11% at Kanto A0 (tests/coop_balance.mjs).
  hpComp: 1.12,
  // TEAM UP: the second hand to hit the same foe in a turn deals +teamUp % damage.
  teamUp: 20,
  // 3-4 players: foe HP is already x n/2 (wild battles field n foes instead) and every foe acts n/2 times per
  // turn; on top of that a per-size factor, because more players are more forgiving (a wipe needs everyone down at
  // once, a downed player costs 1/n of the damage instead of half, TEAM UP lands more often). Smart bots, Kanto A0
  // (tests/coop_balance.mjs --players n, seeds Q1-Q8, 240 runs each): 2p 10.4%; 3p x1.0 18.3%, x1.1 10.8%;
  // 4p x1.0 17.9%, x1.1 12.1%. (The first prototype guess, 3p x1.15 / 4p x1.2, gave 8% / 9% on seeds CP1-CP4.)
  players: { 3: { hpAll: 1.1 }, 4: { hpAll: 1.1 } },
  // Enemy targeting: weight bonus for super-effective / low-HP targets (deterministic, shared RNG).
  targetSuper: 1.6, targetLowHp: 1.5,
};
