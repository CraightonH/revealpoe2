# Wiki Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up an Express + HTMX + Nunjucks Node.js server that renders a faithful, data-driven skill gem card (matching `docs/ui/skill-gem-card.html`) for any PoE2 skill gem, with a data access layer, themeable color system, and full-text search.

**Architecture:** A thin data access layer (`src/data/`) loads the JSON files from `$POE2DATADIR` once at startup and exposes typed query functions. Express routes call those functions and render Nunjucks templates. The skill gem card is a Nunjucks macro driven by a normalized view-model so the same markup renders any gem. HTMX powers search-as-you-type by returning HTML fragments. CSS uses custom properties: game colors are immutable tokens, surface colors swap per `data-theme`.

**Tech Stack:** Node.js (v25, ESM), Express 5, Nunjucks, HTMX (vendored), `node:test` + Supertest for tests, dotenv for env loading.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `package.json` | Deps, scripts (`start`, `dev`, `test`), `"type": "module"` |
| `.nvmrc` | Pin Node version |
| `src/config.js` | Load `.env`, resolve + validate `POE2DATADIR`, expand `~` |
| `src/data/loader.js` | Read + cache JSON files from data dir; lazy per-file |
| `src/data/slug.js` | `slugify()` / display-name ↔ slug mapping |
| `src/data/keywords.js` | Parse `[Id\|Display]` tokens in game text → safe HTML |
| `src/data/gems.js` | Gem queries: `getGem`, `listGems`, `getRecommendedSupports`, `buildGemViewModel` |
| `src/data/images.js` | `iconUrl()`, `gemHoverImageUrl()`, `placeholder()` from spec |
| `src/data/search.js` | Build in-memory search index; `search(q)` |
| `src/server.js` | Express app factory + Nunjucks config (exported for tests) |
| `src/routes/pages.js` | `/`, `/gem/:slug` routes |
| `src/routes/search.js` | `/search` HTMX fragment route |
| `src/index.js` | Entry point — boot data, start listening |
| `views/base.njk` | HTML shell, theme attr, font + HTMX includes |
| `views/macros/gem-card.njk` | Skill gem card macro (port of reference) |
| `views/gem.njk` | Gem detail page |
| `views/home.njk` | Homepage with search box |
| `views/partials/search-results.njk` | HTMX search result fragment |
| `public/css/tokens.css` | Color + theme custom properties |
| `public/css/gem-card.css` | Gem card styles (port of reference) |
| `public/css/app.css` | Layout, search, site chrome |
| `public/vendor/htmx.min.js` | Vendored HTMX |
| `public/fonts.css` | `@font-face` from poecdn |
| `test/*.test.js` | One test file per `src/data/*` module + route tests |

---

## Task 1: Project scaffold

**Files:**
- Create: `package.json`, `.nvmrc`, `src/index.js`, `src/server.js`
- Test: `test/server.test.js`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "poe2wiki",
  "version": "0.1.0",
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "start": "node src/index.js",
    "dev": "node --watch src/index.js",
    "test": "node --test"
  },
  "dependencies": {
    "dotenv": "^16.4.5",
    "express": "^5.1.0",
    "nunjucks": "^3.2.4"
  },
  "devDependencies": {
    "supertest": "^7.0.0"
  }
}
```

- [ ] **Step 2: Create `.nvmrc`**

```
25
```

- [ ] **Step 3: Install deps**

Run: `npm install`
Expected: `node_modules/` created, no errors. (`node_modules/` is already gitignored.)

- [ ] **Step 4: Write failing test for the app factory**

Create `test/server.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/server.js';

