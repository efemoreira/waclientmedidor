/**
 * Gerenciador de Envio em Massa (Frontend)
 */

const bulkState = {
  csvFile: null,
  template: 'hello_world',
  language: 'pt_BR',
  mission: 'Missão',
  enviando: false,
  contatos: [],
  validado: false,
  lastErrorCount: 0,
  lastErrorKeys: new Set(),
  marketing: false,
  productPolicy: '',
  messageActivitySharing: false,
  lastRequestKeys: new Set(),
  processando: false,
};

// Elementos
const csvFileInput = document.getElementById('csvFile');
const templateSelect = document.getElementById('templateSelect');
const customTemplate = document.getElementById('customTemplate');
const languageSelect = document.getElementById('languageSelect');
const missionInput = document.getElementById('missionName');
const marketingMessages = document.getElementById('marketingMessages');
const productPolicy = document.getElementById('productPolicy');
const messageActivitySharing = document.getElementById('messageActivitySharing');
const startBulkBtn = document.getElementById('startBulkBtn');
const forceSendBtn = document.getElementById('forceSendBtn');
const stopBulkBtn = document.getElementById('stopBulkBtn');
const bulkStatus = document.getElementById('bulkStatus');
const bulkContactsInfo = document.getElementById('bulkContactsInfo');
const bulkContactsList = document.getElementById('bulkContactsList');
const bulkLogs = document.getElementById('bulkLogs');

function logBulk(message) {
  if (!bulkLogs) return;
  const time = new Date().toLocaleTimeString('pt-BR');
  const item = document.createElement('div');
  item.className = 'bulk-log-item';
  item.textContent = `${time} ${message}`;
  bulkLogs.appendChild(item);
  bulkLogs.scrollTop = bulkLogs.scrollHeight;
}

function renderContacts() {
  if (!bulkContactsList) return;
  bulkContactsList.innerHTML = '';
  bulkState.contatos.forEach((c, idx) => {
    const item = document.createElement('div');
    item.className = 'bulk-contact-item';
    const checked = c.selecionado ? 'checked' : '';
    const statusClass = c.valido === true ? 'valid' : c.valido === false ? 'invalid' : 'unknown';
    const statusText = c.valido === true
      ? '✅ WhatsApp'
      : c.valido === false
        ? `❌ ${c.motivo || 'Não encontrado'}`
        : `⚠️ ${c.motivo || 'Não verificado'}`;
    item.innerHTML = `
      <div class="bulk-contact-left">
        <input type="checkbox" data-idx="${idx}" ${checked} />
        <div>
          <div><strong>${c.numero}</strong></div>
          <div class="bulk-contact-status ${statusClass}">${statusText}</div>
        </div>
      </div>
    `;
    bulkContactsList.appendChild(item);
  });

  bulkContactsList.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
    cb.addEventListener('change', (e) => {
      const i = Number(e.target.dataset.idx);
      bulkState.contatos[i].selecionado = e.target.checked;
      updateContactsInfo();
    });
  });

  updateContactsInfo();
}

function updateContactsInfo() {
  const total = bulkState.contatos.length;
  const validos = bulkState.contatos.filter(c => c.valido === true).length;
  const naoVerificados = bulkState.contatos.filter(c => c.valido === null).length;
  const selecionados = bulkState.contatos.filter(c => c.selecionado).length;
  if (bulkContactsInfo) {
    bulkContactsInfo.textContent = `Total: ${total} | Válidos: ${validos} | Não verificados: ${naoVerificados} | Selecionados: ${selecionados}`;
  }
}

// Event Listeners
if (csvFileInput) {
  csvFileInput.addEventListener('change', (e) => {
    bulkState.csvFile = e.target.files?.[0];
    bulkState.validado = false;
    bulkState.contatos = [];
    renderContacts();
    logBulk('📄 CSV atualizado. Pronto para validar.');
    if (forceSendBtn) forceSendBtn.style.display = 'none';
  });
}

if (templateSelect) {
  templateSelect.addEventListener('change', (e) => {
    if (e.target.value === 'custom') {
      customTemplate.style.display = 'block';
      customTemplate.required = true;
    } else {
      customTemplate.style.display = 'none';
      customTemplate.required = false;
      bulkState.template = e.target.value;
    }
  });
}

if (customTemplate) {
  customTemplate.addEventListener('change', (e) => {
    bulkState.template = e.target.value;
  });
}

if (languageSelect) {
  languageSelect.addEventListener('change', (e) => {
    bulkState.language = e.target.value;
  });
}

if (missionInput) {
  missionInput.addEventListener('change', (e) => {
    bulkState.mission = e.target.value;
  });
}

