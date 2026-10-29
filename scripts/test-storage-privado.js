/**
 * Bloqueio do storage estático e download autenticado.
 * O banco real é só lido. Os PDFs de teste ficam num diretório temporário.
 */
const { spawn } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const bcrypt = require("bcryptjs");
const { DatabaseSync } = require("node:sqlite");

const PORT = 3299;
const SENHA = "senha-de-teste-local";
const root = path.join(__dirname, "..");
const realDb = path.join(root, "database", "database.sqlite");
const base = path.join(os.tmpdir(), "candyli-storage-privado-" + Date.now());
const tmpDb = path.join(base, "banco.sqlite");
const tmpPdf = path.join(base, "pdfs");
const MARCADOR = "MARCADOR-PRIVADO-STORAGE";
const pastaStorage = path.join(root, "storage", "documentos", "prova");
const arquivoMarcador = path.join(pastaStorage, "marcador.pdf");
const arquivoBak = path.join(root, "pages", "backup-storage-teste.bak");
const atalho = path.join(root, "pages", "atalho-storage-teste.pdf");
let servidor;
let storageCriado = false;

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function censoReal() {
  const db = new DatabaseSync(realDb, { readOnly: true });
  const rows = db.prepare("SELECT id, payload FROM orcamentos ORDER BY id").all();
  const pagamentos = db.prepare("SELECT id, orcamento_id, valor_centavos, pago_em, forma, criado_em FROM pagamentos ORDER BY id").all();
  db.close();
  return {
    n: rows.length,
    hash: crypto.createHash("sha256").update(rows.map((row) => row.id + ":" + row.payload).join("|")).digest("hex"),
    pagamentos
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
        Origin: "http://localhost:" + PORT
      }, opcoes.headers || {}, corpo ? { "Content-Type": "application/json", "Content-Length": corpo.length } : {})
    }, (res) => {
      const chunks = [];
      res.on("data", (parte) => chunks.push(parte));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on("error", reject);
    if (corpo) req.write(corpo);
    req.end();
  });
}

function json(resposta) {
  return JSON.parse(resposta.body.toString("utf8") || "null");
}

function limpar() {
  [atalho, arquivoBak, arquivoMarcador].forEach((alvo) => {
    try { fs.unlinkSync(alvo); } catch (e) {
      try { fs.rmSync(alvo, { force: true }); } catch (ignorar) { /* arquivo de prova */ }
    }
  });
  if (storageCriado) {
    try { fs.rmSync(path.join(root, "storage"), { recursive: true, force: true }); } catch (e) { /* pasta de prova */ }
  }
}

async function bloqueado(urlPath, headers) {
  const resposta = await pedir("GET", urlPath, { headers: headers });
  const texto = resposta.body.toString("utf8");
  assert(resposta.status === 404, urlPath + " " + resposta.status);
  assert(texto.indexOf(MARCADOR) === -1, "conteudo exposto em " + urlPath);
  assert(texto.indexOf("SQLite format") === -1, "banco exposto em " + urlPath);
  assert(texto.indexOf("%PDF-") === -1, "pdf exposto em " + urlPath);
}

