-- Reversão da autenticação administrativa. Não mexe nas tabelas do cardápio.
BEGIN;

DROP TABLE IF EXISTS admin_sessoes;
DROP TABLE IF EXISTS admin_usuarios;
DELETE FROM schema_migrations WHERE name = '002_admin_auth.sql';

COMMIT;
