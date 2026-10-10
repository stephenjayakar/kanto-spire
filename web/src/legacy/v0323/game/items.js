// Held items (relics), badges and consumables.
// DMG system: a hand simply deals damage. Items change it in three ways:
//   per card   cardPct(card, b) -> +% damage for that card   cardDmg(card, b) -> +flat damage (once per card)
//              cardTimes(card, b) -> damage multiplier for that card (LIGHT BALL, THICK CLUB)
//   per hand   onHand(s, state): s.pct(n, src) adds +n% to the hand's bonus (same pool as the combo bonus),
//              s.flat(n, src) adds flat damage to the hand, s.times(f, src) multiplies (penalties, HELPING HAND)
// The card passed to hooks is {move, type, owner, species, physical, power, status, eff, stab, canEvolve}.

const TYPE_BOOSTERS = {
  CHARCOAL: 'FIRE', MYSTIC_WATER: 'WATER', MIRACLE_SEED: 'GRASS', MAGNET: 'ELECTRIC',
  NEVER_MELT_ICE: 'ICE', BLACK_BELT: 'FIGHTING', POISON_BARB: 'POISON', SOFT_SAND: 'GROUND',
  SHARP_BEAK: 'FLYING', TWISTED_SPOON: 'PSYCHIC', SILVER_POWDER: 'BUG', HARD_STONE: 'ROCK',
  SPELL_TAG: 'GHOST', DRAGON_FANG: 'DRAGON', BLACK_GLASSES: 'DARK', METAL_COAT: 'STEEL',
  SILK_SCARF: 'NORMAL',
};

export const RELICS = {};

for (const [key, type] of Object.entries(TYPE_BOOSTERS)) {
  RELICS[key] = {
    rarity: 'common', boostType: type,
    desc: `${type} cards deal +60% damage.`,
    cardPct(c) { return c.type === type ? 60 : 0; },
  };
}

// SILK SCARF boosts NORMAL, which is on almost every card: it gets a smaller bonus.
RELICS.SILK_SCARF.desc = 'NORMAL cards deal +30% damage.';
RELICS.SILK_SCARF.cardPct = (c) => (c.type === 'NORMAL' ? 30 : 0);

// A growing item's current bonus for the HUD tag and tooltip (scenes/common.js drawHUD). Display only: never game logic.
// v: the bonus now, why: what it counts, next: when it grows (false at the max), unit: '%' or '' (flat damage). The tag
// reads "30%" ("+8" for flat damage) to fit a packed row of held items.
function bonusTag(v, why, next, unit = '%') {
  return { text: unit ? `${v}%` : `+${v}`, zero: !v, tip: `Currently +${v}${unit ? '%' : ' damage per hand'} (${why}${next ? `; ${next}` : '; the max'}).` };
}

const atkTypes = (s) => new Set(s.cards.filter(c => !c.status).map(c => c.type));

