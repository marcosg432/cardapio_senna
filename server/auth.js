/**
 * Sessão administrativa no servidor.
 * O navegador guarda só um cookie HttpOnly. A senha não volta para o frontend.
 */
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { getDb } = require('../database/db');

const COOKIE = 'cl_sessao';
const SESSION_MS = 12 * 60 * 60 * 1000;
const MAX_FALHAS = 5;
const BLOQUEIO_MS = 15 * 60 * 1000;
const MAX_FALHAS_IP = 20;
const BCRYPT_COST = 12;

const falhasPorIp = new Map();

function sendJson(res, status, obj, extraHeaders) {
  const headers = Object.assign({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  }, extraHeaders || {});
  res.writeHead(status, headers);
  res.end(status === 204 ? '' : JSON.stringify(obj || {}));
}

function cookiesDe(req) {
  const out = {};
  const header = req.headers.cookie || '';
  header.split(';').forEach((parte) => {
    const i = parte.indexOf('=');
    if (i < 0) return;
    const chave = parte.slice(0, i).trim();
    let valor = parte.slice(i + 1).trim();
    try {
      valor = decodeURIComponent(valor);
    } catch (e) {
      /* valor cru */
    }
    if (chave) out[chave] = valor;
  });
  return out;
}

function pedidoHttps(req) {
  if (process.env.COOKIE_SECURE === '1') return true;
  if (process.env.COOKIE_SECURE === '0') return false;
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  return proto === 'https' || req.socket.encrypted === true;
}

function atributosCookie(req, maxAge) {
  const partes = ['Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=' + String(maxAge)];
  if (pedidoHttps(req)) partes.push('Secure');
  return partes.join('; ');
}

