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

test('buildGemViewModel exposes the activation cost at the selected level', () => {
  // The card shows a single level (default 20). Fireball's Mana cost is 104 at level 20,
  // and the per-level snapshot carries the whole 10 (lvl 1) → 629 (lvl 40) curve.
  const vm = buildGemViewModel('fireball');
  assert.equal(vm.cost, '104 Mana');
  assert.equal(vm.levelData[1].cost, '10 Mana');
  assert.equal(vm.levelData[40].cost, '629 Mana');
  // A pure-reservation gem (Herald of Ash) reserves Spirit and has no activation cost.
  const herald = buildGemViewModel('herald-of-ash');
  assert.equal(herald.cost, null);
  assert.equal(herald.reservation, '30 Spirit');
});

test('buildGemViewModel exposes a level selector with a per-level snapshot', () => {
  const vm = buildGemViewModel('fireball');
  assert.equal(vm.levelSelect, true);
  assert.equal(vm.level, 20); // default selection = the max-without-modifiers cap
  assert.equal(vm.levels[0], 1);
  assert.equal(vm.levels[vm.levels.length - 1], 40); // scales past the cap
  assert.equal(vm.levelRange, null); // range line replaced by the selector
  // Every selectable level has a rendered snapshot (cost / requirements / sections).
  for (const L of vm.levels) {
    assert.ok(vm.levelData[L], `level ${L} snapshot`);
    assert.ok(Array.isArray(vm.levelData[L].sections));
  }
  // Effect numbers scale with the level: fireball's base fire damage grows 1 → 40.
  const fireAt = (L) => vm.levelData[L].sections
    .flatMap((s) => s.lines).find((l) => /Fire.*Damage/.test(l));
  assert.notEqual(fireAt(1), fireAt(40));
  // A gem with no scaling (item-granted, constant) shows no selector.
  assert.equal(buildGemViewModel('abiding-hex').levelSelect, false);
});

test('buildGemViewModel renders the weapon requirement as a hoverable keyword', () => {
  const apr = buildGemViewModel('armour-piercing-rounds').weaponReq;
  assert.match(apr, /<span class="kw" data-keyword="Crossbow">Crossbows<\/span>/);
  assert.match(buildGemViewModel('rain-of-arrows').weaponReq, /data-keyword="Bow">Bows</);
  assert.equal(buildGemViewModel('fireball').weaponReq, null); // spell — no weapon needed
});

test('buildGemViewModel exposes a rendered per-level scaling table', () => {
  const vm = buildGemViewModel('fireball');
  const t = vm.levelTable;
  assert.ok(t, 'fireball should have a level table');
  // a cost column and the fire-damage stat column, headers rendered to HTML
  assert.ok(t.columns.some((c) => c.kind === 'cost' && c.headerHtml === 'Mana'));
  assert.ok(t.columns.some((c) => c.kind === 'stat' && /Fire.*Damage/.test(c.headerHtml)));
  // rows descending; level 20 flagged as the cap
  assert.ok(t.rows[0].level > t.rows[t.rows.length - 1].level);
  const cap = t.rows.find((r) => r.level === 20);
  assert.equal(cap.cap, true);
  // cells are per-column arrays of rendered HTML (numbers wrapped for scanning)
  assert.equal(cap.cells.length, t.columns.length);
  assert.ok(cap.cells.some((c) => /mod-value/.test(c)));
});

test('buildGemViewModel aggregates effect + quality across all granted skills', () => {
  // Artillery Ballista grants a deploy skill ("Ballista") AND a "Bolts" projectile
  // sub-skill that carries the Pins quality; the page must show both, not just the
  // first granted skill. (Section label uses the display name, not the raw id.)
  const vm = buildGemViewModel('artillery-ballista');
  const labels = vm.sections.map((s) => s.label);
  assert.ok(labels.includes('Ballista'), `expected Ballista section, got ${labels}`);
  assert.ok(labels.includes('Bolts'), `expected Bolts section (not raw id), got ${labels}`);
  const bolts = vm.sections.find((s) => s.label === 'Bolts');
  assert.ok(bolts.quality.some((q) => /Pins/.test(q) && /\(0—200\)/.test(q)),
    'Bolts quality (from the 2nd granted skill) should be shown');
});

