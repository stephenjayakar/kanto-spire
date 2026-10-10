// Co-op lobby: CREATE ROOM / JOIN ROOM (type or paste the code) / REJOIN, then the room itself:
// 2-4 players, starter picks, ascension (host; no world choice since v0.1.0 One Spire), START. Hands off to CoopSession once playing.
import { Engine, W, H, setScene, hover, clicked, keyPressed, pushOverlay } from '../../engine/core.js';
import { draw } from '../../engine/assets.js';
import { text, textBlock, measure, textFit } from '../../engine/font.js';
import { swirlBackground, BG_THEMES, button, panel, pixBox, rect, drawTips, tip, THEME } from '../../engine/ui.js';
import { D } from '../../game/data.js';
import { G } from '../../game/state.js';
import { ASCENSIONS, NUZLOCKE_ASC } from '../../game/run.js';
// Nuzlocke rules are off in co-op (a downed partner is revived after every win, see Run.nuzlocke).
const coopAscDesc = (x) => (x?.n === NUZLOCKE_ASC ? 'Nuzlocke: no effect in co-op (your partner revives you after a win).' : x?.desc || '');
import { availableStarters, ascUnlocked, coopAscCap, MAX_ASC } from '../../game/unlocks.js';
import { coopWorldFor, coopWorldRegions, isSpireWorld } from '../../game/regions.js';
// A room's world in the REJOIN list: SPIRE, or KANTO / HOENN for a room started before v0.1.0.
const coopWorldLabel = (w) => (String(w || 'kanto').startsWith('spire') ? 'SPIRE' : String(w || 'kanto').toUpperCase());
import { Sound } from '../../audio/sound.js';
import { drawMon, drawIcon, drawMonCentered, ChoiceModal } from '../common.js';
import { loadNet } from './net.js';
import { CoopSession } from './session.js';
import { MAX_PLAYERS } from '../../game/coop/coop.js';
import { PCOL, PFONT, PSPRITE, coopToast, drawToasts, OFFLINE_MS } from './ui.js';

const CODE_CHARS = /^[A-Z2-9]$/;

export class CoopLobbyScene {
  constructor(opts = {}) { this.opts = opts; }
  enter() {
    this.t = 0;
    this.mode = 'menu';         // 'menu' | 'join' | 'room'
    this.code = '';
    this.busy = false;
    this.view = null;            // coop:room result while in a room
    this.rooms = null;           // coop:mine for REJOIN
    this.asc = Math.min(this.ownBest(), G.meta.lastAscension ?? 0); // the server clamps it to the room's best unlock once starters are picked
    Sound.playBGM('mus_oak_lab');
    this.onPaste = (e) => {
      if (this.mode !== 'join') return;
      const s = (e.clipboardData?.getData('text') || '').toUpperCase().replace(/[^A-Z2-9]/g, '').slice(0, 5);
      if (s) { this.code = s; e.preventDefault(); }
    };
    window.addEventListener('paste', this.onPaste);
    loadNet().then(net => { this.net = net; this.refreshRooms(); if (this.opts.roomId) this.openRoom(this.opts.roomId); })
      .catch(e => { this.netErr = e.message; coopToast(e.message, { bad: true, t: 6 }); });
  }
  exit() {
    window.removeEventListener('paste', this.onPaste);
    clearTimeout(this.pollTimer); this.pollTimer = null;
    this.unwatch();
  }
  update(dt) {
    this.t += dt;
    if (this.mode === 'join') this.typeCode();
  }

