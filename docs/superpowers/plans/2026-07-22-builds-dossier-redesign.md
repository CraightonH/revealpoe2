# Builds Editor "Dossier" Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the in-game-art build editor with the owner-approved "Dossier" design: a scrolling four-chapter sheet (Gear / Skills / Passive Tree / Notes) with a sticky section rail, spatial-but-abstracted gear doll, skill constellation chains with real gem icons, a share-link button front and center, and a new Description field.

**Architecture:** All markup changes live in the pure renderers (`editor-render.js`, `builds-render.js`) and `builds.css`; wiring changes in `build-editor.js` / `builds-page.js`. The store gains one field (`description`). No graph/build-artifact changes. The in-game textures (`planner-art.css`) stop being referenced by the editor but the file itself is untouched (it remains the image-ingestion trigger; pruning is a separate decision).

**Tech Stack:** Vanilla ES modules (node:test-tested pure renderers), plain CSS on `tokens.css` custom properties, existing global card-tooltip harness (`data-card-url`), existing share codec (`build-code.js`) and passive codec (`passive-code.js`).

**Design source:** Owner-approved mockup (Concept B "The Dossier", artifact c43f47d1) with amendments from the 2026-07-22 review:
1. Gear uses the **in-game spatial arrangement** (owner's screenshot spec below) but **no PoE2 artwork**.
2. Skills: **no level control** (schema keeps `level`; UI drops it everywhere).
3. Skill/support nodes render the **real gem icons** with hover tooltips.
4. Keep the granted-by callout, the Checks card, the tree summary, the left rail, share front-and-center.
5. **Add `description`** (short, at top under the title); **keep Notes** at the bottom.

**Gear doll spatial spec (owner, from in-game screenshot):** weapons tall on either side; helmet top-center slightly above the weapon tops; body directly under helmet; amulet between helmet and body on the RIGHT; rings at body's vertical middle on either side; belt directly under body; gloves (left) and boots (right) bottom-aligned with belt's bottom; life flask centered under gloves; mana flask centered under boots; charm between the flasks.

## Global Constraints

- Pure static site: no SSR, no backend; all state in localStorage via `build-store.js`.
- Pure-core pattern: renderers stay DOM/fetch/window-free and node-testable.
- Fidelity zone untouched: `.newItemPopup` tooltip internals and the passive tree are NOT modified.
- All colors route through `tokens.css` custom properties (no new hardcoded palette literals except derived alphas via `color-mix`).
- Keep every existing `data-*` interaction hook name: `data-slot-id`, `data-slot-clear`, `data-weapon-set`, `data-tray-equip`, `data-tray-remove`, `data-setup-add`, `data-gem-well`, `data-setup-remove`, `data-setup-move`, `data-socket`, `data-socket-clear`, `data-notes`. New hooks: `data-description`, `data-share`, `data-tree-code`, `data-rail-link`.
- `data-setup-level` is REMOVED (renderer + `build-editor.js` handler). The `level` field stays in the schema/codec for back-compat.
- Keep `npm test` green (284+ cases). No `Co-Authored-By` lines in commits.
- Branch: `planner/phase-4a-builds-pages` (current planner feature branch).
- Known bug fixed en route: `planner-data.json` gem `color` values are `r/g/b/w` single letters; the old `SOCKET_COLORS` set expected full names so all filled sockets rendered white. New color mapping accepts both.

## File Structure

- Modify: `public/js/build-store.js` — `description` field + validation.
- Modify: `public/js/builds-render.js` — export `classLine`; viewer drops "Lv", gains description.
- Rewrite: `public/js/editor-render.js` — dossier renderers (same exported API + new `initials`, `treeSummary`).
- Modify: `public/js/build-editor.js` — remove level handler; add description/tree-code/share handlers + rail scroll-spy.
- Modify: `public/js/builds-page.js` — toggle `builds-page--editing` root class per route.
- Rewrite (editor sections only): `public/css/builds.css` — picker + list/viewer styles stay; editor styles replaced.
- Modify: `views/builds.njk` — drop the `planner-art.css` link.
- Modify tests: `test/build-store.test.js`, `test/buildsRender.test.js`, `test/editorRender.test.js`.
- Docs: `docs/superpowers/specs/2026-07-06-build-planner-roadmap.md` (UI-fidelity amendment), `docs/superpowers/specs/2026-07-17-ui-redesign-direction.md` (builds-page decision).

---

### Task 1: `description` field in the build store

**Files:**
- Modify: `public/js/build-store.js`
- Test: `test/build-store.test.js`

**Interfaces:**
- Produces: `emptyBuild()` result includes `description: ''`; `validateBuild` accepts `description` string or undefined (old builds), rejects other types. Codec (`build-code.js`) needs no change — canonical form passes unknown/extra fields through.

- [x] **Step 1: Write the failing tests** — append to `test/build-store.test.js`:

```js
test('emptyBuild: includes empty description', () => {
  assert.equal(emptyBuild({ now: () => 1, uuid: () => 'x' }).description, '');
});

test('validateBuild: description optional but must be a string', () => {
  const base = emptyBuild({ now: () => 1, uuid: () => 'x' });
  assert.equal(validateBuild(base).ok, true);
  const { description, ...legacy } = base;
  assert.equal(validateBuild(legacy).ok, true, 'pre-description builds still validate');
  assert.equal(validateBuild({ ...base, description: 5 }).ok, false);
});
```

- [x] **Step 2: Run to verify failure** — `npm test -- --test-name-pattern="description"` → FAIL (`description` undefined).
- [x] **Step 3: Implement** — in `emptyBuild`, after `notes: ''` add `description: '',`. In `validateBuild`, after the notes check add:

```js
  if (b.description !== undefined && !isStr(b.description)) errors.push('description: expected string');
```

- [x] **Step 4: Run tests** — `npm test` → PASS (build-code round-trip tests keep passing; codec passes the field through).
- [x] **Step 5: Commit** — `git add public/js/build-store.js test/build-store.test.js && git commit -m "feat(planner): add build description field"`

---

### Task 2: viewer renderer — drop levels, show description, export `classLine`

**Files:**
- Modify: `public/js/builds-render.js`
- Test: `test/buildsRender.test.js`

**Interfaces:**
- Produces: `export const classLine = (b) => ...` (moved from module-private; same behavior) — consumed by Task 5's header. Viewer `sections()` renders `b.description` in a `builds-desc` paragraph and no longer renders `builds-setup__level`.

- [x] **Step 1: Write failing tests** — in `test/buildsRender.test.js` add (and delete any existing assertion expecting `Lv`/`builds-setup__level` if present):

```js
test('renderBuild: shows description, never a skill level', () => {
  const b = emptyBuild({ now: () => 1, uuid: () => 'x',
    description: 'Lightning bows.',
    skills: [{ gem: { slug: 'spark' }, level: 12, supports: [] }] });
  const html = renderBuild(b, () => null);
  assert.match(html, /builds-desc/);
  assert.ok(html.includes('Lightning bows.'));
  assert.ok(!/Lv 12/.test(html), 'levels are not surfaced');
});
```

- [x] **Step 2: Run to verify failure** — `node --test test/buildsRender.test.js` → FAIL.
- [x] **Step 3: Implement** — in `builds-render.js`: change `const classLine` to `export const classLine`; in `sections()` delete the `lvl` const and its interpolation; in the returned array insert after the opening (before Gear): `b.description ? sec('Description', `<p class="builds-desc">${esc(b.description)}</p>`) : '',`.
- [x] **Step 4: Run** — `node --test test/buildsRender.test.js` → PASS.
- [x] **Step 5: Commit** — `git commit -am "feat(planner): viewer shows description, drops skill levels"`

---

### Task 3: editor renderer — gear chapter (doll + checks + tray)

**Files:**
- Modify: `public/js/editor-render.js`
- Test: `test/editorRender.test.js`

**Interfaces:**
- Consumes: `gearViolations(build, planner)` (unchanged), `resolveRef(ref) -> {name, iconUrl, url, cardUrl}`.
- Produces: `renderGear(build, ctx)` emitting `<section id="gear">` with `.editor-doll` wells (`.editor-slot--<slotId>` grid-area classes, states `is-empty|is-filled|is-unique|is-ghost`), a Checks card (`.editor-checks` — violations `is-warn`, empty slots `is-info`), the Unassigned tray card. New helpers exported: `initials(name)`. All Task-list `data-*` hooks preserved.

- [x] **Step 1: Update tests** — in `test/editorRender.test.js` replace the two assertions tied to old art classes and add `initials` coverage:
  - In the two-hander test: `assert.match(html, /editor-checks/)` replaces `/editor-warnings/` (keep `/editor-slot--violation/`); ghost assertion stays `editor-slot__ghost`.
  - Add:

```js
test('initials: two-word cap, safe on empties', () => {
  assert.equal(initials('Lightning Arrow'), 'LA');
  assert.equal(initials('Pin'), 'P');
  assert.equal(initials(''), '?');
});

test('renderGear: checks card lists empty slots as info lines', () => {
  const html = renderGear(fixed(), ctx);
  assert.match(html, /editor-checks/);
  assert.match(html, /is-info/);
});
```

- [x] **Step 2: Run to verify failure** — `node --test test/editorRender.test.js` → FAIL.
- [x] **Step 3: Implement** — rewrite the gear half of `editor-render.js` (final full-file shape lands across Tasks 3–5):

```js
import { esc } from './builds-render.js';
import { gearViolations, setupViolations } from './build-rules.js';

export { esc };

export function rankDocs(docs, rankedSlugs) { /* unchanged */ }

/** "Lightning Arrow" -> "LA" — deterministic icon-fallback initials. */
export function initials(name) {
  const words = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  return words.length ? words.slice(0, 2).map((w) => w[0].toUpperCase()).join('') : '?';
}

/** Icon tile: real art when the doc has one, initials always underneath. */
function tile(doc, name, cls) {
  const img = doc.iconUrl
    ? `<img class="${cls}__img" src="${esc(doc.iconUrl)}" alt="" loading="lazy" onerror="this.remove()">`
    : '';
  return `<span class="${cls}" aria-hidden="true"><span class="${cls}__initials">${esc(initials(name))}</span>${img}</span>`;
}

function wellBody(ref, resolveRef) {
  const doc = resolveRef(ref) || {};
  const name = doc.name || ref.slug;
  const card = doc.cardUrl ? ` data-card-url="${esc(doc.cardUrl)}"` : '';
  return `<span class="editor-item"${card}>${tile(doc, name, 'well-tile')}` +
    `<span class="editor-item__name editor-item__name--${esc(ref.kind)}">${esc(name)}</span></span>`;
}

export function renderGear(build, ctx) {
  const { planner, resolveRef, weaponSet } = ctx;
  const violations = gearViolations(build, planner);
  const bySlot = new Map(violations.filter((v) => v.slotId).map((v) => [v.slotId, v]));
  const visible = planner.slots.filter((s) => !s.group || s.group === `weaponset${weaponSet}`);
  const mainhand = build.gear[`weapon${weaponSet}a`]?.item;
  const mainTwoHanded = mainhand && planner.items[mainhand.slug]?.twoHanded;
  const ghosted = (s) => s.id === `weapon${weaponSet}b` && mainTwoHanded && !build.gear[s.id]?.item;

  const wells = visible.map((s) => {
    const g = build.gear[s.id];
    const violation = bySlot.get(s.id);
    let body, state;
    if (g?.item) {
      state = g.item.kind === 'unique' ? 'is-unique' : 'is-filled';
      body = `<span class="editor-slot__label">${esc(s.name)}</span>` + wellBody(g.item, resolveRef) +
        `<button class="editor-slot__clear" type="button" data-slot-clear="${esc(s.id)}" aria-label="Unequip ${esc(s.name)}">×</button>`;
    } else if (ghosted(s)) {
      state = 'is-ghost';
      body = `<span class="editor-slot__label">${esc(s.name)}</span><span class="editor-slot__ghost">two-handed</span>`;
    } else {
      state = 'is-empty';
      body = `<span class="editor-slot__hint">＋ ${esc(s.name)}</span>`;
    }
    return `<div class="editor-slot editor-slot--${esc(s.id)} ${state}${violation ? ' editor-slot--violation' : ''}"` +
      ` data-slot-id="${esc(s.id)}" role="button" tabindex="0" aria-label="${esc(s.name)}"` +
      `${violation ? ` title="${esc(violation.message)}"` : ''}>${body}</div>`;
  }).join('');

  const toggle = [1, 2].map((n) =>
    `<button class="editor-set-btn${n === weaponSet ? ' is-active' : ''}" type="button" data-weapon-set="${n}"` +
    ` aria-pressed="${n === weaponSet}">Set ${n === 1 ? 'I' : 'II'}</button>`).join('');

  const checks = [
    ...violations.map((v) => ({ tone: 'is-warn', text: v.message })),
    ...visible.filter((s) => !build.gear[s.id]?.item && !ghosted(s))
      .map((s) => ({ tone: 'is-info', text: `${s.name} is empty.` })),
  ];
  const checksHtml = checks.length
    ? `<ul class="editor-checks">${checks.map((c) => `<li class="${c.tone}">${esc(c.text)}</li>`).join('')}</ul>`
    : '<p class="editor-checks editor-checks--clear">Everything checks out.</p>';

  const tray = build.unassigned.map((ref, i) =>
    `<li class="editor-tray__row">${wellBody(ref, resolveRef)}` +
    `<span class="editor-tray__actions">` +
    `<button type="button" data-tray-equip="${i}">Equip</button>` +
    `<button type="button" data-tray-remove="${i}" aria-label="Remove from build">×</button>` +
    `</span></li>`).join('');

  return `<section class="editor-chapter editor-gear" id="gear" aria-labelledby="gear-h">
    <header class="chapter-head"><h2 id="gear-h">Gear</h2><span class="chapter-rule"></span>
      <div class="editor-set-toggle" role="group" aria-label="Weapon set">${toggle}</div></header>
    <div class="editor-gear-layout">
      <div class="editor-doll-board"><div class="editor-doll">${wells}</div></div>
      <div class="editor-gear-side">
        <div class="editor-side-card"><h3>Checks</h3>${checksHtml}</div>
        <div class="editor-side-card"><h3>Unassigned — added from the wiki</h3>
          ${tray ? `<ul class="editor-tray__list">${tray}</ul>` : '<p class="editor-none">Nothing waiting. Use “Add to build” on any card.</p>'}</div>
      </div>
    </div></section>`;
}
```

  Note: the old `itemChip` is replaced by `wellBody`/`tile`; Task 4 reuses them. Delete the old `planner-slot-well` / `planner-area-frame` class emissions entirely.
- [x] **Step 4: Run** — `node --test test/editorRender.test.js` → gear tests PASS (skills tests still pass because Task 4 hasn't changed them yet; if any old assertion references removed art classes in gear, they were updated in Step 1).
- [x] **Step 5: Commit** — `git commit -am "feat(planner): dossier gear chapter — abstract doll, checks card, tray"`

---

### Task 4: editor renderer — skill constellation chains

**Files:**
- Modify: `public/js/editor-render.js`
- Test: `test/editorRender.test.js`

**Interfaces:**
- Consumes: `tile()`/`wellBody()` from Task 3, `setupViolations`, `grantedRows` (logic unchanged).
- Produces: `renderSkills(build, ctx)` emitting `<section id="skills">` of `.editor-chain` rows: gem orb (`data-gem-well` when removable, `data-card-url` for tooltip), support orbs `.editor-orb--r|g|b|w` (`data-socket`, `data-socket-clear`, `data-card-url`), empty orbs `.editor-orb--empty`, move/remove controls, `editor-setup__source` granted label, `.editor-chain--spirit` / `.editor-chain--granted` variants, `.editor-chain__warning` violations. NO `data-setup-level`.

- [x] **Step 1: Update tests** — in `test/editorRender.test.js`:
  - First skills test: remove the `data-setup-level` assertion and assert its absence; color class becomes an orb class. Replace the test body with:

```js
test('renderSkills: chain row with sockets, icons, remove/move hooks — no level UI', () => {
  const b = fixed({ skills: [{ gem: { slug: 'spark' }, level: 12, supports: [{ slug: 'pierce' }] }] });
  const html = renderSkills(b, sctx);
  assert.match(html, /data-gem-well="0"/);
  assert.ok(!html.includes('data-setup-level'), 'level control removed');
  assert.match(html, /data-setup-remove="0"/);
  assert.match(html, /data-setup-move="0:up"/);
  assert.match(html, /data-socket="s:0:0"/);
  assert.match(html, /editor-orb--g/);              // pierce is green ('green' fixture → g)
  assert.match(html, /data-socket="s:0:4"/);         // 5 sockets rendered
  assert.match(html, /editor-orb--empty/);
  assert.match(html, /data-setup-add/);
});

test('renderSkills: single-letter planner colors map to orb classes', () => {
  const planner = { ...SKILL_PLANNER, gems: { ...SKILL_PLANNER.gems, pierce: { gemType: 'support', maxSupports: 0, color: 'g', reqs: null } } };
  const b = fixed({ skills: [{ gem: { slug: 'spark' }, level: null, supports: [{ slug: 'pierce' }] }] });
  assert.match(renderSkills(b, { ...sctx, planner }), /editor-orb--g/);
});
```

  - Duplicate-support test: expectation becomes `/editor-chain__warning/`.
  - Granted test: keep `editor-setup__source`, `N:storm-amulet`, `data-socket="g:storm-amulet:storm-call:1"`, no-remove assertions (all still hold).
- [x] **Step 2: Run to verify failure** — `node --test test/editorRender.test.js` → FAIL.
- [x] **Step 3: Implement** — replace `SOCKET_COLORS`/`socketHtml`/`setupRow`/`renderSkills`:

```js
const ORB_COLOR = { r: 'r', g: 'g', b: 'b', w: 'w', red: 'r', green: 'g', blue: 'b', white: 'w' };

function supportNode(idPrefix, j, supRef, ctx) {
  if (!supRef) {
    return `<span class="chain-link chain-link--dim"></span><span class="editor-node editor-node--support">` +
      `<span class="editor-orb editor-orb--empty" data-socket="${esc(`${idPrefix}:${j}`)}"` +
      ` role="button" tabindex="0" aria-label="Empty support socket">＋</span>` +
      `<span class="editor-node__sub">Support</span></span>`;
  }
  const doc = ctx.resolveRef({ kind: 'gem', slug: supRef.slug }) || {};
  const name = doc.name || supRef.slug;
  const color = ORB_COLOR[ctx.planner.gems[supRef.slug]?.color] ?? 'w';
  const card = doc.cardUrl ? ` data-card-url="${esc(doc.cardUrl)}"` : '';
  return `<span class="chain-link"></span><span class="editor-node editor-node--support">` +
    `<span class="editor-orb editor-orb--${color}" data-socket="${esc(`${idPrefix}:${j}`)}"` +
    ` role="button" tabindex="0"${card} aria-label="Support: ${esc(name)}">${tile(doc, name, 'orb-tile')}` +
    `<button class="editor-socket__clear" type="button" data-socket-clear="${esc(`${idPrefix}:${j}`)}" aria-label="Remove support">×</button></span>` +
    `<span class="editor-node__name">${esc(name)}</span></span>`;
}

function chainRow({ idPrefix, gemRef, supports, label, removable, index, warnings, ctx }) {
  const rec = ctx.planner.gems[gemRef.slug] ?? {};
  const max = rec.maxSupports ?? 5;
  const spirit = rec.gemType === 'spirit';
  const doc = ctx.resolveRef(gemRef) || {};
  const name = doc.name || gemRef.slug;
  const card = doc.cardUrl ? ` data-card-url="${esc(doc.cardUrl)}"` : '';
  const sockets = Array.from({ length: max }, (_, j) => supportNode(idPrefix, j, supports[j], ctx)).join('');
  const controls = removable
    ? `<span class="editor-setup__controls">` +
      `<button type="button" data-setup-move="${index}:up" aria-label="Move up">↑</button>` +
      `<button type="button" data-setup-move="${index}:down" aria-label="Move down">↓</button>` +
      `<button type="button" data-setup-remove="${index}" aria-label="Remove setup">×</button></span>`
    : '';
  const orb = `<span class="editor-orb editor-orb--gem"${removable ? ` data-gem-well="${index}" role="button" tabindex="0"` : ''}${card}` +
    ` aria-label="${esc(name)}">${tile(doc, name, 'orb-tile')}</span>`;
  return `<li class="editor-chain${spirit ? ' editor-chain--spirit' : ''}${removable ? '' : ' editor-chain--granted'}">
    <div class="chain-meta">${spirit ? '<span class="chain-spirit">Spirit</span>' : ''}${controls}</div>
    <span class="editor-node editor-node--gem">${orb}<span class="editor-node__name editor-node__name--gem">${esc(name)}</span>${label}</span>
    ${sockets}
    ${warnings.map((w) => `<p class="editor-chain__warning">${esc(w.message)}</p>`).join('')}
  </li>`;
}

export function renderSkills(build, ctx) {
  const violations = setupViolations(build, ctx.planner.gems);
  const rows = build.skills.map((s, i) => chainRow({
    idPrefix: `s:${i}`, gemRef: s.gem, supports: s.supports, label: '', removable: true, index: i,
    warnings: violations.filter((v) => v.setup === i), ctx,
  }));
  const grantedHtml = grantedRows(build, ctx.planner).map((r) => chainRow({
    idPrefix: `g:${r.key}`, gemRef: { kind: 'gem', slug: r.skill }, supports: r.supports,
    label: `<span class="editor-setup__source">from ${wellBody(r.item, ctx.resolveRef)}</span>`,
    removable: false, index: -1, warnings: [], ctx,
  }));
  return `<section class="editor-chapter editor-skills" id="skills" aria-labelledby="skills-h">
    <header class="chapter-head"><h2 id="skills-h">Skills</h2><span class="chapter-rule"></span>
      <button class="editor-setup-add" type="button" data-setup-add>＋ Add skill</button></header>
    ${rows.length || grantedHtml.length
      ? `<ul class="editor-chains">${rows.join('')}${grantedHtml.join('')}</ul>`
      : '<p class="editor-none">No skill setups yet.</p>'}
  </section>`;
}
```

  (`grantedRows`, its import of `setupViolations`, and the prototype-slug guard stay exactly as they are.)
- [x] **Step 4: Run** — `node --test test/editorRender.test.js` → skills tests PASS.
- [x] **Step 5: Commit** — `git commit -am "feat(planner): skill constellation chains — icons, colored orbs, no level UI"`

---

### Task 5: editor renderer — dossier assembly (rail, header, description, tree, notes)

**Files:**
- Modify: `public/js/editor-render.js`
- Test: `test/editorRender.test.js`

**Interfaces:**
- Consumes: `classLine` from Task 2, `decode` from `./passive-code.js` (sync; `.nodes.length` = allocated count).
- Produces: `renderEditor(build, ctx)` emitting the full dossier; `treeSummary(build) -> {saved: boolean, points: number|null}` exported for tests. New hooks: `data-description`, `data-share`, `data-tree-code`, `data-rail-link`.

- [x] **Step 1: Update tests** — replace the `renderEditor` test and add `treeSummary`:

```js
import { treeSummary } from '../public/js/editor-render.js';
import { encode, synthesizeState } from '../public/js/passive-code.js';

test('treeSummary: decodes allocated count, tolerates junk codes', () => {
  assert.deepEqual(treeSummary(fixed()), { saved: false, points: null });
  const code = encode(synthesizeState({ allocated: [101, 202, 303] }));
  assert.deepEqual(treeSummary(fixed({ tree: { code, notablePriority: [] } })), { saved: true, points: 3 });
  assert.deepEqual(treeSummary(fixed({ tree: { code: '!!!', notablePriority: [] } })), { saved: true, points: null });
});

test('renderEditor: dossier shell — rail, header hooks, four chapters, escapes', () => {
  const b = fixed({ notes: 'hi <b>there</b>', description: 'desc <i>x</i>', tree: { code: null, notablePriority: [] } });
  const html = renderEditor(b, sctx);
  for (const id of ['id="gear"', 'id="skills"', 'id="tree"', 'id="notes"']) assert.ok(html.includes(id), id);
  assert.match(html, /data-rail-link/);
  assert.match(html, /data-share/);
  assert.match(html, /data-description/);
  assert.match(html, /data-tree-code/);
  assert.match(html, /data-notes/);
  assert.match(html, /href="\/passives"/);
  assert.ok(html.includes('hi &lt;b&gt;there&lt;/b&gt;'));
  assert.ok(html.includes('desc &lt;i&gt;x&lt;/i&gt;'));
});
```

- [x] **Step 2: Run to verify failure** — `node --test test/editorRender.test.js` → FAIL.
- [x] **Step 3: Implement** — add imports `import { esc, classLine } from './builds-render.js';` and `import { decode as decodePassiveCode } from './passive-code.js';`, then:

```js
export function treeSummary(build) {
  if (!build.tree.code) return { saved: false, points: null };
  try { return { saved: true, points: decodePassiveCode(build.tree.code).nodes.length }; }
  catch { return { saved: true, points: null }; }
}

export function renderEditor(build, ctx) {
  const t = treeSummary(build);
  const stat = !t.saved ? 'No passive tree saved yet'
    : t.points !== null ? `${t.points} passives allocated` : 'Passive tree saved';
  const prio = build.tree.notablePriority.length;
  return `<article class="editor dossier" data-editor>
    <nav class="dossier-rail" aria-label="Build sections">
      <p class="dossier-rail__mark"><span class="dossier-eyebrow">Build Planner</span>
        <a class="builds-back" href="#">← All builds</a></p>
      <ol class="dossier-rail__nav">
        <li><a href="#gear" class="is-here" data-rail-link>Gear</a></li>
        <li><a href="#skills" data-rail-link>Skills</a></li>
        <li><a href="#tree" data-rail-link>Passive Tree</a></li>
        <li><a href="#notes" data-rail-link>Notes</a></li>
      </ol>
      <p class="dossier-rail__note">Saved in this browser only. The share link makes this build portable.</p>
    </nav>
    <div class="dossier-main">
      <header class="dossier-head">
        <div class="dossier-head__copy">
          <h2>${esc(build.name)}</h2>
          <p class="dossier-class">${esc(classLine(build))}</p>
          <textarea class="dossier-desc" data-description rows="2"
            placeholder="Add a short description — what this build is and how it plays…">${esc(build.description ?? '')}</textarea>
        </div>
        <div class="dossier-actions">
          <button class="dossier-share" type="button" data-share>Copy share link</button>
        </div>
      </header>
      ${renderGear(build, ctx)}
      ${renderSkills(build, ctx)}
      <section class="editor-chapter editor-tree" id="tree" aria-labelledby="tree-h">
        <header class="chapter-head"><h2 id="tree-h">Passive Tree</h2><span class="chapter-rule"></span></header>
        <div class="editor-tree-band">
          <p class="editor-tree-stat">${esc(stat)}${prio ? ` · ${prio} notables prioritized` : ''}</p>
          <label class="editor-tree-code">Tree share code
            <input type="text" data-tree-code spellcheck="false"
              placeholder="Paste a code from the passive tree page…" value="${esc(build.tree.code ?? '')}"></label>
          <a class="editor-tree-open" href="/passives">Open the passive tree →</a>
          <p class="editor-tree-hint">Embedded editing lands in a later phase — for now, build your tree on the tree page and paste its share code here.</p>
        </div></section>
      <section class="editor-chapter editor-notes" id="notes" aria-labelledby="notes-h">
        <header class="chapter-head"><h2 id="notes-h">Notes</h2><span class="chapter-rule"></span></header>
        <textarea data-notes rows="6" placeholder="Build notes — leveling route, upgrade order, reminders…">${esc(build.notes)}</textarea>
      </section>
    </div></article>`;
}
```

- [x] **Step 4: Run** — `node --test test/editorRender.test.js && npm test` → PASS.
- [x] **Step 5: Commit** — `git commit -am "feat(planner): dossier shell — rail nav, description, share hook, tree summary with code paste"`

---

### Task 6: controller wiring — share, description, tree code, scroll-spy; drop level handler

**Files:**
- Modify: `public/js/build-editor.js`
- Modify: `public/js/builds-page.js`

**Interfaces:**
- Consumes: `encodeBuild` from `./build-code.js`, `decode` from `./passive-code.js`, hooks from Task 5.
- Produces: editing behaviors; `builds-page.js` toggles `builds-page--editing` on `[data-builds-root]` when route is a build (Task 7's CSS hides the static page header behind it).

- [x] **Step 1: Implement `build-editor.js` changes**
  - Add imports: `import { encodeBuild } from '/static/js/build-code.js';` and `import { decode as decodePassiveCode } from '/static/js/passive-code.js';`
  - In `onChange`, delete the `data-setup-level` branch and add:

```js
    if (e.target.closest('[data-description]')) { patch({ description: e.target.value }); return; }
    const tc = e.target.closest('[data-tree-code]');
    if (tc) {
      const v = tc.value.trim();
      if (!v) { patch({ tree: { ...build().tree, code: null } }); return; }
      try { decodePassiveCode(v); } catch { tc.classList.add('is-invalid'); return; }
      patch({ tree: { ...build().tree, code: v } });
      return;
    }
```

  - In `onClick`, add a share branch (before the slot branch so the button never falls through):

```js
    if (e.target.closest('[data-share]')) {
      const btn = e.target.closest('[data-share]');
      btn.disabled = true;
      encodeBuild(build())
        .then((code) => {
          const url = `${location.origin}/builds#/import/${code}`;
          return navigator.clipboard.writeText(url).then(
            () => { btn.textContent = 'Link copied ✓'; },
            () => { window.prompt('Copy this share link:', url); });
        })
        .finally(() => { btn.disabled = false;
          setTimeout(() => { const b2 = container.querySelector('[data-share]'); if (b2) b2.textContent = 'Copy share link'; }, 1800); });
      return;
    }
