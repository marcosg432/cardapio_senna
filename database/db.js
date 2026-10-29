/**
 * SQLite embutido — arquivo em database/database.sqlite
 * Usa o módulo nativo node:sqlite (Node.js ≥ 22.13, sem dependências npm).
 * Migrations: database/migrations/*.sql (ordenado por nome)
 */
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const DB_DIR = __dirname;
const DB_PATH = process.env.DATABASE_PATH
  ? path.resolve(process.env.DATABASE_PATH)
  : path.join(DB_DIR, 'database.sqlite');
const MIGRATIONS_DIR = path.join(DB_DIR, 'migrations');

/**
 * Migrações nesta lista não rodam no start do servidor.
 * O teste autoriza uma delas com MIGRACOES_AUTORIZADAS=004_documentos_versoes.sql
 * e um DATABASE_PATH temporário. Sem essa variável, o banco real permanece intacto.
 */
const MIGRACOES_SUSPENSAS = {
  '004_documentos_versoes.sql': true
};

function migracaoSuspensa(file) {
  if (!MIGRACOES_SUSPENSAS[file]) return false;
  const autorizadas = String(process.env.MIGRACOES_AUTORIZADAS || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return autorizadas.indexOf(file) === -1;
}

function runMigrations(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY
    );
  `);
  const doneStmt = db.prepare('SELECT 1 AS ok FROM schema_migrations WHERE name = ?');
  const markStmt = db.prepare('INSERT INTO schema_migrations (name) VALUES (?)');

  if (!fs.existsSync(MIGRATIONS_DIR)) {
    fs.mkdirSync(MIGRATIONS_DIR, { recursive: true });
  }
  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    if (doneStmt.get(file)) continue;
    if (migracaoSuspensa(file)) {
      console.warn('Migração suspensa, não aplicada: ' + file);
      continue;
    }
    const full = path.join(MIGRATIONS_DIR, file);
    const sql = fs.readFileSync(full, 'utf8');
    db.exec(sql);
    markStmt.run(file);
  }
}

let _db;

function getDb() {
  if (!_db) {
    if (!fs.existsSync(DB_DIR)) {
      fs.mkdirSync(DB_DIR, { recursive: true });
    }
    _db = new DatabaseSync(DB_PATH);
    _db.exec('PRAGMA journal_mode = WAL;');
    _db.exec('PRAGMA foreign_keys = ON;');
    _db.exec('PRAGMA busy_timeout = 5000;');
    runMigrations(_db);
  }
  return _db;
}

function closeDb() {
  if (_db) {
    _db.close();
    _db = null;
  }
}

module.exports = { getDb, closeDb, DB_PATH };
