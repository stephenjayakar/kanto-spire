// Gen 4 is part of the game (v0.4.0; game/gen4.js, tools/extract_gen4.py): node tests/gen4.test.mjs
// 1. Present: loadData merges the 107 species (#387-493) into D on every load, FireRed's species.json stays 386, no
//    flag is left anywhere, the POKéDEX is 493.
// 2. The data is valid against the game: types, moves (learnsets use only this game's moves), abilities, evolution
//    targets, dex text, and every sprite / cry exists at the expected size.
// 3. Evolutions work with this game's rules: the Gen 4 lines, the 22 cross-gen evolutions and the 7 babies (stones,
//    levels, friendship, KNOWS_MOVE, the 50/50 branch); no evolution is left on a method nothing handles.
// 4. Moves: wild / trainer / level-up moves come from the learnsets, NO_PLAYER_MOVES never reach a player's POKéMON.
// 5. Legendaries: the 14 are LEGENDARY (one per run) and rare legendary elites of late acts; balanced like the
//    post-game's legendary elites, music that exists.
// 6. Assets: cries outside FireRed's sound bank (the WAV path), the new stones' icons, the pack layout.
import fs from 'fs';
import path from 'path';
import assert from 'assert/strict';
import { fileURLToPath } from 'url';
import { loadData, D, byDex, DEX_MAX } from '../web/src/game/data.js';
import { GEN4_DATA_FILE, loadGen4, applyGen4, GEN4_LEGENDS, KNOWS_MOVE_LEVEL, KNOWS_MOVE_LEARN, RARE_LEGEND } from '../web/src/game/gen4.js';
import { makeMon, gainExp, addLevels, itemEvolution, levelEvolution, canUseStone, defaultMoves, movesLearnedAt, NO_PLAYER_MOVES, LEGENDARY, evolve } from '../web/src/game/pokemon.js';
import { CONSUMABLES, EVO_STONES } from '../web/src/game/items.js';
import { LEGENDS } from '../web/src/game/acts.js';
import { REGIONS, REGION_IDS } from '../web/src/game/regions.js';
import { Run } from '../web/src/game/run.js';
import { Battle, makeEnemy } from '../web/src/game/battle.js';
import { RNG } from '../web/src/game/rng.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = path.join(ROOT, 'web/assets');
let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.log('FAIL', name, '-', e.message, process.env.STACK ? e.stack : ''); } };
const json = (f) => JSON.parse(fs.readFileSync(path.join(ASSETS, 'data', f), 'utf8'));

const asked = [];
await loadData(async f => { asked.push(f); return json(f); });
const raw = json('species.json');
const g4 = await loadGen4(async f => json(f));
const list = Object.values(g4.species).sort((a, b) => a.dex - b.dex);
const bst = (sp) => Object.values(D.species[sp].stats).reduce((a, x) => a + x, 0);

// ---- 1. present ---------------------------------------------------------------------------------------------
t('loadData reads the Gen 4 file and merges it: 493 species, #1-493 in byDex', () => {
  assert.ok(asked.includes(GEN4_DATA_FILE), `read ${asked.join(', ')}`);
  assert.equal(Object.keys(raw).length, 386, 'FireRed\'s species.json stays 386 (the frozen co-op engines read it)');
  assert.equal(Object.keys(D.species).length, 493);
  assert.equal(DEX_MAX, 493);
  for (let n = 1; n <= 493; n++) assert.ok(byDex[n]?.dex === n, `byDex[${n}]`);
  for (const [key, s] of Object.entries(g4.species)) {
    const d = D.species[key];
    assert.ok(d?.gen4 && d.key === key && d.gfxDir === s.gfxDir && d.dex === s.dex && byDex[s.dex] === d, `${key} merged`);
  }
});
t('no flag left: GEN4_ENABLED / the gen4 pack special case / the --gen4 option are gone', () => {
  const hits = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) { if (!['legacy', 'assets', 'vendor'].includes(e.name)) walk(f); } else if (/\.(m?js|cjs|html)$/.test(e.name) && /GEN4_ENABLED/.test(fs.readFileSync(f, 'utf8'))) hits.push(path.relative(ROOT, f)); } };
  walk(path.join(ROOT, 'web'));
  walk(path.join(ROOT, 'tools'));
  assert.deepEqual(hits, [], 'GEN4_ENABLED');
  const up = fs.readFileSync(path.join(ROOT, 'tools/upload_packs.cjs'), 'utf8');
  assert.ok(!/--gen4|withGen4|'gen4'/.test(up), 'upload_packs.cjs: no gen4 pack / --gen4');
  assert.ok(/'pokemon-gen4'/.test(up) && /LAZY = new Set\([^)]*'pokemon-gen4'/.test(up), 'upload_packs.cjs: the Gen 4 sprites are a lazy pack');
  assert.ok(!/gen4/i.test(fs.readFileSync(path.join(ROOT, 'web/src/main.js'), 'utf8').replace(/Gen 4|gen4\.js|cryWav/g, '')), 'main.js: no pack filter');
  const dexSrc = fs.readFileSync(path.join(ROOT, 'web/src/scenes/dex.js'), 'utf8');
  assert.ok(/DEX_MAX/.test(dexSrc) && !/386/.test(dexSrc), 'dex.js: DEX_MAX from data.js, no 386');
  assert.ok(!/<= 386/.test(fs.readFileSync(path.join(ROOT, 'web/src/game/events.js'), 'utf8')), 'events.js: no #386 cut-off');
  assert.ok(/(audio-test|animlab|gen4lab)/.test(fs.readFileSync(path.join(ROOT, 'tools/build_site.cjs'), 'utf8')), 'gen4lab.html stays out of the hosted build');
});

