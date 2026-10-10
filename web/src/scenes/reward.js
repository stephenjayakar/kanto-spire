// Post-battle rewards (StS style list) + EXP/level-up/evolution processing.
import { Engine, W, H, hover, clicked, pushOverlay, popOverlay, topOverlay, tween, wait, keyPressed } from '../engine/core.js';
import { draw, itemPath } from '../engine/assets.js';
import { text, textBlock, measure, textFit } from '../engine/font.js';
import { swirlBackground, BG_THEMES, button, panel, pixBox, rect, drawTips, tip, THEME, hpBar } from '../engine/ui.js';
import { burst, floatText, drawFx } from '../engine/fx.js';
import { D, TYPE_COLORS, speciesName } from '../game/data.js';
import { maxHp, monName, teachMove, evolve, isFainted, expProgress, knowsMove, movesLearnedAt, replacedCopies } from '../game/pokemon.js';
import { RELICS, BADGES, CONSUMABLES, badgeIcon } from '../game/items.js';
import { G, saveRun } from '../game/state.js';
import { TUNING } from '../game/run.js';
import { Sound } from '../audio/sound.js';
import { drawHUD, drawCard, fakeInfo, cardTooltip, drawMon, drawIcon, CARD_W, CARD_H, Modal, ChoiceModal, PartyPicker, MoveReplaceModal, monTooltip, consumableDesc, drawMiniCard } from './common.js';
import { afterRewards, badgeForBoss } from './flow.js';

