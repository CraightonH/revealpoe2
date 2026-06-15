# Search Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend search to cover notables, mod families, and stat-description text so users can find passive nodes and affixes by what they do.

**Architecture:** No external lib needed — ~2300 total docs with plain substring search is fast. Add `statRaw` (plain text) to passive node records for haystack inclusion. Add `category` to all search docs; show badge in dropdown. Wire notables + mod families into the index.

**Tech Stack:** Existing search.js, passiveTree.js, mods.js, Nunjucks, `node:test`.

---

## Verified Data Facts

- Gems: ~200, Uniques: ~400, Base items: ~700, Keystones: 33, Notables: 974, Mod families: 579
- `passiveTree.nodeRecord` currently returns: `{id, name, iconUrl, statLines (HTML), flavourText, reminderText, ascendancy}`
- `statLines` are pre-rendered HTML with `<span class="kw">` — strip `[X|Y]` → `Y` for plain text
- Keystone Zealot's Oath: `statLines` contain rendered HTML, need `statRaw` = "Excess Life Recovery from Regeneration is applied to Energy Shield\nEnergy Shield does not Recharge"
- Mod `text` field: already plain text — "+(10-19) to maximum Life" (IncreasedLife1), may contain placeholder values
- `listModGroups()` returns `{type, typeSlug, generation_type, text, tierCount}` — `type` is internal, `text` is human-readable
- Search results currently `{name, slug, url}` — will add `category`

## File Structure

- Modify: `src/data/passiveTree.js` — add `stripMarkup()`, `translateStatsRaw()`, `statRaw` to node records
- Modify: `src/data/search.js` — add notables, mods, categories, stat-text haystacks
- Modify: `views/partials/search-results.njk` — show category badge
- Modify: `views/base.njk` — update placeholder from "Search gems…" to "Search…"
- Modify: `test/search.test.js` — new assertions for categories, stat text, notables, mods
- Modify: `test/passiveTree.test.js` — add `statRaw` field assertion
- Modify: `public/css/gem-card.css` — category badge style

---

### Task 1: Add statRaw to passive node records

**Files:**
- Modify: `src/data/passiveTree.js`

- [ ] **Step 1: Add stripMarkup and translateStatsRaw**

In `passiveTree.js`, add after `translateStats`:

```js
function stripMarkup(text) {
  return text.replace(/\[([^\]|]+)(?:\|([^\]]+))?\]/g, (_, id, display) => display ?? id);
}

function translateStatsRaw(stats) {
  buildStatMap();
  const lines = [];
  for (const [id, val] of Object.entries(stats ?? {})) {
    const entry = _statMap.get(id);
    if (!entry) continue;
    const raw = entry.format?.[0] === 'ignore'
      ? entry.string
      : entry.string.replace('{0}', val);
    for (const line of raw.split('\n')) {
      if (line.trim()) lines.push(stripMarkup(line));
    }
  }
  return lines.join(' ');
}
```

- [ ] **Step 2: Add statRaw to nodeRecord**

Change `nodeRecord` to:

```js
function nodeRecord(p) {
  return {
    id: p.id,
    name: p.name,
    iconUrl: ddsUrl(p.icon),
    statLines: translateStats(p.stats),
    statRaw: translateStatsRaw(p.stats),
    flavourText: p.flavour_text || '',
    reminderText: Array.isArray(p.reminder_text) ? p.reminder_text : [],
    ascendancy: p.ascendancy ?? null,
  };
}
```

- [ ] **Step 3: Run passiveTree tests**

```bash
cd /Users/chancock/git/poe2wiki && node --test test/passiveTree.test.js 2>&1
```

