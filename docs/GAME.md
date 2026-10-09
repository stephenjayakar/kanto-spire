# Kanto Spire: game reference

Kanto Spire is a browser roguelike deckbuilder: Pokémon FireRed (its sprites, music, trainers, Pokémon, moves and wild encounters) played like Slay the Spire, with Balatro-style "poker hand" combos. This page lists how a run is built (One Spire), the ascension levels, the "?" events and every starter's opening deck. Every number on it comes from the game code. For the full design see [DESIGN.md](DESIGN.md); for setup and hosting see [README.md](README.md).

## A run in one paragraph

Pick a starter (it begins at Lv 6) and an ascension level, then climb a branching map act by act. Every run has the same shape: Acts 1, 2 and 3 (15 floors each, each ending at a Gym Leader), then Act 4, Victory Road (7 floors) → the Elite Four → the Champion. After the Hall of Fame you can retire or carry on into the post-game. **Each act draws its region from the run seed** (see One Spire below): Kanto at first, and Hoenn acts join once you have won a run. Map nodes are tall grass (wild battles, catch with Poké Balls), trainers, elites, a rival floor that every path crosses, an optional legendary, Pokémon Centers, Poké Marts, ? events and item balls. In battle every Pokémon has its own deck of move cards, and your hand of 5 comes from your lead's deck. Play up to 5 cards a turn. Attack cards of the same or different types form combos (PAIR, TRIPLE, COVERAGE…) that add a damage bonus, and status cards always take effect. You also get 2 discards per battle, plus a free discard of up to 2 cards once per turn. HP carries over between battles. When your whole team faints, the run is over.

## EXP (v0.3.2)

- **Who gets EXP.** After a won battle, every Pokémon that led during it gets the full EXP of the defeated foes and the rest of the team gets half (the EXP SHARE held item: full for everyone; LUCKY EGG: +25%). A2 and up: ×0.9.
- **Fainted Pokémon get nothing.** A Pokémon that is fainted when the battle ends gets no EXP, no level-ups, no new moves and no evolution from that battle, as in Gen 3. In co-op this includes the downed player's lead that comes back with 25% HP when the partner wins.
- **Scaled EXP (Gen 5 style).** Each Pokémon's share of each defeated foe's EXP is multiplied by ((2 × foe level + 10) / (foe level + its level + 10))^2.5. At the foe's level that is ×1; a Pokémon above the foe's level earns less (Lv 30 vs a Lv 20 foe: ×0.63) and one below earns more (Lv 10 vs Lv 20: ×1.75). In fights with several foes each foe is counted at its own level. The victory screen shows the change next to each Pokémon's EXP ("-37% overleveled" / "+75% underleveled"). Spreading battles across your team levels it faster than feeding one carry.
- **Level cap (A5+).** From A5 on, battle EXP stops at each act's level cap and the rest is lost (see A5 in the table below).
- **Co-op** uses the same rules on top of its EXP multipliers (see Ascension in co-op); at A5+ each player's own team is capped.

## One Spire (v0.1.0)

There is no world select any more. Before v0.1.0 a run was either the Kanto world or the Hoenn world (open after a first win); now every run climbs one spire and each act slot draws its region.

