# Kanto Spire: per-act events (design draft)

Status: **built in v0.0.7** (web/src/game/events.js; player-facing rules in GAME.md "? events"). Differences from this draft, following the owner's decisions of 2026-10-04: no Elite Four interludes and no Ancients; card-cost curses became 5 curse held items (CURSED DOLL, HEX LETTER, LAGGING TAIL, ROTTEN SHROOM, IOU NOTE: can't be sold, removed by a Center's paid CLEANSE, Mr. Fuji or Mt. Pyre); NUZLOCKE hides gift/trade Pokémon (or swaps in a non-Pokémon reward) and an event catch is the act's one catch; the Route 12 SNORLAX sits in act 3 (where Route 12 is in this game), which makes the Poké Flute a cross-act story; Hoenn got its own pools and stories (Devon Goods -> Steven, Team Aqua/Magma, Wally); Trainer Tower / Battle Tower are one tougher elite instead of two in a row; the Mansion's third choice gives a curse instead of a Center penalty. The text below is the original draft.
Numbers are for A0 Kanto unless noted. "$650" means the value in that act; the code would compute it as a base price times the act's price multiplier (see the power curve).

---

## 1. Summary

- **Today:** there are 18 events (`web/src/game/events.js`). Only 3 are tied to an act (Mt. Moon fossils in act 1, the Pokémon Tower ghost in act 2, the Hoenn desert fossils in Hoenn act 2). 5 more are "act 2 or later". The other 10 can show up in any act of either world, including the post-game.
  - Costs and rewards are mostly flat: the Magikarp is $500, the Game Corner bet is $1000, the Day Care is $1500. Shop prices meanwhile go from x1.0 to x2.2, and the smart bot walks into act 4 holding about $8,000.
  - So act 1 events are often too generous (a free Bicycle, a free pseudo-legendary egg, a Nugget worth more than three common held items) and act 3+ events are too small to matter.
