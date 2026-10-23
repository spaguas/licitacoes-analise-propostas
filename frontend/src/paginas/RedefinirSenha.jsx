// Criar nova senha pelo link recebido por e-mail ("Esqueceu a senha?"). O link vale 30 minutos e é de uso único.
import { useState } from 'react';
import { api } from '../api.js';
import { Aviso, Botao, CampoSenha } from '../componentes/Comuns.jsx';

export function RedefinirSenha({ token, irParaLogin }) {
  const [nova, setNova] = useState('');
  const [confirma, setConfirma] = useState('');
  const [erro, setErro] = useState('');
  const [pronto, setPronto] = useState('');
  const [enviando, setEnviando] = useState(false);

  async function salvar(e) {
    e.preventDefault();
    setErro('');
    if (nova !== confirma) { setErro('A confirmação não confere com a nova senha.'); return; }
    setEnviando(true);
    try { setPronto((await api.redefinirPeloLink(token, nova)).mensagem); } catch (x) { setErro(x.message); } finally { setEnviando(false); }
  }

  return (
    <div className="login">
      <section className="login-marca">
        <img src="/logo-spaguas-branco.png" alt="SP Águas – Agência de Águas do Estado de São Paulo" className="login-logo" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
        <p className="rotulo-claro">GOVERNO DO ESTADO DE SÃO PAULO · SP ÁGUAS</p>
        <h1>Análise de propostas</h1>
        <p>Crie a sua nova senha para voltar a acessar o sistema.</p>
      </section>
      <form className="login-cartao" onSubmit={salvar}>
        <p className="rotulo">RECUPERAR ACESSO</p>
        <h2>Criar nova senha</h2>
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        {pronto ? (
          <>
            <Aviso tipo="sucesso">{pronto}</Aviso>
            <Botao icone="sair" onClick={irParaLogin}>Ir para o login</Botao>
          </>
        ) : (
          <>
            <CampoSenha rotulo="Nova senha" autoComplete="new-password" value={nova} onChange={(e) => setNova(e.target.value)} required minLength={8} />
            <CampoSenha rotulo="Confirme a nova senha" autoComplete="new-password" value={confirma} onChange={(e) => setConfirma(e.target.value)} required minLength={8} />
            <p className="ajuda">Pelo menos 8 caracteres, com letras e números. Não use o seu e-mail.</p>
            <Botao type="submit" icone="check" disabled={enviando}>{enviando ? 'Salvando…' : 'Salvar nova senha'}</Botao>
            <div className="login-links"><button type="button" className="link" onClick={irParaLogin}>← Voltar para entrar</button></div>
          </>
        )}
      </form>
      <div className="ondas ondas-login" aria-hidden="true" />
    </div>
  );
}
