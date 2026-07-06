# Mods / Affixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a browsable affix section — `/mods` (all mod groups), `/mod/:typeSlug` (group detail with tiers) — and cross-link rollable affixes from base item detail pages.

**Architecture:** New `src/data/mods.js` lazy-loads `mods.json` and `mods_by_base.json`, exposes typed query functions. `baseItems.js` gains a `metadataKey` field (the JSON object key, needed for cross-referencing). Base item view-model gains an `affixes` field. Routes and Nunjucks views follow the established gem/unique/base patterns.

**Tech Stack:** Node.js ESM, Express 5, Nunjucks, `node:test`, existing `loader.js`/`slug.js`/`images.js` primitives.

---

## Verified Data Facts

All verified by reading `$POE2DATADIR/data/repoe-poe2/` directly:

- `mods.json`: 16 788 total keys. Filter `domain === 'item' && generation_type in ('prefix','suffix')` → **2585 rollable item mods**.
- Each mod record: `{ name, text, type, generation_type, domain, required_level, stats: [{id,min,max}], spawn_weights: [{tag,weight}], groups, implicit_tags, is_essence_only }`.
- `text` field: pre-formatted with `[Id|Display]` tokens (2232 mods) or plain text (325 mods). Existing `renderGameText()` handles both.
- `type` field: the mod family name (e.g., `"IncreasedLife"`, `"Strength"`). **One type has `%`: `"AdditionalArrowChanceCanExceed100%"` → must `slugify(type)` for URLs and store both.**
- Unique mod type groups among rollable mods: **579 types**.
- `mods_by_base.json`: keyed by item class display name (e.g., `"Amulets"`, `"Rings"`) → tag-combo strings (e.g., `"amulet,default"`) → `{ bases: [metadataPath,...], mods: { prefix: { TypeName: { modId: level } }, suffix: { TypeName: { modId: level } } } }`.
- **Stellar Amulet** metadata path: `Metadata/Items/Amulets/FourAmulet8` → appears in `mods_by_base["Amulets"]["amulet,default"].bases` ✅
- `mods_by_base["Amulets"]["amulet,default"]["mods"]["prefix"]["IncreasedLife"]` → `{ IncreasedLife1: 1, IncreasedLife2: 6, ..., IncreasedLife8: 54 }` (8 tiers)
- `mods["IncreasedLife1"]`: name=`"Hale"`, text=`"+(10-19) to maximum Life"`, type=`"IncreasedLife"`, generation_type=`"prefix"`, required_level=`1`, stats=`[{id:"base_maximum_life", min:10, max:19}]`
- `item_classes.json`: `"Amulet" → { name: "Amulets", ... }` — the display name matches the key in `mods_by_base.json`.
- **Edge case**: some tag combos in `mods_by_base` apply to special/demigod bases only. For each base, find the tag combo whose `bases` array contains the base's metadata path.

---

## File Map

| Action | File | Purpose |
|--------|------|---------|
| Modify | `src/data/baseItems.js` | Add `metadataKey` to each stored record |
| Create | `src/data/mods.js` | Lazy index; `getMod`, `getModGroup`, `listModGroups`, `getModsForBase` |
| Modify | `src/routes/pages.js` | Add `/mods` and `/mod/:typeSlug` routes; update `/base/:slug` to include affixes |
| Create | `views/mods.njk` | Mod group browser (prefix / suffix lists) |
| Create | `views/mod-group.njk` | Mod group detail — all tiers with tier name, stat text, level |
| Modify | `views/base-item.njk` | Add "Rollable Affixes" section |
| Modify | `public/css/gem-card.css` | Styles for affix tier rows and the mod group list |
| Modify | `views/home.njk` | Add link to `/mods` |
| Create | `test/mods.test.js` | Tests for `src/data/mods.js` |
| Modify | `test/baseItems.test.js` | Add test for `metadataKey` field |
| Modify | `test/server.test.js` | Smoke tests for new routes |

