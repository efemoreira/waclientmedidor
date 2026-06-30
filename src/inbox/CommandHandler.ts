/**
 * Sistema de comandos extensível para o bot
 * Facilita adição de novos comandos e funcionalidades
 */

import { WhatsApp } from '../wabapi';
import { MESSAGES } from './messages';
import { GastosManager } from './GastosManager';
import type { InscritoDados } from './GastosManager';
import { logger } from '../utils/logger';
import { executarJobLembrete } from '../utils/jobLembrete';
import { listarLeadsAgua, atualizarStatusLeadAgua } from '../utils/leadsAguaSheet';
import { listarLeadsAnuncios, atualizarStatusLeadAnuncio } from '../utils/leadsAnunciosSheet';
import { listarExtintoresPorCliente, adicionarExtintor } from '../utils/extintoresSheet';
import { listarInscricoesPorCelular, adicionarInscrito, listarTodosClientes } from '../utils/inscritosSheet';
import { gerarResumoSemanal } from '../utils/relatoriosAdmin';

const ADMIN_PHONES = new Set([
  '558597223863', // Felipe (admTI)
  '558586999181', // Oscar  (admVendas)
]);

const ADMIN_VENDAS_PHONE = process.env.ADMIN_VENDAS_PHONE || '558586999181';
const ADMIN_TI_PHONE = process.env.ADMIN_TI_PHONE || '558597223863';

const STATUS_VALIDOS = new Set(['novo', 'contactado', 'fechado', 'perdido']);

function isAdmin(celular: string): boolean {
  return ADMIN_PHONES.has(celular.replace(/\D/g, ''));
}

