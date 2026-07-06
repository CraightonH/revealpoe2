# /keystones Page Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align the `/keystones` browse page with `/uniques` — compact icon+name index cards on `bg-surface`, a `--color-keystone` header accent, and a hover-card preview of the passive tooltip.

**Architecture:** Add a `/keystone/:id/card` fragment route (existing `cardRoute` helper + `getKeystone` builder) and a tiny partial that renders the existing `passiveDetail` macro, so the already-generic `data-card-url` hover glue shows the passive tooltip on hover. Re-lay the keystones page as compact `.keystone-index-card` rows mirroring the inlined `.unique-index-card` markup in `uniques.njk`, with keystone-colored CSS. The ascendancy page's `passiveNodeCard` (with stat lines) and all `.passive-node-*` CSS stay untouched.

**Tech Stack:** Node 20 ESM, Express 5, Nunjucks templates, plain CSS with design tokens, `node:test` + supertest.

## Global Constraints

- `/uniques` is the alignment target (flat grid, compact rows, hover preview) — not `/gems` (sections + filter bar).
- Keystone accent color = `--color-keystone` (blue/violet), the token already used by the passive detail tooltip.
- Browse tiles must NOT render stat lines (those live on the detail page / hover preview).
- The ascendancy page, the `passiveNodeCard` macro, and all `.passive-node-*` CSS must stay UNCHANGED — they are still used by ascendancy.
- The `passiveDetail` macro and passive tooltip are unchanged (reused by the new fragment).
- Mirror the existing codebase pattern: card fragments are `{% from "macros/..." import X %}{{ X(vm) }}`; index cards are a shared flat-surface base rule + per-type variant.
- Tests run with `npm test` (`node --test`).

---

### Task 1: Keystone card-fragment route + partial

**Files:**
- Create: `views/partials/passive-card-fragment.njk`
- Modify: `src/routes/pages.js` (add one `cardRoute` registration next to the existing `/keystone/:id` detail route, ~line 83)
- Test: `test/render.test.js`

**Interfaces:**
- Consumes: existing `cardRoute(app, path, builder, fragment)` helper and `getKeystone(id)` builder (already imported in `pages.js`). `cardRoute` renders the fragment with `{ vm: result }` and sends 404 + empty body when the builder returns null. The `passiveDetail(node)` macro (in `views/macros/passive.njk`) emits `.newItemPopup.PassivePopup`.
- Produces: `GET /keystone/:id/card` → passive card fragment HTML. Consumed by Task 2's `data-card-url` attribute.

- [ ] **Step 1: Write the failing tests**

Add to `test/render.test.js`:

```js
test('GET /keystone/:id/card returns the passive card fragment', async () => {
  const res = await request(createApp()).get('/keystone/passive_keystone_zealots_oath/card');
  assert.equal(res.status, 200);
  assert.match(res.text, /newItemPopup/);
  assert.match(res.text, /PassivePopup/);
  assert.match(res.text, /Zealot&#39;s Oath/);
});

test('GET /keystone/:id/card returns 404 empty body for unknown id', async () => {
  const res = await request(createApp()).get('/keystone/not-a-real-keystone/card');
  assert.equal(res.status, 404);
  assert.equal(res.text, '');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- test/render.test.js`
Expected: FAIL — the `/keystone/:id/card` route does not exist yet, so the request 404s with the `home.njk` body (not the fragment), and the empty-body assertion fails too.

- [ ] **Step 3: Create the fragment partial**

Create `views/partials/passive-card-fragment.njk`:

```njk
{% from "macros/passive.njk" import passiveDetail %}
{{ passiveDetail(vm) }}
```

- [ ] **Step 4: Register the card route**

In `src/routes/pages.js`, find the existing keystone detail route:

```js
  detailRoute(app, '/keystone/:id', getKeystone, 'keystone.njk', 'k');
```

Add the card route directly after it:

