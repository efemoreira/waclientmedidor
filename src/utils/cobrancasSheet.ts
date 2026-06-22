import { google } from 'googleapis';
import { logger } from './logger';

const SHEET_ID = process.env.GOOGLE_SHEET_ID || '1Duvyp8pp_8_joBpDa1TvgfSuEvcyKedffNm3_soPImo';
const SHEET_NAME = process.env.GOOGLE_COBRANCAS_SHEET_NAME || 'cobrancas';
const CLIENT_EMAIL = process.env.GOOGLE_SHEETS_CLIENT_EMAIL || '';
const PRIVATE_KEY = process.env.GOOGLE_SHEETS_PRIVATE_KEY || '';

/**
 * Cobrança de R$5 por item extra (imóvel ou tipo de monitoramento adicional).
 * Mantida desligada por padrão via BILLING_ENABLED — ver gating em PropertyManager.
 */
export const VALOR_ITEM_EXTRA = Number(process.env.VALOR_ITEM_EXTRA || '5.00');
export const BILLING_ENABLED = process.env.BILLING_ENABLED === 'true';

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

export type StatusCobranca = 'isento_dev' | 'pendente' | 'pago' | 'cancelado';
export type TipoCobranca = 'novo_imovel' | 'novo_tipo_monitoramento';

export interface Cobranca {
  id: string;
  uid: string;
  idImovel: string;
  tipoCobranca: TipoCobranca;
  valorBruto: number;
  creditoAplicado: number;
  valorFinal: number;
  status: StatusCobranca;
  data: string;
  referenciaExterna: string;
  linha: number;
}

async function lerCobrancas(sheets: ReturnType<typeof google.sheets>): Promise<Cobranca[]> {
  const result = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_NAME}!A:J`,
    majorDimension: 'ROWS',
    valueRenderOption: 'FORMATTED_VALUE',
  });

  const rows = result.data?.values || [];
  const cobrancas: Cobranca[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] || [];
    cobrancas.push({
      id: String(row[0] || ''),
      uid: String(row[1] || ''),
      idImovel: String(row[2] || ''),
      tipoCobranca: (String(row[3] || '') as TipoCobranca),
      valorBruto: Number(String(row[4] || '0').replace(',', '.')) || 0,
      creditoAplicado: Number(String(row[5] || '0').replace(',', '.')) || 0,
      valorFinal: Number(String(row[6] || '0').replace(',', '.')) || 0,
      status: (String(row[7] || '') as StatusCobranca),
      data: String(row[8] || ''),
      referenciaExterna: String(row[9] || ''),
      linha: i + 1,
    });
  }
  return cobrancas;
}

/**
 * Cria um registro de cobrança no ledger. Não chama nenhum gateway de
 * pagamento — apenas registra o que é/seria devido. O bloqueio efetivo do
 * fluxo de cadastro depende de BILLING_ENABLED (ver PropertyManager).
 */
export async function criarCobranca(params: {
  uid: string;
  idImovel: string;
  tipoCobranca: TipoCobranca;
  valorBruto: number;
  creditoAplicado: number;
  status: StatusCobranca;
}): Promise<{ ok: boolean; id?: string; valorFinal?: number; erro?: string }> {
  const auth = getAuth();
  if (!auth) {
    return { ok: false, erro: 'Credenciais não configuradas' };
  }

  try {
    const sheets = google.sheets({ version: 'v4', auth });
    const id = `CB${Date.now()}`;
    const valorFinal = Math.max(0, params.valorBruto - params.creditoAplicado);
    const data = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });

    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!A:J`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: [[
          id,
          params.uid,
          params.idImovel,
          params.tipoCobranca,
          params.valorBruto,
          params.creditoAplicado,
          valorFinal,
          params.status,
          data,
          '',
        ]],
      },
    });

    return { ok: true, id, valorFinal };
  } catch (erro: any) {
    logger.warn('CobrancasSheet', `Erro ao criar cobrança: ${erro?.message || erro}`);
    return { ok: false, erro: erro?.message };
  }
}

/**
 * Marca uma cobrança como paga. Esqueleto de ponto de integração: quando o
 * gateway de pagamento for escolhido, o webhook dele deve chamar esta função
 * com a referência externa da transação confirmada.
 */
export async function marcarComoPago(id: string, referenciaExterna: string): Promise<{ ok: boolean; erro?: string }> {
  const auth = getAuth();
  if (!auth) {
    return { ok: false, erro: 'Credenciais não configuradas' };
  }

  try {
    const sheets = google.sheets({ version: 'v4', auth });
    const cobrancas = await lerCobrancas(sheets);
    const cobranca = cobrancas.find((c) => c.id === id);
    if (!cobranca) {
      return { ok: false, erro: 'Cobrança não encontrada' };
    }

    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!H${cobranca.linha}:J${cobranca.linha}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [['pago', cobranca.data, referenciaExterna]] },
    });

    return { ok: true };
  } catch (erro: any) {
    logger.warn('CobrancasSheet', `Erro ao marcar cobrança como paga: ${erro?.message || erro}`);
    return { ok: false, erro: erro?.message };
  }
}

/**
 * Busca uma cobrança pelo id (usado para checar se já foi paga).
 */
export async function obterCobrancaPorId(id: string): Promise<Cobranca | null> {
  const auth = getAuth();
  if (!auth) return null;

  try {
    const sheets = google.sheets({ version: 'v4', auth });
    const cobrancas = await lerCobrancas(sheets);
    return cobrancas.find((c) => c.id === id) || null;
  } catch (erro: any) {
    logger.warn('CobrancasSheet', `Erro ao buscar cobrança: ${erro?.message || erro}`);
    return null;
  }
}

/**
 * Lista cobranças pendentes de um usuário (uid).
 */
export async function listarCobrancasPendentes(uid: string): Promise<Cobranca[]> {
  const auth = getAuth();
  if (!auth) return [];

  try {
    const sheets = google.sheets({ version: 'v4', auth });
    const cobrancas = await lerCobrancas(sheets);
    return cobrancas.filter((c) => c.uid === uid && c.status === 'pendente');
  } catch (erro: any) {
    logger.warn('CobrancasSheet', `Erro ao listar cobranças pendentes: ${erro?.message || erro}`);
    return [];
  }
}
