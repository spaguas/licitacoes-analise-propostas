import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { Aviso, Botao, Icone, dataBr } from '../componentes/Comuns.jsx';
import { EtapaDocumentos } from '../componentes/EtapaDocumentos.jsx';
import { EtapaRequisitos } from '../componentes/EtapaRequisitos.jsx';
import { EtapaPropostas } from '../componentes/EtapaPropostas.jsx';
import { EtapaResultados } from '../componentes/EtapaResultados.jsx';
import { ModalProgresso } from '../componentes/ModalProgresso.jsx';

export function Pregao({ id, setOcupado, voltar }) {
  const [dados, setDados] = useState(null);
  const [checklist, setChecklist] = useState([]);
  const [aviso, setAviso] = useState(null);
  // Acompanhamento do processamento (pop-up com a água subindo)
  const [progresso, setProgresso] = useState(null);
  const [final, setFinal] = useState(null);
  const [popupAberto, setPopupAberto] = useState(false);
  const [rastreando, setRastreando] = useState(false);
  const rastreandoRef = useRef(false);
  const acompanhar = (sim) => { rastreandoRef.current = sim; setRastreando(sim); };

  const carregar = useCallback(async () => {
    try {
      const [d, c] = await Promise.all([api.pregao(id), api.checklist(id)]);
      setDados(d); setChecklist(c);
      setOcupado(d.indicadores.tarefas_abertas > 0);
    } catch (e) { setAviso({ tipo: 'erro', texto: e.message }); }
  }, [id, setOcupado]);

  useEffect(() => { setDados(null); carregar(); }, [carregar]);
  // Enquanto houver tarefas rodando, atualiza a cada 4 segundos.
  useEffect(() => {
    if (!dados?.indicadores.tarefas_abertas) return undefined;
    const t = setInterval(carregar, 4000);
    return () => clearInterval(t);
  }, [dados, carregar]);
  useEffect(() => () => setOcupado(false), [setOcupado]);

  // Consulta o andamento. Quando o lote termina, mostra o resumo final e recarrega a página.
  const consultarProgresso = useCallback(async () => {
    try {
      const p = await api.progresso(id);
      if (p.ativo) { setProgresso(p); setFinal(null); acompanhar(true); return p; }
      if (rastreandoRef.current) {
        acompanhar(false);
        setProgresso(p);
        setFinal({ total: p.total, erros: p.erros });
        carregar();
      }
      return p;
    } catch { return null; }
  }, [id, carregar]);

  // Ao abrir a página com algo rodando, começa a acompanhar (indicador minimizado no canto).
  useEffect(() => { if (dados?.indicadores.tarefas_abertas > 0 && !rastreandoRef.current) acompanhar(true); }, [dados]);
  useEffect(() => {
    if (!rastreando) return undefined;
    consultarProgresso();
    const t = setInterval(consultarProgresso, 2000);
    return () => clearInterval(t);
  }, [rastreando, consultarProgresso]);

  const executar = async (acao, sucesso) => {
    try {
      await acao();
      if (sucesso) setAviso({ tipo: 'sucesso', texto: sucesso });
      await carregar();
      const p = await consultarProgresso();
      if (p?.ativo) setPopupAberto(true); // envio de documento, proposta ou análise: abre o pop-up
    } catch (e) { setAviso({ tipo: 'erro', texto: e.message }); }
  };

  // Barra compacta com as ações do pregão: aparece quando o cartão do pregão sai da tela (rolando para baixo).
  const cartaoRef = useRef(null);
  const [cartaoVisivel, setCartaoVisivel] = useState(true);
  const carregado = Boolean(dados);
  useEffect(() => {
    const alvo = cartaoRef.current;
    if (!alvo || typeof IntersectionObserver === 'undefined') return undefined;
    const altura = document.querySelector('.superior')?.offsetHeight ?? 70;
    document.documentElement.style.setProperty('--altura-topo', `${altura}px`); // a barra encosta logo abaixo do topo
    const obs = new IntersectionObserver(([e]) => setCartaoVisivel(e.isIntersecting), { rootMargin: `-${altura}px 0px 0px 0px`, threshold: 0 });
    obs.observe(alvo);
    return () => obs.disconnect();
  }, [carregado]);

  if (!dados) return <p className="carregando">Carregando pregão…</p>;
  const { pregao, indicadores } = dados;
  const erros = dados.tarefas.filter((t) => t.status === 'erro');
  const podeAnalisar = Boolean(indicadores.validados) && !(indicadores.tarefas_abertas > 0);
  const iniciarAnalise = () => executar(() => api.iniciarAnalise(id), 'Análise iniciada. Os resultados aparecem na Etapa 04.');
  const situacao = indicadores.tarefas_abertas ? 'Processando' : checklist.some((g) => g.linhas.length) ? 'Analisado' : 'Aguardando análise';

  return (
    <>
      <div className="pagina-cabecalho">
        <div>
          <p className="rotulo">CENTRAL DE ANÁLISE · {new Date().getFullYear()}</p>
          <h1>Avaliação de propostas</h1>
          <p className="subtitulo">Compare requisitos do edital com as entregas de cada fornecedor.</p>
        </div>
        <Botao variante="secundario" icone="atualizar" onClick={carregar}>Atualizar</Botao>
      </div>

      {aviso && <Aviso tipo={aviso.tipo} aoFechar={() => setAviso(null)}>{aviso.texto}</Aviso>}
      {erros.length > 0 && (
        <Aviso tipo="erro">
          {erros.length} etapa(s) com erro. Último: {erros[erros.length - 1].erro?.slice(0, 220)}
          {' '}<button type="button" className="link" onClick={() => executar(() => api.reprocessarErros(id), 'Etapas com erro reenviadas.')}>Tentar de novo</button>
        </Aviso>
      )}

      {!cartaoVisivel && (
        <div className="barra-pregao-fixa" role="region" aria-label="Ações do pregão">
          <div className="barra-pregao-conteudo">
            <span className="barra-pregao-nome"><Icone nome="documento" tamanho={18} /><strong>{pregao.nome}</strong>
              {pregao.numero && <small>PE {pregao.numero}</small>}</span>
            <span className={`pilula ${indicadores.tarefas_abertas ? 'pilula-ativa' : ''}`}><i aria-hidden="true" />{situacao}</span>
            <Botao icone="play" disabled={!podeAnalisar} onClick={iniciarAnalise}>Iniciar análise</Botao>
            <button type="button" className="link" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>Voltar ao topo</button>
          </div>
        </div>
      )}

      <section className="cartao projeto" ref={cartaoRef}>
        <span className="projeto-icone"><Icone nome="documento" tamanho={22} /></span>
        <div className="projeto-info">
          <p className="rotulo">PREGÃO SELECIONADO</p>
          <h2>{pregao.nome}</h2>
          <p className="meta">
            {pregao.numero ? `Pregão Eletrônico ${pregao.numero}` : 'Número a identificar'} · Processo {pregao.processo || '—'} · UASG {pregao.uasg || '—'} · {pregao.criterio || 'critério a identificar'} · criado em {dataBr(pregao.criado_em)}
          </p>
        </div>
        <span className={`pilula ${indicadores.tarefas_abertas ? 'pilula-ativa' : ''}`}><i aria-hidden="true" />{situacao}</span>
        <Botao icone="play" disabled={!podeAnalisar} onClick={iniciarAnalise}>Iniciar análise</Botao>
        <Botao variante="perigo" icone="x" onClick={async () => { if (window.confirm('Excluir este pregão e todos os dados dele?')) { await api.excluirPregao(id); voltar(); } }}>Excluir</Botao>
      </section>

      <div className="indicadores">
        <Indicador titulo="Requisitos extraídos" valor={indicadores.requisitos} legenda={`${indicadores.validados} validados`} icone="lista" />
        <Indicador titulo="Fornecedores" valor={indicadores.fornecedores} legenda="Propostas recebidas" icone="empresa" />
        <Indicador titulo="Requisitos atendidos" valor={indicadores.atendidos} legenda="Com evidência suficiente" icone="check" />
        <Indicador titulo="Pontos de atenção" valor={indicadores.pontos_de_atencao} legenda="Não atende, revisar, vago, conflitos" icone="alerta" destaque />
      </div>

      <EtapaDocumentos dados={dados} executar={executar} />
      <EtapaRequisitos dados={dados} executar={executar} />
      <EtapaPropostas dados={dados} executar={executar} />
      <EtapaResultados pregaoId={id} pregao={dados.pregao} checklist={checklist} executar={executar} />

      <ModalProgresso
        progresso={progresso}
        final={final}
        aberto={popupAberto}
        aoAbrir={() => setPopupAberto(true)}
        aoMinimizar={() => setPopupAberto(false)}
        aoFechar={() => { setPopupAberto(false); setFinal(null); setProgresso(null); }}
        aoTentarDeNovo={() => executar(() => api.reprocessarErros(id))}
      />
    </>
  );
}

function Indicador({ titulo, valor, legenda, icone, destaque }) {
  return (
    <div className={`cartao indicador ${destaque && valor ? 'indicador-destaque' : ''}`}>
      <span className="indicador-titulo">{titulo}<Icone nome={icone} /></span>
      <strong>{valor}</strong>
      <span className="indicador-legenda">{legenda}</span>
    </div>
  );
}
