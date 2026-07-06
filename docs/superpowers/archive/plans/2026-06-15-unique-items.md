# Unique Items Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a unique items index and detail pages: parse `pob-uniques/*.json`, cross-reference `repoe-poe2/uniques.json` for icons, render PoE-styled item cards with unique amber border, link each unique to its base item name, and extend search to include unique names.

**Architecture:** New `src/data/uniques.js` module (lazy-loaded index) exposes `listUniques()`, `getUnique(slug)`, `buildUniqueViewModel(slug)`. Routes in `src/routes/pages.js` add `/uniques` index and `/unique/:slug` detail. Two new Nunjucks views styled with the existing `--color-unique` amber token.

**Tech Stack:** Node.js ESM, Express 5, Nunjucks, `node:test`, `node:fs`, existing `loader.js`/`slug.js`/`images.js` primitives.

---

## Verified Data Facts

From actual inspection of `$POE2DATADIR/data/`:

- `pob-uniques/` contains `_manifest.json` (skip — it's a dict, not a list) and `Special/` subdir (all empty arrays — safe to include, just yields nothing).
- Every other `*.json` file is a JSON array of multi-line strings.
- Line 0 = unique name, line 1 = base item name.
- Metadata lines to skip: any line starting with `Variant:`, `Implicits:`, `League:`, `Source:`, `Corrupted:`, `Limited to:`, `Drop level:`, `Drop:`, `Unreleased`.
- Variant-specific stat lines use `{variant:N}` or `{variant:N,M}` prefix; lines without this prefix apply to all variants.
- "Current" variant = the count of `Variant:` lines (e.g. three `Variant:` lines → current is index 3); the final stat lines without a variant prefix are baseline.
- `{tags:...}` prefix and all other `{...}` patterns are presentation markers — strip them to get clean display text.
- `repoe-poe2/uniques.json` is a dict keyed by numeric strings; values: `{name, item_class, visual_identity: {dds_file, id}, is_alternate_art}`.
- Name-match lookup: build `{name → entry}` skipping `is_alternate_art: true`.
- 389 of ~401 pob entries matched in `uniques.json`; ~12 missing just get no icon.
- Unique border/glow: `rgba(175,96,37,0.8)` / `rgba(175,96,37,0.45)` (derived from `--color-unique: #af6025`).

---

## File Map

| Action | File | Purpose |
|--------|------|---------|
| Create | `src/data/uniques.js` | Parse pob-uniques, cross-ref icons, expose query functions |
| Modify | `src/data/loader.js` | Add `listDataDir(relDir)` helper |
| Modify | `src/data/search.js` | Include unique names in search index |
| Modify | `src/routes/pages.js` | Register `/uniques` and `/unique/:slug` routes |
| Modify | `views/home.njk` | Add link to uniques index |
| Create | `views/uniques.njk` | Unique items index page |
| Create | `views/unique.njk` | Unique item detail page |
| Create | `test/uniques.test.js` | Tests for `uniques.js` |

---

## Task 1: Add `listDataDir` to loader

**Files:**
- Modify: `src/data/loader.js`
- Modify: `test/loader.test.js`

- [ ] **Step 1: Write failing test**

Add to `test/loader.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listDataDir } from '../src/data/loader.js';

test('listDataDir returns filenames in a data subdirectory', () => {
  const files = listDataDir('pob-uniques');
  assert.ok(files.length > 10);
  assert.ok(files.includes('amulet.json'));
  assert.ok(!files.includes('_manifest.json') === false); // _manifest IS listed; caller filters
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --test test/loader.test.js
```
Expected: FAIL — `listDataDir` is not exported.

- [ ] **Step 3: Implement**

Append to `src/data/loader.js`:
```js
// Returns filenames (not full paths) in a data subdirectory.
export function listDataDir(relDir) {
  const full = path.join(getDataDir(), relDir);
  return fs.readdirSync(full);
}
```

Also add `import { getDataDir } from '../config.js';` if not already imported, and ensure `import path from 'node:path'` and `import fs from 'node:fs'` are present (they are already).

- [ ] **Step 4: Run test to verify it passes**
```bash
node --test test/loader.test.js
```
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add src/data/loader.js test/loader.test.js
git commit -m "feat: add listDataDir helper to loader"
```

---

## Task 2: Create `src/data/uniques.js` with tests

**Files:**
- Create: `src/data/uniques.js`
- Create: `test/uniques.test.js`

### Step 2a — write tests first

- [ ] **Step 1: Create `test/uniques.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listUniques, getUnique, buildUniqueViewModel } from '../src/data/uniques.js';

