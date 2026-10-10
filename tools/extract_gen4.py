#!/usr/bin/env python3
"""
Kanto Spire -- Gen 4 species groundwork (dex 387-493), extracted from the owner's HeartGold (USA) ROM.

HIDDEN: nothing in the game uses this yet. The game only reads it when GEN4_ENABLED (web/src/game/gen4.js) is
true; with the flag off, no file below is loaded and no code path changes.

Writes (add-only, distinct paths; every output lives under a gen4/ folder, packed as the lazy 'gen4' asset pack
by tools/upload_packs.cjs, which leaves that pack out unless --gen4 is passed):

    data/gen4/species.json             107 species in the game's species.json format, plus crossGen: the Gen 1-3
                                       -> Gen 4 evolutions (MAGNETON -> MAGNEZONE...) and the Gen 4 babies of
                                       Gen 1-3 lines (SNORLAX <- MUNCHLAX...), applied only with the flag on
    gfx/gen4/pokemon/<mon>/front.png   64x64, frame 0 (like FireRed's front.png), + front_shiny.png
                          /anim_front.png  128x64: HGSS's 2-frame idle animation (frame 0 | frame 1), + _shiny
                          /back.png        64x64, + back_shiny.png
                          /icon.png        32x64: the 2-frame party icon (FireRed layout: frames stacked)
    sound/gen4/cries/<mon>.wav         the HGSS cry sample (8-bit PCM, its native rate)

Sources: everything that is game mechanics comes from the ROM: base stats, types, abilities, catch rate, EXP yield,
EV yield, growth rate, egg groups, gender ratio, held items, colour (personal, a/0/0/2), level-up learnsets
(a/0/3/3), evolutions (a/0/3/4), TM/HM compatibility (personal bits + pokeheartgold's sTMHMMoves order), sprites
(pokegra, a/0/0/4), icons (a/0/2/0, palette table from pokeheartgold src/pokemon_icon_idx.c) and cries
(gs_sound_data.sdat, wave archive <dex>). The English name, category, POKéDEX text (the HeartGold entry), height,
weight, legendary flags, and the HGSS tutor / egg move lists come from PokéAPI's CSV dump (its HeartGold
version data), which saves decoding the DS text banks.

Scale (measured against FireRed on all 386 Gen 1-3 species, which the ROM also holds): HGSS front sprites are
only ~6% bigger than FireRed's (median sqrt-area ratio 1.06) inside a 25% bigger frame (80 vs 64), so the
portraits' fixed 80 -> 64 shrink would leave Gen 4 fronts ~13% smaller than FireRed's mons. Fronts are scaled by
min(0.94, 64 / their size) (median ratio to FireRed 1.005), backs by the fixed 0.8 (HGSS backs are drawn bigger;
0.8 gives a median 1.05), both with extract_hgss.downscale()'s palette-safe vote filter. Shiny and animation
frames share the normal frame's pixel layout exactly.

Moves and abilities are limited to what the game has: a learnset move is kept when it is in moves.json (FireRed)
or web/src/game/gen4_data.js (the Gen 4 moves already in the game); abilities are matched to abilities.json by
name, else dropped (the ROM's own two are kept as gen4Abilities for later).

Usage (needs ndspy and Pillow):
    python tools/extract_gen4.py [path/to/heartgold_usa.nds] [--csv <PokéAPI csv dir>] [--src <pokeheartgold dir>]
    ... --sheet   also writes tests/out/gen4/extract_sheet.png;  --only 462-466  just those dex numbers (testing)
Without --csv / --src it downloads the few files it needs from GitHub (PokéAPI, pret/pokeheartgold).
"""
from __future__ import annotations

import csv
import hashlib
import io
import json
import re
import struct
import sys
import urllib.request
import wave
from pathlib import Path

import ndspy.narc
import ndspy.rom
import ndspy.soundArchive
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from extract_hgss import SHA1, DEFAULT_ROM, downscale, palette  # noqa: E402  (same ROM, same filter)

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "web" / "assets"
GFX = ASSETS / "gfx" / "gen4" / "pokemon"
DATA = ASSETS / "data" / "gen4"
CRIES = ASSETS / "sound" / "gen4" / "cries"
FIRST, LAST = 387, 493
ID_BASE = 412 - FIRST  # game species ids continue after FireRed's last (CHIMECHO = 411): TURTWIG = 412

