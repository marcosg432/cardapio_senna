/**
 * Calendário mensal dos eventos já gravados nos orçamentos. Somente leitura.
 */
(function () {
    var estado = document.getElementById("agenda-estado");
    var grade = document.getElementById("agenda-grade");
    var titulo = document.getElementById("agenda-titulo");
    var listaDia = document.getElementById("agenda-dia-lista");
    if (!estado || !grade || !titulo || typeof GestaoConsulta === "undefined") return;

    var lista = [];
    var hoje = new Date();
    var ano = hoje.getFullYear();
    var mes = hoje.getMonth() + 1;
    var hojeIso = GestaoConsulta.hojeIso();

    function eventosDoDia(iso) {
        return lista.filter(function (orcamento) {
            var data = GestaoConsulta.dataEvento(orcamento);
            return data && data.iso === iso;
        });
    }

    function classeEvento(orcamento) {
        var confirmado = GestaoConsulta.contratoConfirmado(orcamento);
        var classes = "gestao-evento " + (confirmado ? "gestao-evento--confirmado" : "gestao-evento--nao-confirmado");
        if (GestaoConsulta.pdfEmitido(orcamento)) classes += " gestao-evento--pdf";
        return classes;
    }

    function rotuloSituacao(orcamento) {
        var pdf = GestaoConsulta.pdfEmitido(orcamento) ? "PDF emitido · " : "";
        return pdf + (GestaoConsulta.contratoConfirmado(orcamento) ? "confirmado" : "não confirmado");
    }

    function htmlEvento(orcamento) {
        var nome = GestaoConsulta.nomeCliente(orcamento) || "Orçamento";
        return (
            '<a class="' + classeEvento(orcamento) + '" href="' + GestaoConsulta.hrefOrcamento(orcamento.id) + '"' +
            ' title="' + GestaoConsulta.escapar(nome) + '">' +
            "<span>" + GestaoConsulta.escapar(nome) + "</span>" +
            (GestaoConsulta.pdfEmitido(orcamento) ? '<em>PDF</em>' : "") +
            "</a>"
        );
    }

    function desenharDiaSelecionado(iso) {
        if (!listaDia) return;
        var eventos = eventosDoDia(iso);
        var tituloDia = document.getElementById("agenda-dia-titulo");
        if (tituloDia) tituloDia.textContent = GestaoConsulta.formatarDataIso(iso);
        if (!eventos.length) {
            listaDia.innerHTML = '<p class="gestao-vazio">Nenhum evento nesta data.</p>';
            return;
        }
        listaDia.innerHTML = eventos.map(function (orcamento) {
            var nome = GestaoConsulta.nomeCliente(orcamento) || "Orçamento";
            return (
                '<a class="gestao-dia-item" href="' + GestaoConsulta.hrefOrcamento(orcamento.id) + '">' +
                "<strong>" + GestaoConsulta.escapar(nome) + "</strong>" +
                "<span>" + GestaoConsulta.escapar(GestaoConsulta.formatarDataIso(iso)) + "</span>" +
                "<span>" + GestaoConsulta.escapar(rotuloSituacao(orcamento)) + "</span>" +
                "</a>"
            );
        }).join("");
    }

    function desenhar() {
        titulo.textContent = GestaoConsulta.nomeMes(ano, mes);
        var celulas = GestaoConsulta.gradeDoMes(ano, mes);
        var cabecalho = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map(function (nome) {
            return '<span class="gestao-semana">' + nome + "</span>";
        }).join("");
        var dias = celulas.map(function (celula) {
            var eventos = eventosDoDia(celula.iso);
            var classes = "gestao-dia" + (celula.fora ? " gestao-dia--fora" : "") + (celula.iso === hojeIso ? " gestao-dia--hoje" : "");
            return (
                '<div class="' + classes + '" data-iso="' + celula.iso + '">' +
                '<button type="button" class="gestao-dia-num" data-iso="' + celula.iso + '">' + celula.dia + "</button>" +
                eventos.map(htmlEvento).join("") +
                "</div>"
            );
        }).join("");
        grade.innerHTML = cabecalho + dias;
        var noMes = lista.filter(function (orcamento) {
            var data = GestaoConsulta.dataEvento(orcamento);
            return data && data.ano === ano && data.mes === mes;
        });
        if (!lista.length) estado.textContent = "Nenhum orçamento cadastrado.";
        else if (!noMes.length) estado.textContent = "Nenhum evento neste mês.";
        else estado.textContent = noMes.length + (noMes.length === 1 ? " evento neste mês." : " eventos neste mês.");
        var selecionado = celulas.some(function (celula) { return celula.iso === hojeIso && !celula.fora; })
            ? hojeIso
            : celulas.filter(function (celula) { return !celula.fora; })[0].iso;
        desenharDiaSelecionado(selecionado);
    }

    grade.addEventListener("click", function (evento) {
        var alvo = evento.target.closest("[data-iso]");
        if (!alvo || alvo.classList.contains("gestao-evento")) return;
        desenharDiaSelecionado(alvo.getAttribute("data-iso"));
    });

    document.getElementById("agenda-anterior").addEventListener("click", function () {
        mes -= 1;
        if (mes < 1) { mes = 12; ano -= 1; }
        desenhar();
    });
    document.getElementById("agenda-proximo").addEventListener("click", function () {
        mes += 1;
        if (mes > 12) { mes = 1; ano += 1; }
        desenhar();
    });

    function iniciar() {
        estado.textContent = "Carregando orçamentos…";
        GestaoConsulta.carregar(function (erro, dados) {
            if (erro) {
                estado.textContent = "Não foi possível carregar os orçamentos.";
                grade.innerHTML = "";
                return;
            }
            lista = dados.filter(function (orcamento) {
                return GestaoConsulta.dataEvento(orcamento);
            });
            desenhar();
        });
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar);
    else iniciar();
})();
