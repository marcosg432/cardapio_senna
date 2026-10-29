/**
 * Cópia comercial calculada no servidor. Não grava o orçamento.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const logica = require('./producaoLogica');

const contexto = {
  Math: Math,
  Number: Number,
  String: String,
  parseInt: parseInt,
  isFinite: isFinite,
  Array: Array,
  Object: Object,
  JSON: JSON,
  Date: Date
};
vm.createContext(contexto);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/orcamentos-logic.js'), 'utf8'), contexto);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/orcamentos-compat.js'), 'utf8'), contexto);

function montar(orcamento) {
  const copia = JSON.parse(JSON.stringify(orcamento || {}));
  delete copia.gestao_contrato;
  Object.keys(copia).forEach((chave) => {
    if (chave.indexOf('__') === 0) delete copia[chave];
  });
  const itens = Array.isArray(orcamento && orcamento.itens) ? orcamento.itens : [];
  copia.itens = itens.map((item) => {
    const linha = Object.assign({}, item);
    linha.subtotal = contexto.subtotalLinhaItemOrcamento(item);
    return linha;
  });
  copia.id = Number(orcamento && orcamento.id);
  const subtotal = contexto.valorOriginalOrcamentoComItens(copia);
  const desconto = copia.desconto_tipo
    ? contexto.descontoEquivalenteEmReais(subtotal, copia.desconto_tipo, copia.desconto_valor)
    : 0;
  const final = contexto.calcularValorFinalOrcamento(
    subtotal,
    copia.desconto_tipo,
    copia.desconto_valor,
    copia.desconto_degustacao,
    copia.desconto_cerimonialista,
    copia.taxa_entrega
  );
  copia.valor_original = subtotal;
  copia.valor_desconto = desconto;
  copia.valor_final = final;
  copia.total = final;
  copia.restante = contexto.calcularValorRestanteOrcamento(final, copia.entrada);
  copia.confirmado = logica.confirmado(orcamento);
  copia.confirmado_em = copia.confirmado ? orcamento.gestao_contrato.confirmado_em : null;
  return copia;
}

module.exports = { montar: montar };
