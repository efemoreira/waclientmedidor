# Contexto do Negócio e Plano de Expansão — Guardião Extintores

> Este documento é o ponto de entrada para quem trabalha neste bot. Resume o contexto do negócio e as três frentes de expansão prioritárias, extraídas do `plano.md` e do `operacional.md` do projeto do site (`/Users/felipemoreira/development/guardiao`).

---

## O negócio

**Guardião Extintores** é a marca de assinatura da **Faço por Você - Serviços** (CNPJ 17.078.739/0001-19), empresa de manutenção, gestão e gestão de segurança contra incêndio em Fortaleza/CE.

**O modelo:** atua como intermediária — coordena parceiros registrados no INMETRO (recarga de extintores) e bombeiro civil habilitado (treinamento de brigada), entrega documentação e gestão de vencimentos aos clientes.

**Número do bot WhatsApp do negócio:** +55 85 9 8671-8305 (as vezes a meta não envia o 9 (quinto número), mas é o mesmo número).

**Planos de assinatura:**
| Plano | Valor | Inclui |
|---|---|---|
| Vigia | R$99/ano (flat, todos os extintores) | Gestão de vencimentos + 1 inspeção/ano + 5% off avulsos |
| Essencial | R$11/extintor/mês | Recarga anual + inspeção semestral + comprovante + 10% off avulsos |
| Completo | R$18/extintor/mês | Essencial + itens de desgaste + atendimento prioritário (SLA 48h) + guia CBMCE |

**Módulo Água (add-on, sob projeto):** disponível sobre o Completo para clientes com hidrômetro — leitura mensal com alerta de consumo. É o diferencial competitivo nº 1.

---

## O bot hoje

O bot recebe leituras de hidrômetro/energia/gás enviadas por clientes via WhatsApp → registra em Google Sheets → calcula consumo → alerta anomalias → envia relatórios semanais/mensais → detecta consumo anormal de água e gera lead de manutenção → gerencia vencimento de extintores com lembretes automáticos → capta leads de prospects que chegam pelo WhatsApp.

Está bem arquitetado (veja `ARQUITETURA.md`). As três frentes de expansão foram implementadas — veja detalhes abaixo.

Além disso, o mini-CRM operacional para os admins (cadastro guiado, edição e remoção de extintor, relatórios on-demand, self-service do cliente) também foi implementado por completo — veja a seção "Módulo Guardião Extintores" em `ARQUITETURA.md` e os comandos em `COMANDOS.md`.

---

## As três frentes de expansão (prioridade nesta ordem)

### Frente 1 — Gestão de vencimento de extintores (9.2 do plano)
> **Por quê é a mais urgente:** é o motor da promessa "você não pensa mais nisso" do Guardião. Sem isso, o cliente continua controlando planilha manual e o diferencial da assinatura cai.

**✅ IMPLEMENTADO (2026-06-30)**

**Arquivos:**
- `src/utils/extintoresSheet.ts` — lê/atualiza aba `extintores`
- `src/utils/jobLembrete.ts` — lógica unificada do job (ver abaixo)
- `api/cron-vencimentos.ts` — endpoint chamado pelo Vercel Cron diário

**Aba `extintores` (colunas A–L):**
`id_cliente` · `nome_cliente` · `imovel` · `local_setor` · `tipo` · `capacidade` · `data_vencimento` · `data_ultima_inspecao` · `proxima_inspecao` · `data_lembrete_vencimento` · `data_lembrete_inspecao` · `confirmado_em`

**Como funciona:**
1. Vercel Cron chama `GET /api/cron-vencimentos` todo dia às **10h Brasília** (13:00 UTC), autenticado via `Authorization: Bearer <CRON_SECRET>`
2. O endpoint chama `executarJobLembrete()` — mesma função usada pelo comando `LEMBRAR` dos admins
3. O job identifica clientes na **janela de 24h do WhatsApp** (quem enviou leitura ontem antes das 22h) e, para esses, envia nudge de retorno + lembrete de extintor se houver um vencendo
4. Extintores de clientes **fora da janela** aparecem no resumo enviado ao Oscar para follow-up manual
5. Oscar recebe **sempre** o resumo completo (todos os vencimentos, mesmo fora da janela)
6. Inspeção semestral: lembrete disparado 14 dias antes de `proxima_inspecao`, mesma lógica
7. Quando cliente responde **SIM**: `ConversationManager` detecta, confirma na aba (`confirmado_em`) e notifica Oscar para agendar

**Restrição WhatsApp Business API:** só é possível enviar mensagem proativa para quem interagiu nas últimas 24h. Clientes fora da janela precisam de contato manual pelo Oscar — o resumo do job sempre informa quais são.

**Admins que podem disparar `LEMBRAR` manualmente:** Felipe (`558597223863`) e Oscar (`558586999181`).

**Configurar na Vercel (env vars):**
- `CRON_SECRET` — gerado automaticamente pela Vercel ao ativar o cron; também aceita `?token=<CRON_SECRET>` para debug manual
- `ADMIN_VENDAS_PHONE` = `558586999181`
- `ADMIN_TI_PHONE` = `558597223863`

**Criar na planilha:** aba `extintores` (ou definir `GOOGLE_EXTINTORES_SHEET_NAME`)

**Obs:** lembrete de vencimento só faz sentido para clientes dos planos Essencial e Completo. Clientes Vigia recebem o lembrete mas sem recarga inclusa.

---

