// CoopSession: the controller for one online co-op game (a singleton while in co-op: G.coop, window.__coop).
// Lockstep: every client applies the room's action log (seq 1, 2, 3...) to its own CoopGame and routes
// scenes by game.phase. Nothing is applied optimistically; our own actions come back through the log.
import { Engine, setScene } from '../../engine/core.js';
import { G, saveMeta } from '../../game/state.js';
import { recordCoopDex } from '../../game/coop/dex.js';
import * as Coop from '../../game/coop/coop.js';
import { NODE_INFO } from '../../game/map.js';
import { actTitle, actBosses, trainerName, orList } from '../../game/regions.js';
import { RewardScene } from '../reward.js';
import { ShopScene } from '../shop.js';
import { CenterScene } from '../center.js';
import { EventScene } from '../event.js';
import { TreasureScene } from '../treasure.js';
import { ActClearScene } from '../gameover.js';
import { coopToast, drawCoopOverlay, OFFLINE_MS, PCOL } from './ui.js';
import { sketchFor } from '../sketch.js';
import { eventById, markSeen } from '../../game/events.js';
import { CoopMapScene } from './map.js';
import { CoopBattleScene } from './battle.js';
import { CoopWaitScene } from './wait.js';
import { CoopEndScene } from './end.js';
import { VERSION } from '../../game/version.js';
import { LOGIC_ID } from '../../game/coop/engines.js';
import { resumeRoom, parseCheckpoint } from '../../game/coop/resume.js';
import { isSafePoint, snapshotGame } from '../../game/coop/snapshot.js';
import { loadJSON } from '../../engine/assets.js';
import { coopRunPayload } from '../../net/cloud.js';
import { NET_PROTO, encodePrivateDone, expandAction } from '../../game/coop/wire.js';

// Network (staging-net): the room arrives through subscriptions (net.CoopFeed: coop:head, coop:feed, coop:presence;
// sketches through net.watchSketch), nothing polls. Presence is a keepalive (net.alive) every KEEPALIVE_MS, every
// KEEPALIVE_HIDDEN_MS in a hidden tab, at once when the tab shows / hides or the socket reconnects, and a goodbye when
// the tab closes.
const CK_HISTORY = 300;
const KEEPALIVE_MS = 30000;          // (net.KEEPALIVE_MS when the net has one; ui.js OFFLINE_MS allows for it)
const KEEPALIVE_HIDDEN_MS = 60000;   // a hidden tab (and it says so: the others wait longer)
const CONFIRM_DELAY_MS = 3000;  // a non-writer confirms a checkpoint this long after reaching the map
const BURST_MS = 5000;          // actions arrived this recently: more are probably coming
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
// p, or `fallback` if it takes longer than ms (a WebSocket call waits for the connection instead of failing)
const within = (p, ms, fallback) => Promise.race([p, sleep(ms).then(() => fallback)]);
// 'v0.3.7' > 'v0.3.6'
const newerVersion = (a, b) => {
  const pa = String(a).replace(/^v/, '').split('.').map(Number), pb = String(b).replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
};
// (a frozen engine, web/src/legacy/<id>/, loads its own copy of the game data)
const dataLoader = (f) => loadJSON('data/' + f);

export class CoopSession {
  // net: the coopnet module (or the dev mock). info: { roomId, code, mySlot, members, now }
  constructor(net, info) {
    this.net = net;
    this.roomId = info.roomId;
    this.code = info.code || '';
    this.mySlot = info.mySlot ?? 0;
    this.members = info.members || [];
    this.serverNow = info.now || Date.now();
    this.serverNowAt = Date.now();
    this.game = null;
    this.lastSeq = 0;              // last applied seq
    this.buffer = new Map();       // seq -> action, waiting for a gap to fill
    this.log = [];                 // actions applied since the resume (debugging)
    this.ck = new Map();           // seq -> checksum after applying it (last CK_HISTORY)
    this.desync = null;            // { seq, atSeq } once a partner checksum disagrees with ours
    this.synced = false;           // caught up with the server log at least once
    this.routeKey = null;
    this.privateSince = 0;         // seq at which the current private phase began (identifies it)
    this.privatePosted = null;     // privateId() we already sent privateDone for
    this.pendingVote = null;       // node we clicked, until the vote comes back through the log
    this.battleFeed = [];          // [{ battle, seq, p, events }] live game.lastEvents of battle actions, for CoopBattleScene
    this.outbox = [];
    this.netError = null;          // { since, msg } while polling fails
    this.applyErrors = 0;
    this.status = 'playing';
    this.stopped = false;
    this.loading = null;           // 'save' | 'replay' while resuming (CoopWaitScene shows it)
    this.cpSeq = 0;                // newest checkpoint seq the server has (or we wrote)
    this.resumed = null;           // resumeRoom()'s summary (mode, engine, dropped...)
    this.cpBlocked = false;        // the resumed game couldn't be verified: no checkpoints until a partner's checksum agrees
    this.resumeSeq = 0;
    this.presence = null;          // slot -> { lastSeen, hb, gone? } (coop:presence)
    this.lastApplyAt = 0;
    this.hbMs = net.KEEPALIVE_MS || net.HEARTBEAT_MS || KEEPALIVE_MS;
    this.hiddenMs = net.KEEPALIVE_HIDDEN_MS || KEEPALIVE_HIDDEN_MS;
    this.sketchSubs = {};          // slot -> stop() of its coop:sketch subscription
  }

