import { internalMutation, mutation, query, MutationCtx, QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import { Doc, Id } from "./_generated/dataModel";
import { cleanRun, normEmail, playerFor, recordCoopRun, requireUser, runInput } from "./lib";

// Online co-op for 2-4 players: rooms, members and the ordered (lockstep) action log.
// Every client applies the same actions in seq order to its own CoopGame (web/src/game/coop/coop.js);
// the server only orders them, assigns the sender slot and stores them. See tests/out/COOP_CONTRACT.txt.
//
// Wire format note: actions travel as JSON strings (post accepts a string or an object; since returns
// { seq, p, json }) so big Run snapshots never hit Convex value limits (8192-element arrays, "$" keys).
// web/src/net/coopnet.js turns them back into { seq, p, type, ...payload, nonce }.
//
// Network cost: newer clients read the room only through WebSocket subscriptions (coop:head, coop:feed, coop:presence,
// coop:sketch, coop:mineLive: see "live reads" below), send a keepalive into coopPresence (which head / feed never read)
// about twice a minute, and sketches / checkpoint states live in their own tables, so the docs every call reads stay
// small. Older clients keep polling coop:since / coop:watch: every function they call still works.

const CODE_ABC = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no I, L, O, 0, 1
const CODE_LEN = 5;
const MAX_ACTION_BYTES = 900_000;
const SINCE_MAX = 200;
const SINCE_MAX_BYTES = 6_000_000; // stop a since page early when actions are big (client keeps draining)
const MAX_SEQ = 200_000;
const DAY = 24 * 60 * 60 * 1000;
const MAX_ASC = 20;
const MAX_MEMBERS = 4; // players per room (slots 0..3); a run starts with 2-4
// Older clients (before 3-4 players) send no maxPlayers: they count as 2-player clients, and a room with one of
// them in it stays a 2-player room (they couldn't simulate a 3-4 player run). So 2-player play is unchanged
// while old and new clients mix (e.g. mid-deploy, or a tab that hasn't reloaded).
const supports = (m: { maxPlayers?: number }) => Math.max(2, Math.min(MAX_MEMBERS, Math.floor(m.maxPlayers ?? 2)));
const roomCap = (members: { maxPlayers?: number }[], joiner?: { maxPlayers?: number }) =>
  Math.min(MAX_MEMBERS, ...members.map(supports), ...(joiner ? [supports(joiner)] : []));
const maxPlayersV = v.optional(v.number());

type Room = Doc<"coopRooms">;
type Member = Doc<"coopMembers">;
type Presence = Doc<"coopPresence">;
type User = Doc<"users">;

const HB_LEGACY = 5000; // older clients beat every 5 s and call a partner offline after 20 s without one
const NET_MAX = 99;

// v0.1.0 One Spire rooms: "spire" (KANTO + HOENN) / "spire_kanto" (KANTO only) / v0.1.1 "spire_johto" (all three); kanto / hoenn = rooms from before it
const worldV = v.union(v.literal("kanto"), v.literal("hoenn"), v.literal("spire"), v.literal("spire_kanto"), v.literal("spire_johto"));

function randomFrom(abc: string, n: number) {
  let s = "";
  for (let i = 0; i < n; i++) s += abc[Math.floor(Math.random() * abc.length)];
  return s;
}

function bounded(s: string, max: number, what: string) {
  if (typeof s !== "string" || s.length > max) throw new Error(`${what} is too long.`);
  return s;
}

function cleanAscension(a: number) {
  if (!Number.isFinite(a) || a < 0 || a > MAX_ASC) throw new Error(`Ascension must be 0-${MAX_ASC}.`);
  return Math.floor(a);
}
const clampAscension = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.min(MAX_ASC, Math.floor(n))) : 0);
// Ascension unlocks are per starter: a room can go up to the highest of the players' unlocks for the
// starters they picked (a member who hasn't sent one, e.g. an older client, doesn't count; none known = no cap).
function ascensionCap(members: Member[]) {
  const known = members.map((m) => m.ascMax).filter((n): n is number => typeof n === "number");
  return known.length ? Math.max(...known.map(clampAscension)) : MAX_ASC;
}

const byteLength = (s: string) => new TextEncoder().encode(s).length;

async function displayName(ctx: QueryCtx, user: User) {
  const player = await playerFor(ctx, user);
  const raw = player?.name || user.name || (user.email || "TRAINER").split("@")[0];
  return raw.replace(/\s+/g, " ").trim().slice(0, 12) || "TRAINER";
}

async function membersOf(ctx: QueryCtx, roomId: Id<"coopRooms">) {
  return await ctx.db.query("coopMembers").withIndex("by_room", (q) => q.eq("roomId", roomId)).collect();
}

async function getRoomOrThrow(ctx: QueryCtx, roomId: Id<"coopRooms">) {
  const room = await ctx.db.get(roomId);
  if (!room) throw new Error("Room not found");
  return room;
}

// The caller's room + membership, or an error (non-members never learn anything about the room).
async function myMembership(ctx: QueryCtx, roomId: Id<"coopRooms">) {
  const user = await requireUser(ctx);
  const email = normEmail(user.email);
  const room = await ctx.db.get(roomId);
  const me = room
    ? await ctx.db.query("coopMembers").withIndex("by_room_email", (q) => q.eq("roomId", roomId).eq("email", email)).first()
    : null;
  if (!room || !me) throw new Error("Room not found");
  return { user, email, room, me };
}

async function presenceOf(ctx: QueryCtx, roomId: Id<"coopRooms">) {
  return await ctx.db.query("coopPresence").withIndex("by_room", (q) => q.eq("roomId", roomId)).collect();
}

