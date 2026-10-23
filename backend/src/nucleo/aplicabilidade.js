// A quem um requisito se aplica:
//  - do item (item_numero preenchido)        -> só àquele item
//  - comum ao lote (sem item, com lote)      -> a todos os itens daquele lote
//  - geral (sem item e sem lote)             -> a todos os itens
import { normalizarNumeroItem } from './normalizacao.js';

export function aplicaAoItem(requisito, numeroItem, loteDoItem = {}) {
  if (requisito.item_numero != null) return normalizarNumeroItem(requisito.item_numero) === numeroItem;
  if (requisito.lote != null && requisito.lote !== '') return String(requisito.lote) === String(loteDoItem[numeroItem] ?? numeroItem);
  return true;
}

export function escopoDoRequisito(requisito) {
  if (requisito.item_numero != null) return 'item';
  if (requisito.lote != null && requisito.lote !== '') return 'lote';
  return 'geral';
}
