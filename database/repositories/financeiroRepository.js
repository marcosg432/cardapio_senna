const { getDb } = require('../db');
const dinheiro = require('../dinheiro');

const FORMAS = ['pix', 'dinheiro', 'transferencia', 'cartao', 'boleto', 'outro'];
const CAMPOS_PAGAMENTO = ['valor_centavos', 'pago_em', 'forma', 'chave_idempotencia'];

function confirmacaoValida(gestao) {
  return !!(
    gestao &&
    gestao.status === 'confirmado' &&
    typeof gestao.confirmado_em === 'string' &&
    /^\d{4}-\d{2}-\d{2}T/.test(gestao.confirmado_em)
  );
}

function nomeCliente(orcamento) {
  return String((orcamento && (orcamento.nome_cliente || orcamento.cliente)) || '').trim();
}

function dataEventoIso(orcamento) {
  const texto = String((orcamento && (orcamento.data_evento || orcamento.evento_data)) || '').trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto);
  if (!match) return null;
  const ano = Number(match[1]);
  const mes = Number(match[2]);
  const dia = Number(match[3]);
  const data = new Date(ano, mes - 1, dia);
  if (data.getFullYear() !== ano || data.getMonth() !== mes - 1 || data.getDate() !== dia) return null;
  return match[1] + '-' + match[2] + '-' + match[3];
}

function hojeLocal(referencia) {
  const data = referencia || new Date();
  const mes = String(data.getMonth() + 1).padStart(2, '0');
  const dia = String(data.getDate()).padStart(2, '0');
  return data.getFullYear() + '-' + mes + '-' + dia;
}

function dataCivilValida(texto, referencia) {
  const iso = dataEventoIso({ data_evento: texto });
  if (!iso) return false;
  return iso <= hojeLocal(referencia);
}

function numeroId(info) {
  const id = info && info.lastInsertRowid;
  const numero = typeof id === 'bigint' ? Number(id) : Number(id);
  return Number.isSafeInteger(numero) ? numero : null;
}

function mapaRecebidos(db) {
  const rows = db.prepare(`
    SELECT orcamento_id, COALESCE(SUM(valor_centavos), 0) AS total
    FROM pagamentos
    GROUP BY orcamento_id
  `).all();
  const mapa = new Map();
  rows.forEach((row) => mapa.set(Number(row.orcamento_id), Number(row.total)));
  return mapa;
}

function resumoContrato(orcamento, congelado, recebido) {
  const base = {
    id: Number(orcamento.id),
    nome_cliente: nomeCliente(orcamento),
    data_evento: dataEventoIso(orcamento),
    congelado: !!congelado
  };
  if (!congelado) return base;
  const contratado = Number(congelado.valor_contratado_centavos);
  const recebidos = Number(recebido) || 0;
  return Object.assign(base, {
    valor_contratado_centavos: contratado,
    recebido_centavos: recebidos,
    pendente_centavos: contratado - recebidos,
    congelado_em: congelado.congelado_em
  });
}

function lerOrcamentos(db) {
  return db.prepare('SELECT id, payload FROM orcamentos ORDER BY id DESC').all().map((row) => {
    const orcamento = JSON.parse(row.payload);
    orcamento.id = Number(row.id);
    return orcamento;
  });
}

function listarContratos() {
  const db = getDb();
  const congelados = new Map();
  db.prepare('SELECT orcamento_id, valor_contratado_centavos, congelado_em FROM financeiro_contratos').all()
    .forEach((row) => congelados.set(Number(row.orcamento_id), row));
  const recebidos = mapaRecebidos(db);
  const contratos = lerOrcamentos(db)
    .filter((orcamento) => confirmacaoValida(orcamento.gestao_contrato))
    .map((orcamento) => resumoContrato(
      orcamento,
      congelados.get(Number(orcamento.id)) || null,
      recebidos.get(Number(orcamento.id)) || 0
    ))
    .sort((a, b) => {
      if (a.data_evento && b.data_evento && a.data_evento !== b.data_evento) {
        return a.data_evento < b.data_evento ? -1 : 1;
      }
      if (a.data_evento && !b.data_evento) return -1;
      if (!a.data_evento && b.data_evento) return 1;
      return b.id - a.id;
    });
  const totais = contratos.reduce((soma, contrato) => {
    if (!contrato.congelado) return soma;
    soma.contratado_centavos += contrato.valor_contratado_centavos;
    soma.recebido_centavos += contrato.recebido_centavos;
    soma.pendente_centavos += contrato.pendente_centavos;
    return soma;
  }, { contratado_centavos: 0, recebido_centavos: 0, pendente_centavos: 0 });
  return { contratos: contratos, totais: totais };
}

