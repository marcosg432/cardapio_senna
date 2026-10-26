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
    var pendente = null;
    var modal = document.getElementById("gestao-modal");
    var modalTitulo = document.getElementById("gestao-modal-titulo");
    var modalEvento = document.getElementById("gestao-modal-evento");
    var modalValor = document.getElementById("gestao-modal-valor");
    var modalErro = document.getElementById("gestao-modal-erro");
    var botaoConfirmar = document.getElementById("gestao-modal-confirmar");

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
        var confirmado = GestaoConsulta.contratoConfirmado(orcamento);
        var acao = confirmado
            ? '<span class="gestao-estado-confirmado">Confirmado</span>'
            : '<button type="button" class="gestao-confirmar" data-id="' + GestaoConsulta.escapar(orcamento.id) + '">Confirmar contrato</button>';
        return (
            "<tr>" +
            "<td>" + GestaoConsulta.escapar(GestaoConsulta.nomeCliente(orcamento) || "—") + "</td>" +
            "<td>" + GestaoConsulta.escapar(data ? GestaoConsulta.formatarDataIso(data.iso) : "—") + "</td>" +
            "<td>" + GestaoConsulta.escapar(valor) + "</td>" +
            "<td>" + GestaoConsulta.escapar(GestaoConsulta.rotuloStatus(chave)) + marcaPdf + "</td>" +
            "<td>" + GestaoConsulta.escapar(orcamento.id) + "</td>" +
            "<td>" + acao + ' <a class="gestao-abrir" href="' + GestaoConsulta.hrefOrcamento(orcamento.id) + '">Abrir</a></td>' +
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

    function fecharModal() {
        pendente = null;
        if (modal) modal.hidden = true;
        if (modalErro) modalErro.hidden = true;
        if (botaoConfirmar) botaoConfirmar.disabled = false;
    }

    function abrirModal(id) {
        var orcamento = lista.find(function (item) { return String(item.id) === String(id); });
        if (!orcamento || GestaoConsulta.contratoConfirmado(orcamento) || !modal) return;
        pendente = orcamento;
        var tipo = orcamento.tipo_evento || orcamento.evento_tipo || "Evento";
        var nome = GestaoConsulta.nomeCliente(orcamento) || "Cliente";
        var data = GestaoConsulta.dataEvento(orcamento);
        var valor = typeof formatarMoeda === "function"
            ? formatarMoeda(GestaoConsulta.valorFinal(orcamento))
            : String(GestaoConsulta.valorFinal(orcamento));
        modalTitulo.textContent = tipo + " — " + nome;
        modalEvento.textContent = "Evento: " + (data ? GestaoConsulta.formatarDataIso(data.iso) : "sem data");
        modalValor.textContent = "Valor final: " + valor;
        modalErro.hidden = true;
        modal.hidden = false;
        botaoConfirmar.focus();
    }

    function confirmarNoServidor() {
        if (!pendente || !botaoConfirmar) return;
        var id = pendente.id;
        botaoConfirmar.disabled = true;
        var xhr = new XMLHttpRequest();
        xhr.open("POST", "/api/orcamentos/" + encodeURIComponent(id) + "/confirmar-contrato", true);
        xhr.setRequestHeader("Content-Type", "application/json; charset=utf-8");
        if (typeof adminCsrfToken === "string" && adminCsrfToken) {
            xhr.setRequestHeader("X-CSRF-Token", adminCsrfToken);
        }
        xhr.onload = function () {
            botaoConfirmar.disabled = false;
            var dados = {};
            try { dados = JSON.parse(xhr.responseText || "{}"); } catch (e) { dados = {}; }
            if (xhr.status === 401) {
                window.location.replace("/admin/");
                return;
            }
            if (xhr.status !== 200 || !dados.gestao_contrato) {
                modalErro.hidden = false;
                modalErro.textContent = "Não foi possível confirmar o contrato.";
                return;
            }
            lista = lista.map(function (item) {
                if (String(item.id) !== String(id)) return item;
                var copia = Object.assign({}, item);
                copia.gestao_contrato = dados.gestao_contrato;
                return copia;
            });
            fecharModal();
            desenhar();
        };
        xhr.onerror = function () {
            botaoConfirmar.disabled = false;
            modalErro.hidden = false;
            modalErro.textContent = "Não foi possível confirmar o contrato.";
        };
        xhr.send("{}");
    }

    corpo.addEventListener("click", function (evento) {
        var botao = evento.target.closest(".gestao-confirmar");
        if (!botao) return;
        abrirModal(botao.getAttribute("data-id"));
    });
    document.getElementById("gestao-modal-cancelar").addEventListener("click", fecharModal);
    botaoConfirmar.addEventListener("click", confirmarNoServidor);
    modal.addEventListener("click", function (evento) {
        if (evento.target === modal) fecharModal();
    });

    busca.addEventListener("input", desenhar);
    filtro.addEventListener("change", desenhar);
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar);
    else iniciar();
})();
