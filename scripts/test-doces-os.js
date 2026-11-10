/**
 * Totais de doces e ordem de serviço individual.
 * Gravações ficam num SQLite temporário. O banco real só é lido.
 */
const { spawn } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const zlib = require("zlib");
const bcrypt = require("bcryptjs");
const { DatabaseSync } = require("node:sqlite");
const doces = require("../js/doces-quantidade");

const PORT = 3319;
const SENHA = "senha-de-teste-local";
const root = path.join(__dirname, "..");
const dbReal = path.join(root, "database", "database.sqlite");
const migracao = path.join(root, "database", "migrations", "005_financeiro_operacao.sql");
const tmpDb = path.join(os.tmpdir(), "candyli-doces-os-" + Date.now() + ".sqlite");
let servidor;

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function assinaturaReal() {
  const db = new DatabaseSync(dbReal, { readOnly: true });
  const rows = db.prepare("SELECT id, payload FROM orcamentos ORDER BY id").all();
  const pagamentos = db.prepare("SELECT id, orcamento_id, valor_centavos, pago_em, forma FROM pagamentos ORDER BY id").all();
  const migracoes = db.prepare("SELECT name FROM schema_migrations ORDER BY name").all().map((row) => row.name);
  db.close();
  return {
    hash: crypto.createHash("sha256").update(rows.map((row) => row.id + ":" + row.payload).join("|")).digest("hex"),
    n: rows.length,
    pagamentos: pagamentos,
    migracoes: migracoes
  };
}

function hashArquivo(arquivo) {
  return crypto.createHash("sha256").update(fs.readFileSync(arquivo)).digest("hex");
}

function pedir(method, urlPath, opcoes) {
  opcoes = opcoes || {};
  return new Promise((resolve, reject) => {
    const data = opcoes.body == null ? null : JSON.stringify(opcoes.body);
    const headers = {};
    if (data) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = Buffer.byteLength(data);
    }
    if (opcoes.cookie) headers.Cookie = opcoes.cookie;
    const req = http.request({
      hostname: "127.0.0.1",
      port: PORT,
      path: urlPath,
      method: method,
      headers: headers
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const buf = Buffer.concat(chunks);
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: opcoes.binario ? buf : buf.toString("utf8")
        });
      });
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

function subir() {
  return new Promise((resolve, reject) => {
    servidor = spawn(process.execPath, ["server.js"], {
      cwd: root,
      env: Object.assign({}, process.env, {
        PORT: String(PORT),
        DATABASE_PATH: tmpDb,
        COOKIE_SECURE: "0"
      }),
      stdio: ["ignore", "pipe", "pipe"]
    });
    let saida = "";
    const timer = setTimeout(() => reject(new Error("servidor nao subiu " + saida)), 8000);
    const ouvir = (buf) => {
      saida += buf.toString();
      if (saida.indexOf("localhost:" + PORT) !== -1) {
        clearTimeout(timer);
        resolve();
      }
    };
    servidor.stdout.on("data", ouvir);
    servidor.stderr.on("data", ouvir);
  });
}

function derrubar() {
  return new Promise((resolve) => {
    if (!servidor || servidor.killed) return resolve();
    servidor.once("exit", () => resolve());
    servidor.kill();
  });
}

function textoPdf(buffer) {
  const cru = buffer.toString("latin1");
  let texto = cru;
  for (const marca of cru.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    try { texto += zlib.inflateSync(Buffer.from(marca[1], "latin1")).toString("latin1"); } catch (e) { /* sem compressão */ }
  }
  return texto;
}

function item(nome, quantidade, unidade, preco) {
  const linha = {
    nome: nome,
    quantidade: quantidade,
    preco: preco,
    preco_unitario: preco,
    subtotal: (Number(quantidade) || 0) * preco
  };
  if (unidade !== undefined) linha.unidade = unidade;
  return linha;
}

