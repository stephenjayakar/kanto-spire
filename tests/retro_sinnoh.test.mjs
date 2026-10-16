// AUDIO STYLE: RETRO in SINNOH acts (audio/sinnoh_retro.js + audio/retro.js): every music request the scenes can make
// in a SINNOH act gets a Platinum song ('sinnoh:SEQ_...') when the Sinnoh bank has it, and a Silver / Red stand-in
// when it doesn't; never nothing. KANTO / JOHTO / HOENN keep their songs. Needs no ROM and no retro bank.
//   node tests/retro_sinnoh.test.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { retroSong, RETRO_SONG_SET, SINNOH_RETRO_SET, RETRO_NEXT } from '../web/src/audio/retro.js';
import { sinnohSong, sinnohRetro, nightOf, SINNOH_SONG_SET, SINNOH_MAP_MUSIC, SINNOH_TOWN_MUSIC, SINNOH_CLASS_EYE } from '../web/src/audio/sinnoh_retro.js';
import { SINNOH_ACTS, SINNOH_TRAINERS, SINNOH_TRAINER_CLASSES, SINNOH_LEGENDS, SINNOH_BIRDS } from '../web/src/game/sinnoh.js';
import { LEGENDS, MYTHICS } from '../web/src/game/acts.js';
import { REGIONS } from '../web/src/game/regions.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let passed = 0, failed = 0;
const fails = [];
const ok = (cond, what) => { if (cond) passed++; else { failed++; if (fails.length < 60) fails.push(what); } };
const eq = (got, want, what) => ok(got === want, `${what}: got ${got}, want ${want}`);

const ALL = { has: () => true }, NONE = { has: () => false };
const TODS = [null, 'morn', 'day', 'nite'];
const S = (label) => sinnohRetro(label);
// what run.js trainerInfo() gives the scenes (lower-cased songs)
const info = (key, t) => ({ key, name: t.name, className: t.className, title: `${t.className} ${t.name}`, battleSong: (t.battleSong || 'MUS_VS_TRAINER').toLowerCase(), encounterSong: (t.encounterSong || '').toLowerCase() });

// One request, checked both ways: with the Sinnoh bank (a 'sinnoh:' song from SINNOH_SONG_SET) and without it (a
// Red / Silver stand-in the red/silver bank has). Returns the bank answer.
function both(act, name, ctx, what, tod = null) {
  const a = retroSong(act, name, ctx, { tod, ...ALL });
  ok(typeof a === 'string' && a.startsWith('sinnoh:'), `${what} [bank]: ${a}`);
  ok(a && SINNOH_RETRO_SET.has(a) && SINNOH_SONG_SET.has(a.slice(7)), `${what} [bank]: ${a} not in SINNOH_SONG_SET`);
  const b = retroSong(act, name, ctx, { tod, ...NONE });
  ok(typeof b === 'string' && /^(red|silver):/.test(b) && RETRO_SONG_SET.has(b), `${what} [no bank]: ${b}`);
  // absent env.has = assume the conversions are there (like HOENN's)
  eq(retroSong(act, name, ctx, { tod }), a, `${what} [has absent]`);
  return a;
}

// ---- 0. the tables --------------------------------------------------------------------------------------------------
for (const s of SINNOH_SONG_SET) ok(/^SEQ_[A-Z0-9_]+$/.test(s), `bad label ${s}`);
for (const s of SINNOH_RETRO_SET) ok(!RETRO_SONG_SET.has(s), `${s} leaked into RETRO_SONG_SET (the red/silver bank's list)`);
ok(![...RETRO_SONG_SET].some((s) => s.startsWith('sinnoh:')), 'RETRO_SONG_SET has no sinnoh: songs');
eq(SINNOH_RETRO_SET.size, SINNOH_SONG_SET.size, 'SINNOH_RETRO_SET mirrors SINNOH_SONG_SET');
for (const k of Object.keys(RETRO_NEXT)) ok(!k.startsWith('sinnoh:'), 'no sinnoh RETRO_NEXT needed');
for (const s of SINNOH_SONG_SET) if (/_N$/.test(s)) ok(SINNOH_SONG_SET.has(s.slice(0, -1) + 'D'), `${s} has its day version`);
// the map tables follow the acts' places (every place's `from` has an entry)
for (const act of SINNOH_ACTS) {
  const list = SINNOH_MAP_MUSIC[act.id];
  ok(Array.isArray(list) && list.length, `act ${act.id} has map music`);
  if (!list) continue;
  const froms = new Set(list.map(([f]) => f));
  for (const ar of act.areas) ok(froms.has(ar.from), `act ${act.id}: ${ar.name} (from ${ar.from}) has a map song`);
  for (let i = 1; i < list.length; i++) ok(list[i][0] >= list[i - 1][0], `act ${act.id} map music in order`);
  ok(!!SINNOH_TOWN_MUSIC[act.id], `act ${act.id} has town music`);
}

