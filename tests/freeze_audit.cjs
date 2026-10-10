// Freeze audit for the v0.0.6 + v0.0.7 (+ v0.1.0 spire, v0.1.1 JOHTO: only=johto) ("?" events, curses) features, in muted Chrome WITH sound running (one real click unlocks the
// AudioContext; checks Sound.ready / backend / unlocked first). Each scenario sets a run up in front of a
// node, then the in-page driver (tests/freeze_driver.js) plays the real scenes; a watchdog flags any
// scenario that makes no progress for 15 s (a hung await or soft-locked input).
//   node tests/freeze_audit.cjs [port=8126] [only=substring]
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const port = +(process.argv[2] || 8126), only = process.argv[3] || '';
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'tests/out/freeze');
fs.mkdirSync(out, { recursive: true });

(async () => {
  const server = spawn(process.execPath, [path.join(root, 'serve.cjs'), String(port)], { cwd: root, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 700));
  // (headless Chrome never resumes an AudioContext from a synthetic click; the policy flag lets it run, muted)
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', ...(process.env.NO_AUDIO ? [] : ['--autoplay-policy=no-user-gesture-required'])] });
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  let errors = [], warns = [];
  page.on('pageerror', e => errors.push('PAGEERROR ' + e.message + ' ' + (e.stack || '').split('\n').slice(1, 3).join(' ')));
  page.on('console', m => {
    const t = m.text();
    if (m.type() === 'error' && !/Failed to load resource/.test(t)) errors.push('CONSOLE ' + t);
    if (m.type() === 'warning' && /\[sound\]/.test(t)) warns.push(t);
  });
  await page.goto(`http://localhost:${port}/`, { waitUntil: 'load' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.__ready && window.G?.meta, null, { timeout: 60000 });
  await page.addScriptTag({ type: 'module', content: fs.readFileSync(path.join(__dirname, 'freeze_driver.js'), 'utf8') });
  await page.waitForFunction(() => window.__audit, null, { timeout: 10000 });
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const wait = (ms) => page.waitForTimeout(ms);
  const rect = await ev(() => { const r = document.getElementById('game').getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height }; });
  const click = (x, y) => page.mouse.click(rect.l + x / 640 * rect.w, rect.t + y / 360 * rect.h);

  // Sound: one real click (title screen, empty spot) unlocks it.
  await click(620, 200);
  await wait(500);
  const snd = await ev(() => ({ ready: window.__sound.ready, unlocked: window.__sound.unlocked, backend: window.__sound.backend, ctx: window.__sound.context?.state }));
  console.log('sound:', JSON.stringify(snd));
  const results = [];
  if (!process.env.NO_AUDIO && (!snd.ready || !snd.unlocked || !snd.backend)) results.push({ name: 'sound initialised', ok: false, info: snd });
  await ev(() => { Object.assign(G.meta, { tutorialDone: true, tipCatch: true, seenVersion: 'v9', hintBattles: 9 }); G.meta.settings.fast = true; });

  // A run standing before a node of `type` (or the first node), party tuned for the outcome we want.
  const setup = (o) => ev(async (o) => {
    const { Run } = await import('/src/game/run.js');
    const { makeMon, maxHp } = await import('/src/game/pokemon.js');
    const r = Run.create({ starter: o.starter || 'CHARMANDER', ascension: o.asc || 0, seed: o.seed || ('AUDIT' + o.type + o.act + (o.regions ? o.regions.acts.join('') : '')), world: o.regions ? 'spire' : o.world || 'kanto', regions: o.regions || null, shiny: !!o.shiny });
    if (o.act) r.startAct(o.act);
    for (const sp of o.extra || []) r.party.push(makeMon(sp, 10, { rng: r.rng }));
    while (o.fill && r.party.length < 6) r.party.push(makeMon(['RATTATA', 'PIDGEY', 'ODDISH', 'ZUBAT', 'EKANS'][r.party.length - 1], 10, { rng: r.rng }));
    const lvl = o.level ?? (o.lose ? 5 : 100);
    for (const m of r.party) { m.level = lvl; m.hp = maxHp(m); if (o.lose) m.hp = 1; }
    if (o.leadHp !== undefined) r.party[0].hp = o.leadHp;
    if (o.consumables) r.consumables = o.consumables.slice();
    const target = o.type ? Object.values(r.map.nodes).find(n => n.type === o.type && n.floor >= (o.minFloor || 0)) : r.map.nodes[r.map.start[0]];
    if (!target) return null;
    if (target.prev?.length) { r.nodeId = target.prev[0]; r.floor = target.floor - 1; r.visited = [target.prev[0]]; }
    G.run = r;
    return target.id;
  }, o);

  // Drive until done(state) or a freeze. Returns {ok, why, st}.
  async function drive(policy, done, { limit = 150000, freezeMs = 15000 } = {}) {
    const t0 = Date.now(); let lastSig = null, lastChange = Date.now(), log = [];
    for (;;) {
      const r = await ev((p) => window.__audit.step(p), policy);
      if (r.did) log.push(r.did);
      if (r.click) await click(r.click[0], r.click[1]);
      const st = await ev(() => window.__audit.state());
      if (await done(st)) return { ok: true, st, log };
      if (r.sig !== lastSig) { lastSig = r.sig; lastChange = Date.now(); }
      else if (Date.now() - lastChange > freezeMs) return { ok: false, why: 'FREEZE (no progress for ' + freezeMs / 1000 + ' s)', st, log };
      if (Date.now() - t0 > limit) return { ok: false, why: 'TIMEOUT', st, log };
      await wait(100);
    }
  }

  async function scenario(name, fn) {
    if (only && !name.includes(only)) return;
    errors = []; warns = [];
    const t0 = Date.now();
    let res;
    try { res = await fn(); } catch (e) { res = { ok: false, why: 'harness error: ' + e.message }; }
    const shotName = name.replace(/[^a-z0-9]+/gi, '_');
    await page.screenshot({ path: path.join(out, shotName + '.png') });
    const ok = res.ok && !errors.length;
    results.push({ name, ok, why: res.why, errors: errors.slice(0, 5), warns: [...new Set(warns)].slice(0, 5) });
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name} (${((Date.now() - t0) / 1000).toFixed(1)} s)${res.why ? ' ' + res.why : ''}${res.info ? ' ' + res.info : ''}`);
    if (!ok) { console.log('   state:', JSON.stringify(res.st)); console.log('   last actions:', (res.log || []).slice(-8).join(' | ')); }
    for (const e of errors.slice(0, 5)) console.log('   ' + e);
    for (const w of [...new Set(warns)].slice(0, 5)) console.log('   warn: ' + w);
    // back to a clean scene between scenarios
    await ev(async () => { const { TitleScene } = await import('/src/scenes/title.js'); window.__engine.setScene(new TitleScene()); });
    await wait(200);
  }
  const atScene = (...names) => (st) => names.includes(st.scene) && !st.overlay;
  const enter = (id) => ev((id) => window.__flow.enterNode(id), id);

  // ---- legendary bird node (act 2 = ZAPDOS, act 3 = ARTICUNO, act 4 = MOLTRES; Hoenn REGIS) ----
  for (const [act, world] of [[1, 'kanto'], [2, 'kanto'], [3, 'kanto'], [1, 'hoenn']]) {
    for (const choice of ['accept', 'decline']) {
      await scenario(`bird ${world} act${act + 1} win + catch ${choice}`, async () => {
        const id = await setup({ type: 'legend', act, world });
        if (!id) return { ok: false, why: 'no legend node' };
        await enter(id);
        const r = await drive({ battle: 'win', catch: choice }, atScene('MapScene'));
        if (!r.ok) return r;
        const info = await ev(() => ({ party: G.run.party.map(m => m.species), caught: G.run.legendsCaught, relics: G.run.relics.map(x => x.key) }));
        const legend = await ev(async () => { const { LEGENDS } = await import('/src/game/acts.js'); return LEGENDS[G.run.act.bird]?.species; });
        const has = info.party.includes(legend);
        return { ok: choice === 'accept' ? has : !has, why: `${legend} in party: ${has}`, info: JSON.stringify(info.relics) };
      });
    }
  }
  await scenario('bird act2 catch with a full party (release picker)', async () => {
    const id = await setup({ type: 'legend', act: 1, fill: true });
    await enter(id);
    const r = await drive({ battle: 'win', catch: 'accept' }, atScene('MapScene'));
    if (!r.ok) return r;
    const party = await ev(() => G.run.party.map(m => m.species));
    return { ok: party.includes('ZAPDOS') && party.length === 6, why: party.join(',') };
  });
  await scenario('bird act2 lose', async () => {
    const id = await setup({ type: 'legend', act: 1, lose: true });
    await enter(id);
    return drive({ battle: 'lose' }, atScene('GameOverScene'));
  });

  // ---- rivals: BLUE (Kanto) and MAY (Hoenn) in acts 1-3, win and lose, a few starters ----
  for (const world of ['kanto', 'hoenn']) {
    for (const act of [0, 1, 2]) {
      for (const outcome of ['win', 'lose']) {
        const starter = world === 'kanto' ? ['BULBASAUR', 'PIKACHU', 'SQUIRTLE'][act] : ['TREECKO', 'MUDKIP', 'DRATINI'][act];
        await scenario(`rival ${world} act${act + 1} ${starter} ${outcome}`, async () => {
          const id = await setup({ type: 'rival', act, world, starter, lose: outcome === 'lose', fill: true });
          if (!id) return { ok: false, why: 'no rival node' };
          await enter(id);
          const r = await drive({ battle: outcome }, atScene(outcome === 'win' ? 'MapScene' : 'GameOverScene'));
          return r;
        });
      }
    }
  }

  // ---- the CHAMPION (BLUE's lines), Kanto and Hoenn; win -> Hall of Fame ----
  for (const world of ['kanto', 'hoenn']) {
    await scenario(`champion ${world} lines + win`, async () => {
      const ok = await ev(async (world) => {
        const { Run } = await import('/src/game/run.js');
        const { maxHp } = await import('/src/game/pokemon.js');
        const { makeMon } = await import('/src/game/pokemon.js');
        const r = Run.create({ starter: 'CHARMANDER', seed: 'AUDITCHAMP', world });
        const gi = r.acts.findIndex(a => a.gauntlet);
        r.startAct(gi);
        for (const sp of ['LAPRAS', 'SNORLAX', 'ALAKAZAM', 'GYARADOS', 'JOLTEON']) r.party.push(makeMon(sp, 100, { rng: r.rng, minIV: 31 }));
        for (const m of r.party) { m.level = 100; m.hp = maxHp(m); }
        r.gauntletIndex = r.act.gauntlet.length - 1;
        r.nodeId = Object.values(r.map.nodes).find(n => n.floor === r.act.floors - 1).id;
        r.inNode = true;
        G.run = r;
        window.__flow.startGauntletBattle();
        return { intro: window.__engine.Engine.scene.cfg.intro || null };
      }, world);
      const lines = [];
      const r = await drive({ battle: 'win' }, (st) => { if (st.msg && !lines.includes(st.msg)) lines.push(st.msg); return st.scene === 'VictoryScene'; });
      const blue = lines.filter(l => /^(BLUE|STEVEN|MAY)/.test(l));
      console.log('   intro lines:', JSON.stringify(blue.slice(0, 4)));
      return { ...r, ok: r.ok && (world === 'hoenn' || blue.length > 0), why: r.why || (blue.length ? '' : 'no BLUE lines seen') };
    });
  }

  // ---- Nuzlocke (A8): the lead faints and is released after a won battle; a party wipe ends the run ----
  await scenario('nuzlocke release after a win', async () => {
    const id = await setup({ type: null, asc: 8, extra: ['PIDGEY'], leadHp: 1 });
    await ev(async () => { const { maxHp } = await import('/src/game/pokemon.js'); const p = G.run.party; p[0].level = 5; p[0].hp = 1; p[1].level = 100; p[1].hp = maxHp(p[1]); });
    await enter(id);
    // weakest plays first so the 1-HP lead takes a hit and faints, then the strong partner wins
    const r = await drive({ battle: 'win' }, atScene('MapScene'));
    if (!r.ok) return r;
    const party = await ev(() => G.run.party.map(m => m.species));
    return { ok: party.length === 1, why: 'party after: ' + party.join(',') };
  });
  await scenario('nuzlocke party wipe -> game over', async () => {
    const id = await setup({ type: null, asc: 8, extra: ['PIDGEY'], lose: true });
    await enter(id);
    return drive({ battle: 'lose' }, atScene('GameOverScene'));
  });

  // ---- full BAG picker from every item source ----
  const FULL = ['POTION', 'X_ATTACK', 'REVIVE'];
  for (const bag of ['leave', 'sell', 'useNew']) {
    await scenario(`bagfull reward item (${bag})`, async () => {
      const id = await setup({ type: null, consumables: FULL });
      await enter(id);
      // win the battle, then make sure the reward list carries an item
      const r1 = await drive({ battle: 'win' }, (st) => st.scene === 'RewardScene');
      if (!r1.ok) return r1;
      await ev(() => { const sc = window.__engine.Engine.scene; if (!sc.rewards.some(r => r.kind === 'item')) sc.rewards.push({ kind: 'item', key: 'SUPER_POTION', label: 'SUPER POTION' }); });
      const r = await drive({ battle: 'win', bag }, atScene('MapScene'));
      if (!r.ok) return r;
      const b = await ev(() => G.run.consumables.slice());
      // sell: a bag item was sold and the reward item stored; leave/useNew: the bag is untouched
      return { ok: bag === 'sell' ? b.length === 3 && !b.includes('POTION') : b.join() === FULL.join(), why: b.join(',') };
    });
  }
  await scenario('bagfull item ball (sell)', async () => {
    const id = await setup({ type: 'treasure', consumables: FULL });
    await enter(id);
    await ev(() => { window.__engine.Engine.scene.item = 'RARE_CANDY'; window.__engine.Engine.scene.relics = []; });
    await wait(300);
    await click(320, 234); // PICK IT UP
    await page.waitForFunction(() => window.__engine.Engine.overlays.length > 0, null, { timeout: 5000 });
    const r = await drive({ bag: 'sell' }, (st) => st.scene === 'TreasureScene' && !st.overlay && st.busy === false);
    if (!r.ok) return r;
    await wait(300);
    await click(320, 279); // CONTINUE
    const r2 = await drive({}, atScene('MapScene'));
    const b = await ev(() => G.run.consumables.slice());
    return { ...r2, ok: r2.ok && b.includes('RARE_CANDY'), why: r2.why || b.join(',') };
  });
  await scenario('bagfull mart (leave, then sell)', async () => {
    const id = await setup({ type: 'mart', consumables: FULL });
    await enter(id);
    await ev(() => { G.run.money = 9000; });
    for (const bag of ['leave', 'sell']) {
      await ev(() => { const sc = window.__engine.Engine.scene; const it = sc.shop.items.find(i => i.kind !== 'relic' && i.key && !i.sold && /POTION|BALL|REPEL|ETHER|HEAL|ANTIDOTE/.test(i.key)) || sc.shop.items.find(i => !i.sold); window.__item = it; sc.buy(it); });
      const r = await drive({ bag }, (st) => st.scene === 'ShopScene' && !st.overlay);
      if (!r.ok) return r;
    }
    await ev(() => window.__flow.goToMap());
    return { ok: true };
  });
  await scenario('bagfull event item', async () => {
    const id = await setup({ type: 'event', consumables: FULL });
    await enter(id);
    await wait(300);
    // an event whose result hands out an item that doesn't fit
    const got = await ev(async () => {
      const sc = window.__engine.Engine.scene;
      const res = { text: 'You found something!', overflow: ['ETHER'] };
      sc.ev = { name: 'TEST', text: 'A test event.', choices: [{ label: 'Take it', run: () => res }] };
      sc.choose(sc.ev.choices[0]);
      return true;
    });
    const r = await drive({ bag: 'leave' }, (st) => st.scene === 'EventScene' && !st.overlay && !st.busy);
    if (!r.ok) return r;
    await ev(() => window.__flow.goToMap());
    return { ok: got };
  });

  // ---- v0.0.7 "?" events: forced at an event node (floor 5+, so battle choices show), played through the real
  // EventScene with clicks (choice -> follow-up pickers -> CONTINUE), event battles to the end ----
  const atEvent = async (o, id) => {
    const nid = await ev(async ({ o, id }) => {
      const { Run } = await import('/src/game/run.js');
      const { makeMon, maxHp } = await import('/src/game/pokemon.js');
      const r = Run.create({ starter: o.starter || (o.world === 'hoenn' ? 'TREECKO' : 'CHARMANDER'), ascension: o.asc || 0, seed: 'AUDITEV' + (id || 'pick') + (o.act || 0) + (o.regions ? o.regions.acts.join('') : ''), world: o.regions ? 'spire' : o.world || 'kanto', regions: o.regions || null });
      if (o.act) r.startAct(o.act);
      for (const sp of o.extra || ['PIDGEY', 'ODDISH']) r.party.push(makeMon(sp, 10, { rng: r.rng }));
      while (o.fill && r.party.length < 6) r.party.push(makeMon(['RATTATA', 'ZUBAT', 'EKANS', 'SPEAROW'][r.party.length % 4], 10, { rng: r.rng }));
      const lvl = o.lose ? 5 : 100;
      for (const m of r.party) { m.level = lvl; m.hp = o.lose ? 1 : maxHp(m); }
      for (const k of o.relics || []) r.addRelic(k);
      Object.assign(r.flags ||= {}, o.flags || {});
      r.money = o.money ?? 20000;
      const t = Object.values(r.map.nodes).filter(n => n.type === 'event' && n.prev?.length).sort((a, b) => Math.abs(a.floor - 6) - Math.abs(b.floor - 6))[0];
      if (!t) return null;
      r.nodeId = t.prev[0]; r.floor = t.floor - 1; r.visited = [t.prev[0]];
      if (id) { r.pendingEventId = id; r.pendingEventAt = r.actIndex + ':' + t.id; }
      G.run = r;
      return t.id;
    }, { o, id });
    if (!nid) return null;
    await enter(nid);
    await ev(() => { G.run.floor = Math.max(G.run.floor, 5); }); // battle choices wait for floor 4-5 (minFloor)
    await wait(300);
    return nid;
  };
  const evInfo = () => ev(() => ({ relics: G.run.relics.map(x => x.key), party: G.run.party.map(m => m.species), flags: G.run.flags, money: G.run.money, balls: G.run.balls, consumables: G.run.consumables.slice() }));
  const evScenario = (name, o, id, policy, check, done = atScene('MapScene')) => scenario(name, async () => {
    const nid = await atEvent(o, id);
    if (!nid) return { ok: false, why: 'no event node' };
    const shown = await ev(() => window.__engine.Engine.scene?.ev?.id || null);
    if (id && shown !== id) return { ok: false, why: `event ${shown} shown instead of ${id}` };
    const r = await drive(policy, done);
    if (!r.ok) return r;
    const info = await evInfo();
    const why = check ? check(info, shown) : '';
    return { ok: !why, why: why || `${shown}: ${JSON.stringify(info.relics)} ${info.party.join(',')}` };
  });
  await evScenario('event: held item choice (S.S. ANNE)', { act: 1 }, 'ss_anne', { event: 'CAPTAIN' }, (i) => (i.relics.length === 1 ? '' : 'no held item'));
  await evScenario('event: curse + held item (POKeMON TOWER offering)', { act: 1 }, 'ghost', { event: 'Take an offering' }, (i) => (i.relics.includes('CURSED_DOLL') && i.relics.length === 2 ? '' : 'relics ' + i.relics));
  await evScenario('event: loan curse (GAME CORNER)', { act: 1, money: 100 }, 'gamecorner', { event: 'Take a loan' }, (i) => (i.relics.includes('IOU_NOTE') && i.money > 100 ? '' : 'no IOU NOTE / money'));
  await evScenario('event: multi-step (POWER PLANT, push your luck)', { act: 2 }, 'powerplant', { event: 'Pick up a ball', step: 'Pick up another', battle: 'win' });
  await evScenario('event: multi-step (ABANDONED SHIP, Hoenn)', { act: 2, world: 'hoenn' }, 'abandoned_ship', { event: 'Search the cabins', step: 'Pick up another', battle: 'win' });
  await evScenario('event battle win: TEAM ROCKET (winFlags)', { act: 0 }, 'rocket1', { event: '^Fight', battle: 'win' }, (i) => (i.flags.rocket1 === 'beat' ? '' : 'flags ' + JSON.stringify(i.flags)));
  await evScenario('event battle win: FIGHTING DOJO (pick a HITMON)', { act: 2 }, 'dojo', { event: 'Challenge', battle: 'win' }, (i) => (i.party.some(s => /HITMON/.test(s)) ? '' : 'no HITMON: ' + i.party));
  await evScenario('event battle win: SILPH CO. (MASTER BALL + held item)', { act: 2 }, 'silph', { event: 'Storm', battle: 'win' }, (i) => (i.balls.MASTER_BALL >= 1 && i.relics.length >= 1 && i.flags.rocket3 === 'beat' ? '' : `balls ${JSON.stringify(i.balls)} relics ${i.relics}`));
  await evScenario('event battle win: KECLEON (wild elite, DEVON SCOPE)', { act: 2, world: 'hoenn' }, 'kecleon', { event: 'Poke it', battle: 'win', catch: 'decline' }, (i) => (i.relics.includes('DEVON_SCOPE') ? '' : 'relics ' + i.relics));
  await evScenario('event battle loss: SNORLAX -> game over', { act: 2, lose: true }, 'snorlax', { event: 'Wake it up', battle: 'lose' }, null, atScene('GameOverScene'));
  await evScenario('event: COPYCAT shrine (2 copies)', { act: 1 }, 'copycat', { event: 'Copy two' });
  await evScenario('event: MOVE DELETER shrine (3 cards)', { act: 2 }, 'deleter', { event: 'Forget 3' });
  await evScenario('event: upgrade (CINNABAR gene research)', { act: 2 }, 'cinnabar_lab', { event: 'Gene research' });
  await evScenario('event: tutor shrine (premium)', { act: 1 }, 'tutor', { event: 'Premium' });
  await evScenario('event: gift with a full party (MT. MOON fossil -> release)', { act: 0, fill: true }, 'fossil', { event: 'OMANYTE' }, (i) => (i.party.includes('OMANYTE') && i.party.length === 6 ? '' : i.party.join(',')));
  await evScenario('event story payoff: CINNABAR LAB (OLD AMBER sent)', { act: 2, flags: { amber: 'sent' } }, null, { event: 'AERODACTYL' }, (i, shown) => (shown === 'cinnabar_lab' && i.party.includes('AERODACTYL') && i.flags.amber === 'done' ? '' : `shown ${shown}, party ${i.party}`));
  await evScenario('event story payoff: STEVEN thanks (DEVON GOODS)', { act: 2, world: 'hoenn', flags: { devon: 'goods' } }, null, { event: 'DEVON SCOPE' }, (i, shown) => (shown === 'steven_thanks' && i.relics.includes('DEVON_SCOPE') ? '' : `shown ${shown}`));
  await evScenario('event: NUZLOCKE pc shrine (Tidy up instead of a trade)', { act: 0, asc: 8 }, 'pc', { event: 'Tidy up' });
  await evScenario('event: MT. PYRE cleanses curses', { act: 2, world: 'hoenn', relics: ['CURSED_DOLL', 'HEX_LETTER'] }, 'mt_pyre', { event: 'Pray' }, (i) => (!i.relics.length ? '' : 'still ' + i.relics));
  await scenario('center: CLEANSE a curse, then heal', async () => {
    const id = await setup({ type: 'center' });
    await ev(() => { G.run.addRelic('LAGGING_TAIL'); G.run.money = 5000; });
    await enter(id);
    await wait(500);
    const before = await ev(() => ({ money: G.run.money, cost: G.run.cleanseCost() }));
    await click(430, 269); // CLEANSE A CURSE
    await wait(600);
    const mid = await ev(() => ({ money: G.run.money, curses: G.run.curses(), busy: window.__engine.Engine.scene.busy }));
    if (mid.curses.length || mid.money !== before.money - before.cost) return { ok: false, why: 'cleanse failed: ' + JSON.stringify({ before, mid }) };
    await click(335, 165); // HEAL
    await page.waitForFunction(() => window.__engine.Engine.scene.done && !window.__engine.Engine.scene.busy, null, { timeout: 15000 });
    await click(430, 185); // CONTINUE
    return drive({}, atScene('MapScene'));
  });

  // ---- act clear: the starter unlock choice, then on to the next act ----
  await scenario('boss win -> act clear -> starter unlock -> next act', async () => {
    await ev(() => { G.meta.unlockedStarters = ['BULBASAUR', 'CHARMANDER', 'SQUIRTLE']; G.meta.starterOffers = []; G.meta.starterClaims = {}; G.meta.starterVer = 2; });
    const id = await setup({ type: 'boss' });
    await ev(() => { const r = G.run; r.nodeId = Object.values(r.map.nodes).find(n => n.floor === r.act.floors - 1).id; r.floor = r.act.floors - 1; });
    await enter('boss');
    const r = await drive({ battle: 'win' }, (st) => st.scene === 'MapScene' && st.act === 1);
    if (!r.ok) return r;
    const n = await ev(() => G.meta.unlockedStarters.length);
    return { ok: n === 4, why: 'unlocked starters: ' + n };
  });

  // ---- shiny starter: the sparkle on entry, a whole battle ----
  await scenario('shiny starter battle', async () => {
    const id = await setup({ type: null, starter: 'SQUIRTLE', shiny: true });
    await enter(id);
    return drive({ battle: 'win' }, atScene('MapScene'));
  });

  // ---- plain trainer + wild battles at normal speed (not FAST) ----
  await scenario('trainer battle, normal speed', async () => {
    await ev(() => { G.meta.settings.fast = false; });
    const id = await setup({ type: 'trainer' });
    await enter(id);
    const r = await drive({ battle: 'win' }, atScene('MapScene'));
    await ev(() => { G.meta.settings.fast = true; });
    return r;
  });

  // ---- v0.1.0 ONE SPIRE: every act variant (4 tiers x KANTO / HOENN) in a mixed spire, with its music running ----
  const K = 'kanto', Hn = 'hoenn', other = (r) => (r === K ? Hn : K);
  const mixed = (t, reg) => ({ acts: [0, 1, 2, 3].map(i => (i === t ? reg : other(reg))), summit: other(reg), post: reg });
  // (HOENN acts play Emerald's map music when the optional Emerald bank is there: audio/emerald.js)
  const bgmOk = async () => ev(async () => { const s = window.__sound; const act = G.run?.act; const { HOENN_MAP_MUSIC, EM } = await import('/src/audio/emerald.js'); return { bgm: s?.currentBGM || null, want: act ? [...act.music, ...(act.areas || []).map(a => a.music).filter(Boolean), ...(act.region === 'hoenn' ? (HOENN_MAP_MUSIC[act.id] || []).map(x => EM + x) : [])] : [] }; });
  for (const t of [0, 1, 2, 3]) for (const reg of [K, Hn]) {
    const regions = mixed(t, reg), tag = `spire act${t + 1} ${reg.toUpperCase()} (${regions.acts.map(r => r[0].toUpperCase()).join('-')})`;
    await scenario(`${tag}: map music + trainer + wild`, async () => {
      for (const type of ['trainer', 'wild']) {
        const id = await setup({ type, act: t, regions, starter: reg === Hn ? 'TORCHIC' : 'BULBASAUR' });
        if (!id) return { ok: false, why: 'no ' + type + ' node' };
        await ev(async () => { const { MapScene } = await import('/src/scenes/map.js'); window.__engine.setScene(new MapScene({ actIntro: true })); });
        await wait(2900);
        const m = await bgmOk();
        if (!m.bgm || !m.want.includes(m.bgm)) return { ok: false, why: `map music ${m.bgm} not in ${m.want}` };
        const reg2 = await ev(() => G.run.region);
        if (reg2 !== reg) return { ok: false, why: 'region ' + reg2 };
        await enter(id);
        const r = await drive({ battle: 'win', catch: 'decline' }, atScene('MapScene'));
        if (!r.ok) return r;
      }
      return { ok: true };
    });
    if (t < 3) await scenario(`${tag}: GYM win -> act clear preview -> ${other(reg).toUpperCase()} act ${t + 2}`, async () => {
      const id = await setup({ type: 'boss', act: t, regions, fill: true });
      await ev(() => { const r = G.run; r.nodeId = Object.values(r.map.nodes).find(n => n.floor === r.act.floors - 1).id; r.floor = r.act.floors - 1; });
      await enter('boss');
      const r1 = await drive({ battle: 'win', stopAtActClear: true }, (st) => st.scene === 'ActClearScene' && !st.overlay);
      if (!r1.ok) return r1;
      const next = await ev(() => ({ region: G.run.acts[G.run.actIndex + 1].region, bosses: G.run.acts[G.run.actIndex + 1].bosses || G.run.acts[G.run.actIndex + 1].gauntlet || [] }));
      await page.screenshot({ path: path.join(out, `spire_actclear_${t + 1}_${reg}.png`) });
      const r = await drive({ battle: 'win' }, (st) => st.scene === 'MapScene' && st.act === t + 1);
      if (!r.ok) return r;
      await wait(2600);
      const m = await bgmOk(), now = await ev(() => G.run.region);
      return { ok: now === other(reg) && next.region === now && m.want.includes(m.bgm), why: `next ${next.region} now ${now} bgm ${m.bgm}`, info: next.bosses.join(',') };
    });
    if (t >= 1) await scenario(`${tag}: legendary node win`, async () => {
      const id = await setup({ type: 'legend', act: t, regions, fill: true });
      if (!id) return { ok: false, why: 'no legend node' };
      await enter(id);
      return drive({ battle: 'win', catch: 'decline' }, atScene('MapScene'));
    });
  }
  // one rival per run: BLUE in HOENN acts (KANTO starter), MAY in KANTO acts (HOENN starter)
  for (const [starter, reg] of [['CHARMANDER', Hn], ['MUDKIP', K]]) for (const t of [0, 1, 2]) {
    await scenario(`spire rival act${t + 1}: ${starter} meets ${starter === 'MUDKIP' ? 'MAY' : 'BLUE'} in ${reg.toUpperCase()}`, async () => {
      const id = await setup({ type: 'rival', act: t, regions: { acts: [reg, reg, reg, reg], summit: reg, post: reg }, starter, fill: true });
      if (!id) return { ok: false, why: 'no rival node' };
      await enter(id);
      const who = await ev(() => window.__engine.Engine.scene?.cfg?.trainer?.name || null);
      const r = await drive({ battle: 'win' }, atScene('MapScene'));
      const want = starter === 'MUDKIP' ? /MAY|^$/ : /BLUE/;
      return { ...r, ok: r.ok && want.test(who || ''), why: r.why || `rival ${who}` };
    });
  }
  // the summit: the ELITE FOUR / CHAMPION of the other region after act 4, then on into the drawn post-game
  for (const [summit, post, starter] of [[K, Hn, 'TORCHIC'], [Hn, K, 'CHARMANDER']]) {
    await scenario(`spire summit ${summit.toUpperCase()} (act 4 ${other(summit).toUpperCase()}) -> champion -> ${post.toUpperCase()} post-game`, async () => {
      await ev(async ({ summit, post, starter }) => {
        const { Run } = await import('/src/game/run.js');
        const { makeMon, maxHp } = await import('/src/game/pokemon.js');
        const other = summit === 'kanto' ? 'hoenn' : 'kanto';
        const r = Run.create({ starter, seed: 'AUDITSUMMIT' + summit, world: 'spire', regions: { acts: ['kanto', 'hoenn', 'kanto', other], summit, post } });
        r.startAct(3);
        for (const sp of ['LAPRAS', 'SNORLAX', 'ALAKAZAM', 'GYARADOS', 'JOLTEON']) r.party.push(makeMon(sp, 100, { rng: r.rng, minIV: 31 }));
        for (const m of r.party) { m.level = 100; m.hp = maxHp(m); }
        r.gauntletIndex = r.act.gauntlet.length - 1;
        r.nodeId = Object.values(r.map.nodes).find(n => n.floor === r.act.floors - 1).id;
        r.inNode = true;
        G.run = r;
        window.__flow.startGauntletBattle();
      }, { summit, post, starter });
      const lines = [];
      const champ = await ev(() => window.__engine.Engine.scene?.cfg?.trainer?.title || null);
      const r = await drive({ battle: 'win' }, (st) => { if (st.msg && !lines.includes(st.msg)) lines.push(st.msg); return st.scene === 'VictoryScene'; });
      if (!r.ok) return r;
      const r1 = await drive({}, atScene('VictoryScene')); // (the act-clear starter unlock first)
      if (!r1.ok) return r1;
      await wait(400);
      await page.screenshot({ path: path.join(out, `spire_summit_${summit}.png`) });
      await click(220, 311); // CONTINUE TO <post-game>
      const r2 = await drive({}, atScene('MapScene'));
      if (!r2.ok) return r2;
      await wait(2600);
      const m = await bgmOk(), pg = await ev(() => ({ region: G.run.region, post: !!G.run.act.postgame, name: G.run.act.name }));
      return { ok: pg.region === post && pg.post && m.want.includes(m.bgm), why: `${champ}; post-game ${pg.name} (${pg.region}) bgm ${m.bgm}`, info: JSON.stringify(lines.filter(l => /^(BLUE|STEVEN)/.test(l)).slice(0, 1)) };
    });
  }

  // ---- v0.1.1 JOHTO act variants: a night wild battle, GYM LEADERS, SILVER on every rival floor (any region), a
  // JOHTO "?" event, the JOHTO ELITE FOUR -> CHAMPION LANCE -> MT. SILVER, and RED (a trainer boss) ending the post-game ----
  const Jo = 'johto', JJ = { acts: [Jo, Jo, Jo, Jo], summit: Jo, post: Jo };
  for (const [t, starter] of [[0, 'CYNDAQUIL'], [2, 'BULBASAUR']]) {
    await scenario(`johto act${t + 1} wild at NIGHT (${starter})`, async () => {
      const id = await setup({ type: 'wild', act: t, regions: JJ, starter, minFloor: 10 });
      if (!id) return { ok: false, why: 'no night wild node' };
      await enter(id);
      const c = await ev(() => { const cfg = window.__engine.Engine.scene?.cfg; return { tod: cfg?.timeOfDay || null, sp: cfg?.enemies?.[0]?.species, area: cfg?.areaName }; });
      const r = await drive({ battle: 'win', catch: 'decline' }, atScene('MapScene'));
      return { ...r, ok: r.ok && c.tod === 'nite', why: r.why || `${c.tod}: ${c.sp} at ${c.area}` };
    });
  }
  for (const t of [0, 1, 2]) {
    await scenario(`johto act${t + 1} GYM LEADER win -> act clear -> act ${t + 2}`, async () => {
      await setup({ type: 'boss', act: t, regions: JJ, fill: true, starter: 'CHIKORITA' });
      const boss = await ev(() => { const r = G.run; r.nodeId = Object.values(r.map.nodes).find(n => n.floor === r.act.floors - 1).id; r.floor = r.act.floors - 1; return r.boss; });
      await enter('boss');
      const rule = await ev(() => window.__engine.Engine.scene?.cfg?.bossRule || null);
      const r = await drive({ battle: 'win' }, (st) => st.scene === 'MapScene' && st.act === t + 1);
      if (!r.ok) return r;
      const badges = await ev(() => G.run.badges.slice());
      return { ok: badges.length >= 1, why: `${boss} (${rule}) badges ${badges}` };
    });
  }
  for (const [t, reg] of [[0, K], [1, Hn], [2, Jo]]) {
    await scenario(`johto SILVER rival act${t + 1} in ${reg.toUpperCase()} (TOTODILE)`, async () => {
      const id = await setup({ type: 'rival', act: t, regions: { acts: [reg, reg, reg, reg], summit: reg, post: reg }, starter: 'TOTODILE', fill: true });
      if (!id) return { ok: false, why: 'no rival node' };
      await enter(id);
      const c = await ev(() => { const cfg = window.__engine.Engine.scene?.cfg; return { who: cfg?.trainer?.name, sp: cfg?.enemies?.map(e => e.species) }; });
      const r = await drive({ battle: 'win' }, atScene('MapScene'));
      return { ...r, ok: r.ok && c.who === 'SILVER', why: r.why || `${c.who}: ${c.sp}` };
    });
  }
  await scenario('johto SILVER rival act2 lose', async () => {
    const id = await setup({ type: 'rival', act: 1, regions: JJ, starter: 'CHIKORITA', lose: true, fill: true });
    if (!id) return { ok: false, why: 'no rival node' };
    await enter(id);
    return drive({ battle: 'lose' }, atScene('GameOverScene'));
  });
  for (const t of [0, 2]) await evScenario(`johto "?" event act${t + 1} (picked)`, { act: t, regions: JJ, starter: 'CYNDAQUIL' }, null, { battle: 'win', catch: 'decline' }, null);
  await scenario('johto summit: KAREN -> CHAMPION LANCE -> MT. SILVER post-game', async () => {
    await ev(async () => {
      const { Run } = await import('/src/game/run.js');
      const { makeMon, maxHp } = await import('/src/game/pokemon.js');
      const r = Run.create({ starter: 'CYNDAQUIL', seed: 'AUDITJSUMMIT', world: 'spire', regions: { acts: ['kanto', 'johto', 'hoenn', 'johto'], summit: 'johto', post: 'johto' } });
      r.startAct(3);
      for (const sp of ['LAPRAS', 'SNORLAX', 'ALAKAZAM', 'GYARADOS', 'JOLTEON']) r.party.push(makeMon(sp, 100, { rng: r.rng, minIV: 31 }));
      for (const m of r.party) { m.level = 100; m.hp = maxHp(m); }
      r.gauntletIndex = 3;
      r.nodeId = Object.values(r.map.nodes).find(n => n.floor === r.act.floors - 1).id;
      r.inNode = true;
      G.run = r;
      window.__flow.startGauntletBattle();
    });
    const seen = [];
    const who = () => ev(() => window.__engine.Engine.scene?.cfg?.trainer?.title || null);
    seen.push(await who());
    const r = await drive({ battle: 'win' }, async (st) => { if (st.scene === 'BattleScene') { const w = await who(); if (w && !seen.includes(w)) seen.push(w); } return st.scene === 'VictoryScene'; });
    if (!r.ok) return r;
    const r1 = await drive({}, atScene('VictoryScene'));
    if (!r1.ok) return r1;
    await wait(400);
    await click(220, 311); // CONTINUE TO the post-game
    const r2 = await drive({}, atScene('MapScene'));
    if (!r2.ok) return r2;
    await wait(2600);
    const m = await bgmOk(), pg = await ev(() => ({ region: G.run.region, post: !!G.run.act.postgame, name: G.run.act.name }));
    return { ok: seen.includes('CHAMPION LANCE') && pg.region === 'johto' && pg.post && m.want.includes(m.bgm), why: `${seen.join(' > ')}; ${pg.name} bgm ${m.bgm}` };
  });
  await scenario('johto post-game: RED (trainer boss) win -> post-game victory', async () => {
    await setup({ type: 'boss', act: 4, regions: JJ, starter: 'CHIKORITA' });
    const boss = await ev(async () => {
      const { makeMon, maxHp } = await import('/src/game/pokemon.js');
      const r = G.run;
      for (const sp of ['LAPRAS', 'SNORLAX', 'ALAKAZAM', 'GYARADOS', 'JOLTEON']) r.party.push(makeMon(sp, 100, { rng: r.rng, minIV: 31 }));
      for (const m of r.party) { m.level = 100; m.hp = maxHp(m); }
      r.nodeId = Object.values(r.map.nodes).find(n => n.floor === r.act.floors - 1).id; r.floor = r.act.floors - 1;
      return r.boss;
    });
    await enter('boss');
    const who = await ev(() => window.__engine.Engine.scene?.cfg?.trainer?.name || null);
    const r = await drive({ battle: 'win' }, (st) => st.scene === 'VictoryScene');
    if (!r.ok) return r;
    await wait(400);
    const won = await ev(() => ({ victory: G.run?.victory, postgame: !!G.meta.unlocks.postgame }));
    return { ok: who === 'RED' && boss === 'PKMN_TRAINER_RED' && won.postgame, why: `${who} ${JSON.stringify(won)}` };
  });

  const bad = results.filter(r => !r.ok);
  console.log(`\n${results.length - bad.length}/${results.length} scenarios passed`);
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ sound: snd, results }, null, 1));
  await browser.close(); server.kill();
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
