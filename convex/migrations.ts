import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { LEGACY_VERSION, normEmail, recordCoopRun } from "./lib";
import { resultValidator } from "./schema";
import { applyClears, type HistoryRun } from "./ascension";

// One-off: stamp the owner's email onto saves and trainers created before email keying.
// Run with: npx convex run migrations:backfillEmails [--prod]
export const backfillEmails = internalMutation({
  args: {},
  handler: async (ctx) => {
    let players = 0, progress = 0;
    for (const p of await ctx.db.query("players").collect()) {
      if (p.email) continue;
      const user = await ctx.db.get(p.userId);
      const email = normEmail(user?.email);
      if (email) { await ctx.db.patch(p._id, { email }); players++; }
    }
    for (const p of await ctx.db.query("progress").collect()) {
      if (p.email) continue;
      const user = await ctx.db.get(p.userId);
      const email = normEmail(user?.email);
      if (email) { await ctx.db.patch(p._id, { email }); progress++; }
    }
    return { players, progress };
  },
});

// One-off: every run and run log recorded before version tagging is v0.0.1 (the owner's call, even for
// runs played after v0.0.2 shipped). Only rows with no version are touched, so it is safe to re-run.
// Works in batches (run logs can be large) and reschedules itself until nothing is left.
// Run with: npx convex run migrations:backfillVersions [--prod]; check with migrations:versionStatus
export const backfillVersions = internalMutation({
  args: {},
  handler: async (ctx) => {
    const runs = await ctx.db.query("runs").withIndex("by_version_score", (q) => q.eq("version", undefined)).take(200);
    for (const r of runs) await ctx.db.patch(r._id, { version: LEGACY_VERSION });
    const logs = await ctx.db.query("runLogs").withIndex("by_version_createdAt", (q) => q.eq("version", undefined)).take(20);
    for (const r of logs) await ctx.db.patch(r._id, { version: LEGACY_VERSION });
    const more = runs.length === 200 || logs.length === 20;
    if (more) await ctx.scheduler.runAfter(0, internal.migrations.backfillVersions, {});
    console.log(`backfillVersions: ${runs.length} runs, ${logs.length} run logs set to ${LEGACY_VERSION}${more ? ", continuing" : ", done"}`);
    return { runs: runs.length, runLogs: logs.length, more };
  },
});

// How many runs / run logs still lack a version (should be 0 after backfillVersions), per version counts of runs.
export const versionStatus = internalQuery({
  args: {},
  handler: async (ctx) => {
    const missingRuns = (await ctx.db.query("runs").withIndex("by_version_score", (q) => q.eq("version", undefined)).take(1000)).length;
    // run logs are big documents: a small sample is enough to tell "done" from "not done"
    const missingLogs = (await ctx.db.query("runLogs").withIndex("by_version_createdAt", (q) => q.eq("version", undefined)).take(50)).length;
    const byVersion: Record<string, number> = {};
    let scanned = 0;
    for await (const r of ctx.db.query("runs").withIndex("by_version_score")) {
      byVersion[r.version ?? "(none)"] = (byVersion[r.version ?? "(none)"] ?? 0) + 1;
      if (++scanned >= 5000) break;
    }
    return { missingRuns, missingLogs, runsByVersion: byVersion };
  },
});

// ---- v0.0.5 starter unlock reset --------------------------------------------------------------
// Starters are now unlocked one per act clear (web/src/game/unlocks.js). Every save goes back to the
// Kanto three; only meta.unlockedStarters + meta.starterVer are rewritten, everything else (ascension,
// unlock flags incl. win/hoennWin/postgame, Pokédex, runs, totals, settings) and the run in progress stay.
// The client applies the same reset when it loads a save without starterVer 2 (loadMeta), so a stale
// local save or an old row can't bring old unlocks back. Safe to re-run: rows already at the flag are skipped.
// Run with: npx convex run migrations:resetStarterUnlocks [--prod]; check with migrations:starterUnlockStatus
const STARTER_VER = 2;
const KANTO_STARTERS = ["BULBASAUR", "CHARMANDER", "SQUIRTLE"];

function parseMeta(s: string): Record<string, unknown> | null {
  try {
    const m = JSON.parse(s);
    return m && typeof m === "object" && !Array.isArray(m) ? m : null;
  } catch {
    return null;
  }
}
const starterDone = (m: Record<string, unknown>) =>
  typeof m.starterVer === "number" && m.starterVer >= STARTER_VER && Array.isArray(m.unlockedStarters);

