// Detecção de tentativas de ataque em textos vindos da internet (URL, formulários, JSON).
// Padrões específicos, para não acusar texto comum (ex.: "não atende - conferir").
const PADROES = [
  { tipo: 'SQL', re: /\bunion\b[\s\S]{0,40}\bselect\b/i },
  { tipo: 'SQL', re: /['"`]\s*(or|and)\s+['"`]?[\w-]*['"`]?\s*(=|like|>|<)\s*['"`]?[\w-]*/i },  // ' OR '1'='1
  { tipo: 'SQL', re: /\b(or|and)\s+\d+\s*=\s*\d+\s*(--|#|\/\*|;|$)/i },                       // OR 1=1 --
  { tipo: 'SQL', re: /;\s*(drop|delete|insert|update|alter|truncate|create|exec)\b\s+\w/i },
  { tipo: 'SQL', re: /\b(pg_sleep|sleep|benchmark|waitfor\s+delay)\s*\(/i },
  { tipo: 'SQL', re: /\b(information_schema|pg_catalog|pg_shadow|sysobjects|xp_cmdshell)\b/i },
  { tipo: 'SQL', re: /['"]\s*;?\s*--\s*$|\/\*!?\d*[\s\S]*\*\//i },
  { tipo: 'XSS', re: /<\s*(script|iframe|object|embed|svg|img)[^>]*>|javascript\s*:|\bon(error|load|click|mouseover)\s*=/i },
  { tipo: 'Caminho de arquivo', re: /(\.\.[/\\]){1,}|%2e%2e(%2f|%5c|\/|\\)|\/etc\/passwd|\\windows\\win\.ini/i },
  { tipo: 'Comando do sistema', re: /(;|\||&&|`|\$\()\s*(cat|ls|wget|curl|bash|sh|nc|powershell|cmd|whoami|id)\b/i },
  { tipo: 'NoSQL', re: /\{\s*"?\$(ne|gt|lt|where|regex|or)"?\s*:/i },
  { tipo: 'Template', re: /\{\{[\s\S]{0,40}\}\}|\$\{[\s\S]{0,40}\}/ },
];

export function detectarInjecao(texto) {
  const t = String(texto ?? '');
  if (t.length < 3) return null;
  for (const p of PADROES) if (p.re.test(t)) return p.tipo;
  return null;
}

// Varre os campos de um objeto JSON (e chaves estranhas como "$ne") e devolve o primeiro achado.
export function inspecionarObjeto(obj, prefixo = '') {
  if (obj === null || obj === undefined) return null;
  if (typeof obj === 'string') { const tipo = detectarInjecao(obj); return tipo ? { campo: prefixo || 'valor', tipo } : null; }
  if (typeof obj !== 'object') return null;
  for (const [k, v] of Object.entries(obj)) {
    if (k.startsWith('$') || k === '__proto__' || k === 'constructor') return { campo: prefixo ? `${prefixo}.${k}` : k, tipo: 'NoSQL / protótipo' };
    const achado = inspecionarObjeto(v, prefixo ? `${prefixo}.${k}` : k);
    if (achado) return achado;
  }
  return null;
}

// Endereços que robôs de invasão costumam procurar.
const VARREDURA = /(wp-admin|wp-login|xmlrpc\.php|phpmyadmin|\/\.env|\/\.git|\/\.aws|\/config\.(php|json|yml)|\/admin\.php|\/shell|\/cgi-bin|\/actuator|\/server-status|\.(php|asp|aspx|jsp)$)/i;
export const ehVarredura = (caminho) => VARREDURA.test(String(caminho || ''));
