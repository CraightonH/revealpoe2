// Floating AI chat dock (lower-right, above page content).
//
// An iteration rig, not a finished feature: the point is to make it trivial to
// play with the assistant and dial the context it receives. Context is
// assembled from registered providers — add more via registerContextProvider.
// The exact context sent with the last message is inspectable in the panel,
// and every reply reports its token usage, so prompt/context cost is visible.
//
// Built-in context:
//   - page: always attached (document title + path)
//   - picked items: Ctrl+Alt+Click any element carrying data-card-url (gems,
//     uniques, bases, passives, augments). The card fragment is fetched and
//     stripped to text, so the model sees the item's actual stats.
import { getAISettings, chatCompletion } from '/static/js/ai-provider.js';

const CARD_RE = /^\/(gem|unique|base|augment|notable|passive|keystone)\/([^/]+)\/card\/?$/;
const CARD_TEXT_CAP = 1500;
const HISTORY_CAP = 40;

const providers = new Map();
export function registerContextProvider(name, fn) { providers.set(name, fn); }
export function unregisterContextProvider(name) { providers.delete(name); }

registerContextProvider('page', () => [{
  id: 'page',
  label: 'Page',
  text: `${document.title} (${location.pathname}${location.search})`,
}]);

let picked = []; // [{id, label, text}] from Ctrl+Alt+Click
let seq = 0;

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function stripHtml(html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  return (tmp.textContent || '').replace(/\s+/g, ' ').trim();
}

function collectContext() {
  const out = [];
  for (const [, fn] of providers) {
    try {
      const items = fn() || [];
      for (const it of items) out.push(it);
    } catch (e) { /* a broken provider must not break the chat */ }
  }
  return out.concat(picked);
}

function systemPrompt(context) {
  const lines = context.map((c) => `[${c.label}] ${c.text}`);
  return 'You are a Path of Exile 2 build assistant on the Reveal wiki. ' +
    'Answer concisely and concretely; cite item/passive names when you use them. ' +
    'If the context lacks what you need, say so instead of guessing.\n\n' +
    'Context:\n' + lines.join('\n');
}

// ---------- item picking (Ctrl+Alt+LeftClick) ----------

function flash(el) {
  el.classList.add('ai-pick-flash');
  setTimeout(() => el.classList.remove('ai-pick-flash'), 600);
}

async function pickFromEvent(e) {
  const target = e.target.closest && e.target.closest('[data-card-url]');
  if (!target) { toast('No item under cursor — Ctrl+Alt+Click a card, link, or tooltip target.'); return; }
  const cardUrl = target.getAttribute('data-card-url');
  const m = CARD_RE.exec(cardUrl || '');
  if (!m) return;
  flash(target);
  const name = (target.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80) || `${m[1]} ${m[2]}`;
  let detail = '';
  try {
    const res = await fetch(cardUrl);
    if (res.ok) detail = stripHtml(await res.text()).slice(0, CARD_TEXT_CAP);
  } catch (err) { /* card fetch failed; still attach the reference */ }
  picked.push({
    id: 'pick-' + (++seq),
    label: name,
    text: `Item: ${name} (${m[1]}/${m[2]})${detail ? '\n' + detail : ''} [${cardUrl}]`,
  });
  renderChips();
  toast(`Attached: ${name}`);
}

document.addEventListener('click', (e) => {
  if (!(e.ctrlKey && e.altKey)) return;
  if (dock && dock.contains(e.target)) return; // let the chat itself behave normally
  e.preventDefault();
  e.stopPropagation();
  pickFromEvent(e);
}, true);

// ---------- dock UI ----------

let dock = null;
let history = []; // [{role, content}]
let lastSentContext = '';