// A member's lastSeen / lastSeq for the views older clients read (coop:room / coop:since): the newer of the member row
// and its heartbeat row. A newer client beats every hb ms (15 s), so its lastSeen is reported up to hb - 5 s later
// (never past now): an older partner's 20 s offline rule still holds (offline after ~30 s instead of 20).
function seenOf(m: Member, pres: Presence[], now: number) {
  const p = pres.find((x) => x.memberId === m._id);
  if (!p) return { lastSeen: m.lastSeen, lastSeq: m.lastSeq };
  // (a client that said goodbye, coop:alive gone, gets no allowance: older partners see it offline 20 s later)
  const shift = p.hb && p.hb > HB_LEGACY && !p.gone ? p.hb - HB_LEGACY : 0;
  return { lastSeen: Math.max(m.lastSeen, Math.min(now, p.lastSeen + shift)), lastSeq: p.lastSeq };
}

// The member fields every client sees, without presence (coop:watch: they only change with the member row).
function memberCore(m: Member) {
  return {
    slot: m.slot, name: m.name, starter: m.starter ?? null, ascMax: m.ascMax ?? null, sketchV: m.sketchV ?? 0, ready: m.ready, left: !!m.left,
    saved: !!m.left && !!m.savedAt, // v0.3.6: left with SAVE & QUIT
    maxPlayers: supports(m), net: m.net ?? 0,
  };
}

function publicMember(m: Member, pres: Presence[], now: number) {
  return { ...memberCore(m), ...seenOf(m, pres, now) };
}

// The room fields that change with the lobby / the run's status (not nextSeq / updatedAt, which every action bumps).
function roomCore(room: Room, members: Member[]) {
  const host = members.find((m) => m.email === room.host);
  return {
    _id: room._id, code: room.code, status: room.status,
    host: host ? host.slot : 0, // host's slot (emails are not shared)
    ascension: room.ascension, world: room.world, seed: room.seed,
    createdAt: room.createdAt, gameVersion: room.gameVersion ?? null, progress: room.progress ?? null,
    maxPlayers: roomCap(members), // seats in this room (2 while an older 2-player client is in it)
  };
}

function publicRoom(room: Room, members: Member[]) {
  return { ...roomCore(room, members), nextSeq: room.nextSeq, updatedAt: room.updatedAt };
}

function roomView(room: Room, members: Member[], me: Member, pres: Presence[]) {
  const sorted = [...members].sort((a, b) => a.slot - b.slot);
  const now = Date.now();
  return {
    room: publicRoom(room, sorted),
    members: sorted.map((m) => publicMember(m, pres, now)),
    me: me.slot,
    isHost: me.email === room.host,
  };
}

// FNV-1a of a string, base 36 (the version of a coop:watch view).
function fnv(s: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}

async function deleteMemberRows(ctx: MutationCtx, memberId: Id<"coopMembers">) {
  for (const p of await ctx.db.query("coopPresence").withIndex("by_member", (q) => q.eq("memberId", memberId)).collect()) await ctx.db.delete(p._id);
  for (const k of await ctx.db.query("coopSketches").withIndex("by_member", (q) => q.eq("memberId", memberId)).collect()) await ctx.db.delete(k._id);
}

async function requireLobbyHost(ctx: MutationCtx, roomId: Id<"coopRooms">) {
  const m = await myMembership(ctx, roomId);
  if (m.room.host !== m.email) throw new Error("Only the host can do that.");
  if (m.room.status !== "lobby") throw new Error("The run has already started.");
  return m;
}

// ---- lobby ------------------------------------------------------------------------------------

const tagV = v.optional(v.string());
const cleanTag = (s: string | undefined) => (typeof s === "string" && /^[A-Za-z0-9._-]{1,24}$/.test(s) ? s : undefined);

