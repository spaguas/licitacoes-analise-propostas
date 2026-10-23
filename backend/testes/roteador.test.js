import { test } from 'node:test';
import assert from 'node:assert/strict';
import { criarRoteador, ErroRegraDeDados, lerJson } from '../src/ia/roteador.js';

const limites = { 'ia-leve': { simultaneas: 2, porMinuto: 10, porDia: 1000, timeoutMs: 1000 }, 'ia-media': { simultaneas: 1, timeoutMs: 1000 }, 'ia-forte': { simultaneas: 3, timeoutMs: 1000 } };
const base = { limites, aliasesSoPublicos: ['ia-leve'], aliasesNuvem: ['ia-leve', 'ia-forte'], pausaAposErroMs: 60000, tentativasJson: 2 };
const montarSimples = async ({ nuvem }) => ({ mensagens: [{ role: 'user', content: 'x' }], mascarado: nuvem });

test('proposta nunca vai para a IA gratuita (rota recusada)', async () => {
  const r = criarRoteador({ ...base, chat: async () => ({ conteudo: '{}' }) });
  assert.throws(() => r.validarRota('e4', ['ia-leve', 'ia-media'], 'proposta'), ErroRegraDeDados);
  await assert.rejects(r.executar({ tarefa: 'e4', rota: ['ia-leve'], dados: 'proposta', montar: montarSimples }), ErroRegraDeDados);
});

test('proposta sem mascaramento não vai para a nuvem', async () => {
  const r = criarRoteador({ ...base, chat: async () => ({ conteudo: '{}' }) });
  await assert.rejects(r.executar({ tarefa: 'e6', rota: ['ia-forte'], dados: 'proposta', montar: async () => ({ mensagens: [], mascarado: false }) }), ErroRegraDeDados);
});

test('erro 429 coloca o alias em pausa e a tarefa vai para a reserva', async () => {
  const chamados = [];
  const chat = async (alias) => {
    chamados.push(alias);
    if (alias === 'ia-leve') { const e = new Error('limite'); e.status = 429; e.transitorio = true; throw e; }
    return { conteudo: '{"ok":true}', modelo: alias };
  };
  const r = criarRoteador({ ...base, chat });
  const res = await r.executar({ tarefa: 'e2', rota: ['ia-leve', 'ia-media'], montar: montarSimples });
  assert.equal(res.alias, 'ia-media');
  const res2 = await r.executar({ tarefa: 'e2', rota: ['ia-leve', 'ia-media'], montar: montarSimples });
  assert.equal(res2.alias, 'ia-media');
  assert.deepEqual(chamados, ['ia-leve', 'ia-media', 'ia-media'], 'em pausa, a ia-leve nem é chamada');
});

test('JSON reprovado duas vezes escala para a próxima IA', async () => {
  const chamados = [];
  const chat = async (alias) => { chamados.push(alias); return { conteudo: alias === 'ia-media' ? '{"x":1}' : '{"x":2}', modelo: alias }; };
  const r = criarRoteador({ ...base, chat });
  const res = await r.executar({ tarefa: 'e3', rota: ['ia-media', 'ia-forte'], montar: montarSimples, validar: (j) => (j.x === 2 ? [] : ['x deve ser 2']) });
  assert.equal(res.alias, 'ia-forte');
  assert.deepEqual(chamados, ['ia-media', 'ia-media', 'ia-forte']);
});

test('lê JSON mesmo com bloco de pensamento do Qwen e cercas de código', () => {
  assert.deepEqual(lerJson('<think>pensando...</think>\n```json\n{"a":1}\n```'), { a: 1 });
});

test('rede de segurança: ia-media "local" que responde com DeepSeek passa a receber propostas mascaradas', async () => {
  const pedidos = [];
  const chat = async (alias) => ({ conteudo: '{"ok":true}', modelo: alias === 'ia-media' ? 'deepseek-flash' : alias });
  const r = criarRoteador({ ...base, chat }); // base: ia-media NÃO está em aliasesNuvem (configurada como local)
  const montar = async ({ nuvem }) => { pedidos.push(nuvem); return { mensagens: [{ role: 'user', content: 'x' }], mascarado: nuvem }; };
  await r.executar({ tarefa: 'e3', rota: ['ia-media'], dados: 'publico', montar }); // documento público: revela o modelo
  assert.deepEqual(r.nuvemDetectada(), ['ia-media']);
  await r.executar({ tarefa: 'e4', rota: ['ia-media'], dados: 'proposta', montar });
  assert.deepEqual(pedidos, [false, true], 'a proposta precisa ir mascarada depois da detecção');
});

test('Qwen local continua sendo local (sem falso alarme)', async () => {
  const r = criarRoteador({ ...base, chat: async () => ({ conteudo: '{"ok":true}', modelo: 'qwen3.5:4b' }) });
  await r.executar({ tarefa: 'e3', rota: ['ia-media'], montar: montarSimples });
  assert.deepEqual(r.nuvemDetectada(), []);
});
