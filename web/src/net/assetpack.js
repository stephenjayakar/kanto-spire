// Gated asset packs. In the hosted build the extracted ROM assets are NOT on the static site: after
// sign-in the game downloads them from Convex (GET /pack, which checks the account against the
// allowlist), keeps them in Cache Storage keyed by content hash, and serves them from memory.
// Locally (no packs) everything still loads from web/assets/ as plain files.
const files = new Map(); // 'gfx/items/potion.png' -> Blob
const urls = new Map();  // path -> blob: URL (images)
const MIME = { png: 'image/png', json: 'application/json', bin: 'application/octet-stream', wav: 'audio/wav' };
const CACHE = 'kanto-spire-packs';

export const Packs = { active: false };

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
    chunks.push(value); n += value.length; onBytes(n);
  }
  const out = new Uint8Array(n);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out.buffer;
}

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

// list: [{name, hash, size}] from packs:manifest. Throws with the server's message on 401/403.
export async function loadPacks({ siteUrl, token, list, onProgress }) {
  const cache = typeof caches !== 'undefined' ? await caches.open(CACHE).catch(() => null) : null;
  const total = list.reduce((a, p) => a + p.size, 0);
  const keep = new Set();
  let done = 0;
  for (const p of list) {
    const key = `${siteUrl}/pack-cache/${encodeURIComponent(p.name)}/${p.hash}`;
    keep.add(key);
    let buf = null;
    const hit = cache && await cache.match(key).catch(() => null);
    if (hit) {
      buf = await hit.arrayBuffer();
      if (await sha256(buf) !== p.hash) buf = null; // damaged cache entry: download again
    }
    if (!buf) {
      const res = await fetch(`${siteUrl}/pack?name=${encodeURIComponent(p.name)}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) { const err = new Error((await res.text().catch(() => '')) || `Asset pack ${p.name}: HTTP ${res.status}`); err.status = res.status; throw err; }
      buf = await readAll(res, n => onProgress?.(done + n, total));
      if (await sha256(buf) !== p.hash) throw new Error(`Asset pack ${p.name} is corrupt; reload to try again.`);
      if (cache) await cache.put(key, new Response(buf)).catch(() => {});
    }
    done += p.size;
    onProgress?.(done, total);
    unpack(buf);
  }
  if (cache) for (const req of await cache.keys()) if (!keep.has(req.url)) cache.delete(req);
  Packs.active = true;
  // fetch('assets/…') anywhere in the game (data JSON, fonts, the sound bank) is answered from memory.
  const realFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (input, init) => {
    const p = packedPath(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (p === null) return realFetch(input, init);
    const b = files.get(p);
    return Promise.resolve(b ? new Response(b, { headers: { 'Content-Type': b.type } }) : new Response('missing asset ' + p, { status: 404 }));
  };
}