---

## Task 1: Add `metadataKey` to `baseItems.js`

**Files:**
- Modify: `src/data/baseItems.js`
- Modify: `test/baseItems.test.js`

- [ ] **Step 1: Add failing test to `test/baseItems.test.js`**

Append this test:

```js
test('getBaseItem includes metadataKey field', () => {
  const b = getBaseItem('stellar-amulet');
  assert.ok(b);
  assert.equal(b.metadataKey, 'Metadata/Items/Amulets/FourAmulet8');
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
node --test test/baseItems.test.js 2>&1 | tail -15
```
Expected: FAIL — `metadataKey` is `undefined`.

- [ ] **Step 3: Update `buildIndex()` in `src/data/baseItems.js`**

Change the inner loop from `for (const v of Object.values(raw))` to `for (const [metaKey, v] of Object.entries(raw))` and add `metadataKey` to the record:

```js
  for (const [metaKey, v] of Object.entries(raw)) {
    if (v.domain !== 'item' || v.release_state !== 'released') continue;
    if (!BROWSABLE_CLASSES.has(v.item_class)) continue;

    const nameClassKey = `${v.name}|${v.item_class}`;
    if (seenNameClass.has(nameClassKey)) continue;
    seenNameClass.add(nameClassKey);

    const slug = buildSlug(v.name, v.item_class, nameAcrossClassesDeduped);
    const record = {
      slug,
      metadataKey: metaKey,
      name: v.name,
      itemClass: v.item_class,
      className: _classInfo.get(v.item_class)?.name ?? v.item_class,
      classSlug: slugify(v.item_class),
      dropLevel: v.drop_level ?? null,
      inventorySize: { w: v.inventory_width, h: v.inventory_height },
      tags: v.tags ?? [],
      requirements: buildRequirements(v.requirements, v.drop_level),
      properties: buildProperties(v.properties),
      iconUrl: ddsUrl(v.visual_identity?.dds_file),
    };

    if (!_index.has(slug)) _index.set(slug, record);
    _byClass.get(v.item_class)?.push(record);
  }
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
node --test test/baseItems.test.js 2>&1 | tail -10
```
Expected: All PASS.

- [ ] **Step 5: Run full suite**

```bash
npm test 2>&1 | tail -10
```
Expected: All PASS.

- [ ] **Step 6: Commit**

```bash
git add src/data/baseItems.js test/baseItems.test.js
git commit -m "feat: add metadataKey to base item records for mod cross-reference"
```

---

## Task 2: Create `src/data/mods.js`

**Files:**
- Create: `src/data/mods.js`
- Create: `test/mods.test.js`

