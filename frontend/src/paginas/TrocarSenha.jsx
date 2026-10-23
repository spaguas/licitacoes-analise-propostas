// Troca de senha. Obrigatória quando o usuário entra com senha temporária (primeiro acesso ou senha redefinida).
import { useState } from 'react';
import { api } from '../api.js';
import { Aviso, Botao, CampoSenha } from '../componentes/Comuns.jsx';

export function TrocarSenha({ usuario, aoTrocar, sair, obrigatoria = false }) {
  const [atual, setAtual] = useState('');
  const [nova, setNova] = useState('');
  const [confirma, setConfirma] = useState('');
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);

  async function salvar(e) {
    e.preventDefault();
    setErro('');
    if (nova !== confirma) { setErro('A confirmação não confere com a nova senha.'); return; }
    setEnviando(true);
    try { aoTrocar(await api.trocarSenha(atual, nova)); } catch (x) { setErro(x.message); } finally { setEnviando(false); }
  }

  return (
    <div className="login">
      <section className="login-marca">
        <img src="/logo-spaguas-branco.png" alt="SP Águas – Agência de Águas do Estado de São Paulo" className="login-logo" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
        <h1>Olá, {usuario.nome.split(' ')[0]}</h1>
        <p>{obrigatoria
          ? 'Você entrou com uma senha temporária. Crie agora a sua senha pessoal para continuar.'
          : 'Escolha uma nova senha.'}</p>
      </section>
      <form className="login-cartao" onSubmit={salvar}>
        <p className="rotulo">SEGURANÇA DA CONTA</p>
        <h2>Criar a sua senha</h2>
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <CampoSenha rotulo="Senha atual (a temporária)" autoComplete="current-password" value={atual} onChange={(e) => setAtual(e.target.value)} required />
        <CampoSenha rotulo="Nova senha" autoComplete="new-password" value={nova} onChange={(e) => setNova(e.target.value)} required minLength={8} />
        <CampoSenha rotulo="Confirme a nova senha" autoComplete="new-password" value={confirma} onChange={(e) => setConfirma(e.target.value)} required minLength={8} />
        <p className="ajuda">Pelo menos 8 caracteres, com letras e números. Não use o seu e-mail.</p>
        <Botao type="submit" icone="check" disabled={enviando}>{enviando ? 'Salvando…' : 'Salvar e entrar'}</Botao>
        <button type="button" className="link" onClick={sair}>Sair</button>
      </form>
      <div className="ondas ondas-login" aria-hidden="true" />
    </div>
  );
}
