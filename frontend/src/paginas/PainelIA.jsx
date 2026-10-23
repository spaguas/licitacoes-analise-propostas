import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Aviso, Botao } from '../componentes/Comuns.jsx';

// A descrição de cada frente vem do servidor: o modelo que de fato respondeu + a configuração do .env.
const listaPt = (l) => (l.length <= 1 ? l.join('') : `${l.slice(0, -1).join(', ')} e ${l.at(-1)}`);

export function PainelIA() {
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState('');
  const carregar = () => api.painelIA().then(setDados).catch((e) => setErro(e.message));
  useEffect(() => { carregar(); }, []);

  return (
    <>
      <div className="pagina-cabecalho">
        <div>
          <p className="rotulo">GESTÃO DAS IAS · NEW API</p>
          <h1>Uso das IAs</h1>
          <p className="subtitulo">
            Chamadas, tempo e falhas por frente.{' '}
            {dados?.pagas?.length ? `O custo em dinheiro existe na${dados.pagas.length > 1 ? 's frentes' : ''} ${listaPt(dados.pagas)}` : 'Nenhuma frente paga em uso'}; confira também os logs do New API.
          </p>
        </div>
        <Botao variante="secundario" icone="atualizar" onClick={carregar}>Atualizar</Botao>
      </div>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <div className="indicadores">
        {['ia-leve', 'ia-media', 'ia-forte'].map((alias) => {
          const p = dados?.por_alias.find((x) => x.alias === alias) || { chamadas: 0, ok: 0, erros: 0, invalidas: 0, tokens: 0, latencia_media_ms: 0, hoje: 0 };
          const f = dados?.frentes?.find((x) => x.alias === alias);
          return (
            <div className="cartao indicador" key={alias}>
              <span className="indicador-titulo">{alias}</span>
              <strong>{p.chamadas}</strong>
              <span className="indicador-legenda">{f?.descricao || '—'}</span>
              {f?.modelo && <span className="indicador-legenda">Respondendo: <code>{f.modelo}</code>{f.nuvem ? ' · nuvem' : ' · local'}</span>}
              <span className="indicador-legenda">{p.ok} ok · {p.invalidas} inválidas · {p.erros} erros · {p.hoje || 0} hoje</span>
              <span className="indicador-legenda">{p.tokens.toLocaleString('pt-BR')} tokens · {(p.latencia_media_ms / 1000).toFixed(1)} s em média</span>
            </div>
          );
        })}
      </div>
      <div className="cartao">
        <h3>Últimas chamadas</h3>
        <div className="tabela-rolagem">
          <table className="tabela">
            <thead><tr><th>Quando</th><th>Tarefa</th><th>Alias</th><th>Modelo</th><th>Tokens</th><th>Tempo</th><th>Situação</th></tr></thead>
            <tbody>
              {(dados?.ultimas || []).map((e) => (
                <tr key={e.id}>
                  <td>{new Date(e.criado_em).toLocaleString('pt-BR')}</td><td>{e.tarefa}</td><td>{e.alias}</td><td>{e.modelo || '—'}</td>
                  <td>{e.tokens ?? '—'}</td><td>{e.latencia_ms ? `${(e.latencia_ms / 1000).toFixed(1)} s` : '—'}</td>
                  <td><span className={`situacao situacao-${e.status}`} title={e.erro || ''}>{e.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