Object.assign(RELICS, {
  SEA_INCENSE: { rarity: 'common', desc: 'WATER cards deal +10 damage each.', cardDmg(c) { return c.type === 'WATER' ? 10 : 0; } },
  MACHO_BRACE: { rarity: 'common', desc: 'Physical cards deal +40% damage.', cardPct(c) { return c.physical ? 40 : 0; } },
  SOOTHE_BELL: { rarity: 'common', desc: '+1 discard each battle.', mods: { discards: 1 } },
  LEFTOVERS: { rarity: 'common', desc: 'Your lead heals 1/16 HP each turn, and your party heals 6% after every battle.', mods: { postHeal: 0.06 }, onTurnEnd(b) { b.healLead(1 / 16, 'LEFTOVERS'); } },
  BRIGHT_POWDER: { rarity: 'common', desc: 'Enemy attacks are 10% less accurate.', mods: { enemyAcc: -0.1 } },
  LUCKY_EGG: { rarity: 'common', desc: '+25% EXP from battles.', mods: { expMult: 0.25 } },
  AMULET_COIN: { rarity: 'uncommon', desc: 'Earn 75% more money from battles.', mods: { moneyMult: 0.75 } },
  SMOKE_BALL: { rarity: 'common', desc: 'You can always run from wild battles. +1 discard.', mods: { canFlee: 1, discards: 1 } },
  CLEANSE_TAG: { rarity: 'common', desc: 'Wild POKéMON have 20% less HP. Move rewards offer one more choice.', mods: { wildHp: -0.2, moveChoices: 1 } },
  WHITE_HERB: { rarity: 'common', desc: 'At the end of each turn, your lowered stats are restored.', onTurnEnd(b) { b.clearNegativeStages('player', 'WHITE_HERB'); } },
  MENTAL_HERB: { rarity: 'common', desc: 'Your lead cannot become confused. +6 damage on every hand.', mods: { noConfuse: 1 }, onHand(s) { s.flat(6, 'MENTAL_HERB'); } },

  // (v0.3.7: one roll per hand; it used to roll for every scoring attack card)
  KINGS_ROCK: { rarity: 'uncommon', desc: 'Once per hand: if an attack card hits, 10% chance to make the enemy flinch.', onHand(s) { if (s.attackHits > 0 && s.rng.chance(0.1)) s.flinch('KINGS_ROCK'); } },
  QUICK_CLAW: { rarity: 'uncommon', desc: 'Your first hand in each battle always goes first. 20% chance after that.', mods: { quickClaw: 1 } },
  SHELL_BELL: { rarity: 'uncommon', desc: 'When a hand knocks out an enemy, your lead heals 1/4 of its max HP.', onKO(b) { b.healLead(1 / 4, 'SHELL_BELL'); } },
  FOCUS_BAND: { rarity: 'uncommon', desc: 'Once per battle, your lead survives a fatal hit with 1 HP.', mods: { focusBand: 1 } },
  SCOPE_LENS: { rarity: 'uncommon', desc: 'Cards critical-hit more often (1 in 8). Critical hits deal triple damage.', mods: { critStage: 1, critMult: 1 } },
  EXP_SHARE: { rarity: 'rare', desc: 'POKéMON outside the lead get full EXP instead of half.', mods: { expShare: 1 } },
  EVERSTONE: { rarity: 'uncommon', desc: '+50% damage if any scoring card comes from a POKéMON that can still evolve.', onHand(s) { if (s.scoring.some(c => c.canEvolve && !c.status)) s.pct(50, 'EVERSTONE'); } },
  LAX_INCENSE: { rarity: 'uncommon', desc: "The enemy's first attack in each battle misses.", mods: { laxIncense: 1 } },
  CHOICE_BAND: { rarity: 'rare', desc: '+120% damage on every hand. You may play at most 4 cards per hand.', mods: { maxPlay: -1 }, onHand(s) { s.pct(120, 'CHOICE_BAND'); } },
  LIGHT_BALL: { rarity: 'uncommon', desc: "PIKACHU's cards deal double damage.", cardTimes(c) { return c.species === 'PIKACHU' ? 2 : 1; } },
  THICK_CLUB: { rarity: 'uncommon', desc: "CUBONE and MAROWAK's cards deal double damage.", cardTimes(c) { return c.species === 'CUBONE' || c.species === 'MAROWAK' ? 2 : 1; } },
  LUCKY_PUNCH: { rarity: 'uncommon', desc: "CHANSEY's cards always critical-hit. All cards deal +4 damage.", cardDmg() { return 4; }, critFor: ['CHANSEY'] },
  STICK: { rarity: 'uncommon', desc: "FARFETCH'D's cards always critical-hit. All cards deal +4 damage.", cardDmg() { return 4; }, critFor: ['FARFETCHD'] },
  METAL_POWDER: { rarity: 'uncommon', desc: 'Your lead takes 15% less damage (DITTO: 50%).', mods: { dmgTaken: -0.15 } },
  DEEP_SEA_TOOTH: { rarity: 'uncommon', desc: 'Special cards deal +40% damage.', cardPct(c) { return c.physical ? 0 : 40; } },
  DEEP_SEA_SCALE: { rarity: 'uncommon', desc: 'Your lead takes 20% less damage from special moves.', mods: { spDmgTaken: -0.2 } },
  SOUL_DEW: { rarity: 'rare', desc: '+80% damage if the hand contains a PSYCHIC or DRAGON card.', onHand(s) { if (s.cards.some(c => !c.status && (c.type === 'PSYCHIC' || c.type === 'DRAGON'))) s.pct(80, 'SOUL_DEW'); } },
  UP_GRADE: { rarity: 'uncommon', desc: "+10% damage for every card in your lead's deck above 10 (max +60%).", onHand(s) { const n = Math.min(6, Math.max(0, s.deckSize - 10)); if (n) s.pct(10 * n, 'UP_GRADE'); } },
  DRAGON_SCALE: { rarity: 'rare', desc: '+160% damage on QUAD or PENTA.', onHand(s) { if (s.comboKey === 'QUAD' || s.comboKey === 'PENTA') s.pct(160, 'DRAGON_SCALE'); } },

  // Key items: unique effects.
  BICYCLE: { rarity: 'rare', desc: '+1 hand size.', mods: { handSize: 1 } },
  MACH_BIKE: { rarity: 'uncommon', desc: 'Your POKéMON are 15% faster.', mods: { speedMult: 0.15 } },
  ACRO_BIKE: { rarity: 'uncommon', desc: 'Once per turn, discarding exactly 1 card is free (on top of your FREE DISCARD).', mods: { acroBike: 1 } },
  TOWN_MAP: { rarity: 'uncommon', desc: 'Card and item rewards offer one more choice.', mods: { rewardChoices: 1 } },
  TM_CASE: { rarity: 'uncommon', desc: 'Moves cost nothing to relearn at Centers. Move rewards offer one more choice.', mods: { moveChoices: 1 } },
  COIN_CASE: { rarity: 'uncommon', desc: 'After each battle, earn $5 interest per $100 you hold (max $250).', mods: { interest: 1 } },
  ITEMFINDER: { rarity: 'uncommon', desc: 'After each battle, 30% chance to find a random item.', mods: { itemfinder: 1 } },
  BERRY_POUCH: { rarity: 'common', desc: 'After each battle, 40% chance to find a berry.', mods: { berryPouch: 1 } },
  SILPH_SCOPE: { rarity: 'uncommon', desc: 'GHOST and DARK cards deal +80% damage. Reveals face-down cards.', cardPct(c) { return c.type === 'GHOST' || c.type === 'DARK' ? 80 : 0; }, mods: { trueSight: 1 } },
  POKE_FLUTE: { rarity: 'uncommon', desc: 'Your POKéMON wake up at the start of every turn.', mods: { pokeFlute: 1 } },
  VS_SEEKER: { rarity: 'common', desc: 'Trainers pay 50% more money.', mods: { trainerMoney: 0.5 } },
  FAME_CHECKER: { rarity: 'rare', desc: '+10% damage for every 4 trainers defeated this run, counting those beaten before you got it (max +80%).', onHand(s) { const n = Math.min(8, Math.floor((s.run.stats.trainers || 0) / 4)); if (n) s.pct(10 * n, 'FAME_CHECKER'); },
    bonus: (run) => { const t = run.stats?.trainers || 0, n = Math.min(8, Math.floor(t / 4)); return bonusTag(10 * n, `${t} trainer${t === 1 ? '' : 's'} beaten`, n < 8 && `next +10% at ${4 * (n + 1)}`); } },
  OAKS_PARCEL: { rarity: 'common', desc: 'At the start of each act, receive 3 POKé BALLS.', mods: { parcel: 1 } },
  TEA: { rarity: 'common', desc: 'Your lead heals 15% of its max HP at the start of each battle.', onBattleStart(b) { b.healLead(0.15, 'TEA'); } },
  SECRET_KEY: { rarity: 'uncommon', desc: 'FIRE cards deal +12 damage each.', cardDmg(c) { return c.type === 'FIRE' ? 12 : 0; } },
  CARD_KEY: { rarity: 'common', desc: 'POKé MARTS stock one more held item.', mods: { martItems: 1 } },
  LIFT_KEY: { rarity: 'common', desc: 'Elite battles give double money.', mods: { eliteMoney: 1 } },
  GOLD_TEETH: { rarity: 'uncommon', desc: 'Elite battles offer one extra held item choice.', mods: { eliteChoices: 1 } },
  SS_TICKET: { rarity: 'uncommon', desc: 'Everything in shops costs 20% less.', mods: { priceMult: -0.2 } },
  TEACHY_TV: { rarity: 'common', desc: '+20% damage for every hand your lead has played since it came out (max +80%).', onHand(s) { const n = Math.min(4, s.battle.leadStreak); if (n) s.pct(20 * n, 'TEACHY_TV'); },
    bonus: (run, b) => { if (!b) return null; const k = b.leadStreak || 0, n = Math.min(4, k); return bonusTag(20 * n, `your lead has played ${k} hand${k === 1 ? '' : 's'} since it came out`, n < 4 && 'next hand +20%'); } },
  RUBY: { rarity: 'rare', desc: '+80% damage if the hand contains a FIRE, FIGHTING or ROCK attack card.', onHand(s) { if (s.cards.some(c => !c.status && ['FIRE', 'FIGHTING', 'ROCK'].includes(c.type))) s.pct(80, 'RUBY'); } },
  SAPPHIRE: { rarity: 'rare', desc: '+80% damage if the hand contains a WATER, ICE or PSYCHIC attack card.', onHand(s) { if (s.cards.some(c => !c.status && ['WATER', 'ICE', 'PSYCHIC'].includes(c.type))) s.pct(80, 'SAPPHIRE'); } },
  METEORITE: { rarity: 'rare', desc: 'Every 4th hand you play deals +300% damage.', onHand(s) { if (s.battle.handsPlayed % 4 === 3) s.pct(300, 'METEORITE'); },
    counter: b => ({ text: `${b.handsPlayed % 4 + 1}/4`, ready: b.handsPlayed % 4 === 3 }) },
  OLD_AMBER: { rarity: 'rare', desc: '+40% damage for each ROCK-type POKéMON in your party.', onHand(s) { const n = s.run.party.filter(m => s.typesOf(m).includes('ROCK')).length; if (n) s.pct(40 * n, 'OLD_AMBER'); } },
  POWDER_JAR: { rarity: 'uncommon', desc: 'Gains +10% damage for every 3 PAIRs you play while holding it (max +80%).', onHand(s, st) { if (s.comboKey === 'PAIR') st.p = (st.p || 0) + 1; st.n = Math.min(8, Math.floor((st.p || 0) / 3)); if (st.n) s.pct(10 * st.n, 'POWDER_JAR'); },
    bonus: (run, b, st) => { const p = st.p || 0, n = Math.min(8, Math.floor(p / 3)); return bonusTag(10 * n, `${p} PAIR${p === 1 ? '' : 's'} played`, n < 8 && `next +10% at ${3 * (n + 1)}`); } },
  SHOAL_SHELL: { rarity: 'uncommon', desc: 'Gains +2 damage per hand each time you play a 5-card hand while holding it (max +30).', onHand(s, st) { if (s.cards.length === 5) st.n = Math.min(15, (st.n || 0) + 1); if (st.n) s.flat(2 * st.n, 'SHOAL_SHELL'); },
    bonus: (run, b, st) => { const n = Math.min(15, st.n || 0); return bonusTag(2 * n, `${n} five-card hand${n === 1 ? '' : 's'} played`, n < 15 && 'next 5-card hand +2', ''); } },
  RAINBOW_PASS: { rarity: 'rare', desc: 'COVERAGE needs only 3 different types.', mods: { coverage4: 1 } },
  TRI_PASS: { rarity: 'uncommon', desc: '+100% damage if the hand has exactly 3 cards.', onHand(s) { if (s.cards.length === 3) s.pct(100, 'TRI_PASS'); } },
  WAILMER_PAIL: { rarity: 'common', desc: 'GRASS cards heal their user 5% HP when they hit.', onCard(s, c) { if (c.type === 'GRASS') s.healOwner(c, 0.05); } },
  SOOT_SACK: { rarity: 'uncommon', desc: "+6% damage per FIRE card in your lead's deck.", onHand(s) { const n = s.deckCards.filter(c => c.type === 'FIRE').length; if (n) s.pct(6 * n, 'SOOT_SACK'); } },
  GO_GOGGLES: { rarity: 'common', desc: 'Weather never hurts your POKéMON. +50% damage during weather.', onHand(s) { if (s.battle.weather) s.pct(50, 'GO_GOGGLES'); } },
  DEVON_SCOPE: { rarity: 'uncommon', desc: 'See the next 3 cards of your draw pile. +10% damage.', onHand(s) { s.pct(10, 'DEVON_SCOPE'); }, mods: { peek: 3 } },
  // ---- second wave (flutes, scarves, fossils, orbs, tickets) ----
  BLUE_FLUTE: { rarity: 'common', desc: '+50% damage on hands that include a status card.', onHand(s) { if (s.cards.some(c => c.status)) s.pct(50, 'BLUE_FLUTE'); } },
  YELLOW_FLUTE: { rarity: 'common', desc: '+24% damage for each status card played in the hand.', onHand(s) { const n = s.cards.filter(c => c.status).length; if (n) s.pct(24 * n, 'YELLOW_FLUTE'); } },
  RED_FLUTE: { rarity: 'uncommon', desc: '+80% damage while the foe has a status condition.', onHand(s) { if (s.battle.enemy()?.status) s.pct(80, 'RED_FLUTE'); } },
  BLACK_FLUTE: { rarity: 'uncommon', desc: "+12% damage for every 10% of the foe's HP that is missing.", onHand(s) { const e = s.battle.enemy(); const n = e ? Math.floor((1 - e.hp / e.maxHp) * 10) : 0; if (n > 0) s.pct(12 * n, 'BLACK_FLUTE'); },
    // (co-op: opts.foe = the foe you're aiming at)
    bonus: (run, b, st, opts) => { const e = opts?.foe || b?.enemy?.(); if (!b || !e) return null; const miss = Math.max(0, 1 - e.hp / e.maxHp), n = Math.max(0, Math.floor(miss * 10)); return bonusTag(12 * n, `the foe is missing ${Math.floor(miss * 100)}% HP`, n < 9 && `next +12% at ${100 - 10 * (n + 1)}% HP or less`); } },
  WHITE_FLUTE: { rarity: 'uncommon', desc: '+160% damage on the first hand of each battle.', onHand(s) { if (s.battle.handsPlayed === 0) s.pct(160, 'WHITE_FLUTE'); },
    counter: b => (b.handsPlayed === 0 ? { text: 'NOW', ready: true } : null) },
  RED_SCARF: { rarity: 'common', desc: 'Physical cards deal +6 damage each.', cardDmg(c) { return c.physical ? 6 : 0; } },
  BLUE_SCARF: { rarity: 'common', desc: 'Special cards deal +6 damage each.', cardDmg(c) { return c.physical ? 0 : 6; } },
  PINK_SCARF: { rarity: 'common', desc: '+60% damage on PAIR or TWO PAIR.', onHand(s) { if (s.comboKey === 'PAIR' || s.comboKey === 'TWO_PAIR') s.pct(60, 'PINK_SCARF'); } },
  GREEN_SCARF: { rarity: 'uncommon', desc: '+70% damage on TRIPLE or FULL HOUSE.', onHand(s) { if (s.comboKey === 'TRIPLE' || s.comboKey === 'FULL_HOUSE') s.pct(70, 'GREEN_SCARF'); } },
  YELLOW_SCARF: { rarity: 'uncommon', desc: '+120% damage on COVERAGE.', onHand(s) { if (s.comboKey === 'COVERAGE') s.pct(120, 'YELLOW_SCARF'); } },
  SHOAL_SALT: { rarity: 'uncommon', desc: 'Super-effective cards deal +50% damage.', cardPct(c) { return (c.eff ?? 1) > 1 ? 50 : 0; } },
  SCANNER: { rarity: 'uncommon', desc: '+50% damage if any card in the hand is super effective.', onHand(s) { if (s.cards.some(c => !c.status && (c.eff ?? 1) > 1)) s.pct(50, 'SCANNER'); } },
  LAVA_COOKIE: { rarity: 'common', desc: 'Your lead heals 4% of its max HP after every hand.', onHand(s) { s.battle.healLead(0.04, 'LAVA_COOKIE'); } },
  ENERGY_ROOT: { rarity: 'uncommon', desc: '+160% damage while your lead is below 1/3 HP.', onHand(s) { const l = s.battle.lead(); if (l && s.battle.hpFrac('player', l) < 1 / 3) s.pct(160, 'ENERGY_ROOT'); } },
  ENERGY_POWDER: { rarity: 'common', desc: "+12% damage per status card in your lead's deck (max +60%).", onHand(s) { const n = Math.min(5, s.deckCards.filter(c => c.status).length); if (n) s.pct(12 * n, 'ENERGY_POWDER'); } },
  HEAL_POWDER: { rarity: 'common', desc: 'Your lead is cured of status at the start of every battle. +10% damage.', onBattleStart(b) { const l = b.lead(); if (l?.status) { l.status = null; b.msg('HEAL POWDER cured your lead!'); } }, onHand(s) { s.pct(10, 'HEAL_POWDER'); } },
  GOOD_ROD: { rarity: 'uncommon', desc: '+24% damage for every discard you have left.', onHand(s) { const n = s.battle.discardsLeft || 0; if (n) s.pct(24 * n, 'GOOD_ROD'); } },
  DOME_FOSSIL: { rarity: 'common', desc: '+16% damage for every card left in your hand after playing.', onHand(s) { const n = s.battle.deck.hand.filter(c => !s.cards.some(i => i.card === c)).length; if (n) s.pct(16 * n, 'DOME_FOSSIL'); } }, // (the preview runs with the played cards still in hand)
  HELIX_FOSSIL: { rarity: 'uncommon', desc: "+10% damage for each different attack type in your lead's deck.", onHand(s) { const n = new Set(s.deckCards.filter(c => !c.status).map(c => c.type)).size; if (n) s.pct(10 * n, 'HELIX_FOSSIL'); } },
  POKEBLOCK_CASE: { rarity: 'common', desc: '+16% damage for every POKéMON that has led this battle (max +80%).', onHand(s) { const n = Math.min(5, s.battle.participants.size); if (n) s.pct(16 * n, 'POKEBLOCK_CASE'); },
    bonus: (run, b) => { if (!b?.participants) return null; const k = b.participants.size, n = Math.min(5, k); return bonusTag(16 * n, `${k} POKéMON ha${k === 1 ? 's' : 've'} led this battle`, n < 5 && 'switch in another for +16%'); } },
  RED_ORB: { rarity: 'rare', desc: '+80% damage on hands with 4 or more attack cards.', onHand(s) { if (s.cards.filter(c => !c.status).length >= 4) s.pct(80, 'RED_ORB'); } },
  BLUE_ORB: { rarity: 'rare', desc: '+160% damage on hands of exactly 2 cards.', onHand(s) { if (s.cards.length === 2) s.pct(160, 'BLUE_ORB'); } },
  MYSTIC_TICKET: { rarity: 'rare', desc: '+4% damage for every foe your hands knock out while you hold it (max +200%).', onKO(b) { const r = b.run.relics.find(x => x.key === 'MYSTIC_TICKET'); if (r) { r.state ||= {}; r.state.n = (r.state.n || 0) + 1; } }, onHand(s, st) { const n = Math.min(200, 4 * (st.n || 0)); if (n) s.pct(n, 'MYSTIC_TICKET'); },
    bonus: (run, b, st) => { const k = st.n || 0, v = Math.min(200, 4 * k); return bonusTag(v, `${k} foe${k === 1 ? '' : 's'} knocked out`, v < 200 && 'next KO +4%'); } },
  AURORA_TICKET: { rarity: 'rare', desc: '+60% damage on every hand, but your POKéMON take 10% more damage.', onHand(s) { s.pct(60, 'AURORA_TICKET'); }, mods: { dmgTaken: 0.1 } },
  EON_TICKET: { rarity: 'rare', desc: '+120% damage on hands with attack cards of 3+ different types.', onHand(s) { if (atkTypes(s).size >= 3) s.pct(120, 'EON_TICKET'); } },
});