async function main() {
  const antes = censoReal();
  limpar();
  storageCriado = !fs.existsSync(path.join(root, "storage"));
  fs.mkdirSync(pastaStorage, { recursive: true });
  fs.writeFileSync(arquivoMarcador, MARCADOR);
  fs.writeFileSync(arquivoBak, MARCADOR);
  let atalhoCriado = false;
  try {
    fs.symlinkSync(arquivoMarcador, atalho);
    atalhoCriado = true;
  } catch (e) {
    atalhoCriado = false;
  }

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
  await new Promise((resolve, reject) => {
    const inicio = Date.now();
    const tentar = () => {
      http.get("http://localhost:" + PORT + "/", (res) => {
        res.resume();
        resolve();
      }).on("error", () => {
        if (Date.now() - inicio > 8000) reject(new Error("servidor"));
        else setTimeout(tentar, 150);
      });
    };
    tentar();
  });

  const db = new DatabaseSync(tmpDb);
  db.prepare("INSERT INTO admin_usuarios (usuario, senha_hash) VALUES (?, ?)").run("admin", bcrypt.hashSync(SENHA, 12));
  db.close();

  const criado = await pedir("POST", "/api/orcamentos", {
    body: {
      id: 880301,
      cliente: "Cliente Privado",
      nome_cliente: "Cliente Privado",
      data_evento: "2026-12-20",
      evento_data: "2026-12-20",
      tipo_evento: "Aniversário",
      itens: [{ nome: "Brigadeiro", quantidade: 50, unidade: "unidade", preco: 2, preco_unitario: 2, subtotal: 100 }],
      valor_original: 100,
      valor_final: 100,
      total: 100,
      status: "novo_orcamento"
    }
  });
  assert(criado.status === 201, "orcamento");
  const login = await pedir("POST", "/api/auth/login", { body: { senha: SENHA } });
  assert(login.status === 200, "login");
  const cookie = String(login.headers["set-cookie"]).split(";")[0];
  const csrf = json(login).csrfToken;
  const auth = { Cookie: cookie, "X-CSRF-Token": csrf };
  const documento = json(await pedir("POST", "/api/documentos", {
    headers: auth,
    body: { tipo: "orcamento", orcamentoId: 880301 }
  }));
  const rascunho = json(await pedir("POST", "/api/documentos/" + documento.documento.id + "/rascunho", {
    headers: auth,
    body: { motivo: "Prova de download autenticado" }
  }));
  const emitida = json(await pedir("POST", "/api/documentos/versoes/" + rascunho.versao.id + "/emitir", {
    headers: auth,
    body: { chave: "storage-privado-880301-ok", revisao: rascunho.versao.revisao }
  }));
  assert(emitida.versao.estado === "emitida", "emissao");
  const semLogin = await pedir("GET", "/api/documentos/versoes/" + emitida.versao.id + "/pdf");
  assert(semLogin.status === 401, "api sem login");
  const comLogin = await pedir("GET", "/api/documentos/versoes/" + emitida.versao.id + "/pdf", { headers: { Cookie: cookie } });
  assert(comLogin.status === 200 && comLogin.body.slice(0, 5).toString() === "%PDF-", "api com login");
  const travessia = await pedir("GET", "/api/documentos/versoes/" + emitida.versao.id + "/pdf?caminho=../database/database.sqlite", { headers: { Cookie: cookie } });
  assert(travessia.status === 200 && travessia.body.slice(0, 5).toString() === "%PDF-" && travessia.body.toString("latin1").indexOf("SQLite format") === -1, "caminho do cliente");
  const historico = json(await pedir("GET", "/api/documentos/" + documento.documento.id + "/versoes", { headers: { Cookie: cookie } }));
  assert(historico.versoes.length === 1 && historico.versoes[0].estado === "emitida", "historico");
  const previa = await pedir("GET", "/api/documentos/versoes/" + emitida.versao.id + "/previa", { headers: { Cookie: cookie } });
  assert(previa.status === 200 && previa.body.slice(0, 5).toString() === "%PDF-", "previa");

  const caminhos = [
    "/storage/documentos/prova/marcador.pdf",
    "/Storage/Documentos/prova/marcador.pdf",
    "/storage/documentos/prova/marcador.pdf.bak",
    "/pages/backup-storage-teste.bak",
    "/%73torage/documentos/prova/marcador.pdf",
    "/storage%2Fdocumentos%2Fprova%2Fmarcador.pdf",
    "/storage/../storage/documentos/prova/marcador.pdf",
    "/storage/documentos/prova/..%2F..%2F..%2Fdatabase/database.sqlite",
    "/%252e%252e/storage/documentos/prova/marcador.pdf",
    "/storage\\documentos\\prova\\marcador.pdf"
  ];
  if (atalhoCriado) caminhos.push("/pages/atalho-storage-teste.pdf");
  for (const caminho of caminhos) {
    await bloqueado(caminho);
    await bloqueado(caminho, { Cookie: cookie });
  }
  assert(atalhoCriado, "atalho simbolico");

  const pdfEmitido = path.join(tmpPdf, documento.documento.id + "", emitida.versao.id + ".pdf");
  fs.rmSync(pdfEmitido, { force: true });
  fs.symlinkSync(realDb, pdfEmitido);
  const desvio = await pedir("GET", "/api/documentos/versoes/" + emitida.versao.id + "/pdf", { headers: { Cookie: cookie } });
  assert(desvio.status !== 200 && desvio.body.toString("utf8").indexOf("SQLite format") === -1, "atalho no diretorio privado");

  const cardapio = await pedir("GET", "/");
  assert(cardapio.status === 200 && cardapio.body.toString("utf8").indexOf("Candy Li") !== -1, "cardapio");
  const depois = censoReal();
  assert(JSON.stringify(depois) === JSON.stringify(antes), "banco real");
  process.stdout.write(JSON.stringify({ ok: true, orcamentos: depois.n, hash: depois.hash, atalho: atalhoCriado }));
}

main().catch((erro) => {
  process.stderr.write(erro.stack + "\n");
  process.exitCode = 1;
}).finally(() => {
  if (servidor) servidor.kill();
  limpar();
});
