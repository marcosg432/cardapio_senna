/**
 * Gestão de documentos. Edita só os campos autorizados e emite o PDF no servidor.
 */
(function () {
    var estado = document.getElementById("documentos-estado");
    var corpo = document.getElementById("documentos-corpo");
    var detalhe = document.getElementById("documentos-detalhe");
    var mensagem = document.getElementById("documentos-mensagem");
    if (!estado || !corpo || typeof GestaoConsulta === "undefined") return;

    var atual = null;
    var tipos = {
        orcamento: "Orçamento",
        contrato: "Contrato",
        demonstrativo: "Demonstrativo",
        producao_evento: "Produção do evento",
        producao_dia: "Produção do dia"
    };
    var estados = {
        sem_versao: "Sem versão",
        rascunho: "Rascunho",
        emitida: "Emitida",
        descartado: "Descartado"
    };

    function escapar(valor) {
        return GestaoConsulta.escapar(valor);
    }

    function textoComparavel(valor, caminho, profundidade) {
        if (profundidade > 6) return "…";
        if (valor == null || valor === "") return "—";
        if (typeof valor === "number" || typeof valor === "boolean") return String(valor);
        if (typeof valor === "string") return valor;
        if (Array.isArray(valor)) {
            if (!valor.length) return "—";
            if (/(^|\.)etapas$/.test(caminho || "")) return textoEtapas(valor);
            return valor.map(function (item, indice) {
                return (indice + 1) + ". " + textoComparavel(item, "", profundidade + 1);
            }).join("; ");
        }
        if (typeof valor === "object") {
            var indiceEtapa = /etapas\[(\d+)\]$/.exec(caminho || "");
            if (indiceEtapa) return textoEtapa(valor, Number(indiceEtapa[1]));
            var chaves = Object.keys(valor);
            if (!chaves.length) return "—";
            return chaves.map(function (chave) {
                return chave + ": " + textoComparavel(valor[chave], "", profundidade + 1);
            }).join("; ");
        }
        return String(valor);
    }

    function textoEtapas(lista) {
        return lista.map(function (item, indice) {
            return textoEtapa(item, indice);
        }).join("; ");
    }

    function textoEtapa(item, indice) {
        var numero = indice + 1;
        if (item == null || item === "") return "Etapa " + numero + ": —";
        if (typeof item !== "object" || Array.isArray(item)) return "Etapa " + numero + ": " + textoComparavel(item, "", 1);
        var titulo = item.titulo || item.nome || "";
        var detalhe = item.detalhe || item.descricao || "";
        var linha = "Etapa " + numero + ": " + (titulo || "—");
        if (detalhe) linha += " — " + detalhe;
        return linha;
    }

    function htmlComparavel(valor, caminho) {
        return escapar(textoComparavel(valor, caminho, 0));
    }

    function texto(id) {
        var campo = document.getElementById(id);
        return campo ? campo.value : "";
    }

    function mostrarMensagem(textoMensagem, erro) {
        mensagem.hidden = !textoMensagem;
        mensagem.textContent = textoMensagem || "";
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
            callback(xhr.status, dados, xhr);
        };
        xhr.onerror = function () { callback(0, null, xhr); };
        xhr.send(corpo ? JSON.stringify(corpo) : null);
    }

    function identificacao(item) {
        if (item.data_referencia) return GestaoConsulta.formatarDataIso(item.data_referencia);
        if (item.orcamento_id) return "Contrato " + item.orcamento_id;
        return "Documento " + item.id;
    }

    function carregarLista() {
        var tipo = texto("documentos-tipo");
        var busca = texto("documentos-busca");
        var caminho = "/api/documentos?tipo=" + encodeURIComponent(tipo) + "&q=" + encodeURIComponent(busca);
        pedir("GET", caminho, null, function (status, dados) {
            if (status === 404 || status === 503) {
                estado.hidden = false;
                estado.textContent = "O histórico de versões ainda não está ativo neste processo do servidor.";
                document.getElementById("documentos-tabela").hidden = true;
                return;
            }
            if (status !== 200 || !dados) {
                estado.hidden = false;
                estado.textContent = "Não foi possível carregar os documentos.";
                return;
            }
            var lista = dados.documentos || [];
            if (!lista.length) {
                estado.hidden = false;
                estado.textContent = "Nenhum documento nesta consulta.";
                document.getElementById("documentos-tabela").hidden = true;
                corpo.innerHTML = "";
                return;
            }
            estado.hidden = true;
            document.getElementById("documentos-tabela").hidden = false;
            corpo.innerHTML = lista.map(function (item) {
                return (
                    "<tr><td>" + escapar(tipos[item.tipo] || item.tipo) + "</td>" +
                    "<td>" + escapar(identificacao(item)) + "</td>" +
                    "<td>" + escapar(item.cliente || "—") + "</td>" +
                    "<td>" + escapar(estados[item.estado] || item.estado) + "</td>" +
                    "<td>" + escapar(item.versao_numero == null ? "—" : item.versao_numero) + "</td>" +
                    "<td>" + escapar(item.emitida_em ? GestaoConsulta.formatarDataIso(String(item.emitida_em).slice(0, 10)) : "Não emitida") + "</td>" +
                    "<td><button type=\"button\" class=\"gestao-confirmar\" data-abrir=\"" + escapar(item.id) + "\">Abrir</button></td></tr>"
                );
            }).join("");
        });
    }

    function linhasItens(itens) {
        if (!itens || !itens.length) return "<p>Nenhum produto nesta versão.</p>";
        return "<ul class=\"documentos-leitura\">" + itens.map(function (item) {
            return "<li>" + escapar(item.quantidade) + " · " + escapar(item.nome) + " · " + escapar(item.unidade) + "</li>";
        }).join("") + "</ul>";
    }

    function desenharLeitura(versao, tipo) {
        var painel = document.getElementById("documentos-leitura");
        var conteudo = versao && versao.conteudo || {};
        if (tipo === "producao_evento") {
            painel.innerHTML = "<h3 class=\"gestao-subtitulo\">Quantidade contratada</h3>" + linhasItens(conteudo.contratado && conteudo.contratado.itens);
            return;
        }
        if (tipo === "producao_dia") {
            var eventos = conteudo.contratado && conteudo.contratado.eventos || [];
            painel.innerHTML = "<h3 class=\"gestao-subtitulo\">Eventos desta versão</h3>" + eventos.map(function (evento) {
                return "<p><strong>Contrato " + escapar(evento.id) + "</strong> · " + escapar(evento.tipo_evento || "Evento") + "</p>" + linhasItens(evento.itens);
            }).join("") + "<h3 class=\"gestao-subtitulo\">Total da cozinha</h3>" + linhasItens(conteudo.contratado && conteudo.contratado.totais);
            return;
        }
        if (tipo === "demonstrativo") {
            var oficial = conteudo.oficial || {};
            painel.innerHTML = "<h3 class=\"gestao-subtitulo\">Valores oficiais, somente leitura</h3><ul class=\"documentos-leitura\">" +
                "<li>Contratado: " + escapar(oficial.valor_contratado_centavos) + " centavos</li>" +
                "<li>Recebido: " + escapar(oficial.recebido_centavos) + " centavos</li>" +
                "<li>Pendente: " + escapar(oficial.pendente_centavos) + " centavos</li></ul>";
            return;
        }
        var referencia = conteudo.referencia || {};
        painel.innerHTML = "<h3 class=\"gestao-subtitulo\">Referência do contrato, somente leitura</h3>" + linhasItens(referencia.itens);
    }

    function campo(id, rotulo, valor, tipoCampo) {
        if (tipoCampo === "area") {
            return "<label>" + escapar(rotulo) + "<textarea id=\"" + id + "\" rows=\"3\">" + escapar(valor || "") + "</textarea></label>";
        }
        return "<label>" + escapar(rotulo) + "<input id=\"" + id + "\" type=\"" + (tipoCampo || "text") + "\" value=\"" + escapar(valor || "") + "\"></label>";
    }

    function desenharCampos(versao, tipo) {
        var destino = document.getElementById("documentos-campos");
        var vazio = document.getElementById("documentos-editor-vazio");
        if (!versao || versao.estado !== "rascunho") {
            destino.innerHTML = "";
            vazio.hidden = false;
            return;
        }
        vazio.hidden = true;
        var conteudo = versao.conteudo || {};
        if (tipo === "producao_evento" || tipo === "producao_dia") {
            var op = conteudo.operacional || {};
            var etapas = (op.etapas || []).map(function (item) { return item.titulo; }).join("\n");
            destino.innerHTML = campo("doc-observacoes", "Observações da cozinha", op.observacoes, "area") +
                campo("doc-responsavel", "Responsável", op.responsavel) +
                campo("doc-preparo", "Data prevista de preparo", op.preparo, "date") +
                campo("doc-montagem", "Montagem", op.montagem, "area") +
                campo("doc-embalagem", "Embalagem", op.embalagem, "area") +
                campo("doc-orientacoes", "Orientações", op.orientacoes, "area") +
                campo("doc-etapas", "Etapas, uma por linha", etapas, "area");
            return;
        }
        if (tipo === "demonstrativo") {
            destino.innerHTML = campo("doc-observacao", "Observação de apresentação", conteudo.apresentacao && conteudo.apresentacao.observacao, "area");
            return;
        }
        destino.innerHTML = campo("doc-revisao", "Nota desta revisão", conteudo.revisao_texto, "area");
    }

    function desenharHistorico(versoes) {
        var selectA = document.getElementById("documentos-comparar-a");
        var selectB = document.getElementById("documentos-comparar-b");
        var opcoes = (versoes || []).map(function (versao) {
            return "<option value=\"" + escapar(versao.id) + "\">Versão " + escapar(versao.numero) + " · " + escapar(estados[versao.estado] || versao.estado) + "</option>";
        }).join("");
        selectA.innerHTML = opcoes;
        selectB.innerHTML = opcoes;
        document.getElementById("documentos-historico").innerHTML = (versoes || []).map(function (versao) {
            var download = versao.estado === "emitida"
                ? "<button type=\"button\" class=\"gestao-confirmar\" data-pdf=\"" + escapar(versao.id) + "\">Baixar PDF</button>"
                : "—";
            return "<tr><td>" + escapar(versao.numero) + "</td><td>" + escapar(estados[versao.estado] || versao.estado) +
                "</td><td>" + escapar(versao.emitida_em || versao.atualizada_em || versao.criada_em) +
                "</td><td>" + escapar(versao.usuario_nome) + "</td><td>" + escapar(versao.motivo) +
                "</td><td>" + download + "</td></tr>";
        }).join("") || "<tr><td colspan=\"6\">Nenhuma versão.</td></tr>";
    }

    function abrir(id) {
        pedir("GET", "/api/documentos/" + encodeURIComponent(id), null, function (status, dados) {
            if (status !== 200 || !dados) {
                mostrarMensagem(dados && dados.erro || "Não foi possível abrir o documento.", true);
                return;
            }
            atual = dados;
            detalhe.hidden = false;
            var doc = dados.documento;
            var rascunho = dados.rascunho;
            document.getElementById("documentos-detalhe-titulo").textContent = tipos[doc.tipo] || doc.tipo;
            document.getElementById("documentos-detalhe-meta").textContent =
                identificacao(doc) + " · versão " + (rascunho ? rascunho.numero : doc.versao_numero || "—") +
                " · " + (estados[(rascunho || doc).estado] || "Sem versão") +
                " · " + (doc.usuario_nome || "sem responsável");
            var avisoEmissao = document.getElementById("documentos-aviso-emissao");
            avisoEmissao.hidden = !dados.motivo_emissao;
            avisoEmissao.textContent = dados.motivo_emissao || "";
            document.getElementById("documentos-emitir").disabled = !rascunho;
            var aviso = document.getElementById("documentos-aviso-contrato");
            var confirmado = rascunho && rascunho.conteudo && rascunho.conteudo.referencia && rascunho.conteudo.referencia.confirmado;
            aviso.hidden = !confirmado;
            aviso.textContent = confirmado ? "Contrato confirmado. Este rascunho não altera produtos, quantidades, valores nem a confirmação." : "";
            desenharLeitura(rascunho, doc.tipo);
            desenharCampos(rascunho, doc.tipo);
            desenharHistorico(dados.versoes);
            document.getElementById("documentos-motivo").value = rascunho ? rascunho.motivo : "";
            detalhe.scrollIntoView({ block: "nearest" });
        });
    }

    function etapasDoFormulario() {
        return texto("doc-etapas").split("\n").map(function (linha) {
            return linha.replace(/\s+/g, " ").trim();
        }).filter(Boolean).map(function (linha) {
            return { titulo: linha, detalhe: "" };
        });
    }

    function corpoEdicao() {
        var rascunho = atual && atual.rascunho;
        if (!rascunho) return null;
        var base = { revisao: rascunho.revisao, motivo: texto("documentos-motivo") };
        var tipo = atual.documento.tipo;
        if (tipo === "producao_evento" || tipo === "producao_dia") {
            base.operacional = {
                observacoes: texto("doc-observacoes"),
                responsavel: texto("doc-responsavel"),
                preparo: texto("doc-preparo"),
                montagem: texto("doc-montagem"),
                embalagem: texto("doc-embalagem"),
                orientacoes: texto("doc-orientacoes"),
                etapas: etapasDoFormulario()
            };
            return base;
        }
        if (tipo === "demonstrativo") {
            base.apresentacao = { observacao: texto("doc-observacao") };
            return base;
        }
        base.revisao_texto = texto("doc-revisao");
        return base;
    }

    document.getElementById("documentos-filtros").addEventListener("submit", function (evento) {
        evento.preventDefault();
        carregarLista();
    });

    document.getElementById("documentos-abrir").addEventListener("submit", function (evento) {
        evento.preventDefault();
        var tipo = texto("documentos-novo-tipo");
        var corpo = { tipo: tipo };
        if (tipo === "producao_dia") corpo.data = texto("documentos-nova-data");
        else corpo.orcamentoId = Number(texto("documentos-novo-id"));
        pedir("POST", "/api/documentos", corpo, function (status, dados) {
            if (status !== 200 && status !== 201) {
                mostrarMensagem(dados && dados.erro || "Não foi possível abrir o documento.", true);
                return;
            }
            mostrarMensagem(dados.repetido ? "Documento já existente." : "Documento aberto.", false);
            carregarLista();
            abrir(dados.documento.id);
        });
    });

    corpo.addEventListener("click", function (evento) {
        var botao = evento.target.closest("button");
        if (!botao) return;
        abrir(botao.getAttribute("data-abrir"));
    });

    document.getElementById("documentos-criar").addEventListener("click", function () {
        if (!atual) return;
        pedir("POST", "/api/documentos/" + atual.documento.id + "/rascunho", {
            motivo: texto("documentos-motivo") || "Rascunho inicial"
        }, function (status, dados) {
            if (status !== 201) {
                mostrarMensagem(dados && dados.erro || "Não foi possível criar o rascunho.", true);
                return;
            }
            mostrarMensagem("Rascunho criado.", false);
            abrir(atual.documento.id);
        });
    });

    document.getElementById("documentos-editor").addEventListener("submit", function (evento) {
        evento.preventDefault();
        var corpoEdicaoAtual = corpoEdicao();
        if (!corpoEdicaoAtual || !atual.rascunho) {
            mostrarMensagem("Crie um rascunho antes de salvar.", true);
            return;
        }
        pedir("PATCH", "/api/documentos/versoes/" + atual.rascunho.id, corpoEdicaoAtual, function (status, dados) {
            if (status === 409) {
                mostrarMensagem(dados && dados.erro || "Recarregue o rascunho antes de salvar.", true);
                abrir(atual.documento.id);
                return;
            }
            if (status !== 200) {
                mostrarMensagem(dados && dados.erro || "Não foi possível salvar.", true);
                return;
            }
            mostrarMensagem("Rascunho salvo.", false);
            abrir(atual.documento.id);
        });
    });

    document.getElementById("documentos-descartar").addEventListener("click", function () {
        if (!atual || !atual.rascunho) return;
        if (!window.confirm("Descartar este rascunho? Ele permanece no histórico.")) return;
        pedir("POST", "/api/documentos/versoes/" + atual.rascunho.id + "/descartar", {
            revisao: atual.rascunho.revisao,
            motivo: texto("documentos-motivo") || "Rascunho descartado"
        }, function (status, dados) {
            if (status !== 200) {
                mostrarMensagem(dados && dados.erro || "Não foi possível descartar.", true);
                return;
            }
            mostrarMensagem("Rascunho descartado. O histórico foi mantido.", false);
            abrir(atual.documento.id);
        });
    });

    function chaveEmissao() {
        var alfabeto = "abcdefghijklmnopqrstuvwxyz0123456789";
        var saida = "";
        var bytes = new Uint8Array(32);
        if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(bytes);
        else for (var i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
        for (var n = 0; n < bytes.length; n++) saida += alfabeto[bytes[n] % alfabeto.length];
        return saida;
    }

    function abrirPdf(caminho, baixar, nome) {
        var xhr = new XMLHttpRequest();
        xhr.open("GET", caminho, true);
        xhr.withCredentials = true;
        xhr.responseType = "blob";
        xhr.onload = function () {
            if (xhr.status !== 200) {
                mostrarMensagem("Não foi possível obter o PDF.", true);
                return;
            }
            var url = URL.createObjectURL(xhr.response);
            if (!baixar) {
                var painel = document.getElementById("documentos-previa-painel");
                painel.hidden = false;
                painel.innerHTML = "<h3 class=\"gestao-subtitulo\">Pré-visualização com marca de rascunho</h3>" +
                    "<iframe class=\"documentos-previa-pdf\" title=\"Pré-visualização do rascunho\" src=\"" + url + "\"></iframe>";
                return;
            }
            var link = document.createElement("a");
            link.href = url;
            link.download = nome || "documento.pdf";
            document.body.appendChild(link);
            link.click();
            link.remove();
            setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
        };
        xhr.onerror = function () { mostrarMensagem("Não foi possível obter o PDF.", true); };
        xhr.send();
    }

    document.getElementById("documentos-previa").addEventListener("click", function () {
        if (!atual || !atual.rascunho) return;
        abrirPdf("/api/documentos/versoes/" + atual.rascunho.id + "/previa", false);
    });

    document.getElementById("documentos-emitir").addEventListener("click", function () {
        if (!atual || !atual.rascunho) return;
        pedir("POST", "/api/documentos/versoes/" + atual.rascunho.id + "/emitir", {
            revisao: atual.rascunho.revisao,
            chave: chaveEmissao()
        }, function (status, dados) {
            if (status !== 200 && status !== 201) {
                mostrarMensagem(dados && dados.erro || "Não foi possível emitir o PDF.", true);
                if (status === 409) abrir(atual.documento.id);
                return;
            }
            var versao = dados && dados.versao;
            mostrarMensagem(
                "Versão " + (versao ? versao.numero : "") + " emitida" +
                (versao && versao.usuario_nome ? " por " + versao.usuario_nome : "") +
                (versao && versao.emitida_em ? " em " + versao.emitida_em : "") + ".",
                false
            );
            abrir(atual.documento.id);
        });
    });

    document.getElementById("documentos-comparar").addEventListener("click", function () {
        var a = texto("documentos-comparar-a");
        var b = texto("documentos-comparar-b");
        if (!a || !b) return;
        pedir("GET", "/api/documentos/versoes/" + encodeURIComponent(a) + "/comparar/" + encodeURIComponent(b), null, function (status, dados) {
            var painel = document.getElementById("documentos-comparacao");
            if (status !== 200 || !dados) {
                mostrarMensagem(dados && dados.erro || "Não foi possível comparar.", true);
                return;
            }
            painel.hidden = false;
            if (dados.iguais) {
                painel.innerHTML = "<p>As duas versões têm o mesmo conteúdo.</p>";
                return;
            }
            painel.innerHTML = "<ul class=\"documentos-leitura\">" + (dados.alteracoes || []).map(function (item) {
                return "<li><strong>" + escapar(item.caminho) + ":</strong> " +
                    htmlComparavel(item.antes, item.caminho) + " → " + htmlComparavel(item.depois, item.caminho) + "</li>";
            }).join("") + "</ul>";
        });
    });

    document.getElementById("documentos-historico").addEventListener("click", function (evento) {
        var botao = evento.target.closest("button");
        if (!botao) return;
        var id = botao.getAttribute("data-pdf");
        var xhr = new XMLHttpRequest();
        xhr.open("GET", "/api/documentos/versoes/" + encodeURIComponent(id) + "/pdf", true);
        xhr.withCredentials = true;
        xhr.responseType = "blob";
        xhr.onload = function () {
            if (xhr.status !== 200) {
                mostrarMensagem("Não foi possível baixar esta versão.", true);
                return;
            }
            var url = URL.createObjectURL(xhr.response);
            var link = document.createElement("a");
            link.href = url;
            link.download = "documento-v" + id + ".pdf";
            document.body.appendChild(link);
            link.click();
            link.remove();
            setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
        };
        xhr.send();
    });

    var buscaInicial = new URLSearchParams(window.location.search).get("q");
    if (buscaInicial) {
        var campoBusca = document.getElementById("documentos-busca");
        if (campoBusca) campoBusca.value = buscaInicial;
    }
    carregarLista();
})();