// ---- 2. the data ---------------------------------------------------------------------------------------------
t('107 species, dex 387-493, unique ids after FireRed\'s, valid against the game\'s data and assets', () => {
  assert.equal(list.length, 107);
  assert.ok(list.every((s, i) => s.dex === 387 + i), 'dex 387..493, no gaps');
  const frIds = new Set(Object.values(raw).map(s => s.id)), ids = list.map(s => s.id);
  assert.ok(new Set(ids).size === 107 && !ids.some(i => frIds.has(i)) && Math.min(...ids) === Math.max(...frIds) + 1, 'ids');
  const pngSize = (f) => { const b = fs.readFileSync(f); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };
  const SIZES = { front: [64, 64], front_shiny: [64, 64], back: [64, 64], back_shiny: [64, 64], anim_front: [128, 64], anim_front_shiny: [128, 64], icon: [32, 64] };
  const probs = [];
  for (const [key, s] of Object.entries(g4.species)) {
    const p = (m) => probs.push(`${key}: ${m}`);
    const d = D.species[key];
    if (!s.types.length || s.types.some(ty => !D.types.chart[ty] && !D.types.list.includes(ty))) p('type ' + s.types);
    if (!d.learnset.length) p('empty learnset');
    for (const [, m] of d.learnset) if (!D.moves[m]) p('learnset move ' + m);
    for (const m of [...d.tmhm, ...d.tutor, ...d.eggMoves]) if (!D.moves[m]) p('move ' + m);
    for (const a of d.abilities) if (!D.abilities[a]) p('ability ' + a);
    for (const e of d.evolutions) if (!D.species[e.into]) p('evolves into unknown ' + e.into);
    if (d.preEvolution && !D.species[d.preEvolution]) p('unknown pre-evolution ' + d.preEvolution);
    if (!s.dexText || !s.category || !s.height || !s.weight) p('dex text / category / size missing');
    const st = s.stats; if (![st.hp, st.atk, st.def, st.spa, st.spd, st.spe].every(v => v > 0 && v <= 255)) p('stats');
    if (s.gfxDir !== `gfx/gen4/pokemon/${s.gfx}`) p('gfxDir ' + s.gfxDir);
    for (const [k, wh] of Object.entries(SIZES)) {
      const f = path.join(ASSETS, s.gfxDir, k + '.png');
      if (!fs.existsSync(f)) { p('missing ' + k); continue; }
      const [w, h] = pngSize(f);
      if (w !== wh[0] || h !== wh[1]) p(`${k} is ${w}x${h}`);
    }
    if (!s.cryWav || !fs.existsSync(path.join(ASSETS, s.cryWav)) || fs.statSync(path.join(ASSETS, s.cryWav)).size < 1000) p('cry missing');
  }
  assert.deepEqual(probs, []);
  assert.equal(D.species.TOGEKISS.types.join(), 'NORMAL,FLYING', 'Gen 4 values (TOGEKISS NORMAL/FLYING, not the later FAIRY)');
});

