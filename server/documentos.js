const auth = require('./auth');
const documentos = require('../database/repositories/documentosRepository');
const orcamentosRepo = require('../database/repositories/orcamentosRepository');
const producaoRepo = require('../database/repositories/producaoRepository');
const financeiroRepo = require('../database/repositories/financeiroRepository');
const logica = require('./producaoLogica');
const propostaOficial = require('./propostaOficial');
const documentoPdf = require('./documentoPdf');

const MOTIVO_EMISSAO = '';

function sendJson(res, status, obj) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(obj));
}

function mensagem(motivo) {
  const textos = {
    tipo: 'Tipo de documento inválido.',
    id: 'Identificador inválido.',
    data: 'Data inválida.',
    motivo: 'Informe o motivo da alteração, com pelo menos 3 caracteres.',
    conteudo: 'Os campos enviados não são válidos para este documento.',
    campo: 'Um dos campos passou do tamanho permitido.',
    preparo: 'A data de preparo deve estar vazia ou no formato AAAA-MM-DD.',
    usuario: 'Sessão sem administrador ativo.',
    documento: 'Documento não encontrado.',
    versao: 'Versão não encontrada.',
    rascunho: 'Já existe um rascunho aberto para este documento.',
    revisao: 'Este rascunho foi atualizado em outra aba. Recarregue antes de salvar.',
    imutavel: 'Esta versão não pode mais ser alterada.',
    orcamento: 'Orçamento não encontrado.',
    confirmacao: 'Este documento exige um contrato confirmado.',
    congelado: 'O demonstrativo exige o valor financeiro congelado.',
    protegido: 'Produtos, quantidades e valores oficiais não podem ser alterados por este rascunho.',
    pdf: 'Esta versão não possui PDF emitido.',
    integridade: 'O arquivo histórico não confere com o hash guardado.',
    chave: 'A chave de emissão é inválida.',
    indisponivel: MOTIVO_EMISSAO
  };
  return textos[motivo] || 'Não foi possível consultar o documento.';
}

function lerJson(req, callback) {
  const partes = [];
  let tamanho = 0;
  let estourou = false;
  req.on('data', (parte) => {
    tamanho += parte.length;
    if (tamanho > 100000) {
      estourou = true;
      return;
    }
    partes.push(parte);
  });
  req.on('end', () => {
    if (estourou) return callback(new Error('limite'));
    const cru = Buffer.concat(partes).toString('utf8');
    if (!cru.trim()) return callback(null, {});
    try {
      callback(null, JSON.parse(cru));
    } catch (e) {
      callback(e);
    }
  });
  req.on('error', () => callback(new Error('corpo')));
}

function responder(res, resultado) {
  if (!resultado || resultado.status === 200 || resultado.status === 201) return false;
  sendJson(res, resultado.status, { erro: mensagem(resultado.motivo) });
  return true;
}

function textoLimitado(valor, maximo) {
  const texto = String(valor == null ? '' : valor).replace(/\s+/g, ' ').trim();
  if (texto.length > maximo) return null;
  return texto;
}

function dataPreparo(valor) {
  const texto = String(valor == null ? '' : valor).trim();
  if (!texto) return '';
  return logica.dataIso(texto);
}

function operacionalDe(body) {
  const origem = body && body.operacional;
  if (!origem || typeof origem !== 'object' || Array.isArray(origem)) return { erro: 'conteudo' };
  const observacoes = textoLimitado(origem.observacoes, 2000);
  const responsavel = textoLimitado(origem.responsavel, 120);
  const montagem = textoLimitado(origem.montagem, 2000);
  const embalagem = textoLimitado(origem.embalagem, 2000);
  const orientacoes = textoLimitado(origem.orientacoes, 2000);
  if ([observacoes, responsavel, montagem, embalagem, orientacoes].indexOf(null) !== -1) return { erro: 'campo' };
  const preparo = dataPreparo(origem.preparo);
  if (preparo === null) return { erro: 'preparo' };
  if (origem.etapas != null && !Array.isArray(origem.etapas)) return { erro: 'conteudo' };
  const etapas = [];
  const lista = Array.isArray(origem.etapas) ? origem.etapas : [];
  if (lista.length > 20) return { erro: 'campo' };
  for (let i = 0; i < lista.length; i++) {
    const item = lista[i];
    if (!item || typeof item !== 'object' || Array.isArray(item)) return { erro: 'conteudo' };
    const titulo = textoLimitado(item.titulo, 80);
    const detalhe = textoLimitado(item.detalhe, 400);
    if (titulo === null || detalhe === null) return { erro: 'campo' };
    if (!titulo && !detalhe) continue;
    etapas.push({ titulo: titulo, detalhe: detalhe });
  }
  return {
    operacional: {
      observacoes: observacoes,
      responsavel: responsavel,
      preparo: preparo,
      montagem: montagem,
      embalagem: embalagem,
      orientacoes: orientacoes,
      etapas: etapas
    }
  };
}

