// Using consumables outside battle (map, rewards, shop), PP Up / Heart Scale / TM teaching / move deleting.
import { pushOverlay, W, H, hover } from '../engine/core.js';
import { draw, itemPath } from '../engine/assets.js';
import { text, textFit } from '../engine/font.js';
import { panel, pixBox, button, closeButton, tip, drawTips, THEME } from '../engine/ui.js';
import { D } from '../game/data.js';
import { CONSUMABLES } from '../game/items.js';
import { monName, canLearn, knowsMove } from '../game/pokemon.js';
import { G, saveRun } from '../game/state.js';
import { Sound } from '../audio/sound.js';
import { PartyPicker, DeckModal, ChoiceModal, Modal, consumableDesc } from './common.js';
import { pick, toastMsg, learnMove, processPendingLevelEvents, MoveChoiceModal } from './reward.js';

// Clicking a bag item outside battle: use it, sell it (half price) or keep it.
export async function useConsumableOutside(key) {
  const run = G.run;
  const def = CONSUMABLES[key];
  if (!def) return;
  const name = D.items[key]?.name || key;
  const value = run.sellValue(key); // NUGGET-style items sell at full value
  const battleOnly = def.battleOnly || def.flee || def.sell;
  const c = await pick(new ChoiceModal({
    title: name, body: def.sell ? 'Worth money at any shop counter.' : battleOnly ? 'This item can only be used in battle.' : 'What do you want to do with it?',
    options: [
      ...(battleOnly ? [] : [{ label: 'Use', value: 'use', color: '#3a9a58' }]),
      { label: value ? `Sell ($${value.toLocaleString()})` : 'Toss it', value: 'sell', color: '#c04040' },
      { label: 'Keep it', value: null },
    ],
  }));
  if (c === 'sell') { run.sellConsumable(key); Sound.playSE(value ? 'se_shop' : 'se_use_item'); saveRun(); return; }
  if (c !== 'use') return;
  return useConsumableNow(key);
}

// Uses key outside battle (the player picks the target). fromBag = false: it's a just-found / just-bought
// item that isn't in the bag (the bag-full picker), so no bag copy is removed. Returns true if it was used.
export async function useConsumableNow(key, fromBag = true) {
  const run = G.run;
  const def = CONSUMABLES[key];
  const name = D.items[key]?.name || key;
  const consume = () => { if (fromBag) run.useConsumable(key); };
  if (def.combo || def.sell || def.reviveAll) {
    if (run.applyConsumableToMon(key, null)) {
      consume();
      Sound.playSE(def.sell ? 'se_shop' : 'se_use_item');
      if (def.combo) await toastMsg(`${def.combo.replace('_', ' ')} leveled up to level ${run.comboLevels[def.combo]}!`);
      if (def.sell) await toastMsg(`Sold for $${def.sell}!`);
      saveRun();
      return true;
    }
    return false;
  }
  if (def.addCopy) {
    const r = await pick(new DeckModal({ title: `${name}: pick a move to copy`, onPick: true, pickText: `Click a move to add ${def.addCopy} extra card${def.addCopy > 1 ? 's' : ''}.` }));
    if (r) { r.mon.moves[r.index].copies = (r.mon.moves[r.index].copies || 1) + def.addCopy; consume(); Sound.playSE('se_use_item'); await toastMsg(`${D.moves[r.mon.moves[r.index].move].name} now has ${r.mon.moves[r.index].copies} copies!`); saveRun(); return true; }
    return false;
  }
  if (def.relearn) {
    const mon = await pick(new PartyPicker({ title: 'Remind which POKéMON?' }));
    if (!mon) return false;
    const opts = run.relearnable(mon).slice(-8);
    if (!opts.length) { await toastMsg(`${monName(mon)} has no moves to remember.`); return false; }
    const c = await pick(new MoveChoiceModal({ title: 'Remember which move?', choices: opts.slice(-4).map(m => ({ uid: mon.uid, move: m })) }));
    if (c && await learnMove(mon, c.move)) { consume(); saveRun(); return true; }
    return false;
  }
  const filter = (m) => run.useBlocker(key, m) || true;
  const mon = await pick(new PartyPicker({ title: `Use ${name} on...`, filter }));
  if (!mon) return false;
  if (run.applyConsumableToMon(key, mon)) {
    consume();
    Sound.playSE('se_use_item');
    await processPendingLevelEvents();
    saveRun();
    return true;
  }
  return false;
}

