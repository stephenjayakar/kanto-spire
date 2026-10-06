// v0.3.2 EXP tests: node tests/v032_exp.test.mjs
// - fainted POKéMON (hp <= 0 when the battle ended) get no EXP, level-ups or move prompts, solo and co-op (co-op revives
//   a downed player's lead at the end of a won battle: that lead still gets nothing);
// - A5 LEVEL CAP (replaced Weary): battle EXP stops at the act boss's top level +TUNING.levelCapOffset, the rest flows
//   to the lowest-level teammates under the cap; RARE CANDY can pass it; normal healing at A5+; shinies still at A5+;
// - Gen 5 scaled EXP: each recipient's share x ((2*Lfoe+10)/(Lfoe+Lmon+10))^TUNING.expCurve, per defeated foe.
import fs from 'fs';
import assert from 'assert/strict';
import { loadData, expYield, expForLevel, D } from '../web/src/game/data.js';
import { Run, TUNING, expLevelScale, expShareScale, ASCENSIONS, LEVEL_CAP_ASC } from '../web/src/game/run.js';
import { unlockShiny } from '../web/src/game/state.js';
import { CONSUMABLES } from '../web/src/game/items.js';
import { Battle } from '../web/src/game/battle.js';
import { makeMon, maxHp, isFainted } from '../web/src/game/pokemon.js';
import { CoopGame } from '../web/src/game/coop/coop.js';
import { COOP_TUNING } from '../web/src/game/coop/tuning.js';
import { chooseHand } from './bot.mjs';

await loadData(async f => JSON.parse(fs.readFileSync('web/assets/data/' + f, 'utf8')));
let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.log('FAIL', name, '-', e.stack.split('\n').slice(0, 3).join(' | ')); } };
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

// ------------------------------------------------------------------------------------ the curve
t('curve: 1 at the same level, less above the foe, more below (Gen 5 formula)', () => {
  assert.equal(TUNING.expCurve > 0, true);
  for (const L of [5, 20, 47]) near(expLevelScale(L, L), 1);
  near(expLevelScale(10, 20, 2.5), Math.pow(30 / 40, 2.5));
  near(expLevelScale(10, 5, 2.5), Math.pow(30 / 25, 2.5));
  assert.ok(expLevelScale(30, 40) < expLevelScale(30, 35) && expLevelScale(30, 35) < 1);
  assert.ok(expLevelScale(30, 20) > expLevelScale(30, 25) && expLevelScale(30, 25) > 1);
  near(expLevelScale(10, 30, 0), 1); // curve 0 = flat EXP
});

t('curve: per defeated foe, weighted by each foe\'s EXP', () => {
  const foes = [{ level: 10, exp: 100 }, { level: 20, exp: 300 }];
  near(expShareScale(foes, 15), (100 * expLevelScale(10, 15) + 300 * expLevelScale(20, 15)) / 400);
  near(expShareScale([], 15), 1);
  near(expShareScale(undefined, 15), 1); // (results saved before v0.3.2)
});

// ------------------------------------------------------------------------------------ solo
function soloRun(seed = 'EXPT') {
  const run = Run.create({ starter: 'CHARMANDER', ascension: 0, seed });
  const a = makeMon('PIDGEY', 6, { rng: run.rng }), b = makeMon('RATTATA', 6, { rng: run.rng });
  run.party.push(a, b);
  return run;
}

t('solo: a fainted POKéMON gets no EXP, no level-up and no move prompt; the others do', () => {
  const run = soloRun();
  const [lead, a, b] = run.party;
  b.hp = 0;
  // enough EXP to level everyone several times
  const result = { outcome: 'win', exp: 3000, foes: [{ level: 6, exp: 3000 }], participants: [lead.uid], fainted: [b.uid] };
  const lvB = b.level, expB = b.exp;
  const out = run.distributeExp(result, 'trainer');
  assert.ok(!out.some(r => r.mon === b), 'fainted mon not in the EXP results');
  assert.equal(b.level, lvB); assert.equal(b.exp, expB);
  assert.ok(out.some(r => r.mon === lead) && out.some(r => r.mon === a));
  assert.ok(out.find(r => r.mon === lead).events.some(e => e.type === 'level'));
});

