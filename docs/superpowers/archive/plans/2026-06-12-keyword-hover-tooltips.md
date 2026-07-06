# Keyword Hover Tooltips Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Highlight in-game keywords throughout the wiki and show an interactive, lazily-fetched tooltip explaining each term on hover — poe2db's signature feature.

**Architecture:** A new `keywordDefs` module reads `keywords.json`. `renderGameText` gains an injected `hasDefinition` predicate so only keywords with real definitions become interactive `<span class="kw">`. Gem tags and the type line are routed through `renderGameText` so they too become hoverable. A `GET /api/keyword/:key` endpoint returns the rendered definition fragment (its own cross-referenced keywords nested inside). Client-side, a single delegated Tippy.js instance fetches and caches definition fragments on first hover, including nested keywords inside open tooltips.

**Tech Stack:** Node 20, Express 5, Nunjucks, node:test + supertest (server), Tippy.js v6 (vendored, client). Data via `src/data/loader.js` `loadJson()`.

**Reference spec:** `docs/superpowers/specs/2026-06-12-keyword-hover-tooltips-design.md`

---

## File Structure

- **Create** `src/data/keywordDefs.js` — loads `keywords.json`; `hasDefinition(key)`, `getDefinition(key)`.
- **Modify** `src/data/keywords.js` — add injected `hasDefinition` predicate to `renderGameText`; gate span emission.
- **Modify** `src/data/gemTags.js` — add `tagToken(id)` and `displayTagTokens(tags, exclude)` preserving the keyword id.
- **Modify** `src/data/gems.js` — pass `hasDefinition` to every `renderGameText` call; render tags + type line as keyword HTML.
- **Modify** `views/macros/gem-card.njk` — render tags and type line as safe HTML.
- **Create** `src/routes/keywords.js` — `GET /api/keyword/:key` returns the definition fragment.
- **Modify** `src/server.js` — register the keyword route.
- **Create** `public/js/keywords.js` — delegated Tippy glue with fetch + in-memory cache.
- **Create** `public/vendor/tippy-bundle.umd.min.js`, `public/vendor/tippy.css` — vendored Tippy (Popper bundled).
- **Modify** `views/base.njk` — load Tippy CSS + scripts.
- **Modify** `public/css/app.css` — `.kw` styling + `poe2` Tippy theme.
- **Tests**: `test/keywordDefs.test.js` (new), `test/keywords.test.js` (extend), `test/gemTags.test.js` (extend), `test/keywordApi.test.js` (new), `test/gems.test.js` (update tag assertion).

**Verified data facts** (used by tests below):
- `Accuracy` — has definition; its text contains `[Attack|Attack]` and `[Evasion]`; `Evasion` and `Attack` both have definitions.
- `AbsentAmulet` — present but `definition` is `""` (empty).
- `Fire` (term "Fire Damage"), `AoESkill` (term "Area of Effect Skills"), `Persistent`, `Herald` — all have definitions.
- `keywords.json` definition text uses `\r\n` line breaks.

---

## Task 1: Keyword definitions loader

**Files:**
- Create: `src/data/keywordDefs.js`
- Test: `test/keywordDefs.test.js`

- [ ] **Step 1: Write the failing test**

Create `test/keywordDefs.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasDefinition, getDefinition } from '../src/data/keywordDefs.js';

test('hasDefinition is true for a keyword with non-empty definition', () => {
  assert.equal(hasDefinition('Accuracy'), true);
});

test('hasDefinition is false for an empty-definition keyword', () => {
  assert.equal(hasDefinition('AbsentAmulet'), false);
});

test('hasDefinition is false for an unknown keyword', () => {
  assert.equal(hasDefinition('NotARealKeyword'), false);
});

test('getDefinition returns term and definition for a hit', () => {
  const d = getDefinition('Accuracy');
  assert.equal(d.term, 'Accuracy');
  assert.match(d.definition, /Accuracy/);
});

test('getDefinition returns null for empty-definition and unknown keys', () => {
  assert.equal(getDefinition('AbsentAmulet'), null);
  assert.equal(getDefinition('NotARealKeyword'), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/keywordDefs.test.js`
Expected: FAIL — cannot find module `../src/data/keywordDefs.js`.

- [ ] **Step 3: Write minimal implementation**

Create `src/data/keywordDefs.js`:

