// Capa 3 — Servidor estático para previsualizar el sitio en local.
//
// Hace falta porque la página lee los datos con fetch(), y fetch() está
// bloqueado si abres index.html con doble clic (protocolo file://).
// Uso: node execution/serve.mjs [puerto]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const raiz = process.cwd();
const puerto = Number(process.argv[2]) || 8765;
const TIPOS = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
};

http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  let destino = path.join(raiz, url === '/' ? 'index.html' : url);
  // Nunca servir fuera de la carpeta del proyecto
  if (!destino.startsWith(raiz)) { res.writeHead(403).end('403'); return; }
  if (fs.existsSync(destino) && fs.statSync(destino).isDirectory()) {
    destino = path.join(destino, 'index.html');
  }
  fs.readFile(destino, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('404: ' + url); return; }
    res.writeHead(200, {
      'Content-Type': TIPOS[path.extname(destino).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(buf);
  });
}).listen(puerto, '127.0.0.1', () => {
  console.log(`Sirviendo ${raiz}\n  http://127.0.0.1:${puerto}/`);
});
