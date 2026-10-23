// Monitor de segurança (estilo Wordfence): registra acessos e ataques, bloqueia IPs automaticamente
// e avisa o administrador por e-mail. Senhas nunca são gravadas no registro.
const GRAVIDADE = {
  login_ok: 'info', auditoria: 'info', login_falhou: 'baixa', token_invalido: 'baixa',
  acesso_negado: 'media', acesso_indevido: 'media', limite_excedido: 'media', varredura: 'alta',
  forca_bruta: 'alta', injecao: 'alta', ip_bloqueado: 'alta',
};
export const NOMES_EVENTO = {
  login_ok: 'Acesso', login_falhou: 'Senha errada', forca_bruta: 'Força bruta', injecao: 'Injeção',
  varredura: 'Varredura (robô)', acesso_indevido: 'Acesso indevido', acesso_negado: 'Acesso negado',
  limite_excedido: 'Excesso de pedidos', token_invalido: 'Sessão forjada', ip_bloqueado: 'IP bloqueado', auditoria: 'Auditoria',
};

// Acesso local (o próprio computador / rede interna do Docker) nunca é bloqueado automaticamente.
export function ipLocal(ip) {
  const s = String(ip || '').replace(/^::ffff:/, '');
  return s === '127.0.0.1' || s === '::1' || s === 'localhost' || /^172\.(1[6-9]|2\d|3[01])\.\d+\.1$/.test(s);
}

