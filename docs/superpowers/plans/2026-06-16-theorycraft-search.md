# Theory Crafting Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/theorycraft` page that searches all wiki content (gems, supports, spirit skills, uniques, affixes, keystones, notables, bases) via a simple `field:value`-plus-free-text query language, rendering results grouped by category.

**Architecture:** A new pure-JS module `src/data/theorycraft.js` provides `parseQuery` (tokenizer → AST), `docMatches`/`runQuery` (matcher + grouping), and `allDocs` (a lazily-built, cached index enriched with deep text per item). A new route module renders a full page plus an htmx results partial, mirroring the existing `/search` pattern. No external dependencies.

**Tech Stack:** Node.js ESM, Express, Nunjucks templates, htmx (already vendored), `node:test` + `supertest` for tests.

## Global Constraints

- ESM modules only (`import`/`export`), matching the rest of `src/`.
- No new npm dependencies — parser and matcher are hand-rolled.
- All matching is case-insensitive (lowercase both sides).
- Query language v1 is free-text + `field:value` + `-exclusion` + `"quoted phrase"` + implicit AND. No regex terms, no boolean OR/parens.
- Known fields: `type`, `color`, `tag`, `req`, `grants`. Unknown field names degrade to a free-text term (never error).
- The existing header dropdown search (`/search`, `src/data/search.js`) must remain unchanged.
- Per-group result cap: 100, with a "showing N of M" note when exceeded.

---

## File Structure

- Create: `src/data/theorycraft.js` — parser, matcher, grouping, index. One responsibility: cross-content query.
- Create: `src/routes/theorycraft.js` — two routes (page + results partial).
- Create: `views/theorycraft.njk` — page shell with query input.
- Create: `views/partials/theorycraft-results.njk` — grouped results fragment (htmx target).
- Create: `test/theorycraft.test.js` — parser + matcher unit tests, render tests.
- Modify: `src/server.js` — register the new route module.
- Modify: `views/base.njk` — add a "Theory Crafting" nav item.
- Modify: `public/css/app.css` — append Theory Crafting styles.

---

## Task 1: Query parser (`parseQuery`)

**Files:**
- Create: `src/data/theorycraft.js`
- Test: `test/theorycraft.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `parseQuery(q: string) -> { terms: Array<Term> }` where
  `Term = { kind: 'text', value: string, negate: boolean } | { kind: 'field', field: 'type'|'color'|'tag'|'req'|'grants', value: string, negate: boolean }`. All `value`s lowercased.

- [ ] **Step 1: Write the failing test**

Create `test/theorycraft.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQuery } from '../src/data/theorycraft.js';

test('parseQuery: bare words become free-text terms', () => {
  assert.deepEqual(parseQuery('cold chaos').terms, [
    { kind: 'text', value: 'cold', negate: false },
    { kind: 'text', value: 'chaos', negate: false },
  ]);
});

test('parseQuery: known field:value becomes a field term', () => {
  assert.deepEqual(parseQuery('type:support').terms, [
    { kind: 'field', field: 'type', value: 'support', negate: false },
  ]);
});

test('parseQuery: leading dash negates', () => {
  assert.deepEqual(parseQuery('-type:unique -chaos').terms, [
    { kind: 'field', field: 'type', value: 'unique', negate: true },
    { kind: 'text', value: 'chaos', negate: true },
  ]);
});

test('parseQuery: quoted phrase is one free-text term', () => {
  assert.deepEqual(parseQuery('"cast speed"').terms, [
    { kind: 'text', value: 'cast speed', negate: false },
  ]);
});

test('parseQuery: unknown field degrades to free text (field name dropped)', () => {
  assert.deepEqual(parseQuery('dmg:fire').terms, [
    { kind: 'text', value: 'fire', negate: false },
  ]);
});