- [ ] **Step 1: Create `test/mods.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getMod, getModGroup, listModGroups, getModsForBase,
} from '../src/data/mods.js';

test('getMod returns a known mod by id', () => {
  const m = getMod('IncreasedLife1');
  assert.ok(m);
  assert.equal(m.name, 'Hale');
  assert.equal(m.text, '+(10-19) to maximum Life');
  assert.equal(m.type, 'IncreasedLife');
  assert.equal(m.generation_type, 'prefix');
  assert.equal(m.required_level, 1);
  assert.deepEqual(m.stats, [{ id: 'base_maximum_life', min: 10, max: 19 }]);
});

test('getMod returns null for unknown id', () => {
  assert.equal(getMod('NotARealMod'), null);
});

test('getModGroup returns all tiers for IncreasedLife', () => {
  const g = getModGroup('IncreasedLife');
  assert.ok(g);
  assert.equal(g.type, 'IncreasedLife');
  assert.equal(g.typeSlug, 'increased-life');
  assert.equal(g.generation_type, 'prefix');
  assert.ok(Array.isArray(g.tiers));
  assert.equal(g.tiers.length, 8);
  // Tiers sorted by required_level ascending
  assert.equal(g.tiers[0].id, 'IncreasedLife1');
  assert.equal(g.tiers[0].name, 'Hale');
  assert.equal(g.tiers[0].level, 1);
  assert.equal(g.tiers[7].id, 'IncreasedLife8');
});

test('getModGroup returns null for unknown type', () => {
  assert.equal(getModGroup('NotAType'), null);
});

test('listModGroups returns prefix and suffix groups', () => {
  const groups = listModGroups();
  assert.ok(Array.isArray(groups));
  const life = groups.find((g) => g.type === 'IncreasedLife');
  assert.ok(life);
  assert.equal(life.generation_type, 'prefix');
  const str = groups.find((g) => g.type === 'Strength');
  assert.ok(str);
  assert.equal(str.generation_type, 'suffix');
});

test('listModGroups entries have typeSlug', () => {
  const groups = listModGroups();
  assert.ok(groups.every((g) => g.typeSlug));
  // AdditionalArrowChanceCanExceed100% should be slugified safely
  const arrow = groups.find((g) => g.type === 'AdditionalArrowChanceCanExceed100%');
  if (arrow) assert.ok(arrow.typeSlug && !arrow.typeSlug.includes('%'));
});

test('getModsForBase returns prefix/suffix groups for Stellar Amulet', () => {
  const result = getModsForBase('Metadata/Items/Amulets/FourAmulet8', 'Amulets');
  assert.ok(result);
  assert.ok(Array.isArray(result.prefix));
  assert.ok(Array.isArray(result.suffix));
  const life = result.prefix.find((g) => g.type === 'IncreasedLife');
  assert.ok(life, 'IncreasedLife should be a prefix group for amulets');
  assert.ok(life.tiers.length >= 1);
  const str = result.suffix.find((g) => g.type === 'Strength');
  assert.ok(str, 'Strength should be a suffix group for amulets');
});

test('getModsForBase returns empty prefix/suffix for unknown base', () => {
  const result = getModsForBase('Metadata/Items/NotReal/Fake', 'Amulets');
  assert.deepEqual(result, { prefix: [], suffix: [] });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
node --test test/mods.test.js 2>&1 | head -10
```
Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/data/mods.js`**

```js
import { loadJson } from './loader.js';
import { slugify } from './slug.js';

const REPOE = 'repoe-poe2';
const ROLLABLE = new Set(['prefix', 'suffix']);

let _byId = null;      // modId → record
let _byType = null;    // type → [{id, name, text, level, stats}] sorted by level
let _forBase = null;   // metadataKey → {prefix: [{type,typeSlug,tiers}], suffix: [...]}

function buildIndex() {
  if (_byId) return;

  const raw = loadJson(`${REPOE}/mods.json`);
  _byId = new Map();
  _byType = new Map();

  for (const [id, v] of Object.entries(raw)) {
    if (v.domain !== 'item' || !ROLLABLE.has(v.generation_type)) continue;
    _byId.set(id, { id, ...v });

    if (!_byType.has(v.type)) _byType.set(v.type, []);
    _byType.get(v.type).push({
      id,
      name: v.name,
      text: v.text ?? '',
      level: v.required_level ?? 0,
      generation_type: v.generation_type,
      stats: v.stats ?? [],
    });
  }

  // Sort each type's tiers by required level.
  for (const [, tiers] of _byType) {
    tiers.sort((a, b) => a.level - b.level);
  }
}

