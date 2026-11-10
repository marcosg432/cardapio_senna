/**
 * Produção da cozinha. Só consulta o servidor e baixa os PDFs oficiais.
 */
(function () {
    var estado = document.getElementById("producao-estado");
    var tabela = document.getElementById("producao-tabela");
    var corpo = document.getElementById("producao-corpo");
    var detalhe = document.getElementById("producao-detalhe");
    var mensagem = document.getElementById("producao-mensagem");
    var campoData = document.getElementById("producao-data");
    if (!estado || !corpo || typeof GestaoConsulta === "undefined") return;

    function escapar(valor) {
        return GestaoConsulta.escapar(valor);
    }

    function dataTexto(iso) {
        return iso ? GestaoConsulta.formatarDataIso(iso) : "—";
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

    function pedir(caminho, callback) {
        var xhr = new XMLHttpRequest();
        xhr.open("GET", caminho, true);
        xhr.withCredentials = true;
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
        xhr.send();
    }

    function baixar(caminho, botao) {
        if (botao) botao.disabled = true;
        var xhr = new XMLHttpRequest();
        xhr.open("GET", caminho, true);
        xhr.withCredentials = true;
        xhr.responseType = "blob";
        xhr.onload = function () {
            if (botao) botao.disabled = false;
            var tipo = xhr.getResponseHeader("Content-Type") || "";
            if (xhr.status !== 200 || tipo.indexOf("application/pdf") !== 0 || !xhr.response) {
                lerErroPdf(xhr.response, function (texto) {
                    mostrarMensagem(texto || "Não foi possível gerar o PDF de consulta.", true);
                });
                return;
            }
            var cabecalho = xhr.getResponseHeader("Content-Disposition") || "";
            var match = /filename="([^"]+)"/.exec(cabecalho);
            var url = URL.createObjectURL(xhr.response);
            var link = document.createElement("a");
            link.href = url;
            link.download = match ? match[1] : "producao.pdf";
            document.body.appendChild(link);
            link.click();
            link.remove();
            setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
            mostrarMensagem("PDF de consulta gerado.", false);
        };
        xhr.onerror = function () {
            if (botao) botao.disabled = false;
            mostrarMensagem("Não foi possível gerar o PDF de consulta.", true);
        };
        xhr.send();
    }

    function lerErroPdf(blob, callback) {
        if (!blob) {
            callback("");
            return;
        }
        var leitor = new FileReader();
        leitor.onload = function () {
            var texto = "";
            try {
                var dados = JSON.parse(String(leitor.result || ""));
                texto = dados && dados.erro ? dados.erro : "";
            } catch (e) {
                texto = "";
            }
            callback(texto);
        };
        leitor.onerror = function () { callback(""); };
        leitor.readAsText(blob);
    }

    function desenharLista(dados) {
        var eventos = dados && dados.eventos || [];
        if (!eventos.length) {
            estado.hidden = false;
            estado.textContent = "Nenhum contrato confirmado.";
            tabela.hidden = true;
            corpo.innerHTML = "";
            return;
        }
        estado.hidden = true;
        tabela.hidden = false;
        corpo.innerHTML = eventos.map(function (evento) {
            var nome = evento.casal || evento.nome_cliente || "—";
            var numero = evento.numero_contrato || evento.id;
            var doces = evento.doces_total == null ? "—" : evento.doces_total;
            if (evento.doces_parcial || evento.doces_pendencias) doces += " · parcial";
            return (
                "<tr>" +
                "<td>" + escapar(dataTexto(evento.data_evento)) + "</td>" +
                "<td>" + escapar(nome) + "<br>Contrato " + escapar(numero) +
                (evento.tipo_evento ? "<br>" + escapar(evento.tipo_evento) : "") + "</td>" +
                "<td class=\"producao-qtd\">" + escapar(doces) + "</td>" +
                "<td>" + escapar(evento.situacao) + "</td>" +
                "<td><div class=\"producao-acoes\">" +
                "<button type=\"button\" class=\"gestao-confirmar\" data-acao=\"ver\" data-id=\"" + escapar(evento.id) + "\">Ver produção</button>" +
                "<button type=\"button\" class=\"gestao-confirmar\" data-acao=\"pdf\" data-id=\"" + escapar(evento.id) + "\">Gerar Ordem de Serviço</button>" +
                "</div></td></tr>"
            );
        }).join("");
    }

    function itemLista(rotulo, valor) {
        if (valor == null || valor === "") return "";
        return "<li><strong>" + escapar(rotulo) + ":</strong> " + escapar(valor) + "</li>";
    }

    function desenharDetalhe(evento) {
        document.getElementById("producao-detalhe-titulo").textContent = evento.tipo_evento || "Evento";
        document.getElementById("producao-detalhe-meta").textContent = "Contrato " + evento.id + " · " + dataTexto(evento.data_evento);
        document.getElementById("producao-detalhe-dados").innerHTML = [
            itemLista("Convidados", evento.convidados),
            itemLista("Entrega ou retirada", evento.horario_entrega),
            itemLista("Festa", evento.horario_festa),
            itemLista("Modalidade", evento.modalidade)
        ].join("");
        var avisos = document.getElementById("producao-detalhe-avisos");
        var semUnidade = (evento.itens || []).filter(function (item) {
            return item.valido !== false && !item.unidade;
        }).length;
        var notas = (evento.avisos || []).slice();
        if (evento.doces_texto) notas.unshift(evento.doces_texto);
        if (evento.doces_aviso) notas.push(evento.doces_aviso);
        if (semUnidade) notas.push("Há produtos sem unidade. A quantidade gravada entra na soma como unidades.");
        avisos.innerHTML = notas.map(function (aviso) {
            return "<p class=\"producao-aviso\">" + escapar(aviso) + "</p>";
        }).join("");
        var itens = evento.itens || [];
        document.getElementById("producao-detalhe-itens").innerHTML = itens.length ? itens.map(function (item) {
            return (
                "<tr><td>" + escapar(item.nome) + "</td>" +
                "<td class=\"producao-qtd\">" + escapar(item.quantidade_texto) + "</td>" +
                "<td>" + escapar(item.unidade) + "</td>" +
                "<td>" + (item.complementar ? "Sim" : "—") + "</td></tr>"
            );
        }).join("") : "<tr><td colspan=\"4\">Nenhum produto contratado.</td></tr>";
        var botaoOs = document.getElementById("producao-detalhe-os");
        if (botaoOs) botaoOs.setAttribute("data-id", evento.id);
        var linhaDoces = document.getElementById("producao-detalhe-doces");
        if (linhaDoces) linhaDoces.textContent = evento.doces_texto || "";
        detalhe.hidden = false;
        detalhe.scrollIntoView({ block: "nearest" });
    }

    function desenharDia(dia) {
        var vazio = document.getElementById("producao-dia-estado");
        var grade = document.getElementById("producao-dia-tabela");
        var eventos = document.getElementById("producao-dia-eventos");
        var totais = dia && dia.totais || [];
        var lista = dia && dia.eventos || [];
        var linhaDoces = document.getElementById("producao-dia-doces");
        if (!lista.length) {
            vazio.hidden = false;
            vazio.textContent = "Nenhum evento confirmado nesta data.";
            grade.hidden = true;
            eventos.innerHTML = "";
            if (linhaDoces) linhaDoces.textContent = "";
            return;
        }
        vazio.hidden = true;
        if (linhaDoces) {
            linhaDoces.textContent = "Quantidade total de doces: " + (dia.doces_total == null ? 0 : dia.doces_total) +
                (dia.doces_parcial ? " (parcial)" : "");
        }
        grade.hidden = false;
        document.getElementById("producao-dia-corpo").innerHTML = totais.map(function (item) {
            return (
                "<tr><td>" + escapar(item.nome) + "</td>" +
                "<td class=\"producao-qtd\">" + escapar(item.quantidade_texto) + "</td>" +
                "<td>" + escapar(item.unidade) + "</td></tr>"
            );
        }).join("") || "<tr><td colspan=\"3\">Nenhum produto com quantidade válida.</td></tr>";
        eventos.innerHTML = lista.map(function (evento) {
            var produtos = (evento.itens || []).map(function (item) {
                return "<li>" + escapar(item.quantidade_texto) + " · " + escapar(item.nome) + " · " + escapar(item.unidade) + "</li>";
            }).join("");
            return (
                "<section><h3 class=\"gestao-subtitulo\">Contrato " + escapar(evento.id) + " · " + escapar(evento.tipo_evento || "Evento") + "</h3><ul>" +
                produtos + "</ul></section>"
            );
        }).join("");
    }

    function carregarLista() {
        pedir("/api/producao/eventos", function (status, dados) {
            if (status !== 200 || !dados) {
                estado.hidden = false;
                estado.textContent = "Não foi possível carregar a produção.";
                tabela.hidden = true;
                return;
            }
            desenharLista(dados);
        });
    }

    function carregarDia() {
        if (!campoData.value) return;
        pedir("/api/producao/datas/" + encodeURIComponent(campoData.value), function (status, dados) {
            if (status !== 200 || !dados) {
                mostrarMensagem("Não foi possível consultar o dia.", true);
                return;
            }
            desenharDia(dados);
        });
    }

    corpo.addEventListener("click", function (evento) {
        var botao = evento.target.closest("button");
        if (!botao) return;
        var id = botao.getAttribute("data-id");
        if (botao.getAttribute("data-acao") === "pdf") {
            baixar("/api/producao/eventos/" + encodeURIComponent(id) + "/pdf", botao);
            return;
        }
        pedir("/api/producao/eventos/" + encodeURIComponent(id), function (status, dados) {
            if (status !== 200 || !dados) {
                mostrarMensagem("Não foi possível abrir a produção.", true);
                return;
            }
            desenharDetalhe(dados);
        });
    });

    function isoDe(data) {
        var mes = String(data.getMonth() + 1).padStart(2, "0");
        var dia = String(data.getDate()).padStart(2, "0");
        return data.getFullYear() + "-" + mes + "-" + dia;
    }

    function desenharPeriodo(periodo) {
        var estadoPeriodo = document.getElementById("producao-periodo-estado");
        var caixa = document.getElementById("producao-periodo-resultado");
        var eventos = periodo && periodo.eventos || [];
        if (!eventos.length) {
            estadoPeriodo.hidden = false;
            estadoPeriodo.textContent = periodo && periodo.visao === "planejamento"
                ? "Nenhum evento neste período, nem entre os pedidos antecipados."
                : "Nenhum contrato confirmado neste período.";
            caixa.innerHTML = "";
            return;
        }
        estadoPeriodo.hidden = true;
        var linhas = (periodo.totais || []).map(function (item) {
            return "<li>" + escapar(item.quantidade_texto) + " · " + escapar(item.nome) +
                (item.unidade ? " · " + escapar(item.unidade) : "") + "</li>";
        }).join("");
        var eventosHtml = eventos.map(function (evento) {
            var nome = evento.casal || evento.nome_cliente || "Nome não informado";
            var marca = evento.planejamento ? " · planejamento, ainda não confirmado" : "";
            return "<li>" + escapar(dataTexto(evento.data_evento)) + " · " + escapar(nome) +
                " · Contrato " + escapar(evento.numero_contrato || evento.id) + marca +
                " · " + escapar(evento.doces_total == null ? "—" : evento.doces_total) + " doces" +
                (evento.doces_parcial || evento.doces_pendencias ? " (parcial)" : "") + "</li>";
        }).join("");
        caixa.innerHTML = "<p class=\"gestao-nota\">" + escapar(periodo.rotulo || "Produção do período") +
            " · " + escapar(periodo.data_texto || "") +
            "<br>Quantidade total de doces: " + escapar(periodo.doces_total) +
            (periodo.doces_parcial ? " (parcial)" : "") + "</p>" +
            "<ul>" + linhas + "</ul><ul>" + eventosHtml + "</ul>";
    }

    function carregarPeriodo() {
        var de = document.getElementById("producao-periodo-de").value;
        var ate = document.getElementById("producao-periodo-ate").value;
        var visao = document.getElementById("producao-periodo-visao").value;
        if (!de || !ate) return;
        pedir("/api/producao/periodo?de=" + encodeURIComponent(de) + "&ate=" + encodeURIComponent(ate) + "&visao=" + encodeURIComponent(visao), function (status, dados) {
            if (status !== 200 || !dados) {
                mostrarMensagem("Não foi possível consultar o período.", true);
                return;
            }
            desenharPeriodo(dados);
        });
    }

    document.getElementById("producao-semana").addEventListener("click", function () {
        var hoje = new Date();
        var distancia = hoje.getDay() === 0 ? -6 : 1 - hoje.getDay();
        var inicio = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() + distancia);
        var fim = new Date(inicio.getFullYear(), inicio.getMonth(), inicio.getDate() + 6);
        document.getElementById("producao-periodo-de").value = isoDe(inicio);
        document.getElementById("producao-periodo-ate").value = isoDe(fim);
        carregarPeriodo();
    });
    document.getElementById("producao-detalhe-os").addEventListener("click", function () {
        var id = this.getAttribute("data-id");
        if (!id) return;
        baixar("/api/producao/eventos/" + encodeURIComponent(id) + "/pdf", this);
    });
    document.getElementById("producao-periodo-ver").addEventListener("click", carregarPeriodo);
    document.getElementById("producao-periodo-pdf").addEventListener("click", function () {
        var de = document.getElementById("producao-periodo-de").value;
        var ate = document.getElementById("producao-periodo-ate").value;
        var visao = document.getElementById("producao-periodo-visao").value;
        if (!de || !ate) return;
        baixar("/api/producao/periodo/pdf?de=" + encodeURIComponent(de) + "&ate=" + encodeURIComponent(ate) + "&visao=" + encodeURIComponent(visao), this);
    });

    campoData.value = hojeIso();
    campoData.addEventListener("change", carregarDia);
    document.getElementById("producao-dia-pdf").addEventListener("click", function () {
        if (!campoData.value) return;
        baixar("/api/producao/datas/" + encodeURIComponent(campoData.value) + "/pdf", this);
    });

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", function () {
            carregarLista();
            carregarDia();
        });
    } else {
        carregarLista();
        carregarDia();
    }
})();
