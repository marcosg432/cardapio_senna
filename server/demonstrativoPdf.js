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

function origemOficial(contrato) {
  return {
    id: contrato.id,
    nome_cliente: contrato.nome_cliente,
    tipo_evento: contrato.tipo_evento,
    data_evento: contrato.data_evento,
    congelado: true,
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
  if (!resultado.contrato || resultado.contrato.congelado !== true) {
    return { status: 409, motivo: 'congelado' };
  }
  const documento = gerador()(origemOficial(resultado.contrato), { baixar: false, bytes: true });
  return {
    status: 200,
    id: resultado.contrato.id,
    buffer: Buffer.from(documento.pdf)
  };
}

module.exports = { emitir };
