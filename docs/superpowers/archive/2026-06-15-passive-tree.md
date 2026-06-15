# Passive Tree & Ascendancies Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Searchable keystones and notable passive nodes, plus ascendancy browsers — no tree visualization.

**Architecture:** Lazy-load `passive_skill_trees/Default.json` and `ascendancies.json` via `src/data/passiveTree.js`. Stat translation merges two description files (passive-specific first, then general). Routes and views follow the existing patterns for bases/mods.

**Tech Stack:** Node.js, Express 5, Nunjucks, `node:test`, existing `renderGameText` + `ddsUrl` primitives.

---

## Verified Data Facts

- `passive_skill_trees/Default.json` → `passives` dict with 5101 nodes
- 33 keystones (`is_keystone=true`)
- 974 non-ascendancy notables (`is_notable=true && !ascendancy`)
- 23 valid ascendancies (non-disabled, no `[DNT` in name)
- Stat translation: try `passive_skill_stat_descriptions.json` (208 entries) first, then `stat_descriptions.json` (10699 entries)
- Format `ignore` → show string as-is (no value substitution); format `#` → substitute `{0}` with numeric value
- Keystone sample: `id='passive_keystone_zealots_oath'`, `name="Zealot's Oath"`, `stats={keystone_zealots_oath: 1}`
- Keystone description (from passive_skill_stat_descriptions): "Excess Life Recovery from Regeneration is applied to [EnergyShield|Energy Shield]\n[EnergyShield|Energy Shield] does not Recharge"
- Notable sample: `id='ailments38'`, `name='Fast Acting Toxins'`, `stats={damaging_ailments_deal_damage_+%_faster: 12}`
- Notable stat rendered (from stat_descriptions): "[DamagingAilments|Damaging Ailments] deal damage 12% faster"
- Icon CDN via `ddsUrl('Art/2DArt/SkillIcons/passives/liferegentoenergyshield.dds')`

## File Structure

- Create: `src/data/passiveTree.js` — data module (keystones, notables, ascendancies, stat translation)
- Create: `test/passiveTree.test.js` — unit tests
- Modify: `src/routes/pages.js` — add routes
- Create: `views/keystones.njk` — keystones browser
- Create: `views/keystone.njk` — keystone detail
- Create: `views/ascendancies.njk` — ascendancy browser
- Create: `views/ascendancy.njk` — ascendancy detail
- Modify: `public/css/gem-card.css` — passive node card styles
- Modify: `src/data/search.js` — add keystones to search index
- Modify: `views/home.njk` — link to keystones page
- Modify: `test/server.test.js` — smoke tests for new routes

---

### Task 1: Write failing tests for passiveTree.js

**Files:**
- Create: `test/passiveTree.test.js`

- [ ] **Step 1: Write the failing tests**