  // 2-4 players: n, the other slots, and partnerSlot = the first other player (THE partner with 2 players)
  get n() { return this.game?.n || Math.max(2, this.members.length); }
  get others() { const out = []; for (let p = 0; p < this.n; p++) if (p !== this.mySlot) out.push(p); return out; }
  get partnerSlot() { return this.others[0] ?? (1 - this.mySlot); }
  get myRun() { return this.game?.runs?.[this.mySlot] || null; }
  get partnerRun() { return this.game?.runs?.[this.partnerSlot] || null; }
  member(p) { return this.members.find(m => m.slot === p) || null; }
  nameOf(p) { return this.member(p)?.name || this.game?.names?.[p] || this.game?.init?.names?.[p] || `P${p + 1}`; }
  isOnline(p) {
    if (p === this.mySlot) return !this.netError;
    const m = this.member(p);
    if (!m || m.left) return false;
    const now = this.serverNow + (Date.now() - this.serverNowAt);
    // (presence: the coop:presence subscription; a fake net in tests may put lastSeen in the members instead)
    const pr = this.presence?.[p];
    if (pr?.gone) return false; // (they closed the tab)
    const seen = Math.max(pr?.lastSeen ?? 0, m.lastSeen ?? 0);
    if (!seen) return Date.now() - (this.startedAt || 0) < OFFLINE_MS; // (no keepalive of theirs seen yet: give them time)
    // (someone who beats less often, a hidden tab, gets two of their keepalives and some slack)
    return now - seen < Math.max(OFFLINE_MS, 2 * (pr?.hb || 0) + 10000);
  }
  // Am I waiting on the others (or on the server)?
  waiting() {
    if (this.outbox.length || this.flushing || !this.synced || Date.now() - this.lastApplyAt < BURST_MS) return true;
    const g = this.game, p = this.mySlot;
    if (!g) return true;
    if (g.phase === 'battle') return !!(g.battle?.locks?.[p] || g.battle?.down?.[p] || g.down?.[p]);
    if (g.phase === 'private') return !!g.private?.done?.[p] || this.privatePosted === this.privateId();
    if (g.phase === 'map') return g.votes?.[p] != null;
    return false;
  }
  // ---- lifecycle --------------------------------------------------------------------------------
  start() {
    CoopSession.current?.stop();
    CoopSession.current = this;
    G.coop = this;
    if (typeof window !== 'undefined') window.__coop = this;
    this.routeKey = 'connect';
    setScene(new CoopWaitScene(this));
    this.startedAt = Date.now();
    this.beat(true);
    // (a little jitter: partners' keepalives that land together conflict on the server and get retried)
    const tick = () => { this.hbTimer = setTimeout(() => { this.beat(); if (!this.stopped && this.hbTimer) tick(); }, this.keepaliveMs() * (0.85 + Math.random() * 0.3)); };
    tick();
    if (typeof document !== 'undefined') {
      // shown or hidden: say so right away (hidden: "I'll beat less often from now on")
      this.onVisible = () => { if (!this.stopped) this.beat(true); };
      document.addEventListener('visibilitychange', this.onVisible);
    }
    if (typeof addEventListener !== 'undefined') {
      // closing the tab (or reloading): goodbye, so the others see us offline at once rather than a minute later
      this.onLeave = () => { if (!this.stopped && !this.quitting) this.net.goodbye?.(this.roomId); };
      addEventListener('pagehide', this.onLeave);
    }
    // the socket: down for a moment = CONNECTION LOST (after 4 s, ui.js); back = a keepalive at once (the Convex client
    // has already subscribed again, and the feed's re-run brings what we missed)
    this.connOff = this.net.onConnection?.((st) => this.onConn(st));
    this.resumeThenFeed();
    return this;
  }
  keepaliveMs() { return typeof document !== 'undefined' && document.hidden ? this.hiddenMs : this.hbMs; }
  onConn(st) {
    if (this.stopped || !st) return;
    const up = !!st.isWebSocketConnected;
    if (!up && st.hasEverConnected) { if (!this.netError) this.netError = { since: Date.now(), msg: 'reconnecting', conn: true }; }
    else if (up) {
      if (this.netError?.conn) this.netError = null;
      if (this.wasDown) this.beat(true);
    }
    this.wasDown = !up && !!st.hasEverConnected;
  }
  // v0.3.6: load the latest checkpoint + the log after it (resume.js), then follow the live feed. If that fails
  // outright, fall back to the old way: stream and apply the whole log from seq 1.
  resumeThenFeed() {
    return this.resume().catch(e => {
      console.error('[coop] resume failed; replaying the whole log', e);
      this.game = null; this.lastSeq = 0; this.ck.clear();
      this.cpBlocked = true; // (that replay isn't checked: it must not become everyone's checkpoint)
    }).finally(() => { this.loading = null; if (!this.stopped) this.startFeed(); });
  }
  startFeed() {
    if (this.stopped) return;
    this.feed?.stop();
    this.feed = new this.net.CoopFeed(this.roomId, {
      after: this.lastSeq,
      onActions: (acts) => { this.feedOk(); this.receive(acts); },
      onHead: (v) => { this.feedOk(); this.onHead(v); },
      onPresence: (list) => this.onPresence(list),
      onCaughtUp: () => { this.feedOk(); this.onCaughtUp(); },
      onError: (e) => { this.netError ||= { since: Date.now(), msg: e?.message }; },
    }).start();
  }
  feedOk() { if (this.netError && !this.netError.conn) this.netError = null; }
  async retry(fn, tries = 12) {
    for (let i = 0; ; i++) {
      try { const r = await fn(); this.netError = null; return r; } catch (e) {
        if (this.stopped || i >= tries) throw e;
        this.netError ||= { since: Date.now(), msg: e?.message };
        await sleep(Math.min(5000, 400 * 2 ** i));
      }
    }
  }
  async resume() {
    if (!this.net.latestCheckpoint) return; // (a backend without checkpoints: stream the log)
    this.loading = 'save';
    let cp = await this.retry(() => this.net.latestCheckpoint(this.roomId));
    if (this.stopped) return;
    // saved by a newer version than this tab: reload first (this code may not know what that version added)
    if (cp?.gameVersion && newerVersion(cp.gameVersion, VERSION)) {
      coopToast(`This game was saved on ${cp.gameVersion}: reload the page to update`, { bad: true, t: 10 });
      this.stop({ toTitle: true });
      return;
    }
    if (cp && !parseCheckpoint(cp)) { console.warn('[coop] unusable checkpoint, replaying the whole log', cp.seq); cp = null; }
    const actions = [];
    let after = cp?.seq ?? 0;
    for (;;) {
      // (one-shot reads of the log over the socket; a fake net in tests may only have fetchSince)
      const r = await this.retry(() => (this.net.fetchFeed ? this.net.fetchFeed(this.roomId, after) : this.net.fetchSince(this.roomId, after)));
      if (this.stopped) return;
      if (r.members) this.members = r.members;
      if (r.now) { this.serverNow = r.now; this.serverNowAt = Date.now(); }
      if (r.room?.status) this.status = r.room.status;
      const fresh = r.actions.filter(a => a.seq > after);
      actions.push(...fresh);
      if (fresh.length) after = fresh[fresh.length - 1].seq;
      if (!r.more || !fresh.length) break;
    }
    this.loading = 'replay';
    await sleep(30); // (let the wait screen draw)
    const res = await resumeRoom({ checkpoint: cp, actions, dataLoader });
    if (this.stopped || !res.game) return; // (no init yet: the feed brings it)
    this.game = res.game;
    this.lastSeq = res.seq;
    this.ck = new Map(res.cks);
    this.log = [];
    this.resumed = { mode: res.mode, engine: res.engine, stamp: res.stamp, base: res.base, seq: res.seq, dropped: res.dropped, tried: res.tried };
    this.cpSeq = cp?.seq ?? 0;
    this.cpBlocked = !res.verified;
    this.resumeSeq = res.seq;
    if (this.game.phase === 'private') this.privateSince = res.seq;
    console.info('[coop] resumed', this.resumed);
    // A new checkpoint: the first one of a room from before v0.3.6, a newer safe point than the server's, or the
    // hand-over from an older engine / a fallback: every client must continue from that same state, so that one
    // is stored before playing on.
    if (res.safe) {
      const handover = res.mode === 'legacy' || res.mode === 'fallback';
      if (!handover) this.writeCheckpoint(res.safe, 'resume');
      else await this.retry(async () => { if ((await this.writeCheckpoint(res.safe, res.mode)) === 'net') throw new Error('offline'); }).catch(() => {});
    }
    if (res.mode === 'fallback' || (res.mode === 'legacy' && res.dropped > 0)) coopToast('The game was updated: this stop starts over from the map.', { t: 6 });
  }
  // ---- checkpoints (v0.3.6) ---------------------------------------------------------------------
  // At every safe point (the map) the game state goes to the server, so the room resumes from it, across updates.
  // -> Promise<boolean> (true: the server has a checkpoint at the game's current seq)
  // -> Promise<true | false | 'net'> ('net': a network failure, worth retrying)
  // One client uploads each map checkpoint (the lowest slot that's in the game and online: cpWriter); the others
  // confirm it a moment later with just their checksum (that adds their slot, or marks it disputed on a desync, as
  // a full write would) and upload only if the server still has no state for that seq. SAVE & QUIT and resumes
  // confirm first too: the state usually is there already.
  checkpointNow(reason = 'auto') {
    const g = this.game;
    if (!g || !isSafePoint(g) || this.desync || this.cpBlocked || (reason !== 'save' && (!this.synced || this.stopped))) return Promise.resolve(false);
    if (g.seq <= this.cpSeq) return Promise.resolve(g.seq === this.cpSeq);
    const s = { seq: g.seq, snap: snapshotGame(g), checksum: g.checksum() >>> 0 };
    if (reason === 'auto' && !this.cpWriter()) {
      const prev = this.cpSeq;
      this.cpSeq = s.seq;
      return sleep(CONFIRM_DELAY_MS).then(() => (this.stopped ? false : this.writeCheckpoint(s, reason, { prev })));
    }
    return this.writeCheckpoint(s, reason, { full: reason === 'auto' });
  }
  // Do I upload the map checkpoints? The lowest slot that's in the game (not sat out) and online, as I see it.
  cpWriter() {
    const g = this.game;
    for (let p = 0; p < this.n; p++) {
      if (g?.away?.[p]) continue;
      if (p === this.mySlot || this.isOnline(p)) return p === this.mySlot;
    }
    return true;
  }
  // full: upload the state right away; else confirm by checksum and upload only if the server needs it.
  writeCheckpoint(s, reason, { full = false, prev = this.cpSeq } = {}) {
    if (!this.net.writeCheckpoint) return Promise.resolve(false);
    this.cpSeq = Math.max(this.cpSeq, s.seq);
    const act = s.snap?.world?.o?.actIndex;
    const progress = Number.isInteger(act) ? `ACT ${act + 1}` : undefined;
    const cp = { seq: s.seq, phase: 'map', checksum: s.checksum, gameVersion: VERSION, engine: LOGIC_ID, reason, ...(progress ? { progress } : {}) };
    const upload = () => this.net.writeCheckpoint(this.roomId, { ...cp, state: JSON.stringify(s.snap) });
    const go = full || !this.net.confirmCheckpoint ? upload() : this.net.confirmCheckpoint(this.roomId, cp).then(r => (r?.need ? upload() : r));
    return go
      .then(r => { if (r?.disputed) console.warn('[coop] checkpoint disputed at #' + s.seq); this.lastSaved = { seq: s.seq, at: Date.now() }; return true; })
      .catch(e => { if (this.cpSeq === s.seq) this.cpSeq = prev; console.warn('[coop] checkpoint failed', e); return this.net.isNetworkError?.(e) ? 'net' : false; });
  }
  // SAVE & QUIT: send what's queued, store a checkpoint (on the map), tell the others, back to the title.
  async saveAndQuit() {
    if (this.quitting || this.stopped) return;
    this.quitting = true; // (post() sends nothing new from here on)
    coopToast('Saving...', { t: 1.2 });
    const t0 = Date.now();
    while ((this.outbox.length || this.flushing) && Date.now() - t0 < 5000) await sleep(100);
    // The room log is the save; the checkpoint (on the map) lets it load fast and across updates. Only being
    // offline stops the quit (the last actions or the checkpoint didn't reach the server).
    const cp = this.outbox.length ? 'net' : isSafePoint(this.game) ? await within(this.checkpointNow('save'), 10000, 'net') : true;
    if (cp === 'net' || this.outbox.length) { this.quitting = false; coopToast("Couldn't save (offline?). Try again in a moment.", { bad: true, t: 4 }); return; }
    // (no more keepalives: one landing after saveQuit would mark us back)
    clearTimeout(this.hbTimer); this.hbTimer = null;
    await Promise.race([this.hbP, sleep(3000)]).catch(() => {});
    await within(Promise.resolve(this.net.saveQuit?.(this.roomId)).catch(() => {}), 8000);
    coopToast('Saved! REJOIN from CO-OP to continue.', { good: true, t: 4 });
    this.savedQuit = true;
    setTimeout(() => this.stop({ toTitle: true }), 1200);
  }
  stop({ toTitle = false } = {}) {
    if (this.stopped) return;
    // (leaving without SAVE & QUIT, e.g. to the title: the others see us offline at once)
    if (!this.savedQuit && !this.quitting) this.net.goodbye?.(this.roomId, { unloading: false });
    this.stopped = true;
    this.feed?.stop();
    for (const k of Object.keys(this.sketchSubs)) { try { this.sketchSubs[k]?.(); } catch {} }
    this.sketchSubs = {};
    try { this.connOff?.(); } catch {}
    clearTimeout(this.hbTimer);
    clearTimeout(this.sketchTimer);
    if (this.onVisible) document.removeEventListener('visibilitychange', this.onVisible);
    if (this.onLeave) removeEventListener('pagehide', this.onLeave);
    if (CoopSession.current === this) CoopSession.current = null;
    if (G.coop === this) { G.coop = null; G.run = null; }
    if (typeof window !== 'undefined' && window.__coop === this) window.__coop = null;
    if (toTitle) import('../title.js').then(m => setScene(new m.TitleScene()));
  }
  // v0.3.12: the run is over (a win or a wipe): record it once as ONE team run in RECORDS and close the room, so it
  // leaves the REJOIN list (net.finishRoom -> coop:finish; the Convex client queues it offline-safe, so a reload on
  // the end screen still records it). Every client sends it, the server keeps the first. Called by CoopEndScene.
  finishRun() {
    const g = this.game;
    if (this.finishSent || !g || (g.phase !== 'victory' && g.phase !== 'over') || this.desync || !this.net.finishRoom) return;
    this.finishSent = true;
    let run;
    try { run = coopRunPayload(g, { code: this.code }); } catch (e) { console.warn('[coop] no team run to record', e); return; }
    Promise.resolve().then(() => this.net.finishRoom(this.roomId, run)).catch(e => console.warn('[coop] finish failed', e));
  }
  // The presence keepalive: every keepaliveMs() (a timer), and at once (force) when the tab shows / hides or the
  // socket comes back. It says how often it beats (hb), so the others give a hidden tab longer. A closed tab says
  // goodbye instead (onLeave); SAVE & QUIT stops it.
  beat(force = false) {
    if (this.stopped || this.quitting) return;
    const hb = this.keepaliveMs();
    if (!force && Date.now() - (this.beatAt || 0) < hb * 0.8) return;
    this.beatAt = Date.now();
    this.hbP = Promise.resolve()
      .then(() => (this.net.alive ? this.net.alive(this.roomId, { hb }) : this.net.heartbeat(this.roomId, this.lastSeq, { hb })))
      .then(r => this.onBeat(r)).catch(() => {});
  }
  onBeat(r) {
    if (!r || this.stopped) return;
    if (r.now) { this.serverNow = r.now; this.serverNowAt = Date.now(); }
    if (Array.isArray(r.presence)) this.onPresence(r.presence); // (an older net's heartbeat)
  }
  onPresence(list) {
    if (this.stopped || !Array.isArray(list)) return;
    const pr = {};
    for (const x of list) pr[x.slot] = x;
    this.presence = pr;
  }

