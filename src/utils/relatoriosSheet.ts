import { google } from 'googleapis';
import { logger } from './logger';

const SHEET_ID = process.env.GOOGLE_SHEET_ID || '1Duvyp8pp_8_joBpDa1TvgfSuEvcyKedffNm3_soPImo';
const SHEET_NAME = process.env.GOOGLE_RELATORIOS_SHEET_NAME || 'relatorios_enviados';
const CLIENT_EMAIL = process.env.GOOGLE_SHEETS_CLIENT_EMAIL || '';
const PRIVATE_KEY = process.env.GOOGLE_SHEETS_PRIVATE_KEY || '';

function normalizarPrivateKey(raw: string): string {
  let key = raw.trim();
  if (key.startsWith('"') && key.endsWith('"')) {
    key = key.slice(1, -1);
  }
  if (key.startsWith('base64:')) {
    const b64 = key.replace(/^base64:/, '');
    return Buffer.from(b64, 'base64').toString('utf8');
  }
  return key.replace(/\\n/g, '\n');
}

function getAuth() {
  if (!CLIENT_EMAIL || !PRIVATE_KEY) {
    return null;
  }

  const key = normalizarPrivateKey(PRIVATE_KEY);
  return new google.auth.JWT({
    email: CLIENT_EMAIL,
    key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

export async function jaEnviadoRelatorio(
  idImovel: string,
  tipo: 'semanal' | 'mensal',
  referencia: string
): Promise<boolean> {
  const auth = getAuth();
  if (!auth) return false;

  try {
    const sheets = google.sheets({ version: 'v4', auth });
    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!A:C`,
      majorDimension: 'ROWS',
      valueRenderOption: 'FORMATTED_VALUE',
    });

    const rows = result.data?.values || [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i] || [];
      const rowImovel = String(row[0] || '').trim();
      const rowTipo = String(row[1] || '').trim().toLowerCase();
      const rowRef = String(row[2] || '').trim();

      if (rowImovel === idImovel && rowTipo === tipo && rowRef === referencia) {
        return true;
      }
    }

    return false;
  } catch (erro: any) {
    logger.warn('RelatoriosSheet', `Erro ao consultar relatórios enviados: ${erro?.message || erro}`);
    return false;
  }
}

export async function registrarRelatorioEnviado(
  idImovel: string,
  tipo: 'semanal' | 'mensal',
  referencia: string
): Promise<void> {
  const auth = getAuth();
  if (!auth) return;

  try {
    const sheets = google.sheets({ version: 'v4', auth });
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!A:C`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: [[idImovel, tipo, referencia]],
      },
    });
  } catch (erro: any) {
    logger.warn('RelatoriosSheet', `Erro ao registrar relatório enviado: ${erro?.message || erro}`);
  }
}
