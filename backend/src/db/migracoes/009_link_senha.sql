-- Links de "criar nova senha" enviados por e-mail: só o hash do código fica no banco; uso único; expiram.
CREATE TABLE IF NOT EXISTS tokens_senha (
  id UUID PRIMARY KEY, usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE, expira_em TIMESTAMPTZ NOT NULL, usado BOOLEAN NOT NULL DEFAULT false,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
