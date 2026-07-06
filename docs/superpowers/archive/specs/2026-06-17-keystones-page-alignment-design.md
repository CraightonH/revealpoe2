# /keystones Page Alignment — Design

**Date:** 2026-06-17
**Status:** Approved

## Goal

Bring the `/keystones` browse page into visual and behavioral alignment with the
`/gems` and `/uniques` browse pages. Today `/keystones` is the odd one out: its
tiles are tall vertical cards (icon-over-name) that dump every stat line inline,
on a darker surface (`card-dark-bg`), with no header accent color and no hover
preview. `/gems` and `/uniques` both use compact icon + name rows on
`bg-surface`, and `/uniques` shows a hover-card tooltip preview.

Keystones are a flat alphabetical set (33 items, no type sections, no filter
facets), so `/uniques` — a flat grid that browses to a detail page with a hover
preview — is the sibling to match (not `/gems`, which adds sections + a filter
bar).

## Decisions

- **Card shape:** compact horizontal row (icon left + name), mirroring the
  inlined `.unique-index-card` markup in `uniques.njk`, on `bg-surface`. The
  verbose inline stat lines are dropped from the browse tile (they live on the
  detail page and now in the hover preview).
- **Header accent:** the page header uses `--color-keystone` (blue/violet, the
  same accent introduced for the passive detail tooltip); the card hover border
  uses the same color.
- **Hover preview:** add a `/keystone/:id/card` fragment route + partial so
  hovering a keystone tile shows the passive tooltip popup, exactly like
  `/uniques`. The hover glue (`card-tooltip.js` → `[data-card-url]`) is already
  generic; only the route, partial, and the `data-card-url` attribute are new.

## Scope

**In scope:** the `/keystones` page (`keystones.njk`), a new keystone card-
fragment route + partial, and the keystone index-card CSS.

**Out of scope:** the ascendancy page, which also renders `passiveNodeCard`
(intentionally, with stat lines) — left untouched. The `passiveNodeCard` macro
and all `.passive-node-*` CSS stay as-is (still used by ascendancy). The
`passiveDetail` macro and passive tooltip are unchanged (reused by the new
fragment).

## Changes

### 1. Keystone card fragment route — `src/routes/pages.js`

Register one line beside the existing keystone detail route, using the existing
`cardRoute` helper and `getKeystone` builder:

```js
cardRoute(app, '/keystone/:id/card', getKeystone, 'partials/passive-card-fragment.njk');
```

`cardRoute` renders the fragment with `{ vm: result }` and 404s with an empty
body for unknown ids — same as gem/unique fragments.

### 2. Fragment partial — `views/partials/passive-card-fragment.njk` (new)

Mirror `unique-card-fragment.njk` / `gem-card-fragment.njk`:

```njk
{% from "macros/passive.njk" import passiveDetail %}
{{ passiveDetail(vm) }}
```

(`passiveDetail` takes the node as its argument; `cardRoute` passes it as `vm`.)

### 3. Keystones page — `views/keystones.njk`

- Pass the `--color-keystone` accent to `pageHeader`.
- Replace the `passive-node-grid` + `passiveNodeCard` loop with a compact
  index-card grid mirroring `uniques.njk`: an `<a class="keystone-index-card">`
  per keystone with `href="/keystone/{{ k.id }}"` and
  `data-card-url="/keystone/{{ k.id }}/card"`, containing the icon (or a
  placeholder) and the name. No stat lines.
- Drop the now-unused `passiveNodeCard` import from this template.

### 4. CSS — `public/css/gem-card.css`

Mirror the `.unique-index-*` rules with keystone coloring (the codebase pattern
is a shared base rule + per-type variant):

- Add `.keystone-index-grid` to the shared 200px-column grid selector list and
  group it with `.unique-index-grid` for `gap: 8px`.
- Add `.keystone-index-card` to the shared flat-surface base rule
  (`display:flex; background:var(--bg-surface); border:1px solid var(--border);
  text-decoration:none`).
- Add the keystone-specific card rule (align-items, gap, padding, border-radius,
  `color: var(--color-keystone)`, smallcaps font, transition), a
  `:hover { border-color: var(--color-keystone) }` rule, plus
  `.keystone-index-icon`, `.keystone-index-name`, and
  `.keystone-index-placeholder` mirroring the unique equivalents.

## Verification

- `/keystones` renders compact icon + name rows on `bg-surface`, blue/violet
  header accent, in a flat grid — visually consistent with `/uniques`.
- Hovering a keystone tile shows the passive tooltip popup (the same
  `.newItemPopup` card as the detail page), like `/uniques`.
- `GET /keystone/:id/card` returns the passive card fragment HTML (200), and a
  bogus id returns 404 with empty body.
- The ascendancy page and its `passiveNodeCard` tiles (with stat lines) are
  unchanged.
- No leftover `passive-node-*` usage on the keystones page; those CSS rules
  remain for the ascendancy page.
