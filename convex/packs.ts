import { internalMutation, internalQuery, query, QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import { Doc } from "./_generated/dataModel";
import { requireUser } from "./lib";

// A pack's extras (gzipped copy, lazy flag), when they belong to its current upload.
async function extrasFor(ctx: QueryCtx, pack: Doc<"assetPacks">) {
  const x = await ctx.db.query("assetPackExtras").withIndex("by_name", (q) => q.eq("name", pack.name)).first();
  return x && x.hash === pack.hash ? x : null;
}

// The pack list the game downloads after sign-in (the bytes come from GET /pack in http.ts).
// zsize: the gzipped size (GET /pack?enc=gzip); lazy + dirs: packs the game can load after the title is up.
// (Clients before v0.3.21 read name/hash/size only, and download every pack plain.)
export const manifest = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const out = [];
    for (const p of await ctx.db.query("assetPacks").collect()) {
      const x = await extrasFor(ctx, p);
      out.push({
        name: p.name, hash: p.hash, size: p.size,
        ...(x?.zStorageId && x.zsize ? { zsize: x.zsize } : {}),
        ...(x?.lazy ? { lazy: true, dirs: x.dirs ?? [] } : {}),
      });
    }
    return out;
  },
});

// ---- upload (tools/upload_packs.cjs, through `npx convex run`) -------------------------------
export const list = internalQuery({
  args: {},
  handler: async (ctx) => {
    const out = [];
    for (const p of await ctx.db.query("assetPacks").collect()) {
      const x = await extrasFor(ctx, p);
      out.push({ name: p.name, hash: p.hash, size: p.size, zsize: x?.zStorageId ? x.zsize ?? null : null, lazy: !!x?.lazy, dirs: x?.dirs ?? [] });
    }
    return out;
  },
});

export const uploadUrl = internalMutation({
  args: {},
  handler: async (ctx) => await ctx.storage.generateUploadUrl(),
});

export const record = internalMutation({
  args: {
    name: v.string(), storageId: v.id("_storage"), hash: v.string(), size: v.number(),
    zStorageId: v.optional(v.id("_storage")), zsize: v.optional(v.number()), lazy: v.optional(v.boolean()), dirs: v.optional(v.array(v.string())),
  },
  handler: async (ctx, { name, storageId, hash, size, zStorageId, zsize, lazy, dirs }) => {
    const keep = new Set([storageId, zStorageId].filter(Boolean));
    for (const old of await ctx.db.query("assetPacks").withIndex("by_name", (q) => q.eq("name", name)).collect()) {
      if (!keep.has(old.storageId)) await ctx.storage.delete(old.storageId);
      await ctx.db.delete(old._id);
    }
    for (const old of await ctx.db.query("assetPackExtras").withIndex("by_name", (q) => q.eq("name", name)).collect()) {
      if (old.zStorageId && !keep.has(old.zStorageId)) await ctx.storage.delete(old.zStorageId);
      await ctx.db.delete(old._id);
    }
    await ctx.db.insert("assetPacks", { name, storageId, hash, size, uploadedAt: Date.now() });
    if (zStorageId || lazy) await ctx.db.insert("assetPackExtras", { name, hash, zStorageId, zsize, lazy, dirs });
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
    for (const x of await ctx.db.query("assetPackExtras").collect()) {
      if (keep.includes(x.name)) continue;
      if (x.zStorageId) await ctx.storage.delete(x.zStorageId);
      await ctx.db.delete(x._id);
    }
    return removed;
  },
});

// GET /pack: the pack row plus its gzipped copy, if any.
export const byName = internalQuery({
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
    const pack = await ctx.db.query("assetPacks").withIndex("by_name", (q) => q.eq("name", name)).first();
    if (!pack) return null;
    const x = await extrasFor(ctx, pack);
    return { ...pack, zStorageId: x?.zStorageId ?? null };
  },
});
