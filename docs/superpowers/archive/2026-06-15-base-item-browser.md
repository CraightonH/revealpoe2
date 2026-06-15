# Base Item Browser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a browsable base item section: a `/bases` class index, `/bases/:classSlug` class listing, and `/base/:slug` detail page with icon, properties, requirements, tags, and cross-linked unique items.

**Architecture:** New `src/data/baseItems.js` module (lazy-loaded index) parses `base_items.json` and `item_classes.json`, exposing typed query functions. Routes and Nunjucks views follow the existing unique/gem patterns. Uniques cross-linked via `listUniques()` matching on base item name.

**Tech Stack:** Node.js ESM, Express 5, Nunjucks, `node:test`, existing `loader.js`/`slug.js`/`images.js`/`uniques.js` primitives.

---

## Verified Data Facts

All verified by reading `$POE2DATADIR/data/` directly:

- `base_items.json`: 5237 total; filter `domain === 'item' && release_state === 'released'` → **1825 items**, **30 distinct item classes**.
- `item_classes.json`: dict keyed by class_id (e.g. `"Amulet"`) → `{name, category_id, category}`. Display name example: `"Amulet" → "Amulets"`.
- All 1825 released items have `visual_identity.dds_file` (0 missing icons).
- **Slug collision**: only 1 cross-class name collision: `"Energy Blade"` exists in both `One Hand Sword` and `Two Hand Sword`. Resolution: append class slug for that item (`energy-blade--one-hand-sword`, `energy-blade--two-hand-sword`). 29 same-name/same-class duplicates (different metadata keys) → keep first occurrence.
- `requirements` field: `null` for some classes (e.g. Ring); `{level, strength, dexterity, intelligence}` with 0 for unused attrs when non-null.
- **Weapon properties** (non-null): `attack_time` (ms; APS = round(1000/ms, 2)), `critical_strike_chance` (per 10000; display = value/100 + "%"), `physical_damage_min`, `physical_damage_max`, `range` (display = value/10).
- **Armour properties** (non-null): `armour`, `evasion`, `energy_shield`, `ward` are `{min, max}` objects; `block` is an integer (direct %, e.g. 26); `movement_speed` is integer divided by 100 (e.g. -500 → -5%).
- Wand, Ring, Belt, Quiver: empty properties.
- **Uniques cross-ref**: `listUniques()` from `src/data/uniques.js` has `u.base` = base item name string. Match `u.base === baseItem.name` to find uniques on each base. 304/329 unique base names found in base_items.json (5 failures are parsing artifacts like `'Variant: Pre 0.2.0'`).

---

## Grouping Constants

Define these in `baseItems.js` to group the class browser:

```js
const GROUPS = [
  {
    label: 'Weapons',
    classes: ['Bow', 'Claw', 'Crossbow', 'Dagger', 'Flail', 'FishingRod',
              'One Hand Axe', 'One Hand Mace', 'One Hand Sword', 'Sceptre',
              'Spear', 'Staff', 'TrapTool', 'Two Hand Axe', 'Two Hand Mace',
              'Two Hand Sword', 'Wand', 'Warstaff'],
  },
  {
    label: 'Armour',
    classes: ['Body Armour', 'Boots', 'Buckler', 'Focus', 'Gloves', 'Helmet', 'Shield'],
  },
  {
    label: 'Accessories',
    classes: ['Amulet', 'Belt', 'Quiver', 'Ring', 'Talisman'],
  },
];
```

---

## File Map

| Action | File | Purpose |
|--------|------|---------|
| Create | `src/data/baseItems.js` | Parse base_items.json + item_classes.json; query functions |
| Modify | `src/routes/pages.js` | Add `/bases`, `/bases/:classSlug`, `/base/:slug` routes |
| Create | `views/bases.njk` | Class browser index |
| Create | `views/bases-class.njk` | All bases in a class |
| Create | `views/base.njk` | Base item detail page |
| Modify | `public/css/gem-card.css` | Base item card styles |
| Modify | `views/home.njk` | Add link to bases browser |
| Modify | `src/data/search.js` | Include base item names |
| Create | `test/baseItems.test.js` | Tests for baseItems.js |
| Modify | `test/server.test.js` | Route smoke tests |

