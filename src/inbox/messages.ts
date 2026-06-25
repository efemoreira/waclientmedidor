/**
 * Mensagens do bot organizadas por contexto
 * Facilita manutenção e internacionalização futura
 */

export const MESSAGES = {
  // Mensagens de boas-vindas e menu
  WELCOME_NEW_USER: [
    `👋 Olá! Bem-vindo ao sistema de monitoramento de consumo.

Vejo que você ainda não está cadastrado.`,
    `🔒 Antes de iniciar seu cadastro, precisamos do seu consentimento para tratar seus dados, conforme a LGPD.

Usamos seu nome, telefone, bairro, CEP e as leituras de consumo enviadas apenas para prestar este serviço (cálculo de consumo, alertas e relatórios).`,
    `✅ Digite *SIM* para concordar e começar seu cadastro.`,
  ],

  LGPD_CONSENTIMENTO_REPETIR: `🔒 Para continuar, precisamos do seu consentimento explícito.

Usamos seu nome, telefone, bairro, CEP e leituras de consumo apenas para prestar este serviço.

Digite *SIM* para concordar e iniciar seu cadastro.`,

  WELCOME_REGISTERED_USER: (nome: string) => `👋 Olá, ${nome}!

É um prazer te ver por aqui.`,

  MENU_PRINCIPAL: `📋 Menu de opções

Você pode usar os seguintes comandos:

🔎 Consultas
• *Meu UID* - Ver seus identificadores
• *Minhas casas* - Listar seus imóveis
• *Status* - Ver status de monitoramento

⚡ Ações
• *Enviar leitura* - Registrar consumo (ex: "123" ou "agua 123")
• *Adicionar casa* - Cadastrar um novo imóvel
• *Ajuda* - Ver este menu novamente

🎁 Indicações
• *Como indicar* - Saiba como indicar amigos

Você também pode enviar sua leitura diretamente (ex: "456" ou "energia 456").`,

  // Mensagens de ajuda
  HELP_ENVIAR_LEITURA: `💧 Como enviar leituras

Você pode enviar de várias formas:

1️⃣ Apenas o número
   Exemplo: 123
   (Útil se você só monitora um tipo)

2️⃣ Tipo + número
   Exemplos:
   • agua 123
   • energia 456
   • gas 789

3️⃣ ID do imóvel + tipo + número
   Exemplo: IMV001 agua 123
   (Se você tem vários imóveis)

4️⃣ ID do imóvel + número
   Exemplo: IMV001 123
   (Sistema detecta o tipo automaticamente)`,

  HELP_COMMANDS: `📋 Comandos disponíveis

🔎 Consultas
• meu uid / uid
• minhas casas / casas / imoveis
• status / monitoramento
• ultima leitura

⚡ Ações
• adicionar casa / nova casa
• enviar leitura

🆘 Suporte
• ajuda / help / menu
• como indicar

Você pode digitar os comandos em letras maiúsculas ou minúsculas!`,

  // Mensagens de confirmação
  LEITURA_REGISTRADA: (tipo: string, idImovel: string, valor: string) =>
    `✅ Leitura registrada com sucesso.

🏠 Imóvel: ${idImovel}
${MessageHelpers.emojiTipo(tipo)} Tipo: ${tipo}
📍 Leitura: ${valor} m³`,

  // Mensagem 1/3: confirmação do registro + consumo desde a última leitura + alerta de vazamento
  MSG_DESDE_ULTIMA: (params: {
    tipo: string;
    idImovel: string;
    data?: string;
    leituraAtual: string;
    leituraAnterior?: string;
    dias?: number;
    consumo?: string;
    media?: string;
    semHistorico?: boolean;
    nivelAlerta?: 'atencao' | 'forte';
    padraoFaixa?: string;
  }) => {
    let msg = `✅ Leitura registrada com sucesso

━━━━━━━━━━━
🏠 Imóvel: ${params.idImovel}
${MessageHelpers.emojiTipo(params.tipo)} Tipo: ${params.tipo}
━━━━━━━━━━━

📍 Data: ${params.data || new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}
📍 Leitura atual: ${params.leituraAtual} m³`;

    if (params.semHistorico) {
      msg += `

━━━━━━━━━━━
📊 Dados anteriores não existentes
━━━━━━━━━━━

Envie sua próxima leitura em cerca de 30 dias para já ver sua média diária, previsão de conta e alertas.`;

      return msg;
    }

    if (params.leituraAnterior) {
      msg += `\n📍 Última leitura: ${params.leituraAnterior} m³`;
      if (params.dias) {
        msg += `\n📅 Último envio: ${params.dias} dia${params.dias !== 1 ? 's' : ''} atrás`;
      }
    }

    if (params.consumo) {
      msg += `\n💧 Consumo: ${params.consumo} m³`;
    }

    if (params.media) {
      msg += `\n📈 Média diária: ${params.media} m³/dia`;
    }

    if (params.nivelAlerta === 'forte') {
      msg += `

━━━━━━━━━━━
🚨 ALERTA DE CONSUMO
━━━━━━━━━━━

Seu consumo diário está bem acima do seu normal${params.padraoFaixa ? ` (${params.padraoFaixa})` : ''}.
Possível vazamento — verifique torneiras, registros e descargas.`;
    } else if (params.nivelAlerta === 'atencao') {
      msg += `

━━━━━━━━━━━
⚠️ ATENÇÃO AO CONSUMO
━━━━━━━━━━━

Seu consumo diário ficou um pouco acima do normal${params.padraoFaixa ? ` (${params.padraoFaixa})` : ''}. Vale a pena dar uma olhada.`;
    }

    return msg;
  },

  // Mensagem 2/3: consumo do dia, gráfico semanal e comparação
  MSG_GASTO_DIA: (params: {
    tipo: string;
    consumoDia?: string;
    mediaDia?: string;
    graficoSemanal?: string;
    comparacaoTexto?: string;
  }) => {
    let msg = `━━━━━━━━━━━
📊 GASTO POR DIA
━━━━━━━━━━━`;

    if (params.consumoDia) {
      msg += `\n💧 Consumo do dia: ${params.consumoDia} m³`;
    }
    if (params.mediaDia) {
      msg += `\n📈 Média diária: ${params.mediaDia} m³/dia`;
    }

    if (params.graficoSemanal) {
      msg += `

━━━━━━━━━━━
📈 CONSUMO SEMANAL
━━━━━━━━━━━

${params.graficoSemanal}`;
    }

    if (params.comparacaoTexto) {
      msg += `

━━━━━━━━━━━
📊 COMPARAÇÃO
━━━━━━━━━━━

${params.comparacaoTexto}`;
    }

    return msg;
  },

  // Mensagem 3/3: resumo semanal/mensal, previsão de conta e meta
  MSG_GASTO_SEMANA_MES: (params: {
    tipo: string;
    consumoSemana?: string;
    mediaSemana?: string;
    consumoMes?: string;
    mediaMes?: string;
    previsaoConta?: string;
    metaPercentual?: string;
    metaBarra?: string;
  }) => {
    let msg = `━━━━━━━━━━━
📊 RESUMO SEMANAL
━━━━━━━━━━━`;

    if (params.consumoSemana) {
      msg += `\n💧 Consumo semanal: ${params.consumoSemana} m³`;
    }
    if (params.mediaSemana) {
      msg += `\n📈 Média diária: ${params.mediaSemana} m³/dia`;
    }

    msg += `

━━━━━━━━━━━
📅 RESUMO MENSAL
━━━━━━━━━━━`;

    if (params.consumoMes) {
      msg += `\n💧 Consumo mensal: ${params.consumoMes} m³`;
    }
    if (params.mediaMes) {
      msg += `\n📈 Média diária: ${params.mediaMes} m³/dia`;
    }

    if (params.metaBarra && params.metaPercentual) {
      msg += `

━━━━━━━━━━━
🎯 META DO MÊS
━━━━━━━━━━━

${params.metaBarra}
${params.metaPercentual}%`;
    }

    if (params.previsaoConta) {
      msg += `

━━━━━━━━━━━
💰 PREVISÃO DA CONTA
━━━━━━━━━━━

Estimativa:
${params.previsaoConta}`;
    }

    msg += `

💡 Dica: programe um lembrete no seu celular para enviar a próxima leitura e manter sua média sempre atualizada.`;

    return msg;
  },

  // Mensagens de inscrição
  INSCRICAO_NOME: `📝 Vamos começar seu cadastro.

Por favor, me envie seu nome completo.`,

  INSCRICAO_BAIRRO: `📍 Perfeito.

Agora me diga qual é o seu bairro.`,

  INSCRICAO_CEP: `📮 Ótimo.

Qual é o CEP do seu imóvel?`,

  INSCRICAO_TIPO_IMOVEL: `🏠 Entendi.

Qual é o tipo de imóvel?
(Exemplos: casa, apartamento, comercial, etc.)`,

  INSCRICAO_PESSOAS: `👥 Legal.

Quantas pessoas moram no imóvel?`,

  INSCRICAO_UID_INDICADOR: `🎁 Quase lá.

Você tem um UID de indicador?
Se sim, informe agora.
Se não, pode responder "não" ou "nao".`,

  INSCRICAO_SUCESSO: (nome: string, uid: string, idImovel: string) => [
    `✅ Inscrição realizada com sucesso!

🎉 Bem-vindo(a), ${nome}!`,
    `📋 Seus dados:
UID: ${uid}
ID do imóvel: ${idImovel}`,
    `🚀 Agora você pode começar a enviar suas leituras.

Digite *ajuda* para ver todas as opções disponíveis.`,
  ],

  INSCRICAO_ERRO: (erro?: string) =>
    `❌ Ocorreu um erro durante a inscrição.
${erro ? `\nDetalhes: ${erro}` : ''}

Por favor, tente responder a última pergunta novamente.`,

  // Mensagens de erro e validação
  ERRO_IMOVEL_NAO_ENCONTRADO: (inscricoes: string[]) =>
    `❌ ID do imóvel não encontrado.

Escolha um dos seus imóveis:
${inscricoes.join('\n')}`,

  ERRO_PRECISA_ID: `🏠 Você tem mais de um imóvel cadastrado.

Informe o ID do imóvel junto com a leitura.

Exemplo: IMV001 123`,

  ERRO_PRECISA_TIPO: `❓ Especifique o tipo de monitoramento.

Opções disponíveis:
• 💧 água
• ⚡ energia
• 🔥 gás

Exemplo: agua 123`,

  ERRO_CADASTRO_NAO_ENCONTRADO: `❌ Não encontrei seu cadastro no sistema.

Entre em contato com o suporte para mais informações.`,

  ERRO_LEITURA_REGISTRO: (erro?: string) =>
    `❌ Não foi possível registrar a leitura.${erro ? `\n\nDetalhes: ${erro}` : ''}

Por favor, tente novamente ou entre em contato com o suporte.`,

  // Informações de UID e imóveis
  INFO_MEUS_UIDS: (uids: Array<{ uid: string; idImovel: string }>) => {
    const linhas = uids.map((i) => `UID: ${i.uid}\nImóvel: ${i.idImovel}`);
    return `📋 Seus dados cadastrais\n\n${linhas.join('\n\n')}`;
  },

  INFO_MINHAS_CASAS: (casas: string) =>
    `🏠 Seus imóveis cadastrados\n\n${casas}`,

  INFO_STATUS_DETALHADO: (imoveis: Array<{
    idImovel: string;
    bairro?: string;
    tipos: Array<{
      tipo: string;
      diasUltimaLeitura?: number;
      consumoMes?: string;
      previsaoConta?: string;
    }>;
  }>) => {
    const blocos = imoveis.map((im) => {
      const linhasTipos = im.tipos.map((t) => {
        let linha = `${MessageHelpers.emojiTipo(t.tipo)} ${t.tipo}`;
        linha += t.diasUltimaLeitura !== undefined
          ? `\n   Última leitura: há ${t.diasUltimaLeitura} dia${t.diasUltimaLeitura !== 1 ? 's' : ''}`
          : '\n   Ainda sem leitura registrada';
        if (t.consumoMes) linha += `\n   Consumo no mês: ${t.consumoMes} m³`;
        if (t.previsaoConta) linha += `\n   Previsão da conta: ${t.previsaoConta}`;
        return linha;
      });

      return `🏠 ${im.idImovel}${im.bairro ? ` - ${im.bairro}` : ''}\n${linhasTipos.join('\n\n') || 'Nenhum monitoramento ativo'}`;
    });

    return `📊 Status de monitoramento\n\n${blocos.join('\n\n━━━━━━━━━━━\n\n')}`;
  },

  // Indicações
  INFO_COMO_INDICAR: (uids: string[]) => {
    const uidList = uids.map((uid) => `• ${uid}`).join('\n');
    return `🎁 Como indicar amigos

Compartilhe seu UID com amigos que queiram se cadastrar!

Seus UIDs:
${uidList}

Quando seu amigo se cadastrar, peça para ele informar seu UID no campo de indicador.

Você ganha benefícios a cada indicação!`;
  },

  // Relatórios periódicos
  RELATORIO_SEMANAL: (params: {
    idImovel: string;
    tipo: string;
    consumoSemana?: string;
    mediaSemana?: string;
  }) =>
    `📅 Relatório semanal

🏠 Imóvel: ${params.idImovel}
${MessageHelpers.emojiTipo(params.tipo)} Tipo: ${params.tipo}
💧 Consumo na semana: ${params.consumoSemana || 'Sem dados'} m³
📈 Média diária: ${params.mediaSemana || 'Sem dados'} m³/dia`,

  RELATORIO_MENSAL: (params: {
    idImovel: string;
    tipo: string;
    consumoMes?: string;
    mediaMes?: string;
  }) =>
    `📅 Relatório mensal

🏠 Imóvel: ${params.idImovel}
${MessageHelpers.emojiTipo(params.tipo)} Tipo: ${params.tipo}
💧 Consumo no mês: ${params.consumoMes || 'Sem dados'} m³
📈 Média diária: ${params.mediaMes || 'Sem dados'} m³/dia`,

  // Comandos não reconhecidos
  COMANDO_NAO_RECONHECIDO: `❓ Não reconheci esse comando.

Envie *ajuda* ou *menu*.

Ou envie diretamente a leitura, por exemplo: "123" ou "agua 123".`,

  // Mensagens de contexto
  AGUARDANDO_TIPO: `❓ Agora me diga o tipo de monitoramento:

• 💧 água
• ⚡ energia
• 🔥 gás`,

  AGUARDANDO_ID_IMOVEL: (casas: string) =>
    `🏠 Agora preciso saber qual imóvel.

Informe o ID do imóvel:
${casas}`,

  NUDGE_LEITURA_ATRASADA: (idImovel: string, tipo: string, dias: number) =>
    `📍 Sua última leitura de ${MessageHelpers.emojiTipo(tipo)} ${tipo} (${idImovel}) foi há ${dias} dias. Envie a leitura atual quando puder.`,

  LEMBRETE_RETORNO: (nome: string) =>
    `👋 Olá${nome ? `, ${nome}` : ''}! Passando para saber se você precisa de alguma ajuda com o monitoramento do seu consumo. Qualquer dúvida, é só responder aqui.`,

  // Cobrança de itens extras (imóvel/tipo adicional) e crédito de indicação
  CREDITO_APLICADO: (valor: number) =>
    `🎁 Crédito de indicação aplicado: R$ ${valor.toFixed(2).replace('.', ',')}`,

  COBRANCA_PENDENTE: (valor: number) =>
    `💳 Cadastro de item extra

Cada imóvel ou tipo de monitoramento adicional ao primeiro tem um custo de R$ ${valor.toFixed(2).replace('.', ',')}.

Seu cadastro ficará pendente até a confirmação do pagamento. Assim que for confirmado, envie qualquer mensagem para concluirmos seu cadastro.`,

  COBRANCA_AINDA_PENDENTE: `⏳ Seu pagamento ainda não foi confirmado.

Assim que for confirmado, envie qualquer mensagem para concluirmos seu cadastro.`,
};

/**
 * Helpers para formatação de mensagens
 */
export const MessageHelpers = {
  /**
   * Formatar lista de imóveis com emojis
   */
  formatarListaImoveis: (imoveis: Array<{ id: string; bairro?: string; ultimaLeitura?: string }>) => {
    return imoveis.map((i) => 
      `🏠 *${i.id}*${i.bairro ? ` - ${i.bairro}` : ''}${i.ultimaLeitura ? `\n   📊 Última leitura: ${i.ultimaLeitura}` : ''}`
    ).join('\n\n');
  },

  /**
   * Adicionar emojis de tipo de monitoramento
   */
  emojiTipo: (tipo: string) => {
    const emojis: Record<string, string> = {
      agua: '💧',
      energia: '⚡',
      gas: '🔥',
    };
    return emojis[tipo.toLowerCase()] || '📊';
  },
};
