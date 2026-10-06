import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { emailAllowed, normEmail } from "./lib";

// Allowlist management. Internal only: run from the CLI, e.g.
//   npx convex run access:allow '{"email":"someone@gmail.com"}' [--prod]
//   npx convex run access:revoke '{"email":"someone@gmail.com"}' [--prod]
//   npx convex run access:list [--prod]
export const allow = internalMutation({
  args: { email: v.string(), note: v.optional(v.string()) },
  handler: async (ctx, { email, note }) => {
    const e = normEmail(email);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw new Error(`Not an email: ${email}`);
    const row = await ctx.db.query("allowedEmails").withIndex("by_email", (q) => q.eq("email", e)).first();
    if (row) return { email: e, added: false };
    await ctx.db.insert("allowedEmails", { email: e, note, addedAt: Date.now() });
    return { email: e, added: true };
  },
});

// npx convex run access:setAdmin '{"email":"...","admin":true}' [--prod]
export const setAdmin = internalMutation({
  args: { email: v.string(), admin: v.boolean() },
  handler: async (ctx, { email, admin }) => {
    const row = await ctx.db.query("allowedEmails").withIndex("by_email", (q) => q.eq("email", normEmail(email))).first();
    if (!row) throw new Error(`${email} is not on the allowlist.`);
    await ctx.db.patch(row._id, { admin });
    return { email: row.email, admin };
  },
});

export const revoke = internalMutation({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    const e = normEmail(email);
    const rows = await ctx.db.query("allowedEmails").withIndex("by_email", (q) => q.eq("email", e)).collect();
    for (const r of rows) await ctx.db.delete(r._id);
    return { email: e, removed: rows.length };
  },
});

export const list = internalQuery({
  args: {},
  handler: async (ctx) => (await ctx.db.query("allowedEmails").collect()).map((r) => ({ email: r.email, note: r.note, addedAt: r.addedAt, admin: !!r.admin })),
});

// For HTTP actions, which can't read the database directly.
export const userAllowed = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const user = await ctx.db.get(userId);
    return !!user && (await emailAllowed(ctx, user.email));
  },
});
