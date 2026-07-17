# sample.html — reskin base notes

Self-contained snapshot of representative Reveal (poe2wiki) UI, built from the
live Express app (`PORT=4173 node src/index.js`). Common base for three
visual-redesign mockups. **No JS, no external requests** — safe for an offline
sandboxed viewer.

## File

- `sample.html` — 930 KB (0.89 MB), well under the ~6 MB ceiling.
- `<img>` tags: 9 total, **0 without a `data:` src**.
- `<script>` tags: **0** (all stripped).

## What's in it (in document order)

1. **Site header** (`.site-header`) — Reveal brand lock/sigil (inline SVG),
   search box (`.search-box` with `<input type=search>`), card-size toggle
   (`.card-size` S/M/L/XL).
2. **Primary nav** (`.site-nav`) — Gems / Items / Passive Tree / Theory Crafting,
   with dropdown markup.
3. **Page title block** — `<h1 class="page-title">Skill Gems</h1>` +
   `.page-subtitle` count.
4. **Filter bar** (`.filter-bar`) — three `.filter-group`s (Type / Origin /
   Requires) of `.filter-btn`s; one carries `.is-active`.
5. **"Active Skills (390)"** section header (`.gem-list-heading--active`) + a
   `.gem-browse-grid` of **6 real gem cards**: Alchemist's Boon, Arc, Archmage,
   Arctic Armour, Armour Breaker, Artillery Ballista (mix of short/long bodies).
6. **"Unique tooltip sample"** — the `/unique/ab-aeterno/card` fragment
   (`.newItemPopup.UniquePopup`, equipment layout with external `.itemboximage`
   art + PoE-trade link SVG).
7. **"Base item sample"** — the `/base/wooden-club/card` fragment.
8. **Footer** (`.site-footer`) — GGG disclaimer + credits link.

## Inlined vs missing

- **CSS** inlined verbatim in load order via `<style>` blocks:
  `fonts.css` → `tokens.css` → `app.css` → `gem-card.css`.
  Root element carries `data-theme="dark"`.
- **Fonts** — all 3 embedded as base64 `data:` URIs (none exceeded 400 KB):
  fontin-smallcaps (29 KB), fontin-regular (31 KB), OptimusPrincepsSemiBold
  (56 KB). None skipped.
- **`<img>` icons** — all 9 (6 gem icons + unique item art + 2 base weapon art)
  embedded as `data:image/webp;base64`. **None missing** — no placeholder divs
  were needed.
- **CSS `url(/static/img/...)` refs** — all resolved on disk and inlined as
  `data:` URIs, including the load-bearing header art:
  `GemHoverTitle.webp` (gem card header banner),
  `ItemsHeaderUnique*` / `ItemsHeaderWhite*` / `ItemsHeaderCurrency*`
  (item popup header slices), passive-header slices, and `mod-decorator-abyss`.
  **None missing.**
- Dropped: `vendor/tippy.css` (tooltip lib, JS-driven — irrelevant to static
  visuals) and the favicon/manifest `<link>`s (replaced with a self-authored
  `<head>`).

## Key CSS hooks a restyler will care about

- Layout / chrome: `.site-header`, `.brand` / `.brand-lock` / `.brand-sigil`,
  `.search-box`, `.card-size`, `.site-nav` / `.site-nav__list` /
  `.site-nav__dropdown`, `.page.page--column`, `.page-title`, `.page-subtitle`,
  `.site-footer`.
- Filters: `.filter-bar`, `.filter-group`, `.filter-label`, `.filter-btn`
  (+ `.is-active`, color variants `.filter-btn--r/--g/--b`).
- Gem browse cards: `.gem-list-section`, `.gem-list-heading`
  (`--active/--spirit/--support` modifiers), `.gem-browse-grid`,
  `.gem-browse-card` (+ color class `--w`/`--g`/... = gem color),
  `.gem-browse-header`, `.gem-browse-name`, `.gem-browse-main`,
  `.gem-browse-icon`, `.gem-browse-body`, `.gem-browse-tags`,
  `.gem-browse-req`, `.gem-browse-effect`, `.explicitMod`, `.mod-value`,
  `.separator`, `.kw` (keyword chips).
- Item tooltips (poe2db-imitation): `.unique-item-with-art`, `.itemboximage`,
  `.newItemPopup` (+ `.UniquePopup`, `.item-popup--poe2`, CSS vars
  `--card-border` / `--card-glow`), `.itemHeader.doubleLine`, `.itemName`,
  `.typeLine`, `.content`, `.Stats`, `.property`, `.implicitMod`,
  `.explicitMod`, `.separator`, `.FlavourText`, `.card-actions` / `.trade-link`.
- Theming tokens live in `tokens.css` (`:root` custom props, e.g.
  `--color-gem`); `app.css` reads them.

## Regenerating

`node assemble.js` (in this dir) rebuilds `sample.html` from the captured page
dumps (`gems.html`, `unique-card.html`, `base-card.html`) + repo CSS/fonts/img.
Server no longer running.
