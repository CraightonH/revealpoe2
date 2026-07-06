# Phase 1 — Build Store Foundation

Part of the Build Planner roadmap (`2026-07-06-build-planner-roadmap.md`). No UI in this phase — pure modules + tests only.

## Purpose

The persistence and serialization layer every later phase builds on: a versioned localStorage store for named builds, and a compact URL-share codec. Written as pure ES modules (node-testable, browser-importable) following the `query-core.js` / `passive-code.js` dual-use pattern.

## Build schema v1

```js
{
  id: string,          // crypto.randomUUID() at creation
  schema: 1,           // schema version for migration
  name: string,
  notes: string,       // plain text; markup TBD by later phases if needed
  createdAt: number,   // epoch ms
  updatedAt: number,
  class: string|null,       // character class id/name (matches tree artifact)
  ascendancy: string|null,
  gear: {
    // slotId keys defined by Phase 2 (e.g. 'helmet', 'body', 'weapon1a'…).
    // Unknown slotIds are preserved (forward compatibility).
    [slotId]: {
      item: { kind: 'unique'|'base', slug: string } | null,
      wishlist: [ string ],  // affix typeSlugs (theorycraft affix doc key space)
    }
  },
  unassigned: [ { kind, slug } ],   // items added via "Add to Build" not yet placed
  skills: [                          // ordered setups, incl. spirit gems
    { gem: { slug }, level: number|null, supports: [ { slug } ] }
  ],
  tree: {
    code: string|null,               // official v7 share code (passive-code.js)
    notablePriority: [ number ],     // ordered node hashes — order of operations
  },
}
```

- **Item references use the browse-card key space** (`kind` + `slug`) so cards resolve via `browse-cards.json` with zero lookups invented here.
- `notablePriority` ordering exists **now** (not Phase 5) because it's schema: Phase 5 populates it, Phase 8's `.build` export consumes it for the in-game "allocate next" sequence.
- Spirit gems are just `skills[]` entries — whether a gem is a spirit gem is derivable from graph data, not stored.

## Modules

### `public/js/build-store.js` — pure core

- `createStore(storage)` — takes a `{getItem,setItem,removeItem}` storage interface (localStorage in browser, in-memory map in tests). Returns the store API.
- API: `list()`, `get(id)`, `create(partial)`, `update(id, patch)` (bumps `updatedAt`), `remove(id)`, `duplicate(id)`, `subscribe(fn)` (change events; browser wrapper also relays cross-tab `storage` events).
- Storage layout: single key `reveal.builds.v1` → `{ order: [id], builds: { [id]: build } }`. Builds are a few KB each; a single JSON key is well within quota and keeps writes atomic.
- **Robustness:** corrupt JSON → treated as empty with the corrupt payload preserved under `reveal.builds.corrupt` (never silently destroyed); `setItem` quota errors surface as a typed error the UI can present.
- **Migration hook:** `schema` field checked on read; v1 has a no-op migration table that later schema bumps extend. Unknown fields pass through untouched.
- Validation: `validateBuild(obj)` — shape check used by tests, import paths, and the codec.

### `public/js/build-code.js` — share codec

- `encodeBuild(build)` → `Promise<string>`: strip local-only fields (`id`, timestamps) → canonical JSON → deflate-raw (`CompressionStream` in browser, `node:zlib` in node — same dual-environment trick as `passive-code.js`'s atob/Buffer) → base64url, prefixed with a codec version char (`'1'`).
- `decodeBuild(str)` → `Promise<build-without-id>`: inverse; validates with `validateBuild`; unknown version prefix → typed error.
- Round-trip property test: `decode(encode(b))` deep-equals the canonical form of `b`.
- Size expectation: a realistic build (~12 gear slots, ~8 setups, tree code, 15 priorities) compresses to well under 2 KB — fine for a URL fragment. Test asserts a ceiling.

## Testing

- `test/build-store.test.js`, `test/build-code.test.js` — node:test, in-memory storage, no DOM. Cover CRUD, ordering, corruption recovery, quota error, migration passthrough, codec round-trip + version rejection.

## Acceptance criteria

- [x] Both modules importable in node **and** shippable to the browser unchanged (no node-only imports at top level; zlib behind environment detection). *(Codec uses the Web `CompressionStream`/`DecompressionStream` API — global in Node ≥20 and evergreen browsers — instead of `node:zlib`, so no environment branch is needed at all.)*
- [x] `npm test` green with new suites. *(438 tests pass — 414 pre-existing + 24 new across `build-store.test.js` (17) and `build-code.test.js` (7).)*
- [x] No UI, no route, no template changes. Nothing reads raw localStorage outside `build-store.js`.
