const AUTH_TOKEN_KEY = 'auth-token';
const BUTTON_ID = 'holyclaude-codex-lmstudio-button';
const MODAL_ID = 'holyclaude-codex-lmstudio-modal';
const STYLE_ID = 'holyclaude-codex-lmstudio-style';

function getAuthHeaders() {
  const token = window.localStorage.getItem(AUTH_TOKEN_KEY);
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function apiRequest(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      ...getAuthHeaders(),
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const errorMessage = payload?.error || payload?.message || `Request failed with HTTP ${response.status}`;
    throw new Error(errorMessage);
  }
  return payload;
}

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) {
    return;
  }

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    #${BUTTON_ID} {
      position: fixed;
      right: 20px;
      bottom: 20px;
      z-index: 2147483000;
      border: 1px solid rgba(148, 163, 184, 0.35);
      background: rgba(15, 23, 42, 0.92);
      color: #f8fafc;
      padding: 10px 14px;
      border-radius: 999px;
      font: 600 13px/1.2 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      box-shadow: 0 10px 30px rgba(15, 23, 42, 0.28);
      cursor: pointer;
      backdrop-filter: blur(10px);
    }

    #${BUTTON_ID}:hover {
      background: rgba(30, 41, 59, 0.96);
    }

    #${MODAL_ID} {
      position: fixed;
      inset: 0;
      z-index: 2147483001;
      display: none;
      align-items: center;
      justify-content: center;
      background: rgba(2, 6, 23, 0.6);
      padding: 20px;
      backdrop-filter: blur(4px);
    }

    #${MODAL_ID}[data-open="true"] {
      display: flex;
    }

    #${MODAL_ID} .hc-panel {
      width: min(560px, 100%);
      max-height: min(90vh, 760px);
      overflow: auto;
      background: #ffffff;
      color: #0f172a;
      border-radius: 20px;
      border: 1px solid rgba(148, 163, 184, 0.25);
      box-shadow: 0 30px 80px rgba(15, 23, 42, 0.28);
      padding: 24px;
    }

    #${MODAL_ID} .hc-title {
      margin: 0 0 8px;
      font: 700 22px/1.15 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    #${MODAL_ID} .hc-subtitle {
      margin: 0 0 20px;
      color: #475569;
      font: 400 14px/1.5 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    #${MODAL_ID} .hc-grid {
      display: grid;
      gap: 16px;
    }

    #${MODAL_ID} label {
      display: grid;
      gap: 8px;
      font: 600 13px/1.3 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: #0f172a;
    }

    #${MODAL_ID} input,
    #${MODAL_ID} select,
    #${MODAL_ID} button,
    #${MODAL_ID} textarea {
      font: 400 14px/1.4 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    #${MODAL_ID} input,
    #${MODAL_ID} select {
      width: 100%;
      box-sizing: border-box;
      padding: 12px 14px;
      border-radius: 12px;
      border: 1px solid #cbd5e1;
      background: #ffffff;
      color: #0f172a;
    }

    #${MODAL_ID} .hc-help {
      margin-top: -2px;
      color: #64748b;
      font-size: 12px;
      line-height: 1.5;
    }

    #${MODAL_ID} .hc-row {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
    }

    #${MODAL_ID} .hc-row button,
    #${MODAL_ID} .hc-close,
    #${MODAL_ID} .hc-save {
      border: 0;
      border-radius: 12px;
      padding: 11px 14px;
      cursor: pointer;
    }

    #${MODAL_ID} .hc-secondary,
    #${MODAL_ID} .hc-close {
      background: #e2e8f0;
      color: #0f172a;
    }

    #${MODAL_ID} .hc-primary,
    #${MODAL_ID} .hc-save {
      background: #0f766e;
      color: #ffffff;
    }

    #${MODAL_ID} .hc-secondary:disabled,
    #${MODAL_ID} .hc-primary:disabled,
    #${MODAL_ID} .hc-save:disabled,
    #${MODAL_ID} .hc-close:disabled {
      opacity: 0.6;
      cursor: wait;
    }

    #${MODAL_ID} .hc-status {
      min-height: 20px;
      color: #0f172a;
      font-size: 13px;
      line-height: 1.4;
    }

    #${MODAL_ID} .hc-status[data-kind="error"] {
      color: #b91c1c;
    }

    #${MODAL_ID} .hc-status[data-kind="success"] {
      color: #047857;
    }

    #${MODAL_ID} .hc-card {
      border: 1px solid #e2e8f0;
      border-radius: 16px;
      padding: 14px;
      background: #f8fafc;
      color: #1e293b;
      font-size: 13px;
      line-height: 1.5;
    }

    #${MODAL_ID} .hc-card strong {
      display: block;
      margin-bottom: 4px;
      color: #0f172a;
    }

    #${MODAL_ID} .hc-footer {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      align-items: center;
      margin-top: 18px;
      flex-wrap: wrap;
    }

    @media (max-width: 640px) {
      #${BUTTON_ID} {
        left: 16px;
        right: 16px;
        bottom: 16px;
      }

      #${MODAL_ID} .hc-panel {
        padding: 18px;
        border-radius: 18px;
      }
    }
  `;

  document.head.appendChild(style);
}

function createButton() {
  const existingButton = document.getElementById(BUTTON_ID);
  if (existingButton) {
    return existingButton;
  }

  const button = document.createElement('button');
  button.id = BUTTON_ID;
  button.type = 'button';
  button.textContent = 'Codex LM Studio';
  button.hidden = true;
  document.body.appendChild(button);
  return button;
}

function createModal() {
  const existingModal = document.getElementById(MODAL_ID);
  if (existingModal) {
    return existingModal;
  }

  const modal = document.createElement('div');
  modal.id = MODAL_ID;
  modal.innerHTML = `
    <div class="hc-panel" role="dialog" aria-modal="true" aria-labelledby="${MODAL_ID}-title">
      <h2 id="${MODAL_ID}-title" class="hc-title">Codex mit LM Studio</h2>
      <p class="hc-subtitle">Setzt den Codex-Provider auf LM Studio, speichert die URL in <code>~/.codex/config.toml</code> und laedt verfuegbare Modelle direkt aus deiner LM-Studio-Instanz.</p>
      <div class="hc-grid">
        <label>
          LM Studio Base URL
          <input id="${MODAL_ID}-base-url" type="text" placeholder="http://localhost:1234/v1" spellcheck="false" />
          <div class="hc-help">Wenn du nur <code>http://host:1234</code> eintraegst, wird <code>/v1</code> automatisch ergaenzt.</div>
        </label>

        <div class="hc-row">
          <button id="${MODAL_ID}-load-models" class="hc-secondary" type="button">Modelle laden</button>
        </div>

        <label>
          Codex Modell
          <select id="${MODAL_ID}-model"></select>
          <div class="hc-help">Das Dropdown kommt direkt aus <code>GET /v1/models</code> deiner LM-Studio-API.</div>
        </label>

        <div id="${MODAL_ID}-env-card" class="hc-card" hidden></div>
        <div id="${MODAL_ID}-status" class="hc-status" aria-live="polite"></div>
      </div>
      <div class="hc-footer">
        <button id="${MODAL_ID}-close" class="hc-close" type="button">Schliessen</button>
        <button id="${MODAL_ID}-save" class="hc-save" type="button">Speichern</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  return modal;
}