// Legendary held items: one per legendary bird / REGI (BIRDS in acts.js). Only beating that legendary
// gives it (they never show up in shops, rewards or events). `name` registers the item (data.js).
const legendItem = (name, type, desc, extra) => ({ rarity: 'rare', unique: true, legendary: true, name, boostType: type, desc, cardPct(c) { return c.type === type ? 50 : 0; }, ...extra });
Object.assign(RELICS, {
  THUNDER_FEATHER: legendItem('THUNDER FEATHER', 'ELECTRIC', '+1 hand size. ELECTRIC cards deal +50% damage.', { mods: { handSize: 1 } }),
  FROST_FEATHER: legendItem('FROST FEATHER', 'ICE', 'Your POKéMON take 20% less damage. ICE cards deal +50% damage.', { mods: { dmgTaken: -0.2 } }),
  FLAME_FEATHER: legendItem('FLAME FEATHER', 'FIRE', 'Your party heals 12% after every battle. FIRE cards deal +50% damage.', { mods: { postHeal: 0.12 } }),
  ROCK_CORE: legendItem('ROCK CORE', 'ROCK', 'Your POKéMON take 15% less damage. ROCK cards deal +50% damage.', { mods: { dmgTaken: -0.15 } }),
  ICE_CORE: legendItem('ICE CORE', 'ICE', '+1 discard each battle. ICE cards deal +50% damage.', { mods: { discards: 1 } }),
  STEEL_CORE: legendItem('STEEL CORE', 'STEEL', 'Once per battle, your lead survives a fatal hit with 1 HP. STEEL cards deal +50% damage.', { mods: { focusBand: 1 } }),
  // JOHTO's legendary beasts (v0.1.1; no art of their own: they borrow an item icon)
  THUNDER_MANE: legendItem('THUNDER MANE', 'ELECTRIC', 'Your POKéMON are 20% faster. ELECTRIC cards deal +50% damage.', { mods: { speedMult: 0.2 }, icon: 'MAGNET' }),
  VOLCANO_MANE: legendItem('VOLCANO MANE', 'FIRE', '+1 hand size. FIRE cards deal +50% damage.', { mods: { handSize: 1 }, icon: 'CHARCOAL' }),
  CLEAR_BELL: legendItem('CLEAR BELL', 'WATER', 'Your party heals 12% after every battle. WATER cards deal +50% damage.', { mods: { postHeal: 0.12 }, icon: 'SOOTHE_BELL' }),
});

