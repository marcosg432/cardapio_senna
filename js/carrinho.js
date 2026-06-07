/**
 * carrinho.js - Lógica do carrinho de compras
 * Sistema de pedidos reutilizável para cardápios digitais
 */

/** Array do carrinho: { nome, preco, quantidade, qtdMin } */
let carrinho = [];

const QTD_LISTA_DELEGATED = 'data-carrinho-qty-delegated';

/**
 * Pedido mínimo global (unidades por produto/sabor), configurável em config.js
 * @returns {number}
 */
function getPedidoMinimoPadrao() {
    if (typeof CONFIG !== 'undefined' && CONFIG.pedidoMinimoUnidades != null) {
        const n = parseInt(String(CONFIG.pedidoMinimoUnidades), 10);
        if (Number.isFinite(n) && n >= 1) return n;
    }
    return 50;
}

/**
 * Quantidade mínima por item: padrão do CONFIG; valor explícito no card não pode ser menor que o padrão.
 * @param {*} v
 * @returns {number}
 */
function resolverQtdMin(v) {
    const padrao = getPedidoMinimoPadrao();
    if (v == null || v === '') return padrao;
    const n = parseInt(String(v), 10);
    if (!Number.isFinite(n) || n < 1) return padrao;
    return Math.max(padrao, n);
}

/**
 * Lê data-produto-qtd-min do card (opcional); sem atributo usa o pedido mínimo global.
 * @param {HTMLElement} card
 * @returns {number}
 */
function lerQtdMinDoCard(card) {
    if (!card) return getPedidoMinimoPadrao();
    const raw = card.dataset.produtoQtdMin != null
        ? card.dataset.produtoQtdMin
        : card.getAttribute('data-produto-qtd-min');
    return resolverQtdMin(raw != null && raw !== '' ? raw : null);
}

/**
 * Normaliza item após carregar do localStorage (legado sem qtdMin)
 * @param {object} item
 * @returns {object}
 */
function normalizarItemCarrinho(item) {
    const min = resolverQtdMin(item != null ? item.qtdMin : null);
    let q = parseInt(String(item.quantidade), 10);
    if (!Number.isFinite(q) || q < 1) q = min;
    if (q < min) q = min;
    return {
        nome: item.nome,
        preco: typeof item.preco === 'number' ? item.preco : parseFloat(String(item.preco).replace(',', '.')) || 0,
        quantidade: q,
        qtdMin: min
    };
}

/**
 * Aplica quantidade digitada após blur ou Enter (não altera durante digitação além de filtrar dígitos)
 * @param {number} index
 * @param {HTMLInputElement} inputEl
 */
function commitQuantidadeFromInput(index, inputEl) {
    const item = carrinho[index];
    if (!item || !inputEl) return;
    const min = resolverQtdMin(item.qtdMin);
    const raw = String(inputEl.value || '').trim();
    let n = parseInt(raw, 10);
    if (!Number.isFinite(n) || n < 1) n = min;
    if (n < min) n = min;
    item.quantidade = n;
    salvarCarrinho(carrinho);
    atualizarCarrinho();
    atualizarBadge();
}

function vincularDelegacaoQuantidadeLista(listaEl) {
    if (!listaEl || listaEl.getAttribute(QTD_LISTA_DELEGATED) === '1') return;
    listaEl.setAttribute(QTD_LISTA_DELEGATED, '1');
    listaEl.addEventListener('input', function (e) {
        const el = e.target;
        if (!el.classList || !el.classList.contains('carrinho-item-qty-input')) return;
        const digits = String(el.value).replace(/\D/g, '');
        if (el.value !== digits) el.value = digits;
    });
    listaEl.addEventListener('blur', function (e) {
        const el = e.target;
        if (!el.classList || !el.classList.contains('carrinho-item-qty-input')) return;
        const idx = parseInt(el.getAttribute('data-index'), 10);
        if (!Number.isFinite(idx)) return;
        commitQuantidadeFromInput(idx, el);
    }, true);
    listaEl.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter') return;
        const el = e.target;
        if (el.classList && el.classList.contains('carrinho-item-qty-input')) {
            e.preventDefault();
            el.blur();
        }
    });
}

/**
 * Adiciona produto ao carrinho ou aumenta quantidade se já existir
 * @param {string} nome - Nome do produto
 * @param {number} preco - Preço unitário
 * @param {number} [qtdMinProduto] - Pedido mínimo (padrão CONFIG); na 1ª inclusão a quantidade inicia neste valor
 */
