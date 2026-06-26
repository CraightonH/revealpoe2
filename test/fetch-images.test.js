import { test } from 'node:test';
import assert from 'node:assert/strict';
import { syncGate } from '../scripts/fetch-images.js';

const dds = new Set(['Art/a.dds', 'Art/b.dds']);
const all = () => true;

test('syncGate.refHash is order-independent over the referenced set', () => {
  const a = syncGate({ dds, manifest: {}, exists: all, force: false });
  const b = syncGate({ dds: new Set(['Art/b.dds', 'Art/a.dds']), manifest: {}, exists: all, force: false });
  assert.equal(a.refHash, b.refHash);
});

test('skips when the referenced set matches and every file is on disk', () => {
  const { refHash } = syncGate({ dds, manifest: {}, exists: all, force: false });
  const gate = syncGate({ dds, manifest: { _refHash: refHash }, exists: all, force: false });
  assert.equal(gate.skip, true);
});

test('does not skip when the referenced set changed', () => {
  const { refHash } = syncGate({ dds, manifest: {}, exists: all, force: false });
  const grown = new Set([...dds, 'Art/c.dds']);
  assert.equal(syncGate({ dds: grown, manifest: { _refHash: refHash }, exists: all, force: false }).skip, false);
});

test('does not skip when a referenced file is missing on disk', () => {
  const { refHash } = syncGate({ dds, manifest: {}, exists: all, force: false });
  const missingB = (d) => d !== 'Art/b.dds';
  assert.equal(syncGate({ dds, manifest: { _refHash: refHash }, exists: missingB, force: false }).skip, false);
});

test('--force never skips', () => {
  const { refHash } = syncGate({ dds, manifest: {}, exists: all, force: false });
  assert.equal(syncGate({ dds, manifest: { _refHash: refHash }, exists: all, force: true }).skip, false);
});
