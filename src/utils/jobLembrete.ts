/**
 * Lógica unificada do job de lembretes — usada tanto pelo comando "LEMBRAR"
 * (disparado pelos admins) quanto pelo cron diário.
 *
 * Restrição do WhatsApp Business API: só é possível enviar mensagens proativas
 * para quem interagiu nas últimas 24h. Por isso:
 *  - Clientes elegíveis (janela aberta) → recebem o retorno + lembretes de extintor
 *  - Clientes com extintor vencendo mas fora da janela → aparecem apenas no resumo
 *    enviado aos admins, para follow-up manual
 */

import { listarElegiveisLembrete } from './prediosSheet';
import {
  listarExtintoresVencendoEm,
  listarExtintoresComInspecaoProxima,
  marcarLembreteVencimentoEnviado,
  marcarLembreteInspecaoEnviado,
  type ExtintorVencendo,
} from './extintoresSheet';
import { verificarLeadsEstagnados } from './relatoriosAdmin';
import { logger } from './logger';
import { MESSAGES } from '../inbox/messages';

const ADMIN_VENDAS_PHONE = process.env.ADMIN_VENDAS_PHONE || '558586999181'; // Oscar
const ADMIN_TI_PHONE    = process.env.ADMIN_TI_PHONE    || '558597223863';  // Felipe
const DELAY_MS = 1500;