  // coop:head: the room and its members (no nextSeq / presence: the feed and coop:presence bring those).
  onHead(v) {
    if (this.stopped || !v) return;
    const members = v.members;
    if (members && this.synced) {
      for (const m of members) {
        const old = this.members.find(x => x.slot === m.slot);
        if (m.slot !== this.mySlot && m.saved && !old?.saved) coopToast(`${m.name} saved and quit. Wait for them, or SAVE & QUIT too.`, { t: 6 });
      }
    }
    if (members) { this.members = members; this.syncSketchSubs(members); }
    if (v.room?.status) this.status = v.room.status;
    if (this.synced) this.checkAway(); // (a player sat out while away is back in as soon as they're caught up)
  }
  // The feed brought nothing new: caught up with the log (as of that moment).
  onCaughtUp() {
    if (this.stopped) return;
    if (!this.synced && this.game && !this.buffer.size) { this.synced = true; this.route(); this.checkpointNow('resume'); }
    if (this.synced) this.checkAway();
  }

  // ---- applying the log -------------------------------------------------------------------------
  receive(actions) {
    for (const a of actions) if (a.seq > this.lastSeq && !this.buffer.has(a.seq)) this.buffer.set(a.seq, a);
    const top = Math.max(this.lastSeq, ...this.buffer.keys());
    let applied = 0;
    while (this.buffer.has(this.lastSeq + 1)) {
      const a = this.buffer.get(this.lastSeq + 1);
      this.buffer.delete(a.seq);
      this.applyOne(a, top);
      applied++;
    }
    if (applied) this.lastApplyAt = Date.now();
    if (applied && this.synced) this.route();
    if (applied) this.checkAway();
  }