```

  - Rail scroll-spy — in `mountEditor` before `render()`:

```js
  function spy() {
    const links = container.querySelectorAll('[data-rail-link]');
    if (!links.length) return;
    const y = window.scrollY + 130;
    let current = 'gear';
    for (const id of ['gear', 'skills', 'tree', 'notes']) {
      const el = container.querySelector(`#${id}`);
      if (el && el.offsetTop <= y) current = id;
    }
    links.forEach((a) => a.classList.toggle('is-here', a.getAttribute('href') === `#${current}`));
  }
  window.addEventListener('scroll', spy, { passive: true });
```

    …and in the returned `unmount`, add `window.removeEventListener('scroll', spy);`.
    ⚠️ Rail links are `href="#gear"` anchors — but this page routes on `location.hash`! Intercept them in `onClick` **before** anything else:

```js
    const rail = e.target.closest('[data-rail-link]');
    if (rail) {
      e.preventDefault();
      container.querySelector(rail.getAttribute('href'))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
```

- [x] **Step 2: Implement `builds-page.js` change** — first line of `render()` (after the unmount block):

```js
    root.classList.toggle('builds-page--editing', parseRoute(location.hash).view === 'build');
```

- [x] **Step 3: Run** — `npm test` → PASS (these files have no node tests; renderer tests confirm hooks exist).
- [x] **Step 4: Commit** — `git commit -am "feat(planner): share link, description/tree-code editing, rail scroll-spy; drop level control"`

---

### Task 7: CSS + template — dossier styles, drop in-game art link

**Files:**
- Modify: `public/css/builds.css` (keep: page shell, picker overlay, list/viewer styles; replace: everything from `/* ---- Editor: paper-doll ---- */` down)
- Modify: `views/builds.njk` (remove the `planner-art.css` stylesheet line)

**Interfaces:**
- Consumes: class names emitted by Tasks 3–5; `tokens.css` custom properties.
- Produces: the visual layer. `planner-art.css` file itself is untouched (ingestion trigger + guard test unaffected).

- [x] **Step 1: Edit `views/builds.njk`** — the styles block becomes only `<link rel="stylesheet" href="/static/css/builds.css">`.
- [x] **Step 2: Replace the editor CSS** in `public/css/builds.css` (everything below the picker/list sections) with:

```css
/* ---- Dossier shell ---- */
.builds-page--editing .builds-header { display: none; }
.dossier { display: grid; grid-template-columns: 132px minmax(0, 1fr); gap: 28px; }
.dossier-rail { position: sticky; top: 24px; align-self: start; }
.dossier-eyebrow { display: block; color: var(--color-gem); font-size: 10px; font-weight: 650;
  letter-spacing: .16em; text-transform: uppercase; }
.dossier-rail__mark { margin: 0 0 16px; }
.dossier-rail__mark .builds-back { color: var(--color-default); font-size: 11px; text-decoration: none; }
.dossier-rail__mark .builds-back:hover { color: var(--color-gem); }
.dossier-rail__nav { list-style: none; margin: 0; padding: 0; border-left: 1px solid var(--border); }
.dossier-rail__nav a { display: block; padding: 7px 0 7px 14px; margin-left: -1px;
  border-left: 2px solid transparent; color: var(--color-default);
  font-size: 11.5px; letter-spacing: .12em; text-transform: uppercase; text-decoration: none;
  transition: color 120ms ease, border-color 120ms ease; }
.dossier-rail__nav a:hover { color: var(--color-normal); }
.dossier-rail__nav a.is-here { color: var(--color-gem); border-left-color: var(--color-gem); }
.dossier-rail__note { margin-top: 20px; color: var(--color-default); font-size: 10px; line-height: 1.5; }

.dossier-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px;
  padding-bottom: 16px; margin-bottom: 4px; border-bottom: 1px solid var(--border); }
