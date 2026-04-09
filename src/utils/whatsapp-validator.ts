/**
 * WhatsApp number validation utilities
 */

import axios from 'axios';
import { config } from '../config';

/**
 * Split array into chunks
 */
export function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

export interface ValidationResult {
  valido: boolean | null;
  wa_id?: string;
  motivo?: string;
}

export interface ValidationResponse {
  resultado: Map<string, ValidationResult>;
  disponivel: boolean;
}

/**
 * Validate WhatsApp numbers using the WhatsApp Business API
 * @param numeros - Array of phone numbers to validate
 * @returns Map of phone numbers to validation results
 */
export async function validarNumerosWhatsApp(numeros: string[]): Promise<ValidationResponse> {
  const resultado = new Map<string, ValidationResult>();
  let disponivel = true;

  if (!config.whatsapp.token || !config.whatsapp.numberId) {
    numeros.forEach((n) => resultado.set(n, { valido: null, motivo: 'Configuração WhatsApp incompleta' }));
    return { resultado, disponivel: false };
  }

  const apiVersion = config.whatsapp.apiVersion;
  const url = `https://graph.facebook.com/v${apiVersion}/${config.whatsapp.numberId}/contacts`;
  const headers = { Authorization: `Bearer ${config.whatsapp.token}` };

  const chunks = chunkArray(numeros, 100);
  for (const chunk of chunks) {
    try {
      const payload = { blocking: 'wait', contacts: chunk };
      const response = await axios.post(url, payload, { headers });
      const contacts = response.data?.contacts || [];

      const retornados = new Set<string>();
      contacts.forEach((c: any) => {
        retornados.add(c.input);
        if (c.status === 'valid') {
          resultado.set(c.input, { valido: true, wa_id: c.wa_id });
        } else {
          resultado.set(c.input, { valido: false, motivo: c.status || 'invalid' });
        }
      });

      // Any number not returned is marked as invalid
      chunk.forEach((n) => {
        if (!retornados.has(n)) {
          resultado.set(n, { valido: false, motivo: 'não verificado' });
        }
      });
    } catch (erro: any) {
      const motivo = erro?.response?.data?.error?.message || erro.message || 'erro de validação';
      const indisponivel = /unsupported post request/i.test(motivo) || /does not exist/i.test(motivo);
      if (indisponivel) {
        disponivel = false;
      }
      chunk.forEach((n) => resultado.set(n, { valido: indisponivel ? null : false, motivo }));
    }
  }

  return { resultado, disponivel };
}
