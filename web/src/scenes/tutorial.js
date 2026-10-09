// HOW TO PLAY: an illustrated, skippable picture book (your turn, types, scoring, switching, catching). Opened from
// the title, once on a brand-new player's first NEW RUN, and from a run (map MENU, co-op MENU, battle "?"). Display
// only: nothing here reads or changes run or battle state (the pictures use made-up POKéMON and fixed numbers), so
// saves and co-op replays can't notice it. Its only flag is G.meta.basicsSeen.
import { Engine, W, H, keyPressed, pushOverlay } from '../engine/core.js';
import { draw, preload } from '../engine/assets.js';
import { text, measure, textBlock } from '../engine/font.js';
import { panel, pixBox, rect, button, hpBar, THEME, shade, windowFrame, drawTips } from '../engine/ui.js';
import { D, TYPE_COLORS, typeEffect } from '../game/data.js';
import { COMBOS, COMBO_ORDER, comboBonus } from '../game/hands.js';
import { DECK_RULES, randomIVs, maxHp } from '../game/pokemon.js';
import { G, saveMeta } from '../game/state.js';
import { Modal, drawCard, drawMon, drawIcon, drawTypeTags, typeTagsWidth, drawPartyPanel, drawMonCentered, fakeInfo, drawTypeGrid, effFill, CARD_W, CARD_H } from './common.js';

// ---- small drawing helpers ------------------------------------------------------------------
// Text with |highlighted| words, wrapped to maxW. Returns the height drawn (ctx null: only measures).
export function richBlock(ctx, str, x, y, maxW, { color = 'dark', hi = 'red', lineHeight = 15, font = 'normal' } = {}) {
  const space = measure(' ', font);
  let cx = x, cy = y, on = false;
  for (const word of str.split(' ')) {
    const w = measure(word.replace(/\|/g, ''), font);
    if (cx > x && cx + w > x + maxW) { cx = x; cy += lineHeight; }
    word.split('|').forEach((part, i) => {
      if (i) on = !on;
      if (part) cx += ctx ? text(ctx, part, cx, cy, { color: on ? hi : color, font }) : measure(part, font);
    });
    cx += space;
  }
  return cy + lineHeight - y;
}

// A picture of a button (same look as ui.button, no input).
function fauxButton(ctx, label, x, y, w, h, color, font) {
  pixBox(ctx, x, y + 3, w, h - 3, shade(color, -0.45), null, 3);
  pixBox(ctx, x, y, w, h - 3, color, null, 3);
  font ||= measure(label) > w - 8 ? 'small' : 'normal';
  text(ctx, label, x + w / 2, y + (h - 3) / 2 - (font === 'small' ? 6 : 7), { align: 'center', color: 'white', font });
}
const arrow = (ctx, dir, x, y, scale = 1) => draw(ctx, `gfx/ui/cursors/scroll_${dir}.png`, x, y, { scale });
const bob = (amt = 2) => Math.round(Math.sin(Engine.time * 6) * amt);
const label = (ctx, str, x, y, color = 'gray', align = 'left') => text(ctx, str, x, y, { font: 'small', color, align });

// A made-up team member (fixed IVs, no uid from the run's counter) and its card with fixed numbers.
const fakeMon = (species, level, hpFrac = 1) => { const m = { uid: 'tut:' + species, species, level, ivs: randomIVs(null), moves: [], status: null }; m.hp = Math.max(1, Math.round(maxHp(m) * hpFrac)); return m; };
const fakeCard = (species, move, dmg, eff = 1) => ({ ...fakeInfo(fakeMon(species, 6), move), dmgPreview: dmg, eff });