---

## Task 1: `src/data/baseItems.js` — data module

**Files:**
- Create: `src/data/baseItems.js`
- Create: `test/baseItems.test.js`

### Step 1a — Write tests first

- [ ] **Step 1: Create `test/baseItems.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  listItemClasses, getItemClass, getBaseItem, buildBaseItemViewModel,
} from '../src/data/baseItems.js';

test('listItemClasses returns grouped categories with counts', () => {
  const groups = listItemClasses();
  assert.ok(Array.isArray(groups));
  const weaponGroup = groups.find((g) => g.label === 'Weapons');
  assert.ok(weaponGroup, 'Weapons group should exist');
  assert.ok(weaponGroup.classes.length > 5);
  assert.ok(weaponGroup.classes[0].classId);
  assert.ok(weaponGroup.classes[0].name);
  assert.ok(weaponGroup.classes[0].classSlug);
  assert.ok(weaponGroup.classes[0].count > 0);
});

test('getItemClass resolves "amulet" class slug', () => {
  const cls = getItemClass('amulet');
  assert.ok(cls);
  assert.equal(cls.name, 'Amulets');
  assert.ok(cls.bases.length >= 20);
  assert.ok(cls.bases[0].slug);
  assert.ok(cls.bases[0].name);
  assert.ok(cls.bases[0].iconUrl);
});

test('getItemClass returns null for unknown class slug', () => {
  assert.equal(getItemClass('not-a-real-class'), null);
});

test('getBaseItem resolves "stellar-amulet"', () => {
  const b = getBaseItem('stellar-amulet');
  assert.ok(b, 'stellar-amulet should exist');
  assert.equal(b.name, 'Stellar Amulet');
  assert.equal(b.itemClass, 'Amulet');
  assert.ok(b.iconUrl.includes('StellarAmulet') || b.iconUrl.includes('Amulet'));
});

test('getBaseItem returns null for unknown slug', () => {
  assert.equal(getBaseItem('not-a-real-base'), null);
});

test('buildBaseItemViewModel includes class display name and tags', () => {
  const vm = buildBaseItemViewModel('stellar-amulet');
  assert.ok(vm);
  assert.equal(vm.name, 'Stellar Amulet');
  assert.equal(vm.className, 'Amulets');
  assert.ok(Array.isArray(vm.tags));
  assert.ok(vm.iconUrl);
});

test('buildBaseItemViewModel includes drop level from requirements', () => {
  const vm = buildBaseItemViewModel('stellar-amulet');
  // Stellar Amulet drop_level verified from data: 25
  assert.ok(typeof vm.dropLevel === 'number');
  assert.ok(vm.dropLevel > 0);
});

test('buildBaseItemViewModel weapon properties: wooden-club has APS and damage', () => {
  const vm = buildBaseItemViewModel('wooden-club');
  assert.ok(vm, 'wooden-club should exist');
  // attack_time=690ms → APS=1.45
  const aps = vm.properties.find((p) => p.label === 'Attacks per Second');
  assert.ok(aps, 'should have APS property');
  assert.equal(aps.value, '1.45');
  const crit = vm.properties.find((p) => p.label === 'Critical Hit Chance');
  assert.ok(crit);
  assert.equal(crit.value, '5%');
  const dmg = vm.properties.find((p) => p.label === 'Physical Damage');
  assert.ok(dmg);
  assert.match(dmg.value, /\d+ to \d+/);
});

test('buildBaseItemViewModel armour: rusted-cuirass has Armour property', () => {
  const vm = buildBaseItemViewModel('rusted-cuirass');
  assert.ok(vm, 'rusted-cuirass should exist');
  const arm = vm.properties.find((p) => p.label === 'Armour');
  assert.ok(arm, 'should have Armour property');
});

test('buildBaseItemViewModel uniquesOnBase links uniques to Stellar Amulet', () => {
  const vm = buildBaseItemViewModel('stellar-amulet');
  assert.ok(vm.uniquesOnBase.length >= 2); // Astramentis, Fixation of Yix, etc.
  assert.ok(vm.uniquesOnBase.every((u) => u.slug && u.name));
  const astra = vm.uniquesOnBase.find((u) => u.name === 'Astramentis');
  assert.ok(astra);
  assert.equal(astra.slug, 'astramentis');
});

test('buildBaseItemViewModel returns null for unknown slug', () => {
  assert.equal(buildBaseItemViewModel('not-a-real-base'), null);
});

test('Energy Blade slug disambiguated by class', () => {
  // Energy Blade exists as both One Hand Sword and Two Hand Sword
  const b1 = getBaseItem('energy-blade--one-hand-sword');
  const b2 = getBaseItem('energy-blade--two-hand-sword');
  assert.ok(b1 || b2, 'at least one Energy Blade disambiguation slug should work');
  if (b1) assert.equal(b1.name, 'Energy Blade');
  if (b2) assert.equal(b2.name, 'Energy Blade');
});
```

