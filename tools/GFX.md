# Kanto Spire graphics pipeline (`tools/extract_gfx.py`)

This script turns the graphics in the pret/pokefirered decomp (`pokefirered/graphics`) into RGBA PNGs a browser can load directly. It writes them to `web/assets/gfx/`, along with `web/assets/gfx/manifest.json`.

```
python tools/extract_gfx.py                  # full clean rebuild (~1 min); wipes web/assets/gfx first
python tools/extract_gfx.py pokemon items    # re-run some sections; other manifest entries are kept
python tools/extract_gfx.py --verify         # also write contact sheets to tools/gfx_verify/
```

The sections are `pokemon trainers items terrain overworld field_effects fonts ui_sprites screens`.

## General rules

- **Colours are quantised to what the GBA displays.** Each 8-bit `.pal` value is reduced to BGR555 and expanded back with `(c5<<3)|(c5>>2)`, so `205` becomes `206` and `255` stays `255`.
- **Which palette is used:**
  - If `X.pal` exists, it is used, as the Makefile does (`%.gbapal: %.pal`).
  - Otherwise the PNG's embedded PLTE is used (`%.gbapal: %.png`).
  - For Pokémon sprites, `normal.pal` and `shiny.pal` always win over the embedded palette. 87 back sprites and 2 fronts (manectric, ursaring) carry a stale embedded palette. They are listed in `manifest.groups.pokemonPaletteCheck`.
- **Transparency:**
  - Sprites (OBJ): palette index 0 is fully transparent.
  - BG layers are rendered with index 0 transparent unless the layer is the bottom-most one. Bottom layers are opaque, with the backdrop colour where it applies.
- **4bpp handling:** gbagfx keeps only the low nibble of each pixel. For 8-bit PNGs, the high nibble only records which palette bank the artist previewed. The renderer follows the same rule: tile pixel `& 15`, then the tilemap entry's palette bank. 8bpp layers (the title logo, Oak's pictures) use the raw value as the colour index.
- **Tilemaps:** each entry is u16 (tile `&0x3FF`, hflip `0x400`, vflip `0x800`, bank `>>12`). Maps with screenSize 1 or 2 are stored as 32x32 screenblocks and converted to a linear layout. 1200-byte maps are 30 tiles wide; 1280- and 2048-byte maps are 32 wide.
- **Recipes:** every layer recipe (tiles, map, palette slot, layer order, scroll) comes from the C source. The file and line references are in the per-screen comments inside the script.

## Output layout and notes

