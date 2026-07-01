import { google } from 'googleapis';
import { logger } from './logger';

const SHEET_ID = process.env.GOOGLE_SHEET_ID || '1Duvyp8pp_8_joBpDa1TvgfSuEvcyKedffNm3_soPImo';
const SHEET_NAME = process.env.GOOGLE_CLIENTES_SHEET_NAME || 'clientes';
const CLIENT_EMAIL = process.env.GOOGLE_SHEETS_CLIENT_EMAIL || '';
const PRIVATE_KEY = process.env.GOOGLE_SHEETS_PRIVATE_KEY || '';

// Colunas da aba clientes:
// A=id_cliente(celular)  B=nome  C=lgpd_aceite_data  D=data_inscricao
// E=uid_indicador  F=creditos_indicacao

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

function hoje(): string {
  return new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

export interface ClienteInfo {
  idCliente: string; // celular normalizado (PK)
  nome: string;
  lgpdAceiteData: string;
  dataInscricao: string;
  uidIndicador: string;
  creditosIndicacao: number;
}

async function lerClientes(sheets: ReturnType<typeof google.sheets>): Promise<ClienteInfo[]> {
  const result = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_NAME}!A:F`,
    majorDimension: 'ROWS',
    valueRenderOption: 'FORMATTED_VALUE',
  });
  const rows = result.data?.values || [];
  const clientes: ClienteInfo[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const id = String(r[0] || '').replace(/\D/g, '');
    if (!id) continue;
    clientes.push({
      idCliente: id,
      nome: String(r[1] || ''),
      lgpdAceiteData: String(r[2] || ''),
      dataInscricao: String(r[3] || ''),
      uidIndicador: String(r[4] || ''),
      creditosIndicacao: Number(String(r[5] || '0').replace(',', '.')) || 0,
    });
  }
  return clientes;
}

/**
 * Verifica se um celular já tem cadastro na aba clientes.
 */
export async function verificarCliente(celular: string): Promise<{
  existe: boolean;
  cliente?: ClienteInfo;
  erro?: string;
}> {
  const auth = getAuth();
  if (!auth) return { existe: false, erro: 'Credenciais não configuradas' };

  try {
    const sheets = google.sheets({ version: 'v4', auth });
    const clientes = await lerClientes(sheets);
    const cel = celular.replace(/\D/g, '');
    const encontrado = clientes.find((c) => c.idCliente === cel);
    return { existe: !!encontrado, cliente: encontrado };
  } catch (erro: any) {
    logger.warn('ClientesSheet', `Erro ao verificar cliente: ${erro?.message}`);
    return { existe: false, erro: erro?.message };
  }
}

/**
 * Busca dados de um cliente pelo celular.
 */
export async function buscarClientePorCelular(celular: string): Promise<ClienteInfo | null> {
  const auth = getAuth();
  if (!auth) return null;
  try {
    const sheets = google.sheets({ version: 'v4', auth });
    const clientes = await lerClientes(sheets);
    const cel = celular.replace(/\D/g, '');
    return clientes.find((c) => c.idCliente === cel) || null;
  } catch (erro: any) {
    logger.warn('ClientesSheet', `Erro ao buscar cliente: ${erro?.message}`);
    return null;
  }
}

/**
 * Adiciona um cliente novo na aba clientes.
 * Se o celular já existir, retorna ok=true sem duplicar.
 */
export async function adicionarCliente(params: {
  celular: string;
  nome: string;
  lgpdAceiteData?: string;
  uidIndicador?: string;
}): Promise<{ ok: boolean; jaExistia?: boolean; erro?: string }> {
  const auth = getAuth();
  if (!auth) return { ok: false, erro: 'Credenciais não configuradas' };

  try {
    const sheets = google.sheets({ version: 'v4', auth });
    const cel = params.celular.replace(/\D/g, '');

    // Deduplicação
    const clientes = await lerClientes(sheets);
    if (clientes.some((c) => c.idCliente === cel)) {
      logger.info('ClientesSheet', `Cliente já existe: ${cel}`);
      return { ok: true, jaExistia: true };
    }

    // Usa update em linha explícita (evita desalinhamento de tabela)
    const colA = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!A:A`,
      majorDimension: 'COLUMNS',
      valueRenderOption: 'FORMATTED_VALUE',
    });
    const proximaLinha = (colA.data?.values?.[0]?.length || 1) + 1;

    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!A${proximaLinha}:F${proximaLinha}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[
          cel,
          params.nome,
          params.lgpdAceiteData || hoje(),
          hoje(),
          params.uidIndicador || '',
          0,
        ]],
      },
    });

    // Creditar indicação se uid_indicador válido
    const uidInd = (params.uidIndicador || '').trim();
    if (uidInd && !/^(não|nao)$/i.test(uidInd)) {
      await _incrementarCreditoIndicador(sheets, uidInd);
    }

    logger.info('ClientesSheet', `✅ Cliente adicionado: ${params.nome} (${cel})`);
    return { ok: true };
  } catch (erro: any) {
    logger.warn('ClientesSheet', `Erro ao adicionar cliente: ${erro?.message}`);
    return { ok: false, erro: erro?.message };
  }
}

async function _incrementarCreditoIndicador(
  sheets: ReturnType<typeof google.sheets>,
  uidIndicador: string
): Promise<void> {
  // uid_indicador é o idCliente (celular) do indicador
  const cel = uidIndicador.replace(/\D/g, '');
  const colA = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_NAME}!A:A`,
    majorDimension: 'COLUMNS',
    valueRenderOption: 'FORMATTED_VALUE',
  });
  const valores = colA.data?.values?.[0] || [];
  let row = -1;
  for (let i = 1; i < valores.length; i++) {
    if (String(valores[i]).replace(/\D/g, '') === cel) { row = i + 1; break; }
  }
  if (row < 0) return;

  const credRes = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_NAME}!F${row}`,
    valueRenderOption: 'FORMATTED_VALUE',
  });
  const atual = Number(String(credRes.data?.values?.[0]?.[0] || '0').replace(',', '.')) || 0;
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_NAME}!F${row}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [[atual + 1]] },
  });
}

/**
 * Lista todos os clientes (um por celular).
 */
export async function listarTodosClientes(): Promise<ClienteInfo[]> {
  const auth = getAuth();
  if (!auth) return [];
  try {
    const sheets = google.sheets({ version: 'v4', auth });
    return await lerClientes(sheets);
  } catch (erro: any) {
    logger.warn('ClientesSheet', `Erro ao listar clientes: ${erro?.message}`);
    return [];
  }
}
