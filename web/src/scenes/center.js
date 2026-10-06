// Pokémon Center: heal OR train (StS rest site).
import { Engine, W, H, wait, hover } from '../engine/core.js';
import { draw } from '../engine/assets.js';
import { text, textBlock } from '../engine/font.js';
import { swirlBackground, BG_THEMES, button, panel, drawTips, THEME, tip } from '../engine/ui.js';
import { D } from '../game/data.js';
import { G, saveRun } from '../game/state.js';
import { addLevels, monName, isFainted, maxHp } from '../game/pokemon.js';
import { Sound } from '../audio/sound.js';
import { drawHUD, drawPartyPanel, PartyPicker, DeckModal } from './common.js';
import { goToMap } from './flow.js';
import { pick, processLevelEvents, toastMsg } from './reward.js';
import { useConsumableOutside, deleteCard } from './items_ui.js';
import { pushOverlay } from '../engine/core.js';

export class CenterScene {
  enter() {
    this.t = 0; this.done = false; this.busy = false;
    Sound.playBGM('mus_poke_center');
    this.say = 'Welcome to our POKéMON CENTER! We can restore your tired POKéMON... or would you rather train?';
  }
  update(dt) { this.t += dt; }
  async heal() {
    this.busy = true;
    G.run.logEvent({ k: 'center', hp: G.run.teamHpFrac() });
    G.run.centerHeal();
    G.run.inNode = false; // used up: a reload must not offer the Center again
    this.say = "Okay, I'll take your POKéMON for a few seconds.";
    await Sound.playFanfare('mus_heal');
    this.say = "Thank you for waiting. We've restored your POKéMON to full health. We hope to see you again!";
    this.done = true; this.busy = false; saveRun();
  }
  async train() {
    const mon = await pick(new PartyPicker({ title: 'Train which POKéMON? (+3 levels)', filter: m => isFainted(m) ? 'Fainted' : m.level >= 100 ? 'Max level' : true, sub: m => `Lv${m.level} → Lv${Math.min(100, m.level + 3)}` }));
    if (!mon) return;
    this.busy = true;
    const ev = addLevels(mon, 3);
    G.run.inNode = false;
    await Sound.playFanfare('mus_level_up');
    this.say = `${monName(mon)} trained hard and grew to Lv${mon.level}!`;
    await processLevelEvents([{ mon, events: ev }]);
    this.done = true; this.busy = false; saveRun();
  }
  async forget() {
    this.busy = true;
    G.run.inNode = false; // deleteCard() saves; don't let a reload hand out the Center again
    if (await deleteCard()) { this.say = 'The MOVE DELETER trimmed your deck.'; this.done = true; } else G.run.inNode = true;
    this.busy = false;
  }
  // CLEANSE (v0.0.7): pay to remove one curse held item. Doesn't use up the Center visit.
  async cleanse() {
    const run = G.run;
    const cs = run.curses();
    if (!cs.length) return;
    this.busy = true;
    try {
      let key = cs[0];
      if (cs.length > 1) {
        const { RelicPickModal } = await import('./event.js');
        key = await pick(new RelicPickModal({ title: `CLEANSE which curse? ($${run.cleanseCost()})`, keys: cs, verb: 'cleanse it' }));
      }
      if (key && run.cleanse(key)) {
        Sound.playSE('se_use_item');
        this.say = `There... the ${D.items[key]?.name || key} is gone. Please take better care of yourself!`;
        saveRun();
      }
    } finally { this.busy = false; }
  }
  draw(ctx) {
    const run = G.run;
    swirlBackground(ctx, BG_THEMES.center, 0.4);
    drawHUD(ctx, run, { subtitle: 'POKéMON CENTER', onDeck: () => pushOverlay(new DeckModal({})), onConsumableClick: k => useConsumableOutside(k) });
    draw(ctx, 'gfx/overworld/people/nurse.png', 180, 60, { sx: 0, sy: 0, sw: 16, sh: 32, scale: 3 });
    panel(ctx, 240, 50, 380, 60, 'paper');
    textBlock(ctx, 'NURSE JOY: ' + this.say, 252, 58, 356, { color: 'dark' });
    panel(ctx, 6, 36, 160, 30 * run.party.length + 10);
    drawPartyPanel(ctx, run, 10, 40, 152, { showExp: true, tipX: 170 });
    const avg = run.party.reduce((a, m) => a + m.hp / maxHp(m), 0) / run.party.length;
    if (!this.done) {
      if (button(ctx, 'HEAL', 250, 140, 170, 50, { color: '#e05890', disabled: this.busy, sub: 'Full HP & status' })) this.heal();
      if (button(ctx, 'TRAIN', 440, 140, 170, 50, { color: THEME.orange, disabled: this.busy, sub: 'One POKéMON +3 Lv' })) this.train();
      if (button(ctx, 'MOVE DELETER', 250, 200, 360, 30, { color: '#6060a0', disabled: this.busy, sub: null })) this.forget();
      text(ctx, `Team HP: ${Math.round(avg * 100)}%`, 430, 240, { align: 'center', color: 'whiteSoft', font: 'small' });
      if (run.curses().length) {
        const c = run.cleanseCost();
        if (button(ctx, `CLEANSE A CURSE ($${c})`, 250, 256, 360, 26, { color: '#8030b0', disabled: this.busy || run.money < c })) this.cleanse();
        if (hover(250, 256, 360, 26)) tip('CLEANSE', `Remove one curse held item for $${c}. You can still heal or train afterwards.`, { accent: '#c050f0' });
      }
    } else if (button(ctx, 'CONTINUE', 340, 170, 180, 30, { color: THEME.green, disabled: this.busy })) goToMap();
    drawTips(ctx);
  }
}
