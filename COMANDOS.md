# Bot de Monitoramento - Guia de Comandos

## 📋 Visão Geral

Este bot foi projetado para ser amigável e fácil de usar, permitindo que usuários monitorem o consumo de água, energia e gás de seus imóveis através do WhatsApp.

## 🚀 Primeiros Passos

### Para Novos Usuários

Quando você envia sua primeira mensagem para o bot, ele irá verificar se você já está cadastrado. Se não estiver, iniciará automaticamente o processo de inscrição.

**Output do bot:**
```
👋 Olá! Bem-vindo ao sistema de monitoramento de consumo!

Vejo que você ainda não está cadastrado. Vamos fazer sua inscrição rapidinho! 

Para começar, por favor me envie seu nome completo.
```

O bot coleta as seguintes informações passo a passo:

1. **Nome completo**
   ```
   🎯 Ótimo! Vamos começar seu cadastro.

   Por favor, me envie seu *nome completo*.
   ```

2. **Bairro**
   ```
   👍 Perfeito! 

   Agora me diga qual é o seu *bairro*.
   ```

3. **CEP**
   ```
   📮 Ótimo!

   Qual é o *CEP* do seu imóvel?
   ```

4. **Tipo de imóvel** (casa, apartamento, comercial, etc.)
   ```
   🏠 Entendi!

   Qual é o *tipo de imóvel*?
   (Exemplos: casa, apartamento, comercial, etc.)
   ```

5. **Número de pessoas** no imóvel
   ```
   👥 Legal!

   Quantas *pessoas moram* no imóvel?
   ```

6. **UID de indicador** (opcional - se alguém te indicou)
   ```
   🤝 Quase lá!

   Você tem um *UID de indicador*? 
   Se sim, informe agora. 
   Se não, pode responder "não" ou "nao".
   ```

Após completar a inscrição, você recebe confirmação com seu **UID** e **ID do Imóvel**:

```
🎉 *Parabéns! Inscrição realizada com sucesso!*

Bem-vindo(a), João Silva! 

📋 *Seus dados:*
🆔 UID: uuid-aqui
🏠 ID do Imóvel: IMV001

Agora você pode começar a enviar suas leituras de consumo! 

Digite *ajuda* para ver todas as opções disponíveis.
```

## 💬 Comandos Disponíveis

### ❓ Ajuda

#### Menu Principal
```
ajuda
help
menu
?
```

**Output do bot:**
```
📋 *Menu de Opções*

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

💬 Você também pode simplesmente enviar sua leitura diretamente (ex: "456" ou "energia 456").
```

#### Lista de Comandos
```
comandos
lista comandos
todos comandos
opcoes
```

**Output do bot:**
```
🤖 *Comandos Disponíveis*

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

💬 Dica: Você pode digitar os comandos em letras maiúsculas ou minúsculas!
```

#### Ajuda sobre Leituras
```
como enviar
enviar leitura
ajuda leitura
help leitura
```

**Output do bot:**
```
📊 *Como enviar leituras*

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
   (Sistema detecta o tipo automaticamente)
```

### 🔍 Consultas

#### Meu UID
```
meu uid
uid
id
meu id
```

**Output do bot:**
```
🔎 *Seus dados cadastrais*

• *UID:* uuid-aqui
  *Imóvel:* IMV001

• *UID:* uuid-outro
  *Imóvel:* IMV002
```

#### Minhas Casas
```
minhas casas
casas
imoveis
meus imoveis
propriedades
```

**Output do bot:**
```
🏠 *Seus imóveis cadastrados*

🏠 *IMV001* - Centro
   📊 Última leitura: 123 (15/02/2026)

🏠 *IMV002* - Jardins
   📊 Última leitura: 89 (16/02/2026)
```

#### Status
```
status
monitoramento
meu status
meus monitoramentos
```

**Output do bot:**
```
📊 *Status de Monitoramento*

🏠 *IMV001* - Centro
💧 Água
⚡ Energia

🏠 *IMV002* - Jardins
💧 Água
🔥 Gás
```

### 💡 Ações

#### Enviar Leitura

Você pode enviar leituras de várias formas:

**Formato 1: Apenas o número**
```
123
```
Útil quando você tem apenas um imóvel e um tipo de monitoramento.

**Formato 2: Tipo + número**
```
agua 123
energia 456
gas 789
```
Especifica o tipo de monitoramento.

**Formato 3: ID do imóvel + tipo + número**
```
IMV001 agua 123
```
Para quando você tem múltiplos imóveis.

**Formato 4: ID do imóvel + número**
```
IMV001 123
```
O sistema detecta o tipo automaticamente se houver apenas um tipo de monitoramento ativo para aquele imóvel.

