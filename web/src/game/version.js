
// Game version and patch notes (shown from the title screen). Versions are major.minor.patch: every production
// deploy that changes the game bumps the patch (v0.2.0 -> v0.2.1); the owner calls minor bumps (v0.1.x -> v0.2.0);
// no major bumps yet. Each one gets a new top PATCH_NOTES entry; see AGENTS.md.
export const VERSION = 'v0.3.24';

export const PATCH_NOTES = [
  {
    v: 'v0.3.24',
    sections: [
      ['CHANGES', [
        'Co-op, NOW PLAYING and RECORDS update live instead of polling',
        'Cloud saves sync once per map node, only the part that changed',
        'Game data downloads in smaller packs, cached until they change',
      ]],
    ],
  },
  {
    v: 'v0.3.23',
    sections: [
      ['NEW', [
        'Click a POKéMON in the Pokédex for its entry: description, stats, abilities, evolutions and moves',
      ]],
      ['CHANGES', [
        'After FLY, DIG, DIVE or BOUNCE dodges, your POKéMON spends the next turn LANDING: no dodging or protecting',
      ]],
      ['FIXES', [
        'Fixed RAYQUAZA, MEWTWO and DEOXYS not showing as the boss on the map',
      ]],
    ],
  },
  {
    v: 'v0.3.22',
    sections: [
      ['FIXES', [
        'Fixed sign-in getting stuck after leaving the Google page',
      ]],
    ],
  },
  {
    v: 'v0.3.21',
    sections: [
      ['NEW', [
        'Battle names show who moves 1st, 2nd... this turn',
        'The ascension shows top left; hover it for its active effects',
        'FAME CHECKER and other growing held items show their current bonus',
        'Co-op: reorder your team between ELITE FOUR battles',
      ]],
      ['CHANGES', [
        'At the held-item limit, the shop reroll asks first (it only rolls TMs)',
      ]],
      ['FIXES', [
        'Fixed co-op not filling in the Pokédex',
        "Fixed co-op records losing each player's team",
        'Fixed badges covering the money display',
      ]],
    ],
  },
  {
    v: 'v0.3.20',
    sections: [
      ['FIXES', [
        'Fixed trackpad scrolling (Mac) being far too fast',
      ]],
    ],
  },
  {
    v: 'v0.3.19',
    sections: [
      ['NEW', [
        'COMBOS is now INFO, with COMBOS, TYPE CHART and STATUSES tabs',
      ]],
      ['CHANGES', [
        'PROTECT, DETECT and ENDURE only make your hand go first when they work',
      ]],
    ],
  },
  {
    v: 'v0.3.18',
    sections: [
      ['CHANGES', [
        "Co-op runs in RECORDS show one line per player with that player's whole team",
      ]],
    ],
  },
  {
    v: 'v0.3.17',
    sections: [
      ['CHANGES', [
        'TMs cost half as much at the POKé MART',
        'METEORITE and WHITE FLUTE show when they trigger',
        'FILL is the default SCREEN mode',
      ]],
      ['FIXES', [
        'Fixed map nodes showing faded at the start of later acts',
        "Fixed the foe's next move flashing up while its current move plays",
      ]],
    ],
  },
  {
    v: 'v0.3.16',
    sections: [
      ['FIXES', [
        'Fixed the co-op TEAM UP tag overlapping the foe HP line',
        'Fixed long trainer names running under the money display',
      ]],
    ],
  },
  {
    v: 'v0.3.15',
    sections: [
      ['NEW', [
        'Added AUTO in battle: plays the suggested hand every turn until you stop it (U)',
        'Added a picture guide to HOW TO PLAY, also reachable from the map MENU and the ? in battle',
      ]],
      ['CHANGES', [
        'Selected STATUS cards are marked NO COMBO, solo and co-op',
      ]],
    ],
  },
  {
    v: 'v0.3.14',
    sections: [
      ['NEW', [
        'Co-op legendary nodes have two legendaries; each player can catch one',
      ]],
      ['CHANGES', [
        'Bosses, elites and legendaries no longer use SELF-DESTRUCT or EXPLOSION; other foes only at low HP',
        'CURSE and other status moves list their exact effects',
        'Removed TORMENT, MEAN LOOK, SPIDER WEB and BLOCK from the moves you can get',
      ]],
    ],
  },
  {
    v: 'v0.3.13',
    sections: [
      ['NEW', [
        'Added NOW PLAYING to the title screen',
        'Added a SCREEN setting: AUTO, PIXEL (whole-number scale) or FILL',
      ]],
      ['CHANGES', [
        'Map paths are easier to read: open routes stand out and hovering a node traces the way there',
        'Finished co-op games close and appear in RECORDS as one team entry',
        'The face-down cards rule says when your SILPH SCOPE or FOG BADGE reveals them',
      ]],
    ],
  },
  {
    v: 'v0.3.12',
    sections: [
      ['CHANGES', [
        'After your lead faints, pick the next one from the party list (the foes stay in view)',
      ]],
    ],
  },
  {
    v: 'v0.3.11',
    sections: [
      ['CHANGES', [
        'Co-op wins show in RECORDS as one team entry',
      ]],
    ],
  },
  {
    v: 'v0.3.10',
    sections: [
      ['CHANGES', [
        'The low-HP alarm now beeps three times and stops',
      ]],
    ],
  },
  {
    v: 'v0.3.9',
    sections: [
      ['CHANGES', [
        'Slowed mouse-wheel scrolling on the records screen',
      ]],
    ],
  },
  {
    v: 'v0.3.8',
    sections: [
      ['FIXES', [
        'Fixed the message box showing four advance arrows instead of one',
      ]],
    ],
  },
  {
    v: 'v0.3.7',
    sections: [
      ['CHANGES', [
        'Co-op room ascension is now the highest unlock among the players’ chosen starters',
        'Co-op wins unlock the next ascension even above your own unlock',
        'Moves already offered to a POKéMON show up less often',
        'POKéMON with small move pools learn more moves (evolution line and type moves)',
        'KING’S ROCK rolls once per hand (was per card)',
        'Resized JOHTO trainer portraits to match FireRed’s',
      ]],
      ['FIXES', [
        'Fixed UP-GRADE, SOOT SACK, HELIX FOSSIL, ENERGY POWDER and DOME FOSSIL dealing less damage than previewed',
        'Fixed REST not healing when the battle ended first',
      ]],
    ],
  },
  {
    v: 'v0.3.6',
    sections: [
      ['CHANGES', [
        'Added SAVE & QUIT to co-op',
        'Co-op saves now survive game updates',
        'Fixed co-op games from v0.3.1 resuming at the first battle',
        'Co-op games stay in the REJOIN list for 30 days (was 24 hours)',
      ]],
    ],
  },
  {
    v: 'v0.3.5',
    sections: [
      ['CHANGES', [
        'DISABLE blocks the foe’s next move only (was the next two)',
      ]],
    ],
  },
  {
    v: 'v0.3.4',
    sections: [
      ['CHANGES', [
        'A5 LEVEL CAP: EXP past the cap is now lost (it no longer goes to your lowest-level POKéMON)',
        'Tightened all patch notes',
      ]],
    ],
  },
  {
    v: 'v0.3.3',
    sections: [
      ['FIXES', [
        'Fixed the co-op hint line running under the HINT / LOCK IN / DISCARD buttons',
      ]],
    ],
  },
  {
    v: 'v0.3.2',
    sections: [
      ['EXP AND LEVELS', [
        'EXP now scales with level: POKéMON above the foe’s level earn less, below it more (shown on the victory screen)',
        'Fainted POKéMON no longer earn EXP, level up or learn moves (including a revived co-op lead)',
        'A5 is now LEVEL CAP (replaces WEARY): levels cap at the act boss’s top level +2',
      ]],
      ['BATTLES', [
        'DIVE, DIG, FLY and BOUNCE now dodge all foe moves, status included, except the Gen 3 exceptions (SURF and WHIRLPOOL vs DIVE; EARTHQUAKE, MAGNITUDE and FISSURE vs DIG; GUST, TWISTER, THUNDER and SKY UPPERCUT vs FLY and BOUNCE)',
        'Trainers stay on screen longer in the battle intro (tap to skip)',
        'Added a draw pile tooltip (hover or tap): moves left with counts, and the discard pile size',
        'Co-op: the foe’s POKé BALLS (POKéMON left) now show under their HP boxes',
        'Background-changing animations (SHADOW BALL, PSYCHIC...) now fade at FireRed speed',
      ]],
      ['MAP AND SCREENS', [
        'Every map node now shows what it is on hover, not just the next ones (except ? rooms)',
        'Bosses show their preferred type on the map, the NEXT GYM preview and the ELITE FOUR break screen',
        'Added a TYPE CHART tab to the COMBOS screen',
        'Added warning before skipping a held item',
      ]],
      ['STARTERS AND ITEMS', [
        'PIKACHU starts with CHARGE BEAM and a LIGHT BALL',
        'MACHOP starts with a MACHO BRACE; BLUE no longer brings two ABRA against it',
        'EXP SHARE is now a rare held item; POKé FLUTE is now uncommon',
      ]],
    ],
  },
  {
    v: 'v0.3.1',
    sections: [
      ['CHANGES', [
        'Your rival’s starter is now always super effective against yours, from any region if needed (MACHOP → ABRA, PIKACHU and GASTLY → NINCADA, DRATINI → SWINUB, ABRA → HOUNDOUR); their team and the CHAMPION’s carry its evolution line',
      ]],
    ],
  },
  {
    v: 'v0.3.0',

    title: 'JOHTO',
    sections: [
      ['JOHTO', [
        'Added JOHTO (HEARTGOLD) as a third region. Its acts: NEW BARK → AZALEA (FALKNER or BUGSY), GOLDENROD → ECRUTEAK (WHITNEY or MORTY), CIANWOOD → BLACKTHORN (CHUCK, JASMINE, PRYCE or CLAIR) and VICTORY ROAD',
        'JOHTO ELITE FOUR: WILL, KOGA, BRUNO, KAREN and CHAMPION LANCE. Post-game: MT. SILVER, with LUGIA, HO-OH and RED at the summit',
        'JOHTO trainers use their HEARTGOLD teams, moves and portraits; routes use HEARTGOLD wild POKéMON',
        '8 new badges: ZEPHYR (faster POKéMON, +4 damage), HIVE (+8 damage), PLAIN (grows each hand your lead stays in), FOG (reveals face-down cards, foes miss more), STORM (physical cards +30%), MINERAL (15% less damage taken), GLACIER (+1 hand size), RISING (+80% on FULL HOUSE or better). Each JOHTO leader has their own rule',
        'Added legendary beast nodes: RAIKOU (Act 2), ENTEI (Act 3), SUICUNE (Act 4), each with a unique held item',
        'JOHTO acts run morning → day → night (a third each), with time-specific wild POKéMON (HOOTHOOT and GASTLY at night)',
        'Added rival SILVER for JOHTO starters (CHIKORITA, CYNDAQUIL, TOTODILE, SWINUB, HOUNDOUR, LARVITAR...)',
      ]],
      ['EVENTS', [
        'Added JOHTO “?” events: MYSTERY EGG, RUINS OF ALPH, BUG-CATCHING CONTEST, KIMONO GIRLS, SUDOWOODO, the red GYARADOS, the DRAGON’S DEN quiz and more',
        'Added KURT’s Apricorn balls (FAST, LEVEL, LURE, HEAVY, LOVE, MOON, FRIEND), also sold in JOHTO MARTS. FRIEND BALL catches get an extra copy of their best move',
        'Added TEAM ROCKET in JOHTO: SLOWPOKE WELL, GOLDENROD UNDERGROUND and the RADIO TOWER (three executives, no heal between)',
      ]],
      ['UNLOCKS', [
        'JOHTO acts unlock after your 2nd win (in co-op, when the host has them)',
        'RECORDS mark JOHTO acts as J (e.g. K-J-H-J)',
      ]],
    ],
  },
  {
    v: 'v0.2.3',
    sections: [
      ['CHANGES', [
        'Your attack animation now plays after your hand is scored, just before the hit',
        'Trainers now stay on screen through “X wants to battle!” before sending out their first POKéMON',
        'NEW RUN no longer replaces your run in progress until you press BEGIN! (with a warning)',
        'RECORDS show each trainer’s starter',
        'YAWN now puts the foe to sleep at the end of the turn (skipping its next move) and says right away if it fails',
      ]],
      ['FIXES', [
        'Fixed card labels: MIMIC and SKETCH say COPY FOE MOVE, TRANSFORM says COPY 2 MOVES, draw moves say +2 / +1 NEXT TURN',
        'Fixed foes with no attack: ABRA now use CONFUSION, POUND, KINESIS and DISABLE instead of only TELEPORT; other status-only foes (METAPOD, POOCHYENA...) get back a learned attack',
      ]],
    ],
  },
  {
    v: 'v0.2.2',

    sections: [
      ['MOVE ANIMATIONS', [
        'Animations now run at GBA speed (2x with FAST ANIMATIONS; co-op doubles both)',
        'Played cards now line up below the battle instead of covering the animation',
        'When the foe moves first, its move now plays out before your cards are revealed; your animation then plays before your damage counts up',
      ]],
    ],
  },
  {
    v: 'v0.2.1',
    sections: [
      ['FIXES', [
        'Fixed CRT CURVE OFF darkening the screen',
      ]],
    ],
  },
  {
    v: 'v0.2.0',
    title: 'MOVE ANIMATIONS',
    sections: [
      ['MOVE ANIMATIONS', [
        'Added FireRed move animations for your attacks and foes’ moves (EMBER, THUNDERBOLT, SURF, HYPER BEAM and more); moves without one borrow the closest',
        'Each hand shows one animation: the highest-DMG attack card (leftmost on a tie, or the leftmost card if all status)',
        'Animations run slightly faster than the GBA (2x with FAST ANIMATIONS)',
        'Co-op: each player’s hand and each foe’s move animate in turn, at double speed',
      ]],
    ],
  },
  {
    v: 'v0.1.1',
    sections: [
      ['CHANGES', [
        'Added team reordering between ELITE FOUR rooms (click a POKéMON to lead, or use the arrows)',
      ]],
    ],
  },
  {
    v: 'v0.1.0',
    title: 'ONE SPIRE',
    sections: [
      ['ONE SPIRE', [
        'Removed world select: every run climbs one spire (Acts 1-3 end at a GYM LEADER, Act 4 is VICTORY ROAD, then the ELITE FOUR, CHAMPION and post-game)',
        'Each act’s region (KANTO or HOENN) is drawn from the run seed and sets its routes, wild POKéMON, GYM LEADERS, badges, elites, events, legendary and music. Levels follow the act, not the region',
        'The ELITE FOUR, CHAMPION (BLUE or STEVEN) and post-game (SEVII ISLANDS or SKY PILLAR) come from a region you visited',
        'The act-clear screen now previews the next act’s region and possible GYM LEADERS (hover for their rule), or the ELITE FOUR',
        'One rival per run: MAY for HOENN starters, BLUE otherwise',
        'Runs are now SPIRE runs; RECORDS show each route (e.g. K-H-H-K) and dropped the per-world boards (old runs stay in ALL RUNS and MY RUNS)',
      ]],
      ['UNLOCKS', [
        'HOENN acts unlock after your first CHAMPION win (existing HOENN unlocks carry over)',
        'TREECKO, TORCHIC and MUDKIP are no longer free; you keep them if you had HOENN unlocked',
      ]],
      ['STORIES', [
        'TEAM ROCKET, AQUA and MAGMA now remember how you dealt with each other across regions',
        'The OLD AMBER’s AERODACTYL arrives by courier if Act 3 isn’t in KANTO; STEVEN finds you in any Act 3; WALLY can appear on any VICTORY ROAD',
      ]],
      ['CO-OP', [
        'Co-op wins now unlock ascensions for each player’s starter, and A5+ co-op wins unlock shinies',
        'Removed the lobby’s world choice; HOENN acts appear once the host has won a run',
      ]],
      ['CHANGES', [
        'Added SETTINGS > CRT CURVE to turn off the curved CRT glass',
        'The HOENN ELITE FOUR and CHAMPION STEVEN now use their Ruby/Sapphire moves (they mostly had status moves)',
      ]],
      ['FIXES', [
        'Fixed the evolution background: it now fills the screen instead of a flashing box',
      ]],
    ],
  },
  {
    v: 'v0.0.7',
    sections: [
      ['EVENTS', [
        'Added act-specific “?” events in real locations: the OLD MAN and MT. MOON fossils (Act 1), NUGGET BRIDGE, BILL, the S.S. ANNE and GAME CORNER (Act 2), SILPH CO., the SAFARI ZONE and POKéMON MANSION (Act 3), ELITE FOUR gear (VICTORY ROAD); in HOENN, PETALBURG WOODS, DEVON, RYDEL’s CYCLES, MT. PYRE, the ABANDONED SHIP, WALLY and more; plus post-game events',
        'Event rewards now scale with the act; from Act 4 on, events no longer pay money',
        'Most events are now trade-offs (e.g. a held item for HP, a rare item with a curse); some have several steps',
        'Event battles now wait until about floor 4',
        'Added 6 shrines (at most once per act, about 1 “?” in 4): MOVE DELETER, MOVE TUTOR, COPYCAT, BILL’s or LANETTE’s PC (trades), PROF. OAK or BIRCH (POKéDEX goal reward) and the BERRY TREE',
      ]],
      ['STORIES', [
        'Some choices now pay off later: send the OLD AMBER from PEWTER for an AERODACTYL at the CINNABAR LAB in Act 3; carry the DEVON GOODS and STEVEN finds you in HOENN’s Act 3',
        'TEAM ROCKET, AQUA and MAGMA now recur and remember you (“join” at NUGGET BRIDGE to walk through SILPH CO.); the POKé FLUTE wakes ROUTE 12’s SNORLAX; WALLY remembers your help',
      ]],
      ['CURSES', [
        'Added curses (purple held items) to some rewards: CURSED DOLL (-1 hand size), HEX LETTER (-1 discard, foes +5% damage), LAGGING TAIL (40% slower), ROTTEN SHROOM (-8% HP after each battle), IOU NOTE (prices +25%, battles pay 25% less)',
        'Curses can’t be sold; a POKéMON CENTER CLEANSE removes one for a fee, MR. FUJI (Act 2) or MT. PYRE (HOENN Act 3) for free',
      ]],
      ['CO-OP: UP TO 4 PLAYERS', [
        'Co-op rooms now hold up to 4 players; the host can START with 2, 3 or 4',
        'Foes act more often with more players (twice a turn with 4) and have more HP; wild battles bring one POKéMON per player, two at a time',
        'Map votes: a majority wins early, otherwise the most votes once everyone has voted; ties go to a coin flip',
        'Added a status row per player (lead, HP, locked in); foe intents now show their target',
        'Added CARRY ON to continue without a dropped player (they return via REJOIN)',
        'All events are now in the co-op pool (battle choices hidden)',
      ]],
      ['NUZLOCKE (A8)', [
        'Events no longer give gift or traded POKéMON; event catches count as the act’s one catch',
      ]],
      ['FIXES', [
        'Fixed the gift event never giving EEVEE, LAPRAS or the HITMONs; they now come from BILL, SILPH CO. and the FIGHTING DOJO',
        'Fixed the MOVE TUTOR teaching 120-power moves and EXPLOSION in Act 1; its lessons now scale with the act',
        'Fixed a co-op desync when a hand switched your lead in face-down fights (SABRINA, PHOEBE)',
      ]],
    ],
  },
  {
    v: 'v0.0.6',
    sections: [
      ['LEGENDARY POKéMON', [
        'Added optional legendary nodes (gold glow): ZAPDOS, ARTICUNO and MOLTRES in Acts 2-4 (HOENN: REGIROCK, REGICE, REGISTEEL). Tougher than elites, with PRESSURE (every hand also costs a discard)',
        'Each drops a unique held item: THUNDER FEATHER (+1 hand size), FROST FEATHER (-20% damage taken), FLAME FEATHER (heal 12% after battles), ROCK, ICE and STEEL CORE; each also gives +50% damage to its type',
        'You then get one chance to catch it, at up to your best POKéMON’s level',
      ]],
      ['RIVAL BATTLES', [
        'Added rival battles on a floor every path crosses in Acts 1-3: BLUE (KANTO) or MAY (HOENN), with the starter that beats yours. BLUE is also the CHAMPION',
        'Rival rewards: a guaranteed rarer held item, +50% money and an item',
        'Removed legendaries and rivals from the elite pools',
      ]],
      ['ASCENSION', [
        'A8 is now NUZLOCKE: fainted POKéMON are released, you can only catch each act’s first wild POKéMON, and losing your team ends the run (gifts and the legendary catch exempt; not in co-op)',
        'Moved Inflation (prices +25%, battles pay 20% less) into A4 Shoestring',
        'Ascensions now unlock per starter (a win at An opens A(n+1) for that starter only); co-op rooms use the lowest of the players’ levels',
        'Existing progress carried over: each starter unlocks one level above its highest cleared ascension',
      ]],
      ['STARTERS', [
        'Added 7 starters (PIDGEY, MACHOP, NINCADA, GASTLY, ABRA, SWINUB, HOUNDOUR), covering every type',
        'LARVITAR starts with ROCK THROW instead of SCREECH',
        'Added shinies: win at A5+ to unlock your starter’s shiny form (SHINY button on the starter screen, cosmetic)',
      ]],
      ['NEW', [
        'Added map sketching: right-drag (or PEN) to draw, ERASE to clear; co-op partners see your sketches',
        'Added SETTINGS > CRT (OFF, SUBTLE, STRONG)',
        'Added HQ audio (default): smoother, less crunchy music and cries; SETTINGS > AUDIO QUALITY restores GBA sound',
        'Phones: the game fits in portrait, every menu closes by tap, and you can tap a held item in the shop to sell it',
        'Cards are easier to read: darker text, fitted long names, readable power numbers on light types',
        'Hovering a card shows its copy count, e.g. “PLUCK (3)”',
        'RECORDS lists now show up to 50 entries and scroll (was 10)',
        'Co-op: delete old rooms from REJOIN with X',
      ]],
      ['FIXES', [
        'Fixed the rival battle freezing after BLUE’s intro; missing sounds no longer block battles',
        'Fixed sound stalling the level-up and POKéMON CENTER screens',
        'Fixed a full BAG throwing away found items: use, sell or leave them (the POKé MART won’t charge for items that don’t fit)',
        'Fixed mangled sprites drawn at in-between sizes (BLUE in battle, starters, ELITE FOUR preview, icons)',
        'Fixed the white capsules on the map: the elite and rival “!” now shows properly',
        'Fixed map walking wobbling and the trainer facing the wrong way',
        'Co-op: fixed faint picks, switches, balls and items sometimes doing nothing when your partner acted',
        'Co-op: both players now get the same “?” event',
      ]],
      ['BALANCE', [
        'Foes have about 50% more HP (not in co-op)',
      ]],
    ],
  },
  {
    v: 'v0.0.5',
    sections: [
      ['DISCARD UPDATE', [
        'Move copies now follow PP: attacks get PP/10 + 1 cards (2 to 5), status moves 1 or 2',
        'Added a free discard of up to 2 cards once per turn; battle discards cut to 2 (was 3)',
        'Foes have 40% more HP but hit 10% softer',
        'A move learned over another keeps its PP UP copies',
        'UP-GRADE counts cards above 10 (was 6), SOOT SACK +6% per FIRE card (was +10%), GOOD ROD +24% per discard left (was +16%)',
      ]],
      ['CO-OP (BETA)', [
        'Added CO-OP (beta): create a room from the title screen and share the 5-letter code (sign-in and allowlist required)',
        'Each player brings their own team, items and money; you vote on the map together; battles are 2 vs 2 (click a foe to target, then LOCK IN), in Speed order',
        'TEAM UP: the second hand to hit the same foe in a turn deals +20%. Your items can heal or revive your partner’s POKéMON; if your team faints and your partner wins, your lead returns with 25% HP',
        'UNLOCK takes back your hand until your partner locks in; REJOIN gets you back in after a reload',
        'Co-op runs don’t count for records yet; each act cleared together unlocks a starter',
        'Fixed co-op lead placement and blurry partner cards; co-op bosses have more HP',
      ]],
      ['STARTER UNLOCKS', [
        'Reset starter unlocks to BULBASAUR, CHARMANDER and SQUIRTLE (TREECKO, TORCHIC and MUDKIP stay open in HOENN); other progress kept',
        'Each act clear now lets you pick 1 of up to 3 random locked starters (each player in co-op); unlocked starters can join co-op runs',
      ]],
      ['FIXES', [
        'Wild POKéMON no longer repeat within a run (evolutions can)',
        'MIMIC and SKETCH now copy the foe’s next move into your next hand as a one-use card (TRANSFORM copies 2); draw cards now add cards next turn',
        'Fixed the ACRO BIKE free discard being unlimited (now once per turn)',
        'The POKé MART list now scrolls',
      ]],
    ],
  },
  {
    v: 'v0.0.4',
    sections: [
      ['DAMAGE UPDATE', [
        'Replaced chips and mult with real POKéMON damage (level, move power, ATK vs DEF or SP. ATK vs SP. DEF, STAB, type matchup)',
        'Cards show their damage against the current foe; the left panel totals your hand',
        'Combos now boost damage: PAIR +25%, TRIPLE +60%, FULL HOUSE +80%, QUAD +100%, COVERAGE +125%, PENTA +150% (vitamins raise them)',
        'Foes now have POKéMON-scale HP',
        'Held items and badges now add % or flat damage (CHARCOAL: FIRE cards +60%), and bonuses add instead of multiplying. MACH BIKE: 15% faster (was +2 Speed)',
        'Rebalanced; CHARMANDER starts with METAL CLAW instead of SCRATCH',
        'Updated HOW TO PLAY',
      ]],
    ],
  },
  {
    v: 'v0.0.3',
    sections: [
      ['CHANGES', [
        'Physical / special is now set per move, not by type (54 moves changed, e.g. SHADOW BALL special, CRUNCH physical)',
        'Added 63 Gen 4 moves (SHADOW CLAW, the FANGS, X-SCISSOR, AURA SPHERE, STONE EDGE...), learned by 377 POKéMON as in Gen 4; enemy damage retuned',
        'Enemy intent flashes KO! when it could knock out your lead',
        'COVERAGE now beats QUAD',
        'Enemies have more HP and hit harder',
      ]],
      ['FIXES', [
        'Fixed the enemy attack and faint animation being skipped when your lead was knocked out',
      ]],
    ],
  },
  {
    v: 'v0.0.2',
    sections: [
      ['NEW', [
        'Each POKéMON has its own deck: your hand is your lead’s cards (hand size 5)',
        'Cards and foe intents show type effectiveness and P/S fit',
        'Added a HINT button, suggested hands early on, card dragging and keys (1-5 select, A attack, D discard)',
        'You now choose your replacement when your lead faints (free)',
        'Added 24 held items and removed the held item limit',
        'Click a bag item to use or sell it',
        'A2 now hides enemy moves',
        'Mobile: pinch to zoom, two fingers to pan',
        'Added RECORDS > INVITE one-time links (admins only)',
      ]],
      ['CHANGES', [
        'Halved held item drops: elites 70%, gym leaders 50%, item balls 40%; Marts stock one and sell at most two per visit',
        'Combos: NORMAL ranks like any type, COVERAGE = 4 different types; removed TEAM ATTACK and ECHO',
        'Evolution: trade evolutions at Lv37 (Lv40 for held-item trades), EEVEE uses SUN/MOON STONE for ESPEON/UMBREON, NINCADA leaves a SHEDINJA, late evolutions by Lv48',
        'RARE CANDY gives 3 levels (was 1)',
        'Renamed combo upgrades (PAIR UP, TRIPLE UP...); rewrote move and ability text',
        'Clearing an act fully heals (A0-A4); quieter default volume; rebalanced',
      ]],
      ['FIXES', [
        'TMs are back in Marts; no duplicate shop or reward offers',
        'Moves that can’t affect the foe (ELECTRIC vs GROUND, WATER vs WATER ABSORB) now deal no damage and show NO EFFECT',
        'Fixed enemy drain/recoil, MAGIC COAT, SUBSTITUTE and FOCUS ENERGY',
        'PROTECT / DETECT / ENDURE now get likelier to fail when repeated (Gen 3)',
        'Low-HP alarm only plays in battle; status badges no longer cover HP; deck view, BIKER sprite and other display fixes',
        'Removed the rewards screen after the final battle; fainting before your hand resolves is now shown',
      ]],
    ],
  },
  { v: 'v0.0.1', sections: [['', ['The first playable build.']]] },
];
