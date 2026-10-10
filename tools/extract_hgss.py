#!/usr/bin/env python3
"""
Kanto Spire -- HeartGold (Johto) art extractor.

Reads the owner's own Pokemon HeartGold (USA) ROM with ndspy and writes
browser-ready RGBA PNGs (palette index 0 = transparent) into web/assets/gfx:

    gfx/trainers/hgss/<name>.png   Johto trainer portraits (a/0/5/8: NCGR + NCLR + NCER per class)
    gfx/overworld/people/hgss/<name>.png  overworld walkers (a/0/8/1 mmodel BTX0 textures), 32x32 frames in
                                   FireRed's people order: down, up, left, down-walk x2, up-walk x2, left-walk x2;
                                   the figure is shrunk 0.8 like the portraits (~21 px tall, FireRed's walker height)
    gfx/items/hgss/<key>.png       Apricorn balls + Apricorns + the Gen 4 stones (a/0/1/8 item icons; the art sits in the
                                   top-left 24x24 of the 32x32 cell, cropped to 24x24 like FireRed icons)

Trainer portraits are drawn natively in an 80x80 frame (figures up to 79 px
tall), ~25% bigger than FireRed's 64x64 pics (figures 57-63 px). A 64x64 crop
would cut heads off, so they are downscaled 80 -> 64 (5 source px -> 4) to
FireRed's scale with a pixel-art-safe filter (see downscale(): area-weighted
majority vote over the sprite's own palette indices, outline colour favoured,
hard alpha), so every output pixel is one of the sprite's own colours and the
figure keeps its feet on the bottom row and its centre on x=32 like FireRed's.

Usage (needs ndspy, Pillow: pip install ndspy pillow):
    python tools/extract_hgss.py [path/to/heartgold_usa.nds]   (default: rom/heartgold.nds)
    ... --sheet    also writes tests/out/johto/hgss_sheet.png (contact sheet for eyeballing)
    ... --native   keep trainer portraits (80x80) and walker figures at native DS size (no downscale)
    ... --items    only the item icons (gfx/items/hgss/)

Re-runnable: overwrites its outputs and prints every file written. Only the
pinned USA dump (IPKE, sha1 below) is accepted. Outputs live under web/assets
(gitignored, private; uploaded as the 'hgss' asset pack by tools/upload_packs.cjs).

Indices come from pret/pokeheartgold: include/constants/trainer_class.h
(TRAINERCLASS_*) and src/item.c (item -> item_icon NCGR/NCLR). Kurt has no
trainer class / portrait in HGSS, so no Kurt portrait is produced.
"""
from __future__ import annotations

import hashlib
import struct
import sys
from pathlib import Path

import ndspy.narc
import ndspy.rom
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "web" / "assets" / "gfx"
DEFAULT_ROM = Path(__file__).resolve().parent.parent / "rom" / "heartgold.nds"
SHA1 = "4fcded0e2713dc03929845de631d0932ea2b5a37"  # Pokemon - HeartGold Version (USA) (IPKE)

# portrait name -> TRAINERCLASS_* index (pokeheartgold include/constants/trainer_class.h)
TRAINERS = {
    "falkner": 66, "bugsy": 67, "whitney": 70, "morty": 72, "pryce": 73,
    "jasmine": 74, "chuck": 75, "clair": 76,
    "lance": 86,          # TRAINERCLASS_CHAMPION (Lance)
    "will": 87, "karen": 88, "koga": 89, "bruno": 112,
    "silver": 23,         # TRAINERCLASS_RIVAL
    "red": 109,           # TRAINERCLASS_PKMN_TRAINER_RED
    "ariana": 114, "archer": 116, "proton": 117, "petrel": 118,
}
# item key -> (item_icon NCGR, NCLR) member indices in a/0/1/8 (pokeheartgold src/item.c)
ITEMS = {
    "fast_ball": (723, 724), "level_ball": (717, 718), "lure_ball": (715, 716),
    "heavy_ball": (721, 722), "love_ball": (727, 728), "moon_ball": (719, 720),
    "friend_ball": (725, 726),
    "red_apricorn": (733, 734), "blu_apricorn": (735, 736), "ylw_apricorn": (737, 738),
    "grn_apricorn": (739, 740), "pnk_apricorn": (741, 742), "wht_apricorn": (743, 744),
    "blk_apricorn": (745, 746),
    # the Gen 4 evolution stones (v0.4.0: game/gen4.js, SHINY / DUSK / DAWN STONE evolutions)
    "shiny_stone": (480, 481), "dusk_stone": (482, 483), "dawn_stone": (484, 485),
}

