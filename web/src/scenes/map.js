// Slay-the-Spire style act map.
import { Engine, W, H, hover, inRect, clicked, pushOverlay, topOverlay, tween, Ease, wait, keyPressed, setScene } from '../engine/core.js';
import { draw, img, ready, itemPath, trainerPath } from '../engine/assets.js';
import { text, textBlock, measure } from '../engine/font.js';
import { swirlBackground, BG_THEMES, button, panel, pixBox, rect, drawTips, tip, tip as showTip, THEME } from '../engine/ui.js';
import { D, TYPE_COLORS } from '../game/data.js';
import { G, saveRun } from '../game/state.js';
import { reachable, NODE_INFO } from '../game/map.js';
import { LEGENDS, BIRD_PARTNER } from '../game/acts.js';
import { regionOf, actTitle, TIME_NAMES } from '../game/regions.js';
import { BOSS_RULES, bossTypes, bossTypeLabel } from '../game/bosses.js';
import { CONSUMABLES, RELICS } from '../game/items.js';
import { Sound } from '../audio/sound.js';
import { monName } from '../game/pokemon.js';
import { drawHUD, drawPartyPanel, drawIcon, drawPortrait, drawTrainer, DeckModal, PartyPicker, MessageBox, MoveReplaceModal, ChoiceModal, monTooltip, drawTypeTags } from './common.js';
import { enterNode } from './flow.js';
import { useConsumableOutside } from './items_ui.js';
import { showPendingStarterOffer } from './unlock.js';
import { sketchFor, addPoint, trimSketch, drawStrokes } from './sketch.js';

const NODE_SPRITE = {
  wild: null, trainer: 'youngster', elite: 'cooltrainer_m', center: 'nurse', mart: 'clerk', event: null, treasure: null,
};
const TRAINER_SPRITES = ['youngster', 'lass', 'bug_catcher', 'hiker', 'camper', 'picnicker', 'fisher', 'sailor', 'gentleman', 'poke_maniac', 'rocker', 'beauty', 'black_belt', 'biker'];
const BOSS_SPRITE = {
  LEADER_BROCK: 'brock', LEADER_MISTY: 'misty', LEADER_LT_SURGE: 'lt_surge', LEADER_ERIKA: 'erika', LEADER_KOGA: 'koga',
  LEADER_SABRINA: 'sabrina', LEADER_BLAINE: 'blaine', LEADER_GIOVANNI: 'giovanni', ELITE_FOUR_LORELEI: 'lorelei',
};
const MAP_X0 = 172, MAP_W = 296, FLOOR_H = 40;
const NODE_COLORS = { wild: '#58b858', trainer: '#5878d8', elite: '#d84848', rival: '#38a0f8', legend: '#f8f8f8', center: '#e868a8', mart: '#f08830', event: '#a868d8', treasure: '#e8b838', boss: '#f8d038' };