```js
  detailRoute(app, '/keystone/:id', getKeystone, 'keystone.njk', 'k');
  cardRoute(app, '/keystone/:id/card', getKeystone, 'partials/passive-card-fragment.njk');
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- test/render.test.js`
Expected: PASS (both new fragment tests pass; existing render tests still pass).

- [ ] **Step 6: Commit**

```bash
git add views/partials/passive-card-fragment.njk src/routes/pages.js test/render.test.js
git commit -m "feat: add keystone card-fragment route for hover previews"
```

---

### Task 2: Re-lay the keystones page as aligned index cards

**Files:**
- Modify: `views/keystones.njk`
- Modify: `public/css/gem-card.css` (add `.keystone-index-*` rules near the `.unique-index-*` rules, ~lines 380-454)
- Test: `test/render.test.js`

**Interfaces:**
- Consumes: `GET /keystone/:id/card` from Task 1 (referenced by `data-card-url`); the `pageHeader(title, subtitle, accentVar)` macro in `views/macros/nav.njk`; keystone records with `id`, `name`, `iconUrl`; the `--color-keystone` token in `tokens.css`.
- Produces: the `/keystones` page rendered as `.keystone-index-card` rows in a `.keystone-index-grid`.

- [ ] **Step 1: Write the failing tests**

Add to `test/render.test.js`:

```js
test('GET /keystones renders aligned index cards with hover previews', async () => {
  const res = await request(createApp()).get('/keystones');
  assert.equal(res.status, 200);
  // compact index-card layout (mirrors /uniques), not the old verbose tile
  assert.match(res.text, /keystone-index-grid/);
  assert.match(res.text, /keystone-index-card/);
  assert.ok(!/passive-node-card/.test(res.text), 'keystones page must not use the old passive-node-card tile');
  // hover-preview wiring + keystone header accent
  assert.match(res.text, /data-card-url="\/keystone\/[^"]+\/card"/);
  assert.match(res.text, /color:var\(--color-keystone\)/);
});

test('ascendancy page still uses passiveNodeCard tiles (scope guard)', async () => {
  const res = await request(createApp()).get('/ascendancy/Druid1');
  assert.equal(res.status, 200);
  assert.match(res.text, /passive-node-card/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- test/render.test.js`
Expected: FAIL — the keystones page still renders `passive-node-card` and has no `keystone-index-card`/`data-card-url`/`--color-keystone` accent. (The ascendancy scope-guard test should PASS already — it documents the invariant we must preserve.)

- [ ] **Step 3: Rewrite the keystones page**

Replace the entire contents of `views/keystones.njk` with:

```njk
{% extends "base.njk" %}
{% from "macros/nav.njk" import pageHeader %}
{% block title %}Keystones — PoE2 Wiki{% endblock %}
{% block content %}
<div class="page page--column">
  {{ pageHeader('Keystones', keystones.length ~ ' keystones', '--color-keystone') }}
  <div class="keystone-index-grid">
    {% for k in keystones %}
    <a class="keystone-index-card" href="/keystone/{{ k.id }}" data-card-url="/keystone/{{ k.id }}/card">
      {% if k.iconUrl %}
      <img src="{{ k.iconUrl }}" alt="{{ k.name }}" class="keystone-index-icon"
           onerror="this.style.visibility='hidden'">
      {% else %}
      <div class="keystone-index-icon keystone-index-placeholder">{{ k.name[0] }}</div>
      {% endif %}
      <span class="keystone-index-name">{{ k.name }}</span>
    </a>
    {% endfor %}
  </div>
</div>
{% endblock %}
```

(This drops the `passiveNodeCard` import and the stat-line tile; `passiveNodeCard` is still imported/used by `ascendancy.njk`, which is untouched.)

- [ ] **Step 4: Add the keystone index-card CSS**

In `public/css/gem-card.css`, add `.keystone-index-grid` to the two shared grid rules. Change:

