// Co-op Pokédex: what one player of a co-op game has seen and caught, for their own meta.dexSeen / dexCaught.
// Read-only over a CoopGame (current or frozen engine): nothing here is part of the reducer or the checksum, so it
// is not game logic and never changes co-op replay. Used by the session (scenes/coop/session.js, the local player's
// meta after every batch of actions) and by tools/coop_dex.mjs (repairing past co-op runs from an exported log).
//
// The solo rules, per player: seen = met in battle (Run.afterBattle adds a battle's foes to run.seen in each
// player's own reward screen, Run.addSeen), caught = caught (or received) by that player (run.caughtSpecies). A
// partner's catch is "seen" for you because you met it in the same duo battle. On top of the run's own lists, the
// battle on screen (or the one that ended the run, which has no reward screen) counts its foes that have been on
// the field.
export function coopDex(g, p) {
  const run = g?.runs?.[p];
  const seen = new Set(), caught = new Set();
  if (!run) return { seen: [], caught: [] };
  for (const s of run.caughtSpecies || []) { caught.add(s); seen.add(s); }
  for (const s of run.seen || []) seen.add(s);
  const d = g.battle;
  if (d && Array.isArray(d.enemies) && !g.away?.[p] && !d.away?.[p]) {
    d.enemies.forEach((e, i) => {
      const met = !Array.isArray(d.gone) || d.gone[i] != null || (Array.isArray(d.field) && d.field.includes(i));
      if (met && e?.species) seen.add(e.species);
    });
  }
  return { seen: [...seen], caught: [...caught] };
}

// Adds player p's co-op dex to a meta object (never removes). -> the number of entries added.
export function recordCoopDex(meta, g, p) {
  if (!meta) return 0;
  const { seen, caught } = coopDex(g, p);
  return mergeDexLists(meta, seen, caught);
}

export function mergeDexLists(meta, seen = [], caught = []) {
  meta.dexSeen = Array.isArray(meta.dexSeen) ? meta.dexSeen : [];
  meta.dexCaught = Array.isArray(meta.dexCaught) ? meta.dexCaught : [];
  let added = 0;
  for (const s of [...seen, ...caught]) if (typeof s === 'string' && s && !meta.dexSeen.includes(s)) { meta.dexSeen.push(s); added++; }
  for (const s of caught) if (typeof s === 'string' && s && !meta.dexCaught.includes(s)) { meta.dexCaught.push(s); added++; }
  return added;
}
