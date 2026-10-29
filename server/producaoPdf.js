const { jsPDF } = require('jspdf');
const producaoRepo = require('../database/repositories/producaoRepository');

let ficha;
let diaPdf;

function geradores() {
  if (ficha && diaPdf) return { ficha: ficha, dia: diaPdf };
  global.jspdf = { jsPDF: jsPDF };
  require('./producaoDesenho');
  ficha = global.gerarFichaProducaoPDF;
  diaPdf = global.gerarProducaoDiaPDF;
  delete global.gerarFichaProducaoPDF;
  delete global.gerarProducaoDiaPDF;
  return { ficha: ficha, dia: diaPdf };
}

function emitirEvento(id) {
  const resultado = producaoRepo.detalhar(id);
  if (!resultado || resultado.status !== 200) {
    return { status: resultado && resultado.status ? resultado.status : 500, motivo: resultado && resultado.motivo };
  }
  const documento = geradores().ficha(resultado.evento, { baixar: false, bytes: true });
  return { status: 200, arquivo: documento.arquivo, buffer: Buffer.from(documento.pdf) };
}

function emitirDia(iso) {
  const resultado = producaoRepo.dia(iso);
  if (!resultado || resultado.status !== 200) {
    return { status: resultado && resultado.status ? resultado.status : 500, motivo: resultado && resultado.motivo };
  }
  const documento = geradores().dia(resultado.dia, { baixar: false, bytes: true });
  return { status: 200, arquivo: documento.arquivo, buffer: Buffer.from(documento.pdf) };
}

module.exports = { emitirEvento: emitirEvento, emitirDia: emitirDia };