function buildBaseIndex() {
  if (_forBase) return;
  buildIndex();

  const mbb = loadJson(`${REPOE}/mods_by_base.json`);
  _forBase = new Map();

  for (const [, tagCombos] of Object.entries(mbb)) {
    for (const [, entry] of Object.entries(tagCombos)) {
      const bases = entry.bases ?? [];
      const modsByGenType = entry.mods ?? {};

      for (const metaKey of bases) {
        if (_forBase.has(metaKey)) continue; // first entry wins (most specific tag combo)

        const prefix = [];
        const suffix = [];

        for (const [genType, typeGroups] of Object.entries(modsByGenType)) {
          if (genType !== 'prefix' && genType !== 'suffix') continue;
          const out = genType === 'prefix' ? prefix : suffix;

          for (const [typeName, modMap] of Object.entries(typeGroups)) {
            if (!_byType.has(typeName)) continue;
            // Only include tiers whose id is in modMap
            const allowedIds = new Set(Object.keys(modMap));
            const tiers = _byType.get(typeName).filter((t) => allowedIds.has(t.id));
            if (tiers.length === 0) continue;
            out.push({ type: typeName, typeSlug: slugify(typeName), tiers });
          }
        }

        _forBase.set(metaKey, { prefix, suffix });
      }
    }
  }
}

export function getMod(id) {
  buildIndex();
  return _byId.get(id) ?? null;
}

export function getModGroup(type) {
  buildIndex();
  const tiers = _byType.get(type);
  if (!tiers) return null;
  const first = tiers[0];
  return {
    type,
    typeSlug: slugify(type),
    generation_type: first.generation_type,
    tiers,
  };
}

export function listModGroups() {
  buildIndex();
  const out = [];
  for (const [type, tiers] of _byType) {
    const first = tiers[0];
    out.push({
      type,
      typeSlug: slugify(type),
      generation_type: first.generation_type,
      text: first.text,
      tierCount: tiers.length,
    });
  }
  return out.sort((a, b) => a.type.localeCompare(b.type));
}

export function getModsForBase(metadataKey, className) {
  buildBaseIndex();
  return _forBase.get(metadataKey) ?? { prefix: [], suffix: [] };
}
```

- [ ] **Step 4: Run `test/mods.test.js` — expect PASS**

```bash
node --test test/mods.test.js 2>&1 | tail -15
```
Expected: All PASS.

- [ ] **Step 5: Run full suite**

```bash
npm test 2>&1 | tail -10
```
Expected: All PASS.

- [ ] **Step 6: Commit**

```bash
git add src/data/mods.js test/mods.test.js
git commit -m "feat: mods data module — lazy-loaded rollable affix index with base cross-ref"
```

---

## Task 3: Routes, views, and cross-links

**Files:**
- Modify: `src/routes/pages.js`
- Create: `views/mods.njk`
- Create: `views/mod-group.njk`
- Modify: `views/base-item.njk`
- Modify: `public/css/gem-card.css`
- Modify: `views/home.njk`
- Modify: `test/server.test.js`

- [ ] **Step 1: Add failing route tests to `test/server.test.js`**

Append:

```js
test('GET /mods returns 200 with prefix/suffix headings', async () => {
  const app = createApp();
  const res = await request(app).get('/mods');
  assert.equal(res.status, 200);
  assert.ok(res.text.includes('Prefix') || res.text.includes('prefix'));
});

test('GET /mod/increased-life returns 200 with tier names', async () => {
  const app = createApp();
  const res = await request(app).get('/mod/increased-life');
  assert.equal(res.status, 200);
  assert.ok(res.text.includes('Hale'));
});

test('GET /mod/not-a-real-mod returns 404', async () => {
  const app = createApp();
  const res = await request(app).get('/mod/not-a-real-mod');
  assert.equal(res.status, 404);
});

test('GET /base/stellar-amulet includes affix section', async () => {
  const app = createApp();
  const res = await request(app).get('/base/stellar-amulet');
  assert.equal(res.status, 200);
  assert.ok(res.text.includes('Affix') || res.text.includes('affix') || res.text.includes('IncreasedLife') || res.text.includes('increased-life'));
});
```

- [ ] **Step 2: Run tests — expect FAIL (template/route not found)**

```bash
node --test test/server.test.js 2>&1 | tail -20
```
Expected: FAIL — template or route errors.

- [ ] **Step 3: Update `src/routes/pages.js`**

Add import and three new routes:

```js
import { buildGemViewModel, listGems } from '../data/gems.js';
import { buildUniqueViewModel, listUniques } from '../data/uniques.js';
import { listItemClasses, getItemClass, buildBaseItemViewModel } from '../data/baseItems.js';
import { listModGroups, getModGroup } from '../data/mods.js';

