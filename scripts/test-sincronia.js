/**
 * Sincronia dos módulos num SQLite temporário.
 * Lê o banco real só para confirmar que ele não muda. Não grava nele.
 */
const { spawn } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const vm = require("vm");
const bcrypt = require("bcryptjs");
const { DatabaseSync } = require("node:sqlite");

const PORT = 3293;
const SENHA = "senha-de-teste-local";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const root = path.join(__dirname, "..");
const realDb = path.join(root, "database", "database.sqlite");
const base = path.join(os.tmpdir(), "candyli-sincronia-" + Date.now());
const tmpDb = path.join(base, "banco.sqlite");
const tmpPdf = path.join(base, "pdfs");
const perfil = path.join(base, "chrome");
const ID = 880001;
const DATA = "2026-12-20";
let servidor;
let chrome;

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function censoReal() {
  const db = new DatabaseSync(realDb, { readOnly: true });
  const rows = db.prepare("SELECT id, payload FROM orcamentos ORDER BY id").all();
  const pagamentos = db.prepare("SELECT id, orcamento_id, valor_centavos, pago_em, forma, criado_em FROM pagamentos ORDER BY id").all();
  const financeiro = db.prepare("SELECT orcamento_id, valor_contratado_centavos, congelado_em FROM financeiro_contratos ORDER BY orcamento_id").all();
  const migracoes = db.prepare("SELECT name FROM schema_migrations ORDER BY name").all().map((row) => row.name);
  db.close();
  return {
    n: rows.length,
    hash: crypto.createHash("sha256").update(rows.map((row) => row.id + ":" + row.payload).join("|")).digest("hex"),
    pagamentos,
    financeiro,
    migracoes
  };
}

function pedir(method, urlPath, opcoes) {
  opcoes = opcoes || {};
  const corpo = opcoes.body ? Buffer.from(JSON.stringify(opcoes.body)) : null;
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: "localhost",
      port: PORT,
      path: urlPath,
      method,
      headers: Object.assign({
        Host: "localhost:" + PORT,
        Origin: "http://localhost:" + PORT,
        "Content-Type": "application/json"
      }, opcoes.headers || {}, corpo ? { "Content-Length": corpo.length } : {})
    }, (res) => {
      const chunks = [];
      res.on("data", (parte) => chunks.push(parte));
      res.on("end", () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks)
      }));
    });
    req.setTimeout(20000, () => req.destroy(new Error("tempo " + urlPath)));
    req.on("error", reject);
    if (corpo) req.write(corpo);
    req.end();
  });
}

function json(resposta) {
  return JSON.parse(resposta.body.toString("utf8") || "null");
}

function clienteNavegador() {
  const store = { orcamentos: JSON.stringify([{ id: 1, cliente: "So neste navegador" }]) };
  const fila = [];
  function XHR() {}
  XHR.prototype.open = function () {};
  XHR.prototype.setRequestHeader = function () {};
  XHR.prototype.send = function () {
    const proxima = fila.shift();
    if (!proxima) throw new Error("sem resposta");
    if (proxima.falha) throw new Error("rede");
    this.status = proxima.status;
    this.responseText = proxima.body;
  };
  const sandbox = {
    console,
    localStorage: {
      getItem: (chave) => (Object.prototype.hasOwnProperty.call(store, chave) ? store[chave] : null),
      setItem: (chave, valor) => { store[chave] = String(valor); },
      removeItem: (chave) => { delete store[chave]; }
    },
    XMLHttpRequest: XHR,
    encodeURIComponent,
    JSON,
    Object,
    Array,
    String,
    Number
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(root, "js", "orcamentos-storage.js"), "utf8"), sandbox);
  return {
    store,
    fila,
    listar: () => sandbox.listarOrcamentos(),
    criar: (registro) => sandbox.criarOrcamento(registro),
    atualizar: (id, patch) => sandbox.atualizarOrcamentoParcial(id, patch)
  };
}

function provarNavegador() {
  const cliente = clienteNavegador();
  const original = cliente.store.orcamentos;
  cliente.fila.push({ status: 200, body: JSON.stringify([{ id: 2, cliente: "Servidor" }]) });
  const lista = cliente.listar();
  assert(lista.length === 1 && lista[0].id === 2, "lista ignorou o navegador");
  assert(cliente.store.orcamentos === original, "lista regravou o navegador");
  cliente.fila.push({ status: 503, body: "" });
  assert(cliente.criar({ id: 3, cliente: "Novo" }) === null, "criacao sem servidor");
  assert(cliente.store.orcamentos === original, "criacao gravou no navegador");
  cliente.fila.push({ falha: true });
  assert(cliente.atualizar(2, { telefone: "1" }) === null, "edicao sem servidor");
  assert(cliente.store.orcamentos === original, "edicao gravou no navegador");
}

