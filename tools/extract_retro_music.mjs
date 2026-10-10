#!/usr/bin/env node
// Extracts the Game Boy music for the RETRO music option (web/src/audio/retro.js) from the user's own ROMs:
//   Pokemon Red (USA, Europe)        SHA-1 ea9bcae617fdf159b045185467ae58b2e4a48b9a  (pret/pokered "pokered.gbc")
//   Pokemon Silver (USA, Europe)     SHA-1 49b163f7e57702bc939d642a18f591de55d92dae  (pret/pokegold "pokesilver.gbc")
//
//   node tools/extract_retro_music.mjs --red <pokered.gb> --silver <pokesilver.gbc> [--out web/assets/retro]
//
// Writes (ROM-derived, never committed; shipped as the lazy, on-demand 'retro' asset pack):
//   retro/red.bin      Red's three audio banks ($02, $08, $1F: the three copies of the sound engine's data)
//   retro/silver.bin   Silver's audio banks ($3A engine + music, $3B-$3D music, $3C fanfares)
//   retro/retro.json   where each song's header and the engine tables sit in those banks
// The songs stay in their original sequence format: web/src/audio/gb-core.js is a port of both games' sound
// engines (pret's audio/engine*.asm) driving an emulated Game Boy APU, so nothing is re-encoded.
//
// The addresses below come from pret's symbol files (github.com/pret/pokered and pret/pokegold, branch "symbols")
// for exactly these ROM revisions, which is why the SHA-1s are checked. Every song is also walked here (all
// branches, calls and loops) to prove that it parses and stays inside the extracted banks.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const arg = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const RED = arg('--red', path.join(ROOT, 'rom', 'pokered.gb'));
const SILVER = arg('--silver', path.join(ROOT, 'rom', 'pokesilver.gbc'));
const OUT = path.resolve(arg('--out', path.join(ROOT, 'web', 'assets', 'retro')));

const SHA = { red: 'ea9bcae617fdf159b045185467ae58b2e4a48b9a', silver: '49b163f7e57702bc939d642a18f591de55d92dae' };

// ---- Red (pokered.sym) ------------------------------------------------------------------------------------------
// Each audio bank holds one copy of the engine, its SFX header table (sound IDs: (header - $4000) / 3, the noise
// instruments the drums play are IDs 1-19), the channel-3 wave pointers and the pitch table.
const RED_BANKS = [0x02, 0x08, 0x1f];
const RED_TABLES = {
  0x02: { sfxHeaders: 0x4000, wavePointers: 0x4361, pitches: 0x5b2f },
  0x08: { sfxHeaders: 0x4000, wavePointers: 0x4361, pitches: 0x62ee },
  0x1f: { sfxHeaders: 0x4000, wavePointers: 0x4361, pitches: 0x5ba3 },
};
// name: [bank, header]; SFX_* are the jingles (they play on the SFX channels 5-8 with execute_music)
const RED_SONGS = {
  PalletTown: [2, 0x422e], Pokecenter: [2, 0x4237], Gym: [2, 0x4240], Cities1: [2, 0x4249], Cities2: [2, 0x4255],
  Celadon: [2, 0x425e], Cinnabar: [2, 0x4267], Vermilion: [2, 0x4270], Lavender: [2, 0x427c], SSAnne: [2, 0x4288],
  MeetProfOak: [2, 0x4291], MeetRival: [2, 0x429a], MuseumGuy: [2, 0x42a3], SafariZone: [2, 0x42af],
  PkmnHealed: [2, 0x42b8], Routes1: [2, 0x42c1], Routes2: [2, 0x42cd], Routes3: [2, 0x42d9], Routes4: [2, 0x42e5],
  IndigoPlateau: [2, 0x42f1],
  GymLeaderBattle: [8, 0x42be], TrainerBattle: [8, 0x42c7], WildBattle: [8, 0x42d0], FinalBattle: [8, 0x42d9],
  DefeatedTrainer: [8, 0x42e2], DefeatedWildMon: [8, 0x42eb], DefeatedGymLeader: [8, 0x42f4],
  TitleScreen: [0x1f, 0x4249], Credits: [0x1f, 0x4255], HallOfFame: [0x1f, 0x425e], OaksLab: [0x1f, 0x4267],
  JigglypuffSong: [0x1f, 0x4270], BikeRiding: [0x1f, 0x4276], Surfing: [0x1f, 0x4282], GameCorner: [0x1f, 0x428b],
  IntroBattle: [0x1f, 0x4294], Dungeon1: [0x1f, 0x42a0], Dungeon2: [0x1f, 0x42ac], Dungeon3: [0x1f, 0x42b8],
  CinnabarMansion: [0x1f, 0x42c4], PokemonTower: [0x1f, 0x42d0], SilphCo: [0x1f, 0x42d9],
  MeetEvilTrainer: [0x1f, 0x42e2], MeetFemaleTrainer: [0x1f, 0x42eb], MeetMaleTrainer: [0x1f, 0x42f4],
  SFX_Get_Item1: [2, 0x4192], SFX_Get_Item2: [2, 0x419b], SFX_Pokedex_Rating: [2, 0x41b3], SFX_Get_Key_Item: [2, 0x41bc],
  SFX_Level_Up: [8, 0x4192], SFX_Dex_Page_Added: [8, 0x41c8], SFX_Caught_Mon: [8, 0x41ce],
};

