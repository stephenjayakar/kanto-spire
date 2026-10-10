// Keeps browser tests from downloading the asset packs from Convex again and again (every fresh Playwright context
// starts with empty caches, and each full download is megabytes of Convex egress).
//   const { routePacks } = require('./pack_cache.cjs');
//   await routePacks(context);   // (or a page) before it opens the game
// GET /pack requests are answered from a disk cache shared by every worktree (PACK_CACHE_DIR, default
// <tmp>/kanto-spire-packs), keyed by pack name + hash. A miss downloads the pack once (gzipped when the server
// has it) and keeps it. Fill the cache from local assets with no download at all, when they are what was uploaded:
//   node tools/upload_packs.cjs --dry --out "$TMP/kanto-spire-packs"
// PACK_CACHE=0 turns this off (the test then talks to the server as a player would).
const fs = require('fs'), path = require('path'), os = require('os'), zlib = require('zlib'), crypto = require('crypto');

const DIR = process.env.PACK_CACHE_DIR || path.join(os.tmpdir(), 'kanto-spire-packs');
const stats = { hits: 0, misses: 0, bytes: 0 };

function corsFor(req) {
  const origin = req.headers().origin;
  return origin ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Expose-Headers': 'X-Pack-Hash, X-Pack-Enc', Vary: 'Origin' } : {};
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
    if (!h || !/^[0-9a-f]{64}$/.test(h) || !/^[\w.-]+$/.test(name)) return route.continue(); // (older clients: as is)
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
