// Fluxo completo: edital + TR + proposta reais -> pdf-worker real -> etapas E1 a E6 -> checklist.
// A IA é "gravada" (respostas montadas a partir dos gabaritos), então o teste não gasta tokens.
// Requer: PDFS_DIR com os 3 PDFs e Python com as dependências do pdf-worker.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const PDFS = process.env.PDFS_DIR;
const ARQ = { edital: 'SEI_0119973502_Minuta.pdf', tr: 'TR262101_000222_2026__3__-_Copia.pdf', proposta: 'Proposta_Rascorp_Item_1.pdf' };
const disponivel = PDFS && Object.values(ARQ).every((a) => existsSync(path.join(PDFS, a)));
const PORTA = 8011;

const G = JSON.parse(readFileSync(new URL('./dados/item1_gabarito.json', import.meta.url), 'utf8'));
const gold = JSON.parse(readFileSync(new URL('../../fixtures/gold_requisitos_item1.json', import.meta.url), 'utf8'));
const norm = (t) => String(t ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toUpperCase();
const SECAO = { E001: 'identificacao', E002: 'identificacao', E003: 'placa mae', E004: 'processador', E005: 'memoria', E006: 'memoria', E007: 'memoria', E008: 'memoria', E009: 'armazenamento', E010: 'fonte', E011: 'fonte', E012: 'fonte', E013: 'sistema operacional', E014: 'sistema operacional', E015: 'gabinete', E016: 'montagem', E017: 'processador', E018: 'placa mae', E019: 'monitor', E020: 'condicoes comerciais', E021: 'condicoes comerciais', E022: 'condicoes comerciais', E023: 'condicoes comerciais', E024: 'condicoes comerciais', E025: 'referencia externa', E026: 'gabinete' };
const atributoPorTrecho = Object.fromEntries(G.requisitos.map((r) => [norm(r.origem.trecho), r.atributo]));

// ------------------------------------------------------------- IA gravada
function iaGravada(alias, mensagens) {
  const sistema = mensagens[0].content;
  const dados = JSON.parse(mensagens[1].content);
  let saida;
  if (sistema.startsWith('Você transforma linhas')) {
    saida = { requisitos: dados.linhas.flatMap((l) => {
      const [bloco, cod] = l.id.split('-');
      const doGabarito = bloco === 'item_1' ? gold.item_1.filter((g) => g.linha === cod)
        : bloco === 'geral' ? gold.gerais.filter((g) => g.origem_linha === l.id).map((g) => G.requisitos.find((r) => r.id === g.id)) : [];
      if (doGabarito.length) return doGabarito.map((g) => ({ linha_id: l.id, atributo: g.atributo, tipo: g.tipo, operador: g.operador, valor: g.valor, valor_min: g.valor_min, valor_max: g.valor_max, unidade: g.unidade, opcoes: g.opcoes, obrigatorio: true, trecho: g.origem.trecho }));
      return [{ linha_id: l.id, atributo: `linha_${cod.toLowerCase()}`, tipo: 'texto_livre', obrigatorio: true, trecho: l.texto.slice(0, 40) }];
    }) };
  } else if (sistema.startsWith('Você lê um capítulo')) {
    const req = (atributo, extra) => ({ ...G.requisitos.find((r) => r.atributo === atributo), ...extra });
    const t = norm(dados.titulo);
    const lista = [];
    if (t.includes('REQUISITOS DA CONTRATACAO')) lista.push(req('energy_star_epeat'));
    if (t.includes('MODELO DE EXECUCAO')) lista.push(req('prazo_entrega'), req('garantia'));
    if (t.includes('PREENCHIMENTO DA PROPOSTA')) lista.push(req('campos_marca_fabricante', { origem: { trecho: 'Marca' } }), req('validade_proposta'));
    if (dados.categoria === 'HABILITACAO') {
      for (const [atributo, trecho] of [['certidao_falencia', 'Certidão negativa de falência'], ['regularidade_fgts', 'Prova de regularidade com o Fundo de Garantia do Tempo de Serviço (FGTS)']]) {
        if (norm(dados.texto).includes(norm(trecho))) lista.push({ atributo, tipo: 'texto_livre', origem: { trecho } });
      }
    }
    saida = { requisitos: lista.filter((r) => norm(dados.texto).includes(norm(r.origem.trecho))).map((r) => ({ item: null, atributo: r.atributo, tipo: r.tipo, operador: r.operador, valor: r.valor, unidade: r.unidade, opcoes: r.opcoes, obrigatorio: true, trecho: r.origem.trecho })) };
  } else if (sistema.startsWith('Você extrai, de uma proposta')) {
    saida = { fornecedor: { cnpj: '64.911.773/0001-02', razao_social: 'RASCORP' }, validade_dias: 90, prazo_entrega_dias: 30, garantia_meses: 24, referencias_externas: [],
      itens: [{ ...G.item_proposta, especificacoes: G.especificacoes.map((e) => ({ secao_declarada: SECAO[e.id], atributo_declarado: e.atributo_declarado, valor: e.valor, unidade: e.unidade, vago: e.vago, alternativas: e.alternativas, contradiz: e.contradiz, negado: e.negado, identificador_modelo: e.identificador_modelo, trecho: e.origem.trecho })) }] };
  } else if (sistema.startsWith('Você liga requisitos')) {
    saida = { pares: dados.requisitos.map((r) => {
      const req = G.requisitos.find((g) => g.atributo === r.atributo);
      const cod = req && G.depara[req.id];
      const alvo = cod && G.especificacoes.find((e) => e.id === cod);
      const spec = alvo && dados.especificacoes.find((s) => norm(s.trecho) === norm(alvo.origem.trecho) && s.atributo_declarado === alvo.atributo_declarado);
      return { requisito_id: r.id, especificacao_id: spec?.id ?? null, justificativa: 'gravada' };
    }) };
  } else if (sistema.startsWith('Você revisa a redação')) {
    // "IA" que só troca uma palavra; se o texto pedir para perder um item, o sistema precisa recusar
    saida = { texto: process.env.IA_PERDE_ITEM ? dados.texto.replace(/\[item_1-L028-1\][^\n]*\n/, '') : dados.texto.replace('verificou-se', 'constatou-se') };
  } else if (sistema.startsWith('Você é um analista de licitações. Confira')) {
    saida = { avaliacoes: dados.exigencias.map((e) => ({ requisito_id: e.requisito_id, status: 'NÃO COMPROVADO', justificativa: 'Documento não encontrado no que foi enviado.' })) };
  } else if (sistema.startsWith('Você é um analista técnico')) {
    saida = { avaliacoes: dados.avaliacoes.map((a) => {
      const attr = atributoPorTrecho[norm(a.requisito)];
      const g = G.ia_texto_livre[attr];
      const op = g ? (alias === 'ia-forte' ? g.forte : g.media) : { status: 'NÃO COMPROVADO', justificativa: 'sem resposta gravada' };
      return { requisito_id: a.requisito_id, ...op };
    }) };
  } else throw new Error('prompt desconhecido');
  return { conteudo: JSON.stringify(saida), modelo: `gravado-${alias}`, tokens: 0, latenciaMs: 1 };
}

let worker; let sistema;
before(async () => {
  if (!disponivel) return;
  worker = spawn('python3', ['servidor.py'], { cwd: new URL('../../pdf-worker/', import.meta.url).pathname, env: { ...process.env, PORTA: String(PORTA), OCR_ATIVO: 'false' }, stdio: 'ignore' });
  for (let i = 0; i < 50; i += 1) {
    try { if ((await fetch(`http://localhost:${PORTA}/saude`)).ok) break; } catch { /* aguardando subir */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  process.env.PDF_WORKER_URL = `http://localhost:${PORTA}`;
  process.env.UPLOAD_DIR = mkdtempSync(path.join(tmpdir(), 'licit-'));
  process.env.ADMIN_SENHA_INICIAL = 'senha-de-teste';
  const { config } = await import('../src/config.js');
  const { montar } = await import('../src/servidor.js');
  const { criarRepositorioMemoria } = await import('../src/db/repositorio.js');
  const { pdfWorker } = await import('../src/servicos/pdfWorker.js');
  sistema = await montar({ repo: criarRepositorioMemoria(), chat: async (alias, m) => iaGravada(alias, m), pdfWorker, cfg: config });
  await sistema.orquestrador.iniciar();
});
after(() => { sistema?.orquestrador.parar(); worker?.kill(); });

const arquivo = (nome) => new File([readFileSync(path.join(PDFS, nome))], nome, { type: 'application/pdf' });

test('fluxo completo com os documentos do Pregão 54/2026', { skip: !disponivel && 'defina PDFS_DIR', timeout: 900000 }, async () => {
  const { app, orquestrador, repo } = sistema;
  const [admin] = await repo.buscar('usuarios');
  const pregao = await app.criarPregao({ nome: 'Pregão 54/2026 – teste' }, admin);
  await app.enviarDocumento(pregao.id, 'edital', arquivo(ARQ.edital));
  await app.enviarDocumento(pregao.id, 'tr', arquivo(ARQ.tr));
  await orquestrador.aguardarOcioso();

  let painel = await app.painelPregao(pregao.id);
  assert.equal(painel.indicadores.tarefas_com_erro, 0, JSON.stringify(painel.tarefas.filter((t) => t.status === 'erro')));
  assert.equal(painel.pregao.numero, '54/2026');
  assert.deepEqual(painel.itens.map((i) => [i.numero, i.quantidade]), [['1', 36], ['2', 148]]);
  assert.ok(painel.conflitos.some((c) => c.campo === 'Valor unitário estimado do item 1'));
  assert.ok(painel.conflitos.some((c) => c.campo === 'Valor total da contratação'));
  assert.deepEqual(painel.cobertura.item_1 ?? painel.cobertura['1'], { linhas: 49, cobertas: 49 });
  // Estrutura da licitação: por item, lido no documento, com prova
  assert.equal(painel.estrutura.julgamento, 'item');
  assert.equal(painel.estrutura.origem, 'documento');
  assert.match(painel.estrutura.evidencia.trecho, /por item/i);
  assert.equal(painel.estrutura.total_itens, 2);
  assert.equal(painel.requisitos.filter((r) => r.item_numero === '1').length, 55);
  assert.ok(painel.partes.find((p) => p.titulo === 'ANEXO III' && !p.gera_requisitos));

  await app.validarTodos(pregao.id);
  await app.enviarProposta(pregao.id, { cnpj: '64.911.773/0001-02', razao_social: 'RASCORP' }, arquivo(ARQ.proposta));
  // Durante o processamento, o popup recebe percentual e títulos legíveis.
  let viuProgresso = null;
  for (let i = 0; i < 200 && !viuProgresso; i += 1) {
    const pr = await app.progressoPregao(pregao.id);
    if (pr.ativo && pr.tarefas.some((t) => t.titulo.startsWith('Proposta · RASCORP'))) viuProgresso = pr;
    else await new Promise((r) => setTimeout(r, 50));
  }
  assert.ok(viuProgresso, 'o progresso da proposta deveria aparecer enquanto ela é processada');
  assert.ok(viuProgresso.percentual >= 0 && viuProgresso.percentual <= 100);
  await orquestrador.aguardarOcioso();
  const proposta = (await repo.buscar('tarefas', { tipo: 'analisar_proposta' }))[0];
  assert.equal(proposta.progresso.percentual, 100);
  assert.equal((await app.progressoPregao(pregao.id)).ativo, false);
  await app.iniciarAnalise(pregao.id);
  await orquestrador.aguardarOcioso();

  const [grupo] = (await app.checklist(pregao.id)).filter((g) => g.item === '1');
  assert.equal(grupo.resumo, 'não atende');
  const porAttr = Object.fromEntries(grupo.linhas.map((l) => [l.atributo, l.status]));
  const esperadoPorAttr = Object.fromEntries(G.requisitos.map((r) => [r.atributo, G.esperado[r.id]]));
  const iguais = Object.keys(esperadoPorAttr).filter((a) => porAttr[a] === esperadoPorAttr[a]);
  const vereditoErrado = Object.keys(esperadoPorAttr).filter((a) => porAttr[a] !== esperadoPorAttr[a] && ['ATENDE', 'NÃO ATENDE'].includes(porAttr[a]));
  console.log(`checklist ponta a ponta: ${iguais.length}/${Object.keys(esperadoPorAttr).length} iguais ao gabarito`);
  for (const a of Object.keys(esperadoPorAttr).filter((x) => porAttr[x] !== esperadoPorAttr[x])) console.log(`  diferente: ${a} -> ${porAttr[a]} (gabarito ${esperadoPorAttr[a]})`);
  assert.deepEqual(vereditoErrado, [], 'nenhum ATENDE/NÃO ATENDE pode divergir do gabarito');
  for (const a of ['fonte_potencia', 'sistema_operacional', 'garantia', 'gabinete_formato', 'linha_corporativa_serie']) assert.equal(porAttr[a], 'NÃO ATENDE', a);
  assert.ok(grupo.alertas_preco.some((x) => Math.abs(x.valor - 5405.31) < 0.01));

  // Visão completa: todos os requisitos validados aparecem, nenhum de fora.
  const validados = (await repo.buscar('requisitos', { pregao_id: pregao.id, status_validacao: 'validado' })).length;
  const [completa] = await app.visaoCompleta(pregao.id);
  assert.equal(completa.total, validados, 'a visão completa precisa ter todos os requisitos validados');
  assert.equal(Object.values(completa.contagem).reduce((s, n) => s + n, 0), validados, 'a soma dos status fecha com o total');
  assert.ok(completa.linhas.filter((l) => l.grupo === 'item_2').every((l) => l.status === 'NÃO OFERTADO'), 'item 2 não ofertado');
  const hab = completa.linhas.filter((l) => l.grupo === 'habilitacao');
  assert.equal(hab.length, 2);
  assert.ok(hab.every((l) => l.status === 'NÃO COMPROVADO' && l.faltante), 'habilitação conferida; ausência = faltante');
  console.log(`visão completa: ${completa.total} requisitos ->`, JSON.stringify(completa.contagem));

  // Texto de recusa: cita cada exigência não atendida (com código), exigido × ofertado e a fundamentação.
  const recusa = await app.gerarTexto(completa.proposta_id, { tipo: 'recusa' });
  assert.match(recusa.texto, /MOTIVOS DA RECUSA/);
  assert.match(recusa.texto, /\[item_1-L028-1\]/, 'fonte de 650 W precisa estar entre os motivos');
  assert.match(recusa.texto, /art\. 59, inciso II, da Lei nº 14\.133\/2021/);
  assert.equal(recusa.codigos.length, completa.contagem['NÃO ATENDE'], 'um motivo por exigência não atendida');
  const diligencia = await app.gerarTexto(completa.proposta_id, { tipo: 'diligencia' });
  assert.match(diligencia.texto, /SOLICITAÇÃO DE DILIGÊNCIA/);
  assert.ok(diligencia.codigos.length > 0);
  const melhor = await app.melhorarTextoComIA(completa.proposta_id, { texto: recusa.texto, codigos: recusa.codigos });
  assert.match(melhor.texto, /constatou-se/);
  process.env.IA_PERDE_ITEM = '1';
  await assert.rejects(app.melhorarTextoComIA(completa.proposta_id, { texto: recusa.texto, codigos: recusa.codigos }), /sem perder conteúdo/);
  delete process.env.IA_PERDE_ITEM;
  if (process.env.SALVAR_TEXTO) (await import('node:fs')).writeFileSync(process.env.SALVAR_TEXTO, recusa.texto);

  // Julgamento: o edital diz "Menor Preço por item" -> por item (sem linhas de lote), com a prova do edital.
  const pj = (await app.painelPregao(pregao.id)).pregao;
  assert.equal(pj.julgamento_por_lote_efetivo, false);
  assert.equal(pj.julgamento_encontrado, true);
  assert.equal(pj.julgamento_evidencia.documento, 'edital');
  assert.equal(pj.julgamento_evidencia.pagina, 1);
  assert.match(pj.julgamento_evidencia.trecho, /Menor Preço por item/);
  assert.ok(!completa.linhas.some((l) => l.grupo.startsWith('lote_')));
  // Simulação de julgamento por lote: itens 1 e 2 no mesmo lote; a Rascorp só ofertou o item 1.
  const item2 = (await repo.buscar('itens', { pregao_id: pregao.id })).find((i) => i.numero === '2');
  await repo.atualizar('itens', item2.id, { lote: '1' });
  await app.definirJulgamento(pregao.id, true);
  const [porLote] = await app.visaoCompleta(pregao.id);
  const linhaLote = porLote.linhas.find((l) => l.requisito_codigo === 'LOTE-1');
  assert.equal(linhaLote.status, 'NÃO ATENDE');
  assert.match(linhaLote.justificativa, /não foram ofertados o\(s\) item\(ns\) 2/);
  assert.equal(porLote.resumo, 'não atende');
  assert.match((await app.gerarTexto(porLote.proposta_id, { tipo: 'recusa' })).texto, /\[LOTE-1\][\s\S]*Proposta incompleta para o lote 1/);
  // Lote completo: com o item 2 em outro lote, a linha do lote 1 passa a ATENDE.
  await repo.atualizar('itens', item2.id, { lote: '2' });
  const [completo] = await app.visaoCompleta(pregao.id);
  assert.equal(completo.linhas.find((l) => l.requisito_codigo === 'LOTE-1').status, 'ATENDE');
  await app.definirJulgamento(pregao.id, null);

  const ia = await app.painelIA(pregao.id);
  if (process.env.SALVAR_EXEMPLO) {
    const { writeFileSync } = await import('node:fs');
    const painelFinal = await app.painelPregao(pregao.id);
    const especificacoes = await app.especificacoesDaProposta(painelFinal.propostas[0].id);
    writeFileSync(process.env.SALVAR_EXEMPLO, JSON.stringify({ painel: painelFinal, checklist: await app.checklist(pregao.id), completa: await app.visaoCompleta(pregao.id), especificacoes, ia, pregoes: await app.listarPregoes({ perfil: 'admin' }) }));
  }
  assert.ok(!ia.ultimas.some((e) => e.alias === 'ia-leve' && /^e4|^e5|^e6/.test(e.tarefa)), 'proposta não pode ir para ia-leve');
});
