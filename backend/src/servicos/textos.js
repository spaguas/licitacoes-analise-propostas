// Textos formais gerados a partir dos resultados da análise (sem IA: nada é inventado).
//  - recusa:     exigências obrigatórias NÃO ATENDIDAS, com exigido × ofertado × motivo e fundamentação legal
//  - diligencia: pontos faltantes, vagos ou a revisar, pedindo comprovação ao licitante
// O texto é uma SUGESTÃO para o(a) agente de contratação/pregoeiro(a), que decide e assina.

const PENDENTES = ['NÃO COMPROVADO', 'VAGO', 'REVISAR', 'PARCIAL', 'VERIFICAR EXTERNAMENTE'];

const dataExtenso = (d = new Date()) => d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
const moeda = (v) => (v == null || v === '' ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
const cnpjFormatado = (c) => {
  const d = String(c ?? '').replace(/\W/g, '');
  return d.length === 14 ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}` : (c || '—');
};
const origem = (l) => `${l.fonte?.sigla || 'Edital/TR'}${l.pagina_edital ? `, p. ${l.pagina_edital}` : ''}`;
const limpar = (t) => String(t ?? '').replace(/\s+/g, ' ').trim();

// Motivo em linguagem de documento: só a explicação principal (sem "ia-forte: … | ia-media: …")
// e operadores por extenso ("não atende >= 36 meses" -> "não atende ao mínimo de 36 meses").
function motivoFormal(justificativa) {
  let t = limpar(justificativa);
  const m = t.match(/^ia-forte:\s*(.*?)\s*\|\s*ia-media:/);
  if (m) t = m[1];
  t = t.replace(/^Faltante na proposta:\s*/i, 'Informação ausente na proposta: ')
    .replace(/(n[ãa]o )?atende >= /g, (_, nao) => `${nao || ''}atende ao mínimo de `)
    .replace(/(n[ãa]o )?atende <= /g, (_, nao) => `${nao || ''}atende ao máximo de `)
    .replace(/(n[ãa]o )?atende = /g, (_, nao) => `${nao || ''}atende ao valor exigido de `)
    .replace(/(n[ãa]o )?atende > /g, (_, nao) => `${nao || ''}atende ao exigido (acima de `)
    .replace(/(n[ãa]o )?atende < /g, (_, nao) => `${nao || ''}atende ao exigido (abaixo de `);
  if (/\((acima|abaixo) de [^)]*$/.test(t)) t = t.replace(/\.?$/, ').');
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function cabecalho({ pregao, fornecedor, itens }) {
  const linhas = [
    `Pregão Eletrônico nº ${pregao.numero || '—'}${pregao.processo ? ` · Processo nº ${pregao.processo}` : ''}`,
    pregao.orgao ? `Órgão: ${pregao.orgao}` : null,
    `Licitante: ${fornecedor?.razao_social || '—'} · CNPJ ${cnpjFormatado(fornecedor?.cnpj)}`,
    ...itens.map((i) => `Item ${i.numero}${i.descricao ? ` – ${i.descricao}` : ''}: ofertado ${[i.marca, i.modelo].filter(Boolean).join(' / ') || 'marca/modelo não informados'}, ${i.quantidade ?? '—'} un., valor unitário ${moeda(i.valor_unitario)}.`),
  ];
  return linhas.filter(Boolean).join('\n');
}

function blocoLinha(l, n) {
  const ofertado = l.ofertado ? `"${limpar(l.ofertado)}"${l.pagina_proposta ? ` (proposta, p. ${l.pagina_proposta})` : ''}` : 'a proposta não apresenta essa informação';
  return [
    `${n}. [${l.requisito_codigo}] ${l.grupo_nome}${l.secao && !String(l.grupo_nome).includes(l.secao) ? ` — ${l.secao}` : ''}`,
    `   Exigido (${origem(l)}): "${limpar(l.exigido)}"`,
    `   Ofertado: ${ofertado}`,
    `   Motivo: ${motivoFormal(l.justificativa)}${l.revisao_status === 'corrigido' || l.revisao_status === 'confirmado' ? ' (resultado conferido pelo(a) pregoeiro(a))' : ''}`,
  ].join('\n');
}

export function montarTexto({ pregao, fornecedorVisao, itensOfertados, tipo = 'recusa', incluirPendencias = false, local = '' }) {
  const linhas = fornecedorVisao.linhas.filter((l) => l.status !== 'NÃO OFERTADO');
  const naoAtende = linhas.filter((l) => l.status === 'NÃO ATENDE' && l.obrigatorio !== false);
  const pendentes = linhas.filter((l) => PENDENTES.includes(l.status));
  const fornecedor = fornecedorVisao.fornecedor;
  const itensTexto = itensOfertados.map((i) => `${i.numero}`).join(', ') || '—';
  const cab = cabecalho({ pregao, fornecedor, itens: itensOfertados });

  if (tipo === 'diligencia') {
    const lista = pendentes.length ? pendentes : [];
    return {
      tipo, codigos: lista.map((l) => l.requisito_codigo),
      texto: [
        'SOLICITAÇÃO DE DILIGÊNCIA — COMPLEMENTAÇÃO DA PROPOSTA',
        '',
        cab,
        '',
        lista.length
          ? `Na análise da proposta em confronto com o Edital e o Termo de Referência, os pontos abaixo não puderam ser confirmados com as informações apresentadas. Solicita-se ao licitante que, no prazo fixado pelo(a) pregoeiro(a), apresente documentação que comprove o atendimento de cada um deles (por exemplo, catálogo, ficha técnica ou declaração do fabricante), sem alteração da substância da proposta:`
          : 'Na análise da proposta, não foram identificados pontos pendentes de comprovação.',
        '',
        ...lista.map((l, i) => blocoLinha(l, i + 1)).flatMap((b) => [b, '']),
        'A complementação deverá se limitar a esclarecer ou comprovar informações já existentes na data da apresentação da proposta.',
        '',
        `${local || '[Local]'}, ${dataExtenso()}.`,
        '',
        '_______________________________________',
        'Agente de contratação / Pregoeiro(a)',
        '',
        'Texto sugerido pelo sistema de análise de propostas, sujeito à conferência e decisão do(a) agente de contratação.',
      ].join('\n'),
    };
  }

  const conclusao = naoAtende.length
    ? `Diante do exposto, sugere-se a RECUSA (desclassificação) da proposta do licitante ${fornecedor?.razao_social || ''} para o(s) item(ns) ${itensTexto}, por não obedecer às especificações técnicas pormenorizadas no Edital e em seus Anexos, com fundamento no art. 59, inciso II, da Lei nº 14.133/2021, cabendo ao(à) agente de contratação/pregoeiro(a) a decisão final.`
    : 'Não foram identificadas exigências obrigatórias não atendidas que justifiquem a recusa da proposta. Recomenda-se, se for o caso, a solicitação de diligência para os pontos pendentes.';
  const textoPendencias = incluirPendencias && pendentes.length
    ? ['', `Além dos motivos acima, ${pendentes.length} ponto(s) não puderam ser confirmados com as informações da proposta (informação ausente, vaga ou a revisar):`, '',
      ...pendentes.map((l, i) => blocoLinha(l, i + 1)).flatMap((b) => [b, ''])]
    : [];
  return {
    tipo,
    codigos: [...naoAtende, ...(incluirPendencias ? pendentes : [])].map((l) => l.requisito_codigo),
    texto: [
      'ANÁLISE TÉCNICA DA PROPOSTA — MOTIVOS DA RECUSA',
      '',
      cab,
      '',
      naoAtende.length
        ? `Após a análise da proposta em confronto com as especificações técnicas do Termo de Referência e com as regras do Edital, verificou-se que ela não atende a ${naoAtende.length} exigência(s) obrigatória(s), detalhadas a seguir:`
        : 'Após a análise da proposta em confronto com as especificações técnicas do Termo de Referência e com as regras do Edital:',
      '',
      ...naoAtende.map((l, i) => blocoLinha(l, i + 1)).flatMap((b) => [b, '']),
      ...textoPendencias,
      conclusao,
      '',
      `${local || '[Local]'}, ${dataExtenso()}.`,
      '',
      '_______________________________________',
      'Agente de contratação / Pregoeiro(a)',
      '',
      'Texto sugerido pelo sistema de análise de propostas, sujeito à conferência e decisão do(a) agente de contratação.',
    ].join('\n'),
  };
}

// Versão para o Word: HTML simples salvo como .doc (o Word abre normalmente).
export function textoParaDoc(texto, titulo) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const corpo = texto.split('\n').map((l) => (l.trim() ? `<p>${esc(l).replace(/^ {3}/, '&nbsp;&nbsp;&nbsp;&nbsp;')}</p>` : '<p>&nbsp;</p>')).join('\n');
  return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><title>${esc(titulo)}</title>
<style>body{font-family:Arial,sans-serif;font-size:12pt;line-height:1.4} p{margin:0 0 4pt}</style></head><body>${corpo}</body></html>`;
}