export async function teachTM(move) {
  const run = G.run;
  const mon = await pick(new PartyPicker({ title: `Teach ${D.moves[move].name} to...`, filter: m => knowsMove(m, move) ? 'Already knows it' : canLearn(m.species, move) ? true : "Can't learn", cancelable: true }));
  if (!mon) return false;
  return learnMove(mon, move);
}

export async function deleteCard() {
  const run = G.run;
  const r = await pick(new DeckModal({ title: 'MOVE DELETER: remove one card', onPick: true, pickText: 'Click a move to remove one copy of it (a POKéMON keeps at least 1 card).' }));
  if (!r) return false;
  const mv = r.mon.moves[r.index];
  const total = r.mon.moves.reduce((a, m) => a + (m.copies || 1), 0);
  if (total <= 1) { await toastMsg('That POKéMON needs at least one card!'); return false; }
  if ((mv.copies || 1) > 1) mv.copies--;
  else r.mon.moves.splice(r.index, 1);
  Sound.playFanfare('mus_move_deleted');
  saveRun();
  return true;
}

// Right-click a bag item outside battle: sell it for half price (or toss it if it has no price).
export async function tossConsumable(key) {
  const run = G.run;
  if (!run.hasConsumable(key)) return;
  const name = D.items[key]?.name || key;
  const value = run.sellValue(key);
  const c = await pick(new ChoiceModal({ title: name, body: value ? `Sell it for $${value.toLocaleString()} to free up the bag slot?` : 'Toss it to free up the bag slot?',
    options: [{ label: value ? `Sell ($${value.toLocaleString()})` : 'Toss it', value: 1, color: '#c04040' }, { label: 'Keep it', value: 0 }] }));
  if (c !== 1) return;
  run.sellConsumable(key);
  Sound.playSE(value ? 'se_shop' : 'se_use_item');
  saveRun();
}

// ---- full bag ---------------------------------------------------------------------------------------
// A found (or about-to-be-bought) item when the BAG is full: the player uses it right away, uses or sells
// one bag item to make room, or leaves it (LEAVE IT / the X / Esc). Nothing is ever dropped silently.
//   offerItem(key)                          -> 'stored' | 'used' | 'left'  (stores it once there's room)
//   offerItem(key, { price, store: false }) -> 'room' | 'used' | 'left'    (MART: the caller buys it after
//                                              'room', or charges for it after 'used'; 'left' = not bought)
export async function offerItem(key, opts = {}) {
  const run = G.run;
  const store = opts.store !== false;
  if (!run.bagFull()) { if (!store) return 'room'; run.addConsumable(key); saveRun(); return 'stored'; }
  for (;;) {
    const c = await pick(new BagFullModal({ item: key, price: opts.price }));
    if (!c || c.act === 'leave') {
      if (store) { run.logBagFull(key, 'left'); saveRun(); }
      return 'left';
    }
    if (c.act === 'useNew') {
      if (await useConsumableNow(key, false)) { if (store) run.logBagFull(key, 'used'); saveRun(); return 'used'; }
      continue; // backed out of the target picker: back to the choice
    }
    if (c.act === 'useBag') { if (!(await useConsumableNow(c.key, true))) continue; }
    else if (c.act === 'sellBag') { const v = run.sellConsumable(c.key); Sound.playSE(v > 0 ? 'se_shop' : 'se_use_item'); }
    if (run.bagFull()) continue;
    if (!store) { saveRun(); return 'room'; }
    run.addConsumable(key);
    run.logBagFull(key, 'stored', c.key);
    Sound.playSE('se_use_item');
    saveRun();
    return 'stored';
  }
}

