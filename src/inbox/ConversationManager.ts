import { WhatsApp } from '../wabapi';
import type { WebhookPayload, WhatsAppMessage } from '../wabapi/types';
import { config } from '../config';
import { logger } from '../utils/logger';
import { appendPredioEntry } from '../utils/predioSheet';
import { verificarInscrito, adicionarInscrito, listarInscricoesPorCelular } from '../utils/inscritosSheet';
import { GastosManager } from './GastosManager';
import { normalizarTexto, normalizarWaId } from '../utils/text-normalizer';
import { lerConversas, salvarConversas, lerMeta, salvarMeta } from '../utils/conversation-storage';
import { MESSAGES } from './messages';
import { CommandHandler } from './CommandHandler';
import { PropertyManager, type ConversaNovoImovel } from './PropertyManager';

/**
 * Representa uma mensagem individual
 */
export interface MessageRecord {
  id: string;
  direction: 'in' | 'out';
  text: string;
  timestamp: number;
  status?: string;
}

/**
 * Representa uma conversa com um contato
 */
export interface Conversation {
  id: string;
  name?: string;
  phoneNumber: string;
  lastMessage?: string;
  lastTimestamp?: number;
  unreadCount: number;
  isHuman: boolean;
  messages: MessageRecord[];
  inscricaoStage?:
    | 'nome'
    | 'bairro'
    | 'cep'
    | 'tipo_imovel'
    | 'pessoas'
    | 'uid_indicador';
  inscricaoData?: {
    nome?: string;
    bairro?: string;
    cep?: string;
    tipo_imovel?: string;
    pessoas?: string;
    uid_indicador?: string;
  };
  pendingLeitura?: {
    valor?: string;
    tipo?: 'agua' | 'energia' | 'gas';
    idImovel?: string;
  };
  novoImovel?: ConversaNovoImovel;
}

/**
 * Gerenciador de conversas e mensagens
 * Orquestra fluxos de acompanhamento de gastos (água, energia, gás)
 */
export class ConversationManager {
  private client: WhatsApp;
  private conversations: Map<string, Conversation> = new Map();
  private gastosManager: GastosManager;
  private commandHandler: CommandHandler;
  private propertyManager: PropertyManager;
  private lastLoadTime: number = 0;
  private loadTimeout: number = 1000; // Recarregar no máximo a cada 1 segundo
  private resetAt: number = 0;

  private log(msg: string): void {
    logger.info('Inbox', msg);
  }

  // Garante que resets globais foram aplicados antes de operar
  private async garantirResetAtualizado(): Promise<void> {
    const meta = await lerMeta();
    if (meta?.resetAt && meta.resetAt > this.resetAt) {
      this.resetAt = meta.resetAt;
      this.conversations.clear();
      this.log(`🧹 Reset detectado (${new Date(this.resetAt).toISOString()})`);
    }
  }

  // Mescla conversas (evita sobrescrever mensagens entre instâncias)
  private mergeConversas(
    base: Record<string, Conversation>,
    updates: Record<string, Conversation>
  ): Record<string, Conversation> {
    const merged: Record<string, Conversation> = { ...base };

    Object.entries(updates).forEach(([id, conv]) => {
      const existing = merged[id];
      if (!existing) {
        merged[id] = conv;
        return;
      }

      const msgMap = new Map<string, MessageRecord>();
      existing.messages.forEach((m) => msgMap.set(m.id, m));
      conv.messages.forEach((m) => msgMap.set(m.id, m));
      const messages = Array.from(msgMap.values()).sort(
        (a, b) => a.timestamp - b.timestamp
      );

      const lastMessage = messages.length ? messages[messages.length - 1].text : existing.lastMessage;
      const lastTimestamp = messages.length
        ? messages[messages.length - 1].timestamp
        : existing.lastTimestamp;

      merged[id] = {
        ...existing,
        ...conv,
        name: existing.name || conv.name,
        phoneNumber: existing.phoneNumber || conv.phoneNumber,
        isHuman: existing.isHuman || conv.isHuman,
        unreadCount: Math.max(existing.unreadCount || 0, conv.unreadCount || 0),
        messages,
        lastMessage,
        lastTimestamp,
      };
    });

    return merged;
  }

