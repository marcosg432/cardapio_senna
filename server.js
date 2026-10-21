/**
 * Servidor estático + API SQLite local - Candy Li Doces Finos
 * Requer Node.js ≥ 22.13 (módulo nativo node:sqlite; sem MySQL e sem dependência npm do BD).
 *
 * Use sempre esta origem para site + /admin (mesmo localStorage):
 *   http://localhost:3003/
 *   http://localhost:3003/admin/
 *
 * Inicie com: npm start  (porta: PORT=8080 npm start se quiser outra)
 * Abrir site + admin no navegador: npm run open:all
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { handleApi } = require('./server/api');
const auth = require('./server/auth');

let apiDbReady = false;
try {
  require('./database/db').getDb();
  apiDbReady = true;
} catch (e) {
  console.warn('SQLite indisponível — /api/* retornará 503; site estático continua:', e.message);
}

const PORT = Number(process.env.PORT) || 3003;
const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp'
};

const ROOT = process.cwd();

const PASTAS_INTERNAS = ['database', 'server', 'scripts', 'node_modules'];

function urlPermitida(urlPath) {
  let texto = String(urlPath || '/');
  try {
    texto = decodeURIComponent(texto);
  } catch (e) {
    return false;
  }
  texto = texto.replace(/\\/g, '/').toLowerCase();
  if (texto.indexOf('\0') !== -1) return false;
  const partes = texto.split('/').filter(Boolean);
  if (partes.some((p) => p === '.' || p === '..' || p.charAt(0) === '.')) return false;
  if (partes.length && PASTAS_INTERNAS.indexOf(partes[0]) !== -1) return false;
  const nome = partes.length ? partes[partes.length - 1] : '';
  if (nome.endsWith('.sqlite') || nome.endsWith('.sqlite-wal') || nome.endsWith('.sqlite-shm')) return false;
  if (nome === '.env' || nome.indexOf('.env.') === 0) return false;
  return true;
}

function arquivoProibido(filePath) {
  const relativo = path.relative(ROOT, filePath);
  if (!relativo || relativo.startsWith('..') || path.isAbsolute(relativo)) return true;
  const partes = relativo.split(/[\\/]/).filter(Boolean);
  if (!partes.length) return true;
  if (PASTAS_INTERNAS.indexOf(partes[0].toLowerCase()) !== -1) return true;
  if (partes.some((p) => p.charAt(0) === '.')) return true;
  const nome = partes[partes.length - 1].toLowerCase();
  if (nome.endsWith('.sqlite') || nome.endsWith('.sqlite-wal') || nome.endsWith('.sqlite-shm')) return true;
  if (nome === '.env' || nome.indexOf('.env.') === 0) return true;
  return false;
}

function resolveFilePath(urlPathname) {
  let rel = urlPathname.split('?')[0] || '/';
  if (rel === '/' || rel === '') {
    return path.join(ROOT, 'index.html');
  }
  const filePath = path.resolve(ROOT, rel.replace(/^[/\\]+/, ''));
  const relativo = path.relative(ROOT, filePath);
  if (relativo.startsWith('..') || path.isAbsolute(relativo)) return null;
  return filePath;
}

function sendFile(res, filePath, extraHeaders) {
  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404);
        res.end('Arquivo não encontrado');
      } else {
        res.writeHead(500);
        res.end('Erro do servidor');
      }
      return;
    }
    const ext = path.extname(filePath);
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, Object.assign({ 'Content-Type': contentType }, extraHeaders || {}));
    res.end(content);
  });
}

function paginaAdminPrivada(urlPath) {
  const p = String(urlPath || '').replace(/\\/g, '/').toLowerCase();
  if (!p.startsWith('/admin')) return false;
  if (p === '/admin' || p === '/admin/' || p === '/admin/index.html') return false;
  return true;
}

function cabecalhosSemCache(urlPath) {
  if (
    urlPath.startsWith('/admin') ||
    urlPath === '/js/config.js' ||
    urlPath === '/js/admin-common.js' ||
    urlPath.startsWith('/js/gestao/')
  ) {
    return { 'Cache-Control': 'no-store' };
  }
  return null;
}

const server = http.createServer((req, res) => {
  const urlPath = new URL(req.url || '/', 'http://localhost').pathname;
  /* /admin sem barra final quebra links relativos (orcamento.html vai para a raiz) */
  if (urlPath === '/admin') {
    res.writeHead(302, { Location: '/admin/' + (new URL(req.url || '/', 'http://localhost').search || '') });
    res.end();
    return;
  }
  if (urlPath.startsWith('/api/')) {
    handleApi(req, res, urlPath, apiDbReady);
    return;
  }
  if (!urlPermitida(urlPath)) {
    res.writeHead(404, { 'Cache-Control': 'no-store' });
    res.end('Arquivo não encontrado');
    return;
  }
  if (paginaAdminPrivada(urlPath) && !auth.temSessaoValida(req)) {
    res.writeHead(302, { Location: '/admin/', 'Cache-Control': 'no-store' });
    res.end();
    return;
  }
  let filePath = resolveFilePath(urlPath);
  const extraHeaders = cabecalhosSemCache(urlPath);

  if (!filePath || arquivoProibido(filePath)) {
    res.writeHead(404, { 'Cache-Control': 'no-store' });
    res.end('Arquivo não encontrado');
    return;
  }

  fs.stat(filePath, (err, st) => {
    if (!err && st.isDirectory()) {
      const indexPath = path.join(filePath, 'index.html');
      if (arquivoProibido(indexPath)) {
        res.writeHead(404, { 'Cache-Control': 'no-store' });
        res.end('Arquivo não encontrado');
        return;
      }
      return sendFile(res, indexPath, extraHeaders);
    }
    if (!err && st.isFile()) {
      return sendFile(res, filePath, extraHeaders);
    }
    if (!path.extname(filePath)) {
      const withHtml = filePath + '.html';
      if (arquivoProibido(withHtml)) {
        res.writeHead(404, { 'Cache-Control': 'no-store' });
        res.end('Arquivo não encontrado');
        return;
      }
      fs.stat(withHtml, (e2, st2) => {
        if (!e2 && st2.isFile()) {
          return sendFile(res, withHtml, extraHeaders);
        }
        res.writeHead(404);
        res.end('Arquivo não encontrado');
      });
      return;
    }
    res.writeHead(404);
    res.end('Arquivo não encontrado');
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Candy Li Doces Finos — use esta origem para site e admin (mesmo localStorage):`);
  console.log(`  http://localhost:${PORT}/`);
  console.log(`  http://localhost:${PORT}/admin/`);
  if (apiDbReady) {
    console.log(`  API + SQLite: http://localhost:${PORT}/api/orcamentos`);
  }
});
