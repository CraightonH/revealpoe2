# Passive Pages Consolidation + Theorycraft Tooltip Upgrade

**Date:** 2026-07-13
**Status:** Approved (design)

## Problem

The passive-data experience is split across two generations of implementation:

1. **First generation** — standalone browse pages built before the graph/tree existed:
   `/keystones` (keystone grid), `/ascendancies` (ascendancy grid), `/ascendancy/:id`
   (per-ascendancy notable list). These duplicate data that the interactive passive
   tree now renders in full.
2. **Current generation** — the interactive passive tree (`/passives`), which renders
   *all* passive content (keystones, notables, small nodes, every ascendancy with its
   notables and smalls) entirely from prebuilt static artifacts
   (`passive-tree.json`, `passive-stats.json`, `passive-cards.json`,
   `passive-search.json`). It is fully self-contained and depends on none of the
   standalone pages, including for its hover cards.

The graph DB is already the source of truth for keystone/notable data — search
(`src/data/search.js`), theorycraft (`src/data/theorycraft.js`), and the static
client index (`scripts/build-index.js`) all read them from the graph via
`src/data/passiveTree.js` (`nodesByKind('passive')`). That migration landed in commit
`451b482`. So there is no data-layer work here — this is a **UI consolidation**.

Two goals:

- **Deprecate the old browse pages** in favor of the interactive tree.
- **Upgrade theorycraft passive results** from the compact browse card to the exact
  in-game tooltip (`passiveDetail`), matching what a searched passive looks like on
  hover elsewhere on the site.

## Key architectural facts (verified)

- The interactive tree is **untouched** by this work. It renders from its own static
  artifacts and its hover cards come from `passive-cards.json`, **not** the
  `/passive/:id/card` server endpoint.
- Two distinct layers of standalone pages, with different fates:
  - **Browse/overview pages** — `/keystones`, `/ascendancies`, `/ascendancy/:id`.
    Redundant with the tree. **Remove.**
  - **Per-node detail pages + hover-card fragments** — `/keystone/:id`, `/notable/:id`,
    `/passive/:id` and their `/card` variants. **Keep** — load-bearing for the search
    dropdown (row `href` + hover `data-card-url`) and theorycraft.
- The prerender crawler (`scripts/prerender.js`) only follows URLs in
  `href` / `hx-get` / `data-card-url` / `data-keyword` attributes. The tree emits no
  such links, so the standalone pages are reachable to the crawler **only** through
  other HTML. Removal safety therefore hinges on what still links each URL:
  - Keystone/notable detail pages + cards: reachable via the **search dropdown**
    (`search-results.njk` rows) regardless of theorycraft. Not orphaned.
  - Ascendancy overview pages: reachable **only** via `/ascendancies` + the
    `passive-node.njk` breadcrumb. Once those go, they orphan — which is intended,
    because the tree covers that content.
- `passiveBrowseCard` (the compact card macro) is **not** dead after this change —
  `views/macros/granted-by.njk` still uses it (the "passives that grant this skill"
  list on gem pages). It stays.
- `ASC_COLORS` / `getPassiveNode` in `passiveTree.js` stay — `/passive/:id` survives
  and still themes ascendancy-notable pages (reachable via `granted-by`).

## Part 1 — Deprecate the old browse pages

### Remove

