/**
 * Normalização de orçamentos (campos novos x legados, status)
 */
function statusNormalizado(o) {
    var s = o && o.status;
    if (!s) return "novo_orcamento";
    if (typeof CONFIG !== "undefined" && CONFIG.STATUS_LABELS && CONFIG.STATUS_LABELS[s]) {
        return s;
    }
    if (typeof CONFIG !== "undefined" && CONFIG.STATUS_LABELS) {
        var keys = Object.keys(CONFIG.STATUS_LABELS);
        for (var i = 0; i < keys.length; i++) {
            if (CONFIG.STATUS_LABELS[keys[i]] === s) return keys[i];
        }
    }
    return "novo_orcamento";
}

function eventoDataOrc(o) {
    if (!o) return "";
    return o.evento_data || o.data_evento || (o.data ? String(o.data).slice(0, 10) : "");
}

function eventoTipoOrc(o) {
    if (!o) return "";
    return o.evento_tipo || o.tipo_evento || "";
}

function localOrc(o) {
    if (!o) return "";
    return o.local || o.local_evento || "";
}

function formaPagamentoOrc(o) {
    if (!o) return "";
    return o.forma_pagamento != null && o.forma_pagamento !== "" ? o.forma_pagamento : (o.forma_pagamento_ref || o.pagamento || "");
}

function somaSubtotalItensDoOrcamento(o) {
    if (!o || !Array.isArray(o.itens)) return 0;
    if (typeof somaSubtotalItensOrcamento === "function") {
        return somaSubtotalItensOrcamento(o.itens);
    }
    var t = 0;
    for (var i = 0; i < o.itens.length; i++) {
        var it = o.itens[i];
        if (!it) continue;
        var pu = it.preco_unitario != null ? it.preco_unitario : it.preco;
        t += (Number(pu) || 0) * (Number(it.quantidade) || 0);
    }
    return Math.round(t * 100) / 100;
}

/**
 * Valor base para desconto e PDF: soma das linhas quando há itens (única fonte de verdade);
 * senão mantém comportamento antigo só com campo total/valor_original.
 */
function valorOriginalOrcamentoComItens(o) {
    if (!o) return 0;
    if (Array.isArray(o.itens) && o.itens.length > 0) {
        return somaSubtotalItensDoOrcamento(o);
    }
    return valorOriginalOrcCompat(o);
}

function valorFinalOrc(o) {
    if (!o) return 0;
    if (typeof calcularValorFinalOrcamento === "function") {
        var vo = valorOriginalOrcamentoComItens(o);
        return calcularValorFinalOrcamento(
            vo,
            o.desconto_tipo,
            o.desconto_valor,
            o.desconto_degustacao,
            o.desconto_cerimonialista,
            o.taxa_entrega
        );
    }
    var v = o.valor_final;
    if (v == null) v = o.total;
    return Number(v) || 0;
}

function valorOriginalOrcCompat(o) {
    if (!o) return 0;
    var v = o.valor_original;
    if (v == null) v = o.total;
    return Number(v) || 0;
}

function classeCssStatus(key) {
    return "status-" + String(key).replace(/[^a-z0-9_]/gi, "_");
}
