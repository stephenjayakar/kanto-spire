// Size check: are the HeartGold (JOHTO) trainer portraits / POKéMON bigger in game than FireRed's (KANTO)?
// Muted Chrome, offline, own server. Same battle scene, same lead, same foe, KANTO act vs JOHTO act:
//   intro_<region>_<trainer>.png   a trainer intro (portrait at 2x, as drawn by scenes/battle.js)
//   battle_<region>_<species>.png  the same foe species after the intro
// and prints the portraits' opaque bounding boxes as drawn (source px x2).
//   node tests/size_check_shots.cjs [outdir=tests/out/sizecheck] [port=8172]
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.resolve(ROOT, process.argv[2] || 'tests/out/sizecheck');
const PORT = +(process.argv[3] || 8172);
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// [region, trainer key, foe species]
const CASES = [
  ['kanto', 'LEADER_BROCK', 'GEODUDE'], ['johto', 'LEADER_FALKNER', 'GEODUDE'],
  ['kanto', 'ELITE_FOUR_BRUNO', 'PIDGEY'], ['johto', 'JOHTO_E4_BRUNO', 'PIDGEY'],
  ['kanto', 'LEADER_KOGA', 'BULBASAUR'], ['johto', 'JOHTO_E4_KOGA', 'BULBASAUR'],
  ['kanto', 'LEADER_MISTY', 'ONIX'], ['johto', 'LEADER_WHITNEY', 'ONIX'],
];

(async () => {
  const server = spawn(process.execPath, [path.join(ROOT, 'serve.cjs'), String(PORT)], { cwd: ROOT, stdio: 'ignore' });
  await sleep(700);
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio'] });
  const errors = [];
  try {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
    await page.route('**/cloud.json', r => r.fulfill({ status: 404, body: '' }));
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__ready && window.G?.meta, null, { timeout: 60000 });
    await page.evaluate(() => Object.assign(G.meta, { tutorialDone: true, tipCatch: true, seenVersion: 'v9', hintBattles: 9 }));
    for (const [region, key, foe] of CASES) {
      const info = await page.evaluate(async ([region, key, foe]) => {
        const { Run } = await import('/src/game/run.js');
        const { D } = await import('/src/game/data.js');
        const { makeMon, maxHp } = await import('/src/game/pokemon.js');
        const r = Run.create({ starter: 'CHARMANDER', seed: 'SIZE' + key, world: 'spire', regions: { acts: [region, region, region, region], summit: region, post: region } });
        r.party[0].level = 30; r.party[0].hp = maxHp(r.party[0]);
        G.run = r;
        const t = D.trainers[key];
        const cfg = r.eliteConfigFromTrainer(r.rng, t);
        cfg.enemies = [makeMon(foe, 20, { rng: r.rng })].map(m => Object.assign(cfg.enemies[0], { species: m.species, ivs: m.ivs, level: 20 }));
        window.__flow.startBattle(cfg, null);
        return { pic: t.pic, name: t.name };
      }, [region, key, foe]);
      // the portrait slides in, then out once the foe is sent: shoot it while it's fully in
      await page.waitForFunction(() => { const s = window.__engine.Engine.scene; return s?.trainerX !== undefined && s.trainerX <= 0; }, null, { timeout: 15000 }).catch(() => {});
      await sleep(150);
      await page.screenshot({ path: path.join(OUT, `intro_${region}_${key.toLowerCase()}.png`) });
      await page.waitForFunction(() => window.__engine.Engine.scene?.trainerX >= 140, null, { timeout: 30000 }).catch(() => {});
      await page.waitForFunction(() => { const sc = window.__engine.Engine.scene; if (sc.msg?.cur) sc.msg.cur.auto = 0.01; return sc.enemyDisp?.alpha >= 1 && sc.leadDisp?.alpha >= 1; }, null, { timeout: 30000, polling: 100 }).catch(() => {});
      await sleep(1500);
      await page.screenshot({ path: path.join(OUT, `battle_${region}_${foe.toLowerCase()}_${key.toLowerCase()}.png`) });
      // the portrait's opaque box in its own PNG (drawn at 2x)
      const box = await page.evaluate(async (pic) => {
        const im = new Image(); im.src = `assets/gfx/trainers/${pic}.png`; await im.decode();
        const c = document.createElement('canvas'); c.width = im.width; c.height = im.height;
        const x = c.getContext('2d'); x.drawImage(im, 0, 0);
        const d = x.getImageData(0, 0, c.width, c.height).data;
        let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, n = 0;
        for (let y = 0; y < c.height; y++) for (let xx = 0; xx < c.width; xx++) if (d[(y * c.width + xx) * 4 + 3]) { n++; x0 = Math.min(x0, xx); x1 = Math.max(x1, xx); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
        return { file: `${im.width}x${im.height}`, w: x1 - x0 + 1, h: y1 - y0 + 1, area: n };
      }, info.pic);
      console.log(`${region.padEnd(5)} ${info.name.padEnd(8)} ${info.pic.padEnd(22)} file ${box.file}  figure ${box.w}x${box.h} px (on screen ${box.w * 2}x${box.h * 2}), ${box.area} px`);
    }
  } finally {
    await browser.close(); server.kill();
  }
  if (errors.length) { console.log('ERRORS:\n' + errors.join('\n')); process.exit(1); }
  console.log('wrote', OUT);
})().catch(e => { console.error(e); process.exit(1); });
