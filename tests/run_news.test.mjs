// NEW THIS RUN (v0.5.26): the end-of-run list of new records, POKéDEX entries and held items (game/run_news.js), and
// its hooks in state.js (snapshot at the run's first save, commit in endRun).   node tests/run_news.test.mjs
import fs from 'fs';
import assert from 'assert/strict';
import { loadData } from '../web/src/game/data.js';
import { Run } from '../web/src/game/run.js';
import { RELICS } from '../web/src/game/items.js';
import * as N from '../web/src/game/run_news.js';

await loadData(async f => JSON.parse(fs.readFileSync('web/assets/data/' + f, 'utf8')));
globalThis.localStorage ||= { _s: {}, getItem(k) { return this._s[k] ?? null; }, setItem(k, v) { this._s[k] = String(v); }, removeItem(k) { delete this._s[k]; } };
const st = await import('../web/src/game/state.js');

let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; } catch (e) { fail++; console.log('FAIL', name, '-', e.message, process.env.STACK ? e.stack : ''); } };
const [R1, R2, R3] = Object.keys(RELICS);
const freshMeta = (extra = {}) => ({ unlocks: {}, maxAscension: 0, bestAscensionWon: -1, dexSeen: [], dexCaught: [], relicsFound: [], runs: [], totalWins: 0, totalRuns: 0, shinies: [], shinyOn: {}, ascBy: {}, settings: {}, ...extra });

await t('seedRecords: an old save gets its records from the run history and bestAscensionWon, once', () => {
  const m = freshMeta({ bestAscensionWon: 3, runs: [{ act: 2, floor: 4, best: 900 }, { act: 3, floor: 1, best: 1500 }, { act: 3, floor: 0, best: 200 }] });
  assert.equal(N.seedRecords(m), true);
  assert.deepEqual(m.records, { furthest: N.progressValue(2, 1), bestHand: 1500, ascWon: 3 });
  assert.equal(m.records.furthest, 3002);
  assert.equal(N.seedRecords(m), false, 'already seeded');
  const blank = freshMeta();
  N.seedRecords(blank);
  assert.deepEqual(blank.records, { ascWon: -1 }, 'a new player: only "never won"');
});

await t('runNews: first catches, first sightings and new held items against the snapshot', () => {
  const snap = { seen: ['PIDGEY', 'RATTATA'], caught: ['PIDGEY'], relics: [R1], records: {} };
  const n = N.runNews(snap, { seen: ['PIDGEY', 'RATTATA', 'ZUBAT', 'ODDISH'], caught: ['PIDGEY', 'RATTATA', 'ODDISH'], relics: [R1, R2, R2, 'NOT_A_RELIC'], values: {} }, { isRelic: k => !!RELICS[k] });
  assert.deepEqual(n.caught, ['RATTATA', 'ODDISH'], 'seen before but caught now counts as a first catch; so does never seen');
  assert.deepEqual(n.seen, ['ZUBAT'], 'a new catch is not listed again as seen');
  assert.deepEqual(n.relics, [R2], 'deduped, unknown keys dropped');
  assert.equal(N.newsCount(n), 4);
  assert.equal(N.runNews(null, {}), null, 'no snapshot: no news');
  const same = N.runNews(snap, { seen: snap.seen, caught: snap.caught, relics: snap.relics, values: {} });
  assert.equal(N.newsCount(same), 0, 'nothing new: nothing to show');
});

await t('runNews: records only when beaten, never on a first value; FASTEST CLEAR is lower-is-better', () => {
  const snap = { seen: [], caught: [], relics: [], records: { bestHand: 1000, caught: 5, crits: 0, fastestWin: 40 * 60000, ascWon: 2, furthest: 3004 } };
  const n = N.runNews(snap, { values: { bestHand: 1200, caught: 5, crits: 0, trainers: 30, fastestWin: 35 * 60000, ascWon: 1, furthest: 3003, money: 9999 } });
  assert.deepEqual(n.records.map(r => r.key), ['fastestWin', 'bestHand']);
  assert.equal(n.records[1].text, '1,200 damage');
  assert.equal(n.records[1].prevText, '1,000 damage');
  assert.equal(n.records[0].text, '35 min');
  const first = N.runNews({ records: { ascWon: -1 } }, { values: { ascWon: 0 } });
  assert.deepEqual(first.records.map(r => [r.key, r.label, r.text, r.prevText]), [['ascWon', 'FIRST CHAMPIONSHIP', 'A0', null]]);
});

await t('applyRecords: improves, starts missing keys silently, keeps worse values out', () => {
  const m = { records: { bestHand: 500, fastestWin: 1000 } };
  assert.deepEqual(N.applyRecords(m, { bestHand: 400, fastestWin: 900, caught: 3 }), ['fastestWin']);
  assert.deepEqual(m.records, { bestHand: 500, fastestWin: 900, caught: 3 });
});

await t('startRunSnapshot: one per run, never overwritten, at most 4 kept', () => {
  const m = freshMeta({ dexSeen: ['A'], dexCaught: ['B'], relicsFound: [R1], records: { bestHand: 7 } });
  assert.equal(N.startRunSnapshot(m, 'k0'), true);
  assert.deepEqual(m.runSnaps.k0.seen.sort(), ['A', 'B'], 'caught counts as seen');
  m.dexSeen.push('C');
  assert.equal(N.startRunSnapshot(m, 'k0'), false);
  assert.ok(!m.runSnaps.k0.seen.includes('C'), 'the start-of-run copy stays');
  m.records.bestHand = 99;
  assert.equal(m.runSnaps.k0.records.bestHand, 7, 'a copy, not a reference');
  for (let i = 1; i <= 5; i++) { N.startRunSnapshot(m, 'k' + i); m.runSnaps['k' + i].at = 1000 + i; }
  m.runSnaps.k0.at = 0; N.startRunSnapshot(m, 'k6');
  assert.equal(Object.keys(m.runSnaps).length, 4);
  assert.ok(m.runSnaps.k6 && !m.runSnaps.k0 && !m.runSnaps.k1);
});