// The battle's GBA scene at 1x (240x100 of the terrain), with the foe and our lead where the battle puts them.
function miniScene(ctx, x, y, { foe, lead, terrain = 'grass' }) {
  pixBox(ctx, x - 2, y - 2, 244, 104, '#000', null, 3);
  ctx.save(); ctx.beginPath(); ctx.rect(x, y, 240, 100); ctx.clip();
  draw(ctx, `gfx/terrain/${terrain}.png`, x, y - 12, { sx: 0, sy: 0, sw: 240, sh: 112 });
  if (foe) drawMon(ctx, foe, x + 148, y + 1);
  if (lead) drawMon(ctx, lead, x + 28, y + 36, { back: true });
  ctx.restore();
}
// The foe's healthbox, shrunk for the 1x scene.
function miniHealthbox(ctx, x, y, species, level, frac) {
  pixBox(ctx, x, y, 100, 28, '#f8f8d8', '#405050', 3);
  text(ctx, D.species[species]?.name || species, x + 5, y + 1, { font: 'small', color: 'dark' });
  text(ctx, 'Lv' + level, x + 95, y + 1, { font: 'small', color: 'dark', align: 'right' });
  text(ctx, 'HP', x + 5, y + 13, { font: 'small', color: 'orange' });
  hpBar(ctx, x + 20, y + 17, 74, frac, 3);
}
// The battle's INTENT box.
function intentBox(ctx, x, y, move, dmgText) {
  const mv = D.moves[move];
  pixBox(ctx, x - 4, y - 2, 172, 30, '#101018d0', '#ff6060', 3);
  text(ctx, 'INTENT', x + 2, y - 1, { color: 'gray', font: 'small' });
  text(ctx, mv.name, x + 2, y + 10, { color: 'white', font: 'small' });
  rect(ctx, x + 94, y + 13, 6, 6, TYPE_COLORS[mv.type] || '#888');
  text(ctx, dmgText, x + 158, y + 6, { align: 'right', color: 'red' });
}
// The battle's damage box (left panel), filled in.
function scoreBox(ctx, x, y, { name, bonus, base, dmg }) {
  const w = 152;
  panel(ctx, x, y, w, 96);
  text(ctx, name, x + w / 2, y + 4, { align: 'center', color: 'white' });
  text(ctx, bonus ? `+${bonus}% damage` : 'no bonus', x + w / 2, y + 16, { align: 'center', color: bonus ? 'bonus' : 'gray', font: 'small' });
  pixBox(ctx, x + 10, y + 29, w - 20, 30, THEME.dmg, shade(THEME.dmg, -0.45), 3);
  text(ctx, 'DMG', x + 16, y + 31, { color: 'white', font: 'small' });
  text(ctx, String(dmg), x + w / 2 + 8, y + 35, { align: 'center', color: 'white' });
  text(ctx, `${base} from cards${bonus ? ` +${bonus}%` : ''}`, x + w / 2, y + 63, { align: 'center', color: 'whiteSoft', font: 'small' });
  text(ctx, 'before crits & misses', x + w / 2, y + 79, { align: 'center', color: 'gray', font: 'small' });
}
// Dark veil + caption over a card that won't score (as in the battle).
function wontScore(ctx, x, y) {
  ctx.save(); ctx.globalAlpha = 0.45; rect(ctx, x, y, CARD_W, CARD_H, '#000'); ctx.restore();
  text(ctx, "won't score", x + CARD_W / 2, y + 40, { align: 'center', color: 'white', font: 'small' });
}
function stepBadge(ctx, n, x, y, title) {
  pixBox(ctx, x, y, 16, 16, '#f8d038', '#7a5a10', 3);
  text(ctx, String(n), x + 8, y + 1, { align: 'center', color: 'black' });
  text(ctx, title, x + 22, y + 1, { color: 'white' });
}

