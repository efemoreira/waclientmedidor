import { google } from 'googleapis';
import { logger } from './logger';

const SHEET_ID = process.env.GOOGLE_SHEET_ID || '1gWmeKdve801yhFST_O0grBefYW_fDLyCr8nwND_98EQ';
const CLIENT_EMAIL = process.env.GOOGLE_SHEETS_CLIENT_EMAIL || '';
const PRIVATE_KEY = process.env.GOOGLE_SHEETS_PRIVATE_KEY || '';

// Sheet names – each configurable via environment variables
// GOOGLE_SHEET_NAME kept as fallback for the leituras sheet (backward compat with old 'Base')
const LEITURAS_SHEET = process.env.GOOGLE_LEITURAS_SHEET_NAME || process.env.GOOGLE_SHEET_NAME || 'leituras';
const ACUMULADO_SEMANA_SHEET = process.env.GOOGLE_ACUMULADO_SEMANA_SHEET_NAME || 'acumulado_semana';
const ACUMULADO_MES_SHEET = process.env.GOOGLE_ACUMULADO_MES_SHEET_NAME || 'acumulado_mes';
const HISTORICO_RESUMO_SHEET = process.env.GOOGLE_HISTORICO_RESUMO_SHEET_NAME || 'historico_resumo';

const RETENCAO_DIAS = 90;

// leituras columns:        A=Data  B=Id  C=Tipo  D=Leitura_Atual  E=Leitura_Anterior  F=Consumo  G=Dias  H=Media_Dia
// acumulado_semana columns: A=Id   B=Tipo  C=Data_Inicio_Semana  D=Ultima_Leitura  E=Consumo_Acumulado  F=Dias_Acumulados  G=Media_Dia_Semana
// acumulado_mes columns:    A=Id   B=Tipo  C=Data_Inicio_Mes     D=Ultima_Leitura  E=Consumo_Acumulado  F=Dias_Acumulados  G=Media_Dia_Mes
// historico_resumo columns: A=Id   B=Tipo  C=Periodo  D=Data_Inicio  E=Data_Fim  F=Consumo_Total  G=Dias_Total  H=Media_Dia

interface LeituraRow {
  rowIndex: number;
  data: Date;
  dataStr: string;
  id: string;
  tipo: string;
  leituraAtual: number;
}

interface AcumuladoRow {
  rowIndex: number;
  id: string;
  tipo: string;
  dataInicio: string;
  ultimaLeitura: number;
  consumoAcumulado: number;
  diasAcumulados: number;
  mediaDia: number;
}


/**
 * Normaliza a chave privada da conta de serviço Google.
 * Aceita chave em texto plano (com `\n` escapados), entre aspas ou codificada em base64.
 * @param raw - Valor bruto da variável de ambiente GOOGLE_SHEETS_PRIVATE_KEY
 */
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

/**
 * Cria e retorna a instância de autenticação JWT para a API do Google Sheets.
 * Retorna null se as credenciais não estiverem configuradas nas variáveis de ambiente.
 */
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

/**
 * Parsear data no formato brasileiro dd/mm/yyyy para Date
 */
function parseDateBR(dateStr: string): Date | null {
  if (!dateStr) return null;
  const match = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return null;
  const d = new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]));
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Formata um número para string: inteiros sem casas decimais, outros com até 4 casas (zeros à direita removidos).
 * @param n - Número a formatar
 */
function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(4).replace(/\.?0+$/, '');
}

/**
 * Formata um objeto Date para string no padrão brasileiro dd/mm/yyyy,
 * sem conversão de fuso horário (usa os valores do objeto Date diretamente).
 * @param d - Data a formatar
 */
