import { google } from 'googleapis';
import { logger } from './logger';
import { randomUUID } from 'crypto';
import { buscarClientePorCelular } from './clientesSheet';

const SHEET_ID = process.env.GOOGLE_SHEET_ID || '1Duvyp8pp_8_joBpDa1TvgfSuEvcyKedffNm3_soPImo';
const SHEET_NAME = process.env.GOOGLE_PREDIOS_SHEET_NAME || 'predios';
const CLIENT_EMAIL = process.env.GOOGLE_SHEETS_CLIENT_EMAIL || '';
const PRIVATE_KEY = process.env.GOOGLE_SHEETS_PRIVATE_KEY || '';

// Colunas da aba predios:
// A=uid  B=id_imovel  C=id_cliente(celular)  D=nome_predio  E=bairro  F=cep
// G=tipo_imovel  H=pessoas  I=plano  J=monitorando_agua  K=monitorando_energia
// L=monitorando_gas  M=ultimo_relatorio_semanal  N=ultimo_relatorio_mensal
// O=ultima_leitura  P=proximo_pagamento

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

export interface PredioInfo {
  uid: string;
  idImovel: string;
  idCliente: string; // celular (FK → clientes)
  nomePredio: string;
  nome: string;      // nome do cliente (do JOIN com clientes)
  celular: string;   // alias de idCliente (para compatibilidade com GastosManager)
  bairro: string;
  cep: string;
  tipoImovel: string;
  pessoas: string;
  plano: string;
  monitorandoAgua: boolean;
  monitorandoEnergia: boolean;
  monitorandoGas: boolean;
  ultimoRelatorioSemanal: string;
  ultimoRelatorioMensal: string;
  ultimaLeitura: string;
}

