// Shared drawing: cards, mon sprites, HUD, party panel, modals.
import { Engine, W, H, hover, clicked, inRect, pushOverlay, popOverlay, keyPressed } from '../engine/core.js';
import { img, ready, draw, itemPath, typePath, trainerPath, tinted } from '../engine/assets.js';
import { text, measure, textFit, wrap, textBlock, COLORS } from '../engine/font.js';
import { panel, pixBox, rect, button, tip, hpBar, THEME, shade, windowFrame, drawTips, closeButton } from '../engine/ui.js';
import { D, TYPE_COLORS, isSpecialMove, typeEffect } from '../game/data.js';
import { FIXED_DAMAGE } from '../game/effects.js';
import { COMBOS, COMBO_ORDER, comboBonus } from '../game/hands.js';
import { maxHp, monName, stats, typesOf, isFainted, expProgress } from '../game/pokemon.js';
import { RELICS, BADGES, CONSUMABLES, badgeIcon } from '../game/items.js';
import { G } from '../game/state.js';
import { TUNING, LEVEL_CAP_ASC } from '../game/run.js';
import { Sound } from '../audio/sound.js';

export const GFX = { manifest: null };

export function monFolder(species) {
  const m = GFX.manifest?.pokemonSpecies;
  if (m && m['SPECIES_' + species]) return m['SPECIES_' + species];
  const g = D.species[species]?.gfx || species.toLowerCase();
  return g.replace('/', '_');
}
export function monSprite(species, kind = 'front', shiny = false) { return `gfx/pokemon/${monFolder(species)}/${kind}${shiny ? '_shiny' : ''}.png`; }

// 32x32 party icon (2 frames stacked vertically), animated.
export function drawIcon(ctx, species, x, y, opts = {}) {
  const path = `gfx/pokemon/${monFolder(species)}/icon.png`;
  const frame = opts.still ? 0 : Math.floor((Engine.time * (opts.fast ? 6 : 3)) % 2);
  const im = img(path);
  if (!ready(im)) return;
  ctx.save();
  if (opts.alpha !== undefined) ctx.globalAlpha *= opts.alpha;
  if (opts.gray) ctx.filter = 'grayscale(1) brightness(0.7)';
  const s = opts.scale || 1;
  ctx.drawImage(im, 0, frame * 32, 32, 32, Math.round(x), Math.round(y - (frame && !opts.still ? 1 : 0)), 32 * s, 32 * s);
  ctx.restore();
}

export function drawMon(ctx, species, x, y, opts = {}) {
  const path = monSprite(species, opts.back ? 'back' : 'front', opts.shiny);
  const im = img(path);
  if (!ready(im)) return;
  const s = opts.scale || 1;
  ctx.save();
  if (opts.alpha !== undefined) ctx.globalAlpha *= opts.alpha;
  if (opts.silhouette) { const t = tinted(path, opts.silhouette, 1); if (t) ctx.drawImage(t, 0, 0, 64, 64, Math.round(x), Math.round(y), 64 * s, 64 * s); }
  else ctx.drawImage(im, 0, 0, 64, 64, Math.round(x), Math.round(y), 64 * s, 64 * s);
  if (opts.flash) { const t = tinted(path, '#ffffff', 1); if (t) { ctx.globalAlpha *= opts.flash; ctx.drawImage(t, 0, 0, 64, 64, Math.round(x), Math.round(y), 64 * s, 64 * s); } }
  ctx.restore();
}

// Opaque bounding box of the first w x h frame of an image (cached once it has loaded).
const boundsCache = new Map();
export function opaqueBounds(path, w = 64, h = 64) {
  let b = boundsCache.get(path);
  if (b) return b;
  const im = img(path);
  if (!ready(im)) return null;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d');
  x.drawImage(im, 0, 0, w, h, 0, 0, w, h);
  const d = x.getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
    if (d[(yy * w + xx) * 4 + 3]) { if (xx < x0) x0 = xx; if (xx > x1) x1 = xx; if (yy < y0) y0 = yy; if (yy > y1) y1 = yy; }
  }
  b = x1 < 0 ? { x: 0, y: 0, w, h } : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  boundsCache.set(path, b);
  return b;
}

// A mon sprite at 1x (never resampled), cropped to its opaque pixels and centred on (cx, cy).
// opts.bottom: align its feet to cy instead.
export function drawMonCentered(ctx, species, cx, cy, opts = {}) {
  const path = monSprite(species, opts.back ? 'back' : 'front', opts.shiny);
  const b = opaqueBounds(path);
  if (!b) return;
  const src = opts.silhouette ? tinted(path, opts.silhouette, 1) : img(path);
  if (!src) return;
  ctx.save();
  if (opts.alpha !== undefined) ctx.globalAlpha *= opts.alpha;
  ctx.drawImage(src, b.x, b.y, b.w, b.h, Math.round(cx - b.w / 2), Math.round(opts.bottom ? cy - b.h : cy - b.h / 2), b.w, b.h);
  ctx.restore();
}

// A w x h window of an image at 1x: horizontally centred on its opaque pixels, from their top down
// (a head-and-shoulders crop of a trainer pic), for small slots that would otherwise need a resample.
export function drawPortrait(ctx, path, x, y, w, h, opts = {}) {
  const im = img(path), b = opaqueBounds(path, im.naturalWidth, im.naturalHeight); // (any pic size)
  if (!b) return;
  const iw = im.naturalWidth, ih = im.naturalHeight;
  const sx = Math.max(0, Math.min(iw - w, b.x + Math.floor((b.w - w) / 2))), sy = Math.max(0, Math.min(ih - h, b.y));
  ctx.save();
  if (opts.alpha !== undefined) ctx.globalAlpha *= opts.alpha;
  ctx.drawImage(im, sx, sy, w, h, Math.round(x), Math.round(y), w, h);
  ctx.restore();
}

// A trainer pic in the 64x64 FireRed frame at (x, y). All shipped pics are 64x64 (tools/extract_hgss.py shrinks the
// 80x80 HGSS portraits to FireRed's scale); a pic of any other size would sit at the frame's bottom centre, so feet
// line up and extra height grows upward. opts.minTop: the figure's top (its opaque pixels)
// never goes above this y (it moves down instead), for clipped scenes. Same integer scale, never resampled.
export function drawTrainer(ctx, pic, x, y, opts = {}) {
  const path = trainerPath(pic), im = img(path);
  if (!ready(im)) return false;
  const s = opts.scale || 1, iw = im.naturalWidth, ih = im.naturalHeight;
  let dy = y + (64 - ih) * s;
  if (opts.minTop !== undefined && ih > 64) {
    const b = opaqueBounds(path, iw, ih);
    if (b && dy + b.y * s < opts.minTop) dy = Math.min(y, opts.minTop - b.y * s);
  }
  return draw(ctx, im, x + Math.round((64 - iw) / 2) * s, dy, opts);
}

export function typeIcon(ctx, type, x, y) { return draw(ctx, typePath(type), x, y); }
// Type icons (32x12) in a row from x, or a grey MIXED tag when there are none. Returns the width drawn.
export function drawTypeTags(ctx, types, x, y) {
  if (!types.length) { pixBox(ctx, x, y, 34, 12, '#606870', '#303438', 2); text(ctx, 'MIXED', x + 17, y + 1, { align: 'center', color: 'white', font: 'small' }); return 34; }
  types.forEach((t, i) => typeIcon(ctx, t, x + i * 34, y));
  return types.length * 34 - 2;
}
export const typeTagsWidth = (types) => (types.length ? types.length * 34 - 2 : 34);

