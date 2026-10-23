import { useMemo, useState } from 'react';
import { api } from '../api.js';
import { Botao, CabecalhoEtapa, Icone, Origem, operadorTela } from './Comuns.jsx';
import { EditorRequisito } from './EditorRequisito.jsx';

const TIPO = { numerico: 'Numérico', faixa: 'Faixa', booleano: 'Sim/não', opcao: 'Opção', norma: 'Norma', condicional: 'Condicional', texto_livre: 'Texto livre', verificacao_externa: 'Verificação externa', campos_proposta: 'Campos da proposta' };

function regraLegivel(r) {
  const v = typeof r.valor === 'object' && r.valor !== null ? JSON.stringify(r.valor) : r.valor;
  switch (r.tipo) {
    case 'numerico': return `${operadorTela(r.operador)} ${v ?? ''} ${r.unidade ?? ''}`;
    case 'faixa': return `${r.valor_min} a ${r.valor_max} ${r.unidade ?? ''}`;
    case 'opcao': case 'campos_proposta': return (r.opcoes || []).join(' · ');
    case 'norma': return `${v ?? ''} ou superior`;
    default: return '';
  }
}

export function EtapaRequisitos({ dados, executar }) {
  const { pregao, requisitos, itens, cobertura } = dados;
  // Edital por lote (ou TR com requisitos comuns de lote): uma aba por lote, com os comuns e os itens dele.
  const loteDoItem = useMemo(() => Object.fromEntries(itens.map((i) => [i.numero, String(i.lote || i.numero)])), [itens]);
  const porLote = Boolean(pregao.julgamento_por_lote_efetivo) || requisitos.some((r) => r.lote && r.item_numero == null);
  const abas = useMemo(() => {
    const tecnico = (r) => r.categoria !== 'HABILITACAO';
    const lista = [{ chave: 'geral', titulo: 'Geral', filtro: (r) => tecnico(r) && r.item_numero == null && !r.lote }];
    if (porLote) {
      const lotes = [...new Set(itens.map((i) => loteDoItem[i.numero]))].sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true }));
      for (const l of lotes) {
        const nums = itens.filter((i) => loteDoItem[i.numero] === l).map((i) => i.numero);
        lista.push({ chave: `lote_${l}`, titulo: `Lote ${l} · ${nums.length > 1 ? 'itens' : 'item'} ${nums.join(', ')}`, itensDoLote: nums,
          filtro: (r) => tecnico(r) && (String(r.lote) === l || (r.item_numero != null && loteDoItem[r.item_numero] === l)) });
      }
    } else {
      for (const i of itens) lista.push({ chave: i.numero, titulo: `Item ${i.numero} · ${i.descricao}`, filtro: (r) => tecnico(r) && r.item_numero === i.numero });
    }
    lista.push({ chave: 'habilitacao', titulo: 'Habilitação', filtro: (r) => r.categoria === 'HABILITACAO' });
    return lista.map((a) => ({ ...a, requisitos: requisitos.filter(a.filtro) }));
  }, [requisitos, itens, porLote, loteDoItem]);
  const [aba, setAba] = useState('geral');
  const atual = abas.find((a) => a.chave === aba) || abas[0];
  // Cobertura da aba de lote = comuns do lote + cada item do lote
  const cob = atual.itensDoLote
    ? [atual.chave, ...atual.itensDoLote].map((k) => cobertura[k]).filter(Boolean).reduce((s, c) => ({ linhas: s.linhas + c.linhas, cobertas: s.cobertas + c.cobertas }), { linhas: 0, cobertas: 0 })
    : cobertura[atual.chave];
  const pendentes = atual.requisitos.filter((r) => r.status_validacao === 'pendente').length;

  const secoes = useMemo(() => {
    const m = new Map();
    // Na aba de lote: primeiro os requisitos comuns do lote, depois cada item em ordem.
    const ordenados = atual.itensDoLote
      ? [...atual.requisitos].sort((a, b) => (a.item_numero == null ? 0 : 1) - (b.item_numero == null ? 0 : 1)
        || Number(a.item_numero ?? 0) - Number(b.item_numero ?? 0) || String(a.codigo).localeCompare(String(b.codigo), 'pt-BR', { numeric: true }))
      : atual.requisitos;
    for (const r of ordenados) {
      const prefixo = atual.itensDoLote ? (r.item_numero != null ? `Item ${r.item_numero} · ` : 'Comum ao lote · ') : '';
      const s = `${prefixo}${r.secao || 'Sem seção'}`;
      if (!m.has(s)) m.set(s, []); m.get(s).push(r);
    }
    return [...m.entries()];
  }, [atual]);

  const mudar = (r, status) => executar(() => api.atualizarRequisito(r.id, { status_validacao: status }));
  const [editando, setEditando] = useState(null);
  const salvarEdicao = async (patch) => {
    await api.atualizarRequisito(editando.id, patch); // erro aparece dentro do formulário
    setEditando(null);
    await executar(async () => {}, `Requisito ${editando.codigo} corrigido e validado.`);
  };
  const validarAba = () => executar(() => api.validarTodos(pregao.id, atual.chave), 'Requisitos da aba validados.');

  return (
    <section className="etapa">
      <CabecalhoEtapa numero={2} rotulo="REQUISITOS" titulo={porLote ? 'Requisitos levantados por lote' : 'Requisitos levantados por item'}
        acoes={<Botao variante="secundario" icone="check" disabled={!pendentes} onClick={validarAba}>Validar todos desta aba</Botao>} />
      <div className="abas" role="tablist">
        {abas.map((a) => (
          <button key={a.chave} type="button" role="tab" aria-selected={a.chave === atual.chave} className={a.chave === atual.chave ? 'ativa' : ''} onClick={() => setAba(a.chave)}>
            {a.chave === 'geral' && <Icone nome="info" tamanho={15} />}{a.titulo}<em>{a.requisitos.length}</em>
          </button>
        ))}
      </div>
      <div className="cartao">
        <div className="barra-aba">
          {cob ? (
            <span className={`cobertura ${cob.cobertas === cob.linhas ? 'completa' : ''}`}>
              <Icone nome={cob.cobertas === cob.linhas ? 'check' : 'alerta'} tamanho={16} />
              Cobertura do termo de referência: {cob.cobertas} de {cob.linhas} linhas
            </span>
          ) : <span className="ajuda">Requisitos lidos de texto corrido do edital e do TR.</span>}
          <span className="ajuda">{pendentes} pendente(s) de validação</span>
        </div>
        {atual.requisitos.length === 0 ? <p className="vazio-tabela">Nenhum requisito nesta aba ainda.</p> : (
          <div className="tabela-rolagem">
            <table className="tabela tabela-requisitos">
              <thead><tr><th>Código</th><th>Exigência (Edital / TR)</th><th>Tipo</th><th>Regra lida</th><th>Origem</th><th>Situação</th></tr></thead>
              {secoes.map(([secao, lista]) => (
                <tbody key={secao}>
                  <tr className="linha-secao"><th colSpan={6}>{secao}</th></tr>
                  {lista.map((r) => (
                    <tr key={r.id} className={r.status_validacao === 'rejeitado' ? 'rejeitado' : ''}>
                      <td className="codigo">{r.codigo}</td>
                      <td>{r.origem?.trecho}{r.conflito && <span className="nota-conflito"><Icone nome="alerta" tamanho={14} /> {r.conflito}</span>}</td>
                      <td>{TIPO[r.tipo] || r.tipo}</td>
                      <td>{regraLegivel(r)}</td>
                      <td><Origem fonte={r.fonte} pagina={r.origem?.pagina} /></td>
                      <td><div className="acoes-validacao">
                        <span className={`situacao situacao-${r.status_validacao}`}>{r.status_validacao}</span>
                        <button type="button" className="icone-botao" title="Editar" onClick={() => setEditando(r)}><Icone nome="revisar" titulo="Editar" /></button>
                        <button type="button" className="icone-botao" title="Validar" onClick={() => mudar(r, 'validado')}><Icone nome="check" titulo="Validar" /></button>
                        <button type="button" className="icone-botao" title="Rejeitar" onClick={() => mudar(r, 'rejeitado')}><Icone nome="x" titulo="Rejeitar" /></button>
                      </div></td>
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
          </div>
        )}
      </div>
      {editando && <EditorRequisito requisito={editando} aoSalvar={salvarEdicao} aoFechar={() => setEditando(null)} />}
    </section>
  );
}