function orcamentoNovo() {
  return {
    id: ID,
    cliente: "Cliente Sincronia",
    nome_cliente: "Cliente Sincronia",
    telefone: "19999990000",
    data_evento: DATA,
    evento_data: DATA,
    tipo_evento: "Aniversário",
    entrega_suporte: "Apenas retirada dos doces sem entrega",
    evento_horario_entrega: "18:30",
    evento_horario_festa: "19:00",
    itens: [{ nome: "Brigadeiro gourmet", quantidade: 50, unidade: "unidade", preco: 2, preco_unitario: 2, subtotal: 100 }],
    valor_original: 100,
    valor_final: 100,
    total: 100,
    status: "novo_orcamento",
    observacoes: "",
    contrato: null,
    contrato_pdf: null
  };
}

function entrar() {
  return pedir("POST", "/api/auth/login", { body: { senha: SENHA } }).then((login) => {
    assert(login.status === 200, "login");
    const cookie = String(login.headers["set-cookie"]).split(";")[0];
    return { cookie, csrf: json(login).csrfToken, headers: { Cookie: cookie } };
  });
}

function esperarServidor() {
  const inicio = Date.now();
  return new Promise((resolve, reject) => {
    const tentar = () => {
      const req = http.get("http://localhost:" + PORT + "/", (res) => {
        res.resume();
        resolve();
      });
      req.on("error", () => {
        if (Date.now() - inicio > 8000) reject(new Error("servidor"));
        else setTimeout(tentar, 150);
      });
    };
    tentar();
  });
}

function conectar(ws) {
  const pendentes = new Map();
  let seq = 0;
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
      pendentes.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params: params || {} }));
    });
  };
}

async function avaliar(enviar, expressao) {
  const inicio = Date.now();
  while (Date.now() - inicio < 8000) {
    const saida = await enviar("Runtime.evaluate", { expression: expressao, returnByValue: true });
    const valor = saida.result && saida.result.value;
    if (valor) return valor;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("tela");
}

async function navegador(cookie) {
  chrome = spawn(CHROME, [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--disable-extensions",
    "--remote-debugging-port=9458",
    "--user-data-dir=" + perfil,
    "about:blank"
  ], { stdio: "ignore" });
  const inicio = Date.now();
  await new Promise((resolve, reject) => {
    const tentar = () => {
      http.get("http://127.0.0.1:9458/json/version", (res) => {
        res.resume();
        if (res.statusCode === 200) resolve();
        else if (Date.now() - inicio > 8000) reject(new Error("chrome"));
        else setTimeout(tentar, 150);
      }).on("error", () => {
        if (Date.now() - inicio > 8000) reject(new Error("chrome"));
        else setTimeout(tentar, 150);
      });
    };
    tentar();
  });
  const alvos = await new Promise((resolve, reject) => {
    http.get("http://127.0.0.1:9458/json/list", (res) => {
      const chunks = [];
      res.on("data", (parte) => chunks.push(parte));
      res.on("end", () => resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))));
    }).on("error", reject);
  });
  const ws = new WebSocket(alvos.find((item) => item.type === "page").webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve);
    ws.addEventListener("error", reject);
  });
  const enviar = conectar(ws);
  await enviar("Network.enable");
  await enviar("Page.enable");
  const token = decodeURIComponent(cookie.split("=").slice(1).join("="));
  await enviar("Network.setCookie", {
    name: "cl_sessao",
    value: token,
    url: "http://localhost:" + PORT + "/",
    httpOnly: true,
    sameSite: "Lax"
  });
  await enviar("Page.navigate", { url: "http://localhost:" + PORT + "/admin/" });
  await avaliar(enviar, "document.body.innerText.indexOf('Cliente Sincronia') !== -1 && document.body.innerText.indexOf('ficam no servidor') !== -1 && document.body.innerText.indexOf('localStorage') === -1 ? 'ok' : ''");
  await avaliar(enviar, "localStorage.getItem('orcamentos') == null && localStorage.getItem('orcamentos_senna_doce') == null ? 'ok' : ''");
  await enviar("Page.reload", { ignoreCache: true });
  await avaliar(enviar, "document.body.innerText.indexOf('Cliente Sincronia') !== -1 ? 'ok' : ''");
  await enviar("Page.navigate", { url: "http://localhost:" + PORT + "/admin/orcamento.html?id=" + ID });
  await avaliar(enviar, "var el=document.getElementById('btn-historico-pdf'); el && el.getAttribute('href') === 'gestao/documentos.html?q=" + ID + "' ? 'ok' : ''");
  await enviar("Page.navigate", { url: "http://localhost:" + PORT + "/admin/gestao/documentos.html?q=" + ID });
  await avaliar(enviar, "document.body.innerText.indexOf('Contrato " + ID + "') !== -1 ? 'ok' : ''");
  ws.close();
}

