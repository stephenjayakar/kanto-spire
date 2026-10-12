// "?" events (v0.0.7, docs/EVENTS_DESIGN.md): per-act pools for KANTO, HOENN and JOHTO (v0.1.1), plus 6 shrines that can show up in
// any act and scale with it (25% of "?" rooms). Act events happen once per run, a shrine once per act.
//
// Event:  { id, title, npc | mon, world, acts: [actIndex...] | shrine: true, weight, music, text,
//           spawn(probe)?, forced(probe)?, story?, choices }
// Choice: { label: str | (run) => str, cond(run)?, show(run)?, tip?,
//           solo: true      starts a battle: hidden in co-op (co-op battles are duo battles),
//           leave: true     the "do nothing" choice,
//           mon: 'gift' | 'trade' | 'catch'   gift/trade choices are hidden under the NUZLOCKE rules (or replaced by
//                           choice.nuz); a catch counts as that act's one catch (run.nuzEnc),
//           needsMon: 'alive' | 'any' | 'release'  pick a POKéMON first ('release': not your last one),
//           needsRelic: n | { n, filter }   pick held items first (never curses or legendary items),
//           curse: KEY      the choice hands out this curse (hidden while you hold it),
//           ai(run) -> value for the bots (1 ~ a common held item; leave = 0),
//           run(run, rng, mon, relicKeys) -> result }
// Result: { text, newMon, relicChoices, relic, curse, tutor, deleteCards, addCopy, upgrade, itemChoices: {keys, use},
//           overflow, levelEvents, monChoices, battle, next: {text, choices} }
// Event battles (choice.solo) carry extra reward fields read by the reward scene and the bots:
//   rewardRelic, rewardRelicW (a guaranteed held-item choice with these rarity weights), rewardItems, rewardMons
//   (pick one), noMoney (act 4 on), winFlags (story flags set on a win), chainNext(run) -> the next battle of a
//   gauntlet (the RADIO TOWER: started right after a win, no heal; null after the last).
// Labels and texts must be pure functions of the run (no rng): a reload shows the same event the same way.
import { D, bst, speciesName, itemName, moveName, DEX_MAX } from './data.js';
import { makeMon, addLevels, maxHp, isFainted, healFrac, monName, canLearn, knowsMove, defaultCopies, typesOf, defaultMoves, NO_PLAYER_MOVES, LEGENDARY } from './pokemon.js';
import { makeEnemy } from './battle.js';
import { RELICS, CONSUMABLES, BALLS, APRICORN_BALLS, isCurse } from './items.js';
import { BOSS_RULES } from './bosses.js';
import { regionOf, regionIdOf, ruleKeyOf } from './regions.js';
import { MYTHICS } from './acts.js';
import { RNG } from './rng.js';

export const SHRINE_SHARE = 0.25;

// ---- helpers (scaled by act: docs/EVENTS_DESIGN.md section 3) ------------------------------------------------
const act = (r) => r.actIndex || 0;
const reg = (r) => regionOf(regionIdOf(r)); // the region of the act the run is in (game/regions.js)
const floorOf = (r) => Math.max(0, r.floor ?? 0);
export const lvl = (r, off = 0) => Math.max(2, r.levelFor(floorOf(r)) + off);
const cost = (r, base) => r.price(base); // act multiplier + A4 markup + IOU NOTE
// Money rewards scale with the act but skip the A4 markup, and stop from act 4 on (owner's call: no event
// money in act 4, the Elite Four act or the post-game).
export const moneyReward = (r, base) => (act(r) >= 3 ? 0 : Math.round(base * (1 + 0.3 * act(r)) / 10) * 10);
const giveMoney = (r, base) => { const n = moneyReward(r, base); if (n > 0) r.addMoney(n); return n; };
const pay = (r, base) => { const n = cost(r, base); r.money -= n; return n; };
const canPay = (r, base) => r.money >= cost(r, base);
const alive = (r) => r.party.filter(m => !isFainted(m));
export const teamHp = (r) => r.party.reduce((a, m) => a + Math.max(0, m.hp) / maxHp(m), 0) / Math.max(1, r.party.length);
export function hurt(r, frac, mons = r.party) { for (const m of mons) if (!isFainted(m)) m.hp = Math.max(1, m.hp - Math.floor(maxHp(m) * frac)); }
function healAll(r, frac, cure = false) { for (const m of r.party) if (!isFainted(m)) { healFrac(m, frac); if (cure) m.status = null; } }
const flags = (r) => (r.flags ||= {});
const has = (r, k) => (r.relics || []).some(x => x.key === k);
const gift = (r, rng, sp, off = 0, minIV = 10) => makeMon(sp, lvl(r, off), { rng, minIV, caughtAct: act(r) });
const found = (r, keys) => keys.filter(k => !r.addConsumable(k)); // what didn't fit: the overflow (the UI offers it)
const fullNote = (overflow) => (overflow.length ? ' But your BAG is full...' : '');
const W = { common: { common: 100 }, uncommon: { uncommon: 100 }, rare: { rare: 100 }, mid: { common: 40, uncommon: 60 }, high: { uncommon: 50, rare: 50 } };
const relics = (r, rng, n, w) => r.relicChoices(rng, n, w);
const fromList = (r, rng, n, list) => rng.sample(list.filter(k => RELICS[k] && D.items[k] && !has(r, k)), n);
const VITAMINS = ['RED_SHARD', 'HP_UP', 'PROTEIN', 'IRON', 'BLUE_SHARD', 'CALCIUM'];
const vitamins = (rng, n) => rng.sample(VITAMINS.filter(k => D.items[k]), n);
const heldRelics = (r) => (r.relics || []).filter(x => !isCurse(x.key) && !RELICS[x.key]?.legendary).map(x => x.key);
export const relicCountOf = (p) => p.relicCount ?? (p.relics || []).filter(x => !isCurse(x.key)).length;
export const cursesOf = (r) => (r.relics || []).filter(x => isCurse(x.key)).map(x => x.key);
function addCurse(r, key) { if (has(r, key)) return null; r.addRelic(key); r.logEvent?.({ k: 'curse', item: key }); return key; }
export function removeCurse(r, key) { if (!isCurse(key) || !has(r, key)) return false; r.removeRelic(key); r.logEvent?.({ k: 'cleanse', item: key }); return true; }
const CURSE_TEXT = (key) => ` ${/^[AEIOU]/.test(itemName(key)) ? 'An' : 'A'} ${itemName(key)} clings to you! (curse)`;
const rarityRank = { common: 0, uncommon: 1, rare: 2 };
const bstAll = (s) => s ? s.stats.hp + s.stats.atk + s.stats.def + s.stats.spa + s.stats.spd + s.stats.spe : 0;
// (LEGENDARY: pokemon.js, shared with ONE LEGENDARY PER RUN)
const seededPick = (r, list, salt) => { let h = 0; for (const ch of `${r.seed}:${act(r)}:${r.nodeId}:${salt}`) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return list[h % list.length]; };

// ---- NUZLOCKE (A8): an event catch is that act's one catch -----------------------------------------------
export const nuzCatchOk = (r) => !r.nuzlocke || (r.nuzEnc || {})[String(act(r))] === undefined;
function useNuzCatch(r) { if (!r.nuzlocke) return; r.nuzEnc ||= {}; r.nuzEnc[String(act(r))] = 'event:' + r.nodeId; }

// ---- battles ---------------------------------------------------------------------------------------------
function eventBattle(r, cfg, extra = {}) {
  Object.assign(cfg, extra);
  cfg.event = true;
  if (act(r) >= 3) cfg.noMoney = true; // no event money from act 4 on
  return cfg;
}
const trainersLike = (re, min = 2) => Object.values(D.trainers).filter(t => !t.dummy && re.test(t.key) && (t.party?.length || 0) >= min);
function eliteFight(r, rng, pool, extra) {
  const list = pool.map(t => (typeof t === 'string' ? D.trainers[t] : t)).filter(t => t && !t.dummy && t.party?.length);
  return eventBattle(r, r.eliteConfigFromTrainer(rng, rng.pick(list)), extra);
}
function trainerFight(r, rng, pool, extra) {
  const t = rng.pick(pool.filter(t => t && t.party?.length));
  const floor = floorOf(r);
  const enemies = r.makeTrainerEnemies(rng, t, r.levelFor(floor) + 1, 'trainer', r.partyCap(floor), { floor });
  const info = r.trainerInfo(t);
  return eventBattle(r, { kind: 'trainer', trainer: info, enemies, terrain: r.terrainForTrainer(t), music: info.battleSong, dmgScale: r.dmgScale(), rng }, extra);
}
function wildFight(r, rng, sp, off, extra = {}) {
  const { moves, terrain = 'grass', music = 'mus_vs_wild', elite = true, dmg = 1 } = extra;
  const e = makeEnemy(sp, lvl(r, off), { rng, hpScale: r.hpScaleFor(floorOf(r), elite ? 'elite' : 'wild'), moves, isElite: elite });
  const cfg = { kind: 'wild', elite, enemies: [e], terrain, music, dmgScale: r.dmgScale() * dmg, rng };
  if (r.nuzlocke) cfg.nuzFirst = nuzCatchOk(r) ? (useNuzCatch(r), true) : false;
  return eventBattle(r, cfg, extra.cfg || {});
}
// A one-off trainer of our own (WALLY, the KARATE MASTER) built on a real trainer class.
const custom = (key, name, base, pic, party) => ({ ...(D.trainers[base] || {}), key, name, pic: pic || D.trainers[base]?.pic, dummy: false, maps: [], party: party.map(([species, level]) => ({ species, level, iv: 180, moves: null })) });

// ---- deck edits ------------------------------------------------------------------------------------------
const EXPLODE = new Set(['SELFDESTRUCT', 'SELF_DESTRUCT', 'EXPLOSION', 'FOCUS_PUNCH']);
function learnables(mon) {
  const s = D.species[mon.species];
  const set = new Set();
  for (const [, m] of s?.learnset || []) set.add(m);
  for (const m of s?.tmhm || []) set.add(m.replace(/^(?:TM|HM)\d\d_/, ''));
  for (const m of s?.tutor || []) set.add(m);
  return [...set].filter(m => D.moves[m] && !NO_PLAYER_MOVES.has(m));
}
// The move a card upgrades into: the strongest move of the same type this POKéMON can learn (power <= cap).
export function upgradeTarget(mon, moveKey, cap = 150) {
  const cur = D.moves[moveKey];
  if (!cur || !cur.power) return null;
  const opts = learnables(mon).filter(m => { const d = D.moves[m]; return d.type === cur.type && d.power > cur.power && d.power <= cap && !EXPLODE.has(m) && !knowsMove(mon, m); });
  opts.sort((a, b) => D.moves[b].power - D.moves[a].power || (D.moves[b].accuracy || 100) - (D.moves[a].accuracy || 100));
  return opts[0] || null;
}
// Upgrades one card (keeps its copies, PP UPs included). Returns the new move or null.
export function upgradeMove(mon, index, cap = 150) {
  const slot = mon.moves[index];
  const into = slot && upgradeTarget(mon, slot.move, cap);
  if (!into) return null;
  mon.moves[index] = { move: into, copies: slot.copies || defaultCopies(into) };
  return into;
}
// The best upgrade on a POKéMON (bots, and MEW'S JOURNAL's "every POKéMON"): the biggest power gain.
export function bestUpgrade(mon, cap = 150) {
  let best = null;
  mon.moves.forEach((m, i) => { const into = upgradeTarget(mon, m.move, cap); if (into) { const gain = D.moves[into].power - D.moves[m.move].power; if (!best || gain > best.gain) best = { index: i, into, gain }; } });
  return best;
}
export const powerCap = (r) => [70, 90, 120, 150, 150][act(r)] ?? 150;
// Transforms up to n cards of mon into random moves it can learn (any type, the act's power cap); copies reset.
export function transformMoves(mon, rng, n, cap) {
  const pool = learnables(mon).filter(m => (D.moves[m].power || 0) <= cap && !EXPLODE.has(m) && !knowsMove(mon, m));
  const out = [];
  const idx = rng.sample(mon.moves.map((_, i) => i), Math.min(n, mon.moves.length));
  for (const i of idx) {
    const cands = pool.filter(m => !knowsMove(mon, m));
    if (!cands.length) break;
    const into = rng.pick(cands);
    out.push([mon.moves[i].move, into]);
    mon.moves[i] = { move: into, copies: defaultCopies(into) };
  }
  return out;
}

// ---- move tutor: capped per act (bug fix: act 1 could teach 120-power moves and EXPLOSION) ------------------
export const TUTOR_MOVES = ['MEGA_PUNCH', 'MEGA_KICK', 'BODY_SLAM', 'DOUBLE_EDGE', 'COUNTER', 'SEISMIC_TOSS', 'THUNDER_WAVE', 'ROCK_SLIDE', 'SUBSTITUTE', 'DREAM_EATER', 'SOFT_BOILED', 'METRONOME', 'EXPLOSION', 'SWORDS_DANCE', 'MIMIC', 'FRENZY_PLANT', 'BLAST_BURN', 'HYDRO_CANNON'];
export const TUTOR_CAP = [80, 100, 999, 999, 999];
export function tutorAllowed(run, m) {
  const d = D.moves[m];
  if (!d) return false;
  const a = act(run);
  if ((d.power || 0) > (TUTOR_CAP[a] ?? 999)) return false;
  if ((m === 'EXPLOSION' || d.power >= 150) && a < 2) return false;
  return true;
}
export function tutorChoices(run, rng, n = 3) {
  const out = [];
  for (const mon of run.party) for (const m of TUTOR_MOVES) if (tutorAllowed(run, m) && canLearn(mon.species, m) && !knowsMove(mon, m)) out.push({ uid: mon.uid, move: m });
  return rng.sample(out, n);
}
// TMs as a tutor-style choice ({uid, move}): the first party member that can learn each.
function tmTutor(run, rng, n, cap) {
  const tms = Object.values(D.items).filter(it => /^TM\d\d$/.test(it.key) && it.move && D.moves[it.move] && (D.moves[it.move].power || 0) <= cap);
  const out = [];
  for (const it of rng.shuffle(tms)) {
    const mon = run.party.find(m => canLearn(m.species, it.move) && !knowsMove(m, it.move));
    if (mon && !out.some(o => o.move === it.move)) out.push({ uid: mon.uid, move: it.move });
    if (out.length >= n) break;
  }
  return out;
}

// ---- reusable choices ------------------------------------------------------------------------------------
const LEAVE = (label = 'Leave', text = 'You moved on.') => ({ label, leave: true, ai: () => 0, run: () => ({ text }) });
// AI helpers: an HP cost's weight (worse when the team is hurt), a fight's value.
const hpAi = (r, frac) => frac * 3.5 * (teamHp(r) < 0.6 ? 1.6 : 1);
const fightAi = (r, value, need = 0.75) => (teamHp(r) >= need && !r.party.some(isFainted) ? value - 0.5 : -1);
const roomAi = (r) => (r.party.length < 4 ? 1 : r.party.length < 6 ? 0.6 : 0.2);
const curseAi = 0.9;
function vitaminChoice(r, rng, n = 2) { return { keys: vitamins(rng, n), use: true }; }

// =============================================================================================================
// SHRINES: any act, either world. At most once per act.
// =============================================================================================================
const SHRINES = [
  {
    id: 'deleter', title: 'MOVE DELETER', npc: 'old_man_1', shrine: true, weight: 1,
    text: "Uh... Oh, yes, I'm the MOVE DELETER. I can make POKéMON forget their moves. Shall I trim your deck?",
    choices: [
      { label: 'Forget 1 card (free)', ai: () => 0.45, run: () => ({ text: 'Choose a card to forget.', deleteCards: 1 }) },
      { label: r => `Forget ${act(r) >= 2 ? 3 : 2} cards (all lose 15% HP)`, ai: r => 0.65 - hpAi(r, 0.15), run: (r) => { hurt(r, 0.15); return { text: 'That took a while... your POKéMON are tired. Choose cards to forget.', deleteCards: act(r) >= 2 ? 3 : 2 }; } },
      LEAVE('Leave', 'Come back anytime.'),
    ],
  },
  {
    id: 'tutor', title: 'MOVE TUTOR', npc: 'old_man_2', shrine: true, weight: 1,
    text: "TUTOR: I can teach your POKéMON a technique. My lessons get grander as your journey goes on!",
    choices: [
      { label: 'Learn a move (free)', ai: () => 0.5, run: (r, rng) => ({ text: 'TUTOR: Choose wisely.', tutor: tutorChoices(r, rng, 3) }) },
      { label: r => `Premium lesson ($${cost(r, 600)}): 4 choices, +1 copy`, cond: r => canPay(r, 600), ai: r => (r.money > cost(r, 600) + 1500 ? 0.7 : 0.1), run: (r, rng) => { pay(r, 600); return { text: 'TUTOR: A premium student! The move comes with an extra copy.', tutor: tutorChoices(r, rng, 4), tutorCopy: 1 }; } },
      LEAVE('Leave', 'TUTOR: Suit yourself.'),
    ],
  },
  {
    id: 'copycat', title: 'COPYCAT', npc: 'little_girl', shrine: true, weight: 1, music: 'mus_follow_me',
    text: "COPYCAT: Hi! I copy everything I see! Want me to copy one of your moves? Copy, copy!",
    choices: [
      { label: 'Copy a card (+1 copy)', ai: () => 0.55, run: () => ({ text: 'COPYCAT: Pick a move! Copy!', addCopy: 1 }) },
      { label: 'Copy two cards (all lose 20% HP)', ai: r => 0.95 - hpAi(r, 0.2), run: (r) => { hurt(r, 0.2); return { text: 'COPYCAT: Copy, copy! That was tiring for everyone! Pick two moves!', addCopy: 2 }; } },
      LEAVE('Leave', 'COPYCAT: Copy... leave! Bye!'),
    ],
  },
  {
    id: 'pc', title: r => reg(r).pc.title, npc: r => reg(r).pc.npc, shrine: true, weight: 1, minParty: 2,
    text: r => reg(r).pc.text,
    choices: [
      { label: r => `Wonder trade (stronger, Lv +1)`, mon: 'trade', needsMon: 'any', cond: r => r.party.length >= 2, botMon: 'worst', ai: r => 0.5,
        tip: 'Give a POKéMON (not your last) for a random, stronger species at its level +1.',
        run: (r, rng, mon) => {
          const target = bst(mon.species) + [30, 40, 50, 50, 50][act(r)];
          let pool = Object.values(D.species).filter(s => s.dex && s.dex <= DEX_MAX && Math.abs(bstAll(s) - target) < 40 && !LEGENDARY.has(s.key) && s.key !== mon.species);
          if (!pool.length) pool = Object.values(D.species).filter(s => s.dex && s.dex <= DEX_MAX && bstAll(s) >= target - 60 && !LEGENDARY.has(s.key));
          const s = rng.pick(pool);
          const nm = makeMon(s.key, mon.level + 1, { rng, minIV: 10, caughtAct: act(r) });
          r.party.splice(r.party.indexOf(mon), 1, nm);
          r.addSeen(s.key, true);
          return { text: `${monName(mon)} was traded for ${speciesName(s.key)}!`, traded: nm };
        },
        nuz: { label: 'Tidy up your PC box (+2 levels)', needsMon: 'alive', ai: () => 0.3, run: (r, rng, mon) => ({ text: `The PC's training program gave ${monName(mon)} 2 levels!`, levelEvents: [{ mon, events: addLevels(mon, 2) }] }) } },
      { label: r => { const t = postedTrade(r); return t ? `Posted trade: get ${speciesName(t.sp)}${t.item ? ' + ' + itemName(t.item) : ''}` : 'Posted trade (none today)'; },
        show: r => !!postedTrade(r), mon: 'trade', needsMon: 'any', cond: r => r.party.length >= 2, botMon: 'worst', ai: r => (postedTrade(r)?.item ? 0.7 : 0.25),
        tip: 'A known trade: give any POKéMON (not your last) for this one.',
        run: (r, rng, mon) => {
          const t = postedTrade(r);
          const nm = makeMon(t.sp, Math.max(mon.level, lvl(r)), { rng, minIV: 15, caughtAct: act(r) });
          r.party.splice(r.party.indexOf(mon), 1, nm);
          r.addSeen(t.sp, true);
          if (t.item) r.addRelic(t.item);
          return { text: `${monName(mon)} was traded for ${speciesName(t.sp)}${t.item ? `. It was holding ${itemName(t.item)}!` : '!'}`, relic: t.item || undefined };
        } },
      LEAVE('No thanks', 'Maybe next time!'),
    ],
  },
  {
    id: 'professor', title: r => reg(r).professor.title, npc: r => reg(r).professor.npc, shrine: true, weight: 1, music: 'mus_oak',
    text: r => `${reg(r).professor.name}: Ah, there you are! How is your POKéDEX coming along? You need ${dexBar(r)} species seen for my best gift.`,
    choices: [
      { label: r => `Show your POKéDEX (${r.seen.length}/${dexBar(r)})`, ai: r => (r.seen.length >= dexBar(r) ? 0.9 : 0.2), run: (r, rng) => {
        const n = r.seen.length, prof = reg(r).professor.name;
        if (n >= dexBar(r)) {
          const ch = fromList(r, rng, 2, ['EXP_SHARE', 'TOWN_MAP', 'TM_CASE', ...(act(r) === 0 ? ['OAKS_PARCEL'] : [])]);
          if (ch.length) return { text: `${prof}: ${n} species! Marvelous! Take one of these!`, relicChoices: ch };
        }
        const balls = act(r) >= 2 ? ['ULTRA_BALL', 2] : act(r) === 1 ? ['GREAT_BALL', 3] : ['POKE_BALL', 3];
        r.balls[balls[0]] = (r.balls[balls[0]] || 0) + balls[1];
        return { text: `${prof}: ${n} species. Keep at it! Here, have ${balls[1]} ${itemName(balls[0])}S.` };
      } },
      { label: r => (act(r) >= 2 ? 'Give a POKéMON for research: a vitamin' : 'Give a POKéMON for research: 2 RARE CANDY'), needsMon: 'release', cond: r => r.party.length >= 2, botMon: 'worst', ai: r => (r.party.length >= 5 ? 0.6 : -1),
        tip: 'Release a POKéMON (not your last) to the lab.',
        run: (r, rng, mon) => {
          r.party.splice(r.party.indexOf(mon), 1);
          if (act(r) >= 2) return { text: `${monName(mon)} will help the research. Take a vitamin!`, itemChoices: vitaminChoice(r, rng, 3) };
          const overflow = found(r, ['RARE_CANDY', 'RARE_CANDY']);
          return { text: `${monName(mon)} will help the research. Here are 2 RARE CANDIES!${fullNote(overflow)}`, overflow };
        } },
      LEAVE('Leave', 'Come see me anytime!'),
    ],
  },
  {
    id: 'berries', title: 'BERRY TREE', npc: null, item: 'oran_berry', shrine: true, weight: 1, music: 'mus_berry_pick',
    text: 'You found a tree heavy with BERRIES. Your POKéMON look hungry.',
    choices: [
      { label: 'Pick 2 BERRIES', ai: () => 0.3, run: (r, rng) => {
        const pool = act(r) >= 2 ? ['SITRUS_BERRY', 'LUM_BERRY', 'LIECHI_BERRY', 'SALAC_BERRY', 'PETAYA_BERRY'] : ['ORAN_BERRY', 'SITRUS_BERRY', 'CHESTO_BERRY', 'PECHA_BERRY', 'CHERI_BERRY'];
        const keys = [rng.pick(pool), rng.pick(pool)];
        const overflow = found(r, keys);
        return { text: `You picked ${keys.map(itemName).join(' and ')}!${fullNote(overflow)}`, overflow };
      } },
      { label: r => `Let your team eat (heal ${[30, 35, 40, 40, 40][act(r)]}%)`, ai: r => (1 - teamHp(r)) * 2, run: (r) => { healAll(r, [0.3, 0.35, 0.4, 0.4, 0.4][act(r)]); return { text: 'Your POKéMON ate happily and recovered!' }; } },
    ],
  },
];
const dexBar = (r) => [10, 20, 32, 40, 55][act(r)] ?? 55;
function postedTrade(r) {
  const k = { kanto: [{ sp: 'MR_MIME' }, { sp: 'FARFETCHD', item: 'STICK' }, { sp: 'LICKITUNG', item: 'LEFTOVERS' }], hoenn: [{ sp: 'SEEDOT' }, { sp: 'PLUSLE' }, { sp: 'CORSOLA', item: 'SHELL_BELL' }], johto: [{ sp: 'DUNSPARCE' }, { sp: 'AIPOM', item: 'SILK_SCARF' }, { sp: 'SHUCKLE', item: 'HARD_STONE' }] }[regionIdOf(r)][act(r)];
  if (!k || !D.species[k.sp]) return null;
  if (k.item && has(r, k.item)) return { sp: k.sp };
  return k;
}

