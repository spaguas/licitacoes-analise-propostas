// Gerador do texto de recusa (ou de diligência) de uma proposta.
// O texto é montado pelo sistema a partir dos resultados; a IA só pode melhorar a redação.
import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Aviso, Botao } from './Comuns.jsx';

export function TextoRecusa({ propostaId, fornecedor, aoFechar }) {
  const [tipo, setTipo] = useState('recusa');
  const [pendencias, setPendencias] = useState(false);
  const [gerado, setGerado] = useState(null);     // { texto, codigos }
  const [texto, setTexto] = useState('');
  const [original, setOriginal] = useState(null); // para desfazer a versão da IA
  const [ocupado, setOcupado] = useState('');
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');

  useEffect(() => {
    let vivo = true;
    setOcupado('Montando o texto…'); setErro(''); setAviso(''); setOriginal(null);
    api.gerarTexto(propostaId, tipo, pendencias)
      .then((r) => { if (vivo) { setGerado(r); setTexto(r.texto); } })
      .catch((e) => vivo && setErro(e.message))
      .finally(() => vivo && setOcupado(''));
    return () => { vivo = false; };
  }, [propostaId, tipo, pendencias]);

  async function melhorar() {
    setOcupado('A IA está revisando a redação…'); setErro(''); setAviso('');
    try {
      const r = await api.melhorarTexto(propostaId, texto, gerado?.codigos || []);
      setOriginal(texto); setTexto(r.texto);
      setAviso('Redação revisada pela IA. Todos os itens foram mantidos, mas confira antes de usar.');
    } catch (e) { setErro(e.message); } finally { setOcupado(''); }
  }
  async function copiar() {
    try { await navigator.clipboard.writeText(texto); setAviso('Texto copiado. É só colar no SEI ou no documento.'); } catch { setErro('Não foi possível copiar. Selecione o texto e use Ctrl+C.'); }
  }
  async function baixar() {
    try { await api.baixarTextoDoc(texto, tipo); } catch (e) { setErro(e.message); }
  }

  return (
    <div className="modal-fundo" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) aoFechar(); }}>
      <div className="modal-caixa texto-recusa" role="dialog" aria-modal="true" aria-labelledby="texto-titulo" onKeyDown={(e) => { if (e.key === 'Escape') aoFechar(); }}>
        <p className="rotulo">{fornecedor}</p>
        <h2 id="texto-titulo">{tipo === 'recusa' ? 'Texto com os motivos da recusa' : 'Texto de solicitação de diligência'}</h2>

        <div className="texto-opcoes">
          <div className="alternar-visao" role="tablist" aria-label="Modelo de texto">
            <button type="button" role="tab" aria-selected={tipo === 'recusa'} className={tipo === 'recusa' ? 'ativa' : ''} onClick={() => setTipo('recusa')}>Recusa</button>
            <button type="button" role="tab" aria-selected={tipo === 'diligencia'} className={tipo === 'diligencia' ? 'ativa' : ''} onClick={() => setTipo('diligencia')}>Diligência</button>
          </div>
          {tipo === 'recusa' && (
            <label className="caixa-marcar"><input type="checkbox" checked={pendencias} onChange={(e) => setPendencias(e.target.checked)} />
              Incluir também os pontos pendentes (faltantes, vagos, a revisar)</label>
          )}
        </div>

        <p className="ajuda">
          {tipo === 'recusa'
            ? 'Lista cada exigência obrigatória NÃO ATENDIDA, com o que foi exigido, o que foi ofertado e o motivo. Você pode editar o texto livremente.'
            : 'Lista os pontos que não puderam ser confirmados e pede ao licitante que os comprove. Você pode editar o texto livremente.'}
          {gerado && ` ${gerado.codigos.length} item(ns) no texto.`}
        </p>

        {erro && <Aviso tipo="erro" aoFechar={() => setErro('')}>{erro}</Aviso>}
        {aviso && <Aviso tipo="sucesso" aoFechar={() => setAviso('')}>{aviso}</Aviso>}

        <textarea className="texto-editor" value={ocupado && !texto ? '' : texto} onChange={(e) => setTexto(e.target.value)}
          aria-label="Texto gerado (editável)" rows={20} spellCheck lang="pt-BR" disabled={Boolean(ocupado)} placeholder={ocupado} />

        <div className="modal-acoes">
          {original && <Botao variante="secundario" icone="atualizar" onClick={() => { setTexto(original); setOriginal(null); setAviso(''); }}>Desfazer a versão da IA</Botao>}
          <Botao variante="secundario" icone="ia" onClick={melhorar} disabled={Boolean(ocupado) || !texto}>{ocupado.startsWith('A IA') ? 'Revisando…' : 'Melhorar redação com IA'}</Botao>
          <Botao variante="secundario" icone="documento" onClick={copiar} disabled={!texto}>Copiar</Botao>
          <Botao variante="secundario" icone="baixar" onClick={baixar} disabled={!texto}>Baixar .doc</Botao>
          <Botao icone="check" onClick={aoFechar}>Fechar</Botao>
        </div>
      </div>
    </div>
  );
}
