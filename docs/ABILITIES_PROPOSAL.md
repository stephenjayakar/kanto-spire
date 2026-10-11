# Kanto Spire: making every ability do something (proposal)
> **TL;DR**: the game's data has **108 abilities**: 77 from FireRed (one, CACOPHONY, is on no POKéMON) and 31 from HeartGold for the Gen 4 species. Today **42 work**, **8 work partly** and **58 do nothing**: 27 Gen 3 abilities have the tooltip "No effect in battle here.", and none of the 31 Gen 4 abilities is assigned to any POKéMON, so 24 Gen 4 species have no ability at all. This proposal gives each of the 66 a card-game version with exact numbers, in five batches. A prototype of all of it is on the local branch `abilities` (not merged, not pushed). In a 2,400-run bot A/B the win rate went from 17.2% to 16.5%, which is inside the noise.


*Notion copy: https://app.notion.com/p/Kanto-Spire-making-every-ability-do-something-proposal-3f6086354b46813c8ba7f11d301558cd*
*2026-10-11 · firered-roguelike-convex (prod main, read only: v0.4.6 when branched; v0.4.7 landed since, UI only) · prototype: branch `abilities` @ `b98cb3e` in E:/BigData/games/firered-roguelike-abilities · nothing merged, pushed or deployed*

## Approved and built as v0.5.0 (2026-10-11)

The owner approved shipping this as **v0.5.0**, in one release. Changes on top of the proposal below:
- **Contact abilities trigger once per hand** (your cards touching a foe) or once per foe attack: STATIC, FLAME BODY, POISON POINT, EFFECT SPORE, ROUGH SKIN, CUTE CHARM (`Battle.contactAbility`, keyed per player and turn).
- **PRESSURE** costs a discard on any foe, ordinary trainers' POKéMON included: once per battle, and not on top of the legendary PRESSURE rule.
- **Your POKéMON can flinch.** It only happens when the foe moves before your hand that turn and its move's flinch effect lands (the move's chance; a foe's STENCH adds 10%). The hand is spent and does nothing (`resolveHand`; event `{t:'flinch'}`, "X flinched!" plus floating FLINCHED!). The intent shows `FLINCH n%` and the tooltip warns when the foe acts first (not at A2+, where intents are hidden). INNER FOCUS and SHIELD DUST block it; STEADFAST gives +1 SPEED when it happens; co-op is per player's lead. **Cap: a lead can't flinch two turns in a row** (it fired 119 times in 2,400 bot runs; flinches cancel 0.73% of hands, in 2.45% of battles).
- **Switching shows its cost:** `Battle.switchCost()` drives both the logic and the UI. The discard box shows `SWITCH COSTS 2 DISCARDS` under a foe's ARENA TRAP / SHADOW TAG and `SWITCH FREE (ANTICIPATION)`, and the switch dialog spells it out. In co-op, any foe on the field counts.
- **Co-op:** LIGHTNING ROD / STORM DRAIN draw a foe's ELECTRIC / WATER attack aimed at the partner (`DuoBattle.rodFor`). PLUS / MINUS count the partner's lead.
- **Tooltips** use plain English (`ABILITY_TEXT`). Patch notes are in `version.js`.
- Rebased on v0.4.7. `legacy/v040` is byte-identical to v0.4.7's 24 logic files (v0.4.7 changed only version.js text) and covers v0.4.0-v0.4.7. LOGIC_ID is `v050`.
- **Balance** (24 seeds x 100 runs, A0, `--spire --rotate`): v0.4.7 **17.2%** (412/2400) -> v0.5.0 **15.4%** (369/2400), -1.8 pp (±1.1, about 1.7 sigma). Act-by-act losses are unchanged; slightly more runs now reach and die in the ELITE FOUR (E4 deaths 1.4% -> 2.3%).

## Inventory: what abilities do today

| | Gen 3 (FireRed) | Gen 4 (HGSS) | Total |
|---|---|---|---|
| Works fully | 42 | 0 | **42** |
| Works partly | 8 | 0 | **8** |
| Does nothing | 27 (26 on POKéMON + CACOPHONY on none) | 31 (no species uses them) | **58** |
| **Total** | 77 | 31 | **108** |

- **How a POKéMON gets its ability:** `abilityOf()` (battle.js:59) picks `species.abilities[SPEED IV % n]`. Foes get the same pick in `makeEnemy` (battle.js:97). Nothing is stored on the mon.
- **Gen 4 data is inert:** `gen4/species.json` has each species' HGSS list (`gen4Abilities`), but `applyGen4` copies only the Gen 3 subset (`abilities`). So BIDOOF, CRANIDOS, ELECTIVIRE, PORYGON-Z, DARKRAI, ARCEUS and 18 others have none. Another 25 lose their Gen 4 slot (SHINX's RIVALRY, AMBIPOM's TECHNICIAN...). The POKéDEX shows only `abilities`, so the Gen 4 ones never appear.
- **Tooltips:** `text_overrides.js:154-196` (ABILITY_DESC) marks the 27 Gen 3 dead abilities "No effect in battle here." and rewrites 12 others. One is wrong: SHIELD DUST says "No effect for your POKéMON", but battle.js:1165 applies it to your lead too.
- **Partly working (8):** VOLT / WATER ABSORB and FLASH FIRE give only the immunity (no heal, no boost). Foes with HUSTLE get the power but not the accuracy drop. GUTS is player-only. ARENA TRAP / SHADOW TAG only stop you from fleeing a foe, and yours do nothing. INNER FOCUS only helps foes: your POKéMON never flinch (`sides.player.flinch` is set but never read).
- **Abilities that are actually boss rules:** the legendary PRESSURE rule (bosses.js:99), WATTSON's "MAGNET PULL", ROXANNE's "STURDY" and SIDNEY's "INTIMIDATE" are rules named after abilities. They aren't the abilities.

<details>
<summary>Evidence: where the 50 working and partly working abilities are implemented (prod main, fd85d5e)</summary>

