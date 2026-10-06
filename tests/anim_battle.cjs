// FireRed move animations in a real battle (muted Chrome, offline build). Two turns: player-first, then foe-first.
// Checks the hand animation choice (highest card DMG), that each animation plays when its own move resolves
// (foe-first: foe animation + damage, then our cards, count-up, our animation, damage), and screenshots mid-animation
// (the played cards sit below the scene).
//   node tests/anim_battle.cjs [port=8733] [outdir=tests/out/anim_battle] [fast=0]
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const port = +(process.argv[2] || 8733), out = process.argv[3] || 'tests/out/anim_battle', fast = process.argv[4] === '1';
const root = path.resolve(__dirname, '..');
fs.mkdirSync(out, { recursive: true });

(async () => {
  const server = spawn(process.execPath, [path.join(root, 'serve.cjs'), String(port)], { cwd: root, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 700));
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio'] });
  const fails = [];
  const check = (label, ok, extra = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`); if (!ok) fails.push(label); };
  try {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    await page.route('**/cloud.json', r => r.fulfill({ status: 404, body: '' }));
    await page.goto(`http://localhost:${port}/`); await page.evaluate(() => localStorage.clear()); await page.reload();
    await page.waitForFunction(() => window.__ready && window.G?.meta, null, { timeout: 60000 });
    const ev = (fn, arg) => page.evaluate(fn, arg); // (log: 'enemyMove' is logged as its event starts, FOE_ANIM as the animation inside it begins)
    await ev(async (fast) => {
      G.meta.seenVersion = (await import('/src/game/version.js')).PATCH_NOTES[0].v; Object.assign(G.meta, { tutorialDone: true, tipCatch: true });
      G.meta.settings.fast = fast;
      const { Run } = await import('/src/game/run.js'); G.run = Run.create({ starter: 'CHARMANDER', ascension: 0, seed: 'ANIMS' });
      window.__flow.enterNode(G.run.map.start[0]);
    }, fast);
    const ready = () => page.waitForFunction(() => { const s = window.__engine.Engine.scene; return s?.b && !s.busy && s.b.deck?.hand?.length >= 4; }, null, { timeout: 60000 });
    await ready();
    // log events + animations in the order the scene shows them
    await ev(() => {
      const sc = window.__engine.Engine.scene;
      sc.animLog = [];
      const orig = sc.animate.bind(sc);
      sc.animate = async (e) => { if (sc.pendingAnim?.scored) sc.animLog.push('HAND_ANIM'); /* (the scene plays it at the top of this event, before the event itself) */ if (['play', 'card', 'total', 'damage', 'enemyMove', 'foeFirst'].includes(e.t)) sc.animLog.push(e.t === 'damage' ? 'damage:' + e.side : e.t); return orig(e); };
      const om = sc.playMoveAnim.bind(sc);
      sc.playMoveAnim = async (k, side, m) => { if (side) sc.animLog.push('FOE_ANIM'); return om(k, side, m); };
    });
    const playTurn = async (name, foeMove, foeFast, hand) => {
      const setup = await ev(([foeMove, foeFast, hand]) => {
        const sc = window.__engine.Engine.scene, b = sc.b;
        const e = b.enemy(); e.maxHp = e.hp = 9999; sc.enemyDisp.hp = sc.enemyDisp.maxHp = 9999;
        e.moves = [foeMove]; e.stats.spe = foeFast ? 999 : 1; b.intent = { move: b.moveData(foeMove) };
        const lead = b.lead(); lead.level = Math.max(lead.level, 30); lead.hp = 9999;
        b.deck.hand.slice(0, hand.length).forEach((c, i) => { c.move = hand[i]; c.uid = b.leadUid; c.faceDown = false; c.frozen = false; });
        const ids = b.deck.hand.slice(0, hand.length).map(c => c.id);
        sc.syncHand();
        const dmg = ids.map(id => { const i = b.cardInfo(b.findCardAny(id)); return [i.move.key, i.dmgPreview, i.status]; });
        sc.animLog.length = 0;
        sc.sel = ids.slice(); sc.doPlay();
        return { dmg, pick: sc.pendingAnim?.key };
      }, [foeMove, foeFast, hand]);
      let shots = 0;
      for (let i = 0; i < 200; i++) {
        await page.waitForTimeout(90);
        const st = await ev(() => { const s = window.__engine.Engine.scene; return { anim: s.animMove?.key || null, busy: s.busy }; });
        if (st.anim && shots < 3 && i % 3 === 0) { await page.screenshot({ path: path.join(out, `${name}_${shots++}_${st.anim.toLowerCase()}.png`) }); }
        if (!st.busy && i > 3) break;
      }
      const log = (await ev(() => window.__engine.Engine.scene.animLog.slice())).filter(x => !/^(hand|foe):/.test(x)).filter((x, i, a) => x !== a[i - 1]).join(' ');
      return { ...setup, log };
    };
    const a = await playTurn('player_first', 'TACKLE', false, ['GROWL', 'EMBER', 'FLAMETHROWER', 'SCRATCH']);
    console.log('player-first:', a.log);
    const best = a.dmg.filter(d => !d[2]).sort((x, y) => y[1] - x[1])[0][0];
    check(`hand animation = highest card DMG (${best})`, a.pick === best, a.pick);
    check('player-first order: cards, count-up, our animation, damage, then the foe', /^play card.*total HAND_ANIM damage:enemy enemyMove FOE_ANIM/.test(a.log));
    await ready();
    const b = await playTurn('foe_first', 'QUICK_ATTACK', true, ['EMBER', 'SCRATCH', 'TACKLE']);
    console.log('foe-first:', b.log);
    check('foe-first order: foe animation + damage, then our cards, count-up, our animation, damage', /^foeFirst enemyMove FOE_ANIM damage:player play card.*total HAND_ANIM damage:enemy/.test(b.log));
    check('battle continues', await ev(() => { const s = window.__engine.Engine.scene; return !s.busy && s.b.deck.hand.length > 0; }));
    console.log(errors.length ? 'page errors:\n  ' + [...new Set(errors)].join('\n  ') : 'no page errors');
    if (errors.length) fails.push('page errors');
  } finally { await browser.close(); server.kill(); }
  console.log(fails.length ? `${fails.length} FAILED` : 'all ok');
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