```js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { listKeystones, getKeystone, listNotables, getNotable, listAscendancies, getAscendancy } from '../src/data/passiveTree.js';

describe('passiveTree', () => {
  describe('listKeystones', () => {
    it('returns 33 keystones', () => {
      assert.equal(listKeystones().length, 33);
    });
    it('each keystone has id, name, iconUrl, statLines', () => {
      const k = listKeystones()[0];
      assert.ok(k.id);
      assert.ok(k.name);
      assert.ok(typeof k.iconUrl === 'string');
      assert.ok(Array.isArray(k.statLines));
    });
  });

  describe('getKeystone', () => {
    it('returns Zealots Oath by id', () => {
      const k = getKeystone('passive_keystone_zealots_oath');
      assert.ok(k);
      assert.equal(k.name, "Zealot's Oath");
      assert.equal(k.id, 'passive_keystone_zealots_oath');
    });
    it('Zealots Oath statLines contains energy shield text', () => {
      const k = getKeystone('passive_keystone_zealots_oath');
      const joined = k.statLines.join('\n');
      // raw game text with markup preserved
      assert.ok(joined.includes('[EnergyShield|Energy Shield]') || joined.includes('Energy Shield'));
    });
    it('iconUrl resolves to CDN URL', () => {
      const k = getKeystone('passive_keystone_zealots_oath');
      assert.ok(k.iconUrl.startsWith('https://'));
    });
    it('returns null for unknown id', () => {
      assert.equal(getKeystone('nonexistent_id'), null);
    });
  });

  describe('listNotables', () => {
    it('returns 974 non-ascendancy notables', () => {
      assert.equal(listNotables().length, 974);
    });
    it('each notable has id, name, statLines', () => {
      const n = listNotables()[0];
      assert.ok(n.id);
      assert.ok(n.name);
      assert.ok(Array.isArray(n.statLines));
    });
  });

  describe('getNotable', () => {
    it('returns Fast Acting Toxins by id', () => {
      const n = getNotable('ailments38');
      assert.ok(n);
      assert.equal(n.name, 'Fast Acting Toxins');
    });
    it('Fast Acting Toxins statLines includes damage text', () => {
      const n = getNotable('ailments38');
      const joined = n.statLines.join(' ');
      assert.ok(joined.includes('12'));
    });
    it('returns null for unknown id', () => {
      assert.equal(getNotable('nope'), null);
    });
  });

  describe('listAscendancies', () => {
    it('returns 23 valid ascendancies', () => {
      assert.equal(listAscendancies().length, 23);
    });
    it('each ascendancy has id, name, charClass, notables array', () => {
      const a = listAscendancies()[0];
      assert.ok(a.id);
      assert.ok(a.name);
      assert.ok(a.charClass);
      assert.ok(Array.isArray(a.notables));
    });
  });

  describe('getAscendancy', () => {
    it('returns Deadeye by id Ranger1', () => {
      const a = getAscendancy('Ranger1');
      assert.ok(a);
      assert.equal(a.name, 'Deadeye');
      assert.equal(a.charClass, 'Ranger');
    });
    it('Deadeye has notables', () => {
      const a = getAscendancy('Ranger1');
      assert.ok(a.notables.length > 0);
    });
    it('returns null for unknown id', () => {
      assert.equal(getAscendancy('Blah99'), null);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/chancock/git/poe2wiki && node --test test/passiveTree.test.js 2>&1 | head -20
```

Expected: FAIL with "Cannot find module '../src/data/passiveTree.js'"

---

### Task 2: Implement src/data/passiveTree.js

**Files:**
- Create: `src/data/passiveTree.js`

- [ ] **Step 1: Write the implementation**

```js
import { loadJson } from './loader.js';
import { ddsUrl } from './images.js';

const REPOE = 'repoe-poe2';

let _passives = null;
let _statMap = null;
let _ascData = null;

function buildStatMap() {
  if (_statMap) return;
  const passive = loadJson(`${REPOE}/stat_translations/passive_skill_stat_descriptions.json`);
  const general = loadJson(`${REPOE}/stat_translations/stat_descriptions.json`);
  _statMap = new Map();
  // general first so passive overrides
  for (const entry of general) {
    const eng = entry.English?.[0];
    if (!eng) continue;
    for (const id of entry.ids ?? []) {
      _statMap.set(id, eng);
    }
  }
  for (const entry of passive) {
    const eng = entry.English?.[0];
    if (!eng) continue;
    for (const id of entry.ids ?? []) {
      _statMap.set(id, eng);
    }
  }
}

function translateStats(stats) {
  buildStatMap();
  const lines = [];
  for (const [id, val] of Object.entries(stats)) {
    const entry = _statMap.get(id);
    if (!entry) continue;
    if (entry.format?.[0] === 'ignore') {
      lines.push(entry.string);
    } else {
      lines.push(entry.string.replace('{0}', val));
    }
  }
  return lines;
}

function buildIndex() {
  if (_passives) return;
  const tree = loadJson(`${REPOE}/passive_skill_trees/Default.json`);
  _passives = tree.passives;
}

function buildAscData() {
  if (_ascData) return;
  const raw = loadJson(`${REPOE}/ascendancies.json`);
  _ascData = new Map();
  for (const [id, v] of Object.entries(raw)) {
    if (v.disabled || v.name.includes('[DNT')) continue;
    _ascData.set(id, { id, name: v.name, charClass: v.character[1] });
  }
}

function nodeRecord(p) {
  return {
    id: p.id,
    name: p.name,
    iconUrl: ddsUrl(p.icon),
    statLines: translateStats(p.stats ?? {}),
    flavourText: p.flavour_text || '',
    reminderText: Array.isArray(p.reminder_text) ? p.reminder_text : [],
    ascendancy: p.ascendancy ?? null,
  };
}

export function listKeystones() {
  buildIndex();
  return Object.values(_passives)
    .filter((p) => p.is_keystone)
    .map(nodeRecord)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function getKeystone(id) {
  buildIndex();
  const p = Object.values(_passives).find((n) => n.is_keystone && n.id === id);
  return p ? nodeRecord(p) : null;
}

export function listNotables() {
  buildIndex();
  return Object.values(_passives)
    .filter((p) => p.is_notable && !p.ascendancy)
    .map(nodeRecord)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function getNotable(id) {
  buildIndex();
  const p = Object.values(_passives).find((n) => n.is_notable && !n.ascendancy && n.id === id);
  return p ? nodeRecord(p) : null;
}

export function listAscendancies() {
  buildAscData();
  buildIndex();
  return Array.from(_ascData.values())
    .map((a) => ({
      ...a,
      notables: Object.values(_passives)
        .filter((p) => p.is_notable && p.ascendancy === a.id)
        .map(nodeRecord)
        .sort((x, y) => x.name.localeCompare(y.name)),
    }))
    .sort((a, b) => a.charClass.localeCompare(b.charClass) || a.name.localeCompare(b.name));
}

export function getAscendancy(ascId) {
  buildAscData();
  buildIndex();
  const a = _ascData.get(ascId);
  if (!a) return null;
  return {
    ...a,
    notables: Object.values(_passives)
      .filter((p) => p.is_notable && p.ascendancy === ascId)
      .map(nodeRecord)
      .sort((x, y) => x.name.localeCompare(y.name)),
  };
}
```

