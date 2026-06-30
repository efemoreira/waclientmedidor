import { VercelRequest, VercelResponse } from '@vercel/node';
import { ConversationManager } from '../src/inbox/ConversationManager';
import { gerarResumoSemanal } from '../src/utils/relatoriosAdmin';
import { logger } from '../src/utils/logger';

const CRON_SECRET = process.env.CRON_SECRET || '';
const ADMIN_VENDAS_PHONE = process.env.ADMIN_VENDAS_PHONE || '558586999181';
const ADMIN_TI_PHONE     = process.env.ADMIN_TI_PHONE     || '558597223863';

const conversationManager = new ConversationManager();

/**
 * Resumo executivo semanal — toda segunda-feira às 12h BRT (15:00 UTC).
 * GET /api/cron-resumo-semanal
 *
 * Envia para Oscar sempre. Envia para Felipe se houver leads estagnados
 * ou extintores vencendo (situações que requerem ação técnica).
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.status(405).json({ erro: 'Método não permitido' });
    return;
  }

  const authHeader  = req.headers['authorization'] || '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  const queryToken  = (req.query['token'] as string) || '';
  if (CRON_SECRET && bearerToken !== CRON_SECRET && queryToken !== CRON_SECRET) {
    logger.warn('CronResumoSemanal', 'Token inválido');
    res.status(403).json({ erro: 'Token inválido' });
    return;
  }

  logger.info('CronResumoSemanal', '🚀 Gerando resumo semanal');

  try {
    const resumo = await gerarResumoSemanal();
    const enviar = conversationManager.enviarMensagem.bind(conversationManager);

    await enviar(ADMIN_VENDAS_PHONE, resumo.msgAdmin);

    if (resumo.leadsEstagnados > 0 || resumo.extintoresVencendo > 0) {
      await enviar(ADMIN_TI_PHONE, resumo.msgAdmin);
    }

    logger.info('CronResumoSemanal', `✅ Resumo enviado: ${JSON.stringify({
      leadsNovos: resumo.leadsNovos,
      leadsEstagnados: resumo.leadsEstagnados,
      clientes: resumo.totalClientesAtivos,
      extintoresVencendo: resumo.extintoresVencendo,
    })}`);

    res.status(200).json({ ok: true, ...resumo, msgAdmin: undefined });
  } catch (erro: any) {
    logger.error('CronResumoSemanal', 'Erro no resumo semanal', { message: erro?.message });
    res.status(500).json({ ok: false, erro: erro?.message });
  }
}
