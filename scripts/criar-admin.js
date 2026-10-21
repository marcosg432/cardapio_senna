/**
 * Cria o primeiro administrador local.
 * A senha vem de ADMIN_SENHA ou, uma única vez, de js/config.js (--usar-config).
 * Não imprime a senha nem o hash.
 */
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const root = path.join(__dirname, '..');
const dbPath = process.env.DATABASE_PATH
  ? path.resolve(process.env.DATABASE_PATH)
  : path.join(root, 'database', 'database.sqlite');

function backupConsistente() {
  if (process.env.DATABASE_PATH) return;
  if (!fs.existsSync(dbPath)) return;
  const dir = path.join(root, 'database', 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const carimbo = new Date().toISOString().replace(/[:.]/g, '-');
  const destino = path.join(dir, 'database-' + carimbo + '.sqlite');
  const seguro = destino.replace(/\\/g, '/').replace(/'/g, "''");
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec("VACUUM INTO '" + seguro + "'");
  db.close();
  console.log('Backup local criado em database/backups/. Esse arquivo fica fora do Git.');
}

function senhaDoConfig() {
  const arquivo = path.join(root, 'js', 'config.js');
  const texto = fs.readFileSync(arquivo, 'utf8');
  const match = texto.match(/senhaAdmin:\s*"([^"]+)"/);
  return match ? match[1] : '';
}

function main() {
  const usarConfig = process.argv.indexOf('--usar-config') !== -1;
  const senha = process.env.ADMIN_SENHA || (usarConfig ? senhaDoConfig() : '');
  const usuario = process.env.ADMIN_USUARIO || 'admin';
  if (!senha) {
    console.error('Defina ADMIN_SENHA no ambiente para criar o administrador. A senha não fica no código.');
    process.exit(1);
  }
  backupConsistente();
  const { criarAdministrador } = require('../server/auth');
  const resultado = criarAdministrador(usuario, senha);
  if (resultado.criado) console.log('Administrador criado.');
  else if (resultado.atualizado) console.log('Senha do administrador atualizada e sessões antigas encerradas.');
  else console.log('Administrador já existe. Nada foi alterado.');
}

main();