export class MapScene {
  constructor(opts = {}) { this.opts = opts; }
  enter() {
    const run = G.run;
    this.t = 0;
    this.msg = new MessageBox();
    this.busy = false;
    this.walk = null;
    const act = run.act;
    const prog = Math.max(0, run.floor) / act.floors;
    Sound.playBGM(act.music[Math.min(act.music.length - 1, Math.floor(prog * act.music.length))]);
    this.scroll = this.targetScroll();
    if (this.opts.intro) this.intro();
    else if (this.opts.actIntro) this.actIntro();
    else if (this.opts.released?.length) this.releasedMsg(this.opts.released);
    this.handlePending();
    if (!G.coop) showPendingStarterOffer(); // an act-clear starter choice left open by a reload
  }
  async intro() {
    this.busy = true;
    await this.msg.say(`OAK: ${D.species[G.run.starter].name} looks happy to be with you!`);
    await this.msg.say('OAK: Pick a path across the map. Battles give money and new moves, POKéMON CENTERS let you rest.');
    await this.msg.say('OAK: In battle, attack cards of the same TYPE form combos: PAIR, TRIPLE and more. Every POKéMON has its own deck, and your hand comes from the lead. Every card deals real damage, and combos add a bonus!');
    await this.msg.say('OAK: The GYM LEADER waits at the top. Good luck!');
    this.busy = false;
  }
  async releasedMsg(list) {
    this.busy = true;
    for (const m of list) await this.msg.say(`NUZLOCKE: ${monName(m)} fainted and was released. Farewell...`);
    this.busy = false;
  }
  async actIntro() {
    this.busy = true;
    this.banner = { a: 0 };
    tween(this.banner, { a: 1 }, 0.4);
    await wait(2.0);
    await tween(this.banner, { a: 0 }, 0.4);
    this.banner = null;
    this.busy = false;
  }
  handlePending() {
    const run = G.run;
    if (run.pendingLevelEvents || run.pendingEvolution) { import('./reward.js').then(m => m.processPendingLevelEvents(() => {})); }
  }
  // The run whose map/act/boss is drawn (co-op overrides this with the shared world run).
  mapRun() { return G.run; }
  targetScroll() {
    const run = this.mapRun();
    const f = Math.max(0, run.floor + 1);
    return Math.max(0, f * FLOOR_H - 140);
  }
  nodePos(n) {
    const x = n.type === 'boss' ? MAP_X0 + MAP_W / 2 : MAP_X0 + n.x * MAP_W;
    const y = H - 40 - n.floor * FLOOR_H + this.scroll - (n.type === 'boss' ? 18 : 0);
    return [x, y];
  }
  update(dt) {
    this.t += dt;
    this.msg.update(dt, G.meta.settings.fast);
    if (this.walk) this.scroll = this.walk.scroll0 + (this.walk.scroll1 - this.walk.scroll0) * this.walk.o.k;
    else if (Engine.mouse.wheel && inMap()) this.scroll = Math.max(0, Math.min((this.mapRun().act.floors + 1) * FLOOR_H - 200, this.scroll - Engine.mouse.wheel * 30));
    this.updateSketch();
  }
  // ---- map sketches (scenes/sketch.js): right-drag, or a plain drag with PEN on ----
  // Solo: one sketch per act, saved with the run. Co-op overrides the store (the partner sees yours).
  mySketch() { const r = G.run; r.sketch = sketchFor(r.sketch, this.mapRun().actIndex); return r.sketch; }
  otherSketches() { return []; } // [{ strokes, color }]
  sketchColor() { return '#f8e8b0'; }
  saveSketch() { saveRun(); }
  eraseSketches() { this.mySketch().strokes = []; this.stroke = null; this.saveSketch(); }
  updateSketch() {
    const m = Engine.mouse, held = m.rdown || (this.pen && m.down);
    if (!this.stroke) {
      // (a quick click can press and release within one frame: it still leaves a dot)
      if ((m.rjustPressed || (this.pen && m.justPressed)) && inMap()) {
        this.stroke = [];
        addPoint(this.stroke, m.x, m.y - this.scroll);
        this.mySketch().strokes.push(this.stroke);
      }
      if (!this.stroke || held) return;
    }
    if (held) { addPoint(this.stroke, Math.max(MAP_X0 - 12, Math.min(MAP_X0 + MAP_W + 12, m.x)), m.y - this.scroll); return; }
    this.stroke = null;
    trimSketch(this.mySketch());
    this.saveSketch();
  }
  drawSketchButtons(ctx) {
    const y = H - 28, any = this.mySketch().strokes.length > 0 || this.otherSketches().some(o => o.strokes.length);
    text(ctx, 'Right-drag the map to sketch', 81, y - 13, { align: 'center', color: 'gray', font: 'small' });
    if (button(ctx, 'ERASE', 8, y, 78, 22, { color: '#806060', font: 'small', disabled: !any })) this.eraseSketches();
    if (hover(8, y, 78, 22)) tip('ERASE SKETCHES', G.coop ? 'Erase every sketch on this map (yours and your partner\'s).' : 'Erase every sketch on this map.');
    if (button(ctx, this.pen ? 'PEN: ON' : 'PEN', 90, y, 64, 22, { color: this.pen ? '#c09020' : '#505868', font: 'small' })) this.pen = !this.pen;
    if (hover(90, y, 64, 22)) tip('PEN', 'Sketch with a normal drag or tap (touch screens, trackpads). Right-drag always sketches. Turn it off to pick a node again.');
  }
  draw(ctx) {
    const run = G.run;
    const act = run.act;
    swirlBackground(ctx, act.id === 5 ? BG_THEMES.water : act.id === 4 ? BG_THEMES.cave : BG_THEMES[regionOf(act.region).mapTheme], 0.4);
    const hovered = this.drawMapColumn(ctx, run);

    // HUD + party
    drawHUD(ctx, run, {
      onDeck: () => pushOverlay(new DeckModal({})),
      onConsumableClick: (k) => useConsumableOutside(k),
      sellable: true,
      onRelicClick: (k) => sellRelicPrompt(k),
      onMenu: () => openRunMenu(),
    });
    panel(ctx, 4, 32, 154, 30 * run.party.length + 22);
    text(ctx, 'PARTY', 81, 34, { align: 'center', color: 'white', font: 'small' });
    const m = drawPartyPanel(ctx, run, 8, 48, 146, { showExp: true, tipX: 162, leadUid: run.party[0]?.uid });
    if (m && !this.busy) this.reorder(m);
    text(ctx, 'Click to set lead', 81, 52 + 30 * run.party.length, { align: 'center', color: 'gray', font: 'small' });
    this.drawSketchButtons(ctx);

    // right panel: boss preview + legend
    this.drawRightPanel(ctx);
    this.drawNodeTip(hovered);
    this.drawBanner(ctx, act);
    this.msg.draw(ctx, 164, 34, 312, 46, 'paper');
    drawTips(ctx);
  }
  // JOHTO acts: the floors' time of day (run.timeOfDay) as faint bands behind the map, each block labelled once
  // (MORNING / DAY / NIGHT), the night ones darker with a few stars.
  drawTimeBands(ctx, run) {
    if (!run.timeOfDay?.(0)) return;
    const TINTS = { morn: ['#f8a060', 0.08], day: ['#f8f0c0', 0.04], nite: ['#000018', 0.45] };
    const floors = run.act.floors;
    for (let f = 0; f <= floors; f++) {
      const tod = run.timeOfDay(Math.min(f, floors - 1)), y = H - 40 - f * FLOOR_H + this.scroll;
      if (y < -FLOOR_H || y > H + FLOOR_H) continue;
      const [c, a] = TINTS[tod];
      ctx.save(); ctx.globalAlpha = a; rect(ctx, MAP_X0 - 12, y - FLOOR_H / 2, MAP_W + 24, FLOOR_H, c); ctx.restore();
      if (tod === 'nite') for (let k = 0; k < 4; k++) {
        const sx = MAP_X0 - 8 + ((f * 97 + k * 61) % (MAP_W + 16)), sy = y - FLOOR_H / 2 + ((f * 31 + k * 17) % FLOOR_H);
        ctx.save(); ctx.globalAlpha = 0.35 + 0.25 * Math.sin(this.t * 2 + f + k); rect(ctx, sx, sy, 1, 1, '#e8e8ff'); ctx.restore();
      }
      if (f < floors && (f === 0 || run.timeOfDay(f - 1) !== tod)) text(ctx, TIME_NAMES[tod], MAP_X0 - 9, y + FLOOR_H / 2 - 9, { color: tod === 'nite' ? '#8090d0' : tod === 'morn' ? '#e8a070' : '#c8c088', font: 'small' });
    }
  }
  canPick() { return !this.busy && !this.msg.active; }
  pickNode(n) { this.travel(n); }
  // The act map column (edges, nodes, the player). Returns the hovered node (any visible one, for its tooltip).
  drawMapColumn(ctx, run) {
    const act = run.act;
    ctx.save();
    pixBox(ctx, MAP_X0 - 14, 30, MAP_W + 28, H - 34, '#0e1622', '#2a3a50', 4);
    ctx.beginPath(); ctx.rect(MAP_X0 - 12, 32, MAP_W + 24, H - 38); ctx.clip();
    this.drawTimeBands(ctx, run);
    const rm = act.id === 5 ? 'gfx/ui/region_map/sevii_123_map_only.png' : 'gfx/ui/region_map/kanto_map_only.png';

    const nodes = run.map.nodes;
    const reach = new Set(this.busy ? [] : reachable(run.map, run.nodeId));
    const ahead = this.aheadOf(run); // every node still on a route from where the party stands
    this.drawEdges(ctx, run, ahead, this.nodeUnderMouse(nodes));
    // nodes
    let hovered = null;
    for (const n of Object.values(nodes)) {
      const [x, y] = this.nodePos(n);
      if (y < 10 || y > H + 20) continue;
      const isReach = reach.has(n.id);
      const visited = (run.visited || []).includes(n.id);
      // any visible node shows its tooltip on hover; only reachable ones light up and can be picked
      const over = !topOverlay() && hover(x - 14, y - 22, 28, 30) && inMap() && y > 32; // (not through an open dialog)
      const hot = isReach && over;
      if (over) hovered = n;
      this.drawNode(ctx, n, x, y, { reach: isReach, visited, hot, peek: over && !isReach, current: n.id === run.nodeId, off: !ahead.has(n.id) && !visited && !over });
      this.drawNodeExtras?.(ctx, n, x, y);
      if (hot && Engine.mouse.clicked && this.canPick() && !this.pen) this.pickNode(n);
    }
    // player
    const cur = run.nodeId ? nodes[run.nodeId] : null;
    let px, py, frame = 0, flip = false;
    if (this.walk) {
      // walking: interpolate in map coordinates (screen y = map y + scroll) so the camera scroll can't drag
      // the player back and forth, facing (and stepping) the way it goes: frames 1/5/6 up, 2/7/8 to the side
      const w = this.walk, k = w.o.k, dx = w.x1 - w.x0, dy = w.y1 - w.y0;
      px = w.x0 + dx * k; py = w.y0 + dy * k + this.scroll;
      const side = Math.abs(dx) > Math.abs(dy) * 1.2, step = Math.floor(this.t * 8) % 4;
      frame = side ? [2, 7, 2, 8][step] : dy <= 0 ? [1, 5, 1, 6][step] : [0, 3, 0, 4][step];
      flip = side && dx > 0;
    } else if (cur) { [px, py] = this.nodePos(cur); px += 12; }
    else { px = MAP_X0 + MAP_W / 2; py = H - 4 + this.scroll; }
    this.drawPlayer(ctx, Math.round(px), Math.round(py), frame, flip);
    // sketches on top: the partner's (co-op), then yours
    for (const o of this.otherSketches()) drawStrokes(ctx, o.strokes, o.color, this.scroll);
    drawStrokes(ctx, this.mySketch().strokes, this.sketchColor(), this.scroll);
    ctx.restore();
    return hovered;
  }
  // Nodes the party can still get to: everything after the current node (the whole map before the first step).
  aheadOf(run) {
    const nodes = run.map.nodes, out = new Set();
    const stack = run.nodeId ? [...(nodes[run.nodeId]?.next || [])] : [...run.map.start];
    while (stack.length) { const id = stack.pop(); if (out.has(id) || !nodes[id]) continue; out.add(id); stack.push(...nodes[id].next); }
    return out;
  }
  // The node under the pointer (same hit box as drawMapColumn's), without marking the cursor.
  nodeUnderMouse(nodes) {
    if (topOverlay() || !inMap()) return null;
    let found = null;
    for (const n of Object.values(nodes)) {
      const [x, y] = this.nodePos(n);
      if (y < 10 || y > H + 20 || y <= 32) continue;
      if (inRect(x - 14, y - 22, 28, 30)) found = n;
    }
    return found;
  }
  // Paths as FireRed-style trails of outlined square dots, drawn in layers so the ones that matter sit on top:
  //   dead   - can't be reached any more: faint, no outline
  //   past   - the trail already walked: dim blue
  //   ahead  - still on a route from here: bright
  //   next   - from the current node to the nodes you can pick now: gold, marching
  //   route  - every path from here to the hovered node: white on red, marching
  //   links  - a hovered node you can't reach any more: just its own links, light blue
  drawEdges(ctx, run, ahead, hov) {
    const nodes = run.map.nodes, cur = run.nodeId, visited = new Set(run.visited || []);
    if (hov && hov.id === cur) hov = null; // (hovering where you stand highlights nothing extra)
    const from = new Set(ahead); if (cur) from.add(cur);
    // the hovered node and everything that leads to it: the edges u->v with u in `from` and v in `to` make up its routes
    let to = null;
    if (hov && ahead.has(hov.id)) {
      to = new Set([hov.id]);
      const stack = [...hov.prev];
      while (stack.length) { const id = stack.pop(); if (to.has(id) || !nodes[id]) continue; to.add(id); stack.push(...nodes[id].prev); }
    }
    const layers = { dead: [], past: [], ahead: [], next: [], route: [], links: [] };
    for (const n of Object.values(nodes)) {
      const [x1, y1] = this.nodePos(n);
      for (const id of n.next) {
        const m = nodes[id];
        if (!m) continue;
        const [x2, y2] = this.nodePos(m);
        if ((y1 < 0 && y2 < 0) || (y1 > H + 40 && y2 > H + 40)) continue;
        const e = [x1, y1 - 6, x2, y2 + 6];
        if (to && from.has(n.id) && to.has(id)) layers.route.push(e);
        else if (hov && !to && (n.id === hov.id || id === hov.id)) layers.links.push(e);
        else if (n.id === cur && ahead.has(id)) layers.next.push(e);
        else if (from.has(n.id)) layers.ahead.push(e);
        else if (visited.has(n.id) && visited.has(id)) layers.past.push(e);
        else layers.dead.push(e);
      }
    }
    const march = (this.t * 12) % 7; // dots crawl toward the top of the map
    trail(ctx, layers.dead, '#34425a', null, 2, 7, 0);
    trail(ctx, layers.past, '#6f8fb8', '#0a0e16', 2, 5, 0);
    trail(ctx, layers.ahead, to ? '#6a7c9a' : '#a8b8d4', '#0a0e16', 3, 7, 0); // (dimmer while a route is shown)
    trail(ctx, layers.next, '#f8d038', '#3a2a00', 3, 7, march);
    trail(ctx, layers.links, '#98c0f0', '#0a0e16', 3, 6, 0);
    trail(ctx, layers.route, '#ffffff', '#c03028', 3, 6, (this.t * 12) % 6);
  }
  drawPlayer(ctx, px, py, frame, flip) { draw(ctx, 'gfx/overworld/people/red_normal.png', px - 8, py - 30, { sx: frame * 16, sy: 0, sw: 16, sh: 32, flip }); }
  drawNodeTip(hovered) {
    if (!hovered) return;
    const info = NODE_INFO[hovered.type];
    // above and right of the node, so the highlighted routes below it (toward you) stay visible
    const [nx, ny] = this.nodePos(hovered);
    const tip = (title, body, opts = {}) => showTip(title, body, { x: nx + 16, y: ny - (hovered.type === 'boss' ? 58 : 30), above: true, yBelow: ny + 8, ...opts });
    if (hovered.type === 'legend') {
      const run = this.mapRun(), L = LEGENDS[hovered.legend || run.act.bird];
      const caught = (run.legendsCaught || []).includes(L?.species);
      const lt = bossTypes(hovered.legend || run.act.bird);
      // co-op: the act's legendary and its trio partner together, one catch per player (coop.js legendPairConfig)
      const key2 = G.coop ? BIRD_PARTNER[hovered.legend || run.act.bird] : null, L2 = key2 ? LEGENDS[key2] : null;
      if (L && L2) {
        const lt2 = bossTypes(key2), had = [L, L2].filter(x => (run.legendsCaught || []).includes(x.species)).map(x => x.title);
        return tip(`${L.title} & ${L2.title}`, `Optional. Two legendary POKéMON at once, much tougher than an elite. Beat both for ${L.title}'s unique held item, then each player may catch one of them.${had.length ? ` (Already caught: ${had.join(', ')}.)` : ''}\nType: ${lt.join('/')} & ${lt2.join('/')}\nPRESSURE: every hand you play also costs a discard.`, { accent: TYPE_COLORS[lt[0]] });
      }
      return tip(L?.title || info.name, `${info.desc}${caught ? ' (Already caught this run.)' : ''}${lt.length ? `\nType: ${lt.join('/')}` : ''}\nPRESSURE: every hand you play also costs a discard.`, { accent: TYPE_COLORS[lt[0]] });
    }
    if (hovered.type === 'boss') return tip(this.bossTitle(), `${this.bossDesc()}\n${this.bossTypeLine()}`, { accent: TYPE_COLORS[this.mapRun().act.gauntlet ? null : bossTypes(this.mapRun().boss)[0]] });
    tip(info.name, info.desc);
  }
  // "Type: ROCK" (the ELITE FOUR: each member's, then the CHAMPION's)
  bossTypeLine() {
    const run = this.mapRun(), g = run.act.gauntlet;
    if (!g) return `Type: ${bossTypeLabel(run.boss)}`;
    return `Types: ${g.slice(0, 4).map(k => `${D.trainers[k]?.name || k} ${bossTypeLabel(k)}`).join(', ')}; CHAMPION ${bossTypeLabel(g[4])}`;
  }
  drawBanner(ctx, act) {
    if (!this.banner) return;
    ctx.save(); ctx.globalAlpha = this.banner.a;
    rect(ctx, 0, 140, W, 60, '#000000c0');
    text(ctx, actTitle(this.mapRun(), act), W / 2, 146, { align: 'center', color: 'gold', scale: 2 });
    text(ctx, act.name, W / 2, 178, { align: 'center', color: 'white' });
    ctx.restore();
  }
  bossTitle() {
    const run = this.mapRun();
    if (run.act.gauntlet) return 'ELITE FOUR';
    if (LEGENDS[run.boss]) return LEGENDS[run.boss].title;
    const t = D.trainers[run.boss];
    return t ? `${t.className} ${t.name}` : 'BOSS';
  }
  bossDesc() {
    const run = this.mapRun();
    if (run.act.gauntlet) return `${run.act.gauntlet.slice(0, 4).map(k => D.trainers[k]?.name).join(', ')} back to back, then the CHAMPION. Each has a rule of their own.`;
    const key = run.boss?.replace('LEADER_', '');
    const r = BOSS_RULES[key] || (LEGENDS[run.boss] ? BOSS_RULES.LEGEND : null);
    return r ? `${r.name}: ${r.desc}` : '';
  }
  drawRightPanel(ctx) {
    this.drawBossPanel(ctx);
    this.drawLegend(ctx);
  }
  drawBossPanel(ctx) {
    const run = this.mapRun();
    const x = 482, w = 154;
    panel(ctx, x, 32, w, 150);
    text(ctx, run.act.gauntlet ? regionOf(run.summitRegion).summit.place : 'BOSS', x + w / 2, 36, { align: 'center', color: 'white', font: 'small' });
    if (run.act.gauntlet) {
      run.act.gauntlet.slice(0, 4).forEach((k, i) => {
        const p = D.trainers[k]?.pic;
        if (p) drawPortrait(ctx, trainerPath(p), x + 6 + i * 36, 48, 34, 38);
        drawTypeTags(ctx, bossTypes(k), x + 7 + i * 36, 88);
      });
      text(ctx, 'ELITE FOUR', x + w / 2, 104, { align: 'center', color: 'gold' });
    } else if (LEGENDS[run.boss]) {
      import('./common.js').then(() => {});
      draw(ctx, `gfx/pokemon/${LEGENDS[run.boss].species.toLowerCase()}/front.png`, x + w / 2 - 32, 46);
      text(ctx, this.bossTitle(), x + w / 2, 112, { align: 'center', color: 'gold' });
    } else {
      const t = D.trainers[run.boss];
      if (t) drawPortrait(ctx, trainerPath(t.pic), x + w / 2 - 32, 46, 64, 64);
      text(ctx, this.bossTitle(), x + w / 2, 112, { align: 'center', color: 'gold', font: 'small' });
    }
    if (!run.act.gauntlet) {
      const ts = bossTypes(run.boss);
      text(ctx, 'TYPE', x + w - 22, 70, { align: 'center', color: 'gray', font: 'small' });
      if (ts.length > 1) ts.forEach((t, i) => drawTypeTags(ctx, [t], x + w - 38, 82 + i * 14));
      else drawTypeTags(ctx, ts, x + w - 38, 82);
    }
    textBlock(ctx, this.bossDesc(), x + 8, 126, w - 16, { color: 'whiteSoft', font: 'small', lineHeight: 10 });
  }
  drawLegend(ctx) {
    const run = this.mapRun();
    const x = 482, w = 154;
    // legend
    panel(ctx, x, 186, w, 132);
    const legend = [['wild', 'Wild POKéMON'], ['trainer', 'Trainer'], ['elite', 'Elite'], ['rival', 'Rival'], ['legend', 'Legendary (optional)'], ['event', 'Unknown'], ['center', 'POKéMON CENTER'], ['mart', 'POKé MART'], ['treasure', 'Item']];
    legend.forEach(([k, label], i) => {
      const ly = 190 + i * 14;
      this.drawNodeIcon(ctx, k, x + 16, ly + 12, true);
      text(ctx, label, x + 32, ly + 2, { color: 'white', font: 'small' });
    });
    text(ctx, `Seed ${run.seed}  ·  A${run.ascension}`, x + w / 2, 322, { align: 'center', color: 'gray', font: 'small' });
  }
  drawNodeIcon(ctx, type, x, y, small) {
    const col = NODE_COLORS[type];
    if (small) { pixBox(ctx, x - 6, y - 8, 12, 12, col, '#101018', 2); return; }
  }
  drawNode(ctx, n, x, y, st) {
    const col = NODE_COLORS[n.type];
    const pulse = st.reach ? (Math.sin(this.t * 6) * 0.5 + 0.5) : 0;
    ctx.save();
    if (st.visited && !st.current) ctx.globalAlpha = 0.45;
    else if (st.off) ctx.globalAlpha = 0.6; // no longer on any route from here
    // platform
    ctx.fillStyle = '#00000060'; ctx.beginPath(); ctx.ellipse(x, y + 2, 13, 5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = st.hot ? '#ffffff' : col; ctx.beginPath(); ctx.ellipse(x, y, 12, 5, 0, 0, Math.PI * 2); ctx.fill();
    if (st.reach) { ctx.strokeStyle = `rgba(248,208,56,${0.5 + pulse * 0.5})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(x, y, 14 + pulse * 2, 6 + pulse, 0, 0, Math.PI * 2); ctx.stroke(); }
    const run = this.mapRun();
    const seedIdx = (n.col * 7 + n.floor * 3) % TRAINER_SPRITES.length;
    const bob = st.hot || st.peek ? -2 : 0;
    switch (n.type) {
      case 'wild':
        draw(ctx, 'gfx/misc/field_effects/tall_grass.png', x - 12, y - 14 + bob, { sx: 0, sy: 0, sw: 16, sh: 16 });
        draw(ctx, 'gfx/misc/field_effects/tall_grass.png', x - 4, y - 14 + bob, { sx: 0, sy: 0, sw: 16, sh: 16 });
        draw(ctx, 'gfx/misc/field_effects/tall_grass.png', x - 8, y - 18 + bob, { sx: 0, sy: 0, sw: 16, sh: 16 });
        break;
      case 'trainer': { const sp = TRAINER_SPRITES[seedIdx], fw = sp === 'biker' ? 32 : 16; draw(ctx, `gfx/overworld/people/${sp}.png`, x - fw / 2, y - 28 + bob, { sx: 0, sy: 0, sw: fw, sh: 32 }); break; }
      case 'elite':
        draw(ctx, `gfx/overworld/people/${['cooltrainer_m', 'rocket_m', 'blue', 'cooltrainer_f'][seedIdx % 4]}.png`, x - 8, y - 28 + bob, { sx: 0, sy: 0, sw: 16, sh: 32 });
        draw(ctx, 'gfx/misc/emotes/exclamation.png', x - 8, y - 33 + bob + Math.sin(this.t * 5) * 1, { sx: 32, sy: 0, sw: 16, sh: 16 }); // frame 2 = the full ! balloon (0-1 are its pop-in)
        break;
      case 'rival': { // (HGSS walkers, 'hgss/...', have 32x32 frames; FireRed's are 16x32)
        const sp = regionOf(run.rivalRegion).rival.sprite, fw = sp.startsWith('hgss/') ? 32 : 16;
        draw(ctx, `gfx/overworld/people/${sp}.png`, x - fw / 2, y - 28 + bob, { sx: 0, sy: 0, sw: fw, sh: 32 });
        draw(ctx, 'gfx/misc/emotes/exclamation.png', x - 8, y - 33 + bob + Math.sin(this.t * 5) * 1, { sx: 32, sy: 0, sw: 16, sh: 16 }); // frame 2 = the full ! balloon (0-1 are its pop-in)
        break;
      }
      case 'legend': {
        // a golden aura, then the legendary itself (overworld sprite for the birds, party icon for the REGIS)
        const sp = (LEGENDS[n.legend || run.act.bird]?.species || 'ZAPDOS').toLowerCase();
        const glow = 0.35 + 0.25 * Math.sin(this.t * 4);
        ctx.fillStyle = `rgba(248,208,56,${glow})`; ctx.beginPath(); ctx.ellipse(x, y - 12, 16, 16, 0, 0, Math.PI * 2); ctx.fill();
        if (['zapdos', 'articuno', 'moltres'].includes(sp)) draw(ctx, `gfx/overworld/pokemon/${sp}.png`, x - 16, y - 32 + bob + Math.sin(this.t * 3) * 1.5, { sx: 0, sy: 0, sw: 32, sh: 32 });
        else drawIcon(ctx, sp.toUpperCase(), x - 16, y - 30 + bob);
        break;
      }
      case 'center': draw(ctx, 'gfx/overworld/people/nurse.png', x - 8, y - 28 + bob, { sx: 0, sy: 0, sw: 16, sh: 32 }); break;
      case 'mart': draw(ctx, 'gfx/overworld/people/clerk.png', x - 8, y - 28 + bob, { sx: 0, sy: 0, sw: 16, sh: 32 }); break;
      case 'event': draw(ctx, 'gfx/misc/emotes/question.png', x - 8, y - 20 + bob + Math.sin(this.t * 4 + n.col) * 1.5, { sx: 32, sy: 0, sw: 16, sh: 16 }); break;
      case 'treasure': draw(ctx, 'gfx/overworld/misc/item_ball.png', x - 8, y - 14 + bob); break;
      case 'boss': {
        const sp = run.act.gauntlet ? regionOf(run.summitRegion).summit.sprite : BOSS_SPRITE[run.boss];
        if (sp) draw(ctx, `gfx/overworld/people/${sp}.png`, x - 16, y - 58 + bob, { sx: 0, sy: 0, sw: 16, sh: 32, scale: 2 });
        else if (!LEGENDS[run.boss]) { const t = D.trainers[run.act.gauntlet ? run.act.gauntlet[0] : run.boss]; if (t) drawTrainer(ctx, t.pic, x - 32, y - 60 + bob); } // 1x, as tall as the Kanto bosses' 2x overworld sprites
        else if (LEGENDS[run.boss]) draw(ctx, `gfx/overworld/pokemon/${LEGENDS[run.boss].species.toLowerCase()}.png`, x - 16, y - 34 + bob, { sx: 0, sy: 0, sw: 32, sh: 32 });
        break;
      }
    }
    ctx.restore();
  }
  async travel(n) {
    const run = G.run;
    this.busy = true;
    Sound.playSE('se_select');
    const cur = run.nodeId ? run.map.nodes[run.nodeId] : null;
    // from where the player stands (right of its node, or the start below the map) to the same spot at n,
    // in map coordinates (screen y - scroll); the camera scrolls along on the same tween
    const [fx, fy] = cur ? this.nodePos(cur) : [MAP_X0 + MAP_W / 2 - 12, H - 4 + this.scroll];
    const [tx, ty] = this.nodePos(n);
    const scroll0 = this.scroll;
    const o = { k: 0 };
    this.walk = { x0: fx + 12, y0: fy - scroll0, x1: tx + 12, y1: ty - scroll0, o, scroll0, scroll1: Math.max(0, (n.floor + 1) * FLOOR_H - 140) };
    const dur = G.meta.settings.fast ? 0.3 : 0.6;
    await tween(o, { k: 1 }, dur, Ease.inOutQuad);
    this.scroll = this.walk.scroll1;
    this.walk = null;
    run.visited = [...(run.visited || []), n.id];
    if (['wild', 'trainer', 'elite', 'boss', 'rival', 'legend'].includes(n.type)) {
      if (n.type !== 'wild') Sound.playSE('se_pin');
      await wait(0.25);
    }
    enterNode(n.id);
  }
  reorder(mon) {
    const run = G.run;
    const i = run.party.indexOf(mon);
    if (i <= 0) return;
    run.party.splice(i, 1);
    run.party.unshift(mon);
    Sound.playSE('se_select');
    saveRun();
  }
}

export function inMap() { const m = Engine.mouse; return m.x > MAP_X0 - 14 && m.x < MAP_X0 + MAP_W + 14 && m.y > 30; }

// One layer of map trails: square dots (size px, every `gap` px along each edge, shifted by `phase` toward its
// upper end), each with a 1px outline. All outlines go down before any dot so neighbouring trails don't cut
// into each other. edges: [[x1, y1, x2, y2], ...], (x1, y1) the lower end.
export function trail(ctx, edges, color, outline, size, gap, phase) {
  if (!edges.length) return;
  const dots = [];
  for (const [x1, y1, x2, y2] of edges) {
    const len = Math.hypot(x2 - x1, y2 - y1);
    if (len < 1) continue;
    for (let d = phase % gap; d <= len; d += gap) {
      const t = d / len;
      dots.push(Math.round(x1 + (x2 - x1) * t - size / 2), Math.round(y1 + (y2 - y1) * t - size / 2));
    }
  }
  if (outline) {
    ctx.fillStyle = outline;
    for (let i = 0; i < dots.length; i += 2) ctx.fillRect(dots[i] - 1, dots[i + 1] - 1, size + 2, size + 2);
  }
  ctx.fillStyle = color;
  for (let i = 0; i < dots.length; i += 2) ctx.fillRect(dots[i], dots[i + 1], size, size);
}

export function sellRelicPrompt(key) {
  if (RELICS[key]?.curse) {
    pushOverlay(new ChoiceModal({ title: `${D.items[key]?.name} is a curse`, body: 'Nobody will buy a curse. A POKéMON CENTER can CLEANSE it for a fee.', options: [{ label: 'OK', value: 0 }] }));
    return;
  }
  import('../game/shop.js').then(({ sellRelicValue }) => {
    const v = sellRelicValue(key);
    pushOverlay(new ChoiceModal({
      title: `Sell ${D.items[key]?.name}?`, body: `You'll receive $${v}.`,
      options: [{ label: `Sell for $${v}`, value: 1, color: THEME.discard }, { label: 'Keep it', value: 0 }],
      onClose: (r) => { if (r === 1) { G.run.removeRelic(key); G.run.addMoney(v); Sound.playSE('se_shop'); saveRun(); } },
    }));
  });
}

export function openRunMenu() {
  pushOverlay(new ChoiceModal({
    title: 'MENU', body: `Seed ${G.run.seed} · ${regionOf(G.run.region).name} · A${G.run.ascension}`,
    options: [{ label: 'Resume', value: 0, color: THEME.green }, { label: 'Settings', value: 1, color: '#506080' }, { label: 'Save & quit to title', value: 2, color: THEME.play }, { label: 'Abandon run', value: 3, color: THEME.discard }],
    onClose: async (v) => {
      if (v === 1) { const { SettingsModal } = await import('./title.js'); pushOverlay(new SettingsModal({})); }
      if (v === 2) { saveRun(); const { TitleScene } = await import('./title.js'); setScene(new TitleScene()); }
      if (v === 3) pushOverlay(new ChoiceModal({ title: 'Really abandon this run?', options: [{ label: 'Yes, abandon', value: 1, color: THEME.discard }, { label: 'No', value: 0 }], onClose: async (c) => {
        if (c === 1) { const st = await import('../game/state.js'); st.endRun(G.run, 'lose'); const { TitleScene } = await import('./title.js'); setScene(new TitleScene()); }
      } }));
    },
  }));
}