t('solo: a POKéMON fainted at the end of the battle gets nothing even if revived before the EXP is paid', () => {
  const run = soloRun();
  const [lead, a] = run.party;
  const result = { outcome: 'win', exp: 3000, foes: [{ level: 6, exp: 3000 }], participants: [lead.uid], fainted: [a.uid] };
  a.hp = 5; // revived (e.g. co-op's end-of-battle revive) after the result was made
  const lvA = a.level;
  const out = run.distributeExp(result, 'trainer');
  assert.ok(!out.some(r => r.mon === a));
  assert.equal(a.level, lvA);
});

t('solo: Battle.end lists the fainted POKéMON and keeps them out of the participants', () => {
  const run = soloRun('EXPB');
  const cfg = run.wildConfig(run.rng.fork('t'), 1);
  assert.ok(cfg && cfg.enemies?.length, 'got a battle config');
  const b = new Battle(run, cfg);
  b.start();
  const [lead, a] = run.party;
  b.participants.add(a.uid);
  a.hp = 0;
  for (const e of b.enemies) { e.hp = 0; b.defeated.push(e); }
  b.end('win');
  assert.ok(b.result.fainted.includes(a.uid));
  assert.ok(!b.result.participants.includes(a.uid));
  assert.ok(b.result.participants.includes(lead.uid));
  assert.equal(b.result.foes.length, b.defeated.filter(e => !e.noExp).length);
  assert.equal(b.result.foes.reduce((s, f) => s + f.exp, 0), b.result.exp);
  for (const [i, f] of b.result.foes.entries()) assert.equal(f.exp, expYield(b.defeated[i].species, f.level, false));
  const out = run.distributeExp(b.result, b.kind);
  assert.ok(!out.some(r => r.mon === a));
});

t('solo: scaled EXP: an over-leveled POKéMON earns less than one at the foe\'s level, an under-leveled one more', () => {
  const run = Run.create({ starter: 'CHARMANDER', ascension: 0, seed: 'EXPS' });
  run.party.length = 0;
  const hi = makeMon('PIDGEY', 30, { rng: run.rng }), mid = makeMon('PIDGEY', 20, { rng: run.rng }), lo = makeMon('PIDGEY', 10, { rng: run.rng });
  run.party.push(hi, mid, lo);
  const result = { outcome: 'win', exp: 200, foes: [{ level: 20, exp: 200 }], participants: [hi.uid, mid.uid, lo.uid], fainted: [] };
  const out = run.distributeExp(result, 'trainer');
  const g = m => out.find(r => r.mon === m);
  const base = Math.floor(200 * TUNING.expMult);
  assert.equal(g(mid).gained, base);
  assert.equal(g(hi).gained, Math.floor(200 * TUNING.expMult * expLevelScale(20, 30)));
  assert.equal(g(lo).gained, Math.floor(200 * TUNING.expMult * expLevelScale(20, 10)));
  assert.ok(g(hi).gained < base && g(lo).gained > base);
  near(g(mid).scale, 1); assert.ok(g(hi).scale < 1 && g(lo).scale > 1, 'the reward screen reads r.scale');
  // the bench's half share is scaled the same way
  const bench = { ...result, participants: [mid.uid] };
  const out2 = run.distributeExp(bench, 'trainer');
  assert.equal(out2.find(r => r.mon === hi).gained, Math.floor(200 * TUNING.expMult * 0.5 * expLevelScale(20, hi.level)));
});

// ------------------------------------------------------------------------------------ co-op
const INIT = (seed, starters = ['BULBASAUR', 'CHARMANDER']) => ({ seq: 1, type: 'init', seed, ascension: 0, world: 'kanto', starters, names: ['A', 'B'] });
const post = (g, a) => g.apply(JSON.parse(JSON.stringify({ ...a, seq: g.seq + 1, nonce: 'x' + (g.seq + 1) })));
function gameInBattle(type, seed0) {
  for (let i = 0; i < 200; i++) {
    const g = CoopGame.fromInit(INIT(seed0 + i));
    const id = g.reachable().find(n => g.world.map.nodes[n].type === type);
    if (!id) continue;
    post(g, { p: 0, type: 'vote', node: id });
    post(g, { p: 1, type: 'vote', node: id });
    if (g.phase === 'battle') return g;
  }
  throw new Error('no ' + type + ' start node');
}
function bestHand(d, p, slot) {
  const s = d.subs[p];
  return s.withFocus(d.field[d.normSlot(slot)], () => chooseHand(s, 'smart').best);
}