```js
import { loadJson } from './loader.js';

const REPOE = 'repoe-poe2';

function entry(key) {
  const map = loadJson(`${REPOE}/keywords.json`);
  return map[key] ?? null;
}

// True only when the keyword exists and has a non-empty definition. Gates out
// the ~257 entries whose definition is "" so they never become dead hovers.
export function hasDefinition(key) {
  const e = entry(key);
  return !!(e && typeof e.definition === 'string' && e.definition.trim());
}

// { term, definition } for a defined keyword, or null for empty/missing.
// term falls back to the key when the data has no display term.
export function getDefinition(key) {
  if (!hasDefinition(key)) return null;
  const e = entry(key);
  return { term: e.term || key, definition: e.definition };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/keywordDefs.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/data/keywordDefs.js test/keywordDefs.test.js
git commit -m "feat: keyword definitions loader"
```

---

## Task 2: Gate renderGameText with an injected predicate

**Files:**
- Modify: `src/data/keywords.js`
- Test: `test/keywords.test.js`

- [ ] **Step 1: Write the failing test**

Append to `test/keywords.test.js`:

```js
test('token without a definition renders as plain escaped text', () => {
  const has = (id) => id === 'Attack';
  assert.equal(
    renderGameText('non-[Attack|Attacks] then [Foo|Bar]', has),
    'non-<span class="kw" data-keyword="Attack">Attacks</span> then Bar'
  );
});

test('default predicate keeps every token interactive', () => {
  assert.equal(
    renderGameText('[Foo|Bar]'),
    '<span class="kw" data-keyword="Foo">Bar</span>'
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/keywords.test.js`
Expected: FAIL — `non-[Attack|Attacks] then [Foo|Bar]` still emits a span for `Foo` (predicate ignored).

- [ ] **Step 3: Write minimal implementation**

In `src/data/keywords.js`, replace the `renderGameText` function with:

```js
// Convert "[Id]" / "[Id|Display]" tokens to styled spans; escape the rest.
// hasDefinition(id) gates interactivity: tokens it rejects render as plain
// escaped text (no span). Defaults to always-true so existing callers and
// unit tests are unaffected.
export function renderGameText(text, hasDefinition = () => true) {
  if (text == null) return '';
  let out = '';
  let last = 0;
  const re = /\[([^\]|]+)(?:\|([^\]]+))?\]/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    out += escapeHtml(text.slice(last, m.index));
    const id = m[1];
    const display = m[2] ?? m[1];
    if (hasDefinition(id)) {
      out += `<span class="kw" data-keyword="${escapeHtml(id)}">${escapeHtml(display)}</span>`;
    } else {
      out += escapeHtml(display);
    }
    last = re.lastIndex;
  }
  out += escapeHtml(text.slice(last));
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/keywords.test.js`
Expected: PASS (5 tests — the 3 original plus 2 new).

- [ ] **Step 5: Commit**

```bash
git add src/data/keywords.js test/keywords.test.js
git commit -m "feat: gate renderGameText keyword spans behind a definition predicate"
```

---

## Task 3: Keyword definition endpoint

**Files:**
- Create: `src/routes/keywords.js`
- Modify: `src/server.js`
- Test: `test/keywordApi.test.js`

- [ ] **Step 1: Write the failing test**

Create `test/keywordApi.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/server.js';

test('GET /api/keyword/:key returns a fragment for a known keyword', async () => {
  const res = await request(createApp()).get('/api/keyword/Accuracy');
  assert.equal(res.status, 200);
  assert.match(res.text, /<strong>Accuracy<\/strong>/);
  assert.match(res.headers['cache-control'] || '', /max-age/);
});

test('cross-referenced keywords become nested .kw spans', async () => {
  // Accuracy's definition references [Evasion], which has its own definition.
  const res = await request(createApp()).get('/api/keyword/Accuracy');
  assert.match(res.text, /<span class="kw" data-keyword="Evasion"/);
});

test('newlines in the definition are rendered as <br>', async () => {
  const res = await request(createApp()).get('/api/keyword/Accuracy');
  assert.match(res.text, /<br>/);
});

test('unknown keyword returns 404', async () => {
  const res = await request(createApp()).get('/api/keyword/NotARealKeyword');
  assert.equal(res.status, 404);
});

test('empty-definition keyword returns 404', async () => {
  const res = await request(createApp()).get('/api/keyword/AbsentAmulet');
  assert.equal(res.status, 404);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/keywordApi.test.js`
Expected: FAIL — `/api/keyword/Accuracy` 404s (route not registered).

- [ ] **Step 3: Write minimal implementation**

Create `src/routes/keywords.js`:

