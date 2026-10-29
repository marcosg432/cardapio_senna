/**
 * Versões de documentos e bloqueio de contrato confirmado.
 * Usa banco temporário. Não grava no SQLite real.
 */
const { spawn } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const bcrypt = require("bcryptjs");
const { DatabaseSync } = require("node:sqlite");

const PORT = 3263;
const SENHA = "senha-de-teste-local";
const root = path.join(__dirname, "..");
const realDb = path.join(root, "database", "database.sqlite");
const tmpDb = path.join(os.tmpdir(), "candyli-docs-" + Date.now() + ".sqlite");
const tmpHttp = path.join(os.tmpdir(), "candyli-docs-http-" + Date.now() + ".sqlite");
const tmpDown = path.join(os.tmpdir(), "candyli-docs-down-" + Date.now() + ".sqlite");
const tmpSem = path.join(os.tmpdir(), "candyli-docs-sem-" + Date.now() + ".sqlite");
const tmpPdf = path.join(os.tmpdir(), "candyli-docs-pdf-" + Date.now());

if (path.resolve(tmpDb) === path.resolve(realDb)) {
  throw new Error("recusa banco real");
}
process.env.DATABASE_PATH = tmpDb;
process.env.MIGRACOES_AUTORIZADAS = "004_documentos_versoes.sql";
process.env.DOCUMENTOS_DIR = tmpPdf;
process.env.COOKIE_SECURE = "0";

const { getDb, closeDb, DB_PATH } = require("../database/db");
const documentos = require("../database/repositories/documentosRepository");

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function assinaturaReal() {
  const db = new DatabaseSync(realDb, { readOnly: true });
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

function filho(arquivo, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [arquivo], {
      cwd: root,
      env: Object.assign({}, process.env, env || {}),
      stdio: ["ignore", "pipe", "pipe"]
    });
    let saida = "";
    child.stdout.on("data", (buf) => { saida += buf.toString(); });
    child.stderr.on("data", (buf) => { saida += buf.toString(); });
    child.on("exit", (code) => {
      if (code === 0) resolve(saida);
      else reject(new Error("filho " + code + "\n" + saida));
    });
  });
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
      res.on("end", () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks)
      }));
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

