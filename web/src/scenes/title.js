// Title screen.
import { Engine, W, H, setScene, pushOverlay, keyPressed, hover, setDisplayMode } from '../engine/core.js';
import { draw, img, ready } from '../engine/assets.js';
import { text } from '../engine/font.js';
import { swirlBackground, BG_THEMES, button, panel, rect, drawTips, tip, THEME, scrollArea } from '../engine/ui.js';
import { G, hasSavedRun, loadRun, saveMeta } from '../game/state.js';
import { Sound } from '../audio/sound.js';
import { ChoiceModal, Modal } from './common.js';
import { StarterScene } from './starter.js';
import { goToMap, continueRun } from './flow.js';
import { DexScene } from './dex.js';
import { RecordsScene } from './records.js';
import { VERSION, PATCH_NOTES } from '../game/version.js';
import { textBlock, measure } from '../engine/font.js';
import { coopAvailable } from './coop/net.js';
import { CRT } from '../engine/crt.js';
import { nowPlaying, stopNowPlaying } from '../net/presence.js';
import { BasicsModal } from './tutorial.js';

const CRT_MODES = ['off', 'subtle', 'strong'];
const DISPLAY_MODES = ['auto', 'pixel', 'fill'];

export class TitleScene {
  enter() {
    this.t = 0;
    this.started = false;
    Sound.playBGM('mus_title');
  }
  exit() { stopNowPlaying(); } // (the NOW PLAYING subscription lives while the title shows)
  update(dt) {
    this.t += dt;
    if (!this.started && (Engine.mouse.clicked || keyPressed('Enter') || keyPressed(' '))) {
      this.started = true;
      Sound.unlock();
      Sound.playBGM('mus_title');
      Engine.mouse.clicked = false;
    }
  }
  draw(ctx) {
    swirlBackground(ctx, BG_THEMES.title, 0.6);
    // GBA title art, 2x, centered on the left
    const ox = 18, oy = 18;
    ctx.save();
    ctx.globalAlpha = 0.95;
    draw(ctx, 'gfx/ui/title/charizard.png', 400, 70 + Math.sin(this.t * 1.5) * 2, { scale: 2 });
    ctx.restore();
    // flames rising behind charizard
    for (let i = 0; i < 9; i++) {
      const fx = 380 + i * 26 + Math.sin(this.t * 2 + i) * 4;
      const life = ((this.t * 40 + i * 37) % 120) / 120;
      const fy = 300 - life * 120;
      const frame = Math.min(6, Math.floor(life * 7));
      draw(ctx, 'gfx/ui/title/flames.png', fx, fy, { sx: 0, sy: frame * 16, sw: 16, sh: 16, scale: 2, alpha: 0.85 });
    }
    draw(ctx, 'gfx/ui/title/logo.png', 40, 18, { scale: 2 });
    // subtitle banner
    const by = 210;
    rect(ctx, 0, by, 380, 34, '#00000088');
    text(ctx, 'KANTO SPIRE', 196, by + 3, { align: 'center', color: 'gold', scale: 2 });
    text(ctx, 'a roguelike of routes, cards & combos', 196, by + 36, { align: 'center', color: 'whiteSoft', font: 'small' });

    if (!this.started) {
      if (Math.floor(this.t * 2) % 2 === 0) text(ctx, 'CLICK TO START', 196, 300, { align: 'center', color: 'white' });
      text(ctx, '(C)1995-2004 Nintendo / Creatures / GAME FREAK - fan project, private use', W / 2, H - 12, { align: 'center', color: 'gray', font: 'small' });
      return;
    }
    const bx = 116, bw = 160;
    let y = 262;
    const saved = hasSavedRun();
    if (saved) {
      if (button(ctx, 'CONTINUE', bx, y, bw, 24, { color: THEME.green })) { if (loadRun()) continueRun(); }
      y += 28;
    }
    // NEW RUN only opens the starter menu: the saved run is replaced only when you BEGIN a new one (it asks first)
    if (button(ctx, 'NEW RUN', bx, y, bw, 24, { color: THEME.play })) newRun();
    // Online co-op (hosted builds with a Convex backend; ?coopdev on the local build). Loaded on demand so solo never depends on it.
    if (coopAvailable() && button(ctx, 'CO-OP (beta)', bx + bw + 6, y, 96, 24, { color: '#b04890', font: 'small' })) import('./coop/lobby.js').then(m => setScene(new m.CoopLobbyScene())).catch(e => pushOverlay(new ChoiceModal({ title: 'CO-OP failed to load', body: e.message, options: [{ label: 'OK', value: 0 }] })));
    y += 28;
    if (button(ctx, 'POKéDEX', bx, y, 52, 22, { color: '#c03030', font: 'small' })) setScene(new DexScene());
    if (button(ctx, 'RECORDS', bx + 54, y, 52, 22, { color: '#c09020', font: 'small' })) setScene(new RecordsScene());
    if (button(ctx, 'SETTINGS', bx + 108, y, 52, 22, { color: '#506080', font: 'small' })) pushOverlay(new SettingsModal());
    if (button(ctx, 'HOW TO PLAY', 8, 6, 84, 18, { color: '#3a7a58', font: 'small' })) pushOverlay(new BasicsModal({ onGuide: () => pushOverlay(new AboutModal()) }));
    // version + patch notes (opens once by itself after an update)
    const vl = `${VERSION} · PATCH NOTES`, vw = measure(vl, 'small');
    if (button(ctx, vl, W - vw - 18, 6, vw + 12, 18, { color: '#405070', font: 'small' })) pushOverlay(new PatchNotesModal());
    // keyed on the newest notes entry, so a build with new notes (v0.0.3-dmg) shows them once even at the same VERSION
    if (G.meta.seenVersion !== PATCH_NOTES[0].v) { G.meta.seenVersion = PATCH_NOTES[0].v; saveMeta(); pushOverlay(new PatchNotesModal()); }
    const m = G.meta;
    text(ctx, `Runs ${m.totalRuns}  ·  Wins ${m.totalWins}  ·  Best ascension ${m.bestAscensionWon >= 0 ? 'A' + m.bestAscensionWon : '—'}`, W / 2, H - 12, { align: 'center', color: 'gray', font: 'small' });
    this.drawNowPlaying(ctx);
    drawTips(ctx);
  }
}