// Curse held items (v0.0.7): bad held items some "?" events hand out as a cost. They have rarity 'curse',
// a purple look (scenes/common.js), never show up in shops/rewards (unique), can't be sold, and go away only
// through a POKéMON CENTER's CLEANSE (paid) or a cleansing event (MR. FUJI, MT. PYRE). icon: the item art used.
const curse = (name, icon, desc, extra) => ({ rarity: 'curse', curse: true, unique: true, name, icon, desc, ...extra });
Object.assign(RELICS, {
  CURSED_DOLL: curse('CURSED DOLL', 'POKE_DOLL', 'CURSE: -1 hand size.', { mods: { handSize: -1 } }),
  HEX_LETTER: curse('HEX LETTER', 'SHADOW_MAIL', 'CURSE: -1 discard each battle, and enemies deal 5% more damage.', { mods: { discards: -1, dmgTaken: 0.05 } }),
  LAGGING_TAIL: curse('LAGGING TAIL', 'FLUFFY_TAIL', 'CURSE: your POKéMON are 40% slower.', { mods: { speedMult: -0.4 } }),
  ROTTEN_MUSHROOM: curse('ROTTEN SHROOM', 'TINY_MUSHROOM', 'CURSE: your party loses 8% HP after every battle.', { mods: { postHurt: 0.08 } }),
  IOU_NOTE: curse('IOU NOTE', 'HARBOR_MAIL', 'CURSE: shop prices +25%, and battles pay 25% less money.', { mods: { priceMult: 0.25, moneyMult: -0.25 } }),
});
export const CURSES = Object.keys(RELICS).filter(k => RELICS[k].curse);
export const isCurse = (key) => !!RELICS[key]?.curse;
for (const [k, r] of Object.entries(RELICS)) { r.key = k; }
export const RELIC_PRICE = { common: 1500, uncommon: 3000, rare: 5000 };

