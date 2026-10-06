// Co-op for 3-4 players: the server side (convex/coop.ts), against the DEV Convex deployment (never prod).
// Four accounts: E2E_P1_EMAIL (P1) + three throwaway test accounts. Tokens are minted with the dev JWT key.
// Covers: old 2-player clients (no maxPlayers) keep the exact 2-player behaviour, also in a room with new clients;
// new clients fill 4 seats; start renumbers seats; 4 senders post into one ordered log; ERASE wipes every sketch;
// a room is deleted only once all four players deleted it.
// Needs dev functions pushed from this branch and COOP_TEST=1 on dev (see tests/coop_auth.cjs).
// Usage: node tests/coop4_server.test.cjs
const A = require('./coop_auth.cjs');

const EMAILS = [A.P1_EMAIL, A.P2_EMAIL, 'coop-third@kanto-spire.test', 'coop-fourth@kanto-spire.test', 'coop-fifth@kanto-spire.test'];
const NAMES = [null, A.P2_NAME, 'THIRD', 'FOURTH', 'FIFTH'];
let passes = 0, fails = 0;
const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (cond) passes++; else { fails++; process.exitCode = 1; } };
async function refused(p, re, msg) {
  try { await p; ok(false, `${msg} (no error)`); }
  catch (e) { ok(!re || re.test(e.message), `${msg} (${e.message.split('\n')[0].slice(0, 90)})`); }
}

