#!/usr/bin/env python3
"""
Kanto Spire -- FireRed move-animation data extractor.

Reads the pret/pokefirered decomp (battle anim scripts, sprite templates,
anim/affine tables, battle-anim sprite/palette/background graphics) and writes

    web/assets/anims/anims.json   scripts + templates + tables + tags + palettes + bgs
    web/assets/anims/tiles.bin    every battle-anim sprite sheet as raw GBA 4bpp tiles
    web/assets/anims/bgs/*.png    pre-rendered move backgrounds (RGBA, index 0 transparent)

Usage:
    python tools/extract_anims.py            # extract
    python tools/extract_anims.py --debug    # also dump a few sample frames to tools/gfx_verify/anims/

See tools/GFX.md ("Move animations") for the format.
"""
from __future__ import annotations

import json
import re
import struct
import sys
from collections import OrderedDict
from pathlib import Path

import numpy as np
from PIL import Image

sys.dont_write_bytecode = True  # tools/__pycache__ is tracked; do not dirty it
sys.path.insert(0, str(Path(__file__).resolve().parent))
from extract_gfx import pal_of, load_idx, tiles_of  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
PRET = ROOT / "pokefirered"
OUT = ROOT / "web" / "assets" / "anims"
REVISION = 0  # plain FireRed 1.0 (the Makefile default)

MISSES: dict[str, set] = {}


def miss(kind: str, name: str) -> None:
    MISSES.setdefault(kind, set()).add(name)


def strip_c_comments(s: str) -> str:
    s = re.sub(r"/\*.*?\*/", " ", s, flags=re.S)
    return re.sub(r"//[^\n]*", "", s)


# ---------------------------------------------------------------------------
# C constant evaluation
# ---------------------------------------------------------------------------

DEFINES: dict[str, str] = {}


def load_defines() -> None:
    files = sorted((PRET / "include" / "constants").glob("*.h")) + [
        PRET / "include" / "gba" / "types.h", PRET / "include" / "gba" / "defines.h"] +         sorted((PRET / "include").glob("*.h"))
    for f in files:
        txt = strip_c_comments(f.read_text(errors="replace"))
        txt = txt.replace("\\\n", " ")
        for m in re.finditer(r"^[ \t]*#define[ \t]+([A-Za-z_]\w*)(?!\()[ \t]*(.*)$", txt, re.M):
            name, val = m.group(1), m.group(2).strip()
            if val and name not in DEFINES:
                DEFINES[name] = val


def _rgb(r, g, b):
    return (r & 31) | ((g & 31) << 5) | ((b & 31) << 10)


_SHAPE = {"8x8": (0, 0), "16x16": (0, 1), "32x32": (0, 2), "64x64": (0, 3),
          "16x8": (1, 0), "32x8": (1, 1), "32x16": (1, 2), "64x32": (1, 3),
          "8x16": (2, 0), "8x32": (2, 1), "16x32": (2, 2), "32x64": (2, 3)}
_DIMS = {v: tuple(map(int, k.split("x"))) for k, v in _SHAPE.items()}
_CACHE: dict[str, int] = {}
_FUNCS = {"Q_8_8": lambda n: s16(int(n * 256)), "Q_4_12": lambda n: s16(int(n * 4096)),
          "Q_24_8": lambda n: int(n) << 8}


class Unresolved(Exception):
    pass


def cval(expr: str, depth: int = 0) -> int:
    """Evaluate a C/asm constant expression using the decomp's #defines."""
    expr = expr.strip()
    if expr in _CACHE:
        return _CACHE[expr]
    if depth > 40:
        raise Unresolved(expr)
    e = re.sub(r"SPRITE_SHAPE\((\w+)\)", lambda m: str(_SHAPE[m.group(1)][0]), expr)
    e = re.sub(r"SPRITE_SIZE\((\w+)\)", lambda m: str(_SHAPE[m.group(1)][1]), e)
    e = re.sub(r"\((?:u8|s8|u16|s16|u32|s32|int)\)", "", e)
    e = re.sub(r"\b(0x[0-9A-Fa-f]+|\d+)[uUlL]+\b", r"\1", e)

    def ident(m):
        name = m.group(0)
        if name in ("RGB", "RGB2", "_RGB"):
            return "_rgb"
        if name in _FUNCS:
            return name
        if name in DEFINES:
            return "(" + str(cval(DEFINES[name], depth + 1)) + ")"
        raise Unresolved(name)

    py = re.sub(r"\b[A-Za-z_]\w*\b", ident, e)
    py = py.replace("&&", " and ").replace("||", " or ")
    py = re.sub(r"!(?!=)", " not ", py)
    py = re.sub(r"(?<!/)/(?!/)", "//", py)
    try:
        v = int(eval(py, {"__builtins__": {}}, {"_rgb": _rgb, **_FUNCS}))
    except Unresolved:
        raise
    except Exception as ex:  # noqa: BLE001
        raise Unresolved(f"{expr} ({ex})")
    _CACHE[expr] = v
    return v


