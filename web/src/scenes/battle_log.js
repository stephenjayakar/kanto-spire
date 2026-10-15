// Solo battle log (v0.5.23): every action of the battle as a line of text, in the bottom-left corner under the party
// panel when there's room, a one-line strip when there's little, and a full-screen list from the strip, the MENU or
// the L key. Display only: it reads the battle's own event stream (the events BattleScene.runEvents animates, the
// engine's 'msg' lines included) as they play out, and never touches battle state or RNG.
import { Engine, W, H, hover, inRect, pushOverlay } from '../engine/core.js';
import { text, textFit, wrap, measure } from '../engine/font.js';
import { panel, pixBox, rect, closeButton, scrollArea, tip } from '../engine/ui.js';
import { D, speciesName } from '../game/data.js';
import { BADGES } from '../game/items.js';
import { monName } from '../game/pokemon.js';
import { Modal } from './common.js';

const MAX_ENTRIES = 500;
const ROW = 10; // small-font line spacing in the corner panel
// (corner panel sizes: a full panel needs its title plus two lines; a strip needs one line)
export const LOG_PANEL_MIN = 34, LOG_STRIP_MIN = 13;

const nice = (k) => String(k).replace(/_/g, ' ');
// a held item / badge / boss rule key, by name
function srcName(src) {
  if (!src) return '';
  if (D.items[src]?.name) return D.items[src].name;
  if (BADGES[src]) return `${nice(src)} BADGE`;
  return nice(src);
}
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