# overworld name -> MMODEL_* index in a/0/8/1 (pokeheartgold include/constants/mmodel.h)
OVERWORLD = {"silver": 58}  # MMODEL_GSRIVEL
# HGSS texture frames <name>.1..16 = up x4, down x4, left x4, right x4 (stand, walk, stand, walk) -> FireRed order
OW_ORDER = [5, 1, 9, 6, 8, 2, 4, 10, 12]

OBJ_SIZES = {(0, 0): (8, 8), (0, 1): (16, 16), (0, 2): (32, 32), (0, 3): (64, 64),
             (1, 0): (16, 8), (1, 1): (32, 8), (1, 2): (32, 16), (1, 3): (64, 32),
             (2, 0): (8, 16), (2, 1): (8, 32), (2, 2): (16, 32), (2, 3): (32, 64)}


def palette(nclr: bytes) -> list[tuple[int, int, int]]:
    off = 0x10
    assert nclr[off:off + 4] == b"TTLP", "not an NCLR"
    pal = []
    for i in range(16):
        c, = struct.unpack_from("<H", nclr, off + 0x18 + i * 2)
        r, g, b = c & 31, (c >> 5) & 31, (c >> 10) & 31
        pal.append(((r << 3) | (r >> 2), (g << 3) | (g >> 2), (b << 3) | (b >> 2)))
    return pal


def ncgr(b: bytes):
    """-> (4bpp pixel indices as a flat list, tiles_w, tiles_h, scanned)"""
    off = 0x10
    assert b[off:off + 4] == b"RAHC", "not an NCGR"
    th, tw = struct.unpack_from("<HH", b, off + 8)
    scanned, = struct.unpack_from("<I", b, off + 20)
    size, = struct.unpack_from("<I", b, off + 24)
    px = []
    for byte in b[off + 0x20: off + 0x20 + size]:
        px += [byte & 15, byte >> 4]
    return px, tw, th, scanned


def cells(ncer: bytes):
    off = 0x10
    assert ncer[off:off + 4] == b"KBEC", "not an NCER"
    n, attr, celloff, mapping = struct.unpack_from("<HHII", ncer, off + 8)
    base = off + 8 + celloff
    csz = 16 if attr == 1 else 8
    oambase = base + n * csz
    out = []
    for c in range(n):
        noam, _cattr, oamoff = struct.unpack_from("<HHI", ncer, base + c * csz)
        objs = []
        for k in range(noam):
            a0, a1, a2 = struct.unpack_from("<HHH", ncer, oambase + oamoff + k * 6)
            y = a0 & 0xFF
            y = y - 256 if y > 127 else y
            x = a1 & 0x1FF
            x = x - 512 if x > 255 else x
            objs.append((x, y, OBJ_SIZES[((a0 >> 14) & 3, (a1 >> 14) & 3)], a2 & 0x3FF))
        out.append(objs)
    return out, mapping


