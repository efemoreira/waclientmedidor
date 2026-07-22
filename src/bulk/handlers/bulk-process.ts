/**
 * Handler for bulk process action
 */

import { VercelRequest, VercelResponse } from '@vercel/node';
import { EnvioMassa } from '../../src/bulk/envio-massa';
import { config } from '../../src/config';
import { lerStatus, salvarStatus, lerFila, salvarFila, deveParar } from '../../src/utils/bulk-file-operations';

export async function handleProcess(req: VercelRequest, res: VercelResponse): Promise<void> {
  const status = await lerStatus();
  if (!status.ativo) {
    res.json(status);
    return;
  }

  if (await deveParar()) {
    status.ativo = false;
    status.interrompido = true;
    status.mensagem = 'Envio interrompido pelo usuário';
    status.timestamp = Date.now();
    await salvarStatus(status);
    res.json(status);
    return;
  }

  const fila = await lerFila();
  if (!fila || !Array.isArray(fila.contatos)) {
    status.ativo = false;
    status.mensagem = 'Fila não encontrada';
    status.timestamp = Date.now();
    await salvarStatus(status);
    res.json(status);
    return;
  }

  const inicio = fila.index || 0;
  const batchSize = config.bulk.batchSize;
  status.filaTotal = fila.contatos.length;
  status.filaIndex = inicio;
  const lote = fila.contatos.slice(inicio, inicio + batchSize);
  
  if (lote.length === 0) {
    status.ativo = false;
    status.mensagem = 'Envio concluído';
    status.timestamp = Date.now();
    await salvarStatus(status);
    res.json(status);
    return;
  }

  status.loteAtual = Math.floor(inicio / batchSize) + 1;
  status.timestamp = Date.now();
  await salvarStatus(status);

  const envio = new EnvioMassa({
    onProgress: async ({ contato }) => {
      if (contato.status === 'enviado') {
        status.enviados += 1;
      } else if (contato.status === 'erro') {
        status.erros += 1;
        if (contato.erro) {
          status.lastErrors = [
            { numero: contato.numero, erro: contato.erro, at: Date.now() },
            ...(status.lastErrors || []),
          ].slice(0, 10);
        }
      }
      status.timestamp = Date.now();
      await salvarStatus(status);
    },
    onRequest: async ({ url, payload }) => {
      const item = { url, payload, at: Date.now() };
      status.lastRequests = [item, ...(status.lastRequests || [])].slice(0, 10);
      status.timestamp = Date.now();
      await salvarStatus(status);
    },
    shouldStop: async () => {
      const stop = await deveParar();
      if (stop) {
        status.ativo = false;
        status.interrompido = true;
        status.mensagem = 'Envio interrompido pelo usuário';
        await salvarStatus(status);
      }
      return stop;
    },
  });

  try {
    await envio.executar(lote);
    fila.index = inicio + lote.length;
    await salvarFila(fila);
    if (fila.index >= fila.contatos.length) {
      status.ativo = false;
      status.mensagem = 'Envio concluído';
    }
    status.timestamp = Date.now();
    await salvarStatus(status);
    res.json(status);
  } catch (err: any) {
    status.ativo = false;
    status.mensagem = err?.message || 'Erro no envio';
    status.timestamp = Date.now();
    await salvarStatus(status);
    res.status(500).json({ erro: status.mensagem });
  }
}
