import { mutation, query, QueryCtx } from "./_generated/server";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { INVITER } from "./invites";
import { cleanName, currentUser, ensurePlayer, normEmail, playerFor, requireUser, versionTotals } from "./lib";
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

// v0.5.2: the trainers list in pages (RECORDS' LOAD MORE; top stays as it was for older clients). All-time: the
// players.by_bestScore index, paginated. One version: that version's runs walked best-first (by_version_score) from the
// score where the last page stopped, skipping the trainers already listed; the cursor (JSON) carries both, so each page
// reads one index range and at most TOP_SCAN_CAP runs. -> { page, isDone, continueCursor }
const SEEN_CAP = 5000;
export const topPage = query({
  args: { version: v.optional(v.string()), paginationOpts: paginationOptsValidator },
  handler: async (ctx, { version, paginationOpts }) => {
    await requireUser(ctx);
    const n = Math.max(1, Math.min(Math.floor(paginationOpts.numItems) || 50, 100));
    if (!version) {
      const res = await ctx.db.query("players").withIndex("by_bestScore").order("desc").paginate({ ...paginationOpts, numItems: n });
      const page = res.page.filter((p) => p.runs > 0);
      // (trainers without a run have bestScore 0 and sort last: the list ends at the first one)
      const ended = res.page.some((p) => p.runs === 0 && p.bestScore <= 0);
      return { page: page.map(publicPlayer), isDone: res.isDone || ended, continueCursor: res.continueCursor };
    }
    let c: { s: number | null; seen: string[] } = { s: null, seen: [] };
    if (paginationOpts.cursor) {
      try {
        const o = JSON.parse(paginationOpts.cursor);
        if (o && Array.isArray(o.seen)) c = { s: typeof o.s === "number" ? o.s : null, seen: o.seen.map(String) };
      } catch { /* a bad cursor starts over */ }
    }
    const seen = new Set(c.seen);
    const best = new Map<Id<"players">, number>();
    const s0 = c.s;
    const runs = ctx.db.query("runs").withIndex("by_version_score", (q) => (s0 === null ? q.eq("version", version) : q.eq("version", version).lte("score", s0)));
    let scanned = 0, last = s0, done = true;
    for await (const r of runs.order("desc")) {
      last = r.score;
      if (!seen.has(r.playerId) && !best.has(r.playerId)) best.set(r.playerId, r.score);
      if (best.size >= n || ++scanned >= TOP_SCAN_CAP) { done = false; break; }
    }
    if (!best.size && last === s0) done = true; // (no progress: nothing left to find)
    const page = [];
    for (const [id, bestScore] of best) {
      const p = await ctx.db.get(id);
      if (!p) continue;
      const { runs: nRuns, wins } = await versionTotals(ctx, id, version);
      page.push({ ...publicPlayer(p), runs: nRuns, wins, bestScore });
    }
    const next = { s: last, seen: [...c.seen, ...best.keys()].slice(-SEEN_CAP) };
    return { page, isDone: done, continueCursor: JSON.stringify(next) };
  },
});

export const exists = query({
  args: {},
  handler: async (ctx) => {
    const user = await currentUser(ctx);
    return !!user && !!(await playerFor(ctx, user));
  },
});

// ---- NOW PLAYING: who is in a run right now (the title screen lists them) ----
// Clients send a heartbeat about once a minute while in a run (web/src/net/presence.js) and clear it when they
// leave; anyone not heard from within NOW_WINDOW_MS has stopped (closed the tab, lost the connection).
const NOW_WINDOW_MS = 3 * 60_000;
const NOW_LIMIT = 20;

function cleanActivity(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9 .+'!?:\-]/g, "").replace(/\s+/g, " ").trim().slice(0, 32);
}

export const presence = mutation({
  args: { activity: v.union(v.string(), v.null()), room: v.optional(v.string()) },
  handler: async (ctx, { activity, room }) => {
    const user = await requireUser(ctx);
    const player = await playerFor(ctx, user);
    if (!player) return null;
    const what = activity === null ? "" : cleanActivity(activity);
    if (!what) {
      if (player.lastSeen !== undefined) await ctx.db.patch(player._id, { lastSeen: undefined, activity: undefined, activityRoom: undefined });
      return null;
    }
    // a co-op room only counts if this account is in it (it decides who is listed together)
    let activityRoom: string | undefined;
    const code = (room || "").trim().toUpperCase().slice(0, 8);
    if (code) {
      const r = await ctx.db.query("coopRooms").withIndex("by_code", (q) => q.eq("code", code)).first();
      const email = normEmail(user.email);
      const member = r && email ? await ctx.db.query("coopMembers").withIndex("by_room_email", (q) => q.eq("roomId", r._id).eq("email", email)).first() : null;
      if (member) activityRoom = code;
    }
    const now = Date.now();
    await ctx.db.patch(player._id, { lastSeen: now, activity: what, activityRoom });
    return now;
  },
});