// every song name the game's code asks for (as tests/retro_audio.mjs scans it)
const names = new Set();
const scan = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name);
  if (e.isDirectory()) { if (e.name !== 'legacy') scan(f); } else if (/\.js$/.test(e.name)) for (const m of fs.readFileSync(f, 'utf8').matchAll(/\b(?:mus|MUS)_[A-Za-z0-9_]+/g)) names.add(m[0].toLowerCase()); } };
scan(path.join(ROOT, 'web/src/game')); scan(path.join(ROOT, 'web/src/scenes'));
for (const n of [...names]) if (!/^mus_[a-z]/.test(n)) names.delete(n);
ok(names.size > 40, `scanned ${names.size} song names`);

const OUTSIDE = new Set(['mus_title', 'mus_oak_lab']); // (outside any act: always Red's)
const legendCfg = (L, kind = 'elite', extra = {}) => ({ kind, enemies: [], terrain: L.terrain, music: L.music, legend: L.title, ...extra });

for (const act of SINNOH_ACTS) {
  const A = `act ${act.id}`;
  // ---- 1. map music at every floor and every place, at every time of day --------------------------------------------
  const progs = new Set([...act.areas.map((a) => a.from), 0.999, 1]);
  for (let f = 0; f <= act.floors; f++) progs.add(f / act.floors);
  for (const prog of progs) for (const tod of TODS) {
    const name = act.music[Math.min(act.music.length - 1, Math.floor(prog * act.music.length))];
    const r = both(act, name, { map: prog }, `${A} map ${prog.toFixed(3)} ${tod}`, tod);
    const day = retroSong(act, name, { map: prog }, { tod: 'day', ...ALL });
    eq(r, tod === 'nite' ? S(nightOf(day.slice(7))) : day, `${A} map ${prog.toFixed(3)} ${tod} time of day`);
  }
  // the newest place reached plays (Run.areaFor's preference)
  for (const ar of act.areas) {
    const want = SINNOH_MAP_MUSIC[act.id].filter(([f]) => f <= ar.from + 0.001).pop()[1];
    eq(retroSong(act, act.music[0], { map: ar.from }, ALL), S(want), `${A} map at ${ar.name}`);
  }
  eq(retroSong(act, act.music[0], { map: 0 }, { tod: 'nite', ...ALL }).endsWith('_D'), false, `${A} night route at the start`);
  // treasure.js: act.music[0] with the floor's progress
  both(act, act.music[0], { map: 0.5 }, `${A} treasure`);

  // ---- 2. towns: events, marts, the POKéMON CENTER -------------------------------------------------------------------
  for (const tod of TODS) {
    const ev = both(act, act.townMusic, { event: 'berries' }, `${A} event ${tod}`, tod);
    eq(ev, S(tod === 'nite' ? nightOf(SINNOH_TOWN_MUSIC[act.id]) : SINNOH_TOWN_MUSIC[act.id]), `${A} event town song ${tod}`);
    const shop = both(act, act.townMusic, null, `${A} mart ${tod}`, tod);
    if (act.townMusic !== 'mus_poke_center') eq(shop, S('SEQ_FS'), `${A} mart song`);
    const pc = both(act, 'mus_poke_center', null, `${A} center ${tod}`, tod);
    eq(pc, S(tod === 'nite' ? 'SEQ_PC_02' : 'SEQ_PC_01'), `${A} center song ${tod}`);
  }
  // events with a song of their own (event.js: ev.music / MUSIC), and every song name the code asks for, any ctx
  for (const n of names) {
    if (OUTSIDE.has(n)) { eq(retroSong(act, n, null, ALL), n === 'mus_title' ? 'red:TitleScreen' : 'red:OaksLab', `${A} ${n}`); continue; }
    const trainerCtx = { kind: 'trainer', trainer: {}, music: 'mus_vs_trainer' };
    ok(retroSong(act, n, { event: 'ghost' }, ALL)?.startsWith('sinnoh:'), `${A} event song ${n} [bank]`);
    ok(!!(retroSong(act, n, { event: 'ghost' }, NONE) || retroSong(act, n, trainerCtx, NONE)), `${A} event song ${n} [no bank]: a stand-in`);
    const bank = retroSong(act, n, null, ALL);
    ok(bank && bank.startsWith('sinnoh:'), `${A} ${n} (no ctx) [bank]: ${bank}`);
    ok(retroSong(act, n, trainerCtx, ALL)?.startsWith('sinnoh:'), `${A} ${n} (battle ctx) [bank]`);
    ok(!!(retroSong(act, n, null, NONE) || retroSong(act, n, trainerCtx, NONE)), `${A} ${n} [no bank]: a stand-in`);
  }

  // ---- 3. battles ------------------------------------------------------------------------------------------------
  // wild (every time of day: Platinum has one wild theme)
  for (const tod of TODS) {
    const w = { kind: 'wild', enemies: [], music: 'mus_vs_wild', ...(tod ? { timeOfDay: tod } : {}) };
    eq(both(act, 'mus_vs_wild', w, `${A} wild ${tod}`, tod), S('SEQ_BA_POKE'), `${A} wild battle`);
    eq(both(act, 'mus_victory_wild', w, `${A} wild victory`, tod), S('SEQ_WINPOKE'), `${A} wild victory`);
  }
  eq(both(act, 'mus_caught_intro', null, `${A} caught intro`), S('SEQ_WINPOKE'), `${A} caught intro`);
  eq(both(act, 'mus_caught', null, `${A} caught`), S('SEQ_WINPOKE'), `${A} caught`);
  // generic route trainers, every class
  for (const [cls] of SINNOH_TRAINER_CLASSES) {
    for (const enc of ['mus_encounter_boy', 'mus_encounter_girl']) {
      const cfg = { kind: 'trainer', trainer: { key: `${cls}:42`, className: cls.split('_')[0], encounterSong: enc, battleSong: 'mus_vs_trainer' }, music: 'mus_vs_trainer' };
      const e = both(act, enc, cfg, `${A} ${cls} encounter`);
      eq(e, S(SINNOH_CLASS_EYE[cls]), `${A} ${cls} encounter song`);
      ok(/^sinnoh:SEQ_EYE_/.test(e), `${A} ${cls} encounter is an EYE song`);
      eq(both(act, 'mus_vs_trainer', cfg, `${A} ${cls} battle`), S('SEQ_BA_TRAIN'), `${A} ${cls} battle song`);
      eq(both(act, 'mus_victory_trainer', cfg, `${A} ${cls} victory`), S('SEQ_WINTRAIN'), `${A} ${cls} victory song`);
    }
  }
  // the act's named trainers: elites, rival, bosses (+ every SINNOH trainer below)
  for (const key of [...(act.elites || []), ...(act.rival ? [act.rival] : []), ...(act.bosses || [])]) {
    if (SINNOH_TRAINERS[key]) continue; // (checked below)
    const L = LEGENDS[key] || SINNOH_LEGENDS[key];
    ok(!!L, `${A}: ${key} is a trainer or a legend`);
    if (!L) continue;
    const boss = (act.bosses || []).includes(key);
    const cfg = boss ? legendCfg(L, 'boss', { legendBoss: true }) : legendCfg(L, 'wild', { elite: true });
    both(act, L.music, cfg, `${A} ${key} battle`);
    eq(both(act, boss ? 'mus_victory_gym_leader' : 'mus_victory_wild', cfg, `${A} ${key} victory`), S('SEQ_WINPOKE'), `${A} ${key} victory song`);
  }
  // the lake guardian (the legendary node) and the rare legendaries
  if (act.bird) {
    const L = LEGENDS[act.bird];
    ok(!!L && !!SINNOH_BIRDS[act.bird], `${A} bird ${act.bird}`);
    const cfg = { kind: 'elite', legendNode: act.bird, enemies: [], terrain: L.terrain, music: L.music, legend: L.title };
    eq(both(act, L.music, cfg, `${A} ${act.bird}`), S('SEQ_BA_DPOKE1'), `${A} ${act.bird} lake guardian theme`);
    eq(both(act, 'mus_victory_trainer', cfg, `${A} ${act.bird} victory`), S('SEQ_WINPOKE'), `${A} ${act.bird} victory`);
  }
  for (const [key] of act.rareLegends || []) both(act, LEGENDS[key].music, legendCfg(LEGENDS[key], 'wild', { elite: true }), `${A} ${key}`);
  // every mythic event and every legendary anywhere (whatever turns up in a SINNOH act)
  for (const [id, M] of Object.entries(MYTHICS)) { const c = { kind: M.wild ? 'wild' : 'elite', mythic: id, enemies: [], music: M.music, legend: M.title }; both(act, M.music, c, `${A} mythic ${id}`); both(act, M.wild ? 'mus_victory_wild' : 'mus_victory_trainer', c, `${A} mythic ${id} victory`); }
  for (const [key, L] of Object.entries(LEGENDS)) both(act, L.music, legendCfg(L, 'wild', { elite: true }), `${A} legend ${key}`);
  // the ELITE FOUR + CHAMPION (act 4)
  (act.gauntlet || []).forEach((key, i) => {
    const t = SINNOH_TRAINERS[key], champion = !!t.champion;
    const tr = info(key, t);
    if (champion) tr.encounterSong = 'mus_encounter_gym_leader';
    const cfg = { kind: 'boss', gauntlet: i, trainer: tr, enemies: [], terrain: 'building', music: champion ? 'mus_vs_champion' : 'mus_vs_gym_leader' };
    eq(both(act, tr.encounterSong, cfg, `${A} ${key} encounter`), S(champion ? 'SEQ_EYE_CHAMP' : 'SEQ_EYE_TENNO'), `${A} ${key} encounter song`);
    eq(both(act, cfg.music, cfg, `${A} ${key} battle`), S(champion ? 'SEQ_BA_CHANP' : 'SEQ_BA_TENNO'), `${A} ${key} battle song`);
    eq(both(act, 'mus_victory_gym_leader', cfg, `${A} ${key} victory`), S(champion ? 'SEQ_WINCHAMP' : 'SEQ_WINTENNO'), `${A} ${key} victory song`);
  });

  // ---- 4. evolution, hall of fame, jingles ----------------------------------------------------------------------------
  eq(both(act, 'mus_evolution_intro', null, `${A} evolution intro`), S('SEQ_SHINKA'), `${A} evolution intro`);
  eq(both(act, 'mus_evolution', null, `${A} evolution`), S('SEQ_SHINKA'), `${A} evolution`);
  eq(both(act, 'mus_hall_of_fame', null, `${A} hall of fame`), S('SEQ_BLD_EV_DENDO2'), `${A} hall of fame`);
  const J = { mus_heal: 'SEQ_ASA', mus_level_up: 'SEQ_FANFA1', mus_obtain_item: 'SEQ_FANFA4', mus_obtain_tmhm: 'SEQ_WAZA', mus_obtain_badge: 'SEQ_BADGE', mus_evolved: 'SEQ_FANFA5', mus_move_deleted: 'SEQ_WASURE' };
  for (const [n, l] of Object.entries(J)) eq(both(act, n, null, `${A} ${n}`), S(l), `${A} jingle ${n}`);
  eq(both(act, 'mus_cycling', null, `${A} cycling`), S('SEQ_PL_BICYCLE'), `${A} cycling`);
  eq(both(act, 'mus_surf', null, `${A} surf`), S('SEQ_NAMINORI'), `${A} surf`);
  // the game-over / co-op end screens
  for (const n of ['mus_victory_road', 'mus_obtain_badge', 'mus_slow_pallet', 'mus_poke_tower']) both(act, n, null, `${A} end screen ${n}`);
}

