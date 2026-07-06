# Passive Tooltip Re-skin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-skin the passive (keystone/notable) detail card into the `.newItemPopup` tooltip family used by gems/uniques, distinguish keystones from notables by accent color, and put the card under the existing UI size scaler.

**Architecture:** Add a `kind` discriminator to the shared passive view model, rebuild the `passiveDetail` Nunjucks macro to emit `.newItemPopup` chrome with a flat (no-banner) header, wrap the detail pages in `.gem-detail` so the existing `data-card-size` zoom rules apply, and add the keystone/notable accent tokens + passive-header CSS while removing the dead `.passive-detail-*` rules.

**Tech Stack:** Node 20 ESM, Express 5, Nunjucks templates, plain CSS with design tokens, `node:test` + supertest.

## Global Constraints

- Passive headers have **no banner background image** (unlike gems' `GemHoverTitle.dds`) — the header is a flat colored bar.
- Reuse the existing `.newItemPopup` glow-border machinery (`--card-border` / `--card-glow`) rather than inventing new border styling.
- Reuse the existing `.gem-detail` zoom rules for the scaler — add no new scaler CSS.
- Keystone accent = blue/violet; notable accent = warm gold/amber.
- `passiveNodeCard` browse-grid tiles, the ascendancy grid, and any hover/tippy `/card` route are out of scope and must stay unchanged.
- Tests use `node --test` (run via `npm test`).

---

### Task 1: Add `kind` discriminator to the passive view model

**Files:**
- Modify: `src/data/passiveTree.js` (the `nodeRecord` function, ~line 81-92)
- Test: `test/passiveTree.test.js`

**Interfaces:**
- Consumes: existing raw passive record fields `p.is_keystone` (boolean).
- Produces: `nodeRecord(p)` gains `kind: 'keystone' | 'notable'`. Consumed by the `passiveDetail` macro in Task 2 to choose the modifier class and type label.

- [ ] **Step 1: Write the failing tests**

Add these to `test/passiveTree.test.js` inside the existing `describe('passiveTree', ...)` block (e.g. after the `getKeystone` describe):

```js
describe('kind discriminator', () => {
  it('keystones have kind "keystone"', () => {
    const k = getKeystone('passive_keystone_zealots_oath');
    assert.equal(k.kind, 'keystone');
  });
  it('notables have kind "notable"', () => {
    const n = getNotable('armour_and_evasion53');
    assert.equal(n.kind, 'notable');
  });
  it('listed keystones all report kind "keystone"', () => {
    assert.ok(listKeystones().every((k) => k.kind === 'keystone'));
  });
  it('listed notables all report kind "notable"', () => {
    assert.ok(listNotables().every((n) => n.kind === 'notable'));
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- test/passiveTree.test.js`
Expected: FAIL — the `kind` assertions fail because `nodeRecord` does not yet set `kind` (`undefined !== 'keystone'`).

- [ ] **Step 3: Add the `kind` field to `nodeRecord`**

In `src/data/passiveTree.js`, edit the `nodeRecord` return object to add one line:

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
    kind: p.is_keystone ? 'keystone' : 'notable',
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- test/passiveTree.test.js`
Expected: PASS (all kind tests pass; existing passiveTree tests still pass).

- [ ] **Step 5: Commit**

```bash
git add src/data/passiveTree.js test/passiveTree.test.js
git commit -m "feat: add kind discriminator to passive view model"
```

---

### Task 2: Re-skin the passive detail card into the `.newItemPopup` family

**Files:**
- Modify: `views/macros/passive.njk` (rebuild the `passiveDetail` macro; leave `passiveNodeCard` untouched)
- Modify: `views/keystone.njk` (wrap card in `.gem-detail`)
- Modify: `views/notable.njk` (wrap card in `.gem-detail`)
- Modify: `public/css/tokens.css` (add keystone/notable accent tokens)
- Modify: `public/css/gem-card.css` (add passive popup + header styles; remove dead `.passive-detail-*` rules)
- Test: `test/render.test.js`

**Interfaces:**
- Consumes: `node.kind` (`'keystone' | 'notable'`) from Task 1, plus existing `node.name`, `node.iconUrl`, `node.statLines` (array), `node.reminderText` (array), `node.flavourText` (string).
- Produces: passive detail pages render `.newItemPopup.PassivePopup` with `is-keystone`/`is-notable` modifier, inline `--card-border`/`--card-glow`, a `.passiveHeader` containing `.leadPassiveIcon` + name + type line, and the whole card wrapped in `.gem-detail`.

- [ ] **Step 1: Write the failing render tests**

Add to `test/render.test.js`:

```js
test('GET /keystone/:id renders a keystone passive popup', async () => {
  const res = await request(createApp()).get('/keystone/passive_keystone_zealots_oath');
  assert.equal(res.status, 200);
  assert.match(res.text, /Zealot's Oath/);
  // newItemPopup family + passive + keystone modifier
  assert.match(res.text, /newItemPopup/);
  assert.match(res.text, /PassivePopup/);
  assert.match(res.text, /is-keystone/);
  // reuses the glow-border machinery
  assert.match(res.text, /--card-border:/);
  // flat header with left-anchored icon and a "Keystone" type line
  assert.match(res.text, /passiveHeader/);
  assert.match(res.text, /leadPassiveIcon/);
  assert.match(res.text, /typeLine">.*Keystone.*<\/span>/);
  // under the size scaler
  const popupIdx = res.text.indexOf('newItemPopup');
  const detailIdx = res.text.indexOf('gem-detail');
  assert.ok(detailIdx > -1 && detailIdx < popupIdx, 'passive card must be wrapped in .gem-detail');
});

test('GET /notable/:id renders a notable passive popup', async () => {
  const res = await request(createApp()).get('/notable/armour_and_evasion53');
  assert.equal(res.status, 200);
  assert.match(res.text, /Knight of Izaro/);
  assert.match(res.text, /PassivePopup/);
  assert.match(res.text, /is-notable/);
  assert.match(res.text, /typeLine">.*Notable.*<\/span>/);
});

test('passive re-skin removes the legacy passive-detail card classes', async () => {
  const res = await request(createApp()).get('/keystone/passive_keystone_zealots_oath');
  assert.ok(!/passive-detail-card/.test(res.text), 'legacy passive-detail-card must be gone');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- test/render.test.js`
Expected: FAIL — current `passiveDetail` emits `.passive-detail-card` (so `PassivePopup`/`newItemPopup`/`gem-detail` assertions fail and the legacy-class negative assertion fails).

- [ ] **Step 3: Rebuild the `passiveDetail` macro**

Replace the `passiveDetail` macro in `views/macros/passive.njk` with the following. **Leave the `passiveNodeCard` macro below it exactly as-is.**

```njk
{% macro passiveDetail(node) %}
<div class="newItemPopup PassivePopup item-popup--poe2 is-{{ node.kind }}">
  <div class="itemHeader doubleLine passiveHeader">
    {% if node.iconUrl %}
    <img class="leadPassiveIcon" src="{{ node.iconUrl }}" alt="{{ node.name }}" onerror="this.style.visibility='hidden'">
    {% endif %}
    <div class="itemName"><span class="lc">{{ node.name }}</span></div>
    <div class="itemName typeLine"><span class="lc">{% if node.kind == 'keystone' %}Keystone{% else %}Notable Passive{% endif %}</span></div>
  </div>
  <div class="content">
    {% if node.statLines.length %}
    <div class="Stats">
      {% for line in node.statLines %}
      <div class="explicitMod">{{ line | safe }}</div>
      {% endfor %}
    </div>
    {% endif %}
    {% if node.reminderText.length %}
    <div class="Stats">
      {% for line in node.reminderText %}
      <div class="reminderText">{{ line | safe }}</div>
      {% endfor %}
    </div>
    {% endif %}
    {% if node.flavourText %}
    <div class="separator"></div>
    <div class="FlavourText">{{ node.flavourText }}</div>
    {% endif %}
  </div>
</div>
{% endmacro %}
```

- [ ] **Step 4: Wrap the detail pages in `.gem-detail`**

In `views/keystone.njk`, change the content block so the card is wrapped:

```njk
{% block content %}
<div class="page">
  {{ breadcrumb([
    { label: 'Keystones', href: '/keystones' },
    { label: k.name }
  ]) }}
  <div class="gem-detail">
    {{ passiveDetail(k) }}
  </div>
</div>
{% endblock %}
```

In `views/notable.njk`, do the same:

```njk
{% block content %}
<div class="page">
  {{ breadcrumb([
    { label: 'Keystones', href: '/keystones' },
    { label: 'Notable' },
    { label: n.name }
  ]) }}
  <div class="gem-detail">
    {{ passiveDetail(n) }}
  </div>
</div>
{% endblock %}
```

- [ ] **Step 5: Add accent tokens**

In `public/css/tokens.css`, add to the `:root` color block (after `--color-unique-divider: #c87a30;`):

```css
  --color-keystone: #8888ff;
  --color-keystone-glow: rgba(136, 136, 255, 0.45);
  --color-notable: #d4a13a;
  --color-notable-glow: rgba(212, 161, 58, 0.45);
```

- [ ] **Step 6: Add passive popup + header CSS and remove dead rules**

In `public/css/gem-card.css`, replace the entire `/* Keystone detail */` block (the rules for `.passive-detail-card`, `.passive-detail-icon`, `.passive-detail-name`, `.passive-detail-stats`, `.passive-detail-flavour`, currently ~lines 757-787) with the rules below. Also remove `.passive-detail-card` from the shared dark-shell selector list near line 708 (the `.passive-node-card, .passive-detail-card, .asc-card { ... }` rule) so only `.passive-node-card` and `.asc-card` remain there.

```css
/* Passive detail popup — keystone/notable, reuses .newItemPopup chrome.
   No banner image (passives have none); the header is a flat bar. */
.PassivePopup {
  max-width: 360px;
  margin: 16px auto 0;
}
.PassivePopup.is-keystone {
  --card-border: var(--color-keystone);
  --card-glow: var(--color-keystone-glow);
  --passive-name-color: var(--color-keystone);
}
.PassivePopup.is-notable {
  --card-border: var(--color-notable);
  --card-glow: var(--color-notable-glow);
  --passive-name-color: var(--color-notable);
}

/* Flat header bar — overrides the gem .dds banner background */
.itemHeader.doubleLine.passiveHeader {
  background: linear-gradient(180deg, rgba(255,255,255,0.05), rgba(0,0,0,0.25));
  background-size: auto;
}
.PassivePopup .leadPassiveIcon {
  position: absolute;
  left: 8px;
  top: 50%;
  transform: translateY(-50%);
  width: 44px;
  height: 44px;
  object-fit: contain;
}
.PassivePopup .itemName .lc {
  padding: 2px 12px 0 64px;
  text-align: left;
  white-space: normal;
  color: var(--passive-name-color);
}
.PassivePopup .itemName.typeLine .lc {
  padding-top: 0;
  color: var(--prop-color);
}

/* Reminder text — muted blue italic, matching the in-game passive tooltip */
.PassivePopup .reminderText {
  color: var(--magic-color);
  font-style: italic;
  opacity: 0.75;
  font-size: 12px;
  line-height: 1.35;
}
```

- [ ] **Step 7: Run the render tests to verify they pass**

Run: `npm test -- test/render.test.js`
Expected: PASS (keystone + notable popup tests pass, legacy-class negative test passes, existing gem/unique render tests still pass).

- [ ] **Step 8: Run the full suite**

Run: `npm test`
Expected: PASS — no regressions across the suite.

- [ ] **Step 9: Visual verification**

Run: `npm run dev`, then load `http://localhost:3000/keystone/passive_keystone_zealots_oath` and `http://localhost:3000/notable/armour_and_evasion53`. Confirm:
- Keystone card shows blue/violet glow border; notable shows gold/amber.
- Flat header with the node icon anchored left, name beside it, and a "Keystone" / "Notable Passive" type line underneath.
- Stat lines, separator, and flavour render in the `.newItemPopup` style.
- Changing the card size control (S/M/L/XL) scales the passive card like gem/unique cards.
- The keystones list (`/keystones`) and an ascendancy page still show the unchanged `passiveNodeCard` browse tiles.

- [ ] **Step 10: Commit**

```bash
git add views/macros/passive.njk views/keystone.njk views/notable.njk public/css/tokens.css public/css/gem-card.css test/render.test.js
git commit -m "feat: re-skin passive tooltip into newItemPopup family with scaler + kind accents"
```

---

## Self-Review

**Spec coverage:**
- Flat header, icon left → Task 2 macro + `.passiveHeader`/`.leadPassiveIcon` CSS. ✓
- Keystone vs notable accent → Task 1 `kind` + Task 2 `is-keystone`/`is-notable` tokens. ✓
- Scaler via `.gem-detail` → Task 2 Step 4. ✓
- `.newItemPopup` chrome (Stats/separator/FlavourText) → Task 2 macro. ✓
- `reminderText` fidelity bump → Task 2 macro + `.reminderText` CSS (conditional; no data populates it today, so no data-driven test — covered defensively). ✓
- View-model `kind` → Task 1. ✓
- Remove dead `.passive-detail-*` rules → Task 2 Step 6 + negative render test. ✓
- Out-of-scope items (`passiveNodeCard`, ascendancy grid, tippy route) → explicitly untouched; verified in Step 9. ✓

**Placeholder scan:** No TBD/TODO; all code shown in full. ✓

**Type consistency:** `kind` produced in Task 1 (`'keystone'|'notable'`) consumed in Task 2 macro as `node.kind` and `is-{{ node.kind }}`; type label switch matches. Test ids (`passive_keystone_zealots_oath`, `armour_and_evasion53`) verified to exist. ✓
