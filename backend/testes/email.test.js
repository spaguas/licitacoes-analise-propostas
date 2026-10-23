// E-mail com um servidor SMTP simulado (com STARTTLS de verdade, certificado gerado na hora):
// envio autenticado, link de nova senha de uso único, avisos de cadastro e de aprovação.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import tls from 'node:tls';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const recebidos = [];
let smtp; let portaSmtp; let srv; let base; let s;

// Servidor SMTP mínimo: EHLO, STARTTLS, AUTH LOGIN, MAIL, RCPT, DATA, QUIT.
function servidorSmtp({ cert, key }) {
  return net.createServer((socket) => {
    let conexao = socket; let modoDados = false; let corpo = ''; let usuario = ''; let etapaAuth = 0; let autenticado = false; let seguro = false;
    const responder = (t) => conexao.write(`${t}\r\n`);
    const tratar = (linha) => {
      if (modoDados) {
        if (linha === '.') { modoDados = false; recebidos.push({ corpo, seguro, autenticado, usuario }); corpo = ''; return responder('250 OK'); }
        corpo += `${linha}\n`; return undefined;
      }
      if (etapaAuth === 1) { usuario = Buffer.from(linha, 'base64').toString(); etapaAuth = 2; return responder('334 UGFzc3dvcmQ6'); }
      if (etapaAuth === 2) {
        etapaAuth = 0; autenticado = Buffer.from(linha, 'base64').toString() === 'senha-de-teste';
        return responder(autenticado ? '235 OK' : '535 Falha de autenticação');
      }
      if (/^EHLO/i.test(linha)) return responder(`250-smtp.teste\r\n${seguro ? '' : '250-STARTTLS\r\n'}250 AUTH LOGIN`);
      if (/^STARTTLS/i.test(linha)) {
        responder('220 Pronto');
        conexao.removeAllListeners('data');
        conexao = new tls.TLSSocket(socket, { isServer: true, cert, key });
        seguro = true; ligar(conexao); return undefined;
      }
      if (/^AUTH LOGIN/i.test(linha)) { etapaAuth = 1; return responder('334 VXNlcm5hbWU6'); }
      if (/^MAIL FROM|^RCPT TO/i.test(linha)) return responder(autenticado ? '250 OK' : '530 Autentique primeiro');
      if (/^DATA/i.test(linha)) { modoDados = true; return responder('354 Envie'); }
      if (/^QUIT/i.test(linha)) { responder('221 Tchau'); return conexao.end(); }
      return responder('500 ?');
    };
    let resto = '';
    function ligar(c) { c.on('data', (d) => { resto += d.toString(); const ls = resto.split('\r\n'); resto = ls.pop(); ls.forEach(tratar); }); c.on('error', () => {}); }
    ligar(socket);
    responder('220 smtp.teste pronto');
  });
}
const textoDoEmail = (m) => {
  const [, b64] = m.corpo.split(/\n\n/);
  return Buffer.from(b64.replace(/\s+/g, ''), 'base64').toString('utf8');
};
const assuntoDoEmail = (m) => Buffer.from(m.corpo.match(/Subject: =\?UTF-8\?B\?([^?]+)\?=/)[1], 'base64').toString('utf8');

before(async () => {
  const pasta = mkdtempSync(path.join(tmpdir(), 'smtp-'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=localhost',
    '-keyout', path.join(pasta, 'k.pem'), '-out', path.join(pasta, 'c.pem')], { stdio: 'ignore' });
  smtp = servidorSmtp({ cert: readFileSync(path.join(pasta, 'c.pem')), key: readFileSync(path.join(pasta, 'k.pem')) }).listen(0);
  portaSmtp = smtp.address().port;

  process.env.UPLOAD_DIR = mkdtempSync(path.join(tmpdir(), 'email-'));
  const { config } = await import('../src/config.js');
  const { montar } = await import('../src/servidor.js');
  const { criarRepositorioMemoria } = await import('../src/db/repositorio.js');
  const { criarServidorHttp } = await import('../src/http/rotas.js');
  const cfg = { ...config, adminEmail: 'admin@spaguas.sp.gov.br', adminSenhaInicial: 'SenhaAdmin123',
    emailAvisosAdmin: 'renata.machado@apoiospaguas.sp.gov.br', urlPublica: 'http://localhost:8080',
    smtp: { host: 'localhost', porta: portaSmtp, seguro: false, usuario: 'no-reply@spaguas.sp.gov.br', senha: 'senha-de-teste',
      remetente: 'no-reply@spaguas.sp.gov.br', nomeRemetente: 'SP Águas', ignorarCertificado: true } };
  s = await montar({ repo: criarRepositorioMemoria(), chat: async () => ({ conteudo: '{}' }), pdfWorker: {}, cfg });
  srv = criarServidorHttp({ app: s.app, config: cfg }).listen(0);
  base = `http://localhost:${srv.address().port}/api`;
});
after(() => { srv?.close(); smtp?.close(); });

