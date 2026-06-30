import { google } from 'googleapis';
import { logger } from './logger';

const SHEET_ID = process.env.GOOGLE_SHEET_ID || '1Duvyp8pp_8_joBpDa1TvgfSuEvcyKedffNm3_soPImo';
const SHEET_NAME = process.env.GOOGLE_EXTINTORES_SHEET_NAME || 'extintores';
const CLIENT_EMAIL = process.env.GOOGLE_SHEETS_CLIENT_EMAIL || '';
const PRIVATE_KEY = process.env.GOOGLE_SHEETS_PRIVATE_KEY || '';

// Colunas da aba extintores:
// A=id_cliente  B=nome_cliente  C=imovel  D=local_setor  E=tipo  F=capacidade
// G=data_vencimento  H=data_ultima_inspecao  I=proxima_inspecao
// J=data_lembrete_vencimento  K=data_lembrete_inspecao  L=confirmado_em

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

function parseDateBR(dateStr: string): Date | null {
  if (!dateStr) return null;
  const m = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  return isNaN(d.getTime()) ? null : d;
}

function hoje(): string {
  return new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

function diasAte(dataStr: string): number | null {
  const data = parseDateBR(dataStr);
  if (!data) return null;
  const agora = new Date();
  const agoraDia = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
  return Math.round((data.getTime() - agoraDia.getTime()) / (1000 * 60 * 60 * 24));
}

function nomeMes(dataStr: string): string {
  const data = parseDateBR(dataStr);
  if (!data) return dataStr;
  return data.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' });
}

export interface ExtintorRow {
  rowIndex: number;
  idCliente: string;
  nomeCliente: string;
  imovel: string;
  localSetor: string;
  tipo: string;
  capacidade: string;
  dataVencimento: string;
  dataUltimaInspecao: string;
  proximaInspecao: string;
  dataLembreteVencimento: string;
  dataLembreteInspecao: string;
  confirmadoEm: string;
}

export interface ExtintorVencendo extends ExtintorRow {
  diasRestantes: number;
  mesPorExtenso: string;
}

async function lerExtintores(sheets: ReturnType<typeof google.sheets>): Promise<ExtintorRow[]> {
  const result = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_NAME}!A:L`,
    majorDimension: 'ROWS',
    valueRenderOption: 'FORMATTED_VALUE',
  });

  const rows = result.data?.values || [];
  const extintores: ExtintorRow[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i] || [];
    if (!String(r[0] || '').trim()) continue;
    extintores.push({
      rowIndex: i + 1,
      idCliente: String(r[0] || '').replace(/\D/g, ''),
      nomeCliente: String(r[1] || ''),
      imovel: String(r[2] || ''),
      localSetor: String(r[3] || ''),
      tipo: String(r[4] || ''),
      capacidade: String(r[5] || ''),
      dataVencimento: String(r[6] || ''),
      dataUltimaInspecao: String(r[7] || ''),
      proximaInspecao: String(r[8] || ''),
      dataLembreteVencimento: String(r[9] || ''),
      dataLembreteInspecao: String(r[10] || ''),
      confirmadoEm: String(r[11] || ''),
    });
  }
  return extintores;
}

/**
 * Retorna extintores com vencimento nos próximos `diasLimite` dias
 * que ainda não foram lembrados (ou lembrete foi enviado há mais de 25 dias).
 */
export async function listarExtintoresVencendoEm(diasLimite = 30): Promise<ExtintorVencendo[]> {
  const auth = getAuth();
  if (!auth) return [];

  try {
    const sheets = google.sheets({ version: 'v4', auth });
    const todos = await lerExtintores(sheets);
    const resultado: ExtintorVencendo[] = [];

    for (const ext of todos) {
      const dias = diasAte(ext.dataVencimento);
      if (dias === null || dias < 0 || dias > diasLimite) continue;

      // Não reenviar se lembrete foi enviado nos últimos 25 dias
      const ultimoLembrete = parseDateBR(ext.dataLembreteVencimento);
      if (ultimoLembrete) {
        const diffLembrete = (Date.now() - ultimoLembrete.getTime()) / (1000 * 60 * 60 * 24);
        if (diffLembrete < 25) continue;
      }

      resultado.push({ ...ext, diasRestantes: dias, mesPorExtenso: nomeMes(ext.dataVencimento) });
    }

    return resultado;
  } catch (erro: any) {
    logger.warn('ExtintoresSheet', `Erro ao listar extintores vencendo: ${erro?.message || erro}`);
    return [];
  }
}

/**
 * Retorna extintores com inspeção semestral devida nos próximos `diasLimite` dias.
 */
export async function listarExtintoresComInspecaoProxima(diasLimite = 14): Promise<ExtintorVencendo[]> {
  const auth = getAuth();
  if (!auth) return [];

  try {
    const sheets = google.sheets({ version: 'v4', auth });
    const todos = await lerExtintores(sheets);
    const resultado: ExtintorVencendo[] = [];

    for (const ext of todos) {
      if (!ext.proximaInspecao) continue;
      const dias = diasAte(ext.proximaInspecao);
      if (dias === null || dias < 0 || dias > diasLimite) continue;

      const ultimoLembrete = parseDateBR(ext.dataLembreteInspecao);
      if (ultimoLembrete) {
        const diffLembrete = (Date.now() - ultimoLembrete.getTime()) / (1000 * 60 * 60 * 24);
        if (diffLembrete < 10) continue;
      }

      resultado.push({ ...ext, diasRestantes: dias, mesPorExtenso: nomeMes(ext.proximaInspecao) });
    }

    return resultado;
  } catch (erro: any) {
    logger.warn('ExtintoresSheet', `Erro ao listar inspeções próximas: ${erro?.message || erro}`);
    return [];
  }
}

/**
 * Marca que o lembrete de vencimento foi enviado para o extintor na linha `rowIndex`.
 */
export async function marcarLembreteVencimentoEnviado(rowIndex: number): Promise<void> {
  const auth = getAuth();
  if (!auth) return;
  try {
    const sheets = google.sheets({ version: 'v4', auth });
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!J${rowIndex}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[hoje()]] },
    });
  } catch (erro: any) {
    logger.warn('ExtintoresSheet', `Erro ao marcar lembrete de vencimento: ${erro?.message || erro}`);
  }
}

/**
 * Marca que o lembrete de inspeção foi enviado para o extintor na linha `rowIndex`.
 */
export async function marcarLembreteInspecaoEnviado(rowIndex: number): Promise<void> {
  const auth = getAuth();
  if (!auth) return;
  try {
    const sheets = google.sheets({ version: 'v4', auth });
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!K${rowIndex}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[hoje()]] },
    });
  } catch (erro: any) {
    logger.warn('ExtintoresSheet', `Erro ao marcar lembrete de inspeção: ${erro?.message || erro}`);
  }
}

/**
 * Busca extintores com lembrete enviado e sem confirmação para um cliente.
 * Usado para processar a resposta "SIM" do cliente.
 */
export async function buscarExtintoresAguardandoConfirmacao(idCliente: string): Promise<ExtintorRow[]> {
  const auth = getAuth();
  if (!auth) return [];

  try {
    const sheets = google.sheets({ version: 'v4', auth });
    const todos = await lerExtintores(sheets);
    const clienteNormalizado = idCliente.replace(/\D/g, '');

    return todos.filter(
      (e) =>
        e.idCliente === clienteNormalizado &&
        e.dataLembreteVencimento &&
        !e.confirmadoEm
    );
  } catch (erro: any) {
    logger.warn('ExtintoresSheet', `Erro ao buscar extintores aguardando confirmação: ${erro?.message || erro}`);
    return [];
  }
}

/**
 * Marca os extintores como confirmados (cliente respondeu SIM).
 */
export async function marcarExtintoresConfirmados(rowIndexes: number[]): Promise<void> {
  const auth = getAuth();
  if (!auth) return;

  try {
    const sheets = google.sheets({ version: 'v4', auth });
    const data = [[hoje()]];
    for (const rowIndex of rowIndexes) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `${SHEET_NAME}!L${rowIndex}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: data },
      });
    }
  } catch (erro: any) {
    logger.warn('ExtintoresSheet', `Erro ao marcar extintores confirmados: ${erro?.message || erro}`);
  }
}
