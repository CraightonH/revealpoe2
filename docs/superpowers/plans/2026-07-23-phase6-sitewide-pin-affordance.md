# Phase 6 — Site-wide Pin Affordance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a site-wide "Add to Theory Craft" pin icon to every item card/tooltip so pinning works from any page (not just `/theorycraft`), completing Phase 6 (TODO #3) and TODO #4.

**Architecture:** A third icon in the shared `card-actions.njk` macros (`data-pin-kind`/`-slug`/`-class`), a thin delegated handler `add-to-pins.js` (mirrors `add-to-build.js`) that writes to the existing `tcPins` localStorage store, and a small extension to `pin-store.js` `resolve()` so a coarse `gem` kind pinned off-page is recovered to its true `gem`/`support`/`spirit` category against the search index (with dedup). Promote-to-build already shipped (commits `0d51c60`/`b66ce2d`); this plan only adds the off-page pinning affordance that acceptance criterion #2 requires.

**Tech Stack:** Nunjucks server templates, vanilla ES-module browser JS, `node:test` + `supertest` for server-render tests, pure-module unit tests for the store logic. Pure static site — no backend.

## Global Constraints

- **No backend, pure static.** Pin state lives only in `localStorage` under key `tcPins` via `pin-store.js` — never raw `localStorage`.
- **Item reference contract.** Cards emit a coarse kind: `gem` | `unique` | `base`. The pin store's category space is the theorycraft space (`gem`/`support`/`spirit`/`unique`/`base`/…); the coarse `gem` is reconciled to its fine category at resolve time on `/theorycraft`.
- **Pure cores, dual-use.** `pin-store.js` stays a pure ES module importable by both `node:test` and the browser; all category-recovery logic goes there, unit-tested.
- **Crawler discoverability.** This adds no new fetched URL — the toast links to the already-crawled `/theorycraft`. No `scripts/prerender.js` change. Assets under `public/` are copied to `dist/` verbatim.
- **Keep `npm test` green** (643 passing at start). `pretest` rebuilds the graph.
- **No `data/source/` edits; no hand-enumeration.** This task touches no game data.

---

### Task 1: Coarse-gem recovery + dedup in `pin-store.js` `resolve()`

The site-wide gem card can only emit the coarse `gem` kind (the gem/support/spirit split is only knowable against the search index). `resolve()` must recover the true category against the loaded docs, rewrite the stored ref to canonical, and dedup a coarse+canonical pair of the same entity — without counting a dedup collapse as a "removed dead ref".

**Files:**
- Modify: `public/js/pin-store.js` (the `resolve()` function + a small family helper)
- Test: `test/theorycraft.test.js` (append alongside the existing `createPinStore` tests)

**Interfaces:**
- Consumes: existing `pinKey(ref)`, `normalizeRef`, `write(next)`, `pins` (module-internal state).
- Produces: `resolve(docs)` returns `{ resolved: [{ ref, doc }], removed }` where `removed` counts ONLY refs that matched no doc (dead), NOT dedup collapses; the stored `tcPins` array is rewritten to canonical (upgraded/deduped) when it changed.

- [ ] **Step 1: Write the failing tests**

Append to `test/theorycraft.test.js` (mirror the existing storage-mock/`globalThis.window` pattern used at lines 60–105):

