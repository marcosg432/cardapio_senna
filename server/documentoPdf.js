/**
 * PDFs oficiais a partir do snapshot do servidor.
 * A prévia fica só na memória e leva a marca RASCUNHO.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { jsPDF } = require('jspdf');
const producaoPdf = require('./producaoPdf');
const demonstrativoPdf = require('./demonstrativoPdf');

const raiz = path.join(__dirname, '..');
let sandboxCliente;

function falhaAssinatura() {
  const erro = new Error('assinatura');
  erro.code = 'assinatura';
  throw erro;
}

function dimensaoValida(valor) {
  return Number.isSafeInteger(valor) && valor >= 1 && valor <= 20000;
}

function interpretarAssinatura(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 24) falhaAssinatura();
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47 && buffer.toString('ascii', 12, 16) === 'IHDR') {
    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    if (!dimensaoValida(width) || !dimensaoValida(height)) falhaAssinatura();
    return {
      dataUrl: 'data:image/png;base64,' + buffer.toString('base64'),
      width: width,
      height: height,
      formato: 'PNG'
    };
  }
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
    const dimensoes = dimensoesJpeg(buffer);
    return {
      dataUrl: 'data:image/jpeg;base64,' + buffer.toString('base64'),
      width: dimensoes.width,
      height: dimensoes.height,
      formato: 'JPEG'
    };
  }
  falhaAssinatura();
}

function dimensoesJpeg(buffer) {
  let i = 2;
  while (i + 8 < buffer.length) {
    if (buffer[i] !== 0xFF) falhaAssinatura();
    while (buffer[i] === 0xFF && i < buffer.length) i += 1;
    if (i >= buffer.length) falhaAssinatura();
    const marcador = buffer[i];
    i += 1;
    if (marcador === 0xD9 || marcador === 0xDA) falhaAssinatura();
    if (marcador === 0x00 || (marcador >= 0xD0 && marcador <= 0xD7)) continue;
    if (i + 1 >= buffer.length) falhaAssinatura();
    const tamanho = buffer.readUInt16BE(i);
    if (tamanho < 2 || i + tamanho > buffer.length) falhaAssinatura();
    if (marcador === 0xC0 || marcador === 0xC1 || marcador === 0xC2) {
      if (tamanho < 7) falhaAssinatura();
      const height = buffer.readUInt16BE(i + 3);
      const width = buffer.readUInt16BE(i + 5);
      if (!dimensaoValida(width) || !dimensaoValida(height)) falhaAssinatura();
      return { width: width, height: height };
    }
    i += tamanho;
  }
  falhaAssinatura();
}

function arquivoAssinaturaConfigurado() {
  const teste = process.env.CANDYLI_ASSINATURA_ARQUIVO;
  if (teste) {
    if (process.env.CANDYLI_TESTE_ISOLADO !== '1') falhaAssinatura();
    return path.resolve(teste);
  }
  let relativo = 'assets/assinatura-contratada.png';
  try {
    const config = fs.readFileSync(path.join(raiz, 'js', 'config.js'), 'utf8');
    const achado = /contratoAssinaturaRelPath:\s*"([^"]*)"/.exec(config);
    if (achado && achado[1].trim()) relativo = achado[1].trim();
  } catch (e) {
    relativo = 'assets/assinatura-contratada.png';
  }
  if (relativo.indexOf('..') !== -1 || path.isAbsolute(relativo)) falhaAssinatura();
  const arquivo = path.resolve(raiz, relativo);
  if (!arquivo.startsWith(path.resolve(raiz) + path.sep)) falhaAssinatura();
  return arquivo;
}

function assinaturaDoArquivo(arquivo) {
  let buffer;
  try {
    buffer = fs.readFileSync(arquivo);
  } catch (e) {
    falhaAssinatura();
  }
  return interpretarAssinatura(buffer);
}

function carregarAssinatura(opcoes) {
  if (opcoes && Object.prototype.hasOwnProperty.call(opcoes, 'assinaturaBuffer')) {
    return interpretarAssinatura(opcoes.assinaturaBuffer);
  }
  return assinaturaDoArquivo(arquivoAssinaturaConfigurado());
}

function cliente() {
  if (sandboxCliente) return sandboxCliente;
  const sandbox = {
    window: { jspdf: { jsPDF: jsPDF } },
    console: console,
    Math: Math,
    Number: Number,
    String: String,
    parseInt: parseInt,
    isFinite: isFinite,
    Array: Array,
    Object: Object,
    JSON: JSON,
    Date: Date,
    Promise: Promise,
    CANDYLI_ASSINATURA: null,
    CANDYLI_PDF: null
  };
  vm.createContext(sandbox);
  const codigo = [
    fs.readFileSync(path.join(raiz, 'js', 'config.js'), 'utf8'),
    fs.readFileSync(path.join(raiz, 'js', 'orcamentos-logic.js'), 'utf8'),
    fs.readFileSync(path.join(raiz, 'js', 'orcamentos-compat.js'), 'utf8'),
    fs.readFileSync(path.join(raiz, 'js', 'orcamento-pdf.js'), 'utf8'),
    fs.readFileSync(path.join(raiz, 'js', 'contrato-pdf.js'), 'utf8'),
    'carregarImagemParaPdf = function () { return Promise.resolve(CANDYLI_ASSINATURA); };',
    'this.gerarOrcamentoPropostaPDF = gerarOrcamentoPropostaPDF;',
    'this.gerarContratoPDF = gerarContratoPDF;'
  ].join('\n');
  vm.runInContext(codigo, sandbox);
  sandboxCliente = sandbox;
  return sandbox;
}

function pdfTemImagem(buffer) {
  return /\/Subtype\s*\/Image/.test(buffer.toString('latin1'));
}

function executarComercial(tipo, copia, rascunho, opcoes) {
  const sandbox = cliente();
  sandbox.CANDYLI_PDF = null;
  if (tipo === 'contrato') sandbox.CANDYLI_ASSINATURA = carregarAssinatura(opcoes);
  sandbox.window.jspdf.jsPDF = function Fabrica(opcoes) {
    const doc = new jsPDF(opcoes);
    doc.save = function () {
      if (rascunho) {
        const total = doc.getNumberOfPages();
        for (let pagina = 1; pagina <= total; pagina++) {
          doc.setPage(pagina);
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(42);
          doc.setTextColor(176, 122, 132);
          doc.text('RASCUNHO', 105, 168, { align: 'center', angle: 32 });
        }
      }
      sandbox.CANDYLI_PDF = Buffer.from(doc.output('arraybuffer'));
    };
    return doc;
  };
  const gerado = tipo === 'contrato'
    ? sandbox.gerarContratoPDF(copia)
    : sandbox.gerarOrcamentoPropostaPDF(copia);
  const pronto = function () {
    if (!sandbox.CANDYLI_PDF || !sandbox.CANDYLI_PDF.length) {
      const erro = new Error('pdf');
      erro.code = 'pdf';
      throw erro;
    }
    return sandbox.CANDYLI_PDF;
  };
  const resultado = gerado && typeof gerado.then === 'function' ? gerado.then(pronto) : Promise.resolve(pronto());
  if (tipo !== 'contrato') return resultado;
  return resultado.then(function (buffer) {
    if (!pdfTemImagem(buffer)) falha('assinatura');
    return buffer;
  });
}

function desenhoComercial(tipo, proposta, revisao, rascunho, opcoes) {
  const copia = JSON.parse(JSON.stringify(proposta || {}));
  if (revisao) {
    const nota = 'Revisão documental: ' + revisao;
    copia.observacoes = copia.observacoes ? String(copia.observacoes) + '\n' + nota : nota;
  }
  if (tipo === 'contrato' && copia.confirmado) {
    const aviso = 'Esta revisão documental não substitui nem renova a aceitação já registrada pelo cliente.';
    copia.observacoes_internas = copia.observacoes_internas
      ? String(copia.observacoes_internas) + '\n' + aviso
      : aviso;
  }
  return executarComercial(tipo, copia, rascunho, opcoes);
}

function itemDesenho(item) {
  return {
    nome: item && item.nome,
    quantidade_texto: item && (item.quantidade_texto || item.quantidade),
    unidade: item && item.unidade,
    complementar: !!(item && item.complementar)
  };
}

function eventoDesenho(evento, operacional) {
  return {
    id: evento.id,
    data_texto: evento.data_texto,
    tipo_evento: evento.tipo_evento,
    convidados: evento.convidados,
    horario_entrega: evento.horario_entrega,
    horario_festa: evento.horario_festa,
    modalidade: evento.modalidade,
    avisos: evento.avisos || [],
    itens: (evento.itens || []).map(itemDesenho),
    operacional: operacional || null
  };
}

function falha(codigo) {
  const erro = new Error(codigo || 'pdf');
  erro.code = codigo || 'pdf';
  throw erro;
}

function gerar(tipo, conteudo, opcoes) {
  const rascunho = !!(opcoes && opcoes.rascunho);
  const marcas = { baixar: false, bytes: true, rascunho: rascunho, congelado: true };
  let buffer = null;
  let arquivo = 'documento.pdf';
  if (tipo === 'producao_evento') {
    const contratado = conteudo && conteudo.contratado;
    if (!contratado || !contratado.id) falha('pdf');
    buffer = producaoPdf.desenharEvento(eventoDesenho(contratado, conteudo.operacional), marcas);
    arquivo = 'ficha-producao-' + contratado.id + '.pdf';
  } else if (tipo === 'producao_dia') {
    const contratado = conteudo && conteudo.contratado;
    if (!contratado || !contratado.data) falha('pdf');
    buffer = producaoPdf.desenharDia({
      data: contratado.data,
      data_texto: contratado.data_texto || contratado.data,
      totais: (contratado.totais || []).map(itemDesenho),
      eventos: (contratado.eventos || []).map(function (evento) { return eventoDesenho(evento); }),
      operacional: conteudo.operacional || null
    }, marcas);
    arquivo = 'producao-dia-' + contratado.data + '.pdf';
  } else if (tipo === 'demonstrativo') {
    const oficial = conteudo && conteudo.oficial;
    if (!oficial) falha('pdf');
    buffer = demonstrativoPdf.desenhar(Object.assign({}, oficial, {
      congelado: true,
      observacao: conteudo.apresentacao && conteudo.apresentacao.observacao
    }), { baixar: false, bytes: true, rascunho: rascunho });
    arquivo = 'demonstrativo-financeiro-' + oficial.id + '.pdf';
  } else if (tipo === 'orcamento' || tipo === 'contrato') {
    const proposta = conteudo && conteudo.proposta;
    if (!proposta || !proposta.id) falha('pdf');
    buffer = desenhoComercial(tipo, proposta, conteudo.revisao_texto, rascunho, opcoes);
    arquivo = (tipo === 'contrato' ? 'contrato-' : 'orcamento-') + proposta.id + '.pdf';
  } else {
    falha('tipo');
  }
  return Promise.resolve(buffer).then(function (pronto) {
    if (!pronto || !pronto.length) falha('pdf');
    return { buffer: pronto, arquivo: arquivo };
  });
}

module.exports = {
  gerar: gerar,
  interpretarAssinatura: interpretarAssinatura,
  assinaturaDoArquivo: assinaturaDoArquivo
};