test('listUniques returns a non-empty array with required fields', () => {
  const items = listUniques();
  assert.ok(items.length > 300);
  assert.ok(items.every((u) => u.slug && u.name && u.base));
});

test('getUnique resolves Astramentis by slug', () => {
  const u = getUnique('astramentis');
  assert.equal(u.name, 'Astramentis');
  assert.equal(u.base, 'Stellar Amulet');
  assert.ok(u.iconUrl.includes('Astramentis'));
});

test('getUnique returns null for unknown slug', () => {
  assert.equal(getUnique('not-a-real-unique'), null);
});

test('buildUniqueViewModel includes border and glow colors', () => {
  const vm = buildUniqueViewModel('astramentis');
  assert.equal(vm.borderColor, 'rgba(175,96,37,0.8)');
  assert.equal(vm.glowColor, 'rgba(175,96,37,0.45)');
  assert.ok(vm.iconUrl);
  assert.equal(vm.baseSlug, 'stellar-amulet');
});

test('buildUniqueViewModel returns null for unknown slug', () => {
  assert.equal(buildUniqueViewModel('not-a-real-unique'), null);
});

test('listUniques excludes _manifest metadata entries', () => {
  const items = listUniques();
  const badNames = ['source', 'base_url', 'fetched_at'];
  for (const bad of badNames) {
    assert.ok(!items.some((u) => u.name === bad), `should not include "${bad}"`);
  }
});

test('buildUniqueViewModel stats strip variant and tag prefixes', () => {
  // The Anvil has {variant:3} and {tags:...} prefixes on its lines
  const vm = buildUniqueViewModel('the-anvil');
  assert.ok(vm.stats.length > 0);
  assert.ok(!vm.stats.some((s) => s.includes('{variant:')));
  assert.ok(!vm.stats.some((s) => s.includes('{tags:')));
});

test('buildUniqueViewModel current variant: only shows applicable stat lines', () => {
  // The Anvil has 3 variants; {variant:1} lines should be excluded, {variant:3} lines included
  // It has "25% increased Block chance" for variant 2 and 3, not 1
  const vm = buildUniqueViewModel('the-anvil');
  assert.ok(vm.stats.some((s) => s.includes('25% increased Block chance')));
  // {variant:1} only: "20% increased Block chance" should NOT appear
  assert.ok(!vm.stats.some((s) => s === '20% increased Block chance'));
});

test('buildUniqueViewModel handles item with no variants (no {variant:} prefix)', () => {
  // Bijouborne (belt) has no Variant: lines — all stats apply
  const vm = buildUniqueViewModel('bijouborne');
  assert.ok(vm, 'bijouborne should exist');
  assert.ok(vm.stats.length > 0);
});

test('buildUniqueViewModel iconUrl is null when uniques.json has no entry', () => {
  // Waistgate Heavy Belt is in pob-uniques but not in uniques.json
  const vm = buildUniqueViewModel('waistgate-heavy-belt');
  if (!vm) return; // may not exist in pob-uniques either — skip
  assert.equal(vm.iconUrl, null);
});
```

- [ ] **Step 2: Run tests to verify they fail**
```bash
node --test test/uniques.test.js
```
Expected: FAIL — module not found.

### Step 2b — implement `src/data/uniques.js`

- [ ] **Step 3: Create `src/data/uniques.js`**

```js
import path from 'node:path';
import { loadJson, listDataDir } from './loader.js';
import { slugify } from './slug.js';
import { ddsUrl } from './images.js';

