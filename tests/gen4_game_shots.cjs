// v0.4.0 Gen 4 in the game: screenshots of the POKéDEX at 493 (grid pages, Gen 4 entries, the new evolution texts), a
// battle with a Gen 4 wild POKéMON, an evolution into a Gen 4 form (EEVEE -> LEAFEON) and a Gen 4 legendary encounter
// (a rare legendary elite), plus a Gen 4 cry through the WAV path. Muted Chrome, offline. Look at them.
//   node tests/gen4_game_shots.cjs [port=8781] [prefix=gen4game]      ->  tests/out/<prefix>_*.png
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const port = +(process.argv[2] || 8781), prefix = process.argv[3] || 'gen4game';
const root = path.resolve(__dirname, '..'), out = path.join(root, 'tests/out');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
fs.mkdirSync(out, { recursive: true });
let fails = 0;
const check = (label, ok, extra = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${extra ? ' ' + extra : ''}`); if (!ok) fails++; return ok; };

(async () => {
  const server = spawn(process.execPath, [path.join(root, 'serve.cjs'), String(port)], { cwd: root, stdio: 'ignore' });
  await sleep(700);
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--autoplay-policy=no-user-gesture-required'] });
  const errors = [];
  try {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    await page.route('**/cloud.json', r => r.fulfill({ status: 404, body: '' }));
    await page.goto(`http://localhost:${port}/`); await page.evaluate(() => localStorage.clear()); await page.reload();
    await page.waitForFunction(() => window.__ready && window.G?.meta && window.__engine?.Engine.scene, null, { timeout: 120000 });
    const ev = (fn, arg) => page.evaluate(fn, arg);
    const toPage = async (x, y) => { const box = await (await page.$('canvas')).boundingBox(); return [box.x + x * box.width / 640, box.y + y * box.height / 360]; };
    const mouseTo = async (x, y) => { const [px, py] = await toPage(x, y); await page.mouse.move(px, py); };
    const shot = async (name, wait = 500) => { await sleep(wait); const file = path.join(out, `${prefix}_${name}.png`); await (await page.$('canvas')).screenshot({ path: file }); console.log('saved', file); };
    const closeOverlays = () => ev(() => { const E = window.__engine.Engine; for (const o of E.overlays.slice().reverse()) o.close ? o.close(true) : E.overlays.pop(); });
    const battleIdle = () => page.waitForFunction(() => { const E = window.__engine.Engine; for (const o of E.overlays.slice().reverse()) o.close ? o.close(true) : E.overlays.pop(); const s = E.scene; if (s?.msg?.cur) s.msg.cur.auto = 0.01; return s?.b && !s.busy; }, null, { timeout: 60000, polling: 100 });

    // ---- a Gen 4 cry (WAV, not in FireRed's bank) plays through Sound
    await mouseTo(320, 180); await page.mouse.down(); await page.mouse.up(); await sleep(300);
    const cry = await ev(async () => ({ unlocked: window.__sound.unlocked, turtwig: await window.__sound.playCry('TURTWIG'), pikachu: await window.__sound.playCry('PIKACHU') }));
    check('Gen 4 cry plays (WAV path)', cry.turtwig === true || !cry.unlocked, JSON.stringify(cry));

    // ---- the POKéDEX at 493 --------------------------------------------------------------------------------
    const dexInfo = await ev(async () => {
      const { D, DEX_MAX } = await import('/src/game/data.js'); const { wrap } = await import('/src/engine/font.js');
      const g4 = Object.values(D.species).filter(s => s.gen4);
      // the longest Gen 4 dex text at the entry's text width (3 lines fit)
      let worst = null, lines = 0;
      for (const s of g4) { const l = wrap(s.dexText || '', 296 - 16).length; if (l > lines) { lines = l; worst = s.key; } }
      G.meta.seenVersion = (await import('/src/game/version.js')).PATCH_NOTES[0].v;
      const caught = [...g4.filter(s => !s.legendary && !s.mythical && s.dex % 3 !== 0).map(s => s.key), 'LUCARIO', 'GARCHOMP', 'LEAFEON', 'MAGNEZONE', 'LICKILICKY', 'BURMY', 'EEVEE', 'MAGNETON', 'LICKITUNG', 'KIRLIA', 'BULBASAUR', 'PIKACHU', 'GIRATINA'];
      const seen = [...caught, ...g4.map(s => s.key).filter((k, i) => i % 2), 'VAPOREON', 'JOLTEON', 'FLAREON', 'ESPEON', 'UMBREON', 'GARDEVOIR'];
      Object.assign(G.meta, { tutorialDone: true, dexSeen: [...new Set(seen)], dexCaught: [...new Set(caught)], shinies: ['LUCARIO'] });
      const { DexScene } = await import('/src/scenes/dex.js');
      const sc = new DexScene(); window.__engine.setScene(sc); sc.page = 4;
      return { DEX_MAX, worst, lines, n: g4.length };
    });
    check('Gen 4 dex texts fit the 3-line box', dexInfo.lines <= 3, `${dexInfo.worst}: ${dexInfo.lines} lines`);
    check('DEX_MAX 493', dexInfo.DEX_MAX === 493 && dexInfo.n === 107);
    await mouseTo(10 + 6 * 41 + 19, 40 + 17); await shot('dex_page5_493');
    await ev(() => { window.__engine.Engine.scene.page = 3; }); await mouseTo(600, 300); await shot('dex_page4');
    const open = async (key) => {
      await ev(async (key) => {
        const { D } = await import('/src/game/data.js'); const E = window.__engine.Engine;
        if (!E.overlays.length) E.scene.openEntry(D.species[key].dex); else E.overlays.at(-1).go(D.species[key].dex, 0);
      }, key);
      await mouseTo(320, 352);
    };
    await open('LUCARIO'); await shot('dex_entry_lucario');
    const cur = () => ev(() => window.__engine.Engine.overlays.at(-1)?.species?.().key || null);
    check('a Gen 4 entry opens', (await cur()) === 'LUCARIO');
    await open('GARCHOMP'); await shot('dex_entry_garchomp');
    await open('EEVEE'); await shot('dex_entry_eevee_7_forms'); await mouseTo(16 + 222, 252 + 22); await shot('dex_entry_eevee_glaceon_tip');
    // hover LEAFEON / GLACEON in EEVEE's line: the stage of 7 splits into columns of 3
    const tips = await ev(async () => {
      const { evoLabel, evoHelp } = await import('/src/scenes/dex.js'); const { D } = await import('/src/game/data.js');
      const out = {};
      for (const [from, into] of [['EEVEE', 'LEAFEON'], ['EEVEE', 'GLACEON'], ['MAGNETON', 'MAGNEZONE'], ['LICKITUNG', 'LICKILICKY'], ['SNEASEL', 'WEAVILE'], ['BURMY', 'MOTHIM'], ['HAPPINY', 'CHANSEY'], ['KIRLIA', 'GALLADE']]) {
        const e = D.species[from].evolutions.find(x => x.into === into); out[into] = `${evoLabel(e)}: ${evoHelp(e)}`;
      }
      return out;
    });
    console.log(tips);
    check('evolution texts', /LEAF STONE/.test(tips.LEAFEON) && /MOSS ROCK/.test(tips.LEAFEON) && /ICE STONE/.test(tips.GLACEON) && /THUNDER/.test(tips.MAGNEZONE) && /ROLLOUT/.test(tips.LICKILICKY) && /Lv33/.test(tips.LICKILICKY) && /DUSK STONE/.test(tips.WEAVILE) && /50%/.test(tips.MOTHIM) && /Lv22/.test(tips.CHANSEY) && /DAWN STONE/.test(tips.GALLADE), JSON.stringify(tips));
    await open('LEAFEON'); await shot('dex_entry_leafeon');
    await open('MAGNEZONE'); await mouseTo(16 + 210, 252 + 40); await shot('dex_entry_magnezone_evo_tip');
    await open('LICKILICKY'); await mouseTo(16 + 200, 252 + 40); await shot('dex_entry_lickilicky_knows_move');
    await open('BURMY'); await shot('dex_entry_burmy');
    await open('GIRATINA'); await shot('dex_entry_giratina');
    await closeOverlays();

    // ---- a battle with a Gen 4 wild POKéMON --------------------------------------------------------------------
    const SOLO = async ({ a, acts, post, seed = 'G4SHOT', party = ['CHARIZARD', 'LAPRAS', 'JOLTEON'] }) => {
      Object.assign(G.meta, { tutorialDone: true, tipCatch: true, hintBattles: 9, basicsSeen: true, unlocks: { ...G.meta.unlocks, win: true } });
      const { Run } = await import('/src/game/run.js'); const { makeMon } = await import('/src/game/pokemon.js');
      const r = Run.create({ starter: 'CHARMANDER', seed, world: 'spire', regions: { acts, summit: acts[3], post }, champ: true });
      if (a) r.startAct(a);
      r.party = party.map((sp, i) => makeMon(sp, r.act.levels[1] + 2 - i, { rng: r.rng }));
      const n = Object.values(r.map.nodes).find(x => x.floor >= 6) || Object.values(r.map.nodes)[0];
      r.nodeId = n.id; r.floor = n.floor;
      G.run = r;
      return { id: n.id, floor: n.floor };
    };
    const K = ['kanto', 'kanto', 'kanto', 'kanto'];
    for (const [sp, a, region] of [['SHINX', 1, 'kanto'], ['DRIFLOON', 2, 'hoenn']]) {
      const node = await ev(SOLO, { a, acts: region === 'hoenn' ? ['kanto', 'kanto', 'hoenn', 'hoenn'] : K, post: 'kanto' });
      await ev(async ({ node, sp }) => {
        const r = G.run; const { RNG } = await import('/src/game/rng.js');
        r.balls.ULTRA_BALL = 3;
        const cfg = r.wildConfig(new RNG('g4w' + sp), node.floor, sp);
        window.__flow.startBattle(cfg, { id: node.id, type: 'wild', floor: node.floor });
      }, { node, sp });
      await battleIdle(); await sleep(1200);
      const foe = await ev(() => window.__engine.Engine.scene.b.enemy().species);
      check(`battle with a wild ${sp}`, foe === sp || foe === sp, foe);
      await mouseTo(80, 120); await shot(`battle_wild_${sp.toLowerCase()}`, 300);
    }

    // ---- an evolution into a Gen 4 form: EEVEE + LEAF STONE -> LEAFEON ------------------------------------------
    await ev(SOLO, { a: 2, acts: K, post: 'kanto', party: ['EEVEE', 'LAPRAS'] });
    await ev(async () => {
      const { itemEvolution } = await import('/src/game/pokemon.js'); const { runEvolution } = await import('/src/scenes/reward.js');
      const { RewardScene } = await import('/src/scenes/reward.js'); void RewardScene;
      const { MapScene } = await import('/src/scenes/map.js'); window.__engine.setScene(new MapScene());
      const m = G.run.party[0];
      window.__evo = runEvolution(m, itemEvolution(m, 'LEAF_STONE'), true);
    });
    await sleep(1600); await shot('evolve_eevee_leafeon_mid', 0);
    await page.waitForFunction(() => window.__engine.Engine.overlays.at(-1)?.phase === 2, null, { timeout: 30000, polling: 50 });
    await shot('evolve_eevee_leafeon_done', 700);
    const evolved = await ev(async () => { const E = window.__engine.Engine; for (let i = 0; i < 40 && E.overlays.length; i++) { const o = E.overlays.at(-1); if (o.close) o.close(true); else E.overlays.pop(); await new Promise(r => setTimeout(r, 100)); } return G.run.party[0].species; });
    check('EEVEE evolved into LEAFEON', evolved === 'LEAFEON', evolved);

    // ---- a Gen 4 legendary encounter: a rare legendary elite ----------------------------------------------------
    for (const [key, acts, post, a] of [['LEGEND_GIRATINA', K, 'kanto', 4], ['LEGEND_MESPRIT', K, 'kanto', 2]]) {
      const node = await ev(SOLO, { a, acts, post, party: ['CHARIZARD', 'LAPRAS', 'JOLTEON', 'SNORLAX'] });
      await ev(async ({ node, key }) => {
        const r = G.run; const { RNG } = await import('/src/game/rng.js');
        r.balls.ULTRA_BALL = 3;
        r.rareLegend = () => key; // (the roll that makes an elite node the act's rare legendary)
        const cfg = r.eliteConfig(new RNG('g4l'), node.floor);
        window.__flow.startBattle(cfg, { id: node.id, type: 'elite', floor: node.floor });
      }, { node, key });
      await sleep(900); await shot(`legend_${key.slice(7).toLowerCase()}_intro`, 0);
      await battleIdle(); await sleep(1200);
      const foe = await ev(() => { const s = window.__engine.Engine.scene; return { sp: s.b.enemy().species, legend: s.b.cfg.legend, music: window.__sound.currentBGM }; });
      check(`legendary encounter ${key}`, foe.sp === key.slice(7) && foe.legend === key.slice(7), JSON.stringify(foe));
      await mouseTo(80, 120); await shot(`legend_${key.slice(7).toLowerCase()}_battle`, 300);
    }
    await page.context().close();
  } catch (e) { check('ran', false, (e.stack || e.message).split('\n').slice(0, 3).join(' ')); }
  finally {
    check('no page errors', !errors.length, [...new Set(errors)].join(' | '));
    await browser.close(); server.kill();
  }
  console.log(fails ? `\n${fails} FAILED` : '\nall checks passed');
  process.exit(fails ? 1 : 0);
})();
