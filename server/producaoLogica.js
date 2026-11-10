const { dataIso: dataIsoUnica, dataEventoIso } = require('../database/dataEvento');
const doces = require('../js/doces-quantidade');

const MODALIDADES = {
  'Apenas retirada dos doces sem entrega': 'Retirada',
  'Apenas entrega sem montagem': 'Entrega',
  'Entrega dos doces com montagem - suportes da decoração': 'Entrega com montagem',
  'Entrega dos doces com montagem - suportes cortesia': 'Entrega com montagem e suportes cortesia',
  Entrega: 'Entrega',
  Retirada: 'Retirada'
};

function confirmado(orcamento) {
  const gestao = orcamento && orcamento.gestao_contrato;
  return !!(
    gestao &&
    gestao.status === 'confirmado' &&
    typeof gestao.confirmado_em === 'string' &&
    /^\d{4}-\d{2}-\d{2}T/.test(gestao.confirmado_em)
  );
}

function dataIso(valor) {
  return dataIsoUnica(valor);
}

function formatarIso(iso) {
  if (!iso) return null;
  return iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4);
}

function textoLimpo(valor) {
  return String(valor == null ? '' : valor).replace(/\s+/g, ' ').trim();
}

function textoLivre(valor) {
  const texto = String(valor == null ? '' : valor).replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').trim();
  return texto || null;
}

function chaveNome(nome) {
  return textoLimpo(nome).toLocaleLowerCase('pt-BR');
}

function formatarQuantidade(valor) {
  if (!Number.isFinite(valor)) return null;
  const ajustado = Math.round(valor * 10000) / 10000;
  if (Number.isInteger(ajustado)) return String(ajustado);
  return String(ajustado).replace('.', ',').replace(/,?0+$/, '');
}

function lerQuantidade(valor) {
  if (typeof valor === 'number' && Number.isFinite(valor) && valor > 0) {
    return { valida: true, valor: valor };
  }
  if (typeof valor === 'string') {
    const texto = valor.trim();
    if (/^\d+$/.test(texto)) return { valida: true, valor: Number(texto) };
    if (/^\d+,\d+$/.test(texto)) {
      const numero = Number(texto.replace(',', '.'));
      if (Number.isFinite(numero) && numero > 0) return { valida: true, valor: numero };
    }
  }
  return { valida: false, valor: null };
}

function lerUnidade(item) {
  if (!item || item.unidade == null) {
    return { informada: false, texto: '' };
  }
  const texto = String(item.unidade).trim();
  if (!texto) return { informada: false, texto: '' };
  return { informada: true, texto: texto };
}

function normalizarItem(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    return {
      nome: 'Nome não informado',
      quantidade: null,
      quantidade_texto: 'Conferência necessária',
      unidade: '',
      unidade_informada: false,
      complementar: false,
      valido: false,
      conferencia: true
    };
  }
  const nome = textoLimpo(item.nome);
  const quantidade = lerQuantidade(item.quantidade);
  const unidade = lerUnidade(item);
  const valido = !!nome && quantidade.valida;
  return {
    nome: nome || 'Nome não informado',
    quantidade: valido ? quantidade.valor : null,
    quantidade_texto: valido ? formatarQuantidade(quantidade.valor) : 'Conferência necessária',
    unidade: unidade.informada ? unidade.texto : '',
    unidade_informada: unidade.informada,
    complementar: item.extra_pedido_admin === true,
    sabor: textoLimpo(item.sabor),
    valido: valido,
    conferencia: !valido
  };
}

function lerHorario(valor) {
  const texto = String(valor == null ? '' : valor).trim();
  if (!texto) return null;
  const valido = /^([01]\d|2[0-3]):[0-5]\d$/.test(texto);
  return {
    valido: valido,
    texto: valido ? texto : null,
    original: texto.length <= 16 ? texto : null,
    conferencia: !valido
  };
}

function lerConvidados(valor) {
  if (valor == null || valor === '') return { valor: null, conferencia: false };
  if (typeof valor === 'number' && Number.isInteger(valor) && valor >= 0) {
    return { valor: valor, conferencia: false };
  }
  if (typeof valor === 'string' && /^\d+$/.test(valor.trim())) {
    return { valor: Number(valor.trim()), conferencia: false };
  }
  return { valor: null, conferencia: true };
}

