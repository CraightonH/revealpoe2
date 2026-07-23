# Passive Tree Embed + Notable Priority (Phase 5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Implementation coding is dispatched to Codex (codex:codex-rescue) per the roadmap; the orchestrating session commits and runs the gates (Codex's sandbox can't write `.git` or bind ports).

**Goal:** Replace the build editor's placeholder "paste a tree share code" box with the **real embedded interactive passive tree** (the full `/passives` experience) plus an ordered **Notable Priority** list beneath it; hovering a priority row highlights that node in the embed and clicking focuses it.

**Architecture:** `public/js/passive-tree.js` `init()` is made **embeddable** — every control-element lookup is scoped to a host `root` instead of `document`, and all page-chrome couplings (`location.hash` read/write, clipboard, `window.confirm`) become host-owned callbacks in an `opts` bag. The control-panel markup is extracted to a single pure source, `public/js/tree-panel.js` (`treePanelsHtml()`), which `init()` injects into `root` if absent — so `/passives` and the client-rendered build editor render **identical** controls with **no id collisions** (ids → `data-*` hooks, scoped queries). `/passives` becomes a thin host wiring the component back to `location.hash`/clipboard. The editor mounts the embed once and **reparents** its DOM across dossier re-renders (so allocation state survives), auto-saves the share code (debounced) via `build-store.js`, and renders a Notable Priority list from pure, node-tested cores (`tree-priority.js`).

**Tech Stack:** Vanilla ES modules (node:test for pure cores; headless Chrome via `puppeteer-core` in `node_modules` for DOM glue), Canvas 2D, existing v7 share-code codec (`passive-code.js`), existing GGG tree artifacts under `public/generated/` + `public/img/passive-atlas/`. Server surfaces are Nunjucks (`views/passives.njk`); the editor is client-rendered JS template strings (`editor-render.js`).

## Global Constraints

- **Read `docs/passive-tree.md` before touching anything tree-related.** Tree geometry/atlases come from GGG's official web data ingestion (`npm run fetch:tree`), NOT RePoE; graph relationships come from RePoE. Nothing hand-enumerated.
- **Data provenance policy holds:** no edits to `data/source/`; any new game facts go through `data/manual/*.json` overlays. This phase adds **no** game data — it is pure client/render work.
- **Pure cores, dual-use:** state/codec/reconcile/markup logic is written as pure ES modules importable by both node tests and the browser. DOM wiring is a thin layer over the pure core.
- **Pure static + client state:** planner pages are prerendered shells; all build state lives in localStorage, read/written **only** through `build-store.js` (never raw localStorage). The tree cross-phase contract is stored as `tree.code` (official v7 share-code string) + `tree.notablePriority: [nodeHash]` (numbers).
- **Crawler discoverability:** any new client-fetched URL must appear in a crawlable attribute or `extractLinks()` in `scripts/prerender.js`. **This phase adds none** — the embed fetches existing static artifacts (`/static/generated/passive-*.json`, `/static/img/passive-atlas/*`) that are copied to `dist/` wholesale, and the only new link (`/passives`) is already crawled.
- **Keep `npm test` green** (634 passing now). `pretest` rebuilds the graph + passives.
- **Verify static-only failure modes** with `npm run build:static` before ticking the phase (the crawler must pass).
- **Branch:** `planner/phase-4a-builds-pages` (held; ~70 commits ahead of `main`). **Do NOT merge/push to `main`** without owner go-ahead.
- **No `Co-Authored-By` lines in commits** (user rule).
- **Embeddable tree API contract** (cross-phase; Phase 8 depends on it): `init(canvas, data, opts)` returns an object with `getState()`/`setState()`, `setHighlight(hashes)`, `focusNode(hash)`, `getAllocatedNotables()`, `getPoints()`, `destroy()`, and fires `opts.onCodeChange(code)` / `opts.onChange()` / `opts.onReady(api)`.

## File Structure

- **Create:** `public/js/tree-panel.js` — pure `treePanelsHtml()` returning the control + stats panel markup (single source for both surfaces). Node-testable.
- **Create:** `public/js/tree-priority.js` — pure Notable Priority core: `reconcilePriority(prevOrder, allocatedHashes)`, `renderPriorityList(order, metaByHash, opts)`. Node-testable.
- **Modify:** `public/js/passive-tree.js` — scope control lookups to `root`; inject panels; host-owned hash/clipboard/confirm via `opts`; extend the returned API; add `onReady`/`onChange`/`onCodeChange`. `load(canvas, opts)` passes `opts` through.
- **Modify:** `views/passives.njk` — wrap becomes `<canvas>`-only; inline script becomes the thin host (reads `location.hash`/`?node=`, wires `onCopy`).
- **Modify:** `public/css/app.css` — one `#tree-fullscreen` selector → class-based (id dropped).
- **Modify:** `public/js/editor-render.js` — tree chapter renders the embed mount + points summary + Notable Priority container + "Open the passive tree" link; **remove** the `data-tree-code` paste input.
- **Modify:** `public/js/build-editor.js` — mount/reparent the embed; wire `onReady`/`onChange`/`onCodeChange`; points chips; Notable Priority DnD/hover/click; `destroy()` + pending-save flush on unmount; **remove** the `data-tree-code` `onChange` branch.
- **Modify:** `public/css/builds.css` — embed wrap sizing (`--embed` modifier), points chips, Notable Priority list styles.
- **Tests:** `test/treePanel.test.js` (new), `test/treePriority.test.js` (new), `test/editorRender.test.js` (update tree-chapter assertions), `test/server.test.js` (unchanged — only checks `<canvas>` + `passive-tree.js`; verify still green).
- **Verification script (manual, not CI):** `scripts/verify-tree-embed.mjs` — puppeteer-core against `npm run dev` proving `/passives` regression, two-instance id-scoping, editor mount/persist, hover-highlight, DnD.
- **Docs:** tick Phase 5 in `docs/superpowers/specs/2026-07-06-build-planner-roadmap.md`; append an architecture note to `docs/passive-tree.md` (the embeddable API + host-owned chrome).

---

### Task 1: Extract control-panel markup to a pure `tree-panel.js`

**Files:**
- Create: `public/js/tree-panel.js`
- Test: `test/treePanel.test.js`

**Interfaces:**
- Produces: `export function treePanelsHtml(): string` — the two panels (stats panel + control panel) as an HTML string, **preserving every existing CSS class** and swapping JS-lookup `id="tree-*"` for `data-tree-*` hooks. Consumed by `passive-tree.js` `init()` (Task 2) and, transitively, both surfaces.

**Hook map (id → data-attr), used by Task 2's scoped queries:**
`tree-points`→`data-tree-points`, `tree-class`→`data-tree-class`, `tree-ascendancy`→`data-tree-asc`, `tree-search`→`data-tree-search`, `tree-reset`→`data-tree-reset`, `tree-copy-code`→`data-tree-copy`, `tree-fullscreen`→`data-tree-fullscreen` (+ class `tree-fullscreen-btn`), `tree-panel`→`data-tree-panel`, `tree-panel-toggle`→`data-tree-panel-toggle`, `tree-stats-panel`→`data-tree-stats-panel`, `tree-stats-toggle`→`data-tree-stats-toggle`, `tree-stats-points`→`data-tree-stats-points`, `tree-stats-list`→`data-tree-stats-list`. The weapon-set hooks (`data-ws-set`, `data-ws-count`) are already `data-*` in the current markup — keep verbatim.