def s16(v: int) -> int:
    return ((v + 0x8000) & 0xFFFF) - 0x8000


def split_args(s: str) -> list[str]:
    out, depth, cur = [], 0, ""
    for ch in s:
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        if ch == "," and depth == 0:
            out.append(cur.strip())
            cur = ""
        else:
            cur += ch
    if cur.strip():
        out.append(cur.strip())
    return out


# ---------------------------------------------------------------------------
# Battle anim scripts
# ---------------------------------------------------------------------------

LABEL_OPS = {"call": [0], "goto": [0], "choosetwoturnanim": [0, 1], "jumpifmoveturn": [1],
             "jumpargeq": [2], "jumpifcontest": [0]}
SE_OPS = {"playse", "playsewithpan", "loopsewithpan", "waitplaysewithpan",
          "panse", "panse_adjustnone", "panse_adjustall"}
TAG_OPS = {"loadspritegfx", "unloadspritegfx"}
TERMINATORS = {"end", "return", "goto", "choosetwoturnanim"}


def read_macro_names() -> set[str]:
    txt = (PRET / "asm" / "macros" / "battle_anim_script.inc").read_text()
    return set(re.findall(r"^\s*\.macro\s+(\w+)", txt, re.M))


def parse_scripts():
    src = (PRET / "data" / "battle_anim_scripts.s").read_text(errors="replace")
    macros = read_macro_names()
    # resolve .if/.else/.endif (only REVISION checks are used)
    lines, stack = [], []
    for raw in src.splitlines():
        line = raw.split("@", 1)[0].rstrip()
        s = line.strip()
        if s.startswith(".if "):
            cond = s[4:].replace("REVISION", str(REVISION))
            stack.append(bool(cval(cond)))
            continue
        if s == ".else":
            stack[-1] = not stack[-1]
            continue
        if s == ".endif":
            stack.pop()
            continue
        if all(stack):
            lines.append(s)

    tables: dict[str, list[str]] = {}
    cmds: list = []
    label_pos: dict[str, int] = {}
    cur_table = None
    for s in lines:
        if not s or s.startswith("#"):
            continue
        m = re.match(r"^([A-Za-z_]\w*)\s*::?$", s)
        if m:
            name = m.group(1)
            if name.startswith("gBattleAnims_") or name == "gMovesWithQuietBGM":
                cur_table = name
                tables[name] = []
            else:
                cur_table = None
                label_pos[name] = len(cmds)
            continue
        if s.startswith("."):
            if cur_table and s.startswith(".4byte"):
                tables[cur_table].append(s.split(None, 1)[1].strip())
            continue
        parts = s.split(None, 1)
        op, argstr = parts[0], (parts[1] if len(parts) > 1 else "")
        args = split_args(argstr)
        cmds.append(convert_cmd(op, args, macros))
    return tables, cmds, label_pos


def ev(a: str, ctx: str):
    try:
        return cval(a)
    except Unresolved as ex:
        miss("unresolved constant", f"{ex} in {ctx}")
        return a