- [ ] **Step 2: Run tests**

```bash
cd /Users/chancock/git/poe2wiki && node --test test/passiveTree.test.js 2>&1
```

Expected: all tests pass.

---

### Task 3: Add routes

**Files:**
- Modify: `src/routes/pages.js`

- [ ] **Step 1: Add passive tree routes**

Add to `registerPages`:

```js
import { listKeystones, getKeystone, listAscendancies, getAscendancy } from '../data/passiveTree.js';

app.get('/keystones', (_req, res) => {
  res.render('keystones.njk', { keystones: listKeystones() });
});
app.get('/keystone/:id', (req, res) => {
  const k = getKeystone(req.params.id);
  if (!k) return res.status(404).render('home.njk', { notFound: req.params.id });
  res.render('keystone.njk', { k });
});
app.get('/ascendancies', (_req, res) => {
  res.render('ascendancies.njk', { ascendancies: listAscendancies() });
});
app.get('/ascendancy/:id', (req, res) => {
  const a = getAscendancy(req.params.id);
  if (!a) return res.status(404).render('home.njk', { notFound: req.params.id });
  res.render('ascendancy.njk', { a });
});
```

---

### Task 4: Create views

**Files:**
- Create: `views/keystones.njk`
- Create: `views/keystone.njk`
- Create: `views/ascendancies.njk`
- Create: `views/ascendancy.njk`

- [ ] **Step 1: keystones.njk**

```njk
{% extends "base.njk" %}
{% block title %}Keystones — PoE2 Wiki{% endblock %}
{% block content %}
<div class="page" style="flex-direction:column;align-items:center;">
  <h1 class="page-title" style="font-family:'OptimusPrincepsSemiBold',serif;color:var(--color-normal);">
    Keystones
  </h1>
  <p class="page-subtitle">{{ keystones.length }} keystones</p>
  <div class="passive-node-grid">
    {% for k in keystones %}
    <a class="passive-node-card" href="/keystone/{{ k.id }}">
      {% if k.iconUrl %}
      <img class="passive-node-icon" src="{{ k.iconUrl }}" alt="{{ k.name }}" onerror="this.style.visibility='hidden'">
      {% endif %}
      <div class="passive-node-name">{{ k.name }}</div>
      {% if k.statLines.length %}
      <div class="passive-node-stats">
        {% for line in k.statLines %}
        <div>{{ line | renderGameText | safe }}</div>
        {% endfor %}
      </div>
      {% endif %}
    </a>
    {% endfor %}
  </div>
</div>
{% endblock %}
```

- [ ] **Step 2: keystone.njk**

