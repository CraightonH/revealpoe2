# GGPK data mining

How we reach raw PoE2 game data tables that RePoE-fork does **not** export — most
importantly the **cultivated / mutated unique mod pools** tied to Vaal uniques and
the Vaal Cultivation Orb (GGG's "Fate of the Vaal" content, internal codename
prefix `Incursion2*`).

This is a **manual datamining** capability: it lands the raw tables on disk and
gives you tools to explore them. It is **not** wired into the graph builder — the
wiki still reads only `build/graph.json`. Deciding what to promote into the graph
comes after we understand what the tables contain.

**Exception — promoting GGPK data into the graph.** When a table holds data the wiki
genuinely needs and RePoE lacks (so far: per-gem-level **required character level**,
the **Gemling Legionnaire alternate quality** effects, and skill **weapon requirements**),
it is promoted through a **reproducible, canaried extraction step** — never hand-copied.
The step reads the mirror, asserts known-good anchor values (so a dat-schema column
drift fails **loudly** instead of baking in garbage — column order is load-bearing,
see *Gotchas*), and writes a **committed** JSON under `data/manual/` that the normal
build consumes. The build itself never reads the mirror, so CI needs no GGPK data.
Regenerate after a game patch alongside `fetch:dat`. Instances:

- `scripts/ggpk/extract-gem-levels.js` (`npm run build:gem-levels`) →
  `data/manual/gem-levels.generated.json`, applied by the `gem-levels` overlay handler
  in `scripts/graph/manual.js`.
- `scripts/ggpk/extract-gem-quality.js` (`npm run build:gem-quality`) →
  `data/manual/gem-quality.generated.json`. Source: `GrantedEffectQualityStats`
  (`Alt*` columns — the second quality effect only the Gemling Legionnaire ascendancy
  unlocks; RePoE ships only the standard `Stats` columns). Unlike gem-levels, the raw
  `{statId, permille}` pairs are **rendered to display text at build time** by
  `scripts/graph/gemQuality.js` (reusing the standard-quality stat-translation +
  `resolveQuality` path) and attached per effect-section in `scripts/graph/gems.js`;
  the `gem-quality` handler in `manual.js` is the referential-integrity/retirement
  guard only. Shown on every gem page in the in-game `#b4b4ff` colour.
- `scripts/ggpk/extract-weapon-reqs.js` (`npm run build:weapon-reqs`) →
  `data/manual/weapon-reqs.generated.json`. Source: `ActiveSkills.WeaponRequirements`
  → `ActiveSkillWeaponRequirement` → `WieldableClasses` → `ItemClasses` (RePoE's
  `weapon_restrictions` is empty for every skill). Keyed by `ActiveSkills.Id`
  (== skills.json `active_skill.id`). The `{reqId, classIds}` fact is rendered to a
  display label ("Crossbows", "Maces", "Martial Weapons") by
  `scripts/graph/weaponReqs.js` and attached to the gem node in `gems.js`; shown as a
  second "Requires:" line on the gem card. The `weapon-reqs` handler in `manual.js` is
  a guard only.

## Start here (fresh session)

```
npm install                       # once — adds the pathofexile-dat parser
npm run fetch:dat                 # mirror all ~1020 raw tables (idempotent)
npm run dat -- grep <keyword>     # find a table by name/column (add --values for cell search)
npm run dat -- schema <Table>     # columns + what it references / is referenced by
npm run dat -- dump <Table> --resolve   # rows as JSON, foreign keys resolved to labels
```

`data/source/ggpk-poe2/CATALOG.md` (generated) is the map of every mirrored table
with row counts and relationships.

### The target data

| Table | What it holds |
|---|---|
| `Incursion2MutatedUniqueModsClient` | **The cultivated/mutated unique mod pool** — `{ Id, Mods:[→Mods] }` |
| `Incursion2Crafting` | Cultivation currency/bench behavior + icons |
| `Incursion2CorruptionCurrencies` | Currency ↔ eligible item-class mapping |
| `EndgameCorruptionMods` / `EndgameCleansedMods` | Corruption-outcome weighted mod pools |
| `CurrencyItems` | Master currency table (Vaal Cultivation Orb base row) |
| `Mods` / `ModType` | Modifier definitions; resolve display text via stat translations |
| `Words` / `UniqueOrigins` | Unique **names** live in `Words`; `UniqueOrigins` segments Vaal uniques |

Grep everything for the mechanic prefix: `npm run dat -- grep incursion2`.

## Working with the mirror

Everything below reads the local mirror only (offline, no TLS handling needed).
Run `npm run fetch:dat` once first.

### CLI reference

