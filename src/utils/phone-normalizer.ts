/**
 * Utility functions for phone number normalization
 */

/**
 * Normalize phone number to Brazilian format (55 + DDD + number)
 * @param numero - Phone number to normalize
 * @returns Normalized phone number with only digits
 */
export function normalizarNumero(numero: string): string {
  const digits = String(numero || '').replace(/\D/g, '');
  if (!digits) return '';
  return digits.startsWith('55') ? digits : `55${digits}`;
}

/**
 * Validate Brazilian phone number format
 * @param telefone - Phone number to validate
 * @returns true if valid, false otherwise
 */
export function validarTelefone(telefone: string): boolean {
  const cleaned = telefone.replace(/\D/g, '');
  // Validates Brazilian format: 55 + DDD (2 digits) + number (8 or 9 digits)
  const regex = /^55\d{2}9?\d{8}$/;
  return regex.test(cleaned);
}
