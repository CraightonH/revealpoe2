# Build Planner Roadmap (TODO #1)

**Status:** COMPLETE 2026-07-24 — all 8 phases landed on `planner/phase-4a-builds-pages` (held; not merged). Scope amended 2026-07-21 (see `2026-07-21-build-planner-amendments-design.md`). Remaining open item: the owner's manual in-game `.build` import check (Phase 8).
**This document is the cross-session tracking surface.** Each executing session updates the phase checklist below when a phase lands, and commits the change with the phase's final commit. (Restored from `archive/` 2026-07-21 — it lives in `specs/` until the roadmap completes.)

## Goal

Complete `docs/TODO.md` item 1: a **Build Planner** — save named groups of items, skills, supports, passive tree, etc. Along the way this roadmap also completes TODO #3 (theorycraft pinning) and TODO #4 (add-to-X icons on all cards).

### Finish line (approved scope: "loadout + light math")

- Named builds persisted in **localStorage** (pure static site — no backend, no accounts; per-browser is an accepted limitation, share URLs cover portability).
- A build holds: gear slots (uniques/bases + **chosen modifiers**: 1–6 real mods with tiers on bases, optional corrupted implicit on uniques — amended 2026-07-21, supersedes the affix wishlist), skill setups (skill gem + supports, levels; item-granted skills auto-included), spirit gems, a passive-tree share code + **ordered Notable Priority list**, class/ascendancy, notes.
- **Variants** (amended 2026-07-21): a parent build carries an ordered list of labeled variant references ("Lv 1–30", …); each variant is a full sibling build. Group shares travel as one URL.
- **Light math**: attribute/level requirement totals, socket & support-legality warnings, whitelisted stat aggregates (attributes, life/mana/spirit, resists). **No DPS engine** (explicitly out of scope).
- **UI fidelity** — **Amended 2026-07-22:** the in-game-imitation goals below are superseded by the owner-approved "Dossier" design (`docs/superpowers/plans/2026-07-22-builds-dossier-redesign.md`): the in-game *spatial arrangement* is retained for gear but the in-game *artwork* is dropped (planner-art textures no longer consumed by the editor); skill setups render as icon "constellation chains" with real gem icons and **no level controls**; a `description` field was added (notes stay). The passive-tree embed goal (Phase 5) stands. Original goals, for history:
  - ~~Skill section imitates the in-game **Skill Gems menu** (stacked setup rows: gem icon, name banner, level, circular support sockets).~~
  - ~~Item section imitates the in-game **Inventory paper-doll** (slot-art grid).~~
  - Passive section **embeds the real interactive tree** (full /passives functionality) with a **Notable Priority** ordered list; hovering a priority row highlights that node in the embedded tree.
- Sharing: compressed **URL fragment** codes; export to the official in-game **`.build` file** (JSON, v1 Experimental — GGG developer docs at pathofexile.com/developer/docs/game).
- "Add to Build" icon on every card/tooltip site-wide (pick existing build / create new).
- Theorycraft gains an **ephemeral pin board** (deliberately separate from builds) with promote-to-build.

### Explicit non-goals

