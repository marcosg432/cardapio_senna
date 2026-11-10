-- Recebimento antecipado, correção auditada e revisão contratual.
-- Não apaga pagamentos nem regrava contratos já congelados.
BEGIN;

ALTER TABLE financeiro_contratos ADD COLUMN situacao TEXT NOT NULL DEFAULT 'confirmado'
    CHECK (situacao IN ('antecipado', 'confirmado'));

ALTER TABLE financeiro_contratos ADD COLUMN congelado INTEGER NOT NULL DEFAULT 1
    CHECK (congelado IN (0, 1));

ALTER TABLE pagamentos ADD COLUMN observacao TEXT
    CHECK (observacao IS NULL OR length(observacao) <= 500);

CREATE TRIGGER IF NOT EXISTS financeiro_situacao_insert
BEFORE INSERT ON financeiro_contratos
WHEN NOT (
    (NEW.situacao = 'confirmado' AND NEW.congelado = 1)
    OR (NEW.situacao = 'antecipado' AND NEW.congelado = 0)
)
BEGIN
    SELECT RAISE(ABORT, 'situacao financeira incoerente');
END;

CREATE TRIGGER IF NOT EXISTS financeiro_situacao_update
BEFORE UPDATE ON financeiro_contratos
WHEN NOT (
    (NEW.situacao = 'confirmado' AND NEW.congelado = 1)
    OR (NEW.situacao = 'antecipado' AND NEW.congelado = 0)
)
BEGIN
    SELECT RAISE(ABORT, 'situacao financeira incoerente');
END;

CREATE TRIGGER IF NOT EXISTS pagamentos_sem_exclusao
BEFORE DELETE ON pagamentos
BEGIN
    SELECT RAISE(ABORT, 'pagamento sem exclusao');
END;

