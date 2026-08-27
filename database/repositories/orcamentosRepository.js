const { getDb } = require('../db');

const META_EDITADO_SO_LOCAL_PAYLOAD = '__editadoSomenteLocalEm';
/** Iso do SQLite; apenas leitura no cliente para fundir lista — não persistir dentro do payload JSON armazenado */
const META_ATUALIZADO_SERVIDOR = '_atualizadoServidorEm';

function stripMetadadosPayloadPersistencia(obj) {
  if (!obj || typeof obj !== 'object') return;
  delete obj[META_EDITADO_SO_LOCAL_PAYLOAD];
  delete obj[META_ATUALIZADO_SERVIDOR];
}

function aplicarLinhaAoPayload(parsed, linhaDb) {
  if (!parsed || typeof parsed !== 'object' || !linhaDb) return parsed;
  const o = parsed;
  o[META_ATUALIZADO_SERVIDOR] = linhaDb.updated_at;
  return o;
}

/**
 * Garante que cada item do orçamento respeita quantidade mínima (qtd_min / qtdMin).
 * @param {object} obj - payload do orçamento
 * @returns {string|null} mensagem de erro ou null
 */
function validarQuantidadesItensOrcamento(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const itens = obj.itens;
  if (itens == null) return null;
  if (!Array.isArray(itens)) {
    return 'Campo "itens" deve ser uma lista.';
  }
  const PADRAO_MIN = 50;
  for (let i = 0; i < itens.length; i++) {
    const it = itens[i];
    if (!it || typeof it !== 'object') continue;
    const nome = String(it.nome || 'Produto').slice(0, 120);
    /* Complemento incluído manualmente no admin: sem regra de 50 un. do cardápio */
    if (it.extra_pedido_admin === true) {
      const q = parseInt(it.quantidade, 10);
      if (!Number.isFinite(q) || q < 1) {
        return `Quantidade inválida para "${nome}": informe pelo menos 1 unidade (complemento manual).`;
      }
      continue;
    }
    const rawMin = parseInt(
      it.qtd_min != null ? it.qtd_min : it.qtdMin != null ? it.qtdMin : PADRAO_MIN,
      10
    );
    const min =
      !Number.isFinite(rawMin) || rawMin < 1 ? PADRAO_MIN : rawMin;
    const q = parseInt(it.quantidade, 10);
    if (!Number.isFinite(q) || q < min) {
      return `Quantidade inválida para "${nome}": o pedido mínimo é ${min} unidade(s).`;
    }
  }
  return null;
}

function listar() {
  const db = getDb();
  const rows = db.prepare(
    'SELECT id, payload, created_at, updated_at FROM orcamentos ORDER BY id DESC'
  ).all();
  return rows.map((r) => aplicarLinhaAoPayload(JSON.parse(r.payload), r));
}

function buscarPorId(id) {
  const db = getDb();
  const row = db.prepare('SELECT id, payload, updated_at FROM orcamentos WHERE id = ?').get(Number(id));
  if (!row) return null;
  return aplicarLinhaAoPayload(JSON.parse(row.payload), row);
}

function inserir(obj) {
  const errQtd = validarQuantidadesItensOrcamento(obj);
  if (errQtd) throw new Error(errQtd);
  stripMetadadosPayloadPersistencia(obj);
  const db = getDb();
  const id = Number(obj.id);
  if (!id || Number.isNaN(id)) {
    throw new Error('orçamento.id numérico obrigatório');
  }
  const payload = JSON.stringify(obj);
  const now = new Date().toISOString();
  const created = obj.data_criacao || obj.data || now;
  db.prepare(`
    INSERT INTO orcamentos (id, payload, created_at, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      payload = excluded.payload,
      updated_at = excluded.updated_at
  `).run(id, payload, created, now);
  return buscarPorId(id);
}

function atualizar(id, patch) {
  const atual = buscarPorId(id);
  if (!atual) return null;
  const merged = Object.assign({}, atual, patch);
  merged.id = Number(id);
  stripMetadadosPayloadPersistencia(merged);
  const errQtd = validarQuantidadesItensOrcamento(merged);
  if (errQtd) throw new Error(errQtd);
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE orcamentos SET payload = ?, updated_at = ? WHERE id = ?
  `).run(JSON.stringify(merged), now, Number(id));
  return buscarPorId(id);
}

function substituir(obj) {
  const errQtd = validarQuantidadesItensOrcamento(obj);
  if (errQtd) throw new Error(errQtd);
  stripMetadadosPayloadPersistencia(obj);
  const id = Number(obj.id);
  if (!id) throw new Error('id inválido');
  const db = getDb();
  const now = new Date().toISOString();
  const payload = JSON.stringify(obj);
  const created = obj.data_criacao || obj.data || now;
  db.prepare(`
    INSERT INTO orcamentos (id, payload, created_at, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      payload = excluded.payload,
      updated_at = excluded.updated_at
  `).run(id, payload, created, now);
  return buscarPorId(id);
}

function deletar(id) {
  const db = getDb();
  const r = db.prepare('DELETE FROM orcamentos WHERE id = ?').run(Number(id));
  return Number(r.changes) > 0;
}

module.exports = {
  listar,
  buscarPorId,
  inserir,
  atualizar,
  substituir,
  deletar
};