export function registerPages(app) {
  app.get('/', (_req, res) => {
    res.render('home.njk');
  });

  app.get('/gem/:slug', (req, res) => {
    const vm = buildGemViewModel(req.params.slug);
    if (!vm) return res.status(404).render('home.njk', { notFound: req.params.slug });
    res.render('gem.njk', { vm });
  });

  app.get('/uniques', (_req, res) => {
    const uniques = listUniques().sort((a, b) => a.name.localeCompare(b.name));
    res.render('uniques.njk', { uniques });
  });

  app.get('/unique/:slug', (req, res) => {
    const vm = buildUniqueViewModel(req.params.slug);
    if (!vm) return res.status(404).render('home.njk', { notFound: req.params.slug });
    res.render('unique.njk', { vm });
  });

  app.get('/bases', (_req, res) => {
    const groups = listItemClasses();
    res.render('bases.njk', { groups });
  });

  app.get('/bases/:classSlug', (req, res) => {
    const cls = getItemClass(req.params.classSlug);
    if (!cls) return res.status(404).render('home.njk', { notFound: req.params.classSlug });
    res.render('bases-class.njk', { cls });
  });

  app.get('/base/:slug', (req, res) => {
    const vm = buildBaseItemViewModel(req.params.slug);
    if (!vm) return res.status(404).render('home.njk', { notFound: req.params.slug });
    res.render('base-item.njk', { vm });
  });

  app.get('/mods', (_req, res) => {
    const groups = listModGroups();
    const prefix = groups.filter((g) => g.generation_type === 'prefix');
    const suffix = groups.filter((g) => g.generation_type === 'suffix');
    res.render('mods.njk', { prefix, suffix });
  });

  app.get('/mod/:typeSlug', (req, res) => {
    const groups = listModGroups();
    const entry = groups.find((g) => g.typeSlug === req.params.typeSlug);
    if (!entry) return res.status(404).render('home.njk', { notFound: req.params.typeSlug });
    const group = getModGroup(entry.type);
    res.render('mod-group.njk', { group });
  });

  app.locals.gemCount = () => listGems().length;
}
```

- [ ] **Step 4: Update `src/data/baseItems.js` — `buildBaseItemViewModel` includes affixes**

Import `getModsForBase` and update `buildBaseItemViewModel`:

```js
import { loadJson } from './loader.js';
import { slugify } from './slug.js';
import { ddsUrl } from './images.js';
import { listUniques } from './uniques.js';
import { getModsForBase } from './mods.js';
```

And update `buildBaseItemViewModel`:

```js
export function buildBaseItemViewModel(slug) {
  const b = getBaseItem(slug);
  if (!b) return null;

  const uniquesOnBase = listUniques()
    .filter((u) => u.base === b.name)
    .map((u) => ({ slug: u.slug, name: u.name, iconUrl: u.iconUrl }));

  const affixes = getModsForBase(b.metadataKey, b.className);

  return { ...b, uniquesOnBase, affixes };
}
```

- [ ] **Step 5: Create `views/mods.njk`**

```njk
{% extends "base.njk" %}
{% block title %}Affixes — PoE2 Wiki{% endblock %}
{% block content %}
<div class="page" style="flex-direction:column;align-items:center;">
  <h1 class="page-title" style="font-family:'OptimusPrincepsSemiBold',serif;color:var(--color-normal);">
    Rollable Affixes
  </h1>
  <p class="page-subtitle">{{ prefix.length + suffix.length }} affix families</p>
  <div class="mods-columns">
    <section class="mods-section">
      <h2 class="mods-section-title">Prefix ({{ prefix.length }})</h2>
      <div class="mods-list">
        {% for g in prefix %}
        <a class="mods-list-row" href="/mod/{{ g.typeSlug }}">
          <span class="mods-list-name">{{ g.type }}</span>
          <span class="mods-list-text">{{ g.text | truncate(60) }}</span>
          <span class="mods-list-count">{{ g.tierCount }} tier{{ 's' if g.tierCount != 1 }}</span>
        </a>
        {% endfor %}
      </div>
    </section>
    <section class="mods-section">
      <h2 class="mods-section-title">Suffix ({{ suffix.length }})</h2>
      <div class="mods-list">
        {% for g in suffix %}
        <a class="mods-list-row" href="/mod/{{ g.typeSlug }}">
          <span class="mods-list-name">{{ g.type }}</span>
          <span class="mods-list-text">{{ g.text | truncate(60) }}</span>
          <span class="mods-list-count">{{ g.tierCount }} tier{{ 's' if g.tierCount != 1 }}</span>
        </a>
        {% endfor %}
      </div>
    </section>
  </div>