function adicionarCarrinho(nome, preco, qtdMinProduto) {
    const precoNum = typeof preco === 'number' ? preco : parseFloat(String(preco).replace(',', '.')) || 0;
    const qtdMin = resolverQtdMin(qtdMinProduto);
    const itemExistente = carrinho.find(item => item.nome === nome && item.preco === precoNum);

    if (itemExistente) {
        itemExistente.quantidade += 1;
        itemExistente.qtdMin = resolverQtdMin(itemExistente.qtdMin || qtdMin);
        if (itemExistente.quantidade < itemExistente.qtdMin) {
            itemExistente.quantidade = itemExistente.qtdMin;
        }
    } else {
        carrinho.push({ nome, preco: precoNum, quantidade: qtdMin, qtdMin });
    }

    salvarCarrinho(carrinho);
    atualizarCarrinho();
    atualizarBadge();
    abrirCarrinho();
}

/**
 * Remove item do carrinho pelo índice
 * @param {number} index - Índice do item
 */
function removerItem(index) {
    carrinho.splice(index, 1);
    salvarCarrinho(carrinho);
    atualizarCarrinho();
    atualizarBadge();
}

/**
 * Altera quantidade de um item
 * @param {number} index - Índice do item
 * @param {string} acao - "aumentar" ou "diminuir"
 */
function alterarQuantidade(index, acao) {
    const item = carrinho[index];
    if (!item) return;

    const min = resolverQtdMin(item.qtdMin);
    let q = parseInt(String(item.quantidade), 10);
    if (!Number.isFinite(q)) q = min;
    if (q < min) q = min;

    if (acao === 'aumentar') {
        q += 1;
    } else if (acao === 'diminuir') {
        if (q <= min) return;
        q -= 1;
    } else {
        return;
    }

    item.quantidade = q;
    item.qtdMin = min;
    salvarCarrinho(carrinho);
    atualizarCarrinho();
    atualizarBadge();
}

/**
 * Atualiza a interface do carrinho (lista e total)
 */
function atualizarCarrinho() {
    const listaEl = document.getElementById('lista-carrinho');
    const totalEl = document.getElementById('total');
    const btnFinalizar = document.querySelector('.carrinho-sidebar .btn-finalizar-pedido');

    if (!listaEl) return;

    listaEl.innerHTML = '';

    if (carrinho.length === 0) {
        if (totalEl) totalEl.textContent = 'R$ 0,00';
        if (btnFinalizar) btnFinalizar.disabled = true;
        return;
    }

    carrinho.forEach((item, index) => {
        const min = resolverQtdMin(item.qtdMin);
        const q = parseInt(String(item.quantidade), 10);
        const subtotal = item.preco * q;
        const noLimiteMin = q <= min;
        const li = document.createElement('li');
        li.className = 'carrinho-item';
        li.innerHTML = `
            <div class="carrinho-item-info">
                <div class="carrinho-item-nome">${escapeHtml(item.nome)}</div>
                <div class="carrinho-item-preco-unit">R$ ${formatarPreco(item.preco)} un.</div>
            </div>
            <div class="carrinho-item-controles carrinho-item-controles--com-qty">
                <div class="carrinho-item-qty-wrap">
                    <div class="carrinho-item-qty">
                        <button type="button" aria-label="Diminuir quantidade" ${noLimiteMin ? 'disabled' : ''} onclick="alterarQuantidade(${index}, 'diminuir')">−</button>
                        <input type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off"
                            class="carrinho-item-qty-input" data-index="${index}"
                            aria-label="Editar quantidade (mínimo ${min})"
                            value="${q}" />
                        <button type="button" aria-label="Aumentar quantidade" onclick="alterarQuantidade(${index}, 'aumentar')">+</button>
                    </div>
                    <p class="carrinho-item-qty-hint">Pedido mínimo: ${min} ${min === 1 ? 'unidade' : 'unidades'}</p>
                </div>
                <button type="button" class="carrinho-item-remove" onclick="removerItem(${index})">Remover</button>
            </div>
            <span class="carrinho-item-subtotal">R$ ${formatarPreco(subtotal)}</span>
        `;
        listaEl.appendChild(li);
    });

    const total = calcularTotal();
    if (totalEl) totalEl.textContent = 'R$ ' + formatarPreco(total);
    if (btnFinalizar) btnFinalizar.disabled = false;
}

/**
 * Calcula o valor total do carrinho
 * @returns {number}
 */
function calcularTotal() {
    return carrinho.reduce((acc, item) => acc + item.preco * item.quantidade, 0);
}

/**
 * Formata preço para exibição
 * @param {number} valor
 * @returns {string}
 */
function formatarPreco(valor) {
    return Number(valor).toFixed(2).replace('.', ',');
}

/**
 * Escapa HTML para evitar XSS
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

/**
 * Atualiza badge com quantidade de itens
 */