def convert_cmd(op: str, args: list[str], macros: set[str]):
    ctx = op + " " + ", ".join(args)
    if op in ("jumpreteq", "jumprettrue", "jumpretfalse"):
        if op == "jumpreteq":
            v, lab = args
        else:
            v, lab = ("1" if op == "jumprettrue" else "0"), args[0]
        return ["jumpargeq", cval("ARG_RET_ID"), s16(ev(v, ctx)), lab]
    if op not in macros:
        miss("unknown script op", op)
    if op == "createsprite":
        tgt = ev(args[1], ctx)
        return [op, args[0], 1 if tgt == cval("ANIM_TARGET") else 0, ev(args[2], ctx) & 0x7F,
                [s16(ev(a, ctx)) for a in args[3:]]]
    if op == "createvisualtask":
        return [op, args[0], ev(args[1], ctx), [s16(ev(a, ctx)) for a in args[2:]]]
    if op == "createsoundtask":
        return [op, args[0], [s16(ev(a, ctx)) for a in args[1:]]]
    if op in TAG_OPS:
        return [op, args[0]]
    out = [op]
    labs = LABEL_OPS.get(op, [])
    for i, a in enumerate(args):
        if i in labs:
            out.append(a)
        elif op in SE_OPS and i == 0:
            out.append(a)
        elif op == "setarg" and i == 1:
            out.append(s16(ev(a, ctx)))
        else:
            out.append(ev(a, ctx))
    return out


def label_cmds(cmds, start):
    out = []
    i = start
    while i < len(cmds):
        c = cmds[i]
        out.append(c)
        if c[0] in TERMINATORS:
            break
        i += 1
    return out


def label_refs(cl):
    for c in cl:
        for i in LABEL_OPS.get(c[0], []):
            yield c[1 + i]


# ---------------------------------------------------------------------------
# C sources: sprite templates, OAM data, anim + affine anim tables
# ---------------------------------------------------------------------------

def load_c_sources() -> str:
    files = sorted((PRET / "src").rglob("*.c")) + sorted((PRET / "src" / "data").rglob("*.h"))
    return "\n".join(strip_c_comments(f.read_text(errors="replace")) for f in files)


def fields_of(body: str) -> dict[str, str]:
    return {m.group(1): m.group(2).strip() for m in
            re.finditer(r"\.(\w+)\s*=\s*([^,]+?)\s*(?:,|$)", body.strip())}


TEMPLATE_ORDER = ["tileTag", "paletteTag", "oam", "anims", "images", "affineAnims", "callback"]


def parse_c(csrc: str):
    templates_raw, oams, anim_seqs, anim_tabs, aff_seqs, aff_tabs = {}, {}, {}, {}, {}, {}
    for m in re.finditer(r"struct\s+SpriteTemplate\s+(\w+)\s*=\s*\{(.*?)\};", csrc, re.S):
        body = m.group(2)
        if re.search(r"\.\w+\s*=", body):
            f = fields_of(body)
        else:
            f = dict(zip(TEMPLATE_ORDER, split_args(body)))
        templates_raw[m.group(1)] = f
    for m in re.finditer(r"struct\s+OamData\s+(\w+)\s*=\s*\{(.*?)\};", csrc, re.S):
        oams[m.group(1)] = fields_of(m.group(2))
    oams["gDummyOamData"] = {"affineMode": "0", "objMode": "0", "shape": "0", "size": "0", "priority": "3"}

    for m in re.finditer(r"union\s+AnimCmd\s+(\w+)\s*\[\s*\]\s*=\s*\{(.*?)\};", csrc, re.S):
        anim_seqs[m.group(1)] = parse_anim_seq(m.group(2), m.group(1))
    for m in re.finditer(r"union\s+AnimCmd\s*\*\s*const\s+(\w+)\s*\[\s*\w*\s*\]\s*=\s*\{(.*?)\};", csrc, re.S):
        anim_tabs[m.group(1)] = table_entries(m.group(2))
    for m in re.finditer(r"union\s+AffineAnimCmd\s+(\w+)\s*\[\s*\]\s*=\s*\{(.*?)\};", csrc, re.S):
        aff_seqs[m.group(1)] = parse_affine_seq(m.group(2), m.group(1))
    for m in re.finditer(r"union\s+AffineAnimCmd\s*\*\s*const\s+(\w+)\s*\[\s*\w*\s*\]\s*=\s*\{(.*?)\};", csrc, re.S):
        aff_tabs[m.group(1)] = table_entries(m.group(2))
    anim_seqs["sDummyAnim"] = [{"end": 1}]
    aff_seqs["sDummyAffineAnim"] = [{"end": 1}]
    return templates_raw, oams, anim_seqs, anim_tabs, aff_seqs, aff_tabs