- DPS / damage calculation (PoB territory).
- Crafting **simulation** (currency steps, odds — TODO #2 territory). Mod *selection* on bases was pulled forward into this roadmap 2026-07-21 (Phase 4c); simulating how you'd craft the result is still out of scope.
- Quest-reward campaign bonuses — no scraped data; parked for a future roadmap.
- Backend storage, accounts, cross-device sync (a share-shortlink Worker can be bolted on later without rework).

## Architecture principles (all phases)

- **Pure static + client state.** Planner pages are prerendered shells; all build state lives in localStorage; client renders from prebuilt artifacts in `public/generated/` (the proven `/search` + `/theorycraft` pattern: `query-core.js`, `search-index.json`, `browse-cards.json`).
- **Pure cores, dual-use.** State/codec/math logic is written as pure ES modules importable by both node tests and the browser (the `query-core.js` / `passive-code.js` pattern). DOM wiring is a thin layer over the pure core.
- **Data provenance policy holds.** Game knowledge added for the planner (gear-slot mapping, socket rules) goes in `data/manual/*.json` overlays → `derived` edges, never hand-enumerated per base, never edits to `data/source/`.
- **Crawler discoverability.** Any new client-fetched URL must appear in a crawlable attribute (`href`, `hx-get`, `data-card-url`, `data-keyword`) or `extractLinks()` in `scripts/prerender.js` must be extended. Artifacts under `public/` are copied to `dist/` as static files.
- **Verify static-only failure modes** with `npm run build:static` before promoting each phase.

## Phases

Execution protocol per phase (for the orchestrating session):

1. Read this roadmap + the phase's design spec.
2. Invoke `superpowers:writing-plans` to author the implementation plan **against the then-current codebase** (plans are deliberately not pre-written; only Phase 1's plan exists — earlier phases reshape the code later plans must target).
3. Execute the plan (TDD, keep `npm test` green).
4. Verify per the spec's acceptance criteria, including `npm run build:static` when the phase touches pages/artifacts.
5. Tick the checkbox below, note the completing commit, commit.

| # | Phase | Spec | Depends on |
|---|-------|------|-----------|
| 1 | Build store foundation | `2026-07-06-build-store-design.md` | — |
| 2 | Slot & socket data model | `2026-07-06-slot-socket-model-design.md` | — |
| 3 | In-game UI art ingestion | `2026-07-06-ui-art-ingestion-design.md` | — |
| 4 | Builds pages + Add-to-Build | `2026-07-06-builds-pages-design.md` + amendments §1, §4 | 1, 2, 3 |
| 4c | Item mod picker + `mod-pools.json` | `2026-07-21-build-planner-amendments-design.md` §1 | 4b |
| 5 | Tree embed + Notable Priority | `2026-07-06-tree-embed-notable-priority-design.md` | 1 (parallel with 2–4) |
| 6 | Theorycraft pinning (TODO #3) | `2026-07-06-theorycraft-pinning-design.md` | 4 |
| 7 | Light math | `2026-07-06-light-math-design.md` + amendments §1 ripple | 4 |
| 8 | Sharing, variants & in-game export | `2026-07-06-build-sharing-export-design.md` + amendments §2, §3 | 4, 5 |

Phases 1, 2, 3 are independent and may run in parallel sessions. Phases 6, 7, 8 are independent of each other. Phase 4 is the largest and has an internal milestone split (4a/4b) in its spec plus the amended 4c; expect three sessions. Implementation coding is dispatched to Codex per phase (amendments doc, Execution protocol).

### Status checklist

- [x] Phase 1 — Build store foundation (654c2a5)
- [x] Phase 2 — Slot & socket data model (5c728df)
- [x] Phase 3 — In-game UI art ingestion (6ea4f3b) — *2026-07-22: the editor no longer consumes these textures (Dossier redesign); `planner-art.css` stays as the ingestion trigger, pruning decision deferred*
- [x] Phase 4a — /builds list + read-only viewer + Add-to-Build affordance (b66ce2d)
- [x] Phase 4b — Build editor (inventory paper-doll + skill panel + picker; granted-skill rows) (695a1a0)
- [x] Phase 4c — Item mod picker + `mod-pools.json` (incl. corrupted-implicit data verification) — corrupted implicits confirmed in source (113 families, 1023/1067 bases); anchored-popover picker (prefix/suffix 3+3 + tier select, warnings-not-blocks) + build-aware well hover card; plan `docs/superpowers/plans/2026-07-22-item-mod-picker.md`. **Pool completeness (follow-up):** mod-pools projects **standard + corrupted + desecrated** (Abyssal, boss-pilled) — parity-checked against the `/bases` `getModsForClass`/`getDesecratedForClass`/`getCorruptedForClass` eligibility. **Essences deferred:** `generation_type: "essence"` (117 mods) exists in source but is NOT mapped to an origin in `scripts/graph/affixes.js` `originOf()`; wiring it there (+ eligibility edges) makes essences flow into mod-pools automatically — a graph-layer task affecting the site-wide affix tables too, not just the planner.
- [x] Phase 5 — Tree embed + Notable Priority (349ee05) — `init(canvas,data,opts)` made embeddable (scoped lookups, injected `tree-panel.js` panels, host-owned hash/clipboard/confirm); extended API (`getState/setState`, `setHighlight`, `focusNode`, `getAllocatedNotables`, `getPoints`, `paintNodeIcon`, `deallocate`, `destroy`, `onReady/onChange/onCodeChange`); `/passives` = thin host; editor embeds the live tree (DOM-reparented across re-renders) + Notable Priority list (`tree-priority.js`: reconcile + render, hover-highlight/click-focus/drag-reorder/remove, persisted as `tree.notablePriority`). Plan `docs/superpowers/plans/2026-07-22-tree-embed-notable-priority.md`; headless gate `scripts/verify-tree-embed.mjs` (10/10). **Deviations (deliberate):** shared panel = pure JS module not Nunjucks partial (editor is client-rendered); read-only/import previews show a static summary, not a live embed.
- [x] Phase 6 — Theorycraft pinning (pin board 4c41e00; promote-to-build 0d51c60/b66ce2d; site-wide pin affordance 2026-07-23 — coarse-gem recovery+dedup in `pin-store.js` resolve, third `card-actions.njk` icon `data-pin-*`, `add-to-pins.js` delegated handler + toast→/theorycraft; headless gate `scripts/verify-sitewide-pin.mjs`)
- [x] Phase 7 — Light math (2026-07-23, 955bdfd..448a58a) — pure `build-math.js` (whitelist parser + `computeMath`) is dual-use: a build-step projector `src/data/itemMath.js` → `item-math.json` (class base_stats, gem crafting levels, per-item reqs + whitelist stat lines) and the browser both parse via it. Editor **Summary card** (`renderSummary`): Str/Dex/Int available/required + deficits, character-level requirement, whitelist aggregates (Life/Mana/Spirit/resists as `N/75`), consolidated warnings; live on edits + tree change (new embed getter `getAllocatedStatLines()`). **Accept-the-hole cuts (verified at plan time):** gem *attribute* requirements (source has only proportional `requirement_weights`, no magnitudes — character-level requirement uses gem `crafting_level` instead); Spirit *reservation* vs available (no structured reservation numbers in source — "+N Spirit" still aggregates). 661 tests; build:static 9292/9292; headless `scripts/verify-light-math.mjs` + `getAllocatedStatLines` gate in `verify-tree-embed.mjs`.
- [x] Phase 8 — Sharing (incl. variants/group codec v2) & in-game `.build` export (2026-07-24, e3c2c00..) — plan `docs/superpowers/plans/2026-07-24-sharing-variants-build-export.md`. **Variants:** schema v3 `variants: [{label, buildId}]` + store group API (`addVariant`/`renameVariant`/`removeVariant`/`parentOf`/`group`/`importGroup`); `remove()` prunes stale references, deleting a parent **orphans** (never deletes) its variants, `duplicate()` no longer inherits a variant list (two parents must never share a variant build). Variant strip = tabs on the dossier head, rename/detach on the current variant only. **Codec v2:** `encodeGroup`/`decodeGroup` pack parent + ordered variant snapshots into ONE code; v1 codes still decode, guarded by a **frozen v1 code literal** in the test (the only proof left, since `encodeBuild` is gone). Measured: 8 heavy variants ≈ 1.5 KB encoded — deflate absorbs the inter-variant redundancy as Amendment 3 predicted. **Share UX:** view-first — a group URL renders read-only with a working variant strip and writes **nothing** to the visitor's localStorage until "Save a copy", which imports the whole relinked group (asserted in the headless gate). **`.build` export:** pure `build-file.js`, mapped against two **real** in-game files now committed at `test/fixtures/build-files/` (+ README). **Fixture findings — one corrected a spec assumption:** `passives[].id` is the PassiveSkills **string** id (`"spells18"`), *not* the node hash the original spec expected; all 411 fixture ids resolve in our RePoE copy and 4782/4784 tree hashes map (the 2 misses are unnamed `Huntress3` filler nodes). `skills[].id` is our graph gem node key **verbatim** — PoE2's `Metadata/Items/Gem/` and `Metadata/Items/Gems/` are two **disjoint** 593-gem sets, so normalizing either way would emit ids the game rejects. `ascendancy` = GGG id (`Sorceress1`); `weapon_set` = 1|2 from the tree code's trailing-record subType; planned items travel as `additional_text` = base name + `1.`-numbered mod lines. Two new **lazily-fetched** artifacts (`build-export.json` 12.9 KB gz, `passive-build-ids.json` 36.3 KB gz) keep these maps off the always-loaded `planner-data.json` (37 KB) and `passive-tree.json` (236 KB); `passiveIds` is projected by `scripts/build-passive-tree.js` because the full 5150-passive table exists only in source, which `src/data/*` may not read. **Accept-the-hole:** `Offhand2`/`Flask2` inventory ids emitted **by pattern** (neither fixture exercised them); `additional_text` carries mod **ranges**, not rolled values (we plan builds, we don't roll them); `level_interval` never emitted (no per-setup bracket data). **Known pre-existing limitation, deliberately not fixed here:** `scripts/graph/gems.js:51` dedupes gems first-wins on `${slug}|${gem_type}`, so `Metadata/Items/Gems/SkillGemSpark` (released, display name "Spark") is dropped in favour of `SkillGemUniqueEarthboundTriggeredSpark`, which shares that name — a Spark build therefore exports the Earthbound id. 143 source gems are dropped this way. Site-wide (affects `/gems` + search too), so fixing it is its own task, not Phase 8's. **Deferred (owner decision 2026-07-24):** wishlist→trade **stat-filter** links (spec §3, always a stretch) — trade-API stat-id mapping stays unbuilt; base-type trade links unchanged. **Pending the only true oracle:** the owner's manual in-game import on PC — a conformance-checked sample was generated and handed over. Gates: **718 tests** (was 662), `build:static` **9292/9292**, headless `scripts/verify-sharing-export.mjs` **26/26 against both the dev server and the static `dist/`**, plus green Phase 5/6/7 gates.
- [x] TODO.md items 1, 3, 4 marked complete

## Key cross-phase contracts

These are the interfaces phases share; changing one requires updating the affected specs:

- **Build schema** (v1 in Phase 1's spec; v2 fields — `mods`/`corrupted` per slot, `variants` list, granted-skill support persistence — in the 2026-07-21 amendments) — every phase reads/writes it through `build-store.js`, never raw localStorage; version bumps go through its migrations framework.
- **Item reference** `{ kind: 'unique'|'base'|'gem', slug }` — matches the browse-card key space used by `browse-cards.json` and theorycraft docs.
- **Tree state** — the official v7 share code string (existing `public/js/passive-code.js`) + `notablePriority: [nodeHash]`.
- **Embeddable tree API** (defined in Phase 5's spec) — `init(root, opts)`, `getState()/setState()`, `setHighlight(hashes)`, `focusNode(hash)`, `onCodeChange` event.
- **Add-to-Build affordance** — `data-add-build`-style attributes on cards + a delegated handler module, following the `data-trade-url` / `trade-link.js` precedent.