  applyOne(a, top = a.seq, replay = false) {
    a = expandAction(this.game, a); // (a compact privateDone gets its run back: game/coop/wire.js)
    const g0 = this.game;
    const before = g0 ? { phase: g0.phase, kind: g0.private?.kind, node: g0.private?.node, lastVote: g0.lastVote, events: Array.isArray(g0.events) ? g0.events.length : 0, battle: g0.battle } : null;
    // Desync check: the sender's checksum at atSeq vs ours at the same seq.
    if (!this.desync && a.p !== this.mySlot && a.ck != null && a.atSeq != null && this.ck.has(a.atSeq) && this.ck.get(a.atSeq) !== (a.ck >>> 0)) {
      this.desync = { seq: a.seq, atSeq: a.atSeq };
      console.warn('[coop] DESYNC', this.desync, 'ours', this.ck.get(a.atSeq), 'theirs', a.ck);
    }
    let ok = false;
    try {
      if (a.type === 'init' && !this.game) { this.game = makeGame(a); ok = !!this.game; }
      else if (this.game) ok = this.game.apply(a);
    } catch (e) {
      // apply must never throw (contract); if it does, keep going and surface it.
      console.error('[coop] apply threw at #' + a.seq, a, e);
      this.applyErrors++;
      if (!replay) coopToast(`Co-op error at #${a.seq}: ${e.message}`, { bad: true, t: 6 });
    }
    this.lastSeq = a.seq;
    this.log.push(a);
    const g = this.game;
    if (!g) return ok;
    // (test hook, unset in the game: tests/coop4_play.cjs re-applies its setup shortcuts when a reloaded client
    // replays the log, so a REJOIN can be tested after them)
    if (typeof window !== 'undefined' && window.__coopTestHook) { try { window.__coopTestHook(this, a); } catch (e) { console.error('[coop] test hook', e); } }
    // an unverified resume: a partner's checksum that agrees with ours (at or after the resume) clears it for checkpoints
    if (this.cpBlocked && a.p !== this.mySlot && a.ck != null && a.atSeq >= this.resumeSeq && this.ck.get(a.atSeq) === (a.ck >>> 0)) this.cpBlocked = false;
    if (top - a.seq < CK_HISTORY) {
      this.ck.set(a.seq, g.checksum() >>> 0);
      if (this.ck.size > CK_HISTORY) this.ck.delete(this.ck.keys().next().value);
    }
    if (g.phase === 'private' && (!before || before.phase !== 'private' || before.kind !== g.private?.kind || before.node !== g.private?.node)) this.privateSince = a.seq;
    // back on the map (a node done, an act cleared): checkpoint
    if (!replay && this.synced && isSafePoint(g) && (!before || before.phase !== 'map')) this.checkpointNow('auto');
    // my compact privateDone couldn't be rebuilt (on every client alike): send the whole run
    if (!replay && a.type === 'privateDone' && a.p === this.mySlot && a.runD !== undefined && a.run === null && g.phase === 'private' && !g.private?.done?.[this.mySlot]
      && this.privateRun && this.privateRun.id === this.privatePosted && this.privatePosted === this.privateId()) {
      console.warn('[coop] compact privateDone refused at #' + a.seq + ', sending the whole run');
      this.post({ type: 'privateDone', run: this.privateRun.run });
    }
    if (a.type === 'vote' && a.p === this.mySlot && this.pendingVote === a.node) this.pendingVote = null;
    if (g.phase !== 'map') this.pendingVote = null;
    if (!replay && this.synced && before) {
      // a partner on a newer version: this tab is out of date (its replay of their actions may drift)
      if (a.p !== this.mySlot && typeof a.v === 'string' && !this.versionWarned && newerVersion(a.v, VERSION)) {
        this.versionWarned = true;
        coopToast(`${this.nameOf(a.p)} is on ${a.v}: reload the page to update`, { bad: true, t: 8 });
      }
      // The duo battle animates every applied battle action's events (game.lastEvents) in order. They are
      // queued here, not handed to the scene directly: the action that starts a battle (a vote) is applied
      // while the map is still on screen, and a poll can bring several actions before the scene switches.
      const bt = g.battle || before.battle;
      if (g.phase === 'battle' && (before.phase !== 'battle' || before.battle !== g.battle)) this.battleFeed = [];
      if (bt && (g.phase === 'battle' || before.phase === 'battle') && g.lastEvents?.length) this.battleFeed.push({ battle: bt, seq: a.seq, p: a.p, events: g.lastEvents.slice() });
      if (this.battleFeed.length > 400) this.battleFeed.splice(0, this.battleFeed.length - 400);
      this.uiEvents(a, before);
      // Round-2 hook: the scene on screen hears about every live action (e.g. the duo battle animates
      // game.battle.takeEvents() here). Called before route(), so a phase change still reaches it.
      try { Engine.scene?.onCoopAction?.(a, ok, before); } catch (e) { console.error('[coop] onCoopAction', e); }
    }
    return ok;
  }

