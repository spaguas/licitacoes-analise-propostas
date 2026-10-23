// Teste do e-mail pela linha de comando:
//   docker compose exec api node src/email-teste.js seu.email@dominio.gov.br
import { config } from './config.js';
import { criarEmail } from './servicos/email.js';

const destino = process.argv[2] || config.emailAvisosAdmin;
const email = criarEmail(config.smtp);
if (!email.ativo) {
  console.error('E-mail não configurado: preencha SMTP_HOST e SMTP_REMETENTE no .env (use configurar-email.ps1).');
  process.exit(1);
}
if (!destino) { console.error('Informe o destino: node src/email-teste.js nome@dominio'); process.exit(1); }
console.log(`Enviando teste de ${config.smtp.remetente} para ${destino} via ${config.smtp.host}:${config.smtp.porta}...`);
try {
  await email.enviar({ para: destino, assunto: 'Teste de e-mail – Análise de Propostas',
    texto: 'Este é um teste do envio de e-mails do sistema de Análise de Propostas da SP Águas.\n\nSe você recebeu, está tudo certo.' });
  console.log('OK: e-mail enviado. Confira a caixa de entrada (e o spam).');
} catch (erro) {
  console.error(`ERRO: ${erro.message}`);
  process.exit(1);
}
