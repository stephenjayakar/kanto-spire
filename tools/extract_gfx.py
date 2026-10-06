#!/usr/bin/env python3
"""
Kanto Spire -- graphics asset pipeline.

Converts the pret/pokefirered decomp graphics (indexed PNG + JASC .pal + 4bpp
tile sheets + tilemap .bin) into browser-ready RGBA PNGs under
web/assets/gfx/ and writes web/assets/gfx/manifest.json.

Usage:
    python tools/extract_gfx.py                # everything
    python tools/extract_gfx.py pokemon items  # only some sections
    python tools/extract_gfx.py --verify       # also write contact sheets to tools/gfx_verify/

See tools/GFX.md for the output layout and palette-mapping notes.
"""
from __future__ import annotations

import json
import re
import shutil
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
PRET = ROOT / "pokefirered"
G = PRET / "graphics"
OUT = ROOT / "web" / "assets" / "gfx"
VERIFY = ROOT / "tools" / "gfx_verify"

MANIFEST: dict = {"files": {}, "groups": defaultdict(dict)}
WARNINGS: list[str] = []


def warn(msg: str) -> None:
    WARNINGS.append(msg)
    print("WARN:", msg)


# ---------------------------------------------------------------------------
# Colour / palette helpers
# ---------------------------------------------------------------------------

def gba_rgb(r: int, g: int, b: int) -> tuple[int, int, int]:
    """Quantise an 8-bit colour to the GBA's BGR555 and expand back to 8 bits,
    i.e. the colour the hardware actually displays."""
    def q(c):
        c5 = (c >> 3) & 31
        return (c5 << 3) | (c5 >> 2)
    return (q(r), q(g), q(b))


def read_jasc(path: Path) -> list[tuple[int, int, int]]:
    lines = path.read_text().split()
    if lines[0] != "JASC-PAL":
        raise ValueError(f"not a JASC palette: {path}")
    n = int(lines[2])
    vals = list(map(int, lines[3:3 + n * 3]))
    return [gba_rgb(*vals[i * 3:i * 3 + 3]) for i in range(n)]


def png_palette(path: Path) -> list[tuple[int, int, int]]:
    im = Image.open(path)
    p = im.getpalette() or []
    return [gba_rgb(*p[i:i + 3]) for i in range(0, len(p), 3)]


def pal_of(stem_or_path) -> list[tuple[int, int, int]]:
    """Palette the build would use for '<stem>.gbapal': <stem>.pal if present,
    else the PNG's embedded palette (that is how the Makefile builds it)."""
    p = Path(stem_or_path)
    if p.suffix == ".pal":
        return read_jasc(p)
    if p.suffix == ".png":
        return png_palette(p)
    if p.with_suffix(".pal").exists():
        return read_jasc(p.with_suffix(".pal"))
    return png_palette(p.with_suffix(".png"))


