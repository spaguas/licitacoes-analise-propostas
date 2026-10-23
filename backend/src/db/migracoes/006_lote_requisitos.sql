-- Lote de cada requisito e de cada linha do esqueleto (TR organizado por lote/grupo).
-- requisito com item_numero vazio e lote preenchido = requisito comum a todos os itens do lote.
ALTER TABLE requisitos ADD COLUMN IF NOT EXISTS lote TEXT;
ALTER TABLE linhas_esqueleto ADD COLUMN IF NOT EXISTS lote TEXT;