- [ ] **Step 2: Run tests to verify they fail**
```bash
node --test test/baseItems.test.js
```
Expected: FAIL — module not found.

### Step 1b — Implement `src/data/baseItems.js`

- [ ] **Step 3: Create `src/data/baseItems.js`**

```js
import { loadJson } from './loader.js';
import { slugify } from './slug.js';
import { ddsUrl } from './images.js';
import { listUniques } from './uniques.js';

const REPOE = 'repoe-poe2';

const GROUPS = [
  {
    label: 'Weapons',
    classes: ['Bow', 'Claw', 'Crossbow', 'Dagger', 'Flail', 'FishingRod',
              'One Hand Axe', 'One Hand Mace', 'One Hand Sword', 'Sceptre',
              'Spear', 'Staff', 'TrapTool', 'Two Hand Axe', 'Two Hand Mace',
              'Two Hand Sword', 'Wand', 'Warstaff'],
  },
  {
    label: 'Armour',
    classes: ['Body Armour', 'Boots', 'Buckler', 'Focus', 'Gloves', 'Helmet', 'Shield'],
  },
  {
    label: 'Accessories',
    classes: ['Amulet', 'Belt', 'Quiver', 'Ring', 'Talisman'],
  },
];

// All class IDs we show in the browser (derived from GROUPS).
const BROWSABLE_CLASSES = new Set(GROUPS.flatMap((g) => g.classes));

// Weapon property display requires these from properties.
const WEAPON_PROPS = ['attack_time', 'critical_strike_chance', 'physical_damage_min', 'physical_damage_max', 'range'];

// Build the property rows for the card view-model.
function buildProperties(props) {
  const out = [];
  if (!props) return out;

  // Weapon damage
  if (props.physical_damage_min != null && props.physical_damage_max != null) {
    out.push({ label: 'Physical Damage', value: `${props.physical_damage_min} to ${props.physical_damage_max}` });
  }
  // Critical hit chance
  if (props.critical_strike_chance != null) {
    out.push({ label: 'Critical Hit Chance', value: `${props.critical_strike_chance / 100}%` });
  }
  // Attacks per second (attack_time in ms)
  if (props.attack_time != null) {
    out.push({ label: 'Attacks per Second', value: (1000 / props.attack_time).toFixed(2) });
  }
  // Weapon range
  if (props.range != null) {
    out.push({ label: 'Weapon Range', value: (props.range / 10).toFixed(1) });
  }
  // Armour-type properties (each is {min, max} or null)
  for (const [key, label] of [
    ['armour', 'Armour'],
    ['evasion', 'Evasion Rating'],
    ['energy_shield', 'Energy Shield'],
    ['ward', 'Ward'],
  ]) {
    const val = props[key];
    if (!val) continue;
    out.push({ label, value: val.min === val.max ? String(val.min) : `${val.min}–${val.max}` });
  }
  // Block chance (integer %)
  if (props.block != null) {
    out.push({ label: 'Block Chance', value: `${props.block}%` });
  }
  // Movement speed penalty (integer / 100)
  if (props.movement_speed != null) {
    out.push({ label: 'Movement Speed', value: `${props.movement_speed / 100}%` });
  }
  return out;
}

// Attribute requirement display labels.
const ATTR_ABBR = { strength: 'Str', dexterity: 'Dex', intelligence: 'Int' };

function buildRequirements(req, dropLevel) {
  const out = [];
  if (dropLevel != null && dropLevel > 0) out.push(`Level ${dropLevel}`);
  if (!req) return out;
  for (const [attr, label] of Object.entries(ATTR_ABBR)) {
    if (req[attr]) out.push(`${req[attr]} ${label}`);
  }
  return out;
}

// Base item slug — if name is unique across all classes use plain slug;
// if it collides with a different class, append '--<class-slug>'.
function buildSlug(name, classId, nameCount) {
  const base = slugify(name);
  return (nameCount[name] ?? 1) > 1 ? `${base}--${slugify(classId)}` : base;
}

let _index = null;       // slug → full record
let _byClass = null;     // classId → [records]
let _classInfo = null;   // classId → {name, classSlug}

function buildIndex() {
  if (_index) return;

  const raw = loadJson(`${REPOE}/base_items.json`);
  const classesRaw = loadJson(`${REPOE}/item_classes.json`);

  // Count how many different item classes share each name (for slug disambiguation).
  const nameClassCount = {};
  for (const v of Object.values(raw)) {
    if (v.domain !== 'item' || v.release_state !== 'released') continue;
    if (!BROWSABLE_CLASSES.has(v.item_class)) continue;
    const key = `${v.name}|${v.item_class}`;
    nameClassCount[key] = (nameClassCount[key] ?? 0) + 1;
  }
  // Count across classes (different item_class for same name).
  const nameAcrossClasses = {};
  for (const k of Object.keys(nameClassCount)) {
    const [name] = k.split('|');
    nameAcrossClasses[name] = (nameAcrossClasses[name] ?? 0) + 1;
  }

  _index = new Map();
  _byClass = new Map();
  _classInfo = new Map();

  // Build class info map.
  for (const [classId, info] of Object.entries(classesRaw)) {
    if (!BROWSABLE_CLASSES.has(classId)) continue;
    _classInfo.set(classId, { name: info.name || classId, classSlug: slugify(classId) });
    _byClass.set(classId, []);
  }

  const seenNameClass = new Set(); // deduplicate same-name/same-class records

  for (const v of Object.values(raw)) {
    if (v.domain !== 'item' || v.release_state !== 'released') continue;
    if (!BROWSABLE_CLASSES.has(v.item_class)) continue;

    const nameClassKey = `${v.name}|${v.item_class}`;
    if (seenNameClass.has(nameClassKey)) continue; // skip duplicate metadata entries
    seenNameClass.add(nameClassKey);

    const slug = buildSlug(v.name, v.item_class, nameAcrossClasses);
    const record = {
      slug,
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

  // Sort each class list by drop level then name.
  for (const [, list] of _byClass) {
    list.sort((a, b) => (a.dropLevel ?? 0) - (b.dropLevel ?? 0) || a.name.localeCompare(b.name));
  }
}

export function listItemClasses() {
  buildIndex();
  return GROUPS.map((g) => ({
    label: g.label,
    classes: g.classes
      .filter((c) => _byClass.has(c))
      .map((c) => ({
        classId: c,
        classSlug: slugify(c),
        name: _classInfo.get(c)?.name ?? c,
        count: _byClass.get(c)?.length ?? 0,
      })),
  }));
}

export function getItemClass(classSlug) {
  buildIndex();
  // Find classId whose slug matches.
  for (const [classId, info] of _classInfo) {
    if (info.classSlug === classSlug) {
      const bases = _byClass.get(classId) ?? [];
      return { ...info, classId, classSlug, bases };
    }
  }
  return null;
}

export function getBaseItem(slug) {
  buildIndex();
  return _index.get(slug) ?? null;
}

export function buildBaseItemViewModel(slug) {
  const b = getBaseItem(slug);
  if (!b) return null;

  // Lazy: find uniques whose base item name matches this item's name.
  const uniquesOnBase = listUniques()
    .filter((u) => u.base === b.name)
    .map((u) => ({ slug: u.slug, name: u.name, iconUrl: u.iconUrl }));

  return { ...b, uniquesOnBase };
}
```