// =============================================================================================================
// KANTO
// =============================================================================================================
const ROCKET_GRUNTS = () => trainersLike(/^TEAM_ROCKET_GRUNT/);
const K = (acts, e) => ({ world: 'kanto', acts, ...e });
const KANTO = [
  // ---- Act 1: Route 1 -> Mt. Moon --------------------------------------------------------------------------
  K([0], {
    id: 'oldman', title: "OLD MAN'S LESSON", npc: 'old_man_lying_down', weight: 1,
    text: "OLD MAN: Ahh, I've had my coffee now and I feel great! Sure you can watch me catch a POKéMON!",
    choices: [
      { label: r => (r.nuzlocke ? `Watch the lesson (+$${moneyReward(r, 300)})` : 'Watch the lesson (+3 POKé BALLS)'), ai: () => 0.25, run: (r) => {
        if (r.nuzlocke) { const n = giveMoney(r, 300); return { text: `OLD MAN: You only get one shot anyway! Here, $${n} for your trouble.` }; }
        r.balls.POKE_BALL = (r.balls.POKE_BALL || 0) + 3; return { text: 'OLD MAN: That was the lesson! Take these 3 POKé BALLS.' };
      } },
      { label: r => `Buy him a coffee ($${cost(r, 200)}): his demo POKéMON`, mon: 'gift', cond: r => canPay(r, 200), ai: r => roomAi(r) * 0.6, run: (r, rng) => {
        pay(r, 200); r.balls.GREAT_BALL = (r.balls.GREAT_BALL || 0) + 1;
        const sp = rng.pick(['PIDGEY', 'RATTATA', 'SPEAROW', 'MANKEY', 'NIDORAN_F', 'NIDORAN_M'].filter(s => D.species[s]));
        return { text: `OLD MAN: Ahh, that hits the spot! Take my ${speciesName(sp)} from the demo, and a GREAT BALL.`, newMon: gift(r, rng, sp) };
      }, nuz: { label: r => `Buy him a coffee ($${cost(r, 200)}): a POTION and a tip`, cond: r => canPay(r, 200), ai: () => 0.1, run: (r) => { pay(r, 200); const overflow = found(r, ['SUPER_POTION']); return { text: `OLD MAN: Ahh, that hits the spot! Take this SUPER POTION.${fullNote(overflow)}`, overflow }; } } },
      LEAVE(),
    ],
  }),
  K([0], {
    id: 'parcel', title: "OAK'S PARCEL", npc: 'clerk', weight: 1,
    text: "CLERK: You came from PALLET TOWN? Could you take this PARCEL to PROF. OAK? It's been sitting here for ages.",
    choices: [
      { label: "Deliver it (OAK'S PARCEL)", show: r => !has(r, 'OAKS_PARCEL'), ai: r => (r.nuzlocke ? 0.2 : 0.55), run: (r) => { r.addRelic('OAKS_PARCEL'); r.balls.POKE_BALL = (r.balls.POKE_BALL || 0) + 3; return { text: "OAK: My PARCEL! You can keep the box: it will bring you 3 POKé BALLS every act. Here are the first 3.", relic: 'OAKS_PARCEL' }; } },
      { label: r => `Open it and sell what's inside (+$${moneyReward(r, 500)})`, ai: () => 0.4, run: (r) => { const n = giveMoney(r, 500); return { text: `Some fancy POKé BALLS! A collector paid $${n} for them.` }; } },
      LEAVE('Ignore him', 'CLERK: Oh... OK.'),
    ],
  }),
  K([0], {
    id: 'kakuna', title: 'KAKUNA TREE', npc: null, mon: 'KAKUNA', weight: 1, music: 'mus_viridian_forest',
    text: 'A tree in VIRIDIAN FOREST is full of KAKUNA cocoons. Something shiny glints in the branches...',
    choices: [
      { label: 'Shake it! (50%: a held item, 50%: BEEDRILL)', ai: r => 0.45 - hpAi(r, 0.05), run: (r, rng) => {
        if (rng.chance(0.5)) { const ch = [...fromList(r, rng, 1, ['SILVER_POWDER']), ...relics(r, rng, 1, W.common)].filter((k, i, a) => a.indexOf(k) === i); return { text: 'Something fell out of the tree!', relicChoices: ch.length ? ch : relics(r, rng, 2, W.common) }; }
        for (const m of r.party) if (!isFainted(m) && !m.status) m.status = 'PSN';
        hurt(r, 0.1);
        return { text: 'A swarm of BEEDRILL! Your POKéMON were stung and poisoned!' };
      } },
      { label: 'Collect the honey carefully (2 BERRIES)', ai: () => 0.15, run: (r) => { const keys = ['ORAN_BERRY', 'PECHA_BERRY']; const overflow = found(r, keys); return { text: `You found an ORAN BERRY and a PECHA BERRY near the roots.${fullNote(overflow)}`, overflow }; } },
      LEAVE(),
    ],
  }),
  K([0], {
    id: 'amber', title: 'PEWTER MUSEUM', npc: 'scientist', weight: 1, story: 'amber', music: 'mus_pewter',
    text: "SCIENTIST: This lump of amber? Probably just a rock. Though the lab on CINNABAR ISLAND says they can bring fossils back to life...",
    choices: [
      { label: 'Keep it as a charm (OLD AMBER)', show: r => !has(r, 'OLD_AMBER'), ai: r => (r.party.some(m => typesOf(m).includes('ROCK')) ? 1.1 : 0.4), tip: 'Rare held item: +40% damage per ROCK POKéMON. Can also be revived at the CINNABAR LAB (act 3, or its courier).',
        run: (r) => { r.addRelic('OLD_AMBER'); return { text: 'You got the OLD AMBER! It feels warm.', relic: 'OLD_AMBER' }; } },
      { label: 'Send it to be revived (act 3)', mon: 'gift', ai: () => 0.75, tip: r => (labLater(r) ? 'Nothing now. At the first "?" of act 3, the CINNABAR LAB hands you an AERODACTYL.' : 'Nothing now. Act 3 is not in KANTO this run: at its first "?", a courier from the CINNABAR LAB brings you an AERODACTYL.'),
        run: (r) => { flags(r).amber = 'sent'; r.logEvent?.({ k: 'story', id: 'amber', v: 'sent' }); return { text: "SCIENTIST: I'll mail it to CINNABAR. Visit the lab when you get there: it may take a while!" }; } },
      LEAVE(),
    ],
  }),
  K([0], {
    id: 'fossil', title: 'MT. MOON FOSSILS', npc: 'poke_maniac', weight: 2, music: 'mus_mt_moon',
    text: "SUPER NERD: These are POKéMON fossils! You can have one, but the other is mine! I hear they revive them at CINNABAR...",
    choices: [
      { label: 'HELIX FOSSIL: revive OMANYTE now', mon: 'gift', ai: r => roomAi(r) * 0.8, run: (r, rng) => ({ text: 'The HELIX FOSSIL was revived into OMANYTE!', newMon: gift(r, rng, 'OMANYTE') }) },
      { label: 'DOME FOSSIL: revive KABUTO now', mon: 'gift', ai: r => roomAi(r) * 0.8, run: (r, rng) => ({ text: 'The DOME FOSSIL was revived into KABUTO!', newMon: gift(r, rng, 'KABUTO') }) },
      { label: 'Keep the HELIX FOSSIL (held item)', show: r => !has(r, 'HELIX_FOSSIL'), ai: () => 0.6, tip: '+10% damage per attack type in your lead\'s deck. Revive it as OMASTAR at the CINNABAR LAB (act 3).', run: (r) => { r.addRelic('HELIX_FOSSIL'); return { text: 'You kept the HELIX FOSSIL.', relic: 'HELIX_FOSSIL' }; } },
      { label: 'Keep the DOME FOSSIL (held item)', show: r => !has(r, 'DOME_FOSSIL'), ai: () => 0.5, tip: '+16% damage per card left in hand. Revive it as KABUTOPS at the CINNABAR LAB (act 3).', run: (r) => { r.addRelic('DOME_FOSSIL'); return { text: 'You kept the DOME FOSSIL.', relic: 'DOME_FOSSIL' }; } },
    ],
  }),
  K([0], {
    id: 'clefairy', title: 'CLEFAIRY DANCE', npc: null, mon: 'CLEFAIRY', weight: 1, music: 'mus_mt_moon',
    text: 'On the MT. MOON summit, CLEFAIRY dance in a circle around a glowing MOON STONE.',
    choices: [
      { label: 'Watch quietly (30%: one joins you)', mon: 'catch', ai: r => 0.2 + roomAi(r) * 0.2, run: (r, rng) => {
        if (nuzCatchOk(r) && rng.chance(0.3)) { useNuzCatch(r); return { text: 'One CLEFAIRY stops dancing and toddles over to you!', newMon: gift(r, rng, 'CLEFAIRY') }; }
        healAll(r, 0.2); return { text: 'The dance is soothing. Your POKéMON recovered a little.' };
      } },
      { label: 'Grab the MOON STONE (all lose 15% HP)', ai: r => (r.party.some(m => (D.species[m.species].evolutions || []).some(e => e.param === 'MOON_STONE')) ? 0.7 : 0.15) - hpAi(r, 0.15), run: (r) => { hurt(r, 0.15); const overflow = found(r, ['MOON_STONE']); return { text: `You got the MOON STONE! The CLEFAIRY pelt you with pebbles.${fullNote(overflow)}`, overflow }; } },
      { label: 'Join the dance (heal 30%)', ai: r => (1 - teamHp(r)) * 1.8, run: (r) => { healAll(r, 0.3); return { text: 'You danced until dawn. Your POKéMON feel refreshed!' }; } },
    ],
  }),
  K([0], {
    id: 'magikarp', title: 'MAGIKARP SALESMAN', npc: 'fat_man', weight: 1,
    text: "MAN: Hello, there! Have I got a deal just for you! I'll let you have a secret POKéMON... a MAGIKARP! What do you say?",
    choices: [
      { label: r => `Buy it ($${cost(r, 500)})`, mon: 'gift', cond: r => canPay(r, 500), ai: r => (r.money > cost(r, 500) + 300 ? roomAi(r) * 0.6 : -1), run: (r, rng) => { pay(r, 500); return { text: 'MAN: Thank you! No refunds!', newMon: makeMon('MAGIKARP', Math.max(5, lvl(r, -2)), { rng, caughtAct: act(r) }) }; } },
      { label: r => `Buy the "special" one ($${cost(r, 900)})`, mon: 'gift', cond: r => canPay(r, 900), ai: r => (r.money > cost(r, 900) + 300 ? roomAi(r) * 0.75 : -1), run: (r, rng) => { pay(r, 900); return { text: 'MAN: This one is extra-special! Look at that shine!', newMon: makeMon('MAGIKARP', lvl(r, 2), { rng, minIV: 25, caughtAct: act(r) }) }; } },
      LEAVE('No thanks', "MAN: Hmph. You'll regret it."),
    ],
  }),
  K([0], {
    id: 'rocket1', title: 'TEAM ROCKET!', npc: 'rocket_m', weight: 1.2, story: 'rocket', music: 'mus_encounter_rocket',
    text: "GRUNT: We, TEAM ROCKET, are after the fossils of MT. MOON! Hand over your money, or do you want to tangle with us?",
    choices: [
      { label: r => `Pay up (lose $${rocketToll(r)})`, ai: r => -rocketToll(r) / 1500, run: (r) => { const n = rocketToll(r); r.money -= n; flags(r).rocket1 = 'paid'; return { text: `You handed over $${n}. GRUNT: Pleasure doing business!` }; } },
      { label: 'Fight! (elite battle)', solo: true, minFloor: 4, ai: r => fightAi(r, 1.2), run: (r, rng) => ({ text: 'GRUNT: You asked for it!', battle: eliteFight(r, rng, ROCKET_GRUNTS(), { winFlags: { rocket1: 'beat' } }) }) },
      { label: 'Run for it (all lose 15% HP, drop an item)', ai: r => -hpAi(r, 0.15) - 0.2, run: (r, rng) => { hurt(r, 0.15); const k = r.consumables.length ? rng.pick(r.consumables) : null; if (k) r.useConsumable(k); flags(r).rocket1 = 'ran'; return { text: `You got away${k ? `, but dropped your ${itemName(k)}` : ''}!` }; } },
    ],
  }),

  // ---- Act 2: Cerulean -> Celadon --------------------------------------------------------------------------
  K([1], {
    id: 'nugget_bridge', title: 'NUGGET BRIDGE', npc: 'rocket_m', weight: 1, story: 'rocket', music: 'mus_encounter_rocket',
    text: r => `${flags(r).rocket1 === 'beat' ? `MAN: You! You beat our grunt at ${rocket1At(r)}! ` : flags(r).aqua1 === 'beat' ? 'MAN: Word travels: you beat TEAM AQUA in PETALBURG WOODS! ' : 'MAN: Congratulations, you beat the bridge! '}Here's a NUGGET. Now, how about joining TEAM ROCKET?`,
    choices: [
      { label: 'Refuse! (elite battle, + NUGGET)', solo: true, minFloor: 4, ai: r => fightAi(r, 1.6), run: (r, rng) => ({ text: "MAN: Then I'll take it back by force!", battle: eliteFight(r, rng, ROCKET_GRUNTS(), { rewardItems: ['NUGGET'], winFlags: { rocket2: 'beat' } }) }) },
      { label: '"Join": pay a held item, keep the NUGGET', needsRelic: 1, cond: r => heldRelics(r).length >= 1, ai: r => 1.2, tip: 'Hand over one held item as "membership dues". Being a member may help later...',
        run: (r, rng, mon, [k]) => { r.removeRelic(k); flags(r).rocket2 = 'joined'; const overflow = found(r, ['NUGGET']); return { text: `You handed over your ${itemName(k)}. MAN: Welcome aboard! Keep the NUGGET.${fullNote(overflow)}`, overflow }; } },
      LEAVE('Walk past', 'MAN: Hmph. Your loss.'),
    ],
  }),
  K([1], {
    id: 'bill_cottage', title: "BILL'S SEA COTTAGE", npc: 'bill', weight: 2, music: 'mus_route24',
    text: "BILL: Help! I'm a POKéMON! ...Just kidding. I got fused in my CELL SEPARATOR. Thanks for fixing it! How can I repay you?",
    choices: [
      { label: 'Ask for his S.S. TICKET', show: r => !has(r, 'SS_TICKET'), ai: () => 0.9, tip: 'Uncommon held item: everything in shops costs 20% less.', run: (r) => { r.addRelic('SS_TICKET'); return { text: "BILL: Here's my ticket to the S.S. ANNE party. Captain's friends get discounts everywhere!", relic: 'SS_TICKET' }; } },
      { label: 'Ask for EEVEE + an evolution stone (lead -30% HP)', mon: 'gift', ai: r => roomAi(r) * 1.3, run: (r, rng) => {
        const lead = alive(r)[0]; if (lead) hurt(r, 0.3, [lead]);
        return { text: 'BILL: Take good care of EEVEE! Pick a stone for it... Ouch, the machine zapped your lead on the way out.', newMon: gift(r, rng, 'EEVEE', 0, 20), itemChoices: { keys: ['FIRE_STONE', 'WATER_STONE', 'THUNDER_STONE'].filter(k => D.items[k]), use: false } };
      }, nuz: { label: 'Ask for a rare item (lead -30% HP)', ai: () => 0.5, run: (r, rng) => { const lead = alive(r)[0]; if (lead) hurt(r, 0.3, [lead]); return { text: 'BILL: Have one of these! ...Ouch, the machine zapped your lead.', relicChoices: relics(r, rng, 2, W.mid) }; } } },
      LEAVE(),
    ],
  }),
  K([1], {
    id: 'ss_anne', title: 'S.S. ANNE', npc: 'sailor', weight: 1, music: 'mus_ss_anne',
    text: 'The S.S. ANNE is in port and the party on board is in full swing. The CAPTAIN looks seasick...',
    choices: [
      { label: "Rub the CAPTAIN's back (1 of 3 held items)", ai: () => 1, run: (r, rng) => ({ text: 'CAPTAIN: Ooh, much better! Take something from my cabin.', relicChoices: relics(r, rng, 3, W.common) }) },
      { label: 'Join the party (heal 50% + cure)', ai: r => (1 - teamHp(r)) * 2.2, run: (r) => { healAll(r, 0.5, true); return { text: 'What a party! Your POKéMON feel great.' }; } },
      { label: r => `Bet in the dining hall ($${cost(r, 500)}: 40% to win $${moneyReward(r, 1500)})`, cond: r => canPay(r, 500), ai: () => 0, run: (r, rng) => { pay(r, 500); if (rng.chance(0.4)) { const n = giveMoney(r, 1500); return { text: `You won $${n}!`, slots: [3, 3, 3] }; } return { text: 'The GENTLEMAN wins again. Better luck next time.', slots: [1, 4, 2] }; } },
    ],
  }),
  K([1], {
    id: 'fanclub', title: 'POKéMON FAN CLUB', npc: 'gentleman', weight: 1,
    text: "CHAIRMAN: Ah, you have such lovely POKéMON! Let me tell you about my RAPIDASH... it's a long story, mind you.",
    choices: [
      { label: 'Hear the whole story (BICYCLE, team falls asleep)', show: r => !has(r, 'BICYCLE'), ai: () => 1.6, tip: 'Rare: +1 hand size. Your whole party falls asleep and loses 10% HP.',
        run: (r) => { r.addRelic('BICYCLE'); hurt(r, 0.1); for (const m of alive(r)) m.status = 'SLP'; return { text: "CHAIRMAN: ...and that's how I met her! Take this BICYCLE voucher! ...Your POKéMON fell asleep somewhere around hour two.", relic: 'BICYCLE' }; } },
      { label: 'Show off your POKéMON (1 of 2 items)', cond: r => r.party.length >= 3, ai: () => 0.8, run: (r, rng) => ({ text: 'CHAIRMAN: Marvelous! Please, take one of these.', relicChoices: fromList(r, rng, 2, ['SOOTHE_BELL', 'LUCKY_EGG', 'TEA', 'POKE_FLUTE', 'AMULET_COIN']) }) },
      LEAVE('Sneak out', 'CHAIRMAN: ...where did you go?'),
    ],
  }),
  K([1], {
    id: 'daycare', title: 'DAY CARE', npc: 'old_man_1', weight: 1,
    text: "OLD MAN: I'm the DAY-CARE MAN. I'll raise one of your POKéMON for a fee. Oh, and my wife found an EGG...",
    choices: [
      { label: r => `Raise a POKéMON ($${cost(r, 1000)}): +4 levels`, needsMon: 'alive', botMon: 'best', cond: r => canPay(r, 1000), ai: r => (r.money > cost(r, 1000) + 600 ? 0.7 : -1), run: (r, rng, mon) => { pay(r, 1000); return { text: `${monName(mon)} grew 4 levels!`, levelEvents: [{ mon, events: addLevels(mon, 4) }] }; } },
      { label: 'Take the EGG', mon: 'gift', ai: r => roomAi(r) * 0.8, run: (r, rng) => {
        const sp = rng.chance(0.1) ? rng.pick(['DRATINI', 'LARVITAR', 'BAGON']) : rng.pick(['PICHU', 'CLEFFA', 'IGGLYBUFF', 'TOGEPI', 'TYROGUE', 'SMOOCHUM', 'ELEKID', 'MAGBY', 'AZURILL'].filter(s => D.species[s]));
        return { text: `The EGG hatched into ${speciesName(sp)}!`, newMon: makeMon(sp, Math.max(5, lvl(r, -3)), { rng, minIV: 15, caughtAct: act(r) }) };
      } },
      LEAVE('Leave', 'Come again!'),
    ],
  }),
  K([1], {
    id: 'ghost', title: 'POKéMON TOWER', npc: 'channeler', weight: 1.5, music: 'mus_poke_tower',
    text: 'A CHANNELER blocks the stairs. "Begone... or face the restless spirit of the tower!" An altar glitters with offerings.',
    choices: [
      { label: 'Face the spirit (elite: SILPH SCOPE)', solo: true, minFloor: 4, ai: r => fightAi(r, 1.1, 0.8), run: (r, rng) => ({ text: 'The ghost of MAROWAK appeared!', battle: eventBattle(r, { kind: 'elite', enemies: [makeEnemy('MAROWAK', lvl(r, 3), { rng, hpScale: r.hpScaleFor(floorOf(r), 'elite'), moves: ['BONE_CLUB', 'BONEMERANG', 'HEADBUTT', 'LEER'] })], terrain: 'building', music: 'mus_poke_tower', dmgScale: r.dmgScale() * 1.1, rng, trainer: { title: 'GHOST', name: 'GHOST', pic: null, money: 30 }, rewardRelic: 'SILPH_SCOPE' }) }) },
      { label: 'Take an offering (1 of 3 items + curse)', curse: 'CURSED_DOLL', ai: () => 1.4 - curseAi, tip: 'Pick 1 of 3 uncommon/rare held items. A CURSED DOLL (-1 hand size) follows you home.',
        run: (r, rng) => { const c = addCurse(r, 'CURSED_DOLL'); return { text: 'You took an offering from the altar.' + (c ? CURSE_TEXT(c) : ''), relicChoices: relics(r, rng, 3, W.high), curse: c }; } },
      { label: 'Rest on the purified floor (heal 35%)', ai: r => (1 - teamHp(r)) * 1.5, run: (r) => { healAll(r, 0.35, true); return { text: 'The air is calm here. Your POKéMON rested.' }; } },
      LEAVE('Turn back', 'You left the tower. A chill follows you.'),
    ],
  }),
  K([1], {
    id: 'fuji', title: "MR. FUJI'S HOUSE", npc: 'mr_fuji', weight: 1, story: 'flute', music: 'mus_lavender',
    text: r => `MR. FUJI: The POKéMON here were left by trainers who couldn't care for them.${cursesOf(r).length ? ' ...I sense something dark following you.' : ' Would you help?'}`,
    choices: [
      { label: 'Cleanse your curses', show: r => cursesOf(r).length > 0, ai: () => 2.5, run: (r) => { const cs = cursesOf(r); for (const k of cs) removeCurse(r, k); return { text: `MR. FUJI prayed with you. The ${cs.map(itemName).join(' and ')} crumbled to dust.` }; } },
      { label: 'Leave a POKéMON in his care (reward by its power)', needsMon: 'release', cond: r => r.party.length >= 2, botMon: 'worst', ai: r => (r.party.length >= 5 ? 0.7 : -1),
        tip: 'Release one (not your last). Under 300 total stats: RARE CANDY. 300-449: 1 of 2 common items + heal 30%. 450+: 1 of 3 uncommon items.',
        run: (r, rng, mon) => {
          r.party.splice(r.party.indexOf(mon), 1);
          const b = bst(mon.species);
          if (b >= 450) return { text: `MR. FUJI: ${monName(mon)} will be happy here. Please, take this.`, relicChoices: relics(r, rng, 3, W.uncommon) };
          if (b >= 300) { healAll(r, 0.3); return { text: `MR. FUJI: ${monName(mon)} will be happy here. Rest a while, and take this.`, relicChoices: relics(r, rng, 2, W.common) }; }
          const overflow = found(r, ['RARE_CANDY']); return { text: `MR. FUJI: ${monName(mon)} will be happy here. Take this RARE CANDY.${fullNote(overflow)}`, overflow };
        } },
      { label: 'Help around the house (POKé FLUTE)', show: r => !has(r, 'POKE_FLUTE'), ai: () => 0.45, tip: 'Uncommon: your POKéMON wake up every turn. It might wake up something big later...',
        run: (r) => { r.addRelic('POKE_FLUTE'); flags(r).flute = 1; return { text: 'MR. FUJI: Thank you. Take this POKé FLUTE: its tune can wake even the soundest sleeper.', relic: 'POKE_FLUTE' }; } },
      LEAVE(),
    ],
  }),
  K([1], {
    id: 'gamecorner', title: 'CELADON GAME CORNER', npc: 'gentleman', weight: 1, music: 'mus_game_corner',
    text: "The slot machines are ringing. A shady man by the poster offers loans. \"Short on coins? I'll front you some!\"",
    choices: [
      { label: r => `Play the slots ($${cost(r, 620)})`, cond: r => canPay(r, 620), ai: () => -0.05, run: (r, rng) => {
        pay(r, 620); const roll = rng.next();
        if (roll < 0.05) { const n = giveMoney(r, 4000); return { text: `JACKPOT! 7 7 7! You win $${n}!`, slots: [0, 0, 0] }; }
        if (roll < 0.35) { const n = giveMoney(r, 1230); return { text: `Three in a row! You win $${n}!`, slots: [3, 3, 3] }; }
        return { text: 'No luck... The machine ate your money.', slots: [1, 4, 2] };
      } },
      { label: r => `Prize counter ($${cost(r, 2000)}): 1 of 2 POKéMON`, mon: 'gift', cond: r => canPay(r, 2000), ai: r => (r.money > cost(r, 2000) + 600 ? roomAi(r) * 1.2 : -1), run: (r, rng) => { pay(r, 2000); return { text: 'Pick your prize!', monChoices: rng.sample(['PORYGON', 'SCYTHER', 'PINSIR', 'DRATINI'], 2).map(sp => gift(r, rng, sp, 0, 15)) }; } },
      { label: 'Check the poster (elite: LIFT KEY)', solo: true, minFloor: 4, ai: r => fightAi(r, 0.9), run: (r, rng) => ({ text: 'A hidden switch! The ROCKET HIDEOUT! GRUNT: Intruder!', battle: eliteFight(r, rng, ROCKET_GRUNTS(), { rewardRelic: has(r, 'LIFT_KEY') ? undefined : 'LIFT_KEY', winFlags: { rocketHideout: 1 } }) }) },
      { label: r => `Take a loan (+$${moneyReward(r, 1000)}, IOU NOTE curse)`, curse: 'IOU_NOTE', ai: () => 0.6 - curseAi, tip: 'Money now. The IOU NOTE (curse): shop prices +25% and battles pay 25% less, until cleansed.',
        run: (r) => { const n = giveMoney(r, 1000); const c = addCurse(r, 'IOU_NOTE'); return { text: `SHADY MAN: $${n}, as promised. I'll be collecting.` + (c ? CURSE_TEXT(c) : ''), curse: c }; } },
    ],
  }),
  K([1], {
    id: 'rooftop', title: 'CELADON ROOFTOP', npc: 'little_girl', weight: 1, music: 'mus_celadon',
    text: 'On the roof of the CELADON DEPT. STORE, a thirsty girl stares at the vending machine.',
    choices: [
      { label: r => `Buy her a drink ($${cost(r, 300)}): she gives a TM`, cond: r => canPay(r, 300), ai: () => 0.7, run: (r, rng) => { pay(r, 300); return { text: "GIRL: Yay, thanks! Here, I don't need this TM.", tutor: tmTutor(r, rng, 2, 95) }; } },
      { label: r => `Drinks for your team ($${cost(r, 300)}): heal 40%`, cond: r => canPay(r, 300), ai: r => (1 - teamHp(r)) * 1.8 - 0.1, run: (r) => { pay(r, 300); healAll(r, 0.4); return { text: 'FRESH WATER all around! Your POKéMON recovered.' }; } },
      LEAVE(),
    ],
  }),

  // ---- Act 3: Fuchsia -> Cinnabar --------------------------------------------------------------------------
  K([2], {
    id: 'cinnabar_lab', title: 'CINNABAR LAB', npc: 'scientist', weight: 1, story: 'amber', music: 'mus_cinnabar',
    forced: (p) => flags(p).amber === 'sent', // the act-1 OLD AMBER pays off at the first "?" of act 3
    text: r => (flags(r).amber === 'sent' ? 'SCIENTIST: Ah, the OLD AMBER from PEWTER! Our machine revived it. It\'s waiting for you!' : 'SCIENTIST: Welcome to the CINNABAR LAB! We revive fossils, research genes... and need test subjects.'),
    choices: [
      { label: r => (flags(r).amber === 'sent' ? 'Collect your AERODACTYL' : 'Revive a fossil held item'), mon: 'gift', show: r => flags(r).amber === 'sent' || heldRelics(r).some(k => FOSSILS[k]),
        needsRelic: { n: 1, filter: k => !!FOSSILS[k] }, ai: r => roomAi(r) * 1.6,
        run: (r, rng, mon, keys) => {
          if (flags(r).amber === 'sent') { flags(r).amber = 'done'; r.logEvent?.({ k: 'story', id: 'amber', v: 'done' }); return { text: 'The OLD AMBER became AERODACTYL!', newMon: gift(r, rng, 'AERODACTYL', 0, 20) }; }
          const k = keys[0]; r.removeRelic(k);
          return { text: `The ${itemName(k)} was revived into ${speciesName(FOSSILS[k])}!`, newMon: gift(r, rng, FOSSILS[k], 0, 20) };
        } },
      { label: r => `Gene research ($${cost(r, 1000)}): upgrade a move`, cond: r => canPay(r, 1000), ai: r => (r.money > cost(r, 1000) + 800 ? 0.9 : -1), tip: 'The card becomes the strongest move of its type this POKéMON can learn, and keeps its copies.',
        run: (r) => { pay(r, 1000); return { text: 'SCIENTIST: Pick the move to enhance.', upgrade: 1 }; } },
      { label: 'Volunteer as a test subject (transform 2 cards)', needsMon: 'alive', botMon: 'worst', ai: () => 0.15, tip: 'Free: up to 2 cards of one POKéMON become random moves it can learn.',
        run: (r, rng, mon) => { const ch = transformMoves(mon, rng, 2, powerCap(r)); return { text: ch.length ? `${monName(mon)}: ${ch.map(([a, b]) => `${moveName(a)} became ${moveName(b)}`).join(', ')}!` : 'Nothing happened...' }; } },
      LEAVE(),
    ],
  }),
  K([2], {
    id: 'silph', title: 'SILPH CO. TAKEOVER', npc: 'rocket_m', weight: 1, story: 'rocket', music: 'mus_silph',
    text: r => `TEAM ROCKET has taken over SILPH CO.!${flags(r).rocket2 === 'joined' ? ' A grunt waves at you: "Hey, it\'s the new recruit!"' : villainJoined(r) ? ' A grunt waves at you: "Word is you ran with TEAM MAGMA. Come on in!"' : ''}`,
    choices: [
      { label: 'Storm the building (elite: MASTER BALL + item)', solo: true, minFloor: 4, ai: r => fightAi(r, 1.8), run: (r, rng) => ({ text: 'ADMIN: How did you get in here?!', battle: eliteFight(r, rng, ['TEAM_ROCKET_ADMIN', 'TEAM_ROCKET_ADMIN_2', ...ROCKET_GRUNTS().slice(-6)], { rewardItems: ['MASTER_BALL'], rewardRelicW: W.high, winFlags: { rocket3: 'beat' } }) }) },
      { label: r => `Sneak up to 7F: LAPRAS${villainJoined(r) ? ' (in uniform)' : ' (all lose 25% HP)'}`, mon: 'gift', ai: r => roomAi(r) * 1.5 - (villainJoined(r) ? 0 : hpAi(r, 0.25)),
        run: (r, rng) => { if (!villainJoined(r)) hurt(r, 0.25); return { text: `EMPLOYEE: Please, take my LAPRAS somewhere safe!${villainJoined(r) ? ' Nobody stops someone in a ROCKET uniform.' : ' The grunts spotted you on the way out!'}`, newMon: gift(r, rng, 'LAPRAS', 0, 20) }; },
        nuz: { label: r => `Sneak up to 7F: supplies${villainJoined(r) ? '' : ' (all lose 25% HP)'}`, ai: () => 0.3, run: (r) => { if (!villainJoined(r)) hurt(r, 0.25); const overflow = found(r, ['RARE_CANDY', 'FULL_RESTORE']); return { text: `EMPLOYEE: Take these, quick!${fullNote(overflow)}`, overflow }; } } },
      { label: 'Grab a CARD KEY and leave', show: r => !has(r, 'CARD_KEY'), ai: () => 0.45, run: (r) => { r.addRelic('CARD_KEY'); return { text: 'You found a CARD KEY! MARTS will open their back rooms to you.', relic: 'CARD_KEY' }; } },
      LEAVE(),
    ],
  }),
  K([2], {
    id: 'dojo', title: 'FIGHTING DOJO', npc: 'black_belt', weight: 1, music: 'mus_gym',
    text: 'KARATE MASTER: Hwaah! You dare enter the FIGHTING DOJO? Defeat me and you may take one of our prized POKéMON!',
    choices: [
      { label: r => (r.nuzlocke ? 'Challenge the master (elite: a held item)' : 'Challenge the master (elite: HITMON)'), solo: true, minFloor: 4, ai: r => fightAi(r, 1.5), run: (r, rng) => {
        const master = custom('KARATE_MASTER', 'KARATE MASTER', 'BLACK_BELT_KOICHI', null, [['HITMONLEE', 37], ['HITMONCHAN', 37], ['MACHOKE', 38], ['PRIMEAPE', 38], ['MACHAMP', 40]]);
        const extra = r.nuzlocke ? { rewardRelicW: W.uncommon } : { rewardMons: ['HITMONLEE', 'HITMONCHAN'].map(sp => gift(r, rng, sp, 2, 20)) };
        return { text: 'KARATE MASTER: Hwaaah! Prepare yourself!', battle: eliteFight(r, rng, [master], extra) };
      } },
      { label: 'Train with the disciples (lead +3 Lv, all -20% HP)', ai: r => 0.8 - hpAi(r, 0.2), run: (r) => { hurt(r, 0.2); const lead = alive(r)[0]; return { text: `${lead ? monName(lead) : 'Your lead'} trained hard!`, levelEvents: lead ? [{ mon: lead, events: addLevels(lead, 3) }] : [] }; } },
      LEAVE('Bow and leave', 'KARATE MASTER: Hmph. Come back when you are ready.'),
    ],
  }),
  K([2], {
    id: 'safari', title: 'SAFARI ZONE', npc: 'gentleman', weight: 1, music: 'mus_fuchsia',
    text: r => `SAFARI ZONE GATE: Catch rare POKéMON with 3 SAFARI BALLS! ...The WARDEN lost his GOLD TEETH somewhere in there, too.${r.nuzlocke && !nuzCatchOk(r) ? ' (NUZLOCKE: you already used this act\'s catch.)' : ''}`,
    choices: [
      { label: r => `Enter ($${cost(r, 500)}): 3 SAFARI BALLS`, mon: 'catch', cond: r => canPay(r, 500) && nuzCatchOk(r), ai: r => (r.money > cost(r, 500) + 400 ? roomAi(r) * 1.1 : -1), run: (r, rng) => {
        pay(r, 500); useNuzCatch(r);
        const sp = rng.pick(['CHANSEY', 'KANGASKHAN', 'TAUROS', 'SCYTHER', 'PINSIR', 'DRATINI', 'EXEGGCUTE', 'RHYHORN']);
        const p = Math.max(0.12, Math.min(0.6, (D.species[sp].catchRate || 45) / 255 * 1.6));
        for (let i = 1; i <= 3; i++) if (rng.chance(p)) return { text: `A wild ${speciesName(sp)}! ...Ball ${i}: Gotcha! ${speciesName(sp)} was caught!`, newMon: gift(r, rng, sp) };
        r.addSeen(sp, false);
        return { text: `A wild ${speciesName(sp)}! All 3 SAFARI BALLS missed, and it ran away...` };
      } },
      { label: 'Find the GOLD TEETH (eat a bad mushroom)', curse: 'ROTTEN_MUSHROOM', show: r => !has(r, 'GOLD_TEETH'), ai: () => 0.9 - curseAi * 0.8, tip: 'GOLD TEETH: elites offer one more held item choice. The ROTTEN SHROOM (curse): -8% HP after every battle.',
        run: (r) => { r.addRelic('GOLD_TEETH'); const c = addCurse(r, 'ROTTEN_MUSHROOM'); return { text: 'WARDEN: My teeth! Thank you! ...You found them by a patch of odd mushrooms. You got hungry.' + (c ? CURSE_TEXT(c) : ''), relic: 'GOLD_TEETH', curse: c }; } },
      LEAVE(),
    ],
  }),
  K([2], {
    id: 'cycling', title: 'CYCLING ROAD', npc: 'biker', weight: 1, music: 'mus_cycling',
    text: 'The long downhill of CYCLING ROAD. A gang of BIKERS revs their engines at the top.',
    choices: [
      { label: 'Race down, no brakes (50%: a bike)', ai: r => 0.55 - hpAi(r, 0.15), run: (r, rng) => {
        const bikes = fromList(r, rng, 2, ['MACH_BIKE', 'ACRO_BIKE']);
        if (bikes.length && rng.chance(0.5)) return { text: 'What a rush! A bike shop owner saw you and offers you a bike!', relicChoices: bikes };
        const two = [...alive(r)].sort((a, b) => b.hp / maxHp(b) - a.hp / maxHp(a)).slice(0, 2); hurt(r, 0.35, two);
        return { text: 'You crashed at the bottom! Your two healthiest POKéMON got hurt.' };
      } },
      { label: 'Take on the bikers (battle: a vitamin)', solo: true, minFloor: 2, ai: r => fightAi(r, 0.8, 0.6), run: (r, rng) => ({ text: 'BIKER: You wanna race? Let\'s battle!', battle: trainerFight(r, rng, trainersLike(/^BIKER_/), { noMoney: true, rewardItems: vitamins(rng, 1) }) }) },
      LEAVE('Walk your bike', 'Slow and steady.'),
    ],
  }),
  K([2], {
    id: 'fishing', title: 'FISHING BROTHERS', npc: 'fisher', weight: 1, music: 'mus_fuchsia',
    text: r => `FISHING GURU: Fishing is a way of life! Try my SUPER ROD, or take my brother's old GOOD ROD.${r.nuzlocke && !nuzCatchOk(r) ? ' (NUZLOCKE: you already used this act\'s catch.)' : ''}`,
    choices: [
      { label: r => `Fish with the SUPER ROD ($${cost(r, 250)} for bait)`, mon: 'catch', cond: r => canPay(r, 250) && nuzCatchOk(r), ai: r => roomAi(r) * 0.8, run: (r, rng) => {
        pay(r, 250); useNuzCatch(r);
        const sp = rng.weighted([['GYARADOS', 1], ['SEAKING', 2], ['KINGLER', 2], ['SHELLDER', 2], ['STARYU', 2], ['HORSEA', 2], ['POLIWHIRL', 2], ['SLOWPOKE', 2], ['TENTACOOL', 1]], x => x[1])[0];
        return { text: `Oh! A bite! You reeled in ${speciesName(sp)}!`, newMon: gift(r, rng, sp) };
      } },
      { label: 'Take the GOOD ROD', show: r => !has(r, 'GOOD_ROD'), ai: () => 0.55, run: (r) => { r.addRelic('GOOD_ROD'); return { text: 'You got the GOOD ROD!', relic: 'GOOD_ROD' }; } },
      LEAVE(),
    ],
  }),
  K([2], {
    id: 'mansion', title: "MANSION: MEW'S JOURNAL", npc: null, item: 'secret_key', weight: 1, music: 'mus_poke_mansion',
    text: 'A diary in the burned-out POKéMON MANSION: "July 5. We named the newly discovered POKéMON MEW..." Beyond it, a sealed lab.',
    choices: [
      { label: r => `Fund the research (pay $${Math.floor(r.money / 2)}): all +2 levels`, cond: r => r.money >= 600, ai: r => (r.money > 2000 ? 1.4 : 0.4), run: (r) => { const n = Math.floor(r.money / 2); r.money -= n; flags(r).mewJournal = 'funded'; return { text: `You paid $${n}. The research notes make your whole team stronger!`, levelEvents: r.party.filter(m => !isFainted(m)).map(m => ({ mon: m, events: addLevels(m, 2) })) }; } },
      { label: 'Open the sealed lab (elite: 1 of 3 rare items)', solo: true, minFloor: 4, ai: r => fightAi(r, 1.7, 0.8), run: (r, rng) => ({ text: "The lab's experiments break loose!", battle: eliteFight(r, rng, [...trainersLike(/^SCIENTIST_/), ...trainersLike(/^BURGLAR_/)], { rewardRelicW: W.rare }) }) },
      { label: 'Recreate the experiment (upgrades + curse)', curse: 'HEX_LETTER', ai: r => r.party.reduce((a, m) => a + (bestUpgrade(m, powerCap(r)) ? 0.35 : 0), 0) - curseAi, tip: 'Every POKéMON upgrades its best move. A HEX LETTER (curse: -1 discard, foes +5% damage) seals the deal.',
        run: (r) => { const ups = []; for (const m of r.party) { const b = bestUpgrade(m, powerCap(r)); if (b) { const from = m.moves[b.index].move; upgradeMove(m, b.index, powerCap(r)); ups.push(`${moveName(from)} -> ${moveName(b.into)}`); } } const c = addCurse(r, 'HEX_LETTER'); return { text: (ups.length ? `Upgraded: ${ups.slice(0, 3).join(', ')}${ups.length > 3 ? '...' : ''}.` : 'Nothing could be upgraded.') + (c ? CURSE_TEXT(c) : ''), curse: c }; } },
      LEAVE(),
    ],
  }),
  K([2], {
    id: 'seafoam', title: 'SEAFOAM CURRENTS', npc: null, mon: 'ARTICUNO', weight: 1, music: 'mus_mt_moon',
    spawn: (p) => relicCountOf(p) >= 2,
    text: 'The current in SEAFOAM ISLANDS B3F is about to sweep something away! You can only hold on to so much...',
    choices: [
      ...[0, 1].map(i => ({ label: r => `Let go of ${itemName(seafoamNamed(r)[i])}: 1 of 3 items`, show: r => !!seafoamNamed(r)[i], ai: r => 1.2 - relicKeep(r, seafoamNamed(r)[i]),
        run: (r, rng) => { const k = seafoamNamed(r)[i]; r.removeRelic(k); return { text: `The ${itemName(k)} was swept away... You washed up by ARTICUNO's nest, where shiny things collect.`, relicChoices: relics(r, rng, 3, W.uncommon) }; } })),
      { label: 'Swim hard (all lose 30% HP)', ai: r => -hpAi(r, 0.3), run: (r) => { hurt(r, 0.3); return { text: 'You fought the current and kept everything. Your team is exhausted.' }; } },
    ],
  }),
  K([2], {
    id: 'powerplant', title: 'POWER PLANT', npc: null, item: 'item_ball', weight: 1, music: 'mus_poke_mansion',
    text: 'Item balls lie all over the POWER PLANT floor. Some of them are humming...',
    choices: [
      { label: 'Pick up a ball (25%: ELECTRODE)', ai: r => 0.5 - (teamHp(r) < 0.6 ? 0.4 : 0), run: (r, rng) => ballStep(r, rng, 0, PP_BALLS) },
      LEAVE('Leave', 'Better safe than sorry.'),
    ],
  }),
  K([2], {
    id: 'snorlax', title: 'SNORLAX ON ROUTE 12', npc: null, mon: 'SNORLAX', weight: 1, story: 'flute', music: 'mus_route11',
    weightFn: (p) => (flags(p).flute ? 3 : 1),
    text: r => `A sleeping SNORLAX blocks ROUTE 12!${has(r, 'POKE_FLUTE') ? ' Your POKé FLUTE hums in your bag...' : ''}`,
    choices: [
      { label: 'Play the POKé FLUTE', show: r => has(r, 'POKE_FLUTE'), mon: 'catch', ai: r => 0.4 + roomAi(r), run: (r, rng) => {
        if (nuzCatchOk(r)) { useNuzCatch(r); return { text: 'SNORLAX woke up in a good mood and decided to follow you!', newMon: gift(r, rng, 'SNORLAX') }; }
        if (!has(r, 'LEFTOVERS')) { r.addRelic('LEFTOVERS'); return { text: 'SNORLAX woke up, yawned and wandered off... leaving its LEFTOVERS behind.', relic: 'LEFTOVERS' }; }
        healAll(r, 0.3); return { text: 'SNORLAX woke up and wandered off. Your team rested in its shade.' };
      } },
      { label: 'Wake it up! (elite wild battle)', solo: true, minFloor: 4, ai: r => fightAi(r, 0.9, 0.8), run: (r, rng) => ({ text: 'SNORLAX woke up! It attacked in a grumpy rage!', battle: wildFight(r, rng, 'SNORLAX', 3) }) },
      { label: 'Go around (all lose 15% HP)', ai: r => -hpAi(r, 0.15), run: (r) => { hurt(r, 0.15); return { text: 'You took the long way around. Your team is tired.' }; } },
    ],
  }),

  // ---- Act 4: Victory Road (no event money from here on) ---------------------------------------------------
  K([3], {
    id: 'boulders', title: 'VICTORY ROAD BOULDERS', npc: 'hiker', weight: 1, music: 'mus_victory_road',
    text: 'A STRENGTH puzzle blocks VICTORY ROAD. Beyond the boulders, something glitters.',
    choices: [
      { label: 'Solve the puzzle (all -15% HP): 1 of 2 vitamins', ai: r => 0.9 - hpAi(r, 0.15), run: (r, rng) => { hurt(r, 0.15); return { text: 'Push, push... done! There were vitamins behind the boulders.', itemChoices: vitaminChoice(r, rng, 2) }; } },
      { label: 'Smash through (all -20% HP, curse): rare item', curse: 'LAGGING_TAIL', ai: r => 1.6 - hpAi(r, 0.2) - curseAi, tip: '1 of 3 uncommon/rare held items. A LAGGING TAIL (curse: -40% speed) gets stuck to you.',
        run: (r, rng) => { hurt(r, 0.2); const c = addCurse(r, 'LAGGING_TAIL'); return { text: 'CRASH! You smashed through to a hidden stash.' + (c ? CURSE_TEXT(c) : ''), relicChoices: relics(r, rng, 3, W.high), curse: c }; } },
      LEAVE('Go around'),
    ],
  }),
  K([3], {
    id: 'acetrainer', title: "ACE TRAINER'S CHALLENGE", npc: 'cooltrainer_m', weight: 1,
    text: "COOLTRAINER: You're heading to the LEAGUE too? Battle me! Or we could trade notes on the ELITE FOUR...",
    choices: [
      { label: 'Battle! (elite: 1 of 3 held items)', solo: true, minFloor: 1, ai: r => fightAi(r, 1.4, 0.8), run: (r, rng) => ({ text: 'COOLTRAINER: Here I come!', battle: eliteFight(r, rng, trainersLike(/^COOLTRAINER_/, 3), { rewardRelicW: W.high }) }) },
      { label: 'Trade notes (E4 rules + FULL RESTORE)', ai: () => 0.35, run: (r) => { const overflow = found(r, ['FULL_RESTORE']); return { text: `COOLTRAINER: Here's what I know. ${e4Notes(r)} Take this FULL RESTORE too.${fullNote(overflow)}`, overflow }; } },
      LEAVE('Decline', 'COOLTRAINER: Chicken.'),
    ],
  }),
  K([3], {
    id: 'blackmarket', title: 'ROCKET BLACK MARKET', npc: 'rocket_m', weight: 1, story: 'rocket', music: 'mus_rocket_hideout',
    text: r => `With GIOVANNI gone, grunts are selling off the loot on ROUTE 23.${villainJoined(r) ? ' "Members get the family price!"' : rocketBeaten(r) >= 2 ? ' They flinch when they see you.' : ''}`,
    choices: [
      { label: r => `Buy stolen goods ($${blackPrice(r)}): 1 of 3 rare items`, cond: r => r.money >= blackPrice(r), ai: r => (r.money >= blackPrice(r) + 300 ? 1.8 : -1), run: (r, rng) => { r.money -= blackPrice(r); return { text: 'GRUNT: No refunds, no questions.', relicChoices: relics(r, rng, 3, W.rare) }; } },
      { label: r => `Buy supplies ($${cost(r, 1000)}): MAX REVIVE + FULL RESTORE`, cond: r => canPay(r, 1000), ai: () => 0.6, run: (r) => { pay(r, 1000); const overflow = found(r, ['MAX_REVIVE', 'FULL_RESTORE']); return { text: `GRUNT: Pleasure doing business.${fullNote(overflow)}`, overflow }; } },
      { label: r => (rocketBeaten(r) >= 2 ? 'Report them (2 FULL HEALS + RARE CANDY)' : 'Report them (2 FULL HEALS)'), ai: () => 0.2, run: (r) => { const overflow = found(r, rocketBeaten(r) >= 2 ? ['FULL_HEAL', 'FULL_HEAL', 'RARE_CANDY'] : ['FULL_HEAL', 'FULL_HEAL']); return { text: `OFFICER JENNY: Thanks for the tip! Take these.${rocketBeaten(r) >= 2 ? ' You\'ve given TEAM ROCKET a hard time, huh?' : ''}${fullNote(overflow)}`, overflow }; } },
      LEAVE(),
    ],
  }),
  K([3], {
    id: 'veteran', title: "THE VETERAN'S PARTNER", npc: 'old_man_2', weight: 1, music: 'mus_victory_road',
    text: "VETERAN: I'm retiring from battling. I'd like my gear and my partner to go to someone strong.",
    choices: [
      { label: 'Trade 2 held items for 1 of 3 rare items', needsRelic: 2, cond: r => heldRelics(r).length >= 2, ai: r => 1.6 - relicKeep(r, null, 2), run: (r, rng, mon, keys) => { for (const k of keys) r.removeRelic(k); return { text: `VETERAN: ${keys.map(itemName).join(' and ')}? Fine gear. Take your pick of mine.`, relicChoices: relics(r, rng, 3, W.rare) }; } },
      { label: 'Trade your lowest-level POKéMON for his partner', mon: 'trade', cond: r => r.party.length >= 2, ai: r => 1.2, run: (r, rng) => {
        const low = [...r.party].sort((a, b) => a.level - b.level)[0];
        const sp = rng.pick(VETERAN_PARTNERS[regionIdOf(r)]);
        const nm = gift(r, rng, sp, 0, 20);
        r.party.splice(r.party.indexOf(low), 1, nm); r.addSeen(sp, true);
        return { text: `VETERAN: ${monName(low)} will keep me company. Take good care of my ${speciesName(sp)}!`, traded: nm };
      } },
      LEAVE(),
    ],
  }),
  K([3], {
    id: 'provisions', title: 'INDIGO PLATEAU PROVISIONS', npc: 'clerk', weight: 1, music: 'mus_poke_center',
    text: 'CLERK: Last stop before the POKéMON LEAGUE! Take one supply bundle, on the house. Good luck!',
    choices: provisionChoices(),
  }),

  // ---- Post-game: Sevii Islands ----------------------------------------------------------------------------
  K([4], {
    id: 'sevii_daycare', title: 'FOUR ISLAND DAY CARE', npc: 'old_woman', weight: 1, music: 'mus_sevii_45',
    text: 'OLD WOMAN: My husband found an EGG! A strong one, I think. Or shall we raise one of yours?',
    choices: [
      { label: 'Take the EGG', mon: 'gift', ai: r => roomAi(r) * 1.2, run: (r, rng) => { const sp = rng.pick(['LARVITAR', 'DRATINI', 'BAGON', 'BELDUM']); return { text: `The EGG hatched into ${speciesName(sp)}!`, newMon: gift(r, rng, sp, -5, 20) }; } },
      { label: r => `Train a POKéMON ($${cost(r, 2000)}): +5 levels`, needsMon: 'alive', botMon: 'best', cond: r => canPay(r, 2000), ai: () => 0.9, run: (r, rng, mon) => { pay(r, 2000); return { text: `${monName(mon)} grew 5 levels!`, levelEvents: [{ mon, events: addLevels(mon, 5) }] }; } },
      LEAVE(),
    ],
  }),
  K([4], {
    id: 'ember_spa', title: 'EMBER SPA', npc: 'old_man_1', weight: 1, music: 'mus_sevii_123',
    text: 'The hot springs of ONE ISLAND. Up on MT. EMBER, a red gem glows in the rock.',
    choices: [
      { label: 'Soak in the spa (full heal + cure)', ai: r => (1 - teamHp(r)) * 2.5, run: (r) => { healAll(r, 1, true); return { text: 'Aaah... Your POKéMON are fully rested.' }; } },
      { label: 'Climb for the RUBY (all -40% HP, lead burned)', show: r => !has(r, 'RUBY'), ai: r => 1.4 - hpAi(r, 0.4), run: (r) => { hurt(r, 0.4); const l = alive(r)[0]; if (l) l.status = 'BRN'; r.addRelic('RUBY'); return { text: 'You got the RUBY! The lava singed your lead.', relic: 'RUBY' }; } },
      LEAVE(),
    ],
  }),
  K([4], {
    id: 'dotted_hole', title: 'DOTTED HOLE', npc: 'rocket_m', weight: 1, music: 'mus_sevii_dungeon',
    text: 'TEAM ROCKET admins are breaking into the DOTTED HOLE for the SAPPHIRE. Braille covers the walls.',
    choices: [
      { label: 'Fight the admins (elite: SAPPHIRE)', solo: true, ai: r => fightAi(r, 1.5), run: (r, rng) => ({ text: 'ADMIN: The SAPPHIRE is ours!', battle: eliteFight(r, rng, ['TEAM_ROCKET_ADMIN', 'TEAM_ROCKET_ADMIN_2'], has(r, 'SAPPHIRE') ? { rewardRelicW: W.rare } : { rewardRelic: 'SAPPHIRE' }) }) },
      { label: 'Solve the braille (SAPPHIRE, lose your weakest item)', show: r => !has(r, 'SAPPHIRE'), cond: r => heldRelics(r).length >= 1, ai: () => 0.9, run: (r) => { const k = [...heldRelics(r)].sort((a, b) => rarityRank[RELICS[a].rarity] - rarityRank[RELICS[b].rarity])[0]; r.removeRelic(k); r.addRelic('SAPPHIRE'); return { text: `You got the SAPPHIRE! A trap snatched your ${itemName(k)}.`, relic: 'SAPPHIRE' }; } },
      LEAVE(),
    ],
  }),
  K([4], {
    id: 'tanoby', title: 'TANOBY RUINS', npc: null, mon: 'UNOWN', weight: 1, music: 'mus_sevii_cave',
    text: 'UNOWN glyphs cover the chamber walls. Reading them aloud makes your POKéMON shimmer strangely...',
    choices: [
      { label: "Read the inscriptions (transform a whole deck)", needsMon: 'alive', botMon: 'worst', ai: () => 0.2, run: (r, rng, mon) => { const ch = transformMoves(mon, rng, 4, 150); return { text: `${monName(mon)}'s moves changed: ${ch.map(([, b]) => moveName(b)).join(', ') || 'nothing'}!` }; } },
      { label: 'Copy the glyphs (1 of 3 TMs)', ai: () => 0.7, run: (r, rng) => ({ text: 'The glyphs describe ancient techniques!', tutor: tmTutor(r, rng, 3, 999) }) },
      LEAVE(),
    ],
  }),
  K([4], {
    id: 'trainer_tower', title: 'TRAINER TOWER', npc: 'cooltrainer_f', weight: 1, music: 'mus_trainer_tower',
    text: "TRAINER TOWER: Climb to the top and beat the tower's best trainer! Or watch from the stands.",
    choices: [
      { label: 'Climb it (tough elite: 1 of 3 rare items)', solo: true, ai: r => fightAi(r, 1.6, 0.85), run: (r, rng) => { const cfg = eliteFight(r, rng, trainersLike(/^COOLTRAINER_/, 3), { rewardRelicW: W.rare }); for (const e of cfg.enemies) { e.maxHp = Math.round(e.maxHp * 1.25); e.hp = e.maxHp; } return { text: 'TOWER MASTER: Show me what you have!', battle: cfg }; } },
      { label: 'Watch from the stands (1 of 3 vitamins)', ai: () => 0.8, run: (r, rng) => ({ text: 'You learned a lot just by watching!', itemChoices: vitaminChoice(r, rng, 3) }) },
      LEAVE(),
    ],
  }),
  K([4], {
    id: 'rocket_warehouse', title: 'ROCKET WAREHOUSE', npc: 'rocket_m', weight: 1, music: 'mus_rocket_hideout',
    text: 'TEAM ROCKET keeps stolen POKéMON in a FIVE ISLAND warehouse. A grunt offers to "sell some back".',
    choices: [
      { label: r => (r.nuzlocke ? 'Raid it (elite: a rare item)' : 'Raid it (elite: rescue 1 of 3 POKéMON)'), solo: true, ai: r => fightAi(r, 1.5), run: (r, rng) => ({ text: 'GRUNT: Intruder! Get them!', battle: eliteFight(r, rng, ['TEAM_ROCKET_ADMIN', 'TEAM_ROCKET_ADMIN_2', ...ROCKET_GRUNTS().slice(-5)], r.nuzlocke ? { rewardRelicW: W.rare } : { rewardMons: rng.sample(WAREHOUSE, 3).map(sp => gift(r, rng, sp, 0, 20)) }) }) },
      { label: r => `Buy one back ($${cost(r, 3000)}): 1 of 2`, mon: 'gift', cond: r => canPay(r, 3000), ai: r => roomAi(r) * 1.1, run: (r, rng) => { pay(r, 3000); return { text: 'GRUNT: Heh, pick one.', monChoices: rng.sample(WAREHOUSE, 2).map(sp => gift(r, rng, sp, 0, 20)) }; } },
      LEAVE(),
    ],
  }),
  K([4], {
    id: 'selphy', title: "SELPHY'S REQUEST", npc: 'beauty', weight: 1, music: 'mus_sevii_67',
    text: r => `SELPHY: Ohh, I simply MUST see a ${selphyType(r)}-type POKéMON! Do you have one?`,
    choices: [
      { label: r => `Show her a ${selphyType(r)} POKéMON (1 of 3 items)`, cond: r => r.party.some(m => typesOf(m).includes(selphyType(r))), ai: () => 1.3, run: (r, rng) => ({ text: 'SELPHY: How lovely! Please take something from my collection.', relicChoices: relics(r, rng, 3, W.high) }) },
      { label: r => `Give her one (release it): 1 of 3 rare items`, needsMon: 'release', cond: r => r.party.length >= 2 && r.party.some(m => typesOf(m).includes(selphyType(r))), botMon: 'worst', monFilter: r => m => typesOf(m).includes(selphyType(r)) || `Not ${selphyType(r)}`, ai: r => (r.party.length >= 5 ? 1.2 : -1),
        run: (r, rng, mon) => { r.party.splice(r.party.indexOf(mon), 1); return { text: `SELPHY: ${monName(mon)} is mine? Oh, thank you! Take anything you like!`, relicChoices: relics(r, rng, 3, W.rare) }; } },
      LEAVE(),
    ],
  }),
];
const FOSSILS = { HELIX_FOSSIL: 'OMASTAR', DOME_FOSSIL: 'KABUTOPS', OLD_AMBER: 'AERODACTYL' };
const PP_BALLS = { pool: ['HYPER_POTION', 'REVIVE', 'RARE_CANDY', 'HP_UP', 'PROTEIN', 'THUNDER_STONE'], foe: 'ELECTRODE', odds: [0.25, 0.35, 0.5], moves: ['TACKLE', 'SONIC_BOOM', 'SELF_DESTRUCT', 'SCREECH'], terrain: 'building', where: 'ball' };
const VETERAN_PARTNERS = { kanto: ['ARCANINE', 'LAPRAS', 'MACHAMP', 'GYARADOS', 'SNORLAX', 'NINETALES'], hoenn: ['AGGRON', 'FLYGON', 'ALTARIA', 'WALREIN', 'GARDEVOIR', 'MILOTIC'], johto: ['AMPHAROS', 'HERACROSS', 'KINGDRA', 'SKARMORY', 'HOUNDOOM', 'URSARING'] };
const WAREHOUSE = ['HERACROSS', 'SKARMORY', 'MILTANK', 'SNEASEL', 'HOUNDOOM', 'AMPHAROS', 'KINGDRA', 'PUPITAR'];
const rocketToll = (r) => Math.max(100, Math.min(600, Math.floor(r.money * 0.25)));
// The villain story across regions (One Spire): TEAM ROCKET in KANTO acts, TEAM AQUA / MAGMA in HOENN acts. Each
// act's faction remembers how you dealt with the others ("the villain team follows you").
const villainJoined = (r) => flags(r).rocket2 === 'joined' || flags(r).aqua2 === 'joined';
const rocketBeaten = (r) => ['rocket1', 'rocket2', 'rocket3', 'aqua1', 'aqua2', 'aqua3'].filter(k => flags(r)[k] === 'beat').length;
const blackPrice = (r) => Math.round(cost(r, 3000) * (villainJoined(r) ? 0.75 : 1) / 10) * 10;
const selphyType = (r) => seededPick(r, ['WATER', 'FIRE', 'GRASS', 'ELECTRIC', 'PSYCHIC', 'NORMAL', 'FLYING', 'BUG', 'ROCK', 'GROUND'], 'selphy');
// The two held items the SEAFOAM current names: your oldest two (not curses or legendary items).
const seafoamNamed = (r) => heldRelics(r).slice(0, 2);
// How much the bots value keeping a held item (1 ~ an average common).
const relicKeep = (r, k, n = 1) => { if (!k) { const ks = heldRelics(r).map(x => RELICS[x]).sort((a, b) => rarityRank[a.rarity] - rarityRank[b.rarity]).slice(0, n); return ks.reduce((a, d) => a + 0.6 + rarityRank[d.rarity] * 0.5, 0); } return 0.6 + rarityRank[RELICS[k]?.rarity || 'common'] * 0.5; };
function e4Notes(r) {
  const g = r.act?.gauntlet || [];
  const rules = g.slice(0, 4).map(k => [D.trainers[k]?.name || k, ruleKeyOf(k)]).filter(([, k]) => BOSS_RULES[k]).map(([n, k]) => `${n}: ${BOSS_RULES[k].name}`);
  return rules.length ? rules.join(', ') + '.' : 'The CHAMPION changes the rules every time.';
}
function provisionChoices() {
  return [
    { label: '2 FULL RESTORES', ai: () => 0.6, run: (r) => { const overflow = found(r, ['FULL_RESTORE', 'FULL_RESTORE']); return { text: `You took 2 FULL RESTORES.${fullNote(overflow)}`, overflow }; } },
    { label: 'A MAX REVIVE and a REVIVE', ai: () => 0.55, run: (r) => { const overflow = found(r, ['MAX_REVIVE', 'REVIVE']); return { text: `You took a MAX REVIVE and a REVIVE.${fullNote(overflow)}`, overflow }; } },
    { label: 'A vitamin and a PP UP', ai: () => 0.7, run: (r, rng) => { const overflow = found(r, ['PP_UP']); return { text: `You took a PP UP. Now pick a vitamin!${fullNote(overflow)}`, overflow, itemChoices: vitaminChoice(r, rng, 2) }; } },
  ];
}
// One step of a press-your-luck item-ball room (POWER PLANT, ABANDONED SHIP). Each ball is an item a tier up,
// until the foe shows up (odds rise each time): a wild battle in solo; in co-op it bursts (lead -30% HP).
function ballStep(r, rng, i, spec) {
  if (rng.chance(spec.odds[Math.min(i, spec.odds.length - 1)])) {
    if (r.coop) { const l = alive(r)[0]; if (l) hurt(r, 0.3, [l]); return { text: `It was a ${speciesName(spec.foe)}! It exploded! Your lead got hurt and you fled.` }; }
    return { text: `It was a ${speciesName(spec.foe)}!`, battle: wildFight(r, rng, spec.foe, 1, { moves: spec.moves, terrain: spec.terrain, elite: false }) };
  }
  const it = rng.pick(spec.pool.filter(k => D.items[k]));
  const overflow = found(r, [it]);
  const text = `You found a ${itemName(it)}!${fullNote(overflow)}`;
  if (i + 1 >= spec.odds.length) return { text: text + ' That was the last one.', overflow };
  const p = Math.round(spec.odds[i + 1] * 100);
  return { text, overflow, next: { choices: [
    { label: `Pick up another (${p}%: ${speciesName(spec.foe)})`, ai: rr => 0.45 - p / 100 - (teamHp(rr) < 0.6 ? 0.4 : 0), run: (rr, rg) => ballStep(rr, rg, i + 1, spec) },
    LEAVE('Leave while you can', 'You left with your loot.'),
  ] } };
}

