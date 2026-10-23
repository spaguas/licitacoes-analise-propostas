import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { avaliar, combinarPareceres, resumir, STATUS } from '../src/nucleo/regras.js';
import { converter } from '../src/nucleo/unidades.js';

const G = JSON.parse(readFileSync(new URL('./dados/item1_gabarito.json', import.meta.url), 'utf8'));
const especPorId = Object.fromEntries(G.especificacoes.map((e) => [e.id, e]));

function avaliarComIAGravada(req) {
  const espec = G.depara[req.id] ? especPorId[G.depara[req.id]] : null;
  const r = avaliar(req, espec, G.item_proposta);
  if (!r.precisa_ia) return r;
  const gravada = G.ia_texto_livre[req.atributo];
  assert.ok(gravada, `faltou resposta gravada de IA para ${req.atributo}`);
  return combinarPareceres(gravada.forte, gravada.media);
}

test('as regras reproduzem o checklist gabarito do Item 1 (64 linhas)', () => {
  const divergencias = [];
  for (const req of G.requisitos) {
    const r = avaliarComIAGravada(req);
    if (r.status !== G.esperado[req.id]) divergencias.push(`${req.id} ${req.atributo}: obtido ${r.status}, esperado ${G.esperado[req.id]}`);
  }
  assert.deepEqual(divergencias, []);
});

test('ausência de informação nunca vira NÃO ATENDE', () => {
  for (const req of G.requisitos) {
    if (G.depara[req.id]) continue;
    const r = avaliar(req, null, G.item_proposta);
    assert.notEqual(r.status, STATUS.NAO_ATENDE, req.atributo);
  }
});

test('robustez: pares errados no de-para não geram veredito errado', () => {
  const falsos = { memoria_expansao: 'E006', armazenamento_expansao_nvme: 'E009', armazenamento_leitura: 'E009', armazenamento_escrita: 'E009', fonte_frequencia: 'E010', peso_gabinete: 'E015' };
  for (const req of G.requisitos.filter((r) => falsos[r.atributo])) {
    const r = avaliar(req, especPorId[falsos[req.atributo]], G.item_proposta);
    // Aceitável: falta de informação, revisão humana ou decisão pela dupla de IAs — nunca ATENDE/NÃO ATENDE direto.
    assert.ok(r.precisa_ia || [STATUS.NAO_COMPROVADO, STATUS.REVISAR].includes(r.status), `${req.atributo} -> ${r.status}`);
  }
});

test('casos-chave do Item 1', () => {
  const porAttr = Object.fromEntries(G.requisitos.map((r) => [r.atributo, avaliarComIAGravada(r).status]));
  assert.equal(porAttr.fonte_potencia, STATUS.NAO_ATENDE);
  assert.equal(porAttr.gabinete_formato, STATUS.NAO_ATENDE);
  assert.equal(porAttr.armazenamento_capacidade, STATUS.ATENDE);
  assert.equal(porAttr.armazenamento_tecnologia, STATUS.NAO_COMPROVADO);
  assert.equal(porAttr.chipset_integrado, STATUS.REVISAR);
  assert.equal(porAttr.passmark_cpu, STATUS.VERIFICAR);
  assert.equal(porAttr.campos_marca_fabricante, STATUS.PARCIAL);
});

test('resumo sugerido do Item 1 é "não atende"', () => {
  const avals = G.requisitos.map((r) => ({ ...avaliarComIAGravada(r), obrigatorio: r.obrigatorio }));
  assert.equal(resumir(avals), 'não atende');
});

test('conversão de unidades genérica (papel, câmera, prazos)', () => {
  assert.equal(converter(1, 'TB', 'GB'), 1000);
  assert.equal(converter(90, 'g/m²', 'g/m2'), 90);
  assert.equal(converter(2, 'anos', 'meses'), 24.333333333333332);
  assert.equal(converter(5, 'GB', 'MB/s'), null);
  const papel = avaliar({ tipo: 'numerico', operador: '>=', valor: 75, unidade: 'g/m2' }, { valor: 90, unidade: 'g/m²', origem: { trecho: 'Gramatura 90 g/m²' } });
  assert.equal(papel.status, STATUS.ATENDE);
  const camera = avaliar({ tipo: 'numerico', operador: '>=', valor: 4, unidade: 'MP' }, { valor: 8, unidade: 'MP', origem: { trecho: '8 MP' } });
  assert.equal(camera.status, STATUS.NAO_COMPROVADO, 'unidade desconhecida não pode virar ATENDE nem NÃO ATENDE');
});

import { normalizarNumeroItem, normalizarOperador } from '../src/nucleo/normalizacao.js';

test('operadores escritos de outros jeitos são entendidos (e desconhecido vira REVISAR, sem quebrar)', () => {
  for (const [op, esperado] of [['≥', '>='], ['mínimo', '>='], ['no máximo', '<='], ['até', '<='], ['=>', '>='], ['igual a', '=']]) {
    assert.equal(normalizarOperador(op), esperado, op);
  }
  const base = { tipo: 'numerico', valor: 36, unidade: 'mes' };
  const espec = { valor: 24, unidade: 'mes', origem: { trecho: 'garantia de 24 meses' } };
  assert.equal(avaliar({ ...base, operador: '≥' }, espec).status, STATUS.NAO_ATENDE);
  assert.equal(avaliar({ ...base, operador: 'xpto' }, espec).status, STATUS.REVISAR);
  assert.equal(avaliar({ ...base, operador: '>=', valor: 'trinta' }, espec).status, STATUS.REVISAR);
});

