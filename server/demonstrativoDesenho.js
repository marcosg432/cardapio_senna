/**
 * Desenho do demonstrativo financeiro.
 * O servidor informa apenas dados lidos do banco. Este arquivo não é servido ao navegador.
 */
(function (raiz) {
    var FORMAS = {
        pix: "PIX",
        dinheiro: "Dinheiro",
        transferencia: "Transferência",
        cartao: "Cartão",
        boleto: "Boleto",
        outro: "Outro"
    };

    function inteiro(valor) {
        var numero = Number(valor);
        if (!Number.isSafeInteger(numero)) return null;
        return numero;
    }

    function dataIso(valor) {
        var texto = String(valor || "");
        var match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto);
        if (!match) return null;
        var ano = Number(match[1]);
        var mes = Number(match[2]);
        var dia = Number(match[3]);
        var data = new Date(ano, mes - 1, dia);
        if (data.getFullYear() !== ano || data.getMonth() !== mes - 1 || data.getDate() !== dia) return null;
        return match[1] + "-" + match[2] + "-" + match[3];
    }

    function formatarIso(iso) {
        if (!iso) return "—";
        return iso.slice(8, 10) + "/" + iso.slice(5, 7) + "/" + iso.slice(0, 4);
    }

    function formatarCentavos(centavos) {
        var numero = inteiro(centavos);
        if (numero == null) return "—";
        var negativo = numero < 0;
        var absoluto = Math.abs(numero);
        var reais = String(Math.floor(absoluto / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
        var frac = String(absoluto % 100).padStart(2, "0");
        return (negativo ? "-" : "") + "R$ " + reais + "," + frac;
    }

    function hojeIso() {
        var data = new Date();
        var mes = String(data.getMonth() + 1).padStart(2, "0");
        var dia = String(data.getDate()).padStart(2, "0");
        return data.getFullYear() + "-" + mes + "-" + dia;
    }

    function normalizar(origem, opcoes) {
        var provisorio = !!(origem && origem.provisorio === true && origem.congelado !== true);
        if (!origem || (origem.congelado !== true && !provisorio)) {
            var erro = new Error("contrato");
            erro.code = "contrato";
            throw erro;
        }
        var id = inteiro(origem.id);
        var contratado = inteiro(origem.valor_contratado_centavos);
        if (!id || id <= 0 || contratado == null || contratado < 0) {
            var invalido = new Error("valores");
            invalido.code = "valores";
            throw invalido;
        }
        var historico = (Array.isArray(origem.historico) ? origem.historico : []).map(function (item) {
            var valor = inteiro(item && item.valor_centavos);
            var pago = dataIso(item && item.pago_em);
            var forma = item && FORMAS[item.forma] ? item.forma : "";
            if (!valor || valor <= 0 || !pago || !forma) {
                var linha = new Error("historico");
                linha.code = "historico";
                throw linha;
            }
            return {
                id: inteiro(item.id) || 0,
                pago_em: pago,
                forma: forma,
                valor_centavos: valor
            };
        }).sort(function (a, b) {
            if (a.pago_em !== b.pago_em) return a.pago_em < b.pago_em ? -1 : 1;
            return a.id - b.id;
        });
        var recebido = historico.reduce(function (soma, item) { return soma + item.valor_centavos; }, 0);
        var emissao = dataIso(opcoes && opcoes.dataEmissao) || hojeIso();
        var pendente = contratado - recebido;
        var situacao = "Pendente";
        if (pendente === 0) situacao = "Quitado";
        else if (recebido > 0 && pendente > 0) situacao = "Parcialmente pago";
        else if (pendente < 0) situacao = provisorio ? "Crédito a regularizar" : "Acima do contratado";
        return {
            id: id,
            nome_cliente: String(origem.nome_cliente || "").trim() || "Cliente",
            tipo_evento: String(origem.tipo_evento || "").trim(),
            data_evento: dataIso(origem.data_evento),
            valor_contratado_centavos: contratado,
            recebido_centavos: recebido,
            pendente_centavos: pendente,
            historico: historico,
            emissao: emissao,
            situacao: situacao,
            provisorio: provisorio,
            observacao: String(origem.observacao || "").replace(/\s+/g, " ").trim()
        };
    }

    function gerarDemonstrativoFinanceiroPDF(origem, opcoes) {
        if (!raiz.jspdf || !raiz.jspdf.jsPDF) {
            var biblioteca = new Error("biblioteca");
            biblioteca.code = "biblioteca";
            throw biblioteca;
        }
        var dados = normalizar(origem, opcoes);
        var doc = new raiz.jspdf.jsPDF({
            unit: "mm",
            format: "a4",
            compress: !(opcoes && opcoes.auditoria)
        });
        var margem = 16;
        var largura = 178;
        var y = 46;
        var limite = 274;
        var paginaTabela = false;

        doc.setProperties({
            title: (dados.provisorio ? "Demonstrativo financeiro provisório " : "Demonstrativo Financeiro ") + dados.id,
            author: "Candy Li Doces Finos",
            subject: dados.provisorio ? "Consulta financeira antes da confirmação do contrato" : "Situação financeira do contrato"
        });

        function texto(conteudo, x, yy, tamanho, estilo, cor, alinhamento, max) {
            doc.setFont("helvetica", estilo || "normal");
            doc.setFontSize(tamanho || 10);
            doc.setTextColor(cor[0], cor[1], cor[2]);
            var opcoesTexto = { align: alinhamento || "left" };
            if (max) opcoesTexto.maxWidth = max;
            doc.text(String(conteudo), x, yy, opcoesTexto);
        }

        function faixaInicial() {
            doc.setFillColor(18, 31, 42);
            doc.rect(0, 0, 210, 36, "F");
            doc.setFillColor(196, 165, 173);
            doc.rect(0, 36, 210, 1.4, "F");
            texto("Candy Li Doces Finos", margem, 16, 16, "bold", [250, 248, 246]);
            texto(dados.provisorio ? "Demonstrativo financeiro provisório" : "Demonstrativo Financeiro", margem, 25, 11, "normal", [196, 165, 173]);
            texto("Emissão " + formatarIso(dados.emissao), 194, 15, 9, "normal", [250, 248, 246], "right");
            texto((dados.provisorio ? "Orçamento " : "Contrato ") + dados.id, 194, 22, 9, "bold", [250, 248, 246], "right");
        }

        function faixaContinuacao() {
            doc.setFillColor(18, 31, 42);
            doc.rect(0, 0, 210, 16, "F");
            texto("Candy Li Doces Finos", margem, 10.5, 10, "bold", [250, 248, 246]);
            texto((dados.provisorio ? "Provisório · " : "Demonstrativo · ") + dados.id, 194, 10.5, 9, "normal", [196, 165, 173], "right");
            y = 24;
        }

        function cabecalhoTabela() {
            doc.setFillColor(246, 241, 234);
            doc.rect(margem, y, largura, 8, "F");
            texto("Data", margem + 2, y + 5.3, 8, "bold", [92, 107, 120]);
            texto("Forma", margem + 38, y + 5.3, 8, "bold", [92, 107, 120]);
            texto("Valor recebido", margem + largura - 2, y + 5.3, 8, "bold", [92, 107, 120], "right");
            y += 8;
        }

        function novaPagina() {
            doc.addPage();
            faixaContinuacao();
            if (paginaTabela) cabecalhoTabela();
        }

        function garantir(altura) {
            if (y + altura <= limite) return;
            novaPagina();
        }

        faixaInicial();
        if (dados.provisorio) {
            var aviso = "Demonstrativo financeiro provisório — valores sujeitos a alterações até a confirmação do contrato";
            doc.setFont("helvetica", "bold");
            doc.setFontSize(9);
            var avisoLinhas = doc.splitTextToSize(aviso, largura - 6);
            var avisoAltura = avisoLinhas.length * 4.4 + 5;
            doc.setFillColor(246, 241, 234);
            doc.setDrawColor(196, 165, 173);
            doc.roundedRect(margem, y, largura, avisoAltura, 1.5, 1.5, "FD");
            doc.setTextColor(18, 31, 42);
            doc.text(avisoLinhas, margem + 3, y + 5);
            y += avisoAltura + 6;
        }
        texto("Dados do evento", margem, y, 12, "bold", [18, 31, 42]);
        y += 7;
        doc.setDrawColor(230, 224, 216);
        doc.line(margem, y, margem + largura, y);
        y += 7;
        texto("Cliente", margem, y, 8, "bold", [92, 107, 120]);
        texto("Evento", margem + 92, y, 8, "bold", [92, 107, 120]);
        y += 5;
        doc.setFont("helvetica", "normal");
        doc.setFontSize(11);
        var nomeLinhas = doc.splitTextToSize(dados.nome_cliente, 86);
        var eventoLinhas = doc.splitTextToSize(dados.tipo_evento || "—", 86);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(11);
        doc.setTextColor(28, 36, 48);
        doc.text(nomeLinhas, margem, y);
        doc.text(eventoLinhas, margem + 92, y);
        y += Math.max(nomeLinhas.length, eventoLinhas.length) * 5 + 2;
        texto("Data do evento", margem, y, 8, "bold", [92, 107, 120]);
        y += 5;
        texto(formatarIso(dados.data_evento), margem, y, 11, "normal", [28, 36, 48]);
        y += 10;

        texto("Resumo financeiro", margem, y, 12, "bold", [18, 31, 42]);
        y += 4;
        var saldoCentavos = dados.pendente_centavos;
        var saldoRotulo = "Saldo pendente";
        if (dados.provisorio && saldoCentavos < 0) {
            saldoRotulo = "Crédito a regularizar";
            saldoCentavos = -saldoCentavos;
        }
        var cartoes = [
            [dados.provisorio ? "Valor atual do pedido" : "Valor contratado", formatarCentavos(dados.valor_contratado_centavos)],
            ["Valor recebido", formatarCentavos(dados.recebido_centavos)],
            [saldoRotulo, formatarCentavos(saldoCentavos)]
        ];
        var cartaoLargura = 57;
        cartoes.forEach(function (cartao, indice) {
            var x = margem + indice * (cartaoLargura + 3.5);
            doc.setFillColor(250, 248, 246);
            doc.setDrawColor(18, 31, 42);
            doc.roundedRect(x, y, cartaoLargura, 22, 2, 2, "FD");
            texto(cartao[0], x + 3, y + 7, 8, "bold", [92, 107, 120]);
            texto(cartao[1], x + 3, y + 16, 12, "bold", [18, 31, 42]);
        });
        y += 28;
        texto("Situação: " + dados.situacao, margem, y, 11, "bold", [18, 31, 42]);
        y += 8;
        if (dados.observacao) {
            garantir(16);
            texto("Nota de apresentação", margem, y, 11, "bold", [18, 31, 42]);
            y += 5;
            doc.setFont("helvetica", "normal");
            doc.setFontSize(10);
            var notaLinhas = doc.splitTextToSize(dados.observacao, largura);
            doc.setTextColor(28, 36, 48);
            doc.text(notaLinhas, margem, y);
            y += notaLinhas.length * 5 + 4;
        } else {
            y += 2;
        }

        texto("Histórico de pagamentos", margem, y, 12, "bold", [18, 31, 42]);
        y += 4;
        if (!dados.historico.length) {
            garantir(12);
            texto("Nenhum pagamento registrado até esta emissão.", margem, y + 5, 10, "normal", [92, 107, 120]);
            y += 12;
        } else {
            if (y + 16 > limite) {
                doc.addPage();
                faixaContinuacao();
            }
            cabecalhoTabela();
            paginaTabela = true;
            dados.historico.forEach(function (item, indice) {
                garantir(8);
                if (indice % 2 === 0) {
                    doc.setFillColor(252, 251, 249);
                    doc.rect(margem, y, largura, 8, "F");
                }
                texto(formatarIso(item.pago_em), margem + 2, y + 5.3, 9, "normal", [28, 36, 48]);
                texto(FORMAS[item.forma], margem + 38, y + 5.3, 9, "normal", [28, 36, 48]);
                texto(formatarCentavos(item.valor_centavos), margem + largura - 2, y + 5.3, 9, "bold", [18, 31, 42], "right");
                y += 8;
            });
        }

        var total = doc.getNumberOfPages();
        var i;
        for (i = 1; i <= total; i++) {
            doc.setPage(i);
            doc.setDrawColor(230, 224, 216);
            doc.line(margem, 282, margem + largura, 282);
            texto("Este demonstrativo apresenta os pagamentos registrados no sistema até a data de emissão.", margem, 287, 8, "normal", [125, 136, 146], "left", 140);
            texto("Página " + i + " de " + total, 194, 287, 8, "normal", [125, 136, 146], "right");
            if (opcoes && opcoes.rascunho) {
                doc.setFont("helvetica", "bold");
                doc.setFontSize(42);
                doc.setTextColor(176, 122, 132);
                doc.text("RASCUNHO", 105, 168, { align: "center", angle: 32 });
            }
        }

        var arquivo = "demonstrativo-financeiro-" + dados.id + ".pdf";
        if (!opcoes || opcoes.baixar !== false) doc.save(arquivo);
        return {
            arquivo: arquivo,
            paginas: total,
            situacao: dados.situacao,
            emissao: formatarIso(dados.emissao),
            contratado: formatarCentavos(dados.valor_contratado_centavos),
            recebido: formatarCentavos(dados.recebido_centavos),
            pendente: formatarCentavos(dados.pendente_centavos),
            pdf: opcoes && (opcoes.auditoria || opcoes.bytes) ? doc.output("arraybuffer") : null
        };
    }

    raiz.gerarDemonstrativoFinanceiroPDF = gerarDemonstrativoFinanceiroPDF;
})(typeof window !== "undefined" ? window : globalThis);
