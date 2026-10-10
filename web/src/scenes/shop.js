// Poké Mart.
import { Engine, W, H, hover, keyPressed } from '../engine/core.js';
import { draw, itemPath } from '../engine/assets.js';
import { text, textBlock, measure, textFit } from '../engine/font.js';
import { swirlBackground, BG_THEMES, button, panel, pixBox, rect, drawTips, tip, THEME } from '../engine/ui.js';
import { D } from '../game/data.js';
import { RELICS } from '../game/items.js';
import { G, saveRun } from '../game/state.js';
import { generateShop, buyItem, rerollShop, tmChoices } from '../game/shop.js';
import { TUNING } from '../game/run.js';
import { RNG } from '../game/rng.js';
import { Sound } from '../audio/sound.js';
import { drawHUD, drawPartyPanel, consumableDesc, DeckModal } from './common.js';
import { goToMap } from './flow.js';
import { useConsumableOutside, teachTM, deleteCard, offerItem } from './items_ui.js';
import { sellRelicPrompt } from './map.js';
import { pushOverlay } from '../engine/core.js';

export class ShopScene {
  constructor(opts = {}) { this.opts = opts; }
  enter() {
    const run = G.run;
    this.rng = run.rng.fork('shop' + run.nodeId);
    // Persist the stock per node so reloading can't restock one-off items.
    run.shops ||= {};
    const shopKey = this.opts.key || run.nodeId;
    this.shop = run.shops[shopKey] ||= generateShop(run, this.rng, { plateau: String(shopKey).startsWith('plateau') });
    this.t = 0;
    Sound.playBGM(run.act.townMusic || 'mus_poke_center');
    this.say = 'Welcome! How may I serve you?';
  }
  update(dt) { this.t += dt; }
  async buy(it) {
    const run = G.run;
    if (this.busy) return;
    let r = buyItem(run, this.shop, it);
    if (!r.ok && r.bagFull) {
      // Full BAG (nothing paid yet): make room, or BUY & USE it on the spot; you pay only if it's stored or used.
      this.busy = true;
      let got = 'left';
      try { got = await offerItem(it.key, { price: it.price, store: false }); } finally { this.busy = false; }
      if (got === 'room') r = buyItem(run, this.shop, it);
      else if (got === 'used') r = buyItem(run, this.shop, it, { consumed: true });
      else { this.say = 'Make some room in your BAG, then come back!'; saveRun(); return; }
    }
    if (!r.ok) { this.say = r.reason; Sound.playSE('se_failure'); saveRun(); return; }
    Sound.playSE('se_shop');
    this.say = 'Here you are! Thank you!';
    if (r.pending?.type === 'teach') { const ok = await teachTM(r.pending.move); if (!ok) { it.sold = false; run.money += it.price; this.say = 'Changed your mind? Refunded.'; } }
    if (r.pending?.type === 'delete') { const ok = await deleteCard(); if (!ok) { run.money += it.price; this.say = 'No deletion, no charge.'; } }
    saveRun();
  }
  draw(ctx) {
    const run = G.run;
    swirlBackground(ctx, BG_THEMES.shop, 0.4);
    drawHUD(ctx, run, { subtitle: 'POKé MART', onDeck: () => pushOverlay(new DeckModal({})), onConsumableClick: k => useConsumableOutside(k), sellable: true, onRelicClick: k => sellRelicPrompt(k) });
    draw(ctx, 'gfx/overworld/people/clerk.png', 14, 30, { sx: 0, sy: 0, sw: 16, sh: 32, scale: 2 });
    panel(ctx, 52, 36, 300, 40, 'paper');
    textBlock(ctx, 'CLERK: ' + this.say, 62, 42, 284, { color: 'dark' });
    // items grid
    const groups = [
      ['BALLS', it => it.kind === 'ball'], ['MEDICINE & ITEMS', it => it.kind === 'consumable'], ['TMs', it => it.kind === 'tm'], ['HELD ITEMS', it => it.kind === 'relic'], ['SERVICES', it => it.kind === 'service'],
    ];
    // the item list scrolls (wheel, arrow keys or drag) when it doesn't fit
    const top = 80, bottom = H - 4, viewH = bottom - top, left = 4, right = 484;
    const m = Engine.mouse, over = m.x >= left && m.x <= right && m.y >= top && m.y <= bottom;
    const maxScroll = Math.max(0, (this.contentH || 0) - viewH);
    let sc = this.scroll || 0;
    if (over && m.wheel) sc += m.wheel * 24;
    if (keyPressed('ArrowDown')) sc += 24;
    if (keyPressed('ArrowUp')) sc -= 24;
    if (m.justPressed && over) this.drag = { y: m.y, moved: false };
    if (this.drag && m.down) { if (Math.abs(m.y - this.drag.y) > 4) this.drag.moved = true; if (this.drag.moved) { sc -= m.y - this.drag.y; this.drag.y = m.y; } }
    const dragged = this.drag?.moved && !m.down;
    if (!m.down) this.drag = null;
    this.scroll = Math.max(0, Math.min(maxScroll, sc));
    ctx.save(); ctx.beginPath(); ctx.rect(left, top, right - left, viewH); ctx.clip();
    const y0 = top + 4 - this.scroll;
    let y = y0;
    const x0 = 8;
    for (const [title, f] of groups) {
      for (const it of this.shop.items) if (it.kind === 'relic' && !it.sold && run.hasRelic(it.key)) { it.sold = true; it.owned = true; }
      const list = this.shop.items.filter(f);
      if (!list.length) continue;
      text(ctx, title, x0 + 4, y, { color: 'gold', font: 'small' });
      if (title === 'HELD ITEMS') { const nb = this.shop.relicsBought || 0; text(ctx, nb >= TUNING.shopRelicBuys ? `·  limit reached (${TUNING.shopRelicBuys} per visit)` : `·  ${nb}/${TUNING.shopRelicBuys} bought this visit`, x0 + 10 + measure(title, 'small'), y, { color: nb >= TUNING.shopRelicBuys ? 'orange' : 'gray', font: 'small' }); }
      y += 12;
      list.forEach((it, i) => {
        const cw = 116, ch = 34;
        const cx = x0 + (i % 4) * (cw + 3), cy = y + Math.floor(i / 4) * (ch + 3);
        const can = !it.sold && run.money >= it.price;
        const hot = !it.sold && over && !this.drag?.moved && hover(cx, cy, cw, ch);
        pixBox(ctx, cx, cy, cw, ch, it.sold ? '#222630' : hot ? '#3e4c70' : '#2a3246', hot ? '#f8d038' : it.kind === 'relic' ? relCol(it.key) : '#141820', 3);
        const icon = it.kind === 'service' ? itemPath('TM_CASE') : it.kind === 'tm' ? itemPath(it.key) : itemPath(it.key);
        draw(ctx, icon, cx + 3, cy + 5, { alpha: it.sold ? 0.3 : 1 });
        const name = it.kind === 'service' ? it.name : it.kind === 'tm' ? `${it.key.slice(0, 4)} ${D.moves[it.move]?.name}` : (D.items[it.key]?.name || it.key);
        textFit(ctx, name, cx + 29, cy + 4, cw - 32, { color: it.sold ? 'gray' : 'white', font: 'small' });
        text(ctx, it.sold ? 'SOLD' : '$' + it.price, cx + 29, cy + 17, { color: it.sold ? 'gray' : can ? 'gold' : 'red' });
        if (hot) {
          const desc = it.kind === 'relic' ? RELICS[it.key].desc + `\n\n${RELICS[it.key].rarity.toUpperCase()} HELD ITEM` : it.kind === 'tm' ? `Teach ${D.moves[it.move]?.name} (${D.moves[it.move]?.type}, PWR ${D.moves[it.move]?.power || '-'}).\n${D.moves[it.move]?.desc}` : it.kind === 'service' ? it.desc : consumableDesc(it.key);
          tip(name, desc + (it.stock ? '\n(Unlimited stock)' : ''));
          if (Engine.mouse.clicked && !dragged) this.buy(it);
        }
      });
      y += Math.ceil(list.length / 4) * 37 + 2;
    }
    ctx.restore();
    this.contentH = y - y0 + 4;
    if (maxScroll > 0) {
      const barH = Math.max(16, viewH * viewH / this.contentH), barY = top + (viewH - barH) * (this.scroll / maxScroll);
      rect(ctx, right - 3, top, 3, viewH, '#ffffff22');
      rect(ctx, right - 3, barY, 3, barH, '#f8d038');
      if (this.scroll < maxScroll) text(ctx, 'scroll for more', (left + right) / 2, bottom - 10, { align: 'center', color: 'gray', font: 'small' });
    }
    // party panel right
    panel(ctx, 488, 82, 148, 30 * run.party.length + 10);
    drawPartyPanel(ctx, run, 492, 86, 140, { tipX: 300 });
    this.drawReroll(ctx, run);
    if (button(ctx, 'LEAVE', 488, H - 34, 148, 26, { color: THEME.green })) { Sound.playSE('se_exit'); if (this.opts.onLeave) this.opts.onLeave(); else goToMap(); }
    drawTips(ctx);
  }
  // A reroll refreshes the unsold TMs and held items. At the held-item limit (TUNING.shopRelicBuys per visit) it would
  // only bring new TMs: it asks for a second click, and it's off when no TM is left to roll either.
  drawReroll(ctx, run) {
    const shop = this.shop, cost = shop.rerollCost, bx = 488, by = H - 64, bw = 148, bh = 24;
    const atLimit = !shop.plateau && (shop.relicsBought || 0) >= TUNING.shopRelicBuys;
    let tmsLeft = true;
    if (atLimit) {
      // (a dry roll on a throwaway RNG: the shop's own RNG is untouched)
      const listed = shop.items.filter(it => it.kind !== 'tm' || it.sold).map(it => it.key);
      const key = listed.join() + '|' + run.party.map(m => m.species + m.moves.map(x => x.move).join('.')).join();
      if (this._tmKey !== key) { this._tmKey = key; this._tmsLeft = tmChoices(run, new RNG('dry'), 1, listed).length > 0; }
      tmsLeft = this._tmsLeft;
    }
    if (this.armT > 0) this.armT -= Engine.dt; else this.armed = false;
    if (!atLimit) this.armed = false;
    const poor = run.money < cost;
    const label = this.armed ? `TMs ONLY? $${cost}` : `REROLL $${cost}`;
    if (button(ctx, label, bx, by, bw, bh, { color: this.armed ? '#c07020' : atLimit ? '#705a80' : '#a060c0', disabled: poor || (atLimit && !tmsLeft) })) {
      if (atLimit && !this.armed) {
        this.armed = true; this.armT = 4;
        this.say = "That's all the held items I sell per visit! A reroll only adds new TMs: click again.";
        Sound.playSE('se_select');
      } else if (rerollShop(run, shop, this.rng)) { this.armed = false; Sound.playSE('se_shop'); saveRun(); }
    }
    if (atLimit && hover(bx, by, bw, bh)) tip('HELD ITEM LIMIT', `This MART sells you ${TUNING.shopRelicBuys} held items per visit and you've bought ${TUNING.shopRelicBuys}: a reroll's new held items couldn't be bought.\n${tmsLeft ? 'It would still roll new TMs: click twice to reroll anyway.' : 'No other TM is left to roll for your team either, so rerolling is off.'}`, { width: 210 });
  }
}
function relCol(k) { const r = RELICS[k]?.rarity; return r === 'rare' ? '#f8d038' : r === 'uncommon' ? '#58a8f8' : '#808080'; }