async function lerPredios(sheets: ReturnType<typeof google.sheets>): Promise<Omit<PredioInfo, 'nome'>[]> {
  const result = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_NAME}!A:P`,
    majorDimension: 'ROWS',
    valueRenderOption: 'FORMATTED_VALUE',
  });
  const rows = result.data?.values || [];
  const predios: Omit<PredioInfo, 'nome'>[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const uid = String(r[0] || '').trim();
    if (!uid) continue;
    const idCliente = String(r[2] || '').replace(/\D/g, '');
    predios.push({
      uid,
      idImovel: String(r[1] || ''),
      idCliente,
      nomePredio: String(r[3] || ''),
      celular: idCliente,
      bairro: String(r[4] || ''),
      cep: String(r[5] || ''),
      tipoImovel: String(r[6] || ''),
      pessoas: String(r[7] || ''),
      plano: String(r[8] || ''),
      monitorandoAgua: String(r[9] || '').toLowerCase() === 'true',
      monitorandoEnergia: String(r[10] || '').toLowerCase() === 'true',
      monitorandoGas: String(r[11] || '').toLowerCase() === 'true',
      ultimoRelatorioSemanal: String(r[12] || ''),
      ultimoRelatorioMensal: String(r[13] || ''),
      ultimaLeitura: String(r[14] || ''),
    });
  }
  return predios;
}

/**
 * Lista todos os prédios de um cliente, enriquecidos com o nome do cliente.
 */
export async function listarPrediosPorCliente(celular: string): Promise<PredioInfo[]> {
  const auth = getAuth();
  if (!auth) return [];
  try {
    const sheets = google.sheets({ version: 'v4', auth });
    const cel = celular.replace(/\D/g, '');
    const todos = await lerPredios(sheets);
    const filtrados = todos.filter((p) => p.idCliente === cel);
    const cliente = await buscarClientePorCelular(cel);
    const nome = cliente?.nome || '';
    return filtrados.map((p) => ({ ...p, nome }));
  } catch (erro: any) {
    logger.warn('PrediosSheet', `Erro ao listar prédios: ${erro?.message}`);
    return [];
  }
}

/**
 * Verifica se um celular tem pelo menos um prédio cadastrado.
 * Equivalente a verificarInscrito() do modelo antigo.
 */
export async function verificarCliente(celular: string): Promise<{
  inscrito: boolean;
  uid?: string;
  nome?: string;
  erro?: string;
}> {
  const auth = getAuth();
  if (!auth) return { inscrito: false, erro: 'Credenciais não configuradas' };
  try {
    const predios = await listarPrediosPorCliente(celular);
    if (predios.length > 0) {
      return { inscrito: true, uid: predios[0].uid, nome: predios[0].nome };
    }
    return { inscrito: false };
  } catch (erro: any) {
    return { inscrito: false, erro: erro?.message };
  }
}

/**
 * Adiciona um novo prédio para um cliente existente.
 */
export async function adicionarPredio(params: {
  idCliente: string;
  nomePredio: string;
  bairro?: string;
  cep?: string;
  tipoImovel?: string;
  pessoas?: string;
  plano?: string;
  monitorandoAgua?: boolean;
  monitorandoEnergia?: boolean;
  monitorandoGas?: boolean;
}): Promise<{ ok: boolean; uid?: string; idImovel?: string; erro?: string }> {
  const auth = getAuth();
  if (!auth) return { ok: false, erro: 'Credenciais não configuradas' };

  try {
    const sheets = google.sheets({ version: 'v4', auth });
    const cel = params.idCliente.replace(/\D/g, '');
    const uid = randomUUID();
    const idImovel = `IMV${Date.now()}`;
    const proximoPagamento = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      .toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });

    const colA = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!A:A`,
      majorDimension: 'COLUMNS',
      valueRenderOption: 'FORMATTED_VALUE',
    });
    const proximaLinha = (colA.data?.values?.[0]?.length || 1) + 1;

    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!A${proximaLinha}:P${proximaLinha}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[
          uid,
          idImovel,
          cel,
          params.nomePredio,
          params.bairro || '',
          params.cep || '',
          params.tipoImovel || '',
          params.pessoas || '',
          params.plano || 'Simples',
          params.monitorandoAgua !== false ? true : false,
          params.monitorandoEnergia || false,
          params.monitorandoGas || false,
          '', // ultimo_relatorio_semanal
          '', // ultimo_relatorio_mensal
          '', // ultima_leitura
          proximoPagamento,
        ]],
      },
    });

    logger.info('PrediosSheet', `✅ Prédio adicionado: ${params.nomePredio} (${idImovel}) para ${cel}`);
    return { ok: true, uid, idImovel };
  } catch (erro: any) {
    logger.warn('PrediosSheet', `Erro ao adicionar prédio: ${erro?.message}`);
    return { ok: false, erro: erro?.message };
  }
}

/**
 * Busca um prédio pelo idImovel.
 */
export async function buscarPredioPorImovel(idImovel: string): Promise<PredioInfo | null> {
  const auth = getAuth();
  if (!auth) return null;
  try {
    const sheets = google.sheets({ version: 'v4', auth });
    const todos = await lerPredios(sheets);
    const predio = todos.find((p) => p.idImovel === idImovel);
    if (!predio) return null;
    const cliente = await buscarClientePorCelular(predio.idCliente);
    return { ...predio, nome: cliente?.nome || '' };
  } catch (erro: any) {
    logger.warn('PrediosSheet', `Erro ao buscar prédio: ${erro?.message}`);
    return null;
  }
}

/**
 * Atualiza o timestamp da última leitura (coluna O) de um prédio pelo uid.
 */
export async function atualizarUltimaLeitura(
  uid: string,
  timestampIso: string
): Promise<{ ok: boolean; erro?: string }> {
  const auth = getAuth();
  if (!auth) return { ok: false, erro: 'Credenciais não configuradas' };
  try {
    const sheets = google.sheets({ version: 'v4', auth });
    const row = await _encontrarLinhaUid(sheets, uid);
    if (row < 0) return { ok: false, erro: 'UID não encontrado' };
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!O${row}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[timestampIso]] },
    });
    return { ok: true };
  } catch (erro: any) {
    logger.warn('PrediosSheet', `Erro ao atualizar última leitura: ${erro?.message}`);
    return { ok: false, erro: erro?.message };
  }
}

