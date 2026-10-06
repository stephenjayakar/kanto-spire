// In-page driver for tests/freeze_audit.cjs (injected as a module script). Plays the real scenes the way a
// player would answer them, one action per step(policy), and reports a progress signature for the watchdog.
// Message boxes are advanced by REAL mouse clicks (the step returns {click: [x, y]} in game pixels).
import { Engine, topOverlay } from '/src/engine/core.js';
import { G } from '/src/game/state.js';
import { isFainted, maxHp } from '/src/game/pokemon.js';
import { MapScene } from '/src/scenes/map.js';
import { BattleScene } from '/src/scenes/battle.js';
import { RewardScene, MoveChoiceModal, RelicChoiceModal } from '/src/scenes/reward.js';
import { ActClearScene } from '/src/scenes/gameover.js';
import { MoveReplaceModal, PartyPicker, ChoiceModal, DeckModal } from '/src/scenes/common.js';
import { BagFullModal } from '/src/scenes/items_ui.js';
import { StarterUnlockModal } from '/src/scenes/unlock.js';
import { afterRewards } from '/src/scenes/flow.js';
import { EventScene, RelicPickModal, MonChoiceModal } from '/src/scenes/event.js';
import { choiceLabel, upgradeTarget, powerCap } from '/src/game/events.js';

const name = (o) => o?.constructor?.name || null;

function sig() {
  const sc = Engine.scene, ov = topOverlay(), b = sc?.b, run = G.run;
  return JSON.stringify([
    name(sc), name(ov), Engine.overlays.length, !!sc?.busy, sc?.msg?.cur?.str || null, sc?.msg?.queue?.length || 0,
    b?.turn, b?.handsPlayed, b?.enemyIndex, b?.enemy?.()?.hp, b?.result?.outcome || null, b?.deck?.hand?.length,
    run?.party?.map(m => m.hp).join(','), run?.party?.length, sc?.rewards?.filter(r => r.claimed).length, run?.nodeId, run?.actIndex,
    sc?.result?.text?.length ?? null, sc?.steps?.length ?? null, run?.relics?.length, run?.money,
  ]);
}

export function state() {
  const sc = Engine.scene, ov = topOverlay(), b = sc?.b, run = G.run;
  return {
    scene: name(sc), overlay: name(ov), ovTitle: ov?.title || null, busy: !!sc?.busy, msg: sc?.msg?.cur?.str || null,
    ev: sc?.ev?.id || null, evResult: sc?.result?.text || null, relics: run?.relics?.map(r => r.key), money: run?.money,
    enemy: b?.enemy?.()?.species || null, enemyHp: b?.enemy?.()?.hp, result: b?.result?.outcome || null, turn: b?.turn,
    party: run?.party?.map(m => `${m.species}${m.lost ? '(lost)' : ''}:${m.hp}`), act: run?.actIndex, node: run?.nodeId,
    sound: { ready: window.__sound?.ready, unlocked: window.__sound?.unlocked, backend: window.__sound?.backend, bgm: window.__sound?.currentBGM },
  };
}

