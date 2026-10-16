#!/usr/bin/env python3
"""
Kanto Spire -- Platinum (Sinnoh) art extractor.

Reads the owner's own Pokemon Platinum (USA) ROM with ndspy and writes browser-ready RGBA PNGs (palette index 0 =
transparent) into web/assets/gfx. Every output path has a 'platinum' folder, so tools/upload_packs.cjs puts all of
them in the lazy 'sinnoh' asset pack:

    gfx/trainers/platinum/<name>.png          64x64 Sinnoh trainer portraits (/poketool/trgra/trfgra.narc: 5 members
                                              per trainer class: NCGR, NCLR, NCER, NANR, scan NCGR), drawn from cell 0
                                              in an 80x80 frame and shrunk 80 -> 64 with extract_hgss.downscale() (the
                                              same palette-safe vote filter and scale as the HGSS portraits); a figure
                                              drawn in mid-air (AARON's leap) is moved down so its feet touch the bottom
    gfx/overworld/people/platinum/<name>.png  288x32 walkers (/data/mmodel/mmodel.narc BTX0, the same 16-texture
                                              layout as HGSS): 9 32x32 frames in FireRed's people order, shrunk 0.8,
                                              exactly like gfx/overworld/people/hgss/silver.png
    gfx/platinum/pokemon/giratina_origin/     Giratina's Origin Forme (/poketool/pokegra/pl_otherpoke.narc + the icon
        front.png front_shiny.png back.png    in /poketool/icongra/pl_poke_icon.narc), in gfx/gen4/pokemon/giratina/'s
        back_shiny.png anim_front.png         conventions (extract_gen4.py: 64x64 fronts scaled min(0.94, 64/size),
        anim_front_shiny.png icon.png         backs the fixed 0.8, 128x64 2-frame anim strips, 32x64 2-frame icon)

Offline only (never under web/assets):
    --gen4-check   renders the 107 Gen 4 species (387-493) from Platinum's pl_pokegra / pl_poke_icon into
                   ~/scratch/sinnoh/extract/pl_gen4/<mon>/ and writes a pixel-diff parity report against
                   web/assets/gfx/gen4/pokemon (HeartGold-derived, tools/extract_gen4.py) to
                   ~/scratch/sinnoh/extract/gen4_parity.txt
    (always)       the SHINY / DUSK / DAWN STONE icons from /itemtool/itemdata/item_icon.narc into
                   ~/scratch/sinnoh/extract/items/ (Platinum alone can supply the Gen 4 stones)
    --sheet        a contact sheet of everything written: ~/scratch/sinnoh/extract/sheet.png

Usage (needs ndspy, Pillow):
    python tools/extract_platinum.py [path/to/platinum_usa.nds]  (default: rom/platinum.nds) [--sheet] [--gen4-check]

Re-runnable: overwrites its outputs and prints every file written. Only the USA dumps (CPUE, Rev 0 or Rev 1; sha1s
below) are accepted. Outputs are gitignored and private; never commit them.

Indices (all verified against pret/pokeplatinum):
  trainer classes  generated/trainer_classes.txt (TRAINER_CLASS_* in order, 0-based); trfgra member = class * 5
  walkers          res/graphics/field_sprites/field_sprites.order (cynthia.nsbtx = 117 'champion.*',
                   barry.nsbtx = 127 'rivel.*')
  Giratina Origin  res/pokemon/giratina/meson.build otherpoke_index: 152 back, 153 front, 246 normal / 247 shiny
                   palette; icon: res/pokemon/meson.build poke_icon_files (7 shared files, species 0-493, egg,
                   Manaphy egg, Deoxys x3, Unown x28, Burmy x2, Wormadam x2, Shellos, Gastrodon, giratina_origin_icon
                   = member 540), icon_palette 0 (forms/origin/data.json)
  item icons       res/items/item_icon.order (shiny_stone NCGR/NCLR = 480/481, dusk 482/483, dawn 484/485)
"""
from __future__ import annotations

import hashlib
import json
import re
import sys
import urllib.request
from pathlib import Path