.dossier-head__copy { min-width: 0; flex: 1; }
.dossier-head h2 { margin: 0 0 2px; color: var(--color-normal); font-family: var(--font-display);
  font-size: clamp(24px, 3vw, 36px); font-weight: 500; letter-spacing: .015em; }
.dossier-class { margin: 0 0 8px; color: var(--color-notable); font-size: 12.5px; }
.dossier-desc { width: 100%; max-width: 44rem; resize: vertical; padding: 6px 9px;
  border: 1px solid color-mix(in srgb, var(--border) 70%, transparent); border-radius: 6px;
  background: rgb(0 0 0 / .25); color: var(--text); font: 13px/1.5 var(--font-regular); }
.dossier-desc:focus-visible { outline: none;
  border-color: color-mix(in srgb, var(--color-gem) 58%, var(--border)); }
.dossier-share { display: inline-flex; align-items: center; gap: 7px; padding: 6px 14px;
  border: 1px solid color-mix(in srgb, var(--color-gem) 40%, var(--border)); border-radius: 999px;
  background: color-mix(in srgb, var(--color-gem) 8%, transparent); color: var(--color-normal);
  font: 12px/1.2 var(--font-smallcaps); cursor: pointer;
  transition: border-color 120ms ease, background-color 120ms ease, transform 120ms ease; }