function formatDateBR(d: Date): string {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

/**
 * Calcular o número da semana do ano (semana começa no domingo)
 */
export function getWeekOfYear(date: Date): number {
  const start = new Date(date.getFullYear(), 0, 1);
  const startDay = start.getDay();
  const dayOfYear = Math.floor((date.getTime() - start.getTime()) / 86400000);
  return Math.floor((dayOfYear + startDay) / 7) + 1;
}

/**
 * Detectar início da semana atual: domingo (00:00)
 */
export function detectarInicioSemana(agora: Date): Date {
  const d = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
  d.setDate(d.getDate() - d.getDay());
  return d;
}

/** Backward-compat alias */
export const domingoAtual = detectarInicioSemana;

/**
 * Detectar início do mês atual: primeiro dia (00:00)
 */
export function detectarInicioMes(agora: Date): Date {
  return new Date(agora.getFullYear(), agora.getMonth(), 1);
}

/** Backward-compat alias */
export const primeiroDiaMes = detectarInicioMes;

export function detectarViradaSemana(agora: Date): boolean {
  return agora.getDay() === 0;
}

export function detectarViradaMes(agora: Date): boolean {
  return agora.getDate() === 1;
}

/**
 * Buscar a última leitura de um Id+Tipo
 */
export function buscarUltimaLeitura(
  dados: LeituraRow[],
  id: string,
  tipo: string
): { leituraAtual: number; data: Date; dataStr: string } | null {
  const filtrados = dados
    .filter(r => r.id === id && r.tipo.toLowerCase() === tipo.toLowerCase())
    .sort((a, b) => b.data.getTime() - a.data.getTime());
  if (!filtrados.length) return null;
  return { leituraAtual: filtrados[0].leituraAtual, data: filtrados[0].data, dataStr: filtrados[0].dataStr };
}

/**
 * Calcular dias entre duas datas (diferença real)
 */
export function calcularDias(dataAtual: Date, dataAnterior: Date): number {
  const msPerDay = 1000 * 60 * 60 * 24;
  return Math.round((dataAtual.getTime() - dataAnterior.getTime()) / msPerDay);
}

/**
 * Calcular consumo individual: leituraAtual - leituraAnterior
 */
export function calcularConsumoIndividual(leituraAtual: number, leituraAnterior: number): number {
  return leituraAtual - leituraAnterior;
}

/**
 * Calcular média por dia: consumo / dias (0 se dias === 0)
 */
export function calcularMedia(consumo: number, dias: number): number {
  if (dias === 0) return 0;
  return consumo / dias;
}

/**
 * Calcular consumo e média da semana a partir de leituras em memória (backward compat)
 */
export function calcularPeriodoSemana(
  dados: LeituraRow[],
  id: string,
  tipo: string,
  agora: Date
): { consumoSemana: number; mediaSemana: number } {
  const inicio = detectarInicioSemana(agora);
  const registros = dados
    .filter(r => r.id === id && r.tipo.toLowerCase() === tipo.toLowerCase() && r.data >= inicio)
    .sort((a, b) => a.data.getTime() - b.data.getTime());
  if (registros.length < 2) return { consumoSemana: 0, mediaSemana: 0 };
  const consumoSemana = calcularConsumoIndividual(
    registros[registros.length - 1].leituraAtual,
    registros[0].leituraAtual
  );
  const hoje = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
  const diasSemana = calcularDias(hoje, inicio) || 1;
  return { consumoSemana, mediaSemana: calcularMedia(consumoSemana, diasSemana) };
}

/**
 * Calcular consumo e média do mês a partir de leituras em memória (backward compat)
 */
export function calcularPeriodoMes(
  dados: LeituraRow[],
  id: string,
  tipo: string,
  agora: Date
): { consumoMes: number; mediaMes: number } {
  const inicio = detectarInicioMes(agora);
  const registros = dados
    .filter(r => r.id === id && r.tipo.toLowerCase() === tipo.toLowerCase() && r.data >= inicio)
    .sort((a, b) => a.data.getTime() - b.data.getTime());
  if (registros.length < 2) return { consumoMes: 0, mediaMes: 0 };
  const consumoMes = calcularConsumoIndividual(
    registros[registros.length - 1].leituraAtual,
    registros[0].leituraAtual
  );
  return { consumoMes, mediaMes: calcularMedia(consumoMes, agora.getDate()) };
}

/**
 * Verificar se a data de início pertence à semana atual
 */
function isCurrentWeek(dataInicioStr: string, domingo: Date): boolean {
  const d = parseDateBR(dataInicioStr);
  if (!d) return false;
  return d.getTime() === domingo.getTime();
}

/**
 * Verificar se a data de início pertence ao mês atual
 */
function isCurrentMonth(dataInicioStr: string, primeiroDia: Date): boolean {
  const d = parseDateBR(dataInicioStr);
  if (!d) return false;
  return d.getFullYear() === primeiroDia.getFullYear() && d.getMonth() === primeiroDia.getMonth();
}

/**
 * Ler todos os dados da aba leituras (A:D)
 */
async function lerLeituras(
  sheets: ReturnType<typeof google.sheets>
): Promise<{ rows: LeituraRow[]; totalLinhas: number }> {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${LEITURAS_SHEET}!A:D`,
    majorDimension: 'ROWS',
    valueRenderOption: 'FORMATTED_VALUE',
  });

  const rawRows = res.data?.values || [];
  const rows: LeituraRow[] = [];

  for (let i = 1; i < rawRows.length; i++) {
    const row = rawRows[i] || [];
    const dataStr = String(row[0] || '').trim();
    const id = String(row[1] || '').trim();
    const tipo = String(row[2] || '').trim();
    const leituraAtual = parseFloat(String(row[3] || '0').replace(',', '.')) || 0;
    if (!dataStr || !id) continue;
    const data = parseDateBR(dataStr);
    if (!data) continue;
    rows.push({ rowIndex: i + 1, data, dataStr, id, tipo, leituraAtual });
  }

  return { rows, totalLinhas: rawRows.length };
}

/**
 * Ler todos os dados de uma aba de acumulado (A:G)
 */
async function lerAcumulado(
  sheets: ReturnType<typeof google.sheets>,
  sheetName: string
): Promise<AcumuladoRow[]> {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${sheetName}!A:G`,
    majorDimension: 'ROWS',
    valueRenderOption: 'FORMATTED_VALUE',
  });

  const rawRows = res.data?.values || [];
  const rows: AcumuladoRow[] = [];

  for (let i = 1; i < rawRows.length; i++) {
    const row = rawRows[i] || [];
    const id = String(row[0] || '').trim();
    const tipo = String(row[1] || '').trim();
    if (!id || !tipo) continue;
    rows.push({
      rowIndex: i + 1,
      id,
      tipo,
      dataInicio: String(row[2] || '').trim(),
      ultimaLeitura: parseFloat(String(row[3] || '0').replace(',', '.')) || 0,
      consumoAcumulado: parseFloat(String(row[4] || '0').replace(',', '.')) || 0,
      diasAcumulados: parseInt(String(row[5] || '0'), 10) || 0,
      mediaDia: parseFloat(String(row[6] || '0').replace(',', '.')) || 0,
    });
  }

  return rows;
}

