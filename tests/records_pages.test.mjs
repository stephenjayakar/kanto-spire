// v0.5.2 RECORDS pages (LOAD MORE): convex/runs.ts leaderboardPage / minePage and convex/players.ts topPage, run on an
// in-memory database (no deployment). Pages must cover the whole list once, in order, with no duplicates; the old
// leaderboard / mine / top queries must answer exactly as before (older clients).   node tests/records_pages.test.mjs
import fs from 'fs';
import path from 'path';
import assert from 'assert/strict';
import { fileURLToPath, pathToFileURL } from 'url';
import { createRequire } from 'module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const out = path.join(root, 'tests', 'out', 'records_pages');
fs.mkdirSync(out, { recursive: true });
const load = async (name) => {
  const file = path.join(out, name + '.mjs');
  await esbuild.build({ entryPoints: [path.join(root, 'convex', name + '.ts')], bundle: true, format: 'esm', platform: 'node', outfile: file, logLevel: 'silent' });
  return import(pathToFileURL(file).href + '?' + Date.now());
};
const [RUNS, PLAYERS, SCHEMA] = await Promise.all(['runs', 'players', 'schema'].map(load));

// ---- in-memory ctx.db: the index field order comes from convex/schema.ts ----------------------
const INDEX = {};
for (const [table, def] of Object.entries(SCHEMA.default.tables)) {
  INDEX[table] = {};
  for (const ix of def.indexes || def[' indexes']?.() || []) INDEX[table][ix.indexDescriptor] = ix.fields;
}
assert.ok(INDEX.runs.by_version_score, 'schema indexes read');
const cmp = (a, b) => (a === b ? 0 : a === undefined ? -1 : b === undefined ? 1 : a < b ? -1 : 1);
let reads = 0;
function makeDb(tables) {
  let nextT = 1;
  for (const rows of Object.values(tables)) for (const r of rows) { r._creationTime ??= nextT++; }
  const query = (table) => {
    let fields = ['_creationTime'], conds = [], desc = false;
    const api = {
      withIndex(name, fn) {
        fields = [...(INDEX[table][name] || assert.fail(`no index ${table}.${name}`)), '_creationTime'];
        const b = { eq: (f, v) => (conds.push([f, 'eq', v]), b), lt: (f, v) => (conds.push([f, 'lt', v]), b), lte: (f, v) => (conds.push([f, 'lte', v]), b), gt: (f, v) => (conds.push([f, 'gt', v]), b), gte: (f, v) => (conds.push([f, 'gte', v]), b) };
        if (fn) fn(b);
        return api;
      },
      order(o) { desc = o === 'desc'; return api; },
      rows() {
        const ok = (r) => conds.every(([f, op, v]) => { const c = cmp(r[f], v); return op === 'eq' ? c === 0 : op === 'lt' ? c < 0 : op === 'lte' ? c <= 0 : op === 'gt' ? c > 0 : c >= 0; });
        const rows = (tables[table] || []).filter(ok).sort((a, b) => { for (const f of fields) { const c = cmp(a[f], b[f]); if (c) return c; } return 0; });
        return desc ? rows.reverse() : rows;
      },
      async first() { const r = api.rows()[0] ?? null; if (r) reads++; return r; },
      async unique() { const r = api.rows(); if (r.length > 1) throw new Error('not unique'); reads += r.length; return r[0] ?? null; },
      async take(n) { const r = api.rows().slice(0, n); reads += r.length; return r; },
      async collect() { const r = api.rows(); reads += r.length; return r; },
      async paginate({ numItems, cursor }) {
        const all = api.rows(), start = cursor ? +cursor : 0, page = all.slice(start, start + numItems);
        reads += page.length;
        return { page, isDone: start + numItems >= all.length, continueCursor: String(start + page.length) };
      },
      async *[Symbol.asyncIterator]() { for (const r of api.rows()) { reads++; yield r; } },
    };
    return api;
  };
  return { query, get: async (id) => { for (const rows of Object.values(tables)) { const r = rows.find(x => x._id === id); if (r) { reads++; return r; } } return null; } };
}
const ctxFor = (db, userId) => ({ db, auth: { getUserIdentity: async () => (userId ? { subject: userId + '|s' } : null) } });
const call = (fn, ctx, args) => fn._handler(ctx, args);