// NOW PLAYING (net/presence.js): who else is in a run right now, in a small FireRed text window in the bottom-right
// corner. Nothing at all when nobody is (or offline / signed out / an older server).
TitleScene.prototype.drawNowPlaying = function (ctx) {
  const list = nowPlaying();
  if (!list?.length) return;
  const MAX = 4, rows = list.slice(0, list.length > MAX ? MAX - 1 : MAX), more = list.length - rows.length;
  const w = 200, lh = 11, h = 26 + (rows.length + (more ? 1 : 0)) * lh, x = W - w - 4, y = H - 24 - h;
  panel(ctx, x, y, w, h, 'paper');
  if (Math.floor(this.t * 1.5) % 2 === 0) rect(ctx, x + 10, y + 10, 4, 4, '#38b048'); // the "live" light
  text(ctx, 'NOW PLAYING', x + 18, y + 6, { color: 'red', font: 'small' });
  rows.forEach((g, i) => {
    const names = (g.names || []).join(' + '), what = g.what ? ' · ' + g.what : '';
    let line = names + what;
    // keep the activity, shorten the names if the line is too long
    if (measure(line, 'small') > w - 22) {
      let n = names;
      while (n.length > 3 && measure(n + '…' + what, 'small') > w - 22) n = n.slice(0, -1);
      line = n + '…' + what;
    }
    text(ctx, line, x + 10, y + 18 + i * lh, { color: 'dark', font: 'small' });
  });
  if (more) text(ctx, `and ${more} more`, x + 10, y + 18 + rows.length * lh, { color: 'gray', font: 'small' });
  if (hover(x, y, w, h)) tip('NOW PLAYING', 'Trainers in a run right now (solo or co-op), as of the last minute or so.');
};

