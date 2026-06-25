import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getGem, buildGemViewModel, listGems, attributeRequirements, getRecommendedBy } from '../src/data/gems.js';

test('listGems returns active + support gems with slugs', () => {
  const gems = listGems();
  assert.ok(gems.length > 500);
  assert.ok(gems.every((g) => g.slug && g.name));
});

test('listGems excludes [DNT]/[DNT-UNUSED] unimplemented gems', () => {
  assert.ok(listGems().every((g) => !g.name.includes('[DNT')));
});

test('listGems excludes placeholder/dev gems (Coming Soon, Playtest, etc.)', () => {
  const names = new Set(listGems().map((g) => g.name));
  for (const n of ['Coming Soon', 'Removed Skill', 'Playtest Attack', 'Soul Crystal: {0}']) {
    assert.ok(!names.has(n), `${n} should be excluded`);
  }
});

test('listGems classifies origin: gem / item / other', () => {
  const gems = listGems();
  const origin = (name) => gems.find((g) => g.name === name)?.origin;
  // obtainable socketable gems
  assert.equal(origin('Herald of Ash'), 'gem');
  assert.equal(origin('Spark'), 'gem');
  // item-granted: unique-granted skill + weapon default attack
  assert.equal(origin('Bursting Fen Toad'), 'item');
  assert.equal(origin('Bow Shot'), 'item');
  // ascendancy/boss skills with no obtain method
  assert.equal(origin('Demon Form'), 'other');
  assert.equal(origin("Ruzhan's Fury"), 'other');
  // every shown gem carries a valid origin
  assert.ok(gems.every((g) => ['gem', 'item', 'other'].includes(g.origin)));
});

test('getGem resolves Herald of Ash by slug', () => {
  const gem = getGem('herald-of-ash');
  assert.equal(gem.base_item.display_name, 'Herald of Ash');
  assert.equal(gem.color, 'r');
});

test('buildGemViewModel produces card fields', () => {
  const vm = buildGemViewModel('herald-of-ash');
  assert.equal(vm.name, 'Herald of Ash');
  assert.equal(vm.attribute, 'r');
  assert.equal(vm.borderColor, 'rgba(139,48,48,0.7)');
  assert.ok(vm.skillIconUrl.includes('HeraldOfAshSkill'));
  assert.ok(vm.hoverImageUrl.includes('GemHoverImage'));
  assert.ok(vm.tags.some((t) => /data-keyword="Fire"/.test(t))); // tag is hoverable
  assert.match(vm.description, /<span class="kw"/); // tokens rendered
  assert.ok(vm.recommendedSupports.length > 0);
  assert.ok(vm.recommendedSupports[0].roman);
  assert.ok(vm.recommendedSupports[0].supports[0].slug);
});

test('getRecommendedSupports groups into ascending tiers by crafting_level', () => {
  // herald-of-ash has a populated recommendation list spanning multiple tiers.
  const vm = buildGemViewModel('herald-of-ash');
  const groups = vm.recommendedSupports;
  assert.ok(groups.length > 0, 'has recommended supports');
  // Tiers appear in ascending order; the "Other" (tier 0) bucket, if present,
  // is always last.
  const tiers = groups.map((g) => g.tier);
  const ordered = [...tiers].sort((a, b) => (a === 0) - (b === 0) || a - b);
  assert.deepEqual(tiers, ordered, 'tiers ascending with Other (0) last');
  for (const g of groups) {
    assert.ok(g.supports.length > 0, 'no empty tier groups');
    assert.equal(g.roman, { 1: 'I', 2: 'II', 3: 'III', 4: 'IV', 5: 'V' }[g.tier] ?? '—');
    // Every card in a 1–5 group must actually be that crafting level.
    if (g.tier >= 1 && g.tier <= 5) {
      for (const s of g.supports) {
        const sup = getGem(s.slug);
        assert.equal(sup.crafting_level, g.tier, `${s.slug} belongs in tier ${g.tier}`);
      }
    }
  }
});

test('getGem returns null for unknown slug', () => {
  assert.equal(getGem('not-a-real-gem'), null);
});