- [ ] **Step 1: Write the failing test** — `test/treePanel.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { treePanelsHtml } from '../public/js/tree-panel.js';

test('treePanelsHtml: exposes every scoped data-hook, no id collisions', () => {
  const html = treePanelsHtml();
  for (const hook of [
    'data-tree-points', 'data-tree-class', 'data-tree-asc', 'data-tree-search',
    'data-tree-reset', 'data-tree-copy', 'data-tree-fullscreen',
    'data-tree-panel', 'data-tree-panel-toggle',
    'data-tree-stats-panel', 'data-tree-stats-toggle', 'data-tree-stats-points',
    'data-tree-stats-list', 'data-ws-set', 'data-ws-count',
  ]) assert.ok(html.includes(hook), `missing ${hook}`);
  // No id="tree-*" — two embeds on one page must not collide.
  assert.ok(!/\bid="tree/.test(html), 'panel markup must not use tree-* ids');
});

test('treePanelsHtml: preserves the CSS class contract', () => {
  const html = treePanelsHtml();
  for (const cls of [
    'tree-panel', 'tree-panel-body', 'tree-panel-points', 'tree-panel-toggle',
    'tree-stats-panel', 'tree-stats-list', 'tree-ws-sets', 'tree-ws-btn', 'tree-ws-count',
    'passive-tree-select', 'passive-tree-input', 'passive-tree-btn',
    'tree-panel-field', 'tree-panel-label', 'tree-panel-actions', 'tree-fullscreen-btn',
  ]) assert.ok(html.includes(cls), `missing class ${cls}`);
});

test('treePanelsHtml: deterministic', () => {
  assert.equal(treePanelsHtml(), treePanelsHtml());
});
```

- [ ] **Step 2: Run to verify failure** — `node --test test/treePanel.test.js` → FAIL (module not found).
- [ ] **Step 3: Implement** — `public/js/tree-panel.js`. Copy the two panel `<div>`s verbatim from `views/passives.njk` lines 11–65 (stats panel first, then control panel), removing the Nunjucks comments, keeping **all** classes, and applying the id→`data-*` map above. Give the Fullscreen button `class="passive-tree-btn tree-fullscreen-btn"` and `data-tree-fullscreen`:

```js
// public/js/tree-panel.js
// Pure ES module — the passive-tree control panels (stats + controls) as one
// HTML string. Single source shared by /passives (Nunjucks host injects via
// init) and the client-rendered build editor, so the two never drift and can
// coexist on one page without id collisions (JS hooks are data-* + scoped).
export function treePanelsHtml() {
  return `
    <div class="tree-panel tree-stats-panel" data-tree-stats-panel>
      <button type="button" class="tree-panel-toggle" data-tree-stats-toggle
              aria-label="Collapse stats" title="Collapse">‹</button>
      <div class="tree-panel-body">
        <div class="tree-panel-points" data-tree-stats-points>Passive Stats</div>
        <div class="tree-stats-list" data-tree-stats-list>
          <p class="tree-stats-empty">Allocate nodes to see totals.</p>
        </div>
      </div>
    </div>
    <div class="tree-panel" data-tree-panel>
      <button type="button" class="tree-panel-toggle" data-tree-panel-toggle
              aria-label="Collapse panel" title="Collapse">›</button>
      <div class="tree-panel-body">
        <div class="tree-panel-points" data-tree-points></div>
        <div class="tree-panel-row tree-panel-ws"
             title="Allocate per-weapon-set passives — pick a set, then click nodes">
          <span class="tree-panel-label">Weapon Set</span>
          <div class="tree-ws-sets">
            <button type="button" class="tree-ws-btn" data-ws-set="1">I</button>
            <span class="tree-ws-count" data-ws-count="1">0 / 25</span>
            <button type="button" class="tree-ws-btn" data-ws-set="2">II</button>
            <span class="tree-ws-count" data-ws-count="2">0 / 25</span>
          </div>
        </div>
        <label class="tree-panel-field">
          <span class="tree-panel-label">Character Class</span>
          <select data-tree-class class="passive-tree-select"></select>
        </label>
        <label class="tree-panel-field">
          <span class="tree-panel-label">Ascendancy</span>
          <select data-tree-asc class="passive-tree-select"></select>
        </label>
        <label class="tree-panel-field">
          <span class="tree-panel-label">Search</span>
          <input type="search" data-tree-search class="passive-tree-input"
                 placeholder="Name or stat…" autocomplete="off" spellcheck="false">
        </label>
        <div class="tree-panel-actions">
          <button type="button" data-tree-reset class="passive-tree-btn">Reset Tree</button>
          <button type="button" data-tree-copy class="passive-tree-btn">Copy Share Code</button>
          <button type="button" data-tree-fullscreen class="passive-tree-btn tree-fullscreen-btn">Fullscreen</button>
        </div>
      </div>
    </div>`;
}
```

- [ ] **Step 4: Run tests** — `node --test test/treePanel.test.js` → PASS.
- [ ] **Step 5: Commit** — `git add public/js/tree-panel.js test/treePanel.test.js && git commit -m "feat(planner): extract passive-tree control panels to a pure shared module"`

---

### Task 2: Make `init()` embeddable — scoped lookups, panel injection, host-owned chrome

**Files:**
- Modify: `public/js/passive-tree.js`
- Modify: `public/css/app.css:574`

**Interfaces:**
- Consumes: `treePanelsHtml()` (Task 1).
- Produces: `init(canvas, data, opts = {})` where `opts` may carry `root`, `initialCode`, `initialFocus`, `onCopy`, `confirmReset`, `onChange`, `onCodeChange`, `onReady`. All `document.getElementById('tree-*')` control lookups become `root.querySelector('[data-tree-*]')`. `location.hash`/`location.search`/`navigator.clipboard`/`window.confirm` no longer appear in `init` (except the Tippy `appendTo` fullscreen check, which is legitimate component behavior). `load(canvas, opts)` forwards `opts` to `init`.

**Design notes (do exactly this):**
- `root` resolution (top of `init`, right after `const ctx = canvas.getContext('2d')`):
  ```js
  const root = opts.root || canvas.closest('.passive-tree-wrap') || canvas.parentElement || document;
  if (root.querySelector && !root.querySelector('[data-tree-panel]') && root.insertAdjacentHTML) {
    root.insertAdjacentHTML('beforeend', treePanelsHtml());
  }
  const q = (sel) => (root.querySelector ? root.querySelector(sel) : null);
  ```
  Add `import { treePanelsHtml } from './tree-panel.js';` at the top of the module.
- Replace each control lookup (current line → new):
  - L450 `document.getElementById('tree-points')` → `q('[data-tree-points]')`
  - L451 `document.querySelectorAll('#tree-ws-sets .tree-ws-btn')` → `root.querySelectorAll('[data-ws-set]')`
  - L453–454 wsCountEls → `q('[data-ws-count="1"]')`, `q('[data-ws-count="2"]')`
  - L460 `tree-stats-points` → `q('[data-tree-stats-points]')`; L461 `tree-stats-list` → `q('[data-tree-stats-list]')`
  - L1826 `tree-class` → `q('[data-tree-class]')`; L1827 `tree-ascendancy` → `q('[data-tree-asc]')`
  - L1901 `tree-copy-code` → `q('[data-tree-copy]')`
  - L1923 `tree-search` → `q('[data-tree-search]')`
  - L1946 `tree-reset` → `q('[data-tree-reset]')`
  - L1971 `tree-fullscreen` → `q('[data-tree-fullscreen]')`
  - L1972 `canvas.closest('.passive-tree-wrap')` → `root` (already the wrap)
  - L1988 `tree-panel` → `q('[data-tree-panel]')`; L1989 `tree-panel-toggle` → `q('[data-tree-panel-toggle]')`
  - L2010 `tree-stats-panel` → `q('[data-tree-stats-panel]')`; L2011 `tree-stats-toggle` → `q('[data-tree-stats-toggle]')`
- **Host-owned copy** — replace the copy handler body (L1902–1917) so `location.hash`/clipboard live in `opts.onCopy` (default: clipboard-writes the code only — safe on a hash-routed page):
  ```js
  const copyBtn = q('[data-tree-copy]');
  if (copyBtn) {
    copyBtn.addEventListener('click', async () => {
      try {
        const cm = await codeMod();
        const code = buildShareCode(cm);
        if (!code) { copyBtn.textContent = 'Error'; return; }
        const doCopy = opts.onCopy || ((c) => navigator.clipboard.writeText(c));
        await doCopy(code);
        const prev = copyBtn.textContent;
        copyBtn.textContent = 'Copied!';
        setTimeout(() => { copyBtn.textContent = prev; }, 1500);
      } catch (err) { console.error('Copy share code failed:', err); copyBtn.textContent = 'Error'; }
    });
  }
  ```
