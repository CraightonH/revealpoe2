# Uniques → Build-Time Graph — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `unique` node kind to the build-time graph (one node per source unique, carrying all PoB variants with a resolved implicit/explicit split, base identity, filterable item class, icon, and flavour) plus `has_base` and `grants` edges, then convert `src/data/uniques.js` into a pure presentation adapter that no longer reads `$POE2DATADIR`.

**Architecture:** A new build-side resolver `scripts/graph/uniques.js` parses the `pob-uniques/*.json` text blocks once, joins `uniques.json`/`flavour.json` metadata, and emits `unique` nodes + edges. The folded `grantedSkillNames()` (formerly `src/data/grantedSkills.js`) is consumed by `scripts/graph/gems.js`. The app modules (`uniques.js`, `baseItems.js`) read nodes/edges via `src/data/graph.js` and own all rendering. This mirrors the just-completed affix and base cutovers (`scripts/graph/affixes.js`, `scripts/graph/bases.js`).

**Tech Stack:** Node.js ESM, `node:test` + `node:assert/strict`. No new dependencies. Graph schema helpers in `scripts/graph/schema.js` (`makeNode`/`makeEdge`/`KINDS`/`EDGE_TYPES`).

## Global Constraints

These apply to every task; copied verbatim from `docs/superpowers/specs/2026-06-23-uniques-graph-cutover-design.md`:

