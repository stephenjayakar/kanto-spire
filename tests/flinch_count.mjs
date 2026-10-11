// Balance run with flinch counters (v0.5.0 check): node tests/flinch_count.mjs <balance.mjs args...>
import { Battle } from '../web/src/game/battle.js';
const S = { hands: 0, flinched: 0, capBlocked: 0, battles: 0, battlesWithFlinch: 0 };
const seen = new WeakSet();
const rh = Battle.prototype.resolveHand;
Battle.prototype.resolveHand = function (infos) {
  const before = this.flinchCount || 0;
  rh.call(this, infos);
  if (this.dry) return;
  S.hands++;
  if ((this.flinchCount || 0) > before) { S.flinched++; if (!seen.has(this)) { seen.add(this); S.battlesWithFlinch++; } }
};
const fl = Battle.prototype.flinch;
Battle.prototype.flinch = function (side, always) {
  const l = this.lead();
  if (side === 'player' && l && !this.dry && this.ms(l.uid).flinchedTurn === this.turn - 1) S.capBlocked++;
  return fl.call(this, side, always);
};
const st = Battle.prototype.start;
Battle.prototype.start = function () { S.battles++; return st.call(this); };
process.on('exit', () => console.log('FLINCH ' + JSON.stringify(S)));
await import('./balance.mjs');
