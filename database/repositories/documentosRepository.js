const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { getDb } = require('../db');

const TIPOS = ['orcamento', 'contrato', 'demonstrativo', 'producao_evento', 'producao_dia'];
const LIMITE_JSON = 400000;
const LIMITE_PDF = 15 * 1024 * 1024;

function recusar(status, motivo) {
  return { status: status, motivo: motivo };
}

function dataIso(valor) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(valor || '').trim());
  if (!match) return null;
  const ano = Number(match[1]);
  const mes = Number(match[2]);
  const dia = Number(match[3]);
  const data = new Date(ano, mes - 1, dia);
  if (data.getFullYear() !== ano || data.getMonth() !== mes - 1 || data.getDate() !== dia) return null;
  return match[1] + '-' + match[2] + '-' + match[3];
}

function canonico(valor) {
  if (valor === undefined) return 'null';
  if (valor === null || typeof valor !== 'object') return JSON.stringify(valor);
  if (Array.isArray(valor)) {
    return '[' + valor.map(canonico).join(',') + ']';
  }
  const chaves = Object.keys(valor).filter((chave) => valor[chave] !== undefined).sort();
  return '{' + chaves.map((chave) => JSON.stringify(chave) + ':' + canonico(valor[chave])).join(',') + '}';
}

function hashTexto(texto) {
  return crypto.createHash('sha256').update(texto).digest('hex');
}

function motivoValido(valor) {
  const texto = String(valor == null ? '' : valor).trim();
  if (texto.length < 3 || texto.length > 500) return null;
  return texto;
}

function conteudoValido(conteudo) {
  if (!conteudo || typeof conteudo !== 'object' || Array.isArray(conteudo)) return null;
  const texto = canonico(conteudo);
  if (Buffer.byteLength(texto) > LIMITE_JSON) return null;
  return texto;
}

function chaveValida(valor) {
  return typeof valor === 'string' && /^[A-Za-z0-9_-]{16,80}$/.test(valor);
}

function diretorioPdf() {
  return process.env.DOCUMENTOS_DIR
    ? path.resolve(process.env.DOCUMENTOS_DIR)
    : path.resolve(__dirname, '../../storage/documentos');
}

function arquivoPdf(relativo) {
  if (typeof relativo !== 'string' || !/^\d+\/\d+\.pdf$/.test(relativo)) return null;
  const base = diretorioPdf();
  const cheio = path.resolve(base, relativo);
  const rel = path.relative(base, cheio);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return cheio;
}

function publicoDocumento(row) {
  return {
    id: Number(row.id),
    tipo: row.tipo,
    orcamento_id: row.orcamento_id == null ? null : Number(row.orcamento_id),
    data_referencia: row.data_referencia || null,
    criado_em: row.criado_em
  };
}

function publicoVersao(row) {
  return {
    id: Number(row.id),
    documento_id: Number(row.documento_id),
    numero: Number(row.numero),
    estado: row.estado,
    usuario_id: Number(row.usuario_id),
    usuario_nome: row.usuario_nome,
    criada_em: row.criada_em,
    atualizada_em: row.atualizada_em,
    motivo: row.motivo,
    conteudo: JSON.parse(row.conteudo_json),
    hash_snapshot: row.hash_snapshot,
    hash_pdf: row.hash_pdf || null,
    pdf_caminho: row.pdf_caminho || null,
    versao_anterior_id: row.versao_anterior_id == null ? null : Number(row.versao_anterior_id),
    revisao: Number(row.revisao),
    emitida_em: row.emitida_em || null
  };
}

function usuarioAtivo(db, usuarioId) {
  const numero = Number(usuarioId);
  if (!Number.isSafeInteger(numero) || numero <= 0) return null;
  return db.prepare('SELECT id, usuario FROM admin_usuarios WHERE id = ? AND ativo = 1').get(numero);
}

function desfazer(db) {
  try { db.exec('ROLLBACK'); } catch (ignorar) { /* a transação já pode ter sido desfeita */ }
}

