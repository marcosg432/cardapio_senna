/**
 * Emissão oficial dos cinco PDFs. Banco temporário. O banco real só é conferido.
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

const PORT = 3277;
const SENHA = "senha-de-teste-local";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const root = path.join(__dirname, "..");
const realDb = path.join(root, "database", "database.sqlite");
const tmpDb = path.join(os.tmpdir(), "candyli-docs-pdf-" + Date.now() + ".sqlite");
const tmpPdf = path.join(os.tmpdir(), "candyli-docs-pdf-arq-" + Date.now());
const preview = path.join(os.tmpdir(), "candyli-docs-pdf-preview-" + Date.now());
const perfil = path.join(os.tmpdir(), "candyli-chrome-docs-pdf-" + Date.now());
if (path.resolve(tmpDb) === path.resolve(realDb)) throw new Error("recusa banco real");
process.env.DATABASE_PATH = tmpDb;
process.env.MIGRACOES_AUTORIZADAS = "004_documentos_versoes.sql";
process.env.DOCUMENTOS_DIR = tmpPdf;
process.env.COOKIE_SECURE = "0";

const documentos = require("../database/repositories/documentosRepository");
const { closeDb } = require("../database/db");
let servidorTeste;

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function assinaturaReal() {
  const db = new DatabaseSync(realDb, { readOnly: true });
  const ic = db.prepare("PRAGMA integrity_check").get().integrity_check;
  const rows = db.prepare("SELECT id, payload FROM orcamentos ORDER BY id").all();
  const pagamentos = db.prepare("SELECT id, orcamento_id, valor_centavos, pago_em, forma FROM pagamentos ORDER BY id").all();
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

function textoPdf(buffer) {
  const cru = buffer.toString("latin1");
  let texto = cru;
  for (const marca of cru.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    try { texto += zlib.inflateSync(Buffer.from(marca[1], "latin1")).toString("latin1"); } catch (e) { /* sem compressão */ }
  }
  return texto;
}

function orcamento(id, cliente) {
  return JSON.stringify({
    id: id,
    cliente: cliente,
    nome_cliente: cliente,
    tipo_evento: "Aniversário",
    data_evento: "2026-12-20",
    convidados: 40,
    entrega_suporte: "Apenas retirada dos doces sem entrega",
    evento_horario_entrega: "18:30",
    evento_horario_festa: "19:00",
    itens: [{ nome: "Brigadeiro gourmet", quantidade: 50, unidade: "unidade", preco: 2, preco_unitario: 2, subtotal: 100 }],
    valor_original: 100,
    valor_final: 1,
    total: 1,
    observacoes: "Observação do pedido"
  });
}