.dossier-share:hover { background: color-mix(in srgb, var(--color-gem) 14%, transparent); transform: translateY(-1px); }
.dossier-share:focus-visible { outline: 2px solid var(--color-gem); outline-offset: 2px; }

/* ---- chapters ---- */
.editor-chapter { padding: 26px 0 6px; scroll-margin-top: 16px; }
.chapter-head { display: flex; align-items: baseline; gap: 14px; margin-bottom: 14px; }
.chapter-head h2 { margin: 0; color: var(--color-normal); font-family: var(--font-display);
  font-size: 20px; font-weight: 500; letter-spacing: .03em; }
.chapter-rule { flex: 1; height: 1px; background: linear-gradient(90deg, var(--border), transparent); }

/* ---- gear: abstract doll (owner's in-game spatial spec, no game art) ---- */
.editor-gear-layout { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(240px, .75fr); gap: 20px; }
.editor-doll-board { position: relative; padding: 20px 16px; border: 1px solid var(--border);
  border-radius: 8px; box-shadow: 0 12px 32px rgb(0 0 0 / .14);
  background: radial-gradient(ellipse at 50% 28%, rgb(255 255 255 / .025), transparent 60%),
    color-mix(in srgb, var(--bg-surface) 88%, transparent); }
.editor-doll { display: grid; gap: 10px; justify-content: center;
  grid-template-columns: 96px 84px 96px 84px 96px;
  grid-template-rows: 34px 64px 72px 72px 56px 64px;
  grid-template-areas:
    ".  .      helmet .      ."
    "w1 .      helmet amulet w2"
    "w1 ring1  body   ring2  w2"
    "w1 gloves body   boots  w2"
    ".  gloves belt   boots  ."
    ".  flask1 charm1 flask2 ."; }