export const create = mutation({
  args: { ascension: v.optional(v.number()), world: v.optional(worldV), maxPlayers: maxPlayersV, gameVersion: tagV, engine: tagV },
  handler: async (ctx, { ascension, world, maxPlayers, gameVersion, engine }) => {
    const user = await requireUser(ctx);
    const email = normEmail(user.email);
    if (!email) throw new Error("Your account has no email.");
    let code = "";
    for (let i = 0; ; i++) {
      code = randomFrom(CODE_ABC, CODE_LEN);
      if (!(await ctx.db.query("coopRooms").withIndex("by_code", (q) => q.eq("code", code)).first())) break;
      if (i >= 20) throw new Error("Could not make a room code, try again.");
    }
    const now = Date.now();
    const roomId = await ctx.db.insert("coopRooms", {
      code, status: "lobby", host: email, ascension: cleanAscension(ascension ?? 0), world: world ?? "spire",
      seed: randomFrom("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 8), nextSeq: 1, createdAt: now, updatedAt: now,
      ...(cleanTag(gameVersion) ? { gameVersion: cleanTag(gameVersion) } : {}), ...(cleanTag(engine) ? { engine: cleanTag(engine) } : {}),
    });
    await ctx.db.insert("coopMembers", {
      roomId, userId: user._id, email, slot: 0, name: await displayName(ctx, user), ready: false,
      joinedAt: now, lastSeen: now, lastSeq: 0, ...(maxPlayers !== undefined ? { maxPlayers: supports({ maxPlayers }) } : {}),
    });
    return { roomId, code };
  },
});

export const join = mutation({
  args: { code: v.string(), maxPlayers: maxPlayersV },
  handler: async (ctx, { code: raw, maxPlayers }) => {
    const user = await requireUser(ctx);
    const email = normEmail(user.email);
    const code = bounded(raw, 32, "Code").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (code.length !== CODE_LEN) throw new Error("Room not found");
    const room = await ctx.db.query("coopRooms").withIndex("by_code", (q) => q.eq("code", code)).first();
    if (!room || room.status === "closed") throw new Error("Room not found");
    const members = await membersOf(ctx, room._id);
    const mine = members.find((m) => m.email === email);
    const now = Date.now();
    if (mine) {
      await ctx.db.patch(mine._id, { left: false, dismissed: false, savedAt: undefined, lastSeen: now, ...(maxPlayers !== undefined ? { maxPlayers: supports({ maxPlayers }) } : {}) });
      return { roomId: room._id, slot: mine.slot, code: room.code, status: room.status };
    }
    if (members.length >= roomCap(members, { maxPlayers })) throw new Error("Room is full");
    if (room.status !== "lobby") throw new Error("Room not found");
    let slot = 0;
    while (members.some((m) => m.slot === slot)) slot++;
    await ctx.db.insert("coopMembers", {
      roomId: room._id, userId: user._id, email, slot, name: await displayName(ctx, user), ready: false,
      joinedAt: now, lastSeen: now, lastSeq: 0, ...(maxPlayers !== undefined ? { maxPlayers: supports({ maxPlayers }) } : {}),
    });
    await ctx.db.patch(room._id, { updatedAt: now });
    return { roomId: room._id, slot, code: room.code, status: room.status };
  },
});

export const setStarter = mutation({
  args: { roomId: v.id("coopRooms"), starter: v.string(), ascMax: v.optional(v.number()) },
  handler: async (ctx, { roomId, starter, ascMax }) => {
    const { room, me } = await myMembership(ctx, roomId);
    if (room.status !== "lobby") throw new Error("The run has already started.");
    if (!/^[A-Za-z0-9_-]{1,24}$/.test(starter)) throw new Error("Not a starter.");
    await ctx.db.patch(me._id, { starter, lastSeen: Date.now(), ...(ascMax !== undefined ? { ascMax: clampAscension(ascMax) } : {}) });
    // if this pick lowers the room's best unlock below its ascension, the ascension drops to fit
    const cap = ascensionCap(await membersOf(ctx, roomId));
    if (room.ascension > cap) await ctx.db.patch(room._id, { ascension: cap, updatedAt: Date.now() });
    return null;
  },
});

export const setReady = mutation({
  args: { roomId: v.id("coopRooms"), ready: v.boolean() },
  handler: async (ctx, { roomId, ready }) => {
    const { room, me } = await myMembership(ctx, roomId);
    if (room.status !== "lobby") throw new Error("The run has already started.");
    await ctx.db.patch(me._id, { ready, lastSeen: Date.now() });
    return null;
  },
});

export const configure = mutation({
  args: { roomId: v.id("coopRooms"), ascension: v.optional(v.number()), world: v.optional(worldV) },
  handler: async (ctx, { roomId, ascension, world }) => {
    const { room } = await requireLobbyHost(ctx, roomId);
    const patch: Partial<Room> = { updatedAt: Date.now() };
    if (ascension !== undefined) patch.ascension = Math.min(cleanAscension(ascension), ascensionCap(await membersOf(ctx, roomId)));
    if (world !== undefined) patch.world = world;
    await ctx.db.patch(room._id, patch);
    return { ascension: patch.ascension ?? room.ascension, world: patch.world ?? room.world };
  },
});

export const start = mutation({
  args: { roomId: v.id("coopRooms") },
  handler: async (ctx, { roomId }) => {
    const { room } = await requireLobbyHost(ctx, roomId);
    const members = (await membersOf(ctx, roomId)).sort((a, b) => a.slot - b.slot);
    if (members.length < 2) throw new Error("Waiting for a second player.");
    if (members.length > MAX_MEMBERS) throw new Error("Too many players.");
    if (members.length > roomCap(members)) throw new Error("Every player needs the latest version for 3-4 players: reload the page.");
    if (members.some((m) => !m.starter)) throw new Error("Every player must pick a starter.");
    if (room.ascension > ascensionCap(members)) throw new Error("No player has that ascension unlocked for their starter.");
    const now = Date.now();
    // Seats are renumbered 0..n-1 (someone leaving the lobby can leave a gap): the game's player p is the
    // member in slot p, and the init lists starters/names in that order.
    for (const [i, m] of members.entries()) if (m.slot !== i) { await ctx.db.patch(m._id, { slot: i }); m.slot = i; }
    const init = {
      type: "init", seed: room.seed, ascension: room.ascension, world: room.world,
      starters: members.map((m) => m.starter!), names: members.map((m) => m.name),
    };
    const nonce = "init";
    await ctx.db.insert("coopActions", { roomId, seq: 1, p: -1, type: "init", nonce, json: JSON.stringify({ ...init, nonce }), createdAt: now });
    await ctx.db.patch(roomId, { status: "playing", nextSeq: 2, updatedAt: now });
    for (const m of members) await ctx.db.patch(m._id, { lastSeq: 0 });
    for (const p of await presenceOf(ctx, roomId)) {
      const m = members.find((x) => x._id === p.memberId);
      if (m) await ctx.db.patch(p._id, { slot: m.slot, lastSeq: 0 });
    }
    return { seq: 1 };
  },
});

export const leave = mutation({
  args: { roomId: v.id("coopRooms") },
  handler: async (ctx, { roomId }) => {
    const { room, me, email } = await myMembership(ctx, roomId);
    const now = Date.now();
    if (room.status === "lobby") {
      await deleteMemberRows(ctx, me._id);
      await ctx.db.delete(me._id);
      if (room.host === email) await ctx.db.patch(roomId, { status: "closed", updatedAt: now });
      return { closed: room.host === email };
    }
    if (room.status === "playing") await ctx.db.patch(me._id, { left: true, savedAt: undefined, lastSeen: now });
    return { closed: room.status === "closed" };
  },
});

// Delete a room from my REJOIN list. A lobby: like leaving (the host's closes it). A run in progress: I leave it for
// good (the partner keeps playing, sees me as left); once every member has deleted it (or it's closed), the room
// and its whole action log are deleted.
export const dismiss = mutation({
  args: { roomId: v.id("coopRooms") },
  handler: async (ctx, { roomId }) => {
    const { room, me, email } = await myMembership(ctx, roomId);
    const now = Date.now();
    if (room.status === "lobby") {
      await deleteMemberRows(ctx, me._id);
      await ctx.db.delete(me._id);
      if (room.host === email) await ctx.db.patch(roomId, { status: "closed", updatedAt: now });
    } else await ctx.db.patch(me._id, { dismissed: true, left: true, savedAt: undefined, lastSeen: now });
    const members = await membersOf(ctx, roomId);
    if (members.every((m) => m.dismissed)) { await deleteRoom(ctx, roomId); return { deleted: true }; } // (also: nobody left)
    return { deleted: false };
  },
});

async function deleteRoom(ctx: MutationCtx, roomId: Id<"coopRooms">) {
  for (const a of await ctx.db.query("coopActions").withIndex("by_room_seq", (q) => q.eq("roomId", roomId)).collect()) await ctx.db.delete(a._id);
  for (const c of await ctx.db.query("coopCheckpoints").withIndex("by_room_seq", (q) => q.eq("roomId", roomId)).collect()) await ctx.db.delete(c._id);
  for (const c of await ctx.db.query("coopCheckpointStates").withIndex("by_room", (q) => q.eq("roomId", roomId)).collect()) await ctx.db.delete(c._id);
  for (const p of await presenceOf(ctx, roomId)) await ctx.db.delete(p._id);
  for (const k of await ctx.db.query("coopSketches").withIndex("by_room", (q) => q.eq("roomId", roomId)).collect()) await ctx.db.delete(k._id);
  for (const m of await membersOf(ctx, roomId)) await ctx.db.delete(m._id);
  await ctx.db.delete(roomId);
}

// ---- the run ----------------------------------------------------------------------------------

export const post = mutation({
  args: { roomId: v.id("coopRooms"), action: v.any() },
  handler: async (ctx, { roomId, action }) => {
    const { room, me } = await myMembership(ctx, roomId);
    if (room.status !== "playing") throw new Error("The run is not in progress.");
    let a: Record<string, unknown>;
    if (typeof action === "string") {
      if (byteLength(action) > MAX_ACTION_BYTES) throw new Error("Action is too big.");
      try { a = JSON.parse(action); } catch { throw new Error("Action is not valid JSON."); }
    } else a = action;
    if (!a || typeof a !== "object" || Array.isArray(a)) throw new Error("Action must be an object.");
    const type = a.type;
    if (typeof type !== "string" || !/^[A-Za-z][A-Za-z0-9_]{0,23}$/.test(type) || type === "init") throw new Error("Bad action type.");
    const nonce = a.nonce;
    if (typeof nonce !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(nonce)) throw new Error("Action needs a nonce.");
    const dup = await ctx.db.query("coopActions").withIndex("by_room_nonce", (q) => q.eq("roomId", roomId).eq("nonce", nonce)).first();
    if (dup) {
      if (dup.p !== me.slot) throw new Error("Nonce already used.");
      return { seq: dup.seq, duplicate: true };
    }
    const { seq: _s, p: _p, ...payload } = a;
    const json = JSON.stringify(payload);
    if (byteLength(json) > MAX_ACTION_BYTES) throw new Error("Action is too big.");
    const seq = room.nextSeq;
    if (seq > MAX_SEQ) throw new Error("This room's log is full.");
    const now = Date.now();
    await ctx.db.insert("coopActions", { roomId, seq, p: me.slot, type, nonce, json, createdAt: now });
    await ctx.db.patch(roomId, { nextSeq: seq + 1, updatedAt: now });
    if (me.left) await ctx.db.patch(me._id, { left: false, savedAt: undefined });
    return { seq, duplicate: false };
  },
});

// "I'm here, at seq": writes my coopPresence row, not the member row (so the room view, and every coop:watch
// subscription, stays as it is). net: the wire protocol my client speaks (web/src/game/coop/wire.js); a heartbeat
// without it (an older client) clears it. hb: my heartbeat interval (ms).
// -> { now, presence: [{ slot, lastSeen, lastSeq, hb }] } (everyone's last heartbeat and how often they beat: newer
// clients' "online" dots; a hidden tab beats less often and says so)
export const heartbeat = mutation({
  args: { roomId: v.id("coopRooms"), seq: v.optional(v.number()), net: v.optional(v.number()), hb: v.optional(v.number()) },
  handler: async (ctx, { roomId, seq, net, hb }) => {
    const { room, me } = await myMembership(ctx, roomId);
    const now = Date.now();
    const lastSeq = seq !== undefined && Number.isFinite(seq) ? Math.max(0, Math.min(Math.floor(seq), room.nextSeq - 1)) : undefined;
    const hbMs = hb !== undefined && Number.isFinite(hb) ? Math.max(1000, Math.min(120_000, Math.floor(hb))) : undefined;
    const pres = await presenceOf(ctx, roomId);
    const mine = pres.find((p) => p.memberId === me._id);
    if (mine) {
      const row = { lastSeen: now, slot: me.slot, hb: hbMs, gone: undefined, ...(lastSeq !== undefined ? { lastSeq } : {}) };
      await ctx.db.patch(mine._id, row);
      Object.assign(mine, row);
    } else {
      const row = { roomId, memberId: me._id, slot: me.slot, lastSeen: now, lastSeq: lastSeq ?? me.lastSeq, ...(hbMs !== undefined ? { hb: hbMs } : {}) };
      const _id = await ctx.db.insert("coopPresence", row);
      pres.push({ ...row, _id, _creationTime: now });
    }
    const patch: Partial<Member> = {};
    if (me.left && room.status === "playing") { patch.left = false; patch.savedAt = undefined; }
    const netV = net !== undefined && Number.isInteger(net) && net >= 1 && net <= NET_MAX ? net : undefined;
    if (me.net !== netV) patch.net = netV;
    if (Object.keys(patch).length) await ctx.db.patch(me._id, patch);
    return { now, presence: pres.map((p) => ({ slot: p.slot, lastSeen: p.lastSeen, lastSeq: p.lastSeq, hb: p.hb ?? HB_LEGACY })) };
  },
});

// v0.3.12: the run is over (a win or a wipe). Records the room as ONE team run in RECORDS (run: the runs:submit shape
// with the whole team's party and stats, built by any member's client: every client holds every player's run) and
// closes the room, so it leaves everyone's REJOIN list. Every client calls it when it reaches the end screen (queued
// offline-safe in web/src/net/cloud.js): the first call records it, later calls change nothing.
export const finish = mutation({
  args: { roomId: v.id("coopRooms"), run: runInput },
  handler: async (ctx, { roomId, run }) => {
    const { room } = await myMembership(ctx, roomId);
    if (room.status === "lobby" || (room.status === "closed" && !room.result)) throw new Error("The run is not in progress.");
    const { score: _s, ...clean } = cleanRun({ ...run, clientRunId: `coop-${room.code}` });
    // (cleanRun drops coopParties, which only a team run carries: hand every player's team on to the record)
    const r = await recordCoopRun(ctx, room, { ...clean, ...(run.coopParties ? { coopParties: run.coopParties } : {}) }, { replace: false, createTrainers: true });
    return { score: r.score, duplicate: r.duplicate };
  },
});

// ---- checkpoints (v0.3.6): the game at a safe point, so a room resumes without its whole log, across updates ----
const MAX_CHECKPOINT_BYTES = 900_000;
const KEEP_CHECKPOINTS = 8;
const CHECKPOINT_REASONS = new Set(["auto", "save", "resume", "legacy", "fallback"]);

// A client writes one when the game reaches the map (and on SAVE & QUIT); the same seq written again with the same
// checksum just adds the writer's slot, a different checksum marks it disputed (a desync: never loaded).
// state may be left out (newer clients): "I have this seq with this checksum", which adds my slot or disputes it like a
// full write, without uploading the game. need: true when the server has no state for that seq yet (the caller then
// sends it). Newer clients upload from one player (the lowest present slot) and confirm from the others.
const hasState = (c: Doc<"coopCheckpoints">) => !!c.stateId || !!c.state;
export const checkpoint = mutation({
  args: {
    roomId: v.id("coopRooms"), seq: v.number(), phase: v.string(), state: v.optional(v.string()), checksum: v.number(),
    gameVersion: tagV, engine: tagV, reason: v.optional(v.string()), progress: v.optional(v.string()),
  },
  handler: async (ctx, { roomId, seq, phase, state, checksum, gameVersion, engine, reason, progress }) => {
    const { room, me } = await myMembership(ctx, roomId);
    if (room.status !== "playing") throw new Error("The run is not in progress.");
    if (!Number.isInteger(seq) || seq < 1 || seq > room.nextSeq - 1) throw new Error("Bad checkpoint seq.");
    if (phase !== "map") throw new Error("Checkpoints are only taken on the map.");
    if (state !== undefined && !state) throw new Error("Bad checkpoint state.");
    if (state !== undefined && byteLength(state) > MAX_CHECKPOINT_BYTES) throw new Error("Checkpoint is too big.");
    if (!Number.isFinite(checksum)) throw new Error("Bad checksum.");
    const now = Date.now();
    // (rows keep their state in coopCheckpointStates, so this reads a few hundred bytes)
    const same = await ctx.db.query("coopCheckpoints").withIndex("by_room_seq", (q) => q.eq("roomId", roomId).eq("seq", seq)).first();
    let disputed = false, have = state !== undefined;
    if (same) {
      if (same.checksum !== checksum) { disputed = true; if (!same.disputed) await ctx.db.patch(same._id, { disputed: true }); }
      else {
        const patch: Partial<Doc<"coopCheckpoints">> = {};
        if (!same.slots.includes(me.slot)) patch.slots = [...same.slots, me.slot];
        if (hasState(same)) have = true;
        else if (state !== undefined) patch.stateId = await ctx.db.insert("coopCheckpointStates", { roomId, state });
        if (Object.keys(patch).length) await ctx.db.patch(same._id, patch);
      }
    } else {
      const stateId = state !== undefined ? await ctx.db.insert("coopCheckpointStates", { roomId, state }) : undefined;
      await ctx.db.insert("coopCheckpoints", {
        roomId, seq, phase, state: "", checksum, slots: [me.slot], createdAt: now, ...(stateId ? { stateId } : {}),
        ...(cleanTag(gameVersion) ? { gameVersion: cleanTag(gameVersion) } : {}), ...(cleanTag(engine) ? { engine: cleanTag(engine) } : {}),
        ...(reason && CHECKPOINT_REASONS.has(reason) ? { reason } : {}),
      });
      // keep the newest few
      const all = await ctx.db.query("coopCheckpoints").withIndex("by_room_seq", (q) => q.eq("roomId", roomId)).order("desc").collect();
      for (const c of all.slice(KEEP_CHECKPOINTS)) {
        if (c.stateId) await ctx.db.delete(c.stateId);
        await ctx.db.delete(c._id);
      }
    }
    const label = typeof progress === "string" ? progress.replace(/[^A-Za-z0-9 .:-]/g, "").slice(0, 32) : "";
    if (!disputed && label && label !== room.progress) await ctx.db.patch(roomId, { progress: label });
    return { seq, disputed, duplicate: !!same, need: !disputed && !have };
  },
});

// The newest checkpoint that isn't disputed and has its state (null if the room has none, e.g. one from before v0.3.6).
export const latestCheckpoint = query({
  args: { roomId: v.id("coopRooms") },
  handler: async (ctx, { roomId }) => {
    await myMembership(ctx, roomId);
    for await (const c of ctx.db.query("coopCheckpoints").withIndex("by_room_seq", (q) => q.eq("roomId", roomId)).order("desc")) {
      if (c.disputed) continue;
      const state = c.state || (c.stateId ? (await ctx.db.get(c.stateId))?.state : "") || "";
      if (!state) continue; // (only confirmed by checksum so far)
      return {
        seq: c.seq, phase: c.phase, state, checksum: c.checksum, gameVersion: c.gameVersion ?? null, engine: c.engine ?? null,
        reason: c.reason ?? null, slots: c.slots, createdAt: c.createdAt,
      };
    }
    return null;
  },
});

// SAVE & QUIT: the client has written its checkpoint; mark me as away with a save, so the others see it.
export const saveQuit = mutation({
  args: { roomId: v.id("coopRooms") },
  handler: async (ctx, { roomId }) => {
    const { room, me } = await myMembership(ctx, roomId);
    const now = Date.now();
    if (room.status === "playing") await ctx.db.patch(me._id, { left: true, savedAt: now, lastSeen: now });
    return { saved: room.status === "playing" };
  },
});

// ---- map sketches: each player's route doodles, shown to the partner (not part of the game log) ----
const SKETCH_MAX = 40000;
export const setSketch = mutation({
  args: { roomId: v.id("coopRooms"), sketch: v.string(), all: v.optional(v.boolean()) },
  handler: async (ctx, { roomId, sketch, all }) => {
    const { room, me } = await myMembership(ctx, roomId);
    if (room.status === "closed") throw new Error("Room closed.");
    if (sketch.length > SKETCH_MAX) throw new Error("Sketch is too big.");
    let parsed: unknown;
    try { parsed = JSON.parse(sketch); } catch { throw new Error("Bad sketch."); }
    if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as { strokes?: unknown }).strokes)) throw new Error("Bad sketch.");
    const v1 = (me.sketchV ?? 0) + 1;
    // the sketch goes to coopSketches; the member row keeps the version (the room view carries it: clients fetch on
    // change) and drops a sketch stored there by an older server
    await putSketch(ctx, roomId, me._id, sketch);
    await ctx.db.patch(me._id, { sketchV: v1, lastSeen: Date.now(), ...(me.sketch !== undefined ? { sketch: undefined } : {}) });
    // ERASE wipes the other players' sketches too
    if (all) {
      for (const m of await membersOf(ctx, roomId)) {
        if (m._id === me._id) continue;
        await putSketch(ctx, roomId, m._id, "");
        await ctx.db.patch(m._id, { sketchV: (m.sketchV ?? 0) + 1, ...(m.sketch !== undefined ? { sketch: undefined } : {}) });
      }
    }
    return { v: v1 };
  },
});