async function main() {
  const antes = censoReal();
  provarNavegador();
  fs.rmSync(base, { recursive: true, force: true });
  fs.mkdirSync(tmpPdf, { recursive: true });
  servidor = spawn(process.execPath, ["server.js"], {
    cwd: root,
    env: Object.assign({}, process.env, {
      PORT: String(PORT),
      DATABASE_PATH: tmpDb,
      MIGRACOES_AUTORIZADAS: "004_documentos_versoes.sql",
      DOCUMENTOS_DIR: tmpPdf,
      COOKIE_SECURE: "0"
    }),
    stdio: "ignore"
  });
  await esperarServidor();
  const db = new DatabaseSync(tmpDb);
  db.prepare("INSERT INTO admin_usuarios (usuario, senha_hash) VALUES (?, ?)").run("admin", bcrypt.hashSync(SENHA, 12));
  db.close();

  const criado = await pedir("POST", "/api/orcamentos", { body: orcamentoNovo() });
  assert(criado.status === 201, "cardapio " + criado.status);
  const fechado = await pedir("GET", "/api/orcamentos");
  assert(fechado.status === 401, "lista sem sessao");

  const sessao = await entrar();
  const lista = json(await pedir("GET", "/api/orcamentos", { headers: sessao.headers }));
  assert(lista.length === 1 && lista[0].id === ID && lista[0].nome_cliente === "Cliente Sincronia", "painel");
  const consulta = require("../js/gestao/consulta");
  assert(consulta.dataEvento(lista[0]).iso === DATA && consulta.contratoConfirmado(lista[0]) === false, "agenda antes");

  const edicao = json(await pedir("PATCH", "/api/orcamentos/" + ID, {
    headers: Object.assign({ "X-CSRF-Token": sessao.csrf }, sessao.headers),
    body: { observacoes_internas: "Referencia interna da sincronia" }
  }));
  assert(edicao.observacoes_internas === "Referencia interna da sincronia", "edicao");
  const recarregado = json(await pedir("GET", "/api/orcamentos/" + ID, { headers: sessao.headers }));
  assert(recarregado.observacoes_internas === "Referencia interna da sincronia" && recarregado.status === "novo_orcamento", "releitura");

  const producaoAntes = json(await pedir("GET", "/api/producao/eventos", { headers: sessao.headers }));
  const financeiroAntes = json(await pedir("GET", "/api/financeiro/contratos", { headers: sessao.headers }));
  assert(producaoAntes.eventos.length === 0, "producao antes");
  assert(financeiroAntes.contratos.length === 0, "financeiro antes");

  const contrato = await pedir("PATCH", "/api/orcamentos/" + ID, {
    headers: Object.assign({ "X-CSRF-Token": sessao.csrf }, sessao.headers),
    body: {
      status: "contrato_gerado",
      contrato: { status: "emitido", valor_final: 100, data_contrato: "2026-10-29T12:00:00.000Z" },
      contrato_pdf: { tipo: "contrato", gerado_em: "2026-10-29T12:00:00.000Z" }
    }
  });
  assert(contrato.status === 200 && !json(contrato).gestao_contrato, "contrato sem confirmacao");
  const pdfContrato = await pedir("GET", "/api/orcamentos/" + ID + "/contrato.pdf", { headers: sessao.headers });
  assert(pdfContrato.status === 200 && pdfContrato.body.slice(0, 5).toString() === "%PDF-" && pdfContrato.body.toString("latin1").indexOf("/Subtype /Image") !== -1, "pdf do contrato");

  const confirmacao = await pedir("POST", "/api/orcamentos/" + ID + "/confirmar-contrato", {
    headers: Object.assign({ "X-CSRF-Token": sessao.csrf }, sessao.headers),
    body: {}
  });
  assert(confirmacao.status === 200, "confirmacao");
  const oficial = json(await pedir("GET", "/api/orcamentos/" + ID, { headers: sessao.headers }));
  assert(consulta.contratoConfirmado(oficial) && consulta.dataEvento(oficial).iso === DATA, "agenda depois");
  assert(oficial.observacoes_internas === "Referencia interna da sincronia", "edicao preservada");

  const financeiro = json(await pedir("GET", "/api/financeiro/contratos", { headers: sessao.headers }));
  assert(financeiro.contratos.length === 1 && financeiro.contratos[0].id === ID, "financeiro");
  assert(financeiro.contratos[0].valor_contratado_centavos === 10000 && financeiro.contratos[0].recebido_centavos === 0 && financeiro.contratos[0].pendente_centavos === 10000, "valores");
  const producao = json(await pedir("GET", "/api/producao/eventos", { headers: sessao.headers }));
  assert(producao.eventos.length === 1 && producao.eventos[0].id === ID && producao.eventos[0].data_evento === DATA, "producao");
  const ficha = await pedir("GET", "/api/producao/eventos/" + ID + "/pdf", { headers: sessao.headers });
  assert(ficha.status === 200 && ficha.body.slice(0, 5).toString() === "%PDF-", "pdf da producao");

  const vazio = json(await pedir("GET", "/api/documentos?q=" + ID, { headers: sessao.headers }));
  assert(vazio.documentos.length === 0, "historico vazio");
  const documento = json(await pedir("POST", "/api/documentos", {
    headers: Object.assign({ "X-CSRF-Token": sessao.csrf }, sessao.headers),
    body: { tipo: "contrato", orcamentoId: ID }
  }));
  const rascunho = json(await pedir("POST", "/api/documentos/" + documento.documento.id + "/rascunho", {
    headers: Object.assign({ "X-CSRF-Token": sessao.csrf }, sessao.headers),
    body: { motivo: "Emissao oficial de teste" }
  }));
  const emitida = json(await pedir("POST", "/api/documentos/versoes/" + rascunho.versao.id + "/emitir", {
    headers: Object.assign({ "X-CSRF-Token": sessao.csrf }, sessao.headers),
    body: { chave: "sincronia-oficial-880001-ok", revisao: rascunho.versao.revisao }
  }));
  assert(emitida.versao.estado === "emitida", "emissao");
  const historico = json(await pedir("GET", "/api/documentos/" + documento.documento.id + "/versoes", { headers: sessao.headers }));
  assert(historico.versoes.length === 1 && historico.versoes[0].estado === "emitida", "historico");
  const busca = json(await pedir("GET", "/api/documentos?q=" + ID, { headers: sessao.headers }));
  assert(busca.documentos.length === 1 && busca.documentos[0].orcamento_id === ID, "busca do historico");
  const arquivo = await pedir("GET", "/api/documentos/versoes/" + emitida.versao.id + "/pdf", { headers: sessao.headers });
  const deNovo = await pedir("GET", "/api/documentos/versoes/" + emitida.versao.id + "/pdf", { headers: sessao.headers });
  assert(arquivo.status === 200 && arquivo.body.equals(deNovo.body), "versao estavel");

  await pedir("POST", "/api/auth/logout", {
    headers: Object.assign({ "X-CSRF-Token": sessao.csrf }, sessao.headers),
    body: {}
  });
  const outra = await entrar();
  const outraLista = json(await pedir("GET", "/api/orcamentos", { headers: outra.headers }));
  const outraFin = json(await pedir("GET", "/api/financeiro/contratos", { headers: outra.headers }));
  assert(JSON.stringify(outraLista) === JSON.stringify(json(await pedir("GET", "/api/orcamentos", { headers: outra.headers }))), "recarga");
  assert(outraLista[0].id === ID && outraLista[0].observacoes_internas === "Referencia interna da sincronia", "outra sessao");
  assert(outraFin.totais.recebido_centavos === 0 && outraFin.totais.contratado_centavos === 10000, "financeiro da outra sessao");
  await navegador(outra.cookie);

  const depois = censoReal();
  assert(JSON.stringify(depois) === JSON.stringify(antes), "banco real");
  process.stdout.write(JSON.stringify({ ok: true, orcamentos: depois.n, hash: depois.hash }));
}

main().catch((erro) => {
  process.stderr.write(erro.stack + "\n");
  process.exitCode = 1;
}).finally(() => {
  if (chrome) chrome.kill();
  if (servidor) servidor.kill();
});