// every SINNOH trainer, in any act it can turn up in, by its role
const ROLE = (key, t) => /^LEADER_/.test(key) ? ['mus_encounter_gym_leader', 'SEQ_BA_GYM', 'SEQ_BA_GYM', 'SEQ_WINTGYM', 'boss']
  : /^GALACTIC_BOSS/.test(key) ? ['mus_encounter_rocket', 'SEQ_THE_AKAGI', 'SEQ_BA_AKAGI', 'SEQ_WINAKAGI', 'elite']
    : /^COMMANDER_/.test(key) ? ['mus_encounter_rocket', 'SEQ_EYE_GINGA', 'SEQ_BA_GINGA3', 'SEQ_WINGINGA', 'elite']
      : /^GALACTIC_/.test(key) ? ['mus_encounter_rocket', 'SEQ_EYE_GINGA', 'SEQ_BA_GINGA', 'SEQ_WINGINGA', 'elite']
        : /^BARRY/.test(key) ? ['mus_encounter_rival', 'SEQ_THE_RIV', 'SEQ_BA_RIVAL', 'SEQ_WINTRAIN', 'rival']
          : /^(ELITE_FOUR|CHAMPION)_/.test(key) ? null
            : [(t.encounterSong || '').toLowerCase(), SINNOH_CLASS_EYE[key], 'SEQ_BA_TRAIN', 'SEQ_WINTRAIN', 'elite'];
