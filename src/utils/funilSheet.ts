import { google } from 'googleapis';
import { logger } from './logger';

const SHEET_ID = process.env.GOOGLE_SHEET_ID || '1Duvyp8pp_8_joBpDa1TvgfSuEvcyKedffNm3_soPImo';
const SHEET_NAME = process.env.GOOGLE_FUNIL_SHEET_NAME || 'funil_eventos';
const CLIENT_EMAIL = process.env.GOOGLE_SHEETS_CLIENT_EMAIL || '';
const PRIVATE_KEY = process.env.GOOGLE_SHEETS_PRIVATE_KEY || '';

// Colunas: A=data_hora  B=telefone  C=etapa  D=detalhe

function normalizarPrivateKey(raw: string): string {
  let key = raw.trim();
  if (key.startsWith('"') && key.endsWith('"')) key = key.slice(1, -1);
  if (key.startsWith('base64:')) return Buffer.from(key.replace(/^base64:/, ''), 'base64').toString('utf8');
  return key.replace(/\\n/g, '\n');
}

function getAuth() {
  if (!CLIENT_EMAIL || !PRIVATE_KEY) return null;
  return new google.auth.JWT({
    email: CLIENT_EMAIL,
    key: normalizarPrivateKey(PRIVATE_KEY),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

/**
 * Registra um evento do funil de conversa (onboarding e captação de lead de anúncio),
 * um por linha, para permitir analisar em qual etapa os contatos estão abandonando.
 *
 * Observacional apenas: nunca lança erro, só loga aviso em caso de falha — uma
 * falha aqui nunca deve interromper o fluxo de conversa do bot.
 */
export async function registrarEventoFunil(
  telefone: string,
  etapa: string,
  detalhe?: string
): Promise<void> {
  const auth = getAuth();
  if (!auth) return;

  try {
    const sheets = google.sheets({ version: 'v4', auth });
    const dataHora = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const telefoneNormalizado = telefone.replace(/\D/g, '');

    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!A:D`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: [[dataHora, telefoneNormalizado, etapa, detalhe || '']],
      },
    });
  } catch (erro: any) {
    logger.warn('FunilSheet', `Erro ao registrar evento de funil (${etapa}): ${erro?.message || erro}`);
  }
}
