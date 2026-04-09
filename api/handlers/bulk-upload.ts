/**
 * Handler for bulk upload action
 */

import { VercelRequest, VercelResponse } from '@vercel/node';
import { parseCsv } from '../../src/utils/csv-parser';
import { normalizarNumero } from '../../src/utils/phone-normalizer';
import { validarNumerosWhatsApp } from '../../src/utils/whatsapp-validator';

export async function handleUpload(req: VercelRequest, res: VercelResponse): Promise<void> {
  console.log('  📁 Upload de CSV');
  const { csv } = req.body as { csv?: string };
  
  if (!csv) {
    console.log('  ❌ CSV não fornecido');
    console.log('='.repeat(50) + '\n');
    res.status(400).json({ erro: 'CSV não fornecido' });
    return;
  }

  try {
    const dados = parseCsv(csv);
    console.log(`  Registros válidos: ${dados.length}`);
    
    if (dados.length === 0) {
      console.log('  ❌ CSV vazio ou inválido');
      console.log('='.repeat(50) + '\n');
      res.status(400).json({ erro: 'CSV vazio ou inválido' });
      return;
    }
    
    const numeros = Array.from(
      new Set(
        dados
          .map((d) => normalizarNumero(d.numero || d.telefone || ''))
          .filter(Boolean)
      )
    );
    
    console.log(`  🔎 Validando ${numeros.length} números no WhatsApp...`);

    const { resultado: validacao, disponivel } = await validarNumerosWhatsApp(numeros);
    const contatos = dados.map((d) => {
      const numero = normalizarNumero(d.numero || d.telefone || '');
      const info = validacao.get(numero);
      return {
        ...d,
        numero,
        valido: info?.valido ?? null,
        wa_id: info?.wa_id,
        motivo: info?.motivo,
      };
    }).filter(c => c.numero);

    const validos = contatos.filter(c => c.valido === true).length;
    const invalidos = contatos.filter(c => c.valido === false).length;
    const naoVerificados = contatos.filter(c => c.valido === null).length;
    
    console.log(`  ✅ Válidos: ${validos} | ❌ Inválidos: ${invalidos} | ⚠️ Não verificados: ${naoVerificados}`);
    console.log('='.repeat(50) + '\n');

    res.json({
      ok: true,
      total: contatos.length,
      validos,
      invalidos,
      naoVerificados,
      validacaoDisponivel: disponivel,
      contatos,
      preview: contatos.slice(0, 3),
    });
  } catch (erro: any) {
    console.log(`  ❌ ERRO: ${erro.message}`);
    console.log('='.repeat(50) + '\n');
    res.status(500).json({ erro: erro.message });
  }
}