// =============================================================================================================
// HOENN
// =============================================================================================================
const AQUA_MAGMA = (a) => [['AQUA_GRUNT_M', 'MAGMA_GRUNT_M'], ['MAGMA_ADMIN_TABITHA', 'AQUA_ADMIN_SHELLY', 'AQUA_GRUNT_F'], ['AQUA_ADMIN_MATT', 'MAGMA_ADMIN_COURTNEY'], ['MAGMA_LEADER', 'AQUA_LEADER'], ['MAGMA_LEADER', 'AQUA_LEADER']][a];
const H = (acts, e) => ({ world: 'hoenn', acts, ...e });
const HOENN = [
  // ---- Hoenn 1: Littleroot -> Dewford ----------------------------------------------------------------------
  H([0], {
    id: 'flower_shop', title: 'PRETTY PETAL FLOWER SHOP', npc: 'woman_1', weight: 1,
    text: 'FLOWER SHOP LADY: Welcome! We grow BERRIES here. Would you like a WAILMER PAIL to water them, or some BERRIES?',
    choices: [
      { label: 'Take the WAILMER PAIL', show: r => !has(r, 'WAILMER_PAIL'), ai: () => 0.4, run: (r) => { r.addRelic('WAILMER_PAIL'); return { text: 'You got the WAILMER PAIL!', relic: 'WAILMER_PAIL' }; } },
      { label: 'Take 3 BERRIES', ai: () => 0.35, run: (r, rng) => { const keys = [rng.pick(['ORAN_BERRY', 'SITRUS_BERRY']), rng.pick(['PECHA_BERRY', 'CHERI_BERRY', 'CHESTO_BERRY']), 'ORAN_BERRY']; const overflow = found(r, keys); return { text: `You got ${keys.map(itemName).join(', ')}!${fullNote(overflow)}`, overflow }; } },
      LEAVE(),
    ],
  }),
  H([0], {
    id: 'petalburg_woods', title: 'PETALBURG WOODS', npc: 'woman_3', weight: 1.2, story: 'aqua', music: 'mus_encounter_rocket',
    text: "A TEAM AQUA grunt has cornered a DEVON researcher! GRUNT: Hand over those DEVON GOODS! ...And who are YOU?",
    choices: [
      { label: 'Fight! (elite battle)', solo: true, minFloor: 4, ai: r => fightAi(r, 1.2), run: (r, rng) => ({ text: "GRUNT: You're messing with TEAM AQUA!", battle: eliteFight(r, rng, AQUA_MAGMA(0), { winFlags: { aqua1: 'beat' } }) }) },
      { label: r => `Pay him off (lose $${rocketToll(r)})`, ai: r => -rocketToll(r) / 1500 + 0.2, run: (r) => { const n = rocketToll(r); r.money -= n; flags(r).aqua1 = 'paid'; const overflow = found(r, ['SUPER_POTION']); return { text: `The grunt took $${n} and left. The researcher gives you a SUPER POTION.${fullNote(overflow)}`, overflow }; } },
      { label: 'Hide in the SHROOMISH patch (curse)', curse: 'ROTTEN_MUSHROOM', ai: () => 0.35 - curseAi, tip: 'No fight, no fee: the researcher thanks you with a REVIVE. A ROTTEN SHROOM (curse: -8% HP after battles) comes along.',
        run: (r) => { const overflow = found(r, ['REVIVE']); const c = addCurse(r, 'ROTTEN_MUSHROOM'); flags(r).aqua1 = 'hid'; return { text: 'The grunt gave up looking. RESEARCHER: Phew! Take this REVIVE.' + (c ? CURSE_TEXT(c) : '') + fullNote(overflow), overflow, curse: c }; } },
    ],
  }),
  H([0], {
    id: 'devon_corp', title: 'DEVON CORPORATION', npc: 'gentleman', weight: 1, story: 'devon', music: 'mus_school',
    text: r => `MR. STONE: ${flags(r).aqua1 ? 'You helped our researcher in the woods! Thank you.' : 'Welcome to DEVON, young trainer!'} Take a reward... or would you carry the DEVON GOODS to CAPT. STERN for me?`,
    choices: [
      { label: 'Take a reward (1 of 2 held items)', ai: () => 0.85, run: (r, rng) => ({ text: 'MR. STONE: DEVON makes the finest goods in HOENN!', relicChoices: relics(r, rng, 2, W.common) }) },
      { label: 'Deliver the DEVON GOODS (pays off in act 3)', ai: () => 0.8, tip: 'Nothing now. STEVEN will be waiting for you at the first "?" of act 3 with a reward.',
        run: (r) => { flags(r).devon = 'goods'; r.logEvent?.({ k: 'story', id: 'devon', v: 'goods' }); return { text: "MR. STONE: Splendid! My son STEVEN will find you to thank you properly. He's always wandering about..." }; } },
      LEAVE(),
    ],
  }),
  H([0], {
    id: 'briney', title: "MR. BRINEY'S BOAT", npc: 'sailor', weight: 1, music: 'mus_surf',
    text: "MR. BRINEY: Ahoy! I'll ferry you along, for a small fee. Have you seen my PEEKO? She's wandered off again...",
    choices: [
      { label: r => `Ride the boat ($${cost(r, 300)}): heal 50% + cure`, cond: r => canPay(r, 300), ai: r => (1 - teamHp(r)) * 2.2 - 0.1, run: (r) => { pay(r, 300); healAll(r, 0.5, true); return { text: 'A calm sea. Your POKéMON rested on deck.' }; } },
      { label: 'Look for PEEKO (all -10% HP): 1 of 2 items', ai: r => 0.8 - hpAi(r, 0.1), run: (r, rng) => { hurt(r, 0.1); return { text: 'You found PEEKO in the reeds! MR. BRINEY: Take something from my cabin!', relicChoices: [...fromList(r, rng, 1, ['SEA_INCENSE', 'MYSTIC_WATER']), ...relics(r, rng, 1, W.common)].filter((k, i, a) => a.indexOf(k) === i) }; } },
      LEAVE(),
    ],
  }),
  H([0], {
    id: 'granite_cave', title: 'GRANITE CAVE', npc: 'hiker', weight: 1, music: 'mus_mt_moon',
    text: 'Deep in GRANITE CAVE, a man studies the stones. STEVEN: Rare stones are my passion. Is that a letter for me?',
    choices: [
      { label: 'Deliver the letter (all -20% HP): 1 of 2 items', ai: r => 1.0 - hpAi(r, 0.2), run: (r, rng) => { hurt(r, 0.2); return { text: 'The dark cave wore your team out, but STEVEN was thrilled. STEVEN: Take one of these.', relicChoices: relics(r, rng, 2, W.uncommon) }; } },
      { label: 'Dig for stones (1 of 2 stone items)', ai: () => 0.4, run: (r, rng) => { const ch = fromList(r, rng, 2, ['HARD_STONE', 'EVERSTONE', 'SOFT_SAND']); return ch.length ? { text: 'You dug up something!', relicChoices: ch } : { text: 'Nothing but rocks.' }; } },
      LEAVE(),
    ],
  }),
  H([0], {
    id: 'wally', title: "WALLY'S FIRST CATCH", npc: 'boy', weight: 1, story: 'wally', music: 'mus_follow_me',
    text: "WALLY: I-I'm going to live with my cousins in VERDANTURF... Could you help me catch my first POKéMON? I don't have a POKé BALL...",
    choices: [
      { label: 'Help him (give a POKé BALL): his RALTS\' sibling', mon: 'gift', cond: r => (r.balls.POKE_BALL || 0) >= 1, ai: r => roomAi(r) * 0.8 + 0.3, run: (r, rng) => { r.balls.POKE_BALL--; flags(r).wally = 'helped'; return { text: 'WALLY caught a RALTS! WALLY: Another one followed it! Please, you take it. I won\'t forget this!', newMon: gift(r, rng, 'RALTS') }; },
        nuz: { label: 'Help him (give a POKé BALL)', cond: r => (r.balls.POKE_BALL || 0) >= 1, ai: () => 0.35, run: (r) => { r.balls.POKE_BALL--; flags(r).wally = 'helped'; const overflow = found(r, ['ORAN_BERRY', 'ORAN_BERRY']); return { text: `WALLY caught a RALTS! WALLY: Thank you! I won't forget this! Here, some BERRIES.${fullNote(overflow)}`, overflow }; } } },
      LEAVE('Wish him luck', 'WALLY: O-okay... I\'ll try on my own.'),
    ],
  }),

  // ---- Hoenn 2: Mauville -> Petalburg ----------------------------------------------------------------------
  H([1], {
    id: 'rydel', title: "RYDEL'S CYCLES", npc: 'man', weight: 1, music: 'mus_cycling',
    text: "RYDEL: Welcome to RYDEL's CYCLES! Ride in my new ad and I'll give you a bike! MACH or ACRO, your pick!",
    choices: [
      { label: 'Ride in the ad (all -20% HP): MACH or ACRO BIKE', show: r => !has(r, 'MACH_BIKE') || !has(r, 'ACRO_BIKE'), ai: r => 1.0 - hpAi(r, 0.2), run: (r, rng) => { hurt(r, 0.2); return { text: 'Twelve takes down CYCLING ROAD later... RYDEL: Perfect! Pick your bike!', relicChoices: fromList(r, rng, 2, ['MACH_BIKE', 'ACRO_BIKE']) }; } },
      { label: 'Get a free tune-up (heal 30%)', ai: r => (1 - teamHp(r)) * 1.5, run: (r) => { healAll(r, 0.3); return { text: 'You rested while RYDEL oiled the chains.' }; } },
      LEAVE(),
    ],
  }),
  H([1], {
    id: 'glass_workshop', title: 'GLASS WORKSHOP', npc: 'old_man_2', weight: 1, music: 'mus_route3',
    text: 'GLASS WORKER: Bring me volcanic ash from ROUTE 113 and I\'ll blow you a fine glass FLUTE. Or buy one ready-made.',
    choices: [
      { label: 'Collect ash (all -25% HP): 1 of 2 FLUTES', ai: r => 0.9 - hpAi(r, 0.25), run: (r, rng) => { hurt(r, 0.25); return { text: 'Cough, cough... That\'s plenty of ash! Pick a flute.', relicChoices: fromList(r, rng, 2, FLUTES) }; } },
      { label: r => `Buy a flute ($${cost(r, 1200)}): 1 of 3`, cond: r => canPay(r, 1200), ai: r => (r.money > cost(r, 1200) + 600 ? 0.7 : -1), run: (r, rng) => { pay(r, 1200); return { text: 'GLASS WORKER: Take your pick.', relicChoices: fromList(r, rng, 3, FLUTES) }; } },
      LEAVE(),
    ],
  }),
  H([1], {
    id: 'fossil_h', title: 'DESERT FOSSILS', npc: 'hiker', weight: 2, music: 'mus_route3',
    text: 'HIKER: The sand gave up two fossils! Take whichever one you like. They revive them at DEVON these days.',
    choices: [
      { label: 'ROOT FOSSIL: revive LILEEP', mon: 'gift', ai: r => roomAi(r) * 0.9, run: (r, rng) => ({ text: 'The ROOT FOSSIL was revived into LILEEP!', newMon: gift(r, rng, 'LILEEP') }) },
      { label: 'CLAW FOSSIL: revive ANORITH', mon: 'gift', ai: r => roomAi(r) * 0.9, run: (r, rng) => ({ text: 'The CLAW FOSSIL was revived into ANORITH!', newMon: gift(r, rng, 'ANORITH') }) },
      { label: 'Keep digging (1 of 2 desert items)', ai: () => 0.5, run: (r, rng) => { const ch = fromList(r, rng, 2, ['SOFT_SAND', 'HARD_STONE', 'GO_GOGGLES', 'SHOAL_SALT']); return ch.length ? { text: 'More treasure in the sand!', relicChoices: ch } : { text: 'Just sand.' }; } },
    ],
  }),
  H([1], {
    id: 'lavaridge', title: 'LAVARIDGE HOT SPRING', npc: 'old_woman', weight: 1, music: 'mus_route3',
    text: "OLD LADY: Soak in our hot spring, dearie! Oh, and I have an EGG I can't take care of anymore...",
    choices: [
      { label: 'Soak (heal 50% + cure)', ai: r => (1 - teamHp(r)) * 2.2, run: (r) => { healAll(r, 0.5, true); return { text: 'The hot spring soothed your POKéMON.' }; } },
      { label: 'Take the EGG', mon: 'gift', ai: r => roomAi(r) * 0.6, run: (r, rng) => ({ text: 'The EGG hatched into WYNAUT!', newMon: makeMon('WYNAUT', Math.max(5, lvl(r, -3)), { rng, minIV: 15, caughtAct: act(r) }) }) },
      { label: r => `Buy LAVA COOKIES ($${cost(r, 700)})`, show: r => !has(r, 'LAVA_COOKIE'), cond: r => canPay(r, 700), ai: r => (r.money > cost(r, 700) + 600 ? 0.6 : -1), run: (r) => { pay(r, 700); r.addRelic('LAVA_COOKIE'); return { text: 'You got LAVA COOKIES! Your POKéMON love them.', relic: 'LAVA_COOKIE' }; } },
      LEAVE(),
    ],
  }),
  H([1], {
    id: 'meteor_falls', title: 'METEOR FALLS', npc: 'scientist', weight: 1, story: 'aqua', music: 'mus_encounter_rocket',
    text: r => `TEAM MAGMA is stealing PROF. COZMO's METEORITE!${flags(r).aqua1 === 'beat' ? ' "That brat who beat TEAM AQUA in the woods? Get them!"' : flags(r).rocket1 === 'beat' ? ` "That brat who beat TEAM ROCKET at ${rocket1At(r)}? Get them!"` : ''}`,
    choices: [
      { label: 'Fight the admin (elite: METEORITE)', solo: true, minFloor: 4, ai: r => fightAi(r, 1.6), run: (r, rng) => ({ text: 'TABITHA: Hehehe! You want this rock?', battle: eliteFight(r, rng, AQUA_MAGMA(1), { ...(has(r, 'METEORITE') ? { rewardRelicW: W.high } : { rewardRelic: 'METEORITE' }), winFlags: { aqua2: 'beat' } }) }) },
      { label: r => `Buy it back (pay $${Math.floor(r.money / 2)}): METEORITE`, show: r => !has(r, 'METEORITE'), cond: r => r.money >= 600, ai: r => (r.money > 1500 ? 1.0 : 0.2), run: (r) => { const n = Math.floor(r.money / 2); r.money -= n; r.addRelic('METEORITE'); flags(r).aqua2 = 'joined'; return { text: `You paid $${n}. GRUNT: Pleasure! You'd make a fine MAGMA member...`, relic: 'METEORITE' }; } },
      LEAVE(),
    ],
  }),
  H([1], {
    id: 'trick_house', title: 'TRICK HOUSE', npc: 'gentleman', weight: 1, music: 'mus_school',
    text: "TRICK MASTER: Behold my TRICK HOUSE! Two doors. One is safe and dull. The other is... rewarding. Mostly.",
    choices: [
      { label: 'The red door: 2 items', ai: () => 0.35, run: (r, rng) => { const keys = [r.randomConsumable(rng, act(r) + 1), r.randomConsumable(rng, act(r) + 1)]; const overflow = found(r, keys); return { text: `Behind the red door: ${keys.map(itemName).join(' and ')}!${fullNote(overflow)}`, overflow }; } },
      { label: 'The blue door: 1 of 2 uncommon items + curse', curse: 'HEX_LETTER', ai: () => 1.1 - curseAi, tip: 'A HEX LETTER (curse: -1 discard, foes +5% damage) is pinned to the prize.',
        run: (r, rng) => { const c = addCurse(r, 'HEX_LETTER'); return { text: 'TRICK MASTER: Hah! Got you!' + (c ? CURSE_TEXT(c) : ''), relicChoices: relics(r, rng, 2, W.uncommon), curse: c }; } },
      LEAVE(),
    ],
  }),
  H([1], {
    id: 'mauville_gc', title: 'MAUVILLE GAME CORNER', npc: 'gentleman', weight: 1, music: 'mus_game_corner',
    text: 'The MAUVILLE GAME CORNER! Slots, a prize counter with TMs, and a man in sunglasses lending money.',
    choices: [
      { label: r => `Play the slots ($${cost(r, 620)})`, cond: r => canPay(r, 620), ai: () => -0.05, run: (r, rng) => {
        pay(r, 620); const roll = rng.next();
        if (roll < 0.05) { const n = giveMoney(r, 4000); return { text: `JACKPOT! You win $${n}!`, slots: [0, 0, 0] }; }
        if (roll < 0.35) { const n = giveMoney(r, 1230); return { text: `Three in a row! You win $${n}!`, slots: [3, 3, 3] }; }
        return { text: 'No luck...', slots: [1, 4, 2] };
      } },
      { label: r => `Prize counter ($${cost(r, 1200)}): 1 of 3 TMs`, cond: r => canPay(r, 1200), ai: r => (r.money > cost(r, 1200) + 600 ? 0.7 : -1), run: (r, rng) => { pay(r, 1200); return { text: 'Pick a TM!', tutor: tmTutor(r, rng, 3, 95) }; } },
      { label: r => `Take a loan (+$${moneyReward(r, 1000)}, IOU NOTE curse)`, curse: 'IOU_NOTE', ai: () => 0.6 - curseAi, tip: 'The IOU NOTE (curse): shop prices +25% and battles pay 25% less, until cleansed.', run: (r) => { const n = giveMoney(r, 1000); const c = addCurse(r, 'IOU_NOTE'); return { text: `MAN: $${n}. Pay me back... eventually.` + (c ? CURSE_TEXT(c) : ''), curse: c }; } },
      LEAVE(),
    ],
  }),

  // ---- Hoenn 3: Fortree -> Sootopolis ----------------------------------------------------------------------
  H([2], {
    id: 'steven_thanks', title: "STEVEN'S THANKS", npc: 'gentleman', weight: 1, story: 'devon', music: 'mus_encounter_gym_leader',
    forced: (p) => flags(p).devon === 'goods', spawn: (p) => flags(p).devon === 'goods', follows: (p) => flags(p).devon === 'goods', // (any region's act 3)
    text: r => (regionIdOf(r) === 'hoenn' ? '' : `STEVEN: I followed you all the way to ${reg(r).name}! `) + 'STEVEN: There you are! My father told me you delivered the DEVON GOODS. Allow me to thank you.',
    choices: [
      { label: 'Take his DEVON SCOPE', show: r => !has(r, 'DEVON_SCOPE'), ai: () => 0.8, run: (r) => { flags(r).devon = 'done'; r.addRelic('DEVON_SCOPE'); return { text: 'STEVEN: It sees what\'s coming. It helped me more than once.', relic: 'DEVON_SCOPE' }; } },
      { label: 'Take his BELDUM', mon: 'gift', ai: r => roomAi(r) * 1.3, run: (r, rng) => { flags(r).devon = 'done'; return { text: 'STEVEN: BELDUM will grow into something remarkable.', newMon: gift(r, rng, 'BELDUM', 0, 25) }; } },
      { label: '1 of 2 uncommon held items', ai: () => 1.0, run: (r, rng) => { flags(r).devon = 'done'; return { text: 'STEVEN: Something from my collection, then.', relicChoices: relics(r, rng, 2, W.uncommon) }; } },
    ],
  }),
  H([2], {
    id: 'kecleon', title: 'ROUTE 120 KECLEON', npc: null, mon: 'KECLEON', weight: 1, music: 'mus_route11',
    text: r => `Something invisible blocks the bridge on ROUTE 120...${has(r, 'DEVON_SCOPE') ? ' Your DEVON SCOPE shows a KECLEON!' : ''}`,
    choices: [
      { label: 'Poke it (elite wild battle: DEVON SCOPE)', solo: true, minFloor: 3, ai: r => fightAi(r, has(r, 'DEVON_SCOPE') ? 0.6 : 1.1), run: (r, rng) => ({ text: 'A wild KECLEON appeared!', battle: wildFight(r, rng, 'KECLEON', 2, { cfg: has(r, 'DEVON_SCOPE') ? { rewardRelicW: W.uncommon } : { rewardRelic: 'DEVON_SCOPE' } }) }) },
      { label: 'Go around (all lose 15% HP)', ai: r => -hpAi(r, 0.15), run: (r) => { hurt(r, 0.15); return { text: 'You waded around the bridge. Your team is tired.' }; } },
      LEAVE('Wait it out', 'It wandered off eventually.'),
    ],
  }),
  H([2], {
    id: 'weather_institute', title: 'WEATHER INSTITUTE', npc: 'scientist', weight: 1, story: 'aqua', music: 'mus_encounter_rocket',
    text: 'TEAM AQUA has seized the WEATHER INSTITUTE! A researcher hides a CASTFORM in a back room.',
    choices: [
      { label: 'Drive them out (elite: 1 of 3 items)', solo: true, minFloor: 4, ai: r => fightAi(r, 1.4), run: (r, rng) => ({ text: 'SHELLY: Ahahaha! You picked the wrong building!', battle: eliteFight(r, rng, AQUA_MAGMA(2), { rewardRelicW: W.high, winFlags: { aqua3: 'beat' } }) }) },
      { label: 'Sneak in (all -25% HP): CASTFORM', mon: 'gift', ai: r => roomAi(r) * 0.9 - hpAi(r, 0.25), run: (r, rng) => { hurt(r, 0.25); return { text: 'RESEARCHER: Please, keep CASTFORM safe from them!', newMon: gift(r, rng, 'CASTFORM', 0, 20) }; },
        nuz: { label: 'Sneak in (all -25% HP): GO-GOGGLES', show: r => !has(r, 'GO_GOGGLES'), ai: () => 0.3, run: (r) => { hurt(r, 0.25); r.addRelic('GO_GOGGLES'); return { text: 'RESEARCHER: Take these, for the weather!', relic: 'GO_GOGGLES' }; } } },
      LEAVE(),
    ],
  }),
  H([2], {
    id: 'mt_pyre', title: 'MT. PYRE', npc: 'old_woman', weight: 1.2, story: 'aqua', music: 'mus_poke_tower',
    text: r => `OLD COUPLE: The RED and BLUE ORBS must stay here! Take one and its spirit follows you...${cursesOf(r).length ? ' Child, you are already carrying something dark.' : ''}`,
    choices: [
      { label: 'Pray at the summit (cleanse curses, heal 30%)', ai: r => (cursesOf(r).length ? 2.5 : (1 - teamHp(r)) * 1.2), run: (r) => { const cs = cursesOf(r); for (const k of cs) removeCurse(r, k); healAll(r, 0.3); return { text: cs.length ? `The mountain's spirits lifted the ${cs.map(itemName).join(' and ')}. You feel light.` : 'A quiet prayer. Your POKéMON rested.' }; } },
      ...['RED_ORB', 'BLUE_ORB'].map(k => ({ label: () => `Take the ${itemName(k)} (rare, curse)`, curse: 'CURSED_DOLL', show: r => !has(r, k), ai: () => 1.5 - curseAi * 1.2, tip: `${RELICS[k]?.desc} A CURSED DOLL (curse: -1 hand size) follows you.`,
        run: (r) => { r.addRelic(k); const c = addCurse(r, 'CURSED_DOLL'); flags(r).aqua3 ||= 'orb'; return { text: `You took the ${itemName(k)}.` + (c ? CURSE_TEXT(c) : ''), relic: k, curse: c }; } })),
      LEAVE(),
    ],
  }),
  H([2], {
    id: 'shoal_cave', title: 'SHOAL CAVE', npc: 'old_man_1', weight: 1, music: 'mus_mt_moon',
    text: 'OLD MAN: Bring me SHOAL SALT and SHOAL SHELLS from the cave at low tide, and I\'ll make you something nice.',
    choices: [
      { label: 'Collect them (all -20% HP): 1 of 2 items', ai: r => 0.9 - hpAi(r, 0.2), run: (r, rng) => { hurt(r, 0.2); const ch = fromList(r, rng, 2, ['SHELL_BELL', 'SHOAL_SHELL', 'SHOAL_SALT']); return ch.length ? { text: 'The tide came in fast, but you made it! OLD MAN: Splendid!', relicChoices: ch } : { text: 'You already have everything he makes. He gives you a pat on the back.' }; } },
      { label: 'Explore at low tide (2 items)', ai: () => 0.3, run: (r, rng) => { const keys = [r.randomConsumable(rng, act(r)), 'BIG_PEARL'].filter(k => D.items[k]); const overflow = found(r, keys); return { text: `You found ${keys.map(itemName).join(' and ')}!${fullNote(overflow)}`, overflow }; } },
      LEAVE(),
    ],
  }),
  H([2], {
    id: 'abandoned_ship', title: 'ABANDONED SHIP', npc: null, item: 'item_ball', weight: 1, music: 'mus_poke_mansion',
    text: "The ABANDONED SHIP creaks. A SCANNER glints in a flooded cabin, and item balls roll around the deck...",
    choices: [
      { label: 'Dive for the SCANNER (all -20% HP)', show: r => !has(r, 'SCANNER'), ai: r => 0.9 - hpAi(r, 0.2), run: (r) => { hurt(r, 0.2); r.addRelic('SCANNER'); return { text: 'You found the SCANNER!', relic: 'SCANNER' }; } },
      { label: 'Search the cabins (25%: a ghost)', ai: r => 0.5 - (teamHp(r) < 0.6 ? 0.4 : 0), run: (r, rng) => ballStep(r, rng, 0, SHIP_BALLS) },
      { label: "Take the captain's charm (rare item + curse)", curse: 'LAGGING_TAIL', ai: () => 1.4 - curseAi, tip: '1 of 2 rare held items. A LAGGING TAIL (curse: -40% speed) comes with it.', run: (r, rng) => { const c = addCurse(r, 'LAGGING_TAIL'); return { text: "You took the captain's lucky charm." + (c ? CURSE_TEXT(c) : ''), relicChoices: relics(r, rng, 2, W.rare), curse: c }; } },
      LEAVE(),
    ],
  }),
  H([2], {
    id: 'feebas', title: 'FEEBAS FISHING', npc: 'fisher', weight: 1, music: 'mus_route11',
    text: r => `FISHERMAN: They say a beautiful POKéMON hides in one spot on ROUTE 119... It takes all day!${r.nuzlocke && !nuzCatchOk(r) ? ' (NUZLOCKE: you already used this act\'s catch.)' : ''}`,
    choices: [
      { label: 'Fish all day (all -15% HP): FEEBAS or a fish', mon: 'catch', cond: r => nuzCatchOk(r), ai: r => roomAi(r) * 0.8 - hpAi(r, 0.15), run: (r, rng) => {
        hurt(r, 0.15); useNuzCatch(r);
        const sp = rng.chance(0.35) ? 'FEEBAS' : rng.pick(['WHISCASH', 'CORPHISH', 'CARVANHA', 'WAILMER', 'SEAKING']);
        return { text: sp === 'FEEBAS' ? 'At sunset... a FEEBAS! It looks shabby, but you have a good feeling.' : `You caught a ${speciesName(sp)}.`, newMon: gift(r, rng, sp) };
      } },
      { label: 'Trade fish stories (a BIG PEARL)', ai: () => 0.35, run: (r) => { const overflow = found(r, ['BIG_PEARL']); return { text: `FISHERMAN: Hah! Good one. Here, I found this in a CLAMPERL.${fullNote(overflow)}`, overflow }; } },
      LEAVE(),
    ],
  }),

  // ---- Hoenn 4: Victory Road -> Ever Grande (no event money) ------------------------------------------------
  H([3], {
    id: 'wally_challenge', title: "WALLY'S CHALLENGE", npc: 'boy', weight: 1.5, story: 'wally', music: 'mus_encounter_boy', follows: (p) => flags(p).wally === 'helped', // (any region's act 4)
    text: r => (flags(r).wally === 'helped' ? "WALLY: It's you! I got strong, thanks to that POKé BALL you gave me. Will you battle me? Or... take this, as thanks." : "WALLY: I'm going to the LEAGUE too! I've gotten strong. Battle me!"),
    choices: [
      { label: 'Battle! (elite: 1 of 3 held items)', solo: true, minFloor: 1, ai: r => fightAi(r, 1.4, 0.8), run: (r, rng) => {
        const wally = custom('WALLY_EV', 'WALLY', 'RS_COOLTRAINER_M', 'wally', [['ALTARIA', 44], ['DELCATTY', 43], ['ROSELIA', 44], ['MAGNETON', 41], ['GARDEVOIR', 45]]);
        return { text: "WALLY: Here I go! GARDEVOIR, let's do it!", battle: eliteFight(r, rng, [wally], { rewardRelicW: W.high }) };
      } },
      { label: 'Accept his thanks (1 of 2 rare items)', show: r => flags(r).wally === 'helped', ai: () => 1.4, run: (r, rng) => { flags(r).wally = 'thanked'; return { text: 'WALLY: I wouldn\'t be here without you!', relicChoices: relics(r, rng, 2, W.rare) }; } },
      LEAVE('Not now', 'WALLY: See you at the LEAGUE!'),
    ],
  }),
  H([3], {
    id: 'boulders_h', title: 'VICTORY ROAD BOULDERS', npc: 'hiker', weight: 1, music: 'mus_victory_road',
    text: 'Boulders block the way on HOENN\'s VICTORY ROAD. Something glitters beyond them.',
    choices: KANTO.find(e => e.id === 'boulders').choices,
  }),
  H([3], {
    id: 'blackmarket_h', title: 'TEAM AQUA LEFTOVERS', npc: 'woman_3', weight: 1, story: 'aqua', music: 'mus_rocket_hideout',
    text: r => `With their leaders gone, AQUA and MAGMA grunts sell off their loot.${villainJoined(r) ? ' "Oh, our best customer!"' : rocketBeaten(r) >= 2 ? ' They flinch when they see you.' : ''}`,
    choices: KANTO.find(e => e.id === 'blackmarket').choices,
  }),
  H([3], {
    id: 'veteran_h', title: "THE VETERAN'S PARTNER", npc: 'old_man_2', weight: 1, music: 'mus_victory_road',
    text: "VETERAN: I'm retiring from battling. I'd like my gear and my partner to go to someone strong.",
    choices: KANTO.find(e => e.id === 'veteran').choices,
  }),
  H([3], {
    id: 'provisions_h', title: 'EVER GRANDE PROVISIONS', npc: 'clerk', weight: 1, music: 'mus_poke_center',
    text: 'CLERK: Last stop before the POKéMON LEAGUE! Take one supply bundle, on the house.',
    choices: provisionChoices(),
  }),

  // ---- Hoenn post-game: Sky Pillar -------------------------------------------------------------------------
  H([4], {
    id: 'steven_house', title: "STEVEN'S HOUSE", npc: 'gentleman', weight: 1, music: 'mus_school',
    text: "A note on the table: \"I'm off on a journey. Take good care of my BELDUM... in exchange for one of yours? - STEVEN\"",
    choices: [
      { label: 'Leave a POKéMON, take BELDUM', mon: 'trade', needsMon: 'any', cond: r => r.party.length >= 2, botMon: 'worst', ai: () => 0.9, run: (r, rng, mon) => { const nm = gift(r, rng, 'BELDUM', 0, 25); r.party.splice(r.party.indexOf(mon), 1, nm); r.addSeen('BELDUM', true); return { text: `You left ${monName(mon)} and took BELDUM.`, traded: nm }; } },
      { label: 'Browse his rock collection (1 of 2 rare items)', ai: () => 1.2, run: (r, rng) => ({ text: 'STEVEN would want them used!', relicChoices: relics(r, rng, 2, W.rare) }) },
      LEAVE(),
    ],
  }),
  H([4], {
    id: 'southern_island', title: 'SOUTHERN ISLAND', npc: null, mon: 'LATIAS', weight: 1, music: 'mus_sevii_route',
    text: 'On SOUTHERN ISLAND, a red and white POKéMON watches you from behind a tree. An EON TICKET lies in the sand.',
    choices: [
      { label: 'Take the EON TICKET', show: r => !has(r, 'EON_TICKET'), ai: () => 1.3, run: (r) => { r.addRelic('EON_TICKET'); return { text: 'You picked up the EON TICKET!', relic: 'EON_TICKET' }; } },
      { label: 'Wait for it to trust you (LATIAS)', mon: 'gift', legend: 'LATIAS', ai: r => roomAi(r) * 1.4, run: (r, rng) => ({ text: 'After a long while, LATIAS came out and nuzzled you!', newMon: legendGift(r, gift(r, rng, 'LATIAS', -6, 20)) }) },
      LEAVE(),
    ],
  }),
  H([4], {
    id: 'sealed_chamber', title: 'SEALED CHAMBER', npc: null, mon: 'UNOWN', weight: 1, music: 'mus_sevii_cave',
    text: 'Braille covers the walls of the SEALED CHAMBER. Your POKéMON shimmer when you read it aloud.',
    choices: KANTO.find(e => e.id === 'tanoby').choices,
  }),
  H([4], {
    id: 'jirachi', title: "JIRACHI'S WISH", npc: null, mon: 'JIRACHI', weight: 1, music: 'mus_sevii_67',
    text: 'A small POKéMON wakes from its thousand-year sleep. "Make a wish..."',
    choices: [
      { label: 'Wish for treasure (1 of 3 rare items)', ai: () => 1.5, run: (r, rng) => ({ text: 'JIRACHI: Granted!', relicChoices: relics(r, rng, 3, W.rare) }) },
      { label: 'Wish for strength (all +3 levels)', ai: () => 1.4, run: (r) => ({ text: 'JIRACHI: Granted! Your team grows stronger!', levelEvents: alive(r).map(m => ({ mon: m, events: addLevels(m, 3) })) }) },
      { label: 'Wish for rest (full heal + 2 vitamins)', ai: r => 0.9 + (1 - teamHp(r)), run: (r, rng) => { healAll(r, 1, true); return { text: 'JIRACHI: Granted! Sleep well... Pick your vitamins.', itemChoices: { ...vitaminChoice(r, rng, 3), picks: 2 } }; } },
    ],
  }),
  H([4], {
    id: 'battle_tower', title: 'BATTLE TOWER', npc: 'cooltrainer_m', weight: 1, music: 'mus_trainer_tower',
    text: 'The BATTLE TOWER! Beat its champion, or watch from the stands.',
    choices: KANTO.find(e => e.id === 'trainer_tower').choices,
  }),
];
const FLUTES = ['BLUE_FLUTE', 'YELLOW_FLUTE', 'RED_FLUTE', 'BLACK_FLUTE', 'WHITE_FLUTE'];
const SHIP_BALLS = { pool: ['HYPER_POTION', 'REVIVE', 'RARE_CANDY', 'IRON', 'CALCIUM', 'MAX_REVIVE'], foe: 'DUSKULL', odds: [0.25, 0.4, 0.55], moves: null, terrain: 'building', where: 'cabin' };

