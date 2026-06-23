import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectBaseRecords } from '../../scripts/graph/bases.js';

test('selectBaseRecords keys bases by source id and resolves known slugs', () => {
  const { records } = selectBaseRecords();
  const byId = new Map(records.map((r) => [r.id, r]));
  const stellar = byId.get('Metadata/Items/Amulets/FourAmulet8');
  assert.ok(stellar, 'Stellar Amulet present');
  assert.equal(stellar.slug, 'stellar-amulet');
  assert.equal(stellar.itemClass, 'Amulet');
  assert.equal(stellar.raw.name, 'Stellar Amulet');
  assert.ok(records.every((r) => r.id.startsWith('Metadata/')), 'ids are source Metadata keys');
});

test('selectBaseRecords excludes rune variants from records and collects them', () => {
  const { records, runeRaw } = selectBaseRecords();
  assert.ok(!records.some((r) => /^Rune(forged|mastered) /.test(r.raw.name)), 'no rune variants in records');
  assert.ok(runeRaw.length > 0, 'rune variants collected separately');
  assert.ok(runeRaw.every((v) => /^Rune(forged|mastered) /.test(v.name)));
});

test('selectBaseRecords disambiguates a name spanning multiple classes', () => {
  const { records } = selectBaseRecords();
  const slugs = new Set(records.map((r) => r.slug));
  // "Energy Blade" exists as both One Hand Sword and Two Hand Sword → class-suffixed.
  assert.ok(slugs.has('energy-blade--one-hand-sword'));
  assert.ok(slugs.has('energy-blade--two-hand-sword'));
  assert.ok(!slugs.has('energy-blade'), 'undisambiguated slug must not exist');
});
