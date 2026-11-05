/**
 * Financeiro dos contratos confirmados.
 * Converte o valor digitado para centavos e o servidor valida de novo.
 */
(function () {
    var totalContratado = document.getElementById("financeiro-total-contratado");
    var totalRecebido = document.getElementById("financeiro-total-recebido");
    var totalPendente = document.getElementById("financeiro-total-pendente");
    var estado = document.getElementById("financeiro-estado");
    var tabela = document.getElementById("financeiro-tabela");
    var corpo = document.getElementById("financeiro-corpo");
    var detalhe = document.getElementById("financeiro-detalhe");
    var formulario = document.getElementById("financeiro-form");
    var mensagem = document.getElementById("financeiro-mensagem");
    var modal = document.getElementById("financeiro-modal");
    var modalResumo = document.getElementById("financeiro-modal-resumo");
    var modalErro = document.getElementById("financeiro-modal-erro");
    var botaoConfirmar = document.getElementById("financeiro-modal-confirmar");
    if (!totalContratado || !corpo || typeof GestaoConsulta === "undefined") return;

    var contratoAberto = null;
    var lancamento = null;
    var enviando = false;
    var contratosTodos = [];
    var fichas = {};
    var FORMAS = {
        pix: "PIX",
        dinheiro: "Dinheiro",
        transferencia: "Transferência",
        cartao: "Cartão",
        boleto: "Boleto",
        outro: "Outro"
    };

    function escapar(valor) {
        return GestaoConsulta.escapar(valor);
    }

    function formatarCentavos(centavos) {
        var numero = Number(centavos);
        if (!Number.isInteger(numero)) return "—";
        var negativo = numero < 0;
        var absoluto = Math.abs(numero);
        var reais = String(Math.floor(absoluto / 100));
        var frac = String(absoluto % 100).padStart(2, "0");
        reais = reais.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
        return (negativo ? "-" : "") + "R$ " + reais + "," + frac;
    }

    function reaisParaCentavos(texto) {
        var limpo = String(texto || "").trim().replace(/\s/g, "");
        if (!limpo) return null;
        var virgula = limpo.lastIndexOf(",");
        var ponto = limpo.lastIndexOf(".");
        var inteiro = limpo;
        var decimal = "";
        if (virgula >= 0 && virgula > ponto) {
            decimal = limpo.slice(virgula + 1);
            inteiro = limpo.slice(0, virgula).replace(/\./g, "");
        } else if (ponto >= 0 && limpo.slice(ponto + 1).length <= 2 && virgula < 0) {
            decimal = limpo.slice(ponto + 1);
            inteiro = limpo.slice(0, ponto).replace(/\./g, "");
        } else {
            inteiro = limpo.replace(/\./g, "");
        }
        if (!/^\d+$/.test(inteiro) || (decimal && !/^\d{1,2}$/.test(decimal))) return null;
        if (decimal.length === 1) decimal += "0";
        if (!decimal) decimal = "00";
        var centavos = Number(inteiro) * 100 + Number(decimal);
        if (!Number.isSafeInteger(centavos) || centavos <= 0) return null;
        return centavos;
    }

    function hojeIso() {
        var data = new Date();
        var mes = String(data.getMonth() + 1).padStart(2, "0");
        var dia = String(data.getDate()).padStart(2, "0");
        return data.getFullYear() + "-" + mes + "-" + dia;
    }

    function mostrarMensagem(texto, erro) {
        mensagem.hidden = !texto;
        mensagem.textContent = texto || "";
        mensagem.className = erro ? "gestao-mensagem gestao-mensagem--erro" : "gestao-mensagem";
    }

    function pedir(method, caminho, corpo, callback) {
        var xhr = new XMLHttpRequest();
        xhr.open(method, caminho, true);
        xhr.withCredentials = true;
        if (corpo) {
            xhr.setRequestHeader("Content-Type", "application/json; charset=utf-8");
            if (typeof adminCsrfToken === "string" && adminCsrfToken) {
                xhr.setRequestHeader("X-CSRF-Token", adminCsrfToken);
            }
        }
        xhr.onload = function () {
            if (xhr.status === 401) {
                window.location.replace("/admin/");
                return;
            }
            var dados = null;
            try { dados = JSON.parse(xhr.responseText || "null"); } catch (e) { dados = null; }
            callback(xhr.status, dados);
        };
        xhr.onerror = function () { callback(0, null); };
        xhr.send(corpo ? JSON.stringify(corpo) : null);
    }

    function preencherTotais(totais) {
        totalContratado.textContent = formatarCentavos(totais.contratado_centavos);
        totalRecebido.textContent = formatarCentavos(totais.recebido_centavos);
        totalPendente.textContent = formatarCentavos(totais.pendente_centavos);
    }

    function semAcento(valor) {
        if (typeof GestaoConsulta.semAcento === "function") return GestaoConsulta.semAcento(valor);
        return String(valor || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
    }

    function lerFiltros() {
        return {
            texto: semAcento(valorCampo("financeiro-busca")),
            inicio: valorCampo("financeiro-data-inicial"),
            fim: valorCampo("financeiro-data-final")
        };
    }

    function valorCampo(id) {
        var el = document.getElementById(id);
        return el ? String(el.value || "").trim() : "";
    }

    function filtrosAtivos(filtros) {
        return !!(filtros.texto || filtros.inicio || filtros.fim);
    }

    function textoPesquisavel(contrato) {
        var extra = fichas[String(contrato.id)] || {};
        return semAcento([
            contrato.nome_cliente,
            contrato.id,
            extra.contratante,
            extra.outroNome,
            extra.casal,
            extra.numero
        ].join(" "));
    }

    function dentroDoPeriodo(contrato, inicio, fim) {
        if (!inicio && !fim) return true;
        if (!contrato.data_evento) return false;
        if (inicio && contrato.data_evento < inicio) return false;
        if (fim && contrato.data_evento > fim) return false;
        return true;
    }

    function selecionarContratos(lista) {
        var filtros = lerFiltros();
        if (filtros.inicio && filtros.fim && filtros.inicio > filtros.fim) {
            return { itens: [], aviso: "A data inicial é posterior à data final." };
        }
        return {
            itens: (lista || []).filter(function (contrato) {
                if (!dentroDoPeriodo(contrato, filtros.inicio, filtros.fim)) return false;
                if (!filtros.texto) return true;
                return textoPesquisavel(contrato).indexOf(filtros.texto) !== -1;
            }),
            aviso: ""
        };
    }

    function atualizarResumo(total, visiveis, ativo) {
        var resumo = document.getElementById("financeiro-busca-resumo");
        if (!resumo) return;
        if (!total || !ativo) {
            resumo.textContent = "";
            return;
        }
        resumo.textContent = visiveis + " de " + total + (total === 1 ? " contrato." : " contratos.");
    }

    function desenharLista(dados) {
        contratosTodos = dados.contratos || [];
        preencherTotais(dados.totais || {});
        renderLista();
    }

    function renderLista() {
        var filtros = document.getElementById("financeiro-filtros");
        var semResultado = document.getElementById("financeiro-sem-resultado");
        if (!contratosTodos.length) {
            if (filtros) filtros.hidden = true;
            estado.hidden = false;
            estado.textContent = "Nenhum contrato confirmado. Confirme o contrato na tela de detalhes ou em Gestão, Contratos. O pagamento só aparece depois dessa confirmação.";
            tabela.hidden = true;
            if (semResultado) semResultado.hidden = true;
            atualizarResumo(0, 0, false);
            corpo.innerHTML = "";
            return;
        }
        if (filtros) filtros.hidden = false;
        var selecionados = selecionarContratos(contratosTodos);
        var ativos = filtrosAtivos(lerFiltros());
        atualizarResumo(contratosTodos.length, selecionados.itens.length, ativos);
        if (!selecionados.itens.length) {
            estado.hidden = true;
            tabela.hidden = true;
            if (semResultado) {
                semResultado.hidden = false;
                semResultado.textContent = selecionados.aviso || "Nenhum contrato encontrado com esses filtros.";
            }
            corpo.innerHTML = "";
            return;
        }
        if (semResultado) semResultado.hidden = true;
        estado.hidden = true;
        tabela.hidden = false;
        corpo.innerHTML = selecionados.itens.map(function (contrato) {
            var data = contrato.data_evento ? GestaoConsulta.formatarDataIso(contrato.data_evento) : "—";
            var contratado = contrato.congelado ? formatarCentavos(contrato.valor_contratado_centavos) : "Não congelado";
            var recebido = contrato.congelado ? formatarCentavos(contrato.recebido_centavos) : "—";
            var pendente = contrato.congelado ? formatarCentavos(contrato.pendente_centavos) : "—";
            return (
                "<tr data-id=\"" + escapar(contrato.id) + "\">" +
                "<td>" + escapar(contrato.nome_cliente || "Orçamento") + "</td>" +
                "<td>" + escapar(data) + "</td>" +
                "<td>" + escapar(contratado) + "</td>" +
                "<td>" + escapar(recebido) + "</td>" +
                "<td>" + escapar(pendente) + "</td>" +
                "<td><button type=\"button\" class=\"gestao-confirmar\" data-id=\"" + escapar(contrato.id) + "\">Ver financeiro</button></td>" +
                "</tr>"
            );
        }).join("");
    }

    function montarFichas(lista) {
        fichas = {};
        (lista || []).forEach(function (orcamento) {
            if (!orcamento || orcamento.id == null) return;
            fichas[String(orcamento.id)] = {
                contratante: orcamento.nome_cliente || "",
                outroNome: orcamento.cliente || "",
                casal: orcamento.contato_nome || orcamento.nome_casal || orcamento.casal || "",
                numero: orcamento.contrato_numero_exibicao || ""
            };
        });
    }

    function limparFiltros() {
        ["financeiro-busca", "financeiro-data-inicial", "financeiro-data-final"].forEach(function (id) {
            var el = document.getElementById(id);
            if (el) el.value = "";
        });
        renderLista();
        var busca = document.getElementById("financeiro-busca");
        if (busca) busca.focus();
    }

    function desenharDetalhe(contrato) {
        contratoAberto = contrato;
        detalhe.hidden = false;
        document.getElementById("financeiro-detalhe-nome").textContent = contrato.nome_cliente || "Orçamento";
        var data = contrato.data_evento ? GestaoConsulta.formatarDataIso(contrato.data_evento) : "sem data";
        document.getElementById("financeiro-detalhe-meta").textContent = "Evento em " + data + " · Orçamento " + contrato.id;
        document.getElementById("financeiro-detalhe-contratado").textContent = contrato.congelado
            ? formatarCentavos(contrato.valor_contratado_centavos) : "—";
        document.getElementById("financeiro-detalhe-recebido").textContent = contrato.congelado
            ? formatarCentavos(contrato.recebido_centavos) : "—";
        document.getElementById("financeiro-detalhe-pendente").textContent = contrato.congelado
            ? formatarCentavos(contrato.pendente_centavos) : "—";
        var entrada = contrato.entrada_prevista_centavos;
        document.getElementById("financeiro-detalhe-entrada").textContent = entrada == null
            ? "Entrada prevista: valor indisponível. Ela não entra nos pagamentos recebidos."
            : "Entrada prevista: " + formatarCentavos(entrada) + ". Este valor não é um pagamento recebido.";
        var historico = contrato.historico || [];
        var caixa = document.getElementById("financeiro-historico");
        if (!historico.length) {
            caixa.innerHTML = "<p class=\"gestao-vazio\">Nenhum pagamento registrado.</p>";
        } else {
            caixa.innerHTML = "<div class=\"gestao-tabela-reserva\"><table><thead><tr><th>Data</th><th>Valor</th><th>Forma</th></tr></thead><tbody>" +
                historico.map(function (item) {
                    return "<tr><td>" + escapar(GestaoConsulta.formatarDataIso(item.pago_em)) + "</td><td>" +
                        escapar(formatarCentavos(item.valor_centavos)) + "</td><td>" +
                        escapar(FORMAS[item.forma] || item.forma) + "</td></tr>";
                }).join("") + "</tbody></table></div>";
        }
        var semCongelamento = document.getElementById("financeiro-sem-congelamento");
        var botaoPdf = document.getElementById("financeiro-demonstrativo");
        semCongelamento.hidden = !!contrato.congelado;
        formulario.hidden = !contrato.congelado;
        if (botaoPdf) botaoPdf.hidden = !contrato.congelado;
        document.getElementById("financeiro-data").max = hojeIso();
        mostrarMensagem("");
        detalhe.scrollIntoView({ block: "nearest" });
    }

    function carregarLista(callback) {
        pedir("GET", "/api/financeiro/contratos", null, function (status, dados) {
            if (status === 404) {
                estado.hidden = false;
                estado.textContent = "O financeiro ainda não foi ativado neste servidor.";
                tabela.hidden = true;
                totalContratado.textContent = "—";
                totalRecebido.textContent = "—";
                totalPendente.textContent = "—";
                return;
            }
            if (status !== 200 || !dados) {
                estado.hidden = false;
                estado.textContent = "Não foi possível carregar os contratos.";
                tabela.hidden = true;
                return;
            }
            desenharLista(dados);
            if (callback) callback();
        });
    }

    function abrir(id) {
        pedir("GET", "/api/financeiro/contratos/" + encodeURIComponent(id), null, function (status, dados) {
            if (status === 409) {
                mostrarMensagem("Confirme o contrato antes de registrar pagamentos.", true);
                return;
            }
            if (status !== 200 || !dados) {
                mostrarMensagem("Não foi possível abrir o contrato.", true);
                return;
            }
            desenharDetalhe(dados);
            if (window.location.hash === "#pagamento") {
                var campo = document.getElementById("financeiro-valor");
                if (campo) campo.focus();
            }
        });
    }

    function fecharModal() {
        modal.hidden = true;
        modalErro.hidden = true;
        botaoConfirmar.disabled = false;
        if (!enviando) lancamento = null;
    }

    function abrirModal(evento) {
        evento.preventDefault();
        if (!contratoAberto || !contratoAberto.congelado) return;
        var centavos = reaisParaCentavos(document.getElementById("financeiro-valor").value);
        var data = document.getElementById("financeiro-data").value;
        var forma = document.getElementById("financeiro-forma").value;
        if (!centavos) {
            mostrarMensagem("Informe um valor recebido maior que zero, com até duas casas.", true);
            return;
        }
        if (!data || data > hojeIso()) {
            mostrarMensagem("Informe uma data de pagamento válida, até hoje.", true);
            return;
        }
        if (!FORMAS[forma]) {
            mostrarMensagem("Escolha a forma de pagamento.", true);
            return;
        }
        if (!lancamento) {
            var bytes = new Uint8Array(16);
            crypto.getRandomValues(bytes);
            lancamento = {
                chave: Array.prototype.map.call(bytes, function (n) { return n.toString(16).padStart(2, "0"); }).join(""),
                valor_centavos: centavos,
                pago_em: data,
                forma: forma
            };
        } else if (lancamento.valor_centavos !== centavos || lancamento.pago_em !== data || lancamento.forma !== forma) {
            mostrarMensagem("O lançamento anterior não foi concluído. Use os mesmos dados ou cancele antes de alterar.", true);
            return;
        }
        modalResumo.textContent = formatarCentavos(centavos) + " em " + FORMAS[forma] + ", no dia " + GestaoConsulta.formatarDataIso(data) + ".";
        modalErro.hidden = true;
        modal.hidden = false;
        botaoConfirmar.focus();
    }

    function confirmarLancamento() {
        if (!lancamento || !contratoAberto || enviando) return;
        enviando = true;
        botaoConfirmar.disabled = true;
        pedir("POST", "/api/financeiro/contratos/" + encodeURIComponent(contratoAberto.id) + "/pagamentos", {
            valor_centavos: lancamento.valor_centavos,
            pago_em: lancamento.pago_em,
            forma: lancamento.forma,
            chave_idempotencia: lancamento.chave
        }, function (status, dados) {
            enviando = false;
            botaoConfirmar.disabled = false;
            if (status !== 200 && status !== 201) {
                modalErro.hidden = false;
                modalErro.textContent = dados && dados.erro ? dados.erro : "Não foi possível registrar o pagamento.";
                return;
            }
            var id = contratoAberto.id;
            lancamento = null;
            document.getElementById("financeiro-valor").value = "";
            modal.hidden = true;
            carregarLista(function () {
                abrir(id);
                mostrarMensagem(dados.repetida ? "Este lançamento já estava registrado." : "Pagamento registrado.", false);
            });
        });
    }

    function nomeArquivoPdf(cabecalho, id) {
        var match = /filename="(demonstrativo-financeiro-\d+\.pdf)"/.exec(String(cabecalho || ""));
        return match ? match[1] : "demonstrativo-financeiro-" + id + ".pdf";
    }

    function gerarDemonstrativo() {
        if (!contratoAberto || !contratoAberto.congelado || !contratoAberto.id) return;
        var botao = document.getElementById("financeiro-demonstrativo");
        var id = contratoAberto.id;
        if (botao) botao.disabled = true;
        var xhr = new XMLHttpRequest();
        xhr.open("GET", "/api/financeiro/contratos/" + encodeURIComponent(id) + "/demonstrativo", true);
        xhr.withCredentials = true;
        xhr.responseType = "blob";
        xhr.onload = function () {
            if (botao) botao.disabled = false;
            var tipo = xhr.getResponseHeader("Content-Type") || "";
            if (xhr.status !== 200 || tipo.indexOf("application/pdf") !== 0 || !xhr.response) {
                mostrarMensagem("Não foi possível gerar o demonstrativo.", true);
                return;
            }
            var url = URL.createObjectURL(xhr.response);
            var link = document.createElement("a");
            link.href = url;
            link.download = nomeArquivoPdf(xhr.getResponseHeader("Content-Disposition"), id);
            document.body.appendChild(link);
            link.click();
            link.remove();
            setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
            mostrarMensagem("Demonstrativo gerado.", false);
        };
        xhr.onerror = function () {
            if (botao) botao.disabled = false;
            mostrarMensagem("Não foi possível gerar o demonstrativo.", true);
        };
        xhr.send();
    }

    document.getElementById("financeiro-demonstrativo").addEventListener("click", gerarDemonstrativo);
    var formularioFiltros = document.getElementById("financeiro-filtros");
    if (formularioFiltros) {
        formularioFiltros.addEventListener("submit", function (evento) {
            evento.preventDefault();
            renderLista();
        });
    }
    var campoBusca = document.getElementById("financeiro-busca");
    if (campoBusca) campoBusca.addEventListener("input", renderLista);
    ["financeiro-data-inicial", "financeiro-data-final"].forEach(function (id) {
        var campo = document.getElementById(id);
        if (campo) campo.addEventListener("change", renderLista);
    });
    var botaoLimpar = document.getElementById("financeiro-limpar");
    if (botaoLimpar) botaoLimpar.addEventListener("click", limparFiltros);
    corpo.addEventListener("click", function (evento) {
        var botao = evento.target.closest("button");
        if (!botao) return;
        abrir(botao.getAttribute("data-id"));
    });
    formulario.addEventListener("submit", abrirModal);
    document.getElementById("financeiro-modal-cancelar").addEventListener("click", function () {
        lancamento = null;
        fecharModal();
    });
    botaoConfirmar.addEventListener("click", confirmarLancamento);
    modal.addEventListener("click", function (evento) {
        if (evento.target === modal) {
            lancamento = null;
            fecharModal();
        }
    });

    function iniciar() {
        carregarLista(function () {
            var id = "";
            try { id = new URLSearchParams(window.location.search).get("contrato") || ""; } catch (e) { id = ""; }
            if (id) abrir(id);
        });
        GestaoConsulta.carregar(function (erro, dados) {
            if (erro || !Array.isArray(dados)) return;
            montarFichas(dados);
            if (contratosTodos.length) renderLista();
        });
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar);
    else iniciar();
})();