// =============================================================================================================
// JOHTO (v0.1.1, HeartGold): KURT's APRICORN BALLS, and TEAM ROCKET's comeback: SLOWPOKE WELL (rocket1) ->
// GOLDENROD UNDERGROUND (rocket2) -> the RADIO TOWER gauntlet (rocket3; forced in act 3 once both earlier steps
// happened). The same flags as KANTO's ROCKET / HOENN's AQUA arcs, so the villain story crosses regions.
// =============================================================================================================
const J = (acts, e) => ({ world: 'johto', acts, ...e });
// Where you first beat TEAM ROCKET (KANTO: MT. MOON; JOHTO: the SLOWPOKE WELL): later grunts remember.
const rocket1At = (r) => flags(r).rocket1At || 'MT. MOON';
// A seeded pick of n from a list (labels must not use the rng): KURT's kinds of the day.
const seededSample = (r, list, n, salt) => [...list].map(k => [k, seededPick(r, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], salt + k)]).sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : 1)).slice(0, n).map(x => x[0]);
const giveBalls = (r, k, n) => { r.balls[k] = (r.balls[k] || 0) + n; return `${n} ${itemName(k)}${n > 1 ? 'S' : ''}`; };
const kurtExtra = (r) => (flags(r).kurt === 'helped' ? 1 : 0);
const BALL_AI = { FAST_BALL: 0.5, LEVEL_BALL: 0.55, LURE_BALL: 0.4, HEAVY_BALL: 0.4, LOVE_BALL: 0.3, MOON_BALL: 0.35, FRIEND_BALL: 0.5 };
// TEAM ROCKET's RADIO TOWER: three executives back to back, no heal in between. A chained battle carries
// cfg.chainNext(run) -> the next fight (the solo event scene and the bots start it right after a win); the prize
// (a rare held item) comes with the last one. Co-op never sees it (choice.solo): it has the sneak-in choices.
const RADIO_LINES = {
  ROCKET_EXEC_PROTON: 'PROTON: They call me the scariest guy in TEAM ROCKET. Want to find out why?',
  ROCKET_EXEC_PETREL: "PETREL: I'm the RADIO DIRECTOR! ...You don't buy the disguise? Fine!",
  ROCKET_EXEC_ARIANA: 'ARIANA: You got past the floor below? It ends here.',
  ROCKET_EXEC_ARCHER: "ARCHER: Our broadcast will reach GIOVANNI. I won't let a child spoil his return!",
};
const RADIO_HP = [0.6, 0.7, 0.85], RADIO_DMG = [0.8, 0.85, 0.9];
const radioExecs = (r) => [seededPick(r, ['ROCKET_EXEC_PROTON', 'ROCKET_EXEC_PETREL'], 'radio'), 'ROCKET_EXEC_ARIANA', 'ROCKET_EXEC_ARCHER'];
export function radioFight(r, i = 0) {
  const keys = radioExecs(r), last = i === keys.length - 1;
  const cfg = eliteFight(r, r.rng.fork(`radio${i}:${r.nodeId}`), [keys[i]], last ? { rewardRelicW: W.rare, rewardItems: ['RARE_CANDY'], winFlags: { rocket3: 'beat', radio: 'saved' } } : { noMoney: true });
  // (three elites without a heal would end most runs: each executive is a lighter elite, the last one the toughest)
  const hp = RADIO_HP[i] ?? 1;
  for (const e of cfg.enemies) { e.maxHp = Math.max(1, Math.round(e.maxHp * hp)); e.hp = e.maxHp; }
  cfg.dmgScale *= RADIO_DMG[i] ?? 1;
  cfg.intro = [`(${i + 1}/${keys.length}) ${RADIO_LINES[keys[i]]}`];
  cfg.chainStep = i;
  if (!last) cfg.chainNext = (rr) => radioFight(rr, i + 1);
  return cfg;
}
// The RADIO TOWER is forced (from floor 4, when its fights are offered) once TEAM ROCKET's story ran in both earlier
// acts, in any region.
const rocketStory = (p) => !!(flags(p).rocket1 && flags(p).rocket2);
// VOLTORB FLIP (press your luck): each flip doubles the pot, until a VOLTORB takes it.
const FLIP_ODDS = [0.2, 0.3, 0.45, 0.6];
function flipStep(r, rng, i, pot) {
  if (rng.chance(FLIP_ODDS[i])) return { text: `VOLTORB! ${i ? `The $${pot} pot is gone.` : 'Your coins are gone.'}`, slots: [1, 4, 2] };
  const now = i ? pot * 2 : moneyReward(r, 500);
  const text = `${i ? 'A x2 card!' : 'A x1... then a x3!'} The pot is $${now}.`;
  if (i + 1 >= FLIP_ODDS.length) { r.addMoney(now); return { text: `${text} Board cleared! You cash out $${now}.`, slots: [3, 3, 3] }; }
  const p = Math.round(FLIP_ODDS[i + 1] * 100);
  return { text, next: { choices: [
    { label: `Cash out (+$${now})`, ai: () => 0.3, run: (rr) => { rr.addMoney(now); return { text: `You cashed out $${now}!`, slots: [3, 3, 3] }; } },
    { label: `Flip another (x2, ${p}% VOLTORB)`, ai: () => 0.35 - p / 100, run: (rr, rg) => flipStep(rr, rg, i + 1, now) },
  ] } };
}
// DRAGON'S DEN: the ELDER's two questions (the kind answer is the right one).
const DEN_Q = [
  ['ELDER: What are POKéMON to you?', [['Friends you travel with', 1], ['Tools to win battles', 0], ['Proof of my strength', 0]]],
  ['ELDER: What matters most in a battle?', [['Winning, whatever it takes', 0], ['Trusting your POKéMON', 1], ['Having the best moves', 0]]],
];
function denStep(r, i, right) {
  const [q, answers] = DEN_Q[i];
  return { text: q, next: { choices: answers.map(([label, ok]) => ({ label, ai: () => ok, run: (rr, rng) => {
    const score = right + ok;
    if (i + 1 < DEN_Q.length) return denStep(rr, i + 1, score);
    if (score >= 2) {
      if (rr.nuzlocke) { const ch = fromList(rr, rng, 2, ['DRAGON_FANG', 'DRAGON_SCALE']); return ch.length ? { text: 'ELDER: A true trainer. Take one of these.', relicChoices: ch } : { text: 'ELDER: A true trainer. You already carry our treasures.' }; }
      const L = lvl(rr, -2);
      return { text: 'ELDER: Splendid! This DRATINI knows a technique our clan guards closely: EXTREMESPEED.', newMon: makeMon('DRATINI', L, { rng, minIV: 25, caughtAct: act(rr), moves: [...defaultMoves('DRATINI', L).filter(m => m !== 'EXTREME_SPEED').slice(-3), 'EXTREME_SPEED'] }) };
    }
    if (score === 1) return { text: 'ELDER: Hm. You are halfway there. Take this and keep learning.', itemChoices: vitaminChoice(rr, rng, 2) };
    return { text: 'ELDER: You have much to learn. Come back when you understand your POKéMON.' };
  } })) } };
}
const KIMONO = () => custom('KIMONO_GIRLS', 'KIMONO GIRLS', 'BEAUTY_BRIDGET', null, [['FLAREON', 30], ['VAPOREON', 30], ['JOLTEON', 30], ['ESPEON', 31], ['UMBREON', 31]]);
const healers = (r) => r.consumables.filter(k => CONSUMABLES[k]?.heal || CONSUMABLES[k]?.healFrac || CONSUMABLES[k]?.cure || CONSUMABLES[k]?.revive);
const nuzNote = (r) => (r.nuzlocke && !nuzCatchOk(r) ? " (NUZLOCKE: you already used this act's catch.)" : '');
const twoFinds = (r, rng) => [r.randomConsumable(rng, act(r) + 1), r.randomConsumable(rng, act(r) + 1)];

