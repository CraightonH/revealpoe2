import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ddsUrl, placeholder } from '../src/data/images.js';

test('ddsUrl builds a ggpk webp url from a dds path', () => {
  assert.equal(
    ddsUrl('Art/2DArt/SkillIcons/4k/HeraldOfAshSkill.dds'),
    'https://image.ggpk.exposed/poe2/Art/2DArt/SkillIcons/4k/HeraldOfAshSkill.dds?format=webp'
  );
});

test('ddsUrl returns null for falsy input', () => {
  assert.equal(ddsUrl(null), null);
});

test('placeholder is deterministic for the same key', () => {
  const a = placeholder({ name: 'Herald of Ash', color: 'r' });
  const b = placeholder({ name: 'Herald of Ash', color: 'r' });
  assert.deepEqual(a, b);
  assert.equal(a.initials, 'HO');
});
