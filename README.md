# Kanto Spire

A browser roguelike deckbuilder: **Pokémon FireRed × Slay the Spire**. Your Pokémon's moves are your cards,
same-type cards form combos on top of real Gen 3 damage, and you climb a branching spire whose acts roll
Kanto, Hoenn or Johto. It has gym leaders with special rules, rivals who counter your starter, legendaries,
21 starters, ascensions A0–A10 (A8 is a Nuzlocke), and optional 2–4 player online co-op.

> **Unofficial fan project, not affiliated with Nintendo, Creatures or Game Freak.** This repository contains
> **no game assets**: you extract them yourself from your own copy of Pokémon FireRed. `web/assets/` is
> gitignored.

Player-facing rules: [docs/GAME.md](docs/GAME.md).

## Requirements

- **Node.js 22+** (no build step; plain ES modules)
- **Python 3.10+** with `numpy` and `Pillow` (`pip install numpy pillow`)
- **Git**
- **Your own Pokémon FireRed ROM** (USA v1.0, SHA1 `41cb23d8dccc8ebd7c649cd8fbb58eeace6e2fdc`) at `rom/firered.gba`
- **The [pret/pokefirered](https://github.com/pret/pokefirered) decomp**, cloned into `pokefirered/`
- Optional:
  - **Pokémon HeartGold ROM** (USA, SHA1 `4fcded0e2713dc03929845de631d0932ea2b5a37`) plus
    `pip install ndspy`, for the Johto trainer portraits. Without it, Johto trainers have no portrait.
  - **Google Chrome**, for the Playwright browser tests.
  - **A [Convex](https://convex.dev) account**, for sign-in, cloud saves, records and online co-op, run locally.
    The game runs fully offline without it.

## Build and run

```bash
npm install
git clone --depth 1 https://github.com/pret/pokefirered
mkdir -p rom && cp /path/to/your/firered.gba rom/firered.gba

# extract the assets into web/assets/ (gitignored)
node   tools/extract_data.js     # species, moves, trainers, encounters  -> web/assets/data
python tools/extract_gfx.py      # sprites, UI, fonts, terrains          -> web/assets/gfx
python tools/legend_icons.py     # legendary held-item icons (after extract_gfx)
python tools/extract_anims.py    # FireRed move animations               -> web/assets/anims
node   tools/extract_sound.js    # music, sound effects, cries           -> web/assets/sound
python tools/extract_hgss.py path/to/heartgold.nds   # optional: Johto portraits

node serve.cjs 8080              # open http://localhost:8080
```

## Tests

```bash
node tests/logic.test.mjs                               # game logic
node tests/coop.test.mjs                                # co-op engine (deterministic lockstep)
node tests/balance.mjs --runs 50 --asc 0 --seed TEST    # bot win rate (add --spire, --rotate, --starter X)
node tests/freeze_audit.cjs                             # muted Chrome: plays every scene type, checks for soft-locks
```

## Online features (optional, local only)

Sign-in, cloud saves, records and online co-op use [Convex](https://convex.dev) with
[Convex Auth](https://labs.convex.dev/auth) and Google sign-in. Run it locally, for yourself:

1. `npx convex dev` creates a development deployment and writes `.env.local`.
2. Set `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `JWT_PRIVATE_KEY`, `JWKS` and `SITE_URL` (`http://localhost:8091`)
   on that deployment.
3. Allow your account with `npx convex run access:allow '{"email":"you@example.com"}'`.
4. Run `node tools/cloud_config.cjs && node serve.cjs 8091` and open http://localhost:8091.

**Please don't host the game publicly.** Every copy serves assets extracted from a ROM, so a public deployment
would distribute Nintendo's assets. Keep it to your own machine.

## Layout

| Path | What |
|---|---|
| `web/src/engine/` | 640×360 canvas engine, FireRed bitmap font, UI, optional CRT shader |
| `web/src/audio/` | Reimplementation of the GBA's MP2K/m4a sound driver (HQ and bit-exact GBA modes) |
| `web/src/anim/` | Interpreter for FireRed's battle-animation scripts |
| `web/src/game/` | Pure, Node-testable game logic: battle, combos, items, regions, map, run state, co-op engine |
| `web/src/scenes/` | Title, starter select, map, battle, rewards, shop, events, records, co-op |
| `convex/` | Optional backend (run locally): auth, allowlist, saves, records, co-op rooms |
| `tools/` | Asset extractors and build scripts |
| `tests/` | Logic, co-op, balance bots and browser tests |