```js
import { getDefinition, hasDefinition } from '../data/keywordDefs.js';
import { renderGameText } from '../data/keywords.js';

function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function registerKeywords(app) {
  app.get('/api/keyword/:key', (req, res) => {
    const def = getDefinition(req.params.key);
    if (!def) return res.sendStatus(404);

    // Render nested [Key|Display] refs to gated .kw spans, then turn the
    // data's \r\n breaks into <br> (spans contain no newlines, so order is safe).
    const body = renderGameText(def.definition, hasDefinition).replace(/\r?\n/g, '<br>');

    res
      .set('Cache-Control', 'public, max-age=86400')
      .type('html')
      .send(
        `<div class="kw-tip"><strong>${escapeHtml(def.term)}</strong>` +
          `<div class="kw-tip__body">${body}</div></div>`
      );
  });
}
```

- [ ] **Step 4: Register the route in `src/server.js`**

Add the import alongside the other route imports:

```js
import { registerKeywords } from './routes/keywords.js';
```

And call it next to the others in `createApp()` (after `registerSearch(app);`):

```js
  registerPages(app);
  registerSearch(app);
  registerKeywords(app);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test test/keywordApi.test.js`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add src/routes/keywords.js src/server.js test/keywordApi.test.js
git commit -m "feat: GET /api/keyword/:key returns rendered definition fragment"
```

---

## Task 4: Tooltip-enable gem tags and type line

**Files:**
- Modify: `src/data/gemTags.js`
- Modify: `src/data/gems.js`
- Modify: `views/macros/gem-card.njk`
- Test: `test/gemTags.test.js`, `test/gems.test.js`

- [ ] **Step 1: Write the failing test for `displayTagTokens`**

Append to `test/gemTags.test.js`:

```js
import { tagToken, displayTagTokens } from '../src/data/gemTags.js';

test('tagToken returns the raw bracket token preserving the keyword id', () => {
  assert.equal(tagToken('area'), '[AoESkill|AoE]');
  assert.equal(tagToken('fire'), '[Fire]');
  assert.equal(tagToken('strength'), null);
});

test('displayTagTokens keeps ids, drops non-display tags, and excludes by display name', () => {
  const tags = ['strength', 'grants_active_skill', 'buff', 'persistent', 'area', 'fire', 'duration', 'herald'];
  assert.deepEqual(
    displayTagTokens(tags, ['Buff']),
    ['[Persistent]', '[AoESkill|AoE]', '[Fire]', '[DurationSkill|Duration]', '[Herald]']
  );
});
```

(Add the new import to the existing `import { tagDisplay, displayTags } ...` line, or as a second import as shown.)

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/gemTags.test.js`
Expected: FAIL — `tagToken` / `displayTagTokens` not exported.

- [ ] **Step 3: Implement `tagToken` and `displayTagTokens`**

Append to `src/data/gemTags.js`:

```js
// Raw "[Key|Display]" / "[Display]" token for a tag id, or null if the tag has
// no display form. The keyword id is the bracket key (e.g. "[AoESkill|AoE]"),
// which differs from the tag id ("area").
export function tagToken(id) {
  const map = loadJson(`${REPOE}/gem_tags.json`);
  return map[id] || null;
}

// Tokens for displayable tags, dropping non-display tags and any whose display
// name is in `exclude`. Preserves the keyword id so tooltips can resolve.
export function displayTagTokens(tags, exclude = []) {
  const skip = new Set(exclude);
  const out = [];
  for (const id of tags ?? []) {
    const raw = tagToken(id);
    if (!raw) continue;
    const display = tagDisplay(id);
    if (display && !skip.has(display)) out.push(raw);
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/gemTags.test.js`
Expected: PASS (original 4 tests + 2 new).

- [ ] **Step 5: Update `gems.js` to render tags, type line, and gated stat text**

In `src/data/gems.js`:

Change the imports — replace `import { displayTags } from './gemTags.js';` with:

```js
import { displayTagTokens } from './gemTags.js';
import { hasDefinition } from './keywordDefs.js';
```

Replace the tags line:

```js
  // Tag tokens, excluding the one already shown as the type line; rendered to
  // gated keyword HTML so defined tags become hoverable.
  const tagTokens = displayTagTokens(gem.tags, [typeLine]);
```

Replace the `sections` mapping so every `renderGameText` call passes the predicate
(critical: `.map(renderGameText)` would otherwise pass the array index as the
predicate argument):

```js
  const sections = buildSections(skill, GEM_LEVEL_CAP).map((s) => ({
    label: s.label,
    lines: s.lines.map((t) => renderGameText(t, hasDefinition)),
    quality: s.quality.map((t) => renderGameText(t, hasDefinition)),
  }));
```

