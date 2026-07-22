import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ddsUrl, imageRelPath, placeholder } from '../src/data/images.js';

test('ddsUrl builds a self-hosted webp url from a dds path', () => {
  assert.equal(
    ddsUrl('Art/2DArt/SkillIcons/4k/HeraldOfAshSkill.dds'),
    '/static/img/Art/2DArt/SkillIcons/4k/HeraldOfAshSkill.webp'
  );
});

test('imageRelPath maps a dds path to its mirrored webp file path', () => {
  assert.equal(
    imageRelPath('Art/2DArt/SkillIcons/4k/HeraldOfAshSkill.dds'),
    'Art/2DArt/SkillIcons/4k/HeraldOfAshSkill.webp'
  );
});

test('ddsUrl returns null for falsy input', () => {
  assert.equal(ddsUrl(null), null);
});

test('ddsUrl returns null for a malformed path with an empty basename', () => {
  // Lineage support gems' icon_dds_file is a bare directory in the source
  // data ("4k/") — resolving that would 404 (".../4k/.webp"); treat it as
  // no icon rather than emitting a broken URL.
  assert.equal(ddsUrl('4k/'), null);
  assert.equal(ddsUrl('Art/2DArt/SkillIcons/4k/'), null);
  assert.equal(ddsUrl('.dds'), null);
});

test('placeholder is deterministic for the same key', () => {
  const a = placeholder({ name: 'Herald of Ash', color: 'r' });
  const b = placeholder({ name: 'Herald of Ash', color: 'r' });
  assert.deepEqual(a, b);
  assert.equal(a.initials, 'HO');
});
