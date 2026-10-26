/**
 * Resumo de consulta no dashboard. Não calcula saldo nem pagamento recebido.
 */
(function () {
    var orcamentos = document.getElementById("indicador-orcamentos");
    var confirmados = document.getElementById("indicador-confirmados");
    var pdfs = document.getElementById("indicador-pdfs");
    var eventos = document.getElementById("indicador-eventos");
    var lista = document.getElementById("lista-proximos");
    var nota = document.getElementById("nota-proximos");
    if (!orcamentos || !confirmados || !pdfs || !eventos || !lista || typeof GestaoConsulta === "undefined") return;

    function numero(el, valor) {
        el.textContent = String(valor);
        el.removeAttribute("aria-hidden");
    }

    function iniciar() {
        GestaoConsulta.carregar(function (erro, dados) {
            if (erro) {
                orcamentos.textContent = "—";
                confirmados.textContent = "—";
                pdfs.textContent = "—";
                eventos.textContent = "—";
                lista.innerHTML = '<p class="gestao-vazio">Não foi possível carregar os orçamentos.</p>';
                return;
            }
            var futuros = GestaoConsulta.proximosConfirmados(dados);
            numero(orcamentos, dados.length);
            numero(confirmados, dados.filter(GestaoConsulta.contratoConfirmado).length);
            numero(pdfs, dados.filter(GestaoConsulta.pdfEmitido).length);
            numero(eventos, futuros.length);
            if (!futuros.length) {
                lista.innerHTML = '<p class="gestao-vazio">Nenhum evento confirmado daqui para a frente.</p>';
                if (nota) nota.textContent = "Eventos sem aceite continuam só na agenda.";
                return;
            }
            lista.innerHTML = futuros.slice(0, 5).map(function (orcamento) {
                var data = GestaoConsulta.dataEvento(orcamento);
                var nome = GestaoConsulta.nomeCliente(orcamento) || "Orçamento";
                return (
                    '<a class="gestao-dia-item gestao-dia-item--confirmado" href="' + GestaoConsulta.hrefOrcamento(orcamento.id) + '">' +
                    "<strong>" + GestaoConsulta.escapar(nome) + "</strong>" +
                    "<span>" + GestaoConsulta.escapar(GestaoConsulta.formatarDataIso(data.iso)) + "</span>" +
                    "<span>Confirmado</span>" +
                    "</a>"
                );
            }).join("");
            if (nota) {
                nota.textContent = futuros.length > 5
                    ? "Mostrando os cinco próximos confirmados. A lista completa está na agenda."
                    : "Somente contratos com aceite manual.";
            }
        });
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar);
    else iniciar();
})();
