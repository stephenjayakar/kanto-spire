// Persistent Pokédex across runs + run history. Click a seen POKéMON for its entry page (DexEntry).
import { Engine, W, H, hover, clicked, keyPressed, pushOverlay, setScene } from '../engine/core.js';
import { text, textFit, textBlock, measure } from '../engine/font.js';
import { swirlBackground, button, closeButton, pixBox, rect, drawTips, tip, THEME } from '../engine/ui.js';
import { draw, tinted } from '../engine/assets.js';
import { D, byDex, TYPE_COLORS, DEX_MAX, moveName } from '../game/data.js';
import { G, shinyUnlocked } from '../game/state.js';
import { familyOf } from '../game/run.js';
import { NO_PLAYER_MOVES } from '../game/pokemon.js';
import { KNOWS_MOVE_LEVEL } from '../game/gen4.js';
import { Sound } from '../audio/sound.js';
import { drawIcon, drawMon, drawTypeTags, monDir, Modal } from './common.js';
import { TitleScene } from './title.js';

const PER_PAGE = 120, COLS = 15; // (DEX_MAX: 493 since v0.4.0, 5 pages)

export class DexScene {
  enter() { this.page = 0; this.t = 0; }
  update(dt) { this.t += dt; if (Engine.mouse.wheel) this.page = Math.max(0, Math.min(Math.floor((DEX_MAX - 1) / PER_PAGE), this.page + Engine.mouse.wheel)); }
  draw(ctx) {
    swirlBackground(ctx, ['#401010', '#802020', '#501818'], 0.3);
    const m = G.meta;
    text(ctx, 'POKéDEX', 12, 6, { color: 'white', scale: 2 });
    text(ctx, `SEEN ${m.dexSeen.length}  ·  CAUGHT ${m.dexCaught.length} / ${DEX_MAX}`, 160, 14, { color: 'gold' });
    const start = this.page * PER_PAGE;
    let open = null;
    for (let i = 0; i < PER_PAGE; i++) {
      const n = start + i + 1;
      if (n > DEX_MAX) break;
      const s = byDex[n];
      if (!s) continue;
      const x = 10 + (i % COLS) * 41, y = 40 + Math.floor(i / COLS) * 36;
      const caught = m.dexCaught.includes(s.key), seen = caught || m.dexSeen.includes(s.key);
      const hot = hover(x, y, 38, 34) && seen;
      pixBox(ctx, x, y, 38, 34, caught ? (hot ? '#fffaf0' : '#f8f0d8') : seen ? (hot ? '#ddd6c8' : '#c8c0b0') : '#504848', hot ? '#f8d038' : '#201818', 3);
      if (seen) drawIcon(ctx, s.key, x + 3, y - 2, { still: !caught && !hot, gray: !caught });
      text(ctx, String(n).padStart(3, '0'), x + 19, y + 23, { align: 'center', color: 'dark', font: 'small' });
      if (hover(x, y, 38, 34)) tip(seen ? s.name : '??????????', seen ? `${s.types.join('/')}${caught ? ` · ${s.category} POKéMON` : ''}\nClick for its POKéDEX entry.` : 'Not yet seen.', { width: 200 });
      if (seen && clicked(x, y, 38, 34)) open = n;
    }
    text(ctx, 'Click a POKéMON for its entry', W - 90, 14, { align: 'right', color: 'whiteSoft', font: 'small' });
    text(ctx, `Page ${this.page + 1}/${Math.ceil(DEX_MAX / PER_PAGE)} · No.${String(start + 1).padStart(3, '0')}-${String(Math.min(DEX_MAX, start + PER_PAGE)).padStart(3, '0')} (scroll)`, W / 2, 28, { align: 'center', color: 'gray', font: 'small' }); // (between the header and the grid: a full page's 8th row reaches y 326)
    if (button(ctx, '<', 10, H - 30, 30, 22, { color: '#806060', disabled: this.page === 0 })) this.page--;
    if (button(ctx, '>', 44, H - 30, 30, 22, { color: '#806060', disabled: (this.page + 1) * PER_PAGE >= DEX_MAX })) this.page++;
    // recent runs
    const runs = m.runs.slice(0, 3);
    runs.forEach((r, i) => {
      const x = 90 + i * 180;
      pixBox(ctx, x, H - 34, 174, 30, r.result === 'lose' ? '#402020' : '#204020', '#101010', 3);
      text(ctx, `${r.result === 'lose' ? 'LOST' : 'WON'} A${r.ascension} · ACT ${r.act}`, x + 6, H - 32, { color: 'white', font: 'small' });
      r.party.slice(0, 6).forEach((sp, j) => drawIcon(ctx, sp, x + 70 + j * 17, H - 27, { still: true, scale: 0.5 })); // a clean 1/2
    });
    if (button(ctx, 'BACK', W - 80, 6, 70, 22, { color: '#806060' })) setScene(new TitleScene());
    drawTips(ctx);
    if (open) this.openEntry(open);
  }
  openEntry(n) {
    Sound.playSE('se_select');
    pushOverlay(new DexEntry({ dex: n, onClose: () => { this.page = Math.floor((this.entryDex - 1) / PER_PAGE); }, scene: this }));
  }
}