function subsets(arr, max) {
  const out = [];
  for (let mask = 1; mask < (1 << arr.length); mask++) { const s = arr.filter((_, i) => mask & (1 << i)); if (s.length <= max) out.push(s); }
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
function weakestHand(b) {
  const hand = b.deck.hand.filter(c => b.cardInfo(c).playable).map(c => c.id);
  for (const id of hand) if (b.canPlay([id]).ok) return [id];
  return null;
}

let lastAct = 0, deckPicks = 0;
export function step(p = {}) {
  const out = { sig: sig(), did: null };
  const now = performance.now();
  if (now - lastAct < (p.minGap || 120)) return out;
  const sc = Engine.scene, ov = topOverlay(), run = G.run;
  const act = (did, extra = {}) => { lastAct = now; return Object.assign(out, { did }, extra); };
  if (ov) {
    if ((ov.t || 0) < 0.3) return out; // let it open like a player would see it
    if (ov instanceof StarterUnlockModal) { ov.choose(ov.offer.options[p.unlockPick || 0]); return act('unlock ' + ov.offer.options[p.unlockPick || 0]); }
    if (ov instanceof BagFullModal) {
      const c = p.bag === 'sell' ? { act: 'sellBag', key: run.consumables[0] } : p.bag === 'useNew' ? { act: 'useNew' } : { act: 'leave' };
      ov.close(c); return act('bagfull ' + c.act);
    }
    if (ov instanceof ChoiceModal) {
      if (/^Catch /.test(ov.title || '')) { const v = p.catch === 'decline' ? 0 : 1; ov.close(v); return act('catch ' + (v ? 'accept' : 'decline')); }
      const o = ov.options.find(x => !x.disabled); ov.close(o?.value ?? 0); return act('choice ' + (ov.title || '') + ' -> ' + (o?.label || ''));
    }
    if (ov instanceof PartyPicker) {
      const ok = run.party.filter(m => !ov.filter || ov.filter(m) === true);
      const m = /Release/i.test(ov.title || '') ? ok[ok.length - 1] : ok[0];
      ov.close(m || null); return act('party ' + (ov.title || '') + ' -> ' + (m?.species || 'none'));
    }
    if (ov instanceof RelicChoiceModal) { ov.close(p.relic === 'skip' ? null : ov.choices[0] || null); return act('relic'); }
    if (ov instanceof MoveChoiceModal) { ov.close(ov.choices[0] || null); return act('move'); }
    if (ov instanceof MoveReplaceModal) { ov.close(-1); return act('move replace skip'); }
    if (ov instanceof MonChoiceModal) { ov.close(ov.mons[0] || null); return act('mon ' + (ov.mons[0]?.species || 'none')); }
    if (ov instanceof RelicPickModal) { ov.close(ov.keys[0] || null); return act('give ' + (ov.keys[0] || 'none')); }
    if (ov instanceof DeckModal) {
      if (!ov.onPick) { ov.close(null); return act('deck'); }
      // copies must go to different moves, an upgrade needs an upgradable attack
      let mon = run.party[0], index = deckPicks++ % mon.moves.length;
      if (/upgrade/i.test(ov.title || '')) for (const m of run.party) { const i = m.moves.findIndex(mv => upgradeTarget(m, mv.move, powerCap(run))); if (i >= 0) { mon = m; index = i; break; } }
      ov.close({ mon, index }); return act(`deck ${mon.species}/${index}`);
    }
    return act('click overlay', { click: [320, 300] }); // toasts and other "tap to continue" overlays
  }
  if (sc instanceof BattleScene) {
    if (sc.msg.active) return act('click msg', { click: [400, 200] });
    if (sc.busy) return out;
    const b = sc.b;
    if (b.result) return out;
    if (sc.stuck) { sc.doPass(); return act('pass'); }
    const hand = p.battle === 'lose' ? weakestHand(b) : bestHand(b);
    if (hand) { sc.sel = hand; sc.doPlay(); return act('play ' + hand.length); }
    if (sc.canDiscard(Math.min(2, b.deck.hand.length))) { sc.sel = b.deck.hand.slice(0, 2).map(c => c.id); sc.doDiscard(); return act('discard'); }
    return out;
  }
  if (sc instanceof RewardScene) {
    if (sc.busy || sc.offering) return out;
    const r = sc.rewards.find(x => !x.claimed && !x.tried);
    if (r) { r.tried = true; sc.claim(r); return act('claim ' + r.kind); }
    afterRewards(sc.battle, sc.cfg, sc.extra); return act('rewards done');
  }
  if (sc instanceof ActClearScene) {
    if (p.stopAtActClear) return out;
    if (sc.opts?.gauntletBreak) return act('gauntlet break: ENTER', { click: [400, 305] }); // (the next ELITE FOUR room)
    return act('act clear continue', { click: [320, 305] });
  }
  // "?" events: p.event / p.step = regex source for the choice to click (default: the first); then CONTINUE
  if (sc instanceof EventScene) {
    if (sc.busy) return out;
    if (!sc.result || sc.steps) {
      const list = sc.choices();
      const gap = Math.min(32, Math.floor(142 / Math.max(1, list.length))), bh = Math.min(26, gap - 4);
      const src = sc.steps ? p.step : p.event, re = src ? new RegExp(src) : null;
      let i = re ? list.findIndex(c => re.test(choiceLabel(c, run))) : 0;
      if (i < 0) i = list.length - 1;
      return act('event choice ' + choiceLabel(list[i], run), { click: [440, 192 + i * gap + bh / 2] });
    }
    return act('event continue', { click: [440, 310] });
  }
  if (sc instanceof MapScene) {
    if (sc.msg.active) return act('click map msg', { click: [320, 57] });
  }
  return out;
}

window.__audit = { step, state, sig };
