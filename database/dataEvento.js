/**
 * Data do evento usada por Agenda, Financeiro e Produção.
 * Lê o valor já gravado. Não altera o orçamento.
 */
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

function dataEventoIso(orcamento) {
  if (!orcamento || typeof orcamento !== 'object') return null;
  return dataIso(orcamento.data_evento) || dataIso(orcamento.evento_data);
}

module.exports = { dataIso, dataEventoIso };