  uiEvents(a, before) {
    const g = this.game;
    if (g.lastVote && g.lastVote !== before.lastVote) {
      const n = g.world?.map?.nodes?.[g.lastVote.picked];
      const name = n ? (n.type === 'boss' ? 'the BOSS' : NODE_INFO[n.type]?.name || n.type) : 'a node';
      coopToast(g.lastVote.tie ? `Tie! The coin picked ${name}` : `Off to ${name}!`, { good: !g.lastVote.tie });
    }
    if (Array.isArray(g.events)) {
      for (const e of g.events.slice(before.events)) {
        if (e?.t === 'away') coopToast(e.p === this.mySlot ? 'You were sat out (offline).' : `${this.nameOf(e.p)} sits out: carrying on without them`, { t: 4 });
        else if (e?.t === 'back') coopToast(e.p === this.mySlot ? 'You are back in the game!' : `${this.nameOf(e.p)} is back!`, { good: true });
        else if (e?.t === 'revive') coopToast(e.p === this.mySlot ? 'Your team is back on its feet!' : `${this.nameOf(e.p)}'s team is back on its feet!`, { good: true });
        else if (e?.t === 'actClear') {
          // the next act's region and its possible GYM LEADERS (One Spire), so the team can plan for it
          const next = g.world?.acts?.[e.act], gyms = next ? actBosses(next).map(trainerName) : [];
          coopToast(`Act clear!${e.badge ? ' Badge earned!' : ''} On to ${next ? actTitle(g.world, next) : 'the next act'}${gyms.length ? ` (GYM: ${orList(gyms)})` : next?.gauntlet ? ' and the ELITE FOUR' : ''}`, { good: true, t: 6 });
        }
        else if (e?.t !== 'tie' && (e?.text || e?.msg)) coopToast(e.text || e.msg);
      }
    }
    if (a.type === 'privateDone' && a.p !== this.mySlot && g.phase === 'private' && !g.private?.done?.[this.mySlot]) {
      coopToast(this.n > 2 ? `${this.nameOf(a.p)} is done (${g.private.done.filter(Boolean).length}/${this.n} ready)` : `${this.nameOf(a.p)} is done and waiting for you`);
    }
  }

