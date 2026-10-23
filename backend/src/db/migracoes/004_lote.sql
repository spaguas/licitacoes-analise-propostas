-- Julgamento por lote: o fornecedor que disputa um lote precisa ofertar TODOS os itens dele.
-- NULL = detectar pelo critério de julgamento lido do edital ("lote", "grupo", "global").
ALTER TABLE pregoes ADD COLUMN IF NOT EXISTS julgamento_por_lote BOOLEAN;
