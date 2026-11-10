/**
 * Pacote operacional em SQLite temporário.
 * Não abre o banco real.
 */
const { spawn } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const zlib = require("zlib");
const bcrypt = require("bcryptjs");
const { DatabaseSync } = require("node:sqlite");
const doces = require("../js/doces-quantidade");

const PORT = 3331;
const SENHA = "senha-de-teste-local";
const root = path.join(__dirname, "..");
const tmpDb = path.join(os.tmpdir(), "candyli-pacote-" + Date.now() + ".sqlite");
const tmpHistorico = path.join(os.tmpdir(), "candyli-pacote-historico-" + Date.now() + ".sqlite");
const documentosDir = path.join(os.tmpdir(), "candyli-pacote-docs-" + Date.now());
let servidor;

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function hoje() {
  const data = new Date();
  const mes = String(data.getMonth() + 1).padStart(2, "0");
  const dia = String(data.getDate()).padStart(2, "0");
  return data.getFullYear() + "-" + mes + "-" + dia;
}

function aplicar(db, nomes) {
  const dir = path.join(root, "database", "migrations");
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY)");
  nomes.forEach((nome) => {
    db.exec(fs.readFileSync(path.join(dir, nome), "utf8"));
    db.prepare("INSERT INTO schema_migrations (name) VALUES (?)").run(nome);
  });
}

function testarHistorico() {
  const db = new DatabaseSync(tmpHistorico);
  db.exec("PRAGMA foreign_keys = ON");
  const arquivos = fs.readdirSync(path.join(root, "database", "migrations"))
    .filter((nome) => nome.endsWith(".sql") && nome !== "005_financeiro_operacao.sql")
    .sort();
  aplicar(db, arquivos);
  const payload = JSON.stringify({
    id: 940900,
    cliente: "Contrato Anterior",
    nome_cliente: "Contrato Anterior",
    valor_final: 80,
    itens: []
  });
  db.prepare("INSERT INTO orcamentos (id, payload, created_at, updated_at) VALUES (?, ?, ?, ?)").run(
    940900, payload, "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z"
  );
  db.prepare("INSERT INTO financeiro_contratos (orcamento_id, valor_contratado_centavos, congelado_em) VALUES (?, ?, ?)").run(
    940900, 8000, "2026-01-02T00:00:00.000Z"
  );
  db.prepare(`
    INSERT INTO pagamentos (orcamento_id, valor_centavos, pago_em, forma, chave_idempotencia, criado_em)
    VALUES (940900, 2500, '2026-01-03', 'pix', 'chave-historica-0001', '2026-01-03T00:00:00.000Z')
  `).run();
  aplicar(db, ["005_financeiro_operacao.sql"]);
  const ficha = db.prepare("SELECT valor_contratado_centavos, situacao, congelado FROM financeiro_contratos WHERE orcamento_id = 940900").get();
  const pagamento = db.prepare("SELECT valor_centavos, pago_em, forma FROM pagamentos WHERE orcamento_id = 940900").get();
  assert(ficha.valor_contratado_centavos === 8000 && ficha.situacao === "confirmado" && Number(ficha.congelado) === 1, "migração alterou contrato antigo");
  assert(pagamento.valor_centavos === 2500 && pagamento.pago_em === "2026-01-03" && pagamento.forma === "pix", "migração alterou pagamento antigo");
  assert(db.prepare("SELECT payload FROM orcamentos WHERE id = 940900").get().payload === payload, "migração alterou orçamento");
  let bloqueou = false;
  try { db.prepare("DELETE FROM pagamentos WHERE orcamento_id = 940900").run(); } catch (e) { bloqueou = true; }
  assert(bloqueou, "exclusão de pagamento foi aceita");
  assert(db.prepare("PRAGMA integrity_check").get().integrity_check === "ok", "integridade do histórico");
  db.close();
}

