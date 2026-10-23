// Operações da aplicação usadas pelas rotas HTTP.
import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { resumir, STATUS } from '../nucleo/regras.js';
import { normalizarNumeroItem } from '../nucleo/normalizacao.js';
import { escopoDoRequisito } from '../nucleo/aplicabilidade.js';
import { MODELO_DE_NUVEM } from '../ia/roteador.js';
import { montarTexto, textoParaDoc } from './textos.js';
import { mascarar } from '../nucleo/lgpd.js';
import { carregarPrompt } from '../ia/validacoes.js';

const scrypt = promisify(scryptCb);

export class ErroUso extends Error {
  constructor(mensagem, status = 400) { super(mensagem); this.status = status; }
}

// Célula de CSV segura: entre aspas e, se começar com = + - @ (fórmula), com um apóstrofo na frente.
// Evita que um texto vindo de uma proposta vire fórmula ao abrir no Excel ("injeção de CSV").
export function celulaCsv(v) {
  let t = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`;
  return `"${t.replace(/"/g, '""')}"`;
}

export function criarAplicacao({ repo, orquestrador, config, roteador = null, email = null }) {
  // ---------------------------------------------------------------- usuários e sessões
  async function hashSenha(senha) {
    const sal = randomBytes(16).toString('hex');
    const h = await scrypt(senha, sal, 64);
    return `${sal}:${h.toString('hex')}`;
  }
  async function conferirSenha(senha, guardado) {
    const [sal, h] = String(guardado).split(':');
    const calc = await scrypt(senha, sal, 64);
    return timingSafeEqual(calc, Buffer.from(h, 'hex'));
  }
  // ---------------------------------------------------------------- usuários, perfis e sessões
  // Perfis: 'admin' vê tudo (todos os pregões, uso das IAs, usuários); 'licitante' vê só os pregões que criou.
  const PERFIS = { admin: 'Administrador', licitante: 'Licitante' };
  const publico = (u) => ({ id: u.id, nome: u.nome, email: u.email, perfil: u.perfil, perfil_nome: PERFIS[u.perfil] || u.perfil,
    ativo: u.ativo !== false, trocar_senha: Boolean(u.trocar_senha), ultimo_acesso: u.ultimo_acesso ?? null, criado_em: u.criado_em,
    aprovacao: u.aprovacao || 'aprovado' });
  const emailValido = (e) => /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(e);
  function validarSenhaNova(senha, email) {
    const s = String(senha || '');
    if (s.length < 8) throw new ErroUso('A senha precisa ter pelo menos 8 caracteres.');
    if (s.length > 128) throw new ErroUso('A senha pode ter no máximo 128 caracteres.');
    if (!/[A-Za-z]/.test(s) || !/\d/.test(s)) throw new ErroUso('Use letras e números na senha.');
    const nomeEmail = String(email || '').split('@')[0].toLowerCase();
    if (nomeEmail.length >= 4 && s.toLowerCase().includes(nomeEmail)) throw new ErroUso('A senha não pode conter o seu e-mail.');
  }
  const senhaTemporaria = () => {
    const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
    const b = randomBytes(12);
    return Array.from(b, (x) => alfabeto[x % alfabeto.length]).join('').replace(/^(.{4})(.{4})(.{4})$/, '$1-$2-$3');
  };

  async function garantirAdmin() {
    if ((await repo.buscar('usuarios')).length) return;
    if (!config.adminSenhaInicial) {
      console.warn('[login] Nenhum usuário cadastrado. Defina ADMIN_SENHA_INICIAL no .env para criar o administrador.');
      return;
    }
    await repo.inserir('usuarios', { email: config.adminEmail, nome: 'Administrador', senha_hash: await hashSenha(config.adminSenhaInicial), perfil: 'admin', ativo: true, trocar_senha: false });
    console.log(`[login] Administrador criado: ${config.adminEmail}`);
  }

  // Bloqueio contra tentativa de adivinhar senha: 5 erros seguidos -> 15 minutos bloqueado (por e-mail).
  const tentativas = new Map();
  const LIMITE_TENTATIVAS = 5;
  const BLOQUEIO_MS = 15 * 60 * 1000;
  async function entrar(email, senha) {
    const chave = String(email || '').trim().toLowerCase().slice(0, 254);
    const t = tentativas.get(chave);
    if (t?.bloqueadoAte > Date.now()) {
      throw new ErroUso(`Muitas tentativas erradas. Tente de novo em ${Math.ceil((t.bloqueadoAte - Date.now()) / 60000)} minuto(s).`, 429);
    }
    const [u] = emailValido(chave) ? await repo.buscar('usuarios', { email: chave }) : [];
    let ok = false;
    try { ok = Boolean(u) && u.ativo !== false && u.aprovacao !== 'recusado' && (await conferirSenha(String(senha || '').slice(0, 128), u.senha_hash)); } catch { ok = false; }
    if (ok && u.aprovacao === 'pendente') {
      tentativas.delete(chave);
      throw new ErroUso('Seu cadastro está aguardando a aprovação do administrador.', 403);
    }
    if (!ok) {
      const n = (t?.n || 0) + 1;
      tentativas.set(chave, { n, bloqueadoAte: n >= LIMITE_TENTATIVAS ? Date.now() + BLOQUEIO_MS : 0 });
      throw new ErroUso('E-mail ou senha inválidos.', 401); // mesma mensagem para e-mail inexistente, senha errada ou usuário desativado
    }
    tentativas.delete(chave);
    const token = randomBytes(32).toString('hex');
    await repo.inserir('sessoes', { token, usuario_id: u.id, expira_em: new Date(Date.now() + 12 * 3600 * 1000).toISOString() });
    await repo.atualizar('usuarios', u.id, { ultimo_acesso: new Date().toISOString() });
    return { token, usuario: publico(u) };
  }
  async function usuarioDoToken(token) {
    if (!token || !/^[0-9a-f]{64}$/.test(token)) return null;
    const [s] = await repo.buscar('sessoes', { token });
    if (!s || new Date(s.expira_em) < new Date()) return null;
    const u = await repo.obter('usuarios', s.usuario_id);
    return u && u.ativo !== false && (u.aprovacao || 'aprovado') === 'aprovado' ? publico(u) : null; // desativado ou não aprovado: sem sessão
  }
  async function sair(token) {
    if (token) await repo.remover('sessoes', { token });
    return { ok: true };
  }
  async function trocarMinhaSenha(usuario, { atual, nova }) {
    const u = await repo.obter('usuarios', usuario.id);
    let ok = false;
    try { ok = await conferirSenha(String(atual || ''), u.senha_hash); } catch { ok = false; }
    if (!ok) throw new ErroUso('A senha atual não confere.', 400);
    if (String(atual) === String(nova)) throw new ErroUso('A nova senha precisa ser diferente da atual.');
    validarSenhaNova(nova, u.email);
    await repo.atualizar('usuarios', u.id, { senha_hash: await hashSenha(String(nova)), trocar_senha: false });
    return publico({ ...u, trocar_senha: false });
  }

  // ---- pedidos públicos (tela de login): limite por endereço de rede e por e-mail, contra robôs e excesso de pedidos
  const limites = new Map();
  function limitar(chave, maximo, janelaMs) {
    const agora = Date.now();
    const lista = (limites.get(chave) || []).filter((t) => agora - t < janelaMs);
    if (lista.length >= maximo) throw new ErroUso('Muitos pedidos seguidos. Tente de novo mais tarde.', 429);
    lista.push(agora); limites.set(chave, lista);
  }
  // Autocadastro: entra como LICITANTE e só acessa depois que um administrador aprovar.
  // Avisos por e-mail: nunca derrubam a operação (se o e-mail falhar, fica registrado no terminal).
  const emailAtivo = () => Boolean(email?.ativo);
  function avisar(para, assunto, texto) {
    if (!emailAtivo()) { console.log(`[e-mail] não enviado (e-mail não configurado): "${assunto}"`); return; }
    if (!para) { console.warn(`[e-mail] não enviado: "${assunto}" não tem destinatário (confira EMAIL_AVISOS_ADMIN no .env)`); return; }
    email.enviar({ para, assunto, texto })
      .then(() => console.log(`[e-mail] enviado para ${para}: "${assunto}" (aceito pelo servidor de e-mail)`))
      .catch((erro) => console.warn(`[e-mail] falhou para ${para}: "${assunto}" — ${erro.message}`));
  }
  const RODAPE = '\n\n—\nSP Águas · Análise de Propostas\nMensagem automática: não responda este e-mail.';
  // Filtros de e-mail (Microsoft 365) desconfiam de links para "localhost": nos avisos, só põe link
  // quando o sistema tiver um endereço de verdade (APP_URL_PUBLICA de um servidor).
  const enderecoLocal = () => /\/\/(localhost|127\.|0\.0\.0\.0|\[::1\])/i.test(String(config.urlPublica || ''));
  const ondeAbrir = (caminho, sem, com) => (enderecoLocal() ? sem : `${com}\n${config.urlPublica}${caminho}`);

  // (o e-mail digitado chama "emailInformado" para não confundir com o serviço de envio "email")
  async function cadastrarSe({ nome, email: emailInformado, senha }, ip = '') {
    limitar(`cadastro:${ip}`, 5, 60 * 60 * 1000);
    const e = String(emailInformado || '').trim().toLowerCase();
    if (!String(nome || '').trim()) throw new ErroUso('Informe o seu nome.');
    if (!emailValido(e)) throw new ErroUso('E-mail inválido.');
    validarSenhaNova(senha, e);
    const mensagem = 'Cadastro enviado. Você poderá entrar assim que um administrador aprovar o seu acesso.';
    if ((await repo.buscar('usuarios', { email: e })).length) return { ok: true, mensagem }; // não revela que o e-mail já existe
    await repo.inserir('usuarios', { email: e, nome: String(nome).trim().slice(0, 120), senha_hash: await hashSenha(String(senha)),
      perfil: 'licitante', ativo: true, trocar_senha: false, aprovacao: 'pendente' });
    avisar(config.emailAvisosAdmin, 'Novo cadastro aguardando aprovação',
      `${String(nome).trim()} (${e}) pediu acesso ao sistema de Análise de Propostas.\n\nPara aprovar ou recusar, ${ondeAbrir('/#/usuarios', 'abra o sistema de Análise de Propostas e vá ao menu Usuários.', 'abra o menu Usuários:')}${RODAPE}`);
    return { ok: true, mensagem };
  }
  // "Esqueci a senha": registra o pedido para o administrador. Resposta igual exista ou não o e-mail.
  async function esqueciSenha({ email: emailInformado }, ip = '') {
    limitar(`esqueci:${ip}`, 5, 15 * 60 * 1000);
    const e = String(emailInformado || '').trim().toLowerCase();
    const mensagem = emailAtivo()
      ? 'Se o e-mail estiver cadastrado, você vai receber um link para criar uma nova senha. Confira também a caixa de spam.'
      : 'Se o e-mail estiver cadastrado, o administrador recebeu o seu pedido e vai entregar uma senha temporária.';
    if (!emailValido(e)) return { ok: true, mensagem };
    limitar(`esqueci-email:${e}`, 3, 60 * 60 * 1000);
    const [u] = await repo.buscar('usuarios', { email: e });
    if (!u || u.ativo === false || (u.aprovacao || 'aprovado') !== 'aprovado') return { ok: true, mensagem };
    if (emailAtivo()) {
      const codigo = randomBytes(32).toString('hex');
      await repo.inserir('tokens_senha', { usuario_id: u.id, token_hash: createHash('sha256').update(codigo).digest('hex'),
        expira_em: new Date(Date.now() + 30 * 60 * 1000).toISOString(), usado: false });
      try {
        await email.enviar({ para: u.email, assunto: 'Criar uma nova senha',
          texto: `Olá, ${u.nome.split(' ')[0]}.\n\nRecebemos um pedido para criar uma nova senha no sistema de Análise de Propostas.\nPara continuar, abra o link abaixo (vale por 30 minutos e só pode ser usado uma vez):\n\n${config.urlPublica}/#/redefinir/${codigo}\n\nSe não foi você, ignore este e-mail: a sua senha atual continua valendo.${RODAPE}` });
        return { ok: true, mensagem };
      } catch (erro) {
        console.warn(`[e-mail] não foi possível enviar o link de nova senha: ${erro.message} — o pedido vai para o administrador.`);
      }
    }
    const abertos = (await repo.buscar('pedidos_senha', { usuario_id: u.id })).filter((p) => !p.atendido);
    if (!abertos.length) await repo.inserir('pedidos_senha', { usuario_id: u.id, atendido: false });
    return { ok: true, mensagem };
  }
  // Criar a nova senha pelo link do e-mail (uso único, expira em 30 minutos).
  async function redefinirComLink({ token, nova }, ip = '') {
    limitar(`link:${ip}`, 10, 15 * 60 * 1000);
    const invalido = () => new ErroUso('Link inválido ou expirado. Peça um novo em "Esqueceu a senha?".', 400);
    if (!/^[0-9a-f]{64}$/.test(String(token || ''))) throw invalido();
    const [t] = await repo.buscar('tokens_senha', { token_hash: createHash('sha256').update(String(token)).digest('hex') });
    if (!t || t.usado || new Date(t.expira_em) < new Date()) throw invalido();
    const u = await repo.obter('usuarios', t.usuario_id);
    if (!u || u.ativo === false || (u.aprovacao || 'aprovado') !== 'aprovado') throw invalido();
    validarSenhaNova(nova, u.email);
    await repo.atualizar('usuarios', u.id, { senha_hash: await hashSenha(String(nova)), trocar_senha: false });
    for (const x of await repo.buscar('tokens_senha', { usuario_id: u.id })) await repo.atualizar('tokens_senha', x.id, { usado: true });
    for (const p of (await repo.buscar('pedidos_senha', { usuario_id: u.id })).filter((x) => !x.atendido)) await repo.atualizar('pedidos_senha', p.id, { atendido: true });
    await repo.remover('sessoes', { usuario_id: u.id }); // derruba sessões antigas
    tentativas.delete(u.email);
    return { ok: true, mensagem: 'Senha criada. Já pode entrar com a nova senha.' };
  }
  // Situação do e-mail e envio de teste (tela Usuários)
  function situacaoEmail() {
    const s = email?.situacao ? email.situacao() : { ativo: false, ultimos: [] };
    return { ...s, avisos_para: config.emailAvisosAdmin || null };
  }
  async function testarEmail(para) {
    if (!emailAtivo()) throw new ErroUso('O e-mail não está configurado. Rode o configurar-email.ps1 na pasta do projeto.');
    const destino = String(para || config.emailAvisosAdmin || '').trim();
    if (!emailValido(destino.toLowerCase())) throw new ErroUso('Informe um e-mail válido para o teste.');
    try {
      await email.enviar({ para: destino, assunto: 'Teste de e-mail – Análise de Propostas',
        texto: `Este é um teste do envio de e-mails do sistema de Análise de Propostas.\n\nSe você recebeu, os avisos de cadastro e de aprovação também vão chegar.${RODAPE}` });
    } catch (erro) {
      throw new ErroUso(`O envio falhou: ${situacaoEmail().ultimos[0]?.erro || erro.message}`, 502);
    }
    return { ok: true, mensagem: `E-mail de teste enviado para ${destino}. Confira a caixa de entrada e o spam.` };
  }

  async function pendencias() {
    const [usuarios, pedidos] = await Promise.all([repo.buscar('usuarios'), repo.buscar('pedidos_senha')]);
    const porId = Object.fromEntries(usuarios.map((u) => [u.id, u]));
    const abertos = pedidos.filter((p) => !p.atendido && porId[p.usuario_id]);
    return {
      cadastros: usuarios.filter((u) => u.aprovacao === 'pendente').map(publico),
      pedidos_senha: abertos.map((p) => ({ id: p.id, pedido_em: p.criado_em, usuario: publico(porId[p.usuario_id]) })),
      total: usuarios.filter((u) => u.aprovacao === 'pendente').length + abertos.length,
    };
  }
  async function decidirCadastro(id, aprovar) {
    const u = await repo.obter('usuarios', id);
    if (!u || u.aprovacao !== 'pendente') throw new ErroUso('Cadastro pendente não encontrado.', 404);
    // Aprovado sempre como licitante; promover a administrador é uma ação separada, na tabela.
    const atualizado = await repo.atualizar('usuarios', id, { aprovacao: aprovar ? 'aprovado' : 'recusado', perfil: 'licitante', ativo: Boolean(aprovar) });
    if (aprovar) {
      avisar(u.email, 'Seu acesso foi aprovado',
        `Olá, ${u.nome.split(' ')[0]}.\n\nO seu acesso ao sistema de Análise de Propostas foi aprovado. Entre com o e-mail e a senha que você cadastrou${enderecoLocal() ? ', no endereço do sistema que a equipe de GTI informou.' : `:\n${config.urlPublica}`}${RODAPE}`);
    }
    return publico(atualizado);
  }

  // ---- gestão de usuários (só administrador)
  async function listarUsuarios() {
    const pregoes = await repo.buscar('pregoes');
    return (await repo.buscar('usuarios', {}, { ordem: 'criado_em' })).filter((u) => (u.aprovacao || 'aprovado') === 'aprovado')
      .map((u) => ({ ...publico(u), pregoes_criados: pregoes.filter((p) => p.criado_por === u.id).length }));
  }
  async function criarUsuario({ email, nome, perfil = 'licitante' }) {
    const e = String(email || '').trim().toLowerCase();
    if (!String(nome || '').trim()) throw new ErroUso('Informe o nome.');
    if (!emailValido(e)) throw new ErroUso('E-mail inválido.');
    if (!PERFIS[perfil]) throw new ErroUso('Perfil inválido.');
    if ((await repo.buscar('usuarios', { email: e })).length) throw new ErroUso('Já existe um usuário com esse e-mail.');
    const temporaria = senhaTemporaria();
    const u = await repo.inserir('usuarios', { email: e, nome: String(nome).trim().slice(0, 120), senha_hash: await hashSenha(temporaria), perfil, ativo: true, trocar_senha: true });
    return { usuario: publico(u), senha_temporaria: temporaria }; // mostrada uma única vez ao administrador
  }
  async function adminsAtivos() {
    return (await repo.buscar('usuarios', { perfil: 'admin' })).filter((u) => u.ativo !== false);
  }
  async function atualizarUsuario(id, patch, admin) {
    const u = await repo.obter('usuarios', id);
    if (!u) throw new ErroUso('Usuário não encontrado.', 404);
    const limpo = {};
    if ('nome' in patch) { if (!String(patch.nome || '').trim()) throw new ErroUso('Informe o nome.'); limpo.nome = String(patch.nome).trim().slice(0, 120); }
    if ('perfil' in patch) { if (!PERFIS[patch.perfil]) throw new ErroUso('Perfil inválido.'); limpo.perfil = patch.perfil; }
    if ('ativo' in patch) limpo.ativo = Boolean(patch.ativo);
    const deixaDeSerAdmin = u.perfil === 'admin' && ((limpo.perfil && limpo.perfil !== 'admin') || limpo.ativo === false);
    if (deixaDeSerAdmin && u.id === admin.id) throw new ErroUso('Você não pode desativar nem tirar o seu próprio acesso de administrador.');
    if (deixaDeSerAdmin && (await adminsAtivos()).length <= 1) throw new ErroUso('O sistema precisa de pelo menos um administrador ativo.');
    const atualizado = await repo.atualizar('usuarios', id, limpo);
    if (limpo.ativo === false) await repo.remover('sessoes', { usuario_id: id }); // derruba as sessões abertas
    return publico(atualizado);
  }
  // Exclusão definitiva de um usuário. Os pregões que ele criou passam para o administrador que excluiu
  // (nada se perde); sessões, pedidos e links de senha são apagados junto.
  async function excluirUsuario(id, admin) {
    const u = await repo.obter('usuarios', id);
    if (!u) throw new ErroUso('Usuário não encontrado.', 404);
    if (u.id === admin.id) throw new ErroUso('Você não pode excluir a sua própria conta.');
    if (u.perfil === 'admin' && u.ativo !== false && (await adminsAtivos()).length <= 1) throw new ErroUso('O sistema precisa de pelo menos um administrador ativo.');
    const seus = await repo.buscar('pregoes', { criado_por: id });
    for (const p of seus) await repo.atualizar('pregoes', p.id, { criado_por: admin.id });
    for (const t of ['sessoes', 'pedidos_senha', 'tokens_senha']) await repo.remover(t, { usuario_id: id });
    await repo.remover('usuarios', { id });
    return { ok: true, email: u.email, nome: u.nome, pregoes_transferidos: seus.length };
  }

  async function redefinirSenha(id) {
    const u = await repo.obter('usuarios', id);
    if (!u) throw new ErroUso('Usuário não encontrado.', 404);
    const temporaria = senhaTemporaria();
    await repo.atualizar('usuarios', id, { senha_hash: await hashSenha(temporaria), trocar_senha: true });
    await repo.remover('sessoes', { usuario_id: id });
    for (const p of (await repo.buscar('pedidos_senha', { usuario_id: id })).filter((x) => !x.atendido)) await repo.atualizar('pedidos_senha', p.id, { atendido: true });
    return { usuario: publico(u), senha_temporaria: temporaria };
  }

  // ---- acesso aos dados: licitante só enxerga os pregões que criou
  const ehAdmin = (usuario) => usuario?.perfil === 'admin';
  async function exigirPregao(usuario, pregaoId) {
    const pregao = await repo.obter('pregoes', pregaoId);
    // "não encontrado" também quando é de outra pessoa: não revela que o pregão existe
    if (!pregao) throw new ErroUso('Pregão não encontrado.', 404);
    if (!ehAdmin(usuario) && pregao.criado_por !== usuario?.id) {
      const erro = new ErroUso('Pregão não encontrado.', 404);
      erro.indevido = true; // existe, mas é de outra pessoa: vai para o monitor de segurança
      throw erro;
    }
    return pregao;
  }
  async function exigirRegistro(usuario, tabela, id) {
    const reg = await repo.obter(tabela, id);
    if (!reg) throw new ErroUso('Registro não encontrado.', 404);
    await exigirPregao(usuario, reg.pregao_id);
    return reg;
  }
  async function listarPregoesDo(usuario) {
    const todos = await repo.buscar('pregoes', {}, { ordem: 'criado_em' });
    const visiveis = ehAdmin(usuario) ? todos : todos.filter((p) => p.criado_por === usuario.id);
    if (!ehAdmin(usuario)) return visiveis;
    const nomes = Object.fromEntries((await repo.buscar('usuarios')).map((u) => [u.id, u.nome]));
    return visiveis.map((p) => ({ ...p, criado_por_nome: nomes[p.criado_por] ?? null }));
  }

  // ---------------------------------------------------------------- pregões e documentos
  async function criarPregao({ nome }, usuario) {
    if (!nome?.trim()) throw new ErroUso('Informe o nome do pregão.');
    return repo.inserir('pregoes', { nome: nome.trim(), status: 'rascunho', criado_por: usuario?.id ?? null, atualizado_em: new Date().toISOString() });
  }

  async function salvarArquivo(pregaoId, arquivo) {
    const bytes = Buffer.from(await arquivo.arrayBuffer());
    if (!bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw new ErroUso(`"${arquivo.name}" não é um PDF.`);
    if (bytes.length > config.maxPdfMb * 1024 * 1024) throw new ErroUso(`"${arquivo.name}" passa de ${config.maxPdfMb} MB.`);
    const hash = createHash('sha256').update(bytes).digest('hex');
    const pasta = path.join(config.uploadDir, pregaoId);
    await mkdir(pasta, { recursive: true });
    const caminho = path.join(pasta, `${hash}.pdf`);
    await writeFile(caminho, bytes);
    return { hash, caminho, nome: arquivo.name };
  }

  async function enviarDocumento(pregaoId, papel, arquivo) {
    if (!['edital', 'tr', 'anexo'].includes(papel)) throw new ErroUso('Papel do documento inválido (edital, tr ou anexo).');
    if (!(await repo.obter('pregoes', pregaoId))) throw new ErroUso('Pregão não encontrado.', 404);
    const a = await salvarArquivo(pregaoId, arquivo);
    const doc = await repo.inserir('documentos', { pregao_id: pregaoId, papel, publico: true, nome_arquivo: a.nome, hash: a.hash, caminho: a.caminho, status: 'recebido' });
    await orquestrador.agendar(pregaoId, 'analisar_documento', doc.id, { documento_id: doc.id, titulo: `Leitura · ${a.nome}` });
    return doc;
  }

  async function enviarProposta(pregaoId, { cnpj, razao_social }, arquivo) {
    const cnpjLimpo = String(cnpj || '').replace(/\W/g, '').toUpperCase();
    if (cnpjLimpo.length !== 14) throw new ErroUso('Informe o CNPJ da empresa (14 caracteres).');
    if (!(await repo.obter('pregoes', pregaoId))) throw new ErroUso('Pregão não encontrado.', 404);
    const fornecedor = await repo.upsert('fornecedores', ['cnpj'], { cnpj: cnpjLimpo, razao_social: razao_social?.trim() || null });
    const a = await salvarArquivo(pregaoId, arquivo);
    // Proposta NÃO é documento público: a trava de dados impede que vá para a IA gratuita.
    const doc = await repo.inserir('documentos', { pregao_id: pregaoId, papel: 'proposta', publico: false, nome_arquivo: a.nome, hash: a.hash, caminho: a.caminho, status: 'recebido' });
    const proposta = await repo.inserir('propostas', { pregao_id: pregaoId, fornecedor_id: fornecedor.id, documento_id: doc.id, status: 'recebida' });
    await orquestrador.agendar(pregaoId, 'analisar_proposta', proposta.id, { proposta_id: proposta.id, titulo: `Proposta · ${fornecedor.razao_social || fornecedor.cnpj} · ${a.nome}` });
    return proposta;
  }

  async function iniciarAnalise(pregaoId) {
    const validados = await repo.buscar('requisitos', { pregao_id: pregaoId, status_validacao: 'validado' });
    if (!validados.length) throw new ErroUso('Valide os requisitos antes de iniciar a análise.');
    const itens = await repo.buscar('itens_proposta', { pregao_id: pregaoId });
    if (!itens.length) throw new ErroUso('Nenhuma proposta extraída ainda.');
    const propostas = Object.fromEntries((await repo.buscar('propostas', { pregao_id: pregaoId })).map((p) => [p.id, p]));
    for (const ip of itens) {
      const forn = await repo.obter('fornecedores', propostas[ip.proposta_id]?.fornecedor_id);
      await orquestrador.agendar(pregaoId, 'analisar_item_proposta', ip.id, { item_proposta_id: ip.id, titulo: `Análise · Item ${ip.item_numero} · ${forn?.razao_social || forn?.cnpj || 'fornecedor'}` });
    }
    // Habilitação: uma conferência por proposta (os documentos são da empresa, não do item).
    const temHabilitacao = validados.some((r) => r.categoria === 'HABILITACAO');
    let habilitacoes = 0;
    if (temHabilitacao) {
      for (const proposta of Object.values(propostas).filter((p) => itens.some((i) => i.proposta_id === p.id))) {
        const forn = await repo.obter('fornecedores', proposta.fornecedor_id);
        await orquestrador.agendar(pregaoId, 'analisar_habilitacao', proposta.id, { proposta_id: proposta.id, titulo: `Habilitação · ${forn?.razao_social || forn?.cnpj || 'fornecedor'}` });
        habilitacoes += 1;
      }
    }
    return { agendadas: itens.length + habilitacoes };
  }

  async function reprocessarErros(pregaoId) {
    const erros = (await repo.buscar('tarefas', { pregao_id: pregaoId })).filter((t) => t.status === 'erro');
    if (erros.length) {
      // O pop-up passa a acompanhar a partir da tarefa mais antiga que vai rodar de novo.
      const maisAntiga = Math.min(...erros.map((t) => new Date(t.criado_em).getTime()));
      await repo.atualizar('pregoes', pregaoId, { lote_inicio: new Date(maisAntiga).toISOString() });
    }
    for (const t of erros) await repo.atualizar('tarefas', t.id, { status: 'pendente', erro: null, progresso: null });
    return { reagendadas: erros.length };
  }

  // ---------------------------------------------------------------- consultas
  // Julgamento por lote: escolha manual do pregão ou detecção pelo critério do edital.
  const criterioFalaDeLote = (criterio) => /\b(lote|grupo|global)\b/i.test(String(criterio || ''));
  // Ordem: escolha manual > critério encontrado no edital/TR (com prova) > texto do critério da capa.
  const detectadoPorLote = (pregao) => (pregao?.julgamento_fonte?.modo ? pregao.julgamento_fonte.modo === 'lote' : criterioFalaDeLote(pregao?.criterio));
  const julgamentoPorLote = (pregao) => pregao?.julgamento_por_lote ?? detectadoPorLote(pregao);
  // Estrutura da licitação (Etapa 01): por item ou por lote, quantos lotes, quantos itens em cada um,
  // valor estimado de cada lote e alertas quando o edital, a tabela de itens e o TR não batem.
  function estruturaDaLicitacao(pregao, itens, requisitos) {
    const porLote = julgamentoPorLote(pregao);
    const fonte = pregao.julgamento_fonte || {};
    const origem = pregao.julgamento_por_lote != null ? 'manual' : fonte.modo ? 'documento' : criterioFalaDeLote(pregao.criterio) ? 'capa' : 'padrao';
    const temColunaLote = itens.some((i) => i.lote);
    const grupos = new Map();
    for (const i of [...itens].sort((a, b) => Number(a.numero) - Number(b.numero))) {
      const l = String(i.lote || i.numero);
      if (!grupos.has(l)) grupos.set(l, []);
      grupos.get(l).push(i);
    }
    const lotes = [...grupos.entries()].sort(([a], [b]) => a.localeCompare(b, 'pt-BR', { numeric: true })).map(([lote, lista]) => ({
      lote,
      quantidade_itens: lista.length,
      valor_estimado: Math.round(lista.reduce((s, i) => s + (Number(i.valor_unitario_estimado) || 0) * (Number(i.quantidade) || 0), 0) * 100) / 100,
      itens: lista.map((i) => ({ numero: i.numero, descricao: i.descricao, quantidade: i.quantidade, unidade: i.unidade, valor_unitario_estimado: i.valor_unitario_estimado })),
    }));
    const lotesNoTr = [...new Set(requisitos.filter((r) => r.lote).map((r) => String(r.lote)))];
    const alertas = [];
    if (origem === 'padrao') alertas.push('O critério de julgamento não foi encontrado no edital nem no TR. O padrão é "por item": confira e ajuste, se preciso.');
    if (fonte.conflito) alertas.push('O edital e o TR indicam critérios diferentes (veja "Conflitos entre documentos"). Confira qual vale.');
    if (porLote && !temColunaLote && itens.length > 1) alertas.push('O julgamento é por lote, mas a tabela de itens não indica o lote de cada item: cada item está sendo tratado como um lote próprio. Confira a composição dos lotes no edital.');
    if (porLote && temColunaLote && lotes.length && lotes.every((l) => l.quantidade_itens === 1)) alertas.push('Todos os lotes têm um único item: na prática, a análise fica igual à por item.');
    if (!porLote && temColunaLote && lotes.some((l) => l.quantidade_itens > 1)) alertas.push('A tabela de itens agrupa itens em lotes, mas o critério encontrado é por item. Confira se o fornecedor pode ofertar itens isolados.');
    if (lotesNoTr.some((l) => !grupos.has(l))) alertas.push(`O TR traz especificações do(s) lote(s) ${lotesNoTr.filter((l) => !grupos.has(l)).join(', ')}, que não aparecem na tabela de itens.`);
    return {
      julgamento: porLote ? 'lote' : 'item',
      origem,
      evidencia: origem === 'documento' ? (fonte.evidencias?.[0] ?? null) : null,
      criterio_capa: pregao.criterio || null,
      regra: porLote
        ? 'O fornecedor que disputar um lote deve ofertar TODOS os itens dele; faltando um item, a proposta não atende ao lote.'
        : 'O fornecedor pode ofertar itens isolados; cada item é julgado separadamente.',
      total_itens: itens.length,
      total_lotes: porLote ? lotes.length : null,
      lotes,
      alertas,
    };
  }

  // Conferência rápida, logo depois de ler a proposta (antes da análise): no julgamento por lote,
  // cada lote disputado precisa ter TODOS os itens ofertados.
  function conferirLotesDaProposta(pregao, itens, itensDaProposta) {
    if (!julgamentoPorLote(pregao) || !itensDaProposta.length) return null;
    const loteDoItem = Object.fromEntries(itens.map((i) => [i.numero, String(i.lote || i.numero)]));
    const ofertados = new Set(itensDaProposta.map((ip) => normalizarNumeroItem(ip.item_numero, itens)));
    const disputados = [...new Set([...ofertados].map((n) => loteDoItem[n]).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true }));
    return disputados.map((lote) => {
      const doLote = itens.filter((i) => loteDoItem[i.numero] === lote).map((i) => i.numero);
      return { lote, itens_do_lote: doLote, faltam: doLote.filter((n) => !ofertados.has(n)) };
    });
  }

  async function definirJulgamento(pregaoId, porLote) {
    if (!(await repo.obter('pregoes', pregaoId))) throw new ErroUso('Pregão não encontrado.', 404);
    return repo.atualizar('pregoes', pregaoId, { julgamento_por_lote: porLote === null ? null : Boolean(porLote), atualizado_em: new Date().toISOString() });
  }

  // De qual documento veio o requisito: "TR" ou "Edital" (e o nome do arquivo).
  const SIGLA_PAPEL = { tr: 'TR', edital: 'Edital', anexo: 'Anexo', proposta: 'Proposta' };
  function fonteDoDocumento(documentos, documentoId) {
    const d = documentos.find((x) => x.id === documentoId);
    return d ? { sigla: SIGLA_PAPEL[d.papel] || d.papel, arquivo: d.nome_arquivo } : null;
  }

  async function painelPregao(pregaoId) {
    const pregao = await repo.obter('pregoes', pregaoId);
    if (!pregao) throw new ErroUso('Pregão não encontrado.', 404);
    const [documentos, partes, itens, conflitos, requisitos, linhas, tarefas, propostas, fornecedores, itensProposta, avaliacoes] = await Promise.all([
      repo.buscar('documentos', { pregao_id: pregaoId }), repo.buscar('partes_documento', { pregao_id: pregaoId }),
      repo.buscar('itens', { pregao_id: pregaoId }, { ordem: 'numero' }), repo.buscar('conflitos', { pregao_id: pregaoId }),
      repo.buscar('requisitos', { pregao_id: pregaoId }, { ordem: 'codigo' }), repo.buscar('linhas_esqueleto', { pregao_id: pregaoId }, { ordem: 'codigo' }),
      repo.buscar('tarefas', { pregao_id: pregaoId }), repo.buscar('propostas', { pregao_id: pregaoId }), repo.buscar('fornecedores'),
      repo.buscar('itens_proposta', { pregao_id: pregaoId }), repo.buscar('avaliacoes', { pregao_id: pregaoId }),
    ]);
    const cobertura = {};
    for (const l of linhas.filter((x) => !x.so_agrupa)) {
      const k = l.item_numero ?? (l.lote ? `lote_${l.lote}` : 'geral');
      cobertura[k] = cobertura[k] || { linhas: 0, cobertas: 0 };
      cobertura[k].linhas += 1;
      if (requisitos.some((r) => r.linha_codigo === l.codigo)) cobertura[k].cobertas += 1;
    }
    const fornecedorPorId = Object.fromEntries(fornecedores.map((f) => [f.id, f]));
    return {
      pregao: { ...pregao, ausencia_reprova_efetiva: pregao.ausencia_reprova ?? config.ausenciaReprova,
        julgamento_por_lote_efetivo: julgamentoPorLote(pregao), julgamento_por_lote_detectado: detectadoPorLote(pregao),
        julgamento_evidencia: pregao.julgamento_fonte?.evidencias?.[0] ?? null, julgamento_encontrado: Boolean(pregao.julgamento_fonte?.modo) },
      documentos: documentos.map(({ analise, caminho, ...d }) => ({ ...d, lgpd: analise?.lgpd ?? null, paginas_sem_texto: analise?.paginas_sem_texto ?? [] })),
      partes, itens, conflitos,
      estrutura: estruturaDaLicitacao(pregao, itens, requisitos),
      requisitos: requisitos.map((r) => ({ ...r, fonte: fonteDoDocumento(documentos, r.origem?.documento_id) })),
      cobertura,
      tarefas: tarefas.map(({ payload, ...t }) => t),
      propostas: propostas.map((p) => {
        const doFornecedor = itensProposta.filter((i) => i.proposta_id === p.id);
        return { ...p, json_bruto: undefined, fornecedor: fornecedorPorId[p.fornecedor_id] || null, itens: doFornecedor,
          lotes: conferirLotesDaProposta(pregao, itens, doFornecedor) };
      }),
      indicadores: {
        requisitos: requisitos.length,
        validados: requisitos.filter((r) => r.status_validacao === 'validado').length,
        fornecedores: new Set(propostas.map((p) => p.fornecedor_id)).size,
        atendidos: avaliacoes.filter((a) => a.status === STATUS.ATENDE).length,
        pontos_de_atencao: avaliacoes.filter((a) => [STATUS.NAO_ATENDE, STATUS.REVISAR, STATUS.VAGO, STATUS.PARCIAL].includes(a.status)).length + conflitos.length,
        tarefas_abertas: tarefas.filter((t) => t.status === 'pendente' || t.status === 'executando').length,
        tarefas_com_erro: tarefas.filter((t) => t.status === 'erro').length,
      },
    };
  }

  // Resumo para o pop-up de carregamento.
  // Lote = tarefas criadas desde que o pregão saiu do estado "parado" (pregoes.lote_inicio).
  // Cada tipo de tarefa tem um peso; a leitura de um documento ainda em andamento reserva um peso
  // extra para as tarefas que ela vai criar (requisitos), para o percentual não "voltar".
  const NOME_TAREFA = {
    analisar_documento: 'Leitura do documento', e3_lote: 'Requisitos por item', e3b_capitulo: 'Requisitos gerais',
    analisar_proposta: 'Leitura da proposta', analisar_item_proposta: 'Análise do item', analisar_habilitacao: 'Habilitação',
  };
  const PESO = { analisar_documento: 3, e3_lote: 1, e3b_capitulo: 1, analisar_proposta: 4, analisar_item_proposta: 4, analisar_habilitacao: 3 };
  const RESERVA_DOCUMENTO = 8;
  async function progressoPregao(pregaoId) {
    const [pregao, tarefas] = await Promise.all([repo.obter('pregoes', pregaoId), repo.buscar('tarefas', { pregao_id: pregaoId })]);
    const aberta = (t) => t.status === 'pendente' || t.status === 'executando';
    const abertas = tarefas.filter(aberta);
    const momento = (v) => new Date(v).getTime();
    const inicio = pregao?.lote_inicio
      ? momento(pregao.lote_inicio)
      : (abertas.length ? Math.min(...abertas.map((t) => momento(t.criado_em))) - 5 * 60 * 1000 : Date.now());
    const lote = tarefas.filter((t) => momento(t.criado_em) >= inicio);
    const pct = (t) => (t.status === 'concluida' || t.status === 'erro' ? 100 : t.status === 'executando' ? (t.progresso?.percentual ?? 0) : 0);
    const ordem = { executando: 0, pendente: 1, erro: 2, concluida: 3 };
    const listar = () => lote
      .map((t) => ({
        id: t.id, tipo: t.tipo, status: t.status,
        titulo: t.payload?.rotulo || t.payload?.titulo || NOME_TAREFA[t.tipo] || t.tipo,
        percentual: pct(t),
        mensagem: t.status === 'pendente' ? 'Na fila' : t.status === 'erro' ? 'Erro' : t.status === 'concluida' ? 'Concluído' : (t.progresso?.mensagem ?? ''),
        erro: t.status === 'erro' ? String(t.erro || '').slice(0, 300) : null,
      }))
      .sort((x, y) => ordem[x.status] - ordem[y.status] || x.titulo.localeCompare(y.titulo, 'pt-BR', { numeric: true }));
    const resumo = {
      total: lote.length,
      concluidas: lote.filter((t) => t.status === 'concluida').length,
      erros: lote.filter((t) => t.status === 'erro').length,
      inicio: new Date(inicio).toISOString(),
    };
    // Parado: devolve o resumo do último lote (o pop-up mostra "concluído" com a lista final).
    if (!abertas.length) return { ativo: false, percentual: 100, ...resumo, tarefas: listar() };
    let feito = 0; let total = 0;
    for (const t of lote) {
      const peso = PESO[t.tipo] ?? 1;
      total += peso; feito += (peso * pct(t)) / 100;
      if (t.tipo === 'analisar_documento' && aberta(t)) total += RESERVA_DOCUMENTO;
    }
    return { ativo: true, percentual: Math.min(99, Math.round((feito / Math.max(total, 1)) * 100)), ...resumo, tarefas: listar() };
  }

  async function especificacoesDaProposta(propostaId) {
    const itens = await repo.buscar('itens_proposta', { proposta_id: propostaId });
    const saida = [];
    for (const ip of itens) saida.push({ ...ip, especificacoes: await repo.buscar('especificacoes', { item_proposta_id: ip.id }, { ordem: 'codigo' }) });
    return saida;
  }

  async function checklist(pregaoId) {
    const documentos = await repo.buscar('documentos', { pregao_id: pregaoId });
    const [itens, requisitos, propostas, fornecedores, itensProposta, avaliacoes, depara, conflitos] = await Promise.all([
      repo.buscar('itens', { pregao_id: pregaoId }, { ordem: 'numero' }), repo.buscar('requisitos', { pregao_id: pregaoId }, { ordem: 'codigo' }),
      repo.buscar('propostas', { pregao_id: pregaoId }), repo.buscar('fornecedores'), repo.buscar('itens_proposta', { pregao_id: pregaoId }),
      repo.buscar('avaliacoes', { pregao_id: pregaoId }), repo.buscar('depara', { pregao_id: pregaoId }), repo.buscar('conflitos', { pregao_id: pregaoId }),
    ]);
    const reqPorId = Object.fromEntries(requisitos.map((r) => [r.id, r]));
    const fornPorId = Object.fromEntries(fornecedores.map((f) => [f.id, f]));
    const propPorId = Object.fromEntries(propostas.map((p) => [p.id, p]));
    return itensProposta.map((ip) => {
      const proposta = propPorId[ip.proposta_id];
      const item = itens.find((i) => i.numero === normalizarNumeroItem(ip.item_numero, itens));
      const linhas = avaliacoes.filter((a) => a.item_proposta_id === ip.id).map((a) => {
        const r = reqPorId[a.requisito_id] || {};
        const dp = depara.find((d) => d.requisito_id === a.requisito_id && d.item_proposta_id === ip.id);
        return {
          avaliacao_id: a.id, depara_id: dp?.id ?? null, requisito_codigo: r.codigo, secao: r.secao, atributo: r.atributo,
          escopo: escopoDoRequisito(r), faltante: Boolean(a.faltante), exigido: r.origem?.trecho, pagina_edital: r.origem?.pagina, fonte: fonteDoDocumento(documentos, r.origem?.documento_id), ofertado: a.evidencia?.trecho ?? null, pagina_proposta: a.evidencia?.pagina ?? null,
          status: a.status, justificativa: a.justificativa, metodo: a.metodo, aliases: a.aliases, concordancia_ias: a.concordancia_ias,
          confianca_depara: dp?.confianca ?? null, obrigatorio: r.obrigatorio, revisao_status: a.revisao_status || 'pendente', revisao_parecer: a.revisao_parecer,
        };
      }).sort((x, y) => String(x.requisito_codigo).localeCompare(String(y.requisito_codigo), 'pt-BR', { numeric: true }));
      // Alerta de preço: compara com TODAS as estimativas (inclusive as que estão em conflito).
      const estimativas = [{ valor: Number(item?.valor_unitario_estimado), fonte: item?.fonte?.documento || 'tabela de itens' },
        ...conflitos.filter((c) => c.campo === `Valor unitário estimado do item ${ip.item_numero}`).flatMap((c) => c.valores)]
        .filter((e) => Number.isFinite(Number(e.valor)) && Number(e.valor) > 0);
      const unicas = [...new Map(estimativas.map((e) => [Number(e.valor).toFixed(2), e])).values()];
      const preco = Number(ip.valor_unitario);
      const alertas_preco = Number.isFinite(preco) && preco > 0
        ? unicas.filter((e) => preco > Number(e.valor)).map((e) => ({ ...e, percentual: Math.round((preco / Number(e.valor) - 1) * 1000) / 10 }))
        : [];
      return {
        item_proposta_id: ip.id, item: ip.item_numero, descricao_item: item?.descricao ?? null,
        quantidade_tr: item?.quantidade ?? null, quantidade_ofertada: ip.quantidade ?? null,
        item_encontrado_no_tr: Boolean(item),
        fornecedor: fornPorId[proposta?.fornecedor_id] || null, marca: ip.marca, fabricante: ip.fabricante, modelo: ip.modelo,
        valor_unitario: ip.valor_unitario, estimativas: unicas, alertas_preco,
        referencias_externas: proposta?.referencias_externas || [],
        resumo: linhas.length ? resumir(linhas) : 'aguardando análise',
        aplicaveis: { gerais: linhas.filter((l) => l.escopo === 'geral').length, do_lote: linhas.filter((l) => l.escopo === 'lote').length, do_item: linhas.filter((l) => l.escopo === 'item').length },
        faltantes: linhas.filter((l) => l.faltante).length,
        contagem: linhas.reduce((c, l) => ({ ...c, [l.status]: (c[l.status] || 0) + 1 }), {}),
        linhas,
      };
    });
  }

  // Visão completa do fornecedor: TODOS os requisitos validados do pregão (gerais, todos os itens e habilitação),
  // cada um com um resultado. Item não ofertado aparece como NÃO OFERTADO; a conta fecha com o total validado.
  const GRAVIDADE = { [STATUS.NAO_ATENDE]: 7, [STATUS.REVISAR]: 6, [STATUS.VAGO]: 5, [STATUS.PARCIAL]: 4, [STATUS.NAO_COMPROVADO]: 3, [STATUS.VERIFICAR]: 2, [STATUS.ATENDE]: 1 };
  async function visaoCompleta(pregaoId) {
    const pregao = await repo.obter('pregoes', pregaoId);
    const porLote = julgamentoPorLote(pregao);
    const [documentos, itens, requisitos, propostas, fornecedores, itensProposta, avaliacoes] = await Promise.all([
      repo.buscar('documentos', { pregao_id: pregaoId }), repo.buscar('itens', { pregao_id: pregaoId }, { ordem: 'numero' }),
      repo.buscar('requisitos', { pregao_id: pregaoId, status_validacao: 'validado' }, { ordem: 'codigo' }),
      repo.buscar('propostas', { pregao_id: pregaoId }), repo.buscar('fornecedores'), repo.buscar('itens_proposta', { pregao_id: pregaoId }),
      repo.buscar('avaliacoes', { pregao_id: pregaoId }),
    ]);
    const fornPorId = Object.fromEntries(fornecedores.map((f) => [f.id, f]));
    const descricaoItem = Object.fromEntries(itens.map((i) => [i.numero, i.descricao]));
    const ordenar = (a, b) => String(a.requisito_codigo).localeCompare(String(b.requisito_codigo), 'pt-BR', { numeric: true });
    return propostas.filter((p) => itensProposta.some((i) => i.proposta_id === p.id)).map((proposta) => {
      const meus = itensProposta.filter((i) => i.proposta_id === proposta.id);
      const ofertados = new Set(meus.map((i) => normalizarNumeroItem(i.item_numero, itens)));
      // Lotes: cada item pertence a um lote (coluna "LOTE" do TR); sem lote, o item é o próprio lote.
      const loteDoItem = Object.fromEntries(itens.map((i) => [i.numero, String(i.lote || i.numero)]));
      const lotesDisputados = new Set([...ofertados].map((n) => loteDoItem[n]).filter(Boolean));
      const idsMeus = new Set(meus.map((i) => i.id));
      const minhas = avaliacoes.filter((a) => idsMeus.has(a.item_proposta_id));
      const linhas = requisitos.map((r) => {
        const base = {
          requisito_id: r.id, requisito_codigo: r.codigo, secao: r.secao, atributo: r.atributo, obrigatorio: r.obrigatorio,
          exigido: r.origem?.trecho, pagina_edital: r.origem?.pagina, fonte: fonteDoDocumento(documentos, r.origem?.documento_id),
          grupo: r.categoria === 'HABILITACAO' ? 'habilitacao' : escopoDoRequisito(r) === 'item' ? `item_${r.item_numero}` : escopoDoRequisito(r) === 'lote' ? `lotecomum_${r.lote}` : 'geral',
          grupo_nome: r.categoria === 'HABILITACAO' ? 'Habilitação'
            : escopoDoRequisito(r) === 'item' ? `Item ${r.item_numero}${descricaoItem[r.item_numero] ? ` · ${descricaoItem[r.item_numero]}` : ''}${porLote && loteDoItem[normalizarNumeroItem(r.item_numero)] ? ` (lote ${loteDoItem[normalizarNumeroItem(r.item_numero)]})` : ''}`
            : escopoDoRequisito(r) === 'lote' ? `Lote ${r.lote} · requisitos comuns` : 'Geral',
        };
        if (r.categoria !== 'HABILITACAO' && r.item_numero != null && !ofertados.has(normalizarNumeroItem(r.item_numero))) {
          const lote = loteDoItem[normalizarNumeroItem(r.item_numero)];
          const obrigatorio = porLote && lotesDisputados.has(lote);
          return { ...base, status: 'NÃO OFERTADO', avaliacao_id: null, faltante: false,
            justificativa: obrigatorio
              ? `O item ${r.item_numero} faz parte do lote ${lote}, que o fornecedor disputa, e não foi ofertado (ver "Oferta completa do lote").`
              : `O fornecedor não ofertou o item ${r.item_numero}.` };
        }
        if (r.categoria !== 'HABILITACAO' && escopoDoRequisito(r) === 'lote' && !lotesDisputados.has(String(r.lote))) {
          return { ...base, status: 'NÃO OFERTADO', justificativa: `O fornecedor não disputou o lote ${r.lote}.`, avaliacao_id: null, faltante: false };
        }
        // Gerais (e comuns ao lote) avaliados em mais de um item: vale o resultado mais grave.
        const avs = minhas.filter((a) => a.requisito_id === r.id).sort((x, y) => (GRAVIDADE[y.status] ?? 0) - (GRAVIDADE[x.status] ?? 0));
        const a = avs[0];
        if (!a) return { ...base, status: 'AGUARDANDO ANÁLISE', justificativa: 'Clique em "Iniciar análise" para comparar este requisito.', avaliacao_id: null, faltante: false };
        return {
          ...base, avaliacao_id: a.id, status: a.status, justificativa: a.justificativa, metodo: a.metodo, aliases: a.aliases,
          ofertado: a.evidencia?.trecho ?? null, pagina_proposta: a.evidencia?.pagina ?? null, faltante: Boolean(a.faltante),
          revisao_status: a.revisao_status || 'pendente', revisao_parecer: a.revisao_parecer,
        };
      }).sort((x, y) => {
        // Ordem: Geral, depois cada lote (comuns do lote antes dos itens dele), Habilitação por último.
        const num = (v) => String(v ?? '').padStart(4, '0');
        const ordemGrupo = (g) => {
          if (g === 'geral') return '0';
          if (g === 'habilitacao') return '9';
          if (g.startsWith('lotecomum_')) return `1-${num(g.slice(10))}-0`;
          const n = g.slice(5);
          return `1-${num(loteDoItem[n] ?? n)}-1-${num(n)}`;
        };
        return ordemGrupo(x.grupo).localeCompare(ordemGrupo(y.grupo), 'pt-BR', { numeric: true }) || ordenar(x, y);
      });
      // Julgamento por lote: uma linha por lote disputado, conferindo se TODOS os itens foram ofertados
      // e comparando o valor total ofertado no lote com o estimado.
      if (porLote) {
        for (const lote of [...lotesDisputados].sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true }))) {
          const doLote = itens.filter((i) => loteDoItem[i.numero] === lote);
          const faltam = doLote.filter((i) => !ofertados.has(i.numero));
          const valor = (lista, campo, qtd) => lista.reduce((s, i) => s + (Number(i[campo]) || 0) * (Number(i[qtd]) || 0), 0);
          const ofertadoLote = valor(meus.filter((ip) => loteDoItem[normalizarNumeroItem(ip.item_numero, itens)] === lote), 'valor_unitario', 'quantidade');
          const estimadoLote = valor(doLote, 'valor_unitario_estimado', 'quantidade');
          const brl = (v) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
          const preco = ofertadoLote && estimadoLote ? ` Valor total ofertado no lote: ${brl(ofertadoLote)} (estimado: ${brl(estimadoLote)}${ofertadoLote > estimadoLote ? `, ${(((ofertadoLote / estimadoLote) - 1) * 100).toFixed(1).replace('.', ',')}% acima` : ''}).` : '';
          linhas.unshift({
            requisito_id: `lote-${lote}`, requisito_codigo: `LOTE-${lote}`, secao: `Lote ${lote}`, atributo: 'oferta_completa_do_lote', obrigatorio: true,
            exigido: `Julgamento por lote: ofertar todos os itens do lote ${lote} (${doLote.map((i) => `item ${i.numero}${i.descricao ? ` – ${i.descricao}` : ''}`).join('; ')}).`,
            pagina_edital: null, fonte: { sigla: 'Edital', arquivo: 'critério de julgamento' }, grupo: `lote_${lote}`, grupo_nome: `Lote ${lote} · oferta completa`,
            status: faltam.length ? STATUS.NAO_ATENDE : STATUS.ATENDE, avaliacao_id: null, faltante: false, metodo: 'regra',
            ofertado: `Itens ofertados no lote: ${doLote.filter((i) => ofertados.has(i.numero)).map((i) => i.numero).join(', ') || 'nenhum'}`,
            justificativa: (faltam.length
              ? `Proposta incompleta para o lote ${lote}: não foram ofertados o(s) item(ns) ${faltam.map((i) => i.numero).join(', ')}.`
              : `Todos os itens do lote ${lote} foram ofertados.`) + preco,
          });
        }
      }
      const contagem = linhas.reduce((c, l) => ({ ...c, [l.status]: (c[l.status] || 0) + 1 }), {});
      const grupos = [...new Map(linhas.map((l) => [l.grupo, l.grupo_nome])).entries()].map(([chave, nome]) => ({
        chave, nome, total: linhas.filter((l) => l.grupo === chave).length,
        contagem: linhas.filter((l) => l.grupo === chave).reduce((c, l) => ({ ...c, [l.status]: (c[l.status] || 0) + 1 }), {}),
      }));
      const avaliadas = linhas.filter((l) => !['NÃO OFERTADO', 'AGUARDANDO ANÁLISE'].includes(l.status));
      return {
        proposta_id: proposta.id, fornecedor: fornPorId[proposta.fornecedor_id] || null,
        itens_ofertados: [...ofertados].sort(), total: linhas.length, faltantes: linhas.filter((l) => l.faltante).length,
        resumo: avaliadas.length ? resumir(avaliadas) : 'aguardando análise', contagem, grupos, linhas, julgamento_por_lote: porLote,
      };
    });
  }

  // Texto de recusa ou de diligência de uma proposta, montado a partir dos resultados (sem IA).
  async function gerarTexto(propostaId, { tipo = 'recusa', incluir_pendencias: incluirPendencias = false } = {}) {
    if (!['recusa', 'diligencia'].includes(tipo)) throw new ErroUso('Tipo de texto inválido (recusa ou diligencia).');
    const proposta = await repo.obter('propostas', propostaId);
    if (!proposta) throw new ErroUso('Proposta não encontrada.', 404);
    const pregao = await repo.obter('pregoes', proposta.pregao_id);
    const fornecedorVisao = (await visaoCompleta(proposta.pregao_id)).find((f) => f.proposta_id === propostaId);
    if (!fornecedorVisao) throw new ErroUso('A proposta ainda não foi extraída.');
    if (fornecedorVisao.linhas.every((l) => l.status === 'AGUARDANDO ANÁLISE' || l.status === 'NÃO OFERTADO')) throw new ErroUso('Rode a análise antes de gerar o texto.');
    const itensPregao = await repo.buscar('itens', { pregao_id: proposta.pregao_id });
    const itensOfertados = (await repo.buscar('itens_proposta', { proposta_id: propostaId })).map((ip) => {
      const numero = normalizarNumeroItem(ip.item_numero, itensPregao);
      return { numero, descricao: itensPregao.find((x) => x.numero === numero)?.descricao, marca: ip.marca, modelo: ip.modelo, quantidade: ip.quantidade, valor_unitario: ip.valor_unitario };
    });
    return montarTexto({ pregao, fornecedorVisao, itensOfertados, tipo, incluirPendencias: Boolean(incluirPendencias), local: config.localTextos });
  }

  // Reescreve o texto com linguagem mais fluida (ia-forte, texto mascarado). Recusa a nova versão
  // se algum requisito citado sumir — a IA só melhora a redação, não muda o conteúdo.
  const PROMPT_REDACAO = carregarPrompt('redacao_texto');
  async function melhorarTextoComIA(propostaId, { texto, codigos = [] }) {
    if (!roteador) throw new ErroUso('IA indisponível.');
    if (!texto?.trim()) throw new ErroUso('Gere o texto antes de pedir a melhoria.');
    const proposta = await repo.obter('propostas', propostaId);
    if (!proposta) throw new ErroUso('Proposta não encontrada.', 404);
    try {
      const r = await roteador.executar({
        tarefa: 'redacao_texto', pregaoId: proposta.pregao_id, rota: config.rotas.e6_texto_livre, dados: 'proposta',
        montar: async ({ nuvem }) => ({ mascarado: nuvem, mensagens: [
          { role: 'system', content: PROMPT_REDACAO.texto },
          { role: 'user', content: JSON.stringify({ texto: nuvem ? mascarar(texto) : texto }) },
        ] }),
        validar: (json) => {
          if (typeof json?.texto !== 'string' || json.texto.length < 200) return ['falta o campo "texto"'];
          const sumiram = codigos.filter((c) => !json.texto.includes(`[${c}]`));
          return sumiram.length ? [`os requisitos ${sumiram.join(', ')} sumiram do texto; mantenha todos os códigos entre colchetes`] : [];
        },
      });
      return { texto: r.json.texto, alias: r.alias };
    } catch (erro) {
      throw new ErroUso(`A IA não conseguiu melhorar o texto sem perder conteúdo. O texto original foi mantido. (${erro.message})`, 502);
    }
  }

  async function baixarTextoDoc(texto, tipo) {
    return textoParaDoc(String(texto || ''), tipo === 'diligencia' ? 'Solicitação de diligência' : 'Motivos da recusa');
  }

  async function exportarVisaoCompletaCsv(pregaoId) {
    const dados = await visaoCompleta(pregaoId);
    const esc = celulaCsv;
    const saida = [['Fornecedor', 'CNPJ', 'Grupo', 'Requisito', 'Origem', 'Pág.', 'Exigido (Edital / TR)', 'Ofertado (proposta)', 'Status', 'Faltante', 'Justificativa', 'Revisão'].map(esc).join(';')];
    for (const f of dados) {
      for (const l of f.linhas) {
        saida.push([f.fornecedor?.razao_social, f.fornecedor?.cnpj, l.grupo_nome, l.requisito_codigo, l.fonte?.sigla, l.pagina_edital, l.exigido, l.ofertado,
          l.status, l.faltante ? 'sim' : '', l.justificativa, l.revisao_status].map(esc).join(';'));
      }
    }
    return `\uFEFF${saida.join('\r\n')}`;
  }

  async function exportarCsv(pregaoId) {
    const dados = await checklist(pregaoId);
    const esc = celulaCsv;
    const linhas = [['Item', 'Fornecedor', 'CNPJ', 'Requisito', 'Seção', 'Exigido (edital)', 'Pág. edital', 'Ofertado (proposta)', 'Pág. proposta', 'Status sugerido', 'Justificativa', 'Método', 'Revisão', 'Parecer'].map(esc).join(';')];
    for (const g of dados) {
      for (const l of g.linhas) {
        linhas.push([g.item, g.fornecedor?.razao_social, g.fornecedor?.cnpj, l.requisito_codigo, l.secao, l.exigido, l.pagina_edital, l.ofertado, l.pagina_proposta,
          l.status, l.justificativa, `${l.metodo}${l.aliases?.length ? ` (${l.aliases.join(', ')})` : ''}`, l.revisao_status, l.revisao_parecer].map(esc).join(';'));
      }
    }
    return `\uFEFF${linhas.join('\r\n')}`; // BOM para o Excel abrir com acentos
  }

  // ---------------------------------------------------------------- edições humanas
  const TIPOS_REQUISITO = ['numerico', 'faixa', 'booleano', 'opcao', 'norma', 'condicional', 'texto_livre', 'verificacao_externa', 'campos_proposta'];
  const numeroOuNulo = (v, campo) => {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(String(v).replace(',', '.'));
    if (!Number.isFinite(n)) throw new ErroUso(`"${campo}" precisa ser um número.`);
    return n;
  };
  // Edição humana de um requisito. Confere os campos antes de gravar, para a régua da análise não ficar inconsistente.
  async function atualizarRequisito(id, patch, usuario) {
    const atual = await repo.obter('requisitos', id);
    if (!atual) throw new ErroUso('Requisito não encontrado.', 404);
    const permitidos = ['status_validacao', 'atributo', 'tipo', 'operador', 'valor', 'valor_min', 'valor_max', 'unidade', 'opcoes', 'obrigatorio', 'condicao'];
    const limpo = Object.fromEntries(Object.entries(patch).filter(([k]) => permitidos.includes(k)));
    if (limpo.status_validacao && !['pendente', 'validado', 'rejeitado'].includes(limpo.status_validacao)) throw new ErroUso('Situação inválida.');
    const editouRegra = Object.keys(limpo).some((k) => k !== 'status_validacao');
    if (editouRegra) {
      const final = { ...atual, ...limpo };
      if (!TIPOS_REQUISITO.includes(final.tipo)) throw new ErroUso('Tipo de requisito inválido.');
      if ('atributo' in limpo) {
        limpo.atributo = String(limpo.atributo || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
        if (!limpo.atributo) throw new ErroUso('Informe o atributo.');
      }
      if ('valor_min' in limpo) limpo.valor_min = numeroOuNulo(limpo.valor_min, 'Mínimo');
      if ('valor_max' in limpo) limpo.valor_max = numeroOuNulo(limpo.valor_max, 'Máximo');
      if (final.tipo === 'numerico') {
        limpo.valor = numeroOuNulo(final.valor, 'Valor');
        if (limpo.valor === null) throw new ErroUso('Requisito numérico precisa de um valor.');
        if (!['>=', '<=', '=', '>', '<'].includes(final.operador)) throw new ErroUso('Escolha o operador (>=, <=, =, >, <).');
      }
      if (final.tipo === 'faixa') {
        const min = 'valor_min' in limpo ? limpo.valor_min : numeroOuNulo(atual.valor_min, 'Mínimo');
        const max = 'valor_max' in limpo ? limpo.valor_max : numeroOuNulo(atual.valor_max, 'Máximo');
        if (min === null || max === null) throw new ErroUso('Faixa precisa de mínimo e máximo.');
        if (min > max) throw new ErroUso('O mínimo não pode ser maior que o máximo.');
      }
      if ('opcoes' in limpo) {
        const lista = Array.isArray(limpo.opcoes) ? limpo.opcoes : String(limpo.opcoes || '').split(/[;,]/);
        limpo.opcoes = lista.map((o) => String(o).trim()).filter(Boolean);
        if (!limpo.opcoes.length) limpo.opcoes = null;
      }
      if (['opcao', 'campos_proposta'].includes(final.tipo) && !(limpo.opcoes ?? atual.opcoes)?.length) throw new ErroUso('Informe as opções permitidas.');
      if ('obrigatorio' in limpo) limpo.obrigatorio = Boolean(limpo.obrigatorio);
      // Quem editou conferiu: o requisito já fica validado, e o registro mostra que foi ajuste humano.
      limpo.status_validacao = limpo.status_validacao || 'validado';
      limpo.extraido_por = `${atual.extraido_por || 'IA'} · editado por ${usuario?.email || 'usuário'}`;
    }
    return repo.atualizar('requisitos', id, limpo);
  }
  // "Validar todos desta aba": geral, lote_N (comuns + itens do lote), número do item ou habilitação.
  async function validarTodos(pregaoId, aba) {
    const [reqs, itens] = await Promise.all([repo.buscar('requisitos', { pregao_id: pregaoId, status_validacao: 'pendente' }), repo.buscar('itens', { pregao_id: pregaoId })]);
    const loteDoItem = Object.fromEntries(itens.map((i) => [i.numero, String(i.lote || i.numero)]));
    const tecnico = (r) => r.categoria !== 'HABILITACAO';
    const filtro = aba === undefined || aba === null ? () => true
      : aba === 'habilitacao' ? (r) => r.categoria === 'HABILITACAO'
      : aba === 'geral' ? (r) => tecnico(r) && r.item_numero == null && !r.lote
      : String(aba).startsWith('lote_') ? (r) => tecnico(r) && (String(r.lote) === String(aba).slice(5) || (r.item_numero != null && loteDoItem[r.item_numero] === String(aba).slice(5)))
      : (r) => tecnico(r) && r.item_numero === String(aba);
    const alvo = reqs.filter(filtro);
    for (const r of alvo) await repo.atualizar('requisitos', r.id, { status_validacao: 'validado' });
    return { validados: alvo.length };
  }
  // Critério do pregão para informação ausente na proposta. Mudar exige rodar a análise de novo.
  async function definirCriterioAusencia(pregaoId, ausenciaReprova) {
    if (!(await repo.obter('pregoes', pregaoId))) throw new ErroUso('Pregão não encontrado.', 404);
    return repo.atualizar('pregoes', pregaoId, { ausencia_reprova: Boolean(ausenciaReprova), atualizado_em: new Date().toISOString() });
  }
  async function revisarAvaliacao(id, { status, parecer }, usuario) {
    if (status && !Object.values(STATUS).includes(status)) throw new ErroUso('Status inválido.');
    const atual = await repo.obter('avaliacoes', id);
    if (!atual) throw new ErroUso('Avaliação não encontrada.', 404);
    return repo.atualizar('avaliacoes', id, {
      status: status || atual.status, revisao_status: status && status !== atual.status ? 'corrigido' : 'confirmado',
      revisao_parecer: parecer ?? null, revisao_usuario: usuario.id, revisao_em: new Date().toISOString(),
    });
  }
  async function corrigirDepara(id, especificacaoId, usuario) {
    const dp = await repo.obter('depara', id);
    if (!dp) throw new ErroUso('Par não encontrado.', 404);
    const req = await repo.obter('requisitos', dp.requisito_id);
    const nova = especificacaoId ? await repo.obter('especificacoes', especificacaoId) : null;
    const antiga = dp.especificacao_id ? await repo.obter('especificacoes', dp.especificacao_id) : null;
    const reg = (spec, corresponde) => repo.inserir('exemplos_treino', { pregao_id: dp.pregao_id, dados: {
      requisito: { secao: req.secao, atributo: req.atributo, trecho: req.origem?.trecho },
      especificacao: { secao: spec.secao_declarada, atributo: spec.atributo_declarado, trecho: spec.origem?.trecho },
      corresponde, validado_por: usuario.email } });
    if (antiga && antiga.id !== nova?.id) await reg(antiga, false); // par recusado também ensina a rede
    if (nova) await reg(nova, true);
    return repo.atualizar('depara', id, { especificacao_id: nova?.id ?? null, metodo: 'humano', validado_por: usuario.id, confianca: 1 });
  }
  async function exportarTreinoJsonl() {
    return (await repo.buscar('exemplos_treino')).map((e) => JSON.stringify(e.dados)).join('\n');
  }
  async function painelIA(pregaoId) {
    const ex = await repo.buscar('execucoes_ia', pregaoId ? { pregao_id: pregaoId } : {});
    const porAlias = {};
    for (const e of ex) {
      const p = porAlias[e.alias] || (porAlias[e.alias] = { alias: e.alias, chamadas: 0, ok: 0, erros: 0, invalidas: 0, tokens: 0, latencia_ms: 0 });
      p.chamadas += 1; p.tokens += e.tokens || 0; p.latencia_ms += e.latencia_ms || 0;
      if (e.status === 'ok') p.ok += 1; else if (e.status === 'invalido') p.invalidas += 1; else p.erros += 1;
      p.hoje = (p.hoje || 0) + (Date.now() - new Date(e.criado_em) < 86400000 ? 1 : 0);
    }
    // Quem está por trás de cada frente: o modelo que de fato respondeu (o New API devolve o nome real).
    const ordenadas = [...ex].sort((a, b) => String(a.criado_em).localeCompare(String(b.criado_em)));
    const nomeAmigavel = (m) => {
      const t = String(m || '').toLowerCase();
      if (t.includes('deepseek')) return 'DeepSeek';
      if (/claude|sonnet|haiku|opus/.test(t)) return 'Claude';
      if (t.includes('gemini')) return 'Gemini';
      if (t.includes('qwen')) return 'Qwen (Ollama)';
      if (/gpt-|\bo\d/.test(t)) return 'OpenAI';
      return m || null;
    };
    const frentes = ['ia-leve', 'ia-media', 'ia-forte'].map((alias) => {
      const doAlias = ordenadas.filter((e) => e.alias === alias && e.modelo && e.modelo !== alias);
      const modelo = doAlias.at(-1)?.modelo || null;
      const configuradaNuvem = config.aliasesNuvem.includes(alias);
      const respondeuNuvem = MODELO_DE_NUVEM.test(String(modelo || ''));
      const nuvem = configuradaNuvem || respondeuNuvem;
      const soPublicos = config.aliasesSoPublicos.includes(alias);
      const gratuita = !nuvem || (alias === 'ia-leve' && /gemini/i.test(String(modelo || 'gemini')));
      return {
        alias, modelo, nome: nomeAmigavel(modelo), nuvem, so_publicos: soPublicos, pago: !gratuita,
        descricao: [
          nomeAmigavel(modelo) || (alias === 'ia-leve' ? 'Gemini Flash-Lite' : alias === 'ia-forte' ? 'Claude' : (configuradaNuvem ? 'IA na nuvem' : 'IA local')),
          gratuita ? (nuvem ? 'gratuito (com limites)' : 'gratuito, no seu computador') : 'pago',
          soPublicos ? 'só documentos públicos' : nuvem ? 'propostas só mascaradas' : 'propostas não saem do computador',
        ].join(' · '),
        // PERIGO: respondeu com modelo de nuvem, mas o .env diz que é local
        alerta: respondeuNuvem && !configuradaNuvem
          ? `A ${alias} está respondendo com "${modelo}" (nuvem), mas não está em ALIASES_NUVEM no .env. Por segurança o sistema já passou a mascarar as propostas para ela; corrija o .env para ficar permanente.`
          : null,
      };
    });
    return {
      por_alias: Object.values(porAlias).map((p) => ({ ...p, latencia_media_ms: p.chamadas ? Math.round(p.latencia_ms / p.chamadas) : 0 })),
      frentes,
      pagas: frentes.filter((f) => f.pago).map((f) => f.alias),
      ultimas: ex.slice(-30).reverse(),
    };
  }

  return {
    garantirAdmin, entrar, usuarioDoToken, criarUsuario, criarPregao, enviarDocumento, enviarProposta, iniciarAnalise, reprocessarErros,
    painelPregao, progressoPregao, definirCriterioAusencia, definirJulgamento, visaoCompleta, exportarVisaoCompletaCsv, gerarTexto, melhorarTextoComIA, baixarTextoDoc, especificacoesDaProposta, checklist, exportarCsv, atualizarRequisito, validarTodos, revisarAvaliacao, corrigirDepara,
    exportarTreinoJsonl, painelIA,
    listarPregoes: listarPregoesDo, excluirUsuario, situacaoEmail, testarEmail, cadastrarSe, esqueciSenha, redefinirComLink, emailAtivo, pendencias, decidirCadastro, sair, trocarMinhaSenha, listarUsuarios, atualizarUsuario, redefinirSenha, exigirPregao, exigirRegistro, ehAdmin,
    excluirPregao: (id) => repo.remover('pregoes', { id }),
  };
}
