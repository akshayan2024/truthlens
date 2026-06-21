'use strict';

const PROVIDERS = {
  deepseek: {
    label:    'DeepSeek',
    hint:     'platform.deepseek.com',
    keyStore: 'deepseekApiKey',
    models: [
      { value: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash — Fast ★' },
      { value: 'deepseek-v4-pro',   label: 'DeepSeek V4 Pro — Reasoner'  },
      { value: 'deepseek-chat',     label: 'DeepSeek V3'                  },
    ]
  },
  anthropic: {
    label:    'Anthropic',
    hint:     'console.anthropic.com',
    keyStore: 'anthropicApiKey',
    models: [
      { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5 — Fast'        },
      { value: 'claude-sonnet-4-6',         label: 'Claude Sonnet 4.6 — Balanced'   },
      { value: 'claude-opus-4-8',           label: 'Claude Opus 4.8 — Best'         },
    ]
  },
  openai: {
    label:    'OpenAI',
    hint:     'platform.openai.com',
    keyStore: 'openaiApiKey',
    models: [
      { value: 'gpt-4o-mini', label: 'GPT-4o Mini — Fast'     },
      { value: 'gpt-4o',      label: 'GPT-4o — Balanced'      },
      { value: 'gpt-4.1',     label: 'GPT-4.1 — Best'         },
    ]
  }
};

// ─── DOM refs ─────────────────────────────────────────────────────────────────

const apiKeyInput  = document.getElementById('api-key');
const saveBtn      = document.getElementById('save-btn');
const toggleBtn    = document.getElementById('toggle-vis');
const iconShow     = document.getElementById('icon-show');
const iconHide     = document.getElementById('icon-hide');
const statusEl     = document.getElementById('status');
const modelSelect  = document.getElementById('model-select');
const keyHintUrl   = document.getElementById('key-hint-url');
const providerTabs = document.querySelectorAll('.p-tab');

let activeProvider = 'deepseek';

// ─── Provider switch ──────────────────────────────────────────────────────────

function switchProvider(provider) {
  activeProvider = provider;
  const cfg = PROVIDERS[provider];

  providerTabs.forEach(t => {
    const active = t.dataset.provider === provider;
    t.classList.toggle('active', active);
    t.setAttribute('aria-selected', String(active));
  });

  modelSelect.innerHTML = cfg.models
    .map(m => `<option value="${m.value}">${m.label}</option>`)
    .join('');

  keyHintUrl.textContent = cfg.hint;

  chrome.storage.local.get([cfg.keyStore, 'selectedModel', 'provider'], result => {
    apiKeyInput.value = result[cfg.keyStore] || '';
    if (result.provider === provider && result.selectedModel) {
      const exists = cfg.models.some(m => m.value === result.selectedModel);
      if (exists) modelSelect.value = result.selectedModel;
    }
    if (result[cfg.keyStore]) {
      showStatus('success', '✓ Key saved');
    } else {
      statusEl.className = 'status';
      statusEl.textContent = '';
    }
  });
}

// ─── Event listeners ──────────────────────────────────────────────────────────

providerTabs.forEach(tab => {
  tab.addEventListener('click', () => switchProvider(tab.dataset.provider));
});

toggleBtn.addEventListener('click', () => {
  const isPassword = apiKeyInput.type === 'password';
  apiKeyInput.type = isPassword ? 'text' : 'password';
  iconShow.style.display = isPassword ? 'none' : '';
  iconHide.style.display = isPassword ? ''     : 'none';
});

saveBtn.addEventListener('click', () => {
  const key   = apiKeyInput.value.trim();
  const model = modelSelect.value;
  const cfg   = PROVIDERS[activeProvider];

  if (!key) {
    showStatus('error', `Enter your ${cfg.label} API key`);
    return;
  }
  if (!key.startsWith('sk-')) {
    showStatus('error', 'API keys must start with sk-');
    return;
  }

  chrome.storage.local.set({
    provider:       activeProvider,
    selectedModel:  model,
    [cfg.keyStore]: key
  }, () => {
    showStatus('success', `✓ Saved · ${model}`);
  });
});

apiKeyInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') saveBtn.click();
});

// ─── Supadata ─────────────────────────────────────────────────────────────────

const supaInput    = document.getElementById('supadata-key');
const saveSupaBtn  = document.getElementById('save-supa-btn');
const toggleSupa   = document.getElementById('toggle-supa');
const supaIconShow = document.getElementById('supa-icon-show');
const supaIconHide = document.getElementById('supa-icon-hide');
const supaStatus   = document.getElementById('supa-status');

toggleSupa.addEventListener('click', () => {
  const isPassword = supaInput.type === 'password';
  supaInput.type = isPassword ? 'text' : 'password';
  supaIconShow.style.display = isPassword ? 'none' : '';
  supaIconHide.style.display = isPassword ? ''     : 'none';
});

saveSupaBtn.addEventListener('click', () => {
  const key = supaInput.value.trim();
  if (!key) { showSupaStatus('error', 'Enter your Supadata API key'); return; }
  chrome.storage.local.set({ supadataApiKey: key }, () => {
    showSupaStatus('success', '✓ Transcript key saved');
  });
});

supaInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') saveSupaBtn.click();
});

function showSupaStatus(type, message) {
  supaStatus.className = `status ${type}`;
  supaStatus.textContent = message;
}

// ─── Init ─────────────────────────────────────────────────────────────────────

chrome.storage.local.get(['provider', 'supadataApiKey'], result => {
  switchProvider(result.provider || 'deepseek');
  if (result.supadataApiKey) {
    supaInput.value = result.supadataApiKey;
    showSupaStatus('success', '✓ Transcript key saved');
  }
});

function showStatus(type, message) {
  statusEl.className = `status ${type}`;
  statusEl.textContent = message;
}
