// Boss gauntlet: playtests every boss fight directly (no full run), solo and in co-op with 2, 3 and 4 players, and
// flags bosses that stall, can't be killed, sit far off their peers or stop scaling in co-op (the v0.5.0 NORMAN bug:
// SLACK OFF checked every co-op player's hand against the team-sized HP pool, so he out-healed the whole team).
//
//   node tests/boss_gauntlet.mjs                       whole roster (95 fights), solo + 2p/3p/4p, 40 seeds: ~25 min, 4 workers
//   node tests/boss_gauntlet.mjs --boss NORMAN         one boss, ~30-45 s (substring of the id, comma-separated: --boss norman,lance)
//   node tests/boss_gauntlet.mjs --cat gym,e4          categories: gym e4 champ rival bird mythic legend post
//   options: --seeds 40  --modes solo,2,3,4  --cap 40 (turn cap = a stall)  --jobs 4  --label NAME  --json PATH
//            --root PATH (test another checkout's game code with these fixtures, e.g. an old commit; read-only)
//            --entryhp (keep the HP the team had walking in; default: full heal, so the boss alone is measured)
//            --baseline PATH / --nobaseline (default tests/boss_baseline.json: peers, typical co-op gap, regressions)
//            --save-baseline (whole roster only: write tests/boss_baseline.json from this run)
//            --report PATH (print a saved tests/out JSON again; with --save-baseline, make it the baseline)
//   fixtures: node tests/boss_gauntlet.mjs --harvest [--runs 960]  (re-sample the teams from smart-bot spire runs, ~4 min)
//   exit code 2 when any fight has a RED flag.
//
// How a fight is set up: a team snapshot from tests/boss_fixtures.json (smart-bot spire runs over KANTO + HOENN +
// JOHTO, captured on entering a boss / rival / legendary / elite node; bucketed by act tier) is loaded, its run is
// pointed at the boss's region and act, and the game's own config builders make the fight (Run.bossConfig,
// gauntletConfig, rivalConfig, legendConfig, mythicConfig; co-op: coop.js duoConfig / gauntletDuoConfig /
// mythicDuoConfig, which apply the co-op HP and damage multipliers). The smart bot (tests/bot.mjs) plays solo; the
// co-op bots (tests/coop_bot.mjs) play through the CoopGame reducer. Each E4 room is tested on its own at full HP.
// Enemy damage and healing are counted through Battle.prototype.damageEnemy / healEnemy / healSide (dry previews
// excluded), and the foes' remaining HP pool is sampled every turn.
import fs from 'fs';
import path from 'path';
import { fork, execFileSync } from 'child_process';
import { fileURLToPath, pathToFileURL } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 && argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const flag = (k) => argv.includes('--' + k);
const ROOT = path.resolve(arg('root', REPO));
const FIXTURES = path.resolve(arg('fixtures', path.join(HERE, 'boss_fixtures.json')));
const CAP = +arg('cap', 40);
const SEEDS = +arg('seeds', 40);
const MODES = arg('modes', 'solo,2,3,4').split(',').map(s => (s === 'solo' || s === '1' ? 1 : +s));
const JOBS = Math.max(1, Math.min(6, +arg('jobs', 4)));
const ENTRY_HP = flag('entryhp');
const WINDOW = 5; // a "flat" stretch: WINDOW turns in a row with no net damage to the foes' HP pool

// ------------------------------------------------------------------------------------------------ game loading
async function loadGame(root) {
  const imp = (p) => import(pathToFileURL(path.join(root, p)).href);
  const data = await imp('web/src/game/data.js');
  await data.loadData(async f => JSON.parse(fs.readFileSync(path.join(root, 'web/assets/data', f), 'utf8')));
  const [run, battle, pokemon, regions, acts, map, coop, rng, bot, cbot, version, events] = await Promise.all([
    'web/src/game/run.js', 'web/src/game/battle.js', 'web/src/game/pokemon.js', 'web/src/game/regions.js', 'web/src/game/acts.js',
    'web/src/game/map.js', 'web/src/game/coop/coop.js', 'web/src/game/rng.js', 'tests/bot.mjs', 'tests/coop_bot.mjs',
    'web/src/game/version.js', 'web/src/game/events.js',
  ].map(imp));
  return { D: data.D, ...run, ...battle, ...pokemon, ...regions, ...acts, ...map, ...coop, ...rng, bot, cbot, VERSION: version.VERSION + gitRev(root), events };
}

