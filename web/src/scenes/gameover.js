// Act clear, game over, and Hall of Fame scenes.
import { Engine, W, H, setScene, wait, hover } from '../engine/core.js';
import { draw, trainerPath } from '../engine/assets.js';
import { text, textBlock, measure } from '../engine/font.js';
import { swirlBackground, BG_THEMES, button, panel, rect, drawTips, tip, THEME } from '../engine/ui.js';
import { burst, drawFx } from '../engine/fx.js';
import { D, TYPE_COLORS } from '../game/data.js';
import { G, saveRun, saveMeta, endRun, unlockShiny, SHINY_ASC } from '../game/state.js';
import { familyOf } from '../game/run.js';
import { regionOf, actTitle, actBosses, trainerName, trainerPic, orList, SPIRE, ruleKeyOf } from '../game/regions.js';
import { BOSS_RULES, bossTypes, bossTypeLabel } from '../game/bosses.js';
import { BADGES, badgeIcon } from '../game/items.js';
import { maxHp, isFainted, monName } from '../game/pokemon.js';
import { drawPortrait, drawTrainer, drawTypeTags, typeTagsWidth } from './common.js';
import { Sound } from '../audio/sound.js';
import { drawMon, drawIcon, drawHUD, drawPartyPanel } from './common.js';
import { nextAct, startGauntletBattle, badgeForBoss } from './flow.js';
import { TitleScene } from './title.js';
import { offerStarterUnlock } from './unlock.js';
import { soloActKey, grantAscension } from '../game/unlocks.js';
import { cloudStatusLine } from './records.js';

function statsLines(run) {
  const s = run.stats;
  const mins = Math.round((Date.now() - (s.startTime || Date.now())) / 60000);
  return [
    `Floors climbed: ${s.floors}`, `Battles won: ${s.battles}`, `Trainers defeated: ${s.trainers}`, `POKéMON caught: ${s.caught}`,
    `Best hand: ${(s.bestHand || 0).toLocaleString()} damage`, `Critical hits: ${s.crits || 0}`, `Money earned: $${(s.moneyEarned || 0).toLocaleString()}`, `Time: ${mins} min`,
  ];
}

// A boss's shown title: CHAMPION LANCE, PKMN TRAINER RED (JOHTO); plain names for everyone else.
function bossTitle(key) {
  const t = D.trainers[key];
  if (!t) return trainerName(key);
  return t.champion ? `CHAMPION ${t.name}` : t.class === 'CHAMPION' && t.className ? `${t.className} ${t.name}` : trainerName(key);
}

