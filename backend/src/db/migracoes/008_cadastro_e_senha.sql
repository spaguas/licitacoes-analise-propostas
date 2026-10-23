-- Autocadastro (aguarda aprovação do administrador) e pedidos de "esqueci a senha".
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS aprovacao TEXT NOT NULL DEFAULT 'aprovado'; -- aprovado | pendente | recusado
CREATE TABLE IF NOT EXISTS pedidos_senha (
  id UUID PRIMARY KEY, usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  atendido BOOLEAN NOT NULL DEFAULT false, criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pedidos_senha_abertos ON pedidos_senha (atendido);