async function main() {
  const antes = assinaturaReal();
  assert(antes.ic === "ok" && antes.n >= 1, "banco real");
  assert(antes.migracoes.indexOf("003_financeiro.sql") !== -1, "esquema real");
  fs.rmSync(tmpDb, { force: true });
  fs.mkdirSync(preview, { recursive: true });
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
  servidorTeste = servidor;
  let saida = "";
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("servidor\n" + saida)), 8000);
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
  db.prepare("INSERT INTO orcamentos (id, payload, created_at, updated_at) VALUES (?, ?, ?, ?)").run(970100, orcamento(970100, "Cliente Aberto"), "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z");
  db.prepare("INSERT INTO orcamentos (id, payload, created_at, updated_at) VALUES (?, ?, ?, ?)").run(970200, orcamento(970200, "Cliente Fechado"), "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z");
  db.close();

  const login = await pedir("POST", "/api/auth/login", { body: { senha: SENHA } });
  const cookie = String(login.headers["set-cookie"]).split(";")[0];
  const csrf = json(login).csrfToken;
  const sessao = { cookie: cookie, csrf: csrf };
  assert((await pedir("POST", "/api/orcamentos/970200/confirmar-contrato", Object.assign({ body: {} }, sessao))).status === 200, "confirmar");
  const payloadAntes = (await pedir("GET", "/api/orcamentos/970200", { cookie: cookie })).body.toString();

  const docEvento = json(await pedir("POST", "/api/documentos", Object.assign({ body: { tipo: "producao_evento", orcamentoId: 970200 } }, sessao))).documento;
  const rascunho = json(await pedir("POST", "/api/documentos/" + docEvento.id + "/rascunho", Object.assign({ body: { motivo: "Ficha inicial" } }, sessao))).versao;
  const salvo = json(await pedir("PATCH", "/api/documentos/versoes/" + rascunho.id, Object.assign({
    body: { revisao: rascunho.revisao, motivo: "Responsável da cozinha", operacional: { responsavel: "Ana", observacoes: "Separar forminhas", preparo: "2026-12-19", montagem: "", embalagem: "", orientacoes: "", etapas: [{ titulo: "Cobertura", detalhe: "No dia" }] } }
  }, sessao))).versao;
  const previa = await pedir("GET", "/api/documentos/versoes/" + salvo.id + "/previa", { cookie: cookie });
  const textoPrevia = textoPdf(previa.body);
  assert(previa.status === 200 && textoPrevia.indexOf("RASCUNHO") !== -1 && textoPrevia.indexOf("Ana") !== -1, "prévia");
  assert(previa.headers["x-documento-previa"] === "rascunho", "cabeçalho da prévia");
  assert(!fs.existsSync(path.join(tmpPdf, String(docEvento.id))), "prévia não grava arquivo");

  const semCsrf = await pedir("POST", "/api/documentos/versoes/" + salvo.id + "/emitir", { cookie: cookie, body: { revisao: salvo.revisao, chave: "chave-producao-evento-01" } });
  assert(semCsrf.status === 403, "csrf");
  const emitida = await pedir("POST", "/api/documentos/versoes/" + salvo.id + "/emitir", Object.assign({
    body: { revisao: salvo.revisao, chave: "chave-producao-evento-01" }
  }, sessao));
  assert(emitida.status === 201 && json(emitida).versao.estado === "emitida" && json(emitida).versao.numero === 1, "emissão " + emitida.body.toString());
  const repetida = await pedir("POST", "/api/documentos/versoes/" + salvo.id + "/emitir", Object.assign({
    body: { revisao: 1, chave: "chave-producao-evento-01" }
  }, sessao));
  assert(repetida.status === 200 && json(repetida).repetida === true, "idempotência");
  assert(fs.readdirSync(path.join(tmpPdf, String(docEvento.id))).length === 1, "um arquivo");
  const pdf1 = await pedir("GET", "/api/documentos/versoes/" + salvo.id + "/pdf?caminho=../database/database.sqlite", { cookie: cookie });
  const texto1 = textoPdf(pdf1.body);
  fs.writeFileSync(path.join(preview, "ficha-v1.pdf"), pdf1.body);
  assert(pdf1.status === 200 && texto1.indexOf("Brigadeiro gourmet") !== -1 && texto1.indexOf("50") !== -1 && texto1.indexOf("Ana") !== -1, "ficha");
  assert(texto1.indexOf("RASCUNHO") === -1 && texto1.indexOf("CREATE TABLE") === -1, "ficha oficial");
  assert(texto1.indexOf("lista congelada nesta versão") !== -1, "rodapé congelado");
  const cozinha = await pedir("GET", "/api/producao/eventos/970200/pdf", { cookie: cookie });
  const textoCozinha = textoPdf(cozinha.body);
  fs.writeFileSync(path.join(preview, "ficha-cozinha.pdf"), cozinha.body);
  assert(textoCozinha.indexOf("Brigadeiro gourmet") !== -1 && textoCozinha.indexOf("Candy Li Doces Finos") !== -1, "modelo da cozinha");
  assert(textoCozinha.indexOf("lista atual do contrato confirmado") !== -1, "rodapé ao vivo");
  assert((await pedir("GET", "/api/orcamentos/970200", { cookie: cookie })).body.toString() === payloadAntes, "payload intacto");

  const segundo = json(await pedir("POST", "/api/documentos/" + docEvento.id + "/rascunho", Object.assign({ body: { motivo: "Segunda ficha" } }, sessao))).versao;
  const salvo2 = json(await pedir("PATCH", "/api/documentos/versoes/" + segundo.id, Object.assign({
    body: { revisao: segundo.revisao, motivo: "Trocar responsável", operacional: { responsavel: "Bia", observacoes: "", preparo: "", montagem: "", embalagem: "", orientacoes: "", etapas: [] } }
  }, sessao))).versao;
  const conflito = await pedir("POST", "/api/documentos/versoes/" + segundo.id + "/emitir", Object.assign({
    body: { revisao: 1, chave: "chave-producao-evento-02" }
  }, sessao));
  assert(conflito.status === 409, "concorrência");
  const emitida2 = await pedir("POST", "/api/documentos/versoes/" + segundo.id + "/emitir", Object.assign({
    body: { revisao: salvo2.revisao, chave: "chave-producao-evento-02" }
  }, sessao));
  assert(emitida2.status === 201 && json(emitida2).versao.numero === 2, "segunda versão");
  const antiga = textoPdf((await pedir("GET", "/api/documentos/versoes/" + salvo.id + "/pdf", { cookie: cookie })).body);
  const nova = textoPdf((await pedir("GET", "/api/documentos/versoes/" + segundo.id + "/pdf", { cookie: cookie })).body);
  assert(antiga.indexOf("Ana") !== -1 && antiga.indexOf("Bia") === -1 && nova.indexOf("Bia") !== -1, "histórico preservado");

  const docDia = json(await pedir("POST", "/api/documentos", Object.assign({ body: { tipo: "producao_dia", data: "2026-12-20" } }, sessao))).documento;
  const dia = json(await pedir("POST", "/api/documentos/" + docDia.id + "/rascunho", Object.assign({ body: { motivo: "Resumo do dia" } }, sessao))).versao;
  const diaSalvo = json(await pedir("PATCH", "/api/documentos/versoes/" + dia.id, Object.assign({
    body: { revisao: dia.revisao, motivo: "Orientação do dia", operacional: { responsavel: "", observacoes: "", preparo: "", montagem: "", embalagem: "", orientacoes: "Manter refrigerado", etapas: [] } }
  }, sessao))).versao;
  const diaPdf = await pedir("POST", "/api/documentos/versoes/" + dia.id + "/emitir", Object.assign({
    body: { revisao: diaSalvo.revisao, chave: "chave-producao-dia-0001" }
  }, sessao));
  assert(diaPdf.status === 201, "dia " + diaPdf.body.toString());
  const textoDia = textoPdf((await pedir("GET", "/api/documentos/versoes/" + dia.id + "/pdf", { cookie: cookie })).body);
  fs.writeFileSync(path.join(preview, "producao-dia.pdf"), (await pedir("GET", "/api/documentos/versoes/" + dia.id + "/pdf", { cookie: cookie })).body);
  assert(textoDia.indexOf("20/12/2026") !== -1 && textoDia.indexOf("Brigadeiro gourmet") !== -1 && textoDia.indexOf("50") !== -1, "dia");
  assert(textoDia.indexOf("Manter refrigerado") !== -1 && textoDia.indexOf("unidade") !== -1, "instrução e unidade");

  const docFin = json(await pedir("POST", "/api/documentos", Object.assign({ body: { tipo: "demonstrativo", orcamentoId: 970200 } }, sessao))).documento;
  const fin = json(await pedir("POST", "/api/documentos/" + docFin.id + "/rascunho", Object.assign({ body: { motivo: "Demonstrativo inicial" } }, sessao))).versao;
  assert(fin.conteudo.oficial.valor_contratado_centavos === 10000, "valor congelado " + JSON.stringify(fin.conteudo.oficial));
  const finSalvo = json(await pedir("PATCH", "/api/documentos/versoes/" + fin.id, Object.assign({
    body: { revisao: fin.revisao, motivo: "Nota de capa", apresentacao: { observacao: "Nota de apresentação" } }
  }, sessao))).versao;
  const fin1 = await pedir("POST", "/api/documentos/versoes/" + fin.id + "/emitir", Object.assign({
    body: { revisao: finSalvo.revisao, chave: "chave-demonstrativo-001" }
  }, sessao));
  assert(fin1.status === 201, "demonstrativo " + fin1.body.toString());
  const textoFin1 = textoPdf((await pedir("GET", "/api/documentos/versoes/" + fin.id + "/pdf", { cookie: cookie })).body);
  fs.writeFileSync(path.join(preview, "demonstrativo-v1.pdf"), (await pedir("GET", "/api/documentos/versoes/" + fin.id + "/pdf", { cookie: cookie })).body);
  assert(textoFin1.indexOf("R$ 100,00") !== -1 && textoFin1.indexOf("Nenhum pagamento") !== -1 && textoFin1.indexOf("Nota de apresenta") !== -1, "demonstrativo v1");
  const pagamento = await pedir("POST", "/api/financeiro/contratos/970200/pagamentos", Object.assign({
    body: { valor_centavos: 5000, pago_em: "2026-10-29", forma: "pix", chave_idempotencia: "pagamento-temporario-01" }
  }, sessao));
  assert(pagamento.status === 201, "pagamento " + pagamento.body.toString());
  const fin2r = json(await pedir("POST", "/api/documentos/" + docFin.id + "/rascunho", Object.assign({ body: { motivo: "Depois do pagamento" } }, sessao))).versao;
  const fin2 = await pedir("POST", "/api/documentos/versoes/" + fin2r.id + "/emitir", Object.assign({
    body: { revisao: fin2r.revisao, chave: "chave-demonstrativo-002" }
  }, sessao));
  assert(fin2.status === 201, "demonstrativo 2");
  const textoFin1b = textoPdf((await pedir("GET", "/api/documentos/versoes/" + fin.id + "/pdf", { cookie: cookie })).body);
  const textoFin2 = textoPdf((await pedir("GET", "/api/documentos/versoes/" + fin2r.id + "/pdf", { cookie: cookie })).body);
  fs.writeFileSync(path.join(preview, "demonstrativo-v2.pdf"), (await pedir("GET", "/api/documentos/versoes/" + fin2r.id + "/pdf", { cookie: cookie })).body);
  assert(textoFin1b.indexOf("Nenhum pagamento") !== -1 && textoFin1b.indexOf("R$ 50,00") === -1, "versão antiga");
  assert(textoFin2.indexOf("R$ 50,00") !== -1 && textoFin2.indexOf("R$ 100,00") !== -1, "versão nova");
  const hashFin = documentos.validarHash(fin.id);
  assert(hashFin.snapshot === true && hashFin.pdf === true, "hash");

  async function emitirComercial(tipo, orcamentoId, chave, nota) {
    const doc = json(await pedir("POST", "/api/documentos", Object.assign({ body: { tipo: tipo, orcamentoId: orcamentoId } }, sessao))).documento;
    const versao = json(await pedir("POST", "/api/documentos/" + doc.id + "/rascunho", Object.assign({ body: { motivo: "Emissão " + tipo } }, sessao))).versao;
    let revisao = versao.revisao;
    if (nota) {
      const atualizado = json(await pedir("PATCH", "/api/documentos/versoes/" + versao.id, Object.assign({
        body: { revisao: revisao, motivo: "Nota da revisão", revisao_texto: nota }
      }, sessao)));
      revisao = atualizado.versao.revisao;
    }
    const emissao = await pedir("POST", "/api/documentos/versoes/" + versao.id + "/emitir", Object.assign({
      body: { revisao: revisao, chave: chave }
    }, sessao));
    assert(emissao.status === 201, tipo + " " + emissao.body.toString());
    return { id: versao.id, texto: textoPdf((await pedir("GET", "/api/documentos/versoes/" + versao.id + "/pdf", { cookie: cookie })).body), body: (await pedir("GET", "/api/documentos/versoes/" + versao.id + "/pdf", { cookie: cookie })).body };
  }

  const propostaAberta = await pedir("GET", "/api/orcamentos/970100/proposta.pdf", { cookie: cookie });
  fs.writeFileSync(path.join(preview, "proposta.pdf"), propostaAberta.body);
  const textoProposta = textoPdf(propostaAberta.body);
  assert(propostaAberta.status === 200 && textoProposta.indexOf("PROPOSTA DE ORCAMENTO") !== -1, "proposta");
  assert(textoProposta.indexOf("Brigadeiro gourmet") !== -1 && textoProposta.indexOf("100,00") !== -1 && textoProposta.indexOf("R$ 1,00") === -1, "total recalculado");
  const orcAberto = await emitirComercial("orcamento", 970100, "chave-orcamento-aberto01", "Texto da revisão");
  fs.writeFileSync(path.join(preview, "orcamento-versao.pdf"), orcAberto.body);
  assert(orcAberto.texto.indexOf("PROPOSTA DE ORCAMENTO") !== -1 && orcAberto.texto.indexOf("Revis") !== -1 && orcAberto.texto.indexOf("100,00") !== -1, "orçamento aberto");
  const orcFechado = await emitirComercial("orcamento", 970200, "chave-orcamento-fechado1", "");
  assert(orcFechado.texto.indexOf("100,00") !== -1, "orçamento confirmado");
  assert((await pedir("GET", "/api/orcamentos/970200", { cookie: cookie })).body.toString() === payloadAntes, "confirmação preservada");

  const contratoAberto = await emitirComercial("contrato", 970100, "chave-contrato-aberto001", "");
  fs.writeFileSync(path.join(preview, "contrato-aberto.pdf"), contratoAberto.body);
  assert(contratoAberto.texto.indexOf("CLÁUSULA PRIMEIRA") !== -1 && contratoAberto.texto.indexOf("CLIENTE CONTRATANTE") !== -1, "cláusulas");
  assert(contratoAberto.texto.indexOf("Brigadeiro gourmet") !== -1 && contratoAberto.texto.indexOf("100,00") !== -1, "anexo");
  const contratoFechado = await emitirComercial("contrato", 970200, "chave-contrato-fechado01", "Nota contratual");
  fs.writeFileSync(path.join(preview, "contrato-fechado.pdf"), contratoFechado.body);
  assert(contratoFechado.texto.indexOf("não substitui nem renova") !== -1 && contratoFechado.texto.indexOf("CLÁUSULA PRIMEIRA") !== -1, "revisão sem nova aceitação");
  assert(/\/Subtype\s*\/Image/.test(contratoFechado.body.toString("latin1")) && /\/DCTDecode/.test(contratoFechado.body.toString("latin1")), "assinatura jpeg no contrato");
  const troca = await pedir("PATCH", "/api/orcamentos/970200", Object.assign({
    body: { itens: [{ nome: "Brigadeiro gourmet", quantidade: 9, unidade: "unidade", preco: 2, preco_unitario: 2, subtotal: 18 }] }
  }, sessao));
  assert(troca.status === 409, "bloqueio contratual");
  assert((await pedir("GET", "/api/orcamentos/970200", { cookie: cookie })).body.toString() === payloadAntes, "payload após recusa");
  assert((await pedir("GET", "/api/documentos/versoes/" + salvo.id + "/pdf")).status === 401, "download sem sessão");
  assert((await pedir("GET", "/api/orcamentos/970100/contrato.pdf")).status === 401, "contrato sem sessão");

  const falhaDoc = json(await pedir("POST", "/api/documentos", Object.assign({ body: { tipo: "producao_evento", orcamentoId: 970200 } }, sessao)));
  const falhaR = json(await pedir("POST", "/api/documentos/" + falhaDoc.documento.id + "/rascunho", Object.assign({ body: { motivo: "Rascunho para falha" } }, sessao))).versao;
  documentos.atualizarRascunho({ versaoId: falhaR.id, revisao: falhaR.revisao, motivo: "Conteúdo inválido de teste", conteudo: { contratado: {} } });
  const geracao = await pedir("POST", "/api/documentos/versoes/" + falhaR.id + "/emitir", Object.assign({
    body: { revisao: falhaR.revisao + 1, chave: "chave-falha-geracao-pdf" }
  }, sessao));
  assert(geracao.status === 500, "falha de geração " + geracao.status + " " + geracao.body.toString());
  assert(json(await pedir("GET", "/api/documentos/versoes/" + falhaR.id, { cookie: cookie })).versao.estado === "rascunho", "rascunho após falha");

  const guarda = path.join(tmpPdf, "nao-e-diretorio");
  fs.writeFileSync(guarda, "x");
  const anterior = process.env.DOCUMENTOS_DIR;
  process.env.DOCUMENTOS_DIR = guarda;
  let armazenou = false;
  try {
    documentos.emitir({ versaoId: falhaR.id, revisao: falhaR.revisao + 1, chave: "chave-falha-armazenar01", pdf: Buffer.from("%PDF-1.4 x") });
    armazenou = true;
  } catch (e) { armazenou = false; }
  process.env.DOCUMENTOS_DIR = anterior;
  assert(armazenou === false, "falha de armazenamento");
  assert(json(await pedir("GET", "/api/documentos/versoes/" + falhaR.id, { cookie: cookie })).versao.estado === "rascunho", "sem versão emitida");

  const chrome = spawn(CHROME, [
    "--headless=new", "--disable-gpu", "--no-first-run", "--disable-extensions",
    "--remote-debugging-port=9411", "--user-data-dir=" + perfil, "about:blank"
  ], { stdio: "ignore" });
  await new Promise((resolve, reject) => {
    const inicio = Date.now();
    const timer = setInterval(() => {
      http.get("http://127.0.0.1:9411/json/version", (res) => {
        res.resume();
        if (res.statusCode === 200) { clearInterval(timer); resolve(); }
      }).on("error", () => {
        if (Date.now() - inicio > 8000) { clearInterval(timer); reject(new Error("chrome")); }
      });
    }, 200);
  });
  const alvos = await new Promise((resolve, reject) => {
    http.get("http://127.0.0.1:9411/json/list", (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))));
    }).on("error", reject);
  });
  const ws = new WebSocket(alvos.find((item) => item.type === "page").webSocketDebuggerUrl);
  await new Promise((resolve) => ws.addEventListener("open", resolve));
  const token = decodeURIComponent(cookie.split("=").slice(1).join("="));
  let idCmd = 1;
  function enviar(method, params) {
    const id = idCmd++;
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
  await enviar("Network.setCookie", { name: "cl_sessao", value: token, url: "http://127.0.0.1:" + PORT + "/" });
  await enviar("Page.navigate", { url: "http://127.0.0.1:" + PORT + "/admin/gestao/documentos.html" });
  const pronto = Date.now();
  let tela = null;
  while (Date.now() - pronto < 8000) {
    const avaliado = await enviar("Runtime.evaluate", { expression: "document.body && document.body.innerText.indexOf('Documentos') !== -1 && document.getElementById('documentos-emitir') ? true : null", returnByValue: true });
    tela = avaliado.result && avaliado.result.value;
    if (tela) break;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  assert(tela === true, "tela");
  await enviar("Emulation.setDeviceMetricsOverride", { width: 390, height: 800, deviceScaleFactor: 1, mobile: true });
  const largura = await enviar("Runtime.evaluate", { expression: "document.documentElement.scrollWidth <= window.innerWidth + 24", returnByValue: true });
  assert(largura.result.value === true, "layout estreito");
  ws.close();
  chrome.kill();
  servidor.kill();
  closeDb();

  const depois = assinaturaReal();
  assert(depois.hash === antes.hash && depois.n === antes.n && JSON.stringify(depois.pagamentos) === JSON.stringify(antes.pagamentos), "dados reais");
  assert(JSON.stringify(depois.migracoes) === JSON.stringify(antes.migracoes), "migrações reais");
  console.log(JSON.stringify({ ok: true, preview: preview, orcamentos: depois.n }));
}

main().catch((e) => {
  console.error(e && e.stack ? e.stack : e);
  process.exitCode = 1;
}).finally(() => {
  if (servidorTeste) {
    try { servidorTeste.kill(); } catch (e) { /* já encerrado */ }
  }
});
