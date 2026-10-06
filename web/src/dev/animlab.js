// Move-animation lab: plays FireRed move animations on a mock battle scene laid out exactly like
// scenes/battle.js (scene at 160,27; POKéMON at 2x). URL: animlab.html?move=EMBER&side=0&lead=charmander&foe=bulbasaur
// Playwright helpers: window.animLab.play(move, side), .strip(move, side, {frames, every, count, scale}) -> PNG data URL,
// .status() -> {MOVE: true | [missing callbacks]} for every move.
import { MoveAnims } from '../anim/player.js';
import { img, ready, tinted } from '../engine/assets.js';
import { tintCss } from '../anim/render.js';

const SCENE_X = 160, SCENE_Y = 27, SCENE_W = 480, SCENE_H = 200;
const OX = SCENE_X, OY = SCENE_Y - 20; // canvas position of GBA pixel (0,0)
const q = new URLSearchParams(location.search);
const st = { lead: q.get('lead') || 'charmander', foe: q.get('foe') || 'bulbasaur', terrain: q.get('terrain') || 'grass', speed: 1 };
const cv = document.getElementById('c'), ctx = cv.getContext('2d');
ctx.imageSmoothingEnabled = false;
const monPath = (folder, back) => `gfx/pokemon/${folder}/${back ? 'back' : 'front'}.png`;

const boxCache = new Map();
function opaqueBox(path) {
  if (boxCache.has(path)) return boxCache.get(path);
  const im = img(path); if (!ready(im)) return null;
  const c = document.createElement('canvas'); c.width = 64; c.height = 64;
  const x = c.getContext('2d'); x.drawImage(im, 0, 0, 64, 64, 0, 0, 64, 64);
  const d = x.getImageData(0, 0, 64, 64).data;
  let x0 = 64, y0 = 64, x1 = -1, y1 = -1;
  for (let yy = 0; yy < 64; yy++) for (let xx = 0; xx < 64; xx++) if (d[(yy * 64 + xx) * 4 + 3]) { x0 = Math.min(x0, xx); x1 = Math.max(x1, xx); y0 = Math.min(y0, yy); y1 = Math.max(y1, yy); }
  const b = x1 < 0 ? { x: 0, y: 0, w: 64, h: 64 } : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  boxCache.set(path, b); return b;
}
function battlers() {
  const mk = (cx, cy, path, species) => { const box = opaqueBox(path) || { x: 0, y: 0, w: 64, h: 64 }; return { present: true, species, x: cx, picY: cy, y: cy - Math.max(0, 64 - (box.y + box.h)), box }; };
  return [mk(60, 78, monPath(st.lead, true), st.lead), mk(180, 45, monPath(st.foe, false), st.foe)];
}
function drawMonImg(c, path, tint, alpha = 1) {
  const im = img(path); if (!ready(im)) return;
  c.save(); c.globalAlpha *= alpha;
  c.drawImage(im, 0, 0, 64, 64, -32, -32, 64, 64);
  if (tint) { const t = tinted(path, tintCss(tint), 1); if (t) { c.globalAlpha *= tint.a; c.drawImage(t, 0, 0, 64, 64, -32, -32, 64, 64); } }
  c.restore();
}
const hooks = { drawMon: (c, b, o) => drawMonImg(c, b === 0 ? monPath(st.lead, true) : monPath(st.foe, false), o.tint, o.alpha) };

function drawScene(c) {
  c.fillStyle = '#203040'; c.fillRect(0, 0, 640, 360);
  c.save();
  c.beginPath(); c.rect(SCENE_X, SCENE_Y + 4, SCENE_W - 2, SCENE_H - 4); c.clip();
  const terr = img(`gfx/terrain/${st.terrain}.png`);
  const off = MoveAnims.terrainOffset();
  if (ready(terr)) for (const wx of off.x ? [-480, 0, 480] : [0]) for (const wy of off.y ? [-224, 0, 224] : [0]) c.drawImage(terr, 0, 0, 240, 112, SCENE_X - 1 + off.x * 2 + wx, SCENE_Y - 20 + off.y * 2 + wy, 480, 224);
  if (MoveAnims.active) {
    MoveAnims.drawBg(c, OX, OY, 2, SCENE_W, SCENE_H + 20);
    MoveAnims.drawLayer(c, OX, OY, 2, hooks);
  } else {
    c.save(); c.translate(OX, OY); c.scale(2, 2);
    c.save(); c.translate(180, 45); hooks.drawMon(c, 1, {}); c.restore();
    c.save(); c.translate(60, 78); hooks.drawMon(c, 0, {}); c.restore();
    c.restore();
  }
  c.restore();
  c.fillStyle = '#fff'; c.font = '12px monospace';
  c.fillText(MoveAnims.cur ? `${MoveAnims.cur.key} frame ${MoveAnims.cur.script.frames}` : 'idle', 8, 16);
}

let last = performance.now();
function loop(t) { const dt = (t - last) / 1000; last = t; MoveAnims.tick(dt); drawScene(ctx); requestAnimationFrame(loop); }