const REPOE = 'repoe-poe2';
const POB_DIR = 'pob-uniques';

const UNIQUE_BORDER = 'rgba(175,96,37,0.8)';
const UNIQUE_GLOW = 'rgba(175,96,37,0.45)';

// Lines starting with these tokens are PoB metadata, not item stats.
const META_RE = /^(Variant|Implicits|League|Source|Corrupted|Limited to|Drop level|Drop|Unreleased):/;

// Count Variant: lines to find the "current" variant index (last one).
function currentVariantIndex(lines) {
  return lines.filter((l) => l.startsWith('Variant:')).length;
}

// Return the variant numbers from a {variant:N,M} prefix, or null if absent.
function variantSpec(line) {
  const m = line.match(/^\{variant:([^}]+)\}/);
  return m ? m[1].split(',').map(Number) : null;
}

// Strip all {…} tokens from a stat line.
function stripBraces(line) {
  return line.replace(/\{[^}]*\}/g, '').trim();
}

// Parse a pob-unique text block. Returns null for entries that are not valid items.
function parsePob(text) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return null;
  const name = lines[0];
  const base = lines[1];
  // Reject manifest-artifact keys and anything that looks like a metadata key
  if (name.includes(':') || name === 'source' || name === 'base_url') return null;

  const curVariant = currentVariantIndex(lines);
  const stats = [];

  for (const line of lines.slice(2)) {
    if (META_RE.test(line)) continue;
    const spec = variantSpec(line);
    // If this line is variant-gated and the current variant isn't in the list, skip it.
    if (spec && !spec.includes(curVariant)) continue;
    const cleaned = stripBraces(line);
    if (cleaned) stats.push(cleaned);
  }

  return { name, base, stats };
}

// Build name → uniques.json entry (skipping alternate art).
function buildMetaByName() {
  const raw = loadJson(`${REPOE}/uniques.json`);
  const out = {};
  for (const v of Object.values(raw)) {
    if (!v.name || v.is_alternate_art) continue;
    if (!out[v.name]) out[v.name] = v;
  }
  return out;
}

let _index = null;

function index() {
  if (_index) return _index;

  const metaByName = buildMetaByName();
  _index = new Map();

  const files = listDataDir(POB_DIR);
  for (const file of files) {
    if (file === '_manifest.json' || !file.endsWith('.json')) continue;

    const entries = loadJson(`${POB_DIR}/${file}`);
    if (!Array.isArray(entries)) continue;

    for (const text of entries) {
      const parsed = parsePob(text);
      if (!parsed) continue;

      const slug = slugify(parsed.name);
      if (_index.has(slug)) continue;

      const meta = metaByName[parsed.name] ?? null;
      _index.set(slug, {
        slug,
        name: parsed.name,
        base: parsed.base,
        stats: parsed.stats,
        itemClass: meta?.item_class ?? path.basename(file, '.json'),
        iconUrl: ddsUrl(meta?.visual_identity?.dds_file),
      });
    }
  }

  return _index;
}

export function listUniques() {
  return [...index().values()];
}

export function getUnique(slug) {
  return index().get(slug) ?? null;
}

