// Tiny zero-dependency static file server for Arcania Academy.
//   node server.js                 -> http://localhost:8080
//   PORT=9000 node server.js       -> custom port
//   HOST=0.0.0.0 node server.js    -> expose on LAN (for testing on a phone)
// Can also be imported: `const { server, port } = await startServer({ port: 0 })`.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

function send(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}

function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method Not Allowed');
  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch {
    return send(res, 400, 'Bad Request');
  }
  if (urlPath.endsWith('/')) urlPath += 'index.html';
  // Block dotfiles (.git, .env) and node_modules; block traversal.
  const segments = urlPath.split('/').filter(Boolean);
  if (segments.some((s) => s.startsWith('.') || s === 'node_modules')) return send(res, 404, 'Not Found');
  const filePath = path.resolve(ROOT, '.' + path.posix.normalize('/' + segments.join('/')));
  if (!filePath.startsWith(ROOT + path.sep) && filePath !== ROOT) return send(res, 404, 'Not Found');

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) return send(res, 404, 'Not Found');
    const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': stat.size, 'Cache-Control': 'no-store' });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(filePath).pipe(res);
  });
}

export function startServer({ port = Number(process.env.PORT) || 8080, host = process.env.HOST || '127.0.0.1' } = {}) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    server.once('error', reject);
    server.listen(port, host, () => resolve({ server, port: server.address().port, host }));
  });
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  startServer()
    .then(({ port, host }) => {
      console.log(`Arcania Academy running at http://localhost:${port}`);
      if (host === '0.0.0.0') {
        for (const list of Object.values(os.networkInterfaces())) {
          for (const a of list || []) {
            if (a.family === 'IPv4' && !a.internal) console.log(`  LAN: http://${a.address}:${port}`);
          }
        }
      } else {
        console.log('  (set HOST=0.0.0.0 to test from a phone on your LAN)');
      }
    })
    .catch((err) => {
      console.error('Failed to start server:', err.message);
      process.exit(1);
    });
}
