// Visão completa do fornecedor: TODOS os requisitos validados do pregão, cada um com um resultado.
// Gerais, todos os itens (o que não foi ofertado aparece como NÃO OFERTADO) e habilitação.
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { Botao, Icone, SeloStatus, formatarCnpj } from './Comuns.jsx';
import { LinhaChecklist } from './EtapaResultados.jsx';
import { TextoRecusa } from './TextoRecusa.jsx';

const ORDEM = ['NÃO ATENDE', 'REVISAR', 'VAGO', 'PARCIAL', 'NÃO COMPROVADO', 'VERIFICAR EXTERNAMENTE', 'ATENDE', 'NÃO OFERTADO', 'AGUARDANDO ANÁLISE'];
const RESUMO = { 'não atende': 'erro', 'pendente de verificação': 'atencao', 'atende todos os obrigatórios': 'ok', 'aguardando análise': 'neutro' };

function Contagem({ contagem }) {
  return (
    <span className="contagem">
      {ORDEM.filter((s) => contagem[s]).map((s) => <span key={s}><SeloStatus status={s} compacto /> {contagem[s]} {s.toLowerCase()}</span>)}
    </span>
  );
}

export function VisaoCompleta({ pregaoId, versao, executar }) {
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState('');
  const [fornecedorId, setFornecedorId] = useState(null);
  const [filtro, setFiltro] = useState('');
  const [soFaltantes, setSoFaltantes] = useState(false);
  const [textoAberto, setTextoAberto] = useState(false);

  useEffect(() => { api.visaoCompleta(pregaoId).then(setDados).catch((e) => setErro(e.message)); }, [pregaoId, versao]);

  const atual = dados?.find((f) => f.proposta_id === fornecedorId) || dados?.[0];
  const linhas = useMemo(() => (atual?.linhas || []).filter((l) => (!filtro || l.status === filtro) && (!soFaltantes || l.faltante)), [atual, filtro, soFaltantes]);
  const grupos = useMemo(() => {
    const m = new Map();
    for (const l of linhas) { if (!m.has(l.grupo)) m.set(l.grupo, { nome: l.grupo_nome, linhas: [] }); m.get(l.grupo).linhas.push(l); }
    return [...m.entries()];
  }, [linhas]);

  if (erro) return <div className="cartao vazio-tabela">{erro}</div>;
  if (!dados) return <div className="cartao vazio-tabela">Carregando a visão completa…</div>;
  if (!dados.length) return <div className="cartao vazio-tabela">Nenhuma proposta extraída ainda.</div>;

  return (
    <>
      <div className="abas" role="tablist">
        {dados.map((f) => (
          <button key={f.proposta_id} type="button" role="tab" aria-selected={f === atual} className={f === atual ? 'ativa' : ''} onClick={() => setFornecedorId(f.proposta_id)}>
            {f.fornecedor?.razao_social || formatarCnpj(f.fornecedor?.cnpj)}<em>{f.total}</em>
          </button>
        ))}
      </div>

      <div className="cartao resumo-completo">
        <div className="resumo-completo-topo">
          <div>
            <p className="rotulo">{formatarCnpj(atual.fornecedor?.cnpj)}</p>
            <h3>{atual.fornecedor?.razao_social}</h3>
            <p className="ajuda">Itens ofertados: {atual.itens_ofertados.join(', ') || 'nenhum'}</p>
          </div>
          <div className="total-requisitos"><strong>{atual.total}</strong><span>requisitos conferidos</span></div>
        </div>
        <div className="resumo-e-acao">
          <span className={`resumo resumo-${RESUMO[atual.resumo] || 'neutro'}`}>Sugestão: {atual.resumo}</span>
          <Botao icone="documento" onClick={() => setTextoAberto(true)}>
            {atual.contagem['NÃO ATENDE'] ? 'Gerar texto de recusa' : 'Gerar texto de diligência / recusa'}
          </Botao>
        </div>
        <Contagem contagem={atual.contagem} />
        <div className="tabela-rolagem">
          <table className="tabela tabela-grupos">
            <thead><tr><th>Grupo</th><th>Requisitos</th><th>Resultado</th></tr></thead>
            <tbody>
              {atual.grupos.map((g) => <tr key={g.chave}><td>{g.nome}</td><td>{g.total}</td><td><Contagem contagem={g.contagem} /></td></tr>)}
              <tr className="linha-total"><td>Total</td><td>{atual.total}</td><td>{atual.faltantes} faltante(s) na proposta</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="cartao">
        <div className="barra-aba">
          <h3>Todos os requisitos · {atual.fornecedor?.razao_social}</h3>
          <div className="filtros">
            <label className="filtro">Mostrar
              <select value={filtro} onChange={(e) => setFiltro(e.target.value)}>
                <option value="">todos os status</option>
                {ORDEM.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <label className="caixa-marcar"><input type="checkbox" checked={soFaltantes} onChange={(e) => setSoFaltantes(e.target.checked)} /> só faltantes</label>
            <Botao variante="secundario" icone="baixar" onClick={() => executar(() => api.baixarVisaoCompletaCsv(pregaoId))}>Exportar (CSV)</Botao>
          </div>
        </div>
        <div className="tabela-rolagem">
          <table className="tabela checklist">
            <thead><tr><th>Exigido (Edital / TR)</th><th>Ofertado (proposta)</th><th>Status sugerido</th><th>Justificativa</th><th>Revisão</th></tr></thead>
            {grupos.map(([chave, g]) => (
              <tbody key={chave}>
                <tr className="linha-secao"><th colSpan={5}>{g.nome} · {g.linhas.length}</th></tr>
                {g.linhas.map((l) => (l.avaliacao_id
                  ? <LinhaChecklist key={l.requisito_id} linha={l} executar={executar} />
                  : (
                    <tr key={l.requisito_id} className="linha-sem-avaliacao">
                      <td><small className="codigo">{l.requisito_codigo}</small><br />{l.exigido}</td>
                      <td><span className="ajuda">—</span></td>
                      <td><SeloStatus status={l.status} /></td>
                      <td>{l.justificativa}</td>
                      <td><Icone nome="info" tamanho={16} /></td>
                    </tr>
                  )))}
              </tbody>
            ))}
          </table>
        </div>
      </div>
      {textoAberto && <TextoRecusa propostaId={atual.proposta_id} fornecedor={atual.fornecedor?.razao_social || ''} aoFechar={() => setTextoAberto(false)} />}
    </>
  );
}