**Output do bot (leitura com histórico):**
```
✅ *Leitura registrada!*

📅 Data: 17/02/2026
📍 Imóvel: IMV001
💧 Tipo: agua
📊 Leitura atual: 123 m³
📈 Leitura anterior: 100 m³ (30 dias atrás)
💧 Consumo: 23 m³
📊 Média/Dia: 0.77 m³/dia
📅 Consumo semana: 5 m³
📊 Média semana: 0.71 m³/dia
🗓️ Consumo mês: 23 m³
📊 Média mês: 0.77 m³/dia
```

> Os campos de histórico (leitura anterior, consumo, médias) são exibidos apenas quando há leituras anteriores disponíveis.

#### Adicionar Nova Casa
```
adicionar casa
nova casa
add casa
adicionar imovel
novo imovel
cadastrar casa
```

Inicia o processo para adicionar um novo imóvel ao seu cadastro. O bot pergunta passo a passo:

**1. Pergunta inicial:**
```
🏠 *Adicionar Novo Imóvel*

Vamos cadastrar um novo imóvel para você!

Por favor, me diga o *bairro* deste imóvel.
```

**2. Confirmação do bairro e pedido de CEP:**
```
✅ Bairro: Vila Nova

Agora me diga o *CEP* do imóvel.
```

**3. Confirmação do CEP e pedido de tipo:**
```
✅ CEP: 12345-678

Qual é o *tipo de imóvel*?
(Exemplos: casa, apartamento, comercial, etc.)
```

**4. Confirmação do tipo e pedido de pessoas:**
```
✅ Tipo: apartamento

Quantas *pessoas moram* neste imóvel?
```

**5. Cadastro concluído:**
```
🎉 *Imóvel cadastrado com sucesso!*

📋 *Detalhes:*
🏠 ID do Imóvel: IMV003
🆔 UID: uuid-aqui
📍 Bairro: Vila Nova
👥 Pessoas: 3

Agora você pode enviar leituras para este imóvel usando o ID: *IMV003*

Exemplo: IMV003 agua 123
```

### 🤝 Indicações

#### Como Indicar
```
como indicar
indicar
indicacao
indicações
```

**Output do bot:**
```
🤝 *Como Indicar Amigos*

Compartilhe seu UID com amigos que queiram se cadastrar!

*Seus UIDs:*
• uuid-aqui

Quando seu amigo se cadastrar, peça para ele informar seu UID no campo de indicador.

✨ Você ganha benefícios a cada indicação!
```

## 📊 Exemplos de Uso

### Cenário 1: Usuário com um imóvel monitorando água

```
Usuário: 123
Bot: ✅ *Leitura registrada!*

📅 Data: 17/02/2026
📍 Imóvel: IMV001
💧 Tipo: agua
📊 Leitura atual: 123 m³
📈 Leitura anterior: 100 m³ (30 dias atrás)
💧 Consumo: 23 m³
📊 Média/Dia: 0.77 m³/dia
```

### Cenário 2: Usuário com múltiplos imóveis

```
Usuário: 456
Bot: ⚠️ Você tem mais de um imóvel cadastrado.

Por favor, informe o *ID do imóvel* junto com a leitura.

Exemplo: IMV001 123

💬 Entendi! Agora preciso saber qual imóvel.

Informe o *ID do imóvel*:
• IMV001 - Centro - última leitura: 123 (15/02/2026)
• IMV002 - Jardins - última leitura: 89 (16/02/2026)

Usuário: IMV001
Bot: [aguarda próxima resposta com a leitura completa]

Usuário: IMV001 agua 456
Bot: ✅ *Leitura registrada!*

📅 Data: 17/02/2026
📍 Imóvel: IMV001
💧 Tipo: agua
📊 Leitura atual: 456 m³
```

### Cenário 3: Adicionar novo imóvel

```
Usuário: adicionar casa
Bot: 🏠 *Adicionar Novo Imóvel*

Vamos cadastrar um novo imóvel para você!

Por favor, me diga o *bairro* deste imóvel.

Usuário: Vila Nova
Bot: ✅ Bairro: Vila Nova

Agora me diga o *CEP* do imóvel.

Usuário: 12345-678
Bot: ✅ CEP: 12345-678

Qual é o *tipo de imóvel*?
(Exemplos: casa, apartamento, comercial, etc.)

Usuário: apartamento
Bot: ✅ Tipo: apartamento

Quantas *pessoas moram* neste imóvel?

Usuário: 3
Bot: 🎉 *Imóvel cadastrado com sucesso!*

📋 *Detalhes:*
🏠 ID do Imóvel: IMV003
🆔 UID: uuid-aqui
📍 Bairro: Vila Nova
👥 Pessoas: 3

Agora você pode enviar leituras para este imóvel usando o ID: *IMV003*

Exemplo: IMV003 agua 123
```

