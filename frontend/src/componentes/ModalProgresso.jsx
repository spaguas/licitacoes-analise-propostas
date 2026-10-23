// Pop-up de acompanhamento do processamento (estilo "SweetAlert"), com um círculo enchendo de água
// até o percentual e o logo da SP Águas. Pode ser minimizado para um indicador no canto da tela.
import { useEffect, useRef, useState } from 'react';
import { Botao, Icone } from './Comuns.jsx';

function CirculoAgua({ percentual, tamanho = 190, comLogo = true }) {
  const [semLogo, setSemLogo] = useState(false);
  const nivel = 200 - (Math.max(0, Math.min(100, percentual)) / 100) * 200; // 200 = vazio, 0 = cheio
  const id = useRef(`agua-${Math.random().toString(36).slice(2)}`).current;
  return (
    <div className="agua" style={{ width: tamanho, height: tamanho }}>
      <svg viewBox="0 0 200 200" aria-hidden="true">
        <defs>
          <clipPath id={id}><circle cx="100" cy="100" r="92" /></clipPath>
          <linearGradient id={`${id}-g`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#4cc3e6" />
            <stop offset="1" stopColor="#136f8f" />
          </linearGradient>
        </defs>
        <circle cx="100" cy="100" r="97" className="agua-borda" />
        <g clipPath={`url(#${id})`}>
          <rect x="0" y="0" width="200" height="200" className="agua-vazio" />
          <g className="agua-nivel" style={{ transform: `translateY(${nivel}px)` }}>
            <path className="agua-onda agua-onda-tras" d="M0 8 Q25 0 50 8 T100 8 T150 8 T200 8 T250 8 T300 8 T350 8 T400 8 V230 H0 Z" />
            <path className="agua-onda agua-onda-frente" fill={`url(#${id}-g)`} d="M0 10 Q25 2 50 10 T100 10 T150 10 T200 10 T250 10 T300 10 T350 10 T400 10 V230 H0 Z" />
          </g>
        </g>
      </svg>
      {comLogo && (
        <div className="agua-centro">
          {semLogo
            ? <span className="agua-logo-texto">SP Águas</span>
            : <img src="/logo-spaguas-cor.png" alt="" className="agua-logo" onError={() => setSemLogo(true)} />}
          <strong className="agua-percentual">{Math.round(percentual)}%</strong>
        </div>
      )}
    </div>
  );
}

function IconeStatus({ status }) {
  if (status === 'concluida') return <span className="tarefa-icone ok"><Icone nome="check" tamanho={15} /></span>;
  if (status === 'erro') return <span className="tarefa-icone erro"><Icone nome="x" tamanho={15} /></span>;
  if (status === 'executando') return <span className="tarefa-icone rodando" aria-label="em andamento" />;
  return <span className="tarefa-icone fila" aria-label="na fila" />;
}

export function ModalProgresso({ progresso, final, aberto, aoMinimizar, aoAbrir, aoFechar, aoTentarDeNovo }) {
  // O percentual mostrado nunca volta dentro do mesmo lote.
  const maximo = useRef({ inicio: null, valor: 0 });
  if (progresso?.inicio !== maximo.current.inicio) maximo.current = { inicio: progresso?.inicio, valor: 0 };
  const bruto = final ? 100 : progresso?.percentual ?? 0;
  maximo.current.valor = Math.max(maximo.current.valor, bruto);
  const percentual = maximo.current.valor;

  const caixa = useRef(null);
  useEffect(() => { if (aberto) caixa.current?.focus(); }, [aberto]);

  if (!progresso && !final) return null;
  const tarefas = progresso?.tarefas || [];
  const atual = tarefas.find((t) => t.status === 'executando');

  if (!aberto) {
    return (
      <button type="button" className="progresso-mini" onClick={aoAbrir} title="Abrir acompanhamento">
        <CirculoAgua percentual={percentual} tamanho={46} comLogo={false} />
        <span><strong>{final ? 'Concluído' : `${Math.round(percentual)}%`}</strong><small>{final ? 'ver resumo' : 'processando…'}</small></span>
      </button>
    );
  }

  return (
    <div className="progresso-fundo" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget && !final) aoMinimizar(); }}>
      <div className="progresso-caixa" role="dialog" aria-modal="true" aria-labelledby="progresso-titulo" tabIndex={-1} ref={caixa}
        onKeyDown={(e) => { if (e.key === 'Escape') (final ? aoFechar : aoMinimizar)(); }}>
        <CirculoAgua percentual={percentual} />
        <h2 id="progresso-titulo">{final ? (final.erros ? 'Processamento concluído com avisos' : 'Processamento concluído') : 'Processando documentos'}</h2>
        <p className="progresso-mensagem" aria-live="polite">
          {final
            ? (final.erros ? `${final.erros} etapa(s) com erro de ${final.total}. Você pode tentar de novo.` : `${final.total} etapa(s) concluídas.`)
            : atual ? `${atual.titulo}: ${atual.mensagem || 'em andamento'}` : 'Aguardando a próxima etapa…'}
        </p>
        {!final && (
          <p className="progresso-contagem">{progresso.concluidas} de {progresso.total} etapas concluídas{progresso.erros ? ` · ${progresso.erros} com erro` : ''}</p>
        )}
        {tarefas.length > 0 && (
          <ul className="progresso-lista">
            {tarefas.map((t) => (
              <li key={t.id} className={`tarefa tarefa-${t.status}`}>
                <IconeStatus status={t.status} />
                <div className="tarefa-texto">
                  <span className="tarefa-titulo">{t.titulo}</span>
                  <span className="tarefa-detalhe" title={t.erro || ''}>{t.status === 'erro' ? t.erro || 'Erro' : t.mensagem}</span>
                  {t.status === 'executando' && <span className="tarefa-barra"><i style={{ width: `${t.percentual}%` }} /></span>}
                </div>
                <span className="tarefa-pct">{t.status === 'pendente' ? '' : `${t.percentual}%`}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="progresso-acoes">
          {final ? (
            <>
              {final.erros > 0 && <Botao variante="secundario" icone="atualizar" onClick={aoTentarDeNovo}>Tentar de novo</Botao>}
              <Botao icone="check" onClick={aoFechar}>Fechar</Botao>
            </>
          ) : (
            <Botao variante="secundario" icone="baixar" onClick={aoMinimizar}>Acompanhar em segundo plano</Botao>
          )}
        </div>
      </div>
    </div>
  );
}
