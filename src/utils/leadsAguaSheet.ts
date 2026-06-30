import { google } from 'googleapis';
import { logger } from './logger';

const SHEET_ID = process.env.GOOGLE_SHEET_ID || '1Duvyp8pp_8_joBpDa1TvgfSuEvcyKedffNm3_soPImo';
const SHEET_NAME = process.env.GOOGLE_LEADS_AGUA_SHEET_NAME || 'leads_agua';
const CLIENT_EMAIL = process.env.GOOGLE_SHEETS_CLIENT_EMAIL || '';
const PRIVATE_KEY = process.env.GOOGLE_SHEETS_PRIVATE_KEY || '';

// Colunas: A=data  B=id_cliente  C=nome_cliente  D=imovel  E=consumo_atual  F=consumo_anterior  G=desvio_%  H=status

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
 * Deduplicação: não cria novo lead se já existe um com status 'novo' para o mesmo cliente.
 */
export async function registrarLeadAgua(params: LeadAguaParams): Promise<{ ok: boolean; duplicado?: boolean; erro?: string }> {
  const auth = getAuth();
  if (!auth) return { ok: false, erro: 'Credenciais não configuradas' };

  try {
    const sheets = google.sheets({ version: 'v4', auth });
    const data = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const idClienteNormalizado = params.idCliente.replace(/\D/g, '');

    // Deduplicação: verificar se já existe lead 'novo' para esse cliente
    const existentes = await listarLeadsAgua('novo');
    if (existentes.some((l) => l.idCliente === idClienteNormalizado)) {
      logger.info('LeadsAguaSheet', `⚠️ Lead duplicado ignorado: ${idClienteNormalizado}`);
      return { ok: true, duplicado: true };
    }

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

export interface LeadAgua {
  rowIndex: number;
  data: string;
  idCliente: string;
  nomeCliente: string;
  imovel: string;
  consumoAtual: string;
  consumoAnterior: string;
  desvioPercent: string;
  status: string;
}

/**
 * Lista todos os leads de água, opcionalmente filtrando por status.
 * Sem filtro retorna todos; statusFiltro='novo' retorna só os pendentes.
 */
export async function listarLeadsAgua(statusFiltro?: string): Promise<LeadAgua[]> {
  const auth = getAuth();
  if (!auth) return [];

  try {
    const sheets = google.sheets({ version: 'v4', auth });
    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!A:H`,
      majorDimension: 'ROWS',
      valueRenderOption: 'FORMATTED_VALUE',
    });

    const rows = result.data?.values || [];
    const leads: LeadAgua[] = [];

    for (let i = 1; i < rows.length; i++) {
      const r = rows[i] || [];
      if (!String(r[0] || '').trim()) continue;
      const status = String(r[7] || '').trim();
      if (statusFiltro && status !== statusFiltro) continue;
      leads.push({
        rowIndex: i + 1,
        data: String(r[0] || ''),
        idCliente: String(r[1] || '').replace(/\D/g, ''),
        nomeCliente: String(r[2] || ''),
        imovel: String(r[3] || ''),
        consumoAtual: String(r[4] || ''),
        consumoAnterior: String(r[5] || ''),
        desvioPercent: String(r[6] || ''),
        status,
      });
    }

    return leads;
  } catch (erro: any) {
    logger.warn('LeadsAguaSheet', `Erro ao listar leads de água: ${erro?.message || erro}`);
    return [];
  }
}

/**
 * Atualiza o status de todos os leads de um cliente (busca por idCliente).
 */
export async function atualizarStatusLeadAgua(
  idCliente: string,
  novoStatus: string
): Promise<{ ok: boolean; atualizados: number; erro?: string }> {
  const auth = getAuth();
  if (!auth) return { ok: false, atualizados: 0, erro: 'Credenciais não configuradas' };

  const clienteNorm = idCliente.replace(/\D/g, '');

  try {
    const todos = await listarLeadsAgua();
    const alvo = todos.filter((l) => l.idCliente === clienteNorm);
    if (!alvo.length) return { ok: true, atualizados: 0 };

    const sheets = google.sheets({ version: 'v4', auth });
    for (const lead of alvo) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `${SHEET_NAME}!H${lead.rowIndex}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [[novoStatus]] },
      });
    }

    logger.info('LeadsAguaSheet', `✅ Status atualizado para "${novoStatus}": ${alvo.length} lead(s) de ${clienteNorm}`);
    return { ok: true, atualizados: alvo.length };
  } catch (erro: any) {
    logger.warn('LeadsAguaSheet', `Erro ao atualizar status: ${erro?.message || erro}`);
    return { ok: false, atualizados: 0, erro: erro?.message };
  }
}
