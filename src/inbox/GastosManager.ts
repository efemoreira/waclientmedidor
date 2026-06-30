/**
 * Gerenciador de Acompanhamento de Gastos (Água, Energia, Gás)
 * Separado da lógica de partido/mensagens genéricas
 */

import { appendPredioEntry, obterUltimaLeitura, getWeekOfYear, obterInsightsConsumo } from '../utils/predioSheet';
import { listarInscricoesPorCelular, atualizarUltimoRelatorio, atualizarUltimaLeitura } from '../utils/inscritosSheet';
import { jaEnviadoRelatorio, registrarRelatorioEnviado } from '../utils/relatoriosSheet';
import { obterAnuncioPorBairro, registrarImpressao } from '../utils/anunciosSheet';
import { registrarLeadAgua } from '../utils/leadsAguaSheet';
import type { WhatsApp } from '../wabapi';
import { MESSAGES } from './messages';
import { logger } from '../utils/logger';

const ADMIN_VENDAS_PHONE = process.env.ADMIN_VENDAS_PHONE || '558586999181'; // Oscar

export interface PendingLeitura {
  valor?: string;
  tipo?: 'agua' | 'energia' | 'gas';
  idImovel?: string;
}

export interface InscritoDados {
  uid: string;
  idImovel: string;
  nome?: string;
  bairro?: string;
  celular: string;
  monitorandoAgua?: boolean;
  monitorandoEnergia?: boolean;
  monitorandoGas?: boolean;
  ultimoRelatorioSemanal?: string;
  ultimoRelatorioMensal?: string;
}

/**
 * Gerenciador de lógica de gastos
 */
export class GastosManager {
  private client: WhatsApp;
  private _send: (to: string, text: string) => Promise<any>;
  private tarifaBaseM3: number = Number(process.env.WATER_TARIFA_M3 || '6.5');
  private metaMensalM3: number = Number(process.env.WATER_META_MENSAL || '20');
  private diasAtrasoLembrete: number = Number(process.env.LEMBRETE_DIAS_ATRASO || '35');

  constructor(client: WhatsApp, sendMessageFn?: (to: string, text: string) => Promise<any>) {
    this.client = client;
    this._send = sendMessageFn || ((to, text) => client.sendMessage(to, text));
  }

  /**
   * Determinar tipos de monitoramento comuns a todas as inscrições.
   * Retorna um array com todos os tipos comuns (vazio se não houver nenhum).
   */
  private obterMonitoramentosComuns(inscricoes: InscritoDados[]): ('agua' | 'energia' | 'gas')[] {
    if (!inscricoes.length) return [];

    // Mapeamento entre tipos e suas propriedades correspondentes
    const tipoParaPropriedade: Record<'agua' | 'energia' | 'gas', keyof InscritoDados> = {
      agua: 'monitorandoAgua',
      energia: 'monitorandoEnergia',
      gas: 'monitorandoGas',
    };

    // Coletar todos os tipos que TODAS as inscrições monitoram
    const tipos = ['agua', 'energia', 'gas'] as const;
    const tiposComuns: ('agua' | 'energia' | 'gas')[] = [];

    for (const tipo of tipos) {
      const propriedade = tipoParaPropriedade[tipo];
      // Se TODAS as inscrições monitoram este tipo
      const todasMonitoram = inscricoes.every((inscricao) => inscricao[propriedade] === true);
      if (todasMonitoram) {
        tiposComuns.push(tipo);
      }
    }

    return tiposComuns;
  }

