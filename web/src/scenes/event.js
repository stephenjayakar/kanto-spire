// "?" events (game/events.js): the event's text, its choices for this run, and every follow-up pick
// (held items, POKéMON, cards, items). Multi-step events (result.next) keep offering choices.
import { Engine, W, H, hover } from '../engine/core.js';
import { draw, itemPath } from '../engine/assets.js';
import { text, textBlock, measure } from '../engine/font.js';
import { swirlBackground, BG_THEMES, button, panel, pixBox, drawTips, tip, THEME } from '../engine/ui.js';
import { D, itemName, speciesName } from '../game/data.js';
import { RELICS, CONSUMABLES } from '../game/items.js';
import { G, saveRun } from '../game/state.js';
import { pickEvent, eventById, eventChoices, choiceLabel, eventTitle, eventText, eventNpc, upgradeTarget, upgradeMove, powerCap } from '../game/events.js';
import { monName, isFainted } from '../game/pokemon.js';
import { Sound } from '../audio/sound.js';
import { drawHUD, drawPartyPanel, drawMon, PartyPicker, DeckModal, ChoiceModal, Modal, consumableDesc } from './common.js';
import { goToMap, startBattle } from './flow.js';
import { pick, toastMsg, MoveChoiceModal, learnMove, processPendingLevelEvents, processLevelEvents, RelicChoiceModal } from './reward.js';
import { useConsumableOutside, deleteCard, offerItem } from './items_ui.js';
import { pushOverlay } from '../engine/core.js';

const MUSIC = { gamecorner: 'mus_game_corner', mauville_gc: 'mus_game_corner', rocket1: 'mus_encounter_rocket', ghost: 'mus_poke_tower', professor: 'mus_oak' };