for (const act of SINNOH_ACTS) for (const [key, t] of Object.entries(SINNOH_TRAINERS)) {
  const role = ROLE(key, t);
  if (!role) continue;
  const [enc, eye, ba, win, kind] = role;
  const tr = info(key, t);
  if (kind === 'rival') tr.encounterSong = REGIONS.sinnoh.rival.encounterSong; // (run.js rivalConfig)
  const cfg = kind === 'boss' ? { kind: 'boss', trainer: tr, enemies: [], terrain: 'building', music: 'mus_vs_gym_leader' }
    : kind === 'rival' ? { kind: 'elite', rival: true, trainer: tr, enemies: [], music: 'mus_vs_trainer' }
      : { kind: 'elite', trainer: tr, enemies: [], music: tr.battleSong };
  const W = `act ${act.id} ${key}`;
  eq(tr.encounterSong, enc, `${W} encounter song in the data`);
  eq(both(act, tr.encounterSong || 'mus_encounter_boy', cfg, `${W} encounter`), S(eye), `${W} encounter`);
  eq(both(act, cfg.music, cfg, `${W} battle`), S(ba), `${W} battle`);
  eq(both(act, kind === 'boss' ? 'mus_victory_gym_leader' : 'mus_victory_trainer', cfg, `${W} victory`), S(win), `${W} victory`);
}
// legendary themes (pret enc_effects.c)
const LEG = { MESPRIT: 'SEQ_BA_DPOKE1', AZELF: 'SEQ_BA_DPOKE1', UXIE: 'SEQ_BA_DPOKE1', DIALGA: 'SEQ_BA_DPOKE2', PALKIA: 'SEQ_BA_DPOKE2',
  GIRATINA: 'SEQ_PL_BA_GIRA', HEATRAN: 'SEQ_BA_SECRET2', REGIGIGAS: 'SEQ_BA_SECRET2', DARKRAI: 'SEQ_BA_SECRET2',
  CRESSELIA: 'SEQ_BA_POKE', SHAYMIN: 'SEQ_BA_POKE', ARCEUS: 'SEQ_BA_SECRET1', REGIROCK: 'SEQ_PL_BA_REGI' };
