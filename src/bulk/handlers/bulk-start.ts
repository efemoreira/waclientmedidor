/**
 * Handler for bulk start action
 */

import { VercelRequest, VercelResponse } from '@vercel/node';
import { config } from '../../src/config';
import { parseCsv } from '../../src/utils/csv-parser';
import { normalizarNumero } from '../../src/utils/phone-normalizer';
import { lerStatus, salvarStatus, salvarFila, salvarStop, type BulkStatus } from '../../src/utils/bulk-file-operations';

export async function handleStart(req: VercelRequest, res: VercelResponse): Promise<void> {
  console.log('  🚀 Iniciando envio em massa');
  
  const { template, language, contatos, csv, marketing, productPolicy, messageActivitySharing } = req.body as {
    template?: string;
    language?: string;
    contatos?: any[];
    csv?: string;
    marketing?: boolean;
    productPolicy?: 'CLOUD_API_FALLBACK' | 'STRICT';
    messageActivitySharing?: boolean;
  };
  
  if (!template) {
    console.log('  ❌ Template não especificado');
    console.log('='.repeat(50) + '\n');
    res.status(400).json({ erro: 'Template não especificado' });
    return;
  }

  let contatosEntrada = contatos;
  if ((!contatosEntrada || contatosEntrada.length === 0) && csv) {
    contatosEntrada = parseCsv(csv);
  }
  
  if (!contatosEntrada || contatosEntrada.length === 0) {
    console.log('  ❌ Contatos não fornecidos');
    console.log('='.repeat(50) + '\n');
    res.status(400).json({ erro: 'Contatos não fornecidos' });
    return;
  }

  const status = await lerStatus();
  if (status.ativo) {
    console.log('  ⚠️  Envio já em andamento');
    console.log('='.repeat(50) + '\n');
    res.status(400).json({ erro: 'Envio já em andamento' });
    return;
  }

  try {
    console.log(`  📋 Template: ${template}`);
    console.log(`  🌍 Idioma: ${language || 'pt_BR'}`);
    console.log(`  📞 Total de contatos: ${contatosEntrada.length}`);
    
    // Convert contacts to correct format
    const contatosFormatados = contatosEntrada.reduce((acc: any[], c: any) => {
      const numero = normalizarNumero(c.numero || c.telefone || '');
      if (!numero) return acc;
      if (c?.valido === false) return acc;

      const base = {
        numero,
        mensagem: c.mensagem || '',
        link: c.link || '',
        status: 'pendente',
        marketing: Boolean(marketing),
        productPolicy,
        messageActivitySharing,
      } as any;
      
      if (template) {
        base.template = template;
        base.language = language || 'pt_BR';
      }
      
      acc.push(base);
      return acc;
    }, []);

    await salvarStop(false);

    // Update status as active
    const novoStatus: BulkStatus = {
      ativo: true,
      total: contatosFormatados.length,
      enviados: 0,
      erros: 0,
      loteAtual: 0,
      totalLotes: contatosFormatados.length > 0 ? Math.ceil(contatosFormatados.length / config.bulk.batchSize) : 0,
      template,
      language: language || 'pt_BR',
      timestamp: Date.now(),
      lastErrors: [],
      interrompido: false,
      mensagem: '',
      lastRequests: [],
      filaTotal: contatosFormatados.length,
      filaIndex: 0,
    };
    
    await salvarStatus(novoStatus);
    await salvarFila({ contatos: contatosFormatados, index: 0 });

    res.json({ ok: true, mensagem: 'Envio iniciado', total: contatosFormatados.length });
  } catch (erro: any) {
    res.status(500).json({ erro: erro.message });
  }
}