  // 3-4 players: carry on without an offline player (game rule: CoopGame.setAway). They come back with
  // their next action; their own client posts one as soon as it sees it was sat out.
  sitOut(p) { if (this.game && !this.game.away?.[p] && p !== this.mySlot) this.post({ type: 'away', target: p, away: true }); }
  checkAway() {
    const g = this.game;
    if (!g?.away?.[this.mySlot] || !this.synced || this.stopped || this.backPosted === g.seq) return;
    this.backPosted = g.seq;
    this.post({ type: 'away', target: this.mySlot, away: false });
    coopToast('You were sat out while away: you are back in!', { good: true, t: 4 });
  }

  // RESYNC: rebuild the game from the server (latest checkpoint + the log after it) and land on the right scene.
  resync() {
    if (this.resyncing || this.stopped) return;
    this.resyncing = true;
    this.feed?.stop(); this.feed = null;
    this.game = null; this.log = []; this.ck.clear(); this.desync = null; this.lastSeq = 0; this.buffer.clear();
    this.synced = false; this.privatePosted = null; this.pendingVote = null; this.battleFeed = [];
    this.routeKey = 'connect';
    setScene(this.wrap(new CoopWaitScene(this)));
    this.resumeThenFeed().then(() => { this.resyncing = false; coopToast('Resynced from the save', { good: true }); });
  }