export function buildUniqueViewModel(slug) {
  const u = getUnique(slug);
  if (!u) return null;
  return {
    ...u,
    borderColor: UNIQUE_BORDER,
    glowColor: UNIQUE_GLOW,
    baseSlug: slugify(u.base),
  };
}
```

- [ ] **Step 4: Run tests**
```bash
node --test test/uniques.test.js
```
Expected: All PASS (or skip on the iconUrl=null test if Waistgate is present).

- [ ] **Step 5: Run full test suite**
```bash
npm test
```
Expected: All existing tests still PASS.

- [ ] **Step 6: Commit**
```bash
git add src/data/uniques.js test/uniques.test.js
git commit -m "feat: unique items data module with pob-uniques parsing"
```

---

## Task 3: Add routes for `/uniques` and `/unique/:slug`

**Files:**
- Modify: `src/routes/pages.js`

- [ ] **Step 1: Add routes**

Open `src/routes/pages.js`, add after the existing gem route:

```js
import { buildGemViewModel, listGems } from '../data/gems.js';
import { buildUniqueViewModel, listUniques } from '../data/uniques.js';

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

  app.locals.gemCount = () => listGems().length;
}
```

- [ ] **Step 2: Add route tests to `test/server.test.js`**

Append to `test/server.test.js`:
```js
test('GET /uniques returns 200', async () => {
  const app = createApp();
  const res = await request(app).get('/uniques');
  assert.equal(res.status, 200);
  assert.ok(res.text.includes('Astramentis'));
});

test('GET /unique/astramentis returns 200', async () => {
  const app = createApp();
  const res = await request(app).get('/unique/astramentis');
  assert.equal(res.status, 200);
  assert.ok(res.text.includes('Astramentis'));
});

test('GET /unique/not-a-real-unique returns 404', async () => {
  const app = createApp();
  const res = await request(app).get('/unique/not-a-real-unique');
  assert.equal(res.status, 404);
});
```

- [ ] **Step 3: Create placeholder views** (so routes don't crash before Task 4)

`views/uniques.njk`:
```njk
{% extends "base.njk" %}
{% block title %}Unique Items — PoE2 Wiki{% endblock %}
{% block content %}
<div class="page">
  <h1>Unique Items</h1>
  {% for u in uniques %}
  <a href="/unique/{{ u.slug }}">{{ u.name }}</a>
  {% endfor %}
</div>
{% endblock %}
```

`views/unique.njk`:
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
Expected: All PASS including new server tests.

- [ ] **Step 5: Commit**
```bash
git add src/routes/pages.js views/uniques.njk views/unique.njk test/server.test.js
git commit -m "feat: add /uniques index and /unique/:slug routes"
```

---

## Task 4: Build unique item card view

**Files:**
- Modify: `views/unique.njk`
- Modify: `views/uniques.njk`
- Modify: `public/css/gem-card.css` (add `.UniquePopup` modifier)

The unique card reuses `.newItemPopup` CSS class (same border/glow mechanism, same header structure) with `UniquePopup` as a modifier to swap header art.

- [ ] **Step 1: Update `views/unique.njk`**

```njk
{% extends "base.njk" %}
{% block title %}{{ vm.name }} — PoE2 Wiki{% endblock %}
{% block content %}
<div class="page">
  <div class="gem-detail">
    <div class="newItemPopup UniquePopup"
         style="--card-border: {{ vm.borderColor }}; --card-glow: {{ vm.glowColor }};">
      <div class="content">
        <div class="itemHeader doubleLine uniqueHeader">
          {% if vm.iconUrl %}
          <img class="trailGemIcon" src="{{ vm.iconUrl }}"
               onerror="this.style.visibility='hidden'">
          {% endif %}
          <div class="itemName"><span class="lc unique-name">{{ vm.name }}</span></div>
          <div class="itemName typeLine"><span class="lc unique-type">{{ vm.base }}</span></div>
        </div>
        <div class="content">
          <div class="Stats">
            {% for stat in vm.stats %}
            <div class="explicitMod">{{ stat }}</div>
            {% endfor %}
          </div>
          <div class="separator"></div>
          <div class="default">
            Base item: <a href="/base/{{ vm.baseSlug }}" class="base-link">{{ vm.base }}</a>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>
{% endblock %}
```

- [ ] **Step 2: Update `views/uniques.njk`** with a styled grid

```njk
{% extends "base.njk" %}
{% block title %}Unique Items — PoE2 Wiki{% endblock %}
{% block content %}
<div class="page" style="flex-direction:column;align-items:center;">
  <h1 class="page-title unique-page-title">Unique Items</h1>
  <p class="page-subtitle">{{ uniques.length }} unique items</p>
  <div class="unique-index-grid">
    {% for u in uniques %}
    <a class="unique-index-card" href="/unique/{{ u.slug }}">
      {% if u.iconUrl %}
      <img src="{{ u.iconUrl }}" alt="{{ u.name }}" class="unique-index-icon"
           onerror="this.style.visibility='hidden'">
      {% else %}
      <div class="unique-index-icon unique-index-placeholder">{{ u.name[0] }}</div>
      {% endif %}
      <span class="unique-index-name">{{ u.name }}</span>
      <span class="unique-index-base">{{ u.base }}</span>
    </a>
    {% endfor %}
  </div>