/**
 * Salvar resumo consolidado no historico_resumo (nunca apagar)
 */
export async function salvarResumoHistorico(
  sheets: ReturnType<typeof google.sheets>,
  params: {
    id: string;
    tipo: string;
    periodo: 'SEMANA' | 'MES';
    dataInicio: string;
    dataFim: string;
    consumoTotal: number;
    diasTotal: number;
    mediaDia: number;
  }
): Promise<void> {
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: `${HISTORICO_RESUMO_SHEET}!A:H`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: [[
        params.id,
        params.tipo,
        params.periodo,
        params.dataInicio,
        params.dataFim,
        fmt(params.consumoTotal),
        params.diasTotal,
        fmt(params.mediaDia),
      ]],
    },
  });
}

/**
 * Atualizar ou criar registro de acumulado_semana por Id + Tipo
 * Reset individual: só reseta quando a semana mudar para aquele Id+Tipo
 */
export async function atualizarAcumuladoSemana(
  sheets: ReturnType<typeof google.sheets>,
  acumulados: AcumuladoRow[],
  params: {
    id: string;
    tipo: string;
    leituraAtual: number;
    consumo: number;
    dias: number;
    dataAtualStr: string;
    agora: Date;
  }
): Promise<{ consumoAcumulado: number; mediaDia: number }> {
  const { id, tipo, leituraAtual, consumo, dias, dataAtualStr, agora } = params;
  const domingo = detectarInicioSemana(agora);
  const domingoStr = formatDateBR(domingo);

  const existente = acumulados.find(
    r => r.id === id && r.tipo.toLowerCase() === tipo.toLowerCase()
  );

  if (!existente) {
    const novaMedia = calcularMedia(consumo, dias);
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: `${ACUMULADO_SEMANA_SHEET}!A:G`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: [[id, tipo, domingoStr, leituraAtual, fmt(consumo), dias, fmt(novaMedia)]],
      },
    });
    return { consumoAcumulado: consumo, mediaDia: novaMedia };
  }

  if (!isCurrentWeek(existente.dataInicio, domingo)) {
    // Semana mudou: salvar histórico e iniciar nova semana
    await salvarResumoHistorico(sheets, {
      id,
      tipo,
      periodo: 'SEMANA',
      dataInicio: existente.dataInicio,
      dataFim: dataAtualStr,
      consumoTotal: existente.consumoAcumulado,
      diasTotal: existente.diasAcumulados,
      mediaDia: existente.mediaDia,
    });
    const novaMedia = calcularMedia(consumo, dias);
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${ACUMULADO_SEMANA_SHEET}!A${existente.rowIndex}:G${existente.rowIndex}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[id, tipo, domingoStr, leituraAtual, fmt(consumo), dias, fmt(novaMedia)]],
      },
    });
    return { consumoAcumulado: consumo, mediaDia: novaMedia };
  }

  // Semana atual: acumular
  const novoConsumo = existente.consumoAcumulado + consumo;
  const novosDias = existente.diasAcumulados + dias;
  const novaMedia = calcularMedia(novoConsumo, novosDias);
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${ACUMULADO_SEMANA_SHEET}!A${existente.rowIndex}:G${existente.rowIndex}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [[id, tipo, existente.dataInicio, leituraAtual, fmt(novoConsumo), novosDias, fmt(novaMedia)]],
    },
  });
  return { consumoAcumulado: novoConsumo, mediaDia: novaMedia };
}