test('número do item padronizado: "01", "Item 01 - ...", descrição sem número', () => {
  const itens = [{ numero: '1', descricao: 'Desktop Básico' }, { numero: '2', descricao: 'Notebook Básico' }];
  assert.equal(normalizarNumeroItem('01', itens), '1');
  assert.equal(normalizarNumeroItem('Item 01 - Intel WorkPro i7 | 16GB | SSD NVMe 500GB', itens), '1');
  assert.equal(normalizarNumeroItem('item nº 2', itens), '2');
  assert.equal(normalizarNumeroItem('Notebook básico Dell 14 polegadas', itens), '2');
  assert.equal(normalizarNumeroItem('Computador Completo I5 16gb Ssd 512gb', [{ numero: '1', descricao: 'Desktop Básico' }]), '1');
});

test('modo rigoroso: informação ausente vira NÃO ATENDE (faltante); sem ele, NÃO COMPROVADO', () => {
  const req = { tipo: 'booleano', atributo: 'bluetooth', origem: { trecho: 'Bluetooth' } };
  const normal = avaliar(req, null, {});
  assert.equal(normal.status, STATUS.NAO_COMPROVADO);
  assert.equal(normal.faltante, true);
  const rigoroso = avaliar(req, null, {}, { ausenciaReprova: true });
  assert.equal(rigoroso.status, STATUS.NAO_ATENDE);
  assert.match(rigoroso.justificativa, /^Faltante na proposta/);
  // o que é vago, revisar ou verificação externa NÃO muda
  const vago = avaliar({ tipo: 'booleano', atributo: 'x', origem: { trecho: 'x' } }, { vago: true, origem: { trecho: 'conforme estoque' } }, {}, { ausenciaReprova: true });
  assert.equal(vago.status, STATUS.VAGO);
  assert.equal(avaliar({ tipo: 'verificacao_externa' }, null, {}, { ausenciaReprova: true }).status, STATUS.VERIFICAR);
  // parecer de IA "não comprovado" também vira faltante
  const ia = combinarPareceres({ status: STATUS.NAO_COMPROVADO, justificativa: 'sem descrição' }, { status: STATUS.NAO_COMPROVADO, justificativa: 'nada' }, { ausenciaReprova: true });
  assert.equal(ia.status, STATUS.NAO_ATENDE);
});

test('com o modo rigoroso, o gabarito do Item 1 troca só os "não comprovado" por "não atende"', () => {
  const especPorId = Object.fromEntries(G.especificacoes.map((e) => [e.id, e]));
  for (const req of G.requisitos) {
    const espec = G.depara[req.id] ? especPorId[G.depara[req.id]] : null;
    let r = avaliar(req, espec, G.item_proposta, { ausenciaReprova: true });
    if (r.precisa_ia) r = combinarPareceres(G.ia_texto_livre[req.atributo].forte, G.ia_texto_livre[req.atributo].media, { ausenciaReprova: true });
    let esperado = G.esperado[req.id] === STATUS.NAO_COMPROVADO ? STATUS.NAO_ATENDE : G.esperado[req.id];
    // chipset: ia-forte "não atende" × ia-media "não comprovado" — no modo rigoroso as duas concordam em NÃO ATENDE
    if (req.atributo === 'chipset_integrado') esperado = STATUS.NAO_ATENDE;
    assert.equal(r.status, esperado, req.atributo);
  }
});

import { detectarJulgamento } from '../src/nucleo/julgamento.js';

test('critério de julgamento: por item, por lote, global, grupo, conflito e não encontrado', () => {
  const doc = (papel, texto) => [{ papel, nome_arquivo: `${papel}.pdf`, paginas: [{ pagina: 1, texto }] }];
  assert.equal(detectarJulgamento(doc('edital', 'CRITÉRIO DE JULGAMENTO:\nMenor Preço por item')).modo, 'item');
  assert.equal(detectarJulgamento(doc('edital', 'critério de julgamento: menor preço global')).modo, 'lote');
  assert.equal(detectarJulgamento(doc('edital', 'A licitação será dividida em lotes.')).modo, 'lote');
  assert.equal(detectarJulgamento(doc('tr', 'A adjudicação será por grupo.')).modo, 'lote');
  assert.equal(detectarJulgamento(doc('edital', 'sem nada')).modo, null);
  const c = detectarJulgamento([...doc('edital', 'CRITÉRIO DE JULGAMENTO: Menor Preço por item'), ...doc('tr', 'critério de julgamento: menor preço por lote')]);
  assert.equal(c.modo, 'item', 'o edital tem prioridade');
  assert.ok(c.conflito, 'edital × TR diferentes vira conflito');
});
