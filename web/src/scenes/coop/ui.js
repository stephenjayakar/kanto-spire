// Shared co-op UI bits: player colours, toasts, the desync/offline banner and the partner status chip.
// Every co-op scene calls drawCoopOverlay(ctx, session) last; the session wraps the solo private scenes
// (rewards, shop, ...) so they get it too.
import { Engine, W, H } from '../../engine/core.js';
import { text, measure } from '../../engine/font.js';
import { button, pixBox, rect, shade } from '../../engine/ui.js';
import { maxHp } from '../../game/pokemon.js';

export const PCOL = ['#e85848', '#4890f0', '#40b050', '#e0a020'];  // P1 red, P2 blue, P3 green, P4 gold
export const PFONT = ['red', 'blue', 'green', 'gold'];
export const PSPRITE = ['gfx/overworld/people/red_normal.png', 'gfx/overworld/people/green_normal.png', 'gfx/overworld/people/rs_brendan.png', 'gfx/overworld/people/rs_may.png'];
export const OFFLINE_MS = 20000;                      // no heartbeat change for this long = offline

// ---- toasts -----------------------------------------------------------------------------------
const toasts = [];
const now = () => performance.now() / 1000;
export function coopToast(str, opts = {}) {
  if (!str) return;
  const until = now() + (opts.t ?? 3.2);
  const last = toasts[toasts.length - 1];
  if (last && last.text === str) { last.until = until; return; }
  toasts.push({ text: String(str), until, bad: !!opts.bad, good: !!opts.good });
  if (toasts.length > 4) toasts.shift();
}
export function drawToasts(ctx) {
  let y = H - 30;
  const t0 = now();
  for (let i = toasts.length - 1; i >= 0; i--) {
    const t = toasts[i];
    const left = t.until - t0;
    if (left <= 0) { toasts.splice(i, 1); continue; }
    const w = Math.min(W - 20, measure(t.text) + 20);
    ctx.save(); ctx.globalAlpha = Math.min(1, left * 3);
    pixBox(ctx, (W - w) / 2, y, w, 22, t.bad ? '#401010' : t.good ? '#103a18' : '#18243a', t.bad ? '#ff6060' : t.good ? '#60e070' : '#f8d038', 3);
    text(ctx, t.text, W / 2, y + 4, { align: 'center', color: 'white' });
    ctx.restore();
    y -= 26;
  }
}

// ---- partner status ---------------------------------------------------------------------------
const PRIVATE_WHAT = {
  reward: "they're picking rewards", center: "they're at the POKéMON CENTER", mart: "they're shopping",
  plateau: "they're shopping", event: "they're at the event", treasure: "they're opening an item ball",
};
export function privateWhat(kind) { return PRIVATE_WHAT[kind] || "they're busy"; }

// -> { key: 'ready'|'choosing'|'offline'|'down'|'none', label, color, detail }
export function playerStatus(session, p) {
  if (!session) return { key: 'none', label: '—', color: '#506070', detail: '' };
  const g = session.game;
  if (g?.away?.[p]) return { key: 'away', label: 'SAT OUT', color: '#606878', detail: 'left the game' };
  if (p !== session.mySlot && session.member(p)?.saved) return { key: 'offline', label: 'SAVED & QUIT', color: '#5870a0', detail: 'saved and quit' };
  if (!session.isOnline(p)) return { key: 'offline', label: 'OFFLINE', color: '#808890', detail: 'not connected' };
  if (!g) return { key: 'choosing', label: 'CONNECTING', color: '#c09030', detail: '' };
  if (g.phase === 'map') return g.votes?.[p] != null ? { key: 'ready', label: 'READY', color: '#38b048', detail: 'voted' } : { key: 'choosing', label: 'CHOOSING', color: '#d09020', detail: 'picking a path' };
  if (g.phase === 'private') return g.private?.done?.[p] ? { key: 'ready', label: 'READY', color: '#38b048', detail: 'done' } : { key: 'choosing', label: 'CHOOSING', color: '#d09020', detail: privateWhat(g.private?.kind) };
  if (g.phase === 'battle') {
    const b = g.battle;
    if (b?.down?.[p] || g.down?.[p]) return { key: 'down', label: 'DOWN', color: '#a04040', detail: 'team fainted' };
    if (b?.result) return { key: 'ready', label: 'DONE', color: '#38b048', detail: 'battle over' };
    return b?.locks?.[p] ? { key: 'ready', label: 'LOCKED IN', color: '#38b048', detail: 'locked in' } : { key: 'choosing', label: 'CHOOSING', color: '#d09020', detail: 'picking cards' };
  }
  return { key: 'none', label: '—', color: '#506070', detail: '' };
}
export const partnerStatus = (session) => playerStatus(session, session?.partnerSlot ?? 1);

