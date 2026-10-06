// Draws the animation state (gba.js) onto the battle scene: move backgrounds, palette tints,
// battle-anim sprites from tiles.bin with their current (faded) palettes, and the two POKéMON
// (drawn by the scene through hooks, with the offsets/affine/tint the animation gives them).
import { S, DATA, gSprites, gOamMatrices, gPlttBufferFaded, paletteTint, GetGpuReg, REG_OFFSET_BLDALPHA, tagOfTileNum, MAX_SPRITES } from './gba.js';
import { img, ready } from '../engine/assets.js';

const frameCache = new Map();
function palKey(p) { const o = 256 + p * 16; let k = ''; for (let i = 0; i < 16; i++) k += gPlttBufferFaded[o + i].toString(36) + ','; return k; }

function frameCanvas(tag, local, w, h, p) {
  const key = tag + '|' + local + '|' + w + 'x' + h + '|' + palKey(p);
  let c = frameCache.get(key);
  if (c) return c;
  const info = DATA.json.tags[tag];
  if (!info || !DATA.tiles) return null;
  if (frameCache.size > 3000) frameCache.clear();
  c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d'), im = x.createImageData(w, h), d = im.data;
  const o = 256 + p * 16, cols = [];
  for (let i = 0; i < 16; i++) { const v = gPlttBufferFaded[o + i]; cols.push([((v & 31) << 3) | ((v & 31) >> 2), (((v >> 5) & 31) << 3) | (((v >> 5) & 31) >> 2), (((v >> 10) & 31) << 3) | (((v >> 10) & 31) >> 2)]); }
  const [byteOff, numTiles] = info.tiles, tw = w >> 3, th = h >> 3;
  for (let ty = 0; ty < th; ty++) for (let tx = 0; tx < tw; tx++) {
    const tile = local + ty * tw + tx;
    if (tile < 0 || tile >= numTiles) continue;
    const base = byteOff + tile * 32;
    for (let py = 0; py < 8; py++) for (let px = 0; px < 8; px++) {
      const b = DATA.tiles[base + py * 4 + (px >> 1)], ci = px & 1 ? b >> 4 : b & 15;
      if (!ci) continue;
      const di = ((ty * 8 + py) * w + tx * 8 + px) * 4, col = cols[ci];
      d[di] = col[0]; d[di + 1] = col[1]; d[di + 2] = col[2]; d[di + 3] = 255;
    }
  }
  x.putImageData(im, 0, 0);
  frameCache.set(key, c);
  return c;
}

function blendAlpha() {
  const v = GetGpuReg(REG_OFFSET_BLDALPHA);
  if (!v) return 1;
  return Math.max(0, Math.min(1, (v & 0x1F) / 16));
}
const hex2 = (n) => Math.round(n * 255).toString(16).padStart(2, '0');
export function tintCss(t) { return t ? '#' + hex2(t.r) + hex2(t.g) + hex2(t.b) : null; }

// Set ctx so that (0,0) is the sprite centre and texture pixels map through the OAM matrix.
function applyAffine(ctx, sprite) {
  if (!(sprite.oam.affineMode & 1)) return;
  const m = gOamMatrices[sprite.oam.matrixNum] || { a: 256, b: 0, c: 0, d: 256 };
  const det = m.a * m.d - m.b * m.c;
  if (!det) { ctx.scale(0, 0); return; }
  const k = 256 / det;
  // texture = M * screen  =>  screen = M^-1 * texture
  ctx.transform(m.d * k, -m.c * k, -m.b * k, m.a * k, 0, 0);
}

