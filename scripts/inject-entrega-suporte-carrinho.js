const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");

const OLD = "                <label for=\"pagamento\">Forma de pagamento (referência)</label>";

const BLOCO =
    "                <p class=\"carrinho-form-section-title\">Forma de entrega e suporte *</p>\n" +
    "                <div class=\"entrega-suporte\" id=\"entrega-suporte\" role=\"radiogroup\" aria-label=\"Forma de entrega e suporte\">\n" +
    "                    <label class=\"entrega-suporte-opcao\">\n" +
    "                        <input type=\"radio\" name=\"entrega-suporte\" value=\"Apenas retirada dos doces sem entrega\">\n" +
    "                        <span class=\"entrega-suporte-card\">\n" +
    "                            <span class=\"entrega-suporte-titulo\">Apenas retirada dos doces</span>\n" +
    "                            <span class=\"entrega-suporte-desc\">Sem entrega — você retira os doces no local combinado.</span>\n" +
    "                        </span>\n" +
    "                    </label>\n" +
    "                    <label class=\"entrega-suporte-opcao\">\n" +
    "                        <input type=\"radio\" name=\"entrega-suporte\" value=\"Apenas entrega sem montagem\">\n" +
    "                        <span class=\"entrega-suporte-card\">\n" +
    "                            <span class=\"entrega-suporte-titulo\">Apenas entrega sem montagem</span>\n" +
    "                            <span class=\"entrega-suporte-desc\">Entregamos os doces no local, sem montagem da mesa.</span>\n" +
    "                        </span>\n" +
    "                    </label>\n" +
    "                    <label class=\"entrega-suporte-opcao\">\n" +
    "                        <input type=\"radio\" name=\"entrega-suporte\" value=\"Entrega dos doces com montagem - suportes da decoração\">\n" +
    "                        <span class=\"entrega-suporte-card\">\n" +
    "                            <span class=\"entrega-suporte-titulo\">Entrega com montagem — suportes da decoração</span>\n" +
    "                            <span class=\"entrega-suporte-desc\">Entregamos e montamos a mesa usando os suportes da sua decoração.</span>\n" +
    "                        </span>\n" +
    "                    </label>\n" +
    "                    <label class=\"entrega-suporte-opcao\">\n" +
    "                        <input type=\"radio\" name=\"entrega-suporte\" value=\"Entrega dos doces com montagem - suportes cortesia\">\n" +
    "                        <span class=\"entrega-suporte-card\">\n" +
    "                            <span class=\"entrega-suporte-titulo\">Entrega com montagem — suportes cortesia</span>\n" +
    "                            <span class=\"entrega-suporte-desc\">Entregamos e montamos a mesa com nossos suportes cortesia.</span>\n" +
    "                            <span class=\"entrega-suporte-nota\">Os suportes devem ser devolvidos na semana seguinte à festa.</span>\n" +
    "                        </span>\n" +
    "                    </label>\n" +
    "                </div>\n";

const NEW = BLOCO + OLD;

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
    if (t.includes("name=\"entrega-suporte\"")) {
        console.log("Já possui a seção:", path.relative(root, f));
        ok++;
        continue;
    }
    if (!t.includes(OLD)) {
        console.error("Padrão não encontrado:", path.relative(root, f));
        process.exitCode = 1;
        continue;
    }
    t = t.replace(OLD, NEW);
    fs.writeFileSync(f, t, "utf8");
    ok++;
}
console.log("Atualizado", ok, "/", FILES.length);
