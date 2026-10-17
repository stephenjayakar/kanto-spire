// Rewards screen (v0.6.7): SKIPping a "Teach a new move" reward (or "Don't learn" in the replace picker) keeps it on
// the list, marked skipped; tapping it again reopens the choice until the player leaves. Solo and co-op share
// RewardScene (co-op plays it on a private run clone).   node tests/reward_move_skip.test.mjs
import fs from 'fs';
import assert from 'assert/strict';
import { loadData, D } from '../web/src/game/data.js';
import { Run } from '../web/src/game/run.js';
import { knowsMove } from '../web/src/game/pokemon.js';

await loadData(async f => JSON.parse(fs.readFileSync('web/assets/data/' + f, 'utf8')));
globalThis.localStorage ||= { _s: {}, getItem(k) { return this._s[k] ?? null; }, setItem(k, v) { this._s[k] = String(v); }, removeItem(k) { delete this._s[k]; } };
const { Engine, topOverlay } = await import('../web/src/engine/core.js');
const { G } = await import('../web/src/game/state.js');
const { RewardScene, MoveChoiceModal, rewardsLeft } = await import('../web/src/scenes/reward.js');
const { MoveReplaceModal } = await import('../web/src/scenes/common.js');

let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log('PASS', name); } catch (e) { fail++; console.log('FAIL', name, '-', e.stack.split('\n').slice(0, 3).join(' | ')); } };
const tick = () => new Promise(r => setTimeout(r, 0));
// wait for the overlay of the given class, then answer it
async function answer(cls, value) {
  for (let i = 0; i < 50 && !(topOverlay() instanceof cls); i++) await tick();
  const o = topOverlay();
  assert.ok(o instanceof cls, `expected ${cls.name}, got ${o?.constructor?.name}`);
  o.close(value);
}
// a scene with just a move reward (no enter(): no battle, no audio)
function scene(run) {
  G.run = run;
  const mon = run.party[0];
  const move = Object.keys(D.moves).find(k => D.moves[k].power >= 60 && !knowsMove(mon, k));
  const s = new RewardScene({}, { kind: 'trainer' });
  s.rewards = [
    { kind: 'money', amount: 100, auto: true, claimed: true, label: '$100' },
    { kind: 'moves', choices: [{ uid: mon.uid, move }], label: 'Teach a new move' },
  ];
  return { s, r: s.rewards[1], mon, move };
}
const fullRun = () => {
  const run = Run.create({ starter: 'BULBASAUR', ascension: 0, seed: 'SKIP1' });
  const mon = run.party[0];
  for (const k of ['TACKLE', 'GROWL', 'VINE_WHIP', 'LEECH_SEED', 'POUND', 'SCRATCH']) if (mon.moves.length < 4 && D.moves[k] && !knowsMove(mon, k)) mon.moves.push({ move: k, copies: 1 });
  assert.equal(mon.moves.length, 4);
  return run;
};

await t('SKIP keeps the move reward, marked skipped, and it is not "left behind"', async () => {
  const { s, r } = scene(fullRun());
  const p = s.claim(r); await answer(MoveChoiceModal, null); await p;
  assert.equal(r.claimed, undefined, 'not claimed');
  assert.equal(r.skipped, true);
  assert.match(r.label, /^Teach a new move \(skipped/);
  assert.deepEqual(rewardsLeft(s.rewards), [], 'CONTINUE does not ask about a reward the player skipped');
});

await t('tapping the skipped reward reopens the choice and the replace picker; learning claims it', async () => {
  const { s, r, mon, move } = scene(fullRun());
  let p = s.claim(r); await answer(MoveChoiceModal, null); await p;
  // second time: pick the move, then decline the replace ("Don't learn"): still skipped, still there
  p = s.claim(r); await answer(MoveChoiceModal, r.choices[0]); await answer(MoveReplaceModal, -1); await p;
  assert.equal(r.skipped, true); assert.ok(!r.claimed); assert.ok(!knowsMove(mon, move));
  assert.equal(r.label, 'Teach a new move (skipped, tap to reopen)', 'label not stacked');
  // third time: replace slot 1
  const old = mon.moves[1].move;
  p = s.claim(r); await answer(MoveChoiceModal, r.choices[0]); await answer(MoveReplaceModal, 1);
  for (let i = 0; i < 50 && !r.claimed; i++) { await tick(); const o = topOverlay(); if (o && !(o instanceof MoveReplaceModal)) o.close(true); } // the "Poof!" toast
  await p;
  assert.equal(r.claimed, true); assert.equal(r.skipped, false); assert.equal(r.label, 'Teach a new move');
  assert.equal(mon.moves[1].move, move); assert.ok(!knowsMove(mon, old));
  assert.equal(Engine.overlays.length, 0);
});

await t('an untouched move reward still counts as left behind', async () => {
  const { s, r } = scene(fullRun());
  assert.deepEqual(rewardsLeft(s.rewards), [r]);
});

await t('co-op: the same scene on a private run clone (G.coop set) behaves the same', async () => {
  G.coop = { privateDone() {} };
  try {
    const { s, r } = scene(fullRun());
    const p = s.claim(r); await answer(MoveChoiceModal, null); await p;
    assert.equal(r.skipped, true); assert.ok(!r.claimed);
    const q = s.claim(r); await answer(MoveChoiceModal, null); await q;
    assert.equal(r.skipped, true, 'reopenable again');
  } finally { G.coop = null; }
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
