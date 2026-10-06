import { internalMutation, internalQuery, mutation } from "./_generated/server";
import { v } from "convex/values";
import { cleanVersion, ensurePlayer, requireUser } from "./lib";

// Detailed per-run logs (every battle, pick, purchase and event) for balance analysis.
// Read them with: npx convex run runlogs:exportLogs [--prod] > logs.json, then
//                 node tools/analyze_runs.mjs logs.json
export const submit = mutation({
  args: { clientRunId: v.string(), log: v.string() },
  handler: async (ctx, { clientRunId, log }) => {
    const player = await ensurePlayer(ctx, await requireUser(ctx));
    if (log.length > 400_000) throw new Error("Run log too large.");
    const dup = await ctx.db
      .query("runLogs")
      .withIndex("by_player_clientRunId", (q) => q.eq("playerId", player._id).eq("clientRunId", clientRunId))
      .unique();
    if (dup) return { id: dup._id, duplicate: true };
    let end: { result?: string; world?: string; asc?: number; version?: string } = {};
    try { end = JSON.parse(log).end || {}; } catch { throw new Error("Run log is not JSON."); }
    const id = await ctx.db.insert("runLogs", {
      playerId: player._id, playerName: player.name, clientRunId, log,
      result: String(end.result || ""), world: String(end.world || ""), ascension: Number(end.asc) || 0,
      version: cleanVersion(end.version), createdAt: Date.now(),
    });
    return { id, duplicate: false };
  },
});

export const exportLogs = internalQuery({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const rows = await ctx.db.query("runLogs").withIndex("by_createdAt").order("desc").take(Math.min(limit ?? 500, 2000));
    return rows.map((r) => ({ playerName: r.playerName, createdAt: r.createdAt, log: r.log }));
  },
});

// Removes logs written by tests (clientRunId "e2e-…"): npx convex run runlogs:purgeTests
export const purgeTests = internalMutation({
  args: {},
  handler: async (ctx) => {
    let n = 0;
    for (const r of await ctx.db.query("runLogs").collect()) if (r.clientRunId.startsWith("e2e-")) { await ctx.db.delete(r._id); n++; }
    return n;
  },
});