/**
 * Atualizar ou criar registro de acumulado_mes por Id + Tipo
 * Reset individual: só reseta quando o mês mudar para aquele Id+Tipo
 */
export async function atualizarAcumuladoMes(
  sheets: ReturnType<typeof google.sheets>,
  acumulados: AcumuladoRow[],
  params: {
    id: string;
    tipo: string;
    leituraAtual: number;
    consumo: number;
    dias: number;
    dataAtualStr: string;
    agora: Date;
  }
): Promise<{ consumoAcumulado: number; mediaDia: number }> {
  const { id, tipo, leituraAtual, consumo, dias, dataAtualStr, agora } = params;
  const primeiroDia = detectarInicioMes(agora);
  const primeiroDiaStr = formatDateBR(primeiroDia);

  const existente = acumulados.find(
    r => r.id === id && r.tipo.toLowerCase() === tipo.toLowerCase()
  );

  if (!existente) {
    const novaMedia = calcularMedia(consumo, dias);
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: `${ACUMULADO_MES_SHEET}!A:G`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: [[id, tipo, primeiroDiaStr, leituraAtual, fmt(consumo), dias, fmt(novaMedia)]],
      },
    });
    return { consumoAcumulado: consumo, mediaDia: novaMedia };
  }

  if (!isCurrentMonth(existente.dataInicio, primeiroDia)) {
    // Mês mudou: salvar histórico e iniciar novo mês
    await salvarResumoHistorico(sheets, {
      id,
      tipo,
      periodo: 'MES',
      dataInicio: existente.dataInicio,
      dataFim: dataAtualStr,
      consumoTotal: existente.consumoAcumulado,
      diasTotal: existente.diasAcumulados,
      mediaDia: existente.mediaDia,
    });
    const novaMedia = calcularMedia(consumo, dias);
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${ACUMULADO_MES_SHEET}!A${existente.rowIndex}:G${existente.rowIndex}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[id, tipo, primeiroDiaStr, leituraAtual, fmt(consumo), dias, fmt(novaMedia)]],
      },
    });
    return { consumoAcumulado: consumo, mediaDia: novaMedia };
  }

  // Mês atual: acumular
  const novoConsumo = existente.consumoAcumulado + consumo;
  const novosDias = existente.diasAcumulados + dias;
  const novaMedia = calcularMedia(novoConsumo, novosDias);
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${ACUMULADO_MES_SHEET}!A${existente.rowIndex}:G${existente.rowIndex}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [[id, tipo, existente.dataInicio, leituraAtual, fmt(novoConsumo), novosDias, fmt(novaMedia)]],
    },
  });
  return { consumoAcumulado: novoConsumo, mediaDia: novaMedia };
}

/**
 * Agrupar índices de linha consecutivos em intervalos para deleção em batch
 */
