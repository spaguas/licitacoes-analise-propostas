// Descobre, nos documentos do pregão, se o julgamento é POR ITEM ou POR LOTE (grupo/global),
// guardando o trecho e a página que comprovam. O edital tem prioridade sobre o TR.
// Sem nenhum sinal, devolve modo null: a tela avisa e o padrão é "por item".

const SINAIS = [
  // [expressão, modo, peso] — "critério de julgamento" explícito vale mais que menções soltas
  [/crit[ée]rio\s+de\s+julgamento\s*:?\s*[^\n]{0,60}?menor\s+pre[çc]o\s+(?:unit[áa]rio\s+)?por\s+item/i, 'item', 10],
  [/crit[ée]rio\s+de\s+julgamento\s*:?\s*[^\n]{0,60}?menor\s+pre[çc]o\s+(?:global\s+)?por\s+(lote|grupo)/i, 'lote', 10],
  [/crit[ée]rio\s+de\s+julgamento\s*:?\s*[^\n]{0,60}?menor\s+pre[çc]o\s+global/i, 'lote', 10],
  [/crit[ée]rio\s+de\s+julgamento\s*:?\s*[^\n]{0,60}?maior\s+desconto\s+por\s+item/i, 'item', 10],
  [/crit[ée]rio\s+de\s+julgamento\s*:?\s*[^\n]{0,60}?maior\s+desconto\s+(?:global|por\s+(?:lote|grupo))/i, 'lote', 10],
  [/menor\s+pre[çc]o\s+por\s+item/i, 'item', 6],
  [/menor\s+pre[çc]o\s+(?:global\s+)?por\s+(?:lote|grupo)/i, 'lote', 6],
  [/adjudica[çc][ãa]o\s+(?:ser[áa]\s+)?(?:feita\s+)?por\s+item/i, 'item', 5],
  [/adjudica[çc][ãa]o\s+(?:ser[áa]\s+)?(?:feita\s+)?(?:por\s+(?:lote|grupo)|global)/i, 'lote', 5],
  [/licita[çc][ãa]o\s+ser[áa]\s+dividida\s+em\s+itens/i, 'item', 4],
  [/licita[çc][ãa]o\s+ser[áa]\s+dividida\s+em\s+(?:lotes|grupos)/i, 'lote', 4],
  [/lance\s+dever[áa]\s+ser\s+ofertado\s+pelo\s+valor\s+(?:unit[áa]rio\s+)?do\s+item/i, 'item', 3],
  [/lance\s+dever[áa]\s+ser\s+ofertado\s+pelo\s+valor\s+(?:total|global)\s+do\s+(?:lote|grupo)/i, 'lote', 3],
];

function trechoAo(texto, indice, tamanho) {
  return texto.slice(indice, indice + tamanho).replace(/\s+/g, ' ').trim();
}

// documentos: [{ papel: 'edital'|'tr'|..., nome_arquivo, paginas: [{ pagina, texto }] }]
export function detectarJulgamento(documentos) {
  const achados = [];
  for (const doc of documentos) {
    if (!['edital', 'tr'].includes(doc.papel)) continue;
    for (const p of doc.paginas || []) {
      const texto = String(p.texto || '');
      for (const [re, modo, peso] of SINAIS) {
        const m = re.exec(texto);
        if (m) {
          achados.push({ modo, peso: peso + (doc.papel === 'edital' ? 1 : 0), documento: doc.papel, arquivo: doc.nome_arquivo, pagina: p.pagina, trecho: trechoAo(texto, m.index, m[0].length) });
        }
      }
    }
  }
  if (!achados.length) return { modo: null, evidencias: [], conflito: null };
  const pontos = { item: 0, lote: 0 };
  for (const a of achados) pontos[a.modo] += a.peso;
  // Decisão: o sinal mais forte do edital; sem edital, o mais forte do TR.
  const ordenados = [...achados].sort((a, b) => (b.documento === 'edital') - (a.documento === 'edital') || b.peso - a.peso)
    // tira provas repetidas (o mesmo trecho achado por duas expressões na mesma página)
    .filter((a, i, lista) => !lista.slice(0, i).some((b) => b.documento === a.documento && b.pagina === a.pagina && b.trecho.includes(a.trecho)));
  const principal = ordenados[0];
  const contrario = achados.find((a) => a.modo !== principal.modo && a.peso >= 5);
  return {
    modo: principal.modo,
    evidencias: ordenados.slice(0, 3),
    conflito: contrario ? { a_favor: principal, contra: contrario } : null,
    pontos,
  };
}