- **Host-owned reset confirm** — L1949 becomes:
  ```js
  const confirmReset = opts.confirmReset || (() => window.confirm('Reset the tree? This clears all allocated passives.'));
  if (allocated.size && !confirmReset()) return;
  ```
- **Boot import from opts, not `location.hash`** — rename `importFromHash()` to `importCode(codeStr)` taking an argument; the body keeps everything from `const cm = await codeMod()` onward, but replaces L2073–2075:
  ```js
  async function importCode(codeStr) {
    if (!codeStr) return;
    const cm = await codeMod();
    const am = await allocMod();
    let decoded;
    try { decoded = cm.decode(codeStr); } catch (err) { console.warn('[passive-tree] Failed to decode share code:', err); return; }
    // …unchanged from the existing version check onward…
  }
  ```
- **Boot focus from opts, not `location.search`** — L1422–1426 `deepLinkHash` becomes `const deepLinkHash = (typeof opts.initialFocus === 'number' && Number.isFinite(opts.initialFocus)) ? opts.initialFocus : null;` (drop the `URLSearchParams(location.search)` read).
- **Change notification + debounced code emit** — declare near the top of `init` (after `let decodedState = null;`):
  ```js
  let ready = false;                 // suppress change/emit during boot import
  let lastEmitted = opts.initialCode || null;
  let codeTimer = null;
  function scheduleCodeChange() {
    if (!opts.onCodeChange) return;
    clearTimeout(codeTimer);
    codeTimer = setTimeout(async () => {
      try {
        const cm = await codeMod();
        const code = buildShareCode(cm);
        if (code && code !== lastEmitted) { lastEmitted = code; opts.onCodeChange(code); }
      } catch (err) { console.warn('[passive-tree] code emit failed:', err); }
    }, 400);
  }
  ```
  At the **end of `updatePoints()`** (the single mutation chokepoint — every alloc/dealloc/ws/class/asc/attr/reset path calls it), add:
  ```js
    if (ready) { scheduleCodeChange(); if (opts.onChange) opts.onChange(); }
  ```
- **Boot sequence** — replace the `Promise.all([allocMod(), codeMod(), pathMod()]).then(...)` block (L2226–2234) with:
  ```js
  Promise.all([allocMod(), codeMod(), pathMod()]).then(async () => {
    updatePoints();                                   // show "0 / 122 · 0 / 8"
    try { await importCode(opts.initialCode || null); }
    catch (err) { console.warn('[passive-tree] importCode error:', err); }
    ready = true;                                      // now user actions emit
    if (opts.onReady) opts.onReady(api);
    requestDraw();
  });
  ```
- **CSS** — `public/css/app.css:574` `#tree-fullscreen { display: none; }` → `.tree-fullscreen-btn { display: none; }`.