export class EventScene {
  enter() {
    const run = G.run;
    this.rng = run.rng.fork('event' + run.nodeId);
    // Re-entering the same node after a reload shows the same event (no rerolling by reloading).
    const at = run.actIndex + ':' + run.nodeId;
    this.ev = (run.pendingEventId && run.pendingEventAt === at && eventById(run.pendingEventId)) || (G.coop ? G.coop.pickEvent(run, this.rng) : pickEvent(run, this.rng));
    run.pendingEventId = this.ev.id; run.pendingEventAt = at;
    this.result = null;
    this.steps = null; // choices of a multi-step event's next step
    this.busy = false;
    this.t = 0;
    Sound.playBGM(this.ev.music || MUSIC[this.ev.id] || run.act.townMusic, { ctx: { event: this.ev.id } }); // (ctx: RETRO's per-event songs, audio/retro.js)
    saveRun();
  }
  update(dt) { this.t += dt; }
  choices() { return this.steps || eventChoices(this.ev, G.run); }
  async choose(c) {
    const run = G.run;
    this.busy = true;
    let mon = null, keys = [];
    if (c.needsMon) {
      const extra = c.monFilter ? c.monFilter(run) : null;
      mon = await pick(new PartyPicker({ title: c.needsMon === 'release' ? 'Choose a POKéMON to give away' : 'Choose a POKéMON', filter: m => {
        if (c.needsMon === 'alive' && isFainted(m)) return 'Fainted';
        return extra ? extra(m) : true;
      } }));
      if (!mon) { this.busy = false; return; }
    }
    if (c.needsRelic) {
      const n = typeof c.needsRelic === 'number' ? c.needsRelic : c.needsRelic.n || 1;
      const filt = typeof c.needsRelic === 'object' && c.needsRelic.filter ? c.needsRelic.filter : null;
      const ok = (k) => !RELICS[k]?.curse && !RELICS[k]?.legendary && (!filt || filt(k));
      // (CINNABAR LAB: the mailed OLD AMBER needs no held item)
      if (!(this.ev.id === 'cinnabar_lab' && run.flags?.amber === 'sent')) {
        for (let i = 0; i < n; i++) {
          const k = await pick(new RelicPickModal({ title: n > 1 ? `Choose a held item to give (${i + 1}/${n})` : 'Choose a held item to give', keys: run.relics.map(r => r.key).filter(k => ok(k) && !keys.includes(k)) }));
          if (!k) { this.busy = false; return; }
          keys.push(k);
        }
      }
    }
    const res = c.run(run, this.rng, mon, keys) || {};
    run.logEvent({ k: 'event', id: this.ev.id, choice: choiceLabel(c, run) });
    this.result = res;
    this.steps = res.next ? res.next.choices : null;
    if (!res.battle) run.inNode = false; // resolved: a reload must not let the event be taken again
    Sound.playSE('se_select');
    await this.applyResult(res);
    saveRun();
    if (res.battle && G.coop) { await toastMsg(res.text); G.coop.privateDone(); return; } // battle choices are hidden in co-op
    if (res.battle) {
      await toastMsg(res.text);
      // a gauntlet (the RADIO TOWER): cfg.chainNext(run) is the next fight, started right after the rewards, no heal
      const node = { id: run.nodeId, type: res.battle.kind, floor: run.floor };
      const go = (cfg) => startBattle(cfg, node, cfg.chainNext ? { onDone: () => { const nx = cfg.chainNext(run); if (nx) go(nx); else goToMap(); } } : {});
      go(res.battle);
      return;
    }
    this.busy = false;
  }
  async applyResult(res) {
    const run = G.run;
    if (res.curse) { Sound.playSE('se_m_screech'); }
    else if (res.relic) Sound.playFanfare('mus_obtain_item');
    if (res.newMon) await this.addMon(res.newMon);
    if (res.monChoices?.length) {
      const m = await pick(new MonChoiceModal({ title: 'Choose a POKéMON', mons: res.monChoices, cancelable: false }));
      if (m) { this.result.text += ` You chose ${speciesName(m.species)}!`; await this.addMon(m); }
    }
    if (res.tutor && res.tutor.length) {
      const ch = await pick(new MoveChoiceModal({ title: 'Choose a move to learn', choices: res.tutor }));
      const mon = ch && run.party.find(m => m.uid === ch.uid);
      if (mon && (await learnMove(mon, ch.move)) && res.tutorCopy) { const slot = mon.moves.find(x => x.move === ch.move); if (slot) slot.copies += res.tutorCopy; }
    } else if (res.tutor) this.result.text += ' ...But none of your POKéMON can learn anything new.';
    if (res.deleteCards) {
      let n = 0;
      for (let i = 0; i < res.deleteCards; i++) { if (!(await deleteCard())) break; n++; }
      this.result.text += n ? ` ${n} card${n > 1 ? 's' : ''} forgotten.` : ' You kept your deck as it was.';
    }
    if (res.addCopy) {
      const done = [];
      for (let i = 0; i < res.addCopy; i++) {
        const r = await pick(new DeckModal({ title: `Choose a card to copy (${i + 1}/${res.addCopy})`, onPick: true, pickText: 'Click a move: it gets +1 copy.' }));
        if (!r) break;
        const slot = r.mon.moves[r.index];
        if (done.includes(slot)) { await toastMsg('Pick a different move!'); i--; continue; }
        slot.copies = (slot.copies || 1) + 1; done.push(slot);
        Sound.playFanfare('mus_obtain_tmhm');
      }
      if (done.length) this.result.text += ` ${done.map(s => D.moves[s.move]?.name || s.move).join(' and ')} got +1 copy!`;
    }
    if (res.upgrade) {
      for (let i = 0; i < res.upgrade; i++) {
        const r = await pick(new DeckModal({ title: 'Choose a move to upgrade', onPick: true, pickText: 'Click an attack: it becomes the strongest move of its type this POKéMON can learn.' }));
        if (!r) break;
        const from = r.mon.moves[r.index].move;
        if (!upgradeTarget(r.mon, from, powerCap(run))) { await toastMsg(`${D.moves[from].name} can't be upgraded. Pick another.`); i--; continue; }
        const into = upgradeMove(r.mon, r.index, powerCap(run));
        Sound.playFanfare('mus_obtain_tmhm');
        await toastMsg(`${monName(r.mon)}'s ${D.moves[from].name} became ${D.moves[into].name}!`);
      }
    }
    if (res.relicChoices?.length) {
      const k = await pick(new RelicChoiceModal({ title: 'Choose a held item', choices: res.relicChoices }));
      if (k && run.addRelic(k)) { Sound.playFanfare('mus_obtain_item'); this.result.text += ` You got ${itemName(k)}!`; }
    }
    if (res.itemChoices?.keys?.length) {
      const picks = Math.min(res.itemChoices.picks || 1, res.itemChoices.keys.length);
      let left = res.itemChoices.keys.slice();
      for (let i = 0; i < picks; i++) {
        const k = await pick(new ChoiceModal({ title: picks > 1 ? `Choose an item (${i + 1}/${picks})` : 'Choose an item', cancelable: false, w: 320,
          options: left.map(k => ({ label: itemName(k), value: k, tip: consumableDesc(k) })) }));
        if (!k) break;
        left = left.filter(x => x !== k);
        if (res.itemChoices.use && CONSUMABLES[k]?.combo) { run.applyConsumableToMon(k, null); Sound.playFanfare('mus_obtain_item'); this.result.text += ` ${CONSUMABLES[k].combo.replace('_', ' ')} is now level ${run.comboLevels[CONSUMABLES[k].combo]}!`; }
        else { const got = await offerItem(k); this.result.text += got === 'left' ? ` You left the ${itemName(k)}.` : ` You got ${itemName(k)}!`; }
      }
    }
    // found items that didn't fit in the full BAG: the player decides (use now / make room / leave it)
    for (const k of res.overflow || []) {
      const got = await offerItem(k);
      const nm = itemName(k);
      this.result.text += got === 'stored' ? ` You made room for the ${nm}.` : got === 'used' ? ` You used the ${nm} right away.` : ` You left the ${nm} behind.`;
    }
    if (res.levelEvents?.length) { Sound.playFanfare('mus_level_up'); await processLevelEvents(res.levelEvents); }
    await processPendingLevelEvents();
  }
  async addMon(m) {
    const run = G.run;
    run.addSeen(m.species, true);
    if (!run.addToParty(m)) {
      const rel = await pick(new PartyPicker({ title: `Party full! Release one for ${D.species[m.species].name}?`, sub: () => 'Release' }));
      if (rel) run.party.splice(run.party.indexOf(rel), 1, m);
      else { this.result.text += ` ${speciesName(m.species)} was sent away.`; return; }
    }
    Sound.playCry(m.species);
  }
  draw(ctx) {
    const run = G.run, ev = this.ev;
    const title = eventTitle(ev, run);
    swirlBackground(ctx, BG_THEMES.event, 0.4);
    // (a long title would run into the money: the HUD keeps its FLOOR line then; the title is on the panel anyway)
    drawHUD(ctx, run, { subtitle: measure(title, 'small') <= 104 ? title : undefined, onDeck: () => pushOverlay(new DeckModal({})), onConsumableClick: k => useConsumableOutside(k) });
    panel(ctx, 170, 40, 460, 300);
    text(ctx, title, 400, 46, { align: 'center', color: 'gold' });
    // npc art
    const npc = eventNpc(ev, run);
    if (npc) {
      if (npc === 'oak') draw(ctx, 'gfx/misc/oak_speech/oak.png', 186, 66);
      else draw(ctx, `gfx/overworld/people/${npc}.png`, 196, 76, { sx: 0, sy: 0, sw: 16, sh: 32, scale: 2 });
    } else if (ev.mon) drawMon(ctx, ev.mon, 180, 64, { scale: 1 });
    else if (ev.item && ev.item !== 'item_ball') draw(ctx, itemPath(ev.item.toUpperCase()), 196, 90, { scale: 2 });
    else draw(ctx, 'gfx/overworld/misc/item_ball.png', 196, 90, { scale: 2 });
    panel(ctx, 260, 66, 360, 118, 'paper');
    textBlock(ctx, this.result ? this.result.text : eventText(ev, run), 272, 74, 336, { color: 'dark' });
    if (this.result?.slots) this.result.slots.forEach((s, i) => draw(ctx, `gfx/items/${['nugget', 'moon_stone', 'rare_candy', 'master_ball', 'oran_berry'][s] || 'nugget'}.png`, 360 + i * 30, 160));
    if (!this.result || this.steps) {
      const list = this.choices();
      const top = 192, room = 334 - top, gap = Math.min(32, Math.floor(room / Math.max(1, list.length))), bh = Math.min(26, gap - 4);
      let y = top;
      for (const c of list) {
        const ok = !c.cond || c.cond(run);
        const label = choiceLabel(c, run);
        if (button(ctx, label, 260, y, 360, bh, { color: ok ? (c.solo ? '#a05030' : THEME.play) : '#505060', disabled: !ok || this.busy, font: measure(label) > 340 ? 'small' : undefined })) this.choose(c);
        if (c.tip && hover(260, y, 360, bh)) tip(label, c.tip);
        y += gap;
      }
    } else if (button(ctx, 'CONTINUE', 340, 296, 200, 28, { color: THEME.green, disabled: this.busy })) goToMap();
    panel(ctx, 6, 36, 160, 30 * run.party.length + 10);
    drawPartyPanel(ctx, run, 10, 40, 152, { tipX: 170 });
    drawTips(ctx);
  }
}

