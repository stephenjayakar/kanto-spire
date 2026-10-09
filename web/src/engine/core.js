// Canvas, scaling, main loop, scenes and input.
import { CRT } from './crt.js';
export const W = 640, H = 360;

export const Engine = {
  canvas: null, ctx: null, scale: 1, time: 0, dt: 0, frame: 0,
  scene: null, overlays: [],
  mouse: { x: -1, y: -1, down: false, clicked: false, rclicked: false, wheel: 0, justPressed: false, rdown: false, rjustPressed: false },
  keys: new Set(), pressed: new Set(),
  shake: 0, cursor: 'default', hoverAny: false,
  timeScale: 1,
};

// Settings > SCREEN: how the 640x360 picture is scaled to the window.
//   auto  - whole-number scale, unless that would waste a lot of the window (more than 0.6x short of
//           filling it): then stretch to fit, nearest-neighbour (some pixel rows/columns end up a pixel wider)
//   pixel - always the largest whole-number scale in real device pixels (also on 125% / 150% Windows scaling),
//           so every game pixel is the same size; black borders take up the rest
//   fill  - (default since v0.3.17) always as big as fits; between whole numbers the picture goes through the CRT shader's clean,
//           effect-free pass ("sharp bilinear": crisp, evenly sized pixels with a soft 1px seam where needed)
const DISPLAY_MODES = ['auto', 'pixel', 'fill'];
let displayMode = 'fill';
let wheelAcc = 0, lastWheelAt = 0; // wheel ticks not yet handed out, and when the last wheel event came (see the wheel listener)
export function setDisplayMode(mode) {
  displayMode = DISPLAY_MODES.includes(mode) ? mode : 'fill';
  if (Engine.canvas) resizeCanvas();
  return displayMode;
}

function resizeCanvas() {
  const canvas = Engine.canvas, iw = window.innerWidth, ih = window.innerHeight;
  const dpr = window.devicePixelRatio || 1;
  const fs = Math.min(iw / W, ih / H);
  const s = Math.max(1, Math.floor(fs));
  let scale, exact = false;
  // Screens smaller than 640x360 (phones in portrait) shrink below 1x so no edge (and its buttons) is cut off.
  if (fs < 1) scale = fs;
  else if (displayMode === 'pixel') {
    const k = Math.floor(fs * dpr + 1e-6);
    if (k >= 1) { scale = k / dpr; exact = true; } else scale = fs;
  } else if (displayMode === 'fill') scale = fs;
  // auto: use integer scale when it fits well; otherwise fractional to fill (crisp-edges keeps pixels sharp)
  else scale = fs - s > 0.6 ? fs : s;
  Engine.scale = scale;
  // (pixel: the exact size, even a fractional CSS width, so it lands on whole device pixels)
  canvas.style.width = (exact ? W * scale : Math.floor(W * scale)) + 'px';
  canvas.style.height = (exact ? H * scale : Math.floor(H * scale)) + 'px';
  // fill at an in-between scale: the smooth pass (it does nothing while the CRT look is on, which scales the same way)
  const k = scale * dpr;
  CRT.setSmooth(displayMode === 'fill' && Math.abs(k - Math.round(k)) > 0.01);
  CRT.resize();
}

