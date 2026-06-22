import { google } from 'googleapis';
import { logger } from './logger';
import { normalizarTexto } from './text-normalizer';

const SHEET_ID = process.env.GOOGLE_SHEET_ID || '1Duvyp8pp_8_joBpDa1TvgfSuEvcyKedffNm3_soPImo';
const SHEET_NAME = process.env.GOOGLE_ANUNCIOS_SHEET_NAME || 'anuncios';
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

export interface AnuncioAtivo {
  id: string;
  bairro: string;
  tipo: 'imagem' | 'texto';
  conteudoTexto: string;
  mediaUrl: string;
  prioridade: number;
}

interface AnuncioRow {
  id: string;
  bairro: string;
  tipo: string;
  conteudoTexto: string;
  mediaUrl: string;
  ativo: boolean;
  dataInicio: string;
  dataFim: string;
  prioridade: number;
  impressoes: number;
  linha: number;
}

function parseDateBR(dateStr: string): Date | null {
  if (!dateStr) return null;
  const match = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return null;
  const d = new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]));
  return isNaN(d.getTime()) ? null : d;
}

function dentroDaJanela(row: AnuncioRow, agora: Date): boolean {
  const inicio = parseDateBR(row.dataInicio);
  const fim = parseDateBR(row.dataFim);
  if (inicio && agora < inicio) return false;
  if (fim && agora > fim) return false;
  return true;
}

async function lerAnuncios(sheets: ReturnType<typeof google.sheets>): Promise<AnuncioRow[]> {
  const result = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_NAME}!A:J`,
    majorDimension: 'ROWS',
    valueRenderOption: 'FORMATTED_VALUE',
  });

  const rows = result.data?.values || [];
  const anuncios: AnuncioRow[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] || [];
    anuncios.push({
      id: String(row[0] || ''),
      bairro: String(row[1] || ''),
      tipo: String(row[2] || '').toLowerCase(),
      conteudoTexto: String(row[3] || ''),
      mediaUrl: String(row[4] || ''),
      ativo: String(row[5] || '').toLowerCase() === 'true',
      dataInicio: String(row[6] || ''),
      dataFim: String(row[7] || ''),
      prioridade: Number(row[8] || '0') || 0,
      impressoes: Number(row[9] || '0') || 0,
      linha: i + 1,
    });
  }
  return anuncios;
}

/**
 * Busca um anúncio ativo para o bairro informado.
 * Retorna null se não houver nenhum anúncio cadastrado/ativo para o bairro
 * — nesse caso o chamador não deve enviar nada além das mensagens de leitura.
 */
export async function obterAnuncioPorBairro(bairro: string): Promise<AnuncioAtivo | null> {
  const auth = getAuth();
  if (!auth || !bairro) return null;

  try {
    const sheets = google.sheets({ version: 'v4', auth });
    const anuncios = await lerAnuncios(sheets);
    const bairroNormalizado = normalizarTexto(bairro).trim();
    const agora = new Date();

    const candidatos = anuncios.filter(
      (a) =>
        a.ativo &&
        normalizarTexto(a.bairro).trim() === bairroNormalizado &&
        (a.tipo === 'imagem' || a.tipo === 'texto') &&
        dentroDaJanela(a, agora)
    );

    if (!candidatos.length) return null;

    candidatos.sort((a, b) => b.prioridade - a.prioridade);
    const escolhido = candidatos[0];

    return {
      id: escolhido.id,
      bairro: escolhido.bairro,
      tipo: escolhido.tipo as 'imagem' | 'texto',
      conteudoTexto: escolhido.conteudoTexto,
      mediaUrl: escolhido.mediaUrl,
      prioridade: escolhido.prioridade,
    };
  } catch (erro: any) {
    logger.warn('AnunciosSheet', `Erro ao buscar anúncio por bairro: ${erro?.message || erro}`);
    return null;
  }
}

/**
 * Incrementa o contador de impressões de um anúncio enviado.
 */
export async function registrarImpressao(idAnuncio: string): Promise<void> {
  const auth = getAuth();
  if (!auth) return;

  try {
    const sheets = google.sheets({ version: 'v4', auth });
    const anuncios = await lerAnuncios(sheets);
    const anuncio = anuncios.find((a) => a.id === idAnuncio);
    if (!anuncio) return;

    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!J${anuncio.linha}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[anuncio.impressoes + 1]] },
    });
  } catch (erro: any) {
    logger.warn('AnunciosSheet', `Erro ao registrar impressão: ${erro?.message || erro}`);
  }
}

/**
 * Lista todos os anúncios cadastrados (uso administrativo).
 */
export async function listarAnuncios(): Promise<AnuncioRow[]> {
  const auth = getAuth();
  if (!auth) return [];

  try {
    const sheets = google.sheets({ version: 'v4', auth });
    return await lerAnuncios(sheets);
  } catch (erro: any) {
    logger.warn('AnunciosSheet', `Erro ao listar anúncios: ${erro?.message || erro}`);
    return [];
  }
}

/**
 * Cria um novo anúncio (uso administrativo, pode ser chamado por script local).
 */
export async function criarAnuncio(params: {
  bairro: string;
  tipo: 'imagem' | 'texto';
  conteudoTexto: string;
  mediaUrl?: string;
  ativo?: boolean;
  dataInicio?: string;
  dataFim?: string;
  prioridade?: number;
}): Promise<{ ok: boolean; id?: string; erro?: string }> {
  const auth = getAuth();
  if (!auth) {
    return { ok: false, erro: 'Credenciais não configuradas' };
  }

  try {
    const sheets = google.sheets({ version: 'v4', auth });
    const id = `AD${Date.now()}`;

    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!A:J`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: [[
          id,
          params.bairro,
          params.tipo,
          params.conteudoTexto,
          params.mediaUrl || '',
          params.ativo === false ? 'false' : 'true',
          params.dataInicio || '',
          params.dataFim || '',
          params.prioridade ?? 0,
          0,
        ]],
      },
    });

    return { ok: true, id };
  } catch (erro: any) {
    logger.warn('AnunciosSheet', `Erro ao criar anúncio: ${erro?.message || erro}`);
    return { ok: false, erro: erro?.message };
  }
}
