import { getAuthUserId } from "@convex-dev/auth/server";
import { MutationCtx, QueryCtx } from "./_generated/server";
import { Doc, Id } from "./_generated/dataModel";
import { v, Infer } from "convex/values";
import { resultValidator } from "./schema";

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

// ---- finished runs ------------------------------------------------------------------------------
// The runs:submit shape (also the team run a finished co-op room sends to coop:finish).
export const runInput = v.object({
  clientRunId: v.string(),
  result: resultValidator,
  world: v.string(),
  ascension: v.number(),
  act: v.number(),
  actName: v.string(),
  floor: v.number(),
  starter: v.string(),
  party: v.array(v.object({ species: v.string(), level: v.number(), shiny: v.boolean() })),
  seed: v.string(),
  stats: v.object({
    floors: v.number(),
    battles: v.number(),
    trainers: v.number(),
    caught: v.number(),
    bestHand: v.number(),
    crits: v.number(),
    elites: v.number(),
    bosses: v.number(),
    moneyEarned: v.number(),
  }),
  durationMs: v.number(),
  finishedAt: v.number(),
  version: v.optional(v.string()), // game version (VERSION in web/src/game/version.js); older clients omit it
  regions: v.optional(v.string()), // v0.1.0 spire runs: the act regions, e.g. "K-H-H-K"
});
export type RunInput = Infer<typeof runInput>;

const nonNeg = (n: number, max: number) => Math.max(0, Math.min(max, Math.floor(Number.isFinite(n) ? n : 0)));

// A client's run, clamped and trimmed for the runs table, with its score.
export function cleanRun(run: RunInput) {
  const s = run.stats;
  const stats = {
    floors: nonNeg(s.floors, 1000), battles: nonNeg(s.battles, 1000), trainers: nonNeg(s.trainers, 1000),
    caught: nonNeg(s.caught, 1000), bestHand: nonNeg(s.bestHand, 1e9), crits: nonNeg(s.crits, 1e6),
    elites: nonNeg(s.elites, 100), bosses: nonNeg(s.bosses, 100), moneyEarned: nonNeg(s.moneyEarned, 1e9),
  };
  const ascension = nonNeg(run.ascension, 20);
  const score = scoreRun({ result: run.result, ascension, stats });
  return {
    ...run,
    clientRunId: run.clientRunId.slice(0, 64),
    seed: run.seed.slice(0, 32),
    ...(run.regions !== undefined ? { regions: run.regions.slice(0, 24) } : {}),
    actName: run.actName.slice(0, 40),
    party: run.party.slice(0, 6),
    ascension, stats, score,
    act: nonNeg(run.act, 20), floor: nonNeg(run.floor, 1000), durationMs: nonNeg(run.durationMs, 1e10),
    version: cleanVersion(run.version),
  };
}

