/**
 * Soma de doces do pedido. Não altera preço nem valor.
 * Unidade ausente não vale 1. Cento vale 100 unidades.
 */
function rotuloDoce(valor) {
    return String(valor == null ? "" : valor).replace(/\s+/g, " ").trim().toLocaleLowerCase("pt-BR");
}

function naoEntraNaSoma(nome) {
    var texto = rotuloDoce(nome);
    if (!texto) return true;
    if (/^taxa\b/.test(texto) || /\btaxa de entrega\b/.test(texto) || /\bfrete\b/.test(texto)) return true;
    if (/\bservi[cç]os?\b/.test(texto)) return true;
    if (/\bloca[cç][aã]o\b/.test(texto) || /\baluguel\b/.test(texto)) return true;
    if (/\bsuportes?\b/.test(texto)) return true;
    if (texto === "entrega") return true;
    return false;
}

function lerQuantidadeDoce(valor) {
    if (typeof valor === "number" && Number.isFinite(valor) && valor > 0) return valor;
    if (typeof valor === "string") {
        var texto = valor.trim();
        if (/^\d+$/.test(texto)) return Number(texto);
        if (/^\d+,\d+$/.test(texto)) {
            var numero = Number(texto.replace(",", "."));
            if (Number.isFinite(numero) && numero > 0) return numero;
        }
    }
    return null;
}

function fatorUnidadeDoce(unidade) {
    var texto = rotuloDoce(unidade).replace(/\.$/, "");
    if (!texto || texto === "unidade não informada" || texto === "—" || texto === "-" || texto === "nao informada") {
        return null;
    }
    if (texto === "un" || texto === "und" || texto === "unid" || texto === "unidade" || texto === "unidades") return 1;
    if (texto === "cento" || texto === "centos") return 100;
    return undefined;
}

function totalDocesPedido(itens) {
    var total = 0;
    var pendencias = [];
    (Array.isArray(itens) ? itens : []).forEach(function (item) {
        if (!item || typeof item !== "object") return;
        var nome = String(item.nome || "Item sem nome").replace(/\s+/g, " ").trim() || "Item sem nome";
        if (naoEntraNaSoma(nome)) return;
        var quantidade = lerQuantidadeDoce(item.quantidade);
        if (quantidade == null) {
            pendencias.push({ nome: nome, motivo: "Quantidade não pôde ser lida." });
            return;
        }
        var fator = fatorUnidadeDoce(item.unidade);
        if (fator == null) {
            pendencias.push({ nome: nome, motivo: "sem unidade" });
            return;
        }
        if (fator === undefined) {
            pendencias.push({ nome: nome, motivo: "Unidade incompatível com a soma de doces." });
            return;
        }
        var pecas = quantidade * fator;
        var inteiro = Math.round(pecas);
        if (Math.abs(pecas - inteiro) > 0.001 || !isFinite(inteiro) || inteiro <= 0) {
            pendencias.push({ nome: nome, motivo: "Quantidade fracionada." });
            return;
        }
        total += inteiro;
    });
    return {
        total: total,
        texto: "Quantidade total de doces: " + total,
        pendencias: pendencias
    };
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = { totalDocesPedido: totalDocesPedido };
}