export class RewardScene {
  constructor(battle, cfg, extra = {}) { this.battle = battle; this.cfg = cfg; this.extra = extra; }
  enter() {
    const run = G.run, b = this.battle, cfg = this.cfg;
    this.t = 0;
    this.result = run.afterBattle(b);
    if (cfg.moneyMult && this.result.moneyFinal) { const extraM = Math.floor(this.result.moneyFinal * (cfg.moneyMult - 1)); run.addMoney(extraM); this.result.moneyFinal += extraM; }
    this.before = run.party.map(m => ({ uid: m.uid, level: m.level, exp: expProgress(m) }));
    this.expResults = run.distributeExp(b.result, b.kind);
    this.expAnim = 0;
    this.busy = true;
    const rng = run.rng.fork('reward' + run.stats.battles);
    this.rewards = [];
    if (this.result.moneyFinal) this.rewards.push({ kind: 'money', amount: this.result.moneyFinal + (this.result.interest || 0), auto: true, claimed: true, label: `$${this.result.moneyFinal}${this.result.interest ? ` (+$${this.result.interest} interest)` : ''}` });
    for (const m of this.result.released || []) this.rewards.push({ kind: 'lost', mon: m, auto: true, claimed: true, label: `NUZLOCKE: ${monName(m)} was released.` });
    if (this.result.newMon) this.rewards.push({ kind: 'mon', mon: this.result.newMon, label: `${speciesName(this.result.newMon.species)} joins your team!` });
    // Legendary bird node: a one-time chance to catch it (co-op: two legendaries, catch one of them).
    const legendMons = b.result.outcome === 'win' && (cfg.catchOffer || cfg.catchOffers) ? run.legendCatches(cfg) : [];
    if (legendMons.length === 1) this.rewards.push({ kind: 'legend', mon: legendMons[0], label: `${speciesName(legendMons[0].species)} is watching you. Catch it? (Lv${legendMons[0].level})` });
    else if (legendMons.length > 1) this.rewards.push({ kind: 'legend', mon: legendMons[0], mons: legendMons, label: `${legendMons.map(m => speciesName(m.species)).join(' and ')} are watching you. Catch one? (Lv${legendMons[0].level})` });
    // ONE LEGENDARY PER RUN (v0.3.25): no catch once you have one, and the screen says why
    const offers = b.result.outcome === 'win' ? run.legendOffers(cfg) : [];
    if (!legendMons.length && offers.length && run.hasLegendary?.()) this.rewards.push({ kind: 'legendNote', mon: { species: offers[0].species }, auto: true, claimed: true, label: `${offers.map(o => speciesName(o.species)).join(' and ')} ${offers.length > 1 ? 'are' : 'is'} watching. You already have a legendary this run.` });
    if (cfg.kind === 'boss' && !cfg.gauntlet && !cfg.legendBoss) {
      const badge = badgeForBoss(run.boss);
      if (badge && !run.badges.includes(badge)) this.rewards.push({ kind: 'badge', badge, label: BADGES[badge].name });
    }
    if (cfg.kind === 'trainer' || cfg.kind === 'elite' || cfg.kind === 'boss' || (cfg.kind === 'wild' && rng.chance(0.35))) {
      const moves = run.moveRewardChoices(rng, 3);
      if (moves.length) this.rewards.push({ kind: 'moves', choices: moves, label: 'Teach a new move' });
    }
    const relicOdds = TUNING.relicOdds[cfg.kind] ?? 0;
    const won = b.result.outcome === 'win' || b.result.outcome === 'caught';
    if (cfg.rewardRelic || (cfg.rewardRelicW && won) || cfg.rival || (!cfg.chainNext && (cfg.kind === 'elite' || cfg.kind === 'boss') && rng.chance(relicOdds))) { // (a gauntlet's prize comes after its last fight)
      // rival: always a held item, rarer than an elite's (between an elite and a GYM LEADER); "?" event battles
      // may promise a held item choice with their own rarity weights (cfg.rewardRelicW)
      const w = cfg.rewardRelicW || (cfg.kind === 'boss' ? { common: 0, uncommon: 55, rare: 45 } : cfg.rival ? { common: 10, uncommon: 55, rare: 35 } : { common: 20, uncommon: 55, rare: 25 });
      let choices = run.relicChoices(rng, 3 + (cfg.kind === 'elite' ? (run.mods().eliteChoices || 0) : 0), w);
      if (cfg.rewardRelic && !run.hasRelic(cfg.rewardRelic)) choices = [cfg.rewardRelic];
      if (choices.length) this.rewards.push({ kind: 'relic', choices, label: 'Choose a held item (no limit on held items)' });
    }
    // "?" event battle prizes: items (NUGGET, MASTER BALL, a vitamin) and a POKéMON to pick (the DOJO's HITMONs)
    if (won) for (const k of cfg.rewardItems || []) this.rewards.push({ kind: 'item', key: k, label: 'Prize:' });
    if (won && cfg.rewardMons?.length) this.rewards.push({ kind: 'monPick', mons: cfg.rewardMons, label: 'Choose a POKéMON to join you' });
    const dropChance = cfg.rival ? 1 : { wild: 0.3, trainer: 0.45, elite: 0.8, boss: 1 }[cfg.kind] ?? 0.3;
    if (rng.chance(dropChance)) this.rewards.push({ kind: 'item', key: run.randomConsumable(rng), label: '' });
    if (cfg.kind === 'boss') this.rewards.push({ kind: 'item', key: rng.pick(['RARE_CANDY', 'PP_UP', 'HP_UP', 'PROTEIN', 'IRON', 'CALCIUM', 'ZINC']), label: '' });
    const mods = run.mods();
    if (mods.itemfinder && rng.chance(0.3)) this.rewards.push({ kind: 'item', key: run.randomConsumable(rng), label: 'ITEMFINDER found:' });
    if (mods.berryPouch && rng.chance(0.4)) this.rewards.push({ kind: 'item', key: run.randomBerry(rng), label: 'BERRY POUCH:' });
    const seenItems = new Set();
    this.rewards = this.rewards.filter(r => r.kind !== 'item' || (!seenItems.has(r.key) && seenItems.add(r.key)));
    for (const r of this.rewards) if (r.kind === 'item') r.label = (r.label ? r.label + ' ' : '') + (D.items[r.key]?.name || r.key) + (CONSUMABLES[r.key]?.combo ? ` (${CONSUMABLES[r.key].combo.replace('_', ' ')} +1 lvl)` : '');
    Sound.playBGM(cfg.kind === 'boss' ? 'mus_victory_gym_leader' : cfg.kind === 'wild' ? 'mus_victory_wild' : 'mus_victory_trainer');
    // The battle is over and paid out: reloading now must not replay it (and pay again). Bosses keep
    // inNode so a reload re-enters the boss instead of a dead-end map node.
    if (cfg.kind !== 'boss') run.inNode = false;
    saveRun();
    this.animateExp();
  }