- **Proposal: StS-style layers.**
  - **Per-act pools** themed on the real FireRed locations of that act:
    - Act 1: 8 events
    - Act 2: 10 events
    - Act 3: 9 events
    - Act 4: 5 events
    - Elite Four: 3 optional between-room interludes
    - Sevii post-game: 7 events
  - **6 shrines** that can show up in any act and scale with it: Move Deleter, Move Tutor, Copycat, Bill's PC, Prof. Oak, Berry Tree.
  - Every number scales through a few helpers (money by the act's price multiplier, levels from `levelFor`, held items by rarity), so one table (section 3) sets the power curve.
- **Shape of each act:**
  - Act 1 has small trades and long-term investments (Magikarp, Oak's Parcel, an Old Amber you can revive later).
  - Act 2 is where team identity forms: gift Pokémon, the Bicycle at a real cost, the first held-item trades.
  - Act 3 has big swings: Lapras, Hitmons, the Safari Zone gamble, Mind Bloom-style Mansion choices, move upgrades and transforms.
  - Act 4 pays in power for the gauntlet (vitamins, rare held items, revives), not in money.
  - Sevii has legendary-tier trades with harsh costs.
- **Deck edits are new** (today only "delete 2 cards" exists):
  - remove (Move Deleter)
  - add (Tutor)
  - duplicate (Copycat: +1 copy, like a PP UP)
  - upgrade (Cinnabar Lab and Mansion: replace a move with a stronger move of the same type and keep its copies)
  - transform (Cinnabar Lab, Tanoby Ruins)
- **Also new:** held-item trades (Nugget Bridge, Mr. Fuji, Seafoam, the Veteran, the Cinnabar fossil revival) and three story threads that run across acts:
  - **Team Rocket arc:** Mt. Moon, then Nugget Bridge, then Silph Co., then the act 4 black market
  - **Old Amber:** Pewter (act 1), paid off at Cinnabar (act 3)
  - **Poké Flute:** Mr. Fuji, which unlocks the Snorlax option
- **Co-op:** events stop being excluded as a whole. Each choice that starts a battle is marked `solo` and hidden in co-op, and most events get a co-op-safe alternative (an HP cost instead of a fight). Today 5 of 18 events are dropped from co-op entirely.

---

## 2. What Slay the Spire 1 and 2 do (research)

### 2.1 Slay the Spire 1
- **Layers.** Each act has its own pool: Exordium, The City, The Beyond. There are also shrines that can appear in any act and reset each act (Purifier, Transmogrifier, Upgrade Shrine, Duplicator, Golden Shrine, Match and Keep, Wheel of Change), plus one-time specials (Bonfire Spirits, Woman in Blue, We Meet Again, Note for Yourself). A ? room is an event most of the time; the chance of an event rises each time a ? turns out to be a fight, shop or chest instead. The commonly quoted figure is that about 25% of events come from the shrine/one-time pool (unverified). Act events happen once per run.
- **The power curve is very visible:**
  - Act 1 trades are small: Big Fish (heal 1/3 / +5 max HP / relic + curse), The Cleric (35 gold heal, 50 gold removal), Golden Wing, Shining Light, Scrap Ooze.
  - Act 2 is where deck identity forms: Vampires (Strikes become Bites for 30% max HP), Augmenter, The Library (1 of 20 cards), N'loth (relic trade), Colosseum, Masked Bandits (all your gold or a fight).
  - Act 3 is big swings: Mind Bloom (fight an act 1 boss for a rare relic / upgrade the whole deck but never heal again / 999 gold + 2 curses), Falling (lose a named card), Mysterious Sphere, Secret Portal, Moai Head.
- **Cost types:** HP (usually a % of max HP), max HP, gold (often "all of it"), curses (each with its own flavor), and losing a card, relic or potion. A15 made specific events about 25-50% harsher.
- **Story threads across acts:** the Golden Idol (act 1) can be cashed in at Forgotten Altar (act 2) or Moai Head (act 3). The Red Mask links Masked Bandits (act 2) to the Tomb of Lord Red Mask (act 3). The Cleric comes back as the Old Beggar. Ranwid is a recurring character.
- **Choice shapes:** safe-and-small vs risky-and-big (Golden Shrine). Press-your-luck loops (Dead Adventurer, Scrap Ooze, Cursed Tome, Knowing Skull). Fixed-odds bets (The Joust). One of three deck edits (Living Wall: remove / transform / upgrade). Pay-for-more-options (Sensory Stone).

### 2.2 Slay the Spire 2 (early access since March 2026; numbers change between patches)
- **Each act has two possible versions**, picked at random per run, and each version has its own event pool. Act 1 is Overgrowth or Underdocks, act 2 is Hive, act 3 is Glory. On top of that there is an **"Any Act" pool of about 18 events**. Roughly 13 + 10 + 10 + 7 act events. ? room odds are the same as StS1.
- **Ancients replace Neow and the boss relics:** an Ancient at the start of every act offers 1 of 3 boons and heals you.
  - Act 1 is always Neow. Act 2 is Orobas, Pael or Tezcatara; act 3 is Nonupeipe, Tanx or Vakuu (Darv can appear in act 2 or 3).
  - Their power follows the act curve: Neow gives 150 gold or one card removal; Nonupeipe gives 888 gold or +31 max HP.
  - Neow uses **"graded twins"**: a free boon next to a stronger version with a drawback, e.g. Precise Scissors (remove 1 card) vs Precarious Shears (remove 2 cards, lose 16 HP).
- **New reward and cost types:**
  - Enchantments (permanent card modifiers; the same one can't stack, because the devs want "deckbuilding rather than cardbuilding")
  - Card merges (Amalgamator)
  - Downgrades (Reflections: downgrade 2, upgrade 4)
  - Statuses in your next fight (Tea Master)
  - **Delayed rewards:** Wongo's delivers 3 relics after 5 fights; the Spoils Map and Dowsing Rod are quest cards that pay off later
- **Events that span acts:** the Lantern Key (act 2: return it for gold or fight a knight for it) leads to War Historian Repy (act 3: free him or open his chest). Mega Crit published the split: 56% of players returned the key; 88% freed Repy.
- **Many events contain fights** (Lantern Key, Punch Off, Battleworn Dummy, the fake Merchant), and several **escalate in stages** (Colossal Flower, Abyssal Baths, The Trial).
- **Relic trades are an "Any Act" staple:** Relic Trader, Ranwid (a potion or gold for a relic, or one relic for two), Wongo's.
- **Ascension:** StS2 dropped StS1's per-event A15 tweaks. Pressure on events comes indirectly, through less gold (A3) and pricier card removal (A6).
- **Co-op:**
  - Most events are chosen by each player separately; some are flagged "collaborative" and decided together.
  - Spawn conditions are written as "every player must have X", e.g. Endless Conveyor needs 120+ gold for each player.
  - Chests contested between players are settled by a rock-paper-scissors minigame.

### 2.3 Patterns used in this design
1. Per-act pools of about 8-10 themed events, plus a small shrine pool. Act events happen once per run; a shrine can come back in a later act, but only once per act.
2. Power climbs by act. Act 1 rewards are "small, or an investment that pays off later". Act 3 has game-changing swings. The final act pays in immediate power.
3. Most events are "pick 1 of 2-3 with a real trade-off". Free rewards stay small, or appear only in an act's signature event.
4. Deck edits: remove / add / duplicate / upgrade / transform, with "graded twins" (free vs stronger with a cost).
5. Held-item trades and story threads across acts: the Old Amber is our Golden Idol, the Team Rocket arc is our Red Mask / Lantern Key.
6. Press-your-luck (Power Plant item balls) and fixed-odds bets (Game Corner, S.S. Anne).
7. Co-op: choices are private. Battle choices are marked solo and replaced, instead of excluding the whole event. Spawn conditions use shared inputs only.
8. No per-event ascension tweaks. Costs go through `run.price()` so A4 bites, and HP costs bite at A5.

### 2.4 Sources
- StS2 overview: https://en.wikipedia.org/wiki/Slay_the_Spire_II
- StS2 events and Ancient pools: https://spire-codex.com/events · https://slaythespire2.net/event · https://gamewith.ai/slay-the-spire2/en/events · https://gamewith.ai/slay-the-spire2/en/events/THE_LANTERN_KEY · https://gamewith.ai/slay-the-spire2/en/events/TRIAL · https://www.keengamer.com/articles/guides/slay-the-spire-2-all-events-and-rewards-guide/
- StS2 Ancients: https://slaythespire2.net/ancient/neow · https://www.thegamer.com/slay-the-spire-2-ancients-blessings-offerings-list-guide/
- StS2 ? room odds: https://spire-codex.com/mechanics/unknown-rooms
- StS2 ascension: https://www.sts2companion.com/ascension
- StS2 co-op: https://www.stratgg.com/guides/co-op/ · https://allthings.how/slay-the-spire-2-co-op-multiplayer-every-mechanic-and-rule-explained/
- StS2 patch notes v0.100.0 to v0.110.0 and the April/August 2026 newsletters: Steam news for app 2868840 (https://store.steampowered.com/news/app/2868840)
- StS1 events: https://slaythespire.wiki.gg/wiki/Events · https://slaythespire.wiki.gg/wiki/Events_List and each event's page (e.g. https://slaythespire.wiki.gg/wiki/Big_Fish, https://slaythespire.wiki.gg/wiki/Mind_Bloom)
- StS1 ? room code analysis: https://forgottenarbiter.github.io/Correlated-Randomness/

---

## 3. The power curve

### 3.1 What an act looks like today
The economy rows come from the code (`run.js`, `battle.js`, `shop.js`, `items.js`). The "smart bot" rows come from 30 runs of `tests/balance.mjs --runs 30 --asc 0 --skill smart --world kanto --verbose` (7 of 30 won).

| | Act 1 | Act 2 | Act 3 | Act 4 (+ E4) | Sevii (post-game) |
|---|---|---|---|---|---|
| Levels (floors → boss) | 3-12 → 15 | 14-25 → 27 | 26-37 → 41 | 37-42 → E4 44-49 | 50-60 → 70 |
| Floors | 15 | 15 | 15 | 7, then the E4 | 12 |
| Price multiplier (`priceMult`) | x1.0 | x1.3 | x1.6 | x1.9 | x2.2 |
| Trainer pay (typical class; elite x2, boss x4) | ~$150 | ~$300 | ~$450 | ~$600 | ~$750 |
| Money earned in the act (smart bot) | ~$2,000 | ~$4,000 | ~$5,400 | ~$2,700 + E4 | n/a |
| Money held at act start (smart bot) | $1,000 | ~$2,800 | ~$4,900 | ~$8,000 | high |
| Held item price, common / uncommon / rare | 1500 / 3000 / 5000 | 1950 / 3900 / 6500 | 2400 / 4800 / 8000 | 2850 / 5700 / 9500 | 3300 / 6600 / 11000 |
| RARE CANDY / PP UP / vitamin (Mart) | 1500 / 2000 / 2400 | 1950 / 2600 / 3120 | 2400 / 3200 / 3840 | 2850 / 3800 / 4560 | 3300 / 4400 / 5280 |
| Move Deleter (Mart, per card) | 500 | 650 | 800 | 950 | 1100 |
| Move-reward power cap | 70 | 90 | 120 | 150 | 150 |
| ? events visited per run (smart bot) | ~1.5 | ~1.9 | ~1.9 | ~0.8 | ~1.5 (estimate) |

- Money piles up from act 2 on: the bot carries ~$8k into an act with one Mart left. Money rewards are worth little after act 3, and money costs should be a % of what you hold, or big.
- The last floor of every act is a guaranteed Pokémon Center. An HP cost on floor 12 costs much less than one on floor 2. HP costs therefore go a bit higher in act 4 (7 floors, then a Center).
- A5 (Weary: Centers heal 75%, almost no post-battle heal) makes HP costs much harsher. A4 (Shoestring) adds +25% to `run.price` and cuts battle pay by 20%.

### 3.2 Reward and cost sizes per act
Use this table to tune every event (`S.*` are the helpers in section 9). Rule of thumb:
- **Free** choices give at most a *small* reward (acts 1-2) or a *medium* one (act 3+). The exception is an act's single signature event (fossils, Bill), which can be a free medium.
- **Big** rewards need a medium+ cost or a fight.
- Rare held items before act 3 always come with a cost or a delay.

| Size | Act 1 | Act 2 | Act 3 | Act 4 | Sevii |
|---|---|---|---|---|---|
| **Small reward** (~1 trainer fight) | $300; 3 POKé BALLS; 2 berries; heal 25%; 1 Potion | $500; 2 GREAT BALLS; 1 Super Potion + berry; heal 30%; remove 1 card | $800; HYPER POTION; 2 good berries (Lum/Sitrus/Liechi); heal 35%; REVIVE | FULL RESTORE; 2 REVIVES; heal 50% | MAX REVIVE; 2 FULL RESTORES; full heal |
| **Medium reward** (~a common held item) | 1 of 2 common held items; RARE CANDY; a Pokémon at floor level (min IV 10); remove 2 cards; a TM up to 80 power | 1 of 3 commons or 1 of 2 uncommons; RARE CANDY + $300; a Pokémon at floor level (min IV 15); a TM up to 95; 1 vitamin | 1 of 2 uncommons; 1 vitamin; evolve a Pokémon now; upgrade 1 move; +1 copy | 1 of 3 uncommons; 1 vitamin; +3 levels on 2 Pokémon | 1 of 2 rares; 2 vitamins |
| **Big reward** (~an uncommon/rare item) | 1 of 2 uncommons; a rare item that only helps some teams; a delayed strong Pokémon | 1 of 3 uncommons; a rare item at a real cost; a Pokémon that reaches a final evolution soon (Eevee + stone, Gyarados line) | 1 of 2-3 rares; LAPRAS / HITMONs; +2 levels for the whole party | 1 of 3 rares; 2 vitamins; MAX REVIVE x2 | 1 of 3 rares; Gen 2 rare Pokémon (min IV 20); transform a whole deck |
| **Small cost** | 10% party HP; $200; 1 consumable | 15% HP; $400 | 15% HP; $800 or 15% of money | 20% HP; 1 consumable | 25% HP |
| **Medium cost** | 20% HP; $500 (half the starting money); lead starts the next battle asleep; poison on the party | 25% HP; $1,000; lose a common held item; −2 levels | 30% HP; half your money; −3 levels; lose 1 copy of your best card | 35% HP; lose a common/uncommon held item; lose 1 copy of your best card | 40% HP; lose an uncommon held item |
| **Big cost** | 35% HP; release a Pokémon; all your money | 40% HP; release a Pokémon; lose an uncommon held item; elite fight | 50% HP; release your second-best Pokémon; lose a rare held item; elite fight | lose a rare held item; release a Pokémon | release a Pokémon; lose a rare held item; two elite fights |

Cost kinds this game already supports (no new systems needed), and how they map to StS:
- **HP:** a % of each Pokémon's max HP, never below 1 HP (like today). Equivalent to StS HP loss.
- **Levels:** permanent. The closest thing to StS max HP.
- **Money.**
- **Status carried into the next battle:** sleep, poison or paralysis until cured. Equivalent to StS Dazed in the next fight.
- **Losing a held item, consumable or ball.**
- **Releasing a Pokémon.**
- **"PP DOWN":** a named card loses 1 copy (minimum 1). This is the deck-damage analogue of a curse, built from the existing copies system.
- **A battle** (solo only).

A true **junk card** (a curse that sits in the deck outside the 4-move cap, e.g. SPLASH, removable by the Move Deleter) would need engine support. It's an open question (section 10), and nothing below depends on it.

---

## 4. Shrines (any act, scale with it)
Proposed odds: a "?" picks from the shrines 25% of the time and from the act pool 75% of the time (falling back to shrines when the act pool is exhausted). Each shrine at most once per act; it can return in a later act. All 6 are co-op safe.

| Shrine | StS analogue | Choices (numbers per act) | Power note |
|---|---|---|---|
| **MOVE DELETER** (keep) | Purifier, Neow's graded twins | **Forget 1 card** (free). **Forget 2 cards** (act 3+: 3) and every Pokémon loses 15% HP. **Leave.** | The Mart charges $500 / 650 / 800 / 950 / 1100 per card, so the free removal is a small reward that scales on its own. The twin trades HP for more thinning. Today's "2 free in every act" is worth a whole act-1 starting purse. |
| **MOVE TUTOR** (keep, add caps) | Library / card reward | **Learn a move**: pick 1 of 3, free. The tutor list is capped per act: up to 80 power in act 1, up to 100 in act 2, no cap from act 3; EXPLOSION and the 150-power ultimates only in act 3+. **Premium lesson** ($600 / 780 / 960 / 1140 / 1320): pick from 4 options and the move gets +1 copy. **Leave.** | Today an act-1 tutor can teach DOUBLE-EDGE or MEGA KICK (120 power) while act-1 move rewards are capped at 70, and EXPLOSION, which move rewards hold back until act 3. |
| **COPYCAT** (new; the Saffron copycat girl, wandering) | Duplicator | **Copy a card**: +1 copy of one move card on any Pokémon (a free PP UP). **Copy two cards**: +1 copy on two different moves, and every Pokémon loses 20% HP. **Leave.** | A PP UP costs $2000 at base in Marts (x act multiplier), so a free copy is medium in act 1 and small-to-medium later. It self-scales. |
| **BILL'S PC** (keep, rescale) | Transmogrifier on a Pokémon; in-game trades | **Wonder trade**: give a Pokémon (not your last) for a random species with base stat total about 30 (act 1) / 40 (act 2) / 50 (act 3+) higher than the one you give, at its level +1, min IV 10, no legendaries. **Posted trade** (known in advance): act 1 MR. MIME (FireRed's Route 2 trade); act 2 FARFETCH'D that comes with a STICK; act 3 LICKITUNG that comes with LEFTOVERS. **Leave.** | Today it is always +40 and level +2 in every act, a free upgrade that is strongest early. The posted trades are mediocre species with a held-item kicker: a known outcome vs the random one. |
| **PROF. OAK** (keep, rescale; the recurring character) | We Meet Again / recurring NPC | **Show your Pokédex**: at or above this act's threshold (seen ≥ 10 / 20 / 32 / 40 / 55), pick 1 of 2 of Oak's items: EXP SHARE, TOWN MAP, TM CASE (act 1 adds OAK'S PARCEL). Below it: 3 POKé BALLS (act 1), 3 GREAT BALLS (act 2), 2 ULTRA BALLS (act 3+). **Give Oak a Pokémon for research** (release one, not your last): 2 RARE CANDIES (acts 1-2) or a vitamin of your choice (act 3+). | Today the bar is ≥ 25 seen in every act, so late in a run it always pays an uncommon held item for free. Thresholds should be tuned from run logs (species seen per act). |
| **BERRY TREE** (keep, scaled) | Big Fish (heal vs items) | **Pick berries**: 2 berries. Acts 1-2 draw from ORAN, SITRUS, CHESTO, PECHA, CHERI; act 3+ from SITRUS, LUM, LIECHI, SALAC, PETAYA. **Let your team eat**: heal 30% (act 1), 35% (act 2), 40% (act 3+). | A heal % scales on its own; today's berry list is the same in every act, so late berries are near worthless. |

---

## 5. Kanto per-act pools

How to read the tags:
- **Co-op:** "safe" means no battle. "Variant" means the battle choice is solo-only and hidden in co-op, while the event stays in the co-op pool. "Solo" means the whole event is solo-only.
- **A8:** interactions with the Nuzlocke ascension (A8, solo only).
- **Battle choices** need a floor gate (`minFloor: 4`), like elite nodes, which are banned before floor 5. An event fight on floor 1 with a lone Lv 6 starter can end a run.

### 5.1 Act 1: Route 1 → Mt. Moon (Lv 3-15, x1.0, ~$2,000 earned, start with $1,000; a common held item is $1,500)
Theme: small trades and investments that pay off later. Free rewards are small; the one free medium is the signature fossil event.

| # | Event (location) | Status | Co-op | Size |
|---|---|---|---|---|
| 1 | Old Man's Lesson (Viridian City) | new | safe | small / medium |
| 2 | Oak's Parcel (Viridian Mart) | new | safe | medium (investment) |
| 3 | Kakuna Tree (Viridian Forest) | new | safe | medium gamble |
| 4 | Pewter Museum: Old Amber (Pewter City) | new, starts a thread | safe | big, conditional or delayed |
| 5 | Mt. Moon Fossils (Mt. Moon B2F) | keep, reworked | safe | medium (signature, weight 2) |
| 6 | Clefairy Dance (Mt. Moon summit) | new | safe | small / medium |
| 7 | Magikarp Salesman (Route 4 Pokémon Center) | keep, act 1 only | safe | medium (investment) |
| 8 | Team Rocket at Mt. Moon (Mt. Moon 1F) | reworked `rocket`, Rocket arc 1/4 | variant | small cost / elite |

**1. OLD MAN'S LESSON** (Viridian City). The old man has had his coffee and wants to show you how to catch Pokémon.
- *Watch the lesson:* +3 POKé BALLS. (A8: +$300 instead, since you only get one catch per act.)
- *Buy him a coffee ($200):* +1 GREAT BALL, and he hands over the Pokémon he caught in the demo: a random Route 1/2/22 species (PIDGEY, RATTATA, SPEAROW, MANKEY, NIDORAN♀/♂) at floor level, min IV 10.
- *Leave.*
- Power: a second or third party member matters most in act 1, but these species are common, so this stays small/medium. $200 is about 1.3 trainer fights. A8: event Pokémon don't use up your catch (open question).

**2. OAK'S PARCEL** (Viridian Mart). The clerk asks you to take a parcel to PROF. OAK.
- *Deliver it:* OAK'S PARCEL held item (common: +3 POKé BALLS at the start of every act).
- *Open it and sell what's inside:* +$500.
- Power: the Parcel's value depends on how many acts remain (3 balls = $600 at base, x4 acts), so it is only offered in act 1. StS does the same with relics whose value depends on run length. At A8 the money is better.

**3. KAKUNA TREE** (Viridian Forest). A tree full of KAKUNA cocoons, dripping honey.
- *Shake it:*
  - 50%: pick 1 of 2 common held items (the bug-themed SILVER POWDER is always one of them).
  - 50%: a BEEDRILL swarm. Every Pokémon is poisoned and loses 10% HP.
- *Collect honey carefully:* 2 berries (ORAN / PECHA).
- *Leave.*
- Power: a medium gamble. The poison stays until a Center or a Full Heal ($600), so the downside costs real money. No battle, so it is co-op safe.

**4. PEWTER MUSEUM: OLD AMBER** (Pewter City). A scientist in the museum's back room thinks the amber is "just a rock".
- *Keep it as a charm:* OLD AMBER held item (rare: +40% damage per ROCK Pokémon in the party).
- *Send it to be revived:* nothing now. At the first "?" of act 3, the Cinnabar Lab hands you an AERODACTYL at act-3 level, min IV 20 (sets `run.flags.amber`).
- *Leave.*
- Power: a rare held item is big for act 1, but it only helps teams with Rock types (Geodude, Onix, the fossils). An Aerodactyl now (base stat total 515 at Lv 10) would break act 1, so the reward is delayed two acts. This is our Golden Idol / Lantern Key thread.

**5. MT. MOON FOSSILS** (Mt. Moon B2F; keep, reworked). The SUPER NERD will let you have one fossil.
- *HELIX FOSSIL:* OMANYTE at floor level, min IV 10.
- *DOME FOSSIL:* KABUTO at floor level, min IV 10.
- *Keep the fossil itself:* HELIX FOSSIL (uncommon: +10% per attack type in the lead's deck) or DOME FOSSIL (common: +16% per card left in hand) as a held item. Either can be revived at the act 3 Cinnabar Lab, as OMASTAR or KABUTOPS (see 5.3 #7).
- Power: still the act's free signature event (weight 2), but it becomes a real choice: a party member now, a held item, or a fully evolved Pokémon in act 3.

**6. CLEFAIRY DANCE** (Mt. Moon summit). CLEFAIRY dance around a MOON STONE.
- *Watch quietly:* 30% a CLEFAIRY joins you (floor level, min IV 10). Otherwise the party heals 20%.
- *Grab the MOON STONE:* MOON STONE (evolves NIDORINO, NIDORINA, CLEFAIRY, JIGGLYPUFF; sells for $1,050). The Clefairy pelt you: every Pokémon loses 15% HP.
- *Join the dance:* every Pokémon heals 30%.
- Power: the stone is worth $2,100 at Mart price but only to some teams, so it is priced as a medium reward with a small-to-medium cost.

**7. MAGIKARP SALESMAN** (Route 4 Pokémon Center; keep, act 1 only).
- *Buy it ($500):* MAGIKARP at max(5, floor level − 2).
- *Buy the "special" one ($900):* MAGIKARP at floor level + 2, min IV 25.
- *No thanks.*
- Power: $500 is half your starting money for a Pokémon whose deck is SPLASH and TACKLE. It becomes GYARADOS (base stat total 540) at Lv 20, around early act 2. That makes it a pure investment, which is exactly the act-1 shape. Today it also appears in act 3 and in the post-game, where it is useless.

**8. TEAM ROCKET AT MT. MOON** (Mt. Moon 1F; reworked `rocket`; Rocket arc 1 of 4). A grunt blocks the tunnel.
- *Pay up:* lose 25% of your money (min $100, max $600).
- *Fight!* (solo, floor 4+): a Rocket grunt elite (the act-1 grunt team). Normal elite reward: a 70% chance of a held-item choice.
- *Run for it:* every Pokémon loses 15% HP and you drop 1 random consumable.
- Power: today it is "30% of your money" in every act. The cap keeps act 1 sane; later Rocket events get their own numbers (Nugget Bridge, Silph, the black market).

### 5.2 Act 2: Cerulean → Celadon (Lv 14-27, x1.3, ~$4,000 earned, ~$2,800 held; common $1,950 / uncommon $3,900 / rare $6,500)
Theme: team identity. Gift Pokémon arrive, the first held-item trades, the Bicycle at a real cost.

| # | Event (location) | Status | Co-op | Size |
|---|---|---|---|---|
| 1 | Nugget Bridge (Route 24) | new, Rocket arc 2/4 | variant | big (fight or held-item trade) |
| 2 | Bill's Sea Cottage (Route 25) | new | safe | big (signature, weight 2) |
| 3 | S.S. Anne (Vermilion) | new | safe | medium, Big Fish-style |
| 4 | Pokémon Fan Club (Vermilion) | reworked `fanclub` | safe | big at a cost / medium |
| 5 | Day Care (Route 5) | reworked `daycare` | safe | medium |
| 6 | Pokémon Tower (Lavender) | keep `ghost`, add co-op option | variant | uncommon held item via elite / small heal |
| 7 | Mr. Fuji's House (Lavender) | new (Bonfire Spirits), starts the Poké Flute thread | safe | scales with what you give |
| 8 | Celadon Game Corner (Celadon) | keep, act 2 only | variant | bet / Pokémon purchase |
| 9 | Celadon Rooftop (Celadon Dept. Store) | new | safe | medium for a small cost |
| 10 | Snorlax on Route 12 | keep, act 2 only | variant | elite / Pokémon with the Poké Flute |

**1. NUGGET BRIDGE** (Route 24; Rocket arc 2 of 4). After the bridge trainers, a man hands you a NUGGET and asks you to join TEAM ROCKET.
- *Refuse* (solo, floor 4+): a Rocket elite battle, then the normal elite reward plus the NUGGET (sells for $5,000).
- *"Join" Team Rocket:* keep the NUGGET, but hand over one held item of your choice as "membership dues". Sets `run.flags.rocket`, which matters at Silph Co. in act 3.
- *Walk past.*
- Power: $5,000 is about an uncommon at act-2 prices, a big reward. It costs either an elite fight or a held item. The second choice is a held-item trade for money (StS's Golden Idol into 333 gold), good when you hold a dead item.

**2. BILL'S SEA COTTAGE** (Route 25). Bill is stuck fused with a Pokémon.
- *Run the Cell Separator:* S.S. TICKET (uncommon: everything in shops costs 20% less).
- *Ask for one of his Pokémon:* EEVEE at floor level, min IV 20, plus a FIRE, WATER or THUNDER STONE of your choice. The machine shocks your lead on the way out: it loses 30% HP.
- *Leave.*
- Power: the S.S. Ticket's value depends on how much shopping remains (2.5 acts), so act 2 is its spot. Eevee plus a stone gives an evolved form with base stat total 525 at about Lv 20, the act's big Pokémon reward. This replaces the generic `gift` event.

**3. S.S. ANNE** (Vermilion Harbor). The ship's party is in full swing.
- *Rub the seasick Captain's back:* pick 1 of 3 common held items from his cabin.
- *Join the party:* every Pokémon heals 50% and is cured of status.
- *Bet in the dining hall ($650):* 40% chance to win $1,950 (expected value +$130).
- Power: a held item, a heal or money, the Big Fish pattern. A common choice of 3 is medium in act 2. Heal 50% is about half a Center. No battle.

**4. POKéMON FAN CLUB** (Vermilion; reworked `fanclub`).
- *Hear the Chairman's whole story:* BICYCLE (rare: +1 hand size). The story is so long that your whole party falls asleep: sleep carries into the next battle until cured (CHESTO, FULL HEAL or a Center).
- *Show off your Pokémon* (needs 3+ Pokémon): pick 1 of 2 from SOOTHE BELL, LUCKY EGG, TEA, POKé FLUTE, AMULET COIN.
- *Leave.*
- Power: today the Bicycle is a free 35% roll from any act (the bot ended 8 of 30 sample runs holding it). A rare item in act 2 needs a medium cost, and "start the next fight asleep or spend a Full Heal ($780)" is that cost. The "no room, take $1,500" fallback goes away, since there is no cap on held items.

**5. DAY CARE** (Route 5; reworked `daycare`).
- *Leave a Pokémon with the old man ($1,300):* +4 levels.
- *Take the EGG the couple found:* it hatches into a baby (PICHU, CLEFFA, IGGLYBUFF, TOGEPI, TYROGUE, SMOOCHUM, ELEKID, MAGBY, AZURILL) at floor level − 3, min IV 15. There is a 10% chance it's a DRATINI, LARVITAR or BAGON instead.
- *Leave.*
- Power: today's $1,500 for +3 levels is worse than a Pokémon Center's free Train. +4 for $1,300 is a fair act-2 trade against a RARE CANDY ($1,950 for +3). Friendship evolutions happen at Lv 22 in this game, so babies pay off in act 2. The pseudo-legendary jackpot drops from about 21% of eggs in every act (3 of 14 species today) to 10% in act 2 only.

**6. POKéMON TOWER** (Lavender; keep `ghost`). A CHANNELER blocks the stairs.
- *Face the spirit* (solo): an elite battle against MAROWAK's ghost (floor level + 3), then SILPH SCOPE (uncommon: GHOST and DARK cards +80%).
- *Rest on the purified floor:* every Pokémon heals 35% and is cured of status.
- *Turn back.*
- Power: unchanged for solo. The new choice keeps the event in co-op (today it is excluded).

**7. MR. FUJI'S HOUSE** (Lavender Volunteer House; Bonfire Spirits analogue).
- *Leave a Pokémon in his care* (released; not your last). The reward depends on its base stat total:
  - under 300: a RARE CANDY
  - 300-449: pick 1 of 2 common held items, and the party heals 30%
  - 450+: pick 1 of 3 uncommon held items
- *Help around the house:* POKé FLUTE (common: your Pokémon wake up every turn). It also unlocks the friendly choice at the Route 12 Snorlax.
- *Leave.*
- Power: the reward climbs with what you give up, the StS Bonfire pattern. A8: a released Pokémon is much harder to replace when you get one catch per act (flag).

**8. CELADON GAME CORNER** (keep `gamecorner`, act 2 only).
- *Play the slots ($800):* 5% jackpot of $5,200; 30% win $1,600; otherwise nothing (expected value −$60, about the same as today).
- *Prize counter ($2,600):* pick 1 of 2 from PORYGON, SCYTHER, PINSIR, DRATINI at floor level, min IV 15.
- *Check the poster behind the counter* (solo, floor 4+): the Rocket Hideout. An elite battle against a Rocket grunt team, then the normal elite reward plus LIFT KEY (common: elite battles give double money).
- *Leave.*
- Power: the bet and the prize price scale with the act (today: a flat $1,000 bet from act 2 onward, which is trivial by act 3). The prize counter turns act-2 money (~$3-5k held) into a known Pokémon.

**9. CELADON ROOFTOP** (Celadon Dept. Store roof). A thirsty girl stands next to the vending machine.
- *Buy her a drink ($400):* she gives you a TM. Pick 1 of 2 from the Mart TM pool (act-2 cap of 95 power).
- *Buy drinks for your team ($400):* every Pokémon heals 40%.
- *Leave.*
- Power: Mart TMs cost $1,950-5,200 in act 2, so a TM choice for $400 is a medium reward at a small cost. This is FireRed's real drinks-for-TMs exchange.

**10. SNORLAX ON ROUTE 12** (keep `snorlax`, act 2 only).
- *Wake it up!* (solo, floor 4+): an elite wild battle against SNORLAX at floor level + 3. You can catch it.
- *Play the POKé FLUTE* (only if you hold one): SNORLAX wakes up calm and joins you (floor level, min IV 10).
- *Go around:* every Pokémon loses 15% HP.
- Power: removed from act 3, which already has SNORLAX as an elite (`LEGEND_SNORLAX`), and from acts 4-5. The Poké Flute choice rewards the Mr. Fuji or Fan Club pick, and it is co-op safe.

### 5.3 Act 3: Fuchsia → Cinnabar (Lv 26-41, x1.6, ~$5,400 earned, ~$4,900 held; common $2,400 / uncommon $4,800 / rare $8,000)
Theme: big swings and game-changing trades (StS's Beyond). Money costs become "half your money" because money piles up.

| # | Event (location) | Status | Co-op | Size |
|---|---|---|---|---|
| 1 | Silph Co. Takeover (Saffron) | new, Rocket arc 3/4 | variant | big |
| 2 | Fighting Dojo (Saffron) | new (absorbs `gift`'s Hitmons) | variant | big via elite / medium |
| 3 | Safari Zone (Fuchsia) | new | safe | gamble for a strong Pokémon |
| 4 | Cycling Road (Routes 16-17) | new | variant | uncommon gamble |
| 5 | Fishing Brothers (Route 12 / Fuchsia) | new | safe | medium |
| 6 | Pokémon Mansion: Mew's Journal (Cinnabar) | new (Mind Bloom) | variant | big |
| 7 | Cinnabar Lab (Cinnabar) | new, pays off the Amber/fossil thread | safe | upgrade / transform / held item for a Pokémon |
| 8 | Seafoam Currents (Seafoam Islands) | new (Falling + Relic Trader) | safe | held-item trade |
| 9 | Power Plant Item Balls (Power Plant) | reworked `itemball` | variant | press-your-luck |

**1. SILPH CO. TAKEOVER** (Saffron; Rocket arc 3 of 4). TEAM ROCKET has taken over SILPH CO.
- *Storm the building* (solo): an elite battle against a Rocket admin team, then a MASTER BALL plus 1 of 3 held items (50% uncommon / 50% rare).
- *Sneak up to 7F:* the grateful employee gives you LAPRAS at floor level, min IV 20. Grunts spot you on the way out: every Pokémon loses 25% HP. If you "joined" at Nugget Bridge you walk out in uniform, with no HP loss.
- *Grab a CARD KEY and leave:* CARD KEY (common: Marts stock one more held item).
- Power: Lapras (base stat total 535) at act-3 levels is a big reward for a medium act-3 cost. The Master Ball matters for the one-time legendary catch offers (bird nodes). A8 note: the Master Ball still only works on that act's single allowed catch.

**2. FIGHTING DOJO** (Saffron).
- *Challenge the KARATE MASTER* (solo): an elite battle (BLACK BELT team), then pick HITMONLEE or HITMONCHAN at floor level + 2, min IV 20. This is FireRed's real pick-1-of-2.
- *Train with the disciples:* your lead gains +3 levels; every Pokémon loses 20% HP.
- *Bow and leave.*
- Power: +3 levels for 20% HP is a medium trade (a RARE CANDY is $2,400 here). The Hitmons are the big prize behind a fight.

**3. SAFARI ZONE** (Fuchsia).
- *Enter ($800):* meet one of CHANSEY, KANGASKHAN, TAUROS, SCYTHER, PINSIR, DRATINI, EXEGGCUTE, RHYHORN at floor level. Throw 3 Safari Balls, each with that species' catch rate (about 15% for Chansey and Dratini, 30-40% for the rest). No battle. A caught Pokémon has min IV 10.
- *Look for the Warden's GOLD TEETH:* every Pokémon loses 20% HP; you get GOLD TEETH (uncommon: elites offer one extra held-item choice).
- *Leave.*
- Power: about a 60-70% chance of a Pokémon, with Chansey and Dratini as the jackpots. $800 is about 1.8 trainer fights. **A8:** a Safari catch counts as the act's one catch, and the choice is disabled if you've already caught one.

**4. CYCLING ROAD** (Routes 16-17).
- *Race down with no brakes:* 50%: pick MACH BIKE or ACRO BIKE (both uncommon). 50%: crash, and your two healthiest Pokémon lose 35% HP.
- *Take on the bikers* (solo): a trainer battle, then pick a vitamin (a combo level-up) instead of money.
- *Walk your bike.*
- Power: an uncommon held item at a coin flip. The fight pays a vitamin instead of money, because by act 3 money is no longer a reward.

**5. FISHING BROTHERS** (Route 12 Super Rod guru; his brother has the Good Rod).
- *Fish with the SUPER ROD ($400 for bait):* a Pokémon from the area's fishing table at floor level (e.g. GYARADOS 10%, SEAKING, KINGLER, SHELLDER, STARYU, HORSEA, POLIWHIRL, SLOWPOKE, TENTACOOL).
- *Take the GOOD ROD:* GOOD ROD (uncommon: +24% damage per discard left).
- *Leave.*
- Power: medium. The free choice is an uncommon that only some builds want.

**6. POKéMON MANSION: MEW'S JOURNAL** (Cinnabar; Mind Bloom analogue). A journal about a new Pokémon, and a sealed laboratory.
- *Fund the research:* every Pokémon gains +2 levels; you pay half your money.
- *Open the sealed lab* (solo): an elite battle against the lab's experiments (MAGMAR / GRIMER / KOFFING team), then 1 of 3 rare held items.
- *Recreate the experiment:* every Pokémon upgrades one move (see the Cinnabar Lab), but Pokémon Centers heal only half as much for the rest of this act.
- Power:
  - +2 levels for the whole party is about 4 RARE CANDIES (~$9,600 here), a big reward. Half your money (~$2-3k) is a medium-to-big cost, and a deliberate money sink.
  - The second choice is Mind Bloom's "I am War"; the third is its "I am Awake". The Center penalty needs an act-scoped modifier (section 9).

**7. CINNABAR LAB** (Cinnabar Island). Pays off the act-1 Old Amber and fossil choices.
- *Revive a fossil:* trade a HELIX FOSSIL, DOME FOSSIL or OLD AMBER held item for OMASTAR, KABUTOPS or AERODACTYL at floor level, min IV 20. Only shown if you hold one. If you chose "send it to be revived" at Pewter, Aerodactyl is free and this event is forced as the first "?" of act 3.
- *Gene research ($1,600):* upgrade one move. It is replaced with the strongest move of the same type that this Pokémon can learn (power ≤ 150), and keeps its copies, including PP UP copies. For example EMBER becomes FLAMETHROWER, WATER GUN becomes SURF.
- *Volunteer as a test subject* (free): transform up to 2 move cards of one Pokémon into random moves it can learn (any type, act power cap); copies reset to the new move's default.
- Power:
  - Trading a held item for a fully evolved Pokémon is big, but you paid for it in act 1.
  - The upgrade is medium ($1,600 is about 3.5 trainer fights). It is the StS "upgrade" this game has never had.
  - The transform is the free, risky Transmogrifier.

**8. SEAFOAM CURRENTS** (Seafoam Islands B3F). The current is about to sweep something away. Two of your held items are named before you choose (like StS Falling).
- *Let go of [held item A]:* you wash up near ARTICUNO's nest; pick 1 of 3 uncommon held items.
- *Let go of [held item B]:* same reward.
- *Swim hard:* every Pokémon loses 30% HP; nothing gained.
- Power: a held-item trade (Relic Trader), good when one of the named items is dead weight. Only offered if you hold 2+ held items. This needs a shared spawn condition in co-op; see section 9.

**9. POWER PLANT ITEM BALLS** (Power Plant; reworked `itemball`). Item balls lie all over the floor, and some of them hum.
- *Pick up a ball* (repeat up to 3 times): each one is a consumable from one tier above the act (HYPER POTION, REVIVE, RARE CANDY, a vitamin, THUNDER STONE).
  - The chance it's an ELECTRODE rises each time: 25% / 35% / 50%.
  - Solo: a wild battle against ELECTRODE (floor level + 1, knows SELF-DESTRUCT), and the event ends.
  - Co-op: it explodes, your lead loses 30% HP, and the event ends.
- *Leave.*
- Power: a press-your-luck loop (Dead Adventurer / Scrap Ooze). Today this is a single ball in every act with VOLTORB or ELECTRODE, and it is excluded from co-op. Power Plant item-ball ambushes are real in FireRed.

### 5.4 Act 4: Victory Road (7 floors, Lv 37-42, then the E4 at 44-49; x1.9; ~$8,000 held, one Mart left)
Theme: pay in power for the gauntlet, not money. Money is a fine *cost* here (players are rich), and HP costs can be a bit higher because the last floor is a guaranteed Center. The bot sees fewer than 1 event per run here, so the pool is small (5).

| # | Event (location) | Status | Co-op | Size |
|---|---|---|---|---|
| 1 | Victory Road Boulders | new (absorbs `hiker`) | safe | medium / big |
| 2 | Ace Trainer's Challenge | reworked `cooltrainer` | variant | big via elite / info |
| 3 | Rocket Black Market (Route 23) | new, Rocket arc 4/4 | safe | money into rare items |
| 4 | The Veteran's Partner (Victory Road) | new | safe | held-item and Pokémon trades |
| 5 | Indigo Plateau Provisions | new | safe | small / medium, free |

**1. VICTORY ROAD BOULDERS.** A STRENGTH puzzle blocks the cave.
- *Solve the puzzle:* every Pokémon loses 15% HP; pick 1 of 2 vitamins (combo level-ups, applied now).
- *Smash through:* every Pokémon loses 35% HP; pick 1 of 3 held items (50% uncommon / 50% rare).
- *Go around.*
- Power: vitamins cost $4,560 here, so the first choice is medium. A rare held item choice is big, and so is 35% HP, but a Center is guaranteed before the E4. The retired `hiker` event (a Nugget at $5,000 in act 1) folds in here.

**2. ACE TRAINER'S CHALLENGE** (reworked `cooltrainer`, act 4 only).
- *Battle!* (solo): an elite battle (COOLTRAINER pool), then pick 1 of 3 held items (uncommon/rare) instead of today's double money.
- *Trade notes:* see the Elite Four's boss rules for this run, plus a FULL RESTORE. An information reward (like StS2's Crystal Sphere).
- *Decline.*
- Power: double money is worthless in act 4 with ~$8k held. An item choice is what an act-4 elite should pay.

**3. ROCKET BLACK MARKET** (Route 23; Rocket arc 4 of 4). With Giovanni gone, grunts are selling off the loot.
- *Buy stolen goods ($5,700):* pick 1 of 3 rare held items (no legendary items).
- *Buy supplies ($1,900):* a MAX REVIVE and a FULL RESTORE.
- *Report them:* 2 FULL HEALS.
- Power: rare items cost $9,500 in act-4 Marts, so this is a discount, but it's the main way to turn the ~$8k pile into gauntlet power. A money sink on purpose.

**4. THE VETERAN'S PARTNER** (Victory Road). An old trainer is retiring.
- *Trade two held items for one:* give two of your held items, then pick 1 of 3 rare held items. A consolidating trade: Ranwid's "relic for two relics", in reverse.
- *Trade a Pokémon for his partner:* give your lowest-level Pokémon, receive a fully evolved one (ARCANINE, LAPRAS, MACHAMP, GYARADOS, SNORLAX, NINETALES) at floor level, min IV 20.
- *Leave.*
- Power: big, but you give something up either way. No battle.

**5. INDIGO PLATEAU PROVISIONS** (the last Pokémon Center before the League).
- Pick one bundle: *2 FULL RESTORES*, or *a MAX REVIVE + a REVIVE*, or *a vitamin + a PP UP*.
- Power: free, small-to-medium. A prep event for the gauntlet.

### 5.5 Elite Four: between-room interludes (optional, needs the owner's call)
Today the gauntlet gives a partial heal and the Plateau Mart between rooms. Proposal: before rooms 2-5, sometimes (say 50%) show one of these interludes. Effects last for **the next room only**, which needs a `run.nextBattle` modifier. All co-op safe.

| Interlude | Choices |
|---|---|
| **The Stairwell** | Rest: heal 20% more. Or focus: +1 discard in the next room. |
| **The Trophy Room** | Your lead is inspired: +30% damage in the next room. Or forget 1 card (permanent). |
| **Blue's Message** (only before the Champion) | See the Champion's team and rule, plus a FULL HEAL. Or "Smell ya later": +1 hand size in the Champion fight, and your lead starts confused. |

### 5.6 Sevii Islands post-game (Lv 50-60, boss 70; x2.2; money is near meaningless)
Theme: legendary-tier trades with harsh costs.

| # | Event (location) | Co-op | Choices (short) | Power note |
|---|---|---|---|---|
| 1 | **Four Island Day Care** (takes over the egg from today's `daycare`) | safe | *Take the EGG:* LARVITAR, DRATINI, BAGON or BELDUM (or a Gen 2 baby) at floor level − 5, min IV 20, with one egg-move card. *Train a Pokémon* ($4,400): +5 levels. *Leave.* | Pseudo-legendary eggs belong here, not in act 1 (today they come at act-1 levels with min IV 15). |
| 2 | **Ember Spa** (One Island / Mt. Ember) | safe | *Soak:* full heal and cure. *Climb Mt. Ember for the RUBY:* RUBY (rare); every Pokémon loses 40% HP and your lead is burned. *Leave.* | A free full heal is small at Sevii; a rare item for a big cost. |
| 3 | **Dotted Hole** (Six Island) | variant | *Fight the Rocket admins* (solo): elite battle, then SAPPHIRE (rare). *Solve the braille puzzle:* SAPPHIRE, but the trap takes your lowest-rarity held item. *Leave.* | The co-op route is a held-item trade. |
| 4 | **Tanoby Ruins** (Seven Island, the UNOWN chambers) | safe | *Read the inscriptions:* transform every card of one Pokémon (each move becomes a random learnable move, power ≤ 150, copies reset). *Copy the glyphs:* pick 1 of 3 TMs (no power cap). *Leave.* | Whole-deck transform (StS Astrolabe): big variance for a post-game team. |
| 5 | **Trainer Tower** (Seven Island) | variant | *Climb it* (solo): two elite battles in a row (no heal between), then 1 of 3 rare held items. *Watch from the stands:* 1 vitamin of your choice. *Leave.* | A big reward for a big cost (two elites). |
| 6 | **Rocket Warehouse** (Five Island) | variant | *Raid it* (solo): an elite battle, then rescue 1 of 3 Pokémon (HERACROSS, SKARMORY, MILTANK, SNEASEL, HOUNDOOM, AMPHAROS, KINGDRA, TYRANITAR line) at floor level, min IV 20. *Buy one back* ($6,600): pick 1 of 2. *Leave.* | The money choice turns post-game money into something. |
| 7 | **Selphy's Request** (Resort Gorgeous) | safe | She wants to see a [random type] Pokémon. *Show her one* (if you have it): 1 of 3 uncommon/rare held items. *Give it to her* (release it): 1 of 3 rare held items. *Leave.* | A release cost for a rare item; scales with team commitment. |

---

## 6. Hoenn: how it would mirror this (sketch)
Same structure: per-act pools plus the same 6 shrines (Bill's PC becomes the Lanette/PC box, Prof. Oak becomes Prof. Birch). Today Hoenn shares every generic event with Kanto (a Magikarp salesman, Celadon's Game Corner, Bill and Oak all show up in Hoenn); only the desert fossils are Hoenn-specific. A nice property: many of this game's Gen 3 held items have canonical Hoenn events, so Hoenn events can hand out "the real item from the real place".

| Act | Event ideas (location: hook) |
|---|---|
| **Hoenn 1** (Littleroot → Dewford, Lv 4-16) | **Pretty Petal Flower Shop** (Route 104): WAILMER PAIL, or berries. **Petalburg Woods** (Aqua grunt mugging the Devon researcher; the arc opener, like Mt. Moon): pay / fight / run. **Devon Corp** (Rustboro): Mr. Stone gives one of 2 commons, or $. **Mr. Briney's boat:** pay for a shortcut (skip a floor's fight) vs heal. **Granite Cave:** Steven's letter, then 1 of 2 uncommons for −20% HP. **Wally's first catch:** help him (lose a POKé BALL), and he gives you his RALTS' sibling. |
| **Hoenn 2** (Mauville → Petalburg, Lv 15-28) | **Rydel's Cycles** (Mauville): pick the MACH BIKE or ACRO BIKE, FireRed's pick-1-of-2 made literal. **Glass Workshop** (Route 113): trade volcanic ash (an HP cost while collecting) for a BLUE, YELLOW, RED, BLACK or WHITE FLUTE; these held items already exist. **Desert Fossils** (keep `fossil_h`, with the same held-item rework as Mt. Moon). **Lavaridge hot spring:** heal, or the old lady's WYNAUT egg. **Prof. Cozmo's METEORITE** (Meteor Falls): the rare METEORITE for fighting the Magma admin (solo) or for half your money. **Trick House:** a 3-door puzzle (press your luck). **Mauville Game Corner:** replaces Celadon's in Hoenn. |
| **Hoenn 3** (Fortree → Sootopolis, Lv 26-39) | **Weather Institute:** CASTFORM gift for −25% HP (Aqua grunts). **Kecleon on Route 120:** DEVON SCOPE (it exists) for a fight, or go around. **Mt. Pyre orbs:** choose RED ORB or BLUE ORB (both rare, both exist), or full heal; the Silph-style big choice. **Shoal Cave:** collect SHOAL SALT / SHELL (HP cost), then SHELL BELL or SHOAL SHELL. **Abandoned Ship:** SCANNER (it exists) + a press-your-luck key hunt. **Contest Hall:** POKéBLOCK CASE for an HP cost (a contest run). **Feebas fishing** (Route 119): a long-odds FEEBAS (becomes MILOTIC). |
| **Hoenn 4** (Victory Road → Ever Grande, Lv 37-46) | **Wally's challenge** (solo elite, then a held-item choice). **Ever Grande provisions.** **The Veteran's Partner** and **Black Market** (Aqua/Magma leftovers) mirror Kanto act 4. |
| **Sky Pillar post-game** | **Steven's house:** BELDUM gift (release a Pokémon). **Southern Island:** EON TICKET (rare) or LATIAS/LATIOS bond. **Sealed Chamber braille:** whole-deck transform. **Jirachi's wish:** pick 1 of 3 big boons (a mini StS2 Ancient). **Battle Tower** (solo double elite). |

---

## 7. Current events: keep, rework or retire

| Event (id) | Today | Verdict | Why / where it goes |
|---|---|---|---|
| Magikarp Salesman (`magikarp`) | $500, every act and world | **Keep:** Kanto act 1, scaled, + "special" choice | An investment only makes sense early; useless in act 3, the post-game and Hoenn. |
| Game Corner (`gamecorner`) | Flat $1,000 bet, act 2+ | **Keep:** Kanto act 2 (Celadon), bet scaled, prize counter, Rocket Hideout | A flat bet is trivial by act 3. Celadon is act 2. |
| Day Care (`daycare`) | $1,500 for +3 levels (worse than a Center's free Train) or a free egg (about 21% pseudo-legendary) in every act | **Rework:** act 2 Day Care (+4 levels for $1,300 / baby egg with a 10% jackpot); the pseudo-legendary egg moves to Sevii | The paid choice was dominated by a free egg. A free Dratini or Larvitar in act 1 is too strong. |
| Mt. Moon Fossils (`fossil`) | Free Omanyte or Kabuto, act 1 | **Keep + rework:** add "keep the fossil as a held item", revivable in act 3 | Same signature event, now a real choice and a thread across acts. |
| Desert Fossils (`fossil_h`) | Hoenn act 2 | **Keep + rework** | Mirrors Mt. Moon. |
| Move Tutor (`tutor`) | Free, every act, no power cap | **Keep as a shrine,** power cap per act + premium choice | Act 1 can roll DOUBLE-EDGE or MEGA KICK (120) and EXPLOSION, well above the act-1 reward cap of 70. |
| Snorlax (`snorlax`) | Act 2+, every world | **Keep:** Kanto act 2 only, + Poké Flute choice | Act 3 already has a SNORLAX elite; it isn't on Victory Road or in the post-game. |
| Team Rocket (`rocket`) | 30% of money or a grunt fight, every act and world | **Rework** into the Rocket arc: Mt. Moon (act 1), Nugget Bridge (2), Silph Co. (3), Black Market (4) | Recurring characters with rising stakes (Red Mask / Lantern Key). |
| Berry Tree (`berries`) | 2 berries or heal 30%, every act | **Keep as a shrine,** berry tier per act | Late berries are near worthless today. |
| Suspicious Item (`itemball`) | 30% Voltorb/Electrode battle, every act, excluded from co-op | **Rework:** act 3 Power Plant press-your-luck with a co-op variant | Fixes the theme and keeps it in co-op. |
| Bill's PC (`trade`) | Base stat total +40, level +2, every act | **Keep as a shrine,** scaled (+30 / +40 / +50) + posted in-game trade | A free upgrade that's strongest early; the posted trade adds a known-outcome choice. |
| Pokémon Tower (`ghost`) | Act 2, excluded from co-op | **Keep** + co-op-safe "purified floor" choice | Right place; stays in co-op now. |
| Gift Pokémon (`gift`) | Act 2+ | **Retire**; its Pokémon move into themed events (Silph LAPRAS, Dojo HITMONs, Bill's EEVEE, Game Corner PORYGON / SCYTHER / PINSIR / DRATINI) | Its table is indexed by act × 3, so EEVEE, LAPRAS and the HITMONs never appear (they're "act 1" but the event starts in act 2). Act 3 gives ABRA or EEVEE (indexes past the end of the list fall back to EEVEE), act 4 and the post-game always give EEVEE. |
| Move Deleter (`deleter`) | 2 free removals, every act | **Keep as a shrine:** 1 free / 2-3 for 15% HP | Graded twins; today's version is worth a whole act-1 purse. The bots also ignore it (see 9). |
| Fan Club (`fanclub`) | Free BICYCLE (35%) or a common, every act | **Rework:** Kanto act 2 (Vermilion), BICYCLE costs a party-wide sleep | A free +1 hand size in act 1 is the strongest event result in the game. |
| Cooltrainer (`cooltrainer`) | Elite fight for double money, act 2+ | **Rework:** act 4 only, pays a held-item choice, + "trade notes" | Double money is worthless late. |
| Hiker's Shortcut (`hiker`) | −15% HP for a NUGGET ($5,000), STAR PIECE, RARE CANDY, PP UP, MOON STONE..., every act | **Retire**; folded into Victory Road Boulders | A Nugget in act 1 is worth more than three common held items for a small HP cost. |
| Prof. Oak (`oak`) | ≥ 25 species seen gives an uncommon held item, every act | **Keep as a shrine,** thresholds per act + "give a Pokémon for research" | Late in a run it's a free uncommon every time. |

---

## 8. Ascension and co-op notes
- **A8 Nuzlocke (solo only):** today every event Pokémon (fossil, egg, gift, Magikarp, trade) gets around "only the first wild Pokémon of each act can be caught". Proposal:
  - Gifts and trades stay allowed (a common Nuzlocke house rule).
  - Catching events (Safari Zone, Old Man's demo catch, Fishing) count as the act's one catch and are disabled once it's used.
  - "Release a Pokémon" costs are much harsher at A8. Keep them, but show a warning on the button.
  - HP costs never take a Pokémon below 1 HP (as today), so events can't cause Nuzlocke releases.
- **A2 Fog of War:** event battles follow the normal rules (no intents). The "trade notes" choice in act 4 still reveals boss rules, since that's information about the E4, not about intents.
- **A4 Shoestring:** money *costs* use `run.price()` (which already adds +25% at A4), and money *rewards* use the act multiplier without the A4 markup, so A4 really is poorer.
- **A5 Weary:** HP costs bite much harder, and heal choices become much better. That's intended; no per-event change (StS2 dropped per-event ascension tweaks).
- **A1 / A9:** event elites follow the normal elite rules (A1 +10% HP, A9 boss rules from act 2).
- **Co-op:**
  - Both players already see the same event (picked from shared inputs: room seed, act, node, the union of seen events, the smaller party size).
  - Choices stay private.
  - Replace `COOP_EXCLUDED_EVENTS` with a per-choice `solo: true` flag: solo choices are hidden in co-op, and an event is excluded only if all its non-leave choices are solo.
  - Spawn conditions must use shared inputs only. Item-dependent things (holds a Poké Flute, holds 2+ held items, holds a fossil) should be choice conditions, not pool filters, or be checked for *both* players (StS2's "all players must have X").

---

## 9. Implementation notes (brief)

**Data shape (`events.js`).**
```js
{ id: 'mtmoon_fossils', title: 'MT. MOON FOSSILS', npc: 'poke_maniac',
  world: 'kanto', acts: [0],            // or pool: 'shrine' (any act)
  weight: 2, minFloor: 0, once: 'run',  // shrines: once: 'act'
  spawn: (probe) => true,               // shared inputs only (co-op safe)
  choices: [
    { label: r => `Buy it ($${S.cost(r, 500)})`, cond: r => r.money >= S.cost(r, 500),
      solo: false, ai: r => 0.6,         // bot hint: value in "medium reward" units
      run: (r, rng, mon) => ({ text, newMon, relicChoices, ... }) },
  ] }
```

**Scaling helpers (`events_scale.js`).**
- `S.cost(r, base)` = `r.price(base)`: act multiplier plus the A4 markup.
- `S.reward(r, base)` = base × (1 + 0.3 × act), without the A4 markup.
- `S.moneyPct(r, frac, min, max)`.
- `S.lvl(r, off)` = `r.levelFor(r.floor) + off`.
- `S.hp(r, frac)`: party HP loss, floor of 1 HP.
- `S.relics(r, rng, n, weights)`: wraps `r.relicChoices`.
- `S.size(r, 'small' | 'medium' | 'big')`: the section 3.2 table, for consumables, berries and heal %.

**New result fields in `scenes/event.js`.** `RelicChoiceModal` is already imported. The new fields:
- `relicChoices`: pick 1 of N held items
- `giveRelic`: pick an owned item to lose
- `upgradeMove`, `transformMoves`, `addCopy`: the PP UP flow already exists via the `monMove` target
- `ppDown`, `release`, `statusAll`, `levelsAll`, `money`
- `flags`: for the threads across acts
- `nextBattle` and `actMods`: Mansion, E4 interludes
- `steps`: multi-step events like the Power Plant

**Picking.**
- `pickEvent`:
  1. First, any forced thread payoff (e.g. `run.flags.amber` at act 3's first "?").
  2. Then shrine 25% / act pool 75%.
  3. Act events are once per run, shrines once per act.
  4. Fall back to shrines.
- `run.seenEvents` stays the "once per run" list. Add `run.seenShrines[act]`.

**Deterministic and seeded.**
- Keep `run.rng.fork('event' + nodeId)` for solo and `${seed}:event:${act}:${node}` for co-op picks.
- Derive sub-rngs per step for multi-step events (`rng.fork('ball' + i)`), so a reload mid-event doesn't reroll.
- Save step state next to `pendingEventId` / `pendingEventAt`.
- Labels must be pure functions of run state (no rng).
- Thread state (`run.flags`) is saved in the run JSON.

**Bots and balance sim.**
- `tests/bot.mjs` `doEvent`:
  - Today it uses a hard-coded per-id policy and takes the first valid choice otherwise. Replace that with each choice's `ai(run)` hint minus the cost (HP, money), with a HP-threshold safety check.
  - Handle `deleteCards`: today's bot ignores the Move Deleter result entirely.
  - Handle `relicChoices` (reuse the post-battle item-pick logic), `release`, `upgradeMove` / `transformMoves` / `addCopy`, and `flags`.
- `tests/balance.mjs`:
  - Add per-event metrics: times seen per act, the split between choices, run win rate when picked vs not.
  - Add `--force-event ID`, like `--give ITEM`, to measure one event's impact.
  - Add an "events per act" line.
  - Also update `tests/sim.mjs`.
- Co-op: `coop_bot.mjs` / `coop_balance.mjs` must never see a `solo` choice. `tests/coop_same_event.cjs` keeps checking that both clients get the same event.
- Unit tests (`logic.test.mjs`):
  - Every event in every act has at least one valid choice.
  - Every label renders for a fresh run of each act.
  - A fixed seed produces the same event and outcome.
  - Every event's act is a real act.

---

## 10. Open questions for the owner
1. **Pool sizes:** 8 / 10 / 9 / 5 Kanto events + 6 shrines + 7 Sevii. Players see about 2 events per act, so each run shows about a quarter of each act's pool. More or fewer?
2. **Shrine share:** 25% shrine / 75% act pool, each shrine once per act. OK?
3. **Nuzlocke (A8):** should gifts and trades be allowed, with only "catch" events (Safari, Fishing, Old Man) counting as the act's one catch?
4. **Junk card ("curse"):** do you want a real dead card in the deck (e.g. SPLASH outside the 4-move cap, removable at the Move Deleter)? Without it, deck costs use "PP DOWN" (lose a copy), levels, HP, money and items.
5. **Elite Four interludes** between rooms: yes, no, or only before the Champion?
6. **Threads across acts:** Old Amber, then Cinnabar; the Team Rocket arc; Poké Flute, then Snorlax. Keep all three, or fewer?
7. **Rare held items before act 3:** the Bicycle (act 2, with a sleep cost) and the Old Amber (act 1, only helps Rock teams). Too strong?
8. **Money late:** from act 4 on, should events never pay money (items and levels only)? Section 5.4 assumes yes.
9. **StS2 "Ancients":** a boon pick at each act start (e.g. Oak, Bill, Mr. Fuji offering 1 of 3, with a heal) would fit well. Out of scope for events, or worth a follow-up?
10. **Hoenn:** build Kanto first and reuse the shape for Hoenn after, or do both worlds at once?
