const { getDb } = require('../db');
const logica = require('../../server/producaoLogica');

function lerOrcamentos() {
  return getDb().prepare('SELECT id, payload FROM orcamentos ORDER BY id').all().map(function (row) {
    const orcamento = JSON.parse(row.payload);
    orcamento.id = Number(row.id);
    return orcamento;
  });
}

function eventosConfirmados() {
  return lerOrcamentos()
    .filter(logica.confirmado)
    .map(logica.montarEvento)
    .sort(logica.compararEventos);
}

function listarEventos() {
  return {
    eventos: eventosConfirmados().map(logica.resumo),
    origem: 'itens_atuais'
  };
}

function detalhar(id) {
  const numero = Number(id);
  if (!Number.isSafeInteger(numero) || numero <= 0) return { status: 400, motivo: 'id' };
  const linha = getDb().prepare('SELECT id, payload FROM orcamentos WHERE id = ?').get(numero);
  if (!linha) return { status: 404 };
  const orcamento = JSON.parse(linha.payload);
  orcamento.id = numero;
  if (!logica.confirmado(orcamento)) return { status: 409, motivo: 'confirmacao' };
  return { status: 200, evento: logica.montarEvento(orcamento) };
}

function dia(iso) {
  const data = logica.dataIso(iso);
  if (!data) return { status: 400, motivo: 'data' };
  return { status: 200, dia: logica.montarDia(eventosConfirmados(), data) };
}

function eventosPlanejamento() {
  const ids = new Set(getDb().prepare(`
    SELECT orcamento_id FROM financeiro_contratos WHERE situacao = 'antecipado' OR congelado = 0
  `).all().map(function (row) { return Number(row.orcamento_id); }));
  return lerOrcamentos()
    .filter(function (orcamento) { return !logica.confirmado(orcamento) && ids.has(Number(orcamento.id)); })
    .map(function (orcamento) {
      const evento = logica.montarEvento(orcamento);
      evento.planejamento = true;
      return evento;
    });
}

function periodo(inicio, fim, visao) {
  const de = logica.dataIso(inicio);
  const ate = logica.dataIso(fim);
  if (!de || !ate || de > ate) return { status: 400, motivo: 'data' };
  const dias = (Date.parse(ate + 'T00:00:00') - Date.parse(de + 'T00:00:00')) / 86400000;
  if (dias > 62) return { status: 400, motivo: 'data' };
  const planejamento = visao === 'planejamento';
  const eventos = planejamento
    ? eventosConfirmados().concat(eventosPlanejamento()).sort(logica.compararEventos)
    : eventosConfirmados();
  return { status: 200, periodo: logica.montarPeriodo(eventos, de, ate, planejamento ? 'planejamento' : 'definitiva') };
}

module.exports = {
  listarEventos: listarEventos,
  detalhar: detalhar,
  dia: dia,
  periodo: periodo
};