  constructor() {
    const versionStr = config.whatsapp.apiVersion.replace(/\.0$/, '');
    const apiVersion = parseInt(versionStr, 10);
    this.log(`🔧 Usando API v${apiVersion}.0`);
    const storageMode = process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN ? 'Upstash Redis' : '/tmp local';
    this.log(`🗄️  Storage mode: ${storageMode}`);
    this.client = new WhatsApp({
      token: config.whatsapp.token,
      numberId: config.whatsapp.numberId,
      version: apiVersion,
    });
    this.gastosManager = new GastosManager(this.client);
    this.propertyManager = new PropertyManager(this.client);
    this.commandHandler = new CommandHandler(this.client);
    
    // Registrar comando de adicionar casa
    this.registerPropertyCommands();
    
    // Carregar conversas do armazenamento
    this.carregarConversas().catch(console.error);
  }

  /**
   * Registrar comandos relacionados a propriedades
   */
  private registerPropertyCommands(): void {
    this.commandHandler.register({
      names: ['adicionar casa', 'nova casa'],
      description: 'Adicionar um novo imóvel ao seu cadastro',
      aliases: ['add casa', 'adicionar imovel', 'novo imovel', 'cadastrar casa'],
      handler: async (ctx) => {
        const verificacao = await this.propertyManager.podeAdicionarImovel(ctx.celular);
        
        if (!verificacao.pode) {
          await this.client.sendMessage(ctx.celular, `❌ ${verificacao.erro}`);
          return { handled: true };
        }

        // Iniciar fluxo de adição de imóvel
        const conversa = this.obterOuCriarConversa(ctx.celular);
        conversa.novoImovel = await this.propertyManager.iniciarAdicaoImovel(
          ctx.celular,
          verificacao.nome!
        );
        await this.persistirConversas();

        return { handled: true };
      },
    });
  }

  /**
   * Recarregar conversas do arquivo apenas se passou tempo suficiente
   */
  private async recarregarSeNecessario(): Promise<void> {
    const agora = Date.now();
    if (agora - this.lastLoadTime < this.loadTimeout) {
      // Já foi carregado recentemente, usar cache
      return;
    }
    this.lastLoadTime = agora;
    await this.recarregarConversas();
  }

  /**
   * Carregar conversas do armazenamento (Upstash ou /tmp)
   */
  private async carregarConversas(): Promise<void> {
    try {
      await this.garantirResetAtualizado();
      const conversas = await lerConversas();
      if (!conversas || typeof conversas !== 'object') {
        this.log(`❌ Armazenamento inválido (${typeof conversas})`);
        return;
      }
      Object.entries(conversas).forEach(([id, conv]: [string, any]) => {
        this.conversations.set(id, conv);
      });
      this.log(`✅ Carregadas ${this.conversations.size} conversas`);
    } catch (e: any) {
      this.log(`❌ Erro ao carregar conversas: ${e?.message || e}`);
    }
  }

  /**
   * Recarregar conversas do arquivo (útil após mudanças)
   */
  async recarregarConversas(): Promise<void> {
    this.log('🔄 Recarregando conversas do storage...');
    this.conversations.clear();
    await this.carregarConversas();
  }

  /**
   * Salvar conversas no armazenamento (Upstash ou /tmp)
   */
  private async persistirConversas(): Promise<void> {
    try {
      await this.garantirResetAtualizado();
      const data: Record<string, Conversation> = {};
      this.conversations.forEach((conv, id) => {
        data[id] = conv;
      });
      const base = (await lerConversas()) || {};
      const merged = this.mergeConversas(base, data);
      await salvarConversas(merged);
      this.conversations.clear();
      Object.entries(merged).forEach(([id, conv]) => {
        this.conversations.set(id, conv);
      });
      this.log(`💾 Salvas ${Object.keys(merged).length} conversas`);
    } catch (e: any) {
      this.log(`❌ Erro ao salvar conversas: ${e?.message || e}`);
    }
  }

