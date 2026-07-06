# Final Graph Cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove every `$POE2DATADIR` read from the wiki app (`src/**`) so the running server reads data exclusively from the build-time graph artifact (`build/graph.json`); the graph builder (`scripts/graph/**`) remains the only thing that reads source.

**Architecture:** Migrate the four remaining runtime source-reads into the graph — keyword glossary becomes first-class `KEYWORD` nodes (definition + derived surface phrases), gem tag tokens are baked onto gem nodes, and `theorycraft` grant names resolve via existing skill nodes. Then relocate the build-only source-I/O modules (`loader.js`, the source bits of `config.js`, `flavour.js`) out of `src/` into `scripts/graph/`. Each migration is parity-first: a temporary test proves the graph-derived output equals the old source-derived output before the old path is deleted.

**Tech Stack:** Node.js (ESM, `>=20`), `node:test` + `node:assert/strict`, Express, Nunjucks. No new dependencies.

## Global Constraints

- App code under `src/**` MUST NOT import `loader.js`, `getDataDir`, `listDataDir`, `REPOE`, or read `$POE2DATADIR` — directly or transitively (except `src/data/graph.js`'s existing import of `scripts/graph/build.js`, which is out of scope and unchanged).
- Builder code under `scripts/graph/**` MAY read `$POE2DATADIR`. That is the ETL and stays.
- `KEYWORD` nodes are created ONLY for keywords with a non-empty `definition` (matches today's `hasDefinition` gating). Keyword node `id` = source keyword id; `slug` = `slugify(id)`; `name` = `entry.term || id`.
- Every source file the build reads MUST be listed in `SOURCE_FILES` in `scripts/graph/build.js` so `meta.sourceHash` covers it. Optional translation files are read defensively (skip if absent) and only hashed if present.
- Commit after each task. No `Co-Authored-By` lines in commit messages.
- Verify command for full suite: `npm test` (its `pretest` runs `build:graph`).

---

### Task 1: Relocate build-only source I/O out of `src/`

Pure refactor, no behavior change. Move the three build-only modules into `scripts/graph/` and repoint the six builder imports. After this task `src/**` still imports them in the four leak modules — those are fixed in later tasks — so this task does NOT yet remove all `src` source-reads; it only moves the *infrastructure*.

**Files:**
- Create: `scripts/graph/source.js` (from the source bits of `src/config.js`)
- Create: `scripts/graph/loader.js` (moved from `src/data/loader.js`)
- Create: `scripts/graph/flavour.js` (moved from `src/data/flavour.js`)
- Modify: `src/config.js` (remove relocated exports; keep `REPOE` re-export shim — see below)
- Modify: `src/data/loader.js` (delete after consumers repointed)
- Modify: `src/data/flavour.js` (delete after consumers repointed)
- Modify: `scripts/graph/build.js`, `scripts/graph/gems.js`, `scripts/graph/bases.js`, `scripts/graph/affixes.js`, `scripts/graph/passives.js`, `scripts/graph/uniques.js` (repoint imports)
- Modify: `src/data/keywordPhrases.js`, `src/data/gemTags.js`, `src/data/theorycraft.js`, `src/data/keywordDefs.js` (repoint their `loader.js`/`config.js` imports to the new build-layer paths — they still read source until later tasks remove them)
- Test: `test/graph/source.test.js` (created), `test/loader.test.js` (moved → `test/graph/loader.test.js`), `test/config.test.js` (deleted)

**Interfaces:**
- Produces: `scripts/graph/source.js` exports `expandHome(p)`, `getDataDir()`, `REPOE` (`'repoe-poe2'`). `scripts/graph/loader.js` exports `loadJson(relPath)`, `clearCache()`, `listDataDir(relDir)`. `scripts/graph/flavour.js` exports `getFlavourLines(visualId)`.

- [ ] **Step 1: Create `scripts/graph/source.js`**

```javascript
// scripts/graph/source.js — build-time source-path resolution. Builder-only.
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

- [ ] **Step 2: Create `scripts/graph/loader.js`** (move from `src/data/loader.js`, repoint its config import)

```javascript
// scripts/graph/loader.js — build-time JSON reader over the source data dir. Builder-only.
import fs from 'node:fs';
import path from 'node:path';
import { getDataDir } from './source.js';

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

// Returns the filenames (not full paths) in a data subdirectory.
export function listDataDir(relDir) {
  const full = path.join(getDataDir(), relDir);
  return fs.readdirSync(full);
}
```

- [ ] **Step 3: Create `scripts/graph/flavour.js`** (move from `src/data/flavour.js`, repoint imports)

```javascript
// scripts/graph/flavour.js — build-time unique flavour-text resolver. Builder-only.
import { loadJson } from './loader.js';
import { REPOE } from './source.js';

let _flavour = null;

function flavour() {
  if (!_flavour) _flavour = loadJson(`${REPOE}/flavour.json`);
  return _flavour;
}

// Strip in-game markup like "<size:30>{…}" wrappers, leaving plain text.
function clean(text) {
  return text
    .replace(/<[^>]+>\{/g, '')
    .replace(/\}$/, '')
    .trim();
}

// Look up a unique's flavour text by its visual_identity.id. The flavour table
// keys sometimes drop a trailing underscore present on the visual id
// (e.g. "FourUniqueSpear14_" → "FourUniqueSpear14"). Returns lines, or null.
export function getFlavourLines(visualId) {
  if (!visualId) return null;
  const table = flavour();
  const raw = table[visualId] ?? table[visualId.replace(/_$/, '')];
  if (!raw) return null;
  return clean(raw)
    .split(/\r\n|\r|\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}
```

- [ ] **Step 4: Repoint the six builder imports**

In each file change the import source to the new build-layer modules:

- `scripts/graph/build.js:5` — `import { getDataDir, REPOE } from '../../src/config.js';` → `import { getDataDir, REPOE } from './source.js';`
- `scripts/graph/gems.js:2-3` — `from '../../src/data/loader.js'` → `from './loader.js'`; `from '../../src/config.js'` → `from './source.js'`
- `scripts/graph/bases.js:1-2` — same two repoints to `./loader.js` and `./source.js`
- `scripts/graph/affixes.js:18-19` — same two repoints
- `scripts/graph/passives.js:13-14` — same two repoints
- `scripts/graph/uniques.js:14-17` — `from '../../src/data/loader.js'` → `from './loader.js'`; `from '../../src/config.js'` → `from './source.js'`; `import { getFlavourLines } from '../../src/data/flavour.js';` → `import { getFlavourLines } from './flavour.js';`

- [ ] **Step 5: Temporarily repoint the four leak modules' infra imports**

These modules still read source until later tasks delete them. Repoint so `src/data/loader.js` and the `src/config.js` source exports can be removed now:

- `src/data/keywordPhrases.js:1-2` — `import { loadJson } from './loader.js';` → `import { loadJson } from '../../scripts/graph/loader.js';`; `import { REPOE } from '../config.js';` → `import { REPOE } from '../../scripts/graph/source.js';`
- `src/data/gemTags.js:1-2` — same two repoints
- `src/data/theorycraft.js:6-7` — same two repoints
- `src/data/keywordDefs.js:1-2` — same two repoints

- [ ] **Step 6: Delete the old `src` infra and trim `config.js`**

```bash
git rm src/data/loader.js src/data/flavour.js
```

Then edit `src/config.js` to remove `expandHome`, `getDataDir`, and `REPOE` (all now in `scripts/graph/source.js`). If nothing remains, delete it:

```bash
git rm src/config.js
```

- [ ] **Step 7: Move the infra tests**

```bash
mkdir -p test/graph
git mv test/loader.test.js test/graph/loader.test.js
```

Edit `test/graph/loader.test.js` line 3 import to `from '../../scripts/graph/loader.js';`. Create `test/graph/source.test.js` with the `expandHome` coverage moved from `test/config.test.js`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import { expandHome } from '../../scripts/graph/source.js';

test('expandHome expands leading ~', () => {
  assert.equal(expandHome('~/git/poe2data'), `${os.homedir()}/git/poe2data`);
});

test('expandHome leaves absolute paths untouched', () => {
  assert.equal(expandHome('/abs/path'), '/abs/path');
});
```

Then remove the old config test:

```bash
git rm test/config.test.js
```

- [ ] **Step 8: Run the full suite to confirm no behavior change**

Run: `npm test`
Expected: PASS — same test count minus the relocated/removed tests, no failures. The build still succeeds (artifact rebuilt by `pretest`).

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "refactor: relocate build-only source I/O (loader/source/flavour) into scripts/graph"
```

---

### Task 2: Keyword build module + `KEYWORD` nodes (parity-proven)

Create the build module that emits `KEYWORD` nodes, moving the phrase-derivation logic out of `src/data/keywordPhrases.js`. Wire it into the graph and prove parity against the still-present `deriveKeywordPhrases`.

**Files:**
- Create: `scripts/graph/keywords.js`
- Modify: `scripts/graph/build.js` (import + assemble keyword nodes; extend `SOURCE_FILES`)
- Test: `test/graph/keywords.test.js` (build-side shape test), `test/graph/keywords-parity.test.js` (TEMPORARY parity test, removed in Task 3)

**Interfaces:**
- Consumes: `loadJson`, `REPOE` from `scripts/graph/{loader,source}.js`; `makeNode`, `KINDS` from `./schema.js`; `slugify` from `../../src/data/slug.js`.
- Produces: `scripts/graph/keywords.js` exports `keywordNodes()` → `{ nodes }` where each node is `{ id, kind:'keyword', name, slug, props:{ definition, phrases:[...] } }`. Also exports `derivePhrasePairs()` → `[[phrase, id], ...]` (the moved derivation, reused internally and by the parity test).

- [ ] **Step 1: Write the build-side shape test (failing)**

Create `test/graph/keywords.test.js`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keywordNodes } from '../../scripts/graph/keywords.js';

test('keywordNodes emits a node per defined keyword with definition + phrases', () => {
  const { nodes } = keywordNodes();
  const byId = new Map(nodes.map((n) => [n.id, n]));

  // a known defined keyword has a node, non-empty definition, and term as name
  const acc = byId.get('Accuracy');
  assert.ok(acc, 'expected an Accuracy keyword node');
  assert.equal(acc.kind, 'keyword');
  assert.equal(acc.name, 'Accuracy');
  assert.ok(acc.props.definition.trim().length > 0);
  assert.ok(Array.isArray(acc.props.phrases));

  // empty-definition keyword gets NO node
  assert.equal(byId.has('AbsentAmulet'), false);

  // every node carries a non-empty definition and a slug
  for (const n of nodes) {
    assert.ok(n.props.definition.trim().length > 0, `empty def on ${n.id}`);
    assert.ok(n.slug, `missing slug on ${n.id}`);
  }
});

test('a phrase-bearing keyword carries its derived surface phrases', () => {
  const { nodes } = keywordNodes();
  const res = nodes.find((n) => n.id === 'Resistances');
  assert.ok(res, 'expected a Resistances node');
  const lower = res.props.phrases.map((p) => p.toLowerCase());
  assert.ok(lower.includes('cold resistance'), 'expected "cold resistance" phrase on Resistances');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/graph/keywords.test.js`
Expected: FAIL — cannot find module `scripts/graph/keywords.js`.

- [ ] **Step 3: Create `scripts/graph/keywords.js`**

Move the derivation helpers verbatim from `src/data/keywordPhrases.js` (the constants `TRANSLATION_FILES`, `TOKEN_WITH_DISPLAY`, `TOKEN_BARE`, `norm`, and the functions `eqLoose`, `isPhraseLike`, `collectStrings`, plus the body of `deriveKeywordPhrases`) into this module, renamed `derivePhrasePairs`, reading via the build loader. Then add `keywordNodes()` to group phrases by id and attach definitions.

```javascript
// scripts/graph/keywords.js
//
// Build-time assembly of KEYWORD glossary nodes. Reads keywords.json (term +
// definition) and scans the game's own [Id|Display] markup across the glossary
// and stat-translation files to derive surface phrases for each keyword. The
// app reads these nodes (definitions + phrases) and never touches source.
import { loadJson } from './loader.js';
import { REPOE } from './source.js';
import { slugify } from '../../src/data/slug.js';
import { makeNode, KINDS } from './schema.js';

// Files whose "string" templates carry tokenized keyword references.
const TRANSLATION_FILES = [
  'stat_translations/stat_descriptions.json',
  'stat_translations/gem_stat_descriptions.json',
  'stat_translations/active_skill_gem_stat_descriptions.json',
  'stat_translations/skill_stat_descriptions.json',
];

const TOKEN_WITH_DISPLAY = /\[([A-Za-z0-9]+)\|([^\]]+)\]/g;
const TOKEN_BARE = /\[([A-Za-z0-9]+)\]/g;

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

// Equal up to a trailing plural "s" (so "minion" matches the term "Minions").
function eqLoose(a, b) {
  a = norm(a);
  b = norm(b);
  return a === b || a === `${b}s` || `${a}s` === b;
}

// A keyword surface phrase, not a sentence: short, word-like, no embedded numbers.
function isPhraseLike(phrase) {
  if (/\d/.test(phrase)) return false;
  if (phrase.length > 34) return false;
  if (phrase.trim().split(/\s+/).length > 4) return false;
  return true;
}

// Collect every "string" value found anywhere in a parsed translation file.
function collectStrings(node, out) {
  if (Array.isArray(node)) {
    for (const v of node) collectStrings(v, out);
  } else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (k === 'string' && typeof v === 'string') out.push(v);
      else collectStrings(v, out);
    }
  }
}

// Build [phrase, id] pairs from the game data. (Moved verbatim from the app's
// former src/data/keywordPhrases.js deriveKeywordPhrases.)
export function derivePhrasePairs() {
  const keywords = loadJson(`${REPOE}/keywords.json`);
  const hasDef = (id) => {
    const e = keywords[id];
    return !!(e && typeof e.definition === 'string' && e.definition.trim());
  };
  const term = (id) => {
    const e = keywords[id];
    return e && typeof e.term === 'string' ? e.term.trim() : '';
  };

  const texts = [];
  for (const e of Object.values(keywords)) {
    if (e && typeof e.definition === 'string' && e.definition) texts.push(e.definition);
  }
  for (const rel of TRANSLATION_FILES) {
    try {
      collectStrings(loadJson(`${REPOE}/${rel}`), texts);
    } catch {
      // optional file absent in this data snapshot — skip
    }
  }

  const byPhrase = new Map();
  const counts = new Map();
  const add = (rawPhrase, id) => {
    const display = rawPhrase.trim();
    if (!display) return;
    const key = display.toLowerCase();
    let rec = byPhrase.get(key);
    if (!rec) byPhrase.set(key, (rec = { display, ids: new Set() }));
    rec.ids.add(id);
    const ck = `${key}|${id}`;
    counts.set(ck, (counts.get(ck) || 0) + 1);
  };
  const count = (phraseLower, id) => counts.get(`${phraseLower}|${id}`) || 0;

  for (const t of texts) {
    let m;
    TOKEN_WITH_DISPLAY.lastIndex = 0;
    while ((m = TOKEN_WITH_DISPLAY.exec(t)) !== null) add(m[2], m[1]);
    const bare = t.replace(TOKEN_WITH_DISPLAY, ' ');
    TOKEN_BARE.lastIndex = 0;
    while ((m = TOKEN_BARE.exec(bare)) !== null) {
      const display = term(m[1]);
      if (display) add(display, m[1]);
    }
  }

  const isRareElision = (displayLower, id) => {
    const n = count(displayLower, id);
    for (const { display: other } of byPhrase.values()) {
      const ol = other.toLowerCase();
      if (ol === displayLower) continue;
      if (ol.startsWith(`${displayLower} `) && count(ol, id) > n) return true;
    }
    return false;
  };

  const pairs = [];
  for (const { display, ids } of byPhrase.values()) {
    if (!isPhraseLike(display)) continue;
    let candidates = [...ids].filter(hasDef);
    if (candidates.length === 0) continue;
    if (candidates.length > 1) {
      const exact = candidates.filter((id) => eqLoose(term(id), display));
      if (exact.length !== 1) continue;
      candidates = exact;
    }
    if (isRareElision(display.toLowerCase(), candidates[0])) continue;
    pairs.push([display, candidates[0]]);
  }
  return pairs;
}

// One KEYWORD node per keyword that has a non-empty definition. Derived surface
// phrases are grouped onto the owning keyword as props.phrases (possibly empty).
export function keywordNodes() {
  const keywords = loadJson(`${REPOE}/keywords.json`);

  const phrasesById = new Map();
  for (const [phrase, id] of derivePhrasePairs()) {
    if (!phrasesById.has(id)) phrasesById.set(id, []);
    phrasesById.get(id).push(phrase);
  }

  const nodes = [];
  for (const [id, e] of Object.entries(keywords)) {
    const definition = e && typeof e.definition === 'string' ? e.definition : '';
    if (!definition.trim()) continue; // empty-definition keywords get no node
    const name = (e.term && e.term.trim()) || id;
    nodes.push(
      makeNode({
        id,
        kind: KINDS.KEYWORD,
        name,
        slug: slugify(id),
        props: { definition, phrases: phrasesById.get(id) ?? [] },
        search: name.toLowerCase(),
      }),
    );
  }
  return { nodes };
}
```

- [ ] **Step 4: Run the shape test to verify it passes**

Run: `node --test test/graph/keywords.test.js`
Expected: PASS (both tests).

- [ ] **Step 5: Wire keyword nodes into the build + extend `SOURCE_FILES`**

In `scripts/graph/build.js`:

Add the import after the other node-module imports (after line 10):

```javascript
import { keywordNodes } from './keywords.js';
```

Add these entries to the `SOURCE_FILES` array (so `sourceHash` covers everything the keyword build reads):

```javascript
  `${REPOE}/keywords.json`,
  `${REPOE}/stat_translations/gem_stat_descriptions.json`,
  `${REPOE}/stat_translations/active_skill_gem_stat_descriptions.json`,
  `${REPOE}/stat_translations/skill_stat_descriptions.json`,
```

Note: `hashSources()` reads each `SOURCE_FILES` entry directly; if any of the three translation files is absent in a snapshot, guard it. Replace the `for (const rel of SOURCE_FILES) h.update(...)` loop body in `hashSources()` with a defensive read:

```javascript
  for (const rel of SOURCE_FILES) {
    const p = path.join(dir, rel);
    if (fs.existsSync(p)) h.update(fs.readFileSync(p));
  }
```

In `buildGraph()`, assemble the keyword nodes and include them in `nodes` (keyword nodes have no edges in this cutover):

```javascript
  const { nodes: kNodes } = keywordNodes();
```

and extend the `nodes` array literal to include `...kNodes`:

```javascript
  const nodes = [...gNodes, ...sNodes, ...bNodes, ...cNodes, ...tNodes, ...aNodes, ...uNodes, ...pNodes, ...ascNodes, ...kNodes];
```

- [ ] **Step 6: Write the TEMPORARY parity test (failing if logic diverged)**

Create `test/graph/keywords-parity.test.js`. It proves the graph-derived defs/phrases equal the app's current source-derived output, which still exists in `src/data/keywordPhrases.js` (`deriveKeywordPhrases`) and `keywords.json` until Task 3:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keywordNodes } from '../../scripts/graph/keywords.js';
import { deriveKeywordPhrases } from '../../src/data/keywordPhrases.js';
import { loadJson } from '../../scripts/graph/loader.js';
import { REPOE } from '../../scripts/graph/source.js';

test('PARITY: keyword node definitions match keywords.json defined entries', () => {
  const keywords = loadJson(`${REPOE}/keywords.json`);
  const { nodes } = keywordNodes();
  const byId = new Map(nodes.map((n) => [n.id, n]));

  const definedIds = Object.entries(keywords)
    .filter(([, e]) => e && typeof e.definition === 'string' && e.definition.trim())
    .map(([id]) => id);

  assert.equal(byId.size, definedIds.length, 'node count matches defined-keyword count');
  for (const id of definedIds) {
    const n = byId.get(id);
    assert.ok(n, `missing node for ${id}`);
    assert.equal(n.props.definition, keywords[id].definition);
    assert.equal(n.name, (keywords[id].term && keywords[id].term.trim()) || id);
  }
});

test('PARITY: flattened node phrases equal the old deriveKeywordPhrases output', () => {
  const { nodes } = keywordNodes();
  const fromNodes = nodes
    .flatMap((n) => n.props.phrases.map((p) => `${p} ${n.id}`))
    .sort();
  const fromOld = deriveKeywordPhrases()
    .map(([p, id]) => `${p} ${id}`)
    .sort();
  assert.deepEqual(fromNodes, fromOld);
});
```

- [ ] **Step 7: Run parity + full build**

Run: `node --test test/graph/keywords-parity.test.js`
Expected: PASS (both parity assertions).

Run: `npm run build:graph`
Expected: prints a node count higher than before (keyword nodes added), no validation error.

- [ ] **Step 8: Run the full suite**

Run: `npm test`
Expected: PASS — all existing tests plus the new keyword build + parity tests.

- [ ] **Step 9: Commit**

```bash
git add scripts/graph/keywords.js scripts/graph/build.js test/graph/keywords.test.js test/graph/keywords-parity.test.js
git commit -m "feat: assemble KEYWORD glossary nodes in buildGraph (parity-proven)"
```

---

### Task 3: Keyword app cutover (read defs + phrases from the graph)

Rewrite `keywordDefs.js` and `keywordPhrases.js` to read from `KEYWORD` nodes. Delete the moved derivation logic and the temporary parity test.

**Files:**
- Modify: `src/data/keywordDefs.js` (read nodes, drop source import)
- Modify: `src/data/keywordPhrases.js` (thin reader, drop derivation + source import)
- Modify: `test/keywordPhrases.test.js` (test the new reader, not the removed derive)
- Delete: `test/graph/keywords-parity.test.js`
- Test: `test/keywordDefs.test.js` (unchanged — must still pass against graph-backed impl)

**Interfaces:**
- Consumes: `getNode`, `nodesByKind` from `./graph.js`.
- Produces: `keywordDefs.js` exports `hasDefinition(key)`, `getDefinition(key)` (graph-backed, same signatures). `keywordPhrases.js` exports `installKeywordPhrases()` (idempotent) — `deriveKeywordPhrases` is REMOVED.

- [ ] **Step 1: Rewrite `src/data/keywordDefs.js`**

```javascript
import { getNode } from './graph.js';

// KEYWORD nodes exist ONLY for keywords with a non-empty definition (built by
// scripts/graph/keywords.js), so node presence IS "has a definition". The app
// reads glossary text from the graph artifact and never touches $POE2DATADIR.

// True only when a KEYWORD node exists for this key (i.e. it has a non-empty
// definition). Gates out the empty-definition keywords so they never become
// dead hovers.
export function hasDefinition(key) {
  const n = getNode(key);
  return !!(n && n.kind === 'keyword');
}

// { term, definition } for a defined keyword, or null for empty/missing.
// term comes from the node name (which already falls back to the key at build time).
export function getDefinition(key) {
  const n = getNode(key);
  if (!n || n.kind !== 'keyword') return null;
  return { term: n.name, definition: n.props.definition };
}
```

- [ ] **Step 2: Run the keywordDefs test (must still pass)**

Run: `node --test test/keywordDefs.test.js`
Expected: PASS — `Accuracy` resolves (node exists, term/definition match), `AbsentAmulet` and `NotARealKeyword` return false/null (no node).

- [ ] **Step 3: Rewrite `src/data/keywordPhrases.js` as a thin reader**

Replace the ENTIRE file contents with:

```javascript
import { nodesByKind } from './graph.js';
import { registerDerivedPhrases } from './keywords.js';

// Surface-phrase → keyword-id pairs are derived at BUILD time (see
// scripts/graph/keywords.js) and stored as props.phrases on each KEYWORD node.
// This module just flattens them back into the [phrase, id] pairs the renderer
// expects. No reads of $POE2DATADIR.

// Exported for tests: the merged [phrase, id] pairs from all keyword nodes.
export function keywordPhrasePairs() {
  const pairs = [];
  for (const n of nodesByKind('keyword')) {
    for (const phrase of n.props.phrases ?? []) pairs.push([phrase, n.id]);
  }
  return pairs;
}

let installed = false;

// Derive and merge into the renderer once. Safe to call repeatedly.
export function installKeywordPhrases() {
  if (installed) return;
  installed = true;
  registerDerivedPhrases(keywordPhrasePairs());
}
```

- [ ] **Step 4: Update `test/keywordPhrases.test.js`**

The old test imported `deriveKeywordPhrases` (now removed). Replace its import line 3 and the first test to exercise `keywordPhrasePairs` instead, keeping the same behavioral assertions (they now read from the graph nodes). Replace lines 1–4 with:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keywordPhrasePairs, installKeywordPhrases } from '../src/data/keywordPhrases.js';
import { registerDerivedPhrases, renderGameText } from '../src/data/keywords.js';
```

Then change the first test's first line from `const pairs = deriveKeywordPhrases();` to `const pairs = keywordPhrasePairs();`. Leave the remaining assertions in that test unchanged (cold resistance, fork, culling strike, frozen, rarity, minion, the negative cases, hygiene, and elision checks) — they hold because the pairs are identical to the build-time derivation. Leave any later tests referencing `installKeywordPhrases` unchanged.

- [ ] **Step 5: Delete the temporary parity test**

```bash
git rm test/graph/keywords-parity.test.js
```

- [ ] **Step 6: Verify no source import remains in either module**

Run: `grep -nE "loader|POE2DATADIR|source\.js|config\.js" src/data/keywordDefs.js src/data/keywordPhrases.js`
Expected: no matches.

- [ ] **Step 7: Run the full suite**

Run: `npm test`
Expected: PASS — keywordDefs, keywordPhrases, keywords (renderer), and keywordApi tests all green.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: keyword app-cutover — read glossary defs + phrases from the graph"
```

---

### Task 4: Bake gem tag tokens onto gem nodes (parity-proven)

Resolve `gem_tags.json` at build time and store displayable tokens per gem node.

**Files:**
- Modify: `scripts/graph/gems.js` (read `gem_tags.json`, add `props.tagTokens`)
- Modify: `scripts/graph/build.js` (add `gem_tags.json` to `SOURCE_FILES`)
- Test: `test/graph/gem-tags.test.js` (created; build-side resolution + temporary parity vs `gem_tags.json`)

**Interfaces:**
- Produces: each gem node gains `props.tagTokens: [{ token, display }, ...]` — one entry per tag id that has a display token (`null`-valued tags dropped), preserving source tag order.

- [ ] **Step 1: Write the build-side test (failing)**

Create `test/graph/gem-tags.test.js`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gemNodes } from '../../scripts/graph/gems.js';
import { loadJson } from '../../scripts/graph/loader.js';
import { REPOE } from '../../scripts/graph/source.js';

// Mirror of the parse rule under test.
function parseTagToken(raw) {
  if (!raw) return null;
  const inner = raw.replace(/^\[/, '').replace(/\]$/, '');
  const pipe = inner.indexOf('|');
  return { token: raw, display: pipe === -1 ? inner : inner.slice(pipe + 1) };
}

test('gem nodes carry resolved tagTokens (display tags only, source order)', () => {
  const { nodes } = gemNodes();
  const map = loadJson(`${REPOE}/gem_tags.json`);

  for (const n of nodes) {
    const expected = (n.props.tags ?? [])
      .map((id) => parseTagToken(map[id]))
      .filter(Boolean)
      .map((p) => ({ token: p.token, display: p.display }));
    assert.deepEqual(n.props.tagTokens, expected, `tagTokens mismatch on ${n.id}`);
  }
});

test('known tag ids resolve to the expected tokens', () => {
  const { nodes } = gemNodes();
  // find a gem that has the "area" tag to assert the [AoESkill|AoE] shape
  const withArea = nodes.find((n) => (n.props.tags ?? []).includes('area'));
  if (withArea) {
    const aoe = withArea.props.tagTokens.find((t) => t.token === '[AoESkill|AoE]');
    assert.ok(aoe, 'expected [AoESkill|AoE] token on an area gem');
    assert.equal(aoe.display, 'AoE');
  }
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/graph/gem-tags.test.js`
Expected: FAIL — `tagTokens` is `undefined` on nodes.

- [ ] **Step 3: Add `tagTokens` resolution in `scripts/graph/gems.js`**

Add this helper near the top of the module (after the imports):

```javascript
// gem_tags.json maps a tag id to "[Display]", "[Id|Display]", or null. Resolve a
// gem's tag ids to displayable {token, display} entries (null-valued tags dropped).
function resolveTagTokens(tagIds, tagMap) {
  const out = [];
  for (const id of tagIds ?? []) {
    const raw = tagMap[id];
    if (!raw) continue;
    const inner = raw.replace(/^\[/, '').replace(/\]$/, '');
    const pipe = inner.indexOf('|');
    out.push({ token: raw, display: pipe === -1 ? inner : inner.slice(pipe + 1) });
  }
  return out;
}
```

In `gemNodes()`, load the tag map alongside the other source reads:

```javascript
  const gemTags = loadJson(`${REPOE}/gem_tags.json`);
```

and add `tagTokens` to the `props` object (right after the existing `tags:` line):

```javascript
      tagTokens: resolveTagTokens(r.raw.tags ?? [], gemTags),
```

- [ ] **Step 4: Run the build-side test to verify it passes**

Run: `node --test test/graph/gem-tags.test.js`
Expected: PASS (both tests).

- [ ] **Step 5: Add `gem_tags.json` to `SOURCE_FILES`**

In `scripts/graph/build.js`, add to the `SOURCE_FILES` array:

```javascript
  `${REPOE}/gem_tags.json`,
```

- [ ] **Step 6: Rebuild + full suite**

Run: `npm run build:graph`
Expected: success, no validation error.

Run: `npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add scripts/graph/gems.js scripts/graph/build.js test/graph/gem-tags.test.js
git commit -m "feat: bake resolved gem tagTokens onto gem nodes"
```

---

### Task 5: Gem tags app cutover (read `tagTokens` from the node; delete `gemTags.js`)

**Files:**
- Modify: `src/data/gems.js` (local filter over `props.tagTokens`; expose on `toGem`; drop `gemTags.js` import)
- Delete: `src/data/gemTags.js`, `test/gemTags.test.js`

**Interfaces:**
- Consumes: `node.props.tagTokens` produced in Task 4.
- Produces: `gems.js` internal helper `tagTokensExcluding(tagTokens, exclude)` → `string[]` of token strings (same shape the two call sites feed to `renderGameText`).

- [ ] **Step 1: Remove the `gemTags.js` import and add `tagTokens` to `toGem`**

In `src/data/gems.js`:

Delete line 3: `import { displayTagTokens } from './gemTags.js';`

In `toGem(node)`, add to the returned object (after the `tags:` line):

```javascript
    tagTokens: p.tagTokens ?? [],
```

- [ ] **Step 2: Add the local token filter helper**

Add near the other small helpers in `src/data/gems.js` (e.g. after `reqKeys`):

```javascript
// Token strings for a gem's displayable tags, dropping any whose display name is
// in `exclude` (e.g. the one already shown as the type line). Replaces the former
// gemTags.displayTagTokens — tokens are now resolved at build time onto the node.
function tagTokensExcluding(tagTokens, exclude = []) {
  const skip = new Set(exclude);
  return (tagTokens ?? []).filter((t) => !skip.has(t.display)).map((t) => t.token);
}
```

- [ ] **Step 3: Repoint both call sites**

In `listGemCards()` (around line 146) replace:

```javascript
    const tagTokens = displayTagTokens(gem.tags, [typeLine]);
```

with:

```javascript
    const tagTokens = tagTokensExcluding(gem.tagTokens, [typeLine]);
```

In `buildGemViewModel()` (around line 255) replace the identical line:

```javascript
  const tagTokens = displayTagTokens(gem.tags, [typeLine]);
```

with:

```javascript
  const tagTokens = tagTokensExcluding(gem.tagTokens, [typeLine]);
```

(The downstream `tagTokens.map((t) => renderGameText(t, hasDefinition))` lines are unchanged — `tagTokens` is still an array of token strings.)

- [ ] **Step 4: Delete the obsolete module and its test**

```bash
git rm src/data/gemTags.js test/gemTags.test.js
```

- [ ] **Step 5: Verify no dangling references**

Run: `grep -rn "gemTags\|displayTagTokens" src test`
Expected: no matches.

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS — `gems.test.js`, `theorycraft.test.js` (uses gem docs), and `search.test.js` green; gem cards/tooltips still render tag chips.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: gem-tags app-cutover — read tagTokens from the node; remove gemTags.js"
```

---

### Task 6: `theorycraft` grant names via skill nodes

Replace the `skills.json` read with a graph node lookup.

**Files:**
- Modify: `src/data/theorycraft.js`
- Test: `test/theorycraft.test.js` (add a search-doc grant assertion)

**Interfaces:**
- Consumes: `getNode` from `./graph.js`; skill node `id` == `grants_skills` key, `name` == display name.

- [ ] **Step 1: Add a failing assertion that grant names reach the gem search doc**

Append to `test/theorycraft.test.js`:

```javascript
import { allDocs } from '../src/data/theorycraft.js';
import { getGem } from '../src/data/gems.js';
import { getNode } from '../src/data/graph.js';

test('gem search docs include granted-skill display names from the graph', () => {
  // find a gem whose first granted skill resolves to a named skill node
  const docs = allDocs().filter((d) => d.category === 'gem' || d.category === 'support' || d.category === 'spirit');
  const sample = docs.find((d) => {
    const gem = getGem(d.url.replace('/gem/', ''));
    const key = gem?.grants_skills?.[0];
    const node = key ? getNode(key) : null;
    return node && node.name && node.name !== key;
  });
  assert.ok(sample, 'expected at least one gem with a named granted skill');
  const gem = getGem(sample.url.replace('/gem/', ''));
  const skillName = getNode(gem.grants_skills[0]).name.toLowerCase();
  assert.ok(sample.text.includes(skillName), 'granted skill name should be in the doc text');
});
```

- [ ] **Step 2: Run it to verify it fails or passes incidentally**

Run: `node --test test/theorycraft.test.js`
Expected: PASS today (grant names already flow via `skills.json`). This test pins the behavior so the cutover in Step 3 must preserve it. If it fails, the sample selection is the issue — adjust the finder, not the assertion.

- [ ] **Step 3: Replace the `skills.json` read in `gemDocs()`**

In `src/data/theorycraft.js`:

Remove the two source imports (lines 6–7):

```javascript
import { loadJson } from './loader.js';
import { REPOE } from '../config.js';
```

(They were repointed to the build layer in Task 1; now delete them entirely.)

Add `getNode` to the graph import. Add this import near the top (it has no existing `graph.js` import):

```javascript
import { getNode } from './graph.js';
```

In `gemDocs()`, replace:

```javascript
function gemDocs() {
  const skills = loadJson(`${REPOE}/skills.json`);
  return listGems().map((g) => {
    const raw = getGem(g.slug) ?? {};
    const grants = (raw.grants_skills ?? [])
      .map((k) => skills[k]?.active_skill?.display_name)
      .filter(Boolean);
```

with:

```javascript
function gemDocs() {
  return listGems().map((g) => {
    const raw = getGem(g.slug) ?? {};
    const grants = (raw.grants_skills ?? [])
      .map((k) => getNode(k)?.name)
      .filter(Boolean);
```

- [ ] **Step 4: Verify no source import remains**

Run: `grep -nE "loader|REPOE|loadJson|POE2DATADIR|config\.js|source\.js" src/data/theorycraft.js`
Expected: no matches.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS — the new grant assertion and existing theorycraft/search tests green.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: theorycraft app-cutover — resolve grant names via skill nodes"
```

---

### Task 7: Final acceptance sweep

Prove the goal: zero source reads under `src/`, full suite green, server boots with `$POE2DATADIR` unset.

**Files:** none modified (verification only; small doc note optional).

- [ ] **Step 1: Acceptance grep — no source references under `src/`**

Run: `grep -rnE "POE2DATADIR|loadJson|getDataDir|listDataDir|data/loader|graph/loader|graph/source" src/`
Expected: **no matches.** (The only `scripts/graph` import allowed under `src/` is `graph.js`'s `import ... from '../../scripts/graph/build.js'`, which does not match this pattern.)

- [ ] **Step 2: Confirm the only `src`→`scripts/graph` import is the build bridge**

Run: `grep -rn "scripts/graph" src/`
Expected: exactly one line — `src/data/graph.js` importing `build.js`. Anything else is a regression.

- [ ] **Step 3: Full suite from clean build**

Run: `rm -f build/graph.json && npm test`
Expected: `pretest` rebuilds the artifact, all tests PASS.

- [ ] **Step 4: Boot the server with source unset**

Run: `POE2DATADIR= node src/index.js` (then in another shell `curl -s localhost:3000/gems >/dev/null && curl -s localhost:3000/api/keyword/Accuracy` ), or simply load `/gems`, a gem page, a unique page, and trigger a keyword hover in the browser.
Expected: server starts without throwing (no `POE2DATADIR is not set`); gem cards show tag chips; gem/unique tooltips render; `/api/keyword/Accuracy` returns the glossary tooltip HTML. Stop the server when done.

- [ ] **Step 5: Commit (if any doc/cleanup change was made)**

```bash
git add -A
git commit -m "chore: final graph cutover — verify src has zero source reads"
```

(If Steps 1–4 required no edits, skip this commit.)

---

## Self-Review

**Spec coverage:**
- Spec A1 (keyword glossary → nodes) → Tasks 2–3. ✓
- Spec A2 (gem tags baked) → Tasks 4–5. ✓
- Spec A3 (theorycraft via skill nodes) → Task 6. ✓
- Spec Part B (relocate loader/config/flavour) → Task 1. ✓
- Spec build wiring (`SOURCE_FILES`, keyword nodes, defensive hashing) → Task 2 Step 5, Task 4 Step 5. ✓
- Spec parity-first strategy → Task 2 (parity test) + Task 3 (removal); Task 4 (build-side equivalence test); Task 6 (behavior-pinning test). ✓
- Spec verification (acceptance grep, server boot) → Task 7. ✓
- Spec "stays as-is" (graph.js fallback/staleness untouched) → honored; Task 7 Step 2 explicitly allows the single build bridge import. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code; the one "move verbatim" instruction (Task 2 Step 3) is accompanied by the complete resulting file. ✓

**Type consistency:**
- `keywordNodes()` returns `{ nodes }`; consumers in `build.js` destructure `{ nodes: kNodes }`. ✓
- `keywordPhrasePairs()` (Task 3) replaces the removed `deriveKeywordPhrases`; `test/keywordPhrases.test.js` updated to match (Task 3 Step 4). ✓
- `hasDefinition`/`getDefinition` signatures unchanged across the rewrite. ✓
- `tagTokens` shape `{token, display}` is consistent across Task 4 (produce), the build test, and Task 5 (`tagTokensExcluding` consumes `.display`/`.token`). ✓
- `getNode(k)?.name` in Task 6 matches the confirmed skill-node id/name contract. ✓