const JOHTO = [
  // ---- Johto 1: New Bark -> Azalea -------------------------------------------------------------------------
  J([0], {
    id: 'sprout_tower', title: 'SPROUT TOWER', npc: 'balding_man', weight: 1, music: 'mus_poke_tower',
    text: "SAGE: The tower's center pillar sways, yet never falls. So must a trainer bend without breaking. Will you face the sages, or sit with us a while?",
    choices: [
      { label: 'Climb and face the sages (battle: 1 of 3 held items)', solo: true, minFloor: 2, ai: r => fightAi(r, 1.0, 0.65), run: (r, rng) => {
        const sage = custom('SAGE_LI', 'SAGE LI', 'BLACK_BELT_KOICHI', null, [['BELLSPROUT', 7], ['BELLSPROUT', 7], ['HOOTHOOT', 8], ['BELLSPROUT', 9]]);
        return { text: 'SAGE LI: Show me the bond between you and your POKéMON!', battle: trainerFight(r, rng, [sage], { rewardRelicW: W.common }) };
      } },
      { label: 'Study the swaying pillar (lead -20% HP): +1 copy of a card', ai: r => 0.7 - hpAi(r, 0.1), run: (r) => { const l = alive(r)[0]; if (l) hurt(r, 0.2, [l]); return { text: 'You watched the pillar sway for hours. Something clicked. Pick a move!', addCopy: 1 }; } },
      { label: 'Meditate with them (heal 25% + cure)', ai: r => (1 - teamHp(r)) * 1.5, run: (r) => { healAll(r, 0.25, true); return { text: 'The quiet of the tower settled over your team.' }; } },
      LEAVE(),
    ],
  }),
  J([0], {
    id: 'mystery_egg', title: "MR. POKéMON'S EGG", npc: 'gentleman', weight: 1, music: 'mus_oak',
    text: 'MR. POKéMON: I found this odd EGG on my travels! Would you carry it to PROF. ELM? Oh, and PROF. OAK is visiting: he has something for you too.',
    choices: [
      { label: 'Carry the MYSTERY EGG (TOGEPI hatches)', mon: 'gift', ai: r => roomAi(r) * 0.9 + 0.1, run: (r, rng) => ({ text: 'On the way, the EGG cracked open... TOGEPI! It thinks you are its parent.', newMon: makeMon('TOGEPI', Math.max(5, lvl(r, -2)), { rng, minIV: 20, caughtAct: act(r) }) }),
        nuz: { label: 'Carry the EGG to ELM (EVERSTONE)', show: r => !has(r, 'EVERSTONE'), ai: () => 0.4, run: (r) => { r.addRelic('EVERSTONE'); return { text: 'PROF. ELM: The EGG arrived safely! Take this EVERSTONE as thanks.', relic: 'EVERSTONE' }; } } },
      { label: r => (r.nuzlocke ? `PROF. OAK's pocket money (+$${moneyReward(r, 400)})` : "PROF. OAK's gift (5 POKé BALLS)"), ai: () => 0.3, run: (r) => {
        if (r.nuzlocke) { const n = giveMoney(r, 400); return { text: `OAK: You only get one catch per area anyway! Here, $${n}.` }; }
        r.balls.POKE_BALL = (r.balls.POKE_BALL || 0) + 5; return { text: 'OAK: A trainer can never have too many POKé BALLS! Take these 5.' };
      } },
      { label: 'Browse his souvenirs (1 of 2 held items)', ai: () => 0.8, run: (r, rng) => { const ch = fromList(r, rng, 2, ['AMULET_COIN', 'SOOTHE_BELL', 'EVERSTONE', 'LUCKY_EGG', 'EXP_SHARE']); return ch.length ? { text: 'MR. POKéMON: Take your pick! I have too many anyway.', relicChoices: ch } : { text: 'MR. POKéMON: Hm, you have everything I collect!' }; } },
    ],
  }),
  J([0], {
    id: 'ruins_alph', title: 'RUINS OF ALPH', npc: null, mon: 'UNOWN', weight: 1, music: 'mus_sevii_cave',
    text: r => `A sliding stone panel in the RUINS OF ALPH shows a picture of an ancient POKéMON. The walls are covered in UNOWN letters...${nuzNote(r)}`,
    choices: [
      { label: 'Solve the panel (all -10% HP): 1 of 2 fossils', ai: r => 0.8 - hpAi(r, 0.1), run: (r, rng) => { hurt(r, 0.1); const ch = fromList(r, rng, 2, ['HELIX_FOSSIL', 'DOME_FOSSIL']); return ch.length ? { text: 'The panel clicked into place and a hidden chamber opened!', relicChoices: ch } : { text: 'The chamber held fossils you already have.' }; } },
      { label: 'Read the UNOWN words (transform 2 cards)', needsMon: 'alive', botMon: 'worst', ai: () => 0.15, tip: 'Up to 2 cards of one POKéMON become random moves it can learn.',
        run: (r, rng, mon) => { const ch = transformMoves(mon, rng, 2, powerCap(r)); return { text: ch.length ? `${monName(mon)}: ${ch.map(([a, b]) => `${moveName(a)} became ${moveName(b)}`).join(', ')}!` : 'Nothing happened...' }; } },
      { label: 'Catch an UNOWN (HIDDEN POWER)', mon: 'catch', cond: r => nuzCatchOk(r), ai: r => roomAi(r) * 0.3, run: (r, rng) => { useNuzCatch(r); return { text: 'An UNOWN drifted out of the wall and into your POKé BALL!', newMon: gift(r, rng, 'UNOWN') }; } },
      LEAVE(),
    ],
  }),
  J([0], {
    id: 'slowpoke_well', title: 'SLOWPOKE WELL', npc: 'rocket_m', weight: 1.2, story: 'rocket', music: 'mus_encounter_rocket',
    text: r => `TEAM ROCKET is down the SLOWPOKE WELL, cutting off SLOWPOKETAILS to sell!${flags(r).aqua1 === 'beat' ? ' "TEAM AQUA told us about a kid like you..."' : ''} KURT climbed down after them and hurt his back.`,
    choices: [
      { label: r => `Fight! (elite: ${has(r, 'KINGS_ROCK') ? 'a held item' : "KING'S ROCK"})`, solo: true, minFloor: 4, ai: r => fightAi(r, 1.3), run: (r, rng) => ({ text: "GRUNT: TEAM ROCKET is back, and you won't stop us!", battle: eliteFight(r, rng, ['JOHTO_ROCKET_GRUNT'], { ...(has(r, 'KINGS_ROCK') ? { rewardRelicW: W.common } : { rewardRelic: 'KINGS_ROCK' }), winFlags: { rocket1: 'beat', rocket1At: 'SLOWPOKE WELL', kurt: 'helped' } }) }) },
      { label: 'Help KURT out of the well (all -15% HP)', ai: r => 0.45 - hpAi(r, 0.15), tip: 'KURT owes you: his APRICORN BALLS come one extra per kind. The grunts get away.',
        run: (r) => { hurt(r, 0.15); flags(r).kurt = 'helped'; flags(r).rocket1 = 'ran'; return { text: 'KURT: Ow, my back! Thank you, youngster. Come by my house in AZALEA: I owe you one.' }; } },
      { label: r => `Buy a "SLOWPOKETAIL" (lose $${rocketToll(r)})`, ai: r => -rocketToll(r) / 1500 + 0.1, run: (r) => { const n = rocketToll(r); r.money -= n; flags(r).rocket1 = 'paid'; const overflow = found(r, ['BERRY_JUICE']); return { text: `You handed over $${n}. GRUNT: Pleasure doing business! ...It's a BERRY JUICE with a sticker on it.${fullNote(overflow)}`, overflow }; } },
    ],
  }),
  J([0, 1], {
    id: 'kurt', title: "KURT'S APRICORNS", npc: 'old_man_2', weight: 1.3, music: 'mus_school',
    text: r => `KURT: ${flags(r).kurt === 'helped' ? "It's you, the one who pulled me out of that well! " : ''}APRICORNS, eh? Leave 'em with me and I'll carve 'em into BALLS. Every APRICORN makes a BALL with a knack for a certain kind of POKéMON.`,
    choices: [
      { label: r => `Hand over your APRICORNS: ${3 + kurtExtra(r)} BALLS of one kind`, ai: () => 0.6, tip: "Pick 1 of 3 kinds. FAST: fast foes. LEVEL: weaker foes. LURE: on the water. HEAVY: heavy foes. LOVE: your lead's species. MOON: MOON STONE families. FRIEND: +1 copy of its best move.",
        run: (r) => ({ text: 'KURT: Which kind should I make?', next: { choices: seededSample(r, APRICORN_BALLS, 3, 'kurt').map(k => ({ label: `${itemName(k)} x${3 + kurtExtra(r)}`, tip: BALLS[k].desc, ai: () => BALL_AI[k] || 0.4, run: (rr) => ({ text: `KURT: Here you go! ${giveBalls(rr, k, 3 + kurtExtra(rr))}.` }) })) } }) },
      { label: r => `Rush order ($${cost(r, 800)}): 1 each of 4 kinds`, cond: r => canPay(r, 800), ai: r => (r.money > cost(r, 800) + 600 ? 0.5 : -1), run: (r) => { pay(r, 800); const ks = seededSample(r, APRICORN_BALLS, 4, 'rush'); return { text: `KURT: Rush job, done! ${ks.map(k => giveBalls(r, k, 1 + kurtExtra(r))).join(', ')}.` }; } },
      { label: 'Watch him work (a FRIEND BALL, heal 20%)', ai: r => 0.25 + (1 - teamHp(r)) * 0.8, run: (r) => { healAll(r, 0.2); return { text: `Your team napped while KURT carved. He tosses you ${giveBalls(r, 'FRIEND_BALL', 1)} on the way out.` }; } },
      LEAVE('Leave', 'KURT: Come back if you find more APRICORNS!'),
    ],
  }),
  J([0], {
    id: 'union_cave', title: 'UNION CAVE', npc: null, mon: 'LAPRAS', weight: 1, music: 'mus_mt_moon',
    text: r => `They say a LAPRAS surfaces in UNION CAVE's lowest pool... but only on Fridays.${nuzNote(r)}`,
    choices: [
      { label: 'Wait by the water (all -20% HP): 35% LAPRAS', mon: 'catch', cond: r => nuzCatchOk(r), ai: r => roomAi(r) * 0.7 - hpAi(r, 0.2), run: (r, rng) => {
        hurt(r, 0.2);
        if (rng.chance(0.35)) { useNuzCatch(r); return { text: 'Ripples... A LAPRAS surfaced and swam right up to you! It must be Friday.', newMon: gift(r, rng, 'LAPRAS', -2, 15) }; }
        const overflow = found(r, ['BIG_PEARL']); return { text: `Not Friday, it seems. You found a BIG PEARL on the shore, at least.${fullNote(overflow)}`, overflow };
      } },
      { label: 'Search the side tunnels (2 items)', ai: () => 0.35, run: (r, rng) => { const keys = twoFinds(r, rng); const overflow = found(r, keys); return { text: `You found ${keys.map(itemName).join(' and ')}!${fullNote(overflow)}`, overflow }; } },
      LEAVE(),
    ],
  }),
  J([0], {
    id: 'mom_call', title: "MOM'S CALL", npc: 'mom', weight: 1, music: 'mus_pallet',
    text: "MOM (on the POKéGEAR): Are you eating properly? I've been saving some of your prize money. I can buy you something nice with it, or send it to you. Your choice, dear!",
    choices: [
      { label: r => `Let MOM shop ($${cost(r, 500)}): 1 of 3 held items`, cond: r => canPay(r, 500), ai: r => (r.money > cost(r, 500) + 300 ? 0.9 : -1), run: (r, rng) => { pay(r, 500); return { text: 'MOM: I found these on sale! Pick the one you like.', relicChoices: relics(r, rng, 3, W.common) }; } },
      { label: r => `Ask for the savings (+$${moneyReward(r, 400)})`, ai: () => 0.4, run: (r) => { const n = giveMoney(r, 400); return { text: `MOM: Here's $${n}. Don't spend it all at once!` }; } },
      { label: 'Just chat (heal 25%)', ai: r => (1 - teamHp(r)) * 1.4, run: (r) => { healAll(r, 0.25); return { text: 'MOM went on about the neighbors for a while. Your team got a nice rest.' }; } },
    ],
  }),

  // ---- Johto 2: Goldenrod -> Ecruteak ----------------------------------------------------------------------
  J([1], {
    id: 'ilex_farfetchd', title: 'ILEX FOREST', npc: null, mon: 'FARFETCHD', weight: 1, music: 'mus_viridian_forest',
    text: r => `The CHARCOAL MAKER's FARFETCH'D has run off into ILEX FOREST, STICK and all. His apprentice is in tears. A small shrine sits in a clearing.${cursesOf(r).length ? ' It seems to glow when you come near.' : ''}`,
    choices: [
      { label: 'Herd it back (all -10% HP): CHARCOAL or STICK', ai: r => 0.85 - hpAi(r, 0.1), run: (r, rng) => { hurt(r, 0.1); const ch = fromList(r, rng, 2, ['CHARCOAL', 'STICK']); return ch.length ? { text: 'APPRENTICE: You found it! My boss wants you to have one of these.', relicChoices: ch } : { text: "APPRENTICE: Thank you! ...We have nothing you don't already own." }; } },
      { label: "It follows you: keep FARFETCH'D", mon: 'gift', ai: r => roomAi(r) * 0.5, run: (r, rng) => ({ text: "APPRENTICE: It won't leave your side... Take it. It's happier with you.", newMon: gift(r, rng, 'FARFETCHD', 1, 15) }) },
      { label: r => (cursesOf(r).length ? 'Pray at the shrine (cleanse a curse, heal 20%)' : 'Pray at the shrine (heal 30%)'), ai: r => (cursesOf(r).length ? 2 : (1 - teamHp(r)) * 1.4), run: (r) => {
        const c = cursesOf(r)[0];
        if (c) { removeCurse(r, c); healAll(r, 0.2); return { text: `A green light flickered over the shrine. The ${itemName(c)} crumbled away.` }; }
        healAll(r, 0.3); return { text: 'The forest went quiet. Your POKéMON feel rested.' };
      } },
    ],
  }),
  J([1], {
    id: 'goldenrod_dept', title: 'GOLDENROD DEPT. STORE', npc: 'clerk', weight: 1, music: 'mus_celadon',
    text: "It's bargain day on the GOLDENROD DEPT. STORE roof! In the basement a man swaps odd items, and the 5F lady hands out TMs to friendly trainers.",
    choices: [
      { label: r => `Rooftop bargains ($${cost(r, 700)}): 1 of 3 held items`, cond: r => canPay(r, 700), ai: r => (r.money > cost(r, 700) + 500 ? 1.0 : -1), run: (r, rng) => { pay(r, 700); return { text: 'CLERK: Bargain! Pick one.', relicChoices: relics(r, rng, 3, W.common) }; } },
      { label: 'Visit the 5F lady (a TM)', ai: () => 0.6, run: (r, rng) => ({ text: 'LADY: Your POKéMON look so happy! Here, a little something.', tutor: tmTutor(r, rng, 2, 95) }) },
      { label: 'Basement swap (give a held item: 1 of 3)', needsRelic: 1, cond: r => heldRelics(r).length >= 1, ai: r => 1.1 - relicKeep(r, null, 1), run: (r, rng, mon, [k]) => { r.removeRelic(k); return { text: `MAN: A ${itemName(k)}? Deal. Take your pick of these.`, relicChoices: relics(r, rng, 3, W.mid) }; } },
      LEAVE(),
    ],
  }),
  J([1], {
    id: 'goldenrod_gc', title: 'GOLDENROD GAME CORNER', npc: 'gentleman', weight: 1, music: 'mus_game_corner',
    text: "VOLTORB FLIP! Flip the cards to multiply your coins, and pray there's no VOLTORB under the next one. The prize counter has POKéMON.",
    choices: [
      { label: r => `Play VOLTORB FLIP ($${cost(r, 500)})`, cond: r => canPay(r, 500), ai: () => -0.05, run: (r, rng) => { pay(r, 500); return flipStep(r, rng, 0, 0); } },
      { label: r => `Prize counter ($${cost(r, 1800)}): 1 of 2 POKéMON`, mon: 'gift', cond: r => canPay(r, 1800), ai: r => (r.money > cost(r, 1800) + 600 ? roomAi(r) * 1.2 : -1), run: (r, rng) => { pay(r, 1800); return { text: 'Pick your prize!', monChoices: rng.sample(['ABRA', 'EKANS', 'SANDSHREW', 'CUBONE', 'WOBBUFFET', 'DRATINI'], 2).map(sp => gift(r, rng, sp, 0, 15)) }; } },
      { label: r => `Take a loan (+$${moneyReward(r, 1000)}, IOU NOTE curse)`, curse: 'IOU_NOTE', ai: () => 0.6 - curseAi, tip: 'The IOU NOTE (curse): shop prices +25% and battles pay 25% less, until cleansed.',
        run: (r) => { const n = giveMoney(r, 1000); const c = addCurse(r, 'IOU_NOTE'); return { text: `MAN: $${n}. We'll be in touch.` + (c ? CURSE_TEXT(c) : ''), curse: c }; } },
      LEAVE(),
    ],
  }),
  J([1], {
    id: 'bug_contest', title: 'BUG-CATCHING CONTEST', npc: 'bug_catcher', weight: 1, music: 'mus_route24',
    text: r => `NATIONAL PARK: The BUG-CATCHING CONTEST is on! One PARK BALL, twenty minutes: bring back the best bug!${nuzNote(r)}`,
    choices: [
      { label: 'Enter: catch the best bug you can', mon: 'catch', cond: r => nuzCatchOk(r), ai: r => roomAi(r) * 0.9 + 0.2, run: (r, rng) => {
        useNuzCatch(r);
        const sp = rng.weighted([['CATERPIE', 3], ['WEEDLE', 3], ['PARAS', 2], ['VENONAT', 2], ['BUTTERFREE', 1.5], ['BEEDRILL', 1.5], ['SCYTHER', 1], ['PINSIR', 1]], x => x[1])[0];
        const first = sp === 'SCYTHER' || sp === 'PINSIR';
        const overflow = found(r, [first ? 'SUN_STONE' : 'SITRUS_BERRY']);
        return { text: `You caught ${speciesName(sp)}! ${first ? 'First place! The prize is a SUN STONE.' : 'Not a winner, but you get a SITRUS BERRY for trying.'}${fullNote(overflow)}`, newMon: gift(r, rng, sp, 1, 15), overflow };
      } },
      { label: 'Help the judges (heal 20% + a BERRY)', ai: r => 0.2 + (1 - teamHp(r)), run: (r) => { healAll(r, 0.2); const overflow = found(r, ['ORAN_BERRY']); return { text: `The judges let your team rest in the shade, and gave you an ORAN BERRY.${fullNote(overflow)}`, overflow }; } },
      LEAVE(),
    ],
  }),
  J([1], {
    id: 'sudowoodo', title: 'THE ODD TREE', npc: null, mon: 'SUDOWOODO', weight: 1, music: 'mus_route11',
    text: r => `An odd tree blocks ROUTE 36. It wiggles when nobody's looking... The GOLDENROD FLOWER SHOP lent you a SQUIRTBOTTLE.${nuzNote(r)}`,
    choices: [
      { label: 'Spray it! (elite wild battle: HARD STONE)', solo: true, minFloor: 4, ai: r => fightAi(r, 0.9, 0.8), run: (r, rng) => ({ text: 'The tree jumped up! It was a SUDOWOODO!', battle: wildFight(r, rng, 'SUDOWOODO', 2, { moves: ['ROCK_THROW', 'MIMIC', 'LOW_KICK', 'FLAIL'], cfg: has(r, 'HARD_STONE') ? { rewardRelicW: W.common } : { rewardRelic: 'HARD_STONE' } }) }) },
      { label: 'Water it gently (40%: it follows you)', mon: 'catch', cond: r => nuzCatchOk(r), ai: r => roomAi(r) * 0.5, run: (r, rng) => {
        if (rng.chance(0.4)) { useNuzCatch(r); return { text: 'SUDOWOODO perked up, gave up pretending, and toddled after you!', newMon: gift(r, rng, 'SUDOWOODO') }; }
        return { text: 'SUDOWOODO shook off the water and bolted into the grass. At least the road is clear.' };
      } },
      { label: 'Go around (all lose 15% HP)', ai: r => -hpAi(r, 0.15), run: (r) => { hurt(r, 0.15); return { text: 'You took the long way through the brush. Your team is tired.' }; } },
    ],
  }),
  J([1], {
    id: 'kimono_girls', title: 'ECRUTEAK DANCE THEATER', npc: 'beauty', weight: 1, music: 'mus_lavender',
    text: 'The KIMONO GIRLS finish their dance. One steps forward with an EEVEE in her arms: "It has chosen you. Which path will you show it?"',
    choices: [
      { label: 'Take EEVEE + an evolution stone', mon: 'gift', ai: r => roomAi(r) * 1.3, run: (r, rng) => ({ text: 'KIMONO GIRL: Choose its stone with care.', newMon: gift(r, rng, 'EEVEE', 0, 20), itemChoices: { keys: ['FIRE_STONE', 'WATER_STONE', 'THUNDER_STONE'].filter(k => D.items[k]), use: false } }),
        nuz: { label: 'Take a stone for the road (1 of 3)', ai: () => 0.3, run: () => ({ text: 'KIMONO GIRL: May it serve you well.', itemChoices: { keys: ['FIRE_STONE', 'WATER_STONE', 'THUNDER_STONE'].filter(k => D.items[k]), use: false } }) } },
      { label: 'Battle the KIMONO GIRLS (elite: 1 of 3 held items)', solo: true, minFloor: 4, ai: r => fightAi(r, 1.3), run: (r, rng) => ({ text: 'KIMONO GIRLS: Then dance with us!', battle: eliteFight(r, rng, [KIMONO()], { rewardRelicW: W.mid }) }) },
      { label: 'Watch the dance (heal 35% + cure)', ai: r => (1 - teamHp(r)) * 1.6, run: (r) => { healAll(r, 0.35, true); return { text: 'The dance was mesmerizing. Your POKéMON feel calm.' }; } },
    ],
  }),
  J([1], {
    id: 'burned_tower', title: 'BURNED TOWER', npc: 'man', weight: 1, music: 'mus_poke_tower',
    text: "EUSINE: Three POKéMON fled this tower the night it burned. I'm here for SUICUNE. Careful, the floor is rotten... A MEDIUM chants in the corner.",
    choices: [
      { label: 'Search the basement (all -20% HP): 1 of 2 uncommon items', ai: r => 1.0 - hpAi(r, 0.2), run: (r, rng) => { hurt(r, 0.2); return { text: 'The floor gave way! Among the ashes in the basement...', relicChoices: relics(r, rng, 2, W.uncommon) }; } },
      { label: 'Trade stories with EUSINE (1 of 2 items)', ai: () => 0.5, run: (r, rng) => { const ch = fromList(r, rng, 2, ['CLEANSE_TAG', 'SPELL_TAG', 'CHARCOAL']); return ch.length ? { text: 'EUSINE: Here, something from my travels.', relicChoices: ch } : { text: 'EUSINE: You are better equipped than I am!' }; } },
      { label: 'Challenge the MEDIUM (elite: 1 of 3 held items)', solo: true, minFloor: 4, ai: r => fightAi(r, 1.2), run: (r, rng) => ({ text: 'MEDIUM: The spirits will not rest!', battle: eliteFight(r, rng, trainersLike(/^CHANNELER_/), { rewardRelicW: W.mid }) }) },
      LEAVE(),
    ],
  }),
  J([1], {
    id: 'goldenrod_underground', title: 'GOLDENROD UNDERGROUND', npc: 'rocket_f', weight: 1.2, story: 'rocket', music: 'mus_encounter_rocket',
    text: r => `${flags(r).rocket1 === 'beat' ? `GRUNT: Hey, the brat from ${rocket1At(r)}! ` : flags(r).aqua1 === 'beat' ? 'GRUNT: TEAM AQUA warned us about you. ' : flags(r).rocket1 === 'paid' ? 'GRUNT: Oh, our favorite customer! ' : ''}Behind the UNDERGROUND's shutters, TEAM ROCKET runs a secret warehouse. "Want in? Membership's cheap."`,
    choices: [
      { label: 'Refuse! (elite: 1 of 3 held items)', solo: true, minFloor: 4, ai: r => fightAi(r, 1.5), run: (r, rng) => ({ text: 'GRUNT: Wrong answer!', battle: eliteFight(r, rng, ['JOHTO_ROCKET_GRUNT_2'], { rewardRelicW: W.mid, winFlags: { rocket2: 'beat' } }) }) },
      { label: '"Join": pay a held item, get a NUGGET', needsRelic: 1, cond: r => heldRelics(r).length >= 1, ai: () => 1.1, tip: 'Hand over one held item as "membership dues". Being a member may help at the RADIO TOWER...',
        run: (r, rng, mon, [k]) => { r.removeRelic(k); flags(r).rocket2 = 'joined'; const overflow = found(r, ['NUGGET']); return { text: `You handed over your ${itemName(k)}. GRUNT: Welcome to TEAM ROCKET! Here, your signing bonus.${fullNote(overflow)}`, overflow }; } },
      { label: 'Flip the warehouse switches (all -20% HP): 2 items', ai: r => 0.45 - hpAi(r, 0.2), run: (r, rng) => { hurt(r, 0.2); flags(r).rocket2 ||= 'snuck'; const keys = twoFinds(r, rng); const overflow = found(r, keys); return { text: `The shutters rolled up on the wrong side, then the right one. You grabbed ${keys.map(itemName).join(' and ')} and ran!${fullNote(overflow)}`, overflow }; } },
      LEAVE(),
    ],
  }),

  // ---- Johto 3: Olivine -> Blackthorn ----------------------------------------------------------------------
  J([2], {
    id: 'lighthouse', title: 'OLIVINE LIGHTHOUSE', npc: null, mon: 'AMPHAROS', weight: 1, music: 'mus_poke_mansion',
    text: "At the top of the LIGHTHOUSE, JASMINE kneels by AMPHY, the AMPHAROS that lights the sea. It's sick, and the medicine is across the water in CIANWOOD.",
    choices: [
      { label: 'Fetch the medicine (all -20% HP): 1 of 2 items', ai: r => 1.0 - hpAi(r, 0.2), run: (r, rng) => { hurt(r, 0.2); const ch = [...fromList(r, rng, 1, ['METAL_COAT', 'MAGNET']), ...relics(r, rng, 1, W.uncommon)].filter((k, i, a) => a.indexOf(k) === i); return { text: "JASMINE: AMPHY's light is back! ...Please, take this.", relicChoices: ch.length ? ch : relics(r, rng, 2, W.common) }; } },
      { label: 'Share your own medicine (a bag item): 1 of 3 held items', cond: r => healers(r).length > 0, ai: () => 0.9, run: (r, rng) => { const k = healers(r)[0]; r.useConsumable(k); return { text: `You gave AMPHY your ${itemName(k)}. It brightened right up! JASMINE: Thank you... take one of these.`, relicChoices: relics(r, rng, 3, W.common) }; } },
      { label: 'Keep AMPHY company (heal 25%)', ai: r => (1 - teamHp(r)) * 1.2, run: (r) => { healAll(r, 0.25); return { text: 'The sea breeze and the warm light did your team good.' }; } },
    ],
  }),
  J([2], {
    id: 'cianwood', title: 'CIANWOOD CITY', npc: 'clerk', weight: 1, music: 'mus_surf',
    text: 'CIANWOOD\'s PHARMACY smells of herbs. Next door, a nervous man clutches a SHUCKLE: "Please, keep it safe from the thieves for a while!"',
    choices: [
      { label: r => `SECRETPOTION ($${cost(r, 600)}): full heal + cure`, cond: r => canPay(r, 600), ai: r => (1 - teamHp(r)) * 2.6 - 0.3, run: (r) => { pay(r, 600); healAll(r, 1, true); return { text: 'PHARMACIST: Our family recipe. Your POKéMON are good as new!' }; } },
      { label: 'Look after his SHUCKLE (+ a BERRY JUICE)', mon: 'gift', ai: r => roomAi(r) * 0.6, run: (r, rng) => { const overflow = found(r, ['BERRY_JUICE']); return { text: `MAN: Thank you! SHUCKLE makes BERRY JUICE, you know. Here's some.${fullNote(overflow)}`, newMon: gift(r, rng, 'SHUCKLE', 0, 15), overflow }; },
        nuz: { label: 'Hide it for him (2 FULL HEALS)', ai: () => 0.25, run: (r) => { const overflow = found(r, ['FULL_HEAL', 'FULL_HEAL']); return { text: `MAN: Phew. Take these for your trouble.${fullNote(overflow)}`, overflow }; } } },
      { label: r => `Herbal remedies ($${cost(r, 300)}): 2 FULL HEALS + a REVIVE`, cond: r => canPay(r, 300), ai: () => 0.3, run: (r) => { pay(r, 300); const overflow = found(r, ['FULL_HEAL', 'FULL_HEAL', 'REVIVE']); return { text: `PHARMACIST: Bitter, but they work.${fullNote(overflow)}`, overflow }; } },
      LEAVE(),
    ],
  }),
  J([2], {
    id: 'lake_of_rage', title: 'LAKE OF RAGE', npc: null, mon: 'GYARADOS', weight: 1, story: 'rocket', music: 'mus_route11',
    text: r => `The LAKE OF RAGE churns: a RED GYARADOS thrashes in the middle, forced to evolve by a strange signal from MAHOGANY TOWN.${flags(r).rocket2 === 'joined' ? ' Your ROCKET contacts call it "a little experiment".' : ''}${nuzNote(r)}`,
    choices: [
      { label: 'Face the RED GYARADOS (elite wild: catch it!)', solo: true, minFloor: 4, ai: r => fightAi(r, 1.1, 0.8), run: (r, rng) => { const cfg = wildFight(r, rng, 'GYARADOS', 3, { moves: ['BITE', 'DRAGON_RAGE', 'THRASH', 'LEER'], terrain: 'water', cfg: { rewardRelicW: W.uncommon } }); cfg.enemies[0].shiny = true; return { text: 'The RED GYARADOS turned its glare on you!', battle: cfg }; } },
      { label: 'Trace the signal (all -15% HP): 1 of 2 items', ai: r => 0.8 - hpAi(r, 0.15), run: (r, rng) => { hurt(r, 0.15); flags(r).rocketSignal = 1; return { text: 'The signal leads to a souvenir shop in MAHOGANY... with a hidden staircase. You grab what you can before the grunts notice.', relicChoices: relics(r, rng, 2, W.common) }; } },
      { label: 'Fish in calmer waters', mon: 'catch', cond: r => nuzCatchOk(r), ai: r => roomAi(r) * 0.5, run: (r, rng) => { useNuzCatch(r); const sp = rng.weighted([['MAGIKARP', 4], ['GYARADOS', 1], ['GOLDEEN', 2], ['POLIWHIRL', 2], ['QUAGSIRE', 2]], x => x[1])[0]; return { text: `You reeled in ${speciesName(sp)}!`, newMon: gift(r, rng, sp) }; } },
      LEAVE(),
    ],
  }),
  J([2], {
    id: 'mahogany_hideout', title: 'MAHOGANY HIDEOUT', npc: 'rocket_m', weight: 1, story: 'rocket', music: 'mus_rocket_hideout',
    text: r => `A cape flutters: LANCE drops in. "TEAM ROCKET hides under this souvenir shop, and their signal is driving POKéMON mad. Help me shut it down?"${villainJoined(r) ? ' The grunts at the door wave you through.' : ''}`,
    choices: [
      { label: 'Raid it with LANCE (elite: 1 of 3 held items)', solo: true, minFloor: 4, ai: r => fightAi(r, 1.4), run: (r, rng) => ({ text: 'GRUNT: Intruders! And... is that LANCE?!', battle: eliteFight(r, rng, ['JOHTO_ROCKET_GRUNT_3'], { rewardRelicW: W.high, winFlags: { rocketHideout: 1 } }) }) },
      { label: r => (villainJoined(r) ? 'Walk in in uniform: raid the storeroom' : 'Sneak to the storeroom (all -25% HP)'), ai: r => 1.0 - (villainJoined(r) ? 0 : hpAi(r, 0.25)), run: (r, rng) => { const joined = villainJoined(r); if (!joined) hurt(r, 0.25); return { text: joined ? 'Nobody questions a ROCKET uniform. The storeroom is all yours.' : 'You slipped past the ELECTRODE traps, mostly.', relicChoices: relics(r, rng, 2, W.uncommon) }; } },
      { label: 'Let LANCE handle it (heal 30%)', ai: r => (1 - teamHp(r)) * 1.4, run: (r) => { healAll(r, 0.3); return { text: 'LANCE: Leave it to me. Rest up: my DRAGONITE will watch the door.' }; } },
    ],
  }),
  J([2], {
    id: 'radio_tower', title: 'RADIO TOWER TAKEOVER', npc: 'rocket_m', weight: 1.2, story: 'rocket', music: 'mus_rocket_hideout',
    spawn: (p) => floorOf(p) >= 4, forced: (p) => rocketStory(p) && floorOf(p) >= 4, weightFn: (p) => (rocketStory(p) ? 3 : 1.2),
    text: r => `TEAM ROCKET has seized GOLDENROD's RADIO TOWER and is broadcasting a call to GIOVANNI!${flags(r).rocket2 === 'joined' ? ' The grunt at the door grins: "The new recruit! Head on up."' : rocketBeaten(r) >= 2 ? ' The grunts at the door go pale when they see you.' : flags(r).rocket1 === 'beat' ? ` "That's the kid from ${rocket1At(r)}!"` : ''} Three executives hold the floors above: no time to rest between them.`,
    choices: [
      { label: 'Take back the tower (3 elite fights, no heal: rare item)', solo: true, minFloor: 4, ai: r => fightAi(r, 1.7, 0.9), tip: 'PROTON or PETREL, then ARIANA, then ARCHER, back to back with no heal in between. Win all three: 1 of 3 rare held items and a RARE CANDY.',
        run: (r) => ({ text: 'You charge up the stairs. The first executive is waiting!', battle: radioFight(r, 0) }) },
      { label: r => (villainJoined(r) ? 'Walk up in uniform and free the DIRECTOR' : 'Sneak up to the DIRECTOR (all -30% HP)'), ai: r => 1.4 - (villainJoined(r) ? 0 : hpAi(r, 0.3)), tip: '1 of 2 uncommon/rare held items. The executives stay on the air...',
        run: (r, rng) => { const joined = villainJoined(r); if (!joined) hurt(r, 0.3); flags(r).rocket3 ||= 'snuck'; return { text: `${joined ? 'Nobody stops someone in a ROCKET uniform.' : 'Vents, stairwells, a very angry KOFFING...'} DIRECTOR: You found me! Take this, quickly!`, relicChoices: relics(r, rng, 2, W.high) }; } },
      { label: 'Jam the broadcast from outside (all -10% HP): a TM', ai: r => 0.6 - hpAi(r, 0.1), run: (r, rng) => { hurt(r, 0.1); return { text: 'You jammed the signal from a rooftop antenna. A grateful DJ slips you a TM.', tutor: tmTutor(r, rng, 2, 120) }; } },
      LEAVE('Walk away', "TEAM ROCKET's voices follow you out of GOLDENROD on every radio."),
    ],
  }),
  J([2], {
    id: 'dragons_den', title: "DRAGON'S DEN", npc: 'old_man_1', weight: 1, music: 'mus_mt_moon',
    text: r => `ELDER: Only those who understand POKéMON may enter the DRAGON SHRINE. Answer my questions honestly.${nuzNote(r)}`,
    choices: [
      { label: "Take the ELDER's test", ai: () => 0.95, run: (r) => denStep(r, 0, 0) },
      { label: 'Fish in the den', mon: 'catch', cond: r => nuzCatchOk(r), ai: r => roomAi(r) * 0.6, run: (r, rng) => { useNuzCatch(r); const sp = rng.weighted([['DRATINI', 1], ['HORSEA', 2], ['MAGIKARP', 2], ['SEADRA', 1]], x => x[1])[0]; return { text: `You reeled in ${speciesName(sp)}!`, newMon: gift(r, rng, sp) }; } },
      LEAVE(),
    ],
  }),
  J([2], {
    id: 'ice_path', title: 'ICE PATH', npc: null, mon: 'DELIBIRD', weight: 1, music: 'mus_mt_moon',
    text: "The floor of the ICE PATH is solid ice: slide the wrong way and you're back at the start. Something glitters in the far corner, and a DELIBIRD is stuck on a ledge.",
    choices: [
      { label: 'Solve the slide puzzle (all -15% HP): 1 of 2 items', ai: r => 0.9 - hpAi(r, 0.15), run: (r, rng) => { hurt(r, 0.15); const ch = [...fromList(r, rng, 1, ['NEVER_MELT_ICE']), ...relics(r, rng, 1, W.uncommon)].filter((k, i, a) => a.indexOf(k) === i); return { text: 'Left, up, left, down... made it!', relicChoices: ch.length ? ch : relics(r, rng, 2, W.common) }; } },
      { label: 'Slide recklessly (50%: 1 of 3 items, else all -30% HP)', ai: r => 0.45 - hpAi(r, 0.15), run: (r, rng) => { if (rng.chance(0.5)) return { text: 'Wheee! You shot straight into a hidden alcove!', relicChoices: relics(r, rng, 3, W.mid) }; hurt(r, 0.3); return { text: 'You slammed into a boulder, then another one. Ow.' }; } },
      { label: 'Rescue the DELIBIRD (its PRESENT: 2 items)', ai: () => 0.35, run: (r, rng) => { const keys = twoFinds(r, rng); const overflow = found(r, keys); return { text: `DELIBIRD handed you a PRESENT: ${keys.map(itemName).join(' and ')}!${fullNote(overflow)}`, overflow }; } },
    ],
  }),
  J([2], {
    id: 'mt_mortar', title: 'MT. MORTAR', npc: 'black_belt', weight: 1, music: 'mus_mt_moon',
    text: 'KARATE KING KIYO has been training alone deep in MT. MORTAR. "You found me! Beat me, and one of my students is yours."',
    choices: [
      { label: r => (r.nuzlocke ? 'Battle KIYO (elite: a held item)' : 'Battle KIYO (elite: TYROGUE or HITMONTOP)'), solo: true, minFloor: 4, ai: r => fightAi(r, 1.4), run: (r, rng) => {
        const kiyo = custom('KARATE_KING_KIYO', 'KARATE KING KIYO', 'BLACK_BELT_KOICHI', null, [['HITMONTOP', 34], ['PRIMEAPE', 34], ['MACHOKE', 35], ['POLIWRATH', 36]]);
        const extra = r.nuzlocke ? { rewardRelicW: W.uncommon } : { rewardMons: [gift(r, rng, 'TYROGUE', 2, 25), gift(r, rng, 'HITMONTOP', -1, 20)] };
        return { text: 'KIYO: Hwaaah! Show me your spirit!', battle: eliteFight(r, rng, [kiyo], extra) };
      } },
      { label: 'Train with him (lead +3 Lv, all -20% HP)', ai: r => 0.8 - hpAi(r, 0.2), run: (r) => { hurt(r, 0.2); const lead = alive(r)[0]; return { text: `${lead ? monName(lead) : 'Your lead'} trained under the KARATE KING!`, levelEvents: lead ? [{ mon: lead, events: addLevels(lead, 3) }] : [] }; } },
      LEAVE('Bow and leave', 'KIYO: Come back when you are ready.'),
    ],
  }),

  // ---- Johto 4: Victory Road -> Indigo Plateau (no event money) ---------------------------------------------
  J([3], {
    id: 'boulders_j', title: 'VICTORY ROAD BOULDERS', npc: 'hiker', weight: 1, music: 'mus_victory_road',
    text: "Boulders block JOHTO's side of VICTORY ROAD. Something glitters beyond them.",
    choices: KANTO.find(e => e.id === 'boulders').choices,
  }),
  J([3], {
    id: 'rocket_remnants', title: 'ROCKET REMNANTS', npc: 'rocket_m', weight: 1, story: 'rocket', music: 'mus_rocket_hideout',
    text: r => `${flags(r).radio === 'saved' ? 'With the RADIO TOWER lost, ' : 'Their call to GIOVANNI went unanswered, so '}the last ROCKET grunts are selling off their loot by TOHJO FALLS.${villainJoined(r) ? ' "Members get the family price!"' : rocketBeaten(r) >= 2 ? ' They flinch when they see you.' : ''}`,
    choices: KANTO.find(e => e.id === 'blackmarket').choices,
  }),
  J([3], {
    id: 'veteran_j', title: "THE VETERAN'S PARTNER", npc: 'old_man_2', weight: 1, music: 'mus_victory_road',
    text: "VETERAN: I'm retiring from battling. I'd like my gear and my partner to go to someone strong.",
    choices: KANTO.find(e => e.id === 'veteran').choices,
  }),
  J([3], {
    id: 'route27_ace', title: 'ROUTE 27 ACE TRAINER', npc: 'cooltrainer_f', weight: 1, music: 'mus_route11',
    text: "COOLTRAINER: Only the toughest make it through ROUTE 27. Battle me! Or I'll tell you what I know about the ELITE FOUR...",
    choices: KANTO.find(e => e.id === 'acetrainer').choices,
  }),
  J([3], {
    id: 'provisions_j', title: 'INDIGO PLATEAU PROVISIONS', npc: 'clerk', weight: 1, music: 'mus_poke_center',
    text: 'CLERK: All the way from JOHTO? Last stop before the POKéMON LEAGUE! Take one supply bundle, on the house.',
    choices: provisionChoices(),
  }),

  // ---- Johto post-game: Mt. Silver ---------------------------------------------------------------------------
  J([4], {
    id: 'silver_spring', title: 'MT. SILVER HOT SPRING', npc: null, mon: 'URSARING', weight: 1, music: 'mus_sevii_cave',
    text: 'A hot spring steams in a hidden cave on MT. SILVER. High above it, something glints on a ledge.',
    choices: [
      { label: 'Soak in the spring (full heal + cure)', ai: r => (1 - teamHp(r)) * 2.5, run: (r) => { healAll(r, 1, true); return { text: 'Aaah... Your POKéMON are fully rested.' }; } },
      { label: 'Climb to the ledge (all -40% HP): 1 of 3 rare items', ai: r => 1.4 - hpAi(r, 0.4), run: (r, rng) => { hurt(r, 0.4); return { text: "The climb was brutal, but the ledge hid an old trainer's stash!", relicChoices: relics(r, rng, 3, W.rare) }; } },
      LEAVE(),
    ],
  }),
  J([4], {
    id: 'bell_tower', title: 'BELL TOWER', npc: null, mon: 'HO_OH', weight: 1, music: 'mus_sevii_67',
    text: 'Atop the BELL TOWER, a rainbow feather drifts down. The sages say HO-OH leaves SACRED ASH for trainers with pure hearts.',
    choices: [
      { label: 'Gather the SACRED ASH (revive all + full heal)', ai: r => (r.party.some(isFainted) ? 2 : (1 - teamHp(r)) * 2), run: (r) => { for (const m of r.party) { m.hp = maxHp(m); m.status = null; } return { text: 'The ash shimmered and your whole team rose, good as new!' }; } },
      { label: 'Take the RAINBOW WING (1 of 3 rare items + curse)', curse: 'HEX_LETTER', ai: () => 1.5 - curseAi, tip: 'A HEX LETTER (curse: -1 discard, foes +5% damage) comes with it.', run: (r, rng) => { const c = addCurse(r, 'HEX_LETTER'); return { text: 'The feather burns with seven colors.' + (c ? CURSE_TEXT(c) : ''), relicChoices: relics(r, rng, 3, W.rare), curse: c }; } },
      { label: 'Ring the bells (all +2 levels)', ai: () => 1.1, run: (r) => ({ text: 'The bells rang out over ECRUTEAK. Your team feels stronger!', levelEvents: alive(r).map(m => ({ mon: m, events: addLevels(m, 2) })) }) },
    ],
  }),
  J([4], {
    id: 'gs_ball', title: 'THE GS BALL', npc: null, mon: 'CELEBI', weight: 1, music: 'mus_viridian_forest',
    text: 'KURT finally opened the GS BALL. Placed at the ILEX FOREST shrine, it hums... and the air shimmers as if time itself were bending.',
    choices: [
      { label: 'Wait at the shrine (CELEBI)', mon: 'gift', legend: 'CELEBI', ai: r => roomAi(r) * 1.4, run: (r, rng) => ({ text: 'A small green POKéMON blinked into being and settled on your shoulder. CELEBI!', newMon: legendGift(r, gift(r, rng, 'CELEBI', -6, 20)) }) },
      { label: 'Let time flow back (full heal + 2 RARE CANDY)', ai: () => 1.0, run: (r) => { healAll(r, 1, true); const overflow = found(r, ['RARE_CANDY', 'RARE_CANDY']); return { text: `For a moment it was yesterday. Your team is fresh, and two RARE CANDIES sit by the shrine.${fullNote(overflow)}`, overflow }; } },
      { label: "KURT's masterwork (1 of every APRICORN BALL)", ai: () => 0.4, run: (r) => { for (const k of APRICORN_BALLS) giveBalls(r, k, 1); return { text: "KURT: My finest work. One of each, carved from the GS BALL's own APRICORN tree!" }; } },
    ],
  }),
  J([4], {
    id: 'pokeathlon', title: 'POKéATHLON DOME', npc: 'cooltrainer_m', weight: 1, music: 'mus_cycling',
    text: 'The POKéATHLON DOME! Hurdles, relays and snow throws. Compete for the vitamin prizes, or watch from the stands.',
    choices: [
      { label: 'Compete (all -20% HP): 2 of 3 vitamins', ai: r => 1.3 - hpAi(r, 0.2), run: (r, rng) => { hurt(r, 0.2); return { text: 'Your team gave it everything! Pick your prizes.', itemChoices: { ...vitaminChoice(r, rng, 3), picks: 2 } }; } },
      { label: 'Watch from the stands (1 of 3 vitamins)', ai: () => 0.8, run: (r, rng) => ({ text: 'You learned a lot just by watching!', itemChoices: vitaminChoice(r, rng, 3) }) },
      LEAVE(),
    ],
  }),
  J([4], {
    id: 'battle_frontier_j', title: 'BATTLE FRONTIER', npc: 'cooltrainer_f', weight: 1, music: 'mus_trainer_tower',
    text: "The BATTLE FRONTIER's TOWER TYCOON is taking challengers. Beat the tower's best, or watch from the stands.",
    choices: KANTO.find(e => e.id === 'trainer_tower').choices,
  }),
];

