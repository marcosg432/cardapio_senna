/**
 * Consulta de contratos e agenda.
 * O banco real é só lido. A tela roda com orçamentos fictícios num SQLite temporário.
 */
const { spawn } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const bcrypt = require("bcryptjs");
const { DatabaseSync } = require("node:sqlite");
const consulta = require("../js/gestao/consulta");

const PORT = 3225;
const SENHA = "senha-de-teste-local";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const root = path.join(__dirname, "..");
const dbReal = path.join(root, "database", "database.sqlite");
const tmpDb = path.join(os.tmpdir(), "candyli-gestao-consulta-" + Date.now() + ".sqlite");
const perfil = path.join(os.tmpdir(), "candyli-chrome-" + Date.now());
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
  return { ic: ic, n: rows.length, hash: crypto.createHash("sha256").update(texto).digest("hex"), rows: rows };
}

function conferirReais(antes) {
  const atual = assinaturaReal();
  assert(atual.ic === "ok", "integridade do SQLite");
  assert(atual.n === antes.n && antes.n >= 1, "a lista real mudou de tamanho");
  assert(atual.hash === antes.hash, "os orçamentos reais foram alterados");
  const lista = atual.rows.map((row) => JSON.parse(row.payload));
  assert(lista.every((o) => consulta.nomeCliente(o).length > 0), "há orçamento sem nome");
  assert(lista.every((o) => consulta.dataEvento(o)), "há orçamento sem data_evento válida");
  assert(lista.every((o) => consulta.eventoConfirmado(o) === consulta.contratoConfirmado(o)), "agenda divergiu da confirmação");
  assert(lista.every((o) => consulta.contratoConfirmado(o) === !!(o.gestao_contrato && o.gestao_contrato.status === "confirmado")), "status antigo foi tratado como confirmado");
  assert(lista.every((o) => consulta.hrefOrcamento(o.id).indexOf("orcamento.html?id=") !== -1), "link do orçamento");
  assert(lista.every((o) => Number.isFinite(consulta.valorFinal(o))), "valor final inválido");
  lista.forEach((o) => {
    const data = consulta.dataEvento(o);
    const grade = consulta.gradeDoMes(data.ano, data.mes);
    assert(grade.some((celula) => celula.iso === data.iso && !celula.fora), "data fora do mês do calendário");
  });
  const pedaco = consulta.nomeCliente(lista[0]).slice(0, 4);
  const achou = consulta.filtrar(lista, { busca: pedaco, status: "todos" });
  assert(achou.some((o) => String(o.id) === String(lista[0].id)), "busca não encontrou o cliente");
  assert(consulta.filtrar(lista, { busca: "zzzz-inexistente", status: "todos" }).length === 0, "busca fantasma");
  const gerados = consulta.filtrar(lista, { busca: "", status: "contrato_gerado" });
  const pdfs = lista.filter(consulta.pdfEmitido);
  console.log("reais", atual.n, "pdfs", pdfs.length, "status_contrato_gerado", gerados.length, "confirmados", lista.filter(consulta.contratoConfirmado).length);
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
    const req = http.request({ hostname: "127.0.0.1", port: PORT, path: urlPath, method: method, headers: headers }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, loc: res.headers.location || "", headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
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

async function main() {
  const antes = assinaturaReal();
  conferirReais(antes);

  const hoje = new Date();
  const alfaData = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  const betaData = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 2);
  const alfaIso = isoLocal(alfaData);
  const betaIso = isoLocal(betaData);

  fs.rmSync(tmpDb, { force: true });
  await subir();
  const db = new DatabaseSync(tmpDb);
  db.prepare("INSERT INTO admin_usuarios (usuario, senha_hash) VALUES (?, ?)").run("admin", bcrypt.hashSync(SENHA, 12));
  function gravar(id, nome, iso, status, pdf) {
    const payload = {
      id: id,
      cliente: nome,
      nome_cliente: nome,
      data_evento: iso,
      evento_data: iso,
      status: status,
      valor_original: 150,
      valor_final: 150,
      total: 150,
      itens: [],
      contrato_pdf: pdf ? { tipo: "contrato", gerado_em: "2026-01-01T00:00:00.000Z" } : null
    };
    db.prepare("INSERT INTO orcamentos (id, payload) VALUES (?, ?)").run(id, JSON.stringify(payload));
  }
  gravar(910001, "Cliente Alfa", alfaIso, "novo_orcamento", false);
  gravar(910002, "Cliente Beta", betaIso, "contrato_gerado", true);
  db.close();

  const fechado = await pedir("GET", "/admin/gestao/contratos.html");
  assert(fechado.status === 302 && fechado.loc === "/admin/", "contratos sem sessão");
  const agendaFechada = await pedir("GET", "/admin/gestao/agenda.html");
  assert(agendaFechada.status === 302, "agenda sem sessão");
  const apiFechada = await pedir("GET", "/api/orcamentos");
  assert(apiFechada.status === 401, "API sem sessão");
  const home = await pedir("GET", "/");
  assert(home.status === 200 && home.body.indexOf("Candy Li") !== -1, "cardápio");
  const pdf = await pedir("GET", "/js/contrato-pdf.js");
  assert(pdf.status === 200 && pdf.body.indexOf("gerarContratoPDF") !== -1, "PDF");

  const login = await pedir("POST", "/api/auth/login", { body: { senha: SENHA } });
  assert(login.status === 200, "login de teste");
  const cookie = String(login.headers["set-cookie"]).split(";")[0];
  const token = decodeURIComponent(cookie.split("=").slice(1).join("="));

  chrome = spawn(CHROME, [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--disable-extensions",
    "--remote-debugging-port=9334",
    "--user-data-dir=" + perfil,
    "about:blank"
  ], { stdio: "ignore" });
  await esperarHttp("http://127.0.0.1:9334/json/version");
  const listaAlvos = await new Promise((resolve, reject) => {
    http.get("http://127.0.0.1:9334/json/list", (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))));
    }).on("error", reject);
  });
  const alvo = listaAlvos.find((item) => item.type === "page");
  const ws = new WebSocket(alvo.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve);
    ws.addEventListener("error", reject);
  });
  const enviar = cdp(ws);
  await enviar("Network.enable");
  await enviar("Page.enable");
  await enviar("Network.setCookie", { name: "cl_sessao", value: token, url: "http://127.0.0.1:" + PORT + "/" });

  await enviar("Page.navigate", { url: "http://127.0.0.1:" + PORT + "/admin/gestao/contratos.html" });
  await avaliar(enviar, "document.querySelectorAll('#gestao-contratos-corpo tr').length === 2");
  const contratos = await avaliar(enviar, `(() => {
    const linhas = [...document.querySelectorAll("#gestao-contratos-corpo tr")].map((tr) => tr.innerText);
    const links = [...document.querySelectorAll("a.gestao-abrir")].map((a) => a.getAttribute("href"));
    return {
      linhas: linhas.length,
      alfa: linhas.some((t) => t.indexOf("Cliente Alfa") !== -1 && t.indexOf("910001") !== -1),
      beta: linhas.some((t) => t.indexOf("Cliente Beta") !== -1 && t.toLowerCase().indexOf("pdf emitido") !== -1),
      links: links.length > 0 && links.every((href) => href.indexOf("orcamento.html?id=") !== -1),
      confirmado: /gestao-evento--confirmado(?!-)/.test(document.body.innerHTML)
    };
  })()`);
  assert(contratos.linhas === 2 && contratos.alfa && contratos.beta && contratos.links && !contratos.confirmado, "tabela de contratos");

  const busca = await avaliar(enviar, `(() => {
    const campo = document.getElementById("gestao-busca");
    campo.value = "Alfa";
    campo.dispatchEvent(new Event("input", { bubbles: true }));
    const nomes = [...document.querySelectorAll("#gestao-contratos-corpo tr td:first-child")].map((td) => td.textContent);
    return { n: nomes.length, soAlfa: nomes.length === 1 && nomes[0] === "Cliente Alfa" };
  })()`);
  assert(busca.n === 1 && busca.soAlfa, "busca por nome");

  const filtro = await avaliar(enviar, `(() => {
    document.getElementById("gestao-busca").value = "";
    document.getElementById("gestao-busca").dispatchEvent(new Event("input", { bubbles: true }));
    const sel = document.getElementById("gestao-status");
    sel.value = "novo_orcamento";
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    return document.querySelectorAll("#gestao-contratos-corpo tr").length;
  })()`);
  assert(filtro === 1, "filtro de status");

  await enviar("Page.navigate", { url: "http://127.0.0.1:" + PORT + "/admin/gestao/agenda.html" });
  await avaliar(enviar, "document.body.innerText.indexOf('Cliente Alfa') !== -1");
  const agenda = await avaliar(enviar, `(() => {
    const alfa = document.querySelector("a.gestao-evento");
    return {
      titulo: document.getElementById("agenda-titulo").textContent,
      classe: alfa ? alfa.className : "",
      href: alfa ? alfa.getAttribute("href") : ""
    };
  })()`);
  assert(agenda.classe.indexOf("gestao-evento--nao-confirmado") !== -1, "evento sem marca de não confirmado");
  assert(agenda.classe.indexOf("gestao-evento--confirmado") === -1, "evento confirmado indevidamente");
  assert(agenda.href.indexOf("910001") !== -1, "link do evento");

  await avaliar(enviar, "(() => { document.getElementById('agenda-proximo').click(); return true; })()");
  await avaliar(enviar, "document.body.innerText.indexOf('Cliente Beta') !== -1");
  const beta = await avaliar(enviar, `(() => {
    const el = [...document.querySelectorAll("a.gestao-evento")].find((a) => a.textContent.indexOf("Cliente Beta") !== -1);
    return el ? el.className : "";
  })()`);
  assert(beta.indexOf("gestao-evento--nao-confirmado") !== -1 && beta.indexOf("gestao-evento--pdf") !== -1, "PDF não pode parecer confirmado");

  await enviar("Page.navigate", { url: "http://127.0.0.1:" + PORT + "/admin/gestao/index.html" });
  await avaliar(enviar, "document.getElementById('indicador-orcamentos').textContent === '2'");
  await avaliar(enviar, "document.getElementById('indicador-total-contratado').textContent === 'R$ 0,00'");
  const painel = await avaliar(enviar, `(() => ({
    orcamentos: document.getElementById("indicador-orcamentos").textContent,
    confirmados: document.getElementById("indicador-confirmados").textContent,
    pdfs: document.getElementById("indicador-pdfs").textContent,
    eventos: document.getElementById("indicador-eventos").textContent,
    contratado: document.getElementById("indicador-total-contratado").textContent,
    recebido: document.getElementById("indicador-total-recebido").textContent,
    pendente: document.getElementById("indicador-total-pendente").textContent,
    entrada: document.body.innerText.indexOf("entrada prevista") !== -1
  }))()`);
  assert(painel.orcamentos === "2" && painel.confirmados === "0" && painel.pdfs === "1" && painel.eventos === "0", "dashboard " + JSON.stringify(painel));
  assert(painel.contratado === "R$ 0,00" && painel.recebido === "R$ 0,00" && painel.pendente === "R$ 0,00" && painel.entrada, "financeiro " + JSON.stringify(painel));

  await enviar("Page.navigate", { url: "http://127.0.0.1:" + PORT + "/admin/orcamento.html?id=910001" });
  const detalhe = await avaliar(enviar, "location.pathname.indexOf('orcamento.html') !== -1 && document.body.innerText.indexOf('Cliente Alfa') !== -1 && document.getElementById('btn-historico-pdf') && document.getElementById('btn-historico-pdf').getAttribute('href').indexOf('documentos.html?q=910001') !== -1");
  assert(detalhe === true, "abertura do orçamento original");

  await enviar("Network.clearBrowserCookies");
  await enviar("Page.navigate", { url: "http://127.0.0.1:" + PORT + "/admin/gestao/agenda.html" });
  const semSessao = await avaliar(enviar, "location.pathname === '/admin/' || location.pathname === '/admin/index.html'");
  assert(semSessao === true, "agenda sem sessão permaneceu aberta");

  ws.close();
  conferirReais(antes);
  console.log("Consulta de contratos e agenda ok.");
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
