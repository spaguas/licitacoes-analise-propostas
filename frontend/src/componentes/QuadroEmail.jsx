// Situação do envio de e-mails (tela Usuários, só administrador): ativo ou não, últimos envios com o erro
// explicado e botão para mandar um e-mail de teste — sem precisar abrir o terminal.
import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Aviso, Botao, Icone } from './Comuns.jsx';

const hora = (d) => new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

export function QuadroEmail() {
  const [s, setS] = useState(null);
  const [para, setPara] = useState('');
  const [msg, setMsg] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const carregar = () => api.situacaoEmail().then((x) => { setS(x); setPara((p) => p || x.avisos_para || ''); }).catch(() => {});
  useEffect(() => { carregar(); }, []);

  async function testar(e) {
    e.preventDefault();
    setMsg(null); setEnviando(true);
    try { setMsg({ tipo: 'sucesso', texto: (await api.testarEmail(para)).mensagem }); } catch (x) { setMsg({ tipo: 'erro', texto: x.message }); }
    setEnviando(false); carregar();
  }
  if (!s) return null;

  return (
    <section className="cartao quadro-email">
      <div className="quadro-email-topo">
        <h3><Icone nome="envio" /> E-mail do sistema</h3>
        <span className={`situacao situacao-${s.ativo ? 'validado' : 'rejeitado'}`}>{s.ativo ? 'ativo' : 'não configurado'}</span>
      </div>
      {s.ativo ? (
        <p className="ajuda">Envia de <strong>{s.remetente}</strong> por <code>{s.servidor}</code>. Avisos de cadastro vão para <strong>{s.avisos_para || '— (EMAIL_AVISOS_ADMIN vazio no .env)'}</strong>.</p>
      ) : (
        <p className="ajuda">Sem e-mail, os pedidos de cadastro e de senha aparecem só aqui na tela. Para ativar, rode na pasta do projeto: <code>powershell -ExecutionPolicy Bypass -File .\configurar-email.ps1</code></p>
      )}
      {s.ativo && !s.avisos_para && <Aviso tipo="erro">O e-mail que recebe os avisos (EMAIL_AVISOS_ADMIN) está vazio no .env: os avisos de cadastro não têm para quem ir.</Aviso>}
      {msg && <Aviso tipo={msg.tipo} aoFechar={() => setMsg(null)}>{msg.texto}</Aviso>}
      {s.ativo && (
        <form className="formulario-linha" onSubmit={testar}>
          <label className="cresce">Enviar teste para<input type="email" value={para} onChange={(e) => setPara(e.target.value)} required /></label>
          <Botao type="submit" variante="secundario" icone="envio" disabled={enviando}>{enviando ? 'Enviando…' : 'Enviar e-mail de teste'}</Botao>
        </form>
      )}
      {s.ultimos?.length > 0 && (
        <>
          <p className="rotulo">ÚLTIMOS ENVIOS (desde que a API foi ligada)</p>
          <ul className="lista-envios">
            {s.ultimos.slice(0, 6).map((u, i) => (
              <li key={i} className={u.ok ? 'envio-ok' : 'envio-falhou'}>
                <span className="envio-icone">{u.ok ? <Icone nome="check" tamanho={14} /> : <Icone nome="x" tamanho={14} />}</span>
                <span><strong>{u.assunto}</strong> → {u.para} <small className="ajuda">· {hora(u.em)}</small>
                  {!u.ok && <><br /><small className="envio-erro">{u.erro}</small></>}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
