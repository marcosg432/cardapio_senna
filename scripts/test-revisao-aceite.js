/**
 * Aceite administrativo da revisão contratual, só em SQLite temporário.
 * Não abre o banco real e não usa a assinatura oficial no cenário de falha.
 */
const { spawn } = require("child_process");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const bcrypt = require("bcryptjs");
const { DatabaseSync } = require("node:sqlite");

const SENHA = "senha-de-teste-local";
const root = path.join(__dirname, "..");

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function hoje() {
  const data = new Date();
  const mes = String(data.getMonth() + 1).padStart(2, "0");
  const dia = String(data.getDate()).padStart(2, "0");
  return data.getFullYear() + "-" + mes + "-" + dia;
}

function pedir(port, method, urlPath, opcoes) {
  opcoes = opcoes || {};
  return new Promise((resolve, reject) => {
    const data = opcoes.body == null ? null : Buffer.from(JSON.stringify(opcoes.body));
    const headers = {};
    if (opcoes.cookie) headers.Cookie = opcoes.cookie;
    if (opcoes.csrf) headers["X-CSRF-Token"] = opcoes.csrf;
    if (data) {
      headers["Content-Type"] = "application/json; charset=utf-8";
      headers["Content-Length"] = data.length;
    }
    const req = http.request({
      hostname: "127.0.0.1", port: port, path: urlPath, method: method, headers: headers
    }, (res) => {
      const chunks = [];
      res.on("data", (parte) => chunks.push(parte));
      res.on("end", () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks).toString("utf8")
      }));
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

function subir(port, tmpDb, documentosDir, extra) {
  return new Promise((resolve, reject) => {
    const env = Object.assign({}, process.env, {
      PORT: String(port),
      DATABASE_PATH: tmpDb,
      COOKIE_SECURE: "0",
      DOCUMENTOS_DIR: documentosDir
    }, extra || {});
    if (!extra || !extra.CANDYLI_ASSINATURA_ARQUIVO) {
      delete env.CANDYLI_ASSINATURA_ARQUIVO;
      delete env.CANDYLI_TESTE_ISOLADO;
    }
    const servidor = spawn(process.execPath, ["server.js"], {
      cwd: root,
      env: env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let saida = "";
    const timer = setTimeout(() => {
      servidor.kill();
      reject(new Error("servidor nao subiu\n" + saida));
    }, 8000);
    const ouvir = (buf) => {
      saida += buf.toString();
      if (saida.indexOf("localhost:" + port) !== -1) {
        clearTimeout(timer);
        resolve(servidor);
      }
    };
    servidor.stdout.on("data", ouvir);
    servidor.stderr.on("data", ouvir);
  });
}

function encerrar(servidor) {
  if (!servidor || servidor.killed) return Promise.resolve();
  return new Promise((resolve) => {
    servidor.once("exit", () => resolve());
    servidor.kill();
    setTimeout(() => resolve(), 1500);
  });
}

function item(nome, quantidade, preco) {
  return {
    nome: nome,
    quantidade: quantidade,
    unidade: "unidade",
    preco_unitario: preco,
    preco: preco,
    subtotal: quantidade * preco,
    extra_pedido_admin: true
  };
}

function gravar(db, orcamento) {
  const agora = "2026-01-01T00:00:00.000Z";
  db.prepare("INSERT INTO orcamentos (id, payload, created_at, updated_at) VALUES (?, ?, ?, ?)").run(
    orcamento.id, JSON.stringify(orcamento), agora, agora
  );
}

async function entrar(port) {
  const login = await pedir(port, "POST", "/api/auth/login", { body: { senha: SENHA } });
  assert(login.status === 200, "login " + login.status);
  return {
    cookie: String(login.headers["set-cookie"]).split(";")[0],
    csrf: JSON.parse(login.body).csrfToken
  };
}

async function preparar(port, db, sessao, id, linha, pago) {
  const data = hoje();
  gravar(db, {
    id: id,
    cliente: "Cliente " + id,
    nome_cliente: "Cliente " + id,
    contato_nome: "Cliente " + id,
    tipo_evento: "Casamento",
    data_evento: data,
    evento_data: data,
    contrato_numero_exibicao: "C-" + id,
    valor_final: linha.subtotal,
    itens: [linha],
    ordem_servico_obs: "Observação original"
  });
  const pagamento = await pedir(port, "POST", "/api/financeiro/contratos/" + id + "/pagamentos", {
    cookie: sessao.cookie,
    csrf: sessao.csrf,
    body: {
      valor_centavos: pago,
      pago_em: data,
      forma: "pix",
      chave_idempotencia: "chave-revisao-" + id
    }
  });
  assert(pagamento.status === 201, "pagamento " + id + " " + pagamento.body);
  const confirmacao = await pedir(port, "POST", "/api/orcamentos/" + id + "/confirmar-contrato", {
    cookie: sessao.cookie,
    csrf: sessao.csrf,
    body: {}
  });
  assert(confirmacao.status === 200, "confirmacao " + id + " " + confirmacao.body);
}

async function solicitar(port, sessao, id, linha) {
  return pedir(port, "POST", "/api/orcamentos/" + id + "/revisao-contratual", {
    cookie: sessao.cookie,
    csrf: sessao.csrf,
    body: {
      motivo: "Proposta registrada para o contrato " + id,
      confirmacao: true,
      patch: { itens: [linha] }
    }
  });
}

function foto(db, id) {
  const payload = db.prepare("SELECT payload FROM orcamentos WHERE id = ?").get(id).payload;
  const ficha = db.prepare("SELECT valor_contratado_centavos, situacao, congelado FROM financeiro_contratos WHERE orcamento_id = ?").get(id);
  const pagamentos = db.prepare("SELECT id, valor_centavos, pago_em, forma FROM pagamentos WHERE orcamento_id = ? ORDER BY id").all(id);
  return { payload: payload, ficha: ficha, pagamentos: pagamentos };
}

async function cenarioFalha() {
  const port = 3335;
  const tmpDb = path.join(os.tmpdir(), "candyli-revisao-falha-" + Date.now() + ".sqlite");
  const documentosDir = path.join(os.tmpdir(), "candyli-revisao-falha-docs-" + Date.now());
  const assinatura = path.join(os.tmpdir(), "candyli-assinatura-invalida-" + Date.now() + ".txt");
  fs.writeFileSync(assinatura, "isto nao e uma imagem");
  fs.rmSync(tmpDb, { force: true });
  const servidor = await subir(port, tmpDb, documentosDir, {
    CANDYLI_TESTE_ISOLADO: "1",
    CANDYLI_ASSINATURA_ARQUIVO: assinatura
  });
  const db = new DatabaseSync(tmpDb);
  try {
    db.prepare("INSERT INTO admin_usuarios (usuario, senha_hash) VALUES (?, ?)").run("admin", bcrypt.hashSync(SENHA, 12));
    const sessao = await entrar(port);
    await preparar(port, db, sessao, 951007, item("Brigadeiro", 10, 10), 4000);
    const pedido = await solicitar(port, sessao, 951007, item("Brigadeiro", 16, 10));
    assert(pedido.status === 200, "falha pedido " + pedido.body);
    const revisaoId = JSON.parse(pedido.body).revisao_id;
    const antes = foto(db, 951007);
    const producaoAntes = await pedir(port, "GET", "/api/producao/eventos", { cookie: sessao.cookie });
    const aceite = await pedir(port, "POST", "/api/orcamentos/951007/revisao-contratual/" + revisaoId + "/aceite", {
      cookie: sessao.cookie,
      csrf: sessao.csrf,
      body: { confirmacao: true }
    });
    const depois = foto(db, 951007);
    const producaoDepois = await pedir(port, "GET", "/api/producao/eventos", { cookie: sessao.cookie });
    assert(aceite.status >= 400, "falha do pdf aceitou " + aceite.status + " " + aceite.body);
    assert(depois.payload === antes.payload, "falha do pdf alterou o contrato");
    assert(depois.ficha.valor_contratado_centavos === antes.ficha.valor_contratado_centavos, "falha do pdf alterou o valor");
    assert(JSON.stringify(depois.pagamentos) === JSON.stringify(antes.pagamentos), "falha do pdf alterou pagamento");
    assert(producaoDepois.body === producaoAntes.body, "falha do pdf alterou a produção");
    assert(aceite.body.indexOf("assinatura da cliente") === -1, "falha apresentada como assinatura");
  } finally {
    db.close();
    await encerrar(servidor);
    fs.rmSync(tmpDb, { force: true });
    fs.rmSync(documentosDir, { recursive: true, force: true });
    fs.rmSync(assinatura, { force: true });
  }
}

async function main() {
  await cenarioFalha();
  const port = 3334;
  const tmpDb = path.join(os.tmpdir(), "candyli-revisao-" + Date.now() + ".sqlite");
  const documentosDir = path.join(os.tmpdir(), "candyli-revisao-docs-" + Date.now());
  fs.rmSync(tmpDb, { force: true });
  const servidor = await subir(port, tmpDb, documentosDir);
  const db = new DatabaseSync(tmpDb);
  try {
    db.prepare("INSERT INTO admin_usuarios (usuario, senha_hash) VALUES (?, ?)").run("admin", bcrypt.hashSync(SENHA, 12));
    const sessao = await entrar(port);
    await preparar(port, db, sessao, 951001, item("Brigadeiro", 10, 10), 4000);
    await preparar(port, db, sessao, 951002, item("Bem-casado", 20, 10), 15000);
    await preparar(port, db, sessao, 951003, item("Beijinho", 12, 5), 2000);
    await preparar(port, db, sessao, 951004, item("Cajuzinho", 12, 5), 2000);
    await preparar(port, db, sessao, 951005, item("Olho de sogra", 12, 5), 2000);
    await preparar(port, db, sessao, 951006, item("Surpresa de uva", 12, 5), 2000);

    const usuario = db.prepare("SELECT id, usuario FROM admin_usuarios").get();
    const agora = new Date().toISOString();
    fs.mkdirSync(path.join(documentosDir, "1"), { recursive: true });
    const pdfAntigo = path.join(documentosDir, "1", "1.pdf");
    fs.writeFileSync(pdfAntigo, Buffer.from("%PDF-1.4 versao oficial anterior"));
    db.prepare("INSERT INTO documentos (id, tipo, orcamento_id, data_referencia, criado_em) VALUES (1, 'contrato', 951001, NULL, ?)").run(agora);
    db.prepare(`
      INSERT INTO documento_versoes (
        id, documento_id, numero, estado, usuario_id, usuario_nome, criada_em, atualizada_em,
        motivo, conteudo_json, hash_snapshot, hash_pdf, pdf_caminho, revisao, chave_idempotencia, emitida_em
      ) VALUES (1, 1, 1, 'emitida', ?, ?, ?, ?, 'versao anterior', '{}', ?, ?, '1/1.pdf', 1, 'chave-revisao-anterior', ?)
    `).run(usuario.id, usuario.usuario, agora, agora, "c".repeat(64), "d".repeat(64), agora);

    const antesAumento = foto(db, 951001);
    const pedidoAumento = await solicitar(port, sessao, 951001, item("Brigadeiro", 18, 10));
    assert(pedidoAumento.status === 200 && JSON.parse(pedidoAumento.body).aplicado === false, "pedido de aumento " + pedidoAumento.body);
    const revisaoAumento = JSON.parse(pedidoAumento.body).revisao_id;
    const guardada = db.prepare("SELECT payload_anterior_json, payload_proposto_json, aceite_cliente FROM contrato_revisoes WHERE id = ?").get(revisaoAumento);
    assert(guardada.aceite_cliente === "pendente" && guardada.payload_anterior_json !== guardada.payload_proposto_json, "snapshots");
    assert(JSON.parse(guardada.payload_anterior_json).itens[0].quantidade === 10, "snapshot anterior");
    assert(JSON.parse(guardada.payload_proposto_json).itens[0].quantidade === 18, "snapshot proposto");
    assert(foto(db, 951001).payload === antesAumento.payload, "pedido alterou o contrato");
    assert(foto(db, 951001).ficha.valor_contratado_centavos === antesAumento.ficha.valor_contratado_centavos, "pedido alterou o valor");
    const producaoPendente = JSON.parse((await pedir(port, "GET", "/api/producao/eventos", { cookie: sessao.cookie })).body);
    const eventoPendente = producaoPendente.eventos.find((item) => item.id === 951001);
    assert(eventoPendente && eventoPendente.doces_total === 10, "produção usou a proposta " + JSON.stringify(eventoPendente));

    const semAuth = await pedir(port, "POST", "/api/orcamentos/951001/revisao-contratual/" + revisaoAumento + "/aceite", {
      body: { confirmacao: true }
    });
    assert(semAuth.status === 401, "aceite sem autenticação " + semAuth.status);
    const semCsrf = await pedir(port, "POST", "/api/orcamentos/951001/revisao-contratual/" + revisaoAumento + "/aceite", {
      cookie: sessao.cookie,
      body: { confirmacao: true }
    });
    assert(semCsrf.status === 403, "aceite sem csrf " + semCsrf.status);
    const semConfirmacao = await pedir(port, "POST", "/api/orcamentos/951001/revisao-contratual/" + revisaoAumento + "/aceite", {
      cookie: sessao.cookie,
      csrf: sessao.csrf,
      body: { confirmacao: false }
    });
    assert(semConfirmacao.status === 400, "aceite sem confirmação " + semConfirmacao.status);
    assert(foto(db, 951001).payload === antesAumento.payload, "tentativa sem autenticação alterou o contrato");

    const versao = db.prepare("SELECT id, revisao, estado FROM documento_versoes WHERE id != 1 ORDER BY id DESC").get();
    const emissaoAntecipada = await pedir(port, "POST", "/api/documentos/versoes/" + versao.id + "/emitir", {
      cookie: sessao.cookie,
      csrf: sessao.csrf,
      body: { revisao: versao.revisao, chave: "emissao-antecipada-01" }
    });
    assert(emissaoAntecipada.status === 409, "rascunho pendente foi emitido " + emissaoAntecipada.body);
    assert(db.prepare("SELECT estado FROM documento_versoes WHERE id = ?").get(versao.id).estado === "rascunho", "rascunho mudou de estado");

    const aceites = await Promise.all([
      pedir(port, "POST", "/api/orcamentos/951001/revisao-contratual/" + revisaoAumento + "/aceite", {
        cookie: sessao.cookie, csrf: sessao.csrf, body: { confirmacao: true }
      }),
      pedir(port, "POST", "/api/orcamentos/951001/revisao-contratual/" + revisaoAumento + "/aceite", {
        cookie: sessao.cookie, csrf: sessao.csrf, body: { confirmacao: true }
      })
    ]);
    const aceitos = aceites.filter((resposta) => resposta.status === 200);
    assert(aceitos.length === 1 && aceites.some((resposta) => resposta.status === 409), "aceite duplicado " + aceites.map((item) => item.status).join(","));
    const aceite = JSON.parse(aceitos[0].body);
    assert(aceite.aceite_administrativo === true && aceite.nao_e_assinatura_da_cliente === true, "aceite apresentado como assinatura");
    assert(aceite.aceito_em && aceite.aceito_usuario_nome && aceite.documento_aceito_id, "aceite sem responsável ou documento");
    assert(aceite.valor_novo_centavos === 18000 && aceite.recebido_centavos === 4000 && aceite.pendente_centavos === 14000, "aumento " + aceitos[0].body);
    const depoisAumento = foto(db, 951001);
    assert(JSON.parse(depoisAumento.payload).itens[0].quantidade === 18, "aceite não aplicou a proposta");
    assert(depoisAumento.ficha.valor_contratado_centavos === 18000 && depoisAumento.ficha.congelado === 1, "valor congelado");
    assert(depoisAumento.pagamentos.length === 1 && depoisAumento.pagamentos[0].valor_centavos === 4000, "pagamento do aumento");
    assert(fs.readFileSync(pdfAntigo).toString() === "%PDF-1.4 versao oficial anterior", "versão anterior regravada");
    const antiga = db.prepare("SELECT estado FROM documento_versoes WHERE id = 1").get();
    const nova = db.prepare("SELECT estado, pdf_caminho FROM documento_versoes WHERE id = ?").get(aceite.documento_aceito_id);
    assert(antiga.estado === "emitida" && nova.estado === "emitida" && nova.pdf_caminho !== "1/1.pdf", "histórico documental");
    assert(fs.existsSync(path.join(documentosDir, nova.pdf_caminho)) && fs.readFileSync(path.join(documentosDir, nova.pdf_caminho)).slice(0, 4).toString() === "%PDF", "pdf novo");
    const producaoAceita = JSON.parse((await pedir(port, "GET", "/api/producao/eventos", { cookie: sessao.cookie })).body);
    assert(producaoAceita.eventos.find((item) => item.id === 951001).doces_total === 18, "produção depois do aceite");

    const antesReducao = foto(db, 951002);
    const pedidoReducao = await solicitar(port, sessao, 951002, item("Bem-casado", 8, 10));
    assert(pedidoReducao.status === 200, "pedido de redução " + pedidoReducao.body);
    const reducaoId = JSON.parse(pedidoReducao.body).revisao_id;
    assert(foto(db, 951002).payload === antesReducao.payload, "redução pendente alterou o contrato");
    const aceiteReducao = await pedir(port, "POST", "/api/orcamentos/951002/revisao-contratual/" + reducaoId + "/aceite", {
      cookie: sessao.cookie, csrf: sessao.csrf, body: { confirmacao: true }
    });
    assert(aceiteReducao.status === 200, "aceite da redução " + aceiteReducao.body);
    const saldo = JSON.parse((await pedir(port, "GET", "/api/financeiro/contratos/951002", { cookie: sessao.cookie })).body);
    assert(saldo.valor_contratado_centavos === 8000 && saldo.recebido_centavos === 15000 && saldo.pendente_centavos === -7000, "saldo negativo " + JSON.stringify(saldo));
    assert(saldo.credito_centavos === 7000 && saldo.historico.length === 1, "redução criou estorno");

    const antesRecusa = foto(db, 951003);
    const pedidoRecusa = await solicitar(port, sessao, 951003, item("Beijinho", 30, 5));
    const recusaId = JSON.parse(pedidoRecusa.body).revisao_id;
    const recusada = await pedir(port, "POST", "/api/orcamentos/951003/revisao-contratual/" + recusaId + "/recusar", {
      cookie: sessao.cookie, csrf: sessao.csrf, body: { confirmacao: true, motivo: "A cliente manteve o pedido" }
    });
    assert(recusada.status === 200 && JSON.parse(recusada.body).aceite_cliente === "recusado", "recusa " + recusada.body);
    assert(JSON.stringify(foto(db, 951003)) === JSON.stringify(antesRecusa), "recusa alterou contrato ou pagamento");
    assert(db.prepare("SELECT estado FROM documento_versoes WHERE id = (SELECT documento_versao_id FROM contrato_revisoes WHERE id = ?)").get(recusaId).estado === "descartado", "rascunho da recusa");

    const antesCancelamento = foto(db, 951004);
    const pedidoCancelamento = await solicitar(port, sessao, 951004, item("Cajuzinho", 30, 5));
    const cancelamentoId = JSON.parse(pedidoCancelamento.body).revisao_id;
    const cancelada = await pedir(port, "POST", "/api/orcamentos/951004/revisao-contratual/" + cancelamentoId + "/cancelar", {
      cookie: sessao.cookie, csrf: sessao.csrf, body: { confirmacao: true, motivo: "Revisão aberta por engano" }
    });
    assert(cancelada.status === 200 && JSON.parse(cancelada.body).aceite_cliente === "cancelado", "cancelamento " + cancelada.body);
    assert(JSON.stringify(foto(db, 951004)) === JSON.stringify(antesCancelamento), "cancelamento alterou contrato ou pagamento");

    const antesConcorrencia = foto(db, 951005);
    const simultaneas = await Promise.all([
      solicitar(port, sessao, 951005, item("Olho de sogra", 20, 5)),
      solicitar(port, sessao, 951005, item("Olho de sogra", 22, 5))
    ]);
    assert(simultaneas.filter((resposta) => resposta.status === 200).length === 1, "duas solicitações aceitas " + simultaneas.map((item) => item.status).join(","));
    assert(simultaneas.some((resposta) => resposta.status === 409), "segunda solicitação não foi impedida");
    assert(db.prepare("SELECT COUNT(*) AS n FROM contrato_revisoes WHERE orcamento_id = 951005 AND aceite_cliente = 'pendente'").get().n === 1, "mais de uma revisão pendente");
    assert(foto(db, 951005).payload === antesConcorrencia.payload, "solicitação simultânea alterou o contrato");

    const pedidoMudanca = await solicitar(port, sessao, 951006, item("Surpresa de uva", 20, 5));
    const mudancaId = JSON.parse(pedidoMudanca.body).revisao_id;
    const operacional = await pedir(port, "PATCH", "/api/orcamentos/951006/operacional", {
      cookie: sessao.cookie,
      csrf: sessao.csrf,
      body: { ordem_servico_obs: "Observação alterada depois da revisão" }
    });
    assert(operacional.status === 200, "operacional " + operacional.status);
    const bloqueio = await pedir(port, "POST", "/api/orcamentos/951006/revisao-contratual/" + mudancaId + "/aceite", {
      cookie: sessao.cookie, csrf: sessao.csrf, body: { confirmacao: true }
    });
    assert(bloqueio.status === 409, "aceite com contrato mudado " + bloqueio.body);
    const aposBloqueio = foto(db, 951006);
    assert(JSON.parse(aposBloqueio.payload).itens[0].quantidade === 12, "bloqueio aplicou a proposta");
    assert(aposBloqueio.ficha.valor_contratado_centavos === 6000 && aposBloqueio.pagamentos[0].valor_centavos === 2000, "bloqueio alterou financeiro");
    const producaoBloqueada = JSON.parse((await pedir(port, "GET", "/api/producao/eventos", { cookie: sessao.cookie })).body);
    assert(producaoBloqueada.eventos.find((item) => item.id === 951006).doces_total === 12, "produção da revisão bloqueada");

    const tela = fs.readFileSync(path.join(root, "js", "admin-detalhe-orcamento.js"), "utf8");
    assert(tela.indexOf("aceite do cliente") === -1 && tela.indexOf("aceite administrativo") !== -1, "texto da tela");
    console.log("Revisão contratual ok.");
  } finally {
    db.close();
    await encerrar(servidor);
    fs.rmSync(tmpDb, { force: true });
    fs.rmSync(documentosDir, { recursive: true, force: true });
  }
}

main().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
