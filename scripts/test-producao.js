/**
 * Produção da cozinha. Gravações ficam no SQLite temporário.
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

const PORT = 3257;
const SENHA = "senha-de-teste-local";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const root = path.join(__dirname, "..");
const dbReal = path.join(root, "database", "database.sqlite");
const tmpDb = path.join(os.tmpdir(), "candyli-producao-" + Date.now() + ".sqlite");
const perfil = path.join(os.tmpdir(), "candyli-chrome-producao-" + Date.now());
const preview = path.join(os.tmpdir(), "candyli-producao-preview-" + Date.now());
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
  const pagamentos = db.prepare("SELECT id, orcamento_id, valor_centavos, pago_em, forma, criado_em FROM pagamentos ORDER BY id").all();
  const migracoes = db.prepare("SELECT name FROM schema_migrations ORDER BY name").all().map((row) => row.name);
  const confirmados = rows.filter((row) => {
    const payload = JSON.parse(row.payload);
    return payload.gestao_contrato && payload.gestao_contrato.status === "confirmado";
  }).map((row) => Number(row.id));
  db.close();
  return {
    ic: ic,
    n: rows.length,
    hash: crypto.createHash("sha256").update(rows.map((row) => row.id + ":" + row.payload).join("|")).digest("hex"),
    pagamentos: pagamentos,
    migracoes: migracoes,
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
    const timer = setTimeout(() => reject(new Error("servidor nao subiu " + saida)), 8000);
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
      http.get(url, (res) => { res.resume(); resolve(); }).on("error", () => {
        if (Date.now() - inicio > 8000) reject(new Error("chrome sem depuração"));
        else setTimeout(tentar, 150);
      });
    }
    tentar();
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

function item(nome, quantidade, extra) {
  return Object.assign({
    nome: nome,
    quantidade: quantidade,
    preco: 9,
    preco_unitario: 9,
    subtotal: 9,
    qtd_min: 999
  }, extra || {});
}

async function main() {
  const antes = assinaturaReal();
  assert(antes.ic === "ok" && antes.n >= 4, "banco real");
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
  const longo = [];
  for (let i = 1; i <= 48; i++) longo.push(item("Doce de linha " + String(i).padStart(2, "0"), 1, { unidade: "unidade" }));
  gravar({
    id: 950001,
    cliente: "Cliente Producao",
    nome_cliente: "Cliente Producao",
    tipo_evento: "Casamento",
    evento_tipo: "Casamento",
    data_evento: hoje,
    evento_data: hoje,
    convidados: 80,
    evento_horario_entrega: "14",
    evento_horario_festa: "18:30",
    entrega_suporte: "Apenas retirada dos doces sem entrega",
    cpf: "cpf-nao-mostrar",
    endereco: "rua secreta",
    telefone: "11999999999",
    email: "secreto@exemplo.com",
    observacoes: "ligar no telefone secreto",
    observacoes_internas: "nota interna",
    degustacao_obs: "degustacao secreta",
    valor_final: 999,
    total: 999,
    entrada: 100,
    itens: [
      item("Brigadeiro gourmet", 100, { unidade: "unidade" }),
      item("brigadeiro gourmet", 20, { unidade: "unidade" }),
      item("Brigadeiro de Doce de Leite com Nozes", 2, { unidade: "cento" }),
      item("Pacote festa", 1, { unidade: "pacote" }),
      item("Bem-casado", 50),
      item("Bem-casado extra", 10, { extra_pedido_admin: true }),
      item("Doce com mínimo", 3),
      item("Doce quebrado", "cem", { unidade: "unidade" }),
      item("Doce ambíguo", "1.500", { unidade: "unidade" }),
      item("Brigadeiro Tradicional", 30, { unidade: "unidade" }),
      item("  Brigadeiro   de festa  ", 4, { unidade: "pacote" })
    ],
    contrato: { status: "emitido", valor_final: 999 },
    contrato_pdf: { tipo: "contrato", gerado_em: "2026-01-02T00:00:00.000Z" }
  });
  gravar({
    id: 950002,
    cliente: "Cliente Aberto",
    nome_cliente: "Cliente Aberto",
    tipo_evento: "Batizado",
    data_evento: hoje,
    evento_data: hoje,
    status: "novo_orcamento",
    valor_final: 10,
    itens: [item("Fora da produção", 5, { unidade: "unidade" })],
    contrato: null,
    contrato_pdf: null
  });
  gravar({
    id: 950003,
    cliente: "Cliente Pdf",
    nome_cliente: "Cliente Pdf",
    tipo_evento: "Formatura",
    data_evento: hoje,
    evento_data: hoje,
    status: "contrato_gerado",
    valor_final: 20,
    itens: [item("Só PDF", 7, { unidade: "cento" })],
    contrato: { status: "emitido", valor_final: 20 },
    contrato_pdf: { tipo: "contrato", gerado_em: "2026-01-02T00:00:00.000Z" }
  });
  gravar({
    id: 950004,
    cliente: "Cliente Mesmo Dia",
    nome_cliente: "Cliente Mesmo Dia",
    tipo_evento: "Aniversário",
    data_evento: hoje,
    evento_data: hoje,
    convidados: 40,
    evento_horario_entrega: "09:00",
    entrega_suporte: "Apenas entrega sem montagem",
    valor_final: 30,
    itens: [
      item("brigadeiro tradicional", 10, { unidade: "unidade" }),
      item("Brigadeiro gourmet", 1, { unidade: "cento" })
    ],
    contrato: { status: "emitido", valor_final: 30 },
    contrato_pdf: { tipo: "contrato", gerado_em: "2026-01-02T00:00:00.000Z" }
  });
  gravar({
    id: 950006,
    cliente: "Cliente Longo",
    nome_cliente: "Cliente Longo",
    tipo_evento: "Corporativo",
    data_evento: "2026-12-02",
    evento_data: "2026-12-02",
    convidados: 12,
    valor_final: 40,
    itens: longo,
    contrato: { status: "emitido", valor_final: 40 },
    contrato_pdf: { tipo: "contrato", gerado_em: "2026-01-02T00:00:00.000Z" }
  });
  db.close();

  assert((await pedir("GET", "/api/producao/eventos")).status === 401, "sem sessão");
  const login = await pedir("POST", "/api/auth/login", { body: { senha: SENHA } });
  assert(login.status === 200, "login");
  const cookie = String(login.headers["set-cookie"]).split(";")[0];
  const csrf = JSON.parse(login.body).csrfToken;
  const token = decodeURIComponent(cookie.split("=").slice(1).join("="));
  const sessao = { cookie: cookie, csrf: csrf };
  for (const id of [950001, 950004, 950006]) {
    assert((await pedir("POST", "/api/orcamentos/" + id + "/confirmar-contrato", Object.assign({ body: {} }, sessao))).status === 200, "confirma " + id);
  }
  const payloadAntes = (await pedir("GET", "/api/orcamentos/950001", sessao)).body;
  const lista = JSON.parse((await pedir("GET", "/api/producao/eventos", sessao)).body);
  const ids = lista.eventos.map((evento) => evento.id);
  assert(ids.indexOf(950001) !== -1 && ids.indexOf(950004) !== -1 && ids.indexOf(950006) !== -1, "confirmados");
  assert(ids.indexOf(950002) === -1 && ids.indexOf(950003) === -1, "não confirmados");
  assert(JSON.stringify(lista).indexOf("cpf-nao-mostrar") === -1 && JSON.stringify(lista).indexOf("999") === -1 && JSON.stringify(lista).indexOf("R$") === -1, "lista limpa");

  assert((await pedir("GET", "/api/producao/eventos/950002", sessao)).status === 409, "aberto");
  assert((await pedir("GET", "/api/producao/eventos/950003", sessao)).status === 409, "só pdf");
  assert((await pedir("GET", "/api/producao/eventos/959999", sessao)).status === 404, "inexistente");
  assert((await pedir("GET", "/api/producao/datas/2026-02-31", sessao)).status === 400, "data inválida");

  const detalhe = JSON.parse((await pedir("GET", "/api/producao/eventos/950001?quantidade=999&itens=[]", sessao)).body);
  const porNome = {};
  detalhe.itens.forEach((itemLinha) => { porNome[itemLinha.nome] = itemLinha; });
  assert(porNome["Brigadeiro de Doce de Leite com Nozes"].quantidade_texto === "2" && porNome["Brigadeiro de Doce de Leite com Nozes"].unidade === "cento", "cento");
  assert(porNome["Pacote festa"].unidade === "pacote" && porNome["Pacote festa"].quantidade_texto === "1", "pacote");
  assert(porNome["Bem-casado"].unidade === "Unidade não informada" && porNome["Bem-casado"].quantidade_texto === "50", "sem unidade");
  assert(porNome["Bem-casado extra"].complementar === true && porNome["Bem-casado"].complementar === false, "complementar");
  assert(porNome["Doce com mínimo"].quantidade_texto === "3", "ignora mínimo");
  assert(porNome["Doce quebrado"].quantidade_texto === "Conferência necessária" && porNome["Doce ambíguo"].quantidade_texto === "Conferência necessária", "quantidades inválidas");
  assert(porNome["Brigadeiro de festa"].quantidade_texto === "4" && porNome["Brigadeiro de festa"].unidade === "pacote", "nome limpo");
  assert(detalhe.horario_festa === "18:30" && detalhe.horario_entrega == null, "horários");
  assert(detalhe.avisos.some((aviso) => aviso.indexOf("Horário de entrega a conferir: 14") !== -1), "horário incompleto");
  assert(detalhe.modalidade === "Retirada" && detalhe.convidados === 80 && detalhe.situacao === "Conferência necessária", "evento");
  const textoDetalhe = JSON.stringify(detalhe);
  ["cpf-nao-mostrar", "rua secreta", "11999999999", "secreto@exemplo.com", "telefone secreto", "nota interna", "degustacao secreta", "preco", "qtd_min", "valor_final", "R$", "999"].forEach((proibido) => {
    assert(textoDetalhe.indexOf(proibido) === -1, "vazou " + proibido);
  });

  const dia = JSON.parse((await pedir("GET", "/api/producao/datas/" + hoje + "?quantidade=1", sessao)).body);
  function total(nome, unidade) {
    return dia.totais.find((grupo) => grupo.nome.toLocaleLowerCase("pt-BR") === nome && grupo.unidade === unidade);
  }
  assert(total("brigadeiro gourmet", "unidade").quantidade_texto === "120", "soma caixa");
  assert(total("brigadeiro tradicional", "unidade").quantidade_texto === "40" && total("brigadeiro tradicional", "unidade").nome === "Brigadeiro Tradicional", "nomes diferentes de caixa");
  assert(total("brigadeiro gourmet", "cento").quantidade_texto === "1", "unidade diferente");
  assert(total("brigadeiro de doce de leite com nozes", "cento").quantidade_texto === "2", "não mistura sabores");
  assert(!dia.totais.some((grupo) => grupo.nome === "Doce quebrado" || grupo.nome === "Doce ambíguo"), "inválidos fora da soma");
  assert(dia.eventos.length === 2, "dois eventos");
  const vazio = JSON.parse((await pedir("GET", "/api/producao/datas/2020-01-01", sessao)).body);
  assert(vazio.eventos.length === 0 && vazio.totais.length === 0, "dia vazio");

  const falso = await pedir("POST", "/api/producao/eventos/950001/pdf", Object.assign({
    body: { quantidade: 1, itens: [{ nome: "Invasor", quantidade: 999 }] }
  }, sessao));
  assert(falso.status === 405, "post " + falso.status);
  assert((await pedir("GET", "/api/orcamentos/950001", sessao)).body === payloadAntes, "payload mudou");

  async function pdf(caminho, nome) {
    const resposta = await pedir("GET", caminho, Object.assign({ binario: true }, sessao));
    assert(resposta.status === 200 && String(resposta.headers["content-type"]).indexOf("application/pdf") === 0, "pdf " + caminho + " " + resposta.status);
    assert(String(resposta.headers["cache-control"]).indexOf("no-store") !== -1, "cache");
    fs.writeFileSync(path.join(preview, nome), resposta.body);
    return textoPdf(resposta.body);
  }
  const ficha = await pdf("/api/producao/eventos/950001/pdf?quantidade=1", "ficha.pdf");
  assert(ficha.indexOf("Candy Li Doces Finos") !== -1 && ficha.indexOf("Ficha de Produção") !== -1, "cabeçalho");
  assert(ficha.indexOf("Contrato 950001") !== -1 && ficha.indexOf("Casamento") !== -1, "evento pdf");
  assert(ficha.indexOf("cento") !== -1 && ficha.indexOf("pacote") !== -1 && ficha.indexOf("Unidade n") !== -1, "unidades pdf");
  assert(ficha.indexOf("Confer") !== -1 && ficha.indexOf("18:30") !== -1 && ficha.indexOf("14") !== -1, "conferência pdf");
  assert(ficha.indexOf("Produzido") !== -1 && ficha.indexOf("Conferido por") !== -1, "conferência manual");
  ["telefone secreto", "nota interna", "degustacao secreta", "cpf-nao-mostrar", "rua secreta", "R$", "qtd_min"].forEach((proibido) => {
    assert(ficha.indexOf(proibido) === -1, "pdf vazou " + proibido);
  });
  const resumo = await pdf("/api/producao/datas/" + hoje + "/pdf", "dia.pdf");
  assert(resumo.indexOf("Produção do dia") !== -1 && resumo.indexOf("120") !== -1 && resumo.indexOf("950001") !== -1 && resumo.indexOf("950004") !== -1, "resumo");
  assert(resumo.indexOf("R$") === -1 && resumo.indexOf("qtd_min") === -1, "resumo limpo");
  const varias = await pdf("/api/producao/eventos/950006/pdf", "varias.pdf");
  assert(varias.indexOf("Página 2 de ") !== -1 && varias.indexOf("Doce de linha 01") !== -1 && varias.indexOf("Doce de linha 48") !== -1, "paginas");
  const diaVazio = await pdf("/api/producao/datas/2020-01-01/pdf", "vazio.pdf");
  assert(diaVazio.indexOf("Nenhum evento confirmado nesta data.") !== -1, "pdf vazio");
  assert((await pedir("GET", "/api/orcamentos/950001", sessao)).body === payloadAntes, "payload após pdf");
  const financeiro = await pedir("GET", "/api/financeiro/contratos", sessao);
  const demonstrativo = await pedir("GET", "/api/financeiro/contratos/950001/demonstrativo", Object.assign({ binario: true }, sessao));
  assert(financeiro.status === 200 && String(financeiro.body).indexOf("950001") !== -1, "financeiro");
  assert(demonstrativo.status === 200 && String(demonstrativo.headers["content-type"]).indexOf("application/pdf") === 0, "demonstrativo");
  assert((await pedir("GET", "/api/producao/eventos/950001/pdf")).status === 401, "pdf sem sessão");

  chrome = spawn(CHROME, [
    "--headless=new", "--disable-gpu", "--no-first-run", "--disable-extensions",
    "--remote-debugging-port=9388", "--user-data-dir=" + perfil, "about:blank"
  ], { stdio: "ignore" });
  await esperarHttp("http://127.0.0.1:9388/json/version");
  const alvos = await new Promise((resolve, reject) => {
    http.get("http://127.0.0.1:9388/json/list", (res) => {
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
  await enviar("Network.enable");
  await enviar("Page.enable");
  await enviar("Network.setCookie", { name: "cl_sessao", value: token, url: "http://127.0.0.1:" + PORT + "/" });
  await enviar("Page.navigate", { url: "http://127.0.0.1:" + PORT + "/admin/gestao/producao.html" });
  await avaliar("[...document.querySelectorAll('#producao-corpo tr')].some((tr) => tr.textContent.indexOf('Casamento') !== -1)");
  await avaliar("document.body.innerText.indexOf('Formatura') === -1 && document.body.innerText.indexOf('Batizado') === -1");
  await avaliar(`(() => {
    const botao = [...document.querySelectorAll("#producao-corpo button")].find((el) => el.getAttribute("data-acao") === "ver" && el.closest("tr").textContent.indexOf("Casamento") !== -1);
    botao.click();
    return true;
  })()`);
  await avaliar("document.getElementById('producao-detalhe').hidden === false && document.getElementById('producao-detalhe').innerText.indexOf('cento') !== -1 && document.getElementById('producao-detalhe').innerText.indexOf('Unidade não informada') !== -1");
  await avaliar("document.body.innerText.indexOf('120') !== -1 && document.body.innerText.indexOf('telefone secreto') === -1 && document.body.innerText.indexOf('R$') === -1");
  await enviar("Page.navigate", { url: "http://127.0.0.1:" + PORT + "/admin/gestao/index.html" });
  await avaliar("document.getElementById('indicador-orcamentos').textContent === '5'");
  await enviar("Page.navigate", { url: "http://127.0.0.1:" + PORT + "/admin/gestao/agenda.html" });
  await avaliar("!!document.getElementById('agenda-grade') && document.querySelectorAll('.gestao-dia').length >= 28");
  await enviar("Page.navigate", { url: "http://127.0.0.1:" + PORT + "/admin/gestao/financeiro.html" });
  await avaliar("!!document.getElementById('financeiro-corpo')");
  const home = await pedir("GET", "/");
  const contratoPdf = await pedir("GET", "/js/contrato-pdf.js");
  const orcamentoPdf = await pedir("GET", "/js/orcamento-pdf.js");
  assert(home.status === 200 && home.body.indexOf("Candy Li") !== -1, "cardápio");
  assert(contratoPdf.status === 200 && contratoPdf.body.indexOf("gerarContratoPDF") !== -1, "contrato pdf");
  assert(orcamentoPdf.status === 200 && orcamentoPdf.body.indexOf("jspdf") !== -1, "orçamento pdf");

  const depois = assinaturaReal();
  assert(depois.ic === "ok" && depois.hash === antes.hash && depois.n === antes.n, "payloads reais");
  assert(JSON.stringify(depois.pagamentos) === JSON.stringify(antes.pagamentos), "pagamentos reais");
  assert(JSON.stringify(depois.confirmados) === JSON.stringify(antes.confirmados), "confirmações reais");
  assert(JSON.stringify(depois.migracoes) === JSON.stringify(antes.migracoes), "migrações");
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
