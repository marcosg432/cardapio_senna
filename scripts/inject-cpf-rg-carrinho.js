const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");

const OLD =
    "                <label for=\"email-cliente\">E-mail *</label>\n" +
    "                <input type=\"email\" id=\"email-cliente\" placeholder=\"seu@email.com\" required autocomplete=\"email\">\n" +
    "                <p class=\"carrinho-form-section-title\">Sua celebração</p>";

const NEW =
    "                <label for=\"email-cliente\">E-mail *</label>\n" +
    "                <input type=\"email\" id=\"email-cliente\" placeholder=\"seu@email.com\" required autocomplete=\"email\">\n" +
    "                <label for=\"cpf-cliente\">CPF</label>\n" +
    "                <input type=\"text\" id=\"cpf-cliente\" placeholder=\"Opcional — ex.: 000.000.000-00\" inputmode=\"numeric\" autocomplete=\"off\" maxlength=\"18\">\n" +
    "                <label for=\"rg-cliente\">RG</label>\n" +
    "                <input type=\"text\" id=\"rg-cliente\" placeholder=\"Opcional — número do documento\" autocomplete=\"off\" maxlength=\"32\">\n" +
    "                <p class=\"carrinho-form-section-title\">Sua celebração</p>";

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
    path.join(root, "pages", "pacotes.html"),
    path.join(root, "pages", "pedido-personalizado.html"),
    path.join(root, "pages", "sobremesas-tortas.html")
];

let ok = 0;
for (const f of FILES) {
    let t = fs.readFileSync(f, "utf8");
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
