/**
 * Sessão administrativa emitida pelo servidor (cookie HttpOnly).
 * Este arquivo não conhece a senha.
 */
var adminCsrfToken = "";

function adminCarregarSessao(callback) {
    var xhr = new XMLHttpRequest();
    xhr.open("GET", "/api/auth/sessao", true);
    xhr.onload = function () {
        var dados = {};
        try {
            dados = JSON.parse(xhr.responseText || "{}");
        } catch (e) {
            dados = {};
        }
        if (xhr.status === 200 && dados.autenticado && dados.csrfToken) {
            adminCsrfToken = String(dados.csrfToken);
            callback(true);
            return;
        }
        adminCsrfToken = "";
        callback(false);
    };
    xhr.onerror = function () {
        adminCsrfToken = "";
        callback(false);
    };
    xhr.send();
}

function adminEstaAutenticado() {
    return adminCsrfToken !== "";
}

function adminLogin(senha, callback) {
    var xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/auth/login", true);
    xhr.setRequestHeader("Content-Type", "application/json; charset=utf-8");
    xhr.onload = function () {
        var dados = {};
        try {
            dados = JSON.parse(xhr.responseText || "{}");
        } catch (e) {
            dados = {};
        }
        if (xhr.status === 200 && dados.ok && dados.csrfToken) {
            adminCsrfToken = String(dados.csrfToken);
            callback(true, "");
            return;
        }
        adminCsrfToken = "";
        callback(false, dados.erro || "Não foi possível entrar.");
    };
    xhr.onerror = function () {
        callback(false, "Não foi possível entrar.");
    };
    xhr.send(JSON.stringify({ senha: senha }));
}

function adminLogout(callback) {
    var xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/auth/logout", true);
    xhr.setRequestHeader("Content-Type", "application/json; charset=utf-8");
    if (adminCsrfToken) xhr.setRequestHeader("X-CSRF-Token", adminCsrfToken);
    function fim() {
        adminCsrfToken = "";
        if (callback) callback();
    }
    xhr.onload = fim;
    xhr.onerror = fim;
    xhr.send("{}");
}

function formatarDataBR(iso) {
    if (!iso) return "—";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function formatarMoeda(n) {
    var x = Number(n) || 0;
    return "R$ " + x.toFixed(2).replace(".", ",");
}
