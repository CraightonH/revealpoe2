# Build Planner Phase 4a Implementation Plan — /builds list, read-only viewer, Add-to-Build

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the first user-facing Build Planner surface: a `/builds` page (build list + read-only build viewer + share-code import preview) and an "Add to Build" affordance on every card site-wide, all running on the pure-static architecture.

**Architecture:** A prerendered `/builds` shell page whose views (list / viewer / import) are client-rendered from `location.hash` by a thin controller over pure, node-tested render functions. All state flows through the existing `build-store.js` (localStorage) and `build-code.js` (share codec) foundations — no new storage paths. The Add-to-Build affordance mirrors the trade-link pattern exactly: macro-emitted `data-*` attributes + one delegated handler module.

**Tech Stack:** Express + Nunjucks (dev/prerender), vanilla ESM browser modules (no bundler), `node:test` + supertest.

**Specs:** `docs/superpowers/specs/2026-07-06-builds-pages-design.md` (milestone 4a) + `docs/superpowers/specs/2026-07-21-build-planner-amendments-design.md` (read-only viewer pulled forward; theorycraft promote-to-build folds in here).

## Global Constraints

- **Static-first:** builds exist only in the visitor's localStorage; NO per-build server routes. One prerendered shell at `/builds`; view switching via `location.hash` (`#/b/<id>`, `#/import/<code>`).
- **Crawler discoverability:** every client-fetched URL must appear in a crawlable attribute (`href`, `hx-get`, `data-card-url`, `data-keyword`) — `/builds` is discovered via the nav `href`. Files under `public/` are copied to `dist/` automatically (no crawl needed for `/static/*`).
- **Pure cores, dual-use:** logic modules importable by both `node --test` (relative imports) and the browser; DOM wiring stays in thin browser-only controllers (absolute `/static/js/...` imports).
- **Never edit `data/source/`.** No graph/build-pipeline changes are needed in this phase.
- **Escape ALL interpolated strings in client-rendered HTML** (the `esc()` pattern in `theorycraft-client.js`).
- **Keep `npm test` green after every task.** Commit per task, message style `feat(planner): ...` / `test(planner): ...`. Do NOT add `Co-Authored-By` lines.
- All builds go through `build-store.js` — never touch `reveal.builds.v1` directly.
- Item reference shape everywhere: `{ kind: 'unique'|'base'|'gem', slug }`.

## File Structure

| File | Responsibility |
|---|---|
| `views/builds.njk` (create) | Prerendered shell: header, noscript notice, empty view container, module script |
| `views/base.njk` (modify) | `{% block styles %}` hook, nav "Builds" link, `add-to-build.js` script tag |
| `src/routes/pages.js` (modify) | `GET /builds` route rendering the shell |
| `public/css/builds.css` (create) | Page styles for list/viewer, action menu, toast |
| `public/js/build-host.js` (create) | Browser-only singleton: `getStore()` over `window.localStorage` + cross-tab refresh |
| `public/js/builds-render.js` (create) | PURE: `parseRoute`, `renderList`, `renderBuild`, `renderImport`, `esc` — node-tested |
| `public/js/builds-page.js` (create) | Browser controller: hash router, CRUD actions, import decode, doc resolution |
| `views/macros/card-actions.njk` (modify) | `addIcon`, add-build affordance folded into shared containers |
| `views/macros/unique-card.njk`, `gem-card.njk`, `base-card.njk` (modify) | Pass kind/slug to the new macros |
| `public/js/add-to-build.js` (create) | Site-wide delegated handler: build-picker menu + toast; exports `openBuildMenu` |
| `public/js/theorycraft-client.js` (modify) | Pin-tray "Add pins to build…" (promote-to-build) |
| `views/theorycraft.njk` (modify) | Tray promote button markup |
| `test/buildsRender.test.js` (create), `test/server.test.js`, `test/render.test.js` (modify) | Coverage |

---

### Task 1: `/builds` shell route, nav link, page CSS

**Files:**
- Modify: `src/routes/pages.js` (add route inside `registerPages`, after the `/passives` route)
- Create: `views/builds.njk`
- Modify: `views/base.njk` (styles block + nav item)
- Create: `public/css/builds.css`
- Test: `test/server.test.js` (append)

**Interfaces:**
- Consumes: nothing new.
- Produces: `GET /builds` → 200 shell containing `[data-builds-root]`, `[data-builds-view]`, and `<script type="module" src="/static/js/builds-page.js">` (module created in Task 3 — the tag ships now so the shell is final). `{% block styles %}` hook in `base.njk` for per-page CSS.

- [ ] **Step 1: Write the failing tests** — append to `test/server.test.js`:

```js
test('GET /builds returns the planner shell', async () => {
  const app = createApp();
  const res = await request(app).get('/builds');
  assert.equal(res.status, 200);
  assert.ok(res.text.includes('data-builds-root'));
  assert.ok(res.text.includes('data-builds-view'));
  assert.ok(res.text.includes('/static/js/builds-page.js'));
  assert.ok(res.text.includes('/static/css/builds.css'));
  assert.ok(res.text.includes('<noscript>'));
});

test('site nav links to /builds on every page', async () => {
  const app = createApp();
  const res = await request(app).get('/gems');
  assert.equal(res.status, 200);
  assert.match(res.text, /href="\/builds"/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/server.test.js 2>&1 | tail -20`
