-- Critério de julgamento encontrado nos documentos: {"modo": "item"|"lote"|null, "evidencias": [...], "conflito": ...}
ALTER TABLE pregoes ADD COLUMN IF NOT EXISTS julgamento_fonte JSONB;
