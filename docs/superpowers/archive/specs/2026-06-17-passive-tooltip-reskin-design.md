# Passive Tooltip Re-skin — Design

**Date:** 2026-06-17
**Status:** Approved

## Goal

Bring the passive (keystone / notable) detail card up to date with the gem and
unique tooltip design. Today passives render as a plain flat dark rounded box
(`.passive-detail-card`) that does not share the in-game `.newItemPopup` tooltip
language used by gems and uniques, and — because it lives outside `.gem-detail` —
it is not affected by the S/M/L/XL UI size scaler.

After this work, passive detail pages render in the `.newItemPopup` family
(glow border, smallcaps header, `.Stats` / `.separator` / `.FlavourText`
structure), honor the size scaler, and visually distinguish keystones from
notables via accent color.

Passives have **no banner background image** for their header (unlike gems,
which use `GemHoverTitle.dds`). The header is a flat colored bar.

## Decisions

- **Header layout:** Flat header bar, node icon left-anchored, name beside it —
  closest to the gem card so passives read as part of the same family. No `.dds`
  banner background.
- **Color theme:** Differentiate keystone vs notable. Keystone = blue/violet
  (build-defining weight); notable = warm gold/amber. Both driven by new tokens
  and adjustable.
- **Scaler:** Reuse the existing `.gem-detail` zoom rules — no new scaler code.

## Scope

**In scope:** the `passiveDetail` macro (used by `keystone.njk` and
`notable.njk` detail pages), its view model, page wrappers, and CSS.

**Out of scope:** `passiveNodeCard` browse-grid tiles (keystones list,
ascendancy notables grid), the ascendancy grid, and any new hover-preview /
tippy `/card` route. No passive hover-card route exists today and none is added.

## Changes

### 1. Template — `passiveDetail` macro (`views/macros/passive.njk`)

Rebuild the macro to emit `.newItemPopup` chrome with a kind modifier:

```
.newItemPopup.PassivePopup.is-keystone | .is-notable
  └ .itemHeader.doubleLine.passiveHeader      (flat bg, NO .dds banner)
      ├ .leadPassiveIcon                        node icon, left-anchored
      ├ .itemName        → node.name
      └ .itemName.typeLine → "Keystone" / "Notable Passive"
  └ .content
      └ .Stats   → statLines rendered as .explicitMod   [if statLines.length]
      └ .Stats   → reminderText rendered muted           [if reminderText.length]
      └ .separator + .FlavourText                        [if flavourText]
```

- Kind modifier class (`is-keystone` / `is-notable`) and the type label come
  from `node.kind`.
- `reminderText` is a per-line array already present on the view model but
  currently unrendered; render each line in a muted style below the stats as a
  small fidelity bump.
- Icon uses existing `onerror` hide pattern.

`passiveNodeCard` (the small browse-grid tile) in the same file is **unchanged**.

### 2. View model (`src/data/passiveTree.js`)

Add one field to `nodeRecord`:

```js
kind: p.is_keystone ? 'keystone' : 'notable',
```

`nodeRecord` is shared by `listKeystones`, `getKeystone`, `listNotables`,
`getNotable`, and the ascendancy notable lists — the field flows to every
consumer with no other edits. The template reads `node.kind` for the modifier
class and type label.

### 3. Pages — `views/keystone.njk`, `views/notable.njk`

Wrap the `passiveDetail(...)` call in `<div class="gem-detail">` (the element
the `data-card-size` zoom rules already target in `gem-card.css` / `app.css`)
instead of the current bare `.page--column` placement. The scaler then applies
with zero new CSS.

### 4. Styles — `public/css/tokens.css`, `public/css/gem-card.css`

**tokens.css** — new accent tokens:
- `--color-keystone` (blue/violet) and a matching glow rgba.
- `--color-notable` (warm gold/amber) and a matching glow rgba.

**gem-card.css**:
- `.PassivePopup.is-keystone` / `.PassivePopup.is-notable` set `--card-border`,
  `--card-glow`, and a `--passive-name-color`, reusing the exact glow-border
  machinery gems/uniques already use via the base `.newItemPopup` rule.
- `.passiveHeader`: flat dark gradient bar (~54px tall), no banner image;
  overrides the `.itemHeader.doubleLine` background. Name lines left-padded to
  clear the icon.
- `.leadPassiveIcon`: left-anchored icon, mirroring `.leadSkillIcon` geometry.
- `.itemName` in a passive header uses `--passive-name-color`.
- Remove the now-dead rules: `.passive-detail-card`, `.passive-detail-icon`,
  `.passive-detail-name`, `.passive-detail-stats`, `.passive-detail-flavour`.
  The shared dark-shell rule block also covers `.passive-node-card` and
  `.asc-card`; keep those selectors — only drop the `.passive-detail-*`
  selectors/standalone rules.

## Verification

- Keystone detail page (e.g. Resolute Technique) renders as a `.newItemPopup`
  with blue/violet border + glow, flat header with left icon, name + "Keystone"
  type line, stat lines, reminder/flavour text.
- Notable detail page renders the same chrome with gold/amber accent and
  "Notable Passive" type line.
- Switching UI size (S/M/L/XL) scales the passive card, matching gem/unique
  behavior.
- `passiveNodeCard` browse tiles (keystones list, ascendancy grid) are visually
  unchanged.
- No leftover references to the removed `.passive-detail-*` classes.