// ---- a world: 7 trainers, 230 runs over 2 versions, a co-op room the viewer joined as a partner -----------
const users = [], players = [], runs = [], allowedEmails = [];
for (let k = 0; k < 7; k++) {
  const email = `t${k}@x.test`;
  users.push({ _id: 'u' + k, email });
  allowedEmails.push({ _id: 'a' + k, email });
  players.push({ _id: 'p' + k, userId: 'u' + k, email, name: 'T' + k, nameLower: 't' + k, runs: 0, wins: 0, bestScore: 0, createdAt: 1 });
}
players.push({ _id: 'p7', userId: 'u7', email: 'idle@x.test', name: 'IDLE', nameLower: 'idle', runs: 0, wins: 0, bestScore: 0, createdAt: 1 });
for (let i = 0; i < 230; i++) {
  const p = players[i % 7], score = 1000 + ((i * 7919) % 5000) - (i % 3 === 0 ? 0 : 0), version = i % 4 ? 'v0.5.1' : 'v0.5.2';
  const sc = i === 50 || i === 51 ? 4242 : score; // (a tie at a page edge)
  runs.push({ _id: 'r' + i, playerId: p._id, playerName: p.name, clientRunId: 'c' + i, score: sc, result: i % 5 ? 'lose' : 'win', world: i % 2 ? 'spire' : 'kanto', version, finishedAt: 1e12 + i * 1000 });
  p.runs++; if (i % 5 === 0) p.wins++; p.bestScore = Math.max(p.bestScore, sc);
}
// t1 played (as slot 1) in two finished co-op rooms hosted by t0: those team runs are t0's rows
const coopRooms = [{ _id: 'room1', code: 'AAAAA', status: 'closed', result: 'win' }, { _id: 'room2', code: 'BBBBB', status: 'closed', result: 'lose' }];
const coopMembers = [
  { _id: 'm1', roomId: 'room1', slot: 0, email: 't0@x.test' }, { _id: 'm2', roomId: 'room1', slot: 1, email: 't1@x.test' },
  { _id: 'm3', roomId: 'room2', slot: 0, email: 't0@x.test' }, { _id: 'm4', roomId: 'room2', slot: 1, email: 't1@x.test' },
];
runs.push({ _id: 'rc1', playerId: 'p0', playerName: 'T0', clientRunId: 'coop-AAAAA', score: 3333, result: 'win', world: 'spire', version: 'v0.5.2', finishedAt: 1e12 + 5 * 1000 + 1, coop: { room: 'AAAAA', with: ['T1'] } });
runs.push({ _id: 'rc2', playerId: 'p0', playerName: 'T0', clientRunId: 'coop-BBBBB', score: 2222, result: 'lose', world: 'spire', version: 'v0.5.1', finishedAt: 1e12 + 200 * 1000 + 1, coop: { room: 'BBBBB', with: ['T1'] } });
const db = makeDb({ users, players, runs, allowedEmails, coopRooms, coopMembers });
const ctx = ctxFor(db, 'u1');

let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; } catch (e) { fail++; console.log('FAIL', name, '-', e.stack.split('\n').slice(0, 3).join(' | ')); } };
// Every page of a paged query, in order: rows (by _id) and the page count.
async function allPages(fn, args, n = 50, extra = () => ({})) {
  const rows = [];
  let cursor = null, pages = 0;
  for (;;) {
    const res = await call(fn, ctx, { ...args, ...extra(rows), paginationOpts: { numItems: n, cursor } });
    pages++;
    rows.push(...res.page);
    if (res.isDone) break;
    cursor = res.continueCursor;
    assert.ok(pages < 100, 'ends');
  }
  return { rows, pages };
}
const ids = (rows) => rows.map(r => r._id ?? r.id);
const sortedBy = (rows, k) => rows.slice().sort((a, b) => b[k] - a[k] || b._creationTime - a._creationTime);

