/**
 * Gerenciador de Imóveis — adicionar novo prédio para um cliente já cadastrado.
 *
 * Fluxo simplificado:
 *   consentimento → nome_predio → bairro → cadastro
 *
 * Bilhetagem de item extra (2º+ imóvel) é mantida mas não bloqueia enquanto
 * BILLING_ENABLED=false (padrão).
 */

import { listarPrediosPorCliente, adicionarPredio } from '../utils/prediosSheet';
import { criarCobranca, obterCobrancaPorId, VALOR_ITEM_EXTRA, BILLING_ENABLED } from '../utils/cobrancasSheet';
import type { WhatsApp } from '../wabapi';
import { logger } from '../utils/logger';
import { normalizarTexto } from '../utils/text-normalizer';
import { MESSAGES } from './messages';

export interface NovoImovelData {
  celular: string;
  nome: string;
  nomePredio?: string;
  bairro?: string;
  lgpdAceiteData?: string;
  cobrancaId?: string;
}

export interface ConversaNovoImovel {
  stage: 'consentimento' | 'nome_predio' | 'bairro' | 'aguardando_pagamento';
  data: Partial<NovoImovelData>;
}

export class PropertyManager {
  private client: WhatsApp;
  private _send: (to: string, text: string) => Promise<any>;

  constructor(client: WhatsApp, sendMessageFn?: (to: string, text: string) => Promise<any>) {
    this.client = client;
    this._send = sendMessageFn || ((to, text) => client.sendMessage(to, text));
  }

  async iniciarAdicaoImovel(celular: string, nome: string): Promise<ConversaNovoImovel> {
    await this._send(celular,
      `🏠 *Adicionar novo imóvel*\n\nVamos cadastrar mais um prédio para você. Seus dados serão usados só para prestar o serviço (LGPD).\n\nDigite *SIM* para concordar e continuar.`
    );
    return { stage: 'consentimento', data: { celular, nome } };
  }

  async processarProximoPasso(
    conversa: ConversaNovoImovel,
    resposta: string
  ): Promise<{ concluido: boolean; proximoStage?: ConversaNovoImovel; erro?: string }> {
    const { stage, data } = conversa;

    switch (stage) {
      case 'consentimento': {
        const aceitou = /^(sim|concordo|aceito|ok)$/i.test(normalizarTexto(resposta).trim());
        if (!aceitou) {
          await this._send(data.celular!, `Para continuar, digite *SIM* para concordar com o uso dos seus dados.`);
          return { concluido: false, proximoStage: conversa };
        }
        data.lgpdAceiteData = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
        await this._send(data.celular!, MESSAGES.INSCRICAO_NOME_PREDIO);
        return { concluido: false, proximoStage: { stage: 'nome_predio', data } };
      }

      case 'nome_predio': {
        data.nomePredio = resposta.trim();
        await this._send(data.celular!, MESSAGES.INSCRICAO_BAIRRO);
        return { concluido: false, proximoStage: { stage: 'bairro', data } };
      }

      case 'bairro': {
        data.bairro = resposta;

        const billing = await this._avaliarCobranca(data.celular!);
        if (billing.bloqueado) {
          data.cobrancaId = billing.cobrancaId;
          await this._send(data.celular!, MESSAGES.COBRANCA_PENDENTE(billing.valorFinal!));
          return { concluido: false, proximoStage: { stage: 'aguardando_pagamento', data } };
        }
        if (billing.creditoAplicado) {
          await this._send(data.celular!, MESSAGES.CREDITO_APLICADO(billing.creditoAplicado));
        }

        return this._finalizarCadastroImovel(data);
      }

      case 'aguardando_pagamento': {
        const cobranca = data.cobrancaId ? await obterCobrancaPorId(data.cobrancaId) : null;
        if (cobranca?.status === 'pago') return this._finalizarCadastroImovel(data);
        await this._send(data.celular!, MESSAGES.COBRANCA_AINDA_PENDENTE);
        return { concluido: false, proximoStage: conversa };
      }

      default:
        return { concluido: true, erro: 'Stage inválido' };
    }
  }

  private async _avaliarCobranca(celular: string): Promise<{
    bloqueado: boolean;
    cobrancaId?: string;
    valorFinal?: number;
    creditoAplicado: number;
  }> {
    const predios = await listarPrediosPorCliente(celular);
    const uidPrincipal = predios[0]?.uid;
    if (!uidPrincipal) return { bloqueado: false, creditoAplicado: 0 };

    const valorFinal = VALOR_ITEM_EXTRA;
    const status = !BILLING_ENABLED ? 'isento_dev' : 'pendente';

    const cobranca = await criarCobranca({
      uid: uidPrincipal,
      idImovel: predios[0]?.idImovel || '',
      tipoCobranca: 'novo_imovel',
      valorBruto: VALOR_ITEM_EXTRA,
      creditoAplicado: 0,
      status,
    });

    return {
      bloqueado: BILLING_ENABLED && status === 'pendente' && cobranca.ok,
      cobrancaId: cobranca.id,
      valorFinal,
      creditoAplicado: 0,
    };
  }

  private async _finalizarCadastroImovel(
    data: Partial<NovoImovelData>
  ): Promise<{ concluido: boolean; proximoStage?: ConversaNovoImovel; erro?: string }> {
    try {
      const resultado = await adicionarPredio({
        idCliente: data.celular!,
        nomePredio: data.nomePredio || '',
        bairro: data.bairro || '',
      });

      if (resultado.ok) {
        await this._send(data.celular!,
          `✅ *Imóvel cadastrado!*\n\n🏠 ${data.nomePredio}\n📍 ${data.bairro || ''}\n🆔 ${resultado.idImovel}\n\nAgora você pode enviar leituras: *${resultado.idImovel} agua 123*`
        );
        logger.info('PropertyManager', `✅ Imóvel ${resultado.idImovel} adicionado para ${data.celular}`);
        return { concluido: true };
      }

      await this._send(data.celular!, `❌ Erro ao cadastrar imóvel: ${resultado.erro || 'Tente novamente.'}`);
      return { concluido: true, erro: resultado.erro };
    } catch (erro: any) {
      logger.error('PropertyManager', `Erro ao adicionar imóvel: ${erro?.message || erro}`);
      await this._send(data.celular!, `❌ Ocorreu um erro ao cadastrar. Tente novamente mais tarde.`);
      return { concluido: true, erro: erro?.message };
    }
  }

  async podeAdicionarImovel(celular: string): Promise<{ pode: boolean; nome?: string; erro?: string }> {
    try {
      const predios = await listarPrediosPorCliente(celular);
      if (predios.length === 0) {
        return { pode: false, erro: 'Você precisa estar cadastrado primeiro.' };
      }
      return { pode: true, nome: predios[0].nome };
    } catch (erro: any) {
      return { pode: false, erro: 'Erro ao verificar cadastro. Tente novamente.' };
    }
  }
}