  /**
   * Extrair texto da mensagem (suporta vários tipos)
   */
  private extrairTexto(message: WhatsAppMessage): string {
    if (message.text?.body) return message.text.body;
    if (message.interactive?.button_reply?.title) {
      return message.interactive.button_reply.title;
    }
    if (message.interactive?.list_reply?.title) {
      return message.interactive.list_reply.title;
    }
    if (message.location) {
      const { latitude, longitude, name } = message.location;
      return name
        ? `📍 ${name} (${latitude}, ${longitude})`
        : `📍 Localização (${latitude}, ${longitude})`;
    }
    return `[${message.type}]`;
  }

  /**
   * Obter ou criar uma conversa
   */
  private obterOuCriarConversa(
    waId: string,
    nome?: string
  ): Conversation {
    const idNormalizado = normalizarWaId(waId);
    // Garantir reset atualizado antes de usar o cache
    // (não aguarda: usar best-effort no fluxo síncrono)
    this.garantirResetAtualizado().catch(() => undefined);
    const existente = this.conversations.get(idNormalizado);
    if (existente) {
      if (nome && !existente.name) existente.name = nome;
      return existente;
    }

    const conversa: Conversation = {
      id: idNormalizado,
      name: nome,
      phoneNumber: idNormalizado,
      unreadCount: 0,
      isHuman: false,
      messages: [],
    };
    this.conversations.set(idNormalizado, conversa);
    return conversa;
  }

  /**
   * Adicionar mensagem a uma conversa
   */
  private async adicionarMensagem(
    waId: string,
    direcao: 'in' | 'out',
    texto: string,
    mensagemId?: string,
    timestamp?: number
  ): Promise<void> {
    await this.garantirResetAtualizado();
    const conversa = this.obterOuCriarConversa(waId);
    const ts = timestamp || Date.now();
    const registro: MessageRecord = {
      id: mensagemId || `local-${ts}-${Math.random().toString(36).slice(2, 8)}`,
      direction: direcao,
      text: texto,
      timestamp: ts,
    };

    conversa.messages.push(registro);
    conversa.lastMessage = texto;
    conversa.lastTimestamp = ts;
    if (direcao === 'in') {
      conversa.unreadCount += 1;
    }

    // Salvar após cada mensagem
    await this.persistirConversas();
  }

  /**
   * Atualizar status de uma mensagem enviada
   */
  private async atualizarStatusMensagem(
    waId: string,
    mensagemId: string,
    status: string,
    timestamp?: number
  ): Promise<void> {
    await this.garantirResetAtualizado();
    const conversa = this.obterOuCriarConversa(waId);
    const msg = conversa.messages.find((m) => m.id === mensagemId);
    if (msg) {
      msg.status = status;
      if (timestamp) {
        conversa.lastTimestamp = timestamp;
      }
      await this.persistirConversas();
      this.log(`✅ Status atualizado: ${mensagemId} -> ${status}`);
    } else {
      this.log(`⚠️  Status recebido para mensagem desconhecida: ${mensagemId}`);
    }
  }

  /**
   * Processar histórico de mensagens (history webhook)
   */
  private async processarHistory(history: any[]): Promise<void> {
    for (const item of history) {
      const meta = item?.metadata;
      if (meta?.phase !== undefined) {
        this.log(`🧭 History phase=${meta.phase} chunk=${meta.chunk_order} progress=${meta.progress}`);
      }

      const threads = Array.isArray(item?.threads) ? item.threads : [];
      for (const thread of threads) {
        const threadId = thread?.id;
        if (!threadId) continue;
        this.obterOuCriarConversa(threadId);

        const mensagens = Array.isArray(thread?.messages) ? thread.messages : [];
        for (const msg of mensagens) {
          const de = msg?.from;
          if (!de) continue;

          const texto = this.extrairTexto(msg);
          const timestamp = msg.timestamp ? Number(msg.timestamp) * 1000 : Date.now();
          const fromMeFlag = msg?.history_context?.from_me;
          const fromMe = typeof fromMeFlag === 'boolean'
            ? fromMeFlag
            : de !== threadId;
          const status = msg?.history_context?.status;
          const direcao: 'in' | 'out' = fromMe ? 'out' : 'in';

          await this.adicionarMensagem(threadId, direcao, texto, msg.id, timestamp);
          if (status) {
            await this.atualizarStatusMensagem(threadId, msg.id, status, timestamp);
          }
        }
      }
    }
  }