function toast(msg) {
  if (!dock) return;
  const el = dock.querySelector('.ai-toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('show'), 2200);
}

function renderChips() {
  const row = dock.querySelector('.ai-chips');
  const ctx = collectContext();
  row.innerHTML = ctx.map((c) =>
    `<span class="ai-chip" title="${esc(c.text.slice(0, 300))}">${esc(c.label)}` +
    (c.id !== 'page' ? `<button type="button" data-unpick="${c.id}" aria-label="Remove ${esc(c.label)}">×</button>` : '') +
    `</span>`).join('');
}

function appendMessage(role, text, usage) {
  const log = dock.querySelector('.ai-log');
  const div = document.createElement('div');
  div.className = 'ai-msg ai-msg--' + role;
  div.innerHTML = `<div class="ai-bubble">${esc(text)}</div>` +
    (usage ? `<div class="ai-usage">▲ ${usage.prompt_tokens ?? '?'} ▽ ${usage.completion_tokens ?? '?'} tokens</div>` : '');
  log.append(div);
  log.scrollTop = log.scrollHeight;
  history.push({ role, content: text });
  if (history.length > HISTORY_CAP) history = history.slice(-HISTORY_CAP);
}

async function send() {
  const input = dock.querySelector('.ai-input');
  const text = input.value.trim();
  if (!text) return;
  const settings = getAISettings();
  if (!settings.baseUrl || !settings.model) {
    appendMessage('assistant', 'No AI endpoint configured yet — open Settings (gear, top right) → AI and point it at a local model.');
    return;
  }
  input.value = '';
  const prior = history.map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }));
  appendMessage('user', text);
  const context = collectContext();
  lastSentContext = systemPrompt(context);
  dock.querySelector('.ai-context-view').textContent = lastSentContext;
  const thinking = document.createElement('div');
  thinking.className = 'ai-msg ai-msg--assistant';
  thinking.innerHTML = '<div class="ai-bubble ai-thinking">…</div>';
  const log = dock.querySelector('.ai-log');
  log.append(thinking);
  log.scrollTop = log.scrollHeight;
  try {
    const res = await chatCompletion(
      [{ role: 'system', content: lastSentContext },
       ...prior,
       { role: 'user', content: text }],
      { settings }
    );
    thinking.remove();
    const reply = res.choices && res.choices[0] && res.choices[0].message
      ? res.choices[0].message.content : '(empty response)';
    appendMessage('assistant', reply, res.usage);
  } catch (err) {
    thinking.remove();
    appendMessage('assistant', 'Error: ' + err.message);
  }
}

function toggleDock(force) {
  if (!dock) buildDock();
  const show = force !== undefined ? force : dock.hidden;
  dock.hidden = !show;
  if (show) {
    renderChips();
    dock.querySelector('.ai-input').focus();
  }
}

function buildDock() {
  dock = document.createElement('div');
  dock.className = 'ai-dock';
  dock.hidden = true;
  dock.innerHTML = `
    <div class="ai-toast" role="status"></div>
    <header class="ai-head">
      <span>Assistant</span>
      <span class="ai-head-actions">
        <button type="button" data-ai="ctx" title="Show the exact context sent with the last message">context</button>
        <button type="button" data-ai="close" aria-label="Close chat">×</button>
      </span>
    </header>
    <div class="ai-chips" aria-label="Attached context"></div>
    <div class="ai-log" aria-live="polite"></div>
    <pre class="ai-context-view" hidden></pre>
    <div class="ai-compose">
      <input class="ai-input" type="text" placeholder="Ask about your build… (Ctrl+Alt+Click an item to attach it)" autocomplete="off">
      <button type="button" data-ai="send" aria-label="Send">➤</button>
    </div>`;
  document.body.append(dock);

  dock.addEventListener('click', (e) => {
    const unpick = e.target.closest('[data-unpick]');
    if (unpick) {
      picked = picked.filter((p) => p.id !== unpick.getAttribute('data-unpick'));
      renderChips();
      return;
    }
    const act = e.target.closest('[data-ai]');
    if (!act) return;
    const what = act.getAttribute('data-ai');
    if (what === 'close') toggleDock(false);
    else if (what === 'send') send();
    else if (what === 'ctx') {
      const view = dock.querySelector('.ai-context-view');
      view.hidden = !view.hidden;
      if (!view.hidden && !view.textContent) view.textContent = systemPrompt(collectContext());
    }
  });
  dock.querySelector('.ai-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') send();
    if (e.key === 'Escape') toggleDock(false);
  });
}

function buildFab() {
  const fab = document.createElement('button');
  fab.type = 'button';
  fab.className = 'ai-fab';
  fab.title = 'AI assistant';
  fab.setAttribute('aria-label', 'Open AI assistant');
  fab.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 3h12v8H8l-3.5 3v-3H2z"/><path d="M5 6.5h6M5 8.5h3.5"/></svg>';
  fab.addEventListener('click', () => toggleDock());
  document.body.append(fab);
}

buildFab();
