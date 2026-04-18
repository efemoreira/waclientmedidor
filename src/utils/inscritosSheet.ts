import { google } from 'googleapis';
import { logger } from './logger';
import { randomUUID } from 'crypto';

const SHEET_ID = process.env.GOOGLE_SHEET_ID || '1Duvyp8pp_8_joBpDa1TvgfSuEvcyKedffNm3_soPImo';
const SHEET_NAME = process.env.GOOGLE_INSCRITOS_SHEET_NAME || 'Inscritos';
const CLIENT_EMAIL = process.env.GOOGLE_SHEETS_CLIENT_EMAIL || '';
const PRIVATE_KEY = process.env.GOOGLE_SHEETS_PRIVATE_KEY || '';

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
 * Verificar se um número de celular já está inscrito
 */
export async function verificarInscrito(celular: string): Promise<{
  inscrito: boolean;
  uid?: string;
  nome?: string;
  erro?: string;
}> {
  const auth = getAuth();
  if (!auth) {
    logger.warn('Inscritos', 'Credenciais não configuradas');
    return { inscrito: false, erro: 'Credenciais não configuradas' };
  }

  try {
    const inscricoes = await listarInscricoesPorCelular(celular);
    if (inscricoes.length > 0) {
      logger.info('Inscritos', `✅ Celular ${celular} encontrado: ${inscricoes[0].nome} (${inscricoes[0].uid})`);
      return { inscrito: true, uid: inscricoes[0].uid, nome: inscricoes[0].nome };
    }

    logger.info('Inscritos', `⚠️  Celular ${celular} não encontrado nos inscritos`);
    return { inscrito: false };
  } catch (erro: any) {
    logger.warn('Inscritos', `Erro ao verificar inscrito: ${erro?.message || erro}`);
    return { inscrito: false, erro: erro?.message };
  }
}

export type InscricaoInfo = {
  uid: string;
  idImovel: string;
  nome: string;
  celular: string;
  bairro: string;
  monitorandoAgua: boolean;
  monitorandoEnergia: boolean;
  monitorandoGas: boolean;
  ultimoRelatorioSemanal?: string;
  ultimoRelatorioMensal?: string;
};

/**
 * Lista todas as inscrições (imóveis) associadas a um número de celular.
 * Busca na planilha Google Sheets e retorna um array com os dados de cada inscrição.
 * @param celular - Número de celular do usuário (com ou sem formatação)
 */