  async animateExp() {
    // (busy is always released: an error here must not leave the rewards unclickable)
    try {
      const o = { k: 0 };
      if (this.expResults.length) { Sound.playSE('se_exp'); await tween(o, { k: 1 }, G.meta.settings.fast ? 0.4 : 1.0); }
      this.expAnim = 1;
      const leveled = this.expResults.filter(r => r.events.some(e => e.type === 'level'));
      if (leveled.length) { await Sound.playFanfare('mus_level_up'); }
      // learn moves / evolve
      await processLevelEvents(this.expResults);
      // auto-claim caught mon if room
      const monR = this.rewards.find(r => r.kind === 'mon');
      if (monR) await this.claim(monR);
    } catch (err) { console.error('rewards', err); }
    this.expAnim = 1;
    this.busy = false;
    saveRun();
  }

  update(dt) { this.t += dt; }

  async claim(r) {
    const run = G.run;
    if (r.claimed) return;
    switch (r.kind) {
      case 'mon': {
        if (run.addToParty(r.mon)) { r.claimed = true; Sound.playCry(r.mon.species); }
        else {
          const rel = await pick(new PartyPicker({ title: 'Party full! Release a POKéMON to make room?', sub: () => 'Release', cancelable: true }));
          if (rel) { run.party.splice(run.party.indexOf(rel), 1, r.mon); r.claimed = true; Sound.playCry(r.mon.species); }
          else { r.claimed = true; r.label += ' (sent to PC)'; }
        }
        break;
      }
      case 'legend': {
        if (r.mons?.length > 1) {
          // co-op: two legendaries, one catch (letting them go uses up the act's own legendary, like solo)
          const names = r.mons.map(m => speciesName(m.species));
          const v = await pick(new ChoiceModal({
            title: 'Catch which one?',
            body: `One time only: catch ${names.join(' or ')} (Lv${r.mon.level}, with its own deck). The other one flies away. Every player gets their own pick (the same one is fine).\n${run.legendRuleText()}`,
            options: [...r.mons.map((m, i) => ({ label: `Catch ${names[i]}!`, value: i + 1, color: THEME.green, tip: `${(D.species[m.species]?.types || []).join('/')}  ·  Lv${m.level}\nDeck: ${m.moves.map(x => D.moves[x.move]?.name || x.move).join(', ')}` })), { label: 'Let them go', value: 0, color: THEME.discard }],
            cancelable: false,
          }));
          if (!v) { run.takeLegend(r.mon, false); r.claimed = true; r.label = `${names.join(' and ')} flew away.`; break; }
          r.mon = r.mons[v - 1];
          r.mons = null;
        }
        const name = speciesName(r.mon.species);
        const v = r.mons === null ? 1 : await pick(new ChoiceModal({
          title: `Catch ${name}?`,
          body: `One time only: ${name} joins your party at Lv${r.mon.level} with its own deck. If you let it go, it leaves for good.\n${run.legendRuleText()} No other legendary will join you after it.`,
          options: [{ label: `Catch ${name}!`, value: 1, color: THEME.green }, { label: 'Let it go', value: 0, color: THEME.discard }],
          cancelable: false,
        }));
        if (v !== 1) { run.takeLegend(r.mon, false); r.claimed = true; r.label = `${name} flew away.`; break; }
        run.takeLegend(r.mon, true);
        Sound.playSE('se_ball_throw');
        if (run.addToParty(r.mon)) { r.claimed = true; r.label = `Gotcha! ${name} joined your team!`; Sound.playCry(r.mon.species); Sound.playBGM('mus_caught'); }
        else {
          const rel = await pick(new PartyPicker({ title: `Party full! Release a POKéMON to make room for ${name}?`, sub: () => 'Release', cancelable: true }));
          if (rel) { run.party.splice(run.party.indexOf(rel), 1, r.mon); r.claimed = true; r.label = `Gotcha! ${name} joined your team!`; Sound.playCry(r.mon.species); }
          else { r.claimed = true; r.label = `${name} was sent to the PC (gone for this run).`; }
        }
        break;
      }
      case 'monPick': {
        const { MonChoiceModal } = await import('./event.js');
        const m = await pick(new MonChoiceModal({ title: 'Choose a POKéMON', mons: r.mons }));
        if (!m) break;
        r.mon = m; r.kind = 'mon'; r.label = `${speciesName(m.species)} joins your team!`;
        run.addSeen(m.species, true);
        if (run.addToParty(m)) { r.claimed = true; Sound.playCry(m.species); }
        else {
          const rel = await pick(new PartyPicker({ title: 'Party full! Release a POKéMON to make room?', sub: () => 'Release', cancelable: true }));
          if (rel) { run.party.splice(run.party.indexOf(rel), 1, m); r.claimed = true; Sound.playCry(m.species); }
          else { r.claimed = true; r.label += ' (sent to PC)'; }
        }
        break;
      }
      case 'badge':
        run.badges.push(r.badge); r.claimed = true;
        Sound.playFanfare('mus_obtain_badge');
        break;
      case 'item':
        if (CONSUMABLES[r.key]?.combo) { run.applyConsumableToMon(r.key, null); r.claimed = true; Sound.playFanfare('mus_obtain_item'); this.toast = { text: `${CONSUMABLES[r.key].combo.replace('_', ' ')} is now level ${run.comboLevels[CONSUMABLES[r.key].combo]}!`, t: 2.5, good: true }; }
        else if (run.addConsumable(r.key)) { r.claimed = true; Sound.playSE('se_use_item'); }
        else {
          // full BAG: use it now, make room, or leave it (it stays on the list until you continue)
          if (this.offering) break;
          this.offering = true;
          let res = 'left';
          try { const { offerItem } = await import('./items_ui.js'); res = await offerItem(r.key); }
          finally { this.offering = false; }
          if (res === 'stored') r.claimed = true;
          else if (res === 'used') { r.claimed = true; r.label += ' (used)'; }
          else this.toast = { text: 'Left it for now. Tap it again to make room for it.', t: 3 };
        }
        break;
      case 'relic': {
        r.choices = r.choices.filter(k => !run.hasRelic(k));
        if (!r.choices.length) { r.claimed = true; r.label += ' (already owned)'; break; }
        const v = await pick(new RelicChoiceModal({ choices: r.choices }));
        run.logEvent({ k: 'pick', what: 'relic', took: v || null, from: r.choices });
        if (v) {
          run.addRelic(v); r.claimed = true; Sound.playFanfare('mus_obtain_item');
        }
        break;
      }
      case 'moves': {
        const v = await pick(new MoveChoiceModal({ choices: r.choices }));
        run.logEvent({ k: 'pick', what: 'move', took: v ? `${run.party.find(m => m.uid === v.uid)?.species}:${v.move}` : null, from: r.choices.map(c => c.move) });
        if (v) {
          const mon = run.party.find(m => m.uid === v.uid);
          if (await learnMove(mon, v.move)) { r.claimed = true; }
        } else { r.claimed = true; r.label += ' (skipped)'; }
        break;
      }
    }
    saveRun();
  }

