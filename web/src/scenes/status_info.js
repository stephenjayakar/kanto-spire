// STATUSES tab of the INFO screen (scenes/common.js InfoModal): every status condition and what it does in THIS
// game. Every number is read off the code, not the Gen 3 games:
//   game/battle.js  cardInfo (ASLEEP / FROZEN / DROWSY / ICED cards), scoreHand (paralysed cards), speedOf, enemyAct
//                   (the foe's sleep / freeze / confusion / love / paralysis / disable / flinch checks), resolveHand
//                   (your confusion and love), inflictStatus (immunities, sleep length), enemyResiduals and
//                   leadResiduals (end-of-turn damage), playerCounters (your sleep and thaw), switchLead (what a switch
//                   clears), ballAttempt (catch bonus), end (sleep and freeze end with the battle)
//   game/effects.js the moves that set them (TRAP 2-5 turns, ATTRACT 3, TAUNT 3, DISABLE 1, REST 2, CURSE...)
//   game/data.js    stageMult / accStageMult (stat stages); game/bosses.js (KOGA, ERIKA, LORELEI, GLACIA, LT. SURGE)
//   game/coop/duo.js co-op (foes act per player pair, LEECH SEED heals the planter)
// If you change one of those rules, change its line here too.
import { draw } from '../engine/assets.js';
import { text, wrap } from '../engine/font.js';
import { pixBox, rect, scrollArea } from '../engine/ui.js';

// Line tags: who the line is about (colour) or a grey note (null).
const TAGS = { YOU: 'gold', FOES: 'orange', BOTH: 'lime', CURE: 'lime', STOP: 'lime', CATCH: 'lime', 'CO-OP': 'lime' };