function agruparLinhasConsecutivas(indices: number[]): Array<{ start: number; end: number }> {
  if (!indices.length) return [];
  const sorted = [...indices].sort((a, b) => a - b);
  const grupos: Array<{ start: number; end: number }> = [];
  let start = sorted[0];
  let end = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === end + 1) {
      end = sorted[i];
    } else {
      grupos.push({ start, end });
      start = sorted[i];
      end = sorted[i];
    }
  }
  grupos.push({ start, end });
  return grupos;
}

/**
 * Limpar registros antigos da aba leituras (manter apenas últimos 90 dias)
 * Quando `id` é fornecido, remove apenas os registros daquele imóvel específico.
 */
export async function limparDadosAntigos(
  sheets: ReturnType<typeof google.sheets>,
  rows: LeituraRow[],
  agora: Date,
  id?: string
): Promise<void> {
  const limite = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
  limite.setDate(limite.getDate() - RETENCAO_DIAS);

  const linhasParaApagar = rows
    .filter(r => r.data < limite && (!id || r.id === id))
    .map(r => r.rowIndex);

  if (!linhasParaApagar.length) return;

  logger.info('predioSheet', `Removendo ${linhasParaApagar.length} registros antigos (>${RETENCAO_DIAS} dias) da aba ${LEITURAS_SHEET}`);

  const spreadsheet = await sheets.spreadsheets.get({
    spreadsheetId: SHEET_ID,
    fields: 'sheets.properties',
  });

  const sheetProps = spreadsheet.data.sheets?.find(
    s => s.properties?.title === LEITURAS_SHEET
  )?.properties;

  if (!sheetProps || (sheetProps.sheetId == null)) {
    logger.warn('predioSheet', `Aba ${LEITURAS_SHEET} não encontrada para remoção de dados antigos`);
    return;
  }

  const sheetId = sheetProps.sheetId;

  // Agrupar linhas consecutivas e ordenar descrescente (apaga de baixo para cima)
  const grupos = agruparLinhasConsecutivas(linhasParaApagar).sort((a, b) => b.start - a.start);

  const requests = grupos.map(({ start, end }) => ({
    deleteDimension: {
      range: {
        sheetId,
        dimension: 'ROWS',
        startIndex: start - 1, // 0-based
        endIndex: end,          // exclusive
      },
    },
  }));

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: { requests },
  });

  logger.info('predioSheet', `✅ ${linhasParaApagar.length} registros antigos removidos`);
}

/**
 * Obter a última leitura de um imóvel (qualquer tipo)
 */
export async function obterUltimaLeitura(idImovel: string): Promise<{ leitura?: string; data?: string; consumo?: string }> {
  const auth = getAuth();
  if (!auth) {
    logger.warn('Inbox', 'Planilha: credenciais não configuradas');
    return {};
  }

  try {
    const sheets = google.sheets({ version: 'v4', auth });
    const { rows } = await lerLeituras(sheets);

    const filtrados = rows
      .filter(r => r.id === idImovel)
      .sort((a, b) => b.data.getTime() - a.data.getTime());

    if (!filtrados.length) return {};

    const ultima = filtrados[0];
    const anterior = filtrados[1];
    const consumo = anterior
      ? String(calcularConsumoIndividual(ultima.leituraAtual, anterior.leituraAtual))
      : '';

    return {
      data: ultima.dataStr,
      leitura: String(ultima.leituraAtual),
      consumo,
    };
  } catch (erro: any) {
    logger.warn('Inbox', `Planilha: erro ao obter última leitura ${erro?.message || erro}`);
    return {};
  }
}

/**
 * Registrar nova leitura e atualizar acumulados de semana e mês
 *
 * Fluxo:
 *  1) Ler leituras + acumulado_semana + acumulado_mes em paralelo (1 leitura por aba)
 *  2) Calcular consumo individual (leitura atual − anterior do mesmo Id+Tipo)
 *  3) Salvar nova linha na aba leituras
 *  4) Atualizar acumulado_semana por Id+Tipo (reset individual se semana mudou)
 *  5) Atualizar acumulado_mes por Id+Tipo (reset individual se mês mudou)
 *  6) Retenção automática: apagar leituras com mais de 90 dias
 */