function detalhar(id) {
  const numero = Number(id);
  if (!Number.isSafeInteger(numero) || numero <= 0) return { status: 400, motivo: 'id' };
  const dbBusca = getDb();
  const linha = dbBusca.prepare('SELECT id, payload FROM orcamentos WHERE id = ?').get(numero);
  if (!linha) return { status: 404 };
  const orcamento = JSON.parse(linha.payload);
  orcamento.id = numero;
  if (!confirmacaoValida(orcamento.gestao_contrato)) return { status: 409, motivo: 'confirmacao' };
  const db = getDb();
  const congelado = db.prepare(`
    SELECT orcamento_id, valor_contratado_centavos, congelado_em
    FROM financeiro_contratos
    WHERE orcamento_id = ?
  `).get(numero);
  const historico = congelado
    ? db.prepare(`
      SELECT id, valor_centavos, pago_em, forma, criado_em
      FROM pagamentos
      WHERE orcamento_id = ?
      ORDER BY pago_em ASC, id ASC
    `).all(numero).map((row) => ({
      id: Number(row.id),
      valor_centavos: Number(row.valor_centavos),
      pago_em: row.pago_em,
      forma: row.forma,
      criado_em: row.criado_em
    }))
    : [];
  const recebido = historico.reduce((soma, item) => soma + item.valor_centavos, 0);
  return {
    status: 200,
    contrato: Object.assign(resumoContrato(orcamento, congelado, recebido), {
      entrada_prevista_centavos: dinheiro.entradaPrevistaCentavos(orcamento),
      historico: historico
    })
  };
}

function rejeitar(status, motivo) {
  return { status: status, motivo: motivo };
}

function validarPagamento(body, referencia) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return rejeitar(400, 'campos');
  const chaves = Object.keys(body);
  if (chaves.length !== CAMPOS_PAGAMENTO.length || CAMPOS_PAGAMENTO.some((campo) => !Object.prototype.hasOwnProperty.call(body, campo))) {
    return rejeitar(400, 'campos');
  }
  if (chaves.some((campo) => CAMPOS_PAGAMENTO.indexOf(campo) === -1)) return rejeitar(400, 'campos');
  const valor = body.valor_centavos;
  if (typeof valor !== 'number' || !Number.isSafeInteger(valor) || valor <= 0) return rejeitar(400, 'valor');
  if (typeof body.pago_em !== 'string' || !dataCivilValida(body.pago_em, referencia)) return rejeitar(400, 'data');
  if (typeof body.forma !== 'string' || FORMAS.indexOf(body.forma) === -1) return rejeitar(400, 'forma');
  if (typeof body.chave_idempotencia !== 'string' || !/^[A-Za-z0-9_-]{16,80}$/.test(body.chave_idempotencia)) {
    return rejeitar(400, 'chave_formato');
  }
  return {
    status: 200,
    dados: {
      valor_centavos: valor,
      pago_em: body.pago_em,
      forma: body.forma,
      chave_idempotencia: body.chave_idempotencia
    }
  };
}

function totaisDoContrato(db, orcamentoId, contratado) {
  const row = db.prepare('SELECT COALESCE(SUM(valor_centavos), 0) AS total FROM pagamentos WHERE orcamento_id = ?').get(orcamentoId);
  const recebido = Number(row.total) || 0;
  return {
    recebido_centavos: recebido,
    pendente_centavos: Number(contratado) - recebido
  };
}

function pagamentoPublico(row) {
  return {
    id: Number(row.id),
    orcamento_id: Number(row.orcamento_id),
    valor_centavos: Number(row.valor_centavos),
    pago_em: row.pago_em,
    forma: row.forma,
    criado_em: row.criado_em
  };
}

