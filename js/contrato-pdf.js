/**
 * Geração de contrato em PDF (jsPDF via CDN na página admin)
 * Texto contratual + anexo com dados do orçamento (CONFIG.contratadaLegal + campos opcionais).
 */

/**
 * Anexo visual inspirado em planilha (título + Nº, seções com moldura, linha Data em destaque).
 * @returns {number} nova posição Y
 */
function desenharAnexoContratualModeloPlanilha(ctx) {
    var doc = ctx.doc;
    var margem = ctx.margem;
    var maxW = ctx.maxW;
    var y = ctx.y;
    var orcamento = ctx.orcamento;
    var numContrato = ctx.numContrato;
    var nomeContratada = ctx.nomeContratada;
    var cpfContratada = ctx.cpfContratada;
    var endContratada = ctx.endContratada;
    var vf = ctx.vf;
    var vEnt = ctx.vEnt;
    var orcCampo = ctx.orcCampo;
    var formatarDataBr = ctx.formatarDataBr;
    var formatarMoedaPdf = ctx.formatarMoedaPdf;

    function garantirEspaco(altura) {
        if (y + altura > 278) {
            doc.addPage();
            y = 16;
        }
    }

    function linhaCampoPlanilha(label, valor, opcoes) {
        opcoes = opcoes || {};
        garantirEspaco(14);
        var linhaBase = y;
        var hMin = 7;
        var wRot = 56;
        var xVal = margem + wRot + 3;
        var wLabel = wRot - 4;
        var wVal = maxW - wRot - 5;
        var txt = valor == null || String(valor).trim() === "" ? "—" : String(valor);

        doc.setFontSize(8.3);
        doc.setFont(undefined, "bold");
        var linhasLabel = doc.splitTextToSize(String(label), wLabel);
        doc.setFont(undefined, "normal");
        var linhasVal = doc.splitTextToSize(txt, wVal);
        var nLin = Math.max(linhasLabel.length, linhasVal.length);
        var altura = Math.max(hMin, 3 + nLin * 4.1);

        if (opcoes.fundoAmarelo) {
            doc.setFillColor(255, 250, 140);
            doc.rect(margem, linhaBase, maxW, altura, "F");
        }

        doc.setDrawColor(145, 128, 118);
        doc.setLineWidth(0.15);
        doc.line(margem, linhaBase + altura, margem + maxW, linhaBase + altura);
        doc.line(margem + wRot, linhaBase, margem + wRot, linhaBase + altura);

        doc.setFont(undefined, "bold");
        doc.setTextColor(55, 45, 40);
        doc.text(linhasLabel, margem + 2, linhaBase + 5);
        doc.setFont(undefined, "normal");
        doc.setTextColor(30, 25, 22);
        doc.text(linhasVal, xVal, linhaBase + 5);

        y = linhaBase + altura;
    }

    function molduraSecao(tituloSecao, desenharConteudo) {
        garantirEspaco(20);
        var yTopo = y;
        doc.setFillColor(228, 218, 205);
        doc.setDrawColor(95, 78, 68);
        doc.setLineWidth(0.35);
        doc.rect(margem, y, maxW, 8, "FD");
        doc.setFontSize(9.2);
        doc.setFont(undefined, "bold");
        doc.setTextColor(45, 38, 32);
        doc.text(tituloSecao, margem + 2.5, y + 5.4);
        doc.setFont(undefined, "normal");
        doc.setTextColor(30, 25, 22);
        y += 8;
        desenharConteudo();
        doc.setDrawColor(95, 78, 68);
        doc.setLineWidth(0.35);
        doc.rect(margem, yTopo, maxW, y - yTopo);
        y += 3;
    }

    garantirEspaco(36);
    doc.setFontSize(10.5);
    doc.setFont(undefined, "bold");
    doc.setTextColor(45, 38, 32);
    doc.text("ANEXO CONTRATUAL", margem, y);
    doc.setFont(undefined, "normal");
    doc.setFontSize(9.5);
    y += 7;

    garantirEspaco(16);
    doc.setFillColor(248, 244, 238);
    doc.setDrawColor(95, 78, 68);
    doc.setLineWidth(0.4);
    doc.rect(margem, y, maxW, 11, "FD");
    doc.setFontSize(10.5);
    doc.setFont(undefined, "bold");
    doc.text("CONTRATO DE PRESTAÇÃO DE SERVIÇOS", margem + 3, y + 7.5);
    var txtNum = "Nº " + numContrato;
    doc.setFontSize(10);
    var wNum = doc.getTextWidth(txtNum);
    doc.text(txtNum, margem + maxW - wNum - 3, y + 7.5);
    doc.setFont(undefined, "normal");
    y += 13;

    var localFesta = orcCampo(orcamento, ["evento_local_festa"], "");
    if (!localFesta || localFesta === "—") {
        localFesta = orcCampo(orcamento, ["local", "local_evento"], "—");
    }
    var tipoEvt = orcCampo(orcamento, ["evento_tipo", "tipo_evento"], "");
    var dataEvtBruto = orcCampo(orcamento, ["evento_data", "data_evento"], "");
    function formatarDataEstiloPlanilha(s) {
        if (!s || String(s).trim() === "" || s === "—") return "—";
        if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
            var p = s.split("-");
            return p[2] + "." + p[1] + "." + p[0].slice(-2);
        }
        return s;
    }
    var dataEvtFmt = formatarDataEstiloPlanilha(dataEvtBruto);
    var dataComTipo =
        dataEvtFmt +
        (tipoEvt && tipoEvt !== "—" ? " — " + tipoEvt.toUpperCase() : "");

    molduraSecao("CLIENTE CONTRATANTE", function () {
        linhaCampoPlanilha("Nome do Contratante:", orcCampo(orcamento, ["nome_cliente", "cliente"], ""));
        linhaCampoPlanilha("RG:", orcCampo(orcamento, ["cliente_rg", "rg"], ""));
        linhaCampoPlanilha("CPF:", orcCampo(orcamento, ["cliente_cpf", "cpf"], ""));
        linhaCampoPlanilha("Data de nascimento:", formatarDataBr(orcCampo(orcamento, ["cliente_data_nascimento"], "")));
        linhaCampoPlanilha("Endereço:", orcCampo(orcamento, ["cliente_endereco_linha", "endereco"], ""));
        linhaCampoPlanilha("CEP:", orcCampo(orcamento, ["cliente_cep", "cep"], ""));
        linhaCampoPlanilha("E-mail:", orcCampo(orcamento, ["email"], ""));
        linhaCampoPlanilha("Telefone fixo:", orcCampo(orcamento, ["telefone_fixo"], ""));
        /*
         * Celular principal (campo pedido): se só “Celular (contato)” estiver preenchido, aparece também na linha “Celular”.
         */
        linhaCampoPlanilha("Celular:", orcCampo(orcamento, ["telefone", "contato_celular"], ""));
        linhaCampoPlanilha("Nome de contato:", orcCampo(orcamento, ["contato_nome"], ""));
        linhaCampoPlanilha("Celular (contato):", orcCampo(orcamento, ["contato_celular", "telefone"], ""));
    });

    molduraSecao("DADOS DO EVENTO", function () {
        linhaCampoPlanilha("Local da festa:", localFesta);
        linhaCampoPlanilha("Data:", dataComTipo, { fundoAmarelo: true });
        linhaCampoPlanilha("Horário de entrega:", orcCampo(orcamento, ["evento_horario_entrega"], ""));
        linhaCampoPlanilha("Local da cerimônia:", orcCampo(orcamento, ["evento_local_cerimonia"], ""));
        linhaCampoPlanilha("Horário da festa:", orcCampo(orcamento, ["evento_horario_festa"], ""));
        linhaCampoPlanilha("Cerimonialista:", orcCampo(orcamento, ["evento_cerimonialista"], ""));
        linhaCampoPlanilha("Telefone (cerimonialista):", orcCampo(orcamento, ["evento_cerimonialista_tel"], ""));
        linhaCampoPlanilha("Fotógrafo:", orcCampo(orcamento, ["evento_fotografo"], ""));
        linhaCampoPlanilha("Telefone (fotógrafo):", orcCampo(orcamento, ["evento_fotografo_tel"], ""));
    });

    var entregaSuporte = orcCampo(orcamento, ["entrega_suporte"], "");
    var entregaSuporteCortesia = /cortesia/i.test(entregaSuporte) ||
        (orcamento && orcamento.entrega_suporte_obs != null && String(orcamento.entrega_suporte_obs).trim() !== "");
    molduraSecao("FORMA DE ENTREGA E SUPORTES", function () {
        linhaCampoPlanilha("Forma escolhida:", entregaSuporte);
        if (entregaSuporteCortesia) {
            linhaCampoPlanilha("Observação:", "Os suportes deverão ser devolvidos na semana seguinte à festa.");
        }
    });

    var dataPrevCliente = orcCampo(orcamento, ["data_pagamento_entrada_prevista"], "");
    var dataQuitadoEm = orcCampo(orcamento, ["pagamento_valor_quitado_em"], "");
    molduraSecao("INFORMAÇÕES DO PAGAMENTO", function () {
        linhaCampoPlanilha("Valor total:", formatarMoedaPdf(vf));
        linhaCampoPlanilha("Entrada:", vEnt != null && !isNaN(vEnt) ? formatarMoedaPdf(vEnt) : "—");
        if (dataPrevCliente && dataPrevCliente !== "—") {
            linhaCampoPlanilha("Data prevista p/ pagamento da entrada:", formatarDataBr(dataPrevCliente));
        }
        if (dataQuitadoEm && dataQuitadoEm !== "—") {
            linhaCampoPlanilha("VALOR QUITADO EM:", formatarDataBr(dataQuitadoEm));
        }
        linhaCampoPlanilha("Forma de pagamento:", orcCampo(orcamento, ["forma_pagamento_ref", "forma_pagamento", "pagamento"], ""));
    });

    garantirEspaco(28);
    doc.setFontSize(8.8);
    doc.setFont(undefined, "bold");
    var preambuloAnexo =
        nomeContratada +
        ", portadora do CPF nº " +
        cpfContratada +
        " e situada à " +
        endContratada +
        ", doravante denominada CONTRATADA, e o cliente acima estabelecido, doravante denominado Contratante, têm entre si, contratado o seguinte:";
    var linhasPre = doc.splitTextToSize(preambuloAnexo, maxW - 4);
    doc.setDrawColor(95, 78, 68);
    doc.setLineWidth(0.25);
    doc.rect(margem, y, maxW, 4 + linhasPre.length * 4.3, "S");
    doc.text(linhasPre, margem + 2, y + 5);
    y += 6 + linhasPre.length * 4.3;
    doc.setFont(undefined, "normal");
    y += 4;

    garantirEspaco(24);
    var yResumoTopo = y;
    doc.setFillColor(240, 232, 222);
    doc.rect(margem, y, maxW, 7, "F");
    doc.setFontSize(9.5);
    doc.setFont(undefined, "bold");
    doc.text("RESUMO DOS ITENS CONTRATADOS", margem + 2, y + 5);
    doc.setFont(undefined, "normal");
    y += 9;
    doc.setFontSize(8.3);
    doc.setTextColor(30, 25, 22);
    if (orcamento.itens && orcamento.itens.length) {
        orcamento.itens.forEach(function (it) {
            var pu = it.preco_unitario != null ? it.preco_unitario : it.preco;
            var sub = it.subtotal != null ? it.subtotal : (Number(pu) || 0) * (Number(it.quantidade) || 0);
            var linhaItem =
                (it.quantidade || 0) + " × " + (it.nome || "") + " — " + formatarMoedaPdf(sub);
            garantirEspaco(10);
            var linhasItem = doc.splitTextToSize(linhaItem, maxW - 4);
            doc.text(linhasItem, margem + 2, y);
            y += linhasItem.length * 5;
        });
    } else {
        garantirEspaco(8);
        doc.text("(itens conforme orçamento nº " + numContrato + ")", margem + 2, y);
        y += 6;
    }
    doc.setDrawColor(95, 78, 68);
    doc.setLineWidth(0.35);
    doc.rect(margem, yResumoTopo, maxW, y - yResumoTopo + 3);
    y += 5;

    return y;
}