function statusVencimento(dataStr: string): string {
  if (!dataStr) return '';
  const m = dataStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return '';
  const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  const diff = Math.round((d.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  if (diff < 0) return '🔴 VENCIDO';
  if (diff <= 30) return `🟡 ${diff}d`;
  return '🟢';
}

export interface CommandContext {
  celular: string;
  texto: string;
  textoNormalizado: string;
  inscricoes: InscritoDados[];
  gastosManager: GastosManager;
  client: WhatsApp;
  sendMessage: (to: string, text: string) => Promise<any>;
}

export interface CommandResult {
  handled: boolean;
  response?: string;
  startAdminFlow?: string;
  adminFlowData?: Record<string, any>;
  startClientFlow?: string;
  clientFlowData?: Record<string, any>;
}

/**
 * Interface para definir novos comandos
 */
export interface Command {
  names: string[];
  description: string;
  aliases?: string[];
  handler: (context: CommandContext) => Promise<CommandResult>;
}

/**
 * Gerenciador de comandos do bot
 */
export class CommandHandler {
  private commands: Map<string, Command> = new Map();
  private client: WhatsApp;
  private _send: (to: string, text: string) => Promise<any>;

  constructor(client: WhatsApp, sendMessageFn?: (to: string, text: string) => Promise<any>) {
    this.client = client;
    this._send = sendMessageFn || ((to, text) => client.sendMessage(to, text));
    this.registerDefaultCommands();
  }

  /**
   * Registrar comandos padrão do sistema
   */
  private registerDefaultCommands(): void {
    const commands = [
      // Comando: Ajuda/Menu
      {
        names: ['ajuda', 'help', 'menu'],
        description: 'Exibir menu de ajuda',
        aliases: ['?', 'comandos'],
        handler: async (ctx: CommandContext) => {
          await ctx.sendMessage(ctx.celular, MESSAGES.MENU_PRINCIPAL);
          return { handled: true };
        },
      },
      // Comando: Meu UID
      {
        names: ['meu uid', 'uid'],
        description: 'Ver seus UIDs',
        aliases: ['id', 'meu id'],
        handler: async (ctx: CommandContext) => {
          await ctx.gastosManager.responderMeuUid(ctx.celular, ctx.inscricoes);
          return { handled: true };
        },
      },
      // Comando: Minhas Casas
      {
        names: ['minhas casas', 'casas'],
        description: 'Listar seus imóveis',
        aliases: ['imoveis', 'meus imoveis', 'propriedades'],
        handler: async (ctx: CommandContext) => {
          await ctx.gastosManager.responderMinhasCasas(ctx.celular, ctx.inscricoes);
          return { handled: true };
        },
      },
      // Comando: Como Indicar
      {
        names: ['como indicar'],
        description: 'Informações sobre indicações',
        aliases: ['indicar', 'indicacao', 'indicações'],
        handler: async (ctx: CommandContext) => {
          await ctx.gastosManager.responderComoIndicar(ctx.celular, ctx.inscricoes);
          return { handled: true };
        },
      },
      // Comando: Status de Monitoramento
      {
        names: ['status', 'monitoramento'],
        description: 'Ver status de monitoramento dos imóveis',
        aliases: ['meu status', 'meus monitoramentos'],
        handler: async (ctx: CommandContext) => {
          await ctx.gastosManager.responderStatusDetalhado(ctx.celular, ctx.inscricoes);
          return { handled: true };
        },
      },
      // Comando: Ajuda sobre Enviar Leitura
      {
        names: ['como enviar', 'enviar leitura'],
        description: 'Como enviar leituras',
        aliases: ['ajuda leitura', 'help leitura'],
        handler: async (ctx: CommandContext) => {
          await ctx.sendMessage(ctx.celular, MESSAGES.HELP_ENVIAR_LEITURA);
          return { handled: true };
        },
      },
      // Comando: Lista de Comandos
      {
        names: ['comandos', 'lista comandos'],
        description: 'Listar todos os comandos',
        aliases: ['todos comandos', 'opcoes'],
        handler: async (ctx: CommandContext) => {
          await ctx.sendMessage(ctx.celular, MESSAGES.HELP_COMMANDS);
          return { handled: true };
        },
      },
      // Comando admin: job unificado de lembretes.
      // Restrição WhatsApp: só envia para quem mandou mensagem nas últimas 24h.
      // Clientes fora da janela aparecem apenas no resumo para follow-up manual.
      {
        names: ['lembrar'],
        description: 'Disparar job de lembretes (nudge + extintores + inspeções) — admin',
        handler: async (ctx: CommandContext) => {
          if (!isAdmin(ctx.celular)) {
            return { handled: false };
          }

          await ctx.sendMessage(ctx.celular, `⏳ Rodando job de lembretes...`);

          try {
            const resultado = await executarJobLembrete(ctx.sendMessage);
            await ctx.sendMessage(
              ctx.celular,
              `✅ Job concluído:\n• Nudges: ${resultado.nudgesEnviados}\n• Extintores (enviados): ${resultado.lembretesExtintorEnviados}\n• Inspeções (enviadas): ${resultado.lembretesInspecaoEnviados}\n• Extintores fora da janela: ${resultado.extintoresForaJanela}`
            );
          } catch (e: any) {
            logger.warn('CommandHandler', `Erro no job lembrar: ${e?.message || e}`);
            await ctx.sendMessage(ctx.celular, `❌ Erro ao rodar job: ${e?.message || e}`);
          }

          return { handled: true };
        },
      },
      // ─── Comandos admin: leads ────────────────────────────────────────────
      {
        names: ['leads', 'leads pendentes'],
        description: 'Ver leads pendentes de contato — admin',
        handler: async (ctx: CommandContext) => {
          if (!isAdmin(ctx.celular)) return { handled: false };

          await ctx.sendMessage(ctx.celular, '⏳ Buscando leads pendentes...');

          const [agua, anuncios] = await Promise.all([
            listarLeadsAgua('novo'),
            listarLeadsAnuncios('novo'),
          ]);

          const linhas: string[] = ['📋 *Leads pendentes*'];

          if (agua.length > 0) {
            linhas.push(`\n🔴 *Manutenção de água (${agua.length})*`);
            for (const l of agua) {
              linhas.push(
                `• ${l.data} — ${l.nomeCliente || l.idCliente}\n  🏠 ${l.imovel} (${l.desvioPercent})\n  📱 https://wa.me/${l.idCliente}`
              );
            }
          }

          if (anuncios.length > 0) {
            linhas.push(`\n🔔 *Extintores / anúncio (${anuncios.length})*`);
            for (const l of anuncios) {
              linhas.push(
                `• ${l.data} — ${l.nome || l.idCliente}\n  📍 ${l.endereco} (${l.qtdExtintores} ext.)\n  📱 https://wa.me/${l.idCliente}`
              );
            }
          }

          if (agua.length === 0 && anuncios.length === 0) {
            linhas.push('\n✅ Nenhum lead pendente.');
          } else {
            linhas.push(`\n*Total: ${agua.length + anuncios.length} pendente(s)*`);
            linhas.push('Use: /lead [número] [status]\nStatus: novo, contactado, fechado, perdido');
          }

          await ctx.sendMessage(ctx.celular, linhas.join('\n'));
          return { handled: true };
        },
      },
      {
        names: ['lead'],
        description: 'Gerenciar leads — admin. Use: /lead ajuda',
        handler: async (ctx: CommandContext) => {
          if (!isAdmin(ctx.celular)) return { handled: false };

          const args = ctx.textoNormalizado.replace(/^lead\s*/i, '').trim();

          // /lead ajuda
          if (!args || args === 'ajuda' || args === 'help') {
            await ctx.sendMessage(ctx.celular,
              `📖 *Comandos de lead*\n\n` +
              `• */leads* — ver leads pendentes\n` +
              `• */lead [número] [status]* — atualizar status\n` +
              `  Status: novo, contactado, fechado, perdido\n` +
              `• */lead fechar [número]* — marca como fechado e inicia cadastro\n\n` +
              `Ex: /lead 5585999999999 contactado`
            );
            return { handled: true };
          }

          // /lead fechar [numero] → marca como fechado + inicia cadastro do cliente
          if (args.startsWith('fechar')) {
            const numero = args.replace(/^fechar\s*/i, '').replace(/\D/g, '');
            if (!numero) {
              await ctx.sendMessage(ctx.celular, `Use: /lead fechar [número]`);
              return { handled: true };
            }
            await Promise.all([
              atualizarStatusLeadAgua(numero, 'fechado'),
              atualizarStatusLeadAnuncio(numero, 'fechado'),
            ]);
            await ctx.sendMessage(ctx.celular, `✅ Lead de *${numero}* marcado como *fechado*.\n\n👤 Nome completo do cliente?`);
            return { handled: true, startAdminFlow: 'cadastrar_cliente_nome', adminFlowData: { telefone: numero } };
          }

          // /lead [numero] [status]
          const partes = args.split(/\s+/);
          if (partes.length >= 2) {
            const numero = partes[0].replace(/\D/g, '');
            const novoStatus = partes[1].toLowerCase();

            if (!STATUS_VALIDOS.has(novoStatus)) {
              await ctx.sendMessage(ctx.celular,
                `❌ Status inválido: *${novoStatus}*\nStatus válidos: novo, contactado, fechado, perdido`
              );
              return { handled: true };
            }

            const [resAgua, resAnuncio] = await Promise.all([
              atualizarStatusLeadAgua(numero, novoStatus),
              atualizarStatusLeadAnuncio(numero, novoStatus),
            ]);

            const total = (resAgua.atualizados || 0) + (resAnuncio.atualizados || 0);
            if (total === 0) {
              await ctx.sendMessage(ctx.celular, `⚠️ Nenhum lead encontrado para o número *${numero}*.`);
            } else {
              await ctx.sendMessage(ctx.celular,
                `✅ *${total} lead(s)* de *${numero}* atualizados para *${novoStatus}*.\n` +
                `• Água: ${resAgua.atualizados}\n• Anúncio: ${resAnuncio.atualizados}`
              );
            }
            return { handled: true };
          }

          await ctx.sendMessage(ctx.celular, 'Use: /lead [número] [status] ou /lead ajuda');
          return { handled: true };
        },
      },

      // ─── Comandos admin: cadastrar ────────────────────────────────────────
      {
        names: ['cadastrar'],
        description: 'Cadastrar cliente ou extintor — admin. Use: /cadastrar ajuda',
        handler: async (ctx: CommandContext) => {
          if (!isAdmin(ctx.celular)) return { handled: false };

          const args = ctx.texto.replace(/^\/?\s*cadastrar\s*/i, '').trim();

          // /cadastrar ajuda
          if (args.toLowerCase() === 'ajuda' || args.toLowerCase() === 'help') {
            await ctx.sendMessage(ctx.celular,
              `📖 *Cadastrar — modos disponíveis*\n\n` +
              `*Guiado (recomendado):*\n` +
              `• /cadastrar — inicia fluxo passo a passo\n` +
              `• /extintor [número] — adiciona extintor com guia\n\n` +
              `*Rápido (avançado):*\n` +
              `• /cadastrar Nome;Telefone;Bairro\n` +
              `• /cadastrar extintor Tel;Tipo;Cap;Imóvel;Setor;Vencimento\n\n` +
              `Tipo: ABC, CO2, AP, BC | Vencimento: dd/mm/aaaa`
            );
            return { handled: true };
          }

          // /cadastrar (sem parâmetros) → fluxo guiado
          if (!args) {
            await ctx.sendMessage(ctx.celular, `👤 Nome completo do cliente?`);
            return { handled: true, startAdminFlow: 'cadastrar_cliente_nome', adminFlowData: {} };
          }

          // /cadastrar extintor ...
          if (args.toLowerCase().startsWith('extintor')) {
            const resto = args.replace(/^extintor\s*/i, '').trim();

            // /cadastrar extintor 5585... (sem ;) → fluxo guiado com telefone pré-preenchido
            if (resto && !resto.includes(';')) {
              const telefoneLimpo = resto.replace(/\D/g, '');
              if (!telefoneLimpo) {
                await ctx.sendMessage(ctx.celular, `Use: /extintor [número] para fluxo guiado\nou /cadastrar extintor Tel;Tipo;Cap;Imóvel`);
                return { handled: true };
              }
              const inscricoes = await listarInscricoesPorCelular(telefoneLimpo);
              if (!inscricoes.length) {
                await ctx.sendMessage(ctx.celular, `⚠️ Cliente *${telefoneLimpo}* não cadastrado. Cadastre primeiro com */cadastrar*.`);
                return { handled: true };
              }
              await ctx.sendMessage(ctx.celular, `🧯 Tipo do extintor de *${inscricoes[0].nome}*? (ABC / CO2 / AP / BC)`);
              return { handled: true, startAdminFlow: 'cadastrar_extintor_tipo', adminFlowData: { telefone: telefoneLimpo, nomeCliente: inscricoes[0].nome } };
            }

            // /cadastrar extintor Tel;Tipo;Cap;Imóvel;Setor;Vencimento → modo rápido
            const params = resto.split(';').map((s) => s.trim());
            if (params.length < 4) {
              await ctx.sendMessage(ctx.celular,
                `❌ Formato incorreto. Use:\n/cadastrar extintor Tel;Tipo;Cap;Imóvel;Setor;Vencimento\nou /extintor [número] para fluxo guiado`
              );
              return { handled: true };
            }

            const [telefone, tipo, capacidade, imovel, setor, vencimento] = params;
            const telefoneLimpo = telefone.replace(/\D/g, '');

            if (!telefoneLimpo || !tipo || !capacidade || !imovel) {
              await ctx.sendMessage(ctx.celular, `❌ Telefone, tipo, capacidade e imóvel são obrigatórios.`);
              return { handled: true };
            }

            const inscricoes = await listarInscricoesPorCelular(telefoneLimpo);
            if (!inscricoes.length) {
              await ctx.sendMessage(ctx.celular, `⚠️ Cliente *${telefoneLimpo}* não encontrado. Cadastre primeiro com */cadastrar*.`);
              return { handled: true };
            }
            const nomeCliente = inscricoes[0].nome;

            const res = await adicionarExtintor({
              idCliente: telefoneLimpo,
              nomeCliente,
              imovel,
              localSetor: setor || '',
              tipo: tipo.toUpperCase(),
              capacidade,
              dataVencimento: vencimento || '',
            });

            if (!res.ok) {
              await ctx.sendMessage(ctx.celular, `❌ Erro ao cadastrar extintor: ${res.erro}`);
            } else {
              await ctx.sendMessage(ctx.celular,
                `✅ *Extintor cadastrado*\n` +
                `👤 ${nomeCliente} — ${imovel}\n` +
                `🧯 ${tipo.toUpperCase()} ${capacidade}${setor ? ` — ${setor}` : ''}\n` +
                `📅 Vence: ${vencimento || 'não informado'}`
              );
            }
            return { handled: true };
          }

          // /cadastrar Nome;Telefone;Bairro → modo rápido
          const params = args.split(';').map((s) => s.trim());
          if (params.length < 2) {
            await ctx.sendMessage(ctx.celular,
              `❌ Formato incorreto.\n/cadastrar Nome;Telefone;Bairro\nou /cadastrar (sem params) para fluxo guiado`
            );
            return { handled: true };
          }

          const [nome, telefone, bairro, cep, tipoImovel] = params;
          const telefoneLimpo = telefone.replace(/\D/g, '');

          if (!nome || !telefoneLimpo) {
            await ctx.sendMessage(ctx.celular, `❌ Nome e telefone são obrigatórios.`);
            return { handled: true };
          }

          const lgpdData = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
          const res = await adicionarInscrito({
            nome,
            celular: telefoneLimpo,
            bairro: bairro || '',
            cep: cep || '',
            tipo_imovel: tipoImovel || '',
            lgpdAceiteData: lgpdData,
          });

          if (!res.ok) {
            await ctx.sendMessage(ctx.celular, `❌ Erro ao cadastrar cliente: ${res.erro}`);
          } else {
            await ctx.sendMessage(ctx.celular,
              `✅ *Cliente cadastrado*\n` +
              `👤 ${nome}\n📱 https://wa.me/${telefoneLimpo}\n` +
              `📍 ${bairro || 'não informado'}\n🆔 ${res.uid}\n🏠 ${res.idImovel}`
            );
            if (ctx.celular.replace(/\D/g, '') !== ADMIN_VENDAS_PHONE.replace(/\D/g, '')) {
              await ctx.sendMessage(ADMIN_VENDAS_PHONE,
                `🆕 *Novo cliente (rápido)*\n👤 ${nome}\n📱 https://wa.me/${telefoneLimpo}`
              );
            }
          }
          return { handled: true };
        },
      },

      // ─── Comando admin: ver cliente ───────────────────────────────────────
      {
        names: ['ver'],
        description: 'Ver dados de um cliente e seus extintores — admin. Use: /ver [número]',
        handler: async (ctx: CommandContext) => {
          if (!isAdmin(ctx.celular)) return { handled: false };

          const numero = ctx.textoNormalizado.replace(/^ver\s*/i, '').replace(/\D/g, '').trim();

          if (!numero) {
            await ctx.sendMessage(ctx.celular, `Use: /ver [número]\nEx: /ver 5585999999999`);
            return { handled: true };
          }

          await ctx.sendMessage(ctx.celular, '⏳ Buscando dados...');

          const [inscricoes, extintores] = await Promise.all([
            listarInscricoesPorCelular(numero),
            listarExtintoresPorCliente(numero),
          ]);

          if (inscricoes.length === 0 && extintores.length === 0) {
            await ctx.sendMessage(ctx.celular, `⚠️ Nenhum dado encontrado para *${numero}*.`);
            return { handled: true };
          }

          const nome = inscricoes[0]?.nome || '';
          const linhas: string[] = [];

          linhas.push(`👤 *${nome || numero}*`);
          linhas.push(`📱 https://wa.me/${numero}`);

          if (inscricoes.length > 0) {
            const monitores = inscricoes.map((i) => {
              const tipos: string[] = [];
              if (i.monitorandoAgua) tipos.push('💧 água');
              if (i.monitorandoEnergia) tipos.push('⚡ energia');
              if (i.monitorandoGas) tipos.push('🔥 gás');
              return `• ${i.idImovel} — ${i.bairro || 'sem bairro'}${tipos.length ? ' (' + tipos.join(', ') + ')' : ''}`;
            });
            linhas.push(`\n🏠 *Monitoramento (${inscricoes.length})*\n${monitores.join('\n')}`);
          }

          if (extintores.length > 0) {
            const PAGE = 10;
            const exibidos = extintores.slice(0, PAGE);
            const exts = exibidos.map((e, i) => {
              const setor = e.localSetor ? ` (${e.localSetor})` : '';
              const status = statusVencimento(e.dataVencimento);
              return `${i + 1}. ${e.tipo} ${e.capacidade} — ${e.imovel}${setor}\n   📅 ${e.dataVencimento || 'sem data'} ${status}`;
            });
            linhas.push(`\n🧯 *Extintores (${extintores.length})*\n${exts.join('\n')}`);
            if (extintores.length > PAGE) {
              linhas.push(`\n_...e mais ${extintores.length - PAGE} extintor(es). Veja na planilha._`);
            }
            linhas.push(`\nEditar: /extintor editar ${numero}`);
          } else {
            linhas.push(`\n🧯 *Extintores:* nenhum cadastrado`);
            linhas.push(`Adicionar: /extintor ${numero}`);
          }

          await ctx.sendMessage(ctx.celular, linhas.join('\n'));
          return { handled: true };
        },
      },

      // ─── Comando admin: relatório executivo ───────────────────────────────
      {
        names: ['relatorio', 'relatório'],
        description: 'Gerar resumo executivo on-demand — admin',
        handler: async (ctx: CommandContext) => {
          if (!isAdmin(ctx.celular)) return { handled: false };

          await ctx.sendMessage(ctx.celular, '⏳ Gerando relatório...');
          try {
            const resumo = await gerarResumoSemanal();
            await ctx.sendMessage(ctx.celular, resumo.msgAdmin);
          } catch (e: any) {
            await ctx.sendMessage(ctx.celular, `❌ Erro ao gerar relatório: ${e?.message || e}`);
          }
          return { handled: true };
        },
      },

      // ─── Comando admin: listar clientes ───────────────────────────────────
      {
        names: ['clientes'],
        description: 'Listar todos os clientes — admin',
        handler: async (ctx: CommandContext) => {
          if (!isAdmin(ctx.celular)) return { handled: false };

          await ctx.sendMessage(ctx.celular, '⏳ Buscando clientes...');
          const clientes = await listarTodosClientes();

          if (!clientes.length) {
            await ctx.sendMessage(ctx.celular, '⚠️ Nenhum cliente cadastrado.');
            return { handled: true };
          }

          const PAGE = 20;
          const exibidos = clientes.slice(0, PAGE);
          const linhas = exibidos.map((c) =>
            `• ${c.nome || 'sem nome'} — https://wa.me/${c.celular}${c.bairro ? ` (${c.bairro})` : ''}`
          );

          let msg = `👥 *Clientes (${clientes.length})*\n\n${linhas.join('\n')}`;
          if (clientes.length > PAGE) {
            msg += `\n\n_...e mais ${clientes.length - PAGE}. Use /ver [número] para detalhes._`;
          }
          msg += `\n\nUse */ver [número]* para detalhes.`;

          await ctx.sendMessage(ctx.celular, msg);
          return { handled: true };
        },
      },

      // ─── Comando admin: extintores (fluxo guiado) ─────────────────────────
      {
        names: ['extintor'],
        description: 'Gerenciar extintores de um cliente — admin. Use: /extintor [número]',
        handler: async (ctx: CommandContext) => {
          if (!isAdmin(ctx.celular)) return { handled: false };

          const args = ctx.textoNormalizado.replace(/^extintor\s*/i, '').trim();

          if (!args || args === 'ajuda' || args === 'help') {
            await ctx.sendMessage(ctx.celular,
              `📖 *Comandos de extintor*\n\n` +
              `• */extintor [número]* — adicionar extintor (guiado)\n` +
              `• */extintor editar [número]* — editar extintor existente\n` +
              `• */ver [número]* — ver extintores do cliente\n\n` +
              `Ex: /extintor 5585999999999`
            );
            return { handled: true };
          }

          // /extintor editar [número]
          if (args.startsWith('editar')) {
            const numero = args.replace(/^editar\s*/i, '').replace(/\D/g, '');
            if (!numero) {
              await ctx.sendMessage(ctx.celular, `Use: /extintor editar [número]`);
              return { handled: true };
            }
            const inscricoes = await listarInscricoesPorCelular(numero);
            if (!inscricoes.length) {
              await ctx.sendMessage(ctx.celular, `⚠️ Cliente *${numero}* não encontrado.`);
              return { handled: true };
            }
            const extintores = await listarExtintoresPorCliente(numero);
            if (!extintores.length) {
              await ctx.sendMessage(ctx.celular, `⚠️ Nenhum extintor cadastrado para ${inscricoes[0].nome}.`);
              return { handled: true };
            }
            const lista = extintores.map((e, i) => {
              const status = statusVencimento(e.dataVencimento);
              return `${i + 1}. ${e.tipo} ${e.capacidade} — ${e.imovel}${e.localSetor ? ` (${e.localSetor})` : ''} | ${e.dataVencimento || 'sem data'} ${status}`;
            }).join('\n');
            await ctx.sendMessage(ctx.celular,
              `🧯 *${inscricoes[0].nome} — extintores:*\n\n${lista}\n\nQual número quer editar?`
            );
            return {
              handled: true,
              startAdminFlow: 'extintor_editar_escolha',
              adminFlowData: {
                telefone: numero,
                nomeCliente: inscricoes[0].nome,
                extintores: extintores.map((e) => ({
                  rowIndex: e.rowIndex, tipo: e.tipo, capacidade: e.capacidade,
                  imovel: e.imovel, localSetor: e.localSetor, dataVencimento: e.dataVencimento,
                })),
              },
            };
          }

          // /extintor [número] → fluxo guiado de adição
          const numero = args.replace(/\D/g, '');
          if (!numero) {
            await ctx.sendMessage(ctx.celular, `Use: /extintor [número]\nEx: /extintor 5585999999999`);
            return { handled: true };
          }

          const inscricoes = await listarInscricoesPorCelular(numero);
          if (!inscricoes.length) {
            await ctx.sendMessage(ctx.celular, `⚠️ Cliente *${numero}* não encontrado. Cadastre primeiro com */cadastrar*.`);
            return { handled: true };
          }

          await ctx.sendMessage(ctx.celular, `🧯 Tipo do extintor de *${inscricoes[0].nome}*? (ABC / CO2 / AP / BC)`);
          return {
            handled: true,
            startAdminFlow: 'cadastrar_extintor_tipo',
            adminFlowData: { telefone: numero, nomeCliente: inscricoes[0].nome },
          };
        },
      },
      // Comando: Meus Extintores (cliente inscrito)
      {
        names: ['meus extintores', 'extintores'],
        description: 'Ver seus extintores e status de vencimento',
        aliases: ['ver extintores', 'meus ext'],
        handler: async (ctx: CommandContext) => {
          if (isAdmin(ctx.celular)) {
            await ctx.sendMessage(ctx.celular, `ℹ️ Para admins, use */ver [número]* para ver extintores de um cliente.`);
            return { handled: true };
          }
          const celular = ctx.celular.replace(/\D/g, '');
          const extintores = await listarExtintoresPorCliente(celular);
          if (!extintores.length) {
            await ctx.sendMessage(ctx.celular, `🧯 Nenhum extintor encontrado no seu cadastro.\n\nSe você contratou o Guardião Extintores, entre em contato com nossa equipe.`);
            return { handled: true };
          }
          const linhas = extintores.map((e, i) => {
            const st = statusVencimento(e.dataVencimento);
            const local = e.localSetor ? ` (${e.localSetor})` : '';
            const capacidade = e.capacidade ? ` ${e.capacidade}` : '';
            return `${i + 1}. *${e.tipo}${capacidade}* — ${e.imovel}${local} — ${e.dataVencimento || 'sem data'} ${st}`;
          });
          const nomeCliente = extintores[0].nomeCliente || 'seus imóveis';
          const paginas: string[][] = [];
          for (let i = 0; i < linhas.length; i += 10) paginas.push(linhas.slice(i, i + 10));
          for (let p = 0; p < paginas.length; p++) {
            const header = p === 0 ? `🧯 *Seus extintores — ${nomeCliente}*\n\n` : `🧯 *Extintores (cont.)*\n\n`;
            await ctx.sendMessage(ctx.celular, header + paginas[p].join('\n'));
          }
          const vencidos = extintores.filter((e) => statusVencimento(e.dataVencimento).startsWith('🔴')).length;
          const vencendo = extintores.filter((e) => statusVencimento(e.dataVencimento).startsWith('🟡')).length;
          if (vencidos || vencendo) {
            await ctx.sendMessage(ctx.celular, `⚠️ Você tem *${vencidos}* vencido(s) e *${vencendo}* vencendo em breve.\n\nDigite *solicitar visita* para agendar a recarga.`);
          }
          return { handled: true };
        },
      },
      // Comando: Solicitar Visita (cliente inscrito)
      {
        names: ['solicitar visita', 'quero visita', 'agendar visita'],
        description: 'Solicitar visita de inspeção ou recarga',
        aliases: ['visita', 'renovar'],
        handler: async (ctx: CommandContext) => {
          if (isAdmin(ctx.celular)) {
            await ctx.sendMessage(ctx.celular, `ℹ️ Comando de cliente. Para agendar, entre em contato com o cliente diretamente.`);
            return { handled: true };
          }
          await ctx.sendMessage(
            ctx.celular,
            `📅 *Solicitação de visita*\n\nQual o melhor dia e horário para você?\n\nEx: _terça de manhã_, _quinta à tarde_, _qualquer dia útil_`
          );
          return { handled: true, startClientFlow: 'solicitar_visita_horario', clientFlowData: {} };
        },
      },
    ];

    commands.forEach((cmd) => this.register(cmd));
    logger.info('CommandHandler', `✅ ${this.commands.size} comandos registrados`);
  }

  /**
   * Registrar um novo comando
   */
  register(command: Command): void {
    // Registrar todos os nomes e aliases
    const allNames = [...command.names, ...(command.aliases || [])];
    allNames.forEach((name) => {
      const normalized = name.toLowerCase().trim();
      this.commands.set(normalized, command);
    });
  }

  /**
   * Processar comando do usuário
   * Busca por correspondência exata primeiro, depois por correspondência no início
   */
  async process(context: CommandContext): Promise<CommandResult> {
    const normalized = context.textoNormalizado.trim();

    // Procurar comando exato primeiro
    const command = this.commands.get(normalized);
    if (command) {
      logger.info('CommandHandler', `⚡ Executando comando: "${normalized}"`);
      return await command.handler(context);
    }

    // Procurar comando que comece com o texto (mínimo 3 caracteres para evitar ambiguidade)
    if (normalized.length >= 3) {
      for (const [key, cmd] of this.commands.entries()) {
        if (normalized.startsWith(key + ' ')) {
          logger.info('CommandHandler', `⚡ Executando comando com parâmetros: "${key}"`);
          return await cmd.handler(context);
        }
      }
    }

    return { handled: false };
  }

  /**
   * Listar todos os comandos disponíveis
   */
  listCommands(): Command[] {
    const unique = new Map<string, Command>();
    this.commands.forEach((cmd) => {
      const key = cmd.names[0];
      if (!unique.has(key)) {
        unique.set(key, cmd);
      }
    });
    return Array.from(unique.values());
  }

  /**
   * Obter ajuda sobre um comando específico
   */
  getCommandHelp(commandName: string): string | null {
    const normalized = commandName.toLowerCase().trim();
    const command = this.commands.get(normalized);
    
    if (!command) {
      return null;
    }

    let help = `📖 *${command.names[0]}*\n${command.description}`;
    
    if (command.aliases && command.aliases.length > 0) {
      help += `\n\n*Aliases:* ${command.aliases.join(', ')}`;
    }

    return help;
  }
}
