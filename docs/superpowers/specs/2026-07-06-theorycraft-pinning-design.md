# Phase 6 — Theorycraft Pinning (TODO #3 + rest of TODO #4)

Part of the Build Planner roadmap (`2026-07-06-build-planner-roadmap.md`). Depends on Phase 4 (reuses the Add-to-Build popover for promotion).

## Purpose

TODO #3: pin items across theorycraft searches. Per owner direction, pins are **deliberately distinct from builds**: pinning is *ephemeral* ("ideas to build upon"), builds are *durable* ("capture for reference/sharing"). This phase also finishes TODO #4 by adding the "pin" (add-to-theorycraft) icon alongside the trade and add-to-build icons on cards site-wide.

## Design

### Pin board

- A single scratch pad (not named/multiple — that's what builds are for), stored under its own key `reveal.tcpins.v1` as `[ { kind, slug } ]` (browse-card key space, same item-ref contract as builds). Managed by a small `pin-store.js` module (or a thin extension of `build-store.js`'s storage core — decide at plan time; separate key regardless).
- Renders on `/theorycraft` as a sticky strip/panel above the results: pinned items as compact cards (icon + name, `data-card-url` hover for the full card), each with an unpin control, plus "clear all".
- Pins survive query changes and page reloads (localStorage, origin-wide). They are *not* included in build share codes.

### Pinning affordances

- Pin icon on theorycraft result cards (both server-rendered partial and `theorycraft-client.js` rendering — change once in the shared pieces where possible).
- Site-wide: third icon in `views/macros/card-actions.njk` (the trade-link / add-to-build pattern): `data-pin-kind`/`data-pin-slug` + delegated handler. Pinning from a gem page adds to the board you'll see next time you visit /theorycraft; the toast links there.

### Promotion to build

- Pin board bulk action: select pins (or "all") → the Phase-4 Add-to-Build popover → items append to the chosen build's `unassigned` bucket. Pins remain until explicitly cleared (promotion copies, doesn't move — cheap to change later if it feels wrong).

## Testing & acceptance

- [x] Pin from a theorycraft result, change queries, reload — pin persists; unpin and clear-all work. *(pin board, 4c41e00)*
- [x] Pin from a non-theorycraft page (e.g. a unique card) appears on the board. *(site-wide `card-actions.njk` pin + `add-to-pins.js`, 2026-07-23; verified end-to-end on the static build via `scripts/verify-sitewide-pin.mjs`)*
- [x] Promote pins to a build; they land in `unassigned` and open correctly in the editor. *(promote handler, 0d51c60/b66ce2d)*
- [x] Works on the static build; `npm test` green (646); TODO.md items 3 and 4 marked done.