/**
 * Atualiza data do último relatório (M=semanal, N=mensal) de um prédio pelo uid.
 */
export async function atualizarUltimoRelatorio(
  uid: string,
  tipo: 'semanal' | 'mensal',
  data: string
): Promise<{ ok: boolean; erro?: string }> {
  const auth = getAuth();
  if (!auth) return { ok: false, erro: 'Credenciais não configuradas' };
  try {
    const sheets = google.sheets({ version: 'v4', auth });
    const row = await _encontrarLinhaUid(sheets, uid);
    if (row < 0) return { ok: false, erro: 'UID não encontrado' };
    const col = tipo === 'semanal' ? `M${row}` : `N${row}`;
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!${col}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[data]] },
    });
    logger.info('PrediosSheet', `✅ Relatório ${tipo} atualizado para UID ${uid}: ${data}`);
    return { ok: true };
  } catch (erro: any) {
    logger.warn('PrediosSheet', `Erro ao atualizar relatório: ${erro?.message}`);
    return { ok: false, erro: erro?.message };
  }
}

/**
 * Lista clientes elegíveis para receber nudge de retorno:
 * última leitura = ontem (fuso BRT) e antes das 22h. Deduplicado por celular.
 */
export async function listarElegiveisLembrete(): Promise<{ celular: string; nome: string }[]> {
  const auth = getAuth();
  if (!auth) return [];

  const TZ = 'America/Sao_Paulo';
  const HORA_LIMITE = 22;

  try {
    const sheets = google.sheets({ version: 'v4', auth });
    const predios = await lerPredios(sheets);

    const agora = new Date();
    const ontem = new Date(agora.getTime() - 24 * 60 * 60 * 1000);
    const ontemStr = ontem.toLocaleDateString('pt-BR', { timeZone: TZ });

    const elegiveis = new Map<string, string>();

    for (const p of predios) {
      if (!p.idCliente || !p.ultimaLeitura || elegiveis.has(p.idCliente)) continue;
      const dataLeitura = new Date(p.ultimaLeitura);
      if (Number.isNaN(dataLeitura.getTime())) continue;
      if (dataLeitura.toLocaleDateString('pt-BR', { timeZone: TZ }) !== ontemStr) continue;
      const hora = Number(
        dataLeitura.toLocaleTimeString('pt-BR', { timeZone: TZ, hour: '2-digit', hour12: false }).split(':')[0]
      );
      if (hora >= HORA_LIMITE) continue;
      elegiveis.set(p.idCliente, ''); // nome será preenchido em seguida
    }

    if (elegiveis.size === 0) return [];

    // Buscar nomes dos clientes elegíveis
    const resultado: { celular: string; nome: string }[] = [];
    for (const [celular] of elegiveis) {
      const cliente = await buscarClientePorCelular(celular);
      resultado.push({ celular, nome: cliente?.nome || '' });
    }
    return resultado;
  } catch (erro: any) {
    logger.warn('PrediosSheet', `Erro ao listar elegíveis: ${erro?.message}`);
    return [];
  }
}

async function _encontrarLinhaUid(
  sheets: ReturnType<typeof google.sheets>,
  uid: string
): Promise<number> {
  const colA = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_NAME}!A:A`,
    majorDimension: 'COLUMNS',
    valueRenderOption: 'FORMATTED_VALUE',
  });
  const valores = colA.data?.values?.[0] || [];
  for (let i = 1; i < valores.length; i++) {
    if (String(valores[i]).trim() === uid) return i + 1;
  }
  return -1;
}
