// Barra lateral azul-marinho com ondas (identidade SP Águas) e barra superior.
import { useState } from 'react';
import { Icone, Botao } from './Comuns.jsx';

function Logo() {
  const [semImagem, setSemImagem] = useState(false);
  return (
    <div className="marca">
      {semImagem
        ? <span className="marca-texto">SP Águas</span>
        : <img src="/logo-spaguas-branco.png" alt="SP Águas – Agência de Águas do Estado de São Paulo" className="marca-logo" onError={() => setSemImagem(true)} />}
      <span className="marca-produto">Análise de propostas</span>
    </div>
  );
}

export function BarraLateral({ pagina, ir, pregoes, usuario, sair, pendencias = 0, alertas = 0 }) {
  const recentes = pregoes.slice(0, 5);
  return (
    <aside className="lateral">
      <Logo />
      <p className="lateral-rotulo">Espaço de trabalho</p>
      <div className="lateral-org"><strong>SP Águas</strong><span>Institucional</span></div>
      <nav className="lateral-nav" aria-label="Navegação principal">
        <button type="button" className={pagina.nome === 'pregoes' ? 'ativo' : ''} onClick={() => ir({ nome: 'pregoes' })}>
          <Icone nome="painel" /><span>Pregões</span><em>{pregoes.length}</em>
        </button>
        {usuario?.perfil === 'admin' && (
          <>
            <button type="button" className={pagina.nome === 'ia' ? 'ativo' : ''} onClick={() => ir({ nome: 'ia' })}>
              <Icone nome="ia" /><span>Uso das IAs</span>
            </button>
            <button type="button" className={pagina.nome === 'usuarios' ? 'ativo' : ''} onClick={() => ir({ nome: 'usuarios' })}>
              <Icone nome="empresa" /><span>Usuários</span>{pendencias > 0 && <em className="contador-pendencias" title={`${pendencias} pedido(s) aguardando`}>{pendencias}</em>}
            </button>
            <button type="button" className={pagina.nome === 'seguranca' ? 'ativo' : ''} onClick={() => ir({ nome: 'seguranca' })}>
              <Icone nome="escudo" /><span>Segurança</span>{alertas > 0 && <em className="contador-alertas" title={`${alertas} evento(s) grave(s) nas últimas 24 h`}>{alertas}</em>}
            </button>
          </>
        )}
      </nav>
      <p className="lateral-rotulo">Processos recentes</p>
      <ul className="lateral-recentes">
        {recentes.length === 0 && <li className="vazio">Seus pregões aparecerão aqui.</li>}
        {recentes.map((p) => (
          <li key={p.id}>
            <button type="button" className={pagina.id === p.id ? 'ativo' : ''} onClick={() => ir({ nome: 'pregao', id: p.id })}>
              <i aria-hidden="true" /><span><strong>{p.nome}</strong><small>{p.numero ? `PE ${p.numero}` : 'Aguardando edital'}</small></span>
            </button>
          </li>
        ))}
      </ul>
      <div className="lateral-rodape">
        <div className="perfil">
          <span className="avatar" aria-hidden="true">{(usuario?.nome || '?').split(' ').map((n) => n[0]).slice(0, 2).join('')}</span>
          <span><strong>{usuario?.nome}</strong><small>{usuario?.perfil_nome || (usuario?.perfil === 'admin' ? 'Administrador' : 'Licitante')}</small></span>
          <button type="button" className="perfil-sair" onClick={sair} title="Sair"><Icone nome="sair" titulo="Sair" /></button>
        </div>
      </div>
      <div className="ondas" aria-hidden="true" />
    </aside>
  );
}

export function BarraSuperior({ trilha, aoNovo, ocupado }) {
  return (
    <header className="superior">
      <nav className="trilha" aria-label="Você está em">
        <span>LICITAÇÕES</span><span aria-hidden="true">›</span><strong>{trilha}</strong>
      </nav>
      <div className="superior-acoes">
        <span className={`estado ${ocupado ? 'ocupado' : ''}`}><i aria-hidden="true" />{ocupado ? 'Processando documentos' : 'Sistema operacional'}</span>
        {aoNovo && <Botao icone="mais" onClick={aoNovo}>Novo pregão</Botao>}
      </div>
    </header>
  );
}
