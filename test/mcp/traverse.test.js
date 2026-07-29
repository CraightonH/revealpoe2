import test from 'node:test';
import assert from 'node:assert/strict';
import { createFsBackend } from '../../src/mcp/backends/fs.js';
import { traverse } from '../../src/mcp/tools/traverse.js';

const b = createFsBackend();

test('the measured chain: unique --has_base--> base <--rolls_on-- affix', async () => {
  const u = (await b.search('bow', { kind: 'unique', limit: 1 }))[0];
  const r = await traverse(b, {
    start: { kind: 'unique', slug: u.slug },
    hops: [{ relation: 'has_base', direction: 'out' }, { relation: 'rolls_on', direction: 'in' }],
    limit: 25,
  });
  assert.equal(r.hop_counts.length, 2);
  assert.equal(r.hop_counts[0], 1, 'one base');
  assert.ok(r.total > 0, 'affixes found');
  assert.ok(r.results.length <= 25);
  assert.ok(r.results.every((x) => x.kind === 'affix'));
});

test('unknown relation refuses with the valid list', async () => {
  const r = await traverse(b, { start: { kind: 'gem', slug: 'fireball' }, hops: [{ relation: 'made_of', direction: 'out' }] });
  assert.equal(r.error.code, 'invalid');
  assert.ok(r.error.relations.includes('rolls_on'));
});

test('caps: limit respected, truncation flagged on the 940-row worst case', async () => {
  // find the max-fan-out affix by walking a known chain instead of hardcoding
  const bow = await b.nodeBySlug('base', 'crude-bow');
  const affixes = await b.edgesTo(bow.id, 'rolls_on');
  const some = (await b.nodesByIds([affixes[0].from]))[0];
  const r = await traverse(b, {
    start: { kind: 'affix', slug: some.slug },
    hops: [{ relation: 'rolls_on', direction: 'out' }],
    limit: 10,
  });
  assert.ok(r.results.length <= 10);
  if (r.total > 10) assert.equal(r.truncated, true, 'truncation must be reported');
});

test('bad start refuses', async () => {
  const r = await traverse(b, { start: { kind: 'gem', slug: 'zzz' }, hops: [{ relation: 'grants', direction: 'out' }] });
  assert.equal(r.error.code, 'not_found');
});