test('buildGemViewModel merges every granted skill into one level table, captioned by skill', () => {
  // Ancestral Cry grants 3 skills: the Warcry (Mana scales) + Volcanic Steps and
  // Volcanic Eruption (each scales its Base Damage). The merged table must show all
  // three, with the two Base Damage columns captioned by their skill so they read apart.
  const vm = buildGemViewModel('ancestral-cry');
  const t = vm.levelTable;
  assert.ok(t, 'ancestral cry should have a merged level table');

  const mana = t.columns.find((c) => c.kind === 'cost' && c.headerHtml === 'Mana');
  assert.ok(mana, 'expected a Mana column');

  const dmgCols = t.columns.filter((c) => c.kind === 'damage');
  assert.equal(dmgCols.length, 2, 'two Base Damage columns (Volcanic Steps + Eruption)');
  assert.ok(dmgCols.every((c) => c.headerHtml === 'Base Damage'));
  const captions = dmgCols.map((c) => c.skill).sort();
  assert.deepEqual(captions, ['Volcanic Eruption', 'Volcanic Steps']);

  // Level-20 row carries all three values (cells align to columns by index).
  const cap = t.rows.find((r) => r.level === 20);
  const idxOf = (pred) => t.columns.findIndex(pred);
  const vsIdx = idxOf((c) => c.kind === 'damage' && c.skill === 'Volcanic Steps');
  const veIdx = idxOf((c) => c.kind === 'damage' && c.skill === 'Volcanic Eruption');
  const manaIdx = idxOf((c) => c === mana);
  assert.match(cap.cells[vsIdx], /245/);
  assert.match(cap.cells[veIdx], /211/);
  assert.match(cap.cells[manaIdx], /44/);
});

test('gems with no per-level variance and no level curve expose no level table', () => {
  // A support gem: no granted-skill scaling AND no Requires-Level curve (the GGPK
  // extraction covers active skill gems, not supports) → null (not shown).
  const vm = buildGemViewModel('abiding-hex');
  assert.equal(vm.levelTable, null);
});

test('level table includes Requires Level + attribute-requirement columns from the gem curve', () => {
  // Ancestral Cry is pure Strength (100%). The merged table must lead with the gem-wide
  // Requires Level and Str columns (from the GGPK reqLevels curve + verified formula),
  // matching poe2db exactly: L20 → Requires Level 90, Str 157; L1 → 0 / 4.
  const vm = buildGemViewModel('ancestral-cry');
  const t = vm.levelTable;
  const req = t.columns.find((c) => c.kind === 'req');
  const str = t.columns.find((c) => c.kind === 'attr' && c.headerHtml === 'Str');
  assert.ok(req && req.headerHtml === 'Requires Level', 'has a Requires Level column');
  assert.ok(str, 'has a Str column');
  assert.ok(!t.columns.some((c) => c.kind === 'attr' && /Dex|Int/.test(c.headerHtml)), 'no Dex/Int for a pure-Str gem');
  // Gem-wide columns come before the per-skill columns.
  assert.ok(t.columns.indexOf(req) < t.columns.findIndex((c) => c.kind === 'cost'), 'Requires Level precedes skill cost columns');

  const idx = (pred) => t.columns.findIndex(pred);
  const cap = t.rows.find((r) => r.level === 20);
  const l1 = t.rows.find((r) => r.level === 1);
  assert.match(cap.cells[idx((c) => c === req)], /90/);
  assert.match(cap.cells[idx((c) => c === str)], /157/);
  assert.match(l1.cells[idx((c) => c === req)], /\b0\b/);
  assert.match(l1.cells[idx((c) => c === str)], /\b4\b/);

  // Over-leveled rows (21..40, from skill scaling) HOLD the level-20 requirement —
  // a corrupted/over-leveled gem needs no more than its level-20 gate.
  const l40 = t.rows.find((r) => r.level === 40);
  assert.ok(l40, 'level 40 row exists (skills scale past 20)');
  assert.match(l40.cells[idx((c) => c === req)], /90/);
  assert.match(l40.cells[idx((c) => c === str)], /157/);
});

