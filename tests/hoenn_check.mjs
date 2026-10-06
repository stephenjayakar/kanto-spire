import fs from 'fs';
import { loadData } from '../web/src/game/data.js';
import { Run } from '../web/src/game/run.js';
await loadData(async f => JSON.parse(fs.readFileSync('web/assets/data/' + f, 'utf8')));
const r = Run.create({ starter: 'TORCHIC', world: 'hoenn', seed: 'H1' });
for (let a = 0; a < 5; a++) {
  r.startAct(a);
  const rng = r.rng.fork('t');
  const w = r.wildConfig(rng, 5), t = r.trainerConfig(rng, 8), e = r.eliteConfig(rng, 9);
  const b = r.act.gauntlet ? r.gauntletConfig(rng, 4) : r.bossConfig(rng);
  console.log(r.act.name, '| wild', w.enemies[0].species, w.enemies[0].level, '| trainer', t.trainer.title, t.enemies.map(x => x.species + x.level).join(','), '| elite', e.trainer?.title || e.legend, e.enemies.map(x => x.species + x.level).join(','), '| boss', b.trainer?.title || b.legend, b.enemies.map(x => x.species + x.level).join(','), b.bossRule || '');
}
