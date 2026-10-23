// Comparação requisito × especificação ofertada (etapa E6), sem IA.
// A ORDEM das verificações é parte da regra de negócio — não altere sem atualizar os testes:
//   0. requisitos especiais (campos obrigatórios da proposta, verificação externa)
//   1. sem especificação ligada            -> NÃO COMPROVADO
//   2. proposta nega expressamente         -> NÃO ATENDE
//   3. só identificador de modelo          -> VERIFICAR EXTERNAMENTE
//   4. falta a grandeza exigida            -> NÃO COMPROVADO
//   5. termo vago                          -> VAGO
//   6. alternativas ou contradição         -> REVISAR
//   7. regra do tipo (ou IA, para texto livre, condicional e equivalência de norma)
// REGRA FIXA: ausência de informação NUNCA vira NÃO ATENDE.

import { converter, extrairQuantidade } from './unidades.js';
import { normalizar } from './texto.js';
import { normalizarOperador } from './normalizacao.js';

export const STATUS = {
  ATENDE: 'ATENDE',
  NAO_ATENDE: 'NÃO ATENDE',
  PARCIAL: 'PARCIAL',
  NAO_COMPROVADO: 'NÃO COMPROVADO',
  VAGO: 'VAGO',
  VERIFICAR: 'VERIFICAR EXTERNAMENTE',
  REVISAR: 'REVISAR',
};

const COMPARA = {
  '>=': (a, b) => a >= b,
  '<=': (a, b) => a <= b,
  '>': (a, b) => a > b,
  '<': (a, b) => a < b,
  '=': (a, b) => Math.abs(a - b) < 1e-9,
};

const resultado = (status, justificativa, extra = {}) => ({ status, justificativa, metodo: 'regra', precisa_ia: false, ...extra });
const paraIA = (motivo) => ({ status: null, justificativa: motivo, metodo: 'ia', precisa_ia: true });
const fmt = (n) => Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const PLURAL = { dia: 'dias', mes: 'meses', ano: 'anos', un: 'unidades', h: 'horas' };
const un = (valor, unidade) => (Number(valor) !== 1 && PLURAL[String(unidade).toLowerCase()]) || unidade;

function quantidadeDa(especificacao) {
  const v = especificacao.valor;
  if (typeof v === 'number' && especificacao.unidade) return { valor: v, unidade: especificacao.unidade };
  return extrairQuantidade(typeof v === 'string' ? v : especificacao.origem?.trecho);
}

const PALAVRAS_VAZIAS = new Set(['DEVERA', 'DEVE', 'POSSUIR', 'TER', 'COM', 'SEM', 'PARA', 'DOS', 'DAS', 'QUE', 'OU', 'UMA', 'UM', 'NO', 'NA', 'MINIMO', 'MAXIMO', 'TIPO', 'SUPERIOR', 'INTEGRADO', 'INTEGRADA']);
function temTermoEmComum(textoRequisito, especificacao) {
  const termos = normalizar(textoRequisito).split(/[^A-Z0-9.]+/).filter((t) => t.length >= 3 && !PALAVRAS_VAZIAS.has(t));
  const oferta = textoDa(especificacao);
  return termos.some((t) => oferta.includes(t));
}

// Todos os termos do atributo do requisito aparecem no atributo/seção/texto da especificação?
function mesmoAtributo(requisito, especificacao) {
  const termos = normalizar(requisito.atributo).split(/[_\s]+/).filter((t) => t.length >= 3 && !PALAVRAS_VAZIAS.has(t));
  const alvo = normalizar(`${especificacao.atributo_declarado ?? ''} ${especificacao.secao_declarada ?? ''} ${textoDa(especificacao)}`).replace(/_/g, ' ');
  return termos.length > 0 && termos.every((t) => alvo.includes(t));
}

function textoDa(especificacao) {
  return normalizar(`${especificacao.valor ?? ''} ${especificacao.origem?.trecho ?? ''}`);
}

// Modo rigoroso (opção do pregão): informação ausente na proposta vira NÃO ATENDE ("faltante").
// Desligado (padrão), ausência é NÃO COMPROVADO — normalmente resolvido por diligência.
function faltante(justificativa, opcoes) {
  return opcoes.ausenciaReprova
    ? resultado(STATUS.NAO_ATENDE, `Faltante na proposta: ${justificativa}`, { faltante: true })
    : resultado(STATUS.NAO_COMPROVADO, justificativa.charAt(0).toUpperCase() + justificativa.slice(1), { faltante: true });
}