function setStatus(kind, message) {
  const status = document.getElementById(`${MODAL_ID}-status`);
  if (!status) {
    return;
  }

  status.dataset.kind = kind || '';
  status.textContent = message || '';
}

function setBusy(isBusy) {
  for (const elementId of [`${MODAL_ID}-load-models`, `${MODAL_ID}-save`, `${MODAL_ID}-close`]) {
    const element = document.getElementById(elementId);
    if (element) {
      element.disabled = isBusy;
    }
  }
}

function setModelOptions(selectElement, options, preferredValue) {
  if (!selectElement) {
    return;
  }

  selectElement.innerHTML = '';

  if (!Array.isArray(options) || options.length === 0) {
    const emptyOption = document.createElement('option');
    emptyOption.value = '';
    emptyOption.textContent = 'Keine Modelle gefunden';
    selectElement.appendChild(emptyOption);
    return;
  }

  for (const option of options) {
    const htmlOption = document.createElement('option');
    htmlOption.value = option.value;
    htmlOption.textContent = option.description ? `${option.label} - ${option.description}` : option.label;
    selectElement.appendChild(htmlOption);
  }

  const desiredValue = preferredValue && options.some((option) => option.value === preferredValue)
    ? preferredValue
    : options[0].value;
  selectElement.value = desiredValue;
}