```js
test('pin store recovers a coarse gem kind against a support doc and rewrites it', () => {
  const values = new Map([['tcPins', JSON.stringify({ v: 1, pins: [{ category: 'gem', slug: 'added-arrows' }] })]]);
  const storage = { getItem: (k) => values.get(k) ?? null, setItem: (k, v) => values.set(k, v) };
  const previousWindow = globalThis.window;
  globalThis.window = { addEventListener() {} };
  try {
    const store = createPinStore({ storage });
    const result = store.resolve([{ category: 'support', slug: 'added-arrows', name: 'Added Arrows' }]);
    assert.equal(result.removed, 0);
    assert.equal(result.resolved.length, 1);
    assert.equal(result.resolved[0].ref.category, 'support');
    assert.deepEqual(JSON.parse(values.get('tcPins')).pins, [{ category: 'support', slug: 'added-arrows' }]);
  } finally {
    globalThis.window = previousWindow;
  }
});

test('pin store dedups a coarse + canonical pin of the same gem without flagging a removal', () => {
  const values = new Map([['tcPins', JSON.stringify({ v: 1, pins: [
    { category: 'support', slug: 'added-arrows' },
    { category: 'gem', slug: 'added-arrows' },
  ] })]]);
  const storage = { getItem: (k) => values.get(k) ?? null, setItem: (k, v) => values.set(k, v) };
  const previousWindow = globalThis.window;
  globalThis.window = { addEventListener() {} };
  try {
    const store = createPinStore({ storage });
    const result = store.resolve([{ category: 'support', slug: 'added-arrows', name: 'Added Arrows' }]);
    assert.equal(result.removed, 0);
    assert.equal(result.resolved.length, 1);
    assert.deepEqual(JSON.parse(values.get('tcPins')).pins, [{ category: 'support', slug: 'added-arrows' }]);
  } finally {
    globalThis.window = previousWindow;
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/theorycraft.test.js`
Expected: the two new tests FAIL — the first because the coarse `gem` ref is dropped (`removed` = 1, `resolved` empty); the second because both entries survive (`resolved.length` = 2).

- [ ] **Step 3: Implement the recovery + dedup**

Add near the top of `public/js/pin-store.js` (after `pinKey`):

```js
// Coarse card kinds map to a family of index categories. Off-/theorycraft
// cards can only emit the coarse 'gem' kind; the fine gem/support/spirit split
// is only knowable against the search index, so resolve() recovers it here and
// rewrites the stored ref to canonical.
const CATEGORY_FAMILY = { gem: ['gem', 'support', 'spirit'] };
function familyParent(category) {
  for (const [parent, members] of Object.entries(CATEGORY_FAMILY)) {
    if (members.includes(category)) return parent;
  }
  return category;
}
```

Replace the entire existing `resolve(docs)` function body with:

```js
  function resolve(docs) {
    const byIdentity = new Map();
    const byCoarse = new Map(); // `${parent}:${slug}` -> doc, for gem-family recovery
    for (const doc of docs || []) {
      const slug = doc.category === 'affix' ? doc.typeSlug : doc.slug;
      const identity = pinKey({ category: doc.category, slug, classSlug: doc.classSlug });
      if (identity && !byIdentity.has(identity)) byIdentity.set(identity, doc);
      const parent = familyParent(doc.category);
      if (parent !== doc.category && slug) {
        const coarse = `${parent}:${slug}`;
        if (!byCoarse.has(coarse)) byCoarse.set(coarse, doc);
      }
    }
    const resolved = [];
    const kept = [];
    const seen = new Set();
    let dead = 0;
    for (const ref of pins) {
      let doc = byIdentity.get(pinKey(ref));
      let keptRef = ref;
      // Coarse gem kind pinned off /theorycraft: recover its true category.
      if (!doc && ref.category !== 'base') {
        const alias = byCoarse.get(`${ref.category}:${ref.slug}`);
        if (alias) { doc = alias; keptRef = { category: alias.category, slug: ref.slug }; }
      }
      if (!doc || (ref.category === 'base' && doc.classSlug !== ref.classSlug)) { dead++; continue; }
      const canonical = pinKey(keptRef);
      if (seen.has(canonical)) continue; // dedup alias duplicates — not a dead ref
      seen.add(canonical);
      kept.push(keptRef);
      resolved.push({ ref: { ...keptRef }, doc });
    }
    const changed = kept.length !== pins.length ||
      kept.some((ref, i) => pinKey(ref) !== pinKey(pins[i]));
    if (changed) write(kept);
    return { resolved, removed: dead };
  }
```

