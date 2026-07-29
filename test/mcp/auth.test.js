import test from 'node:test';
import assert from 'node:assert/strict';
import { authorized } from '../../src/mcp/auth.js';

test('authorized: exact bearer match only, and refuses weak/unset secrets', () => {
  const token = 'a'.repeat(32);
  assert.equal(authorized(`Bearer ${token}`, token), true);
  assert.equal(authorized(`Bearer ${token}x`, token), false);
  assert.equal(authorized(token, token), false, 'scheme required');
  assert.equal(authorized(null, token), false);
  assert.equal(authorized('Bearer short', 'short'), false, 'a <16-char secret is a misconfiguration');
  assert.equal(authorized('Bearer undefined', undefined), false);
});
