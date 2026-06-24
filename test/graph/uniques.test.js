import { test } from 'node:test';
import assert from 'node:assert/strict';
import { grantedSkillNames } from '../../scripts/graph/uniques.js';

test('grantedSkillNames is a non-empty Set of skill display names', () => {
  const names = grantedSkillNames();
  assert.ok(names instanceof Set);
  assert.ok(names.size > 50, `expected many granted skills, got ${names.size}`);
  // Guiding Palm grants "Purity of Fire" (a Level (1-20) grant — stripped to the bare name).
  assert.ok(names.has('Purity of Fire'), 'contains a known unique-granted skill');
});