  draw(ctx) {
    const run = G.run;
    swirlBackground(ctx, BG_THEMES.gold, 0.5);
    drawHUD(ctx, run, { onConsumableClick: (k) => import('./items_ui.js').then(m => m.useConsumableOutside(k)) });
    // left: party EXP
    panel(ctx, 6, 32, 250, 40 + run.party.length * 44);
    text(ctx, 'EXPERIENCE', 131, 38, { align: 'center', color: 'white' });
    run.party.forEach((m, i) => {
      const y = 56 + i * 44;
      const r = this.expResults.find(x => x.mon === m);
      const bef = this.before.find(b => b.uid === m.uid);
      drawIcon(ctx, m.species, 16, y - 8, { still: isFainted(m), gray: isFainted(m) });
      text(ctx, monName(m), 58, y, { color: isFainted(m) ? 'gray' : 'white' });
      const lvShown = this.expAnim < 1 && bef ? bef.level : m.level;
      text(ctx, 'Lv' + lvShown, 246, y, { align: 'right', color: 'white' });
      const frac = this.expAnim < 1 && bef ? bef.exp + ((m.level > bef.level ? 1 : expProgress(m)) - bef.exp) * this.expAnimK() : expProgress(m);
      rect(ctx, 58, y + 18, 150, 4, '#202830');
      rect(ctx, 58, y + 18, Math.round(150 * Math.min(1, frac)), 4, '#40c8f8');
      if (r) text(ctx, `+${r.gained} EXP`, 246, y + 14, { align: 'right', color: 'lime', font: 'small' });
      const lvUp = r && m.level > (bef?.level || 0) && this.expAnim >= 1 ? `LEVEL UP! (${bef.level}→${m.level})` : null;
      if (lvUp) text(ctx, lvUp, 58, y + 24, { color: 'gold', font: 'small' });
      // scaled EXP (run.distributeExp r.scale): over-leveled POKéMON earned less, under-leveled ones a bonus;
      // A5+ level cap (r.capped): the EXP past the cap is lost
      const pct = r && r.scale ? Math.round((r.scale - 1) * 100) : 0;
      const tag = r?.capped ? 'CAPPED'
        : pct <= -1 ? `${pct}% overleveled` : pct >= 1 ? `+${pct}% underleveled` : null;
      const tagW = tag ? Math.min(measure(tag, 'small'), 188 - (lvUp ? measure(lvUp, 'small') + 6 : 0)) : 0;
      if (tag) textFit(ctx, tag, 246, y + 24, tagW, { align: 'right', color: r.capped ? 'orange' : pct < 0 ? 'gray' : ['#80d0ff', '#203850'], font: 'small' });
      if (tag && hover(246 - tagW - 2, y + 22, tagW + 4, 14)) {
        if (r.capped) tip('LEVEL CAP', `${monName(m)} is at this act's level cap (Lv${G.run.levelCap?.() ?? m.level}), so the battle EXP past the cap is lost. Rotate in a lower-level POKéMON.`, { width: 190, x: 262, y });
        else tip('SCALED EXP', 'POKéMON above the foe\'s level earn less EXP (below it, more): rotate your team!', { width: 180, x: 262, y });
      } else if (hover(6, y - 4, 250, 40)) monTooltip(m, 262, y);
    });
    // right: rewards list
    const x = 270, w = 360;
    panel(ctx, x, 32, w, 40 + this.rewards.length * 34 + 40);
    text(ctx, this.cfg.kind === 'wild' && this.battle.result.outcome === 'caught' ? 'GOTCHA!' : 'VICTORY!', x + w / 2, 38, { align: 'center', color: 'gold', scale: 1 });
    this.rewards.forEach((r, i) => {
      const ry = 60 + i * 34;
      const hot = !r.claimed && !this.busy && hover(x + 10, ry, w - 20, 30);
      pixBox(ctx, x + 10, ry, w - 20, 30, r.claimed ? '#2a2a30' : hot ? '#4a5878' : '#323a50', r.claimed ? '#202024' : hot ? '#f8d038' : '#141820', 3);
      const icon = r.kind === 'money' ? itemPath('NUGGET') : r.kind === 'item' ? itemPath(r.key) : r.kind === 'relic' ? itemPath(r.choices[0]) : r.kind === 'moves' ? itemPath('TM_CASE') : r.kind === 'badge' ? badgeIcon(r.badge) : null;
      if (r.kind === 'mon' || r.kind === 'legend' || r.kind === 'lost' || r.kind === 'legendNote') drawIcon(ctx, r.mon.species, x + 14, ry - 3, { gray: r.kind === 'lost' || r.kind === 'legendNote' });
      else if (r.kind === 'monPick') drawIcon(ctx, r.mons[0].species, x + 14, ry - 3);
      else if (icon) draw(ctx, icon, x + 16, ry + 3);
      textFit(ctx, r.label, x + 50, ry + 8, w - 90, { color: r.kind === 'lost' ? 'red' : r.claimed ? 'gray' : r.kind === 'legend' ? 'gold' : 'white' });
      if (r.claimed && r.kind !== 'money' && r.kind !== 'lost' && r.kind !== 'legendNote') text(ctx, '✓', x + w - 24, ry + 8, { color: 'green' });
      if (r.kind === 'legendNote' && hover(x + 10, ry, w - 20, 30)) tip('ONE LEGENDARY PER RUN', `${G.run.legendRuleText()} Once a legendary joins you, no other legendary can be caught for the rest of the run. Fights and their held items stay.`, { width: 200 });
      if (hot) {
        if (r.kind === 'item') tip(D.items[r.key]?.name, consumableDesc(r.key));
        if (r.kind === 'badge') tip(BADGES[r.badge].name, BADGES[r.badge].desc);
        if (Engine.mouse.clicked) { Sound.playSE('se_select'); this.claim(r); }
      }
    });
    const by = 60 + this.rewards.length * 34 + 6;
    if (button(ctx, this.rewards.some(r => !r.claimed) ? 'SKIP REST & CONTINUE' : 'CONTINUE', x + w / 2 - 90, by, 180, 26, { color: THEME.green, disabled: this.busy })) {
      const left = this.rewards.filter(r => !r.claimed && r.kind !== 'money');
      if (!left.length) afterRewards(this.battle, this.cfg, this.extra);
      else pushOverlay(new ChoiceModal({ title: 'Leave rewards behind?', body: `Unclaimed: ${left.map(r => r.label).join(', ')}` + (left.some(r => r.kind === 'relic') ? '\nYou can hold as many held items as you like.' : ''), options: [{ label: 'Go back', value: 0, color: THEME.green }, { label: 'Skip them', value: 1, color: THEME.discard }], onClose: v => { if (v === 1) afterRewards(this.battle, this.cfg, this.extra); } }));
    }
    if (this.toast) { this.toast.t -= Engine.dt; if (this.toast.t <= 0) this.toast = null; else { const tw = measure(this.toast.text) + 20; pixBox(ctx, (W - tw) / 2, H - 40, tw, 22, '#401010', '#ff6060', 3); text(ctx, this.toast.text, W / 2, H - 36, { align: 'center', color: 'white' }); } }
    drawFx(ctx, Engine.dt);
    drawTips(ctx);
  }
  expAnimK() { return Math.min(1, this.t / (G.meta.settings.fast ? 0.4 : 1.0)); }
}