// Not part of a run: NOW PLAYING (net/presence.js) does not list you here.
DexScene.prototype.idle = true;

// ---- entry page --------------------------------------------------------------------------------
// FireRed's rule: a seen-only POKéMON shows its picture, name and types; its category, size and dex text stay
// "?????" until it's caught. Caught entries add base stats, abilities, the evolution line (with this game's
// evolution levels, pokemon.js levelEvolution) and the moves it learns by level. Display only.

// FRLG's US units (pokedex_screen.c): decimetres -> feet/inches, hectograms -> pounds, both rounded like the game.
export function dexHeight(dm) {
  let inches = Math.floor(10000 * dm / 254);
  if (inches % 10 >= 5) inches += 10;
  const feet = Math.floor(inches / 120);
  return `${feet}’${String(Math.floor((inches - feet * 120) / 10)).padStart(2, '0')}”`;
}
export function dexWeight(hg) {
  let lbs = Math.floor(hg * 100000 / 4536);
  if (lbs % 10 >= 5) lbs += 10;
  return `${Math.floor(lbs / 100)}.${Math.floor((lbs % 100) / 10)} lbs.`;
}

// How a species evolves in this game (pokemon.js levelEvolution / itemEvolution / run.js for SHEDINJA).
export function evoLabel(e) {
  const p = e.param;
  switch (e.method) {
    case 'LEVEL': return `Lv${Math.min(p, 48)}`;
    case 'FRIENDSHIP': return 'Lv22';
    case 'LEVEL_ATK_GT_DEF': return `Lv${p} ATK>DEF`;
    case 'LEVEL_ATK_LT_DEF': return `Lv${p} ATK<DEF`;
    case 'LEVEL_ATK_EQ_DEF': return `Lv${p} ATK=DEF`;
    case 'LEVEL_SILCOON': case 'LEVEL_CASCOON': return `Lv${p} (50%)`;
    case 'LEVEL_NINJASK': return `Lv${p}`;
    case 'LEVEL_SHEDINJA': return `Lv${p}, spare slot`;
    case 'BEAUTY': return 'Lv30';
    case 'TRADE': return 'Lv37';
    case 'TRADE_ITEM': return 'Lv40';
    case 'ITEM': return D.items[p]?.name || String(p);
    case 'FRIENDSHIP_DAY': return D.items.SUN_STONE?.name || 'SUN STONE';
    case 'FRIENDSHIP_NIGHT': return D.items.MOON_STONE?.name || 'MOON STONE';
    case 'LEVEL_FEMALE': case 'LEVEL_MALE': return `Lv${p} (50%)`;
    case 'KNOWS_MOVE': return moveName(p);
    default: return '?';
  }
}
const EVO_HELP = {
  LEVEL: 'Evolves by level.', FRIENDSHIP: 'A friendship evolution in FireRed: here it evolves at Lv22.',
  LEVEL_ATK_GT_DEF: 'Evolves at this level when its ATTACK is higher than its DEFENSE.',
  LEVEL_ATK_LT_DEF: 'Evolves at this level when its DEFENSE is higher than its ATTACK.',
  LEVEL_ATK_EQ_DEF: 'Evolves at this level when its ATTACK and DEFENSE are equal.',
  LEVEL_SILCOON: 'Evolves at this level into SILCOON or CASCOON (an even chance).', LEVEL_CASCOON: 'Evolves at this level into SILCOON or CASCOON (an even chance).',
  LEVEL_NINJASK: 'Evolves by level.', LEVEL_SHEDINJA: 'Left behind when NINCADA evolves, if the party has a free slot.',
  BEAUTY: 'A beauty evolution in Hoenn: here it evolves at Lv30.', TRADE: 'A trade evolution: here it evolves at Lv37.',
  TRADE_ITEM: 'A trade evolution with a held item: here it evolves at Lv40.', ITEM: 'Use this evolution stone on it.',
  FRIENDSHIP_DAY: 'A daytime friendship evolution: here it uses a SUN STONE.', FRIENDSHIP_NIGHT: 'A night-time friendship evolution: here it uses a MOON STONE.',
  LEVEL_FEMALE: 'Evolves at this level into WORMADAM or MOTHIM (an even chance).', LEVEL_MALE: 'Evolves at this level into WORMADAM or MOTHIM (an even chance).',
};
// What a Gen 4 evolution was in HGSS (gen4.js gameEvolution keeps it as gen4Method / gen4Param), said after the rule here.
const GEN4_EVO_HELP = {
  MAGNETIC_FIELD: 'In Gen 4 it evolved in a magnetic field.', MOSS_ROCK: 'In Gen 4 it evolved near a MOSS ROCK.',
  ICE_ROCK: 'In Gen 4 it evolved near an ICE ROCK.', HOLD_ITEM_NIGHT: (p) => `In Gen 4 it evolved holding a ${itemLabel(p)} at night.`,
  HOLD_ITEM_DAY: (p) => `In Gen 4 it evolved holding an ${itemLabel(p)} by day.`, ITEM_MALE: 'In Gen 4 only males evolved this way.',
  ITEM_FEMALE: 'In Gen 4 only females evolved this way.', LEVEL_FEMALE: 'In Gen 4 only females evolved.',
  FRIENDSHIP_DAY: 'In Gen 4 it evolved by friendship, by day.', FRIENDSHIP_NIGHT: 'In Gen 4 it evolved by friendship, at night.',
  PARTY_SPECIES: (p) => `In Gen 4 it evolved with a ${D.species[p]?.name || p} in the party.`,
};
const itemLabel = (k) => D.items[k]?.name || String(k).replace(/_/g, ' ');
export function evoHelp(e) {
  let h = EVO_HELP[e.method] || '';
  if (e.method === 'KNOWS_MOVE') {
    const lv = (D.species[familyParentOf(e.into)]?.learnset || []).find(([, m]) => m === e.param)?.[0];
    h = `Evolves on a level-up while it knows ${moveName(e.param)}${lv ? ` (it learns it at Lv${lv})` : ''}, or at Lv${KNOWS_MOVE_LEVEL} anyway.`;
  }
  const g = e.gen4Method && GEN4_EVO_HELP[e.gen4Method];
  return g ? `${h} ${typeof g === 'function' ? g(e.gen4Param) : g}` : h;
}
// The species that evolves into `into` (the first one found).
function familyParentOf(into) { return Object.keys(D.species).find(k => (D.species[k].evolutions || []).some(e => e.into === into)) || null; }

