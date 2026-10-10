// When the cloud save is pushed (v0.3.21). The game saves to localStorage all the time (every pick, purchase and
// party swap); pushing each of those, 1.5 s later, cost a few uploads per map node, each of the whole save. Now:
// - only the parts (meta / run) that differ from what the server last confirmed are sent, and nothing at all
//   when neither does;
// - a checkpoint (back on the map after a node, a run's end, quitting to the title) pushes right away;
// - other saves push at most once per SYNC_DELAY; 'defer' saves (entering a node) wait for the next push;
// - hiding or closing the tab pushes whatever is left (keepalive, see cloud.js).
// No DOM or network here (cloud.js wires it up), so tests/savesync.test.mjs can drive it.
export const SYNC_DELAY = 30_000;
export const KEEPALIVE_MAX = 60_000; // fetch keepalive bodies are capped at 64 KB

export class SaveSync {
  // read(): { meta: string, run: string | null } the local save now
  // send(parts, { keepalive }): pushes { meta?, run? } (run null = no run in progress); resolves to the server's
  //   reply ({ missing: true } = it has nothing to merge a partial push into)
  constructor({ read, send, delay = SYNC_DELAY, setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (id) => clearTimeout(id), onError = () => {} }) {
    Object.assign(this, { read, send, delay, setTimer, clearTimer, onError });
    this.synced = { meta: undefined, run: undefined }; // what the server has (undefined = unknown: send it)
    this.timer = null;
    this.chain = Promise.resolve();
    this.pushes = 0; // requests sent (tests and the debug console read it)
  }

  // After a pull: the server holds exactly this.
  base(meta, run) { this.synced = { meta, run: run ?? null }; }
  // The server's copy is unknown: the next push sends the whole save.
  reset() { this.synced = { meta: undefined, run: undefined }; }

  // The parts that differ from the server's copy, or null.
  diff() {
    const { meta, run } = this.read();
    const parts = {};
    if (meta !== this.synced.meta) parts.meta = meta;
    if ((run ?? null) !== this.synced.run) parts.run = run ?? null;
    return Object.keys(parts).length ? parts : null;
  }
  dirty() { return !!this.diff(); }

  // After a local save. mode: 'checkpoint' (push now) | 'defer' (with the next push) | undefined (within delay)
  queue(mode) {
    if (mode === 'defer') return;
    if (mode === 'checkpoint') { this.flush(); return; }
    if (!this.timer) this.timer = this.setTimer(() => { this.timer = null; this.flush(); }, this.delay);
  }

  // Pushes what changed (one push at a time; a push queued behind another sends what is new by then).
  flush() {
    this.cancelTimer();
    this.chain = this.chain.then(() => this.push()).catch(e => {
      this.onError(e);
      if (!this.timer) this.timer = this.setTimer(() => { this.timer = null; this.flush(); }, this.delay); // retry later
    });
    return this.chain;
  }

  // The tab is going away: send now, outside the queue (nothing after this handler is sure to run).
  flushNow() {
    this.cancelTimer();
    const parts = this.diff();
    if (!parts) return Promise.resolve(false);
    const size = (parts.meta?.length ?? 0) + (parts.run?.length ?? 0);
    return this.sendParts(parts, size < KEEPALIVE_MAX).catch(e => { this.onError(e); return false; });
  }

  cancelTimer() { if (this.timer) { this.clearTimer(this.timer); this.timer = null; } }

  async push() {
    const parts = this.diff();
    if (!parts) return false;
    return this.sendParts(parts, false);
  }

  async sendParts(parts, keepalive) {
    this.pushes++;
    let r = await this.send(parts, { keepalive });
    if (r && r.missing) {
      // the server had nothing to merge a partial push into: send the whole save
      const full = this.read();
      parts = { meta: full.meta, run: full.run ?? null };
      this.pushes++;
      r = await this.send(parts, { keepalive });
    }
    if ('meta' in parts) this.synced.meta = parts.meta;
    if ('run' in parts) this.synced.run = parts.run;
    return true;
  }
}
