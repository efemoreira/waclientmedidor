/**
 * Handler for bulk stop action
 */

import { VercelRequest, VercelResponse } from '@vercel/node';
import { lerStatus, salvarStatus, salvarStop } from '../../src/utils/bulk-file-operations';

export async function handleStop(req: VercelRequest, res: VercelResponse): Promise<void> {
  console.log('  🛑 Solicitando parada do envio');
  await salvarStop(true);
  const status = await lerStatus();
  status.ativo = false;
  status.interrompido = true;
  status.mensagem = 'Envio interrompido pelo usuário';
  status.timestamp = Date.now();
  await salvarStatus(status);
  res.json({ ok: true, mensagem: 'Envio interrompido' });
}