export class BagFullModal extends Modal {
  // Rows: the new item first, then the bag. (tests/bagfull_ui.cjs taps by this layout.)
  static layout(n) {
    const w = 460, rowH = 38, h = 66 + (n + 1) * (rowH + 4);
    const x = (W - w) / 2, y = Math.max(4, Math.round((H - h) / 2));
    return { w, h, x, y, rowH, rowY: (i) => y + 40 + i * (rowH + 4) + (i > 0 ? 14 : 0) };
  }
  draw(ctx) {
    this.dim(ctx);
    const run = G.run, key = this.item, shop = this.price !== undefined;
    const name = D.items[key]?.name || key;
    const L = BagFullModal.layout(run.consumables.length);
    const { x, y, w, h } = L;
    panel(ctx, x, y, w, h);
    text(ctx, 'Your BAG is full!', W / 2, y + 7, { align: 'center', color: 'gold' });
    const sub = shop ? `Make room to buy the ${name} ($${this.price.toLocaleString()}), or don't buy it.` : `Use the ${name} now, make room for it, or leave it.`;
    textFit(ctx, sub, x + 12, y + 23, w - 50, { color: 'whiteSoft', font: 'small' });
    if (closeButton(ctx, x + w, y)) { this.close({ act: 'leave' }); return; }
    let done = false;
    const row = (k, i, isNew) => {
      const ry = L.rowY(i), rh = L.rowH, d = CONSUMABLES[k] || {};
      pixBox(ctx, x + 8, ry, w - 16, rh, isNew ? '#3e3a20' : '#2a3246', isNew ? '#f8d038' : '#141820', 3);
      draw(ctx, itemPath(k), x + 14, ry + 7);
      const nm = D.items[k]?.name || k;
      text(ctx, isNew ? (shop ? 'BUY' : 'NEW') : 'BAG', x + 42, ry + 5, { color: isNew ? 'gold' : 'gray', font: 'small' });
      textFit(ctx, nm, x + 66, ry + 3, 160, { color: 'white' });
      textFit(ctx, consumableDesc(k), x + 42, ry + 22, 196, { color: 'whiteSoft', font: 'small' });
      if (hover(x + 8, ry, 150, rh)) tip(nm, consumableDesc(k)); // icon + name only: a tap's leftover hover mustn't cover buttons
      // buttons, right-aligned
      let bx = x + w - 14;
      const btn = (label, bw, color, act) => {
        bx -= bw;
        const hit = !done && button(ctx, label, bx, ry + 7, bw, 26, { color, font: 'small' });
        bx -= 6;
        if (hit) { done = true; this.close({ act, key: k }); }
      };
      const usable = run.canUseNow(k);
      if (isNew) {
        btn(shop ? "DON'T BUY" : 'LEAVE IT', 80, '#806060', 'leave');
        if (usable) btn(d.sell ? `CASH IN $${d.sell.toLocaleString()}` : shop ? 'BUY & USE' : 'USE IT NOW', d.sell ? 104 : 88, THEME.green, 'useNew');
      } else {
        const v = run.sellValue(k);
        btn(v ? `SELL $${v.toLocaleString()}` : 'TOSS', 80, '#c04040', 'sellBag');
        if (usable && !d.sell) btn('USE', 52, THEME.green, 'useBag');
      }
      if (!usable && (d.battleOnly || d.flee)) text(ctx, 'battle only', bx, ry + 13, { align: 'right', color: 'gray', font: 'small' });
      else if (!usable && !d.sell) text(ctx, 'no use now', bx, ry + 13, { align: 'right', color: 'gray', font: 'small' });
    };
    row(key, 0, true);
    text(ctx, 'or make room in your BAG:', x + 12, L.rowY(1) - 12, { color: 'gray', font: 'small' });
    run.consumables.forEach((k, i) => row(k, i + 1, false));
    drawTips(ctx);
  }
}
