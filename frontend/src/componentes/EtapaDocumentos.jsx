import { api } from '../api.js';
import { AreaEnvio, CabecalhoEtapa, Icone, moeda } from './Comuns.jsx';
import { EstruturaLicitacao } from './EstruturaLicitacao.jsx';

const NOME_PARTE = {
  termo_referencia: 'Termo de referência', minuta_contrato: 'Minuta de contrato', norma_interna: 'Norma interna / código de conduta',
  modelo_proposta: 'Modelo de proposta', modelo_declaracao: 'Modelo de declaração', planilha_orcamentaria: 'Planilha orçamentária',
  estudo_tecnico: 'Estudo técnico preliminar', outro: 'Outro',
};
const SITUACAO = { recebido: 'Na fila', analisado: 'Lido', erro: 'Erro' };

export function EtapaDocumentos({ dados, executar }) {
  const { pregao, documentos, partes, itens, conflitos, estrutura } = dados;
  const publicos = documentos.filter((d) => d.publico);
  const enviar = (papel) => (arquivos) => executar(() => api.enviarDocumentos(pregao.id, papel, arquivos), `${arquivos.length} arquivo(s) enviado(s). A leitura começou.`);

  return (
    <section className="etapa">
      <CabecalhoEtapa numero={1} rotulo="DOCUMENTOS" titulo="Base da avaliação" acoes={<span className="dica"><Icone nome="info" tamanho={16} /> PDF até 25 MB</span>} />
      <div className="cartao">
        <div className="duas-colunas">
          <AreaEnvio titulo="Edital (com anexos)" descricao="O sistema separa os anexos e lê os metadados do pregão." aoSelecionar={enviar('edital')} />
          <AreaEnvio titulo="Termo de referência" descricao="Itens e especificações técnicas são lidos daqui." aoSelecionar={enviar('tr')} />
        </div>
        {publicos.length > 0 && (
          <ul className="lista-arquivos">
            {publicos.map((d) => (
              <li key={d.id}>
                <Icone nome="documento" />
                <span className="cresce">{d.nome_arquivo}</span>
                <span className="etiqueta">{d.papel === 'tr' ? 'TR' : d.papel === 'edital' ? 'Edital' : 'Anexo'}</span>
                <span className={`situacao situacao-${d.status}`}>{SITUACAO[d.status] || d.status}{d.paginas ? ` · ${d.paginas} págs.` : ''}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {partes.length > 0 && (
        <div className="cartao">
          <h3>Partes encontradas no edital</h3>
          <p className="ajuda">Só o termo de referência gera requisitos técnicos. Contrato, normas internas e modelos ficam de fora.</p>
          <div className="tabela-rolagem">
            <table className="tabela">
              <thead><tr><th>Anexo</th><th>Título</th><th>Tipo</th><th>Página</th><th>Gera requisitos?</th></tr></thead>
              <tbody>
                {partes.map((p) => (
                  <tr key={p.id}><td>{p.titulo}</td><td>{p.nome}</td><td>{NOME_PARTE[p.tipo] || p.tipo}</td><td>{p.pagina_inicio}</td><td>{p.gera_requisitos ? 'Sim' : 'Não'}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {estrutura && itens.length > 0 && <EstruturaLicitacao pregaoId={pregao.id} estrutura={estrutura} executar={executar} />}

      {conflitos.length > 0 && (
        <div className="cartao cartao-conflito">
          <h3><Icone nome="alerta" /> Conflitos entre documentos</h3>
          <p className="ajuda">O sistema não escolhe um lado: confira as fontes e decida.</p>
          <ul className="conflitos">
            {conflitos.map((c) => (
              <li key={c.id}><strong>{c.campo}</strong>{c.valores.map((v, i) => <span key={i}>{typeof v.valor === 'number' ? moeda(v.valor) : v.valor} <small>({v.fonte})</small></span>)}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
