// Tela de acesso: entrar, criar conta (aguarda aprovação do administrador) e esqueci a senha.
import { useState } from 'react';
import { api } from '../api.js';
import { Aviso, Botao, CampoSenha } from '../componentes/Comuns.jsx';

const TITULOS = {
  entrar: ['ACESSO RESTRITO', 'Entrar no sistema'],
  cadastro: ['NOVO ACESSO', 'Criar conta'],
  esqueci: ['RECUPERAR ACESSO', 'Esqueceu a senha?'],
};

export function Login({ aoEntrar }) {
  const [modo, setModo] = useState('entrar');
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [confirma, setConfirma] = useState('');
  const [erro, setErro] = useState('');
  const [sucesso, setSucesso] = useState('');
  const [enviando, setEnviando] = useState(false);

  const trocar = (m) => { setModo(m); setErro(''); setSucesso(''); setSenha(''); setConfirma(''); };

  async function enviar(e) {
    e.preventDefault();
    setErro(''); setSucesso(''); setEnviando(true);
    try {
      if (modo === 'entrar') aoEntrar(await api.entrar(email, senha));
      if (modo === 'cadastro') {
        if (senha !== confirma) throw new Error('A confirmação não confere com a senha.');
        const r = await api.cadastrar({ nome, email, senha });
        setSucesso(r.mensagem); setNome(''); setSenha(''); setConfirma('');
      }
      if (modo === 'esqueci') setSucesso((await api.esqueciSenha(email)).mensagem);
    } catch (x) { setErro(x.message); } finally { setEnviando(false); }
  }

  const [rotulo, titulo] = TITULOS[modo];
  return (
    <div className="login">
      <section className="login-marca">
        <img src="/logo-spaguas-branco.png" alt="SP Águas – Agência de Águas do Estado de São Paulo" className="login-logo" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
        <p className="rotulo-claro">GOVERNO DO ESTADO DE SÃO PAULO · SP ÁGUAS</p>
        <h1>Análise de propostas</h1>
        <p>Requisitos do edital lidos por item e comparados com cada proposta, com a evidência de cada resultado.</p>
      </section>
      <form className="login-cartao" onSubmit={enviar}>
        <p className="rotulo">{rotulo}</p>
        <h2>{titulo}</h2>
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        {sucesso && <Aviso tipo="sucesso">{sucesso}</Aviso>}

        {modo === 'esqueci' && <p className="ajuda">Informe o seu e-mail. O administrador recebe o pedido e entrega a você uma senha temporária.</p>}
        {modo === 'cadastro' && <p className="ajuda">Depois de enviar, o administrador precisa aprovar o seu acesso.</p>}

        {modo === 'cadastro' && <label>Nome completo<input autoComplete="name" value={nome} onChange={(e) => setNome(e.target.value)} required maxLength={120} /></label>}
        <label>E-mail<input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
        {modo !== 'esqueci' && (
          <CampoSenha rotulo="Senha" autoComplete={modo === 'cadastro' ? 'new-password' : 'current-password'} value={senha} onChange={(e) => setSenha(e.target.value)} required minLength={modo === 'cadastro' ? 8 : undefined} />
        )}
        {modo === 'cadastro' && (
          <>
            <CampoSenha rotulo="Confirme a senha" autoComplete="new-password" value={confirma} onChange={(e) => setConfirma(e.target.value)} required minLength={8} />
            <p className="ajuda">Pelo menos 8 caracteres, com letras e números. Não use o seu e-mail.</p>
          </>
        )}

        <Botao type="submit" icone={modo === 'entrar' ? 'sair' : 'check'} disabled={enviando}>
          {enviando ? 'Enviando…' : modo === 'entrar' ? 'Entrar' : modo === 'cadastro' ? 'Enviar cadastro' : 'Pedir nova senha'}
        </Botao>

        <div className="login-links">
          {modo === 'entrar' ? (
            <>
              <button type="button" className="link" onClick={() => trocar('esqueci')}>Esqueceu a senha?</button>
              <span>Não tem acesso? <button type="button" className="link" onClick={() => trocar('cadastro')}>Criar conta</button></span>
            </>
          ) : (
            <button type="button" className="link" onClick={() => trocar('entrar')}>← Voltar para entrar</button>
          )}
        </div>
      </form>
      <div className="ondas ondas-login" aria-hidden="true" />
    </div>
  );
}
