// v0.3.21 cloud saves (convex/progress.ts) against the DEV Convex deployment (never prod):
// - a save in the legacy format (one progress row) still loads, and is copied into the new tables by the first
//   new-format save, which leaves the progress row as it was;
// - older clients' progress:save (both parts) keeps working; an unchanged part is not rewritten;
// - progress:put writes only the parts sent, nothing when they are unchanged; run null clears the run;
// - a partial push with nothing to merge into answers { missing: true };
// - with MEASURE=1 it also prints the database I/O of each call (from `convex logs`).
// One throwaway test account (deleted afterwards). Needs dev functions pushed from this branch and COOP_TEST=1.
// Usage: E2E_DEV_DEPLOYMENT=<dev name> [MEASURE=1] node tests/progress_api.test.cjs
const A = require('./coop_auth.cjs');
const fs = require('fs'), path = require('path');
const { spawn } = require('child_process');

const EMAIL = 'save-test@kanto-spire.test';
let passes = 0, fails = 0;
const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (cond) passes++; else { fails++; process.exitCode = 1; } };

// A realistic save: a bot's spire run 35 nodes in, and a meta with a full history.
async function realisticSave() {
  const R = (p) => 'file:///' + path.join(__dirname, '..', p).split(path.sep).join('/');
  const { loadData } = await import(R('web/src/game/data.js'));
  const { Run } = await import(R('web/src/game/run.js'));
  const { playSoloNodes } = await import(R('tests/save_helpers.mjs'));
  await loadData(async f => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'web', 'assets', 'data', f), 'utf8')));
  const run = Run.create({ starter: 'CHARMANDER', ascension: 0, seed: 'S3', world: 'spire', pool: ['kanto', 'hoenn', 'johto'] });
  for (let i = 0; i < 35; i++) playSoloNodes(run, 1, 'S30:' + i);
  const species = Object.keys(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'web', 'assets', 'data', 'species.json'), 'utf8'))).slice(0, 250);
  const meta = {
    unlocks: { act2: true, act3: true, win: true }, maxAscension: 3, shinies: [], shinyOn: {}, bestAscensionWon: 2,
    dexSeen: species, dexCaught: species.slice(0, 120), totalWins: 4, totalRuns: 30, starterVer: 2, unlockedStarters: ['BULBASAUR', 'CHARMANDER', 'SQUIRTLE', 'PIKACHU'],
    runs: Array.from({ length: 30 }, (_, i) => ({ date: 1790000000000 + i, starter: 'CHARMANDER', ascension: i % 4, result: i % 3 ? 'lose' : 'win', act: 3, floor: 12, party: ['CHARIZARD', 'PIDGEOT', 'RAICHU', 'GYARADOS', 'SNORLAX', 'ALAKAZAM'], seed: 'SEED' + i, best: 4000 + i })),
    settings: { music: 0.35, sfx: 0.45, fast: false, stereo: true, vol2: true, audioQuality: 'hq', crt: 'off', crtCurve: true, display: 'fill', display2: true },
  };
  return { meta: JSON.stringify(meta), run: JSON.stringify(run), runObj: run, playMore: (n) => { for (let i = 0; i < n; i++) playSoloNodes(run, 1, 'S3more:' + Math.random()); run.money += 7; run.logEvent({ k: 'test' }); return JSON.stringify(run); } }; // (always a change, even once the act is over)
}

// Completed calls of progress:* from the dev logs (the last few minutes), with their database I/O.
function recentUsage(ms = 12000) {
  return new Promise((resolve) => {
    const cli = path.join(__dirname, '..', 'node_modules', 'convex', 'bin', 'main.js');
    const p = spawn(process.execPath, [cli, 'logs', '--history', '400', '--success', '--jsonl'], { cwd: path.join(__dirname, '..') });
    let out = '';
    p.stdout.on('data', d => { out += d; });
    setTimeout(() => { p.kill(); }, ms);
    p.on('close', () => {
      const rows = [];
      for (const line of out.split('\n')) {
        try { const j = JSON.parse(line); if (j.kind === 'Completion' && /^progress:(get|save|put)$/.test(j.identifier)) rows.push(j); } catch {}
      }
      resolve(rows);
    });
  });
}