export class ActClearScene {
  constructor(opts) { this.opts = opts; }
  enter() {
    this.t = 0;
    const run = G.run;
    if (this.opts.gauntletBreak && !this.opts.noHeal) {
      for (const m of run.party) if (!isFainted(m)) m.hp = Math.min(maxHp(m), m.hp + Math.floor(maxHp(m) * 0.5));
      saveRun();
    }
    Sound.playBGM(this.opts.gauntletBreak ? 'mus_victory_road' : 'mus_obtain_badge');
    if (!this.opts.gauntletBreak && !G.coop) offerStarterUnlock(soloActKey(run)); // act cleared: pick a new starter
  }
  update(dt) { this.t += dt; if (Math.random() < 0.2) burst(Math.random() * W, -5, { color: ['#f8d038', '#fff', '#ff8080', '#80c0ff'], n: 1, speed: 20, grav: 60, life: 3, angle: Math.PI / 2, spread: 0.5 }); }
  draw(ctx) {
    const run = G.run;
    swirlBackground(ctx, BG_THEMES.gold, 0.8);
    drawHUD(ctx, run);
    if (this.opts.gauntletBreak) {
      const key = run.act.gauntlet[this.opts.next];
      const tk = key === 'CHAMPION_FIRST' ? 'CHAMPION_FIRST_SQUIRTLE' : key;
      const names = { [key]: key === 'CHAMPION_FIRST' ? (run.rivalRegion === 'kanto' ? 'YOUR RIVAL' : 'CHAMPION BLUE') : key === 'RS_CHAMPION' ? 'CHAMPION WALLACE' : bossTitle(tk) };
      const pics = { [key]: D.trainers[tk]?.pic };
      text(ctx, 'ON TO THE NEXT ROOM', W / 2, 50, { align: 'center', color: 'gold', scale: 2 });
      drawTrainer(ctx, pics[key], W / 2 - 64, 100, { scale: 2, minTop: 70 });
      // the next room's name, then its type
      const nextLine = `Next: ${names[key]}`, ts = bossTypes(key), lw = measure(nextLine), tw = typeTagsWidth(ts), lx = W / 2 - (lw + 8 + tw) / 2;
      text(ctx, nextLine, lx, 240, { color: 'white' });
      drawTypeTags(ctx, ts, lx + lw + 8, 242);
      text(ctx, `Your team caught its breath (+50% HP).`, W / 2, 258, { align: 'center', color: 'whiteSoft', font: 'small' });
      this.drawReorder(ctx, run);
      // Co-op (the 'plateau' private phase, scenes/coop/session.js): the game already healed both teams; READY hands
      // this player's run (new order and purchases included) back with privateDone, and the next room starts once
      // everyone is ready. The order travels in the run snapshot, so it needs no game-logic change.
      const coop = this.opts.coop && G.coop;
      if (button(ctx, coop ? 'READY' : 'ENTER', W / 2 + 10, 290, 140, 30, { color: THEME.discard })) {
        if (coop) G.coop.privateDone(); else startGauntletBattle();
      }
      if (button(ctx, 'PLATEAU MART', W / 2 - 150, 290, 140, 30, { color: '#f08830' })) {
        const next = this.opts.next, opts = this.opts;
        const wrap = (sc) => (coop && G.coop?.wrap ? G.coop.wrap(sc) : sc); // (co-op: keep the partner banner)
        const back = () => setScene(wrap(new ActClearScene({ ...opts, noHeal: true })));
        import('./shop.js').then(m => setScene(wrap(new m.ShopScene({ key: opts.martKey || 'plateau' + next, onLeave: back }))));
      }
      drawFx(ctx, Engine.dt);
      return;
    }
    text(ctx, `${actTitle(run)} CLEAR!`, W / 2, 46, { align: 'center', color: 'gold', scale: 2 });
    const badge = badgeForBoss(this.opts.boss);
    if (badge) {
      draw(ctx, badgeIcon(badge), W / 2 - 16, 86, { scale: 2 });
      text(ctx, BADGES[badge].name, W / 2, 124, { align: 'center', color: 'white' });
      text(ctx, BADGES[badge].desc, W / 2, 140, { align: 'center', color: 'whiteSoft', font: 'small' });
    }
    run.party.forEach((m, i) => drawMon(ctx, m.species, W / 2 - run.party.length * 34 + i * 68, 160 + Math.sin(this.t * 3 + i) * 3, { shiny: m.shiny }));
    const next = run.acts[run.actIndex + 1];
    if (next && !next.postgame) {
      text(ctx, `Next: ${actTitle(run, next)} — ${next.name}`, W / 2, 234, { align: 'center', color: 'white' });
      this.drawPreview(ctx, run, next);
      text(ctx, 'Your team is fully healed for the journey ahead.', W / 2, 266, { align: 'center', color: 'whiteSoft', font: 'small' });
      if (button(ctx, 'CONTINUE', W / 2 - 70, 290, 140, 30, { color: THEME.green })) nextAct();
    } else {
      if (button(ctx, 'CONTINUE', W / 2 - 70, 290, 140, 30, { color: THEME.green })) { endRun(run, 'win'); setScene(new TitleScene()); }
    }
    drawFx(ctx, Engine.dt);
    drawTips(ctx);
  }
  // Between ELITE FOUR rooms: reorder the team (click a POKéMON to make it the lead, arrows move it up/down).
  drawReorder(ctx, run) {
    const x = 8, y = 48, w = 146, rowH = 30, party = run.party;
    const move = (i, j) => { [party[i], party[j]] = [party[j], party[i]]; Sound.playSE('se_select'); saveRun(); };
    const clickedMon = drawPartyPanel(ctx, run, x, y, w, { tipX: 186, leadUid: party[0]?.uid });
    let moved = false;
    party.forEach((mon, i) => {
      const ry = y + i * rowH;
      if (i > 0 && this.arrowBtn(ctx, x + w + 4, ry, -1) && !moved) { move(i, i - 1); moved = true; }
      if (i < party.length - 1 && this.arrowBtn(ctx, x + w + 4, ry + 14, 1) && !moved) { move(i, i + 1); moved = true; }
    });
    if (clickedMon && !moved) {
      const i = party.indexOf(clickedMon);
      if (i > 0) { party.splice(i, 1); party.unshift(clickedMon); Sound.playSE('se_select'); saveRun(); }
    }
    text(ctx, 'Click to set lead', x + w / 2, y + 4 + rowH * party.length, { align: 'center', color: 'gray', font: 'small' });
    text(ctx, 'Arrows: reorder', x + w / 2, y + 16 + rowH * party.length, { align: 'center', color: 'gray', font: 'small' });
    drawTips(ctx);
  }
  // A small up (-1) / down (+1) arrow button; the triangle is drawn in pixels (the font has no arrow glyphs).
  arrowBtn(ctx, x, y, dir) {
    const hit = button(ctx, '', x, y, 16, 13, { color: '#506080' });
    for (let r = 0; r < 4; r++) {
      const wd = dir < 0 ? 1 + r * 2 : 7 - r * 2;
      rect(ctx, x + 8 - Math.ceil(wd / 2), y + 4 + r, wd, 1, '#f8f8f8');
    }
    return hit;
  }

