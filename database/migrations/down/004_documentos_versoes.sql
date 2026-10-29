-- Reversão do histórico de documentos. Não mexe em orçamentos, financeiro nem pagamentos.
BEGIN;

DROP TRIGGER IF EXISTS documento_versoes_historico_preservado;
DROP TRIGGER IF EXISTS documento_versoes_descarte_preserva;
DROP TRIGGER IF EXISTS documento_versoes_emissao_preserva;
DROP TRIGGER IF EXISTS documento_versoes_identidade_fixa;
DROP TRIGGER IF EXISTS documento_versoes_descartado_imutavel;
DROP TRIGGER IF EXISTS documento_versoes_emitida_imutavel;

DROP TABLE IF EXISTS documento_versoes;
DROP TABLE IF EXISTS documentos;

DELETE FROM schema_migrations WHERE name = '004_documentos_versoes.sql';

COMMIT;
