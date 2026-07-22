# Build Planner Phase 4b — Build Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the read-only `#/b/<id>` view on /builds into a working build editor: in-game-style inventory paper-doll, Skill Gems-style setup panel with support sockets, a reusable search picker, and auto-included item-granted skill rows.

**Architecture:** Same layering as 4a — pure, node-tested render/logic modules (`editor-render.js`) under thin browser controllers (`build-editor.js`, `entity-picker.js`), all state through `build-store.js` via `getStore()`, all data from the prebuilt `planner-data.json` (extended this phase) and `search-index.json` artifacts. The in-game look comes from Phase 3's `planner-art.css` classes.

**Tech Stack:** Vanilla ESM browser modules (no bundler), Express/Nunjucks shell (unchanged), `node:test` + supertest.

**Specs:** `docs/superpowers/specs/2026-07-06-builds-pages-design.md` (milestone 4b) + `docs/superpowers/specs/2026-07-21-build-planner-amendments-design.md` §4 (granted skills). Mod display (§1) is Phase 4c — slots hold items only in this phase.

**Base branch:** `planner/phase-4a-builds-pages` (held, unmerged — all 4b work stacks on it).

## Global Constraints

- **Static-first:** no server routes; builds live in localStorage; all mutation through `build-store.js` via `getStore()` — never raw localStorage.
- **Pure cores, dual-use:** `editor-render.js` must be importable by both `node --test` and the browser — relative imports only (`./builds-render.js`, `./build-rules.js`), no DOM/fetch/window. Browser-only wiring (`build-editor.js`, `entity-picker.js`) uses absolute `/static/js/...` imports.
- **Escape ALL interpolated strings** in client-rendered HTML via the shared `esc()` (`builds-render.js`). Item/build names and slugs count.
- **Item reference shape:** `{ kind: 'unique'|'base'|'gem', slug }`. Skill setups: `{ gem: {slug}, level, supports: [{slug}] }`.
- **Warnings, never hard blocks** — legality problems from `build-rules.js` render as inline warnings; the user can always save an "illegal" state.
- **Art is self-hosted** — only `planner-art.css` classes (Phase 3) reference game art; never add new `url()`s without the `docs/ui/ingame-art-inventory.md` catalog row + guard test (`test/plannerArt.test.js`).
- **Crawler discoverability:** the only client fetches are `/static/generated/search-index.json` and `/static/generated/planner-data.json` — both under `public/` (copied to dist, no crawl needed). No new fetched URLs.
- **z-index ladder:** build menu 130 / toast 131 (4a); the picker overlay uses **140 (scrim) / 141 (panel)** — above menu/toast, below header search (200).
- **Keep `npm test` green** after every task. Commit per task, `feat(planner): ...` style, NO Co-Authored-By lines.
- **Do not scaffold ahead:** no mod picker (4c), no tree embed (5 — placeholder panel only), no share/export UX (8).

## File Structure

| File | Responsibility |
|---|---|
| `src/data/planner.js` (modify) | Emit `granted` (unique→granted gem slugs) + `recommends` (gem→recommended support slugs) maps |
| `public/js/build-store.js` (modify) | Validate optional `grantedSupports` field |
| `public/js/editor-render.js` (create) | PURE: full editor HTML (paper-doll, tray, skill panel, granted rows, tree placeholder, notes) + `rankDocs` |
| `public/js/entity-picker.js` (create) | Browser overlay: searchable picker over search-index docs |
| `public/js/build-editor.js` (create) | Browser controller: event wiring, picker launches, store mutations |
| `public/js/builds-page.js` (modify) | Route `#/b/<id>` to the editor; load planner-data; keep read-only render for import preview |
| `public/js/build-host.js` (modify) | Shared `safeWrite()` quota-error helper |
| `views/builds.njk` (modify) | Load `planner-art.css` + new module scripts |
| `public/css/builds.css` (modify) | Paper-doll grid, skill panel, picker, violations |
| `test/plannerData` additions, `test/build-store.test.js`, `test/editorRender.test.js` (create) | Coverage |

---

### Task 1: planner-data — granted skills + recommended supports

**Files:**
- Modify: `src/data/planner.js`
- Test: `test/planner-data.test.js` (append)

**Interfaces:**
- Consumes: graph adapters `nodesByKind`, `edgesFrom`, `getNode` (already imported in planner.js); `grants` edges (unique→gem-kind node), `recommends_support` edges (gem→gem).
- Produces: `plannerData()` return gains `granted: { [uniqueSlug]: gemSlug[] }` and `recommends: { [gemSlug]: supportSlug[] }` (source edge order preserved). Emitted into `public/generated/planner-data.json` by the existing `scripts/build-index.js` call — no build-script change needed.

- [ ] **Step 1: Confirm the data anchors** (adjust test fixtures if these print differently):

```bash
node -e "
import('./src/data/graph.js').then(({ nodesByKind, edgesFrom, getNode }) => {
  const u = nodesByKind('unique').find(n => edgesFrom(n.id, 'grants').length);
  console.log('granting unique:', u.slug, '->', edgesFrom(u.id, 'grants').map(e => getNode(e.to)?.slug));
  const g = nodesByKind('gem').find(n => edgesFrom(n.id, 'recommends_support').length);
  console.log('recommending gem:', g.slug, '->', edgesFrom(g.id, 'recommends_support').slice(0,3).map(e => getNode(e.to)?.slug));
});"
```

Record the first printed unique slug + granted slug and gem slug + support slug — use them as `<GRANTING_UNIQUE>`, `<GRANTED_GEM>`, `<REC_GEM>`, `<REC_SUPPORT>` in Step 2.

