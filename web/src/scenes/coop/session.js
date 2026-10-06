// CoopSession: the controller for one online co-op game (a singleton while in co-op: G.coop, window.__coop).
// Lockstep: every client applies the room's action log (seq 1, 2, 3...) to its own CoopGame and routes
// scenes by game.phase. Nothing is applied optimistically; our own actions come back through the log.
import { Engine, setScene } from '../../engine/core.js';
import { G } from '../../game/state.js';
import * as Coop from '../../game/coop/coop.js';
import { NODE_INFO } from '../../game/map.js';
import { actTitle, actBosses, trainerName, orList } from '../../game/regions.js';
import { RewardScene } from '../reward.js';
import { ShopScene } from '../shop.js';
import { CenterScene } from '../center.js';
import { EventScene } from '../event.js';
import { TreasureScene } from '../treasure.js';
import { coopToast, drawCoopOverlay, OFFLINE_MS, PCOL } from './ui.js';
import { sketchFor } from '../sketch.js';
import { eventById, markSeen } from '../../game/events.js';
import { CoopMapScene } from './map.js';
import { CoopBattleScene } from './battle.js';
import { CoopWaitScene } from './wait.js';
import { CoopEndScene } from './end.js';

const POLL_MS = 700, HEARTBEAT_MS = 5000, CK_HISTORY = 300;

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
    this.log = [];                 // every applied action (for RESYNC)
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
    return now - (m.lastSeen || 0) < OFFLINE_MS;
  }

  // ---- lifecycle --------------------------------------------------------------------------------
  start() {
    CoopSession.current?.stop();
    CoopSession.current = this;
    G.coop = this;
    if (typeof window !== 'undefined') window.__coop = this;
    this.routeKey = 'connect';
    setScene(new CoopWaitScene(this));
    this.poller = new this.net.CoopPoller(this.roomId, {
      intervalMs: POLL_MS, after: 0,
      onActions: (acts) => this.receive(acts),
      onRoom: (room, members, info) => this.onRoom(room, members, info),
      onError: (e) => { this.netError ||= { since: Date.now(), msg: e?.message }; },
    }).start();
    this.beat();
    this.hbTimer = setInterval(() => this.beat(), HEARTBEAT_MS);
    return this;
  }
  stop({ toTitle = false } = {}) {
    if (this.stopped) return;
    this.stopped = true;
    this.poller?.stop();
    clearInterval(this.hbTimer);
    if (CoopSession.current === this) CoopSession.current = null;
    if (G.coop === this) { G.coop = null; G.run = null; }
    if (typeof window !== 'undefined' && window.__coop === this) window.__coop = null;
    if (toTitle) import('../title.js').then(m => setScene(new m.TitleScene()));
  }
  beat() { if (!this.stopped) this.net.heartbeat(this.roomId, this.lastSeq).catch(() => {}); }

  onRoom(room, members, info) {
    this.netError = null;
    if (members) { this.members = members; this.syncSketches(members); }
    if (info?.now) { this.serverNow = info.now; this.serverNowAt = Date.now(); }
    if (room?.status) this.status = room.status;
    // The poller got a full page and found nothing missing: we're caught up with the log.
    if (!this.synced && this.game && !this.buffer.size && room && this.lastSeq >= room.nextSeq - 1) { this.synced = true; this.route(); }
    if (this.synced) this.checkAway(); // (a player sat out while away is back in as soon as they're caught up)
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
    if (applied && this.synced) this.route();
    if (applied) this.checkAway();
  }

  applyOne(a, top = a.seq, replay = false) {
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
    if (top - a.seq < CK_HISTORY) {
      this.ck.set(a.seq, g.checksum() >>> 0);
      if (this.ck.size > CK_HISTORY) this.ck.delete(this.ck.keys().next().value);
    }
    if (g.phase === 'private' && (!before || before.phase !== 'private' || before.kind !== g.private?.kind || before.node !== g.private?.node)) this.privateSince = a.seq;
    if (a.type === 'vote' && a.p === this.mySlot && this.pendingVote === a.node) this.pendingVote = null;
    if (g.phase !== 'map') this.pendingVote = null;
    if (!replay && this.synced && before) {
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

  // RESYNC: rebuild the game from the whole log (seq 1..lastSeq) and land on the right scene.
  resync() {
    const log = this.log.slice();
    this.game = null; this.log = []; this.ck.clear(); this.desync = null; this.lastSeq = 0;
    this.privatePosted = null; this.pendingVote = null;
    const top = log.length ? log[log.length - 1].seq : 0;
    for (const a of log) this.applyOne(a, top, true);
    coopToast(`Resynced from the log (${log.length} actions)`, { good: true });
    this.route(true);
  }

  // ---- posting ----------------------------------------------------------------------------------
  // ---- map sketches: a side channel on each member's row (never part of the game log or its checksum) ----
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
      this.net.setSketch?.(this.roomId, JSON.stringify(this.sketch)).then(r => { if (r) this.sketchMineV = r.v; }).catch(() => {});
    }, 250);
  }
  eraseSketches(act) {
    clearTimeout(this.sketchTimer);
    this.sketch = { act, strokes: [] };
    this.sketches = {};
    this.net.setSketch?.(this.roomId, JSON.stringify(this.sketch), true).then(r => { if (r) this.sketchMineV = r.v; }).catch(() => {});
  }
  // The poll carries each member's sketchV: fetch the sketches when one changed. My own copy is only taken from
  // the server on the first sync (a reload / REJOIN) or when the partner erased everything.
  syncSketches(members) {
    if (!this.net.getSketches || this.sketchFetching) return;
    this.sketchV ||= {};
    if (!members.some(m => (m.sketchV ?? 0) !== (this.sketchV[m.slot] ?? -1))) return;
    this.sketchFetching = true;
    this.net.getSketches(this.roomId).then(list => {
      this.sketches ||= {};
      for (const m of list) {
        const parsed = (() => { try { return m.sketch ? JSON.parse(m.sketch) : null; } catch { return null; } })();
        if (m.slot === this.mySlot) {
          // (a newer version of mine that isn't empty is just my own send coming back: keep the local copy,
          // which may already have more strokes)
          const first = this.sketchV[m.slot] === undefined;
          const wiped = !first && m.sketchV > (this.sketchMineV ?? 0) && !parsed?.strokes?.length;
          if ((first && !this.sketch?.strokes?.length) || wiped) this.sketch = parsed || undefined;
          this.sketchMineV = Math.max(this.sketchMineV ?? 0, m.sketchV);
        } else this.sketches[m.slot] = parsed;
        this.sketchV[m.slot] = m.sketchV;
      }
    }).catch(() => {}).finally(() => { this.sketchFetching = false; });
  }
  post(action) {
    if (!this.game || this.stopped) return;
    const a = { ...action, ck: this.game.checksum() >>> 0, atSeq: this.game.seq ?? this.lastSeq, nonce: this.net.randomNonce() };
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
          this.poller?.kick();
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
      this.post({ type: 'privateDone', run: g.snapshotRun(G.run) });
    }
    this.routeKey = 'wait';
    setScene(this.wrap(new CoopWaitScene(this)));
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
      case 'plateau': return new ShopScene({ key: pv.key || 'plateau' + (g.world?.gauntletIndex ?? ''), onLeave: () => this.privateDone() });
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