async function putSketch(ctx: MutationCtx, roomId: Id<"coopRooms">, memberId: Id<"coopMembers">, sketch: string) {
  const row = await ctx.db.query("coopSketches").withIndex("by_member", (q) => q.eq("memberId", memberId)).first();
  if (row) await ctx.db.patch(row._id, { sketch });
  else await ctx.db.insert("coopSketches", { roomId, memberId, sketch });
}

// -> [{ slot, sketch (JSON or null), sketchV }]. only: just these slots (newer clients fetch the ones whose sketchV changed).
export const sketches = query({
  args: { roomId: v.id("coopRooms"), only: v.optional(v.array(v.number())) },
  handler: async (ctx, { roomId, only }) => {
    await myMembership(ctx, roomId);
    const members = (await membersOf(ctx, roomId)).filter((m) => !only || only.includes(m.slot));
    const out = [];
    for (const m of members) {
      const row = await ctx.db.query("coopSketches").withIndex("by_member", (q) => q.eq("memberId", m._id)).first();
      out.push({ slot: m.slot, sketch: (row ? row.sketch : m.sketch) || null, sketchV: m.sketchV ?? 0 });
    }
    return out;
  },
});

// ---- reads ------------------------------------------------------------------------------------

export const room = query({
  args: { roomId: v.id("coopRooms") },
  handler: async (ctx, { roomId }) => {
    const { room, me } = await myMembership(ctx, roomId);
    return { ...roomView(room, await membersOf(ctx, roomId), me, await presenceOf(ctx, roomId)), now: Date.now() };
  },
});

