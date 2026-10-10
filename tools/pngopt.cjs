// Lossless PNG shrinking for the asset packs (tools/upload_packs.cjs). The extracted sprites are 8-bit RGBA, but
// almost all of them have at most 16 colours (GBA / DS art). Re-encoding those as palette PNGs (a tRNS chunk keeps
// the alpha) gives the browser exactly the same pixels in a fraction of the bytes. web/assets is never touched:
// this runs in memory while packing, and every result is decoded again and compared pixel by pixel (any doubt
// keeps the original file).
const zlib = require('zlib');

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  return t;
})();
function crc32(buf) { let c = -1; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; }

function chunks(buf) {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(SIG)) return null;
  const out = [];
  for (let o = 8; o + 12 <= buf.length;) {
    const len = buf.readUInt32BE(o), type = buf.toString('latin1', o + 4, o + 8);
    out.push({ type, data: buf.subarray(o + 8, o + 8 + len) });
    o += 12 + len;
    if (type === 'IEND') break;
  }
  return out;
}

const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
function paeth(a, b, c) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }

// -> { w, h, rgba } for non-interlaced, non-colour-managed PNGs (8-bit, or 1/2/4-bit palette); else null
function decode(buf) {
  const cs = chunks(buf);
  if (!cs || cs[0]?.type !== 'IHDR') return null;
  const ih = cs[0].data, w = ih.readUInt32BE(0), h = ih.readUInt32BE(4), depth = ih[8], ct = ih[9], interlace = ih[12];
  if (interlace || !(ct in CHANNELS)) return null;
  if (depth !== 8 && !(ct === 3 && [1, 2, 4].includes(depth))) return null;
  if (cs.some(c => ['gAMA', 'iCCP', 'sRGB', 'cHRM'].includes(c.type))) return null; // colour-managed: keep as is
  const plte = cs.find(c => c.type === 'PLTE')?.data, trns = cs.find(c => c.type === 'tRNS')?.data;
  if (ct !== 3 && trns) return null; // keyed transparency on grey / RGB: rare, keep as is
  const raw = zlib.inflateSync(Buffer.concat(cs.filter(c => c.type === 'IDAT').map(c => c.data)));
  const bpp = ct === 3 ? 1 : CHANNELS[ct]; // filter distance in bytes (1 for palette images)
  const stride = Math.ceil(w * CHANNELS[ct] * depth / 8);
  if (raw.length < h * (stride + 1)) return null;
  const px = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride;
    if (f > 4) return null;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[dst + x - bpp] : 0, b = y ? px[dst - stride + x] : 0, c = x >= bpp && y ? px[dst - stride + x - bpp] : 0;
      const v = raw[src + x];
      px[dst + x] = (f === 0 ? v : f === 1 ? v + a : f === 2 ? v + b : f === 3 ? v + ((a + b) >> 1) : v + paeth(a, b, c)) & 0xff;
    }
  }
  const rgba = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 4, r = y * stride;
    if (ct === 6) px.copy(rgba, o, r + x * 4, r + x * 4 + 4);
    else if (ct === 2) { rgba[o] = px[r + x * 3]; rgba[o + 1] = px[r + x * 3 + 1]; rgba[o + 2] = px[r + x * 3 + 2]; rgba[o + 3] = 255; }
    else if (ct === 0) { rgba[o] = rgba[o + 1] = rgba[o + 2] = px[r + x]; rgba[o + 3] = 255; }
    else if (ct === 4) { rgba[o] = rgba[o + 1] = rgba[o + 2] = px[r + x * 2]; rgba[o + 3] = px[r + x * 2 + 1]; }
    else {
      const bit = x * depth, i = (px[r + (bit >> 3)] >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
      if (!plte || i * 3 + 2 >= plte.length) return null;
      rgba[o] = plte[i * 3]; rgba[o + 1] = plte[i * 3 + 1]; rgba[o + 2] = plte[i * 3 + 2]; rgba[o + 3] = trns && i < trns.length ? trns[i] : 255;
    }
  }
  return { w, h, rgba };
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0); out.write(type, 4, 'latin1'); data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

