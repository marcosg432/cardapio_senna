/**
 * Orçamentos: API SQLite (servidor local) com fallback em localStorage.
 * Chaves: "orcamentos" e orcamentos_<empresa> (legado).
 */

var ORCAMENTOS_LS_KEY = "orcamentos";

/**
 * Marcador interno quando o PATCH falhou mas os dados foram fundidos só no navegador.
 * Evita que listarOrcamentos(), ao sincronizar com a API SQLite, pisote localStorage atualizado.
 * Removido no servidor ao gravar payload (orcamentosRepository).
 */
var META_EDITADO_SO_LOCAL_KEY = "__editadoSomenteLocalEm";
/** Igual ao servidor (SQLite updated_at propagado pela API só para fusão lista). */
var META_ATUALIZADO_SERVIDOR_KEY = "_atualizadoServidorEm";

function getLegacyOrcamentosKey() {
    var nome = typeof getConfigStorageSlug === "function"
        ? getConfigStorageSlug()
        : ((typeof CONFIG !== "undefined" && CONFIG.nomeEmpresa)
            ? CONFIG.nomeEmpresa.replace(/\s+/g, "_").toLowerCase()
            : "default");
    return "orcamentos_" + nome;
}

function parseListaOrcamentosRaw(raw) {
    if (!raw) return [];
    try {
        var arr = JSON.parse(raw);
        return Array.isArray(arr) ? arr : [];
    } catch (e) {
        return [];
    }
}

function mergeListasOrcamentosPorId(listas) {
    var byId = {};
    for (var L = 0; L < listas.length; L++) {
        var arr = listas[L];
        if (!Array.isArray(arr)) continue;
        for (var i = 0; i < arr.length; i++) {
            var o = arr[i];
            if (!o || o.id == null) continue;
            var k = String(o.id);
            var cur = byId[k];
            if (!cur) {
                byId[k] = o;
            } else {
                var t1 = Date.parse(cur.data_criacao || cur.data || 0) || 0;
                var t2 = Date.parse(o.data_criacao || o.data || 0) || 0;
                if (t2 >= t1) byId[k] = o;
            }
        }
    }
    var ids = Object.keys(byId).sort(function (a, b) {
        return Number(b) - Number(a);
    });
    return ids.map(function (id) {
        return byId[id];
    });
}

/**
 * Se o PATCH só gravou no browser e GET devolver payload antigo da API, funde o estado local preservado na lista anterior.
 */
function fundirListaApiComPreferenciaLocal(listaApi, listaLocalPrev) {
    if (!Array.isArray(listaApi)) return [];
    var mapPrev = {};
    (listaLocalPrev || []).forEach(function (o) {
        if (!o || o.id == null) return;
        mapPrev[String(o.id)] = o;
    });
    var idsApi = {};
    var fundida = listaApi.map(function (rowApi) {
        idsApi[String(rowApi.id)] = true;
        var loc = mapPrev[String(rowApi.id)];
        if (loc && typeof loc[META_EDITADO_SO_LOCAL_KEY] === "number" && rowApi.id != null) {
            var srvIso = rowApi[META_ATUALIZADO_SERVIDOR_KEY];
            var srvMs = srvIso ? Date.parse(String(srvIso)) : NaN;
            var localTs = loc[META_EDITADO_SO_LOCAL_KEY];
            /*
             * PATCH gravou na API depois da cópia só-local → confiar na API (evita telefone/nome velhos a pisar dados novos).
             */
            if (!isNaN(srvMs) && srvMs > localTs) {
                var limpo = Object.assign({}, rowApi);
                delete limpo[META_EDITADO_SO_LOCAL_KEY];
                return limpo;
            }
            return Object.assign({}, rowApi, loc);
        }
        return rowApi;
    });
    /* Orçamentos criados só neste browser (POST falhou) não estão no SQLite: manter no fim da lista */
    (listaLocalPrev || []).forEach(function (o) {
        if (!o || o.id == null) return;
        var id = String(o.id);
        if (!idsApi[id]) {
            fundida.push(o);
            idsApi[id] = true;
        }
    });
    return fundida;
}

function removerMetaSomenteLocalDoObjeto(o) {
    if (!o || typeof o !== "object") return o;
    if (Object.prototype.hasOwnProperty.call(o, META_EDITADO_SO_LOCAL_KEY)) {
        delete o[META_EDITADO_SO_LOCAL_KEY];
    }
    return o;
}

