import { internalMutation, internalQuery, mutation, query, MutationCtx, QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import { deflateSync, inflateSync, strFromU8, strToU8 } from "fflate";
import { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { normEmail, progressFor, requireUser } from "./lib";

const MAX = 900_000; // per save (meta + run), as JSON text; stored compressed, far under Convex's 1 MiB document limit

// ---- storage (v0.3.21) ----------------------------------------------------------------------
// A save is two parts, meta-progression and the run in progress, kept apart so a push writes only the part that
// changed (meta changes rarely, the run at every node):
//   saveHeads: one small row per account: which saveBlobs row holds each part, and a hash of each part's JSON,
//              so a push of an unchanged part (older clients always send both) writes nothing at all.
//   saveBlobs: one row per part, the JSON deflated (fflate). Overwriting a row costs a read of the old one, so
//              keeping them small (about a quarter of the JSON) matters as much as writing them rarely.
// Saves from before this live in the progress table (one row, both parts as JSON text). They stay readable: an
// account without a head row is served from there, and its first save in the new format copies whatever part it
// didn't send from there (once). The progress row itself is left as it was.
// Rolling the server back to code from before this change: run progress:exportToLegacy first (copies every head
// back into the progress table), and progress:adoptLegacy after coming forward again (takes progress rows that
// the old code wrote in between).
type Part = "meta" | "run";
const NO_RUN = "-"; // runHash when no run is in progress

// cyrb53 (a fast 53-bit string hash), twice with different seeds, plus the length: a collision would only skip
// writing a changed save, so this is far stronger than it needs to be.
function cyrb53(s: string, seed: number): number {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}
export const saveHash = (s: string) => `${cyrb53(s, 1).toString(36)}.${cyrb53(s, 2).toString(36)}.${s.length}`;

const deflate = (s: string): ArrayBuffer => {
  const u = deflateSync(strToU8(s), { level: 6 });
  return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
};
const inflate = (b: Doc<"saveBlobs">): string => (b.enc === "deflate" ? strFromU8(inflateSync(new Uint8Array(b.data))) : strFromU8(new Uint8Array(b.data)));

type UserRef = { _id: Id<"users">; email?: string };
async function headFor(ctx: QueryCtx, user: UserRef) {
  const email = normEmail(user.email);
  if (email) {
    const byEmail = await ctx.db.query("saveHeads").withIndex("by_email", (q) => q.eq("email", email)).first();
    if (byEmail) return byEmail;
  }
  return await ctx.db.query("saveHeads").withIndex("by_userId", (q) => q.eq("userId", user._id)).first();
}

// The account's save as JSON text: { meta, run, updatedAt, format } or null when it has none.
async function readSave(ctx: QueryCtx, user: UserRef) {
  const head = await headFor(ctx, user);
  if (head) {
    const part = async (id: Id<"saveBlobs"> | undefined) => {
      const b = id ? await ctx.db.get(id) : null;
      return b ? inflate(b) : null;
    };
    const meta = await part(head.metaId);
    const run = head.runHash === NO_RUN ? null : await part(head.runId);
    if (meta !== null && (run !== null || head.runHash === NO_RUN)) return { meta, run, updatedAt: head.updatedAt, format: 2 };
    console.error(`save head ${head._id} points at a missing part; serving the legacy row`); // (never expected)
  }
  const p = await progressFor(ctx, user);
  return p ? { meta: p.meta, run: p.run, updatedAt: p.updatedAt, format: 1 } : null;
}

function checkParts(parts: { meta?: string; run?: string | null }) {
  if ((parts.meta?.length ?? 0) + (parts.run?.length ?? 0) > MAX) throw new Error("Save data is too large.");
  if (parts.meta !== undefined) JSON.parse(parts.meta);
  if (typeof parts.run === "string") JSON.parse(parts.run);
}

// Writes the parts given (undefined = not sent, unchanged; run null = no run in progress). Parts equal to what is
// stored are skipped. -> { updatedAt, wrote: the parts written, missing?: true when a part that wasn't sent has
// nothing to start from (the client then sends the whole save) }
async function writeSave(ctx: MutationCtx, user: UserRef, parts: { meta?: string; run?: string | null }) {
  checkParts(parts);
  const email = normEmail(user.email);
  const now = Date.now();
  let head = await headFor(ctx, user);
  let fill: { meta?: string; run?: string | null } = {};
  if (!head && (parts.meta === undefined || parts.run === undefined)) {
    // first save in this format with only one part: the other comes from the account's legacy row (read once)
    const legacy = await progressFor(ctx, user);
    if (!legacy) return { updatedAt: 0, wrote: [] as Part[], missing: true };
    fill = { meta: legacy.meta, run: legacy.run };
  }
  if (!head) {
    const id = await ctx.db.insert("saveHeads", { userId: user._id, email, updatedAt: now });
    head = (await ctx.db.get(id))!;
  }
  const patch: Partial<Doc<"saveHeads">> = {};
  const wrote: Part[] = [];
  for (const part of ["meta", "run"] as Part[]) {
    const val = parts[part] !== undefined ? parts[part] : fill[part];
    if (val === undefined) continue;
    const hash = val === null ? NO_RUN : saveHash(val);
    const idKey = part === "meta" ? "metaId" : "runId", hashKey = part === "meta" ? "metaHash" : "runHash";
    if (head[hashKey] === hash) continue;
    const id = head[idKey];
    if (val === null) {
      if (id) await ctx.db.delete(id);
      patch[idKey] = undefined;
    } else {
      const doc = { email, part, enc: "deflate", data: deflate(val), size: val.length, updatedAt: now };
      if (id && (await replaceIfThere(ctx, id, doc))) { /* overwritten in place */ }
      else patch[idKey] = await ctx.db.insert("saveBlobs", doc);
    }
    patch[hashKey] = hash;
    wrote.push(part);
  }
  if (wrote.length || head.email !== email || head.userId !== user._id) {
    await ctx.db.patch(head._id, { ...patch, email, userId: user._id, updatedAt: wrote.length ? now : head.updatedAt });
  }
  return { updatedAt: wrote.length ? now : head.updatedAt, wrote };
}

async function replaceIfThere(ctx: MutationCtx, id: Id<"saveBlobs">, doc: Omit<Doc<"saveBlobs">, "_id" | "_creationTime">) {
  try { await ctx.db.replace(id, doc); return true; } catch { return false; } // (a blob deleted by hand: write a new one)
}

// ---- client API -----------------------------------------------------------------------------
// The account's save: meta-progression plus the run in progress (both JSON strings). format: 2 = the split tables
// above, 1 = a legacy progress row (clients from before v0.3.21 ignore it).
export const get = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const s = await readSave(ctx, user);
    return s ? { email: normEmail(user.email), meta: s.meta, run: s.run, updatedAt: s.updatedAt, format: s.format } : null;
  },
});

