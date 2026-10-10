// Packs web/assets/ into files and uploads the changed ones to Convex file storage, where GET /pack serves them
// to allowlisted accounts only (the hosted static site has no assets).
// Usage: node tools/upload_packs.cjs [--prod] [--dry] [--out <dir>]
//   --dry        build and print the packs, upload nothing
//   --out <dir>  also write every pack as <dir>/<name>-<hash>.ksp (the test pack cache, tests/pack_cache.cjs)
//
// v0.3.21, to keep downloads small (Convex egress):
// - PNGs are stored losslessly re-encoded (tools/pngopt.cjs: palette PNGs for the 16-colour sprites, about half
//   the bytes, the same pixels). web/assets is not changed.
// - Many smaller packs: a changed sprite or move animation re-sends one pack, not 2 MB to everyone. The POKéMON
//   are spread over buckets by a hash of their folder name, so adding one changes one bucket.
// - Each pack is also uploaded gzipped (when that saves anything) for newer clients; the plain copy stays for
//   clients from before (they ignore the new manifest fields and download every pack plain).
// - lazy packs (sound, move animations, HGSS art) aren't needed to reach the title: newer clients fetch them in
//   the background, and anything that asks for one of their files waits for it.
const fs = require('fs'), path = require('path'), crypto = require('crypto'), zlib = require('zlib'), os = require('os');
const { execFileSync } = require('child_process');
const { optimizePng } = require('./pngopt.cjs');

const root = path.join(__dirname, '..'), assets = path.join(root, 'web', 'assets');
const args = process.argv.slice(2);
const prod = args.includes('--prod'), dry = args.includes('--dry');
const outDir = args.includes('--out') ? path.resolve(args[args.indexOf('--out') + 1]) : null;
if (!fs.existsSync(path.join(assets, 'data'))) { console.error('web/assets is missing; run the extract tools first.'); process.exit(1); }

const POKEMON_BUCKETS = 8;
const LAZY = new Set(['sound', 'anims', 'hgss']);
function fnv1a(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0; return h; }
// Which pack a file goes in (each stays far under the 20 MB HTTP action response limit).
function packOf(rel) {
  if (rel.includes('/hgss/')) return 'hgss';
  if (rel.startsWith('anims/')) return 'anims';
  if (rel.startsWith('sound/')) return 'sound';
  const m = /^gfx\/pokemon\/([^/]+)\//.exec(rel);
  if (m) return 'pokemon-' + (fnv1a(m[1]) % POKEMON_BUCKETS);
  for (const d of ['items', 'trainers', 'overworld']) if (rel.startsWith(`gfx/${d}/`)) return d;
  if (rel.startsWith('gfx/')) return 'gfx'; // manifest, fonts, ui, misc, terrain: what the title and menus need
  return 'data';
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) walk(f, out); else out.push(f);
  }
  return out;
}

// Optimised PNGs, cached by the input's hash (the optimiser takes ~20 s for all of them).
const PNG_CACHE = path.join(os.tmpdir(), 'kanto-spire-pngopt-v1');
function fileBytes(f, rel) {
  const b = fs.readFileSync(f);
  if (!rel.endsWith('.png')) return b;
  const key = path.join(PNG_CACHE, crypto.createHash('sha256').update(b).digest('hex') + '.png');
  try { return fs.readFileSync(key); } catch {}
  const o = optimizePng(b);
  try { fs.mkdirSync(PNG_CACHE, { recursive: true }); fs.writeFileSync(key, o); } catch {}
  return o;
}

// "KSP1", u32 LE header length, JSON header {files: {path: [offset, length]}}, then the bytes.
function build() {
  const groups = {};
  for (const f of walk(assets).sort()) {
    const rel = path.relative(assets, f).split(path.sep).join('/');
    (groups[packOf(rel)] ||= []).push([rel, f]);
  }
  return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b)).map(([name, list]) => {
    const files = {}, bufs = [];
    let off = 0, orig = 0;
    for (const [rel, f] of list) { const b = fileBytes(f, rel); orig += fs.statSync(f).size; files[rel] = [off, b.length]; bufs.push(b); off += b.length; }
    const header = Buffer.from(JSON.stringify({ files }));
    const head = Buffer.alloc(8); head.write('KSP1', 0, 'latin1'); head.writeUInt32LE(header.length, 4);
    const data = Buffer.concat([head, header, ...bufs]);
    const gz = zlib.gzipSync(data, { level: 9 });
    const lazy = LAZY.has(name);
    const dirs = lazy ? [...new Set(list.map(([rel]) => rel.slice(0, rel.lastIndexOf('/') + 1)))].sort() : undefined;
    return {
      name, data, hash: crypto.createHash('sha256').update(data).digest('hex'), count: list.length, orig,
      gz: gz.length < data.length * 0.95 ? gz : null, lazy, dirs,
    };
  });
}

function convex(fn, a) {
  const cli = path.join(root, 'node_modules', 'convex', 'bin', 'main.js');
  const out = execFileSync(process.execPath, [cli, 'run', fn, JSON.stringify(a || {}), ...(prod ? ['--prod'] : [])], { cwd: root, encoding: 'utf8' });
  const t = out.trim();
  return t ? JSON.parse(t.slice(t.search(/[[{"0-9]/))) : null;
}

async function upload(data) {
  const url = convex('packs:uploadUrl');
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: data });
  if (!res.ok) throw new Error(`upload: HTTP ${res.status} ${await res.text()}`);
  return (await res.json()).storageId;
}

const mb = n => (n / 1048576).toFixed(2);
(async () => {
  const packs = build();
  let raw = 0, sent = 0, orig = 0;
  for (const p of packs) {
    raw += p.data.length; sent += (p.gz || p.data).length; orig += p.orig;
    console.log(`${p.name.padEnd(10)} ${String(p.count).padStart(5)} files ${mb(p.orig)} MB on disk -> ${mb(p.data.length)} MB${p.gz ? `, gzip ${mb(p.gz.length)} MB` : ''}${p.lazy ? ' (lazy)' : ''} ${p.hash.slice(0, 12)}`);
  }
  console.log(`total: ${mb(orig)} MB of assets -> ${mb(raw)} MB packed, ${mb(sent)} MB to download`);
  if (outDir) {
    fs.mkdirSync(outDir, { recursive: true });
    for (const p of packs) fs.writeFileSync(path.join(outDir, `${p.name}-${p.hash}.ksp`), p.data);
    console.log('wrote', packs.length, 'packs to', outDir);
  }
  if (dry) return;
  const current = Object.fromEntries((convex('packs:list') || []).map(p => [p.name, p]));
  for (const p of packs) {
    const c = current[p.name];
    const same = c && c.hash === p.hash && !!c.zsize === !!p.gz && !!c.lazy === !!p.lazy && JSON.stringify(c.dirs || []) === JSON.stringify(p.dirs || []);
    if (same) { console.log(`${p.name}: unchanged`); continue; }
    const storageId = await upload(p.data);
    const z = p.gz ? { zStorageId: await upload(p.gz), zsize: p.gz.length } : {};
    convex('packs:record', { name: p.name, storageId, hash: p.hash, size: p.data.length, ...z, ...(p.lazy ? { lazy: true, dirs: p.dirs } : {}) });
    console.log(`${p.name}: uploaded`);
  }
  const removed = convex('packs:prune', { keep: packs.map(p => p.name) });
  if (removed) console.log(`pruned ${removed} old pack(s)`);
  console.log(`done (${prod ? 'prod' : 'dev'})`);
})().catch(e => { console.error(e.message || e); process.exit(1); });
