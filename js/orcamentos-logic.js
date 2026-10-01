/**
 * Cálculo de valor final e desconto (preços dos produtos não são alterados)
 */

function calcularValorFinalComDesconto(valorOriginal, descontoTipo, descontoValor) {
    const vo = Math.max(0, Number(valorOriginal) || 0);
    const tipo = descontoTipo;
    const dv = Number(descontoValor);
    if (!tipo || dv == null || isNaN(dv) || dv <= 0) return Math.round(vo * 100) / 100;

    if (tipo === 'reais') {
        return Math.round(Math.max(0, vo - dv) * 100) / 100;
    }
    if (tipo === 'percentual') {
        const p = Math.min(100, Math.max(0, dv));
        return Math.round(vo * (1 - p / 100) * 100) / 100;
    }
    return vo;
}

function descontoEquivalenteEmReais(valorOriginal, descontoTipo, descontoValor) {
    const vo = Math.max(0, Number(valorOriginal) || 0);
    const vf = calcularValorFinalComDesconto(vo, descontoTipo, descontoValor);
    return Math.round((vo - vf) * 100) / 100;
}

/**
 * Converte preço/quantidade monetária (número, "4.5", "4,50", "1.500,00") para reais com 2 casas.
 * Vazio ou inválido → 0. Nunca negativo.
 */
function numeroMonetarioItemOrcamento(v) {
    if (v == null || v === "") return 0;
    if (typeof v === "number") {
        if (!isFinite(v) || v < 0) return 0;
        return Math.round(v * 100) / 100;
    }
    var s = String(v).trim().replace(/\s/g, "");
    if (!s) return 0;
    var temVirgula = s.indexOf(",") >= 0;
    var temPonto = s.indexOf(".") >= 0;
    if (temVirgula && temPonto) {
        if (s.lastIndexOf(",") > s.lastIndexOf(".")) {
            s = s.replace(/\./g, "").replace(",", ".");
        } else {
            s = s.replace(/,/g, "");
        }
    } else if (temVirgula) {
        s = s.replace(",", ".");
    }
    var n = Number(s);
    if (!isFinite(n) || n < 0) return 0;
    return Math.round(n * 100) / 100;
}

/**
 * Valor numérico opcional (vazio → 0), nunca negativo.
 */
function valorMonetarioOrcamentoOpcional(v) {
    return numeroMonetarioItemOrcamento(v);
}

/**
 * Quantidade inteira da linha (mínimo 0).
 */
function quantidadeItemOrcamento(it) {
    var n = parseInt(String(it && it.quantidade != null ? it.quantidade : 0), 10);
    if (!isFinite(n) || n < 0) return 0;
    return n;
}

/**
 * Preço unitário da linha (preco_unitario ou preco).
 */
function precoUnitarioItemOrcamento(it) {
    if (!it) return 0;
    var pu = it.preco_unitario != null ? it.preco_unitario : it.preco;
    return numeroMonetarioItemOrcamento(pu);
}

/**
 * Subtotal da linha = quantidade × preço unitário.
 * Sempre recalcula; não usa `subtotal` gravado (pode estar desatualizado).
 */
function subtotalLinhaItemOrcamento(it) {
    if (!it) return 0;
    var q = quantidadeItemOrcamento(it);
    var pu = precoUnitarioItemOrcamento(it);
    if (q > 0 && pu > 0) {
        return Math.round(q * pu * 100) / 100;
    }
    return numeroMonetarioItemOrcamento(it.subtotal);
}

/**
 * Soma dos produtos (única fonte de verdade do subtotal).
 */
function somaSubtotalItensOrcamento(itens) {
    var t = 0;
    var lista = itens || [];
    for (var i = 0; i < lista.length; i++) {
        t += subtotalLinhaItemOrcamento(lista[i]);
    }
    return Math.round(t * 100) / 100;
}

/**
 * Fluxo perceptual: subtotal (produtos) + taxaEntrega → base com entrega;
 * valorFinal = baseComEntrega − descontoGeral − descontoDegustação − descontoCerimonialista.
 * O desconto geral (% ou R$) continua calculado só sobre o subtotal de produtos (não sobre a taxa).
 * Matematicamente equivale a: subtotal − descontos + taxa.
 */
function calcularValorFinalOrcamento(vo, descontoTipo, descontoValor, descontoDegustacao, descontoCerimonialista, taxaEntrega) {
    var subtotal = Math.max(0, Number(vo) || 0);
    var te = valorMonetarioOrcamentoOpcional(taxaEntrega);
    var baseComEntrega = subtotal + te;
    var dg = descontoTipo ? descontoEquivalenteEmReais(subtotal, descontoTipo, descontoValor) : 0;
    var dd = valorMonetarioOrcamentoOpcional(descontoDegustacao);
    var dc = valorMonetarioOrcamentoOpcional(descontoCerimonialista);
    var vf = baseComEntrega - dg - dd - dc;
    return Math.round(Math.max(0, vf) * 100) / 100;
}

/** valorRestante = max(0, valorFinal − entrada); entrada vazia trata como 0 */
function calcularValorRestanteOrcamento(valorFinal, entrada) {
    var vf = Math.max(0, Number(valorFinal) || 0);
    var ent = entrada == null || entrada === "" ? 0 : valorMonetarioOrcamentoOpcional(entrada);
    var rest = vf - ent;
    return Math.round(Math.max(0, rest) * 100) / 100;
}

/**
 * Rótulo da unidade de venda (pacote, cento ou unidade).
 * @param {string} [unidade]
 * @param {number} [qtd]
 */
function rotuloUnidadeVenda(unidade, qtd) {
    var u = String(unidade || "").trim().toLowerCase();
    var plural = Number(qtd) !== 1;
    if (u === "pacote") return plural ? "pacotes" : "pacote";
    if (u === "cento") return plural ? "centos" : "cento";
    return plural ? "unidades" : "unidade";
}

/**
 * Linha de item com quantidade + unidade (quando houver) + nome.
 * Sem unidade: "50 × Camafeu". Com unidade: "1 pacote × Pacote simples".
 */
function formatarQtdNomeItemOrcamento(it) {
    var q = quantidadeItemOrcamento(it);
    var nome = (it && it.nome) || "";
    var u = it && it.unidade ? String(it.unidade).trim() : "";
    if (!u) return q + " × " + nome;
    return q + " " + rotuloUnidadeVenda(u, q) + " × " + nome;
}
