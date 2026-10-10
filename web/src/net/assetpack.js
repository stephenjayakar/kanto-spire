// Gated asset packs. In the hosted build the extracted ROM assets are NOT on the static site: after
// sign-in the game downloads them from Convex (GET /pack, which checks the account against the
// allowlist), keeps them in Cache Storage keyed by content hash, and serves them from memory.
// Locally (no packs) everything still loads from web/assets/ as plain files.
//
// v0.3.21 (Convex egress): a pack whose hash is already in Cache Storage is never downloaded again; downloads ask
// for the gzipped copy (enc=gzip) by name + hash, so the browser's HTTP cache can keep them too (immutable); the
// lazy packs (sound, move animations, HGSS art) load in the background once the title is up, and whatever asks for
// one of their files meanwhile waits for it (a pack that fails to load leaves its files missing: the game copes
// with missing art and sound, it never crashes on it).
const files = new Map(); // 'gfx/items/potion.png' -> Blob
const urls = new Map();  // path -> blob: URL (images)
const MIME = { png: 'image/png', json: 'application/json', bin: 'application/octet-stream', wav: 'audio/wav' };
const CACHE = 'kanto-spire-packs';
const PARALLEL = 4;
const pending = []; // lazy packs still loading: { dirs: ['sound/', ...], done: Promise }

// downloaded: bytes fetched from the server this session (0 when everything came from the cache)
export const Packs = { active: false, downloaded: 0, background: null };

// URL for an asset path relative to assets/ (for <img> src).
export function assetUrl(path) {
  if (!Packs.active) return 'assets/' + path;
  let u = urls.get(path);
  if (!u) {
    const b = files.get(path);
    if (!b) return 'assets/' + path;
    u = URL.createObjectURL(b);
    urls.set(path, u);
  }
  return u;
}

// A promise for when the lazy pack holding `path` has loaded, or null when the file is here (or never will be).
export function assetPending(path) {
  if (!Packs.active || files.has(path)) return null;
  return pending.find(p => p.dirs.some(d => path.startsWith(d)))?.done || null;
}
// Resolves once no lazy pack that could hold `path` is still loading (a folder can match more than one pack's dirs:
// 'sound/' holds the 'sound' pack and the 'emerald' pack's 'sound/emerald/', so it waits for each in turn).
export async function assetSettled(path) {
  for (let i = 0; i < 8; i++) { const w = assetPending(path); if (!w) return; await w; }
}

// 'https://site/…/assets/gfx/x.png' -> 'gfx/x.png' (same-origin asset URLs only), else null.
function packedPath(url) {
  try {
    const u = new URL(url, document.baseURI);
    const i = u.pathname.indexOf('/assets/');
    return u.origin === location.origin && i >= 0 ? decodeURIComponent(u.pathname.slice(i + 8)) : null;
  } catch { return null; }
}

async function sha256(buf) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
  return [...d].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function readAll(res, onBytes) {
  if (!res.body?.getReader) return res.arrayBuffer();
  const reader = res.body.getReader(), chunks = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); n += value.length; onBytes(value.length);
  }
  const out = new Uint8Array(n);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out.buffer;
}

const canGunzip = typeof DecompressionStream !== 'undefined' && typeof Blob !== 'undefined' && typeof Response !== 'undefined';
const isGzip = (buf) => { const b = new Uint8Array(buf, 0, Math.min(2, buf.byteLength)); return b[0] === 0x1f && b[1] === 0x8b; };
const gunzip = (buf) => new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();

// Pack format: "KSP1", u32 LE header length, JSON header {files: {path: [offset, length]}}, then the bytes.
function unpack(buf) {
  const dv = new DataView(buf);
  if (String.fromCharCode(...new Uint8Array(buf, 0, 4)) !== 'KSP1') throw new Error('Bad asset pack.');
  const hl = dv.getUint32(4, true);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, hl)));
  const base = 8 + hl;
  for (const [path, [off, len]] of Object.entries(header.files)) {
    const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
    files.set(path, new Blob([new Uint8Array(buf, base + off, len)], { type: MIME[ext] || 'application/octet-stream' }));
  }
}

const expectedBytes = (p) => (canGunzip && p.zsize ? p.zsize : p.size);
const cacheKey = (siteUrl, name, hash) => `${siteUrl}/pack-cache/${encodeURIComponent(name)}/${hash}`;

