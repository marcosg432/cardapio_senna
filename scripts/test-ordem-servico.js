/**
 * Ordem de serviço, confirmação na tela de detalhes e pagamento.
 * Gravações ficam num SQLite temporário. O banco real não é aberto.
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

const PORT = 3307;
const SENHA = "senha-de-teste-local";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const root = path.join(__dirname, "..");
const tmpDb = path.join(os.tmpdir(), "candyli-ordem-" + Date.now() + ".sqlite");
const perfil = path.join(os.tmpdir(), "candyli-chrome-ordem-" + Date.now());
const exemplo = path.join(os.tmpdir(), "ordem-servico-exemplo-" + Date.now() + ".pdf");
const documentosDir = path.join(os.tmpdir(), "candyli-docs-" + Date.now());
let servidor;
let chrome;

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function hoje() {
  const data = new Date();
  const mes = String(data.getMonth() + 1).padStart(2, "0");
  const dia = String(data.getDate()).padStart(2, "0");
  return data.getFullYear() + "-" + mes + "-" + dia;
}

function pedir(method, urlPath, opcoes) {
  opcoes = opcoes || {};
  return new Promise((resolve, reject) => {
    const data = opcoes.body == null ? null : Buffer.isBuffer(opcoes.body) ? opcoes.body : Buffer.from(JSON.stringify(opcoes.body));
    const headers = Object.assign({}, opcoes.headers || {});
    if (data && !opcoes.binarioEnvio) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = data.length;
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
        body: opcoes.binario ? Buffer.concat(chunks) : Buffer.concat(chunks).toString("utf8")
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
        MIGRACOES_AUTORIZADAS: "004_documentos_versoes.sql",
        DOCUMENTOS_DIR: documentosDir
      }),
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

function textoPdf(buffer) {
  const cru = buffer.toString("latin1");
  let texto = cru;
  for (const marca of cru.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    try { texto += zlib.inflateSync(Buffer.from(marca[1], "latin1")).toString("latin1"); } catch (e) { /* sem compressão */ }
  }
  return texto;
}

function sessaoDe(resposta) {
  const bruto = resposta.headers["set-cookie"] || [];
  const lista = Array.isArray(bruto) ? bruto : [bruto];
  const cookie = lista.map((item) => String(item).split(";")[0]).find((item) => item.indexOf("cl_sessao=") === 0);
  const corpo = JSON.parse(resposta.body);
  return { cookie: cookie, csrf: corpo.csrfToken, token: decodeURIComponent(cookie.split("=").slice(1).join("=")) };
}

function chave() {
  return crypto.randomBytes(16).toString("hex");
}

