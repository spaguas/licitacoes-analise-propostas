// Comunicação com a API. O token de sessão fica só na memória da aba (some ao fechar).
let token = null;
let aoExpirar = () => {};

export function definirSessao(novoToken, callbackExpirou) {
  token = novoToken;
  if (callbackExpirou) aoExpirar = callbackExpirou;
}

async function chamar(caminho, { metodo = 'GET', corpo, formulario } = {}) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  let body;
  if (formulario) body = formulario;
  else if (corpo !== undefined) { body = JSON.stringify(corpo); headers['Content-Type'] = 'application/json'; }
  let resposta;
  try {
    resposta = await fetch(`/api${caminho}`, { method: metodo, headers, body });
  } catch {
    throw new Error('Não foi possível falar com a API. Confira se ela está rodando.');
  }
  if (resposta.status === 401 && caminho !== '/login') { aoExpirar(); throw new Error('Sessão expirada. Entre novamente.'); }
  const tipo = resposta.headers.get('content-type') || '';
  const dados = tipo.includes('application/json') ? await resposta.json() : await resposta.text();
  if (!resposta.ok) {
    if (!dados?.erro && [502, 503, 504].includes(resposta.status)) {
      throw new Error('O sistema não está respondendo agora (pode estar reiniciando depois de uma atualização). Aguarde alguns segundos e tente de novo. Se continuar, avise o administrador.');
    }
    throw new Error(dados?.erro || `Erro ${resposta.status}`);
  }
  return dados;
}

