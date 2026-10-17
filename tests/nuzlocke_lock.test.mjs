// NUZLOCKE is always on from A8 (no way to switch it off), solo and co-op; below A8 it is co-op's optional switch.
// node tests/nuzlocke_lock.test.mjs   (the live server side: tests/coop_nuzlocke.test.cjs)
import fs from 'fs';
import assert from 'assert/strict';
import { loadData } from '../web/src/game/data.js';
import { Run, NUZLOCKE_ASC, nuzLocked, nuzSwitchTip } from '../web/src/game/run.js';
import { CoopGame } from '../web/src/game/coop/coop.js';

await loadData(async f => JSON.parse(fs.readFileSync('web/assets/data/' + f, 'utf8')));
let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log('PASS', name); } catch (e) { fail++; console.log('FAIL', name, '-', e.stack.split('\n').slice(0, 3).join(' | ')); } };

t('NUZLOCKE_ASC is 8 and nuzLocked follows it', () => {
  assert.equal(NUZLOCKE_ASC, 8);
  for (let a = 0; a <= 10; a++) assert.equal(nuzLocked(a), a >= 8, 'A' + a);
});

// ---- solo ----
t('solo: on exactly from A8, off below', () => {
  for (let a = 0; a <= 10; a++) assert.equal(Run.create({ starter: 'BULBASAUR', ascension: a, seed: 'S' + a }).nuzlocke, a >= 8, 'A' + a);
});
t('solo: an A8+ run cannot be switched off (create option, coopNuzlocke, assignment)', () => {
  for (const a of [8, 9, 10]) {
    const r = Run.create({ starter: 'CHARMANDER', ascension: a, seed: 'X' + a, nuzlocke: false });
    assert.equal(r.nuzlocke, true);
    r.coopNuzlocke = false;
    try { r.nuzlocke = false; } catch {} // getter only
    assert.equal(r.nuzlocke, true, 'A' + a);
  }
});
t('solo: below A8 a nuzlocke/coopNuzlocke flag does not turn it on in solo', () => {
  const r = Run.create({ starter: 'SQUIRTLE', ascension: 7, seed: 'B7', nuzlocke: true });
  r.coopNuzlocke = true;
  assert.equal(r.nuzlocke, false);
});
t('solo: an A8 save stays NUZLOCKE after a save/load round trip', () => {
  const r = Run.create({ starter: 'BULBASAUR', ascension: 8, seed: 'RT' });
  const back = Run.fromJSON(JSON.parse(JSON.stringify(r)));
  assert.equal(back.nuzlocke, true);
});

// ---- co-op client ----
const INIT = (ascension, nuz) => ({ seq: 1, type: 'init', seed: 'NZ' + ascension, ascension, world: 'kanto', starters: ['BULBASAUR', 'CHARMANDER'], names: ['A', 'B'], ...(nuz ? { nuzlocke: true } : {}) });
t('co-op: an init with nuzlocke (what the server writes at A8+) makes every run NUZLOCKE', () => {
  for (const a of [8, 10]) {
    const g = CoopGame.fromInit(INIT(a, true));
    assert.equal(g.nuzlocke, true);
    assert.ok(g.runs.every(r => r.nuzlocke), 'A' + a);
  }
});
t('co-op: below A8 the switch is optional (on and off rooms both work)', () => {
  assert.equal(CoopGame.fromInit(INIT(3, false)).runs.some(r => r.nuzlocke), false);
  assert.ok(CoopGame.fromInit(INIT(3, true)).runs.every(r => r.nuzlocke));
});
t('co-op: lobby tooltip text', () => {
  assert.equal(nuzSwitchTip(true), 'Always on from A8. Below A8, click to switch it.');
  assert.equal(nuzSwitchTip(false), 'Always on from A8. Below A8, the host picks it.');
  const lobby = fs.readFileSync('web/src/scenes/coop/lobby.js', 'utf8');
  assert.ok(!/you can still switch it off/.test(lobby), 'old tooltip gone');
  // the host's button is disabled at A8+ and its click is ignored
  assert.match(lobby, /disabled: this\.busy \|\| locked \}\) && !locked\) this\.config\(\{ nuzlocke: !on \}\)/);
  assert.match(lobby, /const locked = nuzLocked\(a\), on = locked \|\| !!room\.nuzlocke/);
});

// ---- co-op server (convex/coop.ts): same threshold, forced in create, configure and start ----
t('co-op server: coop.ts forces NUZLOCKE at A8+ in create / configure / start', () => {
  const src = fs.readFileSync('convex/coop.ts', 'utf8');
  const m = /const NUZLOCKE_ASC = (\d+);/.exec(src);
  assert.ok(m, 'coop.ts NUZLOCKE_ASC');
  assert.equal(+m[1], NUZLOCKE_ASC, 'same threshold as run.js');
  const body = (name) => { const i = src.indexOf(`export const ${name} = mutation(`); assert.ok(i >= 0, name); return src.slice(i, src.indexOf('\n});', i)); };
  assert.match(body('create'), /nuzFor\(asc, nuzlocke\)/);
  assert.match(body('configure'), /\(patch\.ascension \?\? room\.ascension\) >= NUZLOCKE_ASC\) patch\.nuzlocke = true/);
  assert.match(body('start'), /nuzFor\(room\.ascension, room\.nuzlocke\)/);
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
