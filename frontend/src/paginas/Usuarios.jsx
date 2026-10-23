// Gestão de usuários (só administrador): criar login, escolher o perfil, ativar/desativar e redefinir senha.
import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Aviso, Botao, Icone, dataBr } from '../componentes/Comuns.jsx';
import { QuadroEmail } from '../componentes/QuadroEmail.jsx';

const PERFIS = [
  ['licitante', 'Licitante — vê só os pregões que criar'],
  ['admin', 'Administrador — vê tudo, IAs e usuários'],
];

function SenhaTemporaria({ dados, aoFechar }) {
  const [copiado, setCopiado] = useState(false);
  return (
    <div className="modal-fundo" role="presentation">
      <div className="modal-caixa senha-temporaria" role="dialog" aria-modal="true" aria-labelledby="senha-titulo">
        <p className="rotulo">SENHA TEMPORÁRIA</p>
        <h2 id="senha-titulo">Entregue esta senha para {dados.usuario.nome}</h2>
        <p>E-mail de acesso: <strong>{dados.usuario.email}</strong></p>
        <div className="senha-caixa"><code>{dados.senha_temporaria}</code>
          <Botao variante="secundario" icone="documento" onClick={async () => { await navigator.clipboard.writeText(dados.senha_temporaria).catch(() => {}); setCopiado(true); }}>{copiado ? 'Copiada' : 'Copiar'}</Botao>
        </div>
        <Aviso tipo="info">Ela aparece <strong>só agora</strong>. No primeiro acesso, a pessoa será obrigada a criar a própria senha.</Aviso>
        <div className="modal-acoes"><Botao icone="check" onClick={aoFechar}>Entendi</Botao></div>
      </div>
    </div>
  );
}