// ---- 3. evolutions -------------------------------------------------------------------------------------------
// The methods this game's code handles (pokemon.js levelEvolution / evoStone / itemEvolution, run.js for SHEDINJA).
const HANDLED = new Set(['LEVEL', 'FRIENDSHIP', 'ITEM', 'TRADE', 'TRADE_ITEM', 'FRIENDSHIP_DAY', 'FRIENDSHIP_NIGHT', 'LEVEL_ATK_GT_DEF', 'LEVEL_ATK_LT_DEF',
  'LEVEL_ATK_EQ_DEF', 'LEVEL_SILCOON', 'LEVEL_CASCOON', 'LEVEL_NINJASK', 'LEVEL_SHEDINJA', 'BEAUTY', 'KNOWS_MOVE', 'LEVEL_FEMALE', 'LEVEL_MALE']);
t('every evolution is on a method the game handles; every stone exists as an item; the DAY / NIGHT pair is only EEVEE\'s', () => {
  for (const s of Object.values(D.species)) for (const e of s.evolutions || []) {
    assert.ok(HANDLED.has(e.method), `${s.key} -> ${e.into}: ${e.method}`);
    if (e.method === 'ITEM') assert.ok(EVO_STONES.includes(e.param) && CONSUMABLES[e.param]?.evo && D.items[e.param]?.name, `${s.key}: stone ${e.param}`);
    if (e.method === 'FRIENDSHIP_DAY' || e.method === 'FRIENDSHIP_NIGHT') assert.equal(s.key, 'EEVEE');
    if (e.method === 'LEVEL_FEMALE' || e.method === 'LEVEL_MALE') assert.equal(s.key, 'BURMY');
    if (e.method === 'KNOWS_MOVE') assert.ok(D.moves[e.param] && D.species[s.key].learnset.some(([, m]) => m === e.param), `${s.key} learns ${e.param}`);
  }
  for (const k of ['SHINY_STONE', 'DUSK_STONE', 'DAWN_STONE', 'ICE_STONE']) assert.equal(D.items[k].name, k.replace('_', ' '));
});
t('the cross-gen evolutions and the babies are linked (22 + 7), the source species.json untouched', () => {
  const into = (k) => D.species[k].evolutions.map(e => e.into);
  assert.equal(Object.values(g4.crossGen.evolutions).flat().length, 22);
  for (const [k, evos] of Object.entries(g4.crossGen.evolutions)) for (const e of evos) assert.ok(into(k).includes(e.into), `${k} -> ${e.into}`);
  assert.equal(D.species.EEVEE.evolutions.length, 7);
  for (const [k, baby] of Object.entries(g4.crossGen.preEvolutions)) { assert.equal(D.species[k].preEvolution, baby); assert.ok(into(baby).includes(k)); }
  assert.ok(raw.EEVEE.evolutions.length === 5 && raw.SNORLAX.preEvolution === null);
  const copy = { species: structuredClone(raw) };
  assert.ok(applyGen4(copy, g4) === 107 && applyGen4(copy, g4) === 0 && copy.species.EEVEE.evolutions.length === 7, 'applyGen4 is add-only and idempotent');
});
const rng = () => new RNG('evo');
const mon = (sp, lvl) => makeMon(sp, lvl, { rng: rng() });
// level up from lvl - 1 to lvl: the evolution it asks for (null: none)
const evoAt = (sp, lvl, setup) => { const m = mon(sp, lvl - 1); setup?.(m); return gainExp(m, 0) && addLevels(m, 1).find(e => e.type === 'evolve')?.into || null; };
t('stones: the Gen 4 stone evolutions (THUNDER / LEAF / ICE / SHINY / DUSK / DAWN STONE) and the old ones still work', () => {
  const cases = [['MAGNETON', 'THUNDER_STONE', 'MAGNEZONE'], ['NOSEPASS', 'THUNDER_STONE', 'PROBOPASS'], ['EEVEE', 'LEAF_STONE', 'LEAFEON'], ['EEVEE', 'ICE_STONE', 'GLACEON'],
    ['EEVEE', 'THUNDER_STONE', 'JOLTEON'], ['EEVEE', 'SUN_STONE', 'ESPEON'], ['TOGETIC', 'SHINY_STONE', 'TOGEKISS'], ['ROSELIA', 'SHINY_STONE', 'ROSERADE'],
    ['MURKROW', 'DUSK_STONE', 'HONCHKROW'], ['MISDREAVUS', 'DUSK_STONE', 'MISMAGIUS'], ['SNEASEL', 'DUSK_STONE', 'WEAVILE'], ['GLIGAR', 'DUSK_STONE', 'GLISCOR'],
    ['KIRLIA', 'DAWN_STONE', 'GALLADE'], ['SNORUNT', 'DAWN_STONE', 'FROSLASS'], ['GLOOM', 'LEAF_STONE', 'VILEPLUME'], ['RHYDON', 'LINK_CABLE', 'RHYPERIOR'],
    ['DUSCLOPS', 'LINK_CABLE', 'DUSKNOIR'], ['PORYGON2', 'LINK_CABLE', 'PORYGON_Z']];
  for (const [sp, item, want] of cases) {
    assert.equal(itemEvolution(mon(sp, 30), item), want, `${sp} + ${item}`);
    if (item !== 'LINK_CABLE') assert.ok(canUseStone(sp, item), `canUseStone ${sp} ${item}`);
  }
  assert.equal(itemEvolution(mon('KIRLIA', 30), 'SHINY_STONE'), null);
  // KIRLIA / SNORUNT keep their level evolutions
  assert.equal(evoAt('KIRLIA', 30), 'GARDEVOIR');
  assert.equal(evoAt('SNORUNT', 42), 'GLALIE');
});
t('levels: Gen 4 lines, trade-item -> Lv40, friendship -> Lv22 (RIOLU, BUDEW, CHINGLING, MUNCHLAX, HAPPINY), MANTYKE Lv30, COMBEE, BURMY', () => {
  const lv = [['TURTWIG', 18, 'GROTLE'], ['GROTLE', 32, 'TORTERRA'], ['CHIMCHAR', 14, 'MONFERNO'], ['PIPLUP', 16, 'PRINPLUP'], ['GIBLE', 24, 'GABITE'], ['GABITE', 48, 'GARCHOMP'],
    ['STARAVIA', 34, 'STARAPTOR'], ['SHINX', 15, 'LUXIO'], ['RHYDON', 40, 'RHYPERIOR'], ['ELECTABUZZ', 40, 'ELECTIVIRE'], ['MAGMAR', 40, 'MAGMORTAR'], ['DUSCLOPS', 40, 'DUSKNOIR'],
    ['RIOLU', 22, 'LUCARIO'], ['BUDEW', 22, 'ROSELIA'], ['CHINGLING', 22, 'CHIMECHO'], ['MUNCHLAX', 22, 'SNORLAX'], ['HAPPINY', 22, 'CHANSEY'], ['BUNEARY', 22, 'LOPUNNY'],
    ['MANTYKE', 30, 'MANTINE'], ['COMBEE', 21, 'VESPIQUEN']];
  for (const [sp, l, want] of lv) {
    assert.equal(evoAt(sp, l), want, `${sp} at Lv${l}`);
    assert.equal(evoAt(sp, l - 1), null, `${sp} not before Lv${l}`);
  }
  const burmy = new Set();
  for (let i = 0; i < 12; i++) { const m = makeMon('BURMY', 19, { rng: new RNG('b' + i) }); burmy.add(addLevels(m, 1).find(e => e.type === 'evolve')?.into); }
  assert.deepEqual([...burmy].sort(), ['MOTHIM', 'WORMADAM'], 'BURMY: either, 50/50');
  // the wild generator shows LEVEL evolutions 6+ levels past (MANTYKE / COMBEE now are LEVEL)
  assert.equal(D.species.MANTYKE.evolutions[0].method, 'LEVEL');
  assert.equal(D.species.RIOLU.evolutions[0].gen4Method, 'FRIENDSHIP_DAY', 'the HGSS method is kept for the POKéDEX');
});
t('KNOWS_MOVE: evolves on a level-up knowing / learning the move, else at Lv40; the move is in its learnset', () => {
  for (const [sp, [l, mv]] of Object.entries(KNOWS_MOVE_LEARN)) assert.ok(D.species[sp].learnset.some(([x, m]) => x === l && m === mv), `${sp} learns ${mv} at ${l}`);
  assert.equal(evoAt('LICKITUNG', 33), 'LICKILICKY', 'learns ROLLOUT at 33');
  assert.equal(evoAt('LICKITUNG', 32), null);
  assert.equal(evoAt('TANGELA', 33), 'TANGROWTH');
  assert.equal(evoAt('YANMA', 33), 'YANMEGA');
  assert.equal(evoAt('AIPOM', 32), 'AMBIPOM');
  assert.equal(evoAt('BONSLY', 17), 'SUDOWOODO');
  assert.equal(evoAt('MIME_JR', 18), 'MR_MIME');
  assert.equal(evoAt('PILOSWINE', 35), null, 'PILOSWINE (ANCIENTPOWER at Lv1) waits');
  assert.equal(evoAt('PILOSWINE', 35, m => { m.moves[0] = { move: 'ANCIENT_POWER', copies: 2 }; }), 'MAMOSWINE', '... unless it knows it (relearner)');
  assert.equal(evoAt('PILOSWINE', KNOWS_MOVE_LEVEL), 'MAMOSWINE', `... or at Lv${KNOWS_MOVE_LEVEL}`);
  // SWINUB (a starter) still becomes PILOSWINE first
  assert.equal(evoAt('SWINUB', 33), 'PILOSWINE');
});
t('evolving into a Gen 4 form keeps HP damage and learns its new moves', () => {
  const m = mon('EEVEE', 30);
  m.hp -= 10;
  const into = itemEvolution(m, 'LEAF_STONE');
  evolve(m, into);
  assert.equal(m.species, 'LEAFEON');
  assert.ok(m.hp > 0 && m.hp < makeMon('LEAFEON', 30, { rng: rng(), ivs: m.ivs }).hp);
});

