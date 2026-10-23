// Orquestrador de tarefas. Cada tarefa fica gravada no banco (tabela "tarefas"), então nada se perde
// quando a API reinicia: o que estava "executando" volta para "pendente" e roda de novo.
// As tarefas rodam em paralelo; quem limita quantas chamadas cada IA recebe é o roteador.

export function criarOrquestrador({ repo, simultaneas = 6, intervaloMs = 500 }) {
  const executores = {};
  let ativas = 0;
  let parado = false;
  let temporizador = null;

  function registrar(tipo, funcao) { executores[tipo] = funcao; }

  async function agendar(pregaoId, tipo, chave, payload = {}) {
    // Evita duplicar a mesma tarefa enquanto ela ainda não terminou.
    const doPregao = await repo.buscar('tarefas', { pregao_id: pregaoId });
    const aberta = doPregao.find((t) => t.tipo === tipo && t.chave === chave && (t.status === 'pendente' || t.status === 'executando'));
    if (aberta) return aberta;
    // Nenhuma tarefa aberta neste pregão: começa um novo lote (é o que o pop-up de progresso acompanha).
    if (!doPregao.some((t) => t.status === 'pendente' || t.status === 'executando')) {
      await repo.atualizar('pregoes', pregaoId, { lote_inicio: new Date(Date.now() - 1000).toISOString() });
    }
    const t = await repo.inserir('tarefas', { pregao_id: pregaoId, tipo, chave, status: 'pendente', tentativas: 0, payload, atualizado_em: new Date().toISOString() });
    setImmediate(ciclo);
    return t;
  }

  // Atualiza o progresso da tarefa (percentual 0–100 e mensagem), no máximo 1 vez por segundo.
  function criarProgresso(tarefaId) {
    let ultimo = 0;
    return async (percentual, mensagem) => {
      const agora = Date.now();
      if (percentual < 100 && agora - ultimo < 1000) return;
      ultimo = agora;
      await repo.atualizar('tarefas', tarefaId, { progresso: { percentual: Math.max(0, Math.min(100, Math.round(percentual))), mensagem, em: new Date().toISOString() } });
    };
  }

  async function executarUma(tarefa) {
    ativas += 1;
    await repo.atualizar('tarefas', tarefa.id, {
      status: 'executando', tentativas: tarefa.tentativas + 1, atualizado_em: new Date().toISOString(),
      progresso: { percentual: 0, mensagem: 'Iniciando', em: new Date().toISOString() },
    });
    try {
      const executor = executores[tarefa.tipo];
      if (!executor) throw new Error(`tipo de tarefa desconhecido: ${tarefa.tipo}`);
      await executor(tarefa, { agendar, progresso: criarProgresso(tarefa.id) });
      await repo.atualizar('tarefas', tarefa.id, { status: 'concluida', erro: null, atualizado_em: new Date().toISOString(),
        progresso: { percentual: 100, mensagem: 'Concluído', em: new Date().toISOString() } });
    } catch (erro) {
      const detalhes = erro.detalhes?.length ? ` — ${erro.detalhes.join(' / ')}` : '';
      console.error(`[tarefa ${tarefa.tipo} ${tarefa.chave}]`, erro.message + detalhes);
      await repo.atualizar('tarefas', tarefa.id, { status: 'erro', erro: (erro.message + detalhes).slice(0, 2000), atualizado_em: new Date().toISOString() });
    } finally {
      ativas -= 1;
      setImmediate(ciclo);
    }
  }

  let ocupado = false;
  async function ciclo() {
    if (parado || ocupado) return;
    ocupado = true;
    try {
      const vagas = simultaneas - ativas;
      if (vagas > 0) {
        const pendentes = (await repo.buscar('tarefas', { status: 'pendente' })).slice(0, vagas);
        for (const t of pendentes) {
          await repo.atualizar('tarefas', t.id, { status: 'executando' }); // reserva antes de soltar o laço
          executarUma(t);
        }
      }
    } finally {
      ocupado = false;
    }
  }

  async function iniciar() {
    for (const t of await repo.buscar('tarefas', { status: 'executando' })) {
      await repo.atualizar('tarefas', t.id, { status: 'pendente' }); // recupera após reinício
    }
    parado = false;
    temporizador = setInterval(ciclo, intervaloMs);
    ciclo();
  }

  function parar() { parado = true; clearInterval(temporizador); }

  // Espera tudo terminar (usado nos testes e no script de demonstração).
  async function aguardarOcioso(limiteMs = 600000) {
    const inicio = Date.now();
    for (;;) {
      const abertas = (await repo.buscar('tarefas', {})).filter((t) => t.status === 'pendente' || t.status === 'executando');
      if (!abertas.length && ativas === 0) return;
      if (Date.now() - inicio > limiteMs) throw new Error('tempo esgotado esperando as tarefas');
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  return { registrar, agendar, iniciar, parar, aguardarOcioso };
}
