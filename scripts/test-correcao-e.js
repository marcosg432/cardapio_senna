/**
 * Correções da homologação E. Banco temporário.
 * Não aplica a migração 004 no banco real e não usa a porta 3003.
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

const PORT = 3281;
const SENHA = "senha-de-teste-local";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const root = path.join(__dirname, "..");
const realDb = path.join(root, "database", "database.sqlite");
const asset = path.join(root, "assets", "assinatura-contratada.png");
const base = path.join(os.tmpdir(), "candyli-correcao-e");
const conferencia = path.join(base, "conferencia");
if (path.resolve(base) === path.resolve(realDb)) throw new Error("recusa banco real");

process.env.DATABASE_PATH = path.join(base, "nao-abrir-real.sqlite");
process.env.MIGRACOES_AUTORIZADAS = "004_documentos_versoes.sql";
process.env.COOKIE_SECURE = "0";
delete process.env.CANDYLI_ASSINATURA_ARQUIVO;
delete process.env.CANDYLI_TESTE_ISOLADO;

const documentoPdf = require("../server/documentoPdf");

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

function hashArquivo(arquivo) {
  return crypto.createHash("sha256").update(fs.readFileSync(arquivo)).digest("hex");
}

function crc32(buffer) {
  let c = ~0;
  for (let i = 0; i < buffer.length; i++) {
    c ^= buffer[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunkPng(tipo, dados) {
  const nome = Buffer.from(tipo);
  const tamanho = Buffer.alloc(4);
  tamanho.writeUInt32BE(dados.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([nome, dados])));
  return Buffer.concat([tamanho, nome, dados, crc]);
}

function pngValido(largura, altura) {
  const cru = Buffer.alloc((1 + largura * 3) * altura);
  for (let y = 0; y < altura; y++) {
    const origem = y * (1 + largura * 3);
    for (let x = 0; x < largura; x++) {
      cru[origem + 1 + x * 3] = 180;
      cru[origem + 2 + x * 3] = 40;
      cru[origem + 3 + x * 3] = 70;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(largura, 0);
  ihdr.writeUInt32BE(altura, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunkPng("IHDR", ihdr),
    chunkPng("IDAT", zlib.deflateSync(cru)),
    chunkPng("IEND", Buffer.alloc(0))
  ]);
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
      hostname: "127.0.0.1", port: opcoes.porta || PORT, path: urlPath, method: method, headers: headers
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

function paginas(buffer) {
  return (buffer.toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length;
}

function proposta(id) {
  return {
    id: id,
    cliente: "Cliente Homologacao",
    nome_cliente: "Cliente Homologacao",
    tipo_evento: "Aniversário",
    data_evento: "2026-12-20",
    convidados: 40,
    entrega_suporte: "Apenas retirada dos doces sem entrega",
    evento_horario_entrega: "18:30",
    evento_horario_festa: "19:00",
    itens: [{ nome: "Brigadeiro gourmet", quantidade: 50, unidade: "unidade", preco: 2, preco_unitario: 2, subtotal: 100 }],
    valor_original: 100,
    valor_final: 100,
    total: 100,
    observacoes: "Pedido de homologação"
  };
}

function subir(tmpDb, tmpPdf, extra) {
  const servidor = spawn(process.execPath, ["server.js"], {
    cwd: root,
    env: Object.assign({}, process.env, extra || {}, {
      PORT: String(PORT),
      DATABASE_PATH: tmpDb,
      MIGRACOES_AUTORIZADAS: "004_documentos_versoes.sql",
      DOCUMENTOS_DIR: tmpPdf,
      COOKIE_SECURE: "0"
    }),
    stdio: ["ignore", "pipe", "pipe"]
  });
  let saida = "";
  const pronto = new Promise((resolve, reject) => {
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
  return { servidor: servidor, pronto: pronto };
}

async function sessaoAdmin(tmpDb) {
  const db = new DatabaseSync(tmpDb);
  db.prepare("INSERT INTO admin_usuarios (usuario, senha_hash) VALUES (?, ?)").run("admin", bcrypt.hashSync(SENHA, 12));
  db.close();
  const login = await pedir("POST", "/api/auth/login", { body: { senha: SENHA } });
  assert(login.status === 200, "login " + login.status);
  return { cookie: String(login.headers["set-cookie"]).split(";")[0], csrf: json(login).csrfToken };
}

async function prepararContrato(tmpDb, sessao, id) {
  const db = new DatabaseSync(tmpDb);
  const corpo = JSON.stringify(proposta(id));
  db.prepare("INSERT INTO orcamentos (id, payload, created_at, updated_at) VALUES (?, ?, ?, ?)").run(id, corpo, "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z");
  db.close();
  assert((await pedir("POST", "/api/orcamentos/" + id + "/confirmar-contrato", Object.assign({ body: {} }, sessao))).status === 200, "confirmar");
  const doc = json(await pedir("POST", "/api/documentos", Object.assign({ body: { tipo: "contrato", orcamentoId: id } }, sessao))).documento;
  const versao = json(await pedir("POST", "/api/documentos/" + doc.id + "/rascunho", Object.assign({ body: { motivo: "Rascunho do contrato" } }, sessao))).versao;
  return versao;
}

async function main() {
  const antes = assinaturaReal();
  assert(antes.ic === "ok" && antes.migracoes.indexOf("004_documentos_versoes.sql") === -1, "banco real");
  const hashAsset = hashArquivo(asset);
  fs.rmSync(base, { recursive: true, force: true });
  fs.mkdirSync(conferencia, { recursive: true });

  const jpeg = documentoPdf.assinaturaDoArquivo(asset);
  assert(jpeg.formato === "JPEG" && jpeg.width === 824 && jpeg.height === 365, "dimensões jpeg");
  const png = pngValido(2, 1);
  const lido = documentoPdf.interpretarAssinatura(png);
  assert(lido.formato === "PNG" && lido.width === 2 && lido.height === 1, "dimensões png");
  let invalido = false;
  try { documentoPdf.interpretarAssinatura(Buffer.from("arquivo-ilegivel-1234567890")); } catch (e) { invalido = e.code === "assinatura"; }
  assert(invalido, "buffer inválido");
  let ausente = false;
  try { documentoPdf.assinaturaDoArquivo(path.join(base, "assinatura-ausente.png")); } catch (e) { ausente = e.code === "assinatura"; }
  assert(ausente, "arquivo ausente");
  const pdfPng = await documentoPdf.gerar("contrato", { proposta: proposta(980501) }, { assinaturaBuffer: png });
  const cruPng = pdfPng.buffer.toString("latin1");
  assert(/\/Subtype\s*\/Image/.test(cruPng) && cruPng.indexOf("/DCTDecode") === -1 && /\/Width 2/.test(cruPng) && /\/Height 1/.test(cruPng), "contrato png");
  assert(paginas(pdfPng.buffer) === 4 && textoPdf(pdfPng.buffer).indexOf("CLÁUSULA PRIMEIRA") !== -1, "png preserva cláusulas");

  const tmpJpeg = path.join(base, "jpeg.sqlite");
  const pdfJpeg = path.join(base, "pdf-jpeg");
  fs.mkdirSync(pdfJpeg, { recursive: true });
  const servidorJpeg = subir(tmpJpeg, pdfJpeg);
  await servidorJpeg.pronto;
  try {
    const sessao = await sessaoAdmin(tmpJpeg);
    const semCsrf = await pedir("PATCH", "/api/orcamentos/1", { cookie: sessao.cookie, body: { observacoes: "sem csrf" } });
    assert(semCsrf.status === 403, "csrf");
    const versao = await prepararContrato(tmpJpeg, sessao, 980410);
    const previa = await pedir("GET", "/api/documentos/versoes/" + versao.id + "/previa", { cookie: sessao.cookie });
    assert(previa.status === 200 && textoPdf(previa.body).indexOf("RASCUNHO") !== -1 && /\/Subtype\s*\/Image/.test(previa.body.toString("latin1")), "prévia com assinatura");
    const emissao = await pedir("POST", "/api/documentos/versoes/" + versao.id + "/emitir", Object.assign({
      body: { revisao: versao.revisao, chave: "correcao-contrato-jpeg-01" }
    }, sessao));
    assert(emissao.status === 201, "emitir jpeg " + emissao.body.toString());
    const baixado = await pedir("GET", "/api/documentos/versoes/" + versao.id + "/pdf", { cookie: sessao.cookie });
    assert((await pedir("GET", "/api/documentos/versoes/" + versao.id + "/pdf")).status === 401, "download privado");
    const cru = baixado.body.toString("latin1");
    const texto = textoPdf(baixado.body);
    assert(baixado.status === 200 && /\/Subtype\s*\/Image/.test(cru) && /\/DCTDecode/.test(cru), "assinatura jpeg emitida");
    assert(paginas(baixado.body) === 4, "quatro páginas " + paginas(baixado.body));
    assert(texto.indexOf("CLÁUSULA PRIMEIRA") !== -1 && texto.indexOf("11.1") !== -1 && texto.indexOf("ANEXO CONTRATUAL") !== -1, "cláusulas");
    assert(texto.indexOf("ALINE FERNANDA MANOEL") !== -1 && texto.indexOf("ASSINATURA") !== -1 && texto.indexOf("Brigadeiro gourmet") !== -1, "anexo e nome");
    assert(texto.indexOf("RASCUNHO") === -1, "oficial sem marca");
    fs.writeFileSync(path.join(conferencia, "contrato-assinatura.pdf"), baixado.body);

    const doc = json(await pedir("POST", "/api/documentos", Object.assign({ body: { tipo: "producao_evento", orcamentoId: 980410 } }, sessao))).documento;
    const rascunho = json(await pedir("POST", "/api/documentos/" + doc.id + "/rascunho", Object.assign({ body: { motivo: "Etapas iniciais" } }, sessao))).versao;
    const salvo = json(await pedir("PATCH", "/api/documentos/versoes/" + rascunho.id, Object.assign({
      body: {
        revisao: rascunho.revisao,
        motivo: "Etapas com texto",
        operacional: {
          responsavel: "Ana", observacoes: "", preparo: "", montagem: "", embalagem: "", orientacoes: "",
          etapas: [{ titulo: "<script>alert(1)</script>", detalhe: "No dia" }, { titulo: "Cobertura", detalhe: "Forminhas" }]
        }
      }
    }, sessao))).versao;
    assert((await pedir("POST", "/api/documentos/versoes/" + salvo.id + "/emitir", Object.assign({
      body: { revisao: salvo.revisao, chave: "correcao-etapas-v1-0001" }
    }, sessao))).status === 201, "emitir etapas");
    const segundo = json(await pedir("POST", "/api/documentos/" + doc.id + "/rascunho", Object.assign({ body: { motivo: "Sem etapas" } }, sessao))).versao;
    const semEtapas = json(await pedir("PATCH", "/api/documentos/versoes/" + segundo.id, Object.assign({
      body: { revisao: segundo.revisao, motivo: "Lista vazia", operacional: { responsavel: "Ana", observacoes: "", preparo: "", montagem: "", embalagem: "", orientacoes: "", etapas: [] } }
    }, sessao))).versao;
    const comparacao = json(await pedir("GET", "/api/documentos/versoes/" + salvo.id + "/comparar/" + semEtapas.id, { cookie: sessao.cookie }));
    assert(comparacao.iguais === false && JSON.stringify(comparacao).indexOf("Cobertura") !== -1, "api de comparação");

    await conferirTela(sessao, doc.id);
  } finally {
    servidorJpeg.servidor.kill();
  }

  await servidorIsolado("png", path.join(base, "assinatura.png"), png, async (sessao, versao, tmpPdf) => {
    const emissao = await pedir("POST", "/api/documentos/versoes/" + versao.id + "/emitir", Object.assign({
      body: { revisao: versao.revisao, chave: "correcao-contrato-png-001" }
    }, sessao));
    assert(emissao.status === 201, "emitir png " + emissao.body.toString());
    const baixado = await pedir("GET", "/api/documentos/versoes/" + versao.id + "/pdf", { cookie: sessao.cookie });
    const cru = baixado.body.toString("latin1");
    assert(/\/Subtype\s*\/Image/.test(cru) && /\/Width 2/.test(cru) && cru.indexOf("/DCTDecode") === -1, "png pelo servidor");
    assert(fs.readdirSync(tmpPdf).length === 1, "uma versão png");
  });

  await servidorIsolado("invalido", path.join(base, "assinatura-invalida.png"), Buffer.from("isto-nao-e-uma-imagem-valida"), async (sessao, versao, tmpPdf) => {
    await recusaEmissao(sessao, versao, tmpPdf);
  });
  await servidorIsolado("ausente", path.join(base, "assinatura-ausente.png"), null, async (sessao, versao, tmpPdf) => {
    await recusaEmissao(sessao, versao, tmpPdf);
  });

  assert(hashArquivo(asset) === hashAsset, "arquivo original da assinatura");
  const depois = assinaturaReal();
  assert(depois.hash === antes.hash && depois.n === antes.n && JSON.stringify(depois.pagamentos) === JSON.stringify(antes.pagamentos) && depois.migracoes.indexOf("004_documentos_versoes.sql") === -1, "banco real alterado");
  console.log(JSON.stringify({ ok: true, conferencia: conferencia, orcamentos: depois.n }));
}

async function recusaEmissao(sessao, versao, tmpPdf) {
  const previa = await pedir("GET", "/api/documentos/versoes/" + versao.id + "/previa", { cookie: sessao.cookie });
  assert(previa.status === 500, "prévia recusada " + previa.status);
  const emissao = await pedir("POST", "/api/documentos/versoes/" + versao.id + "/emitir", Object.assign({
    body: { revisao: versao.revisao, chave: "correcao-assinatura-falha1" }
  }, sessao));
  assert(emissao.status === 500 && emissao.body.toString().indexOf("Nenhuma versão foi emitida") !== -1, "emissão recusada");
  const consulta = json(await pedir("GET", "/api/documentos/versoes/" + versao.id, { cookie: sessao.cookie }));
  assert(consulta.versao.estado === "rascunho" && !consulta.versao.pdf_caminho, "rascunho preservado");
  assert(fs.readdirSync(tmpPdf).length === 0, "nenhum pdf incompleto");
}

async function servidorIsolado(nome, arquivo, conteudo, verificar) {
  if (conteudo) fs.writeFileSync(arquivo, conteudo);
  else fs.rmSync(arquivo, { force: true });
  const tmpDb = path.join(base, nome + ".sqlite");
  const tmpPdf = path.join(base, "pdf-" + nome);
  fs.mkdirSync(tmpPdf, { recursive: true });
  const servidor = subir(tmpDb, tmpPdf, {
    CANDYLI_TESTE_ISOLADO: "1",
    CANDYLI_ASSINATURA_ARQUIVO: arquivo
  });
  await servidor.pronto;
  try {
    const sessao = await sessaoAdmin(tmpDb);
    const versao = await prepararContrato(tmpDb, sessao, 980600);
    await verificar(sessao, versao, tmpPdf);
  } finally {
    servidor.servidor.kill();
  }
}

async function conferirTela(sessao, documentoId) {
  fs.writeFileSync(path.join(conferencia, "ver.html"), `<!DOCTYPE html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#fff}canvas{display:block}</style></head><body><canvas id="c"></canvas>
<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"><\/script><script>
var params=new URLSearchParams(location.search);
pdfjsLib.GlobalWorkerOptions.workerSrc="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
pdfjsLib.getDocument(params.get("arquivo")).promise.then(function(pdf){
  return pdf.getPage(Number(params.get("pagina")||1)).then(function(page){
    var viewport=page.getViewport({scale:1.4});
    var canvas=document.getElementById("c");
    canvas.width=viewport.width; canvas.height=viewport.height;
    return page.render({canvasContext:canvas.getContext("2d"),viewport:viewport}).promise.then(function(){document.title="pronto "+pdf.numPages;});
  });
}).catch(function(erro){document.title="erro "+erro;});
<\/script></body></html>`);
  const estatico = http.createServer((req, res) => {
    const nome = decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/, "");
    const arquivo = path.resolve(conferencia, nome);
    if (!arquivo.startsWith(path.resolve(conferencia)) || !fs.existsSync(arquivo)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "Content-Type": path.extname(arquivo) === ".pdf" ? "application/pdf" : "text/html; charset=utf-8" });
    fs.createReadStream(arquivo).pipe(res);
  });
  await new Promise((resolve) => estatico.listen(3282, "127.0.0.1", resolve));
  const perfil = path.join(base, "chrome");
  const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-first-run", "--remote-debugging-port=9425", "--user-data-dir=" + perfil, "about:blank"], { stdio: "ignore" });
  try {
    await new Promise((resolve, reject) => {
      const inicio = Date.now();
      const timer = setInterval(() => {
        http.get("http://127.0.0.1:9425/json/version", (res) => {
          res.resume();
          if (res.statusCode === 200) { clearInterval(timer); resolve(); }
        }).on("error", () => { if (Date.now() - inicio > 8000) { clearInterval(timer); reject(new Error("chrome")); } });
      }, 200);
    });
    const alvos = await new Promise((resolve, reject) => {
      http.get("http://127.0.0.1:9425/json/list", (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))));
      }).on("error", reject);
    });
    const ws = new WebSocket(alvos.find((item) => item.type === "page").webSocketDebuggerUrl);
    await new Promise((resolve) => { ws.onopen = resolve; });
    const pendentes = new Map();
    let comando = 1;
    ws.onmessage = (evento) => {
      const mensagem = JSON.parse(evento.data);
      const espera = pendentes.get(mensagem.id);
      if (!espera) return;
      pendentes.delete(mensagem.id);
      if (mensagem.error) espera.reject(new Error(JSON.stringify(mensagem.error)));
      else espera.resolve(mensagem.result || {});
    };
    function enviar(method, params) {
      const id = comando++;
      return new Promise((resolve, reject) => {
        pendentes.set(id, { resolve: resolve, reject: reject });
        ws.send(JSON.stringify({ id: id, method: method, params: params || {} }));
      });
    }
    async function avaliar(expressao) {
      const inicio = Date.now();
      while (Date.now() - inicio < 12000) {
        const saida = await enviar("Runtime.evaluate", { expression: expressao, returnByValue: true });
        if (saida.result && saida.result.value) return saida.result.value;
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
      throw new Error("tela: " + expressao);
    }
    async function foto(nome) {
      const imagem = await enviar("Page.captureScreenshot", { format: "png" });
      fs.writeFileSync(path.join(conferencia, nome), Buffer.from(imagem.data, "base64"));
    }
    const token = decodeURIComponent(sessao.cookie.split("=").slice(1).join("="));
    await enviar("Network.setCookie", { name: "cl_sessao", value: token, url: "http://127.0.0.1:" + PORT + "/", httpOnly: true });
    await enviar("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    await enviar("Page.navigate", { url: "http://127.0.0.1:" + PORT + "/admin/gestao/documentos.html" });
    const intro = await avaliar("document.body.innerText.indexOf('Emitir PDF cria uma versão oficial') !== -1 && document.body.innerText.indexOf('próxima etapa') === -1 && document.querySelector('[data-abrir=\"" + documentoId + "\"]') ? 'ok' : ''");
    assert(intro === "ok", "texto da página");
    await foto("documentos-desktop.png");
    await enviar("Runtime.evaluate", { expression: "document.querySelector('[data-abrir=\"" + documentoId + "\"]').click()", returnByValue: true });
    await avaliar("document.getElementById('documentos-detalhe') && document.getElementById('documentos-detalhe').hidden === false ? 'ok' : ''");
    await enviar("Runtime.evaluate", { expression: "document.getElementById('documentos-comparar-b').selectedIndex = document.getElementById('documentos-comparar-b').options.length - 1; document.getElementById('documentos-comparar').click()", returnByValue: true });
    const comparacao = await avaliar("var p=document.getElementById('documentos-comparacao'); p && p.hidden===false && p.innerText.indexOf('[object Object]')===-1 && p.innerText.indexOf('Cobertura')!==-1 && p.innerText.indexOf('Etapa 1')!==-1 && p.innerHTML.indexOf('<script')===-1 && p.innerHTML.indexOf('&lt;script&gt;')!==-1 ? p.innerText : ''");
    assert(String(comparacao).indexOf("Forminhas") !== -1, "comparação legível");
    await enviar("Runtime.evaluate", { expression: "document.getElementById('documentos-comparacao').scrollIntoView()", returnByValue: true });
    await foto("comparacao.png");
    await enviar("Emulation.setDeviceMetricsOverride", { width: 768, height: 1024, deviceScaleFactor: 1, mobile: true });
    await enviar("Page.navigate", { url: "http://127.0.0.1:" + PORT + "/admin/gestao/documentos.html" });
    const tablet = await avaliar("document.querySelector('[data-abrir]') && document.querySelector('.gestao-sidebar').getBoundingClientRect().right <= 1 && document.documentElement.scrollWidth <= window.innerWidth + 24 ? 'ok' : ''");
    assert(tablet === "ok", "tablet");
    await enviar("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    const celular = await avaliar("document.documentElement.scrollWidth <= window.innerWidth + 24 ? 'ok' : ''");
    assert(celular === "ok", "celular");
    await foto("documentos-celular.png");
    await enviar("Emulation.setDeviceMetricsOverride", { width: 900, height: 1300, deviceScaleFactor: 1, mobile: false });
    await enviar("Page.navigate", { url: "http://127.0.0.1:3282/ver.html?arquivo=contrato-assinatura.pdf&pagina=4" });
    const titulo = await avaliar("document.title.indexOf('pronto') === 0 ? document.title : ''");
    assert(titulo === "pronto 4", "render " + titulo);
    const imagem = await enviar("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
    fs.writeFileSync(path.join(conferencia, "contrato-assinatura-p4.png"), Buffer.from(imagem.data, "base64"));
    ws.close();
  } finally {
    chrome.kill();
    estatico.close();
  }
}

main().catch((e) => {
  console.error(e && e.stack ? e.stack : e);
  process.exitCode = 1;
});
