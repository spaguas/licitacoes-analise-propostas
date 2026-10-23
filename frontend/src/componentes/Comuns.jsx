// Componentes visuais pequenos usados em várias telas.
import { useRef, useState } from 'react';

const CAMINHOS = {
  painel: 'M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z',
  pasta: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z',
  documento: 'M7 3h7l5 5v13H7V3zm7 0v5h5M10 13h6M10 17h6',
  lista: 'M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01',
  empresa: 'M4 21V7l8-4 8 4v14M9 21v-6h6v6M8 10h.01M12 10h.01M16 10h.01',
  check: 'M5 12l5 5L20 7',
  x: 'M6 6l12 12M18 6L6 18',
  alerta: 'M12 9v4m0 4h.01M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  escudo: 'M12 2l8 3v6c0 5-3.4 9.3-8 11-4.6-1.7-8-6-8-11V5l8-3z',
  olho: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  olho_fechado: 'M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6A17 17 0 0 0 2 12s3.6 7 10 7a9.6 9.6 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2',
  cadeado: 'M6 11h12v10H6zM8 11V7a4 4 0 0 1 8 0v4',
  lixeira: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  info: 'M12 16v-4m0-4h.01M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z',
  lupa: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zm10 2l-4.3-4.3',
  envio: 'M12 16V4m0 0l-5 5m5-5l5 5M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3',
  sair: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  ia: 'M9 3v2m6-2v2M9 19v2m6-2v2M3 9h2m-2 6h2m14-6h2m-2 6h2M7 5h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zm3 5h4v4h-4z',
  atualizar: 'M4 4v6h6M20 20v-6h-6M5.6 15a8 8 0 0 0 13.9 1.5M18.4 9A8 8 0 0 0 4.5 7.5',
  play: 'M7 4l13 8-13 8V4z',
  mais: 'M12 5v14M5 12h14',
  baixar: 'M12 4v12m0 0l-5-5m5 5l5-5M4 20h16',
  revisar: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z',
};

export function Icone({ nome, tamanho = 18, titulo }) {
  return (
    <svg className="icone" width={tamanho} height={tamanho} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" role={titulo ? 'img' : 'presentation'} aria-label={titulo} aria-hidden={titulo ? undefined : true}>
      <path d={CAMINHOS[nome] || CAMINHOS.info} />
    </svg>
  );
}

// Status sempre com cor + ícone + texto (nunca só cor).
const STATUS = {
  'ATENDE': { classe: 'ok', icone: 'check' },
  'NÃO ATENDE': { classe: 'erro', icone: 'x' },
  'PARCIAL': { classe: 'atencao', icone: 'alerta' },
  'VAGO': { classe: 'atencao', icone: 'alerta' },
  'NÃO COMPROVADO': { classe: 'neutro', icone: 'info' },
  'VERIFICAR EXTERNAMENTE': { classe: 'externo', icone: 'lupa' },
  'REVISAR': { classe: 'revisar', icone: 'revisar' },
};
export const LISTA_STATUS = Object.keys(STATUS);
// Situações só informativas (não escolhíveis na revisão)
STATUS['NÃO OFERTADO'] = { classe: 'nao-ofertado', icone: 'x' };
STATUS['AGUARDANDO ANÁLISE'] = { classe: 'neutro', icone: 'info' };

export function SeloStatus({ status, compacto = false }) {
  const s = STATUS[status] || { classe: 'neutro', icone: 'info' };
  return (
    <span className={`selo selo-${s.classe}`} title={status}>
      <Icone nome={s.icone} tamanho={15} />
      {!compacto && <span>{status || '—'}</span>}
    </span>
  );
}

export function Botao({ children, icone, variante = 'principal', pequeno = false, ...props }) {
  return (
    <button type="button" className={`botao botao-${variante}${pequeno ? ' botao-pequeno' : ''}`} {...props}>
      {icone && <Icone nome={icone} />}
      <span>{children}</span>
    </button>
  );
}

