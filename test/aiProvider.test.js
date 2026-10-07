import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PRESETS,
  defaultSettings,
  normalizeBaseUrl,
  chatCompletionsUrl,
  modelsUrl,
  authHeaders,
} from '../public/js/ai-provider.js';

test('presets expose the local OpenAI-compatible endpoints', () => {
  assert.equal(PRESETS.ollama.baseUrl, 'http://localhost:11434/v1');
  assert.equal(PRESETS.lmstudio.baseUrl, 'http://localhost:1234/v1');
});

test('defaultSettings points at local Ollama with no key', () => {
  const s = defaultSettings();
  assert.equal(s.provider, 'ollama');
  assert.equal(s.baseUrl, PRESETS.ollama.baseUrl);
  assert.equal(s.model, '');
  assert.equal(s.apiKey, '');
});

test('normalizeBaseUrl trims whitespace and trailing slashes', () => {
  assert.equal(normalizeBaseUrl('http://localhost:11434/v1/'), 'http://localhost:11434/v1');
  assert.equal(normalizeBaseUrl('  http://x/v1// '), 'http://x/v1');
  assert.equal(normalizeBaseUrl(''), '');
});

test('endpoint builders append the right paths', () => {
  assert.equal(chatCompletionsUrl('http://localhost:11434/v1/'), 'http://localhost:11434/v1/chat/completions');
  assert.equal(modelsUrl('http://localhost:1234/v1'), 'http://localhost:1234/v1/models');
});

test('authHeaders omits Authorization when no key is set', () => {
  const bare = authHeaders('');
  assert.ok(!('Authorization' in bare), 'no Authorization header without a key');
  assert.equal(bare['Content-Type'], 'application/json');
  const withKey = authHeaders('sk-test');
  assert.equal(withKey['Authorization'], 'Bearer sk-test');
});
