// Held items backfill (v0.5.6): fills each account's meta.relicsFound (the Pokédex's HELD ITEMS page) with the held
// items its past runs had, recovered from what the server keeps per account:
//   runLogs          solo runs: held at the end, reward picks, MART purchases (Run.finishLog / logEvent)
//   saveHeads/Blobs  the run in progress (and the legacy progress rows)
//   coopActions      co-op: every privateDone's run (full runs, and the relic keys inside compact deltas, wire.js), the
//                    starters' own items (init); coopCheckpointStates: the runs at each checkpoint
// (Not recoverable: items from an event or treasure that were sold or given away before the run ended, and runs whose
// log never reached the server.) Writes go through the internal mutation progress:backfillRelicsFound, add-only and
// idempotent: run it again any time, it only adds what is missing and never removes anything.
//   node tools/backfill_relics.mjs [--prod] [--apply] [--emails]
// Default: the dev deployment, a dry run (what would be added). --apply writes. --emails prints the accounts' emails
// (otherwise P1..Pn). Reads tables with `convex data` (8000 rows max per table: it stops if a table reaches that).
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { inflateSync, strFromU8 } from 'fflate';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROD = process.argv.includes('--prod'), APPLY = process.argv.includes('--apply'), SHOW = process.argv.includes('--emails');
const { RELICS } = await import('../web/src/game/items.js');
const { STARTERS } = await import('../web/src/game/acts.js');
const LIMIT = 8000;
const cli = (...a) => execFileSync(process.execPath, [path.join(root, 'node_modules/convex/bin/main.js'), ...a, ...(PROD ? ['--prod'] : [])], { cwd: root, encoding: 'utf8', maxBuffer: 512 << 20, stdio: ['ignore', 'pipe', 'ignore'] });
function table(name) {
  const txt = cli('data', name, '--limit', String(LIMIT), '--format', 'jsonArray').replace(/Bytes\("([^"]*)"\)/g, '"$1"');
  const rows = txt.trim() ? JSON.parse(txt) : []; // (an empty table prints nothing)
  if (rows.length >= LIMIT) throw new Error(`${name} has ${LIMIT}+ rows: this tool would miss some (page through it first)`);
  return rows;
}
const isRelic = (k) => typeof k === 'string' && !!RELICS[k];

// ---- what each account had ----------------------------------------------------------------------
export function recoverRelics(T) {
  const found = new Map(); // email -> Set
  const src = new Map();   // email -> { source: count }
  const add = (email, source, keys) => {
    if (!email) return;
    const s = found.get(email) || new Set(), c = src.get(email) || {};
    for (const k of keys) if (isRelic(k) && !s.has(k)) { s.add(k); c[source] = (c[source] || 0) + 1; }
    found.set(email, s); src.set(email, c);
  };
  const emailOf = new Map(T.players.map(p => [p._id, (p.email || '').toLowerCase()]));
  for (const r of T.runLogs) {
    let log; try { log = JSON.parse(r.log); } catch { continue; }
    const keys = [...(log.end?.relics || [])];
    for (const e of log.events || []) {
      if (e.k === 'pick' && e.what === 'relic' && e.took) keys.push(e.took);
      if (e.k === 'buy' && e.kind === 'relic') keys.push(e.item);
    }
    add(emailOf.get(r.playerId), 'runLogs', keys);
  }
  const blobs = new Map(T.saveBlobs.map(b => [b._id, b]));
  const unblob = (b) => { try { return JSON.parse(strFromU8(inflateSync(Buffer.from(b.data, 'base64')))); } catch { return null; } };
  for (const h of T.saveHeads) { const b = h.runId && blobs.get(h.runId), run = b && unblob(b); if (run) add(h.email, 'saves', (run.relics || []).map(x => x.key)); }
  for (const p of T.progress) { try { const run = p.run && JSON.parse(p.run); if (run) add((p.email || '').toLowerCase(), 'saves', (run.relics || []).map(x => x.key)); } catch {} }
  const slotEmail = new Map(T.coopMembers.map(m => [`${m.roomId}:${m.slot}`, m.email.toLowerCase()]));
  const inDelta = (node, out, under = false) => {
    if (node === null || typeof node !== 'object') { if (under && isRelic(node)) out.push(node); return; }
    if (Array.isArray(node)) { for (const x of node) inDelta(x, out, under); return; }
    for (const [k, v] of Object.entries(node)) inDelta(v, out, under || k === 'relics');
  };
  for (const a of T.coopActions) {
    let j; try { j = JSON.parse(a.json); } catch { continue; }
    if (a.type === 'init') { (j.starters || []).forEach((st, p) => { const it = STARTERS.find(s => s.species === st)?.item; if (it) add(slotEmail.get(`${a.roomId}:${p}`), 'coop', [it]); }); continue; }
    if (a.type !== 'privateDone') continue;
    const email = slotEmail.get(`${a.roomId}:${a.p}`);
    if (j.run) add(email, 'coop', (j.run.relics || []).map(x => x.key));
    else if (j.runD !== undefined) { const out = []; inDelta(j.runD, out); add(email, 'coop', out); }
  }
  for (const s of T.coopCheckpointStates) {
    let st; try { st = JSON.parse(s.state); } catch { continue; }
    (st.runs || []).forEach((r, p) => add(slotEmail.get(`${s.roomId}:${p}`), 'coop', (r?.relics || []).map(x => x.key)));
  }
  return { found, src };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  console.log(`${PROD ? 'PROD' : 'dev'} deployment, ${APPLY ? 'APPLY (writes)' : 'dry run'}`);
  const T = {};
  for (const t of ['players', 'runLogs', 'saveHeads', 'saveBlobs', 'progress', 'coopMembers', 'coopActions', 'coopCheckpointStates']) T[t] = table(t);
  const { found, src } = recoverRelics(T);
  const total = Object.keys(RELICS).length;
  const emails = [...new Set(T.players.map(p => (p.email || '').toLowerCase()).filter(Boolean))].sort();
  let added = 0, accounts = 0;
  emails.forEach((email, i) => {
    const keys = [...(found.get(email) || [])].sort();
    const label = SHOW ? email : `P${i + 1}`;
    if (!keys.length) { console.log(`${label}: nothing recovered`); return; }
    const r = JSON.parse(cli('run', 'progress:backfillRelicsFound', JSON.stringify({ email, keys, dryRun: !APPLY })));
    added += r.added; if (r.added) accounts++;
    console.log(`${label}: recovered ${keys.length}/${total} (${Object.entries(src.get(email) || {}).map(([k, n]) => `${k} ${n}`).join(', ')}) -> ${r.status}: ${r.before} before, +${r.added}, ${r.after} after`);
  });
  console.log(`${APPLY ? 'added' : 'would add'} ${added} item${added === 1 ? '' : 's'} across ${accounts} account${accounts === 1 ? '' : 's'}`);
}
