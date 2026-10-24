/**
 * Shell do painel de gestão.
 * Reutiliza a sessão já criada em js/admin-common.js.
 * Nesta etapa só monta navegação e estados vazios — não lê orçamentos nem valores.
 */
(function () {
    var PAGINAS = [
        { id: "dashboard", titulo: "Dashboard", href: "index.html", icone: "painel" },
        { id: "financeiro", titulo: "Financeiro", href: "financeiro.html", icone: "financeiro" },
        { id: "agenda", titulo: "Agenda", href: "agenda.html", icone: "agenda" },
        { id: "contratos", titulo: "Contratos", href: "contratos.html", icone: "contratos" },
        { id: "documentos", titulo: "Documentos", href: "documentos.html", icone: "documentos" }
    ];

    function svg(caminho) {
        return (
            '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' +
            caminho +
            '"></path></svg>'
        );
    }

    function icone(nome) {
        var caminhos = {
            painel: "M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z",
            financeiro: "M4 19V5M4 19h16M8 15v-3M12 15V8M16 15v-5",
            agenda: "M7 3v3M17 3v3M4 8h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z",
            contratos: "M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM14 3v5h5M8 13h8M8 17h5",
            documentos: "M6 3h9l3 3v15H6zM9 12h6M9 16h6"
        };
        return svg(caminhos[nome] || caminhos.painel);
    }

    function fecharMenu() {
        document.body.classList.remove("gestao-nav-aberta");
        var botao = document.getElementById("gestao-menu");
        if (botao) botao.setAttribute("aria-expanded", "false");
    }

    function texto(valor) {
        return String(valor == null ? "" : valor).replace(/[&<>"']/g, function (c) {
            return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
        });
    }

    function montarSidebar(ativa) {
        var aside = document.getElementById("gestao-sidebar");
        if (!aside) return;
        var empresa = texto(typeof CONFIG !== "undefined" && CONFIG.nomeEmpresa ? CONFIG.nomeEmpresa : "Candy Li");
        var links = PAGINAS.map(function (p) {
            var atual = p.id === ativa ? ' aria-current="page"' : "";
            return (
                '<a href="' +
                p.href +
                '"' +
                atual +
                ">" +
                icone(p.icone) +
                "<span>" +
                p.titulo +
                "</span></a>"
            );
        }).join("");

        aside.innerHTML =
            '<div class="gestao-marca">' +
            '<p class="gestao-marca-nome">' +
            empresa +
            "</p>" +
            '<p class="gestao-marca-sub">Gestão</p>' +
            "</div>" +
            '<nav class="gestao-nav" aria-label="Módulos da gestão">' +
            links +
            "</nav>" +
            '<div class="gestao-sidebar-rodape">' +
            '<a href="../index.html">Orçamentos</a>' +
            '<a href="../../index.html">Site</a>' +
            '<button type="button" id="gestao-sair">Sair</button>' +
            "</div>";

        var sair = document.getElementById("gestao-sair");
        if (sair) {
            sair.addEventListener("click", function () {
                if (typeof adminLogout === "function") {
                    adminLogout(function () {
                        window.location.href = "/admin/";
                    });
                    return;
                }
                window.location.href = "/admin/";
            });
        }
    }

    function ligarMenu() {
        var botao = document.getElementById("gestao-menu");
        var scrim = document.getElementById("gestao-scrim");
        if (botao) {
            botao.addEventListener("click", function () {
                var aberto = document.body.classList.toggle("gestao-nav-aberta");
                botao.setAttribute("aria-expanded", aberto ? "true" : "false");
            });
        }
        if (scrim) scrim.addEventListener("click", fecharMenu);
    }

    function init() {
        function mostrar() {
            montarSidebar(document.body.getAttribute("data-gestao-pagina") || "dashboard");
            ligarMenu();
            var bloqueio = document.getElementById("gestao-bloqueio");
            var app = document.getElementById("gestao-app");
            if (bloqueio) bloqueio.remove();
            if (app) app.hidden = false;
        }
        if (typeof adminCarregarSessao !== "function") {
            window.location.replace("/admin/");
            return;
        }
        adminCarregarSessao(function (ok) {
            if (!ok) {
                window.location.replace("/admin/");
                return;
            }
            mostrar();
        });
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();