function criarDocumento(entrada) {
  const tipo = entrada && entrada.tipo;
  if (TIPOS.indexOf(tipo) === -1) return recusar(400, 'tipo');
  let orcamentoId = null;
  let data = null;
  if (tipo === 'producao_dia') {
    data = dataIso(entrada && entrada.data);
    if (!data) return recusar(400, 'data');
  } else {
    orcamentoId = Number(entrada && entrada.orcamentoId);
    if (!Number.isSafeInteger(orcamentoId) || orcamentoId <= 0) return recusar(400, 'id');
  }
  const db = getDb();
  db.exec('BEGIN IMMEDIATE');
  try {
    const existente = tipo === 'producao_dia'
      ? db.prepare('SELECT * FROM documentos WHERE tipo = ? AND data_referencia = ?').get(tipo, data)
      : db.prepare('SELECT * FROM documentos WHERE tipo = ? AND orcamento_id = ?').get(tipo, orcamentoId);
    if (existente) {
      db.exec('COMMIT');
      return { status: 200, documento: publicoDocumento(existente), repetido: true };
    }
    if (orcamentoId) {
      const orcamento = db.prepare('SELECT id FROM orcamentos WHERE id = ?').get(orcamentoId);
      if (!orcamento) {
        desfazer(db);
        return recusar(404, 'orcamento');
      }
    }
    const agora = new Date().toISOString();
    const info = db.prepare(`
      INSERT INTO documentos (tipo, orcamento_id, data_referencia, criado_em)
      VALUES (?, ?, ?, ?)
    `).run(tipo, orcamentoId, data, agora);
    db.exec('COMMIT');
    return {
      status: 201,
      repetido: false,
      documento: publicoDocumento({
        id: info.lastInsertRowid,
        tipo: tipo,
        orcamento_id: orcamentoId,
        data_referencia: data,
        criado_em: agora
      })
    };
  } catch (e) {
    desfazer(db);
    throw e;
  }
}

function criarRascunho(entrada) {
  const documentoId = Number(entrada && entrada.documentoId);
  const motivo = motivoValido(entrada && entrada.motivo);
  const texto = conteudoValido(entrada && entrada.conteudo);
  if (!Number.isSafeInteger(documentoId) || documentoId <= 0) return recusar(400, 'id');
  if (!motivo) return recusar(400, 'motivo');
  if (!texto) return recusar(400, 'conteudo');
  const db = getDb();
  db.exec('BEGIN IMMEDIATE');
  try {
    const usuario = usuarioAtivo(db, entrada.usuarioId);
    const documento = db.prepare('SELECT id FROM documentos WHERE id = ?').get(documentoId);
    if (!usuario || !documento) {
      desfazer(db);
      return recusar(usuario ? 404 : 400, usuario ? 'documento' : 'usuario');
    }
    const aberto = db.prepare(`
      SELECT id FROM documento_versoes WHERE documento_id = ? AND estado = 'rascunho'
    `).get(documentoId);
    if (aberto) {
      desfazer(db);
      return recusar(409, 'rascunho');
    }
    const anterior = db.prepare(`
      SELECT id FROM documento_versoes
      WHERE documento_id = ? AND estado = 'emitida'
      ORDER BY numero DESC LIMIT 1
    `).get(documentoId);
    const ultimo = db.prepare(`
      SELECT COALESCE(MAX(numero), 0) AS numero FROM documento_versoes WHERE documento_id = ?
    `).get(documentoId);
    const agora = new Date().toISOString();
    const info = db.prepare(`
      INSERT INTO documento_versoes (
        documento_id, numero, estado, usuario_id, usuario_nome, criada_em, atualizada_em,
        motivo, conteudo_json, hash_snapshot, versao_anterior_id, revisao
      ) VALUES (?, ?, 'rascunho', ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `).run(
      documentoId,
      Number(ultimo.numero) + 1,
      usuario.id,
      usuario.usuario,
      agora,
      agora,
      motivo,
      texto,
      hashTexto(texto),
      anterior ? anterior.id : null
    );
    const row = db.prepare('SELECT * FROM documento_versoes WHERE id = ?').get(info.lastInsertRowid);
    db.exec('COMMIT');
    return { status: 201, versao: publicoVersao(row) };
  } catch (e) {
    desfazer(db);
    throw e;
  }
}

function consultarRascunho(documentoId) {
  const numero = Number(documentoId);
  if (!Number.isSafeInteger(numero) || numero <= 0) return recusar(400, 'id');
  const row = getDb().prepare(`
    SELECT * FROM documento_versoes WHERE documento_id = ? AND estado = 'rascunho'
  `).get(numero);
  if (!row) return recusar(404, 'rascunho');
  return { status: 200, versao: publicoVersao(row) };
}

