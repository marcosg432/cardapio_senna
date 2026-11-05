/**
 * Interface e API de documentos. Banco temporário. Não emite PDF oficial.
 */
const { spawn } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const bcrypt = require("bcryptjs");
const { DatabaseSync } = require("node:sqlite");

const PORT = 3269;
const SENHA = "senha-de-teste-local";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const root = path.join(__dirname, "..");
const realDb = path.join(root, "database", "database.sqlite");
const tmpDb = path.join(os.tmpdir(), "candyli-docs-ui-" + Date.now() + ".sqlite");
const tmpPdf = path.join(os.tmpdir(), "candyli-docs-ui-pdf-" + Date.now());
const perfil = path.join(os.tmpdir(), "candyli-chrome-docs-" + Date.now());
if (path.resolve(tmpDb) === path.resolve(realDb)) throw new Error("recusa banco real");
process.env.DATABASE_PATH = tmpDb;
process.env.MIGRACOES_AUTORIZADAS = "004_documentos_versoes.sql";
process.env.DOCUMENTOS_DIR = tmpPdf;
process.env.COOKIE_SECURE = "0";

const documentos = require("../database/repositories/documentosRepository");
const { closeDb, DB_PATH } = require("../database/db");

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function assinaturaReal() {
  const db = new DatabaseSync(realDb, { readOnly: true });
  const ic = db.prepare("PRAGMA integrity_check").get().integrity_check;
  const rows = db.prepare("SELECT id, payload FROM orcamentos ORDER BY id").all();
  const pagamentos = db.prepare("SELECT id, orcamento_id, valor_centavos, pago_em, forma, criado_em FROM pagamentos ORDER BY id").all();
  const migracoes = db.prepare("SELECT name FROM schema_migrations ORDER BY name").all().map((row) => row.name);
  db.close();
  return {
    ic: ic,
    n: rows.length,
    hash: crypto.createHash("sha256").update(rows.map((row) => row.id + ":" + row.payload).join("|")).digest("hex"),
    pagamentos: pagamentos,
    migracoes: migracoes
  };
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
    const req = http.request({
      hostname: "127.0.0.1", port: PORT, path: urlPath, method: method, headers: headers
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

function json(resposta) {
  return JSON.parse(resposta.body.toString("utf8"));
}

async function avaliar(ws, expressao) {
  const inicio = Date.now();
  let ultimo = null;
  while (Date.now() - inicio < 8000) {
    const saida = await enviar(ws, "Runtime.evaluate", { expression: expressao, returnByValue: true });
    ultimo = saida.result && saida.result.value;
    if (ultimo) return ultimo;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("tela não ficou pronta: " + expressao + " ultimo=" + JSON.stringify(ultimo));
}

function enviar(ws, method, params) {
  const id = Math.floor(Math.random() * 1e9);
  return new Promise((resolve, reject) => {
    function ouvir(evento) {
      const mensagem = JSON.parse(evento.data);
      if (mensagem.id !== id) return;
      ws.removeEventListener("message", ouvir);
      if (mensagem.error) reject(new Error(JSON.stringify(mensagem.error)));
      else resolve(mensagem.result || {});
    }
    ws.addEventListener("message", ouvir);
    ws.send(JSON.stringify({ id: id, method: method, params: params || {} }));
  });
}

async function main() {
  assert(path.resolve(DB_PATH) === path.resolve(tmpDb), "banco errado");
  const antes = assinaturaReal();
  assert(antes.ic === "ok" && antes.n >= 1, "banco real");
  assert(antes.migracoes.indexOf("003_financeiro.sql") !== -1, "esquema real");

  fs.rmSync(tmpDb, { force: true });
  const servidor = spawn(process.execPath, ["server.js"], {
    cwd: root,
    env: Object.assign({}, process.env, {
      PORT: String(PORT),
      DATABASE_PATH: tmpDb,
      MIGRACOES_AUTORIZADAS: "004_documentos_versoes.sql",
      DOCUMENTOS_DIR: tmpPdf,
      COOKIE_SECURE: "0"
    }),
    stdio: ["ignore", "pipe", "pipe"]
  });
  await new Promise((resolve, reject) => {
    let saida = "";
    const timer = setTimeout(() => reject(new Error("servidor não subiu\n" + saida)), 8000);
    servidor.stdout.on("data", (buf) => {
      saida += buf.toString();
      if (saida.indexOf("localhost:" + PORT) !== -1) {
        clearTimeout(timer);
        resolve();
      }
    });
    servidor.stderr.on("data", (buf) => { saida += buf.toString(); });
  });

  const db = new DatabaseSync(tmpDb);
  db.prepare("INSERT INTO admin_usuarios (usuario, senha_hash) VALUES (?, ?)").run("admin", bcrypt.hashSync(SENHA, 12));
  db.prepare("INSERT INTO orcamentos (id, payload, created_at, updated_at) VALUES (?, ?, ?, ?)").run(
    960100,
    JSON.stringify({
      id: 960100,
      cliente: "Cliente Versao",
      nome_cliente: "Cliente Versao",
      tipo_evento: "Aniversário",
      data_evento: "2026-12-20",
      itens: [{ nome: "Brigadeiro", quantidade: 50, unidade: "unidade", preco: 2, preco_unitario: 2, subtotal: 100 }],
      valor_original: 100,
      valor_final: 100,
      total: 100
    }),
    "2026-01-01T00:00:00.000Z",
    "2026-01-01T00:00:00.000Z"
  );
  db.close();

  assert((await pedir("GET", "/api/documentos")).status === 401, "lista sem sessão");
  const login = await pedir("POST", "/api/auth/login", { body: { senha: SENHA } });
  const cookie = String(login.headers["set-cookie"]).split(";")[0];
  const csrf = json(login).csrfToken;
  const sessao = { cookie: cookie, csrf: csrf };

  const semCsrf = await pedir("POST", "/api/documentos", { cookie: cookie, body: { tipo: "producao_evento", orcamentoId: 960100 } });
  assert(semCsrf.status === 403, "csrf");
  const confirmar = await pedir("POST", "/api/orcamentos/960100/confirmar-contrato", Object.assign({ body: {} }, sessao));
  assert(confirmar.status === 200, "confirmar " + confirmar.status);

  const aberto = await pedir("POST", "/api/documentos", Object.assign({ body: { tipo: "producao_evento", orcamentoId: 960100 } }, sessao));
  assert(aberto.status === 201, "abrir " + aberto.status + " " + aberto.body.toString());
  const documento = json(aberto).documento;
  const rascunho = await pedir("POST", "/api/documentos/" + documento.id + "/rascunho", Object.assign({
    body: { motivo: "Planejamento da cozinha", conteudo: { contratado: [{ quantidade: 1 }] } }
  }, sessao));
  assert(rascunho.status === 201, "rascunho " + rascunho.body.toString());
  const versao = json(rascunho).versao;
  assert(versao.conteudo.contratado.itens[0].quantidade === "50" || versao.conteudo.contratado.itens[0].quantidade === 50, "quantidade inicial");

  const salvo = await pedir("PATCH", "/api/documentos/versoes/" + versao.id, Object.assign({
    body: {
      revisao: versao.revisao,
      motivo: "Definir responsável",
      operacional: { observacoes: "Separar forminhas", responsavel: "Ana", preparo: "2026-12-19", montagem: "Bandeja", embalagem: "Caixa", orientacoes: "Manter frio", etapas: [{ titulo: "Cobertura", detalhe: "No dia" }] }
    }
  }, sessao));
  assert(salvo.status === 200 && json(salvo).versao.revisao === 2, "salvar " + salvo.body.toString());
  const conflito = await pedir("PATCH", "/api/documentos/versoes/" + versao.id, Object.assign({
    body: { revisao: 1, motivo: "Aba antiga", operacional: { responsavel: "Outra" } }
  }, sessao));
  assert(conflito.status === 409, "concorrência");
  const proibido = await pedir("PATCH", "/api/documentos/versoes/" + versao.id, Object.assign({
    body: {
      revisao: 2,
      motivo: "Mudar quantidade",
      contratado: { itens: [{ nome: "Brigadeiro", quantidade: 9 }] },
      operacional: { responsavel: "Ana" }
    }
  }, sessao));
  assert(proibido.status === 409, "quantidade protegida");

  const previa = await pedir("GET", "/api/documentos/versoes/" + versao.id + "/previa", { cookie: cookie });
  assert(previa.status === 200 && String(previa.headers["content-type"]).indexOf("application/pdf") === 0, "prévia");
  assert(previa.body.slice(0, 5).toString() === "%PDF-", "prévia pdf");
  assert(previa.headers["x-documento-previa"] === "rascunho", "marca de prévia");
  assert(!fs.existsSync(tmpPdf) || fs.readdirSync(tmpPdf).length === 0, "prévia sem arquivo");

  const segundo = await pedir("POST", "/api/documentos/" + documento.id + "/rascunho", Object.assign({ body: { motivo: "Segundo rascunho" } }, sessao));
  assert(segundo.status === 409, "rascunho duplo");
  const descarte = await pedir("POST", "/api/documentos/versoes/" + versao.id + "/descartar", Object.assign({
    body: { revisao: 2, motivo: "Descartar planejamento" }
  }, sessao));
  assert(descarte.status === 200 && json(descarte).versao.estado === "descartado", "descarte");
  const novo = await pedir("POST", "/api/documentos/" + documento.id + "/rascunho", Object.assign({ body: { motivo: "Novo planejamento" } }, sessao));
  assert(novo.status === 201 && json(novo).versao.numero === 2, "novo rascunho");
  const comparacao = await pedir("GET", "/api/documentos/versoes/" + versao.id + "/comparar/" + json(novo).versao.id, { cookie: cookie });
  assert(comparacao.status === 200 && json(comparacao).iguais === false, "comparação");

  const filtro = await pedir("GET", "/api/documentos?tipo=producao_evento&q=Cliente%20Versao", { cookie: cookie });
  assert(filtro.status === 200 && json(filtro).documentos.length === 1, "filtro");
  const demonstrativo = await pedir("POST", "/api/documentos", Object.assign({ body: { tipo: "demonstrativo", orcamentoId: 960100 } }, sessao));
  assert(demonstrativo.status === 201, "demonstrativo " + demonstrativo.body.toString());
  const rascunhoFinanceiro = await pedir("POST", "/api/documentos/" + json(demonstrativo).documento.id + "/rascunho", Object.assign({
    body: { motivo: "Nota de apresentação" }
  }, sessao));
  assert(rascunhoFinanceiro.status === 201, "rascunho financeiro " + rascunhoFinanceiro.body.toString());
  const oficial = json(rascunhoFinanceiro).versao.conteudo.oficial.valor_contratado_centavos;
  const trocaValor = await pedir("PATCH", "/api/documentos/versoes/" + json(rascunhoFinanceiro).versao.id, Object.assign({
    body: { revisao: 1, motivo: "Alterar valor", oficial: { valor_contratado_centavos: 1 }, apresentacao: { observacao: "Nota" } }
  }, sessao));
  assert(trocaValor.status === 409, "valor protegido");
  const nota = await pedir("PATCH", "/api/documentos/versoes/" + json(rascunhoFinanceiro).versao.id, Object.assign({
    body: { revisao: 1, motivo: "Somente a nota", apresentacao: { observacao: "Nota de capa" } }
  }, sessao));
  assert(nota.status === 200 && json(nota).versao.conteudo.oficial.valor_contratado_centavos === oficial, "nota financeira");

  const emitido = documentos.emitir({
    versaoId: json(novo).versao.id,
    revisao: 1,
    chave: "chave-download-documento",
    pdf: Buffer.from("%PDF-1.4 documento historico")
  });
  assert(emitido.status === 201, "arquivo de teste " + JSON.stringify(emitido));
  const baixado = await pedir("GET", "/api/documentos/versoes/" + json(novo).versao.id + "/pdf?caminho=../database/database.sqlite", { cookie: cookie });
  assert(baixado.status === 200 && baixado.body.toString("utf8").indexOf("%PDF-1.4 documento historico") === 0, "download");
  assert(baixado.body.toString("utf8").indexOf("CREATE TABLE") === -1, "caminho do cliente");
  assert((await pedir("GET", "/api/documentos/versoes/" + json(novo).versao.id + "/pdf")).status === 401, "download sem sessão");

  const chrome = spawn(CHROME, [
    "--headless=new", "--disable-gpu", "--no-first-run", "--disable-extensions",
    "--remote-debugging-port=9402", "--user-data-dir=" + perfil, "about:blank"
  ], { stdio: "ignore" });
  await new Promise((resolve, reject) => {
    const inicio = Date.now();
    const timer = setInterval(() => {
      http.get("http://127.0.0.1:9402/json/version", (res) => {
        res.resume();
        if (res.statusCode === 200) {
          clearInterval(timer);
          resolve();
        }
      }).on("error", () => {
        if (Date.now() - inicio > 8000) {
          clearInterval(timer);
          reject(new Error("chrome"));
        }
      });
    }, 200);
  });
  const alvos = await new Promise((resolve, reject) => {
    http.get("http://127.0.0.1:9402/json/list", (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))));
    }).on("error", reject);
  });
  const ws = new WebSocket(alvos.find((item) => item.type === "page").webSocketDebuggerUrl);
  await new Promise((resolve) => ws.addEventListener("open", resolve));
  const token = decodeURIComponent(cookie.split("=").slice(1).join("="));
  await enviar(ws, "Network.setCookie", { name: "cl_sessao", value: token, url: "http://127.0.0.1:" + PORT + "/" });
  await enviar(ws, "Page.navigate", { url: "http://127.0.0.1:" + PORT + "/admin/gestao/documentos.html" });
  await avaliar(ws, "document.body.innerText.indexOf('Cliente Versao') !== -1 && document.body.innerText.indexOf('Emitir PDF cria uma versão oficial') !== -1 && document.body.innerText.indexOf('próxima etapa') === -1 && document.getElementById('documentos-emitir').disabled === true");
  await enviar(ws, "Emulation.setDeviceMetricsOverride", { width: 390, height: 800, deviceScaleFactor: 1, mobile: true });
  const largura = await avaliar(ws, "document.documentElement.scrollWidth <= window.innerWidth + 24");
  assert(largura === true, "layout estreito");
  ws.close();
  chrome.kill();
  servidor.kill();
  closeDb();

  const depois = assinaturaReal();
  assert(depois.hash === antes.hash && depois.n === antes.n && JSON.stringify(depois.pagamentos) === JSON.stringify(antes.pagamentos), "dados reais");
  assert(JSON.stringify(depois.migracoes) === JSON.stringify(antes.migracoes), "migrações reais");
  console.log(JSON.stringify({ ok: true, orcamentos: depois.n }));
}

main().catch((e) => {
  console.error(e && e.stack ? e.stack : e);
  process.exitCode = 1;
});