// NEW RUN: a brand-new player (no runs yet) is offered the illustrated basics once, on the way to the starters.
function newRun() {
  if (G.meta.totalRuns || G.meta.basicsSeen) return setScene(new StarterScene());
  G.meta.basicsSeen = true; saveMeta();
  pushOverlay(new ChoiceModal({
    title: 'New to KANTO SPIRE?', body: 'A one-minute picture guide: your turn, types, scoring, switching and catching.',
    options: [{ label: 'SHOW ME THE BASICS', value: 1, color: THEME.green }, { label: 'Skip, pick a starter', value: 2, color: '#506080' }],
    onClose: (v) => {
      if (v === 1) pushOverlay(new BasicsModal({ firstRun: true, onClose: () => setScene(new StarterScene()) }));
      else if (v === 2) setScene(new StarterScene());
    },
  }));
}

export class SettingsModal extends Modal {
  draw(ctx) {
    this.dim(ctx);
    const s = G.meta.settings;
    const w = 280, h = 268, x = (W - w) / 2, y = (H - h) / 2;
    panel(ctx, x, y, w, h);
    text(ctx, 'SETTINGS', W / 2, y + 8, { align: 'center', color: 'white' });
    const row = (label, val, cy, set) => {
      text(ctx, label, x + 14, cy + 4, { color: 'white' });
      text(ctx, Math.round(val * 100) + '%', x + 170, cy + 4, { align: 'center', color: 'gold' });
      if (button(ctx, '-', x + 130, cy, 22, 20, { color: '#506080' })) set(Math.max(0, +(val - 0.1).toFixed(2)));
      if (button(ctx, '+', x + 190, cy, 22, 20, { color: '#506080' })) set(Math.min(1, +(val + 0.1).toFixed(2)));
    };
    row('MUSIC', s.music, y + 32, v => { s.music = v; Sound.setMusicVolume(v); saveMeta(); });
    row('SOUND FX', s.sfx, y + 58, v => { s.sfx = v; Sound.setSfxVolume(v); saveMeta(); Sound.playSE('se_select'); });
    text(ctx, 'FAST ANIMATIONS', x + 14, y + 88, { color: 'white' });
    if (button(ctx, s.fast ? 'ON' : 'OFF', x + 170, y + 84, 60, 20, { color: s.fast ? THEME.green : '#806060' })) { s.fast = !s.fast; saveMeta(); }
    text(ctx, 'STEREO', x + 14, y + 112, { color: 'white' });
    if (button(ctx, s.stereo ? 'ON' : 'OFF', x + 170, y + 108, 60, 20, { color: s.stereo ? THEME.green : '#806060' })) { s.stereo = !s.stereo; Sound.setStereo(s.stereo); saveMeta(); }
    // HQ = smooth full-precision mixing (default); GBA = the original console's crunchy 8-bit mixer
    const gba = s.audioQuality === 'gba';
    text(ctx, 'AUDIO QUALITY', x + 14, y + 136, { color: 'white' });
    if (button(ctx, gba ? 'GBA' : 'HQ', x + 170, y + 132, 60, 20, { color: gba ? '#806060' : THEME.green })) { s.audioQuality = gba ? 'hq' : 'gba'; Sound.setQuality(s.audioQuality); saveMeta(); }
    if (hover(x + 10, y + 130, w - 20, 24)) tip('AUDIO QUALITY', 'HQ: smooth, full-precision mixing with more voices (default).\nGBA: the exact Game Boy Advance mixer, crunchy 8-bit sound and all.');
    // CRT: an old-TV post-process over the whole screen (engine/crt.js), off by default
    const crt = CRT_MODES.includes(s.crt) ? s.crt : 'off';
    text(ctx, 'CRT', x + 14, y + 160, { color: 'white' });
    if (button(ctx, crt.toUpperCase(), x + 170, y + 156, 60, 20, { color: crt === 'off' ? '#806060' : THEME.green })) {
      s.crt = CRT_MODES[(CRT_MODES.indexOf(crt) + 1) % CRT_MODES.length]; CRT.set(s.crt); saveMeta();
    }
    if (hover(x + 10, y + 154, w - 20, 24)) tip('CRT', 'An old-TV look: scanlines, a softly curved glass screen and a warm glow.\nOFF (default) / SUBTLE / STRONG.');
    // CRT CURVE: the curved glass on or off (a flat screen keeps the scanlines and glow); only matters with CRT on
    const curve = s.crtCurve !== false;
    text(ctx, 'CRT CURVE', x + 14, y + 184, { color: crt === 'off' ? 'gray' : 'white' });
    if (button(ctx, curve ? 'ON' : 'OFF', x + 170, y + 180, 60, 20, { color: curve ? THEME.green : '#806060' })) { s.crtCurve = !curve; CRT.setCurve(s.crtCurve); saveMeta(); }
    if (hover(x + 10, y + 178, w - 20, 24)) tip('CRT CURVE', 'The curved glass and rounded corners of the CRT look.\nOFF gives a flat screen that keeps the scanlines and glow. Only matters with CRT on.');
    // SCREEN: how the picture is scaled to the window (engine/core.js setDisplayMode)
    const disp = DISPLAY_MODES.includes(s.display) ? s.display : 'fill';
    text(ctx, 'SCREEN', x + 14, y + 208, { color: 'white' });
    if (button(ctx, disp.toUpperCase(), x + 170, y + 204, 60, 20, { color: disp === 'fill' ? '#506080' : THEME.green })) {
      s.display = setDisplayMode(DISPLAY_MODES[(DISPLAY_MODES.indexOf(disp) + 1) % DISPLAY_MODES.length]); saveMeta();
    }
    if (hover(x + 10, y + 202, w - 20, 24)) tip('SCREEN', 'How the game is scaled to your window.\nFILL (default): always as big as fits, smoothly scaled so the pixels stay even.\nPIXEL: always a whole-number scale, every pixel the same size (borders around it).\nAUTO: whole-number scale, stretched when that would leave big borders.', { width: 230 });
    if (button(ctx, 'CLOSE', W / 2 - 40, y + h - 30, 80, 22, { color: '#506080' })) this.close();
    this.closeOnTapOutside(x, y, w, h);
    drawTips(ctx);
  }
}