async function loadSettings() {
  const response = await apiRequest('/api/settings/codex-lmstudio');
  return response.data || response;
}

async function loadModels(baseUrl) {
  const response = await apiRequest('/api/settings/codex-lmstudio/models', {
    method: 'POST',
    body: JSON.stringify({ baseUrl }),
  });
  return response.data || response;
}

async function saveSettings(payload) {
  const response = await apiRequest('/api/settings/codex-lmstudio', {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
  return response.data || response;
}

function renderEnvCard(settings) {
  const card = document.getElementById(`${MODAL_ID}-env-card`);
  if (!card) {
    return;
  }

  const envDetails = [];
  if (settings?.env?.baseUrl) {
    envDetails.push(`Base URL kommt aus ${settings.env.baseUrlEnvName}: ${settings.env.baseUrl}`);
  }
  if (settings?.env?.model) {
    envDetails.push(`Modell kommt aus ${settings.env.modelEnvName}: ${settings.env.model}`);
  }

  if (envDetails.length === 0) {
    card.hidden = true;
    card.innerHTML = '';
    return;
  }

  card.hidden = false;
  card.innerHTML = `<strong>Env-Override aktiv</strong>${envDetails.join('<br />')}<br />GUI-Werte werden gespeichert, aber Env-Werte haben bis zum Container-Neustart Vorrang.`;
}

async function hydrateModal(forceReloadModels = false) {
  setBusy(true);
  setStatus('', '');

  try {
    const settings = await loadSettings();
    const baseUrlInput = document.getElementById(`${MODAL_ID}-base-url`);
    const modelSelect = document.getElementById(`${MODAL_ID}-model`);

    if (baseUrlInput) {
      baseUrlInput.value = settings?.effective?.baseUrl || settings?.saved?.baseUrl || '';
    }

    renderEnvCard(settings);

    const shouldLoadModels = forceReloadModels || Boolean(settings?.effective?.baseUrl || settings?.saved?.baseUrl);
    if (shouldLoadModels) {
      const modelData = await loadModels(baseUrlInput?.value || settings?.effective?.baseUrl || settings?.saved?.baseUrl || '');
      setModelOptions(modelSelect, modelData.options, settings?.effective?.model || settings?.saved?.model || modelData.defaultModel);
      setStatus('success', 'LM-Studio-Modelle erfolgreich geladen.');
    } else {
      setModelOptions(modelSelect, [], '');
      setStatus('', 'Trage zuerst eine LM-Studio-URL ein und lade dann die Modelle.');
    }
  } catch (error) {
    setStatus('error', error instanceof Error ? error.message : 'Einstellungen konnten nicht geladen werden.');
  } finally {
    setBusy(false);
  }
}

function openModal() {
  const modal = createModal();
  modal.dataset.open = 'true';
  hydrateModal(false);
}

function closeModal() {
  const modal = document.getElementById(MODAL_ID);
  if (modal) {
    modal.dataset.open = 'false';
  }
}

function attachEvents() {
  const button = createButton();
  const modal = createModal();

  button.addEventListener('click', openModal);

  modal.addEventListener('click', (event) => {
    if (event.target === modal) {
      closeModal();
    }
  });

  document.getElementById(`${MODAL_ID}-close`)?.addEventListener('click', closeModal);
  document.getElementById(`${MODAL_ID}-load-models`)?.addEventListener('click', () => hydrateModal(true));
  document.getElementById(`${MODAL_ID}-save`)?.addEventListener('click', async () => {
    const baseUrlInput = document.getElementById(`${MODAL_ID}-base-url`);
    const modelSelect = document.getElementById(`${MODAL_ID}-model`);
    const baseUrl = baseUrlInput?.value || '';
    const model = modelSelect?.value || '';

    setBusy(true);
    setStatus('', '');
    try {
      await saveSettings({ baseUrl, model });
      setStatus('success', 'Codex ist jetzt auf LM Studio konfiguriert. Neue Codex-Sessions verwenden diese Einstellungen.');
    } catch (error) {
      setStatus('error', error instanceof Error ? error.message : 'Speichern fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeModal();
    }
  });

  window.setInterval(() => {
    const token = window.localStorage.getItem(AUTH_TOKEN_KEY);
    button.hidden = !token;
  }, 1000);
}

function init() {
  ensureStyles();
  attachEvents();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}