await t('solo: snapshot at the first saveRun, NEW list and records committed by endRun, then nothing new on a repeat', () => {
  st.G.coop = null;
  st.G.meta = freshMeta({ dexSeen: ['PIDGEY'], dexCaught: ['PIDGEY', 'SQUIRTLE'], relicsFound: [R1], records: { bestHand: 100, caught: 0, trainers: 0, crits: 0, money: 0, furthest: 1001, ascWon: -1 } });
  const run = Run.create({ starter: 'SQUIRTLE', ascension: 0, seed: 'NEWS1' });
  st.G.run = run;
  st.saveRun();
  const key = N.soloSnapKey(run);
  assert.ok(st.G.meta.runSnaps[key], 'snapshot taken');
  run.seen.push('PIDGEY', 'ZUBAT', 'ODDISH'); run.caughtSpecies.push('ODDISH');
  run.relics.push({ key: R1 }, { key: R2 });
  run.stats.bestHand = 450; run.stats.caught = 1; run.stats.trainers = 4;
  run.actIndex = 1; run.floor = 6;
  st.saveRun(); // (this save records R2 into meta.relicsFound; it must still count as new)
  assert.ok(st.G.meta.relicsFound.includes(R2));
  const before = JSON.stringify(run);
  const preview = N.soloRunNews(st.G.meta, run, 'lose');
  assert.equal(JSON.stringify(run), before, 'computing the news never touches the run');
  assert.equal(st.G.meta.records.bestHand, 100, 'a preview commits nothing');
  assert.equal(N.newsCount(preview), 7, 'the preview already lists it all (2 dex, 1 item, 4 records)');
  st.endRun(run, 'lose');
  const n = st.G.runNews;
  assert.deepEqual(n.caught, ['ODDISH']);
  assert.deepEqual(n.seen, ['ZUBAT']);
  assert.deepEqual(n.relics, [R2]);
  assert.deepEqual(n.records.map(r => r.key).sort(), ['bestHand', 'caught', 'furthest', 'trainers']);
  assert.equal(n.records.find(r => r.key === 'furthest').text, 'ACT 2, FLOOR 7');
  assert.equal(st.G.meta.records.bestHand, 450);
  assert.ok(!st.G.meta.runSnaps[key], 'snapshot dropped');
  st.saveRun(); // a late save of the finished run never snapshots it again
  assert.ok(!st.G.meta.runSnaps[key]);
  // the same run again: nothing new
  const run2 = Run.create({ starter: 'SQUIRTLE', ascension: 0, seed: 'NEWS2' });
  st.G.run = run2; st.saveRun();
  run2.seen.push('ZUBAT'); run2.caughtSpecies.push('ODDISH'); run2.relics.push({ key: R2 });
  run2.stats.bestHand = 450; run2.stats.caught = 1; run2.stats.trainers = 4; run2.actIndex = 1; run2.floor = 6;
  st.endRun(run2, 'lose');
  assert.equal(N.newsCount(st.G.runNews), 0);
});

await t('solo: a win records the clear time and the first championship; a save from before the update ends cleanly', () => {
  st.G.meta = freshMeta({ records: { ascWon: -1, fastestWin: 99 * 60000 } });
  const run = Run.create({ starter: 'CHARMANDER', ascension: 0, seed: 'NEWS3' });
  st.G.run = run; st.saveRun();
  run.stats.clearMs = 50 * 60000;
  st.endRun(run, 'win');
  assert.deepEqual(st.G.runNews.records.map(r => r.key).sort(), ['ascWon', 'fastestWin']);
  assert.equal(st.G.meta.records.ascWon, 0);
  const old = Run.create({ starter: 'CHARMANDER', ascension: 0, seed: 'NEWS4' }); // (no saveRun: no snapshot)
  st.endRun(old, 'lose');
  assert.equal(st.G.runNews, null);
});

await t('co-op: the local player\'s news from the room snapshot, once', () => {
  const meta = freshMeta({ dexSeen: ['PIDGEY'], records: { caught: 2, furthest: 2001 } });
  N.startRunSnapshot(meta, N.coopSnapKey('room1'));
  const mine = Run.create({ starter: 'BULBASAUR', ascension: 1, seed: 'C:p0', coop: true });
  mine.stats.caught = 3; mine.relics.push({ key: R3 });
  const game = { runs: [Run.create({ starter: 'CHARMANDER', seed: 'C:p1', coop: true }), mine], world: { actIndex: 2, floor: 3 } };
  meta.dexSeen.push('ZUBAT'); meta.dexCaught.push('ZUBAT'); // (the session merges the dex as the game goes)
  const n = N.coopRunNews(meta, game, 1, 'room1', { won: true, isRelic: k => !!RELICS[k] });
  assert.deepEqual(n.caught, ['ZUBAT']);
  assert.deepEqual(n.relics, [R3]);
  assert.deepEqual(n.records.map(r => r.key).sort(), ['caught', 'furthest']);
  assert.equal(meta.records.ascWon, 1, 'first value for a key: kept, not announced');
  assert.equal(N.coopRunNews(meta, game, 1, 'room1'), null, 'the snapshot is used up');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