// ---- cards ----------------------------------------------------------------------------------
export const CARD_W = 60, CARD_H = 84;

const EFFECT_SHORT = {
  ATTACK_DOWN: 'FOE ATK -1', ATTACK_DOWN_2: 'FOE ATK -2', DEFENSE_DOWN: 'FOE DEF -1', DEFENSE_DOWN_2: 'FOE DEF -2', SPEED_DOWN: 'FOE SPE -1',
  SPEED_DOWN_2: 'FOE SPE -2', ACCURACY_DOWN: 'FOE ACC -1', EVASION_DOWN: 'FOE EVA -1', SPECIAL_DEFENSE_DOWN_2: 'FOE SPD -2', TICKLE: 'FOE ATK/DEF -1',
  ATTACK_UP: 'ATK +1', ATTACK_UP_2: 'ATK +2', DEFENSE_UP: 'DEF +1', DEFENSE_UP_2: 'DEF +2', SPEED_UP_2: 'SPEED +2', SPECIAL_ATTACK_UP: 'SP.ATK +1',
  SPECIAL_ATTACK_UP_2: 'SP.ATK +2', SPECIAL_DEFENSE_UP_2: 'SP.DEF +2', EVASION_UP: 'EVASION +1', MINIMIZE: 'EVASION +1', DEFENSE_CURL: 'DEF +1',
  CALM_MIND: 'SPA/SPD +1', BULK_UP: 'ATK/DEF +1', DRAGON_DANCE: 'ATK/SPE +1', COSMIC_POWER: 'DEF/SPD +1', GROWTH: 'SP.ATK +1', BELLY_DRUM: 'MAX ATK',
  SLEEP: 'SLEEP', POISON: 'POISON', TOXIC: 'BADLY POISON', PARALYZE: 'PARALYZE', WILL_O_WISP: 'BURN', CONFUSE: 'CONFUSE', SWAGGER: 'CONFUSE',
  FLATTER: 'CONFUSE', TEETER_DANCE: 'CONFUSE', YAWN: 'SLEEP NEXT TURN', ATTRACT: 'INFATUATE', LEECH_SEED: 'LEECH SEED', PROTECT: 'PROTECT', ENDURE: 'ENDURE',
  REFLECT: 'REFLECT', LIGHT_SCREEN: 'LIGHT SCREEN', SAFEGUARD: 'SAFEGUARD', MIST: 'MIST', RESTORE_HP: 'HEAL 50%', SOFTBOILED: 'HEAL 50%',
  MORNING_SUN: 'HEAL 50%', SYNTHESIS: 'HEAL 50%', MOONLIGHT: 'HEAL 50%', REST: 'FULL HEAL+SLEEP', HEAL_BELL: 'CURE TEAM', REFRESH: 'CURE',
  SUBSTITUTE: 'SUBSTITUTE', FOCUS_ENERGY: 'CRIT UP', LOCK_ON: 'NEXT HITS', HAZE: 'RESET STATS', SUNNY_DAY: 'SUN', RAIN_DANCE: 'RAIN',
  SANDSTORM: 'SANDSTORM', HAIL: 'HAIL', SPLASH: 'NOTHING!', CURSE: 'CURSE', SPIKES: 'SPIKES', WISH: 'WISH', INGRAIN: 'ROOTS',
  STOCKPILE: 'STOCKPILE', SWALLOW: 'HEAL', PAIN_SPLIT: 'SHARE HP', CHARGE: 'CHARGE', HELPING_HAND: 'x1.5 DMG', TAUNT: 'TAUNT', DISABLE: 'DISABLE',
  ENCORE: 'ENCORE', TORMENT: 'TORMENT', PERISH_SONG: 'PERISH', DESTINY_BOND: 'DESTINY BOND', MEAN_LOOK: 'TRAP', TELEPORT: 'ESCAPE', ROAR: 'ROAR',
  BATON_PASS: 'FREE SWITCH', NIGHTMARE: 'NIGHTMARE', FORESIGHT: 'FORESIGHT', PSYCH_UP: 'COPY STATS', MAGIC_COAT: 'REFLECT STATUS',
  WATER_SPORT: 'FIRE -50%', MUD_SPORT: 'ELEC -50%', MEMENTO: 'MEMENTO', FOLLOW_ME: '+2 NEXT TURN', RECYCLE: '+2 NEXT TURN', TRICK: '+2 NEXT TURN',
  SKILL_SWAP: '+2 NEXT TURN', ROLE_PLAY: '+2 NEXT TURN', MIMIC: 'COPY FOE MOVE', TRANSFORM: 'COPY 2 MOVES', CONVERSION: '+1 NEXT TURN',
  CONVERSION_2: '+1 NEXT TURN', CAMOUFLAGE: '+1 NEXT TURN', SKETCH: 'COPY FOE MOVE',
  SPITE: 'FOE ATK -1', IMPRISON: 'FOE SPA -1', GRUDGE: 'DESTINY BOND',
};
// info (optional): the card, for effects that depend on its owner (CURSE: a GHOST curses the foe, others buff).
export function effectShort(move, info) {
  if (move.effect === 'CURSE') {
    const types = info?.owner ? typesOf(info.owner) : info?.species ? D.species[info.species]?.types || [] : [];
    return types.includes('GHOST') ? '-1/2 HP\nFOE -HP/TURN' : 'ATK/DEF +1\nSPE -1';
  }
  return EFFECT_SHORT[move.effect] || '';
}