  // One Spire: what the next act holds, so you can plan for it (its region's GYM LEADERS, or the ELITE FOUR).
  drawPreview(ctx, run, next) {
    const leaders = next.gauntlet ? next.gauntlet : actBosses(next);
    if (!leaders.length) return;
    // (a post-game act can end with someone who isn't a GYM LEADER: JOHTO's PKMN TRAINER RED)
    const others = !next.gauntlet && leaders.every(k => D.trainers[k] && D.trainers[k].class !== 'LEADER');
    const line = next.gauntlet
      ? `Then the ${regionOf(next.summit || next.region).name} ELITE FOUR: ${next.gauntlet.slice(0, 4).map(trainerName).join(', ')} and the CHAMPION`
      : others ? `AT THE TOP: ${orList(leaders.map(bossTitle))}` : `GYM LEADER: ${orList(leaders.map(trainerName))}`;
    text(ctx, line, W / 2, 249, { align: 'center', color: 'gold', font: 'small' });
    // portraits on the right, above the party
    const n = Math.min(5, leaders.length), pw = 30, ph = 34, x0 = W - 12 - n * (pw + 2), y0 = 62;
    panel(ctx, x0 - 6, y0 - 14, n * (pw + 2) + 10, ph + 22);
    text(ctx, next.gauntlet ? 'NEXT: ELITE FOUR' : others ? 'NEXT BOSS' : 'NEXT GYM', x0 - 6 + (n * (pw + 2) + 10) / 2, y0 - 11, { align: 'center', color: 'white', font: 'small' });
    leaders.slice(0, n).forEach((k, i) => {
      const p = k === 'CHAMPION_FIRST' ? null : trainerPic(k);
      const x = x0 + i * (pw + 2);
      if (p) drawPortrait(ctx, trainerPath(p), x, y0, pw, ph);
      else text(ctx, '?', x + pw / 2, y0 + 10, { align: 'center', color: 'gold' });
      // a strip in the boss's type colour(s) under the portrait (grey: mixed)
      const ts = bossTypes(k);
      if (!ts.length) rect(ctx, x, y0 + ph + 1, pw, 3, '#808890');
      ts.forEach((t, j) => rect(ctx, x + Math.round(j * pw / ts.length), y0 + ph + 1, Math.round(pw / ts.length), 3, TYPE_COLORS[t] || '#888'));
      if (hover(x, y0, pw, ph)) {
        const r = BOSS_RULES[ruleKeyOf(k)] || (k === 'RS_CHAMPION' ? BOSS_RULES.WALLACE_CHAMPION : null);
        tip(bossTitle(k), `${r ? `${r.name}: ${r.desc}` : 'The CHAMPION.'}\nType: ${bossTypeLabel(k)}`, { accent: TYPE_COLORS[ts[0]] });
      }
    });
  }
}

export class GameOverScene {
  enter() { this.t = 0; Sound.stopBGM(); setTimeout(() => Sound.playBGM('mus_slow_pallet'), 800); }
  update(dt) { this.t += dt; }
  draw(ctx) {
    const run = G.run;
    swirlBackground(ctx, BG_THEMES.dark, 0.3);
    text(ctx, 'YOU BLACKED OUT!', W / 2, 40, { align: 'center', color: 'red', scale: 2 });
    text(ctx, `${actTitle(run)}, floor ${Math.max(1, run.floor + 1)} · ${D.species[run.starter].name} · A${run.ascension} · seed ${run.seed}`, W / 2, 76, { align: 'center', color: 'gray', font: 'small' });
    run.party.forEach((m, i) => drawMon(ctx, m.species, W / 2 - run.party.length * 34 + i * 68, 92, { shiny: m.shiny, alpha: 0.6 }));
    panel(ctx, W / 2 - 150, 170, 300, 120);
    statsLines(run).forEach((l, i) => text(ctx, l, W / 2 - 138 + (i % 2) * 150, 180 + Math.floor(i / 2) * 24, { color: 'white', font: 'small' }));
    const cloud = cloudStatusLine();
    if (cloud) text(ctx, cloud[0], W / 2, 276, { align: 'center', color: cloud[1], font: 'small' });
    if (button(ctx, 'TITLE SCREEN', W / 2 - 80, 304, 160, 28, { color: THEME.play })) setScene(new TitleScene());
  }
}