export const resetStarterUnlocks = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())), batch: v.optional(v.number()) },
  handler: async (ctx, { cursor, batch }) => {
    const numItems = Math.max(1, Math.min(200, batch ?? 100));
    const page = await ctx.db.query("progress").paginate({ cursor: cursor ?? null, numItems });
    let changed = 0, alreadyDone = 0, bad = 0;
    for (const p of page.page) {
      const m = parseMeta(p.meta);
      if (!m) { bad++; continue; }
      if (starterDone(m)) { alreadyDone++; continue; }
      m.unlockedStarters = [...KANTO_STARTERS];
      m.starterVer = STARTER_VER;
      await ctx.db.patch(p._id, { meta: JSON.stringify(m) });
      changed++;
    }
    const scanned = page.page.length;
    const more = !page.isDone;
    if (more) await ctx.scheduler.runAfter(0, internal.migrations.resetStarterUnlocks, { cursor: page.continueCursor, batch: numItems });
    console.log(`resetStarterUnlocks: scanned ${scanned}, changed ${changed}, alreadyDone ${alreadyDone}, bad ${bad}${more ? ", continuing" : ", done"}`);
    return { scanned, changed, alreadyDone, bad, more };
  },
});

// Read-only: how many saves are at each starterVer, and how many starters they have unlocked.
export const starterUnlockStatus = internalQuery({
  args: {},
  handler: async (ctx) => {
    const byVer: Record<string, number> = {};
    const byUnlocked: Record<string, number> = {};
    let total = 0, migrated = 0, pending = 0, bad = 0, kantoOnly = 0;
    for await (const p of ctx.db.query("progress")) {
      total++;
      const m = parseMeta(p.meta);
      if (!m) { bad++; continue; }
      const ver = String(m.starterVer ?? "(none)");
      byVer[ver] = (byVer[ver] ?? 0) + 1;
      if (starterDone(m)) migrated++; else pending++;
      const list = Array.isArray(m.unlockedStarters) ? (m.unlockedStarters as string[]) : null;
      const key = list ? String(list.length) : "(none)";
      byUnlocked[key] = (byUnlocked[key] ?? 0) + 1;
      if (list && list.length === 3 && KANTO_STARTERS.every((s) => list.includes(s))) kantoOnly++;
    }
    return { total, migrated, pending, bad, kantoOnly, byStarterVer: byVer, byUnlockedCount: byUnlocked };
  },
});

// Ascension unlocks per starter, from past clears: for every save, each starter gets one level above the
// highest ascension it was cleared at, from the save's own history (meta.runs, last 30) plus the trainer's
// whole run history in the runs table. Levels already unlocked are never lowered. Safe to re-run.
// Dry run (default: writes nothing): npx convex run migrations:ascensionFromClears [--prod]
// Apply: npx convex run migrations:ascensionFromClears '{"apply":true}' [--prod]
export const ascensionFromClears = internalMutation({
  args: { apply: v.optional(v.boolean()) },
  handler: async (ctx, { apply }) => {
    const rows = [];
    for await (const p of ctx.db.query("progress")) {
      const m = parseMeta(p.meta);
      if (!m) { rows.push({ email: p.email ?? null, error: "unreadable meta" }); continue; }
      const email = p.email ?? null;
      const player = email ? await ctx.db.query("players").withIndex("by_email", (q) => q.eq("email", email)).first() : null;
      const cloudRuns = player ? await ctx.db.query("runs").withIndex("by_player_finishedAt", (q) => q.eq("playerId", player._id)).collect() : [];
      const localRuns = Array.isArray(m.runs) ? (m.runs as HistoryRun[]) : [];
      const before = m.ascBy ?? null;
      const { ascBy, changed } = applyClears(m, [...localRuns, ...cloudRuns]);
      if (apply && changed) await ctx.db.patch(p._id, { meta: JSON.stringify(m) });
      rows.push({ email, before, after: ascBy, changed, localRuns: localRuns.length, cloudRuns: cloudRuns.length, maxAscension: m.maxAscension ?? 0 });
    }
    console.log(`ascensionFromClears: ${rows.length} saves, ${rows.filter((r) => r.changed).length} ${apply ? "updated" : "would change"}`);
    return { applied: !!apply, rows };
  },
});

