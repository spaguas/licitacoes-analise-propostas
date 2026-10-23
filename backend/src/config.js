// Lê o arquivo .env (na raiz do projeto ou na pasta backend) sem biblioteca externa.
// Variáveis já definidas no ambiente (ex.: pelo Docker Compose) têm prioridade.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const aqui = path.dirname(fileURLToPath(import.meta.url));
for (const arquivo of [path.resolve(aqui, '../../.env'), path.resolve(aqui, '../.env')]) {
  if (!existsSync(arquivo)) continue;
  for (const linha of readFileSync(arquivo, 'utf8').split(/\r?\n/)) {
    const m = linha.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*(?:#.*)?$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

const txt = (nome, padrao) => process.env[nome] ?? padrao;
const num = (nome, padrao) => (process.env[nome] !== undefined ? Number(process.env[nome]) : padrao);
const lista = (nome, padrao) => txt(nome, padrao).split(',').map((s) => s.trim()).filter(Boolean);

export const config = {
  ambiente: txt('NODE_ENV', 'development'),
  porta: num('API_PORTA', 3001),
  segredo: txt('APP_SECRET_KEY', 'troque-esta-chave'),
  origens: lista('APP_ORIGENS_PERMITIDAS', 'http://localhost:5173'),
  adminEmail: txt('ADMIN_EMAIL', 'admin@spaguas.sp.gov.br'),
  // E-mail (opcional). Sem SMTP_HOST, "esqueci a senha" e cadastros passam só pelo administrador, dentro do sistema.
  smtp: {
    host: txt('SMTP_HOST', ''),
    porta: num('SMTP_PORTA', 587),
    seguro: txt('SMTP_SEGURO', 'false') === 'true',          // true = TLS direto (porta 465); false = STARTTLS
    usuario: txt('SMTP_USUARIO', ''),
    senha: txt('SMTP_SENHA', ''),
    remetente: txt('SMTP_REMETENTE', ''),
    nomeRemetente: txt('SMTP_NOME_REMETENTE', 'SP Águas – Análise de Propostas'),
    ignorarCertificado: txt('SMTP_IGNORAR_CERTIFICADO', 'false') === 'true',
  },
  emailAvisosAdmin: txt('EMAIL_AVISOS_ADMIN', ''),
  // Monitor de segurança (menu Segurança)
  seguranca: {
    bloqueioAutomatico: txt('SEGURANCA_BLOQUEIO_AUTOMATICO', 'true') !== 'false',
    limiteEventos: num('SEGURANCA_LIMITE_EVENTOS', 3),      // eventos graves do mesmo IP em 15 min para bloquear
    minutosBloqueio: num('SEGURANCA_MINUTOS_BLOQUEIO', 60),
    ipsConfiaveis: txt('SEGURANCA_IPS_CONFIAVEIS', ''),     // nunca bloqueados automaticamente (separe por vírgula)
    diasHistorico: num('SEGURANCA_DIAS_HISTORICO', 90),
    avisoEmail: txt('SEGURANCA_AVISO_EMAIL', 'true') !== 'false',
  },            // quem recebe os avisos de cadastro
  urlPublica: txt('APP_URL_PUBLICA', 'http://localhost:8080'), // endereço usado nos links dos e-mails
  adminSenhaInicial: txt('ADMIN_SENHA_INICIAL', ''),
  databaseUrl: txt('DATABASE_URL', ''),
  uploadDir: txt('UPLOAD_DIR', path.resolve(aqui, '../../dados/uploads')),
  maxPdfMb: num('MAX_PDF_MB', 25),
  pdfWorkerUrl: txt('PDF_WORKER_URL', 'http://localhost:8001'),
  pdfWorkerTimeoutMs: num('PDF_WORKER_TIMEOUT_SEGUNDOS', 180) * 1000,

  newApi: { url: txt('NEWAPI_BASE_URL', 'http://localhost:3000/v1'), token: txt('NEWAPI_TOKEN', '') },
  aliasesSoPublicos: lista('ALIASES_SO_DOCUMENTOS_PUBLICOS', 'ia-leve'),
  aliasesNuvem: lista('ALIASES_NUVEM', 'ia-leve,ia-forte'),
  rotas: {
    e1a_partes: lista('ROTA_E1A_PARTES_EDITAL', 'ia-leve,ia-media'),
    e2_gerais: lista('ROTA_E2_METADADOS', 'ia-leve,ia-media'),
    e3_requisitos: lista('ROTA_E3_REQUISITOS', 'ia-media,ia-forte'),
    e4_proposta: lista('ROTA_E4_PROPOSTA', 'ia-media,ia-forte'),
    e5_pares: lista('ROTA_E5_PARES_DUVIDOSOS', 'ia-forte'),
    e6_texto_livre: lista('ROTA_E6_TEXTO_LIVRE', 'ia-forte'),
    e6_segunda: lista('E6_SEGUNDA_OPINIAO', 'ia-media'),
  },
  limites: {
    'ia-leve': { simultaneas: num('LEVE_MAX_CONCURRENT', 2), porMinuto: num('LEVE_RPM', 10), porDia: num('LEVE_RPD', 1000), timeoutMs: num('TIMEOUT_LEVE_SEGUNDOS', 60) * 1000 },
    'ia-media': { simultaneas: num('MEDIA_MAX_CONCURRENT', 1), porMinuto: 0, porDia: 0, timeoutMs: num('TIMEOUT_MEDIA_SEGUNDOS', 300) * 1000 },
    'ia-forte': { simultaneas: num('FORTE_MAX_CONCURRENT', 3), porMinuto: 0, porDia: 0, timeoutMs: num('TIMEOUT_FORTE_SEGUNDOS', 120) * 1000 },
  },
  pausaAposErroMs: num('PAUSA_APOS_ERRO_SEGUNDOS', 60) * 1000,
  tentativasJson: num('TENTATIVAS_JSON_INVALIDO', 2),
  e3LinhasPorLote: num('E3_LINHAS_POR_LOTE', 15),
  ollamaUrl: txt('OLLAMA_URL', 'http://localhost:11434'),
  embeddingsModelo: txt('EMBEDDINGS_MODELO', 'bge-m3'),
  limiarDepara: num('LIMIAR_DEPARA', 0.55),
  localTextos: txt('LOCAL_TEXTOS', 'São Paulo'),
  ausenciaReprova: txt('AUSENCIA_COMO_NAO_ATENDE', 'false').toLowerCase() === 'true',
  capitulosGerais: lista('CAPITULOS_GERAIS_PALAVRAS', 'REQUISITOS DA CONTRATACAO,MODELO DE EXECUCAO,PREENCHIMENTO DA PROPOSTA'),
  capitulosHabilitacao: lista('CAPITULOS_HABILITACAO_PALAVRAS', 'HABILITACAO,CRITERIOS DE SELECAO'),
};