// ---- Silver (pokesilver.sym) ------------------------------------------------------------------------------------
const SILVER_BANKS = [0x3a, 0x3b, 0x3c, 0x3d];
const SILVER_TABLES = { engineBank: 0x3a, music: 0x506e, sfx: 0x525e, frequencyTable: 0x4d80, waveSamples: 0x4db2, drumkits: 0x4e52 };
// pokegold audio/music_pointers.asm order (MUSIC_* ids); Credits and PostCredits sit outside the audio banks: skipped
const SILVER_MUSIC = ['Nothing', 'TitleScreen', 'Route1', 'Route3', 'Route12', 'MagnetTrain', 'KantoGymBattle',
  'KantoTrainerBattle', 'KantoWildBattle', 'PokemonCenter', 'LookHiker', 'LookLass', 'LookOfficer', 'HealPokemon',
  'LavenderTown', 'Route2', 'MtMoon', 'ShowMeAround', 'GameCorner', 'Bicycle', 'HallOfFame', 'ViridianCity',
  'CeladonCity', 'TrainerVictory', 'WildPokemonVictory', 'GymLeaderVictory', 'MtMoonSquare', 'Gym', 'PalletTown',
  'ProfOaksPokemonTalk', 'ProfOak', 'LookRival', 'AfterTheRivalFight', 'Surf', 'Evolution', 'NationalPark', 'Credits',
  'AzaleaTown', 'CherrygroveCity', 'LookKimonoGirl', 'UnionCave', 'JohtoWildBattle', 'JohtoTrainerBattle', 'Route30',
  'EcruteakCity', 'VioletCity', 'JohtoGymBattle', 'ChampionBattle', 'RivalBattle', 'RocketBattle', 'ElmsLab',
  'DarkCave', 'Route29', 'Route36', 'SSAqua', 'LookYoungster', 'LookBeauty', 'LookRocket', 'LookPokemaniac',
  'LookSage', 'NewBarkTown', 'GoldenrodCity', 'VermilionCity', 'PokemonChannel', 'PokeFluteChannel', 'TinTower',
  'SproutTower', 'BurnedTower', 'Lighthouse', 'LakeOfRage', 'IndigoPlateau', 'Route37', 'RocketHideout', 'DragonsDen',
  'JohtoWildBattleNight', 'RuinsOfAlphRadio', 'SuccessfulCapture', 'Route26', 'Mom', 'VictoryRoad', 'PokemonLullaby',
  'PokemonMarch', 'GoldSilverOpening', 'GoldSilverOpening2', 'MainMenu', 'RuinsOfAlphInterior', 'RocketTheme',
  'DancingHall', 'ContestResults', 'BugCatchingContest', 'LakeOfRageRocketRadio', 'Printer', 'PostCredits'];
// the fanfares (SFX_* ids, audio/sfx_pointers.asm order)
const SILVER_SFX = { SFX_Item: 1, SFX_CaughtMon: 2, SFX_Fanfare: 45, SFX_LevelUp: 144, SFX_KeyItem: 145, SFX_Fanfare2: 146,
  SFX_GetEgg: 149, SFX_MoveDeleted: 151, SFX_1stPlace: 153, SFX_GetTm: 155, SFX_GetBadge: 156, SFX_Evolved: 164 };

// ---------------------------------------------------------------------------------------------------------------
function loadRom(file, key) {
  if (!fs.existsSync(file)) { console.error(`${key}: ROM not found: ${file}`); process.exit(1); }
  const rom = fs.readFileSync(file);
  const sha = crypto.createHash('sha1').update(rom).digest('hex');
  if (sha !== SHA[key]) { console.error(`${key}: SHA-1 ${sha} is not the expected ${SHA[key]} (wrong revision?)`); process.exit(1); }
  return rom;
}
const bankBytes = (rom, b) => rom.subarray(b * 0x4000, (b + 1) * 0x4000);