// icon: a gfx/ui/status icon (the game's own) | badge: [label, colour] for effects that have no icon in FireRed.
export const STATUS_INFO = [
  { head: 'MAJOR STATUS  ·  one at a time  ·  PSN, TOX, BRN and PAR stay after the battle until cured' },
  {
    icon: 'par', name: 'PARALYSIS', lines: [
      ['YOU', 'Each card you play (attack or status) has a 25% chance to do nothing. SPEED x0.25.'],
      ['FOES', '25% chance to lose its move each turn. SPEED x0.25.'],
      [null, 'Immune: LIMBER, and GROUND types vs THUNDER WAVE.'],
    ],
  },
  {
    icon: 'slp', name: 'SLEEP', lines: [
      ['YOU', "Its cards can't be played (SNORE and SLEEP TALK can). It wakes at the end of turn 1-3, counting the turn it fell asleep (REST: turn 2). Benched sleepers count down too."],
      ['FOES', 'Skips its next 1-3 moves (bosses 1-2). Bosses and elites then stay awake for 3 turns.'],
      [null, 'Immune: INSOMNIA, VITAL SPIRIT, during an UPROAR. POKé FLUTE wakes yours each turn. Ends with the battle.'],
    ],
  },
  {
    icon: 'psn', name: 'POISON', lines: [
      ['YOU', 'Your lead loses 1/8 of its max HP at the end of each turn (the bench loses nothing).'],
      ['FOES', '1/10 of max HP a turn; bosses, elites and legendaries 1/20.'],
      [null, 'Immune: POISON and STEEL types, IMMUNITY.'],
    ],
  },
  {
    icon: 'psn', name: 'BAD POISON', sub: 'TOX', lines: [
      ['YOU', '1/16 of max HP, then 2/16, 3/16... a turn (up to 15/16). Starts again at 1/16 each battle.'],
      ['FOES', '1/16, 2/16, 3/16... a turn; bosses, elites and legendaries 1/24, then 1/12.'],
      [null, "Cured like POISON. KOGA's TOXIC FOG badly poisons every lead you send out."],
    ],
  },
  {
    icon: 'brn', name: 'BURN', lines: [
      ['YOU', 'Your lead loses 1/8 of its max HP a turn. Physical cards deal half damage (GUTS: x1.5 instead).'],
      ['FOES', '1/10 of max HP a turn (bosses, elites and legendaries 1/20). Its physical moves deal half damage.'],
      [null, 'Immune: FIRE types, WATER VEIL.'],
    ],
  },
  {
    icon: 'frz', name: 'FREEZE', lines: [
      ['YOU', "Its cards can't be played. 25% chance to thaw at the end of each turn (benched too)."],
      ['FOES', 'Loses its move; 20% chance to thaw just before each move, then it acts.'],
      [null, "Immune: ICE types, MAGMA ARMOR, in harsh sunlight. FIRE moves don't thaw. Ends with the battle."],
    ],
  },
  {
    note: true, lines: [
      ['CURE', 'POKéMON CENTER HEAL and every new act; status items and berries (ANTIDOTE also cures TOX); HEAL BELL, REFRESH, REST; NATURAL CURE on switching out; SHED SKIN (30% a turn); HEAL POWDER (your lead, at battle start); fainting.'],
      ['STOP', 'SAFEGUARD (5 turns) blocks new status and confusion; a SUBSTITUTE blocks status moves. SYNCHRONIZE passes PSN, BRN and PAR back.'],
      ['CATCH', 'A sleeping or frozen foe is x2 easier to catch; any other status x1.5.'],
    ],
  },
  { head: 'OTHER EFFECTS  ·  end when your POKéMON switches out (BATON PASS keeps them) or the foe leaves' },
  {
    badge: ['CNF', '#a050c8'], name: 'CONFUSION', lines: [
      ['YOU', 'For the next 1-3 hands: 50% chance your lead hits itself for 1/8 of its max HP and the hand deals half damage.'],
      ['FOES', 'For its next 1-3 moves: 50% chance (bosses, elites 33%) to hit itself for 1/10 of max HP (1/20) instead.'],
      [null, 'Immune: OWN TEMPO. MENTAL HERB protects your team. The DMG preview shows x0.75.'],
    ],
  },
  {
    badge: ['LOV', '#d05090'], name: 'INFATUATION', sub: 'ATTRACT', lines: [
      ['YOU', 'For 3 hands: 50% chance each that the hand deals half damage.'],
      ['FOES', 'For its next 3 moves: 50% chance each to lose the move.'],
      [null, "Bosses, elites and legendaries ignore your ATTRACT. Gender doesn't matter."],
    ],
  },
  {
    badge: ['SED', '#3c9040'], name: 'LEECH SEED', lines: [
      ['YOU', 'Your lead loses 1/8 of its max HP a turn; the foe heals 1/10 of its own.'],
      ['FOES', 'Loses 1/10 of max HP a turn (bosses, elites and legendaries 1/20); your lead heals 1/8 of its own.'],
      [null, 'GRASS types are immune. RAPID SPIN removes it.'],
    ],
  },
  {
    badge: ['CRS', '#6a40a0'], name: 'CURSE', sub: 'GHOST', lines: [
      ['YOU', 'Your lead loses 1/4 of its max HP a turn.'],
      ['FOES', 'Loses 1/6 of max HP a turn (bosses, elites and legendaries 1/12).'],
      [null, 'The GHOST user pays 1/2 of its max HP (a foe pays 1/4). Not a GHOST: ATK +1, DEF +1, SPEED -1.'],
    ],
  },
  {
    badge: ['NMR', '#404880'], name: 'NIGHTMARE', lines: [
      ['FOES', 'While asleep it loses 1/6 of max HP a turn (bosses, elites and legendaries 1/12). Fails on a foe that is awake.'],
      ['YOU', 'No effect.'],
    ],
  },
  {
    badge: ['TRP', '#a06830'], name: 'TRAPPED', lines: [
      ['BOTH', 'WRAP, BIND, FIRE SPIN, CLAMP, WHIRLPOOL, SAND TOMB: loses 1/16 of max HP a turn for 2-5 turns. Switching and running still work.'],
      [null, 'MEAN LOOK, SPIDER WEB and BLOCK on you (and a foe with ARENA TRAP or SHADOW TAG) stop you from running.'],
    ],
  },
  {
    badge: ['DRW', '#5070b0'], name: 'DROWSY', sub: 'YAWN', lines: [
      ['BOTH', "Falls asleep at the end of the turn, then sleeps as above. Fails if it couldn't fall asleep."],
      [null, "ERIKA's SLEEP POWDER makes one benched POKéMON drowsy each turn: its cards can't be played that turn."],
    ],
  },
  {
    badge: ['FLN', '#7a8090'], name: 'FLINCH', lines: [
      ['FOES', 'Loses its move if your hand hits it before it moves. FAKE OUT always flinches on turn 1. INNER FOCUS is immune.'],
      ['YOU', 'No effect.'],
    ],
  },
  {
    badge: ['TNT', '#b04848'], name: 'TAUNT', sub: 'DISABLE · TORMENT', lines: [
      ['FOES', 'TAUNT: it picks no status moves on its next 2 turns. DISABLE and ENCORE: it loses its next move.'],
      ['YOU', 'None of them affect you. TORMENT does nothing to anyone.'],
    ],
  },
  {
    badge: ['+/-', '#3a78a8'], name: 'STAT STAGES', lines: [
      ['BOTH', '-6 to +6. ATK, DEF, SP. ATK, SP. DEF, SPEED: +1 x1.5, +2 x2 ... +6 x4; -1 x0.67, -2 x0.5 ... -6 x0.25.'],
      [null, 'Accuracy and evasion: +1 x1.33, +2 x1.66 ... +6 x3; -1 x0.75, -2 x0.6 ... -6 x0.33.'],
      ['YOU', "Yours belong to the team and last the whole battle, even through switches. A foe's reset when it leaves."],
      [null, 'HAZE clears them all. MIST, CLEAR BODY and WHITE SMOKE block drops from the foe.'],
    ],
  },
  { head: 'CARD EFFECTS  ·  boss rules' },
  {
    badge: ['ICE', '#4aa8c8'], name: 'ICED CARD', lines: [
      ['YOU', "LORELEI ices 2 cards in your hand each turn, GLACIA 1. An ICED card can't be played; it thaws at the start of the next turn."],
      [null, "LT. SURGE's OVERCHARGE: the leftmost card of every hand you play is SHOCKED and does nothing."],
    ],
  },
  {
    note: true, lines: [
      ['CO-OP', 'Same rules. Effects on a foe are shared by every player. A foe that acts twice in a turn (3-4 players) checks sleep, freeze, paralysis, confusion and love on each action, so they wear off faster. LEECH SEED heals the lead of the player who planted it.'],
    ],
  },
];

