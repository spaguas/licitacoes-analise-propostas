// Monitor de segurança (estilo Wordfence): o que é registrado, bloqueio automático de IP,
// acesso local nunca bloqueado e senha nunca gravada no registro.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

let srv; let base; let s;
const ATACANTE = '203.0.113.7';
before(async () => {
  process.env.UPLOAD_DIR = mkdtempSync(path.join(tmpdir(), 'mon-'));
  const { config } = await import('../src/config.js');
  const { montar } = await import('../src/servidor.js');
  const { criarRepositorioMemoria } = await import('../src/db/repositorio.js');
  const { criarServidorHttp } = await import('../src/http/rotas.js');
  const cfg = { ...config, adminEmail: 'admin@spaguas.sp.gov.br', adminSenhaInicial: 'SenhaAdmin123' };
  s = await montar({ repo: criarRepositorioMemoria(), chat: async () => ({ conteudo: '{}' }), pdfWorker: {}, cfg });
  srv = criarServidorHttp({ app: s.app, config: cfg, seguranca: s.seguranca }).listen(0);
  base = `http://localhost:${srv.address().port}`;
});
after(() => srv?.close());

async function chamar(metodo, caminho, { token, corpo, ip } = {}) {
  const r = await fetch(`${base}${caminho}`, {
    method: metodo,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(corpo ? { 'Content-Type': 'application/json' } : {}), ...(ip ? { 'X-Forwarded-For': ip } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const t = r.headers.get('content-type') || '';
  return { status: r.status, corpo: t.includes('json') ? await r.json() : await r.text() };
}
const admin = async () => (await chamar('POST', '/api/login', { corpo: { email: 'admin@spaguas.sp.gov.br', senha: 'SenhaAdmin123' } })).corpo.token;
const eventos = async (token, filtro = '') => (await chamar('GET', `/api/seguranca/eventos${filtro}`, { token })).corpo;

test('acesso, senha errada e injeção no login ficam registrados — sem gravar a senha', async () => {
  const tk = await admin();
  await chamar('POST', '/api/login', { corpo: { email: 'admin@spaguas.sp.gov.br', senha: 'errada123' } });
  const inj = await chamar('POST', '/api/login', { ip: ATACANTE, corpo: { email: 'admin@spaguas.sp.gov.br', senha: "' OR '1'='1' --" } });
  assert.equal(inj.status, 400);
  const lista = await eventos(tk);
  assert.ok(lista.some((e) => e.tipo === 'login_ok' && e.email === 'admin@spaguas.sp.gov.br'));
  assert.ok(lista.some((e) => e.tipo === 'login_falhou'));
  const e = lista.find((x) => x.tipo === 'injecao');
  assert.equal(e.ip, ATACANTE);
  assert.equal(e.gravidade, 'alta');
  assert.match(e.detalhe, /SQL no campo "senha"/);
  assert.ok(!JSON.stringify(lista).includes("OR '1'='1"), 'o conteúdo da senha nunca pode ser gravado');
  assert.ok(!JSON.stringify(lista).includes('errada123'));
});

test('injeção na URL e robô de varredura', async () => {
  const tk = await admin();
  assert.equal((await chamar('GET', "/api/pregoes?ordem=1' UNION SELECT senha_hash FROM usuarios--", { token: tk, ip: '198.51.100.20' })).status, 400);
  assert.equal((await chamar('GET', '/wp-admin/install.php', { ip: '198.51.100.20' })).status, 404);
  assert.equal((await chamar('GET', '/.env', { ip: '198.51.100.20' })).status, 404);
  const lista = await eventos(tk, '?ip=198.51.100.20');
  assert.ok(lista.some((e) => e.tipo === 'injecao' && /no endereço/.test(e.detalhe)));
  assert.equal(lista.filter((e) => e.tipo === 'varredura').length, 2);
  // 3 eventos graves -> IP bloqueado automaticamente
  const r = await chamar('GET', '/api/saude', { ip: '198.51.100.20' });
  assert.equal(r.status, 200, '/api/saude continua respondendo');
  assert.equal((await chamar('POST', '/api/login', { ip: '198.51.100.20', corpo: { email: 'admin@spaguas.sp.gov.br', senha: 'SenhaAdmin123' } })).status, 403);
});

test('força bruta do mesmo IP bloqueia o IP; administrador vê e desbloqueia', async () => {
  const tk = await admin();
  for (let i = 0; i < 10; i += 1) {
    await chamar('POST', '/api/login', { ip: ATACANTE, corpo: { email: `usuario${i}@exemplo.com`, senha: `chute${i}` } });
  }
  assert.equal((await chamar('POST', '/api/login', { ip: ATACANTE, corpo: { email: 'admin@spaguas.sp.gov.br', senha: 'SenhaAdmin123' } })).status, 403, 'IP bloqueado');
  const resumo = (await chamar('GET', '/api/seguranca/resumo', { token: tk })).corpo;
  assert.ok(resumo.ultimas_24h.forca_bruta >= 1);
  const bloqueio = resumo.bloqueados.find((b) => b.ip === ATACANTE);
  assert.ok(bloqueio, 'IP do atacante na lista de bloqueados');
  assert.equal((await chamar('POST', `/api/seguranca/bloqueios/${bloqueio.id}/desbloquear`, { token: tk })).status, 200);
  await new Promise((r) => setTimeout(r, 50));
  assert.notEqual((await chamar('POST', '/api/login', { ip: ATACANTE, corpo: { email: 'x@exemplo.com', senha: 'x' } })).status, 403);
  // a auditoria registra o desbloqueio
  assert.ok((await eventos(tk, '?tipo=auditoria')).some((e) => /Desbloqueou o IP 203\.0\.113\.7/.test(e.detalhe)));
});

test('acesso local nunca é bloqueado automaticamente; bloqueio manual funciona', async () => {
  const tk = await admin();
  for (let i = 0; i < 12; i += 1) await chamar('POST', '/api/login', { corpo: { email: 'admin@spaguas.sp.gov.br', senha: "' or 1=1 --" } });
  assert.equal((await chamar('GET', '/api/pregoes', { token: tk })).status, 200, 'o computador local continua entrando');
  assert.equal((await chamar('POST', '/api/seguranca/bloqueios', { token: tk, corpo: { ip: '192.0.2.50', minutos: 30, motivo: 'teste' } })).status, 200);
  assert.equal((await chamar('GET', '/api/saude', { ip: '192.0.2.50' })).status, 200);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal((await chamar('GET', '/api/pregoes', { ip: '192.0.2.50', token: tk })).status, 403);
});

test('licitante: acesso indevido registrado e sem acesso ao painel de segurança', async () => {
  const tk = await admin();
  const lic = (await chamar('POST', '/api/usuarios', { token: tk, corpo: { nome: 'Lia', email: 'lia@exemplo.com', perfil: 'licitante' } })).corpo;
  let tl = (await chamar('POST', '/api/login', { corpo: { email: 'lia@exemplo.com', senha: lic.senha_temporaria } })).corpo.token;
  await chamar('POST', '/api/eu/senha', { token: tl, corpo: { atual: lic.senha_temporaria, nova: 'Pregao2026Ok' } });
  tl = (await chamar('POST', '/api/login', { corpo: { email: 'lia@exemplo.com', senha: 'Pregao2026Ok' } })).corpo.token;
  const doAdmin = (await chamar('POST', '/api/pregoes', { token: tk, corpo: { nome: 'Do admin' } })).corpo;
  assert.equal((await chamar('GET', `/api/pregoes/${doAdmin.id}`, { token: tl })).status, 404);
  assert.equal((await chamar('GET', '/api/seguranca/eventos', { token: tl })).status, 403);
  const lista = await eventos(tk);
  assert.ok(lista.some((e) => e.tipo === 'acesso_indevido' && e.email === 'lia@exemplo.com'));
  assert.ok(lista.some((e) => e.tipo === 'acesso_negado' && e.email === 'lia@exemplo.com'));
  assert.ok(lista.some((e) => e.tipo === 'auditoria' && /Criou o usuário lia@exemplo\.com/.test(e.detalhe)));
  const csv = (await chamar('GET', '/api/seguranca/eventos.csv', { token: tk })).corpo;
  assert.match(csv, /Acesso indevido/);
});
