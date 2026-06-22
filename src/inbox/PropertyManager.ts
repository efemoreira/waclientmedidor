/**
 * Gerenciador de Propriedades/Imóveis
 * Permite adicionar novos imóveis e configurar tipos de monitoramento
 * 
 * Nota: Imóveis adicionais não exigem UID de indicador, pois o sistema
 * de indicações é aplicado apenas no cadastro inicial do usuário.
 */

import { adicionarInscrito, listarInscricoesPorCelular, resgatarCredito } from '../utils/inscritosSheet';
import { criarCobranca, obterCobrancaPorId, VALOR_ITEM_EXTRA, BILLING_ENABLED } from '../utils/cobrancasSheet';
import type { WhatsApp } from '../wabapi';
import { logger } from '../utils/logger';
import { normalizarTexto } from '../utils/text-normalizer';
import { MESSAGES } from './messages';

export interface NovoImovelData {
  celular: string;
  nome: string;
  bairro: string;
  cep?: string;
  tipoImovel?: string;
  pessoas?: string;
  lgpdAceiteData?: string;
  cobrancaId?: string;
}

export interface ConversaNovoImovel {
  stage: 'consentimento' | 'bairro' | 'cep' | 'tipo_imovel' | 'pessoas' | 'aguardando_pagamento';
  data: Partial<NovoImovelData>;
}

/**
 * Gerenciador de propriedades para usuários existentes
 */
export class PropertyManager {
  private client: WhatsApp;
  private _send: (to: string, text: string) => Promise<any>;

  constructor(client: WhatsApp, sendMessageFn?: (to: string, text: string) => Promise<any>) {
    this.client = client;
    this._send = sendMessageFn || ((to, text) => client.sendMessage(to, text));
  }

  /**
   * Iniciar processo de adicionar novo imóvel
   */
  async iniciarAdicaoImovel(celular: string, nome: string): Promise<ConversaNovoImovel> {
    await this._send(
      celular,
      `Adicionar novo imóvel

Vamos cadastrar um novo imóvel para você. Usamos bairro, CEP e leituras enviadas apenas para prestar este serviço.

Digite SIM para concordar e continuar.`
    );

    return {
      stage: 'consentimento',
      data: {
        celular,
        nome,
      },
    };
  }

  /**
   * Processar próximo passo da adição de imóvel
   */
  async processarProximoPasso(
    conversa: ConversaNovoImovel,
    resposta: string
  ): Promise<{ concluido: boolean; proximoStage?: ConversaNovoImovel; erro?: string }> {
    const { stage, data } = conversa;

    switch (stage) {
      case 'consentimento': {
        const aceitou = /^(sim|concordo|aceito|ok|sim\s*concordo)$/i.test(normalizarTexto(resposta).trim());
        if (!aceitou) {
          await this._send(
            data.celular!,
            `Para continuar, precisamos do seu consentimento.

Digite SIM para concordar com o uso dos seus dados (bairro, CEP, leituras) e continuar o cadastro deste imóvel.`
          );
          return { concluido: false, proximoStage: conversa };
        }
        data.lgpdAceiteData = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
        await this._send(data.celular!, 'Perfeito. Agora me diga o bairro deste imóvel.');
        return {
          concluido: false,
          proximoStage: {
            stage: 'bairro',
            data,
          },
        };
      }

      case 'bairro':
        data.bairro = resposta;
        await this._send(
          data.celular!,
          `Bairro: ${resposta}

Agora me diga o CEP do imóvel.`
        );
        return {
          concluido: false,
          proximoStage: {
            stage: 'cep',
            data,
          },
        };

      case 'cep':
        data.cep = resposta;
        await this._send(
          data.celular!,
          `CEP: ${resposta}

Qual é o tipo de imóvel?
(Exemplos: casa, apartamento, comercial, etc.)`
        );
        return {
          concluido: false,
          proximoStage: {
            stage: 'tipo_imovel',
            data,
          },
        };

      case 'tipo_imovel':
        data.tipoImovel = resposta;
        await this._send(
          data.celular!,
          `Tipo: ${resposta}

Quantas pessoas moram neste imóvel?`
        );
        return {
          concluido: false,
          proximoStage: {
            stage: 'pessoas',
            data,
          },
        };

      case 'pessoas': {
        data.pessoas = resposta;

        // Item extra (2º+ imóvel) — cobrança de R$5, com abatimento de crédito
        // de indicação. Com BILLING_ENABLED=false (padrão), apenas registra o
        // que seria cobrado (status 'isento_dev') e o cadastro segue normalmente.
        const billing = await this.avaliarCobranca(data.celular!, 'novo_imovel');
        if (billing.bloqueado) {
          data.cobrancaId = billing.cobrancaId;
          await this._send(data.celular!, MESSAGES.COBRANCA_PENDENTE(billing.valorFinal!));
          return {
            concluido: false,
            proximoStage: { stage: 'aguardando_pagamento', data },
          };
        }
        if (billing.creditoAplicado) {
          await this._send(data.celular!, MESSAGES.CREDITO_APLICADO(billing.creditoAplicado));
        }

        return this.finalizarCadastroImovel(data);
      }

      case 'aguardando_pagamento': {
        const cobranca = data.cobrancaId ? await obterCobrancaPorId(data.cobrancaId) : null;
        if (cobranca?.status === 'pago') {
          return this.finalizarCadastroImovel(data);
        }
        await this._send(data.celular!, MESSAGES.COBRANCA_AINDA_PENDENTE);
        return { concluido: false, proximoStage: conversa };
      }

      default:
        return { concluido: true, erro: 'Stage inválido' };
    }
  }

