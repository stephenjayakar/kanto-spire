// Stress test for the ?coopdev mock backend (localStorage, shared by the tabs of one browser context): N pages post
// actions at the same time; every action must get its own seq (no lost or duplicated writes).
//   node tests/mock_race.cjs [port=8151] [pages=4] [posts=40]
const { spawn } = require('child_process');
const path = require('path');
const { chromium } = require('playwright');
const PORT = +(process.argv[2] || 8151), N = +(process.argv[3] || 4), POSTS = +(process.argv[4] || 40);
const ROOT = path.resolve(__dirname, '..');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
(async () => {
  const server = spawn(process.execPath, [path.join(ROOT, 'serve.cjs'), String(PORT)], { cwd: ROOT, stdio: 'ignore' });
  await sleep(600);
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio'] });
  let bad = 0;
  try {
    const ctx = await browser.newContext();
    const pages = [];
    for (let i = 0; i < N; i++) { const p = await ctx.newPage(); await p.goto(`http://localhost:${PORT}/audio-test.html?coopdev=P${i}`); pages.push(p); }
    await pages[0].evaluate(() => localStorage.clear());
    const mods = '/src/scenes/coop/mocknet.js';
    const { roomId, code } = await pages[0].evaluate(async (m) => { const net = await import(m); return net.createRoom({}); }, mods);
    for (const p of pages.slice(1)) await p.evaluate(async ([m, code]) => { const net = await import(m); return net.joinRoom(code); }, [mods, code]);
    for (const p of pages) await p.evaluate(async ([m, id]) => { const net = await import(m); await net.setStarter(id, 'CHARMANDER'); }, [mods, roomId]);
    await pages[0].evaluate(async ([m, id]) => { const net = await import(m); await net.startRoom(id); }, [mods, roomId]);
    await Promise.all(pages.map((p, i) => p.evaluate(async ([m, id, i, n]) => {
      const net = await import(m);
      await Promise.all(Array.from({ length: n }, (_, k) => net.postAction(id, { type: 'chat', nonce: `p${i}k${k}` })));
    }, [mods, roomId, i, POSTS])));
    await sleep(500);
    const acts = await pages[0].evaluate(async ([m, id]) => { const net = await import(m); const out = []; let after = 0; for (;;) { const r = await net.fetchSince(id, after); out.push(...r.actions); if (!r.more || !r.actions.length) break; after = r.actions[r.actions.length - 1].seq; } return out; }, [mods, roomId]);
    const seqs = acts.map(a => a.seq), nonces = new Set(acts.map(a => a.nonce));
    const want = N * POSTS + 1;
    const dupSeq = seqs.length - new Set(seqs).size;
    console.log(`actions stored ${acts.length} / ${want}, distinct nonces ${nonces.size}, duplicate seqs ${dupSeq}`);
    if (acts.length !== want || dupSeq || nonces.size !== want) bad++;
    // every page must see the same log
    const views = await Promise.all(pages.map(p => p.evaluate(async ([m, id]) => { const net = await import(m); const r = await net.fetchSince(id, 0); return r.actions.map(a => a.seq + ':' + a.nonce).join(','); }, [mods, roomId])));
    if (views.some(v => v !== views[0])) { console.log('pages see different logs'); bad++; }
  } finally { await browser.close(); server.kill(); }
  console.log(bad ? 'FAIL' : 'ok: no lost or duplicated actions');
  process.exit(bad ? 1 : 0);
})();