const act5 = SINNOH_ACTS.find((a) => a.id === 5);
for (const [title, l] of Object.entries(LEG)) eq(retroSong(act5, 'mus_vs_legend', { kind: 'wild', legend: title, music: 'mus_vs_legend' }, ALL), S(l), `legend ${title}`);
const gira = SINNOH_LEGENDS.LEGEND_GIRATINA_ORIGIN;
eq(retroSong(act5, gira.music, legendCfg(gira, 'boss', { legendBoss: true }), ALL), S('SEQ_PL_BA_GIRA'), 'GIRATINA ORIGIN boss');
eq(retroSong(act5, 'mus_victory_gym_leader', legendCfg(gira, 'boss', { legendBoss: true }), ALL), S('SEQ_WINPOKE'), 'GIRATINA ORIGIN victory');

// ---- 5. a partial bank: each missing song falls back on its own ------------------------------------------------------
{
  const act = SINNOH_ACTS[0];
  const has = (n) => n !== 'sinnoh:SEQ_BA_POKE';
  eq(retroSong(act, 'mus_vs_wild', { kind: 'wild', music: 'mus_vs_wild' }, { has }), 'silver:JohtoWildBattle', 'partial bank: missing wild theme -> Silver');
  eq(retroSong(act, 'mus_vs_trainer', { kind: 'trainer', trainer: { key: 'LASS_JANICE:1' }, music: 'mus_vs_trainer' }, { has }), S('SEQ_BA_TRAIN'), 'partial bank: the others stay');
  eq(retroSong(act, 'mus_vs_trainer', { kind: 'elite', trainer: { key: 'GALACTIC_GRUNT', encounterSong: 'mus_encounter_rocket' }, music: 'mus_vs_trainer' }, NONE), 'silver:RocketBattle', 'no bank: Galactic -> Silver ROCKET');
  eq(retroSong(act, 'mus_vs_trainer', { kind: 'elite', rival: true, trainer: { key: 'BARRY' }, music: 'mus_vs_trainer' }, NONE), 'silver:RivalBattle', 'no bank: BARRY -> Silver rival');
  eq(retroSong(act, 'mus_caught', null, NONE), 'silver:SuccessfulCapture', 'no bank: caught -> Silver (RETRO_NEXT hands over)');
  ok(!!RETRO_NEXT['silver:SuccessfulCapture'], 'Silver caught jingle hands over');
}

