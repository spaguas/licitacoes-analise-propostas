// Mascaramento LGPD (mesmas regras do pdf-worker), usado antes de qualquer envio de trecho de proposta à nuvem.
// O CNPJ (dado da empresa) é mantido. As regras não dependem de borda de palavra porque o texto real
// traz formatos colados como "CPFnº123.456.789-00".
const PADROES = {
  CPF: /(?<!\d)\d{3}\.\d{3}\.\d{3}-\d{2}(?!\d)/g,
  RG: /(?<![\d/])\d{2}\.\d{3}\.\d{3}-[\dXx](?![\d/])/g,
  TELEFONE: /\(\d{2}\)\s?9?\d{4}-?\d{4}/g,
  EMAIL: /[\w.+-]+@[\w-]+\.[\w.]+/g,
  DADOS_BANCARIOS: /(?:[Aa]g[eê]ncia|[Aa]g\.)\s*:?\s*[\d-]+|\b(?:CC|C\/C|[Cc]onta\s*n?[ºª°]?)\s*:?\s*[\d.-]+/g,
};

export function mascarar(texto) {
  let t = String(texto ?? '');
  for (const [nome, re] of Object.entries(PADROES)) t = t.replace(re, `[${nome}]`);
  return t;
}