function gerarContratoPDF(orcamento) {
    if (typeof window.jspdf === "undefined") {
        alert("Biblioteca de PDF não carregada.");
        return;
    }
    var jsPDF = window.jspdf.jsPDF;
    var doc = new jsPDF({ unit: "mm", format: "a4" });
    var margem = 18;
    var maxW = 174;
    var y = 16;

    var cfg = typeof CONFIG !== "undefined" ? CONFIG : {};
    var empresa = cfg.nomeEmpresa || "Confeitaria";
    var cl = cfg.contratadaLegal || {};
    var nomeContratada = cl.nome || empresa;
    var cpfContratada = cl.cpf || "";
    var endContratada = cl.endereco || "";

    function linha(texto, dy, fontSize) {
        dy = dy || 5.2;
        if (fontSize) doc.setFontSize(fontSize);
        var lines = doc.splitTextToSize(String(texto || ""), maxW);
        doc.text(lines, margem, y);
        y += lines.length * dy;
        if (y > 278) {
            doc.addPage();
            y = 16;
        }
    }

    function linhaTitulo(texto) {
        doc.setFont(undefined, "bold");
        linha(texto, 5.5, 10.5);
        doc.setFont(undefined, "normal");
        doc.setFontSize(9.5);
    }

    function orcCampo(o, keys, def) {
        if (!o) return def != null ? def : "—";
        for (var i = 0; i < keys.length; i++) {
            var v = o[keys[i]];
            if (v != null && String(v).trim() !== "") return String(v).trim();
        }
        return def != null ? def : "—";
    }

    function formatarMoedaPdf(n) {
        var x = Number(n) || 0;
        return "R$ " + x.toFixed(2).replace(".", ",");
    }

    function formatarDataBr(s) {
        if (!s) return "—";
        if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
            var p = s.split("-");
            return p[2] + "/" + p[1] + "/" + p[0];
        }
        return s;
    }

    function valorFinalOrcPdf(o) {
        var vo;
        if (typeof valorOriginalOrcamentoComItens === "function") {
            vo = valorOriginalOrcamentoComItens(o);
        } else {
            vo = o.valor_original != null ? o.valor_original : o.total;
        }
        vo = Number(vo) || 0;
        if (typeof calcularValorFinalOrcamento === "function") {
            return calcularValorFinalOrcamento(
                vo,
                o.desconto_tipo,
                o.desconto_valor,
                o.desconto_degustacao,
                o.desconto_cerimonialista,
                o.taxa_entrega
            );
        }
        return o.valor_final != null ? Number(o.valor_final) : vo;
    }

    var nomeCliente = orcCampo(orcamento, ["nome_cliente", "cliente"], "");
    var numContrato = orcCampo(orcamento, ["contrato_numero_exibicao"], String(orcamento.id || ""));

    doc.setFontSize(13);
    doc.setFont(undefined, "bold");
    linha("CONTRATO DE PRESTAÇÃO DE SERVIÇOS", 6.5);
    doc.setFontSize(10);
    doc.setFont(undefined, "normal");
    linha("Nº " + numContrato, 5);
    y += 2;

    doc.setFontSize(9.5);
    var intro =
        nomeContratada +
        ", portadora do CPF nº " +
        cpfContratada +
        " e situada à " +
        endContratada +
        ", doravante denominada CONTRATADA, e " +
        (nomeCliente || "(nome do contratante)") +
        ", doravante denominado(a) CONTRATANTE, têm entre si justo e contratado o seguinte:";
    linha(intro, 5.2);
    y += 3;

    var clausulas = obterTextoClausulasContrato(cfg);
    for (var c = 0; c < clausulas.length; c++) {
        var par = clausulas[c];
        if (par.titulo) {
            linhaTitulo(par.titulo);
        } else if (par.texto != null && String(par.texto).length) {
            doc.setFont(undefined, "normal");
            linha(par.texto, 5.2, 9.5);
        }
    }

    y += 4;

    var vf = valorFinalOrcPdf(orcamento);
    var vEnt = orcamento.entrada != null && orcamento.entrada !== "" ? Number(orcamento.entrada) : null;

    y = desenharAnexoContratualModeloPlanilha({
        doc: doc,
        y: y,
        margem: margem,
        maxW: maxW,
        orcamento: orcamento,
        numContrato: numContrato,
        nomeContratada: nomeContratada,
        cpfContratada: cpfContratada,
        endContratada: endContratada,
        vf: vf,
        vEnt: vEnt,
        orcCampo: orcCampo,
        formatarDataBr: formatarDataBr,
        formatarMoedaPdf: formatarMoedaPdf
    });

    doc.setFontSize(9);
    linha("______________________________________________");
    linha("Assinatura do(a) CONTRATANTE");
    y += 2;
    linha("______________________________________________");
    linha("Assinatura da CONTRATADA — " + nomeContratada + " / " + empresa);

    doc.save("contrato-" + (orcamento.id || "documento") + ".pdf");
}