.editor-slot--weapon1a, .editor-slot--weapon2a { grid-area: w1; }
.editor-slot--weapon1b, .editor-slot--weapon2b { grid-area: w2; }
.editor-slot--helmet { grid-area: helmet; }
.editor-slot--body   { grid-area: body; }
.editor-slot--amulet { grid-area: amulet; }
.editor-slot--ring1  { grid-area: ring1; align-self: end; min-height: 62px; }
.editor-slot--ring2  { grid-area: ring2; align-self: end; min-height: 62px; }
.editor-slot--gloves { grid-area: gloves; align-self: end; min-height: 120px; }
.editor-slot--boots  { grid-area: boots;  align-self: end; min-height: 120px; }
.editor-slot--belt   { grid-area: belt; }
.editor-slot--flask1 { grid-area: flask1; }
.editor-slot--flask2 { grid-area: flask2; }
.editor-slot--charm1 { grid-area: charm1; }
.editor-slot { position: relative; display: flex; flex-direction: column; align-items: center;
  justify-content: center; gap: 4px; padding: 8px 6px; text-align: center; cursor: pointer;
  border: 1px solid var(--border); border-radius: 7px;
  background: color-mix(in srgb, var(--bg-base) 55%, transparent);
  transition: border-color 120ms ease, box-shadow 120ms ease, transform 120ms ease; }
