const auth = require('./auth');
const producaoRepo = require('../database/repositories/producaoRepository');
const producaoPdf = require('./producaoPdf');

function sendJson(res, status, obj) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(obj));
}

function sendPdf(res, arquivo, buffer) {
  res.writeHead(200, {
    'Content-Type': 'application/pdf',
    'Content-Disposition': 'attachment; filename="' + arquivo + '"',
    'Content-Length': buffer.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(buffer);
}

function mensagem(motivo) {
  if (motivo === 'id') return 'Identificador inválido.';
  if (motivo === 'data') return 'Data inválida.';
  if (motivo === 'confirmacao') return 'Contrato não confirmado.';
  return 'Não foi possível consultar a produção.';
}

function handleProducao(req, res, pathname) {
  const pedido = new URL(req.url || '/', 'http://localhost');
  const periodoPdf = pedido.pathname === '/api/producao/periodo/pdf';
  const periodo = periodoPdf || pedido.pathname === '/api/producao/periodo';
  const ficha = pathname.match(/^\/api\/producao\/eventos\/(\d+)\/pdf\/?$/);
  const evento = pathname.match(/^\/api\/producao\/eventos\/(\d+)\/?$/);
  const resumo = pathname.match(/^\/api\/producao\/datas\/(\d{4}-\d{2}-\d{2})\/pdf\/?$/);
  const dia = pathname.match(/^\/api\/producao\/datas\/(\d{4}-\d{2}-\d{2})\/?$/);
  const lista = pathname === '/api/producao/eventos' || pathname === '/api/producao/eventos/';
  if (!periodo && !ficha && !evento && !resumo && !dia && !lista) return false;

  const gravacao = req.method !== 'GET' && req.method !== 'HEAD';
  if (!auth.exigirAdmin(req, res, { csrf: gravacao })) return true;
  if (gravacao) {
    sendJson(res, 405, { erro: 'Método não permitido' });
    return true;
  }

  try {
    if (periodo) {
      const visao = pedido.searchParams.get('visao') === 'planejamento' ? 'planejamento' : 'definitiva';
      if (periodoPdf) {
        const emissao = producaoPdf.emitirPeriodo(
          pedido.searchParams.get('de'),
          pedido.searchParams.get('ate'),
          visao
        );
        if (emissao.status !== 200) sendJson(res, emissao.status, { erro: mensagem(emissao.motivo) });
        else sendPdf(res, emissao.arquivo, emissao.buffer);
        return true;
      }
      const resultadoPeriodo = producaoRepo.periodo(
        pedido.searchParams.get('de'),
        pedido.searchParams.get('ate'),
        visao
      );
      if (resultadoPeriodo.status !== 200) sendJson(res, resultadoPeriodo.status, { erro: mensagem(resultadoPeriodo.motivo) });
      else sendJson(res, 200, resultadoPeriodo.periodo);
      return true;
    }
    if (lista) {
      sendJson(res, 200, producaoRepo.listarEventos());
      return true;
    }
    if (ficha) {
      const emissao = producaoPdf.emitirEvento(ficha[1]);
      if (emissao.status !== 200) sendJson(res, emissao.status, { erro: mensagem(emissao.motivo) });
      else sendPdf(res, emissao.arquivo, emissao.buffer);
      return true;
    }
    if (evento) {
      const resultado = producaoRepo.detalhar(evento[1]);
      if (resultado.status !== 200) sendJson(res, resultado.status, { erro: mensagem(resultado.motivo) });
      else sendJson(res, 200, resultado.evento);
      return true;
    }
    if (resumo) {
      const emissao = producaoPdf.emitirDia(resumo[1]);
      if (emissao.status !== 200) sendJson(res, emissao.status, { erro: mensagem(emissao.motivo) });
      else sendPdf(res, emissao.arquivo, emissao.buffer);
      return true;
    }
    const resultadoDia = producaoRepo.dia(dia[1]);
    if (resultadoDia.status !== 200) sendJson(res, resultadoDia.status, { erro: mensagem(resultadoDia.motivo) });
    else sendJson(res, 200, resultadoDia.dia);
  } catch (e) {
    sendJson(res, 500, { erro: 'Não foi possível consultar a produção.' });
  }
  return true;
}

module.exports = { handleProducao: handleProducao };
