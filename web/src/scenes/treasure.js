// Item ball node: a free consumable plus a chance at a held item.
import { TUNING } from '../game/run.js';
import { Engine, W, H } from '../engine/core.js';
import { draw, itemPath } from '../engine/assets.js';
import { text, textBlock } from '../engine/font.js';
import { swirlBackground, BG_THEMES, button, panel, drawTips, THEME, tip } from '../engine/ui.js';
import { burst, drawFx } from '../engine/fx.js';
import { D } from '../game/data.js';
import { RELICS } from '../game/items.js';
import { G, saveRun } from '../game/state.js';
import { Sound } from '../audio/sound.js';
import { drawHUD, consumableDesc } from './common.js';
import { goToMap } from './flow.js';
import { pick, RelicChoiceModal } from './reward.js';
import { useConsumableOutside, offerItem } from './items_ui.js';
import { ChoiceModal } from './common.js';

export class TreasureScene {
  enter() {
    const run = G.run;
    const rng = run.rng.fork('treasure' + run.nodeId);
    this.item = run.randomConsumable(rng, run.actIndex + 1);
    this.relics = rng.chance(TUNING.relicOdds.treasure) ? run.relicChoices(rng, 2, { common: 40, uncommon: 45, rare: 15 }) : [];
    this.relics = this.relics.filter(k => !run.hasRelic(k));
    this.opened = false; this.taken = false; this.relicTaken = false; this.t = 0;
    Sound.playBGM(run.act.music[0]);
  }
  update(dt) { this.t += dt; }
  // Bag-full picker for the item ball's item (use it now / use or sell a bag item / leave it).
  async makeRoom() {
    if (this.busy || this.taken) return;
    this.busy = true;
    try {
      const res = await offerItem(this.item);
      if (res === 'stored' || res === 'used') { this.taken = true; this.used = res === 'used'; }
    } finally { this.busy = false; }
    saveRun();
  }
  draw(ctx) {
    const run = G.run;
    swirlBackground(ctx, BG_THEMES.gold, 0.5);
    drawHUD(ctx, run, { subtitle: 'ITEM BALL', onConsumableClick: k => useConsumableOutside(k) });
    panel(ctx, 170, 60, 300, 240);
    if (!this.opened) {
      draw(ctx, 'gfx/overworld/misc/item_ball.png', 296, 120 + Math.sin(this.t * 4) * 3, { scale: 3 });
      text(ctx, 'There is an item on the ground!', 320, 80, { align: 'center', color: 'white' });
      if (button(ctx, 'PICK IT UP', 250, 220, 140, 28, { color: THEME.play })) {
        this.opened = true; Sound.playFanfare('mus_obtain_item'); burst(320, 150, { color: ['#fff', '#f8d038'], n: 20 });
        if (run.addConsumable(this.item)) this.taken = true;
        run.inNode = false; // opened: a reload must not hand out the same item ball again
        saveRun();
        // full BAG: choose what to do with it first, then the held item (if any)
        (this.taken ? Promise.resolve() : this.makeRoom()).then(() => {
          if (this.relics.length) pick(new RelicChoiceModal({ title: 'There was a held item too! Take one:', choices: this.relics })).then(k => { if (k && run.addRelic(k)) Sound.playFanfare('mus_obtain_item'); this.relicTaken = true; saveRun(); });
        });
      }
    } else {
      draw(ctx, itemPath(this.item), 296, 90, { scale: 2 });
      text(ctx, `You found ${D.items[this.item]?.name}!`, 320, 144, { align: 'center', color: 'gold' });
      textBlock(ctx, consumableDesc(this.item), 190, 160, 260, { color: 'whiteSoft', font: 'small' });
      if (this.used) text(ctx, 'You used it right away.', 320, 186, { align: 'center', color: 'lime', font: 'small' });
      else if (!this.taken) {
        text(ctx, 'Your BAG is full. You left it here.', 320, 186, { align: 'center', color: 'red', font: 'small' });
        if (button(ctx, 'MAKE ROOM...', 250, 200, 140, 22, { color: THEME.play, font: 'small', disabled: this.busy })) this.makeRoom();
      }
      if (this.relics.length && !this.relicTaken) {
        if (button(ctx, 'Search the area...', 220, 230, 200, 24, { color: '#a060c0' })) {
          pick(new RelicChoiceModal({ title: 'You found a hidden item! Take one:', choices: this.relics })).then(k => { if (k && run.addRelic(k)) { Sound.playFanfare('mus_obtain_item'); } this.relicTaken = true; saveRun(); });
        }
      }
      if (button(ctx, 'CONTINUE', 250, 266, 140, 26, { color: THEME.green, disabled: this.busy })) {
        const name = D.items[this.item]?.name || this.item;
        if (this.taken) goToMap();
        else pick(new ChoiceModal({ title: `Leave the ${name} behind?`, body: 'Your BAG is full. You can still make room for it.', options: [{ label: 'Make room', value: 1, color: THEME.green }, { label: 'Leave it', value: 0, color: THEME.discard }] }))
          .then(v => { if (v === 1) this.makeRoom(); else if (v === 0) goToMap(); });
      }
    }
    drawFx(ctx, Engine.dt);
    drawTips(ctx);
  }
}