  // ---- net helpers --------------------------------------------------------------------------
  async act(fn, okMsg) {
    if (this.busy || !this.net) return null;
    this.busy = true;
    try { const r = await fn(this.net); if (okMsg) coopToast(okMsg, { good: true }); return r; }
    catch (e) { coopToast(e.message || String(e), { bad: true, t: 4 }); Sound.playSE('se_failure'); return null; }
    finally { this.busy = false; }
  }
  askDelete(r) {
    const playing = r.status === 'playing';
    pushOverlay(new ChoiceModal({
      title: `Delete room ${r.code}?`, w: 320,
      body: playing ? "You leave this run for good: you can't rejoin it from the list. Your partner can keep playing on their own." : r.isHost ? 'This closes the room for both of you.' : 'You leave the room.',
      options: [{ label: 'Delete', value: 1, color: THEME.discard }, { label: 'Keep it', value: 0 }],
      onClose: async (v) => {
        if (v !== 1) return;
        const res = await this.act(net => net.dismissRoom(r.roomId));
        if (res) { Sound.playSE('se_select'); coopToast(res.deleted ? `Room ${r.code} deleted.` : `Room ${r.code} removed from your list.`); }
        this.refreshRooms();
      },
    }));
  }
  refreshRooms() { this.net?.myRooms().then(r => { this.rooms = r || []; }).catch(() => { this.rooms = []; }); }
  ownBest() { return Math.max(0, ...Object.values(G.meta.ascBy || {}).map(n => Math.min(MAX_ASC, n | 0))); }
  async create() {
    const r = await this.act(net => net.createRoom({ ascension: this.asc, world: coopWorldFor(G.meta) }));
    if (r) this.openRoom(r.roomId);
  }
  async join(code) {
    const r = await this.act(net => net.joinRoom(code));
    if (r) this.openRoom(r.roomId);
  }
  openRoom(roomId) {
    this.roomId = roomId;
    this.mode = 'room';
    this.view = null;
    this.watch(roomId);
    this.poll();
  }
  // Live room updates (net.watchRoom: a coop:room subscription); without them the lobby polls every second.
  watch(roomId) {
    this.unwatch();
    const token = this.watchToken = {};
    Promise.resolve(this.net.watchRoom?.(roomId, v => { if (this.watchToken === token) this.onView(v); }, () => {}))
      .then(stop => { if (this.watchToken === token && stop) this.stopWatch = stop; else stop?.(); })
      .catch(() => {});
  }
  unwatch() { this.watchToken = null; try { this.stopWatch?.(); } catch {} this.stopWatch = null; }
  // -> false once the lobby is done with this room
  onView(v) {
    if (this.mode !== 'room' || this.handedOff || v?.room?._id !== this.roomId) return false;
    if (!v.nowAt) v.nowAt = Date.now();
    this.view = v; this.pollErr = null;
    if (v.room.status === 'playing') { this.handOff(v); return false; }
    if (v.room.status === 'closed') { coopToast('The host closed the room.', { bad: true }); this.backToMenu(); return false; }
    return true;
  }
  async poll() {
    if (this.polling) { this.pollAgain = true; return; }
    clearTimeout(this.pollTimer);
    if (this.mode !== 'room' || !this.roomId || this.handedOff) return;
    this.polling = true;
    let next = this.stopWatch ? 15000 : 1000; // (live: just a slow safety poll)
    try {
      const v = await this.net.getRoom(this.roomId);
      if (this.mode !== 'room' || v.room._id !== this.roomId) return;
      if (!this.onView(v)) next = null;
    } catch (e) {
      this.pollErr = e.message;
      if (/not found/i.test(e.message)) { next = null; coopToast('Room not found.', { bad: true }); this.backToMenu(); }
    } finally {
      this.polling = false;
      if (next !== null && this.mode === 'room' && !this.handedOff) this.pollTimer = setTimeout(() => this.poll(), this.pollAgain ? 0 : next);
      this.pollAgain = false;
    }
  }
  handOff(v) {
    this.handedOff = true;
    this.unwatch();
    G.meta.lastAscension = v.room.ascension;
    new CoopSession(this.net, { roomId: v.room._id, code: v.room.code, mySlot: v.me, members: v.members, now: v.now ? v.now + (Date.now() - (v.nowAt || Date.now())) : undefined }).start();
  }
  backToMenu() {
    clearTimeout(this.pollTimer);
    this.unwatch();
    this.mode = 'menu'; this.roomId = null; this.view = null;
    this.refreshRooms();
  }
  async leave() {
    const id = this.roomId;
    this.backToMenu();
    if (id) await this.act(net => net.leaveRoom(id));
    this.refreshRooms();
  }

