import { internalMutation, internalQuery, query } from "./_generated/server";
import { v } from "convex/values";
import { requireUser } from "./lib";

// The pack list the game downloads after sign-in (the bytes come from GET /pack in http.ts).
export const manifest = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    return (await ctx.db.query("assetPacks").collect()).map((p) => ({ name: p.name, hash: p.hash, size: p.size }));
  },
});

// ---- upload (tools/upload_packs.cjs, through `npx convex run`) -------------------------------
export const list = internalQuery({
  args: {},
  handler: async (ctx) => (await ctx.db.query("assetPacks").collect()).map((p) => ({ name: p.name, hash: p.hash, size: p.size })),
});

export const uploadUrl = internalMutation({
  args: {},
  handler: async (ctx) => await ctx.storage.generateUploadUrl(),
});

export const record = internalMutation({
  args: { name: v.string(), storageId: v.id("_storage"), hash: v.string(), size: v.number() },
  handler: async (ctx, args) => {
    for (const old of await ctx.db.query("assetPacks").withIndex("by_name", (q) => q.eq("name", args.name)).collect()) {
      if (old.storageId !== args.storageId) await ctx.storage.delete(old.storageId);
      await ctx.db.delete(old._id);
    }
    await ctx.db.insert("assetPacks", { ...args, uploadedAt: Date.now() });
  },
});

// Drops packs that are no longer part of the build.
export const prune = internalMutation({
  args: { keep: v.array(v.string()) },
  handler: async (ctx, { keep }) => {
    let removed = 0;
    for (const p of await ctx.db.query("assetPacks").collect()) {
      if (keep.includes(p.name)) continue;
      await ctx.storage.delete(p.storageId);
      await ctx.db.delete(p._id);
      removed++;
    }
    return removed;
  },
});

export const byName = internalQuery({
  args: { name: v.string() },
  handler: async (ctx, { name }) => await ctx.db.query("assetPacks").withIndex("by_name", (q) => q.eq("name", name)).first(),
});
