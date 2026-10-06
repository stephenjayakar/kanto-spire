import { internalMutation, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { cleanVersion, ensurePlayer, versionTotals, playerFor, requireUser, scoreRun } from "./lib";
import { resultValidator } from "./schema";
import { Id } from "./_generated/dataModel";

const runInput = v.object({
  clientRunId: v.string(),
  result: resultValidator,
  world: v.string(),
  ascension: v.number(),
  act: v.number(),
  actName: v.string(),
  floor: v.number(),
  starter: v.string(),
  party: v.array(v.object({ species: v.string(), level: v.number(), shiny: v.boolean() })),
  seed: v.string(),
  stats: v.object({
    floors: v.number(),
    battles: v.number(),
    trainers: v.number(),
    caught: v.number(),
    bestHand: v.number(),
    crits: v.number(),
    elites: v.number(),
    bosses: v.number(),
    moneyEarned: v.number(),
  }),
  durationMs: v.number(),
  finishedAt: v.number(),
  version: v.optional(v.string()), // game version (VERSION in web/src/game/version.js); older clients omit it
  regions: v.optional(v.string()), // v0.1.0 spire runs: the act regions, e.g. "K-H-H-K"
});

const nonNeg = (n: number, max: number) => Math.max(0, Math.min(max, Math.floor(Number.isFinite(n) ? n : 0)));

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

    const s = run.stats;
    const stats = {
      floors: nonNeg(s.floors, 1000), battles: nonNeg(s.battles, 1000), trainers: nonNeg(s.trainers, 1000),
      caught: nonNeg(s.caught, 1000), bestHand: nonNeg(s.bestHand, 1e9), crits: nonNeg(s.crits, 1e6),
      elites: nonNeg(s.elites, 100), bosses: nonNeg(s.bosses, 100), moneyEarned: nonNeg(s.moneyEarned, 1e9),
    };
    const ascension = nonNeg(run.ascension, 20);
    const score = scoreRun({ result: run.result, ascension, stats });
    const id = await ctx.db.insert("runs", {
      ...run,
      clientRunId: run.clientRunId.slice(0, 64),
      seed: run.seed.slice(0, 32),
      ...(run.regions !== undefined ? { regions: run.regions.slice(0, 24) } : {}),
      actName: run.actName.slice(0, 40),
      party: run.party.slice(0, 6),
      ascension, stats, score,
      act: nonNeg(run.act, 20), floor: nonNeg(run.floor, 1000), durationMs: nonNeg(run.durationMs, 1e10),
      playerId: player._id, playerName: player.name,
      version: cleanVersion(run.version),
    });
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
export const mine = query({
  args: { version: v.optional(v.string()), limit: v.optional(v.number()) },
  handler: async (ctx, { version, limit }) => {
    const player = await playerFor(ctx, await requireUser(ctx));
    if (!player) return null;
    const n = Math.min(limit ?? 10, 50);
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
      const { runs, wins } = await versionTotals(ctx, player._id, version);
      return { player: { name: player.name, runs, wins, bestScore: best[0]?.score ?? 0 }, recent, best, version };
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
    return { player: { name: player.name, runs: player.runs, wins: player.wins, bestScore: player.bestScore }, recent, best };
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