// =============================================================================================================
// STORY FALLBACKS (One Spire): a story whose payoff region isn't on this run's path
// =============================================================================================================
// Is act 3 of this run in KANTO (where the CINNABAR LAB is)? (r.acts: a real run; the co-op probe has no acts.)
function labLater(r) { const a3 = r.acts?.[2]; return !a3 || a3.region === 'kanto'; }
const FALLBACKS = [
  {
    // the OLD AMBER sent from PEWTER, when act 3 isn't in KANTO (in KANTO the CINNABAR LAB pays it off)
    id: 'amber_courier', title: 'CINNABAR LAB COURIER', npc: 'scientist', world: null, acts: [2], weight: 1, story: 'amber', music: 'mus_cinnabar',
    forced: (p) => flags(p).amber === 'sent', spawn: (p) => flags(p).amber === 'sent', follows: (p) => flags(p).amber === 'sent' && regionIdOf(p) !== 'kanto',
    text: r => `COURIER: Special delivery from the CINNABAR LAB, all the way to ${reg(r).name}! Your OLD AMBER was revived.`,
    choices: [
      { label: 'Collect your AERODACTYL', mon: 'gift', ai: r => roomAi(r) * 1.6 + 0.2,
        run: (r, rng) => { flags(r).amber = 'done'; r.logEvent?.({ k: 'story', id: 'amber', v: 'done' }); return { text: 'The OLD AMBER became AERODACTYL!', newMon: gift(r, rng, 'AERODACTYL', 0, 20) }; },
        nuz: { label: 'Take back the OLD AMBER', show: r => !has(r, 'OLD_AMBER'), ai: () => 0.8, run: (r) => { flags(r).amber = 'done'; r.addRelic('OLD_AMBER'); return { text: 'COURIER: The machine is busy, so the lab sent your OLD AMBER back.', relic: 'OLD_AMBER' }; } } },
      LEAVE('Send it back', 'COURIER: Suit yourself. The lab will keep it.'),
    ],
  },
];

