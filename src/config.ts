import 'dotenv/config';

/**
 * Configuração centralizada - lê apenas de variáveis de ambiente
 */
export const config = {
  whatsapp: {
    token: process.env.WHATSAPP_ACCESS_TOKEN || '',
    numberId: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
    accountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || '',
    webhookToken: process.env.WHATSAPP_WEBHOOK_TOKEN || '',
    apiVersion: process.env.WHATSAPP_API_VERSION?.replace(/^v/i, '') || '24.0',
  },

  // Bulk Messaging
  bulk: {
    delayBetweenMessages: 100,
    batchSize: 10,
    delayBetweenBatches: 5000,
    defaultTemplateName: 'hello_world',
    defaultTemplateLanguage: 'en_US',
    defaultMissionName: 'Missão',
  },
};

/**
 * Validar se as variáveis obrigatórias estão configuradas
 */
export function validateConfig(): boolean {
  const required = [
    { key: 'WHATSAPP_ACCESS_TOKEN', value: config.whatsapp.token },
    { key: 'WHATSAPP_PHONE_NUMBER_ID', value: config.whatsapp.numberId },
    { key: 'WHATSAPP_BUSINESS_ACCOUNT_ID', value: config.whatsapp.accountId },
    { key: 'WHATSAPP_WEBHOOK_TOKEN', value: config.whatsapp.webhookToken },
  ];

  const missing = required.filter((r) => !r.value);
  
  console.log('\n' + '='.repeat(50));
  console.log('⚙️  CONFIGURAÇÃO DO SISTEMA');
  console.log('='.repeat(50));
  
  if (missing.length > 0) {
    console.error('❌ ERRO - Variáveis de ambiente faltando:');
    missing.forEach((m) => console.error(`   - ${m.key}`));
    console.log('='.repeat(50) + '\n');
    return false;
  }

  console.log('✅ VARIÁVEIS DE AMBIENTE:');
  console.log(`  ✓ WHATSAPP_PHONE_NUMBER_ID: ${config.whatsapp.numberId.substring(0, 5)}...`);
  console.log(`  ✓ WHATSAPP_BUSINESS_ACCOUNT_ID: ${config.whatsapp.accountId.substring(0, 5)}...`);
  console.log(`  ✓ WHATSAPP_ACCESS_TOKEN: presente`);
  console.log(`  ✓ WHATSAPP_WEBHOOK_TOKEN: presente`);
  console.log(`  API Version: v${config.whatsapp.apiVersion}`);
  console.log('='.repeat(50) + '\n');

  return true;
}

/**
 * Obter token de acesso (função assíncrona para compatibilidade)
 */
export async function obterAccessToken(): Promise<string> {
  return config.whatsapp.token;
}