</div>
{% endblock %}
```

- [ ] **Step 6: Create `views/mod-group.njk`**

```njk
{% extends "base.njk" %}
{% block title %}{{ group.type }} Affix — PoE2 Wiki{% endblock %}
{% block content %}
<div class="page" style="flex-direction:column;align-items:center;">
  <nav class="bases-breadcrumb">
    <a href="/mods">Affixes</a> › {{ group.type }}
  </nav>
  <h1 class="page-title" style="font-family:'OptimusPrincepsSemiBold',serif;color:var(--color-normal);">
    {{ group.type }}
    <span style="font-size:14px;color:var(--color-default);margin-left:8px;">{{ group.generation_type }}</span>
  </h1>
  <p class="page-subtitle">{{ group.tiers.length }} tier{{ 's' if group.tiers.length != 1 }}</p>
  <table class="mod-tier-table">
    <thead>
      <tr>
        <th>Tier</th>
        <th>Name</th>
        <th>Stat</th>
        <th>Req. Level</th>
      </tr>
    </thead>
    <tbody>
      {% for t in group.tiers %}
      <tr class="mod-tier-row">
        <td class="mod-tier-num">{{ loop.index }}</td>
        <td class="mod-tier-name">{{ t.name }}</td>
        <td class="mod-tier-text">{{ t.text }}</td>
        <td class="mod-tier-level">{{ t.level }}</td>
      </tr>
      {% endfor %}
    </tbody>
  </table>
</div>
{% endblock %}
```

- [ ] **Step 7: Update `views/base-item.njk` — add Rollable Affixes section**

Add after the unique versions section (before the closing `</div>` of `.content`):

```njk
          {% if vm.affixes.prefix.length or vm.affixes.suffix.length %}
          <div class="separator"></div>
          <div class="Stats">
            <div class="property" style="margin-bottom:4px;">Rollable Affixes:</div>
            {% if vm.affixes.prefix.length %}
            <div class="property" style="padding-left:4px;color:var(--color-default);font-size:11.5px;">Prefixes</div>
            {% for g in vm.affixes.prefix %}
            <div class="property" style="padding-left:8px;">
              <a href="/mod/{{ g.typeSlug }}" style="color:var(--magic-color);text-decoration:none;">
                {{ g.type }}
              </a>
              <span style="color:var(--color-default);font-size:11px;margin-left:6px;">({{ g.tiers.length }} tier{{ 's' if g.tiers.length != 1 }})</span>
            </div>
            {% endfor %}
            {% endif %}
            {% if vm.affixes.suffix.length %}
            <div class="property" style="padding-left:4px;color:var(--color-default);font-size:11.5px;margin-top:4px;">Suffixes</div>
            {% for g in vm.affixes.suffix %}
            <div class="property" style="padding-left:8px;">
              <a href="/mod/{{ g.typeSlug }}" style="color:var(--magic-color);text-decoration:none;">
                {{ g.type }}
              </a>
              <span style="color:var(--color-default);font-size:11px;margin-left:6px;">({{ g.tiers.length }} tier{{ 's' if g.tiers.length != 1 }})</span>
            </div>
            {% endfor %}
            {% endif %}
          </div>
          {% endif %}