/**
 * Cláusulas fixas (modelo Candy Li / lead). Atualize aqui se o texto jurídico mudar.
 */
function obterTextoClausulasContrato(cfg) {
    var pix = (cfg && cfg.contratoPixCnpj) || "";
    var em = (cfg && cfg.contratoEmailsComprovante) || "candylidoces@hotmail.com";
    var out = [];
    function add(t, titulo) {
        out.push(titulo ? { titulo: t } : { texto: t });
    }

    add("CLÁUSULA PRIMEIRA – SOBRE A ASSINATURA CONTRATUAL", true);
    add(
        "1.1. O pagamento do valor do contrato ou do sinal acordado significa total acordo com as cláusulas deste contrato. Sendo assim, não há a necessidade de envio do documento assinado por e-mail ou outro meio de comunicação."
    );

    add("CLÁUSULA SEGUNDA – SOBRE O ANEXO CONTRATUAL", true);
    add(
        "2.1. O presente contrato será cumprido conforme o ANEXO contratual que se segue, e conforme as cláusulas contratuais seguintes."
    );
    add(
        "2.2. O ANEXO contratual é completamente alterável em até 15 (quinze) dias que se precedem ao evento contratado, podendo tais alterações serem feitas pessoalmente, por WhatsApp ou por e-mail, desde que haja concordância entre as partes, passando a se constituir em Adendo ao presente Contrato."
    );
    add(
        "2.3. Não serão válidas alterações efetuadas por Facebook, SMS, ou qualquer outro meio que não sejam os descritos no item 2.2."
    );

    add("CLÁUSULA TERCEIRA – SOBRE O PAGAMENTO", true);
    add(
        "3.1. O contrato deverá estar quitado nas datas definidas no ANEXO CONTRATUAL, ou em caso de ausência desta informação, deverá ser quitado em no máximo 15 (quinze) dias que precedem o evento."
    );
    add(
        "3.2. Em caso do contrato não estar quitado no prazo, a Contratada reserva-se ao direito de entregar o serviço proporcionalmente ao valor pago. Neste caso, a escolha de quais itens serão efetivamente entregues na data do evento é incumbida à Contratada, não podendo o Contratante optar por um ou outro serviço."
    );
    add(
        "3.3. O Contratante pode optar por pagamento mediante depósito bancário, se assim preferir. No entanto, o Contratante se responsabiliza pelo pagamento em dia das prestações, conforme anexo contratual, de forma que em caso de atraso superior a dois dias úteis será revogado qualquer desconto oferecido na contratação do evento."
    );
    add(
        "3.4. Todo pagamento efetuado mediante depósito bancário SOMENTE SERÁ VALIDADO após envio do comprovante para os e-mails: " +
            em +
            " ou via WhatsApp. O não envio pode acarretar entendimento de que o contrato não foi pago, e portanto poderá ser aplicada a cláusula 3.2. PIX PARA PAGAMENTO: CNPJ: " +
            pix +
            "."
    );
    add(
        "3.5. O presente contrato se rege pelos princípios da boa-fé e pode ser revisado, desde que a necessidade seja evidente, a qualquer momento, em caso de flagrante desequilíbrio econômico-financeiro entre as partes, obedecidos os índices inflacionários vigentes, a serem ajustados entre as partes, para readequação dos valores."
    );

    add("CLÁUSULA QUARTA – SOBRE A ALTERAÇÃO DE VALORES CONTRATUAIS", true);
    add(
        "4.1. Fica a critério do Contratante efetuar qualquer aumento contratual em até 8 (oito) dias que precedem a data do evento. Os valores deste aumento deverão ser quitados até 5 (cinco) dias antes do evento. Os valores do aumento serão acordados entre as partes, respeitando o ANEXO CONTRATUAL e o item 3.5."
    );
    add(
        "4.2. Em caso de redução do valor contratado, por qualquer motivo, será emitida uma Carta de Crédito no valor de 80% do valor excedente ao já pago em relação ao novo valor, se houver. Este valor poderá ser utilizado no próprio contrato para utilização de outros itens, ou ficará a critério do Contratante utilizar no prazo de seis meses após a emissão da mesma."
    );
    add("4.3. No caso de redução dos valores, as partes acordam que não será devolvido valores em dinheiro.");
    add(
        "4.4. Somente serão aceitas reduções contratuais em prazo superior a 20 (vinte) dias da data do evento. Caso ocorra em prazo inferior, não haverá reembolso ou crédito referente à redução."
    );

    add("CLÁUSULA QUINTA – SOBRE A DESISTÊNCIA DO CONTRATO", true);
    add(
        "5.1. A desistência após o fechamento do contrato, e até 30 (trinta) dias antes da data do evento implica:\na) no pagamento de uma taxa de desistência de 10% do valor contratado, em caso de não ter sido recebida nenhuma parcela ou\nb) na perda de 20% (vinte por cento) do valor pago até o momento, ou na emissão de um crédito no valor de 100% (cem por cento) do valor pago até o momento, a ser utilizado em produtos da Contratada pelo prazo corrido de 12 (doze) meses."
    );
    add(
        "5.2. A desistência entre 15 (quinze) a 29 (vinte e nove) dias antes da data do evento implica na perda de 50% do valor pago até o momento, ou na emissão de um crédito no valor de 80% (oitenta por cento) do valor pago até o momento, a ser utilizado em produtos da Contratada pelo prazo corrido de 12 (doze) meses."
    );
    add(
        "5.3. A desistência 14 (quatorze) dias ou menos ou duas semanas antes do evento implica em perda de 90% do valor pago até o momento ou na emissão de um crédito no valor de 50% (cinquenta por cento) do valor pago até o momento, a ser utilizado em produtos da Contratada pelo prazo corrido de 12 (doze) meses."
    );
    add(
        "5.4. Em caso de desistência por parte da Contratada, a mesma devolverá 120% (cento e vinte por cento) dos valores que já foram quitados, independentemente da data da desistência."
    );

    add("CLÁUSULA SEXTA – SOBRE AS PEÇAS PARA O EVENTO", true);
    add(
        "6.1. OS MATERIAIS DEVEM SER DEVOLVIDOS NA SEMANA SEGUINTE AO EVENTO, NO ENDEREÇO DA CONTRATADA, EM ESTADO IGUAL AO DA SAÍDA DOS MESMOS, SENDO QUE EM CASO DE QUEBRA, ARRANHÕES, EXTRAVIOS OU SIMILARES, DEVERÃO SER PAGOS EM VALOR DE MERCADO OU SUBSTITUÍDOS POR OUTROS IDÊNTICOS.\nNO ATO DA ASSINATURA DESTE CONTRATO, A CONTRATANTE SE RESPONSABILIZA PELOS MATERIAIS A SEREM UTILIZADOS EM CASO DE ACIDENTE OCASIONADO POR CONVIDADOS OU FORNECEDORES, E NÃO SE RESPONSABILIZA POR MATERIAIS QUEBRADOS OU PERDIDOS PELA COPEIRA, NO CASO DESSE SERVIÇO TER SIDO CONTRATADO."
    );
    add(
        "6.2. A linha de peças escolhida fica reservada para o Contratante para a data definida em contrato. Em caso de alteração de data, deverá ser efetuada nova reserva da linha de peças, sujeita à disponibilidade do dia."
    );
    add(
        "6.3. A Contratante concorda que não é possível definir quais materiais exatamente serão utilizados no seu evento, mas entende que a Contratada se compromete a utilizar os materiais escolhidos conforme a linha de peças optada, conforme anexo contratual:\na) Montagem com linha de vidros e espelhos: abrange taças de vidro, peças retas de vidro e pés de vidro ou espelho;\nb) montagem com linha perolada: abrange peças de porcelana.\nc) montagem com linha cristais: abrange taças de cristal e peças retas de cristal;"
    );
    add(
        "6.4. Mediante a locação da linha de peças, a Contratada montará a mesa dos doces, em horário a ser definido na semana do evento. A Contratada compromete-se a terminar a montagem da mesa dos doces antes da chegada dos convidados ao evento."
    );

    add("CLÁUSULA SÉTIMA – SOBRE AS FORMINHAS", true);
    add(
        "7.1. O Contratante tem a opção de contratar as forminhas para os doces com a Contratada, desde que o pedido seja formalizado e pago em até 15 (quinze) dias antes do evento;"
    );
    add(
        "7.2. Não recomendamos que o Contratante opte por trazer forminhas para doces adquiridas em outros lugares, mas caso o Contratante assim deseje, este fica ciente de que NÃO NOS RESPONSABILIZAMOS pela segurança alimentar dos produtos servidos nestas embalagens."
    );
    add(
        "7.2.1. Se o Contratante optar por trazer forminhas de terceiros, as mesmas devem ser entregues à Contratada no prazo de 03 (três) a 10 (dez) dias que precedem o evento. Não serão aceitas forminhas antes deste prazo, e as forminhas entregues depois do prazo ficam a critério da Contratada a utilização, sob possibilidade de não serem utilizadas e portanto serem devolvidas ao Contratante."
    );
    add(
        "7.2.2. As forminhas excedentes serão descartadas, tendo em vista que consta do Anexo Contratual a quantidade necessária para o pedido."
    );
    add(
        "7.2.3. Não serão aceitas: forminhas de papel crepom, forminhas reutilizadas e forminhas claramente e visivelmente fora dos padrões de higiene."
    );

    add("CLÁUSULA OITAVA – SOBRE A PERECIBILIDADE E SAZONALIDADE DOS PRODUTOS", true);
    add(
        "8.1. O Contratante está ciente que para os bolos de copa é necessário o armazenamento em geladeiras. Caso no Buffet não haja geladeira disponível, a Contratada não se responsabilizará pela perecibilidade do produto."
    );
    add(
        "8.2. A responsabilidade da Contratada sobre os produtos oferecidos termina ao final do evento. A Contratante tem ciência de que se trata de produtos para consumo imediato."
    );
    add("8.3. A Contratada não se responsabiliza por produtos que não tenha fornecido.");
    add(
        "8.4. O Contratante está ciente que frutas de quaisquer tipo podem sofrer alteração de cor, tamanho ou de disponibilidade de acordo com a época do ano, ou alterações climáticas. Nesse caso, fica a critério da Contratada optar por outro produto de igual valor para substituição do antes escolhido pela Contratante, sem necessidade de aviso prévio ao Contratante."
    );
    add(
        "8.4.1. Em caso de não haver disponibilidade da fruta escolhida para a data do evento, a Contratada reserva-se ao direito de efetuar qualquer alteração sem prévio aviso ao Contratante."
    );

    add("CLÁUSULA NONA – SOBRE PRODUTOS DE TERCEIROS", true);
    add(
        "9.1. Em hipótese nenhuma a Contratada transportará produtos de terceiros, tais como: bolos cênicos, doces extras e lembranças feitas por outros profissionais. Caso o Contratante deseje que seja utilizado em seu evento algum produto deste gênero, fica sob sua responsabilidade a entrega dos mesmos no local do evento."
    );
    add(
        "9.2. A Contratada somente poderá manipular os produtos de terceiros após o Contratante passar uma listagem por escrito e assinada, para desta forma comprovar que a Contratada não tem nenhuma responsabilidade pela segurança alimentar de produtos que não foram de sua fabricação."
    );

    add("CLÁUSULA DÉCIMA – SOBRE O USO DE IMAGEM", true);
    add(
        "10.1. O Contratante autoriza desde a assinatura deste contrato o uso das imagens referentes aos doces, a mesa de doces, a mesa de café, lembranças, bolos e todo e qualquer produto fornecido pela Contratada, para fins de divulgação, marketing e portfólio empresarial."
    );
    add(
        "10.2. O Contratante autoriza que a Contratada divulgue fotos do seu evento em seu link de notícias do site, Facebook e Instagram e outras redes sociais, inclusive com citação do primeiro nome do Contratante e local da festa, se assim achar oportuno, desde que não divulgue sobrenomes e dados pessoais dos mesmos."
    );
    add(
        "10.3. A Contratada está autorizada a repostar posts e stories feitos pelo Contratante a respeito de sua festa, independentemente da cláusula 10.2, desde que a Contratada esteja marcada nestas postagens."
    );

    add("CLÁUSULA DÉCIMA PRIMEIRA – GARANTIA", true);
    add(
        "11.1. Nós nos propomos a entregar o produto de acordo com os sabores, recheios, decorações, tamanhos e formas solicitados. Entretanto, a criação do bolo e dos doces é uma arte e pode estar sujeita a leves variações pelo criador. Garantimos o melhor produto e serviço possíveis."
    );

    return out;
}