- [ ] **Step 4: Run the full theorycraft suite to verify pass (incl. the two pre-existing pin-store tests)**

Run: `node --test test/theorycraft.test.js`
Expected: PASS — the two new tests pass AND the existing `pin store persists ordered versioned refs` / `drops unresolved refs and notifies subscribers` tests still pass (`removed` semantics unchanged for the dead-ref case).

- [ ] **Step 5: Commit**

```bash
git add public/js/pin-store.js test/theorycraft.test.js
git commit -m "feat(planner): recover coarse gem pins to their fine category on resolve (+dedup)"
```

---

### Task 2: Pin icon in `card-actions.njk` + base call-site class slug

**Files:**
- Modify: `views/macros/card-actions.njk` (add `pinIcon()` + `addPin()` macros; call `addPin` inside `tradeLink`/`tradeButton`; add optional `classSlug` param)
- Modify: `views/macros/base-card.njk` (pass `classSlug` at the two base call sites: `baseListCard` and `baseCard`)
- Test: `test/render.test.js` (append)

**Interfaces:**
- Consumes: existing `scaleIcon()`, `buildIcon()`, `addBuild(kind, slug)` macros.
- Produces: rendered cards emit `data-pin-kind="{gem|unique|base}"`, `data-pin-slug`, and (bases only) `data-pin-class`. `tradeLink(url, kind, slug, classSlug='')` / `tradeButton(url, kind, slug, classSlug='')` gain a 4th optional `classSlug` param, passed through to `addPin`.

- [ ] **Step 1: Write the failing test**

Append to `test/render.test.js` (mirror the two existing Add-to-Build tests at lines 185–200):

```js
test('cards carry the Add-to-Theory-Craft pin affordance', async () => {
  const app = createApp();
  const detail = await request(app).get('/unique/astramentis');
  assert.match(detail.text, /data-pin-kind="unique"/);
  assert.match(detail.text, /data-pin-slug="astramentis"/);
  const gems = await request(app).get('/gems');
  assert.match(gems.text, /data-pin-kind="gem"/);
  const bases = await request(app).get('/bases');
  assert.match(bases.text, /data-pin-kind="base"/);
  assert.match(bases.text, /data-pin-class="/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/render.test.js`
Expected: FAIL — no `data-pin-kind` in any rendered page yet.

- [ ] **Step 3: Add the `pinIcon()` and `addPin()` macros**

In `views/macros/card-actions.njk`, after the `buildIcon()` macro (before `addBuild`), add:

```njk
{# Pushpin "add to Theory Craft" icon — self-contained inline SVG, scaleIcon's style.
   Same glyph as the theorycraft-client pin toggle for visual consistency. #}
{% macro pinIcon() %}
<svg class="add-pin-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
     stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
  <path d="M8.2 3.5h7.6l-1.4 5.1 3.1 3.2v1.7H13V21l-2-2v-5.5H6.5v-1.7l3.1-3.2-1.4-5.1Z"/>
</svg>
{% endmacro %}

{% macro addPin(kind, slug, classSlug='') %}
{% if kind and slug %}
  <span class="add-pin" role="button" tabindex="0"
        data-pin-kind="{{ kind }}" data-pin-slug="{{ slug }}"{% if classSlug %} data-pin-class="{{ classSlug }}"{% endif %}
        title="Add to Theory Craft" aria-label="Add to Theory Craft">{{ pinIcon() }}</span>
{% endif %}
{% endmacro %}
```

- [ ] **Step 4: Call `addPin` from both container macros**

In `views/macros/card-actions.njk`, change the `tradeLink` signature and body to add `classSlug` and the pin:

