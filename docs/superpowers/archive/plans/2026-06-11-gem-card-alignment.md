# Gem Card Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the rendered `/gem/:slug` card to content-parity with `docs/ui/skill-gem-card.html` — correct type line, display-name tags, Tier, level range, reservation, and the multi-section stat blocks (Buff / Explosion) with per-level value ranges, quality mods, and the footer line — driven entirely by data.

**Architecture:** Two new thin data modules — `gemTags.js` (tag-id → display name) and `statText.js` (the section/line/range engine that turns a granted skill's `stat_sets` into renderable sections). `buildGemViewModel` in `gems.js` is extended to consume them and emit a richer view-model. The `gem-card.njk` macro is rewritten to render the properties block, the sections, quality mods, and footer. CSS classes for all of these were already ported in the foundation (`property`, `requirements`, `hybridHeader`, `TitleBar`, `explicitMod`, `qualityMod`, `secondaryQualityMod`, `quality-text`, `default.fst-italic`).

**Tech Stack:** Node.js (ESM), `node:test` + Supertest, Nunjucks. No new dependencies.

**Data facts (verified against `$POE2DATADIR/data/repoe-poe2/`, Herald of Ash):**
- Granted skill key: `gem.grants_skills[0]` → record in `skills.json` (e.g. `HeraldOfAshPlayer`).
- Type line: `skill.active_skill.types[0]` → `"Buff"`.
- Tags: `gem.tags[]` mapped through `gem_tags.json`; values are `"[Display]"`, `"[Id|Display]"`, or `null`. `null` = not a display tag (drop it). Display = text after `|` if present, else bracket contents.
- Tier: `gem.crafting_level` → `4`.
- Reservation: `skill.static.reservations` → `{ "spirit": 30 }`.
- Sections: `skill.stat_sets[]`, each has `label[0]` (section header, e.g. `"Buff"`, `"Explosion"`), `static.tooltip_order[]` (ordered stat keys), `static.stat_text{}` (pre-rendered constant lines), `static.quality_stats[]`, and `per_level{}` (levels `"1".."40"`; entries may have `stat_text{}` + `stats[]`).
- Constant lines: `static.stat_text[key]` is already human-readable (e.g. `"Explosion radius is 1.2 metres"`). Empty-string values are skipped.
- Scaling lines: `per_level[lvl].stat_text[key]` is pre-rendered per level (e.g. lvl1 `"Base [Ignite] damage is 16.67% of [Overkill] damage"`, lvl20 `"...23%..."`). A range line is built by diffing the numbers between the lowest and highest displayed level.
- Display level cap: 20 (per_level data may extend to 40).
- `[Token]` / `[Id|Display]` bracket tokens inside stat text are already handled by `renderGameText` (Task 5 of the foundation).

**Deliberate omissions (data gaps — flag, do not fabricate):**
- Numeric `Requires: Level (1—90), (4—157) Str` — no requirements table in the dataset.
- Weapon line `Any Martial Weapon` — `crafting_types` conflates weapon classes (`Mace`) with non-weapon affinities (`Primal`, `Elemental`, `Occult`), so a faithful "Martial Weapon" category is not derivable.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `src/data/gemTags.js` | `tagDisplay(id)` and `displayTags(tags, exclude)` — tag-id → display name via `gem_tags.json` |
| `src/data/statText.js` | `rangeMerge(a,b)`, `resolveQuality(qstat)`, `buildSections(skill, maxLevel)` — section/line/range engine |
| `src/data/gems.js` (modify) | Extend `buildGemViewModel` to emit `typeLine`, `tags`, `tier`, `levelRange`, `reservation`, `sections`, `footer` |
| `views/macros/gem-card.njk` (modify) | Render properties block, sections, quality mods, footer |
| `public/css/gem-card.css` (modify, only if a class is missing) | Add `.colourDefault` if not already present |
| `test/gemTags.test.js`, `test/statText.test.js`, `test/gems.test.js` (modify), `test/render.test.js` (modify) | Tests |

---

## Task 1: Tag display-name resolver

**Files:**
- Create: `src/data/gemTags.js`
- Test: `test/gemTags.test.js`

- [ ] **Step 1: Write the failing test**

Create `test/gemTags.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tagDisplay, displayTags } from '../src/data/gemTags.js';

test('tagDisplay extracts plain bracket display', () => {
  assert.equal(tagDisplay('fire'), 'Fire');
});

test('tagDisplay uses text after pipe', () => {
  assert.equal(tagDisplay('area'), 'AoE');
  assert.equal(tagDisplay('duration'), 'Duration');
});

test('tagDisplay returns null for non-display tags', () => {
  assert.equal(tagDisplay('strength'), null);
  assert.equal(tagDisplay('grants_active_skill'), null);
});

test('displayTags maps, drops nulls, and excludes given names', () => {
  const tags = ['strength', 'grants_active_skill', 'buff', 'persistent', 'area', 'fire', 'duration', 'herald'];
  assert.deepEqual(
    displayTags(tags, ['Buff']),
    ['Persistent', 'AoE', 'Fire', 'Duration', 'Herald']
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/gemTags.test.js`
Expected: FAIL — cannot find module `../src/data/gemTags.js`.

- [ ] **Step 3: Create `src/data/gemTags.js`**

```js
import { loadJson } from './loader.js';

const REPOE = 'repoe-poe2';

// gem_tags.json maps a tag id to "[Display]", "[Id|Display]", or null.
// Returns the human display name, or null if the tag has no display form.
export function tagDisplay(id) {
  const map = loadJson(`${REPOE}/gem_tags.json`);
  const raw = map[id];
  if (!raw) return null;
  const inner = raw.replace(/^\[/, '').replace(/\]$/, '');
  const pipe = inner.indexOf('|');
  return pipe === -1 ? inner : inner.slice(pipe + 1);
}

// Map a list of tag ids to display names, dropping non-display tags and any
// display name present in `exclude` (e.g. the one already shown as the type line).
export function displayTags(tags, exclude = []) {
  const skip = new Set(exclude);
  const out = [];
  for (const id of tags ?? []) {
    const d = tagDisplay(id);
    if (d && !skip.has(d)) out.push(d);
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/gemTags.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/data/gemTags.js test/gemTags.test.js
git commit -m "feat: gem tag display-name resolver"
```

---

## Task 2: Stat-text section/range engine

Turns a granted skill record into renderable sections. Each section = `{ label, lines, quality }`, where `lines` is an array of pre-rendered stat strings (constants and per-level ranges) and `quality` is an array of best-effort quality strings.

**Range merge:** given two stat strings that differ only in numbers (lowest vs highest level), produce one string with `(min—max)` in place of each differing number. The em dash is `—` (U+2014).

**Quality guard:** `resolveQuality` resolves a `quality_stats` template's single `{stat_id/handler}` placeholder to `(0—N)` using a small handler table. If the resolved value is a percentage that exceeds 100 (implausible for a quality bonus), return `null` so the caller omits it rather than shipping a wrong number.

**Files:**
- Create: `src/data/statText.js`
- Test: `test/statText.test.js`

- [ ] **Step 1: Write the failing test**

Create `test/statText.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rangeMerge, resolveQuality, buildSections } from '../src/data/statText.js';
import { loadJson } from '../src/data/loader.js';

test('rangeMerge combines differing numbers into a range', () => {
  assert.equal(
    rangeMerge(
      'Base [Ignite] damage is 16.67% of [Overkill] damage',
      'Base [Ignite] damage is 23% of [Overkill] damage'
    ),
    'Base [Ignite] damage is (16.67—23)% of [Overkill] damage'
  );
});

test('rangeMerge returns the string unchanged when numbers match', () => {
  assert.equal(rangeMerge('Explosion radius is 1.2 metres', 'Explosion radius is 1.2 metres'),
    'Explosion radius is 1.2 metres');
});

test('resolveQuality drops implausible percentage values', () => {
  // per_minute_to_per_second_2dp divides by 60 -> 15000/60 = 250 (>100) -> null
  const q = {
    stat: 'An additional {x/per_minute_to_per_second_2dp_if_required}% of [Overkill] damage',
    stats: { x: 15000 },
  };
  assert.equal(resolveQuality(q), null);
});

test('resolveQuality renders a plausible range', () => {
  const q = {
    stat: '{q/divide_by_ten_1dp_if_required}% increased [Fire] damage',
    stats: { q: 200 }, // 200/10 = 20 -> plausible
  };
  assert.equal(resolveQuality(q), '(0—20)% increased [Fire] damage');
});

test('buildSections produces Buff and Explosion sections for Herald of Ash', () => {
  const gems = loadJson('repoe-poe2/skill_gems.json');
  const gem = Object.values(gems).find((g) => g.base_item?.display_name === 'Herald of Ash');
  const skills = loadJson('repoe-poe2/skills.json');
  const skill = skills[gem.grants_skills[0]];
  const sections = buildSections(skill, 20);

  const labels = sections.map((s) => s.label);
  assert.deepEqual(labels, ['Buff', 'Explosion']);

  const buff = sections[0];
  assert.ok(buff.lines.some((l) => /Overkill damage is at least 20%/.test(l)));

  const expl = sections[1];
  assert.ok(expl.lines.some((l) => l === 'Explosion radius is 1.2 metres'));
  assert.ok(expl.lines.some((l) => /\[Ignite\] duration is 3 seconds/.test(l)));
  assert.ok(expl.lines.some((l) => /\(16\.67—23\)%/.test(l))); // per-level range
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/statText.test.js`
Expected: FAIL — cannot find module `../src/data/statText.js`.

- [ ] **Step 3: Create `src/data/statText.js`**

```js
const EM = '—'; // em dash

const NUM = /-?\d+(?:\.\d+)?/g;

// Merge two stat strings that differ only in their numbers into one string
// with "(min—max)" at each differing position. If the non-numeric skeletons
// differ, fall back to the higher-level string `b`.
export function rangeMerge(a, b) {
  if (a === b) return a;
  const aNums = a.match(NUM) ?? [];
  const bNums = b.match(NUM) ?? [];
  const aSkeleton = a.replace(NUM, ' ');
  const bSkeleton = b.replace(NUM, ' ');
  if (aSkeleton !== bSkeleton || aNums.length !== bNums.length) return b;
  let i = 0;
  return aSkeleton.replace(/ /g, () => {
    const lo = aNums[i];
    const hi = bNums[i];
    i += 1;
    return lo === hi ? lo : `(${lo}${EM}${hi})`;
  });
}

const HANDLERS = {
  per_minute_to_per_second_2dp_if_required: (v) => round(v / 60, 2),
  divide_by_ten_1dp_if_required: (v) => round(v / 10, 1),
  divide_by_one_hundred: (v) => round(v / 100, 2),
  milliseconds_to_seconds_2dp_if_required: (v) => round(v / 1000, 2),
};

function round(n, dp) {
  const f = 10 ** dp;
  return String(Math.round(n * f) / f);
}

function applyHandler(name, value) {
  const fn = HANDLERS[name];
  return fn ? fn(value) : String(value);
}

// Resolve a quality_stats entry {stat, stats} into a "(0—N)…" string.
// Returns null when the template can't be resolved or the value is an
// implausible percentage (> 100), so the caller can omit it.
export function resolveQuality(qstat) {
  const tmpl = qstat?.stat;
  if (!tmpl) return null;
  const m = tmpl.match(/\{([^/}]+)(?:\/([^}]+))?\}/);
  if (!m) return null;
  const id = m[1];
  const handler = m[2];
  const raw = qstat.stats?.[id];
  if (raw == null) return null;
  const resolved = Number(applyHandler(handler, raw));
  const isPercent = tmpl.includes('}%');
  if (isPercent && resolved > 100) return null; // implausible — omit
  return tmpl.replace(m[0], `(0${EM}${resolved})`);
}

// Build ordered sections from a granted skill record. maxLevel caps the
// per-level range (display cap is 20).
export function buildSections(skill, maxLevel = 20) {
  const sets = skill?.stat_sets ?? [];
  const sections = [];
  for (const set of sets) {
    const label = set.label?.[0] ?? '';
    const order = set.static?.tooltip_order ?? Object.keys(set.static?.stat_text ?? {});
    const constText = set.static?.stat_text ?? {};
    const perLevel = set.per_level ?? {};
    const levels = Object.keys(perLevel)
      .map(Number)
      .filter((n) => Number.isFinite(n) && n <= maxLevel)
      .sort((x, y) => x - y);
    const lo = levels[0];
    const hi = levels[levels.length - 1];

    const lines = [];
    for (const key of order) {
      const c = constText[key];
      if (typeof c === 'string' && c.trim()) {
        lines.push(c);
        continue;
      }
      const loText = perLevel[lo]?.stat_text?.[key];
      const hiText = perLevel[hi]?.stat_text?.[key];
      if (loText && hiText) {
        lines.push(rangeMerge(loText, hiText));
      } else if (hiText) {
        lines.push(hiText);
      }
    }

    const quality = [];
    for (const q of set.static?.quality_stats ?? []) {
      const r = resolveQuality(q);
      if (r) quality.push(r);
    }

    if (lines.length || quality.length) sections.push({ label, lines, quality });
  }
  return sections;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/statText.test.js`
Expected: PASS (5 tests). (Herald's quality resolves to 250% → omitted by the guard; the section test does not assert quality.)

- [ ] **Step 5: Commit**

```bash
git add src/data/statText.js test/statText.test.js
git commit -m "feat: stat-text section and per-level range engine"
```

---

## Task 3: Extend the gem view-model

Add the richer fields the card needs, sourcing the type line and sections from the granted skill. Keep the existing fields (`borderColor`, `glowColor`, `skillIconUrl`, `hoverImageUrl`, `description`, `recommendedSupports`, etc.) intact. The old flat `mods` / `supportText` fields are superseded by `sections`; remove `mods` from the view-model and the template (Task 4) since sections now carry the stat lines.

**Files:**
- Modify: `src/data/gems.js`
- Test: `test/gems.test.js`

- [ ] **Step 1: Write the failing test (append to `test/gems.test.js`)**

```js
test('buildGemViewModel emits rich card fields for Herald of Ash', () => {
  const vm = buildGemViewModel('herald-of-ash');
  assert.equal(vm.typeLine, 'Buff');
  assert.deepEqual(vm.tags, ['Persistent', 'AoE', 'Fire', 'Duration', 'Herald']);
  assert.equal(vm.tier, 4);
  assert.deepEqual(vm.levelRange, { min: 1, max: 20 });
  assert.equal(vm.reservation, '30 Spirit');
  assert.equal(vm.footer, 'Skills can be managed in the Skills Panel.');

  const labels = vm.sections.map((s) => s.label);
  assert.deepEqual(labels, ['Buff', 'Explosion']);
  // section lines are rendered to safe HTML (bracket tokens -> spans)
  assert.ok(vm.sections[1].lines.some((l) => /\(16\.67—23\)%/.test(l)));
  assert.ok(vm.sections[1].lines.some((l) => /<span class="kw"/.test(l)));
});
```

Note: the existing test `buildGemViewModel produces card fields` asserts `vm.attribute`, `vm.borderColor`, `vm.skillIconUrl`, `vm.hoverImageUrl`, `vm.description`, `vm.recommendedSupports` — keep those fields working. That test also asserts `vm.tags.includes('fire')`; UPDATE that one assertion to `vm.tags.includes('Fire')` (tags are now display names) in the same edit.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/gems.test.js`
Expected: FAIL — `vm.typeLine` is `'Skill'` / `vm.sections` undefined / old `fire` assertion now wrong.

- [ ] **Step 3: Modify `src/data/gems.js`**

Add imports at the top (next to the existing imports):

```js
import { displayTags } from './gemTags.js';
import { buildSections } from './statText.js';
```

Add a module-level constant near `BORDER` / `TYPE_LABEL`:

```js
const RESERVATION_LABEL = { spirit: 'Spirit', mana: 'Mana', life: 'Life' };
const GEM_LEVEL_CAP = 20;
const SKILL_PANEL_FOOTER = 'Skills can be managed in the Skills Panel.';
```

Replace the body of `buildGemViewModel` with the version below. The granted-skill record is fetched once and reused for the type line, reservation, and sections. `renderGameText` is applied to every section line and quality line so bracket tokens become spans (consistent with `description`).

```js
export function buildGemViewModel(slug) {
  const gem = getGem(slug);
  if (!gem) return null;

  const skills = loadJson(`${REPOE}/skills.json`);
  const skill = skills[gem.grants_skills?.[0]] ?? null;

  const b = BORDER[gem.color] ?? BORDER.w;

  // Type line: prefer the granted active skill's first type (e.g. "Buff");
  // fall back to the gem-type label for gems with no active skill.
  const typeLine = skill?.active_skill?.types?.[0] ?? (TYPE_LABEL[gem.gem_type] ?? 'Skill');

  // Tags as display names, excluding the one already shown as the type line.
  const tags = displayTags(gem.tags, [typeLine]);

  // Reservation, e.g. { spirit: 30 } -> "30 Spirit".
  let reservation = null;
  const res = skill?.static?.reservations;
  if (res) {
    const [kind, amount] = Object.entries(res)[0] ?? [];
    if (kind != null) reservation = `${amount} ${RESERVATION_LABEL[kind] ?? kind}`;
  }

  // Sections, with every line/quality string rendered to safe token HTML.
  const sections = buildSections(skill, GEM_LEVEL_CAP).map((s) => ({
    label: s.label,
    lines: s.lines.map(renderGameText),
    quality: s.quality.map(renderGameText),
  }));

  return {
    slug,
    name: gem.base_item.display_name,
    attribute: gem.color,
    gemType: gem.gem_type,
    borderColor: b.border,
    glowColor: b.glow,
    typeLine,
    tags,
    tier: gem.crafting_level ?? null,
    levelRange: { min: 1, max: GEM_LEVEL_CAP },
    reservation,
    skillIconUrl: ddsUrl(gem.icon_dds_file),
    hoverImageUrl: ddsUrl(gem.ui_image),
    description: skill?.active_skill?.description
      ? renderGameText(skill.active_skill.description)
      : null,
    sections,
    footer: skill?.active_skill ? SKILL_PANEL_FOOTER : null,
    recommendedSupports: getRecommendedSupports(gem),
  };
}
```

Notes:
- This replaces the old `explicitMods(gem)` usage. Leave the `explicitMods` function in place is NOT required — delete it and its now-unused logic, since `description` now comes straight from `skill.active_skill.description` and stat lines come from `buildSections`. Also remove the old `mods` and `supportText` fields (superseded by `sections`).
- `description` previously came from `explicitMods`; it now reads `skill.active_skill.description` directly (same source). The existing test asserts `vm.description` matches `/<span class="kw"/` — still true.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/gems.test.js`
Expected: PASS (all gem tests, including the new rich-fields test).

- [ ] **Step 5: Run the full suite (render test will fail next — that's Task 4)**

Run: `npm test`
Expected: data tests PASS; `test/render.test.js` may still PASS (it only checks `newItemPopup`, `--card-border:`, `leadSkillIcon`, name) since the macro hasn't changed yet. If it passes, good; do not change it here.

- [ ] **Step 6: Commit**

```bash
git add src/data/gems.js test/gems.test.js
git commit -m "feat: rich gem view-model (type line, tags, tier, reservation, sections)"
```

---

## Task 4: Rewrite the gem-card macro

Render the properties block (tags, Tier, Level range, Reservation), the description, each section (header + lines, with a quality sub-block), the footer, and keep the recommended-supports block. Drop the old single-section `mods` block.

**Files:**
- Modify: `views/macros/gem-card.njk`
- Test: `test/render.test.js`

- [ ] **Step 1: Update the render test (`test/render.test.js`)**

Replace the first test's body with assertions that exercise the new content (keep the 404 test unchanged):

```js
test('GET /gem/herald-of-ash renders the card', async () => {
  const res = await request(createApp()).get('/gem/herald-of-ash');
  assert.equal(res.status, 200);
  assert.match(res.text, /Herald of Ash/);
  assert.match(res.text, /newItemPopup/);
  assert.match(res.text, /--card-border:/);
  assert.match(res.text, /leadSkillIcon/);
  // type line + properties
  assert.match(res.text, /class="lc">Buff</);
  assert.match(res.text, /Tier: <span class="colourDefault">4</);
  assert.match(res.text, /Reservation: <span class="colourDefault">30 Spirit</);
  // tags as display names
  assert.match(res.text, /Persistent, AoE, Fire, Duration, Herald/);
  // section headers
  assert.match(res.text, /<span class="ItemType">Explosion<\/span>/);
  // per-level range line
  assert.match(res.text, /\(16\.67—23\)%/);
  // footer
  assert.match(res.text, /Skills can be managed in the Skills Panel\./);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/render.test.js`
Expected: FAIL — the new assertions (Tier, Reservation, Explosion header, range, footer) don't match the old macro output.

- [ ] **Step 3: Replace `views/macros/gem-card.njk`**

```html
{% macro gemCard(vm) %}
<div class="newItemPopup GemPopup item-popup--poe2"
     style="--card-border: {{ vm.borderColor }}; --card-glow: {{ vm.glowColor }};
            {% if vm.hoverImageUrl %}--hover-image: url('{{ vm.hoverImageUrl }}');{% endif %}">
  <div class="bg-art"></div>
  <div class="content">
    <div class="itemHeader doubleLine">
      {% if vm.skillIconUrl %}
      <img class="leadSkillIcon" src="{{ vm.skillIconUrl }}"
           onerror="this.style.visibility='hidden'">
      {% endif %}
      <div class="itemName"><span class="lc">{{ vm.name }}</span></div>
      <div class="itemName typeLine"><span class="lc">{{ vm.typeLine }}</span></div>
    </div>

    <div class="content">
      <div class="Stats">
        {% if vm.tags.length %}
        <div class="property">{{ vm.tags | join(', ') }}</div>
        {% endif %}
        {% if vm.tier %}
        <div class="property">Tier: <span class="colourDefault">{{ vm.tier }}</span></div>
        {% endif %}
        {% if vm.levelRange %}
        <div class="property">Level: <span class="colourDefault">({{ vm.levelRange.min }}—{{ vm.levelRange.max }})</span></div>
        {% endif %}
        {% if vm.reservation %}
        <div class="property">Reservation: <span class="colourDefault">{{ vm.reservation }}</span></div>
        {% endif %}

        {% if vm.description %}
        <div class="separator"></div>
        <div class="secDescrText">{{ vm.description | safe }}</div>
        {% endif %}
      </div>

      {% for section in vm.sections %}
      {% if section.label %}
      <div class="hybridHeader gemTabs">
        <div class="TextGem TitleBar"><span class="ItemType">{{ section.label }}</span></div>
      </div>
      {% endif %}
      <div class="Stats">
        {% for line in section.lines %}
        <div class="explicitMod">{{ line | safe }}</div>
        {% endfor %}
        {% if section.quality.length %}
        <div class="quality-text"><br><span class="white">Additional Effects From Quality:</span></div>
        {% for q in section.quality %}
        <div class="qualityMod">{{ q | safe }}</div>
        {% endfor %}
        {% endif %}
      </div>
      {% endfor %}

      {% if vm.footer %}
      <div class="separator"></div>
      <div class="default fst-italic">{{ vm.footer }}</div>
      {% endif %}
    </div>

    {% if vm.recommendedSupports.length %}
    <div class="separator"></div>
    <div class="property" style="text-align:center;">Recommended Supports</div>
    <div class="support-list">
      {% for s in vm.recommendedSupports %}
      <a class="{{ s.color }}" href="/gem/{{ s.slug }}">{{ s.name }}</a>
      {% endfor %}
    </div>
    {% endif %}
  </div>
</div>
{% endmacro %}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/render.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add views/macros/gem-card.njk test/render.test.js
git commit -m "feat: render properties, stat sections, quality, and footer on gem card"
```

---

## Task 5: Ensure `.colourDefault` style exists

The properties use `<span class="colourDefault">`. The reference styles `.property .colourDefault` / `.requirements .colourDefault`. Confirm the class renders with the default-value color; add a fallback rule only if missing.

**Files:**
- Modify (only if needed): `public/css/gem-card.css`

- [ ] **Step 1: Check whether the class is already styled**

Run: `grep -n "colourDefault" public/css/gem-card.css`
Expected: one or more matches (ported from the reference). If matches exist, SKIP to Task 6 — no change needed.

- [ ] **Step 2: If and only if there were no matches, append a fallback rule**

```css
.colourDefault { color: var(--color-default, #7f7f7f); }
```

- [ ] **Step 3: Commit (only if you changed the file)**

```bash
git add public/css/gem-card.css
git commit -m "style: ensure colourDefault value color on gem card"
```

---

## Task 6: End-to-end verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all tests PASS.

- [ ] **Step 2: Smoke-test the running server against the reference content**

Run (one shell):
```bash
PORT=3201 node src/index.js >/tmp/poe2wiki-verify.log 2>&1 &
sleep 1.5
curl -s localhost:3201/gem/herald-of-ash > /tmp/herald.html
for needle in 'class="lc">Buff<' 'Persistent, AoE, Fire, Duration, Herald' 'Tier: <span class="colourDefault">4<' 'Level: <span class="colourDefault">(1—20)<' 'Reservation: <span class="colourDefault">30 Spirit<' '<span class="ItemType">Buff</span>' '<span class="ItemType">Explosion</span>' 'Explosion radius is 1.2 metres' '(16.67—23)%' 'Skills can be managed in the Skills Panel.'; do
  printf '%s -> %s\n' "$needle" "$(grep -c -- "$needle" /tmp/herald.html)";
done
kill %1
```
Expected: every needle reports `1` (or more).

- [ ] **Step 3: Spot-check a second gem renders without errors**

Run:
```bash
PORT=3202 node src/index.js >/tmp/poe2wiki-verify2.log 2>&1 &
sleep 1.5
for slug in spark-i fireball-i; do
  printf '%s -> %s\n' "$slug" "$(curl -s -o /dev/null -w '%{http_code}' localhost:3202/gem/$slug)";
done
kill %1
```
Expected: HTTP 200 for at least one real gem slug (adjust slugs if those aren't present — pick any from `/` search). No 500s.

- [ ] **Step 4: Final commit if any verification fixups were made**

Only if Step 2/3 surfaced a bug you fixed:
```bash
git add -A
git commit -m "fix: gem card alignment verification fixups"
```

---

## Self-Review Notes

- **Reference coverage:** type line "Buff" (Task 3) ✓; display-name tags (Tasks 1, 3) ✓; Tier (Task 3/4) ✓; Level range (Task 3/4) ✓; Reservation (Task 3/4) ✓; Buff/Explosion sections (Task 2) ✓; per-level value ranges (Task 2) ✓; constant lines (Task 2) ✓; quality mods, best-effort with plausibility guard (Task 2) ✓; footer (Task 3/4) ✓.
- **Deliberately omitted (data gaps):** numeric `Requires: Level/Str` line and the `Any Martial Weapon` line — not faithfully derivable from the dataset (no requirements table; `crafting_types` conflates weapon and non-weapon affinities). Flagged here and to be flagged in the completion report.
- **Known approximation:** quality-mod numbers are best-effort. Herald's single quality stat resolves to an implausible 250% via the named handler, so the guard omits it — the Explosion section will show its three stat lines without a quality sub-block. Gems whose quality math is plausible will render `(0—N)` quality lines. The exact in-game quality formula is a separate follow-up.
- **Wording note:** scaling lines use the dataset's own `per_level.stat_text` phrasing (e.g. "Base [Ignite] damage is (16.67—23)% of [Overkill] damage") rather than the reference HTML's hand-edited "An additional +…" phrasing. Same value, same meaning, data-driven.
- **Superseded fields:** the old flat `mods` and `supportText` view-model fields and the single-section template block are removed in favor of `sections`.
