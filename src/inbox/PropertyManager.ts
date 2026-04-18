/**
 * Gerenciador de Propriedades/Imóveis
 * Permite adicionar novos imóveis e configurar tipos de monitoramento
 * 
 * Nota: Imóveis adicionais não exigem UID de indicador, pois o sistema
 * de indicações é aplicado apenas no cadastro inicial do usuário.
 */

import { adicionarInscrito, listarInscricoesPorCelular } from '../utils/inscritosSheet';
import type { WhatsApp } from '../wabapi';
import { logger } from '../utils/logger';

export interface NovoImovelData {
  celular: string;
  nome: string;
  bairro: string;
  cep?: string;
  tipoImovel?: string;
  pessoas?: string;
}

export interface ConversaNovoImovel {
  stage: 'bairro' | 'cep' | 'tipo_imovel' | 'pessoas';
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
      `🏠 *Adicionar Novo Imóvel*

Vamos cadastrar um novo imóvel para você!

Por favor, me diga o *bairro* deste imóvel.`
    );

    return {
      stage: 'bairro',
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
      case 'bairro':
        data.bairro = resposta;
        await this._send(
          data.celular!,
          `✅ Bairro: ${resposta}

Agora me diga o *CEP* do imóvel.`
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
          `✅ CEP: ${resposta}

Qual é o *tipo de imóvel*?
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
          `✅ Tipo: ${resposta}

Quantas *pessoas moram* neste imóvel?`
        );
        return {
          concluido: false,
          proximoStage: {
            stage: 'pessoas',
            data,
          },
        };

      case 'pessoas':
        data.pessoas = resposta;

        // Finalizar cadastro
        try {
          const resultado = await adicionarInscrito({
            nome: data.nome!,
            celular: data.celular!,
            bairro: data.bairro!,
            cep: data.cep,
            tipo_imovel: data.tipoImovel,
            pessoas: data.pessoas,
            uid_indicador: '', // Não precisa de indicador para imóveis adicionais
          });

          if (resultado.ok) {
            await this._send(
              data.celular!,
              `🎉 *Imóvel cadastrado com sucesso!*

📋 *Detalhes:*
🏠 ID do Imóvel: ${resultado.idImovel}
🆔 UID: ${resultado.uid}
📍 Bairro: ${data.bairro}
👥 Pessoas: ${data.pessoas}

Agora você pode enviar leituras para este imóvel usando o ID: *${resultado.idImovel}*

Exemplo: ${resultado.idImovel} agua 123`
            );

            logger.info('PropertyManager', `✅ Novo imóvel adicionado: ${resultado.idImovel} para ${data.nome}`);

            return { concluido: true };
          } else {
            await this._send(
              data.celular!,
              `❌ Erro ao cadastrar imóvel.

${resultado.erro || 'Tente novamente mais tarde.'}

Digite *adicionar casa* para tentar novamente.`
            );
            return { concluido: true, erro: resultado.erro };
          }
        } catch (erro: any) {
          logger.error('PropertyManager', `Erro ao adicionar imóvel: ${erro?.message || erro}`);
          await this._send(
            data.celular!,
            `❌ Ocorreu um erro ao cadastrar o imóvel.

Por favor, tente novamente mais tarde ou entre em contato com o suporte.`
          );
          return { concluido: true, erro: erro?.message };
        }

      default:
        return { concluido: true, erro: 'Stage inválido' };
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
