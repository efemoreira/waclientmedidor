import { VercelRequest, VercelResponse } from '@vercel/node';
import { google } from 'googleapis';
import { config, validateConfig } from '../src/config';
import { isUpstashConfigured } from '../src/utils/conversation-storage';

function normalizarPrivateKey(raw: string): string {
  let key = raw.trim();
  if (key.startsWith('"') && key.endsWith('"')) key = key.slice(1, -1);
  if (key.startsWith('base64:')) {
    return Buffer.from(key.replace(/^base64:/, ''), 'base64').toString('utf8');
  }
  return key.replace(/\\n/g, '\n');
}

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const checks: Record<string, any> = {};

  // 1) Config do WhatsApp
  const configOk = validateConfig();
  checks.whatsapp = {
    ok: configOk,
    phoneNumberId: config.whatsapp.numberId ? `${config.whatsapp.numberId.substring(0, 5)}...` : 'AUSENTE',
    accessToken: config.whatsapp.token ? 'presente' : 'AUSENTE',
    webhookToken: config.whatsapp.webhookToken ? 'presente' : 'AUSENTE',
    apiVersion: `v${config.whatsapp.apiVersion}`,
  };

  // 2) Storage
  checks.storage = {
    type: isUpstashConfigured() ? 'Upstash Redis' : '/tmp local',
    upstashUrl: process.env.UPSTASH_REDIS_REST_URL ? 'presente' : 'AUSENTE',
    upstashToken: process.env.UPSTASH_REDIS_REST_TOKEN ? 'presente' : 'AUSENTE',
  };

  // 3) Google Sheets
  const clientEmail = process.env.GOOGLE_SHEETS_CLIENT_EMAIL || '';
  const privateKeyRaw = process.env.GOOGLE_SHEETS_PRIVATE_KEY || '';
  const sheetId = process.env.GOOGLE_SHEET_ID || '';
  const inscritosSheetId = process.env.GOOGLE_SHEET_ID || '1Duvyp8pp_8_joBpDa1TvgfSuEvcyKedffNm3_soPImo';
  const predioSheetId = process.env.GOOGLE_SHEET_ID || '1gWmeKdve801yhFST_O0grBefYW_fDLyCr8nwND_98EQ';

  checks.sheets = {
    googleSheetId: sheetId ? `${sheetId.substring(0, 10)}...` : 'AUSENTE (usando defaults diferentes!)',
    clientEmail: clientEmail ? clientEmail.replace(/(.{5}).*(@)/, '$1...$2') : 'AUSENTE',
    privateKey: privateKeyRaw ? 'presente' : 'AUSENTE',
    inscritosSheetIdUsado: !sheetId ? `DEFAULT: ${inscritosSheetId.substring(0, 10)}...` : 'usa GOOGLE_SHEET_ID',
    predioSheetIdUsado: !sheetId ? `DEFAULT: ${predioSheetId.substring(0, 10)}...` : 'usa GOOGLE_SHEET_ID',
    sheetsIguais: !sheetId ? (inscritosSheetId === predioSheetId ? 'SIM' : 'NÃO ⚠️') : 'SIM (mesma env var)',
    connectionTest: 'pendente',
  };

  if (clientEmail && privateKeyRaw) {
    try {
      const auth = new google.auth.JWT({
        email: clientEmail,
        key: normalizarPrivateKey(privateKeyRaw),
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      });
      const sheets = google.sheets({ version: 'v4', auth });
      const testSheetId = sheetId || inscritosSheetId;
      const result = await sheets.spreadsheets.get({
        spreadsheetId: testSheetId,
        fields: 'sheets.properties.title',
      });
      const abas = result.data.sheets?.map((s) => s.properties?.title) || [];
      checks.sheets.connectionTest = 'OK ✅';
      checks.sheets.abas = abas;
      checks.sheets.inscritosSheetName = process.env.GOOGLE_INSCRITOS_SHEET_NAME || 'Inscritos';
      checks.sheets.leiturasSheetName = process.env.GOOGLE_LEITURAS_SHEET_NAME || process.env.GOOGLE_SHEET_NAME || 'leituras';
      checks.sheets.acumuladoSemanaSheetName = process.env.GOOGLE_ACUMULADO_SEMANA_SHEET_NAME || 'acumulado_semana';
      checks.sheets.acumuladoMesSheetName = process.env.GOOGLE_ACUMULADO_MES_SHEET_NAME || 'acumulado_mes';
      checks.sheets.historicoResumoSheetName = process.env.GOOGLE_HISTORICO_RESUMO_SHEET_NAME || 'historico_resumo';

      const abasFaltando = [
        checks.sheets.inscritosSheetName,
        checks.sheets.leiturasSheetName,
        checks.sheets.acumuladoSemanaSheetName,
        checks.sheets.acumuladoMesSheetName,
        checks.sheets.historicoResumoSheetName,
      ].filter((nome) => !abas.includes(nome));

      if (abasFaltando.length) {
        checks.sheets.abasFaltando = abasFaltando;
      }
    } catch (err: any) {
      checks.sheets.connectionTest = `FALHA ❌: ${err?.message || err}`;
    }
  } else {
    checks.sheets.connectionTest = 'ignorado (credenciais ausentes)';
  }

  const allOk =
    checks.whatsapp.ok &&
    checks.sheets.connectionTest === 'OK ✅' &&
    !checks.sheets.abasFaltando?.length;

  res.status(200).json({ ok: allOk, checks });
}
