/**
 * Demonstrativo financeiro em PDF. Gravações ficam no SQLite temporário.
 */
const { spawn } = require("child_process");
const zlib = require("zlib");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const bcrypt = require("bcryptjs");
const { DatabaseSync } = require("node:sqlite");

const PORT = 3243;
const SENHA = "senha-de-teste-local";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const root = path.join(__dirname, "..");
const dbReal = path.join(root, "database", "database.sqlite");
const tmpDb = path.join(os.tmpdir(), "candyli-demonstrativo-" + Date.now() + ".sqlite");
const perfil = path.join(os.tmpdir(), "candyli-chrome-demonstrativo-" + Date.now());
const preview = path.join(os.tmpdir(), "candyli-pdf-preview-" + Date.now());
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
  const contratos = contar("financeiro_contratos");
  const pagamentos = contar("pagamentos");
  db.close();
  const texto = rows.map((row) => row.id + ":" + row.payload).join("|");
  return {
    ic: ic,
    n: rows.length,
    hash: crypto.createHash("sha256").update(texto).digest("hex"),
    contratos: contratos,
    pagamentos: pagamentos
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
    const req = http.request({ hostname: "127.0.0.1", port: PORT, path: urlPath, method: method, headers: headers }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const buf = Buffer.concat(chunks);
        resolve({ status: res.statusCode, body: opcoes.binario ? buf : buf.toString("utf8"), headers: res.headers });
      });
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

function pagamento(valor, forma, chave, data) {
  return { valor_centavos: valor, pago_em: data, forma: forma, chave_idempotencia: chave };
}
function textoPdf(buffer) {
  const cru = buffer.toString("latin1");
  let texto = cru;
  const marcas = cru.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g);
  for (const marca of marcas) {
    try { texto += zlib.inflateSync(Buffer.from(marca[1], "latin1")).toString("latin1"); } catch (e) { /* fluxo sem compressão */ }
  }
  return texto;
}
function dataBr(iso) {
  return iso.slice(8, 10) + "/" + iso.slice(5, 7) + "/" + iso.slice(0, 4);
}