const chamar = async (metodo, caminho, { token, corpo } = {}) => {
  const r = await fetch(`${base}${caminho}`, { method: metodo, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(corpo ? { 'Content-Type': 'application/json' } : {}) }, body: corpo ? JSON.stringify(corpo) : undefined });
  return { status: r.status, corpo: await r.json() };
};
const esperarEmails = async (n) => { for (let i = 0; i < 50 && recebidos.length < n; i += 1) await new Promise((r) => setTimeout(r, 50)); };

test('envio direto: STARTTLS + autenticação, assunto com acento e sem injeção de cabeçalho', async () => {
  const { criarEmail } = await import('../src/servicos/email.js');
  const email = criarEmail({ host: 'localhost', porta: portaSmtp, usuario: 'no-reply@spaguas.sp.gov.br', senha: 'senha-de-teste', remetente: 'no-reply@spaguas.sp.gov.br', ignorarCertificado: true });
  await email.enviar({ para: 'renata.machado@apoiospaguas.sp.gov.br', assunto: 'Teste ação\r\nBcc: intruso@mal.com', texto: 'Olá! Água é vida.' });
  const m = recebidos.at(-1);
  assert.equal(m.seguro, true, 'precisa ter subido para TLS (STARTTLS)');
  assert.equal(m.autenticado, true);
  assert.equal(m.usuario, 'no-reply@spaguas.sp.gov.br');
  assert.ok(!/^Bcc:/m.test(m.corpo), 'quebra de linha no assunto não pode criar cabeçalho');
  assert.equal(textoDoEmail(m), 'Olá! Água é vida.');
  // senha errada: erro claro e sem mostrar a senha
  const errado = criarEmail({ host: 'localhost', porta: portaSmtp, usuario: 'x', senha: 'errada', remetente: 'no-reply@spaguas.sp.gov.br', ignorarCertificado: true });
  await assert.rejects(errado.enviar({ para: 'a@b.com', assunto: 'x', texto: 'x' }), (e) => /credencial oculta/.test(e.message) && !/errada/.test(e.message));
});