| Path | Contents / notes |
|---|---|
| `pokemon/<name>/front.png, back.png, front_shiny.png, back_shiny.png` | 64x64. There is one folder per `graphics/pokemon` folder, plus flattened forms. |
| `pokemon/<name>/icon.png` | 32x64, two 32x32 frames stacked vertically. The palette is one of the 3 shared `icon_palettes`. The choice comes from `gMonIconPaletteIndices`, matched through `gMonIconTable` and the INCBIN paths, and is stored as `iconPalette` in the manifest. |
| `pokemon/<name>/footprint.png` | 16x16, dark-brown ink on transparent. |
| Unown | `unown_a` … `unown_z`, `unown_exclamation_mark`, `unown_question_mark`, all using the shared unown palettes. `unown` is a copy of A. |
| Castform | `castform` is the Normal form; `castform_sunny`, `castform_rainy` and `castform_snowy` use their own palettes. All share one icon. |
| Deoxys | Each source sheet is 64x128: the top half is the Normal Forme, the bottom half is Attack (`front.png`) or Defense (`front_def.png`). `deoxys` is the **Attack Forme**, which is what FireRed shows (`DuplicateDeoxysTiles`), with `icon_attack`. `deoxys_normal` and `deoxys_defense` are the other forms. |
| Others | `egg` (front + icon only), `ghost` (the Pokémon Tower ghost, embedded palette), `question_mark_circled` / `_double` (the `SPECIES_NONE` / old-Unown placeholders), `question_mark` (icon only). `heracross/unk_icon.png` is skipped. |
| `manifest.groups.pokemonSpecies` | `SPECIES_*` → output folder name, taken from `gMonFrontPicTable`. |
| `trainers/<name>.png` | 64x64. `_front_pic` is stripped from the name. The palette comes from `gTrainerFrontPicTable` + `gTrainerFrontPicPaletteTable` joined on the TRAINER_PIC id; every pic maps to exactly one palette (e.g. `leader_brock` → `leader_brock.pal`). The manifest records `picIds`. |
| `trainers/back/<name>.png` | 64xN vertical strips of 64x64 frames: red and leaf have 5 frames, the others 4. Palettes come from `gTrainerBackPicPaletteTable`. |
| `items/<item_key>.png` | One 24x24 file per `ITEM_*` constant (`item_icon_table.h` + `items.h`), named lowercase without the `ITEM_` prefix: `potion`, `super_potion`, `fire_stone`, `tm01` … `tm50`, `hm01` … `hm08`, `tm_case`. TMs are coloured with their type palette. Unused slots (`ITEM_034` etc., which only show the "?" icon) are skipped; `none.png` is the "?" icon. |
| `items/icons/<icon>.png` | Every icon sheet under its own name, coloured with the palette of the same name, or with the first palette any item pairs it with. |
| `terrain/<name>.png` | 240x160 battle backgrounds: BG3 = terrain tiles + 64x32 map with the palette in slots 2–4, viewed at scroll (0,0). The outdoor ones are `grass longgrass sand underwater water pond mountain cave building`. The indoor tileset gets one render per palette: `indoor_plain gym leader 1 2 lorelei bruno agatha lance champion link`. |
| `terrain/with_textbox/<name>.png` | The same, with the battle message box (BG0) on top, as the game shows it. |
| `terrain/entry/<name>.png` | 256x112 BG1 "entry" layer: the grass, water or rock sweep that slides in when a battle starts. |
| `overworld/{people,pokemon,misc}/<name>.png` | Object-event sheets with frames laid out horizontally. Frame size and palette come from `gObjectEventGraphicsInfo_*` (`.width`, `.height`, `.paletteTag` → `sObjectEventSpritePalettes`). The manifest records `frameW`, `frameH`, `frames`, `palette` and `graphicsInfo`. Most people are 16x32 with 9 frames (down, up, left ×3 walk frames; mirror left for right). Bikes are 32x32. Small Pokémon are 16x16. `surf_blob`, `red_surf` and `green_surf` are 32x32 with the player palette. |
| `misc/field_effects/<name>.png` | Tall grass, shadows, splashes, sparkles, etc., with frame sizes from `field_effect_objects.h`. Templates that have no palette borrow a fixed OBJ slot: shadows, arrow, bird and surf blob use the player palette; sparkle uses npc_white; the tree/mountain/sand disguises use npc_green/pink/blue. In game the shadows are drawn semi-transparent. |
| `fonts/` | See below. |
| `ui/types/<TYPE>.png` | 32x12 type labels (NORMAL … DARK, plus MYSTERY = "???"), sliced from `menu_info.png` with `sMenuInfoIcons`. Colours: indices below 16 use `dex_caught_pokeball.pal`, 16 and above use `pokemon_types.pal`. |
| `ui/menu_info/` | `type`, `power`, `accuracy`, `pp` and `effect` labels (40x12), the `caught` ball, and the full sheet. FRLG has no contest-category icons. |
| `ui/status/<psn,par,slp,frz,brn,pkrs,fnt>.png` | 32x8 party-menu status icons. `ui/summary/status_ailment_icons.png` is the summary-screen copy. |
| `ui/battle/` | Healthboxes (`healthbox_singles_player/opponent`, `doubles_*`, `safari`), rebuilt from their 1D OBJ tile order and trimmed. The bar artwork is left empty, as in the game. Also `hp_label`, `hpbar_{green,yellow,red}_full`, `hpbar_empty`, and `hpbar_*_strip` (9 frames: an 8px tile with 0–8 px filled). `expbar_strip`, `status_{psn,…}` (24x8 in-battle icons), `ball_{ok,empty,status,fainted,caught}` (party-summary balls), `party_summary_bar`, `level_up_banner` and `enemy_mon_shadow`. `textbox.png` is the 240x48 message box; `message_box_full`, `action_menu` and `move_menu` are the 240x160 BG0 at VOFS 0/160/320, with the type1 frame swapped in, as `LoadBattleMenuWindowGfx` does. |
| `ui/balls/<ball>.png` | 16x48 = closed / half-open / open frames. `ball_open` is pasted over the open frame for every ball except dive, luxury and premier, matching `pokeball.c`. |
| `ui/text_window/` | `std.png` and `type1` … `type10.png` are 24x24 9-slice frames: 8px borders with the centre filled in palette index 1. `*_tiles.png` are the raw tiles. `dialogue_box.png` is the 240x48 field message box; `dialogue_9slice.png` is a 48x48 9-slice of it with 16px insets. `signpost_box.png` is the signpost version. |
| `ui/cursors/` | `red_arrow` (list cursor), `scroll_{left,right,up,down}`, `text_advance_arrow` (4 frames of 10x12) plus a dark variant, the down-arrows sheet, and selector-outline tiles. |
| `ui/party/` | `bg.png` (240x160), slot boxes `slot_main_*` (80x56) and `slot_wide_*` (144x24) in the normal, selected, fainted and switching colours (recoloured as `LoadPartyBoxPalette` does), plus pokeball and hold-item icons. `ui/screens/party_menu_example.png` shows them assembled. |
| `ui/summary/page_*.png` | Info, skills, moves, move detail and egg pages, plus a shiny-tinted info page. |
| `ui/bag/` | `bg_{male,female,item_pc}.png`, and the bag sprites `bag_{male,female}.png` (64x64 frames, one per pocket). |
| `ui/shop/` | `shop_frame(_tm).png`. It is transparent where the game shows the live map. |
| `ui/pokedex/` | Entry-page and list backgrounds for the national and Kanto dex (assembled from the fills in `pokedex_screen.c`), category icons, and the caught marker. |
| `ui/region_map/` | `kanto.png` and `sevii_*.png` (Town Map frame), `*_fly.png` (Fly frame), `*_map_only.png`, plus the cursor, player and fly/dungeon icons. The slot-2 tint and backdrop follow `region_map.c`. |
| `ui/title/` | `title_screen.png` (all 4 layers composited), plus separate layers and trimmed `logo.png` and `charizard.png`, `flames.png` (16x16 frames) and `slash.png`. |
| `misc/badges/<boulder…earth>.png` | 16x16 each, plus `all_badges.png`. **They really are greyscale:** the trainer-card badge art only uses indices 0–4 and 15 (the coloured palette entries are never referenced). |
| `misc/trainer_card/{front,back}_{blue,green,bronze,silver,gold}.png` | Cards with 0–4 stars. The front shows all 8 badges and the star count. |
| `misc/pc_wallpapers/<name>.png` | 160x144 box wallpapers (20x18 map, raw bank +3 per `CopyRectToBgTilemapBufferRect`). `ui/screens/pc_box_example.png` is a composite. |
| `misc/oak_speech/` | `bg.png` and the 8bpp character pictures `oak.png`, `red.png`, `leaf.png` and `rival.png` (64x96), plus `platform.png`. |
| `misc/evolution/` | `static_bg.png` (plain indoor terrain at BG3 X=256), `swirl_frames.png` (4 palette-cycle frames of the moving background, BG1 blended 8/8 over BG2), and `sparkle.png`. |
| `misc/hall_of_fame/bg.png`, `misc/tm_case/`, `misc/berry_pouch/`, `misc/battle_transitions/` | Battle transitions are the raw pieces: big/sliding pokeball, VS frame, VS letters. |
| `misc/emotes/{exclamation,double_exclamation,x,smile,question}.png` | Three 16x16 pop-in frames each, player palette. |
| `misc/shiny_sparkle.png` | `gold_stars`: a 16x16 star at (0,0) and 8x8 mini stars at (0,16) and (8,16). |

