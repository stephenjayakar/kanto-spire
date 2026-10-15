// Battle speed (solo and co-op): Settings > ANIMATIONS and the chip in the battle scene's top-right corner cycle
// NORMAL -> FAST -> INSTANT. INSTANT plays a turn out with no move animations, no waits, no messages and no sound
// effects: the next turn (or the reward screen) comes up at once with every effect already on screen.
// Presentation only: the battle engine resolves the whole turn (damage, statuses, drops, RNG) before the scene animates
// it, and the scene never touches battle or run state, so the result (and co-op's shared action log) is the same at
// every speed. Saved in G.meta.settings: `fast` (FAST and INSTANT) and `instant` (INSTANT).
// Generalizes the dev-only ?noanim=1 switch (engine/core.js Engine.noAnim): both go through Engine.instant().
import { Engine, tween as coreTween, hover } from '../engine/core.js';
import { button, pixBox, tip } from '../engine/ui.js';
import { G, saveMeta } from '../game/state.js';
import { Sound } from '../audio/sound.js';

export const SPEEDS = [
  ['normal', 'NORMAL', 'Battles play every animation and message at normal speed.'],
  ['fast', 'FAST', 'Animations and messages play about twice as fast (map and reward screens too).'],
  ['instant', 'INSTANT', 'Battle turns resolve at once: no move animations, messages or sound effects, straight to your next turn with every effect applied. Same battle, same luck.'],
];
export function speedMode(s = G.meta.settings) { return s.instant ? 'instant' : s.fast ? 'fast' : 'normal'; }
export function setSpeedMode(mode, s = G.meta.settings) {
  s.fast = mode !== 'normal';
  s.instant = mode === 'instant';
  saveMeta();
}
// (the setting itself; a battle scene only collapses time while it plays out a turn: see Engine.instant())
export function instantOn() { return !!G.meta.settings.instant; }

// A battle scene's tween: under Engine.instant() it lands on its end values right away, in call order. (Timed tweens
// all started in the same frame would finish together in reverse order, leaving an HP bar on an early value.)
export function battleTween(obj, props, dur, ease, delay) {
  if (!Engine.instant()) return coreTween(obj, props, dur, ease, delay);
  Object.assign(obj, props);
  return Promise.resolve();
}

// Sound effects and cries are muted while a turn plays out instantly (dozens would fire in one frame); music plays on.
Sound.hush = () => Engine.instant();

// The speed chip: top-right corner of the battle scene. A click cycles NORMAL -> FAST -> INSTANT and saves it.
// Returns the new mode when clicked (the scene updates its own `fast`), else null.
export const SPEED_CHIP = { w: 50, h: 15 };
export function drawSpeedChip(ctx, x, y) {
  const mode = speedMode();
  const i = SPEEDS.findIndex(m => m[0] === mode);
  const [, label, body] = SPEEDS[i];
  const color = mode === 'instant' ? '#c06818' : mode === 'fast' ? '#3f7a6a' : '#506080';
  if (mode === 'instant') { ctx.save(); ctx.globalAlpha = 0.5; pixBox(ctx, x - 1, y - 1, SPEED_CHIP.w + 2, SPEED_CHIP.h + 2, '#f8d038', null, 3); ctx.restore(); }
  const hit = button(ctx, label, x, y, SPEED_CHIP.w, SPEED_CHIP.h, { color, font: 'small' }); // (plays se_select)
  if (hover(x, y, SPEED_CHIP.w, SPEED_CHIP.h)) tip(`BATTLE SPEED: ${label}`, `${body}\nClick to cycle NORMAL / FAST / INSTANT (also in SETTINGS).`, { width: 210 });
  if (!hit) return null;
  const next = SPEEDS[(i + 1) % SPEEDS.length][0];
  setSpeedMode(next);
  return next;
}