function apresentacaoDe(body) {
  const origem = body && body.apresentacao;
  if (!origem || typeof origem !== 'object' || Array.isArray(origem)) return { erro: 'conteudo' };
  const observacao = textoLimitado(origem.observacao, 500);
  if (observacao === null) return { erro: 'campo' };
  return { apresentacao: { observacao: observacao } };
}

function notaDe(body) {
  if (!body || typeof body !== 'object') return { erro: 'conteudo' };
  const texto = textoLimitado(body.revisao_texto, 2000);
  if (texto === null) return { erro: 'campo' };
  return { revisao_texto: texto };
}

function itemProducao(item) {
  return {
    nome: item.nome,
    quantidade: item.quantidade_texto,
    quantidade_texto: item.quantidade_texto,
    unidade: item.unidade,
    unidade_informada: item.unidade_informada !== false && !!String(item.unidade || '').trim(),
    complementar: !!item.complementar
  };
}

function eventoCongelado(evento) {
  return {
    id: evento.id,
    tipo_evento: evento.tipo_evento,
    data_evento: evento.data_evento,
    data_texto: evento.data_texto,
    convidados: evento.convidados,
    horario_entrega: evento.horario_entrega,
    horario_festa: evento.horario_festa,
    modalidade: evento.modalidade,
    nome_cliente: evento.nome_cliente || null,
    local_festa: evento.local_festa || null,
    cerimonialista: evento.cerimonialista || null,
    suportes: evento.suportes || null,
    observacoes_os: evento.observacoes_os || null,
    avisos: evento.avisos || [],
    itens: (evento.itens || []).map(itemProducao)
  };
}

function oficialFinanceiro(contrato) {
  const historico = (contrato.historico || []).map((item) => ({
    id: item.id,
    pago_em: item.pago_em,
    forma: item.forma,
    valor_centavos: item.valor_centavos
  }));
  const recebido = historico.reduce((soma, item) => soma + Number(item.valor_centavos || 0), 0);
  return {
    id: contrato.id,
    nome_cliente: contrato.nome_cliente,
    tipo_evento: contrato.tipo_evento,
    data_evento: contrato.data_evento,
    congelado: true,
    valor_contratado_centavos: contrato.valor_contratado_centavos,
    recebido_centavos: recebido,
    pendente_centavos: Number(contrato.valor_contratado_centavos) - recebido,
    historico: historico
  };
}

function operacionalVazio() {
  return {
    observacoes: '',
    responsavel: '',
    preparo: '',
    montagem: '',
    embalagem: '',
    orientacoes: '',
    etapas: []
  };
}

function referenciaDe(orcamento) {
  return {
    id: Number(orcamento.id),
    tipo_evento: String(orcamento.tipo_evento || orcamento.evento_tipo || '').replace(/\s+/g, ' ').trim(),
    data_evento: String(orcamento.data_evento || orcamento.evento_data || '').trim(),
    confirmado: logica.confirmado(orcamento),
    itens: (Array.isArray(orcamento.itens) ? orcamento.itens : []).map((item) => ({
      nome: String(item && item.nome || '').replace(/\s+/g, ' ').trim() || 'Nome não informado',
      quantidade: item ? item.quantidade : null,
      unidade: item && String(item.unidade || '').trim() ? String(item.unidade).trim() : 'Unidade não informada'
    }))
  };
}