  /**
   * Parsear data no formato brasileiro dd/mm/yyyy
   */
  private parseDateBR(dateStr: string): Date | null {
    if (!dateStr) return null;
    const match = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!match) return null;
    const d = new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]));
    return isNaN(d.getTime()) ? null : d;
  }

  /**
   * Verificar se o relatório semanal precisa ser enviado
   * (última entrega há mais de 7 dias ou nunca enviado)
   */
  private precisaRelatorioSemanal(ultimoRelatorio?: string): boolean {
    if (!ultimoRelatorio) return true;
    const ultima = this.parseDateBR(ultimoRelatorio);
    if (!ultima) return true;
    const diffMs = Date.now() - ultima.getTime();
    return diffMs / (1000 * 60 * 60 * 24) >= 7;
  }

  /**
   * Verificar se o relatório mensal precisa ser enviado
   * (mês/ano diferente do último envio ou nunca enviado)
   */
  private precisaRelatorioMensal(ultimoRelatorio?: string): boolean {
    if (!ultimoRelatorio) return true;
    const ultima = this.parseDateBR(ultimoRelatorio);
    if (!ultima) return true;
    const hoje = this.parseDateBR(new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }));
    if (!hoje) return true;
    return hoje.getFullYear() !== ultima.getFullYear() || hoje.getMonth() !== ultima.getMonth();
  }

  /**
   * Enviar anúncio hiperlocal (texto ou imagem) como 4ª mensagem, apenas se
   * houver um anúncio ativo cadastrado para o bairro do imóvel. Caso contrário,
   * não envia nada além das mensagens de leitura.
   */
  private async enviarAnuncioSeHouver(de: string, inscricao: InscritoDados): Promise<void> {
    if (!inscricao.bairro) return;

    try {
      const anuncio = await obterAnuncioPorBairro(inscricao.bairro);
      if (!anuncio) return;

      if (anuncio.tipo === 'imagem' && anuncio.mediaUrl) {
        await this.client.sendImage(de, anuncio.mediaUrl, anuncio.conteudoTexto);
      } else {
        await this._send(de, `📢 Patrocinado\n\n${anuncio.conteudoTexto}`);
      }
      await registrarImpressao(anuncio.id);
    } catch (erro: any) {
      logger.warn('GastosManager', `Erro ao enviar anúncio para ${de}: ${erro?.message || erro}`);
    }
  }

  /**
   * Enviar relatórios periódicos (semanal/mensal) quando devidos e atualizar planilha
   */
  private async enviarRelatoriosPeriodicos(
    de: string,
    idImovel: string,
    tipo: string,
    result: { consumoSemana?: string; mediaSemana?: string; consumoMes?: string; mediaMes?: string },
    inscricao: InscritoDados
  ): Promise<void> {
    const hoje = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const agora = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
    const refSemanal = `${agora.getFullYear()}-W${String(getWeekOfYear(agora)).padStart(2, '0')}`;
    const refMensal = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}`;

    const podeSemanal = this.precisaRelatorioSemanal(inscricao.ultimoRelatorioSemanal);
    const jaEnviadoSemanal = await jaEnviadoRelatorio(idImovel, 'semanal', refSemanal);
    if (podeSemanal && !jaEnviadoSemanal) {
      try {
        await this._send(de, MESSAGES.RELATORIO_SEMANAL({
          idImovel,
          tipo,
          consumoSemana: result.consumoSemana,
          mediaSemana: result.mediaSemana,
        }));
        await atualizarUltimoRelatorio(inscricao.uid, 'semanal', hoje);
        await registrarRelatorioEnviado(idImovel, 'semanal', refSemanal);
      } catch (erro: any) {
        logger.warn('GastosManager', `Erro ao enviar relatório semanal para ${idImovel}: ${erro?.message || erro}`);
      }
    }

    const podeMensal = this.precisaRelatorioMensal(inscricao.ultimoRelatorioMensal);
    const jaEnviadoMensal = await jaEnviadoRelatorio(idImovel, 'mensal', refMensal);
    if (podeMensal && !jaEnviadoMensal) {
      try {
        await this._send(de, MESSAGES.RELATORIO_MENSAL({
          idImovel,
          tipo,
          consumoMes: result.consumoMes,
          mediaMes: result.mediaMes,
        }));
        await atualizarUltimoRelatorio(inscricao.uid, 'mensal', hoje);
        await registrarRelatorioEnviado(idImovel, 'mensal', refMensal);
      } catch (erro: any) {
        logger.warn('GastosManager', `Erro ao enviar relatório mensal para ${idImovel}: ${erro?.message || erro}`);
      }
    }
  }

  private formatarMoeda(valor: number): string {
    return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  private barraMeta(percentual: number): string {
    const total = 10;
    const preenchido = Math.max(0, Math.min(total, Math.round((percentual / 100) * total)));
    return `${'🟩'.repeat(preenchido)}${'⬜'.repeat(total - preenchido)}`;
  }

  private async montarMensagensLeitura(
    params: {
      tipo: 'agua' | 'energia' | 'gas';
      idImovel: string;
      data?: string;
      leituraAtual: string;
      leituraAnterior?: string;
      dias?: number;
      consumo?: string;
      media?: string;
      consumoDia?: string;
      mediaDia?: string;
      consumoSemana?: string;
      mediaSemana?: string;
      consumoMes?: string;
      mediaMes?: string;
    }
  ): Promise<{ msg1: string; msg2: string; msg3: string; nivelAlerta?: 'atencao' | 'forte'; mediaReferenciaDia?: number; consumoMesNum?: number }> {
    const insights = await obterInsightsConsumo(params.idImovel, params.tipo);
    const consumoMes = Number(String(params.consumoMes || '0').replace(',', '.')) || 0;
    const mediaDia = Number(String(params.mediaDia || params.media || '0').replace(',', '.')) || 0;
    const agora = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
    const diasNoMes = new Date(agora.getFullYear(), agora.getMonth() + 1, 0).getDate();
    const previsaoConsumoMes = mediaDia > 0 ? mediaDia * diasNoMes : consumoMes;
    const previsaoConta = this.formatarMoeda(previsaoConsumoMes * this.tarifaBaseM3);

    const percentualMeta = this.metaMensalM3 > 0
      ? Math.min(999, (consumoMes / this.metaMensalM3) * 100)
      : 0;
    const barraMeta = this.barraMeta(percentualMeta);

    const comparacaoTexto = insights.comparacaoCondominioPercent === undefined
      ? undefined
      : insights.comparacaoCondominioPercent <= 0
        ? `${Math.abs(insights.comparacaoCondominioPercent).toFixed(1)}% menos que a média do condomínio`
        : `${Math.abs(insights.comparacaoCondominioPercent).toFixed(1)}% acima da média do condomínio`;

    const padraoFaixa = insights.faixaNormalMin && insights.faixaNormalMax
      ? `${insights.faixaNormalMin.toFixed(2)}-${insights.faixaNormalMax.toFixed(2)} m³/dia`
      : undefined;

    const msg1 = MESSAGES.MSG_DESDE_ULTIMA({
      ...params,
      semHistorico: insights.semHistorico,
      nivelAlerta: insights.nivelAlerta,
      padraoFaixa,
    });

    const msg2 = MESSAGES.MSG_GASTO_DIA({
      tipo: params.tipo,
      consumoDia: params.consumoDia,
      mediaDia: params.mediaDia,
      graficoSemanal: insights.graficoSemanal,
      comparacaoTexto,
    });

    const msg3 = MESSAGES.MSG_GASTO_SEMANA_MES({
      tipo: params.tipo,
      consumoSemana: params.consumoSemana,
      mediaSemana: params.mediaSemana,
      consumoMes: params.consumoMes,
      mediaMes: params.mediaMes,
      previsaoConta,
      metaPercentual: percentualMeta.toFixed(0),
      metaBarra: barraMeta,
    });

    return { msg1, msg2, msg3, nivelAlerta: insights.nivelAlerta, mediaReferenciaDia: insights.mediaReferenciaDia, consumoMesNum: consumoMes };
  }

  /**
   * Registra lead de manutenção hidráulica e notifica admins quando anomalia forte é detectada.
   * Chamado após envio das mensagens de leitura — não bloqueia o fluxo principal.
   */
  private async processarLeadAgua(
    de: string,
    idImovel: string,
    nomeCliente: string | undefined,
    consumoAtualM3: number,
    mediaReferenciaM3: number,
    desvioPercent: number
  ): Promise<void> {
    try {
      await registrarLeadAgua({
        idCliente: de,
        nomeCliente,
        imovel: idImovel,
        consumoAtual: consumoAtualM3,
        consumoAnterior: mediaReferenciaM3,
        desvioPercent,
      });

      const msgOscar = `🔴 *Lead de água — manutenção hidráulica*\n\n👤 ${nomeCliente || de}\n🏠 Imóvel: ${idImovel}\n📈 Consumo +${desvioPercent.toFixed(0)}% acima do normal\n\nSugerir visita de verificação hidráulica.`;
      await this._send(ADMIN_VENDAS_PHONE, msgOscar);
    } catch (e: any) {
      logger.warn('GastosManager', `Erro ao processar lead de água: ${e?.message || e}`);
    }
  }

  /**
   * Verificar e listar inscrições de um usuário
   */
  async obterInscricoes(celular: string): Promise<InscritoDados[]> {
    try {
      return await listarInscricoesPorCelular(celular);
    } catch (erro) {
      return [];
    }
  }

  /**
   * Formatar lista de casas com última leitura
   */
  async formatarCasas(inscricoes: InscritoDados[]): Promise<string> {
    if (!inscricoes.length) return 'Nenhum imóvel encontrado.';
    
    const linhas: string[] = [];
    for (const item of inscricoes) {
      const ultima = await obterUltimaLeitura(item.idImovel);
      const ultimaTexto = ultima.leitura
        ? `${ultima.leitura}${ultima.data ? ` (${ultima.data})` : ''}`
        : 'sem leitura';
      linhas.push(`• ${item.idImovel} - ${item.bairro || 'bairro não informado'} - última leitura: ${ultimaTexto}`);
    }
    return linhas.join('\n');
  }

  /**
   * Responder comando "Meu UID"
   */
  async responderMeuUid(de: string, inscricoes: InscritoDados[]): Promise<void> {
    if (!inscricoes.length) {
      await this._send(de, MESSAGES.ERRO_CADASTRO_NAO_ENCONTRADO);
      return;
    }
    const uids = inscricoes.map((i) => ({ uid: i.uid, idImovel: i.idImovel }));
    await this._send(de, MESSAGES.INFO_MEUS_UIDS(uids));
  }

  /**
   * Responder comando "Minhas casas"
   */
  async responderMinhasCasas(de: string, inscricoes: InscritoDados[]): Promise<void> {
    const lista = await this.formatarCasas(inscricoes);
    await this._send(de, MESSAGES.INFO_MINHAS_CASAS(lista));
  }

  /**
   * Responder comando "Status" com dias desde a última leitura, consumo do
   * mês até agora e previsão de conta por tipo monitorado — dá ao usuário um
   * motivo concreto para abrir a conversa entre leituras.
   */
  async responderStatusDetalhado(de: string, inscricoes: InscritoDados[]): Promise<void> {
    if (!inscricoes.length) {
      await this._send(de, MESSAGES.ERRO_CADASTRO_NAO_ENCONTRADO);
      return;
    }

    const tiposPossiveis: Array<'agua' | 'energia' | 'gas'> = ['agua', 'energia', 'gas'];
    const agora = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
    const diasNoMes = new Date(agora.getFullYear(), agora.getMonth() + 1, 0).getDate();

    const imoveis = await Promise.all(
      inscricoes.map(async (inscricao) => {
        const tiposAtivos = tiposPossiveis.filter((tipo) => {
          if (tipo === 'agua') return inscricao.monitorandoAgua;
          if (tipo === 'energia') return inscricao.monitorandoEnergia;
          return inscricao.monitorandoGas;
        });

        const tipos = await Promise.all(
          tiposAtivos.map(async (tipo) => {
            const [ultima, insights] = await Promise.all([
              obterUltimaLeitura(inscricao.idImovel),
              obterInsightsConsumo(inscricao.idImovel, tipo),
            ]);

            const dataUltima = ultima.data ? this.parseDateBR(ultima.data) : null;
            const diasUltimaLeitura = dataUltima
              ? Math.max(0, Math.round((Date.now() - dataUltima.getTime()) / (1000 * 60 * 60 * 24)))
              : undefined;

            const consumoMes = insights.consumoMesAtual > 0 ? insights.consumoMesAtual.toFixed(2) : undefined;
            const previsaoConsumoMes = insights.mediaReferenciaDia
              ? insights.mediaReferenciaDia * diasNoMes
              : insights.consumoMesAtual;
            const previsaoConta = previsaoConsumoMes > 0
              ? this.formatarMoeda(previsaoConsumoMes * this.tarifaBaseM3)
              : undefined;

            return { tipo, diasUltimaLeitura, consumoMes, previsaoConta };
          })
        );

        return { idImovel: inscricao.idImovel, bairro: inscricao.bairro, tipos };
      })
    );

    await this._send(de, MESSAGES.INFO_STATUS_DETALHADO(imoveis));
  }

  /**
   * Responder comando "Como indicar"
   */
  async responderComoIndicar(de: string, inscricoes: InscritoDados[]): Promise<void> {
    if (!inscricoes.length) {
      await this._send(de, MESSAGES.ERRO_CADASTRO_NAO_ENCONTRADO);
      return;
    }
    const uids = inscricoes.map((i) => i.uid);
    await this._send(de, MESSAGES.INFO_COMO_INDICAR(uids));
  }

  /**
   * Como o bot só responde mensagens recebidas, este nudge é aproveitado
   * dentro de uma resposta que já seria enviada de qualquer forma (comando,
   * menu, etc.) — nunca como mensagem proativa. Retorna o imóvel/tipo com a
   * leitura mais atrasada (acima de `diasAtrasoLembrete` dias), ou null.
   */
  async obterNudgeAtraso(inscricoes: InscritoDados[]): Promise<string | null> {
    let maisAtrasado: { idImovel: string; tipo: string; dias: number } | null = null;

    for (const inscricao of inscricoes) {
      const tipos: Array<'agua' | 'energia' | 'gas'> = [];
      if (inscricao.monitorandoAgua) tipos.push('agua');
      if (inscricao.monitorandoEnergia) tipos.push('energia');
      if (inscricao.monitorandoGas) tipos.push('gas');
      if (!tipos.length) continue;

      const ultima = await obterUltimaLeitura(inscricao.idImovel);
      if (!ultima.data) continue;
      const data = this.parseDateBR(ultima.data);
      if (!data) continue;

      const dias = Math.round((Date.now() - data.getTime()) / (1000 * 60 * 60 * 24));
      if (dias >= this.diasAtrasoLembrete && (!maisAtrasado || dias > maisAtrasado.dias)) {
        maisAtrasado = { idImovel: inscricao.idImovel, tipo: tipos[0], dias };
      }
    }

    if (!maisAtrasado) return null;
    return MESSAGES.NUDGE_LEITURA_ATRASADA(maisAtrasado.idImovel, maisAtrasado.tipo, maisAtrasado.dias);
  }

  /**
   * Processar fluxo pendente de leitura
   * Retorna true se a mensagem foi processada como parte do fluxo
   */
  async processarPendingLeitura(
    de: string,
    texto: string,
    textoNormalizado: string,
    pending: PendingLeitura,
    inscricoes: InscritoDados[]
  ): Promise<{ processado: boolean; proximoStage?: 'tipo' | 'imovel' }> {
    const tipoMatch = textoNormalizado.match(/^(agua|energia|gas)$/i);
    if (!pending.tipo && tipoMatch) {
      pending.tipo = tipoMatch[1].toLowerCase() as 'agua' | 'energia' | 'gas';
    } else if (!pending.idImovel && inscricoes.length > 1) {
      const imovel = inscricoes.find((i) => i.idImovel.toLowerCase() === textoNormalizado);
      if (imovel) {
        pending.idImovel = imovel.idImovel;
      }
    }

    const unicoImovel = inscricoes.length === 1 ? inscricoes[0] : undefined;
    if (!pending.idImovel && unicoImovel) {
      pending.idImovel = unicoImovel.idImovel;
    }

    // Auto-detectar tipo:
    // 1) Se um imóvel já foi selecionado, considerar apenas as inscrições daquele imóvel
    //    e auto-detectar somente se houver exatamente um tipo possível para ele.
    // 2) Caso contrário (ou se o imóvel tiver mais de um tipo possível), cair no
    //    comportamento atual: tipo comum entre todas as inscrições.
    if (!pending.tipo) {
      if (pending.idImovel) {
        const inscricoesDoImovel = inscricoes.filter(
          (i) => i.idImovel === pending.idImovel
        );
        if (inscricoesDoImovel.length > 0) {
          const monitoramentosImovel = this.obterMonitoramentosComuns(inscricoesDoImovel);
          if (monitoramentosImovel.length === 1) {
            pending.tipo = monitoramentosImovel[0];
          }
        }
      }

      if (!pending.tipo) {
        const monitoramentos = this.obterMonitoramentosComuns(inscricoes);
        if (monitoramentos.length === 1) {
          pending.tipo = monitoramentos[0];
        }
      }
    }

    if (!pending.tipo) {
      await this._send(de, MESSAGES.ERRO_PRECISA_TIPO);
      return { processado: true, proximoStage: 'tipo' };
    }

    if (!pending.idImovel) {
      const lista = await this.formatarCasas(inscricoes);
      await this._send(de, `Qual o ID do imóvel?\n${lista}`);
      return { processado: true, proximoStage: 'imovel' };
    }

    // Tentar registrar a leitura
    const leituraValor = pending.valor || texto;
    const result = await appendPredioEntry({
      predio: pending.idImovel,
      numero: leituraValor,
      tipo: pending.tipo,
    });

    if (result.ok) {
      const leituraAtual = pending.valor || leituraValor;

      const { msg1, msg2, msg3, nivelAlerta, mediaReferenciaDia } = await this.montarMensagensLeitura({
        tipo: pending.tipo,
        idImovel: pending.idImovel,
        data: result.data,
        leituraAtual,
        leituraAnterior: result.anterior,
        dias: result.dias,
        consumo: result.consumo,
        media: result.media,
        consumoDia: result.consumoDia,
        mediaDia: result.mediaDia,
        consumoSemana: result.consumoSemana,
        mediaSemana: result.mediaSemana,
        consumoMes: result.consumoMes,
        mediaMes: result.mediaMes,
      });

      await this._send(de, msg1);
      await this._send(de, msg2);
      await this._send(de, msg3);

      const inscricao = inscricoes.find(i => i.idImovel === pending.idImovel);
      if (inscricao) {
        await atualizarUltimaLeitura(inscricao.uid, new Date().toISOString());
        await this.enviarAnuncioSeHouver(de, inscricao);
        await this.enviarRelatoriosPeriodicos(de, pending.idImovel, pending.tipo, result, inscricao);
      }

      // Frente 2: registrar lead de água quando anomalia forte é detectada
      if (pending.tipo === 'agua' && nivelAlerta === 'forte' && mediaReferenciaDia && mediaReferenciaDia > 0) {
        const consumoAtualNum = Number(String(result.consumoDia || '0').replace(',', '.')) || 0;
        const desvio = ((consumoAtualNum - mediaReferenciaDia) / mediaReferenciaDia) * 100;
        const inscricao2 = inscricoes.find(i => i.idImovel === pending.idImovel);
        await this._send(de, MESSAGES.AGUA_LEAD_MENSAGEM_CLIENTE);
        await this.processarLeadAgua(de, pending.idImovel!, inscricao2?.nome, consumoAtualNum, mediaReferenciaDia, desvio);
      }
    } else {
      await this._send(de, MESSAGES.ERRO_LEITURA_REGISTRO(result.erro));
    }

    return { processado: true };
  }

  /**
   * Parser de leitura - detecta padrões de envio de leitura
   * Retorna valor, tipo e id (se detectado)
   */
  parseArLeitura(textoNormalizado: string): {
    leituraValor?: string;
    leituraTipo?: 'agua' | 'energia' | 'gas';
    leituraId?: string;
  } {
    const partes = textoNormalizado.trim().split(/\s+/);
    let leituraValor: string | undefined;
    let leituraTipo: 'agua' | 'energia' | 'gas' | undefined;
    let leituraId: string | undefined;

    // Padrão 1: 3 partes = id tipo numero
    if (partes.length === 3) {
      const [id, tipo, numero] = partes;
      if (/^\d+[\d.,]*$/.test(numero) && /^(agua|energia|gas)$/i.test(tipo)) {
        leituraId = id;
        leituraTipo = tipo.toLowerCase() as 'agua' | 'energia' | 'gas';
        leituraValor = numero;
      }
    }

    // Padrão 2: 2 partes = tipo numero ou id numero
    if (!leituraValor && partes.length === 2) {
      const [parte1, parte2] = partes;
      if (/^\d+[\d.,]*$/.test(parte2)) {
        if (/^(agua|energia|gas)$/i.test(parte1)) {
          // tipo numero
          leituraTipo = parte1.toLowerCase() as 'agua' | 'energia' | 'gas';
          leituraValor = parte2;
        } else {
          // id numero
          leituraId = parte1;
          leituraValor = parte2;
        }
      }
    }

    // Padrão 3: 1 parte = só número
    if (!leituraValor && partes.length === 1) {
      if (/^\d+[\d.,]*$/.test(partes[0])) {
        leituraValor = partes[0];
      }
    }

    return { leituraValor, leituraTipo, leituraId };
  }

  /**
   * Processar envio de leitura
   * Retorna true se foi processado com sucesso
   */
  async processarLeitura(
    de: string,
    texto: string,
    leituraValor: string,
    leituraTipo: 'agua' | 'energia' | 'gas' | undefined,
    leituraId: string | undefined,
    inscricoes: InscritoDados[]
  ): Promise<{ processado: boolean; erro?: string; pendingLeitura?: PendingLeitura }> {
    if (!inscricoes.length) {
      await this._send(de, MESSAGES.ERRO_CADASTRO_NAO_ENCONTRADO);
      return { processado: true };
    }

    const unicoImovel = inscricoes.length === 1 ? inscricoes[0] : undefined;
    // Obter tipos de monitoramento comuns a todas as inscrições
    const monitoramentos = this.obterMonitoramentosComuns(inscricoes);

    // Validar/completar ID do imóvel
    if (leituraId && inscricoes.length > 1) {
      const imovelEncontrado = inscricoes.find((i) => i.idImovel.toLowerCase() === leituraId.toLowerCase());
      if (!imovelEncontrado) {
        const lista = await this.formatarCasas(inscricoes);
        await this._send(de, `ID de imóvel não encontrado.\n${lista}`);
        return { processado: true };
      }
    } else if (!leituraId && inscricoes.length > 1) {
      return {
        processado: true,
        pendingLeitura: { valor: leituraValor, tipo: leituraTipo },
        erro: 'NEED_ID',
      };
    }

    // Se não tem tipo informado
    if (!leituraTipo) {
      if (monitoramentos.length === 1) {
        leituraTipo = monitoramentos[0] as 'agua' | 'energia' | 'gas';
      } else if (monitoramentos.length > 1) {
        return {
          processado: true,
          pendingLeitura: { valor: leituraValor, idImovel: leituraId },
          erro: 'NEED_TYPE',
        };
      }
    }

    const idImovel = leituraId || unicoImovel?.idImovel;
    if (!idImovel || !leituraTipo) {
      return { processado: false };
    }

    // Registrar a leitura
    const result = await appendPredioEntry({
      predio: idImovel,
      numero: leituraValor,
      tipo: leituraTipo,
    });

    if (result.ok) {
      const { msg1, msg2, msg3, nivelAlerta, mediaReferenciaDia } = await this.montarMensagensLeitura({
        tipo: leituraTipo,
        idImovel,
        data: result.data,
        leituraAtual: leituraValor,
        leituraAnterior: result.anterior,
        dias: result.dias,
        consumo: result.consumo,
        media: result.media,
        consumoDia: result.consumoDia,
        mediaDia: result.mediaDia,
        consumoSemana: result.consumoSemana,
        mediaSemana: result.mediaSemana,
        consumoMes: result.consumoMes,
        mediaMes: result.mediaMes,
      });

      await this._send(de, msg1);
      await this._send(de, msg2);
      await this._send(de, msg3);

      const inscricao = inscricoes.find(i => i.idImovel === idImovel);
      if (inscricao) {
        await atualizarUltimaLeitura(inscricao.uid, new Date().toISOString());
        await this.enviarAnuncioSeHouver(de, inscricao);
        await this.enviarRelatoriosPeriodicos(de, idImovel, leituraTipo, result, inscricao);
      }

      // Frente 2: registrar lead de água quando anomalia forte é detectada
      if (leituraTipo === 'agua' && nivelAlerta === 'forte' && mediaReferenciaDia && mediaReferenciaDia > 0) {
        const consumoAtualNum = Number(String(result.consumoDia || '0').replace(',', '.')) || 0;
        const desvio = ((consumoAtualNum - mediaReferenciaDia) / mediaReferenciaDia) * 100;
        await this._send(de, MESSAGES.AGUA_LEAD_MENSAGEM_CLIENTE);
        await this.processarLeadAgua(de, idImovel, inscricao?.nome, consumoAtualNum, mediaReferenciaDia, desvio);
      }
    } else {
      await this._send(de, MESSAGES.ERRO_LEITURA_REGISTRO(result.erro));
    }

    return { processado: true };
  }
}
