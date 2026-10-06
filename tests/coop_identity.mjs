// 2-player identity check for the N-player co-op work (branch coop4).
//   node tests/coop_identity.mjs record tests/out/coop4/base2p.json   (on the 2-player-only base commit)
//   node tests/coop_identity.mjs check  tests/out/coop4/base2p.json   (after the change)
// record: plays full two-bot co-op runs and stores every action + the checksum after it.
// check:  (1) replays the recorded logs through today's CoopGame (engine identity: same checksum after every
//         action) and (2) re-plays the same seeds with today's bots (bot + engine identity: same log).
import fs from 'fs';
import path from 'path';
import { loadData } from '../web/src/game/data.js';
import { CoopGame } from '../web/src/game/coop/coop.js';
import { playCoop } from './coop_bot.mjs';

await loadData(async f => JSON.parse(fs.readFileSync('web/assets/data/' + f, 'utf8')));
const [mode, file] = process.argv.slice(2);
const SEEDS = (process.env.SEEDS || 'ID0,ID1,ID2,ID3,ID4,ID5,ID6,ID7,ID8,ID9,ID10,ID11,ID12,ID13,ID14,ID15').split(',');
const STARTERS = [['BULBASAUR', 'CHARMANDER'], ['SQUIRTLE', 'BULBASAUR'], ['CHARMANDER', 'SQUIRTLE']];

function record() {
  const out = [];
  SEEDS.forEach((seed, i) => {
    const cks = [];
    const { game, log } = playCoop({ seed, starters: STARTERS[i % 3], world: i % 2 ? 'hoenn' : 'kanto', onAction: (a, ok, g) => cks.push(g.checksum() >>> 0) });
    out.push({ seed, starters: STARTERS[i % 3], world: i % 2 ? 'hoenn' : 'kanto', log, cks, phase: game.phase });
    console.log(`${seed}: ${log.length} actions, ${game.phase}`);
  });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(out));
}

function check() {
  const base = JSON.parse(fs.readFileSync(file, 'utf8'));
  let bad = 0;
  for (const r of base) {
    // (1) engine: replay the recorded log
    const g = new CoopGame();
    let firstBad = -1;
    r.log.forEach((a, i) => { g.apply(JSON.parse(JSON.stringify(a))); if (firstBad < 0 && (g.checksum() >>> 0) !== r.cks[i]) firstBad = i; });
    // (2) bots + engine: play the same seed again
    const cks = [];
    const { game, log } = playCoop({ seed: r.seed, starters: r.starters, world: r.world, onAction: (a, ok, gg) => cks.push(gg.checksum() >>> 0) });
    let botBad = -1;
    for (let i = 0; i < Math.max(cks.length, r.cks.length); i++) if (cks[i] !== r.cks[i]) { botBad = i; break; }
    const ok = firstBad < 0 && botBad < 0;
    if (!ok) bad++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${r.seed} (${r.world}, ${r.log.length} actions, ${r.phase}): replay ${firstBad < 0 ? 'identical' : 'differs at #' + firstBad + ' ' + r.log[firstBad].type}; bots ${botBad < 0 ? 'identical' : `differ at #${botBad} (${log[botBad]?.type} vs ${r.log[botBad]?.type})`}; ${game.phase}`);
  }
  console.log(bad ? `${bad} run(s) differ` : 'all 2-player runs identical');
  process.exit(bad ? 1 : 0);
}

if (mode === 'record') record(); else if (mode === 'check') check(); else console.log('usage: record|check <file>');