def table_entries(body: str) -> list[str]:
    out = []
    for a in split_args(body):
        a = re.sub(r"^\[[^\]]*\]\s*=\s*", "", a).strip().lstrip("&").strip()
        if a:
            out.append(a)
    return out


def items_of(body: str) -> list[str]:
    return [a for a in split_args(body.replace("\n", " ")) if a]


def parse_anim_seq(body: str, name: str):
    try:
        return _parse_anim_seq(body, name)
    except Unresolved as ex:
        miss("unparsed anim seq", f"{name}: {ex}")
        return [{"end": 1}]


def parse_affine_seq(body: str, name: str):
    try:
        return _parse_affine_seq(body, name)
    except Unresolved as ex:
        miss("unparsed affine seq", f"{name}: {ex}")
        return [{"end": 1}]


def _parse_anim_seq(body: str, name: str):
    seq = []
    for it in items_of(body):
        if it.startswith("ANIMCMD_FRAME"):
            inner = split_args(it[it.index("(") + 1:it.rindex(")")])
            cmd, pos = {}, 0
            for a in inner:
                fm = re.match(r"\.(\w+)\s*=\s*(.+)", a)
                if fm:
                    key, val = fm.group(1), cval(fm.group(2))
                else:
                    key, val = ["imageValue", "duration", "hFlip", "vFlip"][pos], cval(a)
                    pos += 1
                if key == "imageValue":
                    cmd["f"] = val
                elif key == "duration":
                    cmd["d"] = val
                elif key == "hFlip" and val:
                    cmd["h"] = 1
                elif key == "vFlip" and val:
                    cmd["v"] = 1
            seq.append({"f": cmd.get("f", 0), "d": cmd.get("d", 0), **{k: cmd[k] for k in ("h", "v") if k in cmd}})
        elif it.startswith("ANIMCMD_LOOP"):
            seq.append({"loop": cval(it[it.index("(") + 1:it.rindex(")")])})
        elif it.startswith("ANIMCMD_JUMP"):
            seq.append({"jump": cval(it[it.index("(") + 1:it.rindex(")")])})
        elif it.startswith("ANIMCMD_END") or it.startswith("ANIM_END"):
            seq.append({"end": 1})
        else:
            miss("unparsed anim cmd", f"{name}: {it}")
    return seq


def _parse_affine_seq(body: str, name: str):
    seq = []
    for it in items_of(body):
        arg = it[it.index("(") + 1:it.rindex(")")] if "(" in it else ""
        if it.startswith("AFFINEANIMCMD_FRAME"):
            x, y, r, d = [cval(a) for a in split_args(arg)]
            seq.append({"x": x, "y": y, "r": r, "d": d})
        elif it.startswith("AFFINEANIMCMD_LOOP"):
            seq.append({"loop": cval(arg)})
        elif it.startswith("AFFINEANIMCMD_JUMP"):
            seq.append({"jump": cval(arg)})
        elif it.startswith("AFFINEANIMCMD_END_ALT"):
            seq.append({"end": 1, "val": cval(arg)})
        elif it.startswith("AFFINEANIMCMD_END") or it.startswith("AFFINE_ANIM_END"):
            seq.append({"end": 1})
        else:
            miss("unparsed affine cmd", f"{name}: {it}")
    return seq


def resolve_table(ref: str, tabs: dict, seqs: dict, out: dict, kind: str):
    """'gAnims_X' or '&sAnims_X[3]' -> key into out (sliced tables get key 'sAnims_X+3')."""
    if ref in ("NULL", "0", None):
        return None
    ref = ref.strip().lstrip("&").strip()
    m = re.match(r"^(\w+)\s*(?:\[\s*(\w+)\s*\]|\+\s*(\w+))?$", ref)
    if not m:
        miss(kind, ref)
        return None
    base, off = m.group(1), m.group(2) or m.group(3)
    off = cval(off) if off else 0
    if base not in tabs:
        miss(kind, base)
        return None
    key = base if off == 0 else f"{base}+{off}"
    if key not in out:
        rows = []
        for s in tabs[base][off:]:
            if s not in seqs:
                miss(kind + " sequence", s)
                rows.append([{"end": 1}])
            else:
                rows.append(seqs[s])
        out[key] = rows
    return key


# ---------------------------------------------------------------------------
# Graphics
# ---------------------------------------------------------------------------

