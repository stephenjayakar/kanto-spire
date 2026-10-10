#!/usr/bin/env python3
"""
Kanto Spire -- Emerald (Hoenn) asset extractor. Optional, like tools/extract_hgss.py.

From the pret/pokeemerald decomp (graphics are indexed PNGs + JASC palettes) and the owner's own Pokemon
Emerald (USA) ROM (music), writes browser-ready files under web/assets (add-only, every output path
contains /emerald/; nothing of FireRed's is touched):

    sound/emerald/bank.{bin,json}          Emerald's music (134 songs): a second m4a bank, relocated so it can be
                                           loaded next to FireRed's (runs tools/extract_emerald_sound.js)
    gfx/trainers/emerald/<name>.png        Emerald's trainer portraits (64x64, index 0 transparent)
    gfx/pokemon/emerald/<folder>/front.png, front_shiny.png
                                           Emerald front sprites (frame 1 of anim_front.png, 64x64)
    gfx/pokemon/emerald/<folder>/anim.png, anim_shiny.png
                                           Emerald's second animation frame (frame 2 of anim_front.png)
    gfx/overworld/people/emerald/<name>.png
                                           overworld walkers (16x32 frames, FireRed's people order) of the
                                           GYM LEADERS, ELITE FOUR, WALLACE, STEVEN, MAY and TEAM AQUA / MAGMA

<folder> is the decomp's graphics/pokemon/<folder> name, the same as pokefirered's (and the game's
gfx/pokemon/<folder>). Castform and Unown (per-form art) are skipped: the game keeps FireRed's for them.

Trainer PARTIES are not extracted here: they are game logic, so they live in web/src/game/hoenn.js
(generated from the decomp by tools/emerald_parties.mjs) and never depend on this optional pack.

Usage (needs Pillow + numpy, and Node for the music step):
    python tools/extract_emerald.py [path/to/emerald.gba] [--decomp path/to/pokeemerald] [--sheet] [--no-sound]
    (defaults: rom/emerald.gba, pokeemerald/)
    --sheet    also writes tests/out/emerald/emerald_sheet.png (contact sheet for eyeballing)
    --no-sound skip the music (no ROM needed then)

Re-runnable: overwrites its own outputs. Only the clean USA ROM is accepted (sha1 in extract_emerald_sound.js).
Outputs live under web/assets (gitignored, private; uploaded as the lazy 'emerald' asset pack by
tools/upload_packs.cjs).
"""
from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "web" / "assets" / "gfx"

# overworld walkers worth having (the bosses' map sprites); path under graphics/object_events/pics/people
OVERWORLD = ["gym_leaders/*", "elite_four/*", "wallace", "steven", "may/walking", "team_aqua/*", "team_magma/*"]


def args():
    a = sys.argv[1:]
    flag = lambda k: a[a.index(k) + 1] if k in a and a.index(k) + 1 < len(a) else None
    skip = {i + 1 for i, x in enumerate(a) if x == "--decomp"}
    pos = [x for i, x in enumerate(a) if not x.startswith("--") and i not in skip]
    rom = Path(pos[0]) if pos else ROOT / "rom" / "emerald.gba"
    decomp = Path(flag("--decomp")) if flag("--decomp") else ROOT / "pokeemerald"
    return rom, decomp, "--sheet" in a, "--no-sound" in a


def gba_rgb(r: int, g: int, b: int) -> tuple[int, int, int]:
    q = lambda c: (((c >> 3) & 31) << 3) | (((c >> 3) & 31) >> 2)
    return (q(r), q(g), q(b))


def read_jasc(path: Path) -> list[tuple[int, int, int]]:
    t = path.read_text().split()
    if t[0] != "JASC-PAL":
        raise ValueError(f"not a JASC palette: {path}")
    n = int(t[2])
    v = list(map(int, t[3:3 + 3 * n]))
    return [gba_rgb(*v[i:i + 3]) for i in range(0, 3 * n, 3)]