// Filters each row: filter 0 for palette images (filters rarely help indices), else the filter with the smallest
// sum of absolute differences (the usual heuristic).
function filterRows(px, h, stride, bpp, adaptive) {
  const out = Buffer.alloc(h * (stride + 1)), cand = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const row = y * stride, o = y * (stride + 1);
    let best = 0, bestScore = Infinity;
    for (let f = 0; f < (adaptive ? 5 : 1); f++) {
      let score = 0;
      for (let x = 0; x < stride; x++) {
        const a = x >= bpp ? px[row + x - bpp] : 0, b = y ? px[row - stride + x] : 0, c = x >= bpp && y ? px[row - stride + x - bpp] : 0;
        const v = (px[row + x] - (f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : paeth(a, b, c))) & 0xff;
        cand[x] = v; score += v < 128 ? v : 256 - v;
      }
      if (score < bestScore) { bestScore = score; best = f; cand.copy(out, o + 1); }
    }
    out[o] = best;
  }
  return out;
}

function encode(w, h, ct, depth, px, stride, extra) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = depth; ihdr[9] = ct; // compression/filter/interlace 0
  const idat = zlib.deflateSync(filterRows(px, h, stride, ct === 6 ? 4 : 1, ct === 6), { level: 9, memLevel: 9 });
  return Buffer.concat([SIG, chunk('IHDR', ihdr), ...extra, chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

const same = (a, b) => !!(a && b && a.w === b.w && a.h === b.h && a.rgba.equals(b.rgba));

// -> the smallest pixel-identical PNG: the input itself when nothing smaller is found or it can't be read.
function optimizePng(buf) {
  let img;
  try { img = decode(buf); } catch { return buf; }
  if (!img) return buf;
  const { w, h, rgba } = img;
  // (exact RGBA values, including the colour of fully transparent pixels, so canvas reads stay identical)
  const index = new Map(), colors = [];
  for (let i = 0; i < w * h && colors.length <= 256; i++) {
    const k = rgba.readUInt32BE(i * 4);
    if (!index.has(k)) { index.set(k, colors.length); colors.push(k); }
  }
  let best = buf;
  const tryOut = (out) => { try { if (out.length < best.length && same(decode(out), img)) best = out; } catch {} };
  if (colors.length <= 256) {
    // translucent entries first, so the tRNS chunk can stop at the last one
    const order = colors.map((_, i) => i).sort((a, b) => ((colors[a] & 0xff) === 255) - ((colors[b] & 0xff) === 255) || a - b);
    const remap = new Map(order.map((oldI, newI) => [colors[oldI], newI]));
    const n = colors.length, depth = n <= 2 ? 1 : n <= 4 ? 2 : n <= 16 ? 4 : 8;
    const plte = Buffer.alloc(n * 3), alphas = [];
    order.forEach((oldI, newI) => { const k = colors[oldI]; plte[newI * 3] = k >>> 24; plte[newI * 3 + 1] = (k >>> 16) & 0xff; plte[newI * 3 + 2] = (k >>> 8) & 0xff; alphas.push(k & 0xff); });
    let tl = alphas.length; while (tl > 0 && alphas[tl - 1] === 255) tl--;
    const stride = Math.ceil(w * depth / 8), px = Buffer.alloc(h * stride);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = remap.get(rgba.readUInt32BE((y * w + x) * 4)), bit = x * depth;
      px[y * stride + (bit >> 3)] |= i << (8 - depth - (bit & 7));
    }
    const extra = [chunk('PLTE', plte)];
    if (tl) extra.push(chunk('tRNS', Buffer.from(alphas.slice(0, tl))));
    tryOut(encode(w, h, 3, depth, px, stride, extra));
  } else {
    tryOut(encode(w, h, 6, 8, rgba, w * 4, []));
  }
  return best;
}

module.exports = { optimizePng, decodePng: decode };
