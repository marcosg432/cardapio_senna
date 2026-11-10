-- Remove as tabelas novas da operação financeira.
-- As colunas acrescentadas em financeiro_contratos e pagamentos permanecem,
-- porque o SQLite não retira coluna sem reconstruir a tabela.
BEGIN;

DROP TRIGGER IF EXISTS financeiro_situacao_insert;
DROP TRIGGER IF EXISTS financeiro_situacao_update;
DROP TRIGGER IF EXISTS pagamentos_sem_exclusao;
DROP TRIGGER IF EXISTS contrato_revisoes_aceite_insert;
DROP TRIGGER IF EXISTS contrato_revisoes_aceite_update;
DROP TABLE IF EXISTS pagamento_correcoes;
DROP TABLE IF EXISTS contrato_revisoes;
DELETE FROM schema_migrations WHERE name = '005_financeiro_operacao.sql';

COMMIT;