export class PatchNotesModal extends Modal {
  draw(ctx) {
    this.dim(ctx);
    const x = 24, y = 4, w = W - 48, h = H - 8;
    panel(ctx, x, y, w, h);
    const p = this.page || 0;
    const notes = PATCH_NOTES[p];
    text(ctx, `PATCH NOTES  ${notes.v}${notes.title ? '  ·  ' + notes.title : ''}`, W / 2, y + 8, { align: 'center', color: 'gold' });
    scrollArea(ctx, this, x + 6, y + 24, w - 12, y + h - 30, (cy) => {
      for (const [title, lines] of notes.sections) {
        if (title) { text(ctx, title, x + 12, cy, { color: 'white', font: 'small' }); cy += 12; }
        for (const l of lines) cy += textBlock(ctx, '· ' + l, x + 18, cy, w - 40, { color: 'whiteSoft', font: 'small', lineHeight: 10 }) + 2;
        cy += 4;
      }
      return cy;
    });
    if (p + 1 < PATCH_NOTES.length && button(ctx, 'OLDER', x + 12, y + h - 24, 70, 18, { color: '#506080', font: 'small' })) { this.page = p + 1; this.scroll = 0; }
    if (p > 0 && button(ctx, 'NEWER', x + 88, y + h - 24, 70, 18, { color: '#506080', font: 'small' })) { this.page = p - 1; this.scroll = 0; }
    if (button(ctx, 'CLOSE', W - x - 92, y + h - 24, 80, 18, { color: '#506080', font: 'small' })) this.close();
    drawTips(ctx);
  }
}

