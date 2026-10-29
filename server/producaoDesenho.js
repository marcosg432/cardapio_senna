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

    function gerarFichaProducaoPDF(evento, opcoes) {
        var doc = documento(opcoes);
        doc.setProperties({
            title: 'Ficha de Produção ' + evento.id,
            author: 'Candy Li Doces Finos',
            subject: 'Produção do evento'
        });
        var desenhado = desenhar(doc, opcoes, 'Ficha de Produção', 'Contrato ' + evento.id, function (ctx) {
            ctx.texto(evento.data_texto || 'Data a conferir', ctx.margem, ctx.posicao(), 16, 'bold', ctx.cores.navy);
            ctx.avancar(8);
            linhaEvento(ctx, 'Evento', evento.tipo_evento || 'A conferir');
            linhaEvento(ctx, 'Convidados', evento.convidados == null ? null : String(evento.convidados));
            linhaEvento(ctx, 'Entrega', evento.horario_entrega);
            linhaEvento(ctx, 'Festa', evento.horario_festa);
            linhaEvento(ctx, 'Modalidade', evento.modalidade);
            ctx.avancar(3);
            if (evento.avisos && evento.avisos.length) {
                ctx.garantir(8);
                ctx.texto('Conferência', ctx.margem, ctx.posicao(), 11, 'bold', ctx.cores.navy);
                ctx.avancar(5);
                evento.avisos.forEach(function (aviso) {
                    ctx.garantir(5);
                    ctx.texto(aviso, ctx.margem, ctx.posicao(), 9, 'normal', ctx.cores.mudo, 'left', ctx.largura);
                    ctx.avancar(5);
                });
                ctx.avancar(2);
            }
            ctx.garantir(8);
            ctx.texto('Produtos contratados', ctx.margem, ctx.posicao(), 12, 'bold', ctx.cores.navy);
            ctx.avancar(4);
            var colunas = [
                { titulo: 'Produto', chave: 'nome', x: ctx.margem + 2, largura: 68 },
                { titulo: 'Quantidade', chave: 'quantidade_texto', x: ctx.margem + 74, largura: 36, estilo: 'bold', cor: ctx.cores.navy },
                { titulo: 'Unidade', chave: 'unidade', x: ctx.margem + 114, largura: 40 },
                { titulo: 'Compl.', chave: 'complementar', x: ctx.margem + 158, largura: 18 }
            ];
            var linhas = (evento.itens || []).map(function (item) {
                return {
                    nome: item.nome,
                    quantidade_texto: item.quantidade_texto,
                    unidade: item.unidade,
                    complementar: item.complementar ? 'Sim' : '—'
                };
            });
            if (!linhas.length) {
                ctx.texto('Nenhum produto contratado.', ctx.margem, ctx.posicao() + 4, 10, 'normal', ctx.cores.mudo);
                ctx.avancar(10);
            } else {
                ctx.tabela(colunas, linhas);
            }
            instrucoes(ctx, evento.operacional);
            ctx.garantir(24);
            ctx.texto('Conferência da cozinha', ctx.margem, ctx.posicao(), 11, 'bold', ctx.cores.navy);
            ctx.avancar(7);
            doc.setDrawColor(ctx.cores.linha[0], ctx.cores.linha[1], ctx.cores.linha[2]);
            ctx.texto('Produzido', ctx.margem, ctx.posicao(), 8, 'bold', ctx.cores.mudo);
            doc.line(ctx.margem + 22, ctx.posicao(), ctx.margem + 78, ctx.posicao());
            ctx.texto('Conferido por', ctx.margem + 88, ctx.posicao(), 8, 'bold', ctx.cores.mudo);
            doc.line(ctx.margem + 114, ctx.posicao(), ctx.margem + ctx.largura, ctx.posicao());
            ctx.avancar(8);
        });
        return {
            arquivo: 'ficha-producao-' + evento.id + '.pdf',
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
        var desenhado = desenhar(doc, opcoes, 'Produção do dia', dia.data_texto || dia.data, function (ctx) {
            ctx.texto(dia.data_texto || 'Data a conferir', ctx.margem, ctx.posicao(), 16, 'bold', ctx.cores.navy);
            ctx.avancar(8);
            ctx.texto('Total da cozinha', ctx.margem, ctx.posicao(), 12, 'bold', ctx.cores.navy);
            ctx.avancar(4);
            if (!dia.totais || !dia.totais.length) {
                ctx.texto('Nenhum evento confirmado nesta data.', ctx.margem, ctx.posicao() + 2, 10, 'normal', ctx.cores.mudo);
                ctx.avancar(10);
            } else {
                ctx.tabela([
                    { titulo: 'Produto', chave: 'nome', x: ctx.margem + 2, largura: 96 },
                    { titulo: 'Quantidade', chave: 'quantidade_texto', x: ctx.margem + 102, largura: 28, estilo: 'bold', tamanho: 11, cor: ctx.cores.navy },
                    { titulo: 'Unidade', chave: 'unidade', x: ctx.margem + 134, largura: 42 }
                ], dia.totais);
            }
            ctx.garantir(8);
            ctx.texto('Eventos do dia', ctx.margem, ctx.posicao(), 12, 'bold', ctx.cores.navy);
            ctx.avancar(6);
            if (!dia.eventos || !dia.eventos.length) return;
            dia.eventos.forEach(function (evento) {
                ctx.garantir(16);
                ctx.texto('Contrato ' + evento.id, ctx.margem, ctx.posicao(), 11, 'bold', ctx.cores.navy);
                ctx.texto(evento.tipo_evento || 'Evento a conferir', ctx.margem + 48, ctx.posicao(), 10, 'normal', ctx.cores.tinta);
                ctx.avancar(5);
                var notas = [];
                if (evento.convidados != null) notas.push(evento.convidados + ' convidados');
                if (evento.horario_entrega) notas.push('Entrega ' + evento.horario_entrega);
                if (evento.horario_festa) notas.push('Festa ' + evento.horario_festa);
                if (evento.modalidade) notas.push(evento.modalidade);
                if (notas.length) {
                    ctx.texto(notas.join(' · '), ctx.margem, ctx.posicao(), 8, 'normal', ctx.cores.mudo, 'left', ctx.largura);
                    ctx.avancar(5);
                }
                var linhas = (evento.itens || []).map(function (item) {
                    return {
                        nome: item.nome,
                        quantidade_texto: item.quantidade_texto,
                        unidade: item.unidade
                    };
                });
                if (linhas.length) {
                    ctx.tabela([
                        { titulo: 'Produto', chave: 'nome', x: ctx.margem + 2, largura: 78 },
                        { titulo: 'Quantidade', chave: 'quantidade_texto', x: ctx.margem + 84, largura: 42, estilo: 'bold', cor: ctx.cores.navy },
                        { titulo: 'Unidade', chave: 'unidade', x: ctx.margem + 130, largura: 46 }
                    ], linhas);
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
