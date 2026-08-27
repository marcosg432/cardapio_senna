/**
 * Detalhe do orçamento (admin): desconto, degustação, pagamento, WhatsApp, PDF proposta
 */
(function () {
    /** Soma valor original a partir dos itens (mantém coerência com PDF/WhatsApp). */
    function somaSubtotalItens(itens) {
        var t = 0;
        (itens || []).forEach(function (it) {
            var pu = it.preco_unitario != null ? it.preco_unitario : it.preco;
            var sub = it.subtotal != null ? it.subtotal : (Number(pu) || 0) * (Number(it.quantidade) || 0);
            t += Number(sub) || 0;
        });
        return Math.round(t * 100) / 100;
    }

    function parsePrecoExtra(raw) {
        if (raw == null || String(raw).trim() === "") return null;
        var n = parseFloat(String(raw).trim().replace(",", "."));
        if (isNaN(n) || n < 0) return null;
        return Math.round(n * 100) / 100;
    }

    var OBS_SUPORTES_CORTESIA_ADMIN = "Os suportes devem ser devolvidos na semana seguinte à festa.";

    function entregaSuporteEhCortesiaAdmin(valor) {
        return /cortesia/i.test(String(valor || ""));
    }

    function inferirEntregaRetirada(o) {
        var t = String((o && o.entrega_retirada) || "").trim();
        if (t === "Entrega" || t === "Retirada") return t;
        var e = String((o && o.entrega) || "").trim();
        if (/^entrega/i.test(e)) return "Entrega";
        if (/retirada/i.test(e)) return "Retirada";
        return "";
    }

    function inferirEnderecoEntrega(o) {
        if (o && o.endereco != null && String(o.endereco).trim() !== "") {
            return String(o.endereco).trim();
        }
        var e = String((o && o.entrega) || "");
        var m = e.match(/^Entrega\s+[—\-]\s*(.*)$/);
        if (m && String(m[1]).trim()) return String(m[1]).trim();
        return "";
    }

    function montarTextoEntrega(tipo, endereco) {
        if (tipo === "Entrega") return "Entrega — " + (endereco || "");
        return tipo || "";
    }

    function garantirOpcaoSelect(sel, valor) {
        if (!sel || valor == null || String(valor).trim() === "") return;
        var v = String(valor).trim();
        var existe = Array.prototype.some.call(sel.options, function (opt) {
            return opt.value === v;
        });
        if (!existe) {
            var extra = document.createElement("option");
            extra.value = v;
            extra.textContent = v;
            sel.appendChild(extra);
        }
    }

    function atualizarUiEntregaAdmin() {
        var tipo = strInput("edit-entrega-retirada");
        var wrap = document.getElementById("edit-endereco-wrap");
        if (wrap) wrap.hidden = tipo !== "Entrega";
        var suporte = strInput("edit-entrega-suporte");
        var elEntSupObs = document.getElementById("view-entrega-suporte-obs");
        if (elEntSupObs) {
            if (entregaSuporteEhCortesiaAdmin(suporte)) {
                elEntSupObs.textContent = "Observação (contrato): " + OBS_SUPORTES_CORTESIA_ADMIN;
                elEntSupObs.hidden = false;
            } else {
                elEntSupObs.textContent = "";
                elEntSupObs.hidden = true;
            }
        }
        atualizarReferenciaTaxaEntrega(suporte);
    }

    function patchCamposEntregaDom() {
        var tipo = strInput("edit-entrega-retirada");
        var endereco = strInput("edit-endereco");
        var suporte = strInput("edit-entrega-suporte");
        return {
            entrega_retirada: tipo || null,
            endereco: tipo === "Entrega" && endereco ? endereco : null,
            entrega: montarTextoEntrega(tipo, endereco) || null,
            entrega_suporte: suporte || null,
            entrega_suporte_obs: entregaSuporteEhCortesiaAdmin(suporte) ? OBS_SUPORTES_CORTESIA_ADMIN : null
        };
    }

    /**
     * Sugestão "a partir de" conforme a opção escolhida no site (só referência no admin).
     * @param {string} entregaSuporte
     * @returns {{min: number, rotulo: string}|null}
     */
    function referenciaTaxaPorEntregaSuporte(entregaSuporte) {
        var v = String(entregaSuporte || "").toLowerCase();
        if (!v) return null;
        if (/retirada/.test(v)) return { min: 0, rotulo: "Sem custo adicional (retirada)" };
        if (/sem montagem/.test(v)) return { min: 50, rotulo: "A partir de R$ 50,00 (entrega sem montagem)" };
        if (/decora/.test(v)) return { min: 150, rotulo: "A partir de R$ 150,00 (montagem — suporte da decoração)" };
        if (/cortesia/.test(v)) return { min: 200, rotulo: "A partir de R$ 200,00 (montagem — suporte cortesia)" };
        return null;
    }

    function atualizarReferenciaTaxaEntrega(entregaSuporte) {
        var el = document.getElementById("taxa-entrega-referencia");
        if (!el) return;
        var ref = referenciaTaxaPorEntregaSuporte(entregaSuporte);
        if (!ref) {
            el.textContent = "";
            el.hidden = true;
            return;
        }
        el.textContent = "Referência do site para esta escolha: " + ref.rotulo + ". Ajuste o campo acima para o valor acordado.";
        el.hidden = false;
    }

    function getQueryId() {
        var params = new URLSearchParams(window.location.search);
        return params.get("id");
    }

    function preencherStatusSelect(select, valorAtual) {
        if (!select || typeof CONFIG === "undefined") return;
        var labels = CONFIG.STATUS_LABELS || {};
        Object.keys(labels).forEach(function (key) {
            var opt = document.createElement("option");
            opt.value = key;
            opt.textContent = labels[key];
            select.appendChild(opt);
        });
        if (valorAtual) {
            var keyAtual = statusNormalizado({ status: valorAtual });
            var existe = Array.prototype.some.call(select.options, function (opt) {
                return opt.value === keyAtual;
            });
            if (!existe) {
                var extra = document.createElement("option");
                extra.value = valorAtual;
                extra.textContent = valorAtual;
                select.appendChild(extra);
                keyAtual = valorAtual;
            }
            select.value = keyAtual;
        }
    }

    function strCampoMoeda(id) {
        var el = document.getElementById(id);
        return el ? el.value : "";
    }

    function formatarCampoMoedaOpcional(v) {
        if (v == null || v === "") return "";
        return String(v).replace(".", ",");
    }

    function atualizarPreviewFinal(orcamento) {
        var tipo = document.getElementById("desconto-tipo").value || null;
        var val = parseFloat(String(document.getElementById("desconto-valor").value).replace(",", ".")) || 0;
        var vo =
            typeof valorOriginalOrcamentoComItens === "function"
                ? valorOriginalOrcamentoComItens(orcamento)
                : valorOriginalOrcCompat(orcamento);
        var ddRaw = strCampoMoeda("desconto-degustacao");
        var dcRaw = strCampoMoeda("desconto-cerimonialista");
        var teRaw = strCampoMoeda("taxa-entrega");
        var vf = calcularValorFinalOrcamento(vo, tipo, val, ddRaw, dcRaw, teRaw);
        document.getElementById("preview-valor-final").textContent = formatarMoeda(vf);
        var dr = tipo ? descontoEquivalenteEmReais(vo, tipo, val) : 0;
        document.getElementById("preview-desconto-reais").textContent = formatarMoeda(dr);
        var ddN = valorMonetarioOrcamentoOpcional(ddRaw);
        var dcN = valorMonetarioOrcamentoOpcional(dcRaw);
        var teN = valorMonetarioOrcamentoOpcional(teRaw);
        document.getElementById("preview-desconto-deg").textContent = formatarMoeda(ddN);
        document.getElementById("preview-desconto-cer").textContent = formatarMoeda(dcN);
        document.getElementById("preview-taxa-entrega").textContent = formatarMoeda(teN);
        var subMaisEnt = Math.round((Number(vo) + teN) * 100) / 100;
        var elTce = document.getElementById("preview-total-com-entrega");
        if (elTce) elTce.textContent = formatarMoeda(subMaisEnt);
        var somaDesc = Math.round((dr + ddN + dcN) * 100) / 100;
        var elSoma = document.getElementById("preview-soma-descontos");
        if (elSoma) elSoma.textContent = formatarMoeda(somaDesc);
        var entIn = numeroInput("entrada");
        var rest = calcularValorRestanteOrcamento(vf, entIn == null ? null : entIn);
        document.getElementById("restante").value = String(rest).replace(".", ",");
    }

    function numeroInput(id) {
        var el = document.getElementById(id);
        if (!el || el.value === "") return null;
        var n = parseFloat(String(el.value).replace(",", "."));
        return isNaN(n) ? null : n;
    }

    /** Nunca use `if (el.value)` — valores vazios ou caracteres válidos ficam perdidos antes do trim */
    function strInput(id) {
        var el = document.getElementById(id);
        if (!el) return "";
        var v = el.value;
        if (v == null || v === "") return "";
        return String(v).trim();
    }

    /** Texto da observação interna: prioriza o textarea, depois o orçamento em memória. */
    function observacoesInternasAtual() {
        var el = document.getElementById("observacoes-internas");
        if (el && typeof el.blur === "function") el.blur();
        var t = strInput("observacoes-internas");
        if (t) return t;
        if (orcamentoAtual && orcamentoAtual.observacoes_internas != null) {
            var s = String(orcamentoAtual.observacoes_internas).trim();
            if (s) return s;
        }
        return null;
    }

    /** Observações do orçamento (pedido): textarea do admin, depois o valor gravado. */
    function observacoesOrcamentoAtual() {
        var el = document.getElementById("edit-observacoes");
        if (el && typeof el.blur === "function") el.blur();
        var t = strInput("edit-observacoes");
        if (t) return t;
        if (orcamentoAtual && orcamentoAtual.observacoes != null) {
            var s = String(orcamentoAtual.observacoes).trim();
            if (s) return s;
        }
        return null;
    }

    function montarWhatsAppDetalhe(o) {
        var vo =
            typeof valorOriginalOrcamentoComItens === "function"
                ? valorOriginalOrcamentoComItens(o)
                : valorOriginalOrcCompat(o);
        var vf = valorFinalOrc(o);
        var vd = o.valor_desconto;
        if ((vd == null || vd === "") && typeof descontoEquivalenteEmReais === "function") {
            vd = descontoEquivalenteEmReais(vo, o.desconto_tipo, o.desconto_valor);
        }
        var nome = o.cliente || o.nome_cliente || "-";
        var msg = "ORCAMENTO — " + (CONFIG.nomeEmpresa || "") + "\n\n";
        msg += "Cliente: " + nome + "\n";
        var cpfW = String(o.cliente_cpf || o.cpf || "").trim();
        var rgW = String(o.cliente_rg || o.rg || "").trim();
        if (cpfW) msg += "CPF: " + cpfW + "\n";
        if (rgW) msg += "RG: " + rgW + "\n";
        msg += "Tipo do evento: " + (eventoTipoOrc(o) || "-") + "\n";
        msg += "Data do evento: " + (eventoDataOrc(o) || "-") + "\n";
        var entSupW = String(o.entrega_suporte || "").trim();
        if (entSupW) {
            msg += "Forma de entrega/suporte: " + entSupW + "\n";
            if (/cortesia/i.test(entSupW)) {
                msg += "Obs.: " + (o.entrega_suporte_obs && String(o.entrega_suporte_obs).trim() !== "" ? o.entrega_suporte_obs : "Os suportes devem ser devolvidos na semana seguinte à festa.") + "\n";
            }
        }
        msg += "\nITENS:\n";
        (o.itens || []).forEach(function (it) {
            var pu = it.preco_unitario != null ? it.preco_unitario : it.preco;
            var sub = it.subtotal != null ? it.subtotal : (Number(pu) || 0) * (Number(it.quantidade) || 0);
            var linhaQtd = typeof formatarQtdNomeItemOrcamento === "function"
                ? formatarQtdNomeItemOrcamento(it)
                : (it.quantidade || 0) + "x " + (it.nome || "");
            msg += linhaQtd + " — R$ " + Number(sub).toFixed(2).replace(".", ",") + "\n";
        });
        msg += "\nSubtotal (produtos): R$ " + Number(vo).toFixed(2).replace(".", ",");
        var dd = valorMonetarioOrcamentoOpcional(o.desconto_degustacao);
        var dc = valorMonetarioOrcamentoOpcional(o.desconto_cerimonialista);
        var te = valorMonetarioOrcamentoOpcional(o.taxa_entrega);
        msg += "\nTaxa de entrega: R$ " + te.toFixed(2).replace(".", ",");
        var baseComEnt = Math.round((Number(vo) + te) * 100) / 100;
        msg += "\nTotal com entrega (antes dos descontos): R$ " + baseComEnt.toFixed(2).replace(".", ",");
        if (dc > 0) msg += "\nDesconto cerimonialista: R$ " + dc.toFixed(2).replace(".", ",");
        msg += "\nDesconto geral: R$ " + Number(vd || 0).toFixed(2).replace(".", ",");
        if (dd > 0) msg += "\nDesconto degustação: R$ " + dd.toFixed(2).replace(".", ",");
        var somaD = Math.round((Number(vd || 0) + dd + dc) * 100) / 100;
        msg += "\nTotal de descontos: R$ " + somaD.toFixed(2).replace(".", ",");
        msg += "\nValor final: R$ " + Number(vf).toFixed(2).replace(".", ",");
        msg += "\n\nForma de pagamento: " + (formaPagamentoOrc(o) || "-");
        var dppW = String(o.data_pagamento_entrada_prevista || "").trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(dppW)) {
            var pdppW = dppW.split("-");
            dppW = pdppW[2] + "/" + pdppW[1] + "/" + pdppW[0];
        }
        if (dppW) msg += "\nData prevista p/ pagamento da entrada (cliente): " + dppW;
        var ent = o.entrada;
        var rest = o.restante;
        if (ent != null && ent !== "" || rest != null && rest !== "") {
            msg += "\nEntrada: R$ " + Number(ent || 0).toFixed(2).replace(".", ",");
            msg += "\nRestante: R$ " + Number(rest || 0).toFixed(2).replace(".", ",");
        }
        var obsW = String(o.observacoes || "").trim();
        if (obsW) msg += "\n\nObservações: " + obsW;
        msg += "\n\nRef: " + o.id;
        msg += "\n-------------";
        return msg;
    }

    function renderOrcamento(o) {
        document.getElementById("orc-id").textContent = o.id;
        document.getElementById("view-nome").textContent = o.cliente || o.nome_cliente || "—";
        document.getElementById("view-telefone").textContent = o.telefone || "—";
        document.getElementById("view-email").textContent = o.email || "—";
        var cpfV = String(o.cliente_cpf || o.cpf || "").trim();
        var rgV = String(o.cliente_rg || o.rg || "").trim();
        document.getElementById("view-cpf").textContent = cpfV ? cpfV : "—";
        document.getElementById("view-rg").textContent = rgV ? rgV : "—";
        document.getElementById("view-data-evento").textContent = eventoDataOrc(o) || "—";
        document.getElementById("view-tipo-evento").textContent = eventoTipoOrc(o) || "—";
        document.getElementById("view-convidados").textContent = o.convidados != null ? o.convidados : "—";
        document.getElementById("view-local").textContent = localOrc(o) || "—";
        var selTipoEnt = document.getElementById("edit-entrega-retirada");
        if (selTipoEnt) {
            selTipoEnt.value = inferirEntregaRetirada(o);
        }
        var elEndereco = document.getElementById("edit-endereco");
        if (elEndereco) elEndereco.value = inferirEnderecoEntrega(o);
        var selSuporte = document.getElementById("edit-entrega-suporte");
        if (selSuporte) {
            garantirOpcaoSelect(selSuporte, o.entrega_suporte);
            selSuporte.value = String(o.entrega_suporte || "").trim();
        }
        atualizarUiEntregaAdmin();
        var elDataPagPrev = document.getElementById("view-data-pag-entrada-prevista");
        if (elDataPagPrev) {
            var dpp = String(o.data_pagamento_entrada_prevista || "").trim();
            if (/^\d{4}-\d{2}-\d{2}$/.test(dpp)) {
                var pdpp = dpp.split("-");
                dpp = pdpp[2] + "/" + pdpp[1] + "/" + pdpp[0];
            }
            elDataPagPrev.textContent = dpp ? dpp : "—";
        }
        var elObsPedido = document.getElementById("edit-observacoes");
        if (elObsPedido) elObsPedido.value = o.observacoes || "";

        function setCampoContrato(id, valor) {
            var el = document.getElementById(id);
            if (el) el.value = valor != null && valor !== "" ? String(valor) : "";
        }
        setCampoContrato("contrato-pdf-nome-cliente", o.nome_cliente || o.cliente);
        setCampoContrato("contrato-pdf-email", o.email);
        setCampoContrato("contrato-pdf-telefone", o.telefone);
        setCampoContrato("contrato-pdf-data-evento", eventoDataOrc(o));
        setCampoContrato("contrato-pdf-tipo-evento", eventoTipoOrc(o));
        setCampoContrato("contrato-numero-exibicao", o.contrato_numero_exibicao);
        setCampoContrato("contrato-cliente-rg", o.cliente_rg || o.rg);
        setCampoContrato("contrato-cliente-cpf", o.cliente_cpf || o.cpf);
        setCampoContrato("contrato-cliente-nasc", o.cliente_data_nascimento);
        setCampoContrato("contrato-cliente-endereco", o.cliente_endereco_linha);
        setCampoContrato("contrato-cliente-cep", o.cliente_cep);
        setCampoContrato("contrato-telefone-fixo", o.telefone_fixo);
        setCampoContrato("contrato-contato-nome", o.contato_nome);
        setCampoContrato("contrato-contato-celular", o.contato_celular);
        setCampoContrato("contrato-local-festa", o.evento_local_festa);
        setCampoContrato("contrato-horario-entrega", o.evento_horario_entrega);
        setCampoContrato("contrato-local-cerimonia", o.evento_local_cerimonia);
        setCampoContrato("contrato-horario-festa", o.evento_horario_festa);
        setCampoContrato("contrato-cerimonialista", o.evento_cerimonialista);
        setCampoContrato("contrato-cerimonialista-tel", o.evento_cerimonialista_tel);
        setCampoContrato("contrato-fotografo", o.evento_fotografo);
        setCampoContrato("contrato-fotografo-tel", o.evento_fotografo_tel);
        setCampoContrato("contrato-quitado-em", o.pagamento_valor_quitado_em);

        if (extraItemEdicaoIndex != null) {
            var itEdit = (o.itens || [])[extraItemEdicaoIndex];
            if (!itEdit) extraItemEdicaoIndex = null;
        }

        var ajudaItens = document.getElementById("itens-editar-ajuda");
        if (ajudaItens) {
            ajudaItens.textContent =
                "Use Editar ou Remover à direita de cada linha. Itens do cardápio respeitam o pedido mínimo do site; complementos manuais aparecem com (complemento manual).";
        }

        var ul = document.getElementById("lista-itens");
        ul.innerHTML = "";
        (o.itens || []).forEach(function (it, idx) {
            var li = document.createElement("li");
            li.className = "admin-lista-item-linha" + (it.extra_pedido_admin === true ? " admin-lista-item-linha--extra" : "");
            var pu = it.preco_unitario != null ? it.preco_unitario : it.preco;
            var sub = it.subtotal != null ? it.subtotal : (Number(pu) || 0) * (Number(it.quantidade) || 0);
            var linhaQtd = typeof formatarQtdNomeItemOrcamento === "function"
                ? formatarQtdNomeItemOrcamento(it)
                : it.quantidade + " × " + (it.nome || "");
            var linha = linhaQtd + " @ " + formatarMoeda(pu) + " = " + formatarMoeda(sub);
            if (it.extra_pedido_admin === true) linha += " (complemento manual)";
            var spanTxt = document.createElement("span");
            spanTxt.className = "admin-lista-item-texto";
            spanTxt.textContent = linha;
            li.appendChild(spanTxt);
            var acoes = document.createElement("span");
            acoes.className = "admin-lista-item-acoes";
            var btnEd = document.createElement("button");
            btnEd.type = "button";
            btnEd.className = "admin-btn-item-acao";
            btnEd.textContent = "Editar";
            btnEd.setAttribute("data-acao-extra", "editar");
            btnEd.setAttribute("data-item-index", String(idx));
            var btnRm = document.createElement("button");
            btnRm.type = "button";
            btnRm.className = "admin-btn-item-acao admin-btn-item-acao--perigo";
            btnRm.textContent = "Remover";
            btnRm.setAttribute("data-acao-extra", "remover");
            btnRm.setAttribute("data-item-index", String(idx));
            acoes.appendChild(btnEd);
            acoes.appendChild(btnRm);
            li.appendChild(acoes);
            ul.appendChild(li);
        });

        atualizarUiModoExtra();

        var somaLinhas = somaSubtotalItens(o.itens);
        var voReg =
            typeof valorOriginalOrcamentoComItens === "function"
                ? valorOriginalOrcamentoComItens(o)
                : valorOriginalOrcCompat(o);
        document.getElementById("valor-original").textContent = formatarMoeda(voReg);
        var divDiv = document.getElementById("valor-original-divergencia");
        if (divDiv) {
            if (Math.abs(somaLinhas - voReg) > 0.02) {
                divDiv.hidden = false;
                divDiv.textContent =
                    "Atenção: a soma das linhas acima é " +
                    formatarMoeda(somaLinhas) +
                    ", diferente do valor registrado (" +
                    formatarMoeda(voReg) +
                    "). Use “Salvar alterações” após ajustar itens ou confira se o orçamento foi editado fora do painel.";
            } else {
                divDiv.hidden = true;
                divDiv.textContent = "";
            }
        }

        document.getElementById("desconto-tipo").value = o.desconto_tipo || "";
        document.getElementById("desconto-valor").value =
            o.desconto_valor != null && o.desconto_valor !== "" ? String(o.desconto_valor).replace(".", ",") : "";

        document.getElementById("desconto-degustacao").value = formatarCampoMoedaOpcional(o.desconto_degustacao);
        document.getElementById("desconto-cerimonialista").value = formatarCampoMoedaOpcional(o.desconto_cerimonialista);
        document.getElementById("taxa-entrega").value = formatarCampoMoedaOpcional(o.taxa_entrega);

        document.getElementById("degustacao-data").value = o.degustacao_data || "";
        document.getElementById("degustacao-hora").value = o.degustacao_hora || "";
        document.getElementById("degustacao-obs").value = o.degustacao_obs || "";
        var elObsInternas = document.getElementById("observacoes-internas");
        if (elObsInternas) elObsInternas.value = o.observacoes_internas || "";

        var fp = formaPagamentoOrc(o);
        var selFp = document.getElementById("forma-pagamento-adm");
        if (fp && !Array.prototype.some.call(selFp.options, function (opt) { return opt.value === fp; })) {
            var op = document.createElement("option");
            op.value = fp;
            op.textContent = fp;
            selFp.appendChild(op);
        }
        selFp.value = fp || "";

        document.getElementById("entrada").value =
            o.entrada != null && o.entrada !== "" ? String(o.entrada).replace(".", ",") : "";
        var elDataPagPrevInput = document.getElementById("data-pag-entrada-prevista");
        if (elDataPagPrevInput) {
            var dppInput = String(o.data_pagamento_entrada_prevista || "").trim();
            elDataPagPrevInput.value = /^\d{4}-\d{2}-\d{2}$/.test(dppInput) ? dppInput : "";
        }
        document.getElementById("data-pag-final").value = o.data_pagamento_final || "";

        var selStatus = document.getElementById("status-orcamento");
        selStatus.innerHTML = "";
        preencherStatusSelect(selStatus, o.status);
        atualizarPreviewFinal(o);
    }

    var orcamentoAtual = null;
    /** Índice em `orcamentoAtual.itens` ao editar uma linha; null = modo inclusão de complemento. */
    var extraItemEdicaoIndex = null;

    function pedidoMinimoPadraoAdmin() {
        if (typeof CONFIG !== "undefined" && CONFIG.pedidoMinimoUnidades != null) {
            var n = parseInt(String(CONFIG.pedidoMinimoUnidades), 10);
            if (Number.isFinite(n) && n >= 1) return n;
        }
        return 50;
    }

    function qtdMinItemOrcamento(it) {
        if (!it) return pedidoMinimoPadraoAdmin();
        if (it.extra_pedido_admin === true) return 1;
        var padrao = pedidoMinimoPadraoAdmin();
        var raw = it.qtd_min != null ? it.qtd_min : it.qtdMin != null ? it.qtdMin : padrao;
        var m = parseInt(String(raw), 10);
        if (!Number.isFinite(m) || m < 1) return padrao;
        return m;
    }

    function montarItemOrcamentoEditado(itemAnterior, nome, q, precoUnit) {
        var subtotalItem = Math.round(q * precoUnit * 100) / 100;
        var unidadeItem = itemAnterior && itemAnterior.unidade ? String(itemAnterior.unidade).trim() : "";
        if (itemAnterior && itemAnterior.extra_pedido_admin === true) {
            return {
                nome: nome,
                quantidade: q,
                preco: precoUnit,
                preco_unitario: precoUnit,
                subtotal: subtotalItem,
                qtd_min: 1,
                extra_pedido_admin: true,
                unidade: unidadeItem
            };
        }
        var qm = itemAnterior
            ? itemAnterior.qtd_min != null
                ? itemAnterior.qtd_min
                : itemAnterior.qtdMin != null
                  ? itemAnterior.qtdMin
                  : qtdMinItemOrcamento(itemAnterior)
            : pedidoMinimoPadraoAdmin();
        return {
            nome: nome,
            quantidade: q,
            preco: precoUnit,
            preco_unitario: precoUnit,
            subtotal: subtotalItem,
            qtd_min: qm,
            unidade: unidadeItem
        };
    }

    function atualizarUiModoExtra() {
        var edicao = extraItemEdicaoIndex != null;
        var tit = document.getElementById("extra-doce-titulo");
        var btnOk = document.getElementById("btn-extra-adicionar-item");
        var btnCanc = document.getElementById("btn-extra-cancelar-edicao");
        var hintMin = document.getElementById("extra-doce-hint-min");
        var desc = document.getElementById("extra-doce-descricao");
        if (!tit || !btnOk || !btnCanc) return;
        if (edicao && orcamentoAtual) {
            var itEd = (orcamentoAtual.itens || [])[extraItemEdicaoIndex];
            if (itEd && itEd.extra_pedido_admin === true) {
                tit.textContent = "Editar doce complementar";
                if (hintMin) hintMin.hidden = true;
            } else {
                tit.textContent = "Editar item do cardápio";
                if (hintMin) {
                    var minQ = qtdMinItemOrcamento(itEd);
                    var rotuloMin = typeof rotuloUnidadeVenda === "function"
                        ? rotuloUnidadeVenda(itEd && itEd.unidade, minQ)
                        : "unidade(s)";
                    hintMin.textContent = "Pedido mínimo deste item: " + minQ + " " + rotuloMin + ".";
                    hintMin.hidden = false;
                }
            }
            if (desc) desc.hidden = true;
        } else {
            tit.textContent = "Incluir doce complementar";
            if (hintMin) {
                hintMin.hidden = true;
                hintMin.textContent = "";
            }
            if (desc) desc.hidden = false;
        }
        btnOk.textContent = edicao ? "Salvar alterações do item" : "Adicionar à lista";
        btnCanc.hidden = !edicao;
    }

    function sairModoEdicaoExtra() {
        extraItemEdicaoIndex = null;
        var n = document.getElementById("extra-doce-nome");
        var q = document.getElementById("extra-doce-qtd");
        var p = document.getElementById("extra-doce-preco");
        if (n) n.value = "";
        if (q) q.value = "1";
        if (p) p.value = "";
        atualizarUiModoExtra();
    }

    function validarCamposTipoDesconto() {
        var tipoDes = document.getElementById("desconto-tipo").value || null;
        var valRaw = document.getElementById("desconto-valor").value;
        var valDes = parseFloat(String(valRaw).replace(",", ".")) || 0;
        if (tipoDes && valDes <= 0) {
            alert("Informe um valor de desconto válido ou deixe o tipo de desconto em branco.");
            return false;
        }
        return true;
    }

    /**
     * Grava novo array de itens e recalcula totais (mesma regra do botão incluir complemento).
     * @returns {boolean} false se falhou salvar.
     */
    function persistirItensOrcamento(lista) {
        var vo = somaSubtotalItens(lista);
        orcamentoAtual.itens = lista;
        orcamentoAtual.valor_original = vo;
        orcamentoAtual.total = vo;
        var patch = patchComumExtra();
        var atualizado = atualizarOrcamentoParcial(orcamentoAtual.id, patch);
        if (!atualizado) {
            orcamentoAtual = getOrcamentoPorId(orcamentoAtual.id);
            alert("Não foi possível salvar os itens. Tente novamente.");
            renderOrcamento(orcamentoAtual);
            atualizarPreviewFinal(orcamentoAtual);
            return false;
        }
        orcamentoAtual = atualizado;
        renderOrcamento(orcamentoAtual);
        atualizarPreviewFinal(orcamentoAtual);
        return true;
    }

    function salvarObservacaoInterna(valor, mensagemSucesso) {
        var texto = valor != null ? String(valor).trim() : "";
        var patch = { observacoes_internas: texto ? texto : null };
        var atualizado = atualizarOrcamentoParcial(orcamentoAtual.id, patch);
        if (!atualizado) {
            alert("Não foi possível salvar a observação. Tente novamente.");
            return false;
        }
        orcamentoAtual = atualizado;
        orcamentoAtual.observacoes_internas = texto ? texto : null;
        var el = document.getElementById("observacoes-internas");
        if (el) el.value = texto;
        if (mensagemSucesso) alert(mensagemSucesso);
        return true;
    }

    function preencherFormExtraDeItem(it) {
        var nomeEl = document.getElementById("extra-doce-nome");
        var qtdEl = document.getElementById("extra-doce-qtd");
        var precoEl = document.getElementById("extra-doce-preco");
        if (!nomeEl || !qtdEl || !precoEl) return;
        nomeEl.value = it.nome || "";
        qtdEl.value = String(it.quantidade != null ? it.quantidade : 1);
        var pu = it.preco_unitario != null ? it.preco_unitario : it.preco;
        if (pu != null && pu !== "") {
            precoEl.value = String(pu).replace(".", ",");
        } else {
            precoEl.value = "";
        }
    }

    function opcionalMoedaPatch(id) {
        var el = document.getElementById(id);
        if (!el || String(el.value).trim() === "") return null;
        var n = parseFloat(String(el.value).replace(",", "."));
        return isNaN(n) ? null : Math.round(n * 100) / 100;
    }

    /**
     * Nome, e-mail, celular principal e data/tipo do evento usados no PDF e no texto introdutório do contrato.
     * Estes campos não existiam como inputs (só leitura no topo); sem isto o PDF ignora correções.
     */
    function patchCamposClienteEventoPdfDom() {
        var nome = strInput("contrato-pdf-nome-cliente");
        var em = strInput("contrato-pdf-email");
        var tel = strInput("contrato-pdf-telefone");
        var dEvt = strInput("contrato-pdf-data-evento");
        var tipoEvt = strInput("contrato-pdf-tipo-evento");
        var nomeOrNull = nome ? nome : null;
        var emOrNull = em ? em : null;
        var telOrNull = tel ? tel : null;
        var dOrNull = dEvt ? dEvt : null;
        var tOrNull = tipoEvt ? tipoEvt : null;
        return {
            nome_cliente: nomeOrNull,
            cliente: nomeOrNull,
            email: emOrNull,
            telefone: telOrNull,
            evento_data: dOrNull,
            data_evento: dOrNull,
            evento_tipo: tOrNull,
            tipo_evento: tOrNull
        };
    }

    function patchComumExtra() {
        var tipo = document.getElementById("desconto-tipo").value || null;
        var valRaw = document.getElementById("desconto-valor").value;
        var val = parseFloat(String(valRaw).replace(",", ".")) || 0;
        var vo =
            typeof valorOriginalOrcamentoComItens === "function"
                ? valorOriginalOrcamentoComItens(orcamentoAtual)
                : valorOriginalOrcCompat(orcamentoAtual);
        var ddRaw = strCampoMoeda("desconto-degustacao");
        var dcRaw = strCampoMoeda("desconto-cerimonialista");
        var teRaw = strCampoMoeda("taxa-entrega");
        var vf = calcularValorFinalOrcamento(vo, tipo, val, ddRaw, dcRaw, teRaw);
        var vDesc = tipo ? descontoEquivalenteEmReais(vo, tipo, val) : 0;

        var entrada = numeroInput("entrada");
        var restante = calcularValorRestanteOrcamento(vf, entrada == null ? null : entrada);

        return Object.assign(
            {
            desconto_tipo: tipo || null,
            desconto_valor: tipo ? val : null,
            valor_desconto: vDesc,
            valor_final: vf,
            valor_original: vo,
            total: vo,
            desconto_degustacao: opcionalMoedaPatch("desconto-degustacao"),
            desconto_cerimonialista: opcionalMoedaPatch("desconto-cerimonialista"),
            taxa_entrega: opcionalMoedaPatch("taxa-entrega"),
            degustacao_data: strInput("degustacao-data") || null,
            degustacao_hora: strInput("degustacao-hora") || null,
            degustacao_obs: strInput("degustacao-obs") || null,
            observacoes: observacoesOrcamentoAtual(),
            observacoes_internas: observacoesInternasAtual(),
            forma_pagamento: strInput("forma-pagamento-adm") || null,
            forma_pagamento_ref: strInput("forma-pagamento-adm") || null,
            data_pagamento_entrada_prevista: strInput("data-pag-entrada-prevista") || null,
            entrada: entrada,
            restante: restante,
            data_pagamento_entrada: orcamentoAtual && orcamentoAtual.data_pagamento_entrada != null ? orcamentoAtual.data_pagamento_entrada : null,
            data_pagamento_final: strInput("data-pag-final") || null,
            contrato_numero_exibicao: strInput("contrato-numero-exibicao") || null,
            cliente_rg: strInput("contrato-cliente-rg") || null,
            cliente_cpf: strInput("contrato-cliente-cpf") || null,
            cliente_data_nascimento: strInput("contrato-cliente-nasc") || null,
            cliente_endereco_linha: strInput("contrato-cliente-endereco") || null,
            cliente_cep: strInput("contrato-cliente-cep") || null,
            telefone_fixo: strInput("contrato-telefone-fixo") || null,
            contato_nome: strInput("contrato-contato-nome") || null,
            contato_celular: strInput("contrato-contato-celular") || null,
            evento_local_festa: strInput("contrato-local-festa") || null,
            evento_horario_entrega: strInput("contrato-horario-entrega") || null,
            evento_local_cerimonia: strInput("contrato-local-cerimonia") || null,
            evento_horario_festa: strInput("contrato-horario-festa") || null,
            evento_cerimonialista: strInput("contrato-cerimonialista") || null,
            evento_cerimonialista_tel: strInput("contrato-cerimonialista-tel") || null,
            evento_fotografo: strInput("contrato-fotografo") || null,
            evento_fotografo_tel: strInput("contrato-fotografo-tel") || null,
            pagamento_valor_quitado_em: strInput("contrato-quitado-em") || null,
            /* Obrigatório para PATCH: sem isto o servidor mantinha itens antigos ao incluir complementos manuais */
            itens: JSON.parse(JSON.stringify(orcamentoAtual.itens || []))
            },
            patchCamposClienteEventoPdfDom(),
            patchCamposEntregaDom()
        );
    }

    /**
     * Somente campos do anexo (inputs #contrato-*): lê do DOM e não sobrescreve itens nem totais.
     * Mesclado no objeto enviado a gerarContratoPDF porque a resposta do PATCH pode omitir/atrasar campos opcionais.
     */
    function patchCamposAnexoPdf() {
        return Object.assign(
            {
            contrato_numero_exibicao: strInput("contrato-numero-exibicao") || null,
            cliente_rg: strInput("contrato-cliente-rg") || null,
            cliente_cpf: strInput("contrato-cliente-cpf") || null,
            cliente_data_nascimento: strInput("contrato-cliente-nasc") || null,
            cliente_endereco_linha: strInput("contrato-cliente-endereco") || null,
            cliente_cep: strInput("contrato-cliente-cep") || null,
            telefone_fixo: strInput("contrato-telefone-fixo") || null,
            contato_nome: strInput("contrato-contato-nome") || null,
            contato_celular: strInput("contrato-contato-celular") || null,
            evento_local_festa: strInput("contrato-local-festa") || null,
            evento_horario_entrega: strInput("contrato-horario-entrega") || null,
            evento_horario_festa: strInput("contrato-horario-festa") || null,
            evento_local_cerimonia: strInput("contrato-local-cerimonia") || null,
            evento_cerimonialista: strInput("contrato-cerimonialista") || null,
            evento_cerimonialista_tel: strInput("contrato-cerimonialista-tel") || null,
            evento_fotografo: strInput("contrato-fotografo") || null,
            evento_fotografo_tel: strInput("contrato-fotografo-tel") || null,
            pagamento_valor_quitado_em: strInput("contrato-quitado-em") || null,
            observacoes: observacoesOrcamentoAtual(),
            observacoes_internas: observacoesInternasAtual()
            },
            patchCamposClienteEventoPdfDom(),
            patchCamposEntregaDom()
        );
    }

    function init() {
        if (!adminEstaAutenticado()) {
            window.location.href = "index.html";
            return;
        }
        var id = getQueryId();
        if (!id) {
            document.getElementById("admin-detalhe-erro").hidden = false;
            document.getElementById("admin-detalhe-erro").textContent = "Orçamento não informado.";
            document.getElementById("admin-detalhe-conteudo").hidden = true;
            return;
        }

        var o = getOrcamentoPorId(id);
        if (!o) {
            document.getElementById("admin-detalhe-erro").hidden = false;
            document.getElementById("admin-detalhe-erro").textContent = "Orçamento não encontrado.";
            document.getElementById("admin-detalhe-conteudo").hidden = true;
            return;
        }

        orcamentoAtual = o;
        document.getElementById("admin-detalhe-erro").hidden = true;
        document.getElementById("admin-detalhe-conteudo").hidden = false;
        renderOrcamento(o);

        document.getElementById("desconto-tipo").addEventListener("change", function () {
            atualizarPreviewFinal(orcamentoAtual);
        });
        document.getElementById("desconto-valor").addEventListener("input", function () {
            atualizarPreviewFinal(orcamentoAtual);
        });
        document.getElementById("desconto-degustacao").addEventListener("input", function () {
            atualizarPreviewFinal(orcamentoAtual);
        });
        document.getElementById("desconto-cerimonialista").addEventListener("input", function () {
            atualizarPreviewFinal(orcamentoAtual);
        });
        document.getElementById("taxa-entrega").addEventListener("input", function () {
            atualizarPreviewFinal(orcamentoAtual);
        });
        document.getElementById("entrada").addEventListener("input", function () {
            atualizarPreviewFinal(orcamentoAtual);
        });
        var selTipoEntInit = document.getElementById("edit-entrega-retirada");
        if (selTipoEntInit) {
            selTipoEntInit.addEventListener("change", atualizarUiEntregaAdmin);
        }
        var selSuporteInit = document.getElementById("edit-entrega-suporte");
        if (selSuporteInit) {
            selSuporteInit.addEventListener("change", atualizarUiEntregaAdmin);
        }

        document.getElementById("btn-salvar").addEventListener("click", function () {
            var tipo = document.getElementById("desconto-tipo").value || null;
            var valRaw = document.getElementById("desconto-valor").value;
            var val = parseFloat(String(valRaw).replace(",", ".")) || 0;
            if (tipo && val <= 0) {
                alert("Informe um valor de desconto válido ou deixe o tipo em branco.");
                return;
            }
            var status = document.getElementById("status-orcamento").value;
            var patch = Object.assign(patchComumExtra(), { status: status });

            var atualizado = atualizarOrcamentoParcial(orcamentoAtual.id, patch);
            if (atualizado) {
                orcamentoAtual = atualizado;
                alert("Orçamento atualizado.");
                renderOrcamento(orcamentoAtual);
            }
        });

        var btnAtualizarObs = document.getElementById("btn-atualizar-obs-internas");
        if (btnAtualizarObs) {
            btnAtualizarObs.addEventListener("click", function () {
                var texto = strInput("observacoes-internas");
                if (!texto) {
                    alert("Digite a observação antes de atualizar, ou use \"Remover observação\" para limpar.");
                    return;
                }
                salvarObservacaoInterna(texto, "Observação atualizada. Ao gerar o contrato, ela aparecerá na seção \"Observações da contratada\".");
            });
        }

        var btnRemoverObs = document.getElementById("btn-remover-obs-internas");
        if (btnRemoverObs) {
            btnRemoverObs.addEventListener("click", function () {
                var atual = strInput("observacoes-internas") || String(orcamentoAtual.observacoes_internas || "").trim();
                if (!atual) {
                    alert("Não há observação para remover.");
                    return;
                }
                if (!confirm("Remover a observação interna deste orçamento? Ela não aparecerá mais no contrato.")) {
                    return;
                }
                var el = document.getElementById("observacoes-internas");
                if (el) el.value = "";
                salvarObservacaoInterna(null, "Observação removida. Ao gerar o contrato, a seção não aparecerá.");
            });
        }

        document.getElementById("btn-whatsapp-orc").addEventListener("click", function () {
            var fresh = getOrcamentoPorId(orcamentoAtual.id);
            if (!fresh) return;
            var dadosWpp = Object.assign({}, fresh, patchComumExtra());
            var msg = montarWhatsAppDetalhe(dadosWpp);
            var tel = (CONFIG && CONFIG.telefoneWhatsApp) ? CONFIG.telefoneWhatsApp : "5519981178167";
            window.open("https://wa.me/" + tel + "?text=" + encodeURIComponent(msg), "_blank");
        });

        document.getElementById("btn-pdf-orcamento").addEventListener("click", function () {
            if (document.activeElement && typeof document.activeElement.blur === "function") {
                document.activeElement.blur();
            }
            var patch = patchComumExtra();
            var base = getOrcamentoPorId(orcamentoAtual.id);
            /* Mesma lógica do contrato: patch traz sempre itens atuais e totais corretos */
            var dadosProposta =
                Object.assign({}, base || orcamentoAtual, patch);
            dadosProposta.itens = patch.itens ? patch.itens : dadosProposta.itens || [];
            gerarOrcamentoPropostaPDF(dadosProposta);
        });

        document.getElementById("btn-contrato").addEventListener("click", function () {
            var oid = orcamentoAtual.id;
            var tipoC = document.getElementById("desconto-tipo").value || null;
            var valC = parseFloat(String(document.getElementById("desconto-valor").value).replace(",", ".")) || 0;
            if (tipoC && valC <= 0) {
                alert("Ajuste o desconto ou deixe sem desconto antes de gerar o contrato.");
                return;
            }
            var ddR = strCampoMoeda("desconto-degustacao");
            var dcR = strCampoMoeda("desconto-cerimonialista");
            var teR = strCampoMoeda("taxa-entrega");

            /*
             * Snapshot imutável dos itens antes de gravar/contrato: o PDF deve refletir exatamente
             * as linhas visíveis neste momento; totais ficam sempre alinhados a essa lista.
             */
            var itensContrato = JSON.parse(JSON.stringify(orcamentoAtual.itens || []));
            var voSnap = somaSubtotalItens(itensContrato);
            var vfSnap = calcularValorFinalOrcamento(voSnap, tipoC, valC, ddR, dcR, teR);
            var vDescSnap = tipoC ? descontoEquivalenteEmReais(voSnap, tipoC, valC) : 0;

            var stContrato = CONFIG.STATUS_ORCAMENTO && CONFIG.STATUS_ORCAMENTO.CONTRATO_GERADO;

            var extra = patchComumExtra();
            extra.observacoes = observacoesOrcamentoAtual();
            extra.observacoes_internas = observacoesInternasAtual();
            extra.itens = itensContrato;
            extra.valor_original = voSnap;
            extra.total = voSnap;
            extra.valor_final = vfSnap;
            extra.valor_desconto = vDescSnap;

            var patchContrato = Object.assign(extra, {
                desconto_tipo: tipoC || null,
                desconto_valor: tipoC ? valC : null,
                valor_final: vfSnap,
                valor_desconto: vDescSnap,
                valor_original: voSnap,
                total: voSnap,
                itens: itensContrato,
                contrato: {
                    valor_final: vfSnap,
                    data_contrato: new Date().toISOString(),
                    status: "emitido"
                },
                contrato_pdf: {
                    tipo: "contrato",
                    gerado_em: new Date().toISOString()
                },
                status: stContrato || "contrato_gerado"
            });

            var salvo = atualizarOrcamentoParcial(oid, patchContrato);
            /* Alguns navegadores só atualizam o .value ao perder foco (tel/e-mail): consolida antes do PDF */
            if (document.activeElement && typeof document.activeElement.blur === "function") {
                document.activeElement.blur();
            }
            var dadosPdf = salvo &&
                Array.isArray(salvo.itens) &&
                salvo.itens.length === itensContrato.length
                ? salvo
                : Object.assign({}, orcamentoAtual, patchContrato);
            /* Tudo que está nos campos #contrato-* / #contrato-pdf-* do anexo sobrepõe o objeto do servidor antes do PDF */
            var anexoDoForm = patchCamposAnexoPdf();
            dadosPdf = Object.assign({}, dadosPdf, anexoDoForm);
            dadosPdf.observacoes = observacoesOrcamentoAtual() || dadosPdf.observacoes || null;
            dadosPdf.observacoes_internas = observacoesInternasAtual() || dadosPdf.observacoes_internas || null;
            /* Se não bater com o servidor, o PDF mesmo assim sai certo pelo merge local */

            gerarContratoPDF(dadosPdf);
            /* Evita regressão: não substituir memória só por uma leitura que possa estar desatualizada */
            if (salvo &&
                salvo.itens &&
                salvo.itens.length === itensContrato.length) {
                /* PATCH pode devolver objeto sem campos opcionais do anexo; manter o que foi lido do formulário (#contrato-*) */
                orcamentoAtual = Object.assign({}, salvo, anexoDoForm);
            } else {
                if (salvo && salvo.itens && salvo.itens.length !== itensContrato.length) {
                    console.warn(
                        "[admin] Lista de itens devolvida após PATCH diverge do ecrã. A manter dados mesclados com o último PATCH."
                    );
                }
                orcamentoAtual = dadosPdf;
                atualizarOrcamentoParcial(oid, patchContrato);
            }
            renderOrcamento(orcamentoAtual);
            alert("Contrato PDF gerado.");
        });

        document.getElementById("btn-salvar-anexo-contrato").addEventListener("click", function () {
            var tipo = document.getElementById("desconto-tipo").value || null;
            var valRaw = document.getElementById("desconto-valor").value;
            var val = parseFloat(String(valRaw).replace(",", ".")) || 0;
            if (tipo && val <= 0) {
                alert("Informe um valor de desconto válido ou deixe o tipo em branco.");
                return;
            }
            var status = document.getElementById("status-orcamento").value;
            var patch = Object.assign(patchComumExtra(), { status: status });
            var atualizado = atualizarOrcamentoParcial(orcamentoAtual.id, patch);
            if (atualizado) {
                orcamentoAtual = atualizado;
                alert("Dados do anexo e do orçamento guardados.");
                renderOrcamento(orcamentoAtual);
            } else {
                alert("Não foi possível guardar. Verifique a ligação ou use «Salvar alterações» no fim da página.");
            }
        });

        document.getElementById("lista-itens").addEventListener("click", function (ev) {
            var btn = ev.target.closest("button[data-acao-extra][data-item-index]");
            if (!btn || !orcamentoAtual) return;
            var acao = btn.getAttribute("data-acao-extra");
            var idx = parseInt(btn.getAttribute("data-item-index"), 10);
            if (!Number.isFinite(idx)) return;
            var itensArr = orcamentoAtual.itens || [];
            var itemRef = itensArr[idx];
            if (!itemRef) return;

            if (acao === "editar") {
                extraItemEdicaoIndex = idx;
                preencherFormExtraDeItem(itemRef);
                atualizarUiModoExtra();
                var wrap = document.getElementById("admin-extra-itens-wrap");
                if (wrap && wrap.scrollIntoView) wrap.scrollIntoView({ behavior: "smooth", block: "nearest" });
                return;
            }
            if (acao === "remover") {
                var msgRem =
                    itemRef.extra_pedido_admin === true
                        ? "Remover este complemento manual deste orçamento?"
                        : "Remover este item do cardápio deste orçamento?";
                if (!confirm(msgRem)) return;
                if (!validarCamposTipoDesconto()) return;
                var listaNova = itensArr.slice();
                listaNova.splice(idx, 1);
                if (extraItemEdicaoIndex === idx) {
                    sairModoEdicaoExtra();
                } else if (extraItemEdicaoIndex != null && extraItemEdicaoIndex > idx) {
                    extraItemEdicaoIndex -= 1;
                }
                persistirItensOrcamento(listaNova);
            }
        });

        document.getElementById("btn-extra-cancelar-edicao").addEventListener("click", function () {
            sairModoEdicaoExtra();
        });

        document.getElementById("btn-extra-adicionar-item").addEventListener("click", function () {
            var nome = (document.getElementById("extra-doce-nome").value || "").trim();
            var q = parseInt(document.getElementById("extra-doce-qtd").value, 10);
            var precoUnit = parsePrecoExtra(document.getElementById("extra-doce-preco").value);
            if (!nome) {
                alert("Informe o nome do doce.");
                return;
            }
            if (!Number.isFinite(q) || q < 1) {
                alert("Quantidade deve ser pelo menos 1 unidade.");
                return;
            }
            if (precoUnit == null || precoUnit <= 0) {
                alert("Informe um preço unitário válido (ex.: 2,50).");
                return;
            }
            if (!validarCamposTipoDesconto()) return;

            var lista = (orcamentoAtual.itens || []).slice();
            var edicao = extraItemEdicaoIndex;
            if (edicao != null) {
                var itemAnterior = lista[edicao];
                if (!itemAnterior) {
                    alert("O item em edição não está mais disponível.");
                    sairModoEdicaoExtra();
                    return;
                }
                if (itemAnterior.extra_pedido_admin !== true) {
                    var minCard = qtdMinItemOrcamento(itemAnterior);
                    if (q < minCard) {
                        var rotuloMinCard = typeof rotuloUnidadeVenda === "function"
                            ? rotuloUnidadeVenda(itemAnterior.unidade, minCard)
                            : "unidade(s)";
                        alert("Quantidade mínima para este item: " + minCard + " " + rotuloMinCard + ".");
                        return;
                    }
                }
                lista[edicao] = montarItemOrcamentoEditado(itemAnterior, nome, q, precoUnit);
            } else {
                var subtotalNovo = Math.round(q * precoUnit * 100) / 100;
                lista.push({
                    nome: nome,
                    quantidade: q,
                    preco: precoUnit,
                    preco_unitario: precoUnit,
                    subtotal: subtotalNovo,
                    qtd_min: 1,
                    extra_pedido_admin: true
                });
            }
            if (!persistirItensOrcamento(lista)) return;
            sairModoEdicaoExtra();
        });

        document.getElementById("btn-voltar").addEventListener("click", function () {
            window.location.href = "index.html";
        });
    }

    document.addEventListener("DOMContentLoaded", init);
})();
