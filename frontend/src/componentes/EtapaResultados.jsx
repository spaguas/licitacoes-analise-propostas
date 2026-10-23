import { useMemo, useState } from 'react';
import { api } from '../api.js';
import { Botao, CabecalhoEtapa, Icone, LISTA_STATUS, Origem, SeloStatus, formatarCnpj, moeda } from './Comuns.jsx';
import { VisaoCompleta } from './VisaoCompleta.jsx';

const RESUMO = { 'não atende': 'erro', 'pendente de verificação': 'atencao', 'atende todos os obrigatórios': 'ok', 'aguardando análise': 'neutro' };

export function EtapaResultados({ pregaoId, pregao, checklist, executar }) {
  const itens = useMemo(() => [...new Set(checklist.map((g) => g.item))], [checklist]);
  const [item, setItem] = useState(null);
  const itemAtual = item ?? itens[0];
  const grupos = checklist.filter((g) => g.item === itemAtual);
  const [grupoId, setGrupoId] = useState(null);
  const grupo = grupos.find((g) => g.item_proposta_id === grupoId) || grupos[0];
  const [filtro, setFiltro] = useState('');
  const [modo, setModo] = useState('completa');

  const rigoroso = Boolean(pregao?.ausencia_reprova_efetiva);
  const criterio = (
    <div className="criterio-ausencia">
      <label className="chave">
        <input type="checkbox" role="switch" checked={rigoroso}
          onChange={(e) => executar(() => api.criterioAusencia(pregaoId, e.target.checked),
            'Critério alterado. Clique em "Recalcular agora" para aplicar às propostas já analisadas.')} />
        <span className="chave-trilho" aria-hidden="true"><i /></span>
        <span><strong>Informação ausente na proposta = NÃO ATENDE</strong>
          <small>{rigoroso
            ? 'Ligado: o que a proposta não informa entra como NÃO ATENDE (faltante).'
            : 'Desligado: o que a proposta não informa entra como NÃO COMPROVADO (cabe diligência).'}</small></span>
      </label>
      <label className="julgamento">Julgamento
        <select value={pregao?.julgamento_por_lote == null ? 'auto' : pregao.julgamento_por_lote ? 'lote' : 'item'}
          onChange={(e) => executar(() => api.julgamento(pregaoId, e.target.value === 'auto' ? null : e.target.value === 'lote'), 'Critério de julgamento atualizado.')}>
          <option value="auto">Automático pelo edital → {pregao?.julgamento_por_lote_detectado ? 'por lote' : 'por item'}</option>
          <option value="item">Por item</option>
          <option value="lote">Por lote (ofertar todos os itens do lote)</option>
        </select>
        {pregao?.julgamento_evidencia
          ? <small className="prova-julgamento">Encontrado no {pregao.julgamento_evidencia.documento === 'edital' ? 'Edital' : 'TR'}, p. {pregao.julgamento_evidencia.pagina}: “{pregao.julgamento_evidencia.trecho}”</small>
          : <small className="prova-julgamento aviso-julgamento">Critério de julgamento não encontrado no edital nem no TR. Confira e escolha manualmente.</small>}
      </label>
      {checklist.length > 0 && <Botao variante="secundario" icone="atualizar" onClick={() => executar(() => api.iniciarAnalise(pregaoId))}>Recalcular agora</Botao>}
    </div>
  );

  if (!checklist.length) {
    return (
      <section className="etapa">
        <CabecalhoEtapa numero={4} rotulo="RESULTADOS" titulo="Checklist por fornecedor" />
        {criterio}
        <div className="cartao vazio-tabela">Envie as propostas, valide os requisitos e clique em “Iniciar análise”.</div>
      </section>
    );
  }

  const linhasMatriz = [...new Map(grupos.flatMap((g) => g.linhas.map((l) => [l.requisito_codigo, l]))).values()];
  const linhas = (grupo?.linhas || []).filter((l) => !filtro || l.status === filtro);

  return (
    <section className="etapa">
      <CabecalhoEtapa numero={4} rotulo="RESULTADOS" titulo="Checklist por fornecedor"
        acoes={<>
          <Botao variante="secundario" icone="baixar" onClick={() => executar(() => api.baixarCsv(pregaoId))}>Exportar planilha (CSV)</Botao>
          <Botao variante="secundario" icone="baixar" onClick={() => executar(() => api.baixarTreino())}>Exemplos de treino</Botao>
        </>} />
      {criterio}
      <div className="alternar-visao" role="tablist" aria-label="Tipo de visão">
        <button type="button" role="tab" aria-selected={modo === 'completa'} className={modo === 'completa' ? 'ativa' : ''} onClick={() => setModo('completa')}>
          Visão completa do fornecedor (todos os requisitos)
        </button>
        <button type="button" role="tab" aria-selected={modo === 'item'} className={modo === 'item' ? 'ativa' : ''} onClick={() => setModo('item')}>
          Por item
        </button>
      </div>
      {modo === 'completa' ? <VisaoCompleta pregaoId={pregaoId} versao={checklist} executar={executar} /> : (<>
      <div className="abas" role="tablist">
        {itens.map((i) => (
          <button key={i} type="button" role="tab" aria-selected={i === itemAtual} className={i === itemAtual ? 'ativa' : ''} onClick={() => { setItem(i); setGrupoId(null); }}>
            Item {i} · {checklist.find((g) => g.item === i)?.descricao_item || ''}
          </button>
        ))}
      </div>

      <div className="grade-fornecedores">
        {grupos.map((g) => (
          <button type="button" key={g.item_proposta_id} className={`cartao fornecedor ${g === grupo ? 'selecionado' : ''}`} onClick={() => setGrupoId(g.item_proposta_id)}>
            <span className="rotulo">{formatarCnpj(g.fornecedor?.cnpj)}</span>
            <strong>{g.fornecedor?.razao_social || 'Fornecedor'}</strong>
            <span className="depara-item">
              <span><small>Item do TR</small>{g.item_encontrado_no_tr ? `${g.item} · ${g.descricao_item}${g.quantidade_tr ? ` (${g.quantidade_tr} un.)` : ''}` : `“${g.item}” — não encontrado no TR`}</span>
              <span aria-hidden="true">⇄</span>
              <span><small>Ofertado</small>{g.marca || 'marca não informada'} · {g.modelo || 'modelo não informado'}{g.quantidade_ofertada ? ` (${g.quantidade_ofertada} un.)` : ''} · {moeda(g.valor_unitario)}</span>
            </span>
            {g.quantidade_tr && g.quantidade_ofertada && Number(g.quantidade_tr) !== Number(g.quantidade_ofertada) && (
              <span className="aviso-qtd"><Icone nome="alerta" tamanho={14} /> Quantidade ofertada ({g.quantidade_ofertada}) diferente do TR ({g.quantidade_tr})</span>
            )}
            <span className={`resumo resumo-${RESUMO[g.resumo] || 'neutro'}`}>Sugestão: {g.resumo}</span>
            {g.linhas.length > 0 && (
              <span className="aplicaveis">
                {g.linhas.length} requisitos aplicados: {g.aplicaveis?.gerais ?? 0} gerais + {g.aplicaveis?.do_item ?? 0} do item {g.item}
                {g.faltantes ? ` · ${g.faltantes} faltante(s) na proposta` : ''}
              </span>
            )}
            <span className="contagem">{Object.entries(g.contagem).map(([s, n]) => <span key={s}><SeloStatus status={s} compacto /> {n} {s.toLowerCase()}</span>)}</span>
          </button>
        ))}
      </div>

      {grupo?.alertas_preco?.length > 0 && (
        <div className="aviso aviso-atencao"><Icone nome="alerta" /><div>
          Preço ofertado {moeda(grupo.valor_unitario)} acima da estimativa: {grupo.alertas_preco.map((a) => `${moeda(a.valor)} (+${a.percentual}% · ${a.fonte})`).join('; ')}.
          {grupo.estimativas.length > 1 && ' Há mais de uma estimativa para este item: confira o conflito na Etapa 01.'}
        </div></div>
      )}

      {grupos.length > 1 && (
        <div className="cartao">
          <h3>Matriz requisito × fornecedor</h3>
          <div className="tabela-rolagem">
            <table className="tabela matriz">
              <thead><tr><th>Requisito</th>{grupos.map((g) => <th key={g.item_proposta_id}>{g.fornecedor?.razao_social}</th>)}</tr></thead>
              <tbody>
                {linhasMatriz.map((l) => (
                  <tr key={l.requisito_codigo}>
                    <td>{l.exigido}</td>
                    {grupos.map((g) => <td key={g.item_proposta_id}><SeloStatus status={g.linhas.find((x) => x.requisito_codigo === l.requisito_codigo)?.status} compacto /></td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {grupo && (
        <div className="cartao">
          <div className="barra-aba">
            <h3>Checklist · {grupo.fornecedor?.razao_social}</h3>
            <label className="filtro">Mostrar
              <select value={filtro} onChange={(e) => setFiltro(e.target.value)}>
                <option value="">todos os status</option>
                {LISTA_STATUS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
          </div>
          <div className="tabela-rolagem">
            <table className="tabela checklist">
              <thead><tr><th>Exigido (Edital / TR)</th><th>Ofertado (proposta)</th><th>Status sugerido</th><th>Justificativa</th><th>Revisão</th></tr></thead>
              <tbody>
                {linhas.map((l) => <LinhaChecklist key={l.avaliacao_id} linha={l} executar={executar} />)}
              </tbody>
            </table>
          </div>
        </div>
      )}
      </>)}
    </section>
  );
}

export function LinhaChecklist({ linha, executar }) {
  const [editando, setEditando] = useState(false);
  const [status, setStatus] = useState(linha.status);
  const [parecer, setParecer] = useState(linha.revisao_parecer || '');
  const salvar = () => executar(async () => { await api.revisar(linha.avaliacao_id, status, parecer); setEditando(false); }, 'Revisão registrada.');
  return (
    <tr>
      <td><small className="codigo">{linha.requisito_codigo}</small> <Origem fonte={linha.fonte} pagina={linha.pagina_edital} /><br />{linha.exigido}</td>
      <td>{linha.ofertado ? <><span className="trecho">“{linha.ofertado}”</span><br /><small>p. {linha.pagina_proposta ?? '—'}</small></> : <span className="ajuda">Não encontrado na proposta</span>}</td>
      <td><SeloStatus status={linha.status} />{linha.faltante && <span className="etiqueta-faltante">faltante</span>}<br /><small className="metodo">{linha.metodo === 'regra' ? 'regra' : `IA${linha.aliases?.length ? ` (${linha.aliases.join(' + ')})` : ''}`}</small></td>
      <td>{linha.justificativa}</td>
      <td className="revisao">
        {editando ? (
          <div className="revisao-form">
            <select value={status} onChange={(e) => setStatus(e.target.value)}>{LISTA_STATUS.map((s) => <option key={s}>{s}</option>)}</select>
            <textarea rows={2} value={parecer} onChange={(e) => setParecer(e.target.value)} placeholder="Parecer (opcional)" />
            <div><Botao icone="check" onClick={salvar}>Salvar</Botao><Botao variante="secundario" onClick={() => setEditando(false)}>Cancelar</Botao></div>
          </div>
        ) : (
          <>
            <span className={`situacao situacao-${linha.revisao_status || 'pendente'}`}>{linha.revisao_status || 'pendente'}</span>
            {linha.revisao_parecer && <small className="parecer">{linha.revisao_parecer}</small>}
            <button type="button" className="link" onClick={() => setEditando(true)}>Revisar</button>
          </>
        )}
      </td>
    </tr>
  );
}