// Badges: boss rewards, permanent passives.
export const BADGES = {
  BOULDER: { name: 'BOULDER BADGE', leader: 'BROCK', desc: '+10 damage on every hand.', onHand(s) { s.flat(10, 'BOULDER'); } },
  CASCADE: { name: 'CASCADE BADGE', leader: 'MISTY', desc: '+1 discard each battle.', mods: { discards: 1 } },
  THUNDER: { name: 'THUNDER BADGE', leader: 'LT_SURGE', desc: '+1 hand size.', mods: { handSize: 1 } },
  RAINBOW: { name: 'RAINBOW BADGE', leader: 'ERIKA', desc: 'Your party heals 10% after every battle.', mods: { postHeal: 0.1 } },
  SOUL: { name: 'SOUL BADGE', leader: 'KOGA', desc: 'Your POKéMON take 15% less damage.', mods: { dmgTaken: -0.15 } },
  MARSH: { name: 'MARSH BADGE', leader: 'SABRINA', desc: '+40% damage on every hand.', onHand(s) { s.pct(40, 'MARSH'); } },
  VOLCANO: { name: 'VOLCANO BADGE', leader: 'BLAINE', desc: 'Special cards deal +30% damage.', cardPct(c) { return c.physical ? 0 : 30; } },
  EARTH: { name: 'EARTH BADGE', leader: 'GIOVANNI', desc: '+80% damage on TRIPLE or better.', onHand(s) { if (s.comboRank >= 3) s.pct(80, 'EARTH'); } },
  // Hoenn (no badge art in FireRed: shown with an item icon)
  STONE: { name: 'STONE BADGE', leader: 'ROXANNE', icon: 'HARD_STONE', desc: '+8 damage on every hand.', onHand(s) { s.flat(8, 'STONE'); } },
  KNUCKLE: { name: 'KNUCKLE BADGE', leader: 'BRAWLY', icon: 'BLACK_BELT', desc: 'Physical cards deal +30% damage.', cardPct(c) { return c.physical ? 30 : 0; } },
  DYNAMO: { name: 'DYNAMO BADGE', leader: 'WATTSON', icon: 'MAGNET', desc: '+1 hand size.', mods: { handSize: 1 } },
  HEAT: { name: 'HEAT BADGE', leader: 'FLANNERY', icon: 'CHARCOAL', desc: '+1 discard each battle.', mods: { discards: 1 } },
  BALANCE: { name: 'BALANCE BADGE', leader: 'NORMAN', icon: 'SILK_SCARF', desc: '+30% damage on every hand.', onHand(s) { s.pct(30, 'BALANCE'); } },
  FEATHER: { name: 'FEATHER BADGE', leader: 'WINONA', icon: 'SHARP_BEAK', desc: 'Your POKéMON take 10% less damage.', mods: { dmgTaken: -0.1 } },
  MIND: { name: 'MIND BADGE', leader: 'TATE_LIZA', icon: 'TWISTED_SPOON', desc: 'Special cards deal +30% damage.', cardPct(c) { return c.physical ? 0 : 30; } },
  RAIN: { name: 'RAIN BADGE', leader: 'WALLACE', icon: 'MYSTIC_WATER', desc: '+80% damage on FULL HOUSE or better.', onHand(s) { if (s.comboRank >= 4) s.pct(80, 'RAIN'); } },
  // Johto (v0.1.1; no badge art in FireRed: shown with an item icon)
  ZEPHYR: { name: 'ZEPHYR BADGE', leader: 'FALKNER', icon: 'SHARP_BEAK', desc: 'Your POKéMON are 15% faster. +4 damage on every hand.', mods: { speedMult: 0.15 }, onHand(s) { s.flat(4, 'ZEPHYR'); } },
  HIVE: { name: 'HIVE BADGE', leader: 'BUGSY', icon: 'SILVER_POWDER', desc: '+8 damage on every hand.', onHand(s) { s.flat(8, 'HIVE'); } },
  PLAIN: { name: 'PLAIN BADGE', leader: 'WHITNEY', icon: 'MOOMOO_MILK', desc: '+10% damage for every hand your lead has played since it came out (max +50%).', onHand(s) { const n = Math.min(5, s.battle.leadStreak); if (n) s.pct(10 * n, 'PLAIN'); } },
  FOG: { name: 'FOG BADGE', leader: 'MORTY', icon: 'SPELL_TAG', desc: 'Reveals face-down cards. Enemy attacks are 10% less accurate.', mods: { trueSight: 1, enemyAcc: -0.1 } },
  STORM: { name: 'STORM BADGE', leader: 'CHUCK', icon: 'BLACK_BELT', desc: 'Physical cards deal +30% damage.', cardPct(c) { return c.physical ? 30 : 0; } },
  MINERAL: { name: 'MINERAL BADGE', leader: 'JASMINE', icon: 'METAL_COAT', desc: 'Your POKéMON take 15% less damage.', mods: { dmgTaken: -0.15 } },
  GLACIER: { name: 'GLACIER BADGE', leader: 'PRYCE', icon: 'NEVER_MELT_ICE', desc: '+1 hand size.', mods: { handSize: 1 } },
  RISING: { name: 'RISING BADGE', leader: 'CLAIR', icon: 'DRAGON_FANG', desc: '+80% damage on FULL HOUSE or better.', onHand(s) { if (s.comboRank >= 4) s.pct(80, 'RISING'); } },
};
for (const [k, b] of Object.entries(BADGES)) b.key = k;
export function badgeIcon(key) { const b = BADGES[key]; return b?.icon ? `gfx/items/${b.icon.toLowerCase()}.png` : `gfx/misc/badges/${key.toLowerCase()}.png`; }

