# Arquitetura e Documentação Técnica — waclient

Este documento explica detalhadamente o que o código faz, como os módulos se relacionam e como os dados fluem pelo sistema.

---

## Visão Geral

**waclient** é um sistema serverless executado na [Vercel](https://vercel.com) que funciona como um bot inteligente para o WhatsApp Business Cloud API. Ele oferece:

- 📥 **Recepção de mensagens** via webhook do WhatsApp
- 🤖 **Bot de conversas** automáticas com comandos extensíveis
- 📊 **Monitoramento de consumo** de água, energia e gás por imóvel
- 🏠 **Gestão de imóveis** (cadastro e consulta de propriedades)
- 🧯 **Guardião Extintores** — mini-CRM operacional: cadastro/edição/remoção guiada de clientes e extintores, pipeline de leads, lembretes de vencimento/inspeção e relatórios para os admins
- 📤 **Envio em massa** de mensagens a partir de arquivos CSV
- 💾 **Persistência** de conversas via Upstash Redis ou arquivo `/tmp`
- 🗂️ **Integração com Google Sheets** para armazenamento de inscrições, leituras, extintores e leads

---

## Diagrama de Módulos

```
Vercel (serverless functions)
│
├── api/webhook.ts            → Recebe eventos do WhatsApp (GET=validação, POST=mensagens)
├── api/conversations.ts      → CRUD de conversas (listar, buscar, criar, assumir controle)
├── api/messages.ts           → Envio pontual de mensagens
├── api/health.ts             → Healthcheck (WhatsApp, Google Sheets, Upstash)
├── api/cron-vencimentos.ts   → Job diário (10h BRT): lembretes de extintor/inspeção + resumo semanal às segundas
├── api/cron-resumo-semanal.ts → Endpoint standalone do resumo semanal (debug/chamada manual)
├── api/bulk.ts              → Orquestrador de envio em massa
│   ├── handlers/bulk-upload.ts   → Faz upload e valida CSV
│   ├── handlers/bulk-start.ts    → Inicializa a fila de envio
│   ├── handlers/bulk-process.ts  → Processa um lote de envio
│   ├── handlers/bulk-stop.ts     → Interrompe o envio
│   └── handlers/bulk-status.ts   → Consulta status do envio
│
src/
├── config.ts               → Configuração centralizada (variáveis de ambiente)
│
├── wabapi/                 → Cliente WhatsApp Business Cloud API
│   ├── WhatsApp.ts         → Classe principal; envia e recebe mensagens
│   ├── Dispatcher.ts       → Roteador de mensagens recebidas para handlers registrados
│   ├── Handler.ts          → Handlers para diferentes tipos de mensagem
│   ├── Message.ts          → Funções de baixo nível para chamar a API do WhatsApp
│   ├── Update.ts           → Representação de uma mensagem recebida
│   ├── Markup.ts           → Criação de menus interativos (botões e listas)
│   ├── UserContext.ts      → Armazenamento de estado por usuário
│   ├── index.ts            → Reexporta WhatsApp e tipos principais
│   └── types/index.ts      → Todas as interfaces e tipos TypeScript
│
├── inbox/                  → Lógica de negócio do bot de conversas
│   ├── ConversationManager.ts  → Orquestrador: processa webhooks e gerencia conversas
│   ├── GastosManager.ts        → Lógica de leituras de consumo (água/energia/gás)
│   ├── CommandHandler.ts       → Sistema extensível de comandos do bot (água/energia/gás + Guardião)
│   ├── PropertyManager.ts      → Fluxo de adição de novos imóveis
│   └── messages.ts             → Textos centralizados de todas as mensagens do bot
│
├── bulk/
│   └── envio-massa.ts      → Engine de envio em massa com rate limiting
│
└── utils/
    ├── logger.ts               → Logger estruturado com níveis (info/warn/error/debug)
    ├── config.ts               → (ver src/config.ts)
    ├── conversation-storage.ts → Persistência de conversas (Upstash Redis ou /tmp)
    ├── bulk-file-operations.ts → Persistência de fila e status de envio em massa
    ├── inscritosSheet.ts       → CRUD de inscritos (clientes + imóveis) na planilha Google Sheets
    ├── predioSheet.ts          → Registro de leituras e acumulados na planilha
    ├── csv-parser.ts           → Parser de CSV com detecção automática de delimitador
    ├── phone-normalizer.ts     → Normalização de números de telefone brasileiros
    ├── whatsapp-validator.ts   → Validação de números no WhatsApp Business API
    ├── text-normalizer.ts      → Normalização de texto (remove acentos, minúsculas)
    ├── validar-numeros.ts      → Re-exporta validarTelefone (backward-compat)
    │
    │   ── Guardião Extintores (admin, leads, relatórios) ──
    ├── extintoresSheet.ts      → CRUD de extintores por imóvel; soft-delete via coluna removido_em
    ├── adminFlowHandler.ts     → Máquina de estados dos fluxos guiados admin (adminStage)
    ├── relatoriosAdmin.ts      → Leads estagnados + resumo executivo semanal
    ├── jobLembrete.ts          → Lógica unificada do job de lembretes (cron diário + comando LEMBRAR)
    ├── leadsAguaSheet.ts       → Pipeline de leads de manutenção hidráulica (com deduplicação)
    ├── leadsAnunciosSheet.ts   → Pipeline de leads de anúncios/prospects (com deduplicação)
    ├── cobrancasSheet.ts       → Registro de cobranças
    └── anunciosSheet.ts        → Dados de campanhas/anúncios
```

---

## Fluxo de Mensagem Recebida

```
WhatsApp Cloud API
       │  POST /api/webhook
       ▼
api/webhook.ts
  └─ ConversationManager.processarWebhook(payload)
        │
        ├─ 1. Verificar fluxo de novo imóvel (conversa.novoImovel)
        │        └─ PropertyManager.processarProximoPasso()
        │
        ├─ 2. Verificar fluxo de inscrição (conversa.inscricaoStage)
        │        └─ Coletar nome → bairro → CEP → tipo → pessoas → UID indicador
        │           └─ inscritosSheet.adicionarInscrito()
        │
        ├─ 3. Verificar se usuário já está inscrito
        │        └─ inscritosSheet.verificarInscrito()
        │           ├─ Não inscrito → iniciar fluxo de inscrição (inscricaoStage = 'nome')
        │           └─ Inscrito → continuar
        │
        ├─ 4. Processar comandos de texto
        │        └─ CommandHandler.process()
        │           ├─ 'ajuda' / 'help' / 'menu' → MENU_PRINCIPAL
        │           ├─ 'meu uid' / 'uid'         → GastosManager.responderMeuUid()
        │           ├─ 'minhas casas' / 'casas'  → GastosManager.responderMinhasCasas()
        │           ├─ 'status'                   → INFO_STATUS_MONITORAMENTO
        │           ├─ 'como indicar'             → GastosManager.responderComoIndicar()
        │           ├─ 'como enviar'              → HELP_ENVIAR_LEITURA
        │           ├─ 'adicionar casa'           → PropertyManager.iniciarAdicaoImovel()
        │           └─ 'comandos'                 → HELP_COMMANDS
        │
        ├─ 5. Verificar fluxo de leitura pendente (conversa.pendingLeitura)
        │        └─ GastosManager.processarPendingLeitura()
        │
        ├─ 6. Tentar interpretar como leitura de consumo
        │        └─ GastosManager.parseArLeitura()
        │           └─ GastosManager.processarLeitura()
        │                └─ predioSheet.appendPredioEntry()
        │
        └─ 7. Comando não reconhecido → COMANDO_NAO_RECONHECIDO
```

> **Extensão Guardião:** antes do fluxo acima, `processarWebhook` verifica primeiro `isHuman` (bot silencioso se operador assumiu o controle), depois se a mensagem é de áudio ou imagem (`msg.type === 'audio' | 'image'`) — nesse caso responde com `MESSAGES.MIDIA_NAO_SUPORTADA(tipo)`, notifica `ADMIN_VENDAS_PHONE`/`ADMIN_TI_PHONE` e não avança o estágio da conversa — e, para números admin (`ADMIN_VENDAS_PHONE`/`ADMIN_TI_PHONE`), trata `adminStage` via `adminFlowHandler.processarAdminFlow()` ou delega ao `CommandHandler` (que pode iniciar um `adminStage`). Números desconhecidos que não são clientes passam primeiro pelo fluxo de captação de lead (`inscricaoStage = 'lead_nome' | 'lead_endereco' | 'lead_qtd_extintores'`) antes do onboarding normal. Ver seção "Módulo Guardião Extintores" abaixo.

---

## Fluxo de Envio em Massa

O envio em massa é dividido em etapas para respeitar o limite de 10 segundos de execução das Vercel Functions:

```
Frontend (public/)
       │
       │  POST /api/bulk  { action: 'upload', csv: '...' }
       ▼
handlers/bulk-upload.ts
  ├─ parseCsv()             → Parse do CSV (detecta delimitador, header, coluna de número)
  └─ validarNumerosWhatsApp() → Valida se os números existem no WhatsApp

       │  POST /api/bulk  { action: 'start', template, contatos }
       ▼
handlers/bulk-start.ts
  ├─ Salva lista de contatos em /tmp/bulk-queue.json
  └─ Salva status inicial em /tmp/bulk-status.json

       │  POST /api/bulk  { action: 'process' }  ← chamado repetidamente pelo frontend
       ▼
handlers/bulk-process.ts
  ├─ Lê /tmp/bulk-status.json e /tmp/bulk-queue.json
  ├─ Verifica /tmp/bulk-stop.json (flag de interrupção)
  ├─ Processa próximo lote (batchSize = 10 por padrão)
  │    └─ EnvioMassa.executar(lote)
  │         └─ Para cada contato: WhatsApp.sendTemplateMessage() ou sendMessage()
  └─ Atualiza status e índice da fila

       │  POST /api/bulk  { action: 'stop' }
       ▼
handlers/bulk-stop.ts
  └─ Salva flag stop=true em /tmp/bulk-stop.json

       │  GET /api/bulk
       ▼
handlers/bulk-status.ts
  └─ Lê /tmp/bulk-status.json e retorna o status atual
```

---

## Persistência de Conversas

O sistema suporta dois backends de armazenamento, com fallback automático:

| Condição | Backend usado |
|---|---|
| `UPSTASH_REDIS_REST_URL` e `UPSTASH_REDIS_REST_TOKEN` configurados | **Upstash Redis** (recomendado para produção) |
| Variáveis não configuradas | **Arquivo `/tmp/conversations.json`** (apenas para desenvolvimento local) |

A função `mergeConversas()` em `ConversationManager` garante que mensagens não sejam perdidas quando múltiplas instâncias serverless existem simultaneamente: ela mescla as mensagens por ID, mantendo sempre o histórico mais completo.

---

## Integração com Google Sheets

O sistema usa duas planilhas principais:

### Aba `Inscritos`

Armazena os dados cadastrais de cada usuário/imóvel.

| Coluna | Campo |
|---|---|
| A | UID (UUID único por inscrição) |
| B | ID do Imóvel (ex: `IMV1234567890`) |
| C | Nome |
| D | Celular |
| F | Data de inscrição |
| G | Bairro |
| H | CEP |
| I | Tipo de imóvel |
| J | Pessoas |
| N | UID do indicador |
| Q | Monitorando Água (`true`/`false`) |
| R | Monitorando Energia (`true`/`false`) |
| S | Monitorando Gás (`true`/`false`) |
| T | Data do último relatório semanal |
| U | Data do último relatório mensal |

### Abas de Leituras

| Aba | Descrição |
|---|---|
| `leituras` | Log detalhado de todas as leituras (retenção automática de 90 dias) |
| `acumulado_semana` | Consumo acumulado por imóvel/tipo na semana atual |
| `acumulado_mes` | Consumo acumulado por imóvel/tipo no mês atual |
| `historico_resumo` | Resumo histórico permanente (nunca apagado) |

**Fluxo de registro de leitura (`appendPredioEntry`):**
1. Lê leituras + acumulados em paralelo (minimiza chamadas à API)
2. Calcula consumo = leitura atual − leitura anterior do mesmo imóvel/tipo
3. Salva nova linha na aba `leituras`
4. Atualiza `acumulado_semana` (reseta individualmente se a semana mudou)
5. Atualiza `acumulado_mes` (reseta individualmente se o mês mudou)
6. Remove registros da aba `leituras` com mais de 90 dias

### Aba `extintores` (Guardião)

Um extintor pertence a um cliente (telefone) e um imóvel (nome livre, sem FK formal).

| Coluna | Campo |
|---|---|
| A | id_cliente (telefone) |
| B | nome_cliente |
| C | imovel |
| D | local_setor |
| E | tipo (ABC / CO2 / AP / BC) |
| F | capacidade |
| G | data_vencimento |
| H | data_ultima_inspecao |
| I | proxima_inspecao |
| J | data_lembrete_vencimento |
| K | data_lembrete_inspecao |
| L | confirmado_em |
| M | removido_em (soft-delete — linha some das listagens mas fica na planilha) |

### Abas de leads

| Aba | Descrição |
|---|---|
| `leads_agua` | Leads de manutenção hidráulica (gerados por `GastosManager` ao detectar consumo anômalo) |
| `leads_anuncios` | Leads de prospects que chegam pelo WhatsApp sem estar cadastrados |

Ambas têm deduplicação: não criam novo lead se já existir um com status `novo` para o mesmo `id_cliente`.

### Aba `funil_eventos`

Log de eventos (uma linha por evento, sem deduplicação) para analisar em qual etapa os contatos abandonam a conversa — ex.: comparar quantos iniciaram a captação de lead (`lead_iniciado`) vs. quantos concluíram (`lead_finalizado`).

| Coluna | Campo |
|---|---|
| A | data_hora |
| B | telefone |
| C | etapa |
| D | detalhe (opcional) |

Etapas registradas por `registrarEventoFunil()` (`src/utils/funilSheet.ts`), chamado a partir de `ConversationManager.ts`:
- `lead_iniciado` — número desconhecido começou a captação de lead
- `etapa_<nome>` — avançou para uma etapa do onboarding ou da captação de lead (ex.: `etapa_lead_endereco`, `etapa_bairro`)
- `lead_finalizado` — captação de lead concluída (mesmo momento em que a linha é gravada em `leads_anuncios`)
- `lead_aceitou_monitoramento` / `lead_recusou_monitoramento` — resposta ao convite de virar cliente de monitoramento após o lead
- `onboarding_concluido` — onboarding normal (não-lead) finalizado com sucesso

Nunca lança erro — falha de gravação só gera um `logger.warn`, para não travar o fluxo do bot.

---

## Configuração (`src/config.ts`)

Todas as configurações são lidas de variáveis de ambiente. Não há valores hardcoded sensíveis no código.

```typescript
config.whatsapp.token          // WHATSAPP_ACCESS_TOKEN
config.whatsapp.numberId       // WHATSAPP_PHONE_NUMBER_ID
config.whatsapp.accountId      // WHATSAPP_BUSINESS_ACCOUNT_ID
config.whatsapp.webhookToken   // WHATSAPP_WEBHOOK_TOKEN
config.whatsapp.apiVersion     // WHATSAPP_API_VERSION (padrão: '24.0')

config.bulk.delayBetweenMessages  // Delay entre mensagens do envio em massa (100ms)
config.bulk.batchSize             // Mensagens por lote (10)
config.bulk.delayBetweenBatches   // Delay entre lotes (5000ms)
```

---

## Módulo `wabapi` — Cliente WhatsApp

Este módulo encapsula toda a comunicação com a WhatsApp Business Cloud API.

### `WhatsApp.ts` — Classe principal

A classe `WhatsApp` é o ponto de entrada para enviar e receber mensagens:

```typescript
const client = new WhatsApp({
  numberId: '...',  // WHATSAPP_PHONE_NUMBER_ID
  token: '...',     // WHATSAPP_ACCESS_TOKEN
  version: 24,      // Versão da API do Graph (padrão: 24)
});

// Enviar mensagem de texto
await client.sendMessage('5511987654321', 'Olá!');

// Enviar template
await client.sendTemplateMessage('5511987654321', 'hello_world', [], 'pt_BR');

// Processar webhook recebido
await client.processUpdate(webhookPayload);
```

### `Dispatcher.ts` — Roteador de mensagens

O `Dispatcher` mantém uma fila assíncrona (`AsyncQueue`) para processar webhooks em ordem. Para cada mensagem recebida:
1. Verifica se o `phone_number_id` do webhook corresponde ao ID configurado
2. Marca a mensagem como lida (se `markAsRead = true`)
3. Busca handlers registrados que correspondam ao tipo e filtro da mensagem
4. Executa o primeiro handler correspondente

### `Handler.ts` — Tipos de handler

| Handler | Tipo de mensagem |
|---|---|
| `MessageHandler` | Texto (`text`) |
| `InteractiveQueryHandler` | Interativo: botões e listas |
| `ImageHandler` | Imagem |
| `AudioHandler` | Áudio |
| `VideoHandler` | Vídeo |
| `DocumentHandler` | Documento |
| `StickerHandler` | Sticker |
| `LocationHandler` | Localização |

---

## Módulo `inbox` — Bot de Conversas

### `ConversationManager.ts`

O orquestrador central. Responsabilidades:
- Processar webhooks do WhatsApp
- Gerenciar o estado de cada conversa em memória e persistência
- Rotear mensagens para os managers corretos

**Estados de uma conversa:**
- `inscricaoStage` — em qual etapa do onboarding o usuário está (inclui captação de lead: `lead_nome`, `lead_endereco`, `lead_qtd_extintores`, `lead_pos_registro`)
- `inscricaoData` — dados coletados durante o onboarding
- `leadAnuncioData` — dados coletados durante a captação de lead de anúncio
- `pendingLeitura` — leitura em andamento aguardando tipo ou ID do imóvel
- `novoImovel` — fluxo de adição de imóvel em andamento
- `adminStage` / `adminFlowData` — etapa ativa de um fluxo guiado admin (cadastro/edição/remoção de cliente ou extintor), processado por `adminFlowHandler.ts`
- `clientStage` / `clientFlowData` — etapa ativa de um fluxo guiado do cliente (ex: `solicitar_visita_horario`)
- `isHuman` — se `true`, o bot não responde (controle manual ativado)

### `CommandHandler.ts`

Sistema extensível de comandos. Novos comandos podem ser registrados sem modificar o código principal:

```typescript
commandHandler.register({
  names: ['meu comando'],
  description: 'Descrição do comando',
  aliases: ['alias1', 'alias2'],
  handler: async (ctx) => {
    await ctx.client.sendMessage(ctx.celular, 'Resposta');
    return { handled: true };
  },
});
```

O processamento busca primeiro por correspondência exata (normalizada), depois por prefixo (para comandos com parâmetros).

### `GastosManager.ts`

Responsável pela lógica de leituras de consumo:
- `parseArLeitura()` — detecta se o texto do usuário é uma leitura (ex: `"123"`, `"agua 456"`, `"IMV001 energia 789"`)
- `processarLeitura()` — registra a leitura, calcula consumo e envia confirmação
- `processarPendingLeitura()` — continua um fluxo de leitura que estava aguardando tipo ou ID do imóvel
- `enviarRelatoriosPeriodicos()` — envia relatório semanal (se ≥7 dias) e mensal (se mês diferente) após cada leitura

### `PropertyManager.ts`

Gerencia o fluxo passo-a-passo de adição de novo imóvel:
1. Bairro
2. CEP
3. Tipo de imóvel
4. Número de pessoas
5. Cadastro via `inscritosSheet.adicionarInscrito()`

### `messages.ts`

Centraliza todos os textos do bot. Mensagens são funções (quando precisam de parâmetros) ou strings constantes. Isso facilita manutenção e uma futura internacionalização.

---

## Módulo Guardião Extintores — Admin, Leads e Relatórios

Mini-CRM operacional embutido no mesmo bot. Modelo de dados: **Cliente** (telefone) → 1..N **Imóveis** → 0..N **Extintores** (serviço principal) e 0..N **Leituras** água/energia/gás (add-on).

### `adminFlowHandler.ts` — fluxos guiados admin

Máquina de estados (`processarAdminFlow`) ativada quando `conversa.adminStage` está definido. Stages principais:
- **Cadastro de cliente:** `cadastrar_cliente_nome → tel → bairro → confirmar`
- **Cadastro de extintor:** `cadastrar_extintor_tipo → capacidade → imovel → setor → vencimento → confirmar → mais`
- **Edição de extintor:** `extintor_editar_escolha → campo → valor` (usa `atualizarCampoExtintor`)
- **Remoção de extintor:** `extintor_remover_escolha → confirmar` (soft-delete via `removerExtintor`, grava `removido_em`)

Cancelável em qualquer etapa com "cancelar". Notifica o cliente automaticamente após cadastro de cliente/extintor (boas-vindas + aviso de vencimento).

### `CommandHandler.ts` — comandos admin e cliente do Guardião

| Comando | Quem | Descrição |
|---|---|---|
| `/leads`, `/lead [num] [status]`, `/lead fechar [num]` | admin | Pipeline de leads (água + anúncios), fechamento em cascata para cadastro |
| `/cadastrar` (guiado ou `Nome;Tel;Bairro`) | admin | Cadastra cliente |
| `/extintor [num]`, `/extintor editar [num]`, `/extintor remover [num]` | admin | Adiciona, edita ou remove (soft-delete) extintor |
| `/ver [num]` | admin | Dados do cliente + extintores com status 🔴🟡🟢 |
| `/clientes` | admin | Lista paginada de clientes |
| `/relatorio` | admin | Resumo executivo on-demand (`gerarResumoSemanal`) |
| `/lembrar` | admin | Dispara o job de lembretes manualmente |
| `/meus extintores` | cliente | Extintores do próprio cliente com status de vencimento |
| `/solicitar visita` | cliente | Inicia fluxo de agendamento (`clientStage`) |

### `relatoriosAdmin.ts`

- `verificarLeadsEstagnados(dias=2)` — leads com status `novo` sem contato há N dias
- `gerarResumoSemanal()` — agrega leads, clientes ativos e extintores vencendo em uma mensagem para os admins

### `jobLembrete.ts` + crons

`executarJobLembrete()` é a única rotina de envio proativo (restrição da WhatsApp API: só é possível mandar mensagem proativa para quem interagiu nas últimas 24h):
1. Busca clientes elegíveis (janela 24h) + extintores vencendo (30d) + inspeções próximas (14d) em paralelo
2. Clientes na janela recebem nudge + lembretes diretamente
3. Clientes fora da janela entram no resumo enviado ao Oscar para contato manual
4. Ao final, chama `verificarLeadsEstagnados(2)` e notifica se houver leads parados

Disparado por: comando `/lembrar` (admin) ou `api/cron-vencimentos.ts` (cron diário, 10h BRT). Esse mesmo endpoint verifica se é segunda-feira (`isSegundaFeiraBRT()`) e, se sim, também dispara `gerarResumoSemanal()` — **o resumo semanal não tem cron próprio** porque o plano Vercel permite apenas 1 cron/dia; `api/cron-resumo-semanal.ts` existe só como endpoint standalone para chamada manual/debug.

---

## Módulo `bulk` — Envio em Massa

### `envio-massa.ts` — `EnvioMassa`

Engine de envio em massa com:
- **Rate limiting**: delay configurável entre mensagens (padrão: 100ms)
- **Callbacks**:
  - `onProgress` — chamado após cada envio (sucesso ou erro)
  - `shouldStop` — verifica se deve interromper o envio
  - `onRequest` — auditoria das requisições enviadas
- **Suporte a templates** e mensagens de marketing
- Normalização automática dos números de telefone

---

## Utilitários (`src/utils`)

| Arquivo | Responsabilidade |
|---|---|
| `logger.ts` | Logger com escopo e níveis de severidade |
| `conversation-storage.ts` | Leitura/escrita de conversas (Upstash Redis ou arquivo) |
| `bulk-file-operations.ts` | Leitura/escrita de status e fila de envio em massa |
| `inscritosSheet.ts` | CRUD na aba `Inscritos` do Google Sheets |
| `predioSheet.ts` | Registro de leituras e cálculo de acumulados no Google Sheets |
| `csv-parser.ts` | Parse de CSV com detecção automática de delimitador e coluna de número |
| `phone-normalizer.ts` | Normaliza números para o formato `55DDNNNNNNNNN` |
| `whatsapp-validator.ts` | Valida números via endpoint `/contacts` da WhatsApp API |
| `text-normalizer.ts` | Remove acentos e converte para minúsculas |
| `extintoresSheet.ts` | CRUD de extintores; soft-delete via `removido_em` |
| `adminFlowHandler.ts` | Máquina de estados dos fluxos guiados admin |
| `relatoriosAdmin.ts` | Leads estagnados + resumo executivo semanal |
| `jobLembrete.ts` | Lógica unificada do job de lembretes proativos |
| `leadsAguaSheet.ts` / `leadsAnunciosSheet.ts` | Pipeline de leads com deduplicação |

---

## Variáveis de Ambiente

Copie `.env.example` para `.env.local` e preencha os valores:

| Variável | Obrigatória | Descrição |
|---|---|---|
| `WHATSAPP_ACCESS_TOKEN` | ✅ | Token de acesso da Meta |
| `WHATSAPP_PHONE_NUMBER_ID` | ✅ | ID do número de telefone |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | ✅ | ID da conta business |
| `WHATSAPP_WEBHOOK_TOKEN` | ✅ | Token de verificação do webhook |
| `WHATSAPP_API_VERSION` | ❌ | Versão da API (padrão: `24.0`) |
| `GOOGLE_SHEET_ID` | ✅* | ID da planilha Google Sheets |
| `GOOGLE_SHEETS_CLIENT_EMAIL` | ✅* | E-mail da conta de serviço |
| `GOOGLE_SHEETS_PRIVATE_KEY` | ✅* | Chave privada da conta de serviço |
| `GOOGLE_INSCRITOS_SHEET_NAME` | ❌ | Nome da aba de inscritos (padrão: `Inscritos`) |
| `GOOGLE_LEITURAS_SHEET_NAME` | ❌ | Nome da aba de leituras (padrão: `leituras`) |
| `GOOGLE_ACUMULADO_SEMANA_SHEET_NAME` | ❌ | Aba de acumulado semanal |
| `GOOGLE_ACUMULADO_MES_SHEET_NAME` | ❌ | Aba de acumulado mensal |
| `GOOGLE_HISTORICO_RESUMO_SHEET_NAME` | ❌ | Aba de histórico permanente |
| `GOOGLE_EXTINTORES_SHEET_NAME` | ❌ | Nome da aba de extintores (padrão: `extintores`) |
| `GOOGLE_LEADS_AGUA_SHEET_NAME` | ❌ | Nome da aba de leads de água (padrão: `leads_agua`) |
| `GOOGLE_LEADS_ANUNCIOS_SHEET_NAME` | ❌ | Nome da aba de leads de anúncio (padrão: `leads_anuncios`) |
| `GOOGLE_FUNIL_SHEET_NAME` | ❌ | Nome da aba de eventos de funil (padrão: `funil_eventos`) |
| `ADMIN_VENDAS_PHONE` | ❌ | Telefone do admin de vendas — Oscar (padrão: `558586999181`) |
| `ADMIN_TI_PHONE` | ❌ | Telefone do admin técnico — Felipe (padrão: `558597223863`) |
| `CRON_SECRET` | ✅* | Token do cron diário e do endpoint de resumo semanal (gerado pela Vercel) |
| `UPSTASH_REDIS_REST_URL` | ❌ | URL do Upstash Redis (persistência em produção) |
| `UPSTASH_REDIS_REST_TOKEN` | ❌ | Token do Upstash Redis |
| `APP_PASSWORD` | ❌ | Senha para proteger endpoints de conversas e mensagens |

> ✅* Obrigatório para a funcionalidade do bot de conversas e registro de leituras. `CRON_SECRET` obrigatório apenas para os endpoints de cron.

---

## Endpoints da API

| Método | Endpoint | Descrição |
|---|---|---|
| `GET` | `/api/webhook` | Verificação do webhook (responde ao desafio da Meta) |
| `POST` | `/api/webhook` | Recebe mensagens e eventos do WhatsApp |
| `GET` | `/api/conversations` | Lista todas as conversas |
| `GET` | `/api/conversations?id=xxx` | Busca uma conversa específica |
| `POST` | `/api/conversations` | Cria nova conversa ou alterna controle manual |
| `DELETE` | `/api/conversations` | Apaga todas as conversas |
| `POST` | `/api/messages` | Envia uma mensagem pontual |
| `GET` | `/api/media?id=xxx` | Proxy de mídia recebida do WhatsApp (áudio ou imagem) para reprodução/visualização no painel |
| `GET` | `/api/bulk` | Status do envio em massa |
| `POST` | `/api/bulk` | Ações: `upload`, `start`, `process`, `stop` |
| `GET` | `/api/health` | Healthcheck (WhatsApp, Google Sheets, Upstash) |
| `GET` | `/api/cron-vencimentos` | Job diário de lembretes (cron Vercel, `Authorization: Bearer <CRON_SECRET>`) — também dispara resumo semanal às segundas |
| `GET` | `/api/cron-resumo-semanal` | Resumo executivo semanal — endpoint standalone, sem cron próprio (debug/chamada manual) |

---

## Segurança

- O header `x-app-password` é verificado nos endpoints `/api/conversations`, `/api/messages` e `/api/media` quando a variável `APP_PASSWORD` está configurada.
- O webhook verifica o `hub.verify_token` na validação inicial e sempre retorna HTTP 200 nas requisições POST (para evitar reenvios pela Meta).
- Nenhum segredo é hardcoded no código — todos os valores sensíveis são lidos de variáveis de ambiente.

---

## Referências

- [README.md](README.md) — Quick start e configuração básica
- [COMANDOS.md](COMANDOS.md) — Guia completo de comandos do bot
- [GUARDIAO_PLANO.md](GUARDIAO_PLANO.md) — Contexto de negócio do Guardião Extintores
- [src/inbox/README.md](src/inbox/README.md) — Documentação do módulo inbox
- [WhatsApp Business Cloud API](https://developers.facebook.com/docs/whatsapp/cloud-api)
