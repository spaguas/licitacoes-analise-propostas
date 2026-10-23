// Testes de segurança pela API HTTP (como um invasor faria): perfis, dono do pregão,
// força bruta no login, senha temporária, usuário desativado, ids inválidos e injeções.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

let srv; let base; let s;
before(async () => {
  process.env.UPLOAD_DIR = mkdtempSync(path.join(tmpdir(), 'seg-'));
  const { config } = await import('../src/config.js');
  const { montar } = await import('../src/servidor.js');
  const { criarRepositorioMemoria } = await import('../src/db/repositorio.js');
  const { criarServidorHttp } = await import('../src/http/rotas.js');
  const pdfFalso = { analisarEdital: async () => ({}), analisarProposta: async () => ({}) };
  s = await montar({ repo: criarRepositorioMemoria(), chat: async () => ({ conteudo: '{}' }), pdfWorker: pdfFalso,
    cfg: { ...config, adminEmail: 'admin@spaguas.sp.gov.br', adminSenhaInicial: 'SenhaAdmin123' } });
  srv = criarServidorHttp({ app: s.app, config, seguranca: s.seguranca }).listen(0);
  base = `http://localhost:${srv.address().port}/api`;
});
after(() => srv?.close());

async function chamar(metodo, caminho, { token, corpo } = {}) {
  const r = await fetch(`${base}${caminho}`, {
    method: metodo,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(corpo ? { 'Content-Type': 'application/json' } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const tipo = r.headers.get('content-type') || '';
  return { status: r.status, corpo: tipo.includes('json') ? await r.json() : await r.text(), headers: r.headers };
}
const entrar = async (email, senha) => chamar('POST', '/login', { corpo: { email, senha } });

test('perfis, dono do pregão, senha temporária e desativação', async () => {
  const admin = (await entrar('admin@spaguas.sp.gov.br', 'SenhaAdmin123')).corpo.token;
  assert.ok(admin);

  // administrador cria dois licitantes (senha temporária mostrada uma única vez)
  const criarLic = async (email) => (await chamar('POST', '/usuarios', { token: admin, corpo: { nome: email, email, perfil: 'licitante' } })).corpo;
  const a = await criarLic('ana@exemplo.com');
  const b = await criarLic('bruno@exemplo.com');
  assert.match(a.senha_temporaria, /^\w{4}-\w{4}-\w{4}$/);

  // senha temporária: só deixa trocar a senha
  let tokA = (await entrar('ana@exemplo.com', a.senha_temporaria)).corpo.token;
  assert.equal((await chamar('GET', '/pregoes', { token: tokA })).status, 403);
  assert.equal((await chamar('POST', '/eu/senha', { token: tokA, corpo: { atual: a.senha_temporaria, nova: 'curta' } })).status, 400);
  assert.equal((await chamar('POST', '/eu/senha', { token: tokA, corpo: { atual: a.senha_temporaria, nova: 'NovaSenhaAna1' } })).status, 200);
  assert.equal((await chamar('GET', '/pregoes', { token: tokA })).status, 200);
  await chamar('POST', '/eu/senha', { token: (await entrar('bruno@exemplo.com', b.senha_temporaria)).corpo.token, corpo: { atual: b.senha_temporaria, nova: 'Pregao2026Seguro' } });
  const tokB = (await entrar('bruno@exemplo.com', 'Pregao2026Seguro')).corpo.token;

  // senha que contém o nome do e-mail é recusada
  assert.equal((await chamar('POST', '/eu/senha', { token: tokB, corpo: { atual: 'Pregao2026Seguro', nova: 'Bruno2026xyz' } })).status, 400);
  // cada licitante só vê o que criou; administrador vê tudo
  const pregA = (await chamar('POST', '/pregoes', { token: tokA, corpo: { nome: 'Pregão da Ana' } })).corpo;
  await chamar('POST', '/pregoes', { token: tokB, corpo: { nome: 'Pregão do Bruno' } });
  assert.deepEqual((await chamar('GET', '/pregoes', { token: tokB })).corpo.map((p) => p.nome), ['Pregão do Bruno']);
  assert.equal((await chamar('GET', '/pregoes', { token: admin })).corpo.length, 2);
  // Bruno não abre, não altera e não apaga o pregão da Ana, mesmo sabendo o endereço
  assert.equal((await chamar('GET', `/pregoes/${pregA.id}`, { token: tokB })).status, 404);
  assert.equal((await chamar('GET', `/pregoes/${pregA.id}/checklist.csv`, { token: tokB })).status, 404);
  assert.equal((await chamar('POST', `/pregoes/${pregA.id}/analisar`, { token: tokB })).status, 404);
  assert.equal((await chamar('DELETE', `/pregoes/${pregA.id}`, { token: tokB })).status, 404);
  assert.equal((await chamar('GET', `/pregoes/${pregA.id}`, { token: tokA })).status, 200);
  assert.equal((await chamar('GET', `/pregoes/${pregA.id}`, { token: admin })).status, 200);

  // telas de administrador
  for (const c of ['/usuarios', '/ia/painel', '/treino.jsonl']) assert.equal((await chamar('GET', c, { token: tokA })).status, 403, c);
  assert.equal((await chamar('POST', '/usuarios', { token: tokA, corpo: { nome: 'x', email: 'x@x.com', perfil: 'admin' } })).status, 403);

  // desativar derruba a sessão na hora; o administrador não desativa a si mesmo
  const idAna = (await chamar('GET', '/usuarios', { token: admin })).corpo.find((u) => u.email === 'ana@exemplo.com').id;
  tokA = (await entrar('ana@exemplo.com', 'NovaSenhaAna1')).corpo.token;
  assert.equal((await chamar('PATCH', `/usuarios/${idAna}`, { token: admin, corpo: { ativo: false } })).status, 200);
  assert.equal((await chamar('GET', '/pregoes', { token: tokA })).status, 401);
  assert.equal((await entrar('ana@exemplo.com', 'NovaSenhaAna1')).status, 401);
  const idAdmin = (await chamar('GET', '/eu', { token: admin })).corpo.id;
  assert.equal((await chamar('PATCH', `/usuarios/${idAdmin}`, { token: admin, corpo: { ativo: false } })).status, 400);
  assert.equal((await chamar('PATCH', `/usuarios/${idAdmin}`, { token: admin, corpo: { perfil: 'licitante' } })).status, 400);

  // sair invalida o token
  assert.equal((await chamar('POST', '/sair', { token: tokB })).status, 200);
  assert.equal((await chamar('GET', '/pregoes', { token: tokB })).status, 401);
});

test('força bruta: 5 erros seguidos bloqueiam o login, mesmo com a senha certa depois', async () => {
  // conta criada só para este ataque (o administrador continua liberado para os outros testes)
  const admin = (await entrar('admin@spaguas.sp.gov.br', 'SenhaAdmin123')).corpo.token;
  const alvo = (await chamar('POST', '/usuarios', { token: admin, corpo: { nome: 'Alvo', email: 'alvo@exemplo.com', perfil: 'licitante' } })).corpo;
  for (let i = 0; i < 5; i += 1) assert.equal((await entrar('alvo@exemplo.com', `errada${i}`)).status, 401);
  const r = await entrar('alvo@exemplo.com', alvo.senha_temporaria);
  assert.equal(r.status, 429);
  assert.match(r.corpo.erro, /Muitas tentativas/);
});

test('injeções e entradas maliciosas são recusadas sem erro interno', async () => {
  // "SQL injection" no login: só recusa
  assert.equal((await entrar("' OR 1=1 --", "' OR '1'='1")).status, 400); // recusado pelo monitor
  assert.equal((await entrar({ $ne: null }, 'x')).status, 400);
  // ids que não são UUID nem chegam ao banco
  const s2 = await entrar('nao@existe.com', 'x');
  assert.equal(s2.status, 401);
  for (const id of ["1' OR '1'='1", '../../etc/passwd', '%27%3B%20DROP%20TABLE%20pregoes']) {
    const r = await chamar('GET', `/pregoes/${encodeURIComponent(id)}`, { token: 'a'.repeat(64) });
    assert.ok([400, 401, 404].includes(r.status), `${id} -> ${r.status}`); // 400 = recusado pelo monitor
  }
  // token forjado
  assert.equal((await chamar('GET', '/pregoes', { token: 'x'.repeat(64) })).status, 401);
  // JSON que não é objeto
  const r = await fetch(`${base}/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '[1,2,3]' });
  assert.equal(r.status, 400);
  // cabeçalhos de segurança
  const h = (await chamar('GET', '/saude')).headers;
  assert.equal(h.get('x-content-type-options'), 'nosniff');
  assert.equal(h.get('x-frame-options'), 'DENY');
});

test('CSV seguro: texto que parece fórmula não vira fórmula no Excel', async () => {
  const { celulaCsv } = await import('../src/servicos/aplicacao.js');
  assert.equal(celulaCsv('=HYPERLINK("http://mal.com")'), '"\'=HYPERLINK(""http://mal.com"")"');
  assert.equal(celulaCsv('@SOMA(A1)'), '"\'@SOMA(A1)"');
  assert.equal(celulaCsv('Garantia de 36 meses'), '"Garantia de 36 meses"');
});

test('criar conta: fica pendente, não vira administrador e só entra depois de aprovado', async () => {
  const admin = (await entrar('admin@spaguas.sp.gov.br', 'SenhaAdmin123')).corpo.token;
  const r = await chamar('POST', '/cadastro', { corpo: { nome: 'Carla Nova', email: 'carla@exemplo.com', senha: 'Licitacao2026', perfil: 'admin' } });
  assert.equal(r.status, 200);
  assert.match(r.corpo.mensagem, /aguard|aprovar/i);
  // pendente: senha certa mostra a mensagem de aprovação; senha errada continua genérica
  assert.equal((await entrar('carla@exemplo.com', 'Licitacao2026')).status, 403);
  assert.equal((await entrar('carla@exemplo.com', 'errada123')).status, 401);
  // cadastrar de novo o mesmo e-mail não revela nada
  assert.equal((await chamar('POST', '/cadastro', { corpo: { nome: 'Outra', email: 'carla@exemplo.com', senha: 'Licitacao2026' } })).status, 200);
  // administrador vê a pendência e aprova (sempre como licitante, mesmo que tenha pedido admin)
  const pend = (await chamar('GET', '/pendencias', { token: admin })).corpo;
  const carla = pend.cadastros.find((u) => u.email === 'carla@exemplo.com');
  assert.ok(carla);
  assert.equal(carla.perfil, 'licitante');
  assert.equal((await chamar('POST', `/usuarios/${carla.id}/aprovar`, { token: admin })).status, 200);
  const login = await entrar('carla@exemplo.com', 'Licitacao2026');
  assert.equal(login.status, 200);
  assert.equal(login.corpo.usuario.perfil, 'licitante');
  // licitante não vê pendências
  assert.equal((await chamar('GET', '/pendencias', { token: login.corpo.token })).status, 403);
  // recusado não entra
  await chamar('POST', '/cadastro', { corpo: { nome: 'Diego', email: 'diego@exemplo.com', senha: 'Licitacao2026' } });
  const diego = (await chamar('GET', '/pendencias', { token: admin })).corpo.cadastros.find((u) => u.email === 'diego@exemplo.com');
  await chamar('POST', `/usuarios/${diego.id}/recusar`, { token: admin });
  assert.equal((await entrar('diego@exemplo.com', 'Licitacao2026')).status, 401);
});

test('esqueci a senha: resposta igual para qualquer e-mail, pedido chega ao administrador e é encerrado', async () => {
  const admin = (await entrar('admin@spaguas.sp.gov.br', 'SenhaAdmin123')).corpo.token;
  const existe = await chamar('POST', '/esqueci-senha', { corpo: { email: 'carla@exemplo.com' } });
  const naoExiste = await chamar('POST', '/esqueci-senha', { corpo: { email: 'ninguem@exemplo.com' } });
  assert.equal(existe.status, 200);
  assert.deepEqual(existe.corpo, naoExiste.corpo, 'não pode dar para saber quais e-mails existem');
  const pedido = (await chamar('GET', '/pendencias', { token: admin })).corpo.pedidos_senha.find((p) => p.usuario.email === 'carla@exemplo.com');
  assert.ok(pedido);
  const nova = (await chamar('POST', `/usuarios/${pedido.usuario.id}/redefinir-senha`, { token: admin })).corpo;
  assert.ok(nova.senha_temporaria);
  assert.ok(!(await chamar('GET', '/pendencias', { token: admin })).corpo.pedidos_senha.some((p) => p.usuario.email === 'carla@exemplo.com'));
  // excesso de pedidos do mesmo endereço é barrado
  let ultimo;
  for (let i = 0; i < 6; i += 1) ultimo = await chamar('POST', '/esqueci-senha', { corpo: { email: `x${i}@exemplo.com` } });
  assert.equal(ultimo.status, 429);
});

test('excluir usuário: pregões passam para quem excluiu; não exclui a si mesmo; licitante não exclui ninguém', async () => {
  const admin = (await entrar('admin@spaguas.sp.gov.br', 'SenhaAdmin123')).corpo.token;
  const novo = (await chamar('POST', '/usuarios', { token: admin, corpo: { nome: 'Para Excluir', email: 'excluir@exemplo.com', perfil: 'licitante' } })).corpo;
  let tk = (await entrar('excluir@exemplo.com', novo.senha_temporaria)).corpo.token;
  await chamar('POST', '/eu/senha', { token: tk, corpo: { atual: novo.senha_temporaria, nova: 'Licitacao2026' } });
  tk = (await entrar('excluir@exemplo.com', 'Licitacao2026')).corpo.token;
  const preg = (await chamar('POST', '/pregoes', { token: tk, corpo: { nome: 'Pregão de quem sai' } })).corpo;
  const lista = (await chamar('GET', '/usuarios', { token: admin })).corpo;
  const alvo = lista.find((u) => u.email === 'excluir@exemplo.com');
  assert.equal(alvo.pregoes_criados, 1);
  // licitante não exclui ninguém
  assert.equal((await chamar('DELETE', `/usuarios/${alvo.id}`, { token: tk })).status, 403);
  // administrador não exclui a si mesmo
  const eu = (await chamar('GET', '/eu', { token: admin })).corpo;
  assert.equal((await chamar('DELETE', `/usuarios/${eu.id}`, { token: admin })).status, 400);
  // exclusão: sessão do excluído cai e o pregão continua existindo, agora do administrador
  const r = await chamar('DELETE', `/usuarios/${alvo.id}`, { token: admin });
  assert.equal(r.status, 200);
  assert.equal(r.corpo.pregoes_transferidos, 1);
  assert.equal((await chamar('GET', '/pregoes', { token: tk })).status, 401);
  assert.equal((await entrar('excluir@exemplo.com', 'Licitacao2026')).status, 401);
  assert.equal((await chamar('GET', `/pregoes/${preg.id}`, { token: admin })).status, 200);
  assert.ok(!(await chamar('GET', '/usuarios', { token: admin })).corpo.some((u) => u.email === 'excluir@exemplo.com'));
});
