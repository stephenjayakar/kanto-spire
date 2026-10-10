// Co-op Pokédex repair: what each player of a co-op room saw and caught, from an exported room log, replayed with
// the game's own resume (web/src/game/coop/resume.js: the latest undisputed checkpoint + the actions after it, on
// whichever engine played them). Before v0.3.21 co-op never wrote to anyone's Pokédex; this rebuilds it.
//
//   node tools/coop_dex.mjs --actions tests/out/2frsu_actions.jsonl --ckpts tests/out/2frsu_ckpts.jsonl
//        [--slot 1] [--email someone@example.com] [--json]
//
// --actions / --ckpts: `npx convex data coopActions` / `coopCheckpoints` rows for the room (JSON lines; the action
// rows carry the action in .json, the checkpoints the snapshot in .state). Either may be a tail of the log as long
// as the checkpoint covers what comes before it (a run keeps its whole seen / caught history, so the latest
// checkpoint is enough). Prints each player's lists; with --slot and --email, the matching mergeDex command:
//   npx convex run migrations:mergeDex '{"email":"...","seen":[...],"caught":[...]}'          (dry run)
//   npx convex run migrations:mergeDex '{"email":"...","seen":[...],"caught":[...],"apply":true}' [--prod]
// Run from the repo root (it reads web/assets/data).
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadData } from '../web/src/game/data.js';
import { resumeRoom } from '../web/src/game/coop/resume.js';
import { coopDex } from '../web/src/game/coop/dex.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d = null) => { const i = process.argv.indexOf('--' + k); return i < 0 ? d : (process.argv[i + 1] ?? true); };
const flag = (k) => process.argv.includes('--' + k);
const lines = (f) => (f ? fs.readFileSync(f, 'utf8').split('\n').map(l => l.trim()).filter(Boolean).map(l => JSON.parse(l)) : []);

export async function roomDex({ actionRows, ckptRows }) {
  const dataLoader = async f => JSON.parse(fs.readFileSync(path.join(root, 'web/assets/data', f), 'utf8'));
  await loadData(dataLoader);
  const actions = actionRows.map(a => ({ ...(typeof a.json === 'string' ? JSON.parse(a.json) : a), seq: a.seq, p: a.p })).sort((a, b) => a.seq - b.seq);
  const cks = ckptRows.filter(c => !c.disputed).sort((a, b) => b.seq - a.seq);
  const r = await resumeRoom({ checkpoint: cks[0] || null, actions, dataLoader });
  const g = r.game;
  if (!g) throw new Error('replay failed: ' + (r.error || r.mode));
  const players = g.runs.map((run, p) => ({ slot: p, name: g.names?.[p] ?? `P${p + 1}`, starter: run?.starter, ...coopDex(g, p) }));
  return { mode: r.mode, engine: r.engine, seq: r.seq ?? g.seq, phase: g.phase, result: g.result, act: (g.world?.actIndex ?? 0) + 1, players };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const actionsFile = arg('actions'), ckptsFile = arg('ckpts');
  if (!actionsFile && !ckptsFile) { console.error('usage: node tools/coop_dex.mjs --actions <rows.jsonl> --ckpts <rows.jsonl> [--slot N] [--email E] [--json]'); process.exit(2); }
  const out = await roomDex({ actionRows: lines(actionsFile), ckptRows: lines(ckptsFile) });
  const slot = arg('slot'), email = arg('email');
  const players = slot == null ? out.players : out.players.filter(p => p.slot === Number(slot));
  if (flag('json')) { console.log(JSON.stringify({ ...out, players }, null, 1)); process.exit(0); }
  console.log(`replay: ${out.mode} on ${out.engine}, seq ${out.seq}, phase ${out.phase}${out.result ? ' (' + out.result + ')' : ''}, act ${out.act}`);
  for (const p of players) {
    console.log(`\nP${p.slot + 1} ${p.name} (slot ${p.slot}, ${p.starter}): seen ${p.seen.length}, caught ${p.caught.length}`);
    console.log('  seen:   ' + p.seen.join(' '));
    console.log('  caught: ' + p.caught.join(' '));
    if (email && typeof email === 'string') {
      const a = JSON.stringify({ email, seen: p.seen, caught: p.caught });
      console.log(`\n  dry run:  npx convex run migrations:mergeDex '${a}'`);
      console.log(`  apply:    npx convex run migrations:mergeDex '${a.slice(0, -1)},"apply":true}' --prod`);
    }
  }
}
