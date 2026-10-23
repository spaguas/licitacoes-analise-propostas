// Roteador das três frentes de IA (ia-leve, ia-media, ia-forte), todas acessadas pelo New API.
//  - limite de chamadas simultâneas, por minuto e por dia em cada alias;
//  - pausa automática após erro 429, 5xx, timeout ou falha de rede, passando a tarefa para a reserva;
//  - JSON inválido ou reprovado na validação: nova tentativa e, depois, escalonamento;
//  - TRAVA DE DADOS: proposta nunca vai para alias "só público" (Gemini gratuito) e só vai
//    mascarada para aliases de nuvem.

export class ErroIA extends Error {
  constructor(mensagem, detalhes = []) { super(mensagem); this.detalhes = detalhes; }
}
export class ErroRegraDeDados extends Error {}

// ------------------------------------------------------------ cliente HTTP do New API
export function criarClienteNewApi({ url, token, fetchImpl = globalThis.fetch }) {
  return async function chat(alias, mensagens, { timeoutMs }) {
    const inicio = Date.now();
    let resposta;
    try {
      resposta = await fetchImpl(`${url.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: alias, messages: mensagens, temperature: 0, response_format: { type: 'json_object' } }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (erro) {
      const e = new Error(erro.name === 'TimeoutError' ? 'tempo esgotado' : `falha de rede: ${erro.message}`);
      e.transitorio = true;
      throw e;
    }
    const corpo = await resposta.json().catch(() => ({}));
    if (!resposta.ok) {
      const e = new Error(corpo?.error?.message || `HTTP ${resposta.status}`);
      e.status = resposta.status;
      e.transitorio = resposta.status === 429 || resposta.status >= 500;
      throw e;
    }
    return {
      conteudo: corpo.choices?.[0]?.message?.content ?? '',
      modelo: corpo.model || alias,
      tokens: corpo.usage?.total_tokens ?? null,
      latenciaMs: Date.now() - inicio,
    };
  };
}

// Tira o "pensamento" de modelos como o Qwen e cercas ```json antes de interpretar.
export function lerJson(texto) {
  const limpo = String(texto)
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/```(?:json)?/gi, '')
    .trim();
  const inicio = limpo.search(/[[{]/);
  if (inicio < 0) throw new Error('resposta sem JSON');
  return JSON.parse(limpo.slice(inicio));
}

// ------------------------------------------------------------ roteador
class Limitador {
  constructor({ simultaneas = 1, porMinuto = 0, porDia = 0 }) {
    Object.assign(this, { simultaneas, porMinuto, porDia, ativas: 0, fila: [], minuto: [], dia: [], pausaAte: 0 });
  }
  emPausa(agora) { return this.pausaAte > agora; }
  cotaDiariaEsgotada(agora) {
    this.dia = this.dia.filter((t) => agora - t < 86400000);
    return this.porDia > 0 && this.dia.length >= this.porDia;
  }
  async entrar() {
    for (;;) {
      const agora = Date.now();
      this.minuto = this.minuto.filter((t) => agora - t < 60000);
      const livreMinuto = !this.porMinuto || this.minuto.length < this.porMinuto;
      if (this.ativas < this.simultaneas && livreMinuto) {
        this.ativas += 1; this.minuto.push(agora); this.dia.push(agora);
        return;
      }
      const espera = livreMinuto ? 200 : Math.max(200, 60000 - (agora - this.minuto[0]));
      await new Promise((r) => setTimeout(r, Math.min(espera, 5000)));
    }
  }
  sair() { this.ativas -= 1; }
}

// Modelos de nuvem reconhecidos pelo nome que o New API devolve (ex.: "deepseek-flash", "claude-sonnet-5-5").
export const MODELO_DE_NUVEM = /deepseek|gpt-|\bo\d|claude|sonnet|haiku|opus|gemini|grok|mistral-(large|medium|small)|command-r/i;

export function criarRoteador({ chat, limites, aliasesSoPublicos, aliasesNuvem, pausaAposErroMs, tentativasJson, registrar = async () => {} }) {
  // Rede de segurança: se um alias configurado como LOCAL responder com um modelo de NUVEM,
  // ele passa a ser tratado como nuvem (propostas mascaradas) até a API reiniciar.
  const nuvemDetectada = new Set();
  const ehNuvem = (alias) => aliasesNuvem.includes(alias) || nuvemDetectada.has(alias);
  const observarModelo = (alias, modelo) => {
    if (!aliasesNuvem.includes(alias) && !nuvemDetectada.has(alias) && MODELO_DE_NUVEM.test(String(modelo || ''))) {
      nuvemDetectada.add(alias);
      console.warn(`[segurança] ${alias} respondeu com "${modelo}" (nuvem), mas não está em ALIASES_NUVEM. Propostas para ${alias} passam a ir mascaradas. Corrija o .env.`);
    }
  };
  const limitadores = Object.fromEntries(Object.entries(limites).map(([alias, l]) => [alias, new Limitador(l)]));

  function validarRota(tarefa, rota, dados) {
    if (dados === 'proposta') {
      const proibidos = rota.filter((a) => aliasesSoPublicos.includes(a));
      if (proibidos.length) throw new ErroRegraDeDados(`Tarefa "${tarefa}" lida com proposta e não pode usar ${proibidos.join(', ')} (só documentos públicos).`);
    }
  }

  async function executar({ tarefa, rota, dados = 'publico', montar, validar = () => [], pregaoId = null }) {
    validarRota(tarefa, rota, dados);
    const falhas = [];
    for (const alias of rota) {
      const lim = limitadores[alias];
      if (!lim) { falhas.push(`${alias}: alias sem configuração`); continue; }
      const agora = Date.now();
      if (lim.emPausa(agora)) { falhas.push(`${alias}: em pausa após erro`); continue; }
      if (lim.cotaDiariaEsgotada(agora)) { falhas.push(`${alias}: cota diária esgotada`); continue; }

      const nuvem = ehNuvem(alias);
      const { mensagens, mascarado } = await montar({ alias, nuvem });
      if (dados === 'proposta' && nuvem && !mascarado) {
        throw new ErroRegraDeDados(`Tarefa "${tarefa}": proposta sem mascaramento não pode ir para ${alias}.`);
      }

      for (let tentativa = 1; tentativa <= tentativasJson; tentativa += 1) {
        await lim.entrar();
        let resposta;
        try {
          resposta = await chat(alias, mensagens, { timeoutMs: limites[alias].timeoutMs });
        } catch (erro) {
          lim.sair();
          await registrar({ pregaoId, tarefa, alias, status: 'erro', erro: erro.message });
          falhas.push(`${alias}: ${erro.message}`);
          if (erro.transitorio) lim.pausaAte = Date.now() + pausaAposErroMs;
          break; // erro de rede/provedor: vai direto para a reserva
        }
        lim.sair();
        let json; let erros;
        try { json = lerJson(resposta.conteudo); erros = validar(json); } catch (e) { erros = [e.message]; }
        observarModelo(alias, resposta.modelo);
        await registrar({ pregaoId, tarefa, alias, modelo: resposta.modelo, tokens: resposta.tokens, latenciaMs: resposta.latenciaMs, status: erros.length ? 'invalido' : 'ok', erro: erros.slice(0, 5).join(' | ') || null });
        if (!erros.length) return { json, alias, modelo: resposta.modelo };
        falhas.push(`${alias} (tentativa ${tentativa}): ${erros.slice(0, 3).join(' | ')}`);
        mensagens.push({ role: 'assistant', content: resposta.conteudo });
        mensagens.push({ role: 'user', content: `A resposta não passou na validação: ${erros.slice(0, 8).join(' | ')}. Corrija e responda só com o JSON.` });
      }
    }
    throw new ErroIA(`Nenhuma IA concluiu a tarefa "${tarefa}".`, falhas);
  }

  return { executar, validarRota, nuvemDetectada: () => [...nuvemDetectada] };
}
