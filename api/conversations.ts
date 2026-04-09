import { VercelRequest, VercelResponse } from '@vercel/node';
import { ConversationManager } from '../src/inbox/ConversationManager';
import { config, validateConfig } from '../src/config';
import { logger } from '../src/utils/logger';

if (!validateConfig()) {
  logger.error('Conversations', 'Configuração inválida');
}

const conversationManager = new ConversationManager();

/**
 * API de Conversas
 * GET /api/conversations - Listar todas
 * GET /api/conversations?id=xxx - Obter específica
 * POST /api/conversations - Criar nova conversa (body: { phone, name? })
 * POST /api/conversations?id=xxx&action=assume - Assumir controle
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const appPassword = process.env.APP_PASSWORD || '';
  const requestPassword = req.headers['x-app-password'];
  if (appPassword && requestPassword !== appPassword) {
    logger.warn('Conversations', 'Acesso negado');
    res.status(401).json({ erro: 'Não autorizado' });
    return;
  }

  // Permitir CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // Extrair ID da URL ou query
  const urlParts = req.url?.split('/') || [];
  const idFromUrl = urlParts[urlParts.length - 1]?.split('?')[0];
  const { id: idFromQuery, action } = req.query;
  const id = idFromUrl && idFromUrl !== 'conversations' ? idFromUrl : (idFromQuery as string);

  // GET - Listar conversas ou obter específica
  if (req.method === 'GET') {
    logger.info('Conversations', 'GET /api/conversations');
    
    if (id) {
      // Obter conversa específica
      logger.info('Conversations', `ID solicitado: ${id}`);
      const conversa = await conversationManager.obterConversa(id);
      if (!conversa) {
        logger.warn('Conversations', 'Conversa não encontrada');
        res.status(404).json({ erro: 'Conversa não encontrada' });
        return;
      }
      logger.info('Conversations', `Conversa encontrada: ${conversa.name || conversa.phoneNumber}`);
      logger.info('Conversations', `Mensagens: ${conversa.messages.length}, Não lidas: ${conversa.unreadCount}`);
      res.json(conversa);
      return;
    }

    // Listar todas as conversas
    try {
      const conversas = await conversationManager.obterConversas();
      logger.info('Conversations', `Total: ${conversas.length} conversa(s)`);
      
      const lista = conversas.map((c) => ({
        id: c.id,
        name: c.name,
        phoneNumber: c.phoneNumber,
        lastMessage: c.lastMessage,
        lastTimestamp: c.lastTimestamp,
        unreadCount: c.unreadCount,
        isHuman: c.isHuman,
      }));

      logger.info('Conversations', 'Retornando lista');
      res.json(lista);
      return;
    } catch (erro: any) {
      logger.error('Conversations', `Erro ao listar conversas: ${erro?.message || 'Desconhecido'}`);
      res.json([]);
      return;
    }
  }

  // POST - Criar nova conversa ou assumir controle
  if (req.method === 'POST') {
    logger.info('Conversations', 'POST /api/conversations');
    const { phone, name, isHuman } = req.body as { 
      phone?: string; 
      name?: string; 
      isHuman?: boolean;
    };

    // Modo 1: Criar nova conversa (phone no body)
    if (phone && !id) {
      logger.info('Conversations', `Criando nova conversa: ${phone}`);
      if (name) logger.info('Conversations', `Nome: ${name}`);
      
      try {
        const conversa = await conversationManager.criarConversa(phone, name);
        logger.info('Conversations', 'Conversa criada/atualizada');
        res.json({ ok: true, conversa });
        return;
      } catch (erro: any) {
        logger.error('Conversations', `Erro ao criar conversa: ${erro?.message || 'Desconhecido'}`);
        res.status(500).json({ erro: erro?.message || 'Erro ao criar conversa' });
        return;
      }
    }

    // Modo 2: Assumir controle (id em query, isHuman no body)
    if (!id) {
      logger.warn('Conversations', 'ID da conversa não especificado');
      res.status(400).json({ erro: 'ID da conversa não especificado' });
      return;
    }

    logger.info('Conversations', `ID: ${id}`);
    logger.info('Conversations', `Assumir como humano: ${isHuman}`);

    const sucesso = conversationManager.alternarControleManual(
      id,
      Boolean(isHuman)
    );

    if (!sucesso) {
      logger.warn('Conversations', 'Conversa não encontrada');
      res.status(404).json({ erro: 'Conversa não encontrada' });
      return;
    }

    logger.info('Conversations', 'Controle alterado com sucesso');

    res.json({ ok: true, isHuman });
    return;
  }

  // DELETE - Apagar todas as conversas
  if (req.method === 'DELETE') {
    logger.warn('Conversations', 'DELETE /api/conversations - apagando todas as conversas');
    await conversationManager.limparConversas();
    res.json({ ok: true });
    return;
  }

  res.status(405).json({ erro: 'Método não permitido' });
}