Expected: both new tests FAIL (404 / missing markup).

- [ ] **Step 3: Implement**

`src/routes/pages.js` — after the `/passives` route:

```js
  app.get('/builds', (_req, res) => {
    res.render('builds.njk');
  });
```

`views/builds.njk`:

```njk
{% extends "base.njk" %}
{% block title %}Builds — Reveal · PoE2 Wiki{% endblock %}
{% block og_title %}Build Planner — Reveal · PoE2 Wiki{% endblock %}
{% block og_desc %}Plan PoE2 builds — gear, skills, supports, and passives — saved in your browser, shareable by URL.{% endblock %}
{% block styles %}<link rel="stylesheet" href="/static/css/builds.css">{% endblock %}
{% block content %}
<div class="builds-page" data-builds-root>
  <header class="builds-header">
    <div>
      <p class="item-index-eyebrow">Build Planner</p>
      <h1>Builds</h1>
      <p class="builds-lead">Plan gear, skills, and passives. Builds are saved in this browser only —
        share codes make them portable.</p>
    </div>
  </header>
  <noscript><p class="builds-noscript">The Build Planner needs JavaScript. Builds are stored locally
    in your browser; nothing is uploaded.</p></noscript>
  <div class="builds-view" data-builds-view></div>
  <script type="module" src="/static/js/builds-page.js"></script>
</div>
{% endblock %}
```

`views/base.njk` — two edits. Add the styles hook on the line after the `browse.css` link:

```njk
  <link rel="stylesheet" href="/static/css/browse.css">
  {% block styles %}{% endblock %}
```

Add the nav item after the Theory Crafting `<li>`:

```njk
      <li class="site-nav__item">
        <a href="/builds" class="site-nav__top">Builds</a>
      </li>
```

`public/css/builds.css` — page skeleton using existing tokens (extended in later tasks):

```css
/* Build Planner surfaces: /builds list + read-only viewer. */
.builds-page { max-width: 72rem; margin: 0 auto; padding: 1.5rem 1rem 3rem; }
.builds-header { display: flex; justify-content: space-between; align-items: end; gap: 1rem; margin-bottom: 1.25rem; }
.builds-lead { color: var(--text-muted, #9a927e); max-width: 46rem; }
.builds-noscript { border: 1px solid var(--card-border, #3a352a); padding: .75rem 1rem; border-radius: 6px; }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/server.test.js 2>&1 | tail -20`
Expected: PASS (all, including pre-existing).

- [ ] **Step 5: Full suite + commit**

Run: `npm test 2>&1 | tail -5` — expected green.

```bash
git add src/routes/pages.js views/builds.njk views/base.njk public/css/builds.css test/server.test.js
git commit -m "feat(planner): /builds shell page, nav link, per-page styles hook"
```

---

### Task 2: Pure render core — `builds-render.js`

**Files:**
- Create: `public/js/builds-render.js`
- Create: `public/js/build-host.js`
- Test: `test/buildsRender.test.js`

**Interfaces:**
- Consumes: build objects shaped by `emptyBuild()` in `public/js/build-store.js` (`{id, name, notes, class, ascendancy, gear: {slot: {item, wishlist}}, unassigned: [], skills: [{gem:{slug}, level, supports:[{slug}]}], tree: {code, notablePriority}}`).
- Produces (Task 3 relies on these exact signatures):
  - `parseRoute(hash: string) -> {view:'list'} | {view:'build', id} | {view:'import', code}`
  - `renderList(builds: Build[]) -> string` (HTML; per-row action hooks `data-build-open|rename|duplicate|delete` carrying the build id, plus one `[data-builds-new]` button)
  - `renderBuild(build, resolveRef) -> string` — `resolveRef({kind, slug}) -> {name, iconUrl?, url?} | null`
  - `renderImport(state: {status:'loading'} | {status:'error', message} | {status:'ready', build}, resolveRef) -> string` (ready-state includes `[data-import-save]`)
  - `esc(s) -> string`
  - `getStore()` from `build-host.js` (browser-only; NOT node-tested)