function conteudoInicial(tipo, documento) {
  if (tipo === 'producao_evento') {
    const evento = producaoRepo.detalhar(documento.orcamento_id);
    if (evento.status !== 200) return evento;
    return {
      status: 200,
      conteudo: {
        contratado: eventoCongelado(evento.evento),
        operacional: operacionalVazio()
      }
    };
  }
  if (tipo === 'producao_dia') {
    const dia = producaoRepo.dia(documento.data_referencia);
    if (dia.status !== 200) return dia;
    return {
      status: 200,
      conteudo: {
        contratado: {
          data: dia.dia.data,
          data_texto: dia.dia.data_texto,
          eventos: (dia.dia.eventos || []).map(eventoCongelado),
          totais: (dia.dia.totais || []).map((item) => ({
            nome: item.nome,
            quantidade: item.quantidade_texto,
            quantidade_texto: item.quantidade_texto,
            unidade: item.unidade
          }))
        },
        operacional: operacionalVazio()
      }
    };
  }
  if (tipo === 'demonstrativo') {
    const financeiro = financeiroRepo.detalhar(documento.orcamento_id);
    if (financeiro.status !== 200) return financeiro;
    if (!financeiro.contrato || financeiro.contrato.congelado !== true) return { status: 409, motivo: 'congelado' };
    const contrato = financeiro.contrato;
    return {
      status: 200,
      conteudo: {
        oficial: oficialFinanceiro(contrato),
        apresentacao: { observacao: '' }
      }
    };
  }
  const orcamento = orcamentosRepo.buscarPorId(documento.orcamento_id);
  if (!orcamento) return { status: 404, motivo: 'orcamento' };
  return {
    status: 200,
    conteudo: {
      referencia: referenciaDe(orcamento),
      proposta: propostaOficial.montar(orcamento),
      revisao_texto: ''
    }
  };
}

function conteudoParaEmissao(tipo, documento, conteudo) {
  if (tipo === 'producao_evento' || tipo === 'producao_dia') {
    return { status: 200, conteudo: conteudo };
  }
  if (tipo === 'demonstrativo') {
    const financeiro = financeiroRepo.detalhar(documento.orcamento_id);
    if (financeiro.status !== 200) return financeiro;
    if (!financeiro.contrato || financeiro.contrato.congelado !== true) return { status: 409, motivo: 'congelado' };
    return {
      status: 200,
      conteudo: {
        oficial: oficialFinanceiro(financeiro.contrato),
        apresentacao: conteudo && conteudo.apresentacao ? conteudo.apresentacao : { observacao: '' }
      }
    };
  }
  const orcamento = orcamentosRepo.buscarPorId(documento.orcamento_id);
  if (!orcamento) return { status: 404, motivo: 'orcamento' };
  if (conteudo && conteudo.proposta && conteudo.proposta.confirmado === true) {
    return {
      status: 200,
      conteudo: {
        referencia: conteudo.referencia,
        proposta: conteudo.proposta,
        revisao_texto: conteudo.revisao_texto || ''
      }
    };
  }
  return {
    status: 200,
    conteudo: {
      referencia: referenciaDe(orcamento),
      proposta: propostaOficial.montar(orcamento),
      revisao_texto: conteudo && conteudo.revisao_texto ? conteudo.revisao_texto : ''
    }
  };
}

function documentoDaVersao(versao) {
  const lista = documentos.listar({});
  return (lista.documentos || []).find((item) => item.id === versao.documento_id) || null;
}

function enviarPdf(res, gerado, nome, previa) {
  res.writeHead(200, {
    'Content-Type': 'application/pdf',
    'Content-Disposition': (previa ? 'inline' : 'attachment') + '; filename="' + nome + '"',
    'Content-Length': gerado.buffer.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Documento-Previa': previa ? 'rascunho' : 'emitida'
  });
  res.end(gerado.buffer);
}

function chaveProtegida(conteudo, body) {
  const chaves = ['contratado', 'oficial', 'referencia', 'proposta', 'itens', 'valores', 'pagamentos'];
  return chaves.some((chave) => {
    if (!Object.prototype.hasOwnProperty.call(body, chave)) return false;
    const atual = conteudo[chave] === undefined ? null : conteudo[chave];
    return documentos.canonico(body[chave]) !== documentos.canonico(atual);
  });
}

