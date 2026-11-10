-- Reversão do financeiro. Não mexe em orçamentos, produtos, categorias nem autenticação.
BEGIN;

DROP TRIGGER IF EXISTS financeiro_situacao_insert;
DROP TRIGGER IF EXISTS financeiro_situacao_update;
DROP TRIGGER IF EXISTS pagamentos_sem_exclusao;
DROP TABLE IF EXISTS pagamento_correcoes;
DROP TABLE IF EXISTS contrato_revisoes;
DROP TABLE IF EXISTS pagamentos;
DROP TABLE IF EXISTS financeiro_contratos;
DELETE FROM schema_migrations WHERE name = '003_financeiro.sql';
DELETE FROM schema_migrations WHERE name = '005_financeiro_operacao.sql';

COMMIT;