function atualizarRascunho(entrada) {
  const versaoId = Number(entrada && entrada.versaoId);
  const revisao = Number(entrada && entrada.revisao);
  const motivo = motivoValido(entrada && entrada.motivo);
  const texto = conteudoValido(entrada && entrada.conteudo);
  if (!Number.isSafeInteger(versaoId) || versaoId <= 0) return recusar(400, 'id');
  if (!Number.isSafeInteger(revisao) || revisao <= 0) return recusar(400, 'revisao');
  if (!motivo) return recusar(400, 'motivo');
  if (!texto) return recusar(400, 'conteudo');
  const db = getDb();
  db.exec('BEGIN IMMEDIATE');
  try {
    const agora = new Date().toISOString();
    const info = db.prepare(`
      UPDATE documento_versoes
      SET conteudo_json = ?, hash_snapshot = ?, motivo = ?, atualizada_em = ?, revisao = revisao + 1
      WHERE id = ? AND revisao = ? AND estado = 'rascunho'
    `).run(texto, hashTexto(texto), motivo, agora, versaoId, revisao);
    if (Number(info.changes) !== 1) {
      desfazer(db);
      const existe = db.prepare('SELECT estado FROM documento_versoes WHERE id = ?').get(versaoId);
      if (!existe) return recusar(404, 'versao');
      if (existe.estado !== 'rascunho') return recusar(409, 'imutavel');
      return recusar(409, 'revisao');
    }
    const row = db.prepare('SELECT * FROM documento_versoes WHERE id = ?').get(versaoId);
    db.exec('COMMIT');
    return { status: 200, versao: publicoVersao(row) };
  } catch (e) {
    desfazer(db);
    throw e;
  }
}

function descartarRascunho(entrada) {
  const versaoId = Number(entrada && entrada.versaoId);
  const revisao = Number(entrada && entrada.revisao);
  const motivo = motivoValido(entrada && entrada.motivo);
  if (!Number.isSafeInteger(versaoId) || versaoId <= 0) return recusar(400, 'id');
  if (!Number.isSafeInteger(revisao) || revisao <= 0) return recusar(400, 'revisao');
  if (!motivo) return recusar(400, 'motivo');
  const db = getDb();
  db.exec('BEGIN IMMEDIATE');
  try {
    const agora = new Date().toISOString();
    const info = db.prepare(`
      UPDATE documento_versoes
      SET estado = 'descartado', motivo = ?, atualizada_em = ?, revisao = revisao + 1
      WHERE id = ? AND revisao = ? AND estado = 'rascunho'
    `).run(motivo, agora, versaoId, revisao);
    if (Number(info.changes) !== 1) {
      desfazer(db);
      return recusar(409, 'revisao');
    }
    const row = db.prepare('SELECT * FROM documento_versoes WHERE id = ?').get(versaoId);
    db.exec('COMMIT');
    return { status: 200, versao: publicoVersao(row) };
  } catch (e) {
    desfazer(db);
    throw e;
  }
}

function consultaChave(versaoId, chave) {
  const numero = Number(versaoId);
  if (!Number.isSafeInteger(numero) || numero <= 0) return recusar(400, 'id');
  if (!chaveValida(chave)) return recusar(400, 'chave');
  const repetida = getDb().prepare('SELECT * FROM documento_versoes WHERE chave_idempotencia = ?').get(chave);
  if (!repetida) return { status: 204 };
  if (Number(repetida.id) === numero && repetida.estado === 'emitida') {
    return { status: 200, repetida: true, versao: publicoVersao(repetida) };
  }
  return recusar(409, 'chave');
}