// ---- 6. summits across regions (One Spire / A10's second ELITE FOUR) -------------------------------------------------
{
  const kanto4 = { id: 4, region: 'kanto', music: ['mus_victory_road'], townMusic: 'mus_poke_center', summit: 'sinnoh', summits: ['kanto', 'kanto', 'kanto', 'kanto', 'kanto', 'sinnoh', 'sinnoh'] };
  const e4 = { kind: 'boss', gauntlet: 5, trainer: info('ELITE_FOUR_AARON', SINNOH_TRAINERS.ELITE_FOUR_AARON), enemies: [], music: 'mus_vs_gym_leader' };
  eq(retroSong(kanto4, 'mus_vs_gym_leader', e4, ALL), S('SEQ_BA_TENNO'), 'KANTO act, SINNOH summit room: Platinum E4 theme');
  eq(retroSong(kanto4, 'mus_vs_gym_leader', { ...e4, gauntlet: 1 }, ALL), 'red:GymLeaderBattle', 'KANTO act, KANTO summit room: Red');
  eq(retroSong(kanto4, 'mus_hall_of_fame', null, ALL), S('SEQ_BLD_EV_DENDO2'), 'SINNOH summit: Platinum hall of fame');
  eq(retroSong(kanto4, 'mus_route1', { map: 0.2 }, ALL), 'red:Dungeon3', 'KANTO act map stays Red');
  const sin4 = { ...SINNOH_ACTS.find((a) => a.id === 4), summit: 'kanto' };
  eq(retroSong(sin4, 'mus_hall_of_fame', null, ALL), 'red:HallOfFame', 'SINNOH act, KANTO summit: Red hall of fame');
  eq(retroSong(sin4, 'mus_vs_champion', { kind: 'boss', gauntlet: 4, trainer: { key: 'CHAMPION_FIRST' }, music: 'mus_vs_champion' }, ALL), 'red:FinalBattle', 'SINNOH act, KANTO champion: Red');
}

// ---- 7. sinnohSong() directly: pure, label or null -----------------------------------------------------------------
eq(sinnohSong(SINNOH_ACTS[0], null), null, 'no name -> null');
eq(sinnohSong(SINNOH_ACTS[0], 'mus_something_new'), null, 'unknown song -> null (retro.js stand-ins)');
eq(retroSong(SINNOH_ACTS[0], 'mus_something_new', null, ALL), null, 'unknown song -> null (the GBA song plays)');
eq(nightOf('SEQ_ROAD_A_D'), 'SEQ_ROAD_A_N', 'nightOf route');
eq(nightOf('SEQ_D_02'), 'SEQ_D_02', 'nightOf dungeon');