if (marketingMessages) {
  marketingMessages.addEventListener('change', (e) => {
    bulkState.marketing = e.target.checked;
  });
}

if (productPolicy) {
  productPolicy.addEventListener('change', (e) => {
    bulkState.productPolicy = e.target.value;
  });
}

if (messageActivitySharing) {
  messageActivitySharing.addEventListener('change', (e) => {
    bulkState.messageActivitySharing = e.target.checked;
  });
}

if (startBulkBtn) {
  startBulkBtn.addEventListener('click', iniciarEnvio);
}

if (forceSendBtn) {
  forceSendBtn.addEventListener('click', () => iniciarEnvio(true));
}

if (stopBulkBtn) {
  stopBulkBtn.addEventListener('click', pararEnvio);
}

/**
 * Iniciar envio em massa
 */
async function iniciarEnvio(forcarEnvio = false) {
  if (!bulkState.csvFile) {
    alert('❌ Selecione um arquivo CSV');
    return;
  }

  if (!bulkState.template) {
    alert('❌ Selecione um template');
    return;
  }

  startBulkBtn.disabled = true;
  startBulkBtn.textContent = bulkState.validado ? '⏳ Enviando...' : '⏳ Validando...';
  if (forceSendBtn) forceSendBtn.disabled = true;
  if (stopBulkBtn) stopBulkBtn.disabled = true;

  try {
    if (!bulkState.validado) {
      // 1. Upload do CSV (JSON)
      const csvText = await bulkState.csvFile.text();
      console.log('📤 Enviando arquivo...');
      logBulk('📤 Enviando CSV para validação...');
      const uploadRes = await fetch('/api/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'upload', csv: csvText }),
      });

      if (!uploadRes.ok) {
        const raw = await uploadRes.text();
        let errMsg = 'Erro ao enviar arquivo';
        try {
          const parsed = JSON.parse(raw);
          errMsg = parsed.erro || errMsg;
        } catch {
          errMsg = raw || errMsg;
        }
        throw new Error(errMsg);
      }

      const uploadText = await uploadRes.text();
      const uploadData = JSON.parse(uploadText);
      console.log(`✅ ${uploadData.total} contatos encontrados`);
      logBulk(`✅ ${uploadData.total} contatos processados`);

      bulkState.contatos = (uploadData.contatos || []).map((c) => ({
        ...c,
        selecionado: c.valido !== false,
      }));
      bulkState.validado = true;
      renderContacts();

      if (uploadData.validacaoDisponivel === false) {
        logBulk('⚠️ Validação indisponível. Verifique WHATSAPP_PHONE_NUMBER_ID e permissões do token.');
        if (forceSendBtn) forceSendBtn.style.display = 'inline-flex';
      }

      startBulkBtn.disabled = false;
      startBulkBtn.textContent = '🚀 Iniciar Envio';
      if (forceSendBtn) forceSendBtn.disabled = false;
      if (stopBulkBtn) stopBulkBtn.disabled = false;
      logBulk('✅ Validação concluída. Revise e selecione os contatos.');
      return;
    }

    if (forcarEnvio) {
      bulkState.contatos.forEach((c) => {
        c.selecionado = true;
      });
      renderContacts();
      logBulk('⚠️ Envio forçado: todos os contatos selecionados.');
    }

    const selecionados = bulkState.contatos.filter(c => c.selecionado);
    if (selecionados.length === 0) {
      throw new Error('Selecione ao menos um contato válido');
    }

    logBulk(`📌 Selecionados para envio: ${selecionados.length}`);

    // 2. Iniciar envio
    const startRes = await fetch('/api/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'start',
        template: bulkState.template,
        language: bulkState.language,
        mission: bulkState.mission,
        marketing: bulkState.marketing,
        productPolicy: bulkState.productPolicy || undefined,
        messageActivitySharing: bulkState.messageActivitySharing,
        contatos: selecionados,
      }),
    });

    if (!startRes.ok) {
      const raw = await startRes.text();
      let errMsg = 'Erro ao iniciar envio';
      try {
        const parsed = JSON.parse(raw);
        errMsg = parsed.erro || errMsg;
      } catch {
        errMsg = raw || errMsg;
      }
      throw new Error(errMsg);
    }

    bulkState.enviando = true;
    if (bulkStatus) bulkStatus.classList.remove('hidden');
    logBulk('🚀 Envio iniciado');
    if (forceSendBtn) forceSendBtn.style.display = 'none';
    if (stopBulkBtn) {
      stopBulkBtn.style.display = 'inline-flex';
      stopBulkBtn.disabled = false;
    }

    // 3. Disparar primeiro lote e monitorar status
    try {
      await fetch('/api/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'process' }),
      });
    } catch (_err) {
      // silencioso
    }

    // 4. Monitorar status
    monitorarEnvio();
  } catch (erro) {
    console.error('❌ Erro:', erro);
    logBulk(`❌ Erro: ${erro.message}`);
    alert(`Erro: ${erro.message}`);
    startBulkBtn.disabled = false;
    startBulkBtn.textContent = '🚀 Iniciar Envio';
    if (forceSendBtn) forceSendBtn.disabled = false;
    if (stopBulkBtn) stopBulkBtn.disabled = false;
  }
}