function testarSoma() {
  const antigo = doces.totalDocesPedido([
    { nome: "Brigadeiro gourmet", quantidade: 51 },
    { nome: "Bem-casado", quantidade: 50, unidade: "" },
    { nome: "Taxa de entrega", quantidade: 1 },
    { nome: "Serviço de garçom", quantidade: 2, unidade: "unidade" },
    { nome: "Locação de suportes", quantidade: 1, unidade: "unidade" },
    { nome: "Frete", quantidade: 1, unidade: "unidade" }
  ]);
  assert(antigo.total === 101 && antigo.parcial === false && antigo.pendencias.length === 0, "pedido antigo " + JSON.stringify(antigo));

  const novo = doces.totalDocesPedido([
    { nome: "Pacote aniversário", quantidade: 2, unidade: "cento" },
    { nome: "Brigadeiro", quantidade: 40, unidade: "unidade" },
    { nome: "Pacote simples", quantidade: 1, unidade: "pacote" },
    { nome: "Doce em caixa", quantidade: 3, unidade: "kg" },
    { nome: "Aluguel de bandeja", quantidade: 1, unidade: "unidade" }
  ]);
  assert(novo.total === 240 && novo.parcial === true, "pedido novo " + JSON.stringify(novo));
  assert(novo.pendencias.length === 2, "pendências do pacote e do quilo");
  assert(novo.pendencias.some((item) => item.nome === "Pacote simples" && item.motivo.indexOf("equivalência") !== -1), "pacote pendente");
  assert(novo.pendencias.some((item) => item.nome === "Doce em caixa" && item.motivo.indexOf("incompatível") !== -1), "quilo pendente");
  assert(novo.texto.indexOf("600") === -1 && novo.texto.indexOf("(parcial)") !== -1, "pacote sem quantidade fictícia");

  const exemplo = doces.totalDocesPedido([
    { nome: "Brigadeiro", quantidade: 2, unidade: "cento" },
    { nome: "Bem-casado", quantidade: 40, unidade: "unidade" },
    { nome: "Bolo de corte", quantidade: 1 }
  ]);
  assert(exemplo.total === 240 && exemplo.parcial === true && exemplo.pendencias.some((item) => item.nome === "Bolo de corte"), "exemplo do bolo " + JSON.stringify(exemplo));

  const formas = doces.totalDocesPedido([
    { nome: "Camafeu", quantidade: 10 },
    { nome: "Bombom Bueno", quantidade: 8, unidade: "" },
    { nome: "Copinho de floresta negra", quantidade: 6, unidade: "unidade" },
    { nome: "Tortinha de limão", quantidade: 12 },
    { nome: "Minitortinha de limão", quantidade: 4 },
    { nome: "Mini torta de limão", quantidade: 3, unidade: "unidade" },
    { nome: "Mini cheesecake maracujá com chocolate", quantidade: 5 },
    { nome: "Flor Folhada de Cheesecake", quantidade: 2, unidade: "unidade" },
    { nome: "Caixinha de maracujá", quantidade: 7 },
    { nome: "Torta de chocolate", quantidade: 1, unidade: "unidade" },
    { nome: "Cheesecake de frutas vermelhas", quantidade: 1 },
    { nome: "Sobremesa na travessa", quantidade: 1 },
    { nome: "Kit festa", quantidade: 1, unidade: "unidade" },
    { nome: "Caixinha 4 doces finos", quantidade: 2 },
    { nome: "Caixinha 15 doces tradicionais", quantidade: 1, unidade: "unidade" },
    { nome: "Bolo de brigadeiro", quantidade: 1, unidade: "unidade" }
  ]);
  assert(formas.total === 10 + 8 + 6 + 12 + 4 + 3 + 5 + 2 + 7, "docinhos individuais " + JSON.stringify(formas));
  ["Torta de chocolate", "Cheesecake de frutas vermelhas", "Sobremesa na travessa", "Kit festa", "Caixinha 4 doces finos", "Caixinha 15 doces tradicionais", "Bolo de brigadeiro"].forEach((nome) => {
    assert(formas.pendencias.some((item) => item.nome === nome), "pendência " + nome);
  });
  assert(formas.texto.indexOf("15") === -1 || formas.total !== 15, "caixinha sem quantidade do nome");
  assert(!formas.pendencias.some((item) => item.nome === "Caixinha de maracujá" || item.nome === "Tortinha de limão" || item.nome === "Minitortinha de limão"), "docinho preservado");
}