import ndspy.narc
import ndspy.rom
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from extract_hgss import downscale, item_icon, overworld, palette, trainer_pic  # noqa: E402
from extract_gen4 import BACK_SCALE, FRONT_MAX_SCALE, icon, nclr_palettes, pokegra, shrink_frames, strip  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "web" / "assets" / "gfx"
DEFAULT_ROM = ROOT / "rom" / "platinum.nds"
SHA1S = {
    "0862ec35b24de5c7e2dcb88c9eea0873110d755c": "Pokemon - Platinum Version (USA) (Rev 1)",
    "ce81046eda7d232513069519cb2085349896dec7": "Pokemon - Platinum Version (USA)",
}
SCRATCH = Path.home() / "scratch" / "sinnoh" / "extract"

# portrait name -> TRAINER_CLASS_* index (pokeplatinum generated/trainer_classes.txt, 0-based)
TRAINERS = {
    "roark": 62, "gardenia": 74, "maylene": 76, "wake": 75, "fantina": 77, "byron": 64, "candice": 78,
    "volkner": 79,
    "aaron": 65, "bertha": 66, "flint": 67, "lucian": 68, "cynthia": 69,  # ELITE_FOUR_*, CHAMPION_CYNTHIA
    "barry": 63,             # TRAINER_CLASS_RIVAL
    "cyrus": 86,             # TRAINER_CLASS_GALACTIC_BOSS
    "mars": 72, "jupiter": 87, "saturn": 88,  # COMMANDER_*
    "galactic_grunt_m": 73, "galactic_grunt_f": 89,
    "ace_trainer_m": 24, "ace_trainer_f": 25,
}
# walker name -> member of /data/mmodel/mmodel.narc (pokeplatinum field_sprites.order) and its texture base name
OVERWORLD = {"cynthia": (117, "champion"), "barry": (127, "rivel")}
GIRATINA = {"back": 152, "front": 153, "normal": 246, "shiny": 247, "icon": 540, "icon_pal": 0}
STONES = {"shiny_stone": (480, 481), "dusk_stone": (482, 483), "dawn_stone": (484, 485)}
GROUND_GAP = 4  # portraits whose lowest pixel is more than this many rows above the bottom are moved down onto it
FIRST, LAST = 387, 493
PRET_HG = "https://raw.githubusercontent.com/pret/pokeheartgold/master/"
PRET_PL = "https://raw.githubusercontent.com/pret/pokeplatinum/main/"


def fetch_text(url: str, cache: Path) -> str:
    if not cache.exists():
        print("download", url)
        cache.parent.mkdir(parents=True, exist_ok=True)
        with urllib.request.urlopen(url, timeout=120) as r:
            cache.write_bytes(r.read())
    return cache.read_text(encoding="utf-8")


def mon_sprites(gra, base: int, pals) -> dict[str, Image.Image]:
    """An NCGR front / back pair + palettes -> the 6 sprite files in extract_gen4.py's conventions."""
    front, back = gra[base["front"]], gra[base["back"]]
    ff, _fs = shrink_frames(pokegra(front), pals, FRONT_MAX_SCALE, fixed=False)
    bf, _ = shrink_frames(pokegra(back), pals, BACK_SCALE, fixed=True)
    return {
        "front.png": ff["normal"][0], "front_shiny.png": ff["shiny"][0],
        "anim_front.png": strip(ff["normal"]), "anim_front_shiny.png": strip(ff["shiny"]),
        "back.png": bf["normal"][0], "back_shiny.png": bf["shiny"][0],
    }


def diff_count(a: Image.Image, b: Image.Image) -> int:
    if a.size != b.size:
        return a.size[0] * a.size[1]
    pa, pb = a.convert("RGBA").load(), b.convert("RGBA").load()
    n = 0
    for y in range(a.size[1]):
        for x in range(a.size[0]):
            u, v = pa[x, y], pb[x, y]
            if (u[3] > 0) != (v[3] > 0) or (u[3] and u[:3] != v[:3]):
                n += 1
    return n