export function pick(modal) { return new Promise(res => { modal.onClose = res; pushOverlay(modal); }); }

export async function learnMove(mon, move) {
  if (knowsMove(mon, move)) return false;
  if (mon.moves.length < 4) { teachMove(mon, move); Sound.playFanfare('mus_obtain_tmhm'); await toastMsg(`${monName(mon)} learned ${D.moves[move].name}!`); return true; }
  const idx = await pick(new MoveReplaceModal({ mon, move }));
  if (idx === null || idx === undefined || idx < 0) return false;
  const old = D.moves[mon.moves[idx].move].name;
  mon.moves[idx] = { move, copies: replacedCopies(mon.moves[idx], move) };
  Sound.playFanfare('mus_obtain_tmhm');
  await toastMsg(`1, 2, and... Poof! ${monName(mon)} forgot ${old} and learned ${D.moves[move].name}!`);
  return true;
}

// Small blocking message overlay
export function toastMsg(str) {
  return pick(new class extends Modal {
    draw(ctx) {
      this.dim(ctx);
      const w = 420, x = (W - w) / 2, y = H - 90;
      panel(ctx, x, y, w, 50, 'paper');
      textBlock(ctx, str, x + 12, y + 10, w - 24, { color: 'dark' });
      if (this.t > 0.25 && (Engine.mouse.clicked || keyPressed('Enter') || keyPressed(' '))) this.close(true);
    }
  }({ cancelable: false }));
}

