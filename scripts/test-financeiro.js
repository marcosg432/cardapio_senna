/**
 * Financeiro em banco temporário. O SQLite real é só lido.
 */
const { spawn } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const bcrypt = require("bcryptjs");
const { DatabaseSync } = require("node:sqlite");

const PORT = 3237;
const SENHA = "senha-de-teste-local";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const root = path.join(__dirname, "..");
const dbReal = path.join(root, "database", "database.sqlite");
const tmpDb = path.join(os.tmpdir(), "candyli-financeiro-" + Date.now() + ".sqlite");
const tmpCopia = path.join(os.tmpdir(), "candyli-migracao-" + Date.now() + ".sqlite");
const tmpInit = path.join(os.tmpdir(), "candyli-init-" + Date.now() + ".sqlite");
const perfil = path.join(os.tmpdir(), "candyli-chrome-financeiro-" + Date.now());
let servidor;
let chrome;

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function isoLocal(data) {
  const mes = String(data.getMonth() + 1).padStart(2, "0");
  const dia = String(data.getDate()).padStart(2, "0");
  return data.getFullYear() + "-" + mes + "-" + dia;
}

function assinaturaReal() {
  const db = new DatabaseSync(dbReal, { readOnly: true });
  const ic = db.prepare("PRAGMA integrity_check").get().integrity_check;
  const rows = db.prepare("SELECT id, payload FROM orcamentos ORDER BY id").all();
  function contar(tabela) {
    const existe = db.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?").get(tabela);
    if (!existe) return 0;
    return Number(db.prepare("SELECT COUNT(*) AS n FROM " + tabela).get().n);
  }
  const contratosFinanceiros = contar("financeiro_contratos");
  const pagamentos = contar("pagamentos");
  db.close();
  const texto = rows.map((row) => row.id + ":" + row.payload).join("|");
  const confirmados = rows.filter((row) => {
    const o = JSON.parse(row.payload);
    return o.gestao_contrato && o.gestao_contrato.status === "confirmado";
  }).length;
  return {
    ic: ic,
    n: rows.length,
    hash: crypto.createHash("sha256").update(texto).digest("hex"),
    confirmados: confirmados,
    contratosFinanceiros: contratosFinanceiros,
    pagamentos: pagamentos
  };
}

function aplicarArquivos(db) {
  const dir = path.join(root, "database", "migrations");
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY)");
  fs.readdirSync(dir).filter((nome) => nome.endsWith(".sql")).sort().forEach((nome) => {
    if (db.prepare("SELECT 1 AS ok FROM schema_migrations WHERE name = ?").get(nome)) return;
    db.exec(fs.readFileSync(path.join(dir, nome), "utf8"));
    db.prepare("INSERT INTO schema_migrations (name) VALUES (?)").run(nome);
  });
}

function testarCopia() {
  const db = new DatabaseSync(tmpCopia);
  db.exec("PRAGMA foreign_keys = ON");
  aplicarArquivos(db);
  assert(db.prepare("PRAGMA integrity_check").get().integrity_check === "ok", "integridade da cópia");
  const tabelas = db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('orcamentos', 'financeiro_contratos', 'pagamentos')"
  ).all().map((row) => row.name).sort();
  assert(tabelas.join(",") === "financeiro_contratos,orcamentos,pagamentos", "tabelas " + tabelas.join(","));
  const payload = JSON.stringify({
    id: 930010,
    cliente: "Cliente Copia",
    nome_cliente: "Cliente Copia",
    valor_final: 20,
    contrato: { status: "emitido" },
    contrato_pdf: { tipo: "contrato", gerado_em: "2026-01-02T00:00:00.000Z" }
  });
  db.prepare("INSERT INTO orcamentos (id, payload, created_at, updated_at) VALUES (?, ?, ?, ?)").run(
    930010, payload, "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z"
  );
  db.prepare("INSERT INTO financeiro_contratos (orcamento_id, valor_contratado_centavos, congelado_em) VALUES (?, ?, ?)").run(
    930010, 2000, "2026-01-02T00:00:00.000Z"
  );
  db.prepare(`
    INSERT INTO pagamentos (orcamento_id, valor_centavos, pago_em, forma, chave_idempotencia, criado_em)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(930010, 500, "2026-01-03", "pix", "chave-copia-00000001", "2026-01-03T00:00:00.000Z");
  let bloqueou = false;
  try {
    db.prepare(`
      INSERT INTO pagamentos (orcamento_id, valor_centavos, pago_em, forma, chave_idempotencia, criado_em)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(999, 500, "2026-01-03", "pix", "chave-copia-00000002", "2026-01-03T00:00:00.000Z");
  } catch (e) {
    bloqueou = true;
  }
  assert(bloqueou, "pagamento sem contrato financeiro");
  db.exec(fs.readFileSync(path.join(root, "database", "migrations", "down", "003_financeiro.sql"), "utf8"));
  const depois = db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('financeiro_contratos', 'pagamentos', 'orcamentos', 'admin_usuarios')"
  ).all().map((row) => row.name);
  assert(depois.indexOf("financeiro_contratos") === -1 && depois.indexOf("pagamentos") === -1, "reversão manteve tabela");
  assert(depois.indexOf("orcamentos") !== -1 && depois.indexOf("admin_usuarios") !== -1, "reversão removeu tabela antiga");
  const gravado = db.prepare("SELECT payload FROM orcamentos WHERE id = ?").get(930010).payload;
  assert(gravado === payload, "reversão alterou o orçamento");
  assert(db.prepare("PRAGMA integrity_check").get().integrity_check === "ok", "integridade após reversão");
  db.close();
}

