// Semi-invulnerable turn (DIVE / DIG / FLY / BOUNCE): the foe's moves miss, status moves included, except the
// Gen 3 moves that reach a POKéMON out of reach. Run: node tests/v032_invuln.test.mjs
import fs from 'fs';
import assert from 'assert/strict';
import { loadData, D } from '../web/src/game/data.js';
import { Run } from '../web/src/game/run.js';
import { Battle, invulnHit } from '../web/src/game/battle.js';
import { maxHp } from '../web/src/game/pokemon.js';
import { duoConfig } from '../web/src/game/coop/coop.js';
import { DuoBattle } from '../web/src/game/coop/duo.js';

await loadData(async f => JSON.parse(fs.readFileSync('web/assets/data/' + f, 'utf8')));
let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.log('FAIL', name, '-', e.stack); } };
const msgs = (evs) => evs.filter(e => e.t === 'msg').map(e => e.text).join(' | ');

// One solo turn: the lead plays `card` (alone), then a slow foe that never misses on its own uses `foeMove`.
const soloTurn = (card, foeMove, setup) => {
  const run = Run.create({ starter: 'CHARMANDER', seed: 'inv' });
  const b = new Battle(run, run.battleConfig({ id: 'w', floor: 3, type: 'wild' }));
  b.start();
  const lead = b.lead(), e = b.enemy();
  lead.hp = maxHp(lead); lead.status = null;
  e.maxHp = e.hp = 99999; e.status = null; e.ability = null; e.moves = [foeMove]; e.types = ['NORMAL'];
  e.stats.spe = 1; e.stats.atk = e.stats.spa = 1; // acts after us; chip damage only
  b.sides.player.lockOn = 2; // our card always hits
  b.sides.enemy.lockOn = 3;  // the foe's move would always hit (LOCK-ON doesn't beat the semi-invulnerable turn)
  b.intent = { move: b.moveData(foeMove) };
  b.deck.hand.push({ id: 9101, uid: lead.uid, move: card });
  if (setup) setup(b, lead, e);
  const hp0 = lead.hp;
  const evs = b.play([9101]);
  const text = msgs(evs);
  if (['DIVE', 'DIG', 'FLY', 'BOUNCE'].includes(card)) assert.match(text, /is out of reach!/, 'setup: the lead went out of reach');
  return { b, lead, e, hp0, evs, text };
};

t('helper: which moves reach a semi-invulnerable POKéMON', () => {
  const m = k => ({ ...D.moves[k], key: k });
  assert.equal(invulnHit(null, m('TOXIC')), 1, 'no dodge -> hits');
  assert.equal(invulnHit('DIVE', m('TOXIC')), 0);
  assert.equal(invulnHit('DIVE', m('POISON_POWDER')), 0);
  assert.equal(invulnHit('DIVE', m('GROWL')), 0, 'spread status moves miss too');
  assert.equal(invulnHit('DIVE', m('SURF')), 2);
  assert.equal(invulnHit('DIVE', m('WHIRLPOOL')), 2);
  assert.equal(invulnHit('DIVE', m('EARTHQUAKE')), 0);
  assert.equal(invulnHit('DIG', m('EARTHQUAKE')), 2);
  assert.equal(invulnHit('DIG', m('MAGNITUDE')), 2);
  assert.equal(invulnHit('DIG', m('FISSURE')), 1);
  assert.equal(invulnHit('DIG', m('SURF')), 0);
  for (const k of ['FLY', 'BOUNCE']) {
    assert.equal(invulnHit(k, m('GUST')), 2); assert.equal(invulnHit(k, m('TWISTER')), 2);
    assert.equal(invulnHit(k, m('THUNDER')), 1); assert.equal(invulnHit(k, m('SKY_UPPERCUT')), 1);
    assert.equal(invulnHit(k, m('EARTHQUAKE')), 0); assert.equal(invulnHit(k, m('TACKLE')), 0);
  }
  assert.equal(invulnHit('DIVE', m('SWORDS_DANCE')), 1, 'self moves still work');
  assert.equal(invulnHit('DIVE', m('SPIKES')), 1, 'field moves still work');
});

t('solo: control, without DIVE the foe TOXIC lands', () => {
  const r = soloTurn('TACKLE', 'TOXIC');
  assert.equal(r.lead.status, 'TOX', r.text);
});