async function actionsAfter(ctx: QueryCtx, roomId: Id<"coopRooms">, after: number) {
  const from = Number.isFinite(after) ? Math.max(0, Math.floor(after)) : 0;
  const actions: { seq: number; p: number; json: string }[] = [];
  let bytes = 0;
  for await (const a of ctx.db.query("coopActions").withIndex("by_room_seq", (q) => q.eq("roomId", roomId).gt("seq", from))) {
    actions.push({ seq: a.seq, p: a.p, json: a.json });
    bytes += a.json.length;
    if (actions.length >= SINCE_MAX || bytes >= SINCE_MAX_BYTES) break;
  }
  return { actions, last: actions.length ? actions[actions.length - 1].seq : from };
}

// Actions with seq > after, in order (at most 200, fewer if they are big: check `more`), plus the room.
// (What older clients poll every 700 ms; newer ones subscribe to coop:watch.)
export const since = query({
  args: { roomId: v.id("coopRooms"), after: v.number() },
  handler: async (ctx, { roomId, after }) => {
    const { room, me } = await myMembership(ctx, roomId);
    const { actions, last } = await actionsAfter(ctx, roomId, after);
    const view = roomView(room, await membersOf(ctx, roomId), me, await presenceOf(ctx, roomId));
    return { actions, more: last < room.nextSeq - 1, status: room.status, ...view, now: Date.now() };
  },
});