// =============================================================================================================
// MYTHIC "?" EVENTS (v0.3.25): rare one-off fights with a mythic POKéMON (acts.js MYTHICS, Run.mythicConfig).
// Each is forced at the first "?" room of an act where it can happen once its roll (from the run's seed, per act)
// came up, and is never part of the normal pools. Win: a one-time catch offer (ONE LEGENDARY PER RUN) and a held
// item; lose: the run goes on (the mythic throws your team out: Run.softLoss). Co-op: the whole room fights
// (coop.js mythicDuoConfig; no "Leave": the mythic blocks the way) and every player gets their own catch offer.
//   CERULEAN CAVE  MEWTWO    KANTO act 3, only if a CHAMPION was beaten in an earlier run (flags.champ; co-op: anyone)
//   FARAWAY ISLAND MEW       any act, ultra rare; more likely after MEW'S JOURNAL's "Fund the research"
//   BIRTH ISLAND   DEOXYS    holding the METEORITE (co-op: anyone), HOENN act 3+ or the SEVII ISLANDS post-game
//   SKY PILLAR     RAYQUAZA  holding the RED ORB or BLUE ORB, or met GROUDON / KYOGRE this run; HOENN act 3+
// MYTHIC_ODDS: the roll per eligible act (MEWTWO: per run; MEW: per act, MEW_FUNDED once the research was funded). The
// smart bot meets a forced event in ~86% of the acts it can (a "?" on its path), so: MEWTWO ~15% of eligible runs, MEW ~3%
// of all runs (1.7% per act), DEOXYS / RAYQUAZA ~25% of each eligible act (tests/balance.mjs --mythicodds benches them).
export const MYTHIC_ODDS = { MEWTWO: 0.2, MEW: 0.017, MEW_FUNDED: 0.07, DEOXYS: 0.3, RAYQUAZA: 0.3 };
export const mythicRoll = (p, salt) => new RNG(`${p.seed}:mythic:${salt}`).next();
const hasAny = (p, keys) => keys.some(k => has(p, k));
const metAny = (p, sps) => sps.some(sp => (p.seen || []).includes(sp));
export const MYTHIC_CAN = {
  MEWTWO: (p) => regionIdOf(p) === 'kanto' && act(p) === 2 && !!flags(p).champ,
  MEW: () => true,
  DEOXYS: (p) => has(p, 'METEORITE') && ((regionIdOf(p) === 'hoenn' && act(p) >= 2) || (regionIdOf(p) === 'kanto' && act(p) === 4)),
  RAYQUAZA: (p) => (hasAny(p, ['RED_ORB', 'BLUE_ORB']) || metAny(p, ['GROUDON', 'KYOGRE'])) && regionIdOf(p) === 'hoenn' && act(p) >= 2,
};
export const MYTHIC_ROLL = {
  MEWTWO: (p) => mythicRoll(p, 'MEWTWO') < MYTHIC_ODDS.MEWTWO,
  MEW: (p) => mythicRoll(p, 'MEW' + act(p)) < (flags(p).mewJournal === 'funded' ? MYTHIC_ODDS.MEW_FUNDED : MYTHIC_ODDS.MEW),
  DEOXYS: (p) => mythicRoll(p, 'DEOXYS' + act(p)) < MYTHIC_ODDS.DEOXYS,
  RAYQUAZA: (p) => mythicRoll(p, 'RAYQUAZA' + act(p)) < MYTHIC_ODDS.RAYQUAZA,
};
export const mythicDue = (p, id) => !!MYTHIC_CAN[id](p) && !!MYTHIC_ROLL[id](p);
// The mythic battle of a "?" event (solo: this config; co-op ignores it and starts the room's duo battle instead).
export function mythicFight(r, rng, id) { return eventBattle(r, r.mythicConfig(rng, floorOf(r), id)); }
// The bots: a mythic is worth a lot while you can still catch it; the held item alone is a decent prize; a loss costs 30% HP.
const mythicAi = (r) => (r.hasLegendary?.() ? 0.9 : 2.4) - (teamHp(r) < 0.55 || r.party.some(isFainted) ? 1.6 : 0);
const catchLine = (r) => (r.hasLegendary?.() ? ' You already have a legendary this run: win for the held item.' : ' Catching it is your one legendary this run.');
function mythicEvent(id, e) {
  const M = MYTHICS[id];
  return {
    id: e.id, title: e.title, npc: null, mon: M.species, mythic: id, world: null, acts: [0, 1, 2, 3, 4], weight: 1, weightFn: () => 0.001, music: M.music,
    follows: (p) => MYTHIC_CAN[id](p), spawn: (p) => mythicDue(p, id), forced: (p) => mythicDue(p, id),
    text: r => e.text(r) + catchLine(r),
    choices: [
      { label: r => (r.coop ? `${e.verb} together! (the whole room fights)` : `${e.verb} (mythic battle)`), mythic: id, ai: mythicAi, tip: e.tip,
        run: (r, rng) => ({ text: e.fight, battle: mythicFight(r, rng, id) }) },
      LEAVE(e.leave, e.leaveText),
    ],
  };
}
const MYTHIC_EVENTS = [
  mythicEvent('MEWTWO', {
    id: 'cerulean_cave', title: 'CERULEAN CAVE', verb: 'Face MEWTWO',
    text: () => 'Deep in CERULEAN CAVE, a POKéMON made by human hands opens its eyes. Its power fills the cavern.',
    tip: 'MEWTWO hits hard and every hand you play costs a discard (co-op: it attacks EVERY player each turn). Lose and your team is thrown out (all lose 30% HP); the run goes on.',
    fight: 'MEWTWO: ...', leave: 'Back away quietly', leaveText: 'You left the cave. MEWTWO closed its eyes again.',
  }),
  mythicEvent('MEW', {
    id: 'faraway_island', title: 'FARAWAY ISLAND', verb: 'Chase MEW',
    text: r => `On a FARAWAY ISLAND, something pink giggles in the tall grass and darts away.${flags(r).mewJournal === 'funded' ? ' The MANSION research notes in your bag rustle.' : ''} It won't stay long: catch it or beat it in 3 turns!`,
    tip: 'A short hide-and-seek battle: MEW flees after 3 turns unless it is asleep or paralyzed. It is easy to catch with a ball, and it knows every move.',
    fight: 'MEW wants to play!', leave: 'Let it be', leaveText: 'MEW giggled and vanished into the grass.',
  }),
  mythicEvent('DEOXYS', {
    id: 'birth_island', title: 'BIRTH ISLAND', verb: 'Face DEOXYS',
    text: () => 'Your METEORITE hums. On BIRTH ISLAND, a triangle of light breaks open and DEOXYS descends, shifting shape.',
    tip: 'DEOXYS switches forme every turn: ATTACK (hits much harder), DEFENSE (takes much less damage), SPEED (moves first). Lose and your team is thrown out (all lose 30% HP).',
    fight: 'DEOXYS shifted into its ATTACK FORME!', leave: 'Back away', leaveText: 'DEOXYS faded into the night sky.',
  }),
  mythicEvent('RAYQUAZA', {
    id: 'sky_pillar', title: 'SKY PILLAR', verb: 'Climb to RAYQUAZA',
    text: r => `${hasAny(r, ['RED_ORB', 'BLUE_ORB']) ? 'Your ORB glows' : 'The clash of GROUDON and KYOGRE echoes'}: atop the SKY PILLAR, RAYQUAZA stirs from its rest.`,
    tip: 'RAYQUAZA is a top-tier legendary: PRESSURE costs you a discard per hand. Lose and your team is thrown out (all lose 30% HP).',
    fight: 'RAYQUAZA roared from the top of the SKY PILLAR!', leave: 'Climb back down', leaveText: 'RAYQUAZA went back to sleep in the clouds.',
  }),
];
// A "?" event's legendary gift (LATIAS, CELEBI): it is the run's one legendary.
function legendGift(r, mon) { r.markLegendary?.(mon.species); return mon; }