function lerModalidade(orcamento) {
  const suporte = String(orcamento && orcamento.entrega_suporte || '').trim();
  if (suporte && Object.prototype.hasOwnProperty.call(MODALIDADES, suporte)) {
    return { texto: MODALIDADES[suporte], conferencia: false };
  }
  if (!suporte) {
    const tipo = String(orcamento && orcamento.entrega_retirada || '').trim();
    if (tipo === 'Entrega' || tipo === 'Retirada') return { texto: MODALIDADES[tipo], conferencia: false };
    if (tipo) return { texto: null, conferencia: true };
    return { texto: null, conferencia: false };
  }
  return { texto: null, conferencia: true };
}

function montarEvento(orcamento) {
  const data = dataEventoIso(orcamento);
  const tipo = textoLimpo(orcamento && (orcamento.tipo_evento || orcamento.evento_tipo));
  const convidados = lerConvidados(orcamento && orcamento.convidados);
  const entrega = lerHorario(orcamento && orcamento.evento_horario_entrega);
  const festa = lerHorario(orcamento && orcamento.evento_horario_festa);
  const modalidade = lerModalidade(orcamento);
  const lista = Array.isArray(orcamento && orcamento.itens) ? orcamento.itens : null;
  const itens = (lista || []).map(normalizarItem);
  const avisos = [];
  if (!data) avisos.push('Data do evento a conferir.');
  if (!tipo) avisos.push('Tipo do evento a conferir.');
  if (convidados.conferencia) avisos.push('Quantidade de convidados a conferir.');
  if (entrega && entrega.conferencia) {
    avisos.push(entrega.original ? 'Horário de entrega a conferir: ' + entrega.original : 'Horário de entrega a conferir.');
  }
  if (festa && festa.conferencia) {
    avisos.push(festa.original ? 'Horário da festa a conferir: ' + festa.original : 'Horário da festa a conferir.');
  }
  if (modalidade.conferencia) avisos.push('Modalidade de entrega ou retirada a conferir.');
  if (!lista) avisos.push('Lista de produtos a conferir.');
  itens.forEach(function (item) {
    if (!item.valido) avisos.push('Produto a conferir: ' + item.nome + '.');
  });
  const semUnidade = itens.filter(function (item) { return item.valido && !item.unidade_informada; }).length;
  const somaDoces = doces.totalDocesPedido(lista || []);
  const conferencia = avisos.length > 0;
  const local = textoLimpo(orcamento && (orcamento.evento_local_festa || orcamento.local || orcamento.local_evento));
  const nome = textoLimpo(orcamento && (orcamento.nome_cliente || orcamento.cliente));
  return {
    id: Number(orcamento.id),
    nome_cliente: nome || null,
    casal: textoLimpo(orcamento && (orcamento.contato_nome || orcamento.nome_casal || orcamento.casal)) || null,
    numero_contrato: textoLimpo(orcamento && orcamento.contrato_numero_exibicao) || String(orcamento && orcamento.id || ''),
    doces_total: somaDoces.total,
    doces_texto: somaDoces.texto,
    doces_parcial: somaDoces.parcial === true,
    doces_aviso: somaDoces.pendencias.length
      ? 'Itens fora da soma: ' + somaDoces.pendencias.map(function (item) {
        return item.nome + ' (' + item.motivo + ')';
      }).join('; ')
      : null,
    doces_pendencias: somaDoces.pendencias.length,
    local_festa: local || null,
    cerimonialista: textoLimpo(orcamento && orcamento.evento_cerimonialista) || null,
    suportes: textoLivre(orcamento && orcamento.ordem_servico_suportes),
    observacoes_os: textoLivre(orcamento && orcamento.ordem_servico_obs),
    sem_unidade: semUnidade,
    tipo_evento: tipo || null,
    data_evento: data,
    data_texto: formatarIso(data),
    convidados: convidados.valor,
    horario_entrega: entrega && entrega.valido ? entrega.texto : null,
    horario_festa: festa && festa.valido ? festa.texto : null,
    modalidade: modalidade.texto,
    produtos: lista ? lista.length : 0,
    itens: itens,
    avisos: avisos,
    conferencia: conferencia,
    situacao: conferencia ? 'Conferência necessária' : 'Dados conferidos',
    origem: 'itens_atuais'
  };
}