def png_palette(path: Path) -> list[tuple[int, int, int]]:
    p = Image.open(path).getpalette() or []
    return [gba_rgb(*p[i:i + 3]) for i in range(0, len(p), 3)]


def load_idx(path: Path) -> np.ndarray:
    im = Image.open(path)
    if im.mode in ("P", "1"):
        return np.array(im, dtype=np.uint8)
    if im.mode == "L":
        return (np.array(im, dtype=np.uint16) * 15 // 255).astype(np.uint8)
    raise ValueError(f"unsupported PNG mode {im.mode}: {path}")


def colorize(idx: np.ndarray, pal) -> Image.Image:
    """4bpp indices -> RGBA (index 0 transparent)."""
    pal = list(pal) + [(0, 0, 0)] * max(0, 16 - len(pal))
    lut = np.array([(*c, 255) for c in pal[:16]], dtype=np.uint8)
    nib = idx & 15
    rgba = lut[nib]
    rgba[nib == 0] = (0, 0, 0, 0)
    return Image.fromarray(rgba, "RGBA")


def save(img: Image.Image, rel: str, written: list) -> None:
    f = OUT / rel
    f.parent.mkdir(parents=True, exist_ok=True)
    img.save(f, optimize=True)
    written.append((rel, img))


def trainers(dec: Path, written: list) -> int:
    """gfx/trainers/emerald/<name>.png, with the palette the build uses (src/data/graphics/trainers.h)."""
    txt = (dec / "src/data/graphics/trainers.h").read_text()
    pics = dict(re.findall(r"gTrainerFrontPic_(\w+)\[\]\s*=\s*INC\w+\(\"([^\"]+)\"", txt))
    pals = dict(re.findall(r"gTrainerPalette_(\w+)\[\]\s*=\s*INC\w+\(\"([^\"]+)\"", txt))
    n = 0
    for sym, png in sorted(pics.items()):
        src = dec / re.sub(r"\.(4bpp|png).*$", ".png", png)
        palsrc = pals.get(sym)
        if not src.exists():
            continue
        if palsrc and palsrc.endswith(".pal"):
            pal = read_jasc(dec / palsrc)
        elif palsrc:
            pal = png_palette(dec / re.sub(r"\.(gbapal|png).*$", ".png", palsrc))
        else:
            pal = png_palette(src)
        save(colorize(load_idx(src), pal), f"trainers/emerald/{src.stem}.png", written)
        n += 1
    return n


def pokemon(dec: Path, written: list) -> int:
    """gfx/pokemon/emerald/<folder>/{front,front_shiny,anim,anim_shiny}.png from anim_front.png (64x128)."""
    PM = dec / "graphics/pokemon"
    n = 0
    for d in sorted(p for p in PM.iterdir() if p.is_dir()):
        a, np_, sp = d / "anim_front.png", d / "normal.pal", d / "shiny.pal"
        if not (a.exists() and np_.exists() and sp.exists()):
            continue  # castform, unown (per-form art), icon palettes, question marks
        idx = load_idx(a)
        if idx.shape != (128, 64):
            print(f"  skip {d.name}: anim_front is {idx.shape[1]}x{idx.shape[0]}")
            continue
        normal, shiny = read_jasc(np_), read_jasc(sp)
        for k, (top, bot) in {"front": (0, 64), "anim": (64, 128)}.items():
            fr = idx[top:bot]
            save(colorize(fr, normal), f"pokemon/emerald/{d.name}/{k}.png", written)
            save(colorize(fr, shiny), f"pokemon/emerald/{d.name}/{k}_shiny.png", written)
        n += 1
    return n


def overworld(dec: Path, written: list) -> int:
    """gfx/overworld/people/emerald/<name>.png in the palette the game assigns (graphics info -> palette tag)."""
    S = dec / "src"
    gi = (S / "data/object_events/object_event_graphics_info.h").read_text()
    pt = (S / "data/object_events/object_event_pic_tables.h").read_text()
    gr = (S / "data/object_events/object_event_graphics.h").read_text()
    mov = (S / "event_object_movement.c").read_text()
    sym_file = dict(re.findall(r"(gObjectEvent(?:Pic|Pal)_\w+)\[\]\s*=\s*INC\w+\(\"([^\"]+)\"", gr))
    tag_pal = {}
    for psym, tag in re.findall(r"\{\s*(gObjectEventPal_\w+)\s*,\s*(OBJ_EVENT_PAL_TAG_\w+)\s*\}", mov):
        tag_pal.setdefault(tag, psym)
    pic_tag = {}
    tables = {m.group(1): re.findall(r"overworld_frame\((\w+)", m.group(2)) for m in re.finditer(r"(sPicTable_\w+)\[\]\s*=\s*\{(.*?)\};", pt, re.S)}
    for m in re.finditer(r"gObjectEventGraphicsInfo_\w+\s*=\s*\{(.*?)\};", gi, re.S):
        tag = re.search(r"\.paletteTag\s*=\s*(\w+)", m.group(1)).group(1)
        images = re.search(r"\.images\s*=\s*(\w+)", m.group(1)).group(1)
        for sym in tables.get(images, []):
            f = sym_file.get(sym)
            if f:
                pic_tag.setdefault(re.sub(r"\.(4bpp|png).*$", "", f), tag)
    P = dec / "graphics/object_events/pics/people"
    n = 0
    for pat in OVERWORLD:
        for f in sorted(P.glob(pat + ".png")):
            key = f.relative_to(dec).with_suffix("").as_posix()
            tag = pic_tag.get(key)
            palf = sym_file.get(tag_pal.get(tag, ""), "")
            pal = read_jasc(dec / re.sub(r"\.gbapal.*$", "", palf)) if palf.endswith(".pal") else png_palette(f)
            name = "may" if pat == "may/walking" else f.stem
            save(colorize(load_idx(f), pal), f"overworld/people/emerald/{name}.png", written)
            n += 1
    return n


def main() -> None:
    rom, dec, sheet, no_sound = args()
    if not (dec / "graphics/pokemon").exists():
        sys.exit(f"pokeemerald decomp not found at {dec} (clone https://github.com/pret/pokeemerald, or pass --decomp <path>)")
    written: list = []
    print(f"trainer portraits: {trainers(dec, written)}")
    print(f"pokemon (front + 2nd frame, normal + shiny): {pokemon(dec, written)}")
    print(f"overworld walkers: {overworld(dec, written)}")
    total = sum((OUT / r).stat().st_size for r, _ in written)
    print(f"wrote {len(written)} PNGs under web/assets/gfx/**/emerald/ ({total / 1024:.0f} KB)")
    if sheet:
        pick = [w for w in written if "/front.png" not in w[0] or w[0].split("/")[2] in
                ("treecko", "torchic", "mudkip", "rayquaza", "kyogre", "groudon", "bulbasaur", "pikachu", "milotic", "salamence")]
        pick = [w for w in pick if "_shiny" not in w[0] and "/anim" not in w[0]][:160]
        cols, cw = 16, 68
        rows = (len(pick) + cols - 1) // cols
        sh = Image.new("RGBA", (cols * cw, rows * cw), (90, 110, 140, 255))
        for k, (_r, im) in enumerate(pick):
            im = im.crop((0, 0, min(im.size[0], 64), min(im.size[1], 64)))
            sh.alpha_composite(im, ((k % cols) * cw + 2, (k // cols) * cw + 2))
        sp = ROOT / "tests" / "out" / "emerald" / "emerald_sheet.png"
        sp.parent.mkdir(parents=True, exist_ok=True)
        sh.resize((sh.size[0] * 2, sh.size[1] * 2), Image.NEAREST).save(sp)
        print(f"wrote {sp.relative_to(ROOT)}")
    if not no_sound:
        if not rom.exists():
            sys.exit(f"Emerald ROM not found: {rom} (pass its path, or --no-sound to skip the music)")
        subprocess.run(["node", str(ROOT / "tools" / "extract_emerald_sound.js"), str(rom), "--decomp", str(dec)], check=True)


if __name__ == "__main__":
    main()
