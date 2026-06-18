/**
 * Configurações do Sistema de Pedidos / Orçamentos
 * Alterar apenas este arquivo para configurar em novos cardápios/clientes
 */
const CONFIG = {
    /** Número do WhatsApp com DDD (ex: 5519981178167) */
    telefoneWhatsApp: "5519981178167",
    /**
     * Slug estável para chaves de localStorage/sessão (carrinho, orçamentos legado, admin).
     * Não altere após deploy se quiser manter dados já gravados no navegador.
     */
    storageId: "senna_doce",
    /** Nome da confeitaria exibido no site, PDFs, WhatsApp e admin */
    nomeEmpresa: "Candy Li Doces Finos",
    /**
     * Pedido mínimo em unidades por produto e por sabor (orçamento / cardápio).
     * Usado como padrão para todos os itens; `data-produto-qtd-min` no card só pode aumentar esse mínimo.
     */
    pedidoMinimoUnidades: 50,
    /** Senha da área administrativa (troque em produção) */
    senhaAdmin: "Candyli280426",
    /** Chaves de status (espelho do banco / fluxo) */
    STATUS_ORCAMENTO: {
        NOVO: "novo_orcamento",
        DEGUST_AGENDADA: "degustacao_agendada",
        DEGUST_REALIZADA: "degustacao_realizada",
        DESCONTO_APLICADO: "desconto_aplicado",
        CONTRATO_GERADO: "contrato_gerado",
        FECHADO: "fechado",
        PERDIDO: "perdido"
    },
    /** Rótulos para exibição */
    STATUS_LABELS: {
        novo_orcamento: "Novo orçamento",
        degustacao_agendada: "Degustação agendada",
        degustacao_realizada: "Degustação realizada",
        desconto_aplicado: "Desconto aplicado",
        contrato_gerado: "Contrato gerado",
        fechado: "Fechado",
        perdido: "Perdido"
    },
    /**
     * Dados da CONTRATADA no contrato de prestação de serviços (PDF admin).
     * Ajuste nome, CPF e endereço conforme documento da empresa.
     */
    contratadaLegal: {
        nome: "ALINE FERNANDA MANOEL",
        cpf: "334.444.138.82",
        endereco: "Rua Raul Dantas Darce, 171, Piracicaba / SP"
    },
    /** Texto exibido na cláusula de pagamento (PIX / comprovante) */
    contratoPixCnpj: "41.919.042/0001-08",
    contratoEmailsComprovante: "candylidoces@hotmail.com",
    /** Dias de validade exibidos no PDF do orçamento */
    validadeOrcamentoDias: 15,
    /**
     * Logo para PDF (opcional): caminho a partir da raiz do site, ex: "assets/logo.png"
     * Deixe vazio para não carregar imagem (usa só o nome da empresa).
     */
    logoOrcamentoRelPath: "",
    /**
     * Assinatura da CONTRATADA no contrato PDF (caminho a partir da raiz do site).
     * Deixe vazio para usar só a linha em branco.
     */
    contratoAssinaturaRelPath: "assets/assinatura-contratada.png"
};

/**
 * Slug usado nas chaves de armazenamento; usa storageId quando definido, senão deriva de nomeEmpresa.
 */
function getConfigStorageSlug() {
    if (typeof CONFIG === "undefined") return "default";
    var sid = CONFIG.storageId;
    if (sid != null && String(sid).trim() !== "") {
        return String(sid).trim().replace(/\s+/g, "_").toLowerCase();
    }
    return String(CONFIG.nomeEmpresa || "default").replace(/\s+/g, "_").toLowerCase();
}
