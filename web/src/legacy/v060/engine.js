// FROZEN co-op engine "v060": game/ is a byte-for-byte copy of the co-op game logic (web/src/game) as shipped in
// v0.6.0 (plus game/abilities.js, which v0.6.0's logic imports). Never edit anything under this folder. Rooms played
// on that code replay their logs here (web/src/game/coop/engines.js) and then continue on the current code from their
// latest safe point.
export { CoopGame } from './game/coop/coop.js';
export { Run } from './game/run.js';
export { RNG } from './game/rng.js';
export { loadData, D } from './game/data.js';
export const ID = 'v060';
