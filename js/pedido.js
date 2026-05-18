/**
 * pedido.js — Geração de orçamento (carrinho + dados do evento) e aviso por WhatsApp
 * Ordem: montar objeto → salvar em localStorage ("orcamentos") → WhatsApp → limpar carrinho → UI
 */

function qtdMinDoItemCarrinho(item) {
    if (typeof resolverQtdMin === 'function') {
        return resolverQtdMin(item && item.qtdMin != null ? item.qtdMin : null);
    }
    var padrao = 50;
    if (typeof CONFIG !== 'undefined' && CONFIG.pedidoMinimoUnidades != null) {
        var p = parseInt(String(CONFIG.pedidoMinimoUnidades), 10);
        if (Number.isFinite(p) && p >= 1) padrao = p;
    }
    var m = parseInt(item && item.qtdMin != null ? item.qtdMin : padrao, 10);
    if (!Number.isFinite(m) || m < 1) return padrao;
    return Math.max(padrao, m);
}

function validarQuantidadesCarrinho() {
    for (var i = 0; i < carrinho.length; i++) {
        var item = carrinho[i];
        if (!item) continue;
        var min = qtdMinDoItemCarrinho(item);
        var q = parseInt(String(item.quantidade), 10);
        if (!Number.isFinite(q) || q < min) {
            return "A quantidade de \"" + String(item.nome || "").replace(/"/g, "'") + "\" deve ser no mínimo " + min + " unidade(s). Ajuste no carrinho e tente novamente.";
        }
    }
    return null;
}

function montarItensOrcamentoDoCarrinho() {
    return carrinho.map(function (item) {
        var subtotal = Math.round(item.preco * item.quantidade * 100) / 100;
        var min = qtdMinDoItemCarrinho(item);
        return {
            nome: item.nome,
            quantidade: item.quantidade,
            preco: item.preco,
            preco_unitario: item.preco,
            subtotal: subtotal,
            qtd_min: min
        };
    });
}

function campoTrimOrcamento(id) {
    var el = document.getElementById(id);
    if (!el || el.value == null) return "";
    return String(el.value).trim();
}

function montarMensagemOrcamento(orcId) {
    var nome = campoTrimOrcamento("nome");
    var telefone = campoTrimOrcamento("telefone");
    var email = campoTrimOrcamento("email-cliente");
    var cpf = campoTrimOrcamento("cpf-cliente");
    var rg = campoTrimOrcamento("rg-cliente");
    var dataEvento = campoTrimOrcamento("data-evento");
    var tipoEvento = campoTrimOrcamento("tipo-evento");
    var convidados = campoTrimOrcamento("convidados");
    var localEvento = campoTrimOrcamento("local-evento");
    var tipo = campoTrimOrcamento("tipo");
    var endereco = campoTrimOrcamento("endereco");
    var pagamento = campoTrimOrcamento("pagamento");
    var observacao = campoTrimOrcamento("observacao");

    var valorOriginal = calcularTotal();
    var minPadrao = 50;
    if (typeof getPedidoMinimoPadrao === 'function') {
        minPadrao = getPedidoMinimoPadrao();
    } else if (typeof CONFIG !== 'undefined' && CONFIG.pedidoMinimoUnidades != null) {
        var mp = parseInt(String(CONFIG.pedidoMinimoUnidades), 10);
        if (Number.isFinite(mp) && mp >= 1) minPadrao = mp;
    }

    var msg = "NOVO ORÇAMENTO\n";
    msg += "Ref: " + orcId + "\n\n";
    msg += "Pedido mínimo (padrão): " + minPadrao + " un. por produto e sabor.\n\n";
    msg += "ITENS (pré-orçamento):\n";
    carrinho.forEach(function (item) {
        var subtotal = item.preco * item.quantidade;
        msg += item.quantidade + "x " + item.nome + " - R$ " + formatarPreco(subtotal) + "\n";
    });
    msg += "\nTotal estimado: R$ " + formatarPreco(valorOriginal) + "\n\n";
    msg += "EVENTO\n";
    msg += "Data: " + (dataEvento || "-") + "\n";
    msg += "Tipo: " + (tipoEvento || "-") + "\n";
    msg += "Convidados: " + (convidados || "-") + "\n";
    msg += "Local: " + (localEvento || "-") + "\n";
    msg += "Entrega/Retirada: " + (tipo || "-") + "\n";
    if (tipo === "Entrega") msg += "Endereço: " + (endereco || "-") + "\n";
    msg += "\nPagamento (ref.): " + (pagamento || "-") + "\n";
    msg += "Observações: " + (observacao || "-") + "\n\n";
    msg += "CLIENTE\n";
    msg += "Nome: " + (nome || "-") + "\n";
    msg += "Telefone: " + (telefone || "-") + "\n";
    msg += "E-mail: " + (email || "-") + "\n";
    if (cpf) msg += "CPF: " + cpf + "\n";
    if (rg) msg += "RG: " + rg + "\n";
    msg += "-------------";
    return msg;
}

function validarFormularioOrcamento() {
    var nome = campoTrimOrcamento("nome");
    var telefone = campoTrimOrcamento("telefone");
    var email = campoTrimOrcamento("email-cliente");
    var dataEvento = campoTrimOrcamento("data-evento");
    var tipoEvento = campoTrimOrcamento("tipo-evento");
    var convidados = campoTrimOrcamento("convidados");
    var localEvento = campoTrimOrcamento("local-evento");
    var tipo = campoTrimOrcamento("tipo");
    var endereco = campoTrimOrcamento("endereco");

    if (!nome) return "Preencha o nome do cliente.";
    if (!telefone) return "Preencha o telefone.";
    if (!email) return "Preencha o e-mail.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "E-mail inválido.";
    if (!dataEvento) return "Informe a data do evento.";
    if (!tipoEvento) return "Informe o tipo de evento.";
    if (!convidados || parseInt(convidados, 10) < 1) return "Informe o número de convidados.";
    if (!localEvento) return "Informe o local do evento.";
    if (!tipo) return "Selecione entrega ou retirada.";
    if (tipo === "Entrega" && !endereco) return "Preencha o endereço para entrega.";

    return null;
}

function gerarOrcamento() {
    if (carrinho.length === 0) {
        alert("Adicione itens ao orçamento antes de gerar.");
        return;
    }

    var errQtd = validarQuantidadesCarrinho();
    if (errQtd) {
        alert(errQtd);
        return;
    }

    var erro = validarFormularioOrcamento();
    if (erro) {
        alert(erro);
        return;
    }

    var nome = campoTrimOrcamento("nome");
    var telefone = campoTrimOrcamento("telefone");
    var email = campoTrimOrcamento("email-cliente");
    var cpf = campoTrimOrcamento("cpf-cliente");
    var rg = campoTrimOrcamento("rg-cliente");
    var dataEvento = campoTrimOrcamento("data-evento");
    var tipoEvento = campoTrimOrcamento("tipo-evento");
    var convidados = campoTrimOrcamento("convidados");
    var localEvento = campoTrimOrcamento("local-evento");
    var tipo = campoTrimOrcamento("tipo");
    var endereco = campoTrimOrcamento("endereco");
    var pagamento = campoTrimOrcamento("pagamento");
    var observacao = campoTrimOrcamento("observacao");

    var entregaTexto = tipo === "Entrega" ? "Entrega — " + (endereco || "") : (tipo || "");

    var valorOriginal = Math.round(calcularTotal() * 100) / 100;
    var id = Date.now();
    var itens = montarItensOrcamentoDoCarrinho();

    var statusNovo = (CONFIG && CONFIG.STATUS_ORCAMENTO && CONFIG.STATUS_ORCAMENTO.NOVO) || "novo_orcamento";
    var agora = new Date().toISOString();

    var registro = {
        id: id,
        cliente: nome,
        telefone: telefone,
        email: email,
        evento_data: dataEvento,
        evento_tipo: tipoEvento,
        convidados: parseInt(convidados, 10) || 0,
        local: localEvento,
        entrega: entregaTexto,
        observacoes: observacao || "",
        itens: itens,
        valor_original: valorOriginal,
        desconto_tipo: null,
        desconto_valor: null,
        valor_desconto: 0,
        desconto_degustacao: null,
        desconto_cerimonialista: null,
        taxa_entrega: null,
        valor_final: valorOriginal,
        degustacao_data: null,
        degustacao_hora: null,
        degustacao_obs: null,
        forma_pagamento: pagamento || "",
        entrada: null,
        restante: null,
        data_pagamento_entrada: null,
        data_pagamento_final: null,
        status: statusNovo,
        contrato_pdf: null,
        data_criacao: agora,
        nome_cliente: nome,
        data_evento: dataEvento,
        tipo_evento: tipoEvento,
        local_evento: localEvento,
        entrega_retirada: tipo,
        endereco: tipo === "Entrega" ? endereco : null,
        forma_pagamento_ref: pagamento || null,
        pagamento: pagamento || "",
        total: valorOriginal,
        cliente_cpf: cpf ? cpf : null,
        cliente_rg: rg ? rg : null,
        rg: rg ? rg : null,
        cpf: cpf ? cpf : null,
        data: agora,
        contrato: null
    };

    try {
        if (typeof criarOrcamento !== "function") {
            throw new Error("criarOrcamento não disponível (orcamentos-storage.js).");
        }
        var salvo = criarOrcamento(registro);
        if (salvo && salvo.__salvoSomenteLocalEm) {
            throw new Error("Orçamento salvo apenas neste navegador; API indisponível.");
        }
    } catch (e) {
        console.error(e);
        alert("Não foi possível salvar o orçamento no painel. Tente novamente em instantes ou avise a confeitaria pelo WhatsApp.");
        return;
    }

    var telefoneWa = (typeof CONFIG !== "undefined" && CONFIG.telefoneWhatsApp) ? CONFIG.telefoneWhatsApp : "5519981178167";
    var mensagem = montarMensagemOrcamento(String(id));
    var url = "https://wa.me/" + telefoneWa + "?text=" + encodeURIComponent(mensagem);
    window.open(url, "_blank");

    alert("Orçamento salvo (ref. " + id + "). Abrindo o WhatsApp…");

    carrinho = [];
    salvarCarrinho(carrinho);
    atualizarCarrinho();
    atualizarBadge();
    fecharCarrinho();
}

function toggleCampoEndereco() {
    var tipo = document.getElementById("tipo");
    var enderecoWrap = document.getElementById("endereco-wrap");
    var enderecoInput = document.getElementById("endereco");

    if (tipo && enderecoWrap) {
        if (tipo.value === "Entrega") {
            enderecoWrap.style.display = "block";
            if (enderecoInput) enderecoInput.required = true;
        } else {
            enderecoWrap.style.display = "none";
            if (enderecoInput) {
                enderecoInput.required = false;
                enderecoInput.value = "";
            }
        }
    }
}

function initPedido() {
    var btnFinalizar = document.querySelector(".carrinho-sidebar .btn-finalizar-pedido");
    var tipoSelect = document.getElementById("tipo");

    if (btnFinalizar) {
        btnFinalizar.addEventListener("click", gerarOrcamento);
    }

    if (tipoSelect) {
        tipoSelect.addEventListener("change", toggleCampoEndereco);
        toggleCampoEndereco();
    }
}

document.addEventListener("DOMContentLoaded", initPedido);
