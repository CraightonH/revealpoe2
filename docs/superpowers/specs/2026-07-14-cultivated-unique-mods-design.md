# Cultivated (Mutated Vaal) Unique Mods — design

**Date:** 2026-07-14
**Status:** approved design, pre-implementation

## Problem

Certain **Vaal uniques** ("Fate of the Vaal" content) can be modified with the **Vaal
Cultivation Orb** (in-game currency *Morphology Mechanism*, `CurrencyIncursionMutateUnique`):

> *"Replaces up to 2 modifiers on a Corrupted Vaal Unique. Replaces other Uniques with a
> Corrupted Unique of the same Item Class."*

The mods a Vaal unique can mutate into — its **cultivated mods** — are crafting-critical
information (they decide whether the gamble is worth it). Our unique data comes from
PoB (`pob-uniques/`), which carries each Vaal unique's **base** explicit mods but **not**
its cultivated mods. This is the hole to fill.

Example — **Atziri's Contempt** (Pronged Spear):

| | mods |
|---|---|
| Base (have) | inc. Phys, added Fire, added Lightning, inc. Attack Speed, inc. Presence AoE |
| **Cultivated (missing)** | (100–150)% inc. Elemental Damage w/ Attacks · +(2–4)% Crit Hit Chance · (15–30)% chance to invert enemy Ele Res on hit · (50–75)% chance to Fork after a Melee Hit |

## Datamining findings (what's available, what isn't)

Investigated exhaustively against the `ggpk-poe2` mirror + ggpk.exposed (`docs/ggpk-datamining.md`).

1. **The cultivated pool is per-item.** poe2db presents each Vaal unique's cultivated mods
   as a fixed, item-specific list ("Cultivated Uniques /1"). Atziri's 4 mods are a curated,
   spear-appropriate subset — *not* a global pool, *not* a per-item-class rule.

2. **The mod definitions are already in RePoE.** All **232** cultivated mods live in the
   `Mods` table under the `UniqueMutatedVaal*` family — and, critically, **all 232 are also
   already in `data/source/repoe-poe2/mods.json`** with full stats + `min`/`max` ranges
   (`generation_type: unique`, `domain: item`). Their display text renders through the
   **existing** `scripts/graph/affixes.js` stat renderer (`stat_descriptions.json`). All 4 of
   Atziri's cultivated mods were matched to RePoE ids with exact ranges.

   ⇒ **ggpk is NOT a build dependency.** It was the discovery tool only. The build reads no
   ggpk data for this feature.

3. **The per-unique *assignment* is NOT datamineable.** Which mutated mods belong to which
   unique exists in **no extractable GGPK form**. Verified across every avenue:
   - Balance `.datc64` tables — no typed `→Mods` ref, no raw-index content match, no string-id
     ref to the `UniqueMutatedVaal*` mods (reverse-scanned all ~1020 tables).
   - The 8 mirrored tables lacking a dat-schema entry — all irrelevant (mobile/atlas/tencent).
   - `metadata/items/**` `.it` resource files — declare base structure only, no mod lists;
     `weapons/uniques/` has no per-unique files.
   - `Words` / `UniqueOrigins` — no cultivated-variant naming or mod linkage. (`UniqueOrigins`
     *does* segment the 48 Vaal-origin uniques — used below as the bootstrap candidate filter —
     but it maps unique → cultural origin only, never unique → mods.)

   This mirrors why RePoE omits unique mods and PoB hand-maintains them: GGG compiles unique
   mod assignments into item generation, not into datamineable data. poe2db has the mapping
   because its author **curates** it.

   ⇒ The assignment must be **curated**. (`Incursion2MutatedUniqueModsClient.OriginalMods`,
   a flat 242-mod client list of the *base* mods that get removed, is a red herring for
   eligibility.)

## Approach

Curate the mapping in a committed overlay; the builder derives all mod detail from the
existing RePoE mirror. Bootstrap the mapping from poe2db once (dev-side), then own it.

### 1. Overlay — `data/manual/cultivated-uniques.json` (committed, `source: manual`)

The irreducible hand fact (absent from every mirror): unique → its cultivated mod ids.

```json
[
  {
    "unique": "Atziri's Contempt",
    "vid": "FourUniqueSpear14_",
    "mods": [
      "UniqueMutatedVaalIncreasedWeaponElementalDamagePercent",
      "UniqueMutatedVaalLocalBaseCriticalStrikeChance",
      "UniqueMutatedVaalTreatResistsAsInvertedChance",
      "UniqueMutatedVaalProjectileForkChanceIfMeleeRecently"
    ]
  }
]
```

- **Keyed on `vid` = RePoE `visual_identity.id`** — GGG-internal, ASCII-safe, stable across
  display-name changes and localization. 446 distinct across all 449 uniques, none missing.
  Chosen over the display **name** (apostrophes/diacritics = encoding worry) and over the
  **slug** (`slugify("Mjölner")` → `"mj-lner"`, lossy on diacritics).