// ---- 4. moves --------------------------------------------------------------------------------------------------
t('Gen 4 learnsets: wild / trainer moves, level-up learning, never a NO_PLAYER_MOVES move for the player', () => {
  for (const s of list) {
    const key = Object.keys(g4.species).find(k => g4.species[k] === s);
    for (const lvl of [5, 20, 40, 60]) {
      const mv = defaultMoves(key, lvl);
      assert.ok(mv.length >= 1 && mv.every(m => D.moves[m]), `${key} Lv${lvl} default moves`);
      const p = makeMon(key, lvl, { rng: rng() });
      assert.ok(p.moves.every(x => D.moves[x.move] && !NO_PLAYER_MOVES.has(x.move)), `${key} Lv${lvl} player moves`);
      assert.ok(movesLearnedAt(key, lvl).every(m => !NO_PLAYER_MOVES.has(m)));
    }
  }
  assert.ok(defaultMoves('GARCHOMP', 48).includes('DRAGON_RUSH') || defaultMoves('GARCHOMP', 48).some(m => D.moves[m].type === 'DRAGON'), 'GARCHOMP fights like a dragon');
  // a wild Gen 4 foe uses its learnset
  const e = makeEnemy('LUXRAY', 40, { rng: rng() });
  assert.ok(e.moves.every(x => D.species.LUXRAY.learnset.some(([, m]) => m === (x.move || x))), 'wild LUXRAY moves');
  // level-up learning: TURTWIG learns RAZOR LEAF at 13
  const tw = mon('TURTWIG', 12);
  assert.ok(addLevels(tw, 1).some(ev => ev.type === 'learn' && ev.move === 'RAZOR_LEAF'));
});