def gen4_check(gra, icons) -> None:
    """Platinum's Gen 4 species vs the HeartGold-derived gfx/gen4/pokemon (front, back, icon), report to scratch."""
    gen4 = OUT / "gen4" / "pokemon"
    species = json.loads((ROOT / "web" / "assets" / "data" / "gen4" / "species.json").read_text(encoding="utf-8"))["species"]
    by_dex = {s["dex"]: s for s in species.values()}
    icon_c = fetch_text(PRET_HG + "src/pokemon_icon_idx.c", SCRATCH / "ref" / "hg_pokemon_icon_idx.c")
    ib = icon_c[icon_c.index("sPokemonPalNoBySpeciesAndForm[]"):]
    icon_pal = [int(v) for v in re.findall(r"\b(\d+)\b", ib[ib.index("{"):ib.index("};")])]
    ipals = nclr_palettes(icons[0])
    out = SCRATCH / "pl_gen4"
    stats = {k: [0, 0] for k in ("front.png", "front_shiny.png", "anim_front.png", "back.png", "icon.png")}
    lines = []
    for dex in range(FIRST, LAST + 1):
        s = by_dex[dex]
        folder = s["gfx"]
        b = dex * 6
        idx = {"front": b + 3 if gra[b + 3] else b + 2, "back": b + 1 if gra[b + 1] else b}
        pals = {"normal": palette(gra[b + 4]), "shiny": palette(gra[b + 5])}
        files = mon_sprites(gra, idx, pals)
        files["icon.png"] = icon(icons[dex + 7], ipals[icon_pal[dex]])
        d = out / folder
        d.mkdir(parents=True, exist_ok=True)
        diffs = []
        for n, img in files.items():
            img.save(d / n)
            if n not in stats:
                continue
            ref = gen4 / folder / n
            if not ref.exists():
                diffs.append(f"{n}: no HG file")
                stats[n][1] += 1
                continue
            k = diff_count(img, Image.open(ref))
            stats[n][0 if k == 0 else 1] += 1
            if k:
                diffs.append(f"{n} {k}px")
        lines.append(f"{dex} {folder:<12} " + ("identical" if not diffs else "DIFF: " + ", ".join(diffs)))
    head = ["Platinum vs HeartGold (web/assets/gfx/gen4/pokemon) Gen 4 sprites, dex 387-493, same scaling pipeline",
            "(pixel diff: a pixel differs when its opacity or its colour differs)", ""]
    head += [f"{n:<16} identical {a:3}  differing {b:3}" for n, (a, b) in stats.items()]
    same = sum(1 for l in lines if l.endswith("identical"))
    head += [f"species with every compared file identical: {same} / {len(lines)}", ""]
    rep = SCRATCH / "gen4_parity.txt"
    rep.write_text("\n".join(head + lines) + "\n", encoding="utf-8")
    print("\n".join(head))
    print(f"wrote {rep} and {out}/<mon>/")