// The whole save (clients before v0.3.21, which send both parts after every save; unchanged parts are skipped).
export const save = mutation({
  args: { meta: v.string(), run: v.union(v.string(), v.null()) },
  handler: async (ctx, { meta, run }) => {
    const user = await requireUser(ctx);
    return (await writeSave(ctx, user, { meta, run })).updatedAt || Date.now();
  },
});

// v0.3.21+: only the parts that changed since the client's last successful sync.
export const put = mutation({
  args: { meta: v.optional(v.string()), run: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, { meta, run }) => {
    const user = await requireUser(ctx);
    return await writeSave(ctx, user, { meta, run });
  },
});

// ---- maintenance ----------------------------------------------------------------------------
// Deletes an account's saves in the new tables (coopTest cleanup of its throwaway test users).
export async function deleteSavesFor(ctx: MutationCtx, user: UserRef) {
  for (let head = await headFor(ctx, user); head; head = await headFor(ctx, user)) {
    for (const id of [head.metaId, head.runId]) if (id && (await ctx.db.get(id))) await ctx.db.delete(id);
    await ctx.db.delete(head._id);
  }
}

// Before rolling the server back to code that only knows the progress table: writes every account's current save
// back into it. npx convex run progress:exportToLegacy [--prod] (re-schedules itself until done)
export const exportToLegacy = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query("saveHeads").paginate({ cursor: cursor ?? null, numItems: 50 });
    let n = 0;
    for (const head of page.page) {
      const user = { _id: head.userId, email: head.email };
      const s = await readSave(ctx, user);
      if (!s || s.format !== 2) continue;
      const p = await progressFor(ctx, user);
      if (p && p.updatedAt >= s.updatedAt) continue;
      if (p) await ctx.db.patch(p._id, { meta: s.meta, run: s.run, updatedAt: s.updatedAt, email: head.email, userId: head.userId });
      else await ctx.db.insert("progress", { userId: head.userId, email: head.email, meta: s.meta, run: s.run, updatedAt: s.updatedAt });
      n++;
    }
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.progress.exportToLegacy, { cursor: page.continueCursor });
    return { exported: n, more: !page.isDone };
  },
});