test('esqueci a senha por e-mail: link de uso único que cria a nova senha', async () => {
  const admin = (await chamar('POST', '/login', { corpo: { email: 'admin@spaguas.sp.gov.br', senha: 'SenhaAdmin123' } })).corpo.token;
  const novo = (await chamar('POST', '/usuarios', { token: admin, corpo: { nome: 'Carla Souza', email: 'carla@spaguas.sp.gov.br', perfil: 'licitante' } })).corpo;
  const antes = recebidos.length;
  const r = await chamar('POST', '/esqueci-senha', { corpo: { email: 'carla@spaguas.sp.gov.br' } });
  assert.match(r.corpo.mensagem, /link/);
  await esperarEmails(antes + 1);
  const texto = textoDoEmail(recebidos.at(-1));
  const codigo = texto.match(/#\/redefinir\/([0-9a-f]{64})/)[1];
  assert.match(texto, /30 minutos/);
  // e-mail inexistente: mesma resposta e nenhum e-mail
  const n = recebidos.length;
  assert.deepEqual((await chamar('POST', '/esqueci-senha', { corpo: { email: 'ninguem@spaguas.sp.gov.br' } })).corpo, r.corpo);
  assert.equal(recebidos.length, n);
  // cria a nova senha pelo link; o link não funciona de novo
  assert.equal((await chamar('POST', '/redefinir-senha', { corpo: { token: codigo, nova: 'Licitacao2026' } })).status, 200);
  assert.equal((await chamar('POST', '/redefinir-senha', { corpo: { token: codigo, nova: 'OutraSenha2026' } })).status, 400);
  assert.equal((await chamar('POST', '/redefinir-senha', { corpo: { token: 'f'.repeat(64), nova: 'OutraSenha2026' } })).status, 400);
  const login = await chamar('POST', '/login', { corpo: { email: 'carla@spaguas.sp.gov.br', senha: 'Licitacao2026' } });
  assert.equal(login.status, 200);
  assert.equal(login.corpo.usuario.trocar_senha, false);
  assert.ok(novo.senha_temporaria);
});

test('cadastro avisa o administrador por e-mail; aprovação avisa a pessoa', async () => {
  const admin = (await chamar('POST', '/login', { corpo: { email: 'admin@spaguas.sp.gov.br', senha: 'SenhaAdmin123' } })).corpo.token;
  const antes = recebidos.length;
  await chamar('POST', '/cadastro', { corpo: { nome: 'Marcos Silva', email: 'marcos@spaguas.sp.gov.br', senha: 'Licitacao2026' } });
  await esperarEmails(antes + 1);
  const aviso = recebidos.at(-1);
  assert.match(aviso.corpo, /To: <renata\.machado@apoiospaguas\.sp\.gov\.br>/);
  assert.equal(assuntoDoEmail(aviso), 'Novo cadastro aguardando aprovação');
  assert.match(textoDoEmail(aviso), /Marcos Silva \(marcos@spaguas\.sp\.gov\.br\)/);
  const marcos = (await chamar('GET', '/pendencias', { token: admin })).corpo.cadastros[0];
  await chamar('POST', `/usuarios/${marcos.id}/aprovar`, { token: admin });
  await esperarEmails(antes + 2);
  assert.match(recebidos.at(-1).corpo, /To: <marcos@spaguas\.sp\.gov\.br>/);
  assert.match(textoDoEmail(recebidos.at(-1)), /foi aprovado/);
});

test('situação do e-mail na tela: teste pelo botão, último envio e erro explicado', async () => {
  const admin = (await chamar('POST', '/login', { corpo: { email: 'admin@spaguas.sp.gov.br', senha: 'SenhaAdmin123' } })).corpo.token;
  const r = await chamar('POST', '/email/teste', { token: admin, corpo: { para: 'renata.machado@apoiospaguas.sp.gov.br' } });
  assert.equal(r.status, 200);
  const s = (await chamar('GET', '/email/situacao', { token: admin })).corpo;
  assert.equal(s.ativo, true);
  assert.equal(s.avisos_para, 'renata.machado@apoiospaguas.sp.gov.br');
  assert.equal(s.ultimos[0].ok, true);
  assert.match(s.ultimos[0].assunto, /Teste de e-mail/);
  // senha errada: o erro guardado explica a causa provável (e não mostra a senha)
  const { criarEmail } = await import('../src/servicos/email.js');
  const errado = criarEmail({ host: 'localhost', porta: portaSmtp, usuario: 'x', senha: 'senha-secreta-errada', remetente: 'no-reply@spaguas.sp.gov.br', ignorarCertificado: true });
  await errado.enviar({ para: 'a@b.com', assunto: 'x', texto: 'x' }).catch(() => {});
  const ultimo = errado.situacao().ultimos[0];
  assert.equal(ultimo.ok, false);
  assert.match(ultimo.erro, /SMTP autenticado/);
  assert.ok(!ultimo.erro.includes('senha-secreta-errada'));
  // servidor inexistente
  const longe = criarEmail({ host: 'servidor-que-nao-existe.invalid', porta: 587, remetente: 'no-reply@spaguas.sp.gov.br', timeoutSegundos: 3 });
  await longe.enviar({ para: 'a@b.com', assunto: 'x', texto: 'x' }).catch(() => {});
  assert.match(longe.situacao().ultimos[0].erro, /não foi encontrado|SMTP_HOST|rede|recusou/);
});
