-- Acompanhamento do processamento (pop-up de progresso).
-- progresso: {"percentual": 0-100, "mensagem": "...", "em": "data/hora"} gravado pelas etapas.
ALTER TABLE tarefas ADD COLUMN IF NOT EXISTS progresso JSONB;
-- Início do lote de processamento atual do pregão: as tarefas criadas a partir daqui contam no percentual.
ALTER TABLE pregoes ADD COLUMN IF NOT EXISTS lote_inicio TIMESTAMPTZ;