### Frente 2 — Alerta de água → lead de manutenção (9.1 do plano)
> **Por quê é a segunda:** a detecção de anomalia já existe (`GastosManager.ts`); falta apenas conectar ao processo de agendamento. Margem da manutenção hidráulica é ~50%.

**✅ IMPLEMENTADO (2026-06-30)**

**O que foi feito:**
- `src/utils/leadsAguaSheet.ts` — registra na aba `leads_agua` (A=data, B=id_cliente, C=nome_cliente, D=imovel, E=consumo_atual, F=consumo_anterior, G=desvio_%, H=status)
- `GastosManager.ts` — ao detectar `nivelAlerta === 'forte'` (2 leituras consecutivas acima de 1.4× a média) em água: envia mensagem ao cliente sugerindo visita técnica, registra lead na planilha e notifica Oscar via WhatsApp
- Threshold: 2 leituras consecutivas acima de 1.4× a média histórica → `forte` (aciona lead); 1 leitura acima de 1.2× → `atencao` (apenas aviso, sem lead)
- A mensagem que o cliente já recebia (alerta de consumo) não foi alterada

**Aba `leads_agua` (colunas A–H):** `data` · `id_cliente` · `nome_cliente` · `imovel` · `consumo_atual` · `consumo_anterior` · `desvio_%` · `status`

**Configurar na Vercel:**
- Criar aba `leads_agua` na planilha (ou definir `GOOGLE_LEADS_AGUA_SHEET_NAME`)
- `ADMIN_VENDAS_PHONE` = `558586999181`

---

### Frente 3 — Qualificação de lead de anúncio (9.3 do plano)
> **Por quê é a última:** só faz sentido quando os anúncios estiverem rodando (Fase 3 do `operacional.md`). O site já tem a landing page `/landingpage` pronta para receber tráfego pago.

**✅ IMPLEMENTADO (2026-06-30)**

**O que foi feito:**
- `src/utils/leadsAnunciosSheet.ts` — registra na aba `leads_anuncios` (A=data, B=id_cliente, C=nome, D=endereco, E=qtd_extintores, F=status)
- `ConversationManager.ts` — número desconhecido recebe fluxo de captação de lead (nome → endereço → qtd de extintores) antes do onboarding de hidrômetro
- Após captura: notifica Oscar (`ADMIN_VENDAS_PHONE`) E Felipe (`ADMIN_TI_PHONE`) via WhatsApp
- Ao final do lead, pergunta se o prospect quer se cadastrar no sistema de monitoramento; SIM inicia o onboarding normal (LGPD → nome → bairro → etc.)
- Fluxo de clientes já inscritos: **inalterado**

**Aba `leads_anuncios` (colunas A–F):** `data` · `id_cliente` · `nome` · `endereco` · `qtd_extintores` · `status`

**Configurar na Vercel:**
- Criar aba `leads_anuncios` na planilha (ou definir `GOOGLE_LEADS_ANUNCIOS_SHEET_NAME`)
- `ADMIN_VENDAS_PHONE` = `558586999181` (Oscar)
- `ADMIN_TI_PHONE` = `558597223863` (Felipe)

---

## Job unificado de lembretes (`jobLembrete.ts`)

O WhatsApp Business API só permite envio proativo para quem interagiu nas últimas 24h. Por isso existe um único job que concentra toda a lógica proativa:

```
Admin envia "LEMBRAR"   ──┐
                          ├──▶  executarJobLembrete(sendMsg)
Vercel Cron (10h BRT)   ──┘
```

**O que o job faz (nessa ordem):**
1. Busca em paralelo: clientes elegíveis (janela 24h) + extintores vencendo (30d) + inspeções próximas (14d)
2. Para cada cliente **na janela**: envia nudge de retorno + lembrete de extintor/inspeção se houver um pendente
3. Oscar recebe **sempre** o resumo completo — incluindo clientes fora da janela, para contato manual
4. Felipe recebe o resumo apenas se houver extintores fora da janela (casos críticos)

**Disparo:** automático via Vercel Cron (diário, 10h BRT) + manual via comando `LEMBRAR` por qualquer admin.

---

## Decisões já tomadas (não rediscutir)

- Número do WhatsApp: **+55 85 9 8671-8305** — configurado na Meta Cloud API (PHONE_NUMBER_ID nas env vars da Vercel)
- Stack: mantém Meta Cloud API + Google Sheets + Vercel + Upstash Redis (não migrar para outro provider)
- O bot do hidrômetro e o bot do Guardião são o **mesmo número e o mesmo processo** — não criar dois bots separados
- Cron diário: **Vercel Cron** configurado em `vercel.json` (`0 13 * * *` = 10h BRT). Só roda em deployments de produção. Autenticado via `Authorization: Bearer <CRON_SECRET>` (injetado automaticamente pela Vercel)
- Job proativo: toda lógica de envio proativo passa por `src/utils/jobLembrete.ts` — não criar endpoints separados para cada tipo de lembrete

---

## Referências cruzadas

- Plano completo do negócio: `/Users/felipemoreira/development/guardiao/plano.md` (seção 9)
- Mini-CRM e comandos admin: seção "Módulo Guardião Extintores" em `ARQUITETURA.md` e seção "🧯 Comandos do Guardião Extintores" em `COMANDOS.md` (neste repositório)
- Checklist operacional: `/Users/felipemoreira/development/guardiao/operacional.md`
- Contrato de serviços (planos, preços, cláusulas): `/Users/felipemoreira/development/guardiao/contrato.md`
- Site/landing page: `/Users/felipemoreira/development/guardiao/` (Next.js, rota `/landingpage`)
