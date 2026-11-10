const { getDb } = require('../db');
const dinheiro = require('../dinheiro');
const { dataEventoIso: dataDoEvento, dataIso } = require('../dataEvento');

const FORMAS = ['pix', 'dinheiro', 'transferencia', 'cartao', 'boleto', 'outro'];
const CAMPOS_PAGAMENTO = ['valor_centavos', 'pago_em', 'forma', 'chave_idempotencia'];
const CAMPOS_PAGAMENTO_OPCIONAIS = ['observacao'];

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

function tipoEvento(orcamento) {
  return String((orcamento && (orcamento.tipo_evento || orcamento.evento_tipo)) || '').trim();
}

function dataEventoIso(orcamento) {
  return dataDoEvento(orcamento);
}

function hojeLocal(referencia) {
  const data = referencia || new Date();
  const mes = String(data.getMonth() + 1).padStart(2, '0');
  const dia = String(data.getDate()).padStart(2, '0');
  return data.getFullYear() + '-' + mes + '-' + dia;
}

function dataCivilValida(texto, referencia) {
  const iso = dataIso(texto);
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

function fichaAntecipada(ficha) {
  return !!(ficha && (ficha.situacao === 'antecipado' || Number(ficha.congelado) === 0));
}

function valorVigente(orcamento, ficha) {
  if (ficha && !fichaAntecipada(ficha) && confirmacaoValida(orcamento.gestao_contrato)) {
    return Number(ficha.valor_contratado_centavos);
  }
  return dinheiro.valorContratadoCentavos(orcamento);
}

function resumoContrato(orcamento, ficha, recebido) {
  const confirmado = confirmacaoValida(orcamento.gestao_contrato);
  const base = {
    id: Number(orcamento.id),
    nome_cliente: nomeCliente(orcamento),
    data_evento: dataEventoIso(orcamento),
    situacao: confirmado ? 'confirmado' : 'negociacao',
    congelado: false
  };
  if (confirmado && !ficha) return base;
  if (!confirmado && !ficha) {
    const vivo = dinheiro.valorContratadoCentavos(orcamento);
    const recebidos = Number(recebido) || 0;
    const pendente = vivo - recebidos;
    return Object.assign(base, {
      valor_atual_centavos: vivo,
      valor_contratado_centavos: vivo,
      recebido_centavos: recebidos,
      pendente_centavos: pendente,
      credito_centavos: pendente < 0 ? -pendente : 0
    });
  }
  const antecipado = !confirmado || fichaAntecipada(ficha);
  const contratado = valorVigente(orcamento, antecipado ? null : ficha);
  const recebidos = Number(recebido) || 0;
  const pendente = contratado - recebidos;
  return Object.assign(base, {
    situacao: antecipado ? 'antecipado' : 'confirmado',
    congelado: !antecipado,
    valor_atual_centavos: contratado,
    valor_contratado_centavos: contratado,
    recebido_centavos: recebidos,
    pendente_centavos: pendente,
    credito_centavos: pendente < 0 ? -pendente : 0,
    congelado_em: !antecipado && ficha ? ficha.congelado_em : null
  });
}

function lerOrcamentos(db) {
  return db.prepare('SELECT id, payload FROM orcamentos ORDER BY id DESC').all().map((row) => {
    const orcamento = JSON.parse(row.payload);
    orcamento.id = Number(row.id);
    return orcamento;
  });
}

function ordenarFinanceiro(lista) {
  return lista.sort((a, b) => {
    if (a.data_evento && b.data_evento && a.data_evento !== b.data_evento) {
      return a.data_evento < b.data_evento ? -1 : 1;
    }
    if (a.data_evento && !b.data_evento) return -1;
    if (!a.data_evento && b.data_evento) return 1;
    return b.id - a.id;
  });
}

function somarTotais(lista, incluir) {
  return lista.reduce((soma, contrato) => {
    if (!incluir(contrato)) return soma;
    soma.contratado_centavos += contrato.valor_contratado_centavos;
    soma.recebido_centavos += contrato.recebido_centavos;
    soma.pendente_centavos += contrato.pendente_centavos;
    return soma;
  }, { contratado_centavos: 0, recebido_centavos: 0, pendente_centavos: 0 });
}

function listarContratos() {
  const db = getDb();
  const fichas = new Map();
  db.prepare(`
    SELECT orcamento_id, valor_contratado_centavos, congelado_em, situacao, congelado
    FROM financeiro_contratos
  `).all().forEach((row) => fichas.set(Number(row.orcamento_id), row));
  const recebidos = mapaRecebidos(db);
  const orcamentos = lerOrcamentos(db);
  const contratos = ordenarFinanceiro(orcamentos
    .filter((orcamento) => confirmacaoValida(orcamento.gestao_contrato))
    .map((orcamento) => resumoContrato(
      orcamento,
      fichas.get(Number(orcamento.id)) || null,
      recebidos.get(Number(orcamento.id)) || 0
    )));
  const antecipados = ordenarFinanceiro(orcamentos
    .filter((orcamento) => !confirmacaoValida(orcamento.gestao_contrato) && fichas.has(Number(orcamento.id)))
    .map((orcamento) => resumoContrato(
      orcamento,
      fichas.get(Number(orcamento.id)),
      recebidos.get(Number(orcamento.id)) || 0
    )));
  return {
    contratos: contratos,
    antecipados: antecipados,
    totais: somarTotais(contratos, (contrato) => contrato.congelado),
    totais_antecipados: somarTotais(antecipados, () => true)
  };
}

function detalhar(id) {
  const numero = Number(id);
  if (!Number.isSafeInteger(numero) || numero <= 0) return { status: 400, motivo: 'id' };
  const dbBusca = getDb();
  const linha = dbBusca.prepare('SELECT id, payload FROM orcamentos WHERE id = ?').get(numero);
  if (!linha) return { status: 404 };
  const orcamento = JSON.parse(linha.payload);
  orcamento.id = numero;
  const db = getDb();
  const ficha = db.prepare(`
    SELECT orcamento_id, valor_contratado_centavos, congelado_em, situacao, congelado
    FROM financeiro_contratos
    WHERE orcamento_id = ?
  `).get(numero);
  if (!confirmacaoValida(orcamento.gestao_contrato) && !nomeCliente(orcamento)) {
    return { status: 409, motivo: 'identificacao' };
  }
  const historico = db.prepare(`
    SELECT id, valor_centavos, pago_em, forma, observacao, criado_em
    FROM pagamentos
    WHERE orcamento_id = ?
    ORDER BY pago_em ASC, id ASC
  `).all(numero).map((row) => ({
    id: Number(row.id),
    valor_centavos: Number(row.valor_centavos),
    pago_em: row.pago_em,
    forma: row.forma,
    observacao: row.observacao || null,
    criado_em: row.criado_em
  }));
  const recebido = historico.reduce((soma, item) => soma + item.valor_centavos, 0);
  const correcoes = db.prepare(`
    SELECT c.id, c.pagamento_id, c.valor_anterior_centavos, c.valor_novo_centavos,
           c.pago_em_anterior, c.pago_em_novo, c.forma_anterior, c.forma_nova,
           c.observacao_anterior, c.observacao_nova, c.motivo, c.usuario_nome, c.corrigido_em
    FROM pagamento_correcoes c
    JOIN pagamentos p ON p.id = c.pagamento_id
    WHERE p.orcamento_id = ?
    ORDER BY c.id ASC
  `).all(numero).map((row) => ({
    id: Number(row.id),
    pagamento_id: Number(row.pagamento_id),
    valor_anterior_centavos: Number(row.valor_anterior_centavos),
    valor_novo_centavos: Number(row.valor_novo_centavos),
    pago_em_anterior: row.pago_em_anterior,
    pago_em_novo: row.pago_em_novo,
    forma_anterior: row.forma_anterior,
    forma_nova: row.forma_nova,
    observacao_anterior: row.observacao_anterior || null,
    observacao_nova: row.observacao_nova || null,
    motivo: row.motivo,
    usuario_nome: row.usuario_nome,
    corrigido_em: row.corrigido_em
  }));
  const retificacao = !!db.prepare(`
    SELECT 1 AS ok
    FROM documento_versoes v
    JOIN documentos d ON d.id = v.documento_id
    WHERE d.orcamento_id = ? AND d.tipo = 'demonstrativo' AND v.estado = 'emitida'
    LIMIT 1
  `).get(numero);
  return {
    status: 200,
    contrato: Object.assign(resumoContrato(orcamento, ficha, recebido), {
      tipo_evento: tipoEvento(orcamento),
      entrada_prevista_centavos: dinheiro.entradaPrevistaCentavos(orcamento),
      historico: historico,
      correcoes: correcoes,
      retificacao_demonstrativo: retificacao
    })
  };
}

function rejeitar(status, motivo) {
  return { status: status, motivo: motivo };
}

function lerObservacao(valor) {
  if (valor == null || valor === '') return null;
  if (typeof valor !== 'string') return undefined;
  const texto = valor.replace(/\r\n/g, '\n').trim();
  if (!texto) return null;
  if (texto.indexOf('\0') !== -1 || texto.length > 500) return undefined;
  return texto;
}

function validarPagamento(body, referencia) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return rejeitar(400, 'campos');
  const chaves = Object.keys(body);
  const permitidos = CAMPOS_PAGAMENTO.concat(CAMPOS_PAGAMENTO_OPCIONAIS);
  if (CAMPOS_PAGAMENTO.some((campo) => !Object.prototype.hasOwnProperty.call(body, campo))) return rejeitar(400, 'campos');
  if (chaves.some((campo) => permitidos.indexOf(campo) === -1)) return rejeitar(400, 'campos');
  const valor = body.valor_centavos;
  if (typeof valor !== 'number' || !Number.isSafeInteger(valor) || valor <= 0) return rejeitar(400, 'valor');
  if (typeof body.pago_em !== 'string' || !dataCivilValida(body.pago_em, referencia)) return rejeitar(400, 'data');
  if (typeof body.forma !== 'string' || FORMAS.indexOf(body.forma) === -1) return rejeitar(400, 'forma');
  if (typeof body.chave_idempotencia !== 'string' || !/^[A-Za-z0-9_-]{16,80}$/.test(body.chave_idempotencia)) {
    return rejeitar(400, 'chave_formato');
  }
  const observacao = lerObservacao(body.observacao);
  if (observacao === undefined) return rejeitar(400, 'observacao');
  return {
    status: 200,
    dados: {
      valor_centavos: valor,
      pago_em: body.pago_em,
      forma: body.forma,
      chave_idempotencia: body.chave_idempotencia,
      observacao: observacao
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
    observacao: row.observacao || null,
    criado_em: row.criado_em
  };
}

function garantirFicha(db, orcamento, confirmado) {
  const numero = Number(orcamento.id);
  let ficha = db.prepare(`
    SELECT valor_contratado_centavos, situacao, congelado
    FROM financeiro_contratos WHERE orcamento_id = ?
  `).get(numero);
  if (confirmado && !ficha) return null;
  if (!ficha) {
    const agora = new Date().toISOString();
    const centavos = dinheiro.valorContratadoCentavos(orcamento);
    db.prepare(`
      INSERT INTO financeiro_contratos (
        orcamento_id, valor_contratado_centavos, congelado_em, situacao, congelado
      ) VALUES (?, ?, ?, 'antecipado', 0)
    `).run(numero, centavos, agora);
    ficha = { valor_contratado_centavos: centavos, situacao: 'antecipado', congelado: 0 };
  }
  return ficha;
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
    atual.id = numero;
    const confirmado = confirmacaoValida(atual.gestao_contrato);
    if (!confirmado && !nomeCliente(atual)) {
      db.exec('ROLLBACK');
      return rejeitar(409, 'identificacao');
    }
    const ficha = garantirFicha(db, atual, confirmado);
    if (!ficha) {
      db.exec('ROLLBACK');
      return rejeitar(409, 'congelado');
    }
    const valorBase = valorVigente(atual, ficha);
    const existente = db.prepare('SELECT * FROM pagamentos WHERE chave_idempotencia = ?').get(dados.chave_idempotencia);
    if (existente) {
      const igual = Number(existente.orcamento_id) === numero
        && Number(existente.valor_centavos) === dados.valor_centavos
        && existente.pago_em === dados.pago_em
        && existente.forma === dados.forma
        && (existente.observacao || null) === dados.observacao;
      if (!igual) {
        db.exec('ROLLBACK');
        return rejeitar(409, 'chave');
      }
      const totais = totaisDoContrato(db, numero, valorBase);
      db.exec('COMMIT');
      return Object.assign({ status: 200, repetida: true, pagamento: pagamentoPublico(existente) }, totais);
    }
    const totaisAtuais = totaisDoContrato(db, numero, valorBase);
    if (confirmado && Number(ficha.congelado) !== 0 && dados.valor_centavos > totaisAtuais.pendente_centavos) {
      db.exec('ROLLBACK');
      return rejeitar(409, 'saldo');
    }
    const criado = new Date().toISOString();
    const info = db.prepare(`
      INSERT INTO pagamentos (
        orcamento_id, valor_centavos, pago_em, forma, chave_idempotencia, criado_em, observacao
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(numero, dados.valor_centavos, dados.pago_em, dados.forma, dados.chave_idempotencia, criado, dados.observacao);
    const totais = totaisDoContrato(db, numero, valorBase);
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
        observacao: dados.observacao,
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

function motivoTexto(valor) {
  if (typeof valor !== 'string') return null;
  const texto = valor.replace(/\r\n/g, '\n').trim();
  if (texto.length < 3 || texto.length > 500 || texto.indexOf('\0') !== -1) return null;
  return texto;
}

function demonstrativoEmitido(db, orcamentoId) {
  return !!db.prepare(`
    SELECT 1 AS ok
    FROM documento_versoes v
    JOIN documentos d ON d.id = v.documento_id
    WHERE d.orcamento_id = ? AND d.tipo = 'demonstrativo' AND v.estado = 'emitida'
    LIMIT 1
  `).get(orcamentoId);
}

function corrigirPagamento(orcamentoId, pagamentoId, body, usuarioId, referencia) {
  const numero = Number(orcamentoId);
  const pagamento = Number(pagamentoId);
  const usuario = Number(usuarioId);
  if (!Number.isSafeInteger(numero) || numero <= 0) return rejeitar(400, 'id');
  if (!Number.isSafeInteger(pagamento) || pagamento <= 0) return rejeitar(400, 'id');
  if (!Number.isSafeInteger(usuario) || usuario <= 0) return rejeitar(400, 'usuario');
  if (!body || typeof body !== 'object' || Array.isArray(body)) return rejeitar(400, 'campos');
  if (body.confirmacao !== true) return rejeitar(400, 'confirmacao_correcao');
  const motivo = motivoTexto(body.motivo);
  if (!motivo) return rejeitar(400, 'motivo');
  const valor = body.valor_centavos;
  if (typeof valor !== 'number' || !Number.isSafeInteger(valor) || valor <= 0) return rejeitar(400, 'valor');
  if (typeof body.pago_em !== 'string' || !dataCivilValida(body.pago_em, referencia)) return rejeitar(400, 'data');
  if (typeof body.forma !== 'string' || FORMAS.indexOf(body.forma) === -1) return rejeitar(400, 'forma');
  const observacao = lerObservacao(body.observacao);
  if (observacao === undefined) return rejeitar(400, 'observacao');
  const db = getDb();
  db.exec('BEGIN IMMEDIATE');
  try {
    const pessoa = db.prepare('SELECT id, usuario FROM admin_usuarios WHERE id = ? AND ativo = 1').get(usuario);
    const row = db.prepare('SELECT payload FROM orcamentos WHERE id = ?').get(numero);
    const atualPagamento = db.prepare('SELECT * FROM pagamentos WHERE id = ? AND orcamento_id = ?').get(pagamento, numero);
    if (!pessoa || !row || !atualPagamento) {
      db.exec('ROLLBACK');
      if (!row) return { status: 404 };
      if (!atualPagamento) return rejeitar(404, 'pagamento');
      return rejeitar(400, 'usuario');
    }
    const igual = Number(atualPagamento.valor_centavos) === valor
      && atualPagamento.pago_em === body.pago_em
      && atualPagamento.forma === body.forma
      && (atualPagamento.observacao || null) === observacao;
    if (igual) {
      db.exec('ROLLBACK');
      return rejeitar(400, 'sem_mudanca');
    }
    const agora = new Date().toISOString();
    db.prepare(`
      INSERT INTO pagamento_correcoes (
        pagamento_id, valor_anterior_centavos, pago_em_anterior, forma_anterior, observacao_anterior,
        valor_novo_centavos, pago_em_novo, forma_nova, observacao_nova,
        motivo, usuario_id, usuario_nome, corrigido_em
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      pagamento,
      Number(atualPagamento.valor_centavos),
      atualPagamento.pago_em,
      atualPagamento.forma,
      atualPagamento.observacao || null,
      valor,
      body.pago_em,
      body.forma,
      observacao,
      motivo,
      pessoa.id,
      pessoa.usuario,
      agora
    );
    db.prepare(`
      UPDATE pagamentos
      SET valor_centavos = ?, pago_em = ?, forma = ?, observacao = ?
      WHERE id = ? AND orcamento_id = ?
    `).run(valor, body.pago_em, body.forma, observacao, pagamento, numero);
    const orcamento = JSON.parse(row.payload);
    orcamento.id = numero;
    const ficha = db.prepare(`
      SELECT valor_contratado_centavos, situacao, congelado
      FROM financeiro_contratos WHERE orcamento_id = ?
    `).get(numero);
    const totais = totaisDoContrato(db, numero, valorVigente(orcamento, ficha));
    const retificacao = demonstrativoEmitido(db, numero);
    db.exec('COMMIT');
    return Object.assign({
      status: 200,
      retificacao_demonstrativo: retificacao,
      pagamento: {
        id: pagamento,
        orcamento_id: numero,
        valor_centavos: valor,
        pago_em: body.pago_em,
        forma: body.forma,
        observacao: observacao
      }
    }, totais);
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch (ignorar) { /* a transação já pode ter sido desfeita */ }
    throw e;
  }
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
  corrigirPagamento,
  congelarNaTransacao,
  inicializarConfirmados,
  validarPagamento
};
