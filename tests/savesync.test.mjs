// Cloud save sync rules (v0.3.21, web/src/net/savesync.js): what gets pushed, and when. No network: the server is
// a stub that records every push. Also checks the save-frequency budget with a bot run: how many pushes a run
// costs with the game's real save calls (flow.js / scenes) replayed in order.
//   node tests/savesync.test.mjs
import assert from 'assert/strict';
import { SaveSync, SYNC_DELAY, KEEPALIVE_MAX } from '../web/src/net/savesync.js';

let pass = 0, fail = 0;
const tests = [];
const t = (name, fn) => tests.push([name, fn]);

// A local save plus a fake clock and server.
function rig({ fail: failing = 0, missingOnce = false } = {}) {
  const local = { meta: '{"a":1}', run: null };
  const timers = new Map();
  let now = 0, nextId = 1;
  const sent = [];
  let failures = failing, missing = missingOnce;
  const s = new SaveSync({
    read: () => ({ ...local }),
    send: async (parts, opts) => {
      if (failures > 0) { failures--; throw new Error('offline'); }
      sent.push({ parts: { ...parts }, keepalive: !!opts?.keepalive });
      if (missing && !('meta' in parts && 'run' in parts)) { missing = false; return { missing: true, wrote: [] }; }
      return { wrote: Object.keys(parts) };
    },
    setTimer: (fn, ms) => { const id = nextId++; timers.set(id, { at: now + ms, fn }); return id; },
    clearTimer: (id) => timers.delete(id),
    onError: () => {},
  });
  const tick = async (ms) => {
    now += ms;
    for (const [id, tm] of [...timers]) if (tm.at <= now) { timers.delete(id); tm.fn(); }
    await s.chain; await null;
  };
  return { s, local, sent, timers, tick, settle: () => s.chain };
}

t('unchanged save = no push (after a pull, and after a push)', async () => {
  const { s, local, sent, tick, settle } = rig();
  s.base(local.meta, local.run);
  s.queue(); await tick(SYNC_DELAY);
  s.queue('checkpoint'); await settle();
  assert.equal(sent.length, 0, 'nothing sent for a save equal to the server copy');
  local.run = '{"floor":1}';
  s.queue('checkpoint'); await settle();
  assert.equal(sent.length, 1);
  s.queue('checkpoint'); await settle();
  s.queue(); await tick(SYNC_DELAY);
  assert.equal(sent.length, 1, 'the same save again sends nothing');
  assert.equal(s.pushes, 1);
});

t('only the part that changed is sent', async () => {
  const { s, local, sent, settle } = rig();
  local.run = '{"floor":1}';
  s.base(local.meta, local.run);
  local.run = '{"floor":2}';
  s.queue('checkpoint'); await settle();
  assert.deepEqual(sent[0].parts, { run: '{"floor":2}' }, 'run only');
  local.meta = '{"a":2}';
  s.queue('checkpoint'); await settle();
  assert.deepEqual(sent[1].parts, { meta: '{"a":2}' }, 'meta only');
  local.run = null; // the run ended
  s.queue('checkpoint'); await settle();
  assert.deepEqual(sent[2].parts, { run: null }, 'a cleared run is sent as null');
});

t('unknown server copy (no cloud save yet) sends the whole save', async () => {
  const { s, local, sent, settle } = rig();
  s.reset();
  await s.flush(); await settle();
  assert.deepEqual(sent[0].parts, { meta: local.meta, run: null });
});

