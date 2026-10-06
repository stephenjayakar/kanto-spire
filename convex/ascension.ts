// Ascension unlocks per starter, rebuilt from past clears: a clear at An with a starter unlocks A(n+1) for that
// starter (A10 max). Server copy of the client rule (web/src/game/unlocks.js; tests/logic.test.mjs checks they
// agree). No imports, so the logic test can load it directly.
export const ASC_VER = 1;
const MAX_ASC = 10;
const clampAsc = (n: unknown) => Math.max(0, Math.min(MAX_ASC, Number(n) | 0));

export type HistoryRun = { starter?: unknown; ascension?: unknown; result?: unknown; act?: unknown };
// A clear: a won run (win / postgame), or one that reached the post-game act (a CHAMPION who carried on and
// then blacked out is saved as 'lose' with act 5 in the local history).
export const historyWon = (r: HistoryRun) => r.result === "win" || r.result === "postgame" || (Number(r.act) | 0) >= 5;

export function ascFromClears(runs: HistoryRun[]): Record<string, number> {
  const ascBy: Record<string, number> = {};
  for (const r of runs) {
    if (!r || typeof r.starter !== "string" || !historyWon(r)) continue;
    ascBy[r.starter] = Math.max(ascBy[r.starter] || 0, clampAsc((Number(r.ascension) | 0) + 1));
  }
  return ascBy;
}

// Sets meta.ascBy to the per-starter levels from the clears, never lowering one already unlocked (e.g. earned
// since the client started tracking them). Returns the new map and whether the meta changed.
export function applyClears(meta: Record<string, any>, runs: HistoryRun[]) {
  const before = meta.ascBy && typeof meta.ascBy === "object" ? meta.ascBy : {};
  const ascBy: Record<string, number> = { ...before };
  for (const [s, n] of Object.entries(ascFromClears(runs))) ascBy[s] = Math.max(clampAsc(ascBy[s]), n);
  const changed = meta.ascVer !== ASC_VER || JSON.stringify(ascBy) !== JSON.stringify(before);
  meta.ascBy = ascBy;
  meta.ascVer = ASC_VER;
  return { ascBy, changed };
}