def trainer_pic(trf, cls: int) -> Image.Image:
    g, p, ce = trf[cls * 5], trf[cls * 5 + 1], trf[cls * 5 + 2]
    pal = palette(p)
    px, _tw, _th, _sc = ncgr(g)
    cl, mapping = cells(ce)
    shift = (mapping & 7) if mapping < 0x100000 else (mapping >> 20) & 3
    # cell 0 is the idle frame; OAM coords are relative to the sprite centre of an 80x80 frame
    img = Image.new("RGBA", (80, 80), (0, 0, 0, 0))
    for (x, y, (w, h), t) in cl[0]:
        t0 = t << shift
        for ty in range(h // 8):
            for tx in range(w // 8):
                ti = t0 + ty * (w // 8) + tx
                for i in range(64):
                    j = ti * 64 + i
                    v = px[j] if j < len(px) else 0
                    X, Y = x + 40 + tx * 8 + i % 8, y + 40 + ty * 8 + i // 8
                    if v and 0 <= X < 80 and 0 <= Y < 80:
                        img.putpixel((X, Y), (*pal[v], 255))
    return img


def _weights(src: int, dst: int) -> list[list[tuple[int, float]]]:
    """1-D area weights: for each output pixel, [(source pixel, overlap)] (overlaps sum to src/dst)."""
    f, out = src / dst, []
    for j in range(dst):
        a, b = j * f, (j + 1) * f
        out.append([(i, min(b, i + 1) - max(a, i)) for i in range(int(a), min(src, int(-(-b // 1)))) if min(b, i + 1) > max(a, i)])
    return out


def downscale(img: Image.Image, size=64, method: str = "vote", outline_boost: float = 1.6) -> Image.Image:
    """Shrink a palette sprite (fully opaque or fully clear pixels) to size (int: square, or (w, h)), pixel-art safe.

    vote:    each output pixel takes the colour (or transparency) with the largest area overlap of its source
             footprint; the sprite's darkest colour (the outline) counts outline_boost x, so 1-px outlines that a
             5->4 grid squeezes to a 40% share survive. Only original colours, hard alpha.
    box:     premultiplied area average, alpha >= 50% opaque, colour snapped to the nearest palette colour.
    nearest: plain nearest-neighbour (drops every 5th row and column).
    """
    W, H = img.size
    ow, oh = (size, size) if isinstance(size, int) else size
    if method == "nearest":
        return img.resize((ow, oh), Image.NEAREST)
    px = img.load()
    cols = sorted({px[x, y][:3] for y in range(H) for x in range(W) if px[x, y][3]})
    lum = lambda c: 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]
    dark = min(cols, key=lum) if cols else None
    wx, wy = _weights(W, ow), _weights(H, oh)
    out = Image.new("RGBA", (ow, oh), (0, 0, 0, 0))
    op = out.load()
    for j, ry in enumerate(wy):
        for i, rx in enumerate(wx):
            if method == "vote":
                score: dict = {}
                for sy, ay in ry:
                    for sx, ax in rx:
                        p = px[sx, sy]
                        k = p[:3] if p[3] else None
                        score[k] = score.get(k, 0.0) + ax * ay * (outline_boost if k == dark else 1.0)
                k = max(score, key=lambda c: (score[c], c is not None and -lum(c)))  # ties: opaque, then darker
                if k is not None:
                    op[i, j] = (*k, 255)
            else:  # box
                tot = a = r = g = b = 0.0
                for sy, ay in ry:
                    for sx, ax in rx:
                        w, p = ax * ay, px[sx, sy]
                        tot += w
                        if p[3]:
                            a += w; r += w * p[0]; g += w * p[1]; b += w * p[2]
                if a >= tot / 2:
                    m = (r / a, g / a, b / a)
                    rm = lambda c: (2 + (c[0] + m[0]) / 512) * (c[0] - m[0]) ** 2 + 4 * (c[1] - m[1]) ** 2 + (2 + (255 - (c[0] + m[0]) / 2) / 256) * (c[2] - m[2]) ** 2
                    op[i, j] = (*min(cols, key=rm), 255)
    return out


def item_icon(icons, gi: int, pi: int) -> Image.Image:
    px, tw, th, scanned = ncgr(icons[gi])
    pal = palette(icons[pi])
    W, H = tw * 8, th * 8
    if W <= 0 or W > 64:
        W = H = 32
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    for t in range((W // 8) * (H // 8)):
        tx, ty = t % (W // 8), t // (W // 8)
        for i in range(64):
            v = px[t * 64 + i] if not scanned else px[(ty * 8 + i // 8) * W + tx * 8 + i % 8]
            if v:
                img.putpixel((tx * 8 + i % 8, ty * 8 + i // 8), (*pal[v], 255))
    return img


def _dict(b: bytes, d: int):
    """A NITRO dictionary: [(name, entry bytes)]."""
    count = b[d + 1]
    p = d + 4 + 8 + count * 4  # header, then the patricia-tree block
    esz, _ = struct.unpack_from("<HH", b, p)
    p += 4
    ents = [b[p + i * esz: p + (i + 1) * esz] for i in range(count)]
    p += count * esz
    return [(b[p + i * 16: p + (i + 1) * 16].split(b"\0")[0].decode("latin1"), e) for i, e in enumerate(ents)]


def overworld(b: bytes, shrink: bool = True) -> Image.Image:
    """BTX0 (one 32x32 4bpp texture per frame, one palette) -> a strip of 32x32 frames in OW_ORDER.
    shrink: scale the figure to FireRed's walker size (0.8, like the portraits), keeping the 32x32 frame."""
    assert b[:4] == b"BTX0", "not a BTX0"
    t, = struct.unpack_from("<I", b, 0x10)
    assert b[t:t + 4] == b"TEX0"
    tex_info, = struct.unpack_from("<H", b, t + 0x0E)
    tex_data, = struct.unpack_from("<I", b, t + 0x14)
    pal_info, = struct.unpack_from("<I", b, t + 0x34)
    pal_data, = struct.unpack_from("<I", b, t + 0x38)
    (_pn, pe), = _dict(b, t + pal_info)[:1]
    po = t + pal_data + (struct.unpack_from("<H", pe, 0)[0] << 3)
    pal = []
    for i in range(16):
        c, = struct.unpack_from("<H", b, po + i * 2)
        r, g, bl = c & 31, (c >> 5) & 31, (c >> 10) & 31
        pal.append(((r << 3) | (r >> 2), (g << 3) | (g >> 2), (bl << 3) | (bl >> 2)))
    frames = {}
    for name, e in _dict(b, t + tex_info):
        prm, = struct.unpack_from("<I", e, 0)
        off, w, h, fmt = (prm & 0xFFFF) << 3, 8 << ((prm >> 20) & 7), 8 << ((prm >> 23) & 7), (prm >> 26) & 7
        assert fmt == 3, f"texture format {fmt} (want 4bpp)"
        img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        base = t + tex_data + off
        for i in range(w * h):
            v = (b[base + i // 2] >> ((i & 1) * 4)) & 15
            if v:
                img.putpixel((i % w, i // w), (*pal[v], 255))
        if shrink:  # figures are ~26 px tall vs FireRed's ~20: scale the 30x30 above the frame's bottom edge by 0.8
            small = downscale(img.crop((1, 2, 31, 32)), 24)
            img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
            img.paste(small, (4, 8))  # same centre (x=16), same bottom edge
        frames[int(name.rsplit(".", 1)[1])] = img
    strip = Image.new("RGBA", (32 * len(OW_ORDER), 32), (0, 0, 0, 0))
    for k, n in enumerate(OW_ORDER):
        strip.paste(frames[n], (k * 32, 0))
    return strip


def main() -> None:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    rom_path = Path(args[0]) if args else DEFAULT_ROM
    if not rom_path.exists():
        sys.exit(f"HeartGold ROM not found: {rom_path}")
    sha = hashlib.sha1(rom_path.read_bytes()).hexdigest()
    if sha != SHA1:
        sys.exit(f"Unexpected ROM sha1 {sha} (want {SHA1}: Pokemon - HeartGold Version (USA)). Refusing.")
    rom = ndspy.rom.NintendoDSRom.fromFile(str(rom_path))
    narc = lambda p: ndspy.narc.NARC(rom.getFileByName(p)).files
    trf, icons, mmodel = narc("a/0/5/8"), narc("a/0/1/8"), narc("a/0/8/1")

    written = []
    items_only = "--items" in sys.argv
    tdir = OUT / "trainers" / "hgss"
    tdir.mkdir(parents=True, exist_ok=True)
    for name, cls in ({} if items_only else TRAINERS).items():
        img = trainer_pic(trf, cls)
        if "--native" not in sys.argv:
            img = downscale(img, 64)  # 80x80 -> FireRed's 64x64 scale
        f = tdir / f"{name}.png"
        img.save(f)
        written.append((f, img))
        print(f"wrote {f.relative_to(ROOT)}  {img.size[0]}x{img.size[1]}  (class {cls})")
    idir = OUT / "items" / "hgss"
    idir.mkdir(parents=True, exist_ok=True)
    for key, (gi, pi) in ITEMS.items():
        img = item_icon(icons, gi, pi)
        bb = img.getbbox()
        if bb and bb[2] <= 24 and bb[3] <= 24:
            img = img.crop((0, 0, 24, 24))
        f = idir / f"{key}.png"
        img.save(f)
        written.append((f, img))
        print(f"wrote {f.relative_to(ROOT)}  {img.size[0]}x{img.size[1]}")
    odir = OUT / "overworld" / "people" / "hgss"
    odir.mkdir(parents=True, exist_ok=True)
    for name, idx in ({} if items_only else OVERWORLD).items():
        img = overworld(bytes(mmodel[idx]), shrink="--native" not in sys.argv)
        f = odir / f"{name}.png"
        img.save(f)
        written.append((f, img.crop((0, 0, 32, 32))))
        print(f"wrote {f.relative_to(ROOT)}  {img.size[0]}x{img.size[1]}  (mmodel {idx})")
    print("no Kurt portrait: Kurt is not a trainer class in HGSS (keep the stand-in)")

    if "--sheet" in sys.argv:
        cols, cw = 8, 84
        rows = (len(written) + cols - 1) // cols
        sheet = Image.new("RGBA", (cols * cw, rows * cw), (90, 110, 140, 255))
        for k, (_f, img) in enumerate(written):
            sheet.alpha_composite(img, ((k % cols) * cw + (cw - img.size[0]) // 2, (k // cols) * cw + (cw - img.size[1]) // 2))
        sp = ROOT / "tests" / "out" / "johto" / "hgss_sheet.png"
        sp.parent.mkdir(parents=True, exist_ok=True)
        sheet.resize((sheet.size[0] * 2, sheet.size[1] * 2), Image.NEAREST).save(sp)
        print(f"wrote {sp.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