function apiRequestSync(method, pathStr, bodyObj) {
    try {
        var xhr = new XMLHttpRequest();
        xhr.open(method, pathStr, false);
        xhr.setRequestHeader("Content-Type", "application/json; charset=utf-8");
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

function obterOrcamentosSoLocalStorage() {
    var a1 = parseListaOrcamentosRaw(localStorage.getItem(ORCAMENTOS_LS_KEY));
    var a2 = parseListaOrcamentosRaw(localStorage.getItem(getLegacyOrcamentosKey()));
    return mergeListasOrcamentosPorId([a1, a2]);
}

function listarOrcamentos() {
    try {
        var r = apiRequestSync("GET", "/api/orcamentos", null);
        if (r.ok && r.body) {
            var sync = JSON.parse(r.body);
            if (Array.isArray(sync)) {
                /* Ler localStorage antes do setItem seguinte para fundir registos apenas gravados neste navegador (PATCH falhou antes). */
                var combinada = fundirListaApiComPreferenciaLocal(sync, obterOrcamentosSoLocalStorage());
                try {
                    var json = JSON.stringify(combinada);
                    localStorage.setItem(ORCAMENTOS_LS_KEY, json);
                    localStorage.setItem(getLegacyOrcamentosKey(), json);
                } catch (e) {
                    console.warn("Espelho local dos orçamentos:", e);
                }
                return combinada;
            }
        }
    } catch (e) {
        console.warn("API indisponível, usando localStorage:", e);
    }
    try {
        var merged = obterOrcamentosSoLocalStorage();
        if (merged.length > 0) {
            try {
                var j = JSON.stringify(merged);
                localStorage.setItem(ORCAMENTOS_LS_KEY, j);
                localStorage.setItem(getLegacyOrcamentosKey(), j);
            } catch (syncErr) {
                console.warn("Ao unificar chaves de orçamentos:", syncErr);
            }
        }
        return merged;
    } catch (e2) {
        console.warn("Erro ao listar orçamentos:", e2);
        return [];
    }
}

function salvarListaOrcamentos(arr) {
    try {
        var json = JSON.stringify(arr);
        localStorage.setItem(ORCAMENTOS_LS_KEY, json);
        localStorage.setItem(getLegacyOrcamentosKey(), json);
    } catch (e) {
        console.warn("LocalStorage:", e);
        throw e;
    }
}

function getOrcamentoPorId(id) {
    return listarOrcamentos().find(function (o) {
        return String(o.id) === String(id);
    });
}

function mesclaListaComOrcamento(lista, registro) {
    var out = lista.slice();
    var i = out.findIndex(function (o) {
        return String(o.id) === String(registro.id);
    });
    if (i >= 0) out.splice(i, 1);
    out.unshift(registro);
    return out;
}

function criarOrcamento(registro) {
    try {
        var r = apiRequestSync("POST", "/api/orcamentos", registro);
        if (r.ok && r.body) {
            var saved = JSON.parse(r.body);
            var list = mesclaListaComOrcamento(obterOrcamentosSoLocalStorage(), saved);
            salvarListaOrcamentos(list);
            return saved;
        }
    } catch (e) {
        console.warn("POST orçamento — fallback local:", e);
    }
    var list = obterOrcamentosSoLocalStorage();
    registro.__salvoSomenteLocalEm = Date.now();
    list.unshift(registro);
    salvarListaOrcamentos(list);
    return registro;
}

function atualizarOrcamentoParcial(id, patch) {
    try {
        var r = apiRequestSync("PATCH", "/api/orcamentos/" + encodeURIComponent(id), patch);
        if (r.ok && r.body) {
            var saved = JSON.parse(r.body);
            removerMetaSomenteLocalDoObjeto(saved);
            var list = obterOrcamentosSoLocalStorage();
            var i = list.findIndex(function (o) {
                return String(o.id) === String(id);
            });
            if (i >= 0) list[i] = saved;
            else list.unshift(saved);
            salvarListaOrcamentos(list);
            return saved;
        }
    } catch (e) {
        console.warn("PATCH orçamento — fallback local:", e);
    }
    var list = obterOrcamentosSoLocalStorage();
    var i = list.findIndex(function (o) {
        return String(o.id) === String(id);
    });
    if (i === -1) return null;
    list[i] = Object.assign({}, list[i], patch);
    list[i][META_EDITADO_SO_LOCAL_KEY] = Date.now();
    salvarListaOrcamentos(list);
    return list[i];
}

function removerOrcamentoDaListaLocal(idStr) {
    var list = obterOrcamentosSoLocalStorage();
    var filtrada = list.filter(function (o) {
        return o && String(o.id) !== idStr;
    });
    if (filtrada.length === list.length) return false;
    salvarListaOrcamentos(filtrada);
    return true;
}

/**
 * Apaga na API (SQLite) e remove do localStorage. Sem servidor ou 404, remove só a cópia local.
 * @returns {boolean} true se deixou de existir na lista local
 */
function excluirOrcamento(id) {
    var idStr = String(id);
    var r;
    try {
        r = apiRequestSync("DELETE", "/api/orcamentos/" + encodeURIComponent(idStr), null);
    } catch (e) {
        r = { ok: false, status: 0 };
    }
    if (r.ok && (r.status === 204 || r.status === 200)) {
        return removerOrcamentoDaListaLocal(idStr);
    }
    /* Não existe no servidor — alinhar lista local */
    if (r.status === 404) {
        return removerOrcamentoDaListaLocal(idStr);
    }
    /* API inacessível / só estático: apagar local */
    if (r.status === 0) {
        return removerOrcamentoDaListaLocal(idStr);
    }
    return false;
}