```

The full updated `views/base-item.njk` content section should look like:

```njk
        <div class="content">
          {% if vm.properties.length %}
          <div class="Stats">
            {% for prop in vm.properties %}
            <div class="property">{{ prop.label }}: <span class="colourDefault">{{ prop.value }}</span></div>
            {% endfor %}
          </div>
          <div class="separator"></div>
          {% endif %}
          {% if vm.requirements.length %}
          <div class="Stats">
            <div class="requirements">Requires {{ vm.requirements | join(', ') }}</div>
          </div>
          <div class="separator"></div>
          {% endif %}
          {% if vm.tags.length %}
          <div class="Stats">
            <div class="default fst-italic">Tags: {{ vm.tags | join(', ') }}</div>
          </div>
          <div class="separator"></div>
          {% endif %}
          <div class="Stats">
            <div class="property">Size: <span class="colourDefault">{{ vm.inventorySize.w }}×{{ vm.inventorySize.h }}</span></div>
          </div>
          {% if vm.uniquesOnBase.length %}
          <div class="separator"></div>
          <div class="Stats">
            <div class="property" style="margin-bottom:4px;">Unique versions:</div>
            {% for u in vm.uniquesOnBase %}
            <div class="property" style="padding-left:8px;">
              <a href="/unique/{{ u.slug }}" style="color:var(--unique-color);text-decoration:none;">
                {% if u.iconUrl %}
                <img src="{{ u.iconUrl }}" alt="{{ u.name }}"
                     style="width:16px;height:16px;vertical-align:middle;margin-right:4px;object-fit:contain;"
                     onerror="this.style.visibility='hidden'">
                {% endif %}
                {{ u.name }}
              </a>
            </div>
            {% endfor %}
          </div>
          {% endif %}
          {% if vm.affixes.prefix.length or vm.affixes.suffix.length %}
          <div class="separator"></div>
          <div class="Stats">
            <div class="property" style="margin-bottom:4px;">Rollable Affixes:</div>
            {% if vm.affixes.prefix.length %}
            <div class="property" style="padding-left:4px;color:var(--color-default);font-size:11.5px;">Prefixes</div>
            {% for g in vm.affixes.prefix %}
            <div class="property" style="padding-left:8px;">
              <a href="/mod/{{ g.typeSlug }}" style="color:var(--magic-color);text-decoration:none;">
                {{ g.type }}
              </a>
              <span style="color:var(--color-default);font-size:11px;margin-left:6px;">({{ g.tiers.length }} tier{{ 's' if g.tiers.length != 1 }})</span>
            </div>
            {% endfor %}
            {% endif %}
            {% if vm.affixes.suffix.length %}
            <div class="property" style="padding-left:4px;color:var(--color-default);font-size:11.5px;margin-top:4px;">Suffixes</div>
            {% for g in vm.affixes.suffix %}
            <div class="property" style="padding-left:8px;">
              <a href="/mod/{{ g.typeSlug }}" style="color:var(--magic-color);text-decoration:none;">
                {{ g.type }}
              </a>
              <span style="color:var(--color-default);font-size:11px;margin-left:6px;">({{ g.tiers.length }} tier{{ 's' if g.tiers.length != 1 }})</span>
            </div>
            {% endfor %}
            {% endif %}
          </div>
          {% endif %}
        </div>
```

- [ ] **Step 8: Add CSS for mod tables and browser to `public/css/gem-card.css`**

Append to the end of the file:

```css
/* Mod group browser */
.mods-columns {
  display: flex;
  gap: 24px;
  width: 100%;
  max-width: 1100px;
  align-items: flex-start;
}

