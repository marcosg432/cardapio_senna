/**
 * Agenda, Financeiro e Produção leem a mesma data.
 * Uma data principal inválida usa a alternativa. O JSON gravado não muda.
 * Banco temporário. O banco do projeto só é lido para conferir que não mudou.
 */
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const root = path.join(__dirname, "..");
const realDb = path.join(root, "database", "database.sqlite");
const tmpDb = path.join(os.tmpdir(), "candyli-data-evento-" + Date.now() + ".sqlite");

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function hashArquivo(arquivo) {
  if (!fs.existsSync(arquivo)) return null;
  return crypto.createHash("sha256").update(fs.readFileSync(arquivo)).digest("hex");
}

function assinaturaReal() {
  return {
    db: hashArquivo(realDb),
    wal: hashArquivo(realDb + "-wal"),
    shm: hashArquivo(realDb + "-shm")
  };
}

function isoAgenda(orcamento) {
  const data = GestaoConsulta.dataEvento(orcamento);
  return data ? data.iso : null;
}

const casos = [
  { nome: "principal valida", orcamento: { data_evento: "2026-11-01", evento_data: "2026-12-02" }, iso: "2026-11-01" },
  { nome: "principal invalida", orcamento: { data_evento: "2026-02-31", evento_data: "2026-12-15" }, iso: "2026-12-15" },
  { nome: "principal texto", orcamento: { data_evento: "amanha", evento_data: "2026-07-01" }, iso: "2026-07-01" },
  { nome: "principal ausente", orcamento: { evento_data: "2026-08-02" }, iso: "2026-08-02" },
  { nome: "alternativa ausente", orcamento: { data_evento: "2026-09-03" }, iso: "2026-09-03" },
  { nome: "ambas ausentes", orcamento: {}, iso: null },
  { nome: "ambas invalidas", orcamento: { data_evento: "2026-13-40", evento_data: "31/12/2026" }, iso: null },
  { nome: "alternativa invalida", orcamento: { data_evento: "2026-10-04", evento_data: "2026-02-31" }, iso: "2026-10-04" },
  { nome: "espacos", orcamento: { data_evento: " 2026-06-05 ", evento_data: "2026-01-01" }, iso: "2026-06-05" }
];

async function main() {
  const antes = assinaturaReal();
  casos.forEach((caso) => {
    const copia = JSON.stringify(caso.orcamento);
    assert(datas.dataEventoIso(caso.orcamento) === caso.iso, "servidor " + caso.nome);
    assert(isoAgenda(caso.orcamento) === caso.iso, "agenda " + caso.nome);
    assert(JSON.stringify(caso.orcamento) === copia, "alterou " + caso.nome);
  });

  process.env.DATABASE_PATH = tmpDb;
  fs.rmSync(tmpDb, { force: true });
  const db = getDb();
  const invalida = {
    id: 770101,
    cliente: "Data Reserva",
    nome_cliente: "Data Reserva",
    data_evento: "2026-02-31",
    evento_data: "2026-12-15",
    itens: [{ nome: "Brigadeiro", quantidade: 50, unidade: "unidade", preco: 2, preco_unitario: 2, subtotal: 100 }],
    valor_final: 100,
    gestao_contrato: { status: "confirmado", confirmado_em: "2026-01-01T00:00:00.000Z" }
  };
  const ausente = {
    id: 770102,
    cliente: "Sem Data",
    nome_cliente: "Sem Data",
    itens: [{ nome: "Brigadeiro", quantidade: 40, unidade: "unidade", preco: 2, preco_unitario: 2, subtotal: 80 }],
    valor_final: 80,
    gestao_contrato: { status: "confirmado", confirmado_em: "2026-01-02T00:00:00.000Z" }
  };
  const agora = "2026-01-01T00:00:00.000Z";
  const inserir = db.prepare("INSERT INTO orcamentos (id, payload, created_at, updated_at) VALUES (?, ?, ?, ?)");
  inserir.run(invalida.id, JSON.stringify(invalida), agora, agora);
  inserir.run(ausente.id, JSON.stringify(ausente), agora, agora);
  const textoAntes = db.prepare("SELECT payload FROM orcamentos WHERE id = 770101").get().payload;

  const contratos = financeiro.listarContratos().contratos;
  const eventos = producao.listarEventos().eventos;
  const contrato = contratos.find((item) => item.id === 770101);
  const semData = contratos.find((item) => item.id === 770102);
  const evento = eventos.find((item) => item.id === 770101);
  const eventoSem = eventos.find((item) => item.id === 770102);
  const ficha = producao.detalhar(770101);
  assert(contrato && contrato.data_evento === "2026-12-15", "financeiro " + JSON.stringify(contrato && contrato.data_evento));
  assert(semData && semData.data_evento === null, "financeiro sem data");
  assert(evento && evento.data_evento === "2026-12-15", "producao " + JSON.stringify(evento && evento.data_evento));
  assert(eventoSem && eventoSem.data_evento === null, "producao sem data");
  assert(ficha.status === 200 && ficha.evento.itens[0].quantidade === 50, "quantidade da producao");
  const textoDepois = db.prepare("SELECT payload FROM orcamentos WHERE id = 770101").get().payload;
  assert(textoDepois === textoAntes, "payload da data foi gravado de novo");
  assert(JSON.parse(textoDepois).data_evento === "2026-02-31", "data original");
  assert(JSON.parse(textoDepois).evento_data === "2026-12-15", "data alternativa");
  assert(db.prepare("SELECT COUNT(*) AS n FROM financeiro_contratos").get().n === 0, "leitura congelou valor");
  assert(db.prepare("SELECT COUNT(*) AS n FROM pagamentos").get().n === 0, "leitura criou pagamento");
  closeDb();

  const depois = assinaturaReal();
  assert(JSON.stringify(antes) === JSON.stringify(depois), "banco real alterado");
  console.log(JSON.stringify({ ok: true, casos: casos.length, financeiro: "2026-12-15", producao: "2026-12-15", bancoReal: "intacto" }));
}

const datas = require("../database/dataEvento");
const GestaoConsulta = require("../js/gestao/consulta");
process.env.DATABASE_PATH = tmpDb;
const { getDb, closeDb } = require("../database/db");
const financeiro = require("../database/repositories/financeiroRepository");
const producao = require("../database/repositories/producaoRepository");

main()
  .catch((e) => { console.error(e && e.stack ? e.stack : e); process.exitCode = 1; })
  .finally(() => {
    try { closeDb(); } catch (e) { /* o banco pode não ter sido aberto */ }
    fs.rmSync(tmpDb, { force: true });
    fs.rmSync(tmpDb + "-wal", { force: true });
    fs.rmSync(tmpDb + "-shm", { force: true });
  });