def graphics_paths() -> dict[str, str]:
    txt = (PRET / "src" / "graphics.c").read_text(errors="replace")
    return {m.group(1): m.group(2) for m in
            re.finditer(r"\b(\w+)\[\]\s*=\s*INCBIN_U\d+\(\"([^\"]+)\"\)", txt)}


def png_parts(stem: Path) -> list[Path]:
    """PNG(s) the build concatenates into <stem>.4bpp (see graphics_file_rules.mk)."""
    if stem.with_suffix(".png").exists():
        return [stem.with_suffix(".png")]
    parts, i = [], 0
    while (p := stem.parent / f"{stem.name}_{i}.png").exists():
        parts.append(p)
        i += 1
    return parts


def tiles_4bpp(idx: np.ndarray) -> bytes:
    t = tiles_of(idx & 15).astype(np.uint8)          # n,8,8
    packed = t[:, :, 0::2] | (t[:, :, 1::2] << 4)    # low nibble = left pixel
    return packed.tobytes()


def hexpal(pal) -> list[str]:
    pal = list(pal)[:16]
    while len(pal) < 16:
        pal.append((0, 0, 0))
    return ["#%02x%02x%02x" % tuple(c) for c in pal]


def table_rows(path: Path, sym: str) -> list[list[str]]:
    txt = strip_c_comments(path.read_text(errors="replace"))
    m = re.search(sym + r"\s*\[\s*\]\s*=\s*\{(.*?)\};", txt, re.S)
    return [split_args(r) for r in re.findall(r"\{([^{}]*)\}", m.group(1))]


