// Monitor de segurança (só administrador), no estilo do Wordfence: acessos, senhas erradas, força bruta,
// injeções, varreduras de robôs, acessos indevidos, auditoria e IPs bloqueados.
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { Aviso, Botao, Icone } from '../componentes/Comuns.jsx';

const TIPOS = [
  ['', 'Todos os tipos'], ['login_ok', 'Acesso'], ['login_falhou', 'Senha errada'], ['forca_bruta', 'Força bruta'],
  ['injecao', 'Injeção'], ['varredura', 'Varredura (robô)'], ['acesso_indevido', 'Acesso indevido'], ['acesso_negado', 'Acesso negado'],
  ['limite_excedido', 'Excesso de pedidos'], ['token_invalido', 'Sessão forjada'], ['ip_bloqueado', 'IP bloqueado'], ['auditoria', 'Auditoria'],
];
const GRAVIDADES = [['', 'Todas'], ['alta', 'Alta'], ['media', 'Média'], ['baixa', 'Baixa'], ['info', 'Informação']];
const PRAZOS = [[60, '1 hora'], [1440, '24 horas'], [10080, '7 dias'], [525600, '1 ano']];
const dataHora = (d) => new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
const ehLocal = (ip) => /^(::ffff:)?(127\.0\.0\.1|::1|172\.(1[6-9]|2\d|3[01])\.\d+\.1)$/.test(String(ip || ''));

function Indicador({ titulo, valor, gravidade, dica }) {
  return (
    <div className={`indicador-seg grav-${gravidade}`} title={dica}>
      <span>{titulo}</span><strong>{valor ?? '—'}</strong>
    </div>
  );
}