function conteudoEditado(tipo, atual, body) {
  if (chaveProtegida(atual, body)) return { status: 409, motivo: 'protegido' };
  const proximo = {
    contratado: atual.contratado,
    oficial: atual.oficial,
    referencia: atual.referencia
  };
  if (tipo === 'producao_evento' || tipo === 'producao_dia') {
    const operacional = operacionalDe(body);
    if (operacional.erro) return { status: 400, motivo: operacional.erro };
    proximo.operacional = operacional.operacional;
    delete proximo.oficial;
    delete proximo.referencia;
    if (tipo === 'producao_evento') delete proximo.totais;
  } else if (tipo === 'demonstrativo') {
    const apresentacao = apresentacaoDe(body);
    if (apresentacao.erro) return { status: 400, motivo: apresentacao.erro };
    proximo.apresentacao = apresentacao.apresentacao;
    delete proximo.contratado;
    delete proximo.referencia;
  } else {
    const nota = notaDe(body);
    if (nota.erro) return { status: 400, motivo: nota.erro };
    proximo.revisao_texto = nota.revisao_texto;
    proximo.proposta = atual.proposta;
    delete proximo.contratado;
    delete proximo.oficial;
  }
  Object.keys(proximo).forEach((chave) => {
    if (proximo[chave] === undefined) delete proximo[chave];
  });
  return { status: 200, conteudo: proximo };
}

function usuarioDaSessao(req) {
  const sessao = auth.resolverSessao(req);
  return sessao ? sessao.usuario_id : null;
}

function documentoPorId(id) {
  const historico = documentos.historico(id);
  if (historico.status !== 200) return historico;
  const lista = documentos.listar({});
  const item = (lista.documentos || []).find((doc) => doc.id === Number(id));
  if (!item) return { status: 404, motivo: 'documento' };
  const rascunho = documentos.consultarRascunho(id);
  return {
    status: 200,
    documento: item,
    rascunho: rascunho.status === 200 ? rascunho.versao : null,
    versoes: historico.status === 200 ? historico.versoes : [],
    emissao_disponivel: true,
    motivo_emissao: MOTIVO_EMISSAO
  };
}

function criarLogico(body) {
  const tipo = body && body.tipo;
  if (tipo === 'producao_dia') {
    return documentos.criarDocumento({ tipo: tipo, data: body.data });
  }
  const orcamento = orcamentosRepo.buscarPorId(body && body.orcamentoId);
  if (!orcamento) return { status: 404, motivo: 'orcamento' };
  if ((tipo === 'producao_evento' || tipo === 'demonstrativo') && !logica.confirmado(orcamento)) {
    return { status: 409, motivo: 'confirmacao' };
  }
  if (tipo === 'demonstrativo') {
    const financeiro = financeiroRepo.detalhar(orcamento.id);
    if (!financeiro.contrato || financeiro.contrato.congelado !== true) return { status: 409, motivo: 'congelado' };
  }
  return documentos.criarDocumento({ tipo: tipo, orcamentoId: orcamento.id });
}