// The engine's own lines, colored by what they say.
function msgColor(s) {
  if (/fainted|blacked out|out of usable|can't go on/i.test(s)) return 'pink';
  if (/super effective|critical hit/i.test(s)) return 'orange';
  if (/not very effective|doesn't affect|missed|failed|avoided|protected itself|broke free|almost had it|so close|appeared to be caught/i.test(s)) return 'gray';
  if (/gotcha|was caught|got away|defeated/i.test(s)) return 'gold';
  if (/ is (poisoned|badly poisoned|burned|paralyzed|frozen)|fell asleep|confused|in love|seeded/i.test(s)) return 'purple';
  if (/regained health|was revived|was cured/i.test(s)) return 'lime';
  return 'whiteSoft';
}

export class BattleLog {
  // ctx: { b: the Battle, run: the Run } (names of cards and party POKéMON)
  constructor(ctx) { this.ctx = ctx; this.entries = []; this.foe = null; this.scroll = 0; this.follow = true; this.drag = null; }

  // One engine event -> zero or more log lines.
  add(e) {
    const prev = this.entries[this.entries.length - 1];
    // "X regained health!" right after the heal line that already says how much: one line is enough
    if (e.t === 'msg' && /regained health!$/.test(e.text) && prev?.heal) return;
    for (const [s, color, sep] of this.describe(e) || []) if (s) this.entries.push({ text: s, color: color || 'whiteSoft', sep: !!sep, heal: e.t === 'heal' });
    if (this.entries.length > MAX_ENTRIES) this.entries.splice(0, this.entries.length - MAX_ENTRIES);
  }

  describe(e) {
    const { b, run } = this.ctx;
    const mon = (uid) => { const m = run.party.find(p => p.uid === uid); return m ? monName(m) : 'Your POKéMON'; };
    const foe = () => this.foe || 'The foe';
    switch (e.t) {
      case 'msg': return [[e.text, msgColor(e.text)]];
      case 'turn': return [[`TURN ${e.turn}`, 'gray', true]];
      case 'enemyOut': this.foe = speciesName(b.enemies[e.index]?.species || e.species); return null; // ("A wild X appeared!" is a msg)
      case 'bossRule': return [[`${e.name}: ${e.desc}`, 'gold']];
      case 'forme': return [[`${speciesName(e.species)} changed to its ${e.forme} FORME!`, 'gold']];
      case 'foeFirst': return [['The foe moves first!', 'orange']];
      case 'play': {
        const names = e.ids.map(id => { const c = b.findCardAny(id); return c ? b.cardInfo(c).move?.name : null; }).filter(Boolean);
        return names.length ? [[`You played ${names.join(', ')}`, 'white']] : null;
      }
      case 'combo': return e.bonus > 0 ? [[`${e.name}${e.level > 1 ? ` lvl ${e.level}` : ''}: +${Math.round(e.bonus)}% damage`, 'bonus']] : null;
      case 'card': {
        if (e.idle) return null;
        const c = b.findCardAny(e.id), info = c ? b.cardInfo(c) : null;
        const name = info?.move?.name || 'Card', hit = e.hit ? ` (hit ${e.hit + 1})` : '';
        const who = info?.uid && info.uid !== b.leadUid ? `${mon(info.uid)}'s ` : ''; // (a benched POKéMON's card says whose)
        if (e.dmg > 0) {
          // (effectiveness: the engine's "It's super effective!" line follows the hand's damage)
          const tag = e.label === 'CRITICAL' ? ', critical hit!' : e.label && !['SUPER', 'WEAK'].includes(e.label) ? `, ${e.label}` : '';
          return [[`${who}${name}${hit}: ${e.dmg} damage${tag}`, e.label === 'SUPER' || e.label === 'CRITICAL' ? 'orange' : e.label === 'WEAK' ? 'gray' : 'white']];
        }
        if (!e.label) return null;
        if (e.label === name) return [[`${who}${name}`, 'purple']]; // (a status move: its effect follows as engine lines)
        return [[`${who}${name}${hit}: ${e.label}`, ['MISS', 'NO EFFECT', 'FAILED', 'FAINTED', 'PARALYZED', 'SHOCKED', 'SOUNDPROOF'].includes(e.label) ? 'gray' : 'purple']];
      }
      case 'flat': return [[`${srcName(e.src)}: +${e.add} damage`, 'bonus']];
      case 'bonus': return [[`${srcName(e.src)}: +${Math.round(e.add)}% damage`, 'bonus']];
      case 'times': return [[`${srcName(e.src)}: ${e.mul === 0 ? 'no damage' : `x${+(+e.mul).toFixed(2)} damage`}`, e.mul >= 1 ? 'bonus' : 'gray']];
      case 'relic': return e.key ? [[`${srcName(e.key)}: ${e.text}`, 'bonus']] : null;
      case 'total': return e.damage > 0 ? null : [['The hand dealt no damage.', 'gray']]; // (the damage line says how much it did)
      case 'damage': {
        const from = e.src && e.src !== 'hand' ? ` ${srcName(e.src).toLowerCase()}` : '';
        const hp = ` (${Math.max(0, e.hp).toLocaleString()}/${(e.maxHp || 0).toLocaleString()})`;
        if (e.side === 'enemy') return [[`${foe()} -${e.amount.toLocaleString()} HP${from}${hp}`, 'dmg']];
        return [[`${mon(e.uid)} -${e.amount.toLocaleString()} HP${hp}`, 'pink']];
      }
      case 'heal': {
        const who = e.side === 'enemy' ? foe() : e.uid ? mon(e.uid) : 'Your POKéMON';
        const hp = e.hp !== undefined && e.maxHp ? ` (${e.hp.toLocaleString()}/${e.maxHp.toLocaleString()})` : '';
        return [[`${who} +${e.amount} HP${e.src ? ` ${srcName(e.src)}` : ''}${hp}`, 'lime']];
      }
      case 'item': return [[`You used ${D.items[e.key]?.name || nice(e.key)}${e.uid ? ` on ${mon(e.uid)}` : ''}`, 'bonus']];
      case 'discard':
        if (e.stow) return null;
        return [[e.forced ? `${plural(e.ids.length, 'unplayable card')} discarded` : `You discarded ${plural(e.ids.length, 'card')}`, 'gray']];
      case 'end':
        if (e.outcome === 'win') return [[`You won! +${(e.exp || 0).toLocaleString()} EXP · $${(e.money || 0).toLocaleString()}`, 'gold']];
        return null; // (losing, catching and fleeing have their own engine lines)
      // leadOut / faint / status / stage / weather / ball / enemyMove / flinch / nuzlocke: the engine's msg says it
      default: return null;
    }
  }

  // entries -> display lines at this width (wrapped, continuation lines indented), cached per width
  lines(width) {
    if (this._w !== width || this._n !== this.entries.length || this._first !== this.entries[0]) {
      this._w = width; this._n = this.entries.length; this._first = this.entries[0];
      const out = [];
      for (const en of this.entries) {
        if (en.sep) { out.push({ text: en.text, color: en.color, sep: true }); continue; }
        if (!en._lines || en._w !== width) {
          en._w = width;
          const first = wrap(en.text, width, 'small');
          en._lines = first.length > 1 ? [first[0], ...wrap(first.slice(1).join(' '), width - 6, 'small')] : first;
        }
        en._lines.forEach((t, i) => out.push({ text: t, color: en.color, indent: i > 0 }));
      }
      this._lines = out;
    }
    return this._lines;
  }

  open() { pushOverlay(new BattleLogModal({ log: this })); }

  // The bottom-left corner: a panel with the newest lines (wheel / drag scrolls back), a one-line strip when there's
  // little room, nothing when there's none (the MENU's BATTLE LOG and the L key still open the full list).
  draw(ctx, x, y, w, h) {
    if (h >= LOG_PANEL_MIN) return this.drawPanel(ctx, x, y, w, h);
    if (h >= LOG_STRIP_MIN) return this.drawStrip(ctx, x, y, w, Math.min(h, 18));
    this.drag = null;
  }

  drawStrip(ctx, x, y, w, h) {
    const hot = hover(x, y, w, h);
    pixBox(ctx, x, y, w, h, hot ? '#323a50' : '#1b2030', '#0d1018', 3);
    text(ctx, 'LOG', x + 4, y + (h - 12) / 2, { color: 'gold', font: 'small' });
    const last = this.entries[this.entries.length - 1];
    if (last) textFit(ctx, last.text, x + 24, y + (h - 12) / 2, w - 28, { color: last.color, font: 'small' });
    if (hot) tip('BATTLE LOG', 'Everything that happened this battle. Tap to open (or press L).', { width: 160 });
    if (hot && Engine.mouse.clicked) { Engine.mouse.clicked = false; this.open(); }
  }

  drawPanel(ctx, x, y, w, h) {
    panel(ctx, x, y, w, h);
    const hx = x + w - 34, headHot = hover(x, y, w, 13);
    text(ctx, 'BATTLE LOG', x + 6, y + 2, { color: 'gray', font: 'small' });
    text(ctx, 'OPEN', hx + 28, y + 2, { align: 'right', color: headHot ? 'white' : 'gold', font: 'small' });
    let top = y + 13;
    const bottom = y + h - 2, lx = x + 5, lw = w - 13;
    // (whole rows only: the list is a whole number of rows tall, anchored to the bottom, and scrolls in whole rows)
    const viewRows = Math.max(1, Math.floor((bottom - top) / ROW)), viewH = viewRows * ROW;
    top = bottom - viewH;
    const rows = this.lines(lw), contentH = rows.length * ROW, max = Math.max(0, contentH - viewH);
    const m = Engine.mouse, over = inRect(x, y + 13, w, bottom - y - 13);
    // scrolling: the wheel, or a drag (touch); the newest line stays in view until you scroll back
    let sc = this.follow ? max : this.scroll;
    if (over && m.wheelPx) sc += m.wheelPx;
    if (m.justPressed && over) this.drag = { y: m.y, moved: 0 };
    if (this.drag && m.down) { sc -= m.y - this.drag.y; this.drag.moved += Math.abs(m.y - this.drag.y); this.drag.y = m.y; }
    const tapped = (headHot && m.clicked) || (over && m.clicked && this.drag && this.drag.moved < 4);
    if (!m.down) this.drag = null;
    this.scroll = Math.max(0, Math.min(max, sc));
    this.follow = this.scroll >= max - 1;
    ctx.save();
    ctx.beginPath(); ctx.rect(x + 2, top - 1, w - 4, viewH + 2); ctx.clip();
    drawRows(ctx, rows, lx, top - Math.round(this.scroll / ROW) * ROW, lw, ROW, top, bottom);
    ctx.restore();
    if (!rows.length) text(ctx, 'Nothing yet', x + w / 2, top + 2, { align: 'center', color: 'gray', font: 'small' });
    if (max > 0) {
      const barH = Math.max(8, viewH * viewH / contentH), barY = top + (viewH - barH) * (this.scroll / max);
      rect(ctx, x + w - 6, top, 2, viewH, '#ffffff22');
      rect(ctx, x + w - 6, barY, 2, barH, this.follow ? '#a0a0a0' : '#f8d038');
    }
    if (headHot) tip('BATTLE LOG', 'Everything that happened this battle, newest at the bottom. Scroll it with the wheel or a drag; tap OPEN (or press L) for the full list.', { width: 180 });
    if (tapped) { m.clicked = false; this.open(); }
  }
}

function drawRows(ctx, rows, x, y0, w, rowH, top, bottom) {
  rows.forEach((r, i) => {
    const y = y0 + i * rowH;
    if (y < top - rowH / 2 || y > bottom) return;
    if (r.sep) {
      const tw = measure(r.text, 'small');
      rect(ctx, x, y + 5, (w - tw) / 2 - 4, 1, '#ffffff30');
      rect(ctx, x + (w + tw) / 2 + 4, y + 5, (w - tw) / 2 - 4, 1, '#ffffff30');
      text(ctx, r.text, x + w / 2, y - 1, { align: 'center', color: r.color, font: 'small' });
    } else text(ctx, r.text, x + (r.indent ? 6 : 0), y - 1, { color: r.color, font: 'small' });
  });
}

// The whole log, big: opened from the corner panel / strip, the battle MENU, or the L key.
export class BattleLogModal extends Modal {
  enter() { this.m = { scroll: 1e9, contentH: 1e9 }; }
  draw(ctx) {
    this.dim(ctx);
    const w = 380, h = 300, x = (W - w) / 2, y = (H - h) / 2;
    panel(ctx, x, y, w, h);
    text(ctx, 'BATTLE LOG', W / 2, y + 8, { align: 'center', color: 'white' });
    if (closeButton(ctx, x + w, y)) { this.close(null); return; }
    const rows = this.log.lines(w - 34), lh = 12;
    if (this.m.contentH === 1e9) this.m.contentH = rows.length * lh; // (opens at the newest line)
    scrollArea(ctx, this.m, x + 12, y + 30, w - 20, y + h - 12, (top) => { drawRows(ctx, rows, x + 14, top, w - 34, lh, y + 30, y + h - 12); return top + rows.length * lh; }, { hint: false });
    if (!rows.length) text(ctx, 'Nothing has happened yet.', W / 2, y + 40, { align: 'center', color: 'gray', font: 'small' });
    this.closeOnTapOutside(x, y, w, h);
  }
}