// Walks every channel of a song through all branches; returns { bytes, cmds } or throws.
function walkRed(bank, header, rb) {
  const n = (rb(header) >> 6) + 1;
  const seen = new Set();
  let bytes = 0;
  const chans = [];
  for (let k = 0; k < n; k++) {
    const ch = rb(header + k * 3) & 0xf, ptr = rb(header + k * 3 + 1) | (rb(header + k * 3 + 2) << 8);
    chans.push(ch);
    const work = [[ptr, false]];
    while (work.length) {
      let [pc, exec] = work.pop();
      for (;;) {
        const key = (ch << 17) | (pc << 1) | (exec ? 1 : 0);
        if (seen.has(key)) break;
        seen.add(key);
        if (pc < 0x4000 || pc > 0x7fff) throw new Error(`bank ${bank.toString(16)} ch${ch + 1}: pointer ${pc.toString(16)} outside the bank`);
        const d = rb(pc), hi = d & 0xf0;
        let len = 1, stop = false;
        if (d === 0xff) stop = true;
        else if (d === 0xfd) { work.push([rb(pc + 1) | (rb(pc + 2) << 8), exec]); len = 3; }
        else if (d === 0xfe) { work.push([rb(pc + 2) | (rb(pc + 3) << 8), exec]); len = 4; if (rb(pc + 1) === 0) stop = true; }
        else if (hi === 0xd0) len = ch === 3 ? 1 : 2;
        else if (d === 0xe8 || d === 0xf8) { if (d === 0xf8) exec = true; }
        else if (d === 0xea) len = 3;
        else if (d === 0xeb) len = 4; // (+ the note it slides)
        else if (d === 0xec || d === 0xee || d === 0xef || d === 0xfc || d === 0xf0) len = 2;
        else if (d === 0xed) len = 3;
        else if (hi === 0xe0) len = 1;
        else if (hi === 0x20 && ch >= 3 && !exec) len = ch === 7 ? 3 : 4;
        else if (ch >= 4 && d === 0x10 && !exec) len = 2;
        else if (ch === 3 && hi === 0xb0) len = 2;
        bytes += len;
        if (stop) break;
        pc += len;
      }
    }
  }
  return { bytes, chans };
}

function walkGsc(bank, header, rb, sfx) {
  const n = (rb(header) >> 6) + 1;
  const seen = new Set();
  const chans = [], odd = new Set();
  let bytes = 0;
  for (let k = 0; k < n; k++) {
    const ch = rb(header + k * 3) & 7, ptr = rb(header + k * 3 + 1) | (rb(header + k * 3 + 2) << 8);
    chans.push(ch);
    const work = [[ptr, sfx, false]];
    while (work.length) {
      let [pc, sfxMode, noise] = work.pop();
      for (;;) {
        const key = `${ch}:${pc}:${sfxMode}:${noise}`;
        if (seen.has(key)) break;
        seen.add(key);
        if (pc < 0x4000 || pc > 0x7fff) throw new Error(`bank ${bank.toString(16)} ch${ch + 1}: pointer ${pc.toString(16)} outside the bank`);
        const d = rb(pc);
        let len = 1, stop = false;
        if (d < 0xd0) len = sfxMode ? ((ch & 3) === 3 ? 3 : 4) : 1;
        else if (d <= 0xd7 || d === 0xdf || d === 0xec || d === 0xed || (d >= 0xf1 && d <= 0xf9)) { if (d === 0xdf) sfxMode = !sfxMode; if (d === 0xf9) odd.add('f9'); }
        else if (d === 0xd8) len = (ch & 3) === 3 ? 2 : 3;
        else if ([0xd9, 0xdb, 0xdc, 0xdd, 0xde, 0xe4, 0xe5, 0xef, 0xfa].includes(d)) len = 2;
        else if ([0xe2, 0xe7, 0xe8, 0xe9].includes(d)) { len = 2; odd.add(d.toString(16)); }
        else if (d === 0xda || d === 0xe0 || d === 0xe1 || d === 0xe6) len = 3;
        else if (d === 0xe3 || d === 0xf0) { len = noise ? 1 : 2; noise = !noise; }
        else if (d === 0xea || d === 0xeb || d === 0xee) { len = 3; odd.add(d.toString(16)); }
        else if (d === 0xfb) { work.push([rb(pc + 2) | (rb(pc + 3) << 8), sfxMode, noise]); len = 4; }
        else if (d === 0xfc) { work.push([rb(pc + 1) | (rb(pc + 2) << 8), sfxMode, noise]); stop = true; len = 3; }
        else if (d === 0xfd) { work.push([rb(pc + 2) | (rb(pc + 3) << 8), sfxMode, noise]); len = 4; if (rb(pc + 1) === 0) stop = true; }
        else if (d === 0xfe) { work.push([rb(pc + 1) | (rb(pc + 2) << 8), sfxMode, noise]); len = 3; }
        else if (d === 0xff) stop = true;
        bytes += len;
        if (stop) break;
        pc += len;
      }
    }
  }
  return { bytes, chans, odd: [...odd] };
}

