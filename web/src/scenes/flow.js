// Scene flow between map nodes, battles, rewards and act transitions.
import { setScene } from '../engine/core.js';
import { G, saveRun, endRun } from '../game/state.js';
import { MapScene } from './map.js';
import { BattleScene } from './battle.js';
import { RewardScene } from './reward.js';
import { ShopScene } from './shop.js';
import { CenterScene } from './center.js';
import { EventScene } from './event.js';
import { TreasureScene } from './treasure.js';
import { GameOverScene, VictoryScene, ActClearScene } from './gameover.js';
import { BADGES } from '../game/items.js';

export function goToMap(opts = {}) {
  if (G.coop) return G.coop.privateDone(); // co-op: leaving a private scene hands the run back to the session
  if (G.run) G.run.inNode = false;
  saveRun('checkpoint'); // (the cloud save follows once per node, here)
  setScene(new MapScene(opts));
}

export function enterNode(id, resume = false) {
  const run = G.run;
  const node = resume ? run.map.nodes[id] : run.enterNode(id);
  run.inNode = true;
  saveRun('defer');
  switch (node.type) {
    case 'wild': case 'trainer': case 'elite': case 'boss': case 'rival': case 'legend':
      return startBattle(run.battleConfig(node), node);
    case 'center': return setScene(new CenterScene());
    case 'mart': return setScene(new ShopScene());
    case 'event': return setScene(new EventScene());
    case 'treasure': return setScene(new TreasureScene());
  }
}

export function continueRun() {
  const run = G.run;
  if (run.inNode && run.nodeId && run.map.nodes[run.nodeId]) {
    const n = run.map.nodes[run.nodeId];
    if (n.type === 'boss' && run.act.gauntlet && run.gauntletIndex > 0) return startGauntletBattle();
    return enterNode(run.nodeId, true);
  }
  goToMap();
}

export function startBattle(cfg, node, extra = {}) {
  setScene(new BattleScene(cfg, { node, ...extra }));
}

export function battleFinished(battle, scene) {
  const run = G.run;
  const out = battle.result.outcome;
  // a lost mythic "?" fight (v0.3.25): the run goes on, the team thrown out with 30% less HP (Run.softLoss)
  if (out === 'lose' && scene.cfg?.softLose) { run.softLoss(battle); return goToMap(); }
  if (out === 'lose') { endRun(run, 'lose'); return setScene(new GameOverScene()); }
  if (out === 'enemyFled' && scene.cfg?.mythic) for (const e of battle.enemies) run.addSeen(e.species, false); // (MEW got away: seen)
  if (out === 'fled' || out === 'enemyFled') {
    // Nuzlocke: POKéMON that fainted before you got away are gone too.
    const released = run.releaseLost ? run.releaseLost() : [];
    return goToMap(released.length ? { released } : {});
  }
  const cfg = scene.cfg;
  // (the post-game's boss ends the run: a legendary, or JOHTO's RED, a trainer boss since v0.1.1)
  const final = (cfg.gauntlet !== undefined && cfg.gauntlet === run.act.gauntlet.length - 1) || (cfg.kind === 'boss' && cfg.gauntlet === undefined && run.act.postgame && !scene.extra?.onDone);
  if (final) return afterRewards(battle, cfg, scene.extra);
  setScene(new RewardScene(battle, scene.cfg, scene.extra));
}

// Called by the reward scene when the player is done.
export function afterRewards(battle, cfg, extra = {}) {
  if (G.coop) return G.coop.privateDone();
  const run = G.run;
  if (extra.onDone) return extra.onDone();
  if (cfg.kind === 'boss') {
    if (cfg.gauntlet !== undefined) {
      const next = cfg.gauntlet + 1;
      if (next < run.act.gauntlet.length) {
        run.gauntletIndex = next;
        saveRun();
        return setScene(new ActClearScene({ gauntletBreak: true, next }));
      }
      // Became champion!
      run.victory = true;
      return setScene(new VictoryScene());
    }
    if (run.act.postgame) { run.victory = true; endRun(run, 'postgame'); return setScene(new VictoryScene({ postgame: true })); }
    return setScene(new ActClearScene({ boss: run.boss }));
  }
  goToMap();
}

export function startGauntletBattle() {
  const run = G.run;
  const cfg = run.gauntletConfig(run.rng.fork('g' + run.gauntletIndex), run.gauntletIndex);
  startBattle(cfg, { id: 'boss', type: 'boss', floor: run.act.floors });
}

export function nextAct() {
  const run = G.run;
  run.nextActHeal();
  run.startAct(run.actIndex + 1);
  saveRun();
  goToMap({ actIntro: true });
}

export function badgeForBoss(bossKey) {
  const leader = bossKey?.replace('LEADER_', '');
  return Object.values(BADGES).find(b => b.leader === leader)?.key || null;
}