// ---- 5. legendaries ------------------------------------------------------------------------------------------
const G4_LEGENDARY = ['UXIE', 'MESPRIT', 'AZELF', 'DIALGA', 'PALKIA', 'HEATRAN', 'REGIGIGAS', 'GIRATINA', 'CRESSELIA', 'PHIONE', 'MANAPHY', 'DARKRAI', 'SHAYMIN', 'ARCEUS'];
t('the 14 Gen 4 legendaries: LEGENDARY (one per run), in LEGENDS, a rare legendary elite of an act 3+ / post-game, music, moves', () => {
  assert.deepEqual(list.filter(s => s.legendary || s.mythical).map(s => s.name).sort(), [...G4_LEGENDARY].sort());
  for (const sp of G4_LEGENDARY) assert.ok(LEGENDARY.has(sp), `LEGENDARY ${sp}`);
  assert.equal(Object.keys(GEN4_LEGENDS).length, 14);
  const bank = JSON.parse(fs.readFileSync(path.join(ASSETS, 'sound/bank.json'), 'utf8'));
  const where = {};
  for (const rid of REGION_IDS) REGIONS[rid].acts.forEach((act, i) => {
    for (const [key, p] of act.rareLegends || []) {
      assert.ok(i >= 2, `${rid} act ${i + 1}: rare legendaries only from act 3`);
      assert.ok(p > 0 && p <= RARE_LEGEND, `${key} chance ${p}`);
      (where[LEGENDS[key].species] ||= []).push(`${rid}${i + 1}`);
    }
    assert.ok((act.rareLegends || []).reduce((a, [, p]) => a + p, 0) <= 0.2, `${rid} act ${i + 1}: rare legendaries stay rare`);
  });
  for (const [key, L] of Object.entries(GEN4_LEGENDS)) {
    assert.equal(LEGENDS[key], L);
    assert.ok(where[L.species], `${L.species} appears somewhere`);
    assert.ok(bank.songs[L.music], `${key} music ${L.music}`);
    assert.ok(L.moves.length === 4 && L.moves.every(m => D.moves[m] && D.moves[m].key), `${key} moves ${L.moves}`);
  }
  assert.deepEqual(where.DIALGA, ['johto5']);
  assert.ok(where.ARCEUS.length === 2 && where.ARCEUS.every(w => w.endsWith('5')), 'ARCEUS: ultra-rare, post-game');
});
{
  const spire = (acts, post, a, seed = 'G4L') => {
    const r = Run.create({ starter: 'CHARMANDER', seed, world: 'spire', regions: { acts, summit: acts[3], post }, ascension: 0 });
    if (a) r.startAct(a);
    r.floor = 8; r.nodeId = '8,2';
    r.party = ['BLASTOISE', 'SNORLAX', 'LAPRAS'].map(sp => makeMon(sp, 40, { rng: new RNG('st' + sp) }));
    return r;
  };
  const K = ['kanto', 'kanto', 'kanto', 'kanto'];
  t('rare legendary elite in KANTO act 3: ~10% of elite nodes, MESPRIT at the legendary-elite scale, catchable, never twice', () => {
    let hit = 0, cfg = null;
    const N = 1500;
    for (let i = 0; i < N; i++) {
      const r = spire(K, 'kanto', 2, 'K3_' + i);
      const c = r.eliteConfig(new RNG('e' + i), 8);
      if (c.legend === 'MESPRIT') { hit++; cfg ||= { r, c }; }
    }
    assert.ok(hit / N > 0.06 && hit / N < 0.14, `MESPRIT ${hit}/${N}`);
    const { r, c } = cfg;
    const e = c.enemies[0];
    assert.equal(c.kind, 'wild');
    assert.ok(c.elite && e.legendary && e.species === 'MESPRIT' && c.music === 'mus_vs_legend');
    assert.equal(e.level, r.levelFor(8) + 2 + 3, 'level like the other legendary elites (target + 3)');
    assert.deepEqual(e.moves.map(m => m.move || m), GEN4_LEGENDS.LEGEND_MESPRIT.moves);
    assert.equal(e.maxHp, makeEnemy('MESPRIT', e.level, { ivs: e.ivs, hpScale: r.hpScaleFor(8, 'legend') }).maxHp, 'HP like the other legendary elites');
    // a ball works on it (it's the run's one legendary); with a legendary already taken, it doesn't
    const b = new Battle(r, c);
    b.start();
    assert.equal(b.catchBlockReason(), null);
    // the same act again this run: MESPRIT was used up
    for (let i = 0; i < 200; i++) assert.notEqual(r.eliteConfig(new RNG('again' + i), 8).legend, 'MESPRIT');
    const r2 = spire(K, 'kanto', 2, 'K3_x');
    r2.legendTaken = 'ZAPDOS';
    const b2 = new Battle(r2, { ...c, rng: new RNG('b2') });
    b2.start();
    assert.equal(b2.catchBlockReason(), 'You already have a legendary this run.');
  });
  t('acts 1-2 never field a rare legendary; the usual elite pick is unchanged when none shows up', () => {
    for (let i = 0; i < 300; i++) for (const a of [0, 1]) assert.ok(!spire(K, 'kanto', a, `K${a}_${i}`).eliteConfig(new RNG('e' + i), 8).legend);
    // (rareLegend draws from its own RNG fork: the elite drawn otherwise is what it was)
    for (let i = 0; i < 100; i++) {
      const r = spire(K, 'kanto', 2, 'S' + i), r2 = spire(K, 'kanto', 2, 'S' + i);
      r2.rareLegend = () => null;
      const a = r.eliteConfig(new RNG('q' + i), 8), b = r2.eliteConfig(new RNG('q' + i), 8);
      if (!a.legend) assert.equal(a.trainer?.name, b.trainer?.name);
    }
  });
  t('post-games: DIALGA / PALKIA (JOHTO), GIRATINA / DARKRAI / SHAYMIN (KANTO), REGIGIGAS (HOENN); ARCEUS / MANAPHY ultra-rare', () => {
    const seen = { kanto: {}, hoenn: {}, johto: {} };
    const N = 2500;
    for (const post of ['kanto', 'hoenn', 'johto']) for (let i = 0; i < N; i++) {
      const r = spire(K, post, 4, `P${post}${i}`);
      const c = r.eliteConfig(new RNG('p' + i), 6);
      const sp = c.enemies[0]?.species;
      if (c.legend && G4_LEGENDARY.includes(sp)) seen[post][sp] = (seen[post][sp] || 0) + 1;
    }
    assert.ok(seen.johto.DIALGA && seen.johto.PALKIA && seen.kanto.GIRATINA && seen.kanto.DARKRAI && seen.kanto.SHAYMIN && seen.hoenn.REGIGIGAS, JSON.stringify(seen));
    const total = (o) => Object.values(o).reduce((a, x) => a + x, 0);
    for (const post of ['kanto', 'hoenn', 'johto']) assert.ok(total(seen[post]) / N < 0.2, `${post}: ${total(seen[post])}/${N}`);
    assert.ok((seen.kanto.ARCEUS || 0) < seen.kanto.GIRATINA && (seen.johto.ARCEUS || 0) < seen.johto.DIALGA && (seen.hoenn.MANAPHY || 0) < seen.hoenn.REGIGIGAS, 'mythicals rarer');
  });
  const { duoConfig } = await import('../web/src/game/coop/coop.js');
  t('co-op: a rare legendary elite is one legendary on one slot with co-op HP, the same foe from the same seed', () => {
    let found = null;
    for (let i = 0; i < 400 && !found; i++) {
      const w = spire(K, 'kanto', 2, 'CO' + i);
      const node = { id: '8,2', type: 'elite', floor: 8 };
      const c = duoConfig(w, node, 2);
      if (c.legend === 'MESPRIT') found = { i, c, again: duoConfig(spire(K, 'kanto', 2, 'CO' + i), node, 2) };
    }
    assert.ok(found, 'some co-op elite node is MESPRIT');
    const { c, again } = found;
    assert.equal(c.slots, 1);
    assert.equal(c.enemies.length, 1);
    assert.ok(c.enemies[0].coopHp >= 1 && c.coopKind === 'legend');
    assert.equal(again.enemies[0].maxHp, c.enemies[0].maxHp, 'deterministic');
  });
}