// Pick one of your own held items (to trade away).
export class RelicPickModal extends Modal {
  draw(ctx) {
    this.dim(ctx);
    const keys = this.keys || [];
    const cols = Math.min(6, Math.max(1, keys.length)), rows = Math.ceil(keys.length / cols);
    const w = Math.max(280, cols * 52 + 20), h = 70 + rows * 52, x = (W - w) / 2, y = (H - h) / 2;
    panel(ctx, x, y, w, h);
    text(ctx, this.title || 'Choose a held item', W / 2, y + 8, { align: 'center', color: 'white' });
    keys.forEach((k, i) => {
      const cx = x + 10 + (i % cols) * 52 + (w - 20 - cols * 52) / 2, cy = y + 28 + Math.floor(i / cols) * 52;
      const hot = hover(cx, cy, 48, 48);
      const def = RELICS[k];
      // (the Center's CLEANSE picks among curses with this too: purple boxes, verb 'cleanse')
      pixBox(ctx, cx, cy, 48, 48, def?.curse ? (hot ? '#5a2a6a' : '#3a1846') : hot ? '#40507a' : '#2a3246', hot ? '#ffffff' : def?.curse ? '#8030b0' : '#141820', 3);
      draw(ctx, itemPath(k), cx, cy, { scale: 2 });
      if (hot) { tip(D.items[k]?.name || k, `${def?.desc || ''}\n\n${def?.curse ? 'CURSE' : `${(def?.rarity || '').toUpperCase()} HELD ITEM`}: click to ${this.verb || 'give it away'}`, def?.curse ? { accent: '#c050f0' } : {}); if (Engine.mouse.clicked) { Sound.playSE('se_select'); this.close(k); } }
    });
    if (!keys.length) text(ctx, 'You have no held item to give.', W / 2, y + 40, { align: 'center', color: 'gray' });
    if (button(ctx, 'CANCEL', W / 2 - 40, y + h - 28, 80, 22, { color: '#806060' })) this.close(null);
    drawTips(ctx);
  }
}

