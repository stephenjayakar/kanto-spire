// Packs web/assets/ into a few files and uploads the changed ones to Convex file storage, where
// GET /pack serves them to allowlisted accounts only (the hosted static site has no assets).
// Usage: node tools/upload_packs.cjs [--prod] [--dry]
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..'), assets = path.join(root, 'web', 'assets');
const prod = process.argv.includes('--prod'), dry = process.argv.includes('--dry');
if (!fs.existsSync(path.join(assets, 'data'))) { console.error('web/assets is missing; run the extract tools first.'); process.exit(1); }

// Which pack a file goes in (each stays well under the 20 MB HTTP action response limit).
const packOf = rel => rel.startsWith('anims/') ? 'anims' : rel.includes('/hgss/') ? 'hgss' : rel.startsWith('gfx/pokemon/') ? 'pokemon' : rel.startsWith('gfx/') ? 'gfx' : rel.startsWith('sound/') ? 'sound' : 'data';

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) walk(f, out); else out.push(f);
  }
  return out;
}

// "KSP1", u32 LE header length, JSON header {files: {path: [offset, length]}}, then the bytes.
function build() {
  const groups = {};
  for (const f of walk(assets).sort()) {
    const rel = path.relative(assets, f).split(path.sep).join('/');
    (groups[packOf(rel)] ||= []).push([rel, f]);
  }
  return Object.entries(groups).map(([name, list]) => {
    const files = {}, bufs = [];
    let off = 0;
    for (const [rel, f] of list) { const b = fs.readFileSync(f); files[rel] = [off, b.length]; bufs.push(b); off += b.length; }
    const header = Buffer.from(JSON.stringify({ files }));
    const head = Buffer.alloc(8); head.write('KSP1', 0, 'latin1'); head.writeUInt32LE(header.length, 4);
    const data = Buffer.concat([head, header, ...bufs]);
    return { name, data, hash: crypto.createHash('sha256').update(data).digest('hex'), count: list.length };
  });
}

function convex(fn, args) {
  const cli = path.join(root, 'node_modules', 'convex', 'bin', 'main.js');
  const out = execFileSync(process.execPath, [cli, 'run', fn, JSON.stringify(args || {}), ...(prod ? ['--prod'] : [])], { cwd: root, encoding: 'utf8' });
  const t = out.trim();
  return t ? JSON.parse(t.slice(t.search(/[[{"]/))) : null;
}

(async () => {
  const packs = build();
  for (const p of packs) console.log(`${p.name.padEnd(8)} ${String(p.count).padStart(5)} files ${(p.data.length / 1048576).toFixed(2)} MB ${p.hash.slice(0, 12)}`);
  if (dry) return;
  const current = Object.fromEntries((convex('packs:list') || []).map(p => [p.name, p.hash]));
  for (const p of packs) {
    if (current[p.name] === p.hash) { console.log(`${p.name}: unchanged`); continue; }
    const url = convex('packs:uploadUrl');
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: p.data });
    if (!res.ok) throw new Error(`upload ${p.name}: HTTP ${res.status} ${await res.text()}`);
    const { storageId } = await res.json();
    convex('packs:record', { name: p.name, storageId, hash: p.hash, size: p.data.length });
    console.log(`${p.name}: uploaded`);
  }
  const removed = convex('packs:prune', { keep: packs.map(p => p.name) });
  if (removed) console.log(`pruned ${removed} old pack(s)`);
  console.log(`done (${prod ? 'prod' : 'dev'})`);
})().catch(e => { console.error(e.message || e); process.exit(1); });
