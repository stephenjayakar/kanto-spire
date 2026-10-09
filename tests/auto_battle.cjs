// AUTO battle checks in a real (muted, offline) browser:
//   solo  an early wild battle: U turns AUTO on (FAST speed), it plays the HINT hand every turn with no other input
//         and wins; a beefed-up foe shows it plays turn after turn; Esc stops it; a low lead stops it by itself;
//         HINT's dry runs (bestHand) leave the battle RNG untouched
//   coop  P2's seat on an in-memory 2-player net (P1 driven here): AUTO posts exactly one plain 'lock' per turn (no
//         discards / switches / items / balls), UNLOCK stops it, the log and checksum stay those of normal play
// Screenshots (off / on, solo and co-op) go to tests/out/auto_*.png.
//   node tests/auto_battle.cjs [port] [--solo-only|--coop-only]
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'tests/out');
const PORT = +(process.argv.slice(2).find(a => /^\d+$/.test(a)) || 8700 + Math.floor(Math.random() * 250)), SLOT = 1;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let fails = 0;
const check = (label, ok, extra = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${extra ? ' ' + extra : ''}`); if (!ok) fails++; return ok; };
fs.mkdirSync(OUT, { recursive: true });

async function openPage(browser, errors) {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/cloud.json', r => r.fulfill({ status: 404, body: '' }));
  await page.goto(`http://localhost:${PORT}/`);
  await page.evaluate(() => localStorage.clear()); await page.reload();
  await page.waitForFunction(() => window.__ready && window.G?.meta && window.__engine?.Engine.scene, null, { timeout: 120000 });
  return page;
}
const shot = async (page, name) => { await (await page.$('canvas')).screenshot({ path: path.join(OUT, name) }); };
const idle = () => { const s = window.__engine.Engine.scene; return !!(s?.b && !s.busy && s.b.deck?.hand?.length && !s.msg?.active); };

// A fresh solo run at its first battle (CHARMANDER Lv6 + a bench PIDGEY).
async function soloBattle(page, seed) {
  await page.evaluate(async (seed) => {
    G.meta.seenVersion = (await import('/src/game/version.js')).PATCH_NOTES[0].v;
    Object.assign(G.meta, { tutorialDone: true, tipCatch: true, hintBattles: 9 });
    G.meta.settings.fast = false;
    const { Run } = await import('/src/game/run.js'); const { makeMon } = await import('/src/game/pokemon.js');
    G.run = Run.create({ starter: 'CHARMANDER', ascension: 0, seed });
    G.run.party.push(makeMon('PIDGEY', 6, { rng: G.run.rng }));
    window.__flow.enterNode(G.run.map.start[0]);
  }, seed);
  await page.waitForFunction(idle, null, { timeout: 60000 });
}