// ---- the pages ------------------------------------------------------------------------------
// Each page: a tab name, the text for the FireRed window (|word| = highlighted) and a picture in the box
// x 24..616, y 34..254.
const PAGES = [
  {
    tab: 'YOUR TURN',
    body: () => `Each turn you hold ${DECK_RULES.hand} cards: your lead POKéMON's moves. Click up to ${DECK_RULES.play} and press |ATTACK|. Then the foe strikes back: its |INTENT| shows the move and damage coming. Bad hand? |DISCARD| up to ${DECK_RULES.freeDiscard} cards free, once per turn.`,
    draw(ctx) {
      miniScene(ctx, 34, 44, { foe: 'PIDGEY', lead: 'CHARMANDER' });
      miniHealthbox(ctx, 40, 50, 'PIDGEY', 4, 1);
      intentBox(ctx, 40, 158, 'TACKLE', '4-5');
      arrow(ctx, 'up', 106, 194 + bob(), 1);
      label(ctx, "the foe's next move and its damage", 124, 196, 'gold');
      text(ctx, 'YOUR HAND', 300, 42, { color: 'white' });
      label(ctx, "5 cards from your lead's deck", 300, 56);
      fauxButton(ctx, 'ATTACK', 432, 70, 72, 26, THEME.play);
      fauxButton(ctx, 'FREE DISCARD', 508, 70, 100, 26, THEME.discard, 'small');
      const hand = [['EMBER', 11, true], ['METAL_CLAW', 8], ['EMBER', 11, true], ['GROWL', 0], ['SMOKESCREEN', 0]];
      hand.forEach(([mv, dmg, sel], i) => drawCard(ctx, fakeCard('CHARMANDER', mv, dmg), 300 + i * 62, sel ? 110 : 126, { selected: sel }));
      label(ctx, 'click cards to pick them (gold), then ATTACK', 455, 220, 'gold', 'center');
    },
  },
  {
    tab: 'TYPES',
    body: () => 'Every move has a TYPE. A foe weak to it takes |x2| (|x4| if both its types are weak), one that resists it |x0.5|, and some take nothing (|x0|). Cards show the matchup against the foe in front of you. Full chart: |INFO| button > |TYPE CHART|.',
    draw(ctx) {
      const cols = [['ELECTRIC', 'THUNDER_SHOCK', 'GYARADOS'], ['WATER', 'WATER_GUN', 'CHARMANDER'], ['FIRE', 'EMBER', 'SQUIRTLE'], ['NORMAL', 'TACKLE', 'GASTLY']];
      cols.forEach(([type, move, foe], i) => {
        const cx = 30 + i * 148, types = D.species[foe].types, m = typeEffect(type, types);
        draw(ctx, `gfx/ui/types/${type}.png`, cx, 62, { scale: 2 });
        label(ctx, D.moves[move].name, cx + 32, 90, 'whiteSoft', 'center');
        arrow(ctx, 'right', cx + 68 + Math.max(0, bob(1)), 66);
        drawMonCentered(ctx, foe, cx + 116, 76);
        drawTypeTags(ctx, types, cx + 116 - Math.round(typeTagsWidth(types) / 2), 110);
        pixBox(ctx, cx, 128, 144, 20, effFill(m), shade(effFill(m), -0.5), 3);
        text(ctx, m === 0 ? 'x0  NO EFFECT' : m > 1 ? `x${m}  SUPER EFFECTIVE` : `x${m}  NOT VERY EFFECTIVE`, cx + 72, 131, { align: 'center', color: m === 0 ? 'gray' : 'white', font: 'small' });
      });
      label(ctx, 'two types multiply: WATER/FLYING is weak to ELECTRIC twice over', 320, 152, 'gray', 'center');
      // a corner of the TYPE CHART, in its own art
      drawTypeGrid(ctx, ['FIRE', 'WATER', 'GRASS'], 72, 190);
      label(ctx, 'ATK rows', 136, 194, 'gray');
      label(ctx, 'vs DEF columns', 136, 206, 'gray');
      label(ctx, '(a corner of the', 136, 220, 'gray');
      label(ctx, 'TYPE CHART)', 136, 230, 'gray');
      drawCard(ctx, fakeCard('CHARMANDER', 'METAL_CLAW', 16, 2), 300, 168, { highlight: true });
      arrow(ctx, 'left', 364 + Math.min(0, bob(1)), 228);
      textBlock(ctx, 'In battle every card shows its matchup with the current foe: SUPER, WEAK or NO EFFECT, times STAB (see SCORING).', 384, 174, 228, { font: 'small', color: 'whiteSoft', lineHeight: 11 });
      textBlock(ctx, 'Hover the foe to see what it is WEAK TO and RESISTS.', 384, 222, 228, { font: 'small', color: 'gold', lineHeight: 11 });
    },
  },
  {
    tab: 'SCORING',
    body: () => "Same-TYPE attack cards form a combo. Only the combo's cards score, and the combo adds its bonus. No combo? Just your strongest card hits. Purple status cards never score but always take effect. The box left of the battle previews the total.",
    draw(ctx) {
      const played = [['EMBER', 11], ['EMBER', 11], ['METAL_CLAW', 8], ['GROWL', 0]];
      played.forEach(([mv, dmg], i) => {
        const x = 32 + i * 66;
        drawCard(ctx, fakeCard('CHARMANDER', mv, dmg), x, 44, { highlight: i < 2 });
        if (i === 2) wontScore(ctx, x, 44);
      });
      rect(ctx, 34, 132, 128, 2, '#a8ff60');
      label(ctx, 'PAIR: both score', 98, 136, 'lime', 'center');
      label(ctx, 'no match', 194, 136, 'gray', 'center');
      label(ctx, 'still works', 260, 136, 'purple', 'center');
      arrow(ctx, 'right', 292 + Math.max(0, bob(1)), 78);
      scoreBox(ctx, 312, 40, { name: COMBOS.PAIR.name, bonus: comboBonus('PAIR'), base: 22, dmg: Math.floor(22 * (1 + comboBonus('PAIR') / 100)) });
      text(ctx, `(11 + 11) x ${(1 + comboBonus('PAIR') / 100).toFixed(2)} = ${Math.floor(22 * (1 + comboBonus('PAIR') / 100))}`, 388, 140, { align: 'center', color: 'gold' });
      // the combo ladder (level 1 bonuses)
      pixBox(ctx, 474, 40, 138, 116, THEME.panelDark, THEME.border, 3);
      label(ctx, 'COMBOS', 543, 42, 'gold', 'center');
      ['SINGLE', ...COMBO_ORDER.filter(k => k !== 'SINGLE')].forEach((k, i) => {
        const ry = 55 + i * 12, b = comboBonus(k);
        label(ctx, COMBOS[k].name, 480, ry, 'white');
        label(ctx, b ? `+${b}%` : 'best card', 606, ry, b ? 'bonus' : 'gray', 'right');
      });
      label(ctx, 'COVERAGE = 4 different types', 543, 160, 'gray', 'center');
      // what a card's DMG is made of
      text(ctx, "A CARD'S DMG IS REAL POKéMON DAMAGE", 320, 186, { align: 'center', color: 'white' });
      const chips = [['LEVEL', '#506080'], ['MOVE POWER', '#506080'], ['ATK vs DEF', '#506080'], ['x1.5 STAB', '#a04c00'], ['x TYPE', '#3c8a3c'], ['= 11 DMG', THEME.dmg]];
      let cx = 320 - (chips.reduce((a, [s]) => a + measure(s, 'small') + 16, 0) + (chips.length - 1) * 6) / 2;
      for (const [s, col] of chips) { const w = measure(s, 'small') + 16; pixBox(ctx, cx, 204, w, 16, col, shade(col, -0.5), 3); label(ctx, s, cx + w / 2, 205, 'white', 'center'); cx += w + 6; }
      label(ctx, "STAB: the move's type is its POKéMON's type. Held items and badges add more on top.", 320, 230, 'gray', 'center');
    },
  },
  {
    tab: 'SWITCHING',
    body: () => `Every POKéMON has its own deck. Click a team member in the party list to send it out: your hand becomes its moves, and it takes the foe's hits. A switch costs 1 |DISCARD| (you get ${DECK_RULES.discards} per battle) but not your turn.`,
    draw(ctx) {
      stepBadge(ctx, 1, 30, 40, 'CLICK');
      const party = [fakeMon('CHARMANDER', 9, 0.4), fakeMon('PIDGEY', 7), fakeMon('ODDISH', 6, 0.8)];
      panel(ctx, 30, 62, 160, 82);
      drawPartyPanel(ctx, { party }, 34, 66, 152, { rowH: 24, leadUid: party[0].uid, tooltip: false });
      draw(ctx, 'gfx/ui/cursors/red_arrow.png', 12 + bob(1), 94);
      label(ctx, 'gold frame = your lead', 110, 150, 'gold', 'center');
      stepBadge(ctx, 2, 214, 40, 'CONFIRM');
      panel(ctx, 214, 62, 190, 104);
      text(ctx, 'Send out PIDGEY?', 309, 68, { align: 'center', color: 'white' });
      label(ctx, 'Costs 1 discard.', 309, 84, 'whiteSoft', 'center');
      fauxButton(ctx, 'Switch!', 224, 104, 170, 24, THEME.green);
      fauxButton(ctx, 'Cancel', 224, 134, 170, 24, '#806060');
      stepBadge(ctx, 3, 424, 40, 'NEW HAND');
      [['TACKLE', 9], ['GUST', 12], ['SAND_ATTACK', 0]].forEach(([mv, dmg], i) => drawCard(ctx, fakeCard('PIDGEY', mv, dmg), 424 + i * 64, 62));
      label(ctx, "PIDGEY's own deck", 518, 150, 'gold', 'center');
      // bottom: the cost, the swap, when to do it
      panel(ctx, 30, 176, 160, 54);
      label(ctx, 'DISCARDS', 40, 182);
      text(ctx, String(DECK_RULES.discards), 52, 196, { color: 'red', scale: 2 });
      arrow(ctx, 'right', 80, 202);
      text(ctx, String(DECK_RULES.discards - 1), 112, 196, { color: 'red', scale: 2 });
      label(ctx, 'per switch', 182, 182, 'gray', 'right');
      drawMon(ctx, 'CHARMANDER', 218, 170, { back: true });
      arrow(ctx, 'right', 300 + Math.max(0, bob(1)), 196);
      drawMon(ctx, 'PIDGEY', 336, 170, { back: true });
      text(ctx, 'Go! PIDGEY!', 309, 222, { align: 'center', color: 'white', font: 'small' });
      label(ctx, 'Good times to switch:', 424, 178, 'white');
      textBlock(ctx, "· dodge a SUPER EFFECTIVE hit\n· bring a type the foe is weak to\n· lead fainted? click the next (free)", 424, 194, 190, { font: 'small', color: 'whiteSoft', lineHeight: 12 });
    },
  },
  {
    tab: 'CATCHING',
    body: () => 'Wild POKéMON can join your team. Weaken one below half HP or put it to sleep, then press |BALL|: it shows your catch chance. A throw uses your turn, so don\'t knock it out! It joins with its own deck. Buy BALLS at the |POKé MART|.',
    draw(ctx) {
      miniScene(ctx, 34, 44, { foe: 'ODDISH', lead: 'CHARMANDER' });
      miniHealthbox(ctx, 40, 50, 'ODDISH', 5, 0.42);
      // the ball on its way, with a dotted arc from the trainer's side
      for (let i = 0; i < 6; i++) { const k = i / 6; rect(ctx, 34 + 70 + k * 86, 44 + 78 - Math.sin(k * Math.PI * 0.9) * 50, 2, 2, '#506070'); }
      draw(ctx, 'gfx/ui/balls/poke.png', 34 + 156, 44 + 30 + bob(1), { sx: 0, sy: 0, sw: 16, sh: 16 });
      fauxButton(ctx, 'BALL 62%', 34, 152, 70, 22, '#d04040', 'small');
      fauxButton(ctx, 'RUN', 204, 152, 70, 22, '#607080', 'small');
      arrow(ctx, 'up', 61, 178 + bob(), 1);
      textBlock(ctx, 'BALL lights up once it can be caught, with your chance.', 82, 182, 190, { font: 'small', color: 'gold', lineHeight: 11 });
      label(ctx, "Only wild POKéMON: trainers keep theirs.", 34, 214);
      stepBadge(ctx, 1, 300, 44, 'WEAKEN IT');
      hpBar(ctx, 324, 66, 90, 0.42, 4);
      draw(ctx, 'gfx/ui/status/slp.png', 424, 64);
      textBlock(ctx, 'Below half HP (yellow bar) or asleep. Common POKéMON can be caught at once.', 324, 76, 284, { font: 'small', color: 'whiteSoft', lineHeight: 11 });
      stepBadge(ctx, 2, 300, 110, 'THROW A BALL');
      ['poke_ball', 'great_ball', 'ultra_ball'].forEach((b, i) => draw(ctx, `gfx/items/${b}.png`, 322 + i * 26, 128));
      textBlock(ctx, 'Uses your turn. Better balls, better odds.', 404, 134, 204, { font: 'small', color: 'whiteSoft', lineHeight: 11 });
      stepBadge(ctx, 3, 300, 166, 'GOTCHA!');
      drawIcon(ctx, 'ODDISH', 320, 180);
      textBlock(ctx, 'It joins your team with its own deck. 6 at most: release one to make room.', 356, 188, 252, { font: 'small', color: 'whiteSoft', lineHeight: 11 });
    },
  },
];