(async () => {
  console.log(`cloud save test against ${A.CONVEX_URL}`);
  A.ensureTestUser(EMAIL, 'SAVETEST');
  const token = await A.mintToken(EMAIL);
  const call = (k, f, a) => A.callConvex(token, k, f, a);
  const rows = () => JSON.parse(A.cli('run', 'progress:testRows', JSON.stringify({ email: EMAIL })));
  const t0 = Date.now();
  try {
    await call('mutation', 'players:me', {});
    const S = await realisticSave();
    console.log(`  save: meta ${S.meta.length} B, run ${S.run.length} B`);

    // ---- a legacy save loads ----
    // (the save goes up the new way, then becomes a legacy progress row: the CLI can't carry it as an argument)
    await call('mutation', 'progress:put', { meta: S.meta, run: S.run });
    A.cli('run', 'progress:testMakeLegacy', JSON.stringify({ email: EMAIL }));
    let g = await call('query', 'progress:get', {});
    ok(g && g.meta === S.meta && g.run === S.run && g.format === 1, 'a legacy-format save (progress row) loads unchanged');
    ok(g.email === EMAIL, 'get returns the account email');

    // ---- the first new-format push of one part copies the other from the legacy row ----
    const run2 = S.playMore(1);
    let r = await call('mutation', 'progress:put', { run: run2 });
    ok(JSON.stringify(r.wrote.sort()) === '["meta","run"]', `first partial push migrates the save (wrote ${r.wrote})`);
    g = await call('query', 'progress:get', {});
    ok(g.meta === S.meta && g.run === run2 && g.format === 2, 'after it: meta from the legacy row, run from the push');
    let raw = rows();
    ok(raw.heads.length === 1, 'one head row');
    ok(raw.legacy.length === 1 && raw.legacy[0].meta === S.meta && raw.legacy[0].run === S.run, 'the legacy row is left as it was');
    const blob = raw.blobs.find(b => b.part === 'run');
    ok(blob && blob.stored < blob.size / 2.5, `run stored compressed (${blob?.size} B JSON -> ${blob?.stored} B)`);

    // ---- unchanged = nothing written ----
    r = await call('mutation', 'progress:put', { run: run2 });
    ok(r.wrote.length === 0, 'pushing an unchanged run writes nothing');
    r = await call('mutation', 'progress:put', { meta: S.meta, run: run2 });
    ok(r.wrote.length === 0, 'pushing both unchanged parts writes nothing');

    // ---- older clients: progress:save with both parts ----
    const run3 = S.playMore(1);
    const at = await call('mutation', 'progress:save', { meta: S.meta, run: run3 });
    ok(typeof at === 'number' && at > 0, 'old-client progress:save is accepted (returns updatedAt)');
    g = await call('query', 'progress:get', {});
    ok(g.run === run3 && g.meta === S.meta, 'old-client save is what loads next');
    const before = rows().heads[0];
    await call('mutation', 'progress:save', { meta: S.meta, run: run3 });
    ok(rows().heads[0].updatedAt === before.updatedAt, 'old-client save of an unchanged save writes nothing');

    // ---- meta only, run cleared ----
    const meta2 = JSON.stringify({ ...JSON.parse(S.meta), totalRuns: 31 });
    r = await call('mutation', 'progress:put', { meta: meta2 });
    ok(JSON.stringify(r.wrote) === '["meta"]', 'meta-only push writes only meta');
    r = await call('mutation', 'progress:put', { run: null });
    ok(JSON.stringify(r.wrote) === '["run"]', 'run null clears the run');
    g = await call('query', 'progress:get', {});
    ok(g.run === null && g.meta === meta2, 'after the run ends: no run, the new meta');
    ok(rows().blobs.filter(b => b.part === 'run').length === 0, 'the run blob is gone');
    r = await call('mutation', 'progress:put', { run: run3 });
    g = await call('query', 'progress:get', {});
    ok(g.run === run3, 'a new run after that is stored again');

    // ---- validation ----
    let threw = null;
    try { await call('mutation', 'progress:put', { run: '{broken' }); } catch (e) { threw = e; }
    ok(!!threw, 'unparseable JSON is refused');
    threw = null;
    try { await A.callConvex(null, 'mutation', 'progress:put', { run: run3 }); } catch (e) { threw = e; }
    ok(!!threw, 'anonymous progress:put is refused');

    // ---- nothing to merge into ----
    A.cli('run', 'progress:testMakeLegacy', JSON.stringify({ email: EMAIL, clear: true })); // (no save at all)
    ok((await call('query', 'progress:get', {})) === null, 'an account without any save gets null');
    r = await call('mutation', 'progress:put', { run: run3 });
    ok(r.missing === true && r.wrote.length === 0, 'a partial push with nothing to merge into asks for the whole save');
    r = await call('mutation', 'progress:put', { meta: S.meta, run: run3 });
    ok(r.wrote.length === 2, 'the whole save is then stored');

    if (process.env.MEASURE) {
      // a realistic cycle: a node's push (run only), the same again (unchanged), an old client's push, a sign-in
      S.playMore(1); const run4 = S.playMore(1), run5 = S.playMore(1);
      await new Promise(res => setTimeout(res, 1500));
      const labels = ['put: one node (run changed)', 'put: nothing changed', 'save (old client): run changed, meta not', 'get (sign-in)'];
      await call('mutation', 'progress:put', { run: run4 });
      await call('mutation', 'progress:put', { run: run4 });
      await call('mutation', 'progress:save', { meta: S.meta, run: run5 });
      await call('query', 'progress:get', {});
      await new Promise(res => setTimeout(res, 3000));
      // (the last four calls in the log: server clocks are a little off from ours)
      const usage = (await recentUsage()).sort((a, b) => a.timestamp - b.timestamp).slice(-labels.length);
      console.log(`  database I/O per call, save of meta ${S.meta.length} B + run ${run5.length} B JSON (bytes read / written):`);
      usage.forEach((j, i) => console.log(`    ${(labels[i] || j.identifier).padEnd(44)} read ${String(j.usageStats.databaseIoReadBytes).padStart(6)}  write ${String(j.usageStats.databaseIoWriteBytes).padStart(6)}`));
    }
  } finally {
    A.cleanup([EMAIL]);
  }
  console.log(`\n${passes} passed, ${fails} failed`);
})().catch(e => { console.error(e); process.exit(1); });