// ox, oy: canvas position of GBA (0,0); sc: scale (2). hooks.drawMon(ctx, battler, {alpha, tint}) draws the
// 64x64 POKéMON picture centred on (0,0) in GBA pixels.
export function drawAnimLayer(ctx, ox, oy, sc, hooks) {
  const list = [];
  for (let i = 0; i < MAX_SPRITES; i++) { const s = gSprites[i]; if (s.inUse && !s.invisible) list.push(s); }
  // OAM order: lower (priority, subpriority) is drawn on top; ties: lower index on top.
  list.sort((a, b) => (b.oam.priority - a.oam.priority) || (b.subpriority - a.subpriority) || (b.id - a.id));
  const alphaBlend = blendAlpha();
  for (const s of list) {
    const cx = s.x + s.x2 + (s.coordOffsetEnabled ? S.gSpriteCoordOffsetX : 0);
    const cy = s.y + s.y2 + (s.coordOffsetEnabled ? S.gSpriteCoordOffsetY : 0);
    ctx.save();
    ctx.translate(ox, oy); ctx.scale(sc, sc);
    ctx.translate(Math.round(cx), Math.round(cy));
    const dbl = s.oam.affineMode === 3 ? 2 : 1;
    if (s.oam.affineMode & 1) { ctx.beginPath(); ctx.rect(-s.oam.w / 2 * dbl, -s.oam.h / 2 * dbl, s.oam.w * dbl, s.oam.h * dbl); ctx.clip(); }
    if (s.oam.objMode === 1) ctx.globalAlpha *= alphaBlend;
    if (s.oam.objMode === 2) { ctx.restore(); continue; } // OBJ window sprites only mask other layers
    applyAffine(ctx, s);
    if (s.isMon) {
      const b = s.monClone >= 0 ? s.monClone : s.battler;
      hooks.drawMon?.(ctx, b, { tint: paletteTint(16 + (s.oam.paletteNum & 15)), alpha: 1 });
    } else {
      const tag = s.sheetTag && s.oam.tileNum >= s.sheetTileStart && s.oam.tileNum < s.sheetTileStart + 4096 ? s.sheetTag : tagOfTileNum(s.oam.tileNum);
      if (tag) {
        const local = s.oam.tileNum % 4096;
        const c = frameCanvas(tag, local, s.oam.w, s.oam.h, s.oam.paletteNum & 15);
        if (c) {
          if (!(s.oam.affineMode & 1) && (s.flipH || s.flipV)) ctx.scale(s.flipH ? -1 : 1, s.flipV ? -1 : 1);
          ctx.drawImage(c, -s.oam.w / 2, -s.oam.h / 2);
        }
      }
    }
    ctx.restore();
  }
}

function bgImage(key) {
  const bg = DATA.json.bgs?.[key] || DATA.json.extraBgs?.[key];
  const im = bg && img('anims/' + bg.img);
  return im && ready(im) ? { im, w: bg.w, h: bg.h } : null;
}
function drawWrapped(ctx, b, ox, oy, sc, scrollX, scrollY) {
  const sx = ((scrollX % b.w) + b.w) % b.w, sy = ((scrollY % b.h) + b.h) % b.h;
  ctx.save(); ctx.translate(ox, oy); ctx.scale(sc, sc);
  for (let y = -sy; y < 160; y += b.h) for (let x = -sx; x < 240; x += b.w) ctx.drawImage(b.im, x, y);
  ctx.restore();
}
// Anim BG layers 1/2 (Surf's wave, etc.), drawn over the POKéMON; blended with BLDALPHA when BLDCNT targets them.
export function drawAnimBgLayers(ctx, ox, oy, sc) {
  for (const id of [2, 1]) {
    const L = S.animBgs[id];
    if (!L) continue;
    const b = bgImage(L.key);
    if (!b) continue;
    ctx.save();
    const cnt = GetGpuReg('BLDCNT');
    if (cnt & (1 << id)) ctx.globalAlpha *= blendAlpha();
    if (L.alpha !== undefined) ctx.globalAlpha *= L.alpha;
    if (L.clipY0 !== undefined || L.clipY1 !== undefined) { const y0 = L.clipY0 ?? 0, y1 = L.clipY1 ?? 160; ctx.beginPath(); ctx.rect(ox, oy + y0 * sc, 240 * sc, Math.max(0, y1 - y0) * sc); ctx.clip(); }
    drawWrapped(ctx, b, ox, oy, sc, id === 1 ? S.gBattle_BG1_X : S.gBattle_BG2_X, id === 1 ? S.gBattle_BG1_Y : S.gBattle_BG2_Y);
    ctx.restore();
  }
}

// Move background (fadetobg) over the terrain, scrolled by gBattle_BG3_X/Y, plus BG palette tints / fade to black.
export function drawBgLayer(ctx, ox, oy, sc, clipW, clipH) {
  if (S.moveBg) {
    const b = bgImage(S.moveBg);
    if (b) drawWrapped(ctx, b, ox, oy, sc, S.gBattle_BG3_X, S.gBattle_BG3_Y);
  }
  const t = paletteTint(2);
  if (t) { ctx.save(); ctx.globalAlpha = t.a; ctx.fillStyle = tintCss(t); ctx.fillRect(ox, oy, clipW, clipH); ctx.restore(); }
  if (S.bgBlack > 0) { ctx.save(); ctx.globalAlpha = Math.min(1, S.bgBlack / 16); ctx.fillStyle = '#000'; ctx.fillRect(ox, oy, clipW, clipH); ctx.restore(); }
}
