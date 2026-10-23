// Utilidades de texto usadas na validação anti-invenção e no de-para.

// Mesma normalização do pdf-worker: sem acento, maiúsculas, aspas retas e espaços simples.
export function normalizar(texto) {
  return String(texto ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

// O trecho citado pela IA existe no documento? Procura nas páginas e nas células das tabelas,
// porque em tabelas de duas colunas o texto corrido da página mistura as colunas.
export function localizarTrecho(trecho, fontes) {
  const alvo = normalizar(trecho);
  if (!alvo) return null;
  for (const f of fontes) {
    if (normalizar(f.texto).includes(alvo)) return { pagina: f.pagina, fonte: f.tipo || 'pagina' };
  }
  return null;
}

// Vetor de n-gramas de caracteres (3 a 5), usado quando o modelo de embeddings não está disponível.
export function vetorNgramas(texto) {
  const t = ` ${normalizar(texto).toLowerCase()} `;
  const v = new Map();
  for (let n = 3; n <= 5; n += 1) {
    for (let i = 0; i + n <= t.length; i += 1) {
      const g = t.slice(i, i + n);
      v.set(g, (v.get(g) || 0) + 1);
    }
  }
  return v;
}

export function cosseno(a, b) {
  if (a instanceof Map) {
    let prod = 0; let na = 0; let nb = 0;
    for (const [k, x] of a) { na += x * x; if (b.has(k)) prod += x * b.get(k); }
    for (const x of b.values()) nb += x * x;
    return na && nb ? prod / Math.sqrt(na * nb) : 0;
  }
  let prod = 0; let na = 0; let nb = 0;
  for (let i = 0; i < a.length; i += 1) { prod += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? prod / Math.sqrt(na * nb) : 0;
}
