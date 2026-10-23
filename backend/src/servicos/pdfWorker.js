// Cliente do pdf-worker (serviço interno em Python que lê os PDFs).
import { config } from '../config.js';

async function enviar(rota, pdf) {
  const r = await fetch(`${config.pdfWorkerUrl}${rota}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/pdf' },
    body: pdf,
    signal: AbortSignal.timeout(config.pdfWorkerTimeoutMs),
  });
  const corpo = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(corpo.erro || `pdf-worker respondeu HTTP ${r.status}`);
  return corpo;
}

export const pdfWorker = {
  analisarEdital: (pdf) => enviar('/analisar-edital', pdf),
  analisarProposta: (pdf) => enviar('/analisar-proposta', pdf),
};