async function preload() {
  const paths = [monPath(st.lead, true), monPath(st.foe, false), `gfx/terrain/${st.terrain}.png`];
  const { DATA } = await import('../anim/gba.js');
  for (const b of Object.values(DATA.json?.bgs || {})) paths.push('anims/' + b.img);
  for (const b of Object.values(DATA.json?.extraBgs || {})) paths.push('anims/' + b.img);
  await Promise.all(paths.map(p => { const im = img(p); return ready(im) || im._failed ? null : new Promise(r => { im.addEventListener('load', r, { once: true }); im.addEventListener('error', r, { once: true }); }); }));
}
const playSE = (n) => import('../audio/sound.js').then(m => m.Sound.playSE(n)).catch(() => {});

window.animLab = {
  ready: (async () => { await MoveAnims.load(); await preload(); return MoveAnims.ready; })(),
  async play(move, side = 0, speed = st.speed) {
    await this.ready; await preload();
    const r = await MoveAnims.play(move, { attacker: side, battlers: battlers(), speed, hooks: { playSE: q.has('sound') ? playSE : null } });
    document.getElementById('info').textContent = JSON.stringify(r);
    return r;
  },
  // Frame strip: renders the scene region at GBA frames `frames` (or `count` frames evenly spread) side by side.
  async strip(move, side = 0, { frames, every = 2, count = 8, scale = 0.5, crop } = {}) {
    await this.ready; await preload();
    const R = crop || { x: SCENE_X, y: SCENE_Y + 4, w: SCENE_W - 2, h: 196 };
    const off = document.createElement('canvas'); off.width = 640; off.height = 360;
    const oc = off.getContext('2d'); oc.imageSmoothingEnabled = false;
    const caps = [], want = new Set(frames || []);
    let i = 0;
    const snap = () => { drawScene(oc); const c = document.createElement('canvas'); c.width = R.w; c.height = R.h; c.getContext('2d').drawImage(off, R.x, R.y, R.w, R.h, 0, 0, R.w, R.h); caps.push({ i, c }); };
    const p = MoveAnims.play(move, { attacker: side, battlers: battlers(), speed: 1 });
    i = 1; if (frames ? want.has(1) : true) snap();
    while (MoveAnims.cur && i < 1500) { MoveAnims.step(); i++; if (frames ? want.has(i) : i % every === 0) snap(); }
    const res = await p;
    let pick = caps;
    if (!frames && caps.length > count) { pick = []; for (let k = 0; k < count; k++) pick.push(caps[Math.round(k * (caps.length - 1) / (count - 1))]); }
    const W2 = Math.round(R.w * scale), H2 = Math.round(R.h * scale);
    const out = document.createElement('canvas'); out.width = W2 * pick.length + 2 * (pick.length - 1); out.height = H2 + 12;
    const x = out.getContext('2d'); x.imageSmoothingEnabled = false; x.fillStyle = '#000'; x.fillRect(0, 0, out.width, out.height);
    pick.forEach((f, k) => { x.drawImage(f.c, k * (W2 + 2), 12, W2, H2); x.fillStyle = '#fff'; x.font = '10px monospace'; x.fillText(`f${f.i}`, k * (W2 + 2) + 2, 10); });
    return { url: out.toDataURL('image/png'), frames: res.frames, missing: res.missing, reason: res.reason, picked: pick.map(f => f.i), error: MoveAnims.lastError };
  },
  // average cost per GBA frame of the interpreter step and of drawing the scene with the animation
  async perf(move, side = 0, reps = 3) {
    await this.ready; await preload();
    let step = 0, drawT = 0, n = 0, peakSprites = 0;
    const { gSprites } = await import('../anim/gba.js');
    for (let r = 0; r < reps; r++) {
      const p = MoveAnims.play(move, { attacker: side, battlers: battlers(), speed: 1 });
      while (MoveAnims.cur) {
        const t0 = performance.now(); MoveAnims.step(); const t1 = performance.now();
        if (MoveAnims.cur) { peakSprites = Math.max(peakSprites, gSprites.filter(s => s.inUse).length); drawScene(ctx); }
        const t2 = performance.now(); step += t1 - t0; drawT += t2 - t1; n++;
      }
      await p;
    }
    return { move, frames: Math.round(n / reps), stepMs: +(step / n).toFixed(3), drawMs: +(drawT / n).toFixed(3), peakSprites };
  },
  async status() {
    await this.ready;
    const { DATA } = await import('../anim/gba.js');
    const out = {};
    for (const k of Object.keys(DATA.json.moves)) out[k] = MoveAnims.canPlay(k) ? true : MoveAnims.missing(k);
    return out;
  },
  set(o) { Object.assign(st, o); boxCache.clear(); },
};
document.getElementById('go').onclick = () => window.animLab.play(document.getElementById('mv').value.trim().toUpperCase(), +document.getElementById('side').value);
document.getElementById('fast').onclick = () => { st.speed = st.speed === 1 ? 2 : 1; document.getElementById('fast').textContent = st.speed === 2 ? 'normal' : 'fast x2'; };
requestAnimationFrame(loop);
if (q.get('move')) window.animLab.ready.then(() => window.animLab.play(q.get('move').toUpperCase(), +(q.get('side') || 0)));