// ---- 6. assets -----------------------------------------------------------------------------------------------
t('cries: the Gen 4 species are not in FireRed\'s bank (so Sound plays their WAV); main.js wires D.species[key].cryWav', () => {
  const bank = JSON.parse(fs.readFileSync(path.join(ASSETS, 'sound/bank.json'), 'utf8'));
  for (const s of list) assert.equal(bank.cries.speciesNames[s.gfx.replace(/[^a-z0-9]/g, '')], undefined, s.name);
  assert.ok(/setWavCries\(key => \{ const w = D\.species\[key\]\?\.cryWav/.test(fs.readFileSync(path.join(ROOT, 'web/src/main.js'), 'utf8')));
  const snd = fs.readFileSync(path.join(ROOT, 'web/src/audio/sound.js'), 'utf8');
  assert.ok(/const wav = typeof species === 'string' && state\.wavCry/.test(snd) && /decodeAudioData/.test(snd));
});
t('the new stones have icons (HGSS art; the ICE STONE borrows NEVER-MELTICE\'s)', () => {
  for (const k of ['SHINY_STONE', 'DUSK_STONE', 'DAWN_STONE', 'ICE_STONE']) assert.ok(fs.existsSync(path.join(ASSETS, 'gfx/items', CONSUMABLES[k].icon + '.png')), k);
});

console.log(`gen4 tests: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