test('GET /healthz returns ok', async () => {
  const app = createApp();
  const res = await request(app).get('/healthz');
  assert.equal(res.status, 200);
  assert.equal(res.text, 'ok');
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot find module `../src/server.js`.

- [ ] **Step 6: Create minimal `src/server.js`**

```js
import express from 'express';

export function createApp() {
  const app = express();
  app.get('/healthz', (_req, res) => res.type('text/plain').send('ok'));
  return app;
}
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 8: Create `src/index.js` entry point**

```js
import { createApp } from './server.js';

const port = process.env.PORT || 3000;
createApp().listen(port, () => {
  console.log(`poe2wiki listening on http://localhost:${port}`);
});
```

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json .nvmrc src/server.js src/index.js test/server.test.js
git commit -m "feat: scaffold express app with health check"
```

---

## Task 2: Config — resolve and validate data dir

**Files:**
- Create: `src/config.js`
- Test: `test/config.test.js`

- [ ] **Step 1: Write failing test**

Create `test/config.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expandHome } from '../src/config.js';
import os from 'node:os';

test('expandHome expands leading ~', () => {
  assert.equal(expandHome('~/git/poe2data'), `${os.homedir()}/git/poe2data`);
});

test('expandHome leaves absolute paths untouched', () => {
  assert.equal(expandHome('/abs/path'), '/abs/path');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/config.test.js`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Create `src/config.js`**

```js
import 'dotenv/config';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

export function expandHome(p) {
  if (p && p.startsWith('~')) return path.join(os.homedir(), p.slice(1));
  return p;
}

export function getDataDir() {
  const raw = process.env.POE2DATADIR;
  if (!raw) throw new Error('POE2DATADIR is not set (check .env)');
  const dir = path.join(expandHome(raw), 'data');
  if (!fs.existsSync(dir)) {
    throw new Error(`POE2DATADIR data dir not found: ${dir}`);
  }
  return dir;
}

export const REPOE = 'repoe-poe2';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/config.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/config.js test/config.test.js
git commit -m "feat: data dir config resolution with ~ expansion"
```

---

## Task 3: JSON loader with caching

**Files:**
- Create: `src/data/loader.js`
- Test: `test/loader.test.js`

- [ ] **Step 1: Write failing test**

Create `test/loader.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadJson } from '../src/data/loader.js';

test('loadJson reads a known repoe file and caches it', () => {
  const a = loadJson('repoe-poe2/gem_tags.json');
  assert.ok(a.fire, 'expected a "fire" gem tag key');
  const b = loadJson('repoe-poe2/gem_tags.json');
  assert.equal(a, b, 'second call should return the cached object reference');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/loader.test.js`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Create `src/data/loader.js`**

```js
import fs from 'node:fs';
import path from 'node:path';
import { getDataDir } from '../config.js';

const cache = new Map();

// relPath is relative to the data dir, e.g. "repoe-poe2/skill_gems.json"
export function loadJson(relPath) {
  if (cache.has(relPath)) return cache.get(relPath);
  const full = path.join(getDataDir(), relPath);
  const parsed = JSON.parse(fs.readFileSync(full, 'utf8'));
  cache.set(relPath, parsed);
  return parsed;
}

export function clearCache() {
  cache.clear();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/loader.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/data/loader.js test/loader.test.js
git commit -m "feat: cached JSON loader"
```

---

## Task 4: Slug helper

**Files:**
- Create: `src/data/slug.js`
- Test: `test/slug.test.js`

- [ ] **Step 1: Write failing test**

Create `test/slug.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slugify } from '../src/data/slug.js';

test('slugify lowercases and hyphenates', () => {
  assert.equal(slugify('Herald of Ash'), 'herald-of-ash');
});

test('slugify strips punctuation', () => {
  assert.equal(slugify("Alchemist's Boon"), 'alchemists-boon');
});

test('slugify collapses repeated separators', () => {
  assert.equal(slugify('Spark  —  Nova'), 'spark-nova');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/slug.test.js`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Create `src/data/slug.js`**

```js
export function slugify(name) {
  return String(name)
    .toLowerCase()
    .replace(/['']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/slug.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/data/slug.js test/slug.test.js
git commit -m "feat: slugify helper"
```

---

## Task 5: Keyword token parser

Game text embeds tokens like `[Overkill]` and `[Attack|Attacks]` (id before `|`, display after; no pipe means id == display). Render them as styled spans now; the `data-keyword` attribute sets up hover glossary popovers later.

**Files:**
- Create: `src/data/keywords.js`
- Test: `test/keywords.test.js`

- [ ] **Step 1: Write failing test**

Create `test/keywords.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderGameText } from '../src/data/keywords.js';

test('plain text passes through escaped', () => {
  assert.equal(renderGameText('100% more & cooler'), '100% more &amp; cooler');
});

test('token without pipe uses id as display', () => {
  assert.equal(
    renderGameText('enemies you [Overkill]'),
    'enemies you <span class="kw" data-keyword="Overkill">Overkill</span>'
  );
});

test('token with pipe uses display text after pipe', () => {
  assert.equal(
    renderGameText('non-[Attack|Attacks]'),
    'non-<span class="kw" data-keyword="Attack">Attacks</span>'
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/keywords.test.js`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Create `src/data/keywords.js`**

```js
function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Convert "[Id]" / "[Id|Display]" tokens to styled spans; escape the rest.
export function renderGameText(text) {
  if (text == null) return '';
  let out = '';
  let last = 0;
  const re = /\[([^\]|]+)(?:\|([^\]]+))?\]/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    out += escapeHtml(text.slice(last, m.index));
    const id = m[1];
    const display = m[2] ?? m[1];
    out += `<span class="kw" data-keyword="${escapeHtml(id)}">${escapeHtml(display)}</span>`;
    last = re.lastIndex;
  }
  out += escapeHtml(text.slice(last));
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/keywords.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/data/keywords.js test/keywords.test.js
git commit -m "feat: keyword token parser for game text"
```

---

## Task 6: Image URL + placeholder helper

Ports the helper from `$POE2DATADIR/docs/image-assets.md` plus the gem hover background. Gem records carry `ui_image` (the hover bg dds path) and `icon_dds_file` (skill icon) directly.

**Files:**
- Create: `src/data/images.js`
- Test: `test/images.test.js`

- [ ] **Step 1: Write failing test**

Create `test/images.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ddsUrl, placeholder } from '../src/data/images.js';

test('ddsUrl builds a ggpk webp url from a dds path', () => {
  assert.equal(
    ddsUrl('Art/2DArt/SkillIcons/4k/HeraldOfAshSkill.dds'),
    'https://image.ggpk.exposed/poe2/Art/2DArt/SkillIcons/4k/HeraldOfAshSkill.dds?format=webp'
  );
});

test('ddsUrl returns null for falsy input', () => {
  assert.equal(ddsUrl(null), null);
});

test('placeholder is deterministic for the same key', () => {
  const a = placeholder({ name: 'Herald of Ash', color: 'r' });
  const b = placeholder({ name: 'Herald of Ash', color: 'r' });
  assert.deepEqual(a, b);
  assert.equal(a.initials, 'HO');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/images.test.js`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Create `src/data/images.js`**

```js
const GGPK = 'https://image.ggpk.exposed/poe2';

// Convert an in-game dds asset path to a renderable ggpk webp URL.
export function ddsUrl(ddsPath, format = 'webp') {
  if (!ddsPath) return null;
  return `${GGPK}/${ddsPath}?format=${format}`;
}

const GEM_HUE = { r: 0, g: 120, b: 240, w: 0 };

// Deterministic placeholder descriptor — works with zero network.
export function placeholder(record) {
  const name = record?.name ?? record?.id ?? '?';
  const initials = name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  const hue = GEM_HUE[record?.color] ?? 0;
  const sat = record?.color === 'w' ? 0 : 45;
  return { label: name, initials, hue, sat };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/images.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/data/images.js test/images.test.js
git commit -m "feat: image url + placeholder helper"
```

---

## Task 7: Gem queries + view-model

Resolves a gem by slug and builds a normalized view-model the template renders. Handles the inconsistent `Metadata/Items/Gem` vs `Gems` key prefixes by indexing on slug, not raw key. Border color is derived from `color`. Description comes from the granted active skill; explicit-mod lines come from the skill stat_set `stat_text` (already human-readable).

**Files:**
- Create: `src/data/gems.js`
- Test: `test/gems.test.js`

- [ ] **Step 1: Write failing test**

Create `test/gems.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getGem, buildGemViewModel, listGems } from '../src/data/gems.js';

test('listGems returns active + support gems with slugs', () => {
  const gems = listGems();
  assert.ok(gems.length > 500);
  assert.ok(gems.every((g) => g.slug && g.name));
});

test('getGem resolves Herald of Ash by slug', () => {
  const gem = getGem('herald-of-ash');
  assert.equal(gem.base_item.display_name, 'Herald of Ash');
  assert.equal(gem.color, 'r');
});

test('buildGemViewModel produces card fields', () => {
  const vm = buildGemViewModel('herald-of-ash');
  assert.equal(vm.name, 'Herald of Ash');
  assert.equal(vm.attribute, 'r');
  assert.equal(vm.borderColor, 'rgba(139,48,48,0.7)');
  assert.ok(vm.skillIconUrl.includes('HeraldOfAshSkill'));
  assert.ok(vm.hoverImageUrl.includes('GemHoverImage'));
  assert.ok(vm.tags.includes('fire'));
  assert.match(vm.description, /<span class="kw"/); // tokens rendered
  assert.ok(vm.recommendedSupports.length > 0);
  assert.ok(vm.recommendedSupports[0].slug);
});

test('getGem returns null for unknown slug', () => {
  assert.equal(getGem('not-a-real-gem'), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/gems.test.js`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Create `src/data/gems.js`**

```js
import { loadJson } from './loader.js';
import { slugify } from './slug.js';
import { renderGameText } from './keywords.js';
import { ddsUrl } from './images.js';

const REPOE = 'repoe-poe2';

const BORDER = {
  r: { border: 'rgba(139,48,48,0.7)', glow: 'rgba(139,48,48,0.45)' },
  g: { border: 'rgba(48,100,48,0.7)', glow: 'rgba(48,100,48,0.45)' },
  b: { border: 'rgba(48,48,139,0.7)', glow: 'rgba(48,48,139,0.45)' },
  w: { border: 'rgba(100,100,100,0.7)', glow: 'rgba(100,100,100,0.45)' },
};

let _index = null;

// slug -> raw gem record. Built once.
function index() {
  if (_index) return _index;
  const gems = loadJson(`${REPOE}/skill_gems.json`);
  _index = new Map();
  for (const [key, rec] of Object.entries(gems)) {
    const name = rec?.base_item?.display_name;
    if (!name) continue;
    const slug = slugify(name);
    // First write wins; both Gem/Gems prefixes map to same display name.
    if (!_index.has(slug)) _index.set(slug, { key, ...rec });
  }
  return _index;
}

export function listGems() {
  return [...index().entries()].map(([slug, rec]) => ({
    slug,
    name: rec.base_item.display_name,
    color: rec.color,
    gemType: rec.gem_type,
  }));
}

export function getGem(slug) {
  return index().get(slug) ?? null;
}

// Resolve recommended_supports[] keys (which use mixed Gem/Gems prefixes)
// to {slug, name, color} by matching on the support's display name.
export function getRecommendedSupports(gem) {
  const gems = loadJson(`${REPOE}/skill_gems.json`);
  const out = [];
  for (const key of gem.recommended_supports ?? []) {
    const rec = gems[key];
    if (!rec?.base_item?.display_name) continue;
    out.push({
      slug: slugify(rec.base_item.display_name),
      name: rec.base_item.display_name,
      color: rec.color,
    });
  }
  return out;
}

// Pull human-readable explicit-mod lines from the granted skill's stat_set.
function explicitMods(gem) {
  const grants = gem.grants_skills?.[0];
  if (!grants) return { description: null, mods: [] };
  const skills = loadJson(`${REPOE}/skills.json`);
  const skill = skills[grants];
  if (!skill) return { description: null, mods: [] };
  const description = skill.active_skill?.description ?? null;
  const set = skill.stat_sets?.[0];
  const statText = set?.static?.stat_text ?? {};
  const mods = Object.values(statText).filter((t) => t && t.trim().length > 0);
  return { description, mods };
}

export function buildGemViewModel(slug) {
  const gem = getGem(slug);
  if (!gem) return null;
  const { description, mods } = explicitMods(gem);
  const b = BORDER[gem.color] ?? BORDER.w;
  return {
    slug,
    name: gem.base_item.display_name,
    attribute: gem.color,
    gemType: gem.gem_type,
    borderColor: b.border,
    glowColor: b.glow,
    typeLine: gem.gem_type === 'support' ? 'Support' : 'Skill',
    tags: gem.tags ?? [],
    craftingLevel: gem.crafting_level ?? null,
    skillIconUrl: ddsUrl(gem.icon_dds_file),
    hoverImageUrl: ddsUrl(gem.ui_image),
    description: description ? renderGameText(description) : null,
    mods: mods.map(renderGameText),
    supportText: gem.support_text ? renderGameText(gem.support_text) : null,
    recommendedSupports: getRecommendedSupports(gem),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/gems.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/data/gems.js test/gems.test.js
git commit -m "feat: gem queries and card view-model"
```

---

## Task 8: CSS — tokens, fonts, gem card

Port the styles from `docs/ui/skill-gem-card.html` into shared stylesheets, replacing the hard-coded red border/glow with CSS variables set per-card.

**Files:**
- Create: `public/css/tokens.css`, `public/fonts.css`, `public/css/gem-card.css`, `public/css/app.css`

- [ ] **Step 1: Create `public/css/tokens.css`**

```css
:root {
  --color-normal: #c8c8c8;
  --color-magic: #8888ff;
  --color-rare: #ffff77;
  --color-unique: #af6025;
  --color-gem: #1ba29b;
  --color-gem-r: #c44040;
  --color-gem-g: #4aad4a;
  --color-gem-b: #6666aa;
  --color-gem-w: #aaaaaa;
  --color-fire: #960000;
  --color-cold: #366492;
  --color-lightning: #ffd700;
  --color-chaos: #d02090;
  --color-prop: #6e9a97;
  --color-default: #7f7f7f;
  --color-crafted: #b4b4ff;
}

:root,
:root[data-theme="dark"] {
  --bg-base: #0d0d0d;
  --bg-surface: #16181f;
  --border: #2a2d3d;
  --text: #c8b888;
}

:root[data-theme="light"] {
  --bg-base: #f8f6f0;
  --bg-surface: #eeebe3;
  --border: #ccc8bb;
  --text: #2a2418;
}
```

- [ ] **Step 2: Create `public/fonts.css`**

```css
@font-face {
  font-family: 'FontinSmallCaps';
  src: url('https://web.poecdn.com/font/fontin-smallcaps-webfont.woff') format('woff');
  font-display: swap;
}
@font-face {
  font-family: 'FontinRegular';
  src: url('https://web.poecdn.com/font/fontin-regular-webfont.woff') format('woff');
  font-display: swap;
}
@font-face {
  font-family: 'OptimusPrincepsSemiBold';
  src: url('https://web.poecdn.com/font/OptimusPrincepsSemiBold.ttf') format('truetype');
  font-display: swap;
}
```

- [ ] **Step 3: Create `public/css/gem-card.css`**

Copy every rule from the `<style>` block in `docs/ui/skill-gem-card.html` EXCEPT the `@font-face` blocks (now in `fonts.css`). Then make these two changes so the card is data-driven:

Replace the hard-coded border/box-shadow on `.newItemPopup`:

```css
.newItemPopup {
  font-family: "FontinSmallCaps", "Palatino Linotype", Georgia, serif;
  background-color: var(--bg-base);
  border: 1px solid var(--card-border, rgba(139,48,48,0.7));
  box-shadow:
    0 0 18px var(--card-glow, rgba(139,48,48,0.45)),
    0 0 6px var(--card-glow, rgba(139,48,48,0.3)),
    inset 0 0 20px rgba(0,0,0,0.8);
  max-width: 390px;
  font-size: 13px;
  line-height: 1.4;
  position: relative;
  overflow: hidden;
}
```

Replace the inlined base64 `background-image` on `.bg-art` with a CSS variable:

```css
.newItemPopup .bg-art {
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 175px;
  background-image: var(--hover-image, none);
  background-repeat: no-repeat;
  background-position: right top;
  background-size: cover;
  opacity: 0.45;
  pointer-events: none;
}
```

Keep all other rules (`.itemHeader`, `.leadSkillIcon`, `.itemName`, `.property`, `.requirements`, `.separator`, `.secDescrText`, `.hybridHeader`, `.TextGem.TitleBar`, `.explicitMod`, `.qualityMod`, `.secondaryQualityMod`, `.quality-text`, `.default.fst-italic`) verbatim from the reference.

- [ ] **Step 4: Create `public/css/app.css`**

```css
* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--bg-base);
  color: var(--text);
  font-family: system-ui, sans-serif;
  min-height: 100vh;
}
.site-header {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 20px;
  background: var(--bg-surface);
  border-bottom: 1px solid var(--border);
}
.site-header a.brand {
  font-family: "OptimusPrincepsSemiBold", serif;
  color: var(--color-unique);
  text-decoration: none;
  font-size: 20px;
}
.search-box { flex: 1; max-width: 480px; }
.search-box input {
  width: 100%;
  padding: 8px 12px;
  background: var(--bg-base);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  font-size: 14px;
}
.search-results {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: 6px;
  margin-top: 4px;
}
.search-results a {
  display: block;
  padding: 6px 12px;
  color: var(--color-normal);
  text-decoration: none;
}
.search-results a:hover { background: var(--bg-base); }
.page { padding: 24px; display: flex; justify-content: center; }
.support-list { display: flex; flex-wrap: wrap; gap: 6px; padding: 6px 14px 12px; }
.support-list a {
  font-size: 11px;
  padding: 3px 9px;
  border-radius: 4px;
  text-decoration: none;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  color: var(--color-normal);
}
.support-list a.r { border-left: 2px solid var(--color-gem-r); }
.support-list a.g { border-left: 2px solid var(--color-gem-g); }
.support-list a.b { border-left: 2px solid var(--color-gem-b); }
.support-list a.w { border-left: 2px solid var(--color-gem-w); }
```

- [ ] **Step 5: Commit**

```bash
git add public/
git commit -m "feat: css tokens, fonts, and data-driven gem card styles"
```

---

## Task 9: Nunjucks setup + base layout + gem card macro

**Files:**
- Modify: `src/server.js`
- Create: `views/base.njk`, `views/macros/gem-card.njk`, `views/gem.njk`
- Test: `test/render.test.js`

- [ ] **Step 1: Write failing test**

Create `test/render.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/server.js';

test('GET /gem/herald-of-ash renders the card', async () => {
  const res = await request(createApp()).get('/gem/herald-of-ash');
  assert.equal(res.status, 200);
  assert.match(res.text, /Herald of Ash/);
  assert.match(res.text, /newItemPopup/);
  assert.match(res.text, /--card-border:/); // per-card border var set
  assert.match(res.text, /leadSkillIcon/);
});

test('GET /gem/unknown returns 404', async () => {
  const res = await request(createApp()).get('/gem/does-not-exist');
  assert.equal(res.status, 404);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/render.test.js`
Expected: FAIL — route not defined / 404 for both.

- [ ] **Step 3: Wire Nunjucks + static + routes into `src/server.js`**

```js
import express from 'express';
import nunjucks from 'nunjucks';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerPages } from './routes/pages.js';
import { registerSearch } from './routes/search.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

export function createApp() {
  const app = express();

  nunjucks.configure(path.join(root, 'views'), {
    autoescape: true,
    express: app,
    noCache: process.env.NODE_ENV !== 'production',
  });
  app.set('view engine', 'njk');

  app.use('/static', express.static(path.join(root, 'public')));

  app.get('/healthz', (_req, res) => res.type('text/plain').send('ok'));

  registerPages(app);
  registerSearch(app);

  return app;
}
```

- [ ] **Step 4: Create `views/base.njk`**

```html
<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{% block title %}PoE2 Wiki{% endblock %}</title>
  <link rel="stylesheet" href="/static/fonts.css">
  <link rel="stylesheet" href="/static/css/tokens.css">
  <link rel="stylesheet" href="/static/css/app.css">
  <link rel="stylesheet" href="/static/css/gem-card.css">
  <script src="/static/vendor/htmx.min.js" defer></script>
</head>
<body>
  <header class="site-header">
    <a class="brand" href="/">PoE2 Wiki</a>
    <div class="search-box">
      <input type="search" name="q" placeholder="Search gems…"
             hx-get="/search" hx-trigger="input changed delay:200ms, search"
             hx-target="#search-results" autocomplete="off">
      <div id="search-results"></div>
    </div>
  </header>
  <main>{% block content %}{% endblock %}</main>
</body>
</html>
```

- [ ] **Step 5: Create `views/macros/gem-card.njk`**

```html
{% macro gemCard(vm) %}
<div class="newItemPopup GemPopup item-popup--poe2"
     style="--card-border: {{ vm.borderColor }}; --card-glow: {{ vm.glowColor }};
            {% if vm.hoverImageUrl %}--hover-image: url('{{ vm.hoverImageUrl }}');{% endif %}">
  <div class="bg-art"></div>
  <div class="content">
    <div class="itemHeader doubleLine">
      {% if vm.skillIconUrl %}
      <img class="leadSkillIcon" src="{{ vm.skillIconUrl }}"
           onerror="this.style.visibility='hidden'">
      {% endif %}
      <div class="itemName"><span class="lc">{{ vm.name }}</span></div>
      <div class="itemName typeLine"><span class="lc">{{ vm.typeLine }}</span></div>
    </div>

    <div class="Stats">
      {% if vm.tags.length %}
      <div class="property">{{ vm.tags | join(', ') }}</div>
      {% endif %}
      {% if vm.craftingLevel %}
      <div class="property">Level: <span class="colourDefault">{{ vm.craftingLevel }}</span></div>
      {% endif %}

      {% if vm.description %}
      <div class="separator"></div>
      <div class="secDescrText">{{ vm.description | safe }}</div>
      {% endif %}

      {% if vm.supportText %}
      <div class="separator"></div>
      <div class="secDescrText">{{ vm.supportText | safe }}</div>
      {% endif %}
    </div>

    {% if vm.mods.length %}
    <div class="hybridHeader gemTabs">
      <div class="TextGem TitleBar"><span class="ItemType">{{ vm.typeLine }}</span></div>
    </div>
    <div class="Stats">
      {% for mod in vm.mods %}
      <div class="explicitMod">{{ mod | safe }}</div>
      {% endfor %}
    </div>
    {% endif %}

    {% if vm.recommendedSupports.length %}
    <div class="separator"></div>
    <div class="property" style="text-align:center;">Recommended Supports</div>
    <div class="support-list">
      {% for s in vm.recommendedSupports %}
      <a class="{{ s.color }}" href="/gem/{{ s.slug }}">{{ s.name }}</a>
      {% endfor %}
    </div>
    {% endif %}
  </div>
</div>
{% endmacro %}
```

- [ ] **Step 6: Create `views/gem.njk`**

```html
{% extends "base.njk" %}
{% from "macros/gem-card.njk" import gemCard %}
{% block title %}{{ vm.name }} — PoE2 Wiki{% endblock %}
{% block content %}
<div class="page">{{ gemCard(vm) }}</div>
{% endblock %}
```

- [ ] **Step 7: Run test to verify it passes**

Run: `node --test test/render.test.js`
Expected: PASS once `routes/pages.js` exists (next task). For now expect FAIL — `Cannot find module './routes/pages.js'`. That is the trigger for Task 10; do not commit yet.

---

## Task 10: Page routes

**Files:**
- Create: `src/routes/pages.js`, `views/home.njk`

- [ ] **Step 1: Create `src/routes/pages.js`**

```js
import { buildGemViewModel, listGems } from '../data/gems.js';

export function registerPages(app) {
  app.get('/', (_req, res) => {
    res.render('home.njk');
  });

  app.get('/gem/:slug', (req, res) => {
    const vm = buildGemViewModel(req.params.slug);
    if (!vm) return res.status(404).render('home.njk', { notFound: req.params.slug });
    res.render('gem.njk', { vm });
  });

  // expose for warmup/debug
  app.locals.gemCount = () => listGems().length;
}
```

- [ ] **Step 2: Create `views/home.njk`**

```html
{% extends "base.njk" %}
{% block content %}
<div class="page" style="flex-direction:column;align-items:center;">
  <h1 style="font-family:'OptimusPrincepsSemiBold',serif;color:var(--color-unique);">
    Path of Exile 2 Wiki
  </h1>
  {% if notFound %}<p>No gem found for "{{ notFound }}".</p>{% endif %}
  <p>Search for a skill gem above. Try
    <a href="/gem/herald-of-ash" style="color:var(--color-gem);">Herald of Ash</a>.</p>
</div>
{% endblock %}
```

- [ ] **Step 3: Create a temporary search stub so the app boots**

`registerSearch` is referenced by `server.js` but built in Task 11. Create `src/routes/search.js` with a stub now:

```js
export function registerSearch(app) {
  app.get('/search', (req, res) => {
    res.type('html').send('');
  });
}
```

- [ ] **Step 4: Run the render test to verify it passes**

Run: `node --test test/render.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Smoke-test the running server**

Run: `npm start` then in another shell `curl -s localhost:3000/gem/herald-of-ash | grep -c newItemPopup`
Expected: `1` (or more). Stop the server.

- [ ] **Step 6: Commit**

```bash
git add src/routes/pages.js src/routes/search.js views/ src/server.js test/render.test.js
git commit -m "feat: gem detail page and home route"
```

---

## Task 11: Search index + HTMX fragment

**Files:**
- Create: `src/data/search.js`, `views/partials/search-results.njk`
- Modify: `src/routes/search.js`
- Test: `test/search.test.js`

- [ ] **Step 1: Write failing test**

Create `test/search.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { search } from '../src/data/search.js';

test('search finds gems by case-insensitive substring', () => {
  const hits = search('herald');
  assert.ok(hits.some((h) => h.name === 'Herald of Ash'));
  assert.ok(hits.every((h) => h.slug && h.url.startsWith('/gem/')));
});

test('search returns [] for blank query', () => {
  assert.deepEqual(search('  '), []);
});

test('search caps results', () => {
  assert.ok(search('e').length <= 20);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/search.test.js`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Create `src/data/search.js`**

```js
import { listGems } from './gems.js';

let _docs = null;

function docs() {
  if (_docs) return _docs;
  _docs = listGems().map((g) => ({
    name: g.name,
    slug: g.slug,
    color: g.color,
    url: `/gem/${g.slug}`,
    haystack: g.name.toLowerCase(),
  }));
  return _docs;
}

export function search(q, limit = 20) {
  const needle = (q ?? '').trim().toLowerCase();
  if (!needle) return [];
  const out = [];
  for (const d of docs()) {
    if (d.haystack.includes(needle)) {
      out.push({ name: d.name, slug: d.slug, color: d.color, url: d.url });
      if (out.length >= limit) break;
    }
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/search.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Create `views/partials/search-results.njk`**

```html
{% if results.length %}
<div class="search-results">
  {% for r in results %}
  <a href="{{ r.url }}">{{ r.name }}</a>
  {% endfor %}
</div>
{% endif %}
```

- [ ] **Step 6: Replace `src/routes/search.js` with the real implementation**

```js
import { search } from '../data/search.js';

export function registerSearch(app) {
  app.get('/search', (req, res) => {
    const results = search(req.query.q);
    res.render('partials/search-results.njk', { results });
  });
}
```

- [ ] **Step 7: Add a route test for the fragment**

Append to `test/search.test.js`:

```js
import request from 'supertest';
import { createApp } from '../src/server.js';

test('GET /search returns an HTML fragment with links', async () => {
  const res = await request(createApp()).get('/search?q=herald');
  assert.equal(res.status, 200);
  assert.match(res.text, /\/gem\/herald-of-ash/);
  assert.doesNotMatch(res.text, /<html/); // fragment, not full page
});
```

- [ ] **Step 8: Run all tests**

Run: `npm test`
Expected: PASS across all test files.

- [ ] **Step 9: Commit**

```bash
git add src/data/search.js src/routes/search.js views/partials/ test/search.test.js
git commit -m "feat: gem search with htmx fragment results"
```

---

## Task 12: Vendor HTMX + final smoke test

**Files:**
- Create: `public/vendor/htmx.min.js`

- [ ] **Step 1: Vendor HTMX**

Run: `mkdir -p public/vendor && curl -sL https://unpkg.com/htmx.org@2.0.4/dist/htmx.min.js -o public/vendor/htmx.min.js`
Expected: file ~48KB. Verify: `head -c 40 public/vendor/htmx.min.js` shows minified JS.

- [ ] **Step 2: Manual end-to-end check**

Run: `npm start`. In a browser open `http://localhost:3000/gem/herald-of-ash`.
Expected: card renders matching `docs/ui/skill-gem-card.html` — red glow border, hover background art, skill icon in header, teal name, centered description, recommended supports as links. Type "herald" in the search box → dropdown shows Herald of Ash; clicking navigates to the card. Stop the server.

- [ ] **Step 3: Commit**

```bash
git add public/vendor/htmx.min.js
git commit -m "feat: vendor htmx; foundation complete"
```

---

## Self-Review Notes

- **Spec coverage:** color tokens (Task 8) ✓; theming via `data-theme` (Task 8 tokens.css + base.njk) ✓; fonts from poecdn (Task 8) ✓; image URLs + placeholder (Task 6) ✓; gem card structure/border/separator (Tasks 8–9) ✓; routes `/`, `/gem/:slug`, `/search` (Tasks 10–11) ✓; data access layer (Tasks 2–7, 11) ✓.
- **Deferred per spec ("Not Designed Yet"):** `/item/:slug`, `/unique/:slug`, full per-level stat translation, homepage featured content, item/unique cards. The gem card renders human-readable `stat_text` mods now; deep numeric stat scaling via `stat_translations/` is a separate plan.
- **Known simplification:** section splitting (Buff/Explosion) is rendered as a single section from `stat_text`; the reference's two-section split is gem-specific and not generalized here. Flagged for the stat-translation follow-up.
- **`/api/gem/:slug`** from the spec is marked optional and omitted from this plan to keep scope tight; add later if a JSON consumer appears.