// One pack's plain bytes: from Cache Storage when its hash is there, else downloaded (and then cached).
async function getPack(p, { siteUrl, token, cache, onBytes, keep }) {
  keep.add(cacheKey(siteUrl, p.name, p.hash));
  const hit = cache && await cache.match(cacheKey(siteUrl, p.name, p.hash)).catch(() => null);
  if (hit) {
    const buf = await hit.arrayBuffer().catch(() => null);
    if (buf && await sha256(buf) === p.hash) { onBytes(expectedBytes(p), false); return buf; }
    // damaged cache entry: download again
  }
  const gz = canGunzip && !!p.zsize;
  const res = await fetch(`${siteUrl}/pack?name=${encodeURIComponent(p.name)}&h=${p.hash}${gz ? '&enc=gzip' : ''}`, { headers: { Authorization: `Bearer ${await token()}` } });
  if (!res.ok) { const err = new Error((await res.text().catch(() => '')) || `Asset pack ${p.name}: HTTP ${res.status}`); err.status = res.status; throw err; }
  let buf = await readAll(res, n => onBytes(n, true));
  if (isGzip(buf)) buf = await gunzip(buf); // (by magic number: plain packs start with "KSP1")
  // the server names what it sent: the pack may have been replaced since the manifest was read
  const hash = res.headers.get('X-Pack-Hash') || p.hash;
  if (await sha256(buf) !== hash) throw new Error(`Asset pack ${p.name} is corrupt; reload to try again.`);
  keep.add(cacheKey(siteUrl, p.name, hash));
  if (cache) await cache.put(cacheKey(siteUrl, p.name, hash), new Response(buf)).catch(() => {});
  return buf;
}

// Runs fn over items, `n` at a time.
async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) await fn(items[i++]); }));
}

// Ask the browser not to evict the pack cache under storage pressure. (Chrome and Safari decide silently; Firefox
// would show a permission prompt, so it is skipped there.)
function persistStorage() {
  try {
    if (/Firefox\//.test(navigator.userAgent) || !navigator.storage?.persist) return;
    navigator.storage.persisted().then(p => p || navigator.storage.persist()).catch(() => {});
  } catch {}
}

// list: [{name, hash, size, zsize?, lazy?, dirs?}] from packs:manifest. token: the auth token, or a function that
// returns (a promise of) a fresh one. Resolves once every pack the title needs is in; lazy packs keep loading in
// the background (Packs.background resolves when they are done). Throws with the server's message on 401/403.
export async function loadPacks({ siteUrl, token, list, onProgress }) {
  const getToken = typeof token === 'function' ? token : () => token;
  const cache = typeof caches !== 'undefined' ? await caches.open(CACHE).catch(() => null) : null;
  if (cache) persistStorage();
  const keep = new Set();
  // (a lazy pack without dirs can't be waited for: load it up front like the rest)
  const isLazy = (p) => p.lazy && Array.isArray(p.dirs) && p.dirs.length > 0;
  const now = list.filter(p => !isLazy(p)), later = list.filter(isLazy);
  const total = now.reduce((a, p) => a + expectedBytes(p), 0);
  let done = 0;
  const opts = { siteUrl, token: getToken, cache, keep };
  await pool(now, PARALLEL, async (p) => {
    const buf = await getPack(p, { ...opts, onBytes: (n, net) => { done += n; if (net) Packs.downloaded += n; onProgress?.(Math.min(done, total), total); } });
    unpack(buf);
  });
  for (const p of later) {
    let resolve;
    const entry = { dirs: p.dirs, done: new Promise(r => { resolve = r; }), p, resolve };
    pending.push(entry);
  }
  Packs.active = true;
  installFetch();
  Packs.background = (async () => {
    await pool(pending.slice(), PARALLEL, async (entry) => {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          unpack(await getPack(entry.p, { ...opts, onBytes: (n, net) => { if (net) Packs.downloaded += n; } }));
          break;
        } catch (e) {
          console.warn(`asset pack ${entry.p.name} failed (try ${attempt + 1})`, e);
          if (e.status === 401 || e.status === 403) break;
          await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
        }
      }
      pending.splice(pending.indexOf(entry), 1);
      entry.resolve();
    });
    // drop cached packs that are no longer part of the game (only once every current one is in)
    if (cache) for (const req of await cache.keys().catch(() => [])) if (!keep.has(req.url)) cache.delete(req).catch(() => {});
  })();
}

// fetch('assets/…') anywhere in the game (data JSON, fonts, the sound bank) is answered from memory, after the lazy
// pack holding the file if it is still loading.
function installFetch() {
  const realFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async (input, init) => {
    const p = packedPath(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (p === null) return realFetch(input, init);
    let b = files.get(p);
    if (!b && assetPending(p)) { await assetSettled(p); b = files.get(p); }
    return b ? new Response(b, { headers: { 'Content-Type': b.type } }) : new Response('missing asset ' + p, { status: 404 });
  };
}
