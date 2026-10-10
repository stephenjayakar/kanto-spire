// POKéDEX entry pages (scenes/dex.js DexEntry): screenshots of the grid, caught entries (shiny owned, branching
// evolutions, the longest dex text / ability text / learnset) and a seen-only entry, plus the navigation (click,
// arrows, evolution icons, Esc, right-click, CLOSE). Muted Chrome, offline. Look at them.
//   node tests/dex_entry_shots.cjs [port=8762] [prefix=dex]
// Writes tests/out/<prefix>_*.png; fails on page errors or broken navigation.
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const port = +(process.argv[2] || 8762), prefix = process.argv[3] || 'dex';
const root = path.resolve(__dirname, '..'), out = path.join(root, 'tests/out');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
fs.mkdirSync(out, { recursive: true });
let fails = 0;
const check = (label, ok, extra = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${extra ? ' ' + extra : ''}`); if (!ok) fails++; return ok; };

(async () => {
  const server = spawn(process.execPath, [path.join(root, 'serve.cjs'), String(port)], { cwd: root, stdio: 'ignore' });
  await sleep(700);
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
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
    const clickAt = async (x, y, button = 'left') => { const [px, py] = await toPage(x, y); await page.mouse.click(px, py, { button }); await sleep(250); };
    const top = () => ev(() => window.__engine.Engine.overlays.at(-1)?.constructor.name || null);
    const cur = () => ev(() => window.__engine.Engine.overlays.at(-1)?.species?.().key || null);
    const shot = async (name) => { await sleep(500); const file = path.join(out, `${prefix}_${name}.png`); await (await page.$('canvas')).screenshot({ path: file }); console.log('saved', file); };

    // The entry with the most lines of dex text at the text box's width (and the most ability text).
    const longest = await ev(async () => {
      const { D } = await import('/src/game/data.js'); const { wrap } = await import('/src/engine/font.js');
      let best = null, n = 0, bestAb = null, nAb = 0;
      for (const [k, s] of Object.entries(D.species)) {
        const l = wrap(s.dexText || '', 296 - 16).length;
        if (l > n || (l === n && (s.dexText || '').length > (D.species[best].dexText || '').length)) { n = l; best = k; }
        const a = s.abilities.reduce((t, x) => t + wrap(`${D.abilities[x]?.name}: ${D.abilities[x]?.desc}`, 306 - 16, 'small').length, 0);
        if (a > nAb) { nAb = a; bestAb = k; }
      }
      return { text: best, lines: n, ability: bestAb, abLines: nAb };
    });
    console.log('longest dex text:', longest);
    check('dex text fits the 3-line box', longest.lines <= 3, `${longest.text}: ${longest.lines} lines`);
    check('ability text fits the box (4 lines)', longest.abLines <= 4, `${longest.ability}: ${longest.abLines} lines`);

    const caught = ['BULBASAUR', 'IVYSAUR', 'EEVEE', 'VAPOREON', 'ESPEON', 'WURMPLE', 'SILCOON', 'CACTURNE', 'PIKACHU', 'TYROGUE', 'HITMONTOP', 'NINCADA', 'POLIWHIRL', 'POLITOED', longest.text, longest.ability];
    const seen = [...caught, 'VENUSAUR', 'JOLTEON', 'MEWTWO', 'BEAUTIFLY', 'CACNEA', 'RATTATA', 'PIDGEY'];
    await ev(async ({ caught, seen }) => {
      G.meta.seenVersion = (await import('/src/game/version.js')).PATCH_NOTES[0].v;
      Object.assign(G.meta, { tutorialDone: true, dexSeen: seen, dexCaught: caught, shinies: ['BULBASAUR'] });
      const { DexScene } = await import('/src/scenes/dex.js');
      window.__engine.setScene(new DexScene());
    }, { caught, seen });
    await mouseTo(10 + 41 + 19, 40 + 17); await shot('grid');

    // click IVYSAUR (#002) in the grid
    await clickAt(10 + 41 + 19, 40 + 17);
    check('clicking a seen POKéMON opens its entry', (await top()) === 'DexEntry' && (await cur()) === 'IVYSAUR');
    await mouseTo(320, 352); await shot('caught_ivysaur_shiny');
    // the shiny toggle (click the picture)
    await clickAt(16 + 70, 38 + 70);
    check('clicking the picture shows the normal colors', await ev(() => window.__engine.Engine.overlays.at(-1).isShiny() === false));
    await mouseTo(320, 352);
    // clicking an evolution icon: BULBASAUR is the first icon in the line
    const bulb = await ev(() => { const o = window.__engine.Engine.overlays.at(-1); return o.go(1, 0), o.species().key; });
    check('go(1) = BULBASAUR', bulb === 'BULBASAUR');
    await page.keyboard.press('ArrowRight'); await sleep(150);
    check('ArrowRight -> IVYSAUR', (await cur()) === 'IVYSAUR');
    await page.keyboard.press('ArrowRight'); await sleep(150);
    check('ArrowRight -> VENUSAUR (seen only)', (await cur()) === 'VENUSAUR');
    await mouseTo(320, 352); await shot('seen_venusaur');
    await page.keyboard.press('ArrowLeft'); await sleep(150);
    check('ArrowLeft -> IVYSAUR', (await cur()) === 'IVYSAUR');
    await clickAt(624 - 116 + 13, 4 + 17);
    check('< button -> BULBASAUR', (await cur()) === 'BULBASAUR');
    await shot('caught_bulbasaur');
    await ev(() => window.__engine.Engine.overlays.at(-1).go(1, -1));
    check('< from the first wraps to the last', (await cur()) !== 'BULBASAUR');

    const open = async (key) => { await ev((key) => { const { D } = window.__dexD; window.__engine.Engine.overlays.at(-1).go(D.species[key].dex, 0); }, key); await mouseTo(320, 352); };
    await ev(async () => { window.__dexD = await import('/src/game/data.js'); });
    await open('EEVEE'); await shot('caught_eevee');
    await mouseTo(16 + 120, 252 + 40); await shot('caught_eevee_evo_hover');
    await open('WURMPLE'); await shot('caught_wurmple');
    await open('MEWTWO'); await shot('seen_mewtwo');
    await open(longest.text); await shot(`long_text_${longest.text.toLowerCase()}`);
    await open(longest.ability); await shot(`long_ability_${longest.ability.toLowerCase()}`);
    await open('CACTURNE'); await mouseTo(330, 240); await shot('caught_cacturne_moves');
    await open('TYROGUE'); await shot('caught_tyrogue');
    await open('NINCADA'); await shot('caught_nincada');
    await open('POLIWHIRL'); await shot('caught_poliwhirl');
    await open('PIKACHU'); await shot('caught_pikachu');
    // click the evolution line: PIKACHU's line is PICHU (unseen), PIKACHU, RAICHU (unseen) -> clicking an unseen one does nothing
    await page.keyboard.press('Escape'); await sleep(200);
    check('Esc closes', (await top()) === null);
    check('the grid page follows the last entry (PIKACHU #025 on page 1)', await ev(() => window.__engine.Engine.scene.page === 0));
    await clickAt(10 + 41 + 19, 40 + 17);
    await clickAt(320, 200, 'right');
    check('right-click closes', (await top()) === null);
    await clickAt(10 + 41 + 19, 40 + 17);
    await clickAt(W_CLOSE[0], W_CLOSE[1]);
    check('CLOSE closes', (await top()) === null);
    // an unseen entry (#003 VENUSAUR is seen; #004 CHARMANDER is not) can't be opened
    await clickAt(10 + 3 * 41 + 19, 40 + 17);
    check('an unseen POKéMON does not open', (await top()) === null);
    await page.context().close();
  } catch (e) { check('ran', false, (e.stack || e.message).split('\n').slice(0, 3).join(' ')); }
  finally {
    check('no page errors', !errors.length, [...new Set(errors)].join(' | '));
    await browser.close(); server.kill();
  }
  console.log(fails ? `\n${fails} FAILED` : '\nall checks passed');
  process.exit(fails ? 1 : 0);
})();
const W_CLOSE = [640 - 92 + 38, 360 - 25 + 9];
