// Etapas do processamento. Cada função recebe uma tarefa do orquestrador.
//  analisar_documento     E0/E1/E2: lê o PDF no pdf-worker, grava partes, itens, conflitos e o esqueleto
//  e3_lote                E3: tipifica um lote de linhas do esqueleto (ia-media)
//  e3b_capitulo           E3: requisitos gerais/habilitação em texto corrido (ia-leve: só documento público)
//  analisar_proposta      E4: extrai a proposta (ia-media; nuvem só com texto mascarado)
//  analisar_item_proposta E5 + E6: de-para e avaliação de um item de uma proposta
import { cosseno, localizarTrecho, normalizar, vetorNgramas } from '../nucleo/texto.js';
import { mascarar } from '../nucleo/lgpd.js';
import { avaliar, combinarPareceres, STATUS } from '../nucleo/regras.js';
import { normalizarNumeroItem } from '../nucleo/normalizacao.js';
import { aplicaAoItem } from '../nucleo/aplicabilidade.js';
import { detectarJulgamento } from '../nucleo/julgamento.js';
import { carregarPrompt, validarE3, validarE3b, validarE4, validarE5, validarE6 } from '../ia/validacoes.js';

const PROMPTS = {
  e3: carregarPrompt('e3_tipificar_linhas'),
  e3b: carregarPrompt('e3b_texto_corrido'),
  e4: carregarPrompt('e4_proposta'),
  e5: carregarPrompt('e5_pares'),
  e6: carregarPrompt('e6_texto_livre'),
  e6b: carregarPrompt('e6b_habilitacao'),
};
const msgs = (prompt, dados) => [
  { role: 'system', content: prompt.texto },
  { role: 'user', content: JSON.stringify(dados) },
];
const fatiar = (lista, n) => Array.from({ length: Math.ceil(lista.length / n) }, (_, i) => lista.slice(i * n, i * n + n));
const slug = (t) => normalizar(t).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
const LIMITE_CAPITULO = 12000;
const LIMITE_PROPOSTA = 14000;

function fatiarTexto(texto, limite) {
  const partes = []; let atual = '';
  for (const par of String(texto).split(/\n/)) {
    if ((atual + par).length > limite && atual) { partes.push(atual); atual = ''; }
    atual += `${par}\n`;
  }
  if (atual.trim()) partes.push(atual);
  return partes;
}

