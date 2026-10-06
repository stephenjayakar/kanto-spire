// Tiny static server: node serve.cjs [port] [dir]  -> http://localhost:8080/ (dir defaults to web/)
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, process.argv[3] || 'web');
const port = +process.argv[2] || 8080;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.bin': 'application/octet-stream', '.css': 'text/css', '.wav': 'audio/wav' };
http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(root, p);
  if (!f.startsWith(root)) { res.writeHead(403); return res.end(); }
  fs.readFile(f, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}).listen(port, () => console.log(`Kanto Spire at http://localhost:${port}/`));
