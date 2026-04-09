/**
 * Handler for bulk status retrieval
 */

import { VercelRequest, VercelResponse } from '@vercel/node';
import { lerStatus } from '../../src/utils/bulk-file-operations';

export async function handleGetStatus(req: VercelRequest, res: VercelResponse): Promise<void> {
  console.log('\n' + '='.repeat(50));
  console.log('📊 GET /api/bulk/status');
  
  const status = await lerStatus();
  console.log(`  Ativo: ${status.ativo ? '✅ Sim' : '❌ Não'}`);
  
  if (status.ativo) {
    console.log(`  Progresso: ${status.enviados}/${status.total}`);
    console.log(`  Lote: ${status.loteAtual}/${status.totalLotes}`);
    console.log(`  Erros: ${status.erros}`);
  }
  
  console.log('='.repeat(50) + '\n');
  res.json(status);
}