test('spirit gems are labeled Spirit in typeLine', () => {
  const vm = buildGemViewModel('fire-spell-on-hit');
  assert.ok(vm, 'fire-spell-on-hit gem should exist');
  assert.equal(vm.typeLine, 'Spirit');
});

test('buildGemViewModel emits rich card fields for Herald of Ash', () => {
  const vm = buildGemViewModel('herald-of-ash');
  assert.equal(vm.typeLine, 'Buff');
  // Tags are now rendered keyword HTML; verify the right display names appear in order.
  const tagTexts = vm.tags.map((t) => t.replace(/<[^>]+>/g, ''));
  assert.deepEqual(tagTexts, ['Persistent', 'AoE', 'Fire', 'Duration', 'Herald']);
  assert.equal(vm.tier, 4);
  assert.deepEqual(vm.levelRange, { min: 1, max: 20 });
  assert.equal(vm.reservation, '30 Spirit');
  assert.equal(vm.footer, 'Skills can be managed in the Skills Panel.');

  const labels = vm.sections.map((s) => s.label);
  assert.deepEqual(labels, ['Buff', 'Explosion']);
  // section lines are rendered to safe HTML (bracket tokens -> spans)
  assert.ok(vm.sections[1].lines.some((l) => /<span class="mod-value">\(16\.67—23\)<\/span>%/.test(l)));
  assert.ok(vm.sections[1].lines.some((l) => /<span class="kw"/.test(l)));
});

test('buildGemViewModel handles a support gem (no active skill)', () => {
  const vm = buildGemViewModel('abiding-hex');
  assert.ok(vm, 'abiding-hex should exist');
  assert.equal(vm.typeLine, 'Support');
  assert.equal(vm.footer, null);
  assert.equal(vm.description, null);
  assert.equal(vm.reservation, null);
  assert.equal(typeof vm.tier, 'number');
  assert.ok(Array.isArray(vm.sections)); // support skills still expose stat sections
});

test('grantedBy surfaces a unique whose grant lives on the live skill node (Mist Raven <- The Auspex)', () => {
  const vm = buildGemViewModel('mist-raven');
  assert.ok(vm.grantedBy.some((u) => u.name === 'The Auspex'), 'The Auspex should grant Mist Raven');
});

test('grantedBy surfaces variant-gated unique grants (His Vile Intrusion <- The Unborn Lich)', () => {
  // The Unborn Lich grants His Vile Intrusion only on {variant:5}; the builder
  // must edge grants from EVERY variant, not just the "current" one.
  const vm = buildGemViewModel('his-vile-intrusion');
  assert.ok(vm.grantedBy.some((u) => u.name === 'The Unborn Lich'), 'The Unborn Lich should grant His Vile Intrusion');
});

test('grantedBy renders the variant that grants the looked-up skill (The Unborn Lich -> His Vile Intrusion)', () => {
  // The Unborn Lich's default variant grants only Feast of Flesh; His Vile
  // Intrusion is granted by one specific variant. The reverse-lookup card must
  // render THAT variant, not the default, so the page isn't showing an item
  // that appears to grant a different skill.
  const vm = buildGemViewModel('his-vile-intrusion');
  const card = vm.grantedBy.find((u) => u.name === 'The Unborn Lich');
  assert.ok(card, 'The Unborn Lich present in Granted by');
  const grantedSkills = [...card.implicits, ...card.explicits]
    .map((s) => s.skillName)
    .filter(Boolean);
  assert.ok(
    grantedSkills.includes('His Vile Intrusion'),
    `card should render the variant granting His Vile Intrusion, got: ${grantedSkills.join(', ')}`,
  );
});

test('grantedByPassives surfaces ascendancy-notable grant sources (Inevitable Agony <- Inevitability)', () => {
  // Inevitability (Chronomancer notable) grants the Inevitable Agony gem node
  // directly — the reverse lookup must include non-unique sources.
  const vm = buildGemViewModel('inevitable-agony');
  assert.ok(
    vm.grantedByPassives.some((p) => p.name === 'Inevitability'),
    'Inevitability notable should grant Inevitable Agony',
  );
});