In the returned view-model object, replace the `tags` field and add `typeLineHtml`,
and update the `description` call:

```js
    typeLine,
    typeLineHtml: renderGameText(`[${typeLine}]`, hasDefinition),
    tags: tagTokens.map((t) => renderGameText(t, hasDefinition)),
```

```js
    description: skill?.active_skill?.description
      ? renderGameText(skill.active_skill.description, hasDefinition)
      : null,
```

- [ ] **Step 6: Update the gem view-model test for the new tag shape**

In `test/gems.test.js`, the `buildGemViewModel produces card fields` test asserts
`assert.ok(vm.tags.includes('Fire'));`. Tags are now HTML strings. Replace that
line with:

```js
  assert.ok(vm.tags.some((t) => /data-keyword="Fire"/.test(t))); // tag is hoverable
```

- [ ] **Step 7: Render tags and type line as safe HTML in the macro**

In `views/macros/gem-card.njk`:

Replace the type line div:

```njk
      <div class="itemName typeLine"><span class="lc">{{ vm.typeLineHtml | safe }}</span></div>
```

Replace the tags property block:

```njk
        {% if vm.tags.length %}
        <div class="property">{{ vm.tags | join(', ') | safe }}</div>
        {% endif %}
```

- [ ] **Step 8: Run the full test suite**

Run: `npm test`
Expected: PASS — all suites green (gemTags, gems, keywords, keywordDefs, keywordApi, plus existing server/render/etc.).

- [ ] **Step 9: Commit**

```bash
git add src/data/gemTags.js src/data/gems.js views/macros/gem-card.njk test/gemTags.test.js test/gems.test.js
git commit -m "feat: tooltip-enable gem tags and type line via gated keyword spans"
```

---

## Task 5: Vendor Tippy.js, client glue, styling, and template wiring

**Files:**
- Create: `public/vendor/tippy-bundle.umd.min.js`, `public/vendor/tippy.css`
- Create: `public/js/keywords.js`
- Modify: `views/base.njk`
- Modify: `public/css/app.css`

> No unit test: this repo has no client-side (jsdom) test harness; client glue is verified manually in Step 6. The server endpoint it depends on is already covered by `test/keywordApi.test.js`.

- [ ] **Step 1: Vendor Tippy.js (bundle includes Popper) and its base CSS**

Run:

```bash
curl -fsSL https://unpkg.com/tippy.js@6/dist/tippy-bundle.umd.min.js -o public/vendor/tippy-bundle.umd.min.js
curl -fsSL https://unpkg.com/tippy.js@6/dist/tippy.css -o public/vendor/tippy.css
```

Verify both files are non-empty and the JS exposes a global:

```bash
ls -l public/vendor/tippy-bundle.umd.min.js public/vendor/tippy.css
grep -c "delegate" public/vendor/tippy-bundle.umd.min.js
```

Expected: both files present and non-trivial in size; `grep -c` prints a number ≥ 1 (the bundle includes `tippy.delegate`).

- [ ] **Step 2: Write the client glue**

Create `public/js/keywords.js`:

```js
// Lazy keyword tooltips. One delegated Tippy instance handles every `.kw`
// (including spans injected inside open tooltips). Each keyword's fragment is
// fetched once from /api/keyword/:key and cached in memory.
(function () {
  if (typeof window.tippy !== 'function') return;

  var cache = new Map();

  window.tippy.delegate('body', {
    target: '.kw',
    interactive: true,
    allowHTML: true,
    delay: [120, 80],
    maxWidth: 360,
    theme: 'poe2',
    appendTo: function () { return document.body; },
    content: 'Loading…',
    onShow: function (instance) {
      var key = instance.reference.getAttribute('data-keyword');
      if (!key) return;
      if (cache.has(key)) {
        instance.setContent(cache.get(key));
        return;
      }
      if (instance._kwLoading) return;
      instance._kwLoading = true;
      fetch('/api/keyword/' + encodeURIComponent(key))
        .then(function (r) { return r.ok ? r.text() : null; })
        .then(function (html) {
          var val = html || 'No description available.';
          cache.set(key, val);
          instance.setContent(val);
        })
        .catch(function () {
          instance.setContent('No description available.');
        })
        .finally(function () { instance._kwLoading = false; });
    },
  });
})();
```

- [ ] **Step 3: Wire Tippy CSS and scripts into `views/base.njk`**

In the `<head>`, after the existing stylesheet links, add:

```html
  <link rel="stylesheet" href="/static/vendor/tippy.css">
```

Replace the existing single script tag with the htmx tag plus the two new ones
(order matters — Tippy bundle before our glue):

