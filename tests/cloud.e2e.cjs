// Cloud gate E2E against a deployment (no Google login needed).
// 1. Every Convex function and GET /pack refuse anonymous callers.
// 2. A signed-out browser gets the plain sign-in page and requests nothing from the ROM.
// 3. With E2E_MINT=1 (dev only): mints a short-lived token for the allowlisted dev user, checks the
//    packs download and match their hashes, and that the game boots with every asset served from
//    memory (the static site has none). The browser's packs come from the shared test cache
//    (tests/pack_cache.cjs) rather than from Convex every run.
// Usage: CONVEX_URL=https://<dev>.convex.cloud node tools/build_site.cjs && node serve.cjs 8091 dist &
//        E2E_MINT=1 node tests/cloud.e2e.cjs
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { execFileSync } = require('child_process');
const { routePacks, packCacheStats } = require('./pack_cache.cjs');
const BASE = process.env.BASE || 'http://localhost:8091/';
const root = path.join(__dirname, '..');
const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) process.exitCode = 1; };

async function mintDevToken(convexUrl) {
  if (!process.env.E2E_DEV_DEPLOYMENT || !convexUrl.includes(process.env.E2E_DEV_DEPLOYMENT)) throw new Error('E2E_MINT only runs against your dev deployment: set E2E_DEV_DEPLOYMENT.');
  const cli = path.join(root, 'node_modules', 'convex', 'bin', 'main.js');
  const run = (...a) => execFileSync(process.execPath, [cli, ...a], { cwd: root, encoding: 'utf8' }).trim();
  const key = run('env', 'get', 'JWT_PRIVATE_KEY');
  const users = JSON.parse(run('run', 'access:list')).map(r => r.email);
  const table = run('data', 'users', '--format', 'jsonArray');
  const user = JSON.parse(table).find(u => users.includes((u.email || '').toLowerCase()));
  if (!user) throw new Error('No allowlisted user on dev.');
  const { SignJWT, importPKCS8 } = await import('jose');
  const pk = await importPKCS8(key.replace(/\\n/g, '\n'), 'RS256');
  return await new SignJWT({ sub: `${user._id}|e2e` }).setProtectedHeader({ alg: 'RS256' }).setIssuedAt()
    .setIssuer(convexUrl.replace('.convex.cloud', '.convex.site')).setAudience('convex').setExpirationTime('10m').sign(pk);
}