// ---- 8. KANTO / JOHTO / HOENN unchanged (the pre-SINNOH retroSong's answers) -----------------------------------------
{
  const N = ['mus_route1', 'mus_celadon', 'mus_poke_center', 'mus_vs_wild', 'mus_vs_trainer', 'mus_vs_champion', 'mus_victory_trainer', 'mus_encounter_girl', 'mus_encounter_gym_leader', 'mus_caught', 'mus_obtain_badge', 'mus_move_deleted', 'mus_hall_of_fame'];
  const C = { none: null, map: { map: 0.6 }, wild: { kind: 'wild', music: 'mus_vs_wild' },
    trainer: { kind: 'trainer', music: 'mus_vs_trainer', trainer: { key: 'RS_LASS:1', className: 'LASS', encounterSong: 'mus_encounter_girl' } },
    champ: { kind: 'boss', gauntlet: 4, music: 'mus_vs_champion', trainer: { key: 'CHAMPION_LANCE', encounterSong: 'mus_encounter_gym_leader' } } };
  const r = (s) => s.split(' ').map((x) => (x === '-' ? null : x));
  const RED = 'red:Routes1 red:Celadon red:Pokecenter red:WildBattle red:TrainerBattle red:FinalBattle red:DefeatedTrainer red:MeetFemaleTrainer - red:SFX_Caught_Mon red:SFX_Get_Key_Item silver:SFX_MoveDeleted red:HallOfFame';
  const REDMAP = Array(13).fill('red:IndigoPlateau').join(' ').split(' ').map((x, i) => (i === 11 ? 'silver:SFX_MoveDeleted' : x)).join(' ');
  const SIL = (c, v, e, g) => `silver:Route29 ${c} silver:PokemonCenter ${v} silver:JohtoTrainerBattle silver:ChampionBattle silver:TrainerVictory ${e} ${g} silver:SuccessfulCapture silver:SFX_GetBadge silver:SFX_MoveDeleted silver:HallOfFame`;
  const SILMAP = (s) => Array(13).fill(s).map((x, i) => (i === 11 ? 'silver:SFX_MoveDeleted' : x)).join(' ');
  const GOLDEN = {
    kanto: { none: RED, map: REDMAP, wild: RED.replace(' - ', ' red:WildBattle '), trainer: RED.replace(' - ', ' red:TrainerBattle '),
      champ: RED.replace('red:MeetFemaleTrainer - ', 'red:FinalBattle red:FinalBattle ') },
    johto: { none: SIL('silver:PokemonCenter', 'silver:JohtoWildBattle', 'silver:LookLass', '-'), map: SILMAP('silver:VictoryRoad'),
      wild: SIL('silver:GoldenrodCity', 'silver:JohtoWildBattleNight', 'silver:LookLass', 'silver:JohtoWildBattle'),
      trainer: SIL('silver:GoldenrodCity', 'silver:JohtoWildBattleNight', 'silver:LookLass', 'silver:JohtoTrainerBattle'),
      champ: SIL('silver:GoldenrodCity', 'silver:JohtoWildBattleNight', 'silver:ChampionBattle', 'silver:ChampionBattle') },
  };
  const HOENN_ALL = {
    none: 'silver:Route29 hoenn:mus_ever_grande hoenn:mus_poke_center hoenn:mus_vs_wild hoenn:mus_vs_trainer hoenn:mus_vs_champion hoenn:mus_victory_trainer hoenn:mus_encounter_female - silver:SuccessfulCapture hoenn:mus_obtain_badge silver:SFX_MoveDeleted hoenn:mus_hall_of_fame',
    map: SILMAP('hoenn:mus_ever_grande'),
    wild: 'silver:Route29 silver:GoldenrodCity hoenn:mus_poke_center hoenn:mus_vs_wild hoenn:mus_vs_trainer hoenn:mus_vs_champion hoenn:mus_victory_trainer hoenn:mus_encounter_female silver:JohtoWildBattle silver:SuccessfulCapture hoenn:mus_obtain_badge silver:SFX_MoveDeleted hoenn:mus_hall_of_fame',
    trainer: 'silver:Route29 silver:GoldenrodCity hoenn:mus_poke_center hoenn:mus_vs_wild hoenn:mus_vs_trainer hoenn:mus_vs_champion hoenn:mus_victory_trainer hoenn:mus_encounter_female hoenn:mus_encounter_female silver:SuccessfulCapture hoenn:mus_obtain_badge silver:SFX_MoveDeleted hoenn:mus_hall_of_fame',
    champ: 'hoenn:mus_vs_champion hoenn:mus_vs_champion hoenn:mus_vs_champion hoenn:mus_vs_champion hoenn:mus_vs_champion hoenn:mus_vs_champion hoenn:mus_victory_league hoenn:mus_encounter_champion hoenn:mus_encounter_champion hoenn:mus_vs_champion hoenn:mus_vs_champion silver:SFX_MoveDeleted hoenn:mus_vs_champion',
  };
  const HOENN_NONE = {
    none: SIL('silver:IndigoPlateau', 'silver:JohtoWildBattle', 'silver:LookLass', '-'), map: SILMAP('silver:IndigoPlateau'),
    wild: SIL('silver:GoldenrodCity', 'silver:JohtoWildBattle', 'silver:LookLass', 'silver:JohtoWildBattle'),
    trainer: SIL('silver:GoldenrodCity', 'silver:JohtoWildBattle', 'silver:LookLass', 'silver:LookLass'),
    champ: 'silver:ChampionBattle silver:ChampionBattle silver:ChampionBattle silver:ChampionBattle silver:ChampionBattle silver:ChampionBattle silver:GymLeaderVictory silver:ChampionBattle silver:ChampionBattle silver:ChampionBattle silver:ChampionBattle silver:SFX_MoveDeleted silver:ChampionBattle',
  };
  for (const region of ['kanto', 'johto', 'hoenn']) {
    const act = { id: 4, region, music: ['mus_route1'], townMusic: 'mus_celadon', summit: region };
    for (const [ck, c] of Object.entries(C)) for (const hk of ['all', 'none']) {
      const env = hk === 'none' ? { tod: 'nite', has: () => false } : { tod: 'nite' };
      const want = r(region === 'hoenn' ? (hk === 'all' ? HOENN_ALL : HOENN_NONE)[ck] : GOLDEN[region][ck]);
      N.forEach((n, i) => eq(retroSong(act, n, c, env), want[i], `${region} ${n} ${ck}/${hk} unchanged`));
    }
    // and never a SINNOH song outside SINNOH
    for (const n of names) for (const c of Object.values(C)) ok(!String(retroSong(act, n, c, ALL)).startsWith('sinnoh:'), `${region} ${n}: no sinnoh song`);
  }
}