## 📬 Relatórios Automáticos

O bot envia relatórios periódicos automaticamente após o registro de leituras quando os prazos são atingidos.

### Relatório Semanal
Enviado quando a última leitura foi há mais de 7 dias:

```
📊 *Relatório Semanal*

🏠 Imóvel: IMV001
💧 Tipo: agua
📈 Consumo na semana: 5 m³
📊 Média diária: 0.71 m³/dia
```

### Relatório Mensal
Enviado quando o mês atual é diferente do mês do último registro de leitura:

```
📅 *Relatório Mensal*

🏠 Imóvel: IMV001
💧 Tipo: agua
📈 Consumo no mês: 23 m³
📊 Média diária: 0.77 m³/dia
```

## ⚠️ Mensagens de Erro

### Múltiplos imóveis sem ID especificado
```
⚠️ Você tem mais de um imóvel cadastrado.

Por favor, informe o *ID do imóvel* junto com a leitura.

Exemplo: IMV001 123
```

### Múltiplos tipos de monitoramento sem tipo especificado
```
⚠️ Por favor, especifique o *tipo de monitoramento*.

Opções disponíveis:
• água
• energia  
• gás

Exemplo: agua 123
```

### Cadastro não encontrado
```
❌ Não encontrei seu cadastro no sistema.

Entre em contato com o suporte para mais informações.
```

### Erro ao registrar leitura
```
❌ Não foi possível registrar a leitura.

Por favor, tente novamente ou entre em contato com o suporte.
```

### Comando não reconhecido
```
🤔 Desculpe, não entendi esse comando.

Digite *ajuda* ou *menu* para ver todas as opções disponíveis.

Ou envie diretamente sua leitura (ex: "123" ou "agua 123").
```

## 🎯 Dicas de Uso

1. **Comandos flexíveis**: Você pode digitar os comandos em letras maiúsculas ou minúsculas.
2. **Múltiplos imóveis**: Se você tem vários imóveis, sempre inclua o ID do imóvel ao enviar leituras.
3. **Leituras rápidas**: Se você tem apenas um imóvel e um tipo de monitoramento, basta enviar o número.
4. **Aliases**: Muitos comandos têm várias formas de serem chamados (ex: "ajuda", "help", "menu").
5. **Processo interativo**: Quando você inicia uma ação (como adicionar casa), o bot guiará você passo a passo.

## 🔧 Arquitetura Técnica

### Estrutura Modular

O bot foi desenvolvido com uma arquitetura modular e extensível:

#### CommandHandler
Sistema de comandos que permite adicionar novos comandos facilmente sem modificar o código principal. Suporta:
- Múltiplos nomes para o mesmo comando
- Aliases
- Contexto completo da conversa

#### PropertyManager
Gerencia o fluxo de adição de novos imóveis, incluindo:
- Validação de usuário
- Coleta de informações passo a passo
- Integração com planilha Google Sheets

#### GastosManager
Responsável pelo processamento de leituras e consultas:
- Parse de diferentes formatos de leitura
- Validação de dados
- Cálculo de consumo e médias

#### ConversationManager
Orquestra todos os componentes e gerencia o estado da conversa:
- Processamento de webhooks
- Roteamento de mensagens
- Persistência de estado

### Mensagens Centralizadas

Todas as mensagens do bot estão centralizadas em `src/inbox/messages.ts`, facilitando:
- Manutenção
- Tradução futura
- Consistência de tom e estilo
- Personalização

## 🚧 Funcionalidades Futuras

O sistema está preparado para receber facilmente novas funcionalidades:

### Planejadas
- [ ] Adicionar novos tipos de monitoramento além de água/energia/gás
- [ ] Comandos administrativos
- [ ] Notificações automáticas de consumo alto
- [ ] Gráficos e relatórios por período
- [ ] Metas de consumo
- [ ] Comparação entre imóveis

### Como Adicionar Novos Comandos

```typescript
// Em ConversationManager.ts ou em um novo Manager
this.commandHandler.register({
  names: ['novo comando'],
  description: 'Descrição do comando',
  aliases: ['alias1', 'alias2'],
  handler: async (ctx) => {
    // Lógica do comando
    await this.client.sendMessage(ctx.celular, 'Resposta');
    return { handled: true };
  },
});
```

## 📞 Suporte

Se você tiver dúvidas ou problemas:
1. Digite `ajuda` para ver o menu completo
2. Use os comandos de consulta para verificar seus dados
3. Entre em contato com o suporte se necessário

---

**Versão**: 2.0 com melhorias de usabilidade
**Última atualização**: Fevereiro 2026
