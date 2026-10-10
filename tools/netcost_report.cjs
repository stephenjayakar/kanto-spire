// Server-side cost of a tests/coop_netcost.cjs run, from the deployment's function logs (usage stats per execution).
//   (tests/coop_netcost.cjs records both)
//   node tools/netcost_report.cjs tests/out/netcost_<label>.json tests/out/netcost_<label>.logs.jsonl
// Per phase: function executions (cached ones apart: they read nothing), database read / write bytes and returned
// bytes, totals and per minute, per function.
const fs = require('fs');
const [phFile, logFile] = process.argv.slice(2);
const run = JSON.parse(fs.readFileSync(phFile, 'utf8'));
const events = fs.readFileSync(logFile, 'utf8').split('\n').filter(l => l.startsWith('{')).map(l => { try { return JSON.parse(l); } catch { return null; } })
  .filter(e => e && e.kind === 'Completion' && /^coop:|^players:|^progress:/.test(e.identifier || ''))
  .filter((e, i, all) => !e.executionId || all.findIndex(x => x.executionId === e.executionId) === i); // (two log streams on one file)
const kb = (n) => (n / 1024).toFixed(1);
const out = { label: run.label, phases: [] };
for (const ph of run.phases) {
  const off = run.serverOffset || 0; // (server clock - client clock)
  const ev = events.filter(e => e.timestamp * 1000 >= ph.t0 + off && e.timestamp * 1000 <= ph.t1 + off);
  const min = (ph.t1 - ph.t0) / 60000;
  const fns = {};
  const tot = { calls: 0, cached: 0, read: 0, write: 0, ret: 0 };
  for (const e of ev) {
    const f = (fns[e.identifier] ||= { calls: 0, cached: 0, read: 0, write: 0, ret: 0 });
    const u = e.usageStats || {};
    for (const t of [f, tot]) { t.calls++; if (e.cachedResult) t.cached++; t.read += u.databaseReadBytes || 0; t.write += u.databaseWriteBytes || 0; t.ret += e.returnBytes || 0; }
  }
  const client = ph.per.filter(Boolean).reduce((a, p) => ({ http: a.http + p.http, ws: a.ws + p.ws, down: a.down + p.httpDown + p.wsDown, up: a.up + p.httpUp + p.wsUp }), { http: 0, ws: 0, down: 0, up: 0 });
  out.phases.push({ name: ph.name, seconds: Math.round(min * 60), server: tot, fns, client });
  console.log(`\n== ${ph.name} (${(min * 60).toFixed(0)} s)`);
  console.log(`  server: ${tot.calls} executions (${(tot.calls / min).toFixed(1)}/min, ${tot.cached} cached), DB read ${kb(tot.read)} KB (${kb(tot.read / min)} KB/min), write ${kb(tot.write)} KB (${kb(tot.write / min)} KB/min), returned ${kb(tot.ret)} KB (${kb(tot.ret / min)} KB/min)`);
  console.log(`  clients (both): ${client.http} HTTP calls (${(client.http / min).toFixed(1)}/min), ${client.ws} WS frames in, ↓${kb(client.down)} KB (${kb(client.down / min)} KB/min) ↑${kb(client.up)} KB`);
  for (const [k, f] of Object.entries(fns).sort((a, b) => b[1].read - a[1].read)) {
    console.log(`    ${k.padEnd(24)} ${String(f.calls).padStart(4)}× (${f.cached} cached)  read ${kb(f.read).padStart(7)} KB  write ${kb(f.write).padStart(6)} KB  ret ${kb(f.ret).padStart(7)} KB  | read/call ${f.calls - f.cached ? Math.round(f.read / (f.calls - f.cached)) : 0} B`);
  }
}
fs.writeFileSync(phFile.replace(/\.json$/, '.report.json'), JSON.stringify(out, null, 1));