// Run learn/evolve events after EXP (and Rare Candy etc.)
export async function processLevelEvents(list) {
  for (const { mon, events } of list) {
    let evolveTo = null;
    for (const ev of events) {
      if (ev.type === 'learn') await learnMove(mon, ev.move);
      if (ev.type === 'evolve') evolveTo = ev.into;
    }
    if (evolveTo && mon.species !== evolveTo) await runEvolution(mon, evolveTo);
  }
}

export async function processPendingLevelEvents(cb) {
  const run = G.run;
  if (run.pendingLevelEvents) { const p = run.pendingLevelEvents; run.pendingLevelEvents = null; await processLevelEvents([p]); }
  if (run.pendingEvolution) { const p = run.pendingEvolution; run.pendingEvolution = null; await runEvolution(p.mon, p.into, true); }
  saveRun();
  cb?.();
}

export function runEvolution(mon, into, forced) {
  return pick(new EvolutionModal({ mon, into, forced, cancelable: false }));
}

class EvolutionModal extends Modal {
  enter() {
    this.phase = 0; this.k = 0; this.cancelled = false; this.from = this.mon.species;
    Sound.playBGM('mus_evolution_intro');
    this.run();
  }
  async run() {
    await wait(0.8);
    Sound.playBGM('mus_evolution');
    this.phase = 1;
    const dur = G.meta.settings.fast ? 2.5 : 5;
    const t0 = Engine.time;
    while (Engine.time - t0 < dur) {
      if (this.cancelled) break;
      await wait(0.05);
    }
    if (this.cancelled) {
      this.phase = 3;
      Sound.stopBGM();
      await toastMsg(`Huh? ${monName(this.mon)} stopped evolving!`);
      this.close(false);
      return;
    }
    const oldName = monName(this.mon);
    const learned = evolve(this.mon, this.into);
    G.run.addSeen(this.into, true);
    this.phase = 2;
    Sound.playFanfare('mus_evolved');
    Sound.playCry(this.into);
    burst(W / 2, 150, { color: ['#fff', '#f8f080', '#80f0ff'], n: 40, speed: 120, grav: 40 });
    await wait(0.6);
    await toastMsg(`Congratulations! Your ${D.species[this.from].name} evolved into ${D.species[this.into].name}!`);
    if (this.from === 'NINCADA' && this.into === 'NINJASK' && G.run.shedinjaFrom(this.mon)) await toastMsg('...Huh? A SHEDINJA joined your party!');
    for (const mv of learned) await learnMove(this.mon, mv);
    saveRun();
    this.close(true);
  }
  draw(ctx) {
    swirlBackground(ctx, ['#081020', '#203870', '#102040'], 2);
    // The swirl frames are opaque 240x160 panels of different brightness: cover the whole screen (3x = 720x480,
    // centred and cropped) and cross-fade slowly between frames, so there's no box edge and no hard flashing.
    const sw = (W / 2 - 360) | 0, sh = (H / 2 - 240) | 0, a = this.phase === 1 ? 0.5 : 0.15;
    const f = Engine.time * 2, fi = Math.floor(f), blend = f - fi;
    draw(ctx, 'gfx/misc/evolution/swirl_frames.png', sw, sh, { sx: (fi % 4) * 240, sy: 0, sw: 240, sh: 160, scale: 3, alpha: a });
    draw(ctx, 'gfx/misc/evolution/swirl_frames.png', sw, sh, { sx: ((fi + 1) % 4) * 240, sy: 0, sw: 240, sh: 160, scale: 3, alpha: a * blend });
    const k = this.phase === 1 ? (Math.sin(Engine.time * (4 + (Engine.time % 5) * 3)) > 0 ? 1 : 0) : this.phase === 2 ? 1 : 0;
    const species = this.phase === 2 ? this.into : k && this.phase === 1 ? this.into : this.from;
    drawMon(ctx, species, W / 2 - 64, 100, { scale: 2, shiny: this.mon.shiny, silhouette: this.phase === 1 ? '#ffffff' : null });
    text(ctx, this.phase === 2 ? `${D.species[this.into].name}!` : `What? ${monName(this.mon)} is evolving!`, W / 2, 50, { align: 'center', color: 'white' });
    if (this.phase === 1 && !this.forced) {
      if (button(ctx, 'STOP (B)', W / 2 - 50, H - 50, 100, 24, { color: '#806060' }) || keyPressed('b') || keyPressed('Escape')) this.cancelled = true;
      text(ctx, 'Stop it to keep it unevolved', W / 2, H - 20, { align: 'center', color: 'gray', font: 'small' });
    }
    drawFx(ctx, Engine.dt);
  }
}