  /**
   * Processar webhook do WhatsApp
   */
  async processarWebhook(payload: WebhookPayload): Promise<void> {
    this.log('🔍 PROCESSANDO WEBHOOK');

    const entries = payload.entry || [];
    if (entries.length === 0) {
      this.log('❌ Webhook sem entry');
      return;
    }

    for (const entrada of entries) {
      this.log(`📦 Entry: ${entrada?.id || 'sem id'}`);
      const changes = entrada.changes || [];
      for (const mudanca of changes) {
        const valor: any = mudanca?.value;
        if (!valor) {
          this.log('❌ Nenhum value encontrado na change');
          continue;
        }

        if (mudanca?.field) {
          this.log(`🧩 Field: ${mudanca.field}`);
        }
        const metadata = valor.metadata;
        if (metadata?.phone_number_id) {
          this.log(`📱 Phone Number ID: ${metadata.phone_number_id}`);
        }

        // Erros no nível do value
        if (Array.isArray(valor.errors) && valor.errors.length > 0) {
          this.log(`❌ Erros no webhook (value.errors): ${valor.errors.length}`);
          for (const err of valor.errors) {
            const details = err?.error_data?.details ? ` details=${err.error_data.details}` : '';
            this.log(`• code=${err?.code} type=${err?.type} title=${err?.title || err?.message}${details}`);
          }
        }

        // Mapear contatos por wa_id
        const contacts = Array.isArray(valor.contacts) ? valor.contacts : [];
        const contatoPorId = new Map<string, string>();
        for (const c of contacts) {
          if (c?.wa_id) {
            contatoPorId.set(c.wa_id, c?.profile?.name || 'Desconhecido');
          }
        }

        // History (backfill)
        if (Array.isArray(valor.history) && valor.history.length > 0) {
          this.log(`🕘 WEBHOOK HISTORY RECEBIDO (${valor.history.length})`);
          await this.processarHistory(valor.history);
        }

        // Mensagens recebidas
        if (Array.isArray(valor.messages) && valor.messages.length > 0) {
          this.log(`📨 Processando ${valor.messages.length} mensagem(ns)...`);
          for (const msg of valor.messages) {
            const de = msg?.from;
            if (!de) {
              this.log('⚠️  Mensagem sem origem');
              continue;
            }

            if (Array.isArray(msg?.errors) && msg.errors.length > 0) {
              this.log(`❌ Mensagem com erro (type=${msg?.type || 'unknown'})`);
              for (const err of msg.errors) {
                const details = err?.error_data?.details ? ` details=${err.error_data.details}` : '';
                this.log(`• code=${err?.code} title=${err?.title || err?.message}${details}`);
              }
            }

            const texto = this.extrairTexto(msg);
            const timestamp = msg.timestamp ? Number(msg.timestamp) * 1000 : Date.now();
            const nome = contatoPorId.get(de);
            if (nome) {
              this.obterOuCriarConversa(de, nome);
            }

            await this.adicionarMensagem(de, 'in', texto, msg.id, timestamp);
            this.log(`✅ De ${de}: "${texto.substring(0, 50)}..."`);

            // Obter conversa - pode ser reatribuída durante o processamento
            let conversa = this.obterOuCriarConversa(de);
            
            // Verificar fluxo de novo imóvel primeiro
            if (conversa.novoImovel) {
              const resultado = await this.propertyManager.processarProximoPasso(
                conversa.novoImovel,
                texto
              );

              if (resultado.concluido) {
                conversa.novoImovel = undefined;
                await this.persistirConversas();
              } else if (resultado.proximoStage) {
                conversa.novoImovel = resultado.proximoStage;
                await this.persistirConversas();
              }
              continue;
            }

            // Verificar inscrição
            if (conversa.inscricaoStage) {
              conversa.inscricaoData = conversa.inscricaoData || {};
              const stage = conversa.inscricaoStage;

              // Mapeamento de salvamento de dados por estágio
              const handlers: Record<string, () => void> = {
                'nome': () => { conversa.inscricaoData!.nome = texto; },
                'bairro': () => { conversa.inscricaoData!.bairro = texto; },
                'cep': () => { conversa.inscricaoData!.cep = texto; },
                'tipo_imovel': () => { conversa.inscricaoData!.tipo_imovel = texto; },
                'pessoas': () => { conversa.inscricaoData!.pessoas = texto; },
                'uid_indicador': () => { conversa.inscricaoData!.uid_indicador = texto; },
              };

              if (handlers[stage]) handlers[stage]();

              const avancar = async (proximo: Conversation['inscricaoStage'], pergunta: string) => {
                conversa.inscricaoStage = proximo;
                await this.persistirConversas(); // Salva o progresso no storage
                await this.enviarMensagem(de, pergunta);
              };

              try {
                switch (stage) {
                  case 'nome':
                    await avancar('bairro', MESSAGES.INSCRICAO_BAIRRO);
                    break;
                  case 'bairro':
                    await avancar('cep', MESSAGES.INSCRICAO_CEP);
                    break;
                  case 'cep':
                    await avancar('tipo_imovel', MESSAGES.INSCRICAO_TIPO_IMOVEL);
                    break;
                  case 'tipo_imovel':
                    await avancar('pessoas', MESSAGES.INSCRICAO_PESSOAS);
                    break;
                  case 'pessoas':
                    await avancar('uid_indicador', MESSAGES.INSCRICAO_UID_INDICADOR);
                    break;
                  case 'uid_indicador':
                    const dados = conversa.inscricaoData;
                    const resultado = await adicionarInscrito({
                      nome: dados?.nome || '',
                      celular: de,
                      bairro: dados?.bairro || '',
                      cep: dados?.cep || '', // Enviando CEP
                      tipo_imovel: dados?.tipo_imovel || '',
                      pessoas: dados?.pessoas || '',
                      uid_indicador: dados?.uid_indicador || '',
                    });

                    if (resultado.ok) {
                      conversa.inscricaoStage = undefined;
                      conversa.inscricaoData = undefined;
                      await this.persistirConversas();
                      const reply = MESSAGES.INSCRICAO_SUCESSO(
                        dados?.nome || '',
                        resultado.uid || '',
                        resultado.idImovel || ''
                      );
                      await this.enviarMensagem(de, reply);
                    } else {
                      await this.enviarMensagem(de, MESSAGES.INSCRICAO_ERRO(resultado.erro));
                    }
                    break;
                }
              } catch (erro: any) {
                this.log(`❌ Erro no onboarding: ${erro?.message}`);
                await this.enviarMensagem(de, MESSAGES.INSCRICAO_ERRO(erro?.message));
              }
              continue;
            }

            // Verificar se já é inscrito
            const verificacao = await verificarInscrito(de);
            if (!verificacao.inscrito) {
              // Não está inscrito - pedir inscrição
              conversa.inscricaoStage = 'nome';
              conversa.inscricaoData = {};
              await this.persistirConversas();
              const reply = MESSAGES.WELCOME_NEW_USER;
              try {
                await this.enviarMensagem(de, reply);
              } catch (erro: any) {
                this.log(`❌ Falha ao enviar solicitação de inscrição: ${erro?.message || erro}`);
              }
              continue;
            }

            // Usuário é inscrito - continuar com fluxo normal
            this.log(`✅ Usuário inscrito: ${verificacao.nome} (${verificacao.uid})`);

            const textoNormalizado = normalizarTexto(texto).trim();
            const inscricoes = await listarInscricoesPorCelular(de);

            // Tentar processar como comando primeiro
            const commandResult = await this.commandHandler.process({
              celular: de,
              texto,
              textoNormalizado,
              inscricoes,
              gastosManager: this.gastosManager,
              client: this.client,
            });

            if (commandResult.handled) {
              continue;
            }

            // Fluxo de leitura pendente
            if (conversa.pendingLeitura) {
              const { processado } = await this.gastosManager.processarPendingLeitura(
                de,
                texto,
                textoNormalizado,
                conversa.pendingLeitura,
                inscricoes
              );
              if (processado) {
                conversa.pendingLeitura = undefined;
                await this.persistirConversas();
                continue;
              }
            }

            // Interpretar envio de leitura usando GastosManager
            const { leituraValor, leituraTipo, leituraId } = this.gastosManager.parseArLeitura(textoNormalizado);

            if (leituraValor) {
              const { processado, pendingLeitura, erro } = await this.gastosManager.processarLeitura(
                de,
                texto,
                leituraValor,
                leituraTipo,
                leituraId,
                inscricoes
              );

              if (processado) {
                if (pendingLeitura) {
                  conversa.pendingLeitura = pendingLeitura;
                  await this.persistirConversas();
                  if (erro === 'NEED_ID') {
                    const lista = await this.gastosManager.formatarCasas(inscricoes);
                    await this.enviarMensagem(de, MESSAGES.AGUARDANDO_ID_IMOVEL(lista));
                  } else if (erro === 'NEED_TYPE') {
                    await this.enviarMensagem(de, MESSAGES.AGUARDANDO_TIPO);
                  }
                }
                continue;
              }
            }

            // Comando não reconhecido - mostrar menu
            await this.enviarMensagem(de, MESSAGES.COMANDO_NAO_RECONHECIDO);
          }
        }

        // Status de mensagens enviadas
        if (Array.isArray(valor.statuses) && valor.statuses.length > 0) {
          this.log(`📊 Processando ${valor.statuses.length} status(es)`);
          for (const st of valor.statuses) {
            const recipientId = st?.recipient_id;
            const msgId = st?.id;
            const status = st?.status;
            const ts = st?.timestamp ? Number(st.timestamp) * 1000 : undefined;
            if (Array.isArray(st?.errors) && st.errors.length > 0) {
              this.log(`❌ Status com erro (msg=${msgId})`);
              for (const err of st.errors) {
                const details = err?.error_data?.details ? ` details=${err.error_data.details}` : '';
                this.log(`• code=${err?.code} title=${err?.title || err?.message}${details}`);
              }
            }
            if (recipientId && msgId && status) {
              await this.atualizarStatusMensagem(recipientId, msgId, status, ts);
            }
          }
        }
      }
    }

    this.log('✅ WEBHOOK PROCESSADO');
  }