- [ ] **Step 1: Write the failing tests** — `test/buildsRender.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRoute, renderList, renderBuild, renderImport, esc } from '../public/js/builds-render.js';
import { emptyBuild } from '../public/js/build-store.js';

const fixedBuild = (over = {}) => emptyBuild({ now: () => 1750000000000, uuid: () => 'b-1', ...over });

test('parseRoute maps hashes to views', () => {
  assert.deepEqual(parseRoute(''), { view: 'list' });
  assert.deepEqual(parseRoute('#'), { view: 'list' });
  assert.deepEqual(parseRoute('#/b/b-1'), { view: 'build', id: 'b-1' });
  assert.deepEqual(parseRoute('#/import/1abc'), { view: 'import', code: '1abc' });
  assert.deepEqual(parseRoute('#/nonsense'), { view: 'list' });
});

test('renderList: empty state invites creation', () => {
  const html = renderList([]);
  assert.match(html, /data-builds-new/);
  assert.match(html, /saved in this browser/i);
});

test('renderList: rows carry action hooks and escape names', () => {
  const b = fixedBuild({ name: '<b>xss</b>', class: 'sorceress' });
  const html = renderList([b]);
  assert.ok(html.includes('&lt;b&gt;xss&lt;/b&gt;'));
  assert.ok(!html.includes('<b>xss</b>'));
  assert.match(html, /href="#\/b\/b-1"/);
  for (const act of ['rename', 'duplicate', 'delete']) {
    assert.ok(html.includes(`data-build-${act}="b-1"`), `missing ${act}`);
  }
});

test('renderBuild: resolves refs, humanizes slots, shows setups', () => {
  const b = fixedBuild({
    name: 'Spark',
    class: 'sorceress',
    ascendancy: 'stormweaver',
    gear: { 'body-armour': { item: { kind: 'unique', slug: 'the-three-dragons' }, wishlist: [] } },
    unassigned: [{ kind: 'gem', slug: 'spark' }],
    skills: [{ gem: { slug: 'spark' }, level: 20, supports: [{ slug: 'pierce' }] }],
    tree: { code: 'v7code', notablePriority: [111, 222] },
  });
  const resolve = (ref) => ({ name: `N:${ref.slug}`, iconUrl: null, url: `/x/${ref.slug}` });
  const html = renderBuild(b, resolve);
  assert.match(html, /Body Armour/);
  assert.match(html, /N:the-three-dragons/);
  assert.match(html, /N:spark/);
  assert.match(html, /N:pierce/);
  assert.match(html, /2 prioritized/);
});

test('renderBuild: unresolved refs fall back to the slug', () => {
  const b = fixedBuild({ unassigned: [{ kind: 'gem', slug: 'mystery-gem' }] });
  assert.match(renderBuild(b, () => null), /mystery-gem/);
});

test('renderImport states', () => {
  assert.match(renderImport({ status: 'loading' }, () => null), /Decoding/i);
  assert.match(renderImport({ status: 'error', message: 'nope' }, () => null), /nope/);
  const ready = renderImport({ status: 'ready', build: fixedBuild({ name: 'Shared' }) }, () => null);
  assert.match(ready, /Shared/);
  assert.match(ready, /data-import-save/);
});

test('esc escapes html metacharacters', () => {
  assert.equal(esc(`<a b="c">&'`), '&lt;a b=&quot;c&quot;&gt;&amp;&#39;');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/buildsRender.test.js 2>&1 | tail -10`
Expected: FAIL — cannot find module `builds-render.js`.

- [ ] **Step 3: Implement** — `public/js/builds-render.js`:

```js
// public/js/builds-render.js
// Pure ES module — HTML renderers for the /builds surface (list, read-only
// viewer, import preview). No DOM access, no fetch: node-testable
// (query-core.js pattern). The controller (builds-page.js) owns wiring.

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** '#/b/<id>' -> build view, '#/import/<code>' -> import view, else list. */
export function parseRoute(hash) {
  const h = String(hash ?? '').replace(/^#/, '');
  if (h.startsWith('/b/')) {
    const id = decodeURIComponent(h.slice(3));
    if (id) return { view: 'build', id };
  }
  if (h.startsWith('/import/')) {
    const code = h.slice('/import/'.length);
    if (code) return { view: 'import', code };
  }
  return { view: 'list' };
}

const titleCase = (slug) => String(slug ?? '').split('-')
  .map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

const classLine = (b) => [b.class, b.ascendancy].filter(Boolean).map(titleCase).join(' · ') || 'No class chosen';

const dateLine = (ms) => new Date(ms).toISOString().slice(0, 10);

function refHtml(ref, resolveRef) {
  const doc = resolveRef(ref) || {};
  const name = doc.name || ref.slug;
  const icon = doc.iconUrl
    ? `<img class="builds-ref__icon" src="${esc(doc.iconUrl)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">`
    : '';
  const inner = `${icon}<span class="builds-ref__name builds-ref__name--${esc(ref.kind)}">${esc(name)}</span>`;
  return doc.url ? `<a class="builds-ref" href="${esc(doc.url)}">${inner}</a>`
                 : `<span class="builds-ref">${inner}</span>`;
}

export function renderList(builds) {
  const newBtn = '<button class="builds-new" type="button" data-builds-new>New build</button>';
  if (!builds.length) {
    return `<div class="builds-empty">
      <h2>No builds yet</h2>
      <p>Builds are saved in this browser only. Create one here, or use the
      “Add to build” icon on any gem, unique, or base item card.</p>
      ${newBtn}</div>`;
  }
  const rows = builds.map((b) => {
    const items = Object.values(b.gear).filter((g) => g.item).length + b.unassigned.length;
    return `<li class="builds-row">
      <a class="builds-row__open" href="#/b/${encodeURIComponent(b.id)}">
        <span class="builds-row__name">${esc(b.name)}</span>
        <span class="builds-row__meta">${esc(classLine(b))} — ${items} items · ${b.skills.length} skill setups</span>
        <span class="builds-row__date">updated ${esc(dateLine(b.updatedAt))}</span>
      </a>
      <span class="builds-row__actions">
        <button type="button" data-build-rename="${esc(b.id)}">Rename</button>
        <button type="button" data-build-duplicate="${esc(b.id)}">Duplicate</button>
        <button type="button" data-build-delete="${esc(b.id)}">Delete</button>
      </span></li>`;
  }).join('');
  return `<div class="builds-list-head">${newBtn}</div><ul class="builds-list">${rows}</ul>`;
}

function sections(b, resolveRef) {
  const gear = Object.entries(b.gear).filter(([, g]) => g.item)
    .map(([slot, g]) => `<li class="builds-slot"><span class="builds-slot__label">${esc(titleCase(slot))}</span>${refHtml(g.item, resolveRef)}</li>`);
  const unassigned = b.unassigned.map((ref) => `<li>${refHtml(ref, resolveRef)}</li>`);
  const skills = b.skills.map((s) => {
    const sups = s.supports.map((sup) => `<li>${refHtml({ kind: 'gem', slug: sup.slug }, resolveRef)}</li>`).join('');
    const lvl = s.level ? ` <span class="builds-setup__level">Lv ${esc(s.level)}</span>` : '';
    return `<li class="builds-setup">${refHtml({ kind: 'gem', slug: s.gem.slug }, resolveRef)}${lvl}
      ${sups ? `<ul class="builds-setup__supports">${sups}</ul>` : ''}</li>`;
  });
  const tree = b.tree.code
    ? `Passive tree saved · ${b.tree.notablePriority.length} prioritized`
    : 'No passive tree yet';
  const sec = (title, body) => `<section class="builds-section"><h2>${title}</h2>${body}</section>`;
  return [
    sec('Gear', gear.length ? `<ul class="builds-gear">${gear.join('')}</ul>` : '<p class="builds-none">Nothing equipped.</p>'),
    unassigned.length ? sec('Unassigned items', `<ul class="builds-unassigned">${unassigned.join('')}</ul>`) : '',
    sec('Skills', skills.length ? `<ul class="builds-setups">${skills.join('')}</ul>` : '<p class="builds-none">No skill setups.</p>'),
    sec('Passive tree', `<p>${esc(tree)}</p>`),
    b.notes ? sec('Notes', `<p class="builds-notes">${esc(b.notes)}</p>`) : '',
  ].join('');
}

/** Read-only build viewer (editing arrives in Phase 4b). */
export function renderBuild(b, resolveRef) {
  return `<article class="builds-viewer">
    <header class="builds-viewer__head">
      <a class="builds-back" href="#">← All builds</a>
      <h2>${esc(b.name)}</h2>
      <p class="builds-viewer__class">${esc(classLine(b))}</p>
    </header>
    ${sections(b, resolveRef)}</article>`;
}

/** Import preview: decode states for #/import/<code>. */
export function renderImport(state, resolveRef) {
  if (state.status === 'loading') return '<div class="builds-import"><p>Decoding shared build…</p></div>';
  if (state.status === 'error') {
    return `<div class="builds-import builds-import--error">
      <h2>This share link didn’t decode</h2><p>${esc(state.message)}</p>
      <p><a href="#">Back to your builds</a></p></div>`;
  }
  const b = state.build;
  return `<div class="builds-import">
    <p class="builds-import__banner">Shared build preview — not saved to your browser yet.
      <button type="button" data-import-save>Save a copy</button></p>
    ${renderBuild(b, resolveRef)}</div>`;
}
```

