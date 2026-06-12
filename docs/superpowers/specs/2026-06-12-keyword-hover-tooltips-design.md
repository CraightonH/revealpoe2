# Keyword Hover Tooltips — Design

**Date:** 2026-06-12
**Status:** Approved design, pending implementation plan

## Goal

Match poe2db.tw's signature feature: any in-game keyword rendered in the wiki
(gem tags, stat lines, skill descriptions) is highlighted, and hovering it
shows a tooltip explaining the term — the same information surface the game
gives, in a familiar UI. Tooltips are themselves interactive: a definition can
reference other keywords, and the user can move into the tooltip to hover those
nested terms.

This is tooltip-only. Keywords are **not** clickable links to glossary pages
(poe2db has both); we have no glossary pages yet, so keywords render as styled
`<span>`s. The markup stays forward-compatible so a future feature can upgrade
them to `<a>` anchors without reworking the data flow.

## Background: what already exists

- The game data uses poe2db's exact `[Key|Display]` markup. `keywords.json`
  definitions even cross-reference each other with the same syntax.
- `src/data/keywords.js` `renderGameText(text)` is already the choke point for
  all gem stat/quality/description text. It parses `[Key]` / `[Key|Display]`
  tokens into `<span class="kw" data-keyword="Key">Display</span>` and escapes
  the rest.
- `keywords.json`: 977 entries, 720 with non-empty definitions (257 empty),
  238 KB total, avg definition ~171 chars.
- Stack: Express 5 + Nunjucks, server-rendered. htmx is already vendored
  (`public/vendor/htmx.min.js`) and used for search. CSS token system in
  `public/css/`. Data is loaded through `src/data/loader.js` `loadJson()` with
  an in-process cache.

### What is missing

1. A loader for keyword **definitions** (nothing reads `keywords.json` yet).
2. Gating: `renderGameText` currently emits an interactive span for *every*
   token, including the 257 keywords with empty definitions — those would be
   dead hovers.
3. Gem **tags** discard the keyword id (`gemTags.js` `tagDisplay` strips the
   bracket markup down to the display name), so type-line tag chips can't be
   tooltip-enabled.
4. The tooltip UI: delivery of definition text to the browser, and the popover
   itself (positioning, delay, interactive hover-into, accessibility).

## Architecture decisions (settled)

- **Delivery: lazy fetch.** Hovering a keyword fetches its rendered definition
  from a server endpoint on first hover; the result is cached client-side and
  by HTTP. This is exactly how poe2db works (`data-hover` triggers a lazy
  lookup) and fits the existing htmx-on-hover stack. Pages stay small; the 257
  empty keywords never cost anything.
