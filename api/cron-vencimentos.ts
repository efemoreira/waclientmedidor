import { VercelRequest, VercelResponse } from '@vercel/node';
import { ConversationManager } from '../src/inbox/ConversationManager';
import { executarJobLembrete } from '../src/utils/jobLembrete';
import { logger } from '../src/utils/logger';

const CRON_SECRET = process.env.CRON_SECRET || '';

const conversationManager = new ConversationManager();

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
    res.status(200).json({ ok: true, ...resultado });
  } catch (erro: any) {
    logger.error('CronVencimentos', 'Erro no job diário', { message: erro?.message });
    res.status(500).json({ ok: false, erro: erro?.message });
  }
}