function cabecalhoSessao(req, token) {
  const valor = token ? COOKIE + '=' + encodeURIComponent(token) : COOKIE + '=';
  const idade = token ? Math.floor(SESSION_MS / 1000) : 0;
  return valor + '; ' + atributosCookie(req, idade);
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function ipDe(req) {
  return String(req.socket.remoteAddress || '');
}

function ipBloqueado(ip) {
  const info = falhasPorIp.get(ip);
  if (!info) return false;
  if (info.ate && info.ate > Date.now()) return true;
  if (info.ate && info.ate <= Date.now()) falhasPorIp.delete(ip);
  return false;
}

function registrarFalhaIp(ip) {
  const info = falhasPorIp.get(ip) || { n: 0, ate: 0 };
  info.n += 1;
  if (info.n >= MAX_FALHAS_IP) info.ate = Date.now() + BLOQUEIO_MS;
  falhasPorIp.set(ip, info);
}

function limparFalhaIp(ip) {
  falhasPorIp.delete(ip);
}

function origemConfiavel(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  let url;
  try {
    url = new URL(origin);
  } catch (e) {
    return false;
  }
  return url.host === req.headers.host;
}

function lerCorpoLimitado(req, limite, callback) {
  const chunks = [];
  let tamanho = 0;
  let estourou = false;
  req.on('data', (parte) => {
    if (estourou) return;
    tamanho += parte.length;
    if (tamanho > limite) {
      estourou = true;
      return;
    }
    chunks.push(parte);
  });
  req.on('end', () => {
    if (estourou) return callback(new Error('limite'));
    const raw = Buffer.concat(chunks).toString('utf8');
    if (!raw.trim()) return callback(null, null);
    try {
      callback(null, JSON.parse(raw));
    } catch (e) {
      callback(e);
    }
  });
}

function limparSessoesVencidas(db) {
  db.prepare('DELETE FROM admin_sessoes WHERE expira_em <= ?').run(new Date().toISOString());
}

function resolverSessao(req) {
  const token = cookiesDe(req)[COOKIE];
  if (!token || token.length < 20) return null;
  const db = getDb();
  limparSessoesVencidas(db);
  const row = db.prepare(`
    SELECT s.id, s.usuario_id, s.csrf_token, s.expira_em, u.ativo
    FROM admin_sessoes s
    JOIN admin_usuarios u ON u.id = s.usuario_id
    WHERE s.token_hash = ?
  `).get(hashToken(token));
  if (!row || Number(row.ativo) !== 1) {
    if (row) db.prepare('DELETE FROM admin_sessoes WHERE id = ?').run(row.id);
    return null;
  }
  if (new Date(row.expira_em).getTime() <= Date.now()) {
    db.prepare('DELETE FROM admin_sessoes WHERE id = ?').run(row.id);
    return null;
  }
  return row;
}

function temSessaoValida(req) {
  try {
    return !!resolverSessao(req);
  } catch (e) {
    return false;
  }
}

function csrfConfere(recebido, esperado) {
  const a = Buffer.from(String(recebido || ''));
  const b = Buffer.from(String(esperado || ''));
  if (!a.length || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function exigirAdmin(req, res, opcoes) {
  let sessao;
  try {
    sessao = resolverSessao(req);
  } catch (e) {
    sendJson(res, 503, { erro: 'Não foi possível concluir a operação.' });
    return false;
  }
  if (!sessao) {
    sendJson(res, 401, { erro: 'Acesso não autorizado.' });
    return false;
  }
  if (opcoes && opcoes.csrf) {
    if (!origemConfiavel(req) || !csrfConfere(req.headers['x-csrf-token'], sessao.csrf_token)) {
      sendJson(res, 403, { erro: 'Não foi possível concluir a operação.' });
      return false;
    }
  }
  return true;
}

function criarSessao(db, usuarioId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const csrf = crypto.randomBytes(32).toString('base64url');
  const expira = new Date(Date.now() + SESSION_MS).toISOString();
  db.prepare(`
    INSERT INTO admin_sessoes (usuario_id, token_hash, csrf_token, expira_em)
    VALUES (?, ?, ?, ?)
  `).run(usuarioId, hashToken(token), csrf, expira);
  return { token: token, csrf: csrf };
}

function usuarioAtivo(db) {
  return db.prepare(`
    SELECT id, senha_hash, falhas, bloqueado_ate
    FROM admin_usuarios
    WHERE ativo = 1
    ORDER BY id
    LIMIT 1
  `).get();
}

function responderLogin(req, res, status, corpo, token) {
  const extra = {};
  if (typeof token === 'string') extra['Set-Cookie'] = cabecalhoSessao(req, token);
  sendJson(res, status, corpo, extra);
}

function processarLogin(req, res, senha) {
  const ip = ipDe(req);
  if (ipBloqueado(ip)) {
    responderLogin(req, res, 429, { erro: 'Muitas tentativas. Tente novamente mais tarde.' });
    return;
  }
  const db = getDb();
  const usuario = usuarioAtivo(db);
  if (usuario && usuario.bloqueado_ate && new Date(usuario.bloqueado_ate).getTime() > Date.now()) {
    responderLogin(req, res, 429, { erro: 'Muitas tentativas. Tente novamente mais tarde.' });
    return;
  }
  const hash = usuario ? usuario.senha_hash : bcrypt.hashSync('comparacao-sem-usuario', BCRYPT_COST);
  const ok = typeof senha === 'string' && senha.length > 0 && bcrypt.compareSync(senha, hash);
  if (!usuario || !ok) {
    registrarFalhaIp(ip);
    if (usuario) {
      const falhas = Number(usuario.falhas || 0) + 1;
      const bloqueado = falhas >= MAX_FALHAS ? new Date(Date.now() + BLOQUEIO_MS).toISOString() : null;
      db.prepare('UPDATE admin_usuarios SET falhas = ?, bloqueado_ate = ? WHERE id = ?')
        .run(falhas, bloqueado, usuario.id);
      if (falhas >= MAX_FALHAS) {
        responderLogin(req, res, 429, { erro: 'Muitas tentativas. Tente novamente mais tarde.' });
        return;
      }
    }
    responderLogin(req, res, 401, { erro: 'Credenciais inválidas.' });
    return;
  }
  limparFalhaIp(ip);
  db.prepare('UPDATE admin_usuarios SET falhas = 0, bloqueado_ate = NULL WHERE id = ?').run(usuario.id);
  db.prepare('DELETE FROM admin_sessoes WHERE usuario_id = ?').run(usuario.id);
  const sessao = criarSessao(db, usuario.id);
  responderLogin(req, res, 200, { ok: true, csrfToken: sessao.csrf }, sessao.token);
}

function handleAuth(req, res, pathname) {
  if (!origemConfiavel(req)) {
    sendJson(res, 403, { erro: 'Não foi possível concluir a operação.' });
    return;
  }
  if (pathname === '/api/auth/sessao' && req.method === 'GET') {
    try {
      const sessao = resolverSessao(req);
      if (!sessao) return sendJson(res, 200, { autenticado: false });
      return sendJson(res, 200, { autenticado: true, csrfToken: sessao.csrf_token });
    } catch (e) {
      return sendJson(res, 200, { autenticado: false });
    }
  }
  if (pathname === '/api/auth/logout' && req.method === 'POST') {
    let sessao = null;
    try {
      sessao = resolverSessao(req);
    } catch (e) {
      sessao = null;
    }
    if (sessao && !csrfConfere(req.headers['x-csrf-token'], sessao.csrf_token)) {
      sendJson(res, 403, { erro: 'Não foi possível concluir a operação.' });
      return;
    }
    try {
      if (sessao) {
        getDb().prepare('DELETE FROM admin_sessoes WHERE id = ?').run(sessao.id);
      }
    } catch (e) {
      /* encerra o cookie mesmo se o banco falhar */
    }
    sendJson(res, 200, { ok: true }, { 'Set-Cookie': cabecalhoSessao(req, '') });
    return;
  }
  if (pathname === '/api/auth/login' && req.method === 'POST') {
    lerCorpoLimitado(req, 2048, (err, body) => {
      if (err || !body || typeof body !== 'object') {
        responderLogin(req, res, 401, { erro: 'Credenciais inválidas.' });
        return;
      }
      try {
        processarLogin(req, res, body.senha);
      } catch (e) {
        console.error('Falha no login administrativo');
        responderLogin(req, res, 500, { erro: 'Não foi possível entrar.' });
      }
    });
    return;
  }
  sendJson(res, 404, { erro: 'Rota desconhecida' });
}

function criarAdministrador(usuario, senha) {
  if (!usuario || !senha || String(senha).length < 10) {
    throw new Error('A senha do administrador precisa ter pelo menos 10 caracteres.');
  }
  if (String(senha) === String(usuario)) {
    throw new Error('A senha não pode ser igual ao usuário.');
  }
  const db = getDb();
  const hash = bcrypt.hashSync(String(senha), BCRYPT_COST);
  const existe = db.prepare('SELECT id FROM admin_usuarios WHERE usuario = ?').get(String(usuario));
  if (existe && process.env.ADMIN_ATUALIZAR_SENHA !== '1') {
    return { criado: false };
  }
  if (existe) {
    db.prepare(`
      UPDATE admin_usuarios
      SET senha_hash = ?, ativo = 1, falhas = 0, bloqueado_ate = NULL
      WHERE id = ?
    `).run(hash, existe.id);
    db.prepare('DELETE FROM admin_sessoes WHERE usuario_id = ?').run(existe.id);
    return { criado: false, atualizado: true };
  }
  db.prepare('INSERT INTO admin_usuarios (usuario, senha_hash) VALUES (?, ?)').run(String(usuario), hash);
  return { criado: true };
}

module.exports = {
  COOKIE,
  SESSION_MS,
  handleAuth,
  exigirAdmin,
  resolverSessao,
  temSessaoValida,
  origemConfiavel,
  criarAdministrador,
  hashToken
};