test('parseQuery: empty/whitespace yields no terms', () => {
  assert.deepEqual(parseQuery('').terms, []);
  assert.deepEqual(parseQuery('   ').terms, []);
  assert.deepEqual(parseQuery(null).terms, []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/theorycraft.test.js`
Expected: FAIL — `parseQuery` is not exported (SyntaxError / undefined).

- [ ] **Step 3: Write minimal implementation**

Create `src/data/theorycraft.js` with exactly:

```js
const FIELDS = new Set(['type', 'color', 'tag', 'req', 'grants']);

// Tokenize a raw query into terms, honoring "quoted phrases", -exclusion,
// and field:value. Bare words, quoted phrases, and unknown field names all
// become free-text terms (the unknown field name is dropped). Never throws.
export function parseQuery(q) {
  const terms = [];
  const re = /(-?)(?:([a-zA-Z]+):)?(?:"([^"]*)"|(\S+))/g;
  let m;
  while ((m = re.exec(q ?? '')) !== null) {
    if (m[0].trim() === '') { re.lastIndex++; continue; }
    const negate = m[1] === '-';
    const rawField = m[2] ? m[2].toLowerCase() : null;
    const value = (m[3] !== undefined ? m[3] : (m[4] ?? '')).toLowerCase();
    if (!value) continue;
    if (rawField && FIELDS.has(rawField)) {
      terms.push({ kind: 'field', field: rawField, value, negate });
    } else {
      terms.push({ kind: 'text', value, negate });
    }
  }
  return { terms };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/theorycraft.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/data/theorycraft.js test/theorycraft.test.js
git commit -m "feat: theorycraft query parser"
```

---

## Task 2: Matcher & grouping (`docMatches`, `runQuery`)

**Files:**
- Modify: `src/data/theorycraft.js`
- Test: `test/theorycraft.test.js`

**Interfaces:**
- Consumes: `parseQuery` (Task 1); a `Doc` shape `{ name, url, category, iconUrl, subtitle, color, tags: string[], req: string[], grants: string[], text }` (all text lowercased; `category` ∈ `gem|support|spirit|unique|affix|keystone|notable|base`).
- Produces:
  - `docMatches(doc: Doc, terms: Term[]) -> boolean`
  - `runQuery(q: string, opts?: { docs?: Doc[], capPerGroup?: number }) -> { empty: boolean, groups: Array<{ category, label, total, shown, items: Doc[] }>, total: number, query: string }`. `opts.docs` defaults to `allDocs()` (Task 3); tests inject fixtures.

- [ ] **Step 1: Write the failing test**

Append to `test/theorycraft.test.js`:

```js
import { docMatches, runQuery } from '../src/data/theorycraft.js';

const FIXTURE = [
  { name: 'Onslaught Support', url: '/gem/onslaught-support', category: 'support',
    iconUrl: null, subtitle: 'Support', color: 'g', tags: ['support'], req: ['dex'],
    grants: [], text: 'onslaught support grants onslaught movement and cast speed' },
  { name: 'Cold Snap', url: '/gem/cold-snap', category: 'gem',
    iconUrl: null, subtitle: 'Spell', color: 'b', tags: ['cold', 'spell', 'area'],
    req: ['int'], grants: [], text: 'cold snap deals cold damage and chill' },
  { name: 'Test Amulet', url: '/unique/test-amulet', category: 'unique',
    iconUrl: null, subtitle: 'Amber Amulet', color: '', tags: ['amulet'], req: [],
    grants: [], text: 'test amulet chaos resistance onslaught' },
];

test('runQuery: free text matches across categories', () => {
  const r = runQuery('onslaught', { docs: FIXTURE });
  assert.equal(r.total, 2);
  assert.deepEqual(r.groups.map((g) => g.category), ['support', 'unique']);
});

test('runQuery: type field constrains to a category', () => {
  const r = runQuery('type:support', { docs: FIXTURE });
  assert.equal(r.total, 1);
  assert.equal(r.groups[0].items[0].name, 'Onslaught Support');
});

test('runQuery: exclusion removes matches', () => {
  const r = runQuery('onslaught -type:unique', { docs: FIXTURE });
  assert.equal(r.total, 1);
  assert.equal(r.groups[0].category, 'support');
});

test('runQuery: quoted phrase matches the blob', () => {
  const r = runQuery('"cold damage"', { docs: FIXTURE });
  assert.equal(r.total, 1);
  assert.equal(r.groups[0].items[0].name, 'Cold Snap');
});

test('runQuery: color and tag fields', () => {
  assert.equal(runQuery('color:b', { docs: FIXTURE }).total, 1);
  assert.equal(runQuery('tag:cold', { docs: FIXTURE }).total, 1);
});

test('runQuery: empty query is flagged empty', () => {
  const r = runQuery('', { docs: FIXTURE });
  assert.equal(r.empty, true);
  assert.equal(r.groups.length, 0);
});

test('runQuery: per-group cap reports shown vs total', () => {
  const many = Array.from({ length: 150 }, (_, i) => ({
    name: `Gem ${i}`, url: `/gem/g${i}`, category: 'gem', iconUrl: null,
    subtitle: '', color: '', tags: [], req: [], grants: [], text: 'onslaught',
  }));
  const r = runQuery('onslaught', { docs: many, capPerGroup: 100 });
  assert.equal(r.groups[0].total, 150);
  assert.equal(r.groups[0].shown, 100);
  assert.equal(r.groups[0].items.length, 100);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/theorycraft.test.js`
Expected: FAIL — `docMatches`/`runQuery` not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `src/data/theorycraft.js`:

```js
const GROUPS = [
  { category: 'gem',      label: 'Skill Gems' },
  { category: 'support',  label: 'Support Gems' },
  { category: 'spirit',   label: 'Spirit Skills' },
  { category: 'unique',   label: 'Unique Items' },
  { category: 'affix',    label: 'Affixes' },
  { category: 'keystone', label: 'Keystones' },
  { category: 'notable',  label: 'Notables' },
  { category: 'base',     label: 'Base Items' },
];

function termMatches(doc, term) {
  let hit;
  if (term.kind === 'text') {
    hit = doc.text.includes(term.value);
  } else {
    switch (term.field) {
      case 'type':   hit = doc.category.includes(term.value); break;
      case 'color':  hit = (doc.color || '').includes(term.value); break;
      case 'tag':    hit = doc.tags.some((t) => t.includes(term.value)); break;
      case 'req':    hit = doc.req.some((r) => r.includes(term.value)); break;
      case 'grants': hit = doc.grants.some((g) => g.includes(term.value)); break;
      default:       hit = doc.text.includes(term.value);
    }
  }
  return term.negate ? !hit : hit;
}

export function docMatches(doc, terms) {
  return terms.every((t) => termMatches(doc, t));
}

export function runQuery(q, { docs = allDocs(), capPerGroup = 100 } = {}) {
  const { terms } = parseQuery(q);
  const query = (q ?? '').trim();
  if (!terms.length) return { empty: true, groups: [], total: 0, query };
  const matched = docs.filter((d) => docMatches(d, terms));
  const groups = [];
  for (const g of GROUPS) {
    const items = matched.filter((d) => d.category === g.category);
    if (!items.length) continue;
    groups.push({
      category: g.category,
      label: g.label,
      total: items.length,
      shown: Math.min(items.length, capPerGroup),
      items: items.slice(0, capPerGroup),
    });
  }
  return { empty: false, groups, total: matched.length, query };
}
```

Note: `runQuery` references `allDocs` (defined in Task 3). Tests in this task always pass `opts.docs`, so the default is never evaluated until Task 3 lands.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/theorycraft.test.js`
Expected: PASS (parser tests + 7 new matcher tests).

- [ ] **Step 5: Commit**

```bash
git add src/data/theorycraft.js test/theorycraft.test.js
git commit -m "feat: theorycraft matcher and grouping"
```

---

## Task 3: Document index (`allDocs`)

**Files:**
- Modify: `src/data/theorycraft.js`
- Test: `test/theorycraft.test.js`

**Interfaces:**
- Consumes: `listGems`, `buildGemViewModel`, `getGem` from `./gems.js`; `listUniques` from `./uniques.js`; `listItemClasses`, `getItemClass` from `./baseItems.js`; `listKeystones`, `listNotables` from `./passiveTree.js`; `listModGroups` from `./mods.js`; `loadJson` from `./loader.js`; `REPOE` from `../config.js`.
- Produces: `allDocs() -> Doc[]` (lazily built, cached in module-level `_docs`).

Data facts (verified against the live dataset):
- `listGems()` items: `{ slug, name, color, cardColor, gemType /* 'active'|'support'|'spirit' */, origin, iconUrl, req: string[] }`.
- `getGem(slug)` returns the raw record incl. `tags: string[]` and `grants_skills: string[]` (skill keys).
- `skills.json[key].active_skill.display_name` is the granted skill's display name.
- `buildGemViewModel(slug)` returns `{ name, typeLine, tags: string[] (HTML), description (HTML|null), sections: [{ lines: string[] (HTML) }], ... }`.
- `listUniques()` items: `{ slug, name, base, stats: string[], itemClass, iconUrl, flavour: string[], implicitCount }`.
- `listModGroups()` items: `{ type, typeSlug, generation_type /* 'prefix'|'suffix' */, text, tierCount }`.
- `listKeystones()` / `listNotables()` items: `{ id, name, iconUrl, statLines: string[], statRaw: string, flavourText: string, ... }`.
- `getItemClass(classSlug)` returns `{ className?, bases: [{ name, slug, iconUrl? }] }`; `listItemClasses()` returns `[{ classes: [{ classSlug }] }]`.

- [ ] **Step 1: Write the failing test**

Append to `test/theorycraft.test.js`:

```js
import { allDocs } from '../src/data/theorycraft.js';

test('allDocs: builds a multi-category index', () => {
  const docs = allDocs();
  assert.ok(docs.length > 100, 'expected a large index');
  const cats = new Set(docs.map((d) => d.category));
  for (const c of ['gem', 'unique', 'affix', 'keystone', 'base']) {
    assert.ok(cats.has(c), `expected category ${c} present`);
  }
});

test('allDocs: a known gem doc carries deep text and fields', () => {
  const herald = allDocs().find((d) => d.url === '/gem/herald-of-ash');
  assert.ok(herald, 'Herald of Ash should be indexed');
  assert.equal(herald.category, 'gem');
  assert.match(herald.text, /herald/);
  assert.ok(Array.isArray(herald.tags));
});

test('allDocs: is cached (same array on repeat calls)', () => {
  assert.equal(allDocs(), allDocs());
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/theorycraft.test.js`
Expected: FAIL — `allDocs` not exported.

- [ ] **Step 3: Write minimal implementation**

Add imports at the TOP of `src/data/theorycraft.js` (above the existing `FIELDS` const):

```js
import { listGems, buildGemViewModel, getGem } from './gems.js';
import { listUniques } from './uniques.js';
import { listItemClasses, getItemClass } from './baseItems.js';
import { listKeystones, listNotables } from './passiveTree.js';
import { listModGroups } from './mods.js';
import { loadJson } from './loader.js';
import { REPOE } from '../config.js';
```

Append the index builder to the BOTTOM of `src/data/theorycraft.js`:

```js
const stripHtml = (s) => String(s ?? '').replace(/<[^>]*>/g, ' ');
const norm = (parts) => stripHtml(parts.filter(Boolean).join(' ')).toLowerCase();

function gemCategory(gemType) {
  if (gemType === 'support') return 'support';
  if (gemType === 'spirit') return 'spirit';
  return 'gem'; // 'active'
}

function gemDocs() {
  const skills = loadJson(`${REPOE}/skills.json`);
  return listGems().map((g) => {
    const raw = getGem(g.slug) ?? {};
    const grants = (raw.grants_skills ?? [])
      .map((k) => skills[k]?.active_skill?.display_name)
      .filter(Boolean);
    let textParts = [g.name];
    let subtitle = '';
    try {
      const vm = buildGemViewModel(g.slug);
      subtitle = vm.typeLine || '';
      textParts = [vm.name, vm.typeLine, ...(vm.tags || []), vm.description,
        ...vm.sections.flatMap((s) => s.lines), ...grants];
    } catch {
      textParts = [g.name, ...grants];
    }
    return {
      name: g.name,
      url: `/gem/${g.slug}`,
      category: gemCategory(g.gemType),
      iconUrl: g.iconUrl || null,
      subtitle,
      color: g.color || '',
      tags: (raw.tags ?? []).map((t) => String(t).toLowerCase()),
      req: g.req || [],
      grants: grants.map((s) => s.toLowerCase()),
      text: norm(textParts),
    };
  });
}

function uniqueDocs() {
  return listUniques().map((u) => ({
    name: u.name,
    url: `/unique/${u.slug}`,
    category: 'unique',
    iconUrl: u.iconUrl || null,
    subtitle: u.base || '',
    color: '',
    tags: [String(u.itemClass || '').toLowerCase()].filter(Boolean),
    req: [],
    grants: [],
    text: norm([u.name, u.base, ...(u.stats || []), ...(u.flavour || [])]),
  }));
}

function affixDocs() {
  return listModGroups()
    .filter((g) => g.text)
    .map((g) => ({
      name: g.type,
      url: `/mod/${g.typeSlug}`,
      category: 'affix',
      iconUrl: null,
      subtitle: g.text,
      color: '',
      tags: [g.generation_type].filter(Boolean),
      req: [],
      grants: [],
      text: norm([g.type, g.text]),
    }));
}

function nodeDocs(list, category, urlBase) {
  return list.map((n) => ({
    name: n.name,
    url: `/${urlBase}/${n.id}`,
    category,
    iconUrl: n.iconUrl || null,
    subtitle: '',
    color: '',
    tags: [],
    req: [],
    grants: [],
    text: norm([n.name, n.statRaw, n.flavourText]),
  }));
}

function baseDocs() {
  return listItemClasses().flatMap((group) =>
    group.classes.flatMap((cls) => {
      const c = getItemClass(cls.classSlug);
      return (c?.bases ?? []).map((b) => ({
        name: b.name,
        url: `/base/${b.slug}`,
        category: 'base',
        iconUrl: b.iconUrl || null,
        subtitle: c?.className || '',
        color: '',
        tags: [],
        req: [],
        grants: [],
        text: norm([b.name, c?.className]),
      }));
    })
  );
}

let _docs = null;

export function allDocs() {
  if (_docs) return _docs;
  _docs = [
    ...gemDocs(),
    ...uniqueDocs(),
    ...affixDocs(),
    ...nodeDocs(listKeystones(), 'keystone', 'keystone'),
    ...nodeDocs(listNotables(), 'notable', 'notable'),
    ...baseDocs(),
  ];
  return _docs;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/theorycraft.test.js`
Expected: PASS (all parser + matcher + index tests).

- [ ] **Step 5: Commit**

```bash
git add src/data/theorycraft.js test/theorycraft.test.js
git commit -m "feat: theorycraft deep content index"
```

---

## Task 4: Routes, templates, nav, styles

**Files:**
- Create: `src/routes/theorycraft.js`
- Create: `views/theorycraft.njk`
- Create: `views/partials/theorycraft-results.njk`
- Modify: `src/server.js` (add import + registration)
- Modify: `views/base.njk` (nav item)
- Modify: `public/css/app.css` (append styles)
- Test: `test/theorycraft.test.js`

**Interfaces:**
- Consumes: `runQuery` (Task 2).
- Produces: `registerTheorycraft(app)`; routes `GET /theorycraft` (renders `theorycraft.njk` with `{ q, result }`) and `GET /theorycraft/results` (renders `partials/theorycraft-results.njk` with `{ result }`).

- [ ] **Step 1: Write the failing test**

Append to `test/theorycraft.test.js`:

```js
import request from 'supertest';
import { createApp } from '../src/server.js';

test('GET /theorycraft renders the page with a query input', async () => {
  const res = await request(createApp()).get('/theorycraft');
  assert.equal(res.status, 200);
  assert.match(res.text, /hx-get="\/theorycraft\/results"/);
  assert.match(res.text, /Theory Crafting/);
});

test('GET /theorycraft/results?q=herald returns grouped results', async () => {
  const res = await request(createApp()).get('/theorycraft/results?q=herald');
  assert.equal(res.status, 200);
  assert.match(res.text, /Skill Gems/);
  assert.match(res.text, /Herald of Ash/);
});

test('GET /theorycraft/results with empty q shows the prompt', async () => {
  const res = await request(createApp()).get('/theorycraft/results?q=');
  assert.equal(res.status, 200);
  assert.match(res.text, /tc-empty/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/theorycraft.test.js`
Expected: FAIL — `GET /theorycraft` 404s (route not registered).

- [ ] **Step 3a: Create the route module**

Create `src/routes/theorycraft.js`:

```js
import { runQuery } from '../data/theorycraft.js';

export function registerTheorycraft(app) {
  app.get('/theorycraft', (req, res) => {
    const q = req.query.q ?? '';
    res.render('theorycraft.njk', { q, result: runQuery(q) });
  });

  app.get('/theorycraft/results', (req, res) => {
    res.render('partials/theorycraft-results.njk', { result: runQuery(req.query.q ?? '') });
  });
}
```

- [ ] **Step 3b: Register the route in `src/server.js`**

Add the import beside the other route imports:

```js
import { registerTheorycraft } from './routes/theorycraft.js';
```

Add the registration call beside `registerPages(app);`:

```js
  registerTheorycraft(app);
```

- [ ] **Step 3c: Create the results partial**

Create `views/partials/theorycraft-results.njk`:

```njk
{% if result.empty %}
<div class="tc-empty">
  <p>Search across gems, supports, uniques, affixes, keystones, notables and bases.</p>
  <p class="tc-examples">Examples:
    <code>onslaught</code> &middot; <code>type:support cold</code> &middot;
    <code>color:green tag:attack</code> &middot; <code>-type:unique chaos resistance</code></p>
</div>
{% elif not result.groups.length %}
<div class="tc-empty"><p>No results for <code>{{ result.query }}</code>.</p></div>
{% else %}
<div class="tc-summary">{{ result.total }} result{{ 's' if result.total != 1 }} for <code>{{ result.query }}</code></div>
{% for g in result.groups %}
<section class="tc-group">
  <h2 class="tc-group-heading">{{ g.label }} ({{ g.total }})</h2>
  <div class="tc-result-grid">
    {% for it in g.items %}
    <a class="tc-result-card tc-result-card--{{ g.category }}" href="{{ it.url }}"
       {% if g.category in ['gem', 'support', 'spirit', 'unique'] %}data-card-url="{{ it.url }}/card"{% endif %}>
      {% if it.iconUrl %}
      <img class="tc-result-icon" src="{{ it.iconUrl }}" alt="{{ it.name }}" loading="lazy"
           onerror="this.style.visibility='hidden'">
      {% endif %}
      <span class="tc-result-name">{{ it.name }}</span>
      {% if it.subtitle %}<span class="tc-result-sub">{{ it.subtitle }}</span>{% endif %}
    </a>
    {% endfor %}
  </div>
  {% if g.shown < g.total %}<p class="tc-more">Showing {{ g.shown }} of {{ g.total }}</p>{% endif %}
</section>
{% endfor %}
{% endif %}
```

- [ ] **Step 3d: Create the page template**

Create `views/theorycraft.njk`:

```njk
{% extends "base.njk" %}
{% from "macros/nav.njk" import pageHeader %}
{% block title %}Theory Crafting — PoE2 Wiki{% endblock %}
{% block content %}
<div class="page page--column">
  {{ pageHeader('Theory Crafting', 'search everything') }}
  <div class="tc-search">
    <input class="tc-input" type="search" name="q" value="{{ q }}" autocomplete="off" autofocus
           placeholder="Search everything — try: onslaught, type:support cold, color:green tag:attack"
           hx-get="/theorycraft/results" hx-trigger="input changed delay:200ms, search"
           hx-target="#tc-results">
    <p class="tc-hint">Type words to match anything. Use <code>field:value</code> to narrow
      (<code>type:</code>, <code>color:</code>, <code>tag:</code>, <code>req:</code>, <code>grants:</code>),
      <code>-term</code> to exclude, and <code>"quotes"</code> for exact phrases.</p>
  </div>
  <div id="tc-results">
    {% include "partials/theorycraft-results.njk" %}
  </div>
</div>
{% endblock %}
```

Note: `pageHeader(title, subtitle='', accentVar='--color-normal')` is confirmed in `views/macros/nav.njk`, so the call above is valid.

- [ ] **Step 3e: Add the nav item in `views/base.njk`**

Add this `<li>` inside `<ul class="site-nav__list">`, after the "Affixes" item:

```njk
      <li class="site-nav__item">
        <a href="/theorycraft" class="site-nav__top">Theory Crafting</a>
      </li>
```

- [ ] **Step 3f: Append styles to `public/css/app.css`**

```css
/* Theory Crafting search */
.tc-search { margin-bottom: 18px; }
.tc-input {
  width: 100%;
  padding: 12px 16px;
  font-size: 18px;
  background: var(--surface-2, #1a1a1a);
  border: 1px solid var(--border, #333);
  border-radius: 6px;
  color: inherit;
}
.tc-input:focus { outline: none; border-color: var(--accent, #c8a13a); }
.tc-hint { margin: 8px 2px 0; font-size: 12.5px; color: var(--color-default, #888); }
.tc-hint code, .tc-examples code, .tc-summary code {
  background: var(--surface-2, #1a1a1a); padding: 1px 5px; border-radius: 3px;
}
.tc-empty { padding: 24px 4px; color: var(--color-default, #888); }
.tc-examples { margin-top: 8px; }
.tc-summary { margin: 4px 2px 14px; color: var(--color-default, #888); font-size: 13px; }
.tc-group { margin-bottom: 22px; }
.tc-group-heading { font-size: 15px; margin: 0 0 10px; }
.tc-result-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 8px;
}
.tc-result-card {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 10px; text-decoration: none; color: inherit;
  background: var(--surface-2, #1a1a1a);
  border: 1px solid var(--border, #333);
  border-left-width: 3px;
  border-radius: 5px;
}
.tc-result-card:hover { border-color: var(--accent, #c8a13a); }
.tc-result-icon { width: 28px; height: 28px; object-fit: contain; flex: 0 0 auto; }
.tc-result-name { font-weight: 600; }
.tc-result-sub { color: var(--color-default, #888); font-size: 12px; margin-left: auto; }
.tc-more { margin: 8px 2px 0; font-size: 12px; color: var(--color-default, #888); }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/theorycraft.test.js`
Expected: PASS (all tasks' tests).

Then run the full suite:

Run: `node --test`
Expected: PASS — no existing tests broken (header search and gem pages untouched).

- [ ] **Step 5: Manual smoke test**

Run the app and verify in a browser:

```bash
npm start
```

Visit `http://localhost:3000/theorycraft`, type `onslaught`, confirm grouped results appear across categories; try `type:support cold`, `-type:unique chaos`, `"cast speed"`.

- [ ] **Step 6: Commit**

```bash
git add src/routes/theorycraft.js views/theorycraft.njk views/partials/theorycraft-results.njk \
        src/server.js views/base.njk public/css/app.css test/theorycraft.test.js
git commit -m "feat: theorycraft page, routes, nav, and styles"
```

---

## Self-Review Notes

- **Spec coverage:** route/entry (Task 4) · QL parser w/ free-text, field, exclusion, phrase, unknown-field fallback, implicit AND (Task 1) · fields type/color/tag/req/grants (Tasks 2–3) · deep index across all 8 categories (Task 3) · grouped UI with counts + cap note (Task 4) · empty/no-match/broad-term handling (Tasks 2 & 4) · tests for parser, matcher, render (all tasks). All covered.
- **Header search untouched:** `src/data/search.js` and `src/routes/search.js` are not in any file list. ✓
- **Type consistency:** `Doc` shape and `Term` shape are identical across Tasks 1–4; `runQuery`'s `allDocs()` default is defined in Task 3 and only exercised once Task 3 lands (Task 2 tests always inject `docs`).
- **Verified:** `pageHeader` signature in `views/macros/nav.njk`; `npm start` runs `node src/index.js` serving `http://localhost:3000`.
