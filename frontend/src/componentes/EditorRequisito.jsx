// Formulário para corrigir um requisito lido pela IA. O trecho original do edital/TR fica visível
// para comparação. Ao salvar, o requisito passa a "validado" (foi conferido por uma pessoa).
import { useEffect, useRef, useState } from 'react';
import { Aviso, Botao } from './Comuns.jsx';

const TIPOS = [
  ['numerico', 'Numérico (mínimo, máximo ou igual)'],
  ['faixa', 'Faixa (entre um valor e outro)'],
  ['booleano', 'Sim/não (precisa ter)'],
  ['opcao', 'Opção (um item de uma lista)'],
  ['norma', 'Norma ou padrão "ou superior"'],
  ['condicional', 'Condicional (se… então…)'],
  ['texto_livre', 'Texto livre (julgado pela IA)'],
  ['verificacao_externa', 'Verificação externa (benchmark, data, portal)'],
  ['campos_proposta', 'Campos obrigatórios da proposta'],
];
const OPERADORES = [['>=', 'no mínimo (>=)'], ['<=', 'no máximo (<=)'], ['=', 'igual a (=)'], ['>', 'maior que (>)'], ['<', 'menor que (<)']];

export function EditorRequisito({ requisito, aoSalvar, aoFechar }) {
  const [form, setForm] = useState(() => ({
    atributo: requisito.atributo || '',
    tipo: requisito.tipo || 'texto_livre',
    operador: requisito.operador || '>=',
    valor: requisito.valor ?? '',
    valor_min: requisito.valor_min ?? '',
    valor_max: requisito.valor_max ?? '',
    unidade: requisito.unidade || '',
    opcoes: (requisito.opcoes || []).join('; '),
    condicao: requisito.condicao || '',
    obrigatorio: requisito.obrigatorio !== false,
  }));
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const caixa = useRef(null);
  useEffect(() => { caixa.current?.querySelector('select, input')?.focus(); }, []);

  const muda = (campo) => (e) => setForm((f) => ({ ...f, [campo]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const t = form.tipo;

  async function salvar(e) {
    e.preventDefault();
    setErro(''); setSalvando(true);
    const patch = { atributo: form.atributo, tipo: t, obrigatorio: form.obrigatorio, unidade: form.unidade || null };
    if (t === 'numerico') Object.assign(patch, { operador: form.operador, valor: form.valor, valor_min: null, valor_max: null });
    else if (t === 'faixa') Object.assign(patch, { valor_min: form.valor_min, valor_max: form.valor_max, operador: null, valor: null });
    else if (t === 'norma') Object.assign(patch, { valor: form.valor || null, operador: null });
    else Object.assign(patch, { operador: null, valor: null, valor_min: null, valor_max: null });
    if (t === 'opcao' || t === 'campos_proposta') patch.opcoes = form.opcoes;
    else patch.opcoes = null;
    if (t === 'condicional') patch.condicao = form.condicao;
    try { await aoSalvar(patch); } catch (x) { setErro(x.message); setSalvando(false); }
  }

  return (
    <div className="modal-fundo" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) aoFechar(); }}>
      <form className="modal-caixa editor-requisito" role="dialog" aria-modal="true" aria-labelledby="editor-titulo" ref={caixa}
        onSubmit={salvar} onKeyDown={(e) => { if (e.key === 'Escape') aoFechar(); }}>
        <p className="rotulo">EDITAR REQUISITO · {requisito.codigo}</p>
        <h2 id="editor-titulo">Corrigir o que a IA leu</h2>

        <div className="trecho-original">
          <span>Texto original do edital/TR (página {requisito.origem?.pagina ?? '—'})</span>
          <blockquote>“{requisito.origem?.trecho}”</blockquote>
        </div>

        {erro && <Aviso tipo="erro">{erro}</Aviso>}

        <div className="grade-form">
          <label className="largura-total">Tipo de exigência
            <select value={t} onChange={muda('tipo')}>{TIPOS.map(([v, n]) => <option key={v} value={v}>{n}</option>)}</select>
          </label>

          <label className="largura-total">Atributo (nome curto do que é medido)
            <input value={form.atributo} onChange={muda('atributo')} placeholder="ex.: garantia, memoria_capacidade" />
          </label>

          {t === 'numerico' && (
            <>
              <label>Regra<select value={form.operador} onChange={muda('operador')}>{OPERADORES.map(([v, n]) => <option key={v} value={v}>{n}</option>)}</select></label>
              <label>Valor<input inputMode="decimal" value={form.valor} onChange={muda('valor')} placeholder="ex.: 36" /></label>
              <label>Unidade<input value={form.unidade} onChange={muda('unidade')} placeholder="ex.: mes, GB, W, dia" /></label>
            </>
          )}
          {t === 'faixa' && (
            <>
              <label>Mínimo<input inputMode="decimal" value={form.valor_min} onChange={muda('valor_min')} /></label>
              <label>Máximo<input inputMode="decimal" value={form.valor_max} onChange={muda('valor_max')} /></label>
              <label>Unidade<input value={form.unidade} onChange={muda('unidade')} placeholder="ex.: W, V, cm" /></label>
            </>
          )}
          {t === 'norma' && (
            <label className="largura-total">Norma/padrão exigido<input value={form.valor} onChange={muda('valor')} placeholder="ex.: DDR5, Wi-Fi 6, NBR 14136" /></label>
          )}
          {(t === 'opcao' || t === 'campos_proposta') && (
            <label className="largura-total">{t === 'opcao' ? 'Opções permitidas' : 'Campos obrigatórios'} (separe com ponto e vírgula)
              <input value={form.opcoes} onChange={muda('opcoes')} placeholder={t === 'opcao' ? 'compacto; mini desktop; slim desktop' : 'marca; fabricante; modelo'} />
            </label>
          )}
          {t === 'condicional' && (
            <label className="largura-total">Condição<input value={form.condicao} onChange={muda('condicao')} placeholder="ex.: se não tiver porta RJ-45, fornecer adaptador" /></label>
          )}

          <label className="caixa-marcar largura-total">
            <input type="checkbox" checked={form.obrigatorio} onChange={muda('obrigatorio')} />
            Requisito obrigatório (se não atender, a proposta não atende)
          </label>
        </div>

        <p className="ajuda">Ao salvar, o requisito fica <strong>validado</strong> e registra que foi ajustado por você.</p>
        <div className="modal-acoes">
          <Botao variante="secundario" onClick={aoFechar}>Cancelar</Botao>
          <Botao type="submit" icone="check" disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar e validar'}</Botao>
        </div>
      </form>
    </div>
  );
}
