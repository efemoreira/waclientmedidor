import { VercelRequest, VercelResponse } from '@vercel/node';
import { validateConfig } from '../src/config';
import { handleUpload } from './handlers/bulk-upload';
import { handleStart } from './handlers/bulk-start';
import { handleProcess } from './handlers/bulk-process';
import { handleStop } from './handlers/bulk-stop';
import { handleGetStatus } from './handlers/bulk-status';

if (!validateConfig()) {
  console.error('❌ Configuração inválida');
}

/**
 * Bulk Messaging API
 * GET /api/bulk - Get status
 * POST /api/bulk - Handle different actions (upload, start, process, stop)
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // GET - Status
  if (req.method === 'GET') {
    await handleGetStatus(req, res);
    return;
  }

  // POST - Upload, Start, Process, or Stop
  if (req.method === 'POST') {
    console.log('\n' + '='.repeat(50));
    console.log('📤 POST /api/bulk');
    
    const { action } = req.body as { action?: string };
    console.log(`  Ação: ${action || 'vazio'}`);

    switch (action) {
      case 'upload':
        await handleUpload(req, res);
        return;
      
      case 'start':
        await handleStart(req, res);
        return;
      
      case 'process':
        await handleProcess(req, res);
        return;
      
      case 'stop':
        await handleStop(req, res);
        return;
      
      default:
        res.status(400).json({ erro: 'Action não especificada' });
        return;
    }
  }

  res.status(405).json({ erro: 'Método não permitido' });
}
