// sign-in page recovery (local build against DEV Convex via web/cloud.json; never prod)
const { spawn } = require('child_process');
const path = require('path');
const { chromium } = require('playwright');
const port = 8763, root = path.resolve(__dirname, '..');
(async () => {
  const server = spawn(process.execPath, [path.join(root, 'serve.cjs'), String(port)], { cwd: root, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 700));
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio'] });
  const fails = []; const ok = (c, l, i = '') => { console.log((c ? 'ok   ' : 'FAIL ') + l, i); if (!c) fails.push(l); };
  try {
    const page = await (await browser.newContext()).newPage();
    await page.route('**/cloud.json', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ convexUrl: 'https://elegant-corgi-316.convex.cloud', packs: true }) }));
    const base = `http://localhost:${port}/`;
    const st = () => page.evaluate(() => ({ text: document.getElementById('signin-btn').textContent, disabled: document.getElementById('signin-btn').disabled, err: document.getElementById('signin-error').textContent, verifier: localStorage.getItem('kantospire.authVerifier.v1') }));
    await page.goto(base); await page.evaluate(() => localStorage.clear()); await page.reload();
    await page.waitForSelector('#signin:not([hidden])', { timeout: 30000 });
    let s = await st(); ok(!s.disabled && !s.err, 'fresh: sign-in ready, no error', JSON.stringify(s));
    // back from Google with nothing (cancelled / closed)
    await page.evaluate(() => localStorage.setItem('kantospire.authVerifier.v1', JSON.stringify('abc')));
    await page.reload(); await page.waitForSelector('#signin:not([hidden])');
    s = await st(); ok(/cancelled/i.test(s.err) && !s.verifier, 'returning with no code says cancelled and clears the verifier', JSON.stringify(s));
    // a stale code
    await page.evaluate(() => localStorage.setItem('kantospire.authVerifier.v1', JSON.stringify('abc')));
    await page.goto(base + '?code=bogus'); await page.waitForSelector('#signin:not([hidden])');
    s = await st(); ok(/didn't finish/i.test(s.err) && !page.url().includes('code='), 'a stale code says try again, URL cleaned', JSON.stringify(s));
    // restored from the back-forward cache with the button stuck
    await page.evaluate(() => { const b = document.getElementById('signin-btn'); b.disabled = true; b.textContent = 'Opening Google...'; dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })); });
    s = await st(); ok(!s.disabled && s.text === 'Sign in with Google', 'pageshow (bfcache) resets the button', JSON.stringify(s));
    // the real thing: click through to Google and back
    await page.click('#signin-btn'); await page.waitForURL(/accounts\.google\.com/, { timeout: 20000 });
    await page.goBack(); await page.waitForSelector('#signin:not([hidden])', { timeout: 20000 }); await page.waitForTimeout(500);
    s = await st(); ok(!s.disabled, 'back from Google: can sign in again', JSON.stringify(s));
    await page.click('#signin-btn'); await page.waitForURL(/accounts\.google\.com/, { timeout: 20000 });
    ok(true, 'second attempt reaches Google');
  } catch (e) { ok(false, 'harness', e.message); } finally { await browser.close(); server.kill(); }
  console.log(fails.length ? 'FAILED: ' + fails.length : 'all checks passed');
})();