  /**
   * Obter todas as conversas ordenadas por recency (recarrega do arquivo se necessário)
   */
  async obterConversas(): Promise<Conversation[]> {
    // Recarregar do arquivo apenas se passou tempo suficiente
    await this.recarregarSeNecessario();
    
    return Array.from(this.conversations.values())
      .sort((a, b) => (b.lastTimestamp || 0) - (a.lastTimestamp || 0))
      .map((c) => ({
        ...c,
        messages: c.messages.slice(-50), // Limitar últimas 50 mensagens
      }));
  }

  /**
   * Obter conversa específica e marcar como lida (recarrega do arquivo se necessário)
   */
  async obterConversa(id: string): Promise<Conversation | null> {
    // Recarregar do arquivo apenas se passou tempo suficiente
    await this.recarregarSeNecessario();

    const idNormalizado = normalizarWaId(id);
    this.log(`🔍 Buscando conversa: ${idNormalizado}`);
    const conversa = this.conversations.get(idNormalizado);
    if (conversa) {
      conversa.unreadCount = 0;
      this.log(`✅ Encontrada com ${conversa.messages.length} mensagens`);
    } else {
      this.log('❌ Não encontrada');
    }
    return conversa || null;
  }

  /**
   * Alternar controle manual da conversa
   */
  alternarControleManual(id: string, ativo: boolean): boolean {
    const idNormalizado = normalizarWaId(id);
    this.log(`🔄 Alternando controle manual: ${idNormalizado} -> ${ativo ? '👤 Humano' : '🤖 Bot'}`);
    const conversa = this.conversations.get(idNormalizado);
    if (!conversa) {
      this.log('❌ Conversa não encontrada');
      return false;
    }
    conversa.isHuman = ativo;
    this.log('✅ Controle alterado');
    return true;
  }