// After coming forward again: progress rows newer than the account's head (written by old server code in between)
// become the save. npx convex run progress:adoptLegacy [--prod]
export const adoptLegacy = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query("progress").paginate({ cursor: cursor ?? null, numItems: 50 });
    let n = 0;
    for (const p of page.page) {
      const user = { _id: p.userId, email: p.email };
      const head = await headFor(ctx, user);
      if (!head || head.updatedAt >= p.updatedAt) continue;
      await writeSave(ctx, user, { meta: p.meta, run: p.run });
      n++;
    }
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.progress.adoptLegacy, { cursor: page.continueCursor });
    return { adopted: n, more: !page.isDone };
  },
});

// DEV tests only (tests/progress_api.test.cjs; refuses unless COOP_TEST=1, like coopTest.ts, and only for
// @kanto-spire.test accounts). testMakeLegacy turns the account's save into the legacy format (a progress row, no
// head; clear: no save at all); testRows shows its raw rows.
export const testMakeLegacy = internalMutation({
  args: { email: v.string(), clear: v.optional(v.boolean()) },
  handler: async (ctx, { email, clear }) => {
    if (process.env.COOP_TEST !== "1") throw new Error("COOP_TEST is not enabled on this deployment.");
    if (!/@kanto-spire\.test$/.test(email)) throw new Error("Test accounts only.");
    const user = await ctx.db.query("users").withIndex("email", (q) => q.eq("email", normEmail(email))).first();
    if (!user) throw new Error("No such user.");
    const s = clear ? null : await readSave(ctx, user);
    await deleteSavesFor(ctx, user);
    for (const p of await ctx.db.query("progress").withIndex("by_userId", (q) => q.eq("userId", user._id)).collect()) await ctx.db.delete(p._id);
    if (s) await ctx.db.insert("progress", { userId: user._id, email: normEmail(email), meta: s.meta, run: s.run, updatedAt: Date.now() - 60_000 });
    return null;
  },
});
export const testRows = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    if (process.env.COOP_TEST !== "1") throw new Error("COOP_TEST is not enabled on this deployment.");
    const e = normEmail(email);
    const legacy = await ctx.db.query("progress").withIndex("by_email", (q) => q.eq("email", e)).collect();
    const heads = await ctx.db.query("saveHeads").withIndex("by_email", (q) => q.eq("email", e)).collect();
    const blobs = [];
    for (const h of heads) for (const id of [h.metaId, h.runId]) { const b = id ? await ctx.db.get(id) : null; if (b) blobs.push({ part: b.part, size: b.size, stored: b.data.byteLength }); }
    return { legacy: legacy.map((p) => ({ meta: p.meta, run: p.run, updatedAt: p.updatedAt })), heads: heads.map((h) => ({ metaHash: h.metaHash ?? null, runHash: h.runHash ?? null, updatedAt: h.updatedAt })), blobs };
  },
});