`public/js/build-host.js` (browser-only singleton; no test — it is pure wiring):

```js
// public/js/build-host.js
// Browser-only singleton over build-store.js: one store instance shared by
// every importer on a page (builds-page.js, add-to-build.js), wired to the
// cross-tab 'storage' event. Pure modules stay environment-free; this is the
// one place the real localStorage is bound.
import { createStore, STORE_KEY } from '/static/js/build-store.js';

let store = null;
export function getStore() {
  if (!store) {
    store = createStore(window.localStorage);
    window.addEventListener('storage', (e) => { if (e.key === STORE_KEY) store.refresh(); });
  }
  return store;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/buildsRender.test.js 2>&1 | tail -10`
Expected: PASS (7 tests). Note `renderBuild` uses `emptyBuild`-shaped input — if an assertion fails on shape, fix the test fixture, not the store.

- [ ] **Step 5: Commit**

```bash
git add public/js/builds-render.js public/js/build-host.js test/buildsRender.test.js
git commit -m "feat(planner): pure render core for /builds (list, viewer, import preview)"
```

---

### Task 3: Browser controller — `builds-page.js`

**Files:**
- Create: `public/js/builds-page.js`
- Test: existing suites only (controller is thin wiring over Task 2's tested core; a dev-server smoke check closes the task)

**Interfaces:**
- Consumes: `getStore()` (build-host), `parseRoute/renderList/renderBuild/renderImport` (builds-render), `decodeBuild` + `CodecError` (`build-code.js`), search-index docs from `/static/generated/search-index.json` (doc fields used: `category`, `slug`, `name`, `iconUrl`, `url`).
- Produces: the working `/builds` page. Ref resolution rule (reused in Task 5/6): build-ref kind `gem` matches index categories `gem|support|spirit`; kinds `unique`/`base` match their same-named category by `slug`.

- [ ] **Step 1: Implement** — `public/js/builds-page.js`:

```js
// Controller for the /builds shell: routes location.hash to the pure renderers
// and delegates all actions to the shared store. Rendering logic lives in
// builds-render.js (node-tested); this file is DOM wiring only.
import { getStore } from '/static/js/build-host.js';
import { parseRoute, renderList, renderBuild, renderImport } from '/static/js/builds-render.js';
import { decodeBuild } from '/static/js/build-code.js';

const root = document.querySelector('[data-builds-root]');
const view = root?.querySelector('[data-builds-view]');

if (root && view) {
  const store = getStore();

  // Ref resolution over the search index (lazy: list view never loads it).
  const CATEGORIES = { gem: ['gem', 'support', 'spirit'], unique: ['unique'], base: ['base'] };
  let docsByKey = null;
  let docsLoading = null;
  function loadDocs() {
    if (docsByKey) return Promise.resolve(docsByKey);
    docsLoading ??= fetch('/static/generated/search-index.json')
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((docs) => {
        docsByKey = new Map();
        for (const d of docs) {
          const key = `${d.category}:${d.slug}`;
          if (!docsByKey.has(key)) docsByKey.set(key, d);
        }
        return docsByKey;
      });
    return docsLoading;
  }
  const resolveRef = (ref) => {
    for (const cat of CATEGORIES[ref.kind] ?? []) {
      const d = docsByKey?.get(`${cat}:${ref.slug}`);
      if (d) return { name: d.name, iconUrl: d.iconUrl ?? null, url: d.url ?? null };
    }
    return null;
  };

  let importState = null; // cached decode for the current #/import/<code>

  function render() {
    const route = parseRoute(location.hash);
    if (route.view === 'list') {
      importState = null;
      view.innerHTML = renderList(store.list());
      return;
    }
    if (route.view === 'build') {
      importState = null;
      const b = store.get(route.id);
      if (!b) { location.hash = ''; return; }
      view.innerHTML = renderBuild(b, resolveRef);
      loadDocs().then(() => {
        // Re-render once docs arrive so slugs upgrade to names/icons.
        if (parseRoute(location.hash).view === 'build') view.innerHTML = renderBuild(store.get(route.id) ?? b, resolveRef);
      }).catch(() => {});
      return;
    }
    // import view
    if (importState?.code !== route.code) {
      importState = { code: route.code, state: { status: 'loading' } };
      Promise.all([decodeBuild(route.code), loadDocs().catch(() => null)])
        .then(([build]) => { importState.state = { status: 'ready', build }; })
        .catch((e) => {
          importState.state = { status: 'error', message: e?.code === 'bad-version'
            ? 'This code was made by a newer version of the site.'
            : 'The code is damaged or incomplete — recopy the full link.' };
        })
        .finally(() => { if (parseRoute(location.hash).code === route.code) render(); });
    }
    view.innerHTML = renderImport(importState.state, resolveRef);
  }

  view.addEventListener('click', (e) => {
    const attr = (name) => e.target.closest(`[${name}]`)?.getAttribute(name);
    if (e.target.closest('[data-builds-new]')) {
      const b = store.create();
      location.hash = `#/b/${encodeURIComponent(b.id)}`;
      return;
    }
    const rename = attr('data-build-rename');
    if (rename) {
      const cur = store.get(rename);
      const name = cur && window.prompt('Build name', cur.name);
      if (name?.trim()) store.update(rename, { name: name.trim() });
      return;
    }
    const dup = attr('data-build-duplicate');
    if (dup) { store.duplicate(dup); return; }
    const del = attr('data-build-delete');
    if (del) {
      const cur = store.get(del);
      if (cur && window.confirm(`Delete “${cur.name}”? This cannot be undone.`)) store.remove(del);
      return;
    }
    if (e.target.closest('[data-import-save]') && importState?.state.status === 'ready') {
      const saved = store.create({ ...importState.state.build });
      location.hash = `#/b/${encodeURIComponent(saved.id)}`;
    }
  });

  store.subscribe(() => render());
  window.addEventListener('hashchange', render);
  render();
}
```

- [ ] **Step 2: Static analysis + suite**

Run: `node --check public/js/builds-page.js && npm test 2>&1 | tail -5`
Expected: syntax OK, suite green.

- [ ] **Step 3: Dev-server smoke check (behavioral)**

Run: `npm run dev` in the background, then with Node fetch (NOT curl) confirm `GET http://localhost:3000/builds` returns the shell (200, contains `data-builds-root`). Then verify the client flow in headless Chrome if available; otherwise document that list CRUD verification happens in Task 7's static acceptance pass. Kill the dev server after.