test('hybrid-attribute gems compute each attribute from its own percent (verified vs poe2db)', () => {
  // Time of Need is Str 75 / Int 25. At gem level 20 (Requires Level 90) poe2db shows
  // Str 122, Int 48 — the factor depends on each attribute's own percent, not the combo.
  const vm = buildGemViewModel('time-of-need');
  const t = vm.levelTable;
  const idx = (h) => t.columns.findIndex((c) => c.kind === 'attr' && c.headerHtml === h);
  const cap = t.rows.find((r) => r.level === 20);
  assert.match(cap.cells[idx('Str')], /122/);
  assert.match(cap.cells[idx('Int')], /48/);
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
  assert.equal(vm.levelSelect, true); // scaling gem → level selector, not a fixed range
  assert.equal(vm.level, 20);
  assert.equal(vm.reservation, '30 Spirit');
  assert.equal(vm.footer, 'Skills can be managed in the Skills Panel.');

  const labels = vm.sections.map((s) => s.label);
  assert.deepEqual(labels, ['Buff', 'Explosion']);
  // section lines are rendered to safe HTML (bracket tokens -> spans), at the selected
  // level (20): the Ignite-damage line shows its single level-20 value, not a range.
  assert.ok(vm.sections[1].lines.some((l) => /<span class="mod-value">23<\/span>% of/.test(l)));
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

test('buildGemViewModel emits requirements at the selected level (attributes when present)', () => {
  // Str/Dex/Int abbreviations are linked to their glossary keyword (safe HTML). With a
  // level selector the card shows the TRUE level-20 requirement, not the fixed range.
  const str = '<span class="kw" data-keyword="Strength">Str</span>';
  const dex = '<span class="kw" data-keyword="Dexterity">Dex</span>';
  assert.deepEqual(buildGemViewModel('herald-of-ash').requirements, ['Level 90', `157 ${str}`]);
  assert.deepEqual(buildGemViewModel('armour-piercing-rounds').requirements, ['Level 90', `86 ${str}`, `86 ${dex}`]);
  // all-zero attribute weights -> still shows the level requirement, no attribute line
  assert.deepEqual(buildGemViewModel('align-fate').requirements, ['Level 90']);
  // level 1 requirements come from the same per-level curve
  assert.deepEqual(buildGemViewModel('armour-piercing-rounds').levelData[1].requirements,
    ['Level 0', `4 ${str}`, `4 ${dex}`]);
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

test('interactive gem exposes quality input data and wraps range numbers in .qual-tok spans', () => {
  const vm = buildGemViewModel('arc');
  assert.equal(vm.hasQuality, true);
  assert.ok(vm.levelSelect, 'Arc has a level selector (interactive)');
  assert.ok(vm.qualitySeries?.q0?.length, 'series present for the quality column');

  const sec = vm.sections.find((s) => s.quality?.length || s.altQuality?.length);
  // Standard quality line → a span pointing at column q0, carrying its default range.
  const q = sec.quality.join('');
  assert.match(q, /<span class="qual-tok" data-col="q0" data-idx="0" data-range="\(0—2\)">\(0—2\)<\/span>/);
  // Gemling alt-quality line → mapped to the alt column q1.
  const alt = sec.altQuality.join('');
  assert.match(alt, /class="qual-tok" data-col="q1" data-idx="0" data-range="\(0—3\)"/);
});

test('a gem with no quality effects gates the input off (no series, no spans)', () => {
  const noQual = listGems()
    .map((g) => buildGemViewModel(g.slug))
    .find((vm) => vm && vm.hasQuality === false);
  assert.ok(noQual, 'expected at least one gem without quality effects');
  assert.equal(noQual.qualitySeries, null);
  const spans = noQual.sections.some((s) =>
    [...(s.quality || []), ...(s.altQuality || [])].join('').includes('qual-tok'));
  assert.ok(!spans, 'no .qual-tok spans when the gem has no quality');
});
