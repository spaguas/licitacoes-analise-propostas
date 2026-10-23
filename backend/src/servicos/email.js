// Envio de e-mail por SMTP, só com a biblioteca padrão do Node (sem dependências).
// Suporta: conexão TLS direta (porta 465), STARTTLS (porta 587/25) e autenticação LOGIN/PLAIN.
// A senha vem do .env (SMTP_SENHA) e nunca aparece em log.
import net from 'node:net';
import tls from 'node:tls';
import { randomBytes } from 'node:crypto';

const EMAIL_OK = /^[^\s@<>"]{1,64}@[^\s@<>"]{1,190}\.[^\s@<>"]{2,}$/;
const semQuebra = (t) => String(t ?? '').replace(/[\r\n]+/g, ' ').trim(); // contra injeção de cabeçalho
const assuntoUtf8 = (t) => `=?UTF-8?B?${Buffer.from(semQuebra(t)).toString('base64')}?=`;
const base64Linhas = (t) => Buffer.from(String(t), 'utf8').toString('base64').replace(/.{1,76}/g, '$&\r\n');

export function criarEmail(smtp = {}) {
  const ativo = Boolean(smtp.host && smtp.remetente);
  // Resultado dos últimos envios (para o administrador ver na tela, sem precisar do terminal)
  const historico = [];
  const anotar = (r) => { historico.unshift({ ...r, em: new Date().toISOString() }); historico.length = Math.min(historico.length, 20); };

  async function enviar(dados) {
    try {
      const r = await enviarAgora(dados);
      anotar({ ok: true, para: [].concat(dados.para).join(', '), assunto: semQuebra(dados.assunto) });
      return r;
    } catch (erro) {
      anotar({ ok: false, para: [].concat(dados.para).join(', '), assunto: semQuebra(dados.assunto), erro: explicar(erro) });
      throw erro;
    }
  }
  const situacao = () => ({
    ativo, servidor: ativo ? `${smtp.host}:${smtp.porta || (smtp.seguro ? 465 : 587)}` : null, remetente: smtp.remetente || null, ultimos: historico,
  });

  async function enviarAgora({ para, assunto, texto }) {
    if (!ativo) throw new Error('E-mail não configurado (SMTP_HOST e SMTP_REMETENTE no .env).');
    const destinos = (Array.isArray(para) ? para : [para]).map(semQuebra).filter(Boolean);
    if (!destinos.length || destinos.some((d) => !EMAIL_OK.test(d))) throw new Error('Destinatário de e-mail inválido.');
    const remetente = semQuebra(smtp.remetente);
    const dominio = remetente.split('@')[1] || 'localhost';
    const mensagem = [
      `From: ${smtp.nomeRemetente ? `${assuntoUtf8(smtp.nomeRemetente)} ` : ''}<${remetente}>`,
      `To: ${destinos.map((d) => `<${d}>`).join(', ')}`,
      `Subject: ${assuntoUtf8(assunto)}`,
      `Date: ${new Date().toUTCString()}`,
      `Message-ID: <${randomBytes(12).toString('hex')}@${dominio}>`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: base64',
      '',
      base64Linhas(texto),
    ].join('\r\n');

    const conexao = await conectar(smtp);
    try {
      await conexao.esperar(220);
      let recursos = await conexao.comando(`EHLO ${dominio}`, 250);
      if (!smtp.seguro && /STARTTLS/i.test(recursos)) {
        await conexao.comando('STARTTLS', 220);
        await conexao.subirTls();
        recursos = await conexao.comando(`EHLO ${dominio}`, 250);
      } else if (!smtp.seguro && smtp.exigirTls !== false) {
        throw new Error('O servidor de e-mail não oferece conexão criptografada (STARTTLS).');
      }
      if (smtp.usuario) {
        if (/AUTH[^\n]*\bPLAIN\b/i.test(recursos)) {
          await conexao.comando(`AUTH PLAIN ${Buffer.from(`\0${smtp.usuario}\0${smtp.senha}`).toString('base64')}`, 235, true);
        } else {
          await conexao.comando('AUTH LOGIN', 334);
          await conexao.comando(Buffer.from(smtp.usuario).toString('base64'), 334, true);
          await conexao.comando(Buffer.from(String(smtp.senha ?? '')).toString('base64'), 235, true);
        }
      }
      await conexao.comando(`MAIL FROM:<${remetente}>`, 250);
      for (const d of destinos) await conexao.comando(`RCPT TO:<${d}>`, [250, 251]);
      await conexao.comando('DATA', 354);
      await conexao.comando(`${mensagem.replace(/^\./gm, '..')}\r\n.`, 250);
      await conexao.comando('QUIT', 221).catch(() => {});
    } finally {
      conexao.fechar();
    }
    return { ok: true };
  }

  return { ativo, enviar, situacao };
}

// Mensagem de erro com a causa provável, em português.
function explicar(erro) {
  const m = String(erro?.message || erro);
  const c = String(erro?.code || '');
  if (/ETIMEDOUT|não respondeu a tempo/i.test(m + c)) return `${m} — a rede pode estar bloqueando a porta do servidor de e-mail (fale com a TI).`;
  if (/ECONNREFUSED/.test(m + c)) return `${m} — o servidor recusou a conexão: confira servidor e porta.`;
  if (/ENOTFOUND|EAI_AGAIN/.test(m + c)) return `${m} — o nome do servidor de e-mail não foi encontrado: confira SMTP_HOST.`;
  if (/\b535\b|credencial oculta/.test(m)) return `${m} — usuário/senha recusados ou SMTP autenticado desligado para a conta (Microsoft 365: TI precisa ativar).`;
  if (/\b55[0-4]\b/.test(m)) return `${m} — o servidor não deixou enviar com esse remetente: use SMTP_REMETENTE igual ao SMTP_USUARIO.`;
  if (/certificate|self.signed|CERT_/i.test(m + c)) return `${m} — certificado do servidor não reconhecido: se a TI confirmar, use SMTP_IGNORAR_CERTIFICADO=true.`;
  return m;
}

// Conexão com leitura de respostas SMTP (inclusive as de várias linhas "250-...").
function conectar(smtp) {
  return new Promise((resolve, reject) => {
    const opcoesTls = { host: smtp.host, servername: smtp.host, rejectUnauthorized: smtp.ignorarCertificado !== true };
    let socket = smtp.seguro
      ? tls.connect({ ...opcoesTls, port: smtp.porta || 465 })
      : net.connect({ host: smtp.host, port: smtp.porta || 587 });
    let buffer = '';
    let esperando = null;   // quem aguarda a próxima resposta: { ok, falha }
    const tempo = (smtp.timeoutSegundos || 20) * 1000;

    const ouvir = (s) => {
      s.setTimeout(tempo, () => { s.destroy(new Error('O servidor de e-mail não respondeu a tempo.')); });
      s.on('data', (dados) => {
        buffer += dados.toString('utf8');
        const linhas = buffer.split('\r\n');
        // resposta completa: a última linha tem "código + espaço"
        const fim = linhas.findIndex((l) => /^\d{3} /.test(l));
        if (fim >= 0 && esperando) {
          const resposta = linhas.slice(0, fim + 1).join('\n');
          buffer = linhas.slice(fim + 1).join('\r\n');
          const e = esperando; esperando = null; e.ok(resposta);
        }
      });
      // Um único ouvinte de erro por conexão (antes era um por resposta, o que gerava o aviso MaxListeners)
      s.on('error', (erro) => {
        if (esperando) { const e = esperando; esperando = null; e.falha(erro); } else reject(erro);
      });
    };
    ouvir(socket);

    const ler = () => new Promise((ok, falha) => {
      esperando = { ok, falha };
      if (/^\d{3} /m.test(buffer)) socket.emit('data', Buffer.alloc(0));
    });
    const conferir = (resposta, esperado, secreto, linha) => {
      const codigo = Number(resposta.slice(0, 3));
      const aceitos = Array.isArray(esperado) ? esperado : [esperado];
      if (!aceitos.includes(codigo)) {
        const enviado = secreto ? '(credencial oculta)' : linha.split('\r\n')[0].slice(0, 60);
        throw new Error(`Servidor de e-mail recusou ${enviado}: ${resposta.split('\n').pop()}`);
      }
      return resposta;
    };
    const api = {
      esperar: async (codigo) => conferir(await ler(), codigo, false, 'a conexão'),
      comando: async (linha, codigo, secreto = false) => { socket.write(`${linha}\r\n`); return conferir(await ler(), codigo, secreto, linha); },
      subirTls: () => new Promise((ok, falha) => {
        socket.removeAllListeners('data');
        const seguro = tls.connect({ ...opcoesTls, socket }, () => ok());
        seguro.once('error', falha);
        socket = seguro; buffer = '';
        ouvir(socket);
      }),
      fechar: () => socket.end(),
    };
    const pronto = smtp.seguro ? 'secureConnect' : 'connect';
    socket.once(pronto, () => resolve(api));
    socket.once('error', reject);
  });
}
