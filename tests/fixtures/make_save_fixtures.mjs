// Generates the save fixtures for tests/saves.test.mjs. They are REAL saves of a past game version: never
// regenerate them after a game-logic change (that would only test the new code against itself). They were made
// with v0.3.6 (game logic 'v035', the same as v0.3.5):  node tests/fixtures/make_save_fixtures.mjs
//   solo_v035.json            a solo run saved on the map after a few nodes (what saveRun() stores)
//   coop_log_v035.json        a 2-player co-op action log as a v0.3.5 client posted it (ck/atSeq, no stamps),
//                             from the init through the act 1 boss into act 2, plus facts about its latest safe point
//   coop_checkpoint_v036.json a co-op checkpoint row as v0.3.6 writes it (mid act 2, on the map)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadData } from '../../web/src/game/data.js';
import { Run } from '../../web/src/game/run.js';
import { reachable } from '../../web/src/game/map.js';
import { CoopGame } from '../../web/src/game/coop/coop.js';
import { snapshotGame, isSafePoint } from '../../web/src/game/coop/snapshot.js';
import { LOGIC_ID } from '../../web/src/game/coop/engines.js';
import { VERSION } from '../../web/src/game/version.js';
import { makeBot, botAction } from '../coop_bot.mjs';
import { playSoloNodes } from '../save_helpers.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
await loadData(async f => JSON.parse(fs.readFileSync(path.join(here, '../../web/assets/data', f), 'utf8')));
const out = (name, obj) => { fs.writeFileSync(path.join(here, name), JSON.stringify(obj)); console.log(name, (JSON.stringify(obj).length / 1024).toFixed(0) + ' KB'); };

// ---- solo: a spire run, 6 nodes in
{
  const run = Run.create({ starter: 'CHARMANDER', ascension: 0, seed: 'FIXTURE-SOLO', world: 'spire', pool: ['kanto', 'hoenn', 'johto'] });
  playSoloNodes(run, 6, 'FIXTURE-SOLO');
  if (run.finished) throw new Error('solo fixture run died: pick another seed');
  out('solo_v035.json', { version: 'v0.3.5', logic: LOGIC_ID, save: JSON.parse(JSON.stringify(run)) });
}

// ---- co-op: two bots, through the act 1 boss and 3 floors into act 2
{
  const seed = process.env.SEED || 'FIXTURE-COOP';
  const game = new CoopGame();
  const log = [];
  const post = (a) => {
    // like CoopSession.post on v0.3.5: the sender's checksum of the game it saw, no version stamps
    const act = JSON.parse(JSON.stringify({ ...a, ...(game.phase !== 'init' ? { ck: game.checksum() >>> 0, atSeq: game.seq } : {}), seq: game.seq + 1, nonce: `n${game.seq + 1}` }));
    log.push(act);
    return game.apply(act);
  };
  post({ type: 'init', seed, ascension: 0, world: 'spire_johto', starters: ['BULBASAUR', 'CHARMANDER'], names: ['BOT1', 'BOT2'], p: -1 });
  const bots = [makeBot(seed, 0), makeBot(seed, 1)];
  let cp = null, n = 0;
  while (!['over', 'victory'].includes(game.phase) && n++ < 20000) {
    if (game.world.actIndex === 1 && isSafePoint(game) && game.world.floor >= 1 && !cp) cp = { seq: game.seq, snap: snapshotGame(game), checksum: game.checksum() >>> 0 };
    if (game.world.actIndex === 1 && game.world.floor >= 3 && game.phase === 'battle') break; // (stop mid-node: the log ends in a battle)
    let acted = false;
    for (const bot of bots) { const a = botAction(game, bot); if (!a) continue; if (!post(a)) bot.fails++; acted = true; break; }
    if (!acted) break;
  }
  if (game.world.actIndex !== 1 || !cp) throw new Error('co-op fixture run did not reach act 2: pick another SEED (' + game.phase + ')');
  // the latest safe point in the log, and what it looks like
  const g = new CoopGame();
  let safe = null;
  for (const a of log) { g.apply(JSON.parse(JSON.stringify(a))); if (isSafePoint(g)) safe = { seq: g.seq, act: g.world.actIndex, node: g.world.nodeId, floor: g.world.floor, teams: g.runs.map(r => r.party.map(m => `${m.species}:${m.level}:${m.hp}`)), money: g.runs.map(r => r.money) }; }
  out('coop_log_v035.json', { version: 'v0.3.5', logic: LOGIC_ID, seed, log, safe, final: { seq: g.seq, phase: g.phase, checksum: g.checksum() >>> 0 } });
  out('coop_checkpoint_v036.json', { seq: cp.seq, phase: 'map', state: JSON.stringify(cp.snap), checksum: cp.checksum, gameVersion: VERSION, engine: LOGIC_ID, reason: 'auto' });
}
