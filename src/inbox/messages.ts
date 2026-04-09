/**
 * Mensagens do bot organizadas por contexto
 * Facilita manutenção e internacionalização futura
 */

export const MESSAGES = {
  // Mensagens de boas-vindas e menu
  WELCOME_NEW_USER: `👋 Olá! Bem-vindo ao sistema de monitoramento de consumo!

Vejo que você ainda não está cadastrado. Vamos fazer sua inscrição rapidinho! 

Para começar, por favor me envie seu nome completo.`,

  WELCOME_REGISTERED_USER: (nome: string) => `👋 Olá, ${nome}! 

É um prazer te ver por aqui! 🎉`,

  MENU_PRINCIPAL: `📋 *Menu de Opções*

Você pode usar os seguintes comandos:

🔍 *Consultas*
• *Meu UID* - Ver seus identificadores
• *Minhas casas* - Listar seus imóveis
• *Status* - Ver status de monitoramento

💡 *Ações*
• *Enviar leitura* - Registrar consumo (ex: "123" ou "agua 123")
• *Adicionar casa* - Cadastrar um novo imóvel
• *Ajuda* - Ver este menu novamente

🤝 *Indicações*
• *Como indicar* - Saiba como indicar amigos

💬 Você também pode simplesmente enviar sua leitura diretamente (ex: "456" ou "energia 456").`,

  // Mensagens de ajuda
  HELP_ENVIAR_LEITURA: `📊 *Como enviar leituras*

Você pode enviar de várias formas:

1️⃣ *Apenas o número*
   Exemplo: 123
   (Útil se você só monitora um tipo)

2️⃣ *Tipo + número*
   Exemplos: 
   • agua 123
   • energia 456
   • gas 789

3️⃣ *ID do imóvel + tipo + número*
   Exemplo: IMV001 agua 123
   (Se você tem vários imóveis)

4️⃣ *ID do imóvel + número*
   Exemplo: IMV001 123
   (Sistema detecta o tipo automaticamente)`,

  HELP_COMMANDS: `🤖 *Comandos Disponíveis*

📱 *Consultas*
• meu uid / uid
• minhas casas / casas / imoveis
• status / monitoramento
• ultima leitura

⚙️ *Ações*
• adicionar casa / nova casa
• enviar leitura

❓ *Suporte*
• ajuda / help / menu
• como indicar

💬 Dica: Você pode digitar os comandos em letras maiúsculas ou minúsculas!`,

  // Mensagens de confirmação
  LEITURA_REGISTRADA: (tipo: string, idImovel: string, valor: string) => 
    `✅ *Leitura registrada com sucesso!*

📍 Imóvel: ${idImovel}
💧 Tipo: ${tipo}
📊 Leitura: ${valor} m³`,

  LEITURA_COM_HISTORICO: (params: {
    tipo: string;
    idImovel: string;
    data?: string;
    leituraAtual: string;
    leituraAnterior?: string;
    dias?: number;
    consumo?: string;
    media?: string;
    consumoSemana?: string;
    mediaSemana?: string;
    consumoMes?: string;
    mediaMes?: string;
  }) => {
    let msg = `✅ *Leitura registrada!*

📅 Data: ${params.data || new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}
📍 Imóvel: ${params.idImovel}
💧 Tipo: ${params.tipo}
📊 Leitura atual: ${params.leituraAtual} m³`;

    if (params.leituraAnterior) {
      msg += `\n📈 Leitura anterior: ${params.leituraAnterior} m³`;
      if (params.dias) {
        msg += ` (${params.dias} dia${params.dias !== 1 ? 's' : ''} atrás)`;
      }
    }

    if (params.consumo) {
      msg += `\n💧 Consumo: ${params.consumo} m³`;
    }

    if (params.media) {
      msg += `\n📊 Média/Dia: ${params.media} m³/dia`;
    }

    if (params.consumoSemana) {
      msg += `\n📅 Consumo semana: ${params.consumoSemana} m³`;
    }

    if (params.mediaSemana) {
      msg += `\n📊 Média semana: ${params.mediaSemana} m³/dia`;
    }

    if (params.consumoMes) {
      msg += `\n🗓️ Consumo mês: ${params.consumoMes} m³`;
    }

    if (params.mediaMes) {
      msg += `\n📊 Média mês: ${params.mediaMes} m³/dia`;
    }

    return msg;
  },

  // Mensagens de inscrição
  INSCRICAO_NOME: `🎯 Ótimo! Vamos começar seu cadastro.

Por favor, me envie seu *nome completo*.`,

  INSCRICAO_BAIRRO: `👍 Perfeito! 

Agora me diga qual é o seu *bairro*.`,

  INSCRICAO_CEP: `📮 Ótimo!

Qual é o *CEP* do seu imóvel?`,

  INSCRICAO_TIPO_IMOVEL: `🏠 Entendi!

Qual é o *tipo de imóvel*?
(Exemplos: casa, apartamento, comercial, etc.)`,

  INSCRICAO_PESSOAS: `👥 Legal!

Quantas *pessoas moram* no imóvel?`,

  INSCRICAO_UID_INDICADOR: `🤝 Quase lá!

Você tem um *UID de indicador*? 
Se sim, informe agora. 
Se não, pode responder "não" ou "nao".`,

  INSCRICAO_SUCESSO: (nome: string, uid: string, idImovel: string) => 
    `🎉 *Parabéns! Inscrição realizada com sucesso!*

Bem-vindo(a), ${nome}! 

📋 *Seus dados:*
🆔 UID: ${uid}
🏠 ID do Imóvel: ${idImovel}

Agora você pode começar a enviar suas leituras de consumo! 

Digite *ajuda* para ver todas as opções disponíveis.`,

  INSCRICAO_ERRO: (erro?: string) => 
    `❌ Ops! Ocorreu um erro durante a inscrição.
${erro ? `\nDetalhes: ${erro}` : ''}

Por favor, tente responder a última pergunta novamente.`,

  // Mensagens de erro e validação
  ERRO_IMOVEL_NAO_ENCONTRADO: (inscricoes: string[]) => 
    `⚠️ ID do imóvel não encontrado.

Por favor, escolha um dos seus imóveis:
${inscricoes.join('\n')}`,

  ERRO_PRECISA_ID: `⚠️ Você tem mais de um imóvel cadastrado.

Por favor, informe o *ID do imóvel* junto com a leitura.

Exemplo: IMV001 123`,

  ERRO_PRECISA_TIPO: `⚠️ Por favor, especifique o *tipo de monitoramento*.

Opções disponíveis:
• água
• energia  
• gás

Exemplo: agua 123`,

  ERRO_CADASTRO_NAO_ENCONTRADO: `❌ Não encontrei seu cadastro no sistema.

Entre em contato com o suporte para mais informações.`,

  ERRO_LEITURA_REGISTRO: (erro?: string) => 
    `❌ Não foi possível registrar a leitura.${erro ? `\n\nDetalhes: ${erro}` : ''}

Por favor, tente novamente ou entre em contato com o suporte.`,

  // Informações de UID e imóveis
  INFO_MEUS_UIDS: (uids: Array<{ uid: string; idImovel: string }>) => {
    const linhas = uids.map((i) => `• *UID:* ${i.uid}\n  *Imóvel:* ${i.idImovel}`);
    return `🔎 *Seus dados cadastrais*\n\n${linhas.join('\n\n')}`;
  },

  INFO_MINHAS_CASAS: (casas: string) => 
    `🏠 *Seus imóveis cadastrados*\n\n${casas}`,

  INFO_STATUS_MONITORAMENTO: (inscricoes: Array<{
    idImovel: string;
    bairro?: string;
    monitorandoAgua?: boolean;
    monitorandoEnergia?: boolean;
    monitorandoGas?: boolean;
  }>) => {
    const linhas = inscricoes.map((i) => {
      const tipos: string[] = [];
      if (i.monitorandoAgua) tipos.push('💧 Água');
      if (i.monitorandoEnergia) tipos.push('⚡ Energia');
      if (i.monitorandoGas) tipos.push('🔥 Gás');
      
      return `🏠 *${i.idImovel}* ${i.bairro ? `- ${i.bairro}` : ''}
${tipos.length > 0 ? tipos.join('\n') : '⚠️ Nenhum monitoramento ativo'}`;
    });

    return `📊 *Status de Monitoramento*\n\n${linhas.join('\n\n')}`;
  },

  // Indicações
  INFO_COMO_INDICAR: (uids: string[]) => {
    const uidList = uids.map((uid) => `• ${uid}`).join('\n');
    return `🤝 *Como Indicar Amigos*

Compartilhe seu UID com amigos que queiram se cadastrar!

*Seus UIDs:*
${uidList}

Quando seu amigo se cadastrar, peça para ele informar seu UID no campo de indicador.

✨ Você ganha benefícios a cada indicação!`;
  },

  // Relatórios periódicos
  RELATORIO_SEMANAL: (params: {
    idImovel: string;
    tipo: string;
    consumoSemana?: string;
    mediaSemana?: string;
  }) =>
    `📊 *Relatório Semanal*

🏠 Imóvel: ${params.idImovel}
💧 Tipo: ${params.tipo}
📈 Consumo na semana: ${params.consumoSemana || 'Sem dados'} m³
📊 Média diária: ${params.mediaSemana || 'Sem dados'} m³/dia`,

  RELATORIO_MENSAL: (params: {
    idImovel: string;
    tipo: string;
    consumoMes?: string;
    mediaMes?: string;
  }) =>
    `📅 *Relatório Mensal*

🏠 Imóvel: ${params.idImovel}
💧 Tipo: ${params.tipo}
📈 Consumo no mês: ${params.consumoMes || 'Sem dados'} m³
📊 Média diária: ${params.mediaMes || 'Sem dados'} m³/dia`,

  // Comandos não reconhecidos
  COMANDO_NAO_RECONHECIDO: `🤔 Desculpe, não entendi esse comando.

Digite *ajuda* ou *menu* para ver todas as opções disponíveis.

Ou envie diretamente sua leitura (ex: "123" ou "agua 123").`,

  // Mensagens de contexto
  AGUARDANDO_TIPO: `💬 Certo! Agora me diga o tipo de monitoramento:

• água
• energia
• gás`,

  AGUARDANDO_ID_IMOVEL: (casas: string) => 
    `💬 Entendi! Agora preciso saber qual imóvel.

Informe o *ID do imóvel*:
${casas}`,
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