// The whole family as stages: [[{ key }], [{ key, e }, ...], ...]; each stage keeps its parents' order.
export function evoStages(key) {
  const stages = [[{ key: familyOf(key) }]];
  for (let i = 0; i < 4; i++) {
    const next = [];
    for (const p of stages[i]) for (const e of D.species[p.key]?.evolutions || []) if (D.species[e.into] && !next.some(x => x.key === e.into)) next.push({ key: e.into, e });
    if (!next.length) break;
    stages.push(next);
  }
  return stages;
}

// [level, move] the player's copy can learn (NO_PLAYER_MOVES never are).
export function levelMoves(key) {
  return (D.species[key]?.learnset || []).filter(([, m]) => D.moves[m] && !NO_PLAYER_MOVES.has(m));
}

const STAT_ROWS = [['hp', 'HP'], ['atk', 'ATK'], ['def', 'DEF'], ['spa', 'SPA'], ['spd', 'SPD'], ['spe', 'SPE']];
const statColor = v => (v < 50 ? '#f07040' : v < 80 ? '#f8c030' : v < 100 ? '#a8d040' : v < 120 ? '#40c060' : '#30b8d8');
const CREAM = '#f8f8f0', TAN = '#e8dcb8', INK_EDGE = '#a08850', RED = '#c83028';

