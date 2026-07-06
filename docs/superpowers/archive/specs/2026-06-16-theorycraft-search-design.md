# Theory Crafting — Cross-Content Query Page

**Date:** 2026-06-16
**Status:** Approved design, pending implementation plan

## Problem

The wiki currently has one search surface: a global header box that does a shallow
substring match (gems indexed by **name only**), capped at 20 results, rendered as a
quick-nav dropdown (`src/routes/search.js`, `src/data/search.js`).

Users want to search by *content concepts* — type `chaos` or `onslaught` and find
everything related, regardless of type. Those terms live in stat lines, tags, keywords,
and granted skills, not card names, so the current search can't find them.

An earlier idea (per-page search bars honoring each page's filters) was considered and
**dropped** in favor of a single dedicated page that searches all content. The inline
field-filter syntax (below) absorbs the "honoring filters" desire directly into the query.

## Goals

- A dedicated page that searches **all** content types deeply (gems, supports, spirit
  skills, uniques, affixes, keystones, notables, bases).
- A query language that is trivial for novices (just type a word) yet powerful for
  veterans (scoped field filters, exclusion, phrases).
- Reuse existing rendering patterns; no new framework, no external dependencies.

## Non-Goals (v1)

- No regex terms (`/.../`) or boolean `OR`/parens — reserved for a later version.
- No replacement of the existing header dropdown search — it stays as-is for quick nav.
- No per-page search bars.

## Route & Entry Point

- New page: **`GET /theorycraft`** — full page with a large query input.
- Results endpoint: **`GET /theorycraft/results?q=…`** — htmx target, returns the grouped
  results partial only.
- New top-level nav item **"Theory Crafting"** in `views/base.njk`.
- Existing `GET /search` (header dropdown) is untouched.

## Query Language (v1)

Hand-rolled tokenizer → matcher in plain JS, no dependencies. Tiers:

| Tier | Syntax | Example |
|------|--------|---------|
| Free text | bare words | `onslaught` |
| Field filter | `field:value` | `type:support` |
| Exclusion | `-term` / `-field:value` | `-type:unique`, `-chaos` |
| Phrase | `"two words"` | `"cast speed"` |

- **Implicit AND** between all terms.
- **Free-text term**: substring match against the doc's lowercased `text` blob.
- **Field filter**: value substring-matches the named structured field (so `tag:fire`
  matches `firestorm`).
- **Unknown field name** (e.g. `foo:bar`): degrade to a free-text term — never error.
- Matching is case-insensitive throughout.

### Fields

| Field | Source | Notes |
|-------|--------|-------|
| `type` | doc category | one of: `gem`, `support`, `spirit`, `unique`, `affix`, `keystone`, `notable`, `base` |
| `color` | gem card color | `r`/`g`/`b`/`w` (gems only) |
| `tag` | gem/item tags | multi-valued |
| `req` | attribute requirement | `str`/`dex`/`int`, multi-valued |
| `grants` | granted skills | gems that grant skills |

Worked examples:

- `onslaught` → any doc whose text mentions onslaught, across all categories.
- `type:support cold` → support gems related to cold.
- `color:green tag:attack` → green attack gems.
- `-type:unique chaos resistance` → chaos-resistance content that is not a unique.
- `"cast speed"` → exact phrase.
- `req:int spirit` → int-requiring spirit skills.

## Data Layer

A query doc is:

```
{ name, url, category, color?, tags: [], req: [], grants: [], text }
```

- `text` is a single lowercased blob: name + tags + stat/mod lines + keywords +
  granted-skill names + base/type line. This is what bare free-text terms match.
- Structured fields (`category`, `color`, `tags`, `req`, `grants`) back the `field:value`
  filters.

The enriched index is built from the richest available source per type (e.g. gem view
models for stat lines/tags/grants, mod groups for affix text, keystone/notable `statRaw`).

To keep the header dropdown lean and fast, the deep index lives in a **new module
`src/data/theorycraft.js`** rather than bloating `src/data/search.js`. Pure functions:

- `parseQuery(q)` → AST: `{ terms: [{ kind: 'text'|'field', field?, value, negate }] }`
- `runQuery(q, opts)` → `{ groups: [{ category, label, total, items: [...] }], total }`

Both are DOM-free and HTTP-free for direct unit testing. Index is lazily built and cached
(same pattern as the existing `docs()` memoization).

## Results UI

- Grouped sections in a fixed order: **Gems, Supports, Spirit, Uniques, Affixes,
  Keystones, Notables, Bases**. Empty groups are omitted.
- Each group shows its label + match count and reuses existing card/row markup
  (`gem-browse-card`, `unique-index-card`, `mods-list-row`, etc.) via shared macros where
  practical.
- Header line above results: total count + an echo of the parsed query (helps users learn
  the syntax).
- Below the input: a one-line syntax hint with a couple of example queries.

## Error Handling & Edge Cases

- **Empty query** → friendly prompt with example queries; no results, no request noise.
- **Unparseable / garbage** → degrade to free-text over the whole string; never 500.
- **No matches** → "No results for `…`" with a couple of suggestions.
- **Broad term** (e.g. `chaos`) → per-group cap (≈100 items) with a "showing N of M" note
  so the page never renders thousands of cards.

## Testing

- `parseQuery` units: free text, field, exclusion, quoted phrase, unknown-field fallback,
  multi-term AND, mixed.
- `runQuery` against fixture docs: `onslaught` matches across categories;
  `type:support cold`; `-type:unique`; phrase match; per-group cap.
- Render test: `GET /theorycraft/results?q=onslaught` returns grouped HTML with expected
  group headings.

## Reference

- Existing shallow search: `src/data/search.js`, `src/routes/search.js`.
- Filter-bar pattern (data attributes, AND/any matching): `public/js/filter-bar.js`,
  `views/macros/filter-bar.njk`.
- Card markup: `views/macros/gem-card.njk` (`gemSection`), `views/uniques.njk`,
  `views/mods.njk`, `views/macros/base-card.njk`.
- QL inspiration: GitHub/Linear `field:value` search idiom.