// Consumables: medicine, battle items, vitamins (combo level-ups), evolution items, TMs.
// target: 'mon' | 'monAlive' | 'monFainted' | 'none' | 'monMove'
export const VITAMIN_COMBO = {
  RED_SHARD: 'SINGLE', HP_UP: 'PAIR', PROTEIN: 'TWO_PAIR', IRON: 'TRIPLE', BLUE_SHARD: 'COVERAGE', YELLOW_SHARD: 'TWO_PAIR',
  CALCIUM: 'FULL_HOUSE', ZINC: 'QUAD', CARBOS: 'PENTA',
};

export const CONSUMABLES = {
  POTION: { price: 300, target: 'monAlive', heal: 20, battle: true },
  SUPER_POTION: { price: 700, target: 'monAlive', heal: 50, battle: true },
  HYPER_POTION: { price: 1200, target: 'monAlive', heal: 200, battle: true },
  MAX_POTION: { price: 2500, target: 'monAlive', heal: 9999, battle: true },
  FULL_RESTORE: { price: 3000, target: 'monAlive', heal: 9999, cure: true, battle: true },
  FRESH_WATER: { price: 200, target: 'monAlive', heal: 50, battle: true },
  SODA_POP: { price: 300, target: 'monAlive', heal: 60, battle: true },
  LEMONADE: { price: 350, target: 'monAlive', heal: 80, battle: true },
  MOOMOO_MILK: { price: 500, target: 'monAlive', heal: 100, battle: true },
  BERRY_JUICE: { price: 100, target: 'monAlive', heal: 20, battle: true },
  ORAN_BERRY: { price: 100, target: 'monAlive', heal: 10, battle: true, berry: true },
  SITRUS_BERRY: { price: 300, target: 'monAlive', healFrac: 0.25, battle: true, berry: true },
  LUM_BERRY: { price: 300, target: 'monAlive', cure: true, battle: true, berry: true },
  CHESTO_BERRY: { price: 100, target: 'monAlive', cure: 'SLP', battle: true, berry: true },
  PECHA_BERRY: { price: 100, target: 'monAlive', cure: 'PSN', battle: true, berry: true },
  CHERI_BERRY: { price: 100, target: 'monAlive', cure: 'PAR', battle: true, berry: true },
  RAWST_BERRY: { price: 100, target: 'monAlive', cure: 'BRN', battle: true, berry: true },
  ASPEAR_BERRY: { price: 100, target: 'monAlive', cure: 'FRZ', battle: true, berry: true },
  LIECHI_BERRY: { price: 400, target: 'none', stage: ['atk', 1], battleOnly: true, berry: true },
  PETAYA_BERRY: { price: 400, target: 'none', stage: ['spa', 1], battleOnly: true, berry: true },
  SALAC_BERRY: { price: 400, target: 'none', stage: ['spe', 1], battleOnly: true, berry: true },
  ANTIDOTE: { price: 100, target: 'monAlive', cure: 'PSN', battle: true },
  PARALYZE_HEAL: { price: 200, target: 'monAlive', cure: 'PAR', battle: true },
  AWAKENING: { price: 250, target: 'monAlive', cure: 'SLP', battle: true },
  BURN_HEAL: { price: 250, target: 'monAlive', cure: 'BRN', battle: true },
  ICE_HEAL: { price: 250, target: 'monAlive', cure: 'FRZ', battle: true },
  FULL_HEAL: { price: 600, target: 'monAlive', cure: true, battle: true },
  REVIVE: { price: 1500, target: 'monFainted', revive: 0.5, battle: true },
  MAX_REVIVE: { price: 4000, target: 'monFainted', revive: 1, battle: true },
  REVIVAL_HERB: { price: 2800, target: 'monFainted', revive: 1, battle: true },
  SACRED_ASH: { price: 6000, target: 'none', reviveAll: true },
  X_ATTACK: { price: 500, target: 'none', stage: ['atk', 2], battleOnly: true },
  X_SPECIAL: { price: 500, target: 'none', stage: ['spa', 2], battleOnly: true },
  X_DEFEND: { price: 550, target: 'none', stage: ['def', 2], battleOnly: true },
  X_SPEED: { price: 350, target: 'none', stage: ['spe', 2], battleOnly: true },
  X_ACCURACY: { price: 950, target: 'none', stage: ['acc', 2], battleOnly: true },
  DIRE_HIT: { price: 650, target: 'none', focus: true, battleOnly: true },
  GUARD_SPEC: { price: 700, target: 'none', mist: true, battleOnly: true },
  POKE_DOLL: { price: 1000, target: 'none', flee: true, battleOnly: true },
  FLUFFY_TAIL: { price: 1000, target: 'none', flee: true, battleOnly: true },
  ESCAPE_ROPE: { price: 550, target: 'none', flee: true, battleOnly: true, anyNonBoss: true },
  RARE_CANDY: { price: 1500, target: 'monAlive', levels: 3 },
  PP_UP: { price: 2000, target: 'monMove', addCopy: 1 },
  PP_MAX: { price: 4500, target: 'monMove', addCopy: 2 },
  HEART_SCALE: { price: 1000, target: 'mon', relearn: true },
  SUN_STONE: { price: 2100, target: 'mon', evo: true },
  MOON_STONE: { price: 2100, target: 'mon', evo: true },
  FIRE_STONE: { price: 2100, target: 'mon', evo: true },
  THUNDER_STONE: { price: 2100, target: 'mon', evo: true },
  WATER_STONE: { price: 2100, target: 'mon', evo: true },
  LEAF_STONE: { price: 2100, target: 'mon', evo: true },
  NUGGET: { price: 0, target: 'none', sell: 5000 },
  STAR_PIECE: { price: 0, target: 'none', sell: 4900 },
  BIG_PEARL: { price: 0, target: 'none', sell: 3750 },
  PEARL: { price: 0, target: 'none', sell: 700 },
  STARDUST: { price: 0, target: 'none', sell: 1000 },
  BIG_MUSHROOM: { price: 0, target: 'none', sell: 2500 },
  TINY_MUSHROOM: { price: 0, target: 'none', sell: 250 },
};
for (const [k, v] of Object.entries(VITAMIN_COMBO)) {
  CONSUMABLES[k] = { price: k.endsWith('SHARD') || k === 'SHOAL_SALT' ? 1600 : 2400, target: 'none', combo: v };
}
for (const [k, c] of Object.entries(CONSUMABLES)) c.key = k;

