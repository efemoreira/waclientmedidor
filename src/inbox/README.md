# Gerenciador de Conversas - Acompanhamento de Gastos

## Visão Geral

O código gerencia conversas de usuários para acompanhamento de gastos com água, energia e gás através do WhatsApp.

---

## GastosManager (`src/inbox/GastosManager.ts`)

**Responsabilidade:** Gerenciar inscrições e leituras de gastos.

### Funcionalidades:
- `obterInscricoes()` - Listar inscrições de um usuário
- `formatarCasas()` - Formatar lista de imóveis com última leitura
- `responderMeuUid()` - Comando "Meu UID"
- `responderMinhasCasas()` - Comando "Minhas casas"  
- `responderComoIndicar()` - Comando "Como indicar"
- `parseArLeitura()` - Parser de padrões de leitura
- `processarLeitura()` - Processar envio de leitura completo
- `processarPendingLeitura()` - Continuar fluxo pendente

---

## ConversationManager (`src/inbox/ConversationManager.ts`)

**Responsabilidade:** Orquestrar fluxos e gerenciar conversas.

### Fluxo Principal:
1. Verificar se é inscrito
2. Processar comandos de gastos
3. Processar fluxo de inscrição
4. Processar leitura de gastos
5. Processar fluxo pendente

---

## Estrutura de Arquivos

```
src/inbox/
├── ConversationManager.ts    # Orquestrador principal
├── GastosManager.ts          # Lógica de gastos
└── README.md                 # Este arquivo
```

---

## Padrões de Leitura Aceitos

- `123` - Só número (1 imóvel, água é padrão)
- `agua 123` - Tipo + número
- `id 123` - ID + número (água é padrão)
- `id agua 123` - ID + tipo + número
- `energia 456` - Tipo + número
- `gás 789` - Tipo + número
