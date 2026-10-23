-- Perfis de acesso: 'admin' (vê tudo, gerencia usuários e IAs) e 'licitante' (só os próprios pregões).
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS ativo BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS trocar_senha BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS ultimo_acesso TIMESTAMPTZ;
UPDATE usuarios SET perfil = 'licitante' WHERE perfil NOT IN ('admin', 'licitante');
ALTER TABLE usuarios ALTER COLUMN perfil SET DEFAULT 'licitante';
CREATE INDEX IF NOT EXISTS idx_pregoes_criado_por ON pregoes (criado_por);
CREATE INDEX IF NOT EXISTS idx_sessoes_usuario ON sessoes (usuario_id);