**`ls [pattern]`** — list mirrored table names; `pattern` is a case-insensitive regex.
```
npm run dat -- ls corrupt
→ EndgameCorruptionMods
  Incursion2CorruptionCurrencies
  …
```

**`schema <Table>`** — the column layout plus both directions of its relationships.
This is your primary orientation tool: it shows every column's type, which tables
each foreign key points **to**, and (from a scan of the whole schema) which tables
point **back** at this one.
```
npm run dat -- schema EndgameCorruptionMods
→ columns:
   0  CorruptionMod   foreignrow -> Mods
   1  SpawnWeight     i32[]
   2  col2            bool
  references: Mods
  referenced by: (none)
```

**`grep <keyword> [--values]`** — find a table when you don't know its name.
Searches table + column names instantly. Add `--values` to also scan every
**string cell** in every table (parses all ~1020 tables — takes a few seconds, and
capped at 200 hits).
```
npm run dat -- grep mutat            # names/columns only
npm run dat -- grep "of the Brute" --values   # find which table/row holds a string
```

**`dump <Table> [--resolve] [--limit N] [--out file]`** — decode rows to JSON on
stdout. `--resolve` follows foreign keys one level (see below); `--limit` caps
rows; `--out` writes to a file instead of stdout.
```
npm run dat -- dump Incursion2MutatedUniqueModsClient --resolve
npm run dat -- dump Mods --limit 5
npm run dat -- dump Mods --out /tmp/mods.json     # then jq/grep at leisure
```

**`catalog`** — regenerate `CATALOG.md` (also runs automatically after `fetch:dat`).

### How rows are shaped

Each row is a JSON object keyed by the schema's column names (anonymous columns
become `col<i>`). Cell types map like this:

| Schema type | In `dump` (raw) | With `--resolve` |
|---|---|---|
| `string`, `i32`, `f32`, `bool` | the scalar value | unchanged |
| `foreignrow -> T` | **integer row index** into table `T` (or `null`) | `T`'s row `Id` (else its first string, else `#<index>`) |
| `foreignrow[] -> T` | array of indices | array of labels |
| `row -> Self` | index into the **same** table | resolved the same way |
| `enumrow -> E` | **integer** (see enum note) | still the integer — enums are not auto-resolved |
| `i32[]` etc. | array of scalars | unchanged |

A foreign key is just a **row index**, so `dump <T>` and counting from row 0 gets
you the referenced row directly. `--resolve` does that lookup for you.

### Recipes

**Follow a relationship.** `schema` tells you the target table; `dump --resolve`
renders the labels. To go deeper than one level, dump the target table too:
```
npm run dat -- dump Incursion2MutatedUniqueModsClient --resolve   # -> Mods Ids
npm run dat -- schema Mods                                         # Mods -> Stats, ModType, …
```

**Turn a mod into readable stat text.** The mirror has *mod structure*, not
display text. A `Mods` row carries `Stat1..Stat6 -> Stats` and `Stat1Value..`;
resolve gives you the stat **id** (e.g. `additional_strength`). The human text
lives in RePoE, which we already mirror — cross-reference the stat id there:
```
npm run dat -- dump Mods --resolve --limit 1
#   Stat1: "additional_strength", Stat1Value: 5 …
grep -rl additional_strength data/source/repoe-poe2/stat_translations/
```

**Resolve an enum value.** `enumrow` columns come back as integers; the labels are
in the pinned schema's `enumerations` block, indexed by `value - indexing`:
```
node -e "const s=require('./data/source/ggpk-poe2/schema.min.json');
  const e=Object.values(s.enumerations).find(x=>x.name==='ModDomains');
  console.log(e.enumerators[1 - e.indexing]);"   # Domain 1 -> ITEM
```
(GenerationType `2` → `SUFFIX`, etc. Many niche enums have empty `enumerators` —
not yet reversed by the community.)

**Filter/transform.** `dump` is just JSON — pipe it:
```
npm run dat -- dump Mods --resolve | jq '[.[] | select(.Domain==1)] | length'
```

**Cross-check a suspicious table.** If a dump looks like garbage, the schema's
column order is likely wrong/partial for that table (offsets misalign). Browse the
same tables at [ggpk.exposed](https://ggpk.exposed) (adapter `poe2`, path
`data/balance/`) to compare, or re-pull a fresh raw copy directly:
`https://ggpk.exposed/files?q=download&adapter=poe2&path=poe2://data/balance/<name>.datc64`.

### Limits of `--resolve`

- **One level only** — it labels foreign keys but doesn't recurse. Dump the target
  table for the next hop.