.editor-slot:hover { transform: translateY(-1px);
  border-color: color-mix(in srgb, var(--color-gem) 45%, var(--border));
  box-shadow: 0 6px 18px rgb(0 0 0 / .35); }
.editor-slot:focus-visible { outline: 2px solid var(--color-gem); outline-offset: 2px; }
.editor-slot.is-empty { border-style: dashed; }
.editor-slot.is-empty:hover .editor-slot__hint { color: var(--color-gem); }
.editor-slot.is-unique { border-color: color-mix(in srgb, var(--color-unique) 50%, var(--border));
  box-shadow: inset 0 0 18px rgb(239 105 22 / .07); }
.editor-slot.is-unique:hover { border-color: color-mix(in srgb, var(--color-unique) 75%, var(--border)); }
.editor-slot.is-ghost { border-style: dashed; opacity: .6; cursor: default; }
.editor-slot--violation { outline: 1px solid color-mix(in srgb, var(--color-corrupted) 70%, transparent); }
.editor-slot__label { font-size: 8.5px; letter-spacing: .14em; text-transform: uppercase;
  color: var(--color-default); order: 2; }
.editor-slot__hint { font-size: 10px; letter-spacing: .1em; text-transform: uppercase;
  color: var(--color-default); }
.editor-slot__ghost { font-size: 10px; color: var(--color-default); font-style: italic; }
.editor-slot__clear { position: absolute; top: 4px; right: 4px; padding: 3px 5px; border: 0;
  border-radius: 4px; background: rgb(0 0 0 / .5); color: var(--color-default);
  font-size: 11px; line-height: 1; cursor: pointer; opacity: 0; transition: opacity 120ms ease; }
.editor-slot:hover .editor-slot__clear, .editor-slot__clear:focus-visible { opacity: 1; }
.editor-slot__clear:hover { color: var(--color-normal); }
.editor-item { display: flex; flex-direction: column; align-items: center; gap: 4px; min-width: 0; }
.editor-item__name { font-size: 10.5px; line-height: 1.2; overflow-wrap: anywhere; }
.editor-item__name--unique { color: var(--color-unique); }
.editor-item__name--base { color: var(--color-normal); }
.editor-item__name--gem { color: var(--color-gem); }
.well-tile { position: relative; width: 32px; height: 32px; display: flex; align-items: center;
  justify-content: center; border-radius: 6px; background: rgb(255 255 255 / .06);
  color: rgb(255 255 255 / .75); font: 11px/1 var(--font-display); }
.well-tile__img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; }

.editor-gear-side { display: flex; flex-direction: column; gap: 14px; }
.editor-side-card { padding: 12px 14px; border: 1px solid var(--border); border-radius: 8px;
  background: color-mix(in srgb, var(--bg-surface) 88%, transparent);
  box-shadow: 0 12px 32px rgb(0 0 0 / .14); }
.editor-side-card > h3 { margin: 0 0 9px; color: var(--color-default); font-size: 10px;
  font-weight: 650; letter-spacing: .16em; text-transform: uppercase; }