(async () => {
  const cfg = JSON.parse(await fetch(BASE + 'cloud.json').then(r => r.text()));
  const convexUrl = cfg.convexUrl, siteUrl = convexUrl.replace('.convex.cloud', '.convex.site');
  ok(cfg.packs === true, 'site build uses gated asset packs');
  for (const p of ['assets/data/species.json', 'assets/gfx/fonts/fonts.json', 'assets/sound/bank.bin']) {
    const r = await fetch(BASE + p);
    // 404, or a host's single-page fallback (index.html) - never the file itself
    ok(r.status === 404 || /text\/html/.test(r.headers.get('content-type') || ''), `static site does not serve ${p} (${r.status} ${r.headers.get('content-type')})`);
  }
  for (const [kind, fn] of [['query', 'runs:leaderboard'], ['query', 'runs:mine'], ['query', 'players:top'], ['query', 'progress:get'], ['query', 'packs:manifest'],
    ['mutation', 'players:me'], ['mutation', 'progress:save'], ['mutation', 'progress:put'], ['mutation', 'runs:submit'], ['mutation', 'runlogs:submit'], ['mutation', 'access:allow'], ['query', 'access:list'], ['mutation', 'packs:uploadUrl'],
    ['mutation', 'coop:create'], ['mutation', 'coop:join'], ['query', 'coop:mine'], ['mutation', 'coopTest:ensureTestUser']]) {
    const args = fn === 'progress:save' ? { meta: '{}', run: null } : fn === 'access:allow' ? { email: 'x@example.com' } : fn === 'runlogs:submit' ? { clientRunId: 'x', log: '{}' }
      : fn === 'coop:join' ? { code: 'ABCDE' } : fn === 'coopTest:ensureTestUser' ? { email: 'x@example.com', name: 'X' } : {};
    const r = await fetch(`${convexUrl}/api/${kind}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: fn, args, format: 'json' }) }).then(r => r.json());
    ok(r.status === 'error', `anonymous ${fn} is refused`);
  }
  // ...including with the records screen's version filter
  for (const fn of ['runs:leaderboard', 'runs:mine', 'players:top']) {
    const r = await fetch(`${convexUrl}/api/query`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: fn, args: { version: 'v0.0.2' }, format: 'json' }) }).then(r => r.json());
    ok(r.status === 'error', `anonymous ${fn} with a version filter is refused`);
  }
  ok((await fetch(`${siteUrl}/pack?name=gfx`)).status === 401, 'anonymous GET /pack is refused');
  ok((await fetch(`${siteUrl}/pack?name=gfx`, { headers: { Authorization: 'Bearer not-a-token' } })).status === 401, 'GET /pack with a bogus token is refused');

  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [], assetReqs = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', r => { if (/\/assets\//.test(new URL(r.url()).pathname) && r.url().startsWith(BASE)) assetReqs.push(r.url()); });
  await page.goto(BASE);
  await page.waitForFunction(() => window.__ready, null, { timeout: 30000 });
  ok(await page.isVisible('#signin') && !(await page.isVisible('#game')), 'signed-out browser shows the plain sign-in page');
  ok(assetReqs.length === 0, `signed out, nothing is requested from assets/ (${assetReqs.length})`);
  fs.mkdirSync(path.join(__dirname, 'out'), { recursive: true });
  await page.screenshot({ path: path.join(__dirname, 'out', 'cloud_signin.png') });
  // An invite link shows the invite message and the code leaves the address bar (kept for after sign-in).
  const pi = await browser.newPage();
  await pi.goto(BASE + '?invite=testcode123');
  await pi.waitForFunction(() => window.__ready, null, { timeout: 30000 });
  ok(/invited/i.test(await pi.textContent('#signin-msg')) && !pi.url().includes('invite='), 'invite link: message shown, code kept out of the URL');
  ok((await pi.evaluate(() => localStorage.getItem('kantospire.invite.v1'))) === '"testcode123"', 'invite code saved for after the Google redirect');
  await pi.close();

  if (process.env.E2E_MINT) {
    const token = await mintDevToken(convexUrl);
    const list = await fetch(`${convexUrl}/api/query`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ path: 'packs:manifest', args: {}, format: 'json' }) }).then(r => r.json());
    ok(list.status === 'success' && list.value.length >= 3, `allowed user gets the pack list (${list.value?.map(p => p.name).join(',')})`);
    // (the smallest pack, to keep test egress down)
    const one = list.value?.filter(p => p.zsize).sort((a, b) => a.zsize - b.zsize)[0] || list.value?.sort((a, b) => a.size - b.size)[0];
    const res = await fetch(`${siteUrl}/pack?name=${one.name}&h=${one.hash}&enc=gzip`, { headers: { Authorization: `Bearer ${token}`, Origin: BASE.replace(/\/$/, '') } });
    let buf = Buffer.from(await res.arrayBuffer());
    const zipped = res.headers.get('x-pack-enc') === 'gzip';
    if (zipped) buf = require('zlib').gunzipSync(buf);
    ok(res.status === 200 && crypto.createHash('sha256').update(buf).digest('hex') === one?.hash, `allowed user downloads a pack that matches its hash (${one.name}${zipped ? ', gzipped' : ''})`);
    ok(res.headers.get('access-control-allow-origin') === BASE.replace(/\/$/, ''), 'pack response allows the game origin (CORS)');
    ok(/immutable/.test(res.headers.get('cache-control') || '') && /X-Pack-Enc/.test(res.headers.get('access-control-expose-headers') || ''), `a pack asked for by hash may be cached for good (${res.headers.get('cache-control')})`);
    // clients from before v0.3.21 ask by name only: the plain pack, never cached
    const old = await fetch(`${siteUrl}/pack?name=${one.name}`, { headers: { Authorization: `Bearer ${token}` } });
    const oldBuf = Buffer.from(await old.arrayBuffer());
    ok(old.status === 200 && crypto.createHash('sha256').update(oldBuf).digest('hex') === one.hash && /no-store/.test(old.headers.get('cache-control') || ''), 'an older client (name only) still gets the plain pack, uncached');

    const p2 = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const err2 = [], req2 = [];
    p2.on('pageerror', e => err2.push(e.message));
    p2.on('request', r => { if (/\/assets\//.test(new URL(r.url()).pathname) && r.url().startsWith(BASE)) req2.push(r.url()); });
    await p2.addInitScript(t => localStorage.setItem('kantospire.auth.v1', JSON.stringify({ token: t, refreshToken: 'e2e' })), token);
    await routePacks(p2); // (packs from the shared test cache: tests/pack_cache.cjs)
    await p2.goto(BASE);
    await p2.waitForFunction(() => window.__ready, null, { timeout: 60000 });
    const scene = await p2.evaluate(() => window.__engine.Engine.scene?.constructor?.name);
    ok(scene === 'TitleScene', `signed-in browser boots the game (${scene})`);
    const fontOk = await p2.evaluate(async () => (await fetch('assets/gfx/fonts/fonts.json')).ok);
    ok(fontOk, 'game reads assets from the downloaded packs');
    ok(req2.length === 0, `no asset request reached the static site (${req2.length})`);
    await p2.waitForTimeout(1500);
    await p2.screenshot({ path: path.join(__dirname, 'out', 'cloud_title.png') });
    ok(err2.length === 0, 'no page errors when signed in ' + err2.join(' | '));
    console.log(`  (pack cache: ${packCacheStats.hits} hits, ${packCacheStats.misses} downloads, ${(packCacheStats.bytes / 1048576).toFixed(2)} MB)`);

    // Take the account off the allowlist: the same valid token must now be refused, then restore it.
    const cli = path.join(root, 'node_modules', 'convex', 'bin', 'main.js');
    const run = (...a) => execFileSync(process.execPath, [cli, ...a], { cwd: root, encoding: 'utf8' }).trim();
    const emails = JSON.parse(run('run', 'access:list'));
    try {
      for (const e of emails) run('run', 'access:revoke', JSON.stringify({ email: e.email }));
      ok((await fetch(`${siteUrl}/pack?name=data`, { headers: { Authorization: `Bearer ${token}` } })).status === 403, 'removed from the allowlist: GET /pack is refused (403)');
      const me = await fetch(`${convexUrl}/api/mutation`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ path: 'players:me', args: {}, format: 'json' }) }).then(r => r.json());
      ok(me.status === 'error', 'removed from the allowlist: functions refuse the account');
    } finally {
      for (const e of emails) { run('run', 'access:allow', JSON.stringify({ email: e.email, note: e.note })); if (e.admin) run('run', 'access:setAdmin', JSON.stringify({ email: e.email, admin: true })); }
    }
    ok(JSON.parse(run('run', 'access:list')).length === emails.length, 'allowlist restored');
  }
  ok(errors.length === 0, 'no page errors ' + errors.join(' | '));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