// The Sinnoh bank itself, when this machine has it (tools/sinnoh_chip/build_bank.mjs, from the player's Platinum ROM):
// every song the game can ask for is in it and plays on its own (no Red / Silver loaded), making sound within 10 s.
{
  const dir = path.join(ROOT, 'web/assets/retro_sinnoh');
  if (fs.existsSync(path.join(dir, 'sinnoh.json'))) {
    const { GbPlayer } = await import('../web/src/audio/gb-core.js');
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'sinnoh.json'), 'utf8'));
    const b = fs.readFileSync(path.join(dir, meta.games.sinnoh.file || 'sinnoh.bin'));
    const bin = b.buffer.slice(b.byteOffset, b.byteOffset + b.length);
    ok(!meta.games.sinnoh.base, 'the sinnoh bank is self-contained (no base game)');
    for (const label of SINNOH_SONG_SET) {
      const p = new GbPlayer(22050, () => {}, { render: 'dmg' });
      p.load(meta, { sinnoh: bin.slice(0) });
      const name = sinnohRetro(label);
      if (!p.has(name)) { ok(false, `${name}: not in the bank`); continue; }
      p.playBgm(name);
      const L = new Float32Array(2205), R = new Float32Array(2205);
      let peak = 0;
      for (let k = 0; k < 100 && peak < 0.01; k++) { p.process(L, R, L.length); for (let i = 0; i < L.length; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i])); }
      ok(peak >= 0.01, `${name}: silent for 10 s`);
    }
    console.log(`sinnoh bank: ${Object.keys(meta.songs).length} songs checked in the player`);
  } else console.log('(no web/assets/retro_sinnoh: bank checks skipped)');
}

console.log(`SINNOH_SONG_SET: ${SINNOH_SONG_SET.size} songs`);
if (fails.length) for (const f of fails) console.log('  FAIL ' + f);
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
