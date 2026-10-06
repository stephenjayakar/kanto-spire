// Writes web/cloud.json from CONVEX_URL (env) or .env.local, so the game knows which Convex deployment to use.
const fs = require('fs'), path = require('path');
let url = process.env.CONVEX_URL;
const envFile = path.join(__dirname, '..', '.env.local');
if (!url && fs.existsSync(envFile)) url = (/^CONVEX_URL=(.*)$/m.exec(fs.readFileSync(envFile, 'utf8')) || [])[1]?.trim();
if (!url) { console.error('No CONVEX_URL in env or .env.local; run `npx convex dev` first.'); process.exit(1); }
fs.writeFileSync(path.join(__dirname, '..', 'web', 'cloud.json'), JSON.stringify({ convexUrl: url }, null, 2) + '\n');
console.log('web/cloud.json ->', url);
