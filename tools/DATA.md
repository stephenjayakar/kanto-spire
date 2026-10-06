# Kanto Spire game data

`node tools/extract_data.js` parses the pret/pokefirered decomp in `pokefirered/` (C headers and JSON) and writes
the files below to `web/assets/data/`. It needs Node 22 and no npm packages. After writing the files it runs
verification checks: spot checks, cross-references, and existence of every referenced sprite, palette and cry
file. If any check fails it exits with code 1. Pass `--no-verify` to skip the checks.

The parser evaluates `#if/#ifdef` for the **FireRed** build (`FIRERED`, rev 0, English). So Deoxys uses its
Attack-forme sprite, dex text comes from `pokedex_text_fr.h`, and only `_FireRed` wild encounter tables are read.

## Conventions
- Every file is a keyed object. A key is the C constant with its prefix removed: `SPECIES_BULBASAUR` becomes
  `BULBASAUR`, `MOVE_VINE_WHIP` becomes `VINE_WHIP`, `ITEM_TM06` becomes `TM06`, `TRAINER_LEADER_BROCK` becomes
  `LEADER_BROCK`, and `MAP_ROUTE1` stays `MAP_ROUTE1` (map keys keep their prefix).
- `id` is the numeric value of the constant in the game. `name` is the in-game display text (e.g. `"POKé BALL"`,
  `"NIDORAN♀"`, `"KARATE CHOP"`).
- In text fields, the line breaks `\n`, `\l` and `\p` become single spaces, and `{PKMN}` becomes `PKMN`.
- Graphics paths are relative to `pokefirered/graphics/<category>/` and point at committed source files (`.png`
  and `.pal`), not build artefacts.

## species.json (386 entries)
`{ id, dex, name, types[1-2], stats{hp,atk,def,spa,spd,spe}, evYield{...}, catchRate, expYield, growthRate,
abilities[], genderRatio, eggGroups[], eggCycles, friendship, wildItems{common,rare}, safariZoneFleeRate,
bodyColor, evolutions[{method,param,into}], preEvolution, learnset[[lvl,move]], tmhm[move], tmhmItems[item],
tutor[move], eggMoves[move], category, dexText, height, weight, gfx, sprites{front,back,icon,pal,shinyPal,
footprint,iconPal,frame}, cryId, cry }`
- `id` is the internal species number. Hoenn mons start at 277 because of the 25 OLD_UNOWN placeholders, which
  are excluded along with NONE and EGG. `dex` is the national dex number (Treecko: id 277, dex 252).
- `genderRatio`: 0 = always male, 254 = always female, 255 = genderless, otherwise `PERCENT_FEMALE(x)`
  truncated (12.5% = 31, 50% = 127).
- `evolutions[].method` is `EVO_*` without the prefix: `LEVEL`, `ITEM`, `TRADE`, `TRADE_ITEM`, `FRIENDSHIP`,
  `FRIENDSHIP_DAY`, `FRIENDSHIP_NIGHT`, `LEVEL_ATK_GT_DEF/EQ/LT`, `LEVEL_SILCOON/CASCOON`,
  `LEVEL_NINJASK/SHEDINJA`, `BEAUTY`. `param` is a level or number, an item key for ITEM and TRADE_ITEM, or
  `null` for trade and friendship evolutions.