// Pick one of 2-3 POKéMON (prize counter, the DOJO's HITMONs, the ROCKET WAREHOUSE).
export class MonChoiceModal extends Modal {
  draw(ctx) {
    this.dim(ctx);
    const mons = this.mons || [];
    const n = mons.length, w = Math.max(300, n * 130 + 20), h = 170, x = (W - w) / 2, y = (H - h) / 2;
    panel(ctx, x, y, w, h);
    text(ctx, this.title || 'Choose a POKéMON', W / 2, y + 8, { align: 'center', color: 'white' });
    mons.forEach((m, i) => {
      const cx = x + 10 + i * 130 + (w - 20 - n * 130) / 2, cy = y + 28;
      const hot = hover(cx, cy, 122, 130);
      pixBox(ctx, cx, cy, 122, 130, hot ? '#40507a' : '#2a3246', hot ? '#f8d038' : '#141820', 3);
      drawMon(ctx, m.species, cx + 29, cy + 4, { shiny: m.shiny });
      text(ctx, speciesName(m.species), cx + 61, cy + 74, { align: 'center', color: 'white' });
      text(ctx, `Lv${m.level}  ${(D.species[m.species]?.types || []).join('/')}`, cx + 61, cy + 90, { align: 'center', color: 'gray', font: 'small' });
      text(ctx, m.moves.map(x => D.moves[x.move]?.name || x.move).slice(0, 2).join(', '), cx + 61, cy + 104, { align: 'center', color: 'whiteSoft', font: 'small' });
      if (hot && Engine.mouse.clicked) { Sound.playSE('se_select'); this.close(m); }
    });
    if (this.cancelable !== false && button(ctx, 'SKIP', W / 2 - 40, y + h - 28, 80, 22, { color: '#806060' })) this.close(null);
  }
}
