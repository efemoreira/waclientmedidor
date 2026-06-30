/**
 * Máquina de estados para fluxos admin guiados via WhatsApp.
 *
 * Cada "stage" representa uma pergunta ativa. O ConversationManager chama
 * processarAdminFlow() quando o usuário admin tem um adminStage ativo.
 * O handler responde, avança o stage e retorna o estado atualizado.
 *
 * Para cancelar em qualquer etapa: enviar "cancelar".
 */

import { adicionarInscrito, listarInscricoesPorCelular } from './inscritosSheet';
import { adicionarExtintor, listarExtintoresPorCliente, atualizarCampoExtintor, removerExtintor } from './extintoresSheet';
import { logger } from './logger';

const ADMIN_VENDAS_PHONE = (process.env.ADMIN_VENDAS_PHONE || '558586999181').replace(/\D/g, '');

export interface AdminFlowResult {
  handled: boolean;
  updatedStage: string; // '' = limpar (fluxo concluído ou cancelado)
  updatedData: Record<string, any>;
}

const TIPOS_VALIDOS = new Set(['ABC', 'CO2', 'CO₂', 'AP', 'BC']);
const CANCELAR = new Set(['cancelar', 'cancel', 'sair', 'exit']);

function normalizarTipo(t: string): string {
  const u = t.toUpperCase().replace(/\s/g, '');
  if (u === 'CO2') return 'CO₂';
  return u;
}