- `unique` (human name) is carried for **readability + cross-check only**, not the join key.
- `mods[]` are RePoE `mods.json` keys (the `UniqueMutatedVaal*` ids).

### 2. Builder integration — `scripts/graph/manual.js` (applied last)

Resolves the overlay against source nodes + RePoE `mods.json`, attaching a **derived** prop
directly to the unique's graph node (per approval: node prop, not edges/mod-nodes):

```
node.props.cultivatedMods = [
  { modId, statId, min, max, text, source: 'derived', via: 'manual:cultivated-uniques' },
  …
]
```

- Text/ranges resolved by reusing the existing `affixes.js` renderer against RePoE
  `mods.json` — no duplicated rendering logic, no ggpk read.
- Provenance: overlay entries `manual`; the resolved `cultivatedMods` detail `derived`
  (`via: manual:cultivated-uniques`). Recorded in `meta.provenance`; participates in
  `meta.manualHash`.

**Guards (enforced in the build):**
- **vid not found, or ambiguous (>1 unique node)** → **build fails** (a renamed/removed key
  can never silently drop the relationship). The 3 known `vid` collisions are the non-Vaal
  "Guiding Palm" variant family; if a Vaal unique ever collides, the failure forces explicit
  disambiguation.
- **mod id not in RePoE `mods.json`** → **build fails** (stale mod key after a patch).
- **`unique` name ≠ resolved node name** → **warn** (stale vid after a GGG rename; non-fatal).
- **Retirement detection** — if RePoE ever ships per-unique cultivated mods, **warn** on the
  overlap so the overlay copy can be deleted. Source wins.

### 3. Bootstrap script — `scripts/bootstrap-cultivated.js` (dev-only, one-shot, NOT in build)

Generates/refreshes the overlay. Not invoked by `dev`, `build:*`, `test`, or CI.

- **Restrict candidates to Vaal-origin uniques.** Only Vaal uniques are cultivable, so the
  script does not probe all 449 uniques. The candidate set is ggpk `UniqueOrigins` where
  `Origin = "Vaal"` — **48** uniques (e.g. Atziri's Contempt), joined to RePoE uniques by
  name. (`UniqueOrigins` is read only here, in the dev bootstrap; ggpk still never enters the
  build.) Not every Vaal-origin unique necessarily has a cultivated section — the run reports
  those with none, so the final overlay is the ~30–40 that do.
- For each candidate, fetch its poe2db page (`https://poe2db.tw/us/{Name_snake_case}`) and
  extract the "Cultivated Uniques" section when present. (Rate-limited, disk-cached, TLS via
  `env -u SSL_CERT_FILE NODE_EXTRA_CA_CERTS`, matching the other network fetchers.)
- Match each poe2db mod line → a RePoE `UniqueMutatedVaal*` id by **normalized stat text +
  value range** (verified 4/4 on Atziri's Contempt). Emit `{unique, vid, mods}`.
- **Unmatched lines are reported, never silently dropped**; the run summarizes matched /
  unmatched / uniques-with-no-cultivated-section for human review before commit.
- Output is reviewed and committed. Re-runnable after game patches. **No build-time or
  runtime poe2db dependency** — poe2db touches only this dev tool, and only its output ships.

### 4. UI — `src/data/uniques.js` + unique card template

A **Cultivated Mods** block on the Vaal-unique tooltip, below the explicit mods, styled to
read as the mutated/corrupted pool (poe2db-parity; imitate its "Cultivated Uniques" section).
Rendered from `props.cultivatedMods` via the existing `renderGameText` path. Only shown when
the unique has cultivated mods.

### 5. Testing — `node:test`

- Overlay schema validation (shape of `{unique, vid, mods}`).
- Referential integrity: unknown `vid` → build error; ambiguous `vid` → build error; unknown
  mod id → build error; name-mismatch → warning (not error).
- Resolution correctness: Atziri's Contempt fixture resolves to the 4 expected mods with
  correct text + `min`/`max`.
- Provenance: resolved cultivated mods carry `source: derived`, `via: manual:cultivated-uniques`.

## Non-goals

- No ggpk data in the graph build (definitions come from RePoE; ggpk stays manual-datamining).
- No build-time or runtime poe2db dependency (bootstrap is a dev-only one-shot).
- Not fabricating cultivated mods for uniques poe2db doesn't list.
- No cultivated-mod graph *nodes* / reverse edges in v1 (possible later enhancement:
  "which uniques can roll mod X" via promoting the 232 mutated mods to nodes).

## Provenance summary (policy compliance)

| Datum | Source tier |
|---|---|
| unique → cultivated mod ids (`cultivated-uniques.json`) | `manual` |
| resolved cultivated mod text + ranges on the node | `derived` (`via: manual:cultivated-uniques`) |
| the `UniqueMutatedVaal*` mod definitions themselves | `repoe` (existing `mods.json`) |

The hand-maintained surface is the irreducible fact only (the mapping); everything else is
derived from source and guarded against source drift.
