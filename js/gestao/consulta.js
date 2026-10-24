/**
 * Leitura dos orçamentos para o painel de gestão.
 * Não grava, não confirma contrato e não trata entrada como pagamento.
 */
(function (raiz, fabrica) {
    var api = fabrica();
    if (typeof module === "object" && module.exports) module.exports = api;
    raiz.GestaoConsulta = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    var MESES = [
        "janeiro", "fevereiro", "março", "abril", "maio", "junho",
        "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"
    ];

    function escapar(valor) {
        return String(valor == null ? "" : valor).replace(/[&<>"']/g, function (c) {
            return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
        });
    }

    function semAcento(valor) {
        return String(valor || "")
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase()
            .trim();
    }

    function nomeCliente(orcamento) {
        if (!orcamento) return "";
        return String(orcamento.nome_cliente || orcamento.cliente || "").trim();
    }

    function isoDeData(data) {
        var mes = String(data.getMonth() + 1).padStart(2, "0");
        var dia = String(data.getDate()).padStart(2, "0");
        return data.getFullYear() + "-" + mes + "-" + dia;
    }

    function interpretarData(valor) {
        var texto = String(valor || "").trim();
        var match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto);
        if (!match) return null;
        var ano = Number(match[1]);
        var mes = Number(match[2]);
        var dia = Number(match[3]);
        var data = new Date(ano, mes - 1, dia);
        if (data.getFullYear() !== ano || data.getMonth() !== mes - 1 || data.getDate() !== dia) return null;
        return { iso: match[1] + "-" + match[2] + "-" + match[3], ano: ano, mes: mes, dia: dia };
    }

    function dataEvento(orcamento) {
        if (!orcamento) return null;
        return interpretarData(orcamento.data_evento) || interpretarData(orcamento.evento_data);
    }

    function formatarDataIso(iso) {
        var data = interpretarData(iso);
        if (!data) return "—";
        return String(data.dia).padStart(2, "0") + "/" + String(data.mes).padStart(2, "0") + "/" + data.ano;
    }

    function statusChave(orcamento) {
        if (typeof statusNormalizado === "function") return statusNormalizado(orcamento || {});
        var chave = orcamento && orcamento.status ? String(orcamento.status) : "";
        return chave || "novo_orcamento";
    }

    function rotuloStatus(chave) {
        if (typeof CONFIG !== "undefined" && CONFIG.STATUS_LABELS && CONFIG.STATUS_LABELS[chave]) {
            return CONFIG.STATUS_LABELS[chave];
        }
        return chave || "—";
    }

    function valorFinal(orcamento) {
        if (typeof valorFinalOrc === "function") return valorFinalOrc(orcamento);
        var bruto = orcamento && orcamento.valor_final != null ? orcamento.valor_final : orcamento && orcamento.total;
        var numero = Number(bruto);
        return isFinite(numero) ? numero : 0;
    }

    function pdfEmitido(orcamento) {
        var pdf = orcamento && orcamento.contrato_pdf;
        return !!(pdf && typeof pdf === "object" && (pdf.gerado_em || pdf.tipo));
    }

    function eventoConfirmado() {
        return false;
    }

    function hrefOrcamento(id) {
        return "../orcamento.html?id=" + encodeURIComponent(id);
    }

    function filtrar(lista, opcoes) {
        var busca = semAcento(opcoes && opcoes.busca);
        var status = opcoes && opcoes.status ? String(opcoes.status) : "";
        return (lista || []).filter(function (orcamento) {
            if (status && status !== "todos" && statusChave(orcamento) !== status) return false;
            if (!busca) return true;
            return semAcento(nomeCliente(orcamento)).indexOf(busca) !== -1;
        });
    }

    function ordenarPorEvento(lista) {
        return (lista || []).slice().sort(function (a, b) {
            var da = dataEvento(a);
            var db = dataEvento(b);
            if (da && db && da.iso !== db.iso) return da.iso < db.iso ? -1 : 1;
            if (da && !db) return -1;
            if (!da && db) return 1;
            return Number(b.id) - Number(a.id);
        });
    }

    function hojeIso() {
        return isoDeData(new Date());
    }

    function proximosEventos(lista, referenciaIso) {
        var hoje = referenciaIso || hojeIso();
        return ordenarPorEvento(lista).filter(function (orcamento) {
            var data = dataEvento(orcamento);
            return data && data.iso >= hoje;
        });
    }

    function nomeMes(ano, mes) {
        return MESES[mes - 1] + " de " + ano;
    }

    function gradeDoMes(ano, mes) {
        var primeiro = new Date(ano, mes - 1, 1);
        var folga = primeiro.getDay();
        var quantidade = new Date(ano, mes, 0).getDate();
        var celulas = [];
        var i;
        for (i = 0; i < folga; i++) {
            celulas.push(celulaDe(new Date(ano, mes - 1, 1 - (folga - i)), true));
        }
        for (i = 1; i <= quantidade; i++) {
            celulas.push(celulaDe(new Date(ano, mes - 1, i), false));
        }
        while (celulas.length % 7 !== 0) {
            var ultima = celulas[celulas.length - 1];
            celulas.push(celulaDe(new Date(ultima.ano, ultima.mes - 1, ultima.dia + 1), true));
        }
        return celulas;
    }

    function celulaDe(data, fora) {
        return {
            iso: isoDeData(data),
            ano: data.getFullYear(),
            mes: data.getMonth() + 1,
            dia: data.getDate(),
            fora: fora
        };
    }

    function carregar(callback) {
        function buscar() {
            var xhr = new XMLHttpRequest();
            xhr.open("GET", "/api/orcamentos", true);
            xhr.onload = function () {
                if (xhr.status === 401) {
                    window.location.replace("/admin/");
                    return;
                }
                if (xhr.status !== 200) {
                    callback(new Error("indisponivel"));
                    return;
                }
                try {
                    var dados = JSON.parse(xhr.responseText || "[]");
                    if (!Array.isArray(dados)) {
                        callback(new Error("indisponivel"));
                        return;
                    }
                    callback(null, dados);
                } catch (e) {
                    callback(new Error("indisponivel"));
                }
            };
            xhr.onerror = function () {
                callback(new Error("indisponivel"));
            };
            xhr.send();
        }
        if (typeof adminCarregarSessao === "function") {
            adminCarregarSessao(function (ok) {
                if (!ok) return;
                buscar();
            });
            return;
        }
        buscar();
    }

    return {
        escapar: escapar,
        nomeCliente: nomeCliente,
        dataEvento: dataEvento,
        formatarDataIso: formatarDataIso,
        statusChave: statusChave,
        rotuloStatus: rotuloStatus,
        valorFinal: valorFinal,
        pdfEmitido: pdfEmitido,
        eventoConfirmado: eventoConfirmado,
        hrefOrcamento: hrefOrcamento,
        filtrar: filtrar,
        ordenarPorEvento: ordenarPorEvento,
        hojeIso: hojeIso,
        proximosEventos: proximosEventos,
        nomeMes: nomeMes,
        gradeDoMes: gradeDoMes,
        carregar: carregar
    };
});
