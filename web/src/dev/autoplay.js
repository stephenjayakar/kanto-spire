// Dev-only autoplayer: drives the real scenes through a run to smoke-test UI flow.
// Usage in console: import('/src/dev/autoplay.js').then(m => m.start({ speed: 4 }))
import { Engine, popOverlay, topOverlay } from '../engine/core.js';
import { G } from '../game/state.js';
import { D } from '../game/data.js';
import { regionOf } from '../game/regions.js';
import { reachable } from '../game/map.js';
import { maxHp, isFainted } from '../game/pokemon.js';
import { MapScene } from '../scenes/map.js';
import { BattleScene } from '../scenes/battle.js';
import { RewardScene, MoveChoiceModal, RelicChoiceModal } from '../scenes/reward.js';
import { ShopScene } from '../scenes/shop.js';
import { CenterScene } from '../scenes/center.js';
import { EventScene } from '../scenes/event.js';
import { TreasureScene } from '../scenes/treasure.js';
import { ActClearScene, GameOverScene, VictoryScene } from '../scenes/gameover.js';
import { MoveReplaceModal, PartyPicker, ChoiceModal, DeckModal } from '../scenes/common.js';
import { afterRewards, nextAct, startGauntletBattle, goToMap } from '../scenes/flow.js';

export const log = [];
let timer = null, lastScene = null, stuck = 0;

function subsets(arr, max) {
  const out = [];
  for (let mask = 1; mask < (1 << arr.length); mask++) {
    const s = arr.filter((_, i) => mask & (1 << i));
    if (s.length <= max) out.push(s);
  }
  return out;
}

function bestHand(b) {
  const hand = b.deck.hand.filter(c => b.cardInfo(c).playable).map(c => c.id);
  let best = null, bv = -1;
  for (const s of subsets(hand, b.maxPlay)) {
    if (!b.canPlay(s).ok) continue;
    const sim = b.simulate(s); if (!sim) continue;
    const v = sim.damage + s.length;
    if (v > bv) { bv = v; best = s; }
  }
  return best;
}