// The run's live feed, for a subscription (or a poll): actions with seq > after (like coop:since), the room's nextSeq
// and status, and the room view { room, members, me, isHost } only when its version (vh) differs from the caller's.
// It reads the room, its members and the new actions, never presence (heartbeats, see coop:heartbeat), so a
// subscription re-runs only when someone posts, joins, leaves, readies, sketches or a checkpoint moves the progress.
// view.room has no nextSeq / updatedAt and view.members no lastSeen / lastSeq (presence comes with the heartbeat).
export const watch = query({
  args: { roomId: v.id("coopRooms"), after: v.number(), vh: v.optional(v.string()) },
  handler: async (ctx, { roomId, after, vh }) => {
    const user = await requireUser(ctx);
    const email = normEmail(user.email);
    const room = await ctx.db.get(roomId);
    const members = room ? await membersOf(ctx, roomId) : [];
    const me = members.find((m) => m.email === email);
    if (!room || !me) throw new Error("Room not found");
    const { actions, last } = await actionsAfter(ctx, roomId, after);
    const sorted = members.sort((a, b) => a.slot - b.slot);
    const view = { room: roomCore(room, sorted), members: sorted.map(memberCore), me: me.slot, isHost: me.email === room.host };
    const hash = fnv(JSON.stringify(view));
    return { actions, more: last < room.nextSeq - 1, nextSeq: room.nextSeq, status: room.status, vh: hash, ...(hash !== vh ? { view } : {}) };
  },
});

