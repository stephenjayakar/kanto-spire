// Keeps browser tests from downloading the asset packs from Convex again and again (every fresh Playwright context
// starts with empty caches, and each full download is megabytes of Convex egress).
//   const { routePacks } = require('./pack_cache.cjs');
//   await routePacks(context);   // (or a page) before it opens the game
// GET /pack requests are answered from a disk cache shared by every worktree (PACK_CACHE_DIR, default
// <tmp>/kanto-spire-packs), keyed by pack name + hash. A miss downloads the pack once (gzipped when the server
// has it) and keeps it. tools/upload_packs.cjs fills this cache with every pack it builds (so after an upload, tests
// never download), or by hand with no upload: node tools/upload_packs.cjs --dry. Requests without a hash (older
// clients, e.g. a dist/old build) get the newest cached copy of that pack.
// PACK_CACHE=0 turns this off (the test then talks to the server as a player would).
const fs = require('fs'), path = require('path'), os = require('os'), zlib = require('zlib'), crypto = require('crypto');

const DIR = process.env.PACK_CACHE_DIR || path.join(os.tmpdir(), 'kanto-spire-packs');
const stats = { hits: 0, misses: 0, bytes: 0 };

function corsFor(req) {
  const origin = req.headers().origin;
  return origin ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Expose-Headers': 'X-Pack-Hash, X-Pack-Enc', Vary: 'Origin' } : {};
}

// The newest cached copy of a pack (by file time), for clients that ask by name only. A miss downloads it once.
function newestCached(name) {
  let best = null;
  for (const f of fs.readdirSync(DIR)) {
    const m = /^(.+)-([0-9a-f]{64})\.ksp$/.exec(f);
    if (!m || m[1] !== name) continue;
    const t = fs.statSync(path.join(DIR, f)).mtimeMs;
    if (!best || t > best.t) best = { file: path.join(DIR, f), hash: m[2], t };
  }
  return best;
}
async function servePlain(route, req, name) {
  const hit = newestCached(name);
  let body = null, hash = hit?.hash;
  if (hit) { try { body = fs.readFileSync(hit.file); } catch {} }
  if (body && crypto.createHash('sha256').update(body).digest('hex') !== hash) body = null;
  if (body) stats.hits++;
  else {
    const res = await route.fetch();
    if (res.status() !== 200) return route.fulfill({ response: res });
    body = await res.body();
    if (body[0] === 0x1f && body[1] === 0x8b) body = zlib.gunzipSync(body);
    hash = res.headers()['x-pack-hash'] || crypto.createHash('sha256').update(body).digest('hex');
    stats.misses++; stats.bytes += body.length;
    if (crypto.createHash('sha256').update(body).digest('hex') === hash) fs.writeFileSync(path.join(DIR, `${name}-${hash}.ksp`), body);
  }
  return route.fulfill({ status: 200, body, headers: { ...corsFor(req), 'Content-Type': 'application/octet-stream', 'X-Pack-Hash': hash, 'X-Pack-Enc': 'identity', 'Cache-Control': 'no-store' } });
}

async function routePacks(target) {
  if (process.env.PACK_CACHE === '0') return stats;
  fs.mkdirSync(DIR, { recursive: true });
  await target.route(/\.convex\.site\/pack(\?|$)/, async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') {
      return route.fulfill({ status: 204, headers: { ...corsFor(req), 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization', 'Access-Control-Max-Age': '86400' } });
    }
    const u = new URL(req.url());
    const name = u.searchParams.get('name') || '', h = u.searchParams.get('h');
    if (!/^[\w.-]+$/.test(name)) return route.continue();
    if (!h) return servePlain(route, req, name); // (older clients ask by name only)
    if (!/^[0-9a-f]{64}$/.test(h)) return route.continue();
    const file = path.join(DIR, `${name}-${h}.ksp`);
    let body = null;
    try { body = fs.readFileSync(file); } catch {}
    if (body && crypto.createHash('sha256').update(body).digest('hex') !== h) body = null;
    if (body) stats.hits++;
    else {
      // one real download, gzipped if the server has it, then kept
      const res = await route.fetch({ url: req.url().includes('enc=gzip') ? req.url() : req.url() + '&enc=gzip' });
      if (res.status() !== 200) return route.fulfill({ response: res });
      let buf = await res.body();
      stats.misses++; stats.bytes += buf.length;
      if (buf[0] === 0x1f && buf[1] === 0x8b) buf = zlib.gunzipSync(buf);
      const hash = res.headers()['x-pack-hash'] || h;
      if (crypto.createHash('sha256').update(buf).digest('hex') === hash) fs.writeFileSync(path.join(DIR, `${name}-${hash}.ksp`), buf);
      if (hash !== h) return route.fulfill({ status: 200, body: buf, headers: { ...corsFor(req), 'Content-Type': 'application/octet-stream', 'X-Pack-Hash': hash, 'X-Pack-Enc': 'identity', 'Cache-Control': 'no-store' } });
      body = buf;
    }
    return route.fulfill({ status: 200, body, headers: { ...corsFor(req), 'Content-Type': 'application/octet-stream', 'X-Pack-Hash': h, 'X-Pack-Enc': 'identity', 'Cache-Control': 'no-store' } });
  });
  return stats;
}

module.exports = { routePacks, PACK_CACHE_DIR: DIR, packCacheStats: stats };
