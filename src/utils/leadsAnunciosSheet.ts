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
 * Deduplicação: não cria novo lead se já existe um com status 'novo' para o mesmo cliente.
 */
export async function registrarLeadAnuncio(params: LeadAnuncioParams): Promise<{ ok: boolean; duplicado?: boolean; erro?: string }> {
  const auth = getAuth();
  if (!auth) return { ok: false, erro: 'Credenciais não configuradas' };

  try {
    const sheets = google.sheets({ version: 'v4', auth });
    const data = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const idClienteNormalizado = params.idCliente.replace(/\D/g, '');

    // Deduplicação: verificar se já existe lead 'novo' para esse cliente
    const existentes = await listarLeadsAnuncios('novo');
    if (existentes.some((l) => l.idCliente === idClienteNormalizado)) {
      logger.info('LeadsAnunciosSheet', `⚠️ Lead duplicado ignorado: ${idClienteNormalizado}`);
      return { ok: true, duplicado: true };
    }

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

export interface LeadAnuncio {
  rowIndex: number;
  data: string;
  idCliente: string;
  nome: string;
  endereco: string;
  qtdExtintores: string;
  status: string;
}

/**
 * Lista todos os leads de anúncio, opcionalmente filtrando por status.
 */
export async function listarLeadsAnuncios(statusFiltro?: string): Promise<LeadAnuncio[]> {
  const auth = getAuth();
  if (!auth) return [];

  try {
    const sheets = google.sheets({ version: 'v4', auth });
    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!A:F`,
      majorDimension: 'ROWS',
      valueRenderOption: 'FORMATTED_VALUE',
    });

    const rows = result.data?.values || [];
    const leads: LeadAnuncio[] = [];

    for (let i = 1; i < rows.length; i++) {
      const r = rows[i] || [];
      if (!String(r[0] || '').trim()) continue;
      const status = String(r[5] || '').trim();
      if (statusFiltro && status !== statusFiltro) continue;
      leads.push({
        rowIndex: i + 1,
        data: String(r[0] || ''),
        idCliente: String(r[1] || '').replace(/\D/g, ''),
        nome: String(r[2] || ''),
        endereco: String(r[3] || ''),
        qtdExtintores: String(r[4] || ''),
        status,
      });
    }

    return leads;
  } catch (erro: any) {
    logger.warn('LeadsAnunciosSheet', `Erro ao listar leads de anúncio: ${erro?.message || erro}`);
    return [];
  }
}

/**
 * Atualiza o status de todos os leads de anúncio de um cliente (busca por idCliente).
 */
export async function atualizarStatusLeadAnuncio(
  idCliente: string,
  novoStatus: string
): Promise<{ ok: boolean; atualizados: number; erro?: string }> {
  const auth = getAuth();
  if (!auth) return { ok: false, atualizados: 0, erro: 'Credenciais não configuradas' };

  const clienteNorm = idCliente.replace(/\D/g, '');

  try {
    const todos = await listarLeadsAnuncios();
    const alvo = todos.filter((l) => l.idCliente === clienteNorm);
    if (!alvo.length) return { ok: true, atualizados: 0 };

    const sheets = google.sheets({ version: 'v4', auth });
    for (const lead of alvo) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `${SHEET_NAME}!F${lead.rowIndex}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [[novoStatus]] },
      });
    }

    logger.info('LeadsAnunciosSheet', `✅ Status atualizado para "${novoStatus}": ${alvo.length} lead(s) de ${clienteNorm}`);
    return { ok: true, atualizados: alvo.length };
  } catch (erro: any) {
    logger.warn('LeadsAnunciosSheet', `Erro ao atualizar status: ${erro?.message || erro}`);
    return { ok: false, atualizados: 0, erro: erro?.message };
  }
}
