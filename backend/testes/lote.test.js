// Pregão por LOTE (TR e proposta sintéticos, em testes/dados): leitura de lotes, requisitos comuns do lote,
// aplicação ao item, item faltante no lote e lote não disputado. A IA é gravada (não gasta tokens).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const PORTA = 8012;
const dados = (n) => new URL(`./dados/${n}`, import.meta.url);
const norm = (t) => String(t ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toUpperCase();

// Tipificação gravada das linhas do TR por lote
const TIPOS = {
  'Garantia mínima de 24 meses': { atributo: 'garantia', tipo: 'numerico', operador: '>=', valor: 24, unidade: 'mes', trecho: 'Garantia mínima de 24 meses' },
  'Cor preta ou grafite': { atributo: 'cor', tipo: 'opcao', opcoes: ['preta', 'grafite'], trecho: 'Cor preta ou grafite' },
  'Largura entre 120 cm e 140 cm': { atributo: 'largura', tipo: 'faixa', valor_min: 120, valor_max: 140, unidade: 'cm', trecho: 'Largura entre 120 cm e 140 cm' },
};
function ia(alias, mensagens) {
  const sistema = mensagens[0].content; const d = JSON.parse(mensagens[1].content);
  let saida;
  if (sistema.startsWith('Você transforma linhas')) {
    saida = { requisitos: d.linhas.map((l) => ({ linha_id: l.id, obrigatorio: true, ...(TIPOS[l.texto] || { atributo: 'descritivo', tipo: 'texto_livre', trecho: l.texto }) })) };
  } else if (sistema.startsWith('Você lê um capítulo')) {
    saida = { requisitos: [] };
  } else if (sistema.startsWith('Você extrai, de uma proposta')) {
    saida = { fornecedor: { cnpj: '11.222.333/0001-81', razao_social: 'MÓVEIS EXEMPLO' }, referencias_externas: [], itens: [{
      item: '1', marca: 'Exemplo', modelo: 'ME-130', quantidade: 20, valor_unitario: 850, especificacoes: [
        { secao_declarada: 'dimensoes', atributo_declarado: 'largura', valor: 130, unidade: 'cm', trecho: 'largura de 130 cm' },
        { secao_declarada: 'acabamento', atributo_declarado: 'cor', valor: 'preta', trecho: 'cor preta' },
        { secao_declarada: 'condicoes comerciais', atributo_declarado: 'garantia', valor: 12, unidade: 'mes', trecho: 'Garantia de 12 meses' },
      ] }] };
  } else if (sistema.startsWith('Você liga requisitos')) {
    saida = { pares: d.requisitos.map((r) => ({ requisito_id: r.id, especificacao_id: d.especificacoes.find((s) => s.atributo_declarado === r.atributo)?.id ?? null, justificativa: 'gravada' })) };
  } else if (sistema.startsWith('Você é um analista')) {
    const lista = d.avaliacoes || d.exigencias;
    saida = { avaliacoes: lista.map((a) => ({ requisito_id: a.requisito_id, status: 'NÃO COMPROVADO', justificativa: 'sem informação' })) };
  } else throw new Error('prompt desconhecido');
  return { conteudo: JSON.stringify(saida), modelo: alias, tokens: 0, latenciaMs: 1 };
}

let worker; let s;
before(async () => {
  worker = spawn('python3', ['servidor.py'], { cwd: new URL('../../pdf-worker/', import.meta.url).pathname, env: { ...process.env, PORTA: String(PORTA), OCR_ATIVO: 'false' }, stdio: 'ignore' });
  for (let i = 0; i < 50; i += 1) {
    try { if ((await fetch(`http://localhost:${PORTA}/saude`)).ok) break; } catch { /* subindo */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  process.env.PDF_WORKER_URL = `http://localhost:${PORTA}`;
  process.env.UPLOAD_DIR = mkdtempSync(path.join(tmpdir(), 'lote-'));
  const { config } = await import('../src/config.js');
  const { montar } = await import('../src/servidor.js');
  const { criarRepositorioMemoria } = await import('../src/db/repositorio.js');
  const { pdfWorker } = await import('../src/servicos/pdfWorker.js');
  s = await montar({ repo: criarRepositorioMemoria(), chat: async (a, m) => ia(a, m), pdfWorker, cfg: { ...config, pdfWorkerUrl: `http://localhost:${PORTA}`, adminSenhaInicial: '' } });
  await s.orquestrador.iniciar();
});
after(() => { s?.orquestrador.parar(); worker?.kill(); });

const arquivo = (n) => new File([readFileSync(dados(n))], n, { type: 'application/pdf' });

test('pregão por lote: requisitos comuns do lote, item faltante e lote não disputado', { timeout: 300000 }, async () => {
  const { app, orquestrador, repo } = s;
  const pregao = await app.criarPregao({ nome: 'Mobiliário por lote' }, null);
  await app.enviarDocumento(pregao.id, 'tr', arquivo('TR_por_lote.pdf'));
  await orquestrador.aguardarOcioso();

  const reqs = await repo.buscar('requisitos', { pregao_id: pregao.id });
  const garantia = reqs.find((r) => r.atributo === 'garantia');
  assert.equal(garantia.item_numero, null);
  assert.equal(garantia.lote, '1', 'garantia é requisito comum do lote 1');
  assert.equal(reqs.find((r) => r.atributo === 'largura').lote, '1', 'item 1 herda o lote 1');
  const painel = await app.painelPregao(pregao.id);
  assert.deepEqual(painel.cobertura.lote_1, { linhas: 2, cobertas: 2 });

  // Estrutura: detectada POR LOTE sozinha (o TR diz "menor preço por lote"), com a composição de cada lote
  const est = painel.estrutura;
  assert.equal(est.julgamento, 'lote');
  assert.equal(est.origem, 'documento');
  assert.match(est.evidencia.trecho, /por lote/i);
  assert.deepEqual(est.lotes.map((l) => [l.lote, l.quantidade_itens, l.valor_estimado]), [['1', 2, 32000], ['2', 1, 6000]]);
  assert.match(est.regra, /TODOS os itens/);
  assert.deepEqual(est.alertas, []);

  await app.validarTodos(pregao.id);
  await app.definirJulgamento(pregao.id, true);
  await app.enviarProposta(pregao.id, { cnpj: '11.222.333/0001-81', razao_social: 'MÓVEIS EXEMPLO' }, arquivo('Proposta_lote.pdf'));
  await orquestrador.aguardarOcioso();
  // Antes da análise, a Etapa 03 já avisa que o lote 1 está incompleto (falta o item 2).
  const [prop] = (await app.painelPregao(pregao.id)).propostas;
  assert.deepEqual(prop.lotes, [{ lote: '1', itens_do_lote: ['1', '2'], faltam: ['2'] }]);
  const estrutura = (await app.painelPregao(pregao.id)).estrutura;
  assert.equal(estrutura.julgamento, 'lote');
  assert.deepEqual(estrutura.lotes.map((l) => [l.lote, l.quantidade_itens]), [['1', 2], ['2', 1]]);
  await app.iniciarAnalise(pregao.id);
  await orquestrador.aguardarOcioso();

  const [f] = await app.visaoCompleta(pregao.id);
  const linha = (atributo) => f.linhas.find((l) => l.atributo === atributo);
  assert.equal(linha('garantia').status, 'NÃO ATENDE', 'requisito comum do lote aplicado ao item 1: 12 < 24 meses');
  assert.equal(linha('garantia').grupo_nome, 'Lote 1 · requisitos comuns');
  assert.equal(linha('largura').status, 'ATENDE', '130 cm dentro de 120–140 cm');
  assert.equal(linha('cor').status, 'ATENDE');
  assert.equal(f.linhas.find((l) => l.requisito_codigo === 'LOTE-1').status, 'NÃO ATENDE', 'faltou o item 2 do lote 1');
  assert.ok(!f.linhas.some((l) => l.requisito_codigo === 'LOTE-2'), 'lote 2 não foi disputado: sem linha de oferta completa');
  assert.ok(f.linhas.filter((l) => l.grupo === 'item_3').every((l) => l.status === 'NÃO OFERTADO'));
  assert.equal(f.resumo, 'não atende');
  const ordem = [...new Set(f.linhas.map((l) => l.grupo))];
  assert.ok(ordem.indexOf('lotecomum_1') < ordem.indexOf('item_1'), 'comuns do lote aparecem antes dos itens do lote');
  if (process.env.SALVAR_EXEMPLO_LOTE) {
    (await import('node:fs')).writeFileSync(process.env.SALVAR_EXEMPLO_LOTE, JSON.stringify({ painel: await app.painelPregao(pregao.id), checklist: await app.checklist(pregao.id), completa: await app.visaoCompleta(pregao.id), pregoes: await app.listarPregoes({ perfil: 'admin' }) }));
  }
});