async function main() {
  const antes = assinaturaReal();
  assert(antes.ic === "ok" && antes.n >= 1, "banco real");
  fs.rmSync(tmpDb, { force: true });
  fs.mkdirSync(preview, { recursive: true });
  await subir();
  const db = new DatabaseSync(tmpDb);
  db.prepare("INSERT INTO admin_usuarios (usuario, senha_hash) VALUES (?, ?)").run("admin", bcrypt.hashSync(SENHA, 12));
  const hoje = isoLocal(new Date());
  function gravar(orcamento) {
    db.prepare("INSERT INTO orcamentos (id, payload, created_at, updated_at) VALUES (?, ?, ?, ?)").run(
      orcamento.id, JSON.stringify(orcamento), "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z"
    );
  }
  const original = {
    id: 940001,
    cliente: "Cliente Demonstrativo",
    nome_cliente: "Cliente Demonstrativo",
    tipo_evento: "Casamento",
    evento_tipo: "Casamento",
    data_evento: hoje,
    evento_data: hoje,
    valor_original: 100,
    valor_final: 100,
    total: 100,
    entrada: 40,
    itens: [{ nome: "Doce teste", quantidade: 50, preco_unitario: 2, preco: 2, subtotal: 100 }],
    contrato: { status: "emitido", valor_final: 100 },
    contrato_pdf: { tipo: "contrato", gerado_em: "2026-01-02T00:00:00.000Z" },
    cpf: "cpf-teste-demonstrativo",
    observacoes: "nota interna",
    cliente_endereco_linha: "rua secreta"
  };
  gravar(original);
  gravar({
    id: 940002,
    cliente: "Cliente Quitado",
    nome_cliente: "Cliente Quitado",
    tipo_evento: "Aniversário",
    data_evento: hoje,
    evento_data: hoje,
    valor_original: 80,
    valor_final: 80,
    total: 80,
    entrada: 10,
    itens: [],
    contrato: { status: "emitido", valor_final: 80 },
    contrato_pdf: { tipo: "contrato", gerado_em: "2026-01-02T00:00:00.000Z" }
  });
  const longo = {
    id: 940003,
    cliente: "Cliente Longo",
    nome_cliente: "Cliente Longo",
    tipo_evento: "Corporativo",
    data_evento: hoje,
    evento_data: hoje,
    valor_original: 100,
    valor_final: 100,
    total: 100,
    itens: [{ nome: "Doce longo", quantidade: 50, preco_unitario: 2, preco: 2, subtotal: 100 }],
    contrato: { status: "emitido", valor_final: 100 },
    contrato_pdf: { tipo: "contrato", gerado_em: "2026-01-02T00:00:00.000Z" }
  };
  gravar(longo);
  gravar({
    id: 940004,
    cliente: "Cliente Antecipado",
    nome_cliente: "Cliente Antecipado",
    tipo_evento: "Debutante",
    data_evento: hoje,
    evento_data: hoje,
    valor_original: 200,
    valor_final: 200,
    total: 200,
    entrada: 25,
    itens: [{ nome: "Doce antecipado", quantidade: 40, preco_unitario: 5, preco: 5, subtotal: 200 }],
    observacoes: "nota interna antecipada",
    cpf: "cpf-antecipado",
    cliente_endereco_linha: "rua antecipada"
  });
  db.close();

  assert((await pedir("GET", "/api/financeiro/contratos/940001/demonstrativo")).status === 401, "pdf sem sessão");
  const login = await pedir("POST", "/api/auth/login", { body: { senha: SENHA } });
  assert(login.status === 200, "login");
  const cookie = String(login.headers["set-cookie"]).split(";")[0];
  const csrf = JSON.parse(login.body).csrfToken;
  const token = decodeURIComponent(cookie.split("=").slice(1).join("="));
  const sessao = { cookie: cookie, csrf: csrf };
  assert((await pedir("POST", "/api/orcamentos/940001/confirmar-contrato", Object.assign({ body: {} }, sessao))).status === 200, "confirma 940001");
  assert((await pedir("POST", "/api/orcamentos/940002/confirmar-contrato", Object.assign({ body: {} }, sessao))).status === 200, "confirma 940002");
  assert((await pedir("POST", "/api/orcamentos/940003/confirmar-contrato", Object.assign({ body: {} }, sessao))).status === 200, "confirma 940003");

  const detalhe = JSON.parse((await pedir("GET", "/api/financeiro/contratos/940001", { cookie: cookie })).body);
  assert(detalhe.tipo_evento === "Casamento" && detalhe.entrada_prevista_centavos === 4000 && detalhe.historico.length === 0, "detalhe");
  const payloadAntes = JSON.parse((await pedir("GET", "/api/orcamentos/940001", sessao)).body);

  chrome = spawn(CHROME, [
    "--headless=new", "--disable-gpu", "--no-first-run", "--disable-extensions",
    "--remote-debugging-port=9368", "--user-data-dir=" + perfil, "about:blank"
  ], { stdio: "ignore" });
  await esperarHttp("http://127.0.0.1:9368/json/version");
  const alvos = await new Promise((resolve, reject) => {
    http.get("http://127.0.0.1:9368/json/list", (res) => {
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
    const inicio = Date.now();
    let ultimo = null;
    while (Date.now() - inicio < 8000) {
      const saida = await enviar("Runtime.evaluate", { expression: expressao, returnByValue: true });
      ultimo = saida.result && saida.result.value;
      if (ultimo) return ultimo;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    throw new Error("tela " + expressao + " " + JSON.stringify(ultimo));
  }
  async function baixarPdf(id, consulta) {
    const resposta = await pedir(
      "GET",
      "/api/financeiro/contratos/" + id + "/demonstrativo" + (consulta || ""),
      Object.assign({ binario: true }, sessao)
    );
    assert(resposta.status === 200, "status pdf " + id + " " + resposta.status + " " + (Buffer.isBuffer(resposta.body) ? resposta.body.slice(0, 180).toString("utf8") : resposta.body));
    assert(String(resposta.headers["content-type"] || "").indexOf("application/pdf") === 0, "tipo");
    assert(String(resposta.headers["content-disposition"] || "").indexOf('filename="demonstrativo-financeiro-' + id + '.pdf"') !== -1, "arquivo");
    assert(String(resposta.headers["cache-control"] || "").indexOf("no-store") !== -1, "cache");
    return resposta.body;
  }

  const manipulacao = await baixarPdf(940001, "?valor_contratado_centavos=1&recebido_centavos=999999&pendente_centavos=0");
  const pdfVazio = textoPdf(manipulacao);
  fs.writeFileSync(path.join(preview, "vazio.pdf"), manipulacao);
  assert(pdfVazio.indexOf("Candy Li Doces Finos") !== -1, "empresa");
  assert(pdfVazio.indexOf("Demonstrativo Financeiro") !== -1, "titulo");
  assert(pdfVazio.indexOf("Contrato 940001") !== -1, "identificador");
  assert(pdfVazio.indexOf("Cliente Demonstrativo") !== -1, "cliente");
  assert(pdfVazio.indexOf("Casamento") !== -1, "evento");
  assert(pdfVazio.indexOf("Emissão " + dataBr(hoje)) !== -1, "emissao");
  assert(pdfVazio.indexOf("Valor contratado") !== -1 && pdfVazio.indexOf("provis") === -1, "oficial sem aviso provisorio");
  assert(pdfVazio.indexOf("R$ 100,00") !== -1 && pdfVazio.indexOf("R$ 0,00") !== -1, "valores oficiais");
  assert(pdfVazio.indexOf("R$ 0,01") === -1 && pdfVazio.indexOf("999.999") === -1, "valor manipulado");
  assert(pdfVazio.indexOf("Pendente") !== -1, "situacao pendente");
  assert(pdfVazio.indexOf("Nenhum pagamento registrado") !== -1, "sem pagamentos");
  assert(pdfVazio.indexOf("pagamentos registrados no sistema") !== -1, "rodape");
  ["nota interna", "cpf-teste-demonstrativo", "rua secreta", "Entrada", "R$ 40,00"].forEach(function (proibido) {
    assert(pdfVazio.indexOf(proibido) === -1, "dado fora do pdf " + proibido);
  });
  const falso = await pedir("POST", "/api/financeiro/contratos/940001/demonstrativo", Object.assign({
    body: { valor_contratado_centavos: 1, recebido_centavos: 999999, pendente_centavos: 0, historico: [{ valor_centavos: 1 }] }
  }, sessao));
  assert(falso.status === 405, "post manipulado " + falso.status);
  const detalheDepois = JSON.parse((await pedir("GET", "/api/financeiro/contratos/940001", { cookie: cookie })).body);
  assert(detalheDepois.valor_contratado_centavos === 10000 && detalheDepois.recebido_centavos === 0 && detalheDepois.historico.length === 0, "banco apos pdf");

  await enviar("Network.enable");
  await enviar("Page.enable");
  await enviar("Network.setCookie", { name: "cl_sessao", value: token, url: "http://127.0.0.1:" + PORT + "/" });
  await enviar("Page.navigate", { url: "http://127.0.0.1:" + PORT + "/admin/gestao/financeiro.html" });
  await avaliar("[...document.querySelectorAll('#financeiro-corpo tr')].some((tr) => tr.textContent.indexOf('Cliente Demonstrativo') !== -1)");
  await avaliar(`(() => {
    const botao = [...document.querySelectorAll("#financeiro-corpo button")].find((el) => el.closest("tr").textContent.indexOf("Cliente Demonstrativo") !== -1);
    botao.click();
    return true;
  })()`);
  await avaliar("document.getElementById('financeiro-demonstrativo').hidden === false");
  await avaliar("typeof window.jspdf === 'undefined' && typeof window.gerarDemonstrativoFinanceiroPDF === 'undefined'");
  await avaliar(`(() => {
    document.getElementById("financeiro-demonstrativo").click();
    return true;
  })()`);
  const mensagemBotao = await avaliar(`(() => {
    const msg = document.getElementById("financeiro-mensagem");
    if (msg && !msg.hidden && msg.textContent) return msg.textContent;
    return "";
  })()`);
  assert(mensagemBotao === "Demonstrativo gerado.", "botao " + mensagemBotao);
  const depoisPdf = JSON.parse((await pedir("GET", "/api/orcamentos/940001", sessao)).body);
  assert(JSON.stringify(depoisPdf.contrato) === JSON.stringify(payloadAntes.contrato), "contrato mudou");
  assert(JSON.stringify(depoisPdf.contrato_pdf) === JSON.stringify(payloadAntes.contrato_pdf), "contrato_pdf mudou");
  assert(depoisPdf.gestao_contrato.status === "confirmado", "confirmacao caiu");

  assert((await pedir("POST", "/api/financeiro/contratos/940001/pagamentos", Object.assign({ body: pagamento(2000, "pix", "chave-demo-parcial-20", "2026-10-20") }, sessao))).status === 201, "pix");
  assert((await pedir("POST", "/api/financeiro/contratos/940001/pagamentos", Object.assign({ body: pagamento(1500, "dinheiro", "chave-demo-parcial-01", "2026-10-01") }, sessao))).status === 201, "dinheiro");
  const parcial = await baixarPdf(940001);
  fs.writeFileSync(path.join(preview, "parcial.pdf"), parcial);
  const pdfParcial = textoPdf(parcial);
  assert(pdfParcial.indexOf("Parcialmente pago") !== -1, "situacao parcial");
  assert(pdfParcial.indexOf("R$ 35,00") !== -1 && pdfParcial.indexOf("R$ 65,00") !== -1, "saldos parciais");
  assert(pdfParcial.indexOf("01/10/2026") < pdfParcial.indexOf("20/10/2026"), "ordem cronologica");
  assert(pdfParcial.indexOf("PIX") !== -1 && pdfParcial.indexOf("Dinheiro") !== -1, "formas");
  assert(pdfParcial.indexOf("R$ 40,00") === -1, "entrada no parcial");

  assert((await pedir("POST", "/api/financeiro/contratos/940002/pagamentos", Object.assign({ body: pagamento(8000, "transferencia", "chave-demo-quita-0001", hoje) }, sessao))).status === 201, "quitação");
  const quitado = await baixarPdf(940002);
  fs.writeFileSync(path.join(preview, "quitado.pdf"), quitado);
  const pdfQuitado = textoPdf(quitado);
  assert(pdfQuitado.indexOf("Quitado") !== -1, "situacao quitado");
  assert(pdfQuitado.indexOf("R$ 80,00") !== -1 && pdfQuitado.indexOf("R$ 0,00") !== -1, "totais quitados");
  assert(pdfQuitado.indexOf("Transfer") !== -1, "forma quitacao");
  assert(pdfQuitado.indexOf("Anivers") !== -1, "tipo aniversario");

  const datas = [];
  for (let dia = 1; dia <= 31; dia++) datas.push("2026-01-" + String(dia).padStart(2, "0"));
  for (let dia = 1; dia <= 5; dia++) datas.push("2026-02-" + String(dia).padStart(2, "0"));
  for (let i = datas.length - 1; i >= 0; i--) {
    const resposta = await pedir("POST", "/api/financeiro/contratos/940003/pagamentos", Object.assign({
      body: pagamento(100, i % 2 === 0 ? "pix" : "boleto", "chave-demo-longo-" + String(i).padStart(4, "0"), datas[i])
    }, sessao));
    assert(resposta.status === 201, "pagamento longo " + i + " " + resposta.status);
  }
  const varias = await baixarPdf(940003);
  fs.writeFileSync(path.join(preview, "varias.pdf"), varias);
  const pdfVarias = textoPdf(varias);
  assert(pdfVarias.indexOf("Página 2 de 2") !== -1, "paginas");
  assert(pdfVarias.indexOf("01/01/2026") < pdfVarias.indexOf("05/02/2026"), "ordem do historico longo");
  assert(pdfVarias.indexOf("Página 1 de 2") !== -1, "numeracao");

  await enviar("Page.navigate", { url: "http://127.0.0.1:" + PORT + "/admin/gestao/index.html" });
  await avaliar("document.getElementById('indicador-orcamentos').textContent === '4'");
  await enviar("Page.navigate", { url: "http://127.0.0.1:" + PORT + "/admin/gestao/agenda.html" });
  await avaliar("!!document.getElementById('agenda-grade') && document.querySelectorAll('.gestao-dia').length >= 28");
  const home = await pedir("GET", "/");
  const contratoPdf = await pedir("GET", "/js/contrato-pdf.js");
  const orcamentoPdf = await pedir("GET", "/js/orcamento-pdf.js");
  const geradorPublico = await pedir("GET", "/js/gestao/demonstrativo-pdf.js");
  const geradorInterno = await pedir("GET", "/server/demonstrativoPdf.js");
  assert(home.status === 200 && home.body.indexOf("Candy Li") !== -1, "cardapio");
  assert(contratoPdf.status === 200 && contratoPdf.body.indexOf("gerarContratoPDF") !== -1, "gerador de contrato");
  assert(orcamentoPdf.status === 200 && orcamentoPdf.body.indexOf("function") !== -1, "gerador de orcamento");
  assert(geradorPublico.status === 404 && geradorInterno.status === 404, "pdf fora do publico");

  const orcamentoAntes = JSON.parse((await pedir("GET", "/api/orcamentos/940004", sessao)).body);
  assert(!orcamentoAntes.gestao_contrato, "antecipado ja confirmado");
  const primeiro = await pedir("POST", "/api/financeiro/contratos/940004/pagamentos", Object.assign({
    body: pagamento(4000, "pix", "chave-antecipado-parcial", "2026-10-01")
  }, sessao));
  assert(primeiro.status === 201, "pagamento antecipado " + primeiro.body);
  const idAntecipado = JSON.parse(primeiro.body).pagamento.id;
  const parcialAntecipado = await baixarPdf(940004);
  fs.writeFileSync(path.join(preview, "antecipado-parcial.pdf"), parcialAntecipado);
  const textoParcial = textoPdf(parcialAntecipado);
  assert(textoParcial.indexOf("Cliente Antecipado") !== -1, "cliente antecipado");
  assert(textoParcial.indexOf("Orçamento 940004") !== -1, "orcamento antecipado");
  assert(textoParcial.indexOf("Contrato 940004") === -1, "nao chama de contrato");
  assert(textoParcial.indexOf("Debutante") !== -1, "evento antecipado");
  assert(textoParcial.indexOf("Valor atual do pedido") !== -1, "valor atual");
  assert(textoParcial.indexOf("Valor contratado") === -1, "sem rotulo oficial");
  assert(textoParcial.indexOf("provis") !== -1 && textoParcial.indexOf("valores sujeitos a altera") !== -1, "aviso provisorio");
  assert(textoParcial.indexOf("Emissão " + dataBr(hoje)) !== -1, "emissao antecipada");
  assert(textoParcial.indexOf("R$ 200,00") !== -1 && textoParcial.indexOf("R$ 40,00") !== -1 && textoParcial.indexOf("R$ 160,00") !== -1, "parcial antecipado");
  assert(textoParcial.indexOf("Parcialmente pago") !== -1 && textoParcial.indexOf("PIX") !== -1, "situacao antecipada");
  assert(textoParcial.indexOf("01/10/2026") !== -1, "data do pagamento");
  ["nota interna antecipada", "cpf-antecipado", "rua antecipada", "Entrada", "R$ 25,00"].forEach(function (proibido) {
    assert(textoParcial.indexOf(proibido) === -1, "dado fora do provisorio " + proibido);
  });

  const correcao = await pedir("POST", "/api/financeiro/contratos/940004/pagamentos/" + idAntecipado + "/corrigir", Object.assign({
    body: { valor_centavos: 1500, pago_em: "2026-10-01", forma: "pix", motivo: "Valor lançado a mais", confirmacao: true }
  }, sessao));
  assert(correcao.status === 200, "correcao antecipada " + correcao.body);
  const corrigido = await baixarPdf(940004);
  const textoCorrigido = textoPdf(corrigido);
  assert(textoCorrigido.indexOf("R$ 15,00") !== -1 && textoCorrigido.indexOf("R$ 185,00") !== -1, "valores corrigidos");
  assert(textoCorrigido.indexOf("R$ 40,00") === -1 && textoCorrigido.indexOf("Valor lançado a mais") === -1, "correcao nao vaza");

  assert((await pedir("POST", "/api/financeiro/contratos/940004/pagamentos", Object.assign({
    body: pagamento(22000, "transferencia", "chave-antecipado-credito", "2026-10-20")
  }, sessao))).status === 201, "pagamento acima do pedido");
  const credito = await baixarPdf(940004);
  fs.writeFileSync(path.join(preview, "antecipado-credito.pdf"), credito);
  const textoCredito = textoPdf(credito);
  assert(textoCredito.indexOf("Crédito a regularizar") !== -1 || textoCredito.indexOf("regularizar") !== -1, "credito");
  assert(textoCredito.indexOf("R$ 235,00") !== -1 && textoCredito.indexOf("R$ 35,00") !== -1, "totais do credito");
  assert(textoCredito.indexOf("R$ 220,00") !== -1 && textoCredito.indexOf("R$ 15,00") !== -1, "historico corrigido");
  assert(textoCredito.indexOf("01/10/2026") < textoCredito.indexOf("20/10/2026"), "ordem do credito");
  assert(textoCredito.indexOf("Transfer") !== -1, "forma do credito");

  const orcamentoDepois = JSON.parse((await pedir("GET", "/api/orcamentos/940004", sessao)).body);
  const detalheDepoisPdf = JSON.parse((await pedir("GET", "/api/financeiro/contratos/940004", { cookie: cookie })).body);
  assert(!orcamentoDepois.gestao_contrato && detalheDepoisPdf.situacao === "antecipado" && detalheDepoisPdf.congelado === false, "pdf nao confirmou");
  assert(detalheDepoisPdf.valor_contratado_centavos === 20000 && detalheDepoisPdf.recebido_centavos === 23500, "pdf nao alterou saldo");
  assert(detalheDepoisPdf.historico.length === 2 && detalheDepoisPdf.entrada_prevista_centavos === 2500, "entrada continua prevista");
  assert(JSON.stringify(orcamentoDepois.itens) === JSON.stringify(orcamentoAntes.itens), "pedido mudou");
  const documentos = new DatabaseSync(tmpDb, { readOnly: true });
  const oficiais = Number(documentos.prepare("SELECT COUNT(*) AS n FROM documentos WHERE tipo = 'demonstrativo'").get().n);
  documentos.close();
  assert(oficiais === 0, "provisorio virou documento oficial");

  async function verBotao(largura, altura, mobile) {
    await enviar("Emulation.setDeviceMetricsOverride", {
      width: largura,
      height: altura,
      deviceScaleFactor: 1,
      mobile: mobile
    });
    await enviar("Page.navigate", { url: "http://127.0.0.1:" + PORT + "/admin/gestao/financeiro.html" });
    await avaliar("[...document.querySelectorAll('#financeiro-antecipado-corpo tr')].some((tr) => tr.textContent.indexOf('Cliente Antecipado') !== -1)");
    await avaliar(`(() => {
      const botao = [...document.querySelectorAll("#financeiro-antecipado-corpo button")].find((el) => el.closest("tr").textContent.indexOf("Cliente Antecipado") !== -1);
      botao.click();
      return true;
    })()`);
    const medida = await avaliar(`(() => {
      const botao = document.getElementById("financeiro-demonstrativo");
      const aviso = document.getElementById("financeiro-provisorio");
      if (!botao || botao.hidden || !aviso || aviso.hidden) return "";
      const caixa = botao.getBoundingClientRect();
      if (caixa.width < 40 || caixa.height < 24) return "";
      if (caixa.right > window.innerWidth + 1 || caixa.left < -1) return "";
      if (document.documentElement.scrollWidth > document.documentElement.clientWidth + 1) return "";
      return larguraMarcador + ":" + Math.round(caixa.width) + "x" + Math.round(caixa.height);
    })()`.replace("larguraMarcador", String(largura)));
    assert(String(medida).indexOf(String(largura) + ":") === 0, "botao " + largura + " " + medida);
  }
  await verBotao(1280, 800, false);
  await verBotao(390, 844, true);
  await avaliar(`(() => {
    document.getElementById("financeiro-demonstrativo").click();
    return true;
  })()`);
  const mensagemProvisoria = await avaliar(`(() => {
    const msg = document.getElementById("financeiro-mensagem");
    if (msg && !msg.hidden && msg.textContent) return msg.textContent;
    return "";
  })()`);
  assert(mensagemProvisoria === "Demonstrativo provisório gerado.", "botao provisorio " + mensagemProvisoria);
  await enviar("Emulation.clearDeviceMetricsOverride");

  const depois = assinaturaReal();
  assert(depois.hash === antes.hash && depois.contratos === antes.contratos && depois.pagamentos === antes.pagamentos && depois.ic === "ok", "dados reais mudaram");
  console.log(JSON.stringify({ ok: true, preview: preview }));
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