(async () => {
  console.log(`co-op 3-4 player server test against ${A.CONVEX_URL}`);
  for (let i = 1; i < EMAILS.length; i++) A.ensureTestUser(EMAILS[i], NAMES[i]);
  const tokens = await Promise.all(EMAILS.map(e => A.mintToken(e)));
  const c = tokens.map(t => (k, f, a) => A.callConvex(t, k, f, a));
  const rooms = [];
  try {
    // ---- old clients (no maxPlayers): exactly the 2-player rules
    {
      const { roomId, code } = await c[0]('mutation', 'coop:create', { ascension: 0, world: 'kanto' }); rooms.push(roomId);
      const j = await c[1]('mutation', 'coop:join', { code });
      ok(j.slot === 1, 'old clients: the second player gets slot 1');
      await refused(c[2]('mutation', 'coop:join', { code }), /Room is full/, 'old clients: a third (old) player: Room is full');
      await refused(c[2]('mutation', 'coop:join', { code, maxPlayers: 4 }), /Room is full/, 'old clients: even a new client can\'t make it a 3-player room');
      const v = await c[0]('query', 'coop:room', { roomId });
      ok(v.room.maxPlayers === 2 && v.members.every(m => m.maxPlayers === 2), 'the room view says 2 seats');
      await c[0]('mutation', 'coop:setStarter', { roomId, starter: 'BULBASAUR', ascMax: 0 });
      await c[1]('mutation', 'coop:setStarter', { roomId, starter: 'SQUIRTLE', ascMax: 0 });
      await c[0]('mutation', 'coop:start', { roomId });
      const s = await c[1]('query', 'coop:since', { roomId, after: 0 });
      const init = JSON.parse(s.actions[0].json);
      ok(JSON.stringify(init.starters) === '["BULBASAUR","SQUIRTLE"]' && init.names.length === 2, 'old clients: a 2-player init');
    }
    // ---- a new host + an old joiner: the room stays at 2 seats; the old player reloading (new client) opens it
    {
      const { roomId, code } = await c[0]('mutation', 'coop:create', { ascension: 0, world: 'kanto', maxPlayers: 4 }); rooms.push(roomId);
      await c[1]('mutation', 'coop:join', { code }); // old client
      await refused(c[2]('mutation', 'coop:join', { code, maxPlayers: 4 }), /Room is full/, 'mixed: an old client in the room keeps it at 2 seats');
      ok((await c[0]('query', 'coop:room', { roomId })).room.maxPlayers === 2, 'mixed: the view says 2 seats');
      await c[1]('mutation', 'coop:join', { code, maxPlayers: 4 }); // the same player, now on the new client (REJOIN)
      ok((await c[0]('query', 'coop:room', { roomId })).room.maxPlayers === 4, 'mixed: after that player reloads, 4 seats');
      const j3 = await c[2]('mutation', 'coop:join', { code, maxPlayers: 4 });
      ok(j3.slot === 2, 'mixed: now a third player joins (slot 2)');
    }
    // ---- four new clients
    let room4;
    {
      const { roomId, code } = await c[0]('mutation', 'coop:create', { ascension: 0, world: 'kanto', maxPlayers: 4 }); rooms.push(roomId); room4 = roomId;
      const slots = [];
      for (const i of [1, 2, 3]) slots.push((await c[i]('mutation', 'coop:join', { code, maxPlayers: 4 })).slot);
      ok(JSON.stringify(slots) === '[1,2,3]', `four players: slots 0-3 (${slots})`);
      await refused(c[4]('mutation', 'coop:join', { code, maxPlayers: 4 }), /Room is full/, 'a fifth player: Room is full');
      await refused(c[0]('mutation', 'coop:join', { code: 'ZZZZZ', maxPlayers: 4 }), /Room not found/, 'bad code still: Room not found');
      // P2 leaves the lobby (a gap at slot 1), a new player takes the first free slot
      await c[1]('mutation', 'coop:leave', { roomId });
      const j5 = await c[4]('mutation', 'coop:join', { code, maxPlayers: 4 });
      ok(j5.slot === 1, `a newcomer takes the first free seat (slot ${j5.slot})`);
      await c[4]('mutation', 'coop:leave', { roomId });
      // start with three (seats 0, 2, 3 -> renumbered 0, 1, 2)
      for (const [i, sp] of [[0, 'BULBASAUR'], [2, 'CHARMANDER'], [3, 'SQUIRTLE']]) await c[i]('mutation', 'coop:setStarter', { roomId, starter: sp, ascMax: 0 });
      await refused(c[2]('mutation', 'coop:start', { roomId }), /host/, 'only the host starts');
      await c[0]('mutation', 'coop:start', { roomId });
      const v = await c[3]('query', 'coop:room', { roomId });
      ok(JSON.stringify(v.members.map(m => m.slot)) === '[0,1,2]' && v.me === 2, `start renumbers the seats 0..2 (me=${v.me})`);
      const init = JSON.parse((await c[2]('query', 'coop:since', { roomId, after: 0 })).actions[0].json);
      ok(JSON.stringify(init.starters) === '["BULBASAUR","CHARMANDER","SQUIRTLE"]' && init.names.length === 3, `init lists the three players in seat order (${init.starters})`);
      await refused(c[1]('mutation', 'coop:join', { code, maxPlayers: 4 }), /Room not found|full/, 'nobody joins a started room');
      // all three post at once: one ordered log, p = the sender's seat
      const posts = await Promise.all([0, 2, 3].map((i, k) => c[i]('mutation', 'coop:post', { roomId, action: JSON.stringify({ type: 'vote', node: 'n' + k, nonce: `race-${k}` }) })));
      const seqs = posts.map(p => p.seq).sort((a, b) => a - b);
      ok(JSON.stringify(seqs) === '[2,3,4]', `three simultaneous posts get seqs 2, 3, 4 (${seqs})`);
      const s = await c[0]('query', 'coop:since', { roomId, after: 1 });
      const bySeq = s.actions.map(a => [a.seq, a.p, JSON.parse(a.json).nonce]);
      ok(bySeq.every(([, p, n]) => p === +n.split('-')[1]), `each action carries its sender's seat ${JSON.stringify(bySeq)}`);
      const dup = await c[3]('mutation', 'coop:post', { roomId, action: JSON.stringify({ type: 'vote', node: 'n2', nonce: 'race-2' }) });
      ok(dup.duplicate === true, 'a retried post (same nonce) is not added twice');
      // sketches: ERASE wipes every other player's sketch
      for (const i of [0, 2, 3]) await c[i]('mutation', 'coop:setSketch', { roomId, sketch: JSON.stringify({ act: 0, strokes: [[1, 2, 3, 4]] }) });
      await c[2]('mutation', 'coop:setSketch', { roomId, sketch: JSON.stringify({ act: 0, strokes: [] }), all: true });
      const sk = await c[0]('query', 'coop:sketches', { roomId });
      ok(sk.length === 3 && sk.every(m => !m.sketch || !JSON.parse(m.sketch).strokes.length), 'ERASE wipes all three sketches');
      // heartbeats: each seat's lastSeq
      for (const [i, q] of [[0, 4], [2, 3], [3, 2]]) await c[i]('mutation', 'coop:heartbeat', { roomId, seq: q });
      const hv = await c[0]('query', 'coop:room', { roomId });
      ok(JSON.stringify(hv.members.map(m => m.lastSeq)) === '[4,3,2]', 'heartbeats store every seat\'s lastSeq');
    }
    // ---- REJOIN list delete with 3 players: deleted for good only after all three
    {
      const r1 = await c[0]('mutation', 'coop:dismiss', { roomId: room4 });
      const r2 = await c[2]('mutation', 'coop:dismiss', { roomId: room4 });
      ok(!r1.deleted && !r2.deleted, 'two of three deleted it: the room is kept');
      const view = await c[3]('query', 'coop:room', { roomId: room4 });
      ok(view.members.filter(m => m.left).length === 2, 'the last player sees the other two as left');
      const r3 = await c[3]('mutation', 'coop:dismiss', { roomId: room4 });
      ok(r3.deleted === true, 'the third delete removes the room');
      await refused(c[3]('query', 'coop:room', { roomId: room4 }), /not found/i, 'the room is gone');
    }
  } catch (e) { ok(false, 'unexpected: ' + e.message); }
  finally { if (rooms.length) A.cleanupRooms(rooms.filter(Boolean)); }
  console.log(`\n${passes} passed, ${fails} failed`);
})();
