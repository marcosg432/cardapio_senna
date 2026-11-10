/**
 * Edição de itens na tela de detalhes.
 * Orçamento aberto, PDF gerado e contrato confirmado.
 * Gravações ficam num SQLite temporário. O banco real não é aberto para escrita.
 */
const { spawn } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const bcrypt = require("bcryptjs");
const { DatabaseSync } = require("node:sqlite");

const PORT = 3319;
const DEPURACAO = 9481;
const SENHA = "senha-de-teste-local";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const root = path.join(__dirname, "..");
const dbReal = path.join(root, "database", "database.sqlite");
const tmpDb = path.join(os.tmpdir(), "candyli-itens-" + Date.now() + ".sqlite");
const perfil = path.join(os.tmpdir(), "candyli-chrome-itens-" + Date.now());
const MENSAGEM = "Este contrato já foi confirmado. Alterações em produtos, quantidades ou valores exigem revisão contratual.";
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

function orcamento(id, extra) {
  return Object.assign({
    id: id,
    cliente: "Cliente Itens",
    nome_cliente: "Cliente Itens",
    email: "itens@example.com",
    telefone: "11988887777",
    data_evento: "2026-12-20",
    evento_data: "2026-12-20",
    tipo_evento: "Casamento",
    evento_tipo: "Casamento",
    itens: [{
      nome: "Brigadeiro de Ninho",
      quantidade: 50,
      unidade: "unidade",
      preco: 2.5,
      preco_unitario: 2.5,
      subtotal: 125,
      qtd_min: 50
    }],
    valor_original: 125,
    valor_final: 125,
    total: 125,
    status: "novo_orcamento"
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
  [orcamento(881001), orcamento(881002, {
    status: "contrato_gerado",
    contrato: { valor_final: 125, data_contrato: agora, status: "emitido" },
    contrato_pdf: { tipo: "contrato", gerado_em: agora }
  }), orcamento(881003)].forEach((item) => {
    db.prepare("INSERT INTO orcamentos (id, payload, created_at, updated_at) VALUES (?, ?, ?, ?)").run(
      item.id, JSON.stringify(item), agora, agora
    );
  });
  db.close();

  const login = await pedir("POST", "/api/auth/login", { body: { senha: SENHA } });
  assert(login.status === 200, "login " + login.status);
  const sessao = sessaoDe(login);
  const confirmar = await pedir("POST", "/api/orcamentos/881003/confirmar-contrato", {
    cookie: sessao.cookie,
    csrf: sessao.csrf,
    body: {}
  });
  assert(confirmar.status === 200, "confirmar " + confirmar.status);

  const leitura = new DatabaseSync(tmpDb, { readOnly: true });
  const congelado = leitura.prepare("SELECT valor_contratado_centavos, congelado_em FROM financeiro_contratos WHERE orcamento_id = 881003").get();
  leitura.close();
  assert(congelado && congelado.valor_contratado_centavos === 12500, "congelado " + JSON.stringify(congelado));

  const bloqueio = await pedir("PATCH", "/api/orcamentos/881003", {
    cookie: sessao.cookie,
    csrf: sessao.csrf,
    body: {
      itens: [{ nome: "Brigadeiro de Nutella", quantidade: 50, unidade: "unidade", preco: 4, preco_unitario: 4, subtotal: 200, qtd_min: 50 }],
      valor_original: 200,
      valor_final: 200,
      total: 200
    }
  });
  assert(bloqueio.status === 409, "api confirmada " + bloqueio.status);
  const minimo = await pedir("PATCH", "/api/orcamentos/881001", {
    cookie: sessao.cookie,
    csrf: sessao.csrf,
    body: {
      itens: [{ nome: "Brigadeiro de Ninho", quantidade: 10, unidade: "unidade", preco: 2.5, preco_unitario: 2.5, subtotal: 25, qtd_min: 50 }]
    }
  });
  assert(minimo.status === 400 && minimo.body.indexOf("pedido mínimo é 50") !== -1, "api minimo " + minimo.status);

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
  async function avaliar(expressao, espera) {
    const limite = Date.now() + (espera || 15000);
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
  async function abrir(id) {
    await enviar("Page.navigate", { url: "http://127.0.0.1:" + PORT + "/admin/orcamento.html?id=" + id });
    await avaliar("!!(document.getElementById('orc-id') && document.getElementById('orc-id').textContent === '" + id + "' && document.getElementById('btn-extra-adicionar-item'))");
    await ler("window.__alertas = []; window.alert = function (msg) { window.__alertas.push(String(msg)); }; true");
  }

  await enviar("Network.enable");
  await enviar("Page.enable");
  await enviar("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true
  });
  await enviar("Network.setCookie", {
    name: "cl_sessao",
    value: sessao.token,
    url: "http://127.0.0.1:" + PORT + "/"
  });

  await abrir(881001);
  await avaliar("document.getElementById('itens-contrato-confirmado').hidden === true && document.getElementById('btn-extra-adicionar-item').disabled === false && document.getElementById('extra-doce-nome').disabled === false && document.querySelector('#lista-itens button[data-acao-extra=\"editar\"]').disabled === false && document.getElementById('os-observacoes').disabled === false");
  await ler("document.getElementById('extra-doce-nome').value = 'Doce extra de teste'; document.getElementById('extra-doce-qtd').value = '1'; document.getElementById('extra-doce-preco').value = '4,50'; document.getElementById('btn-extra-adicionar-item').click(); true");
  await avaliar("document.getElementById('lista-itens').innerText.indexOf('Doce extra de teste') !== -1 && window.__alertas.length === 0");

  await ler(`
    window.__apiOriginal = apiRequestSync;
    apiRequestSync = function (method, path, body) {
      if (method === "PATCH" && window.__falhaPatch) {
        var falha = window.__falhaPatch;
        window.__falhaPatch = null;
        return { ok: false, status: falha.status, body: falha.body || "" };
      }
      return window.__apiOriginal(method, path, body);
    };
    true
  `);
  const falhas = [
    [400, JSON.stringify({ error: "Quantidade inválida para \"Brigadeiro de Ninho\": o pedido mínimo é 50 unidade(s)." }), "Quantidade inválida para \"Brigadeiro de Ninho\": o pedido mínimo é 50 unidade(s)."],
    [401, JSON.stringify({ erro: "Acesso não autorizado." }), "Sua sessão expirou. Entre novamente no painel para salvar os itens."],
    [403, JSON.stringify({ erro: "Não foi possível concluir a operação." }), "Não foi possível confirmar esta operação. Atualize a página e tente novamente."],
    [404, JSON.stringify({ error: "Orçamento não encontrado" }), "Orçamento não encontrado. Atualize a lista e abra o pedido de novo."],
    [409, JSON.stringify({ erro: "Contrato confirmado. Esta alteração precisa de revisão." }), MENSAGEM]
  ];
  for (const falha of falhas) {
    await ler("document.getElementById('extra-doce-nome').value = 'Doce extra de teste'; document.getElementById('extra-doce-qtd').value = '2'; document.getElementById('extra-doce-preco').value = '5,00'; window.__alertas = []; window.__falhaPatch = { status: " + falha[0] + ", body: " + JSON.stringify(falha[1]) + " }; document.getElementById('btn-extra-adicionar-item').click(); true");
    const texto = await ler("window.__alertas[0] || ''");
    assert(texto === falha[2], "mensagem " + falha[0] + " = " + texto);
  }

  await abrir(881002);
  await avaliar("document.getElementById('detalhe-status-contrato').textContent === 'Orçamento em negociação' && document.getElementById('itens-contrato-confirmado').hidden === true && document.getElementById('btn-extra-adicionar-item').disabled === false && document.querySelector('#lista-itens button[data-acao-extra=\"remover\"]').disabled === false");
  await ler("document.getElementById('extra-doce-nome').value = 'Complemento do PDF'; document.getElementById('extra-doce-qtd').value = '1'; document.getElementById('extra-doce-preco').value = '6,00'; document.getElementById('btn-extra-adicionar-item').click(); true");
  await avaliar("document.getElementById('lista-itens').innerText.indexOf('Complemento do PDF') !== -1");

  await abrir(881003);
  await avaliar("document.getElementById('detalhe-status-contrato').textContent === 'Contrato confirmado' && document.getElementById('itens-contrato-confirmado').hidden === false && document.getElementById('itens-contrato-confirmado').textContent === " + JSON.stringify(MENSAGEM) + " && document.getElementById('btn-extra-adicionar-item').disabled === true && document.getElementById('extra-doce-nome').disabled === true && document.getElementById('extra-doce-qtd').disabled === true && document.getElementById('extra-doce-preco').disabled === true && document.querySelector('#lista-itens button[data-acao-extra=\"editar\"]').disabled === true && document.querySelector('#lista-itens button[data-acao-extra=\"remover\"]').disabled === true && document.getElementById('os-observacoes').disabled === false && document.getElementById('os-cerimonialista').disabled === false && document.getElementById('os-suportes').disabled === false && document.getElementById('btn-salvar-os').disabled === false");
  const mobile = await ler(`
    var aviso = document.getElementById('itens-contrato-confirmado').getBoundingClientRect();
    var os = document.getElementById('os-observacoes').getBoundingClientRect();
    var botao = document.getElementById('btn-salvar-os').getBoundingClientRect();
    aviso.width > 0 && aviso.left >= 0 && aviso.right <= window.innerWidth + 1 &&
      os.right <= window.innerWidth + 1 && botao.right <= window.innerWidth + 1 &&
      window.innerWidth === 390
  `);
  assert(mobile === true, "mobile " + JSON.stringify(mobile));
  await ler("document.querySelector('#lista-itens button[data-acao-extra=\"editar\"]').click(); true");
  assert(await ler("document.getElementById('extra-doce-titulo').textContent") === "Incluir doce complementar", "editar confirmado");
  await ler("document.getElementById('os-observacoes').value = 'Separar caixinha extra da equipe'; document.getElementById('btn-salvar-os').click(); true");
  await avaliar("window.__alertas.indexOf('Informações da ordem de serviço salvas.') !== -1");
  ws.close();

  const aberto = JSON.parse((await pedir("GET", "/api/orcamentos/881001", { cookie: sessao.cookie })).body);
  const pdf = JSON.parse((await pedir("GET", "/api/orcamentos/881002", { cookie: sessao.cookie })).body);
  const confirmado = JSON.parse((await pedir("GET", "/api/orcamentos/881003", { cookie: sessao.cookie })).body);
  assert(aberto.itens.some((item) => item.nome === "Doce extra de teste" && item.extra_pedido_admin === true), "complemento aberto");
  assert(aberto.itens.filter((item) => item.nome === "Doce extra de teste").length === 1, "falhas nao gravaram");
  assert(!pdf.gestao_contrato && pdf.status === "contrato_gerado", "pdf continua sem confirmacao");
  assert(pdf.itens.some((item) => item.nome === "Complemento do PDF"), "complemento do pdf");
  assert(confirmado.itens.length === 1 && confirmado.itens[0].nome === "Brigadeiro de Ninho" && confirmado.itens[0].quantidade === 50, "itens confirmados");
  assert(confirmado.ordem_servico_obs === "Separar caixinha extra da equipe", "os");
  assert(confirmado.valor_final === 125, "valor confirmado");

  const fim = new DatabaseSync(tmpDb, { readOnly: true });
  const congeladoFim = fim.prepare("SELECT valor_contratado_centavos, congelado_em FROM financeiro_contratos WHERE orcamento_id = 881003").get();
  const pagamentos = fim.prepare("SELECT COUNT(*) AS n FROM pagamentos").get().n;
  fim.close();
  assert(congeladoFim.valor_contratado_centavos === 12500 && congeladoFim.congelado_em === congelado.congelado_em, "congelamento mudou");
  assert(pagamentos === 0, "pagamento indevido");

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
    aberto: 200,
    pdf: 200,
    confirmado: 409,
    mensagens: [400, 401, 403, 404, 409],
    mobile: "390x844",
    ordemServico: 200,
    congelado: 12500,
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