function pedir(method, urlPath, opcoes) {
  opcoes = opcoes || {};
  return new Promise((resolve, reject) => {
    const data = opcoes.body == null ? null : Buffer.from(JSON.stringify(opcoes.body));
    const headers = Object.assign({}, opcoes.headers || {});
    if (opcoes.cookie) headers.Cookie = opcoes.cookie;
    if (opcoes.csrf) headers["X-CSRF-Token"] = opcoes.csrf;
    if (data) {
      headers["Content-Type"] = "application/json; charset=utf-8";
      headers["Content-Length"] = data.length;
    }
    const req = http.request({
      hostname: "127.0.0.1",
      port: PORT,
      path: urlPath,
      method: method,
      headers: headers
    }, (res) => {
      const chunks = [];
      res.on("data", (parte) => chunks.push(parte));
      res.on("end", () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks)
      }));
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

function subir() {
  return new Promise((resolve, reject) => {
    servidor = spawn(process.execPath, ["server.js"], {
      cwd: root,
      env: Object.assign({}, process.env, {
        PORT: String(PORT),
        DATABASE_PATH: tmpDb,
        COOKIE_SECURE: "0",
        DOCUMENTOS_DIR: documentosDir
      }),
      stdio: ["ignore", "pipe", "pipe"]
    });
    let saida = "";
    const timer = setTimeout(() => reject(new Error("servidor nao subiu\n" + saida)), 8000);
    const ouvir = (buf) => {
      saida += buf.toString();
      if (saida.indexOf("localhost:" + PORT) !== -1) {
        clearTimeout(timer);
        resolve();
      }
    };
    servidor.stdout.on("data", ouvir);
    servidor.stderr.on("data", ouvir);
  });
}

function textoPdf(buffer) {
  const cru = buffer.toString("latin1");
  let texto = cru;
  for (const marca of cru.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    try { texto += zlib.inflateSync(Buffer.from(marca[1], "latin1")).toString("latin1"); } catch (e) { /* sem compressão */ }
  }
  return texto;
}

function gravar(db, orcamento) {
  db.prepare("INSERT INTO orcamentos (id, payload, created_at, updated_at) VALUES (?, ?, ?, ?)").run(
    orcamento.id, JSON.stringify(orcamento), "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z"
  );
}

async function main() {
  testarHistorico();
  const soma = doces.totalDocesPedido([
    { nome: "Brigadeiro", quantidade: 2, unidade: "cento" },
    { nome: "Bem-casado", quantidade: 40, unidade: "unidade" },
    { nome: "Taxa de entrega", quantidade: 1, unidade: "unidade" },
    { nome: "Locação de suportes", quantidade: 1, unidade: "unidade" },
    { nome: "Bolo de corte", quantidade: 1 },
    { nome: "Doce em caixa", quantidade: 3, unidade: "kg" }
  ]);
  assert(soma.total === 240 && soma.parcial === true, "soma de doces " + JSON.stringify(soma));
  var bolo = soma.pendencias.find(function (item) { return item.nome === "Bolo de corte"; });
  var quilo = soma.pendencias.find(function (item) { return item.nome === "Doce em caixa"; });
  assert(bolo && bolo.motivo.indexOf("equivalência") !== -1, "bolo pendente " + JSON.stringify(soma.pendencias));
  assert(quilo && quilo.motivo.indexOf("incompatível") !== -1, "quilo pendente");

  fs.rmSync(tmpDb, { force: true });
  await subir();
  const db = new DatabaseSync(tmpDb);
  db.prepare("INSERT INTO admin_usuarios (usuario, senha_hash) VALUES (?, ?)").run("admin", bcrypt.hashSync(SENHA, 12));
  const data = hoje();
  const itens = [
    { nome: "Brigadeiro", quantidade: 2, unidade: "cento", preco_unitario: 80, preco: 80, subtotal: 160, extra_pedido_admin: true },
    { nome: "Bem-casado", quantidade: 40, unidade: "unidade", preco_unitario: 3, preco: 3, subtotal: 120, extra_pedido_admin: true },
    { nome: "Taxa de entrega", quantidade: 1, unidade: "unidade", preco_unitario: 20, preco: 20, subtotal: 20, extra_pedido_admin: true }
  ];
  gravar(db, {
    id: 940001, cliente: "Ana e Bruno", nome_cliente: "Ana Silva", contato_nome: "Ana e Bruno",
    contrato_numero_exibicao: "C-41", tipo_evento: "Casamento", data_evento: data, evento_data: data,
    valor_original: 300, valor_final: 300, total: 300, itens: itens,
    ordem_servico_suportes: "2 suportes de cristal", ordem_servico_obs: "Separar os bem-casados."
  });
  gravar(db, {
    id: 940002, cliente: "Clara Dias", nome_cliente: "Clara Dias", tipo_evento: "Aniversário",
    data_evento: data, evento_data: data, valor_original: 50, valor_final: 50, total: 50,
    itens: [{ nome: "Beijinho", quantidade: 10, unidade: "unidade", preco_unitario: 5, preco: 5, subtotal: 50, extra_pedido_admin: true }]
  });
  gravar(db, {
    id: 940003, cliente: "", nome_cliente: "", valor_final: 30, itens: []
  });
  db.close();

  const login = await pedir("POST", "/api/auth/login", { body: { senha: SENHA } });
  assert(login.status === 200, "login");
  const cookie = String(login.headers["set-cookie"]).split(";")[0];
  const csrf = JSON.parse(login.body).csrfToken;
  const sessao = { cookie: cookie, csrf: csrf };
  const semCsrf = await pedir("POST", "/api/financeiro/contratos/940001/pagamentos", {
    cookie: cookie,
    body: { valor_centavos: 1000, pago_em: data, forma: "pix", chave_idempotencia: "chave-pacote-csrf-01" }
  });
  assert(semCsrf.status === 403, "csrf " + semCsrf.status);
  const semNome = await pedir("POST", "/api/financeiro/contratos/940003/pagamentos", Object.assign({
    body: { valor_centavos: 1000, pago_em: data, forma: "pix", chave_idempotencia: "chave-pacote-semnome1" }
  }, sessao));
  assert(semNome.status === 409, "sem cliente " + semNome.status);

  const parcial = await pedir("POST", "/api/financeiro/contratos/940001/pagamentos", Object.assign({
    body: { valor_centavos: 10000, pago_em: data, forma: "pix", chave_idempotencia: "chave-pacote-parcial1" }
  }, sessao));
  assert(parcial.status === 201, "parcial " + parcial.body);
  const pedido = JSON.parse((await pedir("GET", "/api/orcamentos/940001", sessao)).body);
  assert(!pedido.gestao_contrato, "antecipado confirmou");
  const detalhe = JSON.parse((await pedir("GET", "/api/financeiro/contratos/940001", { cookie: cookie })).body);
  assert(detalhe.situacao === "antecipado" && detalhe.recebido_centavos === 10000 && detalhe.congelado === false, "detalhe antecipado");
  const valorAtual = detalhe.valor_atual_centavos;
  const patchMenor = Object.assign({}, pedido, {
    itens: itens.slice(0, 2),
    valor_original: 280,
    valor_final: 280,
    total: 280
  });
  delete patchMenor.gestao_contrato;
  const alterado = await pedir("PATCH", "/api/orcamentos/940001", Object.assign({ body: patchMenor }, sessao));
  assert(alterado.status === 200, "editar com pagamento " + alterado.status);
  const depoisValor = JSON.parse((await pedir("GET", "/api/financeiro/contratos/940001", { cookie: cookie })).body);
  assert(depoisValor.recebido_centavos === 10000 && depoisValor.valor_atual_centavos !== valorAtual, "saldo não recalculou");
  assert(!JSON.parse((await pedir("GET", "/api/orcamentos/940001", sessao)).body).gestao_contrato, "edição confirmou");

  const credito = await pedir("POST", "/api/financeiro/contratos/940002/pagamentos", Object.assign({
    body: { valor_centavos: 9000, pago_em: data, forma: "dinheiro", chave_idempotencia: "chave-pacote-credito1" }
  }, sessao));
  assert(credito.status === 201, "credito " + credito.body);
  const saldoNegativo = JSON.parse((await pedir("GET", "/api/financeiro/contratos/940002", { cookie: cookie })).body);
  assert(saldoNegativo.pendente_centavos < 0 && saldoNegativo.credito_centavos === -saldoNegativo.pendente_centavos, "saldo negativo");
  const exato = await pedir("POST", "/api/financeiro/contratos/940001/pagamentos", Object.assign({
    body: {
      valor_centavos: depoisValor.pendente_centavos,
      pago_em: data,
      forma: "pix",
      chave_idempotencia: "chave-pacote-exato001"
    }
  }, sessao));
  assert(exato.status === 201 && JSON.parse(exato.body).pendente_centavos === 0, "saldo zero");
  const repetida = await pedir("POST", "/api/financeiro/contratos/940001/pagamentos", Object.assign({
    body: { valor_centavos: 10000, pago_em: data, forma: "pix", chave_idempotencia: "chave-pacote-parcial1" }
  }, sessao));
  assert(repetida.status === 200 && JSON.parse(repetida.body).repetida === true, "duplicata");

  const antesConfirmar = new DatabaseSync(tmpDb, { readOnly: true });
  const pagamentosAntes = Number(antesConfirmar.prepare("SELECT COUNT(*) AS n FROM pagamentos WHERE orcamento_id = 940001").get().n);
  antesConfirmar.close();
  const confirmacao = await pedir("POST", "/api/orcamentos/940001/confirmar-contrato", Object.assign({ body: {} }, sessao));
  assert(confirmacao.status === 200 && JSON.parse(confirmacao.body).repetida === false, "confirmação");
  const dbConfere = new DatabaseSync(tmpDb, { readOnly: true });
  const ficha = dbConfere.prepare("SELECT COUNT(*) AS n, MAX(situacao) AS situacao FROM financeiro_contratos WHERE orcamento_id = 940001").get();
  const pagamentosDepois = Number(dbConfere.prepare("SELECT COUNT(*) AS n FROM pagamentos WHERE orcamento_id = 940001").get().n);
  dbConfere.close();
  assert(Number(ficha.n) === 1 && ficha.situacao === "confirmado" && pagamentosDepois === pagamentosAntes, "confirmação duplicou financeiro");

  const idPagamento = JSON.parse((await pedir("GET", "/api/financeiro/contratos/940001", { cookie: cookie })).body).historico[0].id;
  const semConfirmacao = await pedir("POST", "/api/financeiro/contratos/940001/pagamentos/" + idPagamento + "/corrigir", Object.assign({
    body: { valor_centavos: 9000, pago_em: data, forma: "pix", motivo: "Valor lançado a mais", confirmacao: false }
  }, sessao));
  assert(semConfirmacao.status === 400, "correcao sem confirmação");
  const correcao = await pedir("POST", "/api/financeiro/contratos/940001/pagamentos/" + idPagamento + "/corrigir", Object.assign({
    body: { valor_centavos: 9000, pago_em: data, forma: "transferencia", observacao: "ajuste de caixa", motivo: "Valor lançado a mais", confirmacao: true }
  }, sessao));
  assert(correcao.status === 200, "correcao " + correcao.body);
  const corrigido = JSON.parse((await pedir("GET", "/api/financeiro/contratos/940001", { cookie: cookie })).body);
  assert(corrigido.historico[0].valor_centavos === 9000 && corrigido.correcoes.length === 1, "auditoria");
  assert(corrigido.correcoes[0].valor_anterior_centavos === 10000 && corrigido.correcoes[0].motivo === "Valor lançado a mais", "histórico anterior");

  const bloqueio = await pedir("PATCH", "/api/orcamentos/940001", Object.assign({
    body: { valor_final: 10 }
  }, sessao));
  assert(bloqueio.status === 409, "patch confirmado " + bloqueio.status);
  fs.mkdirSync(path.join(documentosDir, "1"), { recursive: true });
  const pdfAntigo = path.join(documentosDir, "1", "9.pdf");
  fs.writeFileSync(pdfAntigo, Buffer.from("%PDF-1.4 documento oficial anterior"));
  const dbDoc = new DatabaseSync(tmpDb);
  const usuario = dbDoc.prepare("SELECT id, usuario FROM admin_usuarios").get();
  const agora = new Date().toISOString();
  dbDoc.prepare("INSERT INTO documentos (id, tipo, orcamento_id, data_referencia, criado_em) VALUES (1, 'contrato', 940001, NULL, ?)").run(agora);
  dbDoc.prepare(`
    INSERT INTO documento_versoes (
      id, documento_id, numero, estado, usuario_id, usuario_nome, criada_em, atualizada_em,
      motivo, conteudo_json, hash_snapshot, hash_pdf, pdf_caminho, revisao, chave_idempotencia, emitida_em
    ) VALUES (9, 1, 1, 'emitida', ?, ?, ?, ?, 'versao anterior', '{}', ?, ?, '1/9.pdf', 1, 'chave-doc-anterior-01', ?)
  `).run(usuario.id, usuario.usuario, agora, agora, "a".repeat(64), "b".repeat(64), agora);
  dbDoc.close();
  const financeiroAntesRevisao = JSON.parse((await pedir("GET", "/api/financeiro/contratos/940001", { cookie: cookie })).body);
  const revisao = await pedir("POST", "/api/orcamentos/940001/revisao-contratual", Object.assign({
    body: {
      motivo: "A cliente reduziu os bem-casados",
      confirmacao: true,
      patch: {
        itens: [
          itens[0],
          Object.assign({}, itens[1], { quantidade: 20, subtotal: 60 })
        ]
      }
    }
  }, sessao));
  assert(revisao.status === 200 && JSON.parse(revisao.body).aceite_cliente === "pendente" && JSON.parse(revisao.body).aplicado === false, "revisao " + revisao.body);
  const revisado = JSON.parse((await pedir("GET", "/api/orcamentos/940001", sessao)).body);
  assert(revisado.itens[1].quantidade === 40 && revisado.gestao_contrato.status === "confirmado", "revisao aplicada antes do aceite");
  const financeiroNaRevisao = JSON.parse((await pedir("GET", "/api/financeiro/contratos/940001", { cookie: cookie })).body);
  assert(financeiroNaRevisao.valor_contratado_centavos === financeiroAntesRevisao.valor_contratado_centavos, "revisao alterou valor congelado");
  const pagosRevisao = new DatabaseSync(tmpDb, { readOnly: true });
  const contagem = Number(pagosRevisao.prepare("SELECT COUNT(*) AS n FROM pagamentos WHERE orcamento_id = 940001").get().n);
  const antiga = pagosRevisao.prepare("SELECT estado, pdf_caminho FROM documento_versoes WHERE id = 9").get();
  pagosRevisao.close();
  assert(contagem === pagamentosDepois && antiga.estado === "emitida", "revisao apagou pagamento ou PDF");
  assert(fs.readFileSync(pdfAntigo).toString() === "%PDF-1.4 documento oficial anterior", "PDF anterior foi regravado");

  const producao = JSON.parse((await pedir("GET", "/api/producao/eventos", { cookie: cookie })).body);
  const evento = producao.eventos.find((item) => item.id === 940001);
  assert(evento && evento.casal === "Ana e Bruno" && evento.numero_contrato === "C-41" && evento.doces_total === 240, "identificação " + JSON.stringify(evento));
  assert(!producao.eventos.some((item) => item.id === 940002), "planejamento entrou na produção definitiva");
  const periodo = JSON.parse((await pedir("GET", "/api/producao/periodo?de=" + data + "&ate=" + data, { cookie: cookie })).body);
  assert(periodo.eventos.length === 1 && periodo.doces_total === 240, "período definitivo");
  const planejamento = JSON.parse((await pedir("GET", "/api/producao/periodo?de=" + data + "&ate=" + data + "&visao=planejamento", { cookie: cookie })).body);
  assert(planejamento.eventos.some((item) => item.id === 940002 && item.planejamento === true), "planejamento");
  const os = await pedir("GET", "/api/producao/eventos/940001/pdf", { cookie: cookie });
  const textoOs = textoPdf(os.body);
  assert(os.status === 200 && textoOs.indexOf("Quantidade total de doces: 240") !== -1, "pdf da os");
  assert(textoOs.indexOf("2 suportes de cristal") !== -1 && textoOs.indexOf("Separar os bem-casados") !== -1, "suportes e observação");
  assert(textoOs.indexOf("R$") === -1 && textoOs.indexOf("Produzido por") !== -1, "os sem preço");
  const proposta = await pedir("GET", "/api/orcamentos/940001/proposta.pdf", { cookie: cookie });
  const textoProposta = textoPdf(proposta.body);
  assert(
    proposta.status === 200 && textoProposta.indexOf("Quantidade total de doces:") !== -1,
    "pdf do orçamento " + proposta.status + " " + textoProposta.slice(0, 180)
  );
  const tela = await pedir("GET", "/admin/orcamento.html", { cookie: cookie });
  const html = tela.body.toString("utf8");
  assert(
    tela.status === 200 && html.indexOf("Salvar informações da OS") !== -1 && html.indexOf("Abrir Ordem de Serviço") !== -1,
    "botões da os " + tela.status + " " + html.slice(0, 120)
  );
  const css = (await pedir("GET", "/css/gestao.css")).body.toString("utf8");
  assert(css.indexOf("max-width: 820px") !== -1, "layout móvel");
  console.log("Pacote operacional ok.");
}

main()
  .catch((erro) => {
    console.error(erro && erro.stack ? erro.stack : erro);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (servidor && !servidor.killed) {
      await new Promise((resolve) => {
        servidor.once("exit", resolve);
        servidor.kill();
      });
    }
    [tmpDb, tmpHistorico].forEach((arquivo) => {
      fs.rmSync(arquivo, { force: true });
      fs.rmSync(arquivo + "-wal", { force: true });
      fs.rmSync(arquivo + "-shm", { force: true });
    });
    fs.rmSync(documentosDir, { recursive: true, force: true });
  });
