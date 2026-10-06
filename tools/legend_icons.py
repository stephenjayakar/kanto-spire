"""Held-item icons for the legendary items (THUNDER FEATHER, ROCK CORE...).

There's no art for them in FireRed, so each one is the legendary's own party icon (first frame), cropped
to the 24x24 item icon size around the sprite. Reads the already extracted icons in web/assets/gfx/pokemon
(run tools/extract_gfx.py first) and writes web/assets/gfx/items/<item>.png (gitignored like all assets).

    python tools/legend_icons.py
"""
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
GFX = ROOT / "web" / "assets" / "gfx"
# item key -> species folder (keep in sync with BIRDS in web/src/game/acts.js)
ICONS = {
    "thunder_feather": "zapdos", "frost_feather": "articuno", "flame_feather": "moltres",
    "rock_core": "regirock", "ice_core": "regice", "steel_core": "registeel",
}


def main() -> None:
    for item, species in ICONS.items():
        src = GFX / "pokemon" / species / "icon.png"
        frame = Image.open(src).convert("RGBA").crop((0, 0, 32, 32))
        x0, y0, x1, y1 = frame.getbbox()
        cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
        left = max(0, min(8, cx - 12))
        top = max(0, min(8, cy - 12))
        out = frame.crop((left, top, left + 24, top + 24))
        dst = GFX / "items" / f"{item}.png"
        out.save(dst)
        print("wrote", dst.relative_to(ROOT))


if __name__ == "__main__":
    main()