Expected: all 19 pass (new field doesn't break existing tests).

---

### Task 2: Write new search tests first (TDD)

**Files:**
- Modify: `test/search.test.js`
- Modify: `test/passiveTree.test.js`

- [ ] **Step 1: Add statRaw test to passiveTree.test.js**

In the `getKeystone` describe block:

```js
it("Zealot's Oath has statRaw plain text without HTML", () => {
  const k = getKeystone('passive_keystone_zealots_oath');
  assert.ok(typeof k.statRaw === 'string');
  assert.ok(k.statRaw.includes('Energy Shield'));
  assert.ok(!k.statRaw.includes('<'));
});
```

In the `getNotable` describe block:

```js
it('Fast Acting Toxins statRaw is plain text', () => {
  const n = getNotable('ailments38');
  assert.ok(typeof n.statRaw === 'string');
  assert.ok(n.statRaw.includes('12'));
  assert.ok(!n.statRaw.includes('<'));
});
```

- [ ] **Step 2: Add search upgrade tests to search.test.js**

```js
import { search } from '../src/data/search.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// New tests to add to existing describe block:

it('search results include category field', () => {
  const hits = search('herald');
  assert.ok(hits.length > 0);
  assert.ok(hits.every((h) => typeof h.category === 'string' && h.category.length > 0));
});

it('search finds keystones by stat text', () => {
  // Zealots Oath contains "Energy Shield"
  const hits = search('energy shield');
  const zealots = hits.find((h) => h.url.includes('passive_keystone_zealots_oath'));
  assert.ok(zealots, 'Zealots Oath not found by stat text');
});

it('search finds notables by name', () => {
  const hits = search('fast acting toxins');
  assert.ok(hits.some((h) => h.name === 'Fast Acting Toxins'));
});

it('search finds notables by stat text', () => {
  // ailments38 Fast Acting Toxins has "Damaging Ailments deal damage 12% faster"
  const hits = search('damaging ailments');
  assert.ok(hits.some((h) => h.url.includes('ailments38')));
});

it('search finds mod groups by text', () => {
  // IncreasedLife has text "+(10-19) to maximum Life"
  const hits = search('maximum life');
  assert.ok(hits.some((h) => h.url.includes('/mod/')));
});

it('search returns category Keystone for keystones', () => {
  const hits = search('zealots oath');
  const k = hits.find((h) => h.url.includes('passive_keystone_zealots_oath'));
  assert.ok(k);
  assert.equal(k.category, 'Keystone');
});

it('search returns category Notable for notables', () => {
  const hits = search('fast acting toxins');
  const n = hits.find((h) => h.name === 'Fast Acting Toxins');
  assert.ok(n);
  assert.equal(n.category, 'Notable');
});

it('search returns category Gem for gems', () => {
  const hits = search('herald of ash');
  assert.ok(hits.some((h) => h.category === 'Gem'));
});

it('search returns category Affix for mods', () => {
  const hits = search('maximum life');
  assert.ok(hits.some((h) => h.category === 'Affix'));
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd /Users/chancock/git/poe2wiki && node --test test/search.test.js 2>&1 | grep -E 'fail|pass|FAIL'
```

Expected: several failures.

---

### Task 3: Implement search.js changes

**Files:**
- Modify: `src/data/search.js`

- [ ] **Step 1: Update search.js**

```js
import { listGems } from './gems.js';
import { listUniques } from './uniques.js';
import { getItemClass, listItemClasses } from './baseItems.js';
import { listKeystones, listNotables } from './passiveTree.js';
import { listModGroups } from './mods.js';

let _docs = null;

function docs() {
  if (_docs) return _docs;
  const gems = listGems().map((g) => ({
    name: g.name, slug: g.slug, url: `/gem/${g.slug}`,
    haystack: g.name.toLowerCase(), category: 'Gem',
  }));
  const uniques = listUniques().map((u) => ({
    name: u.name, slug: u.slug, url: `/unique/${u.slug}`,
    haystack: u.name.toLowerCase(), category: 'Unique',
  }));
  const bases = listItemClasses().flatMap((group) =>
    group.classes.flatMap((cls) => {
      const c = getItemClass(cls.classSlug);
      return (c?.bases ?? []).map((b) => ({
        name: b.name, slug: b.slug, url: `/base/${b.slug}`,
        haystack: b.name.toLowerCase(), category: 'Base',
      }));
    })
  );
  const keystones = listKeystones().map((k) => ({
    name: k.name, slug: k.id, url: `/keystone/${k.id}`,
    haystack: (k.name + ' ' + k.statRaw).toLowerCase(), category: 'Keystone',
  }));
  const notables = listNotables().map((n) => ({
    name: n.name, slug: n.id, url: `/keystone/${n.id}`,
    haystack: (n.name + ' ' + n.statRaw).toLowerCase(), category: 'Notable',
  }));
  const mods = listModGroups().map((g) => ({
    name: g.text || g.type, slug: g.typeSlug, url: `/mod/${g.typeSlug}`,
    haystack: (g.text || '').toLowerCase(), category: 'Affix',
  })).filter((m) => m.haystack);
  _docs = [...gems, ...uniques, ...bases, ...keystones, ...notables, ...mods];
  return _docs;
}

export function search(q, limit = 20) {
  const needle = (q ?? '').trim().toLowerCase();
  if (!needle) return [];
  const out = [];
  for (const d of docs()) {
    if (d.haystack.includes(needle)) {
      out.push({ name: d.name, slug: d.slug, url: d.url, category: d.category });
      if (out.length >= limit) break;
    }
  }
  return out;
}
```

Note: Notables URL reuses `/keystone/` route — the route currently only handles keystones. I'll add a `/notable/:id` route later, OR use a unified `/passive/:id` approach. For now, notables link to a page that says 404 — I need a route. Simplest fix: add a `/notable/:id` route that renders a notable detail.

Actually, let me reconsider. The notables don't have a detail page yet. I have two options:
1. Link notables to the ascendancy page of their class (but non-ascendancy notables have no ascendancy)
2. Add a `/notable/:id` route with a simple detail view
3. Link all notables to `/keystones` for now (no per-notable pages yet)

Option 2 is cleanest. Let me add it.

- [ ] **Step 2: Update notable URL in search docs**

Change notable url to `/notable/${n.id}` and add the route + view.

---

### Task 4: Add notable detail route and view

**Files:**
- Modify: `src/routes/pages.js`
- Create: `views/notable.njk`

- [ ] **Step 1: Add /notable/:id route**

In `src/routes/pages.js`, import `getNotable`:

```js
import { listKeystones, getKeystone, listNotables, getNotable, listAscendancies, getAscendancy } from '../data/passiveTree.js';
```

Add route:

```js
app.get('/notable/:id', (req, res) => {
  const n = getNotable(req.params.id);
  if (!n) return res.status(404).render('home.njk', { notFound: req.params.id });
  res.render('notable.njk', { n });
});
```

- [ ] **Step 2: Create views/notable.njk**

```njk
{% extends "base.njk" %}
{% block title %}{{ n.name }} — PoE2 Wiki{% endblock %}
{% block content %}
<div class="page" style="flex-direction:column;align-items:center;">
  <nav class="bases-breadcrumb">
    <a href="/keystones">Keystones</a> › Notable › {{ n.name }}
  </nav>
  <div class="passive-detail-card">
    {% if n.iconUrl %}
    <img class="passive-detail-icon" src="{{ n.iconUrl }}" alt="{{ n.name }}" onerror="this.style.visibility='hidden'">
    {% endif %}
    <h1 class="passive-detail-name">{{ n.name }}</h1>
    {% if n.statLines.length %}
    <div class="passive-detail-stats">
      {% for line in n.statLines %}
      <div class="explicitMod">{{ line | safe }}</div>
      {% endfor %}
    </div>
    {% endif %}
    {% if n.flavourText %}
    <div class="FlavourText passive-detail-flavour">{{ n.flavourText }}</div>
    {% endif %}
  </div>
</div>
{% endblock %}
```

---

### Task 5: Update search results UI

**Files:**
- Modify: `views/partials/search-results.njk`
- Modify: `views/base.njk`
- Modify: `public/css/gem-card.css`

- [ ] **Step 1: Update search-results.njk**

```njk
{% if results.length %}
<div class="search-results">
  {% for r in results %}
  <a href="{{ r.url }}" class="search-result-row">
    <span class="search-result-name">{{ r.name }}</span>
    <span class="search-result-cat search-result-cat--{{ r.category | lower }}">{{ r.category }}</span>
  </a>
  {% endfor %}
</div>
{% endif %}
```

- [ ] **Step 2: Update placeholder in base.njk**

Change `placeholder="Search gems…"` to `placeholder="Search…"`.

- [ ] **Step 3: Add category badge CSS**

```css
.search-result-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 5px 10px;
  text-decoration: none;
  color: var(--color-default);
  transition: background 0.1s;
}
.search-result-row:hover { background: rgba(255,255,255,0.05); }
.search-result-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.search-result-cat {
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 3px;
  background: rgba(255,255,255,0.1);
  color: var(--color-default);
  white-space: nowrap;
  flex-shrink: 0;
}
.search-result-cat--gem { background: rgba(27,162,155,0.2); color: var(--color-gem); }
.search-result-cat--unique { background: rgba(175,96,37,0.2); color: var(--color-unique); }
.search-result-cat--keystone { background: rgba(200,180,100,0.2); color: #c8b464; }
.search-result-cat--notable { background: rgba(200,180,100,0.15); color: #b8a454; }
.search-result-cat--affix { background: rgba(136,136,255,0.15); color: var(--magic-color); }
```

---

### Task 6: Run full test suite, verify, commit

- [ ] **Step 1: Run all tests**

```bash
cd /Users/chancock/git/poe2wiki && npm test 2>&1 | tail -10
```

Expected: all pass.

- [ ] **Step 2: Smoke test**

```bash
npm start &
sleep 2
curl -s 'http://localhost:3000/search?q=energy+shield' | grep -o 'Zealot\|category'
curl -s 'http://localhost:3000/search?q=maximum+life' | grep -o 'maximum\|Affix'
curl -s 'http://localhost:3000/notable/ailments38' | grep -o 'Fast Acting'
```

- [ ] **Step 3: Commit**

```bash
git add src/data/passiveTree.js src/data/search.js src/routes/pages.js \
  views/notable.njk views/partials/search-results.njk views/base.njk \
  public/css/gem-card.css test/search.test.js test/passiveTree.test.js \
  docs/superpowers/plans/2026-06-15-search-upgrade.md
git commit -m "feat: search upgrade — notables, mods, stat-text haystacks, category badges"
```

- [ ] **Step 4: Archive plan**

```bash
mv docs/superpowers/plans/2026-06-15-search-upgrade.md docs/superpowers/archive/
```
