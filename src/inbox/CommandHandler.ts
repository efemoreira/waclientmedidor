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

// Números autorizados a disparar o job de lembretes (comando "lembrar").
const ADMIN_PHONES_LEMBRAR = new Set([
  '558597223863', // Felipe (admTI)
  '558586999181', // Oscar  (admVendas)
]);

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
          if (!ADMIN_PHONES_LEMBRAR.has(ctx.celular.replace(/\D/g, ''))) {
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
