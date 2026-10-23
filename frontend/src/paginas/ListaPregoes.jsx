import { useState } from 'react';
import { api } from '../api.js';
import { Aviso, Botao, Icone, dataBr, moeda } from '../componentes/Comuns.jsx';

export function ListaPregoes({ pregoes, abrir, recarregar, criando, setCriando, admin }) {
  const [nome, setNome] = useState('');
  const [erro, setErro] = useState('');

  async function criar(e) {
    e.preventDefault();
    try { const p = await api.criarPregao(nome); setNome(''); setCriando(false); await recarregar(); abrir(p.id); } catch (x) { setErro(x.message); }
  }

  return (
    <>
      <div className="pagina-cabecalho">
        <div>
          <p className="rotulo">CENTRAL DE ANÁLISE · {new Date().getFullYear()}</p>
          <h1>Pregões</h1>
          <p className="subtitulo">Crie um pregão, envie o edital e as propostas, e acompanhe o checklist de cada fornecedor.</p>
        </div>
        <Botao icone="mais" onClick={() => setCriando(true)}>Novo pregão</Botao>
      </div>
      {erro && <Aviso tipo="erro" aoFechar={() => setErro('')}>{erro}</Aviso>}
      {criando && (
        <form className="cartao formulario-linha" onSubmit={criar}>
          <label className="cresce">Nome do pregão
            <input autoFocus value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Pregão 54/2026 – computadores e notebooks" required />
          </label>
          <Botao type="submit" icone="check">Criar</Botao>
          <Botao variante="secundario" onClick={() => setCriando(false)}>Cancelar</Botao>
        </form>
      )}
      {pregoes.length === 0 && !criando ? (
        <section className="cartao boas-vindas">
          <Icone nome="documento" tamanho={28} />
          <p className="rotulo">SEU PRÓXIMO PROCESSO COMEÇA AQUI</p>
          <h2>Organize a análise.<br /><em>Decida com evidências.</em></h2>
          <p>Envie o edital e o termo de referência: o sistema separa os anexos, lê os itens e lista os requisitos de cada um.</p>
          <Botao icone="mais" onClick={() => setCriando(true)}>Criar primeiro pregão</Botao>
          <div className="faixa-ondas" aria-hidden="true" />
        </section>
      ) : (
        <div className="grade-cartoes">
          {pregoes.map((p) => (
            <button type="button" key={p.id} className="cartao cartao-pregao" onClick={() => abrir(p.id)}>
              <span className="rotulo">{p.numero ? `PREGÃO ELETRÔNICO ${p.numero}` : 'AGUARDANDO EDITAL'}</span>
              <strong>{p.nome}</strong>
              <span>{p.orgao || 'Órgão a identificar'}</span>
              <span className="detalhes">{admin && p.criado_por_nome && <span>Criado por {p.criado_por_nome}</span>}<span>Processo {p.processo || '—'}</span><span>{moeda(p.valor_total)}</span><span>Criado em {dataBr(p.criado_em)}</span></span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}