.editor-checks { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 5px; }
.editor-checks li { padding: 6px 9px; border-radius: 6px; font-size: 11.5px;
  border: 1px solid color-mix(in srgb, var(--border) 80%, transparent); color: var(--color-default); }
.editor-checks li.is-warn { border-color: color-mix(in srgb, var(--color-notable) 40%, var(--border));
  background: color-mix(in srgb, var(--color-notable) 7%, transparent); color: var(--color-notable); }
.editor-checks--clear { margin: 0; color: var(--color-default); font-size: 11.5px; }
.editor-tray__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.editor-tray__row { display: flex; align-items: center; justify-content: space-between; gap: 8px;
  padding: 5px 6px; border-radius: 6px; }
.editor-tray__row:hover { background: rgb(255 255 255 / .04); }
.editor-tray__row .editor-item { flex-direction: row; }
.editor-tray__row .well-tile { width: 26px; height: 26px; font-size: 9px; }
.editor-tray__actions { display: flex; gap: 5px; }
.editor-tray__actions button { padding: 2px 9px; border: 1px solid var(--border); border-radius: 999px;
  background: none; color: var(--color-default); font: 10.5px/1.3 var(--font-smallcaps); cursor: pointer; }
.editor-tray__actions button:hover { color: var(--color-normal);
  border-color: color-mix(in srgb, var(--color-gem) 50%, var(--border)); }
.editor-none { margin: 0; opacity: .55; font-size: 11.5px; }
.editor-set-toggle { display: inline-flex; border: 1px solid var(--border); border-radius: 999px; overflow: hidden; }
.editor-set-btn { padding: 3px 12px; border: 0; background: transparent; color: var(--color-default);
  font: 11px/1.4 var(--font-smallcaps); letter-spacing: .08em; cursor: pointer; }
.editor-set-btn.is-active { background: color-mix(in srgb, var(--color-gem) 14%, transparent);
  color: var(--color-normal); }
.editor-set-btn:not(.is-active):hover { color: var(--color-normal); }

/* ---- skills: constellation chains ---- */
.editor-chains { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
.editor-chain { position: relative; display: flex; align-items: flex-start; padding: 16px 14px 12px;
  border: 1px solid var(--border); border-radius: 8px; overflow-x: auto;
  background: color-mix(in srgb, var(--bg-surface) 88%, transparent);
  box-shadow: 0 12px 32px rgb(0 0 0 / .14);
  transition: border-color 120ms ease, transform 120ms ease; }
.editor-chain:hover { transform: translateY(-1px);
  border-color: color-mix(in srgb, var(--color-gem) 30%, var(--border)); }
.chain-meta { position: absolute; top: 7px; right: 10px; display: flex; align-items: center; gap: 10px; }
.chain-spirit { color: var(--color-crafted); font-size: 9px; letter-spacing: .15em; text-transform: uppercase; }
.editor-setup__controls { display: flex; gap: 2px; }
.editor-setup__controls button { width: 22px; height: 22px; padding: 0; border: 0; border-radius: 4px;
  background: none; color: var(--color-default); font-size: 12px; cursor: pointer; }
.editor-setup__controls button:hover { color: var(--color-normal); background: rgb(255 255 255 / .07); }
.editor-node { display: flex; flex-direction: column; align-items: center; gap: 6px;
  min-width: 88px; text-align: center; }
.editor-node__name { font-size: 11px; line-height: 1.2; color: var(--color-normal); max-width: 96px; }
.editor-node__name--gem { color: var(--color-gem); font-size: 12px; }
.editor-node__sub { font-size: 9px; letter-spacing: .1em; text-transform: uppercase; color: var(--color-default); }
.editor-orb { position: relative; display: flex; align-items: center; justify-content: center;
  border-radius: 50%; cursor: pointer; transition: box-shadow 120ms ease, transform 120ms ease; }
.editor-orb--gem { width: 46px; height: 46px; border: 2px solid var(--color-gem);
  background: radial-gradient(circle at 35% 30%, color-mix(in srgb, var(--color-gem) 30%, var(--bg-base)), var(--bg-base));
  box-shadow: 0 0 14px color-mix(in srgb, var(--color-gem) 30%, transparent); }
.editor-orb--gem:hover { transform: scale(1.06);
  box-shadow: 0 0 20px color-mix(in srgb, var(--color-gem) 55%, transparent); }
.editor-node--support .editor-orb { width: 32px; height: 32px; margin-top: 7px;
  border: 2px solid var(--color-gem-w); background: var(--bg-surface); }
.editor-orb--r { border-color: var(--color-gem-r) !important; }
.editor-orb--g { border-color: var(--color-gem-g) !important; }
.editor-orb--b { border-color: var(--color-gem-b) !important; }
.editor-orb--w { border-color: var(--color-gem-w) !important; }
.editor-orb--empty { border: 2px dashed var(--border) !important; background: transparent;
  color: var(--color-default); font-size: 13px; }
.editor-orb--empty:hover { border-color: var(--color-gem) !important; color: var(--color-gem); }
.orb-tile { position: relative; width: 100%; height: 100%; display: flex; align-items: center;
  justify-content: center; border-radius: 50%; overflow: hidden;
  color: rgb(255 255 255 / .8); font: 10px/1 var(--font-display); }
.editor-orb--gem .orb-tile { font-size: 13px; }
.orb-tile__img { position: absolute; inset: 2px; width: calc(100% - 4px); height: calc(100% - 4px);
  object-fit: contain; }
.chain-link { flex: none; align-self: flex-start; margin-top: 30px; width: 30px; height: 2px;
  background: linear-gradient(90deg, color-mix(in srgb, var(--color-gem) 55%, transparent),
    color-mix(in srgb, var(--color-gem) 20%, transparent)); }
.chain-link--dim { background: repeating-linear-gradient(90deg, var(--border) 0 5px, transparent 5px 9px); }
.editor-chain--spirit { border-left: 3px solid var(--color-crafted); }
.editor-chain--spirit .editor-orb--gem { border-color: var(--color-crafted);
  box-shadow: 0 0 14px color-mix(in srgb, var(--color-crafted) 30%, transparent); }
.editor-chain--spirit .editor-node__name--gem { color: var(--color-crafted); }
.editor-chain--granted { border-left: 3px solid var(--color-unique); }
.editor-chain--granted .editor-orb--gem { border-color: var(--color-unique);
  box-shadow: 0 0 14px color-mix(in srgb, var(--color-unique) 25%, transparent); }
.editor-setup__source { display: block; font-size: 9.5px; color: var(--color-default); }
.editor-setup__source .editor-item { flex-direction: row; gap: 4px; display: inline-flex; }
.editor-setup__source .well-tile { display: none; }
.editor-setup__source .editor-item__name { font-size: 9.5px; }
.editor-socket__clear { position: absolute; top: -6px; right: -6px; display: none; width: 15px; height: 15px;
  padding: 0; border: 0; border-radius: 50%; background: rgb(0 0 0 / .7); color: var(--color-normal);
  font-size: 9px; line-height: 1; cursor: pointer; z-index: 1; }
.editor-orb:hover .editor-socket__clear, .editor-orb:focus-within .editor-socket__clear { display: block; }
.editor-chain__warning { flex-basis: 100%; margin: 8px 0 0; color: var(--color-notable); font-size: 11px; }
.editor-setup-add { padding: 4px 14px; border: 1px dashed var(--border); border-radius: 999px;
  background: none; color: var(--color-default); font: 11.5px/1.4 var(--font-smallcaps);
  letter-spacing: .06em; cursor: pointer; }
.editor-setup-add:hover { color: var(--color-gem);
  border-color: color-mix(in srgb, var(--color-gem) 45%, var(--border)); }

/* ---- tree + notes ---- */
.editor-tree-band { display: flex; flex-direction: column; gap: 10px; padding: 16px;
  border: 1px solid var(--border); border-radius: 8px;
  background: color-mix(in srgb, var(--bg-surface) 88%, transparent);
  box-shadow: 0 12px 32px rgb(0 0 0 / .14); }
.editor-tree-stat { margin: 0; color: var(--color-normal); font-size: 14px; }
.editor-tree-code { display: flex; flex-direction: column; gap: 4px; max-width: 34rem;
  color: var(--color-default); font-size: 10px; letter-spacing: .12em; text-transform: uppercase; }
.editor-tree-code input { padding: 6px 9px; border: 1px solid var(--border); border-radius: 6px;
  background: rgb(0 0 0 / .25); color: var(--text); font: 12px/1.4 var(--font-regular);
  letter-spacing: normal; text-transform: none; }
.editor-tree-code input.is-invalid { border-color: var(--color-corrupted); }
.editor-tree-open { align-self: flex-start; padding: 6px 14px; border-radius: 6px; text-decoration: none;
  border: 1px solid color-mix(in srgb, var(--color-gem) 40%, var(--border));
  background: color-mix(in srgb, var(--color-gem) 8%, transparent); color: var(--color-normal);
  font: 12px/1.4 var(--font-smallcaps); letter-spacing: .06em; }
.editor-tree-open:hover { background: color-mix(in srgb, var(--color-gem) 14%, transparent); }
.editor-tree-hint { margin: 0; color: var(--color-default); font-size: 10.5px; }
.editor-notes textarea { width: 100%; padding: 10px 12px; resize: vertical;
  border: 1px solid var(--border); border-radius: 8px; background: rgb(0 0 0 / .25);
  color: var(--text); font: 13px/1.6 var(--font-regular); }
.editor-notes textarea:focus-visible, .dossier-desc:focus-visible, .editor-tree-code input:focus-visible {
  outline: none; border-color: color-mix(in srgb, var(--color-gem) 58%, var(--border));
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-gem) 10%, transparent); }

