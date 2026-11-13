const { jsPDF } = require('jspdf');
const financeiroRepo = require('../database/repositories/financeiroRepository');

let gerar;

function gerador() {
  if (typeof gerar === 'function') return gerar;
  global.jspdf = { jsPDF: jsPDF };
  require('./demonstrativoDesenho');
  gerar = global.gerarDemonstrativoFinanceiroPDF;
  delete global.gerarDemonstrativoFinanceiroPDF;
  return gerar;
}

function origemConsulta(contrato, provisorio) {
  return {
    id: contrato.id,
    nome_cliente: contrato.nome_cliente,
    tipo_evento: contrato.tipo_evento,
    data_evento: contrato.data_evento,
    congelado: provisorio ? false : true,
    provisorio: provisorio === true,
    valor_contratado_centavos: contrato.valor_contratado_centavos,
    historico: (Array.isArray(contrato.historico) ? contrato.historico : []).map((item) => ({
      id: item.id,
      valor_centavos: item.valor_centavos,
      pago_em: item.pago_em,
      forma: item.forma
    }))
  };
}

function emitir(id) {
  const resultado = financeiroRepo.detalhar(id);
  if (!resultado || resultado.status !== 200) {
    return { status: resultado && resultado.status ? resultado.status : 500, motivo: resultado && resultado.motivo };
  }
  const contrato = resultado.contrato;
  const oficial = !!(contrato && contrato.congelado === true);
  const valor = contrato && contrato.valor_contratado_centavos;
  const provisorio = !oficial && !!(contrato && contrato.situacao === 'antecipado'
    && Number.isSafeInteger(valor) && valor >= 0);
  if (!oficial && !provisorio) {
    return { status: 409, motivo: 'congelado' };
  }
  const documento = gerador()(origemConsulta(contrato, provisorio), { baixar: false, bytes: true });
  return {
    status: 200,
    id: contrato.id,
    provisorio: provisorio,
    buffer: Buffer.from(documento.pdf)
  };
}

function desenhar(origem, opcoes) {
  const documento = gerador()(origem, opcoes || { baixar: false, bytes: true });
  return Buffer.from(documento.pdf);
}

module.exports = { emitir, desenhar };
