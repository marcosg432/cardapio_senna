/**
 * Confirmação manual de contrato.
 * O banco real é só lido. Gravações usam SQLite temporário e clientes fictícios.
 */
const { spawn } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const bcrypt = require("bcryptjs");
const { DatabaseSync } = require("node:sqlite");

const PORT = 3229;
const SENHA = "senha-de-teste-local";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const root = path.join(__dirname, "..");
const dbReal = path.join(root, "database", "database.sqlite");
const tmpDb = path.join(os.tmpdir(), "candyli-confirmar-" + Date.now() + ".sqlite");
const perfil = path.join(os.tmpdir(), "candyli-chrome-confirmar-" + Date.now());
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
    confirmados: confirmados
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
    if (opcoes.origin) headers.Origin = opcoes.origin;
    const req = http.request({ hostname: "127.0.0.1", port: PORT, path: urlPath, method: method, headers: headers }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks).toString("utf8")
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
  throw new Error("tela não ficou pronta");
}

async function main() {
  const antes = assinaturaReal();
  assert(antes.ic === "ok" && antes.n >= 1, "os orçamentos reais não estão intactos");

  const hoje = isoLocal(new Date());
  fs.rmSync(tmpDb, { force: true });
  await subir();
  const db = new DatabaseSync(tmpDb);
  db.prepare("INSERT INTO admin_usuarios (usuario, senha_hash) VALUES (?, ?)").run("admin", bcrypt.hashSync(SENHA, 12));
  const original = {
    id: 910010,
    cliente: "Cliente Alfa",
    nome_cliente: "Cliente Alfa",
    tipo_evento: "Casamento",
    data_evento: hoje,
    evento_data: hoje,
    status: "contrato_gerado",
    valor_original: 150,
    valor_final: 150,
    total: 150,
    entrada: 40,
    itens: [{ nome: "Doce teste", quantidade: 50, preco_unitario: 3, preco: 3, subtotal: 150 }],
    contrato: { status: "emitido", valor_final: 150, data_contrato: "2026-01-02T00:00:00.000Z" },
    contrato_pdf: { tipo: "contrato", gerado_em: "2026-01-02T00:00:00.000Z" },
    observacoes: "texto original"
  };
  db.prepare("INSERT INTO orcamentos (id, payload) VALUES (?, ?)").run(original.id, JSON.stringify(original));
  db.close();

  const semSessao = await pedir("POST", "/api/orcamentos/910010/confirmar-contrato", { body: {} });
  assert(semSessao.status === 401, "confirmação sem sessão veio " + semSessao.status);

  const login = await pedir("POST", "/api/auth/login", { body: { senha: SENHA } });
  assert(login.status === 200, "login");
  const cookie = String(login.headers["set-cookie"]).split(";")[0];
  const csrf = JSON.parse(login.body).csrfToken;
  const token = decodeURIComponent(cookie.split("=").slice(1).join("="));

  const semCsrf = await pedir("POST", "/api/orcamentos/910010/confirmar-contrato", { cookie: cookie, body: { valor_recebido: 999 } });
  assert(semCsrf.status === 403, "confirmação sem CSRF veio " + semCsrf.status);

  const primeira = await pedir("POST", "/api/orcamentos/910010/confirmar-contrato", {
    cookie: cookie,
    csrf: csrf,
    body: { valor_recebido: 999, entrada: 1, gestao_contrato: { status: "confirmado", confirmado_em: "1999-01-01T00:00:00.000Z" } }
  });
  assert(primeira.status === 200, "confirmação veio " + primeira.status);
  const feita = JSON.parse(primeira.body);
  assert(feita.gestao_contrato.status === "confirmado" && feita.repetida === false, "estado confirmado");
  assert(feita.gestao_contrato.confirmado_em !== "1999-01-01T00:00:00.000Z", "data veio do navegador");
  assert(primeira.body.indexOf("Cliente Alfa") === -1, "resposta expôs o cliente");

  const segunda = await pedir("POST", "/api/orcamentos/910010/confirmar-contrato", { cookie: cookie, csrf: csrf, body: {} });
  const repetida = JSON.parse(segunda.body);
  assert(segunda.status === 200 && repetida.repetida === true, "repetição não foi idempotente");
  assert(repetida.gestao_contrato.confirmado_em === feita.gestao_contrato.confirmado_em, "data original mudou");

  const lista = await pedir("GET", "/api/orcamentos", { cookie: cookie });
  const salvo = JSON.parse(lista.body).find((item) => item.id === 910010);
  assert(salvo.cliente === original.cliente && salvo.observacoes === original.observacoes, "payload original mudou");
  assert(salvo.entrada === 40, "entrada foi tratada como pagamento");
  assert(JSON.stringify(salvo.contrato) === JSON.stringify(original.contrato), "objeto contrato mudou");
  assert(JSON.stringify(salvo.contrato_pdf) === JSON.stringify(original.contrato_pdf), "PDF gravado mudou");
  assert(salvo.gestao_contrato.confirmado_em === feita.gestao_contrato.confirmado_em, "confirmação não ficou no payload");

  const forjado = await pedir("PATCH", "/api/orcamentos/910010", {
    cookie: cookie,
    csrf: csrf,
    body: { gestao_contrato: { status: "confirmado", confirmado_em: "1999-01-01T00:00:00.000Z" }, observacoes: "texto original" }
  });
  assert(forjado.status === 409, "PATCH forjado veio " + forjado.status);
  const listaForjada = await pedir("GET", "/api/orcamentos", { cookie: cookie });
  const depoisPatch = JSON.parse(listaForjada.body).find((item) => item.id === 910010);
  assert(depoisPatch.gestao_contrato.confirmado_em === feita.gestao_contrato.confirmado_em, "PATCH forjou a confirmação");
  assert(depoisPatch.observacoes === original.observacoes, "PATCH rejeitado alterou o orçamento");

  const publico = await pedir("POST", "/api/orcamentos", {
    body: {
      id: 910011,
      cliente: "Cliente Publico",
      nome_cliente: "Cliente Publico",
      data_evento: hoje,
      valor_final: 10,
      itens: [],
      gestao_contrato: { status: "confirmado", confirmado_em: "1999-01-01T00:00:00.000Z" }
    }
  });
  assert(publico.status === 201, "orçamento público veio " + publico.status);
  assert(!JSON.parse(publico.body).gestao_contrato, "pedido público gravou confirmação");

  const home = await pedir("GET", "/");
  const pdf = await pedir("GET", "/js/contrato-pdf.js");
  assert(home.status === 200 && home.body.indexOf("Candy Li") !== -1, "cardápio");
  assert(pdf.status === 200 && pdf.body.indexOf("gerarContratoPDF") !== -1, "PDF");

  const outro = new DatabaseSync(tmpDb);
  outro.prepare("INSERT INTO orcamentos (id, payload) VALUES (?, ?)").run(910012, JSON.stringify({
    id: 910012,
    cliente: "Cliente Beta",
    nome_cliente: "Cliente Beta",
    tipo_evento: "Aniversário",
    data_evento: hoje,
    evento_data: hoje,
    status: "novo_orcamento",
    valor_original: 80,
    valor_final: 80,
    total: 80,
    itens: []
  }));
  outro.close();

  chrome = spawn(CHROME, [
    "--headless=new", "--disable-gpu", "--no-first-run", "--disable-extensions",
    "--remote-debugging-port=9341", "--user-data-dir=" + perfil, "about:blank"
  ], { stdio: "ignore" });
  await esperarHttp("http://127.0.0.1:9341/json/version");
  const alvos = await new Promise((resolve, reject) => {
    http.get("http://127.0.0.1:9341/json/list", (res) => {
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
  await enviar("Page.navigate", { url: "http://127.0.0.1:" + PORT + "/admin/gestao/contratos.html" });
  await avaliar(enviar, "[...document.querySelectorAll('#gestao-contratos-corpo tr')].some((tr) => tr.textContent.indexOf('910012') !== -1)");
  const cancelou = await avaliar(enviar, `(() => {
    const linha = [...document.querySelectorAll("#gestao-contratos-corpo tr")].find((tr) => tr.textContent.indexOf("910012") !== -1);
    linha.querySelector(".gestao-confirmar").click();
    const aberto = document.getElementById("gestao-modal").hidden === false;
    const titulo = document.getElementById("gestao-modal-titulo").textContent;
    document.getElementById("gestao-modal-cancelar").click();
    return { aberto: aberto, titulo: titulo, fechado: document.getElementById("gestao-modal").hidden === true };
  })()`);
  assert(cancelou.aberto && cancelou.fechado && cancelou.titulo.indexOf("Cliente Beta") !== -1, "janela de confirmação");
  const aposCancelar = await pedir("GET", "/api/orcamentos/910012", { cookie: cookie });
  assert(!JSON.parse(aposCancelar.body).gestao_contrato, "cancelar gravou confirmação");

  await avaliar(enviar, `(() => {
    const linha = [...document.querySelectorAll("#gestao-contratos-corpo tr")].find((tr) => tr.textContent.indexOf("910012") !== -1);
    linha.querySelector(".gestao-confirmar").click();
    document.getElementById("gestao-modal-confirmar").click();
    return true;
  })()`);
  await avaliar(enviar, `(() => {
    const linha = [...document.querySelectorAll("#gestao-contratos-corpo tr")].find((tr) => tr.textContent.indexOf("910012") !== -1);
    return linha && linha.textContent.indexOf("Confirmado") !== -1;
  })()`);
  const betaLista = await pedir("GET", "/api/orcamentos/910012", { cookie: cookie });
  assert(JSON.parse(betaLista.body).gestao_contrato.status === "confirmado", "botão não confirmou");

  await enviar("Page.navigate", { url: "http://127.0.0.1:" + PORT + "/admin/gestao/agenda.html" });
  await avaliar(enviar, "document.body.innerText.indexOf('Cliente Beta') !== -1");
  const agenda = await avaliar(enviar, `(() => {
    const el = [...document.querySelectorAll("a.gestao-evento")].find((a) => a.textContent.indexOf("Cliente Beta") !== -1);
    return { classe: el ? el.className : "", href: el ? el.getAttribute("href") : "" };
  })()`);
  assert(agenda.classe.indexOf("gestao-evento--confirmado") !== -1, "agenda não marcou confirmado");
  assert(agenda.classe.indexOf("gestao-evento--nao-confirmado") === -1, "confirmado continuou tracejado");
  assert(agenda.href.indexOf("910012") !== -1, "agenda perdeu o orçamento original");

  await enviar("Page.navigate", { url: "http://127.0.0.1:" + PORT + "/admin/gestao/index.html" });
  await avaliar(enviar, "document.getElementById('indicador-orcamentos').textContent !== '\u2026'");
  await avaliar(enviar, "document.getElementById('indicador-total-contratado').textContent === 'R$ 230,00'");
  const painel = await avaliar(enviar, `(() => ({
    orcamentos: document.getElementById("indicador-orcamentos").textContent,
    confirmados: document.getElementById("indicador-confirmados").textContent,
    pdfs: document.getElementById("indicador-pdfs").textContent,
    eventos: document.getElementById("indicador-eventos").textContent,
    contratado: document.getElementById("indicador-total-contratado").textContent,
    recebido: document.getElementById("indicador-total-recebido").textContent,
    pendente: document.getElementById("indicador-total-pendente").textContent
  }))()`);
  assert(painel.orcamentos === "3" && painel.confirmados === "2" && painel.pdfs === "1" && painel.eventos === "2", "dashboard " + JSON.stringify(painel));
  assert(painel.contratado === "R$ 230,00" && painel.recebido === "R$ 0,00" && painel.pendente === "R$ 230,00", "financeiro " + JSON.stringify(painel));

  const depois = assinaturaReal();
  assert(depois.hash === antes.hash && depois.confirmados === antes.confirmados && depois.n === antes.n, "orçamentos reais foram alterados");
  console.log("Confirmação de contrato ok.");
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
      fs.rmSync(tmpDb, { force: true });
      fs.rmSync(tmpDb + "-wal", { force: true });
      fs.rmSync(tmpDb + "-shm", { force: true });
      fs.rmSync(perfil, { recursive: true, force: true });
    }, 400);
  });
