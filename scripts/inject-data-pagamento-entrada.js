const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");

const OLD = "                <label for=\"pagamento\">Forma de pagamento (referência)</label>";

const BLOCO =
    "                <p class=\"carrinho-form-section-title\">Dados do pagamento</p>\n" +
    "                <label for=\"data-pagamento-entrada\">Data prevista para pagamento da entrada</label>\n" +
    "                <input type=\"date\" id=\"data-pagamento-entrada\">\n" +
    "                <p class=\"carrinho-form-hint\">Informe a data prevista para pagamento da entrada do evento.</p>\n";

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
    if (t.includes("id=\"data-pagamento-entrada\"")) {
        console.log("Já possui o campo:", path.relative(root, f));
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
