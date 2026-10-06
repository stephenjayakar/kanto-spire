// Co-op test accounts on your DEV deployment only. Set E2E_DEV_DEPLOYMENT to its name (e.g. happy-animal-123)
// and E2E_P1_EMAIL to an allowlisted account on it.
// Needs the dev deployment to have COOP_TEST=1 (convex/coopTest.ts refuses otherwise):
//   node node_modules/convex/bin/main.js env set COOP_TEST 1
// Exports:
//   CONVEX_URL, P1_EMAIL, P2_EMAIL, P2_NAME
//   ensureTestUser(email, name) -> userId        (users + allowedEmails rows, idempotent)
//   mintToken(email, ttl = '30m') -> JWT          (signed with dev JWT_PRIVATE_KEY, like mintDevToken in cloud.e2e.cjs)
//   cleanup(emails)                               (deletes their co-op rooms; deletes test users, never P1_EMAIL)
//   cleanupRooms(roomIds)                         (deletes just those rooms + members + actions)
//   callConvex(token, kind, path, args) -> value  (throws Error(message) on a Convex error; token may be null)
//   convexRaw(token, kind, path, args) -> { status, value?, errorMessage? }
//   cli(...args) -> stdout of the Convex CLI run in the repo root
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const P1_EMAIL = process.env.E2E_P1_EMAIL || 'player1@example.com';
const P2_EMAIL = 'coop-tester@kanto-spire.test';
const P2_NAME = 'TESTER';
const DEV_RE = process.env.E2E_DEV_DEPLOYMENT ? new RegExp(process.env.E2E_DEV_DEPLOYMENT) : /^$/; // matches nothing unless set

function readEnvUrl() {
  if (process.env.CONVEX_URL) return process.env.CONVEX_URL.replace(/\/$/, '');
  try {
    const m = /^CONVEX_URL=(\S+)/m.exec(fs.readFileSync(path.join(root, '.env.local'), 'utf8'));
    if (m) return m[1].replace(/\/$/, '');
  } catch {}
  return process.env.E2E_DEV_DEPLOYMENT ? `https://${process.env.E2E_DEV_DEPLOYMENT}.convex.cloud` : '';
}
const CONVEX_URL = readEnvUrl();

function assertDev() {
  if (!DEV_RE.test(CONVEX_URL)) throw new Error(`co-op test helpers only run against your dev deployment: set E2E_DEV_DEPLOYMENT (got ${CONVEX_URL})`);
}

function cli(...args) {
  assertDev();
  if (args.includes('--prod')) throw new Error('refusing --prod');
  return execFileSync(process.execPath, [path.join(root, 'node_modules', 'convex', 'bin', 'main.js'), ...args], {
    cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

const runFn = (fn, args) => {
  const out = cli('run', fn, JSON.stringify(args || {}));
  try { return JSON.parse(out); } catch { return out; }
};

function ensureTestUser(email, name) {
  return runFn('coopTest:ensureTestUser', { email, name: name || email.split('@')[0].toUpperCase() });
}

function cleanup(emails) { return runFn('coopTest:cleanup', { emails }); }
function cleanupRooms(roomIds) { return roomIds.length ? runFn('coopTest:cleanupRooms', { roomIds }) : { rooms: 0, actions: 0 }; }

let keyCache = null;
async function mintToken(email, ttl = '30m') {
  assertDev();
  const want = email.trim().toLowerCase();
  const users = JSON.parse(cli('data', 'users', '--format', 'jsonArray', '--limit', '1000'));
  const user = users.find(u => (u.email || '').toLowerCase() === want);
  if (!user) throw new Error(`No user ${email} on dev (run ensureTestUser first).`);
  keyCache ??= cli('env', 'get', 'JWT_PRIVATE_KEY');
  const { SignJWT, importPKCS8 } = await import('jose');
  const pk = await importPKCS8(keyCache.replace(/\\n/g, '\n'), 'RS256');
  return await new SignJWT({ sub: `${user._id}|e2e` }).setProtectedHeader({ alg: 'RS256' }).setIssuedAt()
    .setIssuer(CONVEX_URL.replace('.convex.cloud', '.convex.site')).setAudience('convex').setExpirationTime(ttl).sign(pk);
}

async function convexRaw(token, kind, fnPath, args) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${CONVEX_URL}/api/${kind}`, { method: 'POST', headers, body: JSON.stringify({ path: fnPath, args: args || {}, format: 'json' }) });
  return await res.json().catch(() => ({ status: 'error', errorMessage: `HTTP ${res.status}` }));
}

async function callConvex(token, kind, fnPath, args) {
  const body = await convexRaw(token, kind, fnPath, args);
  if (body.status !== 'success') {
    const m = /Uncaught Error: ([^\n]*)/.exec(body.errorMessage || '');
    const e = new Error(m ? m[1] : body.errorMessage || body.message || 'Request failed');
    e.raw = body.errorMessage;
    throw e;
  }
  return body.value;
}

module.exports = { CONVEX_URL, P1_EMAIL, P2_EMAIL, P2_NAME, ensureTestUser, mintToken, cleanup, cleanupRooms, callConvex, convexRaw, cli };
