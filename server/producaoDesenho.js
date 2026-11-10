/**
 * PDFs de produção da cozinha.
 * Este arquivo não é servido ao navegador e não grava o documento em disco.
 */
(function (raiz) {
    var NAVY = [18, 31, 42];
    var ROSA = [196, 165, 173];
    var CREME = [250, 248, 246];
    var TINTA = [28, 36, 48];
    var MUDO = [92, 107, 120];
    var LINHA = [230, 224, 216];
    var AREIA = [246, 241, 234];
    var ZEBRA = [252, 251, 249];
    var PE = [125, 136, 146];

    function documento(opcoes) {
        if (!raiz.jspdf || !raiz.jspdf.jsPDF) {
            var erro = new Error('biblioteca');
            erro.code = 'biblioteca';
            throw erro;
        }
        return new raiz.jspdf.jsPDF({
            unit: 'mm',
            format: 'a4',
            compress: !(opcoes && opcoes.auditoria)
        });
    }

    function desenhar(doc, opcoes, titulo, identificador, miolo) {
        var margem = 16;
        var largura = 178;
        var y = 48;
        var limite = 268;
        var paginaTabela = false;
        var cabecalhoAtual = null;

        function texto(conteudo, x, yy, tamanho, estilo, cor, alinhamento, max) {
            doc.setFont('helvetica', estilo || 'normal');
            doc.setFontSize(tamanho || 10);
            doc.setTextColor(cor[0], cor[1], cor[2]);
            var opcoesTexto = { align: alinhamento || 'left' };
            if (max) opcoesTexto.maxWidth = max;
            doc.text(String(conteudo), x, yy, opcoesTexto);
        }

        function faixaInicial() {
            doc.setFillColor(NAVY[0], NAVY[1], NAVY[2]);
            doc.rect(0, 0, 210, 36, 'F');
            doc.setFillColor(ROSA[0], ROSA[1], ROSA[2]);
            doc.rect(0, 36, 210, 1.4, 'F');
            texto('Candy Li Doces Finos', margem, 15, 16, 'bold', CREME);
            texto(titulo, margem, 24, 11, 'normal', ROSA);
            texto(identificador, 194, 16, 9, 'bold', CREME, 'right');
        }

        function faixaContinuacao() {
            doc.setFillColor(NAVY[0], NAVY[1], NAVY[2]);
            doc.rect(0, 0, 210, 16, 'F');
            texto('Candy Li Doces Finos', margem, 10.5, 10, 'bold', CREME);
            texto(titulo + ' · ' + identificador, 194, 10.5, 9, 'normal', ROSA, 'right');
            y = 24;
        }

        function novaPagina() {
            doc.addPage();
            faixaContinuacao();
            if (paginaTabela && cabecalhoAtual) cabecalhoAtual();
        }

        function garantir(altura) {
            if (y + altura <= limite) return;
            novaPagina();
        }

        function quebrar(valor, larguraColuna, tamanho, estilo) {
            doc.setFont('helvetica', estilo || 'normal');
            doc.setFontSize(tamanho || 9);
            return doc.splitTextToSize(String(valor || ''), larguraColuna);
        }
        function tabela(colunas, linhas) {
            function cabecalho() {
                doc.setFillColor(AREIA[0], AREIA[1], AREIA[2]);
                doc.rect(margem, y, largura, 8, 'F');
                colunas.forEach(function (coluna) {
                    texto(coluna.titulo, coluna.x, y + 5.3, 8, 'bold', MUDO, coluna.align || 'left');
                });
                y += 8;
            }
            if (y + 16 > limite) {
                doc.addPage();
                faixaContinuacao();
            }
            cabecalhoAtual = cabecalho;
            paginaTabela = true;
            cabecalho();
            linhas.forEach(function (linha, indice) {
                var partes = colunas.map(function (coluna) {
                    return quebrar(linha[coluna.chave], coluna.largura, coluna.tamanho || 9, coluna.estilo || 'normal');
                });
                var maior = partes.reduce(function (maximo, parte) { return Math.max(maximo, parte.length); }, 1);
                var altura = Math.max(8, maior * 4.2 + 3.2);
                garantir(altura);
                if (indice % 2 === 0) {
                    doc.setFillColor(ZEBRA[0], ZEBRA[1], ZEBRA[2]);
                    doc.rect(margem, y, largura, altura, 'F');
                }
                colunas.forEach(function (coluna, indiceColuna) {
                    doc.setFont('helvetica', coluna.estilo || 'normal');
                    doc.setFontSize(coluna.tamanho || 9);
                    doc.setTextColor((coluna.cor || TINTA)[0], (coluna.cor || TINTA)[1], (coluna.cor || TINTA)[2]);
                    doc.text(partes[indiceColuna], coluna.x, y + 5.2);
                });
                y += altura;
            });
            paginaTabela = false;
            cabecalhoAtual = null;
            y += 4;
        }

        faixaInicial();
        miolo({
            texto: texto,
            garantir: garantir,
            tabela: tabela,
            margem: margem,
            largura: largura,
            cores: { navy: NAVY, rosa: ROSA, creme: CREME, tinta: TINTA, mudo: MUDO, linha: LINHA },
            posicao: function () { return y; },
            avancar: function (n) { y += n; }
        });

        var total = doc.getNumberOfPages();
        var i;
        var rodape = opcoes && opcoes.congelado
            ? 'Os produtos correspondem à lista congelada nesta versão.'
            : 'Os produtos correspondem à lista atual do contrato confirmado.';
        for (i = 1; i <= total; i++) {
            doc.setPage(i);
            doc.setDrawColor(LINHA[0], LINHA[1], LINHA[2]);
            doc.line(margem, 282, margem + largura, 282);
            texto(rodape, margem, 287, 8, 'normal', PE, 'left', 140);
            texto('Página ' + i + ' de ' + total, 194, 287, 8, 'normal', PE, 'right');
            if (opcoes && opcoes.rascunho) {
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(42);
                doc.setTextColor(176, 122, 132);
                doc.text('RASCUNHO', 105, 168, { align: 'center', angle: 32 });
            }
        }
        return {
            paginas: total,
            pdf: opcoes && (opcoes.auditoria || opcoes.bytes) ? doc.output('arraybuffer') : null
        };
    }

    function instrucoes(ctx, operacional) {
        if (!operacional) return;
        var pares = [
            ['Responsável', operacional.responsavel],
            ['Preparo', operacional.preparo],
            ['Observações', operacional.observacoes],
            ['Montagem', operacional.montagem],
            ['Embalagem', operacional.embalagem],
            ['Orientações', operacional.orientacoes]
        ].filter(function (par) { return par[1]; });
        var etapas = Array.isArray(operacional.etapas) ? operacional.etapas.filter(function (etapa) {
            return etapa && (etapa.titulo || etapa.detalhe);
        }) : [];
        if (!pares.length && !etapas.length) return;
        ctx.garantir(10);
        ctx.texto('Instruções operacionais', ctx.margem, ctx.posicao(), 12, 'bold', ctx.cores.navy);
        ctx.avancar(6);
        pares.forEach(function (par) {
            ctx.garantir(6);
            ctx.texto(par[0], ctx.margem, ctx.posicao(), 8, 'bold', ctx.cores.mudo);
            ctx.avancar(4);
            ctx.texto(String(par[1]), ctx.margem, ctx.posicao(), 10, 'normal', ctx.cores.tinta, 'left', ctx.largura);
            ctx.avancar(6);
        });
        etapas.forEach(function (etapa) {
            ctx.garantir(6);
            var linhaEtapa = (etapa.titulo || 'Etapa') + (etapa.detalhe ? ' — ' + etapa.detalhe : '');
            ctx.texto(linhaEtapa, ctx.margem, ctx.posicao(), 9, 'normal', ctx.cores.tinta, 'left', ctx.largura);
            ctx.avancar(5);
        });
    }

    function linhaEvento(ctx, rotulo, valor) {
        if (!valor) return;
        ctx.garantir(6);
        ctx.texto(rotulo, ctx.margem, ctx.posicao(), 8, 'bold', ctx.cores.mudo);
        ctx.texto(String(valor), ctx.margem + 42, ctx.posicao(), 10, 'normal', ctx.cores.tinta);
        ctx.avancar(6);
    }

    function unidadeExibicao(item) {
        if (!item || item.unidade_informada === false) return '';
        var texto = String(item.unidade || '').trim();
        if (!texto || texto === 'Unidade não informada' || texto === '—') return '';
        return texto;
    }

    function escreverLivre(ctx, doc, valor) {
        String(valor).split('\n').forEach(function (linha) {
            var partes = doc.splitTextToSize(linha || ' ', ctx.largura);
            partes.forEach(function (parte) {
                ctx.garantir(5);
                ctx.texto(parte, ctx.margem, ctx.posicao(), 10, 'normal', ctx.cores.tinta);
                ctx.avancar(4.6);
            });
        });
    }

    function gerarFichaProducaoPDF(evento, opcoes) {
        var doc = documento(opcoes);
        doc.setProperties({
            title: 'Ordem de Serviço — Produção ' + evento.id,
            author: 'Candy Li Doces Finos',
            subject: 'Ordem de serviço da produção'
        });
        var desenhado = desenhar(doc, opcoes, 'Ordem de Serviço — Produção', 'Contrato ' + evento.id, function (ctx) {
            if (evento.nome_cliente) {
                ctx.texto(evento.nome_cliente, ctx.margem, ctx.posicao(), 16, 'bold', ctx.cores.navy);
                ctx.avancar(7);
            }
            if (evento.data_texto) {
                ctx.texto(evento.data_texto, ctx.margem, ctx.posicao(), 12, 'normal', ctx.cores.tinta);
                ctx.avancar(8);
            }
            ctx.texto('Identificação', ctx.margem, ctx.posicao(), 12, 'bold', ctx.cores.navy);
            ctx.avancar(6);
            linhaEvento(ctx, 'Local', evento.local_festa);
            linhaEvento(ctx, 'Evento', evento.tipo_evento);
            linhaEvento(ctx, 'Convidados', evento.convidados == null ? null : String(evento.convidados));
            linhaEvento(ctx, 'Modalidade', evento.modalidade);
            if (evento.horario_entrega || evento.horario_festa) {
                ctx.avancar(2);
                ctx.texto('Horários', ctx.margem, ctx.posicao(), 12, 'bold', ctx.cores.navy);
                ctx.avancar(6);
                linhaEvento(ctx, 'Entrega', evento.horario_entrega);
                linhaEvento(ctx, 'Festa', evento.horario_festa);
            }
            var conferencia = !!(evento.cerimonialista || evento.suportes || (evento.avisos && evento.avisos.length));
            if (conferencia) {
                ctx.avancar(2);
                ctx.texto('Conferência', ctx.margem, ctx.posicao(), 12, 'bold', ctx.cores.navy);
                ctx.avancar(6);
                linhaEvento(ctx, 'Cerimonialista', evento.cerimonialista);
                if (evento.suportes) {
                    ctx.garantir(6);
                    ctx.texto('Suportes', ctx.margem, ctx.posicao(), 8, 'bold', ctx.cores.mudo);
                    ctx.avancar(4);
                    escreverLivre(ctx, doc, evento.suportes);
                    ctx.avancar(2);
                }
                (evento.avisos || []).forEach(function (aviso) {
                    ctx.garantir(5);
                    ctx.texto(aviso, ctx.margem, ctx.posicao(), 9, 'normal', ctx.cores.mudo, 'left', ctx.largura);
                    ctx.avancar(5);
                });
            }
            ctx.avancar(2);
            ctx.garantir(8);
            ctx.texto('Produtos contratados', ctx.margem, ctx.posicao(), 12, 'bold', ctx.cores.navy);
            ctx.avancar(4);
            var itens = evento.itens || [];
            var comUnidade = itens.some(function (item) { return unidadeExibicao(item); });
            var colunas = comUnidade ? [
                { titulo: 'Produto', chave: 'nome', x: ctx.margem + 2, largura: 78 },
                { titulo: 'Quantidade', chave: 'quantidade_texto', x: ctx.margem + 84, largura: 34, estilo: 'bold', cor: ctx.cores.navy },
                { titulo: 'Unidade', chave: 'unidade', x: ctx.margem + 122, largura: 34 },
                { titulo: 'Compl.', chave: 'complementar', x: ctx.margem + 158, largura: 18 }
            ] : [
                { titulo: 'Produto', chave: 'nome', x: ctx.margem + 2, largura: 112 },
                { titulo: 'Quantidade', chave: 'quantidade_texto', x: ctx.margem + 118, largura: 38, estilo: 'bold', cor: ctx.cores.navy },
                { titulo: 'Compl.', chave: 'complementar', x: ctx.margem + 158, largura: 18 }
            ];
            var linhas = itens.map(function (item) {
                var linha = {
                    nome: item.nome,
                    quantidade_texto: item.quantidade_texto,
                    complementar: item.complementar ? 'Sim' : '—'
                };
                if (comUnidade) linha.unidade = unidadeExibicao(item);
                return linha;
            });
            if (!linhas.length) {
                ctx.texto('Nenhum produto contratado.', ctx.margem, ctx.posicao() + 4, 10, 'normal', ctx.cores.mudo);
                ctx.avancar(10);
            } else {
                ctx.tabela(colunas, linhas);
            }
            if (evento.doces_texto) {
                ctx.avancar(3);
                ctx.garantir(8);
                ctx.texto(evento.doces_texto, ctx.margem, ctx.posicao(), 11, 'bold', ctx.cores.navy);
                ctx.avancar(6);
                if (evento.doces_aviso) {
                    ctx.texto(evento.doces_aviso, ctx.margem, ctx.posicao(), 8, 'normal', ctx.cores.mudo, 'left', ctx.largura);
                    ctx.avancar(6);
                }
            }
            if (evento.observacoes_os) {
                ctx.avancar(4);
                ctx.garantir(16);
                doc.setDrawColor(ctx.cores.linha[0], ctx.cores.linha[1], ctx.cores.linha[2]);
                doc.line(ctx.margem, ctx.posicao(), ctx.margem + ctx.largura, ctx.posicao());
                ctx.avancar(7);
                ctx.texto('Observações para Ordem de Serviço', ctx.margem, ctx.posicao(), 12, 'bold', ctx.cores.navy);
                ctx.avancar(6);
                escreverLivre(ctx, doc, evento.observacoes_os);
                ctx.avancar(6);
            }
            instrucoes(ctx, evento.operacional);
            ctx.garantir(24);
            ctx.texto('Controle da equipe', ctx.margem, ctx.posicao(), 11, 'bold', ctx.cores.navy);
            ctx.avancar(7);
            doc.setDrawColor(ctx.cores.linha[0], ctx.cores.linha[1], ctx.cores.linha[2]);
            ctx.texto('Produzido por', ctx.margem, ctx.posicao(), 8, 'bold', ctx.cores.mudo);
            doc.line(ctx.margem + 32, ctx.posicao(), ctx.margem + 84, ctx.posicao());
            ctx.texto('Conferido por', ctx.margem + 90, ctx.posicao(), 8, 'bold', ctx.cores.mudo);
            doc.line(ctx.margem + 118, ctx.posicao(), ctx.margem + ctx.largura, ctx.posicao());
            ctx.avancar(8);
        });
        return {
            arquivo: 'ordem-servico-' + evento.id + '.pdf',
            paginas: desenhado.paginas,
            pdf: desenhado.pdf
        };
    }

    function gerarProducaoDiaPDF(dia, opcoes) {
        var doc = documento(opcoes);
        doc.setProperties({
            title: 'Produção do dia ' + (dia.data_texto || dia.data),
            author: 'Candy Li Doces Finos',
            subject: 'Produção consolidada do dia'
        });
        var tituloDia = dia.rotulo || 'Produção do dia';
        var desenhado = desenhar(doc, opcoes, tituloDia, dia.data_texto || dia.data, function (ctx) {
            ctx.texto(dia.data_texto || 'Data a conferir', ctx.margem, ctx.posicao(), 16, 'bold', ctx.cores.navy);
            ctx.avancar(8);
            if (dia.visao === 'planejamento') {
                ctx.texto('Inclui pedidos ainda não confirmados, só para planejamento.', ctx.margem, ctx.posicao(), 9, 'bold', ctx.cores.mudo, 'left', ctx.largura);
                ctx.avancar(6);
            }
            ctx.texto('Total da cozinha', ctx.margem, ctx.posicao(), 12, 'bold', ctx.cores.navy);
            ctx.avancar(4);
            if (!dia.totais || !dia.totais.length) {
                ctx.texto('Nenhum evento confirmado nesta data.', ctx.margem, ctx.posicao() + 2, 10, 'normal', ctx.cores.mudo);
                ctx.avancar(10);
            } else {
                var totaisComUnidade = (dia.totais || []).some(function (item) { return unidadeExibicao(item); });
                ctx.tabela(totaisComUnidade ? [
                    { titulo: 'Produto', chave: 'nome', x: ctx.margem + 2, largura: 96 },
                    { titulo: 'Quantidade', chave: 'quantidade_texto', x: ctx.margem + 102, largura: 28, estilo: 'bold', tamanho: 11, cor: ctx.cores.navy },
                    { titulo: 'Unidade', chave: 'unidade', x: ctx.margem + 134, largura: 42 }
                ] : [
                    { titulo: 'Produto', chave: 'nome', x: ctx.margem + 2, largura: 124 },
                    { titulo: 'Quantidade', chave: 'quantidade_texto', x: ctx.margem + 130, largura: 46, estilo: 'bold', tamanho: 11, cor: ctx.cores.navy }
                ], (dia.totais || []).map(function (item) {
                    var linha = { nome: item.nome, quantidade_texto: item.quantidade_texto };
                    if (totaisComUnidade) linha.unidade = unidadeExibicao(item);
                    return linha;
                }));
            }
            if (typeof dia.doces_total === 'number') {
                ctx.garantir(8);
                ctx.texto('Quantidade total de doces: ' + dia.doces_total + (dia.doces_parcial ? ' (parcial)' : ''), ctx.margem, ctx.posicao(), 11, 'bold', ctx.cores.navy);
                ctx.avancar(6);
            }
            ctx.garantir(8);
            ctx.texto(dia.rotulo ? 'Eventos do período' : 'Eventos do dia', ctx.margem, ctx.posicao(), 12, 'bold', ctx.cores.navy);
            ctx.avancar(6);
            if (!dia.eventos || !dia.eventos.length) return;
            dia.eventos.forEach(function (evento) {
                ctx.garantir(16);
                var tituloEvento = evento.nome_cliente || ('Contrato ' + evento.id);
                ctx.texto(tituloEvento, ctx.margem, ctx.posicao(), 11, 'bold', ctx.cores.navy, 'left', ctx.largura);
                ctx.avancar(5);
                if (evento.nome_cliente) {
                    var complemento = 'Contrato ' + (evento.numero_contrato || evento.id);
                    if (evento.planejamento) complemento += ' · planejamento, ainda não confirmado';
                    ctx.texto(complemento, ctx.margem, ctx.posicao(), 9, 'normal', ctx.cores.mudo);
                    ctx.avancar(5);
                } else if (evento.planejamento) {
                    ctx.texto('Planejamento, ainda não confirmado', ctx.margem, ctx.posicao(), 9, 'bold', ctx.cores.mudo);
                    ctx.avancar(5);
                }
                if (typeof evento.doces_total === 'number') {
                    ctx.texto('Quantidade total de doces: ' + evento.doces_total + (evento.doces_parcial || evento.doces_pendencias ? ' (parcial)' : ''), ctx.margem, ctx.posicao(), 9, 'bold', ctx.cores.navy);
                    ctx.avancar(5);
                }
                ctx.texto(evento.tipo_evento || 'Evento a conferir', ctx.margem, ctx.posicao(), 10, 'normal', ctx.cores.tinta);
                ctx.avancar(5);
                var notas = [];
                if (evento.local_festa) notas.push(evento.local_festa);
                if (evento.convidados != null) notas.push(evento.convidados + ' convidados');
                if (evento.horario_entrega) notas.push('Entrega ' + evento.horario_entrega);
                if (evento.horario_festa) notas.push('Festa ' + evento.horario_festa);
                if (evento.modalidade) notas.push(evento.modalidade);
                if (notas.length) {
                    ctx.texto(notas.join(' · '), ctx.margem, ctx.posicao(), 8, 'normal', ctx.cores.mudo, 'left', ctx.largura);
                    ctx.avancar(5);
                }
                var itensDia = evento.itens || [];
                var comUnidadeDia = itensDia.some(function (item) { return unidadeExibicao(item); });
                var linhas = itensDia.map(function (item) {
                    var linha = {
                        nome: item.nome,
                        quantidade_texto: item.quantidade_texto
                    };
                    if (comUnidadeDia) linha.unidade = unidadeExibicao(item);
                    return linha;
                });
                if (linhas.length) {
                    ctx.tabela(comUnidadeDia ? [
                        { titulo: 'Produto', chave: 'nome', x: ctx.margem + 2, largura: 78 },
                        { titulo: 'Quantidade', chave: 'quantidade_texto', x: ctx.margem + 84, largura: 42, estilo: 'bold', cor: ctx.cores.navy },
                        { titulo: 'Unidade', chave: 'unidade', x: ctx.margem + 130, largura: 46 }
                    ] : [
                        { titulo: 'Produto', chave: 'nome', x: ctx.margem + 2, largura: 120 },
                        { titulo: 'Quantidade', chave: 'quantidade_texto', x: ctx.margem + 126, largura: 48, estilo: 'bold', cor: ctx.cores.navy }
                    ], linhas);
                }
                if (evento.observacoes_os) {
                    ctx.garantir(8);
                    escreverLivre(ctx, doc, evento.observacoes_os);
                    ctx.avancar(2);
                }
            });
            instrucoes(ctx, dia.operacional);
        });
        return {
            arquivo: 'producao-dia-' + dia.data + '.pdf',
            paginas: desenhado.paginas,
            pdf: desenhado.pdf
        };
    }

    raiz.gerarFichaProducaoPDF = gerarFichaProducaoPDF;
    raiz.gerarProducaoDiaPDF = gerarProducaoDiaPDF;
})(typeof globalThis !== 'undefined' ? globalThis : this);
