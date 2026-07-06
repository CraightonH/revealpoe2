# Phase 5 — Passive Tree Embed + Notable Priority

Part of the Build Planner roadmap (`2026-07-06-build-planner-roadmap.md`). Depends on Phase 1 (schema); lands in the Phase 4 editor but can be developed in parallel against a bare host page. **Read `docs/passive-tree.md` before touching anything here** (project rule).

## Purpose

Two things:

1. Make the interactive passive tree an **embeddable component** so the build editor gets the full /passives experience (allocate, budgets, weapon sets, search, pathing, stats panel) inside the tree section — not a static image or an iframe.
2. **Notable Priority** (per owner directive, modeled on Mobalytics' planner): an ordered list of the build's notables/keystones beneath the tree, communicating order-of-operations without numbering every point. Hovering a row highlights that node in the embedded tree; the order feeds Phase 8's `.build` export ("allocate next" sequence).

## Part 1 — embeddable tree component

Architecture findings (from code survey; verify at plan time): all tree state is already closure-local to `init(canvas)` in `public/js/passive-tree.js`, the canvas is sized container-relatively via ResizeObserver, and a minimal API object is already returned. The page-chrome couplings to remove are: ~20 `document.getElementById` lookups for control elements, `location.hash` read on boot / write on Copy, clipboard/`window.confirm`/fullscreen assumptions.

Refactor (additive, not a rewrite):

- `init(root, opts)` — scope all element lookups to `root.querySelector(...)`. The control-panel markup moves into a shared Nunjucks partial (`views/partials/tree-panel.njk`) so /passives and the build editor render identical controls without id collisions (ids → classes or per-instance ids).
- **Hash I/O becomes host-owned:** `opts.initialCode` replaces the boot-time `location.hash` read; code changes emit through `opts.onCodeChange(code)` (fired on allocation changes, debounced) instead of writing `location.hash`. The Copy button behavior becomes `opts.onCopy` with a default.
- Extend the returned API: `getState()` / `setState()` (the fields `importFromHash`/`synthesizeState` already marshal), `setHighlight(hashes)` (wraps the existing `hoverHits` + `requestDraw` layer — the mechanism already exists for the stats-panel hover), `focusNode(hash)` (center/zoom the view on a node), `getAllocatedNotables()` (ordered by hash; names/icons resolved by the host from tree artifacts), and a change event (allocation, class, ascendancy).
- **/passives becomes a thin host** wiring the component back to `location.hash`, clipboard, fullscreen — zero user-visible change; existing tests keep passing. This is the regression-risk center of the phase: verify the /passives page end-to-end (share-code round trip, class switch, weapon sets) before touching the editor.

## Part 2 — build-editor integration

- The editor's tree section renders the shared partial + component with `initialCode: build.tree.code`; `onCodeChange` auto-saves to the build (via `build-store.js`, debounced). "Open full page" link → `/passives#<code>`.
- Points summary (main/set1/set2 spent, like the Mobalytics header chips) comes from the component's state — render above the embed.

## Part 3 — Notable Priority

- Section beneath the embedded tree, heading "Notable Priority".
- **Content:** the allocated notables + keystones (hashes from `getAllocatedNotables()`), rendered as ordered rows: drag handle, node icon (passive-atlas sprites — same assets the tree draws), name, remove-from-priority control. `build.tree.notablePriority` stores the order; nodes newly allocated append to the end; nodes deallocated drop out of the list (reconcile on every tree change).
- **Hover a row → `setHighlight([hash])`** on the embed (clear on leave). **Click → `focusNode(hash)`.**
- Reordering is drag-and-drop (HTML5 DnD is sufficient; no library).
- The list is *advisory ordering*, not allocation state — reordering never mutates the tree.

## Testing & acceptance

- [ ] /passives unchanged for users: share-code import/export round-trips byte-identical (existing golden fixtures), all controls work; existing node tests green.
- [ ] Two independent component instances on one scratch page don't collide (the id-scoping proof).
- [ ] Editor: allocate nodes → build auto-saves code + priority list; reload restores both.
- [ ] Hover-highlight and click-focus work in the embed; drag-reorder persists.
- [ ] `npm run build:static` passes; embed works on the static site (artifacts already crawled for /passives — confirm the /builds shell also reaches them).
