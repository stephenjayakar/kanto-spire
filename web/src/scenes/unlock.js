// "Choose a new starter" after an act clear: a modal with up to 3 still-locked starters (game/unlocks.js).
// The pending offer lives in G.meta, so a reload (or a scene change that drops the overlay) shows it again
// the next time showPendingStarterOffer() runs. Purely local meta: no run state, no run.rng.
import { W, H, hover, clicked, pushOverlay, topOverlay } from '../engine/core.js';
import { text } from '../engine/font.js';
import { button, panel, pixBox, drawTips, THEME } from '../engine/ui.js';
import { D } from '../game/data.js';
import { G, saveMeta, unlockShiny, SHINY_ASC } from '../game/state.js';
import { familyOf } from '../game/run.js';
import { grantStarterOffer, currentStarterOffer, claimStarterOffer, coopActKey, grantCoopWin } from '../game/unlocks.js';
import { Sound } from '../audio/sound.js';
import { drawMon, typeIcon, Modal } from './common.js';

const has = (s) => !!D.species[s];

export class StarterUnlockModal extends Modal {
  constructor(opts) { super({ cancelable: false, ...opts }); this.sel = -1; }
  draw(ctx) {
    this.dim(ctx);
    const o = this.offer, n = o.options.length;
    const tw = 120, gap = 10, w = Math.max(300, n * tw + (n - 1) * gap + 28), h = 232;
    const x = Math.round((W - w) / 2), y = Math.round((H - h) / 2);
    panel(ctx, x, y, w, h);
    text(ctx, 'CHOOSE A NEW STARTER', W / 2, y + 8, { align: 'center', color: 'gold' });
    text(ctx, 'Act clear! Unlock one POKéMON as a starter for future runs.', W / 2, y + 26, { align: 'center', color: 'whiteSoft', font: 'small' });
    const gx = Math.round(W / 2 - (n * tw + (n - 1) * gap) / 2);
    o.options.forEach((sp, i) => {
      const s = D.species[sp];
      const cx = gx + i * (tw + gap), cy = y + 42;
      const hot = hover(cx, cy, tw, 132), sel = this.sel === i;
      pixBox(ctx, cx, cy, tw, 132, sel ? '#4a5c88' : hot ? '#38445e' : '#262c3c', sel ? '#f8d038' : '#141820', 3);
      drawMon(ctx, sp, cx + tw / 2 - 32, cy + 4 + (sel ? Math.sin(this.t * 6) * 1.5 : 0));
      text(ctx, s?.name || sp, cx + tw / 2, cy + 72, { align: 'center', color: 'white' });
      const types = s?.types || [];
      types.forEach((t, k) => typeIcon(ctx, t, cx + tw / 2 - types.length * 17 + k * 34, cy + 90));
      if (s) text(ctx, `HP ${s.stats.hp} ATK ${s.stats.atk} SPA ${s.stats.spa}`, cx + tw / 2, cy + 110, { align: 'center', color: 'gray', font: 'small' });
      if (hot && clicked(cx, cy, tw, 132)) { this.sel = i; Sound.playCry(sp); }
    });
    const pick = o.options[this.sel];
    if (button(ctx, pick ? `UNLOCK ${D.species[pick]?.name || pick}` : 'PICK ONE', W / 2 - 90, y + h - 40, 180, 28, { color: THEME.green, disabled: !pick })) this.choose(pick);
    drawTips(ctx);
  }
  choose(species) {
    if (!claimStarterOffer(G.meta, this.offer.key, species)) { this.close(null); return; }
    saveMeta();
    Sound.playSE('se_select');
    this.close(species);
    showPendingStarterOffer(); // another act clear still waiting (e.g. after a reload)
  }
}

// Shows the first pending offer (if any and none is open yet).
export function showPendingStarterOffer() {
  if (!G.meta || topOverlay() instanceof StarterUnlockModal) return null;
  const before = JSON.stringify(G.meta.starterOffers || []);
  const offer = currentStarterOffer(G.meta, { has });
  if (JSON.stringify(G.meta.starterOffers || []) !== before) saveMeta();
  return offer ? pushOverlay(new StarterUnlockModal({ offer })) : null;
}

// An act was cleared: grant its offer (once per key) and show the choice.
export function offerStarterUnlock(key) {
  if (!G.meta) return null;
  if (grantStarterOffer(G.meta, key, { has })) saveMeta();
  return showPendingStarterOffer();
}

// Co-op: every act cleared in this room (game.events actClear, plus the final victory) grants each
// player their own offer. Idempotent (keyed by room + act), so calling it on every map / end screen
// also covers reloads and REJOIN.
export function coopStarterOffers(session) {
  const g = session?.game;
  if (!g || !G.meta || !session.roomId) return null;
  let changed = false;
  for (const e of Array.isArray(g.events) ? g.events : []) {
    if (e?.t === 'actClear' && Number.isFinite(e.act) && grantStarterOffer(G.meta, coopActKey(session.roomId, e.act - 1), { has })) changed = true;
  }
  if (g.phase === 'victory' && g.world && grantStarterOffer(G.meta, coopActKey(session.roomId, g.world.actIndex), { has })) changed = true;
  // a co-op win unlocks the next ascension for this player's own starter, like a solo win
  if (g.phase === 'victory' && g.world) {
    const mine = g.runs?.[session.mySlot]?.starter ?? g.starters?.[session.mySlot];
    const asc = g.ascension ?? g.world.ascension ?? 0;
    if (grantCoopWin(G.meta, mine, asc)) changed = true;
    // ...and at A5+ its shiny form, like a solo win (the end screen shows it)
    if (mine && asc >= SHINY_ASC) {
      const fresh = !!unlockShiny({ starter: mine, ascension: asc }, G.meta);
      if (fresh) changed = true;
      session.coopShiny = { fam: familyOf(mine), isNew: fresh || !!session.coopShiny?.isNew };
    }
  }
  if (changed) saveMeta();
  return showPendingStarterOffer();
}