export async function appendPredioEntry(params: {
  predio: string;
  numero: string;
  tipo?: string;
  data?: string;
}): Promise<{
  ok: boolean;
  consumo?: string;
  anterior?: string;
  data?: string;
  dias?: number;
  media?: string;
  consumoSemana?: string;
  mediaSemana?: string;
  consumoMes?: string;
  mediaMes?: string;
  row?: number;
  erro?: string;
}> {
  const auth = getAuth();
  if (!auth) {
    logger.warn('Inbox', 'Planilha: credenciais não configuradas');
    return { ok: false, erro: 'Credenciais não configuradas' };
  }

  const agora = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  const dataStr = params.data || agora.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const tipo = (params.tipo || '').toLowerCase();
  const leituraAtual = parseFloat(params.numero.replace(',', '.')) || 0;

  const sheets = google.sheets({ version: 'v4', auth });

  try {
    // 1) Ler cada aba apenas uma vez, em paralelo
    const [{ rows: leituras, totalLinhas }, acumuladosSemana, acumuladosMes] = await Promise.all([
      lerLeituras(sheets),
      lerAcumulado(sheets, ACUMULADO_SEMANA_SHEET),
      lerAcumulado(sheets, ACUMULADO_MES_SHEET),
    ]);

    // 2) Calcular valores individuais
    const ultimaAnterior = buscarUltimaLeitura(leituras, params.predio, tipo);
    const leituraAnterior = ultimaAnterior ? ultimaAnterior.leituraAtual : 0;
    const dataAtual = parseDateBR(dataStr) || agora;
    const dias = ultimaAnterior ? calcularDias(dataAtual, ultimaAnterior.data) : 0;
    const consumo = ultimaAnterior ? calcularConsumoIndividual(leituraAtual, leituraAnterior) : 0;
    const media = calcularMedia(consumo, dias);

    const targetRow = totalLinhas + 1;

    logger.info('predioSheet', `Gravando linha ${targetRow} [${params.predio}/${tipo}] leitura=${leituraAtual} consumo=${consumo} dias=${dias}`);

    // 3) Salvar nova linha em leituras (8 colunas, sem fórmulas)
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: {
        valueInputOption: 'USER_ENTERED',
        data: [
          { range: `${LEITURAS_SHEET}!A${targetRow}`, values: [[dataStr]] },
          { range: `${LEITURAS_SHEET}!B${targetRow}`, values: [[params.predio]] },
          { range: `${LEITURAS_SHEET}!C${targetRow}`, values: [[tipo]] },
          { range: `${LEITURAS_SHEET}!D${targetRow}`, values: [[leituraAtual]] },
          { range: `${LEITURAS_SHEET}!E${targetRow}`, values: [[leituraAnterior]] },
          { range: `${LEITURAS_SHEET}!F${targetRow}`, values: [[consumo]] },
          { range: `${LEITURAS_SHEET}!G${targetRow}`, values: [[dias]] },
          { range: `${LEITURAS_SHEET}!H${targetRow}`, values: [[fmt(media)]] },
        ],
      },
    });

    // 4) Atualizar acumulado_semana (reset individual por Id+Tipo se semana mudou)
    const semanaResult = await atualizarAcumuladoSemana(sheets, acumuladosSemana, {
      id: params.predio,
      tipo,
      leituraAtual,
      consumo,
      dias,
      dataAtualStr: dataStr,
      agora,
    });

    // 5) Atualizar acumulado_mes (reset individual por Id+Tipo se mês mudou)
    const mesResult = await atualizarAcumuladoMes(sheets, acumuladosMes, {
      id: params.predio,
      tipo,
      leituraAtual,
      consumo,
      dias,
      dataAtualStr: dataStr,
      agora,
    });

    // 6) Retenção automática: apagar leituras com mais de 90 dias (apenas deste imóvel)
    await limparDadosAntigos(sheets, leituras, agora, params.predio);

    return {
      ok: true,
      consumo: fmt(consumo),
      anterior: leituraAnterior > 0 || ultimaAnterior ? String(leituraAnterior) : '',
      data: dataStr,
      dias,
      media: fmt(media),
      consumoSemana: fmt(semanaResult.consumoAcumulado),
      mediaSemana: fmt(semanaResult.mediaDia),
      consumoMes: fmt(mesResult.consumoAcumulado),
      mediaMes: fmt(mesResult.mediaDia),
      row: targetRow,
    };
  } catch (erro: any) {
    logger.warn('predioSheet', `Erro ao registrar leitura: ${erro?.message || erro}`);
    return { ok: false, erro: erro?.message };
  }
}
