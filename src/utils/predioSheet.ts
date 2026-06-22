import { google } from 'googleapis';
import { logger } from './logger';

const SHEET_ID = process.env.GOOGLE_SHEET_ID || '1Duvyp8pp_8_joBpDa1TvgfSuEvcyKedffNm3_soPImo';
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

interface ResumoConsumo {
  leituraAnterior?: number;
  diasUltimoEnvio: number;
  consumoUltimoEnvio: number;
  mediaUltimoEnvio: number;
  diasDia: number;
  consumoDia: number;
  mediaDia: number;
  diasSemana: number;
  consumoSemana: number;
  mediaSemana: number;
  diasMes: number;
  consumoMes: number;
  mediaMes: number;
}

export interface ConsumoInsights {
  semHistorico: boolean;
  mediaReferenciaDia?: number;
  faixaNormalMin?: number;
  faixaNormalMax?: number;
  alertaVazamento: boolean;
  nivelAlerta?: 'atencao' | 'forte';
  graficoSemanal: string;
  consumoSemanaAtual: number;
  consumoSemanaAnterior: number;
  consumoMesAtual: number;
  comparacaoCondominioPercent?: number;
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

function ordenarLeiturasPorData(dados: LeituraRow[], id: string, tipo: string): LeituraRow[] {
  return dados
    .filter((r) => r.id === id && r.tipo.toLowerCase() === tipo.toLowerCase())
    .sort((a, b) => a.data.getTime() - b.data.getTime());
}

function buscarLeituraBasePeriodo(registros: LeituraRow[], inicio: Date): LeituraRow | undefined {
  let base: LeituraRow | undefined;

  for (const registro of registros) {
    if (registro.data <= inicio) {
      base = registro;
      continue;
    }
    break;
  }

  if (base) return base;
  return registros.find((registro) => registro.data > inicio);
}

function calcularResumoConsumo(
  dados: LeituraRow[],
  id: string,
  tipo: string,
  leituraAtual: number,
  agora: Date
): ResumoConsumo {
  const registros = ordenarLeiturasPorData(dados, id, tipo);
  const hoje = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
  const inicioDia = hoje;
  const inicioSemana = detectarInicioSemana(agora);
  const inicioMes = detectarInicioMes(agora);

  const ultimaAnterior = registros.length > 0 ? registros[registros.length - 1] : undefined;
  const consumoUltimoEnvio = ultimaAnterior ? Math.max(0, leituraAtual - ultimaAnterior.leituraAtual) : 0;
  const diasUltimoEnvio = ultimaAnterior ? Math.max(1, calcularDias(hoje, ultimaAnterior.data)) : 0;
  const mediaUltimoEnvio = ultimaAnterior ? calcularMedia(consumoUltimoEnvio, diasUltimoEnvio) : 0;

  const calcularPeriodo = (inicio: Date): { consumo: number; media: number } => {
    const base = buscarLeituraBasePeriodo(registros, inicio);
    if (!base) return { consumo: 0, media: 0 };

    const consumo = Math.max(0, leituraAtual - base.leituraAtual);
    const dias = Math.max(1, calcularDias(hoje, inicio));
    return { consumo, media: calcularMedia(consumo, dias) };
  };

  const dia = calcularPeriodo(inicioDia);
  const semana = calcularPeriodo(inicioSemana);
  const mes = calcularPeriodo(inicioMes);

  return {
    leituraAnterior: ultimaAnterior?.leituraAtual,
    diasUltimoEnvio,
    consumoUltimoEnvio,
    mediaUltimoEnvio,
    diasDia: Math.max(1, calcularDias(hoje, inicioDia)),
    consumoDia: dia.consumo,
    mediaDia: dia.media,
    diasSemana: Math.max(1, calcularDias(hoje, inicioSemana)),
    consumoSemana: semana.consumo,
    mediaSemana: semana.media,
    diasMes: Math.max(1, calcularDias(hoje, inicioMes)),
    consumoMes: mes.consumo,
    mediaMes: mes.media,
  };
}

function inicioDoDia(data: Date): Date {
  return new Date(data.getFullYear(), data.getMonth(), data.getDate());
}

function calcularConsumoNoPeriodoPorSerie(
  registros: LeituraRow[],
  inicio: Date,
  fim: Date
): number {
  if (!registros.length) return 0;

  const base = buscarLeituraBasePeriodo(registros, inicio);
  if (!base) return 0;

  const leituraFim = [...registros]
    .filter((r) => r.data <= fim)
    .sort((a, b) => b.data.getTime() - a.data.getTime())[0];

  if (!leituraFim) return 0;
  return Math.max(0, leituraFim.leituraAtual - base.leituraAtual);
}

function montarGraficoSemanal(registros: LeituraRow[], agora: Date): string {
  const inicioSemana = detectarInicioSemana(agora);
  const hoje = inicioDoDia(agora);
  const consumosPorDia: number[] = [0, 0, 0, 0, 0, 0, 0]; // 0=dom ... 6=sab

  for (let i = 1; i < registros.length; i++) {
    const atual = registros[i];
    const anterior = registros[i - 1];
    const diaAtual = inicioDoDia(atual.data);
    if (diaAtual < inicioSemana || diaAtual > hoje) continue;
    const consumoIntervalo = Math.max(0, atual.leituraAtual - anterior.leituraAtual);
    consumosPorDia[diaAtual.getDay()] += consumoIntervalo;
  }

  const ordemSemana = [1, 2, 3, 4, 5, 6, 0]; // seg..dom
  const labels = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab', 'Dom'];
  const valores = ordemSemana.map((idx) => consumosPorDia[idx]);
  const max = Math.max(...valores, 0);

  return labels
    .map((label, index) => {
      const valor = valores[index];
      const blocos = max > 0 ? Math.max(1, Math.round((valor / max) * 8)) : 0;
      return `${label} ${'█'.repeat(blocos)}`.trim();
    })
    .join('\n');
}

export async function obterInsightsConsumo(
  idImovel: string,
  tipo: string,
): Promise<ConsumoInsights> {
  const auth = getAuth();
  if (!auth) {
    return {
      semHistorico: true,
      alertaVazamento: false,
      graficoSemanal: '',
      consumoSemanaAtual: 0,
      consumoSemanaAnterior: 0,
      consumoMesAtual: 0,
    };
  }

  try {
    const agora = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
    const sheets = google.sheets({ version: 'v4', auth });
    const { rows } = await lerLeituras(sheets);
    const registros = ordenarLeiturasPorData(rows, idImovel, tipo);

    if (registros.length < 2) {
      return {
        semHistorico: true,
        alertaVazamento: false,
        graficoSemanal: '',
        consumoSemanaAtual: 0,
        consumoSemanaAnterior: 0,
        consumoMesAtual: 0,
      };
    }

    const intervalos = [] as Array<{ consumo: number; dias: number; mediaDia: number; dataFim: Date }>;
    for (let i = 1; i < registros.length; i++) {
      const atual = registros[i];
      const anterior = registros[i - 1];
      const consumo = Math.max(0, atual.leituraAtual - anterior.leituraAtual);
      const dias = Math.max(1, calcularDias(inicioDoDia(atual.data), inicioDoDia(anterior.data)));
      const mediaDia = calcularMedia(consumo, dias);
      intervalos.push({ consumo, dias, mediaDia, dataFim: inicioDoDia(atual.data) });
    }

    const medias = intervalos.map((i) => i.mediaDia).filter((m) => m > 0);
    const mediaReferenciaDia = medias.length
      ? medias.reduce((soma, v) => soma + v, 0) / medias.length
      : 0;

    const ultimo = intervalos[intervalos.length - 1];
    const penultimo = intervalos.length > 1 ? intervalos[intervalos.length - 2] : undefined;
    const ultimoAcimaForte = mediaReferenciaDia > 0 && ultimo.mediaDia > mediaReferenciaDia * 1.4;
    const ultimoAcimaAtencao = mediaReferenciaDia > 0 && ultimo.mediaDia > mediaReferenciaDia * 1.2;
    const penultimoAcimaForte = !!penultimo && mediaReferenciaDia > 0 && penultimo.mediaDia > mediaReferenciaDia * 1.4;

    // Exige 2 leituras consecutivas acima de 1.4x para declarar alerta forte
    // (evita falso positivo por erro de digitação numa leitura pontual).
    let nivelAlerta: 'atencao' | 'forte' | undefined;
    if (ultimoAcimaForte && penultimoAcimaForte) {
      nivelAlerta = 'forte';
    } else if (ultimoAcimaForte || ultimoAcimaAtencao) {
      nivelAlerta = 'atencao';
    }
    const alertaVazamento = nivelAlerta === 'forte';
    const faixaNormalMin = mediaReferenciaDia > 0 ? mediaReferenciaDia * 0.8 : undefined;
    const faixaNormalMax = mediaReferenciaDia > 0 ? mediaReferenciaDia * 1.2 : undefined;

    const inicioSemanaAtual = detectarInicioSemana(agora);
    const fimSemanaAtual = inicioDoDia(agora);
    const inicioSemanaAnterior = new Date(inicioSemanaAtual);
    inicioSemanaAnterior.setDate(inicioSemanaAtual.getDate() - 7);
    const fimSemanaAnterior = new Date(inicioSemanaAtual);
    fimSemanaAnterior.setDate(inicioSemanaAtual.getDate() - 1);
    const inicioMes = detectarInicioMes(agora);

    const consumoSemanaAtual = calcularConsumoNoPeriodoPorSerie(registros, inicioSemanaAtual, fimSemanaAtual);
    const consumoSemanaAnterior = calcularConsumoNoPeriodoPorSerie(registros, inicioSemanaAnterior, fimSemanaAnterior);
    const consumoMesAtual = calcularConsumoNoPeriodoPorSerie(registros, inicioMes, fimSemanaAtual);

    // Comparação com a média do condomínio (todos os imóveis no mesmo tipo)
    const ids = Array.from(new Set(rows
      .filter((r) => r.tipo.toLowerCase() === tipo.toLowerCase())
      .map((r) => r.id)));

    const consumosMesCondominio = ids
      .map((id) => calcularConsumoNoPeriodoPorSerie(ordenarLeiturasPorData(rows, id, tipo), inicioMes, fimSemanaAtual))
      .filter((v) => v > 0);

    const mediaCondominio = consumosMesCondominio.length
      ? consumosMesCondominio.reduce((soma, v) => soma + v, 0) / consumosMesCondominio.length
      : 0;

    const comparacaoCondominioPercent = mediaCondominio > 0
      ? ((consumoMesAtual - mediaCondominio) / mediaCondominio) * 100
      : undefined;

    return {
      semHistorico: false,
      mediaReferenciaDia,
      faixaNormalMin,
      faixaNormalMax,
      alertaVazamento,
      nivelAlerta,
      graficoSemanal: montarGraficoSemanal(registros, agora),
      consumoSemanaAtual,
      consumoSemanaAnterior,
      consumoMesAtual,
      comparacaoCondominioPercent,
    };
  } catch (erro: any) {
    logger.warn('predioSheet', `Erro ao obter insights de consumo: ${erro?.message || erro}`);
    return {
      semHistorico: true,
      alertaVazamento: false,
      graficoSemanal: '',
      consumoSemanaAtual: 0,
      consumoSemanaAnterior: 0,
      consumoMesAtual: 0,
    };
  }
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

  // Semana atual: atualizar snapshot atual do período
  const novaMedia = calcularMedia(consumo, dias);
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${ACUMULADO_SEMANA_SHEET}!A${existente.rowIndex}:G${existente.rowIndex}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [[id, tipo, existente.dataInicio, leituraAtual, fmt(consumo), dias, fmt(novaMedia)]],
    },
  });
  return { consumoAcumulado: consumo, mediaDia: novaMedia };
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

  // Mês atual: atualizar snapshot atual do período
  const novaMedia = calcularMedia(consumo, dias);
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${ACUMULADO_MES_SHEET}!A${existente.rowIndex}:G${existente.rowIndex}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [[id, tipo, existente.dataInicio, leituraAtual, fmt(consumo), dias, fmt(novaMedia)]],
    },
  });
  return { consumoAcumulado: consumo, mediaDia: novaMedia };
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
  consumoDia?: string;
  mediaDia?: string;
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
    const [{ rows: leituras }, acumuladosSemana, acumuladosMes] = await Promise.all([
      lerLeituras(sheets),
      lerAcumulado(sheets, ACUMULADO_SEMANA_SHEET),
      lerAcumulado(sheets, ACUMULADO_MES_SHEET),
    ]);

    // 2) Calcular valores individuais
    const resumo = calcularResumoConsumo(leituras, params.predio, tipo, leituraAtual, agora);
    const dataAtual = parseDateBR(dataStr) || agora;

    logger.info('predioSheet', `Gravando leitura [${params.predio}/${tipo}] leitura=${leituraAtual} consumo=${resumo.consumoUltimoEnvio} dias=${resumo.diasUltimoEnvio}`);

    // 3) Salvar nova linha em leituras (8 colunas, sem fórmulas)
    const appendResponse = await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: `${LEITURAS_SHEET}!A:H`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: [[
          dataStr,
          params.predio,
          tipo,
          leituraAtual,
          resumo.leituraAnterior || 0,
          resumo.consumoUltimoEnvio,
          resumo.diasUltimoEnvio,
          fmt(resumo.mediaUltimoEnvio),
        ]],
      },
    });

    const updatedRange = appendResponse.data?.updates?.updatedRange || '';
    const rowMatch = updatedRange.match(/![A-Z]+(\d+):/i);
    const targetRow = rowMatch ? Number(rowMatch[1]) : undefined;

    // 4) Atualizar acumulado_semana (reset individual por Id+Tipo se semana mudou)
    const semanaResult = await atualizarAcumuladoSemana(sheets, acumuladosSemana, {
      id: params.predio,
      tipo,
      leituraAtual,
      consumo: resumo.consumoSemana,
      dias: resumo.diasSemana,
      dataAtualStr: dataStr,
      agora,
    });

    // 5) Atualizar acumulado_mes (reset individual por Id+Tipo se mês mudou)
    const mesResult = await atualizarAcumuladoMes(sheets, acumuladosMes, {
      id: params.predio,
      tipo,
      leituraAtual,
      consumo: resumo.consumoMes,
      dias: resumo.diasMes,
      dataAtualStr: dataStr,
      agora,
    });

    // 6) Retenção automática: apagar leituras com mais de 90 dias (apenas deste imóvel)
    await limparDadosAntigos(sheets, leituras, agora, params.predio);

    return {
      ok: true,
      consumo: fmt(resumo.consumoUltimoEnvio),
      anterior: resumo.leituraAnterior !== undefined ? String(resumo.leituraAnterior) : '',
      data: dataStr,
      dias: resumo.diasUltimoEnvio,
      media: fmt(resumo.mediaUltimoEnvio),
      consumoDia: fmt(resumo.consumoDia),
      mediaDia: fmt(resumo.mediaDia),
      consumoSemana: fmt(resumo.consumoSemana),
      mediaSemana: fmt(resumo.mediaSemana),
      consumoMes: fmt(resumo.consumoMes),
      mediaMes: fmt(resumo.mediaMes),
      row: targetRow,
    };
  } catch (erro: any) {
    logger.warn('predioSheet', `Erro ao registrar leitura: ${erro?.message || erro}`);
    return { ok: false, erro: erro?.message };
  }
}