  /**
   * Avalia se o cadastro de um item extra (imóvel ou tipo de monitoramento)
   * deve ser cobrado. Abate crédito de indicação acumulado pelo usuário antes
   * de decidir. Sem BILLING_ENABLED, só registra o ledger e nunca bloqueia.
   */
  private async avaliarCobranca(
    celular: string,
    tipoCobranca: 'novo_imovel' | 'novo_tipo_monitoramento'
  ): Promise<{ bloqueado: boolean; cobrancaId?: string; valorFinal?: number; creditoAplicado: number }> {
    const inscricoesExistentes = await listarInscricoesPorCelular(celular);
    const uidPrincipal = inscricoesExistentes[0]?.uid;
    if (!uidPrincipal) {
      return { bloqueado: false, creditoAplicado: 0 };
    }

    let creditoAplicado = 0;
    if (BILLING_ENABLED) {
      const resgate = await resgatarCredito(uidPrincipal, VALOR_ITEM_EXTRA);
      creditoAplicado = resgate.aplicado;
    }

    const valorFinal = Math.max(0, VALOR_ITEM_EXTRA - creditoAplicado);
    const status = !BILLING_ENABLED ? 'isento_dev' : valorFinal === 0 ? 'pago' : 'pendente';

    const cobranca = await criarCobranca({
      uid: uidPrincipal,
      idImovel: '',
      tipoCobranca,
      valorBruto: VALOR_ITEM_EXTRA,
      creditoAplicado,
      status,
    });

    // Se não foi possível registrar a cobrança (ex.: planilha indisponível),
    // não bloqueia o cadastro do usuário por uma falha de infraestrutura.
    return {
      bloqueado: BILLING_ENABLED && status === 'pendente' && cobranca.ok,
      cobrancaId: cobranca.id,
      valorFinal,
      creditoAplicado,
    };
  }

  /**
   * Cria o imóvel na planilha de inscritos e responde ao usuário.
   */
  private async finalizarCadastroImovel(
    data: Partial<NovoImovelData>
  ): Promise<{ concluido: boolean; proximoStage?: ConversaNovoImovel; erro?: string }> {
    try {
      const resultado = await adicionarInscrito({
        nome: data.nome!,
        celular: data.celular!,
        bairro: data.bairro!,
        cep: data.cep,
        tipo_imovel: data.tipoImovel,
        pessoas: data.pessoas,
        uid_indicador: '', // Não precisa de indicador para imóveis adicionais
        lgpdAceiteData: data.lgpdAceiteData || '',
      });

      if (resultado.ok) {
        await this._send(
          data.celular!,
          `Imóvel cadastrado com sucesso.

Detalhes:
ID do imóvel: ${resultado.idImovel}
UID: ${resultado.uid}
Bairro: ${data.bairro}
Pessoas: ${data.pessoas}

Agora você pode enviar leituras para este imóvel usando o ID: ${resultado.idImovel}

Exemplo: ${resultado.idImovel} agua 123`
        );

        logger.info('PropertyManager', `✅ Novo imóvel adicionado: ${resultado.idImovel} para ${data.nome}`);

        return { concluido: true };
      }

      await this._send(
        data.celular!,
        `Erro ao cadastrar imóvel.

${resultado.erro || 'Tente novamente mais tarde.'}

Digite adicionar casa para tentar novamente.`
      );
      return { concluido: true, erro: resultado.erro };
    } catch (erro: any) {
      logger.error('PropertyManager', `Erro ao adicionar imóvel: ${erro?.message || erro}`);
      await this._send(
        data.celular!,
        `Ocorreu um erro ao cadastrar o imóvel.

Por favor, tente novamente mais tarde ou entre em contato com o suporte.`
      );
      return { concluido: true, erro: erro?.message };
    }
  }

  /**
   * Verificar se usuário pode adicionar novo imóvel
   */
  async podeAdicionarImovel(celular: string): Promise<{ pode: boolean; nome?: string; erro?: string }> {
    try {
      const inscricoes = await listarInscricoesPorCelular(celular);
      
      if (inscricoes.length === 0) {
        return {
          pode: false,
          erro: 'Você precisa estar cadastrado primeiro. Digite seu nome para começar.',
        };
      }

      // Pegar o nome da primeira inscrição
      const nome = inscricoes[0].nome;

      return {
        pode: true,
        nome,
      };
    } catch (erro: any) {
      logger.error('PropertyManager', `Erro ao verificar inscrição: ${erro?.message || erro}`);
      return {
        pode: false,
        erro: 'Erro ao verificar cadastro. Tente novamente.',
      };
    }
  }
}