export function initEngine(canvas) {
  Engine.canvas = canvas;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.imageSmoothingEnabled = false;
  Engine.ctx = ctx;
  CRT.init(canvas);
  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();
  const toLocal = (e) => {
    const r = canvas.getBoundingClientRect();
    Engine.mouse.x = (e.clientX - r.left) / r.width * W;
    Engine.mouse.y = (e.clientY - r.top) / r.height * H;
    // CRT curvature: the game pixel actually drawn under the pointer
    if (CRT.on) [Engine.mouse.x, Engine.mouse.y] = CRT.map(Engine.mouse.x, Engine.mouse.y, W, H);
  };
  canvas.addEventListener('mousemove', toLocal);
  canvas.addEventListener('mousedown', e => {
    toLocal(e);
    if (e.button === 0) { Engine.mouse.down = true; Engine.mouse.justPressed = true; }
    if (e.button === 2) { Engine.mouse.rdown = true; Engine.mouse.rjustPressed = true; } // right-drag (map sketches)
  });
  window.addEventListener('mouseup', e => {
    if (e.button === 0) { if (Engine.mouse.down) Engine.mouse.clicked = true; Engine.mouse.down = false; }
    if (e.button === 2) Engine.mouse.rdown = false;
  });
  window.addEventListener('blur', () => { Engine.mouse.down = false; Engine.mouse.rdown = false; });
  canvas.addEventListener('contextmenu', e => { e.preventDefault(); toLocal(e); Engine.mouse.rclicked = true; });
  // Wheel input becomes whole ticks (Engine.mouse.wheel, read each frame). A mouse wheel notch is one tick; a trackpad
  // (Mac: a stream of small pixel deltas plus momentum) adds up to one tick per ~100px instead of one per event, which
  // made every scroll on a Mac far too fast.
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    // (an event on its own, not part of a stream, is a wheel notch too: some Mac mice report only a few pixels each)
    const notch = e.wheelDeltaY && Math.abs(e.wheelDeltaY) % 120 === 0, now = performance.now(), alone = now - lastWheelAt > 120;
    lastWheelAt = now;
    const px = e.deltaMode === 1 ? e.deltaY * 40 : e.deltaMode === 2 ? e.deltaY * 800 : e.deltaY;
    const ticks = notch ? -e.wheelDeltaY / 120 : alone ? Math.sign(px) * Math.max(1, Math.abs(px) / 100) : px / 100;
    if (Math.sign(ticks) !== Math.sign(wheelAcc)) wheelAcc = 0; // (a change of direction drops the leftover)
    wheelAcc += ticks;
  }, { passive: false });
  // Touch: one finger taps and drags like the mouse; two fingers belong to the browser (pinch to zoom,
  // pan around), so a gesture that ever had 2+ fingers never turns into a click.
  let gesture = false;
  canvas.addEventListener('touchstart', e => {
    if (e.touches.length > 1) { gesture = true; Engine.mouse.down = false; Engine.mouse.justPressed = false; return; }
    gesture = false; toLocal(e.touches[0]); Engine.mouse.down = true; Engine.mouse.justPressed = true;
  }, { passive: true });
  canvas.addEventListener('touchmove', e => {
    if (gesture || e.touches.length > 1) return;
    toLocal(e.touches[0]); e.preventDefault();
  }, { passive: false });
  canvas.addEventListener('touchend', e => {
    e.preventDefault(); // no emulated mouse events after a touch
    if (gesture) { if (!e.touches.length) gesture = false; return; }
    Engine.mouse.clicked = true; Engine.mouse.down = false;
  }, { passive: false });
  window.addEventListener('keydown', e => {
    if (!Engine.keys.has(e.key)) Engine.pressed.add(e.key);
    Engine.keys.add(e.key);
    if ([' ', 'ArrowUp', 'ArrowDown', 'Tab'].includes(e.key)) e.preventDefault();
  });
  window.addEventListener('keyup', e => Engine.keys.delete(e.key));
  let last = performance.now();
  const loop = (now) => {
    const rawDt = Math.min(0.05, (now - last) / 1000);
    last = now;
    Engine.dt = rawDt * Engine.timeScale;
    Engine.time += Engine.dt;
    Engine.frame++;
    tick(Engine.dt);
    CRT.frame();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

function tick(dt) {
  const ctx = Engine.ctx;
  const wt = Math.trunc(wheelAcc); // (whole ticks this frame, at most 3; the rest carries over)
  Engine.mouse.wheel = Math.max(-3, Math.min(3, wt)); wheelAcc -= wt;
  Engine.hoverAny = false;
  updateTweens(dt);
  updateTimers(dt);
  const top = Engine.overlays[Engine.overlays.length - 1];
  try {
    if (top) top.update?.(dt); else Engine.scene?.update?.(dt);
    if (Engine.scene && top) Engine.scene.passiveUpdate?.(dt);
  } catch (e) { console.error(e); }
  ctx.save();
  if (Engine.shake > 0) {
    const s = Engine.shake;
    ctx.translate(Math.round((Math.random() - 0.5) * s * 2), Math.round((Math.random() - 0.5) * s * 2));
    Engine.shake = Math.max(0, Engine.shake - dt * 30);
  }
  try {
    if (top) {
      // An open overlay owns the clicks: don't let them fall through to buttons drawn by the scene below.
      const m = Engine.mouse, c = m.clicked, rc = m.rclicked;
      m.clicked = m.rclicked = false;
      Engine.scene?.draw?.(ctx);
      m.clicked = c; m.rclicked = rc;
    } else Engine.scene?.draw?.(ctx);
    for (const o of Engine.overlays) o.draw?.(ctx);
  } catch (e) { console.error(e); }
  ctx.restore();
  Engine.canvas.style.cursor = Engine.hoverAny ? 'pointer' : 'default';
  Engine.mouse.clicked = false; Engine.mouse.rclicked = false; Engine.mouse.justPressed = false; Engine.mouse.rjustPressed = false; Engine.mouse.wheel = 0;
  Engine.pressed.clear();
}

export function setScene(scene) {
  Engine.scene?.exit?.();
  Engine.overlays = [];
  Engine.scene = scene;
  Engine.mouse.clicked = false; Engine.mouse.rclicked = false; Engine.pressed.clear();
  scene.enter?.();
}
export function pushOverlay(o) { Engine.mouse.clicked = false; Engine.mouse.rclicked = false; Engine.pressed.clear(); Engine.overlays.push(o); o.enter?.(); return o; }
export function popOverlay(o) {
  const i = o ? Engine.overlays.indexOf(o) : Engine.overlays.length - 1;
  if (i >= 0) { const [x] = Engine.overlays.splice(i, 1); x.exit?.(); }
  Engine.mouse.clicked = false; Engine.pressed.clear();
}
export function topOverlay() { return Engine.overlays[Engine.overlays.length - 1]; }

// ---- input helpers --------------------------------------------------------------------------
export function inRect(x, y, w, h) { const m = Engine.mouse; return m.x >= x && m.x < x + w && m.y >= y && m.y < y + h; }
export function hover(x, y, w, h) { const r = inRect(x, y, w, h); if (r) Engine.hoverAny = true; return r; }
export function clicked(x, y, w, h) { return Engine.mouse.clicked && inRect(x, y, w, h); }
export function keyPressed(k) { return Engine.pressed.has(k); }
export function consumeClick() { Engine.mouse.clicked = false; }
export function shake(n) { Engine.shake = Math.max(Engine.shake, n); }

// ---- tweens & timers ------------------------------------------------------------------------
const tweens = [];
export const Ease = {
  linear: t => t, outQuad: t => 1 - (1 - t) * (1 - t), inQuad: t => t * t, inOutQuad: t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2,
  outBack: t => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
  outElastic: t => t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * (2 * Math.PI) / 3) + 1,
  outCubic: t => 1 - Math.pow(1 - t, 3),
};
export function tween(obj, props, dur, ease = Ease.outQuad, delay = 0) {
  return new Promise(res => {
    const from = {};
    for (const k in props) from[k] = obj[k];
    tweens.push({ obj, props, from, dur: Math.max(0.0001, dur), t: -delay, ease, res });
  });
}
function updateTweens(dt) {
  for (let i = tweens.length - 1; i >= 0; i--) {
    const tw = tweens[i];
    tw.t += dt;
    if (tw.t < 0) continue;
    const p = Math.min(1, tw.t / tw.dur);
    const e = tw.ease(p);
    for (const k in tw.props) tw.obj[k] = tw.from[k] + (tw.props[k] - tw.from[k]) * e;
    if (p >= 1) { tweens.splice(i, 1); tw.res(); }
  }
}
const timers = [];
export function wait(sec) { return new Promise(res => timers.push({ t: sec, res })); }
function updateTimers(dt) {
  for (let i = timers.length - 1; i >= 0; i--) { timers[i].t -= dt; if (timers[i].t <= 0) { const t = timers.splice(i, 1)[0]; t.res(); } }
}
export function waitFrames(n) { return wait(n / 60); }

export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const approach = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));
