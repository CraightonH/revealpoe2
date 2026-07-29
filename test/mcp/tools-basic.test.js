import test from 'node:test';
import assert from 'node:assert/strict';
import { createFsBackend } from '../../src/mcp/backends/fs.js';
import { resolveRef, capList, summarizeByClass, err } from '../../src/mcp/tools/util.js';
import { schema } from '../../src/mcp/tools/schema.js';
import { find, explain } from '../../src/mcp/tools/find.js';
import { TOOLS } from '../../src/mcp/contract.js';

const b = createFsBackend();

test('resolveRef: slug hit, name hit, cross-kind slug collision -> ambiguous', async () => {
  const bySlug = await resolveRef(b, ['gem'], 'Fireball');
  assert.equal(bySlug.node.slug, 'fireball');
  // gem 'fireball' grants skill 'fireball' — the cross-kind collisions trap
  const collide = await resolveRef(b, ['gem', 'skill'], 'fireball');
  assert.ok(collide.ambiguous, 'cross-kind slug collision must be ambiguous, never first-kind-wins');
  const miss = await resolveRef(b, ['gem'], 'definitely not a gem');
  assert.ok(miss.notFound);
});

test('capList truncates and reports', () => {
  const c = capList([1, 2, 3], 2);
  assert.deepEqual(c, { items: [1, 2], truncated: true, total: 3 });
  assert.equal(capList([1], 5).truncated, false);
});

test('schema reports kinds, relations, budgets, hashes', async () => {
  const s = await schema(b, {});
  assert.equal(Object.keys(s.kinds).length, 12);
  assert.equal(s.relations.length, 11);
  assert.equal(s.budgets.passivePoints, 122);
  assert.equal(s.budgets.ascendancyPoints, 8);
  assert.ok(s.data.sourceHash);
});

test('find caps at limit and reports truncation', async () => {
  const r = await find(b, { description: 'fire', limit: 5 });
  assert.ok(r.results.length <= 5);
  assert.equal(typeof r.truncated, 'boolean');
  assert.ok(r.results.every((x) => x.kind && x.slug && x.name && !x.props), 'no props by default');
});

test('explain returns keyword definitions', async () => {
  const r = await explain(b, { term: 'Presence' });
  assert.ok(r.keywords?.length >= 1);
  assert.ok(r.keywords[0].definition);
  const miss = await explain(b, { term: 'zzz not a keyword zzz' });
  assert.equal(miss.error.code, 'not_found');
});

test('contract: every tool has name, description, zod shape, handler', () => {
  assert.ok(TOOLS.length >= 3); // grows to 12 by Task 9
  for (const t of TOOLS) {
    assert.ok(t.name && t.description && t.handler);
    assert.equal(typeof t.inputSchema, 'object');
  }
  assert.deepEqual([...new Set(TOOLS.map((t) => t.name))].length, TOOLS.length, 'unique names');
});