```njk
{% extends "base.njk" %}
{% block title %}{{ k.name }} — PoE2 Wiki{% endblock %}
{% block content %}
<div class="page" style="flex-direction:column;align-items:center;">
  <nav class="bases-breadcrumb">
    <a href="/keystones">Keystones</a> › {{ k.name }}
  </nav>
  <div class="passive-detail-card">
    {% if k.iconUrl %}
    <img class="passive-detail-icon" src="{{ k.iconUrl }}" alt="{{ k.name }}" onerror="this.style.visibility='hidden'">
    {% endif %}
    <h1 class="passive-detail-name">{{ k.name }}</h1>
    {% if k.statLines.length %}
    <div class="passive-detail-stats">
      {% for line in k.statLines %}
      <div class="explicitMod">{{ line | renderGameText | safe }}</div>
      {% endfor %}
    </div>
    {% endif %}
    {% if k.flavourText %}
    <div class="FlavourText passive-detail-flavour">{{ k.flavourText }}</div>
    {% endif %}
  </div>
</div>
{% endblock %}
```

- [ ] **Step 3: ascendancies.njk**

```njk
{% extends "base.njk" %}
{% block title %}Ascendancies — PoE2 Wiki{% endblock %}
{% block content %}
<div class="page" style="flex-direction:column;align-items:center;">
  <h1 class="page-title" style="font-family:'OptimusPrincepsSemiBold',serif;color:var(--color-normal);">
    Ascendancies
  </h1>
  <p class="page-subtitle">{{ ascendancies.length }} ascendancies</p>
  <div class="asc-grid">
    {% for a in ascendancies %}
    <a class="asc-card" href="/ascendancy/{{ a.id }}">
      <div class="asc-class">{{ a.charClass }}</div>
      <div class="asc-name">{{ a.name }}</div>
      <div class="asc-count">{{ a.notables.length }} notables</div>
    </a>
    {% endfor %}
  </div>
</div>
{% endblock %}
```

- [ ] **Step 4: ascendancy.njk**

```njk
{% extends "base.njk" %}
{% block title %}{{ a.name }} — PoE2 Wiki{% endblock %}
{% block content %}
<div class="page" style="flex-direction:column;align-items:center;">
  <nav class="bases-breadcrumb">
    <a href="/ascendancies">Ascendancies</a> › {{ a.charClass }} › {{ a.name }}
  </nav>
  <h1 class="page-title" style="font-family:'OptimusPrincepsSemiBold',serif;color:var(--color-normal);">
    {{ a.name }}
    <span style="font-size:14px;color:var(--color-default);margin-left:8px;">({{ a.charClass }})</span>
  </h1>
  <div class="passive-node-grid">
    {% for n in a.notables %}
    <div class="passive-node-card passive-node-card--asc">
      {% if n.iconUrl %}
      <img class="passive-node-icon" src="{{ n.iconUrl }}" alt="{{ n.name }}" onerror="this.style.visibility='hidden'">
      {% endif %}
      <div class="passive-node-name">{{ n.name }}</div>
      {% if n.statLines.length %}
      <div class="passive-node-stats">
        {% for line in n.statLines %}
        <div>{{ line | renderGameText | safe }}</div>
        {% endfor %}
      </div>
      {% endif %}
    </div>
    {% endfor %}
  </div>
</div>
{% endblock %}
```

---

### Task 5: Add CSS styles

**Files:**
- Modify: `public/css/gem-card.css`

- [ ] **Step 1: Add passive node styles**

Append to `gem-card.css`:

```css
/* --- Passive tree nodes --- */
.passive-node-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 12px;
  width: 100%;
  max-width: 900px;
  padding: 16px 0;
}
.passive-node-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 6px;
  padding: 12px;
  background: rgba(0,0,0,0.5);
  border: 1px solid rgba(139,139,139,0.4);
  border-radius: 4px;
  color: var(--color-default);
  text-decoration: none;
  transition: border-color 0.15s;
}
.passive-node-card:hover {
  border-color: rgba(200,200,200,0.6);
}
.passive-node-card--asc {
  cursor: default;
}
.passive-node-icon {
  width: 48px;
  height: 48px;
  object-fit: contain;
}
.passive-node-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-normal);
}
.passive-node-stats {
  font-size: 11px;
  color: var(--color-default);
  line-height: 1.4;
}
/* Keystone detail */
.passive-detail-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 12px;
  padding: 24px;
  background: rgba(0,0,0,0.5);
  border: 1px solid rgba(139,139,139,0.4);
  border-radius: 4px;
  max-width: 480px;
  width: 100%;
  margin-top: 16px;
}
.passive-detail-icon {
  width: 72px;
  height: 72px;
  object-fit: contain;
}
.passive-detail-name {
  font-family: 'OptimusPrincepsSemiBold', serif;
  font-size: 20px;
  color: var(--color-normal);
  margin: 0;
}
.passive-detail-stats {
  width: 100%;
}
.passive-detail-flavour {
  font-style: italic;
  font-size: 12px;
  margin-top: 4px;
}
/* Ascendancy grid */
.asc-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 12px;
  width: 100%;
  max-width: 800px;
  padding: 16px 0;
}
.asc-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 4px;
  padding: 14px 10px;
  background: rgba(0,0,0,0.5);
  border: 1px solid rgba(139,139,139,0.4);
  border-radius: 4px;
  color: var(--color-default);
  text-decoration: none;
  transition: border-color 0.15s;
}
.asc-card:hover { border-color: rgba(200,200,200,0.6); }
.asc-class { font-size: 10px; color: var(--color-default); text-transform: uppercase; letter-spacing: 0.08em; }
.asc-name { font-size: 14px; color: var(--color-normal); font-weight: 600; }
.asc-count { font-size: 10px; color: var(--color-default); opacity: 0.7; }
```

