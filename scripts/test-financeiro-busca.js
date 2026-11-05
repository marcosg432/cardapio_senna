/**
 * Pesquisa da lista em Gestão → Financeiro.
 * O SQLite temporário recebe só clientes fictícios. O banco real é apenas lido para conferir que não mudou.
 */
const { spawn } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const bcrypt = require("bcryptjs");
const { DatabaseSync } = require("node:sqlite");

const PORT = 3325;
const DEPURACAO = 9493;
const SENHA = "senha-de-teste-local";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const root = path.join(__dirname, "..");
const dbReal = path.join(root, "database", "database.sqlite");
const tmpDb = path.join(os.tmpdir(), "candyli-financeiro-busca-" + Date.now() + ".sqlite");
const perfil = path.join(os.tmpdir(), "candyli-chrome-financeiro-busca-" + Date.now());
let servidor;
let chrome;

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function hashArquivo(arquivo) {
  if (!fs.existsSync(arquivo)) return null;
  return crypto.createHash("sha256").update(fs.readFileSync(arquivo)).digest("hex");
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
      hostname: "127.0.0.1",
      port: PORT,
      path: urlPath,
      method: method,
      headers: headers
    }, (res) => {
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
      env: Object.assign({}, process.env, {
        PORT: String(PORT),
        DATABASE_PATH: tmpDb,
        COOKIE_SECURE: "0"
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

function derrubar(proc) {
  return new Promise((resolve) => {
    if (!proc || proc.killed) return resolve();
    proc.once("exit", () => resolve());
    proc.kill();
  });
}

function sessaoDe(resposta) {
  const bruto = resposta.headers["set-cookie"] || [];
  const lista = Array.isArray(bruto) ? bruto : [bruto];
  const cookie = lista.map((item) => String(item).split(";")[0]).find((item) => item.indexOf("cl_sessao=") === 0);
  const corpo = JSON.parse(resposta.body);
  return { cookie: cookie, csrf: corpo.csrfToken, token: decodeURIComponent(cookie.split("=").slice(1).join("=")) };
}

function orcamento(id, nome, extra) {
  return Object.assign({
    id: id,
    cliente: nome,
    nome_cliente: nome,
    data_evento: "2026-08-15",
    evento_data: "2026-08-15",
    valor_original: 100,
    valor_final: 100,
    total: 100,
    itens: [{ nome: "Brigadeiro", quantidade: 50, unidade: "unidade", preco: 2, preco_unitario: 2, subtotal: 100, qtd_min: 50 }]
  }, extra || {});
}

async function main() {
  assert(fs.existsSync(CHROME), "chrome ausente");
  const realAntes = {
    db: hashArquivo(dbReal),
    wal: hashArquivo(dbReal + "-wal"),
    shm: hashArquivo(dbReal + "-shm")
  };
  fs.rmSync(tmpDb, { force: true });
  await subir();
  const db = new DatabaseSync(tmpDb);
  db.prepare("INSERT INTO admin_usuarios (usuario, senha_hash) VALUES (?, ?)").run("admin", bcrypt.hashSync(SENHA, 12));
  const agora = new Date().toISOString();
  const inserir = db.prepare("INSERT INTO orcamentos (id, payload, created_at, updated_at) VALUES (?, ?, ?, ?)");
  for (let n = 1; n <= 12; n++) {
    const id = 882000 + n;
    const item = orcamento(id, "Contrato Fila " + String(n).padStart(2, "0"));
    inserir.run(id, JSON.stringify(item), agora, agora);
  }
  inserir.run(882020, JSON.stringify(orcamento(882020, "Maria Silva", {
    contato_nome: "João Souza",
    contrato_numero_exibicao: "2027346",
    data_evento: "2026-12-01",
    evento_data: "2026-12-01"
  })), agora, agora);
  inserir.run(882021, JSON.stringify(orcamento(882021, "Ágata Nunes", {
    data_evento: "2026-12-20",
    evento_data: "2026-12-20"
  })), agora, agora);
  inserir.run(882022, JSON.stringify(orcamento(882022, "Pedro Lima", {
    data_evento: "2026-06-01",
    evento_data: "2026-06-01"
  })), agora, agora);
  inserir.run(882023, JSON.stringify(orcamento(882023, "Não Confirmado", {
    data_evento: "2026-12-10",
    evento_data: "2026-12-10"
  })), agora, agora);
  db.close();

  const semSessao = await pedir("GET", "/api/financeiro/contratos");
  assert(semSessao.status === 401, "lista sem sessao " + semSessao.status);
  const login = await pedir("POST", "/api/auth/login", { body: { senha: SENHA } });
  assert(login.status === 200, "login " + login.status);
  const sessao = sessaoDe(login);
  const ids = [];
  for (let n = 1; n <= 12; n++) ids.push(882000 + n);
  ids.push(882020, 882021, 882022);
  for (const id of ids) {
    const resposta = await pedir("POST", "/api/orcamentos/" + id + "/confirmar-contrato", {
      cookie: sessao.cookie,
      csrf: sessao.csrf,
      body: {}
    });
    assert(resposta.status === 200, "confirmar " + id + " " + resposta.status);
  }
  const lista = await pedir("GET", "/api/financeiro/contratos", { cookie: sessao.cookie });
  const listaJson = JSON.parse(lista.body);
  assert(listaJson.contratos.length === 15, "quantidade " + listaJson.contratos.length);
  assert(lista.body.indexOf("João Souza") === -1 && lista.body.indexOf("2027346") === -1, "lista financeira expôs a ficha");
  assert(listaJson.totais.contratado_centavos === 150000, "total " + listaJson.totais.contratado_centavos);
  const previa = new DatabaseSync(tmpDb, { readOnly: true });
  const congeladoAntes = previa.prepare("SELECT valor_contratado_centavos FROM financeiro_contratos WHERE orcamento_id = 882020").get();
  previa.close();
  assert(congeladoAntes.valor_contratado_centavos === 10000, "congelado maria");

  chrome = spawn(CHROME, [
    "--headless=new", "--disable-gpu", "--no-first-run", "--window-size=390,844",
    "--remote-debugging-port=" + DEPURACAO, "--user-data-dir=" + perfil, "about:blank"
  ], { stdio: "ignore" });
  const inicio = Date.now();
  await new Promise((resolve, reject) => {
    (function tentar() {
      http.get("http://127.0.0.1:" + DEPURACAO + "/json/version", (res) => {
        res.resume();
        resolve();
      }).on("error", () => {
        if (Date.now() - inicio > 8000) reject(new Error("chrome"));
        else setTimeout(tentar, 150);
      });
    })();
  });
  const abas = await new Promise((resolve, reject) => {
    http.get("http://127.0.0.1:" + DEPURACAO + "/json/list", (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))));
    }).on("error", reject);
  });
  const ws = new WebSocket(abas.find((item) => item.type === "page").webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve);
    ws.addEventListener("error", reject);
  });
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
  function enviar(method, params) {
    const id = ++seq;
    return new Promise((resolve, reject) => {
      pendentes.set(id, { resolve: resolve, reject: reject });
      ws.send(JSON.stringify({ id: id, method: method, params: params || {} }));
    });
  }
  async function avaliar(expressao) {
    const limite = Date.now() + 15000;
    let ultimo = null;
    while (Date.now() < limite) {
      const saida = await enviar("Runtime.evaluate", { expression: expressao, returnByValue: true });
      ultimo = saida.result && saida.result.value;
      if (ultimo === true) return true;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    throw new Error("tela " + expressao + " " + JSON.stringify(ultimo));
  }
  async function ler(expressao) {
    const saida = await enviar("Runtime.evaluate", { expression: expressao, returnByValue: true });
    return saida.result && saida.result.value;
  }
  function nomes() {
    return "[...document.querySelectorAll('#financeiro-corpo tr')].map((tr) => tr.cells[0].textContent).join('|')";
  }

  await enviar("Network.enable");
  await enviar("Page.enable");
  await enviar("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await enviar("Network.setCookie", { name: "cl_sessao", value: sessao.token, url: "http://127.0.0.1:" + PORT + "/" });
  await enviar("Page.navigate", { url: "http://127.0.0.1:" + PORT + "/admin/gestao/financeiro.html" });
  await avaliar("document.querySelectorAll('#financeiro-corpo tr').length === 15 && document.getElementById('financeiro-total-contratado').textContent === 'R$ 1.500,00' && document.body.innerText.indexOf('Não Confirmado') === -1 && !!document.getElementById('financeiro-registrar')");

  await ler("document.getElementById('financeiro-busca').value = 'SILVA'; document.getElementById('financeiro-busca').dispatchEvent(new Event('input', { bubbles: true })); true");
  await avaliar(nomes() + " === 'Maria Silva'");
  await ler("document.getElementById('financeiro-busca').value = 'souza'; document.getElementById('financeiro-busca').dispatchEvent(new Event('input', { bubbles: true })); true");
  await avaliar(nomes() + " === 'Maria Silva'");
  await ler("document.getElementById('financeiro-busca').value = '2027346'; document.getElementById('financeiro-busca').dispatchEvent(new Event('input', { bubbles: true })); true");
  await avaliar(nomes() + " === 'Maria Silva' && document.querySelector('#financeiro-corpo button').textContent === 'Ver financeiro'");
  await ler("document.getElementById('financeiro-busca').value = 'agata'; document.getElementById('financeiro-busca').dispatchEvent(new Event('input', { bubbles: true })); true");
  await avaliar(nomes() + " === 'Ágata Nunes'");
  await ler("document.getElementById('financeiro-busca').value = '882021'; document.getElementById('financeiro-busca').dispatchEvent(new Event('input', { bubbles: true })); true");
  await avaliar(nomes() + " === 'Ágata Nunes'");

  await ler("document.getElementById('financeiro-busca').value = ''; document.getElementById('financeiro-data-inicial').value = '2026-12-01'; document.getElementById('financeiro-data-final').value = '2026-12-31'; document.getElementById('financeiro-data-final').dispatchEvent(new Event('change', { bubbles: true })); true");
  await avaliar("document.querySelectorAll('#financeiro-corpo tr').length === 2 && " + nomes() + ".indexOf('Maria Silva') !== -1 && " + nomes() + ".indexOf('Ágata Nunes') !== -1 && " + nomes() + ".indexOf('Pedro Lima') === -1");
  await ler("document.getElementById('financeiro-busca').value = 'silva'; document.getElementById('financeiro-busca').dispatchEvent(new Event('input', { bubbles: true })); true");
  await avaliar(nomes() + " === 'Maria Silva' && document.getElementById('financeiro-total-contratado').textContent === 'R$ 1.500,00'");
  await ler("document.getElementById('financeiro-busca').value = 'zzzz-inexistente'; document.getElementById('financeiro-busca').dispatchEvent(new Event('input', { bubbles: true })); true");
  await avaliar("document.querySelectorAll('#financeiro-corpo tr').length === 0 && document.getElementById('financeiro-sem-resultado').hidden === false && document.getElementById('financeiro-sem-resultado').textContent.indexOf('Nenhum contrato encontrado') !== -1");
  await ler("document.getElementById('financeiro-limpar').click(); true");
  await avaliar("document.querySelectorAll('#financeiro-corpo tr').length === 15 && document.getElementById('financeiro-busca').value === '' && document.getElementById('financeiro-data-inicial').value === ''");

  const mobile = await ler(`(() => {
    const busca = document.getElementById('financeiro-busca').getBoundingClientRect();
    const inicio = document.getElementById('financeiro-data-inicial').getBoundingClientRect();
    const fim = document.getElementById('financeiro-data-final').getBoundingClientRect();
    const limpar = document.getElementById('financeiro-limpar').getBoundingClientRect();
    const reserva = document.getElementById('financeiro-tabela').getBoundingClientRect();
    const botao = document.querySelector('#financeiro-corpo button');
    const caixas = [busca, inicio, fim, limpar, reserva];
    return {
      ok: window.innerWidth === 390 && !!botao &&
        caixas.every((caixa) => caixa.width > 0 && caixa.left >= -1 && caixa.right <= window.innerWidth + 1),
      largura: window.innerWidth,
      busca: Math.round(busca.right),
      inicio: Math.round(inicio.right),
      fim: Math.round(fim.right),
      limpar: Math.round(limpar.right),
      tabela: Math.round(reserva.right)
    };
  })()`);
  assert(mobile && mobile.ok === true, "mobile " + JSON.stringify(mobile));

  await ler("document.getElementById('financeiro-busca').value = '2027346'; document.getElementById('financeiro-busca').dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('#financeiro-corpo button').click(); true");
  await avaliar("document.getElementById('financeiro-detalhe-nome').textContent === 'Maria Silva' && document.getElementById('financeiro-detalhe-meta').textContent.indexOf('882020') !== -1 && document.getElementById('financeiro-form').hidden === false && document.getElementById('financeiro-registrar').textContent === 'Registrar pagamento'");
  ws.close();

  const leitura = new DatabaseSync(tmpDb, { readOnly: true });
  const congelado = leitura.prepare("SELECT valor_contratado_centavos FROM financeiro_contratos WHERE orcamento_id = 882020").get();
  const pagamentos = leitura.prepare("SELECT COUNT(*) AS n FROM pagamentos").get().n;
  const status = JSON.parse(leitura.prepare("SELECT payload FROM orcamentos WHERE id = 882020").get().payload).gestao_contrato.status;
  leitura.close();
  assert(congelado.valor_contratado_centavos === 10000 && pagamentos === 0 && status === "confirmado", "dados financeiros mudaram");

  await derrubar(chrome);
  await derrubar(servidor);
  chrome = null;
  servidor = null;
  const realDepois = {
    db: hashArquivo(dbReal),
    wal: hashArquivo(dbReal + "-wal"),
    shm: hashArquivo(dbReal + "-shm")
  };
  assert(JSON.stringify(realAntes) === JSON.stringify(realDepois), "banco real alterado");
  console.log(JSON.stringify({
    ok: true,
    contratos: 15,
    busca: ["sobrenome", "casal", "numero", "acento", "id"],
    datas: true,
    combinacao: true,
    vazio: true,
    detalhe: 882020,
    mobile: "390x844",
    autenticacao: 401,
    bancoReal: "intacto"
  }));
}

main()
  .catch((e) => {
    console.error(e && e.stack ? e.stack : e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await derrubar(chrome);
    await derrubar(servidor);
    fs.rmSync(tmpDb, { force: true });
    fs.rmSync(tmpDb + "-wal", { force: true });
    fs.rmSync(tmpDb + "-shm", { force: true });
    fs.rmSync(perfil, { recursive: true, force: true });
  });