  /**
   * Enviar mensagem e armazenar registro
   */
  async enviarMensagem(para: string, texto: string): Promise<string> {
    const paraNormalizado = normalizarWaId(para);
    this.log('📤 Enviando mensagem');
    this.log(`Para: ${paraNormalizado}`);
    this.log(`Texto: "${texto.substring(0, 60)}${texto.length > 60 ? '...' : ''}"`);
    
    try {
      await this.garantirResetAtualizado();
      // Garantir que conversa existe (será criada se não existir)
      this.obterOuCriarConversa(paraNormalizado);
      
      this.log(`🔄 Chamando client.sendMessage(${paraNormalizado}, texto)`);
      const resposta = await this.client.sendMessage(para, texto);
      
      // Log status da resposta
      this.log(`📨 Resposta: status ${resposta.status}, mensagens: ${resposta.data?.messages?.length || 0}`);
      
      const mensagemId = resposta.data?.messages?.[0]?.id;
      
      await this.adicionarMensagem(paraNormalizado, 'out', texto, mensagemId, Date.now());
      this.log(`✅ Enviada com ID: ${mensagemId}`);
      
      return mensagemId || '';
    } catch (erro: any) {
      const errorMessage = erro?.message || 'Desconhecido';
      const errorCode = erro?.response?.data?.error?.code || null;
      const errorType = erro?.response?.data?.error?.type || null;
      const status = erro?.response?.status || 'unknown';
      
      this.log('❌ Erro capturado');
      this.log(`Mensagem: ${errorMessage}`);
      this.log(`Status HTTP: ${status}`);
      if (errorCode) this.log(`Código: ${errorCode}`);
      if (errorType) this.log(`Tipo: ${errorType}`);
      
      throw erro;
    }
  }