function resumo(evento) {
  return {
    id: evento.id,
    nome_cliente: evento.nome_cliente,
    casal: evento.casal,
    numero_contrato: evento.numero_contrato,
    tipo_evento: evento.tipo_evento,
    data_evento: evento.data_evento,
    data_texto: evento.data_texto,
    convidados: evento.convidados,
    produtos: evento.produtos,
    doces_total: evento.doces_total,
    doces_parcial: evento.doces_parcial === true,
    doces_pendencias: evento.doces_pendencias,
    conferencia: evento.conferencia,
    situacao: evento.situacao
  };
}

function compararEventos(a, b) {
  if (a.data_evento && b.data_evento && a.data_evento !== b.data_evento) {
    return a.data_evento < b.data_evento ? -1 : 1;
  }
  if (a.data_evento && !b.data_evento) return -1;
  if (!a.data_evento && b.data_evento) return 1;
  return a.id - b.id;
}

function agrupar(eventos) {
  const grupos = new Map();
  eventos.forEach(function (evento) {
    evento.itens.forEach(function (item) {
      if (!item.valido) return;
      const sabor = item.sabor || '';
      const chave = chaveNome(item.nome) + '\n' + chaveNome(sabor) + '\n' + (item.unidade_informada ? item.unidade : '');
      const atual = grupos.get(chave);
      if (!atual) {
        grupos.set(chave, {
          nome: sabor ? item.nome + ' — ' + sabor : item.nome,
          unidade: item.unidade,
          unidade_informada: item.unidade_informada,
          quantidade: item.quantidade,
          complementar: item.complementar,
          eventos: [evento.id]
        });
        return;
      }
      atual.quantidade = Math.round((atual.quantidade + item.quantidade) * 10000) / 10000;
      atual.complementar = atual.complementar && item.complementar;
      if (atual.eventos.indexOf(evento.id) === -1) atual.eventos.push(evento.id);
    });
  });
  return Array.from(grupos.values()).map(function (grupo) {
    grupo.quantidade_texto = formatarQuantidade(grupo.quantidade);
    grupo.eventos.sort(function (a, b) { return a - b; });
    return grupo;
  }).sort(function (a, b) {
    return a.nome.localeCompare(b.nome, 'pt-BR') || a.unidade.localeCompare(b.unidade, 'pt-BR');
  });
}

function somarDoces(eventos) {
  return eventos.reduce(function (soma, evento) {
    return soma + (Number(evento.doces_total) || 0);
  }, 0);
}

function docesParcial(eventos) {
  return eventos.some(function (evento) { return evento.doces_parcial === true || evento.doces_pendencias > 0; });
}

function montarDia(eventos, iso) {
  const doDia = eventos.filter(function (evento) { return evento.data_evento === iso; });
  return {
    data: iso,
    data_texto: formatarIso(iso),
    eventos: doDia,
    totais: agrupar(doDia),
    doces_total: somarDoces(doDia),
    doces_parcial: docesParcial(doDia),
    origem: 'itens_atuais'
  };
}

function montarPeriodo(eventos, inicio, fim, visao) {
  const selecionados = eventos.filter(function (evento) {
    return evento.data_evento && evento.data_evento >= inicio && evento.data_evento <= fim;
  });
  return {
    inicio: inicio,
    fim: fim,
    data: inicio,
    data_texto: formatarIso(inicio) + ' a ' + formatarIso(fim),
    rotulo: visao === 'planejamento' ? 'Planejamento do período' : 'Produção do período',
    visao: visao === 'planejamento' ? 'planejamento' : 'definitiva',
    eventos: selecionados,
    totais: agrupar(selecionados),
    doces_total: somarDoces(selecionados),
    doces_parcial: docesParcial(selecionados),
    origem: 'itens_atuais'
  };
}

module.exports = {
  confirmado: confirmado,
  dataIso: dataIso,
  montarEvento: montarEvento,
  resumo: resumo,
  compararEventos: compararEventos,
  agrupar: agrupar,
  montarDia: montarDia,
  montarPeriodo: montarPeriodo
};
