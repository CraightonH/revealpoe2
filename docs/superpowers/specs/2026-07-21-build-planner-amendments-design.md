# Build Planner — Scope Amendments (2026-07-21)

Amends the Build Planner roadmap (`2026-07-06-build-planner-roadmap.md`) and its pending phase specs. Approved 2026-07-21 after re-scoping against mobilytics.gg-style build guides. Phases 1–3 are complete and unaffected; execution resumes at Phase 4 with the changes below. The static-site constraint is unchanged and absolute: localStorage + URL-fragment codes, no backend.

## Amendment 1 — Full item mod selection (new Phase 4c)

**Supersedes the "affix wishlist" as the per-slot modifier model.** The approved roadmap deferred real modifier selection to the Item Crafter (TODO #2); this pulls the selection slice (not the crafting simulation) forward.

- **Base items:** pick a base → choose 1–6 explicit modifiers from that base's *legal* pool, with prefix/suffix legality enforced (max 3 + 3) and **tier selection** per mod. Warnings, never hard blocks, consistent with `build-rules.js` philosophy.
- **Unique items:** optionally choose one **corrupted modifier** (corrupted implicit).
- **Schema v2:** the gear-slot value gains `mods: [{affix, tier}]` (base items) and `corrupted: {affix, tier?}` (uniques), replacing `wishlist: [typeSlug]`. Migration v1→v2 converts wishlist entries to tierless mod refs where they resolve, else drops them — in practice empty, since no shipped UI ever wrote wishlists. Exact reference shape (affix node id vs slug + tier index) is decided at plan time against the graph's affix id space.
- **New client artifact `public/generated/mod-pools.json`** projected at build time from the graph's `rolls_on` edges (49,955) + affix `tiers` props, the `planner-data.json` pattern (`src/data/` projection + generated artifact + node tests). Contents: per-base (or per-base-group) legal affix list with generation type, tier list (name, level, stat text, ranges). **Size budget: ~1 MB gzipped**; if exceeded, shard per item class and lazy-load per slotted base — decided at plan time from measured output.
- **Data verification (first task of Phase 4c):** confirm corrupted-implicit pools exist in the scraped source / graph (check affix `origin`/generation types; fall back to `ggpk-poe2` tables per `docs/ggpk-datamining.md`). If absent from source, that is a `data/manual/` curation decision per the provenance policy — surface the trade-off before building UI, never fabricate.
- **Downstream ripples:**
  - Phase 4b's paper-doll spec: the per-slot "wanted affixes" chip list becomes the mod picker; slotted base cards render chosen mods as explicit-mod lines (existing `.explicitMod` popup styling).
  - Phase 7 (light math): whitelisted aggregates read chosen mod tier values (use tier midpoint; exact convention decided at plan time).
  - Phase 8 (trade links): stat-filter mapping keys off chosen mods instead of wishlist entries; `additional_text` hints in `.build` export likewise.

## Amendment 2 — Build variants (sibling builds + group)

New scope; not in the original roadmap. Models the mobilytics-style leveling progression ("Lv 1–30", "Lv 30–50", …).

- **Each variant is a full standalone build.** No delta/inheritance logic — "duplicate build" is the authoring workflow for the next bracket.
- **Schema v2:** a parent build gains `variants: [{label, buildId}]` (ordered). Variant builds are ordinary builds in the store; the parent's list is the only grouping structure. Store-level guards: deleting a variant build prunes it from any parent's list; deleting a parent orphans (not deletes) its variants.
- **Editor UI:** a variant switcher strip on the build editor/viewer (tabs by label); "Add variant" = duplicate current + append to parent's list + edit label.

## Amendment 3 — Share UX: view-first, groups travel as one URL

Refines Phase 8's share flow (its `#/import/<code>` preview was already read-only; this confirms and extends it to groups).

- **View first, import optional:** opening a share URL renders a **read-only viewer** decoded straight from the fragment; nothing touches the visitor's localStorage until "Save a copy". Decode failures show a friendly error.
- **Group shares:** sharing a parent with variants embeds **every variant snapshot in one code** — the guide travels as a single URL with a variant switcher in the viewer. Deflate handles the inter-variant redundancy. "Save a copy" on a group share imports the whole group (parent + variants, fresh ids, relinked).
- **Codec v2 envelope:** `build-code.js` gains a versioned group container (`{parent, variants:[{label, build}]}`); v1 single-build codes remain decodable. Fragment size is a non-issue (worst realistic group ≈ a few KB encoded; browsers tolerate far more).

## Amendment 4 — Item-granted skills in the skill section

The skill section auto-includes skills granted by equipped items (the graph already has `grants` edges: 116 from uniques).

- **`planner-data.json` extension:** unique slug → granted-skill entries (skill ref + display name + icon), projected from `grants` edges.
- **Editor behavior:** when an equipped item grants a skill, a setup row appears automatically, labeled "from <item>", non-removable while the item is equipped (removed with the item), and sockets 0–5 supports like any other row. Granted-skill support choices persist in the schema keyed by the granting item, so unequip/re-equip round-trips.

## Deferred / unchanged

- **Quest rewards (permanent campaign bonuses):** deferred — no scraped data. Parked as a future roadmap line item, not a phase.
- **Light math scope, `.build` export, Add-to-Build affordance, tree embed + Notable Priority ordering:** unchanged from their 2026-07-06 specs (Notable Priority already covers "show the order notables/keystones are acquired").
- **Non-goals reaffirmed:** DPS engine, backend/accounts/short links/OG previews for shared builds (documented static-site limits), crafting simulation (currency-step logic stays with TODO #2).

## Amended phase plan

| # | Phase | Change |
|---|-------|--------|
| 4a | `/builds` list + **read-only viewer** + Add-to-Build | viewer pulled forward from Phase 8 (share UX needs it; it is also the group-share render surface) |
| 4b | Build editor: paper-doll + skill panel | + granted-skill rows (Amendment 4); wishlist chip list replaced by mod display |
| **4c** | **Item mod picker + `mod-pools.json`** | **new** (Amendment 1) |
| 5 | Tree embed + Notable Priority | unchanged |
| 6 | Theorycraft promote-to-build | pin board already shipped (`tcPins`, 4c41e00); remainder folds into 4a's Add-to-Build handler |
| 7 | Light math | reads chosen mod tiers (Amendment 1 ripple) |
| 8 | Sharing UI + **variants/group codec v2** + `.build` export | + Amendments 2–3 |

## Execution protocol

Per-phase protocol from the roadmap holds (just-in-time plan → TDD → verify → tick checklist). **Implementation coding is dispatched to Codex** (`codex:rescue` agent) per phase; review, `npm test`, and `npm run build:static` verification gates run in the orchestrating session before each phase merges.
