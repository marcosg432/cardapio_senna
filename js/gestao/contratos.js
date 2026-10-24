/**
 * Consulta dos orçamentos na página de contratos. Somente leitura.
 */
(function () {
    var estado = document.getElementById("gestao-contratos-estado");
    var tabela = document.getElementById("gestao-contratos-tabela");
    var corpo = document.getElementById("gestao-contratos-corpo");
    var busca = document.getElementById("gestao-busca");
    var filtro = document.getElementById("gestao-status");
    var resumo = document.getElementById("gestao-contratos-resumo");
    var lista = [];
    var pronto = false;

    if (!estado || !tabela || !corpo || typeof GestaoConsulta === "undefined") return;

    function mensagem(texto, visivel) {
        estado.hidden = !visivel;
        estado.textContent = texto;
        tabela.hidden = !visivel ? false : true;
    }

    function opcoesStatus() {
        var vistos = { todos: true };
        var html = '<option value="todos">Todos os status</option>';
        var rotulos = typeof CONFIG !== "undefined" && CONFIG.STATUS_LABELS ? CONFIG.STATUS_LABELS : {};
        Object.keys(rotulos).forEach(function (chave) {
            vistos[chave] = true;
            html += '<option value="' + GestaoConsulta.escapar(chave) + '">' + GestaoConsulta.escapar(rotulos[chave]) + "</option>";
        });
        lista.forEach(function (orcamento) {
            var chave = GestaoConsulta.statusChave(orcamento);
            if (vistos[chave]) return;
            vistos[chave] = true;
            html += '<option value="' + GestaoConsulta.escapar(chave) + '">' + GestaoConsulta.escapar(GestaoConsulta.rotuloStatus(chave)) + "</option>";
        });
        var atual = filtro.value || "todos";
        filtro.innerHTML = html;
        filtro.value = atual;
        if (filtro.value !== atual) filtro.value = "todos";
    }

    function linha(orcamento) {
        var data = GestaoConsulta.dataEvento(orcamento);
        var chave = GestaoConsulta.statusChave(orcamento);
        var valor = typeof formatarMoeda === "function"
            ? formatarMoeda(GestaoConsulta.valorFinal(orcamento))
            : String(GestaoConsulta.valorFinal(orcamento));
        var marcaPdf = GestaoConsulta.pdfEmitido(orcamento)
            ? '<span class="gestao-marca-pdf">PDF emitido</span>'
            : "";
        return (
            "<tr>" +
            "<td>" + GestaoConsulta.escapar(GestaoConsulta.nomeCliente(orcamento) || "—") + "</td>" +
            "<td>" + GestaoConsulta.escapar(data ? GestaoConsulta.formatarDataIso(data.iso) : "—") + "</td>" +
            "<td>" + GestaoConsulta.escapar(valor) + "</td>" +
            "<td>" + GestaoConsulta.escapar(GestaoConsulta.rotuloStatus(chave)) + marcaPdf + "</td>" +
            "<td>" + GestaoConsulta.escapar(orcamento.id) + "</td>" +
            '<td><a class="gestao-abrir" href="' + GestaoConsulta.hrefOrcamento(orcamento.id) + '">Abrir</a></td>' +
            "</tr>"
        );
    }

    function desenhar() {
        if (!pronto) return;
        var visiveis = GestaoConsulta.filtrar(lista, {
            busca: busca.value,
            status: filtro.value
        });
        if (!lista.length) {
            mensagem("Nenhum orçamento cadastrado.", true);
            if (resumo) resumo.textContent = "";
            return;
        }
        if (!visiveis.length) {
            mensagem("Nenhum orçamento encontrado para essa busca.", true);
            if (resumo) resumo.textContent = "0 de " + lista.length;
            return;
        }
        corpo.innerHTML = visiveis.map(linha).join("");
        mensagem("", false);
        if (resumo) resumo.textContent = visiveis.length + " de " + lista.length;
    }

    function iniciar() {
        mensagem("Carregando orçamentos…", true);
        GestaoConsulta.carregar(function (erro, dados) {
            if (erro) {
                mensagem("Não foi possível carregar os orçamentos.", true);
                return;
            }
            lista = dados;
            pronto = true;
            opcoesStatus();
            desenhar();
        });
    }

    busca.addEventListener("input", desenhar);
    filtro.addEventListener("change", desenhar);
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar);
    else iniciar();
})();