```njk
{% macro tradeLink(url, kind, slug, classSlug='') %}
{% if url or (kind and slug) %}
<div class="card-actions">
  {% if url %}<a class="trade-link" href="{{ url }}" target="_blank" rel="noopener nofollow"
     title="Search on PoE Trade" aria-label="Search on PoE Trade">{{ scaleIcon() }}</a>{% endif %}
  {{ addBuild(kind, slug) }}
  {{ addPin(kind, slug, classSlug) }}
</div>
{% endif %}
{% endmacro %}
```

And the `tradeButton` macro the same way:

```njk
{% macro tradeButton(url, kind, slug, classSlug='') %}
{% if url or (kind and slug) %}
<span class="card-actions card-actions--overlay">
  {% if url %}<span class="trade-link" role="button" tabindex="0" data-trade-url="{{ url }}"
        title="Search on PoE Trade" aria-label="Search on PoE Trade">{{ scaleIcon() }}</span>{% endif %}
  {{ addBuild(kind, slug) }}
  {{ addPin(kind, slug, classSlug) }}
</span>
{% endif %}
{% endmacro %}
```

- [ ] **Step 5: Pass `classSlug` at the base card call sites**

In `views/macros/base-card.njk`:
- Line ~21 (`baseListCard`): change `{{ tradeButton(b.tradeUrl, 'base', b.slug) }}` → `{{ tradeButton(b.tradeUrl, 'base', b.slug, b.classSlug) }}`
- Line ~59 (`baseCard`): change `{{ tradeLink(vm.tradeUrl, 'base', vm.slug) }}` → `{{ tradeLink(vm.tradeUrl, 'base', vm.slug, vm.classSlug) }}`

(Gem and unique call sites need no change — `classSlug` defaults to `''`; the coarse `gem` kind is recovered at resolve time per Task 1.)

- [ ] **Step 6: Run test to verify it passes**

Run: `node --test test/render.test.js`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add views/macros/card-actions.njk views/macros/base-card.njk test/render.test.js
git commit -m "feat(planner): site-wide Add-to-Theory-Craft pin icon on cards/tooltips"
```

---

### Task 3: `add-to-pins.js` delegated handler + load + styling

**Files:**
- Create: `public/js/add-to-pins.js`
- Modify: `views/base.njk` (load the module beside `add-to-build.js`)
- Modify: `public/css/app.css` (`.add-pin` styling, after the `.add-build` block ~line 1048)

**Interfaces:**
- Consumes: `createPinStore` from `/static/js/pin-store.js`; the `.build-toast` element/style already used by `add-to-build.js`; DOM attributes from Task 2.
- Produces: clicking/activating any `[data-pin-kind]` element adds `{ category: <kind>, slug, classSlug? }` to the `tcPins` store and shows a toast linking to `/theorycraft`.

- [ ] **Step 1: Create the handler module**

Create `public/js/add-to-pins.js`:

```js
// Site-wide delegated handler for the "Add to Theory Craft" pin affordance
// (data-pin-kind/-slug/-class, emitted by views/macros/card-actions.njk).
// Mirrors trade-link.js / add-to-build.js. Pins land in the shared tcPins store;
// /theorycraft resolves + renders them (recovering the fine gem/support/spirit
// category from the coarse 'gem' kind — see pin-store.js resolve()). Add-only
// with an idempotent toast: there is no persistent pinned-state indicator off
// /theorycraft (the fine category — and thus true pinned state for gems — is
// unknown without the search index).
import { createPinStore } from '/static/js/pin-store.js';

const store = createPinStore();

function toast(html) {
  document.querySelector('.build-toast')?.remove();
  const el = document.createElement('div');
  el.className = 'build-toast';
  el.setAttribute('role', 'status');
  el.innerHTML = html;
  document.body.append(el);
  setTimeout(() => el.remove(), 5000);
}

function refFor(el) {
  const ref = { category: el.getAttribute('data-pin-kind'), slug: el.getAttribute('data-pin-slug') };
  const classSlug = el.getAttribute('data-pin-class');
  if (classSlug) ref.classSlug = classSlug;
  return ref;
}

