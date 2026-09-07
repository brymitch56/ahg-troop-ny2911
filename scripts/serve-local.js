// Tiny static server for local testing of the leaders pages
// (node scripts/serve-local.js → http://127.0.0.1:8080). Dev only.
const http = require('http');
const fs = require('fs');
const path = require('path');
const rootDir = path.join(__dirname, '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.ics': 'text/calendar', '.svg': 'image/svg+xml', '.webp': 'image/webp' };
http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html');
  const p = path.normalize(path.join(rootDir, rel));
  if (!p.startsWith(rootDir)) { res.writeHead(403); res.end(); return; }
  fs.readFile(p, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(p).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(8080, '127.0.0.1', () => console.log('Leaders pages at http://127.0.0.1:8080/leaders-badges.html'));