export class MoveChoiceModal extends Modal {
  draw(ctx) {
    this.dim(ctx);
    const n = this.choices.length;
    const w = Math.max(320, n * 104 + 30), h = 200, x = (W - w) / 2, y = (H - h) / 2 - 10;
    panel(ctx, x, y, w, h);
    text(ctx, this.title || 'Choose a move to learn', W / 2, y + 8, { align: 'center', color: 'white' });
    this.choices.forEach((c, i) => {
      const mon = G.run.party.find(m => m.uid === c.uid);
      if (!mon) return;
      const info = fakeInfo(mon, c.move);
      const cx = x + (w - (n * 104 - 14)) / 2 + i * 104 + 22, cy = y + 34;
      const hot = hover(cx - 10, cy - 6, CARD_W + 20, CARD_H + 50);
      drawCard(ctx, info, cx, cy - (hot ? 4 : 0), { selected: hot, ignorePlayable: true, animate: hot });
      const label = `${monName(mon)} Lv${mon.level}`;
      textFit(ctx, label, cx + CARD_W / 2 - Math.min(90, measure(label, 'small')) / 2, cy + CARD_H + 6, 90, { font: 'small', color: 'white' });
      if (mon.moves.length >= 4) text(ctx, 'replaces a move', cx + CARD_W / 2, cy + CARD_H + 18, { align: 'center', color: 'gray', font: 'small' });
      if (hot) {
        cardTooltip(info);
        // its current moves, so you can see what it would replace
        const mw = mon.moves.length * 124 + 12, mx = (W - mw) / 2, my = y + h + 4;
        panel(ctx, mx, my, mw, 42);
        text(ctx, `${monName(mon)} Lv${mon.level} knows:`, mx + 8, my + 4, { font: 'small', color: 'gray' });
        mon.moves.forEach((m, j) => drawMiniCard(ctx, fakeInfo(mon, m.move), mx + 8 + j * 124, my + 16, m.copies));
        if (Engine.mouse.clicked) { Sound.playSE('se_select'); this.close(c); }
      }
    });
    if (button(ctx, 'SKIP', W / 2 - 40, y + h - 30, 80, 22, { color: '#806060' })) this.close(null);
    drawTips(ctx);
  }
}

