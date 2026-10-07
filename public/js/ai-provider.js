// AI provider plumbing for the site's AI features.
//
// Speaks plain OpenAI-compatible `/v1/chat/completions` so Ollama, LM Studio,
// or any OpenAI-style endpoint works unchanged — only the base URL differs
// between local dev and a hosted provider. The browser talks directly to the
// configured endpoint; nothing is proxied through this site's backend.

export const PRESETS = {
  ollama: { label: 'Ollama (local)', baseUrl: 'http://localhost:11434/v1' },
  lmstudio: { label: 'LM Studio (local)', baseUrl: 'http://localhost:1234/v1' },
  custom: { label: 'Custom (OpenAI-compatible)', baseUrl: '' },
};

const STORE_KEY = 'reveal.ai';

export function defaultSettings() {
  return { provider: 'ollama', baseUrl: PRESETS.ollama.baseUrl, model: '', apiKey: '' };
}

export function getAISettings() {
  const merged = { ...defaultSettings() };
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return merged;
    const parsed = JSON.parse(raw);
    for (const k of Object.keys(merged)) {
      if (typeof parsed[k] === 'string') merged[k] = parsed[k];
    }
  } catch (e) { /* corrupted or unavailable storage: fall back to defaults */ }
  return merged;
}

export function saveAISettings(settings) {
  const merged = { ...defaultSettings(), ...settings };
  const slim = { provider: merged.provider, baseUrl: merged.baseUrl, model: merged.model, apiKey: merged.apiKey };
  try { localStorage.setItem(STORE_KEY, JSON.stringify(slim)); } catch (e) {}
  return slim;
}

export function normalizeBaseUrl(url) {
  return String(url || '').trim().replace(/\/+$/, '');
}

export function chatCompletionsUrl(baseUrl) {
  return normalizeBaseUrl(baseUrl) + '/chat/completions';
}

export function modelsUrl(baseUrl) {
  return normalizeBaseUrl(baseUrl) + '/models';
}

export function authHeaders(apiKey) {
  const headers = { 'Content-Type': 'application/json' };
  const key = String(apiKey || '').trim();
  if (key) headers['Authorization'] = 'Bearer ' + key;
  return headers;
}

function describeSettings(s) {
  if (!normalizeBaseUrl(s.baseUrl)) throw new Error('AI base URL is not set — open Settings → AI.');
  if (!String(s.model || '').trim()) throw new Error('AI model is not set — open Settings → AI.');
}

/**
 * POST an OpenAI-style chat completion. `messages` is the standard
 * [{role, content}] array; extra body fields (temperature, etc.) via opts.
 * Returns the parsed JSON response; throws a readable Error on failure.
 */
export async function chatCompletion(messages, { settings, ...body } = {}) {
  const s = { ...defaultSettings(), ...(settings || getAISettings()) };
  describeSettings(s);
  let res;
  try {
    res = await fetch(chatCompletionsUrl(s.baseUrl), {
      method: 'POST',
      headers: authHeaders(s.apiKey),
      body: JSON.stringify({ model: s.model.trim(), messages, ...body }),
    });
  } catch (e) {
    throw new Error(
      'Could not reach the AI endpoint at ' + normalizeBaseUrl(s.baseUrl) +
      '. Is the server running, and does it allow this page\'s origin (Ollama: OLLAMA_ORIGINS; LM Studio: enable CORS)?'
    );
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error('AI request failed (' + res.status + '): ' + text.slice(0, 200));
  }
  return res.json();
}

/**
 * GET /v1/models to verify the endpoint is reachable and list model ids.
 * Returns { models: string[] }. Throws a readable Error on failure.
 */
export async function testConnection(settings) {
  const s = { ...defaultSettings(), ...(settings || getAISettings()) };
  const base = normalizeBaseUrl(s.baseUrl);
  if (!base) throw new Error('Set a base URL first.');
  let res;
  try {
    res = await fetch(modelsUrl(base), { headers: authHeaders(s.apiKey) });
  } catch (e) {
    throw new Error(
      'Could not reach ' + base + '. Start the server and allow this page\'s origin ' +
      '(Ollama: OLLAMA_ORIGINS; LM Studio: enable CORS in the Local Server settings).'
    );
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error('Endpoint answered with ' + res.status + ': ' + text.slice(0, 200));
  }
  const json = await res.json().catch(() => ({}));
  const models = Array.isArray(json.data) ? json.data.map((m) => m.id).filter(Boolean) : [];
  return { models };
}