export function avaliar(requisito, especificacao, itemProposta = {}, opcoes = {}) {
  const tipo = requisito.tipo;

  // 0. Requisitos especiais
  if (tipo === 'campos_proposta') {
    const campos = requisito.opcoes || [];
    const presentes = campos.filter((c) => itemProposta[c] != null && String(itemProposta[c]).trim() !== '');
    if (presentes.length === campos.length) return resultado(STATUS.ATENDE, `Campos informados: ${campos.join(', ')}.`);
    const faltam = campos.filter((c) => !presentes.includes(c));
    if (presentes.length === 0) return resultado(STATUS.NAO_ATENDE, `A proposta não informa: ${faltam.join(', ')}.`);
    return resultado(STATUS.PARCIAL, `Informado: ${presentes.join(', ')}. Falta: ${faltam.join(', ')}.`);
  }
  if (tipo === 'verificacao_externa') {
    const modelo = especificacao?.identificador_modelo ? especificacao.valor : itemProposta.modelo;
    return resultado(STATUS.VERIFICAR, `Conferir em fonte oficial (ficha técnica, benchmark, data de lançamento)${modelo ? ` para o modelo declarado: ${modelo}` : ''}.`);
  }

  // 1. Sem especificação ligada
  if (!especificacao) return faltante('a proposta não traz essa informação.', opcoes);

  const trecho = especificacao.origem?.trecho ?? '';

  // 2. Negação expressa ("Com monitor: Não", "não acompanha chave de ativação")
  if (especificacao.negado) return resultado(STATUS.NAO_ATENDE, `A proposta declara: "${trecho}".`);

  // 3. Só o identificador do modelo (ex.: "Ryzen 7 5700G") -> conferir na ficha técnica
  if (especificacao.identificador_modelo && ['numerico', 'faixa', 'booleano', 'norma'].includes(tipo)) {
    return resultado(STATUS.VERIFICAR, `Conferir na ficha técnica oficial do modelo declarado (${especificacao.valor}).`);
  }

  // 4. A especificação tem a grandeza exigida?
  let quantidade = null;
  if ((tipo === 'numerico' || tipo === 'faixa') && requisito.unidade) {
    quantidade = quantidadeDa(especificacao);
    const convertido = quantidade ? converter(quantidade.valor, quantidade.unidade, requisito.unidade) : null;
    if (convertido == null) {
      return faltante(`a especificação ligada ("${trecho}") não traz valor em ${requisito.unidade}.`, opcoes);
    }
    quantidade.convertido = convertido;
  }

  // 5. Termo vago
  if (especificacao.vago) return resultado(STATUS.VAGO, `A proposta usa termo sem compromisso verificável: "${trecho}".`);

  // 6. Alternativas ou contradição
  if (especificacao.alternativas?.length) {
    return resultado(STATUS.REVISAR, `A proposta oferece alternativas (${especificacao.alternativas.join(' / ')}); confirmar qual será entregue.`);
  }
  if (especificacao.contradiz) return resultado(STATUS.REVISAR, `A proposta se contradiz: ${especificacao.contradiz}.`);

  // 7. Regra do tipo
  switch (tipo) {
    case 'numerico': {
      const op = normalizarOperador(requisito.operador) ?? (requisito.operador == null ? '>=' : undefined);
      if (!op || !COMPARA[op]) return resultado(STATUS.REVISAR, `Regra do requisito com operador não reconhecido ("${requisito.operador}"). Corrija o requisito na Etapa 02.`);
      if (!Number.isFinite(Number(requisito.valor))) return resultado(STATUS.REVISAR, `Requisito numérico sem valor válido ("${requisito.valor}"). Corrija na Etapa 02.`);
      const ok = COMPARA[op](quantidade.convertido, Number(requisito.valor));
      return resultado(ok ? STATUS.ATENDE : STATUS.NAO_ATENDE,
        `${fmt(quantidade.valor)} ${un(quantidade.valor, quantidade.unidade)} ${ok ? 'atende' : 'não atende'} ${op} ${fmt(requisito.valor)} ${un(requisito.valor, requisito.unidade)}.`);
    }
    case 'faixa': {
      const x = quantidade.convertido;
      const ok = x >= Number(requisito.valor_min) && x <= Number(requisito.valor_max);
      return resultado(ok ? STATUS.ATENDE : STATUS.NAO_ATENDE,
        `${fmt(quantidade.valor)} ${quantidade.unidade} ${ok ? 'dentro' : 'fora'} da faixa de ${fmt(requisito.valor_min)} a ${fmt(requisito.valor_max)} ${requisito.unidade}.`);
    }
    case 'booleano': {
      if (especificacao.valor === false) return resultado(STATUS.NAO_ATENDE, `A proposta declara: "${trecho}".`);
      // Só vale como prova se a especificação mencionar o assunto do requisito (ex.: "Bluetooth").
      // Senão (ex.: "GPU integrada" × "Vega 8"), quem decide é a dupla de IAs.
      if (temTermoEmComum(requisito.origem?.trecho, especificacao)) return resultado(STATUS.ATENDE, `Declarado na proposta: "${trecho}".`);
      return paraIA(`Confirmar se "${trecho}" atende "${requisito.origem?.trecho ?? requisito.atributo}".`);
    }
    case 'opcao': {
      const ofertado = textoDa(especificacao);
      const ok = (requisito.opcoes || []).some((o) => ofertado.includes(normalizar(o)));
      if (ok) return resultado(STATUS.ATENDE, `Ofertado "${especificacao.valor}"; permitido: ${(requisito.opcoes || []).join(', ')}.`);
      // Só conclui NÃO ATENDE se a especificação trata do MESMO atributo (ex.: formato do gabinete × "ATX").
      // Se ela fala de outra coisa (ex.: "Tecnologia NVMe" × "SSD 1TB"), falta a informação.
      if (!mesmoAtributo(requisito, especificacao)) {
        return faltante(`a especificação ligada ("${trecho}") não informa ${requisito.atributo.replace(/_/g, ' ')}.`, opcoes);
      }
      return resultado(STATUS.NAO_ATENDE, `Ofertado "${especificacao.valor}"; permitido: ${(requisito.opcoes || []).join(', ')}.`);
    }
    case 'norma': {
      const exigido = normalizar(requisito.valor);
      const ofertado = textoDa(especificacao);
      if (exigido && ofertado.includes(exigido)) return resultado(STATUS.ATENDE, `A proposta cita ${requisito.valor}.`);
      // Sem nenhum código (letras + números) na oferta, não há o que comparar: falta a informação.
      if (!/[A-Z]+[\s.-]?\d|\d+[A-Z]/.test(ofertado)) {
        return faltante(`a proposta não informa a norma/padrão exigido (${requisito.valor}).`, opcoes);
      }
      return paraIA(`Avaliar equivalência entre "${requisito.valor}" e "${trecho}".`);
    }
    case 'texto_livre':
    case 'condicional':
      return paraIA('Requisito descritivo: julgamento por IA com segunda opinião.');
    default:
      return resultado(STATUS.REVISAR, `Tipo de requisito desconhecido: ${tipo}.`);
  }
}