def load_idx(path: Path) -> np.ndarray:
    im = Image.open(path)
    if im.mode == "P":
        return np.array(im, dtype=np.uint8)
    if im.mode == "1":
        return np.array(im, dtype=np.uint8)
    if im.mode == "L":
        # grayscale "indexed" PNGs: gbagfx treats L as palette index scaled
        a = np.array(im, dtype=np.uint16)
        return (a * 15 // 255).astype(np.uint8)
    raise ValueError(f"unsupported mode {im.mode} for {path}")


def colorize(idx: np.ndarray, pal, transparent0: bool = True, bank: int | None = None,
             mask4: bool = True) -> np.ndarray:
    """Indexed array -> RGBA uint8 array.

    mask4: treat pixel values as 4bpp (value & 15) indexing into a 16-colour bank
    (bank chosen explicitly, else bank 0).  Set mask4=False for 8bpp lookups.
    Index 0 (of the 4bpp nibble) is transparent when transparent0."""
    pal = list(pal)
    if mask4:
        nib = idx & 15
        base = 16 * (bank or 0)
        lut_idx = nib.astype(np.int32) + base
    else:
        nib = idx
        lut_idx = idx.astype(np.int32)
    need = int(lut_idx.max()) + 1 if lut_idx.size else 1
    while len(pal) < max(need, 16):
        pal.append((255, 0, 255))
    lut = np.array([(r, g, b, 255) for r, g, b in pal], dtype=np.uint8)
    out = lut[lut_idx]
    if transparent0:
        out[nib == 0] = (0, 0, 0, 0)
    return out


def to_img(arr: np.ndarray) -> Image.Image:
    return Image.fromarray(arr, "RGBA")


def rel(p: Path) -> str:
    return p.relative_to(PRET).as_posix()


# ---------------------------------------------------------------------------
# Output / manifest
# ---------------------------------------------------------------------------

def save(img, relpath: str, frames: dict | None = None, src=None, **extra) -> str:
    if isinstance(img, np.ndarray):
        img = to_img(img)
    if img.mode != "RGBA":
        img = img.convert("RGBA")
    dst = OUT / relpath
    dst.parent.mkdir(parents=True, exist_ok=True)
    img.save(dst, optimize=True)
    ent = {"w": img.width, "h": img.height}
    if frames:
        ent["frames"] = frames
    if src is not None:
        if isinstance(src, (list, tuple)):
            ent["src"] = [rel(Path(s)) if isinstance(s, Path) else s for s in src]
        else:
            ent["src"] = rel(src) if isinstance(src, Path) else src
    ent.update(extra)
    MANIFEST["files"][relpath] = ent
    return relpath


def begin(prefixes, groups):
    """Reset a section's outputs (files on disk + manifest entries) before re-running it."""
    for pre in prefixes:
        for k in [k for k in MANIFEST["files"] if k.startswith(pre)]:
            del MANIFEST["files"][k]
        d = OUT / pre
        if pre.endswith("/") and d.is_dir():
            shutil.rmtree(d)
    for g in groups:
        MANIFEST["groups"].pop(g, None)
        MANIFEST["groups"][g] = {}


def frames_of(w, h, fw, fh, layout=None):
    cols, rows = w // fw, h // fh
    d = {"w": fw, "h": fh, "count": cols * rows}
    if cols > 1 and rows > 1:
        d["cols"] = cols
        d["rows"] = rows
    elif rows > 1:
        d["layout"] = "vertical"
    else:
        d["layout"] = "horizontal"
    if layout:
        d["layout"] = layout
    return d


# ---------------------------------------------------------------------------
# Tiles / tilemaps
# ---------------------------------------------------------------------------

def tiles_of(idx: np.ndarray, mw: int = 1, mh: int = 1) -> np.ndarray:
    """Split an indexed image into 8x8 tiles in gbagfx order (row-major,
    optionally metatile-major for -mwidth/-mheight)."""
    h, w = idx.shape
    th, tw = h // 8, w // 8
    t = idx[:th * 8, :tw * 8].reshape(th, 8, tw, 8).swapaxes(1, 2)  # th,tw,8,8
    if mw == 1 and mh == 1:
        return t.reshape(-1, 8, 8)
    out = []
    for my in range(th // mh):
        for mx in range(tw // mw):
            for y in range(mh):
                for x in range(mw):
                    out.append(t[my * mh + y, mx * mw + x])
    return np.array(out)


def load_tiles(*paths, mw=1, mh=1) -> np.ndarray:
    return np.concatenate([tiles_of(load_idx(Path(p)), mw, mh) for p in paths])


def read_bin(path: Path) -> np.ndarray:
    return np.frombuffer(Path(path).read_bytes(), dtype="<u2")


def sbb_to_linear(entries: np.ndarray, screen_size: int) -> tuple[np.ndarray, int, int]:
    """Convert a tilemap stored as GBA screenblocks into a linear 2D grid."""
    if screen_size == 0:
        return entries[:1024].reshape(32, 32), 32, 32
    blocks = [entries[i * 1024:(i + 1) * 1024].reshape(32, 32) for i in range(len(entries) // 1024)]
    if screen_size == 1:
        return np.hstack(blocks[:2]), 64, 32
    if screen_size == 2:
        return np.vstack(blocks[:2]), 32, 64
    top = np.hstack(blocks[0:2]); bot = np.hstack(blocks[2:4])
    return np.vstack([top, bot]), 64, 64


def render_map(tiles: np.ndarray, grid: np.ndarray, pal, tile_base: int = 0,
               transparent0: bool = True, bpp8: bool = False, pal_add: int = 0,
               backdrop=None) -> np.ndarray:
    """grid: 2D uint16 tilemap entries.  pal: full 256-colour BG palette list
    (missing entries are magenta).  tile_base: VRAM tile index of tiles[0]."""
    pal = list(pal) + [(255, 0, 255)] * max(0, 256 - len(pal))
    lut = np.array([(r, g, b, 255) for r, g, b in pal[:256]], dtype=np.uint8)
    H, W = grid.shape
    out = np.zeros((H * 8, W * 8, 4), np.uint8)
    for ty in range(H):
        for tx in range(W):
            e = int(grid[ty, tx])
            ti = (e & 0x3FF) - tile_base
            if ti < 0 or ti >= len(tiles):
                continue
            t = tiles[ti]
            if e & 0x400:
                t = t[:, ::-1]
            if e & 0x800:
                t = t[::-1, :]
            if bpp8:
                col = lut[t]
                tr = t == 0
            else:
                pn = ((e >> 12) + pal_add) & 15
                col = lut[(t & 15).astype(np.int32) + pn * 16]
                tr = (t & 15) == 0
            col = col.copy()
            if transparent0:
                col[tr] = (0, 0, 0, 0)
            out[ty * 8:ty * 8 + 8, tx * 8:tx * 8 + 8] = col
    if backdrop is not None:
        bd = np.zeros_like(out)
        bd[...] = (*backdrop, 255)
        out = alpha_over(bd, out)
    return out


def alpha_over(bottom: np.ndarray, top: np.ndarray) -> np.ndarray:
    out = bottom.copy()
    m = top[..., 3] > 0
    out[m] = top[m]
    return out


def bg_palette(*loads) -> list:
    """loads: (slot, palette_list) -- builds a 256-entry BG palette."""
    pal = [(255, 0, 255)] * 256
    for slot, p in loads:
        for i, c in enumerate(p):
            if slot * 16 + i < 256:
                pal[slot * 16 + i] = c
    return pal


# ---------------------------------------------------------------------------
# C source parsing helpers
# ---------------------------------------------------------------------------

_INCBIN_RE = re.compile(r"(\w+)\s*\[[^\]]*\]\s*=\s*INCBIN_U\d+\(([^;]*?)\);", re.S)
_SYMS: dict[str, list[str]] | None = None


def incbins() -> dict[str, list[str]]:
    """symbol -> list of source paths (extensions stripped of .lz etc.)"""
    global _SYMS
    if _SYMS is None:
        _SYMS = {}
        for f in list((PRET / "src").rglob("*.c")) + list((PRET / "src").rglob("*.h")):
            txt = f.read_text(errors="ignore")
            for m in _INCBIN_RE.finditer(txt):
                paths = re.findall(r'"([^"]+)"', m.group(2))
                _SYMS.setdefault(m.group(1), paths)
    return _SYMS


def sym_path(sym: str, idx: int = 0) -> str | None:
    p = incbins().get(sym)
    return p[idx] if p else None


def strip_ext(p: str) -> str:
    for e in (".lz", ".rl", ".4bpp", ".8bpp", ".1bpp", ".gbapal", ".bin", ".pal", ".png"):
        if p.endswith(e):
            p = p[: -len(e)]
    for e in (".4bpp", ".8bpp", ".1bpp", ".gbapal", ".bin"):
        if p.endswith(e):
            p = p[: -len(e)]
    return p


def src_text(rel_path: str) -> str:
    return (PRET / rel_path).read_text(errors="ignore")


# ---------------------------------------------------------------------------
# Verification sheets
# ---------------------------------------------------------------------------

def contact_sheet(items, name: str, cell=None, cols: int = 16, scale: int = 1,
                  bg=(96, 160, 200), label=True):
    """items: list of (label, relpath_in_OUT).  Writes tools/gfx_verify/<name>.png"""
    if not items:
        return
    ims = []
    for lab, p in items:
        with Image.open(OUT / p) as im:
            ims.append((lab, im.convert("RGBA")))
    cw = cell[0] if cell else max(i.width for _, i in ims)
    ch = cell[1] if cell else max(i.height for _, i in ims)
    lh = 10 if label else 0
    rows = (len(ims) + cols - 1) // cols
    sheet = Image.new("RGBA", (cols * (cw + 2), rows * (ch + lh + 2)), (*bg, 255))
    d = ImageDraw.Draw(sheet)
    for n, (lab, im) in enumerate(ims):
        x = (n % cols) * (cw + 2)
        y = (n // cols) * (ch + lh + 2)
        crop = im.crop((0, 0, min(cw, im.width), min(ch, im.height)))
        sheet.alpha_composite(crop, (x, y))
        if label:
            d.text((x, y + ch), lab[: max(3, cw // 6)], fill=(0, 0, 0, 255))
    if scale != 1:
        sheet = sheet.resize((sheet.width * scale, sheet.height * scale), Image.NEAREST)
    VERIFY.mkdir(parents=True, exist_ok=True)
    sheet.save(VERIFY / f"{name}.png")
    print(f"  verify sheet: tools/gfx_verify/{name}.png ({len(ims)} items)")


# ===========================================================================
# 1. Pokemon
# ===========================================================================

def section_pokemon(verify: bool):
    print("== pokemon")
    begin(["pokemon/"], ["pokemon", "pokemonSpecies", "pokemonPaletteCheck"])
    syms = incbins()
    PM = G / "pokemon"
    icon_pals = [read_jasc(PM / "icon_palettes" / f"icon_palette_{i}.pal") for i in range(3)]

    # species -> icon symbol, species -> icon palette index
    icotxt = src_text("src/pokemon_icon.c")
    tbl = icotxt[icotxt.index("gMonIconTable[]"):]
    tbl = tbl[: tbl.index("};")]
    species_icon = dict(re.findall(r"\[(SPECIES_\w+)\]\s*=\s*(gMonIcon_\w+)", tbl))
    ptbl = icotxt[icotxt.index("gMonIconPaletteIndices[]"):]
    ptbl = ptbl[: ptbl.index("};")]
    species_ipal = {k: int(v) for k, v in re.findall(r"\[(SPECIES_\w+)\]\s*=\s*(\d+)", ptbl)}
    iconpath_pal: dict[str, int] = {}
    for sp, isym in species_icon.items():
        for p in syms.get(isym, []):
            iconpath_pal.setdefault(strip_ext(p), species_ipal.get(sp, 0))

    # species -> front pic folder
    ftxt = src_text("src/data/pokemon_graphics/front_pic_table.h")
    species_folder = {}
    for sp, fsym in re.findall(r"SPECIES_SPRITE\((\w+),\s*(gMonFrontPic_\w+)", ftxt):
        p = sym_path(fsym)
        if p:
            species_folder["SPECIES_" + sp] = p

    pal_mismatch = []

    def emit(outname: str, front: Path | None, back: Path | None, npal: Path | None, spal: Path | None,
             icon: Path | None, icon_pal_key: str | None, footprint: Path | None,
             front_crop: int | None = None, back_crop: int | None = None, extra=None):
        """front_crop: for 64x128 Deoxys sheets, which 64x64 half (0=top,1=bottom)."""
        files = {}
        npl = read_jasc(npal) if npal else None
        spl = read_jasc(spal) if spal else None
        for kind, src, crop in (("front", front, front_crop), ("back", back, back_crop)):
            if not src or not src.exists():
                continue
            idx = load_idx(src)
            if crop is not None:
                idx = idx[crop * 64:(crop + 1) * 64]
            emb = png_palette(src)[:16]
            if npl and emb[:16] != npl[:16]:
                diffs = sum(1 for a, b in zip(emb, npl) if a != b)
                pal_mismatch.append((rel(src), diffs))
            pal = npl or emb
            files[kind] = save(colorize(idx, pal), f"pokemon/{outname}/{kind}.png", src=src)
            if spl:
                files[kind + "_shiny"] = save(colorize(idx, spl), f"pokemon/{outname}/{kind}_shiny.png", src=[src, spal])
        if icon and icon.exists():
            key = strip_ext(rel(icon))
            pi = iconpath_pal.get(icon_pal_key or key)
            if pi is None:
                warn(f"no icon palette index for {key}; using 0")
                pi = 0
            idx = load_idx(icon)
            files["icon"] = save(colorize(idx, icon_pals[pi]), f"pokemon/{outname}/icon.png",
                                 frames=frames_of(32, 64, 32, 32), src=icon, iconPalette=pi)
        if footprint and footprint.exists():
            idx = load_idx(footprint)
            arr = np.zeros((*idx.shape, 4), np.uint8)
            arr[idx == 1] = (0, 0, 0, 255)  # 1bpp: set bits = ink
            # PIL mode '1' -> 1 means white; footprints are stored white-bg / black ink
            raw = np.array(Image.open(footprint).convert("L"))
            arr[:] = 0
            arr[raw < 128] = (66, 49, 41, 255)
            files["footprint"] = save(arr, f"pokemon/{outname}/footprint.png", src=footprint)
        ent = {"files": files}
        if extra:
            ent.update(extra)
        MANIFEST["groups"]["pokemon"][outname] = ent

    special = {"unown", "castform", "deoxys", "question_mark", "icon_palettes"}
    for d in sorted(p for p in PM.iterdir() if p.is_dir()):
        n = d.name
        if n in special:
            continue
        emit(n, d / "front.png", d / "back.png", d / "normal.pal" if (d / "normal.pal").exists() else None,
             d / "shiny.pal" if (d / "shiny.pal").exists() else None,
             d / "icon.png", None, d / "footprint.png")

    # Unown: shared palettes/footprint at top level, per-letter pics
    U = PM / "unown"
    letters = sorted(p.name for p in U.iterdir() if p.is_dir())
    for L in letters:
        emit(f"unown_{L}", U / L / "front.png", U / L / "back.png", U / "normal.pal", U / "shiny.pal",
             U / L / "icon.png", None, U / "footprint.png", extra={"form": L, "baseSpecies": "unown"})
    emit("unown", U / "a" / "front.png", U / "a" / "back.png", U / "normal.pal", U / "shiny.pal",
         U / "a" / "icon.png", None, U / "footprint.png", extra={"form": "a", "forms": [f"unown_{L}" for L in letters]})

    # Castform: per-form pics + palettes, shared icon/footprint
    C = PM / "castform"
    forms = ["normal", "sunny", "rainy", "snowy"]
    for f in forms:
        emit(f"castform_{f}" if f != "normal" else "castform", C / f / "front.png", C / f / "back.png",
             C / f / "normal.pal", C / f / "shiny.pal", C / "icon.png", None, C / "footprint.png",
             extra={"form": f, "baseSpecies": "castform"} if f != "normal" else
             {"form": "normal", "forms": ["castform"] + [f"castform_{x}" for x in forms[1:]]})

    # Deoxys: 64x128 sheets; top half = Normal Forme, bottom half = Attack (front/back.png)
    # or Defense (front_def/back_def.png).  FireRed shows the Attack Forme in battle
    # (DuplicateDeoxysTiles copies the bottom half over the top), and its icon.
    D = PM / "deoxys"
    emit("deoxys", D / "front.png", D / "back.png", D / "normal.pal", D / "shiny.pal", D / "icon_attack.png",
         strip_ext(rel(D / "icon.png")), D / "footprint.png", front_crop=1, back_crop=1,
         extra={"form": "attack", "note": "FireRed in-battle form (Attack)", "forms": ["deoxys", "deoxys_normal", "deoxys_defense"]})
    emit("deoxys_normal", D / "front.png", D / "back.png", D / "normal.pal", D / "shiny.pal", D / "icon.png",
         None, D / "footprint.png", front_crop=0, back_crop=0, extra={"form": "normal", "baseSpecies": "deoxys"})
    emit("deoxys_defense", D / "front_def.png", D / "back_def.png", D / "normal.pal", D / "shiny.pal",
         D / "icon_defense.png", strip_ext(rel(D / "icon.png")), D / "footprint.png", front_crop=1, back_crop=1,
         extra={"form": "defense", "baseSpecies": "deoxys"})

    # Question marks (SPECIES_NONE / old unown placeholders)
    Q = PM / "question_mark"
    for f in ("circled", "double"):
        emit(f"question_mark_{f}", Q / f / "front.png", Q / f / "back.png", Q / f / "normal.pal",
             Q / f / "shiny.pal", Q / "icon.png", None, Q / "footprint.png")
    emit("question_mark", None, None, None, None, Q / "icon.png", None, Q / "footprint.png")

    # species map
    def outname_for(p):
        p = strip_ext(p).replace("graphics/pokemon/", "")
        parts = p.split("/")[:-1]
        if parts[:1] == ["unown"] and len(parts) > 1:
            return "unown_" + parts[1]
        if parts[:1] == ["question_mark"]:
            return "question_mark_" + parts[1]
        if parts[:1] == ["deoxys"]:
            return "deoxys"
        return parts[0]
    MANIFEST["groups"]["pokemonSpecies"] = {sp: outname_for(p) for sp, p in species_folder.items()}

    if pal_mismatch:
        print(f"  {len(pal_mismatch)} sprites whose embedded PNG palette differs from normal.pal (used .pal):")
        for r_, n_ in pal_mismatch[:20]:
            print("   ", r_, n_, "colours differ")
    MANIFEST["groups"]["pokemonPaletteCheck"] = {"embeddedDiffersFromNormalPal": [r for r, _ in pal_mismatch]}

    if verify:
        names = sorted(MANIFEST["groups"]["pokemon"])
        items = [(n, f"pokemon/{n}/front.png") for n in names if (OUT / f"pokemon/{n}/front.png").exists()]
        contact_sheet(items, "pokemon_fronts", cell=(64, 64), cols=24)
        items = [(n, f"pokemon/{n}/front_shiny.png") for n in names if (OUT / f"pokemon/{n}/front_shiny.png").exists()]
        contact_sheet(items, "pokemon_fronts_shiny", cell=(64, 64), cols=24)
        items = [(n, f"pokemon/{n}/back.png") for n in names if (OUT / f"pokemon/{n}/back.png").exists()]
        contact_sheet(items, "pokemon_backs", cell=(64, 64), cols=24)
        items = [(n, f"pokemon/{n}/icon.png") for n in names if (OUT / f"pokemon/{n}/icon.png").exists()]
        contact_sheet(items, "pokemon_icons", cell=(32, 64), cols=32, label=False)
        pick = ["bulbasaur", "charmander", "squirtle", "pikachu", "mew", "mewtwo", "gyarados", "dragonite",
                "treecko", "torchic", "mudkip", "rayquaza", "kyogre", "groudon", "jirachi", "deoxys",
                "deoxys_normal", "deoxys_defense", "castform", "castform_sunny", "castform_rainy", "castform_snowy",
                "unown_a", "unown_question_mark", "egg", "question_mark_circled", "lapras", "snorlax", "eevee", "umbreon"]
        items = []
        for n in pick:
            for k in ("front", "front_shiny", "back"):
                if (OUT / f"pokemon/{n}/{k}.png").exists():
                    items.append((f"{n[:7]}", f"pokemon/{n}/{k}.png"))
        contact_sheet(items, "pokemon_spotcheck", cell=(64, 64), cols=12, scale=2)


# ===========================================================================
# 2. Trainers
# ===========================================================================

def section_trainers(verify: bool):
    print("== trainers")
    begin(["trainers/"], ["trainers", "trainerBacks"])
    T = G / "trainers"
    txt = src_text("src/data/trainer_graphics/front_pic_tables.h")
    pic_of = dict(re.findall(r"TRAINER_SPRITE\((\w+),\s*(gTrainerFrontPic_\w+)", txt))
    pal_of_ = dict(re.findall(r"TRAINER_PAL\((\w+),\s*(gTrainerPalette_\w+)", txt))
    path_pal: dict[str, set] = defaultdict(set)
    path_ids: dict[str, list] = defaultdict(list)
    for tid, psym in pic_of.items():
        pp = sym_path(psym)
        lp = sym_path(pal_of_.get(tid, ""))
        if pp and lp:
            path_pal[strip_ext(pp)].add(strip_ext(lp))
            path_ids[strip_ext(pp)].append("TRAINER_PIC_" + tid)
    for f in sorted((T / "front_pics").glob("*.png")):
        name = f.stem.replace("_front_pic", "")
        key = strip_ext(rel(f))
        pals = sorted(path_pal.get(key, []))
        if len(pals) > 1:
            warn(f"trainer {name} has multiple palettes {pals}; using first")
        if pals:
            palp = PRET / (pals[0] + ".pal")
        else:
            palp = T / "palettes" / f"{name}.pal"
            warn(f"trainer {name} not in gTrainerFrontPicTable; guessing palette {palp.name}")
        pal = read_jasc(palp)
        save(colorize(load_idx(f), pal), f"trainers/{name}.png", src=[f, palp])
        MANIFEST["groups"]["trainers"][name] = {"file": f"trainers/{name}.png", "palette": palp.name,
                                                "picIds": path_ids.get(key, [])}
    # back pics: vertical strips of 64x64 frames
    bt = src_text("src/data/trainer_graphics/back_pic_tables.h")
    pal_syms = re.findall(r"\{\s*(gTrainerPalette_\w+)\s*,\s*\d+\s*\}", bt[bt.index("gTrainerBackPicPaletteTable"):])
    pic_syms = re.findall(r"\(const u32 \*\)(gTrainerBackPic_\w+)", bt)
    for psym, lsym in zip(pic_syms, pal_syms):
        pp = PRET / (strip_ext(sym_path(psym)) + ".png")
        lp = PRET / (strip_ext(sym_path(lsym)) + ".pal")
        name = pp.stem.replace("_back_pic", "")
        idx = load_idx(pp)
        save(colorize(idx, read_jasc(lp)), f"trainers/back/{name}.png",
             frames=frames_of(idx.shape[1], idx.shape[0], 64, 64), src=[pp, lp])
        MANIFEST["groups"]["trainerBacks"][name] = {"file": f"trainers/back/{name}.png", "palette": lp.name,
                                                    "frames": idx.shape[0] // 64}
    if verify:
        names = sorted(MANIFEST["groups"]["trainers"])
        contact_sheet([(n, f"trainers/{n}.png") for n in names], "trainers", cell=(64, 64), cols=16)
        backs = sorted(MANIFEST["groups"]["trainerBacks"])
        contact_sheet([(n, f"trainers/back/{n}.png") for n in backs], "trainer_backs", cell=(64, 320), cols=6)


# ===========================================================================
# 3. Items
# ===========================================================================

def section_items(verify: bool):
    print("== items")
    begin(["items/"], ["items", "itemIcons"])
    txt = src_text("src/data/item_icon_table.h")
    rows = re.findall(r"\[(ITEM_\w+)\]\s*=\s*\{\s*(gItemIcon\w+)\s*,\s*(gItemIconPalette\w+)\s*\}", txt)
    done_icons = set()
    for item, isym, psym in rows:
        ip, pp = sym_path(isym), sym_path(psym)
        if not ip or not pp:
            warn(f"item {item}: missing symbol {isym if not ip else psym}")
            continue
        ipng = PRET / (strip_ext(ip) + ".png")
        ppal = PRET / (strip_ext(pp) + ".pal")
        pal = read_jasc(ppal) if ppal.exists() else png_palette(PRET / (strip_ext(pp) + ".png"))
        key = item[5:].lower()
        if ipng.stem == "question_mark" and key != "none":
            continue  # unused item slots (ITEM_034 ...)
        idx = load_idx(ipng)
        save(colorize(idx, pal), f"items/{key}.png", src=[ipng, ppal])
        MANIFEST["groups"]["items"][key] = {"file": f"items/{key}.png", "icon": ipng.stem, "palette": ppal.stem,
                                            "item": item}
        done_icons.add(ipng.stem)
    # every icon sheet also by its basename (with the palette of the same name if one exists,
    # else the first palette any item uses it with)
    first_pal = {}
    for item, isym, psym in rows:
        ip, pp = sym_path(isym), sym_path(psym)
        if ip and pp:
            first_pal.setdefault(Path(strip_ext(ip)).name, Path(strip_ext(pp)).name)
    for f in sorted((G / "items" / "icons").glob("*.png")):
        palname = f.stem if (G / "items" / "icon_palettes" / f"{f.stem}.pal").exists() else first_pal.get(f.stem)
        if palname is None:
            pal = png_palette(f)
            palsrc = f
        else:
            palsrc = G / "items" / "icon_palettes" / f"{palname}.pal"
            pal = read_jasc(palsrc)
        save(colorize(load_idx(f), pal), f"items/icons/{f.stem}.png", src=[f, palsrc])
        MANIFEST["groups"]["itemIcons"][f.stem] = f"items/icons/{f.stem}.png"
    if verify:
        names = list(MANIFEST["groups"]["items"])
        contact_sheet([(n, f"items/{n}.png") for n in names], "items", cell=(24, 24), cols=24, scale=2, label=False)
        pick = ["potion", "super_potion", "hyper_potion", "max_potion", "full_restore", "rare_candy", "fire_stone",
                "water_stone", "thunder_stone", "leaf_stone", "moon_stone", "tm01", "tm06", "tm11", "tm24", "tm26",
                "hm01", "master_ball", "ultra_ball", "great_ball", "poke_ball", "tm_case", "bicycle", "oaks_parcel",
                "antidote", "revive", "max_revive", "escape_rope", "nugget", "leftovers"]
        contact_sheet([(n, f"items/{n}.png") for n in pick if (OUT / f"items/{n}.png").exists()],
                      "items_spotcheck", cell=(24, 24), cols=10, scale=3)


# ===========================================================================
# 4. Battle terrain
# ===========================================================================

def section_terrain(verify: bool):
    print("== terrain")
    begin(["terrain/"], ["terrains"])
    B = G / "battle_terrain"
    txt = src_text("src/battle_bg.c")
    # textbox (BG0) for a composited "as seen in game" preview
    tb_tiles = load_tiles(G / "battle_interface" / "textbox.png")
    tb_pal = read_jasc(G / "battle_interface" / "textbox1.pal") + read_jasc(G / "battle_interface" / "textbox2.pal")
    tb_grid, _, _ = sbb_to_linear(read_bin(G / "battle_interface" / "textbox.bin"), 2)

    def render_terrain(name, tiles_png, bin_, pal_list):
        tiles = load_tiles(tiles_png)
        grid, W, H = sbb_to_linear(read_bin(bin_), 1)
        pal = bg_palette((2, pal_list))
        full = render_map(tiles, grid, pal, transparent0=False)
        return full

    terrains = {}
    for d in ["grass", "longgrass", "sand", "underwater", "water", "pond", "mountain", "cave", "building"]:
        pal = read_jasc(B / d / "terrain.pal")
        full = render_terrain(d, B / d / "terrain.png", B / d / "terrain.bin", pal)
        terrains[d] = (full, pal)
    indoor_tiles = B / "indoor" / "terrain.png"
    for p in ["plain", "gym", "leader", "1", "2", "lorelei", "bruno", "agatha", "lance", "champion", "link"]:
        pal = read_jasc(B / "indoor" / f"{p}.pal")
        full = render_terrain(p, indoor_tiles, B / "indoor" / "terrain.bin", pal)
        terrains["indoor_" + p] = (full, pal)

    for name, (full, pal) in terrains.items():
        view = full[:160, :240]
        save(view, f"terrain/{name}.png", src=f"graphics/battle_terrain/*/{name}")
        # composited with the battle textbox (BG0, palettes 0-1) as the game shows it
        tbpal = bg_palette((0, tb_pal), (2, pal))
        tbox = render_map(tb_tiles, tb_grid[:20, :30], tbpal, transparent0=True)
        comp = alpha_over(view, tbox)
        save(comp, f"terrain/with_textbox/{name}.png")
        MANIFEST["groups"]["terrains"][name] = {"file": f"terrain/{name}.png",
                                                "withTextbox": f"terrain/with_textbox/{name}.png"}
    # entry / "anim" layer (BG1 grass/water/rock sweep that slides in on battle start).  32x14 tiles.
    for d in ["grass", "longgrass", "sand", "underwater", "water", "pond", "mountain", "cave", "building"]:
        if not (B / d / "anim.png").exists():
            continue
        tiles = load_tiles(B / d / "anim.png")
        ent = read_bin(B / d / "anim.bin")
        grid = ent.reshape(-1, 32)
        pal = bg_palette((2, terrains[d][1]))
        img = render_map(tiles, grid, pal, transparent0=True)
        save(img, f"terrain/entry/{d}.png", src=B / d / "anim.png")
        MANIFEST["groups"]["terrains"][d]["entry"] = f"terrain/entry/{d}.png"
    if verify:
        items = [(n, f"terrain/{n}.png") for n in MANIFEST["groups"]["terrains"]]
        contact_sheet(items, "terrains", cell=(240, 160), cols=5)
        items = [(n, f"terrain/with_textbox/{n}.png") for n in MANIFEST["groups"]["terrains"]]
        contact_sheet(items, "terrains_textbox", cell=(240, 160), cols=5)
        items = [(n, f"terrain/entry/{n}.png") for n in MANIFEST["groups"]["terrains"] if (OUT / f"terrain/entry/{n}.png").exists()]
        contact_sheet(items, "terrain_entry", cell=(256, 112), cols=3)


# ===========================================================================
# 6. Overworld object events
# ===========================================================================

def section_overworld(verify: bool):
    print("== overworld")
    begin(["overworld/"], ["overworld"])
    gi = src_text("src/data/object_events/object_event_graphics_info.h")
    pics = src_text("src/data/object_events/object_event_pic_tables.h")
    mov = src_text("src/event_object_movement.c")
    tag_pal = {}
    for psym, tag in re.findall(r"\{\s*(gObjectEventPal_\w+)\s*,\s*(OBJ_EVENT_PAL_TAG_\w+)\s*\}", mov):
        tag_pal.setdefault(tag, psym)
    # pic table name -> list of (sym, w, h, frame)
    pictab = {}
    for m in re.finditer(r"sPicTable_(\w+)\[\]\s*=\s*\{(.*?)\};", pics, re.S):
        pictab["sPicTable_" + m.group(1)] = re.findall(r"overworld_frame\((\w+),\s*(\d+),\s*(\d+),\s*(\d+)\)", m.group(2))
    pic_info = {}  # pic path -> (palette tag, w, h, infos)
    for m in re.finditer(r"gObjectEventGraphicsInfo_(\w+)\s*=\s*\{(.*?)\};", gi, re.S):
        body = m.group(2)
        tag = re.search(r"\.paletteTag\s*=\s*(\w+)", body).group(1)
        w = int(re.search(r"\.width\s*=\s*(\d+)", body).group(1))
        h = int(re.search(r"\.height\s*=\s*(\d+)", body).group(1))
        images = re.search(r"\.images\s*=\s*(\w+)", body).group(1)
        for sym, fw, fh, fr in pictab.get(images, []):
            p = sym_path(sym)
            if not p:
                continue
            key = strip_ext(p)
            ent = pic_info.setdefault(key, {"tags": [], "w": int(fw) * 8, "h": int(fh) * 8, "infos": []})
            if tag not in ent["tags"]:
                ent["tags"].append(tag)
            if m.group(1) not in ent["infos"]:
                ent["infos"].append(m.group(1))
    # sheets not reachable through gObjectEventGraphicsInfo_* (field-effect / unused pics)
    player = PRET / "graphics/object_events/palettes/player.pal"
    overrides = {
        "graphics/object_events/pics/misc/surf_blob": (32, 32, player),      # FldEff surf blob, oam pal 0 = player
        "graphics/object_events/pics/people/red_surf": (32, 32, player),     # unused Surf sit sheet
        "graphics/object_events/pics/people/green_surf": (32, 32, player),
    }
    P = G / "object_events" / "pics"
    for f in sorted(P.rglob("*.png")):
        key = strip_ext(rel(f))
        sub = f.parent.relative_to(P).as_posix()
        name = f.stem
        info = pic_info.get(key)
        idx = load_idx(f)
        h_, w_ = idx.shape
        palsrc = None
        if info:
            tags = [t for t in info["tags"] if t in tag_pal]
            if tags:
                palsrc = PRET / (strip_ext(sym_path(tag_pal[tags[0]])) + ".pal")
            fw, fh = info["w"], info["h"]
        else:
            fw, fh = (16, 32) if h_ == 32 and w_ % 16 == 0 else (w_, h_)
        if key in overrides:
            fw, fh, palsrc = overrides[key]
        if palsrc is None or not palsrc.exists():
            pal = png_palette(f)
            palname = "(embedded)"
            if info:
                warn(f"overworld {sub}/{name}: palette tag {info['tags']} not in table; using embedded PNG palette")
        else:
            pal = read_jasc(palsrc)
            palname = palsrc.stem
        out = f"overworld/{sub}/{name}.png"
        if w_ % fw or h_ % fh:
            fw, fh = w_, h_
        save(colorize(idx, pal), out, frames=frames_of(w_, h_, fw, fh), src=f, palette=palname)
        MANIFEST["groups"]["overworld"][f"{sub}/{name}"] = {
            "file": out, "frameW": fw, "frameH": fh, "frames": (w_ // fw) * (h_ // fh), "palette": palname,
            "graphicsInfo": info["infos"] if info else []}
    if verify:
        items = [(k.split("/")[-1], v["file"]) for k, v in MANIFEST["groups"]["overworld"].items()]
        contact_sheet(items, "overworld", cell=(144, 32), cols=8)


# ===========================================================================
# 8a. Field effects (tall grass, shadows, sparkles, splashes, ...)
# ===========================================================================

def section_field_effects(verify: bool):
    print("== field effects")
    begin(["misc/field_effects/"], ["fieldEffects"])
    txt = src_text("src/data/field_effects/field_effect_objects.h")
    tagfile = {
        "FLDEFF_PAL_TAG_GENERAL_0": G / "field_effects/palettes/general_0.pal",
        "FLDEFF_PAL_TAG_GENERAL_1": G / "field_effects/palettes/general_1.pal",
        "FLDEFF_PAL_TAG_ASH": G / "field_effects/palettes/ash.pal",
        "FLDEFF_PAL_TAG_SMALL_SPARKLE": G / "field_effects/palettes/small_sparkle.pal",
    }
    pictab = {}
    for m in re.finditer(r"(sPicTable_\w+)\[\]\s*=\s*\{(.*?)\};", txt, re.S):
        fr = re.findall(r"overworld_frame\((\w+),\s*(\d+),\s*(\d+),\s*(\d+)\)", m.group(2))
        if not fr:
            fr = [(s_, None, None, 0) for s_ in re.findall(r"obj_frame_tiles\((\w+)\)", m.group(2))]
        pictab[m.group(1)] = fr
    seen = {}
    for m in re.finditer(r"gFieldEffectObjectTemplate_(\w+)\s*=\s*\{(.*?)\};", txt, re.S):
        body = m.group(2)
        tag = re.search(r"\.paletteTag\s*=\s*(\w+)", body).group(1)
        images = re.search(r"\.images\s*=\s*(\w+)", body)
        if not images or images.group(1) not in pictab:
            continue
        for sym, w, h, _ in pictab[images.group(1)]:
            p = sym_path(sym)
            if not p:
                continue
            key = strip_ext(p)
            if key not in seen:
                seen[key] = (tag, int(w) * 8 if w else None, int(h) * 8 if h else None, m.group(1))
    for key, (tag, fw, fh, tname) in sorted(seen.items()):
        f = PRET / (key + ".png")
        if not f.exists():
            continue
        idx = load_idx(f)
        H, W = idx.shape
        fw, fh = fw or W, fh or H
        if W % fw or H % fh:
            fw, fh = W, H
        palf = tagfile.get(tag)
        if palf is None and tag == "TAG_NONE":
            # templates without a palette borrow a fixed OBJ slot via oam.paletteNum (field_effect_helpers.c)
            OP = G / "object_events/palettes"
            borrow = {"Shadow": "player", "Arrow": "player", "SurfBlob": "player", "Bird": "player",
                      "Sparkle": "npc_white", "TreeDisguise": "npc_green", "MountainDisguise": "npc_pink",
                      "SandDisguisePlaceholder": "npc_blue"}
            for pre, pn in borrow.items():
                if tname.startswith(pre):
                    palf = OP / f"{pn}.pal"
                    break
        pal = read_jasc(palf) if palf else png_palette(f)
        out = f"misc/field_effects/{f.stem}.png"
        save(colorize(idx, pal), out, frames=frames_of(W, H, fw, fh), src=[f] + ([palf] if palf else []),
             palette=palf.stem if palf else "(embedded)")
        MANIFEST["groups"]["fieldEffects"][f.stem] = {"file": out, "frameW": fw, "frameH": fh,
                                                     "frames": (W // fw) * (H // fh), "template": tname}
    if verify:
        items = [(k, v["file"]) for k, v in MANIFEST["groups"]["fieldEffects"].items()]
        contact_sheet(items, "field_effects", cell=(128, 32), cols=6, scale=2)


# ===========================================================================
# 7. Fonts
# ===========================================================================

TEXT_COLORS = {  # TEXT_COLOR_* indices -> RGB in the standard text palette (graphics/text_window/stdpal_*.pal)
    "TRANSPARENT": 0, "WHITE": 1, "DARK_GRAY": 2, "LIGHT_GRAY": 3, "RED": 4, "LIGHT_RED": 5,
    "GREEN": 6, "LIGHT_GREEN": 7, "BLUE": 8, "LIGHT_BLUE": 9,
}


def parse_charmap():
    lines = (PRET / "charmap.txt").read_text(encoding="utf-8").splitlines()
    chars, names = {}, {}
    for ln in lines:
        if ln.startswith("@ Hiragana"):
            break  # Japanese section reuses the same codes
        m = re.match(r"^'(.+?)'\s*=\s*([0-9A-F]{2})\s*$", ln)
        if m:
            ch = m.group(1).replace("\'", "'")
            chars.setdefault(ch, int(m.group(2), 16))
            continue
        m = re.match(r"^([A-Z_0-9]+)\s*=\s*((?:[0-9A-F]{2}\s*)+)(@.*)?$", ln)
        if m:
            codes = [int(x, 16) for x in m.group(2).split()]
            if all(c < 0xF7 for c in codes):  # glyphs only (skip control codes)
                names[m.group(1)] = codes
    return chars, names


def section_fonts(verify: bool):
    print("== fonts")
    begin(["fonts/"], ["fonts"])
    txt = src_text("src/text.c")

    def widths(sym):
        m = re.search(sym + r"\[\]\s*=\s*\{(.*?)\};", txt, re.S)
        return [int(x) for x in re.findall(r"\d+", m.group(1))]

    std = read_jasc(G / "text_window" / "stdpal_0.pal")
    colors = {k: (list(std[v]) if v else None) for k, v in TEXT_COLORS.items()}
    fonts = {
        # name: (png, cell w, cell h, glyphs per row, glyph height, widths symbol, fontId)
        "normal": ("latin_normal", 16, 16, 16, 14, "sFontNormalLatinGlyphWidths", "FONT_NORMAL"),
        "small": ("latin_small", 8, 16, 32, 13, "sFontSmallLatinGlyphWidths", "FONT_SMALL"),
        "male": ("latin_male", 16, 16, 16, 14, "sFontMaleLatinGlyphWidths", "FONT_MALE"),
        "female": ("latin_female", 16, 16, 16, 14, "sFontFemaleLatinGlyphWidths", "FONT_FEMALE"),
    }
    chars, names = parse_charmap()
    nm = src_text("src/new_menu_helpers.c")
    nm = nm[nm.index("gFontInfos[]"):]
    nm = nm[:nm.index("};")]
    finfo = {}
    for m in re.finditer(r"\[(FONT_\w+)\]\s*=\s*\{(.*?)\}", nm, re.S):
        finfo[m.group(1)] = {k: int(v) for k, v in re.findall(r"\.(\w+)\s*=\s*(\d+)", m.group(2))}
    out = {"_doc": ("Glyph atlases. Glyph for character code c (see charMap) is at "
                    "x=(c % perRow)*cellW, y=floor(c / perRow)*cellH; draw glyphWidths[c] pixels wide, "
                    "glyphHeight tall, then advance by glyphWidths[c] (+ the printer's letterSpacing; gFontInfos defaults are in fontInfo, "
                    "most menus print FONT_NORMAL with letterSpacing 0..1). Dialogue lines are 16px apart. "
                    "<font>.png = standard dialogue colours (fill DARK_GRAY, shadow LIGHT_GRAY). "
                    "<font>_mask.png = fill opaque white (255,255,255), shadow opaque 50% gray (128,128,128), "
                    "everything else transparent -- tint fill/shadow separately in a shader or via two passes. "
                    "<font>_rg.png = 2-channel mask: R=255 where fill, G=255 where shadow (alpha=255 on either)."),
           "textColors": colors, "fonts": {}, "charMap": {}, "multiGlyph": names}
    for name, (png, cw, ch, per, gh, wsym, fid) in fonts.items():
        idx = load_idx(G / "fonts" / f"{png}.png")
        fill, shadow = idx == 1, idx == 2
        a = np.zeros((*idx.shape, 4), np.uint8)
        a[fill] = (*colors["DARK_GRAY"], 255)
        a[shadow] = (*colors["LIGHT_GRAY"], 255)
        save(a, f"fonts/{name}.png", src=G / "fonts" / f"{png}.png")
        m = np.zeros_like(a)
        m[fill] = (255, 255, 255, 255)
        m[shadow] = (128, 128, 128, 255)
        save(m, f"fonts/{name}_mask.png")
        rg = np.zeros_like(a)
        rg[fill] = (255, 0, 0, 255)
        rg[shadow] = (0, 255, 0, 255)
        save(rg, f"fonts/{name}_rg.png")
        w = widths(wsym)
        out["fonts"][name] = {"fontId": fid, "atlas": f"fonts/{name}.png", "mask": f"fonts/{name}_mask.png",
                              "rg": f"fonts/{name}_rg.png", "cellW": cw, "cellH": ch, "perRow": per,
                              "glyphHeight": gh, "fontInfo": finfo.get(fid, {}),
                              "lineHeight": 16 if name != "small" else 14,
                              "glyphCount": (idx.shape[0] // ch) * per, "glyphWidths": w}
        MANIFEST["groups"]["fonts"][name] = {"atlas": f"fonts/{name}.png", "cellW": cw, "cellH": ch, "perRow": per}
    out["charMap"] = dict(sorted(chars.items(), key=lambda kv: kv[1]))
    dst = OUT / "fonts" / "fonts.json"
    with open(dst, "w", encoding="utf-8") as fp:
        json.dump(out, fp, indent=1, ensure_ascii=False)
    MANIFEST["files"]["fonts/fonts.json"] = {"json": True}
    if verify:
        demo_text(out, "POKéMON FIRERED! Kanto Spire 0123456789 ♂♀ …", "fonts_demo")


def demo_text(fj, text, name):
    """Render a test string in every font, to check widths and the charmap."""
    rows = []
    for fname, f in fj["fonts"].items():
        atlas = Image.open(OUT / f["atlas"]).convert("RGBA")
        x = 2
        canvas = Image.new("RGBA", (8 + 10 * len(text), f["cellH"] + 4), (255, 255, 255, 255))
        for chr_ in text:
            c = fj["charMap"].get(chr_)
            if c is None:
                continue
            gx, gy = (c % f["perRow"]) * f["cellW"], (c // f["perRow"]) * f["cellH"]
            w = f["glyphWidths"][c] if c < len(f["glyphWidths"]) else f["cellW"]
            g = atlas.crop((gx, gy, gx + w, gy + f["glyphHeight"]))
            canvas.alpha_composite(g, (x, 2))
            x += w
        rows.append(canvas.crop((0, 0, x + 4, canvas.height)))
    W = max(r.width for r in rows)
    sheet = Image.new("RGBA", (W, sum(r.height for r in rows)), (255, 255, 255, 255))
    y = 0
    for r in rows:
        sheet.paste(r, (0, y)); y += r.height
    sheet = sheet.resize((sheet.width * 3, sheet.height * 3), Image.NEAREST)
    VERIFY.mkdir(parents=True, exist_ok=True)
    sheet.save(VERIFY / f"{name}.png")


# ===========================================================================
# 5a. UI sprites: type icons, status icons, healthboxes, balls, text windows, cursors
# ===========================================================================

def crop(arr, x, y, w, h):
    return arr[y:y + h, x:x + w]


def simple_sprite(src: Path, out: str, pal=None, frames=None, **kw):
    idx = load_idx(src)
    pal = pal if pal is not None else pal_of(src)
    arr = colorize(idx, pal)
    fr = frames_of(idx.shape[1], idx.shape[0], *frames) if frames else None
    save(arr, out, frames=fr, src=src, **kw)
    return arr


def trim(arr):
    ys, xs = np.nonzero(arr[..., 3])
    if len(ys) == 0:
        return arr
    return arr[: ys.max() + 1, : xs.max() + 1]


def sprite_1d(idx, sw, sh, start_tile):
    """Rebuild an sw x sh OBJ whose tiles are stored sequentially (1D mapping) from start_tile in a sheet."""
    per = idx.shape[1] // 8
    tw, th = sw // 8, sh // 8
    out = np.zeros((sh, sw), np.uint8)
    for t in range(tw * th):
        k = start_tile + t
        sx, sy = (k % per) * 8, (k // per) * 8
        out[(t // tw) * 8:(t // tw) * 8 + 8, (t % tw) * 8:(t % tw) * 8 + 8] = idx[sy:sy + 8, sx:sx + 8]
    return out


def section_ui_sprites(verify: bool):
    print("== ui sprites")
    begin(["ui/types/", "ui/menu_info/", "ui/status/", "ui/battle/", "ui/balls/", "ui/text_window/",
           "ui/cursors/", "ui/party/pokeball", "ui/party/hold_icons.png", "ui/summary/shiny_star.png",
           "ui/summary/pokerus_cured.png", "ui/summary/status_ailment_icons.png", "misc/emotes/",
           "misc/shiny_sparkle.png"],
          ["types", "menuInfo", "status", "balls", "textWindows", "battleUi", "cursors"])
    GI = G / "interface"
    # ---- type icons (menu_info.png, 8bpp: <16 dex_caught_pokeball.pal, >=16 pokemon_types.pal) ----
    mi = load_idx(GI / "menu_info.png")
    mi_pal = read_jasc(GI / "dex_caught_pokeball.pal")[:16] + read_jasc(GI / "pokemon_types.pal")[:16]
    mi_rgba = colorize(mi, mi_pal, mask4=False)
    mi_rgba[(mi & 15) == 0] = 0
    save(mi_rgba, "ui/menu_info/menu_info_sheet.png", src=GI / "menu_info.png")
    txt = src_text("src/list_menu.c")
    tbl = txt[txt.index("sMenuInfoIcons[]"):]
    tbl = tbl[: tbl.index("};")]
    for key, w, h, off in re.findall(r"\[(\w+)(?:\s*\+\s*1)?\]\s*=\s*\{\s*(\d+),\s*(\d+),\s*(0x[0-9A-Fa-f]+|\d+)\s*\}", tbl):
        w, h, off = int(w), int(h), int(off, 0)
        x, y = (off % 16) * 8, (off // 16) * 8
        piece = crop(mi_rgba, x, y, w, h)
        if key.startswith("TYPE_"):
            t = key[5:]
            save(piece, f"ui/types/{t}.png", src=GI / "menu_info.png")
            MANIFEST["groups"]["types"][t] = f"ui/types/{t}.png"
        else:
            nm = key.replace("MENU_INFO_ICON_", "").lower()
            save(piece, f"ui/menu_info/{nm}.png", src=GI / "menu_info.png")
            MANIFEST["groups"]["menuInfo"][nm] = f"ui/menu_info/{nm}.png"
    # ---- status icons (party menu) ----
    names = ["psn", "par", "slp", "frz", "brn", "pkrs", "fnt"]
    st = simple_sprite(GI / "status_icons.png", "ui/status/status_icons_sheet.png", frames=(32, 8))
    for i, n in enumerate(names):
        save(crop(st, 32 * i, 0, 32, 8), f"ui/status/{n}.png")
        MANIFEST["groups"]["status"][n] = f"ui/status/{n}.png"
    simple_sprite(G / "summary_screen/status_ailment_icons.png", "ui/summary/status_ailment_icons.png", frames=(32, 8))
    # ---- battle healthbox elements ----
    BI = G / "battle_interface"
    he = load_idx(BI / "healthbox_elements.png")
    hbar = read_jasc(BI / "healthbar.pal")
    hbox = read_jasc(BI / "healthbox.pal")
    emb = png_palette(BI / "healthbox_elements.png")
    pal96 = list(hbar[:16])
    for b in range(1, 6):
        bank = list(hbox[:16])
        bank[12:16] = emb[b * 16 + 12:b * 16 + 16]  # per-status colour slot (sStatusIconColors)
        pal96 += bank
    he_rgba = colorize(he, pal96, mask4=False)
    he_rgba[(he & 15) == 0] = 0
    save(he_rgba, "ui/battle/healthbox_elements_sheet.png", src=BI / "healthbox_elements.png")

    def tile(n, count=1):
        tiles = [crop(he_rgba, (k % 40) * 8, (k // 40) * 8, 8, 8) for k in range(n, n + count)]
        return np.concatenate(tiles, axis=1)
    save(tile(1, 2), "ui/battle/hp_label.png")
    for nm, base in (("green", 3), ("yellow", 47), ("red", 56)):
        save(tile(base, 9), f"ui/battle/hpbar_{nm}_strip.png",
             frames={"w": 8, "h": 8, "count": 9, "layout": "horizontal",
                     "note": "frame k = 8px bar tile with k pixels filled"})
        save(np.concatenate([tile(1, 2)] + [tile(base + 8)] * 6, axis=1), f"ui/battle/hpbar_{nm}_full.png")
    save(np.concatenate([tile(1, 2)] + [tile(3)] * 6, axis=1), "ui/battle/hpbar_empty.png")
    save(tile(12, 9), "ui/battle/expbar_strip.png", frames={"w": 8, "h": 8, "count": 9, "layout": "horizontal"})
    for i, n in enumerate(["psn", "par", "slp", "frz", "brn"]):
        save(tile(21 + 3 * i, 3), f"ui/battle/status_{n}.png")
        MANIFEST["groups"]["battleUi"][f"status_{n}"] = f"ui/battle/status_{n}.png"
    for nm, t in (("ball_ok", 66), ("ball_empty", 67), ("ball_status", 68), ("ball_fainted", 69), ("ball_caught", 70)):
        save(tile(t), f"ui/battle/{nm}.png")
        MANIFEST["groups"]["battleUi"][nm] = f"ui/battle/{nm}.png"
    for nm, sh in (("singles_player", 64), ("singles_opponent", 32), ("doubles_player", 32), ("doubles_opponent", 32)):
        f = BI / f"healthbox_{nm}.png"
        idx = load_idx(f)
        ntiles = 8 * (sh // 8)
        full = np.concatenate([sprite_1d(idx, 64, sh, 0), sprite_1d(idx, 64, sh, ntiles)], axis=1)
        save(trim(colorize(full, hbox)), f"ui/battle/healthbox_{nm}.png", src=[f, BI / "healthbox.pal"])
        MANIFEST["groups"]["battleUi"][f"healthbox_{nm}"] = f"ui/battle/healthbox_{nm}.png"
    idx = load_idx(BI / "healthbox_safari.png")
    full = np.concatenate([idx[:64], idx[64:128]], axis=1)
    save(trim(colorize(full, hbox)), "ui/battle/healthbox_safari.png", src=BI / "healthbox_safari.png")
    simple_sprite(BI / "party_summary_bar.png", "ui/battle/party_summary_bar.png", pal=hbox)
    simple_sprite(BI / "level_up_banner.png", "ui/battle/level_up_banner.png")
    simple_sprite(BI / "enemy_mon_shadow.png", "ui/battle/enemy_mon_shadow.png")
    # ---- poke balls (battle throw sprites): 16x48 = closed / half-open / open ----
    bo = load_idx(GI / "ball_open.png")
    for f in sorted((GI / "ball").glob("*.png")):
        idx = load_idx(f).copy()
        if f.stem not in ("dive", "luxury", "premier"):
            idx[32:48] = bo  # pokeball.c copies ball_open over the open frame for most balls
        save(colorize(idx, png_palette(f)), f"ui/balls/{f.stem}.png",
             frames={"w": 16, "h": 16, "count": 3, "layout": "vertical", "names": ["closed", "half_open", "open"]}, src=f)
        MANIFEST["groups"]["balls"][f.stem] = f"ui/balls/{f.stem}.png"
    # ---- text windows ----
    TW = G / "text_window"
    frame_pal = {"std": TW / "stdpal_3.pal"}
    for i in range(1, 11):
        frame_pal[f"type{i}"] = TW / f"type{i}.png"
    for nm, pp in frame_pal.items():
        idx = load_idx(TW / f"{nm}.png")
        pal = pal_of(pp)
        tiles_rgba = colorize(idx, pal)
        save(tiles_rgba, f"ui/text_window/{nm}_tiles.png", src=[TW / f"{nm}.png", pp])
        nine = tiles_rgba.copy()
        nine[8:16, 8:16] = (*pal[1], 255)  # interior: windows are filled with palette index 1
        save(nine, f"ui/text_window/{nm}.png", nineSlice={"left": 8, "top": 8, "right": 8, "bottom": 8},
             note="3x3 tiles; centre = window fill colour (palette index 1)")
        MANIFEST["groups"]["textWindows"][nm] = {"file": f"ui/text_window/{nm}.png", "nineSlice": [8, 8, 8, 8]}

    def dialogue(src_png, pal, W, signpost=False):
        tiles = tiles_of(load_idx(src_png))
        rows = [[(0, 0), (1, 0)] + [(2, 0)] * W + [(3, 0), (4, 0)],
                [(5, 0), (6, 0)] + [None] * W + [(8, 0), (9, 0)],
                [(10, 0), (11, 0)] + [None] * W + [(12, 0), (13, 0)],
                [(10, 1), (11, 1)] + [None] * W + [(12, 1), (13, 1)],
                [(5, 1), (6, 1)] + [None] * W + [(8, 1), (9, 1)],
                [(0, 1), (1, 1)] + [(2, 1)] * W + [(3, 1), (4, 1)]]
        if signpost:
            rows[3], rows[4] = rows[4], rows[3]
        grid = np.zeros((6, W + 4), np.uint16)
        fill = len(tiles)
        tiles = np.concatenate([tiles, np.full((1, 8, 8), 1, np.uint8)])
        for y, r in enumerate(rows):
            for x, t in enumerate(r):
                grid[y, x] = fill if t is None else (t[0] | (0x800 if t[1] else 0))
        return render_map(tiles, grid, pal)
    mm_pal = read_jasc(TW / "stdpal_0.pal")
    save(dialogue(TW / "menu_message.png", mm_pal, 26), "ui/text_window/dialogue_box.png",
         src=[TW / "menu_message.png", TW / "stdpal_0.pal"], note="240x48 field message box (screen tiles y=14..19)")
    save(dialogue(TW / "menu_message.png", mm_pal, 1), "ui/text_window/dialogue_9slice.png",
         nineSlice={"left": 16, "top": 16, "right": 16, "bottom": 16})
    sp_pal = read_jasc(TW / "stdpal_1.pal")
    save(dialogue(TW / "signpost.png", sp_pal, 26, signpost=True), "ui/text_window/signpost_box.png",
         src=[TW / "signpost.png", TW / "stdpal_1.pal"])
    simple_sprite(TW / "menu_message.png", "ui/text_window/menu_message_tiles.png", pal=mm_pal)
    simple_sprite(TW / "signpost.png", "ui/text_window/signpost_tiles.png", pal=sp_pal)
    MANIFEST["groups"]["textWindows"]["dialogue"] = {"file": "ui/text_window/dialogue_box.png",
                                                     "nineSlice": "ui/text_window/dialogue_9slice.png"}
    MANIFEST["groups"]["textWindows"]["signpost"] = {"file": "ui/text_window/signpost_box.png"}
    # ---- cursors / arrows ----
    rp = read_jasc(GI / "red_arrow.pal")
    simple_sprite(GI / "red_arrow.png", "ui/cursors/red_arrow.png", pal=rp)
    ro = colorize(load_idx(GI / "red_arrow_other.png"), rp)
    save(ro[0:16], "ui/cursors/scroll_left.png")
    save(ro[0:16, ::-1], "ui/cursors/scroll_right.png")
    save(ro[16:32], "ui/cursors/scroll_up.png")
    save(ro[16:32][::-1], "ui/cursors/scroll_down.png")
    simple_sprite(GI / "selector_outline.png", "ui/cursors/selector_outline_tiles.png")
    da = colorize(load_idx(G / "fonts/down_arrows.png"), mm_pal)
    save(da, "ui/cursors/down_arrows_sheet.png", src=G / "fonts/down_arrows.png")
    save(np.concatenate([crop(da, x, 0, 10, 12) for x in (0, 16, 32, 16)], axis=1), "ui/cursors/text_advance_arrow.png",
         frames={"w": 10, "h": 12, "count": 4, "layout": "horizontal"}, note="red 'more text' arrow, bobbing anim")
    save(np.concatenate([crop(da, 64 + x, 0, 10, 12) for x in (0, 16, 32, 16)], axis=1),
         "ui/cursors/text_advance_arrow_dark.png", frames={"w": 10, "h": 12, "count": 4, "layout": "horizontal"})
    for n in ["red_arrow", "scroll_left", "scroll_right", "scroll_up", "scroll_down", "text_advance_arrow"]:
        MANIFEST["groups"]["cursors"][n] = f"ui/cursors/{n}.png"
    # ---- party menu / summary small sprites ----
    PM = G / "party_menu"
    simple_sprite(PM / "pokeball.png", "ui/party/pokeball.png", frames=(32, 32))
    simple_sprite(PM / "pokeball_small.png", "ui/party/pokeball_small.png", frames=(16, 16))
    simple_sprite(PM / "hold_icons.png", "ui/party/hold_icons.png", frames=(8, 8))
    simple_sprite(G / "summary_screen/shiny_star.png", "ui/summary/shiny_star.png")
    simple_sprite(G / "summary_screen/pokerus_cured.png", "ui/summary/pokerus_cured.png")
    # ---- emotes & sparkles ----
    em = colorize(load_idx(G / "misc/emoticons.png"), read_jasc(G / "object_events/palettes/player.pal"))
    for i, n in enumerate(["exclamation", "double_exclamation", "x", "smile", "question"]):
        save(em[i * 16:(i + 1) * 16], f"misc/emotes/{n}.png", frames=frames_of(48, 16, 16, 16), src=G / "misc/emoticons.png")
    simple_sprite(G / "battle_anims/sprites/gold_stars.png", "misc/shiny_sparkle.png",
                  note="shiny battle sparkle: 16x16 star at (0,0); 8x8 mini stars at (0,16),(8,16)")
    if verify:
        items = [(t, f"ui/types/{t}.png") for t in MANIFEST["groups"]["types"]]
        items += [(k, v) for k, v in MANIFEST["groups"]["menuInfo"].items()]
        items += [(k, v) for k, v in MANIFEST["groups"]["status"].items()]
        items += [(k, v) for k, v in MANIFEST["groups"]["battleUi"].items() if "healthbox" not in k]
        contact_sheet(items, "ui_icons", cell=(40, 12), cols=8, scale=3, bg=(200, 200, 200))
        items = [(k, v) for k, v in MANIFEST["groups"]["battleUi"].items() if "healthbox" in k]
        items += [(n, f"ui/battle/{n}.png") for n in ["hpbar_green_full", "hpbar_yellow_full", "hpbar_red_full",
                                                     "hpbar_empty", "expbar_strip", "party_summary_bar",
                                                     "level_up_banner", "healthbox_safari"]]
        contact_sheet(items, "ui_battle", cell=(128, 64), cols=4, scale=2, bg=(120, 180, 120))
        items = [(k, v) for k, v in MANIFEST["groups"]["balls"].items()]
        items += [(k, v) for k, v in MANIFEST["groups"]["cursors"].items()]
        items += [(n, f"misc/emotes/{n}.png") for n in ["exclamation", "question", "smile"]]
        items += [("sparkle", "misc/shiny_sparkle.png")]
        contact_sheet(items, "ui_balls_cursors", cell=(48, 48), cols=12, scale=3)
        items = [(k, f"ui/text_window/{k}.png") for k in frame_pal]
        contact_sheet(items, "ui_frames", cell=(24, 24), cols=11, scale=4)
        items = [("dialogue", "ui/text_window/dialogue_box.png"), ("signpost", "ui/text_window/signpost_box.png"),
                 ("9slice", "ui/text_window/dialogue_9slice.png")]
        contact_sheet(items, "ui_dialogue", cell=(240, 48), cols=1, scale=2)


# ===========================================================================
# 5b. Tilemapped screens (rendered from tiles + tilemap + palette)
# ===========================================================================

def grid_from(path_or_entries, width: int, rows: int | None = None, fill: int = 0) -> np.ndarray:
    """Raw tilemap -> 2D grid with the given row width."""
    e = read_bin(path_or_entries) if isinstance(path_or_entries, (str, Path)) else np.asarray(path_or_entries, np.uint16)
    n = -(-len(e) // width)
    if rows:
        n = max(n, rows)
    g = np.full(n * width, fill, np.uint16)
    g[:len(e)] = e
    g = g.reshape(n, width)
    return g[:rows] if rows else g


def screen(*layers, backdrop=None) -> np.ndarray:
    """Composite RGBA layers (first = bottom) over an optional backdrop colour."""
    h, w = layers[0].shape[:2]
    out = np.zeros((h, w, 4), np.uint8)
    if backdrop is not None:
        out[...] = (*backdrop, 255)
    for L in layers:
        out = alpha_over(out, L[:h, :w])
    return out


def view(arr, w=240, h=160, x=0, y=0):
    return arr[y:y + h, x:x + w]


def blend(bottom, top, eva=16, evb=0):
    """GBA alpha blend: top*eva/16 + bottom*evb/16 where top is opaque."""
    out = bottom.copy()
    m = top[..., 3] > 0
    t = top[..., :3].astype(np.int32)
    b = bottom[..., :3].astype(np.int32)
    mix = np.minimum(255, (t * eva + b * evb) // 16)
    out[m, :3] = mix[m]
    out[m, 3] = 255
    return out


def section_screens(verify: bool):
    print("== screens")
    begin(["ui/screens/", "ui/party/bg", "ui/party/slot", "ui/summary/page_", "ui/bag/", "ui/shop/",
           "ui/pokedex/", "ui/title/", "ui/region_map/", "misc/trainer_card/", "misc/badges/",
           "misc/evolution/", "misc/hall_of_fame/", "misc/oak_speech/", "misc/pc_wallpapers/",
           "misc/tm_case/", "misc/berry_pouch/", "misc/battle_transitions/", "ui/battle/action_menu.png",
           "ui/battle/move_menu.png", "ui/battle/message_box_full.png", "ui/battle/textbox.png"],
          ["screens", "badges", "pcWallpapers"])
    S = MANIFEST["groups"]["screens"]

    def put(arr, out, key=None, **kw):
        save(arr, out, **kw)
        S[key or out.rsplit("/", 1)[-1][:-4]] = out

    # ---------------- party menu ----------------
    PMD = G / "party_menu"
    tiles = load_tiles(PMD / "bg.png")
    pal176 = png_palette(PMD / "bg.png")
    pal = list(pal176)
    for b in range(4, 9):
        pal[b * 16:b * 16 + 16] = pal176[48:64]
    bgpal = bg_palette((0, pal[:176]))
    bg1 = render_map(tiles, grid_from(PMD / "bg.bin", 32), bgpal, transparent0=False)
    put(view(bg1), "ui/party/bg.png", "party_bg", src=[PMD / "bg.png", PMD / "bg.bin"])

    def slot(binf, w, h, state="normal"):
        idx = np.frombuffer(binf.read_bytes(), np.uint8)
        g = idx.reshape(h, w).astype(np.uint16) | (3 << 12)
        sp = list(pal[:256])
        swaps = {"selected": ((116, 117, 118), (97, 103, 104)), "fainted": ((84, 85, 86), (81, 87, 88)),
                 "switching": ((100, 101, 102), (161, 167, 168)), "partner": ((68, 69, 70), (65, 71, 72))}
        if state in swaps:
            a, b = swaps[state]
            for dst, srcc in zip((4, 5, 6), a):
                sp[48 + dst] = pal176[srcc]
            for dst, srcc in zip((1, 7, 8), b):
                sp[48 + dst] = pal176[srcc]
        return render_map(tiles, g, bg_palette((0, sp)), transparent0=True)
    for state in ("normal", "selected", "fainted", "switching"):
        put(slot(PMD / "slot_main.bin", 10, 7, state), f"ui/party/slot_main_{state}.png", f"party_slot_main_{state}")
        put(slot(PMD / "slot_wide.bin", 18, 3, state), f"ui/party/slot_wide_{state}.png", f"party_slot_wide_{state}")
    put(slot(PMD / "slot_wide_empty.bin", 18, 3), "ui/party/slot_wide_empty.png", "party_slot_wide_empty")
    put(slot(PMD / "slot_main_no_hp.bin", 10, 7), "ui/party/slot_main_no_hp.png", "party_slot_main_no_hp")
    put(slot(PMD / "slot_wide_no_hp.bin", 18, 3), "ui/party/slot_wide_no_hp.png", "party_slot_wide_no_hp")
    comp = view(bg1).copy()
    comp = alpha_over(comp, np.pad(slot(PMD / "slot_main.bin", 10, 7, "selected"), ((24, 160 - 24 - 56), (8, 240 - 8 - 80), (0, 0))))
    for i, y in enumerate((1, 4, 7, 10, 13)):
        s_ = slot(PMD / ("slot_wide.bin" if i < 3 else "slot_wide_empty.bin"), 18, 3)
        comp = alpha_over(comp, np.pad(s_, ((y * 8, 160 - y * 8 - 24), (96, 240 - 96 - 144), (0, 0))))
    put(comp, "ui/screens/party_menu_example.png", "party_menu_example")

    # ---------------- summary screen ----------------
    SM = G / "summary_screen"
    tiles = load_tiles(SM / "bg.png")
    p112 = png_palette(SM / "bg.png")
    for shiny in (False, True):
        sp = list(p112[:80])
        if shiny:
            sp[0:16], sp[16:32] = p112[96:112], p112[80:96]
        bgpal = bg_palette((0, sp))
        base_a = render_map(tiles, grid_from(SM / "moves_info_page.bin", 32, 20), bgpal, transparent0=False)
        base_b = render_map(tiles, grid_from(SM / "moves_page.bin", 32, 20), bgpal, transparent0=False)
        suffix = "_shiny" if shiny else ""
        for page, base, layer in (("info", base_a, "page_info.bin"), ("skills", base_a, "page_skills.bin"),
                                  ("moves", base_a, "page_moves.bin"), ("moves_detail", base_b, "page_moves_info.bin"),
                                  ("egg", base_a, "page_egg.bin")):
            top = render_map(tiles, grid_from(SM / layer, 32, 20), bgpal)
            put(view(screen(base, top)), f"ui/summary/page_{page}{suffix}.png", f"summary_{page}{suffix}",
                src=[SM / "bg.png", SM / layer])
            if shiny:
                break  # shiny tint only matters for the left pane; one example is enough

    # ---------------- bag ----------------
    IM = G / "item_menu"
    tiles = load_tiles(IM / "bg.png")
    p48 = png_palette(IM / "bg.png")[:48]
    for variant, palset, binf in (("male", p48, "bg.bin"),
                                  ("female", read_jasc(IM / "bg_female.pal")[:16] + p48[16:48], "bg.bin"),
                                  ("item_pc", p48, "bg_item_pc.bin")):
        img = render_map(tiles, grid_from(IM / binf, 32), bg_palette((0, palset)), transparent0=False)
        put(view(img), f"ui/bag/bg_{variant}.png", f"bag_bg_{variant}", src=[IM / "bg.png", IM / binf])
    bagpal = read_jasc(G / "interface/bag.pal")
    for g_ in ("male", "female"):
        simple_sprite(G / f"interface/bag_{g_}.png", f"ui/bag/bag_{g_}.png", pal=bagpal, frames=(64, 64),
                      note="frames: items, key items, poke balls, (opening)")
        S[f"bag_sprite_{g_}"] = f"ui/bag/bag_{g_}.png"

    # ---------------- shop ----------------
    SH = G / "shop_menu"
    tiles = load_tiles(SH / "shop_menu.png")
    sp = png_palette(SH / "shop_menu.png")
    for variant, binf in (("", "shop_tilemap.bin"), ("_tm", "shop_tm_hm_tilemap.bin")):
        g = grid_from(SH / binf, 32)
        tm = np.where(g != 0, (g & 0x3FF) | (11 << 12), 0xFFFF).astype(np.uint16)
        bgpal = bg_palette((11, sp[:16]), (6, sp[16:32]))
        img = render_map(tiles, tm, bgpal)
        put(view(img), f"ui/shop/shop_frame{variant}.png", f"shop_frame{variant}", src=[SH / "shop_menu.png", SH / binf],
            note="transparent where the live map view shows through")

    # ---------------- pokedex ----------------
    PD = G / "pokedex"
    for dex in ("national", "kanto"):
        tiles = load_tiles(PD / f"{dex}_dex_bgtiles.png")
        bgpal = bg_palette((0, read_jasc(PD / f"{dex}_dex_bgpals.pal")))
        H_ = lambda t: t | 0x400  # noqa: E731
        g3 = np.full((20, 30), 1, np.uint16)
        g3[2] = [4] + [5] * 28 + [H_(4)]
        for y in range(3, 17):
            if y < 11:
                l, m_ = 6, 1
            elif y == 11:
                l, m_ = 7, 8
            else:
                l, m_ = 9, 2
            g3[y] = [l] + [m_] * 28 + [H_(l)]
        g3[17] = [10] + [11] * 28 + [H_(10)]
        g0 = np.zeros((20, 30), np.uint16)
        g0[[0, 1, 18, 19]] = 3 | (15 << 12)
        L3 = render_map(tiles, g3, bgpal, transparent0=False)
        L0 = render_map(tiles, g0, bgpal)
        put(screen(L3, L0), f"ui/pokedex/{dex}_entry_page.png", f"pokedex_{dex}_entry")
        gl = np.full((20, 30), 0x0E, np.uint16)
        put(screen(render_map(tiles, gl, bgpal, transparent0=False), L0), f"ui/pokedex/{dex}_list_bg.png", f"pokedex_{dex}_list")
        save(colorize(load_idx(PD / f"{dex}_dex_bgtiles.png"), bgpal[:16]), f"ui/pokedex/{dex}_tiles.png")
    for f in sorted(PD.glob("cat_icon_*.png")):
        simple_sprite(f, f"ui/pokedex/{f.stem}.png")
    simple_sprite(PD / "caught_marker.png", "ui/pokedex/caught_marker.png")

    # ---------------- region map ----------------
    RM = G / "region_map"
    rpal = read_jasc(RM / "region_map.pal")
    topbar = read_jasc(RM / "top_bar.pal")
    rp = list(rpal[:80])
    for i in range(15):
        rp[32 + i] = tuple(((((c << 8) // 100) * 95) >> 8) for c in rpal[32 + i])
    for b in range(5):
        rp[b * 16] = topbar[15]
    bgpal = bg_palette((0, rp), (12, topbar))
    tiles0 = load_tiles(RM / "region_map.png")
    edge_tiles = load_tiles(RM / "map_edge.png")
    ge = grid_from(RM / "map_edge.bin", 30, 20)
    ge[1] = [2 | 0x2000, 3 | 0x2000] + [0x3D | 0x2000] * 26 + [0x3E | 0x2000, 0x3F | 0x2000]
    L1 = render_map(edge_tiles, ge, bgpal)
    bgt = load_tiles(RM / "background.png")
    L1b = render_map(bgt, grid_from(RM / "background.bin", 30, 20), bgpal)
    for mp in ("kanto", "sevii_123", "sevii_45", "sevii_67"):
        L0 = render_map(tiles0, grid_from(RM / f"{mp}.bin", 30, 20), bgpal)
        put(screen(L1, L0, backdrop=topbar[15]), f"ui/region_map/{mp}.png", f"region_map_{mp}",
            src=[RM / "region_map.png", RM / f"{mp}.bin"])
        put(screen(L1b, L0, backdrop=topbar[15]), f"ui/region_map/{mp}_fly.png", f"region_map_{mp}_fly")
        put(L0, f"ui/region_map/{mp}_map_only.png", f"region_map_{mp}_map_only")
    for nm, pn in (("cursor", "cursor"), ("player_icon_red", "player_icon_red"), ("player_icon_leaf", "player_icon_leaf"),
                   ("fly_icon", "misc_icon"), ("dungeon_icon", "misc_icon")):
        simple_sprite(RM / f"{nm}.png", f"ui/region_map/{nm}.png", pal=read_jasc(RM / f"{pn}.pal"))
        S[f"region_map_{nm}"] = f"ui/region_map/{nm}.png"

    # ---------------- title screen (FireRed) ----------------
    TS = G / "title_screen"
    FR = TS / "firered"
    logo_pal = read_jasc(FR / "game_title_logo.pal")[:208]
    bgp = read_jasc(FR / "background.pal")
    bgpal = bg_palette((0, logo_pal), (13, read_jasc(FR / "box_art_mon.pal")), (14, bgp), (15, bgp))
    logo_tiles = tiles_of(load_idx(FR / "game_title_logo.png"))
    L0 = render_map(logo_tiles, grid_from(FR / "game_title_logo.bin", 32, 20), bgpal, bpp8=True)
    L1 = render_map(load_tiles(FR / "box_art_mon.png"), grid_from(FR / "box_art_mon.bin", 32, 20), bgpal)
    L2 = render_map(load_tiles(TS / "copyright_press_start.png"), grid_from(TS / "copyright_press_start.bin", 32, 20), bgpal)
    L3 = render_map(load_tiles(TS / "border_bg.png"), grid_from(FR / "border_bg.bin", 32, 20), bgpal)
    put(view(screen(L3, L2, L1, L0, backdrop=logo_pal[0])), "ui/title/title_screen.png", "title_screen")
    put(view(L0), "ui/title/logo_layer.png", "title_logo_layer")
    put(trim_box(view(L0)), "ui/title/logo.png", "title_logo")
    put(view(L1), "ui/title/charizard_layer.png", "title_charizard_layer")
    put(trim_box(view(L1)), "ui/title/charizard.png", "title_charizard")
    put(view(L2), "ui/title/copyright_press_start_layer.png", "title_copyright_layer")
    put(view(screen(L3, backdrop=logo_pal[0])), "ui/title/border_bg.png", "title_border")
    simple_sprite(FR / "flames.png", "ui/title/flames.png", frames=(16, 16), note="title flame sprite frames")
    simple_sprite(TS / "slash.png", "ui/title/slash.png", pal=read_jasc(FR / "slash.pal"))

    # ---------------- trainer card + badges ----------------
    TC = G / "trainer_card"
    tiles = load_tiles(TC / "tiles.png")
    badge_tiles = load_tiles(TC / "badges.png")
    allt = np.concatenate([tiles, np.zeros((max(0, 192 - len(tiles)), 8, 8), np.uint8), badge_tiles])
    badge_pal = png_palette(TC / "badges.png")
    for stars, pn in enumerate(["blue", "green", "bronze", "silver", "gold"]):
        bgpal = bg_palette((0, read_jasc(TC / f"{pn}.pal")), (3, badge_pal), (4, read_jasc(TC / "star.pal")))
        Lbg = render_map(allt, grid_from(TC / "bg.bin", 30, 20), bgpal, transparent0=False)
        for side in ("front", "back"):
            Lc = render_map(allt, grid_from(TC / f"{side}.bin", 30, 20), bgpal)
            g3 = np.zeros((20, 30), np.uint16)
            if side == "front":
                for i in range(8):
                    x = 4 + 3 * i
                    g3[16, x], g3[16, x + 1] = (192 + 2 * i) | 0x3000, (193 + 2 * i) | 0x3000
                    g3[17, x], g3[17, x + 1] = (208 + 2 * i) | 0x3000, (209 + 2 * i) | 0x3000
                for k in range(stars):
                    g3[7, 15 + k] = 143 | 0x4000
            L3 = render_map(allt, g3, bgpal)
            put(screen(Lbg, Lc, L3), f"misc/trainer_card/{side}_{pn}.png", f"trainer_card_{side}_{pn}",
                note=f"{stars} star card palette ({pn}.pal); front shows all 8 badges")
    bnames = ["boulder", "cascade", "thunder", "rainbow", "soul", "marsh", "volcano", "earth"]
    bimg = colorize(load_idx(TC / "badges.png"), badge_pal)
    for i, n in enumerate(bnames):
        save(bimg[:, 16 * i:16 * i + 16], f"misc/badges/{n}.png", src=TC / "badges.png")
        MANIFEST["groups"]["badges"][n] = f"misc/badges/{n}.png"
    save(bimg, "misc/badges/all_badges.png", frames=frames_of(128, 16, 16, 16))

    # ---------------- battle textbox views (BG0 VOFS 0 / 160 / 320) ----------------
    BI = G / "battle_interface"
    tb_tiles = load_tiles(BI / "textbox.png").copy()
    frame = tiles_of(load_idx(G / "text_window/type1.png"))
    tb_tiles = np.concatenate([tb_tiles, np.zeros((max(0, 0x2B - len(tb_tiles)), 8, 8), np.uint8)])
    tb_tiles[0x12:0x12 + 9] = frame[:9]
    tb_tiles[0x22:0x22 + 9] = frame[:9]
    tbp = read_jasc(BI / "textbox1.pal")
    bgpal = bg_palette((0, tbp), (1, read_jasc(G / "text_window/type1.png".replace(".png", ".pal")) if
                                  (G / "text_window/type1.pal").exists() else png_palette(G / "text_window/type1.png")))
    full, _, _ = sbb_to_linear(read_bin(BI / "textbox.bin"), 2)
    tbimg = render_map(tb_tiles, full[:, :30], bgpal)
    put(tbimg[0:160], "ui/battle/message_box_full.png", "battle_message_box_screen")
    put(tbimg[112:160], "ui/battle/textbox.png", "battle_textbox", note="240x48 battle message box (screen y=112..159)")
    put(tbimg[160:320], "ui/battle/action_menu.png", "battle_action_menu",
        note="BG0 at VOFS 160: FIGHT/BAG/POKeMON/RUN box (text drawn separately)")
    put(tbimg[320:480], "ui/battle/move_menu.png", "battle_move_menu", note="BG0 at VOFS 320: move selection boxes")

    # ---------------- evolution scene ----------------
    EV = G / "evolution_scene"
    B = G / "battle_terrain"
    tiles = load_tiles(B / "building/terrain.png")
    grid, _, _ = sbb_to_linear(read_bin(B / "building/terrain.bin"), 1)
    L3 = render_map(tiles, grid, bg_palette((2, read_jasc(B / "indoor/plain.pal"))), transparent0=False)
    put(L3[:160, 256:256 + 240], "misc/evolution/static_bg.png", "evolution_static_bg",
        note="plain indoor terrain at BG3 X=256 (what the evolution screen shows before the swirl)")
    etiles = load_tiles(EV / "bg.png")
    trans = read_jasc(EV / "transition.pal")
    evtxt = src_text("src/evolution_scene.c")
    m = re.search(r"sBgAnim_PalIndexes\[\]\[16\]\s*=\s*\{(.*?)\};", evtxt, re.S)
    rows_ = [[int(x) for x in re.findall(r"\d+", r)] for r in re.findall(r"\{([^{}]*)\}", m.group(1))]
    frames_ = []
    for k in (13, 24, 30, 36):
        if k < len(rows_):
            pal16 = [trans[i] if i < len(trans) else (0, 0, 0) for i in rows_[k]]
            bp = bg_palette((10, pal16), (0, [(0, 0, 0)]))
            l1 = render_map(etiles, grid_from(EV / "bg.bin", 32), bp, pal_add=0)
            l2 = render_map(etiles, grid_from(EV / "bg2.bin", 32), bp)
            frames_.append(view(blend(screen(l2, backdrop=(0, 0, 0)), l1, 8, 8)))
    if frames_:
        put(np.concatenate(frames_, axis=1), "misc/evolution/swirl_frames.png", "evolution_swirl",
            frames={"w": 240, "h": 160, "count": len(frames_), "layout": "horizontal"},
            note="moving evolution background, a few palette-cycle frames (BG1 blended 8/8 over BG2)")
    simple_sprite(EV / "sparkle.png", "misc/evolution/sparkle.png")

    # ---------------- hall of fame ----------------
    HF = G / "hall_of_fame"
    tiles = load_tiles(HF / "hall_of_fame.png")
    bp = bg_palette((0, png_palette(HF / "hall_of_fame.png")))
    g1 = np.zeros((20, 30), np.uint16)
    g1[[0, 1] + list(range(14, 20))] = 1
    L1 = render_map(tiles, g1, bp)
    L3 = render_map(tiles, np.full((20, 30), 2, np.uint16), bp, transparent0=False)
    put(blend(L3, L1, 16, 7), "misc/hall_of_fame/bg.png", "hall_of_fame_bg")

    # ---------------- oak speech ----------------
    OS = G / "oak_speech"
    bp = bg_palette((0, png_palette(OS / "bg_tiles.png")[:64]))
    L1 = render_map(load_tiles(OS / "oak_speech_bg.png"), grid_from(OS / "oak_speech_bg.bin", 32, 20), bp, transparent0=False)
    put(view(L1), "misc/oak_speech/bg.png", "oak_speech_bg")
    for who in ("oak", "red", "leaf", "rival"):
        idx = load_idx(OS / who / "pic.png")
        pp = read_jasc(OS / who / "pal.pal")
        base = (int(idx[idx > 0].min()) // 16) * 16 if (idx > 0).any() else 0
        arr = colorize((idx.astype(np.int32) - base).clip(0, 255).astype(np.uint8), pp, mask4=False)
        arr[idx == 0] = 0
        arr[idx == base] = 0
        put(arr, f"misc/oak_speech/{who}.png", f"oak_speech_{who}", src=[OS / who / "pic.png", OS / who / "pal.pal"])
    simple_sprite(OS / "platform.png", "misc/oak_speech/platform.png", pal=read_jasc(OS / "platform.pal"))
    composite = view(L1).copy()
    oak = np.array(Image.open(OUT / "misc/oak_speech/oak.png"))
    composite = alpha_over(composite, np.pad(oak, ((16, 160 - 16 - oak.shape[0]), (88, 240 - 88 - oak.shape[1]), (0, 0))))
    put(composite, "ui/screens/oak_speech_example.png", "oak_speech_example")

    # ---------------- PC box wallpapers ----------------
    WP = G / "pokemon_storage/wallpapers"
    for d in sorted(p for p in WP.iterdir() if p.is_dir()):
        tiles = load_tiles(d / "tiles.png")
        wp = png_palette(d / "tiles.png")[:32]
        g = grid_from(d / "tilemap.bin", 20, 18)
        img = render_map(tiles, g, bg_palette((1, wp)), transparent0=False)
        save(img, f"misc/pc_wallpapers/{d.name}.png", src=[d / "tiles.png", d / "tilemap.bin"])
        MANIFEST["groups"]["pcWallpapers"][d.name] = f"misc/pc_wallpapers/{d.name}.png"
    PS = G / "pokemon_storage"
    menu_t = load_tiles(PS / "menu.png")
    L1 = render_map(menu_t, grid_from(PS / "menu.bin", 32, 20), bg_palette((0, read_jasc(PS / "interface.pal")),
                                                                         (2, read_jasc(PS / "interface_no_display_mon.pal"))),
                    tile_base=256)
    sc = render_map(load_tiles(PS / "scrolling_bg.png"), grid_from(PS / "scrolling_bg.bin", 32),
                    bg_palette((3, png_palette(PS / "scrolling_bg.png"))), transparent0=False)
    first = np.array(Image.open(OUT / "misc/pc_wallpapers/forest.png"))
    wall = np.zeros((160, 240, 4), np.uint8)
    wall[16:16 + first.shape[0], 80:80 + first.shape[1]] = first
    put(screen(view(sc), wall, view(L1)), "ui/screens/pc_box_example.png", "pc_box_example")
    put(view(L1), "misc/pc_wallpapers/_interface_layer.png", "pc_interface_layer")

    # ---------------- TM case / berry pouch ----------------
    TM = G / "tm_case"
    tiles = load_tiles(TM / "tm_case.png")
    for g_ in ("male", "female"):
        bp = bg_palette((0, read_jasc(TM / f"menu_{g_}.pal")))
        L2 = render_map(tiles, grid_from(TM / "menu.bin", 32), bp, transparent0=False)
        L1 = render_map(tiles, grid_from(TM / "tm_case.bin", 32), bp)
        put(view(screen(L2, L1)), f"misc/tm_case/bg_{g_}.png", f"tm_case_{g_}")
    BP = G / "berry_pouch"
    tiles = load_tiles(BP / "background.png")
    p48 = png_palette(BP / "background.png")[:48]
    for g_, pal_ in (("male", p48), ("female", read_jasc(BP / "background_female.pal")[:16] + p48[16:])):
        put(view(render_map(tiles, grid_from(BP / "background.bin", 32), bg_palette((0, pal_)), transparent0=False)),
            f"misc/berry_pouch/bg_{g_}.png", f"berry_pouch_{g_}")
    simple_sprite(BP / "berry_pouch.png", "misc/berry_pouch/berry_pouch.png", frames=(64, 64))

    # ---------------- battle transitions (raw pieces) ----------------
    BT = G / "battle_transitions"
    for nm in ("big_pokeball", "sliding_pokeball", "vs_frame"):
        simple_sprite(BT / f"{nm}.png", f"misc/battle_transitions/{nm}.png")
    vs = load_idx(BT / "vs.png")
    vsr = colorize(vs, png_palette(BT / "vs.png"), mask4=False)
    vsr[(vs & 15) == 0] = 0
    save(vsr, "misc/battle_transitions/vs_letters.png", src=BT / "vs.png")

    if verify:
        keys = [k for k, v in S.items() if MANIFEST["files"].get(v, {}).get("w") == 240 and MANIFEST["files"][v]["h"] == 160]
        contact_sheet([(k, S[k]) for k in keys], "screens", cell=(240, 160), cols=5, bg=(255, 0, 255))
        contact_sheet([(k, v) for k, v in MANIFEST["groups"]["badges"].items()], "badges", cell=(16, 16), cols=8, scale=6)
        contact_sheet([(k, v) for k, v in MANIFEST["groups"]["pcWallpapers"].items()], "pc_wallpapers", cell=(160, 144), cols=8)
        others = [(k, v) for k, v in S.items() if k not in keys]
        contact_sheet(others, "screens_pieces", cell=(144, 64), cols=8, scale=2, bg=(255, 0, 255))


def trim_box(arr):
    ys, xs = np.nonzero(arr[..., 3])
    if len(ys) == 0:
        return arr
    return arr[ys.min(): ys.max() + 1, xs.min(): xs.max() + 1]


# ===========================================================================

SECTIONS = {
    "pokemon": section_pokemon,
    "trainers": section_trainers,
    "items": section_items,
    "terrain": section_terrain,
    "overworld": section_overworld,
    "field_effects": section_field_effects,
    "fonts": section_fonts,
    "ui_sprites": section_ui_sprites,
    "screens": section_screens,
}


def main(argv):
    verify = "--verify" in argv
    names = [a for a in argv if not a.startswith("-")] or list(SECTIONS)
    full = not [a for a in argv if not a.startswith("-")]
    mpath = OUT / "manifest.json"
    if not full and mpath.exists():
        old = json.loads(mpath.read_text())
        MANIFEST["files"].update(old.get("files", {}))
        for k, v in old.get("groups", {}).items():
            MANIFEST["groups"][k] = v
    if full and OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True, exist_ok=True)
    for n in names:
        # drop stale entries for re-run sections
        SECTIONS[n](verify)
    MANIFEST["groups"] = dict(MANIFEST["groups"])
    MANIFEST["files"] = dict(sorted(MANIFEST["files"].items()))
    MANIFEST["warnings"] = WARNINGS
    with open(mpath, "w", encoding="utf-8") as fp:
        json.dump(MANIFEST, fp, indent=1, ensure_ascii=False)
    print(f"wrote {len(MANIFEST['files'])} files; {len(WARNINGS)} warnings")


if __name__ == "__main__":
    main(sys.argv[1:])