export async function listarInscricoesPorCelular(celular: string): Promise<InscricaoInfo[]> {
  const auth = getAuth();
  if (!auth) {
    logger.warn('Inscritos', 'Credenciais não configuradas');
    return [];
  }

  try {
    const sheets = google.sheets({ version: 'v4', auth });
    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!A:V`,
      majorDimension: 'ROWS',
      valueRenderOption: 'FORMATTED_VALUE',
    });

    const rows = result.data?.values || [];
    const celularNormalizado = celular.replace(/\D/g, '');
    const inscritos: InscricaoInfo[] = [];

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i] || [];
      const cel = String(row[3] || '').replace(/\D/g, '');
      if (cel !== celularNormalizado) continue;

      inscritos.push({
        uid: String(row[0] || ''),
        idImovel: String(row[1] || ''),
        nome: String(row[2] || ''),
        celular: String(row[3] || ''),
        bairro: String(row[6] || ''),
        monitorandoAgua: String(row[16] || '').toLowerCase() === 'true',
        monitorandoEnergia: String(row[17] || '').toLowerCase() === 'true',
        monitorandoGas: String(row[18] || '').toLowerCase() === 'true',
        ultimoRelatorioSemanal: String(row[19] || ''),
        ultimoRelatorioMensal: String(row[20] || ''),
      });
    }

    return inscritos;
  } catch (erro: any) {
    logger.warn('Inscritos', `Erro ao listar inscritos: ${erro?.message || erro}`);
    return [];
  }
}

/**
 * Adicionar novo inscrito com nome
 */
export async function adicionarInscrito(params: {
  nome: string;
  celular: string;
  bairro?: string;
  cep?: string;
  tipo_imovel?: string;
  pessoas?: string;
  uid_indicador?: string;
}): Promise<{
  ok: boolean;
  uid?: string;
  idImovel?: string;
  erro?: string;
}> {
  const auth = getAuth();
  if (!auth) {
    logger.warn('Inscritos', 'Credenciais não configuradas');
    return { ok: false, erro: 'Credenciais não configuradas' };
  }

  try {
    const sheets = google.sheets({ version: 'v4', auth });

    // Encontrar última linha não vazia
    const colA = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!A:A`,
      majorDimension: 'COLUMNS',
      valueRenderOption: 'FORMATTED_VALUE',
    });

    const colAValues = colA.data?.values?.[0] || [];
    let lastRow = colAValues.length;
    while (lastRow > 0 && !colAValues[lastRow - 1]) {
      lastRow -= 1;
    }
    const targetRow = lastRow + 1;

    // Gerar UID e ID_Imovel
    const uid = randomUUID();
    const idImovel = `IMV${Date.now()}`;
    const datainscricao = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const proximoPagamento = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const celularFormatado = params.celular.replace(/\D/g, '');

    logger.info('Inscritos', `Adicionando novo inscrito: ${params.nome} (${celularFormatado})`);

    // Adicionar dados nas colunas conforme cabeçalho
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: {
        valueInputOption: 'USER_ENTERED',
        data: [
          { range: `${SHEET_NAME}!A${targetRow}`, values: [[uid]] },
          { range: `${SHEET_NAME}!B${targetRow}`, values: [[idImovel]] },
          { range: `${SHEET_NAME}!C${targetRow}`, values: [[params.nome]] },
          { range: `${SHEET_NAME}!D${targetRow}`, values: [[celularFormatado]] },
          { range: `${SHEET_NAME}!E${targetRow}`, values: [['']] },
          { range: `${SHEET_NAME}!F${targetRow}`, values: [[datainscricao]] },
          { range: `${SHEET_NAME}!G${targetRow}`, values: [[params.bairro || '']] },
          { range: `${SHEET_NAME}!H${targetRow}`, values: [[params.cep || '']] },
          { range: `${SHEET_NAME}!I${targetRow}`, values: [[params.tipo_imovel || '']] },
          { range: `${SHEET_NAME}!J${targetRow}`, values: [[params.pessoas || '']] },
          { range: `${SHEET_NAME}!K${targetRow}`, values: [['Simples']] },
          { range: `${SHEET_NAME}!L${targetRow}`, values: [['']] },
          { range: `${SHEET_NAME}!M${targetRow}`, values: [[proximoPagamento]] },
          { range: `${SHEET_NAME}!N${targetRow}`, values: [[params.uid_indicador || '']] },
          { range: `${SHEET_NAME}!O${targetRow}`, values: [[0]] },
          { range: `${SHEET_NAME}!P${targetRow}`, values: [[0]] },
          { range: `${SHEET_NAME}!Q${targetRow}`, values: [[true]] },
          { range: `${SHEET_NAME}!R${targetRow}`, values: [[false]] },
          { range: `${SHEET_NAME}!S${targetRow}`, values: [[false]] },
        ],
      },
    });

    // Se tiver UID do indicador, somar +1 nos créditos de indicação dele
    const uidIndicador = (params.uid_indicador || '').trim();
    if (uidIndicador && uidIndicador.toLowerCase() !== 'não' && uidIndicador.toLowerCase() !== 'nao') {
      try {
        const colA = await sheets.spreadsheets.values.get({
          spreadsheetId: SHEET_ID,
          range: `${SHEET_NAME}!A:A`,
          majorDimension: 'COLUMNS',
          valueRenderOption: 'FORMATTED_VALUE',
        });
        const colAValues = colA.data?.values?.[0] || [];
        let indicadorRow = -1;
        for (let i = 1; i < colAValues.length; i++) {
          if (String(colAValues[i]).trim() === uidIndicador) {
            indicadorRow = i + 1;
            break;
          }
        }
        if (indicadorRow > 0) {
          const creditosRes = await sheets.spreadsheets.values.get({
            spreadsheetId: SHEET_ID,
            range: `${SHEET_NAME}!O${indicadorRow}`,
            valueRenderOption: 'FORMATTED_VALUE',
          });
          const creditosAtual = Number(String(creditosRes.data?.values?.[0]?.[0] || '0').replace(',', '.')) || 0;
          const novoCredito = creditosAtual + 1;
          await sheets.spreadsheets.values.update({
            spreadsheetId: SHEET_ID,
            range: `${SHEET_NAME}!O${indicadorRow}`,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: [[novoCredito]] },
          });
          logger.info('Inscritos', `Crédito de indicação atualizado para UID ${uidIndicador}: ${novoCredito}`);
        } else {
          logger.warn('Inscritos', `UID indicador não encontrado: ${uidIndicador}`);
        }
      } catch (erro: any) {
        logger.warn('Inscritos', `Erro ao atualizar crédito do indicador: ${erro?.message || erro}`);
      }
    }

    logger.info('Inscritos', `✅ Novo inscrito adicionado: ${params.nome} (UID: ${uid})`);
    return { ok: true, uid, idImovel };
  } catch (erro: any) {
    logger.warn('Inscritos', `Erro ao adicionar inscrito: ${erro?.message || erro}`);
    return { ok: false, erro: erro?.message };
  }
}

/**
 * Atualizar data do último relatório (semanal ou mensal) de um inscrito pelo UID
 */
export async function atualizarUltimoRelatorio(
  uid: string,
  tipo: 'semanal' | 'mensal',
  data: string
): Promise<{ ok: boolean; erro?: string }> {
  const auth = getAuth();
  if (!auth) {
    logger.warn('Inscritos', 'Credenciais não configuradas');
    return { ok: false, erro: 'Credenciais não configuradas' };
  }

  try {
    const sheets = google.sheets({ version: 'v4', auth });

    const colA = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!A:A`,
      majorDimension: 'COLUMNS',
      valueRenderOption: 'FORMATTED_VALUE',
    });
    const colAValues = colA.data?.values?.[0] || [];
    let targetRow = -1;
    for (let i = 1; i < colAValues.length; i++) {
      if (String(colAValues[i]).trim() === uid) {
        targetRow = i + 1;
        break;
      }
    }

    if (targetRow < 0) {
      logger.warn('Inscritos', `UID não encontrado para atualizar relatório: ${uid}`);
      return { ok: false, erro: 'UID não encontrado' };
    }

    // T = Ultimo_relatorio_semanal (index 19), U = Ultimo_relatorio_mensal (index 20)
    const coluna = tipo === 'semanal' ? `T${targetRow}` : `U${targetRow}`;
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!${coluna}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[data]] },
    });

    logger.info('Inscritos', `✅ Último relatório ${tipo} atualizado para UID ${uid}: ${data}`);
    return { ok: true };
  } catch (erro: any) {
    logger.warn('Inscritos', `Erro ao atualizar último relatório: ${erro?.message || erro}`);
    return { ok: false, erro: erro?.message };
  }
}