| File / location | Change |
|---|---|
| `views/base.njk` (nav) | Replace the `Passives` dropdown (Passive Tree / Keystones / Ascendancies) with a single top-level link `Passive Tree → /passives`, matching the existing `Theory Crafting` single-link pattern. |
| `src/routes/pages.js` | Delete the `/keystones`, `/ascendancies`, and `/ascendancy/:id` routes. Keep the `listKeystones`/`listNotables`/`getKeystone`/`getNotable`/`getPassiveNode` imports (still used by surviving routes); drop the now-unused `listAscendancies`/`getAscendancy` imports. |
| `views/keystones.njk` | Delete. |
| `views/ascendancies.njk` | Delete. |
| `views/ascendancy.njk` | Delete. |
| `views/passive-node.njk` | Remove the ascendancy breadcrumb entry (`{ label: node.ascendancyName, href: '/ascendancy/' + node.ascendancy }`). Leave the rest of the breadcrumb intact. |
| `views/home.njk` | Remove/repoint the `Browse Keystones →` (`/keystones`) and `Browse Ascendancies →` (`/ascendancies`) links so they don't 404 / break the crawler. Repoint to `/passives` or drop. |
| `src/data/passiveTree.js` | Remove now-dead `listAscendancies`, `getAscendancy`, `ascRecord`, `ascNotables`. Keep `ASC_COLORS`, `getPassiveNode`, `listKeystones`, `listNotables`, `getKeystone`, `getNotable`, `nodeRecord`. |

### Keep (explicitly)

- `/keystone/:id`, `/notable/:id`, `/passive/:id` + all `/card` routes.
- `passiveBrowseCard` and `passiveDetail` macros.
- The entire interactive tree and its artifacts/build.

### CSS cleanup (targeted, non-blocking)

- Ascendancy-grid / `asc-card` / `asc-notable` styles used only by the deleted
  templates become dead. Remove if cleanly isolated; leave if entangled with
  still-used selectors (flag rather than risk breaking the tree/theorycraft).

## Part 2 — Theorycraft passive results = exact in-game tooltip

Currently theorycraft renders keystone/notable results with `passiveBrowseCard`
(compact). Switch to `passiveDetail` (the full `.newItemPopup.PassivePopup` in-game
tooltip).

| File | Change |
|---|---|
| `views/partials/theorycraft-results.njk` | For `category in ['keystone','notable']`, render `passiveDetail(it.card)` instead of `passiveBrowseCard`. `passiveDetail` has no outer `<a>`, so wrap it in a link to the detail page (`/keystone/:id` or `/notable/:id`) for click-through + crawler discoverability. Change the group grid class for these categories away from the compact `keystone-index-grid` to a tooltip-sized layout. |
| `scripts/build-index.js` | Switch `renderKeystone`/`renderNotable` to compile `passiveDetail` (not `passiveBrowseCard`) so `browse-cards.json` — which backs the client-rendered static theorycraft — matches the server. |
| `public/js/theorycraft-client.js` | Verify parity: the client injects `browse-cards.json` HTML for results. Confirm it applies the same link wrapper for keystone/notable so client and server render identically. Adjust if the wrapper is added server-side only. |
| CSS | Add a results-grid rule sizing keystone/notable groups for full popups (analogous to how unique tooltips lay out), replacing the compact grid for these categories. |

### Data adequacy

The card objects theorycraft passes (`listKeystones()` / `listNotables()` →
`nodeRecord`) already carry everything `passiveDetail` reads: `name`, `statLines`,
`flavourText`, `reminderText`, `grantedSkill`, `kind`. Optional fields it also checks
(`attrOptions`, `instill`, `ascColor`, `typeLabel`, `ascendancyName`) are absent for
these non-ascendancy keystones/notables and degrade gracefully to the default
`Keystone` / `Notable Passive` type line. No graph or adapter changes required.

## Out of scope

- No changes to the graph build, `passiveTree.js` data resolution, or the interactive
  tree.
- No new source data or `data/manual` overlays.
- Repointing the search dropdown (it already links the surviving detail pages/cards
  correctly).

## Verification

- `npm test` green (routes for deleted pages should have their tests removed/updated).
- `npm run dev`: nav shows a single `Passive Tree` link; `/keystones`,
  `/ascendancies`, `/ascendancy/:id` 404; theorycraft keystone/notable results render
  as full in-game tooltips; home page has no dead passive links.
- **`npm run build:static`** (the static-only gate): the crawler must not fail on a
  dead internal link (confirms nothing still points at the removed pages), and
  keystone/notable detail pages + cards must still be built (reached via search).
  Confirm client-rendered theorycraft tooltips match the server via a preview/Node
  fetch, not `curl`.
