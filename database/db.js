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
const MIGRATIONS_DIR = process.env.MIGRATIONS_DIR
  ? path.resolve(process.env.MIGRATIONS_DIR)
  : path.join(DB_DIR, 'migrations');

function falhaMigracao(arquivo, causa) {
  const erro = new Error('Migração ' + arquivo + ' falhou: ' + (causa && causa.message ? causa.message : causa));
  erro.code = 'migracao';
  erro.arquivo = arquivo;
  return erro;
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
    throw falhaMigracao(MIGRATIONS_DIR, new Error('pasta de migrações ausente'));
  }
  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    if (doneStmt.get(file)) continue;
    const full = path.join(MIGRATIONS_DIR, file);
    const sql = fs.readFileSync(full, 'utf8');
    try {
      db.exec(sql);
      markStmt.run(file);
    } catch (e) {
      throw falhaMigracao(file, e);
    }
  }
}

let _db;

function conferirEsquemaDocumentos(db) {
  const registrada = db.prepare(
    "SELECT 1 AS ok FROM schema_migrations WHERE name = '004_documentos_versoes.sql'"
  ).get();
  if (!registrada) return;
  const faltando = ['documentos', 'documento_versoes'].filter((nome) => {
    return !db.prepare(
      "SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?"
    ).get(nome);
  });
  if (!faltando.length) return;
  throw falhaMigracao(
    '004_documentos_versoes.sql',
    new Error('registrada sem as tabelas ' + faltando.join(' e '))
  );
}

function getDb() {
  if (!_db) {
    if (!fs.existsSync(DB_DIR)) {
      fs.mkdirSync(DB_DIR, { recursive: true });
    }
    const db = new DatabaseSync(DB_PATH);
    try {
      db.exec('PRAGMA journal_mode = WAL;');
      db.exec('PRAGMA foreign_keys = ON;');
      db.exec('PRAGMA busy_timeout = 5000;');
      runMigrations(db);
      conferirEsquemaDocumentos(db);
    } catch (e) {
      try { db.close(); } catch (ignorar) { /* a conexão pode já ter sido encerrada */ }
      throw e;
    }
    _db = db;
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