  // ---- code entry -----------------------------------------------------------------------------
  typeCode() {
    if (Engine.keys.has('Control') || Engine.keys.has('Meta')) return; // Ctrl+V arrives as a paste event
    for (const k of Engine.pressed) {
      if (k === 'Backspace') this.code = this.code.slice(0, -1);
      else if (k === 'Enter') { if (this.code.length === 5) this.join(this.code); }
      else if (k === 'Escape') { this.mode = 'menu'; }
      else if (k.length === 1) { const c = k.toUpperCase(); if (CODE_CHARS.test(c) && this.code.length < 5) this.code += c; }
    }
  }

  // ---- drawing --------------------------------------------------------------------------------
  draw(ctx) {
    swirlBackground(ctx, BG_THEMES.map, 0.5);
    text(ctx, 'CO-OP', W / 2, 8, { align: 'center', color: 'gold', scale: 2 });
    text(ctx, 'PROTOTYPE · 2-4 players online · shared map, team battles, own teams', W / 2, 40, { align: 'center', color: 'orange', font: 'small' });
    if (this.mode === 'menu') this.drawMenu(ctx);
    else if (this.mode === 'join') this.drawJoin(ctx);
    else this.drawRoom(ctx);
    drawTips(ctx);
    drawToasts(ctx);
  }

  drawMenu(ctx) {
    const x = 60, w = 220;
    panel(ctx, x, 62, w, 250);
    text(ctx, 'PLAY WITH A FRIEND', x + w / 2, 70, { align: 'center', color: 'white' });
    if (button(ctx, 'CREATE ROOM', x + 20, 92, w - 40, 30, { color: THEME.green, disabled: this.busy || !this.net })) this.create();
    textBlock(ctx, 'You host: you get a code to send to your friends (2-4 players), and choose the ascension.', x + 16, 128, w - 32, { color: 'whiteSoft', font: 'small' });
    if (button(ctx, 'JOIN ROOM', x + 20, 176, w - 40, 30, { color: THEME.play, disabled: this.busy || !this.net })) { this.mode = 'join'; this.code = ''; }
    textBlock(ctx, "Type (or paste) the 5-letter code your host sent you.", x + 16, 212, w - 32, { color: 'whiteSoft', font: 'small' });
    if (this.netErr) textBlock(ctx, this.netErr, x + 16, 250, w - 32, { color: 'red', font: 'small' });
    // rejoin list
    const rx = 300, rw = 280;
    panel(ctx, rx, 62, rw, 250);
    text(ctx, 'REJOIN', rx + rw / 2, 70, { align: 'center', color: 'white' });
    if (!this.rooms) text(ctx, 'Loading...', rx + rw / 2, 100, { align: 'center', color: 'gray', font: 'small' });
    else if (!this.rooms.length) text(ctx, 'No open rooms.', rx + rw / 2, 100, { align: 'center', color: 'gray', font: 'small' });
    (this.rooms || []).slice(0, 6).forEach((r, i) => {
      const y = 90 + i * 36;
      // the X (delete) sits on the row's right edge; the rest of the row rejoins
      const dx = rx + rw - 30, overX = hover(dx, y + 6, 18, 18);
      const hot = !overX && hover(rx + 8, y, rw - 16, 32);
      pixBox(ctx, rx + 8, y, rw - 16, 32, hot ? '#3e4c70' : '#2a3246', hot ? '#f8d038' : '#141820', 3);
      if (button(ctx, 'X', dx, y + 6, 18, 18, { color: '#904848', font: 'small', disabled: this.busy })) this.askDelete(r);
      if (overX) tip('DELETE ROOM', r.status === 'playing' ? 'Remove it from your list and leave the run for good. Your partner can keep playing; once you have both deleted it, it is gone.' : r.isHost ? 'Close the room and remove it.' : 'Leave the room and remove it from your list.');
      text(ctx, r.code, rx + 16, y + 3, { color: 'gold' });
      text(ctx, `${r.status === 'playing' ? 'IN PROGRESS' : 'LOBBY'} · ${coopWorldLabel(r.world)} A${r.ascension}${r.progress ? ' · ' + r.progress : ''}`, rx + 70, y + 5, { color: r.status === 'playing' ? 'lime' : 'whiteSoft', font: 'small' });
      text(ctx, (r.members || []).map(m => `P${m.slot + 1} ${m.name}${m.saved ? ' (saved)' : ''}`).join(' · '), rx + 16, y + 18, { color: 'gray', font: 'small' });
      if (hot && clicked(rx + 8, y, rw - 16, 32) && !this.busy) { Sound.playSE('se_select'); this.openRoom(r.roomId); }
    });
    if (button(ctx, 'REFRESH', rx + rw - 84, 286, 76, 20, { color: '#506080', font: 'small' })) { this.rooms = null; this.refreshRooms(); }
    if (button(ctx, 'BACK', 14, H - 34, 70, 24, { color: '#806060' })) this.toTitle();
  }

