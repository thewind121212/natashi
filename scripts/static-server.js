const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.STATIC_PORT || 5173);
const ROOT = process.env.STATIC_ROOT || path.join(__dirname, '..', 'app', 'public');

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
};

const server = http.createServer((req, res) => {
  const urlPath = new URL(req.url, `http://${req.headers.host}`).pathname;
  const safePath = path.normalize(urlPath).replace(/^\.\.(\/|\\)/, '');
  let filePath = path.join(ROOT, safePath);

  const sendFile = (targetPath) => {
    fs.readFile(targetPath, (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not found');
        return;
      }
      const ext = path.extname(targetPath).toLowerCase();
      const type = mimeTypes[ext] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': type });
      res.end(data);
    });
  };

  fs.stat(filePath, (err, stat) => {
    if (!err && stat.isFile()) {
      return sendFile(filePath);
    }
    if (!err && stat.isDirectory()) {
      filePath = path.join(filePath, 'index.html');
      return sendFile(filePath);
    }
    return sendFile(path.join(ROOT, 'index.html'));
  });
});

const HOST = process.env.STATIC_HOST || '0.0.0.0';
server.listen(PORT, HOST, () => {
  console.log(`[Static] Serving ${ROOT} on http://${HOST}:${PORT}`);
});
