# AGENTS.md: notes for contributors and coding agents

- **Never commit game assets**: `web/assets/`, `rom/`, `pokefirered/`, `dist/`, `node_modules/`, `.env.local`, `tests/out/`.
  Everything copyrighted is extracted locally from the user's own ROM.
- **Worktrees**: if you share `web/assets` and `node_modules` between worktrees through links, delete the links
  before removing a worktree. `git worktree remove --force` or `rm -rf` with the links in place deletes the shared
  assets.
- **Browser tests** must run muted (Chrome `--mute-audio`, Playwright `channel: 'chrome'`).
- **Versioning**: major.minor.patch in `web/src/game/version.js`.
  - Every player-facing release bumps the patch number and adds a new top entry to `PATCH_NOTES`. The title
    screen's patch-notes popup is keyed on `PATCH_NOTES[0].v`.
  - Minor bumps are for big features.
  - Changes that never reach players (docs, tests, tooling) don't bump.
- **Test bar** before shipping:
  - `node tests/logic.test.mjs`, `node tests/coop.test.mjs` and `node tests/saves.test.mjs`;
  - a balance check for balance-relevant changes (`node tests/balance.mjs`; use `--rotate` so the bot spreads EXP
    like a human);
  - one quick muted browser run of any changed UI.
- **Co-op determinism**: co-op is lockstep. Anything that touches battle or run state must stay deterministic
  under the shared action log. Cosmetic code (animations, tooltips) must never change it.
- **Saved games**: game-logic changes must not break saved games.
  - Solo: a new `Run` field gets a default in `Run.upgradeJSON` (`fromJSON` runs it on every load), and code
    tolerates fields that old saves lack.
  - Co-op resumes from checkpoints (`web/src/game/coop/snapshot.js`, written at every return to the map). Any change
    that can alter co-op replay (rules, numbers, starters, items, RNG use) must bump `LOGIC_ID` in
    `web/src/game/coop/engines.js`: older logs then replay on their frozen engine in `web/src/legacy/<id>/`.
  - Never edit `web/src/legacy/` or `tests/fixtures/` (real saves of past versions).
- **Commits**: no AI co-author trailers or "generated with" lines.