export function drawCardBack(ctx, x, y, opts = {}) {
  x = Math.round(x); y = Math.round(y);
  pixBox(ctx, x, y, CARD_W, CARD_H, '#202020', '#101010', 4);
  pixBox(ctx, x + 2, y + 2, CARD_W - 4, CARD_H / 2 - 2, '#e83030', null, 3);
  pixBox(ctx, x + 2, y + CARD_H / 2, CARD_W - 4, CARD_H / 2 - 2, '#f0f0f0', null, 3);
  rect(ctx, x + 2, y + CARD_H / 2 - 2, CARD_W - 4, 4, '#202020');
  ctx.fillStyle = '#202020'; ctx.beginPath(); ctx.arc(x + CARD_W / 2, y + CARD_H / 2, 9, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#f0f0f0'; ctx.beginPath(); ctx.arc(x + CARD_W / 2, y + CARD_H / 2, 6, 0, Math.PI * 2); ctx.fill();
  if (opts.count !== undefined) text(ctx, String(opts.count), x + CARD_W / 2, y + CARD_H - 14, { align: 'center', color: 'dark', font: 'small' });
}

// Card ink: dark, saturated text with a soft shadow, readable on the cream (attack) and lavender (status)
// card faces at the small font size. The FireRed text colours are made for dark panels.
export const CARD_INK = {
  name: ['#1c1c26', '#c8c4bc'], dmg: ['#b83400', '#f0c8a8'], none: ['#686870', '#d4d4d8'], red: ['#c00000', '#f4b8a8'],
  blue: ['#1c3cb0', '#b8c8f0'], stab: ['#a04c00', '#f0d0a0'], kind: ['#484858', '#d0d0d8'], status: ['#5a1ea0', '#cfc0ee'],
};
// Text on a type colour band: white on dark bands, near-black on light ones (ELECTRIC, ICE, GROUND...).
export function inkOn(hex) {
  const n = parseInt(hex.slice(1), 16), lin = v => { v /= 255; return v <= 0.04 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const L = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return L > 0.3 ? ['#181820', shade(hex, 0.45)] : ['#ffffff', shade(hex, -0.55)];
}

// info = battle.cardInfo(card) (or a lightweight equivalent for deck views)
export function drawCard(ctx, info, x, y, opts = {}) {
  x = Math.round(x); y = Math.round(y);
  if (info.faceDown && !opts.reveal) { drawCardBack(ctx, x, y); return; }
  const tcol = TYPE_COLORS[info.type] || '#888';
  const status = info.status;
  const sel = opts.selected;
  const border = sel ? '#f8d038' : opts.highlight ? '#ffffff' : '#1a1a22';
  pixBox(ctx, x - (sel ? 1 : 0), y - (sel ? 1 : 0), CARD_W + (sel ? 2 : 0), CARD_H + (sel ? 2 : 0), status ? '#e8e6f4' : '#faf8ef', border, 4);
  // type band
  pixBox(ctx, x + 2, y + 2, CARD_W - 4, 15, tcol, null, 3);
  rect(ctx, x + 2, y + 15, CARD_W - 4, 2, shade(tcol, -0.3));
  draw(ctx, typePath(info.type), x + 3, y + 3);
  if (!status) text(ctx, String(info.power || '—'), x + CARD_W - 4, y + 1, { align: 'right', color: inkOn(tcol), font: 'small' });
  // name (long names are condensed by whole pixels, never squashed)
  text(ctx, info.move.name, x + CARD_W / 2, y + 18, { font: 'small', color: CARD_INK.name, align: 'center', maxW: CARD_W - 4 });
  // owner icon
  if (info.species) {
    pixBox(ctx, x + 14, y + 32, 32, 26, status ? '#d8d4ec' : shade(tcol, 0.7), null, 3);
    drawIcon(ctx, info.species, x + 14, y + 27, { still: !opts.animate });
  }
  // P(hysical)/S(pecial): green when it uses the owner's better attacking stat
  if (!status && info.owner) {
    const st = stats(info.owner), good = info.physical ? st.atk >= st.spa : st.spa >= st.atk;
    pixBox(ctx, x + 47, y + 32, 11, 11, good ? '#2c8a48' : '#5c5c6c', null, 2);
    text(ctx, info.physical ? 'P' : 'S', x + 53, y + 32, { align: 'center', color: ['#ffffff', good ? '#14482a' : '#30303a'], font: 'small' });
  }
  // bottom: damage or effect
  if (!status) {
    // In battle this is the real damage against the current foe (STAB, type, its DEF, items included);
    // outside battle it's the damage against an even-level foe with equal stats.
    const mul = cardMult(info);
    const dmg = opts.dmgOverride ?? info.dmgPreview ?? 0;
    text(ctx, `${dmg} DMG`, x + CARD_W / 2, y + CARD_H - 26, { align: 'center', color: info.eff === 0 ? CARD_INK.none : CARD_INK.dmg, maxW: CARD_W - 4 });
    const eff = info.eff ?? 1;
    const [label, col] = eff === 0 ? ['NO EFFECT', CARD_INK.none] : eff > 1 ? ['SUPER x' + fmtMul(mul), CARD_INK.red] : eff < 1 ? ['WEAK x' + fmtMul(mul), CARD_INK.blue]
      : info.stab ? ['STAB x1.5', CARD_INK.stab] : [info.physical ? 'PHYSICAL' : 'SPECIAL', CARD_INK.kind];
    text(ctx, label, x + CARD_W / 2, y + CARD_H - 12, { align: 'center', color: col, font: 'small', maxW: CARD_W - 4 });
  } else {
    const eff = effectShort(info.move, info) || 'STATUS';
    const lines = eff.includes('\n') ? eff.split('\n') : wrap(eff, CARD_W - 6, 'small'); // (explicit lines are condensed to fit, not re-wrapped)
    lines.slice(0, 2).forEach((l, i) => text(ctx, l, x + CARD_W / 2, y + CARD_H - 25 + i * 10, { align: 'center', color: CARD_INK.status, font: 'small', maxW: CARD_W - 4 }));
  }
  if (!info.playable && !opts.ignorePlayable) {
    ctx.save(); ctx.globalAlpha = 0.55; pixBox(ctx, x, y, CARD_W, CARD_H, '#101018', null, 4); ctx.restore();
    text(ctx, info.reason || 'X', x + CARD_W / 2, y + CARD_H / 2 - 6, { align: 'center', color: 'white', font: 'small' });
  }
}

// Type effectiveness of a card against the current foe, for views outside the hand.
export function battleEff(b, info) {
  const e = b.enemy?.();
  if (!e || info.status) return {};
  return { eff: typeEffect(info.type, e.types) };
}

export function cardMult(info) { return (info.stab ? 1.5 : 1) * (info.eff ?? 1); }
function fmtMul(m) { return String(+m.toFixed(2)); }

export function cardTooltip(info, x, y, above = false) {
  const m = info.move;
  const lines = [];
  lines.push(`${info.type} · ${info.status ? 'STATUS' : (info.physical ? 'PHYSICAL' : 'SPECIAL')} · PWR ${m.power || '-'} · ACC ${m.accuracy || '-'}`);
  if (info.owner) lines.push(`Used by ${monName(info.owner)} Lv${info.owner.level}`);
  if (!info.status) {
    const st = info.owner ? stats(info.owner) : null;
    lines.push(`Damage: ${info.dmgPreview ?? '?'} (PWR ${m.power}, Lv${info.owner?.level ?? '?'} ${info.physical ? 'ATK' : 'SP.ATK'} ${st ? (info.physical ? st.atk : st.spa) : '?'} vs the foe's ${info.physical ? 'DEF' : 'SP.DEF'}${info.stab ? ', x1.5 STAB' : ''}${(info.eff ?? 1) !== 1 ? `, x${info.eff} type` : ''})`);
    if (st) { const good = info.physical ? st.atk >= st.spa : st.spa >= st.atk; lines.push(`${info.physical ? 'PHYSICAL (ATK)' : 'SPECIAL (SP.ATK)'}: ${good ? 'fits' : 'a poor fit for'} ${monName(info.owner)} (ATK ${st.atk} / SP.ATK ${st.spa}).`); }
    const eff = info.eff ?? 1;
    if (info.blockedBy) lines.push(`The foe's ${D.abilities[info.blockedBy]?.name || info.blockedBy} blocks ${info.type} moves: x0.`);
    else if (eff !== 1) lines.push(eff === 0 ? 'The foe is immune to this type: x0.' : `${eff > 1 ? 'Super effective' : 'Not very effective'} against the foe: x${eff}.`);
  }
  if (m.desc) lines.push(m.desc);
  if (info.card?.temp) lines.push('Copied card: it is used up when played (and lost if your lead switches out).');
  if (info.copies) lines.push(`${info.copies} ${info.copies > 1 ? 'copies' : 'copy'} of this card in its deck. Copies follow the move's PP (attacks PP/10 + 1, from 2 to 5; status moves 1-2). PP UP adds one.`);
  const CARD_NOTE = {
    SEMI_INVULNERABLE: 'As a card: hits now; if its user is your lead, the lead dodges the next attack.',
    SOLAR_BEAM: "As a card: hits now, then its user's cards rest next turn (not in sunlight).",
    RAZOR_WIND: "As a card: hits now, then its user's cards rest next turn.",
    SKULL_BASH: "As a card: hits now (+1 DEF), then its user's cards rest next turn.",
    SKY_ATTACK: "As a card: hits now, may flinch, then its user's cards rest next turn.",
    RECHARGE: "As a card: its user's cards must recharge next turn.",
    MULTI_HIT: 'Hits 2-5 times; every hit deals full damage (the preview assumes 3).',
    DOUBLE_HIT: 'Hits twice; both hits deal full damage.',
    COUNTER: 'Deals 2x the damage your lead took this turn.', MIRROR_COAT: 'Deals 2x the damage your lead took this turn.',
    SUPER_FANG: 'Halves the foe’s remaining HP once per hand (1/8 vs bosses and elites).',
    ENDEAVOR: 'Only works from your lead: cuts the foe’s HP down to your lead’s HP % (max 25% vs bosses).',
    LEVEL_DAMAGE: 'Deals damage equal to the user’s level, ignoring type and stats.',
    TELEPORT: 'Ends a wild battle (no rewards).', ROAR: 'Ends a wild battle; vs trainers the foe hesitates.',
  };
  if (CARD_NOTE[m.effect]) lines.push(CARD_NOTE[m.effect]);
  if (m.chance && m.power) lines.push(`${m.chance}% chance of its secondary effect.`);
  if (m.priority > 0) lines.push('Priority: your hand goes first.');
  // title: how many copies of this card its owner's deck holds, e.g. "PLUCK (3)" (copied MIMIC cards aren't in it)
  const n = info.card?.temp ? 0 : info.copies || info.owner?.moves?.find(x => x.move === m.key)?.copies || 0;
  tip(n ? `${m.name} (${n})` : m.name, lines.join('\n'), { accent: TYPE_COLORS[info.type], width: 190, x, y, above });
}

// ---- HUD (top bar) --------------------------------------------------------------------------
export function drawHUD(ctx, run, opts = {}) {
  rect(ctx, 0, 0, W, 26, '#11141c');
  rect(ctx, 0, 26, W, 1, '#2a3040');
  const act = run.act;
  text(ctx, opts.title || `${act.short}`, 6, 1, { color: 'white' });
  // A5+ LEVEL CAP: the act's cap after the act name
  const cap = run.levelCap?.();
  if (cap) {
    const cx = 6 + measure(opts.title || `${act.short}`) + 6, cw = measure(`Lv cap ${cap}`, 'small');
    if (cx + cw <= 108) {
      text(ctx, `Lv cap ${cap}`, cx, 3, { color: 'orange', font: 'small' });
      if (hover(cx - 2, 0, cw + 4, 13)) tip(`LEVEL CAP: Lv${cap}`, `A${LEVEL_CAP_ASC}+: battle EXP stops at Lv${cap} in this act (its boss's top level +${TUNING.levelCapOffset}). EXP past the cap is lost. RARE CANDY can still go past it.`, { width: 200 });
    }
  }
  text(ctx, opts.subtitle || (run.floor >= 0 ? (run.floor >= act.floors ? 'BOSS' : `FLOOR ${run.floor + 1}/${act.floors}`) : act.name), 6, 13, { color: 'gray', font: 'small' });
  // money
  let x = 112;
  text(ctx, '$' + run.money.toLocaleString(), x, 6, { color: 'gold' });
  x += Math.max(52, measure('$' + run.money.toLocaleString()) + 8);
  // balls
  draw(ctx, itemPath('POKE_BALL'), x - 4, 1);
  text(ctx, 'x' + run.totalBalls(), x + 18, 6, { color: 'white', font: 'small' });
  if (hover(x - 4, 1, 40, 24)) tip('POKé BALLS', Object.entries(run.balls).filter(([, n]) => n > 0).map(([k, n]) => `${D.items[k]?.name || k} x${n}`).join('\n') || 'None');
  x += 42;
  // consumables (the 3-slot bag)
  for (let i = 0; i < run.maxConsumables; i++) {
    const cx = x + i * 27, cy = 1;
    pixBox(ctx, cx, cy, 25, 24, '#241e30', '#3a2c46', 3);
    const k = run.consumables[i];
    if (k) {
      draw(ctx, itemPath(k), cx, cy);
      if (hover(cx, cy, 25, 24)) {
        tip(D.items[k]?.name || k, consumableDesc(k) + (opts.onConsumableClick ? (opts.noToss ? '\n\nClick to use.' : '\n\nClick to use or sell.') : ''), { accent: '#c890ff' });
        if (clicked(cx, cy, 25, 24) && opts.onConsumableClick) opts.onConsumableClick(k);
        else if (Engine.mouse.rclicked && opts.onConsumableClick && !opts.noToss) import('./items_ui.js').then(m => m.tossConsumable(k));
      }
    }
  }
  x += run.maxConsumables * 27 + 6;
  // held items: no limit; they pack tighter (and overlap) as the collection grows
  const relicX = x, rightLimit = W - 174;
  const n = run.relics.length;
  const step = n ? Math.max(7, Math.min(26, (rightLimit - relicX - 24) / Math.max(1, n - 1))) : 26;
  if (!n) { pixBox(ctx, relicX, 1, 25, 24, '#1e2330', '#2c3346', 3); text(ctx, 'held items', relicX + 30, 7, { color: 'gray', font: 'small' }); }
  let hot = -1;
  for (let i = n - 1; i >= 0; i--) {
    const w = i === n - 1 ? 25 : Math.min(25, step);
    if (hover(relicX + i * step, 1, w, 24)) { hot = i; break; }
  }
  for (let i = 0; i < n; i++) {
    const r = run.relics[i];
    const rx = relicX + i * step, ry = 1;
    const cursed = RELICS[r.key]?.curse;
    // curses: a purple box with a pulsing border and a purple-tinted icon, so they read as bad at a glance
    pixBox(ctx, rx, ry, 25, 24, cursed ? (i === hot ? '#5a2a6a' : '#3a1846') : i === hot ? '#34405a' : '#1e2330', cursed ? (Math.sin(Engine.time * 4) > 0 ? '#c050f0' : '#8030b0') : '#2c3346', 3);
    const bounce = opts.bounce?.[r.key] ? Math.sin(Math.min(1, opts.bounce[r.key]) * Math.PI) * -4 : 0;
    const tint = cursed ? tinted(itemPath(r.key), '#9030c0', 0.45) : null;
    if (tint) ctx.drawImage(tint, rx, ry + bounce - (i === hot ? 2 : 0));
    else draw(ctx, itemPath(r.key), rx, ry + bounce - (i === hot ? 2 : 0));
  }
  if (hot >= 0) {
    const r = run.relics[hot];
    const def = RELICS[r.key];
    if (def.curse) tip(D.items[r.key]?.name || r.key, def.desc + "\n\nCURSE  ·  can't be sold\nCLEANSE it at a POKéMON CENTER", { accent: '#c050f0' });
    else tip(D.items[r.key]?.name || r.key, def.desc + (r.state?.n ? `\n(Currently: ${r.state.n})` : '') + `\n\n${def.rarity.toUpperCase()} HELD ITEM  ·  ${n} held${opts.sellable ? '  ·  click to sell' : ''}`, { accent: def.rarity === 'rare' ? '#f8d038' : def.rarity === 'uncommon' ? '#58a8f8' : '#a0a0a0' });
    if (opts.onRelicClick && (Engine.mouse.rclicked || Engine.mouse.clicked)) opts.onRelicClick(r.key);
  }
  // badges sit next to the act title so they never collide with the right-side buttons
  const badgeX0 = 8 + measure(opts.title || act.short) + 6;
  for (let i = 0; i < run.badges.length; i++) {
    const b = run.badges[i];
    const bx = badgeX0 + i * 14;
    draw(ctx, badgeIcon(b), bx, 5);
    if (hover(bx, 4, 14, 18)) tip(BADGES[b]?.name || b, BADGES[b]?.desc || '', { accent: '#f8d038' });
  }
  // right side buttons
  if (opts.onDeck) {
    const bx = W - 60;
    if (button(ctx, 'DECK', bx, 3, 54, 21, { color: '#506080', font: 'small' })) opts.onDeck();
  }
  if (button(ctx, 'COMBOS', W - (opts.onDeck ? 120 : 60), 3, 56, 21, { color: '#806040', font: 'small' })) pushOverlay(new ComboModal({}));
  if (opts.onMenu && button(ctx, 'MENU', W - (opts.onDeck ? 168 : 108), 3, 44, 21, { color: '#604080', font: 'small' })) opts.onMenu();
}

export function consumableDesc(k) {
  const c = CONSUMABLES[k];
  if (!c) return D.items[k]?.desc || '';
  if (c.combo) return `Combo upgrade: ${c.combo.replace('_', ' ')} +1 level (+${COMBOS[c.combo].dPct}% damage bonus). Used instantly from the bag.`;
  if (c.heal) return c.heal >= 9999 ? `Fully restores a POKéMON's HP${c.cure ? ' and status' : ''}.` : `Restores ${c.heal} HP.`;
  if (c.healFrac) return `Restores ${Math.round(c.healFrac * 100)}% HP.`;
  if (c.revive) return `Revives a fainted POKéMON with ${c.revive >= 1 ? 'full' : 'half'} HP.`;
  if (c.cure) return c.cure === true ? 'Cures any status problem.' : `Cures ${c.cure}.`;
  if (c.stage) return `Battle only: raises your team's ${c.stage[0].toUpperCase()} by ${c.stage[1]}.`;
  if (c.focus) return 'Battle only: raises critical-hit chance.';
  if (c.mist) return 'Battle only: prevents stat drops.';
  if (c.flee) return c.anyNonBoss ? 'Escape from any non-boss battle (no rewards).' : 'Escape from a wild battle.';
  if (c.levels) return `Raises a POKéMON by ${c.levels} level${c.levels > 1 ? 's' : ''}.`;
  if (c.addCopy) return `Adds ${c.addCopy} extra cop${c.addCopy > 1 ? 'ies' : 'y'} of a move card to your deck.`;
  if (c.relearn) return 'Teach a POKéMON a move it could have learned.';
  if (c.evo) return 'Evolves certain POKéMON.';
  if (c.sell) return `Sell it for $${c.sell}.`;
  if (c.reviveAll) return 'Revives all fainted POKéMON.';
  return D.items[k]?.desc || '';
}

// ---- party panel ----------------------------------------------------------------------------
export function drawPartyPanel(ctx, run, x, y, w, opts = {}) {
  const rowH = opts.rowH || 30;
  let clickedMon = null;
  run.party.forEach((mon, i) => {
    const ry = y + i * rowH;
    const fainted = isFainted(mon);
    const isLead = opts.leadUid === mon.uid;
    const hot = hover(x, ry, w, rowH - 2);
    pixBox(ctx, x, ry, w, rowH - 2, isLead ? '#3a4a68' : hot ? '#323a50' : '#252b3a', isLead ? '#f8d038' : '#141820', 3);
    drawIcon(ctx, mon.species, x - 2, ry - 5, { gray: fainted, still: fainted, fast: isLead });
    textFit(ctx, monName(mon), x + 30, ry + 1, mon.status ? w - 86 : w - 60, { color: fainted ? 'gray' : 'white', font: 'small' });
    text(ctx, 'Lv' + mon.level, x + w - 4, ry + 1, { align: 'right', color: 'white', font: 'small' });
    const mh = opts.dispHp?.[mon.uid] ?? mon.hp;
    hpBar(ctx, x + 31, ry + 15, w - 70, mh / maxHp(mon), 3);
    text(ctx, `${Math.round(mh)}/${maxHp(mon)}`, x + w - 4, ry + 12, { align: 'right', color: 'gray', font: 'small' });
    if (mon.status) draw(ctx, `gfx/ui/status/${mon.status === 'TOX' ? 'psn' : mon.status.toLowerCase()}.png`, x + w - 54, ry + 2);
    if (opts.showExp) { rect(ctx, x + 31, ry + 21, w - 70, 2, '#202020'); rect(ctx, x + 31, ry + 21, Math.round((w - 70) * expProgress(mon)), 2, '#40c8f8'); }
    // opts.pick: the lead fainted, so the healthy benched POKéMON pulse gold (click one to send it out)
    if (opts.pick && !fainted && !isLead) {
      ctx.save(); ctx.globalAlpha = 0.55 + 0.45 * Math.sin(Engine.time * 6); ctx.strokeStyle = '#f8d038'; ctx.lineWidth = 2;
      ctx.strokeRect(x + 1, ry + 1, w - 2, rowH - 4); ctx.restore();
    }
    if (hot) {
      if (opts.tooltip !== false) monTooltip(mon, opts.tipX ?? (x + w + 4), ry);
      if (Engine.mouse.clicked) clickedMon = mon;
    }
  });
  return clickedMon;
}

export function monTooltip(mon, x, y) {
  const s = D.species[mon.species];
  const st = stats(mon);
  const ab = mon.ability || s.abilities?.[(mon.ivs.spe) % Math.max(1, s.abilities.length)];
  const body = `${typesOf(mon).join('/')}  ·  ${ab ? D.abilities[ab]?.name || ab : ''}\nHP ${mon.hp}/${st.hp}  ATK ${st.atk}  DEF ${st.def}\nSPA ${st.spa}  SPD ${st.spd}  SPE ${st.spe}\n` +
    `Moves: ${mon.moves.map(m => `${D.moves[m.move]?.name}${m.copies > 1 ? ' x' + m.copies : ''}`).join(', ')}` + (ab && D.abilities[ab] ? `\n${D.abilities[ab].name}: ${D.abilities[ab].desc}` : '');
  tip(`${monName(mon)}${mon.shiny ? ' ★' : ''}  Lv${mon.level}`, body, { width: 200, x, y, accent: TYPE_COLORS[typesOf(mon)[0]] });
}

// ---- generic modal overlays -----------------------------------------------------------------
export class Modal {
  constructor(opts) { Object.assign(this, opts); this.t = 0; }
  update(dt) {
    this.t += dt;
    if (this.cancelable !== false && (keyPressed('Escape') || Engine.mouse.rclicked)) { this.close(null); }
  }
  close(v) { popOverlay(this); this.onClose?.(v); }
  dim(ctx) { ctx.save(); ctx.globalAlpha = Math.min(0.6, this.t * 4); rect(ctx, 0, 0, W, H, '#000'); ctx.restore(); }
  // Informational modals only: a tap/click outside the panel closes it.
  closeOnTapOutside(x, y, w, h) { if (Engine.mouse.clicked && !inRect(x, y, w, h)) this.close(null); }
}

// Pick one of several labelled options.
export class ChoiceModal extends Modal {
  draw(ctx) {
    this.dim(ctx);
    const w = this.w || 300, n = this.options.length;
    const bh = 26;
    const h = 46 + n * (bh + 4) + (this.body ? 14 * wrap(this.body, w - 24).length : 0);
    const x = (W - w) / 2, y = (H - h) / 2;
    panel(ctx, x, y, w, h);
    text(ctx, this.title || '', W / 2, y + 8, { align: 'center', color: 'white' });
    let cy = y + 28;
    if (this.body) { cy += textBlock(ctx, this.body, x + 12, cy, w - 24, { color: 'whiteSoft' }) + 4; }
    this.options.forEach((o, i) => {
      if (button(ctx, o.label, x + 12, cy, w - 24, bh, { color: o.color || THEME.play, disabled: o.disabled })) this.close(o.value ?? i);
      if (o.tip && hover(x + 12, cy, w - 24, bh)) tip(o.label, o.tip);
      cy += bh + 4;
    });
    // Esc/right-click cancel; touch needs a visible X unless an option already backs out (value 0/null).
    if (this.cancelable !== false && !this.options.some(o => o.value === 0 || o.value === null) && closeButton(ctx, x + w, y)) this.close(null);
    drawTips(ctx);
  }
}

// Choose a party Pokémon. filter(mon) -> true | 'reason string' when not allowed.
export class PartyPicker extends Modal {
  draw(ctx) {
    this.dim(ctx);
    const run = G.run;
    const w = 420, h = 50 + Math.ceil(run.party.length / 2) * 64;
    const x = (W - w) / 2, y = (H - h) / 2;
    panel(ctx, x, y, w, h);
    text(ctx, this.title || 'Choose a POKéMON', W / 2, y + 8, { align: 'center', color: 'white' });
    run.party.forEach((mon, i) => {
      const cx = x + 10 + (i % 2) * 204, cy = y + 30 + Math.floor(i / 2) * 64;
      const ok = this.filter ? this.filter(mon) : true;
      const hot = ok === true && hover(cx, cy, 196, 58);
      pixBox(ctx, cx, cy, 196, 58, hot ? '#40507a' : ok === true ? '#2c3448' : '#20242e', hot ? '#f8d038' : '#141820', 3);
      drawMon(ctx, mon.species, cx - 4, cy - 6, { shiny: mon.shiny, alpha: ok === true ? 1 : 0.4 });
      text(ctx, monName(mon), cx + 62, cy + 4, { color: ok === true ? 'white' : 'gray' });
      text(ctx, `Lv${mon.level}`, cx + 190, cy + 4, { align: 'right', color: 'white', font: 'small' });
      hpBar(ctx, cx + 62, cy + 22, 100, mon.hp / maxHp(mon), 3);
      text(ctx, `${mon.hp}/${maxHp(mon)}`, cx + 190, cy + 18, { align: 'right', color: 'gray', font: 'small' });
      if (ok !== true) text(ctx, String(ok || 'Not able'), cx + 62, cy + 34, { color: 'red', font: 'small' });
      else if (this.sub) text(ctx, this.sub(mon), cx + 62, cy + 34, { color: 'lime', font: 'small' });
      if (hot) { monTooltip(mon, cx + 200, cy); if (Engine.mouse.clicked) { Sound.playSE('se_select'); this.close(mon); } }
    });
    if (this.cancelable !== false && button(ctx, 'CANCEL', W / 2 - 50, y + h - 4, 100, 22, { color: '#806060' })) this.close(null);
    drawTips(ctx);
  }
}

// "X wants to learn MOVE" — returns replaced index, or -1 to give up.
export class MoveReplaceModal extends Modal {
  draw(ctx) {
    this.dim(ctx);
    const mon = this.mon, mv = D.moves[this.move];
    const w = 400, h = 220, x = (W - w) / 2, y = (H - h) / 2;
    panel(ctx, x, y, w, h);
    drawIcon(ctx, mon.species, x + 8, y + 4);
    text(ctx, `${monName(mon)} Lv${mon.level} wants to learn ${mv.name}!`, x + 44, y + 8, { color: 'white' });
    text(ctx, 'Choose a move to forget, or keep your current moves.', x + 44, y + 24, { color: 'gray', font: 'small' });
    const newInfo = fakeInfo(mon, this.move);
    drawCard(ctx, newInfo, x + w - CARD_W - 14, y + 50, { highlight: true, ignorePlayable: true });
    text(ctx, 'NEW', x + w - CARD_W / 2 - 14, y + 138, { align: 'center', color: 'gold' });
    if (hover(x + w - CARD_W - 14, y + 50, CARD_W, CARD_H)) cardTooltip(newInfo);
    mon.moves.forEach((m, i) => {
      const cx = x + 12 + i * (CARD_W + 8), cy = y + 50;
      const info = fakeInfo(mon, m.move);
      const hot = hover(cx, cy, CARD_W, CARD_H);
      drawCard(ctx, info, cx, cy - (hot ? 4 : 0), { selected: hot, ignorePlayable: true });
      if (m.copies > 1) text(ctx, 'x' + m.copies, cx + CARD_W / 2, cy + CARD_H + 2, { align: 'center', color: 'white', font: 'small' });
      if (hot) { cardTooltip(info); if (Engine.mouse.clicked) { Sound.playSE('se_select'); this.close(i); } }
    });
    if (button(ctx, `Don't learn ${mv.name}`, x + 12, y + h - 34, w - 24, 24, { color: '#806060' })) this.close(-1);
    drawTips(ctx);
  }
}

export function fakeInfo(mon, moveKey) {
  const move = { ...D.moves[moveKey], key: moveKey };
  const st = stats(mon);
  const status = move.power === 0;
  const physical = !isSpecialMove(moveKey, move.type);
  return { move, type: move.type, power: move.power, status, physical, playable: true, species: mon.species, owner: mon, uid: mon.uid,
    // damage against an even-level foe with the same attacking/defending stat (no type matchup)
    dmgPreview: status ? 0 : FIXED_DAMAGE[move.effect] ? FIXED_DAMAGE[move.effect]({ user: mon, b: { rng: { next: () => 0.5 } } }) : Math.round(((Math.floor(2 * mon.level / 5) + 2) * (move.power > 1 ? move.power : 60) / 50 + 2) * (typesOf(mon).includes(move.type) ? 1.5 : 1)),
    stab: typesOf(mon).includes(move.type) };
}

// Deck viewer
export class DeckModal extends Modal {
  draw(ctx) {
    this.dim(ctx);
    const run = G.run;
    panel(ctx, 20, 30, W - 40, H - 50);
    text(ctx, this.title || 'YOUR DECKS', W / 2, 36, { align: 'center', color: 'white' });
    text(ctx, 'Each POKéMON fights with its own deck', W - 30, 36, { align: 'right', color: 'gray', font: 'small' });
    let cy = 54;
    run.party.forEach((mon) => {
      drawIcon(ctx, mon.species, 26, cy - 8, { gray: isFainted(mon) });
      text(ctx, `${monName(mon)} · ${mon.moves.reduce((n, mv) => n + (mv.copies || 1), 0)} cards`, 28, cy + 22, { color: 'white', font: 'small' });
      mon.moves.forEach((m, i) => {
        const info = fakeInfo(mon, m.move);
        const cx = 90 + i * 128, cyy = cy;
        const s = 0.5;
        ctx.save(); ctx.translate(cx, cyy); ctx.scale(1, 1);
        drawMiniCard(ctx, { ...info, ...(this.battle ? battleEff(this.battle, info) : {}) }, 0, 0, m.copies);
        ctx.restore();
        if (hover(cx, cyy, 120, 22)) {
          cardTooltip({ ...info, copies: m.copies || 1, ...(this.battle ? battleEff(this.battle, info) : {}) });
          if (Engine.mouse.clicked && this.onPick) { this.close({ mon, index: i }); }
        }
      });
      cy += 44;
    });
    if (this.onPick) text(ctx, this.pickText || 'Click a move.', W / 2, H - 38, { align: 'center', color: 'gold' });
    if (button(ctx, 'CLOSE', W / 2 - 40, H - 26, 80, 20, { color: '#506080', font: 'small' })) this.close(null);
    if (!this.onPick) this.closeOnTapOutside(20, 30, W - 40, H - 50);
    drawTips(ctx);
  }
}

export function drawMiniCard(ctx, info, x, y, copies = 1) {
  const tcol = TYPE_COLORS[info.type] || '#888';
  pixBox(ctx, x, y, 120, 22, info.status ? '#e8e6f4' : '#faf8ef', '#1a1a22', 3);
  pixBox(ctx, x + 2, y + 2, 34, 18, tcol, null, 2);
  draw(ctx, typePath(info.type), x + 3, y + 5);
  textFit(ctx, info.move.name, x + 39, y + 4, 60, { font: 'small', color: CARD_INK.name });
  const eff = info.eff ?? 1;
  if (!info.status && eff !== 1) text(ctx, eff === 0 ? 'x0' : 'x' + eff, x + 96, y + 4, { align: 'right', font: 'small', color: eff > 1 ? CARD_INK.red : CARD_INK.blue });
  text(ctx, info.status ? 'STS' : String(info.power), x + 116, y + 4, { align: 'right', font: 'small', color: info.status ? CARD_INK.status : CARD_INK.dmg });
  if (copies > 1) { pixBox(ctx, x + 104, y - 5, 18, 11, '#f8d038', '#7a5a10', 2); text(ctx, 'x' + copies, x + 113, y - 6, { align: 'center', font: 'small', color: 'black' }); }
}

// FireRed-style message box with typewriter; await say(...) inside scenes.
export class MessageBox {
  constructor() { this.queue = []; this.cur = null; this.shown = 0; this.waiting = null; }
  say(str, opts = {}) {
    return new Promise(res => { this.queue.push({ str, res, auto: opts.auto }); });
  }
  get active() { return !!this.cur || this.queue.length > 0; }
  update(dt, fast) {
    if (!this.cur && this.queue.length) { this.cur = this.queue.shift(); this.shown = 0; this.hold = 0; }
    if (!this.cur) return;
    const speed = fast ? 240 : 90;
    if (this.shown < this.cur.str.length) {
      this.shown = Math.min(this.cur.str.length, this.shown + speed * dt);
      if (Engine.mouse.clicked || keyPressed('Enter') || keyPressed(' ') || keyPressed('z')) this.shown = this.cur.str.length;
    } else {
      this.hold += dt;
      const auto = this.cur.auto ?? 0;
      if ((auto && this.hold > auto) || Engine.mouse.clicked || keyPressed('Enter') || keyPressed(' ') || keyPressed('z')) {
        const c = this.cur; this.cur = null; c.res();
      }
    }
  }
  draw(ctx, x, y, w, h, style = 'battle') {
    if (!this.cur) return;
    if (style === 'battle') {
      pixBox(ctx, x, y, w, h, '#283850', '#d8a040', 4);
      pixBox(ctx, x + 3, y + 3, w - 6, h - 6, '#305078', '#90b0d0', 3);
    } else windowFrame(ctx, x, y, w, h, 'std');
    const shown = this.cur.str.slice(0, Math.floor(this.shown));
    const col = style === 'battle' ? 'white' : 'dark';
    const lines = wrap(shown, w - 20);
    lines.slice(-2).forEach((l, i) => text(ctx, l, x + 10, y + 7 + i * 15, { color: col }));
    // the advance arrow: one 10x12 frame of the 4-frame strip at a time (FireRed's bobbing arrow), not the whole strip
    if (this.shown >= this.cur.str.length && !this.cur.auto) draw(ctx, 'gfx/ui/cursors/text_advance_arrow.png', x + w - 16, y + h - 14, { sx: (Math.floor(Engine.time * 6) % 4) * 10, sy: 0, sw: 10, sh: 12 });
  }
}

// Combo reference (every combo, its level and damage bonus) with a second TYPE CHART tab.
let comboTab = 0; // last tab shown, remembered for the session
export class ComboModal extends Modal {
  draw(ctx) {
    this.dim(ctx);
    const x = 60, y = 6, w = W - 120, h = H - 12;
    panel(ctx, x, y, w, h);
    if (this.tab === undefined) this.tab = comboTab;
    ['COMBOS', 'TYPE CHART'].forEach((label, i) => {
      const on = this.tab === i, bx = W / 2 - 104 + i * 108;
      if (button(ctx, label, bx, y + 5, 100, 21, { color: on ? '#806040' : '#3a4052', font: 'small', silent: on }) && !on) comboTab = this.tab = i;
      if (on) rect(ctx, bx + 4, y + 26, 92, 2, '#f8d038');
    });
    if (keyPressed('ArrowLeft') || keyPressed('ArrowRight')) comboTab = this.tab = 1 - this.tab;
    if (this.tab === 1) drawTypeChart(ctx, x, y, w, h);
    else this.drawCombos(ctx, x, y, w);
    if (button(ctx, 'CLOSE', W / 2 - 40, y + h - 25, 80, 20, { color: '#506080', font: 'small' })) this.close(null);
    this.closeOnTapOutside(x, y, w, h);
    drawTips(ctx);
  }
  drawCombos(ctx, x, y, w) {
    const run = G.run;
    text(ctx, 'Only scoring attack cards deal damage; the combo adds a bonus. Same TYPE = rank. COVERAGE = 4 types.', W / 2, y + 32, { align: 'center', color: 'gray', font: 'small' });
    COMBO_ORDER.forEach((k, i) => {
      const c = COMBOS[k];
      const lvl = run?.comboLevels[k] || 1;
      const bonus = comboBonus(k, lvl);
      const ry = y + 48 + i * 24;
      pixBox(ctx, x + 8, ry, w - 16, 22, '#262c3c', '#141820', 3);
      text(ctx, c.name, x + 14, ry + 4, { color: 'white' });
      text(ctx, 'lvl ' + lvl, x + 124, ry + 5, { color: lvl > 1 ? 'gold' : 'gray', font: 'small' });
      pixBox(ctx, x + 160, ry + 3, 94, 16, bonus ? THEME.dmg : '#3a4052', null, 2); text(ctx, bonus ? `+${bonus}% DMG` : 'no bonus', x + 207, ry + 4, { align: 'center', color: 'white', font: 'small' });
      text(ctx, c.desc, x + 262, ry + 5, { color: 'whiteSoft', font: 'small' });
      const n = run?.comboPlays?.[k] || 0;
      if (n) text(ctx, '#' + n, x + w - 14, ry + 5, { align: 'right', color: 'gray', font: 'small' });
    });
  }
}

// ---- type chart (TYPE CHART tab of the combos screen) ----------------------------------------
// The FireRed font has no ½ glyph, so it's drawn as an 8x9 pixel bitmap.
const HALF_GLYPH = ['.#.....#', '##....#.', '.#...#..', '###.#...', '...#.##.', '..#.#..#', '.#....#.', '#....#..', '....####'];
function drawHalfGlyph(ctx, x, y, fill, shadow) {
  for (const [col, dx] of [[shadow, 1], [fill, 0]]) {
    if (!col) continue;
    HALF_GLYPH.forEach((row, r) => { for (let c = 0; c < row.length; c++) if (row[c] === '#') rect(ctx, x + c + dx, y + r + dx, 1, 1, col); });
  }
}
const EFF_CELL = {
  2: { fill: '#3c8a3c', label: '2', desc: 'super effective' },
  0.5: { fill: '#943434', label: '½', desc: 'not very effective' },
  0: { fill: '#0a0a10', label: '0', desc: 'no effect' },
};
const effDesc = m => (EFF_CELL[m]?.desc || 'normal damage');
function drawEffMark(ctx, m, cx, cy) {
  if (m === 0.5) drawHalfGlyph(ctx, cx - 4, cy - 4, '#ffffff', '#4a1010');
  else if (m === 2) text(ctx, '2', cx + 1, cy - 7, { align: 'center', font: 'small', color: 'white' });
  else if (m === 0) text(ctx, '0', cx + 1, cy - 7, { align: 'center', font: 'small', color: 'gray' });
}
// The active battle's lead / foe types (single-player scene.b, co-op scene.sub), for row/column highlights.
function chartBattleTypes() {
  const sc = Engine.scene, b = sc?.b || sc?.sub;
  if (!b?.typesOfSide) return { mine: [], foe: [] };
  return { mine: b.lead?.() ? b.typesOfSide('player') || [] : [], foe: b.enemy?.() ? b.typesOfSide('enemy') || [] : [] };
}

export function drawTypeChart(ctx, x, y, w, h) {
  const types = D.types.list, n = types.length, CW = 20, CH = 16, LW = 36;
  const gx = x + Math.round((w - LW - n * CW) / 2) + LW, gy = y + 50;
  const { mine, foe } = chartBattleTypes();
  const inGrid = hover(gx, gy, n * CW, n * CH);
  const hr = inGrid ? Math.floor((Engine.mouse.y - gy) / CH) : hover(gx - LW, gy, LW, n * CH) ? Math.floor((Engine.mouse.y - gy) / CH) : -1;
  const hc = inGrid ? Math.floor((Engine.mouse.x - gx) / CW) : hover(gx, gy - 17, n * CW, 17) ? Math.floor((Engine.mouse.x - gx) / CW) : -1;
  const tintCell = (cx, cy, r, c) => {
    ctx.save();
    if (mine.includes(types[r])) { ctx.globalAlpha = 0.22; rect(ctx, cx, cy, CW - 1, CH - 1, '#f8d038'); }
    if (foe.includes(types[c])) { ctx.globalAlpha = 0.22; rect(ctx, cx, cy, CW - 1, CH - 1, '#58b0f8'); }
    if (r === hr || c === hc) { ctx.globalAlpha = 0.12; rect(ctx, cx, cy, CW - 1, CH - 1, '#ffffff'); }
    ctx.restore();
  };
  // corner hint: ATK rows \ DEF columns
  const kx = gx - LW, ky = gy - 21;
  text(ctx, 'DEF', gx - 3, ky - 3, { align: 'right', font: 'small', color: 'gray' });
  text(ctx, 'ATK', kx + 1, ky + 7, { font: 'small', color: 'gray' });
  for (let i = 0; i < 12; i++) rect(ctx, kx + 15 + i, ky + 1 + Math.floor(i * 18 / 12), 1, 1, '#5a6278');
  // column headers (defending type) and row labels (attacking type)
  types.forEach((t, i) => {
    const cx = gx + i * CW;
    pixBox(ctx, cx, gy - 16, CW - 1, 14, i === hc ? shade(TYPE_COLORS[t], 0.25) : TYPE_COLORS[t], null, 2);
    text(ctx, t.slice(0, 3), cx + CW / 2, gy - 16, { align: 'center', font: 'small', color: 'white' });
    if (foe.includes(t)) rect(ctx, cx + 1, gy - 19, CW - 3, 2, '#58b0f8');
    const ry = gy + i * CH;
    draw(ctx, typePath(t), gx - LW + 1, ry + 2);
    if (mine.includes(t)) rect(ctx, gx - LW - 3, ry + 2, 2, 12, '#f8d038');
    if (i === hr) { ctx.save(); ctx.globalAlpha = 0.25; rect(ctx, gx - LW + 1, ry + 2, 32, 12, '#ffffff'); ctx.restore(); }
  });
  // cells
  rect(ctx, gx - 1, gy - 1, n * CW + 1, n * CH + 1, '#141820');
  types.forEach((atk, r) => types.forEach((def, c) => {
    const cx = gx + c * CW, cy = gy + r * CH, m = typeEffect(atk, [def]);
    rect(ctx, cx, cy, CW - 1, CH - 1, EFF_CELL[m]?.fill || ((r + c) % 2 ? '#262c3c' : '#2a3142'));
    tintCell(cx, cy, r, c);
    drawEffMark(ctx, m, cx + Math.floor(CW / 2) - 1, cy + Math.floor(CH / 2) - 1);
  }));
  if (inGrid && hr >= 0 && hc >= 0) {
    const cx = gx + hc * CW - 1, cy = gy + hr * CH - 1;
    rect(ctx, cx, cy, CW + 1, 1, '#ffffff'); rect(ctx, cx, cy + CH, CW + 1, 1, '#ffffff');
    rect(ctx, cx, cy, 1, CH + 1, '#ffffff'); rect(ctx, cx + CW, cy, 1, CH + 1, '#ffffff');
    const atk = types[hr], def = types[hc], m = typeEffect(atk, [def]);
    tip(`${atk} vs ${def}`, `${m === 0.5 ? '0.5' : m}x (${effDesc(m)})`, { accent: TYPE_COLORS[atk] });
  }
  // left margin: legend; right margin: how to read it (+ battle highlights)
  const lx = x + 10, lw = gx - LW - 6 - lx;
  text(ctx, 'KEY', lx, gy - 2, { font: 'small', color: 'gold' });
  [2, 0.5, 0].forEach((m, i) => {
    const ly = gy + 14 + i * 18;
    rect(ctx, lx, ly, CW - 1, CH - 1, EFF_CELL[m].fill);
    drawEffMark(ctx, m, lx + Math.floor(CW / 2) - 1, ly + Math.floor(CH / 2) - 1);
    text(ctx, ['super', 'not very', 'immune'][i], lx + CW + 3, ly + 1, { font: 'small', color: 'whiteSoft', maxW: lw - CW - 3 });
  });
  const rx = gx + n * CW + 8, rw = x + w - 8 - rx;
  let ty = gy - 2;
  ty += textBlock(ctx, 'Rows: the move\'s type. Columns: the target\'s type. Two types multiply.', rx, ty, rw, { font: 'small', color: 'gray', lineHeight: 11 }) + 8;
  if (mine.length || foe.length) {
    rect(ctx, rx, ty + 3, 8, 8, '#f8d038'); text(ctx, 'your lead', rx + 11, ty, { font: 'small', color: 'whiteSoft', maxW: rw - 11 });
    rect(ctx, rx, ty + 17, 8, 8, '#58b0f8'); text(ctx, 'the foe', rx + 11, ty + 14, { font: 'small', color: 'whiteSoft', maxW: rw - 11 });
  }
}
