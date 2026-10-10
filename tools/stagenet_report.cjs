// Side-by-side network cost of tests/stagenet_e2e.cjs runs (e.g. the older polling build vs the subscription build):
//   node tools/stagenet_report.cjs tests/out/stagenet_old.json tests/out/stagenet_new.json [...]
// Per phase, both clients together, per minute: HTTP calls to the Convex API, WebSocket frames in / out, bytes down / up
// (HTTP bodies + WebSocket payloads), and on the server (the run's .logs.jsonl, convex logs): function executions,
// database bytes read, bytes returned. Writes tests/out/stagenet_compare.md.
const fs = require('fs'), path = require('path');
const files = process.argv.slice(2);
if (!files.length) { console.error('usage: node tools/stagenet_report.cjs <run.json>...'); process.exit(1); }

function load(file) {
  const run = JSON.parse(fs.readFileSync(file, 'utf8'));
  const logFile = file.replace(/\.json$/, '.logs.jsonl');
  const events = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').split('\n').filter(l => l.startsWith('{')).map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(e => e && e.kind === 'Completion' && /^(coop|players|progress|runs|runlogs|packs|invites|auth):/.test(e.identifier || ''))
    .filter((e, i, all) => !e.executionId || all.findIndex(x => x.executionId === e.executionId) === i) : [];
  const off = run.serverOffset || 0;
  const phases = run.phases.map(ph => {
    const min = (ph.t1 - ph.t0) / 60000;
    const per = ph.per.filter(Boolean);
    const c = per.reduce((a, p) => ({ http: a.http + p.http, wsIn: a.wsIn + p.ws, wsOut: a.wsOut + p.wsSent, down: a.down + p.httpDown + p.wsDown, up: a.up + p.httpUp + p.wsUp }), { http: 0, wsIn: 0, wsOut: 0, down: 0, up: 0 });
    const ev = events.filter(e => e.timestamp * 1000 >= ph.t0 + off && e.timestamp * 1000 <= ph.t1 + off);
    const srv = { calls: ev.length, cached: ev.filter(e => e.cachedResult).length, read: 0, ret: 0, write: 0, fns: {} };
    for (const e of ev) {
      const u = e.usageStats || {};
      srv.read += u.databaseReadBytes || 0; srv.write += u.databaseWriteBytes || 0; srv.ret += e.returnBytes || 0;
      srv.fns[e.identifier] = (srv.fns[e.identifier] || 0) + 1;
    }
    const paths = {}, ws = {};
    for (const p of per) for (const [k, v] of Object.entries(p.byPath || {})) paths[k] = (paths[k] || 0) + v.n;
    for (const p of per) for (const [k, v] of Object.entries(p.wsBy || {})) { const x = (ws[k] ||= { n: 0, bytes: 0 }); x.n += v.n; x.bytes += v.bytes; }
    return { name: ph.name, s: Math.round(min * 60), min, c, srv, paths, ws, deflate: per.map(p => p.deflate) };
  });
  return { label: run.label, phases };
}

const runs = files.map(load);
const f1 = (n) => (Math.round(n * 10) / 10).toFixed(1);
const kb = (n) => (n / 1024).toFixed(1);
const lines = [];
const out = (s = '') => { lines.push(s); console.log(s); };
out('# Network cost per phase (both clients together, per minute)');
out();
out(`Runs: ${runs.map(r => r.label).join(' vs ')}`);
const names = [...new Set(runs.flatMap(r => r.phases.map(p => p.name)))];
for (const name of names) {
  out();
  out(`## ${name}`);
  out();
  out('| run | seconds | HTTP calls/min | WS frames in/min | WS frames out/min | KB down/min | KB up/min | server executions/min | DB read KB/min | returned KB/min |');
  out('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
  for (const r of runs) {
    const p = r.phases.find(x => x.name === name);
    if (!p) continue;
    const m = p.min || 1;
    out(`| ${r.label} | ${p.s} | ${f1(p.c.http / m)} | ${f1(p.c.wsIn / m)} | ${f1(p.c.wsOut / m)} | ${kb(p.c.down / m)} | ${kb(p.c.up / m)} | ${f1(p.srv.calls / m)} | ${kb(p.srv.read / m)} | ${kb(p.srv.ret / m)} |`);
  }
  for (const r of runs) {
    const p = r.phases.find(x => x.name === name);
    if (!p) continue;
    const top = Object.entries(p.srv.fns).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k}×${v}`).join(', ');
    const http = Object.entries(p.paths).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}×${v}`).join(', ');
    out(`- ${r.label}: server ${top || '-'}${http ? `; HTTP ${http}` : '; no HTTP API calls'}`);
    const ws = Object.entries(p.ws || {}).sort((a, b) => b[1].bytes - a[1].bytes).slice(0, 8).map(([k, v]) => `${k} ${v.n}x ${kb(v.bytes)} KB`).join(', ');
    if (ws) out(`  - ${r.label} WebSocket: ${ws}`);
  }
}
fs.writeFileSync(path.join(__dirname, '..', 'tests', 'out', 'stagenet_compare.md'), lines.join('\n') + '\n');