function registrarPagamento(id, body, referencia) {
  const numero = Number(id);
  if (!Number.isSafeInteger(numero) || numero <= 0) return rejeitar(400, 'id');
  const valido = validarPagamento(body, referencia);
  if (valido.status !== 200) return valido;
  const dados = valido.dados;
  const db = getDb();
  db.exec('BEGIN IMMEDIATE');
  try {
    const row = db.prepare('SELECT payload FROM orcamentos WHERE id = ?').get(numero);
    if (!row) {
      db.exec('ROLLBACK');
      return { status: 404 };
    }
    const atual = JSON.parse(row.payload);
    if (!confirmacaoValida(atual.gestao_contrato)) {
      db.exec('ROLLBACK');
      return rejeitar(409, 'confirmacao');
    }
    const congelado = db.prepare(`
      SELECT valor_contratado_centavos FROM financeiro_contratos WHERE orcamento_id = ?
    `).get(numero);
    if (!congelado) {
      db.exec('ROLLBACK');
      return rejeitar(409, 'congelado');
    }
    const existente = db.prepare('SELECT * FROM pagamentos WHERE chave_idempotencia = ?').get(dados.chave_idempotencia);
    if (existente) {
      const igual = Number(existente.orcamento_id) === numero
        && Number(existente.valor_centavos) === dados.valor_centavos
        && existente.pago_em === dados.pago_em
        && existente.forma === dados.forma;
      if (!igual) {
        db.exec('ROLLBACK');
        return rejeitar(409, 'chave');
      }
      const totais = totaisDoContrato(db, numero, congelado.valor_contratado_centavos);
      db.exec('COMMIT');
      return Object.assign({ status: 200, repetida: true, pagamento: pagamentoPublico(existente) }, totais);
    }
    const totaisAtuais = totaisDoContrato(db, numero, congelado.valor_contratado_centavos);
    if (dados.valor_centavos > totaisAtuais.pendente_centavos) {
      db.exec('ROLLBACK');
      return rejeitar(409, 'saldo');
    }
    const criado = new Date().toISOString();
    const info = db.prepare(`
      INSERT INTO pagamentos (orcamento_id, valor_centavos, pago_em, forma, chave_idempotencia, criado_em)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(numero, dados.valor_centavos, dados.pago_em, dados.forma, dados.chave_idempotencia, criado);
    const totais = totaisDoContrato(db, numero, congelado.valor_contratado_centavos);
    db.exec('COMMIT');
    return Object.assign({
      status: 201,
      repetida: false,
      pagamento: {
        id: numeroId(info),
        orcamento_id: numero,
        valor_centavos: dados.valor_centavos,
        pago_em: dados.pago_em,
        forma: dados.forma,
        criado_em: criado
      }
    }, totais);
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch (ignorar) { /* a transação já pode ter sido desfeita */ }
    throw e;
  }
}

function congelarNaTransacao(db, orcamento, quando) {
  const centavos = dinheiro.valorContratadoCentavos(orcamento);
  const numero = Number(orcamento.id);
  db.prepare(`
    INSERT INTO financeiro_contratos (orcamento_id, valor_contratado_centavos, congelado_em)
    VALUES (?, ?, ?)
  `).run(numero, centavos, quando);
  return centavos;
}

function inicializarConfirmados(opcoes) {
  const aplicar = !!(opcoes && opcoes.aplicar);
  const db = getDb();
  const rows = db.prepare('SELECT id, payload FROM orcamentos ORDER BY id').all();
  const resultado = { conferidos: [], conflitos: [], aplicados: [] };
  rows.forEach((row) => {
    const orcamento = JSON.parse(row.payload);
    if (!confirmacaoValida(orcamento.gestao_contrato)) return;
    const existe = db.prepare('SELECT 1 AS ok FROM financeiro_contratos WHERE orcamento_id = ?').get(row.id);
    if (existe) return;
    const oficial = dinheiro.valorContratadoCentavos(orcamento);
    const gravado = dinheiro.valorFinalGravadoCentavos(orcamento);
    if (gravado !== oficial) {
      resultado.conflitos.push({ id: Number(row.id), oficial_centavos: oficial, gravado_centavos: gravado });
      return;
    }
    resultado.conferidos.push({ id: Number(row.id), valor_contratado_centavos: oficial });
    if (!aplicar) return;
    db.exec('BEGIN IMMEDIATE');
    try {
      const atualRow = db.prepare('SELECT payload FROM orcamentos WHERE id = ?').get(row.id);
      const atual = JSON.parse(atualRow.payload);
      atual.id = Number(row.id);
      const oficialAtual = dinheiro.valorContratadoCentavos(atual);
      const gravadoAtual = dinheiro.valorFinalGravadoCentavos(atual);
      const ja = db.prepare('SELECT 1 AS ok FROM financeiro_contratos WHERE orcamento_id = ?').get(row.id);
      if (gravadoAtual !== oficialAtual) {
        db.exec('ROLLBACK');
        resultado.conflitos.push({ id: Number(row.id), oficial_centavos: oficialAtual, gravado_centavos: gravadoAtual });
        return;
      }
      if (!ja) {
        congelarNaTransacao(db, atual, new Date().toISOString());
        resultado.aplicados.push(Number(row.id));
      }
      db.exec('COMMIT');
    } catch (e) {
      try { db.exec('ROLLBACK'); } catch (ignorar) { /* a transação já pode ter sido desfeita */ }
      throw e;
    }
  });
  return resultado;
}

module.exports = {
  FORMAS,
  listarContratos,
  detalhar,
  registrarPagamento,
  congelarNaTransacao,
  inicializarConfirmados,
  validarPagamento
};