- Type matchup `effectiveness()` battle.js:49-56: LEVITATE :52, FLASH FIRE / VOLT ABSORB / WATER ABSORB :53, WONDER GUARD :54, THICK FAT :55
- Entry battle.js:418-422 (foe), :427-431 (lead), co-op duo.js:107-118, :316-325: INTIMIDATE, DRIZZLE, DROUGHT, SAND STREAM (ability weather lasts 99 turns, :1357)
- Damage `hitCore` battle.js:331-334 and `enemyDamage` :590-592: HUGE POWER, PURE POWER, HUSTLE, GUTS (player only), OVERGROW / BLAZE / TORRENT / SWARM (also :353)
- Speed battle.js:534: SWIFT SWIM, CHLOROPHYLL. End of turn :1469-1471 (foe), :1496-1498 (lead): SPEED BOOST, SHED SKIN, RAIN DISH
- Accuracy battle.js:1042-1044, :1176-1178: COMPOUND EYES, HUSTLE (player only), SAND VEIL, STURDY vs OHKO (also :952; survive from full HP :1153)
- Contact `contactAbility` battle.js:1050-1061 (called per hit :990, :1160): STATIC, FLAME BODY, POISON POINT (CONTACT_PUNISH :17), EFFECT SPORE, ROUGH SKIN
- Status battle.js:1264, :1279-1285: INSOMNIA, VITAL SPIRIT, IMMUNITY, WATER VEIL, MAGMA ARMOR, LIMBER; SYNCHRONIZE :1294; OWN TEMPO :1305; INNER FOCUS :1316
- Stages battle.js:1327-1329: CLEAR BODY, WHITE SMOKE, KEEN EYE, HYPER CUTTER. Secondary effects :989, :1165: SHIELD DUST
- Other: TRUANT :302, :1088; NATURAL CURE :716; RUN AWAY :1583; ARENA TRAP / SHADOW TAG :1586

</details>