// Rooms I'm in (for REJOIN): not closed, newest first. Lobbies show for 24 h after their last activity, runs in
// progress for 30 days (v0.3.6; was 24 h, which hid saved games).
const KEEP_RUNS = 30 * DAY;
export const mine = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const email = normEmail(user.email);
    const now = Date.now();
    const mems = await ctx.db.query("coopMembers").withIndex("by_email", (q) => q.eq("email", email).gt("joinedAt", now - KEEP_RUNS - 7 * DAY)).order("desc").take(50);
    const out = [];
    for (const me of mems) {
      if (me.dismissed) continue; // deleted from my list
      const room = await ctx.db.get(me.roomId);
      if (!room || room.status === "closed" || room.updatedAt < now - (room.status === "playing" ? KEEP_RUNS : DAY)) continue;
      const members = await membersOf(ctx, room._id);
      out.push({
        roomId: room._id, code: room.code, status: room.status, ascension: room.ascension, world: room.world,
        slot: me.slot, isHost: room.host === email, nextSeq: room.nextSeq, createdAt: room.createdAt, updatedAt: room.updatedAt,
        progress: room.progress ?? null,
        members: members.sort((a, b) => a.slot - b.slot).map((m) => ({ slot: m.slot, name: m.name, starter: m.starter ?? null, left: !!m.left, saved: !!m.left && !!m.savedAt })),
      });
    }
    return out.sort((a, b) => b.updatedAt - a.updatedAt);
  },
});

// ---- live reads (staging-net): newer clients read everything through these, as Convex WebSocket subscriptions ----
// A subscription re-runs when a document it read changes, and its client only hears about it when the result changed.
// So each one reads as little as it can and returns only what its client needs:
//   coop:head      the room and its members, without what changes per action (nextSeq, updatedAt) or per keepalive
//                  (lastSeen): status, seats, starters, ready, left / saved, ascension, progress. Changes rarely.
//   coop:feed      the actions after a cursor; never reads the room. The client subscribes again from its newest seq
//                  after every delivery, so a result is just the new actions (usually none).
//   coop:presence  everyone's keepalive row (coopPresence, written by coop:alive): about twice a minute per player,
//                  and at once on a real change (tab hidden / shown, reconnect, goodbye).
//   coop:sketch    one player's map sketch; for my own slot (wiped) only whether a partner's ERASE wiped mine.
//   coop:mineLive  my REJOIN list, without the fields every action changes.
// Older clients keep polling coop:since / coop:room and beating coop:heartbeat: all of those still work as before.
const FEED_MAX = 200;
const FEED_MAX_BYTES = 1_000_000; // a backlog (a reconnect, a long log) arrives in pages of this size

// My membership without reading the room document (which every posted action rewrites).
async function memberOrThrow(ctx: QueryCtx, roomId: Id<"coopRooms">) {
  const user = await requireUser(ctx);
  const email = normEmail(user.email);
  const me = await ctx.db.query("coopMembers").withIndex("by_room_email", (q) => q.eq("roomId", roomId).eq("email", email)).first();
  if (!me) throw new Error("Room not found");
  return { user, email, me };
}

// The member fields coop:head shows (memberCore without sketchV: sketches come through coop:sketch).
function memberHead(m: Member) {
  const { sketchV: _v, ...rest } = memberCore(m);
  return rest;
}

// -> { room: { _id, code, status, host (slot), ascension, world, seed, createdAt, gameVersion, progress, maxPlayers },
//      members: [{ slot, name, starter, ascMax, ready, left, saved, maxPlayers, net }], me, isHost }
export const head = query({
  args: { roomId: v.id("coopRooms") },
  handler: async (ctx, { roomId }) => {
    const { room, me } = await myMembership(ctx, roomId);
    const members = (await membersOf(ctx, roomId)).sort((a, b) => a.slot - b.slot);
    return { room: roomCore(room, members), members: members.map(memberHead), me: me.slot, isHost: me.email === room.host };
  },
});

// -> { actions: [{ seq, p, json }] (seq > after, in order), more } (more: a page limit was hit, ask again from the last seq)
export const feed = query({
  args: { roomId: v.id("coopRooms"), after: v.number() },
  handler: async (ctx, { roomId, after }) => {
    await memberOrThrow(ctx, roomId);
    const from = Number.isFinite(after) ? Math.max(0, Math.floor(after)) : 0;
    const actions: { seq: number; p: number; json: string }[] = [];
    let bytes = 0, more = false;
    for await (const a of ctx.db.query("coopActions").withIndex("by_room_seq", (q) => q.eq("roomId", roomId).gt("seq", from))) {
      if (actions.length >= FEED_MAX || (actions.length && bytes + a.json.length > FEED_MAX_BYTES)) { more = true; break; }
      actions.push({ seq: a.seq, p: a.p, json: a.json });
      bytes += a.json.length;
    }
    return { actions, more };
  },
});

// -> [{ slot, lastSeen, hb, gone? }] (lastSeen: server time of their last keepalive; hb: how often they send one)
export const presence = query({
  args: { roomId: v.id("coopRooms") },
  handler: async (ctx, { roomId }) => {
    await memberOrThrow(ctx, roomId);
    return (await presenceOf(ctx, roomId)).sort((a, b) => a.slot - b.slot)
      .map((p) => ({ slot: p.slot, lastSeen: p.lastSeen, hb: p.hb ?? HB_LEGACY, ...(p.gone ? { gone: true } : {}) }));
  },
});

