const auth = require('./auth');
const financeiroRepo = require('../database/repositories/financeiroRepository');
const demonstrativoPdf = require('./demonstrativoPdf');

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function lerCorpo(req, callback) {
  const partes = [];
  let tamanho = 0;
  let estourou = false;
  req.on('data', (parte) => {
    tamanho += parte.length;
    if (tamanho > 65536) estourou = true;
    else partes.push(parte);
  });
  req.on('end', () => {
    if (estourou) return callback(new Error('limite'));
    const bruto = Buffer.concat(partes).toString('utf8');
    if (!bruto.trim()) return callback(null, null);
    try {
      callback(null, JSON.parse(bruto));
    } catch (e) {
      callback(e);
    }
  });
  req.on('error', () => callback(new Error('corpo')));
}

function mensagem(motivo) {
  const textos = {
    saldo: 'O pagamento ultrapassa o saldo pendente.',
    chave: 'Esta chave de lançamento já foi usada com dados diferentes.',
    confirmacao: 'Contrato não confirmado.',
    identificacao: 'Informe o nome do cliente antes de registrar o pagamento.',
    congelado: 'O valor contratado ainda não foi congelado.',
    motivo: 'Informe o motivo da correção, com pelo menos 3 caracteres.',
    confirmacao_correcao: 'Confirme a correção antes de salvar.',
    sem_mudanca: 'Nenhum dado do pagamento foi alterado.',
    observacao: 'A observação do pagamento é inválida.',
    pagamento: 'Pagamento não encontrado.',
    usuario: 'Usuário responsável não identificado.',
    valor: 'Valor inválido.',
    data: 'Data inválida.',
    forma: 'Forma de pagamento inválida.',
    campos: 'Campos não reconhecidos.',
    chave_formato: 'Chave de lançamento inválida.',
    id: 'Identificador inválido.'
  };
  return textos[motivo] || 'Não foi possível registrar o pagamento.';
}

function responderPagamento(res, resultado) {
  if (!resultado) return sendJson(res, 500, { erro: 'Não foi possível registrar o pagamento.' });
  if (resultado.status === 404) return sendJson(res, 404, { erro: 'Contrato não encontrado.' });
  if (resultado.status === 200 || resultado.status === 201) {
    return sendJson(res, resultado.status, {
      ok: true,
      repetida: resultado.repetida === true,
      pagamento: resultado.pagamento,
      recebido_centavos: resultado.recebido_centavos,
      pendente_centavos: resultado.pendente_centavos
    });
  }
  return sendJson(res, resultado.status, { erro: mensagem(resultado.motivo) });
}

function sendPdf(res, id, buffer) {
  const nome = 'demonstrativo-financeiro-' + id + '.pdf';
  res.writeHead(200, {
    'Content-Type': 'application/pdf',
    'Content-Disposition': 'attachment; filename="' + nome + '"',
    'Content-Length': buffer.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(buffer);
}

function handleFinanceiro(req, res, pathname) {
  const correcao = pathname.match(/^\/api\/financeiro\/contratos\/(\d+)\/pagamentos\/(\d+)\/corrigir\/?$/);
  const demonstrativo = pathname.match(/^\/api\/financeiro\/contratos\/(\d+)\/demonstrativo\/?$/);
  const pagamento = pathname.match(/^\/api\/financeiro\/contratos\/(\d+)\/pagamentos\/?$/);
  const detalhe = pathname.match(/^\/api\/financeiro\/contratos\/(\d+)\/?$/);
  const lista = pathname === '/api/financeiro/contratos' || pathname === '/api/financeiro/contratos/';
  if (!correcao && !demonstrativo && !pagamento && !detalhe && !lista) return false;

  const gravacao = req.method !== 'GET' && req.method !== 'HEAD';
  if (!auth.exigirAdmin(req, res, { csrf: gravacao })) return true;

  if (correcao) {
    if (req.method !== 'POST') {
      sendJson(res, 405, { erro: 'Método não permitido' });
      return true;
    }
    const sessao = auth.resolverSessao(req);
    if (!sessao) {
      sendJson(res, 401, { erro: 'Sessão expirada.' });
      return true;
    }
    lerCorpo(req, (erro, body) => {
      if (erro) return sendJson(res, 400, { erro: 'Não foi possível corrigir o pagamento.' });
      try {
        const resultado = financeiroRepo.corrigirPagamento(correcao[1], correcao[2], body, sessao.usuario_id);
        if (!resultado) return sendJson(res, 500, { erro: 'Não foi possível corrigir o pagamento.' });
        if (resultado.status === 404 && !resultado.motivo) return sendJson(res, 404, { erro: 'Contrato não encontrado.' });
        if (resultado.status !== 200) return sendJson(res, resultado.status, { erro: mensagem(resultado.motivo) });
        return sendJson(res, 200, {
          ok: true,
          pagamento: resultado.pagamento,
          recebido_centavos: resultado.recebido_centavos,
          pendente_centavos: resultado.pendente_centavos,
          retificacao_demonstrativo: resultado.retificacao_demonstrativo === true
        });
      } catch (e) {
        sendJson(res, 500, { erro: 'Não foi possível corrigir o pagamento.' });
      }
    });
    return true;
  }

  if (demonstrativo) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendJson(res, 405, { erro: 'Método não permitido' });
      return true;
    }
    try {
      const emissao = demonstrativoPdf.emitir(demonstrativo[1]);
      if (emissao.status === 404) sendJson(res, 404, { erro: 'Contrato não encontrado.' });
      else if (emissao.status !== 200) sendJson(res, emissao.status, { erro: mensagem(emissao.motivo) });
      else sendPdf(res, emissao.id, emissao.buffer);
    } catch (e) {
      sendJson(res, 500, { erro: 'Não foi possível gerar o demonstrativo.' });
    }
    return true;
  }

  if (lista) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendJson(res, 405, { erro: 'Método não permitido' });
      return true;
    }
    try {
      sendJson(res, 200, financeiroRepo.listarContratos());
    } catch (e) {
      sendJson(res, 500, { erro: 'Não foi possível consultar o financeiro.' });
    }
    return true;
  }

  if (detalhe && !pagamento) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendJson(res, 405, { erro: 'Método não permitido' });
      return true;
    }
    try {
      const resultado = financeiroRepo.detalhar(detalhe[1]);
      if (resultado.status === 404) {
        sendJson(res, 404, { erro: 'Contrato não encontrado.' });
        return true;
      }
      if (resultado.status !== 200) {
        sendJson(res, resultado.status, { erro: mensagem(resultado.motivo) });
        return true;
      }
      sendJson(res, 200, resultado.contrato);
    } catch (e) {
      sendJson(res, 500, { erro: 'Não foi possível consultar o financeiro.' });
    }
    return true;
  }

  if (req.method !== 'POST') {
    sendJson(res, 405, { erro: 'Método não permitido' });
    return true;
  }
  lerCorpo(req, (erro, body) => {
    if (erro) return sendJson(res, 400, { erro: 'Não foi possível registrar o pagamento.' });
    try {
      responderPagamento(res, financeiroRepo.registrarPagamento(pagamento[1], body));
    } catch (e) {
      sendJson(res, 500, { erro: 'Não foi possível registrar o pagamento.' });
    }
  });
  return true;
}

module.exports = { handleFinanceiro };
