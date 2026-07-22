import { VercelRequest, VercelResponse } from '@vercel/node';
import { ConversationManager } from '../src/inbox/ConversationManager';
import { config, validateConfig } from '../src/config';
import { logger } from '../src/utils/logger';

if (!validateConfig()) {
  logger.error('Media', 'Configuração inválida');
}
const conversationManager = new ConversationManager();

/**
 * Proxy de mídia recebida do WhatsApp (ex.: áudio) para reprodução no painel
 * GET /api/media?id=<mediaId>
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-app-password');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const appPassword = process.env.APP_PASSWORD || '';
  const requestPassword = req.headers['x-app-password'];
  if (appPassword && requestPassword !== appPassword) {
    logger.warn('Media', 'Acesso negado');
    res.status(401).json({ erro: 'Não autorizado' });
    return;
  }

  if (req.method !== 'GET') {
    res.status(405).json({ erro: 'Método não permitido' });
    return;
  }

  const mediaId = req.query.id as string;
  if (!mediaId) {
    res.status(400).json({ erro: 'Parâmetro obrigatório: id' });
    return;
  }

  try {
    const { buffer, mimeType } = await conversationManager.obterMedia(mediaId);
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.status(200);
    res.end(buffer);
  } catch (erro: any) {
    logger.error('Media', `Erro ao baixar mídia ${mediaId}: ${erro?.message || erro}`);
    res.status(502).json({ erro: 'Erro ao baixar mídia' });
  }
}