t('ordinary saves batch into one push per SYNC_DELAY; defer never pushes on its own; checkpoint pushes at once', async () => {
  const { s, local, sent, tick, settle } = rig();
  s.base(local.meta, local.run);
  for (let i = 0; i < 10; i++) { local.run = `{"pick":${i}}`; s.queue(); await tick(1000); }
  assert.equal(sent.length, 0, 'not yet');
  await tick(SYNC_DELAY);
  assert.equal(sent.length, 1, 'one push for the burst');
  assert.equal(sent[0].parts.run, '{"pick":9}', 'with the latest save');
  local.run = '{"inNode":true}'; s.queue('defer');
  await tick(SYNC_DELAY * 10);
  assert.equal(sent.length, 1, 'defer: no push of its own');
  local.run = '{"inNode":false}'; s.queue('checkpoint'); await settle();
  assert.equal(sent.length, 2, 'checkpoint pushes right away');
  await tick(SYNC_DELAY * 2);
  assert.equal(sent.length, 2, 'and leaves no timer behind');
});

t('a failed push is retried later and nothing is marked as synced', async () => {
  const { s, local, sent, tick, settle } = rig({ fail: 1 });
  s.base(local.meta, local.run);
  local.run = '{"x":1}'; s.queue('checkpoint'); await settle();
  assert.equal(sent.length, 0);
  assert.ok(s.dirty(), 'still dirty');
  await tick(SYNC_DELAY);
  assert.equal(sent.length, 1, 'retried');
  assert.ok(!s.dirty());
});

t('server without a copy to merge into ({missing}) gets the whole save', async () => {
  const { s, local, sent, settle } = rig({ missingOnce: true });
  s.base(local.meta, local.run);
  local.run = '{"x":1}'; s.queue('checkpoint'); await settle();
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[1].parts, { meta: local.meta, run: '{"x":1}' });
  assert.ok(!s.dirty());
});

t('leaving the page: flushNow sends at once with keepalive (unless too big for it)', async () => {
  const { s, local, sent } = rig();
  s.base(local.meta, local.run);
  assert.equal(await s.flushNow(), false, 'nothing to send');
  local.run = '{"x":1}'; s.queue('defer');
  await s.flushNow();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].keepalive, true);
  local.run = JSON.stringify({ big: 'x'.repeat(KEEPALIVE_MAX) });
  await s.flushNow();
  assert.equal(sent[1].keepalive, false, 'a body over the keepalive cap goes as a normal request');
});

// ---- save budget: the game's save calls over a bot run --------------------------------------------------------
// The scenes' save calls per node, in order (see flow.js, reward.js, shop.js, ...): enterNode saveRun('defer'), the
// node's own saves (picks, purchases), goToMap saveRun('checkpoint'). Each takes a few seconds of play.
t('a 50-node run costs about one push per node (was several, each of the whole save)', async () => {
  const { s, local, sent, tick, settle } = rig();
  s.base(local.meta, local.run);
  let v = 0, clock = 0;
  const saveTimes = [];
  const save = (mode) => { local.run = `{"v":${++v}}`; s.queue(mode); saveTimes.push(clock); };
  const wait = async (ms) => { clock += ms; await tick(ms); };
  for (let node = 0; node < 50; node++) {
    save('defer'); await wait(40_000); // enter + a battle
    for (let k = 0; k < 3; k++) { save(); await wait(4000); } // reward picks
    save('checkpoint'); await settle(); await wait(3000); // back on the map
  }
  // the old rule: every save restarted a 1.5 s timer, and each time it ran out the whole save went up
  const old = saveTimes.filter((at, i) => i === saveTimes.length - 1 || saveTimes[i + 1] - at >= 1500).length;
  assert.ok(sent.length <= 55 && sent.length >= 50, `${sent.length} pushes for 50 nodes`);
  assert.ok(sent.every(x => !('meta' in x.parts)), 'meta untouched: never sent');
  console.log(`    (50 nodes -> ${sent.length} pushes of the run part; the old 1.5 s debounce: ${old} pushes of meta + run)`);
});

for (const [name, fn] of tests) {
  try { await fn(); pass++; console.log('PASS ' + name); }
  catch (e) { fail++; console.log('FAIL ' + name + '\n  ' + (e.stack || e).toString().split('\n').slice(0, 4).join('\n  ')); }
}
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