export const EVENTS = [...SHRINES, ...KANTO, ...HOENN, ...JOHTO, ...FALLBACKS, ...MYTHIC_EVENTS];
const BY_ID = new Map(EVENTS.map(e => [e.id, e]));
export const eventById = (id) => BY_ID.get(id) || null;

// ---- choices for this run (co-op, NUZLOCKE, floor gates) --------------------------------------------------
export const choiceLabel = (c, run) => (typeof c.label === 'function' ? c.label(run) : c.label);
export const eventTitle = (e, run) => (typeof e.title === 'function' ? e.title(run) : e.title);
export const eventText = (e, run) => (typeof e.text === 'function' ? e.text(run) : e.text);
export const eventNpc = (e, run) => (typeof e.npc === 'function' ? e.npc(run) : e.npc);
const giftLike = (c) => c.mon === 'gift' || c.mon === 'trade';
// The choices a run gets at this event: co-op hides solo (battle) choices; NUZLOCKE hides gift/trade choices
// (or shows their c.nuz replacement); battles wait until floor c.minFloor (like elites).
export function eventChoices(ev, run) {
  const out = [];
  for (const c0 of ev.choices) {
    let c = c0;
    if (run.nuzlocke && giftLike(c)) { if (!c.nuz) continue; c = c.nuz; }
    if (c.solo && run.coop) continue;
    if (ev.mythic && run.coop && c.leave) continue; // (co-op: the mythic blocks the way, the room fights it)
    // ONE LEGENDARY PER RUN (v0.3.25): a legendary gift says so, and is greyed out once you have one
    if (c.legend) { const base = c; c = { ...base, label: r => `${choiceLabel(base, r)}${r.hasLegendary?.() ? ': you already have a legendary' : ' (your one legendary)'}`, cond: r => !r.hasLegendary?.() && (!base.cond || base.cond(r)), tip: run.legendRuleText?.() || base.tip }; }
    if (c.minFloor && floorOf(run) < c.minFloor) continue;
    if (c.show && !c.show(run)) continue;
    if (c.curse && has(run, c.curse)) continue; // (one of each curse: a choice that would give a curse you hold is hidden)
    out.push(c);
  }
  // never a dead end: if everything was hidden, you can always walk on
  if (!out.length || out.every(c => c.cond && !c.cond(run))) out.push(LEAVE());
  return out;
}
// Does an event have something to offer here (not just "Leave")? Static flags only, so it can run on the
// co-op probe (shared inputs).
function meaningful(e, p) {
  return e.choices.some(c => !c.leave && !(c.solo && p.coop) && !(p.nuzlocke && giftLike(c) && !c.nuz));
}
// An act event belongs to its region; a story event with follows(p) can turn up in another region's act too.
const inWorld = (e, p) => e.shrine || e.world === regionIdOf(p) || (!!e.follows && e.follows(p));
function available(e, p) {
  if (!inWorld(e, p)) return false;
  if (e.minParty && (p.party?.length || 0) < e.minParty) return false;
  if (e.spawn && !e.spawn(p)) return false;
  return meaningful(e, p);
}
const shrineKey = (id, a) => `${id}@${a}`;

// Picks the event for a "?" room. probe: the run (solo) or the co-op probe (shared inputs only: world, actIndex,
// floor, party.length, seenEvents, flags, relicCount, coop, nuzlocke). Order: a story payoff that's due (e.g. the
// OLD AMBER at act 3's first "?"), else the shrines 25% / the act's pool 75% (act events once per run, a shrine
// once per act), falling back to shrines when the act pool runs dry. Records the pick in probe.seenEvents.
export function pickEvent(run, rng) {
  const a = act(run), world = regionIdOf(run);
  const seen = run.seenEvents || [];
  let ev = EVENTS.find(e => e.forced && inWorld(e, run) && e.acts.includes(a) && !seen.includes(e.id) && e.forced(run) && available(e, run));
  if (!ev) {
    const actPool = EVENTS.filter(e => !e.shrine && inWorld(e, run) && e.acts.includes(a) && !seen.includes(e.id) && available(e, run));
    const shrines = EVENTS.filter(e => e.shrine && !seen.includes(shrineKey(e.id, a)) && available(e, run));
    const roll = rng.next();
    let pool = actPool.length && (!shrines.length || roll >= SHRINE_SHARE) ? actPool : shrines;
    if (!pool.length) pool = EVENTS.filter(e => e.shrine && available(e, run));
    if (!pool.length) pool = [eventById('berries')];
    ev = rng.weighted(pool, e => (e.weightFn ? e.weightFn(run) : e.weight || 1) * storyBoost(e, run));
  }
  run.seenEvents = [...seen, ev.shrine ? shrineKey(ev.id, a) : ev.id];
  return ev;
}
// A story you've started is more likely to continue (the next ROCKET / AQUA step, WALLY's return).
function storyBoost(e, p) {
  const f = p.flags || {};
  // (either faction's steps count: the villain story follows you from region to region)
  if ((e.story === 'rocket' || e.story === 'aqua') && (f.rocket1 || f.rocket2 || f.rocket3 || f.aqua1 || f.aqua2 || f.aqua3)) return 2;
  if (e.story === 'wally' && f.wally === 'helped') return 3;
  return 1;
}
// Records an event as seen (shrines per act). Co-op uses it for the shared pick.
export function markSeen(run, ev) { const k = ev.shrine ? shrineKey(ev.id, act(run)) : ev.id; if (!(run.seenEvents || []).includes(k)) run.seenEvents = [...(run.seenEvents || []), k]; }
// The co-op probe: what both players share (the smaller party and held-item count, the union of seen events and
// story flags), so every client picks the same event.
export function coopProbe(world, runs) {
  const rs = runs.filter(Boolean);
  const fl = {};
  for (const r of rs) for (const [k, v] of Object.entries(r.flags || {})) if (fl[k] === undefined) fl[k] = v;
  if (world.flags?.champ) fl.champ = true; // (v0.3.25: someone in the room beat a CHAMPION, see CoopGame 'champ')
  // (v0.3.25, the mythic events: anyone's held items and anyone's POKéMON met this run)
  const relicKeys = [...new Set(rs.flatMap(r => (r.relics || []).map(x => x.key)))];
  return {
    relics: relicKeys.map(key => ({ key })), seen: [...new Set(rs.flatMap(r => r.seen || []))],
    world: world.world, region: world.region, actIndex: world.actIndex, floor: world.floor, nodeId: world.nodeId, seed: world.seed, coop: true, nuzlocke: false, ascension: world.ascension,
    party: { length: Math.min(...rs.map(r => r.party.length)) },
    relicCount: Math.min(...rs.map(r => relicCountOf(r))),
    seenEvents: [...new Set(rs.flatMap(r => r.seenEvents || []))],
    flags: fl,
  };
}
export const isShrineSeen = (run, id, a = act(run)) => (run.seenEvents || []).includes(shrineKey(id, a));