export interface ResultadoJobLembrete {
  nudgesEnviados: number;
  lembretesExtintorEnviados: number;
  lembretesInspecaoEnviados: number;
  extintoresForaJanela: number;
  leadsEstagnados: number;
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function montarResumoVencimentos(extintores: ExtintorVencendo[]): string {
  if (!extintores.length) return 'Nenhum extintor vencendo nos próximos 30 dias.';
  return extintores
    .map((e) => `• ${e.nomeCliente || e.idCliente} — ${e.imovel} (${e.tipo}) vence em ${e.mesPorExtenso} (${e.diasRestantes}d)`)
    .join('\n');
}

function montarResumoVencimentosComLink(extintores: ExtintorVencendo[]): string {
  if (!extintores.length) return '';
  return extintores
    .map((e) =>
      `• ${e.nomeCliente || e.idCliente} — ${e.imovel} (${e.tipo}) vence em ${e.mesPorExtenso} (${e.diasRestantes}d)\n  📱 https://wa.me/${e.idCliente}`
    )
    .join('\n');
}

function montarResumoInspecoes(extintores: ExtintorVencendo[]): string {
  if (!extintores.length) return '';
  return extintores
    .map((e) => `• ${e.nomeCliente || e.idCliente} — ${e.imovel} (${e.tipo}) inspeção em ${e.mesPorExtenso} (${e.diasRestantes}d)`)
    .join('\n');
}

/**
 * Executa o job completo de lembretes.
 * @param sendMsg função de envio de mensagem (to, text) que respeita a janela de 24h
 */
export async function executarJobLembrete(
  sendMsg: (to: string, text: string) => Promise<any>
): Promise<ResultadoJobLembrete> {
  const resultado: ResultadoJobLembrete = {
    nudgesEnviados: 0,
    lembretesExtintorEnviados: 0,
    lembretesInspecaoEnviados: 0,
    extintoresForaJanela: 0,
    leadsEstagnados: 0,
  };

  // — 1. Buscar dados em paralelo —
  const [elegiveis, vencendo, inspecoesProximas] = await Promise.all([
    listarElegiveisLembrete(),
    listarExtintoresVencendoEm(30),
    listarExtintoresComInspecaoProxima(14),
  ]);

  logger.info('JobLembrete', `Elegíveis: ${elegiveis.length} | Extintores vencendo: ${vencendo.length} | Inspeções próximas: ${inspecoesProximas.length}`);

  // Índice de clientes na janela de 24h para consulta rápida
  const dentroJanela = new Set(elegiveis.map((e) => e.celular.replace(/\D/g, '')));

  // — 2. Extintores: separar quem está na janela de quem não está —
  const extintoresNaJanela     = vencendo.filter((e) => dentroJanela.has(e.idCliente));
  const extintoresForaJanela   = vencendo.filter((e) => !dentroJanela.has(e.idCliente));
  const inspecoesNaJanela      = inspecoesProximas.filter((e) => dentroJanela.has(e.idCliente));

  resultado.extintoresForaJanela = extintoresForaJanela.length;

  // — 3. Enviar nudge de retorno para clientes elegíveis —
  for (const { celular, nome } of elegiveis) {
    try {
      await sendMsg(celular, MESSAGES.LEMBRETE_RETORNO(nome));
      resultado.nudgesEnviados++;
    } catch (e: any) {
      logger.warn('JobLembrete', `Erro ao enviar nudge para ${celular}: ${e?.message || e}`);
    }
    await delay(DELAY_MS);
  }

  // — 4. Lembretes de vencimento para quem está na janela —
  for (const ext of extintoresNaJanela) {
    const msg = `⚠️ ${ext.nomeCliente || 'Olá'}, o extintor *${ext.tipo}${ext.capacidade ? ' ' + ext.capacidade : ''}* do *${ext.imovel}*${ext.localSetor ? ` (${ext.localSetor})` : ''} vence em *${ext.mesPorExtenso}* (${ext.diasRestantes} dia${ext.diasRestantes !== 1 ? 's' : ''}). Posso agendar a recarga? Responda *SIM* que eu marco.`;
    try {
      await sendMsg(ext.idCliente, msg);
      await marcarLembreteVencimentoEnviado(ext.rowIndex);
      resultado.lembretesExtintorEnviados++;
    } catch (e: any) {
      logger.warn('JobLembrete', `Erro ao enviar lembrete de extintor para ${ext.idCliente}: ${e?.message || e}`);
    }
    await delay(DELAY_MS);
  }

  // — 5. Lembretes de inspeção para quem está na janela —
  for (const ext of inspecoesNaJanela) {
    const msg = `📋 ${ext.nomeCliente || 'Olá'}, a inspeção semestral do extintor *${ext.tipo}${ext.capacidade ? ' ' + ext.capacidade : ''}* do *${ext.imovel}*${ext.localSetor ? ` (${ext.localSetor})` : ''} está prevista para *${ext.mesPorExtenso}* (${ext.diasRestantes} dia${ext.diasRestantes !== 1 ? 's' : ''}). Posso confirmar a visita? Responda *SIM* que eu agendo.`;
    try {
      await sendMsg(ext.idCliente, msg);
      await marcarLembreteInspecaoEnviado(ext.rowIndex);
      resultado.lembretesInspecaoEnviados++;
    } catch (e: any) {
      logger.warn('JobLembrete', `Erro ao enviar lembrete de inspeção para ${ext.idCliente}: ${e?.message || e}`);
    }
    await delay(DELAY_MS);
  }

  // — 5b. Marcar extintores fora da janela como processados
  //   Permite que o cliente confirme via SIM se Oscar contactar manualmente
  for (const ext of extintoresForaJanela) {
    try {
      await marcarLembreteVencimentoEnviado(ext.rowIndex);
    } catch (e: any) {
      logger.warn('JobLembrete', `Erro ao marcar extintor fora da janela: ${e?.message || e}`);
    }
  }

  // — 6. Resumo para os admins —
  const linhasResumo: string[] = [];

  if (vencendo.length > 0) {
    linhasResumo.push(`🧯 *Extintores vencendo (próx. 30 dias)*\n${montarResumoVencimentos(vencendo)}`);
    if (extintoresForaJanela.length > 0) {
      linhasResumo.push(`⚠️ *${extintoresForaJanela.length} extintor(es) fora da janela de 24h* — contactar manualmente:\n${montarResumoVencimentosComLink(extintoresForaJanela)}`);
    }
  }

  if (inspecoesProximas.length > 0) {
    const resumoInsp = montarResumoInspecoes(inspecoesProximas);
    if (resumoInsp) linhasResumo.push(`📋 *Inspeções próximas (14 dias)*\n${resumoInsp}`);
  }

  linhasResumo.push(
    `📊 *Resumo do job*\n` +
    `• Nudges enviados: ${resultado.nudgesEnviados}\n` +
    `• Lembretes extintor (enviados): ${resultado.lembretesExtintorEnviados}\n` +
    `• Lembretes inspeção (enviados): ${resultado.lembretesInspecaoEnviados}\n` +
    `• Extintores fora da janela (manual): ${resultado.extintoresForaJanela}`
  );

  const msgAdmin = linhasResumo.join('\n\n');

  try {
    await sendMsg(ADMIN_VENDAS_PHONE, msgAdmin);
  } catch (e: any) {
    logger.warn('JobLembrete', `Erro ao notificar Oscar: ${e?.message || e}`);
  }

  // Felipe recebe o mesmo resumo apenas se houver extintores fora da janela ou situações críticas
  if (extintoresForaJanela.length > 0) {
    try {
      await sendMsg(ADMIN_TI_PHONE, msgAdmin);
    } catch (e: any) {
      logger.warn('JobLembrete', `Erro ao notificar Felipe: ${e?.message || e}`);
    }
  }

  // — 7. Verificar leads estagnados (> 2 dias sem contato) —
  try {
    const estagnados = await verificarLeadsEstagnados(2);
    resultado.leadsEstagnados = estagnados.length;
    if (estagnados.length > 0) {
      const linhas = estagnados.slice(0, 5).map(
        (e) => `• ${e.nome} (${e.tipo === 'agua' ? '💧' : '🧯'}) — ${e.diasSemContato}d\n  📱 https://wa.me/${e.idCliente}`
      );
      const extra = estagnados.length > 5 ? `\n_...e mais ${estagnados.length - 5}. Use /leads._` : '';
      await sendMsg(
        ADMIN_VENDAS_PHONE,
        `⚠️ *${estagnados.length} lead(s) sem contato há +2 dias*\n\n${linhas.join('\n')}${extra}`
      );
    }
  } catch (e: any) {
    logger.warn('JobLembrete', `Erro ao verificar leads estagnados: ${e?.message}`);
  }

  logger.info('JobLembrete', `✅ Job concluído: ${JSON.stringify(resultado)}`);
  return resultado;
}
