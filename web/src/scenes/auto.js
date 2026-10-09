// AUTO battle (solo and co-op): a toggle beside HINT that plays the HINT hand every turn at FAST speed, until the
// battle ends, the player stops it, or something needs a decision. It is input only: it selects bestHand() and
// presses ATTACK / LOCK IN exactly like a click would, so the battle (rules, RNG, the co-op action log) is unchanged.
// It never discards, switches, uses items or throws balls. Per battle: every battle starts with AUTO off (a run-wide
// AUTO would walk into the next trainer or gym leader unattended) and it is never saved.
import { Engine, W, keyPressed, hover } from '../engine/core.js';
import { button, pixBox, tip } from '../engine/ui.js';
import { text } from '../engine/font.js';

export const AUTO = {
  x: W - 229, w: 36,          // the AUTO button (x 411..447): right of the hint line, clear of a 4-card played row
  hintX: W - 190, hintW: 36,  // HINT, narrowed from 42 to make room for AUTO
  pick: 0.2,                  // s idle before AUTO selects the hand (a short beat to read the new turn)
  show: 0.35,                 // s the selected hand stays lifted before it is played
  lowHp: 0.25,                // AUTO stops when the lead's HP drops below this fraction
};

// U toggles AUTO; Esc or a right-click stops it.
export function autoKey() { return keyPressed('u') || keyPressed('U'); }
export function autoStopInput() { return keyPressed('Escape') || Engine.mouse.rclicked; }
// a manual pick (number keys, A / Enter, D) while AUTO is on hands control back
export function manualKey() {
  if (keyPressed('Enter') || keyPressed('a') || keyPressed('A') || keyPressed('d') || keyPressed('D')) return true;
  for (let k = 1; k <= 9; k++) if (keyPressed(String(k))) return true;
  return false;
}

// Is the lead below the AUTO HP line? `ack` = { uid, hp } when the player turned AUTO on with the lead already low:
// then it only stops once that lead loses more HP (or another low lead comes in).
export function autoLowHp(lead, max, ack) {
  if (!lead || lead.hp <= 0 || lead.hp / max >= AUTO.lowHp) return false;
  return !(ack && ack.uid === lead.uid && lead.hp >= ack.hp);
}

// The AUTO toggle (lit gold and pulsing while on). Returns true when clicked.
export function drawAutoButton(ctx, y, on, { disabled = false, coop = false } = {}) {
  const x = AUTO.x, w = AUTO.w, h = 26;
  if (on) {
    const pulse = 0.5 + 0.5 * Math.sin(Engine.time * 6);
    ctx.save(); ctx.globalAlpha = 0.35 + 0.65 * pulse; pixBox(ctx, x - 2, y - 2, w + 4, h + 3, '#f8d038', null, 4); ctx.restore();
  }
  const hit = button(ctx, on ? '' : 'AUTO', x, y, w, h, { color: on ? '#c06818' : '#3f7a6a', font: 'small', disabled: disabled && !on });
  if (on) { // lit: "AUTO / ON" on two lines (a click stops it)
    const press = hover(x, y, w, h) && Engine.mouse.down ? 2 : 0;
    text(ctx, 'AUTO', x + w / 2, y + press + 1, { align: 'center', color: 'white', font: 'small' });
    text(ctx, 'ON', x + w / 2, y + press + 10, { align: 'center', color: 'white', font: 'small' });
  }
  if (hover(x, y, w, h)) {
    tip(on ? 'AUTO ON' : 'AUTO', `${coop ? 'Locks in the HINT hand at your TARGET' : 'Plays the HINT hand'} for you every turn, at FAST speed, until the battle ends. Same battle, same luck: it never discards, switches, uses items or throws balls.
It stops by itself when there's no playable hand, your lead drops below ${Math.round(AUTO.lowHp * 100)}% HP or faints, or a menu opens.
Stop it any time: click it again, Esc or right-click.${coop ? ' UNLOCK also stops it.' : ''} Key: U.`, { width: 210 });
  }
  return hit;
}