export class DexEntry extends Modal {
  enter() { this.go(this.dex, 0); }
  // The dex numbers that can be opened (seen or caught), in order.
  openable() {
    const m = G.meta, out = [];
    for (let n = 1; n <= DEX_MAX; n++) { const s = byDex[n]; if (s && (m.dexSeen.includes(s.key) || m.dexCaught.includes(s.key))) out.push(n); }
    return out;
  }
  go(n, step = 0) {
    const list = this.openable();
    if (!list.length) return;
    let i = list.indexOf(n);
    if (i < 0) i = Math.max(0, list.findIndex(x => x > n));
    i = (i + step + list.length) % list.length;
    this.dex = list[i];
    if (this.scene) this.scene.entryDex = this.dex;
    this.shinyView = undefined; this.navT = 0;
    const s = byDex[this.dex];
    Promise.resolve(Sound.playCry?.(s.key)).catch(() => {});
  }
  update(dt) {
    super.update(dt);
    this.navT = (this.navT || 0) + dt;
    if (keyPressed('ArrowLeft') || keyPressed('a') || keyPressed('A')) this.go(this.dex, -1);
    if (keyPressed('ArrowRight') || keyPressed('d') || keyPressed('D')) this.go(this.dex, 1);
    if ((keyPressed('s') || keyPressed('S')) && this.hasShiny()) this.shinyView = !this.isShiny();
  }
  species() { return byDex[this.dex]; }
  caught() { return G.meta.dexCaught.includes(this.species().key); }
  hasShiny() { return shinyUnlocked(this.species().key); }
  isShiny() { return this.hasShiny() && this.shinyView !== false; }

  draw(ctx) {
    this.dim(ctx);
    const s = this.species(), caught = this.caught();
    const x0 = 8, y0 = 4, w = W - 16, h = H - 8;
    pixBox(ctx, x0, y0, w, h, '#5a5a62', '#202028', 4);
    // header: number, name, caught ball
    pixBox(ctx, x0 + 2, y0 + 2, w - 4, 30, RED, null, 3);
    rect(ctx, x0 + 4, y0 + 29, w - 8, 2, '#80201c');
    text(ctx, `No.${String(s.dex).padStart(3, '0')}`, x0 + 10, y0 + 9, { color: 'white' });
    text(ctx, s.name, x0 + 62, y0 + 3, { color: 'white', scale: 2 });
    if (caught) draw(ctx, 'gfx/ui/pokedex/caught_marker.png', x0 + 66 + measure(s.name, 'normal', 2), y0 + 12);
    const list = this.openable(), pos = list.indexOf(this.dex) + 1;
    text(ctx, `${pos} / ${list.length}`, x0 + w - 150, y0 + 10, { align: 'center', color: 'white', font: 'small' });
    if (button(ctx, '<', x0 + w - 116, y0 + 6, 26, 22, { color: '#806060' })) this.go(this.dex, -1);
    if (button(ctx, '>', x0 + w - 86, y0 + 6, 26, 22, { color: '#806060' })) this.go(this.dex, 1);
    if (closeButton(ctx, x0 + w - 2, y0 + 3)) { this.close(null); return; }

    this.drawProfile(ctx, s, caught, 16, 38, 296);
    this.drawEvolutions(ctx, s, caught, 16, 252, 296, 78);
    this.drawStats(ctx, s, caught, 318, 38, 306, 112);
    this.drawAbilities(ctx, s, caught, 318, 154, 306, 66);
    this.drawMoves(ctx, s, caught, 318, 224, 306, 106);

    // footer
    text(ctx, '←/→ browse · ESC / right-click close' + (this.hasShiny() ? ' · S shiny' : ''), 16, H - 22, { font: 'small', color: 'whiteSoft' });
    if (button(ctx, 'CLOSE', W - 92, H - 25, 76, 19, { color: '#806060', font: 'small' })) { this.close(null); return; }
    drawTips(ctx);
  }

