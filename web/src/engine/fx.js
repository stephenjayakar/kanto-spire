// Particles, floating text, flashes.
import { Engine } from './core.js';
import { text } from './font.js';

const parts = [];
const floats = [];

export function burst(x, y, opts = {}) {
  const n = opts.n || 12;
  for (let i = 0; i < n; i++) {
    const a = (opts.angle ?? 0) + (Math.random() - 0.5) * (opts.spread ?? Math.PI * 2);
    const sp = (opts.speed || 80) * (0.4 + Math.random() * 0.8);
    parts.push({
      x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - (opts.up || 0), life: (opts.life || 0.6) * (0.6 + Math.random() * 0.6), t: 0,
      color: Array.isArray(opts.color) ? opts.color[i % opts.color.length] : (opts.color || '#fff'), size: opts.size || 2, grav: opts.grav ?? 200,
    });
  }
}

export function floatText(str, x, y, opts = {}) {
  floats.push({ str, x, y, t: 0, life: opts.life || 1.0, color: opts.color || 'white', scale: opts.scale || 1, vy: opts.vy ?? -30, font: opts.font || 'normal' });
}

export function drawFx(ctx, dt) {
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    p.t += dt;
    if (p.t >= p.life) { parts.splice(i, 1); continue; }
    p.vy += p.grav * dt; p.x += p.vx * dt; p.y += p.vy * dt;
    ctx.globalAlpha = 1 - p.t / p.life;
    ctx.fillStyle = p.color;
    ctx.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
  }
  ctx.globalAlpha = 1;
  for (let i = floats.length - 1; i >= 0; i--) {
    const f = floats[i];
    f.t += dt;
    if (f.t >= f.life) { floats.splice(i, 1); continue; }
    const k = f.t / f.life;
    const pop = k < 0.15 ? 1 + (0.15 - k) * 3 : 1;
    text(ctx, f.str, f.x, f.y + f.vy * k, { align: 'center', color: f.color, scale: Math.max(1, Math.round(f.scale * pop)), alpha: k > 0.7 ? (1 - k) / 0.3 : 1, font: f.font });
  }
}

export function clearFx() { parts.length = 0; floats.length = 0; }

export const flash = { a: 0, color: '#fff' };
export function doFlash(color = '#fff', a = 0.8) { flash.a = a; flash.color = color; }
export function drawFlash(ctx, dt, W, H) {
  if (flash.a <= 0) return;
  ctx.globalAlpha = flash.a;
  ctx.fillStyle = flash.color;
  ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = 1;
  flash.a = Math.max(0, flash.a - dt * 3);
}
