// Builds dist/: the static game WITHOUT the extracted ROM assets, plus cloud.json for the prod Convex
// deployment. The assets are uploaded separately (node tools/upload_packs.cjs --prod) and only served
// to signed-in, allowlisted accounts.
// Usage: CONVEX_URL=https://<prod>.convex.cloud node tools/build_site.cjs
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'), out = path.join(root, 'dist'), web = path.join(root, 'web');
const url = process.env.CONVEX_URL;
if (!url || !/^https:\/\//.test(url)) { console.error('Set CONVEX_URL to the production https://….convex.cloud URL.'); process.exit(1); }
// Empty dist/ rather than deleting it (Windows refuses while anything has it open).
fs.mkdirSync(out, { recursive: true });
for (const e of fs.readdirSync(out)) fs.rmSync(path.join(out, e), { recursive: true, force: true });
const skip = s => {
  const rel = path.relative(web, s).split(path.sep).join('/');
  return rel === 'assets' || rel.startsWith('assets/') || rel === 'cloud.json' || /(audio-test|animlab|gen4lab)\.html$/.test(rel);
};
fs.cpSync(web, out, { recursive: true, dereference: true, filter: s => !skip(s) });
fs.writeFileSync(path.join(out, 'cloud.json'), JSON.stringify({ convexUrl: url, packs: true }, null, 2) + '\n');
// Belt and braces: the hosted site must not contain any ROM-derived files.
const leaked = [];
(function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else if (/\.(png|bin|wav)$/i.test(e.name) || /[\\/]assets[\\/]/.test(f)) leaked.push(f); } })(out);
if (leaked.length) { console.error('dist/ contains asset files:', leaked.slice(0, 5)); process.exit(1); }
console.log('built', out, '(no assets; run tools/upload_packs.cjs --prod for those)');
