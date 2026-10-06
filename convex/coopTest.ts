import { internalMutation, MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";
import { normEmail } from "./lib";

// DEV-ONLY helpers for the co-op integration tests (tests/coop_auth.cjs). Internal functions, so only
// the CLI / dashboard can call them, and they refuse to run unless the deployment has COOP_TEST=1:
//   npx convex env set COOP_TEST 1        (dev only; never set this on prod)
//   npx convex run coopTest:ensureTestUser '{"email":"coop-tester@kanto-spire.test","name":"TESTER"}'
//   npx convex run coopTest:cleanup '{"emails":["coop-tester@kanto-spire.test"]}'

// Accounts whose user and allowlist rows must never be deleted (their co-op rooms may be).
const PROTECTED = new Set(["aj12ay@gmail.com"]);

function requireTestMode() {
  if (process.env.COOP_TEST !== "1") throw new Error("COOP_TEST is not enabled");
}

async function deleteRoom(ctx: MutationCtx, roomId: Id<"coopRooms">) {
  let n = 0;
  for (const a of await ctx.db.query("coopActions").withIndex("by_room_seq", (q) => q.eq("roomId", roomId)).collect()) { await ctx.db.delete(a._id); n++; }
  for (const m of await ctx.db.query("coopMembers").withIndex("by_room", (q) => q.eq("roomId", roomId)).collect()) await ctx.db.delete(m._id);
  if (await ctx.db.get(roomId)) await ctx.db.delete(roomId);
  return n;
}

export const ensureTestUser = internalMutation({
  args: { email: v.string(), name: v.string() },
  handler: async (ctx, { email: raw, name }) => {
    requireTestMode();
    const email = normEmail(raw);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error(`Not an email: ${raw}`);
    let user = await ctx.db.query("users").withIndex("email", (q) => q.eq("email", email)).first();
    const userId = user ? user._id : await ctx.db.insert("users", { email, name: name.slice(0, 32) });
    if (!(await ctx.db.query("allowedEmails").withIndex("by_email", (q) => q.eq("email", email)).first())) {
      await ctx.db.insert("allowedEmails", { email, note: "coop test user", addedAt: Date.now() });
    }
    return userId;
  },
});

// Deletes the given co-op rooms (with their members and actions).
export const cleanupRooms = internalMutation({
  args: { roomIds: v.array(v.id("coopRooms")) },
  handler: async (ctx, { roomIds }) => {
    requireTestMode();
    let actions = 0;
    for (const id of roomIds) actions += await deleteRoom(ctx, id);
    return { rooms: roomIds.length, actions };
  },
});

// Deletes every co-op room these accounts are in, and (except protected accounts) the accounts
// themselves: users, allowlist, auth sessions/accounts/refresh tokens, trainer and save rows.
export const cleanup = internalMutation({
  args: { emails: v.array(v.string()) },
  handler: async (ctx, { emails }) => {
    requireTestMode();
    const out = { rooms: 0, users: 0, kept: [] as string[] };
    for (const email of emails.map(normEmail).filter(Boolean)) {
      const rooms = new Set<Id<"coopRooms">>();
      for (const m of await ctx.db.query("coopMembers").withIndex("by_email", (q) => q.eq("email", email)).collect()) rooms.add(m.roomId);
      for (const id of rooms) { await deleteRoom(ctx, id); out.rooms++; }
      if (PROTECTED.has(email)) { out.kept.push(email); continue; }
      for (const u of await ctx.db.query("users").withIndex("email", (q) => q.eq("email", email)).collect()) {
        for (const s of await ctx.db.query("authSessions").withIndex("userId", (q) => q.eq("userId", u._id)).collect()) {
          for (const t of await ctx.db.query("authRefreshTokens").withIndex("sessionId", (q) => q.eq("sessionId", s._id)).collect()) await ctx.db.delete(t._id);
          await ctx.db.delete(s._id);
        }
        for (const a of await ctx.db.query("authAccounts").withIndex("userIdAndProvider", (q) => q.eq("userId", u._id)).collect()) await ctx.db.delete(a._id);
        for (const p of await ctx.db.query("players").withIndex("by_userId", (q) => q.eq("userId", u._id)).collect()) {
          // the tester's leaderboard runs and run logs go too (a UI test can finish a solo run)
          for (const r of await ctx.db.query("runs").withIndex("by_player_finishedAt", (q) => q.eq("playerId", p._id)).collect()) await ctx.db.delete(r._id);
          for (const r of await ctx.db.query("runLogs").withIndex("by_player_clientRunId", (q) => q.eq("playerId", p._id)).collect()) await ctx.db.delete(r._id);
          await ctx.db.delete(p._id);
        }
        for (const p of await ctx.db.query("progress").withIndex("by_userId", (q) => q.eq("userId", u._id)).collect()) await ctx.db.delete(p._id);
        await ctx.db.delete(u._id);
        out.users++;
      }
      for (const r of await ctx.db.query("allowedEmails").withIndex("by_email", (q) => q.eq("email", email)).collect()) await ctx.db.delete(r._id);
    }
    return out;
  },
});

// Deletes leaderboard runs / run logs whose trainer row no longer exists (left behind by an older cleanup),
// optionally only those with this player name. Test mode only, like everything here.
export const cleanupOrphanRuns = internalMutation({
  args: { playerName: v.optional(v.string()) },
  handler: async (ctx, { playerName }) => {
    requireTestMode();
    let runs = 0, runLogs = 0;
    for await (const r of ctx.db.query("runs")) {
      if (playerName && r.playerName !== playerName) continue;
      if (!(await ctx.db.get(r.playerId))) { await ctx.db.delete(r._id); runs++; }
    }
    for await (const r of ctx.db.query("runLogs")) {
      if (playerName && r.playerName !== playerName) continue;
      if (!(await ctx.db.get(r.playerId))) { await ctx.db.delete(r._id); runLogs++; }
    }
    return { runs, runLogs };
  },
});
