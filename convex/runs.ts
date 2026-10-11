import { internalMutation, mutation, query } from "./_generated/server";
import { paginationOptsValidator, PaginationOptions } from "convex/server";
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

// ---- v0.5.2: the same lists in pages (RECORDS' LOAD MORE) ------------------------------------------
// Additive: leaderboard / mine above stay as they were for older clients. Each page reads one index range (no scans):
// { page, isDone, continueCursor }; pass continueCursor back for the next page. Page 1 is a live subscription.
const PAGE_MAX = 100;
const pageOpts = (o: PaginationOptions): PaginationOptions => ({ ...o, numItems: Math.max(1, Math.min(Math.floor(o.numItems) || 50, PAGE_MAX)) });

export const leaderboardPage = query({
  args: { world: v.optional(v.string()), version: v.optional(v.string()), sort: v.optional(v.union(v.literal("recent"), v.literal("score"))), paginationOpts: paginationOptsValidator },
  handler: async (ctx, { world, version, sort, paginationOpts }) => {
    await requireUser(ctx);
    const runs = ctx.db.query("runs");
    const q = sort === "recent"
      ? version
        ? world
          ? runs.withIndex("by_version_world_finishedAt", (q) => q.eq("version", version).eq("world", world))
          : runs.withIndex("by_version_finishedAt", (q) => q.eq("version", version))
        : world
          ? runs.withIndex("by_world_finishedAt", (q) => q.eq("world", world))
          : runs.withIndex("by_finishedAt")
      : version
        ? world
          ? runs.withIndex("by_version_world_score", (q) => q.eq("version", version).eq("world", world))
          : runs.withIndex("by_version_score", (q) => q.eq("version", version))
        : world
          ? runs.withIndex("by_world_score", (q) => q.eq("world", world))
          : runs.withIndex("by_score");
    const res = await q.order("desc").paginate(pageOpts(paginationOpts));
    return { page: res.page, isDone: res.isDone, continueCursor: res.continueCursor };
  },
});

// The calling trainer's runs, newest first, in pages. A partner's co-op team runs (partnerCoopRuns, a bounded list) go
// into the page their date falls in: newer than the page's last own run (all the rest on the last page), and not newer
// than `before` (the date of the last row the client already has). The first page also carries the totals (as mine).
export const minePage = query({
  args: { version: v.optional(v.string()), paginationOpts: paginationOptsValidator, before: v.optional(v.number()) },
  handler: async (ctx, { version, paginationOpts, before }) => {
    const user = await requireUser(ctx);
    const player = await playerFor(ctx, user);
    if (!player) return null;
    const own = version
      ? ctx.db.query("runs").withIndex("by_player_version_finishedAt", (q) => q.eq("playerId", player._id).eq("version", version))
      : ctx.db.query("runs").withIndex("by_player_finishedAt", (q) => q.eq("playerId", player._id));
    const res = await own.order("desc").paginate(pageOpts(paginationOpts));
    const team = await partnerCoopRuns(ctx, normEmail(user.email || player.email), version);
    const first = paginationOpts.cursor === null;
    const lo = res.isDone ? -Infinity : (res.page[res.page.length - 1]?.finishedAt ?? -Infinity);
    const hi = first ? Infinity : (before ?? Infinity);
    const extra = team.filter((t) => t.finishedAt >= lo && t.finishedAt <= hi && !res.page.some((r) => r._id === t._id));
    const page = extra.length ? [...res.page, ...extra].sort((a, b) => b.finishedAt - a.finishedAt) : res.page;
    if (!first) return { page, isDone: res.isDone, continueCursor: res.continueCursor };
    let stats = { name: player.name, runs: player.runs, wins: player.wins, bestScore: player.bestScore };
    if (version) {
      const t = await versionTotals(ctx, player._id, version);
      const top = await ctx.db.query("runs").withIndex("by_player_version_score", (q) => q.eq("playerId", player._id).eq("version", version)).order("desc").first();
      stats = { name: player.name, runs: t.runs + team.length, wins: t.wins + team.filter((r) => r.result !== "lose").length, bestScore: Math.max(top?.score ?? 0, ...team.map((r) => r.score)) };
    }
    return { page, isDone: res.isDone, continueCursor: res.continueCursor, player: stats, version };
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
