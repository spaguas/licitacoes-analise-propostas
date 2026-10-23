-- Estrutura inicial do sistema de comparação de propostas.
-- Colunas JSONB guardam o conteúdo completo extraído pela IA; as colunas comuns são as usadas em filtros.

CREATE TABLE IF NOT EXISTS usuarios (
  id UUID PRIMARY KEY, email TEXT UNIQUE NOT NULL, nome TEXT NOT NULL, senha_hash TEXT NOT NULL,
  perfil TEXT NOT NULL DEFAULT 'analista', criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessoes (
  id UUID PRIMARY KEY, token TEXT UNIQUE NOT NULL, usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  expira_em TIMESTAMPTZ NOT NULL, criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS pregoes (
  id UUID PRIMARY KEY, nome TEXT NOT NULL, numero TEXT, processo TEXT, orgao TEXT, uasg TEXT, criterio TEXT,
  valor_total NUMERIC(16,2), validade_minima_dias INT, status TEXT NOT NULL DEFAULT 'rascunho',
  criado_por UUID REFERENCES usuarios(id), criado_em TIMESTAMPTZ NOT NULL DEFAULT now(), atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS documentos (
  id UUID PRIMARY KEY, pregao_id UUID NOT NULL REFERENCES pregoes(id) ON DELETE CASCADE, papel TEXT NOT NULL,
  publico BOOLEAN NOT NULL, nome_arquivo TEXT NOT NULL, hash TEXT NOT NULL, caminho TEXT NOT NULL, paginas INT,
  analise JSONB, status TEXT NOT NULL DEFAULT 'recebido', criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS partes_documento (
  id UUID PRIMARY KEY, documento_id UUID NOT NULL REFERENCES documentos(id) ON DELETE CASCADE, pregao_id UUID NOT NULL,
  titulo TEXT, nome TEXT, tipo TEXT, pagina_inicio INT, gera_requisitos BOOLEAN, criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS itens (
  id UUID PRIMARY KEY, pregao_id UUID NOT NULL REFERENCES pregoes(id) ON DELETE CASCADE, numero TEXT NOT NULL, lote TEXT,
  descricao TEXT, unidade TEXT, quantidade INT, valor_unitario_estimado NUMERIC(16,2), codigos_catalogo JSONB, fonte JSONB,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE (pregao_id, numero)
);
CREATE TABLE IF NOT EXISTS conflitos (
  id UUID PRIMARY KEY, pregao_id UUID NOT NULL REFERENCES pregoes(id) ON DELETE CASCADE, campo TEXT NOT NULL,
  valores JSONB NOT NULL, resolvido BOOLEAN NOT NULL DEFAULT false, criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS linhas_esqueleto (
  id UUID PRIMARY KEY, pregao_id UUID NOT NULL REFERENCES pregoes(id) ON DELETE CASCADE, codigo TEXT NOT NULL,
  item_numero TEXT, secao TEXT, nivel INT, texto TEXT NOT NULL, pagina INT, pai TEXT, so_agrupa BOOLEAN,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE (pregao_id, codigo)
);
CREATE TABLE IF NOT EXISTS requisitos (
  id UUID PRIMARY KEY, pregao_id UUID NOT NULL REFERENCES pregoes(id) ON DELETE CASCADE, item_numero TEXT,
  codigo TEXT NOT NULL, linha_codigo TEXT, categoria TEXT NOT NULL DEFAULT 'TECNICO', secao TEXT, atributo TEXT NOT NULL,
  tipo TEXT NOT NULL, operador TEXT, valor JSONB, valor_min NUMERIC, valor_max NUMERIC, unidade TEXT, opcoes JSONB,
  condicao TEXT, obrigatorio BOOLEAN NOT NULL DEFAULT true, conflito TEXT, origem JSONB NOT NULL,
  status_validacao TEXT NOT NULL DEFAULT 'pendente', extraido_por TEXT, criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS fornecedores (
  id UUID PRIMARY KEY, cnpj TEXT UNIQUE NOT NULL, razao_social TEXT, criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS propostas (
  id UUID PRIMARY KEY, pregao_id UUID NOT NULL REFERENCES pregoes(id) ON DELETE CASCADE, fornecedor_id UUID NOT NULL REFERENCES fornecedores(id),
  documento_id UUID REFERENCES documentos(id), validade_dias INT, prazo_entrega_dias INT, garantia_meses INT,
  referencias_externas JSONB, status TEXT NOT NULL DEFAULT 'recebida', json_bruto JSONB, extraido_por TEXT,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS itens_proposta (
  id UUID PRIMARY KEY, proposta_id UUID NOT NULL REFERENCES propostas(id) ON DELETE CASCADE, pregao_id UUID NOT NULL,
  item_numero TEXT NOT NULL, marca TEXT, fabricante TEXT, modelo TEXT, quantidade INT, valor_unitario NUMERIC(16,2),
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS especificacoes (
  id UUID PRIMARY KEY, item_proposta_id UUID NOT NULL REFERENCES itens_proposta(id) ON DELETE CASCADE, codigo TEXT NOT NULL,
  secao_declarada TEXT, atributo_declarado TEXT, valor JSONB, unidade TEXT, vago BOOLEAN DEFAULT false, alternativas JSONB,
  contradiz TEXT, negado BOOLEAN DEFAULT false, identificador_modelo BOOLEAN DEFAULT false, origem JSONB NOT NULL,
  embedding JSONB, criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS depara (
  id UUID PRIMARY KEY, pregao_id UUID NOT NULL, requisito_id UUID NOT NULL REFERENCES requisitos(id) ON DELETE CASCADE,
  item_proposta_id UUID NOT NULL REFERENCES itens_proposta(id) ON DELETE CASCADE, especificacao_id UUID REFERENCES especificacoes(id) ON DELETE SET NULL,
  secao_casada TEXT, confianca NUMERIC, metodo TEXT, validado_por UUID, criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (requisito_id, item_proposta_id)
);
CREATE TABLE IF NOT EXISTS avaliacoes (
  id UUID PRIMARY KEY, pregao_id UUID NOT NULL, requisito_id UUID NOT NULL REFERENCES requisitos(id) ON DELETE CASCADE,
  item_proposta_id UUID NOT NULL REFERENCES itens_proposta(id) ON DELETE CASCADE, status TEXT NOT NULL, justificativa TEXT,
  metodo TEXT, aliases JSONB, concordancia_ias BOOLEAN, evidencia JSONB, revisao_status TEXT NOT NULL DEFAULT 'pendente',
  revisao_parecer TEXT, revisao_usuario UUID, revisao_em TIMESTAMPTZ, criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (requisito_id, item_proposta_id)
);
CREATE TABLE IF NOT EXISTS exemplos_treino (
  id UUID PRIMARY KEY, pregao_id UUID, dados JSONB NOT NULL, criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS execucoes_ia (
  id UUID PRIMARY KEY, pregao_id UUID, tarefa TEXT, alias TEXT, modelo TEXT, tokens INT, latencia_ms INT,
  status TEXT, erro TEXT, criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS tarefas (
  id UUID PRIMARY KEY, pregao_id UUID NOT NULL REFERENCES pregoes(id) ON DELETE CASCADE, tipo TEXT NOT NULL, chave TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pendente', tentativas INT NOT NULL DEFAULT 0, erro TEXT, payload JSONB,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now(), atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_requisitos_pregao ON requisitos (pregao_id, item_numero);
CREATE INDEX IF NOT EXISTS idx_avaliacoes_pregao ON avaliacoes (pregao_id);
CREATE INDEX IF NOT EXISTS idx_tarefas_status ON tarefas (status);
