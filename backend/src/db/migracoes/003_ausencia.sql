-- Critério do pregão: informação ausente na proposta conta como NÃO ATENDE (modo rigoroso)?
-- NULL = usa o padrão do .env (AUSENCIA_COMO_NAO_ATENDE).
ALTER TABLE pregoes ADD COLUMN IF NOT EXISTS ausencia_reprova BOOLEAN;
-- Marca as linhas do checklist em que a informação simplesmente não estava na proposta.
ALTER TABLE avaliacoes ADD COLUMN IF NOT EXISTS faltante BOOLEAN NOT NULL DEFAULT false;
