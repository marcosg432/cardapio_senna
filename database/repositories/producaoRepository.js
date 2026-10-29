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

module.exports = {
  listarEventos: listarEventos,
  detalhar: detalhar,
  dia: dia
};
