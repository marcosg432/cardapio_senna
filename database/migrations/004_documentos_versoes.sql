-- Histórico de documentos. Não altera orçamentos, financeiro nem pagamentos.
BEGIN;

CREATE TABLE IF NOT EXISTS documentos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tipo TEXT NOT NULL CHECK (tipo IN ('orcamento', 'contrato', 'demonstrativo', 'producao_evento', 'producao_dia')),
    orcamento_id INTEGER,
    data_referencia TEXT,
    criado_em TEXT NOT NULL CHECK (length(criado_em) >= 20),
    FOREIGN KEY (orcamento_id) REFERENCES orcamentos(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CHECK (
        (tipo = 'producao_dia' AND orcamento_id IS NULL AND data_referencia GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')
        OR
        (tipo != 'producao_dia' AND orcamento_id IS NOT NULL AND data_referencia IS NULL)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_documentos_orcamento
    ON documentos(tipo, orcamento_id)
    WHERE orcamento_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_documentos_data
    ON documentos(tipo, data_referencia)
    WHERE data_referencia IS NOT NULL;

CREATE TABLE IF NOT EXISTS documento_versoes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    documento_id INTEGER NOT NULL,
    numero INTEGER NOT NULL CHECK (numero >= 1),
    estado TEXT NOT NULL CHECK (estado IN ('rascunho', 'emitida', 'descartado')),
    usuario_id INTEGER NOT NULL,
    usuario_nome TEXT NOT NULL CHECK (length(trim(usuario_nome)) > 0),
    criada_em TEXT NOT NULL CHECK (length(criada_em) >= 20),
    atualizada_em TEXT NOT NULL CHECK (length(atualizada_em) >= 20),
    motivo TEXT NOT NULL CHECK (length(trim(motivo)) BETWEEN 3 AND 500),
    conteudo_json TEXT NOT NULL,
    hash_snapshot TEXT NOT NULL CHECK (length(hash_snapshot) = 64),
    hash_pdf TEXT CHECK (hash_pdf IS NULL OR length(hash_pdf) = 64),
    pdf_caminho TEXT,
    versao_anterior_id INTEGER,
    revisao INTEGER NOT NULL DEFAULT 1 CHECK (revisao >= 1),
    chave_idempotencia TEXT CHECK (
        chave_idempotencia IS NULL OR length(chave_idempotencia) BETWEEN 16 AND 80
    ),
    emitida_em TEXT,
    FOREIGN KEY (documento_id) REFERENCES documentos(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    FOREIGN KEY (usuario_id) REFERENCES admin_usuarios(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    FOREIGN KEY (versao_anterior_id) REFERENCES documento_versoes(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CHECK (
        (estado = 'emitida' AND hash_pdf IS NOT NULL AND pdf_caminho IS NOT NULL AND emitida_em IS NOT NULL AND chave_idempotencia IS NOT NULL)
        OR
        (estado != 'emitida' AND hash_pdf IS NULL AND pdf_caminho IS NULL AND emitida_em IS NULL AND chave_idempotencia IS NULL)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_documento_versoes_numero
    ON documento_versoes(documento_id, numero);

CREATE UNIQUE INDEX IF NOT EXISTS idx_documento_um_rascunho
    ON documento_versoes(documento_id)
    WHERE estado = 'rascunho';

CREATE UNIQUE INDEX IF NOT EXISTS idx_documento_versoes_idempotencia
    ON documento_versoes(chave_idempotencia)
    WHERE chave_idempotencia IS NOT NULL;

CREATE TRIGGER IF NOT EXISTS documento_versoes_emitida_imutavel
BEFORE UPDATE ON documento_versoes
WHEN OLD.estado = 'emitida'
BEGIN
    SELECT RAISE(ABORT, 'versao emitida imutavel');
END;

CREATE TRIGGER IF NOT EXISTS documento_versoes_descartado_imutavel
BEFORE UPDATE ON documento_versoes
WHEN OLD.estado = 'descartado'
BEGIN
    SELECT RAISE(ABORT, 'rascunho descartado imutavel');
END;

CREATE TRIGGER IF NOT EXISTS documento_versoes_identidade_fixa
BEFORE UPDATE ON documento_versoes
WHEN NEW.numero != OLD.numero
    OR NEW.documento_id != OLD.documento_id
    OR NEW.usuario_id != OLD.usuario_id
BEGIN
    SELECT RAISE(ABORT, 'identidade da versao');
END;

CREATE TRIGGER IF NOT EXISTS documento_versoes_emissao_preserva
BEFORE UPDATE ON documento_versoes
WHEN OLD.estado = 'rascunho' AND NEW.estado = 'emitida'
BEGIN
    SELECT RAISE(ABORT, 'snapshot alterado na emissao')
    WHERE NEW.conteudo_json != OLD.conteudo_json
        OR NEW.hash_snapshot != OLD.hash_snapshot
        OR NEW.versao_anterior_id IS NOT OLD.versao_anterior_id;
END;

CREATE TRIGGER IF NOT EXISTS documento_versoes_descarte_preserva
BEFORE UPDATE ON documento_versoes
WHEN OLD.estado = 'rascunho' AND NEW.estado = 'descartado'
BEGIN
    SELECT RAISE(ABORT, 'snapshot alterado no descarte')
    WHERE NEW.conteudo_json != OLD.conteudo_json
        OR NEW.hash_snapshot != OLD.hash_snapshot;
END;

CREATE TRIGGER IF NOT EXISTS documento_versoes_historico_preservado
BEFORE DELETE ON documento_versoes
WHEN OLD.estado IN ('emitida', 'descartado')
BEGIN
    SELECT RAISE(ABORT, 'historico nao pode ser apagado');
END;

COMMIT;
