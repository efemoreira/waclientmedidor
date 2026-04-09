import { VercelRequest, VercelResponse } from '@vercel/node';
import { ConversationManager } from '../src/inbox/ConversationManager';
import { config, validateConfig } from '../src/config';
import { logger } from '../src/utils/logger';

if (!validateConfig()) {
  logger.error('Messages', 'Configuração inválida');
}
const conversationManager = new ConversationManager();

/**
 * Enviar mensagem
 * POST /api/messages
 * Body: { to: string, text: string }
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const appPassword = process.env.APP_PASSWORD || '';
  const requestPassword = req.headers['x-app-password'];
  if (appPassword && requestPassword !== appPassword) {
    logger.warn('Messages', 'Acesso negado');
    res.status(401).json({ erro: 'Não autorizado' });
    return;
  }

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    logger.warn('Messages', `Método não permitido: ${req.method}`);
    res.status(405).json({ erro: 'Método não permitido' });
    return;
  }

  logger.info('Messages', 'POST /api/messages');

  const { to, text } = req.body as { to?: string; text?: string };

  if (!to || !text) {
    logger.warn('Messages', `Parâmetros inválidos: to=${to || 'vazio'} text=${text ? 'presente' : 'vazio'}`);
    res.status(400).json({ erro: 'Parâmetros inválidos (to, text)' });
    return;
  }

  try {
    logger.info('Messages', `Para: ${to}`);
    logger.info('Messages', `Texto: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`);
    
    const mensagemId = await conversationManager.enviarMensagem(to, text);
    
    logger.info('Messages', `Mensagem enviada com ID: ${mensagemId}`);
    
    res.setHeader('Content-Type', 'application/json');
    res.status(200);
    res.end(JSON.stringify({ ok: true, mensagemId }));
  } catch (erro: any) {
    const mensagem = (erro?.message ? String(erro.message) : 'Erro ao enviar mensagem');
    const status = (erro?.response?.status && typeof erro.response.status === 'number') ? erro.response.status : 500;
    const errorCode = (erro?.response?.data?.error?.code && typeof erro.response.data.error.code === 'number') ? erro.response.data.error.code : null;
    const errorType = (erro?.response?.data?.error?.type && typeof erro.response.data.error.type === 'string') ? String(erro.response.data.error.type) : null;
    const errorDetails = (erro?.response?.data?.error?.error_data?.details && typeof erro.response.data.error.error_data.details === 'string')
      ? String(erro.response.data.error.error_data.details)
      : null;
    const fbtrace = (erro?.response?.data?.error?.fbtrace_id && typeof erro.response.data.error.fbtrace_id === 'string') ? String(erro.response.data.error.fbtrace_id) : null;
    
    logger.error('Messages', `ERRO: ${mensagem}`);
    logger.error('Messages', `Status HTTP: ${status}`);
    if (errorCode) logger.error('Messages', `Código do erro: ${errorCode}`);
    if (errorType) logger.error('Messages', `Tipo: ${errorType}`);
    if (errorDetails) logger.error('Messages', `Details: ${errorDetails}`);
    if (fbtrace) logger.error('Messages', `Trace ID: ${fbtrace}`);
    
    const responseBody: Record<string, any> = { erro: mensagem };
    
    if (errorCode) responseBody.codigoErro = errorCode;
    if (errorType) responseBody.type = errorType;
    if (fbtrace) responseBody.fbtrace_id = fbtrace;
    
    res.setHeader('Content-Type', 'application/json');
    res.status(status);
    res.end(JSON.stringify(responseBody));
  }
}