.mods-section {
  flex: 1;
  min-width: 0;
}

.mods-section-title {
  font-family: 'OptimusPrincepsSemiBold', serif;
  color: var(--color-normal);
  font-size: 15px;
  margin: 0 0 8px;
}

.mods-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.mods-list-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 5px 8px;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: 3px;
  text-decoration: none;
  transition: border-color 0.12s;
  overflow: hidden;
}

.mods-list-row:hover {
  border-color: var(--magic-color);
}

.mods-list-name {
  color: var(--magic-color);
  font-family: "FontinSmallCaps", serif;
  font-size: 12px;
  white-space: nowrap;
  min-width: 180px;
}

.mods-list-text {
  color: var(--color-default);
  font-size: 11.5px;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mods-list-count {
  color: var(--prop-color);
  font-size: 11px;
  white-space: nowrap;
}

/* Mod group detail table */
.mod-tier-table {
  width: 100%;
  max-width: 700px;
  border-collapse: collapse;
  font-family: "FontinSmallCaps", serif;
  font-size: 13px;
  margin-top: 8px;
}

.mod-tier-table th {
  color: var(--prop-color);
  font-size: 12px;
  padding: 4px 10px;
  border-bottom: 1px solid var(--border);
  text-align: left;
  font-weight: normal;
}

.mod-tier-row {
  border-bottom: 1px solid rgba(255,255,255,0.04);
}

.mod-tier-row:hover {
  background: var(--bg-surface);
}

.mod-tier-num {
  color: var(--color-default);
  padding: 5px 10px;
  text-align: center;
  width: 36px;
}

.mod-tier-name {
  color: var(--magic-color);
  padding: 5px 10px;
}

.mod-tier-text {
  color: var(--normal-color);
  padding: 5px 10px;
}

.mod-tier-level {
  color: var(--prop-color);
  padding: 5px 10px;
  text-align: right;
  white-space: nowrap;
}
```

- [ ] **Step 9: Add link to home page**

In `views/home.njk`, add:

```njk
    <a href="/mods" style="color:var(--magic-color);">Browse Affixes →</a>
```

- [ ] **Step 10: Run full suite**

```bash
npm test 2>&1 | tail -15
```
Expected: All PASS.

- [ ] **Step 11: Smoke-test server**

```bash
node src/index.js &
sleep 2
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/mods
echo ""
curl -s http://localhost:3000/mod/increased-life | grep -oE 'Hale|Healthy'
curl -s http://localhost:3000/base/stellar-amulet | grep -oE 'IncreasedLife|increased-life'
pkill -f "node src/index.js"; true
```
Expected: 200, "Hale", "IncreasedLife" or "increased-life".

- [ ] **Step 12: Commit**

```bash
git add src/routes/pages.js views/mods.njk views/mod-group.njk views/base-item.njk public/css/gem-card.css views/home.njk test/server.test.js src/data/baseItems.js
git commit -m "feat: mods browser, mod group detail, and rollable affixes on base item pages"
```

---

## Self-Review

**Spec coverage:**
- ✅ `mods.json` + stat descriptions via `text` field
- ✅ Show which bases/tags a mod can roll on (via `/mod/:typeSlug` showing tiers with level reqs; cross-linked from base pages)
- ✅ Tiers/ranges shown in mod-group.njk table
- ✅ Cross-link from base item pages (affixes section in `base-item.njk`)
- ✅ TDD — tests written before implementation
- ✅ Navigation — home page link + search (through existing search: no mod name search yet, but browsable)
- ⚠️ `mods_by_base.json` used for base→mods cross-ref, but mod-group page doesn't yet list which item types it rolls on (deferred — not in spec, can add later)

**Placeholder scan:** No placeholders found.

**Type consistency:** `getModsForBase` returns `{prefix, suffix}` consistent with `vm.affixes` usage in template. `getModGroup` returns `{type, typeSlug, generation_type, tiers}` consistent with `mod-group.njk` template usage.