```html
  <script src="/static/vendor/htmx.min.js" defer></script>
  <script src="/static/vendor/tippy-bundle.umd.min.js" defer></script>
  <script src="/static/js/keywords.js" defer></script>
```

- [ ] **Step 4: Add `.kw` styling and the `poe2` Tippy theme to `public/css/app.css`**

Append to `public/css/app.css`:

```css
/* Keyword tooltips */
.kw {
  color: var(--color-prop);
  text-decoration: underline dotted;
  text-underline-offset: 2px;
  cursor: help;
}
.kw:hover { color: var(--color-rare); }

.tippy-box[data-theme~='poe2'] {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  color: var(--color-normal);
  font-size: 12px;
  line-height: 1.45;
}
.tippy-box[data-theme~='poe2'] .tippy-content { padding: 8px 10px; }
.tippy-box[data-theme~='poe2'] .tippy-arrow { color: var(--bg-surface); }
.kw-tip > strong { display: block; margin-bottom: 4px; color: var(--text); }
.kw-tip__body .kw { cursor: help; }
```

- [ ] **Step 5: Run the full suite (no regressions from static/template changes)**

Run: `npm test`
Expected: PASS — all suites green.

- [ ] **Step 6: Manual end-to-end verification**

Start the server and verify the endpoint and the rendered page:

```bash
npm start &
SERVER_PID=$!
sleep 1
# Endpoint returns a fragment with a nested keyword span:
curl -fsS http://localhost:3000/api/keyword/Accuracy | grep -o 'data-keyword="Evasion"'
# Gem page emits .kw spans (tags + stat text):
curl -fsS http://localhost:3000/gem/herald-of-ash | grep -c 'class="kw"'
# Tippy assets load:
curl -fsS -o /dev/null -w "%{http_code}\n" http://localhost:3000/static/vendor/tippy-bundle.umd.min.js
kill $SERVER_PID
```

Expected: first command prints `data-keyword="Evasion"`; the grep count is ≥ 1; the asset returns `200`.

Then, in a browser at `http://localhost:3000/gem/herald-of-ash`: confirm keyword
text is dotted-underlined, hovering shows a dark tooltip with the term in bold,
and hovering a keyword *inside* the tooltip opens a nested tooltip.

(If the project has a `run` skill / launch helper, use it for the browser check.)

- [ ] **Step 7: Commit**

```bash
git add public/vendor/tippy-bundle.umd.min.js public/vendor/tippy.css public/js/keywords.js views/base.njk public/css/app.css
git commit -m "feat: client-side keyword hover tooltips via vendored Tippy.js"
```

---

## Self-Review

**Spec coverage:**
- keywordDefs module (`hasDefinition`/`getDefinition`, empty-entry gating) → Task 1. ✓
- `renderGameText` injected predicate, plain text for undefined → Task 2. ✓
- Gem tags preserve keyword id + type-line treatment → Task 4 (Steps 1–7). ✓
- `GET /api/keyword/:key`: fragment with `<strong>term</strong>`, nested gated spans, `Cache-Control`, 404 on miss/empty → Task 3. ✓
- Tippy.js vendored, one delegated interactive instance, fetch + Map cache, base.njk wiring → Task 5. ✓
- `.kw` styling + dark tooltip theme → Task 5 Step 4. ✓
- Tests: keywordDefs, renderGameText gating, gem-tag id preservation, endpoint (200/404/empty/nested/Cache-Control) → Tasks 1–4. ✓
- Newline (`\r\n` → `<br>`) handling in fragment → Task 3 impl + test. ✓ (spec implied "definition" rendering; made explicit.)

**Placeholder scan:** No TBD/TODO; every code step shows complete code; every command shows expected output. ✓

**Type/name consistency:** `hasDefinition`/`getDefinition` (Task 1) used identically in Tasks 2–4. `tagToken`/`displayTagTokens` (Task 4 Step 3) match their test (Step 1) and usage in `gems.js` (Step 5). `typeLineHtml` and the new `tags` HTML shape (Step 5) match the macro (Step 7) and the updated `gems.test.js` assertion (Step 6). Endpoint path `/api/keyword/:key` consistent across route, server wiring, tests, and client fetch. Tippy global `window.tippy.delegate` matches the vendored bundle. ✓

**Note on existing tests:** Adding the 2nd param to `renderGameText` makes `.map(renderGameText)` pass the array index as the predicate — Task 4 Step 5 fixes all such call sites to pass `hasDefinition` explicitly. The default `() => true` keeps `test/keywords.test.js`'s original three assertions valid.
