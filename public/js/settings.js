// Site settings popup: gear button in the global header opens an overlay with a
// sidebar of settings tabs. Only the AI tab exists for now; the sidebar is
// there so future tabs (display, data, …) slot in without restructuring.
import { PRESETS, defaultSettings, getAISettings, saveAISettings, testConnection } from '/static/js/ai-provider.js';

let overlay = null;

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

const TABS = [{ id: 'ai', label: 'AI' }];

function aiTabHtml(s) {
  const presetOptions = Object.entries(PRESETS).map(([id, p]) =>
    `<option value="${id}"${s.provider === id ? ' selected' : ''}>${esc(p.label)}</option>`).join('');
  return `
    <p class="settings-lead">Point the site at an OpenAI-compatible chat endpoint. Use a local
      model while developing — it costs nothing and the page talks to your machine directly —
      then swap the base URL to a hosted provider later without changing anything else.</p>
    <div class="settings-field">
      <label for="ai-provider">Provider</label>
      <select id="ai-provider" class="settings-input">${presetOptions}</select>
    </div>
    <div class="settings-field">
      <label for="ai-base-url">Base URL</label>
      <input id="ai-base-url" class="settings-input" type="url" spellcheck="false"
             value="${esc(s.baseUrl)}" placeholder="http://localhost:11434/v1">
    </div>
    <div class="settings-field">
      <label for="ai-model">Model</label>
      <input id="ai-model" class="settings-input" type="text" spellcheck="false"
             value="${esc(s.model)}" placeholder="qwen2.5:7b">
      <p class="settings-hint">The model name as the server knows it (<em>Test connection</em> lists what's loaded).</p>
    </div>
    <div class="settings-field">
      <label for="ai-key">API key <span class="settings-optional">(optional)</span></label>
      <input id="ai-key" class="settings-input" type="password" autocomplete="off"
             value="${esc(s.apiKey)}" placeholder="local servers usually need none">
      <p class="settings-hint">Stored only in this browser's localStorage and sent only to the base URL above.</p>
    </div>
    <div class="settings-actions">
      <button type="button" class="settings-btn-action" data-act="save">Save</button>
      <button type="button" class="settings-btn-action" data-act="test">Test connection</button>
      <span class="settings-status" role="status" aria-live="polite"></span>
    </div>
    <div class="settings-help">
      <h3>Connecting a local LLM</h3>
      <h4>Ollama</h4>
      <ol>
        <li>Pull a chat model: <code>ollama pull qwen2.5:7b</code></li>
        <li>Allow browser access before starting it:
          <code>OLLAMA_ORIGINS="*" ollama serve</code>
          <span class="settings-hint">(use your site's origin instead of <code>*</code> outside dev)</span></li>
        <li>Base URL <code>http://localhost:11434/v1</code>, model <code>qwen2.5:7b</code>, no API key.</li>
      </ol>
      <h4>LM Studio</h4>
      <ol>
        <li>Load a model, open the <em>Local Server</em> tab, and start the server.</li>
        <li>Enable <em>CORS</em> in the server settings.</li>
        <li>Base URL <code>http://localhost:1234/v1</code>, model = the loaded model id, no API key.</li>
      </ol>
      <p class="settings-hint">This only works on the machine running the model — a page can't reach
        another device's <code>localhost</code>. Nothing you type here leaves your computer while
        pointed at a local server.</p>
    </div>`;
}

function openSettings(tabId = 'ai') {
  closeSettings();
  const s = getAISettings();
  const active = TABS.some((t) => t.id === tabId) ? tabId : 'ai';

  overlay = document.createElement('div');
  overlay.className = 'settings-overlay';
  overlay.innerHTML = `
    <div class="settings-scrim"></div>
    <div class="settings-panel" role="dialog" aria-modal="true" aria-label="Settings">
      <header class="settings-head"><h2>Settings</h2>
        <button class="settings-close" type="button" aria-label="Close settings">×</button></header>
      <div class="settings-body">
        <nav class="settings-nav" aria-label="Settings sections">
          ${TABS.map((t) => `<button type="button" data-tab="${t.id}"${t.id === active ? ' aria-current="true"' : ''}>${esc(t.label)}</button>`).join('')}
        </nav>
        <section class="settings-content" data-content></section>
      </div>
    </div>`;
  document.body.append(overlay);
  document.addEventListener('keydown', onKey);

  const content = overlay.querySelector('[data-content]');
  function renderTab(id) {
    overlay.querySelectorAll('.settings-nav button').forEach((b) => {
      const on = b.getAttribute('data-tab') === id;
      if (on) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
    });
    content.innerHTML = id === 'ai' ? aiTabHtml(getAISettings()) : '';
    setStatus('');
  }
  renderTab(active);

  function setStatus(text, ok) {
    const el = overlay.querySelector('.settings-status');
    if (!el) return;
    el.textContent = text;
    el.classList.toggle('ok', !!ok && !!text);
    el.classList.toggle('err', ok === false && !!text);
  }

  function readForm() {
    return {
      provider: overlay.querySelector('#ai-provider').value,
      baseUrl: overlay.querySelector('#ai-base-url').value.trim(),
      model: overlay.querySelector('#ai-model').value.trim(),
      apiKey: overlay.querySelector('#ai-key').value,
    };
  }

  overlay.addEventListener('click', async (e) => {
    if (e.target.closest('.settings-scrim') || e.target.closest('.settings-close')) { closeSettings(); return; }
    const tabBtn = e.target.closest('.settings-nav button[data-tab]');
    if (tabBtn) { renderTab(tabBtn.getAttribute('data-tab')); return; }
    const act = e.target.closest('[data-act]');
    if (!act) return;
    const form = readForm();
    if (act.getAttribute('data-act') === 'save') {
      saveAISettings(form);
      setStatus('Saved.', true);
      return;
    }
    // Test against the form values (not just saved ones) so it works pre-save.
    setStatus('Connecting…');
    try {
      const { models } = await testConnection(form);
      setStatus(models.length ? `Connected — ${models.length} model${models.length === 1 ? '' : 's'}: ${models.slice(0, 6).join(', ')}${models.length > 6 ? '…' : ''}` : 'Connected — no models listed.', true);
    } catch (err) {
      setStatus(err.message, false);
    }
  });

  overlay.querySelector('#ai-provider').addEventListener('change', (e) => {
    const preset = PRESETS[e.target.value];
    if (preset && preset.baseUrl) overlay.querySelector('#ai-base-url').value = preset.baseUrl;
  });

  overlay.querySelector('.settings-close').focus();
}

function onKey(e) { if (e.key === 'Escape') closeSettings(); }

export function closeSettings() {
  if (!overlay) return;
  overlay.remove();
  overlay = null;
  document.removeEventListener('keydown', onKey);
}

// The gear button lives in the server-rendered global header; delegate so this
// works no matter which page (and which header variant) rendered it.
document.addEventListener('click', (e) => {
  const btn = e.target.closest && e.target.closest('#site-settings-btn');
  if (!btn) return;
  e.preventDefault();
  if (overlay) closeSettings(); else openSettings('ai');
});