---

### Task 6: Wire navigation and search

**Files:**
- Modify: `src/data/search.js`
- Modify: `views/home.njk`

- [ ] **Step 1: Add keystones to search**

In `src/data/search.js`, import `listKeystones` and add to `docs()`:

```js
import { listKeystones } from './passiveTree.js';
// ...
const keystones = listKeystones().map(k => ({
  name: k.name, slug: k.id, url: `/keystone/${k.id}`,
  haystack: k.name.toLowerCase(),
}));
_docs = [...gems, ...uniques, ...bases, ...keystones];
```

- [ ] **Step 2: Add home page link**

In `views/home.njk`, add two links after the mods link:

```njk
<a href="/keystones" style="color:var(--color-normal);">Browse Keystones →</a>
<a href="/ascendancies" style="color:var(--color-normal);">Browse Ascendancies →</a>
```

---

### Task 7: Add smoke tests and run full suite

**Files:**
- Modify: `test/server.test.js`

- [ ] **Step 1: Add route smoke tests**

```js
it('GET /keystones returns 200', async () => {
  const res = await request(app).get('/keystones');
  assert.equal(res.status, 200);
  assert.ok(res.text.includes('Keystones'));
});
it('GET /keystone/passive_keystone_zealots_oath returns 200', async () => {
  const res = await request(app).get('/keystone/passive_keystone_zealots_oath');
  assert.equal(res.status, 200);
  assert.ok(res.text.includes("Zealot"));
});
it('GET /ascendancies returns 200', async () => {
  const res = await request(app).get('/ascendancies');
  assert.equal(res.status, 200);
  assert.ok(res.text.includes('Ascendancies'));
});
it('GET /ascendancy/Ranger1 returns 200', async () => {
  const res = await request(app).get('/ascendancy/Ranger1');
  assert.equal(res.status, 200);
  assert.ok(res.text.includes('Deadeye'));
});
```

- [ ] **Step 2: Run full test suite**

```bash
cd /Users/chancock/git/poe2wiki && npm test 2>&1
```

Expected: all tests pass including the new passiveTree.test.js and server.test.js.

---

### Task 8: Verify and commit

- [ ] **Step 1: Start server and spot-check**

```bash
cd /Users/chancock/git/poe2wiki && npm start &
sleep 2
curl -s http://localhost:3000/keystones | grep -o 'Keystones'
curl -s http://localhost:3000/keystone/passive_keystone_zealots_oath | grep -o "Zealot"
curl -s http://localhost:3000/ascendancies | grep -o 'Ascendancies'
curl -s http://localhost:3000/ascendancy/Ranger1 | grep -o 'Deadeye'
```

- [ ] **Step 2: Commit**

```bash
git add src/data/passiveTree.js test/passiveTree.test.js \
  src/routes/pages.js src/data/search.js views/home.njk \
  views/keystones.njk views/keystone.njk views/ascendancies.njk views/ascendancy.njk \
  public/css/gem-card.css test/server.test.js
git commit -m "feat: passive tree keystones and ascendancy browsers"
```

- [ ] **Step 3: Archive plan**

```bash
mv docs/superpowers/plans/2026-06-15-passive-tree.md docs/superpowers/archive/
```