// The keepalive of newer clients: my coopPresence row only (coop:head and coop:feed never read it). hb: how often I
// send one (longer in a hidden tab); net: the wire protocol I speak; gone: I am leaving (tab closed): offline at once.
// Like a heartbeat it brings me back from "left" in a run in progress. -> { now } (the server clock, for presence ages)
export const alive = mutation({
  args: { roomId: v.id("coopRooms"), hb: v.optional(v.number()), net: v.optional(v.number()), gone: v.optional(v.boolean()), seq: v.optional(v.number()) },
  handler: async (ctx, { roomId, hb, net, gone, seq }) => {
    const { room, me } = await myMembership(ctx, roomId);
    const now = Date.now();
    const hbMs = !gone && hb !== undefined && Number.isFinite(hb) ? Math.max(1000, Math.min(120_000, Math.floor(hb))) : undefined;
    const lastSeq = seq !== undefined && Number.isFinite(seq) ? Math.max(0, Math.min(Math.floor(seq), room.nextSeq - 1)) : undefined;
    const mine = await ctx.db.query("coopPresence").withIndex("by_member", (q) => q.eq("memberId", me._id)).first();
    if (mine) {
      await ctx.db.patch(mine._id, { lastSeen: now, slot: me.slot, hb: hbMs, gone: gone ? true : undefined, ...(lastSeq !== undefined ? { lastSeq } : {}) });
    } else {
      await ctx.db.insert("coopPresence", {
        roomId, memberId: me._id, slot: me.slot, lastSeen: now, lastSeq: lastSeq ?? me.lastSeq,
        ...(hbMs !== undefined ? { hb: hbMs } : {}), ...(gone ? { gone: true } : {}),
      });
    }
    const patch: Partial<Member> = {};
    if (!gone && me.left && room.status === "playing") { patch.left = false; patch.savedAt = undefined; }
    const netV = net !== undefined && Number.isInteger(net) && net >= 1 && net <= NET_MAX ? net : undefined;
    if (netV !== undefined && me.net !== netV) patch.net = netV;
    if (Object.keys(patch).length) await ctx.db.patch(me._id, patch);
    return { now };
  },
});

// -> { slot, sketch (JSON or null) }; with wiped: { slot, wiped } (true while a partner's ERASE left that sketch empty)
export const sketch = query({
  args: { roomId: v.id("coopRooms"), slot: v.number(), wiped: v.optional(v.boolean()) },
  handler: async (ctx, { roomId, slot, wiped }) => {
    await memberOrThrow(ctx, roomId);
    const m = await ctx.db.query("coopMembers").withIndex("by_room", (q) => q.eq("roomId", roomId).eq("slot", slot)).first();
    const row = m ? await ctx.db.query("coopSketches").withIndex("by_member", (q) => q.eq("memberId", m._id)).first() : null;
    const sk = row ? row.sketch : m?.sketch;
    if (wiped) return { slot, wiped: sk === "" };
    return { slot, sketch: sk || null };
  },
});

// My REJOIN list (coop:mine without nextSeq / updatedAt / createdAt, which every action changes), newest first.
export const mineLive = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const email = normEmail(user.email);
    const now = Date.now();
    const mems = await ctx.db.query("coopMembers").withIndex("by_email", (q) => q.eq("email", email).gt("joinedAt", now - KEEP_RUNS - 7 * DAY)).order("desc").take(50);
    const out = [];
    for (const me of mems) {
      if (me.dismissed) continue;
      const room = await ctx.db.get(me.roomId);
      if (!room || room.status === "closed" || room.updatedAt < now - (room.status === "playing" ? KEEP_RUNS : DAY)) continue;
      const members = await membersOf(ctx, room._id);
      out.push({
        at: room.updatedAt,
        row: {
          roomId: room._id, code: room.code, status: room.status, ascension: room.ascension, world: room.world,
          slot: me.slot, isHost: room.host === email, progress: room.progress ?? null,
          members: members.sort((a, b) => a.slot - b.slot).map((m) => ({ slot: m.slot, name: m.name, starter: m.starter ?? null, left: !!m.left, saved: !!m.left && !!m.savedAt })),
        },
      });
    }
    return out.sort((a, b) => b.at - a.at).map((x) => x.row);
  },
});

// ---- one-off data moves (internal: `npx convex run coop:migrateNet '{}'`, repeat with the returned cursor) ----------
// Moves map sketches out of coopMembers into coopSketches, and inline checkpoint states into coopCheckpointStates, so
// rooms from before keep their reads small too. Safe to run any number of times, alongside any client.
export const migrateNet = internalMutation({
  args: { table: v.optional(v.union(v.literal("coopMembers"), v.literal("coopCheckpoints"))), cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, { table = "coopMembers", cursor = null }) => {
    let moved = 0;
    if (table === "coopMembers") {
      const page = await ctx.db.query("coopMembers").paginate({ numItems: 100, cursor });
      for (const m of page.page) {
        if (m.sketch === undefined) continue;
        const row = await ctx.db.query("coopSketches").withIndex("by_member", (q) => q.eq("memberId", m._id)).first();
        if (!row) await ctx.db.insert("coopSketches", { roomId: m.roomId, memberId: m._id, sketch: m.sketch });
        await ctx.db.patch(m._id, { sketch: undefined });
        moved++;
      }
      return { table, moved, cursor: page.isDone ? null : page.continueCursor, done: page.isDone };
    }
    const page = await ctx.db.query("coopCheckpoints").paginate({ numItems: 20, cursor });
    for (const c of page.page) {
      if (!c.state || c.stateId) continue;
      const stateId = await ctx.db.insert("coopCheckpointStates", { roomId: c.roomId, state: c.state });
      await ctx.db.patch(c._id, { state: "", stateId });
      moved++;
    }
    return { table, moved, cursor: page.isDone ? null : page.continueCursor, done: page.isDone };
  },
});