test('typeLine resolves a player-facing category, not an internal token', () => {
  // archmage's types[0] is the internal token "OngoingSkill"; the category is "Buff".
  assert.equal(buildGemViewModel('archmage').typeLine, 'Buff');
  // bloodhounds-mark: "Mark" is last in its types array, after several mechanic tokens.
  assert.equal(buildGemViewModel('bloodhounds-mark').typeLine, 'Mark');
  // totem skills are encoded as the verb "SummonsTotem" -> display "Totem".
  assert.equal(buildGemViewModel('shockwave-totem').typeLine, 'Totem');
  assert.equal(buildGemViewModel('raise-zombie').typeLine, 'Minion');
  assert.equal(buildGemViewModel('boneshatter').typeLine, 'Attack');
});

test('getRecommendedBy reverses recommends_support (supports only), sorted by name', () => {
  // Find the support recommended by the most skills (inbound recommends_support edges).
  const ranked = listGems()
    .map((g) => ({ g, by: getRecommendedBy(getGem(g.slug)) }))
    .filter((x) => x.by.length > 0)
    .sort((a, b) => b.by.length - a.by.length);
  assert.ok(ranked.length > 0, 'some gem has inbound recommends_support edges');

  const { by } = ranked[0];
  assert.ok(by.every((s) => s.slug && s.name && s.cardColor), 'entries carry browse-card fields');
  const names = by.map((s) => s.name);
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)), 'sorted by name');

  // The relationship is the exact inverse of the forward list: each recommender's
  // recommendedSupports must include this support's slug.
  const target = ranked[0].g.slug;
  const recommender = buildGemViewModel(by[0].slug);
  assert.ok(
    recommender.recommendedSupports.flatMap((g) => g.supports).some((s) => s.slug === target),
    'forward list of a recommender contains the support',
  );
});

test('active skill gems have an empty recommendedBy', () => {
  // recommends_support edges only point AT supports, so active skills get nothing.
  assert.deepEqual(buildGemViewModel('herald-of-ash').recommendedBy, []);
});

test('attributeRequirements splits the fixed range by weight', () => {
  assert.deepEqual(attributeRequirements({ strength: 100, dexterity: 0, intelligence: 0 }), ['(4—157) Str']);
  assert.deepEqual(attributeRequirements({ strength: 50, dexterity: 50, intelligence: 0 }), ['(2—79) Str', '(2—79) Dex']);
  assert.deepEqual(attributeRequirements({ strength: 0, dexterity: 0, intelligence: 100 }), ['(4—157) Int']);
});

test('attributeRequirements is empty for no/zero requirement', () => {
  assert.deepEqual(attributeRequirements({ strength: 0, dexterity: 0, intelligence: 0 }), []);
  assert.deepEqual(attributeRequirements(null), []);
});

test('buildGemViewModel emits requirements (level always, attributes when present)', () => {
  // Str/Dex/Int abbreviations are linked to their glossary keyword (safe HTML).
  const str = '<span class="kw" data-keyword="Strength">Str</span>';
  const dex = '<span class="kw" data-keyword="Dexterity">Dex</span>';
  assert.deepEqual(buildGemViewModel('herald-of-ash').requirements, ['Level (1—90)', `(4—157) ${str}`]);
  assert.deepEqual(buildGemViewModel('armour-piercing-rounds').requirements, ['Level (1—90)', `(2—79) ${str}`, `(2—79) ${dex}`]);
  // all-zero attribute weights -> still shows the level requirement, no attribute line
  assert.deepEqual(buildGemViewModel('align-fate').requirements, ['Level (1—90)']);
});

test('typeLine never leaks known internal mechanic tokens across active gems', () => {
  const banned = new Set([
    'OngoingSkill', 'HasReservation', 'CrossbowAmmoSkill', 'Trappable',
    'Totemable', 'Mineable', 'Triggerable', 'UsableWhileMoving', 'SummonsTotem',
  ]);
  const leaks = listGems()
    .filter((g) => g.gemType === 'active')
    .map((g) => buildGemViewModel(g.slug).typeLine)
    .filter((tl) => banned.has(tl));
  assert.deepEqual(leaks, [], `internal tokens leaked as type lines: ${[...new Set(leaks)].join(', ')}`);
});