export function CabecalhoEtapa({ numero, rotulo, titulo, acoes }) {
  return (
    <div className="etapa-cabecalho">
      <div>
        <p className="rotulo">ETAPA {String(numero).padStart(2, '0')} · {rotulo}</p>
        <h2>{titulo}</h2>
      </div>
      {acoes && <div className="etapa-acoes">{acoes}</div>}
    </div>
  );
}

export function Aviso({ tipo = 'info', children, aoFechar }) {
  return (
    <div className={`aviso aviso-${tipo}`} role={tipo === 'erro' ? 'alert' : 'status'}>
      <Icone nome={tipo === 'sucesso' ? 'check' : tipo === 'erro' ? 'alerta' : 'info'} />
      <div>{children}</div>
      {aoFechar && <button type="button" className="aviso-fechar" onClick={aoFechar} aria-label="Fechar aviso"><Icone nome="x" /></button>}
    </div>
  );
}

export function AreaEnvio({ titulo, descricao, multiplo = false, aoSelecionar, desabilitado }) {
  const entrada = useRef(null);
  const [arrastando, setArrastando] = useState(false);
  const escolher = (lista) => {
    const pdfs = [...lista].filter((f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'));
    if (pdfs.length) aoSelecionar(multiplo ? pdfs : [pdfs[0]]);
  };
  return (
    <div
      className={`area-envio ${arrastando ? 'arrastando' : ''} ${desabilitado ? 'desabilitada' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setArrastando(true); }}
      onDragLeave={() => setArrastando(false)}
      onDrop={(e) => { e.preventDefault(); setArrastando(false); if (!desabilitado) escolher(e.dataTransfer.files); }}
    >
      <Icone nome="envio" tamanho={22} />
      <div className="area-envio-texto">
        <strong>{titulo}</strong>
        <span>{descricao}</span>
      </div>
      <Botao variante="secundario" icone="mais" disabled={desabilitado} onClick={() => entrada.current?.click()}>Selecionar</Botao>
      <input ref={entrada} type="file" accept="application/pdf" multiple={multiplo} hidden onChange={(e) => { escolher(e.target.files); e.target.value = ''; }} />
    </div>
  );
}

// Etiqueta de origem do requisito: "TR · p. 3" ou "Edital · p. 6".
export function Origem({ fonte, pagina }) {
  if (!fonte && !pagina) return null;
  return (
    <span className={`origem origem-${(fonte?.sigla || 'doc').toLowerCase()}`} title={fonte?.arquivo || ''}>
      {fonte?.sigla || 'Doc.'}{pagina ? ` · p. ${pagina}` : ''}
    </span>
  );
}

// Mostra o operador sempre no padrão, mesmo que a IA tenha escrito "até", "mínimo", "≥"...
const OPERADOR_TELA = { 'ate': '<=', 'até': '<=', 'maximo': '<=', 'máximo': '<=', 'no máximo': '<=', 'minimo': '>=', 'mínimo': '>=', 'no mínimo': '>=', '≥': '>=', '≤': '<=', '=>': '>=', '=<': '<=' };
export const operadorTela = (op) => (op ? OPERADOR_TELA[String(op).trim().toLowerCase()] || op : '>=');

// Campo de senha com botão de olho para mostrar/ocultar o que foi digitado.
export function CampoSenha({ rotulo, ...props }) {
  const [ver, setVer] = useState(false);
  return (
    <label>{rotulo}
      <span className="campo-senha">
        <input {...props} type={ver ? 'text' : 'password'} spellCheck={false} autoCapitalize="off" />
        <button type="button" className="botao-olho" onClick={() => setVer((v) => !v)}
          aria-label={ver ? 'Ocultar senha' : 'Mostrar senha'} aria-pressed={ver} title={ver ? 'Ocultar senha' : 'Mostrar senha'}>
          <Icone nome={ver ? 'olho_fechado' : 'olho'} tamanho={18} />
        </button>
      </span>
    </label>
  );
}

export const moeda = (v) => (v == null || v === '' ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
export const formatarCnpj = (c) => {
  const d = String(c ?? '').replace(/\W/g, '');
  return d.length === 14 ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}` : (c || '—');
};
export const dataBr = (v) => (v ? new Date(v).toLocaleDateString('pt-BR') : '—');
