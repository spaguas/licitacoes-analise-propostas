// Ponto de entrada da API: monta banco, IAs, orquestrador e rotas.
import { criarEmail } from './servicos/email.js';
import { criarSeguranca } from './servicos/seguranca.js';
import { readFile } from 'node:fs/promises';
import { config } from './config.js';
import { criarRepositorio } from './db/repositorio.js';
import { migrar } from './db/migrar.js';
import { criarClienteNewApi, criarRoteador } from './ia/roteador.js';
import { criarEmbedder } from './ia/embeddings.js';
import { criarOrquestrador } from './pipeline/orquestrador.js';
import { criarEtapas } from './pipeline/etapas.js';
import { criarAplicacao } from './servicos/aplicacao.js';
import { criarServidorHttp } from './http/rotas.js';
import { pdfWorker as pdfWorkerPadrao } from './servicos/pdfWorker.js';

export async function montar({ repo, chat, pdfWorker = pdfWorkerPadrao, embedder, cfg = config, emailServico = null } = {}) {
  repo = repo || (await criarRepositorio(cfg.databaseUrl));
  if (repo.tipo === 'postgres') await migrar(repo.pool);

  const roteador = criarRoteador({
    chat: chat || criarClienteNewApi(cfg.newApi),
    limites: cfg.limites,
    aliasesSoPublicos: cfg.aliasesSoPublicos,
    aliasesNuvem: cfg.aliasesNuvem,
    pausaAposErroMs: cfg.pausaAposErroMs,
    tentativasJson: cfg.tentativasJson,
    registrar: (e) => repo.inserir('execucoes_ia', { pregao_id: e.pregaoId, tarefa: e.tarefa, alias: e.alias, modelo: e.modelo ?? null, tokens: e.tokens ?? null, latencia_ms: e.latenciaMs ?? null, status: e.status, erro: e.erro ?? null }),
  });
  // Recusa na hora de subir uma configuração que mandaria proposta para a IA gratuita.
  roteador.validarRota('e4_proposta', cfg.rotas.e4_proposta, 'proposta');
  roteador.validarRota('e5_pares', cfg.rotas.e5_pares, 'proposta');
  roteador.validarRota('e6_texto_livre', cfg.rotas.e6_texto_livre, 'proposta');
  roteador.validarRota('e6_segunda', cfg.rotas.e6_segunda, 'proposta');
  // A habilitação usa as mesmas rotas do E6 (proposta: nunca para a IA gratuita).

  const orquestrador = criarOrquestrador({ repo });
  const etapas = criarEtapas({
    repo, roteador, pdfWorker, config: cfg, lerArquivo: (c) => readFile(c),
    embedder: embedder || criarEmbedder({ ollamaUrl: cfg.ollamaUrl, modelo: cfg.embeddingsModelo }),
  });
  for (const tipo of ['analisar_documento', 'e3_lote', 'e3b_capitulo', 'analisar_proposta', 'analisar_item_proposta', 'analisar_habilitacao']) {
    orquestrador.registrar(tipo, etapas[tipo]);
  }
  const email = emailServico ?? criarEmail(cfg.smtp);
  if (email.ativo) console.log(`[e-mail] envio ativo: ${cfg.smtp.remetente} via ${cfg.smtp.host}:${cfg.smtp.porta}`);
  const app = criarAplicacao({ repo, orquestrador, config: cfg, roteador, email });
  await app.garantirAdmin();
  const seguranca = criarSeguranca({ repo, config: cfg, email });
  await seguranca.limparAntigos().catch(() => {});
  return { repo, roteador, orquestrador, etapas, app, seguranca };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  const { app, orquestrador, seguranca } = await montar();
  await orquestrador.iniciar();
  setInterval(() => seguranca.limparAntigos().catch(() => {}), 24 * 3600 * 1000).unref();
  criarServidorHttp({ app, config, seguranca }).listen(config.porta, () => console.log(`API ouvindo em http://localhost:${config.porta}`));
}
