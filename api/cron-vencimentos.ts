import { VercelRequest, VercelResponse } from '@vercel/node';
import { ConversationManager } from '../src/inbox/ConversationManager';
import { executarJobLembrete } from '../src/utils/jobLembrete';
import { gerarResumoSemanal } from '../src/utils/relatoriosAdmin';
import { logger } from '../src/utils/logger';

const CRON_SECRET = process.env.CRON_SECRET || '';
const ADMIN_VENDAS_PHONE = process.env.ADMIN_VENDAS_PHONE || '558586999181';
const ADMIN_TI_PHONE = process.env.ADMIN_TI_PHONE || '558597223863';

const conversationManager = new ConversationManager();

function isSegundaFeiraBRT(): boolean {
  // Cron roda às 13h UTC = 10h BRT. Verificar dia da semana em BRT (UTC-3).
  const agora = new Date();
  const brt = new Date(agora.toLocaleString('en-US', { timeZone: 'America/Fortaleza' }));
  return brt.getDay() === 1; // 1 = segunda-feira
}

/**
 * Job diário unificado de lembretes.
 * GET /api/cron-vencimentos?token=<CRON_SECRET>
 *
 * Usa a mesma lógica do comando "LEMBRAR" dos admins:
 * - Envia nudge de retorno para clientes na janela de 24h
 * - Envia lembretes de extintor/inspeção para quem está na janela
 * - Envia resumo completo (incluindo fora da janela) para os admins
 *
 * Chamada uma vez por dia via GitHub Actions ou Vercel Cron.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.status(405).json({ erro: 'Método não permitido' });
    return;
  }

  // Vercel injeta Authorization: Bearer <CRON_SECRET> automaticamente.
  // Também aceita ?token= para chamada manual/debug.
  const authHeader = req.headers['authorization'] || '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  const queryToken = req.query['token'] as string || '';
  if (CRON_SECRET && bearerToken !== CRON_SECRET && queryToken !== CRON_SECRET) {
    logger.warn('CronVencimentos', 'Token inválido');
    res.status(403).json({ erro: 'Token inválido' });
    return;
  }

  logger.info('CronVencimentos', '🚀 Iniciando job diário de lembretes');

  try {
    const resultado = await executarJobLembrete(
      conversationManager.enviarMensagem.bind(conversationManager)
    );

    logger.info('CronVencimentos', `✅ Job concluído: ${JSON.stringify(resultado)}`);

    // Resumo semanal toda segunda-feira
    let resumoSemanal: Record<string, unknown> | undefined;
    if (isSegundaFeiraBRT()) {
      logger.info('CronVencimentos', '📊 Segunda-feira: gerando resumo semanal');
      try {
        const enviar = conversationManager.enviarMensagem.bind(conversationManager);
        const resumo = await gerarResumoSemanal();
        await enviar(ADMIN_VENDAS_PHONE, resumo.msgAdmin);
        if (resumo.leadsEstagnados > 0 || resumo.extintoresVencendo > 0) {
          await enviar(ADMIN_TI_PHONE, resumo.msgAdmin);
        }
        resumoSemanal = {
          leadsNovos: resumo.leadsNovos,
          leadsEstagnados: resumo.leadsEstagnados,
          clientes: resumo.totalClientesAtivos,
          extintoresVencendo: resumo.extintoresVencendo,
        };
        logger.info('CronVencimentos', `✅ Resumo semanal enviado: ${JSON.stringify(resumoSemanal)}`);
      } catch (e: any) {
        logger.error('CronVencimentos', 'Erro no resumo semanal', { message: e?.message });
      }
    }

    res.status(200).json({ ok: true, ...resultado, resumoSemanal });
  } catch (erro: any) {
    logger.error('CronVencimentos', 'Erro no job diário', { message: erro?.message });
    res.status(500).json({ ok: false, erro: erro?.message });
  }
}