- `preEvolution` is reverse-derived from the evolution table (Shedinja's is Nincada).
- `tmhm` holds the move keys of the TMs and HMs the species can learn. `tmhmItems` lists the matching items.json
  keys (`TM06`, `HM01`) in the same order.
- `eggMoves` is only filled on the species listed in `egg_moves.h`, which are the base forms.
- `height` is in decimetres and `weight` in hectograms, as stored in the game.
- `gfx` is the directory (under `graphics/pokemon/`) that holds the front sprite. It is resolved through
  front_pic_table, the incbin path, and `graphics_file_rules.mk`. It is a plain folder name except for
  `unown/a` and `castform/normal`, whose sprites are in subfolders.
- `sprites.*` are exact file paths under `graphics/pokemon/`. `iconPal` is an index 0-2 into
  `graphics/pokemon/icon_palettes/icon_palette_N.pal`. `sprites.frame` says which 64x64 frame of
  `front.png` and `back.png` to draw. It is 0 for every species except Deoxys, whose 64x128 sheet stacks
  Normal over Attack; the game shows frame 1 (Attack). Icons are 32x64 with two frames.
- `cryId` is the index into `gCryTable`. That is species-1 for Gen 1-2, and comes from `cry_ids.h` (the
  `CRY_*` enum) for Hoenn mons. `cry` is the sample basename under `sound/direct_sound_samples/cries/`
  (`.wav`).

## moves.json (354 entries)
`{ id, name, effect, power, type, accuracy, pp, chance, target, priority, flags[], desc }`. `effect`, `target`
and `flags` have their `EFFECT_`, `MOVE_TARGET_` and `FLAG_` prefixes removed. Curse has type `MYSTERY` (???).

## types.json
`{ list[17], names{TYPE: display}, chart{ATK:{DEF:mult}}, foresightIgnored[[atk,def]] }`
- `chart` contains only the non-1x entries (2, 0.5 or 0) from `gTypeEffectiveness`.
- The entries that come after the `TYPE_FORESIGHT` marker (Normal or Fighting into Ghost = 0) are included in
  `chart` because they apply normally. They are also listed in `foresightIgnored`, since Foresight and
  Odor Sleuth remove them.
- MYSTERY is excluded from `list`.

## items.json (307 entries)
`{ id, name, price, desc, pocket, holdEffect, holdEffectParam, importance, type, battleUsage, secondaryId,
icon, iconPal, move? }`
- The 67 placeholder items named `????????` and ITEM_NONE are excluded.
- `icon` is the basename of `graphics/items/icons/<icon>.png` and `iconPal` the basename of
  `graphics/items/icon_palettes/<iconPal>.pal`. Both are resolved through `item_icon_table.h` and the incbin
  paths in `src/data/graphics/items.h`. All TMs and HMs share the icon `tm_hm` and use a palette for their type.
- `move` is only present on TMs and HMs and holds the move they teach.
- `pocket` is one of `ITEMS`, `POKE_BALLS`, `KEY_ITEMS`, `TM_CASE` or `BERRY_POUCH`.

## trainers.json (742 entries: 639 real, 103 dummy)
`{ id, class, className, name, pic, picPal, trainerPic, music, female, encounterSong, battleSong, double,
items[], aiFlags[], party[{species, level, iv, moves|null, item|null}], dummy, maps[], rematchOf }`
- `pic` is the basename of `graphics/trainers/front_pics/<pic>_front_pic.png`. `picPal` is the basename of
  `graphics/trainers/palettes/<picPal>.pal`.
- `music` is `TRAINER_ENCOUNTER_MUSIC_*` without the prefix. `female` is true when `F_TRAINER_FEMALE` is set.
- `encounterSong` is the song that actually plays when the trainer spots you (`MUS_ENCOUNTER_BOY`, `_GIRL` or
  `_ROCKET`), taken from `PlayTrainerEncounterMusic`. `battleSong` is the battle song for the trainer's class,
  taken from `GetBattleBGM`.
- `iv` is the raw 0-255 trainer IV value. The game converts it with `iv*31/255`.
- `moves: null` means the mon uses its default level-up moves.
- `dummy: true` marks a trainer whose party is only `DUMMY_TRAINER_MON*` placeholders. These are the RS
  carry-overs: Hoenn leaders and E4, Aqua and Magma, Brendan and May. Filter them out in the game.
- `maps` lists the MAP_ ids found from three sources:
  - `trainerbattle*` lines in each map's scripts;
  - `data/scripts/trainers.inc`, attributed by the enclosing script label (through map.json object_events and
    the label prefix);
  - the VS Seeker rematch table in `src/vs_seeker.c`.
- `rematchOf` is set on VS Seeker rematch tiers and names the base trainer.
- 35 real trainers have `maps: []` because nothing in the game references them (Channeler_1-8, Burglar_1-4,
  several Cooltrainers, and others).

## trainer_classes.json (107 entries)
`{ id, name, money, moneyListed, battleSong }`
- `money` comes from `gTrainerMoneyTable`. Classes missing from that table get its terminator default of 5,
  and those entries have `moneyListed: false`.
- The prize the game pays is `4 * lastMonLevel * money`, doubled in double battles.

## encounters.json (124 maps)
`{ name, rates{land,water,rock,fishing}, land[], water[], rock[], fishing[] }`
- Each slot is `{species, min, max, rate}`. Fishing slots also have `rod` (`old`, `good` or `super`), and their
  `rate` is the weight within that rod's group.
- `rates` holds the per-map encounter rates.
- Only `_FireRed` (or unsuffixed) tables are used. `_LeafGreen` tables are skipped.

## abilities.json (77 entries)
`{ id, name, desc }`. ABILITY_NONE is excluded.

## maps.json (425 entries)
`{ name, folder, regionMapSection, music, mapType, battleScene, weather, layout, floor, group, num,
connections[{direction, offset, map}] }`
- `name` is the display name of the region map section (`"ROUTE 1"`, `"PEWTER CITY"`). Interiors share their
  town's name.
- `music` is the `MUS_*` constant.
- `folder` is the directory under `pokefirered/data/maps/`.
