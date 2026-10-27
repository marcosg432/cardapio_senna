-- Financeiro dos contratos confirmados. Não altera orçamentos, produtos nem categorias.
BEGIN;

CREATE TABLE IF NOT EXISTS financeiro_contratos (
    orcamento_id INTEGER PRIMARY KEY,
    valor_contratado_centavos INTEGER NOT NULL CHECK (valor_contratado_centavos >= 0),
    congelado_em TEXT NOT NULL CHECK (length(congelado_em) >= 20),
    FOREIGN KEY (orcamento_id) REFERENCES orcamentos(id) ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE IF NOT EXISTS pagamentos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    orcamento_id INTEGER NOT NULL,
    valor_centavos INTEGER NOT NULL CHECK (valor_centavos > 0),
    pago_em TEXT NOT NULL CHECK (length(pago_em) = 10 AND pago_em GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
    forma TEXT NOT NULL CHECK (forma IN ('pix', 'dinheiro', 'transferencia', 'cartao', 'boleto', 'outro')),
    chave_idempotencia TEXT NOT NULL UNIQUE CHECK (length(chave_idempotencia) BETWEEN 16 AND 80),
    criado_em TEXT NOT NULL CHECK (length(criado_em) >= 20),
    FOREIGN KEY (orcamento_id) REFERENCES financeiro_contratos(orcamento_id) ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_pagamentos_orcamento ON pagamentos(orcamento_id);

COMMIT;
