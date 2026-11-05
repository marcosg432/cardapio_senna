/**
 * A migração 004 entra sozinha num banco novo e não é reaplicada.
 * Usa só SQLite temporário. Não grava no banco do projeto.
 */
const { spawn } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.join(__dirname, "..");
const realDb = path.join(root, "database", "database.sqlite");
const base = path.join(os.tmpdir(), "candyli-migracao-004-" + Date.now());
const tmpDb = path.join(base, "novo.sqlite");
const tmpFalha = path.join(base, "falha.sqlite");
const migracoesFalha = path.join(base, "migrations");

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function hashArquivo(arquivo) {
  if (!fs.existsSync(arquivo)) return null;
  return crypto.createHash("sha256").update(fs.readFileSync(arquivo)).digest("hex");
}

function assinaturaReal() {
  return {
    db: hashArquivo(realDb),
    wal: hashArquivo(realDb + "-wal"),
    shm: hashArquivo(realDb + "-shm")
  };
}

function aguardar(proc) {
  return new Promise((resolve) => {
    let saida = "";
    proc.stdout.on("data", (buf) => { saida += buf.toString(); });
    proc.stderr.on("data", (buf) => { saida += buf.toString(); });
    proc.on("exit", (code) => resolve({ code: code, saida: saida }));
  });
}

async function main() {
  const antes = assinaturaReal();
  fs.rmSync(base, { recursive: true, force: true });
  fs.mkdirSync(base, { recursive: true });
  process.env.DATABASE_PATH = tmpDb;
  delete process.env.MIGRATIONS_DIR;
  const { getDb, closeDb } = require("../database/db");
  const db = getDb();
  assert(db.prepare("SELECT name FROM sqlite_master WHERE name = 'documentos'").get(), "banco novo sem documentos");
  assert(db.prepare("SELECT name FROM sqlite_master WHERE name = 'documento_versoes'").get(), "banco novo sem versões");
  assert(db.prepare("SELECT COUNT(*) AS n FROM schema_migrations WHERE name = '004_documentos_versoes.sql'").get().n === 1, "004 repetida no banco novo");
  assert(db.prepare("SELECT name FROM schema_migrations WHERE name = '003_financeiro.sql'").get(), "003 ausente");
  const payload = JSON.stringify({
    id: 770001,
    cliente: "Registro Preservado",
    itens: [{ nome: "Brigadeiro", quantidade: 50 }]
  });
  db.prepare("INSERT INTO orcamentos (id, payload, created_at, updated_at) VALUES (?, ?, ?, ?)").run(
    770001, payload, "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z"
  );
  closeDb();

  const reaberto = getDb();
  const guardado = reaberto.prepare("SELECT payload FROM orcamentos WHERE id = 770001").get();
  assert(guardado && guardado.payload === payload, "reabrir apagou o registro");
  assert(reaberto.prepare("SELECT COUNT(*) AS n FROM schema_migrations WHERE name = '004_documentos_versoes.sql'").get().n === 1, "004 reaplicada");
  reaberto.exec("DROP TABLE documentos");
  closeDb();
  let inconsistencia = null;
  try { getDb(); } catch (e) { inconsistencia = e; }
  assert(inconsistencia && inconsistencia.code === "migracao", "inconsistencia silenciosa");
  assert(inconsistencia.message.indexOf("004_documentos_versoes.sql") !== -1, "aviso sem a migracao");
  assert(inconsistencia.message.indexOf("documentos") !== -1, "aviso sem a tabela");
  const { DatabaseSync } = require("node:sqlite");
  const conferida = new DatabaseSync(tmpDb, { readOnly: true });
  assert(!conferida.prepare("SELECT name FROM sqlite_master WHERE name = 'documentos'").get(), "tabela recriada");
  assert(conferida.prepare("SELECT name FROM sqlite_master WHERE name = 'documento_versoes'").get(), "versões removidas");
  assert(conferida.prepare("SELECT COUNT(*) AS n FROM schema_migrations WHERE name = '004_documentos_versoes.sql'").get().n === 1, "registro da 004 mudou");
  assert(conferida.prepare("SELECT payload FROM orcamentos WHERE id = 770001").get().payload === payload, "registro sumiu");
  conferida.close();
  const aviso = spawn(process.execPath, ["server.js"], {
    cwd: root,
    env: Object.assign({}, process.env, {
      PORT: "3348",
      DATABASE_PATH: tmpDb,
      COOKIE_SECURE: "0"
    }),
    stdio: ["ignore", "pipe", "pipe"]
  });
  const avisoFim = await aguardar(aviso);
  assert(avisoFim.code === 1, "servidor ignorou a inconsistencia " + avisoFim.code + "\n" + avisoFim.saida);
  assert(avisoFim.saida.indexOf("004_documentos_versoes.sql") !== -1 && avisoFim.saida.indexOf("documentos") !== -1, "servidor sem aviso\n" + avisoFim.saida);
  const depoisAviso = new DatabaseSync(tmpDb, { readOnly: true });
  assert(!depoisAviso.prepare("SELECT name FROM sqlite_master WHERE name = 'documentos'").get(), "servidor recriou a tabela");
  assert(depoisAviso.prepare("SELECT payload FROM orcamentos WHERE id = 770001").get().payload === payload, "servidor alterou o registro");
  depoisAviso.close();

  fs.cpSync(path.join(root, "database", "migrations"), migracoesFalha, { recursive: true });
  fs.writeFileSync(path.join(migracoesFalha, "005_falha.sql"), "SELECT * FROM tabela_que_nao_existe_004;\n");
  const servidor = spawn(process.execPath, ["server.js"], {
    cwd: root,
    env: Object.assign({}, process.env, {
      PORT: "3347",
      DATABASE_PATH: tmpFalha,
      MIGRATIONS_DIR: migracoesFalha,
      COOKIE_SECURE: "0"
    }),
    stdio: ["ignore", "pipe", "pipe"]
  });
  const fim = await aguardar(servidor);
  assert(fim.code === 1, "falha de migração subiu o servidor " + fim.code + "\n" + fim.saida);
  assert(fim.saida.indexOf("005_falha.sql") !== -1, "falha sem nome do arquivo\n" + fim.saida);
  const leitura = new DatabaseSync(tmpFalha, { readOnly: true });
  assert(leitura.prepare("SELECT name FROM schema_migrations WHERE name = '004_documentos_versoes.sql'").get(), "004 não ficou registrada antes da falha");
  assert(!leitura.prepare("SELECT name FROM schema_migrations WHERE name = '005_falha.sql'").get(), "migração com falha foi registrada");
  assert(leitura.prepare("SELECT name FROM sqlite_master WHERE name = 'documentos'").get(), "tabelas anteriores sumiram");
  leitura.close();

  const depois = assinaturaReal();
  assert(JSON.stringify(antes) === JSON.stringify(depois), "banco real alterado");
  console.log(JSON.stringify({ ok: true, novo: true, reaplicacao: false, falha: "005_falha.sql", bancoReal: "intacto" }));
}

main()
  .catch((e) => { console.error(e && e.stack ? e.stack : e); process.exitCode = 1; })
  .finally(() => {
    fs.rmSync(base, { recursive: true, force: true });
  });
