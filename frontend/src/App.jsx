import { useCallback, useEffect, useState } from 'react';
import { api, definirSessao } from './api.js';
import { BarraLateral, BarraSuperior } from './componentes/Estrutura.jsx';
import { Login } from './paginas/Login.jsx';
import { ListaPregoes } from './paginas/ListaPregoes.jsx';
import { Pregao } from './paginas/Pregao.jsx';
import { PainelIA } from './paginas/PainelIA.jsx';
import { Usuarios } from './paginas/Usuarios.jsx';
import { TrocarSenha } from './paginas/TrocarSenha.jsx';
import { RedefinirSenha } from './paginas/RedefinirSenha.jsx';
import { Seguranca } from './paginas/Seguranca.jsx';

// Navegação simples pelo endereço (#/pregoes, #/pregoes/<id>, #/ia), sem biblioteca de rotas.
function lerEndereco() {
  const [, a, b] = window.location.hash.split('/');
  if (a === 'pregoes' && b) return { nome: 'pregao', id: b };
  if (a === 'ia') return { nome: 'ia' };
  if (a === 'usuarios') return { nome: 'usuarios' };
  if (a === 'seguranca') return { nome: 'seguranca' };
  if (a === 'redefinir' && b) return { nome: 'redefinir', token: b };
  return { nome: 'pregoes' };
}

export function App() {
  const [sessao, setSessao] = useState(null);
  const [pagina, setPagina] = useState(lerEndereco);
  const [pregoes, setPregoes] = useState([]);
  const [ocupado, setOcupado] = useState(false);
  const [criando, setCriando] = useState(false);

  const encerrar = useCallback(() => { definirSessao(null); setSessao(null); }, []);
  const sair = useCallback(async () => { await api.sair(); encerrar(); }, [encerrar]);
  const ir = (p) => {
    window.location.hash = p.nome === 'pregao' ? `/pregoes/${p.id}` : p.nome === 'ia' ? '/ia' : p.nome === 'usuarios' ? '/usuarios' : p.nome === 'seguranca' ? '/seguranca' : '/pregoes';
  };
  const admin = sessao?.usuario?.perfil === 'admin';
  const [pendencias, setPendencias] = useState(0);
  const [alertas, setAlertas] = useState(0);
  useEffect(() => {
    if (!admin || sessao?.usuario?.trocar_senha) return;
    api.pendencias().then((p) => setPendencias(p.total)).catch(() => {});
    api.segurancaResumo().then((r) => setAlertas(r.ultimas_24h?.graves || 0)).catch(() => {});
  }, [admin, sessao, pagina]);
  useEffect(() => {
    const ouvir = () => setPagina(lerEndereco());
    window.addEventListener('hashchange', ouvir);
    return () => window.removeEventListener('hashchange', ouvir);
  }, []);

  const carregarPregoes = useCallback(() => api.pregoes().then(setPregoes).catch(() => {}), []);
  useEffect(() => { if (sessao) carregarPregoes(); }, [sessao, carregarPregoes, pagina]);

  // Link "criar nova senha" recebido por e-mail (funciona sem estar logado)
  if (pagina.nome === 'redefinir') {
    return <RedefinirSenha token={pagina.token} irParaLogin={() => { window.location.hash = ''; }} />;
  }
  if (!sessao) {
    return <Login aoEntrar={(s) => { definirSessao(s.token, encerrar); setSessao(s); }} />;
  }
  // Senha temporária (primeiro acesso ou senha redefinida): troca obrigatória antes de usar o sistema.
  if (sessao.usuario.trocar_senha) {
    return <TrocarSenha obrigatoria usuario={sessao.usuario} aoTrocar={(u) => setSessao({ ...sessao, usuario: u })} sair={sair} />;
  }
  // Licitante não acessa as páginas de administrador, nem pelo endereço.
  const paginaVisivel = !admin && (pagina.nome === 'ia' || pagina.nome === 'usuarios' || pagina.nome === 'seguranca') ? { nome: 'pregoes' } : pagina;
  const trilha = paginaVisivel.nome === 'ia' ? 'USO DAS IAS' : paginaVisivel.nome === 'usuarios' ? 'USUÁRIOS' : paginaVisivel.nome === 'seguranca' ? 'SEGURANÇA' : 'ANÁLISE DE PROPOSTAS';
  return (
    <div className="aplicacao">
      <BarraLateral pagina={paginaVisivel} ir={ir} pregoes={pregoes} usuario={sessao.usuario} sair={sair} pendencias={pendencias} alertas={alertas} />
      <div className="conteudo">
        <BarraSuperior trilha={trilha} ocupado={ocupado} aoNovo={() => { ir({ nome: 'pregoes' }); setCriando(true); }} />
        <main className="pagina" id="principal">
          {paginaVisivel.nome === 'pregoes' && (
            <ListaPregoes pregoes={pregoes} abrir={(id) => ir({ nome: 'pregao', id })} recarregar={carregarPregoes}
              criando={criando} setCriando={setCriando} admin={admin} />
          )}
          {paginaVisivel.nome === 'pregao' && <Pregao id={pagina.id} setOcupado={setOcupado} voltar={() => { carregarPregoes(); ir({ nome: 'pregoes' }); }} />}
          {paginaVisivel.nome === 'ia' && <PainelIA />}
          {paginaVisivel.nome === 'seguranca' && <Seguranca />}
          {paginaVisivel.nome === 'usuarios' && <Usuarios usuarioAtual={sessao.usuario} aoMudarPendencias={setPendencias} />}
        </main>
      </div>
    </div>
  );
}
