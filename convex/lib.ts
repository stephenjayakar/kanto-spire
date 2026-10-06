import { getAuthUserId } from "@convex-dev/auth/server";
import { MutationCtx, QueryCtx } from "./_generated/server";
import { Id } from "./_generated/dataModel";

// The allowlist lives in the allowedEmails table. An empty table means nobody can play.
export async function emailAllowed(ctx: QueryCtx, email: string | undefined): Promise<boolean> {
  const e = normEmail(email);
  if (!e) return false;
  return !!(await ctx.db.query("allowedEmails").withIndex("by_email", (q) => q.eq("email", e)).first());
}

// The signed-in user, allowlisted or not (only invite redemption accepts these).
export async function signedInUser(ctx: QueryCtx) {
  const userId = await getAuthUserId(ctx);
  return userId ? await ctx.db.get(userId) : null;
}

// The signed-in, allowlisted user, or null.
export async function currentUser(ctx: QueryCtx) {
  const userId = await getAuthUserId(ctx);
  if (!userId) return null;
  const user = await ctx.db.get(userId);
  if (!user || !(await emailAllowed(ctx, user.email))) return null;
  return user;
}

export async function requireUser(ctx: QueryCtx) {
  const user = await currentUser(ctx);
  if (!user) throw new Error("Please sign in with an allowed Google account.");
  return user;
}

export const normEmail = (email: string | undefined) => (email || "").trim().toLowerCase();

type UserRef = { _id: Id<"users">; name?: string; email?: string };

// Save data and records are keyed by the account's email, so they follow the person even if their
// auth user record changes. Rows from before email keying are found by userId and adopted.
export async function playerFor(ctx: QueryCtx, user: UserRef) {
  const email = normEmail(user.email);
  if (email) {
    const byEmail = await ctx.db.query("players").withIndex("by_email", (q) => q.eq("email", email)).first();
    if (byEmail) return byEmail;
  }
  return await ctx.db.query("players").withIndex("by_userId", (q) => q.eq("userId", user._id)).first();
}

export async function progressFor(ctx: QueryCtx, user: UserRef) {
  const email = normEmail(user.email);
  if (email) {
    const byEmail = await ctx.db.query("progress").withIndex("by_email", (q) => q.eq("email", email)).first();
    if (byEmail) return byEmail;
  }
  return await ctx.db.query("progress").withIndex("by_userId", (q) => q.eq("userId", user._id)).first();
}

// Finds or creates the trainer for a user; the first name comes from their Google profile.
export async function ensurePlayer(ctx: MutationCtx, user: UserRef) {
  const email = normEmail(user.email);
  const existing = await playerFor(ctx, user);
  if (existing) {
    if (existing.email !== email || existing.userId !== user._id) {
      await ctx.db.patch(existing._id, { email, userId: user._id });
      return (await ctx.db.get(existing._id))!;
    }
    return existing;
  }
  const base = (user.name || user.email || "RED").split(/[ @]/)[0].replace(/[^\p{L}\p{N}]/gu, "").toUpperCase().slice(0, 10) || "RED";
  let name = base;
  for (let i = 2; await ctx.db.query("players").withIndex("by_nameLower", (q) => q.eq("nameLower", name.toLowerCase())).unique(); i++) {
    name = base.slice(0, 12 - String(i).length) + i;
  }
  const id = await ctx.db.insert("players", {
    userId: user._id, email, name, nameLower: name.toLowerCase(), createdAt: Date.now(), runs: 0, wins: 0, bestScore: 0,
  });
  return (await ctx.db.get(id))!;
}

export function cleanName(raw: string): string {
  const name = raw.replace(/\s+/g, " ").trim();
  if (name.length < 2 || name.length > 12) throw new Error("Name must be 2–12 characters.");
  if (!/^[\p{L}\p{N} ._'!?-]+$/u.test(name)) throw new Error("Name has characters the game font can't show.");
  return name;
}

export type ScoreInput = {
  result: "win" | "lose" | "postgame";
  ascension: number;
  stats: { floors: number; trainers: number; caught: number; bestHand: number; elites: number; bosses: number };
};

// Score rewards depth first (floors, elites, bosses), then a flat bonus for winning, all scaled by ascension.
export function scoreRun({ result, ascension, stats }: ScoreInput): number {
  const base =
    stats.floors * 100 +
    stats.trainers * 40 +
    stats.elites * 250 +
    stats.bosses * 600 +
    stats.caught * 30 +
    Math.floor(Math.min(stats.bestHand, 100000) / 20);
  const bonus = result === "postgame" ? 8000 : result === "win" ? 5000 : 0;
  return Math.round((base + bonus) * (1 + 0.15 * ascension));
}

// Runs from clients that predate version tagging (and every record made before it) count as v0.0.1.
export const LEGACY_VERSION = "v0.0.1";
export function cleanVersion(raw: string | undefined): string {
  if (raw === undefined || raw === null || raw === "") return LEGACY_VERSION;
  const s = String(raw).trim().slice(0, 16);
  return /^v[0-9][0-9A-Za-z.-]*$/.test(s) ? s : "unknown";
}

// A trainer's run and win counts within one version (capped, so a huge history can't blow the read limit).
const VERSION_COUNT_CAP = 1000;
export async function versionTotals(ctx: QueryCtx, playerId: Id<"players">, version: string) {
  let runs = 0, wins = 0;
  for await (const r of ctx.db.query("runs").withIndex("by_player_version_finishedAt", (q) => q.eq("playerId", playerId).eq("version", version))) {
    runs++;
    if (r.result !== "lose") wins++;
    if (runs >= VERSION_COUNT_CAP) break;
  }
  return { runs, wins };
}