function testarInicializacao() {
  process.env.DATABASE_PATH = tmpInit;
  const { inicializarConfirmados } = require("../database/repositories/financeiroRepository");
  const { getDb, closeDb } = require("../database/db");
  const db = getDb();
  function gravar(orcamento) {
    db.prepare("INSERT INTO orcamentos (id, payload, created_at, updated_at) VALUES (?, ?, ?, ?)").run(
      orcamento.id, JSON.stringify(orcamento), "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z"
    );
  }
  const combinado = {
    id: 930001,
    cliente: "Cliente Combinado",
    nome_cliente: "Cliente Combinado",
    valor_original: 80,
    valor_final: 80,
    total: 80,
    itens: [],
    contrato: { status: "emitido", valor_final: 80 },
    contrato_pdf: { tipo: "contrato", gerado_em: "2026-01-02T00:00:00.000Z" },
    gestao_contrato: { status: "confirmado", confirmado_em: "2026-01-02T00:00:00.000Z" }
  };
  gravar(combinado);
  gravar({
    id: 930002,
    cliente: "Cliente Divergente",
    nome_cliente: "Cliente Divergente",
    valor_original: 100,
    valor_final: 10,
    total: 10,
    itens: [{ nome: "Doce", quantidade: 50, preco_unitario: 2, preco: 2, subtotal: 100 }],
    gestao_contrato: { status: "confirmado", confirmado_em: "2026-01-02T00:00:00.000Z" }
  });
  gravar({ id: 930003, cliente: "Cliente Aberto", nome_cliente: "Cliente Aberto", valor_final: 10, itens: [] });
  try {
    const seco = inicializarConfirmados({ aplicar: false });
    assert(seco.aplicados.length === 0, "conferência gravou");
    assert(seco.conferidos.length === 1 && seco.conferidos[0].id === 930001 && seco.conferidos[0].valor_contratado_centavos === 8000, "conferência");
    assert(seco.conflitos.length === 1 && seco.conflitos[0].id === 930002 && seco.conflitos[0].oficial_centavos === 10000 && seco.conflitos[0].gravado_centavos === 1000, "conflito");
    const antes = db.prepare("SELECT payload FROM orcamentos WHERE id = 930001").get().payload;
    const aplicado = inicializarConfirmados({ aplicar: true });
    assert(aplicado.aplicados.length === 1 && aplicado.aplicados[0] === 930001, "inicialização");
    assert(db.prepare("SELECT payload FROM orcamentos WHERE id = 930001").get().payload === antes, "inicialização alterou payload");
    const freeze = db.prepare("SELECT valor_contratado_centavos FROM financeiro_contratos WHERE orcamento_id = 930001").get();
    assert(freeze && Number(freeze.valor_contratado_centavos) === 8000, "valor congelado");
    assert(!db.prepare("SELECT 1 AS ok FROM financeiro_contratos WHERE orcamento_id = 930002").get(), "divergência foi congelada");
  } finally {
    closeDb();
    delete process.env.DATABASE_PATH;
  }
}