export function Usuarios({ usuarioAtual, aoMudarPendencias = () => {} }) {
  const [lista, setLista] = useState([]);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [novo, setNovo] = useState({ nome: '', email: '', perfil: 'licitante' });
  const [senha, setSenha] = useState(null);

  const [pend, setPend] = useState({ cadastros: [], pedidos_senha: [], total: 0 });
  const carregar = () => Promise.all([api.usuarios(), api.pendencias()])
    .then(([u, p]) => { setLista(u); setPend(p); aoMudarPendencias(p.total); })
    .catch((e) => setErro(e.message));
  useEffect(() => { carregar(); }, []);
  const fazer = async (acao, msg) => {
    setErro(''); setAviso('');
    try { const r = await acao(); if (msg) setAviso(msg); await carregar(); return r; } catch (e) { setErro(e.message); return null; }
  };

  async function criar(e) {
    e.preventDefault();
    const r = await fazer(() => api.criarUsuario(novo));
    if (r) { setSenha(r); setNovo({ nome: '', email: '', perfil: 'licitante' }); }
  }

  return (
    <>
      <div className="pagina-cabecalho">
        <div>
          <p className="rotulo">ADMINISTRAÇÃO</p>
          <h1>Usuários e acessos</h1>
          <p className="subtitulo">Crie logins, escolha o perfil de cada pessoa e controle quem pode entrar.</p>
        </div>
      </div>
      {erro && <Aviso tipo="erro" aoFechar={() => setErro('')}>{erro}</Aviso>}
      {aviso && <Aviso tipo="sucesso" aoFechar={() => setAviso('')}>{aviso}</Aviso>}

      {pend.total > 0 && (
        <div className="cartao cartao-pendencias">
          <h3>Pedidos aguardando você ({pend.total})</h3>
          {pend.cadastros.length > 0 && (
            <>
              <p className="rotulo">CADASTROS PARA APROVAR</p>
              <ul className="lista-pendencias">
                {pend.cadastros.map((u) => (
                  <li key={u.id}>
                    <span><strong>{u.nome}</strong> · {u.email}<small className="ajuda"> · pedido em {dataBr(u.criado_em)}</small></span>
                    <span className="acoes-usuario">
                      <Botao pequeno icone="check" onClick={() => fazer(() => api.aprovarCadastro(u.id), `${u.nome} aprovado(a) como Licitante.`)}>Aprovar</Botao>
                      <Botao pequeno variante="perigo" icone="x" onClick={() => { if (window.confirm(`Recusar o cadastro de ${u.nome}?`)) fazer(() => api.recusarCadastro(u.id), 'Cadastro recusado.'); }}>Recusar</Botao>
                    </span>
                  </li>
                ))}
              </ul>
              <p className="ajuda">Aprovados entram como <strong>Licitante</strong>. Para tornar alguém administrador, mude o perfil na tabela abaixo.</p>
            </>
          )}
          {pend.pedidos_senha.length > 0 && (
            <>
              <p className="rotulo">PEDIDOS DE NOVA SENHA</p>
              <ul className="lista-pendencias">
                {pend.pedidos_senha.map((p) => (
                  <li key={p.id}>
                    <span><strong>{p.usuario.nome}</strong> · {p.usuario.email}<small className="ajuda"> · pedido em {dataBr(p.pedido_em)}</small></span>
                    <Botao pequeno icone="atualizar" onClick={async () => { const r = await fazer(() => api.redefinirSenha(p.usuario.id)); if (r) setSenha(r); }}>Gerar senha temporária</Botao>
                  </li>
                ))}
              </ul>
              <p className="ajuda">Confirme a identidade da pessoa antes de entregar a senha (por exemplo, por telefone ou pessoalmente).</p>
            </>
          )}
        </div>
      )}

      <QuadroEmail />

      <form className="cartao" onSubmit={criar}>
        <h3>Novo usuário</h3>
        <div className="formulario-linha">
          <label className="cresce">Nome<input value={novo.nome} onChange={(e) => setNovo({ ...novo, nome: e.target.value })} required maxLength={120} /></label>
          <label className="cresce">E-mail<input type="email" value={novo.email} onChange={(e) => setNovo({ ...novo, email: e.target.value })} required /></label>
          <label>Perfil
            <select value={novo.perfil} onChange={(e) => setNovo({ ...novo, perfil: e.target.value })}>
              {PERFIS.map(([v, n]) => <option key={v} value={v}>{n}</option>)}
            </select>
          </label>
          <Botao type="submit" icone="mais">Criar e gerar senha</Botao>
        </div>
        <p className="ajuda">O sistema gera uma senha temporária; no primeiro acesso a pessoa cria a própria senha.</p>
      </form>

      <div className="cartao">
        <div className="tabela-rolagem">
          <table className="tabela">
            <thead><tr><th>Usuário</th><th>Perfil</th><th>Situação</th><th>Último acesso</th><th>Ações</th></tr></thead>
            <tbody>
              {lista.map((u) => {
                const euMesmo = u.id === usuarioAtual.id;
                return (
                  <tr key={u.id}>
                    <td className="nome-usuario"><strong>{u.nome}</strong>{euMesmo && <small className="ajuda"> (você)</small>}<br /><small className="email-usuario">{u.email}</small></td>
                    <td>
                      <select className="seletor-perfil" value={u.perfil} disabled={euMesmo} aria-label={`Perfil de ${u.nome}`}
                        onChange={(e) => fazer(() => api.atualizarUsuario(u.id, { perfil: e.target.value }), 'Perfil atualizado.')}>
                        <option value="licitante">Licitante</option>
                        <option value="admin">Administrador</option>
                      </select>
                    </td>
                    <td>
                      <span className={`situacao situacao-${u.ativo ? 'validado' : 'rejeitado'}`}>{u.ativo ? 'ativo' : 'desativado'}</span>
                      {u.trocar_senha && u.ativo && <small className="ajuda"> · senha temporária</small>}
                    </td>
                    <td>{u.ultimo_acesso ? dataBr(u.ultimo_acesso) : 'nunca'}</td>
                    <td><div className="acoes-usuario">
                      {!euMesmo && (
                        <Botao pequeno variante={u.ativo ? 'perigo' : 'secundario'} icone={u.ativo ? 'x' : 'check'}
                          onClick={() => fazer(() => api.atualizarUsuario(u.id, { ativo: !u.ativo }), u.ativo ? `${u.nome} não consegue mais entrar.` : `${u.nome} pode entrar de novo.`)}>
                          {u.ativo ? 'Desativar' : 'Reativar'}
                        </Botao>
                      )}
                      <Botao pequeno variante="secundario" icone="atualizar" title="Gerar uma nova senha temporária"
                        onClick={async () => { if (window.confirm(`Gerar uma nova senha temporária para ${u.nome}? A senha atual deixa de funcionar.`)) { const r = await fazer(() => api.redefinirSenha(u.id)); if (r) setSenha(r); } }}>
                        Nova senha
                      </Botao>
                      {!euMesmo && (
                        <button type="button" className="icone-botao botao-excluir-usuario" title={`Excluir ${u.nome} definitivamente`} aria-label={`Excluir ${u.nome}`}
                          onClick={() => {
                            const pregoes = u.pregoes_criados
                              ? `\n\nOs ${u.pregoes_criados} pregão(ões) criados por ${u.nome} passam para você — nada se perde.`
                              : '';
                            if (window.confirm(`Excluir ${u.nome} (${u.email}) definitivamente?\n\nEsta ação não pode ser desfeita.${pregoes}\n\nSe a pessoa só não deve mais entrar, prefira "Desativar".`)) {
                              fazer(() => api.excluirUsuario(u.id), `${u.nome} foi excluído(a).${u.pregoes_criados ? ` ${u.pregoes_criados} pregão(ões) passaram para você.` : ''}`);
                            }
                          }}>
                          <Icone nome="lixeira" titulo="Excluir" />
                        </button>
                      )}
                    </div></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      {senha && <SenhaTemporaria dados={senha} aoFechar={() => setSenha(null)} />}
    </>
  );
}
