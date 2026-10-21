/**
 * Testes da autenticação em um SQLite temporário.
 * Não usa o banco real nem a senha da operação.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const bcrypt = require('bcryptjs');
const { DatabaseSync } = require('node:sqlite');

const PORT = 3217;
const SENHA = 'senha-de-teste-local';
const tmpDb = path.join(os.tmpdir(), 'candyli-auth-' + Date.now() + '.sqlite');
const root = path.join(__dirname, '..');
let servidor;

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function pedir(method, urlPath, opcoes) {
  opcoes = opcoes || {};
  return new Promise((resolve, reject) => {
    const data = opcoes.body == null ? null : JSON.stringify(opcoes.body);
    const headers = {};
    if (data) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(data);
    }
    if (opcoes.cookie) headers.Cookie = opcoes.cookie;
    if (opcoes.csrf) headers['X-CSRF-Token'] = opcoes.csrf;
    if (opcoes.origin) headers.Origin = opcoes.origin;
    const req = http.request({
      hostname: '127.0.0.1',
      port: PORT,
      path: urlPath,
      method: method,
      headers: headers
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks).toString('utf8')
        });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function cookieDe(res) {
  const cru = res.headers['set-cookie'];
  const lista = Array.isArray(cru) ? cru : cru ? [cru] : [];
  const linha = lista.find((item) => item.indexOf('cl_sessao=') === 0);
  if (!linha) return '';
  return linha.split(';')[0];
}

function subir(extra) {
  return new Promise((resolve, reject) => {
    servidor = spawn(process.execPath, ['server.js'], {
      cwd: root,
      env: Object.assign({}, process.env, {
        PORT: String(PORT),
        DATABASE_PATH: tmpDb,
        COOKIE_SECURE: '0'
      }, extra || {}),
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let saida = '';
    const timer = setTimeout(() => reject(new Error('Servidor de teste não subiu')), 8000);
    function ouvir(buf) {
      saida += buf.toString();
      if (saida.indexOf('localhost:' + PORT) !== -1) {
        clearTimeout(timer);
        resolve();
      }
    }
    servidor.stdout.on('data', ouvir);
    servidor.stderr.on('data', ouvir);
    servidor.on('exit', (code) => {
      if (code) reject(new Error('Servidor encerrou com código ' + code + '\n' + saida));
    });
  });
}

function derrubar() {
  return new Promise((resolve) => {
    if (!servidor || servidor.killed) return resolve();
    servidor.once('exit', () => resolve());
    servidor.kill();
  });
}

function criarUsuario() {
  const db = new DatabaseSync(tmpDb);
  db.exec('PRAGMA busy_timeout = 5000');
  const hash = bcrypt.hashSync(SENHA, 12);
  db.prepare('INSERT INTO admin_usuarios (usuario, senha_hash) VALUES (?, ?)').run('admin', hash);
  const row = db.prepare('SELECT senha_hash FROM admin_usuarios WHERE usuario = ?').get('admin');
  db.close();
  assert(row.senha_hash !== SENHA && row.senha_hash.indexOf(SENHA) === -1, 'hash não pode conter a senha');
}

async function main() {
  fs.rmSync(tmpDb, { force: true });
  await subir();
  criarUsuario();

  const ruim = await pedir('POST', '/api/auth/login', { body: { senha: 'errada-demais' } });
  assert(ruim.status === 401, 'senha errada deveria ser 401, veio ' + ruim.status);
  assert(!ruim.headers['set-cookie'], 'senha errada não pode gravar cookie');
  assert(ruim.body.indexOf(SENHA) === -1, 'resposta não pode ecoar senha');

  const bom = await pedir('POST', '/api/auth/login', { body: { senha: SENHA } });
  assert(bom.status === 200, 'login correto deveria ser 200, veio ' + bom.status);
  const cookie = cookieDe(bom);
  const dados = JSON.parse(bom.body);
  assert(cookie.indexOf('cl_sessao=') === 0, 'cookie de sessão ausente');
  assert(cookie.indexOf('HttpOnly') === -1, 'o valor enviado de volta não é o atributo; o token veio');
  assert(dados.csrfToken && dados.csrfToken.length > 20, 'csrf ausente');
  assert(bom.body.indexOf(SENHA) === -1, 'login não pode devolver a senha');
  const setCookie = String(bom.headers['set-cookie']);
  assert(/HttpOnly/i.test(setCookie), 'cookie sem HttpOnly');
  assert(/SameSite=Lax/i.test(setCookie), 'cookie sem SameSite');
  assert(!/;\s*Secure/i.test(setCookie), 'HTTP local não deve marcar Secure');

  const listaFechada = await pedir('GET', '/api/orcamentos');
  assert(listaFechada.status === 401, 'lista sem sessão deveria ser 401');

  const listaAberta = await pedir('GET', '/api/orcamentos', { cookie: cookie });
  assert(listaAberta.status === 200, 'lista com sessão deveria ser 200');

  const catalogo = await pedir('GET', '/api/produtos');
  assert(catalogo.status === 200, 'catálogo público deveria ser 200');
  const gravaProduto = await pedir('POST', '/api/produtos', { body: { nome: 'nao-deve-entrar' } });
  assert(gravaProduto.status === 401, 'alterar produto sem sessão deveria ser 401');

  const criado = await pedir('POST', '/api/orcamentos', {
    body: { id: 880001, cliente: 'Cliente Teste', itens: [] }
  });
  assert(criado.status === 201, 'cliente deveria conseguir enviar orçamento, veio ' + criado.status);

  const origemRuim = await pedir('POST', '/api/orcamentos', {
    body: { id: 880002, cliente: 'Outro', itens: [] },
    origin: 'http://evil.test'
  });
  assert(origemRuim.status === 403, 'origem estranha no orçamento deveria ser 403');

  const patchSemToken = await pedir('PATCH', '/api/orcamentos/880001', {
    cookie: cookie,
    body: { observacoes: 'nao' }
  });
  assert(patchSemToken.status === 403, 'alteração sem CSRF deveria ser 403');

  const patchTokenErrado = await pedir('PATCH', '/api/orcamentos/880001', {
    cookie: cookie,
    csrf: 'token-invalido-de-teste',
    body: { observacoes: 'nao' }
  });
  assert(patchTokenErrado.status === 403, 'CSRF errado deveria ser 403');

  const patchOrigemRuim = await pedir('PATCH', '/api/orcamentos/880001', {
    cookie: cookie,
    csrf: dados.csrfToken,
    origin: 'http://evil.test',
    body: { observacoes: 'nao' }
  });
  assert(patchOrigemRuim.status === 403, 'origem estranha na alteração deveria ser 403');

  const patchComToken = await pedir('PATCH', '/api/orcamentos/880001', {
    cookie: cookie,
    csrf: dados.csrfToken,
    body: { observacoes: 'ajuste de teste' }
  });
  assert(patchComToken.status === 200, 'alteração com CSRF deveria ser 200, veio ' + patchComToken.status);

  const itemFechado = await pedir('GET', '/api/orcamentos/880001');
  assert(itemFechado.status === 401, 'orçamento individual sem sessão deveria ser 401');
  const apagaFechado = await pedir('DELETE', '/api/orcamentos/880001');
  assert(apagaFechado.status === 401, 'apagar orçamento sem sessão deveria ser 401');
  const categoriaFechada = await pedir('POST', '/api/categorias', { body: { nome: 'nao' } });
  assert(categoriaFechada.status === 401, 'criar categoria sem sessão deveria ser 401');

  const gestaoFechada = await pedir('GET', '/admin/gestao/index.html');
  assert(gestaoFechada.status === 302, 'gestão sem sessão deveria redirecionar');
  const loginPublico = await pedir('GET', '/admin/');
  assert(loginPublico.status === 200, 'tela de login deveria abrir');
  const detalheFechado = await pedir('GET', '/admin/orcamento.html');
  assert(detalheFechado.status === 302, 'detalhe sem sessão deveria redirecionar');
  const dashboardFechado = await pedir('GET', '/admin/dashboard/index.html');
  assert(dashboardFechado.status === 302, 'dashboard sem sessão deveria redirecionar');
  const adminMaiusculo = await pedir('GET', '/Admin/dashboard/index.html');
  assert(adminMaiusculo.status === 302, 'caminho com maiúsculas não pode abrir o painel');
  const gestaoAberta = await pedir('GET', '/admin/gestao/index.html', { cookie: cookie });
  assert(gestaoAberta.status === 200, 'gestão com sessão deveria abrir');
  const detalheAberto = await pedir('GET', '/admin/orcamento.html', { cookie: cookie });
  assert(detalheAberto.status === 200, 'detalhe com sessão deveria abrir');

  const sensiveis = [
    '/database/database.sqlite',
    '/database/database.sqlite-wal',
    '/database/migrations/002_admin_auth.sql',
    '/database/migrations/001_initial.sql',
    '/database/schema.sql',
    '/server/auth.js',
    '/scripts/criar-admin.js',
    '/.env',
    '/.git/config',
    '/node_modules/bcryptjs/package.json'
  ];
  for (let i = 0; i < sensiveis.length; i++) {
    const bloqueado = await pedir('GET', sensiveis[i]);
    assert(bloqueado.status === 404, sensiveis[i] + ' deveria ser 404, veio ' + bloqueado.status);
    assert(bloqueado.body.indexOf('SQLite format') === -1, 'conteúdo de banco foi entregue');
  }
  const pastaBackups = path.join(root, 'database', 'backups');
  if (fs.existsSync(pastaBackups)) {
    const copias = fs.readdirSync(pastaBackups).filter((nome) => nome.endsWith('.sqlite'));
    for (let i = 0; i < copias.length; i++) {
      const backup = await pedir('GET', '/database/backups/' + encodeURIComponent(copias[i]));
      assert(backup.status === 404, 'backup deveria ser 404');
      assert(backup.body.length < 300, 'backup devolveu conteúdo');
    }
  }

  const home = await pedir('GET', '/');
  assert(home.status === 200 && home.body.indexOf('Candy Li') !== -1, 'cardápio público falhou');
  const linha = await pedir('GET', '/pages/linha-classica.html');
  assert(linha.status === 200 && linha.body.indexOf('P\u00e9rola Negra') !== -1, 'página do cardápio falhou');
  const pdf = await pedir('GET', '/js/contrato-pdf.js');
  assert(pdf.status === 200 && pdf.body.indexOf('gerarContratoPDF') !== -1, 'gerador de contrato indisponível');
  const config = await pedir('GET', '/js/config.js');
  assert(config.status === 200, 'config.js indisponível');
  assert(config.body.indexOf('senhaAdmin') === -1, 'senhaAdmin ainda está no frontend');
  assert(!/Candyli\d+/.test(config.body), 'senha ainda aparece em config.js');
  const comum = await pedir('GET', '/js/admin-common.js');
  assert(comum.status === 200, 'admin-common indisponível');
  assert(comum.body.indexOf('sessionStorage') === -1, 'login antigo ainda usa sessionStorage');
  assert(comum.body.indexOf('senhaAdmin') === -1, 'admin-common ainda conhece a senha');

  const logoutSemCsrf = await pedir('POST', '/api/auth/logout', { cookie: cookie });
  assert(logoutSemCsrf.status === 403, 'logout sem CSRF deveria ser 403');
  const ainda = await pedir('GET', '/api/orcamentos', { cookie: cookie });
  assert(ainda.status === 200, 'logout sem CSRF não pode invalidar a sessão');

  const saiu = await pedir('POST', '/api/auth/logout', { cookie: cookie, csrf: dados.csrfToken });
  assert(saiu.status === 200, 'logout deveria ser 200');
  const depois = await pedir('GET', '/api/orcamentos', { cookie: cookie });
  assert(depois.status === 401, 'sessão deveria morrer no logout');

  const deNovo = await pedir('POST', '/api/auth/login', { body: { senha: SENHA } });
  const cookie2 = cookieDe(deNovo);
  await derrubar();
  await subir();
  const aposReinicio = await pedir('GET', '/api/auth/sessao', { cookie: cookie2 });
  const sessao = JSON.parse(aposReinicio.body);
  assert(sessao.autenticado === true, 'sessão deveria sobreviver ao reinício');

  const db = new DatabaseSync(tmpDb);
  db.exec('PRAGMA busy_timeout = 5000');
  db.prepare('UPDATE admin_sessoes SET expira_em = ?').run(new Date(Date.now() - 1000).toISOString());
  db.close();
  const vencida = await pedir('GET', '/api/orcamentos', { cookie: cookie2 });
  assert(vencida.status === 401, 'sessão vencida deveria ser recusada');

  await derrubar();
  await subir({ COOKIE_SECURE: '1' });
  const loginSeguro = await pedir('POST', '/api/auth/login', { body: { senha: SENHA } });
  assert(loginSeguro.status === 200, 'login com COOKIE_SECURE=1 deveria ser 200');
  const cookieSeguro = String(loginSeguro.headers['set-cookie']);
  assert(/HttpOnly/i.test(cookieSeguro) && /SameSite=Lax/i.test(cookieSeguro), 'cookie seguro perdeu HttpOnly ou SameSite');
  assert(/;\s*Secure/i.test(cookieSeguro), 'COOKIE_SECURE=1 deveria marcar Secure');
  await derrubar();
  await subir();

  let ultimo = 0;
  for (let i = 0; i < 5; i++) {
    const tentativa = await pedir('POST', '/api/auth/login', { body: { senha: 'errada-demais' } });
    ultimo = tentativa.status;
  }
  assert(ultimo === 429, 'excesso de tentativas deveria ser 429, veio ' + ultimo);
  const bloqueado = await pedir('POST', '/api/auth/login', { body: { senha: SENHA } });
  assert(bloqueado.status === 429, 'conta bloqueada deveria continuar 429');

  console.log('Testes de autenticação passaram.');
}

main()
  .catch((e) => {
    console.error(e && e.stack ? e.stack : e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await derrubar();
    fs.rmSync(tmpDb, { force: true });
    fs.rmSync(tmpDb + '-wal', { force: true });
    fs.rmSync(tmpDb + '-shm', { force: true });
  });
