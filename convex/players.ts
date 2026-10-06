import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { INVITER } from "./invites";
import { cleanName, currentUser, ensurePlayer, playerFor, requireUser, versionTotals } from "./lib";
import { Id } from "./_generated/dataModel";

function publicPlayer(p: { _id: string; name: string; runs: number; wins: number; bestScore: number; createdAt: number }) {
  return { id: p._id, name: p.name, runs: p.runs, wins: p.wins, bestScore: p.bestScore, createdAt: p.createdAt };
}

// The signed-in account and its trainer (created on first call).
export const me = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const player = await ensurePlayer(ctx, user);
    // only the owner gets the INVITE button (see invites.ts)
    return { email: user.email, image: user.image ?? null, admin: (user.email || "").toLowerCase() === INVITER, ...publicPlayer(player) };
  },
});

export const rename = mutation({
  args: { name: v.string() },
  handler: async (ctx, { name: rawName }) => {
    const user = await requireUser(ctx);
    const player = await ensurePlayer(ctx, user);
    const name = cleanName(rawName);
    const nameLower = name.toLowerCase();
    const taken = await ctx.db.query("players").withIndex("by_nameLower", (q) => q.eq("nameLower", nameLower)).unique();
    if (taken && taken._id !== player._id) throw new Error(`The name ${name} is taken.`);
    await ctx.db.patch(player._id, { name, nameLower });
    const runs = await ctx.db.query("runs").withIndex("by_player_finishedAt", (q) => q.eq("playerId", player._id)).collect();
    for (const r of runs) await ctx.db.patch(r._id, { playerName: name });
    return publicPlayer({ ...player, name });
  },
});

// Trainers ranked by their best run: all-time (players.bestScore), or within one game version, where
// the ranking comes from that version's runs (walked best-first, first run seen per trainer is their best).
const TOP_SCAN_CAP = 2000;
export const top = query({
  args: { version: v.optional(v.string()), limit: v.optional(v.number()) },
  handler: async (ctx, { version, limit }) => {
    await requireUser(ctx);
    const n = Math.min(limit ?? 10, 50);
    if (!version) {
      const players = await ctx.db.query("players").withIndex("by_bestScore").order("desc").take(n);
      return players.filter((p) => p.runs > 0).map(publicPlayer);
    }
    const best = new Map<Id<"players">, number>();
    let scanned = 0;
    for await (const r of ctx.db.query("runs").withIndex("by_version_score", (q) => q.eq("version", version)).order("desc")) {
      if (!best.has(r.playerId)) best.set(r.playerId, r.score);
      if (best.size >= n || ++scanned >= TOP_SCAN_CAP) break;
    }
    const out = [];
    for (const [id, bestScore] of best) {
      const p = await ctx.db.get(id);
      if (!p) continue;
      const { runs, wins } = await versionTotals(ctx, id, version);
      out.push({ ...publicPlayer(p), runs, wins, bestScore });
    }
    return out;
  },
});

export const exists = query({
  args: {},
  handler: async (ctx) => {
    const user = await currentUser(ctx);
    return !!user && !!(await playerFor(ctx, user));
  },
});