// ---- co-op team runs ----------------------------------------------------------------------------
// A finished co-op room is ONE run in the runs table: owned by the host (slot 0), the partners' names in coop.with,
// every player's starter in coop.starters, clientRunId "coop-<CODE>". Every member's trainer gets the run (and win)
// counted once, and the score as their best if higher. The room is closed with its result (off every REJOIN list).
// Used by coop:finish (any member, from the game; the first call records it, later ones change nothing) and by
// migrations:finishCoopRoom (by hand, for rooms that ended before the game did this; it may replace the row).
//   replace: an existing row for the room is overwritten (else it is kept as it is)
//   credit: false = don't count the run/win for the trainers (e.g. when re-recording a room)
//   createTrainers: a member without a trainer row gets one (else that is an error)
//   roomResult: the room's result if it isn't the run's
export async function recordCoopRun(
  ctx: MutationCtx,
  room: Doc<"coopRooms">,
  run: Omit<RunInput, "clientRunId"> & { clientRunId?: string; score?: number },
  opts: { replace?: boolean; credit?: boolean; createTrainers?: boolean; removeRunIds?: Id<"runs">[]; roomResult?: RunInput["result"] } = {},
) {
  const roomResult = opts.roomResult ?? run.result;
  const members = (await ctx.db.query("coopMembers").withIndex("by_room", (q) => q.eq("roomId", room._id)).collect()).sort((a, b) => a.slot - b.slot);
  if (!members.length) throw new Error("Room has no players");
  const trainers = [];
  for (const m of members) {
    let p = await ctx.db.query("players").withIndex("by_email", (q) => q.eq("email", m.email)).first();
    if (!p && opts.createTrainers) {
      const user = await ctx.db.get(m.userId);
      if (user) p = await ensurePlayer(ctx, user);
    }
    if (!p) throw new Error("No trainer for slot " + m.slot);
    trainers.push(p);
  }
  for (const id of opts.removeRunIds ?? []) if (await ctx.db.get(id)) await ctx.db.delete(id);
  const host = trainers[0];
  const clientRunId = run.clientRunId ?? `coop-${room.code}`;
  const dup = await ctx.db.query("runs").withIndex("by_player_clientRunId", (q) => q.eq("playerId", host._id).eq("clientRunId", clientRunId)).unique();
  const closeRoom = async (result: RunInput["result"]) => {
    if (room.status !== "closed" || room.result !== result) await ctx.db.patch(room._id, { status: "closed", result, updatedAt: Date.now() });
  };
  if (dup && !opts.replace) {
    // already recorded: keep the row and the room's result (a later client's view can't change them)
    await closeRoom(room.result ?? dup.result);
    return { room: room._id, id: dup._id, score: dup.score, duplicate: true, replaced: false };
  }
  const score = scoreRun({ result: run.result, ascension: run.ascension, stats: run.stats });
  const row = {
    ...run, clientRunId, score, playerId: host._id, playerName: host.name, version: cleanVersion(run.version),
    coop: { room: room.code, with: members.slice(1).map((m) => m.name), starters: members.map((m) => m.starter ?? "") },
  };
  if (dup) await ctx.db.replace(dup._id, row);
  const id = dup ? dup._id : await ctx.db.insert("runs", row);
  for (const p of trainers) {
    const counts = !dup && opts.credit !== false ? { runs: p.runs + 1, wins: p.wins + (run.result !== "lose" ? 1 : 0) } : {};
    await ctx.db.patch(p._id, { ...counts, bestScore: Math.max(p.bestScore, score) });
  }
  await closeRoom(roomResult);
  return { room: room._id, id, score, duplicate: false, replaced: !!dup };
}

// The co-op team runs a trainer played in as a partner (the host owns the row, so runs:mine's playerId indexes miss
// them): the closed rooms of their latest memberships, each one's host row "coop-<CODE>". A few reads per room.
const COOP_MEMBERSHIPS = 60;
export async function partnerCoopRuns(ctx: QueryCtx, email: string, version?: string) {
  const out: Doc<"runs">[] = [];
  if (!email) return out;
  const mems = await ctx.db.query("coopMembers").withIndex("by_email", (q) => q.eq("email", email)).order("desc").take(COOP_MEMBERSHIPS);
  for (const me of mems) {
    if (me.slot === 0) continue; // (the host's own runs already have it)
    const room = await ctx.db.get(me.roomId);
    if (!room || room.status !== "closed" || !room.result) continue;
    const host = await ctx.db.query("coopMembers").withIndex("by_room", (q) => q.eq("roomId", room._id).eq("slot", 0)).first();
    const hp = host ? await ctx.db.query("players").withIndex("by_email", (q) => q.eq("email", host.email)).first() : null;
    if (!hp) continue;
    const row = await ctx.db.query("runs").withIndex("by_player_clientRunId", (q) => q.eq("playerId", hp._id).eq("clientRunId", `coop-${room.code}`)).unique();
    if (row && (!version || row.version === version)) out.push(row);
  }
  return out;
}