export function criarSeguranca({ repo, config, email = null }) {
  const cfg = config.seguranca || {};
  const confiaveis = new Set(String(cfg.ipsConfiaveis || '').split(',').map((x) => x.trim()).filter(Boolean));
  const podeBloquear = (ip) => cfg.bloqueioAutomatico !== false && ip && !ipLocal(ip) && !confiaveis.has(ip);
  const recentes = new Map();       // ip -> [{t, tipo}] (janela de 15 min)
  const ultimoAviso = new Map();    // tipo -> momento do último e-mail (no máximo 1 a cada 30 min por tipo)
  let cacheBloqueios = { em: 0, ips: new Set() };

  async function registrar({ tipo, ip = null, email: emailEvento = null, usuarioId = null, metodo = null, caminho = null, detalhe = null, navegador = null }) {
    const gravidade = GRAVIDADE[tipo] || 'baixa';
    const evento = await repo.inserir('eventos_seguranca', {
      tipo, gravidade, ip, email: emailEvento ? String(emailEvento).slice(0, 254) : null, usuario_id: usuarioId,
      metodo, caminho: caminho ? String(caminho).slice(0, 300) : null, detalhe: detalhe ? String(detalhe).slice(0, 500) : null,
      navegador: navegador ? String(navegador).slice(0, 200) : null,
    });
    if (gravidade === 'alta') avisarAdmin(tipo, ip, detalhe);
    // Bloqueio automático: 3 eventos graves do mesmo IP em 15 minutos -> 1 hora bloqueado
    if (['alta'].includes(gravidade) && tipo !== 'ip_bloqueado' && podeBloquear(ip)) {
      const agora = Date.now();
      const lista = (recentes.get(ip) || []).filter((x) => agora - x.t < 15 * 60 * 1000);
      lista.push({ t: agora, tipo }); recentes.set(ip, lista);
      if (lista.length >= (cfg.limiteEventos || 3) && !(await ipBloqueado(ip))) {
        await bloquear(ip, `Automático: ${lista.length} eventos graves em 15 min (${[...new Set(lista.map((x) => NOMES_EVENTO[x.tipo]))].join(', ')})`, cfg.minutosBloqueio || 60, null, true);
      }
    }
    return evento;
  }

  function avisarAdmin(tipo, ip, detalhe) {
    if (!email?.ativo || !config.emailAvisosAdmin || cfg.avisoEmail === false) return;
    const ultimo = ultimoAviso.get(tipo) || 0;
    if (Date.now() - ultimo < 30 * 60 * 1000) return;
    ultimoAviso.set(tipo, Date.now());
    email.enviar({ para: config.emailAvisosAdmin, assunto: `Alerta de segurança: ${NOMES_EVENTO[tipo] || tipo}`,
      texto: `O sistema de Análise de Propostas registrou: ${NOMES_EVENTO[tipo] || tipo}.\n\nIP: ${ip || '—'}\nDetalhe: ${detalhe || '—'}\n\nVeja tudo no menu Segurança:\n${config.urlPublica}/#/seguranca\n\n(No máximo um aviso deste tipo a cada 30 minutos.)` })
      .catch((erro) => console.warn('[segurança] aviso por e-mail falhou:', erro.message));
  }

  async function bloquear(ip, motivo, minutos = 60, criadoPor = null, automatico = false) {
    const ate = new Date(Date.now() + minutos * 60 * 1000).toISOString();
    const b = await repo.inserir('bloqueios_ip', { ip, motivo: String(motivo || '').slice(0, 300), ate, automatico, criado_por: criadoPor, ativo: true });
    cacheBloqueios.em = 0;
    await repo.inserir('eventos_seguranca', { tipo: 'ip_bloqueado', gravidade: 'alta', ip, detalhe: `${motivo} — até ${new Date(ate).toLocaleString('pt-BR')}` });
    avisarAdmin('ip_bloqueado', ip, motivo);
    return b;
  }
  async function desbloquear(id) {
    const b = await repo.obter('bloqueios_ip', id);
    if (!b) return null;
    cacheBloqueios.em = 0;
    recentes.delete(b.ip);
    return repo.atualizar('bloqueios_ip', id, { ativo: false });
  }
  async function bloqueiosAtivos() {
    return (await repo.buscar('bloqueios_ip', { ativo: true })).filter((b) => new Date(b.ate) > new Date());
  }
  // Consultado a cada requisição: guarda em memória por 10 segundos.
  async function ipBloqueado(ip) {
    if (!ip) return false;
    if (Date.now() - cacheBloqueios.em > 10000) cacheBloqueios = { em: Date.now(), ips: new Set((await bloqueiosAtivos()).map((b) => b.ip)) };
    return cacheBloqueios.ips.has(ip);
  }

  async function listar({ tipo, gravidade, ip, limite = 300 } = {}) {
    const todos = await repo.buscar('eventos_seguranca', {}, { ordem: 'criado_em' });
    return todos.reverse()
      .filter((e) => (!tipo || e.tipo === tipo) && (!gravidade || e.gravidade === gravidade) && (!ip || String(e.ip || '').includes(ip)))
      .slice(0, Math.min(Number(limite) || 300, 2000))
      .map((e) => ({ ...e, tipo_nome: NOMES_EVENTO[e.tipo] || e.tipo }));
  }
  async function resumo() {
    const desde = Date.now() - 24 * 3600 * 1000;
    const dia = (await repo.buscar('eventos_seguranca')).filter((e) => new Date(e.criado_em).getTime() >= desde);
    const conta = (t) => dia.filter((e) => e.tipo === t).length;
    const porIp = {};
    for (const e of dia.filter((x) => x.gravidade !== 'info' && x.ip)) porIp[e.ip] = (porIp[e.ip] || 0) + 1;
    return {
      ultimas_24h: {
        acessos: conta('login_ok'), senhas_erradas: conta('login_falhou'), forca_bruta: conta('forca_bruta'), injecoes: conta('injecao'),
        varreduras: conta('varredura'), acessos_indevidos: conta('acesso_indevido') + conta('acesso_negado'), excesso: conta('limite_excedido'),
        graves: dia.filter((e) => e.gravidade === 'alta').length,
      },
      ips_mais_suspeitos: Object.entries(porIp).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([ip, eventos]) => ({ ip, eventos, local: ipLocal(ip) })),
      bloqueados: (await bloqueiosAtivos()).sort((a, b) => String(b.criado_em).localeCompare(String(a.criado_em))),
      bloqueio_automatico: cfg.bloqueioAutomatico !== false,
    };
  }
  async function limparAntigos() {
    const dias = cfg.diasHistorico || 90;
    const limite = Date.now() - dias * 24 * 3600 * 1000;
    for (const e of await repo.buscar('eventos_seguranca')) if (new Date(e.criado_em).getTime() < limite) await repo.remover('eventos_seguranca', { id: e.id });
  }

  return { registrar, bloquear, desbloquear, ipBloqueado, listar, resumo, limparAntigos, podeBloquear };
}
