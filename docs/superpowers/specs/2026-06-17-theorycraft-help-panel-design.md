# Theory Crafting — Search Help Panel

**Date:** 2026-06-17
**Status:** Approved design, pending implementation plan
**Builds on:** `2026-06-16-theorycraft-search-design.md` (the `/theorycraft` page and its query language).

## Problem

The `/theorycraft` page works, but it's not discoverable: a single one-line hint
under the search box doesn't convey the full query language. Users can't tell which
fields exist (`type/color/tag/req/grants`), which values are valid, or how to combine
terms. They need a complete, browsable reference right where they search.

## Goal

A collapsible help section directly under the search bar listing every term type with
several usage examples each. Examples are clickable — clicking one runs that search
immediately, turning the reference into a hands-on tutorial.

## Non-Goals

- No exhaustive enumeration of open-ended field values (every tag, every granted skill).
  `tag:` and `grants:` show curated examples plus a "any value works" note.
- No search-syntax changes. This is presentation only; the parser/matcher are untouched.
- No JS framework. Native `<details>` + a tiny vanilla click handler.

## Mechanism & Placement

- Replace the current one-line `.tc-hint` paragraph in `views/theorycraft.njk` with:
  - A short always-visible lead line (e.g. "Type any words to match anything; combine
    terms to narrow — all terms must match.").
  - A native `<details class="tc-help">` element, **collapsed by default**, with
    `<summary>How to search — terms & examples</summary>`.
- Native `<details>` gives keyboard accessibility and zero-JS collapse for free.

## Content

A definition list (`<dl class="tc-help-terms">`) inside the panel, one `<dt>`/`<dd>`
row per term type. Each `<dd>` has a short description and a row of clickable example
chips. Closed-set fields list **every** value; open-ended fields list curated examples
plus an "any … works" note.

| Term | Description text | Values listed | Example chips (`data-q`) |
|------|------------------|---------------|--------------------------|
| Free text | Matches names, stats, tags — anything. | — | `onslaught`, `chaos`, `life regeneration` |
| `type:` | Limit to a content type. | gem, support, spirit, unique, affix, keystone, notable, base | `type:support`, `type:unique`, `type:keystone` |
| `color:` | Gem colour (word or letter). | red, green, blue, white (r/g/b/w) | `color:green`, `color:red` |
| `req:` | Attribute requirement. | str, dex, int | `req:int`, `req:str` |
| `tag:` | A gem/item tag — any tag works. | examples: fire, cold, lightning, attack, spell, area, projectile, melee, minion | `tag:fire`, `tag:attack` |
| `grants:` | A skill granted by the item/gem — any skill name works. | — | `grants:onslaught` |
| `-` exclude | Prefix a term with `-` to exclude it. | — | `-type:unique`, `chaos -type:affix` |
| `"quoted phrase"` | Match an exact multi-word phrase. | — | `"cast speed"`, `"spirit reservation"` |
| Combine (AND) | List several terms; all must match. | — | `type:support cold`, `color:green tag:attack`, `req:int spirit` |

Each chip is `<button type="button" class="tc-example" data-q="…">…</button>`. The chip
label is the literal query string it inserts.

## Click Behavior

New page-scoped script `public/js/theorycraft.js`, loaded `defer` from
`views/theorycraft.njk` (not from `base.njk` — it's page-specific). On a delegated click
of a `.tc-example` button:

1. Read `data-q`.
2. Set the search input's `value` to it.
3. Dispatch a bubbling `input` event so the existing htmx trigger
   (`input changed delay:200ms, search`) fires the search.
4. Collapse the `<details>` panel (`open = false`) so results are visible.
5. Focus the input (caret at end).

The handler needs only DOM APIs — no dependency on the htmx JS object.

## Styling

Append to `public/css/app.css`:

- `.tc-help summary` — pointer cursor, muted colour, clear "expand" affordance; reuses
  existing token vars (`--surface-2`, `--border`, `--color-default`, `--accent`).
- `.tc-help-terms` — `<dt>` monospace/bold term, `<dd>` description + chip row.
- `.tc-example` — small monospace chip button: subtle background, border, hover accent;
  consistent with the existing `.tc-input`/`code` styling.

## Error Handling & Edges

- Pure presentation — nothing throws. If JS is disabled, the panel still expands/collapses
  (native `<details>`) and the chips simply do nothing when clicked (graceful no-op);
  users can still read and type the examples.
- Setting the input value programmatically then dispatching `input` reuses the exact same
  search path as typing, so there's no separate code path to keep in sync.

## Testing

- Render test in `test/theorycraft.test.js` against `GET /theorycraft`:
  - `tc-help` panel and `<summary>` present.
  - Every term label present: `type:`, `color:`, `req:`, `tag:`, `grants:`, the exclude
    and quoted-phrase rows, and the combine row.
  - Closed-set values present (e.g. `keystone`, `notable` for type; `green` for color;
    `int` for req).
  - At least one `.tc-example` button with a `data-q` attribute is rendered.
  - The `theorycraft.js` script tag is referenced on the page.
- Click-to-run behavior is verified in the end-to-end smoke test (node:test has no DOM):
  load `/theorycraft`, confirm the script loads; manual click check that a chip fills the
  box and results update.

## Reference

- Page/template/partial: `views/theorycraft.njk`, `views/partials/theorycraft-results.njk`.
- Query language and fields: `src/data/theorycraft.js`, `2026-06-16-theorycraft-search-design.md`.
- htmx trigger on the input: `input changed delay:200ms, search` (existing).
