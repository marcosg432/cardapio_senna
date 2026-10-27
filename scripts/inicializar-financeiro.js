/**
 * Congela contratos já confirmados quando o valor gravado confere com o cálculo oficial.
 * Não altera o payload do orçamento.
 * Não roda no banco real sem DATABASE_PATH, FINANCEIRO_INICIALIZAR=1 e --banco-real.
 */
const path = require('path');

const real = path.resolve(__dirname, '..', 'database', 'database.sqlite');
const atual = process.env.DATABASE_PATH ? path.resolve(process.env.DATABASE_PATH) : '';
const aplicar = process.argv.includes('--aplicar');
const bancoReal = atual === real;

if (process.env.FINANCEIRO_INICIALIZAR !== '1' || !atual) {
  console.error('Nada foi executado. Defina FINANCEIRO_INICIALIZAR=1 e DATABASE_PATH.');
  process.exit(1);
}
if (bancoReal && !process.argv.includes('--banco-real')) {
  console.error('O banco real foi recusado. Nada foi executado.');
  process.exit(1);
}

const { inicializarConfirmados } = require('../database/repositories/financeiroRepository');
const { closeDb } = require('../database/db');

try {
  const resultado = inicializarConfirmados({ aplicar: aplicar });
  console.log(JSON.stringify({
    aplicar: aplicar,
    conferidos: resultado.conferidos.length,
    aplicados: resultado.aplicados,
    conflitos: resultado.conflitos
  }));
  if (resultado.conflitos.length) process.exitCode = 2;
} finally {
  closeDb();
}
