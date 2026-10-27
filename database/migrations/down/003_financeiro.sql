-- Reversão do financeiro. Não mexe em orçamentos, produtos, categorias nem autenticação.
BEGIN;

DROP TABLE IF EXISTS pagamentos;
DROP TABLE IF EXISTS financeiro_contratos;
DELETE FROM schema_migrations WHERE name = '003_financeiro.sql';

COMMIT;