t('solo: a foe status move misses a DIVE user (TOXIC, POISON POWDER, THUNDER WAVE, GROWL, LEECH SEED)', () => {
  for (const foeMove of ['TOXIC', 'POISON_POWDER', 'THUNDER_WAVE', 'SPORE', 'CONFUSE_RAY', 'GROWL', 'LEECH_SEED']) {
    const r = soloTurn('DIVE', foeMove);
    assert.equal(r.lead.status, null, `${foeMove}: ${r.text}`);
    assert.ok(!r.b.sides.player.confused, `${foeMove} confused`);
    assert.ok(!r.b.sides.player.seeded, `${foeMove} seeded`);
    assert.equal(r.b.sides.player.stages.atk, 0, `${foeMove} stat drop`);
    assert.match(r.text, /avoided the attack/, foeMove);
  }
});

t('solo: a foe attack and its side effect miss a DIVE user (POISON STING, TACKLE)', () => {
  for (const foeMove of ['POISON_STING', 'TACKLE', 'EARTHQUAKE']) {
    const r = soloTurn('DIVE', foeMove);
    assert.equal(r.lead.hp, r.hp0, `${foeMove}: ${r.text}`);
    assert.equal(r.lead.status, null, foeMove);
    assert.match(r.text, /avoided the attack/, foeMove);
  }
});

t('solo: SURF hits a DIVE user', () => {
  const r = soloTurn('DIVE', 'SURF');
  assert.ok(r.lead.hp < r.hp0, r.text);
  assert.doesNotMatch(r.text, /avoided/);
});

t('solo: EARTHQUAKE hits a DIG user, but not a FLY user', () => {
  const dig = soloTurn('DIG', 'EARTHQUAKE');
  assert.ok(dig.lead.hp < dig.hp0, dig.text);
  const fly = soloTurn('FLY', 'EARTHQUAKE');
  assert.equal(fly.lead.hp, fly.hp0, fly.text);
  const gust = soloTurn('FLY', 'GUST');
  assert.ok(gust.lead.hp < gust.hp0, gust.text);
});

t('solo: poison the lead already had still ticks while it is underwater', () => {
  const r = soloTurn('DIVE', 'TACKLE', (b, lead) => { lead.status = 'PSN'; });
  assert.equal(r.lead.status, 'PSN');
  assert.match(r.text, /avoided the attack/);
  assert.ok(r.lead.hp < r.hp0, 'poison ticked at the end of the turn: ' + r.text);
});

t('solo: the dodge is over next turn', () => {
  const r = soloTurn('DIVE', 'TOXIC');
  assert.equal(r.b.sides.player.dodge, false);
});

// ---- co-op duo --------------------------------------------------------------------------------------
t('co-op: a partner in DIVE is not poisoned; the other partner is', () => {
  const world = Run.create({ starter: 'SQUIRTLE', seed: 'INVC' });
  const cfg = duoConfig(world, { id: 'inv', floor: 3, type: 'wild' });
  const runs = [Run.create({ starter: 'CHARMANDER', seed: 'INVa' }), Run.create({ starter: 'SQUIRTLE', seed: 'INVb' })];
  for (const r of runs) for (const m of r.party) { m.level = 30; m.hp = maxHp(m); m.status = null; }
  const d = new DuoBattle(runs, cfg);
  d.start();
  for (const ri of d.liveField()) {
    const e = d.enemies[ri];
    e.maxHp = e.hp = 99999; e.status = null; e.ability = null; e.stats.spe = 1;
    d.enemySides[ri].lockOn = 3;
  }
  const s0 = d.subs[0], s1 = d.subs[1];
  const lead1 = s1.lead(), lead0 = s0.lead();
  // every foe action this turn: TOXIC, the first one at the diver (p1), the next at p0
  const acts = d.intents.map((it, i) => [it, i]).filter(([it]) => it);
  assert.ok(acts.length >= 1);
  acts.forEach(([it], k) => { it.move = s1.moveData('TOXIC'); it.target = k === 0 ? 1 : 0; });
  s1.sides.player.lockOn = 2;
  s1.deck.hand.push({ id: 9201, uid: lead1.uid, move: 'DIVE' });
  const slot = d.field[0] !== null ? 0 : 1;
  d.lock(0, { pass: true });
  const text = msgs(d.lock(1, { ids: [9201], target: slot }));
  assert.match(text, /is out of reach!/, 'setup: the diver went out of reach');
  assert.match(text, /avoided the attack/, text);
  assert.ok(d.turn >= 2, 'the turn resolved');
  assert.equal(lead1.status, null, 'the diver was poisoned');
  if (acts.length >= 2) assert.equal(lead0.status, 'TOX', 'control: the partner on land was poisoned');
});

console.log(`${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