// Pick 1 of N held items. Skipping (SKIP, Esc, right-click) asks first: players skipped them thinking they
// could only hold a few. (Shared by the reward screen, "?" events and item balls, solo and co-op.)
export class RelicChoiceModal extends Modal {
  update(dt) {
    this.t += dt;
    if (this.cancelable !== false && (keyPressed('Escape') || Engine.mouse.rclicked)) this.confirmSkip();
  }
  confirmSkip() {
    if (topOverlay() !== this) return;
    const one = this.choices.length === 1;
    pushOverlay(new ChoiceModal({
      title: one ? 'Skip this held item?' : 'Skip these held items?',
      body: 'You can hold as many held items as you like.',
      options: [{ label: one ? 'Take it' : 'Pick one', value: 'take', color: THEME.green }, { label: 'Skip', value: 'skip', color: THEME.discard }],
      onClose: (v) => {
        if (v === 'skip') this.close(null);
        else if (v === 'take' && one) { Sound.playSE('se_select'); this.close(this.choices[0]); }
      },
    }));
  }
  draw(ctx) {
    this.dim(ctx);
    const live = topOverlay() === this; // (the skip confirm on top owns the clicks)
    const n = this.choices.length;
    const w = Math.max(300, n * 150 + 20), h = 204, x = (W - w) / 2, y = (H - h) / 2;
    panel(ctx, x, y, w, h);
    text(ctx, this.title || 'Choose a held item', W / 2, y + 8, { align: 'center', color: 'white' });
    this.choices.forEach((k, i) => {
      const def = RELICS[k];
      const cx = x + 10 + i * 150 + (w - 20 - n * 150) / 2, cy = y + 30;
      const hot = live && hover(cx, cy, 142, 124);
      const rc = def.rarity === 'rare' ? '#f8d038' : def.rarity === 'uncommon' ? '#58a8f8' : '#a0a0a0';
      pixBox(ctx, cx, cy, 142, 124, hot ? '#40507a' : '#2a3246', hot ? '#ffffff' : rc, 3);
      draw(ctx, itemPath(k), cx + 71 - 24, cy + 6 + (hot ? Math.sin(Engine.time * 8) * 2 : 0), { scale: 2 });
      text(ctx, D.items[k]?.name || k, cx + 71, cy + 56, { align: 'center', color: 'white', font: measure(D.items[k]?.name || k) > 136 ? 'small' : 'normal' });
      text(ctx, def.rarity.toUpperCase(), cx + 71, cy + 70, { align: 'center', color: def.rarity === 'rare' ? 'gold' : def.rarity === 'uncommon' ? 'blue' : 'gray', font: 'small' });
      textBlock(ctx, def.desc, cx + 6, cy + 82, 130, { font: 'small', color: 'whiteSoft', lineHeight: 10 });
      if (hot && Engine.mouse.clicked) { Sound.playSE('se_select'); this.close(k); }
    });
    text(ctx, 'No limit on held items: take as many as you find!', W / 2, y + 158, { align: 'center', color: 'gold', font: 'small' });
    if (button(ctx, 'SKIP', W / 2 - 40, y + h - 26, 80, 22, { color: '#806060', disabled: !live })) this.confirmSkip();
  }
}