async function solo(browser) {
  console.log('\n=== solo ===');
  const errors = [];
  const page = await openPage(browser, errors);
  await soloBattle(page, 'AUTO1');
  await sleep(400);
  await shot(page, 'auto_solo_off.png');
  // the tooltip (hover the button: canvas x 429, y 243)
  const box = await (await page.$('canvas')).boundingBox();
  await page.mouse.move(box.x + 429 * box.width / 640, box.y + 243 * box.height / 360);
  await sleep(250);
  await shot(page, 'auto_solo_tip.png');
  await page.mouse.move(box.x + 5, box.y + 5);
  // HINT's dry runs must not touch the battle RNG (nor the run's)
  const rng = await page.evaluate(() => {
    const sc = window.__engine.Engine.scene, b = sc.b;
    const before = [b.rng.state, G.run.rng.state, b.enemy().hp, b.lead().hp, b.deck.draw.length, b.events.length];
    sc._hintKey = null; sc.bestHand(); sc._hintKey = null; sc.bestHand();
    return { before, after: [b.rng.state, G.run.rng.state, b.enemy().hp, b.lead().hp, b.deck.draw.length, b.events.length] };
  });
  check('bestHand() dry runs leave RNG and battle state untouched', JSON.stringify(rng.before) === JSON.stringify(rng.after), JSON.stringify(rng));

  // U turns AUTO on; from here on, no input at all
  await page.keyboard.press('u');
  await sleep(120);
  const on = await page.evaluate(() => { const sc = window.__engine.Engine.scene; return { auto: sc.auto, fast: sc.fast }; });
  check('U turns AUTO on, at FAST speed', on.auto === true && on.fast === true, JSON.stringify(on));
  await page.waitForFunction(() => window.__engine.Engine.scene.sel?.length > 0, null, { timeout: 5000 }).catch(() => {});
  await shot(page, 'auto_solo_on.png');
  const t0 = Date.now();
  const res = await page.waitForFunction(() => { const sc = window.__engine.Engine.scene; return !sc?.b || sc.b.result ? { scene: sc?.constructor?.name, result: sc?.b?.result?.outcome, hands: sc?.b?.handsPlayed } : null; }, null, { timeout: 90000, polling: 100 }).then(h => h.jsonValue()).catch(() => null);
  check('AUTO wins the early battle with no input', res?.result === 'win', `${JSON.stringify(res)} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  // several turns: a beefy foe (display/test only), AUTO keeps playing turn after turn
  await soloBattle(page, 'AUTO2');
  await page.evaluate(() => { const b = window.__engine.Engine.scene.b, e = b.enemy(); e.maxHp = e.hp = 2000; window.__engine.Engine.scene.enemyDisp.hp = window.__engine.Engine.scene.enemyDisp.maxHp = 2000; for (const m of G.run.party) m.hp = 999; });
  await page.keyboard.press('u');
  // (screenshots: a hand resolving under AUTO, then the AUTO ON line between hands)
  await page.waitForFunction(() => window.__engine.Engine.scene.playedIds.length >= 2, null, { timeout: 20000, polling: 50 }).catch(() => {});
  await shot(page, 'auto_solo_playing.png');
  await page.waitForFunction(() => { const sc = window.__engine.Engine.scene; return sc.auto && !sc.playedIds.length && !sc.sel.length && sc.b.handsPlayed >= 1; }, null, { timeout: 20000, polling: 50 }).catch(() => {});
  await shot(page, 'auto_solo_online.png');
  await page.waitForFunction(() => { const sc = window.__engine.Engine.scene; return sc.b.turn >= 4 || !sc.auto; }, null, { timeout: 90000, polling: 100 }).catch(() => {});
  const many = await page.evaluate(() => { const sc = window.__engine.Engine.scene; return { turn: sc.b.turn, hands: sc.b.handsPlayed, auto: sc.auto, toast: sc.toast?.text, disc: sc.b.discardsLeft }; });
  check('AUTO plays turn after turn by itself (3+ hands)', many.turn >= 4 && many.hands >= 3 && many.auto, JSON.stringify(many));
  check('AUTO never discards', many.disc === 2, `discards left ${many.disc}`);
  // Esc stops it (and hands back the normal speed setting)
  await page.keyboard.press('Escape');
  await sleep(150);
  const esc = await page.evaluate(() => { const sc = window.__engine.Engine.scene; return { auto: sc.auto, fast: sc.fast }; });
  check('Esc stops AUTO and restores the speed setting', esc.auto === false && esc.fast === false, JSON.stringify(esc));
  await page.waitForFunction(idle, null, { timeout: 30000 });
  const h0 = await page.evaluate(() => window.__engine.Engine.scene.b.handsPlayed);
  await sleep(1500);
  check('with AUTO off nothing is played', await page.evaluate(() => window.__engine.Engine.scene.b.handsPlayed) === h0);
  // a low lead stops AUTO by itself
  await page.evaluate(() => { const l = window.__engine.Engine.scene.b.lead(); l.hp = 999; });
  await page.keyboard.press('u');
  await page.waitForFunction(() => window.__engine.Engine.scene.busy, null, { timeout: 10000 }).catch(() => {});
  await page.evaluate(async () => { const { maxHp } = await import('/src/game/pokemon.js'); const l = window.__engine.Engine.scene.b.lead(); l.hp = Math.max(1, Math.floor(maxHp(l) * 0.2)); });
  await page.waitForFunction(() => !window.__engine.Engine.scene.auto, null, { timeout: 30000 }).catch(() => {});
  const low = await page.evaluate(() => { const sc = window.__engine.Engine.scene; return { auto: sc.auto, toast: sc.toast?.text }; });
  check('AUTO stops by itself when the lead drops below 25% HP', low.auto === false && /low on HP/.test(low.toast || ''), JSON.stringify(low));
  // a menu (overlay) stops it
  await page.evaluate(() => { const l = window.__engine.Engine.scene.b.lead(); l.hp = 999; });
  await page.waitForFunction(idle, null, { timeout: 30000 });
  await page.keyboard.press('u');
  await page.evaluate(() => window.__engine.Engine.scene.showDeck());
  await sleep(200);
  const ov = await page.evaluate(() => { const sc = window.__engine.Engine.scene; return { auto: sc.auto, toast: sc.toast?.text }; });
  check('an overlay stops AUTO', ov.auto === false && /menu/.test(ov.toast || ''), JSON.stringify(ov));
  check('solo: no page errors', !errors.length, errors.slice(0, 3).join(' | '));
  await page.context().close();
}

// ---- co-op: P2's seat (this page) on an in-memory log; P1 is driven here ----------------------------------------
const coopSrc = fs.readFileSync(path.join(ROOT, 'tests/coop_hand_ui.cjs'), 'utf8');
const START = eval('(' + coopSrc.match(/const START = (async \(\{ SLOT \}\) => \{[\s\S]*?\n\});/)[1] + ')');

async function coop(browser) {
  console.log('\n=== co-op (mock net, P2 seat) ===');
  const errors = [];
  const page = await openPage(browser, errors);
  await page.evaluate(START, { SLOT });
  await page.waitForFunction(() => window.__coop?.synced && window.__engine.Engine.scene?.constructor?.name === 'CoopMapScene', null, { timeout: 60000 });
  await page.evaluate(() => { window.__engine.Engine.timeScale = 1; G.meta.settings.fast = false; });
  const node = await page.evaluate(() => window.__coop.game.reachable()[0]);
  await page.evaluate(({ node, SLOT }) => { window.__hand.push({ type: 'vote', node, nonce: 'v0' }, 1 - SLOT); window.__coop.vote(node); }, { node, SLOT });
  await page.waitForFunction(() => window.__engine.Engine.scene?.constructor?.name === 'CoopBattleScene', null, { timeout: 30000 });
  await page.waitForFunction(() => window.__engine.Engine.scene.canAct(), null, { timeout: 60000 });
  // record every action this seat posts, with the turn it was posted on
  await page.evaluate(() => {
    const s = window.__coop, post = s.post.bind(s);
    window.__posts = [];
    s.post = (a) => { window.__posts.push({ type: a.type, turn: s.game.battle?.turn, ids: a.ids?.length || 0, pass: !!a.pass, ball: a.ball || null, target: a.target }); return post(a); };
    // the in-memory battle is tiny: give the foes HP so it runs a few turns
    const d = s.game.battle; for (const e of d.enemies) { e.maxHp *= 6; e.hp = e.maxHp; }
    for (const r of s.game.runs) for (const m of r.party) m.hp = 999;
    s.game.mirror?.(); s.ck?.set(s.lastSeq, s.game.checksum() >>> 0);
    window.__engine.Engine.scene.reconcile();
  });
  await sleep(300);
  // a dry-run hint must not change the shared state (checksum)
  const ck = await page.evaluate(() => { const s = window.__coop, sc = window.__engine.Engine.scene; const a = s.game.checksum(); sc._hint = {}; sc.bestHand(); sc.defaultTarget(); return [a, s.game.checksum()]; });
  check('co-op: bestHand() leaves the checksum unchanged', ck[0] === ck[1], JSON.stringify(ck));
  await shot(page, 'auto_coop_off.png');
  await page.keyboard.press('u');
  await page.waitForFunction(() => window.__engine.Engine.scene.sel?.length > 0, null, { timeout: 5000 }).catch(() => {});
  await shot(page, 'auto_coop_on.png');
  // P2 (AUTO) locks first; UNLOCK hands control back
  await page.waitForFunction(() => { const d = window.__coop.game.battle; return !!d.locks[1]; }, null, { timeout: 10000 }).catch(() => {});
  await shot(page, 'auto_coop_locked.png');
  await page.evaluate(() => window.__engine.Engine.scene.doUnlock());
  await page.waitForFunction(() => !window.__engine.Engine.scene.auto, null, { timeout: 5000 }).catch(() => {});
  const un = await page.evaluate(() => ({ auto: window.__engine.Engine.scene.auto, lock: !!window.__coop.game.battle.locks[1] }));
  check('co-op: UNLOCK stops AUTO (and the lock is taken back)', un.auto === false && un.lock === false, JSON.stringify(un));
  await sleep(1200);
  check('co-op: AUTO does not lock again after UNLOCK', !(await page.evaluate(() => !!window.__coop.game.battle.locks[1])));
  // on again; P1 locks only once P2 has: AUTO must lock exactly once per turn until the battle ends
  await page.keyboard.press('u');
  const t0 = Date.now();
  let end = null;
  while (Date.now() - t0 < 4 * 60 * 1000) {
    end = await page.evaluate(() => {
      const s = window.__coop, g = s.game, d = g.battle, sc = window.__engine.Engine.scene;
      if (g.phase !== 'battle' || !d || d.result) return { phase: g.phase, result: d?.result?.outcome };
      if (d.locks[1] && !d.locks[0] && !d.down[0]) {
        const so = d.subs[0], c = so.deck.hand.find(c => so.cardInfo(c).playable);
        try { window.__hand.push(c ? { type: 'lock', ids: [c.id], target: 0, nonce: 'o' + Math.random() } : { type: 'lock', pass: true, nonce: 'o' + Math.random() }, 0); } catch {}
      }
      if (sc?.msg?.cur && !sc.auto) sc.msg.cur.auto = 0.01;
      return sc?.auto === false && !d.result ? { stopped: true, toast: sc.toast?.text, turn: d.turn } : null;
    });
    if (end) break;
    await sleep(150);
  }
  const posts = await page.evaluate(() => window.__posts);
  const locks = posts.filter(p => p.type === 'lock');
  const perTurn = {}; for (const p of locks) perTurn[p.turn] = (perTurn[p.turn] || 0) + 1;
  console.log('  end:', JSON.stringify(end), 'posts:', JSON.stringify(posts));
  check('co-op: AUTO ran the battle to its end (or stopped with a reason)', !!end && (end.result === 'win' || end.phase !== 'battle' || (end.stopped && !!end.toast)), JSON.stringify(end));
  check('co-op: AUTO played several turns', Object.keys(perTurn).length >= 2, JSON.stringify(perTurn));
  check('co-op: only plain hand locks (no discard / switch / item / ball / pass)', posts.every(p => (p.type === 'lock' && p.ids > 0 && !p.pass && !p.ball) || p.type === 'unlock'), JSON.stringify(posts.filter(p => p.type !== 'lock' && p.type !== 'unlock')));
  // one lock per turn (the first turn also has the lock that was UNLOCKed before AUTO was turned back on)
  const first = locks[0]?.turn;
  check('co-op: one lock per turn', Object.entries(perTurn).every(([t, n]) => n === 1 || (+t === first && n === 2 && posts[1]?.type === 'unlock')), JSON.stringify(perTurn));
  check('co-op: no desync', !(await page.evaluate(() => window.__coop.desync)));
  check('co-op: no page errors', !errors.length, errors.slice(0, 3).join(' | '));
  await page.context().close();
}

(async () => {
  const server = spawn(process.execPath, [path.join(ROOT, 'serve.cjs'), String(PORT)], { cwd: ROOT, stdio: 'ignore' });
  await sleep(700);
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
  try {
    if (!process.argv.includes('--coop-only')) await solo(browser).catch(e => check('solo crashed', false, e.stack));
    if (!process.argv.includes('--solo-only')) await coop(browser).catch(e => check('co-op crashed', false, e.stack));
  } finally { await browser.close().catch(() => {}); server.kill(); }
  console.log(fails ? `\n${fails} FAILED` : '\nall checks passed');
  process.exit(fails ? 1 : 0);
})();