// ---- the walkthrough ------------------------------------------------------------------------
// opts.onGuide: opens the full text guide (title screen); opts.firstRun: the left button says SKIP.
export class BasicsModal extends Modal {
  enter() {
    this.page ||= 0;
    preload(['ui/cursors/scroll_right', 'ui/cursors/scroll_up', 'ui/cursors/scroll_left', 'ui/cursors/red_arrow', 'ui/balls/poke', 'ui/status/slp', 'items/poke_ball', 'items/great_ball', 'items/ultra_ball', 'terrain/grass'].map(f => `gfx/${f}.png`));
  }
  update(dt) {
    super.update(dt);
    if (keyPressed('ArrowRight')) this.go(1);
    if (keyPressed('ArrowLeft')) this.go(-1);
  }
  go(d) { const p = this.page + d; if (p >= PAGES.length) this.close(null); else this.page = Math.max(0, p); }
  close(v) { G.meta.basicsSeen = true; saveMeta(); super.close(v); }
  draw(ctx) {
    this.dim(ctx);
    const x = 16, y = 4, w = W - 32, h = H - 8;
    panel(ctx, x, y, w, h);
    PAGES.forEach((pg, i) => {
      const on = this.page === i, bx = W / 2 - 288 + i * 116;
      if (button(ctx, `${i + 1} ${pg.tab}`, bx, y + 5, 112, 21, { color: on ? '#806040' : '#3a4052', font: 'small', silent: on }) && !on) this.page = i;
      if (on) rect(ctx, bx + 4, y + 26, 104, 2, '#f8d038');
    });
    const pg = PAGES[this.page];
    pg.draw(ctx);
    windowFrame(ctx, x + 8, 258, w - 16, 64, 'std');
    richBlock(ctx, pg.body(), x + 20, 267, w - 40);
    const last = this.page === PAGES.length - 1, fy = y + h - 24;
    if (button(ctx, this.firstRun ? 'SKIP' : 'CLOSE', x + 10, fy, 70, 20, { color: '#806060', font: 'small' })) this.close(null);
    if (this.onGuide && button(ctx, 'FULL GUIDE', x + 86, fy, 90, 20, { color: '#3a7a58', font: 'small' })) this.onGuide();
    text(ctx, `${this.page + 1} / ${PAGES.length}`, W / 2, fy + 4, { align: 'center', color: 'gray', font: 'small' });
    if (this.page > 0 && button(ctx, 'BACK', x + w - 176, fy, 76, 20, { color: '#506080', font: 'small' })) this.go(-1);
    if (button(ctx, last ? "LET'S GO!" : 'NEXT', x + w - 94, fy, 84, 20, { color: last ? THEME.green : THEME.play, font: 'small' })) this.go(1);
    drawTips(ctx);
  }
}

// HOW TO PLAY during a run (map MENU, co-op MENU, battle "?"): a local overlay over the current screen; closing it
// returns there. FULL GUIDE opens the title's text guide on top.
export function openHowToPlay() {
  return pushOverlay(new BasicsModal({ onGuide: () => import('./title.js').then(m => pushOverlay(new m.AboutModal())) }));
}