t('co-op: a downed player\'s lead, revived when the partner wins, gets no EXP (and nobody fainted in their party does)', () => {
  const g = gameInBattle('wild', 'XREV');
  const d = g.battle, s0 = d.subs[0];
  for (const m of s0.run.party.slice(1)) m.hp = 0;
  const lead = s0.lead();
  s0.damagePlayer(lead, lead.hp);
  s0.checkLeadFaint();
  assert.equal(d.down[0], true);
  for (const e of d.enemies) e.hp = Math.min(e.hp, 3);
  let guard = 0;
  while (g.phase === 'battle' && guard++ < 40) {
    const ids = bestHand(d, 1, d.field[0] !== null ? 0 : 1);
    post(g, ids ? { p: 1, type: 'lock', ids, target: d.field[0] !== null ? 0 : 1 } : { p: 1, type: 'lock', pass: true });
  }
  assert.equal(g.phase, 'private');
  assert.equal(g.private.kind, 'reward');
  assert.equal(lead.hp, Math.max(1, Math.floor(maxHp(lead) * COOP_TUNING.reviveFrac)), 'the lead is revived');
  const r0 = g.battleSubs[0].result, r1 = g.battleSubs[1].result;
  assert.ok(r0.exp > 0 && r0.fainted.includes(lead.uid) && !r0.participants.includes(lead.uid));
  // what the reward scene does: distributeExp on the private clone of the player's run
  const run0 = g.privateRunClone(0);
  const lead0 = run0.party.find(m => m.uid === lead.uid);
  assert.ok(!isFainted(lead0), 'revived in the clone too');
  const lv0 = run0.party.map(m => m.level);
  const out0 = run0.distributeExp({ ...r0 }, g.battleSubs[0].kind);
  assert.equal(out0.length, 0, 'no EXP for the downed player\'s POKéMON');
  assert.deepEqual(run0.party.map(m => m.level), lv0);
  // the partner who won gets EXP, scaled by the same rule
  const run1 = g.privateRunClone(1);
  const out1 = run1.distributeExp({ ...r1 }, g.battleSubs[1].kind);
  assert.ok(out1.length > 0 && out1.every(r => r.gained > 0));
  for (const r of out1) near(r.scale, expShareScale(r1.foes, r.before));
});

t('co-op: the EXP rescale (COOP_TUNING.exp / expScale) keeps the per-foe split consistent', () => {
  const g = gameInBattle('trainer', 'XTR');
  const d = g.battle;
  for (const e of d.enemies) e.hp = 1;
  let guard = 0;
  while (g.phase === 'battle' && guard++ < 60) {
    for (const p of [0, 1]) {
      if (g.phase !== 'battle' || d.down[p] || d.locks[p]) continue;
      const slot = d.field[0] !== null ? 0 : 1;
      const ids = bestHand(d, p, slot);
      post(g, ids ? { p, type: 'lock', ids, target: slot } : { p, type: 'lock', pass: true });
    }
  }
  if (g.phase !== 'private') return; // (a rare fight that didn't end in a win: nothing to check)
  for (const s of g.battleSubs) {
    const r = s.result;
    if (!r.exp) continue;
    assert.ok(Array.isArray(r.foes) && r.foes.length > 0);
    assert.ok(Array.isArray(r.fainted));
    // r.exp was rescaled for co-op but r.foes holds the raw yields: the scale is a ratio, so it only uses levels
    const raw = r.foes.reduce((a, f) => a + f.exp, 0);
    assert.equal(r.exp, Math.round(raw * (COOP_TUNING.exp[g.battleCfg.coopKind] ?? 1) * (g.battleCfg.expScale ?? 1)));
  }
});

