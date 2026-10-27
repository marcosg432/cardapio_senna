/**
 * Valor contratado em centavos, pela mesma regra do orçamento no navegador.
 * O resultado não usa entrada, restante nem campos enviados pelo cliente.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

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
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'orcamentos-logic.js'), 'utf8'), contexto);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'orcamentos-compat.js'), 'utf8'), contexto);

function erroValor() {
  const erro = new Error('valor');
  erro.code = 'valor';
  return erro;
}

function reaisParaCentavos(reais) {
  if (typeof reais !== 'number' || !Number.isFinite(reais) || reais < 0) throw erroValor();
  const centavos = Math.round(reais * 100);
  if (!Number.isSafeInteger(centavos) || centavos < 0) throw erroValor();
  return centavos;
}

function valorOficialReais(orcamento) {
  const reais = contexto.valorFinalOrc(orcamento);
  if (typeof reais !== 'number' || !Number.isFinite(reais) || reais < 0) throw erroValor();
  return reais;
}

function valorContratadoCentavos(orcamento) {
  return reaisParaCentavos(valorOficialReais(orcamento));
}

function valorFinalGravadoCentavos(orcamento) {
  if (!orcamento || orcamento.valor_final == null || orcamento.valor_final === '') return null;
  const numero = Number(orcamento.valor_final);
  if (!Number.isFinite(numero)) return null;
  return Math.round(numero * 100);
}

function conflitaComValorGravado(orcamento) {
  return valorFinalGravadoCentavos(orcamento) !== valorContratadoCentavos(orcamento);
}

function entradaPrevistaCentavos(orcamento) {
  if (!orcamento || orcamento.entrada == null || orcamento.entrada === '') return 0;
  const numero = Number(orcamento.entrada);
  if (!Number.isFinite(numero) || numero < 0) return null;
  const centavos = Math.round(numero * 100);
  if (!Number.isSafeInteger(centavos) || centavos < 0) return null;
  return centavos;
}

module.exports = {
  valorContratadoCentavos,
  valorFinalGravadoCentavos,
  conflitaComValorGravado,
  entradaPrevistaCentavos
};
