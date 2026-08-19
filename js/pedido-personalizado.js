/**
 * pedido-personalizado.js — Bolos: abas Monte seu bolo / Bolos de corte, resumo e WhatsApp
 */

(function() {
    'use strict';

    var PRECO_ESPECIALIDADES_KG = 90;
    var PRECO_QUERIDINHOS_KG = 80;

    /** 'monte' | 'corte' */
    var fluxoAtivo = 'monte';

    var saborSelecionado = '';
    var categoriaSelecionada = '';
    var tamanhoSelecionado = 0;
    var tamanhoLabel = '';
    var precoFinal = 0;

    var corteModelo = '';
    var cortePeso = '';
    var corteFatias = '';
    var corteValorNum = 0;
    var corteAcabamento = '';
    var corteRecheio = '';

    function formatBRL(num) {
        return num.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    function nomeLinhaAmigavel(cat) {
        if (cat === 'especialidades') return 'Especialidades da Casa';
        if (cat === 'queridinhos') return 'Queridinhos';
        return '—';
    }

    function somaAdicionaisMonte() {
        var t = 0;
        document.querySelectorAll('#bolos-painel-monte .bolos-pick-adicional[aria-pressed="true"]').forEach(function(btn) {
            var p = parseFloat(String(btn.getAttribute('data-adicional-preco') || '0'));
            if (!isNaN(p)) t += p;
        });
        return t;
    }

    function textosAdicionaisMonte() {
        var nomes = [];
        document.querySelectorAll('#bolos-painel-monte .bolos-pick-adicional[aria-pressed="true"]').forEach(function(btn) {
            var n = (btn.getAttribute('data-adicional-nome') || '').trim();
            if (n) nomes.push(n);
        });
        return nomes;
    }

    function calcularPrecoMonte() {
        var precoPorKg;
        if (categoriaSelecionada === 'especialidades') {
            precoPorKg = PRECO_ESPECIALIDADES_KG;
        } else if (categoriaSelecionada === 'queridinhos') {
            precoPorKg = PRECO_QUERIDINHOS_KG;
        } else {
            precoFinal = 0;
            return;
        }
        if (!tamanhoSelecionado || tamanhoSelecionado <= 0) {
            precoFinal = 0;
            return;
        }
        var base = precoPorKg * tamanhoSelecionado;
        precoFinal = base + somaAdicionaisMonte();
    }

    function resetMonte() {
        saborSelecionado = '';
        categoriaSelecionada = '';
        tamanhoSelecionado = 0;
        tamanhoLabel = '';
        document.querySelectorAll('#bolos-painel-monte .bolos-pick-sabor[aria-pressed="true"]').forEach(function(b) {
            b.setAttribute('aria-pressed', 'false');
        });
        document.querySelectorAll('#bolos-painel-monte .bolos-pick-tamanho[aria-pressed="true"]').forEach(function(b) {
            b.setAttribute('aria-pressed', 'false');
        });
        document.querySelectorAll('#bolos-painel-monte .bolos-pick-adicional[aria-pressed="true"]').forEach(function(b) {
            b.setAttribute('aria-pressed', 'false');
        });
    }

    function resetCorte() {
        corteModelo = '';
        cortePeso = '';
        corteFatias = '';
        corteValorNum = 0;
        corteAcabamento = '';
        corteRecheio = '';
        document.querySelectorAll('.bolos-pick-corte[aria-pressed="true"]').forEach(function(el) {
           el.setAttribute('aria-pressed', 'false');
        });
    }

    function resetAllSelections() {
        resetMonte();
        resetCorte();
        precoFinal = 0;
    }

    function setFluxo(f) {
        fluxoAtivo = f;
        resetAllSelections();

        var tabMonte = document.getElementById('bolos-tab-monte');
        var tabCorte = document.getElementById('bolos-tab-corte');
        var panelMonte = document.getElementById('bolos-painel-monte');
        var panelCorte = document.getElementById('bolos-painel-corte');

        if (tabMonte) {
            tabMonte.classList.toggle('bolos-tab--ativa', f === 'monte');
            tabMonte.setAttribute('aria-selected', f === 'monte' ? 'true' : 'false');
        }
        if (tabCorte) {
            tabCorte.classList.toggle('bolos-tab--ativa', f === 'corte');
            tabCorte.setAttribute('aria-selected', f === 'corte' ? 'true' : 'false');
        }
        if (panelMonte) panelMonte.hidden = f !== 'monte';
        if (panelCorte) panelCorte.hidden = f !== 'corte';

        atualizarResumoDOM();
    }

    function atualizarResumoDOM() {
        var elTipo = document.getElementById('bolos-resumo-tipo');
        var elLblA = document.getElementById('bolos-resumo-lbl-a');
        var elValA = document.getElementById('bolos-resumo-val-a');
        var elLblB = document.getElementById('bolos-resumo-lbl-b');
        var elValB = document.getElementById('bolos-resumo-val-b');
        var elLiC = document.getElementById('bolos-resumo-li-c');
        var elLblC = document.getElementById('bolos-resumo-lbl-c');
        var elValC = document.getElementById('bolos-resumo-val-c');
        var elPreco = document.getElementById('bolos-resumo-preco');
        var elLiAdicionais = document.getElementById('bolos-resumo-li-adicionais');
        var elValAdicionais = document.getElementById('bolos-resumo-adicionais');
        var elBarraResumo = document.getElementById('bolos-barra-resumo');
        var elBarraPreco = document.getElementById('bolos-barra-preco');

        var precoTexto = '—';

        if (fluxoAtivo === 'monte') {
            if (elTipo) elTipo.textContent = 'Monte seu bolo';
            if (elLblA) elLblA.textContent = 'Sabor';
            if (elValA) elValA.textContent = saborSelecionado || '—';
            if (elLblB) elLblB.textContent = 'Linha';
            if (elValB) elValB.textContent = categoriaSelecionada ? nomeLinhaAmigavel(categoriaSelecionada) : '—';
            if (elLiC) elLiC.hidden = false;
            if (elLblC) elLblC.textContent = 'Tamanho';
            if (elValC) elValC.textContent = tamanhoLabel || '—';
            var adicionaisList = textosAdicionaisMonte();
            if (elLiAdicionais && elValAdicionais) {
                if (adicionaisList.length > 0) {
                    elLiAdicionais.hidden = false;
                    elValAdicionais.textContent = adicionaisList.join(' · ');
                } else {
                    elLiAdicionais.hidden = true;
                    elValAdicionais.textContent = '—';
                }
            }
            calcularPrecoMonte();
            if (saborSelecionado && tamanhoLabel && categoriaSelecionada && precoFinal > 0) {
                precoTexto = 'R$ ' + formatBRL(precoFinal);
            }
            if (elBarraResumo && elBarraPreco) {
                if (!saborSelecionado || !tamanhoLabel) {
                    elBarraResumo.textContent = 'Selecione sabor e tamanho';
                    elBarraPreco.textContent = '';
                } else if (precoFinal > 0) {
                    var barraLinha = (saborSelecionado.length > 20 ? saborSelecionado.slice(0, 18) + '…' : saborSelecionado) + ' · ' + tamanhoLabel;
                    if (adicionaisList.length > 0) {
                        barraLinha += ' · +' + adicionaisList.length + ' ' + (adicionaisList.length > 1 ? 'adicionais' : 'adicional');
                    }
                    elBarraResumo.textContent = barraLinha;
                    elBarraPreco.textContent = 'R$ ' + formatBRL(precoFinal);
                } else {
                    elBarraResumo.textContent = 'Monte seu bolo';
                    elBarraPreco.textContent = '';
                }
            }
        } else {
            if (elTipo) elTipo.textContent = 'Bolo de corte';
            if (elLblA) elLblA.textContent = 'Modelo';
            if (elValA) elValA.textContent = corteModelo || '—';
            if (elLblB) elLblB.textContent = 'Peso';
            if (elValB) elValB.textContent = cortePeso || '—';
            if (elLiC) elLiC.hidden = true;
            if (elLiAdicionais) elLiAdicionais.hidden = true;
            if (elValAdicionais) elValAdicionais.textContent = '—';
            precoFinal = corteValorNum;
            if (corteModelo && corteValorNum > 0) {
                precoTexto = 'R$ ' + formatBRL(corteValorNum);
            }
            if (elBarraResumo && elBarraPreco) {
                if (!corteModelo) {
                    elBarraResumo.textContent = 'Toque em um modelo de bolo de corte';
                    elBarraPreco.textContent = '';
                } else {
                    elBarraResumo.textContent = corteModelo.length > 22 ? corteModelo.slice(0, 20) + '…' : corteModelo;
                    elBarraPreco.textContent = corteValorNum > 0 ? 'R$ ' + formatBRL(corteValorNum) : '';
                }
            }
        }

        if (elPreco) elPreco.textContent = precoTexto;
    }

    function selecionarCorteCard(el) {
        document.querySelectorAll('.bolos-pick-corte[aria-pressed="true"]').forEach(function(c) {
            c.setAttribute('aria-pressed', 'false');
        });
        el.setAttribute('aria-pressed', 'true');
        corteModelo = el.getAttribute('data-modelo') || '';
        cortePeso = el.getAttribute('data-peso') || '';
        corteFatias = el.getAttribute('data-fatias') || '';
        corteAcabamento = el.getAttribute('data-acabamento') || '';
        corteRecheio = el.getAttribute('data-recheio') || '';
        var v = parseFloat(String(el.getAttribute('data-valor') || '0'));
        if (isNaN(v)) v = 0;
        corteValorNum = v;
        atualizarResumoDOM();
    }

    function enviarWhatsApp() {
        var tel = (typeof CONFIG !== 'undefined' && CONFIG.telefoneWhatsApp) ? CONFIG.telefoneWhatsApp : '5519981178167';
        var msg;
        var valorStr;

        if (fluxoAtivo === 'monte') {
            if (!saborSelecionado) {
                alert('Selecione um sabor nas opções acima.');
                return;
            }
            if (!tamanhoLabel || !tamanhoSelecionado) {
                alert('Selecione o tamanho do bolo (3 kg ou 4 kg).');
                return;
            }
            if (!categoriaSelecionada) {
                alert('Selecione um sabor válido.');
                return;
            }
            calcularPrecoMonte();
            if (precoFinal <= 0) {
                alert('Não foi possível calcular o valor.');
                return;
            }
            valorStr = formatBRL(precoFinal);
            var adicionaisNomes = textosAdicionaisMonte();
            msg = 'Olá! Gostaria de fazer um pedido:\n\n'
                + '📋 Tipo: Monte seu bolo\n'
                + '🍰 Sabor: ' + saborSelecionado + '\n'
                + '🏷️ Linha: ' + nomeLinhaAmigavel(categoriaSelecionada) + '\n'
                + '📏 Tamanho: ' + tamanhoLabel + ' (' + tamanhoSelecionado + ' kg)\n';
            if (adicionaisNomes.length > 0) {
                msg += '🍓 Adicionais: ' + adicionaisNomes.join(', ') + ' (+' + formatBRL(somaAdicionaisMonte()) + ')\n';
            }
            msg += '💰 Valor total estimado: R$ ' + valorStr;
        } else {
            if (!corteModelo || corteValorNum <= 0) {
                alert('Selecione um modelo de bolo de corte tocando em um dos cards.');
                return;
            }
            valorStr = formatBRL(corteValorNum);
            msg = 'Olá! Gostaria de fazer um pedido:\n\n'
                + '📋 Tipo: Bolo de corte\n'
                + '🎂 Modelo: ' + corteModelo + '\n'
                + '⚖️ Peso: ' + cortePeso + '\n'
                + '🍽️ Rendimento (fatias): ' + corteFatias + '\n'
                + '✨ Acabamento: ' + corteAcabamento + '\n'
                + '🔶 Recheio: ' + corteRecheio + '\n'
                + '💰 Valor: R$ ' + valorStr;
        }

        window.open('https://wa.me/' + tel + '?text=' + encodeURIComponent(msg), '_blank');
    }

    function setupBarraMobile() {
        var barra = document.getElementById('bolos-barra-pedido');
        if (!barra) return;

        function syncBarra() {
            if (window.matchMedia('(max-width: 768px)').matches) {
                barra.removeAttribute('hidden');
            } else {
                barra.setAttribute('hidden', '');
            }
        }

        syncBarra();
        window.addEventListener('resize', syncBarra);
    }

    document.addEventListener('DOMContentLoaded', function() {
        setupBarraMobile();

        document.getElementById('bolos-tab-monte')?.addEventListener('click', function() {
            setFluxo('monte');
        });
        document.getElementById('bolos-tab-corte')?.addEventListener('click', function() {
            setFluxo('corte');
        });

        document.querySelectorAll('#bolos-painel-monte .bolos-pick-sabor').forEach(function(btn) {
            btn.addEventListener('click', function() {
                if (fluxoAtivo !== 'monte') return;
                var eraAtivo = btn.getAttribute('aria-pressed') === 'true';
                document.querySelectorAll('#bolos-painel-monte .bolos-pick-sabor').forEach(function(b) {
                    b.setAttribute('aria-pressed', 'false');
                });
                if (eraAtivo) {
                    saborSelecionado = '';
                    categoriaSelecionada = '';
                } else {
                    btn.setAttribute('aria-pressed', 'true');
                    saborSelecionado = btn.getAttribute('data-sabor') || '';
                    categoriaSelecionada = btn.getAttribute('data-categoria') || '';
                }
                atualizarResumoDOM();
            });
        });

        document.querySelectorAll('#bolos-painel-monte .bolos-pick-tamanho').forEach(function(btn) {
            btn.addEventListener('click', function() {
                if (fluxoAtivo !== 'monte') return;
                if (btn.classList.contains('bolos-pick-adicional')) return;
                var eraAtivo = btn.getAttribute('aria-pressed') === 'true';
                document.querySelectorAll('#bolos-painel-monte .bolos-pick-tamanho:not(.bolos-pick-adicional)').forEach(function(b) {
                    b.setAttribute('aria-pressed', 'false');
                });
                if (eraAtivo) {
                    tamanhoSelecionado = 0;
                    tamanhoLabel = '';
                } else {
                    btn.setAttribute('aria-pressed', 'true');
                    var kg = parseFloat(String(btn.getAttribute('data-kg') || '0').replace(',', '.'));
                    if (isNaN(kg)) kg = 0;
                    tamanhoSelecionado = kg;
                    tamanhoLabel = btn.getAttribute('data-label') || btn.textContent.trim();
                }
                atualizarResumoDOM();
            });
        });

        document.querySelectorAll('#bolos-painel-monte .bolos-pick-adicional').forEach(function(btn) {
            btn.addEventListener('click', function() {
                if (fluxoAtivo !== 'monte') return;
                var on = btn.getAttribute('aria-pressed') === 'true';
                btn.setAttribute('aria-pressed', on ? 'false' : 'true');
                atualizarResumoDOM();
            });
        });

        document.querySelectorAll('.bolos-pick-corte').forEach(function(card) {
            card.addEventListener('click', function() {
                if (fluxoAtivo !== 'corte') return;
                selecionarCorteCard(card);
            });
            card.addEventListener('keydown', function(e) {
                if (fluxoAtivo !== 'corte') return;
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    selecionarCorteCard(card);
                }
            });
        });

        var btnPedir = document.getElementById('bolos-btn-pedir-whatsapp');
        if (btnPedir) btnPedir.addEventListener('click', enviarWhatsApp);

        var btnBarra = document.getElementById('bolos-barra-btn-fazer-pedido');
        if (btnBarra) btnBarra.addEventListener('click', enviarWhatsApp);

        atualizarResumoDOM();
    });
})();
