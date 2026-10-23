// Repositório com a MESMA interface para PostgreSQL (uso real) e memória (testes e demonstração).
// Operações: inserir, atualizar, obter, buscar (filtro por igualdade), remover, upsert.
import { randomUUID } from 'node:crypto';

// Colunas JSONB: o valor é sempre gravado como JSON (inclusive números e textos soltos).
const COLUNAS_JSON = new Set(['valor', 'opcoes', 'origem', 'codigos_catalogo', 'valores', 'referencias_externas', 'json_bruto',
  'alternativas', 'evidencia', 'aliases', 'dados', 'payload', 'analise', 'embedding', 'fonte', 'progresso', 'julgamento_fonte']);

const agora = () => new Date().toISOString();

// ------------------------------------------------------------------ memória
export function criarRepositorioMemoria() {
  const tabelas = new Map();
  const tab = (t) => { if (!tabelas.has(t)) tabelas.set(t, new Map()); return tabelas.get(t); };
  const copia = (o) => (o ? structuredClone(o) : o);
  const casa = (linha, filtro) => Object.entries(filtro).every(([k, v]) => (v === null ? linha[k] == null : linha[k] === v));
  return {
    tipo: 'memoria',
    async inserir(t, linha) { const l = { id: randomUUID(), criado_em: agora(), ...linha }; tab(t).set(l.id, l); return copia(l); },
    async atualizar(t, id, patch) { const l = tab(t).get(id); if (!l) return null; Object.assign(l, patch); return copia(l); },
    async obter(t, id) { return copia(tab(t).get(id) || null); },
    async buscar(t, filtro = {}, { ordem = 'criado_em' } = {}) {
      return [...tab(t).values()].filter((l) => casa(l, filtro)).sort((a, b) => String(a[ordem]).localeCompare(String(b[ordem]))).map(copia);
    },
    async remover(t, filtro) { for (const [id, l] of tab(t)) if (casa(l, filtro)) tab(t).delete(id); },
    async upsert(t, chaves, linha) {
      const existente = [...tab(t).values()].find((l) => chaves.every((k) => l[k] === linha[k]));
      if (existente) { Object.assign(existente, linha); return copia(existente); }
      return this.inserir(t, linha);
    },
    async fechar() {},
  };
}

// ------------------------------------------------------------------ PostgreSQL
export async function criarRepositorioPg(databaseUrl) {
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 10 });
  const ident = (n) => { if (!/^[a-z_][a-z0-9_]*$/.test(n)) throw new Error(`nome inválido: ${n}`); return `"${n}"`; };
  const valorSql = (col, v) => (COLUNAS_JSON.has(col) && v !== null && v !== undefined ? JSON.stringify(v) : v);
  const where = (filtro, inicio = 1) => {
    const partes = []; const vals = [];
    for (const [k, v] of Object.entries(filtro)) {
      if (v === null) partes.push(`${ident(k)} IS NULL`);
      else { vals.push(v); partes.push(`${ident(k)} = $${inicio + vals.length - 1}`); }
    }
    return { sql: partes.length ? `WHERE ${partes.join(' AND ')}` : '', vals };
  };
  return {
    tipo: 'postgres',
    pool,
    async inserir(t, linha) {
      const l = { id: randomUUID(), ...linha };
      const cols = Object.keys(l);
      const r = await pool.query(`INSERT INTO ${ident(t)} (${cols.map(ident).join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`,
        cols.map((c) => valorSql(c, l[c])));
      return r.rows[0];
    },
    async atualizar(t, id, patch) {
      const cols = Object.keys(patch);
      if (!cols.length) return this.obter(t, id);
      const r = await pool.query(`UPDATE ${ident(t)} SET ${cols.map((c, i) => `${ident(c)} = $${i + 1}`).join(',')} WHERE id = $${cols.length + 1} RETURNING *`,
        [...cols.map((c) => valorSql(c, patch[c])), id]);
      return r.rows[0] || null;
    },
    async obter(t, id) { return (await pool.query(`SELECT * FROM ${ident(t)} WHERE id = $1`, [id])).rows[0] || null; },
    async buscar(t, filtro = {}, { ordem = 'criado_em' } = {}) {
      const w = where(filtro);
      return (await pool.query(`SELECT * FROM ${ident(t)} ${w.sql} ORDER BY ${ident(ordem)}`, w.vals)).rows;
    },
    async remover(t, filtro) { const w = where(filtro); await pool.query(`DELETE FROM ${ident(t)} ${w.sql}`, w.vals); },
    async upsert(t, chaves, linha) {
      const l = { id: randomUUID(), ...linha };
      const cols = Object.keys(l);
      const atualiza = cols.filter((c) => c !== 'id' && !chaves.includes(c));
      const r = await pool.query(
        `INSERT INTO ${ident(t)} (${cols.map(ident).join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')})
         ON CONFLICT (${chaves.map(ident).join(',')}) DO UPDATE SET ${atualiza.map((c) => `${ident(c)} = EXCLUDED.${ident(c)}`).join(',')} RETURNING *`,
        cols.map((c) => valorSql(c, l[c])));
      return r.rows[0];
    },
    async fechar() { await pool.end(); },
  };
}

export async function criarRepositorio(databaseUrl) {
  if (!databaseUrl) {
    console.warn('[banco] DATABASE_URL vazio: usando banco em MEMÓRIA (os dados somem ao reiniciar).');
    return criarRepositorioMemoria();
  }
  return criarRepositorioPg(databaseUrl);
}
