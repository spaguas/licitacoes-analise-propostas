// Rede neural de similaridade para o de-para: bge-m3 servido pelo Ollama local.
// Se o Ollama não responder, usa n-gramas de caracteres (mais fraco, mas mantém o sistema funcionando).
import { vetorNgramas } from '../nucleo/texto.js';

export function criarEmbedder({ ollamaUrl, modelo, fetchImpl = globalThis.fetch }) {
  let disponivel = null; // descobre na primeira chamada

  async function viaOllama(textos) {
    const r = await fetchImpl(`${ollamaUrl.replace(/\/$/, '')}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: modelo, input: textos }),
      signal: AbortSignal.timeout(120000),
    });
    if (!r.ok) throw new Error(`Ollama HTTP ${r.status}`);
    const corpo = await r.json();
    return corpo.embeddings;
  }

  return {
    async vetores(textos) {
      if (disponivel !== false) {
        try {
          const v = await viaOllama(textos);
          disponivel = true;
          return { tipo: 'embeddings', vetores: v };
        } catch (erro) {
          if (disponivel === null) console.warn(`[de-para] Ollama indisponível (${erro.message}); usando n-gramas.`);
          disponivel = false;
        }
      }
      return { tipo: 'ngramas', vetores: textos.map(vetorNgramas) };
    },
  };
}
