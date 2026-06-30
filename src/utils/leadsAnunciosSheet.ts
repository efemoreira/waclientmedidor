import { google } from 'googleapis';
import { logger } from './logger';

const SHEET_ID = process.env.GOOGLE_SHEET_ID || '1Duvyp8pp_8_joBpDa1TvgfSuEvcyKedffNm3_soPImo';
const SHEET_NAME = process.env.GOOGLE_LEADS_ANUNCIOS_SHEET_NAME || 'leads_anuncios';
const CLIENT_EMAIL = process.env.GOOGLE_SHEETS_CLIENT_EMAIL || '';
const PRIVATE_KEY = process.env.GOOGLE_SHEETS_PRIVATE_KEY || '';

// Colunas: A=data  B=id_cliente  C=nome  D=endereco  E=qtd_extintores  F=status

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

export interface LeadAnuncioParams {
  idCliente: string;
  nome: string;
  endereco: string;
  qtdExtintores: string;
}

/**
 * Registra um lead de anúncio (prospect que chegou pelo WhatsApp/site).
 */
export async function registrarLeadAnuncio(params: LeadAnuncioParams): Promise<{ ok: boolean; erro?: string }> {
  const auth = getAuth();
  if (!auth) return { ok: false, erro: 'Credenciais não configuradas' };

  try {
    const sheets = google.sheets({ version: 'v4', auth });
    const data = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const idClienteNormalizado = params.idCliente.replace(/\D/g, '');

    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!A:F`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: [[
          data,
          idClienteNormalizado,
          params.nome,
          params.endereco,
          params.qtdExtintores,
          'novo',
        ]],
      },
    });

    logger.info('LeadsAnunciosSheet', `✅ Lead de anúncio registrado: ${params.nome} / ${idClienteNormalizado}`);
    return { ok: true };
  } catch (erro: any) {
    logger.warn('LeadsAnunciosSheet', `Erro ao registrar lead de anúncio: ${erro?.message || erro}`);
    return { ok: false, erro: erro?.message };
  }
}