// " (3aec458)": the checkout's commit (VERSION is only bumped at release)
function gitRev(root) { try { return ' (' + execFileSync('git', ['-C', root, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() + (execFileSync('git', ['-C', root, 'status', '--porcelain', '--', 'web/src'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() ? '+dirty' : '') + ')'; } catch { return ''; } }

// Enemy damage / healing actually applied (not the bot's dry-run previews).
const TRACK = { on: false, dealt: 0, healed: 0 };
function instrument(G) {
  const P = G.Battle.prototype;
  const live = (b) => TRACK.on && !b.dry && !b._inSim;
  const heal = P.healEnemy;
  P.healEnemy = function (frac) { const e = this.enemy(), h0 = e ? e.hp : 0; const r = heal.call(this, frac); if (e && live(this)) TRACK.healed += Math.max(0, e.hp - h0); return r; };
  const side = P.healSide;
  P.healSide = function (s, mon, ...rest) { const h0 = mon ? mon.hp : 0; const r = side.call(this, s, mon, ...rest); if (s === 'enemy' && mon && live(this)) TRACK.healed += Math.max(0, mon.hp - h0); return r; };
  const dmg = P.damageEnemy;
  P.damageEnemy = function (amount, ...rest) { const e = this.enemy(), h0 = e ? e.hp : 0; const r = dmg.call(this, amount, ...rest); if (e && live(this)) TRACK.dealt += Math.max(0, h0 - e.hp); return r; };
}

// ------------------------------------------------------------------------------------------------ roster
const CAT_ORDER = ['gym', 'e4', 'champ', 'rival', 'bird', 'mythic', 'legend', 'post'];
const SHOWN = { RS_CHAMPION: 'WALLACE', CHAMPION_FIRST: 'BLUE', LEADER_TATE_LIZA: 'TATE&LIZA', LEADER_WALLACE: 'JUAN', PKMN_TRAINER_RED: 'RED', CHAMPION_LANCE: 'LANCE' };
const short = (k) => SHOWN[k] || String(k).replace(/^(LEADER_|ELITE_FOUR_|JOHTO_E4_|LEGEND_|CHAMPION_)/, '');

// One entry per fight: { id, cat, tier (act index), region, key, peer, buckets, setup(run), solo(G, run), duo(G, world, n) }.
function buildRoster(G) {
  const out = [];
  const L = (r) => G.REGIONS[r].letter;
  for (const r of G.REGION_IDS) {
    const acts = G.REGIONS[r].acts;
    for (let t = 0; t < acts.length; t++) {
      const a = acts[t];
      const at = (cat, key, extra) => ({ id: `${L(r)}${t + 1} ${cat}:${short(key)}`, cat, tier: t, region: r, key, peer: `${cat}:${t}`, ...extra });
      if (t < 3) {
        for (const k of (a.bosses || []).filter(k => !k.startsWith('LEGEND_'))) out.push(at('gym', k, { buckets: [`T${t}:boss`], node: 'boss' }));
        if (a.rival) out.push({ ...at('rival', a.rival, { buckets: [`T${t}:rival`, `T${t}:boss`], node: 'rival', rivalRegion: r }), id: `${L(r)}${t + 1} rival:${G.REGIONS[r].rival.name}` });
      }
      if (a.bird) out.push(at('bird', a.bird, { buckets: [`T${t}:legend`, `T${t}:rival`, `T${t}:elite`, `T${t}:boss`], node: 'legend' }));
      if (a.gauntlet) a.gauntlet.forEach((k, i) => {
        const champ = i === a.gauntlet.length - 1;
        out.push({ ...at(champ ? 'champ' : 'e4', k, { buckets: [`T${t}:boss`], node: 'gauntlet', room: i, summit: r }), peer: champ ? 'champ' : 'e4' });
      });
      if (a.postgame) for (const k of a.bosses || []) out.push({ ...at('post', k, { buckets: [`T${t}:boss`], node: 'boss', post: r }), peer: 'post' });
      // legendary elites (an elite node's legendary, the act's rare legendaries): no rule at A0, but tough one-off fights
      const legs = [...(a.elites || []).filter(k => G.LEGENDS[k]), ...(a.rareLegends || []).map(x => x[0]).filter(k => G.LEGENDS[k])];
      for (const k of legs) out.push({ ...at('legend', k, { buckets: [`T${t}:elite`, `T${t}:rival`, `T${t}:legend`, `T${t}:boss`], node: 'elite', post: a.postgame ? r : null }), peer: `legend:${Math.min(t, 4)}` });
    }
  }
  // mythic "?" events (acts.js MYTHICS): tested at act 3, in a region where each can show up
  const MREG = { MEWTWO: 'kanto', MEW: 'kanto', DEOXYS: 'hoenn', RAYQUAZA: 'hoenn' };
  for (const id of Object.keys(G.MYTHICS || {})) out.push({ id: `${L(MREG[id] || 'kanto')}3 mythic:${id}`, cat: 'mythic', tier: 2, region: MREG[id] || 'kanto', key: id, peer: 'mythic', node: 'mythic', buckets: ['T2:rival', 'T2:legend', 'T2:elite'] });
  // de-duplicate (a legendary can be both an elite and a rare legendary of the same act)
  const seen = new Set();
  return out.filter(e => (seen.has(e.id) ? false : seen.add(e.id))).sort((x, y) => CAT_ORDER.indexOf(x.cat) - CAT_ORDER.indexOf(y.cat) || x.tier - y.tier || x.region.localeCompare(y.region) || (x.room ?? 0) - (y.room ?? 0));
}

const FLOOR = { boss: (a) => a.floors, rival: (G, a) => G.rivalFloorOf(a), legend: (G, a) => G.birdFloors(a)[1] ?? a.floors - 3 };

// Point a loaded run at the spec's act and region (and the boss), like startAct would.
function setup(G, run, spec) {
  run.regions = JSON.parse(JSON.stringify(run.regions));
  if (spec.summit) run.regions.summit = spec.summit;
  else if (spec.post) run.regions.post = spec.post;
  else run.regions.acts[spec.tier] = spec.region;
  if (spec.rivalRegion) run.rival = spec.rivalRegion;
  run.actIndex = spec.tier;
  const act = run.act;
  run.floor = spec.node === 'boss' || spec.node === 'gauntlet' ? act.floors : spec.node === 'rival' ? G.rivalFloorOf(act) : spec.node === 'legend' ? (G.birdFloors(act)[1] ?? act.floors - 3) : Math.max(1, act.floors - 6);
  run.nodeId = null;
  run.gauntletIndex = spec.node === 'gauntlet' ? spec.room : -1;
  run.boss = spec.node === 'boss' ? spec.key : (act.bosses ? act.bosses[0] : null);
  if (spec.cat === 'legend') run.rareLegend = () => spec.key; // eliteConfig: this elite node is this legendary
}
const nodeOf = (run, spec) => ({ id: 'GA', type: spec.node === 'mythic' ? 'event' : spec.node, floor: run.floor, legend: spec.node === 'legend' ? spec.key : undefined });

function soloConfig(G, run, spec) {
  if (spec.node === 'gauntlet') return run.gauntletConfig(run.rng.fork('g' + spec.room), spec.room);
  if (spec.node === 'mythic') return run.mythicConfig(run.rng.fork('mythic'), run.floor, spec.key);
  return run.battleConfig(nodeOf(run, spec));
}
function duoConfigFor(G, world, spec, n) {
  if (spec.node === 'gauntlet') return G.gauntletDuoConfig(world, spec.room, n);
  if (spec.node === 'mythic') return G.mythicDuoConfig(world, spec.key, n);
  return G.duoConfig(world, nodeOf(world, spec), n);
}

// ------------------------------------------------------------------------------------------------ fixtures
function loadFixtures() {
  if (!fs.existsSync(FIXTURES)) throw new Error(`no fixtures at ${FIXTURES}: run with --harvest first`);
  return JSON.parse(fs.readFileSync(FIXTURES, 'utf8'));
}
// The fixture pool of a spec: the first bucket with enough teams (rivals: teams whose rival is this one).
function poolFor(FX, spec) {
  for (const b of spec.buckets) {
    let list = FX.buckets[b] || [];
    if (spec.rivalRegion) { const m = list.filter(f => f.meta.rival === spec.rivalRegion); if (m.length >= 8) list = m; }
    if (list.length >= 8) return { bucket: b, list };
  }
  const b = spec.buckets.find(x => (FX.buckets[x] || []).length);
  return { bucket: b, list: b ? FX.buckets[b] : [] };
}

function loadRun(G, fx, seed, uidBase) {
  const o = JSON.parse(JSON.stringify(fx.run));
  if (uidBase) { // co-op: every player's POKéMON need their own uids
    const map = {};
    o.party.forEach((m, i) => { map[m.uid] = uidBase + i; m.uid = uidBase + i; });
    o.moveOffers = Object.fromEntries(Object.entries(o.moveOffers || {}).map(([k, v]) => [map[k] ?? k, v]));
  }
  const run = G.Run.fromJSON(o);
  run.rng = new G.RNG(seed);
  if (!ENTRY_HP) for (const m of run.party) { m.hp = G.maxHp(m); m.status = null; }
  return run;
}
const teamHp = (G, run) => run.party.reduce((a, m) => a + Math.max(0, m.hp) / G.maxHp(m), 0) / Math.max(1, run.party.length);

// ------------------------------------------------------------------------------------------------ fights
function fightSolo(G, spec, fx, seed) {
  const run = loadRun(G, fx, seed, 0);
  setup(G, run, spec);
  const cfg = soloConfig(G, run, spec);
  const b = new G.Battle(run, cfg);
  const healthy = run.party.filter(m => !G.isFainted(m) && m.hp / G.maxHp(m) > 0.4);
  if (healthy.length) { // the smart bot's lead pick (tests/bot.mjs fight)
    const pick = healthy.sort((x, y) => G.bot.matchup(b, y) - G.bot.matchup(b, x))[0];
    run.party.splice(run.party.indexOf(pick), 1); run.party.unshift(pick); b.leadUid = pick.uid;
  }
  const hp0 = teamHp(G, run);
  TRACK.dealt = 0; TRACK.healed = 0; TRACK.on = true;
  b.start();
  const pool = () => b.enemies.reduce((a, e) => a + Math.max(0, e.hp), 0);
  const pool0 = b.enemies.reduce((a, e) => a + e.maxHp, 0);
  const curve = [pool()];
  let last = b.turn, guard = 0;
  while (!b.result && b.turn <= CAP && guard++ < CAP * 8) {
    G.bot.botTurn(b, run, 'smart');
    if (b.turn !== last) { curve.push(pool()); last = b.turn; }
  }
  TRACK.on = false;
  curve.push(pool());
  return record(b.result?.outcome, b.turn, !b.result, pool0, curve, hp0 - teamHp(G, run), cfg);
}

function fightCoop(G, spec, fxs, seed, n) {
  const game = new G.CoopGame();
  game.apply({ type: 'init', seq: 1, seed, ascension: 0, world: 'spire_johto', starters: fxs.map(f => f.run.starter), names: fxs.map((_, p) => 'BOT' + (p + 1)) });
  const runs = fxs.map((f, p) => loadRun(G, f, `${seed}:p${p}`, (p + 1) * 1e6));
  const world = loadRun(G, fxs[0], seed, 0);
  for (const r of [world, ...runs]) { r.coop = true; setup(G, r, spec); }
  runs.forEach((r, p) => { r.playerName = 'BOT' + (p + 1); });
  game.world = world; game.runs = runs;
  game.votes = runs.map(() => null); game.down = runs.map(() => false); game.away = runs.map(() => false);
  game.mirror();
  setup(G, world, spec); // (mirror swaps a boss a player owns; the gauntlet tests the boss as listed)
  G.setUidCounter(9e8);
  const cfg = duoConfigFor(G, world, spec, n);
  const hp0 = runs.reduce((a, r) => a + teamHp(G, r), 0) / n;
  TRACK.dealt = 0; TRACK.healed = 0; TRACK.on = true;
  game.startBattle(cfg);
  const d = game.battle;
  const pool = () => d.enemies.reduce((a, e) => a + Math.max(0, e.hp), 0);
  const pool0 = d.enemies.reduce((a, e) => a + e.maxHp, 0);
  const curve = [pool()];
  const bots = runs.map((_, p) => G.cbot.makeBot(seed, p));
  let last = d.turn, guard = 0;
  while (game.phase === 'battle' && !d.result && d.turn <= CAP && guard++ < CAP * 60 * n) {
    let acted = false;
    for (const bot of bots) {
      const a = G.cbot.botAction(game, bot);
      if (!a) continue;
      if (!game.apply({ ...a, seq: game.seq + 1 })) bot.fails++;
      acted = true;
      break;
    }
    if (d.turn !== last) { curve.push(pool()); last = d.turn; }
    if (!acted) break;
  }
  TRACK.on = false;
  curve.push(pool());
  const hp1 = game.runs.reduce((a, r) => a + teamHp(G, r), 0) / n;
  return record(d.result?.outcome, d.turn, !d.result, pool0, curve, hp0 - hp1, cfg);
}

function record(outcome, turns, stall, pool0, curve, hpLost, cfg) {
  let flat = false;
  for (let i = 0; i + WINDOW < curve.length; i++) if (curve[i] > 0 && curve[i + WINDOW] >= curve[i]) { flat = true; break; }
  return { o: stall ? 'stall' : outcome || 'none', t: turns, dealt: TRACK.dealt, healed: TRACK.healed, pool0, left: curve[curve.length - 1], flat, hp: +hpLost.toFixed(3), foes: cfg.enemies.length };
}

// ------------------------------------------------------------------------------------------------ worker
async function worker() {
  const G = await loadGame(ROOT);
  instrument(G);
  const roster = buildRoster(G);
  const FX = flag('harvestworker') ? null : loadFixtures();
  process.on('message', (task) => {
    if (task.type === 'harvest') { process.send({ type: 'harvest', snaps: harvest(G, task.from, task.to) }); return; }
    if (task.type === 'exit') process.exit(0);
    const spec = roster.find(s => s.id === task.id);
    const { list } = poolFor(FX, spec);
    const F = list.length, recs = [];
    for (let i = task.from; i < task.to; i++) {
      const seed = `GA|${spec.id}|${task.mode}|${i}`;
      let r;
      try {
        if (task.mode === 1) r = fightSolo(G, spec, list[i % F], seed);
        else {
          const step = Math.max(1, Math.floor(F / task.mode));
          const fxs = Array.from({ length: task.mode }, (_, k) => list[(i + k * step) % F]);
          r = fightCoop(G, spec, fxs, seed, task.mode);
        }
        r.fx = task.mode === 1 ? list[i % F].meta.id : undefined;
      } catch (err) { r = { o: 'error', err: String(err && err.stack || err).split('\n').slice(0, 3).join(' | ') }; }
      r.i = i;
      recs.push(r);
    }
    process.send({ type: 'fights', id: task.id, mode: task.mode, recs });
  });
  process.send({ type: 'ready' });
}

// ------------------------------------------------------------------------------------------------ harvest
// Smart-bot spire runs (KANTO + HOENN + JOHTO, the nine starters, EXP rotation, on into the post-game), like
// tests/balance.mjs --spire --pool K,H,J --starters nine --rotate --postgame. A snapshot of the run is taken on
// entering every boss, rival, legendary and elite node (before the fight).
function harvest(G, from, to) {
  const B = G.bot;
  B.BOT_OPTS.rotate = true;
  const STARTERS = ['BULBASAUR', 'TORCHIC', 'CYNDAQUIL', 'SQUIRTLE', 'TREECKO', 'CHIKORITA', 'CHARMANDER', 'MUDKIP', 'TOTODILE'];
  const snaps = [];
  const snap = (run, node) => {
    const o = JSON.parse(JSON.stringify(run));
    for (const k of ['log', 'runLog', 'map', 'pendingLevelEvents', 'pendingEvolution', 'moveOffers', 'seen', 'caughtSpecies', 'wildSeen', 'seenEvents']) delete o[k]; // (not used in battle)
    const tier = run.actIndex;
    const lv = run.party.map(m => m.level).sort((a, b) => b - a);
    snaps.push({ bucket: `T${tier}:${node.type}`, meta: { id: `${run.seed}@A${tier + 1}F${node.floor}`, region: run.region, rival: run.rival, starter: run.starter, top: lv[0], size: lv.length, items: run.relics.length }, run: o });
  };
  for (let i = from; i < to; i++) {
    const run = G.Run.create({ starter: STARTERS[i % STARTERS.length], ascension: 0, seed: `BF${i}`, world: 'spire', pool: ['kanto', 'hoenn', 'johto'] });
    const rng = run.rng.fork('bot');
    let guard = 0;
    outer: while (guard++ < 400) {
      const id = B.chooseNode(run, rng, 'smart');
      if (!id) break;
      const node = run.enterNode(id);
      if (['boss', 'rival', 'legend', 'elite'].includes(node.type)) snap(run, node);
      if (['wild', 'trainer', 'elite', 'boss', 'rival', 'legend'].includes(node.type)) {
        const cfg = run.battleConfig(node);
        const b = B.fight(run, cfg, 'smart', null);
        if (b.result.outcome === 'lose') break;
        B.postBattle(run, b, rng, 'smart');
        if (node.type === 'boss') {
          if (run.act.postgame) break;
          if (run.act.gauntlet) {
            for (let g = 1; g < run.act.gauntlet.length; g++) {
              run.gauntletBreakHeal(g); // (+50% HP; A10: full heal before the second ELITE FOUR)
              run.gauntletIndex = g;
              B.doShop(run, rng.fork('plateau' + g), 'smart');
              const b2 = B.fight(run, run.gauntletConfig(rng.fork('g' + g), g), 'smart', null);
              if (b2.result.outcome === 'lose') break outer;
              B.postBattle(run, b2, rng, 'smart');
            }
            if (!run.acts[run.actIndex + 1]?.postgame) break;
          }
          run.nextActHeal();
          run.startAct(run.actIndex + 1);
        }
      } else if (node.type === 'center') {
        const r = B.doCenter(run, 'smart');
        if (r.train) B.handleLevelEvents(run, [{ mon: r.train, events: run.addLevels ? run.addLevels(r.train, 3) : G.addLevels(r.train, 3) }], 'smart');
      } else if (node.type === 'mart') B.doShop(run, rng, 'smart');
      else if (node.type === 'treasure') {
        B.gainBotItem(run, run.randomConsumable(rng, run.actIndex + 1), 'smart');
        const rel = rng.chance(G.TUNING.relicOdds.treasure) ? run.relicChoices(rng, 2, { common: 40, uncommon: 45, rare: 15 }) : [];
        if (rel[0]) run.addRelic(rel[0]);
      } else if (node.type === 'event') {
        const r = B.doEvent(run, rng, 'smart');
        if (r.battle) {
          const b = B.fight(run, r.battle, 'smart', null);
          if (r.battle.mythic && b.result.outcome === 'lose') { run.softLoss(b); continue; }
          if (b.result.outcome === 'enemyFled') continue;
          if (b.result.outcome === 'lose') break;
          B.postBattle(run, b, rng, 'smart');
        }
      }
    }
  }
  return snaps;
}

// ------------------------------------------------------------------------------------------------ master
function startWorkers(n, extra = []) {
  const ws = [];
  for (let k = 0; k < n; k++) {
    const w = fork(fileURLToPath(import.meta.url), [...argv, '--worker', ...extra], { execArgv: ['--max-old-space-size=1536'] });
    ws.push(new Promise(res => w.once('message', (m) => res(w))));
  }
  return Promise.all(ws);
}
async function runTasks(workers, tasks, onResult) {
  let next = 0, done = 0;
  await new Promise((resolve) => {
    if (!tasks.length) return resolve();
    const give = (w) => { if (next < tasks.length) w.send(tasks[next++]); };
    for (const w of workers) {
      w.on('message', (m) => { onResult(m); done++; if (done === tasks.length) resolve(); else give(w); });
      w.on('exit', (code) => { if (done < tasks.length && code) { console.error('worker died', code); process.exit(1); } });
      give(w);
    }
  });
  for (const w of workers) w.send({ type: 'exit' });
}

async function masterHarvest() {
  const RUNS = +arg('runs', 960), PER = +arg('per', 40);
  const t0 = Date.now();
  const workers = await startWorkers(JOBS, ['--harvestworker']);
  const tasks = [];
  for (let i = 0; i < RUNS; i += 20) tasks.push({ type: 'harvest', from: i, to: Math.min(RUNS, i + 20) });
  const all = [];
  await runTasks(workers, tasks, (m) => all.push(...m.snaps));
  const G = await loadGame(ROOT);
  const buckets = {};
  for (const s of all) (buckets[s.bucket] ||= []).push(s);
  // at most PER teams per bucket, spread over the seeds (and, for rival buckets, over the three rivals)
  for (const [k, list] of Object.entries(buckets)) {
    list.sort((a, b) => a.meta.id.localeCompare(b.meta.id, 'en', { numeric: true }));
    const groups = /rival/.test(k) ? ['kanto', 'hoenn', 'johto'].map(r => list.filter(s => s.meta.rival === r)) : [list];
    const per = Math.ceil(PER / groups.length);
    buckets[k] = groups.flatMap(g => (g.length <= per ? g : Array.from({ length: per }, (_, j) => g[Math.floor(j * g.length / per)]))).map(({ meta, run }) => ({ meta, run }));
  }
  const out = { meta: { made: new Date().toISOString().slice(0, 10), version: G.VERSION, runs: RUNS, how: 'smart bot, spire K+H+J, nine starters, --rotate, post-game; snapshot on entering boss/rival/legend/elite nodes' }, buckets };
  fs.mkdirSync(path.dirname(FIXTURES), { recursive: true });
  fs.writeFileSync(FIXTURES, JSON.stringify(out));
  console.log(`harvested ${all.length} snapshots from ${RUNS} runs in ${((Date.now() - t0) / 1000).toFixed(0)}s -> ${path.relative(process.cwd(), FIXTURES)} (${(fs.statSync(FIXTURES).size / 1e6).toFixed(1)} MB)`);
  for (const [k, v] of Object.entries(buckets).sort()) console.log(`  ${k.padEnd(10)} ${String(v.length).padStart(3)} teams, top lvl ~${med(v.map(s => s.meta.top))}`);
}

const med = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const pct = (x) => (x === null || x === undefined || Number.isNaN(x) ? '  -' : String(Math.round(x * 100)).padStart(3));

function aggregate(recs) {
  const ok = recs.filter(r => r.o !== 'error');
  const n = ok.length;
  const wins = ok.filter(r => r.o === 'win' || r.o === 'caught').length;
  const stalls = ok.filter(r => r.o === 'stall').length;
  const fled = ok.filter(r => r.o === 'enemyFled').length;
  const turns = ok.reduce((a, r) => a + r.t, 0);
  const dealt = ok.reduce((a, r) => a + r.dealt / r.pool0, 0), healed = ok.reduce((a, r) => a + r.healed / r.pool0, 0);
  // per turn, as a share of the foes' total HP (comparable between solo and co-op)
  const dpt = ok.reduce((a, r) => a + r.dealt / r.pool0 / Math.max(1, r.t), 0) / Math.max(1, n);
  const hpt = ok.reduce((a, r) => a + r.healed / r.pool0 / Math.max(1, r.t), 0) / Math.max(1, n);
  const grow = ok.filter(r => r.healed >= 0.9 * r.dealt && r.t >= 3).length; // fights where the foes healed (about) all they took
  const outliers = ok.filter(r => r.o !== 'win' && r.o !== 'caught').sort((a, b) => b.t - a.t).slice(0, 3).map(r => ({ i: r.i, o: r.o, t: r.t, left: Math.round(100 * r.left / r.pool0), fx: r.fx }));
  const long = [...ok].sort((a, b) => b.t - a.t).slice(0, 2).map(r => ({ i: r.i, o: r.o, t: r.t }));
  return {
    n, errors: recs.length - n, err: recs.find(r => r.o === 'error')?.err, win: n ? wins / n : null, stall: n ? stalls / n : null, fled: n ? fled / n : 0,
    turns: med(ok.map(r => r.t)), p90: med(ok.map(r => r.t).sort((a, b) => a - b).slice(Math.floor(n * 0.8))), avgTurns: turns / Math.max(1, n),
    dpt, hpt, healShare: dealt ? healed / dealt : 0, flat: n ? ok.filter(r => r.flat).length / n : 0, grow: n ? grow / n : 0,
    hpLost: ok.reduce((a, r) => a + r.hp, 0) / Math.max(1, n), outliers, long,
  };
}

// Flags (see AGENTS.md "Boss changes"). Thresholds are deliberately loose: they catch broken fights, not tuning.
//   RED     stall (> 10% of fights at the turn cap); the foes heal (about) all the damage they take in > 10% of fights;
//           win rate 30+ points under its peers (same category and act, same mode); a co-op win rate 30+ points further
//           under solo than the roster's typical gap (a rule that doesn't scale with players); fights that throw
//   YELLOW  > 25% of fights with 5 turns in a row of no net damage; foes heal > 60% of the damage dealt; co-op fights
//           taking 2x the roster's typical co-op/solo turn ratio; a win rate 25+ points under the baseline's
//   INFO    much easier than its peers
// Peers, the typical co-op gap and the baseline come from this run and from the baseline file (the last full roster run
// on main, tests/boss_baseline.json), so a one-boss run is still compared with the whole roster.
const TH = { stall: 0.10, flat: 0.25, heal: 0.6, grow: 0.10, peer: 0.30, coop: 0.30, turnRatio: 2.0, regress: 0.25 };
const modeLabel = (m) => (+m === 1 ? 'solo' : `${m}p`);
function flagAll(full, roster, R, BASE, modes) {
  const F = {};
  const add = (id, sev, msg) => (F[id] ||= []).push({ sev, msg });
  const get = (id, m) => R[id]?.[m]?.n ? R[id][m] : BASE?.results?.[id]?.[m]?.n ? BASE.results[id][m] : null;
  for (const s of roster) for (const m of modes) {
    const a = R[s.id]?.[m];
    if (!a || !a.n) continue;
    const L = modeLabel(m);
    if (a.errors) add(s.id, 'RED', `${L}: ${a.errors} fights threw (${a.err})`);
    if (a.stall > TH.stall) add(s.id, 'RED', `${L}: ${pct(a.stall).trim()}% of fights hit the ${CAP}-turn cap (STALL)`);
    if (a.grow > TH.grow) add(s.id, 'RED', `${L}: the foes healed about all the damage they took in ${pct(a.grow).trim()}% of fights (effective HP grows)`);
    else if (a.flat > TH.flat) add(s.id, 'YELLOW', `${L}: ${pct(a.flat).trim()}% of fights had ${WINDOW} turns in a row with no net damage`);
    if (a.healShare > TH.heal) add(s.id, 'YELLOW', `${L}: the foes healed ${pct(a.healShare).trim()}% of the damage dealt`);
    const b = BASE?.results?.[s.id]?.[m];
    if (b?.n && a.win < b.win - TH.regress) add(s.id, 'YELLOW', `${L}: win ${pct(a.win).trim()}% vs ${pct(b.win).trim()}% in the baseline (${BASE.version})`);
  }
  // far off its peers: same category and act, same mode
  const peers = {};
  for (const s of full) (peers[s.peer] ||= []).push(s);
  for (const s of roster) for (const m of modes) {
    if (s.key === 'MEW') continue; // (MEW flees after 3 turns by design)
    const a = R[s.id]?.[m];
    const others = peers[s.peer].filter(o => o.id !== s.id && get(o.id, m)).map(o => get(o.id, m).win);
    if (!a?.n || others.length < 2) continue;
    const pm = med(others);
    if (a.win < pm - TH.peer) add(s.id, 'RED', `${modeLabel(m)}: win ${pct(a.win).trim()}% vs ${pct(pm).trim()}% for its peers (${s.peer}, ${others.length} others)`);
    else if (a.win > pm + TH.peer + 0.1) add(s.id, 'INFO', `${modeLabel(m)}: much easier than its peers (${pct(a.win).trim()}% vs ${pct(pm).trim()}%)`);
  }
  // co-op vs solo divergence: this boss's solo - co-op win gap against the roster's typical gap, and the turn ratio
  if (modes.includes(1)) for (const m of modes.filter(x => x > 1)) {
    const both = full.filter(s => get(s.id, 1) && get(s.id, m) && s.key !== 'MEW');
    const g0 = both.length >= 4 ? med(both.map(s => get(s.id, 1).win - get(s.id, m).win)) : 0;
    const r0 = both.length >= 4 ? med(both.map(s => get(s.id, m).avgTurns / Math.max(1, get(s.id, 1).avgTurns))) : 1.5;
    for (const s of roster) {
      const a = R[s.id]?.[1], c = R[s.id]?.[m];
      if (!a?.n || !c?.n || s.key === 'MEW') continue;
      const gap = a.win - c.win;
      if (gap - g0 > TH.coop) add(s.id, 'RED', `${m}p: co-op win ${pct(c.win).trim()}% vs solo ${pct(a.win).trim()}% (gap ${pct(gap).trim()} pts, typical ${pct(g0).trim()}): doesn't scale with players`);
      else if (g0 - gap > TH.coop) add(s.id, 'INFO', `${m}p: co-op much easier than solo (${pct(c.win).trim()}% vs ${pct(a.win).trim()}%)`);
      const ratio = c.avgTurns / Math.max(1, a.avgTurns);
      if (ratio > r0 * TH.turnRatio && c.avgTurns > 10) add(s.id, 'YELLOW', `${m}p: fights take ${ratio.toFixed(1)}x the solo turns (typical ${r0.toFixed(1)}x)`);
    }
  }
  return F;
}

function printTable(roster, R, F, BASE, modes) {
  const head = 'BOSS'.padEnd(22) + modes.map(m => ` | ${modeLabel(m).padEnd(4)} win turn stl heal`).join('') + ' | hp lost %   | flags';
  console.log('\n' + head + '\n' + '-'.repeat(head.length));
  let cat = null;
  for (const s of roster) {
    if (!R[s.id]) continue;
    if (s.cat !== cat) { if (cat) console.log(''); cat = s.cat; }
    const cells = modes.map(m => {
      const a = R[s.id][m];
      if (!a?.n) return ' |' + ' '.repeat(22);
      return ` |      ${pct(a.win)} ${String(a.turns).padStart(4)} ${pct(a.stall)} ${pct(a.healShare)}`;
    }).join('');
    const hp = modes.map(m => (R[s.id][m]?.n ? pct(R[s.id][m].hpLost).trim() : '-')).join('/');
    const fl = F[s.id] || [];
    const sev = fl.some(f => f.sev === 'RED') ? 'RED' : fl.some(f => f.sev === 'YELLOW') ? 'yellow' : fl.length ? 'info' : '';
    console.log(s.id.padEnd(22) + cells + ' | ' + hp.padEnd(11) + ' | ' + sev);
  }
  console.log('\n(win = win rate %, turn = median turns, stl = % of fights at the turn cap, heal = foe healing as % of the damage dealt,\n hp lost = share of the player team\'s HP lost per fight, per mode)');
  if (BASE) {
    const rows = roster.filter(s => R[s.id] && BASE.results?.[s.id]);
    if (rows.length && rows.length <= 12) {
      console.log(`\nvs baseline ${BASE.version} (${BASE.seeds} seeds): win % then -> now`);
      for (const s of rows) console.log('  ' + s.id.padEnd(22) + modes.map(m => { const b = BASE.results[s.id][m], a = R[s.id][m]; return `${modeLabel(m)} ${b?.n ? pct(b.win).trim() : '-'} -> ${a?.n ? pct(a.win).trim() : '-'}`; }).join('   '));
    }
  }
  const flagged = roster.filter(s => (F[s.id] || []).some(f => f.sev !== 'INFO'));
  if (flagged.length) {
    console.log(`\nFLAGS (${flagged.length}):`);
    for (const s of flagged) {
      console.log(`  ${s.id}`);
      for (const f of F[s.id].filter(x => x.sev !== 'INFO')) console.log(`    [${f.sev}] ${f.msg}`);
      for (const m of modes) {
        const a = R[s.id][m];
        if (!a?.n) continue;
        console.log(`      ${modeLabel(m).padEnd(4)} dmg ${(a.dpt * 100).toFixed(1)}%/turn heal ${(a.hpt * 100).toFixed(1)}%/turn (of the foes' HP), p90 turns ${a.p90}, flat ${pct(a.flat).trim()}%, HP lost ${pct(a.hpLost).trim()}%; worst: ${a.outliers.map(o => `#${o.i} ${o.o} t${o.t} foes ${o.left}% left${o.fx ? ' ' + o.fx : ''}`).join(', ') || '-'}`);
      }
    }
  } else console.log('\nNo red or yellow flags.');
  const info = roster.filter(s => (F[s.id] || []).some(f => f.sev === 'INFO'));
  if (info.length) console.log('\nnotes: ' + info.map(s => `${s.id} (${F[s.id].filter(f => f.sev === 'INFO').map(f => f.msg).join('; ')})`).join('\n       '));
}

const BASELINE = path.join(HERE, 'boss_baseline.json');
function loadBaseline() {
  if (flag('nobaseline')) return null;
  const p = path.resolve(arg('baseline', BASELINE));
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
}
const compact = (a) => a && { n: a.n, win: +a.win.toFixed(3), turns: a.turns, avgTurns: +a.avgTurns.toFixed(2), stall: +a.stall.toFixed(3), healShare: +a.healShare.toFixed(3), hpLost: +a.hpLost.toFixed(3) };
// tests/boss_baseline.json: one line per boss (readable diffs when it is refreshed)
function saveBaseline(version, seeds, cap, roster, R, modes) {
  const head = JSON.stringify({ version, made: new Date().toISOString().slice(0, 10), seeds, cap }).slice(0, -1);
  const rows = roster.map(s => `  ${JSON.stringify(s.id)}: ${JSON.stringify(Object.fromEntries(modes.map(m => [m, compact(R[s.id]?.[m])])))}`);
  fs.writeFileSync(BASELINE, `${head},\n "results": {\n${rows.join(',\n')}\n }\n}\n`);
  console.log('wrote ' + path.relative(process.cwd(), BASELINE));
}

function selectRoster(full) {
  let roster = full;
  if (arg('cat')) { const cats = arg('cat').split(','); roster = roster.filter(s => cats.includes(s.cat)); }
  if (arg('boss')) { const ks = arg('boss').toLowerCase().split(','); roster = roster.filter(s => ks.some(k => s.id.toLowerCase().includes(k) || s.key.toLowerCase().includes(k))); }
  return roster;
}

// --report PATH: print the table and flags of a saved run again (with the current thresholds and baseline).
async function report() {
  const J = JSON.parse(fs.readFileSync(arg('report'), 'utf8'));
  const G = await loadGame(ROOT);
  const full = buildRoster(G);
  const ids = new Set(J.roster.map(s => s.id));
  const roster = selectRoster(full.filter(s => ids.has(s.id)));
  const R = Object.fromEntries(J.roster.filter(s => s.results).map(s => [s.id, s.results]));
  const BASE = loadBaseline();
  const modes = J.modes;
  console.log(`boss gauntlet report: ${J.version}, ${J.seeds} seeds, cap ${J.cap}${BASE ? `, baseline ${BASE.version}` : ''}`);
  const F = flagAll(full, roster, R, BASE && BASE.version !== J.version ? BASE : null, modes);
  printTable(roster, R, F, BASE && BASE.version !== J.version ? BASE : null, modes);
  if (flag('save-baseline')) {
    if (roster.length === full.length) saveBaseline(J.version, J.seeds, J.cap, roster, R, modes);
    else console.log('(--save-baseline needs the whole roster: not saved)');
  }
}

async function master() {
  const G = await loadGame(ROOT);
  const FX = loadFixtures();
  const full = buildRoster(G);
  const roster = selectRoster(full);
  if (!roster.length) { console.error('no boss matches'); process.exit(1); }
  const BASE = flag('save-baseline') ? null : loadBaseline();
  const t0 = Date.now();
  console.log(`boss gauntlet: ${G.VERSION} at ${ROOT}\n  ${roster.length} fights x ${MODES.map(modeLabel).join('/')} x ${SEEDS} seeds, turn cap ${CAP}, ${ENTRY_HP ? 'entry HP' : 'full HP'}, fixtures ${path.basename(FIXTURES)} (${FX.meta.version}, ${FX.meta.made})${BASE ? `, baseline ${BASE.version}` : ''}`);
  for (const s of roster) { const p = poolFor(FX, s); if (p.list.length < 8) console.log(`  warning: ${s.id} has only ${p.list.length} teams (${p.bucket})`); }
  const tasks = [];
  const chunk = Math.max(5, Math.ceil(SEEDS / 4));
  for (const s of roster) for (const m of MODES) for (let i = 0; i < SEEDS; i += chunk) tasks.push({ id: s.id, mode: m, from: i, to: Math.min(SEEDS, i + chunk), w: m });
  tasks.sort((a, b) => b.w - a.w); // big co-op chunks first
  const jobs = Math.min(JOBS, tasks.length);
  const workers = await startWorkers(jobs);
  const RAW = {};
  let got = 0, lastLog = Date.now();
  await runTasks(workers, tasks, (m) => {
    ((RAW[m.id] ||= {})[m.mode] ||= []).push(...m.recs);
    got++;
    if (Date.now() - lastLog > 30000) { lastLog = Date.now(); process.stdout.write(`  ${got}/${tasks.length} chunks, ${((Date.now() - t0) / 1000).toFixed(0)}s\n`); }
  });
  const R = {};
  for (const s of roster) for (const m of MODES) if (RAW[s.id]?.[m]) (R[s.id] ||= {})[m] = aggregate(RAW[s.id][m]);
  const F = flagAll(full, roster, R, BASE, MODES);
  printTable(roster, R, F, BASE, MODES);
  const secs = (Date.now() - t0) / 1000;
  console.log(`\n${roster.length} fights, ${tasks.reduce((a, t) => a + t.to - t.from, 0)} battles in ${secs.toFixed(0)}s (${jobs} workers)`);
  const label = (arg('label', G.VERSION) + (arg('boss') ? '-' + arg('boss') : arg('cat') ? '-' + arg('cat') : '')).replace(/[^a-z0-9.\-]+/gi, '_').replace(/_+$/, '');
  const out = arg('json', path.join(REPO, 'tests/out', `boss_gauntlet_${label}.json`));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({ version: G.VERSION, root: ROOT, seeds: SEEDS, cap: CAP, modes: MODES, entryHp: ENTRY_HP, fixtures: FX.meta, baseline: BASE?.version || null, thresholds: TH, secs, roster: roster.map(s => ({ id: s.id, cat: s.cat, act: s.tier + 1, region: s.region, key: s.key, peer: s.peer, results: R[s.id], flags: F[s.id] || [] })) }, null, 1));
  console.log('wrote ' + path.relative(process.cwd(), out));
  if (flag('save-baseline')) {
    if (roster.length !== full.length) console.log('(--save-baseline needs the whole roster: not saved)');
    else saveBaseline(G.VERSION, SEEDS, CAP, roster, R, MODES);
  }
  const red = roster.filter(s => (F[s.id] || []).some(f => f.sev === 'RED')).length;
  process.exitCode = red ? 2 : 0;
}

if (flag('worker')) await worker();
else if (flag('harvest')) await masterHarvest();
else if (arg('report')) await report();
else await master();