  // ---- posting ----------------------------------------------------------------------------------
  // ---- map sketches: a side channel (coopSketches), never part of the game log or its checksum ----
  mySketch(act) { this.sketch = sketchFor(this.sketch, act); return this.sketch; }
  partnerSketches(act) {
    const out = [];
    for (const p of this.others) {
      const sk = sketchFor(this.sketches?.[p], act);
      if (sk.strokes.length) out.push({ strokes: sk.strokes, color: PCOL[p] });
    }
    return out;
  }
  sendSketch() {
    clearTimeout(this.sketchTimer);
    this.sketchTimer = setTimeout(() => {
      this.net.setSketch?.(this.roomId, JSON.stringify(this.sketch)).catch(() => {});
    }, 250);
  }
  eraseSketches(act) {
    clearTimeout(this.sketchTimer);
    this.sketch = { act, strokes: [] };
    this.sketches = {};
    this.net.setSketch?.(this.roomId, JSON.stringify(this.sketch), true).catch(() => {});
  }
  // One coop:sketch subscription per partner (it re-runs only when that partner's sketch changes), and one for my own
  // slot that only says whether a partner's ERASE wiped mine. My own strokes are restored once (a reload / REJOIN).
  syncSketchSubs(members) {
    if (!this.net.watchSketch || this.stopped) return;
    const parse = (s) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };
    for (const m of members) {
      const p = m.slot;
      if (this.sketchSubs[p]) continue;
      if (p === this.mySlot) {
        let was = null;
        this.sketchSubs[p] = this.net.watchSketch(this.roomId, p, (r) => {
          if (was === false && r?.wiped) { this.sketch = undefined; clearTimeout(this.sketchTimer); }
          was = !!r?.wiped;
        }, { wiped: true });
        this.net.getSketch?.(this.roomId, p).then(r => { if (!this.stopped && !this.sketch?.strokes?.length && r?.sketch) this.sketch = parse(r.sketch) || undefined; }).catch(() => {});
      } else {
        this.sketchSubs[p] = this.net.watchSketch(this.roomId, p, (r) => { (this.sketches ||= {})[p] = parse(r?.sketch); });
      }
    }
  }
  post(action) {
    if (!this.game || this.stopped || this.quitting) return;
    // (v0.3.6: every action carries the game version and logic id that played it, see game/coop/engines.js)
    const a = { ...action, ck: this.game.checksum() >>> 0, atSeq: this.game.seq ?? this.lastSeq, v: VERSION, eng: LOGIC_ID, nonce: this.net.randomNonce() };
    this.outbox.push(a);
    this.flush();
  }
  async flush() {
    if (this.flushing) return;
    this.flushing = true;
    try {
      while (this.outbox.length && !this.stopped) {
        const a = this.outbox[0];
        try {
          await this.net.postAction(this.roomId, a);
          this.outbox.shift();
        } catch (e) {
          a.tries = (a.tries || 0) + 1;
          const netErr = this.net.isNetworkError?.(e);
          if (!netErr || a.tries >= 6) { this.outbox.shift(); coopToast(`Couldn't send ${a.type}: ${e.message}`, { bad: true, t: 5 }); if (a.type === 'privateDone') this.privatePosted = null; }
          else { await new Promise(r => setTimeout(r, 1500)); }
        }
      }
    } finally { this.flushing = false; }
  }

  vote(nodeId) {
    if (!this.game || this.game.phase !== 'map' || this.game.votes?.[this.mySlot] === nodeId) return;
    this.pendingVote = nodeId;
    this.post({ type: 'vote', node: nodeId });
  }

  // ---- private phases ---------------------------------------------------------------------------
  privateId() { const pv = this.game?.private; return pv ? `${pv.kind}:${pv.node ?? ''}:${pv.key ?? ''}@${this.privateSince}` : null; }

  // Called by the solo scenes (flow.js goToMap / afterRewards) when the player leaves a private scene.
  privateDone() {
    const g = this.game;
    if (!g || g.phase !== 'private') return;
    const id = this.privateId();
    if (this.privatePosted !== id) {
      this.privatePosted = id;
      const run = g.snapshotRun(G.run);
      this.privateRun = { id, run };
      // only what changed since the phase opened, when every client in the room can rebuild it (game/coop/wire.js)
      const enc = this.compactOK() ? encodePrivateDone(g, this.mySlot, run) : null;
      this.post(enc ? { type: 'privateDone', ...enc } : { type: 'privateDone', run });
    }
    this.routeKey = 'wait';
    setScene(this.wrap(new CoopWaitScene(this)));
  }

  // Every member's client speaks the compact wire format (their heartbeats say so; see convex/coop.ts heartbeat).
  compactOK() {
    if ((this.net.NET_PROTO ?? 0) < NET_PROTO) return false;
    return this.members.length >= this.n && this.members.every(m => (m.net ?? 0) >= NET_PROTO);
  }

  // Co-op events: both players see the same one (the game fixed it when the phase opened), without the ones
  // that start battles (contract §3).
  pickEvent(run, rng) {
    const se = this.game?.sharedEvent;
    const ev = se && se.act === run.actIndex && se.node === run.nodeId && eventById(se.id);
    if (!ev) return Coop.pickCoopEvent(run, rng);
    markSeen(run, ev);
    return ev;
  }

  openPrivate(pv) {
    const g = this.game, p = this.mySlot;
    G.coop = this;
    G.run = g.privateRunClone(p);
    switch (pv.kind) {
      case 'reward': return new RewardScene(rewardView(g.battleSubs?.[p]), g.battleCfg, {});
      case 'center': return new CenterScene();
      case 'mart': return new ShopScene();
      // between ELITE FOUR rooms: the solo break screen (reorder the team, PLATEAU MART, READY)
      case 'plateau': {
        const next = Number.isInteger(pv.next) ? pv.next : g.world?.gauntletIndex ?? 0;
        return new ActClearScene({ gauntletBreak: true, coop: true, noHeal: true, next, martKey: pv.key || 'plateau' + next });
      }
      case 'event': return new EventScene();
      case 'treasure': return new TreasureScene();
    }
    console.warn('[coop] unknown private kind', pv.kind);
    queueMicrotask(() => this.privateDone());
    return new CoopWaitScene(this);
  }

  // ---- routing ----------------------------------------------------------------------------------
  // Switches scene only when the phase (or the private phase) actually changes.
  route(force = false) {
    const g = this.game;
    if (!g || this.stopped) return;
    const p = this.mySlot;
    this.recordDex();
    this.postChamp();
    let key, make;
    switch (g.phase) {
      case 'map': key = 'map'; make = () => { G.run = g.runs[p]; return new CoopMapScene(this); }; break;
      case 'battle': key = 'battle'; make = () => { G.run = g.runs[p]; return new CoopBattleScene(this); }; break;
      case 'private': {
        const pv = g.private;
        if (!pv || pv.done?.[p] || this.privatePosted === this.privateId()) { key = 'wait'; make = () => new CoopWaitScene(this); }
        else { key = 'private:' + this.privateId(); make = () => this.openPrivate(pv); }
        break;
      }
      case 'over': case 'victory': key = 'end:' + g.phase; make = () => { G.run = g.runs[p]; return new CoopEndScene(this); }; break;
      default: return;
    }
    if (key === this.routeKey && !force) return;
    // The duo battle finishes its animation (the last hits, "You won!") before rewards / the end screen.
    if (!force && this.routeKey === 'battle' && key !== 'battle' && Engine.scene?.holdRoute?.()) return;
    this.routeKey = key;
    setScene(this.wrap(make()));
  }

  // v0.3.25: a player who has beaten a CHAMPION in an earlier run tells the room once (CoopGame.setChamp): CERULEAN CAVE's
  // MEWTWO can then show up. Only once in sync on a live room (a replay or a resume must not post).
  postChamp() {
    const g = this.game;
    if (this.champPosted || !this.synced || !g?.world || g.world.flags?.champ || !G.meta?.unlocks?.win || g.phase === 'over' || g.phase === 'victory' || g.phase === 'init') return;
    this.champPosted = true;
    this.post({ type: 'champ' });
  }

  // The local player's Pokédex (meta.dexSeen / dexCaught): what this player has met and caught so far (game/coop/dex.js;
  // local meta only, never part of the game state). Before v0.3.21 co-op never wrote to the Pokédex at all.
  recordDex() {
    try { if (G.meta && Number.isInteger(this.mySlot) && recordCoopDex(G.meta, this.game, this.mySlot)) saveMeta(); }
    catch (e) { console.warn('[coop] dex', e); }
  }

  // Draw the banner + toasts on top of any scene (the solo private scenes don't know about co-op).
  wrap(scene) {
    if (scene.__coopWrapped || scene.drawsCoopOverlay) return scene;
    const draw = scene.draw.bind(scene);
    scene.draw = (ctx) => { draw(ctx); drawCoopOverlay(ctx, this); };
    scene.__coopWrapped = true;
    return scene;
  }
}

function makeGame(init) {
  const C = Coop.CoopGame;
  if (typeof C.fromInit === 'function') return C.fromInit(init);
  const g = new C();
  g.apply(init);
  return g;
}

// The finished SubBattle as RewardScene's "battle": reads fall through to the canonical sub, but
// RewardScene's writes (run.afterBattle sets result.moneyFinal/newMon...) stay off the shared game state.
function rewardView(sub) {
  if (!sub) return { kind: 'wild', result: { outcome: 'win', exp: 0, money: 0, participants: [] }, enemies: [] };
  const v = Object.create(sub);
  v.result = { ...sub.result };
  return v;
}