export function Seguranca() {
  const [resumo, setResumo] = useState(null);
  const [eventos, setEventos] = useState([]);
  const [filtros, setFiltros] = useState({ tipo: '', gravidade: '', ip: '' });
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [novoBloqueio, setNovoBloqueio] = useState({ ip: '', minutos: 1440, motivo: '' });

  const carregar = useCallback(async () => {
    try {
      const [r, e] = await Promise.all([api.segurancaResumo(), api.segurancaEventos(filtros)]);
      setResumo(r); setEventos(e);
    } catch (x) { setErro(x.message); }
  }, [filtros]);
  useEffect(() => { carregar(); const t = setInterval(carregar, 30000); return () => clearInterval(t); }, [carregar]);

  const fazer = async (acao, msg) => {
    setErro(''); setAviso('');
    try { await acao(); setAviso(msg); await carregar(); } catch (x) { setErro(x.message); }
  };
  const bloquear = (ip, minutos = 1440, motivo = 'bloqueado pelo painel de segurança') => {
    if (window.confirm(`Bloquear o IP ${ip}? Ninguém desse endereço conseguirá acessar o sistema.`)) fazer(() => api.bloquearIp(ip, minutos, motivo), `IP ${ip} bloqueado.`);
  };
  const h = resumo?.ultimas_24h || {};

  return (
    <>
      <div className="pagina-cabecalho">
        <div>
          <p className="rotulo">ADMINISTRAÇÃO</p>
          <h1>Segurança</h1>
          <p className="subtitulo">Acessos, tentativas de invasão e IPs bloqueados. Atualiza sozinho a cada 30 segundos.</p>
        </div>
        <div className="acoes-cabecalho">
          <span className={`pilula ${resumo?.bloqueio_automatico ? 'pilula-ok' : ''}`}><Icone nome="escudo" tamanho={16} /> Bloqueio automático {resumo?.bloqueio_automatico ? 'ligado' : 'desligado'}</span>
          <Botao variante="secundario" icone="atualizar" onClick={carregar}>Atualizar</Botao>
        </div>
      </div>
      {erro && <Aviso tipo="erro" aoFechar={() => setErro('')}>{erro}</Aviso>}
      {aviso && <Aviso tipo="sucesso" aoFechar={() => setAviso('')}>{aviso}</Aviso>}

      <p className="rotulo">ÚLTIMAS 24 HORAS</p>
      <div className="grade-indicadores-seg">
        <Indicador titulo="Acessos" valor={h.acessos} gravidade="info" dica="Logins com sucesso" />
        <Indicador titulo="Senhas erradas" valor={h.senhas_erradas} gravidade="baixa" dica="Tentativas de login que falharam" />
        <Indicador titulo="Força bruta" valor={h.forca_bruta} gravidade="alta" dica="Muitas senhas erradas seguidas" />
        <Indicador titulo="Injeções" valor={h.injecoes} gravidade="alta" dica="SQL, scripts, caminhos de arquivo ou comandos na URL ou nos campos" />
        <Indicador titulo="Varreduras" valor={h.varreduras} gravidade="alta" dica="Robôs procurando /wp-admin, /.env, /.git..." />
        <Indicador titulo="Acessos indevidos" valor={h.acessos_indevidos} gravidade="media" dica="Licitante tentando abrir pregão de outra pessoa ou área de administrador" />
      </div>

      <div className="grade-seg">
        <section className="cartao">
          <h3><Icone nome="cadeado" /> IPs bloqueados agora</h3>
          {resumo?.bloqueados?.length ? (
            <ul className="lista-pendencias">
              {resumo.bloqueados.map((b) => (
                <li key={b.id}>
                  <span><strong className="ip">{b.ip}</strong> <small className="ajuda">{b.automatico ? 'automático' : 'manual'} · até {dataHora(b.ate)}</small><br /><small>{b.motivo}</small></span>
                  <Botao pequeno variante="secundario" icone="check" onClick={() => fazer(() => api.desbloquearIp(b.id), `IP ${b.ip} desbloqueado.`)}>Desbloquear</Botao>
                </li>
              ))}
            </ul>
          ) : <p className="ajuda">Nenhum IP bloqueado.</p>}
          <form className="formulario-linha bloquear-ip" onSubmit={(e) => { e.preventDefault(); bloquear(novoBloqueio.ip.trim(), Number(novoBloqueio.minutos), novoBloqueio.motivo || 'bloqueio manual'); }}>
            <label>IP<input value={novoBloqueio.ip} onChange={(e) => setNovoBloqueio({ ...novoBloqueio, ip: e.target.value })} placeholder="ex.: 203.0.113.7" required /></label>
            <label>Por<select value={novoBloqueio.minutos} onChange={(e) => setNovoBloqueio({ ...novoBloqueio, minutos: e.target.value })}>{PRAZOS.map(([v, n]) => <option key={v} value={v}>{n}</option>)}</select></label>
            <label className="cresce">Motivo<input value={novoBloqueio.motivo} onChange={(e) => setNovoBloqueio({ ...novoBloqueio, motivo: e.target.value })} maxLength={200} /></label>
            <Botao type="submit" variante="perigo" icone="cadeado">Bloquear</Botao>
          </form>
        </section>
        <section className="cartao">
          <h3><Icone nome="alerta" /> IPs mais suspeitos (24 h)</h3>
          {resumo?.ips_mais_suspeitos?.length ? (
            <ul className="lista-pendencias">
              {resumo.ips_mais_suspeitos.map((x) => (
                <li key={x.ip}>
                  <span><strong className="ip">{x.ip}</strong> <small className="ajuda">{x.eventos} evento(s){x.local ? ' · acesso local (nunca bloqueado)' : ''}</small></span>
                  <span className="acoes-usuario">
                    <Botao pequeno variante="secundario" icone="lupa" onClick={() => setFiltros({ ...filtros, ip: x.ip })}>Ver</Botao>
                    {!x.local && <Botao pequeno variante="perigo" icone="cadeado" onClick={() => bloquear(x.ip)}>Bloquear</Botao>}
                  </span>
                </li>
              ))}
            </ul>
          ) : <p className="ajuda">Nenhuma atividade suspeita.</p>}
        </section>
      </div>

      <section className="cartao">
        <div className="barra-aba">
          <h3>Registro de eventos</h3>
          <div className="filtros">
            <label className="filtro">Tipo<select value={filtros.tipo} onChange={(e) => setFiltros({ ...filtros, tipo: e.target.value })}>{TIPOS.map(([v, n]) => <option key={v} value={v}>{n}</option>)}</select></label>
            <label className="filtro">Gravidade<select value={filtros.gravidade} onChange={(e) => setFiltros({ ...filtros, gravidade: e.target.value })}>{GRAVIDADES.map(([v, n]) => <option key={v} value={v}>{n}</option>)}</select></label>
            <label className="filtro">IP<input value={filtros.ip} onChange={(e) => setFiltros({ ...filtros, ip: e.target.value })} placeholder="filtrar" /></label>
            <Botao variante="secundario" icone="baixar" onClick={() => fazer(() => api.baixarEventosCsv(), 'Planilha baixada.')}>Exportar (CSV)</Botao>
          </div>
        </div>
        <div className="tabela-rolagem">
          <table className="tabela tabela-eventos">
            <thead><tr><th>Quando</th><th>Tipo</th><th>IP</th><th>Usuário / e-mail</th><th>Detalhe</th><th /></tr></thead>
            <tbody>
              {eventos.length ? eventos.map((e) => (
                <tr key={e.id} className={`linha-grav-${e.gravidade}`}>
                  <td className="nowrap">{dataHora(e.criado_em)}</td>
                  <td><span className={`etiqueta-evento grav-${e.gravidade}`}>{e.tipo_nome}</span></td>
                  <td className="ip">{e.ip || '—'}{ehLocal(e.ip) && <small className="ajuda"> (local)</small>}</td>
                  <td>{e.email || '—'}</td>
                  <td className="detalhe-evento">{e.detalhe}{e.caminho && <small className="codigo"><br />{e.metodo} {e.caminho}</small>}</td>
                  <td>{e.ip && !ehLocal(e.ip) && e.gravidade !== 'info' && e.tipo !== 'ip_bloqueado' && (
                    <button type="button" className="icone-botao" title={`Bloquear ${e.ip}`} onClick={() => bloquear(e.ip)}><Icone nome="cadeado" titulo="Bloquear IP" /></button>
                  )}</td>
                </tr>
              )) : <tr><td colSpan={6} className="vazio-tabela">Nenhum evento com esses filtros.</td></tr>}
            </tbody>
          </table>
        </div>
        <p className="ajuda">Senhas nunca são gravadas: quando há tentativa de injeção no campo de senha, o registro mostra só o tipo do ataque. Eventos ficam guardados por 90 dias.</p>
      </section>
    </>
  );
}