```css
.unique-index-grid,
.bases-list-grid,
.passive-node-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
}
.unique-index-grid,
.bases-list-grid,
.passive-node-grid,
.asc-grid {
  width: 100%;
  max-width: 900px;
  padding: 16px 0;
}

.unique-index-grid {
  gap: 8px;
}
```

to:

```css
.unique-index-grid,
.keystone-index-grid,
.bases-list-grid,
.passive-node-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
}
.unique-index-grid,
.keystone-index-grid,
.bases-list-grid,
.passive-node-grid,
.asc-grid {
  width: 100%;
  max-width: 900px;
  padding: 16px 0;
}

.unique-index-grid,
.keystone-index-grid {
  gap: 8px;
}
```

Then add `.keystone-index-card` to the shared flat-surface base rule. Change:

```css
.unique-index-card,
.bases-class-card,
.bases-list-card,
.mods-list-row {
  display: flex;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  text-decoration: none;
}
```

to:

```css
.unique-index-card,
.keystone-index-card,
.bases-class-card,
.bases-list-card,
.mods-list-row {
  display: flex;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  text-decoration: none;
}
```

Finally, add the keystone-specific rules immediately after the `.unique-index-base { ... }` rule (after ~line 454):

```css
.keystone-index-card {
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-radius: 4px;
  color: var(--color-keystone);
  font-family: var(--font-smallcaps);
  font-size: 13px;
  transition: border-color 0.15s;
}
.keystone-index-card:hover {
  border-color: var(--color-keystone);
}
.keystone-index-icon {
  width: 32px;
  height: 32px;
  object-fit: contain;
  flex-shrink: 0;
}
.keystone-index-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(136,136,255,0.2);
  border-radius: 4px;
  color: var(--color-keystone);
  font-size: 16px;
}
.keystone-index-name {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- test/render.test.js`
Expected: PASS (keystones index-card test + ascendancy scope-guard test pass).

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS — no regressions (the existing `GET /keystones returns 200 with Keystones heading` test in `test/server.test.js` still passes).

- [ ] **Step 7: Visual verification**

Run `npm run dev`, then load `http://localhost:3000/keystones`. Confirm:
- Compact icon + name rows on the lighter `bg-surface`, blue/violet header accent — visually consistent with `/uniques`.
- Hovering a keystone tile shows the passive tooltip popup (the `.newItemPopup` card).
- Clicking a tile navigates to the keystone detail page.
- `/ascendancy/Druid1` still shows the verbose `passiveNodeCard` tiles with stat lines, unchanged.

- [ ] **Step 8: Commit**

```bash
git add views/keystones.njk public/css/gem-card.css test/render.test.js
git commit -m "feat: align /keystones browse page with /uniques (compact cards, accent, hover preview)"
```

---

## Self-Review

**Spec coverage:**
- Card fragment route → Task 1 Step 4. ✓
- Fragment partial → Task 1 Step 3. ✓
- Header accent `--color-keystone` → Task 2 Step 3 (`pageHeader` 3rd arg) + test. ✓
- Compact index-card layout, no stat lines → Task 2 Step 3 + negative `passive-node-card` assertion. ✓
- Hover preview (`data-card-url`) → Task 2 Step 3 + test. ✓
- Keystone index CSS (grid + base + variant + icon/name/placeholder) → Task 2 Step 4. ✓
- Scope guard: ascendancy + `passiveNodeCard` + `.passive-node-*` untouched → Task 2 ascendancy scope-guard test; no edits to `ascendancy.njk`, `passiveNodeCard`, or `.passive-node-*` rules. ✓

**Placeholder scan:** No TBD/TODO; full code/CSS shown for every step. ✓

**Type consistency:** Class names consistent across tasks (`keystone-index-grid`, `keystone-index-card`, `keystone-index-icon`, `keystone-index-name`, `keystone-index-placeholder`); route `/keystone/:id/card` matches partial path `partials/passive-card-fragment.njk` and the `data-card-url` value; test ids (`passive_keystone_zealots_oath`, `Druid1`) verified to exist. ✓