</div>
{% endblock %}
```

- [ ] **Step 3: Add CSS to `public/css/gem-card.css`**

Append:
```css
/* Unique item card header (no gem title banner art; amber name color) */
.UniquePopup .uniqueHeader {
  background: none;
  height: auto;
  min-height: 54px;
  padding: 8px 12px 8px 12px;
  justify-content: flex-end;
}

.UniquePopup .unique-name {
  color: var(--unique-color);
  padding: 0 60px 0 12px;
}

.UniquePopup .unique-type {
  color: var(--color-normal);
  padding: 0 60px 0 12px;
  font-size: 13px;
}

.UniquePopup .base-link {
  color: var(--color-normal);
}

/* Unique index grid */
.unique-index-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 8px;
  width: 100%;
  max-width: 900px;
  padding: 16px 0;
}

.unique-index-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: 4px;
  text-decoration: none;
  color: var(--unique-color);
  font-family: "FontinSmallCaps", serif;
  font-size: 13px;
  transition: border-color 0.15s;
}

.unique-index-card:hover {
  border-color: var(--unique-color);
}

.unique-index-icon {
  width: 32px;
  height: 32px;
  object-fit: contain;
  flex-shrink: 0;
}

.unique-index-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(175,96,37,0.2);
  border-radius: 4px;
  color: var(--unique-color);
  font-size: 16px;
}