export class VictoryScene {
  constructor(opts = {}) { this.opts = opts; }
  enter() {
    this.t = 0; this.k = 0;
    Sound.playBGM('mus_hall_of_fame');
    if (!G.coop && G.run) offerStarterUnlock(soloActKey(G.run)); // champion (act 4) or post-game cleared
    if (!this.opts.postgame) {
      // Champion! Record the win now; the player may continue into the post-game.
      const m = G.meta;
      m.unlocks.win = true;
    }
    const run = G.run;
    // The next ascension opens for this starter only (granted here so leaving now can't lose it).
    if (run && !G.coop && !this.opts.postgame) {
      this.ascNew = grantAscension(G.meta, run.starter, run.ascension);
      this.ascNext = Math.min(10, run.ascension + 1);
      if (this.ascNew) saveMeta();
    }
    // A win at A5+ unlocks the starter's shiny form (shown here even if it was unlocked before).
    if (run && !G.coop && run.ascension >= SHINY_ASC) {
      this.shinyNew = !!unlockShiny(run);
      this.shiny = familyOf(run.starter);
      if (this.shinyNew) saveMeta();
    }
  }
  update(dt) { this.t += dt; if (Math.random() < 0.35) burst(Math.random() * W, -5, { color: ['#f8d038', '#fff', '#ff8080', '#80c0ff', '#80ff80'], n: 1, speed: 20, grav: 50, life: 4, angle: Math.PI / 2, spread: 0.4 }); }
  draw(ctx) {
    const run = G.run;
    swirlBackground(ctx, ['#202060', '#4040a0', '#303080'], 0.6);
    draw(ctx, 'gfx/misc/hall_of_fame/bg.png', 80, 0, { scale: 2, alpha: 0.35 });
    const pg = regionOf(run.act?.postgame ? run.act.region : 'kanto').postgame;
    text(ctx, this.opts.postgame ? pg.title : 'HALL OF FAME', W / 2, 20, { align: 'center', color: 'gold', scale: 2 });
    text(ctx, this.opts.postgame ? pg.line : `Welcome to the HALL OF FAME, CHAMPION! (A${run.ascension})`, W / 2, 54, { align: 'center', color: 'white' });
    if (this.shiny) text(ctx, `SHINY ${D.species[this.shiny]?.name || this.shiny} ${this.shinyNew ? 'UNLOCKED!' : 'is yours!'} Pick it on the starter screen.`, W / 2, 68, { align: 'center', color: 'gold', font: 'small' });
    if (this.ascNew) text(ctx, `ASCENSION ${this.ascNext} UNLOCKED for ${D.species[run.starter]?.name || run.starter}! (each starter unlocks its own)`, W / 2, 168, { align: 'center', color: 'lime', font: 'small' });
    const n = run.party.length;
    run.party.forEach((m, i) => {
      const x = W / 2 - n * 50 + i * 100 + 18;
      drawMon(ctx, m.species, x, 80 + Math.sin(this.t * 2 + i) * 4, { shiny: m.shiny });
      text(ctx, monName(m), x + 32, 148, { align: 'center', color: 'white', font: 'small' });
      text(ctx, 'Lv' + m.level, x + 32, 160, { align: 'center', color: 'gold', font: 'small' });
    });
    panel(ctx, W / 2 - 160, 180, 320, 104);
    statsLines(run).forEach((l, i) => text(ctx, l, W / 2 - 148 + (i % 2) * 160, 188 + Math.floor(i / 2) * 22, { color: 'white', font: 'small' }));
    if (this.opts.postgame) {
      if (button(ctx, 'TITLE SCREEN', W / 2 - 80, 300, 160, 28, { color: THEME.play })) setScene(new TitleScene());
    } else {
      if (button(ctx, 'CONTINUE TO ' + (run.acts[run.actIndex + 1]?.name || 'POST-GAME'), W / 2 - 200, 296, 190, 30, { color: THEME.green, sub: null })) {
        G.meta.unlocks.win = true;
        // Count the championship win, then continue the same run into the post-game act.
        const m = G.meta; m.totalWins++; m.bestAscensionWon = Math.max(m.bestAscensionWon, run.ascension); m.maxAscension = Math.max(m.maxAscension, Math.min(10, run.ascension + 1));
        grantAscension(m, run.starter, run.ascension); // the next level opens for this starter only
        if (run.ascension >= 5) m.unlocks.a5 = true;
        import('../game/state.js').then(s => { s.recordDex(run); s.saveMeta(); });
        run.postgame = true;
        nextAct();
      }
      if (button(ctx, 'RETIRE AS CHAMPION', W / 2 + 10, 296, 190, 30, { color: THEME.play })) { endRun(run, 'win'); setScene(new TitleScene()); }
    }
    drawFx(ctx, Engine.dt);
    drawTips(ctx);
  }
}

// Not part of a run: NOW PLAYING (net/presence.js) does not list you here.
GameOverScene.prototype.idle = true; VictoryScene.prototype.idle = true;
