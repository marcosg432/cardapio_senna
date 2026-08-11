const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");

const BLOCO_CORRETO =
    '                <p class="carrinho-form-section-title">Forma de entrega e suporte *</p>\n' +
    '                <div class="entrega-suporte" id="entrega-suporte" role="radiogroup" aria-label="Forma de entrega e suporte">\n' +
    '                    <label class="entrega-suporte-opcao">\n' +
    '                        <input type="radio" name="entrega-suporte" value="Apenas retirada dos doces sem entrega" data-taxa="0">\n' +
    '                        <span class="entrega-suporte-card">\n' +
    '                            <span class="entrega-suporte-head">\n' +
    '                                <span class="entrega-suporte-titulo">Apenas retirada dos doces</span>\n' +
    '                                <span class="entrega-suporte-preco">Sem custo adicional</span>\n' +
    '                            </span>\n' +
    '                            <span class="entrega-suporte-desc">Sem entrega — você retira os doces no local combinado.</span>\n' +
    '                        </span>\n' +
    '                    </label>\n' +
    '                    <label class="entrega-suporte-opcao">\n' +
    '                        <input type="radio" name="entrega-suporte" value="Apenas entrega sem montagem" data-taxa="50">\n' +
    '                        <span class="entrega-suporte-card">\n' +
    '                            <span class="entrega-suporte-head">\n' +
    '                                <span class="entrega-suporte-titulo">Apenas entrega sem montagem</span>\n' +
    '                                <span class="entrega-suporte-preco">A partir de R$ 50,00</span>\n' +
    '                            </span>\n' +
    '                            <span class="entrega-suporte-desc">Entregamos os doces no local, sem montagem da mesa.</span>\n' +
    '                        </span>\n' +
    '                    </label>\n' +
    '                    <label class="entrega-suporte-opcao">\n' +
    '                        <input type="radio" name="entrega-suporte" value="Entrega dos doces com montagem - suportes da decoração" data-taxa="150">\n' +
    '                        <span class="entrega-suporte-card">\n' +
    '                            <span class="entrega-suporte-head">\n' +
    '                                <span class="entrega-suporte-titulo">Entrega com montagem — suportes da decoração</span>\n' +
    '                                <span class="entrega-suporte-preco">A partir de R$ 150,00</span>\n' +
    '                            </span>\n' +
    '                            <span class="entrega-suporte-desc">Entregamos e montamos a mesa usando os suportes da sua decoração.</span>\n' +
    '                        </span>\n' +
    '                    </label>\n' +
    '                    <label class="entrega-suporte-opcao">\n' +
    '                        <input type="radio" name="entrega-suporte" value="Entrega dos doces com montagem - suportes cortesia" data-taxa="200">\n' +
    '                        <span class="entrega-suporte-card">\n' +
    '                            <span class="entrega-suporte-head">\n' +
    '                                <span class="entrega-suporte-titulo">Entrega com montagem — suportes cortesia</span>\n' +
    '                                <span class="entrega-suporte-preco">A partir de R$ 200,00</span>\n' +
    '                            </span>\n' +
    '                            <span class="entrega-suporte-desc">Entregamos e montamos a mesa com nossos suportes cortesia.</span>\n' +
    '                            <span class="entrega-suporte-nota">Os suportes devem ser devolvidos na semana seguinte à festa.</span>\n' +
    '                        </span>\n' +
    '                    </label>\n' +
    '                </div>\n';

const START = '<p class="carrinho-form-section-title">Forma de entrega e suporte *</p>';
const END = '<p class="carrinho-form-section-title">Dados do pagamento</p>';

const FILES = [
    path.join(root, "index.html"),
    path.join(root, "pages", "bolos-personalizados.html"),
    path.join(root, "pages", "bolos-vitrine.html"),
    path.join(root, "pages", "doces-festas.html"),
    path.join(root, "pages", "doces-finos.html"),
    path.join(root, "pages", "lembrancinhas-especiais.html"),
    path.join(root, "pages", "linha-afetiva.html"),
    path.join(root, "pages", "linha-classica.html"),
    path.join(root, "pages", "linha-exclusiva.html"),
    path.join(root, "pages", "pedido-personalizado.html"),
    path.join(root, "pages", "sobremesas-tortas.html")
];

let ok = 0;
for (const f of FILES) {
    let t = fs.readFileSync(f, "utf8");
    const i0 = t.indexOf(START);
    const i1 = t.indexOf(END);
    if (i0 < 0 || i1 < 0 || i1 <= i0) {
        console.error("Marcadores não encontrados:", path.relative(root, f));
        process.exitCode = 1;
        continue;
    }
    t = t.slice(0, i0) + BLOCO_CORRETO + t.slice(i1);
    fs.writeFileSync(f, t, "utf8");
    console.log("Corrigido:", path.relative(root, f));
    ok++;
}
console.log("OK", ok, "/", FILES.length);
