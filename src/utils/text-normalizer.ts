/**
 * Text normalization utilities
 */

/**
 * Normalize text by removing diacritics and converting to lowercase
 * @param texto - Text to normalize
 * @returns Normalized text
 */
export function normalizarTexto(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/**
 * Normalize WhatsApp ID to only digits
 * @param id - WhatsApp ID to normalize
 * @returns Normalized ID with only digits
 */
export function normalizarWaId(id: string): string {
  return String(id || '').replace(/\D/g, '');
}