- **Parity is byte-identical.** Graph-backed `listUniqueCards`, `buildUniqueViewModel(slug)` for all slugs, `listUniqueClassFilters`, `uniqueDocs`, and base-page `uniquesOnBase` must equal the pre-migration output exactly.
- **Node id** = `Unique/<uniques.json id>` (e.g. `Unique/Astramentis`), falling back to `Unique/<slug>` when no `uniques.json` entry matches by name. Slug is a routing property; same-name PoB blocks dedup by keeping the first.
- **Search text** (rule #7) = `name + base + className + current-variant stat text + flavour`, lowercased. **Current variant only** — never patch-history rolls.
- **`src/data/uniques.js` performs NO reads of `$POE2DATADIR`** after cutover (no `loadJson`/`listDataDir`/`REPOE`/`fs`).
- **`variants`** is the only stored umbrella name. **No `history`/`form` discriminator** is baked into the artifact — it is derivable at render time from `variants.some(v => v.name === 'Current')`.
- **`grants`** edges resolve a current-variant "Grants Skill:" line by name-slug → skill node. **`has_base`** edges are emitted only when the base name resolves to a browsable base node.
- **Out of scope:** PoB alt-variant multi-axis selection (`Selected Variant:`/`Has Alt Variant:`); variant-switcher UI; the `skill → gem` icon upgrade for the 2 unlinked grants; promoting unique-only stat lines to nodes.

## File Structure

- **Create** `scripts/graph/uniques.js` — build-side resolver. Exports: `grantedSkillNames()`, `uniqueNodes()`, `uniqueEdges(records, baseRecords, skillNodes)`. Owns all PoB text parsing and variant resolution.
- **Create** `test/graph/uniques.test.js` — build-side unit tests.
- **Create** `test/graph/uniques.parity.test.js` — TEMPORARY parity harness (deleted in Task 6).
- **Modify** `scripts/graph/build.js` — assemble unique nodes/edges; extend `SOURCE_FILES` + `hashSources` to cover `uniques.json`, `flavour.json`, and the `pob-uniques/*.json` set.
- **Modify** `scripts/graph/gems.js` (line 5) — import `grantedSkillNames` from `./uniques.js`.
- **Modify** `src/data/uniques.js` — presentation adapter over graph nodes/edges; drop all source reads.
- **Modify** `src/data/baseItems.js` — `uniquesOnBase` via `edgesTo(baseId, 'has_base')`; drop `import { listUniques }`; update the stale module comment.
- **Delete** `src/data/grantedSkills.js` — folded into `scripts/graph/uniques.js`.
- **Unchanged** `src/data/theorycraft.js` — `uniqueDocs()` keeps reading `listUniques()`, whose contract (legacy flat shape, current-variant stats) is preserved by the adapter. Covered by the parity harness.

**Note on the `uniqueEdges` signature.** The spec sketches `uniqueEdges(records, baseRecords, nodeIds)`. The `grants` edge resolves a skill display *name* to a skill node by slug, which a bare `Set<id>` cannot do. This plan passes the skill node array (`skillNodes`) so the resolver can build a `slug → id` map — a concretization of the spec's "resolved by name-slug → skill node", not a deviation from intent.

---

### Task 1: Build resolver — PoB parsing, variant resolution, and `grantedSkillNames`

**Files:**
- Create: `scripts/graph/uniques.js`
- Test: `test/graph/uniques.test.js`

**Interfaces:**
- Consumes: `loadJson`/`listDataDir` (`src/data/loader.js`), `slugify` (`src/data/slug.js`), `REPOE` (`src/config.js`).
- Produces (this task): `grantedSkillNames(): Set<string>` (pure). Internal helpers `parseBlock(text)`, `resolveVariants({variantNames, stats, implicitCount})`, `currentIndexOf(variants)`, `grantNamesOf(variant)` used by Task 2/3.

The PoB block format (verified against `pob-uniques/amulet.json` → "The Anvil"):

```
The Anvil
Bloodstone Amulet
Variant: Pre 0.2.0
Variant: Pre 0.4.0
Variant: Current
Implicits: 1
{tags:life}+(30-40) to maximum Life
{tags:speed}10% reduced Movement Speed
{variant:1}20% increased Block chance
{variant:2,3}25% increased Block chance
{variant:3}+(5-10)% to maximum Block chance
```

Line 1 = name, line 2 = base. `Variant:` lines name each variant in order (1-based, referenced by `{variant:N}`). `Implicits: N` is a single fixed count. Untagged stat lines apply to every variant.

- [ ] **Step 1: Write the failing test**

Create `test/graph/uniques.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { grantedSkillNames } from '../../scripts/graph/uniques.js';

test('grantedSkillNames is a non-empty Set of skill display names', () => {
  const names = grantedSkillNames();
  assert.ok(names instanceof Set);
  assert.ok(names.size > 50, `expected many granted skills, got ${names.size}`);
  // Guiding Palm grants "Purity of Fire" (a Level (1-20) grant — stripped to the bare name).
  assert.ok(names.has('Purity of Fire'), 'contains a known unique-granted skill');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/graph/uniques.test.js`
Expected: FAIL — `Cannot find module '.../scripts/graph/uniques.js'` (or "grantedSkillNames is not a function").

- [ ] **Step 3: Write the resolver scaffolding + `grantedSkillNames`**

Create `scripts/graph/uniques.js`. `grantedSkillNames` is a **verbatim port** of the deleted `src/data/grantedSkills.js` (same regex, scans every line of every block) so gem-origin classification stays byte-identical.

```js
// scripts/graph/uniques.js
//
// Build-time resolver for unique items. Parses the pob-uniques/*.json text blocks
// once, resolves the full set of PoB variants (implicit/explicit split per variant),
// joins to uniques.json metadata (id, icon, inventory size) and flavour text, and
// emits one `unique` node per source unique. Two edge kinds connect them:
// `has_base` (unique -> browsable base) and `grants` (unique -> granted skill).
//
// src/data/uniques.js consumes these nodes/edges and owns all rendering; it no
// longer reads $POE2DATADIR. grantedSkillNames() (formerly src/data/grantedSkills.js)
// folds in here as a pure source parse used by scripts/graph/gems.js origin
// classification — ported verbatim (same regex) to keep gem nodes byte-identical.
import path from 'node:path';
import { loadJson, listDataDir } from '../../src/data/loader.js';
import { REPOE } from '../../src/config.js';
import { slugify } from '../../src/data/slug.js';
import { getFlavourLines } from '../../src/data/flavour.js';
import { makeNode, makeEdge, KINDS, EDGE_TYPES } from './schema.js';
import { baseNodes } from './bases.js';

const POB_DIR = 'pob-uniques';

// PoB metadata line prefixes — not item stats (mirrors src/data/uniques.js).
// "Grants Skill:" is intentionally NOT here — it's a real granted-skill stat.
const META_COLON_RE = /^(Variant|Implicits|League|Source|Corrupted|Limited to|Drop level|Drop|Unreleased|Sockets|Radius|Has Alt Variant(?: Two| Three)?|Selected (?:Alt )?Variant(?: Two| Three)?|Left ring slot|Right ring slot):/;
const META_NOCOLON_RE = /^Requires\b/;
const isMetaLine = (line) => META_COLON_RE.test(line) || META_NOCOLON_RE.test(line);

// Matches "Grants Skill: Name", "Grants Skill: Level (N-M) Name", and
// "Grants Skill: Level N Name"; capture group 2 is the skill display name.
const GRANTS_SKILL_RE = /^(Grants Skill: (?:Level (?:\([^)]+\)|\d+) )?)(.+)$/;

// Strip all {…} tokens from a stat line to get clean display text.
function stripBraces(line) {
  return line.replace(/\{[^}]*\}/g, '').trim();
}

// {variant:1,3} -> [1,3] (1-based), or null when the line applies to all variants.
function variantSpec(line) {
  const m = line.match(/^\{variant:([^}]+)\}/);
  return m ? m[1].split(',').map(Number) : null;
}

// ---------------------------------------------------------------------------
// grantedSkillNames — verbatim port of the former src/data/grantedSkills.js.
// Keep the regex and all-lines scan identical: scripts/graph/gems.js uses this
// Set for gem-origin classification, and any change would shift gem nodes.
// ---------------------------------------------------------------------------
const LEGACY_GRANTS_RE = /^Grants Skill:\s*(?:Level \([^)]+\)\s*)?(.+)$/;
let _grantedNames = null;
export function grantedSkillNames() {
  if (_grantedNames) return _grantedNames;
  _grantedNames = new Set();
  for (const file of listDataDir(POB_DIR)) {
    if (file === '_manifest.json' || !file.endsWith('.json')) continue;
    const entries = loadJson(`${POB_DIR}/${file}`);
    if (!Array.isArray(entries)) continue;
    for (const text of entries) {
      if (typeof text !== 'string') continue;
      for (const raw of text.split('\n')) {
        const line = raw.replace(/\{[^}]*\}/g, '').trim();
        const m = line.match(LEGACY_GRANTS_RE);
        if (m) _grantedNames.add(m[1].trim());
      }
    }
  }
  return _grantedNames;
}

// ---------------------------------------------------------------------------
// PoB block parsing + variant resolution.
// ---------------------------------------------------------------------------

// Parse one block into { name, base, variantNames, stats, implicitCount } where
// `stats` are the raw (brace-prefixed) mod lines in source order. Returns null
// for manifest artifacts / malformed blocks (mirrors src/data/uniques.js).
function parseBlock(text) {
  if (typeof text !== 'string') return null;
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return null;
  const name = lines[0];
  const base = lines[1];
  if (name.includes(':') || name === 'source' || name === 'base_url') return null;

  const variantNames = lines
    .filter((l) => l.startsWith('Variant:'))
    .map((l) => l.slice('Variant:'.length).trim());

  const implicitsLine = lines.find((l) => /^Implicits:\s*\d+/.test(l));
  const implicitCount = implicitsLine ? Number(implicitsLine.match(/\d+/)[0]) : 0;

  const stats = lines.slice(2).filter((l) => !isMetaLine(l));
  return { name, base, variantNames, stats, implicitCount };
}

// For each variant index i (1-based), keep lines that apply (untagged, or whose
// {variant:…} list includes i), in source order, braces stripped. The first
// `implicitCount` are implicits, the rest explicits. A block with no Variant:
// lines resolves to a single variant (name null) over all untagged lines.
function resolveVariants({ variantNames, stats, implicitCount }) {
  const count = variantNames.length || 1;
  const variants = [];
  for (let i = 1; i <= count; i++) {
    const filtered = [];
    for (const line of stats) {
      const spec = variantSpec(line);
      if (spec && !spec.includes(i)) continue;
      const cleaned = stripBraces(line);
      if (cleaned) filtered.push(cleaned);
    }
    variants.push({
      name: variantNames[i - 1] ?? null,
      implicits: filtered.slice(0, implicitCount),
      explicits: filtered.slice(implicitCount),
    });
  }
  return variants;
}

// The live variant: the one named exactly "Current", else the last index.
function currentIndexOf(variants) {
  const idx = variants.findIndex((v) => v.name === 'Current');
  return idx >= 0 ? idx : variants.length - 1;
}

// Skill display names granted by a variant's "Grants Skill:" lines, in order.
function grantNamesOf(variant) {
  const out = [];
  for (const line of [...variant.implicits, ...variant.explicits]) {
    const m = line.match(GRANTS_SKILL_RE);
    if (m) out.push(m[2].trim());
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/graph/uniques.test.js`
Expected: PASS (1 test).

- [ ] **Step 5: Add variant-resolution tests (drive `resolveVariants`/`currentIndexOf` via a tiny exported seam is unnecessary — test through `uniqueNodes` in Task 2). Commit.**

```bash
git add scripts/graph/uniques.js test/graph/uniques.test.js
git commit -m "feat: unique build resolver — PoB parsing + grantedSkillNames"
```

---

### Task 2: Build resolver — `uniqueNodes()`

**Files:**
- Modify: `scripts/graph/uniques.js`
- Test: `test/graph/uniques.test.js`

**Interfaces:**
- Consumes: `baseNodes()` from `./bases.js` (returns `{ nodes, records }`; each base node has `.name`, `props.className`, `props.classSlug`).
- Produces: `uniqueNodes(): { nodes, records }`. Each node: `{ id, kind:'unique', name, slug, props, search }` with `props = { base, itemClass, className, classSlug, iconDds, flavour, inventorySize, currentIndex, variants }`. Each record (for Task 3): `{ id, slug, name, base, grantNames }`.

- [ ] **Step 1: Write the failing tests**

Append to `test/graph/uniques.test.js`:

```js
import { uniqueNodes } from '../../scripts/graph/uniques.js';

test('uniqueNodes: one node per unique with the Unique/ id scheme', () => {
  const { nodes } = uniqueNodes();
  assert.ok(nodes.length > 300, `expected 300+ uniques, got ${nodes.length}`);
  const ids = new Set();
  for (const n of nodes) {
    assert.equal(n.kind, 'unique');
    assert.match(n.id, /^Unique\//, `id namespaced: ${n.id}`);
    assert.ok(!ids.has(n.id), `duplicate id ${n.id}`);
    ids.add(n.id);
    assert.ok(n.name && n.slug && n.props.base, `core fields on ${n.id}`);
    assert.ok(Array.isArray(n.props.variants) && n.props.variants.length > 0);
    assert.ok(n.props.currentIndex >= 0 && n.props.currentIndex < n.props.variants.length);
  }
});

test('uniqueNodes: Astramentis resolves metadata, class, icon, id', () => {
  const a = uniqueNodes().nodes.find((n) => n.slug === 'astramentis');
  assert.ok(a, 'Astramentis node present');
  assert.equal(a.id, 'Unique/Astramentis');        // meta.id form
  assert.equal(a.name, 'Astramentis');
  assert.equal(a.props.base, 'Stellar Amulet');
  assert.equal(a.props.className, 'Amulets');       // base canonical class
  assert.equal(a.props.classSlug, 'amulet');
  assert.match(a.props.iconDds, /Astramentis/);
});

test('uniqueNodes: The Anvil variant resolution picks the Current variant', () => {
  const anvil = uniqueNodes().nodes.find((n) => n.slug === 'the-anvil');
  assert.ok(anvil);
  assert.equal(anvil.props.variants.length, 3);
  assert.equal(anvil.props.currentIndex, 2);
  assert.equal(anvil.props.variants[2].name, 'Current');
  const cur = anvil.props.variants[anvil.props.currentIndex];
  assert.deepEqual(cur.implicits, ['+(30-40) to maximum Life']);
  assert.ok(cur.explicits.includes('25% increased Block chance'));
  assert.ok(cur.explicits.includes('+(5-10)% to maximum Block chance'));
  assert.ok(!cur.explicits.includes('20% increased Block chance'), 'legacy roll excluded');
});

test('uniqueNodes: Guiding Palm gates one Purity grant per variant', () => {
  const gp = uniqueNodes().nodes.find((n) => n.slug === 'guiding-palm');
  assert.ok(gp);
  assert.equal(gp.props.variants.length, 6);
  assert.equal(gp.props.currentIndex, 5);           // no "Current" token -> last
  assert.ok(!gp.props.variants.some((v) => v.name === 'Current'));
  const cur = gp.props.variants[5];
  const grants = [...cur.implicits, ...cur.explicits].filter((l) => l.startsWith('Grants Skill:'));
  assert.equal(grants.length, 1, 'exactly one Purity grant on the current variant');
  assert.match(grants[0], /Purity of Lightning/);
});

test('uniqueNodes: search is current-variant only, lowercased', () => {
  const anvil = uniqueNodes().nodes.find((n) => n.slug === 'the-anvil');
  assert.ok(anvil.search.includes('25% increased block chance'));
  assert.ok(!anvil.search.includes('20% increased block chance'), 'legacy roll not searchable');
  assert.ok(anvil.search.includes('the anvil') && anvil.search.includes('bloodstone amulet'));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/graph/uniques.test.js`
Expected: FAIL — `uniqueNodes is not a function`.

- [ ] **Step 3: Implement `uniqueNodes` (append to `scripts/graph/uniques.js`)**

```js
// uniques.json metadata keyed by display name (skip alternate art; first wins).
function buildMetaByName() {
  const raw = loadJson(`${REPOE}/uniques.json`);
  const out = {};
  for (const v of Object.values(raw)) {
    if (!v.name || v.is_alternate_art) continue;
    if (!out[v.name]) out[v.name] = v;
  }
  return out;
}

// Base-class lookup derived from the base nodes: display name -> canonical
// {className, classSlug}, plus classSlug -> className for the non-browsable
// normalization fallback. Computed once.
let _baseClass = null;
function baseClassIndex() {
  if (_baseClass) return _baseClass;
  const { nodes } = baseNodes();
  const byName = new Map();
  const canonBySlug = new Map();
  for (const n of nodes) {
    if (!byName.has(n.name)) byName.set(n.name, { className: n.props.className, classSlug: n.props.classSlug });
    if (!canonBySlug.has(n.props.classSlug)) canonBySlug.set(n.props.classSlug, n.props.className);
  }
  _baseClass = { byName, canonBySlug };
  return _baseClass;
}

// Filterable item class (graph rule: resolved at build). Browsable base -> the
// base's canonical class; otherwise the unique's own item_class normalized to a
// canonical class by slug when one matches, else raw (charms, flasks, jewels).
function classify(baseName, rawItemClass) {
  const { byName, canonBySlug } = baseClassIndex();
  const b = byName.get(baseName);
  if (b) return { className: b.className, classSlug: b.classSlug };
  const slug = slugify(rawItemClass);
  const canon = canonBySlug.get(slug);
  return canon ? { className: canon, classSlug: slug } : { className: rawItemClass, classSlug: slug };
}

export function uniqueNodes() {
  const metaByName = buildMetaByName();
  const nodes = [];
  const records = [];
  const seenSlug = new Set();
  for (const file of listDataDir(POB_DIR)) {
    if (file === '_manifest.json' || !file.endsWith('.json')) continue;
    const entries = loadJson(`${POB_DIR}/${file}`);
    if (!Array.isArray(entries)) continue;
    for (const text of entries) {
      const parsed = parseBlock(text);
      if (!parsed) continue;
      const slug = slugify(parsed.name);
      if (seenSlug.has(slug)) continue; // same-name dedup: keep first
      seenSlug.add(slug);

      const meta = metaByName[parsed.name] ?? null;
      const id = meta?.id ? `Unique/${meta.id}` : `Unique/${slug}`;
      const rawItemClass = meta?.item_class ?? path.basename(file, '.json');
      const { className, classSlug } = classify(parsed.base, rawItemClass);
      const variants = resolveVariants(parsed);
      const currentIndex = currentIndexOf(variants);
      const flavour = getFlavourLines(meta?.visual_identity?.id);

      const props = {
        base: parsed.base,
        itemClass: rawItemClass,
        className,
        classSlug,
        iconDds: meta?.visual_identity?.dds_file ?? null,
        flavour,
        inventorySize: meta ? { w: meta.inventory_width, h: meta.inventory_height } : null,
        currentIndex,
        variants,
      };

      const cur = variants[currentIndex];
      const search = [parsed.name, parsed.base, className, ...cur.implicits, ...cur.explicits, ...(flavour ?? [])]
        .join(' ')
        .toLowerCase();

      nodes.push(makeNode({ id, kind: KINDS.UNIQUE, name: parsed.name, slug, props, search }));
      records.push({ id, slug, name: parsed.name, base: parsed.base, grantNames: grantNamesOf(cur) });
    }
  }
  return { nodes, records };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/graph/uniques.test.js`
Expected: PASS (all Task 1 + Task 2 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/graph/uniques.js test/graph/uniques.test.js
git commit -m "feat: uniqueNodes — variant resolution + resolved class/icon/flavour"
```

---

### Task 3: Build resolver — `uniqueEdges()`

**Files:**
- Modify: `scripts/graph/uniques.js`
- Test: `test/graph/uniques.test.js`

**Interfaces:**
- Consumes: unique `records` (Task 2: `{ id, base, grantNames }`); base `records` from `baseNodes()` (each `{ id, raw: { name } }`); skill `nodes` from `skillNodes(gemRecs)` (each `{ id, slug }`).
- Produces: `uniqueEdges(records, baseRecords, skillNodes): Edge[]` — `has_base` (unique → base) and `grants` (unique → skill).

- [ ] **Step 1: Write the failing tests**

Append to `test/graph/uniques.test.js`:

```js
import { uniqueEdges } from '../../scripts/graph/uniques.js';
import { baseNodes } from '../../scripts/graph/bases.js';
import { skillNodes, selectGemRecords } from '../../scripts/graph/gems.js';

test('uniqueEdges: has_base only targets browsable base nodes', () => {
  const { records } = uniqueNodes();
  const { nodes: bNodes, records: baseRecs } = baseNodes();
  const baseIds = new Set(bNodes.map((n) => n.id));
  const skl = skillNodes(selectGemRecords());

  const edges = uniqueEdges(records, baseRecs, skl);
  const hasBase = edges.filter((e) => e.type === 'has_base');
  assert.ok(hasBase.length > 200, `most uniques sit on a browsable base, got ${hasBase.length}`);
  for (const e of hasBase) assert.ok(baseIds.has(e.to), `has_base target ${e.to} is a base node`);

  // Astramentis (Stellar Amulet) has a has_base edge; a jewel unique does not.
  const astra = records.find((r) => r.slug === 'astramentis');
  assert.ok(hasBase.some((e) => e.from === astra.id), 'Astramentis -> Stellar Amulet');
  const adorned = records.find((r) => r.slug === 'the-adorned'); // jewel base, not browsable
  assert.ok(adorned, 'fixture present');
  assert.ok(!hasBase.some((e) => e.from === adorned.id), 'jewel unique has no has_base');
});

test('uniqueEdges: grants resolve to skill nodes with zero dangling', () => {
  const { records } = uniqueNodes();
  const { records: baseRecs } = baseNodes();
  const skl = skillNodes(selectGemRecords());
  const skillIds = new Set(skl.map((n) => n.id));
  const skillBySlug = new Map(skl.map((n) => [n.slug, n.id]));

  const edges = uniqueEdges(records, baseRecs, skl);
  const grants = edges.filter((e) => e.type === 'grants');
  assert.ok(grants.length > 50, `many grants edges, got ${grants.length}`);
  for (const e of grants) assert.ok(skillIds.has(e.to), `grants target ${e.to} is a skill node`);

  // Guiding Palm's current (Lightning) variant grants Purity of Lightning.
  const gp = records.find((r) => r.slug === 'guiding-palm');
  const want = skillBySlug.get('purity-of-lightning');
  assert.ok(want, 'Purity of Lightning skill node exists');
  assert.ok(grants.some((e) => e.from === gp.id && e.to === want), 'Guiding Palm -> Purity of Lightning');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/graph/uniques.test.js`
Expected: FAIL — `uniqueEdges is not a function`.

- [ ] **Step 3: Implement `uniqueEdges` (append to `scripts/graph/uniques.js`)**

```js
export function uniqueEdges(records, baseRecords, skillNodes) {
  // Mirror getBaseByName's name index (last write wins) so has_base targets the
  // same browsable base the app resolves; non-browsable bases (jewels/flasks/
  // charms) are simply absent -> no edge.
  const baseIdByName = new Map();
  for (const r of baseRecords) baseIdByName.set(r.raw.name, r.id);
  const skillIdBySlug = new Map(skillNodes.map((n) => [n.slug, n.id]));

  const edges = [];
  for (const r of records) {
    const baseId = baseIdByName.get(r.base);
    if (baseId) edges.push(makeEdge({ type: EDGE_TYPES.HAS_BASE, from: r.id, to: baseId }));
    for (const name of r.grantNames) {
      const skillId = skillIdBySlug.get(slugify(name));
      if (skillId) edges.push(makeEdge({ type: EDGE_TYPES.GRANTS, from: r.id, to: skillId }));
    }
  }
  return edges;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/graph/uniques.test.js`
Expected: PASS (all uniques resolver tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/graph/uniques.js test/graph/uniques.test.js
git commit -m "feat: uniqueEdges — has_base + grants resolution"
```

---

### Task 4: Wire into `build.js`; point `gems.js` at the folded `grantedSkillNames`

**Files:**
- Modify: `scripts/graph/build.js`
- Modify: `scripts/graph/gems.js:5`
- Test: `test/graph/build.test.js`

**Interfaces:**
- Consumes: `uniqueNodes()`, `uniqueEdges(records, baseRecords, skillNodes)`, `grantedSkillNames()` from `./uniques.js`.
- Produces: `buildGraph()` now emits `unique` nodes, `has_base` + `grants` edges (the latter added by uniques on top of gem grants); `hashSources()` covers the unique source files.

- [ ] **Step 1: Write the failing test**

Append to `test/graph/build.test.js`:

```js
test('buildGraph includes unique nodes with has_base and grants edges', () => {
  const g = buildGraph();
  assert.ok(g.nodes.some((n) => n.kind === 'unique'), 'unique nodes present');
  assert.ok(g.edges.some((e) => e.type === 'has_base'), 'has_base edges present');
  // grants edges now come from both gems and uniques; assert a unique-sourced one.
  assert.ok(
    g.edges.some((e) => e.type === 'grants' && String(e.from).startsWith('Unique/')),
    'a grants edge originates from a unique node',
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/graph/build.test.js`
Expected: FAIL — no `unique` nodes / no `has_base` edges (uniques not wired in yet).

- [ ] **Step 3: Repoint `gems.js` at the folded resolver**

In `scripts/graph/gems.js`, change line 5:

```js
import { grantedSkillNames } from './uniques.js';
```

(was `import { grantedSkillNames } from '../../src/data/grantedSkills.js';`). No other change — `grantedSkillNames` is pure and `uniques.js` does not import `gems.js`, so there is no import cycle.

- [ ] **Step 4: Wire `build.js`**

In `scripts/graph/build.js`, add the import alongside the others:

```js
import { uniqueNodes, uniqueEdges } from './uniques.js';
```

Extend `SOURCE_FILES` with the two REPOE-relative unique sources:

```js
const SOURCE_FILES = [
  `${REPOE}/skill_gems.json`,
  `${REPOE}/skills.json`,
  `${REPOE}/base_items.json`,
  `${REPOE}/item_classes.json`,
  `${REPOE}/mods.json`,
  `${REPOE}/mods_by_base.json`,
  `${REPOE}/stat_translations/stat_descriptions.json`,
  `${REPOE}/uniques.json`,
  `${REPOE}/flavour.json`,
];
```

Extend `hashSources` to also fold in the `pob-uniques/*.json` set (a directory, not under `REPOE`), sorted for determinism:

```js
export function hashSources() {
  const h = crypto.createHash('sha256');
  const dir = getDataDir();
  for (const rel of SOURCE_FILES) h.update(fs.readFileSync(path.join(dir, rel)));
  // pob-uniques is a directory of per-class files; hash all of them sorted so a
  // re-scrape of any unique block invalidates the artifact. Subdirs (Special/)
  // are non-.json entries and fall out of the filter.
  const pobDir = path.join(dir, 'pob-uniques');
  for (const f of fs.readdirSync(pobDir).filter((f) => f.endsWith('.json')).sort()) {
    h.update(fs.readFileSync(path.join(pobDir, f)));
  }
  return h.digest('hex');
}
```

In `buildGraph()`, resolve unique nodes/edges and append them. The skill nodes (`sNodes`) and base records (`baseRecs`) are already in scope:

```js
export function buildGraph() {
  const { nodes: gNodes, records: gemRecs } = gemNodes();
  const sNodes = skillNodes(gemRecs);
  const { nodes: bNodes, records: baseRecs } = baseNodes();
  const cNodes = classNodes();
  const tNodes = tagNodes(baseRecs);
  const { nodes: aNodes, records: affixRecs } = affixNodes();
  const { nodes: uNodes, records: uniqueRecs } = uniqueNodes();

  const nodes = [...gNodes, ...sNodes, ...bNodes, ...cNodes, ...tNodes, ...aNodes, ...uNodes];
  const nodeIds = new Set(nodes.map((n) => n.id));
  const edges = [
    ...gemEdges(gemRecs, nodeIds),
    ...baseEdges(baseRecs, nodeIds),
    ...affixEdges(affixRecs, baseRecs, nodeIds),
    ...uniqueEdges(uniqueRecs, baseRecs, sNodes),
  ];

  const errors = validateGraph({ nodes, edges });
  if (errors.length) throw new Error(`graph validation failed:\n${errors.join('\n')}`);

  return { meta: { sourceHash: hashSources(), schema: 1 }, nodes, edges };
}
```

- [ ] **Step 5: Run the build + graph tests to verify they pass**

Run: `node --test test/graph/build.test.js test/graph/uniques.test.js test/graph/gems.test.js`
Expected: PASS. (`buildGraph` throws if `validateGraph` finds a dangling edge or duplicate slug — a clean run proves `has_base`/`grants` targets all exist and unique slugs are distinct within the kind.)

- [ ] **Step 6: Rebuild the artifact and confirm it is clean**

Run: `npm run build:graph`
Expected: exits 0, writes `build/graph.json` with no validation error.

- [ ] **Step 7: Commit**

```bash
git add scripts/graph/build.js scripts/graph/gems.js test/graph/build.test.js
git commit -m "feat: assemble unique nodes/edges in buildGraph; fold grantedSkillNames"
```

---

### Task 5: App cutover — `uniques.js` adapter, `baseItems.js` reverse edge, delete `grantedSkills.js`

**Files:**
- Modify: `src/data/uniques.js` (full rewrite to a graph adapter)
- Modify: `src/data/baseItems.js` (`uniquesOnBase` + imports + comment)
- Delete: `src/data/grantedSkills.js`
- Test: `test/uniques.test.js` (existing — must pass unchanged), `test/mods.test.js`, `test/bases.test.js`, `test/gems.test.js` (stay green)

**Interfaces:**
- Consumes: `nodesByKind('unique')`, `nodeBySlug('unique', slug)`, `edgesTo(id, 'has_base')`, `getNode(id)` from `./graph.js`; `getBaseByName`, `listItemClasses` from `./baseItems.js`; `parseLocalMods`, `computeProperties` from `./itemStats.js`; `getGem` from `./gems.js`; `ddsUrl`, `slugify`, `linkifyPhrases`, `hasDefinition`.
- Produces: unchanged public surface — `listUniques()`, `getUnique(slug)`, `listUniqueCards()`, `listUniqueClassFilters()`, `buildUniqueViewModel(slug)`. `listUniques()`/`getUnique()` keep the **legacy flat record shape** (`{ slug, name, base, stats, itemClass, iconUrl, flavour, implicitCount }`) so `theorycraft.js` and the existing tests need no change.

> **Parity guardrails (why each field is sourced as it is):**
> - `listUniques()`/`getUnique()` must NOT add `className`/`classSlug` to the record — the current code's `buildUniqueViewModel` spreads the record, and an extra field would change its output. Those two live only on the node and are read directly by the card/filter builders.
> - `listUniqueCards` `itemClass` = `node.props.className` (matches the current `classifyUnique(...).label`), but `buildUniqueViewModel` `className` = `baseRecord?.className ?? u.itemClass` (the current code's exact expression — deliberately different from the card for non-browsable bases whose `item_class` slug matches a canonical class). Preserve both.
> - `inventorySize` / `properties` / `requirements` come from the **linked base record** (`getBaseByName`), so non-browsable bases stay `null`/`[]` exactly as today. The node's own `inventorySize` prop is data completeness, not the tooltip-image source.

- [ ] **Step 1: Run the existing tests against the source-backed module to capture the baseline (sanity, should pass before the rewrite)**

Run: `node --test test/uniques.test.js`
Expected: PASS (current source-backed implementation). This is the contract the rewrite must preserve.

- [ ] **Step 2: Rewrite `src/data/uniques.js` as a graph adapter**

Replace the entire file with:

```js
import { slugify } from './slug.js';
import { ddsUrl } from './images.js';
import { getGem } from './gems.js';
import { getBaseByName, listItemClasses } from './baseItems.js';
import { parseLocalMods, computeProperties } from './itemStats.js';
import { hasDefinition } from './keywordDefs.js';
import { linkifyPhrases } from './keywords.js';
import { nodesByKind, nodeBySlug, edgesTo, getNode } from './graph.js';

// Presentation adapter over the build-time graph (build/graph.json). Unique
// identity, variant resolution, resolved class/icon/flavour, and the has_base /
// grants relationships live in the graph (scripts/graph/uniques.js); this module
// reads `unique` nodes + edges and owns all rendering. It performs NO reads of
// $POE2DATADIR. The detail tooltip still derives item stats from the linked base
// (getBaseByName + parseLocalMods/computeProperties — already graph-backed).

const UNIQUE_BORDER = 'rgba(175,96,37,0.8)';
const UNIQUE_GLOW = 'rgba(175,96,37,0.45)';

// "Grants Skill: Name", "Grants Skill: Level (N-M) Name", or "Grants Skill: Level N Name".
const GRANTS_SKILL_RE = /^(Grants Skill: (?:Level (?:\([^)]+\)|\d+) )?)(.+)$/;

// Render affix text to safe HTML (value highlighting + keyword glossary hovers).
function renderAffix(text) {
  return linkifyPhrases(text, hasDefinition);
}

// Parse a stat line; for grant lines, attach a gemSlug + skill icon if the gem
// exists (rendering intentionally stays on the existing getGem(slug) lookup —
// the 70-linked / 2-unlinked split is unchanged from before the cutover).
function parseStatLine(text) {
  const m = text.match(GRANTS_SKILL_RE);
  if (!m) return { text, html: renderAffix(text) };
  const prefix = m[1];
  const skillName = m[2];
  const slug = slugify(skillName);
  const gem = getGem(slug);
  return {
    text,
    html: renderAffix(text),
    prefix,
    prefixHtml: renderAffix(prefix),
    skillName,
    gemSlug: gem ? slug : null,
    iconUrl: gem ? ddsUrl(gem.icon_dds_file) : null,
  };
}

// Reconstruct the legacy flat record from a unique graph node: current-variant
// stats + implicitCount, plus identity/icon/flavour. Keeps listUniques()/
// getUnique() stable for theorycraft.js and the card/VM builders.
function toUnique(node) {
  const p = node.props;
  const cur = p.variants[p.currentIndex];
  return {
    slug: node.slug,
    name: node.name,
    base: p.base,
    stats: [...cur.implicits, ...cur.explicits],
    itemClass: p.itemClass,
    iconUrl: ddsUrl(p.iconDds),
    flavour: p.flavour,
    implicitCount: cur.implicits.length,
  };
}

export function listUniques() {
  return nodesByKind('unique').map(toUnique);
}

export function getUnique(slug) {
  const node = nodeBySlug('unique', slug);
  return node ? toUnique(node) : null;
}

// Canonical item-class lookup keyed by class slug, built from the base-item layer
// so unique filters line up with the /bases class taxonomy. Lazily memoized.
let _canonClassBySlug = null;
function canonClassBySlug() {
  if (_canonClassBySlug) return _canonClassBySlug;
  _canonClassBySlug = new Map();
  for (const group of listItemClasses()) {
    for (const c of group.classes) {
      _canonClassBySlug.set(c.classSlug, { label: c.name, slug: c.classSlug, iconUrl: c.iconUrl });
    }
  }
  return _canonClassBySlug;
}

// Distinct item-class filter options present among the uniques, ordered by the
// canonical /bases group order (Weapons -> Armour -> Accessories), with any
// non-browsable extras (Charm, Flask, Jewel, …) appended alphabetically. The
// class is read straight off the node (resolved at build).
export function listUniqueClassFilters() {
  const canon = canonClassBySlug();
  const present = new Map(); // slug -> { value, label, icon }
  for (const node of nodesByKind('unique')) {
    const { className: label, classSlug: slug } = node.props;
    const iconUrl = ddsUrl(node.props.iconDds);
    if (!present.has(slug)) {
      present.set(slug, { value: slug, label, icon: canon.get(slug)?.iconUrl ?? iconUrl ?? null });
    } else if (!present.get(slug).icon && iconUrl) {
      present.get(slug).icon = iconUrl;
    }
  }
  const ordered = [];
  const seen = new Set();
  for (const group of listItemClasses()) {
    for (const c of group.classes) {
      if (present.has(c.classSlug)) {
        ordered.push(present.get(c.classSlug));
        seen.add(c.classSlug);
      }
    }
  }
  const extras = [...present.values()]
    .filter((e) => !seen.has(e.value))
    .sort((a, b) => a.label.localeCompare(b.label));
  return [...ordered, ...extras];
}

// Condensed view models for the /uniques browse grid.
export function listUniqueCards() {
  return nodesByKind('unique').map((node) => {
    const u = toUnique(node);
    const baseRecord = getBaseByName(u.base);
    const parsed = u.stats.map(parseStatLine);
    const mods = parseLocalMods(u.stats);
    const properties = baseRecord
      ? computeProperties(baseRecord.rawProperties, mods).map((p) => ({ ...p, labelHtml: renderAffix(p.label) }))
      : [];
    return {
      slug: u.slug,
      name: u.name,
      base: u.base,
      itemClass: node.props.className,
      itemClassSlug: node.props.classSlug,
      iconUrl: u.iconUrl,
      inventorySize: baseRecord?.inventorySize ?? null,
      properties,
      requirements: baseRecord?.requirements ?? [],
      implicits: parsed.slice(0, u.implicitCount),
      explicits: parsed.slice(u.implicitCount),
    };
  });
}

export function buildUniqueViewModel(slug) {
  const u = getUnique(slug);
  if (!u) return null;

  const baseRecord = getBaseByName(u.base);
  const mods = parseLocalMods(u.stats);
  const properties = baseRecord
    ? computeProperties(baseRecord.rawProperties, mods).map((p) => ({ ...p, labelHtml: renderAffix(p.label) }))
    : [];
  const requirements = baseRecord?.requirements ?? [];

  const parsedStats = u.stats.map(parseStatLine);
  const implicits = parsedStats.slice(0, u.implicitCount);
  const explicits = parsedStats.slice(u.implicitCount);

  return {
    ...u,
    stats: parsedStats,
    implicits,
    explicits,
    properties,
    requirements,
    // Prefer the base's display name ("Spears") over the raw item class ("Spear").
    className: baseRecord?.className ?? u.itemClass,
    borderColor: UNIQUE_BORDER,
    glowColor: UNIQUE_GLOW,
    baseSlug: slugify(u.base),
  };
}
```

- [ ] **Step 3: Run the existing uniques tests against the adapter**

Run: `node --test test/uniques.test.js`
Expected: PASS (all 14 tests) — same contract, now graph-backed. (`build/graph.json` from Task 4 Step 6 is present; if absent, `graph.js` builds it in memory.)

- [ ] **Step 4: Rewire `baseItems.js` `uniquesOnBase` to the reverse edge**

In `src/data/baseItems.js`:

Remove the source import (line 2):

```js
import { listUniques } from './uniques.js';   // DELETE THIS LINE
```

Add `edgesTo`/`getNode` to the existing graph import (line 7):

```js
import { nodesByKind, edgesTo, getNode } from './graph.js';
```

Update the module-header comment (lines 14–16) — drop the "uniquesOnBase still reads source via uniques.js" caveat, since it no longer does:

```js
// $POE2DATADIR. Implicit and affix-table text arrive pre-resolved (the graph holds
// the strings; this module renders them). uniquesOnBase is resolved via the
// has_base reverse edge (unique -> base) — no source read, no uniques.js import.
```

Replace `buildBaseItemViewModel` (lines 360–369):

```js
export function buildBaseItemViewModel(slug) {
  const b = getBaseItem(slug);
  if (!b) return null;

  // "Uniques on this base" — the reverse of the unique's has_base edge. Replaces
  // the former listUniques().filter(u.base === b.name) source scan.
  const uniquesOnBase = edgesTo(b.metadataKey, 'has_base')
    .map((e) => getNode(e.from))
    .filter(Boolean)
    .map((n) => ({ slug: n.slug, name: n.name, iconUrl: ddsUrl(n.props.iconDds) }));

  return { ...b, uniquesOnBase, runeVariants: _runeByParent.get(b.slug) ?? [] };
}
```

- [ ] **Step 5: Delete `grantedSkills.js` and confirm no remaining importers**

```bash
git rm src/data/grantedSkills.js
grep -rn "grantedSkills" src/ scripts/ test/
```
Expected: the only match is `scripts/graph/uniques.js`'s comment referencing the former file (no live `import`). If any `import ... grantedSkills.js` remains, repoint it to `./uniques.js` (build-side) — there should be none after Task 4 Step 3.

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS — `test/uniques.test.js`, `test/bases.test.js`, `test/mods.test.js`, `test/gems.test.js`, and all `test/graph/*` green. (`pretest` rebuilds `build/graph.json` first.)

- [ ] **Step 7: Commit**

```bash
git add src/data/uniques.js src/data/baseItems.js
git commit -m "feat: uniques app-cutover — read unique data from the graph artifact"
```

---

### Task 6: Temporary worktree parity check, artifact-size measurement, finish branch

This proves the graph-backed output is byte-identical to pre-migration by dumping the old output from a `master` worktree and asserting equality. The harness is deleted before merge (post-cutover it would compare the graph against itself).

**Files:**
- Create (temporary): `test/graph/uniques.parity.test.js`
- Create (temporary, gitignored): `build/uniques-parity.json`

- [ ] **Step 1: Create a `master` worktree and dump the pre-migration output**

```bash
git worktree add /tmp/poe2-uniques-master master
cd /tmp/poe2-uniques-master
ln -s "$OLDPWD/.env" .env   # reuse POE2DATADIR
```

Write a one-off dump script `/tmp/poe2-uniques-master/dump-parity.mjs`:

```js
import { listUniqueCards, buildUniqueViewModel, listUniqueClassFilters, listUniques } from './src/data/uniques.js';
import { buildBaseItemViewModel, listItemClasses, getItemClass } from './src/data/baseItems.js';
import fs from 'node:fs';

const slugs = listUniques().map((u) => u.slug).sort();
const vms = Object.fromEntries(slugs.map((s) => [s, buildUniqueViewModel(s)]));

// uniquesOnBase for every browsable base, keyed by base slug.
const baseSlugs = [];
for (const g of listItemClasses()) for (const c of g.classes) for (const b of getItemClass(c.classSlug).bases) baseSlugs.push(b.slug);
const uniquesOnBase = Object.fromEntries(
  baseSlugs.sort().map((s) => [s, (buildBaseItemViewModel(s)?.uniquesOnBase) ?? []]),
);

// uniqueDocs: theorycraft's search docs for uniques (reproduce its projection).
const docs = listUniques().map((u) => ({
  name: u.name, url: `/unique/${u.slug}`, category: 'unique',
  iconUrl: u.iconUrl || null, subtitle: u.base || '',
  tags: [String(u.itemClass || '').toLowerCase()].filter(Boolean),
  text: [u.name, u.base, ...(u.stats || []), ...(u.flavour || [])].join(' '),
}));

fs.writeFileSync('/tmp/uniques-parity.json', JSON.stringify({
  cards: listUniqueCards(), vms, filters: listUniqueClassFilters(), uniquesOnBase, docs,
}, null, 0));
console.error('wrote /tmp/uniques-parity.json');
```

Run it from the worktree, then return:

```bash
node dump-parity.mjs
cd "$OLDPWD"
cp /tmp/uniques-parity.json build/uniques-parity.json
```

- [ ] **Step 2: Write the parity test against the dumped fixture**

Create `test/graph/uniques.parity.test.js`:

```js
// TEMPORARY parity harness — deleted in this task's final step. Asserts the
// graph-backed unique output equals the pre-migration source-backed output
// captured from a `master` worktree into build/uniques-parity.json.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { listUniqueCards, buildUniqueViewModel, listUniqueClassFilters, listUniques } from '../../src/data/uniques.js';
import { buildBaseItemViewModel } from '../../src/data/baseItems.js';

const expected = JSON.parse(fs.readFileSync(new URL('../../build/uniques-parity.json', import.meta.url)));

test('parity: listUniqueCards byte-identical', () => {
  assert.deepEqual(listUniqueCards(), expected.cards);
});

test('parity: buildUniqueViewModel byte-identical for every slug', () => {
  const got = Object.fromEntries(listUniques().map((u) => [u.slug, buildUniqueViewModel(u.slug)]));
  assert.deepEqual(got, expected.vms);
});

test('parity: listUniqueClassFilters byte-identical', () => {
  assert.deepEqual(listUniqueClassFilters(), expected.filters);
});

test('parity: uniquesOnBase byte-identical for every base', () => {
  const got = {};
  for (const slug of Object.keys(expected.uniquesOnBase)) {
    got[slug] = buildBaseItemViewModel(slug)?.uniquesOnBase ?? [];
  }
  assert.deepEqual(got, expected.uniquesOnBase);
});

test('parity: uniqueDocs projection byte-identical', () => {
  const got = listUniques().map((u) => ({
    name: u.name, url: `/unique/${u.slug}`, category: 'unique',
    iconUrl: u.iconUrl || null, subtitle: u.base || '',
    tags: [String(u.itemClass || '').toLowerCase()].filter(Boolean),
    text: [u.name, u.base, ...(u.stats || []), ...(u.flavour || [])].join(' '),
  }));
  assert.deepEqual(got, expected.docs);
});
```

- [ ] **Step 3: Run the parity test**

Run: `node --test test/graph/uniques.parity.test.js`
Expected: PASS (5 tests). If any `deepEqual` fails, the diff names the exact slug/field — fix the adapter (Task 5) until byte-identical. Do not edit the fixture to match.

- [ ] **Step 4: Measure artifact size + parse time before/after**

```bash
git stash --include-untracked   # park the cutover to size the pre-uniques artifact... 
```

Simpler: compare the committed-before size to now. Record current size and parse time:

```bash
npm run build:graph
ls -l build/graph.json | awk '{print "graph.json bytes:", $5}'
node -e "const t=process.hrtime.bigint(); require('fs').readFileSync('build/graph.json'); JSON.parse(require('fs').readFileSync('build/graph.json','utf8')); console.log('parse ms:', Number(process.hrtime.bigint()-t)/1e6)"
```

Note the delta vs. the affix-cutover baseline (12.8 MB / 28 ms, per commit `51c38c2`). Watch the all-variants payload (e.g. Morior Invictus's ~28 variants). Record the numbers for the merge commit body.

- [ ] **Step 5: Remove the temporary harness and fixture**

```bash
rm test/graph/uniques.parity.test.js build/uniques-parity.json
git worktree remove /tmp/poe2-uniques-master --force
rm -f /tmp/uniques-parity.json
```

`build/` is gitignored, so the fixture was never tracked; only confirm the test file is gone:

```bash
git status --short
```
Expected: clean (no `uniques.parity.test.js`).

- [ ] **Step 6: Final full-suite run**

Run: `npm test`
Expected: PASS — full suite green, no parity harness present.

- [ ] **Step 7: Merge to master (`--no-ff`)**

Use the `superpowers:finishing-a-development-branch` skill. The merge commit body should record: nodes/edges added (unique count, has_base count, grants count), parity result (byte-identical across cards/VMs/filters/uniquesOnBase/docs), and the artifact size + parse-time delta from Step 4.

```bash
git checkout master
git merge --no-ff feat/uniques-graph-cutover
```

---

## Self-Review

**Spec coverage:**
- Node model (`unique`, id scheme + fallback, resolved stat text, searchable unique-only lines) → Task 2 (`uniqueNodes`, `props`, `search`). ✓
- Variants (superset, per-variant split, `currentIndex` by token, no `history`/`form` discriminator) → Task 1 `resolveVariants`/`currentIndexOf` + Task 2 tests (The Anvil, Guiding Palm). ✓
- Filterable item class resolved at build → Task 2 `classify`. ✓
- Searchable text (current-variant only) → Task 2 `search` + test. ✓
- `has_base` edge (browsable-only, forward + reverse) → Task 3 + Task 5 `uniquesOnBase`. ✓
- `grants` edge (current-variant, name-slug → skill, decoupled rendering) → Task 3 + Task 5 `parseStatLine` (rendering unchanged). ✓
- Module structure (`scripts/graph/uniques.js` exports, `gems.js` import, `build.js` wiring, delete `grantedSkills.js`, adapter) → Tasks 1–5. ✓
- Testing (build-side units, worktree parity, regression guard, artifact size) → Tasks 1–3, 6. ✓
- Sequencing (resolver → wire → app cutover → parity → suite → merge) → Tasks 1–6. ✓
- Non-goals respected (no alt-variant multi-axis, no switcher UI, no skill→gem icon upgrade, no discriminator, unique-only lines stay text). ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code; commands have expected output. ✓

**Type consistency:** `uniqueNodes(): {nodes, records}`; record shape `{id, slug, name, base, grantNames}` produced in Task 2, consumed unchanged in Task 3/4. `uniqueEdges(records, baseRecords, skillNodes)` signature identical across Task 3 definition and Task 4 call site. Adapter `toUnique` field set matches the legacy record asserted by `test/uniques.test.js`. `edgesTo(id,'has_base')` / `getNode` imported in Task 5 and exist in `src/data/graph.js`. ✓

**Note on theorycraft.js:** intentionally untouched — `uniqueDocs()` reads `listUniques()`, whose contract is preserved, and the parity harness (Task 6 Step 2, `docs`) proves the projection is byte-identical.