async function main() {
  assert(path.resolve(DB_PATH) === path.resolve(tmpDb), "DATABASE_PATH apontou para outro arquivo");
  const antes = assinaturaReal();
  assert(antes.ic === "ok" && antes.n >= 4, "banco real");
  assert(antes.migracoes.indexOf("004_documentos_versoes.sql") === -1, "004 já está no banco real");
  assert(antes.pagamentos.length === 1 && antes.pagamentos[0].valor_centavos === 200000, "pagamento real");

  const scriptSem = path.join(os.tmpdir(), "candyli-docs-sem-" + Date.now() + ".js");
  fs.writeFileSync(scriptSem, `
    const { getDb, closeDb } = require(${JSON.stringify(path.join(root, "database/db.js"))});
    const db = getDb();
    const tabela = db.prepare("SELECT name FROM sqlite_master WHERE name = 'documentos'").get();
    const mig = db.prepare("SELECT name FROM schema_migrations").all().map((row) => row.name);
    if (tabela) process.exit(2);
    if (mig.indexOf("004_documentos_versoes.sql") !== -1) process.exit(3);
    if (mig.indexOf("003_financeiro.sql") === -1) process.exit(4);
    closeDb();
  `);
  await filho(scriptSem, { DATABASE_PATH: tmpSem, MIGRACOES_AUTORIZADAS: "" });

  const scriptDown = path.join(os.tmpdir(), "candyli-docs-down-" + Date.now() + ".js");
  fs.writeFileSync(scriptDown, `
    const fs = require("fs");
    const { getDb, closeDb } = require(${JSON.stringify(path.join(root, "database/db.js"))});
    const { DatabaseSync } = require("node:sqlite");
    getDb();
    closeDb();
    const db = new DatabaseSync(process.env.DATABASE_PATH);
    db.exec("PRAGMA foreign_keys = ON");
    db.exec(fs.readFileSync(${JSON.stringify(path.join(root, "database/migrations/down/004_documentos_versoes.sql"))}, "utf8"));
    const tabela = db.prepare("SELECT name FROM sqlite_master WHERE name = 'documentos'").get();
    const mig = db.prepare("SELECT name FROM schema_migrations WHERE name = '004_documentos_versoes.sql'").get();
    const ic = db.prepare("PRAGMA integrity_check").get().integrity_check;
    const tres = db.prepare("SELECT name FROM schema_migrations WHERE name = '003_financeiro.sql'").get();
    if (tabela || mig || ic !== "ok" || !tres) process.exit(2);
    db.close();
  `);
  await filho(scriptDown, {
    DATABASE_PATH: tmpDown,
    MIGRACOES_AUTORIZADAS: "004_documentos_versoes.sql"
  });

  const db = getDb();
  assert(db.prepare("PRAGMA integrity_check").get().integrity_check === "ok", "integridade temporária");
  assert(db.prepare("SELECT name FROM schema_migrations WHERE name = '004_documentos_versoes.sql'").get(), "004 não aplicou no temporário");
  db.prepare("INSERT INTO admin_usuarios (usuario, senha_hash) VALUES (?, ?)").run("admin", bcrypt.hashSync(SENHA, 12));
  const usuario = db.prepare("SELECT id FROM admin_usuarios WHERE usuario = 'admin'").get();
  const payload = JSON.stringify({
    id: 960010,
    cliente: "Cliente Documento",
    itens: [{ nome: "Brigadeiro", quantidade: 50, unidade: "unidade", preco: 2 }]
  });
  db.prepare("INSERT INTO orcamentos (id, payload, created_at, updated_at) VALUES (?, ?, ?, ?)").run(
    960010, payload, "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z"
  );

  const criado = documentos.criarDocumento({ tipo: "producao_evento", orcamentoId: 960010 });
  assert(criado.status === 201 && criado.documento.tipo === "producao_evento", "criar documento");
  const repetido = documentos.criarDocumento({ tipo: "producao_evento", orcamentoId: 960010 });
  assert(repetido.status === 200 && repetido.repetido === true && repetido.documento.id === criado.documento.id, "documento repetido");
  assert(documentos.criarDocumento({ tipo: "desconhecido" }).status === 400, "tipo inválido");
  const dia = documentos.criarDocumento({ tipo: "producao_dia", data: "2026-02-31" });
  assert(dia.status === 400, "data inválida");
  const diaOk = documentos.criarDocumento({ tipo: "producao_dia", data: "2026-12-01" });
  assert(diaOk.status === 201 && diaOk.documento.orcamento_id === null, "produção do dia");

  const rascunho = documentos.criarRascunho({
    documentoId: criado.documento.id,
    usuarioId: usuario.id,
    motivo: "Planejamento inicial da cozinha",
    conteudo: { contratado: [{ nome: "Brigadeiro", quantidade: 50 }], operacional: { responsavel: "Ana" } }
  });
  assert(rascunho.status === 201 && rascunho.versao.numero === 1 && rascunho.versao.estado === "rascunho", "rascunho");
  assert(documentos.criarRascunho({
    documentoId: criado.documento.id,
    usuarioId: usuario.id,
    motivo: "Segundo rascunho indevido",
    conteudo: { contratado: [] }
  }).status === 409, "dois rascunhos");

  const editado = documentos.atualizarRascunho({
    versaoId: rascunho.versao.id,
    revisao: 1,
    motivo: "Incluir instrução de montagem",
    conteudo: { contratado: [{ nome: "Brigadeiro", quantidade: 50 }], operacional: { responsavel: "Ana", montagem: "Bandeja" } }
  });
  assert(editado.status === 200 && editado.versao.revisao === 2, "editar rascunho");
  const conflito = documentos.atualizarRascunho({
    versaoId: rascunho.versao.id,
    revisao: 1,
    motivo: "Aba antiga",
    conteudo: { contratado: [{ nome: "Brigadeiro", quantidade: 1 }] }
  });
  assert(conflito.status === 409 && conflito.motivo === "revisao", "conflito de revisão");
  assert(documentos.consultarRascunho(criado.documento.id).versao.conteudo.operacional.montagem === "Bandeja", "aba antiga sobrescreveu");
  assert(documentos.consultarRascunho(criado.documento.id).versao.conteudo.contratado[0].quantidade === 50, "quantidade do rascunho");

  const pdf = Buffer.from("%PDF-1.4 ficha de teste");
  const chave = "chave-documentos-0001";
  const emissao = documentos.emitir({
    versaoId: rascunho.versao.id,
    revisao: 2,
    chave: chave,
    pdf: pdf
  });
  assert(emissao.status === 201 && emissao.versao.estado === "emitida" && emissao.versao.numero === 1, "emissão");
  const deNovo = documentos.emitir({ versaoId: rascunho.versao.id, revisao: 2, chave: chave, pdf: pdf });
  assert(deNovo.status === 200 && deNovo.repetida === true && deNovo.versao.id === emissao.versao.id, "idempotência");
  const integridade = documentos.validarHash(emissao.versao.id);
  assert(integridade.snapshot === true && integridade.pdf === true, "hash");
  let imutavel = false;
  try {
    db.prepare("UPDATE documento_versoes SET motivo = 'troca' WHERE id = ?").run(emissao.versao.id);
  } catch (e) {
    imutavel = /imutavel/.test(String(e.message || ""));
  }
  assert(imutavel, "versão emitida foi alterada");
  let apagou = false;
  try {
    db.prepare("DELETE FROM documento_versoes WHERE id = ?").run(emissao.versao.id);
  } catch (e) {
    apagou = /historico/.test(String(e.message || ""));
  }
  assert(apagou, "versão emitida foi apagada");

  const segundo = documentos.criarRascunho({
    documentoId: criado.documento.id,
    usuarioId: usuario.id,
    motivo: "Revisão operacional",
    conteudo: { contratado: [{ nome: "Brigadeiro", quantidade: 50 }], operacional: { responsavel: "Lia" } }
  });
  assert(segundo.status === 201 && segundo.versao.numero === 2 && segundo.versao.versao_anterior_id === emissao.versao.id, "segunda versão");
  const outraChave = documentos.emitir({
    versaoId: segundo.versao.id,
    revisao: 1,
    chave: chave,
    pdf: Buffer.from("%PDF-1.4 outro")
  });
  assert(outraChave.status === 409 && outraChave.motivo === "chave", "chave reutilizada");
  const comparacao = documentos.comparar(emissao.versao.id, segundo.versao.id);
  assert(comparacao.status === 200 && comparacao.iguais === false, "comparação");
  assert(comparacao.alteracoes.some((item) => item.caminho === "operacional.responsavel" && item.antes === "Ana" && item.depois === "Lia"), "diferença");

  const descarte = documentos.descartarRascunho({
    versaoId: segundo.versao.id,
    revisao: 1,
    motivo: "Rascunho substituído"
  });
  assert(descarte.status === 200 && descarte.versao.estado === "descartado", "descarte");
  const historia = documentos.historico(criado.documento.id);
  assert(historia.versoes.length === 2 && historia.versoes[1].estado === "descartado", "histórico");
  assert(db.prepare("SELECT payload FROM orcamentos WHERE id = 960010").get().payload === payload, "payload alterado pelo versionamento");

  closeDb();

  let servidor;
  await new Promise((resolve, reject) => {
    servidor = spawn(process.execPath, ["server.js"], {
      cwd: root,
      env: Object.assign({}, process.env, {
        PORT: String(PORT),
        DATABASE_PATH: tmpHttp,
        MIGRACOES_AUTORIZADAS: "",
        COOKIE_SECURE: "0"
      }),
      stdio: ["ignore", "pipe", "pipe"]
    });
    let saida = "";
    const timer = setTimeout(() => reject(new Error("servidor não subiu\n" + saida)), 8000);
    servidor.stdout.on("data", (buf) => {
      saida += buf.toString();
      if (saida.indexOf("localhost:" + PORT) !== -1) {
        clearTimeout(timer);
        resolve();
      }
    });
    servidor.stderr.on("data", (buf) => { saida += buf.toString(); });
  });

  const httpDb = new DatabaseSync(tmpHttp);
  httpDb.prepare("INSERT INTO admin_usuarios (usuario, senha_hash) VALUES (?, ?)").run("admin", bcrypt.hashSync(SENHA, 12));
  httpDb.close();

  const pedido = {
    id: 960021,
    cliente: "Cliente Cardapio",
    nome_cliente: "Cliente Cardapio",
    data_evento: "2026-12-01",
    tipo_evento: "Aniversário",
    itens: [{ nome: "Brigadeiro", quantidade: 50, unidade: "unidade", preco: 2, preco_unitario: 2, subtotal: 100 }],
    valor_original: 100,
    valor_final: 100,
    total: 100,
    status: "novo_orcamento"
  };
  const novo = await pedir("POST", "/api/orcamentos", { body: pedido });
  assert(novo.status === 201, "cardápio " + novo.status);
  assert(!JSON.parse(novo.body.toString()).gestao_contrato, "cardápio confirmou");
  const repetir = await pedir("POST", "/api/orcamentos", { body: Object.assign({}, pedido, { cliente: "Outro nome" }) });
  assert(repetir.status === 409, "sobrescrita pública " + repetir.status);

  const semSessao = await pedir("PATCH", "/api/orcamentos/960021", { body: { observacoes: "x" } });
  assert(semSessao.status === 401, "patch sem sessão");
  const login = await pedir("POST", "/api/auth/login", { body: { senha: SENHA } });
  const cookie = String(login.headers["set-cookie"]).split(";")[0];
  const csrf = JSON.parse(login.body.toString()).csrfToken;
  const semCsrf = await pedir("PATCH", "/api/orcamentos/960021", { cookie: cookie, body: { observacoes: "x" } });
  assert(semCsrf.status === 403, "patch sem CSRF");
  const editavel = await pedir("PATCH", "/api/orcamentos/960021", {
    cookie: cookie,
    csrf: csrf,
    body: { itens: [{ nome: "Brigadeiro", quantidade: 60, unidade: "unidade", preco: 2, preco_unitario: 2, subtotal: 120 }], valor_final: 120, total: 120, valor_original: 120 }
  });
  assert(editavel.status === 200, "orçamento aberto " + editavel.status);

  const confirmar = await pedir("POST", "/api/orcamentos/960021/confirmar-contrato", { cookie: cookie, csrf: csrf, body: {} });
  assert(confirmar.status === 200, "confirmar " + confirmar.status);
  const bloqueio = await pedir("PATCH", "/api/orcamentos/960021", {
    cookie: cookie,
    csrf: csrf,
    body: { itens: [{ nome: "Brigadeiro", quantidade: 70, unidade: "unidade", preco: 2, preco_unitario: 2, subtotal: 140 }] }
  });
  assert(bloqueio.status === 409, "contrato confirmado " + bloqueio.status);
  const nota = await pedir("PATCH", "/api/orcamentos/960021", {
    cookie: cookie,
    csrf: csrf,
    body: { observacoes_internas: "Nota interna da cozinha" }
  });
  assert(nota.status === 200, "nota interna " + nota.status);
  const forjado = await pedir("PATCH", "/api/orcamentos/960021", {
    cookie: cookie,
    csrf: csrf,
    body: { gestao_contrato: { status: "confirmado", confirmado_em: "1999-01-01T00:00:00.000Z" } }
  });
  assert(forjado.status === 409, "confirmação forjada");

  const leitura = new DatabaseSync(tmpHttp, { readOnly: true });
  const gravado = JSON.parse(leitura.prepare("SELECT payload FROM orcamentos WHERE id = 960021").get().payload);
  const financeiro = leitura.prepare("SELECT valor_contratado_centavos FROM financeiro_contratos WHERE orcamento_id = 960021").get();
  const pagamentos = leitura.prepare("SELECT COUNT(*) AS n FROM pagamentos").get().n;
  leitura.close();
  assert(gravado.itens[0].quantidade === 60, "quantidade confirmada mudou");
  assert(gravado.observacoes_internas === "Nota interna da cozinha", "nota não gravou");
  assert(financeiro.valor_contratado_centavos === 12000, "congelamento " + JSON.stringify(financeiro));
  assert(pagamentos === 0, "pagamento indevido");
  assert(gravado.gestao_contrato.confirmado_em.indexOf("1999") === -1, "confirmação alterada");

  const producao = await pedir("GET", "/api/producao/eventos/960021", { cookie: cookie });
  assert(producao.status === 200 && producao.body.toString().indexOf("60") !== -1, "produção");
  const pdfFinanceiro = await pedir("GET", "/api/financeiro/contratos/960021/demonstrativo", { cookie: cookie });
  assert(pdfFinanceiro.status === 200 && pdfFinanceiro.headers["content-type"].indexOf("application/pdf") === 0, "demonstrativo");
  const contratoJs = await pedir("GET", "/js/contrato-pdf.js");
  const orcamentoJs = await pedir("GET", "/js/orcamento-pdf.js");
  assert(contratoJs.body.toString().indexOf("gerarContratoPDF") !== -1, "pdf de contrato");
  assert(orcamentoJs.body.toString().indexOf("gerarOrcamentoPropostaPDF") !== -1, "pdf de orçamento");

  servidor.kill();
  const depois = assinaturaReal();
  assert(depois.ic === "ok" && depois.hash === antes.hash && depois.n === antes.n, "payloads reais");
  assert(JSON.stringify(depois.pagamentos) === JSON.stringify(antes.pagamentos), "pagamentos reais");
  assert(JSON.stringify(depois.confirmados) === JSON.stringify(antes.confirmados), "confirmações reais");
  assert(JSON.stringify(depois.migracoes) === JSON.stringify(antes.migracoes), "migrações reais");
  assert(depois.migracoes.indexOf("004_documentos_versoes.sql") === -1, "004 aplicado no real");
  console.log(JSON.stringify({ ok: true, orcamentos: depois.n, hash: depois.hash }));
}

main().catch((e) => {
  console.error(e && e.stack ? e.stack : e);
  process.exitCode = 1;
});