- **Enums stay numeric** — resolve them via the `enumerations` block (recipe above).
- **No stat display text** — bridge mod stat ids to `data/source/repoe-poe2/stat_translations/`.
- Labels are best-effort (`Id` → first string → `#index`); a table with no string
  column resolves to `#<index>`, which is still a valid pointer for a manual dump.

## How it works

```
ggpk.exposed  ──HTTP──►  raw .datc64 tables  ──parse (pathofexile-dat + dat-schema)──►  JSON rows
```

`.datc64` is the current PoE2 table format: fixed-width binary rows with **no
column names**. The community [dat-schema](https://github.com/poe-tool-dev/dat-schema)
project supplies the ordered `(name, type)` list per table (covers PoE2). We pin
its `schema.min.json` in the mirror.

### Source: ggpk.exposed (chosen)

[ggpk.exposed](https://ggpk.exposed) decodes the game's bundle system and serves
every file over HTTP — so **no game install, no Oodle/native tooling**, and it
always reflects the current live patch. It's the same service the image pipeline
(`scripts/fetch-images.js`) already depends on.

- Enumerate: `GET https://ggpk.exposed/files?q=index&adapter=poe2&path=poe2://data/balance`
- Download raw bytes: `GET https://ggpk.exposed/files?q=download&adapter=poe2&path=poe2://data/balance/<name>.datc64`
- PoE2 quirk: tables live under `Data/Balance/` (`data/balance/`), **not** `Data/`
  root as in PoE1. Localized copies sit in per-language subfolders, which we skip.
- The **image** host (`image.ggpk.exposed/...?format=webp`) is a different route
  and 500s on `.datc64` — use the `q=download` endpoint for data.

### TLS gotcha

`npm run fetch:dat` runs with `SSL_CERT_FILE` / `NODE_EXTRA_CA_CERTS` unset (via
`env -u` in the npm script) — the corporate CA bundle stalls TLS to Cloudflare
(same reason CLAUDE.md unsets them for `build:images` / `fetch:tree`). The offline
`dat` reader needs no such handling.

### Fallback: `pathofexile-dat` over GGG's CDN

The [`pathofexile-dat`](https://github.com/SnosMe/poe-dat-viewer) CLI can pull
tables straight from GGG's patch CDN (`patch-poe2.poecdn.com`) instead of
ggpk.exposed. We use its **parser** but not its CDN loader, because the CDN path
requires manually supplying the PoE2 **`4.x` internal build string** (the
community auto-tracker is PoE1-only) and adds patch-protocol moving parts. Keep it
in mind only as a cross-check if ggpk.exposed is ever unavailable or suspect.

## Components

| File | Role |
|---|---|
| `scripts/fetch-ggpk-dat.js` (`npm run fetch:dat`) | Mirror all balance tables + pin dat-schema. Idempotent (size-gated), prunes orphans. |
| `scripts/ggpk/dat.js` | Pure `.datc64` → JSON decoder. The one place decoding lives. |
| `scripts/ggpk/cli.js` (`npm run dat`) | `ls` / `schema` / `grep` / `dump` / `catalog`. |
| `scripts/ggpk/extract-gem-levels.js` (`npm run build:gem-levels`) | Promote per-gem-level required character level (ItemExperiencePerLevel × SkillGems) into committed `data/manual/gem-levels.generated.json`. Canaried: schema drift fails loudly. |
| `scripts/ggpk/catalog.js` | Generates `CATALOG.md`. |
| `scripts/ggpk/dat.test.js` + `__fixtures__/` | Offline decode test (committed fixture + mini schema). |

Mirror layout (gitignored, regenerable — like the rest of `data/source/`):

```
data/source/ggpk-poe2/
  tables/<name>.datc64   raw mirror (English, ~1020 tables)
  schema.min.json        pinned dat-schema
  _manifest.json         fetch metadata
  CATALOG.md             generated navigation map
```

## Gotchas

- **Column order is load-bearing.** The decoder trusts dat-schema column order to
  compute byte offsets; a wrong/partial schema misaligns every column after the
  bad one (visible as garbage in `dat dump`). Cross-check against ggpk.exposed's
  own web viewer when a table looks off.
- **dat-schema lags new content.** A brand-new league table may have unnamed
  columns until the community adds them; it still parses structurally (untyped
  columns come back `null` rather than crashing the dump). The target table is
  already schema'd.
- **Client/server split.** The authoritative mutated-mod list may partly live in
  a non-`Client` sibling (`Incursion2MutatedUniqueMods`) that dat-schema may not
  document — the full mirror is on disk, so `dat grep incursion2` finds it
  regardless.
