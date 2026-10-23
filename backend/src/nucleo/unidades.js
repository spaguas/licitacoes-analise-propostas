// Conversão de unidades sem biblioteca externa.
// Cada unidade pertence a uma "grandeza" e tem um fator para a unidade-base da grandeza.
// Unidades de grandezas diferentes nunca são comparadas (ex.: GB × MB/s).

const TABELA = {
  dados: { B: 1e-9, KB: 1e-6, MB: 1e-3, GB: 1, TB: 1e3, PB: 1e6 },
  taxa_dados: { 'MB/S': 1, 'GB/S': 1e3, 'KB/S': 1e-3 },
  taxa_rede: { MBPS: 1e-3, GBPS: 1, KBPS: 1e-6 },
  frequencia: { HZ: 1, KHZ: 1e3, MHZ: 1e6, GHZ: 1e9 },
  transferencias: { 'MT/S': 1, 'GT/S': 1e3 },
  potencia: { W: 1, KW: 1e3 },
  tensao: { V: 1, VAC: 1, VCA: 1, KV: 1e3 },
  tempo: { H: 1 / 24, HORA: 1 / 24, DIA: 1, SEMANA: 7, MES: 30, ANO: 365 },
  comprimento: { MM: 0.1, CM: 1, M: 100, POL: 2.54 },
  massa: { G: 1e-3, KG: 1 },
  gramatura: { 'G/M2': 1 },
  percentual: { '%': 1 },
  contagem: { UN: 1 },
  pontos: { PONTOS: 1 },
};

// Sinônimos em português e grafias comuns em editais e propostas.
const SINONIMOS = {
  BYTES: 'B', GIGABYTES: 'GB', TERABYTES: 'TB', MEGABYTES: 'MB',
  WATTS: 'W', WATT: 'W', VOLTS: 'V', HERTZ: 'HZ',
  HORAS: 'H', DIAS: 'DIA', MESES: 'MES', MÊS: 'MES', ANOS: 'ANO', SEMANAS: 'SEMANA',
  'DIAS CORRIDOS': 'DIA', 'DIAS UTEIS': 'DIA',
  POLEGADA: 'POL', POLEGADAS: 'POL', '"': 'POL', "''": 'POL',
  'G/M²': 'G/M2', 'GRAMAS/M2': 'G/M2',
  UNIDADE: 'UN', UNIDADES: 'UN', UND: 'UN', PORTAS: 'UN', PORTA: 'UN', SLOTS: 'UN', SLOT: 'UN',
  NUCLEOS: 'UN', THREADS: 'UN', PONTO: 'PONTOS',
};

function normalizarUnidade(u) {
  if (u == null) return null;
  const t = String(u).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase();
  return SINONIMOS[t] || t;
}

export function grandezaDe(unidade) {
  const u = normalizarUnidade(unidade);
  if (!u) return null;
  for (const [grandeza, unidades] of Object.entries(TABELA)) if (u in unidades) return grandeza;
  return null;
}

// Converte "valor de" para "para". Devolve null se as unidades forem de grandezas diferentes
// ou desconhecidas — nesse caso quem chama decide (normalmente NÃO COMPROVADO ou IA).
export function converter(valor, de, para) {
  const ud = normalizarUnidade(de);
  const up = normalizarUnidade(para);
  const g = grandezaDe(ud);
  if (!g || g !== grandezaDe(up)) return null;
  return (Number(valor) * TABELA[g][ud]) / TABELA[g][up];
}

// Procura um número com unidade dentro de um texto livre ("SSD 1TB", "-650W", "32GB OU 2X16GB").
export function extrairQuantidade(texto) {
  if (texto == null) return null;
  const m = String(texto).match(/(\d+(?:[.,]\d+)?)\s*(TB|GB|MB\/s|GB\/s|MB|W|kW|GHz|MHz|Hz|MT\/s|V|kg|g\/m2|g\/m²|mm|cm|pol|"|%)(?![a-z])/i);
  if (!m) return null;
  return { valor: Number(m[1].replace(',', '.')), unidade: m[2] };
}
