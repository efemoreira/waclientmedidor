import { WhatsApp } from '../wabapi';
import { config } from '../config';
import { normalizarNumero } from '../utils/phone-normalizer';

/**
 * Representa um contato para envio
 */
export interface Contact {
  numero: string;
  mensagem: string;
  link?: string;
  template?: string;
  language?: string;
  marketing?: boolean;
  productPolicy?: 'CLOUD_API_FALLBACK' | 'STRICT';
  messageActivitySharing?: boolean;
  status?: string;
  mensagem_id?: string;
  erro?: string;
}

/**
 * Gerenciador de envio de mensagens em massa
 */
export class EnvioMassa {
  private client: WhatsApp;
  private delayMensagens: number;
  private onProgress?: (info: {
    contato: Contact;
    index: number;
    total: number;
  }) => Promise<void> | void;
  private shouldStop?: () => Promise<boolean> | boolean;
  private onRequest?: (info: { url: string; payload: any; contato: Contact }) => Promise<void> | void;

  constructor(options?: {
    onProgress?: (info: { contato: Contact; index: number; total: number }) => Promise<void> | void;
    shouldStop?: () => Promise<boolean> | boolean;
    onRequest?: (info: { url: string; payload: any; contato: Contact }) => Promise<void> | void;
  }) {
    const versionStr = config.whatsapp.apiVersion.replace(/\.0$/, '');
    const apiVersion = parseInt(versionStr, 10);
    console.log(`🔧 BulkMessaging: Usando API v${apiVersion}.0`);
    this.client = new WhatsApp({
      token: config.whatsapp.token,
      numberId: config.whatsapp.numberId,
      version: apiVersion,
    });
    this.delayMensagens = config.bulk.delayBetweenMessages;
    this.onProgress = options?.onProgress;
    this.shouldStop = options?.shouldStop;
    this.onRequest = options?.onRequest;
  }

  /**
   * Enviar mensagem para um contato individual
   */
  private async enviarParaContato(contato: Contact): Promise<void> {
    try {
      const numero = normalizarNumero(contato.numero);
      if (!numero) {
        throw new Error('Número inválido');
      }

      let response;
      if (contato.template) {
        const baseUrl = this.client.baseUrl;
        const endpoint = contato.marketing ? 'marketing_messages' : 'messages';
        const url = `${baseUrl}/${this.client.id}/${endpoint}`;
        const payload = {
          messaging_product: 'whatsapp',
          to: numero,
          recipient_type: 'individual',
          type: 'template',
          template: {
            name: contato.template,
            language: { code: contato.language || 'pt_BR' },
            components: [],
          },
          ...(contato.marketing && contato.productPolicy ? { product_policy: contato.productPolicy } : {}),
          ...(contato.marketing && typeof contato.messageActivitySharing === 'boolean'
            ? { message_activity_sharing: contato.messageActivitySharing }
            : {}),
        };
        console.log('📤 Bulk Template POST');
        console.log('  URL:', url);
        console.log('  Payload:', JSON.stringify(payload));
        if (this.onRequest) {
          await this.onRequest({ url, payload, contato });
        }

        if (contato.marketing) {
          response = await this.client.sendMarketingTemplateMessage(
            numero,
            contato.template,
            [],
            contato.language || 'pt_BR',
            {
              productPolicy: contato.productPolicy,
              messageActivitySharing: contato.messageActivitySharing,
            }
          );
        } else {
          response = await this.client.sendTemplateMessage(
          numero,
          contato.template,
          [],
          contato.language || 'pt_BR'
          );
        }
      } else {
        let texto = contato.mensagem;
        if (contato.link) {
          texto += `\n\n${contato.link}`;
        }

        const url = `${this.client.baseUrl}/${this.client.id}/messages`;
        const payload = {
          messaging_product: 'whatsapp',
          to: numero,
          recipient_type: 'individual',
          type: 'text',
          text: { body: texto, preview_url: true },
        };
        console.log('📤 Bulk Text POST');
        console.log('  URL:', url);
        console.log('  Payload:', JSON.stringify(payload));
        if (this.onRequest) {
          await this.onRequest({ url, payload, contato });
        }

        response = await this.client.sendMessage(numero, texto);
      }

      contato.status = 'enviado';
      contato.mensagem_id = response.data.messages?.[0]?.id;
    } catch (error: any) {
      contato.status = 'erro';
      contato.erro =
        error.response?.data?.error?.message || error.message;
    }
  }

  /**
   * Processar contatos com rate limiting
   */
  private async procesarContatos(contatos: Contact[]): Promise<void> {
    for (let i = 0; i < contatos.length; i++) {
      if (this.shouldStop && (await this.shouldStop())) {
        throw new Error('Envio interrompido pelo usuário');
      }
      const contato = contatos[i];

      if (contato.status === 'enviado') {
        continue;
      }

      await this.enviarParaContato(contato);
      if (this.onProgress) {
        await this.onProgress({ contato, index: i + 1, total: contatos.length });
      }

      if (i < contatos.length - 1) {
        await new Promise(resolve => setTimeout(resolve, this.delayMensagens));
      }
    }
  }

  /**
   * Executar envio em massa
   */
  async executar(contatos: Contact[]): Promise<void> {
    await this.procesarContatos(contatos);
  }
}


