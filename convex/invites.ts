import { internalMutation, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { MutationCtx, QueryCtx } from "./_generated/server";
import { emailAllowed, normEmail, requireUser, signedInUser } from "./lib";

// One-time invite links: an admin makes a code, shares <site>/?invite=CODE, and the first person who
// signs in with it is added to allowedEmails. Codes expire after 14 days.
const DAY = 24 * 60 * 60 * 1000;

function newCode() {
  const abc = "abcdefghjkmnpqrstuvwxyz23456789";
  let s = "";
  for (let i = 0; i < 20; i++) s += abc[Math.floor(Math.random() * abc.length)];
  return s;
}

// Only the owner may make invite links (regardless of the admin flag).
export const INVITER = "aj12ay@gmail.com";

async function requireAdmin(ctx: QueryCtx) {
  const user = await requireUser(ctx);
  if (normEmail(user.email) !== INVITER) throw new Error("Only the owner can make invite links.");
  return user;
}

async function insertInvite(ctx: MutationCtx, createdBy: string, note?: string, days?: number) {
  const code = newCode();
  const expiresAt = Date.now() + (days ?? 14) * DAY;
  await ctx.db.insert("invites", { code, createdBy, note, createdAt: Date.now(), expiresAt });
  return { code, expiresAt };
}

// From the game (admins only).
export const create = mutation({
  args: { note: v.optional(v.string()) },
  handler: async (ctx, { note }) => {
    const user = await requireAdmin(ctx);
    return await insertInvite(ctx, normEmail(user.email), note);
  },
});

// From the CLI: npx convex run invites:createInternal '{"note":"a friend"}' [--prod]
export const createInternal = internalMutation({
  args: { note: v.optional(v.string()), days: v.optional(v.number()) },
  handler: async (ctx, { note, days }) => await insertInvite(ctx, "cli", note, days),
});

// Called right after sign-in by someone who opened an invite link. Works for accounts that are
// not on the allowlist yet (that's the point); it can only ever add the caller's own email.
export const redeem = mutation({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    const user = await signedInUser(ctx);
    if (!user) throw new Error("Sign in first.");
    const email = normEmail(user.email);
    if (!email) throw new Error("Your Google account has no email.");
    const inv = await ctx.db.query("invites").withIndex("by_code", (q) => q.eq("code", code.trim())).first();
    if (!inv) throw new Error("That invite link is not valid.");
    if (inv.usedBy && inv.usedBy !== email) throw new Error("That invite link was already used.");
    if (!inv.usedBy && inv.expiresAt < Date.now()) throw new Error("That invite link has expired.");
    if (!(await emailAllowed(ctx, email))) await ctx.db.insert("allowedEmails", { email, note: `invite ${inv.note || ""}`.trim(), addedAt: Date.now() });
    if (!inv.usedBy) await ctx.db.patch(inv._id, { usedBy: email, usedAt: Date.now() });
    return { email };
  },
});

// Admins: recent invites and who used them.
export const mine = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const rows = await ctx.db.query("invites").order("desc").take(30);
    return rows.map((r) => ({ note: r.note, createdAt: r.createdAt, expiresAt: r.expiresAt, usedBy: r.usedBy ?? null }));
  },
});