function pedir(method, urlPath, opcoes) {
  opcoes = opcoes || {};
  return new Promise((resolve, reject) => {
    const data = opcoes.body == null ? null : JSON.stringify(opcoes.body);
    const headers = {};
    if (data) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = Buffer.byteLength(data);
    }
    if (opcoes.cookie) headers.Cookie = opcoes.cookie;
    if (opcoes.csrf) headers["X-CSRF-Token"] = opcoes.csrf;
    const req = http.request({ hostname: "127.0.0.1", port: PORT, path: urlPath, method: method, headers: headers }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
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
      env: Object.assign({}, process.env, { PORT: String(PORT), DATABASE_PATH: tmpDb, COOKIE_SECURE: "0" }),
      stdio: ["ignore", "pipe", "pipe"]
    });
    let saida = "";
    const timer = setTimeout(() => reject(new Error("servidor nao subiu")), 8000);
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

function derrubar(proc) {
  return new Promise((resolve) => {
    if (!proc || proc.killed) return resolve();
    proc.once("exit", () => resolve());
    proc.kill();
  });
}

function esperarHttp(url) {
  const inicio = Date.now();
  return new Promise((resolve, reject) => {
    function tentar() {
      http.get(url, (res) => {
        res.resume();
        resolve();
      }).on("error", () => {
        if (Date.now() - inicio > 8000) reject(new Error("chrome sem depuração"));
        else setTimeout(tentar, 150);
      });
    }
    tentar();
  });
}

function cdp(ws) {
  let seq = 0;
  const pendentes = new Map();
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data);
    if (!msg.id || !pendentes.has(msg.id)) return;
    const par = pendentes.get(msg.id);
    pendentes.delete(msg.id);
    if (msg.error) par.reject(new Error(JSON.stringify(msg.error)));
    else par.resolve(msg.result);
  });
  return function enviar(method, params) {
    const id = ++seq;
    return new Promise((resolve, reject) => {
      pendentes.set(id, { resolve: resolve, reject: reject });
      ws.send(JSON.stringify({ id: id, method: method, params: params || {} }));
    });
  };
}