await t('leaderboardPage: every sort / world / version filter pages through the whole list once, in index order', async () => {
  for (const sort of ['recent', 'score', undefined]) for (const world of [undefined, 'spire']) for (const version of [undefined, 'v0.5.1']) {
    const want = sortedBy(runs.filter(r => (!world || r.world === world) && (!version || r.version === version)), sort === 'recent' ? 'finishedAt' : 'score');
    const { rows, pages } = await allPages(RUNS.leaderboardPage, { sort, world, version });
    assert.deepEqual(ids(rows), ids(want), `${sort} ${world} ${version}`);
    assert.equal(new Set(ids(rows)).size, rows.length, 'no duplicates');
    assert.equal(pages, Math.max(1, Math.ceil(want.length / 50)) + (want.length % 50 === 0 ? 0 : 0));
    // page 1 = the old query's 50 (older clients see the same list)
    const old = await call(RUNS.leaderboard, ctx, { sort, world, version, limit: 50 });
    assert.deepEqual(ids(old), ids(want.slice(0, 50)));
  }
  // numItems is clamped (no 10k-row pages)
  const big = await call(RUNS.leaderboardPage, ctx, { paginationOpts: { numItems: 10000, cursor: null } });
  assert.equal(big.page.length, 100);
});

await t('minePage: own runs newest first plus the partner\'s co-op team runs, each once, in date order; totals on page 1', async () => {
  for (const version of [undefined, 'v0.5.1', 'v0.5.2']) {
    const own = runs.filter(r => r.playerId === 'p1' && (!version || r.version === version));
    const team = runs.filter(r => r.coop && (!version || r.version === version));
    const want = [...own, ...team].sort((a, b) => b.finishedAt - a.finishedAt);
    for (const n of [5, 10, 50]) {
      const { rows } = await allPages(RUNS.minePage, { version }, n, (got) => (got.length ? { before: got[got.length - 1].finishedAt } : {}));
      assert.deepEqual(ids(rows), ids(want), `${version} n=${n}`);
    }
    const p1 = await call(RUNS.minePage, ctx, { version, paginationOpts: { numItems: 50, cursor: null } });
    const old = await call(RUNS.mine, ctx, { version, limit: 50 });
    assert.deepEqual(p1.player, old.player, 'the same totals as mine');
    assert.deepEqual(ids(p1.page.slice(0, 50)), ids(old.recent), 'page 1 starts like mine\'s recent list');
  }
  assert.equal(await call(RUNS.minePage, ctxFor(db, 'nobody'), { paginationOpts: { numItems: 50, cursor: null } }).catch(e => 'denied'), 'denied');
});

await t('topPage: trainers ranked by best score, all-time and per version, in pages, each trainer once', async () => {
  const allTime = players.filter(p => p.runs > 0).sort((a, b) => b.bestScore - a.bestScore).map(p => p._id);
  for (const n of [2, 3, 50]) {
    const { rows } = await allPages(PLAYERS.topPage, {}, n);
    assert.deepEqual(ids(rows), allTime, 'all-time n=' + n);
  }
  const old = await call(PLAYERS.top, ctx, { limit: 50 });
  assert.deepEqual(ids(old), allTime);
  for (const version of ['v0.5.1', 'v0.5.2']) {
    const best = new Map();
    for (const r of sortedBy(runs.filter(r => r.version === version), 'score')) if (!best.has(r.playerId)) best.set(r.playerId, r.score);
    for (const n of [1, 2, 3, 50]) {
      const { rows } = await allPages(PLAYERS.topPage, { version }, n);
      assert.deepEqual(rows.map(r => [r.id, r.bestScore]), [...best], `${version} n=${n}`);
    }
    const oldV = await call(PLAYERS.top, ctx, { version, limit: 50 });
    const p1 = await call(PLAYERS.topPage, ctx, { version, paginationOpts: { numItems: 50, cursor: null } });
    assert.deepEqual(p1.page, oldV, 'page 1 = the old list');
  }
});

await t('pages read only their own index range (no table scans)', async () => {
  reads = 0;
  await call(RUNS.leaderboardPage, ctx, { sort: 'score', paginationOpts: { numItems: 50, cursor: '100' } });
  assert.ok(reads <= 50 + 10, 'reads ' + reads); // (+ the auth lookups)
});

console.log(`records pages tests: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
