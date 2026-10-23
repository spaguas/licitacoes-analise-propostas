-- Monitor de segurança (estilo Wordfence): eventos de acesso/ataque e IPs bloqueados.
CREATE TABLE IF NOT EXISTS eventos_seguranca (
  id UUID PRIMARY KEY,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  tipo TEXT NOT NULL,          -- login_ok, login_falhou, forca_bruta, injecao, varredura, acesso_indevido, acesso_negado, limite_excedido, ip_bloqueado, auditoria
  gravidade TEXT NOT NULL,     -- info | baixa | media | alta
  ip TEXT, email TEXT, usuario_id UUID, metodo TEXT, caminho TEXT, detalhe TEXT, navegador TEXT
);
CREATE INDEX IF NOT EXISTS idx_eventos_seg_data ON eventos_seguranca (criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_eventos_seg_ip ON eventos_seguranca (ip);
CREATE TABLE IF NOT EXISTS bloqueios_ip (
  id UUID PRIMARY KEY,
  ip TEXT NOT NULL, motivo TEXT, ate TIMESTAMPTZ NOT NULL, automatico BOOLEAN NOT NULL DEFAULT true,
  criado_por UUID, ativo BOOLEAN NOT NULL DEFAULT true, criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bloqueios_ip ON bloqueios_ip (ip, ativo);