function handleDocumentos(req, res, pathname) {
  const pdf = pathname.match(/^\/api\/documentos\/versoes\/(\d+)\/pdf\/?$/);
  const previa = pathname.match(/^\/api\/documentos\/versoes\/(\d+)\/previa\/?$/);
  const emitir = pathname.match(/^\/api\/documentos\/versoes\/(\d+)\/emitir\/?$/);
  const descartar = pathname.match(/^\/api\/documentos\/versoes\/(\d+)\/descartar\/?$/);
  const comparar = pathname.match(/^\/api\/documentos\/versoes\/(\d+)\/comparar\/(\d+)\/?$/);
  const versao = pathname.match(/^\/api\/documentos\/versoes\/(\d+)\/?$/);
  const rascunho = pathname.match(/^\/api\/documentos\/(\d+)\/rascunho\/?$/);
  const historico = pathname.match(/^\/api\/documentos\/(\d+)\/versoes\/?$/);
  const um = pathname.match(/^\/api\/documentos\/(\d+)\/?$/);
  const lista = pathname === '/api/documentos' || pathname === '/api/documentos/';
  if (!pdf && !previa && !emitir && !descartar && !comparar && !versao && !rascunho && !historico && !um && !lista) {
    return false;
  }

  const gravacao = req.method !== 'GET' && req.method !== 'HEAD';
  if (!auth.exigirAdmin(req, res, { csrf: gravacao })) return true;
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'POST' && req.method !== 'PATCH') {
    sendJson(res, 405, { erro: 'Método não permitido' });
    return true;
  }

  try {
    if (lista && req.method === 'GET') {
      const url = new URL(req.url || '/', 'http://localhost');
      const resultado = documentos.listar({
        tipo: url.searchParams.get('tipo') || '',
        busca: url.searchParams.get('q') || ''
      });
      if (responder(res, resultado)) return true;
      sendJson(res, 200, {
        documentos: resultado.documentos,
        emissao_disponivel: true,
        motivo_emissao: MOTIVO_EMISSAO
      });
      return true;
    }
    if (lista && req.method === 'POST') {
      return lerJson(req, (erro, body) => {
        if (erro) return sendJson(res, 400, { erro: 'Não foi possível ler os dados.' });
        try {
          const resultado = criarLogico(body);
          if (responder(res, resultado)) return;
          sendJson(res, resultado.status, { documento: resultado.documento, repetido: resultado.repetido === true });
        } catch (e) {
          sendJson(res, 503, { erro: 'O histórico de documentos ainda não está ativo neste banco.' });
        }
      }), true;
    }
    if (pdf) {
      if (gravacao) {
        sendJson(res, 405, { erro: 'Método não permitido' });
        return true;
      }
      const arquivo = documentos.lerPdf(pdf[1]);
      if (responder(res, arquivo)) return true;
      res.writeHead(200, {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="' + arquivo.arquivo + '"',
        'Content-Length': arquivo.buffer.length,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff'
      });
      res.end(arquivo.buffer);
      return true;
    }
    if (previa) {
      if (gravacao) {
        sendJson(res, 405, { erro: 'Método não permitido' });
        return true;
      }
      const consulta = documentos.consultarVersao(previa[1]);
      if (responder(res, consulta)) return true;
      const docPrevia = documentoDaVersao(consulta.versao);
      if (!docPrevia) {
        sendJson(res, 404, { erro: mensagem('documento') });
        return true;
      }
      let previaPdf;
      try {
        previaPdf = documentoPdf.gerar(docPrevia.tipo, consulta.versao.conteudo, { rascunho: true });
      } catch (e) {
        sendJson(res, 500, { erro: 'Não foi possível gerar a pré-visualização.' });
        return true;
      }
      Promise.resolve(previaPdf).then((gerado) => {
        enviarPdf(res, gerado, 'previa-rascunho.pdf', true);
      }).catch(() => {
        sendJson(res, 500, { erro: 'Não foi possível gerar a pré-visualização.' });
      });
      return true;
    }
    if (comparar) {
      if (gravacao) {
        sendJson(res, 405, { erro: 'Método não permitido' });
        return true;
      }
      const resultado = documentos.comparar(comparar[1], comparar[2]);
      if (responder(res, resultado)) return true;
      sendJson(res, 200, resultado);
      return true;
    }
    if (emitir) {
      if (req.method !== 'POST') {
        sendJson(res, 405, { erro: 'Método não permitido' });
        return true;
      }
      return lerJson(req, (erro, body) => {
        if (erro) return sendJson(res, 400, { erro: 'Não foi possível ler os dados.' });
        const chave = body && body.chave;
        if (typeof chave !== 'string' || !/^[A-Za-z0-9_-]{16,80}$/.test(chave)) {
          return sendJson(res, 400, { erro: mensagem('chave') });
        }
        const reserva = documentos.consultaChave(emitir[1], chave);
        if (reserva.status === 200) return sendJson(res, 200, { versao: reserva.versao, repetida: true });
        if (reserva.status !== 204) return sendJson(res, reserva.status, { erro: mensagem(reserva.motivo) });
        const consulta = documentos.consultarVersao(emitir[1]);
        if (responder(res, consulta)) return;
        if (consulta.versao.estado !== 'rascunho') return sendJson(res, 409, { erro: mensagem('imutavel') });
        if (Number(consulta.versao.revisao) !== Number(body.revisao)) return sendJson(res, 409, { erro: mensagem('revisao') });
        const docEmissao = documentoDaVersao(consulta.versao);
        if (!docEmissao) return sendJson(res, 404, { erro: mensagem('documento') });
        const canonico = conteudoParaEmissao(docEmissao.tipo, docEmissao, consulta.versao.conteudo);
        if (responder(res, canonico)) return;
        let geracaoPdf;
        try {
          geracaoPdf = documentoPdf.gerar(docEmissao.tipo, canonico.conteudo, { rascunho: false });
        } catch (e) {
          return sendJson(res, 500, { erro: 'Não foi possível gerar o PDF. Nenhuma versão foi emitida.' });
        }
        Promise.resolve(geracaoPdf).then((gerado) => {
          try {
            const resultado = documentos.emitir({
              versaoId: emitir[1],
              revisao: body.revisao,
              chave: chave,
              pdf: gerado.buffer,
              conteudo: canonico.conteudo
            });
            if (responder(res, resultado)) return;
            sendJson(res, resultado.status, { versao: resultado.versao, repetida: resultado.repetida === true });
          } catch (e) {
            sendJson(res, 500, { erro: 'Não foi possível gravar o PDF. Nenhuma versão foi emitida.' });
          }
        }).catch(() => {
          sendJson(res, 500, { erro: 'Não foi possível gerar o PDF. Nenhuma versão foi emitida.' });
        });
      }), true;
    }
    if (descartar) {
      if (req.method !== 'POST') {
        sendJson(res, 405, { erro: 'Método não permitido' });
        return true;
      }
      return lerJson(req, (erro, body) => {
        if (erro) return sendJson(res, 400, { erro: 'Não foi possível ler os dados.' });
        try {
          const resultado = documentos.descartarRascunho({
            versaoId: descartar[1],
            revisao: body && body.revisao,
            motivo: body && body.motivo
          });
          if (responder(res, resultado)) return;
          sendJson(res, 200, { versao: resultado.versao });
        } catch (e) {
          sendJson(res, 503, { erro: 'O histórico de documentos ainda não está ativo neste banco.' });
        }
      }), true;
    }
    if (versao && req.method === 'PATCH') {
      return lerJson(req, (erro, body) => {
        if (erro) return sendJson(res, 400, { erro: 'Não foi possível ler os dados.' });
        try {
          const consulta = documentos.consultarVersao(versao[1]);
          if (responder(res, consulta)) return;
          const aberto = documentos.consultarRascunho(consulta.versao.documento_id);
          if (aberto.status !== 200 || aberto.versao.id !== consulta.versao.id) {
            return sendJson(res, 409, { erro: mensagem('imutavel') });
          }
          const lista = documentos.listar({});
          const doc = (lista.documentos || []).find((item) => item.id === consulta.versao.documento_id);
          const editado = conteudoEditado(doc.tipo, consulta.versao.conteudo, body || {});
          if (editado.status !== 200) return sendJson(res, editado.status, { erro: mensagem(editado.motivo) });
          const resultado = documentos.atualizarRascunho({
            versaoId: versao[1],
            revisao: body && body.revisao,
            motivo: body && body.motivo,
            conteudo: editado.conteudo
          });
          if (responder(res, resultado)) return;
          sendJson(res, 200, { versao: resultado.versao });
        } catch (e) {
          sendJson(res, 503, { erro: 'O histórico de documentos ainda não está ativo neste banco.' });
        }
      }), true;
    }
    if (versao && req.method === 'GET') {
      const consulta = documentos.consultarVersao(versao[1]);
      if (responder(res, consulta)) return true;
      sendJson(res, 200, { versao: consulta.versao, emissao_disponivel: true, motivo_emissao: MOTIVO_EMISSAO });
      return true;
    }
    if (rascunho && req.method === 'POST') {
      return lerJson(req, (erro, body) => {
        if (erro) return sendJson(res, 400, { erro: 'Não foi possível ler os dados.' });
        try {
          const detalhe = documentoPorId(rascunho[1]);
          if (responder(res, detalhe)) return;
          const inicial = conteudoInicial(detalhe.documento.tipo, detalhe.documento);
          if (inicial.status !== 200) return sendJson(res, inicial.status, { erro: mensagem(inicial.motivo) });
          const resultado = documentos.criarRascunho({
            documentoId: detalhe.documento.id,
            usuarioId: usuarioDaSessao(req),
            motivo: body && body.motivo,
            conteudo: inicial.conteudo
          });
          if (responder(res, resultado)) return;
          sendJson(res, 201, { versao: resultado.versao });
        } catch (e) {
          sendJson(res, 503, { erro: 'O histórico de documentos ainda não está ativo neste banco.' });
        }
      }), true;
    }
    if (historico && req.method === 'GET') {
      const resultado = documentos.historico(historico[1]);
      if (responder(res, resultado)) return true;
      sendJson(res, 200, { versoes: resultado.versoes });
      return true;
    }
    if (um && req.method === 'GET') {
      const resultado = documentoPorId(um[1]);
      if (responder(res, resultado)) return true;
      sendJson(res, 200, resultado);
      return true;
    }
    sendJson(res, 405, { erro: 'Método não permitido' });
  } catch (e) {
    sendJson(res, 503, { erro: 'O histórico de documentos ainda não está ativo neste banco.' });
  }
  return true;
}

module.exports = { handleDocumentos: handleDocumentos, MOTIVO_EMISSAO: MOTIVO_EMISSAO };
