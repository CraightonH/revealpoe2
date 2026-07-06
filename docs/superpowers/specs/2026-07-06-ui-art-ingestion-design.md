# Phase 3 — In-Game UI Art Ingestion

Part of the Build Planner roadmap (`2026-07-06-build-planner-roadmap.md`). Research spike + asset pipeline work; gates the visual fidelity of Phase 4.

## Purpose

The build editor must imitate two in-game screens (reference screenshots provided by the owner, described below):

1. **Skill Gems menu** — stacked skill-setup rows: collapse chevron, square gem icon, ornate name banner with level readout, then a row of circular support sockets (filled = support gem icon in ring; empty = dark ring). Panel has a carved-stone background and a "SKILL GEMS" title banner with statuary header art.
2. **Inventory screen** — the paper-doll: weapon panels left/right (with king/queen statue backdrops), helmet/body/gloves/boots/belt/amulet/rings arranged center, flasks and charms along the bottom, all framed slot wells on a dark stone background, "INVENTORY" title banner.

This phase finds and ingests the actual game UI textures so Phase 4 styles with real art, matching the established precedent: `GemHoverTitle.webp` and `ItemsHeader{White,Unique}{Left,Middle,Right}.webp` are already pulled from ggpk.exposed paths under `Art/Textures/Interface/2D/2DArt/UIImages/InGame/...` and referenced from CSS (`public/css/gem-card.css`, `app.css`). `scripts/fetch-images.js` already scans CSS for referenced assets — **a CSS `url()` reference is the ingestion trigger**; no fetcher changes are expected unless atlas cropping is needed.

## Spike: enumerate the asset gallery

Browse ggpk.exposed's directory listing (and cross-reference poe2db page CSS, which uses the same extracted assets) under plausible roots:

- `Art/Textures/Interface/2D/2DArt/UIImages/InGame/` (known-good root for existing assets)
- Look for: skill-panel row/banner/socket textures (names like `SkillGems*`, `SkillPanel*`, `Socket*`, `GemSocket*`), inventory chrome (`Inventory*`, `CharacterPanel*`, slot backgrounds/frames), shared panel chrome (title banners, stone background tiles, close button, collapse chevrons).
- Also check `Art/2DArt/` variants and the passive-atlas experience: some UI is shipped **atlas-packed** (one sheet + coordinate metadata) rather than as standalone textures.

**Deliverable: `docs/ui/ingame-art-inventory.md`** — a catalog table: asset path → what it is → which planned component uses it → standalone or atlas-packed → licensing note (same GGG-asset basis as all existing art, see NOTICES.md). Include the handful of candidate paths *tested and confirmed fetchable* through the existing pipeline.

## Ingestion

- Add the chosen assets as CSS references in a new `public/css/planner-art.css` (loaded only by planner pages; created in skeleton form this phase with class names + `url()` refs so `build:images` mirrors the files, fleshed out by Phase 4).
- If a needed texture is atlas-packed only: extend `scripts/fetch-images.js` with a minimal crop step (sharp is already a dependency; the passive-atlas pipeline is precedent) — **only if genuinely needed**; prefer standalone assets.
- Run `npm run build:images`; verify the new files land in `public/img/` and survive the two-tier gate (re-run is a no-op).

## Fallback policy

Any element with no usable texture gets a **CSS recreation** (gradients/borders — the unique-header dark-gradient precedent in `gem-card.css`). The catalog doc records which elements are real art vs recreation, so future upstream finds can upgrade them. The paper-doll statue backdrops are *decorative* — acceptable to omit or approximate; slot wells and socket rings are the fidelity-critical pieces.

## Acceptance criteria

- [ ] `docs/ui/ingame-art-inventory.md` catalog committed, every planned Phase-4 visual element mapped to an asset or an explicit fallback.
- [ ] Assets fetch via `npm run build:images` (CSS-referenced), idempotent on re-run, orphan-pruning unaffected.
- [ ] A throwaway-free demo: a hidden-from-nav static page or a section on the dev-only route is **not** required — a visual check via the CSS file + fetched assets in a scratch HTML is fine; nothing ships user-facing this phase.
- [ ] No hotlinking: everything self-hosted under `public/img/` per the images policy.
