import { useState } from 'react';
import { api } from '../api.js';
import { AreaEnvio, Aviso, CabecalhoEtapa, Icone, formatarCnpj, moeda } from './Comuns.jsx';

export function EtapaPropostas({ dados, executar }) {
  const { pregao, propostas } = dados;
  const [cnpj, setCnpj] = useState('');
  const [razao, setRazao] = useState('');
  const [erro, setErro] = useState('');
  const [aberta, setAberta] = useState(null);
  const [specs, setSpecs] = useState([]);

  const enviar = ([arquivo]) => {
    if (cnpj.replace(/\W/g, '').length !== 14) { setErro('Informe o CNPJ da empresa antes de selecionar o PDF.'); return; }
    setErro('');
    executar(async () => { await api.enviarProposta(pregao.id, { cnpj, razao_social: razao, arquivo }); setCnpj(''); setRazao(''); }, 'Proposta enviada. A extração começou.');
  };
  const abrir = async (p) => {
    if (aberta === p.id) { setAberta(null); return; }
    setAberta(p.id); setSpecs(await api.especificacoes(p.id));
  };

  return (
    <section className="etapa">
      <CabecalhoEtapa numero={3} rotulo="PROPOSTAS" titulo="Propostas dos fornecedores" />
      <div className="cartao">
        <div className="formulario-linha">
          <label>CNPJ<input value={cnpj} onChange={(e) => setCnpj(e.target.value)} placeholder="00.000.000/0000-00" /></label>
          <label className="cresce">Razão social<input value={razao} onChange={(e) => setRazao(e.target.value)} placeholder="Nome da empresa" /></label>
        </div>
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <AreaEnvio titulo="Proposta e catálogos (PDF)" descricao="Dados pessoais são mascarados antes de qualquer envio à nuvem. A IA gratuita nunca recebe propostas." aoSelecionar={enviar} />
      </div>

      {propostas.length > 0 && (
        <div className="cartao">
          <div className="tabela-rolagem">
            <table className="tabela">
              <thead><tr><th>Fornecedor</th><th>CNPJ</th><th>Itens</th><th>Garantia</th><th>Entrega</th><th>Validade</th><th>Situação</th><th /></tr></thead>
              <tbody>
                {propostas.map((p) => (
                  <tr key={p.id}>
                    <td>{p.fornecedor?.razao_social || '—'}</td>
                    <td>{formatarCnpj(p.fornecedor?.cnpj)}</td>
                    <td>
                      {p.itens.map((i) => `Item ${i.item_numero} (${moeda(i.valor_unitario)})`).join(' · ') || '—'}
                      {(p.lotes || []).map((l) => (l.faltam.length
                        ? <span key={l.lote} className="lote-proposta incompleto"><Icone nome="alerta" tamanho={14} /> Lote {l.lote} incompleto: falta(m) o(s) item(ns) {l.faltam.join(', ')}</span>
                        : <span key={l.lote} className="lote-proposta completo"><Icone nome="check" tamanho={14} /> Lote {l.lote} completo ({l.itens_do_lote.length} {l.itens_do_lote.length > 1 ? 'itens' : 'item'})</span>))}
                    </td>
                    <td>{p.garantia_meses ? `${p.garantia_meses} meses` : '—'}</td>
                    <td>{p.prazo_entrega_dias ? `${p.prazo_entrega_dias} dias` : '—'}</td>
                    <td>{p.validade_dias ? `${p.validade_dias} dias` : '—'}</td>
                    <td><span className={`situacao situacao-${p.status}`}>{p.status === 'extraida' ? 'Extraída' : 'Na fila'}</span></td>
                    <td><button type="button" className="link" onClick={() => abrir(p)}>{aberta === p.id ? 'Fechar' : 'Ver extração'}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {propostas.some((p) => p.referencias_externas?.length) && (
            <Aviso tipo="info">
              Referências externas encontradas (não são o preço ofertado):{' '}
              {propostas.flatMap((p) => p.referencias_externas || []).map((r) => r.descricao || r.trecho).join(' · ')}
            </Aviso>
          )}
        </div>
      )}

      {aberta && specs.map((ip) => (
        <div className="cartao" key={ip.id}>
          <h3>Item {ip.item_numero} · {ip.marca || 'marca não informada'} · {ip.modelo || 'modelo não informado'}</h3>
          <p className="ajuda">Fabricante: {ip.fabricante || 'não informado'} · Quantidade: {ip.quantidade ?? '—'} · Valor unitário: {moeda(ip.valor_unitario)}</p>
          <div className="tabela-rolagem">
            <table className="tabela">
              <thead><tr><th>Seção</th><th>Informação</th><th>Valor</th><th>Trecho da proposta</th><th>Pág.</th><th>Alertas</th></tr></thead>
              <tbody>
                {ip.especificacoes.map((e) => (
                  <tr key={e.id}>
                    <td>{e.secao_declarada}</td><td>{e.atributo_declarado?.replace(/_/g, ' ')}</td>
                    <td>{typeof e.valor === 'boolean' ? (e.valor ? 'Sim' : 'Não') : `${e.valor ?? '—'} ${e.unidade ?? ''}`}</td>
                    <td className="trecho">“{e.origem?.trecho}”</td><td>{e.origem?.pagina ?? '—'}</td>
                    <td><div className="alertas">
                      {e.vago && <span className="selo selo-atencao"><Icone nome="alerta" tamanho={14} />Vago</span>}
                      {e.alternativas && <span className="selo selo-revisar"><Icone nome="revisar" tamanho={14} />Alternativas</span>}
                      {e.contradiz && <span className="selo selo-revisar" title={e.contradiz}><Icone nome="revisar" tamanho={14} />Contradição</span>}
                      {e.negado && <span className="selo selo-erro"><Icone nome="x" tamanho={14} />Negado</span>}
                      {e.identificador_modelo && <span className="selo selo-externo"><Icone nome="lupa" tamanho={14} />Modelo</span>}
                    </div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </section>
  );
}