async function main() {
  fs.rmSync(tmpDb, { force: true });
  await subir();
  const db = new DatabaseSync(tmpDb);
  db.prepare("INSERT INTO admin_usuarios (usuario, senha_hash) VALUES (?, ?)").run("admin", bcrypt.hashSync(SENHA, 12));
  const agora = new Date().toISOString();
  const orcamento = {
    id: 880501,
    cliente: "Ana Ficticia",
    nome_cliente: "Ana Ficticia",
    tipo_evento: "Casamento",
    evento_tipo: "Casamento",
    data_evento: hoje(),
    evento_data: hoje(),
    evento_local_festa: "Sitio das Flores",
    evento_horario_entrega: "16:00",
    evento_horario_festa: "19:00",
    convidados: 80,
    entrega_suporte: "Apenas entrega sem montagem",
    endereco: "rua que nao pode ir para a cozinha",
    observacoes_internas: "nota contratual interna",
    observacoes: "pedido visivel a cliente",
    valor_final: 500,
    total: 500,
    valor_original: 500,
    status: "contrato_gerado",
    itens: [{ nome: "Brigadeiro de pistache", quantidade: 2, unidade: "cento", preco: 150, preco_unitario: 150, subtotal: 300 }, { nome: "Piramide de chocolate", quantidade: 40, preco: 5, preco_unitario: 5, subtotal: 200 }]
  };
  db.prepare("INSERT INTO orcamentos (id, payload, created_at, updated_at) VALUES (?, ?, ?, ?)").run(
    orcamento.id, JSON.stringify(orcamento), agora, agora
  );
  db.close();

  const login = await pedir("POST", "/api/auth/login", { body: { senha: SENHA } });
  assert(login.status === 200, "login " + login.status);
  const sessao = sessaoDe(login);

  const semCsrf = await pedir("PATCH", "/api/orcamentos/880501/operacional", {
    cookie: sessao.cookie,
    body: { ordem_servico_obs: "nao pode" }
  });
  assert(semCsrf.status === 403, "csrf " + semCsrf.status);
  const semLogin = await pedir("POST", "/api/orcamentos/880501/confirmar-contrato", { body: {} });
  assert(semLogin.status === 401, "confirmacao sem sessao");

  const salvo = await pedir("PATCH", "/api/orcamentos/880501/operacional", {
    cookie: sessao.cookie,
    csrf: sessao.csrf,
    body: {
      evento_cerimonialista: "Marina Cerimonial",
      ordem_servico_suportes: "2 suportes de cristal e 1 bandeja dourada",
      ordem_servico_obs: "Reservar suportes de cristal.\nEnviar uma caixinha extra."
    }
  });
  assert(salvo.status === 200, "salvar os " + salvo.status);
  const recarregado = JSON.parse((await pedir("GET", "/api/orcamentos/880501", { cookie: sessao.cookie })).body);
  assert(recarregado.evento_cerimonialista === "Marina Cerimonial", "cerimonialista");
  assert(recarregado.ordem_servico_suportes.indexOf("bandeja dourada") !== -1, "suportes");
  assert(recarregado.ordem_servico_obs.indexOf("caixinha extra") !== -1, "observacao");
  assert(recarregado.observacoes_internas === "nota contratual interna", "interna preservada");
  assert(recarregado.valor_final === 500 && recarregado.itens.length === 2, "valores preservados");
  assert(!recarregado.gestao_contrato, "ainda nao confirmado");

  const financeiroAntes = await pedir("GET", "/api/financeiro/contratos/880501", { cookie: sessao.cookie });
  const antesJson = JSON.parse(financeiroAntes.body);
  assert(financeiroAntes.status === 200 && antesJson.situacao === "negociacao" && antesJson.congelado === false, "consulta antes da confirmacao");

  const confirmacao = await pedir("POST", "/api/orcamentos/880501/confirmar-contrato", {
    cookie: sessao.cookie,
    csrf: sessao.csrf,
    body: {}
  });
  assert(confirmacao.status === 200 && JSON.parse(confirmacao.body).repetida === false, "confirma");
  const repetida = await pedir("POST", "/api/orcamentos/880501/confirmar-contrato", {
    cookie: sessao.cookie,
    csrf: sessao.csrf,
    body: {}
  });
  assert(repetida.status === 200 && JSON.parse(repetida.body).repetida === true, "sem duplicar");
  const confirmado = JSON.parse((await pedir("GET", "/api/orcamentos/880501", { cookie: sessao.cookie })).body);
  assert(confirmado.gestao_contrato.status === "confirmado", "status");
  const congelado = confirmado.gestao_contrato.confirmado_em;

  const lista = JSON.parse((await pedir("GET", "/api/orcamentos", { cookie: sessao.cookie })).body);
  assert(lista.some((item) => item.id === 880501 && item.gestao_contrato.status === "confirmado"), "gestao ve o contrato");
  const producao = JSON.parse((await pedir("GET", "/api/producao/eventos", { cookie: sessao.cookie })).body);
  assert(producao.eventos.some((item) => item.id === 880501), "producao");
  const financeiro = JSON.parse((await pedir("GET", "/api/financeiro/contratos", { cookie: sessao.cookie })).body);
  assert(financeiro.contratos.some((item) => item.id === 880501), "financeiro lista");

  const pagamento = await pedir("POST", "/api/financeiro/contratos/880501/pagamentos", {
    cookie: sessao.cookie,
    csrf: sessao.csrf,
    body: { valor_centavos: 20000, pago_em: hoje(), forma: "pix", chave_idempotencia: chave() }
  });
  assert(pagamento.status === 201, "pagamento " + pagamento.status + " " + pagamento.body);
  const parcial = JSON.parse(pagamento.body);
  assert(parcial.recebido_centavos === 20000 && parcial.pendente_centavos > 0, "saldo parcial");
  const segundo = await pedir("POST", "/api/financeiro/contratos/880501/pagamentos", {
    cookie: sessao.cookie,
    csrf: sessao.csrf,
    body: { valor_centavos: 10000, pago_em: hoje(), forma: "pix", chave_idempotencia: chave() }
  });
  assert(segundo.status === 201 && JSON.parse(segundo.body).recebido_centavos === 30000, "segundo mes");
  const detalheFinanceiro = JSON.parse((await pedir("GET", "/api/financeiro/contratos/880501", { cookie: sessao.cookie })).body);
  assert(detalheFinanceiro.historico.length === 2, "historico");

  const pdf = await pedir("GET", "/api/producao/eventos/880501/pdf", { cookie: sessao.cookie, binario: true });
  assert(pdf.status === 200, "pdf " + pdf.status);
  const texto = textoPdf(pdf.body);
  fs.writeFileSync(exemplo, pdf.body);
  ["Ana Ficticia", "Sitio das Flores", "Casamento", "16:00", "19:00", "Marina Cerimonial", "bandeja dourada", "caixinha extra", "Brigadeiro de pistache", "Piramide de chocolate", "Produzido por", "Conferido por", "Ordem de Serviço"].forEach((trecho) => {
    assert(texto.indexOf(trecho) !== -1, "pdf sem " + trecho);
  });
  ["R$", "nota contratual interna", "rua que nao pode", "Unidade não informada", "pedido visivel a cliente"].forEach((proibido) => {
    assert(texto.indexOf(proibido) === -1, "pdf vazou " + proibido);
  });

  const editado = await pedir("PATCH", "/api/orcamentos/880501/operacional", {
    cookie: sessao.cookie,
    csrf: sessao.csrf,
    body: {
      evento_cerimonialista: "Marina Cerimonial",
      ordem_servico_suportes: "2 suportes de cristal e 1 bandeja dourada",
      ordem_servico_obs: "Separar os doces da madrinha."
    }
  });
  assert(editado.status === 200, "editar depois");
  const apos = JSON.parse((await pedir("GET", "/api/orcamentos/880501", { cookie: sessao.cookie })).body);
  assert(apos.gestao_contrato.confirmado_em === congelado && apos.valor_final === 500, "confirmacao intacta");
  const pdfNovo = textoPdf((await pedir("GET", "/api/producao/eventos/880501/pdf", { cookie: sessao.cookie, binario: true })).body);
  assert(pdfNovo.indexOf("madrinha") !== -1 && pdfNovo.indexOf("R$") === -1, "nova emissao");

  const documento = JSON.parse((await pedir("POST", "/api/documentos", {
    cookie: sessao.cookie,
    csrf: sessao.csrf,
    body: { tipo: "producao_evento", orcamentoId: 880501 }
  })).body);
  const rascunho = JSON.parse((await pedir("POST", "/api/documentos/" + documento.documento.id + "/rascunho", {
    cookie: sessao.cookie,
    csrf: sessao.csrf,
    body: { motivo: "Primeira ordem" }
  })).body);
  const emitida = JSON.parse((await pedir("POST", "/api/documentos/versoes/" + rascunho.versao.id + "/emitir", {
    cookie: sessao.cookie,
    csrf: sessao.csrf,
    body: { chave: chave(), revisao: rascunho.versao.revisao }
  })).body);
  assert(emitida.versao && emitida.versao.estado === "emitida", "versao emitida " + JSON.stringify(emitida));
  const oficial1 = await pedir("GET", "/api/documentos/versoes/" + emitida.versao.id + "/pdf", { cookie: sessao.cookie, binario: true });
  const hash1 = crypto.createHash("sha256").update(oficial1.body).digest("hex");
  await pedir("PATCH", "/api/orcamentos/880501/operacional", {
    cookie: sessao.cookie,
    csrf: sessao.csrf,
    body: { ordem_servico_obs: "Orientacao posterior da equipe." }
  });
  const segundoRascunho = JSON.parse((await pedir("POST", "/api/documentos/" + documento.documento.id + "/rascunho", {
    cookie: sessao.cookie,
    csrf: sessao.csrf,
    body: { motivo: "Observacao nova" }
  })).body);
  const emitida2 = JSON.parse((await pedir("POST", "/api/documentos/versoes/" + segundoRascunho.versao.id + "/emitir", {
    cookie: sessao.cookie,
    csrf: sessao.csrf,
    body: { chave: chave(), revisao: segundoRascunho.versao.revisao }
  })).body);
  const oficial1Depois = await pedir("GET", "/api/documentos/versoes/" + emitida.versao.id + "/pdf", { cookie: sessao.cookie, binario: true });
  const oficial2 = await pedir("GET", "/api/documentos/versoes/" + emitida2.versao.id + "/pdf", { cookie: sessao.cookie, binario: true });
  assert(crypto.createHash("sha256").update(oficial1Depois.body).digest("hex") === hash1, "versao anterior preservada");
  assert(textoPdf(oficial1.body).indexOf("Orientacao posterior") === -1, "primeira sem texto novo");
  assert(textoPdf(oficial2.body).indexOf("Orientacao posterior") !== -1, "segunda com texto novo");

  const publico = await pedir("POST", "/api/orcamentos", {
    body: {
      id: 880502,
      nome_cliente: "Publico",
      cliente: "Publico",
      itens: [{ nome: "Brigadeiro", quantidade: 50, preco_unitario: 2, preco: 2, subtotal: 100 }],
      ordem_servico_obs: "nao pode entrar pelo cardapio",
      gestao_contrato: { status: "confirmado", confirmado_em: agora }
    }
  });
  assert(publico.status === 201, "publico " + publico.status);
  const gravadoPublico = JSON.parse((await pedir("GET", "/api/orcamentos/880502", { cookie: sessao.cookie })).body);
  assert(!gravadoPublico.ordem_servico_obs && !gravadoPublico.gestao_contrato, "cardapio nao grava a ordem");

  const pagina = await pedir("GET", "/admin/orcamento.html", { cookie: sessao.cookie });
  const pedido = await pedir("GET", "/js/pedido.js");
  assert(pagina.body.indexOf("btn-whatsapp-orc") === -1 && pagina.body.indexOf("Confirmar contrato") !== -1, "tela");
  assert(pedido.body.indexOf("wa.me") !== -1 || pedido.body.indexOf("WhatsApp") !== -1, "cardapio publico");

  if (fs.existsSync(CHROME)) {
    chrome = spawn(CHROME, [
      "--headless=new", "--disable-gpu", "--no-first-run", "--window-size=390,844",
      "--remote-debugging-port=9466", "--user-data-dir=" + perfil, "about:blank"
    ], { stdio: "ignore" });
    const inicio = Date.now();
    await new Promise((resolve, reject) => {
      (function tentar() {
        http.get("http://127.0.0.1:9466/json/version", (res) => { res.resume(); resolve(); }).on("error", () => {
          if (Date.now() - inicio > 8000) reject(new Error("chrome"));
          else setTimeout(tentar, 150);
        });
      })();
    });
    const abas = await new Promise((resolve, reject) => {
      http.get("http://127.0.0.1:9466/json/list", (res) => {
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
      const limite = Date.now() + 8000;
      let ultimo = null;
      while (Date.now() < limite) {
        const saida = await enviar("Runtime.evaluate", { expression: expressao, returnByValue: true });
        ultimo = saida.result && saida.result.value;
        if (ultimo === true) return;
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
      throw new Error("tela " + expressao + " " + JSON.stringify(ultimo));
    }
    await enviar("Network.enable");
    await enviar("Page.enable");
    await enviar("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await enviar("Network.setCookie", { name: "cl_sessao", value: sessao.token, url: "http://127.0.0.1:" + PORT + "/" });
    await enviar("Page.navigate", { url: "http://127.0.0.1:" + PORT + "/admin/orcamento.html?id=880501" });
    await avaliar("document.getElementById('detalhe-status-contrato') && document.getElementById('detalhe-status-contrato').textContent === 'Contrato confirmado' && !document.getElementById('btn-whatsapp-orc') && document.getElementById('os-observacoes').value.indexOf('Orientacao posterior') !== -1 && document.getElementById('btn-registrar-pagamento').href.indexOf('contrato=880501') !== -1 && document.getElementById('btn-registrar-pagamento').getBoundingClientRect().right <= window.innerWidth + 1");
    await enviar("Page.navigate", { url: "http://127.0.0.1:" + PORT + "/admin/gestao/financeiro.html?contrato=880501#pagamento" });
    await avaliar("document.getElementById('financeiro-form') && document.getElementById('financeiro-form').hidden === false && document.getElementById('financeiro-detalhe-nome').textContent.indexOf('Ana') !== -1");
    await enviar("Page.navigate", { url: "http://127.0.0.1:" + PORT + "/admin/gestao/agenda.html" });
    await avaliar("document.body.innerText.indexOf('Ana Ficticia') !== -1");
    ws.close();
  }

  const outra = sessaoDe(await pedir("POST", "/api/auth/login", { body: { senha: SENHA } }));
  const vista = JSON.parse((await pedir("GET", "/api/orcamentos/880501", { cookie: outra.cookie })).body);
  assert(vista.ordem_servico_obs.indexOf("Orientacao posterior") !== -1 && vista.gestao_contrato.status === "confirmado", "outra sessao");

  console.log(JSON.stringify({ ok: true, exemplo: exemplo, pendente: parcial.pendente_centavos }));
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
    fs.rmSync(documentosDir, { recursive: true, force: true });
  });
