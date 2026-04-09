/**
 * CSV parsing utilities for bulk messaging
 */

import { parse } from 'csv-parse/sync';
import { normalizarNumero } from './phone-normalizer';

/**
 * Remove SEP= line from CSV if present
 */
export function limparLinhaSep(csv: string): string {
  const linhas = csv.split('\n');
  if (linhas[0]?.trim().toLowerCase().startsWith('sep=')) {
    linhas.shift();
  }
  return linhas.join('\n');
}

/**
 * Detect CSV delimiter (comma or semicolon)
 */
export function detectarDelimiter(csv: string): string {
  const primeiraLinha = csv.split('\n').find(l => l.trim()) || '';
  const virgulas = (primeiraLinha.match(/,/g) || []).length;
  const pontosEVirgula = (primeiraLinha.match(/;/g) || []).length;
  return pontosEVirgula > virgulas ? ';' : ',';
}

/**
 * Find the column that contains phone numbers
 */
export function encontrarCampoNumero(obj: Record<string, any>): string | null {
  const keys = Object.keys(obj || {});
  const candidatos = ['telefone', 'numero', 'phone', 'whatsapp', 'celular', 'fone', 'mobile'];
  const direto = keys.find(k => candidatos.includes(k));
  if (direto) return direto;

  const regex = /(tel|fone|cel|whats|phone|mobile|numero|número)/i;
  return keys.find(k => regex.test(k)) || null;
}

/**
 * Parse CSV without header (first column is phone number)
 */
export function parseCsvSemHeader(csv: string): any[] {
  const delimiter = detectarDelimiter(csv);
  const rows = parse(csv, {
    columns: false,
    skip_empty_lines: true,
    relax_column_count: true,
    trim: true,
    bom: true,
    delimiter,
  }) as any[];

  return rows
    .map((row) => ({ numero: normalizarNumero(row?.[0] || '') }))
    .filter((obj) => obj.numero);
}

/**
 * Parse CSV with or without header
 * Automatically detects phone number column
 */
export function parseCsv(csv: string): any[] {
  const cleaned = limparLinhaSep(csv);
  const delimiter = detectarDelimiter(cleaned);
  const primeiraLinha = cleaned.split('\n').find(l => l.trim()) || '';
  const temHeader = /[a-zA-Z]/.test(primeiraLinha);

  if (!temHeader) {
    return parseCsvSemHeader(cleaned);
  }

  const records = parse(cleaned, {
    columns: (header: string[]) => header.map((h: string) => h.trim().toLowerCase()),
    skip_empty_lines: true,
    relax_column_count: true,
    trim: true,
    bom: true,
    delimiter,
  }) as any[];

  const normalized = records
    .map((obj) => {
      const campoNumero = encontrarCampoNumero(obj);
      if (campoNumero && !obj.numero && !obj.telefone) {
        obj.numero = obj[campoNumero];
      }
      if (obj.telefone) obj.telefone = normalizarNumero(obj.telefone);
      if (obj.numero) obj.numero = normalizarNumero(obj.numero);
      return obj;
    })
    .filter((obj) => obj.telefone || obj.numero);

  if (normalized.length === 0) {
    return parseCsvSemHeader(cleaned);
  }

  return normalized;
}