const red = loadRom(RED, 'red'), silver = loadRom(SILVER, 'silver');
const songs = {};
let problems = 0;

// Red
const redBin = Buffer.concat(RED_BANKS.map(b => bankBytes(red, b)));
for (const [name, [bank, header]] of Object.entries(RED_SONGS)) {
  const data = bankBytes(red, bank), rb = a => data[a - 0x4000];
  const sfx = name.startsWith('SFX_');
  try {
    const w = walkRed(bank, header, rb);
    if (!sfx && w.chans.some(c => c > 3)) throw new Error('music on SFX channels');
    if (sfx && w.chans.some(c => c < 4)) throw new Error('jingle on music channels');
    songs['red:' + name] = { game: 'red', bank, header, ...(sfx ? { sfx: true } : {}) };
  } catch (e) { console.error(`red:${name}: ${e.message}`); problems++; }
}
// the 19 noise instruments (drums) of each bank must parse too
for (const bank of RED_BANKS) {
  const data = bankBytes(red, bank), rb = a => data[a - 0x4000];
  for (let id = 1; id <= 19; id++) {
    try { walkRed(bank, 0x4000 + id * 3, rb); } catch (e) { console.error(`red bank ${bank} noise ${id}: ${e.message}`); problems++; }
  }
}

// Silver: the music table (bank, address) for every MUSIC_* id, the SFX table for the fanfares
const sBank = (b) => bankBytes(silver, b);
const eng = sBank(SILVER_TABLES.engineBank), erb = a => eng[a - 0x4000];
const silverBin = Buffer.concat(SILVER_BANKS.map(sBank));
const tableEntry = (table, id) => ({ bank: erb(table + id * 3), header: erb(table + id * 3 + 1) | (erb(table + id * 3 + 2) << 8) });
const oddCmds = {};
SILVER_MUSIC.forEach((name, id) => {
  if (id === 0) return;
  const { bank, header } = tableEntry(SILVER_TABLES.music, id);
  if (!SILVER_BANKS.includes(bank)) return; // (Credits, PostCredits)
  const data = sBank(bank), rb = a => data[a - 0x4000];
  try {
    const w = walkGsc(bank, header, rb, false);
    if (w.odd.length) oddCmds[name] = w.odd;
    songs['silver:' + name] = { game: 'silver', bank, header };
  } catch (e) { console.error(`silver:${name}: ${e.message}`); problems++; }
});
for (const [name, id] of Object.entries(SILVER_SFX)) {
  const { bank, header } = tableEntry(SILVER_TABLES.sfx, id);
  if (!SILVER_BANKS.includes(bank)) { console.error(`silver:${name}: bank ${bank.toString(16)} not extracted`); problems++; continue; }
  const data = sBank(bank), rb = a => data[a - 0x4000];
  try {
    const w = walkGsc(bank, header, rb, true);
    if (w.chans.some(c => c < 4)) throw new Error('fanfare on music channels');
    songs['silver:' + name] = { game: 'silver', bank, header, sfx: true };
  } catch (e) { console.error(`silver:${name}: ${e.message}`); problems++; }
}
if (Object.keys(oddCmds).length) console.log('songs using rarely used commands:', JSON.stringify(oddCmds));
if (problems) { console.error(`${problems} problem(s); nothing written`); process.exit(1); }

const meta = {
  version: 1,
  games: {
    red: { file: 'red.bin', engine: 'red', banks: RED_BANKS, tables: RED_TABLES },
    silver: { file: 'silver.bin', engine: 'gsc', banks: SILVER_BANKS, tables: SILVER_TABLES },
  },
  songs,
};
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'red.bin'), redBin);
fs.writeFileSync(path.join(OUT, 'silver.bin'), silverBin);
fs.writeFileSync(path.join(OUT, 'retro.json'), JSON.stringify(meta));
const n = (g) => Object.values(songs).filter(s => s.game === g).length;
console.log(`wrote ${OUT}: red.bin ${redBin.length} B (${n('red')} songs), silver.bin ${silverBin.length} B (${n('silver')} songs)`);