## Fonts (`fonts/fonts.json`)

There are four atlases: `normal`, `small`, `male` and `female`.

**Atlas layout:**
- `normal`, `male` and `female` are 256x512 with 16x16 cells, 16 per row. Glyphs are 14 px tall.
- `small` is 256x256 with 8x16 cells, 32 per row. Glyphs are 13 px tall.
- The glyph for character code `c` sits at `((c % perRow)*cellW, floor(c/perRow)*cellH)`, left-aligned in its cell.

**Three versions of each atlas:**
- `<font>.png`: standard dialogue colours. Fill is DARK_GRAY (98,98,98), shadow is LIGHT_GRAY (213,213,205), everything else is transparent.
- `<font>_mask.png`: fill is opaque white, shadow is opaque 50% grey (128,128,128).
- `<font>_rg.png`: a 2-channel mask, R=255 for fill and G=255 for shadow. Use it to recolour fill and shadow independently in a shader or canvas composite.

**`fonts.json` contents:**
- `fonts.<f>.glyphWidths`: 512 entries from `sFont*LatinGlyphWidths` in `src/text.c`. Advance by the width; the game adds the printer's letter spacing, and `fontInfo` holds the `gFontInfos` defaults. Dialogue lines are 16 px apart.
- `charMap`: printable character → code, from `charmap.txt`. It covers A–Z, a–z, 0–9, punctuation, accented letters, `é` (0x1B, as in "POKéMON"), `♂` 0xB5, `♀` 0xB6, `…` 0xB0, the quotes, `×` and `▶`. Space is 0x00.
- `multiGlyph`: named glyph runs such as `PK`/`PKMN` (0x53 0x54), `LV`, arrows and `POKEBLOCK`.
- `textColors`: every `TEXT_COLOR_*` value as RGB.

