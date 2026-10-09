// v0.3.12: a finished co-op room goes through cloud.js's offline-safe run queue to coop:finish.
// node tests/coop_queue.test.mjs   (fake localStorage + fetch; no network)
import assert from 'assert/strict';

console.warn = () => {}; // (the queue logs its retries)
const mem = new Map();
globalThis.localStorage = { getItem: k => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k) };
const calls = [];
let reply = () => ({ status: 'success', value: { score: 1 } });
globalThis.fetch = async (url, init) => {
  const body = JSON.parse(init.body);
  calls.push(body.path);
  const r = reply(body);
  if (r instanceof Error) throw r;
  return { status: 200, json: async () => r };
};
const { Cloud, queueCoopRun, queueRun, flushQueue, pendingRuns } = await import('../web/src/net/cloud.js');
const jwt = 'x.' + Buffer.from(JSON.stringify({ exp: Date.now() / 1000 + 3600 })).toString('base64') + '.y';
Object.assign(Cloud, { url: 'https://dev.example', auth: { token: jwt, refreshToken: 'r' }, me: { email: 'a@b.c', name: 'A' } });

let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; } catch (e) { fail++; console.log('FAIL', name, '-', e.stack.split('\n').slice(0, 3).join(' | ')); } };
const run = { result: 'win', clientRunId: 'coop-ABCDE' };
const soloRun = { seed: 'S1', stats: { startTime: 5 }, party: [{ species: 'BULBASAUR', level: 5 }], starter: 'BULBASAUR', ascension: 0, actIndex: 0, floor: 1 };

await t('queued team run goes to coop:finish and leaves the queue', async () => {
  calls.length = 0;
  await queueCoopRun('room1', run);
  assert.deepEqual(calls, ['coop:finish']);
  assert.equal(pendingRuns(), 0);
  assert.deepEqual(Cloud.lastResult, { status: 'saved', score: 1 });
});

await t('the same room queued twice is sent once per flush (kept once in the queue)', async () => {
  calls.length = 0;
  reply = () => new TypeError('Failed to fetch'); // offline
  await queueCoopRun('room2', run);
  await queueCoopRun('room2', run);
  assert.equal(pendingRuns(), 1, 'still queued while offline');
  assert.equal(Cloud.lastResult.status, 'error');
  reply = () => ({ status: 'success', value: { score: 7, duplicate: true } });
  calls.length = 0;
  await flushQueue(); // (back online: e.g. the next page load)
  assert.deepEqual(calls, ['coop:finish']);
  assert.equal(pendingRuns(), 0);
});

await t('an older server without coop:finish keeps the team run queued without blocking solo runs', async () => {
  calls.length = 0;
  reply = (b) => (b.path === 'coop:finish' ? { status: 'error', errorMessage: "Could not find public function for 'coop:finish'." } : { status: 'success', value: { score: 3 } });
  await queueCoopRun('room3', run);
  queueRun(soloRun, 'lose');
  await flushQueue();
  assert.ok(calls.includes('runs:submit'), 'the solo run behind it went up');
  assert.equal(pendingRuns(), 1, 'the team run waits for the new server');
  reply = () => ({ status: 'success', value: { score: 9 } });
  await flushQueue();
  assert.equal(pendingRuns(), 0);
});

await t('a room the server no longer has is dropped', async () => {
  reply = () => ({ status: 'error', errorMessage: 'Uncaught Error: Room not found\n    at x' });
  await queueCoopRun('room4', run);
  assert.equal(pendingRuns(), 0);
});

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
