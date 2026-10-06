// Cloud records: global leaderboards, the player's own runs, and the trainer-name prompt.
import { regionByLetter } from '../game/regions.js';
import { Engine, W, H, setScene, pushOverlay, hover } from '../engine/core.js';
import { text } from '../engine/font.js';
import { swirlBackground, button, panel, pixBox, drawTips, tip, THEME, scrollArea } from '../engine/ui.js';
import { Cloud, rename, signOut, createInviteLink, leaderboard, topTrainers, myRuns, pendingRuns, flushQueue } from '../net/cloud.js';
import { drawIcon, Modal, ChoiceModal } from './common.js';
import { TitleScene } from './title.js';
import { VERSION, PATCH_NOTES } from '../game/version.js';
import { D } from '../game/data.js';

// v0.1.0: runs are world 'spire' (one climb, a region per act). No per-world boards: ALL RUNS has every run (old
// KANTO / HOENN runs keep their world label, spire runs show their route), MY RUNS has yours.
const TABS = [
  { key: 'all', label: 'ALL RUNS' },
  { key: 'mine', label: 'MY RUNS' },
  { key: 'trainers', label: 'TRAINERS' },
];

// Version filter: ALL first (the default), then every version with patch notes, newest first.
const VERSIONS = [...new Set([VERSION, ...PATCH_NOTES.map(p => p.v)])];
const VERSION_FILTERS = ['all', ...VERSIONS];

// A run's world in the lists: the spire route ("K-H-H-K"), SPIRE, or the old KANTO / HOENN world.
export const worldLabel = (r) => (r.world === 'spire' ? r.regions || 'SPIRE' : String(r.world || 'kanto').toUpperCase());

const RESULT = { win: ['WON', 'green'], postgame: ['LEGEND', 'gold'], lose: ['LOST', 'red'] };

function ago(ms) {
  const m = Math.max(0, Math.round((Date.now() - ms) / 60000));
  if (m < 60) return `${m}m ago`;
  if (m < 60 * 24) return `${Math.round(m / 60)}h ago`;
  return `${Math.round(m / 1440)}d ago`;
}

export class RecordsScene {
  enter() { this.t = 0; this.tab = 'all'; this.version = 'all'; this.sort = 'recent'; this.load(); }
  async load() {
    const tab = this.tab, version = this.version === 'all' ? null : this.version;
    const token = this.loadToken = (this.loadToken || 0) + 1; // a newer load (tab or version change) wins
    this.rows = null; this.error = null; this.scroll = 0; this.contentH = 0;
    if (!Cloud.url) { this.error = 'Cloud records are off: this build has no cloud.json.'; return; }
    try {
      await flushQueue();
      let rows;
      if (tab === 'trainers') rows = await topTrainers(version);
      else if (tab === 'mine') { const r = await myRuns(version); if (this.loadToken === token) this.mine = r; rows = r ? r.recent : []; }
      else rows = await leaderboard(tab === 'all' ? null : tab, version, this.sort);
      if (this.loadToken === token) this.rows = rows;
    } catch (e) { if (this.loadToken === token) this.error = e.message; }
  }
  update(dt) { this.t += dt; }
  // A one-time invite link, copied to the clipboard.
  async makeInvite() {
    if (this.inviting) return;
    this.inviting = true;
    try {
      const link = await createInviteLink();
      let copied = false;
      try { await navigator.clipboard.writeText(link); copied = true; } catch {}
      pushOverlay(new ChoiceModal({ title: 'ONE-TIME INVITE LINK', w: 420,
        body: `${link}\n\n${copied ? 'Copied to your clipboard. ' : ''}The first Google account that signs in with it can play. It expires in 14 days.`,
        options: [{ label: 'OK', value: 0 }] }));
    } catch (e) {
      pushOverlay(new ChoiceModal({ title: 'Could not make a link', body: e.message, options: [{ label: 'OK', value: 0 }] }));
    }
    this.inviting = false;
  }