- [ ] **Step 1: Apply the edits above** to `public/js/passive-tree.js` and `public/css/app.css`. (No new node test — behavior is DOM-level; Task 4's headless verification proves `/passives` is unchanged. The pure `worldToScreen`/`screenToWorld` tests in `test/passiveTreeView.test.js` must keep passing since those exports are untouched.)
- [ ] **Step 2: Run the pure suite** — `npm test` → PASS (proves nothing regressed at the module-import level; `test/passiveTreeView.test.js` still imports and exercises the named exports).
- [ ] **Step 3: Smoke `/passives` in dev** — `npm run dev`, load `http://localhost:3000/passives`, confirm: panels appear (injected), class/ascendancy selectors populate, allocating updates the point counter + stats panel, Search dims non-matches, Reset prompts + clears, Copy Share Code writes the clipboard, Fullscreen toggles. (Full automated proof in Task 4.)
- [ ] **Step 4: Commit** — `git commit -am "feat(planner): embeddable passive tree — scoped lookups, injected panels, host-owned chrome"`

---

### Task 3: Extend the embeddable API (state, highlight, notables, points, icon, destroy)

**Files:**
- Modify: `public/js/passive-tree.js` (the `const api = { … }` block, L2205–2220, and add helpers)

**Interfaces:**
- Produces (on the object returned by `init`):
  - `async setCode(code)` — import a v7 share code into the live tree (calls `importCode`, then `updatePoints`); sets `lastEmitted = code`. `setState(code)` is an alias.
  - `async getCode()` → `string|null` — the current share code (`buildShareCode`). `getState()` returns `{ code }` (async).
  - `setHighlight(hashes)` — `hashes` an iterable of node hashes (or null/empty to clear); sets the transient `hoverHits` layer and redraws.
  - `focusNode(hash)` — center + pulse (existing function; just expose it).
  - `getAllocatedNotables()` → `Array<{ h:number, kind:string, name:string, icon:string }>` — every allocated node (main ∪ ws1 ∪ ws2) whose `k ∈ {keystone, notable, ascNotable, blighted}`, sorted ascending by hash.
  - `getPoints()` → `{ main:{spent,max}, asc:{spent,max}, ws1:{spent,max}, ws2:{spent,max} }` using `_allocMod.pointsSpent` + `budgets()` + `wsAlloc` sizes.
  - `paintNodeIcon(hash, canvasEl)` — draw the node's icon (from the already-loaded `skills` atlas) into a square canvas; if the atlas isn't ready yet, queue and paint on load.
  - `destroy()` — `ro.disconnect()`, remove the `document` `fullscreenchange` listener, clear timers (`codeTimer`, `hideTimer`), hide/destroy the Tippy instance.

**Design notes:**
- `getAllocatedNotables` (add near the other helpers):
  ```js
  const NOTABLE_KINDS = new Set(['keystone', 'notable', 'ascNotable', 'blighted']);
  function getAllocatedNotables() {
    const out = [];
    const seen = new Set();
    for (const set of [allocated, wsAlloc[1], wsAlloc[2]]) {
      for (const h of set) {
        if (seen.has(h)) continue; seen.add(h);
        const n = nodeMap.get(h);
        if (n && NOTABLE_KINDS.has(n.k)) out.push({ h, kind: n.k, name: n.name || String(h), icon: n.icon || '' });
      }
    }
    return out.sort((a, b) => a.h - b.h);
  }
  ```
- `setHighlight`:
  ```js
  function setHighlight(hashes) {
    hoverHits = (hashes && hashes[Symbol.iterator]) ? new Set(hashes) : null;
    if (hoverHits && hoverHits.size === 0) hoverHits = null;
    requestDraw();
  }
  ```
- `getPoints`:
  ```js
  function getPoints() {
    const b = budgets();
    const p = _allocMod ? _allocMod.pointsSpent(allocated, nodeKindOf) : { main: 0, ascendancy: 0 };
    return {
      main: { spent: p.main, max: b.main === Infinity ? null : b.main },
      asc:  { spent: p.ascendancy, max: b.ascendancy === Infinity ? null : b.ascendancy },
      ws1:  { spent: wsAlloc[1].size, max: b.ws === Infinity ? null : b.ws },
      ws2:  { spent: wsAlloc[2].size, max: b.ws === Infinity ? null : b.ws },
    };
  }
  ```
- `paintNodeIcon` + pending queue (add near `atlas()`):
  ```js
  const pendingIcons = [];
  function blitIcon(canvasEl, node) {
    const at = atlas('skills');
    if (!at) return false;
    const key = `${node.iconKind}Active:${node.icon}`;
    const f = at.frames[key]; if (!f) return false;
    const fr = f.frame;
    const c = canvasEl.getContext('2d');
    c.clearRect(0, 0, canvasEl.width, canvasEl.height);
    c.drawImage(at.img, fr.x, fr.y, fr.w, fr.h, 0, 0, canvasEl.width, canvasEl.height);
    return true;
  }
  function paintNodeIcon(hash, canvasEl) {
    const n = nodeMap.get(hash); if (!n || !canvasEl) return;
    if (!blitIcon(canvasEl, n)) pendingIcons.push({ hash, canvasEl });
  }
  function flushPendingIcons() {
    if (!pendingIcons.length) return;
    const q2 = pendingIcons.splice(0);
    for (const { hash, canvasEl } of q2) { const n = nodeMap.get(hash); if (n && canvasEl.isConnected) blitIcon(canvasEl, n); }
  }
  ```
  In `atlas()`, immediately after `atlasCache.set(name, { img, frames, ... }); requestDraw();`, add `if (name === 'skills') flushPendingIcons();`.
- `destroy` + expose everything — replace the `const api = { … }` block:
  ```js
  function destroy() {
    ro.disconnect();
    document.removeEventListener('fullscreenchange', syncFsLabel);
    clearTimeout(codeTimer); clearTimeout(hideTimer); clearTimeout(hoverTimer);
    if (tip) { try { tip.destroy(); } catch {} tip = null; }
  }
  const api = {
    setAllocated(set) { allocated = set instanceof Set ? set : new Set(set); requestDraw(); },
    setStarts(arr) { starts = arr; },
    redraw: requestDraw,
    async setCode(code) { await importCode(code || null); lastEmitted = code || null; updatePoints(); },
    async getCode() { const cm = await codeMod(); return buildShareCode(cm); },
    async setState(code) { return api.setCode(code); },
    async getState() { return { code: await api.getCode() }; },
    setHighlight, focusNode, getAllocatedNotables, getPoints, paintNodeIcon, destroy,
    view, nodeMap, data,
  };
  ```
  (`syncFsLabel` is declared at L1973; `destroy` referencing it is fine — both are in the same closure.)

- [ ] **Step 1: Apply the edits.** No isolated node test (DOM-bound); the API is exercised by Task 4's headless verification and Tasks 6–7.
- [ ] **Step 2: Run** — `npm test` → PASS (import-level: nothing else references these; pure exports untouched).
- [ ] **Step 3: Commit** — `git commit -am "feat(planner): extend embeddable tree API — state, highlight, notables, points, icon, destroy"`

---

### Task 4: `/passives` thin host + regression verification (finishes 5a)

**Files:**
- Modify: `views/passives.njk`
- Create: `scripts/verify-tree-embed.mjs`

**Interfaces:**
- Consumes: `load(canvas, opts)` (Task 2).
- Produces: `/passives` with zero user-visible change; a puppeteer script that proves it.

- [ ] **Step 1: Rewrite `views/passives.njk`.** The wrap holds only the canvas (panels are injected by `init`); the inline script becomes the thin host:

```njk
{% extends "base.njk" %}
{% block title %}Passive Tree — Reveal · PoE2 Wiki{% endblock %}
{% block content %}
<div class="page page--passives">
  <div class="passive-tree-wrap" id="tree-wrap">
    <canvas id="tree"></canvas>
  </div>
</div>
<script type="module">
  import { load } from '/static/js/passive-tree.js';
  const canvas = document.getElementById('tree');
  if (canvas) {
    const params = new URLSearchParams(location.search);
    const focus = params.get('node');
    load(canvas, {
      initialCode: location.hash ? location.hash.slice(1) : null,
      initialFocus: focus != null && focus !== '' ? Number(focus) : null,
      // /passives keeps its historic behavior: the share code lives in the URL
      // hash and Copy yields a shareable link. (No onCodeChange — the hash only
      // changes on Copy, not on every allocation.)
      onCopy: async (code) => { location.hash = code; await navigator.clipboard.writeText(location.href); },
    }).catch(console.error);
  }
</script>
{% endblock %}
```

- [ ] **Step 2: Write the verification script** — `scripts/verify-tree-embed.mjs` (run manually against dev; mirrors `scripts/smoke-index.js`'s puppeteer-core setup):

```js
#!/usr/bin/env node
// Manual DOM-glue verification for the embeddable passive tree.
//   npm run dev   # in another terminal (localhost:3000)
//   node scripts/verify-tree-embed.mjs
import puppeteer from 'puppeteer-core';
const BASE = (process.argv[2] || 'http://localhost:3000').replace(/\/$/, '');
const CHROME = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const fails = [];
const ok = (name, cond, detail) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); if (!cond) fails.push(name); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-first-run'] });
try {
  // 1) /passives regression: panels injected, allocation updates the counter.
  const p = await browser.newPage();
  await p.goto(`${BASE}/passives`, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(1500);
  const panels = await p.evaluate(() => ({
    ctrl: !!document.querySelector('[data-tree-panel]'),
    stats: !!document.querySelector('[data-tree-stats-panel]'),
    classOpts: document.querySelector('[data-tree-class]')?.options.length || 0,
    points: document.querySelector('[data-tree-points]')?.textContent || '',
  }));
  ok('/passives injects both panels', panels.ctrl && panels.stats, JSON.stringify(panels));
  ok('/passives populates class selector', panels.classOpts > 0);

  // 2) Two independent embeds on one page do not collide (id-scoping proof).
  const two = await browser.newPage();
  await two.goto(`${BASE}/passives`, { waitUntil: 'networkidle2', timeout: 60000 });
  const twoState = await two.evaluate(async () => {
    const mk = () => { const w = document.createElement('div'); w.className = 'passive-tree-wrap'; const c = document.createElement('canvas'); w.appendChild(c); document.body.appendChild(w); return { w, c }; };
    const m = await import('/static/js/passive-tree.js');
    const a = mk(), b = mk();
    const A = await m.load(a.c, {}), B = await m.load(b.c, {});
    await new Promise((r) => setTimeout(r, 800));
    return { aPanel: a.w.querySelectorAll('[data-tree-panel]').length, bPanel: b.w.querySelectorAll('[data-tree-panel]').length, hasA: !!A, hasB: !!B };
  });
  ok('two embeds each get exactly one panel', twoState.aPanel === 1 && twoState.bPanel === 1, JSON.stringify(twoState));

  // 3) Editor: mount, allocate, persist across reload.
  const e = await browser.newPage();
  await e.goto(`${BASE}/builds`, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(1500);
  const mounted = await e.evaluate(() => !!document.querySelector('[data-tree-mount] canvas'));
  ok('editor mounts the embed', mounted);
  // Allocate via the API on the editor's embed, then confirm the store saved a code.
  const persisted = await e.evaluate(async () => {
    const canvas = document.querySelector('[data-tree-mount] canvas');
    if (!canvas) return false;
    // Click near the class start a couple times to allocate adjacent nodes.
    const rect = canvas.getBoundingClientRect();
    for (const dx of [30, -30, 60]) {
      canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: rect.left + rect.width / 2 + dx, clientY: rect.top + rect.height / 2, bubbles: true, pointerId: 1 }));
      canvas.dispatchEvent(new PointerEvent('pointerup', { clientX: rect.left + rect.width / 2 + dx, clientY: rect.top + rect.height / 2, bubbles: true, pointerId: 1 }));
      await new Promise((r) => setTimeout(r, 120));
    }
    await new Promise((r) => setTimeout(r, 700)); // debounce
    const raw = JSON.parse(localStorage.getItem('reveal.builds.v1') || '{}');
    const b = Object.values(raw.builds || {})[0];
    return !!(b && b.tree && b.tree.code);
  });
  ok('editor auto-saves a tree code after allocation', persisted);

  // 4) Notable Priority list present when notables are allocated (best-effort).
  const prio = await e.evaluate(() => document.querySelectorAll('[data-prio-row]').length);
  console.log(`info  priority rows: ${prio}`);
} finally {
  await browser.close();
}
process.exit(fails.length ? 1 : 0);
```

- [ ] **Step 3: Run the pure suite** — `npm test` → PASS (`test/server.test.js` `GET /passives renders the tree shell` still matches `<canvas` + `passive-tree.js`).
- [ ] **Step 4: Run the headless verification** — with `npm run dev` up, `node scripts/verify-tree-embed.mjs`. Expected: checks 1–2 pass now (3–4 pass after Tasks 6–7; re-run then). Record output.
- [ ] **Step 5: Commit** — `git commit -am "feat(planner): /passives becomes a thin host over the embeddable tree; add embed verification script"`

---

### Task 5: Pure Notable Priority core (`tree-priority.js`)

**Files:**
- Create: `public/js/tree-priority.js`
- Test: `test/treePriority.test.js`

**Interfaces:**
- Produces:
  - `reconcilePriority(prevOrder: number[], allocatedHashes: number[]): number[]` — returns `prevOrder` filtered to hashes still in `allocatedHashes` (order preserved), then newly-allocated hashes (those not in `prevOrder`) appended in `allocatedHashes` order. Deduped.
  - `renderPriorityList(order: number[], metaByHash: Map<number,{kind,name,icon}>, opts?: {readonly?:boolean}): string` — HTML string. Each row: `data-prio-row="<h>"`, `draggable="true"` (omit when readonly), a drag handle (`.prio-handle`, hidden when readonly), an icon canvas `<canvas class="prio-icon" data-prio-icon="<h>" width="28" height="28">`, kind-classed name (`.prio-name.is-<kind>`), and a remove button `data-prio-remove="<h>"` (omit when readonly). Escapes names via the shared `esc`. Empty `order` → an empty-state `<p class="editor-none">`.

- [ ] **Step 1: Write the failing tests** — `test/treePriority.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconcilePriority, renderPriorityList } from '../public/js/tree-priority.js';

test('reconcilePriority: keeps prior order, appends new, drops deallocated', () => {
  assert.deepEqual(reconcilePriority([3, 1, 2], [1, 2, 3]), [3, 1, 2]);      // all kept, order held
  assert.deepEqual(reconcilePriority([3, 1], [1, 3, 5, 4]), [3, 1, 5, 4]);   // 5,4 appended in allocated order
  assert.deepEqual(reconcilePriority([3, 1, 2], [1, 3]), [3, 1]);            // 2 dropped
  assert.deepEqual(reconcilePriority([], [7, 9]), [7, 9]);                   // empty prev
  assert.deepEqual(reconcilePriority([9, 9, 7], [7, 9]), [9, 7]);            // dedupe
});

test('renderPriorityList: rows carry hooks, icon canvas, escaped names', () => {
  const meta = new Map([[52, { kind: 'keystone', name: "Zealot's <b>Oath</b>", icon: 'x.png' }]]);
  const html = renderPriorityList([52], meta, {});
  assert.match(html, /data-prio-row="52"/);
  assert.match(html, /draggable="true"/);
  assert.match(html, /data-prio-icon="52"/);
  assert.match(html, /data-prio-remove="52"/);
  assert.match(html, /prio-name is-keystone/);
  assert.ok(html.includes('Zealot&#39;s &lt;b&gt;Oath&lt;/b&gt;'), 'name escaped');
});

test('renderPriorityList: readonly hides controls; empty shows a message', () => {
  const meta = new Map([[52, { kind: 'notable', name: 'X', icon: '' }]]);
  const ro = renderPriorityList([52], meta, { readonly: true });
  assert.ok(!ro.includes('data-prio-remove'), 'no remove in readonly');
  assert.ok(!/draggable="true"/.test(ro), 'not draggable in readonly');
  assert.match(renderPriorityList([], new Map(), {}), /editor-none/);
});

test('renderPriorityList: unknown hash falls back gracefully', () => {
  const html = renderPriorityList([999], new Map(), {});
  assert.match(html, /data-prio-row="999"/); // still renders a row (name = hash)
});
```

- [ ] **Step 2: Run to verify failure** — `node --test test/treePriority.test.js` → FAIL.
- [ ] **Step 3: Implement** — `public/js/tree-priority.js`:

```js
// public/js/tree-priority.js
// Pure ES module — Notable Priority core for the build editor. The priority
// list is *advisory ordering*, not allocation state: reordering never mutates
// the tree. Node-testable; DOM glue (DnD/hover/click/icon paint) lives in
// build-editor.js.
import { esc } from './builds-render.js';

/** Filter prevOrder to still-allocated hashes (order kept), append newly
 *  allocated (in allocated order), dedupe. */
export function reconcilePriority(prevOrder, allocatedHashes) {
  const allocated = new Set(allocatedHashes);
  const seen = new Set();
  const out = [];
  for (const h of prevOrder) if (allocated.has(h) && !seen.has(h)) { seen.add(h); out.push(h); }
  for (const h of allocatedHashes) if (!seen.has(h)) { seen.add(h); out.push(h); }
  return out;
}

const KIND_LABEL = { keystone: 'Keystone', notable: 'Notable', ascNotable: 'Ascendancy', blighted: 'Notable' };

export function renderPriorityList(order, metaByHash, opts = {}) {
  const ro = !!opts.readonly;
  if (!order.length) {
    return '<p class="editor-none">No notables allocated yet — allocate keystones and notables in the tree above.</p>';
  }
  const rows = order.map((h) => {
    const m = metaByHash.get(h) || {};
    const kind = m.kind || 'notable';
    const name = m.name || String(h);
    const handle = ro ? '' : '<span class="prio-handle" aria-hidden="true">⠿</span>';
    const remove = ro ? '' : `<button type="button" class="prio-remove" data-prio-remove="${h}" aria-label="Remove ${esc(name)} from priority">×</button>`;
    return `<li class="prio-row" data-prio-row="${h}"${ro ? '' : ' draggable="true"'}>` +
      `${handle}` +
      `<canvas class="prio-icon" data-prio-icon="${h}" width="28" height="28" aria-hidden="true"></canvas>` +
      `<span class="prio-body"><span class="prio-name is-${esc(kind)}">${esc(name)}</span>` +
      `<span class="prio-kind">${esc(KIND_LABEL[kind] || 'Notable')}</span></span>` +
      `${remove}</li>`;
  }).join('');
  return `<ol class="prio-list"${ro ? '' : ' data-prio-dnd'}>${rows}</ol>`;
}
```

- [ ] **Step 4: Run** — `node --test test/treePriority.test.js` → PASS.
- [ ] **Step 5: Commit** — `git add public/js/tree-priority.js test/treePriority.test.js && git commit -m "feat(planner): pure Notable Priority core — reconcile + list renderer"`

---

### Task 6: Editor tree chapter — embed mount + points summary + priority container

**Files:**
- Modify: `public/js/editor-render.js`
- Test: `test/editorRender.test.js`

**Interfaces:**
- Consumes: nothing new (the embed + priority list are populated imperatively by Task 7).
- Produces: `renderEditor` tree chapter emitting `<div data-tree-mount>` (stable embed mount), `<div data-tree-points-summary>` (points chips, filled by Task 7), `<div data-notable-priority>` (priority list, filled by Task 7), and the "Open the passive tree →" link. The `data-tree-code` **input is removed** (edit mode); read-only/import modes keep a static summary (no embed). `treeSummary` stays (used for the read-only stat line).

**Design notes:**
- `renderEditor`'s `treeBody` (L397–405) is rebuilt. **Edit mode** = embed shell; **read-only/import** = static summary + open link (an embed is not mounted for read-only previews — keep them light and non-interactive):
  ```js
  const treeBody = ro
    ? `<p class="editor-tree-stat">${esc(stat)}${prio ? ` · ${prio} notables prioritized` : ''}</p>
       <a class="editor-tree-open" href="/passives${build.tree.code ? '#' + esc(build.tree.code) : ''}">Open the passive tree →</a>`
    : `<div class="editor-tree-points" data-tree-points-summary></div>
       <div class="editor-tree-embed"><div class="passive-tree-wrap passive-tree-wrap--embed" data-tree-mount></div></div>
       <a class="editor-tree-open" href="/passives${build.tree.code ? '#' + esc(build.tree.code) : ''}">Open full page →</a>
       <div class="editor-notable-priority" data-notable-priority>
         <h3 class="editor-subhead">Notable Priority</h3>
         <p class="editor-none">Loading tree…</p>
       </div>`;
  ```
  (The read-only preview intentionally does **not** embed the interactive canvas; import/view modes show the summary + a deep link. Note this deviation from a strict "embed everywhere" reading of the spec — it keeps shared previews cheap and avoids mounting a 1.2 MB canvas app for a glance.)

- [ ] **Step 1: Update tests** — in `test/editorRender.test.js`, the `renderEditor: dossier shell …` test currently asserts `data-tree-code`. Replace that assertion set for the tree chapter:

```js
test('renderEditor: tree chapter mounts the embed, drops the code paste', () => {
  const b = fixed({ tree: { code: null, notablePriority: [] } });
  const html = renderEditor(b, sctx);
  assert.match(html, /data-tree-mount/);
  assert.match(html, /data-tree-points-summary/);
  assert.match(html, /data-notable-priority/);
  assert.match(html, /Notable Priority/);
  assert.ok(!html.includes('data-tree-code'), 'code paste input removed in edit mode');
  assert.match(html, /href="\/passives/);
});

test('renderEditor: read-only tree chapter is a static summary (no embed mount)', () => {
  const b = fixed({ tree: { code: null, notablePriority: [] } });
  const html = renderEditor(b, { ...sctx, mode: 'view' });
  assert.ok(!html.includes('data-tree-mount'), 'no interactive embed in read-only');
  assert.match(html, /Open the passive tree/);
});
```

  Also update the existing `renderEditor: dossier shell — rail, header hooks, four chapters, escapes` test: **remove** its `assert.match(html, /data-tree-code/)` line (keep the `id="gear"`…`id="notes"`, `data-rail-link`, `data-share`, `data-description`, `data-notes`, `href="/passives"`, and escape assertions).

- [ ] **Step 2: Run to verify failure** — `node --test test/editorRender.test.js` → FAIL.
- [ ] **Step 3: Implement** the `treeBody` change in `editor-render.js` (above). Leave `treeSummary` and every other renderer untouched.
- [ ] **Step 4: Run** — `node --test test/editorRender.test.js && npm test` → PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(planner): editor tree chapter — embed mount, points summary, notable-priority container"`

---

### Task 7: Wire the embed + Notable Priority into `build-editor.js`

**Files:**
- Modify: `public/js/build-editor.js`

**Interfaces:**
- Consumes: `load` from `passive-tree.js`, `reconcilePriority`/`renderPriorityList` from `tree-priority.js`, the embed API (Task 3), the render hooks (Task 6).
- Produces: a live embed that survives dossier re-renders (DOM reparenting), auto-saves the tree code (debounced by the component), renders + persists the Notable Priority order, and supports hover-highlight, click-focus, drag-reorder, and remove.

**Design notes (add to `mountEditor`):**
- Imports at top: `import { load as loadTree } from '/static/js/passive-tree.js';` and `import { reconcilePriority, renderPriorityList } from '/static/js/tree-priority.js';`
- Closure state (near the other `let`s):
  ```js
  let treeEmbed = null;      // the embed API (Task 3)
  let treeWrapEl = null;     // the live .passive-tree-wrap DOM (reparented across renders)
  let treeArtifact = null;   // cached fetch of passive-tree.json (share one across remounts)
  let notableMeta = new Map(); // h -> {kind,name,icon}, from the embed
  let suppressRender = false;  // true while we persist a tree-only change (skip our own re-render)
  ```
- **Reparent-or-init** — call `mountTree()` at the end of `render()` (after `container.innerHTML = …`). Because `innerHTML` assignment destroys the previous mount, detach the live wrap **before** the assignment:
  ```js
  const render = () => {
    const b = build();
    if (!b) { location.hash = ''; return; }
    if (treeWrapEl && treeWrapEl.parentNode) treeWrapEl.remove(); // keep alive across the innerHTML reset
    container.innerHTML = renderEditor(b, { planner, resolveRef, pools, weaponSet, mode,
      builds: store.list(), currentId: buildId, switcherOpen, classPicker, renaming });
    if (mode === 'edit') mountTree(b);
  };

  function mountTree(b) {
    const mount = container.querySelector('[data-tree-mount]');
    if (!mount) return;
    if (treeWrapEl) { mount.appendChild(treeWrapEl); refreshTreeUI(); return; } // reattach live embed
    // First mount: build wrap + canvas, fetch artifact once, init the embed.
    treeWrapEl = document.createElement('div');
    treeWrapEl.className = 'passive-tree-wrap passive-tree-wrap--embed';
    const canvas = document.createElement('canvas');
    treeWrapEl.appendChild(canvas);
    mount.appendChild(treeWrapEl);
    loadTree(canvas, {
      root: treeWrapEl,
      initialCode: b.tree.code || null,
      onCopy: (code) => navigator.clipboard.writeText(code), // editor copies the code, never touches location.hash
      onReady: () => { captureNotables(); refreshTreeUI(); },
      onChange: () => { captureNotables(); refreshTreeUI(); },
      onCodeChange: (code) => persistTree(code),
    }).then((api) => { treeEmbed = api; }).catch((err) => console.warn('[builds] tree embed failed:', err));
  }
  ```
- **Capture + reconcile + persist:**
  ```js
  function captureNotables() {
    if (!treeEmbed) return;
    const list = treeEmbed.getAllocatedNotables();
    notableMeta = new Map(list.map((n) => [n.h, { kind: n.kind, name: n.name, icon: n.icon }]));
  }
  function currentOrder(b) {
    return reconcilePriority(b.tree.notablePriority || [], [...notableMeta.keys()]);
  }
  function persistTree(code) {
    const b = build(); if (!b) return;
    captureNotables();
    const notablePriority = currentOrder(b);
    suppressRender = true;                 // our own subscriber skips the full re-render
    patch({ tree: { code: code || null, notablePriority } });
    suppressRender = false;
  }
  ```
- **Points chips + priority list (imperative, no store write):**
  ```js
  const pts = (label, o) => `<span class="tree-chip"><b>${o.spent}</b>${o.max != null ? ` / ${o.max}` : ''} <span>${label}</span></span>`;
  function refreshTreeUI() {
    const b = build(); if (!b) return;
    const summary = container.querySelector('[data-tree-points-summary]');
    if (summary && treeEmbed) {
      const p = treeEmbed.getPoints();
      summary.innerHTML = pts('Passives', p.main) + (p.asc.spent ? pts('Ascendancy', p.asc) : '')
        + (p.ws1.spent ? pts('Set I', p.ws1) : '') + (p.ws2.spent ? pts('Set II', p.ws2) : '');
    }
    const box = container.querySelector('[data-notable-priority]');
    if (box) {
      const order = currentOrder(b);
      box.innerHTML = '<h3 class="editor-subhead">Notable Priority</h3>'
        + renderPriorityList(order, notableMeta, { readonly: false });
      for (const c of box.querySelectorAll('[data-prio-icon]')) {
        const h = Number(c.getAttribute('data-prio-icon'));
        treeEmbed?.paintNodeIcon(h, c);
      }
    }
  }
  ```
- **Own subscriber honors `suppressRender`** — change the existing `const unsub = store.subscribe(() => render());` (L329) to:
  ```js
  const unsub = store.subscribe(() => { if (suppressRender) return; render(); });
  ```
- **Delegated events for priority** — add to `onClick` (before the final socket branches):
  ```js
    const prioRemove = attr('data-prio-remove');
    if (prioRemove !== null && prioRemove !== undefined) {
      const h = Number(prioRemove);
      const b = build();
      // Removing from the priority list is advisory-only: drop the hash from the
      // order but never deallocate the node. It re-appends if still allocated on
      // the next tree change — so removal reads as "deprioritize", matching the
      // spec's advisory-ordering rule. To fully drop it, deallocate in the tree.
      const order = currentOrder(b).filter((x) => x !== h);
      suppressRender = true; patch({ tree: { ...b.tree, notablePriority: order } }); suppressRender = false;
      refreshTreeUI();
      return;
    }
  ```
  Wait — per the spec, "nodes deallocated drop out; newly allocated append." Remove-from-priority that re-appends is confusing. **Correct behavior:** the remove button deallocates the node in the tree (which then reconciles out of the list). Replace the branch body with:
  ```js
      const h = Number(prioRemove);
      treeEmbed?.setHighlight(null);
      // Deallocate the node in the embed; onChange reconciles it out of the list.
      // (Use the public API — allocation state is the embed's, not the store's.)
      treeEmbed?.deallocate?.(h);
      return;
  ```
  This requires exposing `deallocate(h)` on the embed API. **Add to Task 3's api:** `deallocate(h) { if (_deallocMod ready) _deallocateSync(h); }` — actually expose a guarded wrapper:
  ```js
  // in passive-tree.js api:
  deallocate(h) { if (_allocMod && (allocated.has(h) || wsAlloc[1].has(h) || wsAlloc[2].has(h))) { const m = modeFor ? null : null; _deallocateSync(h); } },
  ```
  Keep it simple and safe — main-tree only for v1 (weapon-set deallocation has its own cascade): `deallocate(h) { if (_allocMod && allocated.has(h)) _deallocateSync(h); }`. Document that weapon-set notables are removed by clicking them in the tree.
- **Hover-highlight + click-focus** — add `mouseover`/`mouseout` + click handling. Register dedicated listeners in `mountEditor` (delegated on `container`), guarded to `mode === 'edit'`:
  ```js
  function onPointerOver(e) {
    const row = e.target.closest?.('[data-prio-row]');
    if (row && treeEmbed) treeEmbed.setHighlight([Number(row.getAttribute('data-prio-row'))]);
  }
  function onPointerOut(e) {
    const row = e.target.closest?.('[data-prio-row]');
    if (row && !row.contains(e.relatedTarget) && treeEmbed) treeEmbed.setHighlight(null);
  }
  ```
  In `onClick`, add (before socket branches): a click on `[data-prio-row]` (not the remove button) → `treeEmbed?.focusNode(Number(row...))`.
  ```js
    const prioRow = e.target.closest('[data-prio-row]');
    if (prioRow && !e.target.closest('[data-prio-remove]') && !e.target.closest('.prio-handle')) {
      treeEmbed?.focusNode(Number(prioRow.getAttribute('data-prio-row')));
      // scroll the embed into view so the focused node is visible
      treeWrapEl?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
  ```
- **Drag-and-drop reorder** (HTML5 DnD, no library) — delegated `dragstart`/`dragover`/`drop` on `container`, scoped to `[data-prio-dnd]`:
  ```js
  let dragH = null;
  function onDragStart(e) { const r = e.target.closest?.('[data-prio-row]'); if (!r) return; dragH = Number(r.getAttribute('data-prio-row')); e.dataTransfer.effectAllowed = 'move'; }
  function onDragOver(e) { if (dragH != null && e.target.closest?.('[data-prio-dnd]')) e.preventDefault(); }
  function onDrop(e) {
    const target = e.target.closest?.('[data-prio-row]'); if (dragH == null || !target) return;
    e.preventDefault();
    const b = build();
    const order = currentOrder(b);
    const from = order.indexOf(dragH), to = order.indexOf(Number(target.getAttribute('data-prio-row')));
    if (from < 0 || to < 0 || from === to) { dragH = null; return; }
    order.splice(to, 0, order.splice(from, 1)[0]);
    dragH = null;
    suppressRender = true; patch({ tree: { ...b.tree, notablePriority: order } }); suppressRender = false;
    refreshTreeUI();
  }
  ```
- **Register/unregister** the new listeners in `mountEditor` and `unmount`:
  ```js
  container.addEventListener('pointerover', onPointerOver);
  container.addEventListener('pointerout', onPointerOut);
  container.addEventListener('dragstart', onDragStart);
  container.addEventListener('dragover', onDragOver);
  container.addEventListener('drop', onDrop);
  ```
  In the returned `unmount`, remove them, then tear down the embed:
  ```js
    container.removeEventListener('pointerover', onPointerOver);
    container.removeEventListener('pointerout', onPointerOut);
    container.removeEventListener('dragstart', onDragStart);
    container.removeEventListener('dragover', onDragOver);
    container.removeEventListener('drop', onDrop);
    treeEmbed?.destroy?.(); treeEmbed = null; treeWrapEl = null;
  ```
- **Remove the dead `data-tree-code` `onChange` branch** (L292–302) and its `decodePassiveCode` usage if now unused (keep the import only if still referenced elsewhere — it is not, so drop `import { decode as decodePassiveCode } …`). The `data-description`/`data-notes` branches stay.

- [ ] **Step 1: Add `deallocate` to the embed API** in `passive-tree.js` (Task 3's `api`): `deallocate(h) { if (_allocMod && allocated.has(h)) _deallocateSync(h); },`.
- [ ] **Step 2: Apply all `build-editor.js` edits** above.
- [ ] **Step 3: Run the pure suite** — `npm test` → PASS (no node tests cover this DOM glue; renderer + core tests already green).
- [ ] **Step 4: Headless verification** — with `npm run dev` up, `node scripts/verify-tree-embed.mjs`; checks 3 (mount + persist) and 4 (priority rows) now pass. Then **manually** in the browser: open `/builds`, allocate a keystone + notables, confirm points chips update, the priority list lists them with icons, hovering a row glows that node in the embed, clicking focuses it, dragging reorders, removing a row deallocates the node; reload → tree + order restored; edit gear (forces a full dossier re-render) → the embed keeps its allocation + view.
- [ ] **Step 5: Commit** — `git commit -am "feat(planner): embed the interactive tree in the editor + Notable Priority (hover-highlight, focus, drag-reorder, persist)"`

---

### Task 8: CSS — embed sizing, points chips, Notable Priority list

**Files:**
- Modify: `public/css/builds.css`

**Interfaces:**
- Consumes: class names emitted by Tasks 6–7 + `tree-priority.js`; `tokens.css` custom properties. Reuses the existing `.tree-panel`/`.passive-tree-*` styling (from `app.css`) unchanged.

- [ ] **Step 1: Append to the editor section of `public/css/builds.css`** (all colors via `tokens.css` vars; no new palette literals except derived alphas):

```css
/* ---- Passive tree embed (Phase 5) ---- */
.editor-tree-embed { position: relative; margin: 4px 0 14px; }
.passive-tree-wrap--embed { position: relative; width: 100%; height: min(72vh, 720px);
  border: 1px solid var(--border); border-radius: 8px; overflow: hidden;
  background: color-mix(in srgb, var(--bg-base) 60%, transparent); }
.passive-tree-wrap--embed canvas { display: block; width: 100%; height: 100%; touch-action: none; }
.editor-tree-points { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 10px; }
.tree-chip { display: inline-flex; align-items: baseline; gap: 5px; padding: 4px 10px;
  border: 1px solid var(--border); border-radius: 999px;
  background: color-mix(in srgb, var(--bg-surface) 88%, transparent);
  color: var(--color-default); font: 11px/1.3 var(--font-smallcaps); letter-spacing: .04em; }
.tree-chip b { color: var(--color-normal); font-size: 13px; }

/* ---- Notable Priority list ---- */
.editor-notable-priority { margin-top: 8px; }
.editor-subhead { margin: 0 0 10px; color: var(--color-default); font-size: 10px; font-weight: 650;
  letter-spacing: .16em; text-transform: uppercase; }
.prio-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.prio-row { display: flex; align-items: center; gap: 10px; padding: 6px 10px;
  border: 1px solid var(--border); border-radius: 7px;
  background: color-mix(in srgb, var(--bg-surface) 88%, transparent);
  transition: border-color 120ms ease, transform 120ms ease; cursor: pointer; }
.prio-row:hover { border-color: color-mix(in srgb, var(--color-gem) 45%, var(--border)); transform: translateY(-1px); }
.prio-handle { color: var(--color-default); font-size: 13px; cursor: grab; opacity: .6; }
.prio-row:hover .prio-handle { opacity: 1; }
.prio-icon { width: 28px; height: 28px; flex: none; border-radius: 5px;
  background: rgb(255 255 255 / .05); }
.prio-body { display: flex; flex-direction: column; min-width: 0; flex: 1; }
.prio-name { font-size: 12.5px; line-height: 1.2; overflow-wrap: anywhere; }
.prio-name.is-keystone { color: var(--color-keystone, var(--color-unique)); }
.prio-name.is-notable, .prio-name.is-blighted { color: var(--color-notable); }
.prio-name.is-ascNotable { color: var(--color-crafted); }
.prio-kind { font-size: 9px; letter-spacing: .12em; text-transform: uppercase; color: var(--color-default); }
.prio-remove { flex: none; width: 22px; height: 22px; padding: 0; border: 0; border-radius: 5px;
  background: rgb(0 0 0 / .35); color: var(--color-default); font-size: 13px; line-height: 1; cursor: pointer;
  opacity: 0; transition: opacity 120ms ease; }
.prio-row:hover .prio-remove, .prio-remove:focus-visible { opacity: 1; }
.prio-remove:hover { color: var(--color-normal); }

@media (max-width: 640px) {
  .passive-tree-wrap--embed { height: min(64vh, 520px); }
}
@media (prefers-reduced-motion: reduce) {
  .prio-row { transition: none; }
}
```

- [ ] **Step 2: Verify tokens exist** — grep `public/css/tokens.css` for `--color-keystone`, `--color-notable`, `--color-crafted`, `--color-unique`, `--color-gem`, `--bg-surface`, `--bg-base`, `--border`, `--color-normal`, `--color-default`, `--font-smallcaps`. If `--color-keystone` is absent, the fallback `var(--color-keystone, var(--color-unique))` covers it (already written).
- [ ] **Step 3: Visual check** — `npm run dev`, `/builds`, confirm the embed fills a bounded panel inside the scrolling dossier, points chips read correctly, priority rows show icons + kind-colored names, hover/drag/remove affordances appear, narrow to 390px (embed shrinks, no horizontal page scroll).
- [ ] **Step 4: Commit** — `git commit -am "style(planner): passive-tree embed sizing + Notable Priority list styles"`

---

### Task 9: Full verification, docs, roadmap tick

**Files:**
- Modify: `docs/superpowers/specs/2026-07-06-build-planner-roadmap.md`
- Modify: `docs/passive-tree.md`
- Modify: `docs/superpowers/specs/2026-07-06-tree-embed-notable-priority-design.md` (tick the acceptance checkboxes)

- [ ] **Step 1: Full test suite** — `npm test` → all green (634 + new pure tests).
- [ ] **Step 2: Static build** — `npm run build:static` → the crawler must pass with no dead internal links. Confirm `/passives` and `/builds` both prerender; no new client-fetched URL was introduced (the embed reads only existing `/static/generated/passive-*.json` + `/static/img/passive-atlas/*`, copied to `dist/` as static files).
- [ ] **Step 3: Headless glue verification** — with a local static preview or `npm run dev`, run `node scripts/verify-tree-embed.mjs` and confirm all checks pass. Record the output in the commit body.
- [ ] **Step 4: Document the architecture** — append to `docs/passive-tree.md` a short "Embeddable component" subsection: `init(canvas, data, opts)` scopes control lookups to `opts.root` and injects `treePanelsHtml()`; page chrome (`location.hash`, clipboard, reset-confirm, `?node=` focus) is host-owned via `opts` (`initialCode`, `initialFocus`, `onCopy`, `confirmReset`, `onCodeChange`, `onChange`, `onReady`); extended API (`getState/setState`, `getCode/setCode`, `setHighlight`, `focusNode`, `getAllocatedNotables`, `getPoints`, `paintNodeIcon`, `deallocate`, `destroy`); `/passives` is the thin host, the build editor mounts + reparents the embed and persists `tree.code` + `tree.notablePriority`.
- [ ] **Step 5: Tick the phase** — in `docs/superpowers/specs/2026-07-06-build-planner-roadmap.md` status checklist, change `- [ ] Phase 5 — Tree embed + Notable Priority` to `- [x] Phase 5 — Tree embed + Notable Priority (<final commit sha>)`. Tick the acceptance boxes in the Phase 5 design spec.
- [ ] **Step 6: Commit** — `git commit -am "docs(planner): tick Phase 5 (tree embed + Notable Priority); record embeddable API"`

---

## Self-Review

**1. Spec coverage:**
- Part 1 (embeddable component): scoped lookups (Task 2), shared panel source `treePanelsHtml` (Task 1), host-owned hash I/O via `opts.initialCode`/`onCodeChange`/`onCopy` (Tasks 2, 4), extended API `getState/setState/setHighlight/focusNode/getAllocatedNotables` + change event (Task 3), `/passives` thin host (Task 4). ✓
- Part 2 (editor integration): embed with `initialCode: build.tree.code`, `onCodeChange` auto-save debounced (Task 7), "Open full page" link (Task 6), points summary above the embed (Tasks 6–7). ✓
- Part 3 (Notable Priority): section beneath the embed (Task 6), rows = handle + icon + name + remove (Task 5), `build.tree.notablePriority` order with reconcile-on-change (Tasks 5, 7), hover→`setHighlight`, click→`focusNode` (Task 7), HTML5 DnD reorder (Task 7), advisory-only (never mutates the tree except the explicit remove=deallocate affordance, documented) (Task 7). ✓
- Acceptance: `/passives` byte-identical share-code round-trip + all controls (Task 4 verify + `test/passiveCode.test.js` unchanged); two-instance id-scoping (Task 4 check 2); editor allocate→auto-save→reload (Task 7 verify); hover/click/DnD (Task 7 verify); `build:static` passes (Task 9). ✓

**2. Placeholder scan:** No TBD/TODO/"handle errors"/vague steps — every code step shows the code. The `paintNodeIcon`, DnD, and reparenting are fully specified. ✓

**3. Type consistency:** `treePanelsHtml(): string` (Task 1) consumed in Task 2; `reconcilePriority(number[], number[]): number[]` and `renderPriorityList(number[], Map, opts): string` (Task 5) consumed in Task 7; embed API names (`setHighlight`, `focusNode`, `getAllocatedNotables` → `{h,kind,name,icon}`, `getPoints` → `{main,asc,ws1,ws2}` with `{spent,max}`, `paintNodeIcon(hash, canvasEl)`, `getCode`/`setCode`, `deallocate`, `destroy`, `onReady`/`onChange`/`onCodeChange`) defined in Tasks 2–3 and consumed identically in Task 7. `data-*` hook names match between `tree-panel.js` (Task 1) and the scoped queries (Task 2), and between `editor-render.js`/`tree-priority.js` (Tasks 5–6) and `build-editor.js` (Task 7). ✓

**Deviations from the spec (all deliberate, noted inline):**
- The "shared control-panel partial" is a **pure JS module** (`tree-panel.js`), not a Nunjucks partial — because the editor is client-rendered JS strings (post-dates the spec's Dossier redesign). `init` injects it into `root`, so both surfaces get identical controls from one source.
- Read-only/import build previews show a **static tree summary + deep link**, not a live embed — keeps shared previews cheap (no 1.2 MB canvas mount for a glance). The interactive embed is edit-mode only.
- Notable Priority node icons use the reused `skills` atlas via `paintNodeIcon` (real fidelity), painted into small per-row canvases.
- Class/ascendancy remain independently tracked in the tree (via the share code) vs. the dossier's `build.class`/`ascendancy` metadata — no cross-sync this phase (out of scope; note for a future polish).