// ------------------------------------------------------------------------------------ A5 level cap
const capsOf = (run) => run.acts.map((a, i) => { run.actIndex = i; return run.levelCap(); });
const capRun = (asc, extra = {}) => Run.create({ starter: 'CHARMANDER', ascension: asc, seed: 'CAPT', ...extra });
const off = TUNING.levelCapOffset;

t('cap: none below A5; A5 = the act boss\'s top level + offset (KANTO: gyms 15/27/41 + A3 bonus, CHAMPION 49, post-game 70)', () => {
  assert.equal(LEVEL_CAP_ASC, 5);
  for (const a of [0, 1, 2, 3, 4]) assert.ok(capsOf(capRun(a, { world: 'kanto' })).every(c => c === null), 'A' + a);
  assert.deepEqual(capsOf(capRun(5, { world: 'kanto' })), [15 + 1, 27 + 2, 41 + 2, 49 + 2, 70 + 2].map(x => x + off));
  // A10: +1 more level from Act 2 on (bosses and the ELITE FOUR / CHAMPION)
  assert.deepEqual(capsOf(capRun(10, { world: 'kanto' })), [15 + 1, 27 + 3, 41 + 3, 49 + 3, 70 + 3].map(x => x + off));
});

t('cap: per region: spire acts follow the tier levels whatever the region; the legacy HOENN world uses its own', () => {
  const sp = capRun(5, { world: 'spire', regions: { acts: ['hoenn', 'johto', 'kanto', 'hoenn'], summit: 'hoenn', post: 'johto' } });
  assert.deepEqual(sp.regions.acts, ['hoenn', 'johto', 'kanto', 'hoenn']);
  assert.deepEqual(capsOf(sp), [15 + 1, 27 + 2, 41 + 2, 49 + 2, 70 + 2].map(x => x + off));
  const ho = capRun(5, { world: 'hoenn' });
  assert.deepEqual(capsOf(ho), [16 + 1, 28 + 2, 39 + 2, 50 + 2, 70 + 2].map(x => x + off));
  const jo = capRun(5, { world: 'spire', regions: { acts: ['johto', 'johto', 'johto', 'johto'], summit: 'johto', post: 'johto' } });
  assert.deepEqual(capsOf(jo), [15 + 1, 27 + 2, 41 + 2, 49 + 2, 70 + 2].map(x => x + off));
});

function cappedParty(levels, asc = 5) {
  const run = capRun(asc, { world: 'kanto' });
  run.actIndex = 0;
  run.party.length = 0;
  for (const L of levels) { const m = makeMon('RATTATA', L, { rng: run.rng }); m.exp = expForLevel(D.species.RATTATA.growthRate, L); run.party.push(m); }
  return run;
}
const res = (run, exp, lvl, parts) => ({ outcome: 'win', exp, foes: [{ level: lvl, exp }], participants: parts.map(m => m.uid), fainted: run.party.filter(isFainted).map(m => m.uid) });

t('cap: a POKéMON at the cap gets no battle EXP; one below stops exactly at the cap', () => {
  const run = cappedParty([18, 17]);
  const cap = run.levelCap();
  assert.equal(cap, 16 + off);
  const [a, b] = run.party;
  const out = run.distributeExp(res(run, 5000, 15, [a, b]), 'trainer');
  const ra = out.find(r => r.mon === a), rb = out.find(r => r.mon === b);
  assert.equal(a.level, cap); assert.equal(ra.gained, 0); assert.ok(ra.capped);
  assert.equal(b.level, cap); assert.equal(b.exp, expForLevel(D.species.RATTATA.growthRate, cap)); assert.ok(rb.capped);
  // below A5 the same battle levels them past it
  const run4 = cappedParty([18, 17], 4);
  run4.distributeExp(res(run4, 5000, 15, run4.party), 'trainer');
  assert.ok(run4.party.every(m => m.level > cap));
});