  draw(ctx) {
    swirlBackground(ctx, ['#102040', '#204080', '#183060'], 0.3);
    text(ctx, 'RECORDS', 12, 6, { color: 'white', scale: 2 });
    const p = Cloud.me;
    text(ctx, p ? `TRAINER ${p.name}` : 'Not signed in', 150, 8, { color: p ? 'gold' : 'gray' });
    const pend = pendingRuns();
    text(ctx, pend ? `${pend} run${pend > 1 ? 's' : ''} waiting to upload` : p ? `${p.email.replace('@', ' at ')} · ${Cloud.online ? 'synced' : 'offline'}` : 'Offline', 150, 22, { color: pend ? 'orange' : 'gray', font: 'small' });
    if (p && button(ctx, 'SIGN OUT', W - 162, 6, 76, 22, { color: '#605070', font: 'small' })) signOut();
    if (p && Cloud.me?.admin && button(ctx, 'INVITE', W - 240, 6, 72, 22, { color: '#3a9a58', font: 'small' })) this.makeInvite();
    if (button(ctx, 'BACK', W - 80, 6, 70, 22, { color: '#806060' })) setScene(new TitleScene());

    TABS.forEach((t, i) => {
      if (button(ctx, t.label, 12 + i * 76, 36, 72, 20, { color: this.tab === t.key ? THEME.play : '#404860', font: 'small' }) && this.tab !== t.key) { this.tab = t.key; this.load(); }
    });
    // Sort (run lists): newest first by default, or by score.
    if (this.tab !== 'trainers' && this.tab !== 'mine') {
      const sx = 394;
      if (button(ctx, this.sort === 'recent' ? 'NEWEST' : 'TOP SCORE', sx, 36, 80, 20, { color: '#404860', font: 'small' })) { this.sort = this.sort === 'recent' ? 'score' : 'recent'; this.load(); }
      if (hover(sx, 36, 80, 20)) tip('SORT', 'NEWEST: most recent runs first (by WHEN). TOP SCORE: highest scores first. Click to switch.', { width: 200 });
    }
    // Version filter: click to cycle through ALL and each version.
    const vx = 480, vw = 148;
    if (button(ctx, this.version === 'all' ? 'ALL VERSIONS' : `VERSION ${this.version}`, vx, 36, vw, 20, { color: this.version === 'all' ? '#404860' : '#5a4a8a', font: 'small' })) {
      this.version = VERSION_FILTERS[(VERSION_FILTERS.indexOf(this.version) + 1) % VERSION_FILTERS.length];
      this.load();
    }
    if (hover(vx, 36, vw, 20)) tip('GAME VERSION', `Show records from one version of the game, or all of them. Click to switch (${VERSION_FILTERS.map(v => v === 'all' ? 'ALL' : v).join(' / ')}).`, { width: 200 });

    panel(ctx, 8, 62, W - 16, H - 70);
    this.drawList(ctx, p);
    drawTips(ctx);
  }
  drawList(ctx, p) {
    if (this.error) { text(ctx, this.error, W / 2, 180, { align: 'center', color: 'red', font: 'small' }); return; }
    if (!this.rows) { text(ctx, 'Loading...', W / 2, 180, { align: 'center', color: 'gray' }); return; }
    if (this.tab === 'mine' && !p) { text(ctx, 'Sign in to save your runs online.', W / 2, 180, { align: 'center', color: 'whiteSoft' }); return; }
    if (!this.rows.length) {
      text(ctx, this.version === 'all' ? 'No runs recorded yet. Go climb the spire!' : `No runs recorded on ${this.version} yet. Go climb the spire!`, W / 2, 180, { align: 'center', color: 'whiteSoft' });
      return;
    }
    if (this.tab === 'trainers') this.drawTrainers(ctx); else this.drawRuns(ctx);
  }
  drawRuns(ctx) {
    const y0 = 70;
    const cols = [['NO.', 18], ['TRAINER / STARTER', 44], ['SCORE', 140], ['RESULT', 200], ['ASC', 252], ['TEAM', 284], ['REACHED', 470], ['WHEN', 572]];
    for (const [h, x] of cols) text(ctx, h, x, y0, { color: 'gray', font: 'small' });
    if (this.tab === 'mine' && this.mine) {
      const m = this.mine.player;
      text(ctx, `${m.runs} runs · ${m.wins} wins · best ${m.bestScore.toLocaleString()}`, 464, y0, { align: 'right', color: 'gold', font: 'small' }); // in the gap after TEAM
    }
    scrollArea(ctx, this, 12, y0 + 14, W - 24, H - 26, (top) => this.rows.reduce((_, r, i) => {
      const y = top + 2 + i * 27;
      const me = Cloud.me && r.playerName === Cloud.me.name;
      pixBox(ctx, 14, y - 2, W - 28, 25, me ? '#34406a' : i % 2 ? '#262c3c' : '#2e3548', null, 2);
      const [label, color] = RESULT[r.result] || RESULT.lose;
      text(ctx, String(i + 1), 20, y + 6, { color: i < 3 ? 'gold' : 'white', font: 'small' });
      // the trainer, and under it the starter they climbed with
      text(ctx, r.playerName, 44, y, { color: me ? 'gold' : 'white', font: 'small' });
      if (r.starter) text(ctx, D.species[r.starter]?.name || r.starter, 44, y + 11, { color: 'whiteSoft', font: 'small' });
      text(ctx, r.score.toLocaleString(), 140, y + 6, { color: 'white', font: 'small' });
      text(ctx, label, 200, y + 6, { color, font: 'small' });
      text(ctx, 'A' + r.ascension, 252, y + 6, { color: 'whiteSoft', font: 'small' });
      r.party.slice(0, 6).forEach((m, j) => drawIcon(ctx, m.species, 280 + j * 30, y - 6, { still: true }));
      // where it ended: the run's region route ("K-H-H-K") for a spire run, or its old world
      text(ctx, worldLabel(r), 470, y, { color: r.world === 'spire' ? 'gold' : 'purple', font: 'small' });
      text(ctx, `ACT ${r.act} · F${r.floor}`, 470, y + 11, { color: 'whiteSoft', font: 'small' });
      if (r.world === 'spire' && r.regions && hover(466, y - 2, 100, 25)) tip('REGIONS', `${r.regions.split('-').map((l, k) => `ACT ${k + 1}: ${regionByLetter(l)?.name || l}`).join('\n')}`);
      if (r.version) {
        text(ctx, ago(r.finishedAt), 572, y, { color: 'gray', font: 'small' });
        text(ctx, r.version, 572, y + 11, { color: r.version === VERSION ? 'dmg' : 'purple', font: 'small' });
      } else text(ctx, ago(r.finishedAt), 572, y + 6, { color: 'gray', font: 'small' });
      return y + 25;
    }, top));
  }
  drawTrainers(ctx) {
    const y0 = 70;
    for (const [h, x] of [['NO.', 18], ['TRAINER', 44], ['BEST SCORE', 200], ['RUNS', 330], ['WINS', 400], ['WIN RATE', 470]]) text(ctx, h, x, y0, { color: 'gray', font: 'small' });
    if (this.version !== 'all') text(ctx, `on ${this.version}`, W - 20, y0, { align: 'right', color: 'gold', font: 'small' });
    scrollArea(ctx, this, 12, y0 + 14, W - 24, H - 26, (top) => this.rows.reduce((_, p, i) => {
      const y = top + 2 + i * 27;
      const me = Cloud.me && p.name === Cloud.me.name;
      pixBox(ctx, 14, y - 2, W - 28, 25, me ? '#34406a' : i % 2 ? '#262c3c' : '#2e3548', null, 2);
      text(ctx, String(i + 1), 20, y + 6, { color: i < 3 ? 'gold' : 'white', font: 'small' });
      text(ctx, p.name, 44, y + 6, { color: me ? 'gold' : 'white' });
      text(ctx, p.bestScore.toLocaleString(), 200, y + 6, { color: 'white', font: 'small' });
      text(ctx, String(p.runs), 330, y + 6, { color: 'whiteSoft', font: 'small' });
      text(ctx, String(p.wins), 400, y + 6, { color: 'whiteSoft', font: 'small' });
      text(ctx, p.runs ? Math.round((100 * p.wins) / p.runs) + '%' : '-', 470, y + 6, { color: 'whiteSoft', font: 'small' });
      return y + 25;
    }, top));
  }
}

