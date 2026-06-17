# Theory Crafting Search Help Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a collapsible "How to search" help panel under the `/theorycraft` search bar that documents every query term with clickable examples that run the search instantly.

**Architecture:** Presentation-only change. Replace the one-line hint in `views/theorycraft.njk` with a native `<details>` panel containing a definition list of term types and `.tc-example` chip buttons. A small page-scoped vanilla script (`public/js/theorycraft.js`) makes a chip click fill the search input, dispatch an `input` event (reusing the existing htmx search path), collapse the panel, and focus the input. CSS appended to `app.css`.

**Tech Stack:** Nunjucks template, native `<details>/<summary>`, plain browser JS (IIFE, no module), existing htmx wiring, `node:test` + `supertest` render test.

## Global Constraints

- No new npm dependencies; no JS framework. Native `<details>` for collapse.
- Do NOT change the query parser/matcher (`src/data/theorycraft.js`) — presentation only.
- `public/js/theorycraft.js` is a browser IIFE (match the style of existing `public/js/*.js`), loaded only on the Theory Crafting page (not from `base.njk`).
- Chip click path must reuse the existing search trigger: set `.tc-input` value, dispatch a bubbling `input` event (the input's htmx trigger is `input changed delay:200ms, search`).
- Closed-set fields list every value: `type:` → gem, support, spirit, unique, affix, keystone, notable, base; `color:` → red, green, blue, white (r/g/b/w); `req:` → str, dex, int. Open-ended `tag:`/`grants:` show curated examples + "any … works".
- Each example chip: `<button type="button" class="tc-example" data-q="…">…</button>`; the chip label is the literal query it inserts.

---

## File Structure

- Modify: `views/theorycraft.njk` — replace the `.tc-hint` paragraph with the lead line + `<details class="tc-help">` panel; add the `theorycraft.js` script tag.
- Create: `public/js/theorycraft.js` — chip-click handler (~18 lines).
- Modify: `public/css/app.css` — append `.tc-lead` / `.tc-help` / `.tc-example` styles.
- Modify: `test/theorycraft.test.js` — add one render test for the panel.

---

## Task 1: Search help panel (template, script, styles, test)

**Files:**
- Modify: `views/theorycraft.njk`
- Create: `public/js/theorycraft.js`
- Modify: `public/css/app.css`
- Test: `test/theorycraft.test.js`

**Interfaces:**
- Consumes: existing `GET /theorycraft` route (renders `theorycraft.njk` with `{ q, result }`); the search input `.tc-input` with htmx trigger `input changed delay:200ms, search`; Express static mount `/static` → `public/`.
- Produces: no JS exports (browser IIFE). The page gains a `.tc-help` panel and `.tc-example[data-q]` chips.

- [ ] **Step 1: Write the failing test**

Append to `test/theorycraft.test.js` (the file already imports `request` from `supertest` and `createApp` from `../src/server.js`):

```js
test('GET /theorycraft renders the search help panel with clickable examples', async () => {
  const res = await request(createApp()).get('/theorycraft');
  assert.equal(res.status, 200);
  // collapsible panel + summary
  assert.match(res.text, /class="tc-help"/);
  assert.match(res.text, /How to search/);
  // term labels that live ONLY in the panel
  assert.match(res.text, /<code>grants:<\/code>/);
  assert.match(res.text, /<code>req:<\/code>/);
  // closed-set values for type are spelled out
  assert.match(res.text, /keystone, notable, base/);
  // clickable example chips carry data-q
  assert.match(res.text, /class="tc-example" data-q="type:keystone"/);
  assert.match(res.text, /class="tc-example" data-q="color:green"/);
  // page-scoped script is referenced
  assert.match(res.text, /\/static\/js\/theorycraft\.js/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/theorycraft.test.js`
Expected: FAIL — the page has no `tc-help` panel yet (the `class="tc-help"` assertion fails).

- [ ] **Step 3a: Replace the template body**

Overwrite `views/theorycraft.njk` with exactly:

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
    <p class="tc-lead">Type any words to match anything; combine terms to narrow — all terms must match.</p>
    <details class="tc-help">
      <summary>How to search — terms &amp; examples</summary>
      <dl class="tc-help-terms">
        <dt>Free text</dt>
        <dd>Matches names, stats, tags — anything.
          <span class="tc-examples-row">
            <button type="button" class="tc-example" data-q="onslaught">onslaught</button>
            <button type="button" class="tc-example" data-q="chaos">chaos</button>
            <button type="button" class="tc-example" data-q="life regeneration">life regeneration</button>
          </span>
        </dd>
        <dt><code>type:</code></dt>
        <dd>Limit to a content type: gem, support, spirit, unique, affix, keystone, notable, base.
          <span class="tc-examples-row">
            <button type="button" class="tc-example" data-q="type:support">type:support</button>
            <button type="button" class="tc-example" data-q="type:unique">type:unique</button>
            <button type="button" class="tc-example" data-q="type:keystone">type:keystone</button>
          </span>
        </dd>
        <dt><code>color:</code></dt>
        <dd>Gem colour: red, green, blue, white (or r/g/b/w).
          <span class="tc-examples-row">
            <button type="button" class="tc-example" data-q="color:green">color:green</button>
            <button type="button" class="tc-example" data-q="color:red">color:red</button>
          </span>
        </dd>
        <dt><code>req:</code></dt>
        <dd>Attribute requirement: str, dex, int.
          <span class="tc-examples-row">
            <button type="button" class="tc-example" data-q="req:int">req:int</button>
            <button type="button" class="tc-example" data-q="req:str">req:str</button>
          </span>
        </dd>
        <dt><code>tag:</code></dt>
        <dd>A gem/item tag — any tag works (e.g. fire, cold, lightning, attack, spell, area, projectile, melee, minion).
          <span class="tc-examples-row">
            <button type="button" class="tc-example" data-q="tag:fire">tag:fire</button>
            <button type="button" class="tc-example" data-q="tag:attack">tag:attack</button>
          </span>
        </dd>
        <dt><code>grants:</code></dt>
        <dd>A skill granted by the item/gem — any skill name works.
          <span class="tc-examples-row">
            <button type="button" class="tc-example" data-q="grants:onslaught">grants:onslaught</button>
          </span>
        </dd>
        <dt><code>-</code> exclude</dt>
        <dd>Prefix a term with <code>-</code> to exclude it.
          <span class="tc-examples-row">
            <button type="button" class="tc-example" data-q="-type:unique">-type:unique</button>
            <button type="button" class="tc-example" data-q="chaos -type:affix">chaos -type:affix</button>
          </span>
        </dd>
        <dt><code>"quoted phrase"</code></dt>
        <dd>Match an exact multi-word phrase.
          <span class="tc-examples-row">
            <button type="button" class="tc-example" data-q='"cast speed"'>"cast speed"</button>
            <button type="button" class="tc-example" data-q='"spirit reservation"'>"spirit reservation"</button>
          </span>
        </dd>
        <dt>Combine (AND)</dt>
        <dd>List several terms; all must match.
          <span class="tc-examples-row">
            <button type="button" class="tc-example" data-q="type:support cold">type:support cold</button>
            <button type="button" class="tc-example" data-q="color:green tag:attack">color:green tag:attack</button>
            <button type="button" class="tc-example" data-q="req:int spirit">req:int spirit</button>
          </span>
        </dd>
      </dl>
    </details>
  </div>
  <div id="tc-results">
    {% include "partials/theorycraft-results.njk" %}
  </div>
  <script src="/static/js/theorycraft.js" defer></script>
</div>
{% endblock %}
```

- [ ] **Step 3b: Create the click-handler script**

Create `public/js/theorycraft.js`:

```js
// Theory Crafting search help: clicking an example chip runs that query.
// Sets the search input's value and dispatches an `input` event, which fires
// the input's existing htmx trigger (input changed delay:200ms, search).
(function () {
  var input = document.querySelector('.tc-input');
  if (!input) return;
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('.tc-example');
    if (!btn) return;
    e.preventDefault();
    input.value = btn.dataset.q || '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    var help = document.querySelector('.tc-help');
    if (help) help.open = false;
    input.focus();
    var n = input.value.length;
    try { input.setSelectionRange(n, n); } catch (err) { /* type=search may reject */ }
  });
})();
```

- [ ] **Step 3c: Append styles to `public/css/app.css`**

```css
/* Theory Crafting — search help panel */
.tc-lead { margin: 8px 2px 6px; font-size: 13px; color: var(--color-default, #888); }
.tc-help { margin: 4px 2px 0; font-size: 13px; }
.tc-help > summary {
  cursor: pointer; color: var(--color-default, #888);
  padding: 4px 0; user-select: none;
}
.tc-help > summary:hover { color: var(--accent, #c8a13a); }
.tc-help[open] > summary { color: var(--accent, #c8a13a); margin-bottom: 10px; }
.tc-help-terms {
  margin: 0;
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 10px 18px;
  align-items: baseline;
}
.tc-help-terms dt { font-weight: 600; white-space: nowrap; }
.tc-help-terms dt code { background: none; padding: 0; }
.tc-help-terms dd { margin: 0; color: var(--color-default, #999); }
.tc-examples-row { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 5px; }
.tc-example {
  font-family: inherit; font-size: 12px;
  background: var(--surface-2, #1a1a1a); color: inherit;
  border: 1px solid var(--border, #333); border-radius: 3px;
  padding: 2px 7px; cursor: pointer;
}
.tc-example:hover { border-color: var(--accent, #c8a13a); color: var(--accent, #c8a13a); }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/theorycraft.test.js`
Expected: PASS (all prior theorycraft tests plus the new panel test).

Then the full suite:

Run: `node --test`
Expected: PASS — nothing else affected (presentation-only change).

- [ ] **Step 5: Manual smoke test**

```bash
node src/index.js   # serves http://localhost:3000
```

Visit `http://localhost:3000/theorycraft`: the "How to search" panel expands; clicking a chip (e.g. `type:keystone`) fills the box, runs the search (results update), collapses the panel, and the input keeps focus. Stop the server when done (Ctrl-C).

- [ ] **Step 6: Commit**

```bash
git add views/theorycraft.njk public/js/theorycraft.js public/css/app.css test/theorycraft.test.js
git commit -m "feat: theorycraft search help panel with clickable examples"
```

---

## Self-Review Notes

- **Spec coverage:** collapsible `<details>` panel (3a) · lead line (3a) · every term type with closed-set values + curated open-set examples (3a) · clickable chips that run the search, collapse the panel, focus input (3b) · styles (3c) · render test for markup, smoke test for JS behavior (Steps 1, 4–5). All covered.
- **Parser untouched:** `src/data/theorycraft.js` is not in the file list. ✓
- **Type consistency:** the handler selects `.tc-input` (the existing input class) and `.tc-help`/`.tc-example` (introduced in 3a); `data-q` is set on every chip in 3a and read in 3b. Consistent.
- **Escaping note:** the quoted-phrase chips use single-quoted `data-q='"cast speed"'` with literal double quotes inside — valid HTML, and these are static template text (not `{{ }}` expressions), so Nunjucks autoescape does not alter them.
- **Verified:** `/static` is mounted to `public/` in `src/server.js`, so `/static/js/theorycraft.js` resolves; `node src/index.js` serves on `http://localhost:3000`.