  drawProfile(ctx, s, caught, x, y, w) {
    // upper card: the picture and the vital statistics
    pixBox(ctx, x, y, w, 146, CREAM, INK_EDGE, 3);
    pixBox(ctx, x + 5, y + 5, 136, 136, '#efe6cc', '#c8b888', 3);
    const shiny = this.isShiny();
    const bob = this.navT < 0.35 ? Math.round(Math.sin(this.navT * 18) * 2) : 0;
    drawMon(ctx, s.key, x + 9, y + 9 + bob, { scale: 2, shiny });
    if (this.hasShiny() && hover(x + 5, y + 5, 136, 136)) {
      tip(shiny ? 'SHINY' : 'NORMAL', `You own ${s.name}'s shiny form. Click (or press S) to show the ${shiny ? 'normal' : 'shiny'} colors.`, { width: 180 });
      if (Engine.mouse.clicked) this.shinyView = !shiny;
    }
    if (shiny) {
      const sx = x + 132, sy = y + 14, k = Math.sin(Engine.time * 5) > 0 ? 1 : 0;
      rect(ctx, sx - 1, sy - 3 - k, 2, 6 + 2 * k, '#f8c020'); rect(ctx, sx - 3 - k, sy - 1, 6 + 2 * k, 2, '#f8c020');
    }
    const tx = x + 150, tw = w - 156;
    textFit(ctx, `${caught ? s.category : '?????'} POKéMON`, tx, y + 8, tw, { color: 'dark' });
    drawTypeTags(ctx, s.types, tx, y + 28);
    text(ctx, 'HT', tx, y + 50, { color: 'dark' });
    text(ctx, caught ? dexHeight(s.height) : '??’??”', tx + 28, y + 50, { color: 'dark' });
    text(ctx, 'WT', tx, y + 68, { color: 'dark' });
    text(ctx, caught ? dexWeight(s.weight) : '????.? lbs.', tx + 28, y + 68, { color: 'dark' });
    rect(ctx, tx, y + 88, tw - 4, 1, '#d8ccb0');
    text(ctx, caught ? 'CAUGHT' : 'SEEN', tx, y + 94, { color: caught ? 'green' : 'dark' });
    if (this.hasShiny()) {
      if (shiny) draw(ctx, 'gfx/ui/summary/shiny_star.png', tx, y + 115);
      text(ctx, shiny ? 'SHINY' : 'NORMAL COLORS', tx + (shiny ? 11 : 0), y + 112, { color: shiny ? 'orange' : 'dark', font: 'small' });
    }
    // lower card: the dex text (FireRed's, pokedex_text_fr.h via tools/extract_data.js)
    pixBox(ctx, x, y + 150, w, 60, TAN, INK_EDGE, 3);
    if (caught) textBlock(ctx, s.dexText || '', x + 8, y + 155, w - 16, { color: 'dark' });
    else text(ctx, '?????', x + w / 2, y + 172, { align: 'center', color: 'dark' });
  }