// Trainer name prompt: a canvas panel with a real <input> laid over it, so typing works everywhere.
export class NameModal extends Modal {
  enter() {
    const canvas = Engine.canvas || document.getElementById('game');
    const r = canvas.getBoundingClientRect(), s = r.width / W;
    const el = this.input = document.createElement('input');
    el.maxLength = 12;
    el.value = Cloud.me?.name || '';
    el.placeholder = 'RED';
    Object.assign(el.style, {
      position: 'fixed', left: `${r.left + (W / 2 - 90) * s}px`, top: `${r.top + (H / 2 - 14) * s}px`,
      width: `${180 * s}px`, height: `${22 * s}px`, font: `${12 * s}px monospace`, textAlign: 'center',
      background: '#f8f8f8', color: '#202020', border: `${2 * s}px solid #0d1018`, borderRadius: `${3 * s}px`, outline: 'none', textTransform: 'uppercase',
    });
    el.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Enter') this.submit();
      if (e.key === 'Escape') this.close(null);
    });
    document.body.appendChild(el);
    setTimeout(() => el.focus(), 0);
  }
  async submit() {
    if (this.busy) return;
    this.busy = true; this.error = null;
    try { await rename(this.input.value.toUpperCase()); this.close(true); }
    catch (e) { this.error = e.message; this.busy = false; }
  }
  close(v) { this.input?.remove(); Engine.canvas?.focus?.(); super.close(v); }
  draw(ctx) {
    this.dim(ctx);
    const w = 300, h = 130, x = (W - w) / 2, y = (H - h) / 2 - 10;
    panel(ctx, x, y, w, h);
    text(ctx, 'CHANGE TRAINER NAME', W / 2, y + 8, { align: 'center', color: 'white' });
    text(ctx, 'Your runs are saved online under this name.', W / 2, y + 26, { align: 'center', color: 'whiteSoft', font: 'small' });
    if (this.error) text(ctx, this.error, W / 2, y + 72, { align: 'center', color: 'red', font: 'small' });
    if (button(ctx, this.busy ? 'SAVING...' : 'OK', W / 2 - 104, y + h - 32, 100, 24, { color: THEME.green, disabled: this.busy })) this.submit();
    if (button(ctx, 'CANCEL', W / 2 + 4, y + h - 32, 100, 24, { color: '#506080' })) this.close(null);
  }
}

// One line under the game-over stats: the run's online score, or why it isn't saved yet.
export function cloudStatusLine() {
  const r = Cloud.lastResult;
  if (!Cloud.url || !r) return null;
  if (r.status === 'saved') return [`Saved online · score ${r.score.toLocaleString()}`, 'gold'];
  if (!Cloud.me) return ['Sign in to upload this run.', 'orange'];
  if (r.status === 'error') return [`Not uploaded yet (${r.message}) · will retry`, 'orange'];
  return ['Uploading run...', 'gray'];
}