## Verification

`--verify` writes contact sheets to `tools/gfx_verify/`. Each was checked by eye:
- `pokemon_fronts`, `pokemon_spotcheck` (normal, shiny and back for key species including Treecko, Rayquaza and the Deoxys/Castform/Unown forms), `pokemon_icons`
- `trainers`, `trainer_backs`
- `items`, `items_spotcheck`
- `terrains`, `terrains_textbox`, `terrain_entry`
- `overworld`, `field_effects`
- `ui_icons` (types and status), `ui_battle`, `ui_balls_cursors`, `ui_frames`, `ui_dialogue`
- `screens`, `screens_pieces`, `badges`, `pc_wallpapers`
- `fonts_demo`, a string rendered with the widths and charmap

## Not done / caveats

- **Text and runtime overlays are not baked in.** The screens contain no text, HP-bar fills, Pokémon or text windows.
- **Shop:** the item description box can switch palette (11/6); only the default is rendered.
- **Not converted:** the intro cutscene (`graphics/intro`), the Teachy TV, minigames, the Japanese fonts, and battle-animation sprites other than the shiny sparkle.
- **Not in this format:** overworld map tilesets (`data/tilesets`) are a separate format and were not converted.
- **Evolution swirl:** only a few palette-cycle frames are rendered. The game cycles them continuously.

## Move animations (`tools/extract_anims.py`)

`python tools/extract_anims.py [--debug]` writes `web/assets/anims/`:
`anims.json` (move/label scripts as `[opcode, ...resolved args]`, sprite templates, inlined
`animTables`/`affineTables` keyed by table name (sliced refs like `&sAnims_X[3]` become `sAnims_X+3`),
every individual `anims`/`affineAnims` array by C name, `oams`, `tags`, `palettes`, `bgs`,
`constants`, `seNames`, plus top-level `general`/`special`/`statusConditions` label lists),
`tiles.bin` (all battle-anim sprite sheets as raw 4bpp tiles, gbagfx tile order; `tags[t].tiles =
[byteOffset, numTiles]`) and `bgs/*.png` (move backgrounds rendered from image+tilemap+palette, pixel
index 0 transparent). Script word args (createsprite/createvisualtask/createsoundtask/setarg) are
wrapped to s16 like `gBattleAnimArgs`; createsprite subpriority is the raw 7-bit script value
(game: `<64` means `-n`, `>=64` means `n-64`, added to the battler's subpriority). `--debug` dumps a
few template frames to `tools/gfx_verify/anims/`.