POKEAPI = "https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv/"
PRET = "https://raw.githubusercontent.com/pret/pokeheartgold/master/"
HGSS_VERSION, HGSS_VG = "15", "10"  # PokéAPI: version heartgold, version group heartgold-soulsilver

TYPES = ["NORMAL", "FIGHTING", "FLYING", "POISON", "GROUND", "ROCK", "BUG", "GHOST", "STEEL", "MYSTERY",
         "FIRE", "WATER", "GRASS", "ELECTRIC", "PSYCHIC", "ICE", "DRAGON", "DARK"]
EGG = [None, "MONSTER", "WATER_1", "BUG", "FLYING", "FIELD", "FAIRY", "GRASS", "HUMAN_LIKE", "WATER_3", "MINERAL",
       "AMORPHOUS", "WATER_2", "DITTO", "DRAGON", "UNDISCOVERED"]
GROWTH = ["MEDIUM_FAST", "ERRATIC", "FLUCTUATING", "MEDIUM_SLOW", "FAST", "SLOW"]
COLORS = ["RED", "BLUE", "YELLOW", "GREEN", "BLACK", "BROWN", "PURPLE", "GRAY", "WHITE", "PINK"]
# pokeheartgold include/constants/pokemon.h EVO_* -> this game's evolution method names (FireRed's where they
# exist; the Gen 4 ones are new names nothing reads yet). param: 'level' | 'item' | 'move' | 'species' | None
EVO = {
    1: ("FRIENDSHIP", None), 2: ("FRIENDSHIP_DAY", None), 3: ("FRIENDSHIP_NIGHT", None), 4: ("LEVEL", "level"),
    5: ("TRADE", None), 6: ("TRADE_ITEM", "item"), 7: ("ITEM", "item"), 8: ("LEVEL_ATK_GT_DEF", "level"),
    9: ("LEVEL_ATK_EQ_DEF", "level"), 10: ("LEVEL_ATK_LT_DEF", "level"), 11: ("LEVEL_SILCOON", "level"),
    12: ("LEVEL_CASCOON", "level"), 13: ("LEVEL_NINJASK", "level"), 14: ("LEVEL_SHEDINJA", "level"),
    15: ("BEAUTY", "level"), 16: ("ITEM_MALE", "item"), 17: ("ITEM_FEMALE", "item"),
    18: ("HOLD_ITEM_DAY", "item"), 19: ("HOLD_ITEM_NIGHT", "item"), 20: ("KNOWS_MOVE", "move"),
    21: ("PARTY_SPECIES", "species"), 22: ("LEVEL_MALE", "level"), 23: ("LEVEL_FEMALE", "level"),
    24: ("MAGNETIC_FIELD", None), 25: ("MOSS_ROCK", None), 26: ("ICE_ROCK", None),
}
FRONT_MAX_SCALE, BACK_SCALE = 0.94, 0.8


# ---- sources -----------------------------------------------------------------------------------------------
def fetch(url: str) -> bytes:
    with urllib.request.urlopen(url, timeout=120) as r:
        return r.read()


def text_source(local: Path | None, remote: str) -> str:
    if local:
        return local.read_text(encoding="utf-8")
    print("download", remote)
    return fetch(remote).decode("utf-8")


def pokeapi(csv_dir: Path | None, name: str) -> list[dict]:
    return list(csv.DictReader(io.StringIO(text_source(csv_dir / f"{name}.csv" if csv_dir else None, POKEAPI + name + ".csv"))))


def defines(src: str, prefix: str) -> dict[int, str]:
    out = {}
    for m in re.finditer(rf"#define\s+{prefix}(\w+)\s+(\d+)\b", src):
        out.setdefault(int(m.group(2)), m.group(1))
    return out


def norm(k: str) -> str:
    return k.replace("_", "")