## How abilities translate to a card battle
Rules every proposed effect follows:
1. **Use the games' numbers where they fit** (x1.5, x0.75, 30%, 1/8 HP) and write them into the tooltip.
2. **Once per hand** for triggers when *your* cards hit a foe. A hand is up to 5 cards, so a per-hit roll fires up to 5 times. KING'S ROCK was moved to once per hand in v0.3.7 for the same reason. This covers absorbs, CUTE CHARM and STENCH.
3. **Your stat stages are team-wide** here and survive switching, so entry boosts (DOWNLOAD) fire once per battle per POKéMON. SIMPLE is flagged as a risk.
4. **Tough foes keep their exemptions:** boss heals at 60% (absorbs), ATTRACT immunity (CUTE CHARM), the 1/12 residual on tough foes (BAD DREAMS), 1/10 for AFTERMATH.
5. **Field abilities work from anywhere in the party** (any POKéMON that isn't fainted). One copy is enough; PICKUP stacks to 30%.
6. **Both sides by default.** An effect is one-sided only where this game lacks the mechanic: players never flinch, foes hold no items, never switch out and never flee.
7. **Co-op safe:** all new state lives in `sides`, `monState`, the foe object or run fields, which lockstep and `simulate()` already snapshot. RNG rolls never happen in dry previews. Damage multipliers show up in card previews automatically.

## Per-ability proposal
Columns: current status with evidence, the proposed effect, numbers, which side it applies to, and the batch (1 multipliers, 2 triggers, 3 field/run, 4 complex, 0 text only). Flags: **risk** = could move win rates; **stand-in** = mainline rule impossible here, replaced; **hard** = needs new battle state; **situational** = rarely matters. Pokémon marked * get the ability from their HGSS list (new).

<details>
<summary>Works partly (8): finish them</summary>

| Ability | Pokémon (count) | Now | Proposed effect | Numbers | Applies to | Batch |
|---|---|---|---|---|---|---|
| **VOLT ABSORB** | JOLTEON, CHINCHOU, LANTURN (3) | partly: `battle.js:53`. ELECTRIC immunity only; no heal. | Absorbing heals 25% max HP (a foe: once per hand; bosses heal at the existing 60% rate = 15%). | 25% / once per hand | both | 2 |
| **WATER ABSORB** | POLIWAG, POLIWHIRL, POLIWRATH, LAPRAS, VAPOREON, POLITOED +4 (10) | partly: `battle.js:53`. WATER immunity only; no heal. | As VOLT ABSORB, for WATER. | 25% / once per hand | both | 2 |
| **FLASH FIRE** | VULPIX, NINETALES, GROWLITHE, ARCANINE, PONYTA, RAPIDASH +4 (10) | partly: `battle.js:53`. FIRE immunity only; no boost. | Once hit by FIRE, its FIRE moves deal x1.5 until it leaves. | x1.5 | both | 2 |
| **HUSTLE** | TOGEPI, TOGETIC, CORSOLA, REMORAID, DELIBIRD, TOGEKISS (6) | partly: `battle.js:332, :591, :1043`. Foes get x1.5 ATTACK but not the x0.8 accuracy. | Give foes the x0.8 physical accuracy too. | x0.8 acc | both | 1 |
| **GUTS** | RATTATA, RATICATE, MACHOP, MACHOKE, MACHAMP, HERACROSS +7 (13) | partly: `battle.js:333-334 (player only)`. Foes with it still take the burn halving and get no boost. | Foes: x1.5 physical with a status, no burn penalty. | x1.5 | both | 1 |
| **ARENA TRAP** | DIGLETT, DUGTRIO, TRAPINCH (3) | partly: `battle.js:1586 (foe only)`. A foe blocks fleeing; yours does nothing. | Yours in the lead: wild catch rate x1.5 (not FLYING / LEVITATE foes). Foe: also +1 discard to switch a grounded lead. | catch x1.5; +1 discard | both | 3 |
| **SHADOW TAG** | WOBBUFFET, WYNAUT (2) | partly: `battle.js:1586 (foe only)`. A foe blocks fleeing; yours does nothing. | Yours in the lead: wild catch rate x1.5. Foe: switching costs +1 discard. | catch x1.5; +1 discard | both | 3 |
| **INNER FOCUS** | ZUBAT, GOLBAT, ABRA, KADABRA, ALAKAZAM, FARFETCH'D +8 (14) | partly: `battle.js:1316; sides.player.flinch is never read`. Works on foes; your POKéMON never flinch here, so it does nothing for you. | Also immune to INTIMIDATE (Gen 8 rule), both sides. | blocks -1 ATK | both | 2 |

</details>

<details>
<summary>Does nothing, Gen 3 (27)</summary>

| Ability | Pokémon (count) | Now | Proposed effect | Numbers | Applies to | Batch |
|---|---|---|---|---|---|---|
| **STENCH** | GRIMER, MUK, STUNKY, SKUNTANK (4) | nothing. Nothing. | Gen 5 rule: once per hand, if its cards hit, 10% foe flinch (own roll, after KING'S ROCK). | 10% / hand | player (players don't flinch here) | 2 |
| **BATTLE ARMOR** | KABUTO, KABUTOPS, ANORITH, ARMALDO, SKORUPI, DRAPION (6) | nothing. Nothing. | No critical hits against it (also beats LUCKY PUNCH / STICK "always crit"). | crit 0% | both | 1 |
| **SHELL ARMOR** | SHELLDER, CLOYSTER, KRABBY, KINGLER, LAPRAS, OMANYTE +4 (10) | nothing. Nothing. | As BATTLE ARMOR. | crit 0% | both | 1 |
| **DAMP** | PSYDUCK, GOLDUCK, POLIWAG, POLIWHIRL, POLIWRATH, POLITOED +2 (8) | nothing. Nothing. | While it's out nobody can use SELF-DESTRUCT / EXPLOSION (your cards show DAMP, foes skip them) and AFTERMATH does nothing. | - | both | 2 (situational) |
| **OBLIVIOUS** | SLOWPOKE, SLOWBRO, LICKITUNG, JYNX, SLOWKING, SWINUB +10 (16) | nothing. Nothing. | Immune to infatuation (ATTRACT, CUTE CHARM) and INTIMIDATE. | - | both | 2 |
| **CLOUD NINE** | PSYDUCK, GOLDUCK (2) | nothing. Nothing. | While it's out, weather has no effect: no damage boosts, chip, SWIFT SWIM / CHLOROPHYLL / RAIN DISH, THUNDER / SOLAR BEAM / WEATHER BALL changes. The timer keeps running. | - | both | 4 |
| **AIR LOCK** | RAYQUAZA (1) | nothing. Nothing. | As CLOUD NINE (RAYQUAZA: shuts off your weather team or a weather boss). | - | both | 4 |
| **COLOR CHANGE** | KECLEON (1) | nothing. Nothing. | After an attack hits it, it becomes that attack's type (and gets STAB on it) until it leaves. | - | both | 4 (hard) |
| **SUCTION CUPS** | OCTILLERY, LILEEP, CRADILY (3) | nothing. Nothing. | Foe: your ROAR / WHIRLWIND fail on it. Yours: its hand can't be ICED or turned face-down by boss rules (LORELEI, GLACIA, face-down rules). | - | both | 2 (stand-in) |
| **LIGHTNING ROD** | CUBONE, MAROWAK, RHYHORN, RHYDON, ELECTRIKE, MANECTRIC +2 (8) | nothing. Nothing (doubles-only in Gen 3). | Gen 5 rule: ELECTRIC immunity; absorbing gives +1 SP. ATK (once per hand). Co-op: foes' ELECTRIC moves target its player. | +1 SPA | both | 2 |
| **SERENE GRACE** | CHANSEY, TOGEPI, TOGETIC, DUNSPARCE, BLISSEY, JIRACHI +2 (8) | nothing. Nothing. | Added-effect chances x2, except flinching (a 60% flinch per AIR SLASH card would lock foes out). | x2 chance | both | 2 |
| **ILLUMINATE** | STARYU, STARMIE, CHINCHOU, LANTURN, VOLBEAT (5) | nothing. Nothing. | Field: with it in the party, rare finds are twice as likely in wild nodes. | rare x2 | player | 3 |
| **TRACE** | PORYGON, PORYGON2, RALTS, KIRLIA, GARDEVOIR (5) | nothing. Nothing. | On entry, copies the opposing POKéMON's ability until it leaves (not TRACE, FORECAST, MULTITYPE, WONDER GUARD). | - | both | 4 (hard) |
| **MAGNET PULL** | MAGNEMITE, MAGNETON, NOSEPASS, MAGNEZONE, PROBOPASS (5) | nothing. Nothing (WATTSON's rule is only named after it). | Field: STEEL species x3 as likely in wild pools. Foe: a STEEL lead can't run from it. | STEEL x3 | both | 3 |
| **SOUNDPROOF** | VOLTORB, ELECTRODE, MR. MIME, WHISMUR, LOUDRED, EXPLOUD +1 (7) | nothing. Nothing. | Sound moves (GROWL, ROAR, SING, SUPERSONIC, SCREECH, SNORE, UPROAR, METAL SOUND, GRASS WHISTLE, HYPER VOICE, PERISH SONG, BUG BUZZ, CHATTER) have no effect on it. | 13 moves | both | 2 |
| **CACOPHONY** | (none) (0) | nothing. Nothing (no species has it). | Alias of SOUNDPROOF. | - | both | 0 |
| **PRESSURE** | AERODACTYL, ARTICUNO, ZAPDOS, MOLTRES, MEWTWO, RAIKOU +14 (20) | nothing. Nothing (the legendary PRESSURE rule is separate: bosses.js:99). | Foe: you start the battle with 1 fewer discard (once per battle; not on top of the legendary rule). Yours in the lead: the foe can't pick the move it used last turn. | -1 discard | both | 2 |
| **EARLY BIRD** | DODUO, DODRIO, KANGASKHAN, LEDYBA, LEDIAN, NATU +7 (13) | nothing. Nothing. | Sleep lasts half as long, rounded up (1-3 turns -> 1-2). | sleep /2 | both | 2 (situational) |
| **PICKUP** | MEOWTH, AIPOM, TEDDIURSA, PHANPY, ZIGZAGOON, LINOONE +3 (9) | nothing. Nothing. | Field: after each won battle, 10% per PICKUP POKéMON in the party (max 30%) to find a random item (ITEMFINDER's table). | 10%/mon, max 30% | player | 3 |
| **CUTE CHARM** | CLEFAIRY, CLEFABLE, JIGGLYPUFF, WIGGLYTUFF, CLEFFA, IGGLYBUFF +3 (9) | nothing. Nothing. | 30% to infatuate a contact attacker (3 turns, 50% to lose the turn / halve the hand); your cards roll once per hand; bosses, elites and legendaries are immune (as with ATTRACT). | 30% | both | 2 |
| **PLUS** | PLUSLE (1) | nothing. Nothing (doubles-only). | Special cards x1.5 if another party POKéMON (or the co-op partner's lead) has PLUS or MINUS. | x1.5 | player | 1 |
| **MINUS** | MINUN (1) | nothing. Nothing (doubles-only). | As PLUS. | x1.5 | player | 1 |
| **FORECAST** | CASTFORM (1) | nothing. Nothing. | CASTFORM becomes FIRE / WATER / ICE in sun / rain / hail (STAB and defense), NORMAL otherwise. | - | both | 4 |
| **STICKY HOLD** | GRIMER, MUK, GULPIN, SWALOT, SHELLOS, GASTRODON (6) | nothing. Nothing. | Foe: THIEF / COVET steal no money and KNOCK OFF leaves its screens. Yours: bag items used on it in battle have a 20% chance to not be used up. | 20% | both | 2 (stand-in) |
| **MARVEL SCALE** | MILOTIC (1) | nothing. Nothing. | With a status problem, its DEFENSE counts x1.5. | x1.5 DEF | both | 1 |
| **LIQUID OOZE** | TENTACOOL, TENTACRUEL, GULPIN, SWALOT (4) | nothing. Nothing. | Drain heals from it (ABSORB family, DREAM EATER, LEECH SEED) damage the drainer by the same amount instead. | - | both | 2 |
| **ROCK HEAD** | GEODUDE, GRAVELER, GOLEM, ONIX, CUBONE, MAROWAK +12 (18) | nothing. Nothing. | No recoil from RECOIL / DOUBLE-EDGE-type cards (crash damage still applies). | - | both | 2 |

</details>

<details>
<summary>Gen 4 abilities (31): assign them and make them work</summary>

| Ability | Pokémon (count) | Now | Proposed effect | Numbers | Applies to | Batch |
|---|---|---|---|---|---|---|
| **SIMPLE** | BIDOOF*, BIBAREL* (2) | nothing (Gen 4, unassigned). Not in the game. | Every stat change on its side is doubled while it's out. | x2 stages | both | 1 (risk) |
| **UNAWARE** | BIDOOF*, BIBAREL* (2) | nothing (Gen 4, unassigned). Not in the game. | Ignores the other side's stat stages, attacking and defending. | - | both | 1 |
| **RIVALRY** | SHINX*, LUXIO*, LUXRAY* (3) | nothing (Gen 4, unassigned). Not in the game. | No genders here: x1.25 damage against foes that share a type with it (no penalty side). | x1.25 | both | 1 (stand-in) |
| **MOLD BREAKER** | CRANIDOS*, RAMPARDOS* (2) | nothing (Gen 4, unassigned). Not in the game. | Its attacks ignore the target's defensive ability (LEVITATE, WONDER GUARD, absorbs, STURDY, FILTER, SHIELD DUST, BATTLE ARMOR, SOUNDPROOF...). | - | both | 4 |
| **ANTICIPATION** | WORMADAM*, CROAGUNK*, TOXICROAK* (3) | nothing (Gen 4, unassigned). Not in the game. | Intents are already visible, so: yours, when the foe's coming attack is super effective on it, switching is free this turn. Foe: your first super-effective hand against it deals x0.75. | free switch; x0.75 | both | 2 (stand-in) |
| **HONEY GATHER** | COMBEE* (1) | nothing (Gen 4, unassigned). Not in the game. | Field: 20% chance to find a berry after each won battle. | 20% | player | 3 |
| **FLOWER GIFT** | CHERRIM* (1) | nothing (Gen 4, unassigned). Not in the game. | In sun, its team's physical cards x1.5 and it takes 2/3 damage from special moves. | x1.5 | both | 1 |
| **STORM DRAIN** | SHELLOS*, GASTRODON*, FINNEON*, LUMINEON* (4) | nothing (Gen 4, unassigned). Not in the game. | Gen 5 rule: WATER immunity; absorbing gives +1 SP. ATK (once per hand). | +1 SPA | both | 2 |
| **TECHNICIAN** | AMBIPOM* (1) | nothing (Gen 4, unassigned). Not in the game. | Cards of 60 power or less (per hit) deal x1.5. | x1.5 | both | 1 (risk) |
| **AFTERMATH** | DRIFLOON*, DRIFBLIM*, STUNKY*, SKUNTANK* (4) | nothing (Gen 4, unassigned). Not in the game. | Knocked out by a contact move: the attacker loses 1/4 of its max HP (bosses, elites, legendaries 1/10). DAMP stops it. | 25% / 10% | both | 2 |
| **UNBURDEN** | DRIFLOON*, DRIFBLIM* (2) | nothing (Gen 4, unassigned). Not in the game. | Yours: after you use a bag item on your lead in battle, its SPEED x2 until it leaves. Foe: SPEED x2 once below half HP (its "berry"). | x2 SPE | both | 2 (stand-in) |
| **KLUTZ** | BUNEARY*, LOPUNNY* (2) | nothing (Gen 4, unassigned). Not in the game. | Its cards ignore held-item card bonuses (cardPct / cardDmg / cardTimes) but deal x1.5: strong early, a trade-off later. | x1.5 | player (foes hold nothing) | 1 (stand-in) |
| **SUPER LUCK** | HONCHKROW* (1) | nothing (Gen 4, unassigned). Not in the game. | +1 critical-hit stage. | +1 stage | both | 1 |
| **HEATPROOF** | BRONZOR*, BRONZONG* (2) | nothing (Gen 4, unassigned). Not in the game. | FIRE damage x0.5; burn damage halved. | x0.5 | both | 1 |
| **FILTER** | MIME JR.* (1) | nothing (Gen 4, unassigned). Not in the game. | Super-effective damage x0.75. | x0.75 | both | 1 |
| **TANGLED FEET** | CHATOT* (1) | nothing (Gen 4, unassigned). Not in the game. | While confused, attacks on it are x0.5 accurate. | x0.5 acc | both | 1 |
| **STEADFAST** | RIOLU*, LUCARIO*, GALLADE* (3) | nothing (Gen 4, unassigned). Not in the game. | When something makes it flinch, +1 SPEED (yours never flinch here, so a foe's flinch effect speeds your team up). | +1 SPE | both | 2 |
| **SNIPER** | SKORUPI*, DRAPION* (2) | nothing (Gen 4, unassigned). Not in the game. | Critical hits deal one more x (x3; x4 with SCOPE LENS). | +1x crit | both | 1 (risk) |
| **DRY SKIN** | CROAGUNK*, TOXICROAK* (2) | nothing (Gen 4, unassigned). Not in the game. | WATER immunity + 25% heal (once per hand); FIRE x1.25; rain +1/8 per turn, sun -1/8 per turn. | 25%, 1/8 | both | 2 |
| **SNOW WARNING** | SNOVER*, ABOMASNOW* (2) | nothing (Gen 4, unassigned). Not in the game. | Hail for 99 turns on entry (like SAND STREAM). | - | both | 2 |
| **SOLID ROCK** | RHYPERIOR* (1) | nothing (Gen 4, unassigned). Not in the game. | Super-effective damage x0.75. | x0.75 | both | 1 |
| **LEAF GUARD** | TANGROWTH*, LEAFEON* (2) | nothing (Gen 4, unassigned). Not in the game. | No status problems in sun. | - | both | 2 |
| **MOTOR DRIVE** | ELECTIVIRE* (1) | nothing (Gen 4, unassigned). Not in the game. | ELECTRIC immunity; absorbing gives +1 SPEED (once per hand). | +1 SPE | both | 2 |
| **TINTED LENS** | YANMEGA* (1) | nothing (Gen 4, unassigned). Not in the game. | Not-very-effective cards deal x2. | x2 | both | 1 (risk) |
| **SNOW CLOAK** | GLACEON*, MAMOSWINE*, FROSLASS* (3) | nothing (Gen 4, unassigned). Not in the game. | In hail, attacks on it are x0.8 accurate. | x0.8 acc | both | 1 |
| **ADAPTABILITY** | PORYGON-Z* (1) | nothing (Gen 4, unassigned). Not in the game. | STAB x2 instead of x1.5. | x1.33 on STAB | both | 1 (risk) |
| **DOWNLOAD** | PORYGON-Z* (1) | nothing (Gen 4, unassigned). Not in the game. | On entry: +1 ATTACK if the foe's DEFENSE < SP. DEF, else +1 SP. ATK. Yours: once per battle per POKéMON (stages are team-wide here, so re-entry stacking is capped). | +1 stage | both | 2 |
| **SLOW START** | REGIGIGAS* (1) | nothing (Gen 4, unassigned). Not in the game. | Half damage and half SPEED for its first 3 turns out (5 in the games; battles here last ~3-6 turns). | x0.5 for 3 turns | both | 1 |
| **HYDRATION** | PHIONE*, MANAPHY* (2) | nothing (Gen 4, unassigned). Not in the game. | Cures its status at the end of each turn in rain. | - | both | 2 |
| **BAD DREAMS** | DARKRAI* (1) | nothing (Gen 4, unassigned). Not in the game. | A sleeping opponent loses 1/8 max HP per turn (tough foes 1/12, as NIGHTMARE). | 1/8 | both | 2 |
| **MULTITYPE** | ARCEUS* (1) | nothing (Gen 4, unassigned). Not in the game. | No plates here: yours takes the type of your first type-boosting held item (CHARCOAL = FIRE...), a foe ARCEUS takes the type of the move it is about to use. | - | both | 4 (stand-in) |

</details>

<details>
<summary>Already working (42): kept as they are (one tooltip fix)</summary>

| Ability | Pokémon (count) | Now | Proposed effect | Numbers | Applies to | Batch |
|---|---|---|---|---|---|---|
| **DRIZZLE** | KYOGRE (1) | works: `battle.js:420, :429; duo.js:116, :317`. Rain for 99 turns on entry. | Keep. | - | both | - |
| **DROUGHT** | GROUDON (1) | works: `battle.js:421, :430`. Sun for 99 turns on entry. | Keep. | - | both | - |
| **SAND STREAM** | TYRANITAR, HIPPOPOTAS, HIPPOWDON (3) | works: `battle.js:422, :431`. Sandstorm for 99 turns on entry. | Keep. | - | both | - |
| **SPEED BOOST** | YANMA, NINJASK, YANMEGA (3) | works: `battle.js:1469, :1496`. +1 SPEED (team-wide stage) every turn. | Keep. | - | both | - |
| **STURDY** | GEODUDE, GRAVELER, GOLEM, MAGNEMITE, MAGNETON, ONIX +16 (22) | works: `battle.js:952, :1153, :1178`. OHKO immunity; your lead survives a hit from full HP. | Keep. | - | both | - |
| **LIMBER** | PERSIAN, HITMONLEE, DITTO, GLAMEOW (4) | works: `battle.js:1282`. No paralysis. | Keep. | - | both | - |
| **SAND VEIL** | SANDSHREW, SANDSLASH, DIGLETT, DUGTRIO, GLIGAR, CACNEA +5 (11) | works: `battle.js:1044, :1176`. x0.8 accuracy against it in sand. | Keep. | - | both | - |
| **STATIC** | PIKACHU, RAICHU, VOLTORB, ELECTRODE, ELECTABUZZ, PICHU +6 (12) | works: `battle.js:17, :990, :1052, :1160`. 30% PAR on contact (rolled per hit). | Keep (see open question: once per hand). | - | both | - |
| **INSOMNIA** | DROWZEE, HYPNO, HOOTHOOT, NOCTOWL, SPINARAK, ARIADOS +4 (10) | works: `battle.js:1264, :1283`. No sleep. | Keep. | - | both | - |
| **VITAL SPIRIT** | MANKEY, PRIMEAPE, DELIBIRD, VIGOROTH (4) | works: `battle.js:1264, :1283`. No sleep. | Keep. | - | both | - |
| **IMMUNITY** | SNORLAX, ZANGOOSE (2) | works: `battle.js:1279`. No poison. | Keep. | - | both | - |
| **OWN TEMPO** | SLOWPOKE, SLOWBRO, LICKITUNG, SLOWKING, SMEARGLE, SPINDA +5 (11) | works: `battle.js:1305`. No confusion. | Keep. | - | both | - |
| **INTIMIDATE** | EKANS, ARBOK, GROWLITHE, ARCANINE, TAUROS, GYARADOS +14 (20) | works: `battle.js:419, :428; duo.js:112, :322`. -1 foe ATTACK on entry (every re-entry). | Keep; now blocked by OBLIVIOUS / INNER FOCUS. | - | both | - |
| **ROUGH SKIN** | CARVANHA, SHARPEDO (2) | works: `battle.js:1057`. Contact attacker loses 1/16. | Keep. | - | both | - |
| **WONDER GUARD** | SHEDINJA (1) | works: `battle.js:54`. Only super-effective hits land. | Keep (MOLD BREAKER now hits through it). | - | both | - |
| **LEVITATE** | GASTLY, HAUNTER, GENGAR, KOFFING, WEEZING, MISDREAVUS +23 (29) | works: `battle.js:52`. GROUND immunity (Spikes still hit: game-wide simplification). | Keep. | - | both | - |
| **EFFECT SPORE** | PARAS, PARASECT, SHROOMISH, BRELOOM (4) | works: `battle.js:1055`. 10% PSN/PAR/SLP on contact. | Keep. | - | both | - |
| **SYNCHRONIZE** | ABRA, KADABRA, ALAKAZAM, MEW, NATU, XATU +5 (11) | works: `battle.js:1294`. Passes PSN/BRN/PAR back. | Keep. | - | both | - |
| **CLEAR BODY** | TENTACOOL, TENTACRUEL, BELDUM, METANG, METAGROSS, REGIROCK +2 (8) | works: `battle.js:1327`. Foe can't lower its stats. | Keep. | - | both | - |
| **WHITE SMOKE** | TORKOAL (1) | works: `battle.js:1327`. Foe can't lower its stats. | Keep. | - | both | - |
| **NATURAL CURE** | CHANSEY, STARYU, STARMIE, CORSOLA, BLISSEY, CELEBI +7 (13) | works: `battle.js:716`. Cured on switch-out. | Keep (foes never switch out). | - | player | - |
| **SWIFT SWIM** | HORSEA, GOLDEEN, SEAKING, MAGIKARP, OMANYTE, OMASTAR +19 (25) | works: `battle.js:534`. x2 SPEED in rain. | Keep. | - | both | - |
| **CHLOROPHYLL** | ODDISH, GLOOM, VILEPLUME, BELLSPROUT, WEEPINBELL, VICTREEBEL +15 (21) | works: `battle.js:534`. x2 SPEED in sun. | Keep. | - | both | - |
| **HUGE POWER** | MARILL, AZUMARILL, AZURILL (3) | works: `battle.js:331, :590`. x2 ATTACK (physical). | Keep (already live: the biggest existing multiplier). | - | both | - |
| **PURE POWER** | MEDITITE, MEDICHAM (2) | works: `battle.js:331, :590`. x2 ATTACK (physical). | Keep. | - | both | - |
| **POISON POINT** | NIDORAN♀, NIDORINA, NIDOQUEEN, NIDORAN♂, NIDORINO, NIDOKING +5 (11) | works: `battle.js:17, :1052`. 30% PSN on contact. | Keep. | - | both | - |
| **MAGMA ARMOR** | SLUGMA, MAGCARGO, CAMERUPT (3) | works: `battle.js:1281`. No freeze. | Keep. | - | both | - |
| **WATER VEIL** | GOLDEEN, SEAKING, WAILMER, WAILORD (4) | works: `battle.js:1280`. No burn. | Keep. | - | both | - |
| **RAIN DISH** | LOTAD, LOMBRE, LUDICOLO (3) | works: `battle.js:1471, :1498`. +1/16 HP per turn in rain. | Keep. | - | both | - |
| **THICK FAT** | SEEL, DEWGONG, SNORLAX, MARILL, AZUMARILL, MILTANK +10 (16) | works: `battle.js:55`. FIRE / ICE x0.5. | Keep. | - | both | - |
| **FLAME BODY** | MAGMAR, SLUGMA, MAGCARGO, MAGBY, MAGMORTAR (5) | works: `battle.js:17, :1052`. 30% BRN on contact. | Keep. | - | both | - |
| **KEEN EYE** | PIDGEY, PIDGEOTTO, PIDGEOT, SPEAROW, FEAROW, FARFETCH'D +12 (18) | works: `battle.js:1328`. Accuracy can't be lowered. | Keep. | - | both | - |
| **HYPER CUTTER** | KRABBY, KINGLER, PINSIR, GLIGAR, CORPHISH, CRAWDAUNT +3 (9) | works: `battle.js:1329`. ATTACK can't be lowered. | Keep. | - | both | - |
| **TRUANT** | SLAKOTH, SLAKING (2) | works: `battle.js:302, :1088`. Acts every other turn. | Keep. | - | both | - |
| **SHED SKIN** | METAPOD, KAKUNA, EKANS, ARBOK, DRATINI, DRAGONAIR +6 (12) | works: `battle.js:1470, :1497`. 30% status cure per turn. | Keep. | - | both | - |
| **OVERGROW** | BULBASAUR, IVYSAUR, VENUSAUR, CHIKORITA, BAYLEEF, MEGANIUM +6 (12) | works: `battle.js:353, :592`. GRASS x1.5 at 1/3 HP. | Keep. | - | both | - |
| **BLAZE** | CHARMANDER, CHARMELEON, CHARIZARD, CYNDAQUIL, QUILAVA, TYPHLOSION +6 (12) | works: `battle.js:353, :592`. FIRE x1.5 at 1/3 HP. | Keep. | - | both | - |
| **TORRENT** | SQUIRTLE, WARTORTLE, BLASTOISE, TOTODILE, CROCONAW, FERALIGATR +6 (12) | works: `battle.js:353, :592`. WATER x1.5 at 1/3 HP. | Keep. | - | both | - |
| **SWARM** | BEEDRILL, SCYTHER, LEDYBA, LEDIAN, SPINARAK, ARIADOS +6 (12) | works: `battle.js:353, :592`. BUG x1.5 at 1/3 HP. | Keep. | - | both | - |
| **COMPOUND EYES** | BUTTERFREE, VENONAT, YANMA, NINCADA (4) | works: `battle.js:1042, :1177`. x1.3 accuracy. | Keep. | - | both | - |
| **SHIELD DUST** | CATERPIE, WEEDLE, VENOMOTH, WURMPLE, DUSTOX (5) | works: `battle.js:989, :1165`. Blocks added effects, both sides. | Keep; fix the tooltip, which wrongly says "No effect for your POKéMON". | text only | both | 0 |
| **RUN AWAY** | RATTATA, RATICATE, PONYTA, RAPIDASH, DODUO, DODRIO +9 (15) | works: `battle.js:1583`. Lead always escapes wild battles. | Keep (foes never flee). | - | player | - |

</details>

## Hard ones and their simpler stand-ins

| Ability | Why it's hard here | Proposal | Simpler fallback |
|---|---|---|---|
| TRACE | the ability is derived from species + IV, so a copy needs battle state | `sides.player.traced = {uid, ability}`, foe: overwrite `e.ability` on send-out; one lookup `abOf()` everywhere | copy the foe's ability only for damage multipliers |
| COLOR CHANGE / FORECAST / MULTITYPE | your types come from `typesOf(mon)` everywhere (STAB, matchups) | `ptypes()` override in the battle; foes mutate their battle-only `types` | FORECAST: just give CASTFORM's cards STAB of the weather type |
| MOLD BREAKER | ~40 defensive checks read the defender's ability directly | `defAb(side, mon, attackerAb)` returns null for breakable abilities | only bypass immunities (LEVITATE, absorbs, WONDER GUARD, SOUNDPROOF) |
| CLOUD NINE / AIR LOCK | weather is read in ~15 places | `wx()` effective weather; the timer still runs | only cancel weather damage multipliers and chip |
| RIVALRY | no genders | x1.25 vs foes sharing a type | x1.25 vs the same evolution family |
| ANTICIPATION | intents are already visible | free switch when the coming attack is super effective | +1 EVASION on such turns |
| PRESSURE | no PP: copies come from PP | foe: -1 discard; yours: foe can't repeat its last move | foe only |
| STICKY HOLD / KLUTZ / UNBURDEN | held items are team-wide relics, never stolen or used up | bag-item save chance / no item bonus but x1.5 / SPEED x2 after a bag item | text-only flavor with a small stat |
| SUCTION CUPS | foes never ROAR | foe: ROAR fails; yours: immune to card freeze / face-down rules | foe only |
| PLUS / MINUS | doubles-only; PLUSLE and MINUN only | party partner (and the co-op partner's lead) counts | co-op only |

## Balance
**Setup:** `tests/balance.mjs --spire --rotate --runs 100` (the smart bot, KANTO + HOENN spire), seeds `ABA`-`ABX`, run 4 processes at a time (about 125 MB each). Baseline = prod main as of v0.4.6 (`fd85d5e`), run read-only from the prod checkout. v0.4.7, which landed meanwhile, changed only UI. Prototype = `abilities` @ `b98cb3e`. The bot gets the PICKUP / HONEY GATHER rewards. It doesn't exploit the free ANTICIPATION switch, DAMP or the trap tax.

| | Baseline v0.4.6 | Prototype | Δ |
|---|---|---|---|
| **A0 win rate** (2,400 runs each) | **17.2%** ±0.8 | **16.5%** ±0.8 | -0.7 pp (±1.1: not significant) |
| A4 win rate (800 runs each) | 2.0% ±0.5 | 2.6% ±0.6 | +0.6 pp (not significant) |
| Runs ending in act 1 | 53.7% | 54.2% | +0.5 pp |
| A1 trainer: HP lost / loss rate | 11% / 3.2% | 11% / 3.4% | ≈ |
| A1 elite | 26% / 13.3% | 27% / 13.7% | ≈ |
| A1 gym boss | 39% / 26.0% | 39% / 26.1% | ≈ |
| A2 gym boss | 21% / 8.1% | 20% / 7.1% | slightly easier |
| A3 gym boss | 23% / 8.0% | 24% / 10.1% | slightly harder (small n) |

**Reading:** overall it's neutral. The foe-side additions (absorb heals, PRESSURE's discard, FILTER / SOLID ROCK, GUTS / HUSTLE parity, the trap tax) roughly cancel the player-side multipliers. Most new effects sit on POKéMON few runs carry. Share of prototype runs holding each at the end: PICKUP 23%, SIMPLE / UNAWARE (BIDOOF line) 11%, TRACE 11%, SHELL ARMOR 7%, ROCK HEAD 6%, EARLY BIRD 6%, CUTE CHARM and RIVALRY 5%. TECHNICIAN, ADAPTABILITY, TINTED LENS, SNIPER and KLUTZ are at 1% or less (late, rare Gen 4 catches), so **a whole-run A/B can't see the rare but strong ones**. Runs with a BIDOOF line won 13.7% → 14.0%, runs with a PICKUP POKéMON 17.0% → 18.2% (noise-level).

| Ability | Why it could move win rates | Suggested cap |
|---|---|---|
| HUGE POWER / PURE POWER (already live) | x2 physical: the biggest multiplier in the game today (AZURILL line, MEDITITE line) | none proposed; for reference |
| WONDER GUARD (already live) | your SHEDINJA ignores everything not super effective | MOLD BREAKER now breaks it (both ways) |
| ADAPTABILITY (PORYGON-Z) | +33% on every STAB card, which is most of a deck | x1.75 STAB if it overperforms |
| TECHNICIAN (AMBIPOM) | x1.5 on all cards of 60 power or less: most early decks and multi-hit cards | base power only (not POWER_FN results), no multi-hit |
| SNIPER + SUPER LUCK + SCOPE LENS | crits at stage +2 deal x4 | cap the crit multiplier at x3 |
| SIMPLE (BIDOOF / BIBAREL, a common early catch) | stat cards doubled, and your stages are team-wide and persist: a +4 "booster lead" | extra stages only while it leads, or clamp at ±4 |
| SERENE GRACE | 2-3 AIR SLASH / IRON HEAD cards at 60% each would flinch-lock even bosses | flinch excluded (in the prototype) |
| KLUTZ | x1.5 is strong before you have items | fine: it falls off as items stack up |
| PRESSURE (foe) | -1 of your 2 discards against 20 species, some of them regular trainer POKéMON | once per battle (prototype); maybe elites / legendaries only |
| Absorbs (foe) | 25% heal when you play the wrong type | once per hand; bosses 15%; the card already shows "blocked" |
| DOWNLOAD / INTIMIDATE | entry stages could stack by switching in and out | DOWNLOAD once per battle (prototype); INTIMIDATE already re-fires today |
| BAD DREAMS / SLOW START | DARKRAI and REGIGIGAS as legendary elites get harder / easier | tough-foe fraction 1/12; SLOW START 3 turns, not 5 |

Before shipping: add a bot flag that forces a team member (e.g. `--givemon PORYGON_Z`) and A/B the four multiplier risks (ADAPTABILITY, TECHNICIAN, SNIPER, SIMPLE) one at a time.

## Implementation plan
Ship as **one logic release (v0.5.0)**. Every release that changes logic needs its own LOGIC_ID and frozen engine, so splitting the batches across releases means freezing a copy each time. Each batch still lands as its own commit with its own A/B.
- [ ] **Batch 0: plumbing and save safety** (no balance effect on its own)
  - `web/src/game/abilities.js` (new): tables (sound moves, absorbs, TRACE bans, MOLD BREAKER list, plates), `partyAbilityMods`, Gen 4 ability names, `ABILITY_TEXT` for all 108, `LEGACY_GEN4_ABILITIES`
  - `battle.js`: one lookup (`abOf` / `pab` / `defAb`), `ptypes`, `wx`; replaces the 32 direct `abilityOf()` / `enemy.ability` reads
  - `gen4.js applyGen4`: the species use `gen4Abilities` (LIGHTNINGROD → LIGHTNING_ROD). `data.js`: Gen 4 entries in `D.abilities`; `ABILITY_TEXT` replaces the "No effect" overrides
  - **Solo saves:** `run.abilityRules` (set by `Run.create`). `Run.upgradeJSON` pins `mon.ability` for old saves' Gen 4 mons from the v0.4.6 lists, so no caught SHINX turns from INTIMIDATE into RIVALRY. Update `tests/saves.test.mjs` (the v0.3.5 fixture test strips the new field)
  - **Co-op saves:** `LOGIC_ID = 'v050'` in `coop/engines.js`; freeze v0.4.0-v0.4.6 as `web/src/legacy/v040/` (byte-for-byte copies of the 24 game files co-op imports, plus `engine.js`) and add `v040` to `FROZEN`. Update the engines test and add a frozen-v040 replay test. Checkpoint rooms load as usual; mid-node rooms replay on v040
- [ ] **Batch 1: multipliers (23)**: `hitCore`, `hitDamage`, `enemyDamage`, `effectiveness`, `speedOf`, both accuracy rolls, crit roll in `scoreHand` / `enemyStrike`
- [ ] **Batch 2: triggers (29)**: `battle.js` (send-out / `leadAbilityEnter`, `chooseIntent`, `pickEnemyMove`, `switchLead`, `useItem`, `resolveHand`, `scoreHand`, `contactAbility`, `enemyStrike`, status / stage / flinch hooks, residuals), `effects.js` (`chance`, ABSORB, DREAM EATER, RECOIL, DOUBLE-EDGE, THIEF, KNOCK OFF, ATTRACT, ROAR), `bosses.js` (card freezing rules), `coop/duo.js` (entry hooks)
- [ ] **Batch 3: field and run (6)**: `abilities.js partyAbilityMods` folded into `Run.mods()`, `run.js wildConfig` weights, `scenes/reward.js` (used by co-op too), `battle.js` catch / flee / switch tax, `tests/bot.mjs` mirror
- [ ] **Batch 4: complex (7)**: CLOUD NINE / AIR LOCK, COLOR CHANGE, FORECAST, MULTITYPE, TRACE, MOLD BREAKER
- [ ] **Test bar per batch:** `logic`, `coop`, `saves`, `gen4` and the new `tests/abilities.test.mjs`; `balance.mjs --rotate --spire`, 4 seeds at a time on this PC; one muted browser pass over tooltips, POKéDEX and a DAMP / absorb card
- [ ] **Not in the prototype yet:** co-op LIGHTNING ROD / STORM DRAIN redirect, PLUS / MINUS counting the partner's lead, MOLD BREAKER vs status immunities, the switch button showing the trap tax or the ANTICIPATION free switch, bot awareness of the new rules

## UI: tooltips, POKéDEX, patch notes
- **Tooltips already read `D.abilities[k].desc` everywhere**: the foe tooltip (scenes/battle.js:866-869, coop battle :1439-1446), the party tooltip (scenes/common.js:552-554) and the POKéDEX (scenes/dex.js:290-300). Replacing the text table updates all of them. Each line says exactly what the ability does here (table above), and "No effect in battle here." disappears.
- **Card faces:** a card blocked by the foe's ability already shows "The foe's X blocks TYPE moves: x0.", which covers the new immunities. The new unplayable reason `DAMP` shows through the generic reason label.
- **Battle log:** each trigger writes a line ("Wild VOLTORB's SOUNDPROOF blocks it!", "PSYDUCK TRACED the foe's INTIMIDATE!", "(-1 discard)"). An optional cosmetic `{t:'ability'}` event could drive an ability banner like the games' (the animation layer only).
- **Rewards:** "PICKUP found: <item>" and "HONEY GATHER: <berry>" lines, like ITEMFINDER's.
- **Switch button:** should show "+1 discard" under ARENA TRAP / SHADOW TAG and "free" under ANTICIPATION (prototype: logic only).
- **POKéDEX:** Gen 4 species list their HGSS abilities ("ABILITIES (one of)").
- **Patch notes draft (v0.5.0):**
  - "Every ability now does something. 27 abilities that did nothing, 8 that half worked and all 31 Gen 4 abilities have effects, and every tooltip says exactly what they do."
  - "Gen 4 POKéMON have their HeartGold abilities (BIDOOF: SIMPLE / UNAWARE, PORYGON-Z: ADAPTABILITY / DOWNLOAD, DARKRAI: BAD DREAMS...). POKéMON you already caught keep theirs."
  - "Field abilities: PICKUP finds items, HONEY GATHER berries, ILLUMINATE makes rare finds twice as common, MAGNET PULL draws STEEL POKéMON; ARENA TRAP and SHADOW TAG in the lead make catching easier."
  - "Foes use their abilities too: absorbs heal them, PRESSURE costs you a discard, ARENA TRAP / SHADOW TAG make switching cost a discard."

## Open questions for you
1. **One release or staged?** One LOGIC_ID bump (v0.5.0) is simplest. Staging means freezing an engine per stage.
2. **Existing contact abilities roll per hit.** A 3-contact-card hand into a foe with STATIC paralyzes your lead 66% of the time (1 - 0.7³). Move STATIC / FLAME BODY / POISON POINT / EFFECT SPORE to once per hand, like the new ones? (Not in the prototype, to keep the A/B clean.)
3. **Gen 4 second abilities:** 25 species that already had one get their HGSS second slot, so about half of new catches roll it (SHINX: RIVALRY or INTIMIDATE). Old saves are pinned. OK?
4. **Stand-ins:** RIVALRY (shared type), ANTICIPATION (free switch), KLUTZ (no item bonuses, x1.5), STICKY HOLD (20% bag-item save), SUCTION CUPS (anti-freeze), UNBURDEN, MULTITYPE (type boosters as plates), ARENA TRAP / SHADOW TAG catch bonus. Keep or swap?
5. **PRESSURE on regular foes** (ABSOL, DUSCLOPS, AERODACTYL appear in trainer teams): -1 discard per battle. Too punishing?
6. **Player flinch:** foes' flinch moves do nothing to you today, and neither does foe TAUNT. That keeps foe STENCH and your STEADFAST / INNER FOCUS one-sided. Make flinch real for players (e.g. one card ICED)?
7. **Foe AI** ignores abilities when picking moves (it fires GROUND at LEVITATE today). With LIGHTNING ROD / STORM DRAIN / MOTOR DRIVE, that hands you free boosts. Teach `pickEnemyMove` to use `effectiveness()`?
8. **HGSS gave ~30 Gen 1-3 species a Gen 4 second ability** (MACHAMP NO GUARD, CLEFABLE MAGIC GUARD, SCIZOR TECHNICIAN...). Those abilities (NO GUARD, MAGIC GUARD, SKILL LINK, IRON FIST, RECKLESS, QUICK FEET, SCRAPPY, POISON HEAL, ICE BODY...) aren't in the extracted data. Add them in a follow-up?

<details>
<summary>Appendix: prototype commits, files and tests</summary>

- Branch `abilities` (worktree E:/BigData/games/firered-roguelike-abilities, based on v0.4.6 `fd85d5e`): `b98cb3e` prototype code, plus a docs commit for this file. Local only: not pushed, not merged.
- Code: web/src/game/abilities.js (new, 196 lines), battle.js (+~280), effects.js, run.js, data.js, gen4.js, bosses.js, coop/duo.js, coop/engines.js, scenes/reward.js, tests/bot.mjs; web/src/legacy/v040/ (25 frozen files, byte-identical to main's blobs).
- Tests (all pass): logic 145/145, coop 59/59, gen4 17/17, saves 27/27 (two updated: the v0.3.5 fixture test strips run.abilityRules; the engines test expects v050, plus a new frozen-v040 replay test), abilities 17/17 (new: text for all, HGSS lists, save pinning, TECHNICIAN / ADAPTABILITY / TINTED LENS math, absorbs, MOLD BREAKER, SOUNDPROOF, DAMP, BATTLE ARMOR, PRESSURE, SNOW WARNING, CLOUD NINE, TRACE, SIMPLE, INTIMIDATE immunity, field mods, ARENA TRAP catch).
- Not done: no browser pass (the text flows through existing tooltips); rebasing onto v0.4.7 (UI-only changes) would also need version.js re-copied into legacy/v040.

</details>