t('cap: the EXP past the cap is lost (teammates only get their own share)', () => {
  const run = cappedParty([18, 12, 9]);
  const [top, mid, low] = run.party;
  const before = run.party.map(m => m.exp);
  const out = run.distributeExp(res(run, 300, 15, [top]), 'trainer');
  const rt = out.find(x => x.mon === top), rl = out.find(x => x.mon === low);
  assert.ok(rt.capped && rt.gained === 0);
  assert.equal(top.exp, before[0], 'the capped POKéMON gets nothing');
  assert.equal(rl.gained, Math.max(1, Math.floor(300 * TUNING.expMult * 0.9 * 0.5 * expLevelScale(15, 9))), 'no overflow on top of its own bench share');
  assert.ok(!('passed' in rt) && !('extra' in rl));
});

t('cap: RARE CANDY still goes past the cap', () => {
  const run = cappedParty([18]);
  const m = run.party[0];
  run.addConsumable('RARE_CANDY');
  assert.ok(run.applyConsumableToMon('RARE_CANDY', m));
  assert.equal(m.level, 18 + CONSUMABLES.RARE_CANDY.levels);
  // and a POKéMON above the cap earns no battle EXP
  const out = run.distributeExp(res(run, 500, 15, [m]), 'trainer');
  assert.equal(out[0].gained, 0); assert.equal(m.level, 18 + CONSUMABLES.RARE_CANDY.levels);
});

t('A5: WEARY is gone (normal post-battle heal, full POKéMON CENTER and act-clear heals); the text is LEVEL CAP', () => {
  assert.equal(ASCENSIONS[5].name, 'Level Cap');
  assert.ok(!/heal/i.test(ASCENSIONS[5].desc));
  for (const asc of [0, 5, 10]) {
    const run = cappedParty([20, 20], asc);
    const [a, b] = run.party;
    a.hp = Math.floor(maxHp(a) / 2); b.hp = 0;
    run.centerHeal();
    assert.equal(a.hp, maxHp(a), 'center: full HP at A' + asc);
    assert.equal(b.hp, Math.max(1, Math.floor(maxHp(b) * 0.5)), 'center: fainted back at 50% at A' + asc);
    a.hp = 10; b.hp = 0;
    run.nextActHeal();
    assert.equal(a.hp, maxHp(a)); assert.equal(b.hp, maxHp(b));
    a.hp = 10;
    const hp0 = a.hp;
    run.afterBattle({ kind: 'wild', enemies: [], cfg: {}, result: { outcome: 'win', exp: 0, money: 0, participants: [] } });
    assert.equal(a.hp, Math.min(maxHp(a), hp0 + Math.floor(maxHp(a) * TUNING.postBattleHeal)), 'post-battle heal at A' + asc);
  }
});

t('A5+: a win still unlocks the starter\'s shiny (A4 doesn\'t)', () => {
  const meta = { shinies: [] };
  assert.equal(unlockShiny(Run.create({ seed: 'S', starter: 'BULBASAUR', ascension: 4 }), meta), null);
  assert.equal(unlockShiny(Run.create({ seed: 'S', starter: 'BULBASAUR', ascension: 5 }), meta), 'BULBASAUR');
});

t('co-op A5: the room\'s ascension caps each player\'s own team (EXP past the cap is lost)', () => {
  const g = CoopGame.fromInit({ ...INIT('XCAP'), ascension: 5 });
  const caps = g.runs.map(r => r.levelCap());
  assert.ok(caps.every(c => c === 16 + TUNING.levelCapOffset), JSON.stringify(caps));
  const r0 = g.privateRunClone(0), r1 = g.privateRunClone(1);
  const top = r0.party[0];
  top.level = caps[0]; top.exp = expForLevel(D.species[top.species].growthRate, top.level);
  const low = makeMon('RATTATA', 5, { rng: r0.rng }); r0.party.push(low);
  const out = r0.distributeExp({ outcome: 'win', exp: 200, foes: [{ level: 10, exp: 200 }], participants: [top.uid], fainted: [] }, 'wild');
  assert.ok(out.find(x => x.mon === top).capped && out.find(x => x.mon === top).gained === 0);
  assert.ok(r1.party.every(m => !out.some(x => x.mon === m)), 'the partner\'s team is untouched');
  const g0 = CoopGame.fromInit(INIT('XCAP'));
  assert.ok(g0.runs.every(r => r.levelCap() === null), 'A0 room: no cap');
});

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