# ---- graphics ----------------------------------------------------------------------------------------------
def pokegra(b: bytes) -> list[list[int]]:
    """An HGSS pokegra NCGR (160x80, two 80x80 frames side by side, PRNG-encrypted) -> rows of palette indices."""
    off = 0x10
    assert b[off:off + 4] == b"RAHC", "not an NCGR"
    size, = struct.unpack_from("<I", b, off + 24)
    data = list(struct.unpack_from("<%dH" % (size // 2), b, off + 0x20))
    seed = data[0]
    for i in range(len(data)):
        data[i] ^= seed & 0xFFFF
        seed = (seed * 0x41C64E6D + 0x6073) & 0xFFFFFFFF
    px = []
    for w in data:
        px += [w & 15, (w >> 4) & 15, (w >> 8) & 15, w >> 12]
    return [px[y * 160:(y + 1) * 160] for y in range(80)]


def unique_palette(pal: list[tuple[int, int, int]]) -> list[tuple[int, int, int]]:
    """Nudge duplicate colours apart by one blue step so an RGBA image maps back to palette indices."""
    seen, out = set(), []
    for c in pal:
        k, n = c, 0
        while k in seen:  # 1, -1, 2, -2 ... blue steps (clamped), until free
            n += 1
            d = (n + 1) // 2 * (1 if n % 2 else -1)
            k = (c[0], c[1], min(255, max(0, c[2] + d)))
        seen.add(k)
        out.append(k)
    return out


def to_rgba(rows, pal, x0=0, y0=0, w=80, h=80) -> Image.Image:
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    p = img.load()
    for y in range(h):
        row = rows[y0 + y]
        for x in range(w):
            v = row[x0 + x]
            if v:
                p[x, y] = (*pal[v], 255)
    return img


def bbox(rows, x0, w=80) -> tuple[int, int, int, int] | None:
    xs, ys = [], []
    for y, row in enumerate(rows):
        for x in range(w):
            if row[x0 + x]:
                xs.append(x); ys.append(y)
    return (min(xs), min(ys), max(xs) + 1, max(ys) + 1) if xs else None


def union(a, b):
    if not a or not b:
        return a or b
    return (min(a[0], b[0]), min(a[1], b[1]), max(a[2], b[2]), max(a[3], b[3]))


def shrink_frames(rows, pals, scale_max: float, fixed: bool):
    """Both 80x80 frames -> 64x64 per palette, scaled alike. Returns {pal_name: [frame0, frame1]} (RGBA images).

    fixed:  the whole 80x80 frame -> 64x64 (scale 0.8, like the trainer portraits).
    else:   the union bbox of both frames scaled by min(scale_max, 64 / its size), placed so its centre keeps
            its offset from the frame centre (scaled) and its feet land where the 0.8 shrink puts them, clamped
            inside the 64x64 frame.
    """
    upal = unique_palette(pals["normal"])
    if bbox(rows, 0) and not bbox(rows, 80):  # (a blank second frame, e.g. BURMY: hold the first)
        rows = [r[:80] + r[:80] for r in rows]
    box = union(bbox(rows, 0), bbox(rows, 80))
    out = {k: [] for k in pals}
    if box is None:
        for k in pals:
            out[k] = [Image.new("RGBA", (64, 64), (0, 0, 0, 0))] * 2
        return out, 0.8
    if fixed:
        s, crop = 0.8, (0, 0, 80, 80)
        size, dest = (64, 64), (0, 0)
    else:
        bw, bh = box[2] - box[0], box[3] - box[1]
        s = min(scale_max, 64 / max(bw, bh))
        size = (max(1, round(bw * s)), max(1, round(bh * s)))
        cx = 32 + ((box[0] + box[2]) / 2 - 40) * s
        bottom = round(box[3] * 0.8)
        dx = min(max(round(cx - size[0] / 2), 0), 64 - size[0])
        dy = min(max(bottom - size[1], 0), 64 - size[1])
        crop, dest = box, (dx, dy)
    rev = {c: i for i, c in enumerate(upal)}
    for f in range(2):
        src = to_rgba(rows, upal, x0=f * 80).crop(crop)
        small = downscale(src, size)
        sp = small.load()
        idx = [[rev.get(sp[x, y][:3]) if sp[x, y][3] else 0 for x in range(size[0])] for y in range(size[1])]
        for k, pal in pals.items():
            img = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
            p = img.load()
            for y in range(size[1]):
                for x in range(size[0]):
                    v = idx[y][x]
                    if v:
                        p[dest[0] + x, dest[1] + y] = (*pal[v], 255)
            out[k].append(img)
    return out, s


def nclr_palettes(b: bytes) -> list[list[tuple[int, int, int]]]:
    off = 0x10
    assert b[off:off + 4] == b"TTLP", "not an NCLR"
    size, = struct.unpack_from("<I", b, off + 0x10)
    base = off + 0x18
    n = min(size, len(b) - base) // 32
    pals = []
    for k in range(n):
        pal = []
        for i in range(16):
            c, = struct.unpack_from("<H", b, base + k * 32 + i * 2)
            r, g, bl = c & 31, (c >> 5) & 31, (c >> 10) & 31
            pal.append(((r << 3) | (r >> 2), (g << 3) | (g >> 2), (bl << 3) | (bl >> 2)))
        pals.append(pal)
    return pals


def icon(b: bytes, pal) -> Image.Image:
    """A poke_icon NCGR (32x64 = two 32x32 frames, 8x8 tiles in rows of 4) -> 32x64 RGBA, FireRed's layout."""
    off = 0x10
    assert b[off:off + 4] == b"RAHC", "not an NCGR"
    scanned, = struct.unpack_from("<I", b, off + 20)
    size, = struct.unpack_from("<I", b, off + 24)
    px = []
    for byte in b[off + 0x20: off + 0x20 + size]:
        px += [byte & 15, byte >> 4]
    img = Image.new("RGBA", (32, 64), (0, 0, 0, 0))
    p = img.load()
    for t in range(32):
        tx, ty = t % 4, t // 4
        for i in range(64):
            j = (ty * 8 + i // 8) * 32 + tx * 8 + i % 8 if scanned else t * 64 + i
            v = px[j] if j < len(px) else 0
            if v:
                p[tx * 8 + i % 8, ty * 8 + i // 8] = (*pal[v], 255)
    return img


def strip(frames) -> Image.Image:
    out = Image.new("RGBA", (64 * len(frames), 64), (0, 0, 0, 0))
    for k, f in enumerate(frames):
        out.paste(f, (64 * k, 0))
    return out


def write_wav(path: Path, swav) -> None:
    """An SWAV (PCM8 / PCM16 / IMA-ADPCM) -> a mono WAV (8-bit PCM for PCM8, else 16-bit)."""
    t = int(swav.waveType)
    data = bytes(swav.data)
    if t == 0:  # PCM8, signed -> WAV's unsigned
        frames, width = bytes((v + 128) & 255 for v in data), 1
    elif t == 1:
        frames, width = data, 2
    else:  # IMA-ADPCM: 4-byte header (initial sample, step index), then nibbles low-first
        steps = [7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45, 50, 55, 60, 66, 73, 80, 88,
                 97, 107, 118, 130, 143, 157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408, 449, 494, 544, 598, 658,
                 724, 796, 876, 963, 1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066, 2272, 2499, 2749, 3024, 3327,
                 3660, 4026, 4428, 4871, 5358, 5894, 6484, 7132, 7845, 8630, 9493, 10442, 11487, 12635, 13899, 15289,
                 16818, 18500, 20350, 22385, 24623, 27086, 29794, 32767]
        idx_tab = [-1, -1, -1, -1, 2, 4, 6, 8]
        s, k = struct.unpack_from("<hH", data, 0)
        out = bytearray()
        for byte in data[4:]:
            for n in (byte & 15, byte >> 4):
                d = steps[k] >> 3
                if n & 1: d += steps[k] >> 2
                if n & 2: d += steps[k] >> 1
                if n & 4: d += steps[k]
                s = max(-32768, min(32767, s - d if n & 8 else s + d))
                k = max(0, min(88, k + idx_tab[n & 7]))
                out += struct.pack("<h", s)
        frames, width = bytes(out), 2
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1); w.setsampwidth(width); w.setframerate(swav.sampleRate); w.writeframes(frames)


# ---- text ---------------------------------------------------------------------------------------------------
def dex_text(s: str, names: list[str]) -> str:
    s = re.sub(r"[\s­]+", " ", s.replace("\f", " ")).strip()
    s = s.replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"')
    s = re.sub(r"Pok[eé]mon", "POKéMON", s, flags=re.I)
    for n in names:  # species names in caps, like FireRed's entries
        s = re.sub(rf"\b{re.escape(n)}(?!\w)", n.upper(), s)
    return s


def main() -> None:
    argv = sys.argv[1:]
    opt = lambda k: Path(argv[argv.index(k) + 1]) if k in argv else None
    csv_dir, src_dir = opt("--csv"), opt("--src")
    skip = {i + 1 for i, a in enumerate(argv) if a in ("--csv", "--src", "--only")}
    args = [a for i, a in enumerate(argv) if not a.startswith("--") and i not in skip]
    rom_path = Path(args[0]) if args else DEFAULT_ROM
    if not rom_path.exists():
        sys.exit(f"HeartGold ROM not found: {rom_path}")
    sha = hashlib.sha1(rom_path.read_bytes()).hexdigest()
    if sha != SHA1:
        sys.exit(f"Unexpected ROM sha1 {sha} (want {SHA1}: Pokemon - HeartGold Version (USA)). Refusing.")
    rom = ndspy.rom.NintendoDSRom.fromFile(str(rom_path))
    narc = lambda p: ndspy.narc.NARC(rom.getFileByName(p)).files
    personal, gra, icons, lvl, evo = narc("a/0/0/2"), narc("a/0/0/4"), narc("a/0/2/0"), narc("a/0/3/3"), narc("a/0/3/4")

    pret = lambda f: text_source(src_dir / Path(f).name if src_dir else None, PRET + f)
    SPECIES = defines(pret("include/constants/species.h"), "SPECIES_")
    MOVES_H = defines(pret("include/constants/moves.h"), "MOVE_")
    ABIL_H = defines(pret("include/constants/abilities.h"), "ABILITY_")
    ITEMS_H = defines(pret("include/constants/items.h"), "ITEM_")
    item_c = pret("src/item.c")
    tm_block = item_c[item_c.index("sTMHMMoves[]"):]
    TMHM = re.findall(r"MOVE_(\w+),", tm_block[:tm_block.index("};")])
    assert len(TMHM) == 100, len(TMHM)
    icon_c = pret("src/pokemon_icon_idx.c")
    ib = icon_c[icon_c.index("sPokemonPalNoBySpeciesAndForm[]"):]
    ICON_PAL = [int(v) for v in re.findall(r"\b(\d+)\b", ib[ib.index("{"):ib.index("};")])]

    # the game's data
    jl = lambda f: json.loads((ASSETS / "data" / f).read_text(encoding="utf-8"))
    fr_species, fr_moves, fr_abil, fr_items = jl("species.json"), jl("moves.json"), jl("abilities.json"), jl("items.json")
    g4 = (ROOT / "web" / "src" / "game" / "gen4_data.js").read_text(encoding="utf-8")
    g4_moves = {k: json.loads(v) for k, v in re.findall(r"^  (\w+): (\{.*\}),$", g4[:g4.index("export const LEARN")], re.M)}
    move_by_id = {m["id"]: k for k, m in fr_moves.items()} | {m["id"]: k for k, m in g4_moves.items()}
    move_key_by_name = {norm(k): k for k in list(fr_moves) + list(g4_moves)}
    abil_by_name = {norm(k): k for k in fr_abil}
    item_by_name = {norm(k): k for k in fr_items}
    fr_by_dex = {s["dex"]: k for k, s in fr_species.items() if s.get("dex")}
    key_of = lambda dex: fr_by_dex.get(dex) or SPECIES[dex]
    move_key = lambda mid: move_by_id.get(mid)
    item_key = lambda iid: item_by_name.get(norm(ITEMS_H.get(iid, "")), ITEMS_H.get(iid)) if iid else None
    tm_moves = [move_key_by_name.get(norm(m)) for m in TMHM]

    # PokéAPI text, sizes, flags, tutor/egg moves
    names_csv = pokeapi(csv_dir, "pokemon_species_names")
    en = {int(r["pokemon_species_id"]): r for r in names_csv if r["local_language_id"] == "9"}
    flavor = {int(r["species_id"]): r["flavor_text"] for r in pokeapi(csv_dir, "pokemon_species_flavor_text")
              if r["version_id"] == HGSS_VERSION and r["language_id"] == "9"}
    mons = {int(r["id"]): r for r in pokeapi(csv_dir, "pokemon")}
    spc = {int(r["id"]): r for r in pokeapi(csv_dir, "pokemon_species")}
    tutor, egg = {}, {}
    for r in pokeapi(csv_dir, "pokemon_moves"):
        d = int(r["pokemon_id"])
        if FIRST <= d <= LAST and r["version_group_id"] == HGSS_VG and r["pokemon_move_method_id"] in ("2", "3"):
            k = move_key(int(r["move_id"]))
            if k:
                (egg if r["pokemon_move_method_id"] == "2" else tutor).setdefault(d, set()).add(k)
    all_names = sorted((en[d]["name"] for d in range(1, LAST + 1)), key=len, reverse=True)

    sdat = ndspy.soundArchive.SDAT(rom.getFileByName("data/sound/gs_sound_data.sdat"))
    # (cry wave archive index = national dex; the WAVE_ARC_PV<n> names follow a pre-release order for Gen 4)

    def evolutions(dex):
        out = []
        b = evo[dex]
        for i in range(7):
            method, param, target = struct.unpack_from("<HHH", b, i * 6)
            if not method:
                continue
            name, kind = EVO[method]
            p = {"level": param, "item": item_key(param), "move": move_key(param) or MOVES_H.get(param),
                 "species": key_of(param) if param else None, None: None}[kind]
            out.append({"method": name, "param": p, "into": key_of(target)})
        return out

    species, cross_evo, cross_pre, report = {}, {}, {}, []
    pre_of = {}
    for dex in range(1, LAST + 1):
        for e in evolutions(dex):
            pre_of[e["into"]] = key_of(dex)
            if dex < FIRST and e["into"] not in fr_species:  # a Gen 1-3 mon gains a Gen 4 evolution
                cross_evo.setdefault(key_of(dex), []).append(e)
            if dex >= FIRST and e["into"] in fr_species:     # a Gen 4 baby of a Gen 1-3 line
                cross_pre[e["into"]] = key_of(dex)

    GFX.mkdir(parents=True, exist_ok=True); DATA.mkdir(parents=True, exist_ok=True); CRIES.mkdir(parents=True, exist_ok=True)
    icon_pals = nclr_palettes(icons[0])
    sheet_imgs = []
    only = [int(v) for v in str(opt("--only") or f"{FIRST}-{LAST}").split("-")]
    for dex in range(only[0], only[-1] + 1):
        key = key_of(dex)
        folder = key.lower()
        p = personal[dex]
        hp, atk, df, spe, spa, spd, t1, t2, catch, exp, evy, it1, it2, gender, cycles, friend, growth, eg1, eg2, ab1, ab2, run, color = \
            struct.unpack_from("<6B2BBBHHHBBBB2B2BBB", p, 0)
        tm_bits = int.from_bytes(p[0x1C:0x2C], "little")
        abil_names = [ABIL_H[a] for a in (ab1, ab2) if a]
        abil_names = list(dict.fromkeys(abil_names))
        abilities = [abil_by_name[norm(a)] for a in abil_names if norm(a) in abil_by_name]
        moves = []
        b = lvl[dex]
        for (w,) in struct.iter_unpack("<H", b[: len(b) // 2 * 2]):
            if w == 0xFFFF:
                break
            k = move_key(w & 0x1FF)
            if k:
                moves.append([w >> 9, k])
            else:
                report.append(f"{key}: drops level-{w >> 9} {MOVES_H.get(w & 0x1FF)} (not in the game)")
        tmhm = [tm_moves[i] for i in range(100) if tm_bits >> i & 1 and tm_moves[i]]
        api, api_spc = en[dex], spc[dex]
        genus = re.sub(r"\s*Pok[eé]mon$", "", api["genus"]).upper()
        entry = {
            "id": dex + ID_BASE, "dex": dex, "name": api["name"].upper(),
            "types": list(dict.fromkeys([TYPES[t1], TYPES[t2]])),
            "stats": {"hp": hp, "atk": atk, "def": df, "spa": spa, "spd": spd, "spe": spe},
            "evYield": {k: (evy >> (2 * i)) & 3 for i, k in enumerate(["hp", "atk", "def", "spe", "spa", "spd"])},
            "catchRate": catch, "expYield": exp, "growthRate": GROWTH[growth],
            "abilities": abilities, "gen4Abilities": abil_names,
            "genderRatio": gender, "eggGroups": list(dict.fromkeys(e for e in (EGG[eg1], EGG[eg2]) if e)),
            "eggCycles": cycles, "friendship": friend,
            "wildItems": {"common": item_key(it1), "rare": item_key(it2)},
            "safariZoneFleeRate": run, "bodyColor": COLORS[color & 0x7F],
            "evolutions": evolutions(dex), "preEvolution": pre_of.get(key),
            "learnset": moves, "tmhm": tmhm, "tmhmItems": [],
            "tutor": sorted(tutor.get(dex, set()) - {m for _, m in moves} - set(tmhm)),
            "eggMoves": sorted(egg.get(dex, set())),
            "category": genus, "dexText": dex_text(flavor.get(dex, ""), all_names),
            "height": int(mons[dex]["height"]), "weight": int(mons[dex]["weight"]),
            "gfx": folder, "gfxDir": f"gfx/gen4/pokemon/{folder}",
            "sprites": {"front": f"{folder}/front.png", "back": f"{folder}/back.png", "icon": f"{folder}/icon.png",
                        "anim": f"{folder}/anim_front.png", "animFrames": 2, "iconPal": ICON_PAL[dex], "frame": 0},
            "cryId": None, "cry": folder, "cryWav": None,
            "legendary": api_spc["is_legendary"] == "1", "mythical": api_spc["is_mythical"] == "1",
            "baby": api_spc["is_baby"] == "1", "gen4": True,
        }
        # sprites
        d = GFX / folder
        d.mkdir(parents=True, exist_ok=True)
        base = dex * 6
        front = gra[base + 3] or gra[base + 2]  # (male, else female-only)
        back = gra[base + 1] or gra[base + 0]
        pals = {"normal": palette(gra[base + 4]), "shiny": palette(gra[base + 5])}
        ff, fs = shrink_frames(pokegra(front), pals, FRONT_MAX_SCALE, fixed=False)
        bf, _ = shrink_frames(pokegra(back), pals, BACK_SCALE, fixed=True)
        files = {
            "front.png": ff["normal"][0], "front_shiny.png": ff["shiny"][0],
            "anim_front.png": strip(ff["normal"]), "anim_front_shiny.png": strip(ff["shiny"]),
            "back.png": bf["normal"][0], "back_shiny.png": bf["shiny"][0],
            "icon.png": icon(icons[dex + 7], icon_pals[ICON_PAL[dex]]),
        }
        for n, img in files.items():
            img.save(d / n)
        wav = sdat.waveArchives[dex][1]
        if wav and wav.waves:
            write_wav(CRIES / f"{folder}.wav", wav.waves[0])
            entry["cryWav"] = f"sound/gen4/cries/{folder}.wav"
        entry["spriteScale"] = round(fs, 3)
        species[key] = entry
        sheet_imgs.append((key, files["front.png"], files["anim_front.png"], files["back.png"], files["icon.png"]))
        print(f"{dex} {key:<10} {'/'.join(entry['types']):<16} front x{fs:.2f}  {len(moves)} moves  abilities {abilities} (rom {abil_names})")

    out = {
        "_comment": "GENERATED by tools/extract_gen4.py from the HeartGold (USA) ROM + PokéAPI text. Hidden: read only when GEN4_ENABLED (web/src/game/gen4.js).",
        "species": species,
        "crossGen": {"evolutions": cross_evo, "preEvolutions": cross_pre},
    }
    (DATA / "species.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"wrote {len(species)} species -> {(DATA / 'species.json').relative_to(ROOT)}")
    print("cross-gen evolutions:", {k: [e["into"] for e in v] for k, v in cross_evo.items()})
    print("cross-gen babies:", cross_pre)
    print(f"{len(report)} level-up moves dropped (not in the game)")
    print("cries:", sum(1 for s in species.values() if s["cryWav"]))

    if "--sheet" in argv:
        cols, cw, chh = 8, 200, 80
        rows = (len(sheet_imgs) + cols - 1) // cols
        sheet = Image.new("RGBA", (cols * cw, rows * chh), (200, 216, 200, 255))
        for k, (_key, f, a, bk, ic) in enumerate(sheet_imgs):
            x, y = (k % cols) * cw, (k // cols) * chh
            sheet.alpha_composite(a, (x, y + 8)); sheet.alpha_composite(ic.crop((0, 0, 32, 32)), (x + 132, y + 8))
        sp = ROOT / "tests" / "out" / "gen4" / "extract_sheet.png"
        sp.parent.mkdir(parents=True, exist_ok=True)
        sheet.save(sp)
        print("wrote", sp.relative_to(ROOT))


if __name__ == "__main__":
    main()
