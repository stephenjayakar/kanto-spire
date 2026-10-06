import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { normEmail, progressFor, requireUser } from "./lib";

const MAX = 900_000; // stay under Convex's 1 MiB document limit

// The account's save: meta-progression plus the run in progress (both JSON strings).
export const get = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const p = await progressFor(ctx, user);
    return p ? { email: normEmail(user.email), meta: p.meta, run: p.run, updatedAt: p.updatedAt } : null;
  },
});

export const save = mutation({
  args: { meta: v.string(), run: v.union(v.string(), v.null()) },
  handler: async (ctx, { meta, run }) => {
    const user = await requireUser(ctx);
    if (meta.length + (run?.length ?? 0) > MAX) throw new Error("Save data is too large.");
    JSON.parse(meta);
    if (run !== null) JSON.parse(run);
    const p = await progressFor(ctx, user);
    const updatedAt = Date.now();
    const email = normEmail(user.email);
    if (p) await ctx.db.patch(p._id, { meta, run, updatedAt, email, userId: user._id });
    else await ctx.db.insert("progress", { userId: user._id, email, meta, run, updatedAt });
    return updatedAt;
  },
});
