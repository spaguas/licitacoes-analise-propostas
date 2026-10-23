// Quadro "Estrutura da licitação" (Etapa 01): por item ou por lote, quantos lotes, quantos itens
// em cada um, valor estimado e alertas. É conferido ANTES dos requisitos e das propostas.
import { api } from '../api.js';
import { Icone, moeda } from './Comuns.jsx';

const ORIGEM = {
  documento: (e) => `Encontrado no ${e?.documento === 'edital' ? 'Edital' : 'TR'}${e?.pagina ? `, p. ${e.pagina}` : ''}: “${e?.trecho}”`,
  manual: () => 'Definido manualmente nesta tela.',
  capa: (_, c) => `Lido na capa do edital: “${c}”.`,
  padrao: () => 'Critério não encontrado nos documentos: usando o padrão (por item).',
};

export function EstruturaLicitacao({ pregaoId, estrutura: e, executar }) {
  const porLote = e.julgamento === 'lote';
  const escolher = (valor) => executar(() => api.julgamento(pregaoId, valor === 'auto' ? null : valor === 'lote'),
    'Estrutura da licitação atualizada. Se já houver análise, recalcule na Etapa 04.');
  return (
    <div className={`cartao estrutura ${porLote ? 'estrutura-lote' : ''}`}>
      <div className="estrutura-topo">
        <div>
          <h3>Estrutura da licitação</h3>
          <p className="estrutura-titulo">
            <span className={`pilula-julgamento ${porLote ? 'lote' : 'item'}`}>{porLote ? 'Julgamento por lote' : 'Julgamento por item'}</span>
            {porLote
              ? <strong>{e.total_lotes} lote(s) · {e.total_itens} item(ns)</strong>
              : <strong>{e.total_itens} item(ns) julgado(s) separadamente</strong>}
          </p>
          <p className="ajuda">{ORIGEM[e.origem]?.(e.evidencia, e.criterio_capa)}</p>
        </div>
        <label className="julgamento">Corrigir, se preciso
          <select value={e.origem === 'manual' ? e.julgamento : 'auto'} onChange={(ev) => escolher(ev.target.value)}>
            <option value="auto">Automático (pelos documentos)</option>
            <option value="item">Por item</option>
            <option value="lote">Por lote</option>
          </select>
        </label>
      </div>

      <p className="estrutura-regra"><Icone nome="info" tamanho={16} /> {e.regra}</p>

      {e.alertas.map((a) => <p key={a} className="estrutura-alerta"><Icone nome="alerta" tamanho={16} /> {a}</p>)}

      <div className="tabela-rolagem">
        <table className="tabela">
          <thead><tr>{porLote && <th>Lote</th>}<th>Item</th><th>Descrição</th><th>Qtd.</th><th>Valor unitário estimado</th><th>Valor total estimado</th></tr></thead>
          {porLote ? e.lotes.map((l) => (
            <tbody key={l.lote}>
              <tr className="linha-secao"><th colSpan={6}>Lote {l.lote} · {l.quantidade_itens} {l.quantidade_itens > 1 ? 'itens' : 'item'} · valor estimado do lote {moeda(l.valor_estimado)}</th></tr>
              {l.itens.map((i) => (
                <tr key={i.numero}><td>{l.lote}</td><td>{i.numero}</td><td>{i.descricao}</td><td>{i.quantidade ?? '—'} {i.unidade || ''}</td>
                  <td>{moeda(i.valor_unitario_estimado)}</td><td>{moeda((Number(i.valor_unitario_estimado) || 0) * (Number(i.quantidade) || 0))}</td></tr>
              ))}
            </tbody>
          )) : (
            <tbody>
              {e.lotes.flatMap((l) => l.itens).map((i) => (
                <tr key={i.numero}><td>{i.numero}</td><td>{i.descricao}</td><td>{i.quantidade ?? '—'} {i.unidade || ''}</td>
                  <td>{moeda(i.valor_unitario_estimado)}</td><td>{moeda((Number(i.valor_unitario_estimado) || 0) * (Number(i.quantidade) || 0))}</td></tr>
              ))}
            </tbody>
          )}
        </table>
      </div>
    </div>
  );
}