// Closes a finished co-op room and records it as ONE team run (owned by the host, the partners in coop.with), for
// rooms that ended before the game did this itself. run: the runs:submit shape with the team's stats and party.
// Every member's trainer gets the run/win counted (credit: false skips that, e.g. when re-recording a room) and the
// score as their best if higher.
// removeRunIds: older per-player rows of this room to delete. Idempotent per clientRunId.
// Run with: npx convex run migrations:finishCoopRoom '{"code":"ABCDE","result":"win","run":{...}}' [--prod]
export const finishCoopRoom = internalMutation({
  args: { code: v.string(), result: resultValidator, run: v.any(), credit: v.optional(v.boolean()), removeRunIds: v.optional(v.array(v.id("runs"))) },
  handler: async (ctx, { code, result, run, credit, removeRunIds }) => {
    const room = await ctx.db.query("coopRooms").withIndex("by_code", (q) => q.eq("code", code)).first();
    if (!room) throw new Error("No room " + code);
    // (the same recording as the game's own coop:finish, see recordCoopRun in lib.ts; by hand the row is replaced)
    const r = await recordCoopRun(ctx, room, run, { replace: true, credit, removeRunIds, roomResult: result });
    return { room: r.room, id: r.id, score: r.score, replaced: r.replaced };
  },
});

// Co-op Pokédex repair (co-op never wrote to the Pokédex before v0.3.21): merges species into one player's saved
// meta.dexSeen / meta.dexCaught. Additive only: entries are never removed, and caught species count as seen too.
// The lists come from tools/coop_dex.mjs (replays an exported room log). The player: email, or a room code + slot.
// The player's game pulls the cloud save at sign-in, so they should reload the game after this runs (an old tab
// that saves before reloading writes its own meta back over it).
// Dry run (default: writes nothing): npx convex run migrations:mergeDex '{"email":"x@y.z","seen":[...],"caught":[...]}'
// Apply: add "apply":true [--prod]
export const mergeDex = internalMutation({
  args: {
    email: v.optional(v.string()),
    code: v.optional(v.string()),
    slot: v.optional(v.number()),
    seen: v.optional(v.array(v.string())),
    caught: v.optional(v.array(v.string())),
    apply: v.optional(v.boolean()),
  },
  handler: async (ctx, { email, code, slot, seen = [], caught = [], apply }) => {
    let who = normEmail(email);
    if (!who && code) {
      const room = await ctx.db.query("coopRooms").withIndex("by_code", (q) => q.eq("code", code.toUpperCase())).first();
      if (!room) throw new Error("No room " + code);
      const member = await ctx.db.query("coopMembers").withIndex("by_room", (q) => q.eq("roomId", room._id).eq("slot", slot ?? -1)).first();
      if (!member) throw new Error(`No player in slot ${slot} of room ${code}`);
      who = normEmail(member.email);
    }
    if (!who) throw new Error("Pass an email (or a room code and slot)");
    const ok = (s: unknown): s is string => typeof s === "string" && /^[A-Z0-9_]{2,20}$/.test(s);
    const bad = [...seen, ...caught].filter((s) => !ok(s));
    if (bad.length) throw new Error("Not species keys: " + bad.slice(0, 5).join(", "));
    const p = await ctx.db.query("progress").withIndex("by_email", (q) => q.eq("email", who)).first();
    if (!p) throw new Error("No save for " + who);
    const m = parseMeta(p.meta);
    if (!m) throw new Error("Unreadable meta for " + who);
    const dexSeen: string[] = Array.isArray(m.dexSeen) ? (m.dexSeen as string[]).slice() : [];
    const dexCaught: string[] = Array.isArray(m.dexCaught) ? (m.dexCaught as string[]).slice() : [];
    const before = { seen: dexSeen.length, caught: dexCaught.length };
    const addedSeen: string[] = [], addedCaught: string[] = [];
    for (const s of [...seen, ...caught]) if (!dexSeen.includes(s)) { dexSeen.push(s); addedSeen.push(s); }
    for (const s of caught) if (!dexCaught.includes(s)) { dexCaught.push(s); addedCaught.push(s); }
    const changed = addedSeen.length + addedCaught.length > 0;
    if (apply && changed) {
      m.dexSeen = dexSeen;
      m.dexCaught = dexCaught;
      await ctx.db.patch(p._id, { meta: JSON.stringify(m), updatedAt: Date.now() });
    }
    const after = { seen: dexSeen.length, caught: dexCaught.length };
    console.log(`mergeDex ${who}: seen ${before.seen} -> ${after.seen}, caught ${before.caught} -> ${after.caught} (${apply ? (changed ? "applied" : "nothing to add") : "dry run"})`);
    return { email: who, applied: !!apply && changed, dryRun: !apply, before, after, addedSeen, addedCaught };
  },
});