- [ ] **Step 2: Write the failing tests** — append to `test/planner-data.test.js` (match the file's existing import/setup conventions):

```js
test('granted maps granting uniques to gem slugs that resolve in the gems map', () => {
  const { granted, gems } = plannerData();
  assert.ok(Object.keys(granted).length >= 50, 'expect a substantial granted map');
  assert.ok(granted['<GRANTING_UNIQUE>'].includes('<GRANTED_GEM>'));
  for (const [slug, skills] of Object.entries(granted)) {
    assert.ok(Array.isArray(skills) && skills.length > 0, `${slug}: non-empty`);
    for (const s of skills) assert.ok(gems[s], `${slug} grants unknown gem ${s}`);
  }
});

test('recommends maps gems to support slugs, all resolving to support-type gems', () => {
  const { recommends, gems } = plannerData();
  assert.ok(recommends['<REC_GEM>'].includes('<REC_SUPPORT>'));
  for (const [slug, sups] of Object.entries(recommends)) {
    assert.ok(gems[slug], `unknown recommending gem ${slug}`);
    for (const s of sups) assert.equal(gems[s]?.gemType, 'support', `${slug} recommends non-support ${s}`);
  }
});
```

- [ ] **Step 3: Run to verify RED**

Run: `node --test test/planner-data.test.js 2>&1 | tail -10` — FAIL (granted/recommends undefined).

- [ ] **Step 4: Implement** — in `src/data/planner.js`, before the final `return`:

```js
  // Item-granted skills: grants edges point unique -> gem-kind node (the
  // granted skill is a gem node; it resolves in the search index too).
  const granted = {};
  for (const u of nodesByKind('unique')) {
    const skills = [...new Set(
      edgesFrom(u.id, 'grants').map((e) => getNode(e.to)).filter(Boolean).map((n) => n.slug),
    )];
    if (skills.length) granted[u.slug] = skills;
  }

  // Recommended supports, source edge order — the picker ranks these first.
  const recommends = {};
  for (const g of nodesByKind('gem')) {
    const sups = edgesFrom(g.id, 'recommends_support')
      .map((e) => getNode(e.to)).filter(Boolean).map((n) => n.slug);
    if (sups.length) recommends[g.slug] = sups;
  }

  return { slots, items, gems, granted, recommends };
```

(Replace the existing `return { slots, items, gems };`. Update the file's header comment to list the two new maps.)

- [ ] **Step 5: GREEN + full suite + artifact size check**

Run: `node --test test/planner-data.test.js 2>&1 | tail -5` then `npm test 2>&1 | tail -3` then `npm run build:index && ls -la public/generated/planner-data.json` — expect green; artifact grows from ~240KB to well under 600KB (log the size in the report).

- [ ] **Step 6: Commit**

```bash
git add src/data/planner.js test/planner-data.test.js
git commit -m "feat(planner): granted-skill and recommended-support maps in planner-data"
```

---

### Task 2: schema — optional `grantedSupports` field

**Files:**
- Modify: `public/js/build-store.js`
- Test: `test/build-store.test.js` (append)

**Interfaces:**
- Produces: builds MAY carry `grantedSupports: { [key: string]: [{slug: string}] }` where key = `<itemSlug>:<grantedGemSlug>`. Absent field stays valid (no schema version bump — additive, and the codec already passes unknown fields through). `validateBuild` rejects malformed shapes when the field is present. Task 5/6 read/write this field.

- [ ] **Step 1: Write the failing tests** — append to `test/build-store.test.js` (reuse its existing `emptyBuild`/fixture helpers):

```js
test('validateBuild accepts a well-formed grantedSupports map', () => {
  const b = emptyBuild({ now: () => 1, uuid: () => 'x' });
  b.grantedSupports = { 'choir-item:lightning-bolt': [{ slug: 'pierce' }] };
  assert.equal(validateBuild(b).ok, true);
});

test('validateBuild rejects malformed grantedSupports', () => {
  const b = emptyBuild({ now: () => 1, uuid: () => 'x' });
  b.grantedSupports = { bad: [{ nope: 1 }] };
  const r1 = validateBuild(b);
  assert.equal(r1.ok, false);
  assert.ok(r1.errors.some((e) => e.includes('grantedSupports.bad[0].slug')));
  b.grantedSupports = 'nope';
  assert.equal(validateBuild(b).ok, false);
});
```

- [ ] **Step 2: RED** — `node --test test/build-store.test.js 2>&1 | tail -5` (grantedSupports currently ignored → first test passes but second FAILS; that failing assertion is the RED evidence).

- [ ] **Step 3: Implement** — in `validateBuild` in `public/js/build-store.js`, after the `tree` block:

```js
  if (b.grantedSupports !== undefined) {
    if (!isObj(b.grantedSupports)) errors.push('grantedSupports: expected object');
    else {
      for (const [k, list] of Object.entries(b.grantedSupports)) {
        if (!Array.isArray(list)) { errors.push(`grantedSupports.${k}: expected array`); continue; }
        list.forEach((sup, i) => {
          if (!isObj(sup) || !isStr(sup.slug)) errors.push(`grantedSupports.${k}[${i}].slug: expected string`);
        });
      }
    }
  }
```

- [ ] **Step 4: GREEN + full suite** — `node --test test/build-store.test.js 2>&1 | tail -5`, then `npm test 2>&1 | tail -3`.

- [ ] **Step 5: Commit**

```bash
git add public/js/build-store.js test/build-store.test.js
git commit -m "feat(planner): optional grantedSupports field in the build schema"
```

---

### Task 3: editor-render — gear section (paper-doll + tray)

**Files:**
- Create: `public/js/editor-render.js`
- Test: `test/editorRender.test.js`

**Interfaces:**
- Consumes: `esc` from `./builds-render.js`; `gearViolations` from `./build-rules.js`; build objects (4a schema + Task 2 field); a `planner` object shaped like planner-data.json (Task 1); `resolveRef({kind, slug}) -> {name, iconUrl, url} | null`.
- Produces (Tasks 4/6 rely on these exact names):
  - `renderGear(build, ctx) -> string` — ctx = `{ planner, resolveRef, weaponSet }` (weaponSet: 1|2). DOM hooks emitted: `[data-slot-id="<id>"]` on every well (role=button, tabindex=0), `[data-slot-clear="<id>"]`, `[data-weapon-set="1|2"]` toggle buttons, `[data-tray-equip="<index>"]`, `[data-tray-remove="<index>"]`, violations `<ul class="editor-warnings">`.
  - `rankDocs(docs, rankedSlugs) -> docs` — stable partition: docs whose `slug` is in rankedSlugs first (in rankedSlugs order), rest after in original order.
  - `esc` re-exported for the browser controllers.

- [ ] **Step 1: Write the failing tests** — `test/editorRender.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderGear, rankDocs } from '../public/js/editor-render.js';
import { emptyBuild } from '../public/js/build-store.js';

const PLANNER = {
  slots: [
    { id: 'weapon1a', name: 'Main Hand (Set I)', group: 'weaponset1', accepts: 'weapon', order: 1 },
    { id: 'weapon1b', name: 'Off Hand (Set I)', group: 'weaponset1', accepts: 'offhand', order: 2 },
    { id: 'weapon2a', name: 'Main Hand (Set II)', group: 'weaponset2', accepts: 'weapon', order: 3 },
    { id: 'weapon2b', name: 'Off Hand (Set II)', group: 'weaponset2', accepts: 'offhand', order: 4 },
    { id: 'helmet', name: 'Helmet', group: null, accepts: 'helmet', order: 5 },
  ],
  items: {
    'big-maul': { slots: ['weapon1a', 'weapon2a'], twoHanded: true, class: 'two-hand-maces' },
    'iron-hat': { slots: ['helmet'], twoHanded: false, class: 'helmets' },
    buckler: { slots: ['weapon1b', 'weapon2b'], twoHanded: false, class: 'shields' },
  },
  gems: {}, granted: {}, recommends: {},
};
const fixed = (over = {}) => emptyBuild({ now: () => 1, uuid: () => 'b1', ...over });
const resolve = (ref) => ({ name: `N:${ref.slug}`, iconUrl: null, url: `/x/${ref.slug}` });
const ctx = { planner: PLANNER, resolveRef: resolve, weaponSet: 1 };

test('renderGear: wells for active weapon set + slotless slots, hooks present', () => {
  const html = renderGear(fixed(), ctx);
  for (const id of ['weapon1a', 'weapon1b', 'helmet']) assert.ok(html.includes(`data-slot-id="${id}"`), id);
  assert.ok(!html.includes('data-slot-id="weapon2a"'), 'set II hidden');
  assert.match(html, /data-weapon-set="2"/);
});

test('renderGear: filled slot shows resolved item + clear hook + card hover; escapes names', () => {
  const b = fixed({ gear: { helmet: { item: { kind: 'base', slug: 'iron-hat' }, wishlist: [] } } });
  const html = renderGear(b, { ...ctx, resolveRef: () => ({ name: '<i>x</i>', iconUrl: null, url: null, cardUrl: '/base/iron-hat/card' }) });
  assert.ok(html.includes('&lt;i&gt;x&lt;/i&gt;'));
  assert.ok(!html.includes('<i>x</i>'));
  assert.match(html, /data-slot-clear="helmet"/);
  assert.match(html, /data-card-url="\/base\/iron-hat\/card"/);
});

test('renderGear: two-hander ghosts the off-hand and blocked off-hand renders a warning', () => {
  const b = fixed({ gear: {
    weapon1a: { item: { kind: 'base', slug: 'big-maul' }, wishlist: [] },
    weapon1b: { item: { kind: 'base', slug: 'buckler' }, wishlist: [] },
  } });
  const html = renderGear(b, ctx);
  assert.match(html, /editor-warnings/);
  assert.match(html, /editor-slot--violation/);
  const empty = fixed({ gear: { weapon1a: { item: { kind: 'base', slug: 'big-maul' }, wishlist: [] } } });
  assert.match(renderGear(empty, ctx), /editor-slot__ghost/);
});

test('renderGear: unassigned tray rows carry equip/remove hooks', () => {
  const b = fixed({ unassigned: [{ kind: 'gem', slug: 'spark' }, { kind: 'base', slug: 'iron-hat' }] });
  const html = renderGear(b, ctx);
  assert.match(html, /data-tray-equip="1"/);
  assert.match(html, /data-tray-remove="0"/);
});

test('rankDocs: stable partition by ranked slugs', () => {
  const docs = [{ slug: 'a' }, { slug: 'b' }, { slug: 'c' }, { slug: 'd' }];
  assert.deepEqual(rankDocs(docs, ['c', 'a']).map((d) => d.slug), ['c', 'a', 'b', 'd']);
  assert.deepEqual(rankDocs(docs, []).map((d) => d.slug), ['a', 'b', 'c', 'd']);
});
```

- [ ] **Step 2: RED** — `node --test test/editorRender.test.js 2>&1 | tail -5` (module not found).

- [ ] **Step 3: Implement** — `public/js/editor-render.js`:

```js
// public/js/editor-render.js
// Pure ES module — HTML renderers for the /builds editor (Phase 4b): inventory
// paper-doll + tray (this file's renderGear), skill setup panel (renderSkills,
// Task 4), and the assembled renderEditor. No DOM/fetch/window — node-testable.
// In-game art comes from planner-art.css classes; interaction hooks are
// data-* attributes consumed by build-editor.js.
import { esc } from './builds-render.js';
import { gearViolations } from './build-rules.js';

export { esc };

/** Stable partition: docs whose slug is ranked come first, in ranked order. */
export function rankDocs(docs, rankedSlugs) {
  if (!rankedSlugs?.length) return docs;
  const pos = new Map(rankedSlugs.map((s, i) => [s, i]));
  const ranked = docs.filter((d) => pos.has(d.slug)).sort((a, b) => pos.get(a.slug) - pos.get(b.slug));
  return [...ranked, ...docs.filter((d) => !pos.has(d.slug))];
}

function itemChip(ref, resolveRef, cls = '') {
  const doc = resolveRef(ref) || {};
  const name = doc.name || ref.slug;
  const icon = doc.iconUrl
    ? `<img class="editor-item__icon" src="${esc(doc.iconUrl)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">`
    : '';
  // data-card-url rides the existing global card-tooltip harness (base.njk):
  // hovering a filled well/chip shows the full item card, per the 4b spec.
  const card = doc.cardUrl ? ` data-card-url="${esc(doc.cardUrl)}"` : '';
  return `<span class="editor-item ${cls}"${card}>${icon}<span class="editor-item__name editor-item__name--${esc(ref.kind)}">${esc(name)}</span></span>`;
}

const setOf = (slotId) => (slotId.startsWith('weapon') ? Number(slotId[6]) : null);

export function renderGear(build, ctx) {
  const { planner, resolveRef, weaponSet } = ctx;
  const violations = gearViolations(build, planner);
  const bySlot = new Map(violations.filter((v) => v.slotId).map((v) => [v.slotId, v]));

  const visible = planner.slots.filter((s) => !s.group || s.group === `weaponset${weaponSet}`);
  const mainhand = build.gear[`weapon${weaponSet}a`]?.item;
  const mainTwoHanded = mainhand && planner.items[mainhand.slug]?.twoHanded;

  const wells = visible.map((s) => {
    const g = build.gear[s.id];
    const violation = bySlot.get(s.id);
    let body;
    if (g?.item) {
      body = itemChip(g.item, resolveRef) +
        `<button class="editor-slot__clear" type="button" data-slot-clear="${esc(s.id)}" aria-label="Unequip ${esc(s.name)}">×</button>`;
    } else if (s.id === `weapon${weaponSet}b` && mainTwoHanded) {
      body = '<span class="editor-slot__ghost">two-handed</span>';
    } else {
      body = `<span class="editor-slot__hint">${esc(s.name)}</span>`;
    }
    return `<div class="editor-slot planner-slot-well editor-slot--${esc(s.id)}${violation ? ' editor-slot--violation' : ''}"` +
      ` data-slot-id="${esc(s.id)}" role="button" tabindex="0" aria-label="${esc(s.name)}"` +
      `${violation ? ` title="${esc(violation.message)}"` : ''}>${body}</div>`;
  }).join('');

  const toggle = [1, 2].map((n) =>
    `<button class="editor-set-btn${n === weaponSet ? ' is-active' : ''}" type="button" data-weapon-set="${n}"` +
    ` aria-pressed="${n === weaponSet}">Weapon Set ${n === 1 ? 'I' : 'II'}</button>`).join('');

  const tray = build.unassigned.map((ref, i) =>
    `<li class="editor-tray__row">${itemChip(ref, resolveRef)}` +
    `<span class="editor-tray__actions">` +
    `<button type="button" data-tray-equip="${i}">Equip</button>` +
    `<button type="button" data-tray-remove="${i}" aria-label="Remove from build">×</button>` +
    `</span></li>`).join('');

  const warnings = violations.length
    ? `<ul class="editor-warnings">${violations.map((v) => `<li>${esc(v.message)}</li>`).join('')}</ul>` : '';

  return `<section class="editor-gear planner-area-frame">
    <header class="editor-section-head"><h2>Gear</h2><div class="editor-set-toggle" role="group" aria-label="Weapon set">${toggle}</div></header>
    <div class="editor-doll">${wells}</div>
    ${warnings}
    <div class="editor-tray"><h3>Unassigned</h3>${tray ? `<ul class="editor-tray__list">${tray}</ul>` : '<p class="editor-none">Nothing waiting. Use “Add to build” on any card.</p>'}</div>
  </section>`;
}
```

- [ ] **Step 4: GREEN + full suite** — `node --test test/editorRender.test.js 2>&1 | tail -5`, then `npm test 2>&1 | tail -3`.

- [ ] **Step 5: Commit**

```bash
git add public/js/editor-render.js test/editorRender.test.js
git commit -m "feat(planner): editor gear renderer — paper-doll wells, weapon-set toggle, tray"
```

---

### Task 4: editor-render — skill panel + granted rows + assembled editor

**Files:**
- Modify: `public/js/editor-render.js`
- Test: `test/editorRender.test.js` (append)

**Interfaces:**
- Consumes: `setupViolations` from `./build-rules.js` (signature `setupViolations(build, gemData) -> [{code, setup, support?, message}]` where `setup` is the skills[] index); `planner.granted`, `planner.gems`, `build.grantedSupports` (Task 2), `build.skills`.
- Produces:
  - `grantedRows(build, planner) -> [{ key, item: {kind,slug}, skill, supports: [{slug}] }]` — derived rows for every granted skill on every equipped item; `key = `${item.slug}:${skill}``; `supports` read from `build.grantedSupports[key] ?? []`. Exported (controller reuses it).
  - `renderSkills(build, ctx) -> string`. Hooks: `[data-setup-add]`; per setup row i: `[data-gem-well="i"]`, `[data-setup-level="i"]` (number input), `[data-setup-remove="i"]`, `[data-setup-move="i:up|i:down"]`, sockets `[data-socket="s:i:j"]` (setup i, socket j; filled sockets also get `[data-socket-clear="s:i:j"]` on a nested ×); granted row hooks use `g:<key>:j` in the same attributes and have NO remove/move/level.
  - `renderEditor(build, ctx) -> string` — back link, name header, `renderGear` + `renderSkills` + tree placeholder (`build.tree.code` presence + `/passives` link) + notes `<textarea data-notes>`.

- [ ] **Step 1: Write the failing tests** — append to `test/editorRender.test.js`:

```js
import { renderSkills, renderEditor, grantedRows } from '../public/js/editor-render.js';

const SKILL_PLANNER = { ...PLANNER,
  gems: {
    spark: { gemType: 'active', maxSupports: 5, color: 'blue', reqs: null },
    pierce: { gemType: 'support', maxSupports: 0, color: 'green', reqs: null },
    'storm-call': { gemType: 'active', maxSupports: 5, color: 'blue', reqs: null },
  },
  granted: { 'storm-amulet': ['storm-call'] },
};
const sctx = { planner: SKILL_PLANNER, resolveRef: resolve, weaponSet: 1 };

test('renderSkills: setup row with sockets, level, remove/move hooks', () => {
  const b = fixed({ skills: [{ gem: { slug: 'spark' }, level: 12, supports: [{ slug: 'pierce' }] }] });
  const html = renderSkills(b, sctx);
  assert.match(html, /data-gem-well="0"/);
  assert.match(html, /data-setup-level="0"[^>]*value="12"/);
  assert.match(html, /data-setup-remove="0"/);
  assert.match(html, /data-setup-move="0:up"/);
  assert.match(html, /data-socket="s:0:0"/);
  assert.match(html, /planner-support-socket--green/);   // filled by pierce
  assert.match(html, /data-socket="s:0:4"/);              // 5 sockets rendered
  assert.match(html, /planner-support-socket--empty/);
  assert.match(html, /data-setup-add/);
});

test('grantedRows + renderSkills: equipped granting item yields a non-removable row', () => {
  const b = fixed({
    gear: { helmet: { item: { kind: 'unique', slug: 'storm-amulet' }, wishlist: [] } },
    grantedSupports: { 'storm-amulet:storm-call': [{ slug: 'pierce' }] },
  });
  const rows = grantedRows(b, SKILL_PLANNER);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], { key: 'storm-amulet:storm-call', item: { kind: 'unique', slug: 'storm-amulet' },
    skill: 'storm-call', supports: [{ slug: 'pierce' }] });
  const html = renderSkills(b, sctx);
  assert.match(html, /editor-setup__source/);       // "from <item>" label present
  assert.match(html, /N:storm-amulet/);             // resolved granting item name
  assert.match(html, /data-socket="g:storm-amulet:storm-call:1"/);
  assert.ok(!/data-setup-remove="g:/.test(html), 'granted rows have no remove');
});

test('renderSkills: duplicate-support violation renders inline warning', () => {
  const b = fixed({ skills: [
    { gem: { slug: 'spark' }, level: null, supports: [{ slug: 'pierce' }] },
    { gem: { slug: 'spark' }, level: null, supports: [{ slug: 'pierce' }] },
  ] });
  assert.match(renderSkills(b, sctx), /editor-setup__warning/);
});

test('renderEditor: assembles gear, skills, tree placeholder, notes', () => {
  const b = fixed({ notes: 'hi <b>there</b>', tree: { code: 'v7abc', notablePriority: [1] } });
  const html = renderEditor(b, sctx);
  assert.match(html, /editor-gear/);
  assert.match(html, /editor-skills/);
  assert.match(html, /Passive tree saved/);
  assert.match(html, /href="\/passives"/);
  assert.match(html, /data-notes/);
  assert.ok(html.includes('hi &lt;b&gt;there&lt;/b&gt;'));
});
```

- [ ] **Step 2: RED** — `node --test test/editorRender.test.js 2>&1 | tail -8`.

- [ ] **Step 3: Implement** — append to `public/js/editor-render.js`:

```js
import { setupViolations } from './build-rules.js';

/** Granted-skill rows derived from equipped items (amendments §4). */
export function grantedRows(build, planner) {
  const rows = [];
  for (const g of Object.values(build.gear)) {
    if (!g?.item) continue;
    for (const skill of planner.granted?.[g.item.slug] ?? []) {
      const key = `${g.item.slug}:${skill}`;
      rows.push({ key, item: g.item, skill, supports: build.grantedSupports?.[key] ?? [] });
    }
  }
  return rows;
}

const SOCKET_COLORS = new Set(['blue', 'green', 'red', 'white']);

function socketHtml(idPrefix, j, supRef, planner) {
  if (!supRef) {
    return `<span class="editor-socket planner-support-socket--empty" data-socket="${esc(`${idPrefix}:${j}`)}"` +
      ' role="button" tabindex="0" aria-label="Empty support socket"></span>';
  }
  const color = planner.gems[supRef.slug]?.color;
  const art = SOCKET_COLORS.has(color) ? color : 'white';
  return `<span class="editor-socket editor-socket--filled planner-support-socket--${esc(art)}"` +
    ` data-socket="${esc(`${idPrefix}:${j}`)}" role="button" tabindex="0" title="${esc(supRef.slug)}"` +
    ` aria-label="Support: ${esc(supRef.slug)}">` +
    `<button class="editor-socket__clear" type="button" data-socket-clear="${esc(`${idPrefix}:${j}`)}" aria-label="Remove support">×</button></span>`;
}

function setupRow({ idPrefix, gemRef, level, supports, label, removable, index, warnings, ctx }) {
  const { planner, resolveRef } = ctx;
  const max = planner.gems[gemRef.slug]?.maxSupports ?? 5;
  const spirit = planner.gems[gemRef.slug]?.gemType === 'spirit';
  const sockets = Array.from({ length: max }, (_, j) => socketHtml(idPrefix, j, supports[j], planner)).join('');
  const levelHtml = removable
    ? `<label class="editor-setup__level planner-gem-level-bg">Lv <input type="number" min="1" max="40"` +
      ` value="${level ?? ''}" data-setup-level="${index}"></label>`
    : '';
  const controls = removable
    ? `<span class="editor-setup__controls">` +
      `<button type="button" data-setup-move="${index}:up" aria-label="Move up">↑</button>` +
      `<button type="button" data-setup-move="${index}:down" aria-label="Move down">↓</button>` +
      `<button type="button" data-setup-remove="${index}" aria-label="Remove setup">×</button></span>`
    : '';
  const gemWell = removable
    ? `<span class="editor-setup__gem planner-gem-icon-frame" data-gem-well="${index}" role="button" tabindex="0">${itemChip(gemRef, resolveRef)}</span>`
    : `<span class="editor-setup__gem planner-gem-icon-frame">${itemChip(gemRef, resolveRef)}</span>`;
  return `<li class="editor-setup planner-skill-frame${spirit ? ' editor-setup--spirit' : ''}">
    ${gemWell}${label}${levelHtml}
    <span class="editor-setup__sockets">${sockets}</span>${controls}
    ${warnings.map((w) => `<p class="editor-setup__warning">${esc(w.message)}</p>`).join('')}
  </li>`;
}

export function renderSkills(build, ctx) {
  const violations = setupViolations(build, ctx.planner.gems);
  const rows = build.skills.map((s, i) => setupRow({
    idPrefix: `s:${i}`, gemRef: s.gem, level: s.level, supports: s.supports,
    label: '', removable: true, index: i,
    warnings: violations.filter((v) => v.setup === i), ctx,
  }));
  const grantedHtml = grantedRows(build, ctx.planner).map((r) => setupRow({
    idPrefix: `g:${r.key}`, gemRef: { kind: 'gem', slug: r.skill }, level: null, supports: r.supports,
    label: `<span class="editor-setup__source">from ${itemChip(r.item, ctx.resolveRef)}</span>`,
    removable: false, index: -1, warnings: [], ctx,
  }));
  return `<section class="editor-skills planner-skill-panel">
    <header class="editor-section-head"><h2>Skills</h2>
      <button class="editor-setup-add" type="button" data-setup-add>Add skill</button></header>
    ${rows.length || grantedHtml.length
      ? `<ul class="editor-setups">${rows.join('')}${grantedHtml.join('')}</ul>`
      : '<p class="editor-none">No skill setups yet.</p>'}
  </section>`;
}

export function renderEditor(build, ctx) {
  const tree = build.tree.code
    ? `Passive tree saved · ${build.tree.notablePriority.length} prioritized`
    : 'No passive tree yet';
  return `<article class="editor" data-editor>
    <header class="editor-head">
      <a class="builds-back" href="#">← All builds</a>
      <h2>${esc(build.name)}</h2>
    </header>
    ${renderGear(build, ctx)}
    ${renderSkills(build, ctx)}
    <section class="editor-tree"><h2>Passive tree</h2>
      <p>${esc(tree)} — <a href="/passives">open the tree</a> (embedding arrives in a later phase).</p></section>
    <section class="editor-notes"><h2>Notes</h2>
      <textarea data-notes rows="4" placeholder="Build notes…">${esc(build.notes)}</textarea></section>
  </article>`;
}
```

Note `grantedRows` label uses `from ${itemChip(...)}` — itemChip resolves through resolveRef, so the test's `from N:storm-amulet` assertion matches on the resolved name inside the chip markup: adjust the assertion to `assert.match(html, /from </)` plus `assert.match(html, /N:storm-amulet/)` if the literal combined form fails — the requirement is "labeled from <item>", not exact text adjacency.

- [ ] **Step 4: GREEN + full suite** — `node --test test/editorRender.test.js 2>&1 | tail -5`, then `npm test 2>&1 | tail -3`.

- [ ] **Step 5: Commit**

```bash
git add public/js/editor-render.js test/editorRender.test.js
git commit -m "feat(planner): editor skill panel — setups, sockets, granted-skill rows"
```

---

### Task 5: entity-picker overlay

**Files:**
- Create: `public/js/entity-picker.js`
- Modify: `public/css/builds.css` (picker styles)
- Test: none new (browser-only overlay; its one pure piece, `rankDocs`, was tested in Task 3; behavior verified in Task 8's acceptance)

**Interfaces:**
- Consumes: `groupQuery` + `GROUPS` from `/static/js/query-core.js`; `rankDocs`, `esc` from `/static/js/editor-render.js`.
- Produces: `openPicker({ title, docs, categories, rank = [], onPick }) -> void` — modal overlay (scrim z-140, panel z-141): filters `docs` to `categories` (array of search-index categories), ranks with `rankDocs`, live-filters on input via `groupQuery(query, {docs: filtered})`; empty query lists everything grouped (capped 40/group with a "+N more — type to narrow" line). Row click → `onPick(doc)` then close. Esc / scrim click / × closes. Only one picker at a time.

- [ ] **Step 1: Implement** — `public/js/entity-picker.js`:

```js
// Reusable searchable picker overlay for the build editor. Renders from
// search-index docs (the same set builds-page already loads); matching runs
// through the shared query-core so results behave exactly like /search.
import { groupQuery, GROUPS } from '/static/js/query-core.js';
import { rankDocs, esc } from '/static/js/editor-render.js';

const LABEL_FOR = new Map(GROUPS.map((g) => [g.category, g.label]));

let current = null;
export function closePicker() { current?.remove(); current = null; document.removeEventListener('keydown', onKey); }
function onKey(e) { if (e.key === 'Escape') closePicker(); }

const CAP = 40;

function rowHtml(doc) {
  const icon = doc.iconUrl
    ? `<img class="picker-row__icon" src="${esc(doc.iconUrl)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">`
    : '<span class="picker-row__icon"></span>';
  const hint = String(doc.hint || doc.subtitle || '').replace(/<[^>]*>/g, ' ');
  return `<button type="button" class="picker-row" data-pick-slug="${esc(doc.slug)}" data-pick-category="${esc(doc.category)}">` +
    `${icon}<span class="picker-row__name">${esc(doc.name)}</span><span class="picker-row__hint">${esc(hint)}</span></button>`;
}

function groupHtml(label, docs) {
  const shown = docs.slice(0, CAP);
  const more = docs.length > shown.length
    ? `<p class="picker-more">+${docs.length - shown.length} more — type to narrow</p>` : '';
  return `<section class="picker-group"><h3>${esc(label)} <span>${docs.length}</span></h3>${shown.map(rowHtml).join('')}${more}</section>`;
}

export function openPicker({ title, docs, categories, rank = [], onPick }) {
  closePicker();
  const pool = rankDocs(docs.filter((d) => categories.includes(d.category)), rank);
  const byKey = new Map(pool.map((d) => [`${d.category}:${d.slug}`, d]));

  current = document.createElement('div');
  current.className = 'picker-overlay';
  current.innerHTML = `<div class="picker-scrim"></div>
    <div class="picker-panel" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <header class="picker-head"><h2>${esc(title)}</h2>
        <button class="picker-close" type="button" aria-label="Close">×</button></header>
      <input class="picker-input" type="search" placeholder="Type to search…" autocomplete="off">
      <div class="picker-results"></div>
    </div>`;
  document.body.append(current);
  document.addEventListener('keydown', onKey);

  const input = current.querySelector('.picker-input');
  const results = current.querySelector('.picker-results');

  function render(query) {
    if (!query.trim()) {
      const groups = new Map();
      for (const d of pool) { if (!groups.has(d.category)) groups.set(d.category, []); groups.get(d.category).push(d); }
      results.innerHTML = [...groups].map(([cat, ds]) => groupHtml(LABEL_FOR.get(cat) || cat, ds)).join('') ||
        '<p class="picker-more">Nothing available.</p>';
      return;
    }
    const r = groupQuery(query, { docs: pool });
    results.innerHTML = r.groups.length
      ? r.groups.map((g) => groupHtml(g.label, rankDocs(g.items, rank))).join('')
      : `<p class="picker-more">No matches for <code>${esc(query)}</code>.</p>`;
  }

  input.addEventListener('input', () => render(input.value));
  current.addEventListener('click', (e) => {
    if (e.target.closest('.picker-scrim') || e.target.closest('.picker-close')) { closePicker(); return; }
    const row = e.target.closest('[data-pick-slug]');
    if (!row) return;
    const doc = byKey.get(`${row.getAttribute('data-pick-category')}:${row.getAttribute('data-pick-slug')}`);
    closePicker();
    if (doc) onPick(doc);
  });
  render('');
  input.focus();
}
```

- [ ] **Step 2: CSS** — append to `public/css/builds.css`:

```css
/* Picker overlay (z above build-menu 130/131, below header search 200). */
.picker-overlay .picker-scrim { position: fixed; inset: 0; z-index: 140; background: rgb(0 0 0 / .6); }
.picker-panel { position: fixed; z-index: 141; inset: 8vh auto auto 50%; transform: translateX(-50%);
  width: min(34rem, calc(100vw - 2rem)); max-height: 80vh; display: flex; flex-direction: column;
  background: var(--card-bg, #14130f); border: 1px solid var(--card-border, #3a352a); border-radius: 8px; }
.picker-head { display: flex; justify-content: space-between; align-items: center; padding: .6rem 1rem; }
.picker-close { background: none; border: 0; color: inherit; font-size: 1.2rem; cursor: pointer; }
.picker-input { margin: 0 1rem .6rem; padding: .5rem .7rem; font: inherit; color: inherit;
  background: rgb(0 0 0 / .35); border: 1px solid var(--card-border, #3a352a); border-radius: 5px; }
.picker-results { overflow-y: auto; padding: 0 .6rem .8rem; }
.picker-group h3 { display: flex; justify-content: space-between; padding: .5rem .4rem .2rem;
  font-size: .8rem; text-transform: uppercase; letter-spacing: .06em; opacity: .7; }
.picker-row { display: flex; align-items: center; gap: .55rem; width: 100%; text-align: left;
  padding: .4rem .5rem; background: none; border: 0; color: inherit; font: inherit; cursor: pointer; border-radius: 4px; }
.picker-row:hover, .picker-row:focus-visible { background: rgb(255 255 255 / .08); }
.picker-row__icon { width: 1.6rem; height: 1.6rem; flex: none; object-fit: contain; }
.picker-row__name { flex: none; }
.picker-row__hint { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; opacity: .55; font-size: .85em; }
.picker-more { padding: .3rem .5rem; opacity: .6; font-size: .85em; }
```

- [ ] **Step 3: Verify** — `node --check public/js/entity-picker.js && npm test 2>&1 | tail -3`.

- [ ] **Step 4: Commit**

```bash
git add public/js/entity-picker.js public/css/builds.css
git commit -m "feat(planner): reusable entity picker overlay for the editor"
```

---

### Task 6: build-editor controller + builds-page integration

**Files:**
- Create: `public/js/build-editor.js`
- Modify: `public/js/builds-page.js`, `public/js/build-host.js`, `views/builds.njk`
- Test: `test/server.test.js` (script tags on the shell)

**Interfaces:**
- Consumes: everything above. `build-host.js` gains `safeWrite(fn)`:

```js
import { createStore, STORE_KEY, StoreWriteError } from '/static/js/build-store.js';
// … existing getStore …
/** Run a store mutation; alert (instead of throwing) on quota failure. */
export function safeWrite(fn) {
  try { return fn(); }
  catch (e) {
    if (e instanceof StoreWriteError) { window.alert("Couldn't save — browser storage is full."); return null; }
    throw e;
  }
}
```

(Refactor builds-page.js's local `reportWriteError` usage to import `safeWrite` — one shared copy.)
- Produces: `mountEditor(container, buildId, deps)` from `build-editor.js` where `deps = { store, planner, docs, resolveRef }`; returns an `unmount()` function. builds-page owns fetching both artifacts and (re)mounting.

- [ ] **Step 1: Failing test** — append to `test/server.test.js`:

```js
test('/builds shell loads the editor modules', async () => {
  const app = createApp();
  const res = await request(app).get('/builds');
  assert.ok(res.text.includes('/static/js/build-editor.js') || res.text.includes('builds-page.js'),
    'editor reachable from shell');
  assert.ok(res.text.includes('/static/css/planner-art.css'));
});
```

Run: `node --test test/server.test.js 2>&1 | tail -6` — FAIL on planner-art.css.

- [ ] **Step 2: Shell** — `views/builds.njk` styles block becomes:

```njk
{% block styles %}<link rel="stylesheet" href="/static/css/builds.css">
<link rel="stylesheet" href="/static/css/planner-art.css">{% endblock %}
```

(`builds-page.js` imports the editor module, so no extra script tag is needed — ESM imports resolve at load.)

- [ ] **Step 3: Implement `public/js/build-editor.js`:**

```js
// Browser controller for the /builds editor view. Pure rendering lives in
// editor-render.js; this file owns event wiring and store mutations.
import { renderEditor, grantedRows } from '/static/js/editor-render.js';
import { openPicker, closePicker } from '/static/js/entity-picker.js';
import { legalSlots } from '/static/js/build-rules.js';
import { safeWrite } from '/static/js/build-host.js';

const KIND_FOR_CATEGORY = { gem: 'gem', support: 'gem', spirit: 'gem', unique: 'unique', base: 'base' };

export function mountEditor(container, buildId, { store, planner, docs, resolveRef }) {
  let weaponSet = 1;

  const build = () => store.get(buildId);
  const patch = (p) => safeWrite(() => store.update(buildId, p));
  const render = () => {
    const b = build();
    if (!b) { location.hash = ''; return; }
    container.innerHTML = renderEditor(b, { planner, resolveRef, weaponSet });
  };

  function equip(slotId, ref) {
    const b = build();
    const gear = { ...b.gear };
    const prev = gear[slotId]?.item;
    gear[slotId] = { item: ref, wishlist: gear[slotId]?.wishlist ?? [] };
    const unassigned = b.unassigned.filter((r) => !(r.kind === ref.kind && r.slug === ref.slug));
    if (prev) unassigned.push(prev);
    patch({ gear, unassigned });
  }
  // …
}
```

```js
  // ---- picker launches -----------------------------------------------
  function pickForSlot(slotId) {
    const legal = new Set(Object.entries(planner.items)
      .filter(([, rec]) => rec.slots.includes(slotId)).map(([slug]) => slug));
    openPicker({
      title: `Choose an item — ${planner.slots.find((s) => s.id === slotId)?.name ?? slotId}`,
      docs: docs.filter((d) => legal.has(d.slug)),
      categories: ['unique', 'base'],
      onPick: (doc) => equip(slotId, { kind: KIND_FOR_CATEGORY[doc.category], slug: doc.slug }),
    });
  }

  function pickGem(onPick) {
    openPicker({ title: 'Choose a skill', docs, categories: ['gem', 'spirit'], onPick });
  }

  function pickSupport(forGemSlug, onPick) {
    openPicker({
      title: 'Choose a support', docs, categories: ['support'],
      rank: planner.recommends?.[forGemSlug] ?? [],
      onPick,
    });
  }

  // ---- socket helpers --------------------------------------------------
  function parseSocket(attr) {  // "s:<i>:<j>" or "g:<itemSlug>:<skillSlug>:<j>"
    const parts = attr.split(':');
    if (parts[0] === 's') return { kind: 's', setup: Number(parts[1]), j: Number(parts[2]) };
    return { kind: 'g', key: parts.slice(1, -1).join(':'), j: Number(parts.at(-1)) };
  }

  function setSocket(sock, supRef) {   // supRef {slug} or null to clear
    const b = build();
    if (sock.kind === 's') {
      const skills = b.skills.map((s, i) => {
        if (i !== sock.setup) return s;
        const supports = [...s.supports];
        if (supRef) supports[sock.j] = supRef; else supports.splice(sock.j, 1);
        return { ...s, supports: supports.filter(Boolean) };
      });
      patch({ skills });
    } else {
      const all = { ...(b.grantedSupports ?? {}) };
      const list = [...(all[sock.key] ?? [])];
      if (supRef) list[sock.j] = supRef; else list.splice(sock.j, 1);
      all[sock.key] = list.filter(Boolean);
      patch({ grantedSupports: all });
    }
  }

  function gemForSocket(sock) {
    const b = build();
    return sock.kind === 's' ? b.skills[sock.setup]?.gem.slug : sock.key.split(':').at(-1);
  }

  // ---- delegated events ------------------------------------------------
  function onClick(e) {
    const attr = (n) => e.target.closest(`[${n}]`)?.getAttribute(n);

    const clear = attr('data-slot-clear');
    if (clear) {
      e.stopPropagation();
      const b = build();
      const item = b.gear[clear]?.item;
      if (item) patch({ gear: { ...b.gear, [clear]: { ...b.gear[clear], item: null } },
                        unassigned: [...b.unassigned, item] });
      return;
    }
    const slot = e.target.closest('[data-slot-id]');
    if (slot) { pickForSlot(slot.getAttribute('data-slot-id')); return; }

    const ws = attr('data-weapon-set');
    if (ws) { weaponSet = Number(ws); render(); return; }

    const equipIdx = attr('data-tray-equip');
    if (equipIdx !== null && equipIdx !== undefined) {
      const b = build();
      const ref = b.unassigned[Number(equipIdx)];
      if (!ref) return;
      if (ref.kind === 'gem') {   // gems become skill setups, not gear
        patch({ skills: [...b.skills, { gem: { slug: ref.slug }, level: null, supports: [] }],
                unassigned: b.unassigned.filter((_, i) => i !== Number(equipIdx)) });
        return;
      }
      const slots = legalSlots(ref, planner);
      if (!slots.length) return;
      const target = slots.find((s) => !build().gear[s]?.item) ?? slots[0];
      equip(target, ref);   // equip() re-adds any displaced item to the tray
      return;
    }
    const removeIdx = attr('data-tray-remove');
    if (removeIdx !== null && removeIdx !== undefined) {
      const b = build();
      patch({ unassigned: b.unassigned.filter((_, i) => i !== Number(removeIdx)) });
      return;
    }

    if (e.target.closest('[data-setup-add]')) {
      pickGem((doc) => patch({ skills: [...build().skills, { gem: { slug: doc.slug }, level: null, supports: [] }] }));
      return;
    }
    const gw = attr('data-gem-well');
    if (gw !== null && gw !== undefined) {
      pickGem((doc) => patch({ skills: build().skills.map((s, i) =>
        i === Number(gw) ? { ...s, gem: { slug: doc.slug } } : s) }));
      return;
    }
    const rm = attr('data-setup-remove');
    if (rm !== null && rm !== undefined) {
      patch({ skills: build().skills.filter((_, i) => i !== Number(rm)) });
      return;
    }
    const mv = attr('data-setup-move');
    if (mv) {
      const [iStr, dir] = mv.split(':');
      const i = Number(iStr), to = dir === 'up' ? i - 1 : i + 1;
      const skills = [...build().skills];
      if (to < 0 || to >= skills.length) return;
      [skills[i], skills[to]] = [skills[to], skills[i]];
      patch({ skills });
      return;
    }
    const sc = attr('data-socket-clear');
    if (sc) { e.stopPropagation(); setSocket(parseSocket(sc), null); return; }
    const so = attr('data-socket');
    if (so) {
      const sock = parseSocket(so);
      pickSupport(gemForSocket(sock), (doc) => setSocket(sock, { slug: doc.slug }));
    }
  }

  function onChange(e) {
    const lvl = e.target.closest('[data-setup-level]');
    if (lvl) {
      const i = Number(lvl.getAttribute('data-setup-level'));
      const v = lvl.value === '' ? null : Math.max(1, Math.min(40, Number(lvl.value) || 1));
      patch({ skills: build().skills.map((s, idx) => idx === i ? { ...s, level: v } : s) });
      return;
    }
    if (e.target.closest('[data-notes]')) patch({ notes: e.target.value });
  }

  container.addEventListener('click', onClick);
  container.addEventListener('change', onChange);
  const unsub = store.subscribe(() => render());
  render();

  return function unmount() {
    container.removeEventListener('click', onClick);
    container.removeEventListener('change', onChange);
    unsub();
    closePicker();
  };
}
```

**Note:** delete the stray first `pickForSlot` sketch (the one ending in comments) — only the pre-filtered version ships. `grantedRows` import is used indirectly if you add per-row logic; drop the import if unused (no dead imports).

- [ ] **Step 4: Integrate in `public/js/builds-page.js`:**

Add imports and a planner loader alongside `loadDocs()` (same memo + rejection-reset pattern):

```js
import { mountEditor } from '/static/js/build-editor.js';
import { safeWrite } from '/static/js/build-host.js';

let planner = null, plannerLoading = null;
function loadPlanner() {
  if (planner) return Promise.resolve(planner);
  plannerLoading ??= fetch('/static/generated/planner-data.json')
    .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
    .then((p) => { planner = p; return p; })
    .catch((e) => { plannerLoading = null; throw e; });
  return plannerLoading;
}
```

In `render()`, the `route.view === 'build'` branch becomes: render the read-only `renderBuild` immediately as the loading state, then `Promise.all([loadDocs(), loadPlanner()])` → if the hash still points at this build id, unmount any previous editor and `activeUnmount = mountEditor(view, route.id, { store, planner, docs: docsArray, resolveRef })`. Keep a module-level `activeUnmount` and call it at the top of every `render()` (all views), so navigating away tears down editor listeners. `docsArray` = keep a reference to the raw docs array when `loadDocs()` builds `docsByKey` (store both). Extend `resolveRef`'s return to include `cardUrl: d.cardUrl ?? null` — editor-render's `itemChip` emits it as `data-card-url` so the existing global card-tooltip harness shows the full item card on hover (4b spec's "item card popup"). On planner/docs load failure, keep the read-only view and show a one-line retry notice (re-render on next hashchange retries the fetch). Replace the local `reportWriteError` helper with the shared `safeWrite` import.

The `store.subscribe(() => render())` in builds-page must NOT double-render the editor (the editor subscribes itself): in the subscribe callback, skip when the current route is a mounted build view (`if (activeUnmount && parseRoute(location.hash).view === 'build') return;`).

- [ ] **Step 5: Verify** — `node --check` all three modified/created JS files; `npm test 2>&1 | tail -3`; dev-server smoke: `/builds` 200 with both stylesheets; then a hand check in a real browser if available (full behavioral gate is Task 8).

- [ ] **Step 6: Commit**

```bash
git add public/js/build-editor.js public/js/builds-page.js public/js/build-host.js views/builds.njk test/server.test.js
git commit -m "feat(planner): build editor controller wired into /builds"
```

---

### Task 7: paper-doll + skill panel CSS (in-game art)

**Files:**
- Modify: `public/css/builds.css`
- Test: visual — puppeteer screenshots reviewed by the controller (no unit surface)

**Layout contract** (from planner-data slot ids): CSS grid with named areas; weapon wells are tall (2 rows), doll center column holds helmet/body/gloves-boots row/belt; amulet + rings flank; flasks/charm bottom row. The active weapon set renders in the `wa`/`wb` areas (editor-render only emits the active set's wells).

- [ ] **Step 1: Implement** — append to `public/css/builds.css`:

```css
/* ---- Editor: paper-doll ---- */
.editor-section-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: .6rem; }
.editor-gear { padding: 1rem; }
.editor-doll {
  display: grid; gap: .4rem; justify-content: center;
  grid-template-areas:
    "wa amulet helmet ring1 wb"
    "wa gloves body   boots wb"
    "wa .      belt   .     wb"
    "flask1 flask2 charm1 . ."
    "tray tray tray tray tray";
  grid-template-columns: 5.2rem 4rem 4.6rem 4rem 5.2rem;
}
.editor-slot { position: relative; min-height: 4rem; display: flex; align-items: center; justify-content: center;
  cursor: pointer; text-align: center; }
.editor-slot--weapon1a, .editor-slot--weapon2a { grid-area: wa; min-height: 10rem; }
.editor-slot--weapon1b, .editor-slot--weapon2b { grid-area: wb; min-height: 10rem; }
.editor-slot--helmet { grid-area: helmet; } .editor-slot--body { grid-area: body; min-height: 6rem; }
.editor-slot--gloves { grid-area: gloves; } .editor-slot--boots { grid-area: boots; }
.editor-slot--belt { grid-area: belt; } .editor-slot--amulet { grid-area: amulet; }
.editor-slot--ring1 { grid-area: ring1; } .editor-slot--ring2 { grid-area: ring1; margin-top: 4.4rem; }
.editor-slot--ring1.planner-slot-well, .editor-slot--ring2.planner-slot-well { background-image: none; }
.editor-slot--flask1 { grid-area: flask1; } .editor-slot--flask2 { grid-area: flask2; }
.editor-slot--charm1 { grid-area: charm1; }
.editor-slot__hint { font-size: .7rem; opacity: .55; pointer-events: none; }
.editor-slot__ghost { font-size: .7rem; opacity: .4; font-style: italic; }
.editor-slot__clear { position: absolute; top: 2px; right: 2px; background: rgb(0 0 0 / .55);
  border: 0; color: inherit; border-radius: 3px; cursor: pointer; line-height: 1; }
.editor-slot--violation { outline: 1px solid #a33; }
.editor-item { display: flex; flex-direction: column; align-items: center; gap: .2rem; min-width: 0; }
.editor-item__icon { max-width: 3rem; max-height: 3.4rem; object-fit: contain; }
.editor-item__name { font-size: .68rem; line-height: 1.15; overflow-wrap: anywhere; }
.editor-item__name--unique { color: #af6025; }
.editor-set-toggle { display: flex; gap: .3rem; }
.editor-set-btn { font: inherit; font-size: .8rem; padding: .25rem .6rem; cursor: pointer;
  background: rgb(255 255 255 / .06); border: 1px solid var(--card-border, #3a352a); color: inherit; border-radius: 4px; }
.editor-set-btn.is-active { background: rgb(255 255 255 / .16); }
.editor-warnings { margin: .6rem 0 0; padding-left: 1.2rem; color: #d9a24a; font-size: .85rem; }
.editor-tray { grid-area: tray; margin-top: .8rem; }
.editor-tray__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: .25rem; }
.editor-tray__row { display: flex; align-items: center; justify-content: space-between; gap: .5rem;
  padding: .3rem .5rem; background: rgb(0 0 0 / .25); border-radius: 4px; }
.editor-tray__row .editor-item { flex-direction: row; }
.editor-tray__actions button { font: inherit; font-size: .8rem; background: none; border: 1px solid var(--card-border, #3a352a);
  color: inherit; border-radius: 4px; padding: .15rem .5rem; cursor: pointer; }
.editor-none { opacity: .55; }

/* ---- Editor: skill panel ---- */
.editor-skills { margin-top: 1.2rem; padding: 1rem; }
.editor-setups { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: .6rem; }
.editor-setup { display: flex; align-items: center; flex-wrap: wrap; gap: .6rem; padding: .55rem .8rem; }
.editor-setup--spirit { box-shadow: inset 0 0 0 1px rgb(180 160 255 / .35); }
.editor-setup__gem { width: 3rem; height: 3rem; display: flex; align-items: center; justify-content: center; cursor: pointer; }
.editor-setup__gem .editor-item__name { display: none; }
.editor-setup__gem + .editor-setup__source, .editor-setup__source { font-size: .78rem; opacity: .75; }
.editor-setup__level input { width: 3.2rem; background: transparent; border: 0; color: inherit; font: inherit; text-align: center; }
.editor-setup__sockets { display: flex; gap: .35rem; margin-left: auto; }
.editor-socket { position: relative; width: 1.9rem; height: 1.9rem; display: inline-block; cursor: pointer; }
.editor-socket__clear { position: absolute; top: -6px; right: -6px; display: none; background: rgb(0 0 0 / .7);
  border: 0; color: inherit; border-radius: 50%; width: 1rem; height: 1rem; line-height: 1; font-size: .7rem; cursor: pointer; }
.editor-socket:hover .editor-socket__clear, .editor-socket:focus-within .editor-socket__clear { display: block; }
.editor-setup__controls { display: flex; gap: .25rem; }
.editor-setup__controls button { font: inherit; background: none; border: 1px solid var(--card-border, #3a352a);
  color: inherit; border-radius: 4px; cursor: pointer; padding: .1rem .45rem; }
.editor-setup__warning { flex-basis: 100%; margin: 0; color: #d9a24a; font-size: .8rem; }
.editor-setup-add { font: inherit; padding: .3rem .8rem; cursor: pointer;
  background: rgb(255 255 255 / .08); border: 1px solid var(--card-border, #3a352a); color: inherit; border-radius: 4px; }
.editor-tree, .editor-notes { margin-top: 1.2rem; }
.editor-notes textarea { width: 100%; font: inherit; color: inherit; background: rgb(0 0 0 / .3);
  border: 1px solid var(--card-border, #3a352a); border-radius: 5px; padding: .5rem .7rem; }

@media (max-width: 720px) {
  .editor-doll { grid-template-columns: 4rem 3.2rem 3.8rem 3.2rem 4rem; gap: .3rem; }
  .editor-setup__sockets { margin-left: 0; flex-basis: 100%; }
}
```

(The ring2 overlap hack above is a first pass — adjust grid areas during the screenshot loop; the acceptance bar is "recognizably the in-game inventory layout", not pixel parity. If ring stacking fights the grid, give rings their own two-row area column.)

- [ ] **Step 2: Screenshot loop** — with `npm run dev` running and a seeded build (create via UI or console `store.create(...)`), take puppeteer screenshots of `/builds#/b/<id>` at 1280×900 and 390×844, save to the scratchpad, and iterate the CSS until: paper-doll reads as the in-game inventory (weapons flanking, center column, flasks row), slot art visible (`.planner-slot-well` texture), skill rows show frame art + socket rings. The executing controller reviews the screenshots.

- [ ] **Step 3: Verify + commit**

Run: `npm test 2>&1 | tail -3` (CSS-only, must stay green).

```bash
git add public/css/builds.css
git commit -m "style(planner): paper-doll and skill panel layout with in-game art"
```

---

### Task 8: static acceptance pass + roadmap tick

**Files:**
- Modify: `docs/superpowers/specs/2026-07-06-build-planner-roadmap.md` (tick 4b)

- [ ] **Step 1:** `npm run build:static 2>&1 | tail -10` — completes, zero dead links; `dist/builds.html` exists; `dist/static/generated/planner-data.json` contains `"granted"`.
- [ ] **Step 2:** Serve `dist/` and verify with puppeteer (desktop 1280×900 AND mobile 390×844), all against the static output:
  - [ ] Full 4b acceptance loop: create build → Add-to-Build a unique from /uniques → open editor → item sits in tray → Equip places it (legal slot) → click empty helmet → picker shows only helmet-legal items → pick one → renders in well with icon.
  - [ ] Two-hander: equip a two-handed weapon → off-hand ghosts; force an off-hand item → warning renders, nothing blocks.
  - [ ] Weapon set toggle switches wells and preserves both sets' gear.
  - [ ] Skill setup: Add skill → picker (gem+spirit only) → pick → socket click → support picker with recommended supports ranked first → fill 2 sockets → duplicate support across setups shows inline warning → level stepper persists.
  - [ ] Granted row: equip a granting unique (use `planner.granted` keys from Task 1 to find one) → non-removable "from <item>" row appears with sockets; socketing a support into it persists (reload) and survives unequip/re-equip; unequip removes the row.
  - [ ] Notes edit persists across reload. Everything above persists across reload.
  - [ ] Import preview (`#/import/<code>`) still renders read-only; "Save a copy" then opens the editor.
  - [ ] Zero console errors on the editor across the whole flow.
- [ ] **Step 3:** Tick `Phase 4b` in the roadmap status checklist with the final commit sha; commit:

```bash
git add docs/superpowers/specs/2026-07-06-build-planner-roadmap.md
git commit -m "docs(planner): Phase 4b complete — build editor"
```

**Deliberately NOT in this phase:** mod picker / mod-pools.json (4c), tree embed + Notable Priority (5), share/export UX beyond what 4a shipped (8), light math beyond build-rules warnings (7).