CREATE TABLE IF NOT EXISTS pagamento_correcoes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pagamento_id INTEGER NOT NULL,
    valor_anterior_centavos INTEGER NOT NULL CHECK (valor_anterior_centavos > 0),
    pago_em_anterior TEXT NOT NULL,
    forma_anterior TEXT NOT NULL,
    observacao_anterior TEXT,
    valor_novo_centavos INTEGER NOT NULL CHECK (valor_novo_centavos > 0),
    pago_em_novo TEXT NOT NULL,
    forma_nova TEXT NOT NULL,
    observacao_nova TEXT,
    motivo TEXT NOT NULL CHECK (length(trim(motivo)) BETWEEN 3 AND 500),
    usuario_id INTEGER NOT NULL,
    usuario_nome TEXT NOT NULL CHECK (length(trim(usuario_nome)) > 0),
    corrigido_em TEXT NOT NULL CHECK (length(corrigido_em) >= 20),
    FOREIGN KEY (pagamento_id) REFERENCES pagamentos(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    FOREIGN KEY (usuario_id) REFERENCES admin_usuarios(id) ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_pagamento_correcoes_pagamento
    ON pagamento_correcoes(pagamento_id);

CREATE TABLE IF NOT EXISTS contrato_revisoes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    orcamento_id INTEGER NOT NULL,
    payload_anterior_json TEXT NOT NULL CHECK (length(payload_anterior_json) BETWEEN 2 AND 400000),
    payload_proposto_json TEXT NOT NULL CHECK (length(payload_proposto_json) BETWEEN 2 AND 400000),
    hash_anterior TEXT NOT NULL CHECK (length(hash_anterior) = 64),
    valor_anterior_centavos INTEGER NOT NULL CHECK (valor_anterior_centavos >= 0),
    valor_novo_centavos INTEGER NOT NULL CHECK (valor_novo_centavos >= 0),
    diferencas_json TEXT NOT NULL,
    motivo TEXT NOT NULL CHECK (length(trim(motivo)) BETWEEN 3 AND 500),
    usuario_id INTEGER NOT NULL,
    usuario_nome TEXT NOT NULL CHECK (length(trim(usuario_nome)) > 0),
    criada_em TEXT NOT NULL CHECK (length(criada_em) >= 20),
    documento_versao_id INTEGER,
    aceite_cliente TEXT NOT NULL DEFAULT 'pendente' CHECK (aceite_cliente IN ('pendente', 'aceito', 'recusado', 'cancelado')),
    aceito_em TEXT,
    aceito_usuario_id INTEGER,
    aceito_usuario_nome TEXT,
    documento_aceito_id INTEGER,
    decidido_em TEXT,
    decidido_usuario_id INTEGER,
    decidido_usuario_nome TEXT,
    motivo_decisao TEXT,
    FOREIGN KEY (orcamento_id) REFERENCES orcamentos(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    FOREIGN KEY (usuario_id) REFERENCES admin_usuarios(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    FOREIGN KEY (aceito_usuario_id) REFERENCES admin_usuarios(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    FOREIGN KEY (decidido_usuario_id) REFERENCES admin_usuarios(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    FOREIGN KEY (documento_versao_id) REFERENCES documento_versoes(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    FOREIGN KEY (documento_aceito_id) REFERENCES documento_versoes(id) ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_contrato_revisoes_orcamento
    ON contrato_revisoes(orcamento_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_contrato_revisao_pendente
    ON contrato_revisoes(orcamento_id) WHERE aceite_cliente = 'pendente';

CREATE TRIGGER IF NOT EXISTS contrato_revisoes_aceite_insert
BEFORE INSERT ON contrato_revisoes
WHEN NOT (
    (NEW.aceite_cliente = 'pendente'
        AND NEW.aceito_em IS NULL AND NEW.aceito_usuario_id IS NULL
        AND NEW.documento_aceito_id IS NULL AND NEW.decidido_em IS NULL
        AND NEW.decidido_usuario_id IS NULL)
    OR (NEW.aceite_cliente = 'aceito'
        AND length(NEW.aceito_em) >= 20 AND NEW.aceito_usuario_id IS NOT NULL
        AND length(trim(NEW.aceito_usuario_nome)) > 0 AND NEW.documento_aceito_id IS NOT NULL
        AND NEW.decidido_em IS NULL)
    OR ((NEW.aceite_cliente = 'recusado' OR NEW.aceite_cliente = 'cancelado')
        AND length(NEW.decidido_em) >= 20 AND NEW.decidido_usuario_id IS NOT NULL
        AND length(trim(NEW.decidido_usuario_nome)) > 0
        AND length(trim(NEW.motivo_decisao)) BETWEEN 3 AND 500
        AND NEW.aceito_em IS NULL AND NEW.documento_aceito_id IS NULL)
)
BEGIN
    SELECT RAISE(ABORT, 'aceite incoerente');
END;

CREATE TRIGGER IF NOT EXISTS contrato_revisoes_aceite_update
BEFORE UPDATE ON contrato_revisoes
WHEN NOT (
    (NEW.aceite_cliente = 'pendente'
        AND NEW.aceito_em IS NULL AND NEW.aceito_usuario_id IS NULL
        AND NEW.documento_aceito_id IS NULL AND NEW.decidido_em IS NULL
        AND NEW.decidido_usuario_id IS NULL)
    OR (NEW.aceite_cliente = 'aceito'
        AND length(NEW.aceito_em) >= 20 AND NEW.aceito_usuario_id IS NOT NULL
        AND length(trim(NEW.aceito_usuario_nome)) > 0 AND NEW.documento_aceito_id IS NOT NULL
        AND NEW.decidido_em IS NULL)
    OR ((NEW.aceite_cliente = 'recusado' OR NEW.aceite_cliente = 'cancelado')
        AND length(NEW.decidido_em) >= 20 AND NEW.decidido_usuario_id IS NOT NULL
        AND length(trim(NEW.decidido_usuario_nome)) > 0
        AND length(trim(NEW.motivo_decisao)) BETWEEN 3 AND 500
        AND NEW.aceito_em IS NULL AND NEW.documento_aceito_id IS NULL)
)
BEGIN
    SELECT RAISE(ABORT, 'aceite incoerente');
END;

COMMIT;