  drawJoin(ctx) {
    const w = 320, x = (W - w) / 2, y = 90;
    panel(ctx, x, y, w, 170);
    text(ctx, 'ENTER ROOM CODE', W / 2, y + 10, { align: 'center', color: 'white' });
    for (let i = 0; i < 5; i++) {
      const bx = W / 2 - 5 * 23 + i * 46, by = y + 36;
      const cur = i === this.code.length;
      pixBox(ctx, bx, by, 40, 48, '#1b2030', cur && Math.floor(this.t * 2) % 2 ? '#f8d038' : '#506078', 3);
      if (this.code[i]) text(ctx, this.code[i], bx + 20, by + 8, { align: 'center', color: 'gold', scale: 2 });
    }
    text(ctx, 'Type A-Z / 2-9 · Backspace · Enter · Ctrl+V to paste', W / 2, y + 94, { align: 'center', color: 'gray', font: 'small' });
    if (button(ctx, 'JOIN', W / 2 + 10, y + 120, 120, 30, { color: THEME.green, disabled: this.code.length !== 5 || this.busy })) this.join(this.code);
    if (button(ctx, 'BACK', W / 2 - 130, y + 120, 120, 30, { color: '#806060' })) this.mode = 'menu';
  }

  drawRoom(ctx) {
    const v = this.view;
    if (!v) { text(ctx, 'Opening room...', W / 2, 160, { align: 'center', color: 'white' }); if (button(ctx, 'BACK', 14, H - 34, 70, 24, { color: '#806060' })) this.backToMenu(); return; }
    const room = v.room, me = v.me, isHost = v.isHost ?? room.host === me;
    // code
    panel(ctx, 14, 58, 200, 62);
    text(ctx, 'ROOM CODE', 20, 62, { color: 'gray', font: 'small' });
    text(ctx, room.code, 20, 74, { color: 'gold', scale: 2 });
    if (button(ctx, 'COPY', 150, 66, 56, 16, { color: '#506080', font: 'small' })) navigator.clipboard?.writeText(room.code).then(() => coopToast('Code copied!', { good: true })).catch(() => coopToast('Copy failed; read it out instead.', { bad: true }));
    const nm = v.members.length;
    // (seats: 2 while a player on an older 2-player version is in the room, see convex/coop.ts roomCap)
    const seats = Math.max(2, Math.min(MAX_PLAYERS, room.maxPlayers ?? MAX_PLAYERS));
    text(ctx, nm < 2 ? 'Send this code to your friends' : nm < seats ? `${nm} players here · room for ${seats - nm} more` : seats < MAX_PLAYERS ? '2-player room (someone needs to reload)' : 'The room is full!', 20, 102, { color: nm < 2 ? 'whiteSoft' : 'lime', font: 'small' });
    // members: up to four seats
    for (let p = 0; p < MAX_PLAYERS; p++) {
      const m = v.members.find(x => x.slot === p);
      const y = 124 + p * 42;
      pixBox(ctx, 14, y, 200, 40, '#252b3a', p === me ? '#f8d038' : '#141820', 3);
      pixBox(ctx, 18, y + 4, 22, 14, PCOL[p], null, 2);
      text(ctx, `P${p + 1}`, 29, y + 5, { align: 'center', color: 'white', font: 'small' });
      if (!m) { text(ctx, p < 2 ? 'waiting for a partner...' : p < seats ? 'open seat' : 'closed (old version here)', 46, y + 6, { color: 'gray', font: 'small' }); draw(ctx, PSPRITE[p], 150, y + 4, { sx: 0, sy: 0, sw: 16, sh: 32, alpha: 0.3 }); continue; }
      const online = !m.left && (!v.now || v.now + (Date.now() - (v.nowAt || Date.now())) - m.lastSeen < OFFLINE_MS);
      textFit(ctx, `${m.name}${p === me ? ' (you)' : ''}${room.host === p ? ' · HOST' : ''}`, 46, y + 5, 100, { color: 'white', font: 'small' });
      text(ctx, online ? 'online' : 'offline', 46, y + 20, { color: online ? 'lime' : 'gray', font: 'small' });
      text(ctx, m.ready ? 'READY' : 'not ready', 90, y + 20, { color: m.ready ? 'lime' : 'gray', font: 'small' });
      draw(ctx, PSPRITE[p], 150, y + 4, { sx: 0, sy: 0, sw: 16, sh: 32 });
      if (m.starter) drawIcon(ctx, m.starter, 170, y + 4);
      else text(ctx, '?', 186, y + 14, { align: 'center', color: 'gray', font: 'small' });
    }
    // starter pick
    const mine = v.members.find(x => x.slot === me);
    const world = room.world || 'kanto';
    // One Spire: no world choice. A lobby left from before v0.1.0 (a legacy world) moves to the spire when its host
    // opens it (a run already in progress keeps its world).
    // (v0.1.1: also when the host's region pool changed, e.g. JOHTO joined after their 2nd win)
    if (isHost && room.status === 'lobby' && world !== coopWorldFor(G.meta) && !this.busy && !this.respired) { this.respired = true; this.config({ world: coopWorldFor(G.meta) }); }
    // The KANTO three plus the starters this player has unlocked (6 big tiles, or up to 16 small ones).
    const list = availableStarters(G.meta, 'spire', s => !!D.species[s]);
    panel(ctx, 224, 58, 402, 120);
    text(ctx, 'CHOOSE YOUR PARTNER POKéMON', 425, 64, { align: 'center', color: 'white', font: 'small' });
    const big = list.length <= 6, tw = big ? 62 : 46, th = big ? 74 : 46, gap = big ? 4 : 3, per = big ? 6 : 8;
    list.slice(0, 16).forEach((sp, i) => {
      const cx = 232 + (i % per) * (tw + gap), cy = 78 + Math.floor(i / per) * (th + 3);
      const sel = mine?.starter === sp;
      const taken = v.members.some(x => x.slot !== me && x.starter === sp);
      const hot = hover(cx, cy, tw, th);
      pixBox(ctx, cx, cy, tw, th, sel ? '#4a5c88' : hot ? '#38445e' : '#262c3c', sel ? '#f8d038' : '#141820', 3);
      const bob = sel ? Math.sin(this.t * 6) * 1.5 : 0;
      if (big) {
        drawMon(ctx, sp, cx - 1, cy + 2 + bob);
        text(ctx, D.species[sp].name, cx + 31, cy + 62, { align: 'center', color: 'white', font: 'small' });
      } else { ctx.save(); ctx.beginPath(); ctx.rect(cx + 2, cy + 2, tw - 4, th - 4); ctx.clip(); drawMonCentered(ctx, sp, cx + tw / 2, cy + th / 2 + Math.round(bob)); ctx.restore(); }
      const takers = v.members.filter(x => x.slot !== me && x.starter === sp).map(x => `P${x.slot + 1}`);
      if (taken) text(ctx, big ? takers.join(' ') : 'P', big ? cx + 31 : cx + tw - 6, cy + 2, { align: 'center', color: 'orange', font: 'small' });
      if (!big && hot) tip(D.species[sp].name, taken ? `${takers.join(', ')} picked this one too.` : 'Click to bring it.');
      if (hot && clicked(cx, cy, tw, th) && !this.busy && !sel) { Sound.playCry(sp); this.act(net => net.setStarter(this.roomId, sp, ascUnlocked(G.meta, sp))).then(() => this.poll()); }
    });
    if (list.length <= 3) text(ctx, 'Clear acts (solo or co-op) to unlock more starters.', 425, 160, { align: 'center', color: 'gray', font: 'small' });
    // settings
    panel(ctx, 224, 184, 402, 100);
    text(ctx, isHost ? 'RUN SETTINGS (host)' : 'RUN SETTINGS (the host picks)', 425, 190, { align: 'center', color: 'white', font: 'small' });
    // per-starter unlocks: the highest of the players' levels for the starters they picked, not their best
    // overall (the server enforces it); my own pick counts with my local unlock, no picks yet = no cap
    const maxA = coopAscCap([...v.members.filter(m => m.slot !== me), { ascMax: mine?.starter ? ascUnlocked(G.meta, mine.starter) : null }]);
    const a = room.ascension || 0;
    text(ctx, 'ASCENSION', 236, 210, { color: 'whiteSoft', font: 'small' });
    if (isHost && button(ctx, '<', 300, 205, 22, 20, { color: '#506080', disabled: a <= 0 || this.busy })) this.config({ ascension: a - 1 });
    text(ctx, 'A' + a, 344, 207, { align: 'center', color: a ? 'red' : 'gold' });
    if (isHost && button(ctx, '>', 366, 205, 22, 20, { color: '#506080', disabled: a >= maxA || this.busy })) this.config({ ascension: a + 1 });
    textBlock(ctx, coopAscDesc(ASCENSIONS[a]), 236, 230, 170, { color: 'gray', font: 'small', lineHeight: 10 });
    if (hover(236, 205, 160, 70)) tip(`ASCENSION ${a}`, (a > 0 ? ASCENSIONS.slice(1, a + 1).map(x => `A${x.n}: ${coopAscDesc(x)}`).join('\n') + '\n\n' : '') + `Ascension unlocks are per starter: this room can go up to A${maxA}, the highest any of you has unlocked with the starter you picked.`, { width: 220 });
    // the region pool (the host's: HOENN acts join once the host has won a run, JOHTO acts after 2 wins)
    text(ctx, 'REGIONS', 430, 210, { color: 'whiteSoft', font: 'small' });
    text(ctx, isSpireWorld(world) ? coopWorldRegions(world) : coopWorldLabel(world), 560, 210, { align: 'center', color: 'gold', font: 'small' });
    textBlock(ctx, 'Each act draws its region from the run seed. HOENN acts join once the host has won a run, JOHTO acts once the host has won twice.', 430, 226, 186, { color: 'gray', font: 'small', lineHeight: 10 });
    // buttons
    const both = v.members.length >= 2 && v.members.every(x => x.starter);
    if (mine && button(ctx, mine.ready ? 'READY ✓' : 'READY?', 224, 292, 120, 26, { color: mine.ready ? THEME.green : '#506080', disabled: this.busy })) this.act(net => net.setReady(this.roomId, !mine.ready)).then(() => this.poll());
    if (isHost) {
      if (button(ctx, 'START', 506, 292, 120, 26, { color: THEME.green, disabled: !both || this.busy })) this.act(net => net.startRoom(this.roomId)).then(r => { if (r) this.poll(); });
      if (!both) text(ctx, v.members.length < 2 ? 'waiting for a second player' : 'everyone needs a starter', 566, 322, { align: 'center', color: 'gray', font: 'small' });
      else if (v.members.length < seats) text(ctx, `start with ${v.members.length} or wait`, 566, 322, { align: 'center', color: 'gray', font: 'small' });
    } else text(ctx, 'waiting for the host to start...', 566, 300, { align: 'center', color: 'gray', font: 'small' });
    if (this.pollErr) text(ctx, this.pollErr, 425, 340, { align: 'center', color: 'red', font: 'small' });
    if (button(ctx, 'LEAVE', 14, H - 34, 70, 24, { color: '#806060', disabled: this.busy })) this.leave();
    if (button(ctx, 'BACK', 90, H - 34, 70, 24, { color: '#506080' })) this.backToMenu();
    if (hover(90, H - 34, 70, 24)) tip('BACK', 'Back to the co-op menu; you keep your seat (REJOIN).');
  }
  config(opts) { this.act(net => net.configure(this.roomId, opts)).then(() => this.poll()); }
  toTitle() { import('../title.js').then(m => setScene(new m.TitleScene())); }
}

// Not part of a run: NOW PLAYING (net/presence.js) does not list you here.
CoopLobbyScene.prototype.idle = true;