async function avaliar(enviar, expressao) {
  const inicio = Date.now();
  let ultimo = null;
  while (Date.now() - inicio < 8000) {
    const saida = await enviar("Runtime.evaluate", { expression: expressao, returnByValue: true });
    ultimo = saida.result && saida.result.value;
    if (ultimo) return ultimo;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("tela não ficou pronta: " + expressao + " ultimo=" + JSON.stringify(ultimo));
}

function pagamento(valor, forma, chave, data) {
  return { valor_centavos: valor, pago_em: data, forma: forma, chave_idempotencia: chave };
}

async function main() {
  const antes = assinaturaReal();
  assert(antes.ic === "ok" && antes.n >= 1, "banco real indisponível para leitura");
  testarCopia();
  testarInicializacao();

  const recusa = spawn(process.execPath, ["scripts/inicializar-financeiro.js"], {
    cwd: root,
    env: Object.assign({}, process.env, { DATABASE_PATH: "", FINANCEIRO_INICIALIZAR: "" })
  });
  const codigoRecusa = await new Promise((resolve) => recusa.once("exit", resolve));
  assert(codigoRecusa === 1, "inicialização sem autorização executou");

  fs.rmSync(tmpDb, { force: true });
  await subir();
  const db = new DatabaseSync(tmpDb);
  db.prepare("INSERT INTO admin_usuarios (usuario, senha_hash) VALUES (?, ?)").run("admin", bcrypt.hashSync(SENHA, 12));
  const hoje = isoLocal(new Date());
  const amanhaData = new Date();
  amanhaData.setDate(amanhaData.getDate() + 1);
  const amanha = isoLocal(amanhaData);
  const original = {
    id: 920010,
    cliente: "Cliente Financeiro",
    nome_cliente: "Cliente Financeiro",
    data_evento: hoje,
    evento_data: hoje,
    valor_original: 100,
    valor_final: 100,
    total: 100,
    entrada: 30,
    itens: [{ nome: "Doce teste", quantidade: 50, preco_unitario: 2, preco: 2, subtotal: 100 }],
    contrato: { status: "emitido", valor_final: 100 },
    contrato_pdf: { tipo: "contrato", gerado_em: "2026-01-02T00:00:00.000Z" },
    cpf: "00000000000",
    email: "nao-expor@example.com",
    telefone: "11999999999",
    endereco: "rua secreta",
    observacoes: "texto original"
  };
  db.prepare("INSERT INTO orcamentos (id, payload, created_at, updated_at) VALUES (?, ?, ?, ?)").run(
    original.id, JSON.stringify(original), "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z"
  );
  db.prepare("INSERT INTO orcamentos (id, payload, created_at, updated_at) VALUES (?, ?, ?, ?)").run(920011, JSON.stringify({
    id: 920011,
    cliente: "Cliente Aberto",
    nome_cliente: "Cliente Aberto",
    data_evento: hoje,
    evento_data: hoje,
    valor_final: 40,
    valor_original: 40,
    itens: []
  }), "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z");
  db.prepare("INSERT INTO orcamentos (id, payload, created_at, updated_at) VALUES (?, ?, ?, ?)").run(920012, JSON.stringify({
    id: 920012,
    cliente: "Cliente Antigo",
    nome_cliente: "Cliente Antigo",
    data_evento: hoje,
    evento_data: hoje,
    valor_final: 50,
    valor_original: 50,
    itens: [],
    contrato: { status: "emitido", valor_final: 50 },
    contrato_pdf: { tipo: "contrato", gerado_em: "2026-01-02T00:00:00.000Z" },
    gestao_contrato: { status: "confirmado", confirmado_em: "2026-01-02T00:00:00.000Z" }
  }), "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z");
  const tela = {
    id: 920020,
    cliente: "Cliente Tela",
    nome_cliente: "Cliente Tela",
    data_evento: hoje,
    evento_data: hoje,
    valor_original: 100,
    valor_final: 100,
    total: 100,
    entrada: 15,
    itens: [{ nome: "Doce tela", quantidade: 50, preco_unitario: 2, preco: 2, subtotal: 100 }],
    contrato: { status: "emitido", valor_final: 100 },
    contrato_pdf: { tipo: "contrato", gerado_em: "2026-01-02T00:00:00.000Z" }
  };
  db.prepare("INSERT INTO orcamentos (id, payload, created_at, updated_at) VALUES (?, ?, ?, ?)").run(
    tela.id, JSON.stringify(tela), "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z"
  );
  db.close();

  const semSessao = await pedir("POST", "/api/financeiro/contratos/920010/pagamentos", { body: pagamento(100, "pix", "chave-sem-sessao-01", hoje) });
  assert(semSessao.status === 401, "sem sessão " + semSessao.status);
  const login = await pedir("POST", "/api/auth/login", { body: { senha: SENHA } });
  assert(login.status === 200, "login");
  const cookie = String(login.headers["set-cookie"]).split(";")[0];
  const csrf = JSON.parse(login.body).csrfToken;
  const token = decodeURIComponent(cookie.split("=").slice(1).join("="));
  const sessao = { cookie: cookie, csrf: csrf };

  const semCsrf = await pedir("POST", "/api/financeiro/contratos/920010/pagamentos", { cookie: cookie, body: pagamento(100, "pix", "chave-sem-csrf-0001", hoje) });
  assert(semCsrf.status === 403, "sem csrf " + semCsrf.status);

  const confirmacao = await pedir("POST", "/api/orcamentos/920010/confirmar-contrato", Object.assign({ body: {} }, sessao));
  assert(confirmacao.status === 200 && JSON.parse(confirmacao.body).repetida === false, "confirmação");
  const repetida = await pedir("POST", "/api/orcamentos/920010/confirmar-contrato", Object.assign({ body: {} }, sessao));
  const repetidaJson = JSON.parse(repetida.body);
  assert(repetida.status === 200 && repetidaJson.repetida === true, "confirmação repetida");
  assert(repetidaJson.gestao_contrato.confirmado_em === JSON.parse(confirmacao.body).gestao_contrato.confirmado_em, "data da confirmação mudou");

  const lista = await pedir("GET", "/api/financeiro/contratos", { cookie: cookie });
  assert(lista.status === 200, "lista");
  assert(lista.body.indexOf("00000000000") === -1 && lista.body.indexOf("nao-expor") === -1 && lista.body.indexOf("rua secreta") === -1, "lista expôs dado pessoal");
  const listaJson = JSON.parse(lista.body);
  const financeiro = listaJson.contratos.find((item) => item.id === 920010);
  const antigo = listaJson.contratos.find((item) => item.id === 920012);
  assert(financeiro && financeiro.congelado && financeiro.valor_contratado_centavos === 10000 && financeiro.recebido_centavos === 0 && financeiro.pendente_centavos === 10000, "listagem");
  assert(antigo && antigo.congelado === false && antigo.valor_contratado_centavos == null, "contrato antigo foi congelado");
  assert(!listaJson.contratos.some((item) => item.id === 920011), "orçamento aberto entrou no financeiro");

  const detalhe = JSON.parse((await pedir("GET", "/api/financeiro/contratos/920010", { cookie: cookie })).body);
  assert(detalhe.entrada_prevista_centavos === 3000 && detalhe.historico.length === 0, "entrada prevista");
  assert(JSON.stringify(detalhe).indexOf("00000000000") === -1, "detalhe expôs dado pessoal");
  const salvo = JSON.parse((await pedir("GET", "/api/orcamentos/920010", sessao)).body);
  assert(JSON.stringify(salvo.contrato) === JSON.stringify(original.contrato), "contrato pdf lógico mudou");
  assert(JSON.stringify(salvo.contrato_pdf) === JSON.stringify(original.contrato_pdf), "contrato_pdf mudou");
  assert(salvo.entrada === 30 && salvo.observacoes === "texto original", "payload original mudou");

  const aberto = await pedir("POST", "/api/financeiro/contratos/920011/pagamentos", Object.assign({ body: pagamento(100, "pix", "chave-aberto-000001", hoje) }, sessao));
  assert(aberto.status === 409, "pagamento de contrato aberto " + aberto.status);
  const semFreeze = await pedir("POST", "/api/financeiro/contratos/920012/pagamentos", Object.assign({ body: pagamento(100, "pix", "chave-antigo-000001", hoje) }, sessao));
  assert(semFreeze.status === 409, "pagamento sem congelamento " + semFreeze.status);

  const pix = await pedir("POST", "/api/financeiro/contratos/920010/pagamentos", Object.assign({ body: pagamento(4000, "pix", "chave-pix-000000001", hoje) }, sessao));
  assert(pix.status === 201, "pix " + pix.status + " " + pix.body);
  const pixJson = JSON.parse(pix.body);
  assert(pixJson.recebido_centavos === 4000 && pixJson.pendente_centavos === 6000 && pixJson.repetida === false, "parcial");
  const dinheiro = await pedir("POST", "/api/financeiro/contratos/920010/pagamentos", Object.assign({ body: pagamento(3000, "dinheiro", "chave-dinheiro-00001", hoje) }, sessao));
  assert(dinheiro.status === 201 && JSON.parse(dinheiro.body).recebido_centavos === 7000 && JSON.parse(dinheiro.body).pendente_centavos === 3000, "dinheiro");
  const quita = await pedir("POST", "/api/financeiro/contratos/920010/pagamentos", Object.assign({ body: pagamento(3000, "transferencia", "chave-quita-00000001", hoje) }, sessao));
  assert(quita.status === 201 && JSON.parse(quita.body).recebido_centavos === 10000 && JSON.parse(quita.body).pendente_centavos === 0, "quitação");
  const excede = await pedir("POST", "/api/financeiro/contratos/920010/pagamentos", Object.assign({ body: pagamento(1, "boleto", "chave-excede-0000001", hoje) }, sessao));
  assert(excede.status === 409, "excedente " + excede.status);

  const deNovo = await pedir("POST", "/api/financeiro/contratos/920010/pagamentos", Object.assign({ body: pagamento(4000, "pix", "chave-pix-000000001", hoje) }, sessao));
  const deNovoJson = JSON.parse(deNovo.body);
  assert(deNovo.status === 200 && deNovoJson.repetida === true && deNovoJson.pagamento.id === pixJson.pagamento.id && deNovoJson.pagamento.criado_em === pixJson.pagamento.criado_em, "idempotência");
  const conflito = await pedir("POST", "/api/financeiro/contratos/920010/pagamentos", Object.assign({ body: pagamento(100, "pix", "chave-pix-000000001", hoje) }, sessao));
  assert(conflito.status === 409, "chave diferente " + conflito.status);
  const confirmacaoTela = await pedir("POST", "/api/orcamentos/920020/confirmar-contrato", Object.assign({ body: {} }, sessao));
  assert(confirmacaoTela.status === 200, "confirmação da tela");
  const outraChave = await pedir("POST", "/api/financeiro/contratos/920020/pagamentos", Object.assign({ body: pagamento(4000, "pix", "chave-pix-000000001", hoje) }, sessao));
  assert(outraChave.status === 409, "chave em outro contrato " + outraChave.body);

  assert((await pedir("POST", "/api/financeiro/contratos/920010/pagamentos", Object.assign({ body: pagamento(0, "pix", "chave-zero-000000001", hoje) }, sessao))).status === 400, "zero");
  assert((await pedir("POST", "/api/financeiro/contratos/920010/pagamentos", Object.assign({ body: pagamento(1.5, "pix", "chave-fracao-0000001", hoje) }, sessao))).status === 400, "fração");
  assert((await pedir("POST", "/api/financeiro/contratos/920010/pagamentos", Object.assign({ body: pagamento(-1, "pix", "chave-negativo-00001", hoje) }, sessao))).status === 400, "negativo");
  const texto = pagamento(100, "pix", "chave-texto-00000001", hoje);
  texto.valor_centavos = "100";
  assert((await pedir("POST", "/api/financeiro/contratos/920010/pagamentos", Object.assign({ body: texto }, sessao))).status === 400, "valor texto");
  assert((await pedir("POST", "/api/financeiro/contratos/920010/pagamentos", Object.assign({ body: pagamento(100, "cheque", "chave-forma-00000001", hoje) }, sessao))).status === 400, "forma");
  assert((await pedir("POST", "/api/financeiro/contratos/920010/pagamentos", Object.assign({ body: pagamento(100, "pix", "chave-data-000000001", "2026-02-31") }, sessao))).status === 400, "data inexistente");
  assert((await pedir("POST", "/api/financeiro/contratos/920010/pagamentos", Object.assign({ body: pagamento(100, "pix", "chave-futura-0000001", amanha) }, sessao))).status === 400, "data futura");
  const extra = pagamento(100, "pix", "chave-extra-00000001", hoje);
  extra.entrada = 1;
  assert((await pedir("POST", "/api/financeiro/contratos/920010/pagamentos", Object.assign({ body: extra }, sessao))).status === 400, "campo extra");
  assert((await pedir("DELETE", "/api/financeiro/contratos/920010/pagamentos", sessao)).status === 405, "exclusão");

  const paralelo = await Promise.all([
    pedir("POST", "/api/financeiro/contratos/920020/pagamentos", Object.assign({ body: pagamento(6000, "pix", "chave-concorrencia-01", hoje) }, sessao)),
    pedir("POST", "/api/financeiro/contratos/920020/pagamentos", Object.assign({ body: pagamento(6000, "dinheiro", "chave-concorrencia-02", hoje) }, sessao))
  ]);
  const codigos = paralelo.map((item) => item.status).sort();
  assert(codigos[0] === 201 && codigos[1] === 409, "concorrência " + codigos.join(","));
  const aposParalelo = JSON.parse((await pedir("GET", "/api/financeiro/contratos/920020", { cookie: cookie })).body);
  assert(aposParalelo.recebido_centavos === 6000 && aposParalelo.pendente_centavos === 4000 && aposParalelo.historico.length === 1, "saldo após concorrência");

  const home = await pedir("GET", "/");
  const pdf = await pedir("GET", "/js/contrato-pdf.js");
  assert(home.status === 200 && home.body.indexOf("Candy Li") !== -1, "cardápio");
  assert(pdf.status === 200 && pdf.body.indexOf("gerarContratoPDF") !== -1, "PDF");

  chrome = spawn(CHROME, [
    "--headless=new", "--disable-gpu", "--no-first-run", "--disable-extensions",
    "--remote-debugging-port=9352", "--user-data-dir=" + perfil, "about:blank"
  ], { stdio: "ignore" });
  await esperarHttp("http://127.0.0.1:9352/json/version");
  const alvos = await new Promise((resolve, reject) => {
    http.get("http://127.0.0.1:9352/json/list", (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))));
    }).on("error", reject);
  });
  const ws = new WebSocket(alvos.find((item) => item.type === "page").webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve);
    ws.addEventListener("error", reject);
  });
  const enviar = cdp(ws);
  await enviar("Network.enable");
  await enviar("Page.enable");
  await enviar("Network.setCookie", { name: "cl_sessao", value: token, url: "http://127.0.0.1:" + PORT + "/" });
  await enviar("Page.navigate", { url: "http://127.0.0.1:" + PORT + "/admin/gestao/financeiro.html" });
  await avaliar(enviar, "[...document.querySelectorAll('#financeiro-corpo tr')].some((tr) => tr.textContent.indexOf('Cliente Tela') !== -1)");
  await avaliar(enviar, `(() => {
    const botao = [...document.querySelectorAll("#financeiro-corpo button")].find((el) => el.closest("tr").textContent.indexOf("Cliente Tela") !== -1);
    botao.click();
    return true;
  })()`);
  await avaliar(enviar, "document.getElementById('financeiro-detalhe-entrada').textContent.indexOf('R$ 15,00') !== -1");
  const cancelou = await avaliar(enviar, `(() => {
    document.getElementById("financeiro-valor").value = "25,00";
    document.getElementById("financeiro-data").value = ${JSON.stringify(hoje)};
    document.getElementById("financeiro-forma").value = "pix";
    document.getElementById("financeiro-form").requestSubmit();
    const aberto = document.getElementById("financeiro-modal").hidden === false;
    document.getElementById("financeiro-modal-cancelar").click();
    return { aberto: aberto, fechado: document.getElementById("financeiro-modal").hidden === true };
  })()`);
  assert(cancelou.aberto && cancelou.fechado, "janela de pagamento");
  const aposCancelar = JSON.parse((await pedir("GET", "/api/financeiro/contratos/920020", { cookie: cookie })).body);
  assert(aposCancelar.historico.length === 1 && aposCancelar.recebido_centavos === 6000, "cancelar gravou pagamento");

  await avaliar(enviar, `(() => {
    document.getElementById("financeiro-valor").value = "10,00";
    document.getElementById("financeiro-data").value = ${JSON.stringify(hoje)};
    document.getElementById("financeiro-forma").value = "dinheiro";
    document.getElementById("financeiro-form").requestSubmit();
    document.getElementById("financeiro-modal-confirmar").click();
    return true;
  })()`);
  await avaliar(enviar, "document.getElementById('financeiro-historico').innerText.indexOf('Dinheiro') !== -1 && document.getElementById('financeiro-detalhe-recebido').textContent === 'R$ 70,00'");
  await enviar("Page.navigate", { url: "http://127.0.0.1:" + PORT + "/admin/gestao/index.html" });
  await avaliar(enviar, "document.getElementById('indicador-total-recebido').textContent === 'R$ 170,00'");
  const painel = await avaliar(enviar, `(() => ({
    contratado: document.getElementById("indicador-total-contratado").textContent,
    recebido: document.getElementById("indicador-total-recebido").textContent,
    pendente: document.getElementById("indicador-total-pendente").textContent,
    orcamentos: document.getElementById("indicador-orcamentos").textContent,
    confirmados: document.getElementById("indicador-confirmados").textContent
  }))()`);
  assert(painel.contratado === "R$ 200,00" && painel.recebido === "R$ 170,00" && painel.pendente === "R$ 30,00", "dashboard " + JSON.stringify(painel));
  assert(painel.orcamentos === "4" && painel.confirmados === "3", "indicadores antigos " + JSON.stringify(painel));

  const depois = assinaturaReal();
  assert(
    depois.hash === antes.hash &&
    depois.n === antes.n &&
    depois.confirmados === antes.confirmados &&
    depois.contratosFinanceiros === antes.contratosFinanceiros &&
    depois.pagamentos === antes.pagamentos &&
    depois.ic === "ok",
    "orçamentos reais foram alterados"
  );
  console.log("Financeiro ok.");
  ws.close();
}

main()
  .catch((e) => {
    console.error(e && e.stack ? e.stack : e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await derrubar(chrome);
    await derrubar(servidor);
    setTimeout(() => {
      [tmpDb, tmpCopia, tmpInit].forEach((arquivo) => {
        fs.rmSync(arquivo, { force: true });
        fs.rmSync(arquivo + "-wal", { force: true });
        fs.rmSync(arquivo + "-shm", { force: true });
      });
      fs.rmSync(perfil, { recursive: true, force: true });
    }, 400);
  });