- [ ] **Step 4: Commit**

```bash
git add public/js/builds-page.js
git commit -m "feat(planner): /builds client controller — hash router, list CRUD, import preview"
```

---

### Task 4: Add-to-Build macros on every card

**Files:**
- Modify: `views/macros/card-actions.njk`
- Modify: `views/macros/unique-card.njk`, `views/macros/gem-card.njk`, `views/macros/base-card.njk`
- Test: `test/render.test.js` (append; if the file's helpers make server.test.js a better fit, append there instead — match the existing suite that asserts on card HTML)

**Interfaces:**
- Consumes: existing `tradeLink`/`tradeButton` call sites; card view models' `slug` field (the same value the cards already emit as `data-item-slug` — verify the exact property name per macro when editing: condensed models `u`/`g`/`b`, popup models `vm`).
- Produces: every full popup and condensed card emits `data-add-build-kind` + `data-add-build-slug` alongside the trade affordance, inside the SAME `.card-actions` container (per that macro file's own design comment). Task 5's handler binds to these attributes.

- [ ] **Step 1: Write the failing tests** — append (adjust suite file per note above):

```js
test('unique popup and condensed card carry the Add-to-Build affordance', async () => {
  const app = createApp();
  const detail = await request(app).get('/unique/astramentis');
  assert.match(detail.text, /data-add-build-kind="unique"/);
  assert.match(detail.text, /data-add-build-slug="astramentis"/);
  const index = await request(app).get('/uniques');
  assert.match(index.text, /data-add-build-kind="unique"/);
});

test('gem and base cards carry the Add-to-Build affordance', async () => {
  const app = createApp();
  const gem = await request(app).get('/gems');
  assert.match(gem.text, /data-add-build-kind="gem"/);
  const bases = await request(app).get('/bases');
  assert.match(bases.text, /data-add-build-kind="base"/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/render.test.js 2>&1 | tail -10` — expected FAIL.

- [ ] **Step 3: Implement**

`views/macros/card-actions.njk` — add an icon + affordance macro, and extend the two containers to take the build ref. Keep macro names `tradeLink`/`tradeButton` (call sites already import them) but add optional `kind`/`slug` params:

```njk
{# Plus-in-circle "add to build" icon — self-contained inline SVG, scaleIcon's style. #}
{% macro buildIcon() %}
<svg class="add-build-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
     stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
  <path d="M12 5v14M5 12h14"/>
  <circle cx="12" cy="12" r="9"/>
</svg>
{% endmacro %}

{% macro addBuild(kind, slug) %}
{% if kind and slug %}
  <span class="add-build" role="button" tabindex="0"
        data-add-build-kind="{{ kind }}" data-add-build-slug="{{ slug }}"
        title="Add to build" aria-label="Add to build">{{ buildIcon() }}</span>
{% endif %}
{% endmacro %}

{% macro tradeLink(url, kind, slug) %}
{% if url or (kind and slug) %}
<div class="card-actions">
  {% if url %}<a class="trade-link" href="{{ url }}" target="_blank" rel="noopener nofollow"
     title="Search on PoE Trade" aria-label="Search on PoE Trade">{{ scaleIcon() }}</a>{% endif %}
  {{ addBuild(kind, slug) }}
</div>
{% endif %}
{% endmacro %}

{% macro tradeButton(url, kind, slug) %}
{% if url or (kind and slug) %}
<span class="card-actions card-actions--overlay">
  {% if url %}<span class="trade-link" role="button" tabindex="0" data-trade-url="{{ url }}"
        title="Search on PoE Trade" aria-label="Search on PoE Trade">{{ scaleIcon() }}</span>{% endif %}
  {{ addBuild(kind, slug) }}
</span>
{% endif %}
{% endmacro %}
```

(Replace the existing `tradeLink`/`tradeButton` bodies; keep `scaleIcon` unchanged. Update the file's top comment to describe both affordances.)

Call sites — pass the ref (verify each model's slug property against nearby usage in the same macro, e.g. the attribute already rendered as `data-item-slug`):

- `views/macros/unique-card.njk`: `{{ tradeButton(u.tradeUrl, 'unique', u.slug) }}` and `{{ tradeLink(vm.tradeUrl, 'unique', vm.slug) }}`
- `views/macros/gem-card.njk`: `{{ tradeButton(g.tradeUrl, 'gem', g.slug) }}` and `{{ tradeLink(vm.tradeUrl, 'gem', vm.slug) }}`
- `views/macros/base-card.njk`: `{{ tradeButton(b.tradeUrl, 'base', b.slug) }}` and `{{ tradeLink(vm.tradeUrl, 'base', vm.slug) }}`

Add to `public/css/builds.css`:

```css
/* Add-to-Build affordance sits beside the trade scale in .card-actions. */
.add-build { cursor: pointer; display: inline-flex; opacity: .75; }
.add-build:hover, .add-build:focus-visible { opacity: 1; }
.add-build-icon { width: 1.05em; height: 1.05em; }
```

**Note:** `builds.css` only loads on `/builds` (Task 1's block). The affordance appears site-wide, so move these three rules into whichever stylesheet styles `.card-actions`/`.trade-link` today (search `public/css/*.css` for `.trade-link`) — put the rules beside it, not in builds.css.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test 2>&1 | tail -5` — full suite (render/server/prerender tests all touch card HTML). Expected: green.

- [ ] **Step 5: Commit**

```bash
git add views/macros/ public/css/ test/
git commit -m "feat(planner): Add-to-Build affordance on unique, gem, and base cards"
```

---

### Task 5: Site-wide handler — `add-to-build.js`

**Files:**
- Create: `public/js/add-to-build.js`
- Modify: `views/base.njk` (script tag)
- Modify: CSS file chosen in Task 4 (menu + toast styles)
- Test: `test/server.test.js` (script presence)

**Interfaces:**
- Consumes: `getStore()` (build-host), `data-add-build-kind`/`data-add-build-slug` attributes (Task 4).
- Produces: `openBuildMenu(anchorEl, refs, opts?) -> void` — exported for Task 6. `refs` is `Array<{kind, slug}>`; the menu lists builds + “New build…”, appends refs to the chosen build's `unassigned` (skipping refs already present), then toasts `Added N to <name> — open` linking `/builds#/b/<id>`.

- [ ] **Step 1: Write the failing test** — append to `test/server.test.js`:

```js
test('every page loads the add-to-build handler', async () => {
  const app = createApp();
  const res = await request(app).get('/gems');
  assert.ok(res.text.includes('/static/js/add-to-build.js'));
});
```

Run: `node --test test/server.test.js 2>&1 | tail -10` — expected FAIL.

- [ ] **Step 2: Implement** — `public/js/add-to-build.js`:

```js
// Site-wide delegated handler for the "Add to build" card affordance
// (data-add-build-kind/-slug, emitted by views/macros/card-actions.njk).
// Pattern: trade-link.js, upgraded to a picker menu because the action needs
// a target build. Also exports openBuildMenu for programmatic callers
// (theorycraft pin-tray promote).
import { getStore } from '/static/js/build-host.js';

let menu = null;
function closeMenu() { menu?.remove(); menu = null; }

function toast(html) {
  document.querySelector('.build-toast')?.remove();
  const el = document.createElement('div');
  el.className = 'build-toast';
  el.setAttribute('role', 'status');
  el.innerHTML = html;
  document.body.append(el);
  setTimeout(() => el.remove(), 5000);
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function addRefs(buildId, refs) {
  const store = getStore();
  const b = store.get(buildId);
  if (!b) return;
  const have = new Set([...b.unassigned, ...Object.values(b.gear).map((g) => g.item).filter(Boolean)]
    .map((r) => `${r.kind}:${r.slug}`));
  const fresh = refs.filter((r) => !have.has(`${r.kind}:${r.slug}`));
  if (fresh.length) store.update(buildId, { unassigned: [...b.unassigned, ...fresh] });
  const openLink = `<a href="/builds#/b/${encodeURIComponent(buildId)}">open</a>`;
  toast(fresh.length
    ? `Added ${fresh.length === 1 ? '' : fresh.length + ' items '}to <strong>${esc(b.name)}</strong> — ${openLink}`
    : `Already in <strong>${esc(b.name)}</strong> — ${openLink}`);
}

export function openBuildMenu(anchor, refs) {
  closeMenu();
  const store = getStore();
  const builds = store.list();
  menu = document.createElement('div');
  menu.className = 'build-menu';
  menu.setAttribute('role', 'menu');
  menu.innerHTML = builds.map((b) =>
    `<button type="button" role="menuitem" data-menu-build="${esc(b.id)}">${esc(b.name)}</button>`).join('') +
    '<button type="button" role="menuitem" data-menu-new>New build…</button>';
  document.body.append(menu);
  const r = anchor.getBoundingClientRect();
  menu.style.top = `${Math.round(r.bottom + window.scrollY + 4)}px`;
  menu.style.left = `${Math.round(Math.min(r.left + window.scrollX, window.scrollX + document.documentElement.clientWidth - menu.offsetWidth - 8))}px`;
  menu.addEventListener('click', (e) => {
    const pick = e.target.closest('[data-menu-build]');
    const isNew = e.target.closest('[data-menu-new]');
    if (!pick && !isNew) return;
    e.preventDefault();
    e.stopPropagation();
    const id = pick ? pick.getAttribute('data-menu-build') : store.create().id;
    closeMenu();
    addRefs(id, refs);
  });
  menu.querySelector('button')?.focus();
}

function refFor(el) {
  return { kind: el.getAttribute('data-add-build-kind'), slug: el.getAttribute('data-add-build-slug') };
}

function activate(e) {
  const el = e.target.closest('[data-add-build-kind]');
  if (!el) return false;
  e.preventDefault();
  e.stopPropagation();
  openBuildMenu(el, [refFor(el)]);
  return true;
}

document.addEventListener('click', (e) => {
  if (menu && !e.target.closest('.build-menu')) { const was = activate(e); if (!was) closeMenu(); return; }
  activate(e);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') return closeMenu();
  if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
  if (e.target.closest && e.target.closest('[data-add-build-kind]')) activate(e);
});
```

`views/base.njk` — after the `search-client.js` module tag:

```njk
  <!-- Add-to-Build card affordance (delegated; menu + toast). Module = deferred. -->
  <script type="module" src="/static/js/add-to-build.js"></script>
```

CSS (same file as Task 4's affordance rules):

```css
.build-menu { position: absolute; z-index: 60; min-width: 12rem; display: flex; flex-direction: column;
  background: var(--card-bg, #14130f); border: 1px solid var(--card-border, #3a352a); border-radius: 6px;
  padding: .25rem; box-shadow: 0 8px 24px rgb(0 0 0 / .5); }
.build-menu button { text-align: left; padding: .45rem .7rem; background: none; border: 0;
  color: inherit; cursor: pointer; border-radius: 4px; font: inherit; }
.build-menu button:hover, .build-menu button:focus-visible { background: rgb(255 255 255 / .08); }
.build-menu [data-menu-new] { border-top: 1px solid var(--card-border, #3a352a); border-radius: 0 0 4px 4px; }
.build-toast { position: fixed; bottom: 1.25rem; left: 50%; transform: translateX(-50%); z-index: 70;
  background: var(--card-bg, #14130f); border: 1px solid var(--card-border, #3a352a); border-radius: 6px;
  padding: .6rem 1rem; box-shadow: 0 8px 24px rgb(0 0 0 / .5); }
.build-toast a { text-decoration: underline; }
```

- [ ] **Step 3: Verify**

Run: `node --check public/js/add-to-build.js && npm test 2>&1 | tail -5` — expected green.
Dev-server spot check: on `/gems`, clicking the add icon on a card opens the menu; "New build…" creates a build and toasts; the icon click must NOT trigger the card's own navigation (the `stopPropagation` mirrors trade-link.js).

- [ ] **Step 4: Commit**

```bash
git add public/js/add-to-build.js views/base.njk public/css/ test/server.test.js
git commit -m "feat(planner): site-wide Add-to-Build handler with build picker menu and toast"
```

---

### Task 6: Theorycraft promote-to-build (pin tray)

**Files:**
- Modify: `views/theorycraft.njk` (tray button)
- Modify: `public/js/theorycraft-client.js` (handler)
- Test: `test/server.test.js` or `test/theorycraft.test.js` (markup presence — match existing suite conventions)

**Interfaces:**
- Consumes: `openBuildMenu(anchor, refs)` from `add-to-build.js`; resolved pins (`resolvedPins` in theorycraft-client.js, each `{ref: {category, slug}, doc}`).
- Produces: tray button `[data-tc-pin-promote]`. Category→kind mapping: `gem|support|spirit → gem`; `unique → unique`; `base → base`; all other categories (affix, keystone, notable, augment) are skipped with a note in the toast handled by menu flow (filter BEFORE opening the menu; if nothing survives, show the existing notice element with "Pinned items can't go in a build").

- [ ] **Step 1: Write the failing test** — assert `/theorycraft` markup includes `data-tc-pin-promote` (append to whichever suite already asserts on the pin tray markup — check `test/theorycraft.test.js` first):

```js
test('theorycraft pin tray offers promote-to-build', async () => {
  const app = createApp();
  const res = await request(app).get('/theorycraft');
  assert.ok(res.text.includes('data-tc-pin-promote'));
});
```

Run the suite file — expected FAIL.

- [ ] **Step 2: Implement**

`views/theorycraft.njk` — inside the tray, before the Clear-all button:

```njk
    <button class="tc-pin-tray__promote" type="button" data-tc-pin-promote>Add pins to build…</button>
    <button class="tc-pin-tray__clear" type="button" data-tc-pin-clear>Clear all</button>
```

`public/js/theorycraft-client.js`:

Add to the imports block:

```js
import { openBuildMenu } from '/static/js/add-to-build.js';
```

Add a branch in the root click handler, above the `[data-tc-pin-clear]` branch:

```js
    if (event.target.closest('[data-tc-pin-promote]')) {
      event.preventDefault();
      const KIND = { gem: 'gem', support: 'gem', spirit: 'gem', unique: 'unique', base: 'base' };
      const refs = resolvedPins
        .filter(({ ref }) => KIND[ref.category])
        .map(({ ref }) => ({ kind: KIND[ref.category], slug: ref.slug }));
      if (!refs.length) {
        notice.hidden = false;
        notice.innerHTML = '<span>Only gems, uniques, and bases can go in a build — no pinned items qualify.</span>' +
          '<button type="button" data-tc-pin-notice-dismiss aria-label="Dismiss notice">×</button>';
        return;
      }
      openBuildMenu(event.target.closest('[data-tc-pin-promote]'), refs);
      return;
    }
```

Style the button like `.tc-pin-tray__clear` (reuse its class rules — check the CSS file that styles the tray and add `.tc-pin-tray__promote` to the same selectors).

- [ ] **Step 3: Verify**

Run: `npm test 2>&1 | tail -5` — green. Dev-server spot check: pin a gem and an affix on `/theorycraft`; "Add pins to build…" opens the picker; choosing a build adds only the gem; affix-only pins produce the notice.

- [ ] **Step 4: Commit**

```bash
git add views/theorycraft.njk public/js/theorycraft-client.js public/css/ test/
git commit -m "feat(planner): promote theorycraft pins into a build"
```

---

### Task 7: Static acceptance pass + roadmap tick

**Files:**
- Modify: `docs/superpowers/specs/2026-07-06-build-planner-roadmap.md` (tick 4a)

- [ ] **Step 1: Full static build**

Run: `npm run build:static 2>&1 | tail -15`
Expected: completes; `dist/builds/index.html` exists (`ls dist/builds/`). A dead-link failure here means the nav href or a card attribute regressed — fix before proceeding.

- [ ] **Step 2: Serve `dist/` and verify the milestone acceptance criteria** (static server, e.g. `npx serve dist` or the repo's preferred method; verify with headless Chrome or Node fetch — NOT curl):

- [ ] Create / rename / duplicate / delete builds on `/builds`; state survives reload.
- [ ] Add-to-Build works from: a gem page popup, a unique condensed browse card, a theorycraft result detail — on the STATIC build.
- [ ] Theorycraft pin tray promote works; non-qualifying pins are skipped with the notice.
- [ ] `#/import/<code>` decodes a code produced in the console via `encodeBuild` (import `build-code.js` in DevTools) → preview renders → Save a copy lands in the list.
- [ ] Malformed code (`#/import/1zzz`) shows the friendly error, not a blank page.

- [ ] **Step 3: Tick the roadmap** — in the status checklist, change the 4a line to `- [x] Phase 4a — ... (<final commit sha>)`.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-07-06-build-planner-roadmap.md
git commit -m "docs(planner): Phase 4a complete — /builds list, viewer, Add-to-Build"
```

**Deliberately NOT in this phase:** the build editor (paper-doll, skill panel, pickers — Phase 4b), mod selection (4c), tree embed (5), share/export UX beyond the import route (8). Do not scaffold ahead.