- **The draw.** At the start of a run each of Acts 1-4 draws a region (Kanto or Hoenn) from the run seed, so the same seed gives the same regions. The Elite Four + Champion ("summit", fought at the top of Act 4) and the post-game are each drawn from the regions the run visited in Acts 1-4. With 2 regions there are 16 act sequences (×2 summits ×2 post-games).
- **Unlocks.** Until your first win (becoming Champion) every act is in Kanto, and a run plays exactly like the old Kanto world. After a win, Hoenn acts join the draw. Players who already had Hoenn access before v0.1.0 get Hoenn acts straight away.
- **What the region decides:** that act's areas and wild Pokémon, its Gym Leader pool (and so which badges you can earn), its elites, its "?" events, its optional legendary (Kanto: Zapdos / Articuno / Moltres; Hoenn: Regirock / Regice / Registeel), terrain, music and map look. The summit region decides the Elite Four and the Champion (Kanto: Lorelei, Bruno, Agatha, Lance, Champion BLUE; Hoenn: Sidney, Phoebe, Glacia, Drake, Champion STEVEN). The post-game is the Sevii Islands (Kanto) or the Sky Pillar (Hoenn).
- **Levels follow the act, not the region.** Every act plays at the Kanto levels of its slot: wild/trainer levels 3-12 / 14-25 / 26-37 / 37-42, Gym Leaders Lv 15 / 27 / 41, Elite Four 44-47 and the Champion 49 (before ascension bonuses). Hoenn acts keep their own HP and damage scaling (tuned so each Hoenn act is about as hard as the Kanto act of the same slot).
- **One rival per run.** MAY if your starter is a Hoenn Pokémon (TREECKO, TORCHIC, MUDKIP, NINCADA, BELDUM: national dex 252-386), BLUE for every other starter. They block a floor in Acts 1-3 whatever the act's region, counter your starter and grow every act. If the counter's line is already on their team (BLUE's ABRA against MACHOP), that slot gets their old starter instead, so a team never has two of the same line. The Champion comes from the summit: a Kanto summit's Champion is BLUE (countering your starter), even in a MAY run.
- **The act-clear screen shows what's next:** the next act's region and its possible Gym Leaders (portraits; hover one for its rule), or the summit's Elite Four before Act 4.
- **Records.** New runs are recorded as world SPIRE with their act regions, e.g. K-H-H-K. The HOENN leaderboard tab is retired; old Kanto and Hoenn runs keep their labels under ALL RUNS and MY RUNS (and the KANTO tab keeps its old board).
- **Runs in progress** from before v0.1.0 finish in their old world (Kanto or Hoenn), and so do co-op rooms that were already playing.
- **Co-op.** The lobby has no world choice. The room's region draw comes from the shared seed (both players see the same acts); Hoenn acts are in it if the host has won a run. The rival counters player 1's starter.

## Ascensions

You pick an ascension level (A0 to A10) for each run on the starter screen. **Levels stack**: A5 means A1 + A2 + A3 + A4 + A5 (the picker shows this as "Level Cap + A1-A4"). The leaderboard score of a run is multiplied by (1 + 0.15 × ascension).

In the table, "Act 2 on" means Act 2, 3, 4 and the post-game. "Map foes" means wild Pokémon, trainers, elites, the rival and legendary birds, whose levels follow the floor. Gym Leaders and the Elite Four have their own levels.

| Level | Name | What changes (exact rules) |
|---|---|---|
| A0 | Standard | The base game. You start with $1000, 5 POKé BALLS and 2 POTIONS. After every battle your conscious Pokémon heal 5% of max HP. A Pokémon Center restores conscious Pokémon to full HP and revives fainted ones at 50%. Clearing an act fully heals and revives the team. Between Elite Four rooms conscious Pokémon heal +50%. |
| A1 | Elite Patrol | More elite nodes: their weight in map generation goes from 10 to 14 (the others are wild 24, trainer 25, event 18, center 10, mart 9). Elites have +10% HP, and so do legendary Pokémon (legendary bird nodes, legendary elites and the post-game legendary bosses). |
| A2 | Fog of War | Enemy intent is hidden: you see neither its next move nor its predicted damage, and the move list in its tooltip reads "???". The "FIRST!" warning still shows. Map foes are +1 level. All EXP you earn is ×0.9. |
| A3 | Gym Prep | Gym Leaders are +1 level in Act 1 and +2 levels from Act 2 on, with +10% HP. The Elite Four and the Champion are +2 levels (their HP does not change, see notes). Legendary bosses get the level bonus too. |
| A4 | Shoestring | Start with $400 (instead of $1000), 3 POKé BALLS (instead of 5) and no POTIONS. Shop prices are +25% (added to any item price modifier, then multiplied by the per-act price increase). Money from battles is ×0.8, rounded down. |
| A5 | Level Cap | (v0.3.2, replaced Weary.) Each act caps your Pokémon's level at its boss's top level +2: the Gym Leader's ace, the Champion's ace in the Elite Four act, the post-game boss's. With the A3 (and A10) level bonuses that is Lv 18 / 31 / 45 / 53 and 74 in the post-game (A10: 18 / 32 / 46 / 54 / 75), whatever the act's region. A Pokémon at the cap earns no battle EXP: its share is lost. Rare Candy, the Pokémon Center's TRAIN and other direct level-ups can still go past the cap. The map bar shows the cap ("Lv cap 18"), and the victory screen shows "CAPPED, +X EXP to …". Healing is the same as at A0-A4. |
| A6 | Reinforcements | Starting from floor 9 of Act 1, and on every floor from Act 2 on, trainer and elite teams with fewer than 6 Pokémon get one extra wild Pokémon from the act's areas. It leads their team, is 1 level below their strongest Pokémon and gives no EXP. Rivals, Gym Leaders and the Elite Four don't get one. |
| A7 | Bulky Foes | Enemies have +15% HP (except the Elite Four and Champion, see notes). |
| A8 | Nuzlocke | A Pokémon that faints in battle is released when that battle ends (its cards leave the deck at once). You can only throw balls in the first wild battle of each act. That is the first tall-grass node you enter: if you don't catch it, there is no second chance that act. Solo only (no effect in co-op). |
| A9 | Ruthless Elites | From Act 2 on, elite battles have a boss rule. Team Rocket elites get DIRTY TRICKS. Other trainer elites get one at random from DIRTY TRICKS, SMELL YA LATER, ROCK SOLID and WHIRLPOOL. Legendary elites get PRESSURE. |
| A10 | Champion's Path | From Act 2 on your Pokémon take +15% damage (added to item modifiers, so e.g. the SOUL BADGE's -15% cancels it). Map foes, Gym Leaders and legendary bosses are +1 more level. The Elite Four and Champion are +1 level. |

### Boss rules used by A9

| Rule | Effect |
|---|---|
| DIRTY TRICKS | After each hand, 2 random cards in your hand are discarded. |
| SMELL YA LATER | Your first hand each battle deals half damage. |
| ROCK SOLID | Hands with fewer than 3 scoring cards deal half damage. |
| WHIRLPOOL | After each hand, 1 random card in your hand is washed away. |
| PRESSURE | Every hand you play also costs you 1 discard. |

The rival always uses SMELL YA LATER and legendary bird nodes always use PRESSURE, at every ascension, so A9 changes nothing for them.

### Notes on the rules

- **Elite Four and Champion HP.** The in-game text for A3 says the Elite Four get "+10% HP", and A7 says enemies get +15% HP. The gauntlet's HP formula divides out the ascension HP factors, so for the Elite Four and the Champion, A3 only adds +2 levels and A7 adds nothing.
- **Act 1 Gym Leaders at A3** are +1 level, not +2 (the in-game text says 2).
- **A1's +10% HP** applies to elites and legendaries, not to the rival floor.
- **A2's +1 level** applies to map foes only. Gym Leaders and the Elite Four are raised by A3 and A10.
- **Pokémon Center.** The HEAL button says "Full HP & status", but fainted Pokémon come back at 50%, not full.
- **Secondary-effect chances** (burn, flinch…) in the starter tables below are base chances. Some held items raise your chances.

### Unlocking ascensions (per starter)

- Every starter has its own ascension track. A0 is always open.
- **Win at An with a starter and A(n+1) opens for that starter only.** The starter grid shows each starter's highest unlocked level in its corner. The picker opens at the level you last played with that starter.
- A "win" is reaching the Hall of Fame by beating the Champion (whichever region the summit is in). The unlock is granted as soon as the Hall of Fame screen appears. So **retiring as Champion or continuing into the post-game both count**, and losing later in the post-game doesn't take it back. Clearing the post-game also counts as a win.
- A10 is the top. Winning at A10 opens nothing new.
- Solo and co-op wins both unlock ascensions: a co-op win at An opens A(n+1) for each player's own starter.

### Shiny starters (A5+)

- Win a run (solo or co-op) at **A5 or higher** to unlock the shiny form of that starter's evolution family (e.g. CHARMANDER → CHARMELEON → CHARIZARD). A SHINY: ON/OFF toggle then appears for it on the starter screen. It is cosmetic only.
- Apart from that, any starter has a 1/64 chance to be shiny at the start of any run.
- In co-op, each player unlocks the shiny of their own starter.