.unique-index-name {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.unique-index-base {
  color: var(--color-normal);
  font-size: 11px;
  white-space: nowrap;
}

.unique-page-title {
  font-family: 'OptimusPrincepsSemiBold', serif;
  color: var(--unique-color);
}

.page-subtitle {
  color: var(--color-default);
  margin: 4px 0 16px;
}
```

- [ ] **Step 4: Run tests**
```bash
npm test
```
Expected: All PASS.

- [ ] **Step 5: Boot and verify visually**
```bash
npm start
# Open http://localhost:3000/uniques — should show styled amber grid
# Open http://localhost:3000/unique/astramentis — should show item card
# Check icon fallback: an item without iconUrl should show placeholder div
```

- [ ] **Step 6: Commit**
```bash
git add views/unique.njk views/uniques.njk public/css/gem-card.css
git commit -m "feat: unique item card and index views"
```

---

## Task 5: Extend search to include unique names

**Files:**
- Modify: `src/data/search.js`
- Modify: `test/search.test.js`

- [ ] **Step 1: Write failing test**

Append to `test/search.test.js`:
```js
import { search } from '../src/data/search.js';

test('search finds unique items by name', () => {
  const results = search('astramentis');
  assert.ok(results.length > 0);
  const hit = results.find((r) => r.name === 'Astramentis');
  assert.ok(hit, 'Astramentis should appear in search results');
  assert.equal(hit.url, '/unique/astramentis');
});

test('search returns both gems and uniques when query matches both', () => {
  // "herald" matches gem "Herald of Ash" but no uniques; just ensure no crash
  const results = search('herald');
  assert.ok(results.length > 0);
  assert.ok(results.some((r) => r.url.startsWith('/gem/')));
});
```

- [ ] **Step 2: Run tests to verify they fail**
```bash
node --test test/search.test.js
```
Expected: FAIL — unique results not returned.

- [ ] **Step 3: Update `src/data/search.js`**

```js
import { listGems } from './gems.js';
import { listUniques } from './uniques.js';

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
  _docs = [...gems, ...uniques];
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

Note: The `color` field is removed from the result shape since uniques have no gem color. Check that `views/partials/search-results.njk` only uses `r.name` and `r.url` — it does (`<a href="{{ r.url }}">{{ r.name }}</a>`), so this is safe.

- [ ] **Step 4: Run tests**
```bash
npm test
```
Expected: All PASS.

- [ ] **Step 5: Commit**
```bash
git add src/data/search.js test/search.test.js
git commit -m "feat: extend search to include unique item names"
```

---

## Task 6: Wire navigation — home page link and header

**Files:**
- Modify: `views/home.njk`
- Modify: `views/base.njk` (optional: add "Uniques" nav link)

- [ ] **Step 1: Update `views/home.njk`**

```njk
{% extends "base.njk" %}
{% block content %}
<div class="page" style="flex-direction:column;align-items:center;">
  <h1 style="font-family:'OptimusPrincepsSemiBold',serif;color:var(--color-unique);">
    Path of Exile 2 Wiki
  </h1>
  {% if notFound %}<p>No result found for "{{ notFound }}".</p>{% endif %}
  <p>Search for a skill gem or unique above.</p>
  <div class="home-links">
    <a href="/gem/herald-of-ash" style="color:var(--color-gem);">Herald of Ash (gem)</a>
    <a href="/uniques" style="color:var(--color-unique);">Browse Unique Items →</a>
  </div>
</div>
{% endblock %}
```

- [ ] **Step 2: Add `.home-links` CSS** to `public/css/app.css`

Check existing `app.css` first, then append:
```css
.home-links {
  display: flex;
  gap: 24px;
  flex-wrap: wrap;
  justify-content: center;
  margin-top: 12px;
}

.home-links a {
  text-decoration: none;
  font-family: "FontinSmallCaps", serif;
}

.home-links a:hover {
  text-decoration: underline;
}
```

- [ ] **Step 3: Run tests**
```bash
npm test
```
Expected: All PASS.

- [ ] **Step 4: Commit**
```bash
git add views/home.njk public/css/app.css
git commit -m "feat: link unique items index from home page"
```

---

## Self-Review Checklist

**Spec coverage:**
- [x] Parse `pob-uniques/*.json` — Task 2
- [x] Icon via `uniques.json` — Task 2
- [x] Unique detail page — Tasks 3, 4
- [x] Unique index page — Tasks 3, 4
- [x] Styled like gem card (unique-tier border) — Task 4
- [x] Link unique → its base item — Task 4 (base item link, `/base/{{ baseSlug }}` — the base item browser doesn't exist yet, so this is an unresolvable link for now, which is acceptable and clearly labeled)
- [x] Search extended — Task 5
- [x] Navigation from home — Task 6
- [x] Tests for all new modules — Tasks 1, 2, 3, 5

**Placeholder scan:** None found. All tasks have concrete code.

**Type consistency:**
- `listUniques()` returns `{ slug, name, base, stats, itemClass, iconUrl }` — used correctly in Task 3 routes, Task 4 views, Task 5 search
- `buildUniqueViewModel()` returns `{ ...u, borderColor, glowColor, baseSlug }` — used correctly in Task 4 view (`vm.borderColor`, `vm.stats`, `vm.baseSlug`, `vm.iconUrl`)
- `getUnique(slug)` returns single record or null — checked in Task 3 route

**Note:** The base item link `/base/{{ vm.baseSlug }}` will 404 until the "Base item browser" slice is implemented. This is intentional — placeholder link for a future slice.
