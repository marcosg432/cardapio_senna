/**
 * Orçamentos no SQLite do servidor.
 * O navegador não guarda cópia definitiva de orçamento, contrato ou pagamento.
 */

var orcamentosConsultaFalhou = false;

function consultaOrcamentosFalhou() {
    return orcamentosConsultaFalhou;
}

function apiRequestSync(method, pathStr, bodyObj) {
    try {
        var xhr = new XMLHttpRequest();
        xhr.open(method, pathStr, false);
        xhr.setRequestHeader("Content-Type", "application/json; charset=utf-8");
        if (typeof adminCsrfToken === "string" && adminCsrfToken && method !== "GET" && method !== "HEAD") {
            xhr.setRequestHeader("X-CSRF-Token", adminCsrfToken);
        }
        if (bodyObj != null) {
            xhr.send(JSON.stringify(bodyObj));
        } else {
            xhr.send(null);
        }
        return {
            ok: xhr.status >= 200 && xhr.status < 300,
            status: xhr.status,
            body: xhr.responseText || ""
        };
    } catch (e) {
        return { ok: false, status: 0, body: "" };
    }
}

function listarOrcamentos() {
    orcamentosConsultaFalhou = false;
    try {
        var r = apiRequestSync("GET", "/api/orcamentos", null);
        if (r.ok && r.body) {
            var sync = JSON.parse(r.body);
            if (Array.isArray(sync)) return sync;
        }
    } catch (e) {
        console.warn("API de orçamentos indisponível:", e);
    }
    orcamentosConsultaFalhou = true;
    return [];
}

function getOrcamentoPorId(id) {
    if (id == null || String(id) === "") return null;
    try {
        var r = apiRequestSync("GET", "/api/orcamentos/" + encodeURIComponent(id), null);
        if (r.ok && r.body) {
            var o = JSON.parse(r.body);
            if (o && o.id != null) return o;
        }
    } catch (e) {
        console.warn("API de orçamentos indisponível:", e);
    }
    return null;
}

function criarOrcamento(registro) {
    try {
        var r = apiRequestSync("POST", "/api/orcamentos", registro);
        if (r.ok && r.body) return JSON.parse(r.body);
    } catch (e) {
        console.warn("POST orçamento:", e);
    }
    return null;
}

function atualizarOrcamentoParcial(id, patch) {
    try {
        var r = apiRequestSync("PATCH", "/api/orcamentos/" + encodeURIComponent(id), patch);
        if (r.ok && r.body) return JSON.parse(r.body);
    } catch (e) {
        console.warn("PATCH orçamento:", e);
    }
    return null;
}

function excluirOrcamento(id) {
    var r;
    try {
        r = apiRequestSync("DELETE", "/api/orcamentos/" + encodeURIComponent(id), null);
    } catch (e) {
        return false;
    }
    if (r.ok && (r.status === 204 || r.status === 200)) return true;
    return r.status === 404;
}