function step() {
  const ov = topOverlay();
  const sc = Engine.scene;
  try {
    if (ov) {
      if (ov instanceof MoveChoiceModal) ov.close(ov.choices[0] || null);
      else if (ov instanceof RelicChoiceModal) ov.close(ov.choices[0] || null);
      else if (ov instanceof MoveReplaceModal) ov.close(0);
      else if (ov instanceof PartyPicker) { const ok = G.run.party.find(m => !ov.filter || ov.filter(m) === true); ov.close(ok || null); }
      else if (ov instanceof ChoiceModal) ov.close(ov.options[0]?.value ?? 0);
      else if (ov instanceof DeckModal) ov.close(ov.onPick ? { mon: G.run.party[0], index: 0 } : null);
      else if (ov.close) { if (ov.t > 0.3) ov.close(true); }
      return;
    }
    if (sc instanceof MapScene) {
      if (sc.busy || sc.msg.active) { if (sc.msg.active) Engine.mouse.clicked = true; return; }
      const run = G.run;
      const next = reachable(run.map, run.nodeId);
      const avg = run.party.reduce((a, m) => a + m.hp / maxHp(m), 0) / run.party.length;
      const pref = t => ({ center: avg < 0.6 ? 10 : 1, trainer: 4, elite: avg > 0.75 ? 3 : 0.5, wild: 4, event: 3, mart: 2, treasure: 5, boss: 10 }[t] || 1);
      const id = next.sort((a, b) => pref(run.map.nodes[b].type) - pref(run.map.nodes[a].type))[0];
      log.push(`map -> ${run.map.nodes[id].type} (A${run.actIndex + 1}F${run.map.nodes[id].floor})`);
      sc.travel(run.map.nodes[id]);
    } else if (sc instanceof BattleScene) {
      if (sc.msg.active) Engine.mouse.clicked = true;
      if (sc.busy) return;
      const b = sc.b;
      const e = b.enemy();
      if (b.kind === 'wild' && G.run.party.length < 6 && e.hp < e.maxHp * 0.5 && G.run.totalBalls() > 0) { sc.throw(Object.keys(G.run.balls).find(k => G.run.balls[k] > 0)); return; }
      const best = bestHand(b);
      if (!best) { if (b.discardsLeft > 0) { sc.sel = b.deck.hand.slice(0, 5).map(c => c.id); sc.doDiscard(); } else { const alt = G.run.party.find(m => !isFainted(m) && m.uid !== b.leadUid); if (alt) sc.runEvents(b.switchLead(alt.uid, true)); } return; }
      sc.sel = best; sc.doPlay();
    } else if (sc instanceof RewardScene) {
      if (sc.busy) return;
      const r = sc.rewards.find(x => !x.claimed && !x.tried);
      if (r) { r.tried = true; sc.claim(r); return; }
      log.push('reward done');
      afterRewards(sc.battle, sc.cfg, sc.extra);
    } else if (sc instanceof ShopScene) {
      const it = sc.shop.items.find(i => !i.sold && G.run.money > i.price + 800 && (i.kind === 'relic' || i.kind === 'ball'));
      if (it && !sc._bought) { sc._bought = (sc._bought || 0) + 1; if (sc._bought < 4) sc.buy(it); else goToMap(); } else goToMap();
    } else if (sc instanceof CenterScene) {
      if (sc.busy) return;
      if (sc.done) goToMap(); else sc.heal();
    } else if (sc instanceof EventScene) {
      if (sc.busy) return;
      if (sc.result) goToMap();
      else { const c = sc.ev.choices.find(c => !c.cond || c.cond(G.run)); sc.choose(c); }
    } else if (sc instanceof TreasureScene) {
      if (!sc.opened) { sc.opened = true; G.run.addConsumable(sc.item); } else goToMap();
    } else if (sc instanceof ActClearScene) {
      log.push('act clear ' + G.run.actIndex);
      if (sc.opts.gauntletBreak) startGauntletBattle(); else nextAct();
    } else if (sc instanceof GameOverScene) { log.push('GAME OVER'); stop(); }
    else if (sc instanceof VictoryScene) { log.push('VICTORY'); stop(); }
  } catch (err) { log.push('ERROR ' + err.message + ' ' + err.stack); console.error(err); }
  if (sc === lastScene) stuck++; else { stuck = 0; lastScene = sc; }
}

export function start(opts = {}) {
  G.meta.settings.fast = true;
  Engine.timeScale = opts.speed || 4;
  stop();
  timer = setInterval(step, opts.interval || 120);
  return 'started';
}
export function stop() { if (timer) clearInterval(timer); timer = null; Engine.timeScale = 1; }
export function status() {
  const run = G.run;
  return { scene: Engine.scene?.constructor?.name, overlay: topOverlay()?.constructor?.name, act: run?.actIndex, floor: run?.floor, party: run?.party.map(m => `${D.species[m.species].name}${m.level} ${m.hp}/${maxHp(m)}`), log: log.slice(-8), errors: log.filter(l => l.startsWith('ERROR')).slice(-3) };
}

// Debug: jump to an act with a strong team.
export async function cheat(act = 3, level = 75, world) {
  const { Run } = await import('../game/run.js');
  const { makeMon } = await import('../game/pokemon.js');
  const { saveRun } = await import('../game/state.js');
  G.run = Run.create({ starter: regionOf(world).starters[1], world: world || 'kanto' });
  const r = G.run;
  r.party = ['CHARIZARD', 'BLASTOISE', 'VENUSAUR', 'SNORLAX', 'ALAKAZAM', 'GYARADOS'].map(s => makeMon(s, level, { rng: r.rng, minIV: 31 }));
  r.startAct(act);
  r.money = 99999;
  saveRun();
  goToMap();
  return 'ok';
}
export async function toBoss() {
  const r = G.run;
  const { enterNode } = await import('../scenes/flow.js');
  r.nodeId = Object.values(r.map.nodes).find(n => n.floor === r.act.floors - 1).id;
  enterNode('boss');
}