function emitir(entrada) {
  const versaoId = Number(entrada && entrada.versaoId);
  const revisao = Number(entrada && entrada.revisao);
  const chave = entrada && entrada.chave;
  const pdf = entrada && entrada.pdf;
  if (!Number.isSafeInteger(versaoId) || versaoId <= 0) return recusar(400, 'id');
  if (!Number.isSafeInteger(revisao) || revisao <= 0) return recusar(400, 'revisao');
  if (!chaveValida(chave)) return recusar(400, 'chave');
  if (!Buffer.isBuffer(pdf) || pdf.length < 1 || pdf.length > LIMITE_PDF) return recusar(400, 'pdf');
  const hashPdf = hashTexto(pdf);
  const db = getDb();
  db.exec('BEGIN IMMEDIATE');
  let gravado = null;
  try {
    const repetida = db.prepare('SELECT * FROM documento_versoes WHERE chave_idempotencia = ?').get(chave);
    if (repetida) {
      const igual = Number(repetida.id) === versaoId && repetida.hash_pdf === hashPdf && repetida.estado === 'emitida';
      db.exec('COMMIT');
      if (!igual) return recusar(409, 'chave');
      return { status: 200, repetida: true, versao: publicoVersao(repetida) };
    }
    const atual = db.prepare('SELECT * FROM documento_versoes WHERE id = ?').get(versaoId);
    if (!atual || atual.estado !== 'rascunho' || Number(atual.revisao) !== revisao) {
      desfazer(db);
      if (!atual) return recusar(404, 'versao');
      if (atual.estado !== 'rascunho') return recusar(409, 'imutavel');
      return recusar(409, 'revisao');
    }
    let revisaoEmissao = revisao;
    if (entrada.conteudo) {
      const textoConteudo = conteudoValido(entrada.conteudo);
      if (!textoConteudo) {
        desfazer(db);
        return recusar(400, 'conteudo');
      }
      if (textoConteudo !== atual.conteudo_json) {
        const gravou = db.prepare(`
          UPDATE documento_versoes
          SET conteudo_json = ?, hash_snapshot = ?, atualizada_em = ?, revisao = revisao + 1
          WHERE id = ? AND revisao = ? AND estado = 'rascunho'
        `).run(textoConteudo, hashTexto(textoConteudo), new Date().toISOString(), versaoId, revisao);
        if (Number(gravou.changes) !== 1) {
          desfazer(db);
          return recusar(409, 'revisao');
        }
        revisaoEmissao = revisao + 1;
      }
    }
    const relativo = atual.documento_id + '/' + atual.id + '.pdf';
    const destino = arquivoPdf(relativo);
    if (!destino) {
      desfazer(db);
      return recusar(400, 'caminho');
    }
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.writeFileSync(destino, pdf, { flag: 'wx' });
    gravado = destino;
    const agora = new Date().toISOString();
    const info = db.prepare(`
      UPDATE documento_versoes
      SET estado = 'emitida', hash_pdf = ?, pdf_caminho = ?, chave_idempotencia = ?,
          emitida_em = ?, atualizada_em = ?, revisao = revisao + 1
      WHERE id = ? AND revisao = ? AND estado = 'rascunho'
    `).run(hashPdf, relativo, chave, agora, agora, versaoId, revisaoEmissao);
    if (Number(info.changes) !== 1) {
      throw new Error('emissao');
    }
    const row = db.prepare('SELECT * FROM documento_versoes WHERE id = ?').get(versaoId);
    db.exec('COMMIT');
    return { status: 201, repetida: false, versao: publicoVersao(row) };
  } catch (e) {
    desfazer(db);
    if (gravado) {
      try { fs.rmSync(gravado, { force: true }); } catch (ignorar) { /* arquivo parcial */ }
    }
    if (e && /chave_idempotencia|UNIQUE/i.test(String(e.message || ''))) return recusar(409, 'chave');
    throw e;
  }
}

function historico(documentoId) {
  const numero = Number(documentoId);
  if (!Number.isSafeInteger(numero) || numero <= 0) return recusar(400, 'id');
  const documento = getDb().prepare('SELECT id FROM documentos WHERE id = ?').get(numero);
  if (!documento) return recusar(404, 'documento');
  const rows = getDb().prepare(`
    SELECT * FROM documento_versoes WHERE documento_id = ? ORDER BY numero
  `).all(numero);
  return { status: 200, versoes: rows.map(publicoVersao) };
}

function consultarVersao(versaoId) {
  const numero = Number(versaoId);
  if (!Number.isSafeInteger(numero) || numero <= 0) return recusar(400, 'id');
  const row = getDb().prepare('SELECT * FROM documento_versoes WHERE id = ?').get(numero);
  if (!row) return recusar(404, 'versao');
  return { status: 200, versao: publicoVersao(row) };
}

function diferencas(antes, depois, caminho, saida) {
  if (canonico(antes) === canonico(depois)) return;
  const objeto = function (valor) {
    return !!valor && typeof valor === 'object' && !Array.isArray(valor);
  };
  if (objeto(antes) && objeto(depois)) {
    const chaves = Object.keys(Object.assign({}, antes, depois)).sort();
    chaves.forEach((chave) => {
      diferencas(antes[chave], depois[chave], (caminho ? caminho + '.' : '') + chave, saida);
    });
    return;
  }
  if (Array.isArray(antes) && Array.isArray(depois) && antes.length === depois.length) {
    antes.forEach((item, indice) => {
      diferencas(item, depois[indice], caminho + '[' + indice + ']', saida);
    });
    return;
  }
  saida.push({ caminho: caminho || '/', antes: antes === undefined ? null : antes, depois: depois === undefined ? null : depois });
}

function comparar(versaoA, versaoB) {
  const a = consultarVersao(versaoA);
  const b = consultarVersao(versaoB);
  if (a.status !== 200) return a;
  if (b.status !== 200) return b;
  if (a.versao.documento_id !== b.versao.documento_id) return recusar(409, 'documento');
  const alteracoes = [];
  diferencas(a.versao.conteudo, b.versao.conteudo, '', alteracoes);
  return { status: 200, iguais: alteracoes.length === 0, alteracoes: alteracoes };
}