export async function processarAdminFlow(
  stage: string,
  texto: string,
  textoNorm: string,
  flowData: Record<string, any>,
  adminPhone: string,
  sendMsg: (to: string, text: string) => Promise<any>
): Promise<AdminFlowResult> {
  const next = (nextStage: string, data: Record<string, any>): AdminFlowResult =>
    ({ handled: true, updatedStage: nextStage, updatedData: data });

  const done = (data: Record<string, any> = {}): AdminFlowResult =>
    ({ handled: true, updatedStage: '', updatedData: data });

  const cancelar = async (): Promise<AdminFlowResult> => {
    await sendMsg(adminPhone, '❌ Operação cancelada.');
    return done();
  };

  if (CANCELAR.has(textoNorm)) return cancelar();

  // ─── CADASTRAR CLIENTE ─────────────────────────────────────────────────────

  if (stage === 'cadastrar_cliente_nome') {
    const nome = texto.trim();
    if (nome.length < 2) {
      await sendMsg(adminPhone, '⚠️ Nome muito curto. Digite o nome completo ou *cancelar*.');
      return next(stage, flowData);
    }
    // Se telefone já está pré-preenchido (vindo de /lead fechar), pular etapa
    if (flowData.telefone) {
      await sendMsg(adminPhone, `📍 Bairro de *${nome}*? (ou *pular*)`);
      return next('cadastrar_cliente_bairro', { ...flowData, nome });
    }
    await sendMsg(adminPhone, `📱 Telefone do cliente (com DDD, só números)?`);
    return next('cadastrar_cliente_tel', { ...flowData, nome });
  }

  if (stage === 'cadastrar_cliente_tel') {
    const tel = texto.replace(/\D/g, '');
    if (tel.length < 10) {
      await sendMsg(adminPhone, '⚠️ Telefone inválido. Digite com DDD (ex: 85999999999) ou *cancelar*.');
      return next(stage, flowData);
    }
    await sendMsg(adminPhone, `📍 Bairro? (ou *pular*)`);
    return next('cadastrar_cliente_bairro', { ...flowData, telefone: tel });
  }

  if (stage === 'cadastrar_cliente_bairro') {
    const bairro = textoNorm === 'pular' ? '' : texto.trim();
    const { nome, telefone } = flowData;
    await sendMsg(adminPhone,
      `📋 *Confirmar cadastro?*\n\n` +
      `👤 ${nome}\n📱 https://wa.me/${telefone}\n📍 ${bairro || 'bairro não informado'}\n\n` +
      `*SIM* para cadastrar ou *cancelar*.`
    );
    return next('cadastrar_cliente_confirmar', { ...flowData, bairro });
  }

  if (stage === 'cadastrar_cliente_confirmar') {
    if (!/^sim$/i.test(textoNorm)) return cancelar();

    const { nome, telefone, bairro } = flowData;
    const lgpdData = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const res = await adicionarInscrito({ nome, celular: telefone, bairro: bairro || '', lgpdAceiteData: lgpdData });

    if (!res.ok) {
      await sendMsg(adminPhone, `❌ Erro ao cadastrar: ${res.erro}`);
      return done();
    }

    await sendMsg(adminPhone,
      `✅ *Cliente cadastrado!*\n👤 ${nome}\n📱 https://wa.me/${telefone}\n📍 ${bairro || ''}\n🆔 ${res.uid}\n🏠 ${res.idImovel}`
    );

    // Notifica o outro admin
    if (adminPhone.replace(/\D/g, '') !== ADMIN_VENDAS_PHONE) {
      sendMsg(ADMIN_VENDAS_PHONE, `🆕 *Novo cliente*\n👤 ${nome}\n📱 https://wa.me/${telefone}`).catch(() => {});
    }

    // Boas-vindas ao cliente
    sendMsg(telefone,
      `Olá, ${nome}! 👋 Seu cadastro no Guardião foi criado. Em breve entraremos em contato. Qualquer dúvida é só chamar aqui!`
    ).catch(() => {});

    await sendMsg(adminPhone, `Quer cadastrar os extintores de *${nome}* agora? (*SIM* ou *não*)`);
    return next('cadastrar_cliente_extintor_opcao', { ...flowData, uid: res.uid, idImovel: res.idImovel });
  }

  if (stage === 'cadastrar_cliente_extintor_opcao') {
    if (/^sim$/i.test(textoNorm)) {
      await sendMsg(adminPhone, `🧯 Tipo do extintor? (ABC / CO2 / AP / BC)`);
      return next('cadastrar_extintor_tipo', { telefone: flowData.telefone, nomeCliente: flowData.nome });
    }
    await sendMsg(adminPhone, `✅ Pronto! Use */extintor ${flowData.telefone}* para cadastrar extintores depois.`);
    return done();
  }

  // ─── CADASTRAR EXTINTOR ────────────────────────────────────────────────────

  if (stage === 'cadastrar_extintor_tipo') {
    const tipo = normalizarTipo(texto);
    if (!TIPOS_VALIDOS.has(tipo)) {
      await sendMsg(adminPhone, `⚠️ Tipo inválido. Use: ABC, CO2, AP ou BC.\nOu *cancelar*.`);
      return next(stage, flowData);
    }
    await sendMsg(adminPhone, `📦 Capacidade? (ex: 4kg, 6kg, 10L)`);
    return next('cadastrar_extintor_capacidade', { ...flowData, tipo });
  }

  if (stage === 'cadastrar_extintor_capacidade') {
    const capacidade = texto.trim();
    if (!capacidade) {
      await sendMsg(adminPhone, `⚠️ Informe a capacidade (ex: 6kg) ou *cancelar*.`);
      return next(stage, flowData);
    }
    await sendMsg(adminPhone, `🏠 Imóvel? (ex: Igreja Central)`);
    return next('cadastrar_extintor_imovel', { ...flowData, capacidade });
  }

  if (stage === 'cadastrar_extintor_imovel') {
    const imovel = texto.trim();
    if (!imovel) {
      await sendMsg(adminPhone, `⚠️ Informe o imóvel ou *cancelar*.`);
      return next(stage, flowData);
    }
    await sendMsg(adminPhone, `📍 Setor/local dentro do imóvel? (ou *pular*)`);
    return next('cadastrar_extintor_setor', { ...flowData, imovel });
  }

  if (stage === 'cadastrar_extintor_setor') {
    const setor = textoNorm === 'pular' ? '' : texto.trim();
    await sendMsg(adminPhone, `📅 Vencimento? (dd/mm/aaaa ou *pular*)`);
    return next('cadastrar_extintor_vencimento', { ...flowData, setor });
  }

  if (stage === 'cadastrar_extintor_vencimento') {
    const vencimento = textoNorm === 'pular' ? '' : texto.trim();
    const { tipo, capacidade, imovel, setor, nomeCliente, telefone } = flowData;
    await sendMsg(adminPhone,
      `📋 *Confirmar extintor?*\n\n` +
      `👤 ${nomeCliente || telefone}\n` +
      `🧯 ${tipo} ${capacidade} — ${imovel}${setor ? ` (${setor})` : ''}\n` +
      `📅 Vence: ${vencimento || 'não informado'}\n\n` +
      `*SIM* para salvar ou *cancelar*.`
    );
    return next('cadastrar_extintor_confirmar', { ...flowData, vencimento });
  }

  if (stage === 'cadastrar_extintor_confirmar') {
    if (!/^sim$/i.test(textoNorm)) return cancelar();

    const { tipo, capacidade, imovel, setor, vencimento, nomeCliente, telefone } = flowData;

    let nome = nomeCliente;
    if (!nome) {
      const inscricoes = await listarInscricoesPorCelular(telefone);
      nome = inscricoes[0]?.nome || '';
    }

    const res = await adicionarExtintor({
      idCliente: telefone,
      nomeCliente: nome,
      imovel,
      localSetor: setor || '',
      tipo,
      capacidade,
      dataVencimento: vencimento || '',
    });

    if (!res.ok) {
      await sendMsg(adminPhone, `❌ Erro ao salvar extintor: ${res.erro}`);
      return done();
    }

    await sendMsg(adminPhone,
      `✅ *Extintor cadastrado!*\n🧯 ${tipo} ${capacidade} — ${imovel}${setor ? ` (${setor})` : ''}\n📅 Vence: ${vencimento || 'não informado'}`
    );

    // Notifica o cliente
    if (telefone) {
      const msgVenc = vencimento ? ` Você receberá lembrete antes do vencimento em *${vencimento}*.` : '';
      sendMsg(telefone,
        `✅ ${nome || 'Olá'}, cadastramos o extintor *${tipo} ${capacidade}* do *${imovel}${setor ? ` (${setor})` : ''}* no sistema Guardião.${msgVenc}`
      ).catch(() => {});
    }

    await sendMsg(adminPhone, `Adicionar outro extintor para *${nome || telefone}*? (*SIM* ou *não*)`);
    return next('cadastrar_extintor_mais', { telefone, nomeCliente: nome });
  }

  if (stage === 'cadastrar_extintor_mais') {
    if (/^sim$/i.test(textoNorm)) {
      await sendMsg(adminPhone, `🧯 Tipo do próximo extintor? (ABC / CO2 / AP / BC)`);
      return next('cadastrar_extintor_tipo', { telefone: flowData.telefone, nomeCliente: flowData.nomeCliente });
    }
    await sendMsg(adminPhone, `✅ Pronto! Todos os extintores foram cadastrados.`);
    return done();
  }

  // ─── EDITAR EXTINTOR ───────────────────────────────────────────────────────

  if (stage === 'extintor_editar_escolha') {
    const idx = parseInt(textoNorm, 10) - 1;
    const extintores: any[] = flowData.extintores || [];
    if (isNaN(idx) || idx < 0 || idx >= extintores.length) {
      await sendMsg(adminPhone, `⚠️ Número inválido. Digite 1–${extintores.length} ou *cancelar*.`);
      return next(stage, flowData);
    }
    const ext = extintores[idx];
    await sendMsg(adminPhone,
      `✏️ *${ext.tipo} ${ext.capacidade} — ${ext.imovel}*\n\nO que editar?\n` +
      `1. Vencimento  (${ext.dataVencimento || 'N/A'})\n` +
      `2. Tipo        (${ext.tipo})\n` +
      `3. Capacidade  (${ext.capacidade})\n` +
      `4. Setor/local (${ext.localSetor || 'N/A'})\n` +
      `5. Imóvel      (${ext.imovel})\n\n` +
      `Digite o número do campo.`
    );
    return next('extintor_editar_campo', { ...flowData, extSelecionado: ext });
  }

  if (stage === 'extintor_editar_campo') {
    const CAMPOS: Array<'dataVencimento' | 'tipo' | 'capacidade' | 'localSetor' | 'imovel'> =
      ['dataVencimento', 'tipo', 'capacidade', 'localSetor', 'imovel'];
    const idx = parseInt(textoNorm, 10) - 1;
    if (isNaN(idx) || idx < 0 || idx >= CAMPOS.length) {
      await sendMsg(adminPhone, `⚠️ Número inválido. Digite 1–${CAMPOS.length} ou *cancelar*.`);
      return next(stage, flowData);
    }
    const campo = CAMPOS[idx];
    const LABELS: Record<string, string> = {
      dataVencimento: 'novo vencimento (dd/mm/aaaa)',
      tipo: 'novo tipo (ABC/CO2/AP/BC)',
      capacidade: 'nova capacidade (ex: 6kg)',
      localSetor: 'novo setor/local (ou "limpar" para apagar)',
      imovel: 'novo nome do imóvel',
    };
    await sendMsg(adminPhone, `Digite o ${LABELS[campo]}:`);
    return next('extintor_editar_valor', { ...flowData, campoSelecionado: campo });
  }

  if (stage === 'extintor_editar_valor') {
    const { extSelecionado, campoSelecionado } = flowData;
    const valor = textoNorm === 'limpar' ? '' : texto.trim();

    const res = await atualizarCampoExtintor(extSelecionado.rowIndex, campoSelecionado, valor);
    if (!res.ok) {
      await sendMsg(adminPhone, `❌ Erro ao atualizar: ${res.erro}`);
    } else {
      await sendMsg(adminPhone, `✅ *${campoSelecionado}* atualizado para *${valor || '(vazio)'}*.`);
    }
    return done();
  }

  // ─── REMOVER EXTINTOR ─────────────────────────────────────────────────────

  if (stage === 'extintor_remover_escolha') {
    const idx = parseInt(textoNorm, 10) - 1;
    const extintores: any[] = flowData.extintores || [];
    if (isNaN(idx) || idx < 0 || idx >= extintores.length) {
      await sendMsg(adminPhone, `⚠️ Número inválido. Digite 1–${extintores.length} ou *cancelar*.`);
      return next(stage, flowData);
    }
    const ext = extintores[idx];
    await sendMsg(adminPhone,
      `🗑️ Confirmar remoção?\n\n` +
      `🧯 *${ext.tipo} ${ext.capacidade} — ${ext.imovel}${ext.localSetor ? ` (${ext.localSetor})` : ''}*\n` +
      `📅 Vence: ${ext.dataVencimento || 'sem data'}\n\n` +
      `*SIM* para remover ou *cancelar*.`
    );
    return next('extintor_remover_confirmar', { ...flowData, extSelecionado: ext });
  }

  if (stage === 'extintor_remover_confirmar') {
    if (!/^sim$/i.test(textoNorm)) return cancelar();

    const { extSelecionado } = flowData;
    const res = await removerExtintor(extSelecionado.rowIndex);
    if (!res.ok) {
      await sendMsg(adminPhone, `❌ Erro ao remover extintor: ${res.erro}`);
    } else {
      await sendMsg(adminPhone,
        `✅ Extintor *${extSelecionado.tipo} ${extSelecionado.capacidade} — ${extSelecionado.imovel}* removido.\n` +
        `_(Histórico mantido na planilha)_`
      );
    }
    return done();
  }

  // Stage desconhecida — limpar
  logger.warn('AdminFlowHandler', `Stage não reconhecida: ${stage}`);
  await sendMsg(adminPhone, `⚠️ Fluxo desconhecido. Operação cancelada.`);
  return done();
}