function atualizarBadge() {
    const badge = document.querySelector('.carrinho-badge');
    if (!badge) return;

    const qty = carrinho.reduce((acc, item) => acc + item.quantidade, 0);
    badge.textContent = qty;
    badge.style.display = qty > 0 ? 'flex' : 'none';
}

/**
 * Abre o sidebar do carrinho
 */
function abrirCarrinho() {
    document.querySelectorAll('.carrinho-overlay').forEach(function (el) {
        el.classList.add('ativo');
        el.setAttribute('aria-hidden', 'false');
    });
    document.querySelectorAll('.carrinho-sidebar').forEach(function (el) {
        el.classList.add('ativo');
    });
    document.body.style.overflow = 'hidden';
}

/**
 * Fecha o sidebar do carrinho
 */
function fecharCarrinho() {
    document.querySelectorAll('.carrinho-overlay').forEach(function (el) {
        el.classList.remove('ativo');
        el.setAttribute('aria-hidden', 'true');
    });
    document.querySelectorAll('.carrinho-sidebar').forEach(function (el) {
        el.classList.remove('ativo');
    });
    document.body.style.overflow = '';
}

/**
 * Evita que a seleção de suporte/entrega feche o carrinho ou dispare clique no overlay (mobile).
 */
function initEntregaSuporteCarrinho() {
    var grupo = document.getElementById('entrega-suporte');
    if (!grupo) return;

    grupo.addEventListener('click', function (e) {
        e.stopPropagation();
    });

    grupo.querySelectorAll('input[name="entrega-suporte"]').forEach(function (radio) {
        radio.addEventListener('change', function (e) {
            e.stopPropagation();
            abrirCarrinho();
            var opcao = radio.closest('.entrega-suporte-opcao');
            if (opcao && typeof opcao.scrollIntoView === 'function') {
                opcao.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            }
            if (typeof radio.blur === 'function') radio.blur();
        });
    });
}

/**
 * Extrai preço numérico de texto como "R$ 45,00" ou "A partir de R$ 45,00"
 * @param {string} texto
 * @returns {number}
 */
function extrairPreco(texto) {
    if (!texto) return 0;
    const match = texto.match(/R\$\s*([\d.,]+)/);
    if (!match) return 0;
    return parseFloat(match[1].replace('.', '').replace(',', '.')) || 0;
}

/**
 * Inicializa o carrinho: carrega dados e vincula eventos
 */
function initCarrinho() {
    const raw = carregarCarrinho();
    carrinho = Array.isArray(raw) ? raw.map(normalizarItemCarrinho) : [];

    const listaEl = document.getElementById('lista-carrinho');
    if (listaEl) vincularDelegacaoQuantidadeLista(listaEl);

    document.querySelector('.carrinho-toggle')?.addEventListener('click', abrirCarrinho);
    document.querySelector('.carrinho-close')?.addEventListener('click', fecharCarrinho);
    document.querySelectorAll('.carrinho-overlay').forEach(function (overlay) {
        overlay.addEventListener('click', function (e) {
            if (e.target !== overlay) return;
            fecharCarrinho();
        });
    });

    initEntregaSuporteCarrinho();

    document.querySelectorAll('.btn-adicionar-carrinho').forEach(btn => {
        btn.addEventListener('click', function () {
            const card = this.closest('[data-produto-nome]');
            if (!card) return;
            const nome = card.dataset.produtoNome || card.getAttribute('data-produto-nome');
            const preco = parseFloat(card.dataset.produtoPreco || card.getAttribute('data-produto-preco')) ||
                extrairPreco(card.querySelector('.produto-preco')?.textContent || '');
            const qtdMin = lerQtdMinDoCard(card);
            adicionarCarrinho(nome, preco, qtdMin);
        });
    });

    garantirAvisoPedidoMinimoGlobal();
    atualizarCarrinho();
    atualizarBadge();
}

/**
 * Texto fixo no painel do orçamento sobre o pedido mínimo por produto (valor vindo de CONFIG).
 */
function garantirAvisoPedidoMinimoGlobal() {
    const lista = document.getElementById('lista-carrinho');
    if (!lista || !lista.parentNode) return;
    let el = document.getElementById('carrinho-pedido-minimo-aviso');
    if (!el) {
        el = document.createElement('p');
        el.id = 'carrinho-pedido-minimo-aviso';
        el.className = 'carrinho-pedido-minimo-aviso';
        el.setAttribute('role', 'note');
        lista.parentNode.insertBefore(el, lista);
    }
    const min = getPedidoMinimoPadrao();
    el.textContent = 'Pedido mínimo de ' + min + ' unidades por produto e por sabor (padrão do cardápio).';
}

document.addEventListener('DOMContentLoaded', initCarrinho);
