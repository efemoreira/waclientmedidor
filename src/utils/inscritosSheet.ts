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
    // Usa a busca "crua" (sem engolir erro) para não confundir falha da API
    // com "celular não cadastrado" - ver buscarInscricoesPorCelular.
    const inscricoes = await buscarInscricoesPorCelular(auth, celular);
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
 * Busca na planilha as inscrições (imóveis) de um celular. Propaga erros da
 * API do Sheets em vez de engoli-los - quem precisa diferenciar "celular não
 * cadastrado" de "falha ao consultar a planilha" deve chamar esta função.
 */
async function buscarInscricoesPorCelular(auth: NonNullable<ReturnType<typeof getAuth>>, celular: string): Promise<InscricaoInfo[]> {
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
}

/**
 * Lista todas as inscrições (imóveis) associadas a um número de celular.
 * Busca na planilha Google Sheets e retorna um array com os dados de cada inscrição.
 * Em caso de erro na API, retorna [] (uso "best-effort" para exibição de dados).
 * @param celular - Número de celular do usuário (com ou sem formatação)
 */
export async function listarInscricoesPorCelular(celular: string): Promise<InscricaoInfo[]> {
  const auth = getAuth();
  if (!auth) {
    logger.warn('Inscritos', 'Credenciais não configuradas');
    return [];
  }

  try {
    return await buscarInscricoesPorCelular(auth, celular);
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
  lgpdAceiteData?: string;
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

    // Gerar UID e ID_Imovel
    const uid = randomUUID();
    const idImovel = `IMV${Date.now()}`;
    const datainscricao = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const proximoPagamento = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const celularFormatado = params.celular.replace(/\D/g, '');

    logger.info('Inscritos', `Adicionando novo inscrito: ${params.nome} (${celularFormatado})`);

    // Não usar values.append aqui: quando há linhas com dados "soltos" fora da
    // coluna A em algum lugar da planilha (ex.: linhas em branco seguidas de
    // dados isolados em outra coluna), o auto-detect de tabela do append pode
    // ancorar a tabela errada e desalinhar todas as colunas da linha inserida.
    // Calculamos a próxima linha vazia explicitamente e usamos update.
    const colA = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!A:A`,
      majorDimension: 'COLUMNS',
      valueRenderOption: 'FORMATTED_VALUE',
    });
    const proximaLinha = (colA.data?.values?.[0]?.length || 1) + 1;

    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      // Colunas T (Ultimo_relatorio_semanal) e U (Ultimo_relatorio_mensal) ficam
      // vazias até o primeiro relatório periódico (ver atualizarUltimoRelatorio).
      range: `${SHEET_NAME}!A${proximaLinha}:V${proximaLinha}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[
          uid,
          idImovel,
          params.nome,
          celularFormatado,
          '',
          datainscricao,
          params.bairro || '',
          params.cep || '',
          params.tipo_imovel || '',
          params.pessoas || '',
          'Simples',
          '',
          proximoPagamento,
          params.uid_indicador || '',
          0,
          0,
          true,
          false,
          false,
          '',
          '',
          params.lgpdAceiteData || '',
        ]],
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

/**
 * Atualiza o timestamp da última leitura enviada (coluna W) de um inscrito pelo UID.
 * Usado para detectar quem está na janela de 24h de mensagens do WhatsApp.
 */
export async function atualizarUltimaLeitura(
  uid: string,
  timestampIso: string
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
      logger.warn('Inscritos', `UID não encontrado para atualizar última leitura: ${uid}`);
      return { ok: false, erro: 'UID não encontrado' };
    }

    // W = Ultima_Leitura (index 22), timestamp ISO em UTC
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!W${targetRow}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[timestampIso]] },
    });

    return { ok: true };
  } catch (erro: any) {
    logger.warn('Inscritos', `Erro ao atualizar última leitura: ${erro?.message || erro}`);
    return { ok: false, erro: erro?.message };
  }
}

/**
 * Lista os celulares elegíveis para receber a mensagem-gatilho de retorno:
 * última leitura enviada no dia anterior (fuso America/Sao_Paulo) e antes das 22h.
 * Deduplica por celular, já que um celular pode ter mais de um imóvel/UID.
 */
export async function listarElegiveisLembrete(): Promise<{ celular: string; nome: string }[]> {
  const auth = getAuth();
  if (!auth) {
    logger.warn('Inscritos', 'Credenciais não configuradas');
    return [];
  }

  const TZ = 'America/Sao_Paulo';
  const HORA_LIMITE = 22;

  try {
    const sheets = google.sheets({ version: 'v4', auth });
    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!A:W`,
      majorDimension: 'ROWS',
      valueRenderOption: 'FORMATTED_VALUE',
    });
    const rows = result.data?.values || [];

    const agora = new Date();
    const ontem = new Date(agora.getTime() - 24 * 60 * 60 * 1000);
    const ontemStr = ontem.toLocaleDateString('pt-BR', { timeZone: TZ });

    const elegiveis = new Map<string, string>();
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i] || [];
      const celular = String(row[3] || '').replace(/\D/g, '');
      const nome = String(row[2] || '');
      const ultimaLeitura = String(row[22] || '').trim();
      if (!celular || !ultimaLeitura || elegiveis.has(celular)) continue;

      const dataLeitura = new Date(ultimaLeitura);
      if (Number.isNaN(dataLeitura.getTime())) continue;

      const dataLeituraStr = dataLeitura.toLocaleDateString('pt-BR', { timeZone: TZ });
      if (dataLeituraStr !== ontemStr) continue;

      const horaLeitura = Number(
        dataLeitura.toLocaleTimeString('pt-BR', { timeZone: TZ, hour: '2-digit', hour12: false }).split(':')[0]
      );
      if (horaLeitura >= HORA_LIMITE) continue;

      elegiveis.set(celular, nome);
    }

    return Array.from(elegiveis.entries()).map(([celular, nome]) => ({ celular, nome }));
  } catch (erro: any) {
    logger.warn('Inscritos', `Erro ao listar elegíveis para lembrete: ${erro?.message || erro}`);
    return [];
  }
}

/**
 * Abate crédito de indicação (coluna O) do UID até o valor solicitado.
 * Usado para abater a cobrança de R$5 de itens extras antes de gerar a cobrança final.
 */
export async function resgatarCredito(
  uid: string,
  valor: number
): Promise<{ ok: boolean; aplicado: number; restante: number; erro?: string }> {
  const auth = getAuth();
  if (!auth) {
    return { ok: false, aplicado: 0, restante: 0, erro: 'Credenciais não configuradas' };
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
      return { ok: false, aplicado: 0, restante: 0, erro: 'UID não encontrado' };
    }

    const creditosRes = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!O${targetRow}`,
      valueRenderOption: 'FORMATTED_VALUE',
    });
    const saldoAtual = Number(String(creditosRes.data?.values?.[0]?.[0] || '0').replace(',', '.')) || 0;

    const aplicado = Math.min(saldoAtual, Math.max(0, valor));
    const novoSaldo = saldoAtual - aplicado;

    if (aplicado > 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `${SHEET_NAME}!O${targetRow}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [[novoSaldo]] },
      });
      logger.info('Inscritos', `Crédito resgatado para UID ${uid}: -${aplicado} (saldo restante: ${novoSaldo})`);
    }

    return { ok: true, aplicado, restante: novoSaldo };
  } catch (erro: any) {
    logger.warn('Inscritos', `Erro ao resgatar crédito: ${erro?.message || erro}`);
    return { ok: false, aplicado: 0, restante: 0, erro: erro?.message };
  }
}