- **Popover: Tippy.js (vendored).** The same library poe2db uses (the
  `aria-describedby="tippy-XX"` attribute is Tippy's signature). It provides
  positioning/flip/shift, show-delay, arrow, keyboard + ARIA accessibility,
  mobile tap, and — critically — `interactive: true` plus `delegate()`, which
  solve the fiddly hover-bridge between trigger and popover and auto-bind
  dynamically inserted nested `.kw` spans. Vendored as
  `public/vendor/tippy.umd.min.js` (Popper bundled), matching the existing
  `htmx.min.js` pattern.

## Components

### 1. `src/data/keywordDefs.js` (new)

Loads `repoe-poe2/keywords.json` via `loadJson`.

- `hasDefinition(key)` → `boolean`. True only when the entry exists **and** its
  `definition` is a non-empty (trimmed) string. Gates out the 257 empty
  entries so they never become interactive.
- `getDefinition(key)` → `{ term, definition }` or `null`. `null` for missing
  keys and for empty-definition keys (same predicate as `hasDefinition`). When
  `term` is empty, callers fall back to the key for display.

### 2. `renderGameText` gating (`src/data/keywords.js`, modified)

Add an optional injected predicate so the renderer stays pure and its existing
unit tests are unaffected:

```js
export function renderGameText(text, hasDefinition = () => true) { ... }
```

- When `hasDefinition(id)` is true → emit `<span class="kw" data-keyword="id">…`
  as today.
- When false → emit the display text as plain (escaped) text, no span, no
  underline, no hover.
- Default `() => true` preserves current behaviour and keeps the three existing
  `keywords.test.js` assertions green.

Real call sites (`src/data/gems.js`) pass `keywordDefs.hasDefinition`.

### 3. Gem tag tooltip support (`src/data/gemTags.js` + `src/data/gems.js`, modified)

`gem_tags.json` maps a tag id to `"[Display]"`, `"[Id|Display]"`, or `null`.
The keyword id is the **bracket key** (`[AoESkill|AoE]` → id `AoESkill`), which
differs from the tag id (`area`).

- Add a function that yields, per displayable tag, both the keyword id and the
  display name (e.g. return the raw `[Key|Display]` token, or a
  `{ id, display }` pair). Keep the existing display-name + `exclude` filtering
  behaviour.
- In the gem view-model, render tag chips through `renderGameText` (with the
  `hasDefinition` predicate) just like stat lines, so chips backed by a real
  keyword definition become hoverable and the rest render as plain text.
- The type line gets the same treatment when it maps to a keyword id with a
  definition; otherwise it renders as plain text.

### 4. `GET /api/keyword/:key` endpoint (new route)

- Look up via `getDefinition(key)`.
- Miss / empty definition → `404` (Tippy then shows no tooltip for it; in
  practice gated spans mean this is rare).
- Hit → `200` HTML fragment: `<strong>{term || key}</strong>` followed by the
  definition passed through `renderGameText(definition, hasDefinition)` so
  nested `[Key|Display]` references become their own `.kw` spans (enabling
  hover-into recursion). Wrap in a small container element for theming.
- `Cache-Control: public, max-age=…` (long-lived; data only changes on
  re-scrape). Content-Type `text/html`.
- Registered alongside the existing routes (`src/routes/`); wired in
  `src/server.js` next to the search route.

### 5. Client glue (`public/js/keywords.js`, new) + Tippy vendor

- Vendor `tippy.umd.min.js` into `public/vendor/`.
- Initialise **one delegated** Tippy bound to a stable container (e.g. `body`
  or `main`), `target: '.kw'`, `interactive: true`, a small `delay` on show,
  arrow, dark theme. Delegation means dynamically inserted `.kw` spans inside
  tooltip content are handled with no re-binding.
- `onShow` (or a content callback): read `data-keyword`, look it up in an
  in-memory `Map` cache; on miss `fetch('/api/keyword/' + encodeURIComponent(key))`,
  store the HTML (or a not-found marker), and set it as tooltip content. A
  `404` resolves to "no tooltip" for that key.
- Load `tippy.umd.min.js` then `keywords.js` in `base.njk` (alongside the
  existing htmx script tag).

### 6. Styling (`public/css/app.css`, modified; tokens reused)

- `.kw` — accent color, dotted underline, `cursor: help`. Optional
  `.kw--tag` modifier if tag chips need a distinct treatment from inline
  keywords.
- Dark Tippy theme matching the site's existing CSS tokens (background, border,
  text, padding); style nested `.kw` inside tooltips consistently.

## Data flow

```
page render: gem stat/desc/tag text
   → renderGameText(text, keywordDefs.hasDefinition)
   → <span class="kw" data-keyword="Overkill">Overkill</span>   (only if defined)

browser hover on .kw
   → delegated Tippy onShow
   → cache miss → GET /api/keyword/Overkill
   → server: getDefinition('Overkill')
            → renderGameText(definition, hasDefinition)
            → "<strong>Overkill</strong> …<span class='kw' data-keyword='Ignite'>Ignite</span>…"
   → injected as tooltip content; cached in Map
   → user moves into tooltip, hovers nested .kw → same path (recursion)
```

## Error handling

- Missing/empty keyword → endpoint `404` → no tooltip. Gating means most such
  spans are never emitted in the first place.
- Fetch failure (network/5xx) → no tooltip shown; logged to console; does not
  break the page. Negative result may be cached briefly to avoid hammering.
- Unknown `:key` is escaped/encoded; the loader only ever returns data from the
  static JSON (no user-controlled path access).

## Testing

- **`keywordDefs`**: `hasDefinition` true for a known non-empty key, false for a
  known empty-definition key and for a missing key; `getDefinition` returns
  `{ term, definition }` for a hit and `null` for empty/missing.
- **`renderGameText` gating**: with a predicate that returns false for a given
  id, that token renders as plain escaped text (no span); with true it renders
  the span. Existing default-predicate tests stay unchanged.
- **Gem tag id preservation**: a tag whose `gem_tags.json` value is
  `[AoESkill|AoE]` yields keyword id `AoESkill` and display `AoE`; `null`/
  display-less tags are dropped as before; `exclude` filtering still works.
- **Endpoint** (supertest): known key → `200` fragment containing
  `<strong>` and a nested `.kw` span when the definition has cross-references;
  unknown key → `404`; empty-definition key → `404`; response carries a
  `Cache-Control` header.

## Out of scope (YAGNI)

- Dedicated keyword/glossary pages and clickable keyword navigation
  (`<a href>`). Tooltip-only for now; markup is forward-compatible.
- Tooltips on text outside the existing `renderGameText` surfaces (item mods,
  passive nodes, etc.) — they will get tooltips automatically once their text
  routes through `renderGameText`, but wiring those surfaces is separate work.
- Pre-bundling/embedding all definitions; full-text search over definitions.