async function baixar(caminho, nome) {
  const r = await fetch(`/api${caminho}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error('Não foi possível baixar o arquivo.');
  const url = URL.createObjectURL(await r.blob());
  const a = Object.assign(document.createElement('a'), { href: url, download: nome });
  a.click();
  URL.revokeObjectURL(url);
}

export const api = {
  entrar: (email, senha) => chamar('/login', { metodo: 'POST', corpo: { email, senha } }),
  sair: () => chamar('/sair', { metodo: 'POST' }).catch(() => {}),
  cadastrar: (dados) => chamar('/cadastro', { metodo: 'POST', corpo: dados }),
  esqueciSenha: (email) => chamar('/esqueci-senha', { metodo: 'POST', corpo: { email } }),
  redefinirPeloLink: (token, nova) => chamar('/redefinir-senha', { metodo: 'POST', corpo: { token, nova } }),
  pendencias: () => chamar('/pendencias'),
  situacaoEmail: () => chamar('/email/situacao'),
  testarEmail: (para) => chamar('/email/teste', { metodo: 'POST', corpo: { para } }),
  segurancaResumo: () => chamar('/seguranca/resumo'),
  segurancaEventos: (filtros = {}) => chamar(`/seguranca/eventos?${new URLSearchParams(Object.entries(filtros).filter(([, v]) => v))}`),
  bloquearIp: (ip, minutos, motivo) => chamar('/seguranca/bloqueios', { metodo: 'POST', corpo: { ip, minutos, motivo } }),
  desbloquearIp: (id) => chamar(`/seguranca/bloqueios/${id}/desbloquear`, { metodo: 'POST' }),
  baixarEventosCsv: () => baixar('/seguranca/eventos.csv', 'eventos-seguranca.csv'),
  aprovarCadastro: (id) => chamar(`/usuarios/${id}/aprovar`, { metodo: 'POST' }),
  recusarCadastro: (id) => chamar(`/usuarios/${id}/recusar`, { metodo: 'POST' }),
  trocarSenha: (atual, nova) => chamar('/eu/senha', { metodo: 'POST', corpo: { atual, nova } }),
  usuarios: () => chamar('/usuarios'),
  criarUsuario: (dados) => chamar('/usuarios', { metodo: 'POST', corpo: dados }),
  atualizarUsuario: (id, patch) => chamar(`/usuarios/${id}`, { metodo: 'PATCH', corpo: patch }),
  redefinirSenha: (id) => chamar(`/usuarios/${id}/redefinir-senha`, { metodo: 'POST' }),
  excluirUsuario: (id) => chamar(`/usuarios/${id}`, { metodo: 'DELETE' }),
  pregoes: () => chamar('/pregoes'),
  criarPregao: (nome) => chamar('/pregoes', { metodo: 'POST', corpo: { nome } }),
  excluirPregao: (id) => chamar(`/pregoes/${id}`, { metodo: 'DELETE' }),
  pregao: (id) => chamar(`/pregoes/${id}`),
  progresso: (id) => chamar(`/pregoes/${id}/progresso`),
  enviarDocumentos: (id, papel, arquivos) => {
    const f = new FormData();
    f.append('papel', papel);
    for (const a of arquivos) f.append('arquivos', a);
    return chamar(`/pregoes/${id}/documentos`, { metodo: 'POST', formulario: f });
  },
  enviarProposta: (id, { cnpj, razao_social, arquivo }) => {
    const f = new FormData();
    f.append('cnpj', cnpj); f.append('razao_social', razao_social); f.append('arquivo', arquivo);
    return chamar(`/pregoes/${id}/propostas`, { metodo: 'POST', formulario: f });
  },
  especificacoes: (propostaId) => chamar(`/propostas/${propostaId}/especificacoes`),
  atualizarRequisito: (id, patch) => chamar(`/requisitos/${id}`, { metodo: 'PATCH', corpo: patch }),
  validarTodos: (id, item_numero) => chamar(`/pregoes/${id}/requisitos/validar-todos`, { metodo: 'POST', corpo: { item_numero } }),
  iniciarAnalise: (id) => chamar(`/pregoes/${id}/analisar`, { metodo: 'POST' }),
  julgamento: (id, por_lote) => chamar(`/pregoes/${id}/julgamento`, { metodo: 'PATCH', corpo: { por_lote } }),
  criterioAusencia: (id, ausencia_reprova) => chamar(`/pregoes/${id}/criterio-ausencia`, { metodo: 'PATCH', corpo: { ausencia_reprova } }),
  reprocessarErros: (id) => chamar(`/pregoes/${id}/reprocessar-erros`, { metodo: 'POST' }),
  checklist: (id) => chamar(`/pregoes/${id}/checklist`),
  visaoCompleta: (id) => chamar(`/pregoes/${id}/visao-completa`),
  gerarTexto: (propostaId, tipo, incluirPendencias) => chamar(`/propostas/${propostaId}/texto`, { metodo: 'POST', corpo: { tipo, incluir_pendencias: incluirPendencias } }),
  melhorarTexto: (propostaId, texto, codigos) => chamar(`/propostas/${propostaId}/texto/ia`, { metodo: 'POST', corpo: { texto, codigos } }),
  baixarTextoDoc: async (texto, tipo) => {
    const r = await fetch('/api/texto.doc', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ texto, tipo }) });
    if (!r.ok) throw new Error('Não foi possível gerar o arquivo.');
    const url = URL.createObjectURL(await r.blob());
    Object.assign(document.createElement('a'), { href: url, download: tipo === 'diligencia' ? 'diligencia.doc' : 'motivos-da-recusa.doc' }).click();
    URL.revokeObjectURL(url);
  },
  baixarVisaoCompletaCsv: (id) => baixar(`/pregoes/${id}/visao-completa.csv`, 'visao-completa.csv'),
  baixarCsv: (id) => baixar(`/pregoes/${id}/checklist.csv`, 'checklist.csv'),
  baixarTreino: () => baixar('/treino.jsonl', 'exemplos_treino.jsonl'),
  revisar: (avaliacaoId, status, parecer) => chamar(`/avaliacoes/${avaliacaoId}`, { metodo: 'PATCH', corpo: { status, parecer } }),
  painelIA: (pregaoId) => chamar(`/ia/painel${pregaoId ? `?pregao=${pregaoId}` : ''}`),
};
