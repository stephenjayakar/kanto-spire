import { defineSchema, defineTable } from "convex/server";
import { authTables } from "@convex-dev/auth/server";
import { v } from "convex/values";

export const resultValidator = v.union(v.literal("win"), v.literal("lose"), v.literal("postgame"));

export default defineSchema({
  ...authTables,

  // Who may sign in and play. Managed with `npx convex run access:allow` (internal functions only).
  allowedEmails: defineTable({
    email: v.string(), // lowercase
    note: v.optional(v.string()),
    addedAt: v.number(),
    admin: v.optional(v.boolean()), // may make invite links
  }).index("by_email", ["email"]),

  // One-time invite links (?invite=CODE): the first account to sign in with one joins allowedEmails.
  invites: defineTable({
    code: v.string(),
    createdBy: v.string(),
    note: v.optional(v.string()),
    createdAt: v.number(),
    expiresAt: v.number(),
    usedBy: v.optional(v.string()),
    usedAt: v.optional(v.number()),
  }).index("by_code", ["code"]),

  // The game's extracted ROM assets, packed into a few files and served only to allowed accounts.
  assetPacks: defineTable({
    name: v.string(),
    storageId: v.id("_storage"),
    hash: v.string(), // sha256 of the pack, also the client's cache key
    size: v.number(),
    uploadedAt: v.number(),
  }).index("by_name", ["name"]),

  // A trainer: one per signed-in Google account.
  players: defineTable({
    userId: v.id("users"),
    email: v.optional(v.string()), // lowercase; the save/record key (survives auth account changes)
    name: v.string(),
    nameLower: v.string(),
    createdAt: v.number(),
    runs: v.number(),
    wins: v.number(),
    bestScore: v.number(),
    // NOW PLAYING (players:presence / players:nowPlaying): a heartbeat about once a minute while in a run
    lastSeen: v.optional(v.number()), // unset when they leave the run (or never played on a client that sends it)
    activity: v.optional(v.string()), // short label, e.g. "ACT 2 TORCHIC" or "CO-OP ACT 3"
    activityRoom: v.optional(v.string()), // co-op room code (checked membership): groups partners, never sent out
  })
    .index("by_userId", ["userId"])
    .index("by_email", ["email"])
    .index("by_nameLower", ["nameLower"])
    .index("by_bestScore", ["bestScore"])
    .index("by_lastSeen", ["lastSeen"]),

  // Save data per account: meta-progression (unlocks, ascension, Pokédex, history) and the run in progress.
  progress: defineTable({
    userId: v.id("users"),
    email: v.optional(v.string()), // lowercase; the save key
    meta: v.string(), // JSON
    run: v.union(v.string(), v.null()), // JSON, null when no run is in progress
    updatedAt: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_email", ["email"]),

  // The full log of a finished run (battles, picks, purchases, events), for balance analysis.
  runLogs: defineTable({
    playerId: v.id("players"),
    playerName: v.string(),
    clientRunId: v.string(),
    log: v.string(), // JSON from Run.finishLog()
    result: v.string(),
    world: v.string(),
    ascension: v.number(),
    version: v.optional(v.string()), // game version the run was played on (e.g. "v0.0.2")
    createdAt: v.number(),
  })
    .index("by_player_clientRunId", ["playerId", "clientRunId"])
    .index("by_createdAt", ["createdAt"])
    .index("by_version_createdAt", ["version", "createdAt"]),

  // One finished run (win, loss or post-game clear).
  runs: defineTable({
    playerId: v.id("players"),
    playerName: v.string(),
    clientRunId: v.string(), // dedupes retries from the offline queue
    score: v.number(),
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
    version: v.optional(v.string()), // game version the run was played on (e.g. "v0.0.2"); older rows were backfilled to v0.0.1
    regions: v.optional(v.string()), // v0.1.0 spire runs (world "spire"): the act regions, e.g. "K-H-H-K"
    // a co-op run (one row per room, owned by the host): its room code, the partners' names, every player's starter
    coop: v.optional(v.object({
      room: v.string(), with: v.array(v.string()), starters: v.optional(v.array(v.string())),
      parties: v.optional(v.array(v.array(v.object({ species: v.string(), level: v.number(), shiny: v.boolean() })))), // v0.3.18: every player's whole team, host first
    })),
  })
    .index("by_score", ["score"])
    .index("by_finishedAt", ["finishedAt"])
    .index("by_world_finishedAt", ["world", "finishedAt"])
    .index("by_version_finishedAt", ["version", "finishedAt"])
    .index("by_version_world_finishedAt", ["version", "world", "finishedAt"])
    .index("by_version_score", ["version", "score"])
    .index("by_version_world_score", ["version", "world", "score"])
    .index("by_player_version_finishedAt", ["playerId", "version", "finishedAt"])
    .index("by_player_version_score", ["playerId", "version", "score"])
    .index("by_world_score", ["world", "score"])
    .index("by_player_finishedAt", ["playerId", "finishedAt"])
    .index("by_player_score", ["playerId", "score"])
    .index("by_player_clientRunId", ["playerId", "clientRunId"]),

  // ---- online co-op, 2-4 players (convex/coop.ts) ----
  // A room: a lobby that becomes one shared run; the run itself is the ordered action log below.
  coopRooms: defineTable({
    code: v.string(), // 5 chars, shared with the partner
    status: v.union(v.literal("lobby"), v.literal("playing"), v.literal("closed")),
    host: v.string(), // host email (lowercase); never sent to the partner
    ascension: v.number(),
    // v0.1.0: "spire" (KANTO + HOENN acts) / "spire_kanto" (a host without HOENN yet) / v0.1.1 "spire_johto" (all three); older rooms kanto / hoenn
    world: v.union(v.literal("kanto"), v.literal("hoenn"), v.literal("spire"), v.literal("spire_kanto"), v.literal("spire_johto")),
    seed: v.string(),
    nextSeq: v.number(), // seq the next action gets
    gameVersion: v.optional(v.string()), // v0.3.6+: the game version that created the room (e.g. "v0.3.6")
    engine: v.optional(v.string()), // v0.3.6+: the game-logic id it was created on (web/src/game/coop/engines.js LOGIC_ID)
    progress: v.optional(v.string()), // v0.3.6+: where the latest checkpoint is, for the REJOIN list (e.g. "ACT 3")
    result: v.optional(resultValidator), // how the run ended (set when the room closes after a win or a wipe)
    createdAt: v.number(),
    updatedAt: v.number(), // last create/join/start/post
  }).index("by_code", ["code"]),

  // One row per player in a room (max 4, slot 0 = host).
  coopMembers: defineTable({
    roomId: v.id("coopRooms"),
    userId: v.id("users"),
    email: v.string(), // lowercase
    slot: v.number(), // 0..3
    name: v.string(),
    starter: v.optional(v.string()),
    ascMax: v.optional(v.number()), // the ascension this player has unlocked with that starter (caps the room)
    sketch: v.optional(v.string()), // map sketch JSON { act, strokes } (a side channel, not part of the game log)
    sketchV: v.optional(v.number()), // bumped on every change (the poll carries it; clients fetch on change)
    ready: v.boolean(),
    left: v.optional(v.boolean()), // left a playing room (may rejoin)
    dismissed: v.optional(v.boolean()), // deleted the room from their REJOIN list (rejoining by code undoes it)
    maxPlayers: v.optional(v.number()), // the room size this player's client supports (2-4); unset = an older 2-player client
    savedAt: v.optional(v.number()), // v0.3.6: last SAVE & QUIT (shown to the others while they are away)
    net: v.optional(v.number()), // the co-op wire protocol this player's client speaks (sent with its heartbeat; unset = older client)
    joinedAt: v.number(),
    lastSeen: v.number(), // (since coopPresence: only set by joins / lobby picks; heartbeats go to coopPresence)
    lastSeq: v.number(), // last action seq this player's client applied (likewise, see coopPresence)
  })
    .index("by_room", ["roomId", "slot"])
    .index("by_room_email", ["roomId", "email"])
    .index("by_email", ["email", "joinedAt"]),

  // Heartbeats, one row per member: kept out of coopMembers so a heartbeat doesn't change what the room view reads
  // (coop:watch subscriptions only re-run when the room, its members or its log change).
  coopPresence: defineTable({
    roomId: v.id("coopRooms"),
    memberId: v.id("coopMembers"),
    slot: v.number(),
    lastSeen: v.number(),
    lastSeq: v.number(),
    hb: v.optional(v.number()), // the sender's heartbeat interval (ms); unset = an older client (every 5 s)
  })
    .index("by_room", ["roomId"])
    .index("by_member", ["memberId"]),

  // Map sketches, one row per member (they used to live in coopMembers.sketch, which made every member read big).
  coopSketches: defineTable({
    roomId: v.id("coopRooms"),
    memberId: v.id("coopMembers"),
    sketch: v.string(), // JSON { act, strokes }, or "" after an ERASE
  })
    .index("by_room", ["roomId"])
    .index("by_member", ["memberId"]),

  // The lockstep action log: seq 1, 2, 3... per room, assigned by the server.
  coopActions: defineTable({
    roomId: v.id("coopRooms"),
    seq: v.number(),
    p: v.number(), // sender slot (-1 = server, for the init action)
    type: v.string(),
    nonce: v.string(),
    json: v.string(), // the action payload as JSON (without seq/p)
    createdAt: v.number(),
  })
    .index("by_room_seq", ["roomId", "seq"])
    .index("by_room_nonce", ["roomId", "nonce"]),

  // v0.3.6 co-op checkpoints: the whole game at a safe point (the map, between nodes), written by the clients
  // (web/src/game/coop/snapshot.js). A room resumes from its latest one plus the actions after it, also after a
  // game update (the log alone only replays on the logic it was played on). The latest few per room are kept.
  coopCheckpoints: defineTable({
    roomId: v.id("coopRooms"),
    seq: v.number(), // the log position the state is at (the game's seq)
    phase: v.string(), // "map"
    state: v.string(), // snapshot JSON
    checksum: v.number(), // CoopGame.checksum() of the state, by the writer's code
    gameVersion: v.optional(v.string()), // e.g. "v0.3.6"
    engine: v.optional(v.string()), // the writer's game-logic id (LOGIC_ID)
    reason: v.optional(v.string()), // "auto" | "save" | "resume" | "legacy" | "fallback"
    slots: v.array(v.number()), // the players whose client wrote this same checkpoint (same checksum)
    disputed: v.optional(v.boolean()), // two clients wrote different states for this seq: never loaded
    // newer rows keep the snapshot in coopCheckpointStates (state is ""), so checking or confirming a checkpoint reads
    // a few hundred bytes, not the whole game. No state and no stateId: confirmed by checksum only so far (not loadable).
    stateId: v.optional(v.id("coopCheckpointStates")),
    createdAt: v.number(),
  }).index("by_room_seq", ["roomId", "seq"]),

  // The snapshot JSON of a coopCheckpoints row (see stateId).
  coopCheckpointStates: defineTable({
    roomId: v.id("coopRooms"),
    state: v.string(),
  }).index("by_room", ["roomId"]),
});
