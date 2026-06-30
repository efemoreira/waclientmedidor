import { google } from 'googleapis';
import { logger } from './logger';

const SHEET_ID = process.env.GOOGLE_SHEET_ID || '1Duvyp8pp_8_joBpDa1TvgfSuEvcyKedffNm3_soPImo';
const SHEET_NAME = process.env.GOOGLE_LEADS_AGUA_SHEET_NAME || 'leads_agua';
const CLIENT_EMAIL = process.env.GOOGLE_SHEETS_CLIENT_EMAIL || '';
const PRIVATE_KEY = process.env.GOOGLE_SHEETS_PRIVATE_KEY || '';

// Colunas: A=data  B=id_cliente  C=imovel  D=consumo_atual  E=consumo_anterior  F=desvio_%  G=status

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

export interface LeadAguaParams {
  idCliente: string;
  nomeCliente?: string;
  imovel: string;
  consumoAtual: number;
  consumoAnterior: number;
  desvioPercent: number;
}

/**
 * Registra um lead de manutenção hidráulica quando consumo anormal é detectado.
 */
export async function registrarLeadAgua(params: LeadAguaParams): Promise<{ ok: boolean; erro?: string }> {
  const auth = getAuth();
  if (!auth) return { ok: false, erro: 'Credenciais não configuradas' };

  try {
    const sheets = google.sheets({ version: 'v4', auth });
    const data = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const idClienteNormalizado = params.idCliente.replace(/\D/g, '');

    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!A:G`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: [[
          data,
          idClienteNormalizado,
          params.nomeCliente || '',
          params.imovel,
          params.consumoAtual.toFixed(2),
          params.consumoAnterior.toFixed(2),
          params.desvioPercent.toFixed(1) + '%',
          'novo',
        ]],
      },
    });

    logger.info('LeadsAguaSheet', `✅ Lead de água registrado: ${idClienteNormalizado} / ${params.imovel} (+${params.desvioPercent.toFixed(1)}%)`);
    return { ok: true };
  } catch (erro: any) {
    logger.warn('LeadsAguaSheet', `Erro ao registrar lead de água: ${erro?.message || erro}`);
    return { ok: false, erro: erro?.message };
  }
}