def build_tags(gpaths):
    data_h = PRET / "src" / "data" / "battle_anim.h"
    tags, palettes, blob, by_sym = {}, {}, bytearray(), {}
    for sym, size, tag in table_rows(data_h, "gBattleAnimPicTable"):
        if not tag.startswith("ANIM_TAG"):
            continue
        rel = gpaths.get(sym)
        ent = {"id": cval(tag), "tiles": None, "imgW": 0, "pal": None}
        if rel is None:
            miss("pic symbol", sym)
        elif sym in by_sym:
            ent["tiles"], ent["imgW"] = by_sym[sym]
        else:
            stem = PRET / re.sub(r"\.4bpp(\.lz)?$", "", rel)
            parts = png_parts(stem)
            if not parts:
                miss("pic png", rel)
            else:
                start = len(blob)
                for p in parts:
                    blob += tiles_4bpp(load_idx(p))
                w = Image.open(parts[0]).width // 8
                ent["tiles"] = [start, (len(blob) - start) // 32]
                ent["imgW"] = w
                by_sym[sym] = (ent["tiles"], w)
        tags[tag] = ent
    for sym, tag in table_rows(data_h, "gBattleAnimPaletteTable"):
        if not tag.startswith("ANIM_TAG"):
            continue
        rel = gpaths.get(sym)
        if rel is None:
            miss("palette symbol", sym)
            continue
        stem = PRET / re.sub(r"\.gbapal(\.lz)?$", "", rel)
        try:
            palettes[tag] = hexpal(pal_of(stem))
        except FileNotFoundError:
            miss("palette file", rel)
            continue
        tags.setdefault(tag, {"id": cval(tag), "tiles": None, "imgW": 0, "pal": None})["pal"] = tag
    return tags, palettes, bytes(blob)


def render_bg(img_rel, pal_rel, map_rel) -> Image.Image:
    idx = load_idx(PRET / re.sub(r"\.4bpp(\.lz)?$", ".png", img_rel))
    tiles = tiles_of(idx & 15)
    pal = list(pal_of(PRET / re.sub(r"\.gbapal(\.lz)?$", "", pal_rel)))[:16]
    while len(pal) < 16:
        pal.append((0, 0, 0))
    lut = np.array([(0, 0, 0, 0)] + [(r, g, b, 255) for r, g, b in pal[1:]], dtype=np.uint8)
    raw = (PRET / re.sub(r"\.lz$", "", map_rel)).read_bytes()
    ents = struct.unpack("<%dH" % (len(raw) // 2), raw)
    n = len(ents)
    if n == 2048:
        tw, th, blocks = 64, 32, 2
    else:
        tw, th, blocks = 32, n // 32, 1
    out = np.zeros((th * 8, tw * 8), dtype=np.uint8)
    for i, e in enumerate(ents):
        blk, j = divmod(i, 1024) if blocks > 1 else (0, i)
        tx, ty = j % 32 + blk * 32, j // 32
        t = e & 0x3FF
        if t >= len(tiles):
            continue
        tile = tiles[t]
        if e & 0x400:
            tile = tile[:, ::-1]
        if e & 0x800:
            tile = tile[::-1, :]
        out[ty * 8:ty * 8 + 8, tx * 8:tx * 8 + 8] = tile
    return Image.fromarray(lut[out], "RGBA")


def build_bgs(gpaths):
    data_h = PRET / "src" / "data" / "battle_anim.h"
    txt = strip_c_comments(data_h.read_text(errors="replace"))
    body = re.search(r"gBattleAnimBackgroundTable\s*\[\s*\]\s*=\s*\{(.*?)\};", txt, re.S).group(1)
    bgdir = OUT / "bgs"
    bgdir.mkdir(parents=True, exist_ok=True)
    for old in bgdir.glob("*.png"):
        old.unlink()
    bgs, done, total = {}, {}, 0
    for m in re.finditer(r"\[(\w+)\]\s*=\s*\{([^}]*)\}", body):
        name, (img, pal, tmap) = m.group(1), split_args(m.group(2))
        key = (img, pal, tmap)
        if key not in done:
            ip, pp, mp = gpaths[img], gpaths[pal], gpaths[tmap]
            mstem = Path(mp).name.split(".")[0]
            istem, pstem = Path(ip).name.split(".")[0], Path(pp).name.split(".")[0]
            fname = mstem if pstem == istem else f"{mstem}_{pstem}"
            im = render_bg(ip, pp, mp)
            dst = bgdir / f"{fname}.png"
            im.save(dst, optimize=True)
            total += dst.stat().st_size
            done[key] = (f"bgs/{fname}.png", im.width, im.height)
        f, w, h = done[key]
        bgs[name] = {"id": cval(name), "img": f, "w": w, "h": h}
    return bgs, len(done), total


# BG layers that C callbacks load themselves (AnimLoadCompressedBgTilemap + AnimLoadCompressedBgGfx +
# LoadCompressedPalette), keyed "<tilemapSymbol>[:<paletteSymbol>]" (palette defaults to the first one).
EXTRA_BGS = [
    # AnimTask_CreateSurfWave (SURF; arg0 != 0 = Muddy Water palette)
    ("gBattleAnimBgTilemap_SurfOpponent", "gBattleAnimBgImage_Surf", ["gBattleAnimBgPalette_Surf", "gBattleAnimBgPalette_MuddyWater"]),
    ("gBattleAnimBgTilemap_SurfPlayer", "gBattleAnimBgImage_Surf", ["gBattleAnimBgPalette_Surf", "gBattleAnimBgPalette_MuddyWater"]),
]


def build_extra_bgs(gpaths):
    bgdir = OUT / "bgs"
    out, total = {}, 0
    for tmap, img, pals in EXTRA_BGS:
        for i, pal in enumerate(pals):
            fname = Path(gpaths[tmap]).name.split(".")[0]
            if i:
                fname += "_" + Path(gpaths[pal]).name.split(".")[0]
            im = render_bg(gpaths[img], gpaths[pal], gpaths[tmap])
            dst = bgdir / f"{fname}.png"
            im.save(dst, optimize=True)
            total += dst.stat().st_size
            entry = {"img": f"bgs/{fname}.png", "w": im.width, "h": im.height}
            out[f"{tmap}:{pal}"] = entry
            if i == 0:
                out[tmap] = entry
    return out, total


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    debug = "--debug" in sys.argv
    load_defines()
    OUT.mkdir(parents=True, exist_ok=True)

    # scripts
    tables, cmds, label_pos = parse_scripts()
    move_names = [cval(f"MOVE_{n}") for n in []]  # noqa: F841 (ids come from table index)
    moves, move_ids = OrderedDict(), OrderedDict()
    for i, lab in enumerate(tables["gBattleAnims_Moves"]):
        key = lab[len("Move_"):] if lab.startswith("Move_") else lab
        if key in moves:
            key = f"{key}_{i}"
        if lab not in label_pos:
            miss("script label", lab)
            continue
        moves[key] = label_cmds(cmds, label_pos[lab])
        move_ids[key] = i
    roots = []
    for t in ("gBattleAnims_General", "gBattleAnims_Special", "gBattleAnims_StatusConditions"):
        roots += tables.get(t, [])
    labels: dict = OrderedDict()
    queue = list(roots) + [r for cl in moves.values() for r in label_refs(cl)]
    while queue:
        lab = queue.pop(0)
        if lab in labels:
            continue
        if lab not in label_pos:
            miss("script label", lab)
            continue
        labels[lab] = label_cmds(cmds, label_pos[lab])
        queue += list(label_refs(labels[lab]))

    # C data
    csrc = load_c_sources()
    templates_raw, oams, anim_seqs, anim_tabs, aff_seqs, aff_tabs = parse_c(csrc)
    used_templates = []
    for cl in list(moves.values()) + list(labels.values()):
        for c in cl:
            if c[0] == "createsprite" and c[1] not in used_templates:
                used_templates.append(c[1])
    anim_out_names = [n for n, f in templates_raw.items()
                      if n not in used_templates and f.get("tileTag", "").startswith("ANIM_TAG")]
    templates, anim_tables, aff_tables = OrderedDict(), {}, {}
    for name in used_templates + anim_out_names:
        f = templates_raw.get(name)
        if f is None:
            miss("template", name)
            continue
        oam_name = f.get("oam", "").lstrip("&").strip()
        oam = oams.get(oam_name)
        if oam is None:
            miss("oam", f"{oam_name} ({name})")
            oam = {"shape": "0", "size": "0"}
        try:
            shape, size = cval(oam.get("shape", "0")), cval(oam.get("size", "0"))
            w, h = _DIMS[(shape, size)]
            tile_tag, pal_tag = f.get("tileTag", "0"), f.get("paletteTag", "0")
            t = {
                "tileTag": tile_tag if tile_tag.startswith("ANIM_TAG") else cval(tile_tag),
                "paletteTag": pal_tag if pal_tag.startswith("ANIM_TAG") else cval(pal_tag),
                "w": w, "h": h,
                "affine": cval(oam.get("affineMode", "0")),
                "objMode": cval(oam.get("objMode", "0")),
                "priority": cval(oam.get("priority", "0")),
                "anims": resolve_table(f.get("anims"), anim_tabs, anim_seqs, anim_tables, "anim table"),
                "affineAnims": resolve_table(f.get("affineAnims"), aff_tabs, aff_seqs, aff_tables, "affine table"),
                "callback": f.get("callback"),
                "images": None if f.get("images", "NULL") in ("NULL", "0") else f.get("images"),
            }
        except (Unresolved, KeyError) as ex:
            if name in used_templates:
                miss("template parse", f"{name}: {ex}")
            continue
        templates[name] = t

    oam_out = OrderedDict()
    for name, oam in oams.items():
        try:
            oam_out[name] = {"w": _DIMS[(cval(oam.get("shape", "0")), cval(oam.get("size", "0")))][0],
                             "h": _DIMS[(cval(oam.get("shape", "0")), cval(oam.get("size", "0")))][1],
                             "affine": cval(oam.get("affineMode", "0")), "objMode": cval(oam.get("objMode", "0")),
                             "priority": cval(oam.get("priority", "0"))}
        except (Unresolved, KeyError):
            pass

    se_names = OrderedDict()
    for k in DEFINES:
        if re.match(r"^(SE|MUS)_", k):
            try:
                se_names.setdefault(str(cval(k)), k)
            except Unresolved:
                pass

    # graphics
    gpaths = graphics_paths()
    tags, palettes, blob = build_tags(gpaths)
    (OUT / "tiles.bin").write_bytes(blob)
    bgs, nbg_files, bg_bytes = build_bgs(gpaths)
    extra_bgs, extra_bytes = build_extra_bgs(gpaths)
    bg_bytes += extra_bytes

    keep = ("ANIM_ATTACKER", "ANIM_TARGET", "ANIM_ATK_PARTNER", "ANIM_DEF_PARTNER", "ARG_RET_ID",
            "ANIM_SPRITES_START", "ANIMSPRITE_IS_TARGET")
    constants = OrderedDict()
    for k in DEFINES:
        if k in keep or re.match(r"^(SOUND_PAN_|F_PAL_|ST_OAM_|B_ANIM_|TRAP_ANIM_|ANIM_WEATHER_)", k):
            try:
                constants[k] = cval(k)
            except Unresolved:
                pass

    data = OrderedDict(
        moves=moves, moveIds=move_ids, labels=labels,
        general=tables.get("gBattleAnims_General", []),
        special=tables.get("gBattleAnims_Special", []),
        statusConditions=tables.get("gBattleAnims_StatusConditions", []),
        templates=templates, animTables=anim_tables, affineTables=aff_tables,
        tags=tags, palettes=palettes, bgs=bgs, extraBgs=extra_bgs, constants=constants,
        anims=anim_seqs, affineAnims=aff_seqs, oams=oam_out,
        seNames=se_names,
    )
    js = json.dumps(data, separators=(",", ":"))
    (OUT / "anims.json").write_text(js)

    # validation
    for name in used_templates:
        t = templates.get(name)
        if not t:
            continue
        tt, pt = t["tileTag"], t["paletteTag"]
        if isinstance(tt, str) and t["images"] is None and not (tags.get(tt) or {}).get("tiles"):
            miss("tile tag without tiles", f"{tt} ({name})")
        if isinstance(pt, str) and pt not in palettes:
            miss("palette tag without palette", f"{pt} ({name})")
    for k, p in palettes.items():
        if len(p) != 16:
            miss("palette != 16", k)

    print(f"output: {OUT}")
    print(f"moves {len(moves)}  labels {len(labels)}  templates {len(templates)} "
          f"(script-referenced {len(used_templates)})  animTables {len(anim_tables)}  affineTables {len(aff_tables)}")
    print(f"tags {len(tags)} (with gfx {sum(1 for t in tags.values() if t['tiles'])}, "
          f"with palette {len(palettes)})  bgs {len(bgs)} entries / {nbg_files} pngs")
    print(f"anims.json {len(js) / 1024:.0f} KB  tiles.bin {len(blob) / 1024:.0f} KB  bgs {bg_bytes / 1024:.0f} KB")
    if MISSES:
        print("MISSES:")
        for k, v in MISSES.items():
            print(f"  {k} ({len(v)}): " + ", ".join(sorted(v)[:40]))
    else:
        print("no misses")

    if debug:
        debug_dump(data, blob)


def debug_dump(data, blob):
    """Render frame 0 of a few templates the way OBJ 1D mapping would."""
    dst = ROOT / "tools" / "gfx_verify" / "anims"
    dst.mkdir(parents=True, exist_ok=True)
    tiles = np.frombuffer(blob, dtype=np.uint8).reshape(-1, 32)
    for tname in ("gBasicHitSplatSpriteTemplate", "gEmberSpriteTemplate", "gEmberFlareSpriteTemplate",
                  "gFireSpiralOutwardSpriteTemplate"):
        t = data["templates"].get(tname)
        if not t:
            continue
        tag = data["tags"][t["tileTag"]]
        pal = [tuple(int(c[i:i + 2], 16) for i in (1, 3, 5)) for c in data["palettes"][t["paletteTag"]]]
        seqs = data["animTables"].get(t["anims"]) or [[{"f": 0}]]
        frames = [c for c in seqs[0] if "f" in c][:8] or [{"f": 0}]
        tw, th = t["w"] // 8, t["h"] // 8
        sheet = np.zeros((t["h"], t["w"] * len(frames), 4), dtype=np.uint8)
        for fi, fr in enumerate(frames):
            base = tag["tiles"][0] // 32 + fr["f"]
            for ty in range(th):
                for tx in range(tw):
                    k = base + ty * tw + tx
                    if k >= len(tiles):
                        continue
                    b = tiles[k]
                    px = np.empty(64, dtype=np.uint8)
                    px[0::2], px[1::2] = b & 15, b >> 4
                    px = px.reshape(8, 8)
                    for y in range(8):
                        for x in range(8):
                            v = px[y, x]
                            if v:
                                sheet[ty * 8 + y, fi * t["w"] + tx * 8 + x] = (*pal[v], 255)
        Image.fromarray(sheet, "RGBA").resize((sheet.shape[1] * 4, sheet.shape[0] * 4), Image.NEAREST) \
            .save(dst / f"{tname}.png")
    print(f"debug frames -> {dst}")


if __name__ == "__main__":
    main()