// Who is in a run since `since`: newer clients' playerActivity rows and older clients' players.lastSeen, one entry
// per trainer (the newest), grouped by co-op room. -> [{ names, what, seen }] newest first (seen: the group's newest
// keepalive, server time). `me` (the caller's own player) is never listed, on any device or tab: NOW PLAYING is who
// ELSE is playing. (A co-op room you are in still lists your partners.)
async function nowGroups(ctx: QueryCtx, since: number, me: Id<"players"> | null) {
  const rows = await ctx.db.query("playerActivity").withIndex("by_lastSeen", (q) => q.gte("lastSeen", since)).order("desc").take(NOW_LIMIT);
  const legacy = await ctx.db.query("players").withIndex("by_lastSeen", (q) => q.gte("lastSeen", since)).order("desc").take(NOW_LIMIT);
  const seenBy = new Map<string, { name: string; what: string; room?: string; seen: number }>();
  for (const r of rows) if (r.playerId !== me) seenBy.set(r.playerId, { name: r.name, what: r.activity, room: r.room, seen: r.lastSeen });
  for (const p of legacy) {
    if (!p.activity || !p.lastSeen || p._id === me) continue;
    const had = seenBy.get(p._id);
    if (!had || had.seen < p.lastSeen) seenBy.set(p._id, { name: p.name, what: p.activity, room: p.activityRoom, seen: p.lastSeen });
  }
  const groups = new Map<string, { names: string[]; what: string; seen: number }>();
  for (const [pid, e] of [...seenBy.entries()].sort((a, b) => b[1].seen - a[1].seen)) {
    const key = e.room ? "room:" + e.room : "player:" + pid;
    const g = groups.get(key);
    if (g) { if (!g.names.includes(e.name)) g.names.push(e.name); }
    else groups.set(key, { names: [e.name], what: e.what, seen: e.seen });
  }
  return [...groups.values()].slice(0, NOW_LIMIT);
}

// [{ names: ["CLIVE", "STEPHEN"], what: "CO-OP ACT 3" }, { names: ["MARIA"], what: "ACT 2 TORCHIC" }], newest first.
// Names and labels only: no emails, ids or room codes. (What older clients poll every 30 s.)
export const nowPlaying = query({
  args: {},
  handler: async (ctx) => {
    const user = await currentUser(ctx);
    if (!user) return [];
    const me = (await playerFor(ctx, user))?._id ?? null;
    return (await nowGroups(ctx, Date.now() - NOW_WINDOW_MS, me)).map(({ names, what }) => ({ names, what }));
  },
});

// ---- staging-net: NOW PLAYING over a subscription ----
// Newer clients keep their activity in playerActivity (players:activity), so the players rows RECORDS reads aren't
// rewritten every minute, and the title screen subscribes to players:nowPlayingLive instead of polling. A query can't
// re-run as time passes, so it takes `since` (the client's now minus the window, rounded to the minute: tabs share
// it) and returns each group's newest keepalive (seen); the client hides groups older than NOW_WINDOW_MS itself.
export const activity = mutation({
  args: { activity: v.union(v.string(), v.null()), room: v.optional(v.string()) },
  handler: async (ctx, { activity, room }) => {
    const user = await requireUser(ctx);
    const player = await playerFor(ctx, user);
    if (!player) return null;
    const row = await ctx.db.query("playerActivity").withIndex("by_player", (q) => q.eq("playerId", player._id)).first();
    const what = activity === null ? "" : cleanActivity(activity);
    // (an older client's row on the players table is cleared too: one entry per trainer)
    if (player.lastSeen !== undefined) await ctx.db.patch(player._id, { lastSeen: undefined, activity: undefined, activityRoom: undefined });
    if (!what) {
      if (row) await ctx.db.delete(row._id);
      return null;
    }
    let activityRoom: string | undefined;
    const code = (room || "").trim().toUpperCase().slice(0, 8);
    if (code) {
      const r = await ctx.db.query("coopRooms").withIndex("by_code", (q) => q.eq("code", code)).first();
      const email = normEmail(user.email);
      const member = r && email ? await ctx.db.query("coopMembers").withIndex("by_room_email", (q) => q.eq("roomId", r._id).eq("email", email)).first() : null;
      if (member) activityRoom = code;
    }
    const now = Date.now();
    const doc = { name: player.name, activity: what, room: activityRoom, lastSeen: now };
    if (row) await ctx.db.patch(row._id, doc);
    else await ctx.db.insert("playerActivity", { playerId: player._id, ...doc });
    return now;
  },
});

export const nowPlayingLive = query({
  args: { since: v.number() },
  handler: async (ctx, { since }) => {
    const user = await currentUser(ctx);
    if (!user) return [];
    const me = (await playerFor(ctx, user))?._id ?? null;
    return await nowGroups(ctx, Number.isFinite(since) ? since : 0, me);
  },
});
