// Validações das respostas das IAs. Cada função devolve a lista de erros (vazia = aprovado).
// Elas implementam as regras anti-invenção: trecho literal conferido no documento e cobertura do esqueleto.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { normalizar, localizarTrecho } from '../nucleo/texto.js';
import { normalizarOperador } from '../nucleo/normalizacao.js';

const TIPOS = ['numerico', 'faixa', 'booleano', 'opcao', 'norma', 'condicional', 'texto_livre', 'verificacao_externa', 'campos_proposta'];
const STATUS_IA = ['ATENDE', 'NÃO ATENDE', 'NÃO COMPROVADO', 'VAGO'];

export function carregarPrompt(nome) {
  const texto = readFileSync(new URL(`./prompts/${nome}.md`, import.meta.url), 'utf8');
  const versao = `${nome}@${createHash('sha1').update(texto).digest('hex').slice(0, 8)}`;
  return { texto, versao };
}

const numero = (v) => (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v.replace(',', '.'))) ? Number(v.replace(',', '.')) : v);

function checarRequisito(r, ondeProcurar, i) {
  const erros = [];
  const p = `requisito ${i + 1}`;
  // Padroniza variações comuns antes de conferir: "≥", "mínimo" -> ">="; "36" (texto) -> 36.
  if ('operador' in r) { const op = normalizarOperador(r.operador); if (op !== undefined) r.operador = op; }
  if (r.tipo === 'numerico') r.valor = numero(r.valor);
  r.valor_min = numero(r.valor_min); r.valor_max = numero(r.valor_max);
  if (!TIPOS.includes(r.tipo)) erros.push(`${p}: tipo inválido "${r.tipo}"`);
  if (!r.atributo || !/^[a-z0-9_]+$/.test(r.atributo)) erros.push(`${p}: atributo deve ser snake_case sem acento`);
  if (!r.trecho) erros.push(`${p}: falta o trecho literal`);
  else if (!ondeProcurar(r.trecho)) erros.push(`${p}: trecho "${String(r.trecho).slice(0, 60)}" não existe no documento`);
  if (r.tipo === 'numerico' && (typeof r.valor !== 'number' || !['>=', '<=', '=', '>', '<'].includes(r.operador))) erros.push(`${p}: numérico precisa de valor numérico e operador (>=, <=, =, >, <)`);
  if (r.tipo === 'faixa' && (typeof r.valor_min !== 'number' || typeof r.valor_max !== 'number')) erros.push(`${p}: faixa precisa de valor_min e valor_max`);
  if (r.tipo === 'opcao' && !(Array.isArray(r.opcoes) && r.opcoes.length)) erros.push(`${p}: opção precisa da lista de opções`);
  return erros;
}

// E3: linhas do esqueleto -> requisitos. Exige cobertura de todas as linhas e trecho dentro da própria linha.
export function validarE3(json, linhas) {
  if (!Array.isArray(json?.requisitos)) return ['falta a lista "requisitos"'];
  const porId = new Map(linhas.map((l) => [l.id, l]));
  const erros = [];
  json.requisitos.forEach((r, i) => {
    const linha = porId.get(r.linha_id);
    if (!linha) { erros.push(`requisito ${i + 1}: linha_id "${r.linha_id}" não pertence a este lote`); return; }
    erros.push(...checarRequisito(r, (t) => normalizar(linha.texto).includes(normalizar(t)), i));
  });
  const cobertas = new Set(json.requisitos.map((r) => r.linha_id));
  const faltando = linhas.filter((l) => !cobertas.has(l.id)).map((l) => l.id);
  if (faltando.length) erros.push(`linhas sem requisito: ${faltando.join(', ')}`);
  return erros;
}

// E3b: capítulo de texto corrido -> requisitos gerais ou de habilitação.
export function validarE3b(json, texto) {
  if (!Array.isArray(json?.requisitos)) return ['falta a lista "requisitos"'];
  const alvo = normalizar(texto);
  return json.requisitos.flatMap((r, i) => checarRequisito(r, (t) => alvo.includes(normalizar(t)), i));
}

// E4: proposta -> especificações. O trecho precisa existir no texto das páginas OU nas células das tabelas.
export function validarE4(json, fontes) {
  if (!Array.isArray(json?.itens)) return ['falta a lista "itens"'];
  const erros = [];
  json.itens.forEach((item, ii) => {
    if (!item.item) erros.push(`item ${ii + 1}: falta o número do item`);
    (item.especificacoes || []).forEach((e, i) => {
      if (!e.trecho) erros.push(`item ${item.item}, especificação ${i + 1}: falta o trecho`);
      else if (!localizarTrecho(e.trecho, fontes)) erros.push(`item ${item.item}, especificação ${i + 1}: trecho "${String(e.trecho).slice(0, 60)}" não existe na proposta`);
    });
  });
  return erros;
}

export function validarE5(json, idsRequisitos, idsEspecificacoes) {
  if (!Array.isArray(json?.pares)) return ['falta a lista "pares"'];
  const erros = [];
  for (const p of json.pares) {
    if (!idsRequisitos.has(p.requisito_id)) erros.push(`requisito desconhecido: ${p.requisito_id}`);
    if (p.especificacao_id != null && !idsEspecificacoes.has(p.especificacao_id)) erros.push(`especificação desconhecida: ${p.especificacao_id}`);
  }
  const respondidos = new Set(json.pares.map((p) => p.requisito_id));
  const faltam = [...idsRequisitos].filter((id) => !respondidos.has(id));
  if (faltam.length) erros.push(`requisitos sem resposta: ${faltam.join(', ')}`);
  return erros;
}

export function validarE6(json, ids) {
  if (!Array.isArray(json?.avaliacoes)) return ['falta a lista "avaliacoes"'];
  const erros = json.avaliacoes.flatMap((a) => {
    const e = [];
    if (!ids.has(a.requisito_id)) e.push(`requisito desconhecido: ${a.requisito_id}`);
    if (!STATUS_IA.includes(a.status)) e.push(`status inválido para ${a.requisito_id}: ${a.status}`);
    if (!a.justificativa) e.push(`falta justificativa para ${a.requisito_id}`);
    return e;
  });
  const faltam = [...ids].filter((id) => !json.avaliacoes.some((a) => a.requisito_id === id));
  if (faltam.length) erros.push(`requisitos sem avaliação: ${faltam.join(', ')}`);
  return erros;
}
