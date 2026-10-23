// Servidor HTTP da API, só com a biblioteca padrão do Node (sem Express).
// Upload: o corpo multipart é lido com a classe Request do próprio Node (formData()).
import http from 'node:http';
import { ErroUso } from '../servicos/aplicacao.js';
import { detectarInjecao, inspecionarObjeto, ehVarredura } from '../nucleo/ameacas.js';
import { NOMES_EVENTO } from '../servicos/seguranca.js';

// Monitor desligado (quando não for passado): não registra nada.
const SEM_MONITOR = { registrar: async () => {}, ipBloqueado: async () => false, bloquear: async () => {}, podeBloquear: () => false,
  listar: async () => [], resumo: async () => ({}), desbloquear: async () => null };

export function criarServidorHttp({ app, config, seguranca = SEM_MONITOR }) {
  const seg = seguranca;
  const rotas = [];
  // acesso: 'publica' (sem login) | 'senha' (logado, mesmo com senha temporária) | 'logado' | 'admin'
  const rota = (metodo, padrao, acesso, funcao) => {
    const nomes = [];
    const re = new RegExp(`^${padrao.replace(/:([a-z_]+)/g, (_, n) => { nomes.push(n); return '([^/]+)'; })}$`);
    rotas.push({ metodo, re, nomes, acesso, funcao });
  };
  // Conferências de acesso (licitante só enxerga os pregões que criou)
  const pregao = (usuario, id) => app.exigirPregao(usuario, id);
  const registro = (usuario, tabela, id) => app.exigirRegistro(usuario, tabela, id);

  // -------------------------------------------------------------- sessão
  rota('GET', '/api/saude', 'publica', async () => ({ status: 'ok' }));
  rota('POST', '/api/login', 'publica', async ({ corpo }) => app.entrar(corpo.email, corpo.senha));
  rota('POST', '/api/sair', 'senha', async ({ token }) => app.sair(token));
  rota('POST', '/api/cadastro', 'publica', async ({ corpo, ip }) => app.cadastrarSe(corpo, ip));
  rota('POST', '/api/esqueci-senha', 'publica', async ({ corpo, ip }) => app.esqueciSenha(corpo, ip));
  rota('POST', '/api/redefinir-senha', 'publica', async ({ corpo, ip }) => app.redefinirComLink(corpo, ip));
  rota('GET', '/api/eu', 'senha', async ({ usuario }) => usuario);
  rota('POST', '/api/eu/senha', 'senha', async ({ corpo, usuario }) => app.trocarMinhaSenha(usuario, corpo));

  // -------------------------------------------------------------- usuários (só administrador)
  rota('GET', '/api/usuarios', 'admin', async () => app.listarUsuarios());
  rota('POST', '/api/usuarios', 'admin', async ({ corpo }) => app.criarUsuario(corpo));
  rota('PATCH', '/api/usuarios/:id', 'admin', async ({ p, corpo, usuario }) => app.atualizarUsuario(p.id, corpo, usuario));
  rota('POST', '/api/usuarios/:id/redefinir-senha', 'admin', async ({ p }) => app.redefinirSenha(p.id));
  rota('DELETE', '/api/usuarios/:id', 'admin', async ({ p, usuario }) => app.excluirUsuario(p.id, usuario));
  rota('GET', '/api/pendencias', 'admin', async () => app.pendencias());
  rota('GET', '/api/email/situacao', 'admin', async () => app.situacaoEmail());
  rota('POST', '/api/email/teste', 'admin', async ({ corpo, usuario }) => app.testarEmail(corpo.para || usuario.email));
  rota('POST', '/api/usuarios/:id/aprovar', 'admin', async ({ p }) => app.decidirCadastro(p.id, true));
  rota('POST', '/api/usuarios/:id/recusar', 'admin', async ({ p }) => app.decidirCadastro(p.id, false));

  // -------------------------------------------------------------- pregões
  rota('GET', '/api/pregoes', 'logado', async ({ usuario }) => (await app.listarPregoes(usuario)).reverse());
  rota('POST', '/api/pregoes', 'logado', async ({ corpo, usuario }) => app.criarPregao(corpo, usuario));
  rota('GET', '/api/pregoes/:id', 'logado', async ({ p, usuario }) => { await pregao(usuario, p.id); return app.painelPregao(p.id); });
  rota('DELETE', '/api/pregoes/:id', 'logado', async ({ p, usuario }) => { await pregao(usuario, p.id); await app.excluirPregao(p.id); return { ok: true }; });
  rota('POST', '/api/pregoes/:id/documentos', 'logado', async ({ p, form, usuario }) => {
    await pregao(usuario, p.id);
    const arquivos = (form?.getAll('arquivos') || []).filter((f) => typeof f === 'object');
    if (!arquivos.length) throw new ErroUso('Selecione ao menos um PDF.');
    const papel = String(form.get('papel') || 'edital');
    const docs = [];
    for (const f of arquivos) docs.push(await app.enviarDocumento(p.id, papel, f));
    return docs.map(({ caminho, ...d }) => d);
  });
  rota('POST', '/api/pregoes/:id/propostas', 'logado', async ({ p, form, usuario }) => {
    await pregao(usuario, p.id);
    const arquivo = form?.get('arquivo');
    if (!arquivo || typeof arquivo !== 'object') throw new ErroUso('Selecione o PDF da proposta.');
    return app.enviarProposta(p.id, { cnpj: form.get('cnpj'), razao_social: form.get('razao_social') }, arquivo);
  });
  rota('POST', '/api/pregoes/:id/requisitos/validar-todos', 'logado', async ({ p, corpo, usuario }) => { await pregao(usuario, p.id); return app.validarTodos(p.id, corpo.item_numero); });
  rota('POST', '/api/pregoes/:id/analisar', 'logado', async ({ p, usuario }) => { await pregao(usuario, p.id); return app.iniciarAnalise(p.id); });
  rota('PATCH', '/api/pregoes/:id/julgamento', 'logado', async ({ p, corpo, usuario }) => { await pregao(usuario, p.id); return app.definirJulgamento(p.id, corpo.por_lote ?? null); });
  rota('PATCH', '/api/pregoes/:id/criterio-ausencia', 'logado', async ({ p, corpo, usuario }) => { await pregao(usuario, p.id); return app.definirCriterioAusencia(p.id, corpo.ausencia_reprova); });
  rota('POST', '/api/pregoes/:id/reprocessar-erros', 'logado', async ({ p, usuario }) => { await pregao(usuario, p.id); return app.reprocessarErros(p.id); });
  rota('GET', '/api/pregoes/:id/checklist', 'logado', async ({ p, usuario }) => { await pregao(usuario, p.id); return app.checklist(p.id); });
  rota('GET', '/api/pregoes/:id/visao-completa', 'logado', async ({ p, usuario }) => { await pregao(usuario, p.id); return app.visaoCompleta(p.id); });
  rota('GET', '/api/pregoes/:id/progresso', 'logado', async ({ p, usuario }) => { await pregao(usuario, p.id); return app.progressoPregao(p.id); });
  rota('GET', '/api/pregoes/:id/visao-completa.csv', 'logado', async ({ p, usuario }) => {
    await pregao(usuario, p.id);
    return { __arquivo: await app.exportarVisaoCompletaCsv(p.id), tipo: 'text/csv; charset=utf-8', nome: `visao-completa-${p.id}.csv` };
  });
  rota('GET', '/api/pregoes/:id/checklist.csv', 'logado', async ({ p, usuario }) => {
    await pregao(usuario, p.id);
    return { __arquivo: await app.exportarCsv(p.id), tipo: 'text/csv; charset=utf-8', nome: `checklist-${p.id}.csv` };
  });

  // -------------------------------------------------------------- registros de um pregão (confere o dono pelo pregão)
  rota('GET', '/api/propostas/:id/especificacoes', 'logado', async ({ p, usuario }) => { await registro(usuario, 'propostas', p.id); return app.especificacoesDaProposta(p.id); });
  rota('POST', '/api/propostas/:id/texto', 'logado', async ({ p, corpo, usuario }) => { await registro(usuario, 'propostas', p.id); return app.gerarTexto(p.id, corpo); });
  rota('POST', '/api/propostas/:id/texto/ia', 'logado', async ({ p, corpo, usuario }) => { await registro(usuario, 'propostas', p.id); return app.melhorarTextoComIA(p.id, corpo); });
  rota('PATCH', '/api/requisitos/:id', 'logado', async ({ p, corpo, usuario }) => { await registro(usuario, 'requisitos', p.id); return app.atualizarRequisito(p.id, corpo, usuario); });
  rota('PATCH', '/api/avaliacoes/:id', 'logado', async ({ p, corpo, usuario }) => { await registro(usuario, 'avaliacoes', p.id); return app.revisarAvaliacao(p.id, corpo, usuario); });
  rota('PATCH', '/api/depara/:id', 'logado', async ({ p, corpo, usuario }) => { await registro(usuario, 'depara', p.id); return app.corrigirDepara(p.id, corpo.especificacao_id ?? null, usuario); });
  rota('POST', '/api/texto.doc', 'logado', async ({ corpo }) => ({
    __arquivo: await app.baixarTextoDoc(corpo.texto, corpo.tipo), tipo: 'application/msword', nome: corpo.tipo === 'diligencia' ? 'diligencia.doc' : 'motivos-da-recusa.doc',
  }));

  // -------------------------------------------------------------- monitor de segurança (só administrador)
  rota('GET', '/api/seguranca/resumo', 'admin', async () => seg.resumo());
  rota('GET', '/api/seguranca/eventos', 'admin', async ({ q }) => seg.listar({ tipo: q.get('tipo'), gravidade: q.get('gravidade'), ip: q.get('ip'), limite: q.get('limite') }));
  rota('GET', '/api/seguranca/eventos.csv', 'admin', async () => {
    const { celulaCsv } = await import('../servicos/aplicacao.js');
    const linhas = [['Data/hora', 'Tipo', 'Gravidade', 'IP', 'E-mail', 'Método', 'Endereço', 'Detalhe'].map(celulaCsv).join(';')];
    for (const e of await seg.listar({ limite: 2000 })) {
      linhas.push([new Date(e.criado_em).toLocaleString('pt-BR'), e.tipo_nome, e.gravidade, e.ip, e.email, e.metodo, e.caminho, e.detalhe].map(celulaCsv).join(';'));
    }
    return { __arquivo: `\uFEFF${linhas.join('\r\n')}`, tipo: 'text/csv; charset=utf-8', nome: 'eventos-seguranca.csv' };
  });
  rota('POST', '/api/seguranca/bloqueios', 'admin', async ({ corpo, usuario }) => {
    const ip = String(corpo.ip || '').trim();
    if (!/^[0-9a-f.:]{3,45}$/i.test(ip)) throw new ErroUso('Informe um IP válido.');
    const minutos = Math.min(Math.max(Number(corpo.minutos) || 60, 5), 60 * 24 * 365);
    return seg.bloquear(ip, `Manual (${usuario.nome}): ${String(corpo.motivo || 'sem motivo informado').slice(0, 200)}`, minutos, usuario.id, false);
  });
  rota('POST', '/api/seguranca/bloqueios/:id/desbloquear', 'admin', async ({ p }) => {
    const b = await seg.desbloquear(p.id);
    if (!b) throw new ErroUso('Bloqueio não encontrado.', 404);
    return b;
  });

  // -------------------------------------------------------------- só administrador
  rota('GET', '/api/treino.jsonl', 'admin', async () => ({ __arquivo: await app.exportarTreinoJsonl(), tipo: 'application/jsonl; charset=utf-8', nome: 'exemplos_treino.jsonl' }));
  rota('GET', '/api/ia/painel', 'admin', async ({ q }) => app.painelIA(q.get('pregao')));

  // -------------------------------------------------------------- registro no monitor de segurança
  const falhasPorIp = new Map(); // força bruta vinda do mesmo IP, mesmo trocando de e-mail
  async function registrarFalha(erro, { url, corpo, usuario, evento, ip }) {
    if (!(erro instanceof ErroUso)) return;
    const caminho = url.pathname;
    if (caminho === '/api/login') {
      const email = typeof corpo.email === 'string' ? corpo.email : null;
      if (erro.status === 429) return evento('forca_bruta', { email, detalhe: 'E-mail bloqueado por 15 min após 5 senhas erradas seguidas' });
      if (erro.status === 401) {
        await evento('login_falhou', { email, detalhe: 'E-mail ou senha inválidos' });
        const agora = Date.now();
        const lista = (falhasPorIp.get(ip) || []).filter((t) => agora - t < 15 * 60 * 1000);
        lista.push(agora); falhasPorIp.set(ip, lista);
        if (lista.length === 10) {
          await evento('forca_bruta', { email, detalhe: `${lista.length} senhas erradas do mesmo IP em 15 min` });
          if (seg.podeBloquear(ip)) await seg.bloquear(ip, 'Automático: força bruta (10 senhas erradas em 15 min)', config.seguranca?.minutosBloqueio || 60, null, true);
        }
      }
      if (erro.status === 403) return evento('auditoria', { email, detalhe: 'Tentou entrar com cadastro ainda não aprovado' });
      return undefined;
    }
    if (erro.status === 429) return evento('limite_excedido', { email: typeof corpo.email === 'string' ? corpo.email : usuario?.email, detalhe: `Excesso de pedidos em ${caminho}` });
    if (erro.indevido) return evento('acesso_indevido', { email: usuario?.email, usuarioId: usuario?.id, detalhe: 'Tentou abrir um pregão de outra pessoa' });
    return undefined;
  }
  const AUDITORIA = [
    [/^POST \/api\/usuarios$/, (c, s) => `Criou o usuário ${s?.usuario?.email} (${s?.usuario?.perfil_nome})`],
    [/^DELETE \/api\/usuarios\//, (c, s) => `Excluiu o usuário ${s?.email}${s?.pregoes_transferidos ? ` (${s.pregoes_transferidos} pregão(ões) passaram para quem excluiu)` : ''}`],
    [/^PATCH \/api\/usuarios\//, (c, s) => `Alterou ${s?.email}: ${Object.entries(c).map(([k, v]) => `${k}=${v}`).join(', ')}`],
    [/^POST \/api\/usuarios\/.+\/redefinir-senha$/, (c, s) => `Gerou senha temporária para ${s?.usuario?.email}`],
    [/^POST \/api\/usuarios\/.+\/aprovar$/, (c, s) => `Aprovou o cadastro de ${s?.email}`],
    [/^POST \/api\/usuarios\/.+\/recusar$/, (c, s) => `Recusou o cadastro de ${s?.email}`],
    [/^POST \/api\/seguranca\/bloqueios$/, (c) => `Bloqueou o IP ${c.ip}`],
    [/^POST \/api\/seguranca\/bloqueios\/.+\/desbloquear$/, (c, s) => `Desbloqueou o IP ${s?.ip}`],
    [/^POST \/api\/eu\/senha$/, () => 'Trocou a própria senha'],
    [/^POST \/api\/redefinir-senha$/, () => 'Criou nova senha pelo link do e-mail'],
    [/^POST \/api\/cadastro$/, (c) => `Pediu cadastro: ${c.email}`],
    [/^DELETE \/api\/pregoes\//, () => 'Excluiu um pregão'],
  ];
  async function registrarSucesso({ url, metodo, corpo, usuario, saida, evento }) {
    if (url.pathname === '/api/login' && saida?.usuario) {
      return evento('login_ok', { email: saida.usuario.email, usuarioId: saida.usuario.id, detalhe: `Entrou como ${saida.usuario.perfil_nome}` });
    }
    const chave = `${metodo} ${url.pathname}`;
    const regra = AUDITORIA.find(([re]) => re.test(chave));
    if (regra) return evento('auditoria', { email: usuario?.email ?? (typeof corpo.email === 'string' ? corpo.email : null), usuarioId: usuario?.id, detalhe: regra[1](corpo, saida) });
    return undefined;
  }
  void NOMES_EVENTO;

  // -------------------------------------------------------------- tratamento
  function cabecalhosCors(req) {
    const origem = req.headers.origin;
    if (!origem || !config.origens.includes(origem)) return {};
    return { 'Access-Control-Allow-Origin': origem, 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS', Vary: 'Origin' };
  }

  // Limite de tamanho: arquivos até MAX_PDF_MB (+ folga); JSON até 2 MB.
  async function lerCorpo(req, ehArquivo) {
    const limite = ehArquivo ? (config.maxPdfMb + 5) * 1024 * 1024 : 2 * 1024 * 1024;
    const partes = [];
    let total = 0;
    for await (const c of req) {
      total += c.length;
      if (total > limite) throw new ErroUso('Envio acima do limite de tamanho.', 413);
      partes.push(c);
    }
    return Buffer.concat(partes);
  }

  return http.createServer(async (req, res) => {
    const cors = cabecalhosCors(req);
    // Cabeçalhos de segurança em toda resposta da API
    const seguranca = { 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store' };
    const responder = (status, corpo, extra = {}) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...seguranca, ...cors, ...extra });
      res.end(JSON.stringify(corpo));
    };
    if (req.method === 'OPTIONS') { res.writeHead(204, { ...seguranca, ...cors }); return res.end(); }
    const url = new URL(req.url, 'http://localhost');
    // IP de quem pede: o nginx informa no X-Forwarded-For; só confiamos nele se a conexão vier da rede interna.
    const remoto = String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
    const interno = /^(127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|::1$)/.test(remoto);
    const ip = (interno && req.headers['x-forwarded-for'] ? String(req.headers['x-forwarded-for']).split(',')[0].trim() : remoto) || remoto;
    const navegador = String(req.headers['user-agent'] || '').slice(0, 200);
    const evento = (tipo, extra = {}) => seg.registrar({ tipo, ip, metodo: req.method, caminho: url.pathname, navegador, ...extra }).catch((e) => console.warn('[segurança]', e.message));

    if (url.pathname !== '/api/saude' && await seg.ipBloqueado(ip)) {
      return responder(403, { erro: 'Acesso bloqueado temporariamente por segurança. Se for engano, fale com o administrador.' });
    }
    // Injeção no endereço (caminho ou parâmetros): recusada sempre
    let enderecoLegivel = url.pathname + url.search;
    try { enderecoLegivel = decodeURIComponent(enderecoLegivel); } catch { /* endereço malformado: analisa como veio */ }
    const injecaoUrl = detectarInjecao(enderecoLegivel);
    if (injecaoUrl) {
      await evento('injecao', { detalhe: `Padrão de ${injecaoUrl} no endereço: ${enderecoLegivel.slice(0, 120)}` });
      return responder(400, { erro: 'Requisição recusada por segurança.' });
    }
    const achada = rotas.map((r) => ({ r, m: r.metodo === req.method && url.pathname.match(r.re) })).find((x) => x.m);
    if (!achada) {
      if (ehVarredura(url.pathname)) await evento('varredura', { detalhe: `Procurou ${url.pathname}` });
      return responder(404, { erro: 'Rota não encontrada.' });
    }
    try {
      let p;
      try { p = Object.fromEntries(achada.r.nomes.map((n, i) => [n, decodeURIComponent(achada.m[i + 1])])); } catch { return responder(404, { erro: 'Não encontrado.' }); }
      // Códigos (:id) são sempre UUID: qualquer outra coisa é recusada antes de chegar ao banco.
      if (Object.values(p).some((v) => !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v))) return responder(404, { erro: 'Não encontrado.' });
      const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
      const usuario = await app.usuarioDoToken(token);
      const { acesso } = achada.r;
      // token com formato impossível = forjado (sessão só expirada não conta)
      if (token && !usuario && !/^[0-9a-f]{64}$/.test(token)) await evento('token_invalido', { detalhe: 'Token de sessão com formato inválido' });
      if (acesso !== 'publica' && !usuario) return responder(401, { erro: 'Sessão expirada. Entre novamente.' });
      if (acesso === 'admin' && usuario.perfil !== 'admin') {
        await evento('acesso_negado', { email: usuario.email, usuarioId: usuario.id, detalhe: 'Licitante tentou abrir uma área de administrador' });
        return responder(403, { erro: 'Acesso permitido só para administradores.' });
      }
      if (acesso !== 'publica' && acesso !== 'senha' && usuario.trocar_senha) return responder(403, { erro: 'Troque a sua senha temporária para continuar.', trocar_senha: true });

      const tipo = req.headers['content-type'] || '';
      const bruto = ['POST', 'PATCH'].includes(req.method) ? await lerCorpo(req, tipo.startsWith('multipart/form-data')) : Buffer.alloc(0);
      let corpo = {}; let form = null;
      if (tipo.startsWith('multipart/form-data')) {
        form = await new Request('http://localhost', { method: 'POST', headers: { 'content-type': tipo }, body: bruto }).formData();
      } else if (bruto.length) {
        try { corpo = JSON.parse(bruto.toString('utf8')); } catch { throw new ErroUso('JSON inválido.'); }
        if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) throw new ErroUso('JSON inválido.');
      }
      // Injeção nos campos enviados (JSON ou campos de texto do formulário). O conteúdo de senhas nunca é gravado.
      const campos = form ? Object.fromEntries([...form.entries()].map(([k, v]) => [k, typeof v === 'string' ? v : v?.name])) : corpo;
      const achado = inspecionarObjeto(campos);
      if (achado) {
        const sensivel = /senha|token|nova|atual/i.test(achado.campo);
        const valor = sensivel ? '' : `: ${String(achado.campo.split('.').reduce((o, k) => o?.[k], campos) ?? '').slice(0, 80)}`;
        await evento('injecao', { email: typeof corpo.email === 'string' ? corpo.email : usuario?.email, usuarioId: usuario?.id,
          detalhe: `Padrão de ${achado.tipo} no campo "${achado.campo}"${valor}` });
        // Em telas públicas (login, cadastro, senha), recusa. Logado, só registra: as consultas ao banco já são protegidas.
        if (acesso === 'publica') return responder(400, { erro: 'Requisição recusada por segurança.' });
      }
      // Endereço de quem pede (atrás do nginx, vem no X-Forwarded-For) — usado nos limites de pedidos públicos.
      const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
      let saida;
      try {
        saida = await achada.r.funcao({ p, q: url.searchParams, corpo, form, usuario, token, ip });
      } catch (erro) {
        await registrarFalha(erro, { url, corpo, usuario, evento, ip });
        throw erro;
      }
      await registrarSucesso({ url, metodo: req.method, corpo, usuario, saida, evento });
      if (saida?.__arquivo !== undefined) {
        res.writeHead(200, { 'Content-Type': saida.tipo, 'Content-Disposition': `attachment; filename="${String(saida.nome).replace(/[^\w.-]/g, '_')}"`, ...seguranca, ...cors });
        return res.end(saida.__arquivo);
      }
      return responder(200, saida ?? null);
    } catch (erro) {
      if (erro instanceof ErroUso) return responder(erro.status, { erro: erro.message });
      // Erro inesperado: detalhes só no terminal, nunca na resposta (não expõe estrutura interna).
      console.error('[api]', erro);
      return responder(500, { erro: 'Erro interno. Veja o terminal da API.' });
    }
  });
}
