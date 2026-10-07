// Shared by tests/saves.test.mjs and tests/fixtures/make_save_fixtures.mjs: a smart bot playing solo nodes, and a
// co-op bot loop whose actions carry checksums like CoopSession.post's.
import { RNG } from '../web/src/game/rng.js';
import { reachable } from '../web/src/game/map.js';
import { isFainted } from '../web/src/game/pokemon.js';
import { fight, postBattle, chooseNode, doShop, doEvent, doCenter } from './bot.mjs';
import { makeBot, botAction } from './coop_bot.mjs';

const BATTLES = new Set(['wild', 'trainer', 'elite', 'boss', 'rival', 'legend']);

// Plays up to `nodes` map nodes of a solo run (stops at an act boss's end or a loss). -> nodes played
export function playSoloNodes(run, nodes, seed = 'BOT') {
  const rng = new RNG(seed + ':solo');
  let played = 0;
  while (played < nodes && !run.finished) {
    if (!reachable(run.map, run.nodeId).length) break;
    const id = chooseNode(run, rng, 'smart');
    const node = run.enterNode(id);
    played++;
    if (BATTLES.has(node.type)) {
      const cfg = run.battleConfig(node);
      const b = fight(run, cfg, 'smart');
      if (b.result.outcome === 'lose') { run.finished = true; break; }
      postBattle(run, b, rng, 'smart');
      if (node.type === 'boss') break;
    } else if (node.type === 'center') doCenter(run, 'smart');
    else if (node.type === 'mart') doShop(run, rng, 'smart');
    else if (node.type === 'event') {
      const r = doEvent(run, rng, 'smart');
      if (r.battle) { const b = fight(run, r.battle, 'smart'); if (b.result.outcome === 'lose') { run.finished = true; break; } postBattle(run, b, rng, 'smart'); }
    }
    else if (node.type === 'treasure') { run.addConsumable(run.randomConsumable(rng)); }
    if (run.party.every(isFainted)) { run.finished = true; break; }
  }
  return played;
}

// Bots post actions to `game` (any engine's CoopGame) with the sender's checksum, as CoopSession.post does.
// stamp: { v, eng } added to every player action (v0.3.6+ clients), or null (v0.3.5 clients).
export function coopPlayer(game, seed, stamp = null) {
  const log = [];
  const post = (a) => {
    const act = JSON.parse(JSON.stringify({ ...a, ...(game.phase !== 'init' ? { ck: game.checksum() >>> 0, atSeq: game.seq } : {}), ...(stamp && a.type !== 'init' ? stamp : {}), seq: game.seq + 1, nonce: `n${game.seq + 1}` }));
    log.push(act);
    return game.apply(act);
  };
  const bots = [];
  // one bot action; false when nobody can act (or the run is over)
  const step = () => {
    if (['over', 'victory', 'init'].includes(game.phase)) return false;
    while (bots.length < game.n) bots.push(makeBot(seed, bots.length)); // (the init sets the player count)
    for (const bot of bots) { const a = botAction(game, bot); if (!a) continue; if (!post(a)) bot.fails++; return true; }
    return false;
  };
  const until = (pred, max = 20000) => { let n = 0; while (!pred(game) && n++ < max) if (!step()) return false; return pred(game); };
  return { log, post, step, until, bots };
}
