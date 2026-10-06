// FireRed move-animation lab check: plays moves in web/animlab.html (muted Chrome) and saves frame strips.
//   node tests/anim_lab.cjs [port=8731] [outdir=tests/out/anims] [MOVE,MOVE,...|all-proto] [side=0]
// Prints per move: frames, reason (done/timeout/error), callbacks that are still missing.
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const port = +(process.argv[2] || 8731), out = process.argv[3] || 'tests/out/anims';
const PROTO = 'TACKLE,EMBER,WATER_GUN,VINE_WHIP,THUNDER_SHOCK,QUICK_ATTACK,BITE,FLAMETHROWER,SURF,THUNDERBOLT,PSYCHIC,EARTHQUAKE,HYPER_BEAM,GROWL,TAIL_WHIP,LEER,SAND_ATTACK,THUNDER_WAVE,SLEEP_POWDER,POISON_POWDER,SWORDS_DANCE,POUND,SCRATCH,FACADE,ABSORB,GUST,PECK,METAL_CLAW,HARDEN,ICE_BEAM,ROCK_THROW,KARATE_CHOP,POISON_STING,LEECH_LIFE,ASTONISH';
const moves = (process.argv[4] && process.argv[4] !== 'all-proto' ? process.argv[4] : PROTO).split(',');
const side = +(process.argv[5] || 0);
const root = path.resolve(__dirname, '..');
fs.mkdirSync(out, { recursive: true });

(async () => {
  const server = spawn(process.execPath, [path.join(root, 'serve.cjs'), String(port)], { cwd: root, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 600));
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio'] });
  try {
    const page = await (await browser.newContext({ viewport: { width: 1320, height: 780 } })).newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()); });
    await page.goto(`http://localhost:${port}/animlab.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.animLab, null, { timeout: 30000 });
    const ok = await page.evaluate(() => window.animLab.ready);
    if (!ok) throw new Error('MoveAnims failed to load');
    const status = await page.evaluate(() => window.animLab.status());
    const playable = Object.values(status).filter(v => v === true).length;
    console.log(`playable FireRed move scripts: ${playable}/${Object.keys(status).length}`);
    fs.writeFileSync(path.join(out, 'status.json'), JSON.stringify(status, null, 1));
    for (const mv of moves) {
      const r = await page.evaluate(([m, s]) => window.animLab.strip(m, s, { count: 8, scale: 0.5 }), [mv, side]);
      fs.writeFileSync(path.join(out, `${mv.toLowerCase()}${side ? '_foe' : ''}.png`), Buffer.from(r.url.split(',')[1], 'base64'));
      console.log(`${mv.padEnd(14)} ${status[mv] === true ? 'ok     ' : 'MISSING'} frames=${r.frames} ${r.reason}${r.missing.length ? ' skipped=' + r.missing.join(',') : ''}${r.error && r.error.key === mv ? ' ERROR ' + r.error.err.split('\n')[0] : ''}`);
    }
    if (errors.length) console.log('page errors:\n  ' + [...new Set(errors)].slice(0, 20).join('\n  '));
  } finally { await browser.close(); server.kill(); }
})().catch(e => { console.error(e); process.exit(1); });
