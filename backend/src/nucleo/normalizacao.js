// Normalização do que as IAs escrevem de jeitos diferentes (operadores e números de item).
import { cosseno, normalizar, vetorNgramas } from './texto.js';

const OPERADORES = {
  '>=': '>=', '=>': '>=', '≥': '>=', 'MIN': '>=', 'MINIMO': '>=', 'NO MINIMO': '>=', 'PELO MENOS': '>=', 'A PARTIR DE': '>=', 'OU SUPERIOR': '>=', 'OU MAIS': '>=',
  '<=': '<=', '=<': '<=', '≤': '<=', 'MAX': '<=', 'MAXIMO': '<=', 'NO MAXIMO': '<=', 'ATE': '<=', 'OU INFERIOR': '<=', 'OU MENOS': '<=',
  '=': '=', '==': '=', 'IGUAL': '=', 'IGUAL A': '=', 'EXATAMENTE': '=',
  '>': '>', 'MAIOR': '>', 'MAIOR QUE': '>', 'ACIMA DE': '>', 'SUPERIOR A': '>',
  '<': '<', 'MENOR': '<', 'MENOR QUE': '<', 'ABAIXO DE': '<', 'INFERIOR A': '<',
};

// Devolve '>=', '<=', '=', '>' ou '<'; null se vazio; undefined se não reconhecido.
export function normalizarOperador(op) {
  if (op === null || op === undefined || String(op).trim() === '') return null;
  const chave = normalizar(op).replace(/[^A-Z<>=≥≤ ]/g, '').trim();
  return OPERADORES[chave] ?? OPERADORES[String(op).trim()] ?? undefined;
}

// Número do item como o edital usa ('1', '2'...). Aceita '01', 'Item 01 - Desktop', 'item nº 2'.
// Sem número (a IA pôs a descrição), tenta achar o item do edital pela descrição; com um único item, usa ele.
export function normalizarNumeroItem(valor, itensDoPregao = []) {
  const s = String(valor ?? '').trim();
  const puro = s.match(/^0*(\d{1,3})$/);
  if (puro) return String(Number(puro[1]));
  const comPalavra = s.match(/\bitem\s*(?:n[º°o.]*\s*)?0*(\d{1,3})\b/i) || s.match(/^0*(\d{1,3})\s*[-–:.)]/);
  if (comPalavra) return String(Number(comPalavra[1]));
  if (itensDoPregao.length === 1) return String(itensDoPregao[0].numero);
  if (itensDoPregao.length > 1 && s) {
    const alvo = vetorNgramas(s);
    const notas = itensDoPregao.map((i) => ({ numero: String(i.numero), nota: cosseno(alvo, vetorNgramas(i.descricao || '')) }));
    notas.sort((a, b) => b.nota - a.nota);
    if (notas[0].nota >= 0.2 && notas[0].nota - (notas[1]?.nota ?? 0) >= 0.05) return notas[0].numero;
  }
  return s || null;
}