// Small pill: "P2 NAME  READY". Returns its width. opts.slot defaults to the partner.
export function drawPartnerChip(ctx, x, y, session, opts = {}) {
  const p = opts.slot ?? session.partnerSlot;
  const st = playerStatus(session, p);
  const name = (opts.name ?? session.nameOf(p)).slice(0, 12);
  const tag = `P${p + 1}`;
  const nw = opts.compact ? 0 : measure(name, 'small') + 6;
  const lw = measure(st.label, 'small') + 10;
  const w = 20 + nw + lw;
  pixBox(ctx, x, y, w, 14, '#141a26', '#2c3446', 3);
  pixBox(ctx, x + 1, y + 1, 18, 12, PCOL[p], null, 2);
  text(ctx, tag, x + 10, y + 1, { align: 'center', color: 'white', font: 'small' });
  if (!opts.compact) text(ctx, name, x + 22, y + 1, { color: 'white', font: 'small' });
  const pulse = st.key === 'choosing' ? 0.15 * (Math.sin(Engine.time * 5) + 1) : 0;
  pixBox(ctx, x + 20 + nw, y + 1, lw - 1, 12, shade(st.color, pulse), null, 2);
  text(ctx, st.label, x + 20 + nw + (lw - 1) / 2, y + 1, { align: 'center', color: 'white', font: 'small' });
  return w;
}

export function teamHpFrac(run) {
  if (!run?.party?.length) return 0;
  let hp = 0, max = 0;
  for (const m of run.party) { hp += Math.max(0, m.hp); max += maxHp(m); }
  return max ? hp / max : 0;
}

// ---- banner -----------------------------------------------------------------------------------
// Red DESYNC bar (with RESYNC), else orange partner-offline / connection-lost bar. Drawn just below the HUD.
export function drawCoopBanner(ctx, session) {
  if (!session) return;
  const y = 27, h = 18;
  if (session.desync) {
    rect(ctx, 0, y, W, h, '#a01818');
    rect(ctx, 0, y + h, W, 1, '#300808');
    text(ctx, `DESYNC at #${session.desync.seq}  ·  your game drifted from your partner's`, 8, y + 3, { color: 'white', font: 'small' });
    if (button(ctx, 'RESYNC', W - 74, y + 1, 68, 16, { color: '#e0a020', font: 'small' })) session.resync();
    return;
  }
  let msg = null;
  if (session.netError && Date.now() - session.netError.since > 4000) msg = `CONNECTION LOST · retrying... (${session.netError.msg || 'network'})`;
  let off = null;
  if (!msg && session.game) {
    off = session.others.find(p => !session.isOnline(p) && !session.game.away?.[p]) ?? null;
    if (off !== null && session.member(off)?.saved) msg = `${session.nameOf(off)} SAVED & QUIT · wait for them, or SAVE & QUIT too`;
    else if (off !== null) msg = session.n > 2 ? `${session.nameOf(off)} is OFFLINE · wait, or carry on without them` : `${session.nameOf(off)} is OFFLINE · the game continues when they reconnect`;
  }
  if (!msg) return;
  rect(ctx, 0, y, W, h, '#8a5010');
  rect(ctx, 0, y + h, W, 1, '#301804');
  // 3-4 players: anyone may sit an offline player out (they rejoin with their next action)
  const skip = off !== null && session.n > 2 && session.game.away?.filter(a => !a).length > 2;
  text(ctx, msg, skip ? (W - 110) / 2 : W / 2, y + 3, { align: 'center', color: 'white', font: 'small' });
  if (skip && button(ctx, 'CARRY ON', W - 104, y + 1, 98, 16, { color: '#e0a020', font: 'small' })) session.sitOut(off);
}

export function drawCoopOverlay(ctx, session) {
  drawCoopBanner(ctx, session);
  drawToasts(ctx);
}
