/**
 * Funções de agregação para relatórios admin.
 * Usadas pelo cron semanal e pelo comando /relatorio.
 */

import { listarLeadsAgua } from './leadsAguaSheet';
import { listarLeadsAnuncios } from './leadsAnunciosSheet';
import { listarTodosClientes } from './clientesSheet';
import { listarExtintoresVencendoEm } from './extintoresSheet';
import { logger } from './logger';

function parseDateBR(dateStr: string): Date | null {
  const m = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  return isNaN(d.getTime()) ? null : d;
}

function diasAtras(dateStr: string): number {
  const d = parseDateBR(dateStr);
  if (!d) return 0;
  return Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24));
}

export interface LeadEstagnado {
  idCliente: string;
  nome: string;
  tipo: 'agua' | 'anuncio';
  data: string;
  diasSemContato: number;
}

/**
 * Retorna leads com status 'novo' há mais de `diasLimite` dias sem contato.
 */
export async function verificarLeadsEstagnados(diasLimite = 2): Promise<LeadEstagnado[]> {
  try {
    const [agua, anuncios] = await Promise.all([
      listarLeadsAgua('novo'),
      listarLeadsAnuncios('novo'),
    ]);

    const estagnados: LeadEstagnado[] = [];

    for (const l of agua) {
      const dias = diasAtras(l.data);
      if (dias >= diasLimite) {
        estagnados.push({ idCliente: l.idCliente, nome: l.nomeCliente || l.idCliente, tipo: 'agua', data: l.data, diasSemContato: dias });
      }
    }

    for (const l of anuncios) {
      const dias = diasAtras(l.data);
      if (dias >= diasLimite) {
        estagnados.push({ idCliente: l.idCliente, nome: l.nome || l.idCliente, tipo: 'anuncio', data: l.data, diasSemContato: dias });
      }
    }

    return estagnados.sort((a, b) => b.diasSemContato - a.diasSemContato);
  } catch (erro: any) {
    logger.warn('RelatoriosAdmin', `Erro ao verificar leads estagnados: ${erro?.message}`);
    return [];
  }
}

export interface ResumoSemanal {
  msgAdmin: string;
  leadsNovos: number;
  leadsEstagnados: number;
  totalClientesAtivos: number;
  extintoresVencendo: number;
}

/**
 * Gera o resumo executivo semanal enviado toda segunda-feira.
 */
export async function gerarResumoSemanal(): Promise<ResumoSemanal> {
  const dataFormatada = new Date().toLocaleDateString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });

  const [aguaNovos, anunciosNovos, aguaTodos, anunciosTodos, clientes, extintoresVencendo, estagnados] =
    await Promise.all([
      listarLeadsAgua('novo'),
      listarLeadsAnuncios('novo'),
      listarLeadsAgua(),
      listarLeadsAnuncios(),
      listarTodosClientes(),
      listarExtintoresVencendoEm(30),
      verificarLeadsEstagnados(2),
    ]);

  const leadsSemana = [
    ...aguaTodos.filter((l) => diasAtras(l.data) <= 7),
    ...anunciosTodos.filter((l) => diasAtras(l.data) <= 7),
  ];

  const fechadosSemana = [
    ...aguaTodos.filter((l) => l.status === 'fechado' && diasAtras(l.data) <= 7),
    ...anunciosTodos.filter((l) => l.status === 'fechado' && diasAtras(l.data) <= 7),
  ];

  const leadsNovosTotal = aguaNovos.length + anunciosNovos.length;

  const linhas: string[] = [
    `📊 *Resumo semanal Guardião*`,
    `📅 ${dataFormatada}`,
    ``,
    `🔔 *Leads*`,
    `• Novos esta semana: ${leadsSemana.length}`,
    `• Pendentes no total: ${leadsNovosTotal}${estagnados.length > 0 ? ` ⚠️ (${estagnados.length} sem contato há +2d)` : ' ✅'}`,
    `• Fechamentos na semana: ${fechadosSemana.length}`,
  ];

  if (estagnados.length > 0) {
    linhas.push(``);
    linhas.push(`⚠️ *Leads estagnados (contatar hoje)*`);
    for (const e of estagnados.slice(0, 5)) {
      linhas.push(`• ${e.nome} (${e.tipo === 'agua' ? '💧' : '🧯'}) — ${e.diasSemContato}d\n  📱 https://wa.me/${e.idCliente}`);
    }
    if (estagnados.length > 5) {
      linhas.push(`_...e mais ${estagnados.length - 5}. Use /leads._`);
    }
  }

  linhas.push(``);
  linhas.push(`👥 *Clientes ativos:* ${clientes.length}`);
  linhas.push(``);
  linhas.push(`🧯 *Extintores vencendo (30 dias):* ${extintoresVencendo.length}`);
  linhas.push(``);
  linhas.push(`_/leads • /ver [número] • /clientes • /relatorio_`);

  return {
    msgAdmin: linhas.join('\n'),
    leadsNovos: leadsNovosTotal,
    leadsEstagnados: estagnados.length,
    totalClientesAtivos: clientes.length,
    extintoresVencendo: extintoresVencendo.length,
  };
}
