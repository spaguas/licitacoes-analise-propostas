// Aplica, em ordem, os arquivos .sql da pasta migracoes que ainda não foram aplicados.
// Uso: npm run migrar  (também roda automaticamente quando a API sobe com PostgreSQL)
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';

export async function migrar(pool) {
  await pool.query('CREATE TABLE IF NOT EXISTS schema_migracoes (nome TEXT PRIMARY KEY, aplicada_em TIMESTAMPTZ NOT NULL DEFAULT now())');
  const pasta = new URL('./migracoes/', import.meta.url);
  const aplicadas = new Set((await pool.query('SELECT nome FROM schema_migracoes')).rows.map((r) => r.nome));
  for (const arquivo of readdirSync(pasta).filter((f) => f.endsWith('.sql')).sort()) {
    if (aplicadas.has(arquivo)) continue;
    const sql = readFileSync(new URL(arquivo, pasta), 'utf8');
    const cliente = await pool.connect();
    try {
      await cliente.query('BEGIN');
      await cliente.query(sql);
      await cliente.query('INSERT INTO schema_migracoes (nome) VALUES ($1)', [arquivo]);
      await cliente.query('COMMIT');
      console.log(`[banco] migração aplicada: ${arquivo}`);
    } catch (erro) {
      await cliente.query('ROLLBACK');
      throw erro;
    } finally {
      cliente.release();
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString: config.databaseUrl });
  await migrar(pool);
  await pool.end();
}