// The owner's intro for newcomers (title screen > HOW TO PLAY).
const ABOUT = [
  ['', ['Welcome to a roguelike which is Pokemon x Slay the Spire x Balatro! There are 4 Acts for the main game, and 5 as an extension. For people familiar with these games, here’s a breakdown of the mechanics & differences from the aforementioned games.']],
  ['POKEMON', [
    'You have a deck per pokemon',
    'PP is actually how many cards you have for each move (attacks get PP/10 + 1 cards, 2 to 5; status moves 1 or 2)',
    'You play multiple "moves" per turn',
    'You only have a team of 6 max. Catching a new Pokemon replaces one',
    'EXP is scaled like Gen 5: a Pokemon above the foe’s level earns less EXP, one below it earns more, so rotate your team. The Pokemon that fought get full EXP, the bench half, and fainted Pokemon get none. From Ascension 5 on each act has a level cap (its boss’s top level +2): battle EXP past it is lost.',
  ]],
  ['BALATRO', [
    'Combat is Balatro-like: you play up to 5 cards a turn, and poker-style combos of the same type (pair, triple, full house...) boost your damage. There are no chips or mult: every card deals real Pokemon damage (level, power, attack vs defense, STAB, type matchups), and you also take damage each turn',
    'Straights are "coverage", which means you play 4 attack cards of 4 different types. There’s a relic that makes this easier with 3 types',
    'Your deck is bigger than your hand, so discard to dig for combos: once per turn you can discard up to 2 cards for free, and you have 2 more discards per battle for bigger digs (switching your lead costs one)',
  ]],
  ['SLAY THE SPIRE', [
    'Honestly this game is more similar to Balatro',
    'You have 3 "potion" slots and unbounded "relics"',
    'Instead of just one character you have up to 6. You have to catch your team members',
    'There are ascensions. A0 is already hard, so plan your team, moves and items for the long run',
  ]],
  ['ONE SPIRE', [
    'Every run climbs the same spire: Acts 1 to 3 end at a GYM LEADER, Act 4 is VICTORY ROAD, then the ELITE FOUR and the CHAMPION, and an optional post-game after that',
    'Each act draws its region from the run seed: KANTO at first, HOENN acts join once you have won a run, and JOHTO acts after your 2nd win. The region decides the act’s areas, GYM LEADERS (and badges), elites, events and legendary. Levels follow the act, not the region',
    'The act-clear screen shows the next act’s region and its possible GYM LEADERS, so you can plan your team. The ELITE FOUR and the post-game come from a region you visited',
    'One rival follows you all the way: MAY if your starter is from HOENN, SILVER if it is from JOHTO, BLUE otherwise',
    'JOHTO acts run from morning to night: the first third of the act is morning, then day, then night, and each brings its own wild POKéMON',
  ]],
  ['THE MAP', [
    'Your rival waits on a floor every path crosses in Acts 1-3. Their starter beats yours, but beating them pays a guaranteed held item',
    'Gold-glowing legendary POKéMON nodes are optional and much tougher than an elite. Beat one for its unique held item and a one-time chance to catch it',
    '"?" events change with every act (and every region), and some choices pay off acts later, even in another region. Watch out for purple held items: they are curses. A POKéMON CENTER can CLEANSE them',
    'Clearing an act lets you unlock one new starter, and there is a starter for every type',
    'Ascension 8 is NUZLOCKE: fainted POKéMON are released and only the first wild POKéMON of each act can be caught. Win at A5 or higher to unlock your starter’s shiny form',
  ]],
];

export class AboutModal extends Modal {
  draw(ctx) {
    this.dim(ctx);
    const x = 24, y = 4, w = W - 48, h = H - 8;
    panel(ctx, x, y, w, h);
    text(ctx, 'HOW TO PLAY', W / 2, y + 8, { align: 'center', color: 'gold' });
    scrollArea(ctx, this, x + 6, y + 26, w - 12, y + h - 30, (cy) => {
      for (const [title, lines] of ABOUT) {
        if (title) { text(ctx, title, x + 12, cy, { color: 'white', font: 'small' }); cy += 12; }
        for (const l of lines) cy += textBlock(ctx, (title ? '· ' : '') + l, x + (title ? 18 : 12), cy, w - 40, { color: 'whiteSoft', font: 'small', lineHeight: 11 }) + 3;
        cy += 4;
      }
      return cy;
    });
    if (button(ctx, 'CLOSE', W - x - 92, y + h - 24, 80, 18, { color: '#506080', font: 'small' })) this.close();
    drawTips(ctx);
  }
}

// Not part of a run: NOW PLAYING (net/presence.js) does not list you here.
TitleScene.prototype.idle = true;