- [ ] **Step 4: Run tests**
```bash
node --test test/baseItems.test.js
```
Expected: All PASS (or one failure on Energy Blade disambiguation if the data doesn't have the exact collision — acceptable if `b1 || b2` succeeds).

- [ ] **Step 5: Run full suite**
```bash
npm test
```
Expected: All existing + new tests PASS.

- [ ] **Step 6: Commit**
```bash
git add src/data/baseItems.js test/baseItems.test.js
git commit -m "feat: base items data module with class grouping, properties, and uniques cross-ref"
```

---

## Task 2: Routes

**Files:**
- Modify: `src/routes/pages.js`
- Modify: `test/server.test.js`

- [ ] **Step 1: Add routes to `src/routes/pages.js`**

Replace the existing file content:

```js
import { buildGemViewModel, listGems } from '../data/gems.js';
import { buildUniqueViewModel, listUniques } from '../data/uniques.js';
import { listItemClasses, getItemClass, buildBaseItemViewModel } from '../data/baseItems.js';

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
    res.render('base.njk', { vm });
  });

  app.locals.gemCount = () => listGems().length;
}
```

- [ ] **Step 2: Add route smoke tests to `test/server.test.js`**

Append to the existing test file:
```js
test('GET /bases returns 200', async () => {
  const app = createApp();
  const res = await request(app).get('/bases');
  assert.equal(res.status, 200);
  assert.ok(res.text.includes('Weapons'));
});

test('GET /bases/amulet returns 200 with base names', async () => {
  const app = createApp();
  const res = await request(app).get('/bases/amulet');
  assert.equal(res.status, 200);
  assert.ok(res.text.includes('Stellar Amulet'));
});

test('GET /base/stellar-amulet returns 200', async () => {
  const app = createApp();
  const res = await request(app).get('/base/stellar-amulet');
  assert.equal(res.status, 200);
  assert.ok(res.text.includes('Stellar Amulet'));
});

test('GET /base/not-a-real-base returns 404', async () => {
  const app = createApp();
  const res = await request(app).get('/base/not-a-real-base');
  assert.equal(res.status, 404);
});
```

- [ ] **Step 3: Create placeholder views** (so routes don't crash before Task 3)

`views/bases.njk`:
```njk
{% extends "base.njk" %}
{% block title %}Base Items — PoE2 Wiki{% endblock %}
{% block content %}
<div class="page" style="flex-direction:column;align-items:center;">
  <h1>Base Items</h1>
  {% for group in groups %}
  <h2>{{ group.label }}</h2>
  {% for cls in group.classes %}
  <a href="/bases/{{ cls.classSlug }}">{{ cls.name }} ({{ cls.count }})</a>
  {% endfor %}
  {% endfor %}
</div>
{% endblock %}
```

`views/bases-class.njk`:
```njk
{% extends "base.njk" %}
{% block title %}{{ cls.name }} — PoE2 Wiki{% endblock %}
{% block content %}
<div class="page" style="flex-direction:column;align-items:center;">
  <h1>{{ cls.name }}</h1>
  {% for b in cls.bases %}
  <a href="/base/{{ b.slug }}">{{ b.name }}</a>
  {% endfor %}
</div>
{% endblock %}
```

`views/base.njk`:
```njk
{% extends "base.njk" %}
{% block title %}{{ vm.name }} — PoE2 Wiki{% endblock %}
{% block content %}
<div class="page">
  <h1>{{ vm.name }}</h1>
</div>
{% endblock %}
```

- [ ] **Step 4: Run tests**
```bash
npm test
```
Expected: All PASS.

- [ ] **Step 5: Commit**
```bash
git add src/routes/pages.js views/bases.njk views/bases-class.njk views/base.njk test/server.test.js
git commit -m "feat: add /bases, /bases/:classSlug, and /base/:slug routes"
```

---

## Task 3: Views — class browser, class listing, base detail

**Files:**
- Modify: `views/bases.njk`
- Modify: `views/bases-class.njk`
- Modify: `views/base.njk`
- Modify: `public/css/gem-card.css`

- [ ] **Step 1: Update `views/bases.njk`** — styled class browser

```njk
{% extends "base.njk" %}
{% block title %}Base Items — PoE2 Wiki{% endblock %}
{% block content %}
<div class="page" style="flex-direction:column;align-items:center;">
  <h1 class="page-title bases-page-title">Base Items</h1>
  {% for group in groups %}
  <section class="bases-group">
    <h2 class="bases-group-title">{{ group.label }}</h2>
    <div class="bases-class-grid">
      {% for cls in group.classes %}
      <a class="bases-class-card" href="/bases/{{ cls.classSlug }}">
        <span class="bases-class-name">{{ cls.name }}</span>
        <span class="bases-class-count">{{ cls.count }}</span>
      </a>
      {% endfor %}
    </div>
  </section>
  {% endfor %}
</div>
{% endblock %}
```

- [ ] **Step 2: Update `views/bases-class.njk`** — styled item grid

```njk
{% extends "base.njk" %}
{% block title %}{{ cls.name }} — Base Items — PoE2 Wiki{% endblock %}
{% block content %}
<div class="page" style="flex-direction:column;align-items:center;">
  <nav class="bases-breadcrumb">
    <a href="/bases">Base Items</a> › {{ cls.name }}
  </nav>
  <h1 class="page-title bases-page-title">{{ cls.name }}</h1>
  <p class="page-subtitle">{{ cls.bases.length }} base items</p>
  <div class="bases-item-grid">
    {% for b in cls.bases %}
    <a class="bases-item-card" href="/base/{{ b.slug }}">
      <img src="{{ b.iconUrl }}" alt="{{ b.name }}" class="bases-item-icon"
           onerror="this.style.visibility='hidden'">
      <div class="bases-item-info">
        <span class="bases-item-name">{{ b.name }}</span>
        {% if b.dropLevel %}<span class="bases-item-level">Lv {{ b.dropLevel }}</span>{% endif %}
      </div>
    </a>
    {% endfor %}
  </div>
</div>
{% endblock %}
```

- [ ] **Step 3: Update `views/base.njk`** — full item detail page (poe2db layout)

```njk
{% extends "base.njk" %}
{% block title %}{{ vm.name }} — PoE2 Wiki{% endblock %}
{% block content %}
<div class="page">
  <div class="gem-detail">
    <nav class="bases-breadcrumb">
      <a href="/bases">Base Items</a> ›
      <a href="/bases/{{ vm.classSlug }}">{{ vm.className }}</a> ›
      {{ vm.name }}
    </nav>
    <div class="unique-item-with-art">
      <div class="newItemPopup NormalPopup item-popup--poe2"
           style="--card-border: rgba(139,139,139,0.7); --card-glow: rgba(100,100,100,0.3);">
        <div class="itemHeader doubleLine">
          <div class="itemName"><span class="lc normal-name">{{ vm.name }}</span></div>
          <div class="itemName typeLine"><span class="lc normal-type">{{ vm.className }}</span></div>
        </div>
        <div class="content">
          <div class="Stats">
            {% for prop in vm.properties %}
            <div class="property">{{ prop.label }}: <span class="colourDefault">{{ prop.value }}</span></div>
            {% endfor %}
            {% if vm.requirements.length %}
            <div class="separator"></div>
            <div class="requirements">Requires:
              {% for r in vm.requirements %}<span class="colourDefault">{{ r }}</span>{% if not loop.last %}, {% endif %}{% endfor %}
            </div>
            {% endif %}
            {% if vm.inventorySize %}
            <div class="separator"></div>
            <div class="property">Size: <span class="colourDefault">{{ vm.inventorySize.w }}×{{ vm.inventorySize.h }}</span></div>
            {% endif %}
            {% if vm.tags.length %}
            <div class="property">Tags: <span class="colourDefault">{{ vm.tags | join(', ') }}</span></div>
            {% endif %}
          </div>
          {% if vm.uniquesOnBase.length %}
          <div class="separator"></div>
          <div class="base-uniques-section">
            <div class="base-uniques-title">Unique versions</div>
            {% for u in vm.uniquesOnBase %}
            <a class="base-unique-link" href="/unique/{{ u.slug }}">
              {% if u.iconUrl %}<img src="{{ u.iconUrl }}" alt="{{ u.name }}" class="base-unique-icon"
                   onerror="this.style.visibility='hidden'">{% endif %}
              {{ u.name }}
            </a>
            {% endfor %}
          </div>
          {% endif %}
        </div>
      </div>
      <div class="itemboximage">
        <img loading="lazy" src="{{ vm.iconUrl }}" alt="{{ vm.name }}"
             onerror="this.style.visibility='hidden'">
      </div>
    </div>
  </div>
</div>
{% endblock %}
```

- [ ] **Step 4: Add CSS to `public/css/gem-card.css`** (append at end)

```css
/* Normal item card header (no gem/unique banner; gray name) */
.NormalPopup .itemHeader.doubleLine {
  background: linear-gradient(180deg,
    rgba(30,30,30,0.95) 0%,
    rgba(15,15,15,0.98) 100%);
  border-bottom: 1px solid rgba(139,139,139,0.3);
  height: auto;
  min-height: 54px;
  padding: 8px 14px;
  justify-content: center;
  text-align: center;
}

.NormalPopup .normal-name {
  color: var(--color-normal);
  padding: 0;
  text-align: center;
}

.NormalPopup .normal-type {
  color: var(--color-prop);
  padding: 0;
  font-size: 13px;
  text-align: center;
}

/* Unique versions section inside the base card */
.base-uniques-section {
  padding: 6px 12px 10px;
}

.base-uniques-title {
  color: var(--color-prop);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 6px;
}

.base-unique-link {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--unique-color);
  text-decoration: none;
  font-size: 12.5px;
  padding: 2px 0;
}

.base-unique-link:hover { text-decoration: underline; }

.base-unique-icon {
  width: 24px;
  height: 24px;
  object-fit: contain;
  flex-shrink: 0;
}

/* Base item class browser */
.bases-page-title {
  font-family: 'OptimusPrincepsSemiBold', serif;
  color: var(--color-normal);
}

.bases-group {
  width: 100%;
  max-width: 900px;
  margin-bottom: 24px;
}

.bases-group-title {
  color: var(--color-prop);
  font-family: 'OptimusPrincepsSemiBold', serif;
  font-size: 16px;
  margin: 0 0 8px;
  border-bottom: 1px solid var(--border);
  padding-bottom: 4px;
}

.bases-class-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 6px;
}

.bases-class-card {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: 4px;
  text-decoration: none;
  color: var(--color-normal);
  font-family: 'FontinSmallCaps', serif;
  font-size: 13px;
  transition: border-color 0.15s;
}

.bases-class-card:hover { border-color: var(--color-normal); }

.bases-class-count {
  color: var(--color-default);
  font-size: 11px;
}

/* Class listing grid */
.bases-item-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 6px;
  width: 100%;
  max-width: 900px;
  padding: 8px 0;
}

.bases-item-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 12px;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: 4px;
  text-decoration: none;
  color: var(--color-normal);
  font-family: 'FontinSmallCaps', serif;
  font-size: 13px;
  transition: border-color 0.15s;
}

.bases-item-card:hover { border-color: var(--color-normal); }

.bases-item-icon {
  width: 28px;
  height: 28px;
  object-fit: contain;
  flex-shrink: 0;
}

.bases-item-info {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
}

.bases-item-name {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.bases-item-level {
  color: var(--color-default);
  font-size: 11px;
}

.bases-breadcrumb {
  width: 100%;
  max-width: 900px;
  font-size: 12px;
  color: var(--color-default);
  margin-bottom: 8px;
}

.bases-breadcrumb a {
  color: var(--color-prop);
  text-decoration: none;
}

.bases-breadcrumb a:hover { color: var(--color-normal); }
```

- [ ] **Step 5: Run tests**
```bash
npm test
```
Expected: All PASS.

- [ ] **Step 6: Commit**
```bash
git add views/bases.njk views/bases-class.njk views/base.njk public/css/gem-card.css
git commit -m "feat: base item browser views and CSS"
```

---

## Task 4: Navigation — home page link + search

**Files:**
- Modify: `views/home.njk`
- Modify: `src/data/search.js`
- Modify: `test/search.test.js`

- [ ] **Step 1: Update `views/home.njk`**

```njk
{% extends "base.njk" %}
{% block content %}
<div class="page" style="flex-direction:column;align-items:center;">
  <h1 style="font-family:'OptimusPrincepsSemiBold',serif;color:var(--color-unique);">
    Path of Exile 2 Wiki
  </h1>
  {% if notFound %}<p>No result found for "{{ notFound }}".</p>{% endif %}
  <p>Search for a skill gem, unique, or base item above.</p>
  <div class="home-links">
    <a href="/gem/herald-of-ash" style="color:var(--color-gem);">Herald of Ash (gem)</a>
    <a href="/uniques" style="color:var(--color-unique);">Browse Unique Items →</a>
    <a href="/bases" style="color:var(--color-normal);">Browse Base Items →</a>
  </div>
</div>
{% endblock %}
```

- [ ] **Step 2: Extend `src/data/search.js`** to include base items

```js
import { listGems } from './gems.js';
import { listUniques } from './uniques.js';
import { listItemClasses, getItemClass } from './baseItems.js';

let _docs = null;

function docs() {
  if (_docs) return _docs;
  const gems = listGems().map((g) => ({
    name: g.name,
    slug: g.slug,
    url: `/gem/${g.slug}`,
    haystack: g.name.toLowerCase(),
  }));
  const uniques = listUniques().map((u) => ({
    name: u.name,
    slug: u.slug,
    url: `/unique/${u.slug}`,
    haystack: u.name.toLowerCase(),
  }));
  const bases = listItemClasses()
    .flatMap((g) => g.classes)
    .flatMap((cls) => (getItemClass(cls.classSlug)?.bases ?? []))
    .map((b) => ({
      name: b.name,
      slug: b.slug,
      url: `/base/${b.slug}`,
      haystack: b.name.toLowerCase(),
    }));
  _docs = [...gems, ...uniques, ...bases];
  return _docs;
}

export function search(q, limit = 20) {
  const needle = (q ?? '').trim().toLowerCase();
  if (!needle) return [];
  const out = [];
  for (const d of docs()) {
    if (d.haystack.includes(needle)) {
      out.push({ name: d.name, slug: d.slug, url: d.url });
      if (out.length >= limit) break;
    }
  }
  return out;
}
```

- [ ] **Step 3: Add search test** to `test/search.test.js`

Append:
```js
test('search finds base items by name', () => {
  const results = search('stellar amulet');
  assert.ok(results.length > 0);
  const hit = results.find((r) => r.name === 'Stellar Amulet');
  assert.ok(hit, 'Stellar Amulet should appear in search');
  assert.equal(hit.url, '/base/stellar-amulet');
});
```

- [ ] **Step 4: Run tests**
```bash
npm test
```
Expected: All PASS.

- [ ] **Step 5: Commit**
```bash
git add views/home.njk src/data/search.js test/search.test.js
git commit -m "feat: extend search to include base items; link from home page"
```

---

## Self-Review

**Spec coverage:**
- [x] `base_items.json` grouped by `item_classes.json` — Tasks 1, 3
- [x] Browse by class — `/bases` index (Task 3) + `/bases/:classSlug` class listing (Task 3)
- [x] Base detail page with inventory size, tags, attribute reqs, icon — Task 3 (`views/base.njk`)
- [x] Link base → uniques on that base — Task 3 (`vm.uniquesOnBase`, rendered in `base.njk`)
- [x] Link base → applicable mods — **NOT included**: mods require `mods.json` + stat translations, which is the next backlog item. The base page has a placeholder "base link" in the unique detail page already (`/base/{{ vm.baseSlug }}`) which now resolves.
- [x] Search extended — Task 4
- [x] Navigation — Task 4

**Placeholder scan:** None. All tasks contain complete code.

**Type consistency:**
- `listItemClasses()` → `[{ label, classes: [{classId, classSlug, name, count}] }]` — used in Task 2 route and Task 3 view correctly
- `getItemClass(classSlug)` → `{ name, classId, classSlug, bases: [record] }` — used in Task 2 route and Task 3 view correctly
- `buildBaseItemViewModel(slug)` → `{ ...record, uniquesOnBase: [{slug, name, iconUrl}] }` — used in Task 3 `base.njk` view correctly
- `record.inventorySize = { w, h }` — used as `vm.inventorySize.w` / `vm.inventorySize.h` in view ✓
- `record.requirements` → `string[]` — used in view as `{% for r in vm.requirements %}` ✓
- `record.properties` → `[{label, value}]` — used in view as `{% for prop in vm.properties %}` ✓