export const BALLS = {
  POKE_BALL: { price: 200, rate: 1 },
  GREAT_BALL: { price: 600, rate: 1.5 },
  ULTRA_BALL: { price: 1200, rate: 2 },
  MASTER_BALL: { price: 0, rate: 255 },
  NET_BALL: { price: 1000, rate: 1, special: 'net' },
  NEST_BALL: { price: 1000, rate: 1, special: 'nest' },
  TIMER_BALL: { price: 1000, rate: 1, special: 'timer' },
  REPEAT_BALL: { price: 1000, rate: 1, special: 'repeat' },
  DIVE_BALL: { price: 1000, rate: 1, special: 'dive' },
  LUXURY_BALL: { price: 1000, rate: 1 },
  PREMIER_BALL: { price: 200, rate: 1 },
  // KURT's APRICORN BALLS (JOHTO, v0.1.1): KURT's "?" event and JOHTO MARTS. They only change who joins (catch odds;
  // the FRIEND BALL's extra card), never damage. Rules: battle.js apricornRate. FireRed's item data has none of them,
  // so name/desc are registered into D.items (data.js); icon: HGSS art (tools: gfx/items/hgss/), falling back to the
  // POKé BALL icon until it's extracted (engine/assets.js itemPath); sprite: the thrown ball (gfx/ui/balls/).
  FAST_BALL: { price: 1000, rate: 1, special: 'fast', apricorn: 'WHITE', icon: 'hgss/fast_ball', sprite: 'poke', name: 'FAST BALL', desc: 'An APRICORN BALL by KURT. x3 catch rate on fast POKéMON (base SPEED 100+).' },
  LEVEL_BALL: { price: 1000, rate: 1, special: 'level', apricorn: 'RED', icon: 'hgss/level_ball', sprite: 'poke', name: 'LEVEL BALL', desc: 'An APRICORN BALL by KURT. x2 if your lead is a higher level than the foe, x3 at 10+ levels above, x4 at double its level.' },
  LURE_BALL: { price: 1000, rate: 1, special: 'lure', apricorn: 'BLUE', icon: 'hgss/lure_ball', sprite: 'dive', name: 'LURE BALL', desc: 'An APRICORN BALL by KURT. x3 catch rate on the water (x1.5 on WATER POKéMON elsewhere).' },
  HEAVY_BALL: { price: 1000, rate: 1, special: 'heavy', apricorn: 'BLACK', icon: 'hgss/heavy_ball', sprite: 'poke', name: 'HEAVY BALL', desc: 'An APRICORN BALL by KURT. Better the heavier the POKéMON: x2 from 100 kg, x3 from 200 kg, x4 from 300 kg.' },
  LOVE_BALL: { price: 1000, rate: 1, special: 'love', apricorn: 'PINK', icon: 'hgss/love_ball', sprite: 'poke', name: 'LOVE BALL', desc: 'An APRICORN BALL by KURT. x3 on the same species as your lead (x2 on its evolution family).' },
  MOON_BALL: { price: 1000, rate: 1, special: 'moon', apricorn: 'YELLOW', icon: 'hgss/moon_ball', sprite: 'poke', name: 'MOON BALL', desc: 'An APRICORN BALL by KURT. x4 on POKéMON of the MOON STONE families (NIDORAN, CLEFAIRY, JIGGLYPUFF, SKITTY).' },
  FRIEND_BALL: { price: 600, rate: 1, special: 'friend', apricorn: 'GREEN', icon: 'hgss/friend_ball', sprite: 'poke', name: 'FRIEND BALL', desc: 'An APRICORN BALL by KURT. A POKéMON caught in it joins with +1 copy of its best move.' },
};
export const APRICORN_BALLS = Object.keys(BALLS).filter(k => BALLS[k].apricorn);
// FRIEND BALL: the catch's strongest attack (else its first card) gets +1 copy.
export function friendCopy(mon, moves) {
  const best = [...mon.moves].sort((a, b) => (moves?.[b.move]?.power || 0) - (moves?.[a.move]?.power || 0))[0];
  if (best) best.copies = (best.copies || 1) + 1;
  return best?.move || null;
}

export function ballRate(ballKey, target, battle) {
  const b = BALLS[ballKey];
  if (!b) return 1;
  const types = target.types;
  switch (b.special) {
    case 'net': return types.includes('WATER') || types.includes('BUG') ? 3 : 1;
    case 'nest': return Math.max(1, (40 - target.level) / 10);
    case 'timer': return Math.min(4, 1 + battle.turn * 0.3);
    case 'repeat': return battle.run.caughtSpecies?.includes(target.species) ? 3 : 1;
    case 'dive': return types.includes('WATER') ? 3.5 : 1;
    default: return b.rate;
  }
}

// What item does a TM teach? items like TM24_THUNDERBOLT -> THUNDERBOLT
export function tmMove(itemKey) {
  const m = /^(?:TM|HM)\d\d_(.+)$/.exec(itemKey);
  return m ? m[1] : null;
}