function listar(filtro) {
  const tipo = filtro && filtro.tipo ? String(filtro.tipo) : '';
  if (tipo && TIPOS.indexOf(tipo) === -1) return recusar(400, 'tipo');
  const busca = String(filtro && filtro.busca || '').trim().toLocaleLowerCase('pt-BR').slice(0, 80);
  const db = getDb();
  const docs = tipo
    ? db.prepare('SELECT * FROM documentos WHERE tipo = ? ORDER BY id DESC').all(tipo)
    : db.prepare('SELECT * FROM documentos ORDER BY id DESC').all();
  const nomes = new Map();
  db.prepare('SELECT id, payload FROM orcamentos').all().forEach((row) => {
    let nome = '';
    try {
      const orcamento = JSON.parse(row.payload);
      nome = String(orcamento.nome_cliente || orcamento.cliente || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    } catch (e) {
      nome = '';
    }
    nomes.set(Number(row.id), nome);
  });
  const documentos = docs.map((row) => {
    const versoes = db.prepare(`
      SELECT id, numero, estado, emitida_em, usuario_nome, motivo
      FROM documento_versoes WHERE documento_id = ? ORDER BY numero DESC
    `).all(row.id);
    const atual = versoes[0] || null;
    const emitida = versoes.find((versao) => versao.estado === 'emitida') || null;
    return {
      id: Number(row.id),
      tipo: row.tipo,
      orcamento_id: row.orcamento_id == null ? null : Number(row.orcamento_id),
      data_referencia: row.data_referencia || null,
      criado_em: row.criado_em,
      cliente: row.orcamento_id == null ? null : (nomes.get(Number(row.orcamento_id)) || null),
      estado: atual ? atual.estado : 'sem_versao',
      versao_numero: atual ? Number(atual.numero) : null,
      versao_id: atual ? Number(atual.id) : null,
      emitida_em: emitida ? emitida.emitida_em : null,
      usuario_nome: atual ? atual.usuario_nome : null,
      motivo: atual ? atual.motivo : null,
      total_versoes: versoes.length
    };
  }).filter((item) => {
    if (!busca) return true;
    const texto = [item.id, item.orcamento_id, item.data_referencia, item.cliente, item.tipo]
      .join(' ')
      .toLocaleLowerCase('pt-BR');
    return texto.indexOf(busca) !== -1;
  });
  return { status: 200, documentos: documentos };
}

function lerPdf(versaoId) {
  const consulta = consultarVersao(versaoId);
  if (consulta.status !== 200) return consulta;
  if (consulta.versao.estado !== 'emitida' || !consulta.versao.pdf_caminho) return recusar(409, 'pdf');
  const checagem = validarHash(versaoId);
  if (!checagem.snapshot || checagem.pdf !== true) return recusar(409, 'integridade');
  const arquivo = arquivoPdf(consulta.versao.pdf_caminho);
  if (!arquivo) return recusar(409, 'integridade');
  return {
    status: 200,
    buffer: fs.readFileSync(arquivo),
    arquivo: 'documento-' + consulta.versao.documento_id + '-v' + consulta.versao.numero + '.pdf'
  };
}

function validarHash(versaoId) {
  const consulta = consultarVersao(versaoId);
  if (consulta.status !== 200) return consulta;
  const row = getDb().prepare('SELECT conteudo_json, hash_snapshot, hash_pdf, pdf_caminho, estado FROM documento_versoes WHERE id = ?').get(consulta.versao.id);
  const snapshot = hashTexto(row.conteudo_json) === row.hash_snapshot
    && hashTexto(canonico(JSON.parse(row.conteudo_json))) === row.hash_snapshot;
  let pdf = null;
  if (row.estado === 'emitida') {
    const arquivo = arquivoPdf(row.pdf_caminho);
    pdf = !!(arquivo && fs.existsSync(arquivo) && hashTexto(fs.readFileSync(arquivo)) === row.hash_pdf);
  }
  return { status: 200, snapshot: snapshot, pdf: pdf };
}

module.exports = {
  canonico: canonico,
  criarDocumento: criarDocumento,
  criarRascunho: criarRascunho,
  consultarRascunho: consultarRascunho,
  atualizarRascunho: atualizarRascunho,
  descartarRascunho: descartarRascunho,
  emitir: emitir,
  historico: historico,
  consultarVersao: consultarVersao,
  comparar: comparar,
  validarHash: validarHash,
  listar: listar,
  lerPdf: lerPdf,
  consultaChave: consultaChave
};