  /**
   * Criar conversa com nome (para novas conversas)
   */
  async criarConversa(telefone: string, nome?: string): Promise<Conversation> {
    const telefoneNormalizado = normalizarWaId(telefone);
    this.log(`✨ Criando nova conversa: ${telefoneNormalizado}`);
    if (nome) this.log(`Nome: ${nome}`);
    
    await this.garantirResetAtualizado();
    const existente = this.conversations.get(telefoneNormalizado);
    if (existente) {
      this.log('ℹ️  Conversa já existe, atualizando nome se fornecido');
      if (nome && !existente.name) {
        existente.name = nome;
        await this.persistirConversas();
      }
      return existente;
    }

    const conversa: Conversation = {
      id: telefoneNormalizado,
      name: nome,
      phoneNumber: telefoneNormalizado,
      unreadCount: 0,
      isHuman: false,
      messages: [],
    };
    
    this.conversations.set(telefoneNormalizado, conversa);
    await this.persistirConversas();
    
    // Recarregar do arquivo para garantir que está salvo
    await this.recarregarConversas();
    this.log('✅ Conversa criada e salva');
    
    // Retornar a conversa recarregada
    return this.conversations.get(telefoneNormalizado)!;
  }

  /**
   * Apagar todas as conversas persistidas
   */
  async limparConversas(): Promise<void> {
    this.conversations.clear();
    const resetAt = Date.now();
    this.resetAt = resetAt;
    await salvarMeta({ resetAt });
    await salvarConversas({});
    this.log('🧹 Todas as conversas foram apagadas');
  }
}
