// Starter + ascension selection (Prof. Oak's lab).
import { Engine, W, H, setScene, hover, clicked, pushOverlay } from '../engine/core.js';
import { draw } from '../engine/assets.js';
import { text, textBlock } from '../engine/font.js';
import { swirlBackground, BG_THEMES, button, panel, pixBox, rect, drawTips, tip, THEME } from '../engine/ui.js';
import { D, TYPE_COLORS } from '../game/data.js';
import { G, saveRun, saveMeta, shinyUnlocked, SHINY_ASC, hasSavedRun } from '../game/state.js';
import { Run, ASCENSIONS, familyOf } from '../game/run.js';
import { STARTERS } from '../game/acts.js';
import { RELICS } from '../game/items.js';
import { Sound } from '../audio/sound.js';
import { drawMonCentered, typeIcon, ChoiceModal } from './common.js';
import { goToMap } from './flow.js';
import { isStarterUnlocked, ascUnlocked, ascDefault } from '../game/unlocks.js';
import { unlockedRegions, regionOf, SPIRE, orList, JOHTO_WINS } from '../game/regions.js';
import { showPendingStarterOffer } from './unlock.js';
import { TitleScene } from './title.js';

export class StarterScene {
  enter() {
    this.buildList();
    this.sel = 1;
    this.ascFor = null; // the ascension picker follows the selected starter (set in draw)
    this.t = 0;
    Sound.playBGM('mus_oak_lab');
    showPendingStarterOffer(); // an act-clear choice left open (e.g. the page was reloaded)
  }
  unlocked(st) { return isStarterUnlocked(G.meta, st.species, SPIRE); }
  // One Spire (v0.1.0): no world select; every run climbs the same spire, its acts' regions drawn from the seed.
  buildList() {
    this.list = STARTERS.filter(s => D.species[s.species]);
    this.sel = 1;
  }
  update(dt) { this.t += dt; }
  draw(ctx) {
    swirlBackground(ctx, BG_THEMES.map, 0.5);
    draw(ctx, 'gfx/misc/oak_speech/oak.png', 14, 10, { scale: 2 });
    panel(ctx, 150, 8, 476, 40, 'paper');
    const regions = unlockedRegions(G.meta);
    textBlock(ctx, regions.length > 1 ? `OAK: Welcome to KANTO SPIRE! Every act of the climb leads to ${orList(regions.map(id => regionOf(id).name))}, and you never know which. Choose your partner POKéMON!` : 'OAK: Welcome to KANTO SPIRE! Three GYMS, VICTORY ROAD and the ELITE FOUR stand between you and the top. Choose your partner POKéMON!', 162, 13, 452, { color: 'dark' });
    // starter grid (21 starters, one for every type): sprites at 1x, cropped to their pixels and centred
    // in the cell (never resampled), with type colour bars
    const per = 7, cw = 64, ch = 60, gap = 4, gy = 52;
    const rows = Math.ceil(this.list.length / per);
    const gx = 150 + (476 - (per * (cw + gap) - gap)) / 2;
    this.list.forEach((st, i) => {
      const cx = gx + (i % per) * (cw + gap), cy = gy + Math.floor(i / per) * (ch + 2);
      const ok = this.unlocked(st);
      const selected = this.sel === i;
      const hot = ok && hover(cx, cy, cw, ch);
      pixBox(ctx, cx, cy, cw, ch, selected ? '#4a5c88' : hot ? '#38445e' : '#262c3c', selected ? '#f8d038' : '#141820', 2);
      const shiny = ok && this.shinyOn(st.species);
      ctx.save(); ctx.beginPath(); ctx.rect(cx + 2, cy + 2, cw - 4, ch - 4); ctx.clip();
      const my = cy + 2 + (ch - 11) / 2;
      if (ok) drawMonCentered(ctx, st.species, cx + cw / 2, my + (selected ? Math.round(Math.sin(this.t * 6)) : 0), { shiny });
      else { drawMonCentered(ctx, st.species, cx + cw / 2, my, { silhouette: '#101018' }); text(ctx, '?', cx + cw / 2, my - 7, { align: 'center', color: 'white' }); }
      ctx.restore();
      // the highest ascension unlocked with this starter (each starter unlocks its own)
      if (ok) { const n = ascUnlocked(G.meta, st.species); pixBox(ctx, cx + 3, cy + 3, n >= 10 ? 19 : 14, 11, '#141820', null, 2); text(ctx, 'A' + n, cx + 5, cy + 2, { color: n ? 'gold' : 'gray', font: 'small' }); }
      if (shiny) { const sx = cx + cw - 8, sy = cy + 5, k = Math.sin(this.t * 5) > 0 ? 1 : 0; rect(ctx, sx - 1, sy - 3 - k, 2, 6 + 2 * k, '#f8e060'); rect(ctx, sx - 3 - k, sy - 1, 6 + 2 * k, 2, '#f8e060'); }
      const types = D.species[st.species]?.types || [];
      types.forEach((ty, k) => rect(ctx, cx + 4 + k * (cw - 8) / types.length, cy + ch - 7, (cw - 8) / types.length - (types.length > 1 ? 1 : 0), 4, TYPE_COLORS[ty]));
      if (hot && clicked(cx, cy, cw, ch)) { this.sel = i; Sound.playCry(st.species); }
      if (hover(cx, cy, cw, ch)) tip(ok ? D.species[st.species].name : 'LOCKED', ok ? types.join(' / ') : `${types.join(' / ')}\nClear an act to choose a new starter: each act clear lets you unlock 1 of up to 3 locked POKéMON.`);
    });
    // selected details
    const st = this.list[this.sel];
    const s = D.species[st.species];
    const dy = gy + rows * (ch + 2) + 2, ph = H - dy - 6;
    panel(ctx, 150, dy, 300, ph);
    const nw = text(ctx, s.name, 160, dy + 5, { color: 'white', scale: 1 });
    s.types.forEach((t, i) => typeIcon(ctx, t, 168 + nw + i * 36, dy + 6));
    text(ctx, `HP ${s.stats.hp}  ATK ${s.stats.atk}  DEF ${s.stats.def}  SPA ${s.stats.spa}  SPD ${s.stats.spd}  SPE ${s.stats.spe}`, 160, dy + 21, { color: 'gray', font: 'small' });
    // the selected starter (shiny when picked) and the SHINY toggle: a win at A5+ unlocks its family's shiny
    const ok = this.unlocked(st), shinyOk = ok && shinyUnlocked(st.species);
    if (ok) drawMonCentered(ctx, st.species, 412, dy + ph - 5, { shiny: this.shinyOn(st.species), bottom: true });
    const sy = dy + ph - 27;
    if (shinyOk) {
      const on = this.shinyOn(st.species);
      if (button(ctx, on ? 'SHINY: ON' : 'SHINY: OFF', 160, sy, 104, 22, { color: on ? '#c09020' : '#505868', font: 'small' })) {
        const fam = familyOf(st.species);
        G.meta.shinyOn = { ...(G.meta.shinyOn || {}), [fam]: !on };
        saveMeta(); Sound.playSE(on ? 'se_select' : 'se_shiny');
      }
    } else if (ok) {
      text(ctx, 'SHINY: win at A' + SHINY_ASC + '+ to unlock', 160, sy + 6, { color: 'gray', font: 'small' });
      if (hover(160, sy, 160, 22)) tip('SHINY FORM', `Win a run at Ascension ${SHINY_ASC} or higher with ${s.name} (or its evolutions) to unlock its shiny form. Cosmetic only.`);
    }
    text(ctx, 'Starting moves:', 160, dy + 34, { color: 'whiteSoft', font: 'small' });
    st.moves.filter(m => D.moves[m]).forEach((m, i) => {
      const mv = D.moves[m];
      const mx = 160 + (i % 2) * 112, my = dy + 46 + Math.floor(i / 2) * 12;
      rect(ctx, mx, my + 2, 6, 6, TYPE_COLORS[mv.type]);
      text(ctx, `${mv.name} ${mv.power ? '(' + mv.power + ')' : ''}`, mx + 9, my, { color: 'white', font: 'small' });
    });
    // a starter's own held item (STARTERS[].item), held from the first floor
    if (st.item && D.items[st.item]) {
      const iw = text(ctx, 'Starts with: ' + D.items[st.item].name, 160, dy + 72, { color: 'gold', font: 'small' });
      if (hover(160, dy + 72, iw || 120, 10)) tip(D.items[st.item].name, RELICS[st.item]?.desc || '');
    }
    // ascension
    const ax = 458, aw = 168;
    panel(ctx, ax, dy, aw, ph);
    // per starter: this one's unlock caps the picker, which reopens at the level last used with it
    const maxA = ok ? ascUnlocked(G.meta, st.species) : 0;
    if (this.ascFor !== st.species) { this.ascFor = st.species; this.asc = ascDefault(G.meta, st.species); }
    this.asc = Math.max(0, Math.min(this.asc, maxA));
    const setAsc = (v) => { this.asc = v; (G.meta.lastAscBy ||= {})[st.species] = v; };
    // < A3 > on one row with the title above it; the newest rule below (the tooltip lists them all)
    text(ctx, 'ASCENSION', ax + aw / 2, dy + 4, { align: 'center', color: 'white', font: 'small' });
    if (button(ctx, '<', ax + 8, dy + 16, 24, 20, { color: '#506080', disabled: this.asc <= 0 })) setAsc(this.asc - 1);
    text(ctx, 'A' + this.asc, ax + aw / 2, dy + 19, { align: 'center', color: this.asc ? 'red' : 'gold', scale: 1 });
    if (button(ctx, '>', ax + aw - 32, dy + 16, 24, 20, { color: '#506080', disabled: this.asc >= maxA })) setAsc(this.asc + 1);
    const a = ASCENSIONS[this.asc];
    text(ctx, this.asc > 1 ? `${a.name} + A1-A${this.asc - 1}` : a.name, ax + aw / 2, dy + 39, { align: 'center', color: 'gold', font: 'small' });
    textBlock(ctx, a.desc, ax + 8, dy + 51, aw - 16, { color: 'whiteSoft', font: 'small', lineHeight: 10 });
    const perStarter = `Unlocked with ${s.name}: up to A${maxA}. Each starter unlocks its own levels${maxA < 10 ? `: win at A${maxA} with ${s.name} to open A${maxA + 1}` : ''}.`;
    if (hover(ax, dy, aw, ph)) tip(`ASCENSION ${this.asc}`, (this.asc > 0 ? ASCENSIONS.slice(1, this.asc + 1).map(x => `A${x.n}: ${x.desc}`).join('\n') + '\n\n' : '') + perStarter, { width: 220 });
    if (maxA === 0) text(ctx, ok ? `Win with ${s.name} to unlock A1` : 'Unlock it to climb its ascensions', ax + aw / 2, dy + ph - 16, { align: 'center', color: 'gray', font: 'small' });

    if (button(ctx, 'BACK', 14, H - 34, 70, 24, { color: '#806060' })) setScene(new TitleScene());
    // the regions this spire can draw its acts from (no world select since v0.1.0)
    text(ctx, 'REGIONS', 74, 210, { align: 'center', color: 'white', font: 'small' });
    regions.forEach((id, i) => text(ctx, regionOf(id).name, 74, 222 + i * 11, { align: 'center', color: 'gold', font: 'small' }));
    if (regions.length < 2) text(ctx, 'HOENN: locked', 74, 233, { align: 'center', color: 'gray', font: 'small' });
    else if (!regions.includes('johto')) text(ctx, 'JOHTO: locked', 74, 244, { align: 'center', color: 'gray', font: 'small' });
    const names = orList(regions.map(id => regionOf(id).name));
    if (hover(14, 206, 120, 40)) tip('ONE SPIRE', regions.length > 1 ? `Each act draws its region from the run seed: ${names}, with their own GYM LEADERS, areas and events. The ELITE FOUR and the post-game come from a region you visited.${regions.includes('johto') ? '' : ` Win ${JOHTO_WINS} runs and JOHTO acts join too.`}` : 'Every act is in KANTO for now. Become CHAMPION once and HOENN acts join the spire: each act then draws its region from the run seed.', { width: 220 });
    if (button(ctx, 'BEGIN!', 14, H - 64, 120, 26, { color: THEME.green, disabled: !this.unlocked(st) })) this.start(st);
    drawTips(ctx);
  }
  shinyOn(species) { return shinyUnlocked(species) && !!G.meta.shinyOn?.[familyOf(species)]; }
  // A run in progress is only replaced here, after a confirmation (browsing this menu never touches it).
  start(st) {
    if (!hasSavedRun()) return this.begin(st);
    pushOverlay(new ChoiceModal({ title: 'Abandon your current run?', body: 'Starting a new run replaces the run in progress.',
      options: [{ label: 'Yes, start over', value: 1, color: THEME.discard }, { label: 'No', value: 0 }], onClose: v => { if (v === 1) this.begin(st); } }));
  }
  begin(st) {
    G.meta.lastAscension = this.asc;
    (G.meta.lastAscBy ||= {})[st.species] = this.asc;
    G.run = Run.create({ starter: st.species, ascension: this.asc, world: SPIRE, pool: unlockedRegions(G.meta), shiny: this.shinyOn(st.species), champ: !!G.meta.unlocks?.win });
    saveRun();
    Sound.playCry(st.species);
    goToMap({ intro: true });
  }
}

// Not part of a run: NOW PLAYING (net/presence.js) does not list you here.
StarterScene.prototype.idle = true;