  drawStats(ctx, s, caught, x, y, w, h) {
    pixBox(ctx, x, y, w, h, CREAM, INK_EDGE, 3);
    text(ctx, 'BASE STATS', x + 6, y + 2, { font: 'small', color: 'dark' });
    const bx = x + 64, bw = w - 72;
    let total = 0;
    STAT_ROWS.forEach(([k, label], i) => {
      const v = s.stats[k], ry = y + 15 + i * 13;
      total += v;
      text(ctx, label, x + 8, ry, { font: 'small', color: 'dark' });
      text(ctx, caught ? String(v) : '??', x + 56, ry, { font: 'small', color: 'black', align: 'right' });
      rect(ctx, bx - 1, ry + 2, bw + 2, 8, '#c8bca0');
      rect(ctx, bx, ry + 3, bw, 6, '#f0e8d8');
      if (!caught) return;
      const fw = Math.max(1, Math.round(bw * Math.min(1, v / 255)));
      rect(ctx, bx, ry + 3, fw, 6, statColor(v));
      rect(ctx, bx, ry + 3, fw, 2, '#ffffff55');
    });
    const ty = y + 15 + 6 * 13 + 2;
    rect(ctx, x + 6, ty - 1, w - 12, 1, '#d8ccb0');
    text(ctx, 'TOTAL', x + 8, ty + 1, { font: 'small', color: 'dark' });
    text(ctx, caught ? String(total) : '???', x + 56, ty + 1, { font: 'small', color: 'black', align: 'right' });
  }

  drawAbilities(ctx, s, caught, x, y, w, h) {
    pixBox(ctx, x, y, w, h, CREAM, INK_EDGE, 3);
    if (!caught) { text(ctx, 'ABILITY', x + 6, y + 2, { font: 'small', color: 'dark' }); text(ctx, '?????', x + w / 2, y + 26, { align: 'center', color: 'dark' }); return; }
    text(ctx, s.abilities.length > 1 ? 'ABILITIES (one of)' : 'ABILITY', x + 6, y + 2, { font: 'small', color: 'dark' });
    let cy = y + 14;
    for (const a of s.abilities) {
      const ab = D.abilities[a];
      const str = `${ab?.name || a}: ${ab?.desc || ''}`;
      cy += textBlock(ctx, str, x + 8, cy, w - 16, { font: 'small', color: 'black', lineHeight: 11 });
      if (cy > y + h - 8) break;
    }
  }

  drawMoves(ctx, s, caught, x, y, w, h) {
    pixBox(ctx, x, y, w, h, CREAM, INK_EDGE, 3);
    text(ctx, 'MOVES BY LEVEL', x + 6, y + 2, { font: 'small', color: 'dark' });
    if (!caught) {
      textBlock(ctx, `Only seen so far. Catch ${s.name} to fill in its entry: dex text, size, base stats, abilities, evolutions and moves.`, x + 14, y + 28, w - 28, { color: 'dark' });
      return;
    }
    const moves = levelMoves(s.key);
    const cols = 3, rows = Math.max(1, Math.ceil(moves.length / cols)), colW = Math.floor((w - 12) / cols);
    const pitch = Math.min(12, Math.floor((h - 18) / rows));
    moves.forEach(([lvl, mk], i) => {
      const mv = D.moves[mk], cx = x + 6 + Math.floor(i / rows) * colW, cy = y + 15 + (i % rows) * pitch;
      const hot = hover(cx, cy, colW - 2, pitch);
      if (hot) rect(ctx, cx - 1, cy, colW, pitch, '#e8dcb8');
      text(ctx, `Lv${lvl}`, cx + 20, cy, { font: 'small', color: 'dark', align: 'right' });
      rect(ctx, cx + 23, cy + 3, 3, 6, TYPE_COLORS[mv.type] || '#888');
      textFit(ctx, mv.name, cx + 28, cy, colW - 30, { font: 'small', color: 'black' });
      if (hot) {
        const pow = mv.power > 1 ? `POW ${mv.power}` : mv.power === 1 ? 'POW varies' : 'status';
        tip(mv.name, `${D.types.names?.[mv.type] || mv.type} · ${pow} · ACC ${mv.accuracy || '-'} · PP ${mv.pp}\n${mv.desc || ''}`, { width: 210, accent: TYPE_COLORS[mv.type] });
      }
    });
    if (!moves.length) text(ctx, '(none)', x + w / 2, y + 40, { align: 'center', font: 'small', color: 'dark' });
  }