async function pararEnvio() {
  if (!bulkState.enviando) return;
  if (!confirm('Parar o envio em massa?')) return;
  try {
    if (stopBulkBtn) stopBulkBtn.disabled = true;
    const res = await fetch('/api/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'stop' }),
    });
    if (!res.ok) {
      const raw = await res.text();
      throw new Error(raw || 'Falha ao parar envio');
    }
    logBulk('🛑 Envio interrompido pelo usuário');
  } catch (erro) {
    logBulk(`❌ Erro ao parar envio: ${erro.message}`);
  } finally {
    if (stopBulkBtn) stopBulkBtn.disabled = false;
  }
}

/**
 * Monitorar status do envio
 */
async function monitorarEnvio() {
  const interval = setInterval(async () => {
    try {
      const res = await fetch('/api/bulk');
      const status = await res.json();

      // Atualizar UI
      if (document.getElementById('statusTotal')) {
        document.getElementById('statusTotal').textContent = status.total;
        document.getElementById('statusSucesso').textContent = status.enviados;
        document.getElementById('statusErros').textContent = status.erros;

        const taxa =
          status.total > 0
            ? ((status.enviados / status.total) * 100).toFixed(2)
            : '0';
        document.getElementById('statusTaxa').textContent = `${taxa}%`;

        const progress = (status.enviados / (status.total || 1)) * 100;
        if (document.getElementById('progressFill')) {
          document.getElementById('progressFill').style.width = `${progress}%`;
        }

        const lote =
          status.loteAtual > 0
            ? ` - Lote ${status.loteAtual}/${status.totalLotes}`
            : '';
        if (document.getElementById('statusText')) {
          const filaInfo = status.filaTotal
            ? ` | Fila ${status.filaIndex || 0}/${status.filaTotal}`
            : '';
          document.getElementById('statusText').textContent = `Enviando...${lote}${filaInfo}`;
        }
      }

      // Se terminou
      if (!status.ativo && bulkState.enviando) {
        clearInterval(interval);
        bulkState.enviando = false;
        startBulkBtn.disabled = false;
        startBulkBtn.textContent = '🚀 Iniciar Envio';

        if (document.getElementById('statusText')) {
          const msg = status.interrompido ? '🛑 Envio interrompido' : '✅ Envio concluído!';
          document.getElementById('statusText').textContent = msg;
        }
        logBulk(status.interrompido ? '🛑 Envio interrompido' : '✅ Envio concluído');
        if (stopBulkBtn) stopBulkBtn.style.display = 'none';
      }

      if (Array.isArray(status.lastErrors)) {
        status.lastErrors.forEach((e) => {
          const key = `${e.numero}-${e.erro}`;
          if (!bulkState.lastErrorKeys.has(key)) {
            bulkState.lastErrorKeys.add(key);
            logBulk(`❌ ${e.numero}: ${e.erro}`);
          }
        });
      }

      if (Array.isArray(status.lastRequests)) {
        status.lastRequests.forEach((r) => {
          const key = `${r.url}-${JSON.stringify(r.payload)}`;
          if (!bulkState.lastRequestKeys.has(key)) {
            bulkState.lastRequestKeys.add(key);
            logBulk(`➡️ POST ${r.url}`);
            logBulk(`📦 ${JSON.stringify(r.payload)}`);
          }
        });
      }

      if (status.ativo && !bulkState.processando) {
        bulkState.processando = true;
        try {
          await fetch('/api/bulk', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'process' }),
          });
        } finally {
          bulkState.processando = false;
        }
      }

      if (typeof status.erros === 'number' && status.erros > bulkState.lastErrorCount) {
        bulkState.lastErrorCount = status.erros;
      }
    } catch (erro) {
      console.error('Erro ao monitorar:', erro);
      logBulk(`❌ Erro ao monitorar: ${erro.message || erro}`);
      clearInterval(interval);
    }
  }, 1000); // Atualizar a cada 1 segundo
}

console.log('📨 Módulo de Bulk Messaging carregado');
