
// Game version and patch notes (shown from the title screen). Versions are major.minor.patch: every production
// deploy that changes the game bumps the patch (v0.2.0 -> v0.2.1); the owner calls minor bumps (v0.1.x -> v0.2.0);
// no major bumps yet. Each one gets a new top PATCH_NOTES entry; see AGENTS.md.
export const VERSION = 'v0.3.3';

export const PATCH_NOTES = [
  {
    v: 'v0.3.3',
    sections: [
      ['FIXES', [
        'Co-op: the hint line above your hand no longer runs under the HINT / LOCK IN / DISCARD buttons (it fits beside your partner’s status and shortens when space is tight).',
      ]],
    ],
  },
  {
    v: 'v0.3.2',
    sections: [
      ['EXP AND LEVELS', [
        'EXP now scales with level: POKéMON above the foe’s level earn less, those below earn more, so rotating your team pays off. The victory screen shows each POKéMON’s bonus or cut.',
        'Fainted POKéMON no longer earn EXP, level up or learn moves after a battle (this includes a co-op partner’s lead that gets revived when you win).',
        'A5 is now LEVEL CAP: each act caps your POKéMON’s level at the boss’s top level +2, and extra EXP flows to your lowest-level teammates. RARE CANDY still works past the cap. (WEARY is gone.)',
      ]],
      ['BATTLES', [
        'DIVE, DIG, FLY and BOUNCE: while your POKéMON is underwater, underground or in the air, the foe’s moves miss it, status moves included. Only the Gen 3 exceptions still hit (SURF and WHIRLPOOL vs DIVE, EARTHQUAKE, MAGNITUDE and FISSURE vs DIG, GUST, TWISTER, THUNDER and SKY UPPERCUT vs FLY and BOUNCE). Poison you already had still ticks.',
        'Trainers stay on screen longer in the battle intro before sending out their first POKéMON (tap to skip).',
        'Hover or tap the draw pile (bottom right) to see which moves are left in it, with counts (not the order), and how many cards are in the discard pile.',
        'Co-op: the foe’s POKé BALLS (how many POKéMON they have left) now sit under their HP boxes, visible with 2, 3 or 4 players.',
        'Move animations: background-changing moves like SHADOW BALL and PSYCHIC now fade in and out at the same speed as FireRed.',
      ]],
      ['MAP AND SCREENS', [
        'Hover any node on the map, not just the next ones, to see what it is. ? rooms stay a mystery.',
        'Bosses show the type they prefer (for example Type: ROCK) on the map, the NEXT GYM preview and the ELITE FOUR break screen.',
        'The COMBOS screen has a new TYPE CHART tab: the full Gen 3 type chart, with a tooltip on every cell.',
        'Held items have no limit, and the reward screen now says so. Skipping a held item asks first: Take it or Skip.',
      ]],
      ['STARTERS AND ITEMS', [
        'PIKACHU starts with a LIGHT BALL and CHARGE BEAM.',
        'MACHOP starts with a MACHO BRACE, and BLUE no longer brings two ABRA against it.',
        'EXP SHARE is now a rare held item, and the POKé FLUTE is uncommon.',
      ]],
    ],
  },
  {
    v: 'v0.3.1',
    sections: [
      ['CHANGES', [
        'Your rival’s starter is now ALWAYS super effective against yours. If none of their region’s three starters beats yours, they pick one from any region: MACHOP faces ABRA, PIKACHU and GASTLY face NINCADA, DRATINI faces SWINUB, ABRA faces HOUNDOUR. Their team (and the CHAMPION’s) carries that POKéMON’s evolution line instead.',
      ]],
    ],
  },
  {
    v: 'v0.3.0',

    title: 'JOHTO',
    sections: [
      ['JOHTO JOINS THE SPIRE', [
        'JOHTO (from HEARTGOLD) is the third region of the spire. Any act can now be a JOHTO act: NEW BARK → AZALEA (FALKNER or BUGSY), GOLDENROD → ECRUTEAK (WHITNEY or MORTY), CIANWOOD → BLACKTHORN (CHUCK, JASMINE, PRYCE or CLAIR) and JOHTO’s VICTORY ROAD.',
        'The JOHTO ELITE FOUR are WILL, KOGA, BRUNO and KAREN, with CHAMPION LANCE at the top. JOHTO’s post-game climbs MT. SILVER, where LUGIA and HO-OH wait along the way and a silent trainer named RED waits at the summit.',
        'Every JOHTO trainer fights with their HEARTGOLD team and moves, and the routes use HEARTGOLD’s wild POKéMON.',
        '8 new badges: ZEPHYR (faster POKéMON, +4 damage), HIVE (+8 damage), PLAIN (grows each hand your lead stays in), FOG (reveals face-down cards, foes miss more), STORM (physical cards +30%), MINERAL (15% less damage taken), GLACIER (+1 hand size) and RISING (+80% on FULL HOUSE or better). Each JOHTO leader also brings a rule of their own.',
        'Legendary beasts: RAIKOU (Act 2), ENTEI (Act 3) and SUICUNE (Act 4) are JOHTO’s optional legendary nodes, each with a unique held item.',
      ]],
      ['MORNING, DAY AND NIGHT', [
        'A JOHTO act runs from morning to night: the first third of the act is morning, the middle third day and the last third night. Each time of day has its own wild POKéMON (HOOTHOOT and GASTLY come out at night). The map and battles show the time of day.',
      ]],
      ['SILVER', [
        'If your starter is from JOHTO (CHIKORITA, CYNDAQUIL, TOTODILE, SWINUB, HOUNDOUR, LARVITAR...), your rival is SILVER. Like BLUE and MAY, he takes the starter that beats yours and follows you through every act, whichever region it is.',
      ]],
      ['JOHTO EVENTS', [
        'JOHTO acts have their own “?” events: the MYSTERY EGG, the RUINS OF ALPH, the BUG-CATCHING CONTEST, the KIMONO GIRLS, SUDOWOODO, the red GYARADOS at the LAKE OF RAGE, the DRAGON’S DEN quiz and more.',
        'KURT in AZALEA turns Apricorns into balls: FAST, LEVEL, LURE, HEAVY, LOVE, MOON and FRIEND BALLS make the right catch easier (a FRIEND BALL catch joins with an extra copy of its best move). JOHTO’s POKé MARTS stock them too.',
        'TEAM ROCKET is back in JOHTO: the SLOWPOKE WELL, the GOLDENROD UNDERGROUND, and the RADIO TOWER takeover, three executives in a row with no heal in between. The villain story still follows you from region to region.',
      ]],
      ['UNLOCKS', [
        'JOHTO acts join your spire after your 2nd win. If you have already won twice, they’re in from your next run. In co-op, JOHTO acts show up when the host has them.',
        'RECORDS show JOHTO acts as J in a run’s route, e.g. K-J-H-J.',
      ]],
      ['ART', [
        'The named JOHTO trainers use their HEARTGOLD portraits. POKéMON keep their FIRERED sprites, and the music is FIRERED’s for now.',
      ]],
    ],
  },
  {
    v: 'v0.2.3',
    sections: [
      ['CHANGES', [
        'Your attack animation now plays after your hand is scored: cards, then the combo and DMG count-up, then the animation, then the hit.',
        'Trainers stay on screen for "X wants to battle!" and a moment longer before sending out their first POKéMON.',
        'NEW RUN just opens the starter menu: your run in progress is only replaced when you press BEGIN! (it asks first).',
        'RECORDS show the starter each trainer climbed with.',
        'YAWN: the foe falls asleep at the end of the turn, so it skips its next move. If it can’t fall asleep, YAWN says so right away.',
      ]],
      ['FIXES', [
        'Card labels match what the moves do: MIMIC and SKETCH say COPY FOE MOVE, TRANSFORM says COPY 2 MOVES, and draw moves say +2 NEXT TURN / +1 NEXT TURN.',
        'Foes always have an attack: wild and trainer ABRA now fight with CONFUSION, POUND, KINESIS and DISABLE (the same moves as your ABRA) instead of only TELEPORT. Other foes with only status moves (METAPOD, POOCHYENA...) get back an attack they learned.',
      ]],
    ],
  },
  {
    v: 'v0.2.2',

    sections: [
      ['MOVE ANIMATIONS', [
        'Animations now run at the original GBA speed (twice as fast with FAST ANIMATIONS on). In co-op they run twice as fast as that.',
        'The cards of the hand being played now line up below the battle, so they no longer cover the animation.',
        'When the foe moves first, its move now plays out (animation and damage) before your cards are revealed. Your attack’s animation then plays before your cards count up their damage.',
      ]],
    ],
  },
  {
    v: 'v0.2.1',
    sections: [
      ['FIXES', [
        'CRT CURVE OFF no longer darkens the screen: the flat CRT keeps the same brightness and glow as the curved one.',
      ]],
    ],
  },
  {
    v: 'v0.2.0',
    title: 'MOVE ANIMATIONS',
    sections: [
      ['MOVE ANIMATIONS', [
        'Attacks now play their real FireRed animations: EMBER’s flames, THUNDERBOLT’s bolts, SURF’s wave, HYPER BEAM’s blast and many more, drawn exactly like the original game.',
        'Each hand you play shows one animation: your strongest attack card (the biggest DMG number on the card; the leftmost one if two tie). A hand of only status cards shows the leftmost one.',
        'Foes’ moves animate too.',
        'Most moves you’ll meet have their own FireRed animation. The rest, and the newer moves, borrow the closest-looking one.',
        'Animations run a little faster than on the GBA, and twice as fast with FAST ANIMATIONS on.',
      ]],
      ['CO-OP', [
        'Every player’s hand plays its animation in turn, and so does each foe’s move. Co-op animations run at double speed to keep turns snappy.',
      ]],
    ],
  },
  {
    v: 'v0.1.1',
    sections: [
      ['CHANGES', [
        'Between ELITE FOUR rooms you can reorder your team: click a POKéMON to make it your lead, or use the arrows to move it up or down.',
      ]],
    ],
  },
  {
    v: 'v0.1.0',
    title: 'ONE SPIRE',
    sections: [
      ['ONE SPIRE', [
        'There is no world select any more: every run climbs the same spire. Acts 1, 2 and 3 each end at a GYM LEADER, Act 4 is VICTORY ROAD, then the ELITE FOUR, the CHAMPION and the optional post-game.',
        'Each act draws its region from the run seed: KANTO or HOENN. The region decides that act’s routes and wild POKéMON, its GYM LEADERS (and the badges you can earn), its elites, its “?” events, its legendary and its music. One run might go KANTO, HOENN, HOENN, KANTO; the next one something else entirely.',
        'Levels follow the act, not the region: a HOENN Act 2 is exactly as far into the climb as a KANTO Act 2.',
        'The ELITE FOUR and the CHAMPION come from a region you visited on the way (CHAMPION BLUE or CHAMPION STEVEN), and so does the post-game (the SEVII ISLANDS or the SKY PILLAR).',
      ]],
      ['PLAN AHEAD', [
        'The act-clear screen now shows where you’re going next: the next act’s region and the GYM LEADERS who may be waiting there (hover a portrait to see their rule), or the ELITE FOUR before Act 4. Build your team for it.',
      ]],
      ['UNLOCKS', [
        'Your first runs stay in KANTO. Become CHAMPION once and HOENN acts start showing up in the spire. If you already had HOENN unlocked, they’re in from your next run.',
        'TREECKO, TORCHIC and MUDKIP are no longer free in HOENN (there’s no HOENN world now). If you had HOENN unlocked, you keep all three. Otherwise they’re unlocked like every other starter, one act clear at a time. Your ascension levels, shinies and POKéDEX are unchanged.',
      ]],
      ['ONE RIVAL', [
        'You have one rival for the whole run: MAY if your starter is from HOENN, BLUE otherwise. They still pick the starter that beats yours and get stronger every act, whichever region you’re in.',
      ]],
      ['STORIES ACROSS REGIONS', [
        'The villains follow you. TEAM ROCKET runs the KANTO acts and TEAM AQUA and MAGMA the HOENN ones, and each remembers how you dealt with the others: beat a grunt in one region and the next one has heard of you, “join” one team and the others treat you as one of their own.',
        'Sent the OLD AMBER from PEWTER but Act 3 isn’t in KANTO? A courier from the CINNABAR LAB brings your AERODACTYL anyway. STEVEN finds you in Act 3 wherever you are, and WALLY can turn up on any VICTORY ROAD.',
      ]],
      ['RECORDS', [
        'New runs are SPIRE runs, and the records show each run’s route, e.g. K-H-H-K. There are no per-world boards any more (ALL RUNS, MY RUNS and TRAINERS); your old KANTO and HOENN runs are still there under ALL RUNS and MY RUNS, with their version.',
      ]],
      ['SETTINGS', [
        'CRT CURVE (SETTINGS): turn the CRT look’s curved glass off for a flat screen that keeps the scanlines and glow.',
      ]],
      ['CO-OP', [
        'Co-op wins now count for ascensions: winning at An opens A(n+1) for each player’s own starter, just like a solo win. A co-op win at A5+ also unlocks your starter’s shiny form.',
        'The lobby no longer has a world choice. Everyone in the room climbs the same regions (drawn from the room’s seed), and HOENN acts join once the host has won a run.',
      ]],
      ['BALANCE', [
        'The HOENN ELITE FOUR and CHAMPION STEVEN now fight with their Ruby/Sapphire moves (they mostly had status moves before, which made them far softer than KANTO’s).',
        'A run you had in progress when this update landed finishes as it started, in its old KANTO or HOENN world.',
      ]],
      ['FIXES', [
        'Evolution: the swirling background now fills the screen and fades between frames, instead of a flashing box in the middle.',
      ]],
    ],
  },
  {
    v: 'v0.0.7',
    sections: [
      ['NEW “?” EVENTS', [
        'Every act now has its own events, set in the real places of that act, in both KANTO and HOENN: the OLD MAN’s catching lesson and the MT. MOON fossils in Act 1, NUGGET BRIDGE, BILL’s cottage, the S.S. ANNE and the GAME CORNER in Act 2, SILPH CO., the SAFARI ZONE and the POKéMON MANSION in Act 3, and gear for the ELITE FOUR on VICTORY ROAD. HOENN gets PETALBURG WOODS, DEVON, RYDEL’s CYCLES, MT. PYRE, the ABANDONED SHIP, WALLY and more. The post-game has events of its own too.',
        'Rewards grow with the act: Act 1 events are small trades and investments, Act 3 has the big swings, and Act 4 pays in power for the ELITE FOUR. From Act 4 on, events no longer pay money.',
        'Most events are a real choice now: a held item for some HP, a POKéMON for money, a rare item that comes with a curse...',
        'Battles inside events wait until floor 4 or so, like elites. Some events have several steps (the POWER PLANT’s humming item balls: how far do you push your luck?).',
      ]],
      ['SHRINES', [
        'Six familiar faces can show up in any act, at most once per act (about 1 “?” in 4): the MOVE DELETER (forget 1 card for free, or more for some HP), the MOVE TUTOR (a free move, or a premium lesson), the COPYCAT (+1 copy of a card), BILL’s or LANETTE’s PC (a wonder trade or a posted trade), PROF. OAK or PROF. BIRCH (reach this act’s POKéDEX goal for one of their items) and the BERRY TREE. Their rewards grow with the act.',
      ]],
      ['STORIES ACROSS ACTS', [
        'Some choices come back later. Send the OLD AMBER from PEWTER to be revived and the CINNABAR LAB has an AERODACTYL waiting in Act 3 (fossils you kept can be revived there too). In HOENN, carry the DEVON GOODS and STEVEN finds you in Act 3.',
        'TEAM ROCKET (TEAM AQUA and MAGMA in HOENN) turns up act after act and remembers how you dealt with them: “join” at NUGGET BRIDGE and you can walk through SILPH CO. in uniform. MR. FUJI’s POKé FLUTE can wake the SNORLAX on ROUTE 12, and WALLY remembers who helped him catch his first POKéMON.',
      ]],
      ['CURSES', [
        'Some tempting rewards come with a curse: a bad held item with a purple, pulsing look. CURSED DOLL (-1 hand size), HEX LETTER (-1 discard, foes hit 5% harder), LAGGING TAIL (40% slower), ROTTEN SHROOM (lose 8% HP after every battle) and IOU NOTE (shop prices +25%, battles pay 25% less).',
        'Curses can’t be sold. A POKéMON CENTER can CLEANSE one for a fee (you can still heal or train afterwards), and MR. FUJI in Act 2 or MT. PYRE in HOENN’s Act 3 lifts them for free.',
      ]],
      ['NUZLOCKE AND CO-OP', [
        'NUZLOCKE (A8): events no longer hand out gift or traded POKéMON (those choices are hidden or replaced). Catching one at an event (the SAFARI ZONE, fishing, a SNORLAX…) counts as that act’s one catch. The legendary catches are unchanged.',
        'Co-op: every event is in the co-op pool now. Choices that would start a battle are hidden in co-op, and both players still get the same event.',
      ]],
      ['CO-OP: UP TO 4 PLAYERS', [
        'Co-op rooms now hold up to four players. Send the code to up to three friends; the host can START with 2, 3 or 4 players once everyone has picked a starter.',
        'Still two foes on the field, but each foe acts more often (with 4 players, twice a turn), so everyone faces about one attack per turn. Foes have more HP to match, and wild battles bring one wild POKéMON per player, two at a time.',
        'Map votes: the node with the most votes wins once everyone has voted, or as soon as one node has a majority. Ties are broken by a coin.',
        'In battle, your lead stays big; your partners stand beside it, and a status row per player shows their lead, HP and who has locked in. Each foe’s intent says whom it will hit.',
        'If a player drops out, the others can CARRY ON without them after a short wait. They come back through REJOIN and are in again with their next action.',
        'Everyone sees the same “?” event, rewards stay per player, and each player picks their own new starter after an act clear.',
        'Everyone in the room needs this version (reload the page): a room with a player on an older version stays a 2-player room.',
      ]],
      ['FIXES', [
        'The gift POKéMON event could never give EEVEE, LAPRAS or the HITMONs. They now come from their own events: EEVEE from BILL, LAPRAS from SILPH CO. and HITMONLEE or HITMONCHAN from the FIGHTING DOJO.',
        'The MOVE TUTOR could teach 120-power moves and EXPLOSION in Act 1. Its lessons now grow with the act like move rewards do.',
        'Co-op: in fights where cards are dealt face down (SABRINA, PHOEBE), picking a hand that switches your lead could turn cards face down behind the scenes and put you out of sync with your partners. Fixed.',
      ]],
    ],
  },
  {
    v: 'v0.0.6',
    sections: [
      ['LEGENDARY POKéMON', [
        'Optional legendary nodes (gold glow on the map, off the main paths): ZAPDOS in Act 2, ARTICUNO in Act 3 and MOLTRES in Act 4. In HOENN: REGIROCK, REGICE and REGISTEEL. They are much tougher than an elite and use PRESSURE (every hand also costs a discard), so go in healthy.',
        'Beat one to get its unique held item: THUNDER FEATHER (+1 hand size), FROST FEATHER (take 20% less damage), FLAME FEATHER (heal 12% after every battle), ROCK CORE, ICE CORE and STEEL CORE. Each also gives +50% damage to cards of its type.',
        'Then you get one chance to catch it: it joins at up to your best POKéMON’s level with its own deck. Let it go and it flies away for good. Each one can be caught once per run.',
      ]],
      ['RIVAL BATTLES', [
        'Your rival blocks a floor of the map in Acts 1 to 3 (every path crosses it): BLUE in KANTO, MAY in HOENN. They pick the starter that beats yours, like in FireRed, and their team grows every act. BLUE is also the CHAMPION, and he has something to say first.',
        'Beating your rival pays more than an elite: a guaranteed held item (rarer ones), 50% more money and an item.',
        'The legendary POKéMON and rivals left the elite pools, so elites are a bit more varied.',
      ]],
      ['NUZLOCKE (A8)', [
        'Ascension 8 is now NUZLOCKE: a POKéMON that faints in battle is released for good (you see it happen), and you can only catch the first wild POKéMON of each act. Lose your whole team and the run ends. Gift POKéMON and the legendary catch still work.',
        'Inflation (shop prices +25%, battles pay 20% less) moved into A4 Shoestring. Your unlocked ascension levels are unchanged. Co-op ignores the Nuzlocke rules.',
      ]],
      ['SHINY POKéMON', [
        'Win a run on Ascension 5 or higher to unlock the shiny form of the starter you used (and its evolutions). Turn it on with the SHINY button on the starter screen. Shiny POKéMON sparkle when they enter battle. Just for looks.',
        'Unlocked shinies are saved with the rest of your progress (and synced when you are signed in).',
      ]],
      ['A STARTER OF EVERY TYPE', [
        'Seven new starters: PIDGEY, MACHOP, NINCADA, GASTLY, ABRA, SWINUB and HOUNDOUR, so every type is covered by at least one starter. They unlock like the others: clear an act and pick one.',
        'LARVITAR now starts with ROCK THROW instead of SCREECH. The starter screen shows every starter with its type colours.',
      ]],
      ['ASCENSION PER STARTER', [
        'Ascension levels are now unlocked per starter: a win at An with a POKéMON opens A(n+1) for that starter only, so clearing A1 with BULBASAUR no longer opens A2 for SQUIRTLE. The starter screen shows each starter’s level (the A badge) and remembers the level you last picked with it. In co-op, a room goes up to the lower of what each player has unlocked with the starter they picked.',
        'Your progress carried over from your past clears: each starter is unlocked one level above the highest ascension you cleared with it (a CHAMPION run that went on into the post-game counts). Shinies, unlocked starters and everything else are unchanged.',
      ]],
      ['FIXES', [
        'The RIVAL battle froze after BLUE’s lines (his battle music was missing). Fixed, and a missing sound can no longer stop a battle from starting.',
        'HQ audio (new default): music and cries are mixed in full precision with more voices, smoother resampling and a gentle low-pass, so themes like LANCE’s and the CHAMPION’s no longer sound crunchy. SETTINGS > AUDIO QUALITY switches back to the exact GBA sound.',
        'Phones: the whole game now fits on screen in portrait, every menu can be closed by tapping (a new X on choice popups like the ball picker, tap outside to close Settings/Combos/Deck), and you can tap a held item in the shop to sell it.',
        'A full BAG never throws away a found item any more: you can use the new item right away, use or sell something in your BAG to make room, or leave it (and the POKé MART won’t take your money for an item that doesn’t fit).',
        'Crisper sprites: trainers in battle (BLUE looked mangled), the starters, the ELITE FOUR preview and a few icons were drawn at in-between sizes like 1.5x, which broke up their pixels. They now use whole sizes. The starter screen shows every starter at full size.',
        'The white capsules floating on the map were the “!” over elite and rival trainers, stuck on the squashed first frame of its pop-up animation. They now show a proper “!” right above the trainer.',
        'Cards are easier to read: dark move names (long ones are fitted pixel by pixel instead of squashed), darker damage, effect and label colours, and readable power numbers on light type colours like ELECTRIC and ICE.',
        'Sound can no longer stall the game: a jingle that got cut off, or sound that hadn’t started yet (or a phone tab in the background), could leave the level-up or POKéMON CENTER screen waiting forever.',
        'Co-op: picking who goes out after a faint, switching, throwing a ball or using an item could silently do nothing if your partner acted while that menu was open. Fixed.',
        'Hovering a card now shows how many copies of it are in its POKéMON’s deck, e.g. “PLUCK (3)”.',
        'Map: walking to a node no longer wobbles up and back or jumps sideways at the end, and your trainer now walks facing the way they go.',
        'RECORDS lists now show up to 50 runs or trainers and scroll (mouse wheel, drag/swipe or the arrow keys); they used to stop at 10.',
        'Co-op: both players now get the same event at a “?” node (it used to be rolled separately for each of you). Your choices and their results are still your own.',
        'Co-op: delete old rooms from the REJOIN list with the X on each one (a run in progress: you leave it for good, your partner can keep playing; once you have both deleted it, it is gone).',
        'New: sketch on the map to plan your route, like in Slay the Spire: right-drag to draw (or turn on PEN at the bottom left to draw with a normal drag or tap), and ERASE wipes it. Each act starts with a clean map. In co-op your partner sees your sketches in your colour, and ERASE clears both of yours.',
        'New: SETTINGS > CRT (OFF, SUBTLE, STRONG) for a soft, warm CRT look with scanlines and a gently curved screen. Off by default.',
      ]],
      ['BALANCE', [
        'Foes have about 50% more HP (co-op keeps its own balance). Our test bots used to throw items away when their bag was full, so the game was easier than our numbers said, and the new rival rewards add more power. A0 is meant to be won about 1 run in 5.',
      ]],
    ],
  },
  {
    v: 'v0.0.5',
    sections: [
      ['DISCARD UPDATE', [
        'PP decks: a move’s copies now follow its PP. Attacks get PP/10 + 1 cards (2 to 5: TACKLE 5, EMBER 4, FLAMETHROWER 3, HYDRO PUMP 2), status moves 1 or 2. Decks are bigger than your hand, so hands vary and digging for combos pays.',
        'Free discard: once per turn you can discard up to 2 cards for free (the DISCARD button says FREE DISCARD). You also have 2 discards per battle (was 3) for bigger digs; switching your lead still costs one.',
        'Foes have 40% more HP but hit 10% softer: most take two hands unless you build a big combo, so a bad hand is worth fixing.',
        'A move learned over another keeps the old move’s extra PP UP copies.',
        'UP-GRADE counts cards above 10 (was 6), SOOT SACK +6% per FIRE card (was +10%), GOOD ROD +24% per discard left (was +16%).',
      ]],
      ['CO-OP (BETA)', [
        'CO-OP (beta): play a run with a friend. Title screen > CO-OP, create a room and share the 5-letter code; your friend picks JOIN ROOM and types it (both of you need to be signed in and on the allowlist).',
        'You each bring your own team, decks, items and money, vote together on the map, and every battle is a 2 vs 2 duo battle: click a foe to target it, pick your hand, then LOCK IN. Hands and foe moves go in Speed order.',
        'TEAM UP: the second hand to hit the same foe in a turn deals +20%. You can heal or revive your partner’s POKéMON with your items. If your team faints and your partner wins, your lead comes back with 25% HP.',
        'Co-op uses the same rules as solo (PP decks, free discard, ACRO BIKE, MIMIC copies). Co-op runs don’t count toward records yet, but every act you clear together lets each of you unlock a new starter. REJOIN gets you back into a room after a reload.',
        'UNLOCK: after LOCK IN you can take your hand back (press UNLOCK or Enter again) until your partner locks in too. Your partner sees you choosing again.',
        'Co-op fixes: both leads now stand side by side like a Gen 3 double battle, and your partner’s played cards are sharp instead of blurry. Co-op GYM LEADERS, elites and the ELITE FOUR have more HP again: co-op was easier than solo.',
      ]],
      ['NEW STARTER UNLOCKS', [
        'Starter unlocks were reset: everyone starts with BULBASAUR, CHARMANDER and SQUIRTLE again (TREECKO, TORCHIC and MUDKIP stay open in HOENN). Your ascension levels, HOENN access, Pokédex and records are kept.',
        'How unlocking works now: every act you clear (gym boss, CHAMPION, post-game) lets you pick 1 new starter out of up to 3 random locked ones.',
        'In co-op each player picks their own new starter after every act you clear together, and your unlocked starters can join co-op runs too.',
      ]],
      ['FIXES', [
        'More variety: you never meet the same wild POKéMON twice in a run (its evolutions still can show up), unless an area has nothing new left.',
        'MIMIC and SKETCH copy the move the foe is about to use into your next hand as a one-use card (TRANSFORM copies 2). Draw cards (FOLLOW ME, TRICK, RECYCLE...) now give extra cards next turn instead of being swallowed by the refill.',
        'ACRO BIKE: the free 1-card discard works once per turn (it was unlimited, so you could discard forever).',
        'The POKé MART list scrolls (mouse wheel, arrow keys or drag), so items at the bottom like the MOVE DELETER are no longer cut off.',
      ]],
    ],
  },
  {
    v: 'v0.0.4',
    sections: [
      ['DAMAGE UPDATE', [
        'No more chips and mult. Each card deals real POKéMON damage, worked out like the games: level, move power, ATK vs the foe’s DEF (or SP. ATK vs SP. DEF), STAB and type matchup.',
        'Cards show the damage they deal to the current foe (e.g. "21 DMG"), and the left panel adds up your hand.',
        'Combos boost damage: PAIR +25%, TRIPLE +60%, FULL HOUSE +80%, QUAD +100%, COVERAGE +125%, PENTA +150%. Vitamins raise them.',
        'Enemies have POKéMON-sized HP (a few dozen to a few hundred), on the same scale as your team.',
        'Held items and badges reworked: they add % or flat damage (CHARCOAL: FIRE cards +60%), and all bonuses add up instead of multiplying. MACH BIKE now makes your POKéMON 15% faster (was +2 Speed).',
        'Rebalanced for the new numbers: A0 is still a real challenge. CHARMANDER starts with METAL CLAW instead of SCRATCH.',
        'HOW TO PLAY on the title screen explains the new combat.',
      ]],
    ],
  },
  {
    v: 'v0.0.3',
    sections: [
      ['CHANGES', [
        'Physical / special now follows the modern rule: each move has its own category instead of its type deciding. SHADOW BALL, SLUDGE BOMB, HYPER BEAM and SWIFT are special; FIRE/ICE/THUNDER PUNCH, CRUNCH, BITE, WATERFALL, DRAGON CLAW and LEAF BLADE are physical (54 moves changed).',
        '63 Gen 4 moves join the game: SHADOW CLAW, FIRE/ICE/THUNDER FANG, X-SCISSOR, POISON JAB, DARK PULSE, AURA SPHERE, EARTH POWER, STONE EDGE, BULLET PUNCH, FLARE BLITZ and more. 377 POKéMON learn them as in Diamond/Pearl/Platinum/HeartGold/SoulSilver (level-up, TM and tutor), so they show up as move rewards and in foes’ movesets. Enemy damage retuned to match.',
        'The enemy intent flashes KO! when its attack could knock out your lead.',
        'COVERAGE (4 different types) pays much more: it now beats QUAD.',
        'Harder: enemies have more HP and hit harder. A0 is now a real challenge; plan your team, moves and items for the long run.',
      ]],
      ['FIXES', [
        'When your lead was knocked out, the enemy attack and faint animation were skipped (it looked like an instant faint). They play properly now, and the HP box stays on the fainting POKéMON until its replacement comes out.',
      ]],
    ],
  },
  {
    v: 'v0.0.2',
    sections: [
      ['NEW', [
        'Every POKéMON has its own deck: your hand is your lead’s cards, and switching swaps it. Hand size 5.',
        'Cards show type effectiveness (SUPER / WEAK / NO EFFECT) and P/S (green = fits its stats). The foe’s intent shows it too.',
        'HINT button, plus a suggested hand in your first battles. Drag cards to reorder. Keys: 1-5 select, A attack, D discard.',
        'When your lead faints, choose who goes out next (free).',
        '24 new held items, and no limit on how many you hold.',
        'Click a bag item to use or sell it. Ascension 2 now hides enemy moves.',
        'Mobile: pinch to zoom, and drag with two fingers to pan around.',
        'Invite friends: RECORDS > INVITE makes a one-time link (admins only) that lets whoever signs in with it play.',
      ]],
      ['CHANGES', [
        'About half as many held items: elites 70%, gym leaders 50%, item balls 40%; Marts stock one and sell at most two per visit.',
        'Combos: NORMAL ranks like any type, COVERAGE = 4 different types, TEAM ATTACK and ECHO removed.',
        'Evolution: trade evolutions at Lv37 (Lv40 for held-item trades), EEVEE uses SUN/MOON STONE for ESPEON/UMBREON, NINCADA leaves a SHEDINJA, late evolutions by Lv48.',
        'RARE CANDY now gives 3 levels (was 1).',
        'Combo upgrades renamed (PAIR UP, TRIPLE UP...). Move and ability text rewritten for how they work here.',
        'Clearing an act fully heals (A0-A4). Quieter default volume. Rebalanced around the new item supply.',
      ]],
      ['FIXES', [
        'TMs appear in Marts again. No duplicate offers in shops or rewards.',
        'Hands that can’t affect the foe (ELECTRIC vs GROUND, WATER vs VAPOREON’s WATER ABSORB) deal no damage, and cards now show NO EFFECT when an ability blocks them.',
        'Enemy drain/recoil, MAGIC COAT, SUBSTITUTE and FOCUS ENERGY now work properly.',
        'PROTECT / DETECT / ENDURE follow the Gen 3 rule: back-to-back uses get likelier to fail (100%, 50%, 25%...).',
        'Low-HP alarm only plays in battle. Status badges no longer cover HP. Deck view, BIKER sprite and other display fixes.',
        'No rewards screen after the final battle. Fainting before your hand resolves is clearly shown.',
      ]],
    ],
  },
  { v: 'v0.0.1', sections: [['', ['The first playable build.']]] },
];
