/**
 * API REST mínima — SQLite local (produtos, categorias, orçamentos)
 */
const orcamentosRepo = require('../database/repositories/orcamentosRepository');
const categoriasRepo = require('../database/repositories/categoriasRepository');
const produtosRepo = require('../database/repositories/produtosRepository');
const auth = require('./auth');

function readJsonBody(req, callback) {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    try {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw.trim()) return callback(null, null);
      callback(null, JSON.parse(raw));
    } catch (e) {
      callback(e);
    }
  });
}

function sendJson(res, status, obj) {
  if (status === 204) {
    res.writeHead(204);
    res.end();
    return;
  }
  const body = obj === undefined || obj === null ? '' : JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function matchOrcamentos(pathname) {
  if (pathname === '/api/orcamentos' || pathname === '/api/orcamentos/') return { type: 'collection' };
  const m = pathname.match(/^\/api\/orcamentos\/(\d+)$/);
  if (m) return { type: 'item', id: m[1] };
  return null;
}

function matchEntity(pathname, plural) {
  const base = `/api/${plural}`;
  if (pathname === base || pathname === `${base}/`) return { type: 'collection' };
  const m = pathname.match(new RegExp('^' + base.replace(/\//g, '\\/') + '\\/(\\d+)$'));
  if (m) return { type: 'item', id: m[1] };
  return null;
}

function handleOrcamentos(req, res, pathname, apiDbReady) {
  if (!apiDbReady) {
    sendJson(res, 503, { error: 'Banco SQLite indisponível' });
    return;
  }
  const ctx = matchOrcamentos(pathname);
  if (!ctx) {
    sendJson(res, 404, { error: 'Não encontrado' });
    return;
  }

  try {
    if (ctx.type === 'collection') {
      if (req.method === 'GET') {
        sendJson(res, 200, orcamentosRepo.listar());
        return;
      }
      if (req.method === 'POST') {
        readJsonBody(req, (err, body) => {
          if (err) return sendJson(res, 400, { error: 'JSON inválido' });
          if (!body || typeof body !== 'object') {
            return sendJson(res, 400, { error: 'Corpo obrigatório' });
          }
          try {
            const saved = orcamentosRepo.inserir(body);
            sendJson(res, 201, saved);
          } catch (e) {
            sendJson(res, 400, { error: String(e.message || e) });
          }
        });
        return;
      }
    } else if (ctx.type === 'item') {
      const id = ctx.id;
      if (req.method === 'GET') {
        const o = orcamentosRepo.buscarPorId(id);
        if (!o) return sendJson(res, 404, { error: 'Orçamento não encontrado' });
        return sendJson(res, 200, o);
      }
      if (req.method === 'PATCH') {
        readJsonBody(req, (err, body) => {
          if (err) return sendJson(res, 400, { error: 'JSON inválido' });
          try {
            const saved = orcamentosRepo.atualizar(id, body || {});
            if (!saved) return sendJson(res, 404, { error: 'Orçamento não encontrado' });
            return sendJson(res, 200, saved);
          } catch (e) {
            return sendJson(res, 400, { error: String(e.message || e) });
          }
        });
        return;
      }
      if (req.method === 'PUT') {
        readJsonBody(req, (err, body) => {
          if (err) return sendJson(res, 400, { error: 'JSON inválido' });
          if (!body || typeof body !== 'object') {
            return sendJson(res, 400, { error: 'Corpo obrigatório' });
          }
          body.id = Number(id);
          try {
            const saved = orcamentosRepo.substituir(body);
            return sendJson(res, 200, saved);
          } catch (e) {
            return sendJson(res, 400, { error: String(e.message || e) });
          }
        });
        return;
      }
      if (req.method === 'DELETE') {
        const ok = orcamentosRepo.deletar(id);
        if (!ok) return sendJson(res, 404, { error: 'Orçamento não encontrado' });
        return sendJson(res, 204);
      }
    }
  } catch (e) {
    return sendJson(res, 500, { error: String(e.message || e) });
  }
  sendJson(res, 405, { error: 'Método não permitido' });
}

function crudGeneric(req, res, pathname, repo, apiDbReady, namePt) {
  if (!apiDbReady) {
    sendJson(res, 503, { error: 'Banco SQLite indisponível' });
    return;
  }
  const plural = pathname.split('/')[2];
  const ctx = matchEntity(pathname, plural);
  if (!ctx) {
    sendJson(res, 404, { error: 'Não encontrado' });
    return;
  }

  try {
    if (ctx.type === 'collection') {
      if (req.method === 'GET') {
        return sendJson(res, 200, repo.listar());
      }
      if (req.method === 'POST') {
        readJsonBody(req, (err, body) => {
          if (err) return sendJson(res, 400, { error: 'JSON inválido' });
          if (!body || typeof body !== 'object') {
            return sendJson(res, 400, { error: 'Corpo obrigatório' });
          }
          try {
            const saved = repo.inserir(body);
            sendJson(res, 201, saved);
          } catch (e) {
            sendJson(res, 400, { error: String(e.message || e) });
          }
        });
        return;
      }
    } else if (ctx.type === 'item') {
      const id = ctx.id;
      if (req.method === 'GET') {
        const row = repo.buscarPorId(id);
        if (!row) return sendJson(res, 404, { error: `${namePt} não encontrado(a)` });
        return sendJson(res, 200, row);
      }
      if (req.method === 'PATCH') {
        readJsonBody(req, (err, body) => {
          if (err) return sendJson(res, 400, { error: 'JSON inválido' });
          try {
            const saved = repo.atualizar(id, body || {});
            if (!saved) return sendJson(res, 404, { error: `${namePt} não encontrado(a)` });
            return sendJson(res, 200, saved);
          } catch (e) {
            return sendJson(res, 400, { error: String(e.message || e) });
          }
        });
        return;
      }
      if (req.method === 'PUT') {
        readJsonBody(req, (err, body) => {
          if (err) return sendJson(res, 400, { error: 'JSON inválido' });
          if (!body || typeof body !== 'object') {
            return sendJson(res, 400, { error: 'Corpo obrigatório' });
          }
          const prev = repo.buscarPorId(id);
          if (!prev) return sendJson(res, 404, { error: `${namePt} não encontrado(a)` });
          const merged = Object.assign({}, prev, body);
          try {
            const saved = repo.atualizar(id, merged);
            return sendJson(res, 200, saved);
          } catch (e) {
            return sendJson(res, 400, { error: String(e.message || e) });
          }
        });
        return;
      }
      if (req.method === 'DELETE') {
        const ok = repo.deletar(id);
        if (!ok) return sendJson(res, 404, { error: `${namePt} não encontrado(a)` });
        return sendJson(res, 204);
      }
    }
  } catch (e) {
    return sendJson(res, 500, { error: String(e.message || e) });
  }
  sendJson(res, 405, { error: 'Método não permitido' });
}

function mutacao(req) {
  return req.method !== 'GET' && req.method !== 'HEAD';
}

function bloquearSeOrigemEstranha(req, res) {
  if (auth.origemConfiavel(req)) return false;
  sendJson(res, 403, { erro: 'Não foi possível concluir a operação.' });
  return true;
}

function descartarCorpo(req, callback) {
  let tamanho = 0;
  let estourou = false;
  req.on('data', (parte) => {
    tamanho += parte.length;
    if (tamanho > 65536) estourou = true;
  });
  req.on('end', () => callback(estourou ? new Error('limite') : null));
  req.on('error', () => callback(new Error('corpo')));
}

function confirmarContrato(req, res, id) {
  descartarCorpo(req, (erroCorpo) => {
    if (erroCorpo) {
      sendJson(res, 400, { erro: 'Não foi possível confirmar o contrato.' });
      return;
    }
    try {
      const resultado = orcamentosRepo.confirmarContrato(id);
      if (!resultado) {
        sendJson(res, 404, { erro: 'Orçamento não encontrado.' });
        return;
      }
      const gestao = resultado.orcamento && resultado.orcamento.gestao_contrato;
      sendJson(res, 200, {
        ok: true,
        id: Number(id),
        repetida: resultado.repetida === true,
        gestao_contrato: gestao
      });
    } catch (e) {
      const status = e && e.code === 'id' ? 400 : 500;
      sendJson(res, status, { erro: 'Não foi possível confirmar o contrato.' });
    }
  });
}

function handleApi(req, res, pathname, apiDbReady) {
  if (pathname.startsWith('/api/auth/')) {
    if (!apiDbReady) return sendJson(res, 503, { erro: 'Banco SQLite indisponível' });
    return auth.handleAuth(req, res, pathname);
  }

  const confirmar = pathname.match(/^\/api\/orcamentos\/(\d+)\/confirmar-contrato\/?$/);
  if (confirmar) {
    if (!apiDbReady) return sendJson(res, 503, { erro: 'Banco SQLite indisponível' });
    if (req.method !== 'POST') return sendJson(res, 405, { erro: 'Método não permitido' });
    if (!auth.exigirAdmin(req, res, { csrf: true })) return;
    return confirmarContrato(req, res, confirmar[1]);
  }

  if (pathname.startsWith('/api/orcamentos')) {
    const colecao = pathname === '/api/orcamentos' || pathname === '/api/orcamentos/';
    const envioPublico = colecao && req.method === 'POST';
    if (envioPublico) {
      if (bloquearSeOrigemEstranha(req, res)) return;
      return handleOrcamentos(req, res, pathname, apiDbReady);
    }
    if (!auth.exigirAdmin(req, res, { csrf: mutacao(req) })) return;
    return handleOrcamentos(req, res, pathname, apiDbReady);
  }

  if (pathname.startsWith('/api/categorias') || pathname.startsWith('/api/produtos')) {
    const repo = pathname.startsWith('/api/categorias') ? categoriasRepo : produtosRepo;
    const nome = pathname.startsWith('/api/categorias') ? 'Categoria' : 'Produto';
    if (req.method === 'GET' || req.method === 'HEAD') {
      return crudGeneric(req, res, pathname, repo, apiDbReady, nome);
    }
    if (!auth.exigirAdmin(req, res, { csrf: true })) return;
    return crudGeneric(req, res, pathname, repo, apiDbReady, nome);
  }

  sendJson(res, 404, { error: 'Rota desconhecida' });
}

module.exports = { handleApi };