// Junta os pareceres das duas IAs (E6): concordância vira o status; divergência vira REVISAR.
export function combinarPareceres(principal, segunda, opcoes = {}) {
  // No modo rigoroso, "não comprovado" das IAs também vira NÃO ATENDE (faltante).
  const ajustar = (p) => {
    if (!p || p.status !== STATUS.NAO_COMPROVADO) return p;
    return opcoes.ausenciaReprova
      ? { ...p, status: STATUS.NAO_ATENDE, justificativa: `Faltante na proposta: ${p.justificativa}`, faltante: true }
      : { ...p, faltante: true };
  };
  principal = ajustar(principal); segunda = ajustar(segunda);
  if (!principal) return resultado(STATUS.REVISAR, 'A IA principal não respondeu.', { metodo: 'ia' });
  if (!segunda) return { ...principal, metodo: 'ia', precisa_ia: false, concordancia_ias: null };
  const concordam = principal.status === segunda.status;
  return {
    status: concordam ? principal.status : STATUS.REVISAR,
    faltante: concordam && Boolean(principal.faltante),
    justificativa: `ia-forte: ${principal.justificativa} | ia-media: ${segunda.justificativa}`,
    metodo: 'ia',
    precisa_ia: false,
    concordancia_ias: concordam,
  };
}

// Resumo sugerido por item e fornecedor (é sempre uma SUGESTÃO para o pregoeiro).
export function resumir(avaliacoes) {
  const obrig = avaliacoes.filter((a) => a.obrigatorio !== false);
  if (obrig.some((a) => a.status === STATUS.NAO_ATENDE)) return 'não atende';
  const pendentes = [STATUS.NAO_COMPROVADO, STATUS.VAGO, STATUS.VERIFICAR, STATUS.REVISAR, STATUS.PARCIAL];
  if (obrig.some((a) => pendentes.includes(a.status))) return 'pendente de verificação';
  return 'atende todos os obrigatórios';
}