export function criarEtapas({ repo, roteador, pdfWorker, embedder, config, lerArquivo }) {
  // ------------------------------------------------------------------ E0/E1/E2
  async function analisar_documento(tarefa, { agendar, progresso }) {
    const doc = await repo.obter('documentos', tarefa.payload.documento_id);
    const pdf = await lerArquivo(doc.caminho);
    await progresso(5, 'Lendo o PDF (texto, tabelas, anexos e marcadores de lista)');
    const a = await pdfWorker.analisarEdital(pdf);
    await progresso(70, `PDF lido: ${a.conversao.paginas.length} páginas. Gravando anexos, itens e conflitos`);
    const analise = {
      metadados: a.metadados,
      partes: a.partes,
      tabelas_itens: a.tabelas_itens,
      capitulos: a.capitulos,
      esqueleto: a.esqueleto,
      paginas: a.conversao.paginas.map((p) => ({ pagina: p.pagina, texto: p.texto })),
      paginas_sem_texto: a.conversao.paginas_sem_texto,
    };
    await repo.atualizar('documentos', doc.id, { analise, paginas: a.conversao.paginas.length, status: 'analisado' });

    await repo.remover('partes_documento', { documento_id: doc.id });
    for (const p of a.partes) {
      await repo.inserir('partes_documento', { documento_id: doc.id, pregao_id: doc.pregao_id, titulo: p.titulo, nome: p.nome, tipo: p.tipo, pagina_inicio: p.pagina_inicio, gera_requisitos: p.gera_requisitos });
    }

    if (doc.papel === 'edital') {
      const pregao = await repo.obter('pregoes', doc.pregao_id);
      const m = a.metadados;
      await repo.atualizar('pregoes', pregao.id, {
        numero: pregao.numero || m.numero, processo: pregao.processo || m.processo, uasg: pregao.uasg || m.uasg,
        orgao: pregao.orgao || m.orgao, criterio: pregao.criterio || m.criterio_julgamento,
        valor_total: pregao.valor_total ?? m.valor_total, validade_minima_dias: pregao.validade_minima_dias ?? m.validade_minima_proposta_dias,
        atualizado_em: new Date().toISOString(),
      });
    }

    await atualizarItensEConflitos(doc.pregao_id);
    await atualizarJulgamento(doc.pregao_id);
    await progresso(90, 'Preparando a extração de requisitos por item');

    // Requisitos técnicos por item: só do TR (ou do edital, se o TR estiver dentro dele).
    const docs = await repo.buscar('documentos', { pregao_id: doc.pregao_id });
    const temTr = docs.some((d) => d.papel === 'tr');
    const fonteDosItens = doc.papel === 'tr' || (doc.papel === 'edital' && !temTr);
    if (fonteDosItens && !a.esqueleto.sem_marcadores) {
      await repo.remover('linhas_esqueleto', { pregao_id: doc.pregao_id });
      // Lote de cada item: do bloco do TR ("Lote 1 › Item 2") ou, se não houver, da tabela de itens.
      const loteDaTabela = Object.fromEntries((await repo.buscar('itens', { pregao_id: doc.pregao_id })).map((i) => [i.numero, i.lote ? String(i.lote) : null]));
      for (const [chaveBloco, bloco] of Object.entries(a.esqueleto.blocos)) {
        const loteBloco = bloco.lote ?? (bloco.item ? loteDaTabela[bloco.item] ?? null : null);
        for (const l of bloco.linhas) {
          await repo.inserir('linhas_esqueleto', { pregao_id: doc.pregao_id, codigo: l.id, item_numero: bloco.item, lote: loteBloco, secao: l.secao, nivel: l.nivel, texto: l.texto, pagina: l.pagina, pai: l.pai || null, so_agrupa: l.so_agrupa });
        }
        const validas = bloco.linhas.filter((l) => !l.so_agrupa).map((l) => l.id);
        const partes = fatiar(validas, config.e3LinhasPorLote); // pedaços de até N linhas por chamada de IA
        const nomeBloco = bloco.item ? `Item ${bloco.item} · ${bloco.descricao}` : bloco.lote ? `Lote ${bloco.lote} · requisitos comuns` : 'gerais';
        for (const [i, parte] of partes.entries()) {
          const titulo = `Requisitos · ${nomeBloco} · parte ${i + 1} de ${partes.length}`;
          await agendar(doc.pregao_id, 'e3_lote', `${doc.id}:${chaveBloco}:${i}`, { documento_id: doc.id, item_numero: bloco.item, lote: loteBloco, descricao: bloco.descricao, codigos: parte, titulo });
        }
      }
    }
    // Sem marcadores de lista: a IA extrai os itens direto dos capítulos de especificação.
    const capitulos = a.capitulos || [];
    for (const cap of capitulos) {
      const titulo = normalizar(cap.titulo);
      const ehEspecificacao = fonteDosItens && a.esqueleto.sem_marcadores && /ESPECIFICA|DESCRICAO DA SOLUCAO/.test(titulo);
      const ehGeral = config.capitulosGerais.some((p) => titulo.includes(normalizar(p)));
      const ehHabilitacao = doc.papel !== 'edital' && config.capitulosHabilitacao.some((p) => titulo.includes(normalizar(p)));
      if (ehEspecificacao || ehGeral) await agendar(doc.pregao_id, 'e3b_capitulo', `${doc.id}:${cap.titulo}:TECNICO`, { documento_id: doc.id, titulo: cap.titulo, categoria: 'TECNICO', rotulo: `Requisitos gerais · ${cap.titulo}` });
      if (ehHabilitacao) await agendar(doc.pregao_id, 'e3b_capitulo', `${doc.id}:${cap.titulo}:HABILITACAO`, { documento_id: doc.id, titulo: cap.titulo, categoria: 'HABILITACAO', rotulo: `Habilitação · ${cap.titulo}` });
    }
  }

  // Critério de julgamento (por item ou por lote), procurado no edital e no TR inteiros, com o trecho de prova.
  async function atualizarJulgamento(pregaoId) {
    const docs = (await repo.buscar('documentos', { pregao_id: pregaoId })).filter((d) => d.analise?.paginas);
    const r = detectarJulgamento(docs.map((d) => ({ papel: d.papel, nome_arquivo: d.nome_arquivo, paginas: d.analise.paginas })));
    await repo.atualizar('pregoes', pregaoId, { julgamento_fonte: r });
    if (r.conflito) {
      const nome = (m) => (m === 'lote' ? 'por lote' : 'por item');
      await repo.inserir('conflitos', { pregao_id: pregaoId, campo: 'Critério de julgamento', resolvido: false, valores: [
        { valor: nome(r.conflito.a_favor.modo), fonte: `${r.conflito.a_favor.arquivo}, p. ${r.conflito.a_favor.pagina}: "${r.conflito.a_favor.trecho}"` },
        { valor: nome(r.conflito.contra.modo), fonte: `${r.conflito.contra.arquivo}, p. ${r.conflito.contra.pagina}: "${r.conflito.contra.trecho}"` }] });
    }
  }

  async function atualizarItensEConflitos(pregaoId) {
    const docs = (await repo.buscar('documentos', { pregao_id: pregaoId })).filter((d) => d.analise && d.publico);
    const oficial = docs.find((d) => d.papel === 'tr' && d.analise.tabelas_itens?.length) || docs.find((d) => d.analise.tabelas_itens?.length);
    if (!oficial) return;
    const tabelaOficial = oficial.analise.tabelas_itens[0];
    for (const it of tabelaOficial.itens) {
      await repo.upsert('itens', ['pregao_id', 'numero'], {
        pregao_id: pregaoId, numero: it.item, lote: it.lote, descricao: it.descricao, unidade: it.unidade, quantidade: it.quantidade,
        valor_unitario_estimado: it.valor_unitario_estimado, codigos_catalogo: it.codigos_catalogo,
        fonte: { documento: oficial.nome_arquivo, pagina: tabelaOficial.pagina },
      });
    }
    // Conflitos: o mesmo valor aparece diferente em outro documento/tabela. O sistema registra e não escolhe.
    await repo.remover('conflitos', { pregao_id: pregaoId });
    const referencia = Object.fromEntries(tabelaOficial.itens.map((i) => [i.item, i]));
    for (const d of docs) {
      for (const tb of d.analise.tabelas_itens || []) {
        if (d.id === oficial.id && tb === tabelaOficial) continue;
        for (const it of tb.itens) {
          const ref = referencia[it.item];
          if (!ref || it.valor_unitario_estimado == null || ref.valor_unitario_estimado == null) continue;
          if (Math.abs(it.valor_unitario_estimado - ref.valor_unitario_estimado) > 0.009) {
            await repo.inserir('conflitos', { pregao_id: pregaoId, campo: `Valor unitário estimado do item ${it.item}`, resolvido: false, valores: [
              { valor: ref.valor_unitario_estimado, fonte: `${oficial.nome_arquivo}, p. ${tabelaOficial.pagina}` },
              { valor: it.valor_unitario_estimado, fonte: `${d.nome_arquivo}, p. ${tb.pagina}` }] });
          }
        }
      }
    }
    const somaOficial = tabelaOficial.itens.reduce((s, i) => s + (i.valor_total_estimado || 0), 0);
    const edital = docs.find((d) => d.papel === 'edital');
    const totalEdital = edital?.analise.metadados?.valor_total;
    if (somaOficial && totalEdital && Math.abs(somaOficial - totalEdital) > 0.009) {
      await repo.inserir('conflitos', { pregao_id: pregaoId, campo: 'Valor total da contratação', resolvido: false, valores: [
        { valor: Math.round(somaOficial * 100) / 100, fonte: `${oficial.nome_arquivo} (soma da tabela de itens)` },
        { valor: totalEdital, fonte: `${edital.nome_arquivo} (capa do edital)` }] });
    }
  }

  // ------------------------------------------------------------------ E3 (esqueleto)
  async function e3_lote(tarefa, { progresso }) {
    const { documento_id, item_numero, descricao, codigos, lote = null } = tarefa.payload;
    const todas = await repo.buscar('linhas_esqueleto', { pregao_id: tarefa.pregao_id });
    const porCodigo = Object.fromEntries(todas.map((l) => [l.codigo, l]));
    const linhas = codigos.map((c) => porCodigo[c]).filter(Boolean)
      .map((l) => ({ id: l.codigo, secao: l.secao, texto: l.texto, ...(l.pai ? { pai: porCodigo[l.pai]?.texto } : {}) }));
    await progresso(10, `IA transformando ${linhas.length} linhas do TR em requisitos`);
    const r = await roteador.executar({
      tarefa: 'e3_requisitos', pregaoId: tarefa.pregao_id, rota: config.rotas.e3_requisitos, dados: 'publico',
      montar: async () => ({ mensagens: msgs(PROMPTS.e3, { item: item_numero ?? 'requisitos gerais', descricao, linhas }), mascarado: false }),
      validar: (json) => validarE3(json, linhas),
    });
    await progresso(90, `Gravando ${r.json.requisitos.length} requisitos (${r.alias})`);
    for (const c of codigos) await repo.remover('requisitos', { pregao_id: tarefa.pregao_id, linha_codigo: c });
    const contador = {};
    for (const q of r.json.requisitos) {
      const l = porCodigo[q.linha_id];
      contador[q.linha_id] = (contador[q.linha_id] || 0) + 1;
      await repo.inserir('requisitos', {
        pregao_id: tarefa.pregao_id, item_numero: item_numero ?? null, lote: lote ?? null, codigo: `${q.linha_id}-${contador[q.linha_id]}`, linha_codigo: q.linha_id,
        categoria: 'TECNICO', secao: l.secao, atributo: q.atributo, tipo: q.tipo, operador: q.operador ?? null, valor: q.valor ?? null,
        valor_min: q.valor_min ?? null, valor_max: q.valor_max ?? null, unidade: q.unidade ?? null, opcoes: q.opcoes ?? null,
        condicao: q.condicao ?? null, obrigatorio: q.obrigatorio !== false, conflito: null,
        origem: { documento_id, pagina: l.pagina, trecho: q.trecho, linha: l.codigo, fonte: 'pagina' },
        status_validacao: 'pendente', extraido_por: `${r.alias} · ${PROMPTS.e3.versao}`,
      });
    }
  }

  // ------------------------------------------------------------------ E3 (texto corrido)
  async function e3b_capitulo(tarefa, { progresso }) {
    const { documento_id, titulo, categoria } = tarefa.payload;
    const loteDaTabela = Object.fromEntries((await repo.buscar('itens', { pregao_id: tarefa.pregao_id })).map((x) => [x.numero, x.lote ? String(x.lote) : null]));
    const doc = await repo.obter('documentos', documento_id);
    const cap = doc.analise.capitulos.find((c) => c.titulo === titulo);
    const linhaCodigo = `cap:${slug(titulo)}:${categoria}`;
    await repo.remover('requisitos', { pregao_id: tarefa.pregao_id, linha_codigo: linhaCodigo });
    let n = 0;
    const partes = fatiarTexto(cap.texto, LIMITE_CAPITULO);
    for (const [k, parte] of partes.entries()) {
      await progresso(10 + (80 * k) / partes.length, `IA lendo a parte ${k + 1} de ${partes.length} do capítulo`);
      const r = await roteador.executar({
        tarefa: `e3b_${categoria.toLowerCase()}`, pregaoId: tarefa.pregao_id, rota: config.rotas.e2_gerais, dados: 'publico',
        montar: async () => ({ mensagens: msgs(PROMPTS.e3b, { categoria, titulo, texto: parte }), mascarado: false }),
        validar: (json) => validarE3b(json, parte),
      });
      for (const q of r.json.requisitos) {
        n += 1;
        const pag = localizarTrecho(q.trecho, doc.analise.paginas.map((p) => ({ ...p, tipo: 'pagina' })));
        await repo.inserir('requisitos', {
          pregao_id: tarefa.pregao_id, item_numero: q.item ? String(q.item) : null, lote: q.lote ? String(q.lote).replace(/\D/g, '') || null : (q.item ? loteDaTabela[String(q.item)] ?? null : null), codigo: `${categoria === 'HABILITACAO' ? 'H' : 'G'}-${slug(titulo).slice(0, 12)}-${n}`,
          linha_codigo: linhaCodigo, categoria, secao: titulo, atributo: q.atributo, tipo: q.tipo, operador: q.operador ?? null, valor: q.valor ?? null,
          valor_min: q.valor_min ?? null, valor_max: q.valor_max ?? null, unidade: q.unidade ?? null, opcoes: q.opcoes ?? null, condicao: null,
          obrigatorio: q.obrigatorio !== false, conflito: q.conflito ?? null,
          origem: { documento_id, pagina: pag?.pagina ?? cap.pagina, trecho: q.trecho, capitulo: titulo, fonte: 'pagina' },
          status_validacao: q.conflito ? 'conflito' : 'pendente', extraido_por: `${r.alias} · ${PROMPTS.e3b.versao}`,
        });
      }
    }
  }

  // ------------------------------------------------------------------ E4 (proposta)
  async function analisar_proposta(tarefa, { progresso }) {
    const proposta = await repo.obter('propostas', tarefa.payload.proposta_id);
    const doc = await repo.obter('documentos', proposta.documento_id);
    await progresso(5, 'Lendo o PDF da proposta (texto, tabelas e OCR)');
    const a = await pdfWorker.analisarProposta(await lerArquivo(doc.caminho));
    const paginas = a.conversao.paginas.map((p) => ({ pagina: p.pagina, texto: p.texto, tipo: 'pagina' }));
    const celulas = a.conversao.celulas.map((c) => ({ pagina: c.pagina, texto: c.texto, tipo: 'celula' }));
    await repo.atualizar('documentos', doc.id, { analise: { paginas, celulas, lgpd: a.lgpd, paginas_sem_texto: a.conversao.paginas_sem_texto }, paginas: paginas.length, status: 'analisado' });

    const itensDoPregao = await repo.buscar('itens', { pregao_id: tarefa.pregao_id });
    const itensDoEdital = itensDoPregao.map((x) => ({ numero: x.numero, descricao: x.descricao }));
    const secoes = [...new Set((await repo.buscar('requisitos', { pregao_id: tarefa.pregao_id })).map((r) => r.secao).filter(Boolean))];
    const original = [...paginas, ...celulas];
    const mascaradas = original.map((f) => ({ ...f, texto: mascarar(f.texto) }));

    // Propostas grandes (catálogos) são lidas em blocos de páginas para caber no contexto do modelo local.
    const blocos = []; let atual = [];
    for (const p of paginas) {
      if (atual.length && [...atual, p].reduce((s, x) => s + x.texto.length, 0) > LIMITE_PROPOSTA) { blocos.push(atual); atual = []; }
      atual.push(p);
    }
    if (atual.length) blocos.push(atual);

    const resultado = { fornecedor: {}, referencias_externas: [], itens: {} };
    let usado = '';
    await progresso(20, `PDF lido: ${paginas.length} páginas. Dados pessoais mascarados para a nuvem: ${Object.values(a.lgpd || {}).reduce((s, x) => s + x, 0)}`);
    for (const [b, bloco] of blocos.entries()) {
      const nums = new Set(bloco.map((p) => p.pagina));
      await progresso(20 + (70 * b) / blocos.length,
        `IA lendo as páginas ${bloco[0].pagina}–${bloco[bloco.length - 1].pagina} de ${paginas.length}${blocos.length > 1 ? ` (bloco ${b + 1} de ${blocos.length})` : ''}`);
      let fontesUsadas = original;
      const r = await roteador.executar({
        tarefa: 'e4_proposta', pregaoId: tarefa.pregao_id, rota: config.rotas.e4_proposta, dados: 'proposta',
        montar: async ({ nuvem }) => {
          fontesUsadas = nuvem ? mascaradas : original;
          const pg = fontesUsadas.filter((f) => f.tipo === 'pagina' && nums.has(f.pagina));
          const cel = [...new Set(fontesUsadas.filter((f) => f.tipo === 'celula' && nums.has(f.pagina)).map((f) => f.texto))];
          return { mensagens: msgs(PROMPTS.e4, { itens_do_edital: itensDoEdital, secoes_do_edital: secoes, texto: pg.map((p) => `[página ${p.pagina}]\n${p.texto}`).join('\n\n'), celulas: cel }), mascarado: nuvem };
        },
        validar: (json) => validarE4(json, fontesUsadas),
      });
      usado = r.alias;
      Object.assign(resultado.fornecedor, Object.fromEntries(Object.entries(r.json.fornecedor || {}).filter(([, v]) => v)));
      for (const k of ['validade_dias', 'prazo_entrega_dias', 'garantia_meses']) resultado[k] = resultado[k] ?? r.json[k] ?? null;
      resultado.referencias_externas.push(...(r.json.referencias_externas || []).filter((x) => x?.trecho));
      for (const it of r.json.itens || []) {
        const k = normalizarNumeroItem(it.item, itensDoPregao) || String(it.item);
        const alvo = resultado.itens[k] || (resultado.itens[k] = { item: k, especificacoes: [] });
        for (const c of ['marca', 'fabricante', 'modelo', 'quantidade', 'valor_unitario']) alvo[c] = alvo[c] ?? it[c] ?? null;
        alvo.especificacoes.push(...(it.especificacoes || []));
      }
    }

    const totalSpecs = Object.values(resultado.itens).reduce((s, it) => s + it.especificacoes.length, 0);
    await progresso(92, `Gravando ${totalSpecs} especificações de ${Object.keys(resultado.itens).length} item(ns)`);
    await repo.atualizar('propostas', proposta.id, {
      validade_dias: resultado.validade_dias, prazo_entrega_dias: resultado.prazo_entrega_dias, garantia_meses: resultado.garantia_meses,
      referencias_externas: resultado.referencias_externas, json_bruto: resultado, status: 'extraida', extraido_por: `${usado} · ${PROMPTS.e4.versao}`,
    });
    await repo.remover('itens_proposta', { proposta_id: proposta.id });
    for (const it of Object.values(resultado.itens)) {
      const ip = await repo.inserir('itens_proposta', {
        proposta_id: proposta.id, pregao_id: tarefa.pregao_id, item_numero: it.item, marca: it.marca, fabricante: it.fabricante, modelo: it.modelo,
        quantidade: it.quantidade, valor_unitario: it.valor_unitario,
      });
      for (const [i, e] of it.especificacoes.entries()) {
        const onde = localizarTrecho(e.trecho, original) || localizarTrecho(e.trecho, mascaradas);
        await repo.inserir('especificacoes', {
          item_proposta_id: ip.id, codigo: `E${String(i + 1).padStart(3, '0')}`, secao_declarada: e.secao_declarada ?? null,
          atributo_declarado: e.atributo_declarado ?? null, valor: e.valor ?? null, unidade: e.unidade ?? null, vago: !!e.vago,
          alternativas: e.alternativas ?? null, contradiz: e.contradiz ?? null, negado: !!e.negado, identificador_modelo: !!e.identificador_modelo,
          origem: { documento_id: doc.id, pagina: onde?.pagina ?? null, trecho: e.trecho, fonte: onde?.fonte ?? null },
        });
      }
    }
  }

  // ------------------------------------------------------------------ E5 + E6
  async function analisar_item_proposta(tarefa, { progresso }) {
    await progresso(5, 'Carregando requisitos validados e especificações ofertadas');
    const ip = await repo.obter('itens_proposta', tarefa.payload.item_proposta_id);
    const todos = await repo.buscar('requisitos', { pregao_id: ip.pregao_id, status_validacao: 'validado', categoria: 'TECNICO' });
    const itensDoPregao = await repo.buscar('itens', { pregao_id: ip.pregao_id });
    const pregao = await repo.obter('pregoes', ip.pregao_id);
    const opcoesRegra = { ausenciaReprova: pregao?.ausencia_reprova ?? config.ausenciaReprova };
    const numeroDoItem = normalizarNumeroItem(ip.item_numero, itensDoPregao);
    const loteDoItem = Object.fromEntries(itensDoPregao.map((x) => [x.numero, x.lote ? String(x.lote) : x.numero]));
    const reqs = todos.filter((r) => aplicaAoItem(r, numeroDoItem, loteDoItem));
    const specs = await repo.buscar('especificacoes', { item_proposta_id: ip.id });
    const existentes = Object.fromEntries((await repo.buscar('depara', { item_proposta_id: ip.id })).map((d) => [d.requisito_id, d]));

    // E5: de-para em dois níveis (seção, depois atributo)
    await progresso(15, `De-para: ligando ${reqs.length} requisitos às ${specs.length} especificações`);
    const pares = await deparaDoisNiveis(reqs, specs);
    const duvidosos = pares.filter((p) => p.duvidoso && !existentes[p.req.id]?.validado_por);
    if (duvidosos.length && specs.length) {
      await progresso(30, `IA conferindo ${duvidosos.length} pares de-para com pouca certeza`);
      try {
        const ids = new Set(duvidosos.map((p) => p.req.id));
        const r = await roteador.executar({
          tarefa: 'e5_pares', pregaoId: ip.pregao_id, rota: config.rotas.e5_pares, dados: 'proposta',
          montar: async ({ nuvem }) => ({
            mascarado: nuvem,
            mensagens: msgs(PROMPTS.e5, {
              requisitos: duvidosos.map((p) => ({ id: p.req.id, secao: p.req.secao, atributo: p.req.atributo, trecho: p.req.origem.trecho })),
              especificacoes: specs.map((s) => ({ id: s.id, secao_declarada: s.secao_declarada, atributo_declarado: s.atributo_declarado, valor: s.valor, trecho: nuvem ? mascarar(s.origem.trecho) : s.origem.trecho })),
            }),
          }),
          validar: (json) => validarE5(json, ids, new Set(specs.map((s) => s.id))),
        });
        for (const par of r.json.pares) {
          const p = pares.find((x) => x.req.id === par.requisito_id);
          p.spec = specs.find((s) => s.id === par.especificacao_id) || null;
          p.metodo = r.alias;
        }
      } catch (erro) {
        console.warn('[E5] pares duvidosos ficaram sem IA:', erro.message);
      }
    }
    for (const p of pares) {
      const humano = existentes[p.req.id];
      if (humano?.validado_por) { p.spec = specs.find((s) => s.id === humano.especificacao_id) || null; continue; }
      await repo.upsert('depara', ['requisito_id', 'item_proposta_id'], {
        pregao_id: ip.pregao_id, requisito_id: p.req.id, item_proposta_id: ip.id, especificacao_id: p.spec?.id ?? null,
        secao_casada: p.secao ?? null, confianca: Math.round(p.confianca * 1000) / 1000, metodo: p.metodo, validado_por: null,
      });
    }

    // E6: regras; o que for descritivo vai para as duas IAs
    await progresso(50, 'Comparando requisito × oferta pelas regras');
    const resultados = new Map();
    const paraIA = [];
    for (const p of pares) {
      let r;
      try { r = avaliar(p.req, p.spec, ip, opcoesRegra); } catch (erro) {
        // Um requisito com dado estranho vira REVISAR; nunca derruba a análise do item inteiro.
        r = { status: STATUS.REVISAR, justificativa: `Não foi possível comparar automaticamente (${erro.message}). Confira o requisito na Etapa 02.`, metodo: 'regra', precisa_ia: false };
      }
      if (r.precisa_ia) paraIA.push(p); else resultados.set(p.req.id, { ...r, aliases: [] });
    }
    if (paraIA.length) {
      await progresso(60, `IA julgando ${paraIA.length} requisitos descritivos (com segunda opinião)`);
      const ids = new Set(paraIA.map((p) => p.req.id));
      const montarE6 = async ({ nuvem }) => ({
        mascarado: nuvem,
        mensagens: msgs(PROMPTS.e6, {
          item_ofertado: { marca: ip.marca, fabricante: ip.fabricante, modelo: ip.modelo },
          avaliacoes: paraIA.map((p) => ({
            requisito_id: p.req.id, secao: p.req.secao, requisito: p.req.origem.trecho,
            especificacao: p.spec ? (nuvem ? mascarar(p.spec.origem.trecho) : p.spec.origem.trecho) : null,
            contexto_da_secao: specs.filter((s) => p.secao && s.secao_declarada === p.secao).map((s) => (nuvem ? mascarar(s.origem.trecho) : s.origem.trecho)),
          })),
        }),
      });
      const chamar = (rota, tarefaNome) => roteador.executar({ tarefa: tarefaNome, pregaoId: ip.pregao_id, rota, dados: 'proposta', montar: montarE6, validar: (j) => validarE6(j, ids) })
        .then((r) => ({ alias: r.alias, porId: Object.fromEntries(r.json.avaliacoes.map((x) => [x.requisito_id, x])) }))
        .catch((erro) => { console.warn(`[E6] ${tarefaNome}:`, erro.message); return null; });
      const [principal, segunda] = await Promise.all([chamar(config.rotas.e6_texto_livre, 'e6_principal'), chamar(config.rotas.e6_segunda, 'e6_segunda_opiniao')]);
      for (const p of paraIA) {
        const c = combinarPareceres(principal?.porId[p.req.id], segunda?.porId[p.req.id], opcoesRegra);
        resultados.set(p.req.id, { ...c, aliases: [principal?.alias, segunda?.alias].filter(Boolean) });
      }
    }
    await progresso(90, `Gravando o checklist (${pares.length} linhas)`);
    for (const p of pares) {
      const r = resultados.get(p.req.id);
      await repo.upsert('avaliacoes', ['requisito_id', 'item_proposta_id'], {
        pregao_id: ip.pregao_id, requisito_id: p.req.id, item_proposta_id: ip.id, status: r.status, justificativa: r.justificativa,
        metodo: r.metodo, aliases: r.aliases, concordancia_ias: r.concordancia_ias ?? null, revisao_status: 'pendente', faltante: Boolean(r.faltante),
        evidencia: p.spec ? { pagina: p.spec.origem.pagina, trecho: p.spec.origem.trecho, especificacao: p.spec.codigo } : null,
      });
    }
  }

  // ------------------------------------------------------------------ Habilitação (por proposta)
  // Cada exigência de habilitação validada é procurada no que o fornecedor enviou (proposta e anexos).
  async function analisar_habilitacao(tarefa, { progresso }) {
    const proposta = await repo.obter('propostas', tarefa.payload.proposta_id);
    const exigencias = (await repo.buscar('requisitos', { pregao_id: proposta.pregao_id, status_validacao: 'validado', categoria: 'HABILITACAO' }));
    if (!exigencias.length) return;
    const [primeiroItem] = await repo.buscar('itens_proposta', { proposta_id: proposta.id });
    if (!primeiroItem) throw new Error('A proposta ainda não foi extraída (nenhum item encontrado).');
    const doc = await repo.obter('documentos', proposta.documento_id);
    const paginas = doc.analise?.paginas || [];
    const pregao = await repo.obter('pregoes', proposta.pregao_id);
    const opcoesRegra = { ausenciaReprova: pregao?.ausencia_reprova ?? config.ausenciaReprova };
    const blocos = fatiarTexto(paginas.map((p) => `[página ${p.pagina}]\n${p.texto}`).join('\n\n'), LIMITE_PROPOSTA);
    const ids = new Set(exigencias.map((r) => r.id));
    const ORDEM = { 'ATENDE': 4, 'NÃO ATENDE': 3, 'VAGO': 2, 'NÃO COMPROVADO': 1 };
    const melhor = { principal: {}, segunda: {} };
    for (const [b, bloco] of blocos.entries()) {
      await progresso(10 + (80 * b) / blocos.length, `IA procurando ${exigencias.length} exigências de habilitação (parte ${b + 1} de ${blocos.length})`);
      const montar = async ({ nuvem }) => ({
        mascarado: nuvem,
        mensagens: msgs(PROMPTS.e6b, { exigencias: exigencias.map((r) => ({ requisito_id: r.id, exigencia: r.origem?.trecho })), documento: nuvem ? mascarar(bloco) : bloco }),
      });
      const chamar = (rota, nome, alvo) => roteador.executar({ tarefa: nome, pregaoId: proposta.pregao_id, rota, dados: 'proposta', montar, validar: (j) => validarE6(j, ids) })
        .then((r) => {
          for (const a of r.json.avaliacoes) {
            const atual = melhor[alvo][a.requisito_id];
            if (!atual || (ORDEM[a.status] ?? 0) > (ORDEM[atual.status] ?? 0)) melhor[alvo][a.requisito_id] = { ...a, alias: r.alias };
          }
        })
        .catch((erro) => console.warn(`[habilitação] ${nome}:`, erro.message));
      await Promise.all([chamar(config.rotas.e6_texto_livre, 'e6b_habilitacao', 'principal'), chamar(config.rotas.e6_segunda, 'e6b_habilitacao_2a', 'segunda')]);
    }
    await progresso(92, 'Gravando o resultado da habilitação');
    for (const r of exigencias) {
      const p = melhor.principal[r.id]; const s2 = melhor.segunda[r.id];
      const c = combinarPareceres(p, s2, opcoesRegra);
      await repo.upsert('avaliacoes', ['requisito_id', 'item_proposta_id'], {
        pregao_id: proposta.pregao_id, requisito_id: r.id, item_proposta_id: primeiroItem.id, status: c.status, justificativa: c.justificativa,
        metodo: 'ia', aliases: [p?.alias, s2?.alias].filter(Boolean), concordancia_ias: c.concordancia_ias ?? null, evidencia: null,
        revisao_status: 'pendente', faltante: Boolean(c.faltante),
      });
    }
  }

  async function deparaDoisNiveis(reqs, specs) {
    if (!specs.length) return reqs.map((req) => ({ req, spec: null, confianca: 0, duvidoso: false, metodo: 'sem_especificacoes' }));
    const secoesSpec = [...new Set(specs.map((s) => s.secao_declarada || ''))];
    const secoesReq = [...new Set(reqs.map((r) => r.secao || ''))];
    const textoReq = (r) => `${r.secao ?? ''} ${r.atributo.replace(/_/g, ' ')} ${r.origem.trecho}`;
    const textoSpec = (s) => `${s.secao_declarada ?? ''} ${(s.atributo_declarado ?? '').replace(/_/g, ' ')} ${s.valor ?? ''} ${s.origem.trecho}`;
    const emb = await embedder.vetores([...secoesReq, ...secoesSpec, ...reqs.map(textoReq), ...specs.map(textoSpec)]);
    const v = emb.vetores;
    const vSecReq = Object.fromEntries(secoesReq.map((s, i) => [s, v[i]]));
    const vSecSpec = Object.fromEntries(secoesSpec.map((s, i) => [s, v[secoesReq.length + i]]));
    const vReq = reqs.map((_, i) => v[secoesReq.length + secoesSpec.length + i]);
    const vSpec = specs.map((_, i) => v[secoesReq.length + secoesSpec.length + reqs.length + i]);
    const ngram = emb.tipo === 'ngramas';
    const limiarSecao = ngram ? 0.3 : 0.6;
    const limiar = ngram ? 0.15 : config.limiarDepara;

    return reqs.map((req, i) => {
      const notas = secoesSpec.map((s) => ({ s, nota: cosseno(vSecReq[req.secao || ''] || vetorNgramas(''), vSecSpec[s]) }));
      const melhor = Math.max(...notas.map((n) => n.nota));
      const secoes = melhor >= limiarSecao ? notas.filter((n) => n.nota >= melhor - 0.05).map((n) => n.s) : null;
      const candidatos = specs.map((s, j) => ({ s, j })).filter(({ s }) => !secoes || secoes.includes(s.secao_declarada || ''));
      let best = null;
      for (const { s, j } of candidatos) {
        const nota = cosseno(vReq[i], vSpec[j]);
        if (!best || nota > best.nota) best = { s, nota };
      }
      const confianca = best?.nota ?? 0;
      const aceita = secoes ? confianca >= limiar || candidatos.length === 1 : confianca >= limiar * 2;
      return {
        req, spec: aceita ? best.s : null, confianca, secao: secoes?.[0] ?? null,
        duvidoso: !aceita && candidatos.length > 0, metodo: emb.tipo,
      };
    });
  }

  return { analisar_documento, e3_lote, e3b_capitulo, analisar_proposta, analisar_item_proposta, analisar_habilitacao, atualizarItensEConflitos, deparaDoisNiveis };
}