### Ascension in co-op

- The host picks the room's ascension. It can go **up to the highest unlock any player in the room has for the starter they picked**. If a player switches starters and that lowers the room's best unlock below its ascension, the ascension drops to fit, and the run can't start above the cap. (A player whose client doesn't report an unlock doesn't count.)
- Every ascension rule applies to both players' runs, **except Nuzlocke (A8), which has no effect in co-op**. Instead, a downed player's lead comes back with 25% HP when the partner wins the battle.
- Co-op has its own tuning on top of the ascension rules. Wild and trainer fights are 2-vs-2. For example, elites and the rival get ×2.35 HP, Gym Leaders ×3.65 and the Elite Four ×4.35 (Hoenn acts are a little lower), all of it ×1.12. EXP is ×0.45 from wild and trainer fights and ×0.75 from the rest. TEAM UP: the second hand to hit the same foe in a turn deals +20% damage.
- Co-op act clears do give starter-unlock choices, and co-op wins unlock ascensions and, at A5+, shinies (each player's own starter).
- **Co-op legendary node** (from v0.3.11): two legendaries at once, one per slot: the act's own and the next one of its trio (Zapdos → Articuno → Moltres → Zapdos, Regirock → Regice → Registeel, Raikou → Entei → Suicune). Each has ×1.1 HP (×1.12) and ×0.65 damage, instead of one legendary with ×2.4 HP and ×1.3 damage, so the pair is about as hard as the old single fight; EXP is ×0.4 per foe. Winning gives the act legendary's held item, and each player may catch **one** of the two (a legendary they already caught isn't offered). With 3-4 players it is still two legendaries, scaled like every co-op fight (HP ×n/2, each acts n/2 times a turn).

## "?" events (v0.0.7)

- **What a "?" holds.** First, a story payoff that is due (see below). Otherwise a shrine 25% of the time and an event from the act's own pool 75% of the time (if every act event has been seen, a shrine). Act events happen once per run; each shrine at most once per act (it can come back in a later act). The pick is fixed per node: reloading shows the same event.
- **Per-act pools, per region.** A "?" draws from the pool of the act's region at that act slot. Kanto: 8 events in Act 1 (Route 1 → Mt. Moon), 9 in Act 2, 10 in Act 3, 5 in Act 4 (Victory Road) and 7 in the Sevii post-game. Hoenn: 6, 7, 7, 5 and 5. There are no events between Elite Four rooms.
- **Shrines (any act, any region).** MOVE DELETER: forget 1 card free, or 2 (3 from Act 3) for 15% of every Pokémon's HP. MOVE TUTOR: learn 1 of 3 moves free, capped at 80 power in Act 1 and 100 in Act 2 (EXPLOSION and the 150-power moves from Act 3); or a premium lesson (base $600 × the act's price multiplier) with 4 choices and +1 copy. COPYCAT: +1 copy of a card, or of two cards for 20% HP. BILL'S PC (Lanette in Hoenn acts): a wonder trade for a species with ~30/40/50 more base stats (Act 1/2/3+) at your Pokémon's level +1, or a posted trade (Mr. Mime; Farfetch'd + STICK; Lickitung + LEFTOVERS; Hoenn: Seedot, Plusle, Corsola + SHELL BELL). PROF. OAK / BIRCH (Hoenn acts): with at least 10/20/32/40/55 species seen (Act 1 to post-game), 1 of 2 of EXP SHARE, TOWN MAP, TM CASE (+ OAK'S PARCEL in Act 1), else Poké/Great/Ultra Balls; or release a Pokémon for 2 RARE CANDY (Acts 1-2) or a vitamin of your choice. BERRY TREE: 2 berries (better ones from Act 3) or heal 30/35/40%.
- **Scaling.** Money costs use the shop price (act multiplier ×1.0/1.3/1.6/1.9/2.2, +25% at A4, +25% with the IOU NOTE). Money rewards use the act multiplier only, and **events pay no money from Act 4 on** (Act 4, the Elite Four act, the post-game), including battles started by events. HP costs are a % of each Pokémon's max HP and never take one below 1 HP. Battles in events wait until floor 4 in Acts 1-3 (Cycling Road's bikers: floor 2, the Route 120 Kecleon: floor 3); in Act 4 they need floor 1, and the post-game has no gate.
- **Stories across acts** (saved with the run, and they cross regions): the OLD AMBER sent from the Pewter Museum (Kanto Act 1) makes the Cinnabar Lab the first "?" of Act 3 if Act 3 is in Kanto, with a free Aerodactyl (HELIX/DOME FOSSIL and OLD AMBER held items can be revived there too); if Act 3 is in Hoenn, a CINNABAR LAB COURIER brings the Aerodactyl to its first "?" instead (under Nuzlocke: the OLD AMBER back). Delivering the DEVON GOODS (Hoenn Act 1) brings STEVEN to the first "?" of Act 3, in either region. The villains follow you: Team Rocket in Kanto acts (Mt. Moon → Nugget Bridge → Silph Co. → the Route 23 black market) and Team Aqua/Magma in Hoenn acts (Petalburg Woods → Meteor Falls → Weather Institute / Mt. Pyre → the Ever Grande market) remember fights and "joining" across both factions: "join" Rocket at Nugget Bridge or buy Magma's meteorite back, and Silph Co. lets you in without the HP loss and both black markets give 25% off; beat the Mt. Moon or Petalburg Woods grunt and the next faction has heard of you. Mr. Fuji's POKé FLUTE (Kanto Act 2) wakes the Snorlax of a Kanto Act 3. Wally (helped in Hoenn Act 1) can challenge or thank you in Act 4, in either region. A story you've started is 2-3× more likely to continue.
- **Curses.** Five bad held items some events give with their reward: CURSED DOLL (-1 hand size), HEX LETTER (-1 discard, foes deal +5% damage), LAGGING TAIL (your Pokémon are 40% slower), ROTTEN SHROOM (-8% HP after every battle), IOU NOTE (prices +25%, battles pay 25% less). They never appear in shops or rewards and can't be sold. Remove one at a Pokémon Center with CLEANSE (base $800 × price multiplier; the Center can still be used), or all of them at Mr. Fuji (a Kanto Act 2) or Mt. Pyre (a Hoenn Act 3).
- **Nuzlocke (A8).** Events offer no gift or traded Pokémon (those choices are hidden, or replaced by a non-Pokémon reward). A catch at an event (Safari Zone, fishing, Clefairy, Snorlax, a wild battle in an event) is the act's one catch: it is only possible if you haven't met the act's first wild Pokémon yet, and it uses that up.
- **Co-op.** Both players get the same event (picked from shared inputs: the room seed, act and node, the events either player has seen, the smaller party and held-item count, both players' story flags). Choices that start a battle are hidden in co-op; an event with nothing else to offer is left out of the co-op pool. Each player's choices and results are their own.

## Starters

There are 21 starters: every Gen 3 type is the primary or secondary type of at least one of them.

**Unlocking.** BULBASAUR, CHARMANDER and SQUIRTLE are open from the start. Every act you clear (beating a Gym Leader, the Champion, or the post-game) offers a choice: unlock **1 of up to 3 random locked starters**. This works in solo and in co-op, but each act counts only once. Since v0.1.0, TREECKO, TORCHIC and MUDKIP are normal unlocks like the rest (they used to be always open in the Hoenn world): players who had Hoenn access before v0.1.0 kept them.

**Starting deck.** Your starter begins at Lv 6 with its four moves. The number of copies of each card comes from the move's PP:

- Attack moves: PP ÷ 10, rounded up, + 1, kept between 2 and 5 (TACKLE 35 PP → 5, EMBER 25 PP → 4).
- Status moves: PP ÷ 20, rounded up, kept between 1 and 2 (GROWL 40 PP → 2, LEECH SEED 10 PP → 1).
- **Starter bonus:** the starter's attack moves get +1 copy each (so TACKLE starts with 6 and EMBER with 5). This applies only to the moves it starts with. Moves learned later use the normal rule.
- **Starting held items:** PIKACHU starts every run holding a LIGHT BALL (its cards deal double damage) and MACHOP a MACHO BRACE (physical cards deal +40% damage), in solo and co-op, at every ascension. The starter screen shows it as "Starts with:".

**Physical or special** is decided per move with the modern (Gen 4+) split, not by type as in FireRed. Moves outside that list fall back to their type: FIRE, WATER, GRASS, ELECTRIC, PSYCHIC, ICE, DRAGON and DARK moves are special, all other types are physical. A card's damage uses ATK or SPA to match.

**Rival.** One rival per run: MAY if your starter is a Hoenn Pokémon (national dex 252-386), else BLUE (see One Spire). Your rival picks the starter that beats yours. BLUE takes CHARMANDER if you picked BULBASAUR, SQUIRTLE against CHARMANDER, and BULBASAUR against SQUIRTLE. MAY takes TORCHIC against TREECKO, MUDKIP against TORCHIC, and TREECKO against MUDKIP. For any other starter the rival takes whichever of the three has the best type matchup against yours (its best attack type against you, minus your best against it). In co-op the rival counters player 1's starter.

In the tables, "Acc -" means the move never misses (self-targeting moves). "Cards" is the number of copies in the starting deck. For status moves, the bold text is what the card shows.

### Overview (in starter-grid order)

The starter grid has 7 per row in this order. "Rival" gives BLUE's pick (your rival with a non-Hoenn starter, and the Kanto Champion for everyone) and MAY's pick (your rival with a Hoenn starter).

| # | Starter | Types | HP | ATK | DEF | SPA | SPD | SPE | Total | Starting moves | Cards | Rival (BLUE / MAY) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | BULBASAUR | GRASS / POISON | 45 | 49 | 49 | 65 | 65 | 45 | 318 | TACKLE, GROWL, LEECH SEED, VINE WHIP | 12 | CHARMANDER / TORCHIC |
| 2 | CHARMANDER | FIRE | 39 | 52 | 43 | 60 | 50 | 65 | 309 | METAL CLAW, GROWL, EMBER, SMOKESCREEN | 14 | SQUIRTLE / MUDKIP |
| 3 | SQUIRTLE | WATER | 44 | 48 | 65 | 50 | 64 | 43 | 314 | TACKLE, TAIL WHIP, BUBBLE, WITHDRAW | 15 | BULBASAUR / TREECKO |
| 4 | PIKACHU | ELECTRIC | 35 | 55 | 30 | 50 | 40 | 90 | 300 | THUNDERSHOCK, CHARGE BEAM, QUICK ATTACK, GROWL | 15 | BULBASAUR / TREECKO |
| 5 | EEVEE | NORMAL | 55 | 55 | 50 | 45 | 65 | 55 | 325 | TACKLE, TAIL WHIP, SAND-ATTACK, QUICK ATTACK | 14 | CHARMANDER / TORCHIC |
| 6 | PIDGEY | NORMAL / FLYING | 40 | 45 | 40 | 35 | 35 | 56 | 251 | TACKLE, GUST, SAND-ATTACK, QUICK ATTACK | 18 | CHARMANDER / TORCHIC |
| 7 | MACHOP | FIGHTING | 70 | 80 | 50 | 35 | 35 | 35 | 305 | KARATE CHOP, LOW KICK, ROCK SMASH, FOCUS ENERGY | 15 | BULBASAUR / TORCHIC |
| 8 | NINCADA | BUG / GROUND | 31 | 45 | 90 | 30 | 30 | 40 | 266 | BUG BITE, LEECH LIFE, SCRATCH, SAND-ATTACK | 15 | SQUIRTLE / MUDKIP |
| 9 | GASTLY | GHOST / POISON | 30 | 35 | 30 | 100 | 35 | 80 | 310 | LICK, SHADOW SNEAK, SMOG, HYPNOSIS | 15 | CHARMANDER / TORCHIC |
| 10 | ABRA | PSYCHIC | 25 | 20 | 15 | 105 | 55 | 90 | 310 | CONFUSION, POUND, KINESIS, DISABLE | 13 | CHARMANDER / TORCHIC |
| 11 | SWINUB | ICE / GROUND | 50 | 50 | 40 | 30 | 30 | 50 | 250 | POWDER SNOW, ICE SHARD, MUD-SLAP, TACKLE | 19 | SQUIRTLE / MUDKIP |
| 12 | HOUNDOUR | DARK / FIRE | 45 | 60 | 30 | 80 | 50 | 65 | 330 | EMBER, BITE, LEER, HOWL | 14 | SQUIRTLE / MUDKIP |
| 13 | CHIKORITA | GRASS | 45 | 49 | 65 | 49 | 65 | 45 | 318 | TACKLE, GROWL, RAZOR LEAF, POISONPOWDER | 15 | BULBASAUR / TORCHIC |
| 14 | CYNDAQUIL | FIRE | 39 | 52 | 43 | 60 | 50 | 65 | 309 | TACKLE, LEER, SMOKESCREEN, EMBER | 14 | SQUIRTLE / MUDKIP |
| 15 | TOTODILE | WATER | 50 | 65 | 64 | 44 | 48 | 43 | 314 | SCRATCH, LEER, RAGE, WATER GUN | 17 | BULBASAUR / TREECKO |
| 16 | TREECKO | GRASS | 40 | 45 | 35 | 65 | 55 | 70 | 310 | POUND, LEER, ABSORB, QUICK ATTACK | 17 | BULBASAUR / TORCHIC |
| 17 | TORCHIC | FIRE | 45 | 60 | 40 | 70 | 50 | 45 | 310 | SCRATCH, GROWL, FOCUS ENERGY, EMBER | 15 | SQUIRTLE / MUDKIP |
| 18 | MUDKIP | WATER | 50 | 70 | 50 | 50 | 50 | 40 | 310 | TACKLE, GROWL, MUD-SLAP, WATER GUN | 16 | BULBASAUR / TREECKO |
| 19 | DRATINI | DRAGON | 41 | 64 | 45 | 50 | 50 | 50 | 300 | WRAP, LEER, THUNDER WAVE, TWISTER | 11 | BULBASAUR / TORCHIC |
| 20 | LARVITAR | ROCK / GROUND | 50 | 64 | 50 | 45 | 50 | 41 | 300 | BITE, ROCK THROW, LEER, SANDSTORM | 12 | SQUIRTLE / MUDKIP |
| 21 | BELDUM | STEEL / PSYCHIC | 40 | 55 | 80 | 35 | 60 | 30 | 300 | TAKE DOWN, TACKLE, IRON DEFENSE, METAL CLAW | 17 | CHARMANDER / TORCHIC |

### Starting decks

#### 1. BULBASAUR

GRASS / POISON · HP 45 · ATK 49 · DEF 49 · SPA 65 · SPD 65 · SPE 45 (total 318) · rival picks CHARMANDER (BLUE), TORCHIC (MAY) · starting deck: 12 cards

| Move | Type | Category | Power | Acc | PP | Cards | What the card does |
|---|---|---|---|---|---|---|---|
| TACKLE | NORMAL | Physical | 35 | 95 | 35 | 6 | Plain hit. |
| GROWL | NORMAL | Status | - | 100 | 40 | 2 | **FOE ATK -1** |
| LEECH SEED | GRASS | Status | - | 90 | 10 | 1 | **LEECH SEED**: Seeds the foe: it loses 1/10 max HP a turn (1/20 for elites, bosses and legendaries); your lead heals 1/8. No effect on GRASS foes. |
| VINE WHIP | GRASS | Physical | 35 | 100 | 10 | 3 | Plain hit. |

#### 2. CHARMANDER

FIRE · HP 39 · ATK 52 · DEF 43 · SPA 60 · SPD 50 · SPE 65 (total 309) · rival picks SQUIRTLE (BLUE), MUDKIP (MAY) · starting deck: 14 cards

| Move | Type | Category | Power | Acc | PP | Cards | What the card does |
|---|---|---|---|---|---|---|---|
| METAL CLAW | STEEL | Physical | 50 | 95 | 35 | 6 | 10% chance: your ATK +1. |
| GROWL | NORMAL | Status | - | 100 | 40 | 2 | **FOE ATK -1** |
| EMBER | FIRE | Special | 40 | 100 | 25 | 5 | 10% chance to burn. |
| SMOKESCREEN | NORMAL | Status | - | 100 | 20 | 1 | **FOE ACC -1** |

#### 3. SQUIRTLE

WATER · HP 44 · ATK 48 · DEF 65 · SPA 50 · SPD 64 · SPE 43 (total 314) · rival picks BULBASAUR (BLUE), TREECKO (MAY) · starting deck: 15 cards

| Move | Type | Category | Power | Acc | PP | Cards | What the card does |
|---|---|---|---|---|---|---|---|
| TACKLE | NORMAL | Physical | 35 | 95 | 35 | 6 | Plain hit. |
| TAIL WHIP | NORMAL | Status | - | 100 | 30 | 2 | **FOE DEF -1** |
| BUBBLE | WATER | Special | 20 | 100 | 30 | 5 | 10% chance: foe SPE -1. |
| WITHDRAW | WATER | Status | - | - | 40 | 2 | **DEF +1** |

#### 4. PIKACHU

ELECTRIC · HP 35 · ATK 55 · DEF 30 · SPA 50 · SPD 40 · SPE 90 (total 300) · rival picks BULBASAUR (BLUE), TREECKO (MAY) · starting deck: 15 cards · starts with a LIGHT BALL

| Move | Type | Category | Power | Acc | PP | Cards | What the card does |
|---|---|---|---|---|---|---|---|
| THUNDERSHOCK | ELECTRIC | Special | 40 | 100 | 30 | 5 | 10% chance to paralyze. |
| CHARGE BEAM | ELECTRIC | Special | 50 | 90 | 10 | 3 | 70% chance: SPA +1. |
| QUICK ATTACK | NORMAL | Physical | 40 | 100 | 30 | 5 | Priority +1: a hand with it acts before a normal-speed foe move. |
| GROWL | NORMAL | Status | - | 100 | 40 | 2 | **FOE ATK -1** |

#### 5. EEVEE

NORMAL · HP 55 · ATK 55 · DEF 50 · SPA 45 · SPD 65 · SPE 55 (total 325) · rival picks CHARMANDER (BLUE), TORCHIC (MAY) · starting deck: 14 cards

| Move | Type | Category | Power | Acc | PP | Cards | What the card does |
|---|---|---|---|---|---|---|---|
| TACKLE | NORMAL | Physical | 35 | 95 | 35 | 6 | Plain hit. |
| TAIL WHIP | NORMAL | Status | - | 100 | 30 | 2 | **FOE DEF -1** |
| SAND-ATTACK | GROUND | Status | - | 100 | 15 | 1 | **FOE ACC -1** |
| QUICK ATTACK | NORMAL | Physical | 40 | 100 | 30 | 5 | Priority +1: a hand with it acts before a normal-speed foe move. |

#### 6. PIDGEY

NORMAL / FLYING · HP 40 · ATK 45 · DEF 40 · SPA 35 · SPD 35 · SPE 56 (total 251) · rival picks CHARMANDER (BLUE), TORCHIC (MAY) · starting deck: 18 cards

| Move | Type | Category | Power | Acc | PP | Cards | What the card does |
|---|---|---|---|---|---|---|---|
| TACKLE | NORMAL | Physical | 35 | 95 | 35 | 6 | Plain hit. |
| GUST | FLYING | Special | 40 | 100 | 35 | 6 | Plain hit. |
| SAND-ATTACK | GROUND | Status | - | 100 | 15 | 1 | **FOE ACC -1** |
| QUICK ATTACK | NORMAL | Physical | 40 | 100 | 30 | 5 | Priority +1: a hand with it acts before a normal-speed foe move. |

#### 7. MACHOP

FIGHTING · HP 70 · ATK 80 · DEF 50 · SPA 35 · SPD 35 · SPE 35 (total 305) · rival picks BULBASAUR (BLUE), TORCHIC (MAY) · starting deck: 15 cards · starts with a MACHO BRACE

| Move | Type | Category | Power | Acc | PP | Cards | What the card does |
|---|---|---|---|---|---|---|---|
| KARATE CHOP | FIGHTING | Physical | 50 | 100 | 25 | 5 | High critical-hit ratio. |
| LOW KICK | FIGHTING | Physical | 1 | 100 | 20 | 4 | Power 20-120 by the foe's weight (listed as 1). |
| ROCK SMASH | FIGHTING | Physical | 20 | 100 | 15 | 4 | 50% chance: foe DEF -1. |
| FOCUS ENERGY | NORMAL | Status | - | - | 30 | 2 | **CRIT UP**: +2 critical-hit stages for your next 2 hands. |

#### 8. NINCADA

BUG / GROUND · HP 31 · ATK 45 · DEF 90 · SPA 30 · SPD 30 · SPE 40 (total 266) · rival picks SQUIRTLE (BLUE), MUDKIP (MAY) · starting deck: 15 cards

| Move | Type | Category | Power | Acc | PP | Cards | What the card does |
|---|---|---|---|---|---|---|---|
| BUG BITE | BUG | Physical | 60 | 100 | 20 | 4 | Plain hit. |
| LEECH LIFE | BUG | Physical | 20 | 100 | 15 | 4 | Heals the user 12% of its max HP. |
| SCRATCH | NORMAL | Physical | 40 | 100 | 35 | 6 | Plain hit. |
| SAND-ATTACK | GROUND | Status | - | 100 | 15 | 1 | **FOE ACC -1** |

#### 9. GASTLY

GHOST / POISON · HP 30 · ATK 35 · DEF 30 · SPA 100 · SPD 35 · SPE 80 (total 310) · rival picks CHARMANDER (BLUE), TORCHIC (MAY) · starting deck: 15 cards

| Move | Type | Category | Power | Acc | PP | Cards | What the card does |
|---|---|---|---|---|---|---|---|
| LICK | GHOST | Physical | 20 | 100 | 30 | 5 | 30% chance to paralyze. |
| SHADOW SNEAK | GHOST | Physical | 40 | 100 | 30 | 5 | Priority +1: a hand with it acts before a normal-speed foe move. |
| SMOG | POISON | Special | 20 | 70 | 20 | 4 | 40% chance to poison. |
| HYPNOSIS | PSYCHIC | Status | - | 60 | 20 | 1 | **SLEEP** |

#### 10. ABRA

PSYCHIC · HP 25 · ATK 20 · DEF 15 · SPA 105 · SPD 55 · SPE 90 (total 310) · rival picks CHARMANDER (BLUE), TORCHIC (MAY) · starting deck: 13 cards

| Move | Type | Category | Power | Acc | PP | Cards | What the card does |
|---|---|---|---|---|---|---|---|
| CONFUSION | PSYCHIC | Special | 50 | 100 | 25 | 5 | 10% chance to confuse. |
| POUND | NORMAL | Physical | 40 | 100 | 35 | 6 | Plain hit. |
| KINESIS | PSYCHIC | Status | - | 80 | 15 | 1 | **FOE ACC -1** |
| DISABLE | NORMAL | Status | - | 55 | 20 | 1 | **DISABLE**: Blocks the foe's next move. |

#### 11. SWINUB

ICE / GROUND · HP 50 · ATK 50 · DEF 40 · SPA 30 · SPD 30 · SPE 50 (total 250) · rival picks SQUIRTLE (BLUE), MUDKIP (MAY) · starting deck: 19 cards

| Move | Type | Category | Power | Acc | PP | Cards | What the card does |
|---|---|---|---|---|---|---|---|
| POWDER SNOW | ICE | Special | 40 | 100 | 25 | 5 | 10% chance to freeze. |
| ICE SHARD | ICE | Physical | 40 | 100 | 30 | 5 | Priority +1: a hand with it acts before a normal-speed foe move. |
| MUD-SLAP | GROUND | Special | 20 | 100 | 10 | 3 | Foe ACC -1. |
| TACKLE | NORMAL | Physical | 35 | 95 | 35 | 6 | Plain hit. |

#### 12. HOUNDOUR

DARK / FIRE · HP 45 · ATK 60 · DEF 30 · SPA 80 · SPD 50 · SPE 65 (total 330) · rival picks SQUIRTLE (BLUE), MUDKIP (MAY) · starting deck: 14 cards

| Move | Type | Category | Power | Acc | PP | Cards | What the card does |
|---|---|---|---|---|---|---|---|
| EMBER | FIRE | Special | 40 | 100 | 25 | 5 | 10% chance to burn. |
| BITE | DARK | Physical | 60 | 100 | 25 | 5 | 30% chance to flinch. |
| LEER | NORMAL | Status | - | 100 | 30 | 2 | **FOE DEF -1** |
| HOWL | NORMAL | Status | - | - | 40 | 2 | **ATK +1** |

#### 13. CHIKORITA

GRASS · HP 45 · ATK 49 · DEF 65 · SPA 49 · SPD 65 · SPE 45 (total 318) · rival picks BULBASAUR (BLUE), TORCHIC (MAY) · starting deck: 15 cards

| Move | Type | Category | Power | Acc | PP | Cards | What the card does |
|---|---|---|---|---|---|---|---|
| TACKLE | NORMAL | Physical | 35 | 95 | 35 | 6 | Plain hit. |
| GROWL | NORMAL | Status | - | 100 | 40 | 2 | **FOE ATK -1** |
| RAZOR LEAF | GRASS | Physical | 55 | 95 | 25 | 5 | High critical-hit ratio. |
| POISONPOWDER | POISON | Status | - | 75 | 35 | 2 | **POISON** |

#### 14. CYNDAQUIL

FIRE · HP 39 · ATK 52 · DEF 43 · SPA 60 · SPD 50 · SPE 65 (total 309) · rival picks SQUIRTLE (BLUE), MUDKIP (MAY) · starting deck: 14 cards

| Move | Type | Category | Power | Acc | PP | Cards | What the card does |
|---|---|---|---|---|---|---|---|
| TACKLE | NORMAL | Physical | 35 | 95 | 35 | 6 | Plain hit. |
| LEER | NORMAL | Status | - | 100 | 30 | 2 | **FOE DEF -1** |
| SMOKESCREEN | NORMAL | Status | - | 100 | 20 | 1 | **FOE ACC -1** |
| EMBER | FIRE | Special | 40 | 100 | 25 | 5 | 10% chance to burn. |

#### 15. TOTODILE

WATER · HP 50 · ATK 65 · DEF 64 · SPA 44 · SPD 48 · SPE 43 (total 314) · rival picks BULBASAUR (BLUE), TREECKO (MAY) · starting deck: 17 cards

| Move | Type | Category | Power | Acc | PP | Cards | What the card does |
|---|---|---|---|---|---|---|---|
| SCRATCH | NORMAL | Physical | 40 | 100 | 35 | 6 | Plain hit. |
| LEER | NORMAL | Status | - | 100 | 30 | 2 | **FOE DEF -1** |
| RAGE | NORMAL | Physical | 20 | 100 | 20 | 4 | +10 power each time you play it in a battle. |
| WATER GUN | WATER | Special | 40 | 100 | 25 | 5 | Plain hit. |

#### 16. TREECKO

GRASS · HP 40 · ATK 45 · DEF 35 · SPA 65 · SPD 55 · SPE 70 (total 310) · rival picks BULBASAUR (BLUE), TORCHIC (MAY) · starting deck: 17 cards

| Move | Type | Category | Power | Acc | PP | Cards | What the card does |
|---|---|---|---|---|---|---|---|
| POUND | NORMAL | Physical | 40 | 100 | 35 | 6 | Plain hit. |
| LEER | NORMAL | Status | - | 100 | 30 | 2 | **FOE DEF -1** |
| ABSORB | GRASS | Special | 20 | 100 | 20 | 4 | Heals the user 12% of its max HP. |
| QUICK ATTACK | NORMAL | Physical | 40 | 100 | 30 | 5 | Priority +1: a hand with it acts before a normal-speed foe move. |

#### 17. TORCHIC

FIRE · HP 45 · ATK 60 · DEF 40 · SPA 70 · SPD 50 · SPE 45 (total 310) · rival picks SQUIRTLE (BLUE), MUDKIP (MAY) · starting deck: 15 cards

| Move | Type | Category | Power | Acc | PP | Cards | What the card does |
|---|---|---|---|---|---|---|---|
| SCRATCH | NORMAL | Physical | 40 | 100 | 35 | 6 | Plain hit. |
| GROWL | NORMAL | Status | - | 100 | 40 | 2 | **FOE ATK -1** |
| FOCUS ENERGY | NORMAL | Status | - | - | 30 | 2 | **CRIT UP**: +2 critical-hit stages for your next 2 hands. |
| EMBER | FIRE | Special | 40 | 100 | 25 | 5 | 10% chance to burn. |

#### 18. MUDKIP

WATER · HP 50 · ATK 70 · DEF 50 · SPA 50 · SPD 50 · SPE 40 (total 310) · rival picks BULBASAUR (BLUE), TREECKO (MAY) · starting deck: 16 cards

| Move | Type | Category | Power | Acc | PP | Cards | What the card does |
|---|---|---|---|---|---|---|---|
| TACKLE | NORMAL | Physical | 35 | 95 | 35 | 6 | Plain hit. |
| GROWL | NORMAL | Status | - | 100 | 40 | 2 | **FOE ATK -1** |
| MUD-SLAP | GROUND | Special | 20 | 100 | 10 | 3 | Foe ACC -1. |
| WATER GUN | WATER | Special | 40 | 100 | 25 | 5 | Plain hit. |

#### 19. DRATINI

DRAGON · HP 41 · ATK 64 · DEF 45 · SPA 50 · SPD 50 · SPE 50 (total 300) · rival picks BULBASAUR (BLUE), TORCHIC (MAY) · starting deck: 11 cards

| Move | Type | Category | Power | Acc | PP | Cards | What the card does |
|---|---|---|---|---|---|---|---|
| WRAP | NORMAL | Physical | 15 | 85 | 20 | 4 | Traps the foe 2-5 turns (1/16 of its max HP per turn). |
| LEER | NORMAL | Status | - | 100 | 30 | 2 | **FOE DEF -1** |
| THUNDER WAVE | ELECTRIC | Status | - | 100 | 20 | 1 | **PARALYZE** |
| TWISTER | DRAGON | Special | 40 | 100 | 20 | 4 | 20% chance to flinch. |

#### 20. LARVITAR

ROCK / GROUND · HP 50 · ATK 64 · DEF 50 · SPA 45 · SPD 50 · SPE 41 (total 300) · rival picks SQUIRTLE (BLUE), MUDKIP (MAY) · starting deck: 12 cards

| Move | Type | Category | Power | Acc | PP | Cards | What the card does |
|---|---|---|---|---|---|---|---|
| BITE | DARK | Physical | 60 | 100 | 25 | 5 | 30% chance to flinch. |
| ROCK THROW | ROCK | Physical | 50 | 90 | 15 | 4 | Plain hit. |
| LEER | NORMAL | Status | - | 100 | 30 | 2 | **FOE DEF -1** |
| SANDSTORM | ROCK | Status | - | - | 10 | 1 | **SANDSTORM**: 5-turn sandstorm: hurts all but ROCK, GROUND and STEEL. |

#### 21. BELDUM

STEEL / PSYCHIC · HP 40 · ATK 55 · DEF 80 · SPA 35 · SPD 60 · SPE 30 (total 300) · rival picks CHARMANDER (BLUE), TORCHIC (MAY) · starting deck: 17 cards

| Move | Type | Category | Power | Acc | PP | Cards | What the card does |
|---|---|---|---|---|---|---|---|
| TAKE DOWN | NORMAL | Physical | 90 | 85 | 20 | 4 | Recoil: the user loses 1/8 of its max HP. |
| TACKLE | NORMAL | Physical | 35 | 95 | 35 | 6 | Plain hit. |
| IRON DEFENSE | STEEL | Status | - | - | 15 | 1 | **DEF +2** |
| METAL CLAW | STEEL | Physical | 50 | 95 | 35 | 6 | 10% chance: your ATK +1. |

## Glossary

- **Lead**: the Pokémon in front. Your hand is drawn from its deck, and enemies attack it. Switching it normally costs a discard.
- **Attack card / status card**: an attack card has power and deals damage. A status card (power 0) never joins a combo but always takes effect when played.
- **Combo**: the best combo inside the attack cards you play adds a damage bonus. Only the cards in the combo deal damage (extra cards, "kickers", deal nothing). A card's type is its rank. Vitamins and shards level combos up.

  | Combo | Needs | Bonus at level 1 | Per extra level |
  |---|---|---|---|
  | SINGLE | Your strongest attack card hits. | +0% | +15% |
  | PAIR | 2 attack cards of the same type. | +25% | +15% |
  | TWO PAIR | 2 cards of one type and 2 of another. | +40% | +15% |
  | TRIPLE | 3 attack cards of the same type. | +60% | +20% |
  | FULL HOUSE | 3 cards of one type + 2 of another. | +80% | +20% |
  | COVERAGE | 4 attack cards, 4 different types. | +125% | +30% |
  | QUAD | 4 attack cards of the same type. | +100% | +25% |
  | PENTA | 5 attack cards of the same type. | +150% | +30% |

- **STAB**: a card whose type matches its Pokémon's type deals ×1.5 damage (the card shows "STAB x1.5").
- **Physical / special**: physical cards use the user's ATK against the foe's DEF, special cards use SPA against SPD. A card's P/S badge is green when it uses the user's higher attacking stat.
- **PP copies**: a move's number of cards follows its real PP (see Starting deck). PP UP adds copies and the Move Deleter removes them. A move learned over an old one keeps the old move's extra (PP UP) copies.
- **Priority**: if any card in the hand you play has priority (QUICK ATTACK, SHADOW SNEAK, ICE SHARD), that hand acts before a foe move with lower priority, whatever the Speed. Otherwise the faster side goes first.
- **Damage preview**: the DMG number for the selected cards runs the real scoring (held items, badges, combo levels, TEAM UP if a partner has already locked onto the same foe) without crits or misses. A confused lead shows the expected damage (×0.75). It can still differ from what happens if the foe moves first, or in co-op if a partner's hand acts first. Co-op never scales your damage: co-op foes have more HP instead, and the foe's tooltip shows the multiplier. (v0.3.7: deck-counting items such as UP-GRADE, SOOT SACK, HELIX FOSSIL and ENERGY POWDER now count the cards being played, so the real hand matches the preview.)
- **REST**: the user recovers all its HP, is cured, then sleeps for 2 turns. If the battle ends before the hand resolves (a faster partner or the foe's own move finishes it), the user still recovers and is cured. Sleep always ends with the battle. A fully paralyzed user does nothing, as in Gen 3.
- **Self-KO moves**: foes use SELF-DESTRUCT and EXPLOSION only as a last resort, at 1/3 HP or less, and bosses, elites and legendaries never do (from v0.3.11; their level-up moves skip them).
- **Status damage on foes**: poison and burn take 1/10 of a foe's max HP a turn; badly poisoned foes lose 1/16, 2/16, 3/16… Bosses, elites and legendaries take 1/20 (badly poisoned: 1/24, then 1/12 every turn). Your Pokémon lose 1/8 (badly poisoned: 1/16, 2/16…). All of it scales with max HP, so it keeps up with late-game and co-op HP.
- **KING'S ROCK**: one 10% flinch roll per hand, if at least one attack card hits (before v0.3.7 it rolled for every card).
- **Move rewards**: offered from the Pokémon's own level-up (up to 5 levels ahead), TM and tutor moves, plus its evolution line's level-up moves. Pokémon with thin pools (MAGIKARP, DITTO, UNOWN, the cocoons…) also draw from a list of moves of their types. Each act caps move power (70 / 90 / 120 / 150). A move already offered to a Pokémon is 4× less likely to come up again for it, per earlier offer.
- **Stat stages**: real Gen 3 multipliers from -6 to +6 (+1 = ×1.5, +2 = ×2, -1 = ×2/3). They belong to the side, not the Pokémon, so they last the whole battle, even through switches.
