// coop:create must succeed for every world the client can pick.
// v0.6.5 prod bug: v0.6.0 added the SINNOH worlds (spire_ks / spire_sinnoh / spire_all) to coop.ts's
// argument validator but not to schema.ts's coopRooms.world, so every create for those worlds threw
// "Server Error" on insert.
// 1. Static (always): convex/schema.ts COOP_WORLDS covers regions.js COOP_WORLDS, and the coopRooms
//    table and coop.ts's args both use that one validator.
// 2. Live (dev deployment only; skip with STATIC_ONLY=1): creates a room in every world, then cleans up.
//    Needs dev functions pushed (`npx convex dev --once`) and COOP_TEST=1 on dev (see tests/coop_auth.cjs).
// Usage: node tests/coop_create.test.cjs
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

let passes = 0, fails = 0;
const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (cond) passes++; else { fails++; process.exitCode = 1; } };
const root = path.join(__dirname, '..');

(async () => {
  const schema = fs.readFileSync(path.join(root, 'convex/schema.ts'), 'utf8');
  const coop = fs.readFileSync(path.join(root, 'convex/coop.ts'), 'utf8');
  const m = /export const COOP_WORLDS = \[([^\]]*)\]/.exec(schema);
  ok(!!m, 'schema.ts exports COOP_WORLDS');
  const serverWorlds = m ? [...m[1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]) : [];
  const { COOP_WORLDS } = await import(pathToFileURL(path.join(root, 'web/src/game/regions.js')).href);
  for (const w of COOP_WORLDS) ok(serverWorlds.includes(w), `schema accepts client world "${w}"`);
  const table = /coopRooms: defineTable\(\{[\s\S]*?\n  \}\)/.exec(schema);
  ok(!!table && /world: coopWorldValidator/.test(table[0]), 'coopRooms.world uses coopWorldValidator');
  ok(/const worldV = coopWorldValidator/.test(coop), 'coop.ts args use coopWorldValidator');

  if (!process.env.STATIC_ONLY) {
    const A = require('./coop_auth.cjs');
    console.log(`live coop:create against ${A.CONVEX_URL}`);
    A.ensureTestUser(A.P2_EMAIL, A.P2_NAME);
    const [token, token2] = await Promise.all([A.mintToken(A.P1_EMAIL), A.mintToken(A.P2_EMAIL)]);
    const rooms = [];
    // the ways a typed code can arrive: as shown, lowercase, with a separator (the server normalizes all three)
    const typed = [(c) => c, (c) => c.toLowerCase(), (c) => `${c.slice(0, 2)}-${c.slice(2)}`];
    let n = 0;
    try {
      for (const world of COOP_WORLDS) {
        for (const nuzlocke of [false, true]) {
          let r;
          try {
            r = await A.callConvex(token, 'mutation', 'coop:create', { ascension: 10, world, nuzlocke });
            rooms.push(r.roomId);
            const v = await A.callConvex(token, 'query', 'coop:room', { roomId: r.roomId });
            ok(v.room.world === world && v.room.status === 'lobby', `coop:create world=${world} nuzlocke=${nuzlocke} -> ${r.code}`);
          } catch (e) { ok(false, `coop:create world=${world} nuzlocke=${nuzlocke} (${e.message})`); continue; }
          // join by typed code: P2 lands in the room as slot 1 and sees the room's settings
          const code = typed[n++ % typed.length](r.code);
          try {
            const j = await A.callConvex(token2, 'mutation', 'coop:join', { code, maxPlayers: 4 });
            const v2 = await A.callConvex(token2, 'query', 'coop:room', { roomId: j.roomId });
            const v1 = await A.callConvex(token, 'query', 'coop:room', { roomId: r.roomId });
            ok(j.roomId === r.roomId && j.slot === 1 && v2.me === 1 && !v2.isHost && v2.room.world === world && v1.members.length === 2,
              `coop:join "${code}" (world=${world}) -> slot ${j.slot}, host sees ${v1.members.length} members`);
          } catch (e) { ok(false, `coop:join "${code}" (world=${world}) (${e.message})`); }
        }
      }
    } finally {
      A.cleanupRooms(rooms);
    }
  }
  console.log(`\n${passes} passed, ${fails} failed`);
})().catch((e) => { console.error(e); process.exitCode = 1; });