def main() -> None:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    rom_path = Path(args[0]) if args else DEFAULT_ROM
    if not rom_path.exists():
        sys.exit(f"Platinum ROM not found: {rom_path}")
    sha = hashlib.sha1(rom_path.read_bytes()).hexdigest()
    if sha not in SHA1S:
        sys.exit(f"Unexpected ROM sha1 {sha} (want one of {', '.join(f'{k} ({v})' for k, v in SHA1S.items())}). Refusing.")
    print(f"ROM: {SHA1S[sha]}")
    rom = ndspy.rom.NintendoDSRom.fromFile(str(rom_path))
    narc = lambda p: ndspy.narc.NARC(rom.getFileByName(p)).files
    trf = narc("poketool/trgra/trfgra.narc")
    mmodel = narc("data/mmodel/mmodel.narc")
    gra = narc("poketool/pokegra/pl_pokegra.narc")
    other = narc("poketool/pokegra/pl_otherpoke.narc")
    icons = narc("poketool/icongra/pl_poke_icon.narc")
    items = narc("itemtool/itemdata/item_icon.narc")
    assert len(trf) == 105 * 5 and len(mmodel) == 470 and len(other) == 253 and len(icons) == 547, "unexpected NARC sizes"

    written = []
    tdir = OUT / "trainers" / "platinum"
    tdir.mkdir(parents=True, exist_ok=True)
    for name, cls in TRAINERS.items():
        img = downscale(trainer_pic(trf, cls), 64)  # 80x80 -> FireRed's 64x64 scale
        bb = img.getbbox()
        if bb and bb[3] < 64 - GROUND_GAP:  # a mid-air idle frame (AARON leaps): drop it so the feet touch the bottom
            img = img.transform(img.size, Image.AFFINE, (1, 0, 0, 0, 1, bb[3] - 64), Image.NEAREST)
            print(f"  ({name}: lowest pixel at row {bb[3] - 1}; moved down {64 - bb[3]} px)")
        f = tdir / f"{name}.png"
        img.save(f)
        written.append((name, img))
        print(f"wrote {f.relative_to(ROOT)}  {img.size[0]}x{img.size[1]}  (class {cls})")

    odir = OUT / "overworld" / "people" / "platinum"
    odir.mkdir(parents=True, exist_ok=True)
    for name, (idx, tex) in OVERWORLD.items():
        b = bytes(mmodel[idx])
        assert tex.encode() + b".1" in b, f"mmodel {idx} is not '{tex}'"
        img = overworld(b)
        f = odir / f"{name}.png"
        img.save(f)
        written.append((f"ow {name}", img))
        print(f"wrote {f.relative_to(ROOT)}  {img.size[0]}x{img.size[1]}  (mmodel {idx} '{tex}')")

    gdir = OUT / "platinum" / "pokemon" / "giratina_origin"
    gdir.mkdir(parents=True, exist_ok=True)
    pals = {"normal": palette(other[GIRATINA["normal"]]), "shiny": palette(other[GIRATINA["shiny"]])}
    files = mon_sprites(other, {"front": GIRATINA["front"], "back": GIRATINA["back"]}, pals)
    files["icon.png"] = icon(icons[GIRATINA["icon"]], nclr_palettes(icons[0])[GIRATINA["icon_pal"]])
    for n, img in files.items():
        img.save(gdir / n)
        written.append((f"origin {n[:-4]}", img))
        print(f"wrote {(gdir / n).relative_to(ROOT)}  {img.size[0]}x{img.size[1]}")

    sdir = SCRATCH / "items"
    sdir.mkdir(parents=True, exist_ok=True)
    for key, (gi, pi) in STONES.items():
        img = item_icon(items, gi, pi)
        bb = img.getbbox()
        if bb and bb[2] <= 24 and bb[3] <= 24:
            img = img.crop((0, 0, 24, 24))
        img.save(sdir / f"{key}.png")
        written.append((key, img))
        print(f"wrote {sdir / f'{key}.png'}  {img.size[0]}x{img.size[1]}")

    if "--gen4-check" in sys.argv:
        gen4_check(gra, icons)

    if "--sheet" in sys.argv:
        from PIL import ImageDraw
        cols, cw, ch = 6, 300, 84
        rows = (len(written) + cols - 1) // cols
        sheet = Image.new("RGBA", (cols * cw, rows * ch), (90, 110, 140, 255))
        dr = ImageDraw.Draw(sheet)
        for k, (label, img) in enumerate(written):
            x, y = (k % cols) * cw, (k // cols) * ch
            dr.rectangle((x + 2, y + 2, x + 2 + min(img.size[0], 290) - 1, y + 2 + img.size[1] - 1), fill=(150, 170, 190, 255))
            sheet.alpha_composite(img.crop((0, 0, min(img.size[0], 290), img.size[1])), (x + 2, y + 2))
            dr.text((x + 2, y + ch - 14), label, fill=(255, 255, 255, 255))
        sp = SCRATCH / "sheet.png"
        sp.parent.mkdir(parents=True, exist_ok=True)
        sheet.resize((sheet.size[0] * 2, sheet.size[1] * 2), Image.NEAREST).save(sp)
        print(f"wrote {sp}")


if __name__ == "__main__":
    main()