function activate(e) {
  const el = e.target.closest('[data-pin-kind]');
  if (!el) return;
  e.preventDefault();
  e.stopPropagation();
  const added = store.add(refFor(el));
  const link = '<a href="/theorycraft">Theory Craft</a>';
  toast(added ? `Pinned to ${link}` : `Already pinned — view on ${link}`);
}

document.addEventListener('click', activate);
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
  if (e.target.closest && e.target.closest('[data-pin-kind]')) activate(e);
});
```

- [ ] **Step 2: Load the module site-wide**

In `views/base.njk`, immediately after the `add-to-build.js` script tag (line ~64), add:

```html
  <!-- Add-to-Theory-Craft pin affordance (delegated; toast). Module = deferred. -->
  <script type="module" src="/static/js/add-to-pins.js"></script>
```

- [ ] **Step 3: Style the pin icon**

In `public/css/app.css`, after the `.add-build-icon` rule (~line 1048), add:

```css
/* Add-to-Theory-Craft pin sits beside Add-to-Build in .card-actions. */
.add-pin { cursor: pointer; display: inline-flex; opacity: .75; }
.add-pin:hover, .add-pin:focus-visible { opacity: 1; }
.add-pin-icon { width: 1.05em; height: 1.05em; }
```

- [ ] **Step 4: Verify end-to-end in the running app (headless)**

Run the dev server and drive a real pin from a non-theorycraft page, confirming it lands on `/theorycraft` after navigation. From the repo root with the server running (`npm run dev` in another shell, or reuse an existing instance):

```bash
node scripts/verify-sitewide-pin.mjs
```

Create `scripts/verify-sitewide-pin.mjs` (mirrors `scripts/verify-tree-embed.mjs`'s puppeteer-core + CHROME env pattern — copy its launch preamble verbatim, then):

```js
// Loads /uniques, clicks the first Add-to-Theory-Craft pin, then loads
// /theorycraft and asserts the pinned chip appears in the tray.
const page = await browser.newPage();
await page.goto(`${BASE}/uniques`, { waitUntil: 'networkidle0' });
await page.click('[data-pin-kind]');
await page.waitForSelector('.build-toast');
await page.goto(`${BASE}/theorycraft`, { waitUntil: 'networkidle0' });
await page.waitForSelector('.tc-pin-chip', { timeout: 5000 });
const chips = await page.$$eval('.tc-pin-chip', (els) => els.length);
if (chips < 1) { console.error('FAIL: pin did not appear on /theorycraft'); process.exit(1); }
console.log(`PASS: ${chips} pinned chip(s) on /theorycraft`);
await browser.close();
```

Expected: `PASS: 1 pinned chip(s) on /theorycraft`. (If no local server is available in the sandbox, defer this to Task 4's static-build check, which serves `dist/` and runs the same script against it.)

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: PASS — 645+ (2 new pin-store + 1 new render test on top of 643).

- [ ] **Step 6: Commit**

```bash
git add public/js/add-to-pins.js views/base.njk public/css/app.css scripts/verify-sitewide-pin.mjs
git commit -m "feat(planner): wire the site-wide pin handler, load it, and style it"
```

---

### Task 4: Static-build verification + roadmap/TODO ticks

**Files:**
- Modify: `docs/superpowers/specs/2026-07-06-build-planner-roadmap.md` (tick Phase 6 + the TODO line)
- Modify: `docs/superpowers/specs/2026-07-06-theorycraft-pinning-design.md` (tick the acceptance checkboxes)
- Modify: `docs/TODO.md` (mark items 3 and 4 done)

- [ ] **Step 1: Run the static build (catches static-only failure modes)**

Run: `npm run build:static`
Expected: build completes; the prerender crawler passes (no new fetched URL was introduced — the toast links to `/theorycraft`, already crawled). Confirm `dist/js/add-to-pins.js` exists.

- [ ] **Step 2: Verify the pin round-trips on the built static site**

Serve `dist/` (e.g. `npx http-server dist -p 8788 -s &` or the repo's preferred static server) and run the verify script against it:

```bash
BASE=http://localhost:8788 node scripts/verify-sitewide-pin.mjs
```

Expected: `PASS: 1 pinned chip(s) on /theorycraft`. Confirms the affordance works under the client-rendered static theorycraft (not just the dev server).

- [ ] **Step 3: Tick the roadmap + design acceptance boxes**

In `docs/superpowers/specs/2026-07-06-build-planner-roadmap.md`, change the Phase 6 checklist line to:

```markdown
- [x] Phase 6 — Theorycraft pinning (pin board 4c41e00; promote-to-build 0d51c60/b66ce2d; site-wide pin affordance — this session)
```

In `docs/superpowers/specs/2026-07-06-theorycraft-pinning-design.md`, tick all four boxes under "Testing & acceptance" (`- [ ]` → `- [x]`).

In `docs/TODO.md`, mark items 3 and 4 complete (append ` — ✅ done (Build Planner roadmap Phase 6)` to each line, matching however completed items are marked in that file; if none are marked yet, prefix `~~` str*through or add `(done)`).

- [ ] **Step 4: Final full-suite gate**

Run: `npm test`
Expected: PASS (645+).

- [ ] **Step 5: Commit (held branch — do NOT push to main)**

```bash
git add docs/superpowers/specs/2026-07-06-build-planner-roadmap.md docs/superpowers/specs/2026-07-06-theorycraft-pinning-design.md docs/TODO.md
git commit -m "docs(planner): tick Phase 6 (site-wide pin affordance); mark TODO 3 & 4 done"
```

---

## Self-Review

**Spec coverage** (`2026-07-06-theorycraft-pinning-design.md`):
- Pin board → shipped (4c41e00), unchanged here.
- Pin icon on theorycraft result cards → shipped, unchanged.
- **Site-wide third icon in `card-actions.njk` (`data-pin-*` + delegated handler)** → Task 2 + Task 3. ✓
- "Pinning from a gem page adds to the board … the toast links there" → Task 3 toast → `/theorycraft`; coarse-gem recovery (Task 1) ensures gem/support/spirit all resolve. ✓
- Promotion to build → already shipped (0d51c60/b66ce2d); noted, not re-implemented. ✓
- Acceptance #1 (persist/unpin/clear) → pin board, already covered; unaffected. ✓
- Acceptance #2 (pin from a non-theorycraft page appears on the board) → Task 3 + Task 4 verify script. ✓
- Acceptance #3 (promote lands in `unassigned`, opens in editor) → already shipped/tested. ✓
- Acceptance #4 (works on static build; `npm test` green; TODO 3 & 4 markable) → Task 4. ✓

**Placeholder scan:** every code step shows full content; the one script skeleton (`verify-sitewide-pin.mjs`) references `scripts/verify-tree-embed.mjs`'s launch preamble to copy verbatim (exact, existing file) rather than re-inventing puppeteer boilerplate.

**Type consistency:** `resolve()` returns `{ resolved, removed }` throughout (Task 1) and callers in `theorycraft-client.js` read `.resolved`/`.removed` (unchanged). `addPin(kind, slug, classSlug)` and `tradeLink/tradeButton(url, kind, slug, classSlug)` signatures line up. `refFor` builds `{ category, slug, classSlug? }` matching `normalizeRef` (base requires `classSlug`; gem/unique must not set it).

**Risk note:** `add-to-build.js` and `add-to-pins.js` both register a global `click` listener, but they key off disjoint attributes (`[data-add-build-kind]` vs `[data-pin-kind]`), and each `activate` no-ops when its element isn't the click target — no interference. `add-to-build.js` calls `stopPropagation` only when it matches its own control, so a pin click is not swallowed.