@media (max-width: 980px) {
  .dossier { grid-template-columns: 1fr; gap: 12px; }
  .dossier-rail { position: static; }
  .dossier-rail__nav { display: flex; border-left: 0; border-bottom: 1px solid var(--border); }
  .dossier-rail__nav a { border-left: 0; border-bottom: 2px solid transparent; padding: 6px 10px; }
  .dossier-rail__nav a.is-here { border-bottom-color: var(--color-gem); }
  .dossier-rail__note { display: none; }
  .dossier-head { flex-direction: column; }
  .editor-gear-layout { grid-template-columns: 1fr; }
}
@media (max-width: 640px) {
  .editor-doll { grid-template-columns: repeat(5, minmax(56px, 1fr)); gap: 6px;
    grid-template-rows: 26px 52px 60px 60px 46px 52px; }
  .editor-item__name { font-size: 9px; }
  .editor-node { min-width: 64px; }
  .chain-link { width: 16px; }
}
@media (prefers-reduced-motion: reduce) {
  .editor-slot, .editor-chain, .editor-orb, .dossier-share { transition: none; }
}
```

  Delete the now-dead rules: old `.editor-doll` grid-areas block, `.editor-setup*`, `.editor-socket` sizing tied to socket art, `.editor-tray` margins under the doll, `.editor-warnings`, `.editor-slot--weapon* { min-height: 10rem }` etc. Keep `.builds-*` (list, viewer, import) and `.picker-*` untouched.
- [x] **Step 3: Run** — `npm test` → PASS (`plannerArt.test.js` reads `planner-art.css` directly and still passes).
- [x] **Step 4: Visual check** — `npm run dev`, open `http://localhost:3000/builds`, create a build, equip items across slots, add setups + supports, both weapon sets, narrow to 390px. Verify doll geometry against the spatial spec, orb colors, tooltips on hover (`data-card-url`), share button copies a working `#/import/` link, description/notes/tree-code persistence across reloads.
- [x] **Step 5: Commit** — `git commit -am "feat(planner): dossier CSS — spatial doll grid, chains, tree band; drop in-game art link"`

---

### Task 8: docs, roadmap amendment, full verification

**Files:**
- Modify: `docs/superpowers/specs/2026-07-06-build-planner-roadmap.md`
- Modify: `docs/superpowers/specs/2026-07-17-ui-redesign-direction.md`

- [x] **Step 1: Amend the roadmap** — in the "UI fidelity" bullet list, prepend: `**Amended 2026-07-22:** the in-game-imitation goals below are superseded by the owner-approved "Dossier" design (docs/superpowers/plans/2026-07-22-builds-dossier-redesign.md): in-game *spatial arrangement* retained for gear, in-game *artwork* dropped; skill setups render as icon "constellation chains" without level controls; description field added. The passive-tree embed goal (Phase 5) stands.` Also note under Phase 3 that `planner-art.css` textures are no longer consumed by the editor (pruning decision deferred).
- [x] **Step 2: Update the redesign direction record** — append a `## Builds page (2026-07-22)` section: Dossier concept chosen (artifact links), amendment list, plan pointer.
- [x] **Step 3: Full verification** — `npm test` (all green), then `npm run build:static` (crawler must pass; no new client-fetched URLs were added — share/import are hash-routed).
- [x] **Step 4: Commit** — `git commit -am "docs(planner): record dossier redesign decision; roadmap UI-fidelity amendment"`

---

## Self-Review

- **Spec coverage:** gear spatial layout (Task 7 grid — every owner alignment rule mapped to a grid row/area + `align-self`), no game art (Tasks 3/7), level removal (Tasks 2/4/6), real gem icons + tooltips (Task 4 `tile()` + `data-card-url`), granted callout kept (Task 4), checks card (Task 3), rail nav (Tasks 5/6/7), share front-and-center (Tasks 5/6), description-at-top + notes-at-bottom (Tasks 1/2/5), tree section with functional code paste (Tasks 5/6). ✓
- **Placeholder scan:** none. ✓
- **Type consistency:** `tile(doc, name, cls)` and `wellBody(ref, resolveRef)` defined Task 3, consumed Task 4; `classLine` exported Task 2, imported Task 5; `treeSummary` shape `{saved, points}` consistent; hook names match `build-editor.js` handlers. ✓
