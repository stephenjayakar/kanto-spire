import { internalMutation, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { cleanRun, ensurePlayer, normEmail, partnerCoopRuns, runInput, versionTotals, playerFor, requireUser } from "./lib";
import { Doc, Id } from "./_generated/dataModel";

// Records a finished run and returns its score and rank. Idempotent per clientRunId.
export const submit = mutation({
  args: { run: runInput },
  handler: async (ctx, { run }) => {
    const player = await ensurePlayer(ctx, await requireUser(ctx));
    const dup = await ctx.db
      .query("runs")
      .withIndex("by_player_clientRunId", (q) => q.eq("playerId", player._id).eq("clientRunId", run.clientRunId))
      .unique();
    if (dup) return { id: dup._id, score: dup.score, duplicate: true };

    const row = cleanRun(run);
    const score = row.score;
    const id = await ctx.db.insert("runs", { ...row, playerId: player._id, playerName: player.name });
    const won = run.result !== "lose";
    await ctx.db.patch(player._id, {
      runs: player.runs + 1,
      wins: player.wins + (won ? 1 : 0),
      bestScore: Math.max(player.bestScore, score),
    });
    return { id, score, duplicate: false };
  },
});

// Global top runs, optionally for one world (spire, or the old kanto / hoenn) and/or one game version.
export const leaderboard = query({
  args: { world: v.optional(v.string()), version: v.optional(v.string()), limit: v.optional(v.number()), sort: v.optional(v.union(v.literal("recent"), v.literal("score"))) },
  handler: async (ctx, { world, version, limit, sort }) => {
    await requireUser(ctx);
    const n = Math.min(limit ?? 10, 50);
    const runs = ctx.db.query("runs");
    if (sort === "recent") {
      // newest first
      const r = version
        ? world
          ? runs.withIndex("by_version_world_finishedAt", (q) => q.eq("version", version).eq("world", world))
          : runs.withIndex("by_version_finishedAt", (q) => q.eq("version", version))
        : world
          ? runs.withIndex("by_world_finishedAt", (q) => q.eq("world", world))
          : runs.withIndex("by_finishedAt");
      return await r.order("desc").take(n);
    }
    const q = version
      ? world
        ? runs.withIndex("by_version_world_score", (q) => q.eq("version", version).eq("world", world))
        : runs.withIndex("by_version_score", (q) => q.eq("version", version))
      : world
        ? runs.withIndex("by_world_score", (q) => q.eq("world", world))
        : runs.withIndex("by_score");
    return await q.order("desc").take(n);
  },
});

// The calling trainer's recent runs and personal bests, optionally for one game version.
// Co-op team runs are one row owned by the host: a partner's list adds the ones they played in (partnerCoopRuns).
export const mine = query({
  args: { version: v.optional(v.string()), limit: v.optional(v.number()) },
  handler: async (ctx, { version, limit }) => {
    const user = await requireUser(ctx);
    const player = await playerFor(ctx, user);
    if (!player) return null;
    const n = Math.min(limit ?? 10, 50);
    const team = await partnerCoopRuns(ctx, normEmail(user.email || player.email), version);
    const merge = (rows: Doc<"runs">[], key: "finishedAt" | "score") =>
      team.length ? [...rows, ...team.filter((t) => !rows.some((r) => r._id === t._id))].sort((a, b) => b[key] - a[key]).slice(0, n) : rows;
    if (version) {
      const recent = await ctx.db
        .query("runs")
        .withIndex("by_player_version_finishedAt", (q) => q.eq("playerId", player._id).eq("version", version))
        .order("desc")
        .take(n);
      const best = await ctx.db
        .query("runs")
        .withIndex("by_player_version_score", (q) => q.eq("playerId", player._id).eq("version", version))
        .order("desc")
        .take(n);
      const t = await versionTotals(ctx, player._id, version);
      const runs = t.runs + team.length, wins = t.wins + team.filter((r) => r.result !== "lose").length;
      const best2 = merge(best, "score");
      return { player: { name: player.name, runs, wins, bestScore: best2[0]?.score ?? 0 }, recent: merge(recent, "finishedAt"), best: best2, version };
    }
    const recent = await ctx.db
      .query("runs")
      .withIndex("by_player_finishedAt", (q) => q.eq("playerId", player._id))
      .order("desc")
      .take(n);
    const best = await ctx.db
      .query("runs")
      .withIndex("by_player_score", (q) => q.eq("playerId", player._id))
      .order("desc")
      .take(n);
    // (the trainer's totals already count co-op runs: coop:finish credits every member)
    return { player: { name: player.name, runs: player.runs, wins: player.wins, bestScore: player.bestScore }, recent: merge(recent, "finishedAt"), best: merge(best, "score") };
  },
});

// Removes runs written by tests (clientRunId "e2e-…") and recomputes those trainers' totals from the
// runs they have left: npx convex run runs:purgeTests (dev only; tests never submit to prod)
export const purgeTests = internalMutation({
  args: {},
  handler: async (ctx) => {
    let n = 0;
    const touched = new Set<Id<"players">>();
    for (const r of await ctx.db.query("runs").collect()) {
      if (!r.clientRunId.startsWith("e2e-")) continue;
      await ctx.db.delete(r._id); touched.add(r.playerId); n++;
    }
    for (const id of touched) {
      const left = await ctx.db.query("runs").withIndex("by_player_finishedAt", (q) => q.eq("playerId", id)).collect();
      await ctx.db.patch(id, {
        runs: left.length, wins: left.filter((r) => r.result !== "lose").length, bestScore: Math.max(0, ...left.map((r) => r.score)),
      });
    }
    return n;
  },
});