  drawEvolutions(ctx, s, caught, x, y, w, h) {
    pixBox(ctx, x, y, w, h, TAN, INK_EDGE, 3);
    text(ctx, 'EVOLUTION', x + 6, y + 2, { font: 'small', color: 'dark' });
    if (!caught) { text(ctx, '?????', x + w / 2, y + 32, { align: 'center', color: 'dark' }); return; }
    const stages = evoStages(s.key), m = G.meta;
    if (stages.length === 1) { text(ctx, 'It does not evolve.', x + w / 2, y + 32, { align: 'center', color: 'dark' }); return; }
    const top = y + 13, avail = h - 15;
    // Each stage is a column of "Lv16 → [icon]" entries; a stage with more than 3 (EEVEE) splits into sub-columns of 3.
    // When that is too wide for the box (EEVEE's 7 since v0.4.0), the stones lose their " STONE" (the tip says it all).
    const layout = (label) => stages.map((st, si) => {
      const rows = Math.min(3, st.length), sub = Math.ceil(st.length / rows);
      const labelW = si === 0 ? 0 : Math.max(...st.map(n => measure(label(n.e), 'small')));
      const ew = si === 0 ? 28 : labelW + 42;
      return { st, rows, sub, labelW, ew, width: sub * ew + (sub - 1) * 6, label };
    });
    const widthOf = (cs) => cs.reduce((a, c) => a + c.width, 0) + 4 * (cs.length - 1);
    let cols = layout(evoLabel);
    if (widthOf(cols) > w - 12) cols = layout(e => evoLabel(e).replace(/ ?STONE$/, ''));
    const gap = 4, totalW = widthOf(cols);
    let cx = x + Math.max(6, Math.round((w - totalW) / 2));
    cols.forEach((c) => {
      const pitch = c.rows <= 2 ? 30 : Math.floor(avail / c.rows);
      const colH = (c.rows - 1) * pitch + 28, cy0 = top + Math.round((avail - colH) / 2) - 2;
      c.st.forEach((n, i) => {
        const ex = cx + Math.floor(i / c.rows) * (c.ew + 6), ey = cy0 + (i % c.rows) * pitch;
        const ix = ex + (n.e ? c.labelW + 14 : 0);
        const seen = m.dexSeen.includes(n.key) || m.dexCaught.includes(n.key), cur = n.key === s.key;
        if (n.e) {
          text(ctx, c.label(n.e), ex + c.labelW, ey + 10, { font: 'small', color: 'black', align: 'right' });
          text(ctx, '→', ex + c.labelW + 3, ey + 8, { color: 'dark' });
        }
        if (cur) pixBox(ctx, ix - 1, ey + 2, 30, 28, '#f8f0d0', '#d0a030', 2);
        if (seen) drawIcon(ctx, n.key, ix - 2, ey - 2, { still: !cur });
        else {
          const sil = tinted(`${monDir(n.key)}/icon.png`, '#3a3428', 1); // (not seen yet: a silhouette)
          if (sil) ctx.drawImage(sil, 0, 0, 32, 32, Math.round(ix - 2), Math.round(ey - 2), 32, 32);
        }
        if (hover(ex, ey + 2, c.ew, Math.min(26, pitch))) {
          const nm = seen ? D.species[n.key].name : '?????';
          tip(nm, (n.e ? `${evoLabel(n.e)}: ${evoHelp(n.e)}` : 'The first stage.') + (seen && !cur ? '\nClick to open its entry.' : ''), { width: 200 });
          if (seen && !cur && Engine.mouse.clicked) this.go(D.species[n.key].dex, 0);
        }
      });
      cx += c.width + gap;
    });
  }
}