async function main() {
  testarSoma();
  const antes = assinaturaReal();
  const hashMigracao = hashArquivo(migracao);
  fs.rmSync(tmpDb, { force: true });
  await subir();
  const db = new DatabaseSync(tmpDb);
  db.prepare("INSERT INTO admin_usuarios (usuario, senha_hash) VALUES (?, ?)").run("admin", bcrypt.hashSync(SENHA, 12));
  function gravar(orcamento) {
    db.prepare("INSERT INTO orcamentos (id, payload, created_at, updated_at) VALUES (?, ?, ?, ?)").run(
      orcamento.id, JSON.stringify(orcamento), "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z"
    );
  }
  gravar({
    id: 880001,
    nome_cliente: "Pedido Antigo",
    tipo_evento: "Aniversário",
    data_evento: "2026-11-10",
    evento_data: "2026-11-10",
    valor_final: 374,
    total: 374,
    itens: [
      item("Brigadeiro gourmet", 51, undefined, 4),
      item("Bem-casado", 50, "", 3),
      item("Taxa de entrega", 1, undefined, 20)
    ],
    gestao_contrato: { status: "confirmado", confirmado_em: "2026-11-01T12:00:00.000Z" }
  });
  gravar({
    id: 880002,
    nome_cliente: "Pedido Novo",
    tipo_evento: "Casamento",
    data_evento: "2026-11-12",
    evento_data: "2026-11-12",
    valor_final: 500,
    total: 500,
    itens: [
      item("Pacote aniversário", 2, "cento", 150),
      item("Brigadeiro", 40, "unidade", 4),
      item("Pacote simples", 1, "pacote", 1200),
      item("Locação de suportes", 1, "unidade", 80)
    ],
    gestao_contrato: { status: "confirmado", confirmado_em: "2026-11-02T12:00:00.000Z" }
  });
  gravar({
    id: 880003,
    nome_cliente: "Ainda Negociacao",
    tipo_evento: "Batizado",
    data_evento: "2026-11-10",
    evento_data: "2026-11-10",
    status: "contrato_gerado",
    valor_final: 80,
    total: 80,
    itens: [item("Brigadeiro", 10, undefined, 8)],
    contrato: { status: "emitido", valor_final: 80 }
  });
  const payloads = db.prepare("SELECT id, payload FROM orcamentos ORDER BY id").all();
  const financeiroAntes = db.prepare("SELECT COUNT(*) AS n FROM financeiro_contratos").get().n;
  const pagamentosAntes = db.prepare("SELECT COUNT(*) AS n FROM pagamentos").get().n;
  db.close();

  const login = await pedir("POST", "/api/auth/login", { body: { senha: SENHA } });
  assert(login.status === 200, "login");
  const cookie = String(login.headers["set-cookie"]).split(";")[0];
  const sessao = { cookie: cookie };
  const lista = JSON.parse((await pedir("GET", "/api/producao/eventos", sessao)).body);
  const porId = {};
  lista.eventos.forEach((evento) => { porId[evento.id] = evento; });
  assert(porId[880001].doces_total === 101 && porId[880001].doces_parcial === false, "contrato antigo " + JSON.stringify(porId[880001]));
  assert(porId[880002].doces_total === 240 && porId[880002].doces_parcial === true, "contrato novo " + JSON.stringify(porId[880002]));
  assert(!porId[880003], "negociação fora da produção");

  const diaAntigo = JSON.parse((await pedir("GET", "/api/producao/datas/2026-11-10", sessao)).body);
  assert(diaAntigo.doces_total === 101 && diaAntigo.doces_parcial === false && diaAntigo.eventos.length === 1 && diaAntigo.eventos[0].id === 880001, "dia antigo");
  const diaNovo = JSON.parse((await pedir("GET", "/api/producao/datas/2026-11-12", sessao)).body);
  assert(diaNovo.doces_total === 240 && diaNovo.doces_parcial === true && diaNovo.eventos.length === 1, "dia novo");
  const semana = JSON.parse((await pedir("GET", "/api/producao/periodo?de=2026-11-09&ate=2026-11-15&visao=definitiva", sessao)).body);
  assert(semana.doces_total === 341 && semana.doces_parcial === true && semana.eventos.length === 2, "semana " + semana.doces_total);

  const fichaAntiga = await pedir("GET", "/api/producao/eventos/880001/pdf", Object.assign({ binario: true }, sessao));
  const fichaNova = await pedir("GET", "/api/producao/eventos/880002/pdf", Object.assign({ binario: true }, sessao));
  const resumoDia = await pedir("GET", "/api/producao/datas/2026-11-10/pdf", Object.assign({ binario: true }, sessao));
  assert(fichaAntiga.status === 200 && fichaNova.status === 200 && resumoDia.status === 200, "pdfs");
  const textoAntigo = textoPdf(fichaAntiga.body);
  const textoNovo = textoPdf(fichaNova.body);
  const textoDia = textoPdf(resumoDia.body);
  assert(textoAntigo.indexOf("Ordem de Serviço") !== -1 && textoAntigo.indexOf("880001") !== -1 && textoAntigo.indexOf("880002") === -1 && textoAntigo.indexOf("880003") === -1, "os antiga isolada");
  assert(textoAntigo.indexOf("101") !== -1 && textoAntigo.indexOf("(parcial)") === -1, "total da os antiga");
  assert(textoNovo.indexOf("Ordem de Serviço") !== -1 && textoNovo.indexOf("880002") !== -1 && textoNovo.indexOf("880001") === -1, "os nova isolada");
  assert(textoNovo.indexOf("240") !== -1 && textoNovo.indexOf("parcial") !== -1 && textoNovo.indexOf("840") === -1 && textoNovo.indexOf("600 doces") === -1, "total parcial da os nova");
  assert(textoDia.indexOf("Produção do dia") !== -1 && textoDia.indexOf("880001") !== -1 && textoDia.indexOf("880002") === -1 && textoDia.indexOf("Ainda Negociacao") === -1, "resumo do dia separado");

  const negado = await pedir("GET", "/api/producao/eventos/880003/pdf", sessao);
  assert(negado.status === 409 && negado.body.indexOf("confirmar o contrato") !== -1, "mensagem de confirmação " + negado.body);
  const pagina = await pedir("GET", "/admin/gestao/producao.html", sessao);
  const script = await pedir("GET", "/js/gestao/producao.js", sessao);
  assert(pagina.status === 200 && pagina.body.indexOf("Gerar Ordem de Serviço") !== -1 && pagina.body.indexOf("id=\"producao-detalhe-os\"") !== -1, "botão na ficha");
  assert(script.status === 200 && script.body.indexOf("Gerar Ordem de Serviço") !== -1 && script.body.indexOf("Gerar ficha para consulta") === -1, "rótulo da tabela");

  const dbDepois = new DatabaseSync(tmpDb, { readOnly: true });
  const payloadsDepois = dbDepois.prepare("SELECT id, payload FROM orcamentos ORDER BY id").all();
  const financeiroDepois = dbDepois.prepare("SELECT COUNT(*) AS n FROM financeiro_contratos").get().n;
  const pagamentosDepois = dbDepois.prepare("SELECT COUNT(*) AS n FROM pagamentos").get().n;
  dbDepois.close();
  assert(JSON.stringify(payloadsDepois) === JSON.stringify(payloads), "payloads isolados");
  assert(financeiroAntes === 0 && financeiroDepois === 0 && pagamentosAntes === 0 && pagamentosDepois === 0, "financeiro isolado");
  const pedido = JSON.parse(payloadsDepois.find((row) => row.id === 880003).payload);
  assert(pedido.status === "contrato_gerado" && !pedido.gestao_contrato && pedido.valor_final === 80, "negociação permanece");

  const depois = assinaturaReal();
  assert(depois.hash === antes.hash && depois.n === antes.n, "banco real");
  assert(JSON.stringify(depois.pagamentos) === JSON.stringify(antes.pagamentos), "pagamentos reais");
  assert(JSON.stringify(depois.migracoes) === JSON.stringify(antes.migracoes), "migrações reais");
  assert(hashArquivo(migracao) === hashMigracao, "arquivo da migração 005");
  console.log(JSON.stringify({
    ok: true,
    antigo: 101,
    novo: 240,
    semana: 341,
    os: ["880001", "880002"],
    financeiroIsolado: true
  }));
}

main().then(() => derrubar()).catch(async (erro) => {
  console.error(erro);
  await derrubar();
  process.exit(1);
});