const NAME_W = 80, TAG_W = 34, LH = 11;

// A FireRed-style status pill for effects without an icon of their own.
function drawBadge(ctx, label, color, x, y) {
  pixBox(ctx, x, y, 24, 10, color, '#181820', 2);
  text(ctx, label, x + 12, y - 1, { align: 'center', font: 'small', color: 'white' });
}

// Draws the tab into the panel (x, y, w, h); `m` keeps the scroll position. The list ends 50px above the panel's
// bottom so scrollArea's "scroll for more" hint clears the CLOSE button.
export function drawStatusInfo(ctx, m, x, y, w, h) {
  const top = y + 32, bottom = y + h - 50, lx = x + 10, lw = w - 26;
  const tx = lx + 6 + NAME_W, textW = lw - 10 - NAME_W - TAG_W;
  scrollArea(ctx, m, x + 6, top, w - 12, bottom, (cy) => {
    cy += 2;
    for (const row of STATUS_INFO) {
      if (row.head) {
        text(ctx, row.head, lx + 2, cy, { font: 'small', color: 'gold' });
        rect(ctx, lx, cy + 12, lw, 1, '#f8d03855');
        cy += 16;
        continue;
      }
      const lines = [];
      for (const [tag, str] of row.lines) wrap(str, row.note ? lw - 16 - TAG_W : textW, 'small').forEach((l, i) => lines.push([tag, l, i === 0]));
      const nameLines = row.name ? wrap(row.name, NAME_W, 'small') : [];
      const subLines = row.sub ? wrap(row.sub, NAME_W, 'small') : [];
      const rh = Math.max(lines.length * LH, 12 + (nameLines.length + subLines.length) * LH) + 6;
      pixBox(ctx, lx, cy, lw, rh, row.note ? '#1e2432' : '#262c3c', '#141820', 3);
      if (row.icon) draw(ctx, `gfx/ui/status/${row.icon}.png`, lx + 6, cy + 5);
      else if (row.badge) drawBadge(ctx, row.badge[0], row.badge[1], lx + 4, cy + 4);
      nameLines.forEach((l, i) => text(ctx, l, lx + 6, cy + 14 + i * LH, { font: 'small', color: 'white' }));
      subLines.forEach((l, i) => text(ctx, l, lx + 6, cy + 14 + (nameLines.length + i) * LH, { font: 'small', color: 'gray' }));
      const x0 = row.note ? lx + 8 : tx;
      lines.forEach(([tag, l, first], i) => {
        const ly = cy + 3 + i * LH;
        if (tag && first) text(ctx, tag, x0, ly, { font: 'small', color: TAGS[tag] || 'gray' });
        text(ctx, l, x0 + TAG_W, ly, { font: 'small', color: tag === null ? 'gray' : 'whiteSoft' });
      });
      cy += rh + 3;
    }
    return cy + 2;
  });
}
